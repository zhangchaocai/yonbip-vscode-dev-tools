"""
请求重试工具模块

提供通用重试装饰器、指数退避、熔断器等功能。
"""

from __future__ import annotations

import functools
import logging
import threading
import time
import sys
from typing import (
    Any,
    Callable,
    Collection,
    TypeVar,
)

import requests

logger = logging.getLogger(__name__)

# Python 3.10+ 才支持 ParamSpec
if sys.version_info >= (3, 10):
    from typing import ParamSpec
    P = ParamSpec("P")
else:
    # Python 3.9 使用简化版本，不使用 ParamSpec
    P = Any  # type: ignore

T = TypeVar("T")

# 默认可重试的异常类型
DEFAULT_RETRYABLE_EXCEPTIONS: tuple[type[Exception], ...] = (
    requests.ConnectionError,
    requests.Timeout,
    requests.HTTPError,
)


def retry_on_failure(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    max_delay: float = 60.0,
    exceptions: Collection[type[Exception]] | tuple[type[Exception], ...] = DEFAULT_RETRYABLE_EXCEPTIONS,
    on_retry: Callable[[Exception, int], None] | None = None,
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """
    重试装饰器，支持指数退避。

    Args:
        max_attempts: 最大尝试次数（含首次）
        delay: 初始延迟秒数
        backoff: 退避乘数
        max_delay: 最大延迟秒数
        exceptions: 可重试的异常类型
        on_retry: 每次重试前的回调，参数为 (exception, attempt_number)

    Returns:
        装饰器函数

    Example:
        @retry_on_failure(max_attempts=3, delay=1.0, backoff=2.0)
        def fetch_data():
            return requests.get("https://api.example.com/data")
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            last_exception: Exception | None = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e

                    if attempt == max_attempts:
                        logger.debug(
                            "重试次数耗尽 (attempt=%d/%d): %s",
                            attempt, max_attempts, str(e)
                        )
                        raise

                    sleep_time = min(delay * (backoff ** (attempt - 1)), max_delay)

                    if on_retry:
                        on_retry(e, attempt)

                    logger.debug(
                        "请求失败，准备重试 (attempt=%d/%d, sleep=%.2fs): %s",
                        attempt, max_attempts, sleep_time, str(e)
                    )

                    time.sleep(sleep_time)

            if last_exception:
                raise last_exception
            raise RuntimeError("重试逻辑异常，未能抛出异常")

        return wrapper
    return decorator


def retry_on_failure_with_result(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    max_delay: float = 60.0,
    retry_on_result: Callable[[Any], bool] | None = None,
    exceptions: Collection[type[Exception]] | tuple[type[Exception], ...] = DEFAULT_RETRYABLE_EXCEPTIONS,
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """
    重试装饰器，支持基于返回结果判断是否重试。

    Args:
        max_attempts: 最大尝试次数
        delay: 初始延迟秒数
        backoff: 退避乘数
        max_delay: 最大延迟秒数
        retry_on_result: 回调函数，接收函数返回值，返回 True 表示需要重试
        exceptions: 可重试的异常类型

    Returns:
        装饰器函数
    """
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            last_exception: Exception | None = None

            for attempt in range(1, max_attempts + 1):
                try:
                    result = func(*args, **kwargs)
                    if retry_on_result is not None and retry_on_result(result):
                        if attempt < max_attempts:
                            sleep_time = min(delay * (backoff ** (attempt - 1)), max_delay)
                            logger.debug(
                                "结果需重试 (attempt=%d/%d, sleep=%.2fs)",
                                attempt, max_attempts, sleep_time
                            )
                            time.sleep(sleep_time)
                            continue
                    return result
                except exceptions as e:
                    last_exception = e
                    if attempt < max_attempts:
                        sleep_time = min(delay * (backoff ** (attempt - 1)), max_delay)
                        logger.debug("请求失败，重试中: %s", str(e))
                        time.sleep(sleep_time)
                        continue
                    raise

            if last_exception:
                raise last_exception
            raise RuntimeError("重试逻辑异常")

        return wrapper
    return decorator


class CircuitBreaker:
    """
    熔断器实现，防止持续调用不稳定的外部服务。

    状态转换:
        CLOSED (正常) → OPEN (熔断) → HALF_OPEN (半开)
    """

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        expected_exceptions: Collection[type[Exception]] | tuple[type[Exception], ...] = DEFAULT_RETRYABLE_EXCEPTIONS,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exceptions = expected_exceptions

        self._failure_count = 0
        self._last_failure_time: float | None = None
        self._state = self.CLOSED
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._state == self.OPEN:
                if (
                    self._last_failure_time is not None
                    and time.monotonic() - self._last_failure_time >= self.recovery_timeout
                ):
                    self._state = self.HALF_OPEN
            return self._state

    def is_available(self) -> bool:
        return self.state != self.OPEN

    def record_success(self) -> None:
        with self._lock:
            self._failure_count = 0
            self._state = self.CLOSED

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()

            if self._failure_count >= self.failure_threshold:
                self._state = self.OPEN
                logger.warning(
                    "熔断器打开，连续失败 %d 次，等待 %.1f 秒后尝试恢复",
                    self.failure_threshold, self.recovery_timeout
                )

    def call(self, func: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
        if not self.is_available():
            raise CircuitBreakerOpenError(
                f"熔断器处于 OPEN 状态，需等待 {self.recovery_timeout} 秒"
            )

        try:
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise

    def reset(self) -> None:
        with self._lock:
            self._failure_count = 0
            self._last_failure_time = None
            self._state = self.CLOSED


class CircuitBreakerOpenError(Exception):
    """熔断器打开时抛出的异常"""
    pass


class RateLimiter:
    """
    令牌桶限流器。

    用于控制对外部 API 的请求频率，避免触发限流。
    """

    def __init__(
        self,
        rate: float,
        capacity: float | None = None,
    ):
        """
        Args:
            rate: 每秒产生的令牌数
            capacity: 桶容量，默认为 rate（支持 burst 请求）
        """
        self.rate = rate
        self.capacity = capacity if capacity is not None else rate
        self._tokens = float(self.capacity)
        self._last_update = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_update
        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
        self._last_update = now

    def acquire(self, tokens: float = 1.0, blocking: bool = True, timeout: float | None = None) -> bool:
        """
        获取令牌。

        Args:
            tokens: 需要获取的令牌数
            blocking: 是否阻塞等待
            timeout: 最大等待秒数，None 表示无限等待

        Returns:
            是否成功获取令牌
        """
        deadline = time.monotonic() + timeout if timeout is not None else None

        while True:
            with self._lock:
                self._refill()
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return True

                if not blocking:
                    return False

                wait_time = (tokens - self._tokens) / self.rate
                if deadline is not None and time.monotonic() + wait_time > deadline:
                    return False

            # 释放锁进行等待，让其他线程有机会获取令牌
            time.sleep(wait_time)

    def __enter__(self) -> "RateLimiter":
        self.acquire()
        return self

    def __exit__(self, *args: Any) -> None:
        pass


# 全局限流器实例（按需使用）
_default_limiter: RateLimiter | None = None


def get_global_rate_limiter(rate: float = 10.0) -> RateLimiter:
    """获取全局限流器实例"""
    global _default_limiter
    if _default_limiter is None:
        _default_limiter = RateLimiter(rate=rate, capacity=rate * 2)
    return _default_limiter


def set_global_rate_limiter(limiter: RateLimiter) -> None:
    """设置全局限流器实例"""
    global _default_limiter
    _default_limiter = limiter

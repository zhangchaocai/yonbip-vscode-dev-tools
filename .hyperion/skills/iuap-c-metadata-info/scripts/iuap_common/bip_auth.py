#!/usr/bin/env python3
"""
开放平台 access_token 获取与缓存（增强版）

Features:
    - Token 缓存与自动刷新
    - 请求重试与指数退避
    - 熔断器保护
    - 环境变量支持（避免硬编码密钥）
    - 详细错误信息

对齐 Java:
    - AccessTokenUtils.sendTokenRequest + SignHelper.sign
    - GenericResponse.SUCCESS_CODE == "00000"
    - AccessTokenResponse: access_token, expire（秒）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests

from .retry_utils import retry_on_failure, CircuitBreaker, CircuitBreakerOpenError, RateLimiter
from .secure_config import get_env, _load_dotenv

# 自动加载 .env 文件
_load_dotenv()

logger = logging.getLogger(__name__)

# 与 com.yonyou.entrance.tool.util.GenericResponse.SUCCESS_CODE 一致
TOKEN_SUCCESS_CODE = "00000"

# 全局熔断器（防止持续请求失败的 token 接口）
_token_circuit_breaker: Optional[CircuitBreaker] = None
_token_rate_limiter: Optional[RateLimiter] = None


def _get_circuit_breaker() -> CircuitBreaker:
    """获取全局 token 熔断器"""
    global _token_circuit_breaker
    if _token_circuit_breaker is None:
        _token_circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=30.0,
            expected_exceptions=(
                requests.ConnectionError,
                requests.Timeout,
                requests.HTTPError,
                RuntimeError,
            ),
        )
    return _token_circuit_breaker


def _get_rate_limiter(cfg: Dict[str, Any]) -> RateLimiter:
    """获取限流器（从配置读取）"""
    global _token_rate_limiter
    if _token_rate_limiter is None:
        rate = float(cfg.get("rate_limit", {}).get("requests_per_second", 10.0))
        burst = float(cfg.get("rate_limit", {}).get("burst_capacity", rate * 2))
        _token_rate_limiter = RateLimiter(rate=rate, capacity=burst)
    return _token_rate_limiter


# Token 缓存：key -> (token, expires_at_unix: float)
_lock = threading.Lock()
_cache: Dict[str, Tuple[str, float]] = {}


def _cache_key(api: Dict[str, Any]) -> str:
    """生成缓存键"""
    base = (api.get("base_url") or "").strip().rstrip("/")
    app_key = api.get("app_key") or ""
    return f"{base}|{app_key}"


def invalidate_token_cache(cfg: Dict[str, Any]) -> None:
    """强制下次请求重新拉取 token（401 / 业务提示令牌失效时调用）"""
    api = cfg.get("api") or {}
    with _lock:
        _cache.pop(_cache_key(api), None)
    logger.debug("Token 缓存已清除")


def clear_all_token_caches() -> None:
    """清除所有 token 缓存"""
    with _lock:
        _cache.clear()
    logger.debug("所有 Token 缓存已清除")


def _sign(params: Dict[str, str], suite_secret: str) -> str:
    """
    生成签名（对齐 Java SignHelper.sign）。

    算法:
        1. 参数按 key 排序
        2. 拼接为 key1value1key2value2...
        3. HMAC-SHA256(suite_secret, 拼接字符串)
        4. Base64 编码
        5. URL 编码
    """
    tree = dict(sorted(params.items()))
    sb = "".join(f"{k}{v}" for k, v in tree.items())
    mac = hmac.new(
        suite_secret.encode("utf-8"),
        sb.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    b64 = base64.b64encode(mac).decode("ascii")
    return urllib.parse.quote(b64, safe="")


def _is_token_response_success(code: Optional[str]) -> bool:
    """判断 token 响应是否成功"""
    if code is None:
        return False
    c = str(code).strip()
    # 主路径：开放平台 GenericResponse
    if c == TOKEN_SUCCESS_CODE:
        return True
    # 少数环境兼容
    return c in ("000000", "200", "0")


def _parse_token_payload(data: Dict[str, Any], api: Dict[str, Any]) -> Tuple[str, float]:
    """
    解析 token 响应，返回 (access_token, expires_at_unix)。

    支持多种响应格式：
        - data.access_token / data.accessToken
        - access_token 直接在顶层
        - expire 相对秒数或绝对时间戳
    """
    inner = data.get("data")
    if not isinstance(inner, dict):
        inner = {}

    # 提取 token
    tok = inner.get("access_token") or inner.get("accessToken")
    if not tok:
        tok = data.get("access_token") or data.get("accessToken")
    if not tok:
        raise RuntimeError(f"Token 响应中无 access_token: {json.dumps(data, ensure_ascii=False)[:500]}")

    skew = float(api.get("token_refresh_skew_seconds", 120))
    fallback_ttl = float(api.get("token_fallback_ttl_seconds", 3500))

    # 提取过期时间
    exp_raw = inner.get("expire")
    if exp_raw is None:
        exp_raw = inner.get("expires_in")

    now = time.time()
    expires_at: float

    if exp_raw is not None:
        try:
            exp_val = float(exp_raw)
        except (TypeError, ValueError):
            exp_val = fallback_ttl

        # 判断是绝对时间戳还是相对秒数
        if exp_val > 1e12:  # 毫秒级时间戳
            expires_at = exp_val / 1000.0
        elif exp_val > 1e10:  # 秒级时间戳
            expires_at = exp_val
        else:  # 相对有效期（秒）
            expires_at = now + exp_val
    else:
        expires_at = now + fallback_ttl

    # 提前 skew 秒视为过期，避免边界请求失败
    expires_at = max(now, expires_at - skew)
    return str(tok), expires_at


def _request_get_java_style(
    url: str,
    param_map: Dict[str, str],
    *,
    verify: bool,
    timeout: int,
) -> requests.Response:
    """
    对齐 Java RequestTool.doGet（仅用于 getAccessToken）。

    注意：不对值二次编码，因为 SignHelper.sign 已对 Base64 做 URLEncoder。
    """
    if not param_map:
        return requests.get(url, timeout=timeout, verify=verify)
    qs = "&".join(f"{k}={v}" for k, v in param_map.items())
    full = f"{url}?{qs}"
    return requests.get(full, timeout=timeout, verify=verify)


@retry_on_failure(max_attempts=3, delay=1.0, backoff=2.0)
def _fetch_token_from_server(cfg: Dict[str, Any]) -> Tuple[str, float]:
    """
    从服务器获取 token（带重试）。

    Returns:
        (access_token, expires_at_unix)
    """
    api = cfg.get("api") or {}
    app_key = str(api.get("app_key", "")).strip()
    app_secret = str(api.get("app_secret", "")).strip()

    if not app_key or not app_secret:
        raise RuntimeError(
            "api.app_key / api.app_secret 不能为空。\n"
            "请检查 config.yaml 或使用环境变量: ${API_APP_KEY}, ${API_APP_SECRET}"
        )

    base = (api.get("base_url") or "").strip().rstrip("/")
    path = api.get("path_token", "/iuap-api-auth/open-auth/selfAppAuth/getAccessToken")
    url = f"{base}{path}"

    params = {
        "appKey": app_key,
        "timestamp": str(int(time.time() * 1000)),
    }
    params["signature"] = _sign(params, app_secret)

    verify = not bool(api.get("insecure_tls"))
    timeout = int(api.get("http_timeout_seconds", 120))

    # 使用熔断器和限流器
    circuit = _get_circuit_breaker()
    rate_limiter = _get_rate_limiter(cfg)

    rate_limiter.acquire()

    try:
        r = circuit.call(_request_get_java_style, url, params, verify=verify, timeout=timeout)
        r.raise_for_status()
    except CircuitBreakerOpenError as e:
        # 熔断器异常直接抛出
        raise RuntimeError(f"Token 服务熔断: {e}")

    # 解析响应
    try:
        body = json.loads(r.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise RuntimeError(f"Token 接口返回非 JSON: {e}") from e

    if not isinstance(body, dict):
        raise RuntimeError("Token 接口返回非 JSON 对象")

    code = body.get("code")
    if not _is_token_response_success(str(code).strip() if code is not None else None):
        msg = body.get("message") or body.get("msg") or ""
        raise RuntimeError(
            f"获取 access_token 失败:\n"
            f"  - code: {code!r}\n"
            f"  - message: {msg!r}\n"
            f"  - 期望成功码: {TOKEN_SUCCESS_CODE!r} (开放平台 GenericResponse)\n"
            f"  - 请检查 app_key/app_secret 是否正确"
        )

    return _parse_token_payload(body, api)


def get_access_token(cfg: Dict[str, Any], *, force_refresh: bool = False) -> str:
    """
    获取 access_token（带进程内缓存与过期刷新）。

    流程:
        1. 检查缓存是否有效
        2. 缓存无效或 force_refresh 时从服务器获取
        3. 获取成功后更新缓存

    Args:
        cfg: 配置字典
        force_refresh: 强制刷新（忽略缓存）

    Returns:
        access_token 字符串
    """
    api = cfg.get("api") or {}
    key = _cache_key(api)
    now = time.time()

    # 检查缓存
    if not force_refresh:
        with _lock:
            ent = _cache.get(key)
            if ent is not None:
                token, expires_at = ent
                if now < expires_at:
                    logger.debug("使用缓存的 token (剩余 %.0f 秒)", expires_at - now)
                    return token

    # 从服务器获取
    try:
        token, expires_at = _fetch_token_from_server(cfg)
        with _lock:
            _cache[key] = (token, expires_at)
        logger.info("Token 获取成功，有效期 %.0f 秒", expires_at - now)
        return token
    except Exception as e:
        logger.error("Token 获取失败: %s", e)
        raise


def _should_retry_with_new_token(
    cfg: Dict[str, Any], http_status: int, payload: Any
) -> bool:
    """判断是否需要刷新 token 后重试"""
    if http_status == 401:
        return True
    if not isinstance(payload, dict):
        return False

    api = cfg.get("api") or {}
    extra_codes = api.get("auth_retry_business_codes") or []
    code = str(payload.get("code") or "")
    if code in {str(x) for x in extra_codes}:
        return True

    msg = str(payload.get("message") or payload.get("msg") or "").lower()
    needles = (
        "令牌失效",
        "token失效",
        "token expired",
        "access_token无效",
        "无效token",
        "token已过期",
    )
    return any(n in msg for n in needles)


def http_get_json(
    cfg: Dict[str, Any],
    path: str,
    extra_params: Optional[Dict[str, str]] = None,
    *,
    _retry_after_auth: bool = True,
) -> Any:
    """
    携带 access_token 的 GET 请求。

    遇 401 或疑似令牌失效时清空缓存并重试一次。
    """
    api = cfg.get("api") or {}
    base = (api.get("base_url") or "").strip().rstrip("/")
    url = f"{base}{path}"

    token = get_access_token(cfg)
    params: Dict[str, str] = {"access_token": token}
    if extra_params:
        params.update(extra_params)

    verify = not bool(api.get("insecure_tls"))
    timeout = int(api.get("http_timeout_seconds", 120))

    # 限流
    rate_limiter = _get_rate_limiter(cfg)
    rate_limiter.acquire()

    r = requests.get(url, params=params, timeout=timeout, verify=verify)

    try:
        payload = json.loads(r.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        payload = None

    if _retry_after_auth and _should_retry_with_new_token(cfg, r.status_code, payload):
        logger.warning("Token 可能失效，尝试刷新后重试")
        invalidate_token_cache(cfg)
        get_access_token(cfg, force_refresh=True)
        return http_get_json(cfg, path, extra_params, _retry_after_auth=False)

    r.raise_for_status()
    if payload is not None:
        return payload

    try:
        return json.loads(r.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        snippet = (r.content.decode("utf-8", errors="replace") or "")[:800]
        raise RuntimeError(f"接口返回非 JSON（前 800 字符）: {snippet}") from e


def http_post_json(
    cfg: Dict[str, Any],
    path: str,
    body: Dict[str, Any],
    *,
    _retry_after_auth: bool = True,
) -> Any:
    """
    携带 access_token 的 POST 请求（JSON body）。

    遇 401 或疑似令牌失效时清空缓存并重试一次。
    """
    api = cfg.get("api") or {}
    base = (api.get("base_url") or "").strip().rstrip("/")
    url = f"{base}{path}"

    token = get_access_token(cfg)
    params: Dict[str, str] = {"access_token": token}

    verify = not bool(api.get("insecure_tls"))
    timeout = int(api.get("http_timeout_seconds", 120))

    # 限流
    rate_limiter = _get_rate_limiter(cfg)
    rate_limiter.acquire()

    r = requests.post(url, params=params, json=body, timeout=timeout, verify=verify)

    try:
        payload = json.loads(r.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        payload = None

    if _retry_after_auth and _should_retry_with_new_token(cfg, r.status_code, payload):
        logger.warning("Token 可能失效，尝试刷新后重试")
        invalidate_token_cache(cfg)
        get_access_token(cfg, force_refresh=True)
        return http_post_json(cfg, path, body, _retry_after_auth=False)

    r.raise_for_status()
    if payload is not None:
        return payload

    try:
        return json.loads(r.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        snippet = (r.content.decode("utf-8", errors="replace") or "")[:800]
        raise RuntimeError(f"接口返回非 JSON（前 800 字符）: {snippet}") from e

# -*- coding: utf-8 -*-
"""
Redis 元数据缓存模块
在获取元数据时优先从 Redis 查询，命中则跳过 API 调用

缓存策略:
  1. 先查 Redis
  2. 命中则返回（避免 API 调用）
  3. 未命中则调用 API
  4. API 返回后将结果存入 Redis

Key 结构: {API_BASE_URL}/{TENANT_ID}/{URI}
例如: https://v5devkk1.yonyoucloud.com/ozciy868/tlm.financingregister.FinancingRegister

【v6.0 优化】Redis 模块可选导入，未安装时优雅降级为无缓存模式。
"""

import json
import os
import threading
from typing import Any, Optional
from pathlib import Path

# 【v6.0 优化】可选导入 redis，未安装时降级
try:
    import redis
    _REDIS_AVAILABLE = True
except ImportError:
    redis = None  # type: ignore
    _REDIS_AVAILABLE = False

# 尝试导入日志模块
try:
    from iuap_common.logging_config import get_logger
    logger = get_logger("redis_cache")
except ImportError:
    import logging
    logger = logging.getLogger("redis_cache")

# 早期警告（仅在首次加载时）
if not _REDIS_AVAILABLE:
    logger.warning(
        "Redis 模块未安装，将跳过 Redis 缓存。"
        "如需启用请运行: pip install redis"
    )


# ============================================================
# Redis 连接管理（线程安全单例）
# ============================================================

class RedisConnectionManager:
    """Redis 连接管理器（懒加载，线程安全）"""

    _instance: Optional["RedisConnectionManager"] = None
    _lock = threading.Lock()

    def __init__(self):
        self._r: Optional[Any] = None  # redis.Redis 或 None
        self._enabled: bool = False
        self._config: dict = {}

    @classmethod
    def get_instance(cls) -> "RedisConnectionManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def configure(self, cfg: dict) -> None:
        """从配置初始化 Redis 连接"""
        self._config = cfg or {}
        redis_cfg = self._config.get("redis_cache") or self._config.get("redis") or {}

        # 检查是否启用（支持字符串 "true"/"false" 和布尔值）
        enabled_value = redis_cfg.get("enabled", True)
        if isinstance(enabled_value, str):
            self._enabled = enabled_value.lower() in ("true", "1", "yes", "on")
        else:
            self._enabled = bool(enabled_value)

        if not self._enabled:
            logger.info("Redis 缓存已禁用，将跳过 Redis 缓存")
            return

        # 【v6.0 优化】Redis 模块不可用时优雅降级
        if not _REDIS_AVAILABLE:
            logger.info("Redis 模块未安装，将自动降级为无 Redis 模式（使用磁盘缓存）")
            self._enabled = False
            return

        # 【v7.0 修复】额外检查 redis.Redis 类是否存在（某些 stub 包安装了但不包含实际类）
        redis_class = getattr(redis, "Redis", None)
        if redis_class is None:
            logger.info("Redis 模块已安装但 Redis 类不可用，将自动降级为无 Redis 模式（使用磁盘缓存）")
            self._enabled = False
            return

        # 获取连接参数（优先使用环境变量）
        host = os.environ.get("REDIS_HOST", redis_cfg.get("host", "192.168.19.70"))
        port = int(os.environ.get("REDIS_PORT", redis_cfg.get("port", 6890)))
        password = os.environ.get("REDIS_PASSWORD", redis_cfg.get("password", ""))
        db = int(os.environ.get("REDIS_DB", redis_cfg.get("db", 1)))

        try:
            self._r = redis_class(
                host=host,
                port=port,
                password=password if password else None,
                db=db,
                decode_responses=True,
                socket_timeout=5,
                socket_connect_timeout=5,
                retry_on_timeout=True,
            )
            # 测试连接
            self._r.ping()
            logger.info(f"Redis 连接成功: {host}:{port}/db{db}")
        except (redis.ConnectionError, AttributeError, TypeError) as e:
            logger.info(f"Redis 连接失败 ({host}:{port})，将自动降级为无 Redis 模式: {e}")
            self._enabled = False
            self._r = None
        except Exception as e:
            logger.info(f"Redis 初始化异常，将自动降级为无 Redis 模式: {e}")
            self._enabled = False
            self._r = None

    def is_enabled(self) -> bool:
        """检查 Redis 是否可用"""
        if not self._enabled:
            return False
        if self._r is None:
            return False
        try:
            self._r.ping()
            return True
        except:
            return False

    def get_connection(self) -> Optional[Any]:
        """获取 Redis 连接"""
        if self.is_enabled():
            return self._r
        return None


# 全局单例
_redis_manager = RedisConnectionManager.get_instance()


def init_redis_cache(cfg: dict) -> None:
    """初始化 Redis 缓存（从配置）"""
    _redis_manager.configure(cfg)


def is_redis_available() -> bool:
    """检查 Redis 是否可用"""
    return _redis_manager.is_enabled()


# ============================================================
# URI 缓存 Key 构建
# ============================================================

def build_uri_key(uri: str, api_base_url: str = None, tenant_id: str = None) -> str:
    """
    构建 Redis Key 用于存储 URI 元数据

    格式: {API_BASE_URL}/{TENANT_ID}/{URI}
    例如: https://v5devkk1.yonyoucloud.com/ozciy868/tlm.financingregister.FinancingRegister
    """
    base_url = api_base_url or os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = tenant_id or os.environ.get("YONBIP_TENANT_ID", "ozciy868")
    return f"{base_url}/{tid}/{uri}"


# ============================================================
# 缓存读写操作
# ============================================================

def get_cached_metadata(uri: str, api_base_url: str = None, tenant_id: str = None) -> Optional[str]:
    """
    从 Redis 获取元数据缓存

    Args:
        uri: 元数据 URI
        api_base_url: API 基础地址
        tenant_id: 租户 ID

    Returns:
        缓存的 JSON 字符串，未命中返回 None
    """
    r = _redis_manager.get_connection()
    if r is None:
        return None

    key = build_uri_key(uri, api_base_url, tenant_id)

    try:
        cached = r.get(key)
        if cached:
            logger.debug(f"Redis 缓存命中: {uri}")
            return cached
        logger.debug(f"Redis 缓存未命中: {uri}")
        return None
    except (getattr(redis, "RedisError", Exception), Exception) as e:
        logger.warning(f"Redis 读取失败: {e}")
        return None
    except Exception as e:
        logger.warning(f"Redis 未知错误: {e}")
        return None


def set_cached_metadata(
    uri: str,
    metadata_json: str,
    api_base_url: str = None,
    tenant_id: str = None,
    ttl_seconds: int = 86400
) -> bool:
    """
    将元数据存入 Redis 缓存

    Args:
        uri: 元数据 URI
        metadata_json: 元数据 JSON 字符串
        api_base_url: API 基础地址
        tenant_id: 租户 ID
        ttl_seconds: 过期时间（秒），默认 1 天

    Returns:
        是否存储成功
    """
    r = _redis_manager.get_connection()
    if r is None:
        return False

    key = build_uri_key(uri, api_base_url, tenant_id)

    try:
        r.set(key, metadata_json, ex=ttl_seconds)
        logger.debug(f"Redis 缓存写入: {uri} (TTL={ttl_seconds}s)")
        return True
    except redis.RedisError as e:
        logger.warning(f"Redis 写入失败: {e}")
        return False
    except Exception as e:
        logger.warning(f"Redis 未知错误: {e}")
        return False


def delete_cached_metadata(uri: str, api_base_url: str = None, tenant_id: str = None) -> bool:
    """删除 Redis 中的元数据缓存"""
    r = _redis_manager.get_connection()
    if r is None:
        return False

    key = build_uri_key(uri, api_base_url, tenant_id)

    try:
        r.delete(key)
        logger.debug(f"Redis 缓存删除: {uri}")
        return True
    except redis.RedisError as e:
        logger.warning(f"Redis 删除失败: {e}")
        return False


def clear_all_metadata_cache() -> int:
    """清空所有元数据缓存（慎用）"""
    r = _redis_manager.get_connection()
    if r is None:
        return 0

    base_url = os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = os.environ.get("YONBIP_TENANT_ID", "ozciy868")
    pattern = f"{base_url}/{tid}/*"

    try:
        keys = r.keys(pattern)
        if keys:
            count = r.delete(*keys)
            logger.info(f"已清空 {count} 个元数据缓存")
            return count
        return 0
    except redis.RedisError as e:
        logger.warning(f"Redis 清空缓存失败: {e}")
        return 0


# ============================================================
# 批量操作（提高性能）
# ============================================================

def get_cached_metadata_batch(
    uris: list,
    api_base_url: str = None,
    tenant_id: str = None
) -> dict:
    """
    批量从 Redis 获取元数据缓存

    Args:
        uris: URI 列表
        api_base_url: API 基础地址
        tenant_id: 租户 ID

    Returns:
        {uri: cached_json} 字典，只包含命中的项
    """
    r = _redis_manager.get_connection()
    if r is None:
        return {}

    base_url = api_base_url or os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = tenant_id or os.environ.get("YONBIP_TENANT_ID", "ozciy868")

    keys = [f"{base_url}/{tid}/{uri}" for uri in uris]

    try:
        values = r.mget(keys)
        result = {}
        for uri, value in zip(uris, values):
            if value:
                result[uri] = value
        if result:
            logger.debug(f"Redis 批量缓存命中: {len(result)}/{len(uris)}")
        return result
    except redis.RedisError as e:
        logger.warning(f"Redis 批量读取失败: {e}")
        return {}


def set_cached_metadata_batch(
    uri_data_pairs: list,
    api_base_url: str = None,
    tenant_id: str = None,
    ttl_seconds: int = 86400
) -> int:
    """
    批量将元数据存入 Redis 缓存

    Args:
        uri_data_pairs: [(uri, json_string), ...] 列表
        api_base_url: API 基础地址
        tenant_id: 租户 ID
        ttl_seconds: 过期时间（秒）

    Returns:
        成功写入的数量
    """
    r = _redis_manager.get_connection()
    if r is None:
        return 0

    base_url = api_base_url or os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = tenant_id or os.environ.get("YONBIP_TENANT_ID", "ozciy868")

    pipe = r.pipeline()
    for uri, json_str in uri_data_pairs:
        key = f"{base_url}/{tid}/{uri}"
        pipe.set(key, json_str, ex=ttl_seconds)

    try:
        pipe.execute()
        logger.debug(f"Redis 批量写入: {len(uri_data_pairs)} 条")
        return len(uri_data_pairs)
    except redis.RedisError as e:
        logger.warning(f"Redis 批量写入失败: {e}")
        return 0


# ============================================================
# 缓存统计
# ============================================================

def get_cache_stats() -> dict:
    """获取 Redis 缓存统计"""
    r = _redis_manager.get_connection()
    if r is None:
        return {"enabled": False, "message": "Redis 未启用或连接失败"}

    base_url = os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = os.environ.get("YONBIP_TENANT_ID", "ozciy868")
    pattern = f"{base_url}/{tid}/*"

    try:
        keys = r.keys(pattern)
        return {
            "enabled": True,
            "total_keys": len(keys),
            "pattern": pattern,
        }
    except redis.RedisError as e:
        return {"enabled": False, "error": str(e)}


# ============================================================
# 辅助函数
# ============================================================

def parse_cached_metadata(cached_json: str) -> Optional[dict]:
    """解析缓存的 JSON 元数据"""
    if not cached_json:
        return None
    try:
        return json.loads(cached_json)
    except json.JSONDecodeError:
        return None


# ============================================================
# name 索引（name → URI 映射）
# ============================================================

def build_byname_key(billname: str, api_base_url: str = None, tenant_id: str = None) -> str:
    """
    构建 Redis Key 用于存储 name → URI 映射

    格式: byname:{API_BASE_URL}/{TENANT_ID}/{billname}
    例如: byname:https://v5devkk1.yonyoucloud.com/ozciy868/销售订单

    用途：在调用 searchByName API 之前先查询 Redis，
          命中则直接获取 URI，绕过 API 调用
    """
    base_url = api_base_url or os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = tenant_id or os.environ.get("YONBIP_TENANT_ID", "ozciy868")
    return f"byname:{base_url}/{tid}/{billname}"


def get_cached_uri_by_billname(
    billname: str, api_base_url: str = None, tenant_id: str = None
) -> Optional[str]:
    """
    从 Redis 按业务对象名称获取 URI

    Args:
        billname: 业务对象名称（如 "销售订单"）
        api_base_url: API 基础地址
        tenant_id: 租户 ID

    Returns:
        URI 字符串，未命中返回 None
    """
    r = _redis_manager.get_connection()
    if r is None:
        return None

    key = build_byname_key(billname, api_base_url, tenant_id)

    try:
        cached = r.get(key)
        if cached:
            logger.info(f"[REDIS] byname 索引命中: {billname} → {cached}")
            return cached
        logger.debug(f"[REDIS] byname 索引未命中: {billname}")
        return None
    except (getattr(redis, "RedisError", Exception), Exception) as e:
        logger.warning(f"Redis byname 读取失败: {e}")
        return None


def set_cached_uri_by_billname(
    billname: str,
    uri: str,
    api_base_url: str = None,
    tenant_id: str = None,
    ttl_seconds: int = 86400
) -> bool:
    """
    将 billname → URI 映射存入 Redis

    Args:
        billname: 业务对象名称
        uri: 对应的 URI
        api_base_url: API 基础地址
        tenant_id: 租户 ID
        ttl_seconds: 过期时间（秒）

    Returns:
        是否存储成功
    """
    r = _redis_manager.get_connection()
    if r is None:
        return False

    key = build_byname_key(billname, api_base_url, tenant_id)

    try:
        r.set(key, uri, ex=ttl_seconds)
        logger.debug(f"[REDIS] byname 索引写入: {billname} → {uri} (TTL={ttl_seconds}s)")
        return True
    except redis.RedisError as e:
        logger.warning(f"Redis byname 写入失败: {e}")
        return False
    except Exception as e:
        logger.warning(f"Redis byname 未知错误: {e}")
        return False


def get_cached_uri_by_billname_batch(
    billnames: list, api_base_url: str = None, tenant_id: str = None
) -> dict:
    """
    批量从 Redis 按业务对象名称获取 URI

    Args:
        billnames: 业务对象名称列表
        api_base_url: API 基础地址
        tenant_id: 租户 ID

    Returns:
        {billname: uri} 字典，只包含命中的项
    """
    r = _redis_manager.get_connection()
    if r is None or not billnames:
        return {}

    base_url = api_base_url or os.environ.get("API_BASE_URL", "https://v5devkk1.yonyoucloud.com")
    tid = tenant_id or os.environ.get("YONBIP_TENANT_ID", "ozciy868")

    keys = [f"byname:{base_url}/{tid}/{name}" for name in billnames]

    try:
        values = r.mget(keys)
        result = {}
        for name, value in zip(billnames, values):
            if value:
                result[name] = value
        if result:
            logger.info(f"[REDIS] byname 批量命中: {len(result)}/{len(billnames)}")
        return result
    except redis.RedisError as e:
        logger.warning(f"Redis byname 批量读取失败: {e}")
        return {}


# ============================================================
# 与 fetch_metadata.py 的集成接口
# ============================================================

def fetch_with_redis_cache(
    uri: str,
    fetch_api_func: callable,
    api_base_url: str = None,
    tenant_id: str = None,
    ttl_seconds: int = 86400
) -> Optional[dict]:
    """
    带 Redis 缓存的元数据获取

    流程:
    1. 先查 Redis 缓存
    2. 命中则直接返回
    3. 未命中则调用 fetch_api_func
    4. API 返回后存入 Redis
    5. 返回结果

    Args:
        uri: 元数据 URI
        fetch_api_func: 获取元数据的函数，签名为 func(uri) -> dict
        api_base_url: API 基础地址
        tenant_id: 租户 ID
        ttl_seconds: 缓存过期时间

    Returns:
        元数据字典，失败返回 None
    """
    # 1. 先查 Redis
    cached = get_cached_metadata(uri, api_base_url, tenant_id)
    if cached:
        parsed = parse_cached_metadata(cached)
        if parsed:
            return parsed

    # 2. Redis 未命中，调用 API
    logger.debug(f"Redis 缓存未命中，调用 API: {uri}")
    result = fetch_api_func(uri)

    # 3. API 返回成功则写入 Redis
    if result:
        json_str = json.dumps(result, ensure_ascii=False)
        set_cached_metadata(uri, json_str, api_base_url, tenant_id, ttl_seconds)

    return result

#!/usr/bin/env python3
"""
拉取 BIP 业务对象元数据 - 对齐 ReportSQLGenTool / BusinessObjectToolUtil
支持并行处理、URI 缓存、进度显示、配置验证

Database helpers: run scripts/db_query.py separately, or use --run-db-check.
"""

from __future__ import annotations

import argparse
import json
import hashlib
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# 确保 scripts 目录在 sys.path 中（支持直接执行脚本）
_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from iuap_common.utils import (
    ConfigValidationError,
    ExitCode,
    _text,
    _first_non_empty,
    get_progress_bar,
    load_dotenv,
    load_yaml,
    parse_doc_fields,
    resolve_config,
    safe_filename,
    validate_api_config,
)
from iuap_common.logging_config import get_logger, setup_logging

import iuap_common.bip_auth as bip_auth
from iuap_common.console_utf8 import configure_stdio_utf8
from metadata_parse import AttributeInfo, BizTableGroup, parse
from metadata_fast_lookup import MetadataFastLookup, get_fast_lookup
from iuap_common.paths_util import (
    SKILL_DIR,
    resolve_skill_path,
    resolve_workspace_path,
    workspace_base,
)

from parse_excel import parse_excel
from redis_cache import (
    init_redis_cache,
    is_redis_available,
    get_cached_metadata,
    get_cached_metadata_batch,
    set_cached_metadata,
    parse_cached_metadata,
    get_cache_stats,
    get_cached_uri_by_billname,
    set_cached_uri_by_billname,
)

# 【v6.0 新增】Entities 索引引擎
try:
    from entities_indexer import EntitiesIndex, get_entities_index, query_entity
    _ENTITIES_INDEX_AVAILABLE = True
except ImportError:
    EntitiesIndex = None
    get_entities_index = None
    query_entity = None
    _ENTITIES_INDEX_AVAILABLE = False

# 全局日志记录器（须在快速查找 try 之前，避免 ImportError 分支引用未定义 logger）
logger = get_logger("fetch_metadata")

# 全局 FastLookup 实例（进程内单例，避免重复加载 JSON）
_fast_lookup_instance: Optional[MetadataFastLookup] = None

# 【v6.0 新增】全局 entities 索引实例（进程内单例，延迟初始化）
_entities_index_instance: Optional[Any] = None


def _get_entities_index(cfg: dict) -> Optional[Any]:
    """
    获取或初始化全局 entities 索引实例

    索引在首次访问时从 output/entities.json 加载，
    后续所有 URI 查询均走 SQLite O(1) 索引，绕过文件 IO。
    """
    global _entities_index_instance
    if _entities_index_instance is None and _ENTITIES_INDEX_AVAILABLE:
        paths = cfg.get("paths") or {}
        out_dir = resolve_workspace_path(paths.get("output_dir", "output"), cfg)
        entities_json = out_dir / "entities.json"
        if entities_json.exists():
            _entities_index_instance = get_entities_index(str(entities_json))
            count = _entities_index_instance.load_from_json(str(entities_json))
            logger.info(f"Entities 索引已加载: {count} 个实体 ({entities_json})")
    return _entities_index_instance


# ============================================================
# 【性能优化 v6.0】进程内 JSON 对象缓存层
# 解决同一 URI 的 JSON 数据被多次 json.loads() 解析的问题
# 同时存储 JSON 字符串（用于 Redis/磁盘缓存）和已解析对象（避免重复解析）
# ============================================================

class _JsonObjectCache:
    """
    进程内 JSON 对象缓存 — 同时缓存 JSON 字符串和已解析对象。

    缓存策略：
    - 同一 URI 的数据只解析一次
    - 同时存储原始 JSON 字符串（用于返回给调用方）和已解析对象（用于内部处理）
    - 使用 LRU（最近最少使用）策略限制内存占用
    """

    def __init__(self, max_size: int = 5000):
        from collections import OrderedDict
        import threading
        self._lock = threading.Lock()
        # 使用 OrderedDict 实现 LRU：最新访问的放在末尾
        # {uri: {"json": str, "obj": Any}}
        self._cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._max_size = max_size
        self._hit_count = 0
        self._miss_count = 0

    def _touch(self, uri: str) -> None:
        """
        将 URI 标记为最近使用（移动到 OrderedDict 末尾）
        注意：调用方必须持有锁
        """
        if uri in self._cache:
            self._cache.move_to_end(uri)

    def get_json(self, uri: str) -> Optional[str]:
        """获取 JSON 字符串（已有则直接返回，无则返回 None）"""
        with self._lock:
            entry = self._cache.get(uri)
            if entry is not None:
                j = entry.get("json")
                if j is not None:
                    self._hit_count += 1
                    self._touch(uri)  # 标记为最近使用
                    return j
            self._miss_count += 1
            return None

    def get_obj(self, uri: str) -> Optional[Any]:
        """获取已解析的 JSON 对象"""
        with self._lock:
            entry = self._cache.get(uri)
            if entry is not None:
                obj = entry.get("obj")
                if obj is not None:
                    self._hit_count += 1
                    self._touch(uri)  # 标记为最近使用
                    return obj
            self._miss_count += 1
            return None

    def put_json(self, uri: str, json_str: str) -> None:
        """存入 JSON 字符串（已有对象则复用）"""
        with self._lock:
            entry = self._cache.get(uri)
            if entry is not None:
                # 已有对象，保持不变，只更新 json
                entry["json"] = json_str
            else:
                self._cache[uri] = {"json": json_str}
            self._touch(uri)  # 标记为最近使用
            self._maybe_evict()

    def put_obj(self, uri: str, obj: Any) -> None:
        """存入已解析的对象（已有 JSON 字符串则复用）"""
        with self._lock:
            entry = self._cache.get(uri)
            if entry is not None:
                # 已有 JSON，保持不变，只更新 obj
                entry["obj"] = obj
            else:
                self._cache[uri] = {"obj": obj}
            self._touch(uri)  # 标记为最近使用
            self._maybe_evict()

    def put_both(self, uri: str, json_str: str, obj: Any) -> None:
        """同时存入 JSON 字符串和已解析对象"""
        with self._lock:
            self._cache[uri] = {"json": json_str, "obj": obj}
            self._touch(uri)  # 标记为最近使用
            self._maybe_evict()

    def _maybe_evict(self) -> None:
        """容量超限时驱逐最旧的条目（真正的 LRU 策略）"""
        while len(self._cache) > self._max_size:
            # popitem(last=False) 移除并返回第一个（最旧的）条目
            self._cache.popitem(last=False)

    def get_stats(self) -> Dict[str, int]:
        """获取缓存统计"""
        with self._lock:
            total = self._hit_count + self._miss_count
            hit_rate = self._hit_count / total if total > 0 else 0.0
            return {
                "size": len(self._cache),
                "hit_count": self._hit_count,
                "miss_count": self._miss_count,
                "hit_rate": f"{hit_rate:.1%}",
            }


# 全局进程内对象缓存实例（URI 级别）
_uri_object_cache = _JsonObjectCache(max_size=5000)


def _get_fast_lookup(cfg: dict) -> MetadataFastLookup:
    """
    获取 FastLookup 实例（带配置感知的单例，自动尝试加载 JSON）。

    单例保护策略：
      - 首次加载失败后，若后续 config 变更（传入不同的 cfg），会重试加载
      - 仅当 _lookup_data 已成功加载时才复用（避免返回空实例）
      - 【v7.0 新增】索引过期时自动触发后台重建
    """
    global _fast_lookup_instance
    # 如果之前加载失败（_lookup_data 为 None），允许重试
    needs_reinit = (
        _fast_lookup_instance is None
        or (_fast_lookup_instance is not None and not _fast_lookup_instance.is_loaded)
    )
    if needs_reinit:
        _fast_lookup_instance = MetadataFastLookup()
        paths = (cfg.get("paths") or {}) if cfg else {}
        json_path = paths.get("metadata_lookup_json")
        loaded = False
        if json_path:
            # 相对路径基于 SKILL_DIR 解析，绝对路径直接使用
            json_p = Path(json_path).expanduser()
            if not json_p.is_absolute():
                p = SKILL_DIR / json_p
            else:
                p = json_p
            p = p.resolve()
            if p.exists():
                loaded = _fast_lookup_instance.load_lookup_json(str(p))
            else:
                logger.warning(
                    f"FastLookup JSON 不存在: {p}，将降级到慢速 API 搜索"
                )
        if not loaded:
            # 尝试默认路径
            skill_ref = SKILL_DIR / "reference" / "metadata_lookup.json"
            if skill_ref.exists():
                loaded = _fast_lookup_instance.load_lookup_json(str(skill_ref))
            if not loaded:
                logger.warning(
                    f"FastLookup JSON 加载失败，降级到慢速 API 搜索 "
                    f"(建议检查 reference/metadata_lookup.json 是否存在)"
                )
    else:
        # 【v7.0 新增】索引已加载，检查是否过期并自动触发后台重建
        if _fast_lookup_instance._is_index_expired():
            logger.info("FastLookup 索引已过期，触发后台异步重建...")
            # 传入重建函数（从默认路径重新加载）
            def _rebuild_func():
                skill_ref = SKILL_DIR / "reference" / "metadata_lookup.json"
                if skill_ref.exists():
                    return _fast_lookup_instance.load_lookup_json(str(skill_ref))
                return False

            _fast_lookup_instance.check_and_auto_rebuild(_rebuild_func)

    return _fast_lookup_instance


# 批量查询默认上限（可被 config.performance 覆盖）
MAX_CONCURRENT_REQUESTS_DEFAULT = 16  # queryByUri 并行度默认
MAX_BATCH_SIZE = 80  # 单批 URI 数量（仅分批，不降低并发）
MAX_REFERENCE_FIELDS_DEFAULT = 30  # 参照展开条数上限默认


def _perf(cfg: dict) -> dict:
    return cfg.get("performance") or {}


def _max_concurrent_uri(cfg: dict) -> int:
    return max(
        1, int(_perf(cfg).get("max_concurrent_query_by_uri", MAX_CONCURRENT_REQUESTS_DEFAULT))
    )


def _max_concurrent_bills(cfg: dict) -> int:
    return max(1, int(_perf(cfg).get("max_concurrent_bills", 6)))


def _max_concurrent_entities(cfg: dict) -> int:
    return max(1, int(_perf(cfg).get("max_concurrent_entities", 8)))


def _max_reference_fields(cfg: dict) -> int:
    v = _perf(cfg).get("max_reference_fields_expand")
    if v is None:
        return MAX_REFERENCE_FIELDS_DEFAULT
    return max(1, int(v))


# ============================================================
# 磁盘持久化缓存配置（从 config 读取后初始化）
# ============================================================

_disk_cache_enabled: bool = False
_disk_cache_dir: Path = SKILL_DIR / ".cache" / "fetch-metadata"
_disk_cache_ttl: int = 86400  # 默认 1 天过期（秒）
_disk_cache_max_entries: int = 2000  # 默认最大缓存条目

# 【v7.0 新增】Redis 批量写入缓冲（用于单条查询场景）
_redis_write_buffer: List[Tuple[str, str]] = []
_redis_write_buffer_lock = threading.Lock()
_redis_write_buffer_max_size: int = 50  # 默认值，将被 config 覆盖


def _init_performance_config(cfg: dict) -> None:
    """
    【v7.0 新增】从 config.yaml 初始化性能配置

    统一并发配置管理：所有并发参数集中到 config.yaml 的 performance 段
    """
    global _redis_write_buffer_max_size
    
    perf = _perf(cfg)
    _redis_write_buffer_max_size = max(10, int(perf.get("redis_write_buffer_size", 50)))
    
    # 更新 FastLookup 索引配置
    from metadata_fast_lookup import MetadataFastLookup
    MetadataFastLookup._INDEX_TTL_SECONDS = int(perf.get("fastlookup_index_ttl_seconds", 86400))
    MetadataFastLookup._MIN_REBUILD_INTERVAL = int(perf.get("fastlookup_min_rebuild_interval", 3600))
    
    logger.info(f"[CONFIG] 性能配置已加载: "
                f"redis_buffer={_redis_write_buffer_max_size}, "
                f"fastlookup_ttl={MetadataFastLookup._INDEX_TTL_SECONDS}s")


def _flush_redis_write_buffer() -> None:
    """
    【v7.0 新增】刷新 Redis 写入缓冲区（批量写入）

    线程安全：函数内部自行处理锁，无需调用方持有锁
    """
    global _redis_write_buffer
    
    # 先获取锁，复制并清空缓冲区，然后在锁外执行写入
    with _redis_write_buffer_lock:
        if not _redis_write_buffer:
            return
        # 复制数据并清空缓冲区（在锁内完成）
        buffer_copy = list(_redis_write_buffer)
        _redis_write_buffer = []
        count = len(buffer_copy)
    
    # 在锁外执行 Redis 写入，避免长时间持有锁
    try:
        from redis_cache import set_cached_metadata_batch
        set_cached_metadata_batch(buffer_copy)
        logger.debug(f"Redis 缓冲区已刷新: {count} 条")
    except Exception as e:
        logger.warning(f"Redis 缓冲区刷新失败: {e}")


def _buffer_redis_write(uri: str, json_str: str) -> None:
    """
    【v7.0 新增】缓冲 Redis 写入请求，达到阈值时批量刷新

    Args:
        uri: 元数据 URI
        json_str: JSON 字符串
    """
    with _redis_write_buffer_lock:
        _redis_write_buffer.append((uri, json_str))
        # 缓冲区满时自动刷新
        if len(_redis_write_buffer) >= _redis_write_buffer_max_size:
            # 注意：不要在持有锁时调用 _flush_redis_write_buffer()
            # 因为 _flush_redis_write_buffer() 会尝试获取同一把锁
            # 这里记录需要刷新，然后在锁外执行
            needs_flush = True
        else:
            needs_flush = False
    
    # 在锁外执行刷新，避免死锁
    if needs_flush:
        _flush_redis_write_buffer()


def _uri_to_cache_filename(uri: str) -> str:
    """将 URI 转换为安全的缓存文件名（SHA256 哈希前 16 字符）"""
    h = hashlib.sha256(uri.encode("utf-8")).hexdigest()[:16]
    return f"{h}.json"


def _get_disk_cache_path(uri: str) -> Path:
    """获取磁盘缓存文件路径"""
    return _disk_cache_dir / _uri_to_cache_filename(uri)


def _get_cached_uri_disk(uri: str) -> Optional[str]:
    """从磁盘缓存获取 URI 数据（检查 TTL）"""
    if not _disk_cache_enabled:
        return None
    p = _get_disk_cache_path(uri)
    if not p.exists():
        return None
    # 检查过期
    mtime = p.stat().st_mtime
    if time.time() - mtime > _disk_cache_ttl:
        logger.debug(f"Disk cache expired: {uri}")
        return None
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        logger.debug(f"Failed to read disk cache: {e}")
        return None


def _set_cached_uri_disk(uri: str, data: str) -> None:
    """
    写入 URI 数据到磁盘缓存。

    【优化】实际执行 max_entries 限制：
      - 超出容量时删除最老的 20% 条目（按 mtime 排序）
      - 避免磁盘缓存无限增长撑满磁盘
    """
    if not _disk_cache_enabled:
        return
    p = _get_disk_cache_path(uri)
    try:
        _disk_cache_dir.mkdir(parents=True, exist_ok=True)
        p.write_text(data, encoding="utf-8")
        logger.debug(f"Wrote disk cache: {uri}")

        # 【优化】磁盘缓存容量限制：超出 max_entries 时删除最老的 20%
        if _disk_cache_max_entries > 0:
            all_files = sorted(
                _disk_cache_dir.glob("*.json"),
                key=lambda f: f.stat().st_mtime,
            )
            if len(all_files) > _disk_cache_max_entries:
                evict_count = max(1, _disk_cache_max_entries // 5)
                for f in all_files[:evict_count]:
                    try:
                        f.unlink()
                    except OSError:
                        pass
                logger.debug(f"Evicted {evict_count} old disk cache entries")
    except Exception as e:
        logger.debug(f"Failed to write disk cache: {e}")


def _init_disk_cache(cfg: dict) -> None:
    """从配置初始化磁盘缓存"""
    global _disk_cache_enabled, _disk_cache_dir, _disk_cache_ttl, _disk_cache_max_entries
    cache_cfg = cfg.get("cache", {})
    _disk_cache_enabled = bool(cache_cfg.get("enabled", True))

    # 缓存目录：配置项 → 默认 SKILL_DIR/.cache/fetch-metadata
    cache_dir = str(cache_cfg.get("dir", ".cache/fetch-metadata")).strip()
    if cache_dir:
        p = Path(cache_dir)
        if not p.is_absolute():
            p = SKILL_DIR / p
        _disk_cache_dir = p.resolve()

    _disk_cache_ttl = int(cache_cfg.get("ttl_seconds", 86400))
    _disk_cache_max_entries = int(cache_cfg.get("max_entries", 2000))

    logger.debug(
        f"Disk cache initialized: enabled={_disk_cache_enabled}, dir={_disk_cache_dir}"
    )


def http_get_json(
    cfg: dict, path: str, extra_params: Optional[Dict[str, str]] = None
) -> Any:
    """见 bip_auth.http_get_json：先取 token（缓存+过期刷新），再带 access_token 请求。"""
    return bip_auth.http_get_json(cfg, path, extra_params)


def _get_cached_byname(billname: str) -> Optional[str]:
    """从缓存获取 searchByName 结果（仅 Redis）"""
    return get_cached_metadata(f"byname:{billname}")


def _set_cached_byname(billname: str, data: str) -> None:
    """缓存 searchByName 结果到 Redis"""
    set_cached_metadata(f"byname:{billname}", data)


def _get_cached_byboid(boid: str) -> Optional[str]:
    """从缓存获取 getEntityListByBOId 结果（仅 Redis）"""
    return get_cached_metadata(f"byboid:{boid}")


def _set_cached_byboid(boid: str, data: str) -> None:
    """缓存 getEntityListByBOId 结果到 Redis"""
    set_cached_metadata(f"byboid:{boid}", data)


def _get_cached_entityid(entity_id: str) -> Optional[str]:
    """从缓存获取 getEntityInfoByBOIdAndEntityId 结果（仅 Redis）"""
    return get_cached_metadata(f"entityid:{entity_id}")


def _set_cached_entityid(entity_id: str, data: str) -> None:
    """缓存 getEntityInfoByBOIdAndEntityId 结果到 Redis"""
    set_cached_metadata(f"entityid:{entity_id}", data)


def _query_by_uri_cached(cfg: dict, uri: str) -> str:
    """
    queryByUri 统一入口：进程内缓存 → Redis + 磁盘持久缓存 → 避免重复请求相同 URI。
    HTTP 层超时由 api.http_timeout_seconds 控制（见 bip_auth）。

    缓存层级（v7.0 优化）：
      1. 进程内对象缓存（_uri_object_cache）→ 零解析开销，快速路径
      2. Redis 缓存 → 跨进程共享（仅当进程内未命中时检查）
      3. 磁盘缓存 → 本地持久化
      4. 网络请求 → 存入 Redis + 磁盘 + 进程内缓存

    【v7.0 优化】进程内缓存命中时直接返回，跳过 Redis/磁盘检查，减少 ~15ms 开销。
    """
    # 【优化 v7.0】快速路径：进程内缓存命中时直接返回，跳过 Redis/磁盘检查
    cached_obj = _uri_object_cache.get_obj(uri)
    if cached_obj is not None:
        logger.debug(f"进程内对象缓存命中（快速路径）: {uri}")
        cached_json = _uri_object_cache.get_json(uri)
        if cached_json is not None:
            return cached_json
        return json.dumps(cached_obj, ensure_ascii=False)

    cached_json_str = _uri_object_cache.get_json(uri)
    if cached_json_str is not None:
        logger.debug(f"进程内 JSON 缓存命中（快速路径）: {uri}")
        try:
            obj = json.loads(cached_json_str)
            _uri_object_cache.put_both(uri, cached_json_str, obj)
        except json.JSONDecodeError:
            pass
        return cached_json_str

    # 【慢速路径】进程内未命中，继续检查 Redis/磁盘
    # 1. 检查 Redis 缓存（跨进程共享）
    redis_cached = get_cached_metadata(uri)
    if redis_cached:
        logger.info(f"[METADATA] Redis缓存命中: {uri}")
        try:
            obj = json.loads(redis_cached)
            _uri_object_cache.put_both(uri, redis_cached, obj)
        except json.JSONDecodeError:
            _uri_object_cache.put_json(uri, redis_cached)
        return redis_cached

    # 2. 检查磁盘缓存
    cached_disk = _get_cached_uri_disk(uri)
    if cached_disk:
        logger.info(f"[METADATA] 磁盘缓存命中: {uri}")
        set_cached_metadata(uri, cached_disk)
        try:
            obj = json.loads(cached_disk)
            _uri_object_cache.put_both(uri, cached_disk, obj)
        except json.JSONDecodeError:
            _uri_object_cache.put_json(uri, cached_disk)
        return cached_disk

    # 3. 网络请求
    api = cfg.get("api") or {}
    meta_uri_path = api.get("metadata_uri", "")
    logger.info(f"[METADATA] API请求: {uri}")
    j = http_get_json(cfg, meta_uri_path, {"uri": uri})
    s = json.dumps(j, ensure_ascii=False)

    # 存入缓存（磁盘 + 进程内 + 【v7.0 优化】缓冲写入 Redis）
    _set_cached_uri_disk(uri, s)
    _uri_object_cache.put_both(uri, s, j)
    _buffer_redis_write(uri, s)  # 【v7.0 优化】使用缓冲写入，减少 Redis 网络 RTT
    return s


def _query_by_uri_cached_parsed(cfg: dict, uri: str) -> Any:
    """
    queryByUri 并返回已解析的对象（v6.0 优化：复用进程内对象缓存）。

    注意：优先返回进程内缓存的对象，避免 json.loads() 重复解析。
    """
    # 【优化 v6.0】直接返回进程内缓存的对象（零解析）
    cached_obj = _uri_object_cache.get_obj(uri)
    if cached_obj is not None:
        return cached_obj

    # 兜底：走完整缓存链
    s = _query_by_uri_cached(cfg, uri)
    try:
        obj = json.loads(s)
        _uri_object_cache.put_obj(uri, obj)
        return obj
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse URI {uri}: {e}")
        raise


def _query_by_uri_batch(cfg: dict, uris: List[str]) -> Dict[str, Any]:
    """
    【v7.0 优化】批量查询 URI 并返回已解析的对象字典。

    性能优化：
    - 先批量检查 Redis mget，一次性获取多个 URI
    - 返回 {uri: obj} 字典，调用方直接使用无需 json.loads()
    - 自动处理缓存未命中的 URI
    - 【v7.0 新增】收集所有新获取的 URI，使用 Pipeline 批量写入 Redis
    """
    from redis_cache import set_cached_metadata_batch

    result: Dict[str, Any] = {}
    # 【v7.0 新增】收集需要写入 Redis 的 (uri, json_str) 对
    redis_write_buffer: List[Tuple[str, str]] = []

    # 1. 过滤出需要查询的 URI（不在进程内缓存的）
    uris_to_fetch: List[str] = []
    for uri in uris:
        cached_obj = _uri_object_cache.get_obj(uri)
        if cached_obj is not None:
            result[uri] = cached_obj
        else:
            uris_to_fetch.append(uri)

    if not uris_to_fetch:
        logger.debug(f"_query_by_uri_batch: 全部 {len(uris)} 个 URI 命中进程内缓存")
        return result

    # 2. 批量检查 Redis
    redis_batch = get_cached_metadata_batch(uris_to_fetch)
    for uri, json_str in redis_batch.items():
        try:
            obj = json.loads(json_str)
            result[uri] = obj
            _uri_object_cache.put_both(uri, json_str, obj)
            uris_to_fetch.remove(uri)
        except json.JSONDecodeError:
            _uri_object_cache.put_json(uri, json_str)

    if not uris_to_fetch:
        logger.info(f"[METADATA] 批量查询: Redis命中 {len(redis_batch)}/{len(uris)} 个 URI")
        return result

    # 3. 【优化 v7.0】未命中的 URI 使用 ThreadPoolExecutor 并发请求
    # 替代原有串行循环，充分利用网关并发能力
    if uris_to_fetch:
        max_workers = _max_concurrent_uri(cfg)
        logger.info(f"[METADATA] 并发查询 {len(uris_to_fetch)} 个 URI (并发度={max_workers})")

        # 【v7.0 新增】线程安全的写入缓冲区
        buffer_lock = threading.Lock()

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_uri = {
                executor.submit(_query_by_uri_cached, cfg, uri): uri
                for uri in uris_to_fetch
            }

            for future in as_completed(future_to_uri):
                uri = future_to_uri[future]
                try:
                    s = future.result()
                    try:
                        obj = json.loads(s)
                        result[uri] = obj
                        # 【v7.0 新增】收集到写入缓冲区
                        with buffer_lock:
                            redis_write_buffer.append((uri, s))
                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse URI {uri}: {e}")
                except Exception as e:
                    logger.error(f"URI query failed: {uri} - {e}")

    # 4. 【v7.0 新增】批量写入 Redis（使用 Pipeline）
    if redis_write_buffer:
        logger.info(f"[METADATA] 批量写入 Redis: {len(redis_write_buffer)} 条")
        try:
            set_cached_metadata_batch(redis_write_buffer)
        except Exception as e:
            logger.warning(f"Redis 批量写入失败: {e}")

    return result


def fetch_entity_db_info_with_timeout(cfg: dict, uri: str) -> Optional[str]:
    """
    批量路径使用的 queryByUri（失败返回 None）
    超时由 api.http_timeout_seconds 控制。
    """
    try:
        return _query_by_uri_cached(cfg, uri)
    except Exception as e:
        logger.error(f"获取实体信息失败 [uri={uri}]: {e}")
        return None


def fetch_entity_db_info_batch(
    cfg: dict, uris: Set[str]
) -> Dict[str, Any]:
    """
    【v6.0 优化】批量获取实体数据库信息，返回已解析的对象字典。

    性能优化：
    - 使用 _query_by_uri_batch 直接返回 {uri: obj} 字典
    - 调用方直接使用对象，无需 json.loads()
    - 自动处理 Redis mget 批量查询
    """
    if not uris:
        return {}

    # 【v6.0 优化】直接使用批量查询接口，返回已解析的对象
    result = _query_by_uri_batch(cfg, list(uris))

    logger.info(f"批量查询完成: 获取 {len(result)}/{len(uris)} 个实体对象")
    return result


def fetch_entity_db_info_with_timeout(cfg: dict, uri: str) -> Optional[Any]:
    """
    【保留】单个 URI 查询，返回已解析的对象。
    优先使用 _query_by_uri_cached_parsed 或 _query_by_uri_batch。
    """
    return _query_by_uri_cached_parsed(cfg, uri)


@dataclass
class CodeNameResult:
    """业务对象编码和名称解析结果"""
    code: Optional[str] = None
    name: Optional[str] = None
    id: Optional[str] = None
    available_names: Optional[List[str]] = None
    available_items: Optional[List[Dict[str, Optional[str]]]] = None
    not_found: bool = False
    not_found_reason: Optional[str] = None

    def needs_selection(self) -> bool:
        return bool(self.available_items and len(self.available_items) > 1)


def parse_business_object_code_name(result: Any, billname: str) -> Optional[CodeNameResult]:
    """解析业务对象响应，提取编码和名称"""
    if not isinstance(result, dict):
        return None
    code_val = _text(result, "code") or _text(result, "resultCode")
    if code_val != "200":
        return None
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return None
    target_nodes: List[dict] = []
    inner_data_array = data_node.get("data")
    if isinstance(inner_data_array, list):
        for item in inner_data_array:
            if isinstance(item, dict):
                target_nodes.append(item)
    nodes_with_parent: List[Tuple[dict, Optional[str]]] = []
    if not target_nodes:
        bo_array = data_node.get("METACLASS")
        if isinstance(bo_array, list):
            for bo in bo_array:
                if not isinstance(bo, dict):
                    continue
                parent_code = _text(bo, "code")
                children = bo.get("children")
                if isinstance(children, list):
                    for child in children:
                        if isinstance(child, dict):
                            nodes_with_parent.append((child, parent_code))
    search_name = (billname or "").strip()

    def _dedupe_by_code(
        items: List[Dict[str, Optional[str]]]
    ) -> List[Dict[str, Optional[str]]]:
        seen: Set[str] = set()
        out: List[Dict[str, Optional[str]]] = []
        for it in items:
            c = (it.get("code") or "").strip()
            if not c or c in seen:
                continue
            seen.add(c)
            out.append(it)
        return out

    exact_tn: List[Dict[str, Optional[str]]] = []
    for node in target_nodes:
        name = _text(node, "name")
        if name == search_name:
            code = _text(node, "code")
            id_ = _text(node, "id")
            if code and code != "null":
                exact_tn.append({"code": code, "name": name, "id": id_})
    exact_tn = _dedupe_by_code(exact_tn)
    if len(exact_tn) == 1:
        o = exact_tn[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"))
    if len(exact_tn) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in exact_tn]
        return CodeNameResult(available_names=names, available_items=exact_tn)

    # 检查是否为空数据（查无此单据）
    if not target_nodes and not nodes_with_parent:
        logger.warning(
            f"searchByName 返回空数据，未找到业务对象: billname={search_name}，"
            f"请检查单据名称是否正确，或该单据是否已发布到 BIP 平台"
        )
        r = CodeNameResult()
        r.not_found = True
        r.not_found_reason = (
            f"searchByName 返回空数据，未找到名为 [{search_name}] 的业务对象。"
            f"请确认：（1）单据名称正确；（2）该单据已在 BIP 平台发布"
        )
        return r

    exact_wp: List[Dict[str, Optional[str]]] = []
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        if name == search_name and parent_code and parent_code != "null":
            exact_wp.append(
                {"code": parent_code, "name": name, "id": _text(node, "id")}
            )
    exact_wp = _dedupe_by_code(exact_wp)
    if len(exact_wp) == 1:
        o = exact_wp[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"))
    if len(exact_wp) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in exact_wp]
        return CodeNameResult(available_names=names, available_items=exact_wp)

    sub_tn: List[Dict[str, Optional[str]]] = []
    for node in target_nodes:
        name = _text(node, "name")
        if name and search_name in name:
            code = _text(node, "code")
            id_ = _text(node, "id")
            if code and code != "null":
                sub_tn.append({"code": code, "name": name, "id": id_})
    sub_tn = _dedupe_by_code(sub_tn)
    if len(sub_tn) == 1:
        o = sub_tn[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"))
    if len(sub_tn) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in sub_tn]
        return CodeNameResult(available_names=names, available_items=sub_tn)

    sub_wp: List[Dict[str, Optional[str]]] = []
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        if name and search_name in name and parent_code and parent_code != "null":
            sub_wp.append(
                {"code": parent_code, "name": name, "id": _text(node, "id")}
            )
    sub_wp = _dedupe_by_code(sub_wp)
    if len(sub_wp) == 1:
        o = sub_wp[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"))
    if len(sub_wp) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in sub_wp]
        return CodeNameResult(available_names=names, available_items=sub_wp)

    # 收集所有候选业务对象及其完整信息（code、name、id）
    all_items: List[Dict[str, Optional[str]]] = []
    seen_codes: Set[str] = set()
    for node in target_nodes:
        name = _text(node, "name")
        code = _text(node, "code")
        if name and code and code != "null" and code not in seen_codes:
            all_items.append({"code": code, "name": name, "id": _text(node, "id")})
            seen_codes.add(code)
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        if name and parent_code and parent_code != "null" and parent_code not in seen_codes:
            all_items.append({"code": parent_code, "name": name, "id": _text(node, "id")})
            seen_codes.add(parent_code)

    if len(all_items) == 1:
        # 只有一个候选，直接使用
        item = all_items[0]
        return CodeNameResult(code=item["code"], name=item["name"], id=item["id"])
    elif len(all_items) > 1:
        # 多个候选，返回完整信息供选择
        all_names = [item["name"] for item in all_items]
        return CodeNameResult(available_names=all_names, available_items=all_items)
    return None


def collect_entity_details(result: Any) -> List[Dict[str, Optional[str]]]:
    """从业务对象响应中收集实体详情列表"""
    if not isinstance(result, dict):
        return []
    code_val = _text(result, "code") or _text(result, "resultCode")
    if code_val != "200":
        return []
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return []
    entities_node = data_node.get("entities")
    if not isinstance(entities_node, list):
        inner = data_node.get("data")
        if isinstance(inner, dict):
            entities_node = inner.get("entities")
    if not isinstance(entities_node, list):
        return []

    out: List[Dict[str, Optional[str]]] = []

    def walk(arr: List[Any]) -> None:
        for entity in arr:
            if not isinstance(entity, dict):
                continue
            eid = _text(entity, "id")
            if eid == "null":
                eid = None
            out.append(
                {
                    "entityId": eid,
                    "uri": _text(entity, "uri"),
                    "boId": _text(entity, "businessObjectId"),
                    "businessObjectCode": _text(entity, "businessObjectCode"),
                }
            )
            ch = entity.get("children")
            if isinstance(ch, list):
                walk(ch)

    walk(entities_node)
    return out


def parse_entity_model_for_ai(result: Any) -> Optional[Dict[str, Any]]:
    """解析实体模型供 AI 使用"""
    if not isinstance(result, dict):
        return None
    code_val = _text(result, "code") or _text(result, "resultCode")
    if code_val != "200":
        return None
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return None
    inner = data_node.get("data")
    if isinstance(inner, dict):
        data_node = inner
    domain = _text(data_node, "domain")
    schema = _text(data_node, "schema")
    if (not schema or not str(schema).strip()) and domain and domain.startswith("c-"):
        schema = domain.replace("-", "_") + "_db"
    model: Dict[str, Any] = {
        "uri": _text(data_node, "uri"),
        "tableName": _text(data_node, "tableName"),
        "businessObjectCode": _text(data_node, "businessObjectCode"),
        "domain": domain,
        "schema": schema,
        "businessProperties": [],
    }
    bp_array = data_node.get("businessProperties")
    if isinstance(bp_array, list):
        for bp in bp_array:
            if not isinstance(bp, dict):
                continue
            all_tables = bp.get("allTables")
            tbl = None
            if isinstance(all_tables, list) and all_tables:
                t0 = all_tables[0]
                if isinstance(t0, str):
                    tbl = t0
            summary = {
                "name": _text(bp, "name"),
                "displayName": _text(bp, "displayName"),
                "uri": _text(bp, "uri"),
                "tableName": tbl,
            }
            model["businessProperties"].append(summary)
            cfs = bp.get("characterFields")
            if isinstance(cfs, list):
                for cf in cfs:
                    if not isinstance(cf, dict):
                        continue
                    c_all = cf.get("allTables")
                    ctbl = None
                    if isinstance(c_all, list) and c_all and isinstance(c_all[0], str):
                        ctbl = c_all[0]
                    model["businessProperties"].append(
                        {
                            "name": _text(cf, "name"),
                            "displayName": _text(cf, "displayName"),
                            "uri": _text(cf, "uri"),
                            "tableName": ctbl,
                        }
                    )
    return model


def parse_foreign_keys_util(
    entity_db: Any, _entity_uri: Optional[str]
) -> List[Dict[str, Any]]:
    """解析外键关联"""
    if not isinstance(entity_db, dict):
        return []
    code_val = _text(entity_db, "code") or _text(entity_db, "resultCode")
    if code_val != "200":
        return []
    data_node = entity_db.get("data")
    if not isinstance(data_node, dict):
        return []
    inner = data_node.get("data")
    if isinstance(inner, dict):
        data_node = inner
    assoc = data_node.get("associationAttributes")
    if not isinstance(assoc, list):
        return []
    fks: List[Dict[str, Any]] = []
    for attr in assoc:
        if not isinstance(attr, dict):
            continue
        biztype = str(attr.get("biztype", "")).replace('"', "")
        if biztype != "quote":
            continue
        col = attr.get("columnName")
        type_uri = attr.get("typeUri")
        col_s = str(col).replace('"', "") if col is not None else None
        uri_s = str(type_uri).replace('"', "") if type_uri is not None else None
        if col_s and uri_s:
            fks.append({"columnName": col_s, "refUri": uri_s})
    return fks


def load_scheme_map(path: Path) -> List[Dict[str, Any]]:
    """加载领域 schema 映射表"""
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def scheme_by_domain(
    scheme_list: List[Dict[str, Any]], domain: Optional[str]
) -> Optional[str]:
    """根据领域获取对应的 schema"""
    if not domain or not str(domain).strip():
        return None
    target_key = "mdd_schema." + domain.strip()
    for scheme in scheme_list:
        if not isinstance(scheme, dict):
            continue
        key = scheme.get("key")
        if key == target_key:
            ex = scheme.get("exclusiveValue")
            if ex and str(ex).strip():
                return str(ex).strip()
            val = scheme.get("value")
            return str(val).strip() if val else None
    return None


def attr_to_map(attr: AttributeInfo) -> Dict[str, Any]:
    """将 AttributeInfo 转换为字典"""
    m: Dict[str, Any] = {
        "displayName": attr.display_name,
        "dbColumnName": attr.db_column_name,
        "type": attr.type,
        "name": attr.name,
        "tableName": attr.table_name,
    }
    if attr.uri:
        m["uri"] = attr.uri
    if attr.enums:
        m["enums"] = [{"code": e.code, "name": e.name} for e in attr.enums]
    return m


# ============================================================
# 语义匹配：Excel 列头 ↔ 元数据字段
# ============================================================

# 常用同义词映射（中文 → 中文/英文别名）
_SYNONYM_MAP: Dict[str, Set[str]] = {
    # 客户相关
    "客户": {"customer", "客户名称", "customerName", "客户名称", "customer_name"},
    "客户名称": {"客户", "customer", "customerName", "customer_name"},
    "customer": {"客户", "客户名称", "customerName", "customer_name"},
    "customerName": {"客户", "客户名称", "customer", "customer_name"},
    # 供应商相关
    "供应商": {"supplier", "供应商名称", "supplierName", "supplier_name", "vendor"},
    "供应商名称": {"供应商", "supplier", "supplierName", "supplier_name", "vendor"},
    "supplier": {"供应商", "供应商名称", "supplierName", "supplier_name", "vendor"},
    "vendor": {"供应商", "供应商名称", "supplier", "supplierName"},
    # 物料/产品相关
    "物料": {"material", "product", "物料名称", "产品", "item", "materialName", "productName", "itemName"},
    "物料名称": {"物料", "material", "product", "产品", "item", "materialName", "productName"},
    "产品": {"物料", "material", "product", "物料名称", "item", "materialName", "productName"},
    "product": {"物料", "material", "product", "物料名称", "产品", "item", "materialName", "productName"},
    "item": {"物料", "material", "product", "产品", "物料名称", "itemName"},
    # 单据相关
    "单据编号": {"单据号", "单号", "单据号", "单据编码", "单据code", "单据Code", "单号", "单据号码"},
    "单号": {"单据编号", "单据号", "单据编码", "单据code", "单据Code", "单据号码"},
    "单据日期": {"单据时间", "单据创建日期", "制单日期", "制单时间", "单据生成日期", "业务日期", "业务时间"},
    "制单日期": {"单据日期", "单据时间", "制单时间", "单据生成日期", "业务日期", "业务时间"},
    # 金额相关
    "金额": {"amount", "sum", "总价", "总金额", "金额", "金额合计", "本币金额", "原币金额", "金额不含税"},
    "数量": {"qty", "quantity", "num", "count", "count", "件数", "数量", "num"},
    "单价": {"price", "unitPrice", "unit_price", "单价", "含税单价", "不含税单价", "报价"},
    "price": {"单价", "unitPrice", "unit_price", "含税单价", "不含税单价", "报价"},
    # 组织相关
    "部门": {"department", "dept", "组织", "部门名称", "departmentName", "deptName"},
    "组织": {"org", "organization", "组织名称", "department", "部门", "orgName", "organizationName"},
    "部门名称": {"部门", "department", "dept", "组织", "departmentName", "deptName"},
    # 仓库相关
    "仓库": {"warehouse", "stock", "仓库名称", "warehouseName", "warehouse_name", "stockName"},
    "warehouse": {"仓库", "stock", "仓库名称", "warehouseName", "warehouse_name"},
    # 人员相关
    "人员": {"person", "员工", "职员", "employee", "user", "操作员", "制单人"},
    "制单人": {"人员", "person", "员工", "职员", "employee", "user", "操作员", "制单人", "maker"},
    # 业务相关
    "业务日期": {"单据日期", "单据时间", "单据创建日期", "制单日期", "制单时间", "单据生成日期", "业务时间"},
    "审核日期": {"审批日期", "审批时间", "审核时间", "批准日期", "审批完成日期"},
    "生效日期": {"生效时间", "启用日期", "生效", "effectiveDate"},
    "失效日期": {"失效时间", "停用日期", "失效", "expireDate", "endDate"},
}


def _normalize_text(text: str) -> str:
    """规范化文本：去除空格、特殊字符，转小写"""
    if not text:
        return ""
    # 去除空白字符、转小写
    normalized = "".join(text.split()).lower()
    return normalized


def _is_semantic_match(excel_col: str, meta_field: str) -> bool:
    """
    判断 Excel 列名与元数据字段是否语义匹配

    匹配规则（按优先级）：
    1. 规范化后精确相等
    2. 互为子串（单向或双向包含）
    3. 互为同义词
    """
    if not excel_col or not meta_field:
        return False

    # 规则1：规范化后精确相等
    excel_norm = _normalize_text(excel_col)
    meta_norm = _normalize_text(meta_field)
    if excel_norm == meta_norm:
        return True

    # 规则2：互为子串
    if excel_norm in meta_norm or meta_norm in excel_norm:
        return True

    # 规则3：同义词匹配
    excel_lower = excel_col.lower()
    meta_lower = meta_field.lower()

    # 检查 excel_col 是否在同义词表中
    if excel_lower in _SYNONYM_MAP:
        synonyms = _SYNONYM_MAP[excel_lower]
        if meta_lower in synonyms or meta_norm in {_normalize_text(s) for s in synonyms}:
            return True

    # 检查 meta_field 是否在同义词表中
    if meta_lower in _SYNONYM_MAP:
        synonyms = _SYNONYM_MAP[meta_lower]
        if excel_lower in synonyms or excel_norm in {_normalize_text(s) for s in synonyms}:
            return True

    return False


def _semantic_match_doc_fields(
    excel_cols: List[str], group: BizTableGroup
) -> Tuple[List[str], List[str]]:
    """
    将 Excel 列头与元数据字段进行语义匹配

    返回: (matched_doc_fields, matched_attr_names)
      - matched_doc_fields: 与元数据字段语义匹配的 Excel 列名
      - matched_attr_names: 匹配上的元数据字段的 display_name 列表
    """
    if not excel_cols or not group.attributes:
        return [], []

    matched_doc_fields: List[str] = []
    matched_attr_names: List[str] = []

    # 构建元数据字段映射（name → display_name，用于同义词匹配）
    attr_map: Dict[str, str] = {}  # name → display_name
    for attr in group.attributes:
        name = (attr.name or "").strip()
        display = (attr.display_name or "").strip()
        if name and display:
            attr_map[name.lower()] = display
            attr_map[display.lower()] = display

    for col in excel_cols:
        col = col.strip()
        if not col:
            continue

        col_norm = _normalize_text(col)

        # 遍历元数据字段，找语义匹配
        for attr in group.attributes:
            meta_name = (attr.name or "").strip()
            meta_display = (attr.display_name or "").strip()

            # 尝试匹配 display_name
            if meta_display and _is_semantic_match(col, meta_display):
                if col not in matched_doc_fields:
                    matched_doc_fields.append(col)
                if meta_display not in matched_attr_names:
                    matched_attr_names.append(meta_display)
                continue

            # 尝试匹配 name（作为备选）
            if meta_name and _is_semantic_match(col, meta_name):
                if col not in matched_doc_fields:
                    matched_doc_fields.append(col)
                # 优先使用 display_name
                matched_name = meta_display if meta_display else meta_name
                if matched_name not in matched_attr_names:
                    matched_attr_names.append(matched_name)
                continue

    return matched_doc_fields, matched_attr_names


# ============================================================
# V2 新增：Excel 业务对象解析与智能匹配
# ============================================================

def parse_business_objects_from_excel(excel_result: Dict[str, Any]) -> Tuple[List[str], Dict[str, List[str]]]:
    """
    从 Excel 解析业务对象

    规则：
    - 优先使用 billObjects（含关系描述的列表，更干净）
    - 支持 "主表.子表" 格式，自动拆分为独立的业务对象
    - 拆分后去重返回

    返回: (bill_names, bill_mappings)
      - bill_names: 独立业务对象名称列表
      - bill_mappings: 每行报表对应的业务对象映射
    """
    data_source = excel_result.get("dataSource") or {}
    bill_objects = data_source.get("billObjects", [])  # 含关系的业务对象列表
    bill_names = data_source.get("billNames", [])
    raw_mappings = data_source.get("rawMappings", [])

    # 拆分后的独立业务对象列表
    all_bill_names: List[str] = []
    bill_mappings: Dict[str, List[str]] = {}  # report_no → bill_names

    # 优先使用 billObjects（更干净）
    if bill_objects:
        for bo in bill_objects:
            bn = bo.get("billName", "").strip()
            if bn and bn not in all_bill_names:
                all_bill_names.append(bn)
        logger.info(f"从 billObjects 提取到 {len(all_bill_names)} 个业务对象: {all_bill_names}")
    else:
        # 降级：解析 billNames（可能含脏数据）
        for bill_name in bill_names:
            if "." in bill_name:
                # 格式：材料出库单主表.材料出库单子表 → 拆分为两个独立业务对象
                parts = bill_name.split(".", 1)
                for part in parts:
                    part = part.strip()
                    if part and part not in all_bill_names:
                        all_bill_names.append(part)
            else:
                # 单个业务对象名称
                if bill_name.strip() and bill_name.strip() not in all_bill_names:
                    all_bill_names.append(bill_name.strip())

    # 从 raw_mappings 提取报表与业务对象的映射
    for mapping in raw_mappings:
        report_no = mapping.get("reportNo", "")
        bill_list = mapping.get("billNames", [])
        if report_no and bill_list:
            # 拆分映射中的业务对象
            split_bills = []
            for bn in bill_list:
                if "." in bn:
                    for part in bn.split("."):
                        part = part.strip()
                        if part and part not in split_bills:
                            split_bills.append(part)
                else:
                    if bn.strip() and bn.strip() not in split_bills:
                        split_bills.append(bn.strip())
            bill_mappings[report_no] = split_bills

    logger.info(f"解析到 {len(all_bill_names)} 个业务对象: {all_bill_names}")
    logger.info(f"报表映射: {len(bill_mappings)} 条")

    return all_bill_names, bill_mappings


def filter_excel_headers(excel_result: Dict[str, Any]) -> List[str]:
    """
    从 Excel 结果中提取列头字段（排除描述性列头）

    优先级：
    1. allCells[1]（第2行，真正的列头）
    2. columns（可能只有分组标题）

    排除词列表：
    - 序号、编号、报表编号、报表名称
    - 难度等级、场景说明、技能要求
    - 备注、内容、分类、类型
    - 单据名称、业务对象名称
    """
    exclude_cols = {
        "序号", "编号", "报表编号", "报表", "报表名称", "名称",
        "难度等级", "难度名称", "难度", "等级",
        "场景说明", "说明", "描述",
        "技能要求", "要求", "能力",
        "报表数量", "数量", "统计",
        "备注", "内容", "分类", "类型",
        "核心业务对象", "业务对象", "数据源",
        "单据名称", "业务对象名称", "报表对象",
        "单据", "实体", "来源单据",
        "数据源字段", "数据源(业务对象)", "来源业务对象",
        "来源", "业务对象来源",
        "查询条件", "关系描述", "使用到的业务对象",
    }

    # 尝试从 allCells[1] 获取真正的列头
    all_cells = excel_result.get("allCells", [])
    headers = []

    if len(all_cells) >= 2:
        # 使用第2行（真正的列头）
        row1 = all_cells[1]
        headers = [c.strip() for c in row1 if c.strip()]
    else:
        # 降级使用 columns
        headers = [c.strip() for c in excel_result.get("columns", []) if c.strip()]

    filtered = []
    for h in headers:
        if h and h not in exclude_cols:
            # 排除纯数字和短符号
            if len(h) >= 2 and not h.isdigit():
                filtered.append(h)

    return filtered


def _extract_field_keywords(field: str) -> Set[str]:
    """提取字段关键词"""
    if not field:
        return set()
    keywords = set(re.findall(r'[一-鿿]+', field))
    # 移除常见词
    stop_words = {"的", "和", "与", "或", "以及", "包括"}
    return keywords - stop_words


def _expand_reference_field(
    cfg: dict,
    ref_uri: str,
    target_field: str,
    max_depth: int = 3,
    current_depth: int = 0
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    递归展开参照属性 URI

    返回: (匹配的属性信息, 参照实体数据)
    """
    if current_depth >= max_depth:
        logger.warning(f"达到最大递归深度 {max_depth}，停止展开 {ref_uri}")
        return None, None

    # 获取参照实体数据
    ref_data = _query_by_uri_cached_parsed(cfg, ref_uri)
    if not ref_data:
        logger.warning(f"无法获取参照实体: {ref_uri}")
        return None, None

    # 解析实体
    def fetch_uri(u: str) -> str:
        return _query_by_uri_cached(cfg, u)

    groups = parse(ref_data, fetch_uri_json=fetch_uri)
    if not groups:
        return None, None

    ref_group = groups[0]

    # 在参照实体的属性中查找目标字段
    target_norm = _normalize_text(target_field)

    for attr in ref_group.attributes:
        dn = attr.display_name or ""
        name = attr.name or ""

        # 精确匹配
        if _normalize_text(dn) == target_norm or _normalize_text(name) == target_norm:
            return {
                "displayName": dn,
                "dbColumnName": attr.db_column_name,
                "type": attr.type,
                "name": name,
                "uri": attr.uri,
            }, {"uri": ref_uri, "billName": ref_group.bill_name, "tableName": ref_group.table_name}

        # 语义匹配
        if _is_semantic_match(target_field, dn):
            return {
                "displayName": dn,
                "dbColumnName": attr.db_column_name,
                "type": attr.type,
                "name": name,
                "uri": attr.uri,
            }, {"uri": ref_uri, "billName": ref_group.bill_name, "tableName": ref_group.table_name}

    # 如果没找到，检查是否是参照属性（需要继续展开）
    for attr in ref_group.attributes:
        if attr.uri and attr.uri != ref_uri:
            # 检查 name/code 等常见字段
            dn = attr.display_name or ""
            if "name" in dn.lower() or "code" in dn.lower() or "编码" in dn or "名称" in dn:
                # 递归展开
                sub_attr, sub_entity = _expand_reference_field(
                    cfg, attr.uri, target_field, max_depth, current_depth + 1
                )
                if sub_attr:
                    return sub_attr, {"uri": ref_uri, "billName": ref_group.bill_name, "tableName": ref_group.table_name}

    return None, None


def expand_all_reference_fields(
    cfg: dict,
    field_matches: List[Tuple[str, str, Optional[str]]],  # (excel_field, source_bill, ref_uri)
    max_depth: int = 3
) -> List[Dict[str, Any]]:
    """
    展开所有需要递归查询的参照字段

    Args:
        field_matches: [(excel_field, source_bill, ref_uri), ...]
        cfg: 配置字典
        max_depth: 最大递归深度

    Returns:
        展开后的字段匹配列表
    """
    expanded: List[Dict[str, Any]] = []

    for excel_field, source_bill, ref_uri in field_matches:
        if ref_uri:
            # 需要展开
            logger.info(f"展开参照: {ref_uri} → 查找 '{excel_field}'")

            final_attr, ref_entity_info = _expand_reference_field(
                cfg, ref_uri, excel_field, max_depth
            )

            if final_attr:
                logger.info(f"  找到: {final_attr.get('displayName')} ({final_attr.get('dbColumnName')})")
                expanded.append({
                    "excelField": excel_field,
                    "sourceBill": source_bill,
                    "displayName": final_attr.get("displayName"),
                    "dbColumnName": final_attr.get("dbColumnName"),
                    "type": final_attr.get("type"),
                    "refUri": ref_uri,
                    "refEntity": ref_entity_info,
                    "expanded": True,
                })
            else:
                logger.warning(f"  未找到匹配字段: {excel_field}")
                expanded.append({
                    "excelField": excel_field,
                    "sourceBill": source_bill,
                    "refUri": ref_uri,
                    "expanded": False,
                })
        else:
            # 不需要展开，直接使用
            expanded.append({
                "excelField": excel_field,
                "sourceBill": source_bill,
                "expanded": False,
            })

    return expanded


# ============================================================
# 【v7.0 新增】从自然语言请求文本提取字段名
# ============================================================

def _extract_fields_from_request_text(request_text: str) -> List[str]:
    """
    【v7.0 新增】从自然语言请求文本中提取字段名模式。

    提取规则：
    1. 中文字段名：2-10个汉字（如"单据编号、客户名称"）
    2. 带"的"字字段：如"单据的编号" → 提取"编号"
    3. 英文/拼音字段名：2-20个字母数字组合（如 materialCode）
    4. 排除常见语气词和无关词

    这样做的好处：当用户没有传 --excel-file 时，
    AI Agent 可以把原始请求文本传进来，自动提取字段并过滤元数据。
    """
    if not request_text:
        return []
    import re
    # 排除词列表（常见语气词、疑问词、动词）
    stop_words = {
        "的", "和", "与", "或", "以及", "包括", "包含",
        "以及", "生成", "报表", "查询", "获取", "拉取",
        "帮我", "请", "需要", "只要", "只要", "只要",
        "字段", "信息", "数据", "列表", "单据", "业务",
        "哪些", "什么", "怎么", "如何", "是否", "能不能",
        "提供", "一下", "给我", "可以", "主要", "关键",
        "详细", "全部", "所有", "全量", "完整",
        "这个", "那个", "这些", "那些", "此类",
        "根据", "按照", "通过", "基于",
        "一个", "几个", "若干", "某些", "某个",
        "比如", "例如", "例如说", "比如说",
        "还有", "另外", "此外", "并且", "同时",
        "然后", "接着", "再", "又",
        "之后", "之前", "期间", "以内", "之外",
    }
    # 1. 提取纯中文字段名（2-10个连续汉字）
    chinese_pattern = re.findall(r'[\u4e00-\u9fff]{2,10}', request_text)
    fields = []
    for chunk in chinese_pattern:
        # 排除包含排除词的
        if any(sw in chunk for sw in stop_words):
            continue
        # 排除全是"的"的
        if chunk.strip('的') == '':
            continue
        fields.append(chunk)
    # 2. 提取英文/拼音字段名（驼峰或下划线）
    english_pattern = re.findall(r'[a-zA-Z][a-zA-Z0-9_]{1,30}', request_text)
    fields.extend(english_pattern)
    # 3. 去重，保持顺序
    seen = set()
    unique = []
    for f in fields:
        fl = f.lower()
        if fl not in seen:
            seen.add(fl)
            unique.append(f)
    logger.debug(f"从请求文本提取字段: {unique}")
    return unique


# ============================================================
# V2 新增：多实体智能匹配
# ============================================================

@dataclass
class V2FieldMatch:
    """字段匹配结果（V2版）"""
    excel_field: str           # Excel 中的原始字段名
    display_name: str          # 匹配的 display_name
    source: str                # 来源：direct / reference
    source_bill: str = ""      # 来源业务对象名称
    ref_attr: Optional[AttributeInfo] = None  # 对应的属性信息
    ref_entity: Optional[str] = None  # 关联实体 URI（如果有）
    final_attr: Optional[Dict[str, Any]] = None  # 最终匹配的属性（递归展开后）
    is_ambiguous: bool = False  # 是否存在歧义（多业务对象都有）


def _infer_needed_reference_fields_multi(
    excel_fields: List[str],
    entity_groups: List[BizTableGroup]
) -> List[V2FieldMatch]:
    """
    AI 推理：匹配 Excel 字段与多个实体的属性

    逻辑：
    1. 遍历 Excel 字段，在所有业务对象中找匹配的属性
    2. 如果多个业务对象都有相似字段，生成歧义标记
    3. 如果字段匹配到参照属性，记录下来待展开
    """
    matches: List[V2FieldMatch] = []

    for excel_field in excel_fields:
        excel_field_stripped = excel_field.strip()
        if not excel_field_stripped:
            continue

        matched_in_bills: List[Tuple[str, AttributeInfo]] = []  # [(bill_name, attr)]

        # 在所有业务对象中搜索匹配
        for group in entity_groups:
            bill_name = group.bill_name or ""

            # 精确匹配
            for attr in group.attributes:
                dn = attr.display_name or ""
                if _normalize_text(dn) == _normalize_text(excel_field_stripped):
                    matched_in_bills.append((bill_name, attr))
                    break

            # 语义匹配
            if not any(bn == bill_name for bn, _ in matched_in_bills):
                for attr in group.attributes:
                    dn = attr.display_name or ""
                    if _is_semantic_match(excel_field_stripped, dn):
                        matched_in_bills.append((bill_name, attr))
                        break

        # 判断匹配结果
        if len(matched_in_bills) == 1:
            # 唯一匹配
            bill_name, attr = matched_in_bills[0]
            matches.append(V2FieldMatch(
                excel_field=excel_field_stripped,
                display_name=attr.display_name or excel_field_stripped,
                source="direct",
                source_bill=bill_name,
                ref_attr=attr
            ))
        elif len(matched_in_bills) > 1:
            # 多个匹配（歧义），生成多个 Match
            for bill_name, attr in matched_in_bills:
                display_name = f"{attr.display_name}({bill_name})" if len(matched_in_bills) > 1 else (attr.display_name or excel_field_stripped)
                matches.append(V2FieldMatch(
                    excel_field=excel_field_stripped,
                    display_name=display_name,
                    source="direct",
                    source_bill=bill_name,
                    ref_attr=attr,
                    is_ambiguous=True
                ))
        else:
            # 未匹配到，在参照属性中查找
            logger.info(f"  未直接匹配: {excel_field_stripped}，将在关联属性中查找")
            ref_match = _find_in_reference_attributes_multi(
                excel_field_stripped, entity_groups
            )
            if ref_match:
                matches.append(ref_match)
            else:
                logger.warning(f"  无法匹配字段: {excel_field_stripped}")

    return matches


def _find_in_reference_attributes_multi(
    excel_field: str,
    entity_groups: List[BizTableGroup]
) -> Optional[V2FieldMatch]:
    """
    在多个实体的参照属性中查找匹配的字段
    例如：物料名称 → 物料参照的 name 字段

    逻辑：
    1. 提取 Excel 字段的关键词（如"物料名称" → "物料"）
    2. 在所有业务对象的属性中查找包含该关键词的参照属性
    3. 返回匹配到的参照属性供后续展开
    """
    # 提取关键词
    suffixes = ["名称", "编码", "编号", "代码", "数量", "金额", "规格", "型号", "类别"]
    base_name = excel_field
    for suffix in suffixes:
        if excel_field.endswith(suffix):
            base_name = excel_field[:-len(suffix)]
            break

    excel_keywords = [base_name, excel_field] if base_name != excel_field else [excel_field]

    for group in entity_groups:
        bill_name = group.bill_name or ""
        for attr in group.attributes:
            if not attr.uri:
                continue

            attr_display = attr.display_name or ""
            attr_name = attr.name or ""

            for kw in excel_keywords:
                kw_norm = _normalize_text(kw)
                attr_display_norm = _normalize_text(attr_display)
                attr_name_norm = _normalize_text(attr_name)

                if kw_norm in attr_display_norm or kw_norm in attr_name_norm:
                    return V2FieldMatch(
                        excel_field=excel_field,
                        display_name=excel_field,
                        source="reference",
                        source_bill=bill_name,
                        ref_attr=attr,
                        ref_entity=attr.uri
                    )

    return None


def build_matched_entities(
    cfg: dict,
    excel_fields: List[str],
    entity_groups: List[BizTableGroup]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    V2 智能匹配：匹配字段并展开参照

    Args:
        cfg: 配置字典
        excel_fields: Excel 列头字段列表
        entity_groups: 业务对象实体组列表

    Returns:
        (matched_entities, reference_entities) - 匹配的实体列表和参照实体列表
    """
    if not entity_groups:
        return [], []

    # 1. AI 推理匹配（遍历所有业务对象）
    field_matches = _infer_needed_reference_fields_multi(excel_fields, entity_groups)

    # 2. 展开参照字段
    field_to_expand = [
        (m.excel_field, m.source_bill, m.ref_entity)
        for m in field_matches
        if m.ref_entity
    ]
    expanded = expand_all_reference_fields(cfg, field_to_expand)

    # 构建展开结果映射
    expanded_map: Dict[str, Dict[str, Any]] = {}
    for exp in expanded:
        key = exp.get("excelField", "")
        if exp.get("expanded") and exp.get("displayName"):
            exp["final_attr"] = {
                "displayName": exp.get("displayName"),
                "dbColumnName": exp.get("dbColumnName"),
                "type": exp.get("type"),
            }
        expanded_map[key] = exp

    # 3. 构建结果
    matched_entities: List[Dict[str, Any]] = []
    reference_entities: List[Dict[str, Any]] = []
    seen_ref_entities: Set[str] = set()  # 去重

    # 为每个业务对象构建匹配的实体
    for group in entity_groups:
        bill_name = group.bill_name or ""
        entity_attrs = []

        for match in field_matches:
            # 检查匹配是否属于当前实体
            if match.source_bill == bill_name:
                # 使用展开后的结果
                exp = expanded_map.get(match.excel_field, {})
                final_attr = exp.get("final_attr") or (match.ref_attr and {
                    "displayName": match.ref_attr.display_name,
                    "dbColumnName": match.ref_attr.db_column_name,
                    "type": match.ref_attr.type,
                })

                if final_attr:
                    attr_dict = {
                        "displayName": final_attr.get("displayName"),
                        "dbColumnName": final_attr.get("dbColumnName"),
                        "type": final_attr.get("type"),
                        "source": match.source,
                        "isAmbiguous": match.is_ambiguous
                    }
                    # 如果是参照属性，添加参照结构
                    if match.ref_entity:
                        attr_dict["refUri"] = match.ref_entity
                        attr_dict["refDisplayName"] = match.excel_field
                    entity_attrs.append(attr_dict)

        if entity_attrs:
            matched_entities.append({
                "billName": bill_name,
                "uri": group.uri or "",
                "domain": group.domain,
                "tableName": group.table_name,
                "attributes": entity_attrs,
                "referenceEntities": [],
            })

    # 处理参照实体（去重）
    for match in field_matches:
        if match.ref_entity and match.ref_entity not in seen_ref_entities:
            exp = expanded_map.get(match.excel_field, {})
            if exp.get("expanded") and exp.get("displayName"):
                seen_ref_entities.add(match.ref_entity)
                ref_entity_data = {
                    "billName": match.excel_field,
                    "uri": match.ref_entity,
                    "displayName": exp.get("displayName"),
                    "dbColumnName": exp.get("dbColumnName"),
                    "type": exp.get("type"),
                }
                reference_entities.append(ref_entity_data)

    return matched_entities, reference_entities


def biz_table_group_to_entity_map(
    group: BizTableGroup,
    entity_result: Dict[str, Optional[str]],
    entity_model: Optional[Dict[str, Any]],
    foreign_keys: List[Dict[str, Any]],
    doc_fields: List[str],
    is_sql_y: bool,
    table_template: Optional[str],
    fetch_uri_json: Callable[[str], str],
    scheme_list: List[Dict[str, Any]],
    cfg: dict,
    excel_cols: Optional[List[str]] = None,
    request_text: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """将 BizTableGroup 转换为实体映射字典"""
    max_ref = _max_reference_fields(cfg)
    schema_val = entity_model.get("schema") if entity_model else None

    # 【v7.0 修复 Bug】原代码用 `doc_fields = matched_attrs` 试图修改函数参数，
    # Python 函数参数是不可变引用，重新赋值只影响局部变量，不影响调用方。
    # 正确做法：使用局部变量 `effective_doc_fields` 存储语义匹配结果，
    # 该变量在函数内部用于过滤，不会与函数参数混淆。
    effective_doc_fields: List[str] = list(doc_fields)  # 复制，避免修改原列表

    # 【v7.0 重构】语义匹配优先级：
    # 1. doc_fields（用户显式指定）：直接使用，不做语义匹配
    # 2. excel_cols（Excel 列头）：语义匹配（用户传了 --excel-file 但没传 --doc-fields）
    # 3. request_text（自然语言）：提取字段后语义匹配
    # 当上述都有值时，优先级 1 > 2 > 3
    # 只有当所有来源都为空时（全量获取）
    _candidate_fields_for_match: List[str] = []
    if doc_fields:
        # 优先级1：用户显式指定，直接使用
        effective_doc_fields = list(doc_fields)
    elif excel_cols:
        # 优先级2：Excel 列头语义匹配
        _candidate_fields_for_match = excel_cols
    elif request_text:
        # 优先级3：request_text 提取字段后语义匹配
        _candidate_fields_for_match = _extract_fields_from_request_text(request_text)
    # 执行语义匹配（仅优先级2和3）
    if _candidate_fields_for_match:
        matched_docs, matched_attrs = _semantic_match_doc_fields(_candidate_fields_for_match, group)
        if matched_attrs:
            if excel_cols and not doc_fields:
                logger.info(
                    f"语义匹配成功: Excel 列头 {len(matched_docs)} 个 → "
                    f"元数据字段 {len(matched_attrs)} 个: {matched_attrs}"
                )
            elif request_text and not doc_fields and not excel_cols:
                logger.info(
                    f"【v7.0】请求文本字段语义匹配: {_candidate_fields_for_match} → "
                    f"元数据字段 {len(matched_attrs)} 个: {matched_attrs}"
                )
            effective_doc_fields = matched_attrs
    m: Dict[str, Any] = {
        "tableName": group.table_name,
        "billName": group.bill_name,
        "domain": group.domain,
        "uri": entity_result.get("uri"),
        "businessObjectCode": entity_result.get("businessObjectCode"),
        "schema": schema_val,
    }
    if foreign_keys:
        m["foreignKeys"] = foreign_keys
    prop_map: Dict[str, str] = {}
    if entity_model:
        for bp in entity_model.get("businessProperties") or []:
            if not isinstance(bp, dict):
                continue
            tn = bp.get("tableName")
            if not tn:
                continue
            n = bp.get("name")
            dn = bp.get("displayName")
            if n:
                prop_map[str(n)] = str(tn)
            if dn:
                prop_map[str(dn)] = str(tn)

    # 【优化 v5.0】仅收集匹配字段的参照 URI，不展开所有参照
    # 1. 先过滤出实际需要的属性（matched_attrs）
    # 【v7.0 修复】使用 effective_doc_fields 而非 doc_fields，
    # 因为 doc_fields 在函数内部重新赋值无法影响外部传入的值
    matched_attrs: List[AttributeInfo] = []
    if is_sql_y and group.attributes:
        for attr in group.attributes:
            if effective_doc_fields:
                dn = attr.display_name or ""
                if dn not in effective_doc_fields:
                    continue
            matched_attrs.append(attr)
    # 2. 只对匹配的属性收集 URI
    uris: Set[str] = set()
    for attr in matched_attrs:
        if attr.uri:
            uris.add(attr.uri)

    # 引用字段数量限制（防止过多引用字段导致超时/网关压力）
    skipped_uris: Set[str] = set()
    if len(uris) > max_ref:
        uri_list = list(uris)
        skipped = uri_list[max_ref:]
        logger.warning(
            "⚠️ 参照字段超过上限！总数=%d，上限=%d，已跳过 %d 个参照。\n"
            "   跳过的 URI: %s\n"
            "   如需展开全部参照，请在 docFields 中指定具体字段以缩小范围，"
            "或通过 config.yaml 调高 performance.max_reference_fields_expand",
            len(uris), max_ref, len(skipped), skipped
        )
        uris = set(uri_list[:max_ref])
        skipped_uris = set(skipped)

    # 【v6.0 优化】使用批量查询，返回已解析的对象字典（无需 json.loads）
    uri_to_obj: Dict[str, Any] = (
        fetch_entity_db_info_batch(cfg, uris) if uris else {}
    )

    # 【优化 v5.0】直接遍历 matched_attrs（已过滤），避免重复过滤
    attrs_out: List[Dict[str, Any]] = []
    for attr in matched_attrs:
        am = attr_to_map(attr)
        tn = prop_map.get(attr.name or "") or prop_map.get(attr.display_name or "")
        if not tn:
            tn = group.table_name
        am["tableName"] = tn
        attr_uri = attr.uri
        if attr_uri and is_sql_y:
            # 检查该 URI 是否被跳过（因数量过多）
            if attr_uri in skipped_uris:
                am["referenceSkipped"] = True
                am["referenceSkipReason"] = (
                    f"参照总数超过上限({max_ref})，此参照被跳过。"
                    f"如需展开请在 docFields 中指定该字段，或调高 max_reference_fields_expand"
                )
            else:
                # 【v6.0 优化】uri_to_obj 已是已解析的对象，无需 json.loads()
                ref_obj = uri_to_obj.get(attr_uri)
                if ref_obj:
                    try:
                        ref_groups = parse(ref_obj, fetch_uri_json)
                        if ref_groups:
                            ref_group = ref_groups[0]
                            ref_attrs: List[Dict[str, Any]] = []
                            for ra in ref_group.attributes or []:
                                an = ra.name
                                dn = ra.display_name or ""
                                if an in ("name", "code") or (
                                    table_template and dn and dn in str(table_template)
                                ):
                                    ref_attrs.append(
                                        {
                                            "dbColumnName": ra.db_column_name,
                                            "displayName": ra.display_name,
                                            "primarykey": "id",
                                        }
                                    )
                            domain = ref_group.domain
                            ref_structure: Dict[str, Any] = {
                                "billName": ref_group.bill_name,
                                "domain": domain,
                                "tableName": ref_group.table_name,
                                "attributes": ref_attrs,
                            }
                            sch = scheme_by_domain(scheme_list, domain) or "scheme"
                            if (
                                not sch or sch == "scheme"
                            ) and domain and domain.startswith("c-"):
                                sch = domain.replace("-", "_") + "_db"
                            ref_structure["scheme"] = sch
                            am["referenceStructure"] = ref_structure
                    except (KeyError, IndexError) as e:
                        logger.warning(f"解析引用 {attr_uri} 失败: {e}")
        attrs_out.append(am)
    m["attributes"] = attrs_out
    return m


def filter_strip_attribute_names(root: Dict[str, Any]) -> Dict[str, Any]:
    """移除 attributes 中的 name 字段（对齐 ReportSQLGenTool）"""
    entities = root.get("entities")
    if not isinstance(entities, list):
        return root
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        attributes = ent.get("attributes")
        if not isinstance(attributes, list):
            continue
        for attr in attributes:
            if isinstance(attr, dict) and "name" in attr:
                del attr["name"]
    return root


def _should_interactive_selection_prompt() -> bool:
    """与插件 / Agent 非 TTY 环境：不阻塞 input，仅输出可解析的 stdout（见 Chat 侧栏多 URI 选择器）。"""
    if not sys.stdin.isatty():
        return False
    v = (os.environ.get("HYPERION_NON_INTERACTIVE") or "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return False
    return True


def _format_byname_bo_selection_stdout(selection_info: Dict[str, Any]) -> str:
    """与 Chat.parseBillNameChoiceFromStdout 一致（searchByName 多业务对象）。"""
    names = selection_info.get("names") or []
    return "停止继续往下走，请从以下单据名称中选择：" + "、".join(str(x) for x in names if x)


def _format_selection_stdout_for_ui(selection_info: Dict[str, Any]) -> str:
    """格式化业务对象选择提示（仅 byname 路径）。"""
    return _format_byname_bo_selection_stdout(selection_info)


def build_entities_for_bill(
    cfg: dict, billname_trim: str
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """为单个单据构建实体列表"""
    api = cfg.get("api") or {}
    scheme_path = resolve_skill_path(
        (cfg.get("paths") or {}).get("scheme_info_json", "reference/scheme-info.json")
    )
    scheme_list = load_scheme_map(scheme_path)
    req = cfg.get("request") or {}
    doc_fields = parse_doc_fields(req.get("docFields"))
    if str(req.get("isDescField", "Y")).upper() == "N":
        doc_fields = []

    # 【v7.0 优化】requestText 提取移至 biz_table_group_to_entity_map 内部，
    # 确保 Excel 列头（excel_cols）优先于 requestText 语义匹配，
    # 符合"字段必须来源于 Excel 描述"的要求。
    # doc_fields 保持为用户显式指定的字段列表（request.docFields），不在此处提前提取。
    request_text = req.get("requestText", "") or ""

    # 【优化】如果指定了 excelFile，自动从 Excel 提取信息
    excel_file = req.get("excelFile") or getattr(cfg, "excel_file", None)
    excel_sheet_index = int(req.get("excelSheetIndex", 0) or 0)
    excel_cols: List[str] = []  # Excel 列头（用于语义匹配字段 displayName）
    data_source_fields: List[str] = []  # 【v5.1 新增】Excel "数据源字段"列值（用于过滤参照元数据）
    if excel_file:
        try:
            excel_path = Path(excel_file)
            if excel_path.exists():
                logger.info(f"从 Excel 自动提取信息: {excel_file}")
                excel_result = parse_excel(excel_path, excel_sheet_index)
                # Excel 列头（用于语义匹配）
                all_excel_cols = excel_result.get("docFields", [])
                # 【v7.0 优化】过滤描述性列头，只保留真正的业务字段列
                # 这些列头是元信息列，不是业务字段，不应参与语义匹配
                _EXCLUDE_EXCEL_HEADERS: Set[str] = {
                    "序号", "编号", "报表编号", "报表编号", "报表",
                    "报表名称", "报表名称", "名称",
                    "难度等级", "难度名称", "难度", "等级",
                    "场景说明", "说明", "描述",
                    "技能要求", "要求", "能力",
                    "报表数量", "数量", "统计",
                    "备注", "内容",
                    "分类", "类型",
                    "核心业务对象", "业务对象", "数据源",
                    "单据名称", "业务对象名称", "报表对象",
                    "单据", "实体", "来源单据",
                    "数据源字段", "数据源(业务对象)", "来源业务对象",
                    "来源", "业务对象来源",
                }
                excel_cols = [
                    c for c in all_excel_cols
                    if c.strip() and c.strip() not in _EXCLUDE_EXCEL_HEADERS
                ]
                if excel_cols:
                    logger.info(f"自动提取 Excel 字段列头: {excel_cols}")
                # 【v5.1 新增】"数据源字段"列的值（按分隔符拆分后的业务对象名称，用于过滤参照字段）
                data_source = excel_result.get("dataSource") or {}
                data_source_fields = data_source.get("dataSourceFields", [])
                if data_source_fields:
                    logger.info(f"【v5.1】提取数据源字段: {data_source_fields}")
        except Exception as e:
            logger.warning(f"从 Excel 提取信息失败: {e}")

    is_sql_y = str(req.get("is_sql", "Y")).upper() == "Y"
    table_template = req.get("tableTemplate")
    # 【优化 v5.0】永远不查询子表，只获取用户明确指定的业务对象
    is_include_sub = False

    # queryUri 优先路径：直接用 URI 查，跳过 searchByName/byboid
    quri = (req.get("queryUri") or "").strip()
    if quri:
        logger.info(f"直接通过 queryUri 查询: {quri}")

        def fetch_uri_direct(u: str) -> str:
            return _query_by_uri_cached(cfg, u)

        # 【v6.0 优化】使用 _query_by_uri_cached_parsed 直接获取已解析的对象
        db_obj = _query_by_uri_cached_parsed(cfg, quri)
        if db_obj is None:
            return [], f"错误: 无法获取 URI {quri} 的元数据"
        groups = parse(db_obj, fetch_uri_json=fetch_uri_direct)
        fkeys = parse_foreign_keys_util(db_obj, quri)

        results: List[Dict[str, Any]] = []
        # queryUri 路径：若 billname_trim 是自动填充的占位符（如 "metadata"），
        # 则不过滤，让所有 group 都通过
        skip_filter = billname_trim in ("metadata", "query", "")
        for group in groups:
            # 【优化 v5.0】is_include_sub 永远为 False，只保留名称严格匹配的实体
            if not is_include_sub and not skip_filter:
                gb = group.bill_name or ""
                if not (gb == billname_trim or billname_trim in gb or gb in billname_trim):
                    continue
            # 伪造一个 entity 字典供 biz_table_group_to_entity_map 使用
            fake_ent: Dict[str, Optional[str]] = {
                "uri": quri,
                "entityId": None,
                "boId": None,
                "businessObjectCode": None,
            }
            emap = biz_table_group_to_entity_map(
                group,
                fake_ent,
                None,  # entity_model
                fkeys,
                data_source_fields or doc_fields,  # 【v5.1】优先用数据源字段过滤参照
                is_sql_y,
                str(table_template) if table_template is not None else None,
                fetch_uri_direct,
                scheme_list,
                cfg,
                excel_cols=excel_cols,  # 用于语义匹配
                request_text=request_text,  # 【v7.0】自然语言请求文本
            )
            if emap:
                results.append(emap)
        logger.info(f"queryUri 直查完成，共获取 {len(results)} 个实体")
        return results, None

    logger.info(f"正在拉取单据: {billname_trim}")

    pre_selected_code = req.get("_selected_bo_code")
    pre_selected_id = req.get("_selected_bo_id")

    # ============================================================
    # 【改进 v2.0/v3.0】FastLookup + Redis 缓存优先策略
    #   - exact match (confidence=high) → 直接降级到 Redis 缓存 → API
    #   - 多个精确命中 → 同上
    #   - 模糊命中 → 同上
    #   - Redis 缓存均未命中 → 降级到 API 搜索
    # ============================================================

    fast_lookup = _get_fast_lookup(cfg)
    if fast_lookup.is_loaded and not pre_selected_code:
        fast_exact_hits = fast_lookup.strict_lookup(billname_trim)
        if fast_exact_hits:
            if len(fast_exact_hits) == 1:
                first = fast_exact_hits[0]
                logger.info(
                    f"FastLookup 精确命中 '{billname_trim}' → "
                    f"URI={first.uri}（confidence={first.confidence}）"
                )
            else:
                logger.warning(
                    f"FastLookup 精确命中多个 ({len(fast_exact_hits)})，"
                    f"将使用第一个候选：{[r.uri for r in fast_exact_hits]}"
                )
        else:
            lookup_hits = fast_lookup.lookup(billname_trim)
            if lookup_hits:
                logger.info(
                    f"FastLookup 模糊命中（confidence={lookup_hits[0].confidence}），"
                    f"将使用第一个候选：{[r.uri for r in lookup_hits[:3]]}"
                )
            else:
                logger.info(
                    f"FastLookup 无命中，降级到 searchByName API：'{billname_trim}'"
                )

    cn = None
    byname_path = api.get("metadata_byname", "")

    # 【v7.0 新增】先查询 Redis byname 索引（name → URI 映射）
    # 如果命中，直接走 queryUri 路径，绕过 searchByName + byboid API 调用
    redis_byname_uri: Optional[str] = None
    redis_byname_uri = get_cached_uri_by_billname(billname_trim)

    if pre_selected_code:
        cn = CodeNameResult(code=pre_selected_code, id=pre_selected_id or "", name=req.get("_selected_bo_name"))
        logger.info(f"使用预先选择的业务对象: code={pre_selected_code}, id={pre_selected_id}")
    elif redis_byname_uri:
        # 【v7.0 优化】Redis byname 命中，直接走 queryUri 路径
        logger.info(f"[REDIS] byname 索引命中，跳过 searchByName + byboid API: {billname_trim} → {redis_byname_uri}")
        cn = CodeNameResult(code=None, name=billname_trim, id=None)
    else:
        # searchByName 结果缓存：同一进程内相同 billname 不重复请求 API
        cached_byname = _get_cached_byname(billname_trim)
        if cached_byname:
            logger.info(f"[METADATA] searchByName 进程内缓存命中: {billname_trim}")
            raw = json.loads(cached_byname)
        else:
            logger.info(f"[METADATA] searchByName API请求: {billname_trim}")
            raw = http_get_json(cfg, byname_path, {"key": billname_trim})
            _set_cached_byname(billname_trim, json.dumps(raw, ensure_ascii=False))

            # 【v7.0 新增】searchByName API 返回后，将 name → URI 映射写入 Redis
            if raw and isinstance(raw, dict):
                code_val = _text(raw, "code") or _text(raw, "resultCode")
                if code_val == "200":
                    data_node = raw.get("data")
                    if isinstance(data_node, dict):
                        inner_data = data_node.get("data")
                        if isinstance(inner_data, list):
                            for item in inner_data:
                                if isinstance(item, dict):
                                    item_name = _text(item, "name")
                                    item_uri = _text(item, "uri")
                                    if item_name and item_uri:
                                        set_cached_uri_by_billname(item_name, item_uri)
                                        if item_name == billname_trim:
                                            logger.info(f"[REDIS] byname 索引写入: {item_name} → {item_uri}")

        cn = parse_business_object_code_name(raw, billname_trim)
        if cn is None:
            return [], f"错误: 无法解析单据 [{billname_trim}] 的编码和名称"
        if cn.not_found:
            return [], cn.not_found_reason or f"未找到名为 [{billname_trim}] 的业务对象"
        if cn.needs_selection():
            items = cn.available_items or []
            names = cn.available_names or []
            return [], {
                "type": "selection",
                "source": "search_by_name",
                "items": items,
                "names": names,
                "billname": billname_trim,
            }

    # 【v7.0 优化】Redis byname 命中时，直接走 queryUri 路径，跳过 byboid 调用
    if redis_byname_uri:
        # 直接用 URI 查询元数据
        logger.info(f"[REDIS] byname 命中，直接走 queryUri 路径: {redis_byname_uri}")

        def fetch_uri_direct(u: str) -> str:
            return _query_by_uri_cached(cfg, u)

        db_obj = _query_by_uri_cached_parsed(cfg, redis_byname_uri)
        if db_obj is None:
            return [], f"错误: 无法获取 URI {redis_byname_uri} 的元数据"
        groups = parse(db_obj, fetch_uri_json=fetch_uri_direct)
        fkeys = parse_foreign_keys_util(db_obj, redis_byname_uri)

        results: List[Dict[str, Any]] = []
        for group in groups:
            gb = group.bill_name or ""
            if not (gb == billname_trim or billname_trim in gb or gb in billname_trim):
                continue
            fake_ent: Dict[str, Optional[str]] = {
                "uri": redis_byname_uri,
                "entityId": None,
                "boId": None,
                "businessObjectCode": None,
            }
            emap = biz_table_group_to_entity_map(
                group,
                fake_ent,
                None,
                fkeys,
                data_source_fields or doc_fields,
                is_sql_y,
                str(table_template) if table_template is not None else None,
                fetch_uri_direct,
                scheme_list,
                cfg,
                excel_cols=excel_cols,
                request_text=request_text,  # 【v7.0】自然语言请求文本
            )
            if emap:
                results.append(emap)
        logger.info(f"Redis byname 查询完成，共获取 {len(results)} 个实体")
        return results, None

    byboid_path = api.get("metadata_byboid", "")
    boid_key = f"{cn.id or ''}|{cn.code or ''}"
    # getEntityListByBOId 结果缓存：同一进程内相同 boId 不重复请求 API
    cached_byboid = _get_cached_byboid(boid_key)
    if cached_byboid:
        logger.debug(f"getEntityListByBOId cache hit: boId={cn.id}, code={cn.code}")
        raw_bo = json.loads(cached_byboid)
    else:
        raw_bo = http_get_json(
            cfg,
            byboid_path,
            {"boId": cn.id or "", "businessObjectCode": cn.code or ""},
        )
        _set_cached_byboid(boid_key, json.dumps(raw_bo, ensure_ascii=False))
        logger.debug(f"getEntityListByBOId cache miss, fetched: boId={cn.id}, code={cn.code}")
    details = collect_entity_details(raw_bo)
    entities_list: List[Dict[str, Any]] = []

    def fetch_uri(u: str) -> str:
        return _query_by_uri_cached(cfg, u)

    # 并行处理多个实体，提高性能
    def process_entity(ent: Dict[str, Optional[str]]) -> List[Dict[str, Any]]:
        """处理单个实体，返回实体映射列表"""
        entity_id = ent.get("entityId")
        uri = ent.get("uri")
        if not uri:
            return []

        entity_model: Optional[Dict[str, Any]] = None
        if entity_id:
            cached_ent = _get_cached_entityid(entity_id)
            if cached_ent:
                logger.debug(f"entityId cache hit: {entity_id}")
                raw_ent = json.loads(cached_ent)
            else:
                ent_path = api.get("metadata_entityid", "")
                raw_ent = http_get_json(
                    cfg,
                    ent_path,
                    {
                        "entityId": entity_id,
                        "uri": uri or "",
                        "boId": ent.get("boId") or "",
                        "businessObjectCode": ent.get("businessObjectCode") or "",
                    },
                )
                _set_cached_entityid(entity_id, json.dumps(raw_ent, ensure_ascii=False))
                logger.debug(f"entityId cache miss, fetched: {entity_id}")
            entity_model = parse_entity_model_for_ai(raw_ent)

        # 【v6.0 优化】使用 _query_by_uri_cached_parsed 直接获取已解析的对象
        # 避免 json.loads() 重复解析
        db_obj = _query_by_uri_cached_parsed(cfg, uri)
        if db_obj is None:
            return []
        groups = parse(db_obj, fetch_uri_json=fetch_uri)
        fkeys = parse_foreign_keys_util(db_obj, uri)

        results: List[Dict[str, Any]] = []
        for group in groups:
            # 【优化 v5.0】is_include_sub 永远为 False，只保留名称严格匹配的实体
            if not is_include_sub:
                gb = group.bill_name or ""
                if not (gb == billname_trim or billname_trim in gb or gb in billname_trim):
                    continue
            emap = biz_table_group_to_entity_map(
                group,
                ent,
                entity_model,
                fkeys,
                data_source_fields or doc_fields,  # 【v5.1】优先用数据源字段过滤参照
                is_sql_y,
                str(table_template) if table_template is not None else None,
                fetch_uri,
                scheme_list,
                cfg,
                excel_cols=excel_cols,  # 用于语义匹配
                request_text=request_text,  # 【v7.0】自然语言请求文本
            )
            if emap:
                results.append(emap)
        return results

    # 使用线程池并行处理实体（限制并发数避免过载）
    if len(details) > 1:
        ew = min(_max_concurrent_entities(cfg), len(details))
        logger.info(f"使用 {ew} 个线程并行处理 {len(details)} 个实体")
        with ThreadPoolExecutor(max_workers=ew) as executor:
            future_to_ent = {
                executor.submit(process_entity, ent): ent for ent in details
            }
            for future in as_completed(future_to_ent):
                try:
                    results = future.result()
                    entities_list.extend(results)
                except Exception as e:
                    ent = future_to_ent[future]
                    logger.error(f"处理实体失败 [uri={ent.get('uri')}]: {e}")
    else:
        # 单个实体时直接处理，避免线程池开销
        for ent in details:
            entities_list.extend(process_entity(ent))

    logger.info(f"单据 {billname_trim} 完成，共获取 {len(entities_list)} 个实体")
    return entities_list, None


def run_all_bills(cfg: dict) -> Tuple[Dict[str, Any], Optional[str]]:
    """运行所有单据的元数据拉取（自动去重相同单据名称）"""
    # 【v6.0 优化】提前初始化 entities 索引，后续 write_outputs 复用内存中的索引
    _get_entities_index(cfg)

    req = cfg.get("request") or {}
    quri = (req.get("queryUri") or req.get("query_uri") or "").strip()
    allbill = str(req.get("allbillname", "")).strip()
    if not allbill and quri:
        allbill = "metadata"
    if not allbill:
        return (
            {"entities": []},
            "错误: 缺少必需的参数 'allbillname'（单据名称），或提供 queryUri 以仅按元数据 uri 直查",
        )
    parts = [p.strip() for p in allbill.split(",") if p.strip()]
    if not parts:
        return (
            {"entities": []},
            "错误: 缺少必需的参数 'allbillname'（单据名称），或提供 queryUri 以仅按元数据 uri 直查",
        )

    # 去重：相同单据名称只处理一次，避免 Excel 中多行重复业务对象导致重复 API 调用
    seen: Set[str] = set()
    unique_parts: List[str] = []
    for p in parts:
        p_lower = p.lower()
        if p_lower not in seen:
            seen.add(p_lower)
            unique_parts.append(p)
    if len(unique_parts) < len(parts):
        dupes = len(parts) - len(unique_parts)
        logger.info(
            f"单据名称去重：原始 {len(parts)} 个 → 去重后 {len(unique_parts)} 个 "
            f"（跳过 {dupes} 个重复）"
        )
    parts = unique_parts

    logger.info(f"开始拉取 {len(parts)} 个单据: {', '.join(parts)}")

    if len(parts) == 1:
        ents, err = build_entities_for_bill(cfg, parts[0])
        if err:
            # 检查是否是选择类型的错误
            if isinstance(err, dict) and err.get("type") == "selection":
                return {"entities": [], "selection": err}, None
            return {"entities": []}, err
        return {"entities": ents}, None

    max_b = _max_concurrent_bills(cfg)
    bill_results: Dict[str, Tuple[List[Dict[str, Any]], Optional[str]]] = {}

    with ThreadPoolExecutor(max_workers=min(max_b, len(parts))) as executor:
        future_to_part = {
            executor.submit(build_entities_for_bill, cfg, p): p for p in parts
        }
        for future in as_completed(future_to_part):
            part = future_to_part[future]
            try:
                ents, err = future.result()
                # 检查是否是选择类型的错误
                if isinstance(err, dict) and err.get("type") == "selection":
                    return {"entities": [], "selection": err}, None
                bill_results[part] = (ents, err)
            except Exception as e:
                logger.error(f"拉取单据失败 [{part}]: {e}")
                return {"entities": []}, f"拉取单据失败 [{part}]: {e}"

    merged: List[Dict[str, Any]] = []
    failed_bills: List[str] = []
    not_found_bills: List[str] = []
    for p in parts:
        ents, err = bill_results[p]
        if err:
            if isinstance(err, str) and "未找到" in err:
                not_found_bills.append(p)
            else:
                failed_bills.append(p)
        else:
            merged.extend(ents)

    # 汇总失败情况
    if not_found_bills or failed_bills:
        logger.warning("=== 拉取失败汇总 ===")
        for bill in not_found_bills:
            logger.warning(f"  ⚠ 未找到: {bill}（searchByName 返回空数据，请确认单据名称正确且已在 BIP 平台发布）")
        for bill in failed_bills:
            logger.warning(f"  ✗ 拉取失败: {bill}")
        if not merged:
            # 所有单据都失败了
            first_err = bill_results.get(parts[0], (None, "未知错误"))[1]
            return {"entities": []}, first_err

    logger.info(f"全部单据拉取完成，共获取 {len(merged)} 个实体")
    # 缓存统计：帮助诊断是否命中缓存
    redis_stats = get_cache_stats()
    # 【v6.0 新增】进程内对象缓存统计
    obj_cache_stats = _uri_object_cache.get_stats()
    logger.info(
        f"【缓存统计 v6.0】"
        f"进程内对象缓存: size={obj_cache_stats['size']}, "
        f"命中率={obj_cache_stats['hit_rate']} "
        f"(hit={obj_cache_stats['hit_count']}, miss={obj_cache_stats['miss_count']}) | "
        f"redis.enabled={redis_stats.get('enabled', False)} | "
        f"disk.enabled={_disk_cache_enabled}"
    )
    return {"entities": merged}, None


def _get_tenant_id(cfg: dict) -> Optional[str]:
    """从配置或环境变量获取租户ID"""
    # 优先从环境变量获取
    tenant_id = os.environ.get("YONBIP_TENANT_ID", "").strip()
    if tenant_id:
        return tenant_id
    # 从配置中获取
    db = cfg.get("database") or {}
    queries = db.get("queries") or {}
    elastic = queries.get("elastic_field_check") or {}
    tenant_id = str(elastic.get("ytenant_id", "")).strip()
    if tenant_id:
        return tenant_id
    return None


def write_outputs(cfg: dict, payload: Dict[str, Any]) -> None:
    """将元数据写入输出文件"""
    out_cfg = cfg.get("output") or {}
    paths = cfg.get("paths") or {}
    ws_base = workspace_base(cfg)
    logger.info(f"Workspace (outputs): {ws_base}")

    out_dir = resolve_workspace_path(paths.get("output_dir", "output"), cfg)
    out_dir.mkdir(parents=True, exist_ok=True)

    data = dict(payload)
    if out_cfg.get("strip_attribute_names", True):
        data = filter_strip_attribute_names(data)

    if out_cfg.get("write_entities_json", True):
        p = out_dir / str(out_cfg.get("entities_json_filename", "entities.json"))

        # 【v7.0 优化】先确保索引已加载，再合并，再写入
        # 索引加载路径（按速度）：
        #   1. 索引已全量加载到内存（iterate_all 直接读内存）→ <0.1ms
        #   2. SQLite 有数据（load_from_json 加载到内存）→ <2ms
        #   3. JSON 文件存在（load_from_json 从文件加载并建 SQLite 索引）→ 50ms+
        # 关键修复：旧代码在此处直接调用 get_count() 判断是否有数据，但此时索引尚未 load，
        #   导致走 json.loads() 降级路径（即使文件存在）。新逻辑先 load，再用内存索引合并。
        idx = _get_entities_index(cfg)
        idx_loaded_count = 0
        if idx and p.exists():
            idx_loaded_count = idx.load_from_json(str(p))
            logger.info(f"索引加载完成: {idx_loaded_count} 个实体")

        # 从内存索引合并（不走 json.loads()）
        # 复用已加载的 _memory_index（通过 iterate_all 触发内存索引路径）
        existing_entities: List[Dict[str, Any]] = []
        if idx and idx.get_count() > 0:
            existing_entities = idx.iterate_all()
            logger.info(f"从内存索引合并已有实体: {len(existing_entities)} 个")

        # 合并 entities 列表（去重：按 uri + tableName 唯一性判断）
        new_entities = data.get("entities", [])
        if new_entities or existing_entities:
            seen_keys: Set[str] = set()
            merged_entities: List[Dict[str, Any]] = []
            # 先加入已存在的
            for ent in existing_entities:
                key = f"{ent.get('uri', '')}|{ent.get('tableName', '')}"
                if key:
                    seen_keys.add(key)
                    merged_entities.append(ent)
            # 再追加新的（跳过已存在的）
            added_count = 0
            skipped_count = 0
            for ent in new_entities:
                key = f"{ent.get('uri', '')}|{ent.get('tableName', '')}"
                if key and key in seen_keys:
                    skipped_count += 1
                    continue
                merged_entities.append(ent)
                seen_keys.add(key)
                added_count += 1
            logger.info(f"合并 entities: 新增 {added_count} 个，跳过重复 {skipped_count} 个，合计 {len(merged_entities)} 个")
            data = dict(data)
            data["entities"] = merged_entities
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"写入: {p}")

    if out_cfg.get("write_bundle_md", True):
        guide = resolve_skill_path(
            paths.get("sql_guide_md", "reference/旗舰版通用_后端_报表_SQL生成.md")
        )
        body = ""
        if guide.exists():
            body = guide.read_text(encoding="utf-8")
        p = out_dir / str(out_cfg.get("bundle_md_filename", "report_sql_context.md"))
        header = "业务对象属性信息如下:\n\n```json\n"
        footer = (
            "\n```\n\n实体模型字段说明: schema为schema，tableName 为表名，"
            "billName 为单据名称，domain 为领域；attributes 为属性列表，"
            "每项含 displayName(显示名)、dbColumnName(数据库列名)、type(数据类型)、"
            "enums(枚举值列表)。referenceStructure 为属性字段的引用元数据结构信息,,"
            "referenceStructure中primarykey是引用的主键\n"
        )
        # 租户信息（仅提供租户ID供参考，不强制要求添加到WHERE条件
        tenant_id = _get_tenant_id(cfg)
        tenant_section = ""
        if tenant_id:
            tenant_section = (
                f"\n## 租户信息\n\n"
                f"当前租户ID (ytenant_id): `{tenant_id}`\n\n"
                f"> **说明**: 此租户ID仅供参考，**仅当用户明确要求按租户过滤时**才需要在WHERE条件中使用。\n"
                f"> 禁止猜测添加此租户ID过滤条件。\n\n"
            )
        # 数据库校验环境信息
        db_cfg_out = cfg.get("database") or {}
        db_section = ""
        if str(db_cfg_out.get("enabled", "false")).lower() in ("true", "1", "yes"):
            db_driver = db_cfg_out.get("driver", "mysql")
            db_host = db_cfg_out.get("host", "")
            db_port = db_cfg_out.get("port", "")
            db_name = db_cfg_out.get("database", "")
            db_section = (
                f"\n## 数据库校验环境\n\n"
                f"- 数据库类型: `{db_driver}`\n"
                f"- 主机: `{db_host}`\n"
                f"- 端口: `{db_port}`\n"
                f"- 数据库名: `{db_name}`\n\n"
                f"> 生成的SQL将在此数据库上执行校验，请确保SQL语法兼容。\n\n"
            )
        # Windows 记事本等默认用 ANSI 打开无 BOM 的 UTF-8 易误判为系统编码
        md_enc = "utf-8-sig" if sys.platform == "win32" else "utf-8"
        p.write_text(
            header + json.dumps(data, ensure_ascii=False, indent=2) + footer + tenant_section + db_section + body,
            encoding=md_enc,
        )
        logger.info(f"写入: {p}")


def _apply_workspace_cli_overrides(cfg: dict, args: argparse.Namespace) -> None:
    """应用命令行的工作空间覆盖"""
    wr = getattr(args, "workspace_root", None)
    if wr is not None and str(wr).strip():
        cfg.setdefault("paths", {})["workspace_root"] = str(wr).strip()


def _apply_request_cli_overrides(cfg: dict, args: argparse.Namespace) -> None:
    """将命令行显式传入的项合并进 cfg['request']，覆盖 config.yaml 同名字段。"""
    req = cfg.setdefault("request", {})
    if getattr(args, "allbillname", None) is not None:
        req["allbillname"] = args.allbillname
    if getattr(args, "lookup_json", None) is not None:
        cfg.setdefault("paths", {})["metadata_lookup_json"] = args.lookup_json
    if getattr(args, "is_include_sub", None) is not None:
        logger.info("isIncludeSub 参数已废弃，固定为 N（不查询子表）")
    if getattr(args, "doc_fields", None) is not None:
        req["docFields"] = args.doc_fields
    if getattr(args, "excel_file", None) is not None:
        req["excelFile"] = str(args.excel_file)
    if getattr(args, "excel_sheet_index", None) is not None:
        req["excelSheetIndex"] = args.excel_sheet_index
    if getattr(args, "is_sql", None) is not None:
        req["is_sql"] = args.is_sql
    if getattr(args, "is_desc_field", None) is not None:
        req["isDescField"] = args.is_desc_field
    if getattr(args, "request_text", None) is not None:
        req["requestText"] = args.request_text
    if getattr(args, "table_template", None) is not None:
        req["tableTemplate"] = args.table_template
    if getattr(args, "selected_bo_code", None) is not None:
        req["_selected_bo_code"] = args.selected_bo_code
    if getattr(args, "selected_bo_id", None) is not None:
        req["_selected_bo_id"] = args.selected_bo_id
    if getattr(args, "query_uri", None) is not None:
        req["queryUri"] = args.query_uri


def main() -> int:
    configure_stdio_utf8()
    setup_logging("fetch_metadata")

    ap = argparse.ArgumentParser(
        description="拉取旗舰版业务对象元数据；request.* 可由话术解析后通过下列参数注入（覆盖 config.yaml）。"
    )
    ap.add_argument("--config", default=str(SKILL_DIR / "config.yaml"))
    ap.add_argument(
        "--env-file",
        default=None,
        help="Path to .env file (default: <config_dir>/.env)",
    )
    ap.add_argument(
        "--workspace-root",
        default=None,
        metavar="DIR",
        help="覆盖 paths.workspace_root：元数据输出 output_dir 相对此目录（默认自动推断项目根）",
    )
    ap.add_argument(
        "--run-db-check",
        action="store_true",
        help="拉取完成后运行 database.queries.elastic_field_check",
    )
    ap.add_argument(
        "--validate",
        action="store_true",
        help="仅验证配置，不拉取数据",
    )
    ap.add_argument(
        "--allbillname",
        default=None,
        help="覆盖 request.allbillname（多个单据用英文逗号分隔）",
    )
    ap.add_argument(
        "--is-include-sub",
        "--isIncludeSub",
        dest="is_include_sub",
        default=None,
        metavar="Y|N",
        help="[已废弃] isIncludeSub 固定为 N，不再查询子表",
    )
    ap.add_argument(
        "--excel-file",
        "-e",
        dest="excel_file",
        default=None,
        type=Path,
        metavar="PATH",
        help="Excel 报表模板路径（自动提取 docFields 和 billNames，按需获取参照）",
    )
    ap.add_argument(
        "--excel-sheet-index",
        dest="excel_sheet_index",
        default=0,
        type=int,
        metavar="INDEX",
        help="Excel 工作表索引（配合 --excel-file 使用，默认 0）",
    )
    ap.add_argument(
        "--doc-fields",
        "--docFields",
        dest="doc_fields",
        default=None,
        metavar="CSV",
        help="覆盖 request.docFields：仅保留这些 displayName，逗号分隔；空字符串表示不过滤",
    )
    ap.add_argument(
        "--is-sql",
        dest="is_sql",
        default=None,
        metavar="Y|N",
        help="覆盖 request.is_sql（config 中字段名）：需要参照 referenceStructure 时为 Y",
    )
    ap.add_argument(
        "--is-desc-field",
        "--isDescField",
        dest="is_desc_field",
        default=None,
        metavar="Y|N",
        help="覆盖 request.isDescField：为 N 时忽略 docFields",
    )
    ap.add_argument(
        "--request-text",
        dest="request_text",
        default=None,
        metavar="TEXT",
        help="【v7.0 新增】自然语言请求文本，用于自动提取字段名并做语义匹配过滤元数据",
    )
    ap.add_argument(
        "--table-template",
        "--tableTemplate",
        dest="table_template",
        default=None,
        metavar="STR",
        help="覆盖 request.tableTemplate：参照属性额外保留的 displayName 匹配子串",
    )
    ap.add_argument(
        "--selected-bo-code",
        dest="selected_bo_code",
        default=None,
        metavar="CODE",
        help="指定已选择的业务对象编码（用于交互式选择后继续执行）",
    )
    ap.add_argument(
        "--selected-bo-id",
        dest="selected_bo_id",
        default=None,
        metavar="ID",
        help="指定已选择的业务对象ID（用于交互式选择后继续执行）",
    )
    ap.add_argument(
        "--query-uri",
        "--queryUri",
        dest="query_uri",
        default=None,
        metavar="URI",
        help="覆盖 request.queryUri：本地快速索引多义时选定元数据实体 uri；也可单独与空 allbillname 搭配直查",
    )
    ap.add_argument(
        "--lookup-json",
        "--lookupJson",
        dest="lookup_json",
        default=None,
        metavar="PATH",
        help="指定 metadata_lookup.json 路径（用于 FastLookup 精确匹配业务对象名称）",
    )
    ap.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="输出详细日志",
    )

    args = ap.parse_args()

    # 设置详细日志
    if args.verbose:
        import logging
        logging.getLogger("fetch_metadata").setLevel(logging.DEBUG)

    # 加载配置（支持环境变量）
    cfg_path = Path(args.config).expanduser().resolve()
    if not cfg_path.exists():
        print(f"错误: 配置文件不存在: {cfg_path}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 显式加载 .env 文件
    if args.env_file:
        env_path = Path(args.env_file).expanduser().resolve()
    else:
        env_path = cfg_path.parent / ".env"
    load_dotenv(env_path)
    if env_path.exists():
        logger.info(f"已加载环境配置: {env_path}")
    else:
        logger.warning(f"未找到 .env 文件: {env_path}，请确认文件路径是否正确")

    try:
        cfg = resolve_config(cfg_path)
    except Exception as e:
        print(f"错误: 配置加载失败: {e}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 【v7.0 新增】初始化性能配置（统一并发配置管理）
    _init_performance_config(cfg)

    # 初始化磁盘持久化缓存（从配置读取参数）
    _init_disk_cache(cfg)

    # 初始化 Redis 缓存（从配置读取参数）
    init_redis_cache(cfg)
    if is_redis_available():
        logger.info("Redis 缓存已启用（跨进程共享）")
    else:
        logger.debug("Redis 缓存未启用，将跳过")

    # 先合并命令行覆盖再校验（与 ultimate_metadata_query 一致，避免仅依赖 --allbillname 仍报 yaml 空值）
    _apply_workspace_cli_overrides(cfg, args)
    _apply_request_cli_overrides(cfg, args)

    errors = validate_api_config(cfg)
    if errors:
        print("配置验证失败:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        if not args.validate:
            return ExitCode.CONFIG_ERROR

    if args.validate:
        print("配置验证通过", file=sys.stderr)
        return ExitCode.SUCCESS

    payload, err = run_all_bills(cfg)
    if err:
        print(err, file=sys.stderr)
        print(json.dumps({"error": err}, ensure_ascii=False))
        return ExitCode.NETWORK_ERROR

    # 处理选择：插件 / Agent 下 stdin 非 TTY，只输出可解析的 stdout，由侧栏点选后带 code/id 重试
    selection_info = payload.get("selection")
    if selection_info:
        items = selection_info.get("items", [])
        names = selection_info.get("names", [])
        billname = selection_info.get("billname", "")
        if not items or not names:
            return ExitCode.CONFIG_ERROR

        ui_text = _format_selection_stdout_for_ui(selection_info)
        if not _should_interactive_selection_prompt():
            # searchByName 多对象的提示须独占 stdout 末尾，不可再拼接 JSON，
            # 否则 Chat 侧栏 parseBillNameChoiceFromStdout 会误把 JSON 并入选项。
            print(ui_text, end="")
            return ExitCode.SUCCESS

        print(ui_text, end="", file=sys.stdout)
        print(
            f"\n找到多个业务对象，请在终端为 [{billname}] 选择对应序号：",
            file=sys.stderr,
        )

        while True:
            for i, name in enumerate(names):
                print(f"  [{i+1}] {name}", file=sys.stderr)
            try:
                choice = input("\n请输入序号 (1-" + str(len(names)) + ") 或 q 退出: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n已退出", file=sys.stderr)
                return ExitCode.USER_CANCEL

            if choice.lower() == "q":
                print("已退出", file=sys.stderr)
                return ExitCode.USER_CANCEL

            try:
                idx = int(choice) - 1
                if 0 <= idx < len(items):
                    selected = items[idx]
                    req = cfg.setdefault("request", {})
                    req["_selected_bo_code"] = selected.get("code")
                    req["_selected_bo_id"] = selected.get("id")
                    req["_selected_bo_name"] = selected.get("name")
                    logger.info(
                        f"已选择: {selected.get('name')} (code={selected.get('code')})"
                    )
                    break
                else:
                    print(f"无效的选择，请输入 1-{len(names)} 之间的数字", file=sys.stderr)
            except ValueError:
                print("无效的输入，请输入数字或 q 退出", file=sys.stderr)

        # 重新运行，使用选中的业务对象
        payload, err = run_all_bills(cfg)
        if err:
            print(err, file=sys.stderr)
            print(json.dumps({"error": err}, ensure_ascii=False))
            return ExitCode.NETWORK_ERROR

    write_outputs(cfg, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    # 【v7.0 新增】退出前刷新 Redis 写入缓冲区
    _flush_redis_write_buffer()

    if args.run_db_check:
        import subprocess

        db = cfg.get("database") or {}
        if db.get("enabled"):
            logger.info("运行数据库校验...")
            subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).parent / "db_query.py"),
                    "--config",
                    args.config,
                ],
                check=False,
            )

    return ExitCode.SUCCESS


if __name__ == "__main__":
    raise SystemExit(main())

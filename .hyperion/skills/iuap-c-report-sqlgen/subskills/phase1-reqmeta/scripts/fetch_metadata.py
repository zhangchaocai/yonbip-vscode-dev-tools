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
    delete_cached_metadata,
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

# 【v8.4 新增】Session Cache 索引引擎（SQLite + LRU 内存缓存）
try:
    from session_cache_indexer import SessionCacheIndex, get_session_cache_index, load_session_cache_to_index
    _SESSION_CACHE_INDEX_AVAILABLE = True
except ImportError:
    SessionCacheIndex = None
    get_session_cache_index = None
    load_session_cache_to_index = None
    _SESSION_CACHE_INDEX_AVAILABLE = False

# 全局日志记录器（须在快速查找 try 之前，避免 ImportError 分支引用未定义 logger）
logger = get_logger("fetch_metadata")

# 全局 FastLookup 实例（进程内单例，避免重复加载 JSON）
_fast_lookup_instance: Optional[MetadataFastLookup] = None

# 【v6.0 新增】全局 entities 索引实例（进程内单例，延迟初始化）
_entities_index_instance: Optional[Any] = None

# ============================================================
# 【P0 优化】Session 级跨进程实体缓存
# 解决：AI Agent 多次调用时，每次 fetch_metadata.py 都是独立进程，
#       进程内缓存无法跨进程共享，导致相同业务对象被重复拉取。
#
# 策略：
#   1. 每次 run_all_bills 完成后，将 billname → [entities] 写入 session_cache.json
#   2. 每次 run_all_bills 启动时，先加载 session_cache.json
#   3. 对于已有缓存的 billname，直接从缓存加载，跳过所有 API 调用
#   4. 新增的 billname 才走 API，最终结果合并到 session_cache
# ============================================================

_session_cache: Optional[Dict[str, List[Dict[str, Any]]]] = None
_session_cache_dir: Optional[Path] = None
_session_cache_lock = threading.Lock()


def _reset_entities_index() -> None:
    """【v8.5】重置全局 entities 索引实例，用于参照实体查询后重新加载"""
    global _entities_index_instance
    _entities_index_instance = None
    logger.info("已重置 entities 索引实例")


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


def _get_session_cache_dir(cfg: dict) -> Path:
    """
    获取 session 缓存目录。

    优先级：
      0. SCRIPT_ORIGINAL_CWD 环境变量（pip_install.sh 传入的用户原始 cwd）【v8.3 新增】
      1. YONBIP_REPORT_SQL_WORKSPACE 环境变量（显式指定工作空间）
      2. paths.workspace_root 配置项
      3. 向上搜索 SKILL_DIR 父路径，找已存在的 session_cache.json（健壮性保障）
      4. workspace_base(cfg) 推断结果
    """
    # 0. 【v8.3 新增】pip_install.sh 传入的原始 cwd
    original_cwd = os.environ.get("SCRIPT_ORIGINAL_CWD", "").strip()
    if original_cwd:
        p = Path(original_cwd).resolve()
        for candidate in [p, *p.parents]:
            if (candidate / ".hyperion").is_dir() or (candidate / ".git").is_dir():
                session_dir = candidate / "output" / "01_metadata"
                session_dir.mkdir(parents=True, exist_ok=True)
                return session_dir
        session_dir = p / "output" / "01_metadata"
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    # 1. 显式环境变量
    env_workspace = os.environ.get("YONBIP_REPORT_SQL_WORKSPACE", "").strip()
    if env_workspace:
        p = Path(env_workspace).expanduser()
        if not p.is_absolute():
            p = SKILL_DIR / p
        session_dir = p / "output" / "01_metadata"
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    paths = cfg.get("paths") or {}
    out_dir_str = paths.get("workspace_root") or ""
    if out_dir_str:
        p = Path(out_dir_str).expanduser()
        if not p.is_absolute():
            p = SKILL_DIR / p
    else:
        found = _find_session_cache_by_walking_up()
        if found:
            return found
        p = workspace_base(cfg)

    session_dir = p / "output" / "01_metadata"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def _find_session_cache_by_walking_up() -> Optional[Path]:
    """
    从 SKILL_DIR 向上搜索，找到包含 session_cache.json 的目录。
    """
    candidate = SKILL_DIR
    for _ in range(10):
        session_json = candidate / "output" / "01_metadata" / "session_cache.json"
        if session_json.exists():
            logger.debug(f"通过向上搜索找到 session_cache: {session_json}")
            return session_json.parent
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    return None


def _load_session_cache(cfg: dict) -> Dict[str, List[Dict[str, Any]]]:
    """
    加载 session 缓存（跨进程持久化的实体映射）。

    【v8.4 优化】优先使用 SQLite 索引引擎，回退到 JSON 文件加载。
    """
    global _session_cache, _session_cache_dir
    with _session_cache_lock:
        if _session_cache is not None:
            return _session_cache

        _session_cache = {}
        _session_cache_dir = _get_session_cache_dir(cfg)
        cache_file = _session_cache_dir / "session_cache.json"

        if _SESSION_CACHE_INDEX_AVAILABLE:
            try:
                idx = get_session_cache_index(cfg, cache_dir=str(_session_cache_dir))

                if cache_file.exists():
                    count = idx.load_from_json(str(cache_file))
                    if count > 0:
                        logger.info(
                            f"【SESSION CACHE】已从 JSON 迁移到 SQLite 索引: "
                            f"{count} 个业务对象 ({cache_file})"
                        )

                stats = idx.get_stats()
                billname_count = stats.get("billname_count", 0)
                entity_count = stats.get("total_entities", 0)
                if billname_count > 0:
                    logger.info(
                        f"【SESSION CACHE】SQLite 索引已加载: "
                        f"{billname_count} 个业务对象, {entity_count} 个实体 "
                        f"(查询走内存 <0.1ms)"
                    )
                    return _session_cache

            except Exception as e:
                logger.warning(f"Session Cache SQLite 加载失败，回退到 JSON: {e}")

        if not cache_file.exists():
            logger.info(f"Session 缓存不存在，将从 {cache_file} 创建新缓存")
            return _session_cache

        try:
            with cache_file.open("r", encoding="utf-8") as f:
                _session_cache = json.load(f)
            total_entities = sum(len(v) for v in _session_cache.values())
            logger.info(
                f"【SESSION CACHE】已加载 session 缓存: "
                f"{len(_session_cache)} 个业务对象, {total_entities} 个实体 "
                f"({cache_file})"
            )
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Session 缓存加载失败，将创建新缓存: {e}")
            _session_cache = {}

    return _session_cache


def _save_session_cache(cfg: dict, cache: Dict[str, List[Dict[str, Any]]]) -> None:
    """
    保存 session 缓存到磁盘。
    """
    global _session_cache_dir
    if _session_cache_dir is None:
        _session_cache_dir = _get_session_cache_dir(cfg)

    cache_file = _session_cache_dir / "session_cache.json"

    if _SESSION_CACHE_INDEX_AVAILABLE:
        try:
            idx = get_session_cache_index(cfg, cache_dir=str(_session_cache_dir))

            for billname_lower, entities in cache.items():
                idx.put_by_billname(billname_lower, entities, async_write=True)

            logger.debug(f"Session 缓存已提交到 SQLite（异步写入中）")
            return
        except Exception as e:
            logger.warning(f"Session Cache SQLite 写入失败，回退到 JSON: {e}")

    tmp_file = cache_file.with_suffix(".json.tmp")
    try:
        tmp_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_file.replace(cache_file)
        logger.debug(f"Session 缓存已保存: {cache_file} ({len(cache)} 个业务对象)")
    except IOError as e:
        logger.warning(f"Session 缓存写入失败: {e}")


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
            # 相对路径解析策略：
            # 1. 先尝试相对于 SKILL_DIR（标准用法）
            # 2. 如果不存在，再尝试相对于 workspace_base（兼容项目根目录路径）
            json_p = Path(json_path).expanduser()
            if not json_p.is_absolute():
                # 尝试 SKILL_DIR 基准
                p1 = (SKILL_DIR / json_p).resolve()
                # 尝试 workspace 基准
                from iuap_common.paths_util import workspace_base
                cfg_for_workspace = cfg or {}
                p2 = (workspace_base(cfg_for_workspace) / json_p).resolve()
                # 选择存在的那个
                if p1.exists():
                    p = p1
                elif p2.exists():
                    p = p2
                else:
                    p = p1  # 用 SKILL_DIR 的路径作为默认值（后续会警告）
            else:
                p = json_p.resolve()
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


def _del_cached_byname(billname: str) -> None:
    """删除 searchByName 缓存（用于解析失败时清除陈旧缓存）"""
    delete_cached_metadata(f"byname:{billname}")


def _get_cached_byboid(boid: str) -> Optional[str]:
    """从缓存获取 getEntityListByBOId 结果（仅 Redis）"""
    return get_cached_metadata(f"byboid:{boid}")


def _set_cached_byboid(boid: str, data: str) -> None:
    """缓存 getEntityListByBOId 结果到 Redis"""
    set_cached_metadata(f"byboid:{boid}", data)


def _get_entityid_disk_cache_path(entity_id: str) -> Path:
    """获取 entityid 磁盘缓存文件路径"""
    h = hashlib.sha256(entity_id.encode("utf-8")).hexdigest()[:16]
    return _disk_cache_dir / f"entityid_{h}.json"


def _get_cached_entityid_disk(entity_id: str) -> Optional[str]:
    """从磁盘缓存获取 entityid 数据（检查 TTL）"""
    if not _disk_cache_enabled:
        return None
    p = _get_entityid_disk_cache_path(entity_id)
    if not p.exists():
        return None
    mtime = p.stat().st_mtime
    if time.time() - mtime > _disk_cache_ttl:
        logger.debug(f"[DISK] entityid 缓存过期: {entity_id}")
        return None
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        logger.debug(f"[DISK] 读取 entityid 缓存失败: {e}")
        return None


def _set_cached_entityid_disk(entity_id: str, data: str) -> None:
    """写入 entityid 数据到磁盘缓存"""
    if not _disk_cache_enabled:
        return
    p = _get_entityid_disk_cache_path(entity_id)
    try:
        _disk_cache_dir.mkdir(parents=True, exist_ok=True)
        p.write_text(data, encoding="utf-8")
        logger.debug(f"[DISK] entityid 缓存写入: {entity_id}")

        if _disk_cache_max_entries > 0:
            all_files = sorted(
                _disk_cache_dir.glob("entityid_*.json"),
                key=lambda f: f.stat().st_mtime,
            )
            if len(all_files) > _disk_cache_max_entries:
                evict_count = max(1, _disk_cache_max_entries // 5)
                for f in all_files[:evict_count]:
                    try:
                        f.unlink()
                    except OSError:
                        pass
    except Exception as e:
        logger.debug(f"[DISK] 写入 entityid 缓存失败: {e}")


def _get_cached_entityid(entity_id: str) -> Optional[str]:
    """
    从缓存获取 getEntityInfoByBOIdAndEntityId 结果。

    缓存层级（v11.0 新增磁盘缓存）：
      1. Redis 缓存 → 跨进程共享
      2. 磁盘缓存 → 本地持久化兜底（Redis 不可用时）

    【v11.0 优化】当 Redis 不可用时，从磁盘缓存回退，避免重复请求 API。
    """
    # 1. 先查 Redis
    cached = get_cached_metadata(f"entityid:{entity_id}")
    if cached:
        logger.debug(f"[CACHE] entityid Redis命中: {entity_id}")
        return cached

    # 2. Redis 未命中，查磁盘缓存（兜底）
    disk_cached = _get_cached_entityid_disk(entity_id)
    if disk_cached:
        logger.info(f"[DISK] entityid 磁盘缓存命中: {entity_id}")
        # 回填 Redis（如果可用）
        try:
            set_cached_metadata(f"entityid:{entity_id}", disk_cached)
        except Exception:
            pass
        return disk_cached

    return None


def _set_cached_entityid(entity_id: str, data: str) -> None:
    """
    缓存 getEntityInfoByBOIdAndEntityId 结果。

    【v11.0 优化】Redis + 磁盘双写，确保 Redis 不可用时数据不丢失。
    """
    # 1. 写 Redis
    try:
        set_cached_metadata(f"entityid:{entity_id}", data)
    except Exception as e:
        logger.debug(f"[CACHE] entityid Redis写入失败: {e}")

    # 2. 写磁盘（确保持久化）
    _set_cached_entityid_disk(entity_id, data)


def _extract_business_properties_from_raw(raw_json: str) -> Optional[List[Dict[str, Any]]]:
    """
    从 getEntityInfoByBOIdAndEntityId 返回的原始 JSON 中提取 businessProperties。

    Args:
        raw_json: getEntityInfoByBOIdAndEntityId 返回的原始 JSON 字符串

    Returns:
        businessProperties 列表，如果不存在则返回 None
    """
    try:
        db_obj = json.loads(raw_json)
        data_node = db_obj.get("data", {})
        if isinstance(data_node, dict):
            inner = data_node.get("data", {})
            if isinstance(inner, dict):
                biz_props = inner.get("businessProperties", [])
                if isinstance(biz_props, list) and biz_props:
                    return biz_props
    except Exception as e:
        logger.debug(f"[ENRICH] 解析 businessProperties 失败: {e}")
    return None


def _enrich_business_properties(entities: List[Dict[str, Any]]) -> None:
    """
    【v11.0 新增】补充实体的 businessProperties。

    从 getEntityInfoByBOIdAndEntityId 的磁盘缓存中提取 businessProperties，
    解决：主表的 businessProperties 在 queryByUri 中为空，导致特征表 allTables 解析问题。

    Args:
        entities: 实體列表（原地修改）
    """
    enriched_count = 0
    skipped_no_entity_id = 0
    skipped_has_bp = 0
    skipped_no_cache = 0

    for ent in entities:
        # 已有 businessProperties 的跳过
        if ent.get("businessProperties"):
            skipped_has_bp += 1
            continue

        # 没有 entityId 的跳过
        entity_id = ent.get("entityId")
        if not entity_id:
            skipped_no_entity_id += 1
            continue

        # 从磁盘缓存读取
        raw_json = _get_cached_entityid_disk(entity_id)
        if not raw_json:
            skipped_no_cache += 1
            continue

        # 提取 businessProperties
        bp = _extract_business_properties_from_raw(raw_json)
        if bp:
            ent["businessProperties"] = bp
            enriched_count += 1
            logger.debug(f"[ENRICH] 实体 {ent.get('uri')} 补充了 {len(bp)} 个 businessProperties")

    logger.info(
        f"[ENRICH] businessProperties 补充完成: "
        f"补充 {enriched_count} 个, 已有 {skipped_has_bp} 个, "
        f"无entityId {skipped_no_entity_id} 个, 无缓存 {skipped_no_cache} 个"
    )


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


def _fetch_schema_via_three_apis(cfg: dict, uri: str) -> Optional[str]:
    """
    【v12.x 新增】通过 searchByName → getEntityListByBOId → getEntityInfoByBOIdAndEntityId 三级调用获取 schema。

    入参：
        uri: BIP 业务对象 URI，如 "aa.merchant.Merchant"

    返回：
        schema 字符串，或 None（获取失败时）

    逻辑：
        1. 直接使用 URI 作为 searchByName 的搜索 key
        2. searchByName 返回多个结果时，严格用 URI 精确匹配
        3. 获取 id 后，调用 getEntityListByBOId → getEntityInfoByBOIdAndEntityId
        4. 返回 schema
    """
    import re

    api = cfg.get("api") or {}
    byname_path = api.get("metadata_byname", "")
    byboid_path = api.get("metadata_byboid", "")
    ent_path = api.get("metadata_entityid", "")

    # 1. 直接使用 URI 作为 searchByName 的搜索 key
    if not uri:
        logger.warning(f"[Three APIs] URI 为空")
        return None

    # 2. 调用 searchByName
    logger.info(f"[Three APIs] searchByName 请求: {uri}")
    try:
        raw = http_get_json(cfg, byname_path, {"key": uri})
    except Exception as e:
        logger.warning(f"[Three APIs] searchByName 请求失败: {e}")
        return None

    # 3. 解析 searchByName 结果，找精确匹配 URI 的项
    data_node = raw.get("data") if isinstance(raw, dict) else None
    if not isinstance(data_node, dict):
        logger.warning(f"[Three APIs] searchByName 返回数据格式异常: {raw}")
        return None

    # searchByName 返回结构可能是 {bill: [...]} 或 {BUSINESSOBJECT: [...], METACLASS: [...]}
    # 需要同时搜索顶层 bill 和嵌套的 BUSINESSOBJECT/METACLASS 的 children 数组
    bill_list = data_node.get("bill") or []

    # 严格 URI 匹配
    matched = None
    matched_boid = None  # 如果 URI 在 children 中找到，需要用 parent 的 id
    matched_code = None

    # 1. 先搜索顶层 bill
    for item in bill_list:
        item_uri = item.get("uri") or ""
        if item_uri == uri:
            matched = item
            matched_boid = matched.get("id") or matched.get("boId")
            matched_code = matched.get("code") or ""
            logger.info(f"[Three APIs] searchByName URI 精确匹配（顶层）: {uri}")
            break

    # 2. 如果顶层没找到，搜索 BUSINESSOBJECT/METACLASS 的 children
    if not matched:
        for key in ("BUSINESSOBJECT", "METACLASS"):
            for category in data_node.get(key, []) or []:
                if not isinstance(category, dict):
                    continue
                parent_id = category.get("id") or category.get("boId")
                parent_code = category.get("code") or ""
                children = category.get("children") or []
                for child in children:
                    child_uri = child.get("uri") or ""
                    if child_uri == uri:
                        matched = child
                        matched_boid = parent_id  # 用 parent 的 id
                        matched_code = parent_code  # 用 parent 的 code
                        logger.info(f"[Three APIs] searchByName URI 精确匹配（{key} children）: {uri}")
                        break
                if matched:
                    break
            if matched:
                break

    if not matched:
        # 没找到精确匹配，取第一个
        if bill_list:
            matched = bill_list[0]
            matched_boid = matched.get("id") or matched.get("boId")
            matched_code = matched.get("code") or ""
        else:
            # 尝试从 BUSINESSOBJECT/METACLASS 取第一个
            for key in ("BUSINESSOBJECT", "METACLASS"):
                categories = data_node.get(key, []) or []
                if categories and isinstance(categories[0], dict):
                    first_cat = categories[0]
                    children = first_cat.get("children") or []
                    if children and isinstance(children[0], dict):
                        matched = children[0]
                        matched_boid = first_cat.get("id") or first_cat.get("boId")
                        matched_code = first_cat.get("code") or ""
                        break
        logger.warning(f"[Three APIs] searchByName 未找到 URI={uri}，使用: {matched.get('uri') if matched else 'None'}")

    if not matched:
        logger.warning(f"[Three APIs] searchByName 未能找到有效的业务对象: {uri}")
        return None

    # 判断 parent id 是否有效（parent id 为空时使用 child id）
    parent_id_valid = bool(matched_boid and matched_boid != matched.get("id"))
    use_child_id = not parent_id_valid and bool(matched.get("id"))

    if not matched_boid and not use_child_id:
        logger.warning(f"[Three APIs] searchByName 未能找到有效的业务对象: {uri}")
        return None

    boid = matched_boid if matched_boid else ""
    code = matched_code
    bill_uri = matched.get("uri") or ""

    entity_id = None
    if use_child_id:
        # parent id 为空，直接使用 child id 作为 entity_id，跳过 getEntityListByBOId
        entity_id = matched.get("id")
        ent_boid = entity_id
        ent_code = ""
        logger.info(f"[Three APIs] 跳过 getEntityListByBOId，直接使用 child id: {entity_id}")
        # parent id 为空，直接使用 child id 作为 entity_id，跳过 getEntityListByBOId
        entity_id = matched.get("id")
        ent_boid = entity_id
        ent_code = ""
        logger.info(f"[Three APIs] 跳过 getEntityListByBOId，直接使用 child id: {entity_id}")
    else:
        # 正常流程：先调用 getEntityListByBOId
        logger.info(f"[Three APIs] getEntityListByBOId 请求: boId={boid}, code={code}")
        try:
            raw_boid = http_get_json(cfg, byboid_path, {"boId": boid, "businessObjectCode": code})
        except Exception as e:
            logger.warning(f"[Three APIs] getEntityListByBOId 请求失败: {e}")
            return None

        entity_list = raw_boid.get("data") or {}
        if isinstance(entity_list, dict):
            inner = entity_list.get("data")
            if isinstance(inner, dict):
                entity_list = inner.get("entities") or []
            else:
                entity_list = entity_list.get("entities") or []
        if not entity_list:
            logger.warning(f"[Three APIs] getEntityListByBOId 返回空: boid={boid}")
            return None

        if isinstance(entity_list, list) and len(entity_list) > 0:
            first_entity = entity_list[0]
        else:
            first_entity = entity_list
        entity_id = _text(first_entity, "id") if isinstance(first_entity, dict) else None
        ent_boid = _text(first_entity, "businessObjectId") if isinstance(first_entity, dict) else None
        ent_code = _text(first_entity, "businessObjectCode") if isinstance(first_entity, dict) else None
        if not entity_id:
            logger.warning(f"[Three APIs] getEntityListByBOId 结果缺少 entity id: {first_entity}")
            return None

    # 5. 调用 getEntityInfoByBOIdAndEntityId
    logger.info(f"[Three APIs] getEntityInfoByBOIdAndEntityId 请求: entityId={entity_id}, boId={ent_boid or boid}")
    try:
        raw_ent = http_get_json(cfg, ent_path, {
            "entityId": entity_id,
            "uri": bill_uri or "",
            "boId": ent_boid or boid or "",
            "businessObjectCode": ent_code or code or "",
        })
    except Exception as e:
        logger.warning(f"[Three APIs] getEntityInfoByBOIdAndEntityId 请求失败: {e}")
        return None

    # 6. 从返回结果中提取 schema
    ent_data = raw_ent.get("data") if isinstance(raw_ent, dict) else None
    if isinstance(ent_data, dict):
        # 尝试直接获取 schema
        schema = ent_data.get("schema")
        if schema:
            logger.info(f"[Three APIs] 获取到 schema: {uri} → {schema}")
            return schema
        # 嵌套结构：data.data.schema
        inner = ent_data.get("data")
        if isinstance(inner, dict):
            schema = inner.get("schema")
            if schema:
                logger.info(f"[Three APIs] 从 data.data 获取 schema: {uri} → {schema}")
                return schema
        # 兜底：从 groups 中查找 schema
        groups = inner.get("groups") if isinstance(inner, dict) else None
        if isinstance(groups, list):
            for group in groups:
                if isinstance(group, dict) and group.get("schema"):
                    logger.info(f"[Three APIs] 从 groups 获取 schema: {uri} → {group.get('schema')}")
                    return group.get("schema")

    logger.warning(f"[Three APIs] 未能从 API 响应中提取 schema: {uri}")
    return None


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
    uri: Optional[str] = None  # 【v9.0 新增】URI 字段
    available_names: Optional[List[str]] = None
    available_items: Optional[List[Dict[str, Optional[str]]]] = None
    not_found: bool = False
    not_found_reason: Optional[str] = None

    def needs_selection(self) -> bool:
        return bool(self.available_items and len(self.available_items) > 1)


def parse_business_object_code_name(result: Any, billname: str, cfg: dict = None) -> Optional[CodeNameResult]:
    """解析业务对象响应，提取编码和名称"""
    import re
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

    # 【v11.x 新增】检测 code=xxx 格式，使用预选的 item 直接返回，跳过 API 搜索
    # 格式：原名（code=xxx）由自动选择逻辑生成
    code_match = re.search(r'[（(]code=([^）)]+)[）)]', search_name)
    if code_match:
        direct_code = code_match.group(1).strip()
        # 从请求上下文的 _pre_selected_items 中查找对应 code 的 item
        req = (cfg or {}).get("request", {}) if cfg else {}
        pre_selected = req.get("_pre_selected_items") or []
        matched_item = None
        for item in pre_selected:
            if item.get("code") == direct_code:
                matched_item = item
                break
        if matched_item:
            logger.info(f"[自动选择 v11.x] 匹配到预选 item: code={direct_code}, name={matched_item.get('name')}")
            return CodeNameResult(
                code=matched_item.get("code"),
                name=matched_item.get("name"),
                id=matched_item.get("id"),
                uri=matched_item.get("uri")
            )
        else:
            logger.warning(f"[自动选择 v11.x] 未在 _pre_selected_items 中找到 code={direct_code}")

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
            uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
            if code and code != "null":
                exact_tn.append({"code": code, "name": name, "id": id_, "uri": uri_})
    exact_tn = _dedupe_by_code(exact_tn)
    if len(exact_tn) == 1:
        o = exact_tn[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"), uri=o.get("uri"))
    if len(exact_tn) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in exact_tn]
        return CodeNameResult(available_names=names, available_items=exact_tn)

    # 检查是否为空数据（查无此单据）
    if not target_nodes and not nodes_with_parent:
        logger.warning(
            f"searchByName 返回空数据，未找到业务对象: billname={search_name}，"
            f"请检查单据名称是否正确，或该单据是否已发布到 BIP 平台"
        )
        # 【v11.1 新增】FastLookup 回退：当 API 返回空时，尝试从 metadata_lookup.json 查找
        try:
            fast_lookup = _get_fast_lookup(cfg)
            if fast_lookup.is_loaded:
                hits = fast_lookup.strict_lookup(search_name)
                if hits:
                    first = hits[0]
                    logger.info(f"[FastLookup 回退] searchByName 空数据，通过 FastLookup 找到: {first.uri}, schema={first.schema}")
                    if first.uri:
                        # 构造一个有效的 CodeNameResult，通过 queryUri 路径继续处理
                        r = CodeNameResult(
                            code=first.metadata_name or first.biz_name or search_name,
                            name=first.biz_name or search_name,
                            id=None,  # FastLookup 没有 id，需要后续通过 queryUri 获取
                            uri=first.uri
                        )
                        r._fastlookup_schema = first.schema  # 传递 schema 信息
                        r._fastlookup_match = True
                        return r
        except Exception as e:
            logger.warning(f"[FastLookup 回退] 查找失败: {e}")
        # FastLookup 也找不到，返回 not_found
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
            uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
            exact_wp.append(
                {"code": parent_code, "name": name, "id": _text(node, "id"), "uri": uri_}
            )
    exact_wp = _dedupe_by_code(exact_wp)
    if len(exact_wp) == 1:
        o = exact_wp[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"), uri=o.get("uri"))
    if len(exact_wp) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in exact_wp]
        return CodeNameResult(available_names=names, available_items=exact_wp)

    sub_tn: List[Dict[str, Optional[str]]] = []
    for node in target_nodes:
        name = _text(node, "name")
        if name and search_name in name:
            code = _text(node, "code")
            id_ = _text(node, "id")
            uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
            if code and code != "null":
                sub_tn.append({"code": code, "name": name, "id": id_, "uri": uri_})
    sub_tn = _dedupe_by_code(sub_tn)
    if len(sub_tn) == 1:
        o = sub_tn[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"), uri=o.get("uri"))
    if len(sub_tn) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in sub_tn]
        return CodeNameResult(available_names=names, available_items=sub_tn)

    sub_wp: List[Dict[str, Optional[str]]] = []
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        if name and search_name in name and parent_code and parent_code != "null":
            uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
            sub_wp.append(
                {"code": parent_code, "name": name, "id": _text(node, "id"), "uri": uri_}
            )
    sub_wp = _dedupe_by_code(sub_wp)
    if len(sub_wp) == 1:
        o = sub_wp[0]
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"), uri=o.get("uri"))
    if len(sub_wp) > 1:
        names = [f"{x.get('name') or ''}（{x.get('code') or ''}）" for x in sub_wp]
        return CodeNameResult(available_names=names, available_items=sub_wp)

    # 【v11.x 新增】无业务对象实体 fallback：当正常的 METACLASS（有 parent_code）没有找到任何实体时，
    # 检查 "无业务对象实体" 类型 METACLASS（parent_code 为 null，但 children 有有效 id）
    # 类似 _fetch_schema_via_three_apis 中的 use_child_id 逻辑
    no_parent_nodes: List[Dict[str, Optional[str]]] = []
    for node, parent_code in nodes_with_parent:
        if parent_code is None or parent_code == "null":
            name = _text(node, "name")
            if name == search_name:
                node_id = _text(node, "id")
                uri_ = _text(node, "uri")
                if node_id and node_id != "null":
                    # use_child_id 逻辑：parent id 无效但 child id 有效，跳过 getEntityListByBOId
                    # 注意：这里 code 为空串，不使用 _dedupe_by_code（它会过滤掉空 code）
                    no_parent_nodes.append({"code": "", "name": name, "id": node_id, "uri": uri_})
    if len(no_parent_nodes) == 1:
        o = no_parent_nodes[0]
        logger.info(f"[无业务对象实体 fallback] 匹配到: name={o['name']}, id={o['id']}, uri={o['uri']}")
        return CodeNameResult(code=o["code"], name=o["name"], id=o.get("id"), uri=o.get("uri"))
    if len(no_parent_nodes) > 1:
        names = [f"{x.get('name') or ''}（id={x.get('id') or ''}）" for x in no_parent_nodes]
        return CodeNameResult(available_names=names, available_items=no_parent_nodes)

    # 收集所有候选业务对象及其完整信息（code、name、id、uri）
    all_items: List[Dict[str, Optional[str]]] = []
    seen_codes: Set[str] = set()
    for node in target_nodes:
        name = _text(node, "name")
        code = _text(node, "code")
        uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
        if name and code and code != "null" and code not in seen_codes:
            all_items.append({"code": code, "name": name, "id": _text(node, "id"), "uri": uri_})
            seen_codes.add(code)
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        uri_ = _text(node, "uri")  # 【v9.0 新增】提取 URI
        if name and parent_code and parent_code != "null" and parent_code not in seen_codes:
            all_items.append({"code": parent_code, "name": name, "id": _text(node, "id"), "uri": uri_})
            seen_codes.add(parent_code)

    if len(all_items) == 1:
        # 【v12.x 修复】只有一个候选时，检查 name 是否匹配搜索词
        # 如果 name 不匹配（票据工作台→票据动作），检查 code 是否匹配搜索词
        item = all_items[0]
        item_name = item.get("name") or ""
        item_code = item.get("code") or ""
        # 精确匹配 或 搜索词是候选名的子串/父串 → 直接使用
        if item_name == search_name or search_name in item_name or item_name in search_name:
            return CodeNameResult(code=item["code"], name=item["name"], id=item.get("id"), uri=item.get("uri"))
        # 【v12.x 新增】name 不匹配但 code 匹配搜索词 → 直接使用（用户显式指定了 code）
        # 场景："票据工作台" 匹配到 name=票据动作, code=票据工作台
        if item_code == search_name:
            return CodeNameResult(code=item["code"], name=item["name"], id=item.get("id"), uri=item.get("uri"))
        # name 和 code 都不匹配 → 改为选择列表，让用户确认
        all_names = [item["name"] for item in all_items]
        return CodeNameResult(available_names=all_names, available_items=all_items)
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
                    # 【v10.4 优化】从 allColumns 中提取特征字段的列信息
                    all_cols = cf.get("allColumns", [])
                    col_info = {}
                    if isinstance(all_cols, list) and all_cols:
                        for col in all_cols:
                            if isinstance(col, dict):
                                col_name = _text(col, "columnName")
                                if col_name:
                                    col_info[col_name] = {
                                        "displayName": _text(col, "displayName"),
                                        "type": _text(col, "type"),
                                        "typeUri": _text(col, "typeUri"),
                                    }
                    model["businessProperties"].append(
                        {
                            "name": _text(cf, "name"),
                            "displayName": _text(cf, "displayName"),
                            "uri": _text(cf, "uri"),
                            "tableName": ctbl,
                            "isCharacterField": True,  # 【v10.4】标记为特征字段
                            "columns": col_info,  # 【v10.4】特征字段的列信息
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


# 【v12.x 新增】匹配阈值配置
_MATCH_SCORE_EXACT = 1.0       # 精准匹配（完全相等）
_MATCH_SCORE_SUBSTRING = 0.8   # 子串匹配
_MATCH_SCORE_SYNONYM = 0.6     # 同义词匹配
_MATCH_THRESHOLD_DEFAULT = 0.5  # 默认阈值


def calc_match_score(excel_col: str, meta_field: str) -> float:
    """
    计算 Excel 列名与元数据字段的相似度分数 (0.0 ~ 1.0)

    评分规则：
    1. 精准匹配（规范化后完全相等）= 1.0
    2. 子串匹配 = 0.8 × 长度比率
    3. 同义词匹配 = 0.6
    4. 编辑距离 ≤ 2 = 0.5
    5. 其他 = 0.0

    入参：
        excel_col: Excel 列头名称
        meta_field: 元数据字段 displayName
    返回：
        0.0 ~ 1.0 的相似度分数
    """
    if not excel_col or not meta_field:
        return 0.0

    excel_col = excel_col.strip()
    meta_field = meta_field.strip()
    if not excel_col or not meta_field:
        return 0.0

    excel_norm = _normalize_text(excel_col)
    meta_norm = _normalize_text(meta_field)

    # 规则1：精准匹配 = 1.0
    if excel_norm == meta_norm:
        return _MATCH_SCORE_EXACT

    # 规则2：互为子串 = 0.8 × 长度比率
    # 注意：子串匹配时，被包含者更具体，应该得更高分
    # 例如：excel="单据日期"，meta="日期" → excel被meta包含，excel更具体 → 较高分
    #       excel="日期"，meta="单据日期" → meta包含excel，meta更具体 → 较低分
    if excel_norm in meta_norm:
        # Excel 列名被元数据包含 → Excel更具体 → 较高分
        longer = len(meta_norm)
        shorter = len(excel_norm)
        return _MATCH_SCORE_SUBSTRING * (shorter / longer) + 0.1  # 加权提升
    if meta_norm in excel_norm:
        # 元数据被Excel列名包含 → 元数据更具体 → 基础分
        longer = len(excel_norm)
        shorter = len(meta_norm)
        return _MATCH_SCORE_SUBSTRING * (shorter / longer)

    # 规则3：同义词匹配 = 0.6
    excel_lower = excel_col.lower()
    meta_lower = meta_field.lower()
    if excel_lower in _SYNONYM_MAP:
        synonyms = _SYNONYM_MAP[excel_lower]
        if meta_lower in synonyms or meta_norm in {_normalize_text(s) for s in synonyms}:
            return _MATCH_SCORE_SYNONYM
    if meta_lower in _SYNONYM_MAP:
        synonyms = _SYNONYM_MAP[meta_lower]
        if excel_lower in synonyms or excel_norm in {_normalize_text(s) for s in synonyms}:
            return _MATCH_SCORE_SYNONYM

    # 规则4：编辑距离 ≤ 2 = 0.5
    # 【v12.x 新增】编辑距离容错
    try:
        if _levenshtein_distance(excel_norm, meta_norm) <= 2:
            return 0.5
    except Exception:
        pass

    return 0.0


def _levenshtein_distance(s1: str, s2: str) -> int:
    """计算两个字符串的编辑距离（Levenshtein Distance）"""
    if len(s1) < len(s2):
        return _levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def _semantic_match_doc_fields(
    excel_cols: List[str],
    group: BizTableGroup,
    threshold: float = _MATCH_THRESHOLD_DEFAULT
) -> Tuple[List[str], List[str]]:
    """
    将 Excel 列头与元数据字段进行语义匹配（两阶段匹配）

    阶段1：精准匹配（score = 1.0），遍历所有字段，完全相等即匹配
    阶段2：阈值兜底，对未精准匹配的列，使用相似度阈值过滤

    返回: (matched_doc_fields, matched_attr_names)
      - matched_doc_fields: 与元数据字段语义匹配的 Excel 列名
      - matched_attr_names: 匹配上的元数据字段的 display_name 列表
    """
    if not excel_cols or not group.attributes:
        return [], []

    # 构建字段列表：(attr, display_name, attr_name)
    field_list: List[Tuple[Any, str, str]] = []
    for attr in group.attributes:
        display = (attr.display_name or "").strip()
        name = (attr.name or "").strip()
        if display:
            field_list.append((attr, display, name))

    # 阶段1：精准匹配
    matched_doc_fields: List[str] = []
    matched_attr_names: List[str] = []
    unmatched_cols: List[str] = []

    for col in excel_cols:
        col = col.strip()
        if not col:
            continue

        col_norm = _normalize_text(col)
        is_exact_matched = False

        # 遍历元数据字段，找精准匹配
        for attr, meta_display, meta_name in field_list:
            meta_norm = _normalize_text(meta_display)
            if col_norm == meta_norm:
                # 精准匹配
                if col not in matched_doc_fields:
                    matched_doc_fields.append(col)
                if meta_display not in matched_attr_names:
                    matched_attr_names.append(meta_display)
                is_exact_matched = True
                break  # 精准匹配找到一个就停止

        if not is_exact_matched:
            unmatched_cols.append(col)

    # 阶段2：阈值兜底（对未精准匹配的列）
    for col in unmatched_cols:
        col_norm = _normalize_text(col)
        best_score = 0.0

        for attr, meta_display, meta_name in field_list:
            # 尝试匹配 display_name
            score = 0.0
            if meta_display:
                score = calc_match_score(col, meta_display)

            # 尝试匹配 name（取较高分）
            if meta_name:
                name_score = calc_match_score(col, meta_name)
                score = max(score, name_score)

            if score >= threshold and score > best_score:
                best_score = score
                if col not in matched_doc_fields:
                    matched_doc_fields.append(col)
                # 优先使用 display_name
                matched_name = meta_display if meta_display else meta_name
                if matched_name not in matched_attr_names:
                    matched_attr_names.append(matched_name)

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
    # billObjects 在 parse_excel 返回值的顶层，不在 dataSource 内
    bill_objects = excel_result.get("billObjects", []) or data_source.get("billObjects", [])
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
    cfg: dict,
    excel_cols: Optional[List[str]] = None,
    request_text: Optional[str] = None,
    default_schema: Optional[str] = None,  # 【v8.5】FastLookup 或其他来源提供的默认 schema
    match_threshold: Optional[float] = None,  # 【v12.x】语义匹配阈值
) -> Optional[Dict[str, Any]]:
    """将 BizTableGroup 转换为实体映射字典"""
    max_ref = _max_reference_fields(cfg)

    # 【v10.0 修复】默认必需字段：报表 SQL 必需的基础字段，不依赖于 Excel 列头
    # 这些字段在生成 SQL 时通常需要，但用户可能没有在 Excel 中显式指定
    _DEFAULT_REQUIRED_FIELDS: Set[str] = {
        # 通用主表字段
        "id", "ID",
        # 审批/结算状态（筛选条件必需）
        "审批状态", "审批状态", "verifystate", "审批", "审核状态",
        "结算状态", "结算状态", "isettlestatus", "结算",
        "审批日期", "审批日期", "audit_date", "auditdate", "审核日期",
        "单据状态", "单据状态",
        # 金额相关
        "借款金额", "预付金额", "nloanmny",
        "核销金额", "已核销金额", "ncavmny", "核销(未清)",
        # 租户/组织字段
        "ytenant_id", "租户", "tenant_id",
    }

    # 【v8.8】schema 优先级：entity_model.schema > group.schema > default_schema
    schema_val = entity_model.get("schema") if entity_model else None
    if not schema_val:
        schema_val = getattr(group, 'schema', None) or default_schema

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
        # 【v12.x】动态阈值：根据 Excel 列数量确定阈值
        # - 列多(>20)：宽松匹配，threshold = 0.3
        # - 列少(<=20)：严格匹配，threshold = 0.5
        if match_threshold is None:
            n_cols = len(excel_cols) if excel_cols else 0
            match_threshold = 0.3 if n_cols > 20 else 0.5
        matched_docs, matched_attrs = _semantic_match_doc_fields(_candidate_fields_for_match, group, threshold=match_threshold)
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

    # 【v10.0 修复】确保默认必需字段的中文名称被包含在 effective_doc_fields 中
    # 这样过滤逻辑才能正确保留这些字段
    _DEFAULT_REQUIRED_DISPLAY_NAMES: Set[str] = {
        "审批状态", "结算状态", "审批日期", "单据状态",
        "借款金额", "预付金额", "核销金额", "已核销金额",
        "租户", "ytenant_id",
    }
    if effective_doc_fields and isinstance(effective_doc_fields, list):
        for name in _DEFAULT_REQUIRED_DISPLAY_NAMES:
            if name not in effective_doc_fields:
                effective_doc_fields.append(name)

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
    # 【v10.4 优化】收集特征字段信息，用于补充到 attributes
    character_fields_info: List[Dict[str, Any]] = []
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
            # 【v10.4】收集特征字段信息（包括主表的 characterFields）
            if bp.get("isCharacterField"):
                character_fields_info.append(bp)
            # 【v10.5 新增】也收集主表 businessProperty 中的 characterFields 信息
            # characterFields 包含特征表的具体字段定义（vcol1, vcol2 等）
            cfs = bp.get("characterFields")
            if isinstance(cfs, list):
                for cf in cfs:
                    if isinstance(cf, dict):
                        # 提取 characterField 的信息
                        cf_all_tables = cf.get("allTables", [])
                        cf_table_name = cf_all_tables[0] if cf_all_tables else None
                        cf_all_cols = cf.get("allColumns", [])
                        cf_cols_info = {}
                        if isinstance(cf_all_cols, list):
                            for col_item in cf_all_cols:
                                if isinstance(col_item, dict):
                                    col_n = _text(col_item, "columnName")
                                    if col_n:
                                        cf_cols_info[col_n] = {
                                            "displayName": _text(col_item, "displayName"),
                                            "type": _text(col_item, "type"),
                                            "typeUri": _text(col_item, "typeUri"),
                                        }
                        character_fields_info.append({
                            "name": _text(cf, "name"),
                            "displayName": _text(cf, "displayName"),
                            "uri": _text(cf, "uri"),
                            "tableName": cf_table_name,
                            "isCharacterField": True,
                            "columns": cf_cols_info,
                        })

    # 【优化 v5.0】仅收集匹配字段的参照 URI，不展开所有参照
    # 1. 先过滤出实际需要的属性（matched_attrs）
    # 【v7.0 修复】使用 effective_doc_fields 而非 doc_fields，
    # 因为 doc_fields 在函数内部重新赋值无法影响外部传入的值
    # 【v10.0 修复】当有 effective_doc_fields 时，同时保留默认必需字段
    # 【v12.1 修复】支持路径部分匹配：Excel列头可能是 "收款单基本信息.单据日期" 格式，
    #              需要检查 displayName 是否在路径字符串中
    matched_attrs: List[AttributeInfo] = []
    # 【v10.1 修复】将默认必需字段转为小写，用于不区分大小写的比较
    _default_required_lower: Set[str] = {f.lower() for f in _DEFAULT_REQUIRED_FIELDS}
    # 【临时禁用】注释掉表头过滤逻辑，不再需要 _path_doc_fields
    # _path_doc_fields: List[str] = [f for f in effective_doc_fields if "." in f]
    if is_sql_y and group.attributes:
        for attr in group.attributes:
            # 【临时禁用】注释掉表头过滤逻辑，默认返回所有属性
            # if effective_doc_fields:
            #     dn = attr.display_name or ""
            #     col = (attr.db_column_name or "").lower()
            #     # 【v12.1 修复】匹配条件：精确匹配 OR 路径部分匹配 OR 默认必需字段
            #     # 1. 精确匹配：displayName 在列表中（如 "单据日期" 直接匹配）
            #     # 2. 路径部分匹配：如 "收款单基本信息.单据日期" 包含 "单据日期"
            #     # 3. 默认必需字段：dbColumnName 在默认列表中
            #     matched = (
            #         dn in effective_doc_fields or
            #         any(dn in path for path in _path_doc_fields) or
            #         col in _default_required_lower
            #     )
            #     if not matched:
            #         continue
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
                            # 【v12.x 修复】优先使用 FastLookup 获取 schema
                            sch = None
                            fast_lookup = _get_fast_lookup(cfg)
                            if fast_lookup.is_loaded and attr_uri:
                                hit = fast_lookup.get_by_uri(attr_uri)
                                if hit and hit.schema:
                                    sch = hit.schema
                                    logger.info(f"[FastLookup] 参照 schema 命中: {attr_uri} → {sch}")
                            # 【v12.x】FastLookup URI 未命中时，调用 searchByName → byboid → entityid 三级 API 获取 schema
                            if not sch and attr_uri:
                                sch = _fetch_schema_via_three_apis(cfg, attr_uri)
                            if not sch or sch == "scheme":
                                sch = None  # 避免写入占位符
                            ref_structure["scheme"] = sch
                            am["referenceStructure"] = ref_structure
                    except (KeyError, IndexError) as e:
                        logger.warning(f"解析引用 {attr_uri} 失败: {e}")
        attrs_out.append(am)

    # 【v10.4 优化】将 businessProperties 中的特征字段信息补充到 attributes
    # 这些字段可能不在 group.attributes 中，但需要能被查询到
    existing_attr_names = {attr.db_column_name for attr in matched_attrs}
    for cf_info in character_fields_info:
        cf_table = cf_info.get("tableName", "")
        # 只处理属于当前 group 表的特征字段
        if cf_table and cf_table != group.table_name:
            continue
        # 获取特征字段的列信息
        cols = cf_info.get("columns", {})
        for col_name, col_data in cols.items():
            if col_name in existing_attr_names:
                continue
            # 【v10.4】添加特征字段到输出
            cf_attr_map: Dict[str, Any] = {
                "displayName": col_data.get("displayName") or cf_info.get("displayName") or col_name,
                "dbColumnName": col_name,
                "type": col_data.get("type") or col_data.get("typeUri") or "String",
                "tableName": cf_table or group.table_name,
                "isCharacterField": True,  # 【v10.4】标记为特征字段
            }
            # 如果特征字段有 URI，添加到 uris 列表以便后续处理
            cf_uri = cf_info.get("uri")
            if cf_uri and is_sql_y and cf_uri not in skipped_uris:
                # 为参照类型创建 referenceStructure
                ref_obj = uri_to_obj.get(cf_uri)
                if ref_obj:
                    try:
                        ref_groups = parse(ref_obj, fetch_uri_json)
                        if ref_groups:
                            ref_group = ref_groups[0]
                            ref_attrs: List[Dict[str, Any]] = []
                            for ra in ref_group.attributes or []:
                                if ra.name in ("name", "code"):
                                    ref_attrs.append({
                                        "dbColumnName": ra.db_column_name,
                                        "displayName": ra.display_name,
                                        "primarykey": "id",
                                    })
                            ref_structure: Dict[str, Any] = {
                                "billName": ref_group.bill_name,
                                "domain": ref_group.domain,
                                "tableName": ref_group.table_name,
                                "attributes": ref_attrs,
                            }
                            # 【v12.x 修复】优先使用 FastLookup 获取 schema
                            sch = None
                            fast_lookup = _get_fast_lookup(cfg)
                            if fast_lookup.is_loaded and cf_uri:
                                hit = fast_lookup.get_by_uri(cf_uri)
                                if hit and hit.schema:
                                    sch = hit.schema
                                    logger.info(f"[FastLookup] 特征字段参照 schema 命中: {cf_uri} → {sch}")
                            # 【v12.x】FastLookup URI 未命中时，调用 searchByName → byboid → entityid 三级 API 获取 schema
                            if not sch and cf_uri:
                                sch = _fetch_schema_via_three_apis(cfg, cf_uri)
                            ref_structure["scheme"] = sch if sch and sch != "scheme" else None
                            cf_attr_map["referenceStructure"] = ref_structure
                    except (KeyError, IndexError) as e:
                        logger.warning(f"解析特征字段参照 {cf_uri} 失败: {e}")
            attrs_out.append(cf_attr_map)

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
) -> Tuple[List[Dict[str, Any]], Optional[str], Dict[str, str]]:
    """为单个单据构建实体列表

    Returns:
        Tuple of (entities, error, char_class_ids)
    """
    api = cfg.get("api") or {}
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
    excel_cols: List[str] = []  # Excel 列头（用于语义匹配字段 displayName）
    data_source_fields: List[str] = []  # 【v5.1 新增】Excel "数据源字段"列值（用于过滤参照元数据）

    # 【优化 v11.x】优先使用 run_all_bills 中预解析的 Excel 结果，避免重复解析
    if cfg.get("_excel_parsed"):
        excel_cols = cfg.get("_excel_cols", [])
        data_source_fields = cfg.get("_data_source_fields", [])
        logger.info(f"【优化 v11.x】复用预解析的 Excel 结果: {len(excel_cols)} 个字段列头")
    elif excel_file:
        try:
            excel_path = Path(excel_file)
            if excel_path.exists():
                logger.info(f"从 Excel 自动提取信息: {excel_file}")
                excel_result = parse_excel(excel_path, int(req.get("excelSheetIndex", 0) or 0))
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
    # 【v8.5】检查是否有 URI 列表（来自 run_all_bills 的分割处理）
    uri_list = req.get("_query_uri_list") or []
    if uri_list:
        # 多个 URI：使用计数找到对应的 URI
        # 通过 request 中的计数器确定当前是第几个 metadata
        counter_key = "_query_uri_idx"
        current_idx = req.get(counter_key, 0)
        req[counter_key] = current_idx + 1
        quri = uri_list[current_idx] if current_idx < len(uri_list) else uri_list[0]
        logger.info(f"queryUri 批量查询 [{current_idx+1}/{len(uri_list)}]: {quri}")

    if quri:
        logger.info(f"直接通过 queryUri 查询: {quri}")

        def fetch_uri_direct(u: str) -> str:
            return _query_by_uri_cached(cfg, u)

        # 【v6.0 优化】使用 _query_by_uri_cached_parsed 直接获取已解析的对象
        db_obj = _query_by_uri_cached_parsed(cfg, quri)
        if db_obj is None:
            return [], f"错误: 无法获取 URI {quri} 的元数据", {}

        # 【v9.0 修复】检查 schema 是否存在
        # 【v10.2 调试】打印 db_obj 结构
        logger.info(f"[DEBUG] db_obj type: {type(db_obj)}, keys: {list(db_obj.keys()) if isinstance(db_obj, dict) else 'N/A'}")
        groups_data = db_obj.get("groups") or []
        if not groups_data:
            # 【v10.2 修复】处理多层嵌套的 data 结构
            data_obj = db_obj.get("data", {})
            logger.info(f"[DEBUG] data_obj type: {type(data_obj)}, keys: {list(data_obj.keys()) if isinstance(data_obj, dict) else 'N/A'}")
            # 逐层检查 groups
            for level in range(5):
                if "groups" in data_obj:
                    groups_data = data_obj["groups"] if isinstance(data_obj["groups"], list) else []
                    logger.info(f"[DEBUG] 层级 {level}: 找到 groups, count={len(groups_data)}")
                    break
                if isinstance(data_obj.get("data"), dict):
                    data_obj = data_obj["data"]
                else:
                    break
        logger.info(f"[DEBUG] groups_data: {len(groups_data)} 个")

        # 【v10.2 新增】如果 groups_data 为空，尝试从 data_obj 直接获取 URI 来匹配 FastLookup
        if not groups_data:
            fast_lookup = _get_fast_lookup(cfg)
            if fast_lookup.is_loaded:
                # 从 data_obj 获取 URI
                uri = data_obj.get("uri", "")
                bill_name = data_obj.get("displayName", "") or data_obj.get("title", "")
                logger.info(f"[FastLookup] 尝试直接匹配: uri={uri}, billName={bill_name}")
                if uri:
                    hit = fast_lookup.get_by_uri(uri)
                    if hit and hit.schema:
                        data_obj["schema"] = hit.schema
                        logger.info(f"[FastLookup] 直接 URI schema 补全: {uri} → {hit.schema}")
                if not data_obj.get("schema") and bill_name:
                    hits = fast_lookup.strict_lookup(bill_name)
                    if hits and hits[0].schema:
                        data_obj["schema"] = hits[0].schema
                        logger.info(f"[FastLookup] billName schema 补全: {bill_name} → {hits[0].schema}")

        # 【v10.2 新增】使用 FastLookup 补全 schema（通过 URI 直接匹配）
        fast_lookup = _get_fast_lookup(cfg)
        if not fast_lookup.is_loaded:
            logger.info("[FastLookup] 未加载，跳过 schema 补全")
        elif not groups_data:
            logger.info(f"[FastLookup] groups_data 为空，跳过（URI: {quri}）")
        else:
            logger.info(f"[FastLookup] 开始补全，共 {len(groups_data)} 个 group")
            for group in groups_data:
                if isinstance(group, dict):
                    uri = group.get("uri", "")
                    bn = group.get("billName", "")
                    logger.info(f"[FastLookup] 处理: uri={uri}, billName={bn}")
                    if not group.get("schema"):
                        # 【优先】通过 URI 直接匹配 FastLookup（使用 get_by_uri）
                        if uri:
                            hit = fast_lookup.get_by_uri(uri)
                            if hit and hit.schema:
                                group["schema"] = hit.schema
                                logger.info(f"[FastLookup] URI schema 补全: {uri} → {hit.schema}")
                            else:
                                logger.info(f"[FastLookup] URI 无命中: {uri}")
                        # 如果 URI 匹配失败，尝试通过 billName 匹配
                        if not group.get("schema") and bn:
                            hits = fast_lookup.strict_lookup(bn)
                            if hits and hits[0].schema:
                                group["schema"] = hits[0].schema
                                logger.info(f"[FastLookup] billName schema 补全: {bn} → {hits[0].schema}")
                            else:
                                logger.info(f"[FastLookup] billName 无命中: {bn}")

            # 【v10.2 修复】将补全后的 schema 写回 db_obj，让 parse() 能使用
            if "data" in db_obj and "groups" in db_obj["data"]:
                db_obj["data"]["groups"] = groups_data
            elif "groups" in db_obj:
                db_obj["groups"] = groups_data

        has_schema = any(
            isinstance(g, dict) and g.get("schema")
            for g in groups_data
        )

        if not has_schema:
            logger.warning(f"[WARN] queryUri 返回缺少 schema，且 FastLookup 无命中: {quri}")

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
            # 【v9.0】传递 default_schema
            default_schema = getattr(group, 'schema', None)
            emap = biz_table_group_to_entity_map(
                group,
                fake_ent,
                None,  # entity_model
                fkeys,
                data_source_fields or doc_fields,  # 【v5.1】优先用数据源字段过滤参照
                is_sql_y,
                str(table_template) if table_template is not None else None,
                fetch_uri_direct,
                cfg,
                excel_cols=excel_cols,  # 用于语义匹配
                request_text=request_text,  # 【v7.0】自然语言请求文本
                default_schema=default_schema,  # 【v9.0】传递 schema
            )
            if emap:
                results.append(emap)
        logger.info(f"queryUri 直查完成，共获取 {len(results)} 个实体")
        return results, None, {}

    logger.info(f"正在拉取单据: {billname_trim}")

    # ============================================================
    # 【v9.0 简化流程】
    # 1. searchByName → 获取 code, id, uri
    # 2. queryByUri (Redis) → 查询元数据
    # 3. 检查 schema：
    #    - 有 schema → 实体正确，直接使用
    #    - 无 schema → 调用 byboid + getEntityInfoByBOIdAndEntityId
    # 4. 缓存正确结果到 Redis
    # ============================================================

    byname_path = api.get("metadata_byname", "")

    # 步骤 1: 调用 searchByName API 获取 code, id, uri
    cached_byname = _get_cached_byname(billname_trim)
    if cached_byname:
        logger.info(f"[CACHE] searchByName 进程内缓存命中: {billname_trim}")
        raw = json.loads(cached_byname)
    else:
        logger.info(f"[API] searchByName 请求: {billname_trim}")
        raw = http_get_json(cfg, byname_path, {"key": billname_trim})
        _set_cached_byname(billname_trim, json.dumps(raw, ensure_ascii=False))

    cn = parse_business_object_code_name(raw, billname_trim, cfg)
    if cn is None:
        # 【v12.x 修复】缓存数据解析失败时，删除缓存并重新请求 API（避免缓存陈旧数据导致永久失败）
        if cached_byname:
            logger.warning(f"[CACHE] searchByName 缓存解析失败，删除缓存并重新请求: {billname_trim}")
            _del_cached_byname(billname_trim)
            raw = http_get_json(cfg, byname_path, {"key": billname_trim})
            _set_cached_byname(billname_trim, json.dumps(raw, ensure_ascii=False))
            cn = parse_business_object_code_name(raw, billname_trim, cfg)
            if cn is not None:
                logger.info(f"[API] searchByName 重试成功: billName={cn.name}, code={cn.code}, id={cn.id}, uri={cn.uri}")
        if cn is None:
            return [], f"错误: 无法解析单据 [{billname_trim}] 的编码和名称", {}
    if cn.not_found:
        return [], cn.not_found_reason or f"未找到名为 [{billname_trim}] 的业务对象", {}
    if cn.needs_selection():
        items = cn.available_items or []
        names = cn.available_names or []
        return [], {
            "type": "selection",
            "source": "search_by_name",
            "items": items,
            "names": names,
            "billname": billname_trim,
        }, {}

    # searchByName 返回 code, id, uri
    logger.info(f"[API] searchByName 结果: billName={cn.name}, code={cn.code}, id={cn.id}, uri={cn.uri}")

    # 【v12.x 新增】id 为空但有 uri（来自 searchByName，非 FastLookup），直接走 queryUri 路径
    # 场景：searchByName 返回 code+uri 但 id=None（如"票据工作台"）
    if cn.id is None and cn.uri and not getattr(cn, '_fastlookup_match', False):
        logger.info(f"[id 为空走 queryUri] cn.id=None, cn.uri={cn.uri}，直接调用 queryUri")
        db_obj = _query_by_uri_cached_parsed(cfg, cn.uri)
        if db_obj is None:
            return [], f"错误: 无法获取 URI {cn.uri} 的元数据", {}
        groups_data = db_obj.get("groups") or []
        if not groups_data:
            inner = db_obj.get("data", {}).get("groups", [])
            if isinstance(inner, list):
                groups_data = inner
        # 构造一个最小化的 ent 实体
        ent_from_query_uri = {
            "entityId": cn.id,
            "uri": cn.uri,
            "boId": cn.id,
            "businessObjectCode": cn.code or cn.name or "",
            "groups": groups_data,
        }
        details = [ent_from_query_uri]
    # 【v11.1 新增】FastLookup 回退处理：id 为空但有 uri，直接走 queryUri 路径
    elif cn.id is None and cn.uri and hasattr(cn, '_fastlookup_match') and cn._fastlookup_match:
        logger.info(f"[FastLookup 回退] searchByName 未找到 id，直接使用 queryUri: {cn.uri}")
        fast_schema = getattr(cn, '_fastlookup_schema', None)
        # 直接调用 queryUri 获取元数据
        db_obj = _query_by_uri_cached_parsed(cfg, cn.uri)
        if db_obj is None:
            return [], f"错误: 无法获取 URI {cn.uri} 的元数据", {}
        # 将 FastLookup 的 schema 注入到 db_obj
        if fast_schema:
            groups_data = db_obj.get("groups") or []
            if not groups_data:
                inner = db_obj.get("data", {}).get("groups", [])
                if isinstance(inner, list):
                    groups_data = inner
            for group in groups_data:
                if isinstance(group, dict) and not group.get("schema"):
                    group["schema"] = fast_schema
                    logger.info(f"[FastLookup 回退] schema 注入: {cn.uri} -> {fast_schema}")
                    break
        # 构造一个最小化的 ent 实体，用于后续 process_entity_with_schema_check
        ent_from_fastlookup = {
            "entityId": None,
            "uri": cn.uri,
            "boId": None,
            "businessObjectCode": cn.code or cn.name or "",
        }
        details = [ent_from_fastlookup]
    # 【v11.x 新增】use_child_id 场景：来自"无业务对象实体"METACLASS，parent code 为空但 child id 有值
    # 这种情况下 getEntityListByBOId 会返回 0 实体，需要跳过它，直接使用 child id
    elif not cn.code and cn.id:
        logger.info(f"[use_child_id] 跳过 getEntityListByBOId，直接使用 child id: {cn.id}")
        # 构造一个最小化的 ent 实体，参考 _fetch_schema_via_three_apis 的 use_child_id 处理
        ent_from_child = {
            "entityId": cn.id,  # child id 作为 entityId
            "uri": cn.uri,
            "boId": cn.id,  # 使用 child id 作为 boId（供 getEntityInfoByBOIdAndEntityId 使用）
            "businessObjectCode": cn.code or "",
        }
        details = [ent_from_child]
    else:
        # 步骤 2 & 3: 调用 queryByUri 查询元数据，检查 schema
        boid_key = f"{cn.id or ''}|{cn.code or ''}"
        cached_byboid = _get_cached_byboid(boid_key)
        if cached_byboid:
            logger.debug(f"[CACHE] getEntityListByBOId 缓存命中: boId={cn.id}")
            raw_bo = json.loads(cached_byboid)
        else:
            byboid_path = api.get("metadata_byboid", "")
            logger.info(f"[API] getEntityListByBOId 请求: boId={cn.id}, code={cn.code}")
            raw_bo = http_get_json(
                cfg,
                byboid_path,
                {"boId": cn.id or "", "businessObjectCode": cn.code or ""},
            )
            _set_cached_byboid(boid_key, json.dumps(raw_bo, ensure_ascii=False))

        details = collect_entity_details(raw_bo)
    logger.info(f"[API] getEntityListByBOId 返回 {len(details)} 个实体")

    # 步骤 4: 对每个实体查询 queryByUri，检查 schema
    entities_list: List[Dict[str, Any]] = []
    # 【v10.7 新增】累积特征表 classId 映射
    all_char_class_ids: Dict[str, str] = {}  # uri -> classId

    def fetch_uri(u: str) -> str:
        return _query_by_uri_cached(cfg, u)

    def process_entity_with_schema_check(ent: Dict[str, Optional[str]]) -> List[Dict[str, Any]]:
        """处理单个实体：queryByUri → 检查 schema → 如需要则调用 getEntityInfoByBOIdAndEntityId"""
        entity_id = ent.get("entityId")
        uri = ent.get("uri")
        if not uri:
            return []

        # 步骤 2: queryByUri (Redis 优先)
        db_obj = _query_by_uri_cached_parsed(cfg, uri)
        if db_obj is None:
            logger.warning(f"[API] queryByUri 返回空: {uri}")
            return []

        # 检查 schema 是否存在
        has_schema = False
        groups_data = db_obj.get("groups") or []
        if not groups_data:
            inner = db_obj.get("data", {}).get("groups", [])
            if isinstance(inner, list):
                groups_data = inner

        for group in groups_data:
            if isinstance(group, dict) and group.get("schema"):
                has_schema = True
                break

        # 【v9.0 修复】entity_model 需要传递给 biz_table_group_to_entity_map
        entity_model: Optional[Dict[str, Any]] = None

        if has_schema:
            logger.info(f"[OK] queryByUri 返回包含 schema: {uri}")
        else:
            # 步骤 3: schema 不存在，调用 getEntityInfoByBOIdAndEntityId
            logger.info(f"[FIX] queryByUri 缺少 schema，调用 getEntityInfoByBOIdAndEntityId: {uri}")
            if entity_id:
                cached_ent = _get_cached_entityid(entity_id)
                if cached_ent:
                    logger.debug(f"[CACHE] entityId 缓存命中: {entity_id}")
                    raw_ent = json.loads(cached_ent)
                else:
                    ent_path = api.get("metadata_entityid", "")
                    logger.info(f"[API] getEntityInfoByBOIdAndEntityId 请求: entityId={entity_id}")
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

                entity_model = parse_entity_model_for_ai(raw_ent)

                # 【v10.7 新增】从完整数据中提取特征字段的 classId 映射
                extracted_class_ids = _extract_character_class_ids(raw_ent)
                logger.info(f"[v10.7 DEBUG] _extract_character_class_ids 返回: {extracted_class_ids} for uri={uri}")
                if extracted_class_ids:
                    all_char_class_ids.update(extracted_class_ids)
                    logger.info(f"[v10.7] 提取特征表 classId 映射: {extracted_class_ids}")

                # 【v10.4 优化】将 schema 和 businessProperties 合并到 db_obj
                if entity_model:
                    # 合并 schema
                    if entity_model.get("schema"):
                        schema = entity_model.get("schema")
                        for group in groups_data:
                            if isinstance(group, dict) and not group.get("schema"):
                                group["schema"] = schema
                        logger.info(f"[FIX] schema 已补全: {schema} → {uri}")
                    # 【v10.4】合并 businessProperties 到 data 节点，供 parse 函数使用
                    bp = entity_model.get("businessProperties")
                    if bp and isinstance(bp, list):
                        data_node = db_obj.get("data", {})
                        if not isinstance(data_node, dict):
                            data_node = {}
                            db_obj["data"] = data_node
                        # businessProperties 合并到 data 节点
                        existing_bp = data_node.get("businessProperties", [])
                        if not isinstance(existing_bp, list):
                            existing_bp = []
                        # 合并去重（按 name 去重）
                        existing_names = {item.get("name") for item in existing_bp if isinstance(item, dict)}
                        for item in bp:
                            if isinstance(item, dict) and item.get("name") not in existing_names:
                                existing_bp.append(item)
                                existing_names.add(item.get("name"))
                        data_node["businessProperties"] = existing_bp
                        logger.debug(f"[FIX] businessProperties 已合并: {len(bp)} 个属性 → {uri}")

        groups = parse(db_obj, fetch_uri_json=fetch_uri)
        fkeys = parse_foreign_keys_util(db_obj, uri)

        results: List[Dict[str, Any]] = []
        # 【v9.0 修复】getEntityListByBOId 返回的是同一业务对象的所有实体，
        # 应全部包含（不再按 billName 过滤），仅过滤 _dcs、ibpm 等非业务实体
        for group in groups:
            gb = group.bill_name or ""
            tn = group.table_name or ""
            # 【v9.0 修复】过滤非业务实体：
            # 1. _dcs、ibpm 等系统表
            # 2. 税单、计算结果等辅助实体（不是主子表）
            if "_dcs" in tn or "ibpm" in tn or "审批" in gb or "税单" in gb or "calc" in tn or "result" in tn:
                continue
            emap = biz_table_group_to_entity_map(
                group,
                ent,
                entity_model,  # 【v9.0 修复】传递 entity_model
                fkeys,
                data_source_fields or doc_fields,
                is_sql_y,
                str(table_template) if table_template is not None else None,
                fetch_uri,
                cfg,
                excel_cols=excel_cols,
                request_text=request_text,
            )
            if emap:
                results.append(emap)
        return results

    # 并行处理多个实体
    if len(details) > 1:
        ew = min(_max_concurrent_entities(cfg), len(details))
        logger.info(f"[PARALLEL] 使用 {ew} 个线程并行处理 {len(details)} 个实体")
        with ThreadPoolExecutor(max_workers=ew) as executor:
            future_to_ent = {
                executor.submit(process_entity_with_schema_check, ent): ent for ent in details
            }
            for future in as_completed(future_to_ent):
                try:
                    results = future.result()
                    entities_list.extend(results)
                except Exception as e:
                    ent = future_to_ent[future]
                    logger.error(f"处理实体失败 [uri={ent.get('uri')}]: {e}")
    else:
        for ent in details:
            entities_list.extend(process_entity_with_schema_check(ent))

    logger.info(f"[DONE] 单据 {billname_trim} 完成，共获取 {len(entities_list)} 个实体")

    # 过滤非主子表实体
    def should_filter(entity: dict) -> bool:
        table_name = entity.get("tableName", "")
        bill_name = entity.get("billName", "")
        if "_dcs" in table_name:
            return True
        if "ibpmcurrentauditor" in table_name or "ibpmstep" in table_name:
            return True
        if "审批" in bill_name:
            return True
        # 过滤参照变体特征表，但保留主表关联的特征表
        if "_characteristics" in table_name or "_character_define" in table_name or "_feature" in table_name:
            if "自定义项特征" in bill_name:
                return False
            return True
        return False

    filtered_entities = [e for e in entities_list if not should_filter(e)]
    if len(filtered_entities) < len(entities_list):
        logger.info(f"[FILTER] 过滤非主子表实体: {len(entities_list)} → {len(filtered_entities)} 个")

    return filtered_entities, None, all_char_class_ids

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

    # 【v8.3 过滤规则】过滤掉 _dcs、ibpm 等非主子表实体
    def should_filter(entity: dict) -> bool:
        table_name = entity.get("tableName", "")
        bill_name = entity.get("billName", "")
        # 过滤 _dcs 表
        if "_dcs" in table_name:
            return True
        # 过滤审批相关实体
        if "ibpmcurrentauditor" in table_name or "ibpmstep" in table_name:
            return True
        if "审批" in bill_name:
            return True
        # 过滤参照变体特征表，但保留主表关联的特征表
        if "_characteristics" in table_name or "_character_define" in table_name or "_feature" in table_name:
            if "自定义项特征" in bill_name:
                return False
            return True
        return False

    filtered_entities = [e for e in entities_list if not should_filter(e)]
    if len(filtered_entities) < len(entities_list):
        logger.info(f"过滤非主子表实体: {len(entities_list)} → {len(filtered_entities)} 个")

    return filtered_entities, None


def run_all_bills(cfg: dict) -> Tuple[Dict[str, Any], Optional[str]]:
    """运行所有单据的元数据拉取（自动去重相同单据名称）"""
    # 【P0 优化】启动时加载 session 缓存，实现跨进程去重
    session_cache = _load_session_cache(cfg)

    req = cfg.get("request") or {}
    quri = (req.get("queryUri") or req.get("query_uri") or "").strip()

    # 【v8.5 修复】参照实体批量查询时不加载旧索引，避免实体数量膨胀
    # 只有在主表/子表查询时（有 allbillname 且无 queryUri）才加载索引
    if not quri:
        # 【v6.0 优化】提前初始化 entities 索引，后续 write_outputs 复用内存中的索引
        _get_entities_index(cfg)
    allbill = str(req.get("allbillname", "")).strip()
    if not allbill and quri:
        # 【v8.5】queryUri 支持逗号分隔的多个 URI
        # 分割 URI 列表，每个 URI 作为一个 billname 处理
        uri_parts = [u.strip() for u in quri.split(",") if u.strip()]
        if len(uri_parts) > 1:
            # 多个 URI：分割成多个 parts，每个 URI 对应一个 "metadata" billname
            allbill = ",".join(["metadata"] * len(uri_parts))
            # 将 URI 列表存入配置，供后续 build_entities_for_bill 使用
            req["_query_uri_list"] = uri_parts
        else:
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

    # 【v10.2 新增】解析 billname 中的 URI：如果包含 URI，严格按 URI 查询
    # 格式：单据名称（uri）或 单据名称（xxx.xxx.XxxVO）
    # 例如："物料（productcenter.pc_product）" → 提取 uri: productcenter.pc_product
    # 【v10.4 修复】合并 URI 提取和去重逻辑，确保 parts 和 uri_list 一一对应
    import re as _re

    # 建立 (billname, uri) 配对列表
    bill_uri_pairs: List[Tuple[str, Optional[str]]] = []
    for p in parts:
        # 匹配中文括号（）或英文括号() 中的内容
        uri_match = _re.search(r'[（(]([^）)]+)[）)]', p)
        if uri_match:
            potential_uri = uri_match.group(1).strip()
            # URI 格式验证：包含 . 分隔符
            if '.' in potential_uri:
                bill_uri_pairs.append(("metadata", potential_uri))
                logger.info(f"【v10.2】从 billname 提取 URI: {p} → {potential_uri}")
                continue
        bill_uri_pairs.append((p, None))

    # 【v10.4 修复】对配对列表去重
    # 去重规则：
    # - 有 URI 的（metadata）：按 URI 去重（不同 URI 保留）
    # - 无 URI 的（名称）：按名称去重（忽略大小写）
    seen_billnames: Set[str] = set()
    seen_uris: Set[str] = set()
    unique_pairs: List[Tuple[str, Optional[str]]] = []

    for billname, uri in bill_uri_pairs:
        if uri:
            # 有 URI：按 URI 去重
            if uri not in seen_uris:
                seen_uris.add(uri)
                unique_pairs.append((billname, uri))
        else:
            # 无 URI：按名称去重
            bill_key = billname.lower().strip()
            if bill_key not in seen_billnames:
                seen_billnames.add(bill_key)
                unique_pairs.append((billname, uri))

    # 重新构建 parts 和 uri_list
    parts = [p[0] for p in unique_pairs]
    uri_list = [p[1] for p in unique_pairs if p[1]]

    # 存入配置
    if uri_list:
        req["_query_uri_list"] = uri_list
        logger.info(f"【v10.4】billname 提取 URI 列表: {uri_list}")
        logger.info(f"【v10.4】queryUri 批量查询模式：{len(uri_list)} 个 URI")

    # 去重日志
    if len(unique_pairs) < len(bill_uri_pairs):
        dupes = len(bill_uri_pairs) - len(unique_pairs)
        logger.info(f"单据名称去重：原始 {len(bill_uri_pairs)} 个 → 去重后 {len(unique_pairs)} 个 （跳过 {dupes} 个重复）")

    # 【P0 优化 v8.4】跨进程去重：对于 session 缓存中已有的 billname，跳过 API 调用
    cached_parts: List[str] = []
    fresh_parts: List[str] = []

    sc_index = None
    if _SESSION_CACHE_INDEX_AVAILABLE:
        try:
            sc_index = get_session_cache_index(cfg)
        except Exception:
            pass

    for p in parts:
        p_key = p.lower().strip()
        if sc_index is not None:
            if sc_index.has_billname(p_key):
                cached_parts.append(p)
                continue
        if p_key in session_cache:
            cached_parts.append(p)
        else:
            fresh_parts.append(p)

    if cached_parts:
        if sc_index:
            total_cached_entities = 0
            for p in cached_parts:
                result = sc_index.get_by_billname(p.lower().strip())
                if result.found:
                    total_cached_entities += result.count
        else:
            total_cached_entities = sum(len(session_cache.get(p.lower().strip(), [])) for p in cached_parts)
        logger.info(
            f"【SESSION CACHE】跳过 {len(cached_parts)} 个已缓存业务对象的 API 调用 "
            f"({total_cached_entities} 个实体): {cached_parts}"
        )

    merged: List[Dict[str, Any]] = []
    if cached_parts:
        if sc_index:
            for p in cached_parts:
                result = sc_index.get_by_billname(p.lower().strip())
                if result.found:
                    merged.extend(result.entities)
        else:
            for p in cached_parts:
                cached_entities = session_cache.get(p.lower().strip(), [])
                merged.extend(cached_entities)

    parts_to_fetch = fresh_parts

    if not parts_to_fetch:
        logger.info(
            f"【SESSION CACHE】所有 {len(parts)} 个业务对象均已缓存，跳过所有 API 调用，"
            f"合并 {len(merged)} 个实体直接返回"
        )
        # 【v10.6】补充特征表实体（无 char_class_ids，因为全走缓存）
        merged = _supplement_characteristic_tables(cfg, merged, None)
        return {"entities": merged}, None

    logger.info(f"开始拉取 {len(parts_to_fetch)} 个单据: {', '.join(parts_to_fetch)}")

    # 【优化 v11.x】如果指定了 excelFile，在此处统一解析一次，避免并行时重复解析
    # 将解析结果存入 cfg，供所有 build_entities_for_bill 调用复用
    excel_file = req.get("excelFile") or getattr(cfg, "excel_file", None)
    if excel_file and not cfg.get("_excel_parsed"):
        try:
            excel_path = Path(excel_file)
            if excel_path.exists():
                excel_sheet_index = int(req.get("excelSheetIndex", 0) or 0)
                logger.info(f"【优化 v11.x】统一解析 Excel（避免并行重复解析）: {excel_file}")
                excel_result = parse_excel(excel_path, excel_sheet_index)
                all_excel_cols = excel_result.get("docFields", [])
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
                cfg["_excel_cols"] = [
                    c for c in all_excel_cols
                    if c.strip() and c.strip() not in _EXCLUDE_EXCEL_HEADERS
                ]
                data_source = excel_result.get("dataSource") or {}
                cfg["_data_source_fields"] = data_source.get("dataSourceFields", [])
                cfg["_excel_parsed"] = True
                if cfg.get("_excel_cols"):
                    logger.info(f"【优化 v11.x】Excel 字段列头已缓存: {cfg['_excel_cols']}")
                if cfg.get("_data_source_fields"):
                    logger.info(f"【优化 v11.x】数据源字段已缓存: {cfg['_data_source_fields']}")

                # 【v12.x 新增】从 Excel billObjects 扩展 parts_to_fetch
                bill_objects = data_source.get("billObjects", [])
                if bill_objects:
                    excel_bill_names = [bo.get("billName", "") for bo in bill_objects if bo.get("billName")]
                    existing_set = {p.lower() for p in parts_to_fetch}
                    new_bills = [bn for bn in excel_bill_names if bn.lower() not in existing_set]
                    if new_bills:
                        logger.info(f"【v12.x】从 Excel billObjects 扩展业务对象: {new_bills}")
                        parts_to_fetch.extend(new_bills)
        except Exception as e:
            logger.warning(f"【优化 v11.x】Excel 预解析失败，将使用原有逻辑: {e}")

    if len(parts_to_fetch) == 1:
        ents, err, char_class_ids = build_entities_for_bill(cfg, parts_to_fetch[0])
        if err:
            if isinstance(err, dict) and err.get("type") == "selection":
                return {"entities": [], "selection": err}, None
            return {"entities": []}, err
        # 合并已缓存的实体
        merged.extend(ents)
        # 【v10.6】补充特征表实体
        merged = _supplement_characteristic_tables(cfg, merged, char_class_ids)
        return {"entities": merged}, None

    max_b = _max_concurrent_bills(cfg)
    bill_results: Dict[str, Tuple[List[Dict[str, Any]], Optional[str], Dict[str, str]]] = {}

    with ThreadPoolExecutor(max_workers=min(max_b, len(parts_to_fetch))) as executor:
        future_to_part = {
            executor.submit(build_entities_for_bill, cfg, p): p for p in parts_to_fetch
        }
        for future in as_completed(future_to_part):
            part = future_to_part[future]
            try:
                ents, err, char_class_ids = future.result()
                if isinstance(err, dict) and err.get("type") == "selection":
                    return {"entities": [], "selection": err}, None
                bill_results[part] = (ents, err, char_class_ids)
            except Exception as e:
                logger.error(f"拉取单据失败 [{part}]: {e}")
                return {"entities": []}, f"拉取单据失败 [{part}]: {e}"

    failed_bills: List[str] = []
    not_found_bills: List[str] = []
    # 【v10.7 新增】累积所有特征表 classId 映射
    all_char_class_ids: Dict[str, str] = {}
    for p in parts_to_fetch:
        ents, err, char_class_ids = bill_results[p]
        if err:
            if isinstance(err, str) and "未找到" in err:
                not_found_bills.append(p)
            else:
                failed_bills.append(p)
        else:
            merged.extend(ents)
            if char_class_ids:
                all_char_class_ids.update(char_class_ids)

    # 汇总失败情况
    if not_found_bills or failed_bills:
        logger.warning("=== 拉取失败汇总 ===")
        for bill in not_found_bills:
            logger.warning(f"  ⚠ 未找到: {bill}（searchByName 返回空数据，请确认单据名称正确且已在 BIP 平台发布）")
        for bill in failed_bills:
            logger.warning(f"  ✗ 拉取失败: {bill}")
        if not merged:
            # 【v12.x 修复】所有单据都失败（merged=0），检查 session cache 是否已有数据
            if session_cache:
                cached_count = sum(len(v) for v in session_cache.values())
                logger.info(f"【v12.x 修复】merged=0，从 session cache 恢复 {cached_count} 个实体")
                for cached_ents in session_cache.values():
                    merged.extend(cached_ents)
            if not merged:
                first_err = bill_results.get(parts_to_fetch[0], (None, "未知错误", {}))[1]
                return {"entities": []}, first_err
        # 【v10.6】部分失败但有结果，补充特征表后继续
        merged = _supplement_characteristic_tables(cfg, merged, all_char_class_ids)
        return {"entities": merged}, None

    # 【v12.x 新增】无失败但 merged=0（全部快速返回空结果）时，从 session cache 恢复
    if not merged:
        if session_cache:
            cached_count = sum(len(v) for v in session_cache.values())
            logger.info(f"【v12.x 修复】merged=0（并行快速返回），从 session cache 恢复 {cached_count} 个实体")
            for cached_ents in session_cache.values():
                merged.extend(cached_ents)

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

    # 【v8.4 新增】保存 session 缓存
    if _SESSION_CACHE_INDEX_AVAILABLE:
        try:
            # 更新 session cache
            for ent in merged:
                bn = (ent.get("billName") or "").strip().lower()
                if bn and bn not in session_cache:
                    session_cache[bn] = []
                if bn:
                    session_cache[bn].append(ent)
            # 保存到磁盘
            _save_session_cache(cfg, session_cache)
        except Exception as e:
            logger.warning(f"Session Cache 保存失败: {e}")

    # 【v10.6 新增】检测并补充特征表实体
    # 某些业务对象包含特征表（如 storeProRecordDefineCharacter），其字段（如 vcol1）需要被包含在元数据中
    merged = _supplement_characteristic_tables(cfg, merged, all_char_class_ids)

    return {"entities": merged}, None


def _construct_character_uri(entity_uri: str, field_name: str) -> Optional[str]:
    """
    【v10.6 新增】从主表 URI 和特征字段名构造特征表 URI

    例如:
      entity_uri: "st.storeprorecord.StoreProRecord"
      field_name: "storeProRecordDefineCharacter"
      -> "st.storeprorecord.StoreProRecordDefineCharacter"

    Args:
        entity_uri: 主表实体 URI
        field_name: 特征字段名（如 storeProRecordDefineCharacter）

    Returns:
        特征表 URI，如果不匹配模式则返回 None
    """
    if not entity_uri or not field_name:
        return None

    # 特征字段名模式
    patterns = ["DefineCharacter", "CharacterDefine", "Characteristics"]
    for pattern in patterns:
        if pattern in field_name:
            # 去掉 Pattern 部分得到表名部分
            # storeProRecordDefineCharacter -> StoreProRecord
            prefix = field_name.replace(pattern, "")
            # 首字母小写 -> 大写
            if prefix and prefix[0].islower():
                prefix = prefix[0].upper() + prefix[1:]
            # 构造 URI: {domain}.{prefix}{pattern}VO
            # 例如: st.storeprorecord.StoreProRecord + DefineCharacter -> st.storeprorecord.StoreProRecordDefineCharacter
            parts = entity_uri.rsplit(".", 1)
            if len(parts) == 2:
                return f"{parts[0]}.{prefix}{pattern}"
            return None
    return None


def _extract_character_class_ids(raw_entity_data: Any) -> Dict[str, str]:
    """
    【v10.7 新增】从主表完整数据中提取特征字段的 classId 映射

    Args:
        raw_entity_data: getEntityInfoByBOIdAndEntityId 返回的完整数据

    Returns:
        Dict[str, str]: key=特征表URI, value=classId (entityId)
    """
    char_class_ids: Dict[str, str] = {}
    if not isinstance(raw_entity_data, dict):
        return char_class_ids

    _CHARACTER_FIELD_PATTERNS = ["DefineCharacter", "CharacterDefine", "Characteristics"]

    data_node = raw_entity_data.get("data", {})
    if isinstance(data_node, dict):
        inner = data_node.get("data", {})
        if isinstance(inner, dict):
            data_node = inner

    logger.info(f"[v10.7 DEBUG] data_node keys: {list(data_node.keys()) if isinstance(data_node, dict) else 'not a dict'}")

    # 特征字段在 businessProperties 中
    biz_props = data_node.get("businessProperties", [])
    if not isinstance(biz_props, list):
        biz_props = []

    logger.info(f"[v10.7 DEBUG] 检查特征表 classId，共 {len(biz_props)} 个业务属性")
    for prop in biz_props:
        if not isinstance(prop, dict):
            continue
        col_name = prop.get("fieldName", "") or prop.get("name", "") or ""

        # 检查是否是特征字段引用（名称匹配模式）
        is_char_field = False
        for pattern in _CHARACTER_FIELD_PATTERNS:
            if pattern in col_name:
                is_char_field = True
                break

        if not is_char_field:
            continue

        # 获取 classId（entityId）- 在 dataType.id 中
        data_type = prop.get("dataType", {})
        if isinstance(data_type, dict):
            class_id = data_type.get("id", "") or ""
            type_uri = data_type.get("uri", "") or ""
            if class_id and type_uri:
                char_class_ids[type_uri] = class_id
                logger.info(f"[v10.7] 发现特征字段: {col_name} -> classId={class_id}, uri={type_uri}")

    logger.info(f"[v10.7 DEBUG] 找到 {len(char_class_ids)} 个特征表 classId: {char_class_ids}")
    return char_class_ids


def _supplement_characteristic_tables(
    cfg: dict, entities: List[Dict[str, Any]], char_class_ids: Optional[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    【v10.6 新增，v10.7 修复】检测并补充特征表实体

    检测每个实体的字段中是否有指向特征表的引用（如 *DefineCharacter, *Characteristics），
    如果有则查询特征表实体并添加到输出列表。

    Args:
        cfg: 配置字典
        entities: 已获取的实体列表
        char_class_ids: 【v10.7 新增】特征表 URI -> classId 的映射，用于调用 getEntityInfoByBOIdAndEntityId

    Returns:
        补充特征表后的实体列表
    """
    logger.info("[v10.7] _supplement_characteristic_tables 被调用，当前实体数: %d", len(entities))
    logger.info("[v10.7] 传入的特征表 classId 映射: %s", char_class_ids or {})

    # 特征表字段的常见模式（字段名匹配这些模式说明指向特征表）
    _CHARACTER_FIELD_PATTERNS = [
        "DefineCharacter",
        "CharacterDefine",
        "Characteristics",
    ]

    # 已存在的实体 URI 列表（用于去重）
    existing_uris: Set[str] = {
        (e.get("uri") or "").lower() for e in entities if e.get("uri")
    }

    # 需要补充的特征表 URI 列表
    char_uris_to_fetch: Set[str] = set()

    # 检测字段中的特征表引用
    for entity in entities:
        uri = entity.get("uri") or ""
        attrs = entity.get("attributes") or []

        for attr in attrs:
            if not isinstance(attr, dict):
                continue
            col_name = attr.get("dbColumnName") or ""
            attr_type = attr.get("type") or ""

            # 检查是否是特征字段引用（Long 类型 + 名称匹配模式）
            if attr_type == "Long":
                for pattern in _CHARACTER_FIELD_PATTERNS:
                    if pattern in col_name:
                        # 构造特征表 URI
                        char_uri = _construct_character_uri(uri, col_name)
                        if char_uri and char_uri.lower() not in existing_uris:
                            char_uris_to_fetch.add(char_uri)
                        break

    logger.info("[v10.7] 检测到 %d 个特征表 URI 需要补充", len(char_uris_to_fetch))
    if not char_uris_to_fetch:
        return entities

    logger.info(f"[v10.7] 检测到 {len(char_uris_to_fetch)} 个特征表需要补充: {char_uris_to_fetch}")

    # 查询特征表实体
    api = cfg.get("api") or {}

    new_entities: List[Dict[str, Any]] = []
    for uri in char_uris_to_fetch:
        try:
            # 【v10.7 修复】优先使用 classId 调用 getEntityInfoByBOIdAndEntityId 获取完整数据
            raw_json: Optional[str] = None
            if char_class_ids and uri in char_class_ids:
                class_id = char_class_ids[uri]
                logger.info(f"[v10.7] 特征表 {uri} 有 classId={class_id}，调用 getEntityInfoByBOIdAndEntityId")
                cached_ent = _get_cached_entityid(class_id)
                if cached_ent:
                    logger.debug(f"[CACHE] entityId 缓存命中: {class_id}")
                    raw_json = cached_ent
                else:
                    ent_path = api.get("metadata_entityid", "")
                    logger.info(f"[API] getEntityInfoByBOIdAndEntityId 请求: entityId={class_id}, uri={uri}")
                    raw_ent = http_get_json(
                        cfg,
                        ent_path,
                        {
                            "entityId": class_id,
                            "uri": uri,
                            "boId": "",
                            "businessObjectCode": "",
                        },
                    )
                    raw_json = json.dumps(raw_ent, ensure_ascii=False)
                    _set_cached_entityid(class_id, raw_json)
                    logger.info(f"[v10.7] 特征表 {uri} getEntityInfoByBOIdAndEntityId 数据已缓存")

            # 如果没有 classId 或调用失败，fallback 到 queryByUri
            if not raw_json:
                logger.warning(f"[v10.7] 特征表 {uri} 无 classId，回退到 queryByUri")
                fetch_uri_json: Callable[[str], str] = lambda u: _query_by_uri_cached(cfg, u)
                raw_json = fetch_uri_json(uri)

            if not raw_json:
                logger.warning(f"[v10.7] 特征表 URI 查询失败: {uri}")
                continue

            db_obj = json.loads(raw_json)
            code_val = _text(db_obj, "code") or _text(db_obj, "resultCode")
            if code_val != "200":
                logger.warning(f"[v10.7] 特征表查询返回错误码: {code_val}, URI={uri}")
                continue

            # 【v10.8 修复】从 businessProperties 中找特征字段(vcol/lcol/scol)的 allTables
            correct_table_name = ""
            data_node = db_obj.get("data", {})
            if isinstance(data_node, dict):
                inner = data_node.get("data", {})
                if isinstance(inner, dict):
                    biz_props = inner.get("businessProperties", [])
                    if isinstance(biz_props, list) and biz_props:
                        # 优先取特征字段(vcol/lcol/scol)的 allTables，其次取第一个字段的
                        for prop in biz_props:
                            if isinstance(prop, dict):
                                fn = prop.get("fieldName", "") or ""
                                at = prop.get("allTables", [])
                                if at and at[0]:
                                    # 优先取特征字段
                                    if fn.startswith(("vcol", "lcol", "scol", "ncol", "dcol", "tcol")):
                                        correct_table_name = at[0]
                                        logger.info(f"[v10.8] 特征表 {uri} 特征字段 {fn} allTables={at}，使用 {correct_table_name}")
                                        break
                        # 如果没找到特征字段，取第一个有 allTables 的字段
                        if not correct_table_name:
                            for prop in biz_props:
                                if isinstance(prop, dict):
                                    at = prop.get("allTables", [])
                                    if at and at[0]:
                                        correct_table_name = at[0]
                                        logger.info(f"[v10.8] 特征表 {uri} 首个字段 allTables={at}，使用 {correct_table_name}")
                                        break
            if not correct_table_name:
                logger.warning(f"[v10.8] 特征表 {uri} 无法获取 allTables")
                continue

            # 【v10.7 修复】直接从 getEntityInfoByBOIdAndEntityId 返回数据构建特征表实体
            # 不依赖 parse() 函数，因为它无法正确解析这个 API 返回的数据格式
            data_node = db_obj.get("data", {})
            if isinstance(data_node, dict):
                inner = data_node.get("data", {})
                if isinstance(inner, dict):
                    entity_name = inner.get("name", "") or inner.get("displayName", "") or ""
                    entity_domain = inner.get("domain", "") or ""
                    entity_schema = inner.get("schema", "") or ""
                    biz_props = inner.get("businessProperties", [])

                    # 构建特征表实体
                    char_entity: Dict[str, Any] = {
                        "tableName": correct_table_name,
                        "billName": f"特征表_{correct_table_name}",
                        "domain": entity_domain,
                        "uri": uri,
                        "schema": entity_schema or entity_domain,
                        "isCharacterTable": True,
                    }

                    # 提取属性
                    attrs_out: List[Dict[str, Any]] = []
                    if isinstance(biz_props, list):
                        for prop in biz_props:
                            if not isinstance(prop, dict):
                                continue
                            field_name = prop.get("fieldName", "") or prop.get("name", "") or ""
                            display_name = prop.get("displayName", "") or field_name
                            prop_type = prop.get("dataType", {})
                            if isinstance(prop_type, dict):
                                type_name = prop_type.get("name", "") or "String"
                            else:
                                type_name = "String"

                            am = {
                                "displayName": display_name,
                                "dbColumnName": field_name,
                                "type": type_name,
                                "tableName": correct_table_name,
                            }
                            # 标记特征字段
                            if field_name.startswith("vcol") or field_name.startswith("lcol") or field_name.startswith("scol"):
                                am["isCharacterField"] = True
                            attrs_out.append(am)

                    char_entity["attributes"] = attrs_out
                    new_entities.append(char_entity)
                    logger.info(
                        f"[v10.7] 特征表已补充: {uri} → {correct_table_name}, "
                        f"字段数={len(attrs_out)}"
                    )
                else:
                    logger.warning(f"[v10.7] 特征表 {uri} 无内层 data 对象")
            else:
                logger.warning(f"[v10.7] 特征表 {uri} 无 data 对象")

        except Exception as e:
            logger.warning(f"[v10.6] 处理特征表失败: {uri}, 错误: {e}")

    # 合并并返回
    if new_entities:
        logger.info(f"[v10.6] 特征表补充完成，新增 {len(new_entities)} 个实体")
        return entities + new_entities
    return entities


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


def _print_main_entities_summary(entities: List[Dict[str, Any]]) -> None:
    """
    【v8.5 新增】输出主子实体清单到控制台

    根据 billName 和 URI 识别主实体和子实体：
    - 主实体：billName 包含"主表"/"主"/"表头"，或 URI 以 BillVO 结尾（但不是 BVO/SettleInfoVO）
    - 子实体：billName 包含"表体"、"明细"、"结算"，或 URI 包含 BVO/SettleInfo
    """
    # 主实体识别规则
    main_keywords = ["主表", "主", "表头", "BillVO"]
    # 子实体识别规则
    sub_keywords = ["表体", "明细", "结算", "BVO", "SettleInfo"]

    def get_entity_type(entity: Dict[str, Any]) -> str:
        bill_name = entity.get("billName", "")
        uri = entity.get("uri", "")

        # 子实体判断（优先）
        for kw in sub_keywords:
            if kw in bill_name or kw in uri:
                return "sub"

        # 主实体判断
        for kw in main_keywords:
            if kw in bill_name:
                return "main"

        # 通过 URI 模式判断：以 BillVO 结尾但不是 SettleInfo/BVO 的是主实体
        if uri.endswith("BillVO") and "SettleInfo" not in uri and "BVO" not in uri:
            return "main"

        return entity.get("entityType", "")

    main_entities = [e for e in entities if get_entity_type(e) == "main"]
    sub_entities = [e for e in entities if get_entity_type(e) == "sub"]
    other_entities = [e for e in entities if get_entity_type(e) not in ("main", "sub") and e.get("entityType") not in ("main", "sub")]

    print("\n" + "=" * 60, file=sys.stderr)
    print("【阶段一输出】主子实体清单", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    if main_entities:
        print("\n主实体（主表）:", file=sys.stderr)
        for e in main_entities:
            bill_name = e.get("billName", "")
            table_name = e.get("tableName", "")
            schema = e.get("schema", "")
            uri = e.get("uri", "")
            print(f"  - {bill_name}", file=sys.stderr)
            print(f"    表名: {schema}.{table_name}", file=sys.stderr)
            print(f"    URI: {uri}", file=sys.stderr)

    if sub_entities:
        print(f"\n子实体（共 {len(sub_entities)} 个）:", file=sys.stderr)
        for e in sub_entities:
            bill_name = e.get("billName", "")
            table_name = e.get("tableName", "")
            schema = e.get("schema", "")
            print(f"  - {bill_name} [{schema}.{table_name}]", file=sys.stderr)

    if other_entities:
        print(f"\n其他实体（共 {len(other_entities)} 个）:", file=sys.stderr)
        for e in other_entities:
            bill_name = e.get("billName", "")
            table_name = e.get("tableName", "")
            schema = e.get("schema", "")
            print(f"  - {bill_name} [{schema}.{table_name}]", file=sys.stderr)

    print("\n" + "=" * 60, file=sys.stderr)
    print(f"合计: {len(main_entities)} 个主实体 + {len(sub_entities)} 个子实体 + {len(other_entities)} 个其他 = {len(entities)} 个实体", file=sys.stderr)
    print("=" * 60 + "\n", file=sys.stderr)


def write_outputs(
    cfg: dict,
    payload: Dict[str, Any],
    skip_merge: bool = False,
    req: Optional[Dict[str, Any]] = None
) -> None:
    """
    将元数据写入输出文件

    Args:
        cfg: 配置
        payload: 元数据
        skip_merge: 是否跳过旧索引合并（用于 queryUri 模式）
        req: 请求配置（用于判断是否是参照实体批量查询）
    """
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

        if skip_merge:
            # 【v8.4】skip_merge 模式：直接写入新数据，不合并旧索引
            # 用于 queryUri 模式，避免加载旧的 152 个实体导致数量膨胀
            def should_filter_entity(ent: dict) -> bool:
                table_name = ent.get("tableName", "")
                bill_name = ent.get("billName", "")
                if "_dcs" in table_name:
                    return True
                if "ibpmcurrentauditor" in table_name or "ibpmstep" in table_name:
                    return True
                if "审批" in bill_name:
                    return True
                # 【v8.4 新增】参照实体变体表过滤
                # 区分主表/子表关联的特征表和参照变体表：
                # - 主表特征表：billName 包含"自定义项特征"（如"产品入库主表自定义项特征实体"）
                # - 子表特征表：billName 包含"子表"（如"产品入库子表"）
                # - 参照变体表：billName 是独立的业务对象名称（如"物料"、"批次档案"）
                if "_fi_loc" in table_name:
                    return True
                # 过滤参照变体特征表，但保留主表/子表关联的特征表
                # 【v10.4 修复】增加 tableName 前缀匹配，避免 billName 编码问题导致误过滤
                # 主表特征表命名规则：{主表名}_character_define_{n}（如 storeprorecord_character_define_1）
                # 参照变体特征表命名规则：{参照表名}_character_define（如 bd_material_character_define）
                if "_characteristics" in table_name or "_character_define" in table_name or "_feature" in table_name:
                    # 方式1：检查 billName（可能有编码问题）
                    if "自定义项特征" in bill_name or "子表" in bill_name:
                        return False
                    # 【v10.4】方式2：检查 tableName 是否属于当前业务对象
                    # 如果 tableName 以主表名前缀开头，则认为是主表关联的特征表
                    # 例如：storeprorecord_character_define 属于 st_storeprorecord 业务对象
                    main_table_prefix = entity_result.get("tableName", "").replace("_", "").lower()[:20]
                    char_table_prefix = table_name.replace("_", "").replace("characterdefine", "").replace("characteristics", "").replace("feature", "").lower()[:20]
                    if main_table_prefix and char_table_prefix and (main_table_prefix.startswith(char_table_prefix[:10]) or char_table_prefix.startswith(main_table_prefix[:10])):
                        return False
                    # 方式3：检查 domain 是否与主表一致（主表特征表与主表同 domain）
                    ent_domain = ent.get("domain", "")
                    main_domain = entity_result.get("domain", "")
                    if ent_domain and main_domain and ent_domain == main_domain:
                        return False
                    # 【v10.4 修复】方式4：检查 URI 前缀是否属于同一业务对象
                    # 例如：st.storeprorecord.StoreProRecordDefineCharacter 属于 st.storeprorecord.StoreProRecord
                    ent_uri = ent.get("uri", "")
                    main_uri = entity_result.get("uri", "")
                    if ent_uri and main_uri:
                        # 提取 URI 前缀（去掉最后一个部分）
                        main_prefix = ".".join(main_uri.split(".")[:-1])
                        ent_prefix = ".".join(ent_uri.split(".")[:-1])
                        if main_prefix and ent_prefix and ent_prefix.startswith(main_prefix):
                            return False
                    # 否则是参照变体表，应该过滤
                    return True
                return False

            new_entities = data.get("entities", [])
            filtered_entities = [ent for ent in new_entities if not should_filter_entity(ent)]
            filtered_count = len(new_entities) - len(filtered_entities)
            if filtered_count > 0:
                logger.info(f"写入时过滤非主子表实体: {filtered_count} 个")
            data = dict(data)
            data["entities"] = filtered_entities
            logger.info(f"直接写入新实体: {len(filtered_entities)} 个（跳过旧索引合并）")
        else:
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
            # 【v8.5 修复】参照实体批量查询时不加载旧索引，避免实体数量膨胀
            # 通过检查 skip_merge 标志来判断是否是参照实体批量查询
            is_ref_batch_query = bool(req.get("_query_uri_list"))
            if is_ref_batch_query:
                # 参照实体批量查询：跳过加载旧索引，直接使用新实体
                # 注意：这意味着参照实体不会与主表实体合并，由调用方手动处理
                logger.info("参照实体批量查询：跳过旧索引合并")
            elif idx and idx.get_count() > 0:
                existing_entities = idx.iterate_all()
                logger.info(f"从内存索引合并已有实体: {len(existing_entities)} 个")

            # 合并 entities 列表（去重：按 uri + tableName 唯一性判断）
            # 【v10.1 修复】当存在相同 uri|tableName 时，用新实体替换旧实体（保留最新字段）
            new_entities = data.get("entities", [])
            if new_entities or existing_entities:
                seen_keys: Set[str] = set()
                merged_entities: List[Dict[str, Any]] = []
                # 先追加新的（替换已存在的）
                # 【v8.3 过滤规则】过滤掉 _dcs、ibpm 等非主子表实体
                def should_filter_entity_merge(ent: dict) -> bool:
                    table_name = ent.get("tableName", "")
                    bill_name = ent.get("billName", "")
                    if "_dcs" in table_name:
                        return True
                    if "ibpmcurrentauditor" in table_name or "ibpmstep" in table_name:
                        return True
                    if "审批" in bill_name:
                        return True
                    # 【v8.4 新增】参照实体变体表过滤
                    # 区分主表关联的特征表和参照变体表：
                    # - 主表特征表：billName 包含"自定义项特征"（如"产品入库主表自定义项特征实体"）
                    # - 参照变体表：billName 是独立的业务对象名称（如"物料"、"批次档案"）
                    if "_fi_loc" in table_name:
                        return True
                    # 过滤参照变体特征表，但保留主表/子表关联的特征表
                    # 【v10.4 修复】增加 URI 前缀匹配，避免 billName 编码问题导致误过滤
                    if "_characteristics" in table_name or "_character_define" in table_name or "_feature" in table_name:
                        # 方式1：检查 billName（可能有编码问题）
                        if "自定义项特征" in bill_name or "子表" in bill_name:
                            return False
                        # 方式2：检查是否与主表 domain 一致（主表特征表与主表同 domain）
                        ent_domain = ent.get("domain", "")
                        ent_uri = ent.get("uri", "")
                        # 方式3：检查 URI 前缀是否属于同一业务对象
                        # 例如：st.storeprorecord.StoreProRecordDefineCharacter 属于 st.storeprorecord.StoreProRecord
                        if ent_uri:
                            ent_prefix = ".".join(ent_uri.split(".")[:-1])
                            # 检查是否与已保留实体的 URI 前缀匹配
                            for kept_ent in merged_entities:
                                kept_uri = kept_ent.get("uri", "")
                                if kept_uri:
                                    kept_prefix = ".".join(kept_uri.split(".")[:-1])
                                    if ent_prefix and kept_prefix and ent_prefix.startswith(kept_prefix):
                                        return False
                        # 否则是参照变体表，应该过滤
                        return True
                    return False

                added_count = 0
                skipped_count = 0
                filtered_count = 0
                for ent in new_entities:
                    key = f"{ent.get('uri', '')}|{ent.get('tableName', '')}"
                    # 【v10.1】先过滤，再判断是否替换
                    if should_filter_entity_merge(ent):
                        filtered_count += 1
                        continue
                    # 【v10.1 修复】如果 key 已存在，移除旧实体（用新实体替换）
                    if key in seen_keys:
                        merged_entities = [e for e in merged_entities
                                         if f"{e.get('uri', '')}|{e.get('tableName', '')}" != key]
                        skipped_count += 1
                    merged_entities.append(ent)
                    seen_keys.add(key)
                    added_count += 1
                # 再加入旧实体中没有被新实体替换的
                for ent in existing_entities:
                    key = f"{ent.get('uri', '')}|{ent.get('tableName', '')}"
                    if key and key not in seen_keys:
                        merged_entities.append(ent)
                        seen_keys.add(key)
                if filtered_count > 0:
                    logger.info(f"合并时过滤非主子表实体: {filtered_count} 个")
                if skipped_count > 0:
                    logger.info(f"【v10.1】合并时替换旧实体: {skipped_count} 个（保留最新字段）")
                logger.info(f"合并 entities: 新增 {added_count} 个，替换 {skipped_count} 个，合计 {len(merged_entities)} 个")
                data = dict(data)
                data["entities"] = merged_entities

        # 【v11.0 新增】补充 businessProperties
        # 从 getEntityInfoByBOIdAndEntityId 的磁盘缓存中提取 businessProperties
        # 解决：主表的 businessProperties 在 queryByUri 中为空，导致特征表 allTables 解析问题
        _enrich_business_properties(data.get("entities", []))

        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"写入: {p}")

        # 【v8.5】输出主子实体清单到控制台
        _print_main_entities_summary(data.get("entities", []))

        # 【v8.5】写入后重置索引，下次查询会重新从磁盘加载
        _reset_entities_index()

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
    if getattr(args, "auto_select_first", None) is not None:
        req["_auto_select_first"] = args.auto_select_first
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
        "--auto-select-first",
        dest="auto_select_first",
        action="store_true",
        default=None,
        help="【自动化】当 searchByName 返回多个匹配时，自动选择第一个并继续执行，不退出等待用户选择",
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

    # 【v8.5】判断是否使用 queryUri 模式
    req = cfg.get("request") or {}
    quri = req.get("queryUri") or req.get("query_uri") or ""
    uri_list = req.get("_query_uri_list") or []
    # 【v8.5 修复】参照实体批量查询时跳过合并旧索引，避免实体数量膨胀
    # 注意：skip_merge=True 时 write_outputs 不会加载旧索引，
    # 这意味着参照实体查询的结果不会与主表实体合并。
    # 这是预期行为：参照实体由 AI 手动追加到主表实体的输出中。
    skip_merge = bool(quri) and len(uri_list) > 0

    # 处理选择：插件 / Agent 下 stdin 非 TTY，只输出可解析的 stdout，由侧栏点选后带 code/id 重试
    selection_info = payload.get("selection")
    if selection_info:
        items = selection_info.get("items", [])
        names = selection_info.get("names", [])
        billname = selection_info.get("billname", "")
        if not items or not names:
            return ExitCode.CONFIG_ERROR

        ui_text = _format_selection_stdout_for_ui(selection_info)
        auto_select = cfg.get("request", {}).get("_auto_select_first", False) or _perf(cfg).get("auto_select_first", False)
        if not _should_interactive_selection_prompt() or auto_select:
            if auto_select:
                # 【自动化 v11.x】当 searchByName 返回多个匹配时，存储所有匹配项到请求上下文
                # 后续 build_entities_for_bill 会直接使用这些预选项目，跳过二次搜索
                req = cfg.setdefault("request", {})
                req["_pre_selected_items"] = items  # 存储完整的 item 信息（含 id、uri）
                logger.info(f"[自动选择 v11.x] 批量处理 {len(items)} 个匹配项")
                for item in items:
                    logger.info(f"[自动选择] - {item.get('name')} (code={item.get('code')}, id={item.get('id')})")
                # 构建唯一的 billname 列表，用 code=xxx 格式区分
                billname_base = selection_info.get("billname", "")
                composite_parts = []
                for item in items:
                    code = item.get("code", "")
                    name = item.get("name", "") or billname_base
                    composite_parts.append(f"{name}（code={code}）")
                req["allbillname"] = ",".join(composite_parts)
                logger.info(f"[自动选择 v11.x] allbillname 更新为: {req['allbillname']}")
            else:
                # searchByName 多对象的提示须独占 stdout 末尾，不可再拼接 JSON，
                # 否则 Chat 侧栏 parseBillNameChoiceFromStdout 会误把 JSON 并入选项。
                print(ui_text, end="")
                return ExitCode.SUCCESS
        else:
            # 交互模式：打印选项列表
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

    write_outputs(cfg, payload, skip_merge=skip_merge, req=req)
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

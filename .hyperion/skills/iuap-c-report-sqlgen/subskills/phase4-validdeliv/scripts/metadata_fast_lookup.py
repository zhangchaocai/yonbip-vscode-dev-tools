"""
快速元数据查找模块
使用预处理的 metadata_lookup.json 进行快速匹配，避免多次 API 调用

核心改进（v7.0）：
  - strict_lookup()：仅返回 bizName/metadataName 精确一致的结果
  - lookup()：严格优先级（精确 > 模糊），模糊匹配限制数量（≤ 3 条）
  - 移除过于宽松的子串包含逻辑（避免 "销售" 命中 "销售订单" 也命中 "销售订单变更" 等噪音）
  - 新增 confidence 字段：exact > partial（有边界）> partial（子串）
  - 与 parse_excel.py 的 _MiniFastLookup 保持 API 兼容
  - 【v7.0 新增】索引自动更新：TTL 检查 + 后台异步重建机制
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

# 【v7.0 新增】后台重建线程管理
_rebuild_thread: Optional[threading.Thread] = None
_rebuild_lock = threading.Lock()
_last_rebuild_time: float = 0

# confidence 等级：exact > partial_word > partial_substring
MatchSource = str  # 'exact_biz' | 'exact_metadata' | 'partial_word' | 'partial_substring' | 'uri'


@dataclass
class FastLookupResult:
    """快速查找结果"""
    found: bool = False
    uri: Optional[str] = None
    domain: Optional[str] = None
    table_name: Optional[str] = None
    schema: Optional[str] = None
    biz_name: Optional[str] = None
    metadata_name: Optional[str] = None
    match_type: Optional[str] = None   # 'exact' | 'partial' | 'uri'
    match_source: Optional[str] = None  # 见 MatchSource 类型定义
    # 改进：新增 confidence 字段区分精确度
    confidence: str = "low"             # 'high' | 'medium' | 'low'


class MetadataFastLookup:
    """元数据快速查找器"""

    _instance: Optional["MetadataFastLookup"] = None
    _lock = threading.Lock()

    # 子串匹配噪音黑名单词（出现在结果名称中会导致误匹配）
    # 例如：用户搜索 "订单"，不应命中 "销售订单变更明细"
    _NOISE_WORDS: set[str] = {
        "变更", "历史", "明细", "明细表", "详情",
        "自定义", "自由项", "特征",
    }

    # 【v7.0 新增】索引自动更新配置
    _INDEX_TTL_SECONDS: int = 86400  # 索引 TTL：24 小时
    _MIN_REBUILD_INTERVAL: int = 3600  # 最小重建间隔：1 小时

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._lookup_data = None
                    cls._instance._json_path = None
                    cls._instance._last_load_time = 0.0
        return cls._instance

    def __init__(self):
        self._lookup_data: Optional[Dict[str, Any]] = None
        self._json_path: Optional[str] = None
        self._last_load_time: float = 0.0

    def load_lookup_json(self, json_path: str) -> bool:
        """加载查找 JSON 文件"""
        try:
            p = Path(json_path)
            if not p.exists():
                return False
            with p.open("r", encoding="utf-8") as f:
                self._lookup_data = json.load(f)
            self._json_path = json_path
            self._last_load_time = time.time()
            return True
        except Exception:
            return False

    def _is_index_expired(self) -> bool:
        """
        【v7.0 新增】检查索引是否过期

        Returns:
            True 如果索引过期（超过 TTL 或文件已修改）
        """
        if self._last_load_time == 0.0:
            return True

        # 检查时间 TTL
        if time.time() - self._last_load_time > self._INDEX_TTL_SECONDS:
            return True

        # 检查文件是否被修改
        if self._json_path:
            try:
                p = Path(self._json_path)
                if p.exists():
                    file_mtime = p.stat().st_mtime
                    if file_mtime > self._last_load_time:
                        return True
            except Exception:
                pass

        return False

    def _trigger_background_rebuild(self, rebuild_func: Optional[Callable] = None) -> None:
        """
        【v7.0 新增】触发后台异步重建索引

        Args:
            rebuild_func: 重建函数，签名为 () -> bool
        """
        global _rebuild_thread, _last_rebuild_time

        # 检查是否在最小重建间隔内
        if time.time() - _last_rebuild_time < self._MIN_REBUILD_INTERVAL:
            return

        # 检查是否已有重建线程在运行
        with _rebuild_lock:
            if _rebuild_thread is not None and _rebuild_thread.is_alive():
                return

            if rebuild_func is None:
                return

            def _rebuild_wrapper():
                global _last_rebuild_time
                try:
                    success = rebuild_func()
                    if success:
                        _last_rebuild_time = time.time()
                except Exception as e:
                    pass

            _rebuild_thread = threading.Thread(target=_rebuild_wrapper, daemon=True)
            _rebuild_thread.start()

    def check_and_auto_rebuild(self, rebuild_func: Optional[Callable] = None) -> bool:
        """
        【v7.0 新增】检查索引状态，如过期则触发后台重建

        Args:
            rebuild_func: 重建函数，签名为 () -> bool

        Returns:
            True 如果索引有效或已触发重建，False 如果索引无效且无法重建
        """
        if not self._is_index_expired():
            return True

        # 索引过期，触发后台重建
        if rebuild_func is not None:
            self._trigger_background_rebuild(rebuild_func)
            return True  # 当前仍使用旧索引，后台重建中

        return False  # 无重建函数，索引无效

    def _normalize(self, s: str) -> str:
        """规范化字符串用于比较"""
        return s.strip().lower() if s else ""

    def _exact_index_hits(
        self, name: str, index: Dict[str, List[int]], records: List[Dict], source: MatchSource
    ) -> List[FastLookupResult]:
        """索引键与 name 完全一致时返回所有记录。"""
        if name not in index:
            return []
        out: List[FastLookupResult] = []
        conf = "high" if source in ("exact_biz", "exact_metadata") else "low"
        for idx in index[name]:
            if idx >= len(records):
                continue
            rec = records[idx]
            out.append(
                FastLookupResult(
                    found=True,
                    uri=rec.get("uri"),
                    domain=rec.get("domain"),
                    table_name=rec.get("tableName"),
                    schema=rec.get("schema"),
                    biz_name=rec.get("bizName"),
                    metadata_name=rec.get("metadataName"),
                    match_type="exact",
                    match_source=source,
                    confidence=conf,
                )
            )
        return out

    def _partial_hits(
        self, name: str, index: Dict[str, List[int]], records: List[Dict]
    ) -> List[FastLookupResult]:
        """
        改进的模糊匹配：
          1. 优先命中单词边界（"name" 是 key 的独立词，不是子串）
          2. 严格子串匹配（仅当精确/词边界无结果时使用）
          3. 限制结果数量（最多 3 条）
          4. 过滤噪音词匹配
        """
        results: List[FastLookupResult] = []
        norm_name = self._normalize(name)
        if not norm_name:
            return results

        # 第一轮：词边界匹配（更精确）
        word_hits: List[FastLookupResult] = []
        for key in sorted(index.keys()):
            norm_key = self._normalize(key)
            if not norm_key:
                continue

            # 词边界：key 以 name 开头，或 key 包含 _name_/ name (占位)
            is_word_match = (
                norm_key.startswith(norm_name + "_") or
                norm_key.startswith(norm_name) and len(norm_key) <= len(norm_name) + 10
            )
            if not is_word_match:
                continue

            for idx in index[key]:
                if idx >= len(records):
                    continue
                rec = records[idx]
                biz_nm = rec.get("bizName") or ""
                # 过滤噪音词
                if any(nw in biz_nm for nw in self._NOISE_WORDS) and norm_name not in biz_nm:
                    continue
                word_hits.append(
                    FastLookupResult(
                        found=True,
                        uri=rec.get("uri"),
                        domain=rec.get("domain"),
                        table_name=rec.get("tableName"),
                        schema=rec.get("schema"),
                        biz_name=biz_nm,
                        metadata_name=rec.get("metadataName"),
                        match_type="partial",
                        match_source="partial_word",
                        confidence="medium",
                    )
                )
                if len(word_hits) >= 3:
                    break
            if len(word_hits) >= 3:
                break

        if word_hits:
            return word_hits[:3]

        # 第二轮：严格子串匹配（最后兜底，限制为 2 条）
        for key in sorted(index.keys()):
            norm_key = self._normalize(key)
            if not norm_key or norm_name not in norm_key:
                continue
            for idx in index[key]:
                if idx >= len(records):
                    continue
                rec = records[idx]
                biz_nm = rec.get("bizName") or ""
                if any(nw in biz_nm for nw in self._NOISE_WORDS):
                    continue
                results.append(
                    FastLookupResult(
                        found=True,
                        uri=rec.get("uri"),
                        domain=rec.get("domain"),
                        table_name=rec.get("tableName"),
                        schema=rec.get("schema"),
                        biz_name=biz_nm,
                        metadata_name=rec.get("metadataName"),
                        match_type="partial",
                        match_source="partial_substring",
                        confidence="low",
                    )
                )
                if len(results) >= 2:
                    return results
        return results

    def strict_lookup(self, billname: str) -> List[FastLookupResult]:
        """
        【新增】严格查找：仅返回 bizName 或 metadataName 精确一致的结果。

        这是最精确的查找方式，适用于：
        - Excel 中用户明确提供的业务对象名称
        - AI 话术中明确指定的单据名称
        - 需要精确匹配，不接受模糊结果的场景

        注意：对输入执行 strip()，以兼容 Excel 单元格中可能残留的前后空格。

        Returns:
            空列表表示无精确命中（调用方应降级到 lookup()）
        """
        if not self._lookup_data:
            return []

        records = self._lookup_data.get("records", [])
        biz_index = self._lookup_data.get("bizNameIndex", {})
        metadata_index = self._lookup_data.get("metadataNameIndex", {})

        if not records:
            return []

        # strip 兼容 Excel 单元格可能残留的空格
        norm_name = self._normalize(billname)

        # 1) bizName 精确
        r = self._exact_index_hits(norm_name, biz_index, records, "exact_biz")
        if r:
            return r

        # 2) metadataName 精确
        return self._exact_index_hits(norm_name, metadata_index, records, "exact_metadata")

    def lookup(self, billname: str) -> List[FastLookupResult]:
        """
        根据单据名称查找元数据。

        优先级（严格递减）：
        1. bizName 精确一致 → confidence=high
        2. metadataName 精确一致 → confidence=high
        3. 词边界包含 → confidence=medium（最多 3 条）
        4. 严格子串包含 → confidence=low（最多 2 条）
        """
        if not self._lookup_data:
            return []

        records = self._lookup_data.get("records", [])
        biz_index = self._lookup_data.get("bizNameIndex", {})
        metadata_index = self._lookup_data.get("metadataNameIndex", {})

        if not records:
            return []

        # 1) 精确：bizName 索引键
        r = self._exact_index_hits(billname, biz_index, records, "exact_biz")
        if r:
            return r

        # 2) 精确：metadataName 索引键
        r = self._exact_index_hits(billname, metadata_index, records, "exact_metadata")
        if r:
            return r

        # 3) 模糊：词边界优先
        r = self._partial_hits(billname, biz_index, records)
        if r:
            return r
        return self._partial_hits(billname, metadata_index, records)

    def lookup_multiple(self, billnames: List[str]) -> Dict[str, List[FastLookupResult]]:
        """批量查找多个单据名称"""
        return {name: self.lookup(name) for name in billnames}

    def get_by_uri(self, uri: str) -> Optional[FastLookupResult]:
        """根据 URI 直接查找"""
        if not self._lookup_data:
            return None

        uri_index = self._lookup_data.get("uriIndex", {})
        records = self._lookup_data.get("records", [])

        if uri in uri_index:
            idx = uri_index[uri]
            if idx < len(records):
                rec = records[idx]
                return FastLookupResult(
                    found=True,
                    uri=rec.get("uri"),
                    domain=rec.get("domain"),
                    table_name=rec.get("tableName"),
                    schema=rec.get("schema"),
                    biz_name=rec.get("bizName"),
                    metadata_name=rec.get("metadataName"),
                    match_type="uri",
                    match_source="uri",
                    confidence="high",
                )
        return None

    @property
    def is_loaded(self) -> bool:
        return self._lookup_data is not None

    @property
    def total_records(self) -> int:
        return self._lookup_data.get("totalCount", 0) if self._lookup_data else 0


def unique_uris_in_results(results: List[FastLookupResult]) -> List[str]:
    """保序去重后的 uri 列表（跳过空）。"""
    seen: Set[str] = set()
    out: List[str] = []
    for r in results:
        u = (r.uri or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def get_fast_lookup(cfg: dict = None) -> MetadataFastLookup:
    """获取快速查找器实例"""
    lookup = MetadataFastLookup()

    if lookup.is_loaded:
        return lookup

    if cfg:
        paths = cfg.get("paths") or {}
        json_path = paths.get("metadata_lookup_json")
        if json_path:
            if lookup.load_lookup_json(json_path):
                return lookup

    # 默认路径
    default_paths = [
        Path(__file__).parent.parent / "reference" / "metadata_lookup.json",
        Path(__file__).parent.parent.parent / "reference" / "metadata_lookup.json",
    ]

    for p in default_paths:
        if lookup.load_lookup_json(str(p)):
            return lookup

    return lookup

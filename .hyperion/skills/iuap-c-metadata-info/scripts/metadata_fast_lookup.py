"""
快速元数据查找模块
使用预处理的metadata_lookup.json进行快速匹配，避免多次API调用
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


# exact_biz: bizName 键精确命中; exact_metadata: 仅 metadataName 键命中; partial: 模糊
MatchSource = str


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
    match_type: Optional[str] = None  # 兼容旧逻辑: 'exact' / 'partial' / 'uri'
    match_source: Optional[str] = None  # 'exact_biz' | 'exact_metadata' | 'partial'


class MetadataFastLookup:
    """元数据快速查找器"""

    _instance: Optional["MetadataFastLookup"] = None
    _lock: threading.Lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                # Double-check locking pattern
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._lookup_data = None
        return cls._instance

    def __init__(self):
        self._lookup_data: Optional[Dict[str, Any]] = None

    def load_lookup_json(self, json_path: str) -> bool:
        """加载查找JSON文件"""
        try:
            p = Path(json_path)
            if not p.exists():
                return False
            with p.open("r", encoding="utf-8") as f:
                self._lookup_data = json.load(f)
            return True
        except Exception:
            return False

    def _normalize(self, s: str) -> str:
        """规范化字符串用于比较"""
        return s.strip().lower() if s else ""

    def _exact_index_hits(
        self, name: str, index: Dict[str, List[int]], records: List[Dict], source: MatchSource
    ) -> List[FastLookupResult]:
        """索引键与 name 完全一致（同字符串）时返回所有记录。"""
        if name not in index:
            return []
        out: List[FastLookupResult] = []
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
                )
            )
        return out

    def _partial_hits(
        self, name: str, index: Dict[str, List[int]], records: List[Dict]
    ) -> List[FastLookupResult]:
        """子串模糊匹配，总量上限与原先一致（约 3 条）。"""
        results: List[FastLookupResult] = []
        norm_name = self._normalize(name)
        if not norm_name:
            return results
        for key in index.keys():
            norm_key = self._normalize(key)
            if not norm_key or norm_name not in norm_key:
                continue
            for idx in index[key]:
                if idx >= len(records):
                    continue
                rec = records[idx]
                results.append(
                    FastLookupResult(
                        found=True,
                        uri=rec.get("uri"),
                        domain=rec.get("domain"),
                        table_name=rec.get("tableName"),
                        schema=rec.get("schema"),
                        biz_name=rec.get("bizName"),
                        metadata_name=rec.get("metadataName"),
                        match_type="partial",
                        match_source="partial",
                    )
                )
                if len(results) >= 3:
                    return results
            if len(results) >= 3:
                break
        return results

    def lookup(self, billname: str) -> List[FastLookupResult]:
        """
        根据单据名称查找元数据
        优先精确匹配 bizName，再精确匹配 metadataName，最后子串模糊。
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

        # 3) 模糊：先查 biz 再查 metadata
        r = self._partial_hits(billname, biz_index, records)
        if r:
            return r
        return self._partial_hits(billname, metadata_index, records)

    def lookup_multiple(self, billnames: List[str]) -> Dict[str, List[FastLookupResult]]:
        """批量查找多个单据名称"""
        return {name: self.lookup(name) for name in billnames}

    def get_by_uri(self, uri: str) -> Optional[FastLookupResult]:
        """根据URI直接查找"""
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

    # 尝试从配置或默认路径加载
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

"""
旗舰版元数据 HTTP 调用与 JSON 解析，对齐 Java：
- BusinessObjectMetadataParser
- BusinessObjectToolUtil（getBusinessObjectInfo 主流程与 bizTableGroupToMap）
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from iuap_common.bip_auth import http_get_json

logger = logging.getLogger(__name__)

try:
    from metadata_fast_lookup import (
        FastLookupResult,
        MetadataFastLookup,
        get_fast_lookup,
        unique_uris_in_results,
    )
    _FAST_LOOKUP_ENABLED = True
except ImportError:
    _FAST_LOOKUP_ENABLED = False
    unique_uris_in_results = None  # type: ignore

# 与 Java ENTITY_CACHE 类似的简单 TTL 缓存（按 uri）
_uri_cache: Dict[str, Tuple[str, float]] = {}
_uri_lock = threading.Lock()

# 默认缓存 TTL（秒），可通过 cache.ttl_seconds 配置覆盖
_URI_TTL_DEFAULT = 30 * 60


def _get_uri_ttl(cfg: dict) -> float:
    """从配置中获取 URI 缓存 TTL"""
    cache_cfg = cfg.get("cache") or {}
    if cache_cfg.get("enabled", True):
        return float(cache_cfg.get("ttl_seconds", _URI_TTL_DEFAULT))
    return _URI_TTL_DEFAULT


def _cache_get(uri: str) -> Optional[str]:
    """从缓存获取URI响应"""
    with _uri_lock:
        entry = _uri_cache.get(uri)
        if entry is None:
            return None
        body, expire_time = entry
        if time.monotonic() > expire_time:
            del _uri_cache[uri]
            return None
        return body


def _cache_put(uri: str, body: str, ttl: float) -> None:
    """存入URI响应到缓存，指定TTL秒"""
    with _uri_lock:
        expire_time = time.monotonic() + ttl
        _uri_cache[uri] = (body, expire_time)


def _text(node: Any, field: str) -> Optional[str]:
    if not isinstance(node, dict):
        return None
    v = node.get(field)
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _first_non_empty(*values: Optional[str]) -> Optional[str]:
    for v in values:
        if v is not None and str(v).strip():
            return v
    return None


@dataclass
class EnumItem:
    code: Optional[str] = None
    name: Optional[str] = None


@dataclass
class AttributeInfo:
    display_name: Optional[str] = None
    db_column_name: Optional[str] = None
    type: Optional[str] = None
    name: Optional[str] = None
    enums: Optional[List[EnumItem]] = None
    uri: Optional[str] = None
    table_name: Optional[str] = None


@dataclass
class BizTableGroup:
    bill_name: Optional[str] = None
    domain: Optional[str] = None
    table_name: Optional[str] = None
    attributes: List[AttributeInfo] = field(default_factory=list)


@dataclass
class BusinessObjectCodeNameResult:
    code: Optional[str] = None
    name: Optional[str] = None
    id: Optional[str] = None
    available_names: Optional[List[str]] = None

    def needs_user_selection(self) -> bool:
        return bool(self.available_names)


@dataclass
class EntityDetailResult:
    entity_id: Optional[str] = None
    uri: Optional[str] = None
    bo_id: Optional[str] = None
    business_object_code: Optional[str] = None


@dataclass
class BusinessPropertySummary:
    name: Optional[str] = None
    display_name: Optional[str] = None
    uri: Optional[str] = None
    table_name: Optional[str] = None


@dataclass
class EntityModelForAI:
    uri: Optional[str] = None
    table_name: Optional[str] = None
    business_object_code: Optional[str] = None
    domain: Optional[str] = None
    schema: Optional[str] = None
    business_properties: List[BusinessPropertySummary] = field(default_factory=list)
    foreign_keys: List[str] = field(default_factory=list)


def _has_term_code(node: Dict[str, Any], code: str) -> bool:
    terms = node.get("terms")
    if not isinstance(terms, list):
        return False
    for t in terms:
        if isinstance(t, dict) and _text(t, "code") == code:
            return True
    return False


def _score_bill_candidate(node: Dict[str, Any]) -> int:
    if not isinstance(node, dict):
        return -1
    tn = _text(node, "tableName")
    if not tn or not str(tn).strip():
        return -1
    score = 0
    if _has_term_code(node, "isMain"):
        score += 20
    if "businessObjectId" in node:
        score += 6
    ca = node.get("codeAttribute")
    if isinstance(ca, dict):
        score += 5
    ka = node.get("keyAttribute")
    if isinstance(ka, dict):
        score += 3
    if _first_non_empty(_text(node, "displayName"), _text(node, "title")):
        score += 2
    if _text(node, "domain"):
        score += 1
    return score


def _find_best_bill_node(node: Any) -> Tuple[Optional[Dict[str, Any]], int]:
    best: Optional[Dict[str, Any]] = None
    best_score = -1

    def walk(n: Any) -> None:
        nonlocal best, best_score
        if isinstance(n, dict):
            sc = _score_bill_candidate(n)
            if sc > best_score:
                best_score = sc
                best = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for item in n:
                walk(item)

    walk(node)
    return best, best_score


def _find_first_text_by_field_name(node: Any, field_name: str) -> Optional[str]:
    if isinstance(node, dict):
        v = node.get(field_name)
        if isinstance(v, str):
            return v
        for ch in node.values():
            found = _find_first_text_by_field_name(ch, field_name)
            if found:
                return found
    elif isinstance(node, list):
        for ch in node:
            found = _find_first_text_by_field_name(ch, field_name)
            if found:
                return found
    return None


def _find_first_object_by_meta_type_and_uri(
    node: Any, meta_type: str, uri: str
) -> Optional[Dict[str, Any]]:
    if isinstance(node, dict):
        if _text(node, "metaType") == meta_type and _text(node, "uri") == uri:
            return node
        for ch in node.values():
            found = _find_first_object_by_meta_type_and_uri(ch, meta_type, uri)
            if found:
                return found
    elif isinstance(node, list):
        for ch in node:
            found = _find_first_object_by_meta_type_and_uri(ch, meta_type, uri)
            if found:
                return found
    return None


def _parse_enum_items(attribute_node: Dict[str, Any]) -> Optional[List[EnumItem]]:
    items_node = None
    type_node = attribute_node.get("type")
    if isinstance(type_node, dict):
        items_node = type_node.get("items")
    if items_node is None:
        items_node = attribute_node.get("items")
    if not isinstance(items_node, list):
        return None
    out: List[EnumItem] = []
    for item_node in items_node:
        if not isinstance(item_node, dict):
            continue
        code = _text(item_node, "code")
        name = _text(item_node, "name")
        if (not code or not str(code).strip()) and (not name or not str(name).strip()):
            continue
        out.append(EnumItem(code=code, name=name))
    return out or None


def _parse_type_text(attribute_node: Dict[str, Any]) -> Optional[str]:
    tu = _text(attribute_node, "typeUri")
    if tu and str(tu).strip():
        return tu
    type_node = attribute_node.get("type")
    if type_node is None:
        return _text(attribute_node, "type")
    if isinstance(type_node, str):
        return type_node
    if isinstance(type_node, dict):
        n = _text(type_node, "name")
        if n and str(n).strip():
            return n
        tid = _text(type_node, "id")
        if tid and str(tid).strip():
            return tid
    return None


def _parse_attribute_node(
    attribute_node: Optional[Dict[str, Any]],
) -> Optional[AttributeInfo]:
    if not isinstance(attribute_node, dict):
        return None
    assoc = attribute_node.get("association")
    if isinstance(assoc, dict):
        return None
    db_column_name = _first_non_empty(
        _text(attribute_node, "columnName"), _text(attribute_node, "fieldName")
    )
    if not db_column_name or not str(db_column_name).strip():
        return None
    ai = AttributeInfo()
    ai.display_name = _first_non_empty(
        _text(attribute_node, "displayName"), _text(attribute_node, "title")
    )
    ai.db_column_name = db_column_name
    ai.type = _parse_type_text(attribute_node)
    ai.name = _text(attribute_node, "name")
    ai.enums = _parse_enum_items(attribute_node)
    biztype = _text(attribute_node, "biztype")
    dtmt = _text(attribute_node, "dataTypeMetaType")
    type_uri = _text(attribute_node, "typeUri")
    name = _text(attribute_node, "name")
    if biztype == "quote" and type_uri:
        ai.uri = type_uri
    if dtmt == "Class" and name == "headParallel":
        pass  # handled in process_attribute_node
    elif dtmt == "elastic":
        pass
    elif dtmt == "Class" and name != "headParallel":
        ai.type = "参照类型，此处为参照对象id，long类型，需使用toString()"
    return ai


def _add_to_table(
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    table_name: str,
    attribute_info: Optional[AttributeInfo],
    add_first: bool,
) -> None:
    if attribute_info is None:
        return
    tn = table_name or ""
    key = f"{tn}|{attribute_info.db_column_name}|{attribute_info.name}"
    if key in dedupe:
        return
    dedupe.add(key)
    lst = table_to_attributes.setdefault(tn, [])
    if add_first:
        lst.insert(0, attribute_info)
    else:
        lst.append(attribute_info)


def _process_attribute_nodes(
    attributes_node: Any,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    main_table_name: str,
    fetch_json_fn,
    parse_fn,
) -> None:
    if not isinstance(attributes_node, list):
        return
    for attribute_node in attributes_node:
        if isinstance(attribute_node, dict):
            _process_attribute_node(
                attribute_node,
                table_to_attributes,
                dedupe,
                main_table_name,
                fetch_json_fn,
                parse_fn,
            )


def _process_attribute_node(
    attribute_node: Dict[str, Any],
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    main_table_name: str,
    fetch_json_fn,
    parse_fn,
) -> None:
    data_type_meta_type = _text(attribute_node, "dataTypeMetaType")
    type_uri = _text(attribute_node, "typeUri")
    name = _text(attribute_node, "name")
    biztype = _text(attribute_node, "biztype")

    if data_type_meta_type == "elastic":
        _process_elastic_attribute(
            type_uri,
            attribute_node,
            name,
            main_table_name,
            table_to_attributes,
            dedupe,
            fetch_json_fn,
            parse_fn,
        )
    elif data_type_meta_type == "Class" and name == "headParallel":
        _process_parallel_attribute(
            type_uri,
            name,
            main_table_name,
            table_to_attributes,
            dedupe,
            fetch_json_fn,
            parse_fn,
        )
    else:
        attribute_info = _parse_attribute_node(attribute_node)
        if attribute_info is None:
            return
        if biztype == "quote" and type_uri:
            attribute_info.uri = type_uri
        table_name = _text(attribute_node, "tableName")
        if not table_name or not str(table_name).strip():
            table_name = main_table_name
        _add_to_table(table_to_attributes, dedupe, table_name, attribute_info, False)


def _process_elastic_attribute(
    type_uri: Optional[str],
    attribute_node: Dict[str, Any],
    name: Optional[str],
    main_table_name: str,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    fetch_json_fn,
    parse_fn,
) -> None:
    if not type_uri:
        return
    elastic_json = fetch_json_fn(type_uri)
    if not elastic_json:
        return
    try:
        elastic_groups = parse_fn(elastic_json)
        for elastic_group in elastic_groups:
            elastic_attrs = elastic_group.attributes or []
            prefixed: List[AttributeInfo] = []
            for ea in elastic_attrs:
                na = AttributeInfo()
                na.display_name = ea.display_name
                na.db_column_name = ea.db_column_name
                na.type = ea.type
                na.name = f"{name}.{ea.name}" if name else ea.name
                na.enums = ea.enums
                prefixed.append(na)
            elastic_table_name = elastic_group.table_name or (f"{main_table_name}_{name}")
            table_to_attributes[elastic_table_name] = prefixed
        main_attrs = table_to_attributes.setdefault(main_table_name, [])
        display_name = _text(attribute_node, "displayName")
        column_name = _text(attribute_node, "columnName")
        elastic_group_attr = AttributeInfo()
        elastic_group_attr.display_name = display_name
        elastic_group_attr.db_column_name = column_name
        elastic_group_attr.type = "Long"
        elastic_group_attr.name = name
        main_attrs.append(elastic_group_attr)
    except Exception as e:
        logger.warning("解析特征属性数据失败: %s", e, exc_info=True)


def _process_parallel_attribute(
    type_uri: Optional[str],
    name: Optional[str],
    main_table_name: str,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    fetch_json_fn,
    parse_fn,
) -> None:
    if not type_uri:
        return
    parallel_json = fetch_json_fn(type_uri)
    if not parallel_json:
        return
    try:
        parallel_groups = parse_fn(parallel_json)
        for parallel_group in parallel_groups:
            parallel_attrs = parallel_group.attributes or []
            prefixed: List[AttributeInfo] = []
            for pa in parallel_attrs:
                na = AttributeInfo()
                na.display_name = pa.display_name
                na.db_column_name = pa.db_column_name
                na.type = pa.type
                na.name = f"{name}.{pa.name}" if name else pa.name
                na.enums = pa.enums
                prefixed.append(na)
            parallel_table_name = parallel_group.table_name or (f"{main_table_name}_{name}")
            table_to_attributes[parallel_table_name] = prefixed
    except Exception as e:
        logger.warning("解析平行表数据失败: %s", e, exc_info=True)


def parse_metadata_json(
    json_str: str,
    *,
    fetch_json_fn=None,
    _depth: int = 0,
) -> List[BizTableGroup]:
    """
    解析实体 DB 信息 JSON 为 BizTableGroup 列表。
    fetch_json_fn(uri) 用于 elastic/parallel 子查询；主入口应传入真实 fetch。
    """
    if _depth > 50:
        return []
    if fetch_json_fn is None:
        def fetch_json_fn(_uri: str) -> Optional[str]:  # type: ignore
            return None
    root = json.loads(json_str)
    data_node = root.get("data") if isinstance(root.get("data"), dict) else root
    if not isinstance(data_node, dict):
        data_node = root if isinstance(root, dict) else {}

    bill_node, _ = _find_best_bill_node(data_node)
    if bill_node is None:
        bill_node = data_node

    class_uri = _first_non_empty(
        _text(bill_node.get("codeAttribute") if isinstance(bill_node.get("codeAttribute"), dict) else {}, "classUri"),
        _text(bill_node.get("keyAttribute") if isinstance(bill_node.get("keyAttribute"), dict) else {}, "classUri"),
        _find_first_text_by_field_name(bill_node, "classUri"),
        _find_first_text_by_field_name(data_node, "classUri"),
    )

    class_node = None
    if class_uri:
        class_node = _find_first_object_by_meta_type_and_uri(data_node, "Class", class_uri)
        if class_node is None:
            class_node = _find_first_object_by_meta_type_and_uri(root, "Class", class_uri)

    bill_name = _first_non_empty(
        _text(bill_node, "displayName"),
        _text(bill_node, "title"),
        _text(class_node, "displayName") if class_node else None,
        _text(class_node, "title") if class_node else None,
        _text(data_node, "displayName"),
        _text(data_node, "title"),
    )

    main_table_name = _first_non_empty(
        _text(bill_node, "tableName"),
        _text(class_node, "tableName") if class_node else None,
        _text(data_node, "tableName"),
    )

    domain = _first_non_empty(
        _text(class_node, "domain") if class_node else None,
        _text(bill_node, "domain"),
        _text(data_node, "domain"),
    )

    attributes_node = (
        class_node.get("attributes") if class_node else None
    ) or bill_node.get("attributes")
    association_attributes_node = (
        class_node.get("associationAttributes") if class_node else None
    ) or bill_node.get("associationAttributes")

    table_to_attributes: Dict[str, List[AttributeInfo]] = {}
    dedupe: Set[str] = set()

    def inner_fetch(uri: str) -> Optional[str]:
        j = fetch_json_fn(uri)
        return j

    def inner_parse(js: str) -> List[BizTableGroup]:
        return parse_metadata_json(js, fetch_json_fn=fetch_json_fn, _depth=_depth + 1)

    ka = bill_node.get("keyAttribute") if isinstance(bill_node.get("keyAttribute"), dict) else None
    ca = bill_node.get("codeAttribute") if isinstance(bill_node.get("codeAttribute"), dict) else None
    key_attr = _parse_attribute_node(ka) if ka else None
    code_attr = _parse_attribute_node(ca) if ca else None
    _add_to_table(table_to_attributes, dedupe, main_table_name or "", key_attr, True)
    _add_to_table(table_to_attributes, dedupe, main_table_name or "", code_attr, True)

    _process_attribute_nodes(
        attributes_node,
        table_to_attributes,
        dedupe,
        main_table_name or "",
        inner_fetch,
        inner_parse,
    )
    _process_attribute_nodes(
        association_attributes_node,
        table_to_attributes,
        dedupe,
        main_table_name or "",
        inner_fetch,
        inner_parse,
    )

    groups: List[BizTableGroup] = []
    for tname, attrs in table_to_attributes.items():
        g = BizTableGroup()
        g.bill_name = bill_name
        g.domain = domain
        g.table_name = tname
        g.attributes = attrs
        groups.append(g)
    return groups


def _api_success_code(root: Any) -> bool:
    if not isinstance(root, dict):
        return False
    c = root.get("code")
    if c is None:
        c = root.get("resultCode")
    return str(c).strip() == "200"


def parse_bo_identity_from_entity_db_json(json_str: str) -> Optional[BusinessObjectCodeNameResult]:
    """
    从 queryByUri（实体库表）JSON 中解析 businessObjectCode / businessObjectId，
    用于 isIncludeSub=Y 且侧栏选定 queryUri 时走 byboid 全量实体（含子表）链路。
    """
    if not json_str:
        return None
    try:
        root = json.loads(json_str)
    except Exception:
        return None
    if not isinstance(root, dict) or not _api_success_code(root):
        return None
    data_node = root.get("data")
    if not isinstance(data_node, dict):
        return None
    inner = data_node.get("data")
    if isinstance(inner, dict):
        data_node = inner
    code = _text(data_node, "businessObjectCode")
    bo_id = _first_non_empty(
        _text(data_node, "businessObjectId"),
        _text(data_node, "boId"),
    )
    if not code or not str(code).strip() or str(code).strip() == "null":
        code = _find_first_text_by_field_name(root, "businessObjectCode")
    if not bo_id or not str(bo_id).strip() or str(bo_id).strip() == "null":
        bo_id = _first_non_empty(
            _find_first_text_by_field_name(root, "businessObjectId"),
            _find_first_text_by_field_name(root, "boId"),
        )
    code_s = str(code).strip() if code else ""
    id_s = str(bo_id).strip() if bo_id else ""
    if code_s in ("null",):
        code_s = ""
    if id_s in ("null",):
        id_s = ""
    if not code_s and not id_s:
        return None
    return BusinessObjectCodeNameResult(
        code=code_s or None,
        id=id_s or None,
        name=None,
    )


def parse_business_object_code_name(result: Any, billname: str) -> Optional[BusinessObjectCodeNameResult]:
    if not isinstance(result, dict) or not _api_success_code(result):
        return None
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return None
    search_name = (billname or "").strip()
    target_nodes: List[Dict[str, Any]] = []
    inner_data_array = data_node.get("data")
    if isinstance(inner_data_array, list):
        for item in inner_data_array:
            if isinstance(item, dict):
                target_nodes.append(item)

    nodes_with_parent: List[Tuple[Dict[str, Any], Optional[str]]] = []
    if not target_nodes:
        bo_arr = data_node.get("METACLASS")
        if isinstance(bo_arr, list):
            for bo in bo_arr:
                if not isinstance(bo, dict):
                    continue
                parent_code = _text(bo, "code")
                children = bo.get("children")
                if isinstance(children, list):
                    for child in children:
                        if isinstance(child, dict):
                            nodes_with_parent.append((child, parent_code))

    for node in target_nodes:
        if _text(node, "name") == search_name:
            code = _text(node, "code")
            nid = _text(node, "id")
            if code and code != "null":
                return BusinessObjectCodeNameResult(code=code, name=_text(node, "name"), id=nid)
    for node, parent_code in nodes_with_parent:
        if _text(node, "name") == search_name:
            nid = _text(node, "id")
            if parent_code and parent_code != "null":
                return BusinessObjectCodeNameResult(
                    code=parent_code, name=_text(node, "name"), id=nid
                )

    for node in target_nodes:
        name = _text(node, "name")
        if name and search_name in name:
            code = _text(node, "code")
            nid = _text(node, "id")
            if code and code != "null":
                return BusinessObjectCodeNameResult(code=code, name=name, id=nid)
    for node, parent_code in nodes_with_parent:
        name = _text(node, "name")
        if name and search_name in name:
            nid = _text(node, "id")
            if parent_code and parent_code != "null":
                return BusinessObjectCodeNameResult(code=parent_code, name=name, id=nid)

    all_names: List[str] = []
    for node in target_nodes:
        n = _text(node, "name")
        if n:
            all_names.append(n)
    for node, _ in nodes_with_parent:
        n = _text(node, "name")
        if n:
            all_names.append(n)
    if all_names:
        return BusinessObjectCodeNameResult(available_names=all_names)
    return None


def _collect_entity_details(entities_array: Any, out: List[EntityDetailResult]) -> None:
    if not isinstance(entities_array, list):
        return
    for entity in entities_array:
        if not isinstance(entity, dict):
            continue
        eid = _text(entity, "id")
        if eid in (None, "", "null"):
            eid = None
        uri = _text(entity, "uri")
        bo_id = _text(entity, "businessObjectId")
        boc = _text(entity, "businessObjectCode")
        out.append(
            EntityDetailResult(
                entity_id=eid, uri=uri, bo_id=bo_id, business_object_code=boc
            )
        )
        ch = entity.get("children")
        if isinstance(ch, list):
            _collect_entity_details(ch, out)


def parse_entity_detail_from_by_bo_id(result: Any) -> Optional[List[EntityDetailResult]]:
    if not isinstance(result, dict) or not _api_success_code(result):
        return None
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return None
    entities_node = data_node.get("entities")
    if not isinstance(entities_node, list):
        inner = data_node.get("data")
        if isinstance(inner, dict):
            entities_node = inner.get("entities")
    if not isinstance(entities_node, list):
        return None
    out: List[EntityDetailResult] = []
    _collect_entity_details(entities_node, out)
    return out or None


def parse_detail_by_entity_id_response(result: Any) -> Optional[EntityModelForAI]:
    if not isinstance(result, dict) or not _api_success_code(result):
        return None
    data_node = result.get("data")
    if not isinstance(data_node, dict):
        return None
    inner_data = data_node.get("data")
    if isinstance(inner_data, dict):
        data_node = inner_data

    model = EntityModelForAI()
    entity_uri = _text(data_node, "uri")
    model.uri = entity_uri
    model.table_name = _text(data_node, "tableName")
    model.business_object_code = _text(data_node, "businessObjectCode")
    domain = _text(data_node, "domain")
    model.domain = domain
    schema = _text(data_node, "schema")
    if (not schema or not str(schema).strip()) and domain and str(domain).startswith("c-"):
        schema = domain.replace("-", "_") + "_db"
    model.schema = schema

    props: List[BusinessPropertySummary] = []
    bp_array = data_node.get("businessProperties")
    if isinstance(bp_array, list):
        for bp in bp_array:
            if not isinstance(bp, dict):
                continue
            summary = BusinessPropertySummary()
            summary.name = _text(bp, "name")
            summary.display_name = _text(bp, "displayName")
            summary.uri = _text(bp, "uri")
            all_tables = bp.get("allTables")
            if isinstance(all_tables, list) and len(all_tables) > 0:
                ft = all_tables[0]
                summary.table_name = str(ft) if not isinstance(ft, dict) else None
            else:
                summary.table_name = None
            props.append(summary)
            cf_arr = bp.get("characterFields")
            if isinstance(cf_arr, list):
                for cf in cf_arr:
                    if not isinstance(cf, dict):
                        continue
                    cfs = BusinessPropertySummary()
                    cfs.name = _text(cf, "name")
                    cfs.display_name = _text(cf, "displayName")
                    cfs.uri = _text(cf, "uri")
                    cft = cf.get("allTables")
                    if isinstance(cft, list) and len(cft) > 0:
                        cfs.table_name = str(cft[0])
                    props.append(cfs)
    model.business_properties = props

    foreign_keys: List[str] = []
    assoc_attrs = data_node.get("associationAttributes")
    if isinstance(assoc_attrs, list) and entity_uri:
        for attr in assoc_attrs:
            if not isinstance(attr, dict):
                continue
            association_node = attr.get("association")
            if isinstance(association_node, dict):
                type_b_uri = _text(association_node, "typeBUri")
                role_b = _text(association_node, "roleB")
                if entity_uri == type_b_uri and role_b:
                    foreign_keys.append(role_b)
    model.foreign_keys = foreign_keys
    return model


def _fetch_entity_db_info_json_impl(cfg: dict, uri: str) -> Optional[str]:
    meta = cfg.get("metadata_api") or {}
    path = meta.get("query_by_uri_path") or ""
    if not path or not uri:
        return None
    cached = _cache_get(uri)
    if cached is not None:
        return cached
    try:
        payload = http_get_json(cfg, path, {"uri": uri})
        if isinstance(payload, dict):
            body = json.dumps(payload, ensure_ascii=False)
            ttl = _get_uri_ttl(cfg)
            _cache_put(uri, body, ttl)
            return body
    except Exception:
        return None
    return None


def fetch_business_object_by_name(cfg: dict, billname: str) -> Optional[BusinessObjectCodeNameResult]:
    meta = cfg.get("metadata_api") or {}
    path = meta.get("search_by_name_path") or ""
    if not path:
        return None
    try:
        payload = http_get_json(cfg, path, {"key": billname.strip()})
        return parse_business_object_code_name(payload, billname)
    except Exception:
        return None


def fetch_entity_detail_by_bo_id(cfg: dict, cn: BusinessObjectCodeNameResult) -> Optional[List[EntityDetailResult]]:
    meta = cfg.get("metadata_api") or {}
    path = meta.get("entity_list_by_bo_id_path") or ""
    if not path or not cn.id:
        return None
    q: Dict[str, str] = {
        "boId": cn.id or "",
        "businessObjectCode": cn.code or "",
    }
    # OpenAPI 示例含 version，默认 2；部分环境缺省可能导致实体树不完整
    ver = meta.get("entity_list_by_bo_id_version")
    q["version"] = str(ver).strip() if ver is not None and str(ver).strip() else "2"
    try:
        payload = http_get_json(cfg, path, q)
        return parse_entity_detail_from_by_bo_id(payload)
    except Exception:
        return None


def fetch_detail_by_entity_id(cfg: dict, ed: EntityDetailResult) -> Optional[EntityModelForAI]:
    meta = cfg.get("metadata_api") or {}
    path = meta.get("entity_info_by_entity_id_path") or ""
    if not path or not ed.entity_id:
        return None
    try:
        payload = http_get_json(
            cfg,
            path,
            {
                "entityId": ed.entity_id or "",
                "uri": ed.uri or "",
                "boId": ed.bo_id or "",
                "businessObjectCode": ed.business_object_code or "",
            },
        )
        return parse_detail_by_entity_id_response(payload)
    except Exception:
        return None


def parse_foreign_keys_from_json(
    json_str: str, _entity_uri: Optional[str] = None
) -> List[Dict[str, Any]]:
    """对齐 Java parseForeignKeysFromJson（quote 类型外键列与 refUri）。"""
    if not json_str:
        return []
    try:
        root = json.loads(json_str)
    except Exception:
        return []
    if not isinstance(root, dict) or not _api_success_code(root):
        return []
    data_node = root.get("data")
    if not isinstance(data_node, dict):
        return []
    inner = data_node.get("data")
    if isinstance(inner, dict):
        data_node = inner
    assoc_attrs = data_node.get("associationAttributes")
    if not isinstance(assoc_attrs, list):
        return []
    out: List[Dict[str, Any]] = []
    for attr in assoc_attrs:
        if not isinstance(attr, dict):
            continue
        biztype = str(attr.get("biztype", "")).replace('"', "")
        if biztype != "quote":
            continue
        column_name = attr.get("columnName")
        type_uri = attr.get("typeUri")
        cn = str(column_name).replace('"', "") if column_name is not None else None
        tu = str(type_uri).replace('"', "") if type_uri is not None else None
        if cn or tu:
            out.append({"columnName": cn, "refUri": tu})
    return out


def _unwrap_entity_db_data_node(root: dict) -> Optional[dict]:
    if not isinstance(root, dict) or not _api_success_code(root):
        return None
    data_node = root.get("data")
    if not isinstance(data_node, dict):
        return None
    inner = data_node.get("data")
    if isinstance(inner, dict):
        return inner
    return data_node


def composition_child_uris_from_entity_db_json(json_str: str) -> List[str]:
    """
    从 queryByUri 返回体中解析组合（composition）子实体 URI。
    与 BusinessObjectToolUtilV2.buildChildEntities 一致：association.type == composition 时取属性 typeUri。
    部分环境子表不在 getEntityListByBOId 的 children 树里，仅出现在父实体的 associationAttributes。
    """
    if not json_str:
        return []
    try:
        root = json.loads(json_str)
    except Exception:
        return []
    data_node = _unwrap_entity_db_data_node(root)
    if not isinstance(data_node, dict):
        return []
    assoc_attrs = data_node.get("associationAttributes")
    if not isinstance(assoc_attrs, list):
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for attr in assoc_attrs:
        if not isinstance(attr, dict):
            continue
        assoc = attr.get("association")
        if not isinstance(assoc, dict):
            continue
        if (_text(assoc, "type") or "").strip().lower() != "composition":
            continue
        tu = _text(attr, "typeUri")
        if tu and str(tu).strip() and tu not in seen:
            seen.add(tu)
            out.append(str(tu).strip())
    return out


def _load_scheme_list(cfg: dict) -> List[Dict[str, Any]]:
    paths = cfg.get("paths") or {}
    raw = paths.get("scheme_info_json") or "reference/scheme-info.json"
    base = Path(__file__).resolve().parent.parent
    p = Path(raw)
    if not p.is_absolute():
        p = base / p
    if not p.is_file():
        return []
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def get_scheme_by_domain(cfg: dict, domain: Optional[str]) -> Optional[str]:
    if not domain or not str(domain).strip():
        return None
    target_key = "mdd_schema." + str(domain).strip()
    for scheme in _load_scheme_list(cfg):
        if not isinstance(scheme, dict):
            continue
        if scheme.get("key") == target_key:
            ev = scheme.get("exclusiveValue")
            if ev and str(ev).strip():
                return str(ev).strip()
            v = scheme.get("value")
            return str(v).strip() if v else None
    return None


def get_refer_scheme(cfg: dict, domain: Optional[str]) -> str:
    s = get_scheme_by_domain(cfg, domain)
    return s if s else "scheme"


def _attr_to_map(
    attr: AttributeInfo,
    group: BizTableGroup,
    entity_result: EntityDetailResult,
    entity_model: Optional[EntityModelForAI],
    property_table_name_map: Dict[str, str],
    uri_to_ref_json: Dict[str, str],
    field_filter: List[str],
    need_ref: bool,
    table_template: Optional[str],
    cfg: dict,
) -> Optional[Dict[str, Any]]:
    if field_filter:
        dn = attr.display_name
        if not dn or dn not in field_filter:
            return None
    am: Dict[str, Any] = {
        "name": attr.name,
        "displayName": attr.display_name,
        "dbColumnName": attr.db_column_name,
        "type": attr.type,
    }
    attr_table = property_table_name_map.get(attr.name or "")
    if attr_table is None and attr.display_name:
        attr_table = property_table_name_map.get(attr.display_name)
    if not attr_table:
        attr_table = group.table_name
    am["tableName"] = attr_table
    attr_uri = attr.uri
    if attr_uri:
        am["uri"] = attr_uri
        if need_ref:
            ref_json = uri_to_ref_json.get(attr_uri)
            if ref_json:
                try:
                    groups = parse_metadata_json(ref_json, fetch_json_fn=lambda u: None)
                    if groups:
                        ref_group = groups[0]
                        ref_attrs: List[Dict[str, Any]] = []
                        for ra in ref_group.attributes or []:
                            an = ra.name
                            adn = ra.display_name
                            if an in ("name", "code") or (
                                table_template and adn and adn in table_template
                            ):
                                ref_attrs.append(
                                    {
                                        "dbColumnName": ra.db_column_name,
                                        "displayName": ra.display_name,
                                    }
                                )
                        domain = ref_group.domain
                        sch = get_refer_scheme(cfg, domain)
                        if not sch and domain and str(domain).startswith("c-"):
                            sch = str(domain).replace("-", "_") + "_db"
                        am["referenceStructure"] = {
                            "billName": ref_group.bill_name,
                            "domain": domain,
                            "tableName": ref_group.table_name,
                            "attributes": ref_attrs,
                            "scheme": sch,
                        }
                except Exception:
                    pass
    if attr.enums:
        am["enums"] = [{"code": e.code, "name": e.name} for e in attr.enums]
    return am


def biz_table_group_to_map(
    cfg: dict,
    group: BizTableGroup,
    entity_result: EntityDetailResult,
    entity_model: Optional[EntityModelForAI],
    foreign_keys: List[Dict[str, Any]],
    doc_fields: Optional[str],
    is_sql: str,
    table_template: Optional[str],
    batch_fetcher,
) -> Optional[Dict[str, Any]]:
    field_filter = [
        x.strip()
        for x in (doc_fields or "").split(",")
        if x and str(x).strip()
    ]
    need_ref = str(is_sql).strip().upper() == "Y"
    property_table_name_map: Dict[str, str] = {}
    if entity_model and entity_model.business_properties:
        for prop in entity_model.business_properties:
            if prop.table_name:
                if prop.name:
                    property_table_name_map[prop.name] = prop.table_name  # type: ignore
                if prop.display_name:
                    property_table_name_map[prop.display_name] = prop.table_name  # type: ignore

    uris_to_fetch: Set[str] = set()
    if need_ref and group.attributes:
        for attr in group.attributes:
            if field_filter and (not attr.display_name or attr.display_name not in field_filter):
                continue
            if attr.uri:
                uris_to_fetch.add(attr.uri)
    uri_to_ref_json: Dict[str, str] = {}
    if need_ref and uris_to_fetch:
        uri_to_ref_json = batch_fetcher(uris_to_fetch)

    attrs_out: List[Dict[str, Any]] = []
    if group.attributes:
        for attr in group.attributes:
            m = _attr_to_map(
                attr,
                group,
                entity_result,
                entity_model,
                property_table_name_map,
                uri_to_ref_json,
                field_filter,
                need_ref,
                table_template,
                cfg,
            )
            if m:
                attrs_out.append(m)

    out: Dict[str, Any] = {
        "tableName": group.table_name,
        "billName": group.bill_name,
        "domain": group.domain,
        "uri": entity_result.uri,
        "businessObjectCode": entity_result.business_object_code,
        "schema": entity_model.schema if entity_model else None,
        "attributes": attrs_out,
    }
    if foreign_keys:
        out["foreignKeys"] = foreign_keys
    return out


def _format_fast_lookup_ambiguous(
    intro: str, billname: str, fast_results: List["FastLookupResult"]
) -> str:
    """
    本地索引命中同一单据名/键但 URI 不同，避免合并多条元数据；引导用户用 queryUri 重试。
    """
    out: List[str] = [intro, "\n", f"停止：{billname!r} 在本地元数据索引中命中多条不同 URI，必须选定其一，否则结果会混单出错。\n请用户或 Agent 在下次查询的 request 中设置 queryUri 为下面某一条 uri，亦可保留 allbillname 作展示用。\n", "\n候选：\n"]
    seen: Set[str] = set()
    n = 0
    for fr in fast_results:
        u = (fr.uri or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        n += 1
        out.append(
            f"  {n}) uri: {u}\n     metadataName: {fr.metadata_name or ''}  "
            f"bizName: {fr.biz_name or ''}  domain: {fr.domain or ''}  tableName: {fr.table_name or ''}\n"
        )
    out.append(
        "\n（再次调用示例：request 中传 \"queryUri\": \"<所选 uri>\" ）\n"
    )
    return "".join(out)


def get_business_object_info(cfg: dict, params: Dict[str, Any], use_fast_lookup: bool = True) -> str:
    """
    对齐 BusinessObjectToolUtil.getBusinessObjectInfo。
    params: allbillname, queryUri(可选，歧义时用户选定后重试), isIncludeSub, docFields, isDescField, isSQL, tableTemplate(optional), modulename(ignored)
    use_fast_lookup: 是否优先使用快速查找（默认True）
    isIncludeSub=Y：走 byboid 扁平化后的多实体 queryByUri；queryUri 续查时从锚点 uri 解析 boId；索引多 URI 时仍先输出候选。
    isIncludeSub=N：可用本地索引 + 单次 queryByUri（queryUri 直查）。
    """
    lines: List[str] = ["\n业务对象属性信息如下:\n"]
    q_raw = params.get("queryUri") or params.get("query_uri")
    query_uri_param = str(q_raw).strip() if q_raw is not None else ""

    allbillname = params.get("allbillname")
    allbillname_str = str(allbillname).strip() if allbillname is not None else ""
    if not query_uri_param and not allbillname_str:
        return lines[0] + "错误: 请提供 allbillname（中文单据/元数据名称）或 queryUri（元数据实体 uri）"

    is_include_sub_obj = params.get("isIncludeSub")
    doc_fields = params.get("docFields")
    if str(params.get("isDescField", "Y")).strip().upper() == "N":
        doc_fields = None
    is_sql = str(params.get("isSQL", "N"))
    table_template = params.get("tableTemplate")

    is_include_sub = bool(
        is_include_sub_obj
        and str(is_include_sub_obj).strip().upper() not in ("", "N")
    )

    def uri_fetch(uri: str) -> Optional[str]:
        return _fetch_entity_db_info_json_impl(cfg, uri)

    def batch_fetch(uris: Set[str]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for u in uris:
            j = uri_fetch(u)
            if j:
                out[u] = j
        return out

    def append_entities_from_fast_results(
        fr_list: List["FastLookupResult"],
        billname: str,
        *,
        relax_billname_filter: bool,
    ) -> None:
        nonlocal entities_list, fast_lookup_used
        if not fr_list:
            return
        # 同 uri 多行索引只处理一次
        fr_by_uri: Dict[str, "FastLookupResult"] = {}
        for fr in fr_list:
            u = (fr.uri or "").strip()
            if u and u not in fr_by_uri:
                fr_by_uri[u] = fr
        fast_lookup_used = True
        for fr in fr_by_uri.values():
            if not fr.uri:
                continue
            entity_db_json = uri_fetch(fr.uri)
            if not entity_db_json:
                continue

            def fetch_fn(u: str) -> Optional[str]:
                return uri_fetch(u)

            biz_groups = parse_metadata_json(entity_db_json, fetch_json_fn=fetch_fn)
            if not biz_groups:
                continue

            for group in biz_groups:
                if not is_include_sub:
                    gn = group.bill_name
                    if not gn:
                        continue
                    if not relax_billname_filter:
                        match = (
                            gn == billname
                            or billname in gn
                            or gn in billname
                        )
                        if not match:
                            continue

                if fr.domain and not group.domain:
                    group.domain = fr.domain

                fk_json = parse_foreign_keys_from_json(entity_db_json, fr.uri)

                entity_result = EntityDetailResult(
                    uri=fr.uri,
                    entity_id=None,
                    bo_id=None,
                    business_object_code=None
                )

                ent_map = biz_table_group_to_map(
                    cfg,
                    group,
                    entity_result,
                    None,
                    fk_json,
                    str(doc_fields) if doc_fields else None,
                    is_sql,
                    str(table_template) if table_template else None,
                    batch_fetch,
                )
                if ent_map:
                    if fr.schema:
                        ent_map["schema"] = fr.schema
                    if fr.domain:
                        ent_map["domain"] = fr.domain
                    entities_list.append(ent_map)

    entities_list: List[Dict[str, Any]] = []
    fast_lookup_used = False

    billnames = [b.strip() for b in allbillname_str.split(",") if b.strip()]

    def append_from_details(details: List[EntityDetailResult], billname: str) -> None:
        seen_uris: Set[str] = set()
        for er in details:
            if er is None:
                continue
            u = (er.uri or "").strip()
            if u:
                seen_uris.add(u)

        def fetch_fn(u: str) -> Optional[str]:
            return uri_fetch(u)

        def process_one(
            entity_result: EntityDetailResult, entity_db_json: str
        ) -> None:
            entity_model = None
            if entity_result.entity_id:
                entity_model = fetch_detail_by_entity_id(cfg, entity_result)
            biz_groups = parse_metadata_json(
                entity_db_json, fetch_json_fn=fetch_fn
            )
            if not biz_groups:
                return
            for group in biz_groups:
                if not is_include_sub:
                    gn = group.bill_name
                    if not gn:
                        continue
                    match = (
                        gn == billname
                        or billname in gn
                        or gn in billname
                    )
                    if not match:
                        continue
                fk_json = parse_foreign_keys_from_json(
                    entity_db_json, entity_result.uri
                )
                ent_map = biz_table_group_to_map(
                    cfg,
                    group,
                    entity_result,
                    entity_model,
                    fk_json,
                    str(doc_fields) if doc_fields else None,
                    is_sql,
                    str(table_template) if table_template else None,
                    batch_fetch,
                )
                if ent_map:
                    entities_list.append(ent_map)
            if not is_include_sub:
                return
            for child_uri in composition_child_uris_from_entity_db_json(
                entity_db_json
            ):
                cu = child_uri.strip()
                if not cu or cu in seen_uris:
                    continue
                seen_uris.add(cu)
                cj = uri_fetch(cu)
                if not cj:
                    continue
                child_er = EntityDetailResult(
                    uri=cu,
                    entity_id=None,
                    bo_id=entity_result.bo_id,
                    business_object_code=entity_result.business_object_code,
                )
                process_one(child_er, cj)

        for entity_result in details:
            if entity_result is None:
                continue
            entity_db_json = uri_fetch(entity_result.uri or "")
            if not entity_db_json:
                continue
            process_one(entity_result, entity_db_json)

    fast_lookup = None
    if use_fast_lookup and _FAST_LOOKUP_ENABLED:
        fast_lookup = get_fast_lookup(cfg)

    footer = (
        "\n\n实体模型字段说明: schema为schema，tableName 为表名，billName 为单据名称，domain 为领域；"
        "attributes 为属性列表，每项含 name(属性名)、displayName(显示名)、dbColumnName(数据库列名)、type(数据类型)、enums(枚举值列表)。"
        "referenceStructure 为属性字段的引用元数据结构信息"
    )

    # 含子表且已选 queryUri：单次 queryByUri 无子实体列表，须从锚点 uri 解析 boId 后走 byboid → 逐实体 queryByUri
    if query_uri_param and is_include_sub:
        anchor_json = uri_fetch(query_uri_param)
        cn_sel = parse_bo_identity_from_entity_db_json(anchor_json) if anchor_json else None
        if cn_sel and cn_sel.id and not (cn_sel.code or "").strip() and billnames:
            cn_fill = fetch_business_object_by_name(cfg, billnames[0])
            if cn_fill and not cn_fill.needs_user_selection() and (cn_fill.code or "").strip():
                cn_sel = BusinessObjectCodeNameResult(
                    code=cn_fill.code,
                    id=cn_sel.id,
                    name=cn_fill.name,
                )
        if not cn_sel or not cn_sel.id:
            if not billnames:
                return (
                    lines[0]
                    + "错误: isIncludeSub=Y 时需在 queryUri 对应元数据中解析到 businessObjectId（boId），"
                    "或同时提供 allbillname 以便通过按名称查询解析 boId"
                )
            cn_fb = fetch_business_object_by_name(cfg, billnames[0])
            if cn_fb is None:
                return (
                    lines[0]
                    + f"错误: 无法根据单据名称 [{billnames[0]}] 解析业务对象编码与 boId"
                )
            if cn_fb.needs_user_selection():
                names = cn_fb.available_names or []
                return (
                    "停止继续往下走，请从以下单据名称中选择："
                    + "、".join(names)
                )
            cn_sel = cn_fb
        elif billnames:
            cn_chk = fetch_business_object_by_name(cfg, billnames[0])
            if cn_chk and cn_chk.needs_user_selection():
                names = cn_chk.available_names or []
                return (
                    "停止继续往下走，请从以下单据名称中选择："
                    + "、".join(names)
                )
            if (
                cn_chk
                and cn_chk.code
                and cn_sel.code
                and cn_chk.code != cn_sel.code
            ):
                logger.warning(
                    "queryUri 解析的 businessObjectCode=%s 与 allbillname 解析的 %s 不一致，按 queryUri 侧 boId 继续",
                    cn_sel.code,
                    cn_chk.code,
                )

        if not cn_sel or not cn_sel.id:
            return lines[0] + "错误: 无法获取 businessObjectId（boId），无法拉取子实体列表"

        details = fetch_entity_detail_by_bo_id(cfg, cn_sel)
        if not details:
            return lines[0] + "错误: 按 boId 查询实体列表失败或为空"

        billname_for_sub = billnames[0] if billnames else (allbillname_str or "")
        append_from_details(details, billname_for_sub)
        result_map = {"entities": entities_list}
        lines.append("[已按 queryUri 锚定业务对象并拉取含子表的全量实体] ")
        lines.append(json.dumps(result_map, ensure_ascii=False))
        lines.append(footer)
        return "".join(lines)

    # 不含子表：仅按 uri 拉取（歧义后用户选定的实体，不依赖本地索引命中）
    if query_uri_param and not is_include_sub:
        fr_direct: Any = None
        if _FAST_LOOKUP_ENABLED and fast_lookup and fast_lookup.is_loaded:
            fr_direct = fast_lookup.get_by_uri(query_uri_param)
        if fr_direct is None:
            from types import SimpleNamespace

            fr_direct = SimpleNamespace(
                found=True,
                uri=query_uri_param,
                domain=None,
                schema=None,
                metadata_name=None,
                biz_name=None,
            )
        bill_label = allbillname_str or (
            getattr(fr_direct, "metadata_name", None)
            or getattr(fr_direct, "biz_name", None)
            or "metadata"
        )
        append_entities_from_fast_results(
            [fr_direct], str(bill_label), relax_billname_filter=True
        )
        result_map = {"entities": entities_list}
        if fast_lookup_used:
            lines.append("[已按 queryUri 拉取元数据] ")
        lines.append(json.dumps(result_map, ensure_ascii=False))
        lines.append(footer)
        return "".join(lines)

    for billname in billnames:
        # 仅 isIncludeSub=N 时用本地索引做单次 queryByUri；含子表走 API，但若索引多 URI 仍须先停顿让用户选 queryUri
        fast_results: List["FastLookupResult"] = []
        if (not is_include_sub) and fast_lookup and fast_lookup.is_loaded:
            fast_results = fast_lookup.lookup(billname)
        elif is_include_sub and fast_lookup and fast_lookup.is_loaded:
            probe = fast_lookup.lookup(billname)
            if (
                _FAST_LOOKUP_ENABLED
                and unique_uris_in_results is not None
                and probe
                and len(unique_uris_in_results(probe)) > 1
            ):
                return _format_fast_lookup_ambiguous(lines[0], billname, probe)

        if fast_results:
            if _FAST_LOOKUP_ENABLED and unique_uris_in_results is not None:
                if len(unique_uris_in_results(fast_results)) > 1:
                    return _format_fast_lookup_ambiguous(lines[0], billname, fast_results)
            append_entities_from_fast_results(
                fast_results, billname, relax_billname_filter=False
            )
        else:
            # 快速查找未命中，回退到原始API流程
            cn = fetch_business_object_by_name(cfg, billname)
            if cn is None:
                continue
            if cn.needs_user_selection():
                names = cn.available_names or []
                return (
                    "停止继续往下走，请从以下单据名称中选择："
                    + "、".join(names)
                )
            details = fetch_entity_detail_by_bo_id(cfg, cn)
            if not details:
                continue

            append_from_details(details, billname)

    result_map = {"entities": entities_list}
    if fast_lookup_used:
        lines.append("[使用快速查找优化] ")
    lines.append(json.dumps(result_map, ensure_ascii=False))
    lines.append(footer)
    return "".join(lines)

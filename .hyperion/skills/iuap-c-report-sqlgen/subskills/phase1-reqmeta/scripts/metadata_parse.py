"""
Port of com.yonyou.entrance.tool.metadata.ultimate.BusinessObjectMetadataParser.parse
and supporting tree walks (dict/list JSON). Optional fetch_uri enables elastic/parallel expansion.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from iuap_common.utils import _text, _first_non_empty

logger = logging.getLogger(__name__)


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
    schema: Optional[str] = None  # 【v10.3】schema 字段支持
    # 【v11.0 新增】主子表关系
    parent_table_name: Optional[str] = None  # 父表名（平行表指向主表，子表指向主表）
    relation_type: Optional[str] = None  # 关系类型: main/parallel/detail/reference
    group_id: Optional[str] = None  # 同一业务对象下的分组ID


def _parse_enum_items(attribute_node: dict) -> Optional[List[EnumItem]]:
    items_node = None
    type_node = attribute_node.get("type")
    if isinstance(type_node, dict):
        items_node = type_node.get("items")
    if items_node is None:
        items_node = attribute_node.get("items")
    if not isinstance(items_node, list):
        return None
    items: List[EnumItem] = []
    for item_node in items_node:
        if not isinstance(item_node, dict):
            continue
        code = _text(item_node, "code")
        name = _text(item_node, "name")
        if (not code or not str(code).strip()) and (not name or not str(name).strip()):
            continue
        items.append(EnumItem(code=code, name=name))
    return items or None


def _parse_type_text(attribute_node: dict) -> Optional[str]:
    type_uri = _text(attribute_node, "typeUri")
    if type_uri:
        return type_uri
    type_node = attribute_node.get("type")
    if type_node is None:
        return _text(attribute_node, "type")
    if isinstance(type_node, str):
        return type_node
    if isinstance(type_node, dict):
        n = _text(type_node, "name")
        if n:
            return n
        tid = _text(type_node, "id")
        if tid:
            return tid
    return None


def _parse_attribute_node(attribute_node: Any) -> Optional[AttributeInfo]:
    if not isinstance(attribute_node, dict):
        return None
    if isinstance(attribute_node.get("association"), dict):
        return None
    db_column_name = _first_non_empty(
        _text(attribute_node, "columnName"),
        _text(attribute_node, "fieldName"),
    )
    if not db_column_name or not str(db_column_name).strip():
        return None
    info = AttributeInfo(
        display_name=_first_non_empty(
            _text(attribute_node, "displayName"),
            _text(attribute_node, "title"),
        ),
        db_column_name=db_column_name,
        type=_parse_type_text(attribute_node),
        name=_text(attribute_node, "name"),
        enums=_parse_enum_items(attribute_node),
    )
    data_type_meta_type = _text(attribute_node, "dataTypeMetaType")
    biztype = _text(attribute_node, "biztype")
    if biztype == "quote":
        tu = _text(attribute_node, "typeUri")
        if tu:
            info.uri = tu
    if data_type_meta_type == "Class" and _text(attribute_node, "name") != "headParallel":
        info.type = "参照类型，此处为参照对象id，long类型，需使用toString()"
    tn = _text(attribute_node, "tableName")
    if tn:
        info.table_name = tn
    return info


def _score_bill_candidate(node: dict) -> int:
    table_name = _text(node, "tableName")
    if not table_name or not str(table_name).strip():
        return -1
    score = 0
    terms = node.get("terms")
    if isinstance(terms, list):
        for t in terms:
            if isinstance(t, dict) and _text(t, "code") == "isMain":
                score += 20
                break
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


class _BestCandidate:
    def __init__(self) -> None:
        self.node: Optional[dict] = None
        self.score = -1


def _find_best_bill_node(node: Any, best: Optional[_BestCandidate] = None) -> Optional[dict]:
    """
    查找最高分的 bill 节点，广度优先 BFS 提前返回优化：
    - 优先搜索顶层节点，遇到最高分节点（score >= 26）提前返回
    - 最高分意味着 has isMain + businessObjectId + codeAttribute + keyAttribute → 肯定是目标节点
    """
    if best is None:
        best = _BestCandidate()

    # BFS 广度优先，使用队列
    from collections import deque
    queue = deque([node])

    while queue:
        current = queue.popleft()

        if isinstance(current, dict):
            sc = _score_bill_candidate(current)
            if sc > best.score:
                best.score = sc
                best.node = current
                # 提前返回：达到最高分（20 + 6 + 5 + 3 = 34），这肯定就是目标节点
                if best.score >= 26:  # has isMain (20) + businessObjectId (6) = 26，足够确认是主节点
                    return best.node

            # 将子节点加入队列继续搜索
            for v in current.values():
                queue.append(v)

        elif isinstance(current, list):
            for child in current:
                queue.append(child)

    return best.node


def _find_first_text_value_by_field_name(node: Any, field_name: str) -> Optional[str]:
    if isinstance(node, dict):
        v = node.get(field_name)
        if isinstance(v, str):
            return v
        for vv in node.values():
            found = _find_first_text_value_by_field_name(vv, field_name)
            if found:
                return found
    elif isinstance(node, list):
        for child in node:
            found = _find_first_text_value_by_field_name(child, field_name)
            if found:
                return found
    return None


def _find_first_object_by_meta_type_and_uri(
    node: Any, meta_type: str, uri: str
) -> Optional[dict]:
    if isinstance(node, dict):
        if _text(node, "metaType") == meta_type and _text(node, "uri") == uri:
            return node
        for vv in node.values():
            found = _find_first_object_by_meta_type_and_uri(vv, meta_type, uri)
            if found is not None:
                return found
    elif isinstance(node, list):
        for child in node:
            found = _find_first_object_by_meta_type_and_uri(child, meta_type, uri)
            if found is not None:
                return found
    return None


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


def _process_attribute_node(
    attribute_node: Any,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    main_table_name: str,
    fetch_uri_json: Optional[Callable[[str], Optional[str]]],
) -> None:
    if not isinstance(attribute_node, dict):
        return
    data_type_meta_type = _text(attribute_node, "dataTypeMetaType")
    type_uri = _text(attribute_node, "typeUri")
    name = _text(attribute_node, "name")
    biztype = _text(attribute_node, "biztype")

    if data_type_meta_type == "elastic":
        _process_elastic_attribute(
            type_uri,
            attribute_node,
            name or "",
            main_table_name,
            table_to_attributes,
            dedupe,
            fetch_uri_json,
        )
    elif data_type_meta_type == "Class" and name == "headParallel":
        _process_parallel_attribute(
            type_uri,
            name or "",
            main_table_name,
            table_to_attributes,
            dedupe,
            fetch_uri_json,
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


def _process_attribute_nodes(
    attributes_node: Any,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    main_table_name: str,
    fetch_uri_json: Optional[Callable[[str], Optional[str]]],
) -> None:
    if isinstance(attributes_node, list):
        for attribute_node in attributes_node:
            _process_attribute_node(
                attribute_node,
                table_to_attributes,
                dedupe,
                main_table_name,
                fetch_uri_json,
            )


def _process_elastic_attribute(
    type_uri: Optional[str],
    attribute_node: dict,
    name: str,
    main_table_name: str,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    fetch_uri_json: Optional[Callable[[str], Optional[str]]],
) -> None:
    if not type_uri or not fetch_uri_json:
        return
    elastic_json = fetch_uri_json(type_uri)
    if not elastic_json:
        return
    try:
        elastic_groups = parse_json_str(elastic_json, fetch_uri_json)
        if not elastic_groups:
            return
        for elastic_group in elastic_groups:
            elastic_attributes = elastic_group.attributes
            if not elastic_attributes:
                continue
            prefixed_attributes: List[AttributeInfo] = []
            for elastic_attribute in elastic_attributes:
                new_attr = AttributeInfo(
                    display_name=elastic_attribute.display_name,
                    db_column_name=elastic_attribute.db_column_name,
                    type=elastic_attribute.type,
                    name=f"{name}.{elastic_attribute.name}" if elastic_attribute.name else name,
                    enums=elastic_attribute.enums,
                )
                prefixed_attributes.append(new_attr)
            elastic_table_name = elastic_group.table_name or (main_table_name + "_" + name)
            table_to_attributes[elastic_table_name] = prefixed_attributes

        display_name = _text(attribute_node, "displayName")
        column_name = _text(attribute_node, "columnName")
        elastic_attr_group = AttributeInfo(
            display_name=display_name,
            db_column_name=column_name,
            type="Long",
            name=name,
        )
        mlist = table_to_attributes.setdefault(main_table_name, [])
        mlist.append(elastic_attr_group)
    except Exception as e:  # noqa: BLE001
        logger.warning("解析特征数据失败: %s", e, exc_info=True)


def _process_parallel_attribute(
    type_uri: Optional[str],
    name: str,
    main_table_name: str,
    table_to_attributes: Dict[str, List[AttributeInfo]],
    dedupe: Set[str],
    fetch_uri_json: Optional[Callable[[str], Optional[str]]],
) -> None:
    if not type_uri or not fetch_uri_json:
        return
    parallel_json = fetch_uri_json(type_uri)
    if not parallel_json:
        return
    try:
        parallel_groups = parse_json_str(parallel_json, fetch_uri_json)
        for parallel_group in parallel_groups or []:
            parallel_attributes = parallel_group.attributes
            if not parallel_attributes:
                continue
            prefixed_attributes: List[AttributeInfo] = []
            for pa in parallel_attributes:
                prefixed_attributes.append(
                    AttributeInfo(
                        display_name=pa.display_name,
                        db_column_name=pa.db_column_name,
                        type=pa.type,
                        name=f"{name}.{pa.name}" if pa.name else name,
                        enums=pa.enums,
                    )
                )
            parallel_table_name = parallel_group.table_name or (main_table_name + "_" + name)
            table_to_attributes[parallel_table_name] = prefixed_attributes
    except Exception as e:  # noqa: BLE001
        logger.warning("解析平行表数据失败: %s", e, exc_info=True)


def parse_json_str(
    json_str: str, fetch_uri_json: Optional[Callable[[str], Optional[str]]] = None
) -> List[BizTableGroup]:
    # 支持已解析的 dict 直接传入（避免重复 json.loads）
    if isinstance(json_str, dict):
        root = json_str
    elif isinstance(json_str, str):
        try:
            root = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON 解析失败: {e}")
            return []
    else:
        logger.warning(f"parse_json_str 收到非字符串/字典类型: {type(json_str).__name__}")
        return []

    # 防御：如果 root 不是 dict（如 API 返回了纯字符串 "error"），抛出明确的错误
    if not isinstance(root, dict):
        logger.warning(
            f"API 返回了非 JSON 对象（type={type(root).__name__}），"
            f"value={repr(str(root)[:200])}，跳过解析"
        )
        return []

    return parse(root, fetch_uri_json)


def parse(root: Any, fetch_uri_json: Optional[Callable[[str], Optional[str]]] = None) -> List[BizTableGroup]:
    data_node = root.get("data") if isinstance(root, dict) else None
    if not isinstance(data_node, dict):
        data_node = root if isinstance(root, dict) else {}

    bill_node = _find_best_bill_node(data_node)
    if bill_node is None:
        bill_node = data_node if isinstance(data_node, dict) else {}

    ca = bill_node.get("codeAttribute") if isinstance(bill_node, dict) else None
    ka = bill_node.get("keyAttribute") if isinstance(bill_node, dict) else None
    class_uri = _first_non_empty(
        _text(ca, "classUri") if isinstance(ca, dict) else None,
        _text(ka, "classUri") if isinstance(ka, dict) else None,
        _find_first_text_value_by_field_name(bill_node, "classUri"),
        _find_first_text_value_by_field_name(data_node, "classUri"),
    )

    class_node = None
    if class_uri:
        class_node = _find_first_object_by_meta_type_and_uri(data_node, "Class", class_uri)
        if class_node is None and isinstance(root, dict):
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

    # 【v10.3】提取 schema（可能被 FastLookup 补全到 data_node["schema"]）
    schema = _first_non_empty(
        _text(data_node, "schema"),
        _text(bill_node, "schema"),
    )

    attributes_node = (
        class_node.get("attributes") if class_node else bill_node.get("attributes")
    )
    association_attributes_node = (
        class_node.get("associationAttributes")
        if class_node
        else bill_node.get("associationAttributes")
    )

    table_to_attributes: Dict[str, List[AttributeInfo]] = {}
    dedupe: Set[str] = set()

    key_attr = (
        _parse_attribute_node(bill_node.get("keyAttribute"))
        if bill_node.get("keyAttribute")
        else None
    )
    code_attr = (
        _parse_attribute_node(bill_node.get("codeAttribute"))
        if bill_node.get("codeAttribute")
        else None
    )
    if main_table_name:
        _add_to_table(table_to_attributes, dedupe, main_table_name, key_attr, True)
        _add_to_table(table_to_attributes, dedupe, main_table_name, code_attr, True)

    _process_attribute_nodes(
        attributes_node, table_to_attributes, dedupe, main_table_name or "", fetch_uri_json
    )
    _process_attribute_nodes(
        association_attributes_node,
        table_to_attributes,
        dedupe,
        main_table_name or "",
        fetch_uri_json,
    )

    # 【v11.0 新增】检测平行表
    # 平行表名通常以主表名开头，后跟 _assistant 或其他后缀
    parallel_table_names: Set[str] = set()
    for tbl in table_to_attributes.keys():
        if tbl != main_table_name and tbl.startswith(main_table_name):
            parallel_table_names.add(tbl)

    # 【v11.0 新增】构建 groups 时添加父子关系
    # 【v11.0 过滤】排除历史表（表名以 _ch 结尾）
    groups: List[BizTableGroup] = []
    for tbl, attrs in table_to_attributes.items():
        if tbl.endswith("_ch"):
            continue  # 跳过历史表
        # 【v11.0】判断关系类型
        if tbl == main_table_name:
            relation_type = "main"
            parent_table_name = None
        elif tbl in parallel_table_names:
            relation_type = "parallel"
            parent_table_name = main_table_name
        else:
            # 可能是子表或其他关联表，需要通过调用方传入
            relation_type = None
            parent_table_name = None

        # 【v10.3】传入 schema 字段
        # 【v11.0】传入父子关系字段
        g = BizTableGroup(
            bill_name=bill_name,
            domain=domain,
            table_name=tbl,
            attributes=attrs,
            schema=schema,
            parent_table_name=parent_table_name,
            relation_type=relation_type,
            group_id=f"grp_{main_table_name}" if main_table_name else None  # 同一业务对象的分组ID
        )
        groups.append(g)
    return groups

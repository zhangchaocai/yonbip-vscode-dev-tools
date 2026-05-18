#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字段预检验脚本

基于业务对象元数据（entities.json）校验字段映射表中的每个字段是否真实存在。

Usage:
    python validate_fields.py --entities output/entities.json --mapping output/字段映射表.md
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set


def load_entities(entities_path: str) -> Dict:
    """加载业务对象元数据"""
    with open(entities_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_column_index(entities: Dict) -> Dict[str, Set[str]]:
    """
    构建字段索引：tableName -> set(dbColumnName)

    Returns:
        {
            'schema.tableName': {'col1', 'col2', ...},
            ...
        }
    """
    index = {}
    for entity in entities.get('entities', []):
        schema = entity.get('schema', '')
        table = entity.get('tableName', '')
        key = f"{schema}.{table}"

        columns = set()
        for attr in entity.get('attributes', []):
            col = attr.get('dbColumnName', '')
            if col:
                columns.add(col)

        if key not in index:
            index[key] = columns
        else:
            index[key].update(columns)

    return index


def validate_field(
    table_name: str,
    db_column: str,
    entities_index: Dict[str, Set[str]],
    all_entities: Dict
) -> Optional[Dict]:
    """
    校验单个字段是否在元数据中存在

    Returns:
        None: 校验通过
        Dict: 校验失败，包含错误信息和修复建议
    """
    # 跳过聚合字段和空值
    if not table_name or not db_column or table_name == '-' or db_column == '-':
        return None  # 跳过聚合字段等
    if 'COUNT' in db_column.upper() or '聚合' in db_column:
        return None  # 跳过聚合字段

    # 找到包含该表的 key
    matching_keys = [k for k in entities_index.keys() if k.endswith(f".{table_name}")]

    if not matching_keys:
        return {
            'table': table_name,
            'column': db_column,
            'error': f"表 '{table_name}' 在元数据中不存在",
            'suggestion': None,
            'actual_columns': []
        }

    # 检查列是否存在
    key = matching_keys[0]  # 取第一个匹配的
    actual_columns = entities_index[key]

    if db_column in actual_columns:
        return None  # 通过

    # 列不存在，查找相似的
    suggestions = _find_similar_columns(db_column, actual_columns)

    return {
        'table': table_name,
        'column': db_column,
        'error': f"字段 '{db_column}' 在表 '{table_name}' 的元数据中不存在",
        'suggestion': suggestions[0] if suggestions else None,
        'actual_columns': list(actual_columns)[:15],
        'schema_table': key
    }


# 平台隐含字段：这些字段是隐式筛选条件，不需要出现在SELECT中
_IMPLICIT_WHERE_FIELDS: Set[str] = {
    'dr',          # 逻辑删除标记
    'ytenant_id',  # 租户ID
    'tenant_id',   # 租户ID（另一命名）
    'pubts',       # 发布状态
    'create_time', # 创建时间
    'creator',     # 创建人
    'modifier',    # 修改人
    'modify_time', # 修改时间
    'auditor',     # 审核人
    'audit_time',  # 审核时间
    'ts',          # 时间戳
}


def _is_implicit_field(alias: str, col: str) -> bool:
    """判断是否为平台隐含字段"""
    if col.lower() in _IMPLICIT_WHERE_FIELDS:
        return True
    return False


def _find_similar_columns(target: str, candidates: Set[str]) -> List[str]:
    """
    查找与目标字段相似的候选字段
    相似规则：
    1. 去掉前缀后匹配 (mainid -> imainid)
    2. 包含关系
    3. Levenshtein 距离 <= 2
    """
    target_lower = target.lower()
    suggestions = []

    for col in candidates:
        col_lower = col.lower()

        # 去掉常见前缀后比较
        prefixes = ['i', 'c', 'v', 'n', 'b']
        target_stripped = target_lower
        col_stripped = col_lower
        for p in prefixes:
            if target_lower.startswith(p) and len(target_lower) > len(p):
                target_stripped = target_lower[len(p):]
            if col_lower.startswith(p) and len(col_lower) > len(p):
                col_stripped = col_lower[len(p):]

        if target_stripped == col_stripped:
            suggestions.append((col, 'prefix_diff'))
        elif target_lower in col_lower or col_lower in target_lower:
            suggestions.append((col, 'substring'))
        elif _levenshtein_distance(target_lower, col_lower) <= 2:
            suggestions.append((col, 'similar'))

    # 按相似度排序
    priority = {'prefix_diff': 0, 'similar': 1, 'substring': 2}
    suggestions.sort(key=lambda x: priority.get(x[1], 3))

    return [s[0] for s in suggestions]


def _levenshtein_distance(a: str, b: str) -> int:
    """计算编辑距离"""
    if len(a) > len(b):
        a, b = b, a

    distances = range(len(a) + 1)
    for i2, c2 in enumerate(b):
        distances_ = [i2 + 1]
        for i1, c1 in enumerate(a):
            if c1 == c2:
                distances_.append(distances[i1])
            else:
                distances_.append(1 + min(distances[i1], distances[i1 + 1], distances_[-1]))
        distances = distances_

    return distances[-1]


def extract_table_aliases_from_mapping(mapping_content: str) -> Dict[str, str]:
    """
    从字段映射表的 JOIN 关系区域提取表名→别名 的映射

    Returns:
        {'hdr': 'stwb_settleapply', 'ast': 'stwb_settleapply_assistant', ...}
    """
    aliases = {}
    # 匹配 "FROM xxx" 或 "JOIN xxx" 行
    join_pattern = re.compile(r'(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)', re.IGNORECASE)
    for line in mapping_content.split('\n'):
        m = join_pattern.search(line)
        if m:
            table, alias = m.group(1), m.group(2)
            aliases[alias] = table
    return aliases


def extract_where_fields(mapping_content: str) -> List[Dict]:
    """
    从字段映射表的「筛选条件」区域提取字段引用

    支持格式:
      - hdr.dr = 0
      - ast.customer = cust.id
      - hdr.ytenant_id = 'var$(租户id)'
      - business_type 过滤: 待确认

    Returns:
        [{'field': 'hdr.dr', 'from_where_section': True}, ...]
    """
    # 找到「筛选条件」区域
    where_fields = []
    in_where_section = False

    for line in mapping_content.split('\n'):
        # 检测筛选条件区域开始
        if '筛选条件' in line or 'WHERE' in line.upper():
            in_where_section = True
            continue
        # 检测筛选条件区域结束（遇到新的 ## 标题）
        if in_where_section and line.startswith('## '):
            in_where_section = False
            break
        if in_where_section and line.strip():
            # 匹配 table.column 格式
            field_pattern = re.compile(r'([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)')
            for m in field_pattern.finditer(line):
                alias, col = m.group(1), m.group(2)
                # 排除常见 SQL 关键字和函数
                if col.upper() in ('AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL'):
                    continue
                where_fields.append({'field': f"{alias}.{col}", 'from_where_section': True})
            # 匹配独立字段名（如 business_type 过滤）
            standalone_pattern = re.compile(r'^[\s\-]*([a-zA-Z_]\w+)\s+(?:过滤|=|!=|<|>|<=|>=|IN|LIKE)', re.MULTILINE)
            for m in standalone_pattern.finditer(line):
                col = m.group(1)
                if col.upper() not in ('AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', '过滤'):
                    where_fields.append({'field': col, 'from_where_section': True})

    return where_fields


def extract_select_fields(mapping_content: str) -> List[str]:
    """
    从字段映射表的「字段映射」区域提取 SELECT 字段列表

    Returns:
        ['客户编码', '客户名称', '收款金额', ...]
    """
    select_fields = []
    in_field_section = False

    for line in mapping_content.split('\n'):
        # 找到字段映射表头
        if '报表字段' in line and '|' in line:
            in_field_section = True
            continue
        # 跳过表头分隔线
        if in_field_section and ('---' in line or '|--' in line):
            continue
        # 遇到新的 ## 标题结束
        if in_field_section and line.startswith('## '):
            break
        if in_field_section and '|' in line:
            parts = [p.strip() for p in line.split('|')]
            # 格式1（有序号）: | 序号 | 报表字段 | 数据库表.字段 | 字段类型 | 说明 |
            # 格式2（无序号）: | 报表字段 | 数据库表.字段 | 字段类型 | 说明 |
            # 判断格式：如果第二个非空元素是数字则有序号
            if len(parts) >= 3:
                # 取第一个非空部分作为报表字段
                report_field = None
                for p in parts:
                    p = p.strip()
                    if not p:
                        continue
                    if p in ('报表字段', '数据库表.字段', '字段类型', '说明', '---'):
                        continue
                    report_field = p
                    break
                if report_field and report_field not in ('---', '|--'):
                    select_fields.append(report_field)

    return select_fields


def validate_where_fields_in_select(
    mapping_path: str
) -> Dict:
    """
    校验 WHERE 条件中的字段是否出现在 SELECT 中

    规则：
      - 平台隐含字段（dr, ytenant_id 等）→ 跳过，自动通过
      - 从「筛选条件」区域提取的字段 → 视为"显式查询条件"，给出警告但不阻塞
      - 其他业务字段 → 必须出现在SELECT中

    Returns:
        {
            'valid': bool,
            'total_where_fields': int,
            'select_fields': [...],
            'missing_fields': [{'field': 'xxx', 'reason': '...'}, ...],
            'query_condition_warnings': [...],
            'warnings': [...]
        }
    """
    with open(mapping_path, 'r', encoding='utf-8') as f:
        content = f.read()

    where_fields_data = extract_where_fields(content)
    select_fields = extract_select_fields(content)

    missing = []
    query_condition_warnings = []
    warnings = []

    for item in where_fields_data:
        wf = item['field']
        from_where_section = item.get('from_where_section', False)

        # 支持两种格式：table.column 或 独立column名
        if '.' in wf:
            # table.column 格式，提取 column 部分做匹配
            alias, col = wf.split('.', 1)
        else:
            alias, col = '', wf

        # 跳过平台隐含字段（dr, ytenant_id 等）
        if _is_implicit_field(alias, col):
            continue

        # 检查是否在 SELECT 报表字段中出现（模糊匹配，允许前后有空隙）
        found = False
        for sf in select_fields:
            if col in sf or sf in col:
                found = True
                break

        if not found:
            if from_where_section:
                # 来自筛选条件区域 → 查询条件警告
                query_condition_warnings.append({
                    'field': wf,
                    'column': col,
                    'reason': f"查询条件字段 '{wf}' 不在SELECT报表字段中",
                    'suggestion': f"这是查询条件字段，可忽略；如需显示请添加到SELECT"
                })
            else:
                # 非筛选条件区域 → 必须修复的错误
                missing.append({
                    'field': wf,
                    'column': col,
                    'reason': f"WHERE条件字段 '{wf}' 未出现在SELECT报表字段中",
                    'suggestion': f"请添加到SELECT或修改WHERE条件"
                })

    # 判断是否通过：没有"必须修复"的字段（missing为空）则通过
    return {
        'valid': len(missing) == 0,
        'total_where_fields': len(where_fields_data),
        'select_fields': select_fields,
        'missing_fields': missing,
        'query_condition_warnings': query_condition_warnings,
        'warnings': warnings
    }


def validate_mapping_table(
    entities_path: str,
    mapping_path: str
) -> Dict:
    """
    校验字段映射表

    Returns:
        {
            'valid': bool,
            'total': int,
            'matched': int,
            'errors': [error_dict, ...]
        }
    """
    # 加载元数据
    entities = load_entities(entities_path)
    entities_index = build_column_index(entities)

    # 解析字段映射表
    fields = parse_mapping_table(mapping_path)

    errors = []
    matched = 0

    for field in fields:
        table = field['table_name']
        db_col = field['db_column']

        if not table or not db_col:
            continue

        result = validate_field(table, db_col, entities_index, entities)
        if result is None:
            matched += 1
        else:
            errors.append(result)

    return {
        'valid': len(errors) == 0,
        'total': len(fields),
        'matched': matched,
        'errors': errors
    }


def parse_mapping_table(mapping_path: str) -> List[Dict]:
    """
    解析字段映射表 Markdown

    表格格式:
    | 序号 | 报表字段 | tableName | dbColumnName | 字段类型 | 参照信息 |
    """
    with open(mapping_path, 'r', encoding='utf-8') as f:
        content = f.read()

    fields = []
    lines = content.split('\n')

    in_field_section = False
    for line in lines:
        # 检测字段映射区域开始（包含 tableName 和 dbColumnName 的表头）
        if 'tableName' in line and 'dbColumnName' in line:
            in_field_section = True
            continue

        # 跳过表头分隔线
        if '---' in line or '|--' in line:
            continue

        # 检测字段映射区域结束
        if in_field_section and '|' in line:
            parts = [p.strip() for p in line.split('|')]
            # 如果遇到非序号行，结束
            if len(parts) > 1 and not parts[1].isdigit():
                in_field_section = False
                continue

        if in_field_section and '|' in line:
            parts = [p.strip() for p in line.split('|')]
            # 格式: | (空) | 序号 | 报表字段 | tableName | dbColumnName | 字段类型 | 参照信息 |
            # parts[0]=空, parts[1]=序号, parts[2]=报表字段, parts[3]=tableName, parts[4]=dbColumnName
            if len(parts) >= 5 and parts[1].isdigit():
                fields.append({
                    'seq': parts[1],
                    'report_field': parts[2] if len(parts) > 2 else '',
                    'table_name': parts[3] if len(parts) > 3 else '',
                    'db_column': parts[4] if len(parts) > 4 else '',
                    'field_type': parts[5] if len(parts) > 5 else '',
                })
    return fields


def print_result(result: Dict):
    """格式化输出校验结果"""
    print(f"\n{'='*60}")
    print(f"[PASS] 字段预检验结果")
    print(f"{'='*60}")
    print(f"总计字段: {result['total']}")
    print(f"已匹配:   {result['matched']} [OK]")
    print(f"未匹配:   {len(result['errors'])} [FAIL]")

    if result['valid']:
        print(f"\n[PASS] 所有字段校验通过!")
        return 0

    print(f"\n[FAIL] 发现 {len(result['errors'])} 个未匹配的字段:\n")
    for i, err in enumerate(result['errors'], 1):
        print(f"{i}. [FAIL] 表 '{err['table']}' 的字段 '{err['column']}' 不存在")
        if err['suggestion']:
            print(f"   [SUGGEST] 建议修正为: '{err['suggestion']}'")
        if err['actual_columns']:
            print(f"   [ACTUAL] 表中实际字段: {', '.join(err['actual_columns'][:10])}")
        print()

    print(f"{'='*60}")
    print(f"请修正上述字段后重新生成 SQL")
    print(f"{'='*60}")
    return 1


def main():
    parser = argparse.ArgumentParser(
        description='字段预检验脚本 - 基于业务对象元数据校验',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    # 校验字段是否在元数据中存在
    python validate_fields.py --entities output/entities.json --mapping output/字段映射表.md

    # 校验WHERE字段是否出现在SELECT中
    python validate_fields.py --mapping output/字段映射表.md --check-where

    # 同时执行两种校验
    python validate_fields.py --entities output/entities.json --mapping output/字段映射表.md --check-where
        """
    )
    parser.add_argument('--entities', help='entities.json 路径')
    parser.add_argument('--mapping', required=True, help='字段映射表.md 路径')
    parser.add_argument('--check-where', action='store_true',
                        help='校验WHERE条件字段是否出现在SELECT中')

    args = parser.parse_args()

    if not Path(args.mapping).exists():
        print(f"❌ 错误: 字段映射表不存在: {args.mapping}", file=sys.stderr)
        return 1

    print(f"正在校验映射表: {args.mapping}")
    exit_code = 0

    # 校验1：WHERE字段是否出现在SELECT中（新增）
    if args.check_where:
        print("\n" + "=" * 60)
        print("[CHECK] WHERE字段→SELECT校验")
        print("=" * 60)
        where_result = validate_where_fields_in_select(args.mapping)
        print(f"WHERE字段总数: {where_result['total_where_fields']}")
        print(f"SELECT报表字段: {', '.join(where_result['select_fields'][:10])}"
              f"{'...' if len(where_result['select_fields']) > 10 else ''}")

        if where_result['valid']:
            print(f"\n[PASS] 所有WHERE字段均已在SELECT中!")
        else:
            print(f"\n[FAIL] 发现 {len(where_result['missing_fields'])} 个必须修复的字段:")
            for i, m in enumerate(where_result['missing_fields'], 1):
                print(f"  {i}. {m['field']}")
                print(f"     原因: {m['reason']}")
                print(f"     建议: {m['suggestion']}")
            exit_code = 1

        # 显示查询条件警告（这些只是提醒，不阻塞）
        if where_result.get('query_condition_warnings'):
            print(f"\n[WARN] 发现 {len(where_result['query_condition_warnings'])} 个查询条件字段不在SELECT中:")
            for i, w in enumerate(where_result['query_condition_warnings'], 1):
                print(f"  {i}. {w['field']} - 查询条件字段，可忽略")
        print("=" * 60)

    # 校验2：字段是否在元数据中存在（原有）
    if args.entities:
        if not Path(args.entities).exists():
            print(f"❌ 错误: entities.json 不存在: {args.entities}", file=sys.stderr)
            return 1
        print(f"\n正在加载元数据: {args.entities}")
        result = validate_mapping_table(args.entities, args.mapping)
        exit_code = max(exit_code, print_result(result))
    elif args.check_where:
        # 只有 --check-where，没有 --entities，不返回错误
        pass
    else:
        print("❌ 错误: 请指定 --entities 或 --check-where", file=sys.stderr)
        return 1

    return exit_code


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字段映射表自动生成器

从 entities.json 中提取准确字段信息，生成字段映射表。

Usage:
    python generate_field_mapping.py output/entities.json "金融合同,申购登记"
"""

import argparse
import json
import sys
from pathlib import Path


def extract_business_objects(entities_json: dict, bill_names: str) -> list:
    """提取指定的业务对象（精确匹配 billName，过滤子实体）"""
    results = []
    target_names = [name.strip() for name in bill_names.split(',')]

    # 需要过滤的子表后缀（排除扩展表、特征表等）
    exclude_patterns = [
        '_extensions',
        '_character_def',
        '_ibpmstep',
        '_ibpmcurrentauditor',
        '_define_character_def',
        '_detail',
        '_b',
        '_b_dcs',
        '_dcs',
        '_cash_flow',
        '_cashflow',
        '_flow',
        '_back',
    ]

    for entity in entities_json.get('entities', []):
        bill_name = entity.get('billName', '')
        table_name = entity.get('tableName', '')

        # 精确匹配 billName
        if bill_name not in target_names:
            continue

        # 过滤子实体（表名包含特定后缀）
        skip = False
        for pattern in exclude_patterns:
            if pattern in table_name:
                skip = True
                break

        # 进一步过滤：排除 billName 与主表相同但 entityType 不是 main 的
        if entity.get('entityType') not in ('', 'main', None):
            # 检查是否有对应的 _dcs 或 _b 等变体
            base_table = table_name.replace('_dcs', '').replace('_b', '')
            if base_table != table_name:
                skip = True

        if not skip:
            results.append(entity)

    return results


def format_field_mapping(entities: list, report_fields: list) -> str:
    """生成字段映射表 Markdown"""
    lines = []
    lines.append("# 字段映射表 - 自动生成")
    lines.append("")
    lines.append("> 由 generate_field_mapping.py 自动生成")
    lines.append("")

    # 业务对象信息
    lines.append("## 业务对象信息")
    lines.append("")
    lines.append("| 序号 | 业务对象 | schema | 表名 | URI |")
    lines.append("|:--:|---------|--------|------|-----|")

    for i, entity in enumerate(entities, 1):
        lines.append(f"| {i} | {entity.get('billName', '')} | {entity.get('schema', '')} | {entity.get('tableName', '')} | {entity.get('uri', '')} |")

    lines.append("")

    # 字段映射表
    lines.append("## 字段映射表")
    lines.append("")
    lines.append("| 序号 | 报表字段 | 表名 | schema | dbColumnName | 字段类型 | 关联说明 |")
    lines.append("|:--:|---------|------|--------|-------------|---------|---------|")

    seq = 1
    for entity in entities:
        bill_name = entity.get('billName', '')
        table_name = entity.get('tableName', '')
        schema = entity.get('schema', '')
        uri = entity.get('uri', '')

        # 判断实体类型
        entity_type = entity.get('entityType', 'main')
        if 'Character' in uri or 'character' in table_name:
            field_type = "特征表字段"
        elif entity_type == 'main':
            field_type = "主表字段"
        else:
            field_type = "子表字段"

        # 输出字段
        for attr in entity.get('attributes', []):
            display_name = attr.get('displayName', '')
            db_col = attr.get('dbColumnName', '')
            ref = attr.get('referenceStructure', {})

            # 跳过无用字段
            if any(k in db_col.lower() for k in ['pubts', 'ytenant_id', 'tenant_id', 'creator', 'modifier', 'auditor']):
                continue

            ref_info = ""
            if ref:
                ref_table = ref.get('tableName', '')
                ref_bill = ref.get('billName', '')
                ref_info = f"LEFT JOIN {ref_table} ON ..."

            lines.append(f"| {seq} | {display_name} | {table_name} | {schema} | {db_col} | {field_type} | {ref_info} |")
            seq += 1

    # 外键关联信息
    lines.append("")
    lines.append("## 外键关联信息")
    lines.append("")
    lines.append("| 子表 | 外键字段 | 参照主表 |")
    lines.append("|------|---------|---------|")

    for entity in entities:
        if entity.get('entityType') != 'main':
            table_name = entity.get('tableName', '')
            for fk in entity.get('foreignKeys', []):
                col = fk.get('columnName', '')
                ref_uri = fk.get('refUri', '')
                lines.append(f"| {table_name} | {col} | {ref_uri} |")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description="字段映射表自动生成器")
    parser.add_argument('entities_json', help="entities.json 文件路径")
    parser.add_argument('bill_names', help="业务对象名称（逗号分隔）")
    parser.add_argument('-o', '--output', help="输出文件路径")

    args = parser.parse_args()

    # 读取 entities.json
    with open(args.entities_json, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 提取业务对象
    entities = extract_business_objects(data, args.bill_names)

    if not entities:
        print(f"错误: 未找到业务对象: {args.bill_names}", file=sys.stderr)
        sys.exit(1)

    print(f"找到 {len(entities)} 个业务对象:")
    for e in entities:
        print(f"  - {e.get('billName')} ({e.get('tableName')})")

    # 生成字段映射表
    content = format_field_mapping(entities, args.bill_names.split(','))

    # 输出
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"\n已生成: {args.output}")
    else:
        print("\n" + content)


if __name__ == "__main__":
    main()

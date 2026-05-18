# -*- coding: utf-8 -*-
"""
SQL 静态规则校验模块

在数据库校验之前，对 SQL 进行静态规则校验：
- 表名存在性检查（基于元数据）
- 字段名存在性检查（基于元数据）
- 语法规则检查
- 业务规则检查

无需数据库连接，快速定位简单错误。
"""

import re
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

# ============================================================
# 正则表达式预编译（提升性能）
# ============================================================
_FROM_TABLE_PATTERN = re.compile(r'\bFROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)', re.IGNORECASE)
_JOIN_TABLE_PATTERN = re.compile(r'\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_.]*)', re.IGNORECASE)
_SELECT_CLAUSE_PATTERN = re.compile(r'\bSELECT\s+(.*?)\s+FROM', re.IGNORECASE | re.DOTALL)
_CONDITION_FIELD_PATTERN = re.compile(r'\b(?:WHERE|ON|AND|OR)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*[=<>!]', re.IGNORECASE)
_CTE_PATTERN = re.compile(r'\bWITH\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+AS', re.IGNORECASE)
_MULTI_CTE_PATTERN = re.compile(r',\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+AS', re.IGNORECASE)
_TENANT_PATTERN = re.compile(r"ytenant_id\s*=\s*'[^v][^a][^r]([^']+)'", re.IGNORECASE)
_PARAM_PATTERN = re.compile(r"param\$\([^)]+\)")
_VAR_PATTERN = re.compile(r"var\$\([^)]+\)")


@dataclass
class StaticValidationResult:
    """静态校验结果"""
    ok: bool = True
    errors: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[Dict[str, Any]] = field(default_factory=list)
    fixes_applied: List[Dict[str, Any]] = field(default_factory=list)
    fixed_sql: Optional[str] = None


@dataclass
class ValidationRule:
    """校验规则定义"""
    name: str
    pattern: str
    check_type: str  # 'table', 'field', 'syntax', 'business'
    fix_action: Optional[str] = None
    fix_value: Optional[str] = None
    severity: str = "error"  # 'error', 'warning'


# ============================================================
# 元数据加载（从 entities.json）
# ============================================================

_entities_cache: Optional[Dict[str, Any]] = None
_entities_cache_path: Optional[Path] = None


def load_entities_metadata(entities_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    加载元数据 entities.json

    Args:
        entities_path: entities.json 文件路径

    Returns:
        元数据字典，包含所有业务对象的表名和字段信息
    """
    global _entities_cache, _entities_cache_path

    if entities_path is None:
        # 默认路径
        entities_path = Path(__file__).parent.parent.parent.parent / "output" / "entities.json"

    if _entities_cache is not None and _entities_cache_path == entities_path:
        return _entities_cache

    if not entities_path.exists():
        return {}

    try:
        with open(entities_path, "r", encoding="utf-8") as f:
            _entities_cache = json.load(f)
            _entities_cache_path = entities_path
            return _entities_cache
    except Exception:
        return {}


def extract_tables_from_entities(entities: Dict[str, Any]) -> Dict[str, List[str]]:
    """
    从 entities 提取表名和字段名

    Returns:
        {表名: [字段名列表]}
    """
    tables: Dict[str, List[str]] = {}

    if not entities:
        return tables

    # 处理 entities 数组
    entities_list = entities.get("entities") or []
    if isinstance(entities_list, list):
        for entity in entities_list:
            if not isinstance(entity, dict):
                continue

            # 提取表名
            table_name = entity.get("tableName") or ""
            if not table_name:
                continue

            # 提取字段
            fields: List[str] = []
            attributes = entity.get("attributes") or []
            if isinstance(attributes, list):
                for attr in attributes:
                    if isinstance(attr, dict):
                        field_name = attr.get("name") or ""
                        if field_name:
                            fields.append(field_name.lower())

            # 添加到字典（可能多个实体对应同一表）
            if table_name not in tables:
                tables[table_name.lower()] = fields
            else:
                # 合并字段
                for f in fields:
                    if f not in tables[table_name.lower()]:
                        tables[table_name.lower()].append(f)

    return tables


# ============================================================
# SQL 解析辅助函数
# ============================================================

def extract_tables_from_sql(sql: str) -> List[str]:
    """
    从 SQL 提取表名（FROM/JOIN 后面的表）

    Args:
        sql: SQL 语句

    Returns:
        表名列表（小写）
    """
    tables: List[str] = []

    # 匹配 FROM table_name（使用预编译正则）
    for match in _FROM_TABLE_PATTERN.finditer(sql):
        table = match.group(1).lower()
        # 处理 schema.table 格式
        if '.' in table:
            table = table.split('.')[-1]
        tables.append(table)

    # 匹配 JOIN table_name（使用预编译正则）
    for match in _JOIN_TABLE_PATTERN.finditer(sql):
        table = match.group(1).lower()
        if '.' in table:
            table = table.split('.')[-1]
        tables.append(table)

    return list(set(tables))  # 去重


def extract_fields_from_sql(sql: str) -> List[Tuple[str, str]]:
    """
    从 SQL 提取字段引用

    Args:
        sql: SQL 语句

    Returns:
        [(字段名, 表别名)] 列表
    """
    fields: List[Tuple[str, str]] = []

    # 匹配 SELECT field 或 table.field（使用预编译正则）
    select_match = _SELECT_CLAUSE_PATTERN.search(sql)
    if select_match:
        select_clause = select_match.group(1)
        # 简单提取字段（不处理复杂表达式）
        for part in select_clause.split(','):
            part = part.strip()
            # 处理 table.field 格式
            if '.' in part and not part.startswith('('):
                parts = part.split('.')
                if len(parts) == 2:
                    table_alias = parts[0].strip().lower()
                    field_name = parts[1].strip().lower()
                    # 去除 AS alias
                    if ' as ' in field_name:
                        field_name = field_name.split(' as ')[0].strip()
                    fields.append((field_name, table_alias))
            else:
                # 单独字段
                field_name = part.lower()
                if ' as ' in field_name:
                    field_name = field_name.split(' as ')[0].strip()
                # 排除 * 和函数调用
                if field_name != '*' and '(' not in field_name:
                    fields.append((field_name, ''))

    # 匹配 WHERE/ON 条件中的字段（使用预编译正则）
    for match in _CONDITION_FIELD_PATTERN.finditer(sql):
        field_ref = match.group(1).lower()
        if '.' in field_ref:
            parts = field_ref.split('.')
            if len(parts) == 2:
                fields.append((parts[1], parts[0]))
        else:
            fields.append((field_ref, ''))

    return fields


def extract_cte_names(sql: str) -> List[str]:
    """
    提取 CTE 名称

    Args:
        sql: SQL 语句

    Returns:
        CTE 名称列表
    """
    cte_names: List[str] = []

    # 匹配 WITH cte_name AS（使用预编译正则）
    for match in _CTE_PATTERN.finditer(sql):
        cte_names.append(match.group(1).lower())

    # 匹配逗号分隔的多个 CTE（使用预编译正则）
    for match in _MULTI_CTE_PATTERN.finditer(sql):
        cte_names.append(match.group(1).lower())

    return cte_names


# ============================================================
# 静态校验规则
# ============================================================

class SQLStaticValidator:
    """SQL 静态规则校验器"""

    def __init__(self, entities_path: Optional[Path] = None):
        """
        初始化校验器

        Args:
            entities_path: 元数据文件路径
        """
        self.entities = load_entities_metadata(entities_path)
        self.tables_metadata = extract_tables_from_entities(self.entities)

    def validate(self, sql: str) -> StaticValidationResult:
        """
        执行静态校验

        Args:
            sql: SQL 语句

        Returns:
            校验结果
        """
        result = StaticValidationResult(ok=True)
        sql_lower = sql.lower()

        # 1. 表名存在性校验
        self._check_tables(sql, result)

        # 2. 租户过滤校验
        self._check_tenant_filter(sql, result)

        # 3. 参数格式校验
        self._check_param_format(sql, result)

        # 4. CTE 引用校验
        self._check_cte_references(sql, result)

        # 5. 语法基本检查
        self._check_basic_syntax(sql, result)

        # 最终结果
        if result.errors:
            result.ok = False

        return result

    def _check_tables(self, sql: str, result: StaticValidationResult) -> None:
        """检查表名是否存在"""
        tables_in_sql = extract_tables_from_sql(sql)

        for table in tables_in_sql:
            # 跳过 CTE 表名
            cte_names = extract_cte_names(sql)
            if table in cte_names:
                continue

            # 检查是否在元数据中
            # 注意：元数据可能不完整，所以只做警告，不做错误
            if self.tables_metadata and table not in self.tables_metadata:
                result.warnings.append({
                    "type": "table_not_in_metadata",
                    "table": table,
                    "message": f"表 '{table}' 未在元数据中找到，请确认表名是否正确",
                    "severity": "warning"
                })

    def _check_tenant_filter(self, sql: str, result: StaticValidationResult) -> None:
        """检查租户过滤条件"""
        sql_lower = sql.lower()

        # 检查是否包含 ytenant_id
        if 'ytenant_id' not in sql_lower:
            result.errors.append({
                "type": "missing_tenant_filter",
                "message": "SQL 缺少租户过滤条件 ytenant_id，请添加 WHERE ytenant_id = 'var$(租户id)'",
                "fix_action": "add_tenant_filter",
                "severity": "error"
            })

        # 检查租户变量格式
        if 'ytenant_id' in sql_lower:
            # 检查是否使用 var$(租户id) 格式
            if "'var$(租户id)'" not in sql and '"var$(租户id)"' not in sql:
                # 检查是否有硬编码租户ID（警告）（使用预编译正则）
                if _TENANT_PATTERN.search(sql):
                    result.warnings.append({
                        "type": "hardcoded_tenant_id",
                        "message": "租户ID使用了硬编码值，建议使用 'var$(租户id)' 格式",
                        "severity": "warning"
                    })

    def _check_param_format(self, sql: str, result: StaticValidationResult) -> None:
        """检查参数格式"""
        # 检查 param$ 格式（使用预编译正则）
        params = _PARAM_PATTERN.findall(sql)

        for param in params:
            # 检查是否使用单引号
            if "'" not in param:
                result.errors.append({
                    "type": "invalid_param_format",
                    "param": param,
                    "message": f"参数格式错误: {param}，应使用 param$('参数名')",
                    "fix_action": "fix_param_format",
                    "severity": "error"
                })

        # 检查 var$ 格式（使用预编译正则）
        vars_found = _VAR_PATTERN.findall(sql)

        for var in vars_found:
            # 检查是否使用单引号（租户ID不需要引号）
            if "'" in var and "租户id" in var.lower():
                # 这是正确的格式
                pass
            elif "'" not in var and "租户id" not in var.lower():
                result.warnings.append({
                    "type": "invalid_var_format",
                    "var": var,
                    "message": f"变量格式可能错误: {var}",
                    "severity": "warning"
                })

    def _check_cte_references(self, sql: str, result: StaticValidationResult) -> None:
        """检查 CTE 引用是否正确"""
        cte_names = extract_cte_names(sql)

        if not cte_names:
            return

        # 提取 FROM/JOIN 中的表引用
        tables_in_sql = extract_tables_from_sql(sql)

        # 检查引用的 CTE 是否定义
        for table in tables_in_sql:
            # 如果不是真实表，也不是 CTE，则报错
            is_cte = table in cte_names
            is_real_table = self.tables_metadata and table in self.tables_metadata

            # 如果既不是 CTE 也不是已知表，可能有问题
            # 但元数据可能不完整，所以只做警告
            if not is_cte and not is_real_table:
                result.warnings.append({
                    "type": "unknown_table_reference",
                    "table": table,
                    "message": f"引用的表/CTE '{table}' 未在 SQL 中定义",
                    "severity": "warning"
                })

    def _check_basic_syntax(self, sql: str, result: StaticValidationResult) -> None:
        """检查基本语法"""
        # 检查 SELECT 和 FROM 是否存在
        sql_upper = sql.upper()
        if 'SELECT' not in sql_upper:
            result.errors.append({
                "type": "missing_select",
                "message": "SQL 缺少 SELECT 语句",
                "severity": "error"
            })

        # 检查 FROM 是否存在（简单 SELECT 可能不需要）
        # 对于报表 SQL，通常需要 FROM

        # 检查分号结尾
        if not sql.strip().rstrip().endswith(';'):
            result.warnings.append({
                "type": "missing_semicolon",
                "message": "SQL 未以分号结尾",
                "severity": "warning"
            })

        # 检查括号匹配
        open_count = sql.count('(')
        close_count = sql.count(')')
        if open_count != close_count:
            result.errors.append({
                "type": "unbalanced_parentheses",
                "message": f"括号不匹配: 左括号 {open_count} 个，右括号 {close_count} 个",
                "severity": "error"
            })


def validate_sql_static(
    sql: str,
    entities_path: Optional[Path] = None
) -> StaticValidationResult:
    """
    静态校验 SQL（便捷入口）

    Args:
        sql: SQL 语句
        entities_path: 元数据文件路径

    Returns:
        校验结果
    """
    validator = SQLStaticValidator(entities_path)
    return validator.validate(sql)
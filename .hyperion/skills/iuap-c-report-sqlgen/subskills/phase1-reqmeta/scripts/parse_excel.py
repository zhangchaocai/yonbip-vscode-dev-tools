#!/usr/bin/env python3
"""
解析 Excel 报表模板，提取列名/表头、业务对象名称。

核心设计原则（v4.0）：
  严格从 Excel "核心业务对象" 列的原样提取，按分隔符拆分，不做任何白名单校验。
  用户写什么就提取什么。

输出 JSON 到 stdout：
{
  "excelFile": "...",
  "sheetIndex": 0,
  "sheetName": "...",
  "columns": ["列1", "列2", ...],
  "dataSource": {
    "type": "billNames",
    "billNames": [...],      // 所有提取到的业务对象名称（去重，原样）
    "rawMappings": [          // 每个报表对应的业务对象（原始格式）
      {"rowIndex": N, "reportNo": "...", "reportName": "...", "billNames": [...]}
    ]
  },
  "allCells": [["行1列1", ...], ...]
}

Usage:
  python parse_excel.py /path/to/模板.xlsx
  python parse_excel.py /path/to/模板.xlsx --sheet-index 1
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

# 尝试导入 Excel 处理库
try:
    import openpyxl

    _HAS_OPENPYXL = True
except ImportError:
    _HAS_OPENPYXL = False

try:
    import xlrd

    _HAS_XLRD = True
except ImportError:
    _HAS_XLRD = False

# 日志配置
try:
    from iuap_common.logging_config import get_logger

    logger = get_logger("parse_excel")
except ImportError:
    import logging

    logger = logging.getLogger("parse_excel")
    if not logger.handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

from iuap_common.console_utf8 import configure_stdio_utf8


# ============================================================
# 核心：分隔符与拆分逻辑
# ============================================================

# 所有分隔符（全角+半角）
_DELIMITER_PATTERN = re.compile(r"[,，、；;／/|\＋+\n\r\t&]+")

# 用于识别"核心业务对象"列的表头关键词
_CORE_BILLNAME_HEADERS: Set[str] = {
    "核心业务对象", "业务对象", "数据源",
    "单据名称", "业务对象名称", "报表对象",
    "单据", "实体", "来源单据",
}

# 无意义的业务对象 suffix 词，这些是复合业务对象名的组成部分，不应作为独立名称提取
# 注意：仅过滤纯 suffix 词，不含业务语义的词汇
_BILLNAME_SUFFIX_WORDS: Set[str] = {
    "明细", "主表",
    "明细表", "明细账",
    "detail", "sub",
}

# 列头关键词：这些列包含描述性内容，不是业务对象来源
_EXCLUDE_COL_HEADERS: Set[str] = {
    # 难度/分类
    "难度等级", "难度名称", "难度", "等级",
    # 报表信息
    "报表编号", "编号", "序号",
    "报表名称", "报表", "名称",
    "场景说明", "说明", "描述",
    # 技能要求
    "技能要求", "要求", "能力",
    # 统计/数量
    "报表数量", "数量", "统计",
    # 描述性
    "备注", "描述", "内容",
    # 通用排除词
    "序号", "分类", "类型",
}


# 用于识别"数据源字段"列的表头关键词
_DATASOURCE_FIELD_HEADERS: Set[str] = {
    "数据源字段", "数据源(业务对象)", "数据源", "来源业务对象",
    "来源单据", "来源", "业务对象来源",
}

# 用于识别"使用到的业务对象"区域的标记关键词
_BILL_OBJECTS_SECTION_HEADERS: Set[str] = {
    "使用到的业务对象", "使用到的业务对象：", "业务对象", "涉及的表单",
    "关联业务对象", "相关业务对象",
}

# URI 正则：匹配点分格式的 BIP URI，如 pc.product.Product、bd.adminOrg.AdminOrgVO
_URI_PATTERN = re.compile(r"\(([a-zA-Z_][a-zA-Z0-9_.]+)\)")

# 模块级预编译：处理括号内容的正则（避免重复编译）
_BRACKET_CONTENT_PATTERN = re.compile(r"[()（）].*")
_TRAILING_BRACKETS_PATTERN = re.compile(r"[()（）]+$")

# 【v8.3 新增】取值规则中提取业务对象的模式
# 匹配 "1.单据取以下类型：XXX、XXX、XXX" 或类似格式
_RULE_BILLTYPE_PATTERN = re.compile(
    r"(?:单据)?取(?:以下)?类型[：:]\s*([^。\n]+)"
)
# 匹配常见业务对象名称后缀
_BILLNAME_KNOWN_SUFFIXES = (
    "单", "单据", "单据明细", "主表", "明细表", "明细账",
    "登记", "申请", "审批", "核销", "结算", "报销",
    "付款", "收款", "收款认领", "认领",
    "对账", "确认", "开票", "收票",
)


def _extract_billnames_from_rules(rows: List[List[str]]) -> List[str]:
    """
    【v8.3 新增】从 Excel 中直接提取白名单中的业务对象名称。

    简单高效：从所有单元格内容中匹配已知的业务对象名称白名单。

    返回: 业务对象名称列表（去重）
    """
    billnames: List[str] = []
    seen: Set[str] = set()

    # 业务对象名称白名单
    bill_whitelist = {
        "个人借款单", "对公预付单", "市场活动预付单", "期初对公预付单",
        "通用报销单", "差旅费报销单", "借款核销",
        "销售订单", "销售退货单", "采购订单", "采购入库单",
        "销售出库单", "销售退货出库单",
    }

    for row in rows:
        for cell in row:
            cell_str = str(cell).strip()
            if not cell_str:
                continue

            # 检查白名单中的业务对象名称是否在单元格中
            for bn in bill_whitelist:
                if bn in cell_str and bn not in seen:
                    seen.add(bn)
                    billnames.append(bn)

    return billnames


def _split_billnames_raw(cell_value: str) -> Tuple[List[str], List[str]]:
    """
    从单元格原始值中按分隔符拆分出业务对象名称和 URI。

    返回: (billNames, uriList)
      - billNames: 业务对象名称列表
      - uriList: 提取到的 URI 列表（来自括号中的点分格式内容）

    核心原则：严格按分隔符拆分，原样返回，不做白名单校验。

    分隔符支持：
      - `++`：组分隔符，先按此拆分，再处理组内分隔符
      - 单个 `+`：组内分隔符
      - 顿号(、) 逗号(,) 全角逗号(，) 分号(;；) 斜杠(/) 反斜杠(\\) 竖线(|) 空格 换行 等

    特殊处理：
      - 优先提取所有 `(URI)` 中的 URI，括号前的内容（如"物料"）丢弃
      - `++` 优先拆分，防止 `++` 被 `+` 字符集吞掉
      - 去除括号内容后过滤 suffix 词
      - 过滤无意义的 suffix 词（明细、主表 及其中英文组合）
    """
    if not cell_value or not str(cell_value).strip():
        return [], []

    v = str(cell_value).strip()
    # 全角转半角
    v = v.replace("（", "(").replace("）", ")")

    # Step 1: 扫描所有 (URI)，收集到 uri_list（不在此处移除，保留在原字符串中）
    # 这样后续按分隔符拆分时，含 (URI) 的片段仍可被单独处理
    uri_list: List[str] = []
    for m in _URI_PATTERN.finditer(v):
        uri = m.group(1).strip()
        if uri and "." in uri and uri not in uri_list:
            uri_list.append(uri)

    results: List[str] = []
    seen: Set[str] = set()

    def _process_part(part: str) -> None:
        """
        内部处理每个拆分片段：
          - 含 (URI) 的片段：label 丢弃，URI 已在 uri_list 中收集，忽略此片段
          - 其他片段：去除括号内容 → 直接加入结果（【v11.2】不做 suffix 过滤，保留原始名称精准匹配）
        """
        part = part.strip()
        if not part:
            return
        # 如果片段含 URI 模式（如 物料(pc.product.Product)），label 应丢弃
        if _URI_PATTERN.search(part):
            return  # URI 已收集，label 丢弃
        # 使用预编译的正则，避免重复编译
        part = _BRACKET_CONTENT_PATTERN.sub("", part).strip()
        part = _TRAILING_BRACKETS_PATTERN.sub("", part).strip()
        if not part:
            return
        if part not in seen:
            seen.add(part)
            results.append(part)

    # Step 2: `++` 组分隔符优先拆分
    if "++" in v:
        groups = v.split("++")
        for group in groups:
            if not group.strip():
                continue
            for inner in _DELIMITER_PATTERN.split(group):
                _process_part(inner)
        return results, uri_list

    # Step 3: 无 ++ 时，按标准分隔符拆分
    for part in _DELIMITER_PATTERN.split(v):
        _process_part(part)

    return results, uri_list


def _find_core_billname_col(headers: List[str]) -> int:
    """
    找到"核心业务对象"列的索引。
    优先精确匹配，其次包含匹配（排除"报表字段"等误匹配）。
    """
    # 精确匹配的关键词（高优先级）
    EXACT_KEYWORDS = {"核心业务对象", "业务对象名称", "业务对象", "报表对象", "单据名称"}

    for j, h in enumerate(headers):
        h = h.strip()
        if not h:
            continue
        # 优先精确匹配
        if h in EXACT_KEYWORDS:
            return j
    # 其次包含匹配（避免匹配到"报表字段"等误匹配）
    for j, h in enumerate(headers):
        h = h.strip()
        if not h:
            continue
        for kw in _CORE_BILLNAME_HEADERS:
            if kw in h:
                # 排除"报表"单独在末尾的误匹配（如"报表字段"）
                if kw == "报表" and h.endswith("报表"):
                    continue
                return j
    return -1


def _find_report_name_col(headers: List[str]) -> int:
    """找到"报表名称"/"报表编号"列的索引。"""
    report_keywords = {"报表名称", "报表名称", "报表", "编号"}
    for j, h in enumerate(headers):
        h = h.strip()
        if not h:
            continue
        if h in report_keywords or "报表" in h or "编号" in h:
            return j
    return -1


def _find_datasource_field_col(headers: List[str]) -> int:
    """
    找到"数据源字段"列的索引。
    搜索所有列头，匹配 _DATASOURCE_FIELD_HEADERS 中的关键词（精确或包含）。
    """
    for j, h in enumerate(headers):
        h = h.strip()
        if not h:
            continue
        for kw in _DATASOURCE_FIELD_HEADERS:
            if kw in h or h in kw:
                return j
    return -1


def _find_bill_objects_section(rows: List[List[str]]) -> Tuple[int, List[Dict[str, Any]]]:
    """
    找到"使用到的业务对象"区域，并提取业务对象列表和关系描述。

    返回: (start_row_index, bill_objects_with_relations)
      - start_row_index: 业务对象区域的起始行索引（-1 表示未找到）
      - bill_objects_with_relations: 业务对象列表（含关系描述）
    """
    bill_objects: List[Dict[str, Any]] = []
    start_idx = -1

    # 常见的业务对象名称后缀（用于识别真正的业务对象行）
    bill_suffixes = {"主表", "明细", "详情", "子表", "主数据", "单", "单据"}

    # 【v12.x 新增】已知不是独立业务对象的描述词（这些是操作名称，不是业务对象）
    _NOT_INDEPENDENT_BILL_NAMES = {
        "收票登记", "背书办理", "银行托收", "贴现办理",
        "收票", "背书", "托收", "贴现", "转让", "收款", "付款", "退款",
    }

    for row_idx, row in enumerate(rows):
        if not row:
            continue

        # 检查是否是业务对象区域标记行
        for cell in row[:3]:  # 只检查前3列
            cell_str = str(cell).strip()
            if cell_str and any(kw in cell_str for kw in _BILL_OBJECTS_SECTION_HEADERS):
                start_idx = row_idx + 1  # 下一行开始是业务对象
                logger.info(f"找到业务对象区域标记: '{cell_str}'，起始行: {start_idx}")
                break

        # 如果已找到起始行，开始提取业务对象
        if start_idx >= 0 and row_idx >= start_idx:
            # 【v12.x 修复】扫描所有列查找业务对象（不限于第一列）
            # 排除：空行、日期、编号、说明性文字
            exclude_patterns = [
                "查询条件", "关系描述", "日期", "编号", "说明",
                "以", "通过", "关联", "销售组织", "=", "---",
                "使用到的业务对象", "从", "表", "进行", "获取", "为准"
            ]

            # 遍历该行所有有内容的列，查找业务对象名称
            for col_idx, cell_val in enumerate(row):
                bill_name = str(cell_val).strip()
                if not bill_name:
                    continue

                # 排除标题行
                if bill_name in ["关系描述"]:
                    continue

                # 排除明显的非业务对象内容
                if any(pat in bill_name for pat in exclude_patterns):
                    continue

                # 排除日期格式
                if len(bill_name) == 10 and ("/" in bill_name or "-" in bill_name):
                    continue

                # 排除纯数字编号
                if bill_name.isdigit():
                    continue

                # 排除纯字母数字组合（如 "drft_noteinformation"）
                if len(bill_name) > 3 and not any('一' <= c <= '鿿' for c in bill_name):
                    continue

                # 检查是否是常见的业务对象后缀或包含关键词
                is_business_object = (
                    any(bill_name.endswith(suf) for suf in bill_suffixes) or
                    any(suf in bill_name for suf in [
                        "订单", "合同", "发货", "出库", "发票", "应收", "应付", "物料", "客户", "供应商", "组织",
                        # 【v8.4 新增】核销相关关键词
                        "借款单", "报销单", "预付单", "核销", "借款核销", "报销核销",
                        # 【v12.x 新增】票据相关关键词
                        "工作台", "办理", "托收", "贴现", "背书", "收票", "登记", "票据",
                        "付款", "退款", "收款", "转让", "票", "单"
                    ])
                )

                if is_business_object:
                    # 【v12.x 修复】仅排除纯操作名称（如"收票登记"不是独立业务对象，只是操作动词语义）
                    # 注意：背书办理、银行托收、贴现办理、付款单 等在"使用到的业务对象"中是真实业务对象，不排除
                    excluded_operations = {"收票登记"}
                    if bill_name in excluded_operations:
                        continue

                    # 查找关系描述（通常在后面几列）
                    # 【v12.x 修复】支持"通过"和"从"两种关系描述格式
                    relation = ""
                    for rel_col_idx in range(col_idx + 1, min(col_idx + 4, len(row))):
                        rel_val = str(row[rel_col_idx]).strip() if rel_col_idx < len(row) else ""
                        if rel_val and len(rel_val) > 5 and ("通过" in rel_val or "从" in rel_val or "关联" in rel_val):
                            relation = rel_val
                            break
                    bill_objects.append({
                        "billName": bill_name,
                        "relation": relation
                    })

    return start_idx, bill_objects


# ============================================================
# Excel 读取
# ============================================================

_MAX_DATA_ROWS = 500


def _read_xlsx(path: Path, sheet_index: int) -> Tuple[List[List[str]], str]:
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = wb.worksheets
    if sheet_index < 0 or sheet_index >= len(sheets):
        raise ValueError(f"Sheet index {sheet_index} out of range (0-{len(sheets) - 1})")
    ws = sheets[sheet_index]
    sheet_name = ws.title or f"Sheet{sheet_index}"
    rows: List[List[str]] = []
    for row in ws.iter_rows(values_only=True):
        row_vals = [str(cell) if cell is not None else "" for cell in row]
        rows.append(row_vals)
        if len(rows) >= _MAX_DATA_ROWS:
            break
    wb.close()
    return rows, sheet_name


def _read_xls(path: Path, sheet_index: int) -> Tuple[List[List[str]], str]:
    def _open_xls_with_encoding_fallback(p: Path):
        try:
            return xlrd.open_workbook(str(p))
        except Exception:
            for enc in ("utf-8", "gbk", "gb2312", "latin-1"):
                try:
                    return xlrd.open_workbook(str(p), encoding_override=enc)
                except Exception:
                    continue
            raise RuntimeError(f"无法使用 xlrd 打开文件: {p}")

    wb = _open_xls_with_encoding_fallback(path)
    sheets = wb.sheets()
    if sheet_index < 0 or sheet_index >= len(sheets):
        raise ValueError(f"Sheet index {sheet_index} out of range")
    ws = sheets[sheet_index]
    sheet_name = wb.sheet_names()[sheet_index]
    rows: List[List[str]] = []
    for i in range(ws.nrows):
        if len(rows) >= _MAX_DATA_ROWS:
            break
        row_vals = [str(ws.cell_value(i, j)) for j in range(ws.ncols)]
        rows.append(row_vals)
    return rows, sheet_name


def _read_excel(path: Path, sheet_index: int) -> Tuple[List[List[str]], str]:
    ext = path.suffix.lower()
    if ext == ".xlsx":
        if not _HAS_OPENPYXL:
            raise ImportError("openpyxl 未安装，请运行: pip install openpyxl")
        return _read_xlsx(path, sheet_index)
    elif ext == ".xls":
        if not _HAS_XLRD:
            raise ImportError("xlrd 未安装，请运行: pip install xlrd")
        return _read_xls(path, sheet_index)
    else:
        raise ValueError(f"不支持的格式: {ext}，仅支持 .xlsx 和 .xls")


# ============================================================
# 主解析入口
# ============================================================

def _extract_columns(rows: List[List[str]]) -> List[str]:
    """提取列名（第一行或第二行）。"""
    if not rows:
        return []
    for row in rows[:5]:
        cols = [c.strip() for c in row]
        if any(c for c in cols):
            return cols
    return []


def parse_excel(
    path: Path,
    sheet_index: int = 0,
) -> Dict[str, Any]:
    """
    解析 Excel 报表模板文件，提取所有业务对象名称。

    核心逻辑：
    1. 读取所有数据行
    2. 找到"核心业务对象"列 → 按分隔符拆分该列所有单元格值
    3. 优先提取括号中的点分 URI（如 pc.product.Product）
    4. 原样返回用户填写的业务对象名称，不做任何白名单校验
    5. 去重、输出唯一业务对象列表 + URI 列表
    6. 按报表行聚合 → 输出每个报表对应的业务对象

    Returns:
        {
          "excelFile": "...",
          "sheetIndex": 0,
          "sheetName": "...",
          "columns": [...],
          "dataSource": {
            "type": "billNames",
            "billNames": [...],       // 所有去重的业务对象名称（原样）
            "uriList": [...],         // 提取到的 URI 列表（来自括号中的点分格式）
            "rawMappings": [...]      // 每个报表对应的业务对象（含 uris 字段）
          },
          "allCells": [...],
          "raw_first_row": [...]
        }
    """
    if not path.exists():
        raise FileNotFoundError(f"Excel 文件不存在: {path}")

    rows, sheet_name = _read_excel(path, sheet_index)

    if not rows:
        return {
            "excelFile": str(path),
            "sheetIndex": sheet_index,
            "sheetName": sheet_name,
            "columns": [],
            "docFields": [],  # 从列头提取，用于过滤字段和参照获取
            "dataSource": None,
            "allCells": [],
            "raw_first_row": [],
        }

    # 提取列头
    columns = _extract_columns(rows)
    raw_first_row = rows[0] if rows else []

    # 找到表头行
    headers: List[str] = []
    header_row_idx = 0
    for i, row in enumerate(rows):
        non_empty = sum(1 for c in row if c.strip())
        if non_empty >= 3:
            headers = [c.strip() for c in row]
            header_row_idx = i
            break

    if not headers:
        logger.warning(
            f"解析完成: {path} | sheet={sheet_name} | "
            f"未找到表头行，未提取到业务对象名称"
        )
        return {
            "excelFile": str(path),
            "sheetIndex": sheet_index,
            "sheetName": sheet_name,
            "columns": columns,
            "docFields": [c.strip() for c in columns if c.strip()],  # 从列头提取，用于过滤字段和参照获取
            "dataSource": {"type": "billNames", "billNames": [], "uriList": [], "dataSourceFields": [], "rawMappings": []},
            "allCells": rows[:_MAX_DATA_ROWS],
            "raw_first_row": raw_first_row,
        }

    # 确定哪些列需要排除（描述性列）
    exclude_cols: Set[int] = set()
    for j, h in enumerate(headers):
        h_lower = h.lower()
        for kw in _EXCLUDE_COL_HEADERS:
            if kw in h or h in kw:
                exclude_cols.add(j)
                break

    # 找关键列索引
    billname_col = _find_core_billname_col(headers)
    # 【v11.4 修复】特殊结构：表头列0可能是"业务对象"标签，数据在列1
    # 检查第一行数据行的第0列是否是"业务对象"标签
    if header_row_idx + 1 < len(rows):
        first_data_row = rows[header_row_idx + 1]
        if first_data_row and len(first_data_row) > 0 and str(first_data_row[0]).strip() == "业务对象":
            # 确认表头列0不是"业务对象"（如果是，则说明是标签行）
            if billname_col != 0 or headers[0] != "业务对象":
                # 标签在数据行而非表头，business object 在列1
                billname_col = 1
                logger.info(f"[v11.4] 检测到特殊结构：列0为'业务对象'标签，使用列1作为业务对象列")
    report_name_col = _find_report_name_col(headers)
    report_no_col = -1
    for j, h in enumerate(headers):
        h = h.strip()
        if h == "报表编号" or h == "编号":
            report_no_col = j
            break

    # 找"数据源字段"列（用于过滤参照元数据）
    datasource_field_col = _find_datasource_field_col(headers)

    # 提取所有数据行（表头行之后）
    data_rows = rows[header_row_idx + 1:]

    # 全局去重业务对象名称
    all_billnames: List[str] = []
    # 全局去重 URI 列表（来自括号中的点分格式）
    all_uris: List[str] = []
    # 【v5.1 新增】全局去重数据源字段（来自"数据源字段"列，用于过滤参照元数据）
    all_data_source_fields: List[str] = []
    # 每行（报表）的业务对象
    raw_mappings: List[Dict[str, Any]] = []

    for row_idx, row in enumerate(data_rows):
        row_billnames: Set[str] = set()
        row_uris: Set[str] = set()

        # 方法1: 优先从"核心业务对象"列提取（最高优先级）
        # 【v11.2 优化】直接使用解析结果，不做白名单过滤，保留用户原始填写名称
        if billname_col >= 0 and billname_col < len(row):
            cell = row[billname_col].strip()
            # 【v11.3 修复】特殊结构：列0是标签"业务对象"，列1才是业务对象名称
            if cell == "业务对象" and billname_col == 0 and billname_col + 1 < len(row):
                cell = row[billname_col + 1].strip()
            if cell:
                bill_part, uri_part = _split_billnames_raw(cell)
                for name in bill_part:
                    row_billnames.add(name)
                row_uris.update(uri_part)

        # 方法2: 扫描其他列（排除描述性列），识别可能的业务对象名称
        # 【v11.2 优化】直接使用解析结果，不做白名单过滤
        for j, cell in enumerate(row):
            if j in exclude_cols:
                continue
            if j == billname_col:
                continue
            cell = cell.strip()
            if not cell:
                continue
            bill_part, uri_part = _split_billnames_raw(cell)
            for name in bill_part:
                row_billnames.add(name)
            row_uris.update(uri_part)

        # 【v5.1 新增】方法3: 从"数据源字段"列提取，按分隔符拆分并去重
        row_datasource_fields: Set[str] = set()
        if datasource_field_col >= 0 and datasource_field_col < len(row):
            cell = row[datasource_field_col].strip()
            if cell:
                bill_part, _ = _split_billnames_raw(cell)
                for name in bill_part:
                    name = name.strip()
                    if name and name not in row_datasource_fields:
                        row_datasource_fields.add(name)

        # 收集报表名称
        report_name = ""
        if report_name_col >= 0 and report_name_col < len(row):
            report_name = row[report_name_col].strip()

        report_no = ""
        if report_no_col >= 0 and report_no_col < len(row):
            report_no = row[report_no_col].strip()

        if row_billnames or row_uris:
            # 合并业务对象名到全局
            for bn in row_billnames:
                if bn not in all_billnames:
                    all_billnames.append(bn)
            # 合并 URI 到全局
            for uri in row_uris:
                if uri not in all_uris:
                    all_uris.append(uri)
            # 【v5.1 新增】合并数据源字段到全局
            for dsf in row_datasource_fields:
                if dsf not in all_data_source_fields:
                    all_data_source_fields.append(dsf)
            raw_mappings.append({
                "rowIndex": header_row_idx + row_idx + 1,
                "reportNo": report_no,
                "reportName": report_name,
                "billNames": sorted(row_billnames),
                "uris": sorted(row_uris),
                "dataSourceFields": sorted(row_datasource_fields),  # 【v5.1 新增】
            })

    # 构建 dataSource
    # 【v6.0 新增】支持"使用到的业务对象"格式
    section_idx, bill_objects = _find_bill_objects_section(rows)
    if bill_objects:
        for bo in bill_objects:
            bn = bo.get("billName", "")
            if bn and bn not in all_billnames:
                all_billnames.append(bn)
        logger.info(f"从'使用到的业务对象'区域提取到 {len(bill_objects)} 个业务对象: {[bo.get('billName') for bo in bill_objects]}")

    # 【v8.3 新增】从"取值规则"段落提取业务对象
    rule_billnames = _extract_billnames_from_rules(rows)
    if rule_billnames:
        for bn in rule_billnames:
            if bn and bn not in all_billnames:
                all_billnames.append(bn)
        logger.info(f"从'取值规则'段落提取到 {len(rule_billnames)} 个业务对象: {rule_billnames}")

    data_source: Dict[str, Any] = {
        "type": "billNames",
        "billNames": all_billnames,
        "uriList": all_uris,
        "dataSourceFields": all_data_source_fields,  # 【v5.1 新增】用于过滤参照元数据
        "rawMappings": raw_mappings,
        "billObjects": bill_objects,  # 【v6.0 新增】含关系描述的业务对象列表
    }

    # 日志输出
    if all_billnames or all_uris:
        logger.info(
            f"解析完成: {path} | sheet={sheet_name} | "
            f"提取到 {len(all_billnames)} 个业务对象: {all_billnames}"
        )
        if all_uris:
            logger.info(f"  提取到 {len(all_uris)} 个 URI: {all_uris}")
        if all_data_source_fields:
            logger.info(f"  【v5.1】提取到 {len(all_data_source_fields)} 个数据源字段: {all_data_source_fields}")
        if raw_mappings:
            logger.info(f"  共 {len(raw_mappings)} 个报表，报表-业务对象映射: ")
            for mapping in raw_mappings:
                uri_info = f" | URIs={mapping['uris']}" if mapping.get("uris") else ""
                dsf_info = f" | 数据源字段={mapping['dataSourceFields']}" if mapping.get("dataSourceFields") else ""
                logger.info(
                    f"    [{mapping['reportNo']}] {mapping['reportName']} → {mapping['billNames']}{uri_info}{dsf_info}"
                )
    else:
        logger.warning(
            f"解析完成: {path} | sheet={sheet_name} | "
            f"未提取到业务对象名称，请检查 Excel 列头是否包含'核心业务对象'"
        )

    # allCells: 最多 500 行原始数据
    all_cells = rows[:_MAX_DATA_ROWS]

    return {
        "excelFile": str(path),
        "sheetIndex": sheet_index,
        "sheetName": sheet_name,
        "columns": columns,
        "docFields": [c.strip() for c in columns if c.strip()],  # 从列头提取，用于过滤字段和参照获取
        "dataSource": data_source,
        "allCells": all_cells,
        "raw_first_row": raw_first_row,
    }


# ============================================================
# CLI
# ============================================================

def main() -> int:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(
        description="解析 Excel 报表模板，提取列名和数据源信息（业务对象名称）"
    )
    parser.add_argument("excel_file", type=Path, help="Excel 报表模板路径")
    parser.add_argument(
        "--sheet-index", "-i", type=int, default=0, dest="sheet_index",
        help="工作表索引，从 0 开始（默认 0）",
    )
    parser.add_argument(
        "--output", "-o", choices={"json", "columns", "billnames"},
        default="json",
        help="输出格式：json（完整结果）、columns（仅列名）、billnames（仅业务对象列表）",
    )
    parser.add_argument(
        "--no-verbose", action="store_true",
        help="禁止详细日志",
    )
    args = parser.parse_args()

    try:
        result = parse_excel(args.excel_file, args.sheet_index)
    except FileNotFoundError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1
    except ImportError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1

    if args.output == "columns":
        for col in result["columns"]:
            if col:
                print(col)
    elif args.output == "billnames":
        ds = result.get("dataSource")
        if ds and (ds.get("billNames") or ds.get("uriList")):
            print("业务对象列表:")
            for bn in ds.get("billNames", []):
                print(f"  - {bn}")
            if ds.get("uriList"):
                print("\nURI 列表（可直接用 --query-uri）:")
                for uri in ds["uriList"]:
                    print(f"  - {uri}")
            if ds.get("dataSourceFields"):
                print("\n数据源字段（用于过滤参照元数据，v5.1）:")
                for dsf in ds["dataSourceFields"]:
                    print(f"  - {dsf}")
            total_bills = len(ds.get("billNames", []))
            total_uris = len(ds.get("uriList", []))
            parts = []
            if total_bills:
                parts.append(f"{total_bills} 个业务对象")
            if total_uris:
                parts.append(f"{total_uris} 个 URI")
            print(f"\n共 {'，'.join(parts)}")
            if ds.get("rawMappings"):
                print(f"\n报表-业务对象映射（共 {len(ds['rawMappings'])} 个报表）:")
                for m in ds["rawMappings"]:
                    uri_part = f" | URIs={m['uris']}" if m.get("uris") else ""
                    dsf_part = f" | 数据源字段={m['dataSourceFields']}" if m.get("dataSourceFields") else ""
                    print(f"  [{m['reportNo']}] {m['reportName']} → {', '.join(m['billNames'])}{uri_part}{dsf_part}")
        else:
            print("未提取到业务对象")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

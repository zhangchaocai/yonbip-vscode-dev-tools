#!/usr/bin/env python3
"""
旗舰版元数据查询 — 对齐 UltimateV2Controller.getUltimateMetadataInfo /
BusinessObjectToolUtil.getBusinessObjectInfo。

用法见上级目录 SKILL.md；配置见 ../config.yaml。

新特性:
    - 支持 ${ENV_VAR} 和 ${ENV_VAR:-default} 语法读取环境变量
    - 支持限流配置
    - 支持环境区分（通过环境变量）
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict

# 添加common目录到sys.path，导入共享模块
_skills_dir = Path(__file__).resolve().parent.parent.parent
_common_dir = _skills_dir / "common"
if str(_common_dir) not in sys.path:
    sys.path.insert(0, str(_common_dir))

import yaml

from iuap_common.console_utf8 import configure_stdio_utf8
from iuap_common.python_version_check import require_python_version
from iuap_common.utils import (
    load_dotenv, resolve_config, validate_api_config, ExitCode
)

from metadata_core import get_business_object_info


def _skill_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_config(path: Path) -> dict:
    """加载配置（支持环境变量解析）"""
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _merge_params(cfg: dict, overrides: Dict[str, Any]) -> Dict[str, Any]:
    req = dict(cfg.get("request") or {})
    for k, v in overrides.items():
        if v is not None and v != "":
            req[k] = v
    return {
        "allbillname": req.get("allbillname"),
        "modulename": req.get("modulename"),
        "isIncludeSub": req.get("isIncludeSub", "N"),
        "docFields": req.get("docFields"),
        "isDescField": req.get("isDescField", "N"),
        "isSQL": req.get("isSQL", "N"),
        "tableTemplate": req.get("tableTemplate"),
        "queryUri": req.get("queryUri"),
    }


def main() -> int:
    require_python_version()

    configure_stdio_utf8()
    ap = argparse.ArgumentParser(description="Ultimate metadata query (MDD 旗舰版元数据)")
    ap.add_argument(
        "--config",
        default=str(_skill_dir() / "config.yaml"),
        help="Path to config.yaml",
    )
    ap.add_argument("--allbillname", default=None, help="逗号分隔的单据/元数据中文名称")
    ap.add_argument("--modulename", default=None, help="模块名称或编码（预留，与 Java 一致当前不参与过滤）")
    ap.add_argument(
        "--is-include-sub",
        dest="isIncludeSub",
        default=None,
        help="Y/N 含子表时走 byboid 全量实体链；多义续查须配合 --query-uri 与 --allbillname",
    )
    ap.add_argument("--doc-fields", dest="docFields", default=None, help="逗号分隔字段显示名过滤")
    ap.add_argument("--is-desc-field", dest="isDescField", default=None, help="Y/N 是否单独描述了字段")
    ap.add_argument("--is-sql", dest="isSQL", default=None, help="Y/N 是否拉取参照 referenceStructure")
    ap.add_argument("--table-template", dest="tableTemplate", default=None, help="报表表头模板（参照属性扩展匹配）")
    ap.add_argument(
        "--query-uri",
        dest="queryUri",
        default=None,
        help="元数据 uri；索引多义时选定后重试。含子表（--is-include-sub Y）时建议与 --allbillname 同传",
    )
    ap.add_argument(
        "--validate",
        action="store_true",
        help="仅验证配置，不执行查询",
    )
    ap.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="输出详细日志",
    )
    ap.add_argument(
        "--env-file",
        default=None,
        help="Path to .env file (default: ../.env)",
    )
    args = ap.parse_args()

    # 加载指定的 .env 文件（如果提供）
    if args.env_file:
        env_path = Path(args.env_file).expanduser().resolve()
        load_dotenv(env_path)

    cfg_path = Path(args.config).expanduser().resolve()
    if not cfg_path.exists():
        print(f"错误: 配置文件不存在: {cfg_path}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    try:
        cfg = resolve_config(cfg_path)
    except Exception as e:
        print(f"错误: 配置加载失败: {e}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 先将命令行覆盖合并进 cfg['request']，再校验（避免插件传入 --allbillname 仍因 yaml 为空而失败）
    cli_overrides = {
        "allbillname": args.allbillname,
        "modulename": args.modulename,
        "isIncludeSub": args.isIncludeSub,
        "docFields": args.docFields,
        "isDescField": args.isDescField,
        "isSQL": args.isSQL,
        "tableTemplate": args.tableTemplate,
        "queryUri": args.queryUri,
    }
    req = dict(cfg.get("request") or {})
    for k, v in cli_overrides.items():
        if v is not None and str(v).strip() != "":
            req[k] = v
    cfg = {**cfg, "request": req}

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

    params = _merge_params(cfg, {})

    out = get_business_object_info(cfg, params)
    print(out)

    outp = cfg.get("output") or {}
    if outp.get("write_result_json"):
        out_dir = Path(cfg.get("paths") or {}).get("output_dir") or "output"
        od = _skill_dir() / out_dir
        od.mkdir(parents=True, exist_ok=True)
        fn = outp.get("result_json_filename") or "ultimate_metadata_last.json"
        # 仅写入 JSON 主体（去掉说明前缀需解析；此处写完整文本）
        p = od / fn
        enc = "utf-8-sig" if sys.platform == "win32" else "utf-8"
        with p.open("w", encoding=enc) as f:
            f.write(out)

    return ExitCode.SUCCESS


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        raise SystemExit(ExitCode.UNKNOWN_ERROR)

"""
配置工具 - 包装共享utils，添加metadata-info技能特定的验证
"""
from __future__ import annotations

from typing import Dict, List

# 从共享库导入所有通用功能
from iuap_common.utils import (
    ConfigValidationError,
    ExitCode,
    _first_non_empty,
    _text,
    load_dotenv,
    load_yaml,
    parse_doc_fields,
    resolve_config,
    resolve_env_vars,
    safe_filename,
    str_to_bool,
    truncate_sql,
    validate_required_fields,
    validate_api_config as validate_api_config_generic,
)

__all__ = [
    "ConfigValidationError",
    "ExitCode",
    "_first_non_empty",
    "_text",
    "load_dotenv",
    "load_yaml",
    "parse_doc_fields",
    "resolve_config",
    "resolve_env_vars",
    "safe_filename",
    "str_to_bool",
    "truncate_sql",
    "validate_required_fields",
    "validate_api_config",
]

__version__ = "1.3.0"


def validate_api_config(config: Dict[str, Any]) -> List[str]:
    """
    验证元数据API配置的必需字段

    Args:
        config: 完整配置

    Returns:
        错误消息列表
    """
    return validate_required_fields(
        config,
        {
            "api": ["base_url", "app_key", "app_secret"],
            "metadata_api": ["query_by_uri_path", "search_by_name_path"],
        },
    )

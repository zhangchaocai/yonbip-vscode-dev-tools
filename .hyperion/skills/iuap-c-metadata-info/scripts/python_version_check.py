#!/usr/bin/env python3
"""
Python 版本检测和升级引导模块
导出自公共 iuap_common.python_version_check 模块
"""
from __future__ import annotations

# 从共享库重新导出所有公共API，保持向后兼容
from iuap_common.python_version_check import (
    MIN_PYTHON_VERSION,
    check_python_version,
    get_python_version,
    get_upgrade_instructions,
    require_python_version,
)

__all__ = [
    "MIN_PYTHON_VERSION",
    "check_python_version",
    "get_python_version",
    "get_upgrade_instructions",
    "require_python_version",
]

#!/usr/bin/env python3
"""
统一日志配置模块 - 提供结构化日志输出
"""
from __future__ import annotations

import io
import logging
import os
import sys
from typing import Optional


# 日志级别环境变量
_LOG_LEVEL_ENV = "YONBIP_C_REPORT_SQL_GEN_LOG_LEVEL"


def _get_log_level() -> int:
    """从环境变量获取日志级别"""
    level_str = os.environ.get(_LOG_LEVEL_ENV, "").upper()
    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    return level_map.get(level_str, logging.INFO)


def setup_logging(
    name: str = "iuap_report",
    level: Optional[int] = None,
    format_string: Optional[str] = None,
) -> logging.Logger:
    """
    配置并返回日志记录器

    Args:
        name: 日志记录器名称
        level: 日志级别（默认从环境变量或 INFO）
        format_string: 自定义格式字符串

    Returns:
        配置好的日志记录器
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger

    if level is None:
        level = _get_log_level()
    logger.setLevel(level)

    if format_string is None:
        format_string = "%(asctime)s [%(levelname)s] %(message)s"

    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(level)

    # Windows 下 stderr 可能使用 GBK 编码，强制设为 UTF-8 避免日志乱码
    if sys.platform == "win32":
        try:
            handler.setStream(
                io.TextIOWrapper(
                    sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
                )
            )
        except (AttributeError, OSError):
            pass

    formatter = logging.Formatter(format_string, datefmt="%Y-%m-%d %H:%M:%S")
    handler.setFormatter(formatter)

    logger.addHandler(handler)

    return logger


def get_logger(name: str = "iuap_report") -> logging.Logger:
    """
    获取日志记录器（如果已配置则返回现有实例）

    Args:
        name: 日志记录器名称

    Returns:
        日志记录器实例
    """
    return logging.getLogger(name)

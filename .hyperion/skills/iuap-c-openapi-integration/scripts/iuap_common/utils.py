#!/usr/bin/env python3
"""
共享工具函数模块 - 提供跨技能复用的通用功能
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml


def str_to_bool(value: Any) -> bool:
    """将字符串或其他值转换为布尔值。

    识别: "true"/"false", "yes"/"no", "1"/"0", 大小写不敏感
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if not value:
        return False
    value = str(value).strip().lower()
    return value in ("true", "yes", "1", "on")


# ============================================================
# .env 文件加载
# ============================================================

_DOTENV_LOADED: Set[str] = set()  # 防止重复加载


def load_dotenv(env_path: Optional[Path] = None) -> None:
    """
    加载 .env 文件中的环境变量。

    支持与 shell 兼容的语法：
    - KEY=value
    - KEY="value"
    - KEY='value'
    - 注释以 # 开头
    - 空行忽略
    - 支持 ${OTHER_VAR} 引用（已在 os.environ 中的变量）

    Args:
        env_path: .env 文件路径，默认在脚本目录的父目录（即技能根目录）
    """
    global _DOTENV_LOADED

    # 确定 .env 文件路径
    if env_path is None:
        # 从 common 模块推断技能根目录
        # common/iuap_common/utils.py → common/iuap_common → common → skills → skill root parent
        from inspect import getsourcefile
        current_file = getsourcefile(lambda: None)
        if current_file:
            common_dir = Path(current_file).resolve().parent
            skill_dir = common_dir.parent.parent
            env_path = skill_dir / ".env"
        else:
            env_path = Path(".") / ".env"

    env_path = Path(env_path)
    key = str(env_path.resolve())

    # 防止重复加载
    if key in _DOTENV_LOADED:
        return

    if not env_path.exists():
        return

    _DOTENV_LOADED.add(key)

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()

        # 跳过空行和注释
        if not line or line.startswith("#"):
            continue

        # 解析 KEY=value 格式
        # 支持 = 号前后有空格
        if "=" not in line:
            continue

        key_env, _, value_env = line.partition("=")
        key_env = key_env.strip()
        value_env = value_env.strip()

        if not key_env:
            continue

        # 处理引号
        if len(value_env) >= 2:
            if (value_env[0] == '"' and value_env[-1] == '"') or (
                value_env[0] == "'" and value_env[-1] == "'"
            ):
                value_env = value_env[1:-1]

        # .env 始终优先（覆盖已存在的 shell 环境变量）
        # 支持 ${OTHER_VAR} 引用已存在的环境变量
        def replace_ref(m: re.Match) -> str:
            ref_key = m.group(1)
            return os.environ.get(ref_key, "")

        value_env = re.sub(r"\$\{([^}:]+)(?::-([^}]*))?\}", replace_ref, value_env)
        os.environ[key_env] = value_env


# ============================================================
# 通用工具函数
# ============================================================


def _text(node: Any, field: str) -> Optional[str]:
    """
    从字典节点安全获取文本值

    Args:
        node: 字典节点
        field: 字段名

    Returns:
        字段值字符串，失败返回 None
    """
    if not isinstance(node, dict):
        return None
    v = node.get(field)
    if v is None or isinstance(v, (dict, list)):
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _first_non_empty(*values: Optional[str]) -> Optional[str]:
    """
    返回第一个非空值

    Args:
        *values: 待检查的值列表

    Returns:
        第一个非空值，都为空返回 None
    """
    for v in values:
        if v is not None and str(v).strip():
            return v
    return None


def parse_doc_fields(s: Optional[str]) -> List[str]:
    """
    解析逗号分隔的字段列表

    Args:
        s: 逗号分隔的字符串

    Returns:
        字段列表
    """
    if not s or not str(s).strip():
        return []
    return [x.strip() for x in str(s).split(",") if x.strip()]


def safe_filename(name: str, replacement: str = "_") -> str:
    """
    生成安全的文件名（去除 Windows 非法字符）

    Args:
        name: 原始名称
        replacement: 替换字符

    Returns:
        安全的文件名
    """
    s = name.strip()
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, replacement)
    return s or "unnamed"


def truncate_sql(s: str, max_len: int = 12000) -> str:
    """
    截断过长的 SQL 语句（用于日志输出）

    Args:
        s: SQL 语句
        max_len: 最大长度

    Returns:
        截断后的字符串
    """
    s = s.strip()
    if len(s) <= max_len:
        return s
    return s[:max_len] + "\n... [truncated for output]"


# ============================================================
# 配置加载与验证
# ============================================================


def load_yaml(path: Path) -> Dict[str, Any]:
    """
    安全加载 YAML 配置文件

    Args:
        path: YAML 文件路径

    Returns:
        解析后的配置字典

    Raises:
        FileNotFoundError: 文件不存在
        yaml.YAMLError: YAML 解析错误
    """
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}


def resolve_env_vars(value: Any) -> Any:
    """
    递归解析配置值中的环境变量引用

    支持格式：
    - ${VAR_NAME} - 环境变量，不存在则为空字符串
    - ${VAR_NAME:-default} - 提供默认值

    Args:
        value: 配置值（str/dict/list/其他）

    Returns:
        解析后的值
    """
    if isinstance(value, str):
        pattern = r'\$\{([^}:]+)(?::-([^}]*))?\}'

        def replace_env(match: re.Match) -> str:
            var_name = match.group(1)
            default_value = match.group(2) if match.group(2) is not None else ""
            return os.environ.get(var_name, default_value)

        return re.sub(pattern, replace_env, value)
    elif isinstance(value, dict):
        return {k: resolve_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [resolve_env_vars(item) for item in value]
    return value


def resolve_config(path: Path) -> Dict[str, Any]:
    """
    加载并解析配置（支持 .env 文件和环境变量）

    加载顺序：
    1. 先加载 .env 文件（如果存在）到 os.environ
    2. 再解析 YAML 配置文件
    3. 最后替换 ${VAR} 和 ${VAR:-default} 语法

    Args:
        path: 配置文件路径

    Returns:
        解析后的配置字典
    """
    # 根据 config.yaml 的位置推断 .env 的路径
    # config.yaml 通常在技能根目录，.env 也在同一目录
    config_path = Path(path).resolve()
    skill_dir = config_path.parent
    env_path = skill_dir / ".env"
    load_dotenv(env_path)

    config = load_yaml(path)
    return resolve_env_vars(config)


class ConfigValidationError(Exception):
    """配置验证错误"""
    pass


def validate_required_fields(
    config: Dict[str, Any],
    required: Dict[str, List[str]],
    path: str = "config",
) -> List[str]:
    """
    验证必需配置字段是否存在

    Args:
        config: 配置字典
        required: 必需字段映射，格式为 {section: [fields]}
        path: 当前验证路径（用于错误消息）

    Returns:
        错误消息列表（空表示验证通过）
    """
    errors = []
    for section, fields in required.items():
        section_data = config.get(section, {})
        if not isinstance(section_data, dict):
            errors.append(f"{path}.{section}: 期望是字典，实际是 {type(section_data).__name__}")
            continue
        for field in fields:
            if not section_data.get(field):
                errors.append(f"{path}.{section}.{field}: 必需字段不能为空")
    return errors


def validate_api_config(config: Dict[str, Any]) -> List[str]:
    """
    验证 API 配置的必需字段

    Args:
        config: 完整配置

    Returns:
        错误消息列表
    """
    return validate_required_fields(
        config,
        {
            "api": ["base_url", "app_key", "app_secret"],
            "request": ["allbillname"],
        },
    )


def validate_database_config(config: Dict[str, Any]) -> List[str]:
    """
    验证数据库配置（如果启用）

    Args:
        config: 完整配置

    Returns:
        错误消息列表
    """
    errors = []
    db = config.get("database", {})
    if not str_to_bool(db.get("enabled", False)):
        return errors

    errors.extend(
        validate_required_fields(
            config,
            {"database": ["host", "user", "database"]},
        )
    )

    driver = db.get("driver", "mysql").lower()
    if driver == "oracle" and not db.get("service_name"):
        errors.append("database.service_name: Oracle 驱动需要配置 service_name")
    if driver in ("dm", "dmdb", "dameng") and not db.get("database"):
        errors.append("database.database: 达梦数据库需要配置 database")

    return errors


# ============================================================
# 进度条支持（可选依赖）
# ============================================================

class _DummyProgressBar:
    """空进度条（tqdm 不可用时的替代）"""

    def __init__(self, total: int = 0, desc: str = "", **kwargs):
        self.total = total
        self.desc = desc
        self.n = 0

    def update(self, n: int = 1) -> None:
        self.n += n
        if self.total > 0:
            pct = self.n / self.total * 100
            print(f"\r{self.desc}: {self.n}/{self.total} ({pct:.1f}%)", file=sys.stderr, end="")

    def close(self) -> None:
        if self.total > 0:
            print(file=sys.stderr)

    def __enter__(self) -> "_DummyProgressBar":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def get_progress_bar(total: int = 0, desc: str = "", **kwargs) -> Any:
    """
    获取进度条实例（优先使用 tqdm）

    Args:
        total: 总数
        desc: 描述文本
        **kwargs: 传递给 tqdm 的其他参数

    Returns:
        进度条对象
    """
    try:
        from tqdm import tqdm
        return tqdm(total=total, desc=desc, file=sys.stderr, **kwargs)
    except ImportError:
        return _DummyProgressBar(total=total, desc=desc, **kwargs)


# ============================================================
# Exit Codes
# ============================================================

class ExitCode:
    """标准化退出码"""
    SUCCESS = 0
    CONFIG_ERROR = 1
    NETWORK_ERROR = 2
    VALIDATION_ERROR = 3
    FILE_ERROR = 4
    USER_CANCEL = 5
    UNKNOWN_ERROR = 99


# ============================================================
# 版本信息
# ============================================================

__version__ = "1.3.0"

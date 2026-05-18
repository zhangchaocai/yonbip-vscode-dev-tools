"""
安全配置模块

支持从环境变量、配置文件读取敏感信息，防止硬编码密钥。
支持 ${ENV_VAR} 和 ${ENV_VAR:-default} 语法。
支持 .env 文件加载（委托给 utils.py 的 load_dotenv）。
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

from .utils import load_dotenv as _utils_load_dotenv


# 正则表达式匹配 ${VAR} 或 ${VAR:-default}
_ENV_VAR_PATTERN = re.compile(r"\$\{([^}:]+)(?::-([^}]*))?\}")


# ============================================================
# .env 文件加载（委托给 utils.py）
# ============================================================

def _load_dotenv(env_path: Optional[Path] = None) -> None:
    """
    加载 .env 文件中的环境变量。

    内部委托给 utils.py 的 load_dotenv，享受统一的加载逻辑。
    如果未指定路径，自动推断为 skill 根目录的 .env 文件。

    Args:
        env_path: .env 文件路径，默认自动推断
    """
    if env_path is None:
        # 自动推断 skill 根目录
        from inspect import getsourcefile
        current_file = getsourcefile(lambda: None)
        if current_file:
            # iuap_common/secure_config.py → iuap_common → skill root
            skill_dir = Path(current_file).resolve().parent.parent
            env_path = skill_dir / ".env"
        else:
            env_path = Path(".") / ".env"

    # 委托给 utils.py 的实现
    _utils_load_dotenv(Path(env_path) if env_path else None)


class SecureConfigError(Exception):
    """安全配置相关异常"""
    pass


def _interpolate_env_vars(value: str) -> str:
    """
    替换字符串中的环境变量引用。

    支持格式:
        ${VAR}           - 环境变量，不存在则为空字符串
        ${VAR:-default}  - 环境变量，不存在则使用 default

    Args:
        value: 包含环境变量引用的字符串

    Returns:
        替换后的字符串

    Examples:
        >>> os.environ["API_KEY"] = "secret123"
        >>> _interpolate_env_vars("${API_KEY}")
        'secret123'
        >>> _interpolate_env_vars("${MISSING:-fallback}")
        'fallback'
        >>> _interpolate_env_vars("prefix/${API_KEY}/suffix")
        'prefix/secret123/suffix'
    """
    if not isinstance(value, str):
        return value

    def replacer(match: re.Match[str]) -> str:
        var_name = match.group(1)
        default_value = match.group(2) if match.group(2) is not None else ""
        return os.environ.get(var_name, default_value)

    return _ENV_VAR_PATTERN.sub(replacer, value)


def _walk_and_interpolate(obj: Any) -> Any:
    """递归遍历并替换对象中的环境变量引用"""
    if isinstance(obj, dict):
        return {k: _walk_and_interpolate(_interpolate_env_vars(v)) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_walk_and_interpolate(item) for item in obj]
    elif isinstance(obj, str):
        return _interpolate_env_vars(obj)
    return obj


class SecureConfigLoader:
    """
    安全配置加载器，支持环境变量插值和配置验证。

    Features:
        - 环境变量插值 (${VAR}, ${VAR:-default})
        - 配置验证 (必填字段、类型检查)
        - 敏感信息脱敏 (日志输出时隐藏密钥)
        - 配置热重载 (可选)
    """

    # 敏感字段名（匹配到这些字段时在日志中脱敏）
    SENSITIVE_KEYS: set[str] = {
        "password", "secret", "token", "key", "credential",
        "app_secret", "api_secret", "access_token", "private_key",
    }

    # 默认值定义
    DEFAULTS: Dict[str, Dict[str, Any]] = {
        "api": {
            "http_timeout_seconds": 120,
            "insecure_tls": False,
            "token_refresh_skew_seconds": 120,
            "token_fallback_ttl_seconds": 3500,
        },
        "business_interface": {
            "list_success_code": "200",
            "detail_success_code": "200",
            "match_index": 0,
            "list_body_param_name": "param",
        },
        "output": {
            "write_result_json": False,
        },
        "rate_limit": {
            "enabled": False,
            "requests_per_second": 10.0,
            "burst_capacity": 20.0,
        },
    }

    def __init__(
        self,
        config_path: str | Path,
        *,
        required_fields: Optional[list[str]] = None,
        validate_on_load: bool = True,
        enable_hot_reload: bool = False,
    ):
        """
        Args:
            config_path: 配置文件路径
            required_fields: 必填顶层字段列表
            validate_on_load: 加载时是否验证配置
            enable_hot_reload: 是否支持热重载
        """
        self._config_path = Path(config_path).expanduser().resolve()
        self._required_fields = set(required_fields or [])
        self._validate_on_load = validate_on_load
        self._enable_hot_reload = enable_hot_reload
        self._config: Dict[str, Any] = {}
        self._lock = threading.RLock()
        self._mtime: float = 0
        self._load()

    def _load(self) -> None:
        """加载并处理配置文件"""
        if not self._config_path.exists():
            raise SecureConfigError(f"配置文件不存在: {self._config_path}")

        # 先加载 .env 文件
        _load_dotenv()

        mtime = self._config_path.stat().st_mtime
        config_text = self._config_path.read_text(encoding="utf-8")

        raw_config = yaml.safe_load(config_text)
        if not isinstance(raw_config, dict):
            raise SecureConfigError("配置文件根元素必须是字典")

        self._config = _walk_and_interpolate(raw_config)
        self._mtime = mtime

        if self._validate_on_load:
            self.validate()

    def reload(self) -> None:
        """重新加载配置（支持热重载）"""
        with self._lock:
            self._load()

    def get(self, *keys: str, default: Any = None) -> Any:
        """
        获取嵌套配置值。

        Args:
            *keys: 嵌套键路径，如 ("api", "base_url")
            default: 默认值

        Returns:
            配置值或默认值

        Examples:
            >>> cfg.get("api", "base_url")
            'https://api.example.com'
            >>> cfg.get("database", "port", default=3306)
            3306
        """
        with self._lock:
            if self._enable_hot_reload and self._is_file_changed():
                self._load()

            value: Any = self._config
            for key in keys:
                if isinstance(value, dict):
                    value = value.get(key)
                    if value is None:
                        return default
                else:
                    return default
            return value if value is not None else default

    def get_with_defaults(self, *keys: str) -> Any:
        """
        获取配置值，不存在时使用默认值。

        Defaults 定义在 DEFAULTS 类属性中。
        """
        with self._lock:
            value = self.get(*keys)
            if value is not None:
                return value

            # 尝试从 DEFAULTS 获取
            section = keys[0] if keys else ""
            field = keys[-1] if keys else ""
            if section in self.DEFAULTS and field in self.DEFAULTS[section]:
                return self.DEFAULTS[section][field]
            return None

    def _is_file_changed(self) -> bool:
        """检查配置文件是否已修改"""
        try:
            return self._config_path.stat().st_mtime > self._mtime
        except OSError:
            return False

    def validate(self) -> None:
        """
        验证配置完整性。

        Raises:
            SecureConfigError: 配置验证失败
        """
        errors: list[str] = []

        # 检查必填字段
        for field in self._required_fields:
            if self.get(field) is None:
                errors.append(f"缺少必填配置: {field}")

        # API 配置验证
        api = self.get("api")
        if api is not None:
            if not self.get("api", "base_url"):
                errors.append("缺少 api.base_url")

        # 业务接口配置验证
        bi = self.get("business_interface")
        if bi is not None:
            if not self.get("business_interface", "list_path"):
                errors.append("缺少 business_interface.list_path")
            if not self.get("business_interface", "detail_path"):
                errors.append("缺少 business_interface.detail_path")

        if errors:
            raise SecureConfigError("配置验证失败:\n  - " + "\n  - ".join(errors))

    def mask_sensitive(self, value: Any) -> Any:
        """
        对敏感值进行脱敏处理。

        用于日志输出，防止密钥泄露。
        """
        if isinstance(value, dict):
            return {k: self.mask_sensitive(v) if k.lower() not in self.SENSITIVE_KEYS else "***"
                    for k, v in value.items()}
        elif isinstance(value, list):
            return [self.mask_sensitive(item) for item in value]
        return value

    def to_safe_dict(self) -> Dict[str, Any]:
        """返回脱敏后的配置字典（用于日志）"""
        with self._lock:
            return self.mask_sensitive(self._config)

    @property
    def raw(self) -> Dict[str, Any]:
        """获取原始配置（未经脱敏）"""
        with self._lock:
            return self._config.copy()

    def __enter__(self) -> "SecureConfigLoader":
        return self

    def __exit__(self, *args: Any) -> None:
        pass


def load_secure_config(
    config_path: str | Path,
    *,
    required_fields: Optional[list[str]] = None,
) -> SecureConfigLoader:
    """
    便捷函数：加载安全配置。

    等价于 SecureConfigLoader(config_path, required_fields=required_fields)
    """
    return SecureConfigLoader(
        config_path,
        required_fields=required_fields,
        validate_on_load=True,
    )


# 环境变量快捷访问
def get_env(key: str, default: str = "", *, required: bool = False) -> str:
    """
    获取环境变量。

    Args:
        key: 环境变量名
        default: 默认值
        required: 是否必须存在

    Returns:
        环境变量值或默认值

    Raises:
        SecureConfigError: 当 required=True 且变量不存在时
    """
    value = os.environ.get(key, default)
    if required and not value:
        raise SecureConfigError(f"缺少必需的环境变量: {key}")
    return value

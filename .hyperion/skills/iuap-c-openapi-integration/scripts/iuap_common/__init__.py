"""
iuap_common - IUAP 技能共享工具包
===================================

本包提供跨技能复用的通用功能模块：

| 模块 | 用途 |
|------|------|
| bip_auth | Token 管理（鉴权、缓存、双检锁刷新、熔断器、限流器） |
| retry_utils | 重试装饰器、熔断器、限流器 |
| secure_config | 安全配置加载（环境变量插值、敏感信息脱敏） |
| utils | 通用工具（.env 加载、配置解析、进度条、退出码） |
| console_utf8 | Windows 控制台 UTF-8 编码修复 |
| python_version_check | Python 版本检测与升级引导 |
| skill_context | MCP 上下文解析与格式化 |
| check_env | 环境检查脚本（API 连接、数据库连接） |

使用方式（在主脚本中）::

    # business_interface_query.py
    sys.path.insert(0, str(Path(__file__).resolve().parent / "iuap_common"))

    from iuap_common.bip_auth import get_access_token
    from iuap_common.utils import resolve_config

注意：本包不提供跨模块的 __all__ 导出，请按需导入具体模块。
"""

__version__ = "1.0.0"

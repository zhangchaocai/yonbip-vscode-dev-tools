#!/usr/bin/env python3
"""
环境检查脚本 - 校验 API 连接和数据库连接

用法（推荐通过 pip_install.sh 调用）::

    # Unix/macOS
    ./pip_install.sh run iuap_common/check_env.py

    # Windows
    pip_install.cmd run iuap_common/check_env.py

    # 或激活虚拟环境后直接运行
    source .venv/bin/activate
    python iuap_common/check_env.py --config ../config.yaml

参数::

    --config      配置文件路径 (默认: ../config.yaml)
    --env-file    .env 文件路径 (可选)
    --skip-db     跳过数据库检查
    --json        JSON 格式输出
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 确保 iuap_common 内部模块可导入
# 调用路径（两种情况）：
#   1. pip_install.sh run iuap_common/check_env.py → cwd=skill-root, path=scripts/iuap_common/check_env.py
#   2. python iuap_common/check_env.py → cwd=scripts, path=scripts/iuap_common/check_env.py
_check_env_py = Path(__file__).resolve()
_script_dir = _check_env_py.parent  # scripts/iuap_common/
_common_dir = _script_dir  # scripts/iuap_common/ (本目录)

if str(_common_dir) not in sys.path:
    sys.path.insert(0, str(_common_dir))

from iuap_common.bip_auth import get_access_token, TOKEN_SUCCESS_CODE
from iuap_common.secure_config import SecureConfigLoader
from iuap_common.utils import load_dotenv


def load_config(config_path: str | Path, env_file: str | Path | None = None) -> dict:
    """加载配置文件（自动加载 .env）"""
    if env_file:
        env_path = Path(env_file).expanduser().resolve()
        if env_path.exists():
            load_dotenv(env_path)
    else:
        # 默认加载 skill 根目录的 .env
        skill_root = _script_dir.parent.parent
        env_path = skill_root / ".env"
        if env_path.exists():
            load_dotenv(env_path)

    loader = SecureConfigLoader(str(config_path), validate_on_load=False)
    return loader.raw


def check_api_connection(cfg: dict) -> tuple[bool, str]:
    """
    检查 API 连接性（Token 获取）

    Returns:
        (is_ok, message)
    """
    api = cfg.get("api") or {}
    base_url = (api.get("base_url") or "").strip().rstrip("/")
    app_key = (api.get("app_key") or "").strip()
    app_secret = (api.get("app_secret") or "").strip()

    # 1. 检查必填配置
    if not base_url:
        return False, "API 配置错误: base_url 未配置"

    if not app_key or app_key in ("your_app_key_here", ""):
        return False, "API 配置错误: app_key 未正确配置"

    if not app_secret or app_secret in ("your_app_secret_here", ""):
        return False, "API 配置错误: app_secret 未正确配置"

    # 2. 尝试获取 Token
    try:
        token = get_access_token(cfg, force_refresh=True)
        if token:
            return True, f"API 连接正常 (Token 已获取)"
        return False, "API 连接失败: Token 为空"
    except Exception as e:
        error_msg = str(e)
        if "app_key" in error_msg.lower() or "app_secret" in error_msg.lower():
            return False, f"API 认证失败: app_key 或 app_secret 错误\n   详情: {error_msg}"
        elif "connect" in error_msg.lower() or "timeout" in error_msg.lower():
            return False, f"API 连接失败: 无法连接到 {base_url}\n   详情: {error_msg}"
        elif "signature" in error_msg.lower():
            return False, f"API 签名失败: app_secret 可能不正确\n   详情: {error_msg}"
        return False, f"API 调用失败: {error_msg}"


def check_database_connection(cfg: dict) -> tuple[bool, str]:
    """
    检查数据库连接

    Returns:
        (is_ok, message)
    """
    db = cfg.get("database") or {}

    if not db.get("enabled", False):
        return True, "数据库校验未启用 (database.enabled=false)"

    driver = (db.get("driver") or "").strip()
    host = (db.get("host") or "").strip()
    port = db.get("port", "")
    user = (db.get("user") or "").strip()
    password = (db.get("password") or "").strip()
    database = (db.get("database") or "").strip()

    if not driver:
        return False, "数据库配置错误: driver 未配置"
    if not host:
        return False, "数据库配置错误: host 未配置"
    if not user:
        return False, "数据库配置错误: user 未配置"
    if not database:
        return False, "数据库配置错误: database 未配置"

    try:
        if driver in ("mysql",):
            import pymysql
            conn = pymysql.connect(
                host=host,
                port=int(port) if port else 3306,
                user=user,
                password=password,
                database=database,
                charset=db.get("charset", "utf8mb4"),
                connect_timeout=10,
            )
            conn.close()
            return True, f"数据库连接正常 ({driver}://{host}:{port}/{database})"

        elif driver in ("postgresql", "postgres", "pg"):
            import psycopg2
            conn = psycopg2.connect(
                host=host, port=int(port) if port else 5432,
                user=user, password=password, database=database,
            )
            conn.close()
            return True, f"数据库连接正常 ({driver}://{host}:{port}/{database})"

        elif driver in ("mssql", "sqlserver", "sql_server"):
            import pymssql
            conn = pymssql.connect(
                server=host,
                port=int(port) if port else 1433,
                user=user, password=password, database=database,
            )
            conn.close()
            return True, f"数据库连接正常 (mssql://{host}:{port}/{database})"

        else:
            return False, f"不支持的数据库驱动: {driver}"

    except ImportError as e:
        driver_map = {
            "mysql": "pymysql",
            "postgresql": "psycopg2-binary",
            "mssql": "pymssql",
        }
        pkg = driver_map.get(driver, driver)
        return False, f"数据库驱动 {pkg} 未安装\n   请运行: pip install {pkg}"

    except Exception as e:
        error_msg = str(e)
        if "connect" in error_msg.lower() or "connection" in error_msg.lower():
            return False, f"数据库连接失败: 无法连接到 {host}:{port}\n   详情: {error_msg}"
        elif "authentication" in error_msg.lower() or "password" in error_msg.lower():
            return False, f"数据库认证失败: 用户名或密码错误\n   详情: {error_msg}"
        return False, f"数据库错误: {error_msg}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="环境检查 - 校验 API 和数据库连接",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--config", default="../config.yaml",
        help="配置文件路径 (默认: ../config.yaml)",
    )
    parser.add_argument(
        "--env-file", default=None,
        help=".env 文件路径 (可选)",
    )
    parser.add_argument(
        "--skip-db", action="store_true",
        help="跳过数据库检查",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="JSON 格式输出",
    )

    args = parser.parse_args()

    # 解析路径（支持相对和绝对路径）
    if Path(args.config).is_absolute():
        config_path = Path(args.config)
    else:
        # 相对路径：相对于脚本所在目录
        config_path = (_script_dir / args.config).resolve()

    if not config_path.exists():
        print(f"错误: 配置文件不存在: {config_path}", file=sys.stderr)
        return 1

    try:
        cfg = load_config(config_path, args.env_file)
    except Exception as e:
        print(f"错误: 配置加载失败: {e}", file=sys.stderr)
        return 1

    # 执行检查
    results: dict = {}

    api_ok, api_msg = check_api_connection(cfg)
    results["api"] = {"ok": api_ok, "message": api_msg}

    if not args.skip_db:
        db_ok, db_msg = check_database_connection(cfg)
        results["database"] = {"ok": db_ok, "message": db_msg}
    else:
        results["database"] = {"ok": None, "message": "跳过数据库检查"}

    # 输出
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print("=" * 50)
        print("环境检查结果")
        print("=" * 50)
        status_icon = "OK" if api_ok else "FAIL"
        print(f"\nAPI 连接: [{status_icon}] {api_msg}")
        if not args.skip_db:
            db_status = results["database"]
            db_icon = "OK" if db_status.get("ok") else ("SKIP" if db_status.get("ok") is None else "FAIL")
            print(f"数据库连接: [{db_icon}] {db_status['message']}")
        print("\n" + "=" * 50)

    # 退出码
    if api_ok and (args.skip_db or results.get("database", {}).get("ok") in (True, None)):
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

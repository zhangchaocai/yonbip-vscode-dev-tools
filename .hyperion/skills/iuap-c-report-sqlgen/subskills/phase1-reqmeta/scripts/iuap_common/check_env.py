#!/usr/bin/env python3
"""
环境检查脚本 - 校验 API 连接和数据库连接

用于检查以下配置是否正确:
1. API 认证连接 (Token 获取)
2. 数据库连接 (如果启用)

用法:
    python check_env.py --config ../config.yaml
    python check_env.py --config ../config.yaml --env-file ../.env
"""

import argparse
import json
import sys
from pathlib import Path

# 将 common 目录加入路径
sys.path.insert(0, str(Path(__file__).parent.parent / "common"))

from iuap_common.secure_config import SecureConfigLoader, get_env
from iuap_common.bip_auth import get_access_token, TOKEN_SUCCESS_CODE
import iuap_common.bip_auth as bip_auth


def load_config(config_path: str, env_file: str = None) -> dict:
    """加载配置文件"""
    import os
    if env_file and os.path.exists(env_file):
        # 先加载 env 文件设置环境变量
        from iuap_common.secure_config import _load_dotenv
        _load_dotenv(env_file)

    loader = SecureConfigLoader(config_path, validate_on_load=False)
    return loader.raw


def check_api_connection(cfg: dict) -> tuple[bool, str]:
    """
    检查 API 连接性（Token 获取）

    Returns:
        (is_ok, message)
    """
    api = cfg.get("api") or {}
    base_url = api.get("base_url", "").strip().rstrip("/")
    app_key = api.get("app_key", "").strip()
    app_secret = api.get("app_secret", "").strip()

    # 1. 检查必填配置
    if not base_url:
        return False, "❌ API 配置错误: base_url 未配置"

    if not app_key or app_key in ("your_app_key_here", ""):
        return False, "❌ API 配置错误: app_key 未正确配置"

    if not app_secret or app_secret in ("your_app_secret_here", ""):
        return False, "❌ API 配置错误: app_secret 未正确配置"

    # 2. 尝试获取 Token
    try:
        # 清除缓存强制重新获取
        token = get_access_token(cfg, force_refresh=True)
        if token:
            return True, f"✅ API 连接正常 (Token 已获取)"
        else:
            return False, "❌ API 连接失败: Token 为空"
    except Exception as e:
        error_msg = str(e)
        # 提供友好的错误提示
        if "app_key" in error_msg.lower() or "app_secret" in error_msg.lower():
            return False, f"❌ API 认证失败: app_key 或 app_secret 错误\n   详情: {error_msg}"
        elif "connect" in error_msg.lower() or "timeout" in error_msg.lower():
            return False, f"❌ API 连接失败: 无法连接到 {base_url}\n   详情: {error_msg}"
        elif "signature" in error_msg.lower():
            return False, f"❌ API 签名失败: app_secret 可能不正确\n   详情: {error_msg}"
        else:
            return False, f"❌ API 调用失败: {error_msg}"


def check_database_connection(cfg: dict) -> tuple[bool, str]:
    """
    检查数据库连接

    Returns:
        (is_ok, message)
    """
    db = cfg.get("database") or {}

    # 检查是否启用
    if not db.get("enabled", False):
        return True, "ℹ️ 数据库校验未启用 (database.enabled=false)"

    # 检查必填配置
    driver = db.get("driver", "").strip()
    host = db.get("host", "").strip()
    port = db.get("port", "")
    user = db.get("user", "").strip()
    password = db.get("password", "").strip()
    database = db.get("database", "").strip()

    if not driver:
        return False, "❌ 数据库配置错误: driver 未配置"

    if not host:
        return False, "❌ 数据库配置错误: host 未配置"

    if not user:
        return False, "❌ 数据库配置错误: user 未配置"

    if not database:
        return False, "❌ 数据库配置错误: database 未配置"

    # 尝试连接数据库
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
            return True, f"✅ 数据库连接正常 ({driver}://{host}:{port}/{database})"

        elif driver in ("postgresql", "postgres", "pg"):
            import psycopg2
            conn = psycopg2.connect(
                host=host,
                port=int(port) if port else 5432,
                user=user,
                password=password,
                database=database,
            )
            conn.close()
            return True, f"✅ 数据库连接正常 ({driver}://{host}:{port}/{database})"

        elif driver in ("oracle", "cx_oracle"):
            import cx_Oracle
            dsn = cx_Oracle.makedsn(host, int(port) if port else 1521, service_name=db.get("service_name", "ORCL"))
            conn = cx_Oracle.connect(user, password, dsn)
            conn.close()
            return True, f"✅ 数据库连接正常 (oracle://{host}:{port}/{db.get('service_name', 'ORCL')})"

        elif driver in ("dm", "dmdb", "dameng"):
            # 达梦数据库
            try:
                import dmPython
                dsn = f"{host}:{port if port else 5236}/{database}"
                conn = dmPython.connect(user, password, dsn)
                conn.close()
                return True, f"✅ 数据库连接正常 (dm://{host}:{port}/{database})"
            except ImportError:
                return False, "❌ 数据库驱动 dmPython 未安装"
            except Exception as e:
                return False, f"❌ 达梦数据库连接失败: {e}"

        elif driver in ("mssql", "sqlserver", "sql_server"):
            import pymssql
            conn = pymssql.connect(
                server=host,
                port=int(port) if port else 1433,
                user=user,
                password=password,
                database=database,
            )
            conn.close()
            return True, f"✅ 数据库连接正常 (mssql://{host}:{port}/{database})"

        else:
            return False, f"❌ 不支持的数据库驱动: {driver}"

    except ImportError as e:
        driver_name = {
            "mysql": "pymysql",
            "postgresql": "psycopg2-binary",
            "oracle": "cx-Oracle",
            "dm": "dmPython",
            "mssql": "pymssql",
        }.get(driver, driver)
        return False, f"❌ 数据库驱动 {driver_name} 未安装\n   请运行: pip install {driver_name}"

    except Exception as e:
        error_msg = str(e)
        if "connect" in error_msg.lower() or "connection" in error_msg.lower():
            return False, f"❌ 数据库连接失败: 无法连接到 {host}:{port}\n   详情: {error_msg}"
        elif "authentication" in error_msg.lower() or "password" in error_msg.lower():
            return False, f"❌ 数据库认证失败: 用户名或密码错误\n   详情: {error_msg}"
        elif "database" in error_msg.lower():
            return False, f"❌ 数据库不存在: {database}\n   详情: {error_msg}"
        else:
            return False, f"❌ 数据库错误: {error_msg}"


def main():
    parser = argparse.ArgumentParser(description="环境检查 - 校验 API 和数据库连接")
    parser.add_argument(
        "--config",
        default="../config.yaml",
        help="配置文件路径 (默认: ../config.yaml)",
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help=".env 文件路径 (可选)",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="跳过数据库检查",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="JSON 格式输出",
    )

    args = parser.parse_args()

    # 加载配置
    config_path = Path(__file__).parent / args.config
    if not config_path.exists():
        config_path = Path(args.config)

    if not config_path.exists():
        print(f"❌ 配置文件不存在: {args.config}")
        sys.exit(1)

    try:
        cfg = load_config(str(config_path), env_file=args.env_file)
    except Exception as e:
        print(f"❌ 配置文件加载失败: {e}")
        sys.exit(1)

    # 检查结果
    results = {}

    # 1. API 检查
    api_ok, api_msg = check_api_connection(cfg)
    results["api"] = {"ok": api_ok, "message": api_msg}

    # 2. 数据库检查 (可选)
    if not args.skip_db:
        db_ok, db_msg = check_database_connection(cfg)
        results["database"] = {"ok": db_ok, "message": db_msg}
    else:
        results["database"] = {"ok": None, "message": "跳过数据库检查"}

    # 输出结果
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print("=" * 50)
        print("🛠️  环境检查结果")
        print("=" * 50)
        print(f"\n📡 API 连接: {api_msg}")
        if not args.skip_db:
            print(f"\n🗄️  数据库连接: {db_msg}")
        print("\n" + "=" * 50)

    # 返回状态码
    if api_ok and (args.skip_db or results.get("database", {}).get("ok", True)):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()

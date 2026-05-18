#!/usr/bin/env python3
"""
运行数据库诊断 SQL 和校验用户交付的报表 SQL 文件。
支持 MySQL / PostgreSQL / Oracle，使用 --sql-file 时依赖 sqlparse 拆分语句。
"""
from __future__ import annotations

import argparse
import datetime
import decimal
import json
import os
import queue
import re
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# 确保 scripts 目录在 sys.path 中（支持直接执行脚本）
_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

import yaml

from iuap_common.utils import (
    ExitCode,
    load_dotenv,
    load_yaml,
    resolve_config,
    str_to_bool,
    truncate_sql,
    validate_database_config,
)
from iuap_common.logging_config import get_logger, setup_logging
from iuap_common.python_version_check import require_python_version

from iuap_common.console_utf8 import configure_stdio_utf8

# 全局日志记录器
logger = get_logger("db_query")

_EXPLAIN_MAX_ROWS = 512

# ============================================================
# 正则表达式预编译（提升性能）
# ============================================================
_STATEMENT_HEAD_PATTERN = re.compile(r"(\w+)", re.I)
_ORACLE_EXPLAIN_PATTERN = re.compile(r"^\s*EXPLAIN\s+", re.I)
_ORACLE_PLAN_FOR_PATTERN = re.compile(r"^\s*EXPLAIN\s+PLAN\s+FOR\s+", re.I)
_DM_PLAN_FOR_PATTERN = re.compile(r"^\s*EXPLAIN\s+PLAN\s+FOR\s+", re.I)

# ============================================================
# SQL 静态校验与自修复模块
# ============================================================

try:
    from sql_static_validator import (
        SQLStaticValidator,
        validate_sql_static,
        load_entities_metadata,
        extract_tables_from_sql,
    )
    from sql_self_healer import (
        SQLSelfHealer,
        heal_sql,
    )
    from sql_validation_loop import (
        SQLValidationLoop,
        create_validation_loop,
        format_validation_result,
        ValidationLoopResult,
    )
    _SQL_VALIDATION_LOOP_AVAILABLE = True
except ImportError as e:
    logger.warning(f"SQL 校验循环模块未加载: {e}")
    _SQL_VALIDATION_LOOP_AVAILABLE = False
    SQLStaticValidator = None
    SQLSelfHealer = None
    ValidationLoopResult = None


def _json_default(obj: Any) -> Any:
    """json.dumps default handler for DB driver types (datetime, Decimal, bytes, etc.)."""
    if isinstance(obj, (datetime.datetime, datetime.date, datetime.time)):
        return obj.isoformat()
    if isinstance(obj, datetime.timedelta):
        return str(obj)
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _get_scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def _skill_dir() -> Path:
    # 【v10.5 修复】返回主技能目录，而非子技能目录
    return _get_scripts_dir().parent.parent.parent



def _env_flag(*names: str, default: str = "1") -> str:
    """First non-empty env among names wins; else default."""
    for n in names:
        if n in os.environ:
            v = os.environ[n].strip()
            if v:
                return v
    return default


def _auto_pip_enabled() -> bool:
    v = _env_flag(
        "YONBIP_C_REPORT_SQL_GEN_AUTO_PIP",
        "REPORT_SQL_GEN_AUTO_PIP",
    ).lower()
    return v not in ("0", "false", "no", "off")


def _auto_venv_enabled() -> bool:
    v = _env_flag(
        "YONBIP_C_REPORT_SQL_GEN_AUTO_VENV",
        "REPORT_SQL_GEN_AUTO_VENV",
    ).lower()
    return v not in ("0", "false", "no", "off")


def _requirements_path() -> Path:
    return _scripts_dir() / "requirements.txt"


def _pip_packages_for_driver(driver: str) -> List[str]:
    """Minimal wheels for db_query only."""
    d = (driver or "mysql").lower()
    base = ["PyYAML>=6.0", "sqlparse>=0.4.4"]
    if d == "mysql":
        return base + ["pymysql>=1.1.0"]
    if d in ("postgresql", "postgres", "pg"):
        return base + ["psycopg2-binary>=2.9.9"]
    if d in ("oracle", "cx_oracle"):
        return base + ["cx-Oracle>=8.3.0"]
    if d in ("dm", "dmdb", "dameng"):
        return base + ["dmPython>=1.2.0"]
    if d in ("mssql", "sqlserver", "sql_server"):
        return base + ["pymssql>=2.2.0"]
    # 未知驱动，只装基础包
    return base


def _pip_install_for_driver(py: Path, driver: str, extra_args: List[str] = None) -> bool:
    """
    pip install minimal packages for this driver using the given interpreter.

    Args:
        py: Python interpreter path
        driver: DB driver name
        extra_args: Additional pip arguments (e.g. ['--break-system-packages'])
    """
    pkgs = _pip_packages_for_driver(driver)
    logger.info(f"Installing DB-check dependencies: {' '.join(pkgs)}")
    args = [str(py), "-m", "pip", "install", *pkgs]
    if extra_args:
        args.extend(extra_args)
    r = subprocess.run(args, check=False)
    return r.returncode == 0


def _venv_python_path() -> Path:
    vdir = _scripts_dir() / ".venv"
    if sys.platform == "win32":
        return vdir / "Scripts" / "python.exe"
    return vdir / "bin" / "python"


def _skill_venv_root() -> Path:
    return (_scripts_dir() / ".venv").resolve()


def _using_skill_venv() -> bool:
    """
    True when this process was started with the skill's .venv (sys.prefix matches).
    Do not compare sys.executable to .venv/bin/python: on Homebrew, venv shims often
    resolve to the same binary as `python3`, but site-packages differ until re-exec.
    """
    vdir = _skill_venv_root()
    if not vdir.is_dir():
        return False
    try:
        return Path(sys.prefix).resolve() == vdir
    except OSError:
        return False


def _try_import(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


def _ensure_db_driver(driver: str, cfg: Optional[dict] = None) -> None:
    """
    Ensure DB driver module is importable: try same-interpreter pip, then optional
    scripts/.venv bootstrap + subprocess re-run (PEP 668 / Homebrew Python).
    """
    driver = (driver or "mysql").lower()
    cfg = cfg or {}

    mod: Optional[str]
    if driver == "mysql":
        mod = "pymysql"
    elif driver in ("postgresql", "postgres", "pg"):
        mod = "psycopg2"
    elif driver in ("oracle", "cx_oracle"):
        mod = "cx_Oracle"
    elif driver in ("dm", "dmdb", "dameng"):
        mod = "dmPython"
    elif driver in ("mssql", "sqlserver", "sql_server"):
        mod = "pymssql"
    else:
        raise ValueError(f"Unsupported driver: {driver}. "
                         f"Supported: mysql, postgresql, oracle, dm/dameng, mssql/sqlserver")

    if _try_import(mod):
        return

    if not _auto_pip_enabled():
        raise ImportError(
            f"Missing Python module {mod}. Set YONBIP_C_REPORT_SQL_GEN_AUTO_PIP=1 "
            f"or run: pip install {' '.join(_pip_packages_for_driver(driver))}"
        )

    if _pip_install_for_driver(Path(sys.executable), driver) and _try_import(mod):
        return

    if not _auto_venv_enabled():
        raise ImportError(
            f"Missing Python module {mod} and direct pip install failed. "
            f"Create scripts/.venv and pip install minimal deps, or set "
            f"YONBIP_C_REPORT_SQL_GEN_AUTO_VENV=1."
        )

    vpy = _venv_python_path()
    vdir = _scripts_dir() / ".venv"
    if not vpy.is_file():
        logger.info("Creating scripts/.venv (PEP 668 workaround)...")
        subprocess.run([sys.executable, "-m", "venv", str(vdir)], check=False)
    if not vpy.is_file():
        raise ImportError(
            f"Could not create venv at {vdir}. Install python3-venv, then retry."
        )

    if not _using_skill_venv():
        if not _pip_install_for_driver(vpy, driver):
            raise ImportError(f"pip install into {vpy} failed.")
        script = str(Path(__file__).resolve())
        logger.info(f"Re-running with venv Python: {vpy}")
        result = subprocess.run([str(vpy), script, *sys.argv[1:]])
        raise SystemExit(result.returncode)

    if not _pip_install_for_driver(vpy, driver) or not _try_import(mod):
        raise ImportError(f"Still missing Python module {mod} after installing into {vpy}.")


# 全局依赖就绪标志（确保整个进程内只做一次初始化）
_deps_initialized: bool = False
_deps_init_lock = threading.Lock()


def _ensure_deps_once(
    driver: str,
    need_sqlparse: bool = False,
    cfg: Optional[dict] = None,
) -> None:
    """
    【优化】统一依赖初始化 — 进程内只执行一次，消除重复 pip install 和子进程重跑。

    策略（按顺序尝试，越靠前越快）：
      1. 模块已导入 → 直接返回
      2. pip install（当前解释器）→ 成功则返回
      3. pip install --break-system-packages（绕过 PEP 668）→ 成功则返回
      4. 创建 scripts/.venv → pip install 到 venv → 直接在本进程 exec（不重跑 main()）

    不再使用 subprocess.run 重新执行整个脚本，避免：
      - fork + Python 解释器启动开销
      - 重新执行 main() 全流程
      - 重复连接数据库、重复 EXPLAIN
    """
    global _deps_initialized
    if _deps_initialized:
        return

    with _deps_init_lock:
        # 双重检查
        if _deps_initialized:
            return

        driver = (driver or "mysql").lower()
        cfg = cfg or {}

        # ---- 确定需要的模块 ----
        modules_needed: List[str] = []
        if driver == "mysql":
            modules_needed.append("pymysql")
        elif driver in ("postgresql", "postgres", "pg"):
            modules_needed.append("psycopg2")
        elif driver in ("oracle", "cx_oracle"):
            modules_needed.append("cx_Oracle")
        elif driver in ("dm", "dmdb", "dameng"):
            modules_needed.append("dmPython")
        elif driver in ("mssql", "sqlserver", "sql_server"):
            modules_needed.append("pymssql")
        else:
            raise ValueError(f"Unsupported driver: {driver}")

        if need_sqlparse:
            modules_needed.append("sqlparse")

        # ---- 阶段 1：检查是否已满足 ----
        missing = [m for m in modules_needed if not _try_import(m)]
        if not missing:
            _deps_initialized = True
            return

        if not _auto_pip_enabled():
            raise ImportError(
                f"Missing Python modules: {missing}. "
                "Set YONBIP_C_REPORT_SQL_GEN_AUTO_PIP=1 or run: "
                f"pip install {' '.join(missing)}"
            )

        # ---- 阶段 2：直接 pip install 到当前解释器 ----
        if all(_pip_install_for_driver(Path(sys.executable), driver) for _ in [1]):
            installed = [m for m in modules_needed if _try_import(m)]
            if not missing:
                _deps_initialized = True
                return
        logger.debug("Direct pip install failed, trying --break-system-packages")

        # ---- 阶段 3：pip install --break-system-packages ----
        # 绕过 PEP 668 限制（开发/CI 环境安全，skill 不应污染系统但可接受此选项）
        if all(
            _pip_install_for_driver(Path(sys.executable), driver, ["--break-system-packages"])
            for _ in [1]
        ):
            installed = [m for m in modules_needed if _try_import(m)]
            if not missing:
                _deps_initialized = True
                return
        logger.debug("--break-system-packages also failed, trying venv")

        # ---- 阶段 4：venv + 同进程 exec（不重跑 main）----
        if not _auto_venv_enabled():
            raise ImportError(
                f"Missing Python modules: {missing}, pip install failed, "
                "and venv fallback disabled. "
                "Set YONBIP_C_REPORT_SQL_GEN_AUTO_VENV=1 or run: "
                f"pip install {' '.join(missing)}"
            )

        vpy = _venv_python_path()
        vdir = _scripts_dir() / ".venv"
        if not vpy.is_file():
            logger.info("Creating scripts/.venv for skill dependencies...")
            r = subprocess.run([sys.executable, "-m", "venv", str(vdir)], check=False)
            if r.returncode != 0:
                raise ImportError(
                    f"Could not create venv at {vdir}. "
                    "Install python3-venv package, then retry."
                )

        if not vpy.is_file():
            raise ImportError(f"venv python not found at {vpy}")

        # 安装到 venv
        all_pkgs = _pip_packages_for_driver(driver)
        if need_sqlparse:
            all_pkgs = ["sqlparse>=0.4.4"] + all_pkgs

        logger.info(f"Installing deps into venv: {' '.join(all_pkgs)}")
        install_ok = subprocess.run(
            [str(vpy), "-m", "pip", "install", *all_pkgs],
            check=False,
        ).returncode == 0

        if not install_ok:
            raise ImportError(f"pip install into {vpy} failed.")

        # ---- 阶段 5：在 venv 环境中重新加载模块路径 ----
        # 通过修改 sys.path 让当前进程找到 venv site-packages，避免重新执行 main()
        venv_site = _get_venv_site_packages(vpy)
        if venv_site and os.path.isdir(venv_site):
            if venv_site not in sys.path:
                sys.path.insert(0, venv_site)
            logger.info(f"Injected venv site-packages: {venv_site}")

        # 验证
        still_missing = [m for m in modules_needed if not _try_import(m)]
        if still_missing:
            # 最后手段：仍重跑（但此时 venv 已完整安装，常见于 Homebrew Python 路径隔离问题）
            logger.warning(
                f"Modules {still_missing} still unavailable after venv install. "
                "Falling back to subprocess re-run (expected on some Python distributions)."
            )
            if not _using_skill_venv():
                script = str(Path(__file__).resolve())
                logger.info(f"Re-running with venv Python: {vpy}")
                result = subprocess.run([str(vpy), script, *sys.argv[1:]])
                raise SystemExit(result.returncode)

        _deps_initialized = True


def _get_venv_site_packages(venv_python: Path) -> Optional[str]:
    """获取 venv 的 site-packages 路径（跨平台兼容）"""
    if sys.platform == "win32":
        return str(venv_python.parent.parent / "Lib" / "site-packages")
    else:
        # macOS/Linux: find sysconfig path
        import sysconfig
        venv_root = venv_python.parent.parent  # bin/.. = venv root
        # 构建虚拟环境专用路径
        try:
            result = subprocess.run(
                [str(venv_python), "-c",
                 "import sysconfig; print(sysconfig.get_paths()['purelib'])"],
                capture_output=True, text=True, check=True
            )
            return result.stdout.strip()
        except Exception:
            return str(venv_root / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages")


# 保留旧接口兼容（内部调用改为新函数）
def _ensure_sqlparse() -> None:
    """向后兼容：确保 sqlparse 可用（委托给统一初始化）"""
    _ensure_deps_once("mysql", need_sqlparse=True)


def _ensure_db_driver(driver: str, cfg: Optional[dict] = None) -> None:
    """向后兼容：确保 DB 驱动可用（委托给统一初始化）"""
    _ensure_deps_once(driver, need_sqlparse=False, cfg=cfg)


# ============================================================
# SQL 语句分类与处理
# ============================================================


def _strip_leading_comments_snippet(s: str) -> str:
    """Remove leading -- and /* */ comment blocks from a statement fragment."""
    t = s
    while True:
        t = t.lstrip()
        if not t:
            return ""
        if t.startswith("--"):
            nl = t.find("\n")
            if nl == -1:
                return ""
            t = t[nl + 1 :]
            continue
        if t.startswith("/*"):
            end = t.find("*/")
            if end == -1:
                return ""
            t = t[end + 2 :]
            continue
        break
    return t


def _classify_statement(stmt: str) -> str:
    """分类 SQL 语句类型"""
    head = _strip_leading_comments_snippet(stmt).strip()
    if not head:
        return "empty"
    if head.upper().startswith("EXPLAIN PLAN FOR"):
        return "explain"
    m = _STATEMENT_HEAD_PATTERN.match(head)  # 使用预编译正则
    if not m:
        return "other"
    kw = m.group(1).upper()
    mapping: Dict[str, str] = {
        "SELECT": "select",
        "WITH": "select",
        "EXPLAIN": "explain",
        "INSERT": "dml",
        "UPDATE": "dml",
        "DELETE": "dml",
        "REPLACE": "dml",
        "MERGE": "dml",
        "CREATE": "ddl",
        "ALTER": "ddl",
        "DROP": "ddl",
        "TRUNCATE": "ddl",
        "RENAME": "ddl",
        "SHOW": "show",
        "DESCRIBE": "show",
        "DESC": "show",
        "USE": "session",
        "SET": "session",
        "CALL": "proc",
        "EXECUTE": "proc",
        "EXEC": "proc",
    }
    return mapping.get(kw, "other")


def _split_statements_sql(sql_text: str) -> List[str]:
    """Split script into statements (respects quotes/comments via sqlparse)."""
    import sqlparse

    parts = sqlparse.split(sql_text)
    return [p.strip() for p in parts if p.strip()]


def _already_explain(driver: str, stmt: str) -> bool:
    h = _strip_leading_comments_snippet(stmt).strip().upper()
    if h.startswith("EXPLAIN PLAN FOR"):
        return True
    if driver == "mysql" and h.startswith("EXPLAIN FORMAT=JSON"):
        return True
    if driver in ("mssql", "sqlserver", "sql_server") and "SET SHOWPLAN_XML" in h:
        return True
    return h.startswith("EXPLAIN ")


def _wrap_explain_sql(cfg: dict, driver: str, stmt: str) -> str:
    """Build EXPLAIN statement; MySQL uses FORMAT=JSON for optimizer tree when enabled."""
    st = stmt.strip()
    if _already_explain(driver, st):
        return st
    db = cfg.get("database") or {}
    if driver == "mysql":
        if db.get("report_sql_mysql_explain_json", True):
            return "EXPLAIN FORMAT=JSON " + st
        return "EXPLAIN " + st
    if driver in ("postgresql", "postgres", "pg"):
        return "EXPLAIN (FORMAT JSON) " + st
    if driver in ("oracle", "cx_oracle"):
        return "EXPLAIN PLAN FOR " + st
    if driver in ("dm", "dmdb", "dameng"):
        # 达梦直接使用 EXPLAIN SELECT，不需要 PLAN FOR
        return "EXPLAIN " + st
    if driver in ("mssql", "sqlserver", "sql_server"):
        return "SET SHOWPLAN_XML ON; " + st
    return st


# ============================================================
# 数据库连接与查询（连接池复用）
# ============================================================

# 简单连接池：按驱动类型维护连接队列
# 【v7.0 优化】maxsize 从 10 调至 20，支持复杂报表校验场景
# 复杂报表可能需要：EXPLAIN + 试跑 + 特征表校验 + 多语句并发
# 【v7.0 优化】默认值，将被 config.yaml 覆盖
_connection_pool: queue.Queue = queue.Queue(maxsize=20)
_pool_lock = threading.Lock()
_pool_size: int = 20  # 默认值，将被 config 覆盖


def _warm_up_connection(cfg: dict, driver: str, warm_up_count: int = 5) -> None:
    """
    【优化v7.0】预热连接池。

    在 main() 入口处预先打开多条连接放入池中，
    避免首次 db_query 调用时再走一次 ping + 新建连接的开销。

    Args:
        cfg: 数据库配置
        driver: 数据库驱动类型
        warm_up_count: 预热连接数量，默认5条（覆盖 EXPLAIN + 试跑 + 特征表校验场景）
    """
    import time
    start_time = time.time()

    try:
        for i in range(warm_up_count):
            conn = _get_db_connection(cfg, driver)
            # 【新增】验证连接有效性：执行简单查询确保连接可用
            try:
                with conn.cursor() as cursor:
                    if driver == "mysql":
                        cursor.execute("SELECT 1 AS ping")
                    elif driver in ("postgresql", "postgres", "pg"):
                        cursor.execute("SELECT 1 AS ping")
                    elif driver in ("oracle", "cx_oracle"):
                        cursor.execute("SELECT 1 FROM DUAL")
                    elif driver in ("dm", "dmdb", "dameng"):
                        cursor.execute("SELECT 1 AS ping FROM DUAL")
                    elif driver in ("mssql", "sqlserver", "sql_server"):
                        cursor.execute("SELECT 1 AS ping")
                    result = cursor.fetchone()
                    logger.debug(f"Pre-warm connection {i+1}/{warm_up_count}: OK ({result})")
            except Exception as e:
                logger.warning(f"Pre-warm connection {i+1} query failed: {e}, still pooled")
            finally:
                _put_db_connection(conn)

        elapsed = time.time() - start_time
        logger.info(f"Connection pool pre-warmed: {warm_up_count} connections in {elapsed:.2f}s")
    except Exception as e:
        logger.debug(f"Pre-warm connection skipped: {e}")


def _get_db_connection(cfg: dict, driver: str):
    """
    【优化】获取数据库连接（线程安全的连接池复用）。

    策略：
      - 锁内：从池中取连接 + 验证连接有效性
      - 锁外：创建新连接（可能有网络延迟）
    这样避免多线程同时验证同一连接的竞态条件。
    """
    # ---- 锁内：从池中取连接并验证 ----
    with _pool_lock:
        try:
            conn = _connection_pool.get_nowait()
        except queue.Empty:
            conn = None

        # 连接有效性验证必须在锁内执行，避免竞态条件
        if conn is not None:
            try:
                if driver == "mysql":
                    conn.ping()
                elif driver in ("postgresql", "postgres", "pg"):
                    if conn.closed:
                        conn.close()
                        raise ValueError("Connection closed")
                elif driver in ("dm", "dmdb", "dameng"):
                    if not conn.open:
                        conn.close()
                        raise ValueError("Connection closed")
                logger.debug("Reusing existing connection from pool")
                return conn
            except Exception:
                # 连接失效，关闭并设置为 None，走新建路径
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None

    # ---- 新建连接（在锁外，不阻塞其他线程） ----
    db = cfg.get("database") or {}

    try:
        if driver == "mysql":
            import pymysql

            conn = pymysql.connect(
                host=db.get("host", "127.0.0.1"),
                port=int(db.get("port", 3306)),
                user=db.get("user", ""),
                password=db.get("password", ""),
                database=db.get("database", ""),
                charset=db.get("charset", "utf8mb4"),
                cursorclass=pymysql.cursors.DictCursor,
            )

        elif driver in ("postgresql", "postgres", "pg"):
            import psycopg2
            import psycopg2.extras

            conn = psycopg2.connect(
                host=db.get("host", "127.0.0.1"),
                port=int(db.get("port", 5432)),
                user=db.get("user", ""),
                password=db.get("password", ""),
                dbname=db.get("database", ""),
                sslmode=db.get("sslmode", "prefer"),
            )

        elif driver in ("oracle", "cx_oracle"):
            import cx_Oracle

            host = db.get("host", "127.0.0.1")
            port = int(db.get("port", 1521))
            service_name = db.get("service_name", "ORCL")
            user = db.get("user", "")
            password = db.get("password", "")
            dsn = cx_Oracle.makedsn(host, port, service_name=service_name)
            conn = cx_Oracle.connect(user=user, password=password, dsn=dsn, encoding="UTF-8")

        elif driver in ("dm", "dmdb", "dameng"):
            import dmPython

            host = db.get("host", "127.0.0.1")
            port = int(db.get("port", 5236))
            user = db.get("user", "")
            password = db.get("password", "")
            # dmPython连接参数：user, password, server (格式: host:port)
            # 注意：dmPython不支持database参数
            conn = dmPython.connect(
                user=user,
                password=password,
                server="{}:{}".format(host, port),
            )

        elif driver in ("mssql", "sqlserver", "sql_server"):
            import pymssql

            host = db.get("host", "127.0.0.1")
            port = int(db.get("port", 1433))
            user = db.get("user", "")
            password = db.get("password", "")
            database = db.get("database", "")
            charset = db.get("charset", "utf8")
            conn = pymssql.connect(
                server=host,
                port=port,
                user=user,
                password=password,
                database=database,
                charset=charset,
            )

        else:
            raise ValueError(f"Unsupported driver: {driver}")

        return conn

    except (ValueError, ImportError):
        raise
    except Exception as e:
        raise ConnectionError(
            f"数据库连接失败！\n"
            f"  数据库类型: {driver}\n"
            f"  连接地址: {db.get('host', '?')}:{db.get('port', '?')}\n"
            f"  用户: {db.get('user', '?')}\n"
            f"  数据库: {db.get('database', '?')}\n"
            f"  错误详情: {e}\n"
            f"请检查 .env 文件或 config.yaml 中的数据库配置是否正确，并确认数据库服务已启动。"
        ) from e


def _put_db_connection(conn) -> None:
    """
    【优化】将数据库连接归还到连接池（线程安全）。

    如果连接池已满或连接无效，则直接关闭连接。
    """
    if conn is None:
        return
    with _pool_lock:
        try:
            _connection_pool.put_nowait(conn)
            logger.debug("Connection returned to pool")
            return  # 成功放回池，直接返回
        except queue.Full:
            logger.debug("Connection pool full, closing connection")
    
    # 连接池已满或放回失败，关闭连接（在锁外执行，减少锁持有时间）
    try:
        conn.close()
    except Exception:
        pass


def _format_db_info(cfg: dict, driver: str) -> str:
    """格式化数据库连接信息用于日志输出（不包含密码等敏感信息）"""
    db = cfg.get("database") or {}
    return (
        f"数据库类型={driver}, "
        f"主机={db.get('host', '')}, "
        f"端口={db.get('port', '')}, "
        f"用户={db.get('user', '')}, "
        f"数据库={db.get('database', '')}"
    )


def _get_columns_from_description(description) -> List[str]:
    """从cursor.description提取列名并转小写"""
    if not description:
        return []
    columns: List[str] = []
    for col_desc in description:
        if isinstance(col_desc, str):
            columns.append(str(col_desc).lower())
        else:
            name = str(col_desc[0])
            columns.append(name.lower())
    return columns


def _execute_query(
    cfg: dict, driver: str, sql: str, max_rows: int = 50
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    执行查询并返回结果

    Returns:
        (rows, truncated) - 行列表和是否截断标志
    """
    driver = driver.lower()
    conn = _get_db_connection(cfg, driver)

    try:
        if driver == "mysql":
            import pymysql
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = list(cur.fetchmany(max_rows))
                truncated = cur.fetchone() is not None
                return rows, truncated

        elif driver in ("postgresql", "postgres", "pg"):
            import psycopg2
            import psycopg2.extras
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql)
                rows = [dict(r) for r in cur.fetchmany(max_rows)]
                truncated = cur.fetchone() is not None
                return rows, truncated

        elif driver in ("oracle", "cx_oracle"):
            import cx_Oracle
            with conn.cursor() as cur:
                cur.execute(sql)
                columns = _get_columns_from_description(cur.description)
                batch = cur.fetchmany(max_rows)
                rows = [dict(zip(columns, row)) for row in batch]
                truncated = cur.fetchone() is not None
                return rows, truncated

        elif driver in ("dm", "dmdb", "dameng"):
            import dmPython
            with conn.cursor() as cur:
                cur.execute(sql)
                columns = _get_columns_from_description(cur.description)
                batch = cur.fetchmany(max_rows)
                rows = [dict(zip(columns, row)) for row in batch]
                truncated = cur.fetchone() is not None
                return rows, truncated

        elif driver in ("mssql", "sqlserver", "sql_server"):
            import pymssql
            with conn.cursor() as cur:
                cur.execute(sql)
                columns = _get_columns_from_description(cur.description)
                batch = cur.fetchmany(max_rows)
                rows = [dict(zip(columns, row)) for row in batch]
                truncated = cur.fetchone() is not None
                return rows, truncated

        else:
            raise ValueError(f"Unsupported driver: {driver}")
    finally:
        _put_db_connection(conn)


def _run_oracle_explain_plan(cfg: dict, stmt: str) -> List[Dict[str, Any]]:
    """Run EXPLAIN PLAN FOR and return DBMS_XPLAN rows when possible."""
    # 不需要提前导入 cx_Oracle，_get_db_connection 会处理驱动
    s = stmt.strip()
    if not s.upper().startswith("EXPLAIN PLAN FOR"):
        s = "EXPLAIN PLAN FOR " + s

    conn = _get_db_connection(cfg, "oracle")
    try:
        with conn.cursor() as cur:
            cur.execute(s)
            try:
                cur.execute(
                    "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())"
                )
                cols = [c[0].lower() for c in cur.description]
                rows = cur.fetchmany(_EXPLAIN_MAX_ROWS)
                return [dict(zip(cols, r)) for r in rows]
            except Exception:
                return [
                    {
                        "plan_table_note": (
                            "EXPLAIN PLAN FOR executed; DBMS_XPLAN.DISPLAY "
                            "unavailable or failed"
                        )
                    }
                ]
    finally:
        _put_db_connection(conn)


def _enrich_mysql_explain_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """If FORMAT=JSON returned a string column, parse JSON for readable output."""
    import json

    out: List[Dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        for k, v in list(d.items()):
            if isinstance(v, str) and v.strip().startswith("{"):
                try:
                    d[k] = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    pass
        out.append(d)
    return out


# ============================================================
# SQL 文件校验
# ============================================================


@dataclass
class ValidationResult:
    """SQL 校验结果"""
    ok: bool = True
    kind: str = ""
    skipped: bool = False
    skip_reason: Optional[str] = None
    executed_sql: Optional[str] = None
    mode: Optional[str] = None
    rows: List[Dict[str, Any]] = field(default_factory=list)
    rows_truncated: bool = False
    error: Optional[str] = None
    execution_plan_validated: bool = False
    sample_execution: Optional[Dict[str, Any]] = None
    validation_stage: Optional[str] = None
    index: Optional[int] = None


def _validate_one_statement(
    cfg: dict,
    driver: str,
    stmt: str,
    index: int,
    max_data_rows: int,
    explain_default: bool,
    execute_sample: bool,
) -> ValidationResult:
    """校验单个 SQL 语句"""
    kind = _classify_statement(stmt)

    result = ValidationResult(
        index=index,
        kind=kind,
        executed_sql=truncate_sql(stmt),
    )

    # 空语句
    if kind == "empty":
        result.ok = True
        result.skipped = True
        result.skip_reason = "empty_statement"
        return result

    # DDL - 跳过
    if kind == "ddl":
        result.ok = True
        result.skipped = True
        result.skip_reason = "ddl_not_executed"
        return result

    # 会话语句 - 跳过
    if kind == "session":
        result.ok = True
        result.skipped = True
        result.skip_reason = "session_use_set_skipped"
        return result

    # 存储过程 - 跳过
    if kind == "proc":
        result.ok = True
        result.skipped = True
        result.skip_reason = "procedure_call_skipped"
        return result

    # 确定执行模式和 SQL
    sql_run: Optional[str] = None
    mode: str = "execute"

    if kind == "explain":
        if driver in ("oracle", "cx_oracle"):
            sql_run = _oracle_explain_stmt_to_plan_sql(stmt)
            mode = "explain"
        elif driver in ("dm", "dmdb", "dameng"):
            sql_run = _dm_explain_stmt_to_plan_sql(stmt)
            mode = "explain"
        else:
            sql_run = stmt.strip()
            mode = "explain"

    elif kind == "dml":
        sql_run = (
            stmt.strip()
            if _already_explain(driver, stmt)
            else _wrap_explain_sql(cfg, driver, stmt)
        )
        mode = "explain"

    elif kind == "show":
        sql_run = stmt.strip()
        mode = "execute"

    elif kind == "select":
        if explain_default:
            sql_run = (
                stmt.strip()
                if _already_explain(driver, stmt)
                else _wrap_explain_sql(cfg, driver, stmt)
            )
            mode = "explain"
        else:
            sql_run = stmt.strip()
            mode = "execute"

    else:
        if explain_default:
            sql_run = (
                stmt.strip()
                if _already_explain(driver, stmt)
                else _wrap_explain_sql(cfg, driver, stmt)
            )
            mode = "explain"
        else:
            sql_run = stmt.strip()
            mode = "execute"

    if sql_run is None:
        result.ok = False
        result.error = "Failed to prepare SQL for execution"
        return result

    try:
        _ensure_db_driver(driver, cfg)

        # Oracle EXPLAIN
        if driver in ("oracle", "cx_oracle") and mode == "explain":
            rows = _run_oracle_explain_plan(cfg, sql_run)
            result.ok = True
            result.executed_sql = truncate_sql(sql_run)
            result.mode = mode
            result.rows = rows
            result.execution_plan_validated = True

        # 达梦 EXPLAIN
        elif driver in ("dm", "dmdb", "dameng") and mode == "explain":
            try:
                rows = _run_dm_explain_plan(cfg, sql_run)
                result.ok = True
                result.executed_sql = truncate_sql(sql_run)
                result.mode = mode
                result.rows = rows
                result.execution_plan_validated = True
            except Exception:
                # 达梦驱动对 EXPLAIN 预处理可能失败，跳过 EXPLAIN 直接执行原始 SQL 样本
                # 使用原始 stmt（不包含 EXPLAIN）直接执行，验证语法
                result.ok = True
                result.executed_sql = truncate_sql(stmt)
                result.mode = "execute"
                rows, truncated = _execute_query(cfg, driver, stmt, max_data_rows)
                result.rows = rows
                result.rows_truncated = truncated
                # 执行成功就是语法验证通过
                result.execution_plan_validated = False

        # SQL Server EXPLAIN
        elif driver in ("mssql", "sqlserver", "sql_server") and mode == "explain":
            rows = _run_mssql_explain_plan(cfg, stmt.strip())
            result.ok = True
            result.executed_sql = truncate_sql(stmt.strip())
            result.mode = mode
            result.rows = rows
            result.execution_plan_validated = True

        # 直接执行
        elif mode == "execute":
            rows, truncated = _execute_query(cfg, driver, sql_run, max_data_rows)
            result.ok = True
            result.executed_sql = truncate_sql(sql_run)
            result.mode = mode
            result.rows = rows
            result.rows_truncated = truncated
            result.execution_plan_validated = False

        # EXPLAIN 执行
        else:
            rows, truncated = _execute_query(cfg, driver, sql_run, _EXPLAIN_MAX_ROWS)
            if driver == "mysql" and "FORMAT=JSON" in sql_run.upper():
                rows = _enrich_mysql_explain_rows(rows)
            result.ok = True
            result.executed_sql = truncate_sql(sql_run)
            result.mode = mode
            result.rows = rows[:_EXPLAIN_MAX_ROWS]
            result.rows_truncated = len(rows) > _EXPLAIN_MAX_ROWS
            result.execution_plan_validated = True

        # 示例执行（EXPLAIN 成功后）
        if result.ok and not result.skipped and explain_default and execute_sample and mode == "explain" and kind == "select":
            try:
                srows, strunc = _execute_query(cfg, driver, stmt.strip(), max_data_rows)
                result.sample_execution = {
                    "sql": truncate_sql(stmt.strip()),
                    "rows": srows,
                    "rows_truncated": strunc,
                }
                result.validation_stage = "execution_plan_then_sample"
            except Exception as e:
                result.ok = False
                result.error = f"Execution plan OK but sample run failed: {e}"
                result.sample_execution = None

    except Exception as e:
        result.ok = False
        # 【v10.2 新增】SQL 错误诊断
        error_diagnosis = _diagnose_sql_error(str(e), stmt, cfg)
        if error_diagnosis:
            result.error = f"{str(e)}\n\n【v10.2 错误诊断】\n{error_diagnosis}"
        else:
            result.error = str(e)

    return result


def _diagnose_sql_error(error_msg: str, sql: str, cfg: dict) -> str:
    """
    【v10.2 新增】SQL 错误诊断函数
    当 SQL 执行失败时，解析错误信息并提供有用的诊断提示
    """
    diagnosis = []
    error_upper = error_msg.upper()

    # 1. Unknown database
    if "UNKNOWN DATABASE" in error_upper or "DATABASE" in error_upper and "EXIST" in error_upper:
        match = re.search(r"Unknown database '([^']+)'", error_msg, re.I)
        if match:
            db_name = match.group(1)
            diagnosis.append(f"❌ 数据库 '{db_name}' 不存在")
            diagnosis.append(f"   提示: 请检查 SQL 中的 schema.table 格式是否正确")
            diagnosis.append(f"   例如: schema.tableName (如 znbz.znbz_loanbill)")

    # 2. Unknown table
    elif "UNKNOWN TABLE" in error_upper or ("TABLE" in error_upper and "DOESN'T EXIST" in error_upper):
        match = re.search(r"Table '([^']+)' doesn't exist", error_msg, re.I)
        if not match:
            match = re.search(r"Table '([^']+)'", error_msg, re.I)
        if match:
            full_table = match.group(1)
            parts = full_table.split('.')
            if len(parts) >= 2:
                schema = parts[0]
                table = parts[1]
                diagnosis.append(f"❌ 表 '{schema}.{table}' 不存在")
                # 从 SQL 中提取所有 schema.table
                all_tables = re.findall(r'(\w+)\.(\w+)', sql)
                diagnosis.append(f"   SQL 中使用的表: {set(all_tables)}")
            else:
                diagnosis.append(f"❌ 表 '{full_table}' 不存在")

    # 3. Unknown column
    elif "UNKNOWN COLUMN" in error_upper or ("COLUMN" in error_upper and "EXIST" in error_upper):
        match = re.search(r"Unknown column '([^']+)'", error_msg, re.I)
        if match:
            col_name = match.group(1)
            diagnosis.append(f"❌ 列 '{col_name}' 不存在")
            # 从 SQL 中提取表名
            table_match = re.search(r"FROM\s+(\w+)\.(\w+)", sql, re.I)
            if table_match:
                schema = table_match.group(1)
                table = table_match.group(2)
                diagnosis.append(f"   提示: 请检查表 '{schema}.{table}' 中 '{col_name}' 的实际列名")
            # 提示可能的原因
            diagnosis.append(f"   可能原因:")
            diagnosis.append(f"   1. 列名拼写错误")
            diagnosis.append(f"   2. 列名大小写不匹配 (MySQL 默认大小写敏感)")
            diagnosis.append(f"   3. 表名或 schema 错误")

    # 4. Syntax error
    elif "SYNTAX" in error_upper or "NEAR" in error_upper:
        diagnosis.append(f"❌ SQL 语法错误")
        match = re.search(r"Near '([^']+)'", error_msg, re.I)
        if match:
            diagnosis.append(f"   错误位置附近: ...{match.group(1)}...")
        diagnosis.append(f"   提示: 请检查 SQL 语法是否正确")

    # 5. Connection error
    elif "CONNECT" in error_upper or "CONNECTION" in error_upper:
        diagnosis.append(f"❌ 数据库连接错误")
        diagnosis.append(f"   提示: 请检查数据库配置是否正确")

    # 6. 从元数据提供额外提示
    if diagnosis:
        # 尝试从 entities.json 获取 schema 信息
        workspace_root = cfg.get("workspace_root", "")
        entities_path = Path(workspace_root) / "output" / "entities.json"
        if entities_path.exists():
            try:
                with open(entities_path, 'r', encoding='utf-8') as f:
                    entities = json.load(f)
                # 提取所有 schema
                schemas = set()
                tables = {}
                for entity in entities.get("entities", []):
                    schema = entity.get("schema", "")
                    table = entity.get("tableName", "")
                    if schema and table:
                        schemas.add(schema)
                        if schema not in tables:
                            tables[schema] = []
                        tables[schema].append(table)

                if schemas:
                    diagnosis.append(f"\n📋 元数据中发现的 Schema:")
                    for schema in sorted(schemas):
                        diagnosis.append(f"   - {schema}")
                        if schema in tables:
                            diagnosis.append(f"     表: {tables[schema][:5]}{'...' if len(tables[schema]) > 5 else ''}")

                # 检查 SQL 中使用的 schema 是否在元数据中
                sql_schemas = set(re.findall(r'\b(\w+)\.\w+\s+AS\s+\w+', sql, re.I))
                sql_schemas.update(re.findall(r'\bFROM\s+(\w+)\.', sql, re.I))
                sql_schemas.update(re.findall(r'\bJOIN\s+(\w+)\.', sql, re.I))
                missing_schemas = sql_schemas - schemas
                if missing_schemas:
                    diagnosis.append(f"\n⚠️ SQL 中使用的 Schema (但元数据中未找到): {missing_schemas}")
                    diagnosis.append(f"   提示: 请确认这些 Schema 对应的业务对象已正确拉取")

            except Exception:
                pass  # 元数据加载失败不影响主流程

    return "\n".join(diagnosis) if diagnosis else ""


def _oracle_explain_stmt_to_plan_sql(stmt: str) -> str:
    """Normalize MySQL-style EXPLAIN ... or plain SQL to EXPLAIN PLAN FOR ... (Oracle)."""
    s = stmt.strip()
    if s.upper().startswith("EXPLAIN PLAN FOR"):
        return s
    if s.upper().startswith("EXPLAIN"):
        inner = _ORACLE_EXPLAIN_PATTERN.sub("", s, count=1)  # 使用预编译正则
        return "EXPLAIN PLAN FOR " + inner.strip()
    return "EXPLAIN PLAN FOR " + s


def _dm_explain_stmt_to_plan_sql(stmt: str) -> str:
    """Normalize SQL to EXPLAIN ... (达梦数据库，直接EXPLAIN不需要PLAN FOR)."""
    s = stmt.strip()
    if s.upper().startswith("EXPLAIN "):
        # 已经是EXPLAIN，直接返回
        return s
    if s.upper().startswith("EXPLAIN PLAN FOR"):
        # 转换为达梦语法：移除PLAN FOR（使用预编译正则）
        inner = _DM_PLAN_FOR_PATTERN.sub("", s, count=1)
        return "EXPLAIN " + inner.strip()
    return "EXPLAIN " + s


def _run_dm_explain_plan(cfg: dict, stmt: str) -> List[Dict[str, Any]]:
    """Run EXPLAIN FOR 达梦数据库.
    stmt 已经是 EXPLAIN SELECT ... 格式，不需要再次添加 EXPLAIN
    达梦 EXPLAIN 直接返回执行计划，不需要额外查询
    """
    # 不需要提前导入 dmPython，_get_db_connection 会处理驱动
    s = stmt.strip()

    conn = _get_db_connection(cfg, "dm")
    try:
        with conn.cursor() as cur:
            cur.execute(s)
            # 执行成功，检查是否有结果集
            if cur.description:
                columns = _get_columns_from_description(cur.description)
                rows = cur.fetchmany(_EXPLAIN_MAX_ROWS)
                return [dict(zip(columns, row)) for row in rows]
            # EXPLAIN 执行成功，但没有返回行，说明语法正确
            return [{"plan_note": "EXPLAIN executed successfully, SQL syntax is correct"}]
    finally:
        _put_db_connection(conn)


def _run_mssql_explain_plan(cfg: dict, sql: str) -> List[Dict[str, Any]]:
    """Run SET SHOWPLAN_XML ON for SQL Server to get execution plan."""
    # 不需要提前导入 pymssql，_get_db_connection 会处理驱动
    conn = _get_db_connection(cfg, "mssql")
    try:
        with conn.cursor() as cur:
            # 开启显示计划
            cur.execute("SET SHOWPLAN_XML ON")
            try:
                conn.commit()
            except AttributeError:
                pass
            try:
                # 执行SQL但不实际运行
                cur.execute(sql)
                try:
                    conn.commit()
                except AttributeError:
                    pass
                # 获取XML格式的执行计划
                if cur.description:
                    columns = [col[0].lower() for col in cur.description]
                    rows = cur.fetchmany(_EXPLAIN_MAX_ROWS)
                    result = [dict(zip(columns, r)) for r in rows]
                else:
                    result = [{"plan_note": "执行计划已生成"}]
            finally:
                # 关闭显示计划
                try:
                    cur.execute("SET SHOWPLAN_XML OFF")
                    try:
                        conn.commit()
                    except AttributeError:
                        pass
                except Exception:
                    pass
            return result
    finally:
        _put_db_connection(conn)


def _resolve_tenant_id(cfg: dict) -> str:
    """Resolve tenant ID from config for replacing var$(租户id) during validation.

    Priority: YONBIP_TENANT_ID env var > database.queries.elastic_field_check.ytenant_id > 'q6shbpxc'
    """
    # 1. Check YONBIP_TENANT_ID environment variable
    tenant_id = os.environ.get("YONBIP_TENANT_ID", "").strip()
    if tenant_id:
        return tenant_id

    # 2. Check database.queries.elastic_field_check.ytenant_id
    db = cfg.get("database") or {}
    queries = db.get("queries") or {}
    elastic = queries.get("elastic_field_check") or {}
    tenant_id = str(elastic.get("ytenant_id", "")).strip()
    if tenant_id and tenant_id != "0":
        return tenant_id

    # 3. Default fallback — 未配置租户ID时校验仍可执行，但租户相关过滤可能不匹配
    return "your_tenant_id"


def _replace_tenant_var(sql_text: str, tenant_id: str) -> str:
    """Replace BIP platform tenant variable var$(租户id) with actual tenant ID for validation.

    The original SQL file is NOT modified; replacement happens in-memory only.
    """
    return sql_text.replace("'var$(租户id)'", f"'{tenant_id}'")


# 【优化】param$ 参数智能替换规则
_PARAM_REPLACEMENTS: dict = {
    # ID类型参数 → NULL (表示查询所有)
    "账簿": "NULL",
    "仓库": "NULL",
    "成本域": "NULL",
    "物料": "NULL",
    "批次": "NULL",
    "库存组织": "NULL",
    "项目": "NULL",
    "供应商": "NULL",
    "客户": "NULL",
    # 期间类型参数 → 日期格式（结束期间用年末以便覆盖完整年度）
    "起始期间": "'2024-01-01'",
    "结束期间": "'2024-12-31'",
    "查询期间": "'2024-01-01'",
    "截止期间": "'2024-12-31'",
    "会计年度": "'2024'",
    "起始日期": "'2024-01-01'",
    "结束日期": "'2024-12-31'",
    "查询日期": "'2024-01-31'",  # 【v7.0 新增】查询日期参数
    # 数字类型参数
    "期间月数": "3",
    "期间天数": "90",
    "查询月数": "3",
    # 字符串类型参数
    "排序方式": "'0'",
    "库存方式": "'0'",
}


def _replace_param_vars(sql_text: str) -> tuple:
    """
    【优化v2】替换 BIP 平台参数函数 param$('参数名') 为测试值。

    参数类型智能识别:
    - ID/档案类参数 → NULL (查询所有)
    - 期间参数 → 'YYYY-MM' 格式
    - 数字参数 → 数字值

    Returns:
        tuple: (替换后的SQL文本, 是否发生过替换, 替换详情列表)
    """
    import re

    # 匹配 param$('参数名') 模式
    pattern = r"param\$\('([^']+)'\)"
    matches = re.findall(pattern, sql_text)

    if not matches:
        return sql_text, False, []

    replacements = []
    new_sql = sql_text

    for param_name in matches:
        # 查找替换规则
        replacement = _PARAM_REPLACEMENTS.get(param_name)

        if replacement is None:
            # 智能推断参数类型
            # 优先匹配完整的期间范围条件
            if "结束" in param_name and "期间" in param_name:
                replacement = "'2024-12-31'"  # 结束期间用年末
            elif "开始" in param_name and "期间" in param_name:
                replacement = "'2024-01-01'"  # 开始期间用年初
            elif "结束" in param_name and "日期" in param_name:
                replacement = "'2024-12-31'"  # 结束日期用年末
            elif "开始" in param_name and "日期" in param_name:
                replacement = "'2024-01-01'"  # 开始日期用年初
            elif "日期" in param_name:
                replacement = "'2024-06-30'"  # 日期参数
            elif "期间" in param_name or "月份" in param_name:
                replacement = "'2024-01'"  # 期间参数
            elif "月数" in param_name or "天数" in param_name or "数量" in param_name:
                replacement = "3"
            elif "ID" in param_name or "编码" in param_name or "账簿" in param_name or "仓库" in param_name:
                replacement = "NULL"
            else:
                replacement = "NULL"  # 默认

        # 执行替换
        old = f"param$('{param_name}')"
        new = replacement
        new_sql = new_sql.replace(old, new, 1)
        replacements.append(f"{old} → {new}")

    return new_sql, True, replacements


def _generate_confirm_excel_if_passed(
    sql_path: Path,
    entities_path: str,
    cfg: dict,
    original_sql_file: str
) -> None:
    """【v10.3 新增】校验成功后自动生成报表需求确认单 Excel"""
    try:
        from gen_confirm_excel import generate_confirm_excel

        # 读取原始 SQL 内容
        sql_content = sql_path.read_text(encoding="utf-8")

        # 确定输出路径
        sql_dir = sql_path.parent
        report_name = sql_path.stem  # 使用 SQL 文件名作为报表名

        # 生成确认 Excel 文件名
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        excel_path = sql_dir / f"报表需求确认单_{report_name}_{timestamp}.xlsx"

        # 获取报表名称（从 SQL 注释中提取）
        report_name_display = report_name
        match = re.search(r'--\s*报表名称[：:]\s*(.+)', sql_content)
        if match:
            report_name_display = match.group(1).strip()
        else:
            match = re.search(r'--\s*(.+)报表\s*SQL', sql_content)
            if match:
                report_name_display = match.group(1).strip()

        logger.info(f"正在生成需求确认单: {excel_path}")

        # 生成确认 Excel
        success = generate_confirm_excel(
            sql_content=sql_content,
            entities_json_path=entities_path,
            output_path=str(excel_path),
            report_name=report_name_display
        )

        if success:
            logger.info(f"需求确认单已生成: {excel_path}")
            print(f"\n[INFO] 需求确认单已生成: {excel_path}", file=sys.stderr)
        else:
            logger.warning("需求确认单生成失败")

    except ImportError as e:
        logger.warning(f"无法生成确认 Excel: 缺少依赖 - {e}")
    except Exception as e:
        logger.warning(f"生成确认 Excel 时出错: {e}")


def _run_report_sql_file(
    cfg: dict,
    driver: str,
    path: Path,
    max_rows: int,
    explain_default: bool,
    execute_sample: bool,
) -> Dict[str, Any]:
    """运行报表 SQL 文件校验"""
    text = path.read_text(encoding="utf-8")

    # Auto-replace var$(租户id) with actual tenant ID for validation
    tenant_id = _resolve_tenant_id(cfg)
    replaced_text = _replace_tenant_var(text, tenant_id)
    if replaced_text != text:
        logger.info("Replaced var$(租户id) → '%s' for validation (SQL file unchanged)", tenant_id)
    text = replaced_text

    # 【优化v2】Auto-replace param$() with test values for validation
    text, param_replaced, param_details = _replace_param_vars(text)
    if param_replaced:
        logger.info("Replaced %d param$() variables for validation: %s", len(param_details), param_details)

    parts = _split_statements_sql(text)
    if not parts:
        raise ValueError(f"No SQL statements found in {path}")

    results: List[Dict[str, Any]] = []
    for idx, stmt in enumerate(parts):
        result = _validate_one_statement(
            cfg, driver, stmt, idx, max_rows, explain_default, execute_sample
        )
        results.append(vars(result))

    success = sum(1 for r in results if r.get("ok") and not r.get("skipped"))
    failed = sum(1 for r in results if not r.get("ok"))
    skipped = sum(1 for r in results if r.get("skipped"))

    # 兼容旧格式
    legacy_sql: Optional[str] = None
    legacy_rows: Optional[List[Dict[str, Any]]] = None
    for r in results:
        if r.get("skipped") or not r.get("ok"):
            continue
        rows = r.get("rows")
        if rows is not None and r.get("executed_sql"):
            legacy_sql = r["executed_sql"]
            legacy_rows = rows
            break

    out: Dict[str, Any] = {
        "validation": "report_sql_file",
        "source_file": str(path.resolve()),
        "explain": explain_default,
        "execute_sample_after_plan": execute_sample,
        "statements": results,
        "summary": {
            "statement_count": len(parts),
            "success": success,
            "failed": failed,
            "skipped": skipped,
        },
        "max_data_rows": max_rows,
    }
    if legacy_sql is not None and legacy_rows is not None:
        out["sql"] = legacy_sql
        out["rows"] = legacy_rows
        out["row_count"] = len(legacy_rows)

    return out


# ============================================================
# 命名查询
# ============================================================


def _default_elastic_sql(schema: str, virtual_table: str, ytenant_id: str) -> str:
    """生成特征字段检查的默认 SQL"""
    # 验证标识符只包含合法字符，防止SQL注入
    import re
    if not re.match(r'^[a-zA-Z0-9_]+$', schema):
        raise ValueError(f"Invalid schema name: {schema} (only letters, digits, and underscores allowed)")
    if not re.match(r'^[a-zA-Z0-9_]+$', virtual_table):
        raise ValueError(f"Invalid virtual_table name: {virtual_table} (only letters, digits, and underscores allowed)")
    if not re.match(r'^[a-zA-Z0-9_-]+$', ytenant_id):
        raise ValueError(f"Invalid ytenant_id: {ytenant_id} (only letters, digits, underscores, and hyphens allowed)")

    return f"""SELECT
    field.real_table AS real_table,
    field.real_column AS real_column,
    field.field_name AS field_name,
    field."comment" AS field_comment,
    field.ytenant_id AS ytenant_id
FROM {schema}.elastic_object obj
LEFT JOIN {schema}.elastic_field field ON obj.id = field.object_id
WHERE obj.table_name = '{virtual_table}'
  AND field.ytenant_id = '{ytenant_id}'
"""


def _run_named_query(cfg: dict, driver: str, query_key: str) -> Dict[str, Any]:
    """运行数据库.queries 中定义的命名查询"""
    db = cfg.get("database") or {}
    queries = db.get("queries") or {}
    qdef = queries.get(query_key) or {}

    if not qdef.get("enabled", True):
        raise ValueError(f"Query {query_key} is disabled.")

    sql = (qdef.get("sql") or "").strip()
    if not sql:
        sql = _default_elastic_sql(
            str(qdef.get("schema", "uorders")),
            str(qdef.get("virtual_table_name", "orders_character_define")),
            str(qdef.get("ytenant_id", "0")),
        )

    _ensure_db_driver(driver, cfg)
    rows, _ = _execute_query(cfg, driver, sql, 1000)

    return {"sql": sql, "rows": rows, "query_key": query_key}


# ============================================================
# 主入口
# ============================================================


def main() -> int:
    require_python_version()

    configure_stdio_utf8()
    setup_logging("db_query")

    ap = argparse.ArgumentParser(
        description="Run configured DB queries from iuap-c-report_sql_gen skill."
    )
    ap.add_argument(
        "--config",
        default=str(_skill_dir() / "config.yaml"),
        help="Path to config.yaml",
    )
    ap.add_argument(
        "--env-file",
        default=None,
        help="Path to .env file (default: <config_dir>/.env)",
    )
    ap.add_argument(
        "--query",
        default=None,
        help="Key under database.queries (default elastic_field_check when --sql-file omitted)",
    )
    ap.add_argument(
        "--sql-file",
        default=None,
        help="Path to user deliverable .sql; splits all statements (sqlparse), validates each",
    )
    ap.add_argument(
        "--report-sql-max-rows",
        type=int,
        default=None,
        help="Max rows for --sql-file (default: database.report_sql_max_rows or 50)",
    )
    ap.add_argument(
        "--explain",
        action="store_true",
        help="Use EXPLAIN for SELECT/WITH (plan only) instead of executing",
    )
    ap.add_argument(
        "--execute-only",
        action="store_true",
        help="For --sql-file: run SELECT/WITH directly (no EXPLAIN first)",
    )
    ap.add_argument(
        "--no-execute-sample",
        action="store_true",
        help="For --sql-file: do not run a limited sample execute after EXPLAIN",
    )
    ap.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Output detailed logs",
    )
    ap.add_argument(
        "--warm-up",
        type=int,
        default=3,
        help="Number of connections to pre-warm in pool (default: 3, set 0 to disable)",
    )
    ap.add_argument(
        "--validation-loop",
        action="store_true",
        help="【v8.0 新增】启用静态校验+自修复循环（最多10次）",
    )
    ap.add_argument(
        "--validation-max-iterations",
        type=int,
        default=10,
        help="最大校验循环次数 (default: 10)",
    )
    ap.add_argument(
        "--no-static-validation",
        action="store_true",
        help="禁用静态规则校验，直接执行数据库校验",
    )
    ap.add_argument(
        "--entities-path",
        default=None,
        help="元数据 entities.json 文件路径 (用于静态校验和自修复)",
    )

    args = ap.parse_args()

    # 设置详细日志
    if args.verbose:
        import logging
        logging.getLogger("db_query").setLevel(logging.DEBUG)

    # 加载配置
    cfg_path = Path(args.config).expanduser().resolve()
    if not cfg_path.exists():
        print(f"错误: 配置文件不存在: {cfg_path}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 显式加载 .env 文件
    if args.env_file:
        env_path = Path(args.env_file).expanduser().resolve()
    else:
        env_path = cfg_path.parent / ".env"
    load_dotenv(env_path)
    if env_path.exists():
        logger.info(f"已加载环境配置: {env_path}")
    else:
        logger.warning(f"未找到 .env 文件: {env_path}，请确认文件路径是否正确")

    try:
        cfg = resolve_config(cfg_path)
    except Exception as e:
        print(f"错误: 配置加载失败: {e}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 【v7.0 新增】初始化数据库连接池配置（从 config.yaml 读取）
    perf = cfg.get("performance") or {}
    global _pool_size, _connection_pool
    _pool_size = max(5, int(perf.get("db_connection_pool_size", 20)))
    _connection_pool = queue.Queue(maxsize=_pool_size)
    logger.info(f"[CONFIG] 数据库连接池大小: {_pool_size}")

    db = cfg.get("database") or {}
    if not str_to_bool(db.get("enabled")):
        logger.info("database.enabled is false; nothing to run.")
        return ExitCode.SUCCESS

    # 验证数据库配置
    errors = validate_database_config(cfg)
    if errors:
        logger.error("数据库配置验证失败:")
        for err in errors:
            logger.error(f"  - {err}")
        return ExitCode.CONFIG_ERROR

    # 【优化】统一依赖初始化：一次性确保 sqlparse + DB 驱动就绪（进程内只执行一次）
    driver = (db.get("driver") or "mysql").lower()
    need_sqlparse = bool(args.sql_file)
    try:
        _ensure_deps_once(driver, need_sqlparse=need_sqlparse, cfg=cfg)
    except ImportError as e:
        print(str(e), file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 【优化v7.0】预热连接池：依赖就绪后立即打开多条连接，避免首次查询时新建连接的开销
    # 优先使用命令行参数，否则使用配置文件中的值
    perf = cfg.get("performance") or {}
    config_warm_up_count = max(0, int(perf.get("db_connection_warm_up_count", 5)))
    warm_up_count = getattr(args, 'warm_up', config_warm_up_count)
    if warm_up_count > 0:
        _warm_up_connection(cfg, driver, warm_up_count=warm_up_count)
        logger.info(f"[CONFIG] 预热连接数量: {warm_up_count}")

    query_key = args.query
    if args.sql_file is None and query_key is None:
        query_key = "elastic_field_check"

    max_rows = args.report_sql_max_rows
    if max_rows is None:
        max_rows = int(db.get("report_sql_max_rows") or 50)

    explain_default = (not args.execute_only) and (
        bool(args.explain) or bool(db.get("report_sql_use_explain", True))
    )
    execute_sample = (not args.no_execute_sample) and bool(
        db.get("report_sql_execute_sample", True)
    )

    # 打印数据库连接信息
    db_info_str = _format_db_info(cfg, driver)
    logger.info(f"数据库连接信息: {db_info_str}")
    print(f"数据库连接信息: {db_info_str}", file=sys.stderr)

    combined: Dict[str, Any] = {}
    combined["database_info"] = {
        "driver": driver,
        "host": db.get("host", ""),
        "port": str(db.get("port", "")),
        "user": db.get("user", ""),
        "database": db.get("database", ""),
    }

    # 执行 SQL 文件校验
    if args.sql_file:
        raw_path = Path(args.sql_file).expanduser()
        sql_path = raw_path if raw_path.is_absolute() else (Path.cwd() / raw_path).resolve()
        if not sql_path.is_file():
            print(f"SQL file not found: {args.sql_file}", file=sys.stderr)
            return ExitCode.FILE_ERROR
        try:
            logger.info(f"校验 SQL 文件: {sql_path}")

            # 【v8.0 新增】校验循环模式
            if args.validation_loop and _SQL_VALIDATION_LOOP_AVAILABLE:
                from pathlib import Path as P
                entities_path = P(args.entities_path) if args.entities_path else None
                max_iterations = args.validation_max_iterations

                logger.info(f"启用校验循环模式 (最大 {max_iterations} 次)")

                # 创建数据库校验回调函数
                def db_validator(sql_stmt: str):
                    """数据库校验回调"""
                    result = _validate_one_statement(
                        cfg, driver, sql_stmt, 0, max_rows, explain_default, execute_sample
                    )
                    return result.ok, result.error if not result.ok else None

                # 创建并运行校验循环
                loop = create_validation_loop(
                    db_validator_func=db_validator,
                    entities_path=entities_path,
                    max_iterations=max_iterations
                )

                # 读取并处理 SQL
                text = sql_path.read_text(encoding="utf-8")

                # 参数替换
                tenant_id = _resolve_tenant_id(cfg)
                text = _replace_tenant_var(text, tenant_id)
                text, _, _ = _replace_param_vars(text)

                # 分割语句并逐个校验
                parts = _split_statements_sql(text)
                loop_results = []

                for idx, stmt in enumerate(parts):
                    logger.info(f"校验语句 {idx + 1}/{len(parts)}")
                    result = loop.run(stmt)
                    loop_results.append({
                        "statement_index": idx,
                        "ok": result.ok,
                        "iterations": result.iterations,
                        "total_time_ms": result.total_time_ms,
                        "error": result.error,
                        "steps": [
                            {
                                "step": s.step,
                                "ok": s.ok,
                                "elapsed_ms": s.elapsed_ms,
                                "error": s.error,
                                "fixes_applied": s.fixes_applied
                            }
                            for s in result.steps
                        ]
                    })

                # 汇总结果
                success_count = sum(1 for r in loop_results if r["ok"])
                combined["report_sql_file"] = {
                    "validation": "validation_loop",
                    "source_file": str(sql_path.resolve()),
                    "statements": loop_results,
                    "summary": {
                        "statement_count": len(parts),
                        "success": success_count,
                        "failed": len(parts) - success_count,
                        "max_iterations": max_iterations
                    }
                }
                logger.info(f"校验循环完成: {success_count}/{len(parts)} 语句通过")

                # 【v10.3 新增】校验成功后自动生成确认 Excel
                if success_count == len(parts) and args.entities_path:
                    _generate_confirm_excel_if_passed(
                        sql_path, args.entities_path, cfg, args.sql_file
                    )
            else:
                # 原有校验逻辑
                report_result = _run_report_sql_file(
                    cfg, driver, sql_path, max_rows, explain_default, execute_sample
                )
                combined["report_sql_file"] = report_result

                # 【v10.3 新增】校验成功后自动生成确认 Excel
                summary = report_result.get("summary", {})
                success = summary.get("success", 0)
                total = summary.get("statement_count", 0)
                if success == total and args.entities_path:
                    _generate_confirm_excel_if_passed(
                        sql_path, args.entities_path, cfg, args.sql_file
                    )
        except Exception as e:
            logger.error(f"SQL 文件校验失败: {e}")
            return ExitCode.VALIDATION_ERROR

    # 执行命名查询
    if query_key:
        try:
            logger.info(f"执行命名查询: {query_key}")
            nq = _run_named_query(cfg, driver, query_key)
            combined[query_key] = {"sql": nq["sql"], "rows": nq["rows"]}
        except Exception as e:
            logger.error(f"命名查询执行失败: {e}")
            return ExitCode.VALIDATION_ERROR

    if not combined:
        print("Nothing to run (no --sql-file and no --query).", file=sys.stderr)
        return ExitCode.SUCCESS

    # 输出结果
    if len(combined) == 1:
        only = next(iter(combined.values()))
        if args.sql_file and not query_key:
            print(json.dumps(only, ensure_ascii=False, indent=2, default=_json_default))
        else:
            print(json.dumps({"sql": only["sql"], "rows": only["rows"]}, ensure_ascii=False, indent=2, default=_json_default))
        return ExitCode.SUCCESS

    print(json.dumps(combined, ensure_ascii=False, indent=2, default=_json_default))
    return ExitCode.SUCCESS


if __name__ == "__main__":
    raise SystemExit(main())

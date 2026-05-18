#!/usr/bin/env bash
# SQL 校验脚本 (Unix)
# Windows 用户请使用: run_db_query.cmd
set -eo pipefail

if [[ -n "${OS}" && "${OS}" == "Windows_NT" ]] || \
   [[ -n "${MSYSTEM}" && "${MSYSTEM}" == "MINGW"* ]] || \
   [[ -n "${TERM}" && "${TERM}" == "cygwin" ]]; then
    echo "[ERR] 请使用 Windows 命令" >&2
    echo "[ERR] 在 Windows 下请使用: run_db_query.cmd [参数...]" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"
if [[ -x "${SCRIPT_DIR}/.venv/bin/python" ]]; then
    exec "${SCRIPT_DIR}/.venv/bin/python" "${SCRIPT_DIR}/db_query.py" "$@"
fi
exec python3 "${SCRIPT_DIR}/db_query.py" "$@"

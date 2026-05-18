#!/usr/bin/env bash
# 环境检查脚本 - 检查 API 和数据库连接
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# 使用技能本地包
COMMON_ROOT="${SCRIPT_DIR}/iuap_common"

# 检查虚拟环境
VENV_DIR="${SCRIPT_DIR}/.venv"
if [[ ! -x "${VENV_DIR}/bin/python" ]] && [[ ! -x "${VENV_DIR}/Scripts/python.exe" ]]; then
    echo "[INFO] Virtual environment not found, creating..."
    python3 -m venv "${VENV_DIR}"
fi

# 设置 Python 路径
if [[ -x "${VENV_DIR}/bin/python" ]]; then
    VENV_PY="${VENV_DIR}/bin/python"
elif [[ -x "${VENV_DIR}/Scripts/python.exe" ]]; then
    VENV_PY="${VENV_DIR}/Scripts/python.exe"
else
    VENV_PY="python3"
fi

# 检查依赖 - 先安装核心依赖
echo "[INFO] Installing core dependencies..."
"${VENV_PY}" -m pip install PyYAML requests 2>&1 || true

# 设置 PYTHONPATH 以便导入本地 common 模块
export PYTHONPATH="${SCRIPT_DIR}:${PYTHONPATH}"

# 运行环境检查
exec "${VENV_PY}" "${COMMON_ROOT}/check_env.py" --config "${SKILL_ROOT}/config.yaml" --env-file "${SKILL_ROOT}/.env" "$@"

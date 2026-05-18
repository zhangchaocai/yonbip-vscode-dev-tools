#!/usr/bin/env bash
# 智能环境安装脚本 - 基于标记文件快速跳过已安装环境
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
REQS_FILE="${SCRIPT_DIR}/requirements.txt"
SENTINEL="${VENV_DIR}/.deps_installed"

sync_venv_executables() {
    if [[ -x "${VENV_DIR}/bin/python" ]]; then
        VENV_PY="${VENV_DIR}/bin/python"
        VENV_PIP="${VENV_DIR}/bin/pip"
    elif [[ -x "${VENV_DIR}/Scripts/python.exe" ]]; then
        VENV_PY="${VENV_DIR}/Scripts/python.exe"
        VENV_PIP="${VENV_DIR}/Scripts/pip.exe"
    else
        VENV_PY="${VENV_DIR}/bin/python"
        VENV_PIP="${VENV_DIR}/bin/pip"
    fi
}
sync_venv_executables

ensure_venv() {
    # 快速路径：标记文件存在且比 requirements 文件新 → 跳过
    if [[ -f "${SENTINEL}" ]] && [[ "${SENTINEL}" -nt "${REQS_FILE}" ]]; then
        return 0
    fi

    # 虚拟环境不存在 → 创建并安装
    if [[ ! -x "${VENV_PY}" ]]; then
        echo "[INFO] Creating virtual environment..."
        python3 -m venv "${VENV_DIR}"
        sync_venv_executables
        echo "[INFO] Installing dependencies..."
        "${VENV_PIP}" install --quiet -r "${REQS_FILE}"
        touch "${SENTINEL}"
        return 0
    fi

    # 虚拟环境存在但标记缺失或过期 → 仅安装依赖
    echo "[INFO] Installing missing dependencies..."
    "${VENV_PIP}" install --quiet -r "${REQS_FILE}"
    touch "${SENTINEL}"
}

# 执行模式：./pip_install.sh run <script.py> [args...]
if [[ "${1:-}" == "run" ]] && [[ $# -ge 2 ]]; then
    ensure_venv
    SKILL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
    cd "${SKILL_ROOT}"
    shift  # 移除 run
    RUN_SCRIPT_PATH="$1"
    if [[ "$RUN_SCRIPT_PATH" != /* ]]; then
        REL="${RUN_SCRIPT_PATH#./}"
        if [[ "$REL" == scripts/* ]]; then
            RUN_SCRIPT_PATH="${SKILL_ROOT}/${REL}"
        elif [[ -f "${SCRIPT_DIR}/${REL}" ]]; then
            RUN_SCRIPT_PATH="${SCRIPT_DIR}/${REL}"
        elif [[ -f "${SKILL_ROOT}/${REL}" ]]; then
            RUN_SCRIPT_PATH="${SKILL_ROOT}/${REL}"
        else
            RUN_SCRIPT_PATH="${SCRIPT_DIR}/${REL}"
        fi
    fi
    shift  # 移除脚本名，保留剩余参数
    sync_venv_executables
    exec "${VENV_PY}" "${RUN_SCRIPT_PATH}" "$@"
else
    ensure_venv
    echo "[INFO] Environment ready. Activate with: source ${VENV_DIR}/bin/activate"
    echo "[INFO] Or run scripts directly: ./pip_install.sh run <script.py> [args...]"
fi

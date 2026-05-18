@echo off
REM 环境检查脚本 - 检查 API 和数据库连接 (Windows)
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "SKILL_ROOT=%SCRIPT_DIR%.."
set "COMMON_ROOT=%SCRIPT_DIR%iuap_common"

REM 检查虚拟环境
set "VENV_DIR=%SCRIPT_DIR%.venv"
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [INFO] Virtual environment not found, creating...
    python -m venv "%VENV_DIR%"
)

REM 设置 Python 路径
if exist "%VENV_DIR%\Scripts\python.exe" (
    set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
) else (
    set "VENV_PY=python"
)

REM 安装依赖
if exist "%SCRIPT_DIR%requirements.txt" (
    "%VENV_PY%" -m pip install --quiet -r "%SCRIPT_DIR%requirements.txt" 2>NUL || echo [WARN] Dependencies installation skipped
)

REM 设置 PYTHONPATH
set "PYTHONPATH=%SCRIPT_DIR%;%PYTHONPATH%"

REM 运行环境检查
"%VENV_PY%" "%COMMON_ROOT%\check_env.py" --config "%SKILL_ROOT%\config.yaml" --env-file "%SKILL_ROOT%\.env" %*

endlocal

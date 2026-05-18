@echo off
REM SQL 校验脚本 (Windows)
REM 用法: run_db_query.cmd --sql-file <file>
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "VENV_DIR=%SCRIPT_DIR%.venv"
set "RUNNER=%SCRIPT_DIR%pip_install_run.py"

if exist "%VENV_DIR%\Scripts\python.exe" (
    set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
) else (
    set "VENV_PY=python"
)

REM 调用 pip_install_run.py run db_query.py 并透传所有参数
python "%RUNNER%" run db_query.py %*
if errorlevel 1 (
    echo [ERR] SQL 校验失败
    exit /b %errorlevel%
)
exit /b 0

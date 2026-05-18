@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Windows 与 pip_install.sh 等价；run 时由 pip_install_run.py 完整转发参数（含引号/长参）
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "VENV_DIR=%SCRIPT_DIR%\.venv"
set "REQS_FILE=%SCRIPT_DIR%\requirements.txt"
set "SENTINEL=%VENV_DIR%\.deps_installed"

if exist "%VENV_DIR%\Scripts\python.exe" (
  set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
  set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"
) else if exist "%VENV_DIR%\bin\python" (
  set "VENV_PY=%VENV_DIR%\bin\python"
  set "VENV_PIP=%VENV_DIR%\bin\pip"
) else (
  set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
  set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"
)

set "PYCREATE="
where py >nul 2>&1
if not errorlevel 1 set "PYCREATE=py -3 -m venv"
if not defined PYCREATE (
  where python >nul 2>&1
  if not errorlevel 1 set "PYCREATE=python -m venv"
)
if not defined PYCREATE (
  echo [ERR] 未找到 py 或 python。请先安装 Python 3 并加入 PATH。
  exit /b 1
)

call :ensure_venv
if errorlevel 1 exit /b 1

if /i not "%~1"=="run" goto :done_ready

if "%~2"=="" (
  echo [ERR] run 后需要指定主脚本，例如: %~nx0 run main.py ...
  exit /b 1
)
for %%I in ("!SCRIPT_DIR!\..") do set "SKILL_ROOT=%%~fI"
cd /d "!SKILL_ROOT!"

set "RUNNER=!SCRIPT_DIR!\pip_install_run.py"
where python >nul 2>&1
if not errorlevel 1 (
  python "!RUNNER!" %*
  exit /b !errorlevel!
)
where py >nul 2>&1
if not errorlevel 1 (
  py -3 "!RUNNER!" %*
  exit /b !errorlevel!
)
echo [ERR] 未找到 python / py 启动器，无法执行 pip_install_run.py。
exit /b 1

:done_ready
echo [INFO] 环境已就绪。可用: %~nx0 run ^<脚本.py^> [参数...]
exit /b 0

:ensure_venv
set "SKIP_PIP=0"
if exist "%SENTINEL%" if exist "%REQS_FILE%" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Item -LiteralPath '%SENTINEL%').LastWriteTime -ge (Get-Item -LiteralPath '%REQS_FILE%').LastWriteTime) { '1' } else { '0' }" 2^>nul`) do set "PS_CMP=%%P"
  if "!PS_CMP!"=="1" set "SKIP_PIP=1"
)
if exist "%VENV_DIR%\Scripts\python.exe" set "VENV_PY=%VENV_DIR%\Scripts\python.exe" & set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"
if exist "%VENV_DIR%\bin\python" set "VENV_PY=%VENV_DIR%\bin\python" & set "VENV_PIP=%VENV_DIR%\bin\pip"
if not exist "%VENV_DIR%\Scripts\python.exe" if not exist "%VENV_DIR%\bin\python" (
  echo [INFO] Creating virtual environment...
  %PYCREATE% "%VENV_DIR%"
  if errorlevel 1 exit /b 1
  if exist "%VENV_DIR%\Scripts\python.exe" set "VENV_PY=%VENV_DIR%\Scripts\python.exe" & set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"
  if exist "%VENV_DIR%\bin\python" set "VENV_PY=%VENV_DIR%\bin\python" & set "VENV_PIP=%VENV_DIR%\bin\pip"
  echo [INFO] Installing dependencies...
  "%VENV_PIP%" install --quiet -r "%REQS_FILE%"
  if errorlevel 1 exit /b 1
  type nul > "%SENTINEL%"
  exit /b 0
)
if "!SKIP_PIP!"=="1" exit /b 0
if not exist "%REQS_FILE%" (
  type nul > "%SENTINEL%"
  exit /b 0
)
echo [INFO] Installing missing dependencies...
"%VENV_PIP%" install --quiet -r "%REQS_FILE%"
if errorlevel 1 exit /b 1
type nul > "%SENTINEL%"
exit /b 0

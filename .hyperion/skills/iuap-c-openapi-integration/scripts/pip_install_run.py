#!/usr/bin/env python3
"""
与 pip_install.sh 的 "run" 段一致：在已有 venv 下执行主脚本，完整转发 CLI 参数。
由 pip_install.cmd 在 ensure_venv 之后以系统 python 调用：pip_install_run.py run <script> [args...]
"""
import os
import sys
import subprocess


def _resolve_run_path(script_dir: str, skill_root: str, main_arg: str) -> str:
    if main_arg.startswith("/") or (len(main_arg) > 2 and main_arg[1] == ":"):
        return main_arg
    rel = main_arg[2:] if main_arg.startswith("./") else main_arg
    rel = rel.replace("/", os.sep)
    norm = rel.replace("\\", os.sep)
    if norm.startswith("scripts" + os.sep):
        return os.path.normpath(os.path.join(skill_root, rel))
    c1 = os.path.join(script_dir, rel)
    if os.path.isfile(c1):
        return os.path.normpath(c1)
    c2 = os.path.join(skill_root, rel)
    if os.path.isfile(c2):
        return os.path.normpath(c2)
    return os.path.normpath(os.path.join(script_dir, rel))


def main() -> int:
    a = sys.argv[1:]
    if len(a) < 2 or a[0] != "run":
        print("[ERR] 用法: pip_install_run.py run <script.py> [参数...]", file=sys.stderr)
        return 2
    script_dir = os.path.dirname(os.path.abspath(__file__))
    venv = os.path.join(script_dir, ".venv")
    win = os.name == "nt"
    sub = "Scripts" if win else "bin"
    ext = ".exe" if win else ""
    vpy = os.path.join(venv, sub, f"python{ext}")
    if not os.path.isfile(vpy):
        print(f"[ERR] 未找到虚拟环境: {vpy}", file=sys.stderr)
        return 1
    skill_root = os.path.normpath(os.path.join(script_dir, ".."))
    run_path = _resolve_run_path(script_dir, skill_root, a[1])
    if not os.path.isfile(run_path):
        print(f"[ERR] 未找到脚本: {run_path}", file=sys.stderr)
        return 1
    env = os.environ.copy()
    if win:
        env.setdefault("PYTHONUTF8", "1")
    return int(subprocess.run([vpy, run_path, *a[2:]], env=env).returncode)


if __name__ == "__main__":
    raise SystemExit(main())

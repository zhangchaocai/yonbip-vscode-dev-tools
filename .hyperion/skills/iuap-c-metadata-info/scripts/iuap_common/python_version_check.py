#!/usr/bin/env python3
"""
Python 版本检测和升级引导模块
支持 Windows、macOS、Linux 跨平台
"""
from __future__ import annotations

import platform
import subprocess
import sys
import os
from pathlib import Path
from typing import Optional

# 技能要求的最低 Python 版本
MIN_PYTHON_VERSION = (3, 9)


def get_python_version() -> tuple[int, int, int]:
    """获取当前 Python 版本 (major, minor, patch)"""
    return sys.version_info[:3]


def check_python_version(min_version: tuple[int, int] = MIN_PYTHON_VERSION) -> tuple[bool, str]:
    """
    检查 Python 版本是否满足要求

    Returns:
        (is_ok, message): 是否满足要求及消息
    """
    current = get_python_version()
    min_ver_str = f"{min_version[0]}.{min_version[1]}"

    if current >= (*min_version, 0):
        return True, f"Python {current[0]}.{current[1]}.{current[2]} (满足要求 >= {min_ver_str})"

    return False, f"Python {current[0]}.{current[1]}.{current[2]} 不满足要求 (需要 >= {min_ver_str})"


def get_upgrade_instructions() -> str:
    """获取各平台的升级指导"""
    system = platform.system().lower()
    current_py = f"{sys.version_info[0]}.{sys.version_info[1]}"

    instructions = []
    instructions.append("=" * 60)
    instructions.append("Python 版本升级指南")
    instructions.append("=" * 60)
    instructions.append(f"\n检测到系统: {platform.system()}")
    instructions.append(f"当前 Python 版本: {current_py}")
    instructions.append(f"所需最低版本: {'.'.join(map(str, MIN_PYTHON_VERSION))}\n")

    if system == "darwin":
        # macOS
        instructions.append("【macOS 升级方法】\n")
        instructions.append("方法1 - 使用 Homebrew (推荐):")
        instructions.append("  brew install python@3.11")
        instructions.append("  # 或安装最新版本:")
        instructions.append("  brew install python\n")
        instructions.append("方法2 - 下载安装包:")
        instructions.append("  访问 https://www.python.org/downloads/mac-osx/")
        instructions.append("  下载并安装 Python 3.11 或更高版本\n")

    elif system == "linux":
        # Linux
        instructions.append("【Linux 升级方法】\n")
        instructions.append("方法1 - apt (Debian/Ubuntu):")
        instructions.append("  sudo apt update")
        instructions.append("  sudo apt install python3.11 python3.11-venv python3.11-dev")
        instructions.append("  # 设置为默认版本:")
        instructions.append("  sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1\n")
        instructions.append("方法2 - yum (RHEL/CentOS):")
        instructions.append("  sudo yum install python3.11")
        instructions.append("  # 或使用 epel:")
        instructions.append("  sudo yum install epel-release")
        instructions.append("  sudo yum install python311\n")
        instructions.append("方法3 - 源码编译安装:")
        instructions.append("  wget https://www.python.org/ftp/python/3.11.0/Python-3.11.0.tgz")
        instructions.append("  tar -xf Python-3.11.0.tgz")
        instructions.append("  cd Python-3.11.0")
        instructions.append("  ./configure --enable-optimizations")
        instructions.append("  make -j$(nproc)")
        instructions.append("  sudo make altinstall\n")

    else:
        # Windows 或其他
        instructions.append("【Windows 升级方法】\n")
        instructions.append("方法1 - 下载安装包 (推荐):")
        instructions.append("  访问 https://www.python.org/downloads/windows/")
        instructions.append("  下载并安装 Python 3.11 或更高版本")
        instructions.append("  安装时勾选 'Add Python to PATH'\n")
        instructions.append("方法2 - 使用 Microsoft Store:")
        instructions.append("  打开 Microsoft Store")
        instructions.append("  搜索 'Python'")
        instructions.append("  安装 Python 3.11 或更高版本\n")
        instructions.append("方法3 - 使用 winget (Windows 10/11):")
        instructions.append("  winget install Python.Python.3.11\n")

    instructions.append("=" * 60)
    instructions.append("升级后请重新打开终端/命令提示符")
    instructions.append("验证版本: python3 --version (或 python --version)")
    instructions.append("=" * 60)

    return "\n".join(instructions)


def try_auto_upgrade() -> tuple[bool, str]:
    """
    自动升级已禁用，出于安全考虑不会自动执行安装命令。
    请按照手动指导升级。

    Returns:
        (success, message): 总是返回False，提示用户手动升级
    """
    return False, "自动升级已禁用，请按照下方指导手动升级 Python"


def _command_exists(cmd: str) -> bool:
    """检查命令是否存在"""
    try:
        if platform.system().lower() == "windows":
            result = subprocess.run(
                ["where", cmd],
                capture_output=True,
                text=True,
                timeout=5
            )
        else:
            result = subprocess.run(
                ["which", cmd],
                capture_output=True,
                text=True,
                timeout=5
            )
        return result.returncode == 0
    except Exception:
        return False


def require_python_version(min_version: tuple[int, int] = MIN_PYTHON_VERSION) -> None:
    """
    检查 Python 版本，不满足则退出并打印升级指南

    Args:
        min_version: 最低版本要求 (major, minor)

    Raises:
        SystemExit: 版本不满足时退出
    """
    is_ok, msg = check_python_version(min_version)

    if is_ok:
        return

    # 打印升级指南
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"错误: {msg}", file=sys.stderr)
    print(f"{'='*60}\n", file=sys.stderr)

    # 尝试自动升级
    auto_success, auto_msg = try_auto_upgrade()

    if not auto_success:
        # 自动升级失败，打印手动升级指南
        print(get_upgrade_instructions(), file=sys.stderr)

    print(f"\n提示: {auto_msg}\n", file=sys.stderr)
    print("请升级 Python 后重新运行此脚本。", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    # 直接运行时打印版本信息和升级指南
    print(f"当前 Python 版本: {sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}")
    print(f"最低要求版本: {'.'.join(map(str, MIN_PYTHON_VERSION))}")

    is_ok, msg = check_python_version()
    print(f"状态: {'满足' if is_ok else '不满足'}")

    if not is_ok:
        print("\n" + get_upgrade_instructions())

"""
Windows 下 cmd/PowerShell 默认代码页常为 GBK（936），Python 会把 stdout/stderr
绑到该编码，导致 print(json.dumps(..., ensure_ascii=False)) 中的中文显示为乱码。
在 main() 开头调用 configure_stdio_utf8()，将标准流设为 UTF-8（与 macOS/Linux 行为接近）。

支持多种回退策略：
1. Python 3.7+: stream.reconfigure(encoding='utf-8')
2. 向底层二进制流包装 TextIOWrapper（兼容 Python 3.6 及更早版本）
3. 设置 PYTHONUTF8 / PYTHONIOENCODING 环境变量（会影响子进程）
"""

from __future__ import annotations

import io
import os
import sys


def configure_stdio_utf8() -> None:
    """将 stdout/stderr 编码设置为 UTF-8，解决 Windows 中文终端乱码问题。"""
    if sys.platform != "win32":
        return

    success = False

    # 策略1: Python 3.7+ 的 reconfigure 方法
    for stream in (sys.stdout, sys.stderr):
        reconf = getattr(stream, "reconfigure", None)
        if callable(reconf):
            try:
                reconf(encoding="utf-8", errors="replace")
                success = True
            except (OSError, ValueError, AttributeError):
                pass

    if success:
        return

    # 策略2: 用 TextIOWrapper 重新包装底层二进制流（兼容 Python 3.6 及更早版本）
    for attr in ("stdout", "stderr"):
        stream = getattr(sys, attr)
        try:
            buffer = getattr(stream, "buffer", None)
            if buffer is None:
                continue
            new_stream = io.TextIOWrapper(buffer, encoding="utf-8", errors="replace", line_buffering=True)
            setattr(sys, attr, new_stream)
        except (OSError, ValueError, AttributeError):
            pass

    # 策略3: 设置环境变量，影响子进程
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

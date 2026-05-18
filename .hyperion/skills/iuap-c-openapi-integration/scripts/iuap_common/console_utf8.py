"""
Windows 下 cmd/PowerShell 默认代码页常为 GBK（936），Python 会把 stdout/stderr
绑到该编码，导致 print(json.dumps(..., ensure_ascii=False)) 中的中文显示为乱码。
在 main() 开头调用 configure_stdio_utf8()，将标准流设为 UTF-8（与 macOS/Linux 行为接近）。
"""

from __future__ import annotations

import sys


def configure_stdio_utf8() -> None:
    if sys.platform != "win32":
        return
    for stream in (sys.stdout, sys.stderr):
        reconf = getattr(stream, "reconfigure", None)
        if callable(reconf):
            try:
                reconf(encoding="utf-8", errors="replace")
            except (OSError, ValueError, AttributeError):
                pass

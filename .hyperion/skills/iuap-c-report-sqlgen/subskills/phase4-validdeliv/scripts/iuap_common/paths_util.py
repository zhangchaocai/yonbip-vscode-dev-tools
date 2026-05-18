"""
Resolve paths for skill assets (under SKILL_DIR) vs writable outputs (under workspace).
Outputs must not default into the skill folder — see config paths.workspace_root.
"""
from __future__ import annotations

import os
import platform
from pathlib import Path

# 【v10.5 修复】SKILL_DIR 应该指向主技能目录 (iuap-c-report-sqlgen/)，而非子技能目录
SKILL_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent
_ENV_WORKSPACE = "YONBIP_REPORT_SQL_WORKSPACE"


def _normalize_path(path_str: str) -> str:
    """
    规范化路径字符串：统一处理 Windows 反斜杠和 Unix 正斜杠。

    YAML/JSON 配置文件中的 Windows 路径可能使用反斜杠（如 D:\\project），
    Python 的 Path 对象可以正确处理，但在某些场景下需要先规范化。
    同时处理 YAML 转义问题（如 \\t 被解析为 tab）。
    """
    if not path_str:
        return path_str
    # 将所有反斜杠替换为正斜杠（pathlib 统一使用正斜杠）
    normalized = path_str.replace("\\", "/")
    # 移除常见的 YAML 转义序列（\t, \n, \r 等不应出现在路径中）
    # 注意：这里只处理真正在 YAML 中被错误解析的情况
    if platform.system() == "Windows":
        # Windows 下确保 drive letter 格式正确
        if len(normalized) >= 2 and normalized[1] == ":":
            # 大写驱动器字母
            normalized = normalized[0].upper() + normalized[1:]
    return normalized


def infer_workspace_root() -> Path:
    """
    Best-effort project root: directory containing .hyperion or .git, else
    parent of the path segment before .../skills/<name>/..., else cwd.
    """
    cwd = Path.cwd().resolve()
    for p in [cwd, *cwd.parents]:
        if (p / ".hyperion").is_dir():
            return p
        if (p / ".git").is_dir():
            return p
    parts = cwd.parts
    if "skills" in parts:
        i = parts.index("skills")
        if i > 0:
            # 使用 Path 的父级而不是 parts[:i].parent，避免 Windows drive letter 问题
            # 例如: ('D:\\', 'Users', 'project', '.claude', 'skills', ...)
            # parts[:i] 会包含 ('D:\\', 'Users', 'project', '.claude')
            # Path(*parts[:i]) 在 Windows 上会正确处理 drive letter
            base_path = Path(*parts[:i])
            return base_path.parent
    return cwd


def workspace_base(cfg: dict) -> Path:
    """
    Directory for output_dir / report_deliverable_dir and other generated files.
    Precedence: env YONBIP_REPORT_SQL_WORKSPACE > paths.workspace_root > infer_workspace_root().
    """
    env = os.environ.get(_ENV_WORKSPACE, "").strip()
    if env:
        normalized = _normalize_path(env)
        p = Path(normalized).expanduser()
        if p.is_absolute():
            return p.resolve()
        else:
            # 相对路径相对于当前工作目录解析
            return (Path.cwd() / p).resolve()

    paths = cfg.get("paths") or {}
    raw = paths.get("workspace_root")
    if raw is not None and str(raw).strip():
        normalized = _normalize_path(str(raw).strip())
        p = Path(normalized).expanduser()
        if p.is_absolute():
            return p.resolve()
        else:
            # 相对路径相对于当前工作目录解析
            return (Path.cwd() / p).resolve()

    return infer_workspace_root()


def resolve_skill_path(relative: str) -> Path:
    """Bundled files shipped with the skill (reference/, scheme json, etc.)."""
    normalized = _normalize_path(relative)
    p = Path(normalized)
    if p.is_absolute():
        return p.resolve()
    return (SKILL_DIR / p).resolve()


def resolve_workspace_path(relative: str, cfg: dict) -> Path:
    """User-generated outputs: relative to workspace_base(cfg), not the skill directory."""
    normalized = _normalize_path(relative)
    p = Path(normalized)
    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (workspace_base(cfg) / p).resolve()
    validate_output_path(resolved)
    return resolved


def validate_output_path(output_dir: Path) -> Path:
    """
    强制校验：交付物目录不得落在技能目录内。

    若 output_dir 是 SKILL_DIR 的子路径，抛出 ValueError。

    返回规范化的输出目录路径。
    """
    resolved = output_dir.resolve()

    # 检查是否为技能目录的子路径
    try:
        resolved.relative_to(SKILL_DIR)
    except ValueError:
        # relative_to 抛异常 → output_dir 不是 SKILL_DIR 的子路径 → 合规
        return resolved

    # 未抛异常 → output_dir 在 SKILL_DIR 内部 → 违规
    raise ValueError(
        f"输出目录禁止位于技能目录内: {resolved}\n"
        f"  技能目录: {SKILL_DIR}\n"
        f"  请确保 paths.workspace_root / report_deliverable_dir 指向工程根目录，"
        f"而非 {SKILL_DIR.name} 技能目录本身。"
    )

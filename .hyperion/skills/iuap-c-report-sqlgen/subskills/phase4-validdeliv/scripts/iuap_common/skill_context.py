"""
与 VS Code 扩展中 globalState「mcp.config」对齐的上下文（tenant 等）解析。

Python 无法直接读取编辑器内存，约定：
1. 扩展将 mcp.config 同步到工作区根目录 .mcp-context.json（或使用 MCP_CONTEXT_FILE）
2. 或设置环境变量 MCP_TENANT / MCP_VERSION / MCP_API_URL 等
3. 或在各技能 config.yaml 的 context 段填写

写入输出的字段不含 apiAppSecret 等敏感信息。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

# 可从配置文件或 .mcp-context.json 读取的键（与扩展 McpConfig 字段名对齐）
_ALL_KEYS = (
    "tenant",
    "version",
    "apiUrl",
    "apiAppKey",
    "apiAppSecret",
    "activeFlagshipProjectId",
    "jarPath",
    "javaPath",
    "maxMemory",
    "metadataByname",
    "metadataByboid",
    "metadataEntityid",
    "metadataUri",
    "businessInterfaceList",
    "businessInterfaceDetail",
    "flagshipProjects",
)

# 写入 stdout / 落盘 JSON 的 skillContext（不含密钥）
_SAFE_OUTPUT_KEYS = (
    "tenant",
    "version",
    "apiUrl",
    "activeFlagshipProjectId",
    "jarPath",
    "javaPath",
    "maxMemory",
    "metadataByname",
    "metadataByboid",
    "metadataEntityid",
    "metadataUri",
    "businessInterfaceList",
    "businessInterfaceDetail",
    "flagshipProjects",
)


def repo_root_from_skill_dir(skill_dir: Path) -> Path:
    """skill_dir = .../skills/<skill-name> → 仓库根 .../mcp"""
    return skill_dir.parent.parent


def _load_json_file(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def _normalize_value(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False)
        return s if s and s not in ("{}", "[]") else None
    s = str(v).strip()
    return s or None


def resolve_mcp_context(cfg: dict, skill_dir: Path) -> Dict[str, Any]:
    """
    合并顺序（后者覆盖前者，仅保留非空字符串）：
    1. config.yaml 的 context 段
    2. 工作区根 .mcp-context.json，或环境变量 MCP_CONTEXT_FILE 指向的 JSON
    3. 环境变量 MCP_TENANT、MCP_VERSION、MCP_API_URL、MCP_ACTIVE_FLAGSHIP_PROJECT_ID
    """
    out: Dict[str, Any] = {}
    ctx = cfg.get("context") or {}
    for k in _ALL_KEYS:
        nv = _normalize_value(ctx.get(k))
        if nv is not None:
            out[k] = nv

    repo = repo_root_from_skill_dir(skill_dir)
    override = os.environ.get("MCP_CONTEXT_FILE", "").strip()
    path = Path(override).expanduser().resolve() if override else (repo / ".mcp-context.json")
    merged = _load_json_file(path)
    if merged:
        for k in _ALL_KEYS:
            nv = _normalize_value(merged.get(k))
            if nv is not None:
                out[k] = nv

    env_map = {
        "tenant": "MCP_TENANT",
        "version": "MCP_VERSION",
        "apiUrl": "MCP_API_URL",
        "activeFlagshipProjectId": "MCP_ACTIVE_FLAGSHIP_PROJECT_ID",
    }
    for key, env_name in env_map.items():
        val = os.environ.get(env_name, "").strip()
        if val:
            out[key] = val

    return out


def skill_context_for_output(raw: Dict[str, Any]) -> Dict[str, Any]:
    """供 JSON 输出的安全子集（不含 appSecret）。"""
    return {k: raw[k] for k in _SAFE_OUTPUT_KEYS if raw.get(k)}


def format_context_markdown(raw: Dict[str, Any]) -> str:
    """人类可读块，拼在文本输出顶部。"""
    pub = skill_context_for_output(raw)
    if not pub:
        return ""
    lines = [
        "",
        "---",
        "**MCP 上下文**（与 VS Code mcp.config / .mcp-context.json 对齐）",
    ]
    order = [
        ("tenant", "租户"),
        ("version", "版本"),
        ("apiUrl", "API 基址"),
        ("activeFlagshipProjectId", "当前旗舰项目"),
        ("metadataByname", "metadataByname"),
        ("metadataUri", "metadataUri"),
    ]
    for key, label in order:
        if pub.get(key):
            lines.append(f"- **{label}** (`{key}`): `{pub[key]}`")
    for k, v in sorted(pub.items()):
        if k in {x[0] for x in order}:
            continue
        lines.append(f"- `{k}`: `{v}`")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def log_context_stderr(raw: Dict[str, Any]) -> None:
    """简要打到 stderr，便于日志与 Agent 工具链。"""
    pub = skill_context_for_output(raw)
    if not pub:
        return
    import sys

    parts = [f"{k}={pub[k]}" for k in ("tenant", "version", "apiUrl") if pub.get(k)]
    if parts:
        print("[skillContext] " + " | ".join(parts), file=sys.stderr)

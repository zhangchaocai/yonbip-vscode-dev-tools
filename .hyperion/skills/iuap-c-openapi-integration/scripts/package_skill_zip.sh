#!/usr/bin/env bash
# 打包技能为可上传的 ZIP：排除 .venv、__pycache__、.pyc、macOS 元数据，避免服务端按 UTF-8
# 解析内容时出现 java.nio.charset.MalformedInputException。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"
PARENT="$(dirname "$SKILL_DIR")"
OUT="${1:-$PARENT/${SKILL_NAME}.zip}"

cd "$PARENT"
rm -f "$OUT"
find "$SKILL_NAME" \( -name .venv -o -name __pycache__ -o -name __MACOSX \) -prune -o \
  -type f ! -name ".DS_Store" ! -name "._*" ! -name "*.pyc" ! -name "${SKILL_NAME}.zip" -print \
  | zip -q -0 "$OUT" -@

echo "Wrote: $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)" >&2

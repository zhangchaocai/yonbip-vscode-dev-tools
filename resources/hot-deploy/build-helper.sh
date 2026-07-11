#!/bin/bash
# 构建热部署助手 JAR
# 用法：cd resources/hot-deploy && ./build-helper.sh
# 产物：resources/hot-deploy/hot-deploy-helper.jar

set -e

cd "$(dirname "$0")"

if [ ! -f HotDeployHelper.java ]; then
    echo "[错误] HotDeployHelper.java 不存在"
    exit 1
fi

JAVAC="${JAVAC:-javac}"
if ! command -v "$JAVAC" >/dev/null 2>&1; then
    echo "[错误] 未找到 javac，请设置 JAVAC 环境变量"
    exit 1
fi

echo "[1/3] 编译 HotDeployHelper.java ..."
"$JAVAC" HotDeployHelper.java
rm -f hot-deploy-helper.jar

echo "[2/3] 打包 hot-deploy-helper.jar ..."
# macOS / Linux 自带 jar；Windows 用户可在 Git Bash / WSL 中运行
if command -v jar >/dev/null 2>&1; then
    jar cf hot-deploy-helper.jar HotDeployHelper.class
else
    # 兜底：用 zip
    if command -v zip >/dev/null 2>&1; then
        zip -q hot-deploy-helper.jar HotDeployHelper.class
    else
        echo "[错误] 未找到 jar 或 zip 命令"
        exit 1
    fi
fi

echo "[3/3] 清理临时文件 ..."
rm -f HotDeployHelper.class

echo "✅ 已生成 hot-deploy-helper.jar"
ls -la hot-deploy-helper.jar
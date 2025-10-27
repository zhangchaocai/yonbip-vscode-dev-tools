#!/bin/bash

# YonBIP Dev Tools Extension 发布脚本

echo "🚀 开始发布 YonBIP Dev Tools Extension..."

# 检查是否已安装 vsce
if ! command -v vsce &> /dev/null
then
    echo "❌ 未找到 vsce 命令，请先安装: npm install -g @vscode/vsce"
    exit 1
fi

# 编译项目
echo "⚙️  编译项目..."
npm run compile

if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查代码错误"
    exit 1
fi

# 打包插件
echo "📦 打包插件..."
vsce package

if [ $? -ne 0 ]; then
    echo "❌ 打包失败"
    exit 1
fi

echo "✅ 插件打包完成，生成的文件: yonbip-devtool-1.2.0.vsix"

# 检查是否有环境变量中的PAT
if [ -n "$VSCE_PAT" ]; then
    echo "🔑 使用环境变量中的PAT进行发布..."
    echo "$VSCE_PAT" | vsce login zhangchck
else
    # 登录并发布（需要手动输入 Personal Access Token）
    echo "🔐 请登录到您的发布者账户..."
    echo "   提示：您需要输入 Personal Access Token"
    echo "   如果还没有，请访问 https://dev.azure.com 创建"
    echo ""
    echo "   执行以下命令登录并发布："
    echo "   1. vsce login zhangchck"
    echo "   2. 输入您的 Personal Access Token"
    echo "   3. vsce publish"
    echo ""
    echo "   或者，如果您已有 PAT，可以设置环境变量后重新运行此脚本："
    echo "   export VSCE_PAT='your-personal-access-token'"
    echo "   ./publish-extension.sh"
    exit 0
fi

if [ $? -ne 0 ]; then
    echo "❌ 登录失败"
    exit 1
fi

# 发布插件
echo "🚀 发布插件..."
vsce publish

if [ $? -ne 0 ]; then
    echo "❌ 发布失败"
    exit 1
fi

echo "🎉 插件发布成功！"
echo "   插件链接: https://marketplace.visualstudio.com/items?itemName=zhangchck.yonbip-devtool"
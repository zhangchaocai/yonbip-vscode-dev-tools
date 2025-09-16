#!/bin/bash

# YonBIP VSCode插件 - Resources加载验证脚本
# 用于检查 HOME 服务启动时是否正确加载 resources/conf 目录

echo "==================================="
echo "YonBIP HOME服务 Resources加载检查"
echo "==================================="

# 检查HOME路径
if [ -z "$1" ]; then
    echo "用法: $0 <HOME路径>"
    echo "示例: $0 /Users/zhangchaocai/Documents/home/20230824"
    exit 1
fi

HOME_PATH="$1"

echo "检查HOME路径: $HOME_PATH"

# 检查HOME路径是否存在
if [ ! -d "$HOME_PATH" ]; then
    echo "❌ HOME路径不存在: $HOME_PATH"
    exit 1
fi

echo "✅ HOME路径存在"

# 检查关键目录和文件
echo ""
echo "检查关键目录和文件："

# 检查core.jar
CORE_JAR_PATHS=(
    "$HOME_PATH/ierp/bin/core.jar"
    "$HOME_PATH/middleware/core.jar"
    "$HOME_PATH/lib/core.jar"
)

CORE_JAR_FOUND=false
for path in "${CORE_JAR_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo "✅ 找到core.jar: $path"
        CORE_JAR_FOUND=true
        break
    fi
done

if [ "$CORE_JAR_FOUND" = false ]; then
    echo "❌ 未找到core.jar文件"
fi

# 检查resources目录
if [ -d "$HOME_PATH/resources" ]; then
    echo "✅ resources目录存在: $HOME_PATH/resources"
    
    # 检查resources/conf目录
    if [ -d "$HOME_PATH/resources/conf" ]; then
        echo "✅ resources/conf目录存在: $HOME_PATH/resources/conf"
        
        # 检查具体配置文件
        if [ -f "$HOME_PATH/resources/conf/login.properties" ]; then
            echo "✅ login.properties文件存在"
            echo "   内容预览:"
            head -3 "$HOME_PATH/resources/conf/login.properties" | sed 's/^/   /'
        else
            echo "⚠️  login.properties文件不存在"
        fi
        
        # 列出conf目录下的所有文件
        echo "   conf目录下的文件:"
        ls -la "$HOME_PATH/resources/conf" | sed 's/^/   /'
        
    else
        echo "❌ resources/conf目录不存在"
    fi
    
    # 列出resources目录结构
    echo ""
    echo "resources目录结构:"
    find "$HOME_PATH/resources" -type d -maxdepth 2 | head -10 | sed 's/^/   /'
    
else
    echo "❌ resources目录不存在: $HOME_PATH/resources"
fi

# 检查ierp/bin/prop.xml
if [ -f "$HOME_PATH/ierp/bin/prop.xml" ]; then
    echo "✅ prop.xml文件存在: $HOME_PATH/ierp/bin/prop.xml"
else
    echo "⚠️  prop.xml文件不存在"
fi

echo ""
echo "==================================="
echo "检查完成"
echo "==================================="
echo ""
echo "如果所有检查都通过，那么VSCode插件现在应该能够："
echo "1. 正确加载resources目录到类路径"
echo "2. 特别加载resources/conf目录"
echo "3. 在登录时读取login.properties等配置文件"
echo ""
echo "如果仍有问题，请检查VSCode插件的启动日志，"
echo "确认是否看到 '📁 添加resources目录' 和 '📁 特别添加resources/conf目录' 的消息。"
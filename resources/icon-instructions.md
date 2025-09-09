# 创建插件图标说明

由于无法直接创建PNG图片文件，您需要手动创建一个插件图标。

## 图标要求
- **尺寸**: 128x128 像素
- **格式**: PNG
- **位置**: `resources/icon.png`
- **设计**: 简洁、专业、与YonBIP品牌相关

## 图标设计建议

### 主要元素
- **主色调**: 蓝色系（#0066CC）或YonBIP品牌色
- **图标内容**: 
  - 字母"Y"或"YB"
  - 工具图标（扳手、齿轮等）
  - 代码符号（</>）

### 设计参考
```
┌─────────────────┐
│                 │
│   ██  ██  ████  │
│    ████   ████  │
│     ██    ████  │
│     ██    ████  │
│                 │
│    <YonBIP/>    │
│                 │
└─────────────────┘
```

## 快速创建方法

### 方法1: 在线工具
1. 访问 https://www.canva.com 或类似设计网站
2. 选择128x128像素画布
3. 添加文字"YB"或"YonBIP"
4. 添加代码或工具相关图标
5. 导出为PNG格式

### 方法2: 使用VSCode
1. 安装"Draw.io Integration"扩展
2. 创建简单的图标设计
3. 导出为PNG

### 方法3: 命令行工具
如果您有ImageMagick，可以使用以下命令创建简单图标：

```bash
# 创建基础图标
convert -size 128x128 xc:#0066CC -fill white -gravity center -pointsize 24 -annotate +0+0 "YB" resources/icon.png
```

## 临时解决方案
如果暂时没有图标，可以先注释掉package.json中的icon行：
```json
// "icon": "resources/icon.png",
```

这样插件仍然可以正常发布，只是会使用默认图标。
# Java项目库初始化功能

## 功能概述

此功能将原IDEA插件中的LibraryUtil.java功能适配到VSCode插件中，实现了Java项目库的自动初始化和配置。

## 使用方法

### 1. 自动初始化

当插件启动时，如果检测到已配置`yonbip.homePath`，将自动初始化Java项目库。

### 2. 手动初始化

可以通过以下方式手动触发库初始化：

#### 命令面板
- 打开命令面板 (`Ctrl+Shift+P` 或 `Cmd+Shift+P`)
- 输入并选择 `YonBIP/库管理: 初始化Java项目库`

#### 侧边栏
- 打开YonBIP开发者工具侧边栏
- 使用相关命令按钮

### 3. 重新初始化

如果需要重新配置库：
- 命令面板中选择 `YonBIP/库管理: 重新初始化Java项目库`

### 4. 检查状态

- 命令面板中选择 `YonBIP/库管理: 检查库状态`

## 支持的库类型

系统会自动识别并配置以下类型的库：

1. **DB_Drive_Library** - 数据库驱动库
2. **Ant_Library** - Ant构建工具库
3. **Product_Common_Library** - 产品公共库
4. **Middleware_Library** - 中间件库
5. **Framework_Library** - 框架库
6. **Extension_Public_Library** - 扩展公共库
7. **Hyext_Public_Library** - Hyext公共库
8. **Module_Public_Library** - 模块公共库
9. **Extension_Client_Library** - 扩展客户端库
10. **Hyext_Client_Library** - Hyext客户端库
11. **Module_Client_Library** - 模块客户端库
12. **Extension_Private_Library** - 扩展私有库
13. **Hyext_Private_Library** - Hyext私有库
14. **Module_Private_Library** - 模块私有库
15. **Module_Lang_Library** - 模块语言库
16. **Generated_EJB** - 生成的EJB库
17. **NCCloud_Library** - NCCloud库
18. **NCCHr_Library** - NCCHr库
19. **resources** - 资源库

## 配置说明

### 必需配置

在VSCode设置中配置：
```json
{
  "yonbip.homePath": "/path/to/your/nchome"
}
```

### 可选配置

如果需要数据库驱动：
```json
{
  "yonbip.mcp.homePath": "/path/to/your/mcp/home"
}
```

## 工作原理

1. **扫描机制**：自动扫描配置的HOME路径下的标准目录结构
2. **去重处理**：自动处理重复jar包，优先选择版本最新的
3. **智能配置**：生成VSCode Java扩展所需的配置文件
4. **路径映射**：将IDEA的库概念映射到VSCode的referenced libraries

## 目录结构

初始化后，在工作区根目录下创建`.lib`目录，包含：
- 各个库的配置文件（*.json）
- 自动生成的VSCode设置更新

## 故障排除

### 常见问题

1. **库初始化失败**
   - 检查HOME路径是否正确配置
   - 确认HOME路径包含必需的目录（bin, lib, modules, hotwebs, resources）

2. **Java项目无法识别库**
   - 检查是否已安装VSCode Java扩展包
   - 重启VSCode窗口

3. **重复jar包问题**
   - 系统会自动处理版本冲突，选择最新版本
   - 如需强制重新配置，使用重新初始化命令

### 调试信息

查看输出面板中的"YonBIP Library Service"通道获取详细日志信息。
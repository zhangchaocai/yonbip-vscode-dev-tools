# YonBIP高级版开发者工具

YonBIP高级版开发者工具是一款专为用友YonBIP平台开发者设计的VS Code插件，集成了MCP服务管理、NC HOME配置、项目管理等功能，帮助开发者更高效地进行YonBIP应用开发。

## 🌟 主要功能

### 1. MCP服务管理
- 内置yonyou-mcp.jar文件（23.87MB），开箱即用
- 一键启动/停止MCP服务
- 智能端口管理和冲突解决
- 实时服务状态监控
- 详细的错误诊断和自动修复

### 2. NC HOME配置管理
- NC HOME路径配置和验证
- 数据源配置管理（支持MySQL、Oracle、SQL Server、PostgreSQL等）
- SysConfig工具集成启动
- JVM参数配置和调试端口设置
- 自动配置更新和权限授权

### 3. 项目管理工具
- 快速创建YonBIP高级版项目
- 标准项目结构生成
- 补丁包导出功能
- 内置代码模板和示例

### 4. 库管理
- Java项目库自动初始化
- 自动生成.classpath和.project文件
- JDK运行时自动配置
- 模块classes路径自动识别

### 5. HOME服务管理
- 一键启动/停止NC HOME服务
- 调试模式支持
- 端口冲突自动检测和解决
- 详细的启动日志输出

### 6. OpenAPI测试工具
- 支持多个OpenAPI配置管理
- 可视化HTTP请求测试
- 支持GET/POST/PUT/DELETE/PATCH等HTTP方法
- JSON格式请求体和响应体展示
- 连接测试功能

## 🚀 安装说明

1. 在VS Code中打开扩展市场
2. 搜索"YonBIP高级版开发者工具"
3. 点击安装按钮
4. 重启VS Code完成安装


## 🛠️ 环境要求

- VSCode 1.74.0+
- Java JDK 8+
- 内存建议4GB+
- 磁盘空间50MB+

## 📖 使用指南

### MCP服务管理
1. 在侧边栏找到"YonBIP高级版开发者工具"面板
2. 点击"MCP服务"选项卡
3. 配置服务端口和其他参数
4. 点击"启动服务"按钮开始使用

### NC HOME配置
1. 在侧边栏找到"NC HOME配置"选项卡
2. 点击"浏览"按钮选择NC HOME安装目录
3. 配置数据源连接信息
4. 保存配置并启动HOME服务

### 项目管理
1. 在侧边栏找到"项目管理"选项卡
2. 使用"创建YonBIP项目"功能初始化新项目
3. 使用"导出补丁包"功能创建补丁

### OpenAPI测试工具
1. 在侧边栏找到"OpenAPI测试"选项卡
2. 在"配置管理"标签页中添加和管理多个API配置
3. 在"请求测试"标签页中选择配置并发送HTTP请求
4. 在"响应结果"标签页中查看API响应


## ⚙️ 配置选项

| 配置项 | 描述 | 默认值 |
|--------|------|--------|
| `yonbip.mcp.port` | MCP服务端口 | 9000 |
| `yonbip.mcp.debug` | 是否启用调试模式 | false |
| `yonbip.mcp.debugPort` | 调试模式端口 | 5005 |
| `yonbip.homePath` | NC Home目录路径 | "" |
| `yonbip.home.debugPort` | NC Home调试模式端口 | 8888 |
| `yonbip.openapi.baseUrl` | OpenAPI测试基础URL | "http://localhost:9000" |
| `yonbip.openapi.headers` | OpenAPI测试默认请求头 | {} |
| `yonbip.openapi.timeout` | OpenAPI测试请求超时时间(毫秒) | 30000 |

## 🔧 常见问题

### macOS权限问题
在macOS上首次启动可能需要额外的Java权限确认，请在系统偏好设置中授权。

### Windows防火墙问题
Windows防火墙可能会阻止Java网络访问，请手动允许相关程序通过防火墙。

### 端口冲突
如果遇到端口占用问题，插件会自动检测并提示解决方案。

## 📞 反馈和支持

如果您在使用过程中遇到任何问题或有功能建议，请通过以下方式联系我们：

- **邮件支持**: zhangchck@yonyou.com

## 📄 许可证

本项目采用MIT许可证，详情请见[LICENSE](LICENSE)文件。

---

感谢您使用YonBIP高级版开发者工具！
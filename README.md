# YonBIP高级版开发者工具

[![VSCode Marketplace](https://img.shields.io/visual-studio-marketplace/v/yonbip-community.yonbip-dev-tools?style=flat-square&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yonbip-community.yonbip-dev-tools)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/yonbip-community.yonbip-dev-tools?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=yonbip-community.yonbip-dev-tools)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/yonbip-community.yonbip-dev-tools?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=yonbip-community.yonbip-dev-tools)

一个专业的VSCode插件，为YonBIP高级版开发者提供完整的开发工具链支持。集成MCP智能服务、OpenAPI测试、多语言抽取、项目管理等核心功能，显著提升开发效率。

![YonBIP开发工具](https://raw.githubusercontent.com/yonbip/vscode-dev-tools/main/resources/demo.gif)

## ✨ 主要特性

### 🌐 OpenAPI测试工具
- **集成测试界面** - 无需外部工具，直接在VSCode中测试API
- **多种HTTP方法** - 支持GET、POST、PUT、DELETE、PATCH等
- **历史记录** - 自动保存请求历史，方便复用
- **认证支持** - 支持多种认证方式配置
- **响应美化** - JSON/XML响应自动格式化显示

### 🚀 MCP服务集成
- **内置JAR文件** - 插件自带yonyou-mcp.jar，开箱即用
- **智能服务管理** - 一键启动/停止MCP服务
- **实时状态监控** - 可视化服务状态显示
- **错误自动诊断** - 智能识别和解决常见问题
- **WebSocket支持** - 实时通信连接

### 🌍 多语言抽取工具
- **智能文本识别** - 从代码中自动识别多语言文本
- **多文件格式支持** - Java、JavaScript、TypeScript、XML等
- **文本过滤清理** - 智能过滤和清理提取的文本
- **资源文件生成** - 自动生成多语言资源文件
- **批量处理** - 支持整个项目的批量处理

### 📦 项目管理工具
- **快速项目创建** - 一键创建YonBIP高级版标准项目
- **项目结构生成** - 自动生成标准目录结构
- **补丁包导出** - 快速导出项目补丁包
- **代码模板** - 内置常用代码模板

### 🗄️ 数据库连接管理
- **多数据库支持** - MySQL、Oracle、SQL Server、PostgreSQL、SQLite
- **可视化配置** - 友好的数据库连接配置界面
- **连接测试** - 一键测试数据库连接
- **状态监控** - 实时显示连接状态

## 🎯 核心优势

### 🛡️ 开箱即用
- **内置依赖** - 所有必要的JAR文件已内置
- **零配置启动** - 安装即可使用，无需复杂配置
- **智能诊断** - 自动检测和解决环境问题

### 🔧 智能化
- **自动端口管理** - 智能检测端口冲突并自动解决
- **错误自愈** - 自动重试和故障恢复机制
- **资源优化** - 自动检测系统资源状态

### 👥 用户友好
- **中文界面** - 完全中文化的用户界面
- **详细日志** - 提供详细的操作日志
- **快捷操作** - 丰富的快捷键和右键菜单

## 🚀 快速开始

### 安装
1. 打开VSCode
2. 进入扩展商店 (Ctrl+Shift+X)
3. 搜索"YonBIP高级版开发者工具"
4. 点击安装

### 使用
1. 安装完成后，在状态栏会显示"YonBIP工具"
2. 点击状态栏图标或使用命令面板 (Ctrl+Shift+P)
3. 选择需要的功能开始使用

## 📋 功能列表

### 命令面板功能
- `YonBIP: 启动MCP服务` - 启动MCP智能服务
- `YonBIP: 停止MCP服务` - 停止MCP服务
- `YonBIP: 打开OpenAPI测试工具` - 打开API测试界面
- `YonBIP: 抽取多语言文本` - 从代码中抽取多语言文本
- `YonBIP: 导出补丁包` - 导出项目补丁包
- `YonBIP: 配置数据库连接` - 配置数据库连接
- `YonBIP: 创建YonBIP项目` - 创建新的YonBIP项目

### 右键菜单功能
- **文件夹右键**: 导出补丁包
- **代码文件右键**: 抽取多语言文本
- **代码选择右键**: 抽取选中文本的多语言

## ⚙️ 配置选项

```json
{
  "yonbip.defaultProjectType": "yonbip",      // 默认项目类型
  "yonbip.defaultAuthor": "Developer",        // 默认作者名称
  "yonbip.patchOutputDir": "./patches",       // 补丁输出目录
  "yonbip.patchFileTypes": [                  // 补丁包含的文件类型
    "源码文件", 
    "资源文件"
  ]
}
```

## 🔧 系统要求

- **VSCode版本**: 1.74.0 或更高
- **Java环境**: JDK 8 或更高版本
- **操作系统**: Windows、macOS、Linux
- **内存**: 建议4GB以上
- **磁盘空间**: 50MB

## 📖 使用示例

### MCP服务使用
```javascript
// 1. 启动MCP服务
// 使用命令面板: YonBIP: 启动MCP服务

// 2. 服务会自动在9000端口启动
// 访问地址: http://localhost:9000/mcp/sse

// 3. 如果遇到端口冲突，插件会自动处理
```

### OpenAPI测试
```javascript
// 1. 打开API测试工具
// 使用命令面板: YonBIP: 打开OpenAPI测试工具

// 2. 配置请求
{
  "method": "POST",
  "url": "http://localhost:9000/api/test",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "name": "test"
  }
}

// 3. 发送请求并查看响应
```

## 🐛 问题排查

### HOME服务启动问题
1. **配置文件加载失败**: 如果登录时报错找不到配置文件，请检查：
   - 确保 `${homePath}/resources/conf/login.properties` 文件存在
   - 检查类路径日志中是否包含 resources 目录
   - 与IDEA插件不同，VSCode插件现在正确支持 resources/conf 加载
2. **类路径检查**: 启动日志中应该看到：
   ```
   📁 添加resources目录: ${homePath}/resources
   📁 特别添加resources/conf目录: ${homePath}/resources/conf
   ✅ 类路径中包含resources相关目录
   ```

### MCP服务启动失败
1. **检查Java环境**: 确保安装了JDK 17
2. **端口冲突**: 插件会自动检测并解决端口冲突
3. **查看日志**: 使用"查看日志"功能获取详细信息

### 连接问题
1. **防火墙设置**: 确保防火墙允许Java程序访问网络
2. **代理设置**: 如果使用代理，请配置相应设置
3. **权限问题**: 确保有足够的文件读写权限

## 🤝 贡献

欢迎提交问题和功能请求！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- YonBIP团队提供的技术支持
- VSCode社区的优秀扩展开发经验
- 所有贡献者和用户的反馈

## 📞 支持

- **邮件支持**: zhangchck@yonyou.com

---

**注意**: 本插件专为YonBIP高级版开发设计，使用前请确保您有相应的开发环境和权限。
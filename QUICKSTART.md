# 快速开始 - VSCode 插件开发

## 🚀 立即测试插件

1. **打开项目**
   ```bash
   cd /Users/zhangchaocai/Documents/project/vscode-plugin
   code .
   ```

2. **启动调试**
   - 按 `F5` 键启动插件调试
   - 这会打开一个新的 VSCode 窗口，插件已自动加载

3. **测试功能**
   - 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac) 打开命令面板
   - 输入以下命令进行测试：
     - `Hello World` - 基础问候
     - `Ask Question` - 交互式问答
     - `Count Characters` - 统计文档字符
     - `Insert Current Time` - 插入当前时间
     - `Convert to Uppercase` - 转换大写

## 📋 插件包含的示例功能

### 基础交互
- ✅ 命令注册和执行
- ✅ 用户输入处理
- ✅ 信息提示显示

### 编辑器集成
- ✅ 文档内容读取
- ✅ 文本选择处理
- ✅ 内容插入和替换

### UI 集成
- ✅ 状态栏项目
- ✅ 命令面板集成
- ✅ 事件监听

## 🛠 开发工作流

1. **修改代码** - 编辑 `src/` 目录下的文件
2. **编译** - 运行 `npm run compile`
3. **重新加载** - 在调试窗口中按 `Ctrl+R` 重新加载插件
4. **测试** - 验证新功能

## 📝 下一步

- 阅读 `README.md` 了解详细功能
- 查看 VSCode 官方文档学习更多 API
- 尝试添加自己的功能

## 🎯 常用开发命令

```bash
# 编译
npm run compile

# 监听模式（自动编译）
npm run watch

# 代码检查
npm run lint

# 打包插件
npx vsce package
```

祝您开发愉快！🎉
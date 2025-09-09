# VSCode插件市场发布指南

## 🎉 恭喜！您的插件已成功打包

### 📦 打包信息
- **文件名**: `yonbip-dev-tools-1.0.0.vsix`
- **文件大小**: 22.86 MB
- **包含文件**: 348个文件
- **内置JAR**: yonyou-mcp.jar (23.87 MB)

## 🚀 发布到VSCode插件市场

### 步骤1: 注册发布者账号

1. **访问Azure DevOps**
   ```
   https://dev.azure.com
   ```

2. **创建个人访问令牌(PAT)**
   - 登录Azure DevOps
   - 点击右上角用户头像 → Personal access tokens
   - 点击"New Token"
   - 设置以下权限:
     - **Name**: VSCode Extension Publishing
     - **Expiration**: Custom defined (建议1年)
     - **Scopes**: Custom defined → Marketplace → **Manage**
   - 复制生成的令牌（只显示一次！）

3. **创建发布者**
   ```bash
   vsce create-publisher your-publisher-name
   ```
   或访问: https://marketplace.visualstudio.com/manage

### 步骤2: 登录vsce

```bash
vsce login your-publisher-name
```
输入刚才生成的PAT令牌

### 步骤3: 发布插件

```bash
vsce publish
```

## 📋 发布前检查清单

### ✅ 必须项目
- [x] **package.json配置完整**
  - [x] name（插件名称）
  - [x] displayName（显示名称）
  - [x] description（描述）
  - [x] version（版本号）
  - [x] publisher（发布者）
  - [x] engines.vscode（VSCode版本要求）
  - [x] categories（分类）
  - [x] keywords（关键词）

- [x] **必要文件存在**
  - [x] README.md（详细说明）
  - [x] CHANGELOG.md（更新日志）
  - [x] LICENSE（许可证）
  - [x] 编译产物（out目录）

- [x] **功能验证**
  - [x] 插件可正常激活
  - [x] 命令可正常执行
  - [x] MCP服务可正常启动
  - [x] 无明显错误

### 🔧 可选改进
- [ ] **插件图标** (128x128 PNG)
- [ ] **演示GIF** (展示功能)
- [ ] **多语言支持** (package.nls.json)
- [ ] **代码优化** (Bundle打包减小体积)

## 💡 发布策略

### 免费发布 ✅
- **完全免费** - VSCode插件市场支持免费插件
- **无费用** - 注册和发布都是免费的
- **开源友好** - 支持MIT许可证

### 许可证选择
- **推荐**: MIT License ✅（已设置）
- **理由**: 
  - 最宽松的开源许可证
  - 商业友好
  - 社区认可度高

### 分类选择
- **主分类**: Development Tools ✅
- **次分类**: Testing ✅
- **其他**: Other ✅

## 📈 发布后推广

### 官方渠道
- **VSCode插件市场** - 自动展示
- **GitHub仓库** - 添加marketplace徽章
- **技术博客** - 发布介绍文章

### 社区推广
- **开发者论坛** - 在YonBIP开发者社区分享
- **技术群组** - 在相关QQ群、微信群分享
- **技术会议** - 在开发者大会上介绍

## 🔄 版本更新流程

### 更新版本
```bash
# 更新版本号
npm version patch  # 0.0.1 → 0.0.2
npm version minor  # 0.0.1 → 0.1.0  
npm version major  # 0.0.1 → 1.0.0

# 重新打包
vsce package

# 发布更新
vsce publish
```

### 自动发布 (可选)
可以设置GitHub Actions自动发布：
```yaml
# .github/workflows/publish.yml
name: Publish Extension
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run compile
      - run: vsce publish -p ${{ secrets.VSCE_PAT }}
```

## 📊 监控和反馈

### 插件统计
- **安装量** - 在marketplace查看
- **评分** - 用户评价反馈
- **下载趋势** - 增长情况

### 用户反馈
- **GitHub Issues** - 问题反馈
- **插件评论** - 用户评价
- **社区讨论** - 论坛讨论

## 🆘 常见问题

### Q: 插件文件太大？
A: 您的插件23MB主要因为内置JAR文件，这是合理的。可以考虑：
- 使用.vscodeignore排除不必要文件
- 代码打包优化（webpack bundle）

### Q: 发布失败？
A: 常见原因：
- PAT令牌权限不足
- package.json配置错误
- 插件名称冲突
- 网络连接问题

### Q: 如何更新插件？
A: 
1. 修改代码
2. 更新版本号
3. 重新编译
4. 执行`vsce publish`

## 🎯 下一步建议

1. **立即发布** - 基础功能已完善，可以发布1.0.0版本
2. **收集反馈** - 发布后收集用户反馈
3. **持续改进** - 根据反馈持续优化
4. **功能扩展** - 逐步添加新功能

---

**恭喜您！插件已准备就绪，可以发布到VSCode插件市场了！** 🎉
# 🔄 重新发布 VSCode 插件指南

## 📋 当前状态检查

- ✅ 插件名称: `yonbip-devtool`
- ✅ 当前版本: `1.0.12`
- ✅ 发布者: `zhangchck`
- ✅ 已安装 vsce: `@vscode/vsce@3.6.2`
- ✅ 已编译项目: `out/` 目录已生成
- ✅ 已打包插件: `yonbip-devtool-1.0.12.vsix` (43.75 MB)

## 🚀 重新发布步骤

### 步骤 1: 更新版本号（可选）

如果您想更新版本号，请选择以下命令之一：

```bash
# 补丁版本更新 (1.0.12 → 1.0.13) - 修复bug
npm version patch

# 次版本更新 (1.0.12 → 1.1.0) - 添加新功能
npm version minor

# 主版本更新 (1.0.12 → 2.0.0) - 重大更新
npm version major
```

### 步骤 2: 重新编译项目

```bash
npm run compile
```

### 步骤 3: 重新打包插件

```bash
vsce package
```

### 步骤 4: 登录发布者账户

```bash
vsce login zhangchck
```

系统会提示您输入 Personal Access Token (PAT)。

如果您还没有 PAT，请按照以下步骤创建：

1. 访问: https://dev.azure.com
2. 登录您的 Microsoft 或 GitHub 账户
3. 点击右上角用户头像 → Personal access tokens
4. 点击 "New Token"
5. 设置:
   - Name: `VSCode Extension`
   - Expiration: `1 year` (或您偏好的时间)
   - Scopes: 选择 "Marketplace (manage)"
6. 复制生成的令牌

### 步骤 5: 发布插件

```bash
vsce publish
```

## 🛠 使用自动化脚本

您也可以使用我们提供的自动化脚本：

```bash
./publish-extension.sh
```

## 📝 发布后验证

发布成功后，您可以访问以下链接验证：

- 插件页面: https://marketplace.visualstudio.com/items?itemName=zhangchck.yonbip-devtool
- 管理页面: https://marketplace.visualstudio.com/manage

## 🆘 常见问题解决

### Q: 发布时提示版本冲突
**A**: 更新版本号后再发布
```bash
npm version patch
vsce package
vsce publish
```

### Q: PAT 令牌过期
**A**: 重新生成 PAT 令牌并登录
```bash
vsce login zhangchck
# 输入新的 PAT 令牌
```

### Q: 插件文件过大警告
**A**: 这是正常的，因为插件包含 yonyou-mcp.jar 文件

### Q: 发布被拒绝，提示需要验证
**A**: Microsoft 可能需要手机号验证，这是正常的安全流程

## 🎯 最佳实践

1. **版本管理**: 遵循语义化版本控制 (SemVer)
2. **变更日志**: 更新 CHANGELOG.md 文件
3. **测试验证**: 发布前确保所有功能正常
4. **文档更新**: 保持文档与功能同步

## 📊 监控和反馈

发布后，请关注：
- 用户评价和评分
- 安装量统计
- 问题反馈
- 功能建议

---

**恭喜！您的插件已准备就绪，可以重新发布了！** 🎉
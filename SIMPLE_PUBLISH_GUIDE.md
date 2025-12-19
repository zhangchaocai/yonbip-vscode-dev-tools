# 📦 VSCode插件发布指南（简化版）

## ✅ **好消息：完全免费！**

VSCode插件发布**100%免费**，不需要Azure DevOps付费账号！

## 🚀 **3步发布流程**

### 步骤1️⃣: 注册Microsoft账号（免费）

访问：https://marketplace.visualstudio.com/manage

点击右上角**"Sign in"**，选择：
- 🔵 **Microsoft账号**（如果您有Outlook/Hotmail邮箱）
- 🟢 **GitHub账号**（推荐，如果您有GitHub）
- 🆕 **注册新账号**（完全免费）

### 步骤2️⃣: 创建发布者（免费）

登录后，页面会提示创建发布者：

```
Publisher ID: zhang-chaocai        (已在您的package.json中设置)
Display Name: 张超才的开发工具
Description: YonBIP开发工具插件
```

### 步骤3️⃣: 获取访问令牌

在发布者页面：
1. 点击 **"Personal Access Tokens"**
2. 点击 **"New Token"** 
3. 设置：
   - Name: `VSCode Extension`
   - Expiration: `1 year`
   - Scopes: 选择 **"Marketplace (manage)"**
4. 复制生成的令牌（只显示一次！）

### 步骤4️⃣: 发布插件

在终端运行：
```bash
# 登录
vsce login zhang-chaocai
# 输入刚才复制的令牌

# 发布
vsce publish
```

## 🎯 **当前状态**

✅ 您的插件已完全准备就绪：
- ✅ 插件包：`yonbip-dev-tools-1.0.0.vsix` (22.99 MB)
- ✅ 功能完整：MCP服务、API测试、多语言抽取
- ✅ 文档齐全：README、CHANGELOG、LICENSE
- ✅ 配置正确：publisher已设置为`zhang-chaocai`

## 🆘 **如果遇到问题**

### Q1: 无法访问marketplace.visualstudio.com
**A**: 可能是网络问题，尝试：
- 使用VPN
- 等待一段时间后重试
- 使用手机热点

### Q2: Publisher名称被占用
**A**: 在package.json中修改publisher为其他名称：
```json
"publisher": "your-name-dev-tools"
```

### Q3: vsce命令不存在
**A**: 重新安装vsce：
```bash
npm install -g @vscode/vsce
```

## 📱 **手机号验证（可能需要）**

Microsoft可能要求手机号验证，这是正常的安全流程：
- 输入您的手机号
- 接收验证码
- 完成验证即可

## 🎉 **发布后**

发布成功后：
1. **插件链接**：`https://marketplace.visualstudio.com/items?itemName=zhang-chaocai.yonbip-dev-tools`
2. **用户安装**：在VSCode中搜索"YonBIP高级版开发者工具"
3. **监控数据**：在管理页面查看下载量、评分等

## 💰 **费用确认**

- ✅ 注册Microsoft账号：**免费**
- ✅ 创建发布者：**免费**  
- ✅ 发布插件：**免费**
- ✅ 用户下载：**免费**
- ✅ 插件更新：**免费**

**没有任何隐藏费用！**

---

**立即开始：** https://marketplace.visualstudio.com/manage 🚀


ovsx publish your-extension.vsix --pat <your-personal-access-token>
---
name: iuap-c-openapi-integration
description: >-
  BIP旗舰版 OpenAPI 动态查询与集成技能。
  【功能】根据接口描述动态查询BIP OpenAPI文档，返回接口URI、请求方式、入参结构、出参结构，并生成标准化调用代码。
  【触发场景】查询XX接口、获取API信息、调用BIP接口、生成API调用代码、封装BIP接口。
  【路由】可由 iuap-c-thirdparty-sync 等技能路由，也可单独触发。
references:
  - name: openapi_integration_spec
    description: OpenAPI集成规范 - 包含代码模板、架构说明、禁止项
    path: ./reference/openapi_integration_spec.md
---

# BIP OpenAPI 动态查询与集成

## 技能定位

```
┌─────────────────────────────────────────────────────────────────────┐
│  路由来源                                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  第三方集成流程                                                     │
│  iuap-c-thirdparty-sync → (需要调用BIP接口时) → 本技能              │
│                                                                     │
│  独立使用                                                          │
│  用户直接请求 → 本技能                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 何时使用

| 用户话术 | 判断 | 结果 |
|---------|------|------|
| "查询XX接口" | ✅ 本技能 | 动态查询API文档 |
| "获取API信息" | ✅ 本技能 | 返回接口定义 |
| "调用BIP接口" | ✅ 本技能 | 查询API + 生成代码 |
| "生成API调用代码" | ✅ 本技能 | 查询API + 生成代码 |
| "封装XX接口" | ✅ 本技能 | 查询API + 生成代码 |

## 执行流程

```
Step 1: 识别接口需求
    │
Step 2: 调用 Python 脚本查询 API 文档
    │
Step 3: 获取接口元信息（URI、请求方式、入参、出参）
    │
Step 4: 按规范生成调用代码（引用 reference/openapi_integration_spec.md）
    │
Step 5: 返回结构化数据
```

---

## API 动态查询

### Python 脚本使用

```bash
cd .claude/skills/iuap-c-openapi-integration/scripts

# 安装依赖（仅首次）
./pip_install.sh

# 单接口查询
./pip_install.sh run business_interface_query.py --config ../config.yaml \
  --all-interface-desc "销售发票列表查询"

# 多接口并行查询
./pip_install.sh run business_interface_query.py --config ../config.yaml \
  --all-interface-desc "销售发票列表查询,采购订单提交" \
  --parallel --max-workers 5

# 带入参关注点
./pip_install.sh run business_interface_query.py --config ../config.yaml \
  --all-interface-desc "销售发票列表查询" \
  --interface-input-hints "组织,客户,分页"
```

### 话术解析

| 配置项 | 从话术识别 | 典型取值 |
|--------|-----------|---------|
| `allInterfaceDesc` | 「XX列表查询接口」「查XX的API」 | `销售发票列表查询` |
| `interfaceInputHints` | 「要传XX」「带XX」 | `组织,客户编码` |

---

## 查询结果结构

```json
{
  "接口名称": "销售发票列表查询",
  "接口地址": "/gateway/resource/bill/saleinvoice/list",
  "请求协议": "HTTPS",
  "请求方式": "POST",
  "入参列表": [
    {
      "参数名": "orgId",
      "参数描述": "组织ID",
      "参数类型": "String",
      "必填": true
    }
  ],
  "出参结构": {
    "code": {"类型": "String", "描述": "响应码"},
    "data": {"类型": "Object", "描述": "数据体"},
    "message": {"类型": "String", "描述": "消息"}
  }
}
```

---

## 代码生成

### 本地类复用检查

```bash
# 搜索本地 BIP API 调用公共类
搜索路径: {引擎名称}-be/dev-{引擎名称}-service/src/main/java/com/yonyou/
搜索关键词: AccessToken、OpenApi、BipApi、Token、鉴权
```

| 组件 | 本地存在 | 本地不存在 |
|------|---------|-----------|
| `AccessTokenUtils` | 复用 | 生成 |
| `OpenApiUtils` | 复用 | 生成 |
| `BipOpenApiUriConst` | 复用 | 生成 |

### 代码规范

> **完整规范见 [reference/openapi_integration_spec.md](reference/openapi_integration_spec.md)**

| 规范项 | 要求 |
|--------|------|
| HTTP客户端 | **必须使用 RestTemplate**，禁止 HttpURLConnection |
| 鉴权 | 通过 `AccessTokenUtils` 获取 AccessToken |
| 配置注入 | 使用 `@Value` 从 YMS 配置中心获取 |
| 入参构建 | 严格按 API 文档，禁止臆想参数名 |
| 出参解析 | 严格按 API 文档，确保数据准确 |

---

## 配置

编辑 `config.yaml` 或使用 `.env` 文件：

```bash
# 在技能目录下创建 .env 文件
API_BASE_URL=https://c1pocpro.yonyoucloud.com/
API_APP_KEY=your_app_key
API_APP_SECRET=your_app_secret
```

---

## 脚本说明

| 脚本 | 作用 |
|------|------|
| `business_interface_query.py` | 主查询逻辑，支持并行、缓存、重试 |
| `iuap_common/bip_auth.py` | Token 管理，含熔断器、限流器 |
| `iuap_common/retry_utils.py` | 重试、熔断器、限流器工具 |
| `iuap_common/secure_config.py` | 安全配置加载 |

---

## 输出格式

```json
{
  "接口地址": "https://api.example.com/orders",
  "请求协议": "HTTP",
  "请求方式": "POST",
  "入参列表": [...],
  "出参结构": {...},
  "代码生成提示": "..."
}
```

---

## 常见问题

### Token 获取失败

检查：
1. `app_key` / `app_secret` 是否正确
2. 成功码应为 `"00000"`（开放平台）
3. 网络连接是否正常

### PEP 668 错误

```bash
# 使用 pip_install.sh 自动管理虚拟环境
./pip_install.sh run business_interface_query.py ...
```

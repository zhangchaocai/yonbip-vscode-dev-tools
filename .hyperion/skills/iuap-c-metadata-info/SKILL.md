---
name: iuap-c-metadata-info
description: >-
  查询旗舰版业务对象元数据：根据中文单据名称解析业务对象，返回 schema、表名、数据库列名、字段属性、枚举值、参照结构和子表信息。这是生成代码场景的核心依赖工具，适用于获取元数据、单据字段、表结构、实体属性、参照结构、子表、特征组等场景；仅生成报表 SQL 除外（请使用 iuap-c-report-sqlgen）。
# 调用本工具时自动执行 scripts/pip_install.sh run …（结果在返回 JSON 的 scriptRun 字段；参数名会转为 CLI 的 --kebab-case，与 ultimate_metadata_query.py 一致）
auto-run-script:
  script: scripts/pip_install.sh
  args:
    - run
    - ultimate_metadata_query.py
    - --config
    - ../config.yaml
  include_tool_params: true
parameters:
  type: object
  properties:
    allbillname:
      type: string
      description: 中文单据/元数据名称，多个用英文逗号分隔（可与 config.yaml 的 request 叠加）
    modulename:
      type: string
      description: 模块名称或编码（可选）
    isIncludeSub:
      type: string
      description: >-
        Y/N，是否包含子实体/子表。为 Y 时走完整 HTTP 链（byname → byboid → 逐实体 queryByUri），不使用「仅一次 queryByUri」的本地快速索引捷径；
        侧栏多 URI 选定后须与 queryUri、allbillname 同传。用户未明确提到子表/明细等时一般为 N。
    docFields:
      type: string
      description: 字段显示名过滤，逗号分隔（可选）
    isDescField:
      type: string
      description: Y/N（可选）
    isSQL:
      type: string
      description: Y/N，为 Y 时对参照类属性拉取 referenceStructure（可选）
    tableTemplate:
      type: string
      description: 报表表头模板字符串（可选）
    queryUri:
      type: string
      description: >-
        元数据实体 uri。索引多义时用户选定后写入此项并再次调用。
        isIncludeSub=N 时可仅填 queryUri（单次 queryByUri 直查主实体）。
        isIncludeSub=Y 时必须与 allbillname 同传（或 queryByUri 响应能解析到 boId）：脚本用所选 uri 锚定业务对象并走 byboid 拉取主表+子表全量实体。
---

# 旗舰版元数据查询（iuap-c-metadata-info）

## 何时使用

- 用户需要**单据/实体的字段结构、表名、schema、数据库列名、枚举、参照**。
- 典型话术：「销售订单有哪些字段」「这个单据主表叫什么」「元数据里客户字段对应哪一列」等。
- **区分**：查业务**接口 URL/入参**请用 `iuap-c-openapi_integration`；生成报表 SQL 请用 `iuap-c-report_sql_gen`。

## 新特性

### 环境变量支持

配置文件中支持 `${ENV_VAR}` 和 `${ENV_VAR:-default}` 语法：

```yaml
api:
  base_url: "${API_BASE_URL:-https://c1pocpro.yonyoucloud.com/}"
  app_key: "${API_APP_KEY}"
  app_secret: "${API_APP_SECRET:-f8acf6e9bd1e8640d5ce5af98e83d3d10454ef3c}"

metadata_api:
  query_by_uri_path: "/iuap-api-gateway/${YONBIP_TENANT_ID:-q6shbpxc}/..."
```

常用环境变量：
- `API_BASE_URL`: API 基础地址
- `API_APP_KEY`: 应用 Key
- `API_APP_SECRET`: 应用密钥（敏感信息）
- `YONBIP_TENANT_ID`: 租户 ID（网关前缀）
- `ENV_NAME`: 环境名称（development/staging/production）
- `ENV_DEBUG`: 调试模式（true/false）

**快速配置**：编辑 [.env](.env) 并填入实际值。

### 限流配置

```yaml
rate_limit:
  enabled: true
  requests_per_second: 10.0
  burst_capacity: 20.0
```

### 环境区分

```yaml
environment:
  name: "${ENV_NAME:-development}"
  debug: "${ENV_DEBUG:-false}"
```

## 配置

编辑本技能目录下的 [config.yaml](config.yaml)。

| 段 | 含义 |
|----|------|
| `api.*` | 开放平台 `base_url`、`app_key`、`app_secret`、`path_token`、超时与 TLS（token 成功码 **`00000`**）。支持环境变量。 |
| `metadata_api.*` | 四条 GET 路径：`query_by_uri_path`、`search_by_name_path`、`entity_list_by_bo_id_path`、`entity_info_by_entity_id_path`。支持环境变量。 |
| `paths.scheme_info_json` | 参照 schema 映射文件，默认 [reference/scheme-info.json](reference/scheme-info.json)。 |
| `request.*` | 查询参数：`allbillname`、`queryUri`（多义/直查时）、`modulename`、`isIncludeSub`、`docFields`、`isDescField`、`isSQL`、`tableTemplate`。 |
| `output.*` | 可选落盘最后一次运行文本。 |
| `rate_limit.*` | 限流配置：`enabled`、`requests_per_second`、`burst_capacity`。 |
| `cache.*` | 缓存配置：`enabled`、`ttl_seconds`、`max_entries`。 |
| `environment.*` | 环境配置：`name`、`debug`。 |

## 从用户话术解析 `request`（Agent 必做）

| 配置键 | 含义 | 默认 |
|--------|------|------|
| `allbillname` | 中文单据/元数据名称，多个**英文逗号**分隔；与 `queryUri` 二选一或同传 | 与 `queryUri` 二选一（见下） |
| `queryUri` | 元数据实体 `uri`。**多义**：同一 `bizName` 对应多条 URI 时脚本**停止**并列出候选；选定后把本字段设为所选 uri 再调。**直查**：`isIncludeSub=N` 时可只传 `queryUri`（单次 queryByUri）。**含子表**：`isIncludeSub=Y` 且多义续查时须 **`allbillname` + `queryUri` 同传**（或响应含 boId），内部走 byboid 全量实体而非单次直查 | 空 |
| `modulename` | 模块名称或编码 | 空（预留） |
| `isIncludeSub` | 【严格判断】是否包含子实体或子表。判断规则（按优先级）：1. 如果用户话术**明确包含**'子表'、'子实体'、'明细'、'分录'、'行'、'body'、'entry'等关键词之一，则返回Y；2. 如果用户话术**完全没有提到**上述关键词，或者**不确定**是否包含子表，或者**只提到主表/主实体**，则**必须返回N**；3. **重要提示**：默认情况（无明确子表关键词）下必须返回N，不要推测 | `N` |
| `docFields` | 字段**显示名**过滤，逗号分隔 | 空 |
| `isDescField` | 用户是否单独描述了字段；为 `N` 时**忽略** `docFields` | `N` |
| `isSQL` | `Y` 时对参照类属性拉取 `referenceStructure` | `N` |
| `tableTemplate` | 报表表头模板字符串，用于参照扩展列匹配 | 空 |

### allbillname 业务对象识别规则

业务对象名称通常包含以下结构化后缀，AI 应能根据用户话术中的关键词匹配正确的 `allbillname`：

| 识别模式 | 话术关键词 | 典型取值 |
|----------|-----------|----------|
| **单据主表/表头** | 「销售订单」「采购订单」「发货单」 | `销售订单`, `采购订单表头`, `发货单主表` |
| **单据明细/子表** | 「明细」「详情」「分录」 | `销售订单明细`, `发货单详情`, `单据分录表` |
| **自定义项** | 「自定义项」 | `销售订单自定义项`, `单据子表自定义项` |
| **自定义特征** | 「自由项」「特征」 | `物料自由项特征`, `计划项目自定义特征` |
| **变更单** | 「变更」 | `销售订单变更`, `合同变更单据表`, `状态变更单表` |
| **历史库** | 「历史」 | `优质优价历史库表头`, `业务变更历史` |
| **申请单** | 「申请」 | `要货申请`, `退租申请`, `出口退税申请单` |
| **确认单** | 「确认」 | `应收确认规则`, `收入确认单`, `入库确认` |
| **调整单** | 「调整」 | `销售成本结转调整`, `信用调整单`, `资产调整事项` |
| **计划单** | 「计划」 | `资金计划编制单`, `LRP计划运行`, `目标库存计划` |
| **台账** | 「台账」 | `固定资产台账`, `金融融资台账`, `支出台账` |
| **报表** | 「报表」 | `渠道统计日报表`, `国资委报表` |
| **看板** | 「看板」 | `费用预算看板`, `服务运营看板` |
| **汇总** | 「汇总」 | `销售汇总表`, `年末汇兑损益汇总预测` |
| **关联关系** | 「关联」「关系」 | `供应商关系管理配置`, `分包管理关联合同表` |

## 工作流

1. **安装依赖**

   ```bash
   cd skills/iuap-c-metadata-info/scripts && ./pip_install.sh
   ```

2. **填写 `.env` 或 `config.yaml`**：配置 API 认证信息。`.env` 文件会自动加载。

3. **执行主脚本（HTTP 元数据链）**

   ```bash
   # 方式一：使用 pip_install.sh run（自动管理环境）
   ./pip_install.sh run ultimate_metadata_query.py --config ../config.yaml --allbillname "销售订单"

   # 方式二：手动激活虚拟环境后执行
   source .venv/bin/activate
   python ultimate_metadata_query.py --config ../config.yaml --allbillname "销售订单"
   ```

   多个单据：`--allbillname "销售订单,采购订单"`。其余参数可写在 `request` 段或用命令行覆盖（见 `--help`）。若输出中出现「停止」和多条候选 **uri**，说明本地索引多义，请由用户确认后**再次**执行并传入 `queryUri`（命令行示例：`--query-uri aa.ct.BizScene`）或让插件在 `request` 中带上 `queryUri`。

4. **快速索引多义**（`metadata_lookup.json`）：当同一 `bizName` 对应多条不同实体 URI 时，不得自动合并，必须等用户选择后再用 `queryUri` 重试，否则字段会串单、结果错误。

5. **含子表**（`isIncludeSub=Y`）：不采用「索引命中后单次 `queryByUri`」的直查捷径，数据按 **searchByName → getEntityListByBOId →（按实体）queryByUri** 拉齐；若 BO 树未带齐子实体，会从父实体 JSON 的 **composition 关联**（`associationAttributes`）再拉子实体 `typeUri`。若本地索引对同一单据名仍有多条 URI，会先**停止并列出候选**，用户选定后须 **`allbillname` + `queryUri` + `isIncludeSub=Y`** 再调；成功时输出前缀含 `已按 queryUri 锚定业务对象并拉取含子表的全量实体`。

## 脚本说明

| 脚本 | 作用 |
|------|------|
| [scripts/ultimate_metadata_query.py](scripts/ultimate_metadata_query.py) | 读配置；鉴权；searchByName → getEntityListByBOId → getEntityInfo… → queryByUri；解析为 `entities` JSON。 |
| [scripts/metadata_core.py](scripts/metadata_core.py) | HTTP 调用与 JSON 解析。 |
| [scripts/bip_auth.py](scripts/bip_auth.py) | `get_access_token`、`http_get_json`。 |

## Windows 控制台中文

若 PowerShell/cmd 中打印的元数据 JSON 中文乱码，脚本已在入口将标准输出设为 UTF-8；落盘结果在 Windows 上使用带 BOM 的 UTF-8。仍异常时可设置 `PYTHONUTF8=1` 或执行 `chcp 65001` 后再运行。

## 常见问题

### PEP 668 错误（externally-managed-environment）

**症状**：`pip install` 报错 "externally-managed-environment"，这是系统 Python 防止破坏全局环境的保护机制。

**解决**：

- **如果你还没有虚拟环境**：`pip_install.sh` 脚本会**自动**在 `scripts/.venv` 创建虚拟环境，无需手动操作：
  ```bash
  ./pip_install.sh run ultimate_metadata_query.py ...
  ```

- **如果你已经激活了虚拟环境**（如 conda、venv 等）：可以直接跳过自动创建，直接运行：
  ```bash
  # 确认已在虚拟环境中
  which python
  # 直接安装依赖
  pip install -r requirements.txt
  # 直接运行脚本
  python ultimate_metadata_query.py ...
  ```

- **如果你想手动创建**：
  ```bash
  cd scripts
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  ```

### Token 获取失败

检查：
1. `API_APP_KEY` / `API_APP_SECRET` 是否正确配置在 `.env`
2. 成功码应为 `"00000"`（开放平台）
3. 网络连接是否可达 `API_BASE_URL`

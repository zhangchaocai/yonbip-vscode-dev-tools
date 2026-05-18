---
name: iuap-c-report-phase1-reqmeta
description: >
  旗舰版报表 SQL 生成 - 阶段一：需求分析与元数据获取。
  提取业务对象、报表字段、筛选条件，拉取主子表元数据 + 推理参照实体。
  当用户提到「报表」「生成SQL」「根据Excel生成报表」「语义模型sql」「语义模型」 时触发。
tags:
  - bip
  - report
  - sql
  - metadata
  - phase1
version: 1.6.0
---

# 阶段一：需求分析与元数据获取

> 本技能是报表 SQL 生成流程的第一阶段，负责解析用户需求、拉取主子表元数据、推理参照实体。

## 阶段目标

1. 提取业务对象（单据）中文名称
2. 提取报表显示字段清单
3. 提取筛选条件需求
4. 拉取主子表元数据（entities.json）
5. **【强制】推理并拉取所有关联参照表的元数据**

---

## 🚨 【强制执行】步骤 1 + 2 + 3 必须全部完成！

> ⚠️ **常见错误**：只完成步骤1就进入阶段2，导致参照表缺失、字段猜测
>
> **正确做法**：
> 1. `fetch_metadata.py` → 拉取主表元数据
> 2. `infer_refs.py` → 推理需要哪些档案表
> 3. `fetch_metadata.py --query-uri` → 查询档案表元数据
>
> **验证方法**：`entities.json` 中必须包含 `org_orgs`、`bd_material` 等参照表

---

## ⚠️ 强制要求：必须同时拉取参照表元数据

**常见参照表遗漏问题**：

| 主表字段 | 参照表 | 常用字段 |
|---------|-------|---------|
| `department` | org_orgs | 部门编号、名称 |
| `iProductid` | bd_material | 物料编码、名称 |
| `iCustomerId` | merchant | 客户编码、名称 |
| `iSupplierId` | supplier | 供应商编码、名称 |
| `iWarehouseId` | aa_warehouse | 仓库编码、名称 |

**拉取方式**：

```bash
# 一次性拉取多个业务对象
python fetch_metadata.py \
  --allbillname "材料出库单,组织档案,物料档案" \
  --lookup-json reference/metadata_lookup.json
```

## 输入

用户需求，可能是：
- 自然语言描述（如"帮我生成销售订单汇总报表"）
- Excel 报表模板附件

## 步骤 1：解析用户需求

### Excel 输入处理

```bash
SKILL_DIR="scripts"
# 解析 Excel 模板
python $SKILL_DIR/parse_excel.py /path/to/报表模板.xlsx
```

### 自然语言输入处理

从用户话术中提取业务对象名称，使用**严格等值匹配**。

### 输出产物

- 主业务对象名称：`XXX`
- 报表显示字段清单：`[字段1, 字段2, 字段3, ...]`
- 筛选条件清单：`[条件1, 条件2, ...]`

## 步骤 2：拉取主子表元数据

### 执行 fetch_metadata.py

```bash
# 方式一：按业务对象名称查询（推荐）
python $SKILL_DIR/fetch_metadata.py \
  --allbillname "业务对象名称" \
  --lookup-json reference/metadata_lookup.json

# 方式二：按 URI 直接查询（已知 URI 时使用，最优性能）
python $SKILL_DIR/fetch_metadata.py --query-uri "uri.path.BusinessObject"

# 方式三：一体化按需获取（从 Excel 提取列头，自动匹配参照）
python $SKILL_DIR/fetch_metadata.py \
  --allbillname "销售订单" \
  --excel-file /path/to/报表模板.xlsx \
  --excel-sheet-index 0 \
  --lookup-json reference/metadata_lookup.json
```

### fetch_metadata.py 执行决策树（v8.5）

```
收到 allbillname="XXX"
│
├─ 是否有 --query-uri？
│   ├─ 是 → 直接 queryByUri API → 【结束】（完全绕过搜索，最优）
│   └─ 否 ↓
│
├─ 【v8.5 新增】检查 FastLookup（metadata_lookup.json）
│   ├─ 精确命中 → 获取 URI + schema → queryUri 路径 → 【结束】
│   │   （schema 合并到结果，缓存到 Redis）
│   └─ 无命中 ↓
│
├─ 检查 Redis byname 索引
│   ├─ 命中 → queryUri 路径 → 【结束】
│   └─ 无命中 ↓
│
├─ searchByName API → 获取主实体信息（code/id/uri/parent_id）
│
└─ byboid + getEntityInfoByBOIdAndEntityId 路径 → 获取 schema → 【结束】
    （schema 信息缓存到 Redis）
```

> **【v8.5 重要】** FastLookup 命中时，schema 直接从 metadata_lookup.json 获取，无需额外 API 调用。

### 元数据输出

```json
{
  "entities": [...],           // 所有实体（主表、子表）
  "attributes": [...],         // 所有字段属性
  "referenceStructure": [...], // 参照结构（仅在 expandRefs 参数时获取）
  "foreignKeys": [...]         // 外键关系
}
```

其中 `entities` 中的每个实体包含 `entityType` 字段标识类型：
- `main`：主实体（业务对象的主表，如"差旅费报销单主表"）
- `sub`：业务子实体（业务对象的子表，如"差旅费报销单借款核销"等）

> **过滤规则**：
> - `_dcs` 表：自动过滤，不合并到结果中
> - 审批相关实体：表名含 `ibpmcurrentauditor`/`ibpmstep` 或 billName 含"审批"的实体，自动过滤
> - 参照实体变体表（`_fi_loc`、`_feature`、`_character_define`）：自动过滤
> - 默认只查询主子表，不查询参照实体
> - 多个业务对象可能共用同一张物理表（如个人借款单和对公预付单都使用 `znbz_loanbill`）

## 步骤 3：推理参照实体（强制执行）

> **【v8.5 重要】** 无论是否有 Excel 文件，步骤 3 都必须执行，除非用户明确说不需要参照关联。

### 3.1 使用 ref-inference 子技能推理

```bash
# 推理参照实体（必须执行）
python subskills/ref-inference/scripts/infer_refs.py \
  --excel "/path/to/报表模板.xlsx" \
  --entities "output/entities.json" \
  --output "output/inferred_refs.json"
```

### 3.1.5 字段含 URI 的展开（补充）

当元数据字段本身携带 URI（如 `referenceStructure.refUri`）时，需要直接展开该 URI：

- 场景：字段的 `referenceStructure` 中包含业务对象 URI
- 处理：从元数据中提取所有字段的 `referenceStructure.refUri`，与步骤 3.1 结果合并去重
- 结果：最终参照 URI 列表 = `infer_refs.py返回` ∪ `字段携带URI`

```python
# 伪代码
inferred_uris = set(inferred_refs.json中所有refUri)
for entity in entities:
    for attr in entity.attributes:
        if attr.referenceStructure and attr.referenceStructure.refUri:
            inferred_uris.add(attr.referenceStructure.refUri)
```

### 3.2 子技能返回格式

```json
{
  "success": true,
  "excelHeaders": ["单据类型", "单据编号", ...],
  "refEntities": [
    {
      "entityName": "个人借款单",
      "entityUri": "znbzbx.personalloanbill.PersonalLoanBillVO",
      "fieldName": "供应商",
      "fieldColumn": "pk_supplier",
      "refBillName": "供应商",
      "refUri": "aa.vendor.Vendor",
      "refTable": "bd_supplier",
      "refSchema": "iuap_apdoc_coredoc",
      "idField": "id",
      "nameField": "name",
      "codeField": "code"
    },
    ...
  ]
}
```

### 3.3 根据推理结果查询参照实体元数据

从子技能返回的 `refEntities` 数组中提取唯一 `refUri` 列表，并与步骤 3.1.5 中字段携带的 URI 合并后，调用 fetch_metadata.py 查询：

```bash
# 查询参照实体元数据（使用 --query-uri 批量查询）
python $SKILL_DIR/fetch_metadata.py \
  --query-uri "aa.vendor.Vendor,bd.staff.Staff,bd.adminOrg.AdminOrgVO"
```

> **注意**：
> - `--query-uri` 支持逗号分隔的多个 URI，会批量查询并合并结果
> - 使用 `--query-uri` 时，会跳过旧索引合并，避免实体数量膨胀
> - 查询结果**追加**到 `output/entities.json`，不会覆盖主子表元数据

### 3.4 参照实体 Schema 补全

当参照实体的元数据中 `schema` 为空时，会自动尝试补全：

1. **优先级一**：从 FastLookup（metadata_lookup.json）中查找 URI 对应的 schema
2. **优先级二**：使用内置的参照实体 schema 映射表（fallback）

```python
# 常见参照实体 schema 映射（fallback）
ref_schema_fallback = {
    "bd.currencytenant.CurrencyTenantVO": "iuap_apdoc_basedoc",
    "bd.staff.Staff": "iuap_apdoc_basedoc",
    "aa.vendor.Vendor": "iuap_apdoc_coredoc",
    "org.func.BaseOrg": "iuap_apdoc_basedoc",
    "bd.adminOrg.AdminOrgVO": "iuap_apdoc_basedoc",
    "aa.merchant.Merchant": "iuap_apdoc_coredoc",
    "bd.project.ProjectVO": "iuap_apdoc_coredoc",
    "bd.costcenter.costCenter": "iuap_apdoc_basedoc",
    ...
}
```

> **重要**：参照实体的 schema 信息必须补全，否则阶段三生成的 SQL 会缺少 schema 前缀。

## 输出文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `entities.json` | `output/` | 完整元数据 JSON（含主子表 + 参照实体） |
| `inferred_refs.json` | `output/` | 推理出的参照实体列表 |
| `report_sql_context.md` | `output/` | AI 使用的上下文摘要 |

## 传递到阶段二

阶段一完成后，以下信息需要传递给阶段二：

1. **元数据文件路径**：`output/entities.json`
2. **业务对象名称**：如 `销售订单`
3. **报表字段清单**：如 `["单据编号", "单据日期", "客户名称", ...]`
4. **筛选条件**：如 `["日期范围", "组织", ...]`
5. **参照实体推理结果**：`output/inferred_refs.json`

## 禁止事项

- ❌ 将 Excel 中首行首格值当作业务对象名称
- ❌ 使用子串模糊匹配
- ❌ 跳过步骤 3 推理参照实体（除非用户明确说不需要）
- ❌ 遗漏参照实体的 schema 信息

## 下一步

将以下信息传递给 **阶段二（iuap-c-report-phase2-fieldana）**：
- 元数据文件路径：`output/entities.json`
- 业务对象名称
- 报表字段清单
- 参照实体推理结果：`output/inferred_refs.json`

## 附录：4 个元数据 API 说明

### API 概览

| API | 用途 | domain | schema | 说明 |
|-----|------|--------|--------|------|
| **searchByName** | 按名称搜索业务对象 | ❌ 无 | ❌ 无 | 返回 code/id/uri/parent_id |
| **getEntityListByBOId** | 获取实体列表 | ⚠️ null | ❌ 无 | 返回实体 ID 列表 |
| **getEntityInfoByBOIdAndEntityId** | 获取实体详情 | ✅ 有 | ✅ 有 | **返回完整信息（含 schema）** |
| **queryByUri** | 通过 URI 获取完整元数据 | ✅ 有 | ❌ 无 | 返回字段定义 |

### API 调用参数要求

**getEntityInfoByBOIdAndEntityId 必须参数：**
```
entityId: 子级实体 ID（searchByName 返回的子对象 id）
uri: 子级实体 URI
boId: 父级 BO ID（searchByName 返回的父对象 id）
businessObjectCode: 父级 BO code（searchByName 返回的父对象 code）
```

### schema 获取机制

```
主实体 schema 获取流程：
  1. searchByName → 获取 code/id/uri/parent_id
  2. 检查 FastLookup 是否有 schema
     ├─ 有 schema → queryUri 路径（快速）
     └─ 无 schema → byboid + getEntityInfoByBOIdAndEntityId 路径
  3. getEntityInfoByBoIdAndEntityId → 返回包含 schema 的完整数据

参照实体 schema：
  - 从 queryByUri 返回数据中获取（可能为 null）
  - 如需完整 schema，需单独调用 getEntityInfoByBOIdAndEntityId
  - 【v8.5】infer_refs.py 会自动补全参照实体 schema

### 【v10.4 优化】businessProperties 特征字段补全

getEntityInfoByBOIdAndEntityId 接口返回的 `businessProperties.characterFields` 信息现在会被补全到实体属性中：

1. **parse_entity_model_for_ai** 函数现在会提取：
   - `allColumns`：特征字段的列定义（含 db_column_name、displayName、type）
   - `isCharacterField`：标记为特征字段

2. **biz_table_group_to_entity_map** 函数会：
   - 收集 `character_fields_info` 中的特征字段信息
   - 将特征字段的列定义（dbColumnName、displayName、type）补充到 `attrs_out`
   - 自动处理参照类型的 `referenceStructure`

3. **效果**：
   - 特征表（如 `storeprorecord_character_define_1`）的 vcol1、vcol2 等字段能被完整获取
   - 无需额外调用 API 补全特征字段元数据
```

### Redis 缓存策略

1. **进程内对象缓存**：零解析开销，最快路径
2. **进程内 JSON 缓存**：已序列化的 JSON 字符串
3. **Redis 缓存**：`{API_BASE_URL}/{TENANT_ID}/{URI}` → 跨进程共享
4. **磁盘缓存**：本地持久化，防止 Redis 失效

> **重要**：缓存到 Redis 的数据必须包含 schema 信息，才能用于后续 SQL 生成。

### 缓存层级

```
查询优先级：
  1. 进程内对象缓存 → 零解析，最快
  2. 进程内 JSON 缓存 → 已序列化
  3. Redis 缓存 → 跨进程共享
  4. 磁盘缓存 → 本地持久化
  5. API 请求 → 最后兜底
```

## 流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│  阶段一：需求分析与元数据获取                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ⚠️ 【检查清单】进入阶段二前必须全部完成！                          │
│                                                                     │
│  步骤1：解析用户需求                                                │
│    ├─ Excel 文件 → parse_excel.py → 提取业务对象 + 报表字段        │
│    └─ 自然语言 → 提取业务对象名称（严格等值匹配）                   │
│                                                                     │
│  步骤2：拉取主子表元数据                                            │
│    └─ fetch_metadata.py --allbillname "业务对象1,业务对象2,..."     │
│       → output/entities.json（主子表实体）                          │
│                                                                     │
│  步骤3：【🔴 不可跳过】推理参照实体并拉取元数据                     │
│    ├─ 3.1 infer_refs.py → output/inferred_refs.json               │
│    ├─ 3.1.5 提取字段携带的URI（补充）                             │
│    ├─ 3.2 合并去重 refUri 列表                                    │
│    └─ 3.3 fetch_metadata.py --query-uri "uri1,uri2,..."           │
│       → output/entities.json（追加参照实体）                        │
│                                                                     │
│  ✅ 验证点：entities.json 包含 org_orgs/bd_material 等参照表       │
│                                                                     │
│  输出：                                                             │
│    ├─ output/entities.json      # 完整元数据（含主子表+参照）       │
│    ├─ output/inferred_refs.json # 参照实体推理结果                 │
│    └─ output/report_sql_context.md # AI 上下文摘要                  │
│                                                                     │
│  ↓ 传递给阶段二                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---
name: iuap-c-report-phase2-fieldana
description: >
  旗舰版报表 SQL 生成 - 阶段二：字段分析与预处理。
  逐个分析字段来源（主表/参照表/子表/特征表/平行表），执行特征表校验。
  当用户提供元数据后需要分析字段映射时触发。
tags:
  - bip
  - report
  - sql
  - metadata
  - phase2
version: 1.0.0
---

# 阶段二：字段分析与预处理

> 本技能是报表 SQL 生成流程的第二阶段，负责分析每个字段的来源和类型。

## 阶段目标

- 建立完整的「字段映射表」
- 识别每个字段属于哪种表类型（主表/参照表/子表/特征表/平行表）
- 执行特征表校验（当存在 character_define 时）
- **字段预检验**：基于元数据校验映射表中的每个字段是否真实存在
- **WHERE 字段校验**：确保筛选条件字段出现在 SELECT 中

## 输入

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 元数据 JSON | 阶段一 output/entities.json | 完整业务对象元数据 |
| 业务对象名称 | 阶段一传递 | 如 "销售订单" |
| 报表字段清单 | 阶段一传递 | 如 `["单据编号", "客户名称"]` |

## 步骤 3：逐个字段来源分析

> ⚠️ **强制要求**：字段分析必须依赖元数据，禁止猜测！

对**每个**报表字段逐个执行以下分析：

### 分析动作

| 动作 | 操作 |
|------|------|
| 1 | 在元数据 `entities[].attributes[]` 中通过 `displayName` **精确匹配或模糊匹配**该字段 |
| 2 | **必须使用匹配到的字段对象中实际返回的 `dbColumnName`**，不能猜测、推断、拼接驼峰命名 |
| 3 | 记录匹配结果的：`displayName`、`tableName`、`schema`、`dbColumnName`、`referenceStructure`、`enums` |
| 4 | 根据 `tableName` 判断字段类型 |
| 5 | 记入「字段映射表」 |

### 字段匹配规范（强制）

```
【禁止】AI 猜测 dbColumnName
  ✗ 看到"资金组织" → 猜测字段名是 source_org
  ✗ 看到"协议号" → 猜测字段名是 protocolnumber
  ✗ 看到"物料编码" → 猜测字段名是 material_code
  ✗ 根据中文含义自行推断驼峰命名

【必须】使用元数据返回的实际值
  ✓ 在 entities.json 中找到 displayName="资金组织id" 的字段
  ✓ 取其 dbColumnName = "accentity"
  ✓ 在字段映射表中记录: 资金组织id → accentity

【必须】参照字段需要 JOIN 参照表
  ✗ st_materialouts.material_code (不存在!)
  ✓ st_materialouts.iProductid (物料ID) → JOIN bd_material 获取物料编码
```

### ⚠️ 常见错误：直接使用参照字段

很多字段（如物料编码、部门名称）不是主表/子表的直接字段，而是**参照字段**：

| 场景 | 错误做法 | 正确做法 |
|-----|---------|---------|
| 物料编码 | `st_materialouts.material_code` | `JOIN bd_material ON ...` |
| 部门名称 | `st_materialout.dept_name` | `JOIN org_orgs ON ...` |
| 客户名称 | `po_order.customer_name` | `JOIN merchant ON ...` |

**处理方式**：在字段映射表中标注为「参照字段」，需要单独 JOIN 参照表。

### 多字段匹配时的处理

当 `displayName` 模糊匹配到多个字段时：
1. 优先选择 `tableName` 等于主表或子表名的字段
2. 优先选择 `dbColumnName` 非空的字段
3. 如果仍有歧义，在字段映射表中标注「待确认」并列出所有候选

### 字段类型判定规则

| 判定条件 | 字段类型 | 处理方式 |
|---------|---------|---------|
| `tableName` === 主表 `tableName` | 主表字段 | 直接取 `dbColumnName` |
| `tableName` 包含 `character_define` | 特征表字段 | 必须 JOIN 对应特征表 |
| `tableName` 包含 `parallel` | 平行表字段 | JOIN 平行表，关联 `主表.id = 平行表.id` |
| `referenceStructure` 不为空 | 参照表字段 | JOIN 参照档案表 |
| `tableName` 在其他 `entities[].tableName` 中存在 | 子表字段 | JOIN 子表，关联 `主表.id = 子表.外键字段` |

### 字段映射表模板

```markdown
| 序号 | 报表字段 | displayName匹配 | tableName | schema | dbColumnName | 字段类型 | 参照信息 |
|------|---------|----------------|-----------|--------|-------------|---------|---------|
| 1 | 单据编号 | 单据编号 | po_order | scm_purchase | bill_no | 主表字段 | - |
| 2 | 客户名称 | 客户 | po_order | scm_purchase | iCustomerId | 参照字段 | iuap_apdoc_coredoc.merchant.cName |
| 3 | 物料编码 | 物料编码 | po_order_detail | scm_purchase | material_code | 子表字段 | - |
| 4 | 采购特征 | 采购特征 | po_order_character_define_1 | scm_purchase | cDefineAtt14 | 特征表字段 | - |
```

## 步骤 4：特征表校验（条件执行）

**仅当存在特征表字段时执行**（`tableName` 包含 `character_define`）

### 校验流程

1. 查找特征组虚拟表名（从元数据 `entities` 中）
2. 生成特征表校验 SQL
3. 执行 `db_query.py` 获取 `real_table`/`real_column`
4. 更新「字段映射表」使用真实表名

### 校验 SQL 模板

```sql
SELECT field.real_table, field.real_column, field.field_name, field.comment
FROM {schema}.elastic_object obj
LEFT JOIN {schema}.elastic_field field ON obj.id = field.object_id
WHERE obj.table_name = '{特征组虚拟表名}'
  AND field.ytenant_id = '{YONBIP_TENANT_ID}'
```

### 特征表关联规则

> **特征表名 = 字段自身的 `tableName`**（不是特征组虚拟表名！）

```
元数据中 field.tableName = "orders_character_define_1"
  → JOIN: uorders.orders_character_define_1  ← 正确，使用字段的tableName
  → JOIN: uorders.orders_character_define     ← 错误！使用了特征组虚拟表名
```

关联条件：`主表.特征组ID字段 = 特征表.id`

## 步骤 3.5：字段预检验

> ⚡ **强制要求**：字段映射表生成后，必须基于业务对象元数据进行校验

### 校验脚本

使用 `field_verify.py`（合并 phase1 + phase2 能力）执行校验：

```bash
# 方式1：校验映射表中的字段是否在元数据中存在
python scripts/field_verify.py --entities output/entities.json --mapping output/字段映射表.md

# 方式2：同时执行 WHERE 字段 → SELECT 校验
python scripts/field_verify.py --entities output/entities.json --mapping output/字段映射表.md --check-where

# 方式3：从 Excel 提取字段并验证元数据（字段发现）
python scripts/field_verify.py --entities output/entities.json --excel 报表模板.xlsx

# 方式4：完整校验（字段发现 + 映射表 + WHERE）
python scripts/field_verify.py --entities output/entities.json --mapping output/字段映射表.md --check-where --excel 报表模板.xlsx
```

### 校验逻辑

1. **元数据字段校验**：遍历字段映射表的每一行，验证 `tableName.dbColumnName` 是否在 `entities.json` 中真实存在
2. **模糊匹配推荐**：字段不存在时，使用 Levenshtein 编辑距离（≤2）推荐相似字段
3. **WHERE 字段校验**：提取「筛选条件」区域的字段，检查是否出现在 SELECT 报表字段中
4. **隐含字段跳过**：`dr`、`ytenant_id`、`ts` 等平台隐含字段不参与 WHERE 校验

### 校验伪代码

```
对于 字段映射表中 每行 (报表字段, tableName, dbColumnName):
    在 entities.json 中找到 tableName 对应的实体
    在实体的 attributes 中查找 dbColumnName
    如果找到了 → 标记为 ✅ 已匹配
    如果没找到 → 使用 Levenshtein 推荐相似字段，标记为 ❌ 未匹配
```

### 校验失败示例

```
❌ 发现 2 个未匹配的字段:

  ❌ 字段: mainid
     表: st_storeprorecords
     原因: 在元数据 attributes 中未找到 dbColumnName='mainid'
     提示: 实际的子表关联字段是 'iMainId'（带前缀 i）
     操作: 请在元数据中重新搜索正确的字段

  ❌ 字段: period
     表: st_storeprorecord
     原因: 在元数据 attributes 中未找到 period 字段
     提示: 实际的日期字段是 'vouchdate'
     操作: 请在元数据中重新搜索正确的字段
```

### 校验通过后才进入阶段3

- ✅ 所有字段都已在元数据中匹配到 → 进入阶段3
- ❌ 有未匹配字段 → 修正字段映射表后重新校验

## 步骤 3.6：WHERE 字段 → SELECT 校验

> ⚡ **强制要求**：字段映射表中的「筛选条件」字段必须出现在SELECT报表字段中

### 校验背景

SQL语义要求：WHERE条件引用的字段必须在SELECT中出现（非聚合场景）。此校验在字段分析阶段提前发现问题，避免到阶段三构建SQL后才暴露问题。

### 校验规则

| WHERE字段情况 | 处理方式 |
|--------------|---------|
| 在SELECT报表字段中 | ✅ 通过 |
| 是聚合函数内部字段（如SUM的字段） | ✅ 通过（不显式出现在SELECT也可） |
| 既不在SELECT也不在聚合中 | ❌ 报错，提示添加到SELECT或修改WHERE |

### 校验方式

```bash
# 单独执行 WHERE 字段校验
python scripts/field_verify.py --mapping output/字段映射表.md --check-where

# 同时执行元数据校验 + WHERE 字段校验
python scripts/field_verify.py --entities output/entities.json --mapping output/字段映射表.md --check-where
```

### 校验流程

1. 从字段映射表「筛选条件」区域提取所有字段引用（如 `hdr.dr`, `ast.customer`）
2. 从字段映射表「字段映射」区域提取所有报表字段
3. 检查每个WHERE字段是否在报表字段中出现
4. 如有缺失，输出缺失字段及修复建议

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `字段映射表.md` | 完整的字段类型分析结果 |
| `entities_updated.json` | 特征表真实表名已更新的元数据 |

## 字段类型速查

| 字段类型 | 识别方式 | 处理规则 |
|---------|---------|---------|
| **主表字段** | `tableName` = 主表 `tableName` | 直接取 `dbColumnName` |
| **参照表字段** | 存在 `referenceStructure` | **必须用** `referenceStructure.scheme + referenceStructure.tableName` 构建 JOIN 表名，禁止使用 `uri` 字段作为数据库表名 |
| **枚举字段** | 存在 `enums` 数组 | 必须用 `CASE WHEN` 将 code 转换为 name |
| **特征表字段** | `tableName` 含 `character_define` | 必须 JOIN 对应的特征表 |
| **平行表字段** | `tableName` 含 `parallel` | JOIN 平行表，关联 `主表.id = 平行表.id` |
| **子表字段** | 其他 `tableName`，且在 entities 中存在独立子表实体 | JOIN 子表，关联 `主表.id = 子表.外键字段` |

### 参照字段 JOIN 表名构建示例

```
正确：
  referenceStructure.scheme = "iuap_apdoc_coredoc"
  referenceStructure.tableName = "merchant"
  → JOIN 表名：iuap_apdoc_coredoc.merchant

错误（禁止）：
  uri = "aa.merchant.Merchant"  ← 这是BIP平台URI格式，不是数据库表名！
  → 错误写法：aa.merchant.Merchant.merchant
```

## 禁止事项

- ❌ **猜测 `dbColumnName`**：看到中文字段名后自行推断英文驼峰命名，必须使用元数据返回的实际值
- ❌ 臆造不存在的字段或 `dbColumnName`
- ❌ 跳过特征表校验（当存在 character_define 时）
- ❌ 使用特征组虚拟表名而非字段自身的 tableName
- ❌ **使用 `uri` 字段作为数据库表名**：`uri` 是 BIP 平台接口格式（如 `aa.merchant.Merchant`），必须使用 `referenceStructure.scheme + referenceStructure.tableName`（如 `iuap_apdoc_coredoc.merchant`）

## 下一步

将以下信息传递给 **阶段三（iuap-c-report-phase3-sqlbuild）**：
- 字段映射表
- 更新的元数据（entities_updated.json）
- 主表信息（schema、tableName、uri）

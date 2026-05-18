---
name: iuap-c-report-sqlgen
description: >
  旗舰版报表 SQL 生成技能。根据业务对象元数据生成标准报表 SQL。
  采用四阶段子技能架构：需求分析→字段分析→SQL构建→校验交付。
  输出纯 SQL 文件与说明文档分离。 当用户提到「报表」「生成SQL」「根据Excel生成报表」「语义模型sql」「语义模型」 时触发。
tags:
  - bip
  - report
  - sql
  - metadata
  - yonbip
version: 8.0.0
---

# 旗舰版报表 SQL 生成

> 详细规范见各阶段子技能 SKILL.md

---

## 🚨 【强制执行】必须严格按4个阶段执行，禁止跳过！

| 阶段 | 职责 | 输出文件 | 禁止行为 |
|:---:|------|---------|---------|
| 阶段一 | 需求分析 + 元数据获取 | entities.json | 只拉元数据不进入阶段二 |
| 阶段二 | 字段来源分析 + 字段映射表 | 字段映射表.md | 跳过字段验证 |
| 阶段三 | SQL构建 + JOIN组装 | {报表名}.sql | 臆造字段 |
| 阶段四 | AI自检 + 校验 | 最终交付 | 不校验就交付 |

> ⚠️ **常见错误**：跳过阶段直接生成SQL，导致字段猜测、参照表缺失

---

## 一、整体流程

```
┌─────────────────────────────────────────────────────────────────────┐
│  报表 SQL 生成流程（iuap-c-report-sqlgen）                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  【阶段一】需求分析与元数据获取  subskills/phase1-reqmeta/          │
│    → 解析 Excel/话术，提取业务对象/字段/筛选条件                   │
│    → 执行 fetch_metadata.py 拉取元数据                               │
│    → 输出: output/entities.json, output/字段映射表.md              │
│    ↓                                                                │
│  【阶段二】字段分析与预处理  subskills/phase2-fieldana/             │
│    → 逐个字段来源分析（主表/参照/子表/特征/平行）                   │
│    → 特征表校验（遇 character_define 时）                          │
│    → 输出: output/字段映射表.md                                     │
│    ↓                                                                │
│  【阶段三】SQL 构建  subskills/phase3-sqlbuild/                    │
│    → 按顺序构建 JOIN（主表→特征→平行→参照→子表）                   │
│    → 枚举字段 CASE WHEN 转换                                       │
│    → 输出: report_sql_output/{报表名}.sql                          │
│    ↓                                                                │
│  【阶段四】校验与交付  subskills/phase4-validdeliv/                │
│    → AI 自检（10 项检查清单）                                       │
│    → db_query.py 执行校验（硬性门禁）                               │
│    → 输出: report_sql_output/{报表名}.sql + _说明.md               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 二、阶段详解

### 阶段一：需求分析与元数据获取

**职责**：解析用户需求，提取业务对象和字段，拉取元数据

**输入**：
- Excel 报表模板（可选）
- 自然语言需求（可选）
- 业务对象名称

**脚本调用**：
```bash
# 方式一：Excel 引导
python subskills/phase1-reqmeta/scripts/parse_excel.py /path/to/模板.xlsx
python subskills/phase1-reqmeta/scripts/fetch_metadata.py \
    --allbillname "材料出库单" \
    --lookup-json reference/metadata_lookup.json

# 方式二：一体化（推荐）
python subskills/phase1-reqmeta/scripts/fetch_metadata.py \
    --allbillname "材料出库单" \
    --excel-file /path/to/模板.xlsx \
    --lookup-json reference/metadata_lookup.json
```

> **路径说明**：`--lookup-json` 支持两种格式：
> - 相对于子技能目录：`reference/metadata_lookup.json`
> - 相对于项目根目录：`.claude/skills/iuap-c-report-sqlgen/subskills/phase1-reqmeta/reference/metadata_lookup.json`

**输出**：
- `output/entities.json` - 完整元数据
- `output/report_sql_context.md` - AI 上下文摘要
- `output/字段映射表.md` - 字段映射表（初稿）

**传递到阶段二**：元数据路径、业务对象名称、报表字段清单

---

### 阶段二：字段分析与预处理

**职责**：分析每个字段的来源和类型，建立完整字段映射表

**输入**：
- `output/entities.json`
- 业务对象名称
- 报表字段清单

**分析规则**：

| 字段类型 | 判定条件 | 处理方式 |
|---------|---------|---------|
| 主表字段 | `tableName` = 主表 | 直接取 `dbColumnName` |
| 参照表字段 | 存在 `referenceStructure` | JOIN 参照档案表 |
| 子表字段 | `tableName` 在 entities 中存在 | JOIN 子表 |
| 特征表字段 | `tableName` 含 `character_define` | JOIN 特征表（需校验） |
| 平行表字段 | `tableName` 含 `parallel` | JOIN 平行表 |

**枚举字段**：存在 `enums` 数组时，必须生成 `CASE WHEN` 转换

**输出**：
- `output/字段映射表.md` - 完整字段映射

---

### 阶段三：SQL 构建

**职责**：根据字段映射表生成完整 SQL

**输入**：
- `output/字段映射表.md`
- `output/entities.json`

**JOIN 顺序（强制）**：
1. FROM 主表
2. LEFT JOIN 特征表
3. LEFT JOIN 平行表
4. LEFT JOIN 参照表
5. LEFT JOIN 子表

**Schema 规则**：
| 位置 | schema 来源 |
|------|------------|
| FROM 主表 | `entities[].schema` |
| JOIN 参照表 | `referenceStructure.scheme` |
| JOIN 子表 | 子表实体的 `schema` |

**输出**：
- `report_sql_output/{报表名}_{时间戳}.sql`
- `report_sql_output/{报表名}_说明_{时间戳}.md`

---

### 阶段四：校验与交付

**职责**：AI 自检 + 数据库校验 + 最终交付

**步骤 1：AI 自检清单**（必须逐项检查）

| 序号 | 检查项 |
|:--:|--------|
| 1 | 所有表名都使用 `schema.tableName` 格式 |
| 2 | 特征表使用字段自身的 `tableName` |
| 3 | WHERE 包含租户过滤 `ytenant_id = 'var$(租户id)'` |
| 4 | 只添加用户明确要求的筛选条件 |
| 5 | 所有枚举字段已添加 CASE WHEN |
| 6 | 所有字段来自元数据，无臆造 |
| 7 | 字段别名使用双引号包裹中文 |
| 8 | JOIN 顺序符合规范 |
| 9 | SQL 语法正确 |
| 10 | 如用语义脚本参数，使用 Freemarker `<#if>` |

**步骤 2：数据库校验**（硬性门禁）

```bash
python subskills/phase4-validdeliv/scripts/db_query.py \
    --sql-file report_sql_output/{报表名}.sql
```

- `var$(租户id)` 自动替换为 `YONBIP_TENANT_ID`
- 校验失败 → 修正 SQL → 回到步骤 1

**步骤 3：交付输出**

| 文件 | 要求 |
|------|------|
| `{报表名}.sql` | 无 Markdown 围栏，可直接复制执行 |
| `{报表名}_说明.md` | 不内嵌完整 SQL |

## 三、快速开始

### 场景一：完整流程（推荐）

```bash
# 1. 阶段一：解析 Excel + 拉取元数据
python subskills/phase1-reqmeta/scripts/fetch_metadata.py \
    --allbillname "材料出库单" \
    --excel-file /path/to/报表模板.xlsx \
    --lookup-json reference/metadata_lookup.json

# 2. 阶段二：根据元数据生成字段映射表（AI 自动执行）

# 3. 阶段三：根据字段映射表生成 SQL（AI 自动执行）

# 4. 阶段四：校验 + 交付
python subskills/phase4-validdeliv/scripts/db_query.py \
    --sql-file report_sql_output/{报表名}.sql
```

### 场景二：分阶段执行

| 用户需求 | 触发 |
|---------|------|
| "帮我生成材料出库单报表" | 完整流程 |
| "元数据已拉取，帮我分析字段" | 阶段二 |
| "字段映射表已建好，帮我生成 SQL" | 阶段三 |
| "SQL 已生成，帮我校验交付" | 阶段四 |

## 四、交付物规范

```
report_sql_output/
├── {报表名}_20260506_120000.sql    # SQL 文件
└── {报表名}_说明_20260506_120000.md  # 说明文档
```

## 五、配置要点

**环境变量**（`.env`）：
```ini
API_BASE_URL=https://your-domain.yonyoucloud.com/
API_APP_KEY=your_app_key
API_APP_SECRET=your_app_secret
YONBIP_TENANT_ID=your_tenant_id
DB_ENABLED=true
DB_DRIVER=mysql
DB_HOST=your_db_host
DB_PASSWORD=your_db_password
```

**FastLookup 索引**（可选）：
```yaml
paths:
  metadata_lookup_json: subskills/phase1-reqmeta/reference/metadata_lookup.json
```

## 六、阶段间上下文传递

### 阶段一 → 阶段二

| 传递项 | 来源 | 说明 |
|--------|------|------|
| 元数据路径 | `output/entities.json` | 完整业务对象元数据 |
| 业务对象名称 | 用户输入 | 如 "材料出库单" |
| 报表字段清单 | Excel/话术 | 如 `["物料名称", "消耗数量"]` |

### 阶段二 → 阶段三

| 传递项 | 来源 | 说明 |
|--------|------|------|
| 字段映射表 | `output/字段映射表.md` | 完整字段类型分析 |
| 主表信息 | 元数据提取 | schema、tableName、uri |

### 阶段三 → 阶段四

| 传递项 | 来源 | 说明 |
|--------|------|------|
| SQL 文件 | `report_sql_output/{报表名}.sql` | 未校验的完整 SQL |
| 说明文档 | `report_sql_output/{报表名}_说明.md` | 说明文档骨架 |

## 七、错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 阶段一：元数据拉取失败 | 提示用户检查网络/API 配置 |
| 阶段二：字段无法匹配 | 在字段映射表中标注「未匹配」，需用户确认 |
| 阶段三：JOIN 关联错误 | 修正关联条件 |
| 阶段四：校验失败 | 根据错误信息修正 SQL，回到阶段一重新自检 |

## 八、子技能位置

| 阶段 | 子技能目录 | 说明 |
|:---:|-----------|------|
| 阶段一 | `subskills/phase1-reqmeta/` | 有脚本（fetch_metadata.py 等） |
| 阶段二 | `subskills/phase2-fieldana/` | 纯 AI 分析 |
| 阶段三 | `subskills/phase3-sqlbuild/` | 纯 AI 分析 |
| 阶段四 | `subskills/phase4-validdeliv/` | 有脚本（db_query.py） |

## 九、禁止事项

- 生成 SQL 后不校验就交付
- 在技能目录内生成交付物（应在工程根目录）
- 遗漏 `ytenant_id = 'var$(租户id)'` 租户过滤
- `database.enabled: false` 时声称已校验
- 置信度=low 时不做确认直接使用

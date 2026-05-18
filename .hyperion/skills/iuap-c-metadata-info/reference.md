# 参考：API 与输出结构

## HTTP 调用顺序（与 Java 一致）

1. **searchByName**（`metadata_api.search_by_name_path`）：`key` = 单据名称 → 得到 `code`、`id`（boId）。
2. **getEntityListByBOId**（`metadata_api.entity_list_by_bo_id_path`）：`boId`、`businessObjectCode` → 实体树（含 `children`）。
3. **getEntityInfoByBOIdAndEntityId**（`metadata_api.entity_info_by_entity_id_path`）：补全 schema、`businessProperties` 等（需 `entityId`）。
4. **queryByUri**（`metadata_api.query_by_uri_path`）：按实体 `uri` 拉取库表字段结构；内部对特征组/平行表等会再次按 uri 请求。

### `isIncludeSub=Y`（含子表）

- **不用**「仅对主 uri 调用一次 queryByUri」的本地快速索引直查；必须经步骤 2 展开主实体与子实体，再对**每个**实体 uri 执行步骤 4。
- 若步骤 2 的 `children` 树未包含明细实体，脚本会再从父实体 queryByUri 的 **`associationAttributes`** 中查找 **`association.type` = composition**，对其 **`typeUri`** 递归 queryByUri（与旗舰版 Report V2 工具一致）。
- 本地 `metadata_lookup.json` 对同一单据名命中**多条不同 uri** 时仍会**停止并输出候选**；续查须传 **`allbillname` + `queryUri`（所选）+ `isIncludeSub=Y`**：实现上先对 `queryUri` 调 queryByUri 解析 `businessObjectId`，再调步骤 2～4。
- **`isIncludeSub=N`** 且仅传 `queryUri` 时，可只执行单次 queryByUri（歧义选定后的轻量续查）。

成功码：业务 JSON 内 `code` / `resultCode` 为 **`200`**（与元数据接口一致；勿与开放平台 token 的 `00000` 混淆）。

## 输出文本格式

与 Java 相同：先输出固定说明行，再输出 **`{"entities":[...]}`** JSON 字符串，最后为字段说明段落。

每个实体块含：`tableName`、`billName`、`domain`、`uri`、`businessObjectCode`、`schema`、`attributes`（及可选 `foreignKeys`）。`attributes` 项含 `name`、`displayName`、`dbColumnName`、`type`、`tableName`、`enums`、`uri`；当 `isSQL=Y` 时可有 `referenceStructure`（含 `scheme`、`tableName`、`attributes` 等）。

## 环境差异

网关路径中的租户段（如 `bes6o00m/current_yonbip_default_sys`）必须以实际部署为准，可从运行中的 MCP `app.yml` 的 `ultimate.metadata_*` 复制到本技能 `config.yaml`。

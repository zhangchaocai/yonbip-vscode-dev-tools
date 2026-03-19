# 配置说明

本文档展示技能的配置方式。

## allowed-tools 配置

`allowed-tools` 是一个字符串数组，用于指定技能执行时必须调用的 MCP 工具。

### 示例

```yaml
allowed-tools:
  - getUltimateMetadataInfo
  - getIBillQueryRepository
  - getOpenApiCall
```

### 执行流程

1. 用户调用 skill
2. 系统自动执行 `allowed-tools` 中的所有工具
3. 工具执行结果会附加在返回结果中
4. AI 根据指令和工具结果完成后续任务

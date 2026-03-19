---
name: "example-skill"
description: "示例技能：展示如何定义一个用户自定义技能。当用户需要创建自定义技能时可以参考此示例。"
triggers:
  - 示例技能
  - 创建技能
allowed-tools: []
hidden: true
---

# 示例技能

这是一个用于展示如何创建自定义技能的示例文件。

## 功能说明

此技能展示了用户自定义技能的基本结构，包括：

1. **技能名称** (name)：技能的唯一标识
2. **技能描述** (description)：供 AI 理解技能的用途
3. **触发词** (triggers)：自然语言触发匹配的关键词
4. **允许工具** (allowed-tools)：技能执行时必须调用的 MCP 工具列表

## YAML Front Matter

文件开头的 `---` 区域是 YAML 格式的元数据：

- `name`: 技能名称（必须唯一）
- `description`: 技能描述，建议说明技能功能和适用场景
- `triggers`: 可选的触发词列表，用于自然语言匹配
- `allowed-tools`: 可选的 MCP 工具列表，执行时会自动调用

## Instructions

在 `## Instructions` 之后编写技能的详细指令内容。

AI 会根据这些指令来执行相应的任务。

### 使用提示

1. 将此文件复制到 `.hyperion/skills` 目录
2. 修改 name、description 和 instruction 为您自己的内容
3. 如需自动调用 MCP 工具，在 allowed-tools 中添加工具名
4. 保存后插件会自动加载新的技能

### Reference 文档

您可以在 reference 目录下创建额外的参考文档：

- [API 文档](./reference/api.md)
- [配置说明](./reference/config.md)


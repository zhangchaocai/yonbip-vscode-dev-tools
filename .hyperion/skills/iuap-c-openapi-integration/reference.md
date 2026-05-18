# BIP OpenAPI 集成技能 — Reference 引用

本技能整合了两个专业的API对接框架作为 Reference，提供完整的BIP API调用流程。

## Reference 文件清单

| 文件 | 来源 | 用途 |
|------|------|------|
| [bip_api_calling_framework.md](reference/bip_api_calling_framework.md) | bip_base_api_skill | BIP标准API调用框架：鉴权模块、HTTP调用模块、响应解析模块 |
| [openapi_integration_spec.md](reference/openapi_integration_spec.md) | openapi_integ_skill | OpenAPI集成公共规范：分层架构、异常处理 |

## 如何使用 Reference

1. **查询接口定义**：使用本技能（iuap-c-openapi_integration）查询业务接口URL、入参出参结构
2. **调用BIP接口**：参考 `bip_api_calling_framework.md` 获取完整调用流程（鉴权、HTTP调用、响应解析）
3. **集成第三方API**：参考 `openapi_integration_spec.md` 了解分层架构和异常处理

---

本技能主流程写在 [SKILL.md](SKILL.md)。

## 输出说明

脚本默认不写入文件；开启 `output.write_result_json` 后可在 `paths.output_dir` 查看最近一次运行的文本摘要（含 `interface_input_hints` 解析后的列表）。

## 入参解析

入参关注点由 Agent 从话术写入 `request.interface_input_hints`（或 `--interface-input-hints`），脚本在详情元数据中做名称/描述子串匹配，详见 SKILL「从用户话术解析并注入 request」。

# 模型思考强度兼容性研究计划

## 主问题

Alpha Studio 管理端应当如何依据模型和上游协议，只提供真实受支持的思考/推理强度选项，并为常见模型提供可靠默认值？

## 子课题

1. **OpenAI 与 OpenAI-compatible Responses**
   - 核验 OpenAI 当前标准模型支持的 `reasoning.effort` 枚举、默认值和模型差异。
   - 区分标准公开 API 能力与 Codex 私有/动态目录能力。

2. **Anthropic Claude 与 Google Gemini 原生 API**
   - 核验 Claude extended/adaptive thinking 和 Gemini thinking level/budget 的真实枚举。
   - 判断能否安全映射为 Alpha Studio 的统一档位，以及网关当前是否实际转译这些参数。

3. **火山方舟及常见中国模型**
   - 核验 DeepSeek、GLM、Doubao、Qwen、Kimi 等常见模型在官方 API 中是否支持可枚举的思考强度，还是仅支持开关/固定思考模式。
   - 给出保守的模型匹配预设和默认值。

## 综合方式

以官方一手文档为准，形成“模型匹配规则 → 可选档位 → 默认档位 → 协议转译”的能力表。实现时，已知模型自动套用预设；未知自定义模型保留手动配置，并在后端再次校验，避免管理端展示与实际请求能力不一致。

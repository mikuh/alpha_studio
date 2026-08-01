# Alpha Studio 多模型网关

Alpha Studio 对 Codex CLI 始终暴露 OpenAI Responses API：

```text
Codex CLI -> POST /v1/responses -> Alpha Studio adapter -> 上游模型服务
```

当前 Codex 的自定义 provider 只支持 `wire_api = "responses"`。因此，不论上游使用 OpenAI Responses、Chat Completions、Anthropic Messages 还是 Gemini `generateContent`，客户端都只连接 Alpha Studio 的 `/v1` Base URL，协议差异由服务端处理。

## 已支持的上游协议

| 上游协议 | `apiFormat` | 典型服务 | 转换范围 |
| --- | --- | --- | --- |
| OpenAI Responses | `responses` | OpenAI、Azure OpenAI、OpenRouter Responses 代理 | 模型别名、非流式上游、Codex SSE 输出 |
| OpenAI Chat Completions | `chat_completions` | DeepSeek、Qwen、Kimi、GLM、SiliconFlow、Ollama 等 | system/developer、文本/图片、function/custom 工具调用与结果、用量、常见 reasoning 字段 |
| Anthropic Messages | `anthropic_messages` | Anthropic Claude、Anthropic-compatible 代理 | system、文本/图片、tool_use/tool_result、thinking、缓存用量 |
| Gemini generateContent | `gemini_generate_content` | Google Gemini 原生 API | systemInstruction、文本/图片、functionCall/functionResponse、thought、用量 |

成功响应会统一转换为 Responses 对象；Codex 请求流式响应时，网关会生成带 `sequence_number` 的完整 Responses SSE 事件序列。Codex 的 free-form custom tool 会在上游临时包装成带 `input` 字段的 function/tool，再按原始工具表恢复成 `custom_tool_call` 和 `response.custom_tool_call_input.*` 事件。包含点号、命名空间或超长名称的工具会生成稳定的上游安全名称，响应时再恢复原名。上游错误也会归一化为 `error.message/type/code/provider/upstream_status`，避免 Codex 因供应商错误结构不同而只显示解析失败。

## 添加供应商

1. 进入管理后台的“模型网关”。
2. 点击“新增”，优先选择供应商预设。
3. 填入 API Key；Ollama 等本地免鉴权服务选择 `none`。
4. 点击“获取模型”。支持 `/models` 的服务会返回可选模型；不支持时仍可手工输入模型 ID。
5. 保存供应商，再在该供应商下新增模型路由。
6. 模型路由的“模型 ID”是 Alpha Studio/Codex 看到的名称，“上游模型名”是供应商真实模型 ID。

预设覆盖 OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Azure OpenAI、Ollama、阿里云百炼、Moonshot/Kimi、SiliconFlow、智谱 GLM 和火山方舟。其他 OpenAI-compatible 服务通常只需选择 Chat Completions 或 Responses，再修改 Base URL。

## 配置字段

- `baseUrl`：供应商 API 前缀。也可以把 `endpointPath` 填成完整 URL。
- `endpointPath`：支持 `{model}` 占位符；Gemini 原生预设使用 `/models/{model}:generateContent`。
- `apiFormat`：建议显式选择；`auto` 会根据 endpoint 和 provider ID 推断。
- `authType`：`bearer`、`api_key_header`、`query_param` 或 `none`。
- `authHeader`：鉴权 Header 或 Query 参数名，例如 `authorization`、`x-api-key`、`api-key`、`key`。
- `customHeaders`：字符串到字符串的 JSON 对象。`Host`、`Content-Length`、`Transfer-Encoding`、`Connection` 不会向上游转发。
- `queryParams`：字符串到字符串的 JSON 对象，适合 Azure 的 `api-version`。
- `requestTimeoutMs`：1 秒到 15 分钟。
- `maxRetries`：0 到 5。只对连接/超时错误和 408、429、500、502、503、504 重试；POST 会携带稳定的 `idempotency-key`。

## 常见配置

### Anthropic 原生

```json
{
  "baseUrl": "https://api.anthropic.com/v1",
  "endpointPath": "/messages",
  "apiFormat": "anthropic_messages",
  "authType": "api_key_header",
  "authHeader": "x-api-key",
  "customHeaders": { "anthropic-version": "2023-06-01" }
}
```

### Gemini 原生

```json
{
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
  "endpointPath": "/models/{model}:generateContent",
  "apiFormat": "gemini_generate_content",
  "authType": "query_param",
  "authHeader": "key"
}
```

### Azure OpenAI Responses

```json
{
  "baseUrl": "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
  "endpointPath": "/responses",
  "apiFormat": "responses",
  "authType": "api_key_header",
  "authHeader": "api-key",
  "queryParams": { "api-version": "2025-04-01-preview" }
}
```

### Ollama（后端运行在 Docker 中）

```json
{
  "baseUrl": "http://host.docker.internal:11434/v1",
  "endpointPath": "/chat/completions",
  "apiFormat": "chat_completions",
  "authType": "none"
}
```

若后端直接运行在宿主机，把 Base URL 改为 `http://localhost:11434/v1`。

## Codex 侧契约

Alpha Studio 桌面端会为每次运行创建短期 run token，并生成等价的 Codex provider 配置：

```toml
model_provider = "alpha-gateway"

[model_providers.alpha-gateway]
base_url = "https://YOUR_ALPHA_STUDIO_HOST/v1"
wire_api = "responses"
```

Run token 作为 Bearer API key 使用，并绑定客户、设备、运行和模型。`GET /v1/models` 只返回该 token 对应的模型，`POST /v1/responses` 不能借 token 切换到其他模型。

## 兼容性边界

- 模型服务必须至少支持文本和当前路由所需的工具调用能力；仅“能聊天”不代表适合 Codex agent 工作流。
- 模型发现依赖供应商的 `/models`。404/405 或非标准响应时请手工填写模型 ID。
- Azure Entra ID、Google OAuth/Vertex AI、AWS SigV4/Bedrock 等动态凭据签名不属于静态 API Key 配置，当前应放在一个负责换取/签名的内部代理之后，再让 Alpha Studio 连接该代理。
- 网关目前为兼容性优先：上游使用非流式请求，收到完整响应后再输出 Codex SSE。它不会提供上游首 token 的实时延迟。

## 参考

- [Codex custom model providers](https://developers.openai.com/codex/config-advanced/#custom-model-providers)
- [CC Switch provider presets, model discovery and local routing](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [Gemini API](https://ai.google.dev/gemini-api/docs)

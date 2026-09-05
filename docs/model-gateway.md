# Alpha Studio 多模型网关

Alpha Studio 对 Codex CLI 始终暴露 OpenAI Responses API：

```text
Codex CLI -> POST /v1/responses -> Alpha Studio adapter -> 上游模型服务
```

当前 Codex 的自定义 provider 只支持 `wire_api = "responses"`。因此，不论上游使用 OpenAI Responses、Chat Completions、Anthropic Messages 还是 Gemini `generateContent`，客户端都只连接 Alpha Studio 的 `/v1` Base URL，协议差异由服务端处理。

## 已支持的上游协议

| 上游协议 | `apiFormat` | 典型服务 | 转换范围 |
| --- | --- | --- | --- |
| OpenAI Responses | `responses` | OpenAI、Azure OpenAI、OpenRouter Responses 代理 | 模型别名、原生 SSE 逐块透传、用量结算 |
| OpenAI Chat Completions | `chat_completions` | DeepSeek、Qwen、Kimi、GLM、SiliconFlow、Ollama 等 | system/developer、文本/图片、function/custom 工具调用与结果、用量、常见 reasoning 字段 |
| Anthropic Messages | `anthropic_messages` | Anthropic Claude、Anthropic-compatible 代理 | system、文本/图片、tool_use/tool_result、thinking、缓存用量 |
| Gemini generateContent | `gemini_generate_content` | Google Gemini 原生 API | systemInstruction、文本/图片、functionCall/functionResponse、thought、用量 |

成功响应会统一转换为 Responses 对象；Codex 请求流式响应时，Responses 上游的 SSE 会按网络块立即透传，Chat Completions、Anthropic Messages 和 Gemini 原生流会边接收边转换为带 `sequence_number` 的 Responses SSE，不再等待完整生成结束。流结束后网关从最终 usage 事件异步完成计费结算。Codex 的 free-form custom tool 会在上游临时包装成带 `input` 字段的 function/tool，再按原始工具表恢复成 `custom_tool_call` 和 `response.custom_tool_call_input.*` 事件。包含点号、命名空间或超长名称的工具会生成稳定的上游安全名称，响应时再恢复原名。上游错误也会归一化为 `error.message/type/code/provider/upstream_status`，避免 Codex 因供应商错误结构不同而只显示解析失败。

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
- 密钥、Token、密码等凭据只能填写在受 KMS 密文保护的 `API Key` 字段；后台会拒绝把它们放入明文 `customHeaders` 或 `queryParams`。
- `requestTimeoutMs`：1 秒到 15 分钟。
- `maxRetries`：0 到 5。模型 POST 仅重试可确认未产生推理成本的连接失败和暂时性 429，并保持同一个 `idempotency-key`；不会重发超时、部分流或 5xx。额度不足的 429 直接返回。只读模型发现 GET 保留对连接/超时和 408、429、500、502、503、504 的重试。
- `contextWindowTokens`：模型的总上下文窗口。桌面端会将非 OpenAI 模型的窗口传给 Codex，并在约 90% 时提前压缩历史；未配置的非 OpenAI 路由按 64k 保守迁移。火山方舟 GLM-5.2、DeepSeek V4 Pro 与 Flash 按官方 1024k 窗口配置。
- `maxOutputTokens`：模型最大回答长度。网关结合上下文窗口、最大回答和定价自动抬高内部任务安全预算，避免固定 5 元上限先于模型窗口拒绝合法输入。
- `supportedReasoningEfforts` / `defaultReasoningEffort`：管理后台会优先按已核验的具体模型锁定真实选项；未知自定义模型才允许手动配置。网关模型可使用的标准超集是 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。`ultra` 是 Codex 编排模式，不是标准模型 effort，不能配置到网关路由。
- `fastModeSupported`：控制桌面端是否显示 Fast 选项。选中后 Codex 使用 `service_tier = "fast"`，并把请求映射成上游的 `service_tier: "priority"`。网关识别实际请求中的 `priority` 标记，将输入、输出、推理和缓存输入的上游成本单价统一按标准价格的 2 倍计算，再应用该路由配置的用户价格倍率；标准请求的价格不变。

### 思考参数转译

| 模型/协议 | 管理端真实选项示例 | 上游参数 |
| --- | --- | --- |
| OpenAI Responses | 按 GPT 具体版本过滤 | `reasoning.effort` |
| DeepSeek V4 Pro / GLM-5.2 原生 | `none / high / max` | `thinking` + `reasoning_effort` |
| DeepSeek V4 Flash 原生 | `none / low / high / max` | `thinking` + `reasoning_effort` |
| 火山方舟 Chat | `low / medium / high` | `reasoning_effort`（采用方舟公开契约） |
| Claude 4.6+ Messages | 按具体 Claude 型号过滤 | `thinking.type=adaptive` + `output_config.effort` |
| Gemini 3.x GenerateContent | 模型相关的 `minimal / low / medium / high` 子集 | `generationConfig.thinkingConfig.thinkingLevel` |
| Gemini 2.5 GenerateContent | `none / minimal / low / medium / high` 的模型相关子集 | 官方兼容映射后的 `thinkingBudget` |
| Qwen / Kimi 混合思考 | 通常为 `none / high`；Qwen3.8 Max 为多档例外 | `enable_thinking`，必要时附 `reasoning_effort` |

未知模型不会再默认宣称支持 `low / medium / high / xhigh`。如果未识别，管理员必须依据该上游的官方文档手动选择；服务端仍会拒绝非标准网关值。

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
request_max_retries = 0
stream_max_retries = 0
```

Run token 作为 Bearer API key 使用，并绑定客户、设备、任务、模型和累计消费安全上限，默认有效期为 48 小时以支持跨日 agent 任务。创建任务时只检查账户余额大于 0，不冻结或预扣余额；`GET /v1/models` 只返回该 token 对应的模型，`POST /v1/responses` 不能借 token 切换到其他模型。同一 token 可以覆盖主任务和子任务的多次推理，每次响应独立记录真实 Token 用量并扣费，同时从任务累计安全上限中扣减。余额小于等于 0、设备撤销、token 过期或任务预算耗尽时，后续模型请求会被拒绝。

### 子任务并发与限流

每个 agent 的模型请求串行。主流程有一个名额，独立 spawned subagent 最多同时占用两个名额。身份依据内置 Codex 0.146.1 实际发送的 `client_metadata.thread_id`、`x-openai-subagent=collab_spawn` 和 `x-codex-parent-thread-id`；缺少有效身份、review、compaction 等请求走主流程串行通道。这是模型请求调度上限，不会将所有工具强制改成串行。

PostgreSQL 的 `gateway_request_leases` 在事务中锁住任务并为每个请求占用单独的预算额度。额度只用于任务安全限制，不扣钱包；额度被其他请求占用时等待结算，不立即报预算耗尽。真正结算仍按任务行锁串行执行，重复回调不能重复扣费。

共享供应商凭据的通道最多同时派发三个模型请求，跨后端实例生效。通道键只存供应商标识、Base URL 和 API Key 的哈希。429 会设置数据库共享冷却期，遵守完整 `Retry-After`（秒数或 HTTP 日期），追加最多 250 毫秒随机等待；未提供等待时间时采用指数退避。冷却结束后的 60 秒只允许一个请求试运行。单次调用的自动重试等待预算为 180 秒，重试次数仍受 `maxRetries` 限制；超过预算则保留真实上游 429、请求 ID 和 `Retry-After` 返回，不提前再试。

Alpha Gateway 由后端统一负责重试，桌面端关闭该 provider 的 Codex HTTP/流重试，避免两层重试叠加。其他 provider 的客户端配置不受影响。本地等待超时使用 HTTP 409，带 `error.code=gateway_queue_timeout` 和 `error.source=gateway_queue`；真实上游 429 带 `source=upstream`，有上游请求 ID 时一并保留。并发上限无法保证供应商永不返回 429，仍需匹配其 RPM/TPM 和账户额度。

`GET /v1/run-status` 增加 `activeRequests`、`activeSubagents`、`cooldownUntil`（Unix 毫秒）、`maxParallelSubagents`。界面分别展示实际工具操作、子任务请求数、内部等待和限流倒计时，20 秒未更新的遥测不再当作实时状态。数据库提供跨实例派发数量与冷却状态；同一进程内的早期等待数和最近输出时间仍为进程本地信息，多实例若需完整遥测应按 run 路由。

### 实时内容与进度

主任务正文通过 Codex app-server 的 `item/agentMessage/delta` 直接逐段渲染，计划通过 `item/plan/delta` 同样展示，不等待整个任务完成。完成事件按当前 run 和消息 item ID 回写权威快照，可修复遗漏的末尾内容；前面有过流式输出不再导致后续独立消息被误删。摘要完成事件只补充公开 summary，不从 content 字段额外展开原始推理。

网关只把语义进展计入 `lastOutputAt`。连接建立、心跳、用量帧和 `[DONE]` 不再代表“正在输出正文”。`requestProgress` 分别报告回复、工具参数准备、推理和检索阶段。工具参数只统计生成字符数，不返回参数内容；界面写明准备完成后才会执行，生成参数不等于文件已写入。

子任务正文在独立进度卡中显示最近 900 个字符，并标记为尚未汇总的阶段性输出；默认展示末尾 220 个字符，可展开最近内容。该预览仅存于当前 API 进程内存，受任务 token 保护，随请求结束清除，不写入数据库或日志，不含提示词、工具参数、原始推理或加密字段。主任务正文不进入网关预览，避免重复展示。桌面每 2 秒读取一次这条轻量状态接口，主回复仍由原生增量事件实时发送；状态查询不会触发模型请求或消耗模型重试额度。

新增预览同样需要多实例部署按 run 路由才能完整显示。停止任务、请求结束或遥测超过 20 秒未更新后，界面清除实时预览；正式回复仍保留在对话中。

升级须先应用 `0025_gateway_agent_request_leases.sql`，发布后端，再更新桌面客户端。`active_request_id` 保留为兼容标记，有任一新请求尚未结算时旧后端仍会等待；但混用版本期间，旧实例不能参与新的供应商全局限额，因此应排空旧请求后切换。回滚同样须先排空新版本请求，保留新增表，不直接删除在途租约。

后端异常退出时，供应商派发名额在请求总时限加 30 秒结算余量后失效，避免长期阻塞其他任务；该任务的预算租约仍保留，防止把成本不明的请求当成免费失败并重放。此类任务需按上游用量完成对账后处理遗留租约。

若上游成功响应缺失 usage、流在发出后中断、请求超时，或上游在可能已产生推理成本后返回 5xx，网关只对已确认的 Token 用量计费，不用单次消费上限猜测扣费；用量不可靠的记录会标记为 `usage_unavailable` 并进入对账待核对。启用按量模型前，输入与输出成本价必须为正数，所有价格与加价率必须为有限非负数；部署级 `MIN_GATEWAY_MARKUP_BPS`（默认 500，即 5%）还会阻止低于安全毛利线的路由启用或调用。

## 兼容性边界

- 模型服务必须至少支持文本和当前路由所需的工具调用能力；仅“能聊天”不代表适合 Codex agent 工作流。
- 模型发现依赖供应商的 `/models`。404/405 或非标准响应时请手工填写模型 ID。
- Azure Entra ID、Google OAuth/Vertex AI、AWS SigV4/Bedrock 等动态凭据签名不属于静态 API Key 配置，当前应放在一个负责换取/签名的内部代理之后，再让 Alpha Studio 连接该代理。
- 流式请求在收到上游首个 SSE 数据块后立即向 Codex 输出；若供应商自身或其前置代理启用了缓冲，首 token 延迟仍会受该上游链路影响。

## 参考

- [Codex custom model providers](https://developers.openai.com/codex/config-advanced/#custom-model-providers)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Codex app-server events](https://learn.chatgpt.com/docs/app-server#item-deltas)
- [OpenAI rate limits and retries](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff)
- [CC Switch provider presets, model discovery and local routing](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [Anthropic effort and adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Gemini API](https://ai.google.dev/gemini-api/docs)
- [Gemini thinking controls](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [OpenAI reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [GLM reasoning effort](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)

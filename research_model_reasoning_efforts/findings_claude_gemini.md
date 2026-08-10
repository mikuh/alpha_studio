# Claude / Gemini 原生思考控制参数核验

核验日期：2026-08-09。资料仅取 Anthropic Claude Platform 与 Google AI for Developers 官方文档。

## 结论先行

Alpha Studio 不能把统一的 `reasoning.effort` 原样发给所有供应商：

- Claude 原生 Messages API 使用 `output_config.effort`，思考开关/模式另由 `thinking` 控制；Anthropic 的 OpenAI 兼容层明确会**忽略** `reasoning_effort`。
- Gemini 原生 GenerateContent API 使用 `generationConfig.thinkingConfig.thinkingLevel`（Gemini 3.x）或 `thinkingBudget`（Gemini 2.5）。Google 的 OpenAI 兼容层可以接收 `reasoning_effort`，但只对官方列出的 `none|minimal|low|medium|high` 做模型相关映射；不能把 Alpha Studio 的 `xhigh|max|ultra` 原样发过去。
- 因而 UI 应保存“统一意图”，运行时必须按供应商、模型系列和模型能力转换，并只展示该模型真实支持的选项。不要把不支持的档位静默降级成 `high`。

## Anthropic Claude

### 原生参数与枚举

Claude 的强度参数是：

```json
{
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "medium" }
}
```

`output_config.effort` 的基础枚举为 `low | medium | high`；部分新模型还支持 `max`，更少的一部分支持 `xhigh`。`high` 是默认值，显式传 `high` 与省略参数行为相同。`effort` 是软性行为信号，控制整次响应（文本、工具调用和启用后的思考）消耗，不是严格 token 上限。

官方当前模型能力：

| 模型类别 | `low/medium/high` | `max` | `xhigh` |
| --- | --- | --- | --- |
| Claude Opus 4.5 | 支持 | 不支持 | 不支持 |
| Claude Opus 4.6、Claude Sonnet 4.6、Claude Mythos Preview | 支持 | 支持 | 不支持 |
| Claude Opus 4.7、Opus 4.8、Opus 5、Sonnet 5 | 支持 | 支持 | 支持（Sonnet 5 支持；Sonnet 4.6 不支持） |
| Claude Fable 5、Mythos 5 | 支持 | 支持 | 支持 |
| 其他未列入 effort 文档的 Claude（例如 Haiku 4.5、较早 Claude 4） | 不应宣称支持 categorical effort | 不支持 | 不支持 |

Anthropic 当前列出的完整 `max` 支持集：Fable 5、Mythos 5、Opus 5、Opus 4.8、Mythos Preview、Opus 4.7、Opus 4.6、Sonnet 5、Sonnet 4.6。完整 `xhigh` 支持集：Fable 5、Mythos 5、Opus 5、Opus 4.8、Opus 4.7、Sonnet 5。

注意：Claude 没有原生 `minimal`、`ultra` effort；`none` 也不是 effort 值。`none` 应当被解释为“关闭 thinking”，并映射成 `thinking: {"type":"disabled"}`，且只在模型允许关闭时显示。

### Adaptive、manual 与 disabled 的模型差异

| 思考模式 | 原生参数 | 适用情况 |
| --- | --- | --- |
| Adaptive | `thinking: {"type":"adaptive"}` | Opus 4.6、Sonnet 4.6；Opus 4.7/4.8 的唯一思考模式；Sonnet 5 默认；Fable 5 / Mythos 5 永久开启；Mythos Preview 默认。推荐配合 effort 控制深度。 |
| Manual | `thinking: {"type":"enabled","budget_tokens":N}` | Opus 4.5、Haiku 4.5 与更早支持 extended thinking 的 Claude 4；在 Opus/Sonnet 4.6 已弃用；Opus 4.7/4.8、Sonnet 5、Fable 5、Mythos 5 会以 400 拒绝。 |
| Disabled | `thinking: {"type":"disabled"}` | 大多数模型可用，但 Fable 5、Mythos 5、Mythos Preview 不允许关闭；Sonnet 5 若要关闭必须显式传 disabled。 |

Manual 模式的 `budget_tokens` 是严格的思考 token 上限，并包含在 `max_tokens` 内。Anthropic 没有发布“low=多少 token、medium=多少 token”的官方分类映射，所以若 Alpha Studio 要把统一档位用于 manual-only 模型，数值只能是产品策略，不能标记为厂商原生值。最保守方案是：这类模型把“关闭”和“手动预算”作为独立能力；若 UI 暂时只有离散档位，可采用内部预算表并明确它是 Alpha 映射，同时保证 `budget_tokens >= 1024`、`budget_tokens < max_tokens`，并按模型输出上限裁剪。

### Claude 的保守 UI/运行时映射

| Alpha 选项 | Adaptive + effort 模型 | Manual-only 模型 |
| --- | --- | --- |
| `none` | 仅可关闭模型：`thinking.type=disabled`；不可关闭模型不显示 | `thinking.type=disabled` |
| `minimal` | 不显示（Claude 无此 effort） | 不显示 |
| `low` | `thinking.type=adaptive` + `output_config.effort=low` | 映射为 Alpha 自定低预算；Opus 4.5 可另外传 `output_config.effort=low` |
| `medium` | adaptive + effort=medium | Alpha 自定中预算；Opus 4.5 可另外传 effort=medium |
| `high` | adaptive + effort=high | Alpha 自定高预算；Opus 4.5 可另外传 effort=high |
| `xhigh` | 仅官方 xhigh 支持集显示并原样传 | 不显示 |
| `max` | 仅官方 max 支持集显示并原样传 | 不显示；如希望暴露最大 token 预算，应另建“手动预算”语义，不能伪装成 Claude max effort |
| `ultra` | 不显示 | 不显示 |

### OpenAI 兼容参数能否直传

不能。Anthropic 官方 OpenAI SDK 兼容表将 `reasoning_effort` 标为 **Ignored**。若走 Claude 原生 Messages 适配器，必须改写为 `output_config.effort`，并另行构造 `thinking`。即使走 Anthropic 的 OpenAI 兼容端点，也不能依赖 `reasoning_effort` 生效。

官方资料：

- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)

## Google Gemini

### Gemini 3.x：`thinkingLevel`

GenerateContent 原生请求形态：

```json
{
  "generationConfig": {
    "thinkingConfig": { "thinkingLevel": "medium" }
  }
}
```

Gemini 3.x 推荐 `thinkingLevel`，不是数值 `thinkingBudget`。不同模型的真实选项不同：

| 常见模型 | 默认 | 官方支持 level |
| --- | --- | --- |
| Gemini 3.1 Pro | high（动态） | `low, medium, high`；不能关闭 |
| Gemini 3 Pro Preview | high | `low, high`；不能关闭 |
| Gemini 3 Flash / 3.5 Flash / 3.6 Flash | 各版本默认不同（当前 3.5/3.6 Flash 为 medium，3 Flash Preview 为 high） | `minimal, low, medium, high` |
| Gemini 3.x Flash-Lite | 通常 minimal | 多数文本模型为 `minimal, low, medium, high`；特定图像变体可能仅 `minimal, high` |

`minimal` 只是“多数请求接近不思考”，并不是强制关闭；Gemini 3 Pro/Flash 系列不支持真正 thinking-off。Gemini 3.x 不支持 `xhigh|max|ultra`。

### Gemini 2.5：`thinkingBudget`

Gemini 2.5 GenerateContent 不支持 `thinkingLevel`，必须用数值预算：

| 模型 | 默认 | 合法预算范围 | 关闭 | 动态 |
| --- | --- | --- | --- | --- |
| Gemini 2.5 Pro | 动态 | `128..32768` | 不允许 | `-1`（默认） |
| Gemini 2.5 Flash / Flash Preview | 动态 | `0..24576` | `0` | `-1`（默认） |
| Gemini 2.5 Flash-Lite / Preview | 默认不思考 | `512..24576`（另允许 0） | `0` | `-1` |

Google 官方 OpenAI 兼容层已经给出统一 effort 到 Gemini 的映射，可直接作为 Alpha Studio 对 Gemini 2.5 的离散预算策略：

| Alpha/OpenAI 意图 | Gemini 2.5 `thinkingBudget` |
| --- | --- |
| `minimal` | 1024 |
| `low` | 1024 |
| `medium` | 8192 |
| `high` | 24576 |
| `none` | 0，但只允许 2.5 Flash/Flash-Lite；2.5 Pro 不显示 |

未指定时让模型保持自身默认（动态或 Flash-Lite 的默认关闭），比人为套用 medium 更忠实。Gemini 2.5 Pro 的原生最大值虽为 32768，但 Google 官方的 `high` 兼容映射是 24576；若需要 32768，应另做自定义预算，而不是把 `max` 冒充标准 Gemini 枚举。

### Gemini 的保守 UI/运行时映射

| Alpha 选项 | Gemini 3.x | Gemini 2.5 |
| --- | --- | --- |
| `none` | 不显示（不能真正关闭） | 仅可关闭模型映射 budget=0；2.5 Pro 不显示 |
| `minimal` | 仅模型能力表声明支持时原样传 | budget=1024（Google 官方兼容映射） |
| `low` | 支持时原样传 | budget=1024 |
| `medium` | 支持时原样传 | budget=8192 |
| `high` | 支持时原样传 | budget=24576 |
| `xhigh`, `max`, `ultra` | 不显示 | 不显示；如需更大预算使用单独的高级数值设置 |

### OpenAI 兼容参数能否直传

- 走 Google 官方 OpenAI 兼容端点时：`reasoning_effort` 可直接传，但只应传官方文档覆盖的 `none|minimal|low|medium|high`，并遵守每个模型不能关闭/不支持 minimal 等限制。未指定时使用模型默认。
- 走 Alpha Studio 当前的 Gemini GenerateContent 原生适配器时：不能原样直传，必须翻译为 `generationConfig.thinkingConfig.thinkingLevel` 或 `thinkingBudget`。
- `xhigh|max|ultra` 不在 Google 兼容表中，不能直传，也不应静默压成 high。

官方资料：

- [Gemini thinking（GenerateContent）](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Gemini thinking（Interactions API）](https://ai.google.dev/gemini-api/docs/thinking)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

## 对 Alpha Studio 数据模型的建议

1. 统一枚举应补上 `minimal`，形成能力超集：`none|minimal|low|medium|high|xhigh|max|ultra`；但 UI 必须按模型过滤，不能默认全选。
2. 模型路由不应只保存 `supportedReasoningEfforts`，还应保存/派生 `reasoningAdapter`：例如 `openai-effort`、`anthropic-adaptive-effort`、`anthropic-manual-budget`、`gemini-thinking-level`、`gemini-thinking-budget`。
3. `none` 应作为“明确关闭 thinking”的语义，而不是最低 effort；模型不能关闭时不展示。
4. 支持“保持模型默认/自动”会比硬设一个默认档位更真实。若不新增 `auto`，至少允许 `defaultReasoningEffort` 为空并在请求中省略参数。
5. 管理端模型预设应以具体模型能力表自动填充选项；未知自定义模型采取保守值（省略思考参数），不要默认 `low,medium,high,xhigh`。
6. 后端发送前再次按模型能力校验。旧会话保存了不支持的档位时，应回落到“模型默认/省略”，同时记录可观测警告；不要无提示地把 `ultra/max/xhigh` 变成 `high`。

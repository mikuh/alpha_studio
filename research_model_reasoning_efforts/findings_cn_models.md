# 国内常见模型的真实思考控制能力（2026-08-09）

## 结论摘要

国内模型不能统一当作 OpenAI 风格的连续 `reasoning_effort` 档位处理。官方接口实际至少有四种控制语义：

1. **真实强度档位**：例如 GLM-5.2、DeepSeek V4 只有少数真正不同的推理档位，其余值只是兼容别名。
2. **思考开关**：例如多数 Qwen、Kimi 混合思考模型只有开/关，另可用 `thinking_budget` 控制长度。
3. **开/关/自适应**：例如豆包动态思考模型使用 `thinking.type = enabled | disabled | auto`。
4. **固定思考**：例如名称带 `thinking` 的模型及部分 Kimi Code 模型，不能关闭，也没有可调强度。

因此产品层不应给每个模型默认展示 `none / low / medium / high / xhigh / max / ultra` 全集。尤其 `ultra` 没有任何本报告覆盖的国内厂商官方接口支持。

## 火山方舟接口边界

火山方舟公开的 Chat Completions API 文档对 `reasoning_effort` 只声明了三个值：

- `low`
- `medium`
- `high`

其中 `low` 会减少推理 token 与推理耗时。官方页面没有在该字段处声明 `none`、`minimal`、`xhigh`、`max` 或 `ultra`，也没有列出不同模型的逐项例外。

来源：[火山方舟 ContextChatCompletions API](https://api.volcengine.com/api-docs/view?action=ContextChatCompletions&serviceCode=ark&version=2024-01-01)

这意味着：**对于 `volcengine-ark-*` 路由，若没有方舟逐模型文档或线上探针证实，不应仅因为模型原厂支持 `max` 就把 `max` 原样发送给方舟。** 最安全的方舟通用预设是 `low / medium / high`，默认建议 `high`；但这只代表方舟接口接受这三个值，不保证底层模型真的具有三个互不相同的计算档位。

方舟/火山的另一份官方组件文档明确记录了 `thinking_type` 的三态语义：`enabled`（强制思考）、`disabled`（关闭）、`auto`（模型自行判断），且未配置时默认开启思考。来源：[火山引擎思考模型参数文档](https://www.volcengine.com/docs/6492/2165100?lang=zh)

## 逐模型核验

### DeepSeek V4 Pro / DeepSeek V4 Flash

DeepSeek 最新官方文档明确区分了两个型号的实际强度语义：

- 两者思考模式均默认开启，默认强度均为 `high`，并可用 `thinking.type=disabled` 关闭。
- V4 Pro 的实际档位为 `high`、`max`；请求 `low` 会落到 `high`，`xhigh` 会落到 `max`。
- V4 Flash 的实际档位为 `low`、`high`、`max`；请求 `xhigh` 会落到 `high`。
- 两者上下文均为 1M，最大输出均为 384K。

来源：[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)、[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)

保守产品预设：

| 路由 | 用户可见选项 | 默认 | 上游语义 |
|---|---|---|---|
| DeepSeek 原生 V4 Pro | `none`, `high`, `max` | `high` | `none` -> `thinking.type=disabled`；其余为真实档位 |
| DeepSeek 原生 V4 Flash | `none`, `low`, `high`, `max` | `high` | `none` -> `thinking.type=disabled`；其余为真实档位 |
| 火山方舟 DeepSeek V4 | `low`, `medium`, `high` | `high` | 按方舟公开契约原值发送 |
| 未知兼容网关 | `high` | `high` | 只使用两边均明确接受的交集；未验证前不发送 `max` |

重要限制：原厂能力不能自动推定到火山方舟；方舟路由仍只发送其公开契约明确列出的 `low/medium/high`。

### GLM-5.2

智谱官方文档明确给出：

- `thinking.type`: `enabled`（默认）或 `disabled`
- `reasoning_effort`: `max`（默认且推荐）、`xhigh`、`high`、`medium`、`low`、`minimal`、`none`
- 但真正不同的语义只有：
  - `none` / `minimal`：不思考
  - `low` / `medium`：映射为 `high`
  - `high`：增强推理
  - `xhigh`：映射为 `max`
  - `max`：深度推理
- `reasoning_effort` 仅 GLM-5.2 及以上支持；GLM-5.1、GLM-5、GLM-4.7 等不能据此开放强度档位。

来源：[智谱 GLM 深度思考官方文档](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)、[迁移至 GLM-5.2](https://docs.bigmodel.cn/cn/guide/start/migrate-to-glm-new)

保守产品预设：

| 路由 | 用户可见选项 | 默认 | 说明 |
|---|---|---|---|
| 智谱原生 GLM-5.2 | `none`, `high`, `max` | `max` | 只显示三个真实语义，隐藏兼容别名 |
| 火山方舟 GLM-5.2 | `low`, `medium`, `high` | `high` | 遵守方舟公开契约；不能把智谱的 `max` 未经验证直传 |
| GLM-5.1 / 5 / 4.7 / 4.6 / 4.5 | `none`, `high` | `high` | 仅表示关闭/开启；不应显示多档强度 |

如果产品需要跨提供商保持 `none/high/max` 的统一体验，应在网关做提供商级翻译，而不是把同一个字符串原样透传。

### Doubao / 豆包

火山官方资料体现的是**模式控制**而非强度枚举：

- 动态思考模型：`thinking.type = disabled | auto | enabled`
- Flash 等部分模型：只支持 `disabled | enabled`，不支持 `auto`
- 名称带 `-thinking` 的强化模型：固定思考，不应提供关闭或强度选择

火山官方组件文档对三态参数语义的定义见：[火山引擎思考模型参数文档](https://www.volcengine.com/docs/6492/2165100?lang=zh)。豆包 1.6 的具体模型形态可交叉参考火山官方开发者站的一手发布材料：[Doubao-Seed-1.6 调用说明](https://developer.volcengine.com/articles/7517188344586403876)。

建议预设：

| 模型匹配 | 用户可见选项 | 默认 | 实际参数 |
|---|---|---|---|
| `doubao-seed-*-thinking*` | 不显示选择器（固定思考） | 固定开启 | `thinking.type=enabled` 或省略 |
| `doubao-seed-1.6-flash*` | `none`, `high` | `high` | `disabled`, `enabled` |
| `doubao-seed-1.6*`（排除 thinking/flash） | `none`, `medium`, `high` | `high` | `disabled`, `auto`, `enabled` |
| 未知 Doubao 新版本 | `none`, `high` | `high` | 先按开关处理；只有逐模型文档确认后才加 `auto` |

这里的 `medium` 是产品层对“自适应”的展示映射，不是模型原生的中等推理强度。更理想的 UI 文案应直接显示“关闭 / 自适应 / 开启”。

### Qwen / 千问

阿里云官方文档将 Qwen 分为混合思考和仅思考两类：

- Qwen3.7 / 3.6 / 3.5 多数商业模型：混合思考，默认开启。
- Qwen3 商业版（Max/Plus/Flash/Turbo）：混合思考，默认关闭。
- Qwen3 开源混合思考版：默认开启。
- 名称带 `-thinking` 的版本与 QwQ：固定思考，不能关闭。
- 混合思考通常用 `enable_thinking: boolean`；Qwen3 系列还可用 `thinking_budget` 限制思考 token。这不是 low/medium/high 离散强度。

来源：[阿里云百炼深度思考模型用法](https://help.aliyun.com/zh/model-studio/deep-thinking)

Qwen3.8 Max 是明确的例外。官方 Chat 文档给出的真实档位为：

- `low`
- `medium`
- `xhigh`（默认）
- `none` 映射为关闭思考
- `minimal` 映射为 `low`
- `high` / `max` 映射为 `xhigh`

且 `reasoning_effort` 与 `thinking_budget` 不能同时发送。来源：[百炼 OpenAI 兼容 Chat 参数文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)

建议预设：

| 模型匹配 | 用户可见选项 | 默认 |
|---|---|---|
| `qwen3.8-max*` | `none`, `low`, `medium`, `xhigh` | `xhigh` |
| Qwen3.7 / 3.6 / 3.5 混合思考 | `none`, `high` | `high` |
| Qwen3 商业混合思考 | `none`, `high` | `none` |
| Qwen3 开源混合思考 | `none`, `high` | `high` |
| `*thinking*`、`qwq*` | 不显示选择器（固定思考） | 固定开启 |

百炼 Responses API 的顶层契约可接受 `none/minimal/low/medium/high/xhigh/max`，但产品仍应按模型能力收窄，而不是把接口能接收的所有别名都展示出来。来源：[百炼 Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)

### Kimi

Kimi 同样以开关/固定思考为主：

- `kimi-k2.5`、`kimi-k2.6`：混合思考，使用 `enable_thinking` 开关。
- `kimi-k2.7-code` / `kimi-k2.7-code-highspeed`：仅思考，不能关闭，无强度档位。
- `kimi/kimi-k3`：仅思考，`reasoning_effort` 唯一支持值为 `max`。
- 阿里云部署的 K2.5/K2.6 默认关闭；月之暗面直供页面标为默认开启。因为同一模型在不同部署渠道默认值不同，产品必须显式发送开关，不能依赖省略参数的默认行为。

来源：[Kimi 阿里云部署](https://help.aliyun.com/zh/model-studio/kimi-api)、[Kimi 月之暗面直供](https://help.aliyun.com/zh/model-studio/kimi-api-by-moonshot-ai)

建议预设：

| 模型匹配 | 用户可见选项 | 默认 |
|---|---|---|
| 阿里云部署 `kimi-k2.5/2.6` | `none`, `high` | `none` |
| 月之暗面直供 `kimi/kimi-k2.5/2.6` | `none`, `high` | `high`，且显式发送开关 |
| `kimi-k2.7-code*` | 不显示选择器（固定思考） | 固定开启 |
| `kimi/kimi-k3` | 不显示选择器，或只显示 `max` | `max` |
| `kimi-k2-thinking*` | 不显示选择器（固定思考） | 固定开启 |

## 推荐的产品能力模型

只存 `supported_reasoning_efforts: string[]` 无法准确表达国内模型。建议至少增加：

```text
reasoning_control:
  kind: effort | toggle | adaptive_toggle | always_on | unsupported
  supported_values: [...]       # 仅 effort 使用
  default_value: ...
  aliases: {...}                # 原始兼容值 -> 真实语义
  upstream_mapping: {...}       # 规范化 UI 值 -> 提供商参数
```

建议的规范化 UI 语义：

- `none`: 关闭思考
- `low / medium / high / xhigh / max`: 仅在模型确有对应强度时显示
- `auto`: 应作为独立语义加入，不应长期伪装为 `medium`
- 固定思考模型：隐藏选择器，并在模型名称旁显示“固定思考”

## 可直接采用的保守匹配顺序

匹配必须从具体到宽泛：

1. 固定思考后缀：`*-thinking*`, `*reasoner*`, `kimi*k2.7-code*`, `kimi*k3*`
2. 精确模型：`glm-5.2*`, `deepseek-v4-pro*`, `deepseek-v4-flash*`, `qwen3.8-max*`
3. 系列规则：`qwen3.7*`, `qwen3.6*`, `qwen3.5*`, `qwen3*`, `doubao-seed*`, `kimi-k2.5*`, `kimi-k2.6*`
4. 提供商回退：火山方舟 `low/medium/high`；未知 OpenAI 兼容模型不主动声称支持思考强度

不要用简单的 `contains("glm")` 或 `contains("deepseek")` 为整个家族开放全部档位；例如 GLM-5.1 没有 GLM-5.2 的 `reasoning_effort`，DeepSeek R1 是固定推理模型，也不等同于 DeepSeek V4 的 high/max。

## 证据限制

- 火山方舟公开 API 页给出了通用 `low/medium/high` 契约，但没有提供 DeepSeek V4、GLM-5.2 在方舟 `/responses` 下的逐值支持矩阵。因此方舟路由的推荐刻意比模型原厂能力保守。
- DeepSeek 原厂文档已给出 V4 Pro/Flash 的逐档映射，但火山方舟没有公开逐模型映射，因此不把原厂 `max` 外推到方舟。
- Doubao 三态的具体模型矩阵在可抓取的方舟产品文档中不完整；本报告只对有火山官方一手材料支持的 Seed 1.6 规则给出精确预设，未知新版本采用开关模式回退。

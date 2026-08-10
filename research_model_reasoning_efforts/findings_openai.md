# OpenAI reasoning effort 官方研究结论

核验日期：2026-08-09。仅使用 OpenAI 官方开发者文档。

## 结论摘要

1. Responses API 的请求形状是顶层 `reasoning` 对象，例如：

   ```json
   {
     "model": "gpt-5.6",
     "reasoning": { "effort": "low" },
     "input": "..."
   }
   ```

   OpenAI 官方 reasoning 指南给出了相同的 JavaScript、Python 和 curl 示例。Chat Completions 的兼容字段则是顶层 `reasoning_effort`，不能把两种协议形状混为一谈。

2. OpenAI 当前公开文档列出的 `reasoning.effort` **可能值全集**为：

   `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`

   官方同时明确说明：具体支持值和默认值都由模型决定，不是所有模型都支持全集。

3. `max` 现在是正式公开 API 值，但当前明确支持它的是 GPT-5.6 家族。它不应全局开放给旧模型。

4. `ultra` **不是** OpenAI Responses API 的 `reasoning.effort` 值。官方文档仅把 Codex 的 ultra mode 与 Responses API 的 multi-agent beta 作类比；它属于更高层的代理编排/执行模式，不能发送为 `reasoning: {"effort":"ultra"}`。

5. 因此 Alpha Studio 不应再给所有 OpenAI 模型统一显示 `none / low / medium / high / xhigh / max / ultra`。应按模型能力表裁剪；无法识别的模型只允许管理员显式配置，且 `ultra` 只能来自 Codex 动态目录并由 Codex 自身消费，不能透传到标准 Responses API。

## 官方已明确的常用模型能力

| 模型匹配（含日期快照） | 官方支持的 effort | 官方明确默认值 | 建议产品默认 |
|---|---|---|---|
| `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `none, low, medium, high, xhigh, max` | `medium`（standard/pro 均相同） | `medium` |
| `gpt-5.5` | `none, low, medium, high, xhigh` | `medium` | `medium` |
| `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` | `none, low, medium, high, xhigh` | `none` | `medium` 可作为产品平衡预设；若要求忠实呈现 API 默认，则选 `none` |
| `gpt-5.2` | `none, low, medium, high, xhigh` | `none` | `medium` 可作为产品平衡预设；若要求忠实呈现 API 默认，则选 `none` |
| `gpt-5.1` | `none, low, medium, high` | `none` | `medium` 可作为产品平衡预设；若要求忠实呈现 API 默认，则选 `none` |
| `gpt-5` | `minimal, low, medium, high` | 当前模型页未明确标注 | `medium`；标注为产品默认而非官方默认 |
| `gpt-5.5-pro` | `medium, high, xhigh` | `high` | `high` |
| `gpt-5.4-pro` | `medium, high, xhigh` | `medium` | `medium` |
| `gpt-5.2-pro` | `medium, high, xhigh` | 当前模型页未明确标注 | `medium`；标注为产品默认而非官方默认 |
| `gpt-5-pro` | 仅 `high` | `high` | `high`，UI 可只读 |
| `gpt-5.3-codex`, `gpt-5.2-codex` | `low, medium, high, xhigh` | 当前模型页未明确标注 | `medium`；标注为产品默认而非官方默认 |
| `gpt-4.1*`, `gpt-4o*` 等非 reasoning 模型 | 不应发送 `reasoning.effort` | 不适用 | 不展示强度选项/请求中省略字段 |

说明：官方 GPT-5.4 模型页分别明确写出标准、mini、nano 均为 `none (default), low, medium, high, xhigh`；上表将日期快照纳入同一前缀规则。GPT-5.6 的家族规则来自官方最新 model guidance；该指南也明确 `gpt-5.6` alias 指向 `gpt-5.6-sol`。

## 建议的匹配优先级

模型 ID 匹配必须按“最特殊到最一般”的顺序，且先去掉尾部日期快照（例如 `-2026-04-23`）后匹配：

1. `gpt-5-pro`：仅 `high`。
2. `gpt-5.[245]-pro`：按各 Pro 表项处理，避免被标准 `gpt-5.x` 规则吞掉。
3. `gpt-5.[23]-codex`：`low, medium, high, xhigh`。
4. `gpt-5.6`、`gpt-5.6-sol|terra|luna`：增加 `max`，但没有 `minimal`。
5. `gpt-5.5`：`none` 到 `xhigh`，不含 `minimal/max`。
6. `gpt-5.4(-mini|-nano)?`、`gpt-5.2`：`none` 到 `xhigh`。
7. `gpt-5.1`：`none, low, medium, high`。
8. 精确 `gpt-5`：`minimal, low, medium, high`，注意 `minimal` 与后续版本的 `none` 不是同一枚举。
9. 明确非 reasoning 家族（`gpt-4.1*`, `gpt-4o*`, embedding/image/audio/realtime 等）：空列表，并省略请求字段。
10. 未知 OpenAI-compatible 模型：不自动假定支持 OpenAI 全集；使用上游动态能力元数据或管理员手动配置。

日期快照的处理建议不要简单删除所有尾部数字；应识别 `-YYYY-MM-DD`，否则会误伤 `gpt-5.1`、`gpt-5.2` 等版本号。

## `max`、`ultra` 和 `pro` 的边界

- `max`：公开的 `reasoning.effort`，目前 GPT-5.6 支持；可直接用于标准 Responses API。
- `pro`：GPT-5.6 的 `reasoning.mode`，和 effort 独立。示例形状为 `{"reasoning":{"mode":"pro","effort":"medium"}}`。它不是一个 effort 档位。
- `ultra`：Codex 更高层运行/编排模式。官方 latest-model 页面称 Responses API 的 multi-agent beta “类似 Codex ultra mode”，这恰好表明 ultra 不是 `reasoning.effort`。标准 API 请求必须过滤它。

如果 Alpha Studio 需要兼容 Codex 动态模型目录：

- 动态目录返回的 effort 列表可以覆盖静态预设，但后端仍应取“目录值 ∩ 标准 API 可发送值”；
- `ultra` 应单独建模为 agent/orchestration mode，而不是塞进 `reasoningEfforts`；
- 对旧目录可能返回的 `max`，只有模型元数据明确支持或匹配 GPT-5.6 时才发送；
- 若所选默认值不在新支持列表中，回退顺序建议为：官方默认 → `medium` → 首个可用值，而不是静默保留非法值。

## 官方来源

- OpenAI Reasoning models guide（参数形状、可能枚举全集、默认值按模型决定、GPT-5.6 mode/effort 边界）：https://developers.openai.com/api/docs/guides/reasoning
- OpenAI latest model guidance（GPT-5.6 家族、`max`、默认 `medium`、Codex ultra 与 multi-agent 的区别）：https://developers.openai.com/api/docs/guides/latest-model
- GPT-5.5：https://developers.openai.com/api/docs/models/gpt-5.5
- GPT-5.4：https://developers.openai.com/api/docs/models/gpt-5.4
- GPT-5.4 mini：https://developers.openai.com/api/docs/models/gpt-5.4-mini
- GPT-5.4 nano：https://developers.openai.com/api/docs/models/gpt-5.4-nano
- GPT-5.2：https://developers.openai.com/api/docs/models/gpt-5.2
- GPT-5.1：https://developers.openai.com/api/docs/models/gpt-5.1
- GPT-5：https://developers.openai.com/api/docs/models/gpt-5
- GPT-5.5 Pro：https://developers.openai.com/api/docs/models/gpt-5.5-pro
- GPT-5.4 Pro：https://developers.openai.com/api/docs/models/gpt-5.4-pro
- GPT-5.2 Pro：https://developers.openai.com/api/docs/models/gpt-5.2-pro
- GPT-5 Pro：https://developers.openai.com/api/docs/models/gpt-5-pro
- GPT-5.3-Codex：https://developers.openai.com/api/docs/models/gpt-5.3-codex
- GPT-5.2-Codex：https://developers.openai.com/api/docs/models/gpt-5.2-codex

## 研究限制

- 模型能力会持续变化，且 OpenAI 官方明确要求以对应模型页为准。静态预设必须可被动态能力元数据更新。
- 部分旧模型页只列支持档位、不标明省略参数后的默认值。本报告没有把未明确记录的默认值臆测成官方事实；表中的产品默认已单独标注。
- OpenAI-compatible 第三方上游即使接受相同 JSON 形状，也不代表接受相同枚举；必须由第三方模型自己的官方能力表决定。

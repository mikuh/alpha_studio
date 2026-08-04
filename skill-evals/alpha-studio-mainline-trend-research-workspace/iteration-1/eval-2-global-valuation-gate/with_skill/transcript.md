# 执行记录

## 重要决策

- 按用户“研究简报”要求采用 2 页快速简报，并在验证时传入 `--brief`。
- 全程不联网、不截图、不补充外部数据；所有事实性命题只来自题设，并在 HTML 与机器台账中标为“测试数据”。
- AI算力按混合定价处理，海外景气开关开启；四支柱在测试假设下均确认，但估值闸门为 `fail`，因此权限为“共振成立，重仓权限待执行闸门确认”，不得输出“允许重仓主线核心”。
- 铜按全球定价处理，海外价格上涨与库存下降只确认 O；国内定向产业资金不明确使 C 未确认，结果为“单因子脉冲 / 禁止重仓，仅观察脉冲”。
- 国产软件按本土定价处理，O 关闭并记为 `N/A（不计分、不扣分）`；信创政策与订单条件性确认 P/C，机构资金边际流出作为 L 的恶化反证，结果为“部分共振 / 轻仓验证”。
- 评分脚本对 AI 输出“无硬支柱缺口”；报告与台账依据题设明确补充执行层最大缺口“估值闸门 fail”，这是执行闸门对支柱评分的覆盖，不修改评分脚本原始输出。
- 题设未提供公司级业务或标的证据，因此不虚构股票，台账 `coreStocks` 为空。测试输入不冒充真实来源层级，支柱 `sourceTier` 为 `null`，顶层 `sources` 为空。

## 关键命令

```text
sed -n '1,260p' .../SKILL.md
sed -n ... references/mainline-framework.md references/evidence-and-sources.md references/report-structure.md
sed -n ... schemas/mainline-tracking.schema.json scripts/score_mainlines.py scripts/validate_report.py assets/mainline-report-template.html assets/report-style.css
python3 .../scripts/score_mainlines.py work/score-input.json -o work/score-output.json
python3 -m json.tool outputs/.alpha-studio-mainline.json
python3 .../scripts/validate_report.py outputs/report.html --tracking outputs/.alpha-studio-mainline.json --brief
```

另运行本地只读语义检查，覆盖海外开关、AI估值闸门、铜的 C 封顶、国产软件 L 恶化、测试数据标记、无外部来源、非简单相加说明及重仓条件。

## 验证结果

- `score_mainlines.py`：退出码 0。
- 机器台账 JSON 解析：通过。
- `validate_report.py --brief`：`Mainline report validation passed.`
- 语义断言：12 / 12 通过。
- 简报页数：2；HTML 中“[测试数据]”显式标签 14 处；外部来源 0。

## 最终文件

- `outputs/report.html`
- `outputs/report-style.css`（使用技能资产，供 HTML 打印样式加载）
- `outputs/.alpha-studio-mainline.json`
- `outputs/metrics.json`
- `transcript.md`

评分中间件保留在 `work/score-input.json` 与 `work/score-output.json`，便于复核机械评分。

---
name: alpha-studio-intraday-monitor
description: Monitor live A-share market conditions against the trigger, upgrade, downgrade, and invalidation rules in today's existing Alpha Studio research report. Use for repeated intraday checks, scheduled trading-session monitoring, trigger alerts, thesis confirmation, and compact change-only updates. Do not generate or rewrite the original daily report.
---

# Alpha Studio Intraday Monitor

Use the latest report context supplied by Alpha Studio as the baseline. Treat the report as immutable input; never invoke, edit, or regenerate `alpha-studio-daily-theme-research`.

## Workflow

1. Confirm the baseline report date, generation time, data window, themes, stock roles, trigger rules, upgrade conditions, and invalidation conditions.
2. Verify current market data and material news with available live or public sources. State the observation time and data source.
3. Compare current evidence with every due trigger in the baseline. Classify each as `未到观察时点`, `未触发`, `部分满足`, `已触发`, `升级确认`, `降级`, or `已失效`.
4. Compare the result with the previous monitor update in the conversation. Lead with state changes; do not repeat unchanged report background.
5. Translate changes into research actions such as `继续观察`, `等待二次确认`, `只看主线核心`, `停止跟踪`, or `触发失效动作`. Never issue unconditional buy instructions.

If no usable same-day report is present in the supplied context, stop and say that盘中监控 requires today's report first. Do not silently create a replacement report.

## Output

First output a fenced JSON block that the tracking panel can ingest. Use only the exact `reportId`, `reportContentHash`, `themeId`, and `triggerId` supplied in the structured report context. Do not invent IDs. Include only conditions that were actually evaluated in this run.

```json
{
  "schema": "alpha.theme_monitor.v1",
  "reportId": "exact supplied report id",
  "reportContentHash": "exact supplied content hash",
  "observedAt": "ISO-8601 timestamp with offset",
  "events": [
    {
      "themeId": "exact supplied theme id",
      "triggerId": "exact supplied trigger id",
      "status": "not_due|not_triggered|partial|triggered|upgraded|downgraded|invalidated|data_missing|awaiting_manual",
      "evidence": "concise evidence with observation time",
      "source": "source name and URL when available",
      "confidence": 0.0,
      "marketPrice": 0.0
    }
  ]
}
```

Then keep the human-readable scheduled update compact:

```text
盘中监控｜{YYYY-MM-DD HH:mm Asia/Shanghai}
总体状态：{无变化/出现新触发/出现升级/出现失效}

变化项：
| 报告条件 | 当前证据 | 状态变化 | 研究动作 |

待观察：{next checkpoint and conditions}
来源与口径：{sources and timestamps}
风险提示：公开信息与模型化研究，不构成证券投资建议。
```

When nothing material changed, return only the timestamp, `无新增触发或失效`, the next checkpoint, and any data-quality limitation.

---
name: alpha-studio-report-review
description: Review today's existing Alpha Studio research report against actual A-share market outcomes and intraday monitor results. Use after the close for forecast-versus-result analysis, trigger audits, attribution, missed-signal review, rule calibration, and a concise next-trading-day handoff. Do not generate or modify the original daily report.
---

# Alpha Studio Report Review

Review the latest same-day report and its monitor history as immutable evidence. Never invoke, edit, or regenerate `alpha-studio-daily-theme-research`.

## Workflow

1. Identify the exact baseline report, its generation time, data window, execution gate, primary and backup attack paths, theme probabilities, trigger rules, invalidation rules, and stock-role assumptions.
2. Verify the same-day close, theme breadth, leader and central-capacity behavior, relevant announcements, and material news with timestamped sources.
3. Audit each forecast and trigger without hindsight rewriting. Mark it `命中`, `部分命中`, `未触发`, `误判`, or `数据不足`.
4. Incorporate intraday monitor updates. Distinguish whether the original report was wrong, the trigger design was weak, execution timing was late, or new information changed the market.
5. Produce reusable lessons and a next-day handoff. Do not turn the review into a new full daily report.

If no same-day report is present in the supplied context, stop and ask the user to generate or select today's report. If monitor history is absent, continue with the report and close data but state the gap.

## Output

First output a fenced JSON block for the tracking panel. Reuse only the exact report identifiers supplied by Alpha Studio and keep evidence timestamped and source-aware.

```json
{
  "schema": "alpha.theme_review.v1",
  "reportId": "exact supplied report id",
  "reportContentHash": "exact supplied content hash",
  "generatedAt": "ISO-8601 timestamp with offset",
  "score": 0,
  "missingIntradayHistory": false,
  "summary": "one-paragraph conclusion",
  "items": [
    {
      "id": "stable audit item id",
      "label": "primary route, theme, stock role, or trigger",
      "verdict": "hit|partial|not_triggered|miss|data_missing",
      "evidence": "observed result, source, and timestamp",
      "attribution": "thesis|trigger|data|new_information"
    }
  ],
  "lessons": ["reusable lesson"],
  "proposedRuleChanges": ["proposal requiring user confirmation"]
}
```

Then use this concise human-readable structure:

1. `复盘结论` — one paragraph and an overall grade.
2. `预测与实际对照` — primary route, backup route, themes, and stock roles.
3. `触发条件审计` — expected time/condition, observed evidence, status, and action quality.
4. `偏差归因` — data, thesis, lifecycle, role selection, timing, and execution-rule errors.
5. `保留 / 修改 / 删除的规则` — concrete framework changes.
6. `次日交接` — carryover themes, conditions requiring fresh confirmation, and forbidden assumptions.
7. Sources, data-quality notes, and the standard research-risk disclaimer.

Separate facts, report-time assumptions, intraday observations, and after-close judgments. Never claim that an outcome was predictable merely because it is known at review time.

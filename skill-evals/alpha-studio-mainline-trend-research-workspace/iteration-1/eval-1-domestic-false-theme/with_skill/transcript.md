# Eval 1 execution transcript

## Important decisions

- Followed `alpha-studio-mainline-trend-research` and read its framework, evidence, report structure, schema, scorer, validator, template, and stylesheet.
- Used only the supplied hypothetical facts. No web search, external research, market-data lookup, or external citation was used.
- Marked hypothetical evidence with `【测试数据】`; machine sources use `urn:test-data:*` identifiers and the publisher `结构测试题设（非外部来源）`.
- Treated all three tracks as domestic pricing; overseas-cycle status is `N/A（不计分、不扣分）`.
- Kept grid equipment at `部分共振 / 轻仓验证` because one fund-holding snapshot cannot establish a marginal direction.
- Filtered low-altitude economy as `单因子脉冲 / 禁止重仓，仅观察脉冲`; the limit-up wave is price feedback, not directed credit or long-term capital.
- Treated innovative drugs as the top test candidate with P/C/L confirmation, but withheld heavy-position permission because score, execution checks, and A/A- stock authenticity were not complete.
- Did not invent stock mappings because the prompt supplied no company-level evidence.

## Commands run

```text
python3 .../scripts/score_mainlines.py score-input.json -o scored.json
python3 .../scripts/validate_report.py outputs/report.html --tracking outputs/.alpha-studio-mainline.json
rg -n 'https?://|unresolved-template-pattern' outputs/report.html outputs/.alpha-studio-mainline.json
```

## Validation result

- Bundled validator: `Mainline report validation passed.`
- HTML page count: 8.
- External HTTP(S) links: 0.
- `【测试数据】` markers in HTML: 27.
- Optional Python `jsonschema` package was unavailable; the bundled HTML/tracking validator passed and all JSON files were parsed during validation.

## Final files

- `outputs/report.html`
- `outputs/report-style.css`
- `outputs/.alpha-studio-mainline.json`
- `outputs/metrics.json`
- `transcript.md`

---
name: alpha-studio-research-calibration
description: Measure how well Alpha Studio research probabilities match reviewed outcomes using deterministic calibration statistics. Use for probability audits, Brier scores, reliability buckets, overconfidence and underconfidence diagnosis, lifecycle or grade breakdowns, and governance recommendations based on premarket reports plus immutable reviews.
---

# Alpha Studio Research Calibration

Audit forecasts with deterministic math. Do not let a model invent realized labels or grade its own prose.

## Workflow

1. Freeze the evaluation universe, date range, report versions, and outcome definition.
2. Use only forecasts timestamped before the outcome window and reviews linked to those immutable reports.
3. Exclude `data_missing`; map the remaining reviewed verdicts according to [calibration-policy.md](references/calibration-policy.md).
4. Calculate sample size, mean forecast, mean outcome, Brier score, mean absolute error, and reliability buckets. Segment only when each group has enough observations.
5. Label small samples explicitly. Do not claim improvement from a lower score across different universes or outcome definitions.
6. Distinguish calibration quality from trading return, execution quality, and model discrimination.
7. Use `python scripts/calibrate_research.py <observations.json>` for reproducible file-based calculation.
8. Return a concise audit with the metric definition, exclusions, worst bias, and one testable rule change. Do not emit new forecasts as part of the audit.

## Alpha Studio Integration

The Research Validation page is the source of truth for the built-in calibration view. It derives observations from `alpha.premarket_theme.v2` forecasts and `alpha.theme_review.v1` outcomes. This skill is for deeper explanation and governance; the UI metrics remain deterministic.

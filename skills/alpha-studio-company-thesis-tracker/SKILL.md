---
name: alpha-studio-company-thesis-tracker
description: Create and version evidence-linked A-share company investment Theses across fundamentals, valuation, catalysts, risks, and invalidation conditions. Use for initiating coverage, updating a Thesis after filings or events, comparing the current view with a prior version, or producing auditable `alpha.company_thesis.v1` JSON for Alpha Studio.
---

# Alpha Studio Company Thesis Tracker

Maintain a falsifiable company view over time. This is a research memory workflow, not a buy/sell signal generator.

## Workflow

1. Identify the company by normalized A-share code and name. State `asOf` and the latest allowed `dataCutoff`.
2. Load the latest Thesis version when one exists. Never overwrite history or silently rewrite an old premise.
3. Gather or create `alpha.evidence.v1` records for every material new fact. Read [thesis-lifecycle.md](references/thesis-lifecycle.md) before choosing status.
4. Reassess the core Thesis, key metrics, valuation assumptions, catalysts, risks, and disconfirming evidence. Prefer explicit invalidation conditions over vague risk prose.
5. Classify the new version as `building`, `strengthened`, `unchanged`, `weakened`, `invalidated`, or `archived`.
6. Explain each material change and cite evidence IDs. Use the existing Alpha Studio fundamental, valuation, and compliance coworkers when division of work is useful.
7. Emit a concise change summary followed by exactly one fenced JSON object using schema `alpha.company_thesis.v1`.
8. Run `python scripts/validate_thesis.py <record.json>` for file-based outputs and repair all failures.

## Output Contract

Return one object with:

- `schema`: `alpha.company_thesis.v1`
- `theses`: one or more versioned Thesis records
- each record: `id`, `company`, `asOf`, `dataCutoff`, `status`, `version`, `previousVersionId`, `coreThesis`, `keyMetrics`, `valuationAssumptions`, `catalysts`, `risks`, `disconfirmingEvidence`, `invalidationConditions`, `evidenceIds`, `changeSummary`, and `nextReviewAt`

Do not cite evidence that was unavailable by `dataCutoff`. Keep missing inputs visible. Do not express false confidence through target prices or exact forecasts unsupported by the referenced evidence.

## Alpha Studio Integration

Store every accepted version. The research workbench shows the latest record per company while preserving its chain. Daily theme research may reference a Thesis, but short-term price action must not mutate long-horizon premises without new evidence.

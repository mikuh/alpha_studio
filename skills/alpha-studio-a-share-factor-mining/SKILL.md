---
name: alpha-studio-a-share-factor-mining
description: Design, mine, replicate, evaluate, compare, register, and monitor A-share quantitative factors with point-in-time data controls, complete trial accounting, multi-dimensional factor diagnostics, out-of-sample validation, multiple-testing correction, transaction-cost and capacity analysis, redundancy checks, and Stage-Gate decisions. Use when Codex needs to turn A-share market hypotheses, research papers, reports, data fields, formulas, or factor panels into auditable cross-sectional, time-series, event, fundamental, alternative-data, microstructure, or risk factors; produce factor tear sheets or factor cards; compare a candidate with an existing factor library; or determine whether a factor should be rejected, revised, shadow-tested, or promoted. Do not use for ordinary daily theme/news reports unless the task explicitly converts timestamped news or theme data into a formal factor experiment.
---

# Alpha Studio A股因子挖掘

## Objective

Operate an auditable A-share factor research pipeline. Treat factor mining as controlled experimentation, not formula fishing. Let deterministic data and backtest engines produce all numerical evidence; use the language model to formulate hypotheses, compile specifications, coordinate tools, interpret results, and propose the next valid experiment.

## Non-negotiable Guardrails

- Freeze the research contract before formal validation.
- Require point-in-time data. Track source event time, publication time, ingestion time, and earliest tradable time when applicable.
- Reconstruct the historical universe. Include delisted and failed securities where the mandate requires them; never backtest history with today's constituents.
- Model A-share tradability explicitly: ST status, suspension, price limits, T+1, board/exchange rules, lot size, corporate actions, adjustment convention, liquidity, and actual executable price.
- Record every candidate, parameter variant, label, universe, preprocessing variant, failed run, and viewed holdout result in the trial ledger.
- Keep discovery, validation, final untouched holdout, shadow, and production data roles distinct. Never tune on the final holdout.
- Never let an LLM score substitute for computed IC, returns, costs, risk, capacity, or statistical tests.
- Report raw, processed, neutralized, and tradable-portfolio results separately.
- Treat common IC, ICIR, correlation, participation-rate, and shadow-period numbers as configurable heuristics, never universal industry standards.
- Do not collapse all evidence into one compensating total score. A data-correctness failure invalidates the experiment.
- Label unavailable cost, borrow, crowding, or point-in-time evidence as `not_evaluable`; never silently pass it.
- Present results as research evidence, not guaranteed returns or personalized securities advice.

## Resolve the Task Mode

Select one or more modes and state them in the run manifest:

- `discover`: form hypotheses and generate candidate FactorSpecs.
- `replicate`: reproduce a published or existing factor with A-share-specific timing and universe rules.
- `compile`: turn text, formula, or controlled code into a normalized FactorSpec and dependency graph.
- `evaluate`: test a precomputed factor panel.
- `validate`: run walk-forward, holdout, multiple-testing, and robustness checks.
- `backtest`: translate the signal into a constrained portfolio and execution simulation.
- `compare`: measure redundancy and marginal portfolio value against an existing library.
- `publish`: freeze an approved factor package, Factor Card, and monitoring specification.
- `monitor`: assess live decay, drift, cost slippage, exposure, crowding, and retirement rules.

## Core Workflow

### 1. Create the Research Contract

Create `research_spec.json` before generating candidates. Start from `assets/research-spec-example.json` and validate against `schemas/research-spec.schema.json`.

Define:

- economic, behavioral, information, or microstructure mechanism;
- falsifiable prediction and expected direction;
- factor archetype, A-share universe, exchange/board scope, frequency, and calendar;
- feature formation interval, decision time, earliest order/fill time, holding period, and label interval;
- preprocessing, neutralization, portfolio formation, risk, cost, and capacity assumptions;
- discovery, validation, final holdout, shadow, and production boundaries;
- trial family, allowed search space, resource budget, and stopping rule.

Run:

```bash
python scripts/validate_spec.py --kind research --input research_spec.json
```

Do not proceed past formal validation when the specification has hard errors.

### 2. Route by Factor Archetype

Read `references/factor-archetypes.md`. Select the correct sample structure and primary tests:

- cross-sectional stock-selection;
- time-series directional;
- event-driven;
- fundamental;
- alternative-data or NLP;
- microstructure/intraday;
- portfolio/risk factor.

Do not use cross-sectional RankIC as the universal primary metric.

### 3. Audit A-share Data and Timing

Read `references/a-share-data-contract.md` before using any new dataset or building a production candidate.

Build `data_manifest.json` and run these audits:

- field availability and revision policy;
- announcement and ingestion latency;
- historical constituent replay;
- delisting, suspension, ST, price-limit, and corporate-action handling;
- calendar, timestamp, frequency, currency, unit, and adjustment alignment;
- time-travel recomputation on randomly selected historical cutoffs;
- tradability mask at the intended order and fill times.

Stop with `INVALID` when point-in-time or historical-universe correctness cannot be established.

### 4. Generate and Compile Candidates

Allow candidates from economic hypotheses, papers, research reports, templates, parameter grids, symbolic/evolutionary search, or LLM proposals. Convert every candidate into `factor_spec.json` using `schemas/factor-spec.schema.json`.

Prefer a controlled DSL or typed AST. Normalize the expression, hash its full semantics, and record:

- data snapshot and universe snapshot;
- source fields and `known_at` rules;
- parameters and allowed ranges;
- preprocessing and neutralization;
- formula/code version and dependencies;
- parent factor, mutation, prompt/model version, and search cost.

Run:

```bash
python scripts/validate_spec.py --kind factor --input factor_spec.json
```

Reject future references, hidden negative lags, unavailable fields, frequency mismatches, ambiguous adjustment, unbounded windows, unsafe division, and unrestricted generated code.

### 5. Maintain the Trial Ledger

Append a record before executing each run. Include unsuccessful and duplicate candidates.

At minimum record:

```text
run_id, trial_id, trial_family_id, parent_trial_id
factor_id, normalized_ast_hash
dataset_snapshot_id, universe_snapshot_id
code_commit, environment_hash, random_seed
parameters, preprocessing, label, split
status, failure_reason, metrics_uri, artifact_uri
model/prompt version, token cost, compute time
holdout_seen, created_at, owner
```

Never overwrite a prior trial after viewing results. Create a new derived trial.

### 6. Compute Factor Values

Use the customer's data/compute backend when available. Keep the skill as the orchestration layer.

Require output indexed by at least:

```text
datetime, instrument, factor_id, factor_value, available_at, quality_flags
```

Cache by the full semantic key: data snapshot, universe snapshot, normalized AST, frequency, calendar, adjustment, timing, and preprocessing version. Preserve raw values before any transformation.

### 7. Preprocess Explicitly

Apply only training-window or same-date information:

1. tradability and quality filters;
2. missing/infinite handling;
3. winsorization or robust clipping;
4. transformation;
5. cross-sectional standardization or ranking;
6. industry, size, beta, volatility, liquidity, or other declared neutralization;
7. optional orthogonalization for incremental-information tests.

Save clipping counts, missingness, excluded securities, regression design, fitted parameters, and before/after distributions. Never present neutralization as automatically superior; report the raw exposure and the residual information separately.

### 8. Run Deterministic Factor Diagnostics

Read `references/evaluation-protocol.md`.

For a cross-sectional CSV panel containing `date,instrument,factor,forward_return`, optionally `tradable`, run the bundled screening evaluator:

```bash
python scripts/evaluate_cross_section.py \
  --input factor_panel.csv \
  --output factor_metrics.json \
  --quantiles 5 \
  --min-cross-section 20
```

Treat the bundled evaluator as a portable first-pass diagnostic. It intentionally does not replace point-in-time audits, HAC/bootstrap inference, production backtesting, risk models, transaction-cost models, or capacity analysis.

Produce, as appropriate:

- coverage, missingness, distribution, outliers, and stability;
- Pearson IC, Spearman RankIC, ICIR, hit rate, and uncertainty;
- multi-horizon decay;
- quantile returns, monotonicity, Top-Bottom, and long/short leg decomposition;
- Fama-MacBeth or sample-appropriate regression;
- signal autocorrelation and turnover;
- industry, size, style, liquidity, board, exchange, and market-regime slices;
- raw, neutralized, delayed, and executable variants.

### 9. Control Research Bias

Freeze candidates and thresholds before opening the final holdout.

- Use HAC or block/bootstrap inference for serial dependence and overlapping labels.
- Use FWER methods when even one false deployment is costly.
- Use FDR when selecting multiple candidates from a broad library.
- Use White Reality Check or Hansen SPA for correlated strategy families when suitable.
- Use Deflated Sharpe Ratio for selected Sharpe inflation.
- Use PBO to diagnose the full selection process, not as a probability that a single factor is true.
- Use purging when label intervals overlap a test fold; derive embargo from the information overlap, not a universal percentage.
- Preserve one final untouched holdout or a frozen shadow book.

### 10. Translate the Signal into a Tradable Portfolio

Separate:

- signal policy;
- portfolio construction;
- risk constraints;
- execution model.

Report gross and net results under base and pessimistic assumptions. Include commissions, taxes, spread, impact, delay, price-limit/suspension failures, lot size, financing/borrow where relevant, and opportunity cost.

Scan AUM, participation rate, and rebalance frequency. Report break-even cost, break-even AUM, concentration, days-to-trade, ADV usage, and capacity limits. Do not infer capacity from turnover alone.

### 11. Test Redundancy and Incremental Value

Compare the candidate with the existing library using:

- factor-value Pearson/Spearman correlation through time;
- neutralized-value correlation;
- IC-series and factor-return correlation;
- holding and trade overlap;
- hierarchical clusters or graph communities;
- residual RankIC, partial IC, and conditional regression;
- marginal net return, Sharpe/IR, drawdown, tail risk, turnover, cost, capacity, and exposure under the same OOS constraints.

Prefer a simpler, more stable, lower-cost, higher-capacity representative when two factors carry the same information. Do not delete solely because `|rho|` crosses a heuristic threshold.

### 12. Issue a Stage-Gate Decision

Read `references/artifact-and-gate-contract.md`. Return one status:

- `INVALID`
- `REJECTED`
- `REVISE`
- `RESEARCH_ONLY`
- `SHADOW_CANDIDATE`
- `PRODUCTION_CANDIDATE`
- `APPROVED`
- `DEPRECATED`

For every gate, list:

- hard failures;
- warnings;
- evidence and artifact locations;
- confidence or uncertainty;
- `not_evaluable` dimensions;
- next permitted action;
- explicit invalidation, reduce, stop, or retirement rules.

Do not automatically promote a factor. Treat `APPROVED` as a governance decision that requires the customer's authorized process.

### 13. Package and Monitor

Copy `assets/factor-card-template.md` and populate it from machine-readable artifacts.

Freeze:

- FactorSpec and normalized AST;
- data/universe snapshots;
- code/environment hashes;
- evaluation, validation, cost, capacity, redundancy, and incremental-value reports;
- approval record, intended use, owner, and monitoring specification.

Monitor rolling IC/RankIC, net alpha, exposure, turnover, realized/model cost ratio, capacity usage, crowding, data delay, missingness, and distribution drift. Use `warning`, `reduce`, and `stop` states with thresholds calibrated from the research distribution and risk budget.

## Required Deliverables

Produce the applicable subset, and explicitly mark missing items:

```text
run_manifest.json
research_spec.json
data_manifest.json
data_audit.json
factor_spec.json
factor_lineage.json
trial_ledger.parquet|csv
factor_values_raw.parquet
factor_values_processed.parquet
factor_metrics.json|parquet
slice_metrics.parquet
multiple_testing_report.json
walk_forward_report.json
portfolio_gross_net.parquet
cost_capacity_report.json
redundancy_report.json
incremental_portfolio_test.json
gate_decision.json
factor_card.md
monitoring_spec.json
```

Lead the human report with the decision, then present evidence in this order:

```text
结论与状态
硬失败 / not_evaluable
研究假设与适用边界
数据与时点审计
预测力与衰减
稳健性与反过拟合
风险暴露与冗余
成本、容量与组合增量
下一步与失效规则
```

## Resource Map

- `references/a-share-data-contract.md`: A股 point-in-time、历史股票池、交易约束和数据审计。
- `references/factor-archetypes.md`: 因子类型识别、标签与统计方法路由。
- `references/evaluation-protocol.md`: 指标、稳健性、多重检验、成本容量和经验阈值政策。
- `references/artifact-and-gate-contract.md`: 工件、状态机、Stage-Gate 和生产监控。
- `references/dsl-and-search-policy.md`: 受限 DSL、算子类别、搜索账本和自动挖掘约束。
- `schemas/*.schema.json`: 研究、因子和评测配置的机器契约。
- `scripts/validate_spec.py`: 研究/因子 specification 的零依赖静态校验。
- `scripts/evaluate_cross_section.py`: 横截面因子的零依赖首轮 IC/RankIC/分层/自相关评测。
- `assets/research-spec-example.json`: A股日频横截面研究合同示例。
- `assets/factor-spec-example.json`: 可执行 FactorSpec 示例。
- `assets/evaluation-profile-conservative.json`: 保守但可配置的经验预警配置。
- `assets/trial-record-example.json`: 完整搜索记账的单条 trial 示例。
- `assets/sample-factor-panel.csv`: 首轮评测器的最小 CSV 输入示例。
- `assets/factor-card-template.md`: 因子准入和审计卡模板。

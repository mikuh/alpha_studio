# 因子挖掘工件与结论合同

默认交付目标是让用户看见“找到了什么、为什么入围、如何交易研究、何时失效”，而不只是收到一份评测日志。

## 1. 事实层工件

### `research_config.json`

展开后的冻结配置，包含实际执行的全部单因子定义。

### `mining_config.json`

用户或研究者在结果产生前声明的候选空间、预算、筛选门槛、去冗余阈值和组合方式。

### `trial_ledger.csv`

每个候选或参数版本一行，至少包含：

```text
run_id, trial_id, parent_trial_id, factor_name, factor_kind
parameters_json, dataset_id, universe_id, config_hash
split_role, status, failure_reason, holdout_seen, created_at
```

失败和重复 trial 也要保留。看过结果后修改配置必须创建新 trial。

### `factor_values.csv`

至少包含：

```text
date, instrument, factor_name
factor_raw, factor_clean, factor_processed
forward_return, entry_date, exit_date
tradable, split, quality_flags
```

未入围候选在 final holdout 的 `forward_return` 必须留空，并标记 `holdout_masked_not_selected`。

### `candidate_ranking.csv`

每个成功单因子和组合一行，至少包含：

```text
candidate_type, factor_name, factor_kind, parameters_json
selection_rank, selection_score, passes_gates, gate_failures
discovery_rank_ic, validation_rank_ic, validation_rank_ic_ir
validation_rank_ic_positive_ratio, validation_coverage
validation_net_sharpe, validation_max_drawdown, validation_average_turnover
redundant_with, selected_for_holdout
final_holdout_rank_ic, final_holdout_net_sharpe, holdout_assessment
```

`selection_rank` 和 `selection_score` 只能使用 discovery/validation，不能含 final holdout。
组合行还要报告相对最强成分的验证期 RankIC、净 Sharpe 和最大回撤增量，并给出 `adds_validation_value` 或 `no_increment_keep_simpler_factor`，避免把“多个因子相加”误写成“组合有增量”。不同候选集合内部计算的百分位选择分数不得直接相减。

### `factor_correlation.csv`

候选两两的验证期逐日横截面秩相关均值与有效重叠天数，用于解释去冗余。

### `daily_metrics.csv`

逐日覆盖率、IC、RankIC、各组收益、Top-Bottom、单调性和成员换手。

### `factor_metrics.json`

每个因子、每个 split 的聚合指标、限制、数据质量状态和不可评估项。

### `backtest_daily.csv`

组合日收益、毛/净值、换手、成本、持仓数量和 gross exposure。

### `top_single_factors.json`

入围单因子的公式、方向、定义、验证/留出指标和交易研究配置。

### `top_combinations.json`

入围组合的成分、权重、定权口径、验证/留出指标和交易研究配置。

### `strategy_candidates.json`

机器可读的统一候选清单。必须包含 `RESEARCH_ONLY` 等状态、选择协议、失效规则和仍不可评估的生产风险。

## 2. 人类报告

`mining_report.md` 的顺序固定为：

1. 结论、候选数量与入围数量；
2. Top 单因子、公式和验证/留出证据；
3. Top 组合、成分和权重；
4. 调仓、持有、分组和成本等交易研究配置；
5. 搜索预算、评分、去冗余和留出集协议；
6. 被淘汰原因、失效条件、限制与下一步。

每个核心数字注明 `computed`，推断注明 `inferred`，用户配置注明 `assumed`，缺失能力注明 `not_evaluable`。

## 3. 候选决策结构

```json
{
  "status": "RESEARCH_ONLY",
  "hard_failures": [],
  "warnings": [],
  "not_evaluable": ["market_impact_capacity"],
  "evidence": {
    "data": [],
    "prediction": [],
    "out_of_sample": [],
    "tradability": [],
    "incremental_value": []
  },
  "top_single_factors": [],
  "top_combinations": [],
  "next_action": "independent PIT audit and shadow validation",
  "invalidation_rules": []
}
```

合法状态：`INVALID`、`REJECT`、`REVISE`、`RESEARCH_ONLY`、`SHADOW_CANDIDATE`、`PRODUCTION_CANDIDATE`。

没有真实数据或没有运行评测时，禁止使用 `SHADOW_CANDIDATE` 或 `PRODUCTION_CANDIDATE`。

## 4. 最小聊天交付

即使用户不需要文件，回答也要包含：

- 一句话说明本轮是否找到通过门槛的候选；
- Top 单因子和 Top 组合，含公式、方向、权重；
- 调仓、持有、成交和成本假设；
- 验证集与冻结 final holdout 的真实核心指标；
- 被淘汰候选的主要原因；
- 最重要的泄漏、过拟合、容量和执行风险；
- 进入 shadow 前的最小行动。

不得只给评测流程而不产出候选；也不得为了给出推荐而降低预设门槛。没有合格项时必须明确报告“未找到”。

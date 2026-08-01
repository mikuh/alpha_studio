# Factor Card｜{{factor_name}}

## 结论与状态

- 状态：`{{status}}`
- Run ID：`{{run_id}}`
- Trial family：`{{trial_family_id}}`
- 研究负责人：`{{owner}}`
- 适用范围：`{{intended_use}}`
- 下一许可动作：`{{next_permitted_action}}`

## 硬失败与不可评估项

### Hard failures

{{hard_failures}}

### Not evaluable

{{not_evaluable}}

## 研究假设

- 机制：{{mechanism}}
- 可证伪预测：{{falsifiable_prediction}}
- 预期方向：{{expected_direction}}
- Primary archetype：{{primary_archetype}}
- 适用边界：{{scope}}
- 预期失效场景：{{expected_failure_scenarios}}

## 因子定义

- Factor ID / AST hash：`{{factor_id}}`
- 表达式或代码引用：`{{implementation}}`
- 字段与可得时点：{{data_fields_and_known_at}}
- 参数：{{parameters}}
- 预处理：{{preprocessing}}
- 中性化：{{neutralization}}

## A股数据与交易合同

- 数据快照：`{{dataset_snapshot_id}}`
- 股票池快照：`{{universe_snapshot_id}}`
- 形成/决策/成交时间：{{timing}}
- ST、停牌、涨跌停、T+1、取整：{{tradability}}
- 复权与公司行动：{{adjustment}}
- 数据审计结论：{{data_audit}}

## 预测力与衰减

{{predictive_metrics}}

## 稳健性与反过拟合

{{robustness_and_multiple_testing}}

## 风险暴露、拥挤与冗余

{{risk_crowding_redundancy}}

## 成本、容量与组合增量

{{cost_capacity_incremental_value}}

## Gate 决策

| Gate | 状态 | 关键证据 | 失败/预警 |
|---|---|---|---|
| 数据与定义 | {{gate_data}} | {{gate_data_evidence}} | {{gate_data_issues}} |
| 统计有效性 | {{gate_statistics}} | {{gate_statistics_evidence}} | {{gate_statistics_issues}} |
| 稳健性 | {{gate_robustness}} | {{gate_robustness_evidence}} | {{gate_robustness_issues}} |
| 可交易性 | {{gate_tradability}} | {{gate_tradability_evidence}} | {{gate_tradability_issues}} |
| 独特性/组合增量 | {{gate_incremental}} | {{gate_incremental_evidence}} | {{gate_incremental_issues}} |
| Shadow/生产 | {{gate_production}} | {{gate_production_evidence}} | {{gate_production_issues}} |

## 监控、降权和停止规则

{{monitor_reduce_stop_rules}}

## 证据与工件

{{artifact_links}}

> 本卡基于公开或授权数据与模型化研究流程，不构成证券投资建议或收益保证。


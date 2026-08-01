# 工件与 Stage-Gate 合同

## 工件层次

### 事实层

JSON、YAML、CSV 或 Parquet。所有图表和判断必须能回链到事实层。

### 展示层

Factor Card、HTML/PDF tear sheet、图表和摘要。不得成为唯一数据源。

### 索引层

实验注册表：run、trial、父子关系、版本、状态、指标和 artifact URI。

## 证据回链

```text
报告结论
→ metric row
→ factor value partition
→ FactorSpec / AST
→ data and universe snapshot
→ raw source/version
```

## 状态机

### INVALID

数据时点、历史股票池、公式、执行时间或可复现性存在硬错误。

### REJECTED

数据正确，但预先定义的统计、稳健性或经济证据不足。

### REVISE

存在可修复的定义、数据覆盖、实现或实验设计问题。任何修改生成新 trial。

### RESEARCH_ONLY

有研究价值，但成本、容量、可解释性、数据许可或生产可靠性不足。

### SHADOW_CANDIDATE

样本外和可交易性证据足够，允许冻结参数进入 paper/shadow。

### PRODUCTION_CANDIDATE

shadow、执行偏差和运维验证完成，等待授权审批。

### APPROVED

经客户授权治理流程批准。Skill 本身不得擅自授予该状态。

### DEPRECATED

因衰减、数据变更、成本/容量恶化、风险失控或机制失效而退役。

## Gate 0：定义和数据

硬检查：

- point-in-time；
- 历史股票池；
- 公司行动和价格口径；
- 信号、订单和成交时间；
- A股可交易约束；
- 数据、代码和环境可复现。

失败即 `INVALID`。

## Gate 1：预测和统计

- 主检验与预期方向一致；
- IC/RankIC、分层、回归或适合该 archetype 的证据相互支持；
- 重叠标签和序列依赖得到处理；
- 完整 trial count 和多重检验；
- 衰减符合交易逻辑。

## Gate 2：稳健性

- walk-forward 和封存样本；
- 时间、行业、规模、流动性、板块和状态切片；
- 参数、数据源、延迟和执行假设扰动；
- 最差窗口和失效边界。

## Gate 3：可交易性

- 基础和悲观成本后结果；
- 换手、参与率、成交天数和流动性；
- 目标 AUM 容量；
- 涨跌停、停牌、T+1、取整和借券；
- 风险、回撤和尾部预算。

## Gate 4：独特性和组合增量

- 与现有因子库聚类；
- residual/partial IC；
- 交易重叠和共同拥挤；
- 相同 OOS、风险和成本口径下的净增量。

## Gate 5：Shadow

- 冻结公式、参数、数据和执行模型；
- 研究价与真实可实现价偏差；
- 预测与实际换手/成本；
- 数据延迟、缺失和故障演练；
- 足够的独立信号和市场状态覆盖。

## Gate 6：生产和退役

监控：

- rolling IC/RankIC 和净 alpha；
- 行业/风格暴露；
- 换手和实际/模型成本比；
- 容量和拥挤；
- 数据延迟、覆盖率和分布漂移；
- 逻辑、代码、数据和规则版本。

状态：

- `warning`：调查或降低新资金；
- `reduce`：降权并启动 challenger；
- `stop`：停止使用并回滚；
- `retire`：完成退役和归档。

## 决策输出

```json
{
  "status": "REVISE",
  "hard_failures": [],
  "warnings": [],
  "not_evaluable": ["borrow_capacity"],
  "gates": {
    "data": {"status": "pass", "evidence": []},
    "statistics": {"status": "warning", "evidence": []},
    "robustness": {"status": "fail", "evidence": []},
    "tradability": {"status": "not_evaluable", "evidence": []},
    "incremental_value": {"status": "pending", "evidence": []}
  },
  "next_permitted_action": "repair data coverage and create a new trial",
  "invalidation_rules": []
}
```


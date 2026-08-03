---
name: alpha-studio-a-share-factor-mining
description: Actively discover, calculate, screen, de-redund, combine, and out-of-sample test A-share quantitative factors, then deliver ranked single-factor and multi-factor trading-research candidates with formulas, weights, rebalance/holding rules, costs, invalidation conditions, and reproducible artifacts. Use whenever the user asks to 找好因子、自动挖掘因子、量化选股、Alpha挖掘、多因子组合、因子库构建、IC/RankIC筛选、价量/价值/动量/质量/规模/情绪因子发现，or wants raw A-share price/fundamental/turnover/text data turned into a shortlist usable for backtesting or shadow trading. Also use to evaluate a specified factor, but default to mining and recommending the best evidence-supported candidates when the user asks broadly for factors. Do not use for ordinary market commentary, theme/news reports, or discretionary stock tips without measurable factor construction and testing.
---

# Alpha Studio A股量化因子挖掘

## Primary objective

默认目标不是“解释因子”或“审计一份已有回测”，而是：

```text
在用户允许的数据、股票池、持有期和搜索预算内，
主动生成候选 → 深度计算 → 严格筛选 → 去冗余 → 搜索组合
→ 冻结后做最终样本外检验 → 交付 Top 单因子与 Top 组合。
```

最终必须告诉用户：找到哪些候选、公式和方向是什么、组合权重如何、何时调仓和持有、验证/留出表现如何、何时停用、距 shadow 或实盘还缺什么。

因子不是固定有效的赚钱公式。没有真实计算就不能声称“好”；没有候选通过预设门槛时，明确报告本轮未找到，而不是降低门槛制造推荐。

## Default behavior

- 用户泛泛要求“挖掘好因子”时，默认进入 `mine`，不要停在概念介绍或让用户先给公式。
- 用户给出一个公式时，进入 `evaluate`，同时搜索少量相邻参数和互补因子，除非用户要求只评测该公式。
- 用户给出因子库时，进入 `select+combine`，先去冗余，再搜索受限组合。
- 用户给出论文、研报或自然语言逻辑时，先转成可计算候选，再进入 `mine`。
- 用户只问概念时才使用 `explain`。
- 用户要求审计现有结果时使用 `review`；审计是挖掘链路的硬约束，不是默认终点。

## Required mining workflow

### 1. Lock the trading question

先冻结最小交易研究口径：

- 目标是未来收益、风险还是组合约束；
- 股票池与历史成分；
- 日频/周频等信号频率；
- 信号形成时点、最早成交时点；
- 调仓频率、持有期、long-only 或 long-short；
- 成本、可交易性和容量假设；
- discovery、validation、final holdout；
- 什么结果会推翻候选。

若这些信息可从数据、代码或用户现有回测系统发现，直接检查并继续。只有缺失会实质改变结果的字段才询问。

### 2. Audit data readiness

检查用户提供的数据文件、列结构、数据字典和现有引擎。每个字段确认来源、单位、复权、首次可得时间、修订方式和缺失含义。

正式 A 股研究前阅读 `references/data-and-leakage.md`。以下任一项错误会使实验 `INVALID`：

- 财务数据按报告期回填而非公告可得时间；
- 使用今日已结束的收盘价形成信号又以同一收盘价成交；
- 股票池只有当前存续股票；
- 标签或标准化使用未来/全样本信息；
- 涨跌停、停牌、退市或不可成交样本被事后删除。

### 3. Build a bounded candidate space

阅读 `references/factor-catalog.md`，从现有字段能支持且有经济逻辑的因子族生成候选：

- 价值：盈利收益率、账面市值比、现金流收益率；
- 动量/反转：不同但预先限定的收益窗口；
- 质量：ROE、现金流质量、盈利稳定性、低杠杆；
- 规模：总/流通/自由流通市值；
- 波动/风险：历史波动、下行波动、beta、特质波动；
- 流动性/情绪：平均换手、换手变化、量价背离、关注度；
- 事件/文本：公告、新闻、研报、供应链等可审计时点特征。

候选定义必须同时包含公式、字段、窗口、方向、可得时点、预处理、预测期限和交易时点。限定 `max_factor_candidates`；不要默认做无约束公式枚举。

### 4. Freeze the mining configuration

复制 `assets/research-config.example.json`，填写：

- 固定种子因子 `factors`；
- 参数模板 `mining.candidate_templates`；
- 单因子与组合预算；
- 硬门槛和多指标权重；
- 去冗余阈值、组合大小与定权方式；
- 数据、股票池、切分、成本和失效条件。

使用 `schemas/research-config.schema.json` 作为机器契约，并运行：

```bash
python scripts/validate_research_config.py \
  --config research_config.json \
  --check-input
```

修复硬错误后再挖掘。结果出来后修改网格、门槛或权重必须创建新 trial。

### 5. Run automatic mining

标准长表 CSV 使用默认挖掘器：

```bash
python scripts/mine_quant_factors.py \
  --config research_config.json \
  --output-dir factor_mining_run
```

执行器会：

1. 从固定种子和参数模板展开候选；
2. 计算原始因子值和未来收益；
3. 逐日横截面去极值、标准化、行业/市值中性化；
4. 批量计算 IC、RankIC、分组收益、单调性、覆盖和换手；
5. 做成本后滚动 cohort 组合回测；
6. 仅用 discovery/validation 做门槛筛选和多指标排名；
7. 按验证期横截面相关去冗余；
8. 在去冗余 pool 上搜索等权与验证期 IC 权重组合；
9. 冻结 Top 单因子/组合后才打开 final holdout；
10. 输出可直接阅读和机器消费的候选清单。

若用户已有 Qlib、聚宽、米筐、vn.py、数据库或内部回测器，优先使用现有引擎完成同一协议；不要为了使用内置脚本而降级数据质量。

### 6. Rank on multiple dimensions

阅读 `references/mining-and-selection.md`。先过硬门槛，再按显式权重综合：

- 验证期 RankIC、ICIR、正向比例；
- 分组收益与单调性；
- 成本后 Sharpe 和净收益；
- 最大回撤；
- 换手与成本敏感性；
- discovery 到 validation 的衰减；
- 覆盖率和有效天数。

综合分数只用于研究排序。不要用一个总分掩盖方向反转、样本不足、不可成交或成本后失效。

### 7. De-redund and combine

统一方向为“因子越大，预期收益越高”，在训练/验证窗口内标准化。按因子值、IC 序列、收益、持仓和交易相关性去冗余。

只从去冗余后的候选构建组合。首个基线优先等权；学习权重只能使用 discovery/validation。组合必须重新计算横截面指标和成本后组合结果，不能把单因子指标相加。

保留真正有增量的组合：提高验证期稳健性或成本后表现、降低回撤，且 final holdout 未明显反转。若复杂组合没有样本外增量，选择更简单的单因子或等权组合。

### 8. Diagnose regimes and fragility

对入围候选做年份、牛熊/震荡、波动、流动性、行业、市值、板块和交易制度切片。检查：

- 相邻窗口是否稳定，最优点是否孤立；
- 收益是否集中在少数月份、行业或微盘股；
- 延迟一个成交时点、成本上调、股票池收紧后是否仍成立；
- 换手、冲击和容量是否使结果不可实现；
- 因子近期衰减或拥挤时的停用条件。

数据不支持的切片标记 `not_evaluable`，不要编造状态适用性。

### 9. Deliver trading-research candidates

回答先给结果，不要先长篇复述流程。至少包含：

1. 本轮是否找到通过门槛的候选；
2. Top 单因子：公式、方向、参数、经济逻辑；
3. Top 组合：成分、权重和组合增量；
4. 信号时点、成交时点、调仓频率、持有期和组合构造；
5. 验证与冻结 final holdout 的 RankIC、净 Sharpe、回撤、换手和成本；
6. 冗余/失败候选及原因；
7. 适用市场状态、失效/停用条件；
8. 进入 shadow 或实盘前的缺口。

不要把 `RESEARCH_ONLY` 候选包装成确定性交易建议。Skill 不能自行宣布 `APPROVED`，也不能承诺收益。

## Output contract

自动挖掘应产生：

```text
mining_config.json
research_config.json
trial_ledger.csv
candidate_ranking.csv
factor_correlation.csv
factor_values.csv
daily_metrics.csv
factor_metrics.json
backtest_daily.csv
top_single_factors.json
top_combinations.json
strategy_candidates.json
mining_report.md
```

详细字段见 `references/output-contract.md`。未入围候选的 final holdout 收益必须遮蔽；`selection_score` 永远不能使用 final holdout。

若用户只要求评测一个已知因子，可使用：

```bash
python scripts/run_factor_research.py \
  --config research_config.json \
  --output-dir factor_evaluation_run
```

该脚本是单因子/指定组合评测基线；广义“帮我找好因子”必须优先使用 `mine_quant_factors.py`。

## Truthfulness rules

- 区分 `computed`、`inferred`、`assumed`、`not_evaluable`。
- 不把演示或合成数据结果描述成真实市场证据。
- 不把相关性写成因果，不把回测写成收益保证。
- discovery 用于探索，validation 用于选择，final holdout 只评测冻结名单。
- 保留成功、失败、重复和预算淘汰 trial；不得只展示幸存者。
- 当前交易规则、费率或板块制度必须查交易所、监管机构或券商最新正式资料并注明生效日期。
- 输出仅用于量化研究，不构成个性化投资建议。

## Resource map

- `references/mining-and-selection.md`：候选生成、评分、去冗余、组合和冻结留出集协议。
- `references/factor-catalog.md`：因子族、公式、字段、默认小网格与失效机制。
- `references/data-and-leakage.md`：PIT、历史股票池、标签和 A 股可交易性。
- `references/evaluation-and-backtest.md`：IC、分组、成本、回撤、容量和组合评测。
- `references/output-contract.md`：Top 候选、排名、账本和报告字段。
- `schemas/research-config.schema.json`：研究与挖掘配置契约。
- `assets/research-config.example.json`：种子因子 + 参数网格 + 组合搜索示例。
- `assets/input-columns.example.csv`：输入长表列结构示例。
- `scripts/validate_research_config.py`：配置、候选空间和防泄漏静态检查。
- `scripts/mine_quant_factors.py`：默认自动候选生成、筛选、去冗余、组合与冻结留出执行器。
- `scripts/run_factor_research.py`：指定因子评测与回测基线。

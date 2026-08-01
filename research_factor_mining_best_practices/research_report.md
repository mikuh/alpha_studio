# 各类量化因子挖掘与多维测评 Skill：行业最佳流程调研

> 日期：2026-07-23  
> 目标：为后续设计一个可扩展、可复现、可审计的量化因子挖掘与测评 Codex skill 建立方法与工程基线。  
> 范围：以横截面选股因子为主，兼顾时间序列、事件、另类数据、微观结构及跨资产因子。

## 一、结论

行业最佳实践不是“批量生成公式 → 按 IC/Sharpe 排名”，而是一套带有以下约束的研究制度：

1. 先冻结研究假设、数据可得时点、预测目标、交易延迟和允许搜索空间；
2. 用 point-in-time 数据和历史可投资股票池消除未来函数、幸存者偏差和回填污染；
3. 将所有候选、参数变体和失败记录写入 trial ledger；
4. 用确定性执行器计算因子值和指标，LLM 只负责提出假设、生成可执行定义、解释和调度搜索；
5. 同时做因子预测力、稳健性、风险暴露、交易成本、容量、拥挤度、冗余和组合增量测试；
6. 进行多重检验修正、walk-forward 和一次性最终 holdout；
7. 通过 shadow/paper trading 后才可成为生产候选；
8. 上线后持续监控、降权、停用和版本回滚。

因此，这个 skill 应被设计为一个“研究编排与治理层”，而不是一个巨型 Python 脚本，也不是一个仅输出 tear sheet 的分析助手。

## 二、推荐的端到端 Stage-Gate 流程

| 阶段 | 核心动作 | 关键产物 | 失败处理 |
|---|---|---|---|
| 0. 研究契约 | 定义假设、因子类型、资产、股票池、频率、预测期、执行延迟、成本、参数空间和试验族 | `research_spec`、`research_card` | 未冻结则不得开始正式验证 |
| 1. 数据与时点审计 | PIT、历史股票池、退市、公司行动、公告时间、修订版本、交易日历、可交易掩码 | `data_manifest`、`data_audit` | 硬失败，结果无效 |
| 2. 生成与编译 | 人工假设、论文、模板、LLM、遗传/树搜索统一转成 FactorSpec 和 typed AST | `factor_spec`、`ast`、`lineage` | 非法公式、未来引用、频率/单位错误直接拒绝 |
| 3. 批量计算 | DAG、公共子表达式、语义哈希缓存、幂等任务、失败重试 | 原始 `factor_values` | 计算失败或不可复现则不得测评 |
| 4. 预处理 | 缺失、去极值、变换、标准化、中性化、正交化；原始版与处理版并存 | processed values、preprocess log | 禁止隐式处理或只保留最漂亮版本 |
| 5. 单因子测评 | IC/RankIC、ICIR、分层、单调性、long-short、衰减、覆盖率、暴露和切片 | factor metrics、tear sheet | 进入 reject/revise/watch，而非只看总分 |
| 6. 样本外与反过拟合 | 多重检验、HAC/bootstrap、walk-forward、purge/embargo、最终 holdout | OOS、FDR/DSR/PBO 报告 | OOS 反转或试验账本缺失不得上线 |
| 7. 组合与交易验证 | 信号映射、组合构建、风险约束、订单和执行；毛/净收益并列 | trades、positions、net backtest | 成本后无效或容量不足则 research-only/reject |
| 8. 去冗余与准入 | 相关聚类、残差 IC、条件 IC、组合净增量、人工治理 | gate decision、factor card | 输出明确失败原因和适用边界 |
| 9. 发布与监控 | 冻结发布包、shadow、生产监控、champion/challenger、退役 | package、monitor spec | 触发 warning/reduce/stop |

### 三类闸门必须分开

- **正确性硬闸门**：PIT、未来函数、历史股票池、执行时点、可复现性。失败即整次实验无效。
- **统计与经济证据闸门**：预测力、稳健性、样本外、多重检验、机制解释。可输出证据等级，但不能用漂亮的单项指标掩盖失败维度。
- **业务经验闸门**：最低净收益、目标容量、暴露预算、参与率、shadow 观察期等，由客户 mandate 决定。

## 三、因子类型不能强行共用一种评估模板

Skill 应先识别 `factor_archetype`，再路由到对应评测器：

| 因子类型 | 主要对象 | 默认核心评测 |
|---|---|---|
| 横截面选股 | 同一时点证券排序 | RankIC、分层、Fama–MacBeth、long-short、行业/风格中性 |
| 时间序列方向 | 单资产跨时间预测 | 实时递归预测、OOS R²、HAC alpha、仓位与成本回测 |
| 事件因子 | 公告/事件后的相对收益 | 事件窗、cluster/block bootstrap、信息发布时间、同日多事件聚类 |
| 基本面因子 | PIT 财务和预期数据 | 公告/修订时点、报告滞后、行业可比性、季节性和缺失机制 |
| 另类数据/NLP | 文本、流量、供应链等 | 数据许可、覆盖偏差、实体映射、时间戳、供应商稳定性和漂移 |
| 微观结构/高频 | 盘口、逐笔、成交行为 | 撮合语义、延迟、盘口可见性、冲击、日内分段和容量 |
| 风险/组合因子 | 共性收益或风险暴露 | 因子收益、解释度、协方差稳定性、组合风险和归因 |

横截面 IC 很适合股票排序信号，但不能成为所有因子的通用主指标。

## 四、多维测评矩阵

### 1. 数据与定义

- 覆盖率、缺失率、异常率、更新频率、数据延迟；
- `known_at <= decision_time`；
- 数据修订、公司行动、退市、停牌、成分历史；
- 公式、数据快照、代码、环境、随机种子可复现。

对 A 股还应把 ST、停牌、涨跌停、T+1、不同交易时段、复权、流通股本变化、公告实际可得时点和真实可成交价写入显式配置，不能藏在回测器默认值中。

### 2. 预测力

- Pearson IC 与 Spearman RankIC；
- mean/median、ICIR、命中率、HAC/bootstrap 置信区间；
- 多预测期 IC decay；
- 5/10 分组收益、Top-Bottom、单调性和两端贡献；
- Fama–MacBeth 或适合相应样本结构的回归；
- 原始、标准化、中性化和可交易组合结果并列。

### 3. 稳健性

- rolling/expanding walk-forward；
- 年度、季度、牛熊、高低波动和流动性状态；
- 行业、市值、价格、上市年龄、流动性和可借券性；
- 参数邻域、信号延迟、调仓日、成交价和数据源替代；
- 跨市场或异时期复现；
- 最差窗口与连续失效期。

### 4. 反过拟合

- 完整试验数和候选间相关性；
- FWER/FDR；必要时 White Reality Check 或 Hansen SPA；
- Sharpe 选择偏差用 Deflated Sharpe Ratio；
- 整个候选选择流程的过拟合风险可用 PBO；
- 最终 holdout 只允许在研究冻结后开启一次。

[Harvey、Liu、Zhu](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2249314)提出大规模因子搜索背景下传统 `t > 2` 过宽，并给出 `t > 3` 的保守参考；该数值依赖研究集合和假设，不能写成所有市场的通用录取线。[Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)则要求把实际搜索试验数和非正态收益计入 Sharpe 可信度。

### 5. 可交易性

- 信号 rank autocorrelation、分层成员换手、组合权重换手；
- 佣金、税费、点差、冲击、延迟、借券、融资和成交失败；
- gross/net 收益和悲观成本情景；
- AUM × 参与率 × 调仓频率容量曲面；
- break-even cost 和 break-even AUM；
- 持仓集中度、ADV 使用、调仓天数和可借券覆盖。

[Research Affiliates / CFA 的因子交易成本研究](https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/0015198x-2019-1567190)强调：同名因子的实际成本会因换手、流动性、交易规模和成交集中度而显著不同，因此不能只使用固定 bps。

### 6. 风险、拥挤和冗余

- market beta、行业、规模、价值、动量、质量、波动、流动性等暴露；
- common factor 与 specific alpha 归因；
- 因子值相关、IC 相关、收益相关、持仓/交易重叠；
- residual RankIC、partial IC、条件回归；
- 拥挤度：相关/波动、估值、short interest、近期追涨、基金持仓/流量；
- 在同一 OOS、风险约束和成本模型下的组合净增量。

[MSCI 的容量研究](https://www.msci.com/research-and-insights/blog-post/what-drives-the-capacity-of-factor-index-strategies)显示，权重约束、换手限制、流动性过滤和错峰/分散调仓可改善容量；[MSCI Factor Crowding](https://developer.msci.com/apis/factor-crowding-model-v3)也采用多指标合成，而非单一拥挤指标。

## 五、关于阈值：行业没有统一答案

下列数值可作为 `default_profile` 的预警起点，但输出中必须标记为 `heuristic`，不能标记为 `industry_standard`：

| 指标 | 可用作初始观察值 | 备注 |
|---|---:|---|
| mean RankIC | `|0.01–0.03|` | 与样本量、频率、股票池、预测期和成本联判 |
| ICIR（未年化） | `0.3–0.5` watch，`>0.5` 较强候选 | 必须说明口径，不能跨频率直接比较 |
| IC 正向命中率 | `55%–60%` | 给置信区间和连续失效期 |
| 因子相关 | `|rho| > 0.7–0.8` 触发复核 | 触发残差化和增量测试，不直接删除 |
| 参与率 | `5%–10% ADV` 压力档 | 与市场、资产和执行能力绑定 |
| 成本安全边际 | 悲观场景净 alpha 仍为正 | 成本占毛 alpha 的 30%–50% 只可作治理起点 |
| shadow | 日频 1–3 个月起步 | 更合理的标准是独立信号数与市场状态覆盖 |

更好的产品设计是：

- 硬闸门只用于数据正确性和治理缺失；
- 统计阈值按试验数、样本长度和不确定性动态校准；
- 业务阈值从客户的净 Sharpe/IR、AUM、风险预算和交易约束反推；
- 排名使用 Pareto 前沿，不用一个可被“刷分”的综合总分。

## 六、建议的 Skill 架构

### 1. Skill 负责什么

- 理解目标并生成研究契约；
- 将候选统一为 FactorSpec；
- 编译和静态审计；
- 调用客户已有的数据、计算、实验追踪和回测引擎；
- 执行 Stage-Gate；
- 汇总机器可读 artifact 和人类报告；
- 生成明确的 reject/revise/shadow/production_candidate 决策。

### 2. Skill 不负责什么

- 不用 LLM 主观判断代替真实计算；
- 不让自由 Python 无限制接触生产数据和执行环境；
- 不把旧版 Alphalens、pyfolio 或某个回测器写死为唯一底座；
- 不在最终 holdout 上自动调参；
- 不只保存 winner。

### 3. 推荐模块

```text
factor-mining-skill/
├── SKILL.md
├── schemas/
│   ├── research_spec.schema.json
│   ├── factor_spec.schema.json
│   ├── evaluation_spec.schema.json
│   └── backtest_spec.schema.json
├── scripts/
│   ├── validate_spec.py
│   ├── compile_factor.py
│   ├── run_batch.py
│   ├── evaluate_factor.py
│   ├── compare_factors.py
│   ├── run_portfolio_backtest.py
│   └── package_factor.py
├── adapters/
│   ├── data/
│   ├── compute/
│   ├── tracker/
│   └── backtest/
├── references/
│   ├── operator_catalog.md
│   ├── metric_catalog.md
│   └── gate_policy.md
└── templates/
    ├── factor_card.md
    └── report.html
```

### 4. 推荐能力面

- `discover`：从经济逻辑、研报、字段、模板生成候选；
- `compile`：DSL → typed AST/DAG，并检查未来引用和时点；
- `compute`：批量计算、缓存、血缘和错误恢复；
- `evaluate`：因子层多维测评；
- `validate`：walk-forward、跨市场、最终 OOS 和多重检验；
- `backtest`：组合/订单/执行层净收益；
- `compare`：聚类、冗余、条件信息和 Pareto 排名；
- `publish`：Factor Card、发布包和监控规则；
- `reproduce`：按 run ID 重放和校验 hash；
- `benchmark-agent`：单独评测模型的生成、判断和搜索能力。

## 七、推荐的技术组合

没有单一框架完整覆盖需求，合理组合是：

- **Qlib 式数据与 workflow 骨架**：数据层、表达式、缓存、配置化流程和实验 recorder。[Qlib 官方仓库](https://github.com/microsoft/qlib)
- **WorldQuant 式公式资产化**：紧凑表达式、统一执行语义和可枚举搜索空间。[101 Formulaic Alphas](https://arxiv.org/abs/1601.00991)
- **Alphalens 式因子测评契约**：returns、IC、turnover、grouped analysis，但建议内部重写/封装，不直接绑定历史仓库。[Alphalens 文档](https://quantopian.github.io/alphalens/)
- **可替换组合回测层**：Qlib 或客户现有引擎；FinRL-X 仅作为高级动态策略验证器。
- **MLflow 式实验注册**：每次运行保存参数、指标、artifact、状态、父子关系和版本。
- **RD-Agent(Q) 式研究—开发—反馈闭环**：假设、实现、评价、调度分离。[R&D-Agent(Q)](https://arxiv.org/abs/2505.15155)
- **AlphaBench 式 agent 评测**：生成、评价、搜索分别测；真实执行器是数值裁判。[AlphaBench 2026](https://alphabench.cc/)

AlphaBench 的重要发现是：LLM 能生成和搜索可执行因子，但脱离执行器直接预测因子数值质量仍然较弱。因此数值准入必须来自固定数据和确定性引擎。

## 八、MVP 建议

第一版不建议追求数千算子或全自动“挖矿”。应先打通八项：

1. 不可变数据快照和 PIT 审计；
2. FactorSpec + typed AST；
3. 未来函数、频率、单位和窗口静态检查；
4. 可缓存的批量计算；
5. 单因子多维明细和可读 tear sheet；
6. trial ledger、多重检验和严格 OOS；
7. 成本后组合回测及容量情景；
8. 因子注册、准入状态、失败原因和全链路 artifact。

MVP 稳定后，再增加：

- 论文/研报到因子；
- LLM、遗传编程、MCTS 和演化式搜索；
- NLP/另类数据适配器；
- 自动去冗余和组合构建；
- 因子与模型联合优化；
- 生产监控和自动退役。

## 九、必须避免的反模式

1. 只保存最终公式、IC 和 Sharpe；
2. 用当前成分股回测历史；
3. 用最新修订财务数据覆盖历史可见版本；
4. 生成和评估反复查看同一个 holdout；
5. 大量搜索后不记录试验数、不做多重检验；
6. 把分层收益直接当作真实可成交策略；
7. 只用固定 bps，不做冲击、容量和借券；
8. 只按公式文本查重；
9. 让 LLM 自己给因子质量打分并直接准入；
10. 只有图，没有可复算明细、数据血缘和 run manifest。

## 十、最终建议

客户需要的不是“一个会找高 IC 因子的 prompt”，而是一套因子研究操作系统的 skill 化入口：

> 受约束的因子生成 + 确定性执行评测 + 完整搜索账本 + 样本外治理 + 成本/容量/风险/冗余验证 + 可审计发布与监控。

首版最值得投入的部分不是生成能力，而是实验合同、数据正确性、评测标准化和可复现性。底座正确以后，各类自动挖掘算法才能成为安全的插件；否则自动化只会更快地产生过拟合。

## 十一、详细分项调研

- [学术与统计方法](./findings_academic.md)
- [工程平台与开源框架](./findings_platforms.md)
- [多维评测与上线闸门](./findings_evaluation.md)


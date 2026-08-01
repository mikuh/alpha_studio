# 因子挖掘工程平台与开源框架调研

> 子课题：工程与平台流程  
> 调研日期：2026-07-23  
> 范围：Qlib、Alphalens/pyfolio、WorldQuant BRAIN / Fast Expression / 101 Formulaic Alphas、FinRL/FinRL-X，以及它们对 Codex 因子挖掘 skill 的启示。  
> 证据优先级：官方文档、官方仓库、原始论文。WorldQuant BRAIN 的详细算子文档需要登录，本文对其非公开阈值和细节不作事实断言。

## 一、结论摘要

没有一个现成框架完整覆盖“自动提出各类因子 → 大规模计算 → 多维评测 → 去冗余 → 组合回测 → 审批发布”的全部需求。行业最佳做法更像四种设计范式的组合：

1. **Qlib 做工程主干**：数据提供器、表达式引擎、DataLoader/DataHandler/Dataset、缓存、配置化 workflow、实验记录器、信号分析和组合回测形成一条较完整的流水线。
2. **Alphalens/pyfolio 做评测边界**：Alphalens 负责因子层的收益、IC、换手和分组分析；pyfolio 负责策略/组合层的收益与风险。两者清楚地说明“因子有效性”和“组合可投资性”不应混成一份统计表。
3. **WorldQuant 做因子资产化范式**：Fast Expression 和《101 Formulaic Alphas》强调用紧凑公式描述因子，使公式可枚举、变异、批量仿真、查重和复用。关键不是照搬算子，而是让“公式 + 数据域 + 时点语义 + 参数 + 中性化设置”成为可哈希、可审计的中间表示。
4. **FinRL/FinRL-X 做分层与防泄漏范式**：数据、市场环境、策略/智能体通过稳定接口解耦，严格分开 train/test/trade；生产版还进一步走向类型化配置、专业回测引擎和多层风险控制。它更适合指导下游策略验证，不适合作为单因子研究的主测评引擎。
5. **AlphaBench 与 RD-Agent(Q) 做自动研发闭环范式**：2026 年的最新证据表明，LLM 更适合生成和搜索候选，不适合脱离真实执行结果做零样本量化评分；自动因子挖掘必须由确定性执行器、结构化反馈、搜索预算和完整轨迹约束。

因此，面向客户的 skill 不应只是“调用某个库生成 tear sheet”，而应是一个**带 Stage-Gate、数据血缘、统一因子 IR、批量执行器、评测插件、实验注册表和发布包的研究操作系统**。

## 二、平台对比

| 维度 | Qlib | Alphalens / pyfolio | WorldQuant BRAIN / Fast Expression | FinRL / FinRL-X |
|---|---|---|---|---|
| 核心定位 | 一体化量化研究 workflow | 因子诊断与组合风险分析工具 | 托管式大规模 alpha 研究/竞赛平台 | 强化学习交易研究与部署架构 |
| 数据层 | Provider → Loader → Handler → Dataset；含处理器、切片、缓存、PIT 设计 | 接收已对齐的 factor、价格、分组、收益/持仓等，不负责数据治理 | 平台提供数据集、数据字段和工具；公开页称含 40 万+字段 | DataOps；多数据处理器/数据源，环境层封装市场状态 |
| 因子表达 | 字符串表达式与 Python ExpressionOps；支持自定义 Operator | 无 DSL，输入是已计算好的因子序列 | Fast Expression；公式化 alpha 是核心资产 | 无通用因子 DSL，特征通常由 Python 数据处理器产生 |
| 批量计算 | `D.features` 按股票池×字段×区间；表达式缓存和数据集缓存 | 单因子/因子表分析，批量编排需外置 | 托管仿真、排行榜/看板，适合大量公式探索 | 训练/测试多个智能体；不专注海量公式因子计算 |
| 实验追踪 | ExpManager → Experiment → Recorder；MLflow 实现；参数、指标、对象、artifact | 原生偏 notebook/tear sheet，无实验注册表 | 平台 performance dashboard 与 value-add measures；内部追踪细节不公开 | 经典版偏研究脚本；现代生产化能力转向 FinRL-X |
| 因子测评 | SignalRecord 可记录 IC 等；PortAnaRecord 做组合分析 | Alphalens：收益、IC、换手、分组；pyfolio：组合收益与风险 | 平台实时构建/测试 alpha，并提供表现看板 | 通过统一市场环境和基准比较策略，强调净收益与市场摩擦 |
| 回测 | 策略、执行、交易成本、涨跌停、基准、持仓和风险分析均可配置 | Alphalens 不是交易回测器；通常配 Zipline，结果交给 pyfolio | 托管仿真，公开资料未披露完整撮合语义 | 环境型回测；含成本、流动性、风险厌恶；FinRL-X 转向专业 `bt` 引擎 |
| 可复现性 | YAML workflow、固定数据切片、标准 Record；仍需补数据版本、环境锁定和随机种子 | 输入表稳定时结果可复现，但数据血缘和环境需外部管理 | 公式天然易序列化；平台数据版本和精确引擎语义受平台控制 | train/test/trade 隔离、标准环境有利于公平比较；经典版生产配置能力有限 |
| 主要产物 | 配置、模型、预测、IC、组合报告、持仓、指标、artifact | factor_data、tear sheet、图表；策略层 tear sheet | alpha 公式、仿真表现、看板/排名 | 预处理数据、训练模型、回测结果、交易接口 |
| 对 skill 的最主要价值 | 主流程和接口范本 | 测评模块边界与报告范本 | 因子 DSL、搜索空间和公式资产化 | 防泄漏分段、执行环境和生产风险分层 |

## 三、逐个平台的关键做法

### 3.1 Qlib：最接近“因子研究操作系统”的开源骨架

#### 数据层

Qlib 把数据流程拆为 Provider、DataLoader、DataHandler、Dataset。基础行情可转换成 Qlib 二进制格式；公式化特征由表达式引擎按需计算；DataHandler 再执行缺失处理、去异常、归一化等 Processor；Dataset 负责训练/验证/测试切片。官方示例 Alpha158/Alpha360 既是预制因子集，也是“因子配置如何落到可计算字段”的参考实现。

其突出工程点是两级缓存：

- `ExpressionCache`：缓存单个表达式在单个资产上的计算结果。
- `DatasetCache`：按股票池配置、表达式列表、频率等形成数据集缓存。

这说明因子平台的缓存键不能只用公式文本，至少还应包含数据快照、资产池、频率、复权口径、时区/交易日历、时点语义和预处理版本。

来源：[Qlib Data Layer: Data Framework & Usage](https://qlib.readthedocs.io/en/latest/component/data.html)

#### 因子表达 DSL

Qlib 同时支持字符串表达式，如 `Ref($close, 60) / $close`，以及 Python 对象式 `Feature`/`ExpressionOps`；复杂因子可以组合已有算子，也可注册自定义 Operator。这个“双前端、单执行语义”的设计很适合 skill：

- 面向用户和 LLM 使用简洁 DSL；
- 内部先解析为 AST/IR；
- 需要新数据类型或复杂逻辑时落到受控 Python 插件；
- 无论入口为何，最终都生成同一份规范化因子定义和哈希。

来源：[Qlib Data Retrieval](https://qlib.readthedocs.io/en/stable/start/getdata.html)、[Qlib Building Formulaic Alphas](https://qlib.readthedocs.io/en/latest/advanced/alpha.html)

#### 配置化 workflow 与实验追踪

Qlib 的 `qrun configuration.yaml` 把数据加载/处理/切片、模型训练/预测、信号评估和回测串在一次 execution 中。配置记录 class、module_path、kwargs 以及 train/valid/test 区间，适合批量生成和重放。

实验层为 `ExperimentManager → Experiment → Recorder`，并提供基于 MLflow 的实现。Recorder 可记录 params、metrics、tags、预测文件、模型 checkpoint 和任意 artifact，且有运行状态与 resume 能力。`search_records` 能把不同运行的参数和指标展开为表格比较。

来源：[Qlib Workflow Management](https://qlib.readthedocs.io/en/stable/component/workflow.html)、[Qlib Recorder: Experiment Management](https://qlib.readthedocs.io/en/stable/component/recorder.html)

#### 回测与产物

Qlib 用 `SignalRecord` 保存预测/信号分析，用 `PortAnaRecord` 保存组合分析。策略和撮合假设是显式配置：如 Top-k/换仓规则、成交价、手续费、最低费用、涨跌停限制、账户资金和基准。因此因子评测不应直接从 IC 跳到 Sharpe，而应通过显式的“信号 → 组合构建 → 执行假设 → 净收益”链条。

来源：[Qlib Workflow Management — Record Section](https://qlib.readthedocs.io/en/stable/component/workflow.html#record-section)、[Qlib Portfolio Strategy](https://qlib.readthedocs.io/en/stable/component/strategy.html)

#### 局限

- Qlib 的表达式和缓存解决了计算效率，但不自动解决数据供应商修订、幸存者偏差和 point-in-time 数据质量。
- YAML 配置增强可重放性，但仍必须额外记录数据快照 ID、代码 commit、容器/依赖锁、随机种子、硬件和时区。
- 它的 Record 范本不能替代一套面向多重检验、容量、拥挤度、相关簇和稳定性的完整因子准入规则。

### 3.2 Alphalens / pyfolio：把“因子诊断”和“组合风险”分开

Alphalens 的输入契约非常清楚：先用因子值、价格、分位数组和行业分组生成清洗后的 `factor_data`，再生成 tear sheet。官方列出的四类核心分析是：

- Returns Analysis；
- Information Coefficient Analysis；
- Turnover Analysis；
- Grouped Analysis。

这对应单因子研究最基础的四问：是否有收益、是否有预测秩序、是否能稳定持有、是否只是行业/分组效应。

来源：[Quantopian Alphalens official repository](https://github.com/quantopian/alphalens)

pyfolio 则接收策略/组合层结果，生成覆盖收益和风险的组合 tear sheet；官方说明其与 Zipline 回测器配合。原 Quantopian 生态的合理分工是：

`因子序列 → Alphalens 因子诊断 → Zipline 组合/交易回测 → pyfolio 组合风险`

来源：[Quantopian pyfolio official repository](https://github.com/quantopian/pyfolio)

#### 对现代平台的启示

1. 因子测评器不应同时承担订单撮合。
2. 因子层与组合层应使用不同数据契约和指标命名空间。
3. tear sheet 应是实验 artifact，而不是唯一数据源；每张图背后的明细表必须可机器读取。
4. 原 Quantopian 仓库属于历史生态，尤其 pyfolio 官方仓库页面显示最新 release 为 2019 年。应借鉴接口和统计结构，不宜把旧仓库直接作为生产底座；实现时应封装适配层，允许替换为维护中的 fork 或内部实现。

### 3.3 WorldQuant BRAIN / Fast Expression / 101 Formulaic Alphas：公式即资产

WorldQuant BRAIN 的公开官网把它定义为交互式量化研究仿真平台，提供数据集和工具、performance dashboard、value-add measures，并允许用户实时构建和测试 alpha。公开页还显示平台覆盖 40 万+数据字段。其价值不只是计算资源，而是把研究对象标准化为可提交、可评分、可比较的 alpha。

来源：[WorldQuant BRAIN: Crowdsourcing Quantitative Research](https://www.worldquant.com/brain/)

Fast Expression 的详细算子说明位于需登录的 BRAIN 学习区，公开网络无法可靠核验其当前完整语法、仿真阈值和提交规则。因此，本调研只提炼其可验证的架构特征：用受限表达式组合数据字段和算子，通过统一仿真引擎批量测试，再由表现看板比较。

官方入口：[WorldQuant BRAIN — Detailed Operator Descriptions](https://platform.worldquantbrain.com/learn/data-and-operators/detailed-operator-descriptions)

《101 Formulaic Alphas》提供了 101 个“公式同时也是代码”的真实量化 alpha。论文摘要报告：平均持有期约 0.6–6.4 天，平均两两相关性 15.9%，收益与波动率强相关，而换手对 alpha 相关性的解释力较弱。这带来两个重要工程结论：

1. **公式库不是策略库**：同一公式必须在不同持有期、波动状态、资产域和成本条件下重新检验。
2. **低公式相似度不等于低收益相关性**：去重不能只比 AST 或文本，还要比因子值相关、IC 相关、收益相关和共同暴露。

来源：[Zura Kakushadze, 101 Formulaic Alphas](https://arxiv.org/abs/1601.00991)

#### 对 skill 的 DSL 设计启示

每个因子应保存为不可变 `FactorSpec`，至少包含：

```yaml
factor_id: sha256(...)
name: ts_mean_reversal_20
expression: rank(-(close / ref(close, 20) - 1))
ast_version: "1"
data_fields: [close]
universe: csi500
frequency: 1d
availability_lag: 1d
adjustment: forward_adjusted
calendar: XSHG
preprocess:
  winsorize: mad_3
  standardize: cross_section_zscore
  neutralize: [industry, log_market_cap]
parameters:
  window: 20
hypothesis: "中期超涨后的横截面均值回归"
```

DSL 编译链应为：

`文本/模板 → parser → typed AST → 时点与窗口检查 → 规范化序列化 → hash → 计算 DAG → 缓存/执行`

必须在执行前静态拒绝未来引用、不可获得字段、频率错配、无界窗口、除零/无穷处理不明以及横截面/时序维度不匹配。

### 3.4 FinRL / FinRL-X：分层、防泄漏和可替换执行环境

FinRL-Meta 官方文档采用 data layer、environment layer、agent layer 三层结构，并把 DataOps 流程描述为：

`任务规划 → 数据访问/清洗/特征工程 → training-testing-trading → 表现监控`

其文档明确指出，分离 training、testing 和 trading 可以降低信息泄漏，并让不同算法在相同环境下公平比较。环境层把交易成本、流动性和风险厌恶等市场摩擦放入模拟器。

来源：[FinRL-Meta Overview](https://finrl.readthedocs.io/en/latest/finrl_meta/overview.html)、[FinRL Three-layer Architecture](https://finrl.readthedocs.io/en/latest/start/three_layer.html)、[FinRL: Deep Reinforcement Learning Framework to Automate Trading in Quantitative Finance](https://arxiv.org/abs/2111.09395)

截至本次调研，FinRL 官方仓库已明确把经典 FinRL 定位为教育、基准和研究原型，并推荐新生产系统使用 FinRL-X / FinRL-Trading。官方对比指出，FinRL-X 转向全解耦模块、类型化 Pydantic 配置、专业 `bt` 回测、多账户实盘接口和订单/组合/策略多层风险控制。

来源：[AI4Finance-Foundation/FinRL official repository](https://github.com/AI4Finance-Foundation/FinRL)、[AI4Finance-Foundation/FinRL-Trading](https://github.com/AI4Finance-Foundation/FinRL-Trading)、[FinRL-X paper](https://arxiv.org/abs/2603.21330)

#### 对因子 skill 的边界

- 可借鉴：分层接口、train/test/trade 隔离、统一市场环境、摩擦建模、基准对比、生产风险控制。
- 不宜照搬：用 RL reward 代替因子统计检验；把智能体训练流水线当成大规模公式因子计算器。
- 最佳接法：skill 在上游产出经过准入的信号/因子面板；FinRL 类环境作为可选的下游动态决策验证器。

### 3.5 AlphaBench 2026 与 RD-Agent(Q)：自动挖掘必须是“执行反馈闭环”

#### AlphaBench：评测 LLM 的对象不能只看公式可读性

AlphaBench 是 ICLR 2026 的公式化因子挖掘 benchmark。它把任务拆成三个层次：

1. **Generation**：生成语法可执行的公式；
2. **Evaluation**：在候选池中排序，或预测 IC、RankIC、胜率、偏度、信号类型等指标；
3. **Searching**：结合真实执行反馈进行多轮搜索。

其工具链包含可执行金融 DSL、FFO 执行/评测引擎和 Qlib 回测，并用 NDCG、Precision、MAE/RMSE 以及搜索后的 IC 改善、成本效率、探索多样性等指标衡量 agent，而不只看最终最优公式。官方总结的关键发现包括：

- LLM 生成因子时语法有效率较高，也能进行有效的搜索探索；
- LLM 的零样本定量评分能力弱，脱离执行上下文时语义落地不足；
- 复杂 Chain-of-Thought 未必优于朴素提示；
- 演化式搜索优于单路径逐步修正；
- 中等规模商业模型在其实验中表现出更好的成本—效果权衡。

这直接否定了“让一个强模型看公式后自行给因子打分”的产品思路。skill 必须把 LLM 定位为**候选生成器、解释器和搜索策略提出者**，把数值判断交给固定数据、固定执行器和固定指标定义。

来源：[AlphaBench official site](https://alphabench.cc/)、[AlphaBench: Benchmarking Large Language Models in Formulaic Alpha Factor Mining — ICLR 2026](https://openreview.net/forum?id=d97Q8r7ZKZ)

#### RD-Agent(Q)：Research—Development—Feedback 循环与因子/模型协同

RD-Agent(Q) 把自动量化研发拆为：

- **Research stage**：基于领域先验形成假设、动态设定目标，并映射为具体研发任务；
- **Development stage**：由代码生成 agent 实现任务，并在真实市场回测中执行；
- **Feedback stage**：系统评价实验结果，回灌到下一轮研究；
- **Scheduler**：用 multi-armed bandit 自适应选择更值得投入的研究方向。

其进一步强调**因子与模型交替优化**，而非在单一固定模型下无休止增加因子。论文报告在其实验设置中，以更少因子取得高于基准因子库的年化收益，并改善预测准确性与策略稳健性的折中；这些是特定数据、基准和回测配置下的研究结果，不应被转述为生产收益保证。

官方仓库提供 `fin_factor`、`fin_model`、`fin_quant` 和从研报提取因子的场景，也提供交互界面和执行轨迹。这说明一个生产 skill 至少要区分：

- hypothesis/idea agent；
- factor implementation agent；
- code/test agent；
- deterministic evaluator；
- search scheduler；
- experiment memory/trace。

来源：[R&D-Agent-Quant paper](https://arxiv.org/abs/2505.15155)、[NeurIPS 2025 paper page](https://papers.neurips.cc/paper_files/paper/2025/hash/ac5c2b6e423883cbcacbcccf88491b78-Abstract-Datasets_and_Benchmarks_Track.html)、[Microsoft RD-Agent official repository](https://github.com/microsoft/RD-Agent)

#### 对 skill 的新增约束

1. **生成、评价、搜索三任务分开测**：一个能写出合法公式的模型，不代表能判断公式好坏。
2. **评价必须执行落地**：LLM 的主观分数只能作先验或排序提示，不能通过准入闸门。
3. **搜索预算也是结果的一部分**：记录 token、调用次数、回测次数、墙钟时间、失败率和候选多样性。
4. **保留完整搜索树/谱系**：不仅保存 winner，还保存 parent factor、变异算子、反馈、失败原因和每轮指标。
5. **优先组合式/演化式搜索**：允许多分支和 Pareto 选择，避免单链上下文不断自我强化。
6. **因子和模型双层验证**：先用透明基准模型评价纯因子增量，再在代表性模型集合中检验依赖性；必要时才做联合优化。
7. **实验记忆与 holdout 隔离**：agent memory 不得写入最终 holdout 结果，冻结后才允许一次性揭示。
8. **评测 agent 本身也要版本化**：固定提示、模型、温度、工具版本和 benchmark，防止 skill 升级后研究行为漂移。

## 四、建议的行业最佳端到端流程

### Stage 0：研究契约

先冻结研究问题，而不是先跑表达式：

- 资产类别、股票池、地域、频率、交易日历；
- 因子类型：价量、基本面、另类数据、事件、微观结构、跨资产、模型派生；
- 预测目标、持有期、可交易延迟、调仓频率；
- 样本内/验证/样本外/仿真交易区间；
- 假设、预期方向、经济机制、已知风险暴露；
- 成本、容量和基准口径。

产物：`research_spec.yaml`。

### Stage 1：数据准备与时点审计

建立 point-in-time 数据快照，完成：

- 原始字段目录、单位、币种、频率、复权方式；
- 公告时间/入库时间/可交易时间三时间戳；
- 退市、停牌、涨跌停、成分股历史和公司行动；
- 缺失、异常、重复、跨源一致性检查；
- 数据许可与可导出边界。

产物：`data_manifest.json`、`data_quality_report.json`、`universe_snapshot.parquet`。任何运行都引用不可变 `dataset_snapshot_id`。

### Stage 2：因子生成与编译

候选可来自经济假设、论文复现、模板枚举、参数扫描、遗传搜索或 LLM，但必须落为统一 `FactorSpec`。DSL 编译器执行类型检查、时点检查、窗口检查、单位检查和复杂度预算，生成规范 AST、依赖 DAG 和因子哈希。

产物：`factor_spec.yaml`、`factor_ast.json`、`lineage.json`。

### Stage 3：批量计算

执行器按 `数据快照 × 股票池 × 频率 × 表达式 DAG` 做任务分片和公共子表达式消除；缓存按完整语义哈希寻址；失败任务可重试、可续跑；同一输入必须幂等。

产物：标准长表或宽表 `factor_values.parquet`，索引至少为 `(datetime, instrument)`，并带 `factor_id`、质量标记和可用时间。

### Stage 4：统一预处理

原始值和处理后值必须同时保留。预处理顺序显式配置：

1. 缺失/无穷处理；
2. 去极值；
3. 变换；
4. 横截面标准化；
5. 行业/市值/风格中性化；
6. 必要时正交化。

产物：`factor_values_raw.parquet`、`factor_values_processed.parquet`、`preprocess_log.json`。

### Stage 5：因子层多维测评

借鉴 Alphalens，至少覆盖：

- IC、RankIC、ICIR、显著性和时序稳定性；
- 多持有期 forward return；
- 分层收益、Top-Bottom、多空单调性；
- 覆盖率、缺失率、极值率、截面分布；
- 换手、衰减、信号自相关；
- 行业、规模、风格、地区、年份、牛熊/高低波动分组；
- 参数邻域稳定性；
- 与现有因子库的数值、IC、收益和暴露相关性。

产物：`factor_metrics.parquet`、`slice_metrics.parquet`、`factor_tearsheet.html`。

### Stage 6：样本外与研究偏差控制

先冻结候选和阈值，再打开 holdout。使用滚动/扩展窗口、purged/embargoed 切分（若标签区间重叠）、跨市场/跨时期验证，并记录候选尝试总数。多重检验校正和 deflated 指标应在这一阶段完成，不能只保留胜者。

产物：`validation_plan.yaml`、`oos_metrics.parquet`、`multiple_testing_report.json`。

### Stage 7：组合与交易回测

借鉴 Qlib/FinRL，把信号映射、组合构建和执行模型分离：

- signal policy：方向、缩放、截断、滞后；
- portfolio policy：Top-k、分位数组合、优化器、风险预算；
- execution model：成交价、延迟、交易成本、冲击、停牌/涨跌停、最小交易单位；
- risk model：行业/风格暴露、杠杆、集中度、容量约束。

同时报告 gross 与 net，禁止只展示最优成本假设。

产物：`backtest_config.yaml`、`orders.parquet`、`positions.parquet`、`trades.parquet`、`portfolio_metrics.parquet`、`portfolio_tearsheet.html`。

### Stage 8：准入、去冗余与组合可用性

采用分级闸门，而非单一综合分：

- `INVALID`：时点、数据或公式错误；
- `REJECTED`：统计/稳健性不达标；
- `RESEARCH_ONLY`：统计有效但成本、容量或解释性不足；
- `CANDIDATE`：样本外、成本后和冗余检查通过；
- `APPROVED`：通过人工/治理审批，可进入组合；
- `DEPRECATED`：衰减、数据源变化或实现风险导致下线。

相关簇中保留经济逻辑清晰、稳定、低换手、低成本、数据可靠的代表因子，不按历史 Sharpe 唯一排序。

### Stage 9：注册、发布与监控

将通过的因子打成不可变发布包，注册其 owner、用途、版本、依赖、审批、适用域和失效条件。上线后监控：

- 分布漂移、覆盖率、数据延迟；
- IC/收益衰减；
- 换手和成本偏离；
- 暴露、容量和拥挤度；
- 代码/数据/算子版本变化。

产物：`factor_card.md`、`factor_package/`、`model_registry_entry.json`、`monitoring_spec.yaml`。

## 五、对 Codex skill 架构的具体建议

### 5.1 Skill 不是单脚本，而是编排层

建议 skill 自身只负责：

- 理解研究目标并生成/校验配置；
- 调用数据、计算、评测、回测适配器；
- 执行 Stage-Gate；
- 汇总机器可读 artifact；
- 生成面向研究员和审计人员的报告。

重计算放在独立 runner；数据访问、Qlib、内部回测器、MLflow 等通过 adapter 接入。这样不会把客户的数据源和执行引擎锁死在 skill 内。

### 5.2 建议模块

```text
factor-mining-skill/
├── SKILL.md
├── schemas/
│   ├── research_spec.schema.json
│   ├── factor_spec.schema.json
│   ├── evaluation_spec.schema.json
│   └── backtest_spec.schema.json
├── prompts/
│   ├── hypothesis_generation.md
│   └── factor_review.md
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

### 5.3 建议命令/能力面

- `discover`：从研究假设、字段目录和模板生成候选，输出 FactorSpec，不直接宣称有效。
- `compile`：DSL → typed AST/DAG，做未来函数和时点检查。
- `compute`：批量计算并保存数据血缘。
- `evaluate`：因子层多维测评，输出明细表和 tear sheet。
- `validate`：滚动、跨市场、样本外和多重检验。
- `backtest`：组合与执行层净收益验证。
- `compare`：候选排名、相关簇、冗余和 Pareto 前沿。
- `publish`：生成 Factor Card、发布包和监控规范。
- `reproduce`：使用 run ID 重建环境并逐 artifact 校验 hash。
- `benchmark-agent`：按 AlphaBench 式 generation/evaluation/search 子任务测语法有效率、排序质量、数值误差、搜索增益、多样性和单位成本。

### 5.4 统一接口

建议所有计算/评测 adapter 遵循以下最小协议：

```python
class FactorComputeBackend:
    def compile(self, factor_spec, data_manifest) -> CompiledFactor: ...
    def compute(self, compiled_factor, run_context) -> FactorArtifact: ...

class FactorEvaluator:
    def evaluate(self, factor_artifact, evaluation_spec) -> EvaluationArtifact: ...

class PortfolioBacktester:
    def run(self, signal_artifact, backtest_spec) -> BacktestArtifact: ...

class ExperimentTracker:
    def start_run(self, run_manifest) -> RunHandle: ...
    def log_params(self, params): ...
    def log_metrics(self, metrics): ...
    def log_artifacts(self, paths): ...
```

其中 `run_context` 必含：

```text
run_id
dataset_snapshot_id
universe_snapshot_id
factor_id / AST hash
code_commit
container_or_lock_hash
random_seed
calendar / timezone
started_at / operator / owner
parent_run_id
```

### 5.5 产物优先于对话

LLM 的自然语言结论不可作为唯一证据。每个结论必须能回链到：

`报告单元格/图 → metric row → factor value partition → FactorSpec → data snapshot`

HTML/PDF 是展示层；Parquet/JSON/YAML 是事实层；实验注册表是索引层。skill 应在最终答复中给出 run ID、准入状态、关键失败原因和 artifact 路径，而不是只给一句“该因子有效”。

### 5.6 适合的默认实现组合

首版建议：

- **表达与计算**：借鉴 Qlib ExpressionOps，内部维护 typed AST；可选 Qlib adapter。
- **因子评测**：复刻并扩展 Alphalens 的 factor_data/tear-sheet 契约，不依赖旧仓库内部实现。
- **实验追踪**：MLflow-compatible adapter，结构参考 Qlib Recorder。
- **组合回测**：Qlib 或客户现有引擎；保持稳定 `orders/positions/trades` 契约。
- **高级策略验证**：FinRL/FinRL-X adapter 作为可选下游，不进入基础因子准入的必经路径。
- **搜索**：WorldQuant 式受限 DSL 模板 + 参数网格为基线；LLM/遗传编程只能生成候选，不能修改 holdout 或放宽闸门。
- **自动研发循环**：参考 RD-Agent(Q) 将 hypothesis、implementation、evaluation、scheduler 分开；参考 AlphaBench 对每个 agent 版本做独立基准，而不是只比较最终赢家。

## 六、最重要的反模式

1. 只保存最终公式和 Sharpe，不保存尝试历史、数据快照与失败候选。
2. 用当前成分股回测历史、用最新财报覆盖历史版本、忽略公告可用时间。
3. 因子生成和评测共用 holdout，看到结果后持续改公式。
4. 把 Alphalens 分层收益当作可成交策略收益。
5. 把不同持有期、不同股票池和不同成本口径的指标混在同一排行榜。
6. 只按公式文本去重，不检查值、IC、收益和风险暴露相关。
7. 批量挖掘后不做多重检验，不记录搜索空间大小。
8. 报告只有图片，没有可复算的明细表和 lineage。
9. 让 LLM 自由执行任意 Python 因子代码，而没有受限 DSL、资源预算和静态检查。
10. 直接把历史框架版本锁进生产，而没有 adapter、版本测试和替换路径。

## 七、最终判断

如果客户要做的是“专门挖各类量化因子并做多维测评”的 skill，最稳妥的技术路线是：

> **Qlib 式数据与 workflow 骨架 + WorldQuant 式公式资产化 + Alphalens 式因子测评契约 + Qlib/FinRL-X 式可替换回测与风险层 + MLflow 式实验注册 + RD-Agent(Q)/AlphaBench 式可评测的执行反馈闭环。**

MVP 不应先追求上千个算子或自动生成大量公式，而应优先打通以下最小闭环：

1. 不可变数据快照；
2. FactorSpec + typed AST + 未来函数检查；
3. 可缓存的批量计算；
4. 因子层多维明细；
5. 严格样本外；
6. 成本后组合回测；
7. 全链路 artifact 和 run manifest；
8. 明确的准入/拒绝原因。

这八项具备后，LLM 生成、遗传搜索、另类数据和 RL 才能安全地作为插件扩展，而不会把平台变成不可复现的“批量回测选号器”。

## 来源清单

1. [Qlib Data Layer: Data Framework & Usage](https://qlib.readthedocs.io/en/latest/component/data.html)
2. [Qlib Data Retrieval](https://qlib.readthedocs.io/en/stable/start/getdata.html)
3. [Qlib Building Formulaic Alphas](https://qlib.readthedocs.io/en/latest/advanced/alpha.html)
4. [Qlib Workflow Management](https://qlib.readthedocs.io/en/stable/component/workflow.html)
5. [Qlib Recorder: Experiment Management](https://qlib.readthedocs.io/en/stable/component/recorder.html)
6. [Qlib Portfolio Strategy](https://qlib.readthedocs.io/en/stable/component/strategy.html)
7. [Microsoft Qlib official repository](https://github.com/microsoft/qlib)
8. [Quantopian Alphalens official repository](https://github.com/quantopian/alphalens)
9. [Quantopian pyfolio official repository](https://github.com/quantopian/pyfolio)
10. [WorldQuant BRAIN: Crowdsourcing Quantitative Research](https://www.worldquant.com/brain/)
11. [WorldQuant BRAIN — Detailed Operator Descriptions](https://platform.worldquantbrain.com/learn/data-and-operators/detailed-operator-descriptions)
12. [Zura Kakushadze, 101 Formulaic Alphas](https://arxiv.org/abs/1601.00991)
13. [FinRL-Meta Overview](https://finrl.readthedocs.io/en/latest/finrl_meta/overview.html)
14. [FinRL Three-layer Architecture](https://finrl.readthedocs.io/en/latest/start/three_layer.html)
15. [FinRL: Deep Reinforcement Learning Framework to Automate Trading in Quantitative Finance](https://arxiv.org/abs/2111.09395)
16. [AI4Finance-Foundation/FinRL official repository](https://github.com/AI4Finance-Foundation/FinRL)
17. [AI4Finance-Foundation/FinRL-Trading](https://github.com/AI4Finance-Foundation/FinRL-Trading)
18. [FinRL-X: An AI-Native Modular Infrastructure for Quantitative Trading](https://arxiv.org/abs/2603.21330)
19. [AlphaBench official site](https://alphabench.cc/)
20. [AlphaBench: Benchmarking Large Language Models in Formulaic Alpha Factor Mining — ICLR 2026](https://openreview.net/forum?id=d97Q8r7ZKZ)
21. [R&D-Agent-Quant: A Multi-Agent Framework for Data-Centric Factors and Model Joint Optimization](https://arxiv.org/abs/2505.15155)
22. [R&D-Agent-Quant — NeurIPS 2025 paper page](https://papers.neurips.cc/paper_files/paper/2025/hash/ac5c2b6e423883cbcacbcccf88491b78-Abstract-Datasets_and_Benchmarks_Track.html)
23. [Microsoft RD-Agent official repository](https://github.com/microsoft/RD-Agent)

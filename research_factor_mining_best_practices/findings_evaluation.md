# 因子多维评测与可交易上线：行业最佳流程调研

> 调研日期：2026-07-23  
> 范围：横截面选股因子为主，兼顾其他资产与频率；重点回答“如何从统计有效走到可交易、可组合、可上线”。  
> 核心判断：行业共识是采用多阶段、成本感知、样本外的评测体系；行业并不存在跨市场通用的 `IC > 某值`、`换手 < 某值` 或 `相关性 < 某值` 这类固定录取线。

## 1. 结论摘要

一个专业的因子评测 skill 不应只输出一张 IC 表，而应把候选因子依次送过六道闸门：

1. **定义与数据闸门**：固定 point-in-time 数据、可交易股票池、信号可得时点、成交延迟、预测期限、复权和退市处理，排除未来函数与样本选择偏差。
2. **单因子统计闸门**：同时检查 Pearson IC、RankIC、分层收益、单调性、Top-Bottom spread、long-short 收益及其不确定性；在多个候选因子中控制多重检验。
3. **稳健性闸门**：滚动窗口、子时期、行业/市值/流动性组、市场状态、不同参数和信号延迟下仍有合理表现，且衰减曲线符合交易逻辑。
4. **可交易闸门**：将组合换手映射为佣金、税费、点差、冲击、融券/资金成本，做 AUM 与参与率情景扫描，报告净收益和容量，而非只报毛收益。
5. **独特性与组合增量闸门**：对现有因子库做相关性聚类、条件 IC/残差化检验，并在相同风险和交易约束下测量加入候选因子后的净 Sharpe、风险、成本与容量增量。
6. **影子运行与生产闸门**：冻结公式和参数后 paper/shadow trading，核对研究成交价与真实可实现成交；上线后监控 IC、PnL、暴露、换手、成本、容量和数据漂移，并设降权/停用规则。

Alphalens 将标准单因子分析明确分为 **returns、information coefficient、turnover、grouped analysis**，并支持 long-short、group-neutral、分组 IC、分层收益和换手分析，基本构成了行业常见的“因子 tear sheet”骨架。[Alphalens Documentation](https://quantopian.github.io/alphalens/)  
但研究到上线还必须增加成本、容量、风险归因、拥挤度、冗余和样本外治理；Pyfolio 的演进也专门加入了风险暴露、业绩归因、容量、bootstrap 和滑点敏感性分析，说明这些不是附属图表，而是组合层的必要环节。[Pyfolio Release Notes](https://quantopian.github.io/pyfolio/whatsnew/)

## 2. 统一评测协议：先锁定“实验合同”

任何指标之前，skill 应生成并保存一份不可隐式变更的 `evaluation_contract`：

- **资产与股票池**：市场、证券类型、上市天数、ST/停牌/涨跌停、价格和流动性过滤规则；股票池必须用当时可知成分。
- **信号时钟**：原始字段的发布日期/可得时间、因子计算时间、下单时间、最早成交时间和最低延迟。
- **预测标签**：前瞻收益应写成明确区间，如 `close(t+1) → close(t+6)`，不能只写“5 日收益”；重叠标签需使用 HAC/Newey-West、block bootstrap 或非重叠子组合处理序列相关。
- **调仓协议**：调仓频率、持有期、重叠持仓、权重函数、gross/net exposure、可做空性、涨跌停和成交量限制。
- **基准与风险模型**：市场基准、行业体系、风格因子、国家/货币暴露及协方差版本。
- **成本模型版本**：费率、印花税、点差、冲击模型、借券费和融资成本；必须带版本和生效日期。
- **数据切分**：探索/训练、验证、完全封存测试、shadow/live；测试区间一旦查看就不能再被称作“真正样本外”。
- **搜索轨迹**：记录研究过的表达式、参数、变体和失败结果，以便做多重检验与审计。

业界共识是：同一因子必须在**原始、处理后、风险中性后、可交易组合后**四个层级分别留痕，不能只保存最漂亮的一个版本。

## 3. 数据预处理与中性化

### 3.1 推荐处理顺序

1. 先应用 point-in-time 可交易股票池和数据质量过滤。
2. 对缺失值设定显式策略；一般不建议用横截面均值无条件填充，因为这会人为把缺失股票放在中性位置。
3. 对每个日期横截面去极值，保存被截断比例与证券清单。
4. 横截面标准化；重尾、非线性排序因子可同时保留 rank/normal-score 版本。
5. 按研究目的做行业/风格中性化。
6. 再分层、计算 IC 和构建组合；同一处理仅使用当日及以前可知数据。

### 3.2 应支持的方法

- **去极值**：MAD/Hampel、分位数 winsorization、经济含义上限/下限；不应让极端值单独支配权重。
- **标准化**：z-score、稳健 z-score、百分位/rank、rank-gaussian。对排序策略，RankIC 与分位权重通常比原值线性权重更稳健。
- **中性化**：逐日截面回归 `factor ~ industry dummies + style exposures`，使用残差作为中性因子；可选 WLS、约束优化或组内排序。必须报告原始与中性化前后的效应损失。
- **正交化**：仅在“测独立信息”时对已有因子残差化；它依赖因子顺序，不应被包装为唯一正确的经济定义。

Alphalens 的 group-neutral 设计体现了这一通行做法：可在组内对收益或因子去均值，并对各组赋予相同权重；其 IC 实现使用因子值与前瞻收益的逐期 Spearman 相关。[Alphalens API: Performance and Tear Sheets](https://quantopian.github.io/alphalens/alphalens.html)

### 3.3 共识与经验参数

| 项目 | 业界共识 | 经验参数（不可作为统一硬门槛） |
|---|---|---|
| 去极值 | 必须控制异常值影响并保存审计痕迹 | 横截面 1%/99% 分位或中位数 ±3–5 MAD 常被用作起点；小股票池、基本面比率和高频信号应另行校准 |
| 标准化 | 同日同股票池内可比；不能用未来期统计量 | z-score、rank、normal-score 应作为可配置变体比较 |
| 中性化 | 同时报原始和中性结果，避免把真正 alpha 或隐含风险误删 | 行业、规模、beta、流动性、波动率通常优先；具体暴露上限来自组合风险预算 |
| 缺失值 | 先解释缺失机制，再决定过滤/填充 | 缺失率 5%/20% 等只能作为预警分层，不能跨数据源统一 |

## 4. 单因子多维评测

### 4.1 IC 与 RankIC

逐日横截面计算：

- `IC_t = Corr_Pearson(factor_t, forward_return_t,h)`：识别线性预测关系，但对异常值和尺度敏感。
- `RankIC_t = Corr_Spearman(factor_t, forward_return_t,h)`：更贴近排序选股，建议作为默认主指标。
- 报告 mean、median、standard deviation、`ICIR = mean(IC) / std(IC)`、t-stat/置信区间、正向命中率、分位数、偏度、尾部损失。
- 按周/月、行业、规模、流动性、国家和市场状态切片；至少输出滚动 mean IC、rolling ICIR 和 monthly heatmap。
- 对 1/5/10/20/60 日等多个 horizon 画 IC decay；最优 horizon 若与持有期或信号逻辑不一致，应触发复核。
- 前瞻收益重叠或 IC 自相关时，普通 i.i.d. t-stat 会过度乐观，应使用 HAC 或 block bootstrap。

Alphalens 对 IC 的官方定义就是每期因子值与 N 期前瞻收益的 Spearman rank correlation，并支持先按组去均值、按组分别计算以及按月/周聚合。[Alphalens API](https://quantopian.github.io/alphalens/alphalens.html)

### 4.2 分层收益与单调性

- 默认输出 5 组和 10 组；同时给出等权、流通市值权重和策略实际权重。
- 报告每层毛/净前瞻收益、标准误、Top-Bottom spread、Q1/QN 相对股票池收益。
- 单调性至少用三种表示：层号与层收益的 Spearman 相关、相邻层差方向一致比例、isotonic fit/R² 或单调违例数。
- 不能因中间层不完全单调就直接淘汰：阈值型、尾部型和事件型信号天然可能只有两端有效；此时应改变权重函数并在封存样本验证，而不是反复调层数。
- 应检查每层证券数、行业/规模组成与可交易覆盖，防止“单调性”只是规模或行业排序。

Alphalens 原生提供 mean return by quantile、上下分位收益差及标准误、分位累计收益和 top/bottom quantile turnover，可作为 skill 的最小可比输出集合。[Alphalens API](https://quantopian.github.io/alphalens/alphalens.html)

### 4.3 Long-short 可实现收益

至少构造四个对照组合：

1. Top-Bottom 等权 long-short；
2. 因子值/rank 加权、gross leverage 固定的 dollar-neutral 组合；
3. 行业中性组合；
4. 行业 + 风格 + beta 约束后的可交易组合。

报告：

- 毛/净年化收益、波动、Sharpe/Sortino、最大回撤、Calmar、偏度、尾部收益；
- gross/net exposure、long/short leg 分解、beta、行业/风格暴露；
- 换手、成本、持仓数、集中度、单名与行业风险贡献；
- 可借券覆盖、借券成本、召回风险和 short squeeze 情景；
- 相同 signal lag 下的调仓频率/持有期敏感性。

Alphalens 对 factor-weighted long-short 的参考实现是：因子去均值后按绝对值之和归一，使 gross leverage 为 1、正负权重绝对值相等；group-neutral 时在组内去均值且各组等权。这是研究对照组合，不等同于真实可交易组合。[Alphalens API](https://quantopian.github.io/alphalens/alphalens.html)

## 5. 换手、成本与容量

### 5.1 换手

需同时报告三种对象：

- **信号稳定性**：因子 rank autocorrelation；Alphalens 明确将其视为衡量因子换手属性的指标。
- **分层成员换手**：进入/退出 top、bottom quantile 的比例。
- **组合权重换手**：常用 `0.5 × Σ|w_t - w_{t-1}^{drifted}|`；long-short、gross exposure 和现金处理的口径需显式声明。

### 5.2 成本模型

成本至少拆为：

- 显性：佣金、交易所费用、税费；
- 半显性：bid-ask spread、融券费、融资/资金成本；
- 隐性：延迟、市场冲击、机会成本、涨跌停/成交失败；
- 冲击模型必须依赖成交额、ADV、参与率、波动率和流动性，不能只用固定 bps。

CFA Institute 对 Li、Chow、Pickard、Garg 的研究总结显示，因子策略成本取决于换手、交易规模、证券流动性、调仓次数和交易相对成交量；高换手、低流动性、成交集中且偏离成交量加权基准的策略成本更高。其样本中，不同构造方式的同类因子成本差异很大，说明“因子名称”不能代替实施模型。[Transaction Costs of Factor-Investing Strategies](https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/0015198x-2019-1567190)

### 5.3 容量

容量不是单一常数，应输出 `AUM × participation × rebalance frequency` 三维曲面，并定义至少三种容量：

- **成本容量**：年化成本达到毛 alpha 的某一比例；
- **净 alpha 容量**：成本后预期 alpha 或净 Sharpe 降到投资者最低要求；
- **市场容量**：单名/组合参与率、调仓天数、持仓集中度或可借券量达到限制。

CFA 研究将“年成本达到 50 bps”定义为其指数策略的 natural capacity，但原文明确这是研究设定下被视为不可持续的水平，**不是行业统一门槛**。skill 应允许客户用净 alpha、净 Sharpe 或成本预算定义容量，而不是硬编码 50 bps。[CFA Institute Summary](https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/ip-transaction-costs-of-factor-investing-strategies)

## 6. 拥挤度、风险暴露与归因

### 6.1 拥挤度

MSCI 的因子拥挤模型给出一个可复用的多维框架：

- 因子股票之间的 **pairwise correlation 与 volatility** 上升；
- **valuation** 被推高；
- 多空腿的 **short-interest spread**；
- 强劲近期收益导致追涨，并增加 **factor reversal** 风险。

MSCI 将拥挤的主要风险描述为仓位反转时的流动性或回撤事件，并主张用多个指标合成标准化拥挤分数，而不是用单个估值或持仓指标。[MSCI Factor Crowding Model](https://www.msci.com/documents/1296102/15220828/MSCI-Factor-Crowding-Model-cfs-en-2019.pdf)

建议 skill 另接入可得的基金持仓集中度、ETF/基金流量、券商持仓、借券利用率、因子收益相关性和成交拥塞。拥挤度更适合作为**风险预算、降权与压力测试变量**，通常不宜单独成为 alpha 否决项。

### 6.2 行业与风格暴露

每个候选因子都要同时做：

- 因子分数对行业、国家和风格暴露的逐日截面回归；
- long-short 组合的 market beta、size、value、momentum、quality、volatility、liquidity、growth/leverage 等风险模型暴露；
- 收益归因：总收益 = common-factor return + specific/alpha return + trading cost；
- 暴露均值、波动、极值、滚动变化和压力情景。

Pyfolio 的风险 tear sheet 明确覆盖 common factors、sector、market cap 和 illiquid stocks，业绩归因输出 common-factor attribution、multi-factor alpha 与 multi-factor Sharpe；这支持“统计 alpha 必须与已知风险暴露分开报告”的业界做法。[Pyfolio Release Notes](https://quantopian.github.io/pyfolio/whatsnew/)

中性化不是越多越好：若原始收益被行业/规模解释，应分别标注“风险溢价载荷”和“残差选股信息”；客户可以选择是否购买该暴露，但不能把它误称为纯 alpha。

## 7. 相关性聚类、因子冗余与组合增量价值

### 7.1 不要只算一个全样本相关系数

候选因子与因子库至少建立四种相似度：

1. 每日横截面因子值 Pearson/Spearman 相关的时间序列；
2. 中性化后因子值相关；
3. long-short 因子收益相关；
4. 在相同股票池、持有期和成本模型下的持仓/交易重叠。

可用 `distance = 1 - |rho|` 做层次聚类，或用图社区/PCA 找因子家族；同时检查滚动相关和压力期相关。绝对值相关用于识别同一信息的正负表达，但组合风险仍要保留相关符号。

### 7.2 冗余的判定

高相关只意味着“需要复核”，不等于“无价值”。建议按以下顺序：

- 在已有因子上残差化候选因子，再测 residual RankIC、分层收益和稳定性；
- 做横截面多元回归/partial IC，检查候选因子的条件解释力；
- 在滚动样本外重新估计组合，比较加入前后的净效用；
- 比较 turnover overlap：低相关但同时交易同一批低流动性股票，仍可能没有容量增量；
- 若两个因子效果相近，优先数据更稳定、经济逻辑更清楚、成本更低、容量更大者。

### 7.3 组合增量价值是最终标准

在**同一风险目标、同一约束、同一成本模型、同一 OOS 区间**下，报告加入候选因子后的：

- `Δ net return`、`Δ net Sharpe/IR`、`Δ max drawdown/expected shortfall`；
- `Δ turnover`、`Δ cost`、`Δ capacity`；
- 行业/风格暴露和 marginal risk contribution 的变化；
- 持仓集中度、crowding score 和 liquidity stress 的变化；
- 对已有因子的权重挤出、不同市场状态下的边际贡献；
- bootstrap 后“增量为正”的概率及置信区间。

一个 standalone IC 很高的因子，若与现有组合高度重合、成本更高或增加尾部风险，可能没有组合价值；反之，单因子 Sharpe 一般但与现有 alpha 低相关、容量高的因子可能很有价值。

## 8. 稳定性与样本外验证

最低稳健性矩阵：

| 维度 | 必做检验 |
|---|---|
| 时间 | expanding/rolling walk-forward；年度、季度和市场制度子期；完全封存测试 |
| 横截面 | 行业、规模、流动性、价格、可借券性、国家/交易所 |
| 市场状态 | 牛/熊、高/低波动、高/低流动性、利率/信用环境 |
| 参数 | lookback、rebalance、holding period、winsor、neutralization、weighting 的小扰动 |
| 执行 | 信号延迟、成交价、滑点、参与率、借券费、成交失败压力 |
| 数据 | 数据供应商/字段替代、修订数据与 point-in-time 数据对照 |
| 统计 | block bootstrap、HAC、重叠标签处理、多重检验/FDR |

多重检验方面，Harvey、Liu、Zhu 指出在大量因子被尝试的背景下，传统 `t > 2` 对“新发现因子”过于宽松，其模型给出的经典参考是 `t > 3.0`。[Harvey, Liu & Zhu, “…and the Cross-Section of Expected Returns”](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2249314)  
但它不是任何内部研究都应硬套的统一录取线：Chen 与 Zimmermann 在另一套发表偏差估计中发现，对能通过期刊筛选的预测变量，约 `t = 1.8` 已可控制其设定下的多重检验。[Federal Reserve, “Publication Bias and the Cross-Section of Stock Returns”](https://www.federalreserve.gov/econres/feds/publication-bias-and-the-cross-section-of-stock-returns.htm)  
因此专业做法是记录真实搜索空间，并输出 Bonferroni/Holm、Benjamini-Hochberg FDR、Harvey-Liu 类调整或 bootstrap reality-check 结果；`t > 3` 应作为高搜索强度下的保守参考，不应冒充普适真理。

## 9. 建议的 Stage-Gate 上线标准

### Gate 0：数据与定义（硬门槛）

- point-in-time、退市/停牌/成分历史、公司行动、时区与交易日历通过审计；
- 信号可得时间和成交延迟明确，无未来函数；
- 研究股票池与真实可交易股票池一致；
- 因子公式、数据版本、参数、随机种子和代码 commit 可复现。

任一项失败即退回，不允许用好看的 IC 抵消。

### Gate 1：统计有效性

- 方向与经济/行为/微观结构假设一致；
- RankIC、分层和 long-short 三种视角相互支持，或能解释为何是尾部/阈值型；
- t-stat/置信区间已处理自相关与重叠标签；
- 已按实际研究次数做多重检验；没有只挑最好参数；
- IC decay 与预定交易周期一致。

### Gate 2：稳健性

- walk-forward 与封存样本不发生方向性崩塌；
- 结果不是单个年份、行业、小市值或极端事件驱动；
- 对轻微参数、数据和延迟扰动不敏感；
- 失败的子样本有可解释边界，并进入使用条件和监控规则。

### Gate 3：可交易性

- 成本后收益为正，且在悲观滑点/冲击情景仍有安全边际；
- 调仓、参与率、成交天数、可借券性和集中度满足真实 mandate；
- 容量曲线覆盖目标 AUM，不能只报零规模回测；
- 风险暴露、回撤和尾部风险在预算内。

### Gate 4：独特性与组合价值

- 与因子库完成聚类和条件 IC；
- 在相同约束下具有正的样本外净增量，或明确提供容量/风险分散价值；
- 不因高交易重叠或拥挤度显著恶化组合实施风险。

### Gate 5：Shadow / Paper

- 冻结公式、参数和数据接口，禁止在观察期反复“修正回测”；
- 研究价与实际可实现价、预测换手与实际订单、模型成本与模拟成交偏差在容忍带内；
- 数据延迟、缺失、公司行动和再平衡作业经过故障演练。

### Gate 6：生产与退役

- 实时监控 rolling IC/RankIC、净 alpha、暴露、换手、实际/模型成本比、容量使用率、拥挤度和数据漂移；
- 使用 warning / reduce / stop 三级规则，阈值来自研究分布与风险预算；
- 设 champion/challenger、周期复审和版本回滚；
- 停用条件可以是持续 IC 反转、成本模型严重低估、容量越界、数据定义变化、隐含风险暴露失控或经济逻辑失效。

## 10. 经验阈值：只能作为默认预警，不是行业定律

下表适合放入 skill 的 `default_profile`，但必须要求用户按市场、频率、股票池、预测期限、成本和搜索强度校准：

| 指标 | 可用的经验起点 | 正确用法 |
|---|---:|---|
| mean RankIC | `|0.01–0.03|` 常被视为值得继续研究的量级 | 不能单看数值；同时看样本量、ICIR、成本、分层和 OOS 稳定性 |
| ICIR（未年化） | `0.3–0.5` 可作 watch，`>0.5` 可作较强候选起点 | 必须声明是否年化；高频横截面与月频因子不可横比 |
| IC 正向命中率 | `55%–60%` 可作稳定性预警线 | IC 非独立同分布，应给置信区间和最长连续失效期 |
| 因子/收益相关 | `|rho| > 0.7–0.8` 触发冗余复核 | 只触发聚类、残差化和增量测试，不直接删除 |
| 显著性 | `t > 3` 是高搜索强度下的保守参考 | 优先按真实搜索轨迹控制 FDR；不能忽略相关检验与 OOS |
| 参与率 | 单名日成交量的 `5%–10%` 常作初始压力场景 | 资产、市场、时段和执行能力差异很大；要做多档情景 |
| 成本安全边际 | 悲观情景下净 alpha 仍为正；成本不超过毛 alpha 的 `30%–50%` 可作治理起点 | 应由客户最低净 Sharpe/IR 和 AUM 决定 |
| 单调性 | 5 分组下层号-收益 Spearman `>0.8` 可作“强单调”提示 | 尾部/事件因子不应因中间层不单调被误杀 |
| 暴露 | 风格/行业暴露不设通用绝对值 | 与 mandate 的风险预算、tracking error 和边际风险贡献绑定 |
| shadow 期 | 日频因子至少 `1–3` 个月，低频因子需覆盖多个独立信号周期 | 以“足够的独立观察数和市场状态”定义，不只看日历长度 |

上述 RankIC、ICIR、相关性、参与率和 shadow 数字属于**常见实践中的启发式起点**，本次优先证据来源并未证明它们是普适阈值；skill 输出中应强制标记为 `heuristic`，不得标记为 `industry_standard`。

## 11. 对“因子挖掘与测评 skill”的直接设计建议

### 11.1 输入

- `factor_definition`：公式、方向、经济假设、字段和可得时间；
- `universe_contract`、`label_contract`、`execution_contract`；
- `preprocess_grid`：winsor/scale/neutralize 变体；
- `existing_factor_library`：分数、收益、持仓、交易与元数据；
- `risk_model`、`cost_model`、`borrow_data`、`crowding_data`；
- `research_registry`：历史候选和参数搜索轨迹；
- `gate_profile`：市场/频率/mandate 特定阈值。

### 11.2 标准产物

- `data_audit.json`
- `factor_lineage.json`
- `single_factor_tearsheet.html/pdf`
- `ic_panel.parquet`
- `quantile_returns.parquet`
- `portfolio_gross_net.parquet`
- `exposure_attribution.parquet`
- `turnover_cost_capacity_surface.parquet`
- `crowding_dashboard.parquet`
- `redundancy_cluster.json`
- `incremental_portfolio_test.json`
- `robustness_matrix.json`
- `gate_decision.json`
- `model_card.md`

### 11.3 决策输出

不要只输出 pass/fail，建议输出：

- `research_status`: reject / revise / shadow / production_candidate；
- 每道 gate 的 hard failures、warnings、证据和置信度；
- 业界共识规则与客户自定义经验阈值分栏；
- 失败原因的可行动建议，但禁止在封存测试集上自动调参；
- 对缺失数据、成本/借券/拥挤数据不足显式给出 `not_evaluable`，不能默认通过。

## 12. 来源

1. **Alphalens Documentation** — Returns、IC、Turnover、Grouped Analysis 的标准因子 tear sheet。  
   https://quantopian.github.io/alphalens/
2. **Alphalens API: Performance and Tear Sheets** — Spearman IC、分层收益、Top-Bottom spread、factor rank autocorrelation、long-short/group-neutral 权重定义。  
   https://quantopian.github.io/alphalens/alphalens.html
3. **Pyfolio Release Notes** — 风险暴露、业绩归因、容量、bootstrap、slippage sweep 与 OOS 分析。  
   https://quantopian.github.io/pyfolio/whatsnew/
4. **Li, Chow, Pickard & Garg, “Transaction Costs of Factor-Investing Strategies”** — 因子交易成本与容量的实证框架。  
   https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/0015198x-2019-1567190
5. **CFA Institute, “Transaction Costs of Factor Investing Strategies (Summary)”** — 成本驱动因素与 50 bps natural-capacity 研究设定。  
   https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/ip-transaction-costs-of-factor-investing-strategies
6. **MSCI Factor Crowding Model** — 相关性/波动、估值、空头兴趣差与反转的多维拥挤度框架。  
   https://www.msci.com/documents/1296102/15220828/MSCI-Factor-Crowding-Model-cfs-en-2019.pdf
7. **Harvey, Liu & Zhu, “…and the Cross-Section of Expected Returns”** — 因子动物园、多重检验与 `t > 3` 的经典保守参考。  
   https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2249314
8. **Chen & Zimmermann, “Publication Bias and the Cross-Section of Stock Returns”** — 对发表偏差与显著性门槛的不同估计，说明阈值依赖假设和研究集合。  
   https://www.federalreserve.gov/econres/feds/publication-bias-and-the-cross-section-of-stock-returns.htm

## 13. 证据边界

- 公开资料对 ICIR、相关性、参与率等固定数字没有统一标准；这些值高度依赖资产、频率、股票池、持有期、数据质量和成本模型。
- Alphalens/Pyfolio 是经典工作流参考，但项目版本较旧；适合借鉴指标定义和 tear-sheet 结构，不应原样充当现代生产风控系统。
- MSCI 拥挤模型公开材料说明了维度，但完整权重和商业模型并未公开；skill 应实现透明的客户自定义合成方式。
- 容量研究中的具体 bps 和 AUM 是特定样本、指数构造与执行假设的结果；可复用的是“成本随换手、流动性、规模和参与率变化”的方法，而非原数值。

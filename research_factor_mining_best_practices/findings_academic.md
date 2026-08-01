# 因子发现与验证：学术/行业方法论调研

## 1. 结论先行

高质量因子挖掘不是“批量生成表达式后按 IC 或 Sharpe 排名”，而是一套带研究记账、信息时点控制、多重检验修正和真正样本外验证的实验制度。最重要的设计原则是：

1. **先定义可证伪假设，再冻结实现。** 每个候选必须先写清经济/行为/微观结构机制、预期方向、适用资产、持有期、数据可得时间、构造公式和可能失效原因；看到 holdout 后再改规则，等于增加一次新试验。
2. **把四种对象分开。** 横截面特征 \(x_{i,t}\)、由特征形成的多空因子收益 \(f_t\)、时间序列预测变量 \(z_t\)、跨资产/事件信号的样本结构和正确统计量不同，不能共用一套“t 值”。
3. **统计显著不等于真实，更不等于可交易。** 必须同时经过：点时正确性、横截面有效性、时间序列稳定性、已知因子增量解释、多重检验、样本外、成本/容量及衰减检验。
4. **试验次数本身是数据。** 所有失败版本、参数扫描、替代标签、不同股票池和预处理都应进入 trial ledger；只记录“最终因子”将无法计算 FDR、DSR 或 PBO。
5. **保留一次真正未触碰的最终样本外。** walk-forward 用于估计跨期稳定性，但反复查看其结果也会把它变成训练集；最终 holdout 或上线 paper-trading 仍需只开启一次。
6. **不存在跨市场通用的 IC、Sharpe、换手或半衰期硬阈值。** 可引用的 \(t>3\)、\(t>2.78\)、月单边换手 50% 等，都来自特定论文的样本和试验族，只应作为校准或压力场景，不能写成 skill 的无条件通过标准。

大样本复现研究说明这种保守性是必要的：Hou、Xue、Zhang 对 452 个异象复现时，在其美国股票、NYSE 断点和市值加权设定下，65% 连单次检验的 \(|t|=1.96\) 都未通过；采用 5% 多重检验门槛 \(2.78\) 后失败率升至 82%。McLean、Pontiff 对 97 个预测变量发现，预测组合收益在原研究样本外平均低 26%，发表后低 58%；这些数值是该样本的历史证据，不是所有新因子的固定 haircut。

## 2. 建议落地为 Stage-Gate 流程

### Stage 0：研究契约与试验族

为每个假设先生成 `research_card`：

- `hypothesis_id`、机制、可证伪预测、预期方向；
- 资产/市场/频率、形成期、持有期、更新频率；
- 原始字段及 `known_at` 规则、报告修订/复权/公司行动处理；
- 初始公式、允许的参数范围、预处理、中性化、组合形成规则；
- 基准因子、成本模型、容量约束、失效场景；
- 试验族 `family_id` 及本次新增试验数。

同一经济想法的不同窗口、滞后、分位数、股票池、权重、中性化和标签都属于同一试验族。任何在看过验证结果后的修改，应派生新的 `trial_id`，不能覆盖旧结果。

### Stage 1：点时正确的数据快照

先做可自动阻断的 data audit：

- 股票池按历史时点重建，包含后来退市、并购和破产的证券以及退市收益；
- 财务、分析师、宏观数据按当时首次可见版本及发布时间连接，不能用当前库中回填/重述后的数值；
- 每个特征满足 `source_known_at <= decision_time`，交易使用可成交的下一时点价格，并显式记录发布延迟和执行延迟；
- 拆股、分红、代码变更、停牌、涨跌停、夜间/日内时间戳采用一致规则；
- 去极值阈值、标准化参数、缺失值填充、行业映射、PCA/模型参数只在训练窗估计，再应用于验证窗。

推荐设置两个机器审计：

1. **time-travel test**：把某一历史截面后的所有源数据截断，重算因子，结果必须与全库在该截面的结果一致；
2. **universe replay test**：随机抽历史日期核对当日可投资名单、退市标的和公司行动。

### Stage 2：最小实现与方向性 sanity check

只实现研究契约中的基准版本，先检查覆盖率、极端值、单位、横截面分布、时间稳定性、与价格/市值/行业等常见暴露的关系。若符号与机制相反、有效性只来自极少数微盘股或异常日期，应先判为机制失败，而不是立刻扩大参数搜索。

美国股票异象的可复现经验是同时报告合理的交易所断点和市值加权版本，避免微盘股主导；其他市场不能机械照搬 NYSE 断点，但必须指定一个“可交易母样本”作为分位数断点基准。

### Stage 3：横截面验证

对横截面信号至少做三条互补证据链：

1. **逐期 IC/RankIC**

   \[
   IC_t(h)=\operatorname{corr}_{i}\!\left(x_{i,t},r_{i,t\rightarrow t+h}\right)
   \]

   RankIC 用 Spearman 相关。保存均值、中位数、正值比例、分布、按期序列和多持有期曲线。对 \(\overline{IC}\) 的 t 值应基于 IC 时间序列的 HAC 或时间区块 bootstrap，而不是把所有“股票×日期”当独立样本。

2. **分组组合**

   报告等权/市值权、分位数组合收益、Top-Bottom、单调性、两端贡献、覆盖率与换手。横截面断点必须在当期可投资母样本内计算。对多空收益的均值和 alpha 使用 HAC；高频或事件信号用与事件聚类相匹配的 block/cluster bootstrap。

3. **Fama–MacBeth 型逐期横截面回归**

   \[
   r_{i,t+1}=a_t+b_t x_{i,t}+c_t'Z_{i,t}+\varepsilon_{i,t+1},\qquad
   \bar b=\frac1T\sum_{t=1}^{T}b_t
   \]

   若 \(\widehat\Omega\) 是 \(b_t\) 的 HAC 长期方差，则

   \[
   t(\bar b)=\frac{\bar b}{\sqrt{\widehat\Omega/T}}.
   \]

   控制变量 \(Z\) 应在研究契约中预先指定；逐个试到“显著”为止属于新的多重检验。Fama–MacBeth 结构处理同一期横截面相关，但 \(b_t\) 的时间相关仍需 HAC。若特征是估计 beta，还要考虑 generated-regressor/测量误差，不能把第二阶段普通 OLS 的标准误直接当最终结果。

### Stage 4：时间序列与增量解释

将信号形成的可交易收益序列 \(f_t\) 对预先指定的市场、风格或同类基准回归：

\[
f_t=\alpha+\beta'F_t+\varepsilon_t .
\]

报告 HAC alpha、beta 稳定性、残差尾部和不同市场状态下的 alpha。若研究对象本身是宏观/时间序列预测变量，应使用递归或滚动的实时预测，并相对只用当时信息的朴素基准计算：

\[
R^2_{\mathrm{OOS}}
=1-\frac{\sum_t(y_t-\hat y_{t|t-1})^2}
{\sum_t(y_t-\hat y^{\,\mathrm{benchmark}}_{t|t-1})^2}.
\]

长持有期重叠收益会机械地产生序列相关。若标签为 \(h\) 期重叠收益，HAC 截断阶数至少覆盖 \(h-1\) 是起点；信号自身更持久时需要更长、数据驱动的 lag 或 block bootstrap。不要把 \(h-1\) 当作所有情形的充分条件。

### Stage 5：多重检验与数据窥探

先按决策目标选择错误率：

- **只准备部署极少数因子且不能容忍任何假阳性**：控制 family-wise error rate，可用 Holm/Bonferroni；当比较一组有时间依赖、互相关的策略收益时，用 block bootstrap 的 White Reality Check，或功效更高、对无关劣质候选不那么敏感的 Hansen SPA。
- **从大因子库筛选多个候选，允许可控比例的假发现**：控制 FDR。独立/适当正相关下用 Benjamini–Hochberg：

  \[
  k=\max\{j:p_{(j)}\le jq/m\},
  \]

  接受前 \(k\) 个；一般依赖下用相应依赖稳健版本或 bootstrap 校准。\(q=5\%\) 是常见研究选择，不是业务上必然最优。
- **以 Sharpe 为主且发生了大量选择**：补充 DSR；**评估“样本内赢家样本外掉队”的频率**：补充 PBO。二者回答的问题不同，不能互相替代。

Harvey、Liu、Zhu 基于其收集的因子动物园和结构假设提出新因子约需 \(t>3.0\)。它适合作为大规模资产定价搜索的提醒或保守预筛，不是任何资产、频率、样本长度下的普适 p 值换算。Hou、Xue、Zhang 的 \(2.78\) 同样只适用于其 452 异象复现设定。

### Stage 6：样本外与 walk-forward

建议三层数据预算：

1. **Discovery/训练窗**：形成假设、估计预处理和参数；
2. **Rolling/expanding walk-forward**：每折只能用测试期之前的信息；每折完整重估数据处理、模型和组合规则；
3. **Final untouched holdout 或 paper trading**：只在研究被冻结后开启一次。

若标签/持有期跨越折边界，先 purge 掉其结果区间与测试区间重叠的训练样本；组合式或非纯向前交叉验证还要按最大信息重叠期设置 embargo。embargo 没有通用“样本的 1%”标准，应由标签跨度、事件窗口和执行延迟决定。

单个 holdout 不是多重检验的解药：反复查看并据此改模型，会把 holdout 变成新的训练集。每次修改都应累计 trial count，并重新做错误率修正。真正不可重复使用的未来数据、异市场复现或 shadow/paper book，比反复切历史样本更接近真实样本外。

### Stage 7：衰减、稳健性和反证

必须保存“完整曲面”，而不是只保存最优点：

- **持有期衰减**：\(IC(h)\)、分组价差和净收益随 \(h\) 的曲线；可报告
  \[
  D(h)=IC(h)/IC(h_0).
  \]
  仅在同号且近似单调指数衰减时才拟合 \(IC(h)=IC_0e^{-\kappa h}\) 和半衰期 \(h_{1/2}=\ln2/\kappa\)。符号反转或非单调时，半衰期会误导，应直接报告曲线。
- **时间稳定性**：滚动 IC/alpha、子样本符号一致性、最差折、危机/高波动/流动性收缩期。
- **横截面稳定性**：市场、行业、市值、流动性、价格、上市年龄、长端/短端分别报告。
- **实现稳定性**：窗口、滞后、winsor 比例、分位数、权重和再平衡日在合理邻域内扰动；“孤立针尖最优”是过拟合警报。
- **定义稳定性**：原始值、rank、z-score、行业/规模中性版本以及同义数据源复现；中性化前后都需报告，防止把真实机制或风险补偿一起消掉。
- **增量性**：与已知因子相关性、回归 alpha、双重排序、正交化后 IC；同一簇中保留机制更清晰、成本更低、OOS 更稳定者。
- **经济反证**：收益是否集中在无法成交的微盘、少数日期、错误复权、退市缺失或空头不可借标的；毛收益与成本/容量后的净收益同时保存。

Linnainmaa、Roberts 用向前和向后扩展的 20 世纪数据发现，多数会计类异象在样本外收益和 Sharpe 下降、波动与相互相关性上升。因此“相关性上升/拥挤、波动上升”也应进入衰减监控，而不只是看平均收益。McLean、Pontiff 的 26% OOS 和 58% post-publication 降幅可作为美国股票历史压力场景，但不应直接变成全球所有因子的固定折扣。

### Stage 8：决策闸门与持续监控

最终决策不宜由单一加权总分决定。建议设置不可补偿的硬闸门：

- PIT/幸存者/未来函数审计失败：直接淘汰；
- 没有冻结假设、trial ledger 或最终样本外：不得进入生产候选；
- 多重检验后不显著或 OOS 方向反转：退回探索库；
- 收益只来自不可交易子样本、成本后为负或容量不满足目标：不得上线。

对统计闸门，推荐输出置信度而非伪装成普适阈值。若业务需要默认值，可把“多重检验调整后 \(q\le5\%\)、DSR/PSR 置信度 \(\ge95\%\)、PBO <50\%\)”设置为**保守起始配置**，但必须标注：

- 5%/95% 是治理选择；
- PBO 50% 只表示样本内赢家成为样本外低于中位数的概率是否超过硬币水平，不代表 \(49\%\) 就可部署；
- DSR 的有效性依赖完整试验数、有效独立试验数估计和收益矩假设；
- 低频、短样本、厚尾或强自相关场景应优先报告 bootstrap 区间和检验功效，避免用一个看似精确的阈值。

## 3. 两个关键反过拟合统计量

### 3.1 Deflated Sharpe Ratio（DSR）

Probabilistic Sharpe Ratio 对给定基准 \(SR^*\) 的近似为：

\[
PSR(SR^*)=
\Phi\!\left[
\frac{(\widehat{SR}-SR^*)\sqrt{T-1}}
{\sqrt{1-\widehat\gamma_3\widehat{SR}
+\frac{\widehat\gamma_4-1}{4}\widehat{SR}^2}}
\right],
\]

其中 \(T\) 为样本长度，\(\widehat\gamma_3,\widehat\gamma_4\) 为偏度和峰度。DSR 把 \(SR^*\) 替换为 \(N\) 个**有效独立试验**中最大 Sharpe 在零技能假设下的期望近似：

\[
SR^*_0
=\mu_{SR}+\sigma_{SR}\left[
(1-\gamma)\Phi^{-1}\!\left(1-\frac1N\right)
+\gamma\Phi^{-1}\!\left(1-\frac1{Ne}\right)
\right],
\]

\(\gamma\approx0.5772\) 为 Euler–Mascheroni 常数。实现时必须保存所有候选 Sharpe、候选间相关性和总试验数；高度相关的参数变体不能直接当完全独立试验，原论文给出“隐含独立试验数”的处理思路。若收益强自相关、Sharpe 不是合适风险统计量或样本矩极不稳定，DSR 不应成为唯一证据。

### 3.2 Probability of Backtest Overfitting（PBO）

Bailey 等人的 CSCV 做法是把 \(T\times N\) 的同步候选收益矩阵切成偶数个时间区块，枚举等量 IS/OOS 组合；每次在 IS 选择最优候选 \(n^*\)，再看它在 OOS 的相对排名

\[
\bar\omega_c=\frac{\bar r^c_{n^*}}{N+1},\qquad
\lambda_c=\ln\frac{\bar\omega_c}{1-\bar\omega_c}.
\]

PBO 估计为 \(\Pr(\lambda_c<0)\)，即“样本内赢家在样本外落到中位数以下”的组合比例。它是对整个选择流程的诊断，不是某个因子真实 alpha 的概率，也不能替代时间顺序正确的 walk-forward。区块必须足够长以可靠估计目标绩效，且要保留金融时间依赖；不同频率候选先同步到公共索引。

## 4. 对拟建 skill 的直接要求

skill 至少应强制生成以下工件：

- `research_card.json`：冻结假设、方向、数据时点、参数空间和反证；
- `data_lineage.json`：字段版本、`known_at`、股票池、公司行动和执行滞后；
- `trial_ledger.parquet`：包括失败试验、派生关系、试验族、代码/数据 hash；
- `cross_section_report`：IC/RankIC、分组、Fama–MacBeth、暴露和子样本；
- `time_series_report`：HAC alpha、OOS 预测、回撤/尾部、状态稳定性；
- `multiple_testing_report`：原始/调整后 p 或 q、试验数、有效独立试验数、DSR/PBO；
- `walk_forward_report`：每折训练/测试边界、purge/embargo、最差折和参数路径；
- `robustness_surface`：邻域参数、多定义、多市场/行业/规模/流动性及衰减曲线；
- `decision_card`：硬闸门、未通过原因、证据等级、上线后失效/降权/停止条件。

默认报告应并列显示原始结果、扣除多重检验后的结果、walk-forward 结果和最终 holdout；不允许只输出一个“综合得分”隐藏失败维度。

## 5. 主要来源

1. Eugene F. Fama, James D. MacBeth, **Risk, Return, and Equilibrium: Empirical Tests**，Journal of Political Economy (1973)。逐期横截面回归方法的原始来源。  
   https://www.journals.uchicago.edu/doi/10.1086/260061
2. Whitney K. Newey, Kenneth D. West, **A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix**，Econometrica (1987) / NBER。HAC 标准误的原始来源。  
   https://www.nber.org/papers/t0055
3. Campbell R. Harvey, Yan Liu, Heqing Zhu, **…and the Cross-Section of Expected Returns**，Review of Financial Studies (2016)。因子动物园、多重检验及 \(t>3\) 情境门槛。  
   https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2249314
4. Campbell R. Harvey, Yan Liu, **Backtesting**，Journal of Portfolio Management (2015)。Sharpe haircut、试验相关性和真实 OOS 的讨论。  
   https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2345489
5. Halbert White, **A Reality Check for Data Snooping**，Econometrica (2000)。在规格搜索后检验“最佳模型不优于基准”的 bootstrap 方法。  
   https://doi.org/10.1111/1468-0262.00152
6. Peter R. Hansen, **A Test for Superior Predictive Ability**，Journal of Business & Economic Statistics (2005)。比 Reality Check 更有功效、对无关劣质备选不那么敏感的 SPA。  
   https://papers.ssrn.com/sol3/papers.cfm?abstract_id=264569
7. David H. Bailey, Marcos López de Prado, **The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality**，Journal of Portfolio Management (2014)。DSR/PSR、有效试验数与非正态修正。  
   https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
8. David H. Bailey, Jonathan M. Borwein, Marcos López de Prado, Qiji Jim Zhu, **The Probability of Backtest Overfitting**，Journal of Computational Finance (2017；工作论文 2015)。CSCV 与 PBO。  
   https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf
9. Kewei Hou, Chen Xue, Lu Zhang, **Replicating Anomalies**，Review of Financial Studies (2020)。452 个异象、微盘处理、单次/多重检验复现率。  
   https://academic.oup.com/rfs/article/33/5/2019/5236964
10. Juhani T. Linnainmaa, Michael R. Roberts, **The History of the Cross-Section of Stock Returns**，Review of Financial Studies (2018)。向前/向后样本外及异象衰减证据。  
    https://academic.oup.com/rfs/article-abstract/31/7/2606/4977829
11. R. David McLean, Jeffrey Pontiff, **Does Academic Research Destroy Stock Return Predictability?**，Journal of Finance (2016)。97 个预测变量的样本外与发表后衰减。  
    https://doi.org/10.1111/jofi.12365
12. Robert Novy-Marx, Mihail Velikov, **A Taxonomy of Anomalies and Their Trading Costs**，Review of Financial Studies (2016) / NBER。交易成本、换手和成本缓释的系统证据。  
    https://www.nber.org/papers/w20721

## 6. 证据边界

- 上述大样本数字主要来自美国股票、月频异象，不能直接外推到中国 A 股、期货、期权、加密资产或高频信号。
- Fama–MacBeth、HAC、DSR、PBO、Reality Check/SPA 各自依赖不同假设；实际 skill 应按因子类型路由方法，而不是全部机械堆叠。
- 样本外失败可能来自数据挖掘、结构变化、拥挤/套利、成本或数据定义差异。报告应把这些解释分开，不能把所有衰减都归因于“过拟合”。

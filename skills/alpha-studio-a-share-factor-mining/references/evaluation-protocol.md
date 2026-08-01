# 因子评测协议

## 目录

1. 实验合同
2. 预测力
3. 稳健性
4. 多重检验与样本外
5. 换手、成本和容量
6. 风险、拥挤和冗余
7. 经验阈值政策
8. 主要方法来源

## 1. 实验合同

在指标计算前固定：

- universe 和可交易掩码；
- 因子形成时间、决策时间和成交时间；
- 标签的起点、终点和重叠方式；
- 调仓频率、持有期、重叠持仓和权重；
- 基准、风险模型和中性化；
- 成本、冲击、借券和容量；
- discovery、validation、final holdout 和 shadow；
- 主检验、辅助检验和搜索预算。

同一因子的 raw、processed、neutralized 和 tradable portfolio 版本分别留痕。

## 2. 预测力

### IC 与 RankIC

对每个日期做横截面相关：

```text
IC_t(h) = Corr(factor_t, forward_return_t,h)
```

报告：

- Pearson IC、Spearman RankIC；
- mean、median、standard deviation、ICIR；
- 正向比例、分位数、偏度和尾部；
- HAC 或时间 block bootstrap 置信区间；
- 年/月热力图和滚动值；
- 多持有期 decay。

前瞻收益重叠或 IC 自相关时，不使用 i.i.d. t-stat 作为正式结论。

### 分层和单调性

- 默认同时看 5 组和策略实际分组；
- 等权、市值权和策略权重分开；
- Top-Bottom、两端相对母样本、相邻层方向；
- 层号与层收益 Spearman；
- 证券数、行业、规模和流动性组成。

尾部型或阈值型因子不要求中间层严格单调，但必须预先说明并用封存样本验证。

### 回归

横截面因子可使用逐期 Fama-MacBeth：

```text
r_i,t+1 = a_t + b_t x_i,t + c_t' Z_i,t + error
```

对 `b_t` 时间序列使用 HAC。控制变量必须预先指定。

时间序列因子使用实时递归预测、OOS R²、HAC alpha 或适合的概率评分。

## 3. 稳健性

至少覆盖：

- rolling/expanding walk-forward；
- 年度、季度和制度变化时期；
- 牛熊、高低波动、高低流动性；
- 行业、规模、价格、板块、上市年龄和可借券性；
- 参数邻域、winsor、标准化、中性化和调仓日；
- 信号延迟、成交价、滑点和成交失败；
- 数据供应商或同义字段替代；
- 跨市场或异时期复现；
- 最差折和连续失效期。

参数曲面应平滑。孤立针尖最优是过拟合警报。

仅在同号且近似单调衰减时拟合半衰期；出现反转或非单调时直接展示完整曲线。

## 4. 多重检验与样本外

### 错误率路由

- 只部署少数候选、不能容忍任何假阳性：Holm/Bonferroni 或相关策略族的 Reality Check/SPA。
- 从大库筛选多个候选：Benjamini-Hochberg FDR 或依赖稳健校准。
- 以选中 Sharpe 为主：Deflated Sharpe Ratio。
- 诊断样本内赢家的样本外掉队：PBO。

这些方法回答不同问题，不能互相替代。

### 数据切分

1. discovery/training；
2. rolling 或 expanding validation；
3. final untouched holdout；
4. frozen shadow/paper；
5. production。

标签区间跨越折边界时 purge。组合式或非纯向前验证按信息重叠设置 embargo。

反复查看 holdout 会把它变成训练集。每次查看后修改都增加 trial count。

## 5. 换手、成本和容量

分别报告：

- 因子 rank autocorrelation；
- Top/Bottom 成员换手；
- 组合权重换手；
- long 和 short 腿换手。

成本包括：

- 佣金、交易所费用和税费；
- bid-ask spread；
- 延迟和机会成本；
- 市场冲击；
- 涨跌停、停牌和成交失败；
- 融资、借券和召回风险。

冲击至少依赖成交规模、ADV、参与率、波动率和流动性。固定 bps 只可作对照。

容量输出 `AUM × participation × rebalance frequency` 曲面，并报告：

- 成本容量；
- 净 alpha/Sharpe 容量；
- 单名或组合市场容量；
- break-even cost 和 break-even AUM；
- days-to-trade 和持仓集中度。

## 6. 风险、拥挤和冗余

### 暴露和归因

- market beta；
- 行业和板块；
- size、value、momentum、quality、volatility、liquidity 等；
- common factor return、specific alpha 和 cost；
- long/short leg、风险贡献和压力情景。

### 拥挤

组合多个维度：

- 因子股票相关和波动；
- 估值；
- short interest/borrow；
- 近期追涨和反转风险；
- 基金持仓、流量和交易拥塞；
- 同类策略的持仓/交易重叠。

拥挤更适合作为风险预算和压力测试，不宜自动成为单项否决。

### 冗余

计算：

- 因子值相关；
- 中性化后相关；
- IC 和收益相关；
- 持仓和交易重叠；
- residual RankIC、partial IC；
- 加入现有组合后的 OOS 净增量。

最终判断以相同风险、成本和 OOS 口径下的组合增量为准。

## 7. 经验阈值政策

以下只可作为 `heuristic`：

| 指标 | 初始观察值 | 用法 |
|---|---:|---|
| mean RankIC | `|0.01–0.03|` | 与样本量、ICIR、成本和 OOS 联判 |
| ICIR（未年化） | `0.3–0.5` watch | 声明口径，不能跨频率直接比较 |
| IC 正向比例 | `55%–60%` | 同时给区间和最长失效期 |
| 因子相关 | `|rho| > 0.7–0.8` | 触发聚类和增量测试，不直接删除 |
| 显著性 | `t > 3` | 大搜索背景的保守参考，不是普适线 |
| 参与率 | `5%–10% ADV` | 作为压力档，按市场和执行校准 |
| 成本安全边际 | 悲观场景净 alpha 为正 | 从客户净收益/风险目标反推 |
| shadow | 日频 1–3 个月起步 | 以独立信号数和状态覆盖为主 |

把正确性硬闸门、统计置信度和客户业务阈值分开。

## 8. 主要方法来源

- Alphalens：returns、IC、turnover、grouped analysis  
  https://quantopian.github.io/alphalens/
- Qlib：数据、表达式、workflow、实验和回测  
  https://github.com/microsoft/qlib
- Harvey, Liu & Zhu：因子动物园和多重检验  
  https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2249314
- Bailey & López de Prado：Deflated Sharpe Ratio  
  https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
- Bailey et al.：Probability of Backtest Overfitting  
  https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf
- Research Affiliates / CFA：因子交易成本和容量  
  https://rpc.cfainstitute.org/research/financial-analysts-journal/2019/0015198x-2019-1567190
- AlphaBench 2026：生成、评价和搜索任务的分离  
  https://alphabench.cc/
- RD-Agent(Q)：研究—开发—反馈闭环  
  https://arxiv.org/abs/2505.15155


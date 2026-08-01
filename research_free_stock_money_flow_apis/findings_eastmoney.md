# 东方财富 A 股资金流能力核验

核验时间：2026-08-01。

## 结论

- 东方财富网页数据可免费读取个股主力、超大单、大单、中单、小单的**净流入额与净占比**；AKShare 的 `stock_individual_fund_flow` 封装可取近约 100 个交易日。
- `push2.eastmoney.com/api/qt/stock/fflow/kline/get` 当前实测可返回最近交易日的分钟累计主力及四档净流序列，可用于“资金流向”分时曲线。
- 公开网页接口没有稳定契约来保证截图所需的四档各自流入/流出八个金额，因此免费接入时应展示“净流分布”，不应反推或伪造双边金额。
- 这些是网页内部接口而非开放开发者 API，无 SLA、版本与配额承诺；2026 年 AKShare 已出现东财资金流排行端点被远端断开的公开故障记录。
- 适合作为免费原型或降级源；生产接入应走后端代理，并加入缓存、限频、超时、字段校验、来源及更新时间标记。

## 已核验字段

AKShare 对东方财富个股资金流的公开封装返回日期、收盘价、涨跌幅，以及主力/超大/大/中/小单的净额和净占比。目标页面为 `https://data.eastmoney.com/zjlx/detail.html`，文档注明近约 100 个交易日。

分钟接口实测地址形态：

```text
https://push2.eastmoney.com/api/qt/stock/fflow/kline/get
  ?lmt=0&klt=1&secid=0.000001
  &fields1=f1,f2,f3,f7
  &fields2=f51,f52,f53,f54,f55,f56
```

2026-08-01 请求返回最近交易日 2026-07-31 从 09:31 起的分钟累计序列；具体匿名字段映射必须在适配器中固定测试，不能依赖猜测。

## 风险边界

AKShare/efinance 是调用封装，不是数据授权方。免费可访问不等于允许批量抓取、缓存、公开再分发或商业使用；正式发布前应核对东方财富服务协议或取得授权。

“主力”是按成交规模与主动买卖方向计算的指标，不是被识别出的同一机构或庄家账户，因此不能用它证明“主力仍在”。

## 来源

- AKShare 个股资金流文档：<https://akshare.akfamily.xyz/data/stock/stock.html>
- 东方财富个股资金流页面：<https://data.eastmoney.com/zjlx/detail.html>
- 东方财富分钟资金流接口（实测）：<https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=0.000001&fields1=f1%2Cf2%2Cf3%2Cf7&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56>
- AKShare 资金流端点故障记录：<https://github.com/akfamily/akshare/issues/7001>
- 东方财富服务协议：<https://about.eastmoney.com/home/protocol>

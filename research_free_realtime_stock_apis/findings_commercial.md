# 子题2：A股商业/量化数据平台的免费实时行情能力

调研时点：2026-08-01。这里把“盘中实时行情 API”限定为：个人开发者可在自己的程序中持续获得当日盘中最新价、分钟线或 Tick/盘口，而不是仅能在平台网页或平台托管策略中使用行情。

## 结论摘要

| 平台 | 永久免费层含可独立调用的盘中实时 A 股行情？ | 实际可用形态 | 判定 |
|---|---|---|---|
| Tushare Pro | **否** | 有正式的实时分钟、实时日线 REST/Python API，但须单独付费开通 | 商业付费接口，规则最透明 |
| 聚宽 JoinQuant | **否（平台内分钟级模拟另算）** | 普通账户可在聚宽云端策略中使用分钟级当前数据；独立本地 JQData 不是长期免费实时源 | 免费但被平台运行环境圈定 |
| 米筐 Ricequant | **否；仅 30 天试用** | RQData 试用可含实时 Tick；正式使用需商业授权；平台模拟交易用 L1，约 3–5 秒延迟 | 很适合验证，不适合当长期免费源 |
| 掘金 MyQuant | **未发现可确认的通用永久免费行情数据层** | 免费线上仿真明确使用实时盘口并支持交易 API；行情 SDK 文档有实时推送，但免费仿真 API 不等于无约束的数据分发 API | 平台内可免费仿真，独立行情权限需登录/咨询确认 |
| BaoStock | **否** | 免费、开源、无需注册，但提供的是历史 K 线；分钟数据交易日 20:00 才完成入库 | 真免费历史数据，不是实时行情 |

最重要的选型结论：这五家中，截至本次核验，**没有一家同时满足“永久免费、个人可注册、可在本地程序独立拉取/订阅全 A 股盘中实时行情”**。Tushare 是明确付费；RQData 是限期试用；JoinQuant、MyQuant 的免费实时能力主要服务平台内模拟/托管策略；BaoStock 盘后更新。

## 1. Tushare Pro

### 免费层与实时性

- 注册后可取得 token，Python SDK 与 HTTP 均可调用。
- 免费积分档为 120 积分，官方表格写明只可访问“非复权日线数据”，每分钟 50 次、每天 8,000 次；**分钟权限不包含在积分内**。
- `rt_min` 提供全 A 股 1/5/15/30/60 分钟盘中行情，单次最多 1,000 行；实时分钟权限须单独开通。
- 个人价格表（2026 页面）：
  - 实时分钟：1,000 元/月，每分钟 500 次，单次最多同时请求 300 家公司；
  - A 股实时日线：200 元/月，每分钟 50 次，每次可取全市场；
  - 机构费用为个人价 10 倍。
- API 形态：Python SDK、HTTP；官方权限表明确给期货实时分钟列出 WebSocket，但 A 股实时分钟一栏只披露请求频次，因此不要默认 A 股也有 WebSocket。

### 判断

**不是免费实时接口。** 优点是权限、价格和限频公开明确，适合愿意付费且需要标准化 API 的个人项目；免费账号只能承担日线验证。

### 官方来源

- [Tushare：积分与频次权限对应表](https://tushare.pro/document/1?doc_id=290)
- [Tushare：A股实时分钟 rt_min](https://tushare.pro/document/2?doc_id=374)
- [Tushare：A股实时分钟—日累计 rt_min_daily](https://tushare.pro/document/2?doc_id=457)

## 2. 聚宽 JoinQuant / JQData

### 免费层与实时性

- 聚宽平台的策略 API 有 `get_price`、`history`、`get_current_data` 等 Python 接口；官方股票数据文档明确说明，分钟策略中可以读取当前单位时间数据，历史分钟数据通常不包含正在形成的当前分钟。
- 这类数据主要位于聚宽的研究、回测、模拟交易云环境中，不等价于面向任意外部程序的公开实时 REST/WebSocket 行情服务。
- 官方 VIP 对比页显示，普通免费层不支持 Tick 回测/模拟，VIP/SVIP 才支持。这意味着普通免费账户可做分钟级平台策略，但不能据此宣称获得免费 Tick 实时源。
- JQData 是供本地 Python 程序调用的独立数据产品。公开资料长期采用试用/商业升级模式；本轮未在官方现行页面找到“永久免费实时层”或稳定公开的实时请求额度，因此应按商业产品而不是免费数据源评估。
- 注册门槛：聚宽账号；在平台内编写 Python 策略。外部 JQData 还需对应账号/授权。

### 判断

**免费的是平台内的量化研究与分钟级模拟能力，不是通用的独立免费实时行情 API。** 若策略本来就托管在聚宽，免费层有使用价值；若要把行情灌入自己的服务，则不应把聚宽免费账户列为数据源。

### 官方来源

- [JoinQuant：股票数据与当前单位时间行情 API](https://www.joinquant.com/help/data/stock?f=home&m=footer)
- [JoinQuant：VIP 功能/额度对比](https://www.joinquant.com/view/vip/charge)
- [JoinQuant API 文档 PDF](https://cdn.joinquant.com/help/img/JoinQuantAPI.pdf)

注：调研网络访问 JoinQuant 页面时出现“当前地区暂不支持访问”，上述判断同时参考了官方搜索索引摘要；具体试用天数、数据量和并发限制在接入前应登录账号后再次核对。

## 3. 米筐 Ricequant / RQData

### 免费层与实时性

- 当前 RQData 产品页明确提供 **30 天免费试用**，不是永久免费层。
- 产品页列出的试用权限包含日、分钟、Tick（含实时），涵盖 A 股、指数、ETF、可转债等；需提交资料申请，取得账号/license。
- 实时行情文档显示：A 股支持主板、创业板、科创板；频率包括 Level-1 Tick 五档和任意分钟合成；提供 Python SDK 与 WebSocket 推送。
- RQData 另有 HTTP API，需要账号密码换 token；产品页还列出 Matlab API。实时推送示例使用 `rqdatac.init(username="license", password="...license key...")`，说明权限由 license 控制。
- 平台“实时模拟交易”使用 A 股 Level-1，官方说明约有 **3–5 秒延迟**，并按快照合成分钟线。这是模拟交易运行环境，不等于向外部程序永久免费分发实时流。
- 官方公开页未披露试用账号固定 QPS/每日条数；具体并发、标的订阅上限及商用/再分发权需以开通邮件和合同为准。

### 判断

**本组中最完整的免费试用方案，但不是长期免费方案。** 适合做 30 天技术验证、延迟测试和字段适配；生产使用需要预算与授权确认。

### 官方来源

- [Ricequant：RQData 产品与 30 天试用权限](https://www.ricequant.com/welcome/rqdata)
- [Ricequant：实时行情推送（Python SDK / WebSocket）](https://www.ricequant.com/doc/rqdata/python/generic-api.html)
- [Ricequant：HTTP API 数据获取与鉴权](https://www.ricequant.com/doc/rqdata/http/data-process)
- [Ricequant：实时模拟交易数据源及 3–5 秒延迟](https://www.ricequant.com/doc/quant/pt.html)

## 4. 掘金量化 MyQuant

### 免费层与实时性

- 官方行情文档支持沪深股票实时 Tick、五档 Quote 以及 30/60/300/900/1800/3600 秒 Bar；“实时模式”被定义为行情服务器在交易时段推送交易所实时行情。
- 独立的“掘金线上仿真”官方页面称其免费开放，覆盖沪深 A 股，使用实时盘口撮合，并允许 API 接入。
- 但线上仿真 API 的公开帮助重点是下单、撤单、资金/持仓/成交查询和回报推送；它没有公开承诺用户能把全市场实时盘口当作独立数据流拉走。因此应区分：
  1. **免费仿真交易可消费实时行情**；
  2. **通用行情 SDK 的实时订阅权限是否永久免费**，官方公开资料没有给出足够证据。
- 注册/接入：需掘金账号、token 和仿真账户；Python 交易 SDK 为 `gmtrade`，官方亦提供 C++；行情/策略 SDK 文档还覆盖 Python、C++、C# 等。
- 仿真帮助页披露的运营限制包括每用户最多 2 个账户、每账户每天最多 1,000 笔委托；这属于交易限额，不是行情请求限额。行情订阅标的数、QPS、外部展示/再分发限制未公开，应向官方确认。
- 股票实盘需要申请并由合作券商版本支持，不能把免费仿真权限直接视为实盘行情授权。

### 判断

**可作为免费策略仿真环境，但暂不应列为“已确认的通用永久免费实时数据 API”。** 若需求是运行少量标的的模拟策略，值得实测；若需求是行情采集、落库或二次分发，必须先让官方书面确认免费版行情授权与订阅上限。

### 官方来源

- [MyQuant：股票实时行情数据结构与频率](https://www.myquant.cn/docs/l3333/923)
- [MyQuant：实时模式是交易时段行情服务器推送](https://www.myquant.cn/docs/csharp/cs-important-concepts.md)
- [MyQuant：免费线上仿真、实时盘口撮合与 API 接入](https://sim.myquant.cn/sim/home)
- [MyQuant：线上仿真 API 帮助、账号与委托限制](https://sim.myquant.cn/sim/help/)
- [MyQuant：股票实盘申请与券商版本](https://www.myquant.cn/docs2/operatingInstruction/trading/%E5%AE%9E%E7%9B%98%E4%BA%A4%E6%98%93.html)

## 5. BaoStock

### 免费层与实时性

- 官方自述是“免费、开源、无需注册”的证券数据平台，Python 包登录即可查询。
- `query_history_k_data_plus()` 提供 A 股日/周/月以及 5、15、30、60 分钟历史 K 线；**没有 1 分钟，更没有 Tick/盘口实时推送**。
- 官方 2026-07 更新说明写得非常清楚：交易日 17:30 完成日 K 入库，18:00 完成复权因子，**20:00 完成分钟 K 线入库**。所以交易时段取不到当日实时分钟行情。
- A 股分钟历史范围为近 5 年；指数不提供分钟线。API 形式为 Python SDK/自有 TCP 服务，未提供官方 REST/WebSocket 实时流。
- 官方未公开固定 QPS/每日次数，仍应避免高并发滥用；其优势是无注册、免费历史研究，不是盘中监控。

### 判断

**真免费，但不实时。** 适合作为历史日线/5 分钟以上 K 线的补充或回测数据源，不能满足盘中盯盘、预警或交易信号需求。

### 官方来源

- [BaoStock：平台介绍、免费/无需注册及更新时间](https://www.baostock.com/helpDocsHome?file=home.md)
- [BaoStock：Python API 文档](https://www.baostock.com/helpDocsHome?file=pythonAPI.md)
- [BaoStock：A股 K 线接口](https://www.baostock.com/helpDocsHome?file=stockKData.md)

## 对主报告的建议分层

1. **付费但清晰可接入**：Tushare（实时分钟 1,000 元/月；实时日线 200 元/月）。
2. **免费试用**：Ricequant RQData（30 天，实时 Tick/分钟；SDK/HTTP/WebSocket）。
3. **平台内免费、不可等同外部行情源**：JoinQuant 分钟级云策略；MyQuant 免费仿真。
4. **真免费但盘后更新**：BaoStock。

若目标是开发阶段零成本验证，可以用 BaoStock 做历史回测，再用 JoinQuant/MyQuant 的平台模拟验证策略事件逻辑；若要在本地服务长期盘中运行，需转向付费持牌/商业行情，或另行评估非官方抓取源的稳定性与合规风险。

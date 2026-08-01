# 富途 OpenAPI / OpenD：A 股工作台可用能力与边界

> 调研日期：2026-08-01。以下仅依据富途公开 OpenAPI v10.9 文档；生产使用前仍应由账号实测权限、限频和数据授权条款。

## 结论先行

- **不能把富途接口直接接到浏览器前端。** 官方示例均由 Python / Java / C# / C++ / JavaScript 客户端连接正在运行的 OpenD（典型地址 `127.0.0.1:11111`）。OpenD 是带账号登录、行情权限和长连接状态的本地/服务端网关；浏览器既不适合直接使用其 TCP/Proto 通道，也不应暴露 OpenD 端口或登录态。正确架构是：`Web 前端 → Alpha Studio 后端/BFF → OpenD → 富途`，由后端完成鉴权、缓存、限频、订阅复用和降级。
- **A 股行情可用，但受账号权限和额度控制。** 官方权限页说明 A 股证券（股票、ETF）对境内认证客户可免费取得 LV1；A 股股票可订阅权限为 LV1。OpenAPI 权限与 App 权限并不完全相同，还存在接口限频、实时订阅额度和“每 7 天可拉取历史 K 线标的数”限制。
- **可覆盖工作台核心行情模块：** 指数/股票快照、实时行情、分时、实时与历史 K 线、市场状态、板块与成分股、条件选股/排序、个股资金流/资金分布、财务报表、分红等均有公开接口。
- **不能假设富途 App「沪深」页所有内容都有公开接口。** 官方总览未列出与 App 中宏观指标/财经日历、投资主题图卡、产业链、智能盯盘、走势预测、整市场热力图/涨跌分布完全对应的专用接口。它们应由其他合规数据源、后端计算或产品自有内容实现，不能依赖抓取富途 App 私有接口。

## 能力映射

| 工作台模块 | 可用公开接口/做法 | 关键限制 |
|---|---|---|
| 指数卡、股票报价 | `get_market_snapshot`、`get_stock_quote`；快照含最新价、OHLC、成交量额、换手率、估值，指数/板块快照还有上涨/下跌/平盘数量 | 需要对应市场行情权限；单次快照最多 400 个标的 |
| 分时、盘口、逐笔 | `get_rt_data`、`get_order_book`、`get_rt_ticker`，以及订阅推送 | 实时类通常需先订阅；受 LV1、订阅额度和限频约束 |
| K 线 | `get_cur_kline`（实时，必须先订阅）、`request_history_kline`（历史） | 历史 K 线按“7 天内访问的标的数”计额度，不适合前端任意无限回溯 |
| 板块/概念 | `get_plate_list`、`get_plate_stock`、`get_owner_plate` | 沪/深传入任一市场标识，板块列表均返回沪深子板块；可支撑行业/概念入口与成分详情 |
| 涨幅榜、热门榜、筛选器 | `get_stock_filter`、`get_stock_screen`（V2，支持多因子、多字段排序） | 可按涨跌幅、成交额、换手率、估值等构建榜单；文档总览没有与富途 App“热议/热度”完全等价的数据源 |
| 资金流 | `get_capital_flow`、`get_capital_distribution` | 公开能力主要是**单个标的**的资金流向/大中小单分布；全市场主力榜和智能异动需后端批量聚合并受限频约束 |
| 财务与公司资料 | `get_financials_statements`（利润表/资产负债表/现金流/主要指标）、`get_financials_revenue_breakdown`、财报前后涨跌、估值、分红/回购/拆股、公司资料等 | 财报接口可做个股详情；不等于沪深全市场财报日历，需另行核对日历数据源 |
| 宏观、财经日历 | 未在行情接口总览中发现对应的公开宏观时间序列/日历接口 | PMI、GDP、零售、事件日历建议使用现有合规数据源，并在 UI 标注来源与更新时间 |
| 热力图、涨跌分布 | 用板块/全市场证券列表 + 快照聚合计算；指数/板块快照也提供涨/跌/平数量 | 属于自算展示，不应宣称为富途原生接口；注意 400 标的/次、限频、缓存和市场全量规模 |

## 建议接入方式

1. 后端启动并维护 OpenD，使用独立 `FutuQuoteProvider` 适配器；前端只访问项目自己的 HTTP/WebSocket API。
2. 后端按“指数 1–3 秒、榜单 5–15 秒、板块/财务更长时间”分层缓存；多个前端会话复用同一订阅，避免耗尽额度。
3. UI 明示 `实时 / 延迟 / 缓存 / 降级` 和数据更新时间；权限不足时自动回退现有东方财富/聚宽等数据源，不把错误数据显示为 0。
4. 富途 OpenAPI 只作为授权数据源；不要抓取 App 私有接口，也不要把 OpenD 端口暴露到公网。上线前应确认富途行情数据是否允许在本产品形态中向终端用户展示/再分发。

## 官方来源

- [权限与额度](https://openapi.futunn.com/futu-api-doc/intro/authority.html)：OpenAPI 与 App 权限差异、A 股 LV1、接口限频、订阅额度、历史 K 线额度。
- [行情接口总览](https://openapi.futunn.com/futu-api-doc/quote/overview.html)：实时行情、K 线、板块、筛选、资金流、财务与公司行动等公开接口目录。
- [订阅与反订阅](https://openapi.futunn.com/futu-api-doc/quote/sub.html)：实时订阅机制、权限与额度行为。
- [获取快照](https://openapi.futunn.com/futu-api-doc/quote/get-market-snapshot.html)：单次最多 400 标的及快照字段。
- [获取实时 K 线](https://openapi.futunn.com/futu-api-doc/quote/get-kl.html)；[获取历史 K 线](https://openapi.futunn.com/futu-api-doc/quote/request-history-kline.html)。
- [获取板块列表](https://openapi.futunn.com/futu-api-doc/quote/get-plate-list.html)：沪深板块市场参数规则。
- [获取财务报表](https://openapi.futunn.com/futu-api-doc/quote/get-financials-statements.html)：利润表、资产负债表、现金流与主要指标。
- [行情常见问题](https://openapi.futunn.com/futu-api-doc/qa/quote.html)：A 股股票订阅支持 LV1、限频和订阅释放规则。


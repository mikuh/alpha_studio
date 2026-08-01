# 子题 3：A 股非官方 / 开源实时接口（截至 2026-08）

> 核查日期：2026-08-01。这里的“实时”指财经网站网页行情级别的当前快照或盘中更新，不代表交易所直连、逐笔低延迟行情，也没有可验证的延迟 SLA。当前为非交易日，未做盘中端到端延迟实测。

## 结论先行

1. **AkShare 是抓取/清洗封装层，不是行情授权方。** 它免费、无需 API Key，适合个人研究、原型和开发测试；不应视为可用于生产交易、公开展示或数据再分发的“免费授权实时源”。AKShare 官方也把项目定位为学术研究，明确提示商业风险、网页变化会导致接口异常，且大规模使用应采购正式数据源。[AKShare 项目概览](https://akshare.akfamily.xyz/introduction.html)；[维护者关于 `xx_em` 接口及大规模使用的说明](https://github.com/akfamily/akshare/issues/7036)
2. **开发测试的首选组合是“东财主源 + 新浪/腾讯低频交叉验证”，并在本地做缓存和熔断。** 东财字段最丰富，新浪和腾讯可在主源异常时校验最新价/涨跌/成交量；但三者都没有对这些网页内部接口公布免费 API 配额、稳定性承诺或服务等级。
3. **截至 2026 年，东财反爬/限流风险已经是实质性工程约束。** 2026-01 的 AKShare issue 展示了 `RemoteDisconnected`、同批接口有成有败、一次全市场调用耗时可达 83.54 秒等情况；评论区还有“频繁请求后被拒”“换 IP 仍不稳定”等用户报告。这些是社区个案而非官方配额，但足以证明不能把它当生产 SLA。[Issue #6986](https://github.com/akfamily/akshare/issues/6986)
4. **最关键的合规红线在数据权利而非开源许可证。** AkShare 代码采用 MIT，并不授予上游行情数据权利。东方财富 2025-07-18 生效的协议明确：未经交易所书面同意，不得复制或向机构/个人提供全部或部分行情数据，也不得用于开发衍生品；其服务及时性、连续性、准确性亦不作保证。[东方财富用户服务协议](https://about.eastmoney.com/home/protocol)

## 可用接口矩阵

| 上游 / AkShare 函数 | 粒度与范围 | 文档所称实时性 | 实际请求特征与频率风险 | 适用判断 |
|---|---|---|---|---|
| 东方财富 `stock_zh_a_spot_em()` | 沪深京全市场快照；最新价、OHLC、成交量额、五分钟涨跌、换手、市值等 23 列 | 官方文档称“实时行情”；网页快照级，无延迟 SLA | 当前源码调用 `push2.eastmoney.com/api/qt/clist/get` 并分页，每页 100；约 5,000+ 股票意味着一次函数调用会放大成约 50+ 个上游请求。无公开配额，近期有断连/限流报告 | **原型主源**；适合 15–60 秒级低频全市场快照，不适合秒级轮询 |
| 东方财富 `stock_bid_ask_em(symbol)` | 单股行情报价，含买一至买五、卖一至卖五及量等 | 当前报价快照 | 单股票一次请求，仍是未授权网页接口；多股票并发会线性放大 | 自选股低频盘口展示/校验；不是交易所 Level-2 |
| 东方财富 `stock_zh_a_hist_min_em(symbol, period)` | 单股 1/5/15/30/60 分钟 K 线；1 分钟仅近 5 个交易日且不复权 | 盘中最近分钟线，可视为准实时 | 单股票一次请求；1 分钟接口走 `trends2/get`，其他周期走 `kline/get`。无官方限额 | 盘中研究和补分钟线较实用；建议按分钟收一次并落库 |
| 东方财富 `stock_zh_a_hist_pre_min_em(symbol)` | 最近交易日分钟数据，含盘前分钟；OHLC、量额、最新价 | 最近交易日准实时分钟数据 | 单股票请求，时间范围默认 09:00–15:40 | 研究集合竞价/盘前轨迹；不能等同完整逐笔委托队列 |
| 东方财富 `stock_intraday_em(symbol)` | 最近交易日成交明细，包含盘前；成交时间、成交价、手数、买卖盘性质 | 日内明细，文档未给延迟保证 | 数据量较大，单股票拉全日；上游为 `stock/details/sse` | 复盘/小样本研究；不要对股票池高频并发 |
| 新浪 `stock_zh_a_spot()` | 沪深京全市场快照；价格、买卖价、OHLC、量额和时间戳 | 官方文档称“实时行情” | **AKShare 文档直接警告：重复运行会被新浪暂时封 IP，建议增加间隔。** 底层同样分页，单次逻辑调用包含大量 HTTP 请求 | 主源故障时低频备源；不适合作固定秒级轮询器 |
| 新浪 `stock_zh_a_minute(symbol, period)` | 单股/指数 1/5/15/30/60 分钟，支持复权 | 最近交易日分钟线 | 文档明确“注意调用频率”；无数值配额 | 分钟线备源/交叉验证 |
| 新浪 `stock_intraday_sina(symbol, date)` | 指定近期交易日的大单明细，仅成交量 ≥400 手 | 不是完整实时逐笔 | 仅大单，天然不完整；日期和频率均受上游限制 | 仅适合大单研究，不可充当逐笔行情 |
| 腾讯 `stock_zh_a_spot_tx()` | 沪深京全市场当前快照 | 源码描述为“实时行情数据” | 2026-04 新增；请求 `proxy.finance.qq.com/.../getBoardRankList`，每页 200，完整市场约 25–30 个请求；返回上游 `rank_list` 原始字段，文档成熟度低于东财/新浪 | 可作新备源和价格校验，需锁版本并自建字段映射测试 |
| 腾讯 `stock_zh_a_tick_tx_js(symbol)` | 最近交易日成交明细 | **每个交易日 16:00 才提供当日数据** | 逐页抓取直到异常；源码还对响应片段使用 `eval`，应在隔离环境/固定版本中使用 | **不是盘中实时接口**；仅收盘后复盘 |
| 腾讯 `stock_zh_ah_spot()` | A+H 股票集合，不是全部 A 股 | 文档明确延迟 15 分钟 | 免费网页数据，无配额/SLA | 仅 A/H 比价场景，不满足 A 股实时主源需求 |

接口与粒度依据：[AKShare 股票数据文档（版本 1.18.81）](https://akshare.akfamily.xyz/data/stock/stock.html)。腾讯全市场函数尚未出现在该文档相应章节，但已经在主分支源码中，代码日期为 2026-04-20：[源码 `stock_zh_a_tx.py`](https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_zh_a_tx.py)。东财分页与分钟接口可核对：[源码 `stock_hist_em.py`](https://github.com/akfamily/akshare/blob/main/akshare/stock_feature/stock_hist_em.py)；新浪与腾讯成交明细：[新浪源码](https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_zh_a_sina.py)、[腾讯明细源码](https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_zh_a_tick_tx.py)。

## “免费”与“实时”的准确解释

- **免费**：调用这些网页接口通常不需要开发者 Key，也没有 AKShare 调用费；不等于上游明确授予 API 使用、商业使用、公开展示或再分发权。
- **实时**：`spot` 返回请求时上游网页看到的当前快照；它是 HTTP 拉取，不是 WebSocket 推送，也不是交易所逐笔流。延迟由交易所授权链路、财经站刷新节奏、缓存、网络和 AkShare 分页耗时共同决定。
- **分钟级准实时**：分钟 K 线通常要等当前分钟形成/刷新；适合因子研究与看板，不宜用作低延迟下单触发源。
- **分笔不一定实时**：腾讯分笔明确到 16:00 才提供；新浪大单明细还是不完整抽样。函数名含 `tick` 或 `intraday` 不能据此推断盘中实时。
- **无公开频率上限**：三家抓取接口均没有面向开发者的正式免费 API 配额说明。不能把社区经验写成固定“每分钟 N 次”。合理做法是限速、缓存、随机抖动、指数退避，并在收到 403/断连/空数据时停止加压。

## 稳定性与反爬风险

### 东方财富

- 全市场 `stock_zh_a_spot_em()` 的分页放大最明显；即使业务层每 10 秒只调用一次，底层也可能是几十个连续请求。
- 2026-01 的 issue 中，全市场快照一次成功耗时 83.54 秒；同次测试的板块接口出现 `RemoteDisconnected`。这说明页面源、IP/指纹策略、请求节奏与上游临时变更都可能导致抖动。[Issue #6986](https://github.com/akfamily/akshare/issues/6986)
- AKShare 本身持续修复目标网页变化，并明确提示需要经常升级最新版；这意味着接口 schema/host/token 参数可能随时变化，不宜把原始 URL 硬编码成长期稳定协议。[项目概览](https://akshare.akfamily.xyz/introduction.html)

### 新浪

- AKShare 文档对 `stock_zh_a_spot()` 明示重复运行会暂时封 IP，这是本次找到的最明确频率警告，但没有官方安全阈值。
- 全市场分页抓取成本高；比起高频全市场调用，更适合在东财失败时触发一次或每数分钟做抽样校验。

### 腾讯

- `stock_zh_a_spot_tx()` 是 2026 年新加入的分页封装，当前主文档收录滞后；函数直接返回上游原始列表，字段兼容性、空值和排序变化应自行回归测试。
- 腾讯旧 `stock_zh_a_tick_tx_js()` 是收盘后数据，不要因“成交明细”误用于盘中实时；其逐页请求和宽泛异常退出也会掩盖部分下载失败。

## 合规和许可风险

1. **代码许可与数据许可分离。** GitHub 显示 AkShare 为 MIT License，但 MIT 仅覆盖软件代码。上游行情数据仍受交易所和网站协议约束。[AkShare GitHub](https://github.com/akfamily/akshare)
2. **AkShare 自身限定研究用途。** 官方风险提示称数据接口与数据仅用于学术研究，并提示商业风险；维护者进一步建议大规模使用采购 Choice、Wind、iFinD 等正式源。[项目概览](https://akshare.akfamily.xyz/introduction.html)；[Issue #7036](https://github.com/akfamily/akshare/issues/7036)
3. **东财协议限制非常明确。** 未经交易所事先书面同意，不得复制、向任何机构或个人提供全部/部分行情数据，亦不得用于开发衍生品；同时不保证及时性、连续性、准确性，并可变更或终止服务。[东方财富用户服务协议](https://about.eastmoney.com/home/protocol)
4. **新浪/腾讯隐藏网页接口没有开发者合同。** 本次未找到这两个 endpoint 面向公众的 API 许可、配额或 SLA；因此应按“权限不明确的网页采集”管理，而不是按正式开放 API 管理。公开网站可访问不等于允许批量抓取或再分发。
5. **风险分层**：个人本地研究/短期原型风险相对低；团队共享行情库、对外看板、App 行情展示、付费服务、自动交易生产信号和数据转售风险显著升高，后几类应改用持牌/授权行情源并让法务确认展示与衍生使用权。

## 建议的开发测试架构

```text
东财 spot/minute（主） ─┐
新浪 spot/minute（备） ─┼─> 统一字段与时间戳 -> 本地 Redis/SQLite 缓存 -> 研究/原型
腾讯 spot（校验/备）   ─┘              │
                              限速、熔断、退避、质量检查
```

- 全市场：东财快照 30–60 秒一次起步；仅在主源失败或每 3–5 分钟抽样调用新浪/腾讯。这里是保守工程建议，**不是上游承诺的安全配额**。
- 自选股：优先单股报价/分钟接口；同一来源全局串行或小并发，建议起步不超过 1 请求/秒，遇断连/403/空数据指数退避到 1、2、4、8、30 分钟。
- 缓存：同一业务周期只抓一次，所有消费者读取本地缓存；保存 `source`、`fetch_time`、上游行情时间戳和原始响应哈希。
- 质量检查：比较两源的交易日、最新价、累计成交量；检测停牌/集合竞价/午休/收盘状态，避免把陈旧值当实时值。
- 降级：全市场失败时不自动无限重试；改为上次快照并标记 stale，随后低频探活。不要用代理池或伪造指纹去绕过封禁，这会增加条款与反爬风险。
- 版本：固定 AkShare 版本，适配层内隔离字段变化；每日开盘前做 3–5 个样本代码的 smoke test。

## 最终评级

| 方案 | 免费可接入 | 行情新鲜度 | 稳定性 | 合规清晰度 | 推荐用途 |
|---|---:|---:|---:|---:|---|
| AkShare + 东方财富 | 是 | 网页实时 / 分钟级 | 低–中 | 低 | 本地研究、原型主源 |
| AkShare + 新浪 | 是 | 网页实时 / 分钟级 | 低（明示封 IP 风险） | 低 | 低频备源 |
| AkShare + 腾讯 | 是 | 网页实时；tick 为收盘后 | 低–中，且新接口成熟度待观察 | 低 | 交叉验证和备源 |
| 直接调用上述隐藏 endpoint | 技术上通常是 | 同上 | 更低，维护成本更高 | 低 | 不优于 AkShare，仅调试时使用 |

**一句话建议：** 如果目标是个人研究或 MVP，使用 AkShare 的东财快照/分钟线，辅以腾讯或新浪低频校验并严格缓存限速；如果目标是生产自动交易、对外展示、团队级行情服务或商业化，则这些方案都不应被当作“免费实时 API”，应改用有明确授权和 SLA 的正式行情渠道。

## 主要来源

- AKShare 项目概览（文档更新 2026-07-29）：https://akshare.akfamily.xyz/introduction.html
- AKShare 股票数据文档 1.18.81：https://akshare.akfamily.xyz/data/stock/stock.html
- AkShare GitHub / MIT：https://github.com/akfamily/akshare
- 腾讯全市场实时函数源码：https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_zh_a_tx.py
- 东财实时与分钟接口源码：https://github.com/akfamily/akshare/blob/main/akshare/stock_feature/stock_hist_em.py
- 2026-01 东财断连/限流实例：https://github.com/akfamily/akshare/issues/6986
- 维护者关于大规模使用的说明：https://github.com/akfamily/akshare/issues/7036
- 东方财富用户服务协议（生效/更新 2025-07-18）：https://about.eastmoney.com/home/protocol


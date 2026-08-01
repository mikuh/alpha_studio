# Claude 驱动的股票研究/交易 Agent 生态核查

> 核查时间：2026-08-01。范围限定为第三方产品、开源项目和社区公开实验。这里的“Claude 驱动”包括以 Claude 为默认/可选推理引擎，或把 Claude 通过 MCP 接到行情与券商；二者不是一回事，表中单独标明。

## 先给结论

目前真实存在的生态不是一个统一的“Claude 炒股产品”，而是四层拼装：**Claude/其他 LLM 做推理 → 数据源提供实时行情与基本面 → MCP/应用后端暴露工具 → 券商 API 执行订单**。代表项目可以覆盖从研究到实盘的完整能力阶梯，但项目成熟度和“Claude 含量”差异很大：

- **研究助手**已经产品化，Dexter 能生成带引用的股票研究、筛选与回测，但其 Claude 接入是 MCP 客户端能力，不等于模型独占。
- **信号生成**多与研究混合；nightclaude 把 Claude 的自主研究循环压缩成 S&P 500 仓位目标，OpenAlice/SkopaqTrader/OpenProphet 则输出 BUY/SELL/HOLD 或直接构造订单。
- **模拟盘**最常见，Alpaca Paper 是事实上的社区默认验证环境；OpenProphet 作者明确要求只用 paper。
- **实盘自动执行**在技术上已经存在：Dexter、OpenAlice、SkopaqTrader、Alpaca MCP 和 OpenProphet 都有 live 路径。但“能下单”不等于“已验证盈利”；公开材料主要证明功能存在，极少提供经审计的长期实盘业绩。
- **最容易被误读的两点**：① Alpaca MCP 是券商工具桥，不是自带投资策略的 Agent；② OpenAlice、SkopaqTrader、OpenProphet 都不是 Claude-exclusive，分别支持多模型或混合模型。

## 代表性实例（6 个）

### 1. Dexter — 商业研究助手，附带人工触发的纸盘/实盘下单

- **类型**：研究助手 ✅｜信号生成 ✅｜模拟盘 ✅｜实盘执行 ✅（一键路由/用户触发，不是无人值守策略循环）
- **Claude 角色**：Pro 版把 Dexter 作为 10 个 HTTP 工具的 MCP Server 接入 Claude Code；产品自身也支持 BYOK/AWS Bedrock，因此更准确的表述是“Claude 可调用的金融研究与交易服务”，不是纯 Claude Agent。
- **能力**：覆盖 17,000+ 美股、16,000+ 财报电话会文本；深度研究、机会扫描、CANSLIM 风格评分、技术指标、价格目标、组合情景分析、回测和模型组合。产品页面称可把“确切订单”一键路由到已连接券商，也可生成深链让用户自行执行。
- **数据/券商依赖**：Financial Datasets、Yahoo Finance、CoinGecko；SnapTrade 只读同步 Robinhood、Schwab、Fidelity、IBKR、Webull、E*TRADE、Coinbase；真正下单依赖 Alpaca paper/live。
- **当前状态**：商业网站和定价页在线，功能页在核查日可访问；Free/Starter/Pro 三档，Alpaca paper/live 与 Claude MCP 均为 Pro。没有看到独立第三方对交易执行或收益的审计。
- **证据质量**：**中**。能力与依赖由供应商一手页面明确陈述；但页面同时声称开源核心有“20,000+ GitHub stars”，未在页面给出可核验仓库链接，且用户评价也是营销素材，不应作为效果证据。
- **来源**：
  - https://dexter-research.com/

### 2. OpenAlice — 活跃的开源全生命周期交易 Agent

- **类型**：研究助手 ✅｜信号生成 ✅｜模拟盘 ✅｜实盘执行 ✅（每笔交易默认要求用户明确批准）
- **Claude 角色**：Claude Agent SDK 是默认 AI Provider，可用 OAuth 或 API key；也能切换到 Vercel AI SDK 下的 Anthropic/OpenAI/Google，或者在 workspace 中运行 Claude/Codex/shell。因此它是“Claude 原生友好、但多模型”的交易框架。
- **能力**：跨股票、加密、商品、外汇和宏观的研究、仓位规模、持续监控、风控和退出；用“Trading-as-Git”把订单分成 stage/commit/push，并在 push 前跑仓位上限、冷却期、白名单等 Guard。订单执行层 UTA 与 Agent 分离，券商密钥不暴露给推理进程。
- **数据/券商依赖**：OpenBB/TypeBB 市场数据层；券商/交易所适配包含 Alpaca、Interactive Brokers、CCXT；RSS 新闻源。具体可交易范围取决于接入券商与数据订阅。
- **当前状态**：GitHub 未归档，README 自称“experimental software in active development”；GitHub API 显示最近 push 为 **2026-08-01**，核查时约 6.3k stars。项目明确警告接口不完整、可能破坏性变更，不建议在不理解风险时用真钱。
- **证据质量**：**高（功能存在）/低（盈利能力）**。仓库、架构、工具路径和订单文档公开且持续更新；没有可验证的长期实盘收益记录。
- **来源**：
  - https://github.com/TraderAlice/OpenAlice
  - https://api.github.com/repos/TraderAlice/OpenAlice
  - https://www.openalice.ai/docs/trading/orders-and-execution
  - https://www.openalice.ai/blog/openalice-we-open-source-traderalice

### 3. SkopaqTrader — 印度股票的多 Agent 研究到实盘框架

- **类型**：研究助手 ✅｜信号生成 ✅｜模拟盘 ✅｜实盘执行 ✅（交互模式有人类确认；另有可无人值守 daemon）
- **Claude 角色**：两条路径。Claude Code 模式通过 MCP 让 Claude 完成四类分析、牛熊辩论、研究经理和风险经理推理；API 模式则混用 Gemini、Claude Opus、Grok、Perplexity，Claude 主要承担研究/风险“裁判”角色。
- **能力**：面向 NSE/BSE 的 15-Agent 分析、NIFTY 50 扫描、BUY/SELL/HOLD、ATR 仓位、India VIX/指数趋势风控、持仓监控、盘后反思和长期记忆。README 声称有 PRE_OPEN→SCANNING→ANALYZING→TRADING→MONITORING→CLOSING→REPORTING 的自主交易 daemon。
- **数据/券商依赖**：INDstocks 负责印度股票实时行情和 paper/live 执行；Supabase 记忆、Redis LangCache；新闻、基本面、社交数据还依赖项目配置的各类 API。加密扩展依赖 Binance、CoinGecko、DeFiLlama、Blockchair。
- **当前状态**：GitHub 未归档，最近 push **2026-04-08**，核查时 10 stars、4 forks；README 内容很新但社区规模很小，应按早期研究项目对待。作者明确写明仅供教育/研究。
- **证据质量**：**中**。原仓库对工具、架构和 live 路径说明很具体，但缺少第三方复现、自动化测试结果或经验证的实盘记录。
- **来源**：
  - https://github.com/samuelvinay91/skopaqtrader
  - https://api.github.com/repos/samuelvinay91/skopaqtrader

### 4. Alpaca MCP Server — Claude 可调用的官方券商执行桥（不是独立策略 Agent）

- **类型**：研究助手组件 ✅｜信号生成 ❌（不自带 alpha/策略）｜模拟盘 ✅｜实盘执行 ✅
- **Claude 角色**：Claude Desktop/Claude Code 等 MCP Client 可调用行情、组合与订单工具；任何兼容 MCP 的模型也可以使用。它给 Agent “手和眼睛”，不替 Agent 决定买什么。
- **能力**：历史/实时行情、新闻与账户查询；股票、ETF、加密、期权/多腿期权的下单、修改、撤单；可增加提醒或风险检查。默认配置中的 `ALPACA_PAPER_TRADE` 可在 paper 与 live 之间切换。
- **数据/券商依赖**：全部核心能力来自 Alpaca Market Data API 与 Trading API；paper 与 live 使用不同凭据/端点。
- **当前状态**：Alpaca 官方仓库未归档，最近 push **2026-07-31**；官方文档与 GitHub 均在线，核查时约 896 stars。Paper Trading 官方说明是实时模拟、订单不路由到交易所。
- **证据质量**：**高（接口与执行能力）**。券商官方文档和原仓库可以确认功能；但它本身没有可讨论的 Agent 收益表现。
- **来源**：
  - https://github.com/alpacahq/alpaca-mcp-server
  - https://api.github.com/repos/alpacahq/alpaca-mcp-server
  - https://docs.alpaca.markets/us/v1.4.2/docs/alpaca-mcp-server
  - https://docs.alpaca.markets/us/docs/paper-trading

### 5. OpenProphet（原 Claude_Prophet）— Claude 自主期权交易社区实验

- **类型**：研究助手 ✅｜信号生成 ✅｜模拟盘 ✅｜实盘执行 ✅（技术路径存在，但作者强烈要求仅 paper）
- **Claude 角色**：OpenCode 作为 Agent Harness，连接 Claude 模型并通过 MCP 调用 45+ 个交易工具；还使用 Gemini 清洗新闻。因此它是 Claude 主导决策、其他模型辅助数据清洗的混合系统。
- **能力**：heartbeat 定时唤醒，读取账户/新闻/技术指标，自主评估市场、管理仓位并下单；支持股票与期权、止损止盈、交易记忆、Web Dashboard、多账户，以及 `allowLiveTrading`、单笔金额、0DTE、日亏损熔断等权限/风险门。
- **数据/券商依赖**：Alpaca 行情与 paper/live 订单；Google News、MarketWatch；Gemini API 可选；本地 SQLite/sqlite-vec。
- **当前状态**：旧仓库 `Claude_Prophet` README 明确标记 **deprecated**，更新迁移到 `OpenProphet`。OpenProphet 未归档，2026-07-23 有“大改写”说明，GitHub API 最近 push **2026-07-24**；作者同时明确称这是优先级不高的 research project、不是成熟商业产品。
- **证据质量**：**高（代码路径和项目状态）/低（策略效果）**。原仓库完整公开执行链与安全开关，但没有经审计的收益。旧版 README 明确说 Alpaca API 支持 live/paper；新版警告只用 paper，故不应把“支持 live”包装为“已有安全实盘验证”。
- **来源**：
  - https://github.com/JakeNesler/OpenProphet
  - https://api.github.com/repos/JakeNesler/OpenProphet
  - https://github.com/JakeNesler/Claude_Prophet
  - https://api.github.com/repos/JakeNesler/Claude_Prophet

### 6. nightclaude — 有公开流水与基准的自治 S&P 500 交易实验

- **类型**：研究助手 ❌（不是给用户交互的研究工具）｜信号生成 ✅｜模拟盘/实盘性质 **未披露清楚**｜自动执行 ✅
- **Claude 角色**：网站称每晚由 Claude 运行自主研究循环，重新推导/选择波动率感知策略，形成下一交易日的 S&P 500 目标暴露；没有人工 discretionary override。
- **能力**：在 SGOV、SPY、SSO、UPRO 之间调整风险暴露；次日开盘后通过 Alpaca 下单。网站公开每日目标、fills、组合净值、与 SPY 的对比，并给出 walk-forward、Deflated Sharpe、Probability of Backtest Overfitting 及 Treynor-Mazuy/Henriksson-Merton 检验页面。
- **数据/券商依赖**：Alpaca 是持仓、净值、成交和 equity curve 的“source of truth”；策略读取趋势、市场宽度和波动等数据，但页面没有完整披露底层数据供应商和可运行源码仓库。
- **当前状态**：网站显示 **2026-05-26** 开始，核查日为 Day 67；页面当天仍展示 2026-07-31 成交，组合约 **$95,266，累计 -4.73%，落后 SPY 约 4.31 个百分点**。这是少数愿意展示实时负收益的项目，比只展示回测更可信。
- **关键限制**：网站多次写“live scorecard”“从 broker 实时读取”，但未明确账户是 Alpaca paper 还是真金账户；“filled”也可能来自 paper。故只能确认**在线前向运行和券商账户流水**，不能声称已证实是真金实盘。页面提到“nightclaude repository”但未给公开 GitHub 链接，策略不可完整复现。
- **证据质量**：**中**。实时公开流水、基准和方法页优于一般社区截图；但账户性质、源代码、第三方托管/审计均缺失。
- **来源**：
  - https://www.nightclaude.com/
  - https://www.nightclaude.com/methodology
  - https://www.nightclaude.com/timing-tests
  - https://www.nightclaude.com/about

## 能力分层对照

| 项目 | 研究 | 生成交易观点/信号 | 模拟盘 | 实盘订单 | 自主持续运行 | 是否 Claude-exclusive |
|---|---:|---:|---:|---:|---:|---|
| Dexter | 是 | 是 | 是 | 是，用户一键触发 | 未见无人值守策略循环 | 否，Claude 通过 MCP 可调用 |
| OpenAlice | 是 | 是 | 是 | 是，默认人工批准 | 有调度/heartbeat，但自治 workspace 仍在演进 | 否，多 Provider |
| SkopaqTrader | 是 | 是 | 是 | 是 | 是，daemon | 否，Claude/Gemini/Grok/Perplexity 混合 |
| Alpaca MCP | 提供数据工具 | 否 | 是 | 是 | 否，需外部 Agent/调度器 | 否，MCP 通用 |
| OpenProphet | 是 | 是 | 是（作者推荐） | 技术上是 | 是，heartbeat | 否，Claude 主导 + Gemini 辅助 |
| nightclaude | 非交互式 | 是 | 未披露 | 经 Alpaca 自动成交，但真钱未证实 | 是，每夜循环 | 按项目自述是 Claude |

## 状态与证据判读建议

1. **“能实盘”只说明 API 权限，不说明策略安全。** Alpaca MCP 和以上开源框架只要换 live key 就可能发真钱订单；这与经过滑点、限价、断线重试、订单幂等、盘前盘后规则和异常行情验证是两回事。
2. **优先相信前向流水，谨慎相信回测。** nightclaude 至少公开当前负收益和逐笔成交；但其方法页的大幅历史年化数字仍然属于策略作者自己的回测，而且作者承认在同一数据集迭代数百次，存在 multiple-testing 风险。
3. **“Claude-powered”常是营销缩写。** Dexter/Alpaca MCP 是 Claude 可调用；OpenAlice 是多模型；SkopaqTrader/OpenProphet 是混合模型。真正要复现时必须记录每个角色的模型、提示词、温度、数据时间戳和工具权限。
4. **当前最成熟的是连接与工作流，不是 alpha。** Alpaca 的执行连接、OpenAlice 的凭据隔离/Guard、OpenProphet 的权限门和 SkopaqTrader 的亏损熔断，证明工程拼图正在形成；没有一个项目提供足以支持“Claude 能稳定跑赢市场”的高质量证据。


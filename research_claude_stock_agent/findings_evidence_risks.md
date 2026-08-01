# Claude / LLM 交易 Agent 的实证与风险

调研日期：2026-08-01。

## 结论

目前没有高质量证据证明 Claude 能长期、稳定地跑赢股票市场。最强证据支持的是“Claude 擅长部分金融研究任务”；交易收益证据多来自短周期、小资金、单一市场实验，模型和提示对结果非常敏感，不能外推为可持续 alpha。

## 公开证据怎么读

### 1. Finance Agent benchmark 测的是研究准确率，不是投资收益

- Vals AI 的 Finance Agent v1.1 测试模型使用工具研究公司、财务报表和 SEC 文件并回答问题；Claude Opus 4.7 在 2026-04 榜单约为 64.4%。
- 这能说明 Claude 是强金融研究 Agent，但 64.4% 不是胜率或收益率，而且仍意味着相当比例任务未完全正确。
- 原始资料：
  - https://www.vals.ai/benchmarks
  - https://github.com/vals-ai/finance-agent
  - https://arxiv.org/abs/2508.00828

### 2. 数据工具往往比“换模型”更重要

- FinRetrieval 的公开摘要报告：Claude Opus 在结构化数据 API 下达到 90.8% 检索准确率，仅依靠网页搜索时为 19.8%，相差 71 个百分点。
- 这支持一个工程结论：实时、结构化、带时间戳的数据层通常比单纯升级模型更能改善可靠性。
- 原始资料：https://arxiv.org/abs/2603.04403

### 3. Alpha Arena 是短期加密永续合约实验，不是股票长期业绩

- Alpha Arena 给不同通用模型相同的 10,000 美元真实资金，在 Hyperliquid 加密永续合约市场自主择时、仓位与风控。
- 第一季到 2025-11-03 结束；公开总结显示 Claude Sonnet 4.5 约亏损 30.8%。平台后续 Season 1.5 页面又显示 Claude 4.5 为正 27.7%。
- 两个阶段符号相反，反而说明短窗口、市场状态、提示和风险偏好会主导结果。它不能证明 Claude 会炒股票，也不能证明存在稳定 alpha。
- 来源：
  - https://alpha-arena.io/models/claude-sonnet-4-5
  - https://www.nof1.info/
  - https://www.sandmark.com/news/top-news/alibabas-qwen3-max-wins-nof1-ai-crypto-trading-challenge-with-22-gain

### 4. 前向运行比回测更可信，但当前样本仍太短

- nightclaude 公开每日目标仓位、成交、组合净值和 SPY 对比。核查日显示自 2026-05-26 起约 67 天，组合约 -4.73%，落后 SPY 约 4.31 个百分点。
- 它愿意公开负收益是正面的证据习惯，但账户是真金还是 Alpaca paper 未清楚披露，且不足以证明长期能力。
- 来源：
  - https://www.nightclaude.com/
  - https://www.nightclaude.com/methodology

## 主要风险

1. **事实与时点错误**：模型可能引用旧财报、错配币种/单位、忽略公告时点；网页搜索不能替代交易级结构化数据。
2. **回测泄漏与过拟合**：同日价格信息、未来成分股、反复挑参数、忽略退市股和交易成本都可制造虚假 alpha。
3. **非平稳性**：市场状态变化后，历史有效的提示、规则和模型行为可能迅速失效。
4. **执行风险**：滑点、点差、流动性、部分成交、重复下单、断线和盘前盘后规则，会让真实 PnL 偏离 Agent 的预期。
5. **提示注入与数据投毒**：新闻、网页、研报或 MCP 返回值中可夹带恶意指令；一旦模型同时拥有交易工具，影响会从“答错”升级为“做错”。Anthropic 的 Computer Use 文档也要求对金融交易等高影响动作人工确认。
6. **权限与密钥风险**：券商 API key、远程 MCP、日志与云部署扩大攻击面。交易权限应与资金划转权限彻底分离。
7. **不可重复与模型漂移**：相同输入可能得到不同推理；模型版本、系统提示和工具 schema 更新会改变策略行为。
8. **合规责任**：Anthropic 将投资建议归为高风险金融用例；面向个人给建议需合格专业人士复核并披露 AI 使用。FINRA 也警告投资者警惕未注册自动交易服务和“无风险高收益”宣传。

来源：

- Anthropic Usage Policy: https://www.anthropic.com/legal/aup
- Anthropic Computer Use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- FINRA auto-trading warning: https://www.finra.org/investors/insights/auto-trading-unregistered-entities
- FINRA AI investment fraud warning: https://www.finra.org/investors/insights/artificial-intelligence-and-investment-fraud
- Alpaca MCP security/disclosures: https://github.com/alpacahq/alpaca-mcp-server

## 证据分级

- **强**：官方能力边界、接口文档、真实工具调用与订单功能。
- **中**：公开、逐笔、前向 paper/live 流水，但周期短或账户性质不明。
- **弱**：作者自报回测、收益截图、单次比赛、营销页和没有对照组的收益宣称。

因此，合理的默认方案是“Claude 做研究与候选生成 → 硬编码风控 → 人工审批 → 券商执行”，先用 paper 盘完成跨市场状态的前向验证，再考虑极小资金受控实盘。

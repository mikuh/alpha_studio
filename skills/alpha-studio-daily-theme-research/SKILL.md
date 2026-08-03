---
name: alpha-studio-daily-theme-research
description: Generate Alpha Studio Research-style daily A-share theme attack-probability reports, 9:25 auction-confirmation briefs, delayed pre-market briefs, intraday updates, and post-market recap + next-day strategy reports with business-style printable layout and logic-first concise prose. Use when GPT needs to predict or validate the most likely same-day or next-1-3-day capital attack sectors/themes, integrate overnight US/global data and market news, analyze 9:25集合竞价 confirmation, market sentiment, theme lifecycle stages, institutional vs hot-money leadership, leader/central-capacity/laggard stock roles, research probabilities, observation weights, trigger plans, or printable HTML/PDF reports for short-term A-share trading research.
---

# Alpha Studio Daily Theme Research

## Purpose

Produce a professional "Alpha Studio Research" daily A-share theme tracking and capital-attack prediction system. The core objective is to maximize the research probability of identifying which sectors/themes funds are most likely to attack today or over the next 1-3 trading days, then translate that forecast into leader/central-capacity/trend-core execution gates and invalidation rules. Support true pre-market reports before 9:00 China time, 9:25集合竞价确认版 after the opening auction, delayed pre-market reports after the open, intraday updates during trading, and post-market recap + next-day strategy reports after the close. The default formal report is a standard 8-10 page A4 report when continuity, authenticity, overnight-global, and attack-path modules are needed; produce a shorter 1-2 page brief only when the user explicitly asks for a quick brief or the mode is 9:25 auction confirmation. Treat the output as research and decision support, never as guaranteed returns or personalized investment advice. Default presentation should feel like a business-facing institutional research note: restrained color, clear tables, dense but readable hierarchy, and logic-first writing.

## Mandatory Guardrails

- Browse or otherwise verify current market/news data for any daily report, early-morning brief, "latest", "today", or "this week" request.
- Cite sources for market statistics, policy catalysts, company announcements, and news claims.
- Separate facts, model scores, and judgment. Label probabilities as research probabilities for the next 1-3 trading days unless the user requests another horizon.
- Separate previous-close market timing from today's real-time checks. If the report is generated after the open, label it as a delayed pre-market or intraday report; do not mix live open data into the previous-close sentiment score.
- Explicitly document data-source口径 differences when numbers conflict, especially limit-up/limit-down counts from media, Wind/Choice-style all-market sources, and vendor concept-pool APIs.
- Refuse cross-cycle recommendations: do not recommend startup tactics for a climax/retreat theme or retreat tactics for a startup theme.
- Every daily report must start with a visible `今日执行闸门` before broad theme detail. Choose exactly one global state: `完全不做`, `只观察`, `触发后轻仓试错`, `只做主线核心`, or `持有/减仓优先`. Then spell out `今日只做`, `今日不做`, `触发再做`, and `失效动作`. If evidence is incomplete, conflicting, or not timely enough, default to `只观察` or `完全不做`; do not fill the gap with neutral commentary.
- Every daily report must include a visible `今日资金进攻路径` before the broad theme list. State the top attack hypothesis, backup route, invalidation route, `今日进攻概率`, and why funds would choose this path now. A theme ranking without this path-level decision is incomplete.
- Every `9:25集合竞价确认版` must begin with `9:25确认结论` and choose one of: `主线确认`, `触发后轻仓试错`, `假强转观察`, `冲高兑现/不新开`, or `竞价证伪`. Then state `只做什么角色`, `不做什么角色`, `9:30-9:45二次确认`, and `失败动作`.
- Never write unconditional buy instructions. Convert all leader/central-capacity/trend-core ideas into `触发后做`, `只做主线核心`, `只持有不新开`, `减仓退出`, or `禁止`, with auction, breadth, leader feedback, central-capacity confirmation, and news-source validation.
- Every S/A/B theme must include a `题材持续时间与持有复核` view: elapsed trading days, estimated remaining trading-day window, default holding protocol, extension conditions, and shortening/exit conditions. Never imply that all themes should be bought at the open and sold at the next open; T+1 is only the default for unconfirmed stock-level, hot-money climax, or retreat-risk trades.
- Every daily report after the first must include a visible `上一期主题连续跟踪` table before today's new theme ranking. Any theme that was `可做`, `触发后做`, `只做主线核心`, `只持有不新开`, or explicitly tracked in the prior report must receive one of: `继续`, `降级观察`, `减仓退出`, `结束`, or `缺席复核`. A prior active theme must never disappear from the report just because it is no longer a top-ranked news theme.
- If a prior active theme is absent from today's theme list or news flow, treat that absence as a risk signal and mark it `缺席复核` until leader feedback, internal breadth, central-capacity trend, catalyst continuity, and broad sentiment are checked. For any hypothetical or previously triggered research position, state the carryover action: `继续持有`, `降级减仓`, `开盘/反抽退出`, or `无仓不新开`.
- Every stock in the role matrix must include a `产业链真实性` label before it can be treated as a core stock. Use: `产业链核心`, `产业链相关`, `概念映射`, `蹭概念/弱相关`, or `待验证`. A stock supported only by concept tags, market rumors, name association, or weak互动易-style answers must be marked `蹭概念/弱相关` or `待验证`; it cannot be called central-capacity stock or trend core without official business/revenue/order/product evidence.
- Industry-chain authenticity must be shown as rating-only parentheses after each stock name inside the original `龙头 / 中军 / 趋势核心 / 补涨矩阵`, e.g. `金海通（A）`, `多氟多（A-）`, `华亚智能（D）`. Do not add extra lines such as `产业链相关 / 证据等级A / 可作相关核心` inside the `标的` cell. Put a one-line rating note below the table instead. Keep the role matrix as a compact five-column table by default; do not add `持有复核`, `今日处理`, or other optional columns to the matrix. Put holding/review or role-limit notes in the callout or execution section below the table. Add continuation pages only when the five-column compact matrix would otherwise be clipped after rows are merged.
- When historical theme-duration samples or a local tracking dataset are available, use them to calibrate the remaining-window estimate. When they are unavailable, label duration as `模型估计` rather than `历史回测结论`, and update the estimate from daily observed leader/breadth/central-capacity feedback.
- Include risk language in final reports: public information, model framework, not securities investment advice.
- For formal printable HTML/PDF reports, default to the standard daily report depth: 8-10 A4 pages when continuity, authenticity, overnight-global, and attack-path content is present. Do not deliver a 3-5 page abbreviated report unless the user asks for a quick brief.
- For formal printable HTML/PDF reports, use the skill's business report template and avoid decorative, marketing-style, or overly warm palettes. Keep the layout structured, sober, and print-friendly.
- If the user asks to run this every day before 9:00, create or propose an automation with the available automation tool rather than writing raw scheduling instructions.
- Every report generated by this skill must silently produce a complete `alpha.premarket_theme.v2` tracking payload, even when the user only asks for HTML or PDF. Save it as the hidden sidecar `.alpha-studio-tracking.json` beside the HTML/PDF. This file is an internal machine-data channel for Alpha Studio: do not display, attach, link, or explain it in the final reply. It is still a completion requirement—do not claim completion before it exists and validates. Include explicit `tradeDate`, `generatedAt`, `dataCutoff`, report mode/title, global `executionGate` and `capitalAttackPath`, market sentiment, previous continuity, risks, source notes, theme `rank`, conclusion, lifecycle, capital type, probabilities, observation weight, holding window, only-do/do-not-do, invalidation/risk, and every stock's normalized exchange-qualified `code`, `role`, `roleRank`, and authenticity. Each condition must have a stable `triggerSpecs[].id`, evaluator (`quote|breadth|time|ai|manual`), `subjectCode`/field/operator/threshold when numeric, observation window where applicable, confirmation duration, required data source, trigger action, and failure action. Use only canonical operators `gt|gte|lt|lte|eq|contains`, never symbols such as `>=`. Keep `marketSentiment` as a concise string, `previousContinuity` rows as `name/status/action/evidence`, and `sourceNotes` as strings; richer objects may be stored under separate optional detail fields. Never use `未给出`, `待确认`, or `待验证` placeholders and never force semantic conditions into numeric rules; label them `ai` or `manual`.
- Every stock in the `龙头 / 中军 / 趋势核心 / 补涨矩阵` must be independently auditable in the decision panel. Add `triggerIds` pointing to existing `theme.triggerSpecs[].id`, plus non-empty `entryConditions` and `invalidationConditions`. Reuse theme-wide triggers when they genuinely apply to every stock; add stock-specific quote/manual triggers when the role has different confirmation or failure logic. Do not leave a recommended role stock dependent on unlinked prose.

## Workflow

1. **Resolve report mode, depth, and data windows**
   - Before 9:00 China time: create a pre-market report using the previous trading day's close and overnight/morning catalysts.
   - 9:25-9:30 or when the user asks for 9:25/集合竞价确认: create `9:25集合竞价确认版`. Use the prior pre-market attack hypothesis as baseline when available; use 9:25 auction data only as a trigger/deny layer, not as a replacement for previous-close market sentiment.
   - 9:00-15:00 outside the 9:25 confirmation window: create a delayed pre-market or intraday report. Keep previous-close sentiment scoring separate from auction/open/live checks.
   - After 15:00: create a post-market recap plus next-trading-day plan. Use same-day close data for market sentiment.
   - Choose depth: quick brief (1-2 pages, only if requested), 9:25 auction confirmation (1 page / compact table), standard daily report (default, 8-10 pages), or deep strategy report (10-14 pages when requested).
   - If the user says "today" but the time window is ambiguous, state the exact generation time and which data window is being used.

2. **Collect market and news inputs**
   - Previous trading day: limit-up count, limit-down count, consecutive-board count, max board height, seal rate, failed-board rate, yesterday limit-up premium, turnover, index moves, sector gainers/losers.
   - Overnight global and US inputs: Nasdaq/S&P/Russell style, SOX/AI/semiconductor/EV/biotech/crypto/energy leaders, US-listed China ADRs, A50/Hang Seng Tech, USD/CNH, Treasury yields, Fed expectations, VIX/risk appetite, commodities and sector-linked futures. Map each move to A-share theme beneficiaries and losers.
   - Macro calendar and liquidity: US CPI/PCE/NFP/ISM/FOMC/Fed speakers, China policy meetings/data releases, PBOC liquidity, exchange rule changes, major ETF/fund-flow events, and known industry conferences/product launches.
   - Overnight and morning news: national policy, ministry/commission notices, industry news, company announcements, commodity/supply-demand changes, overseas lead indicators, high-quality media alerts, and social/news heat only as secondary evidence.
   - 9:25 auction data when available: candidate theme leaders' auction premium, matched amount, matched volume vs yesterday, central-capacity stock expected open, group opening breadth, one-word limit count, weak/negative open count, whether the theme opens as a chain or isolated stock, and whether the result confirms the prior attack hypothesis.
   - Theme evidence: board constituents, capital inflow, leader behavior, central-capacity stock trend, internal breadth, news continuity, first-seen date.
   - Previous report continuity: load the previous daily report, previous `active_theme_ledger`, or user-provided tracked themes when available. Extract all themes that were actionable, held, or still under review; collect today's direct evidence for them even if they do not appear in the latest hot-theme list.
   - Prefer structured quote/vendor data for market statistics. When richer tools are unavailable, use available public quote/vendor pages or APIs carefully, cite the vendor, and preserve requested date vs response date fields.
   - If web search results are stale or sparse, do not infer that no news exists; use direct market snapshots first and then verify catalysts with official/media sources.
   - If no previous report/ledger is available, state `未获得上一期主题台账，本期从零建立连续跟踪` and create a new ledger from today's actionable and watch themes.

3. **Run market timing first**
   - Use `scripts/score_market_sentiment.py` when structured data is available.
   - Classify the market as `defensive`, `trial`, `active`, or `aggressive`.
   - Always produce a visible 情绪指标仪表盘 for daily/formal reports before theme ranking. Include market breadth, media/vendor涨停 counts, 跌停 pressure, consecutive-board count, max board height, seal rate, failed-board rate, leader/high-position feedback, theme concentration, turnover change, and fund-flow pressure when available.
   - If an emotion metric is unavailable or only estimated, label it as unavailable/estimated rather than silently omitting it.
   - If market sentiment is not rising, make capital preservation the headline strategy and only list observation candidates.

4. **Build the capital-attack hypothesis**
   - Read `references/attack-probability-framework.md` for the decision funnel when creating daily or formal reports.
   - Start from `隔夜全球线索 -> 国内催化层级 -> 昨日情绪/赚钱效应 -> 题材相对强度 -> 龙头/中军承接 -> 竞价验证 -> 盘中反馈`.
   - Produce exactly one primary attack route and one backup route. Examples: `AI硬件中军先行`, `机器人情绪龙头先行`, `资源品趋势中军防守进攻`, `无主线只观察`.
   - Separate `为什么资金会进攻` from `什么条件下才能做`. A strong narrative without price/auction confirmation is only a hypothesis.
   - Penalize obvious crowding, climax back-row diffusion, weak central-capacity confirmation, rumor-only catalysts, and a stronger competing theme absorbing liquidity.

5. **Run 9:25 auction confirmation when in auction mode**
   - Use `scripts/score_auction_confirmation.py` when structured auction data is available.
   - Start from the pre-market primary and backup routes; do not invent a new主线 from one isolated high-open stock unless group breadth and central-capacity also confirm.
   - Upgrade only when leader premium/matched amount, theme group breadth, and central-capacity/trend core confirm together.
   - Downgrade when the leader is strong but the chain is weak, central-capacity opens flat/negative, high-open stocks are too crowded, or the theme is only rumor/concept mapping.
   - Output `9:25确认结论`, `确认分`, `主线/备选/证伪`, `只做角色`, `不做角色`, `9:30-9:45二次确认`, and `失败动作`.

6. **Classify each theme**
   - Use the theme size taxonomy in `references/lifecycle.md`: national-level, industry-level, stock-level.
   - Use `scripts/classify_lifecycle.py` for structured lifecycle hints.
   - Assign one stage only: startup, fermentation, climax, retreat.
   - Estimate remaining theme duration from theme size, lifecycle stage, capital type, current market timing, elapsed days since first evidence, leader feedback, central-capacity confirmation, and catalyst continuity. Express it as a range plus review/exit conditions, not as a guaranteed holding period.
   - Reject low-quality small rumors unless they are explicitly labeled as stock-level speculation.

7. **Identify capital type**
   - Institutional-led themes usually have industry/earnings/supply-demand logic, central-capacity stocks, trend structures, and sustained liquidity.
   - Hot-money-led themes usually have event catalysts, consecutive-board leaders, emotional premium, fast diffusion, and sharp stage transitions.
   - Mixed themes require both a trend core and an emotion core; explain which one dominates today's strategy.

8. **Select core stocks by role**
   - Use `references/stock-role-framework.md`.
   - For each important theme, map leader, central-capacity stock, trend core, emotion core, laggard/compensation stock, and arbitrage stock when available.
   - Explain why each stock has that role. Do not merely list names.
   - Verify each named stock's industry-chain relevance before assigning a durable role. Prefer annual reports, prospectuses, official product/customer/order disclosures, exchange filings, and company announcements. Use concept-board tags or market涨停 behavior only as price evidence, not as business evidence.
   - If a stock is only a concept mapper, mark it clearly with a rating-only suffix such as `（C）` or `（D）`, downgrade role safety, and forbid treating it as `中军/趋势核心`. Explain the C/D meaning in the table note, not inside the stock-name cell.
   - Preserve the original compact matrix rhythm: one row per theme-role combination, with multiple stocks in the same `标的` cell separated by `、` when they share role logic and invalidation conditions. Do not expand every stock into a separate row just to show authenticity.

9. **Score and rank**
   - Use `scripts/score_themes.py` when structured theme data is available.
   - Output S/A/B/C grades, `今日进攻概率`, 1-3 day research probability, observation weight, lifecycle stage, capital type, execution gate, holding window, capital-attack path, and key risk triggers.
   - Let market timing cap position advice: weak markets reduce all theme weights even if theme scores are high. In a `trial` market, manually sanity-check model probabilities so a single broad涨停 day does not overstate the next 1-3 day edge.
   - Translate rankings into a hard action map. Each theme should be one of: `可做`, `触发后做`, `只看不做`, `只持有不新开`, `减仓/退出`, or `禁止`. A ranked list without this action map is incomplete.
   - Run a continuity review after scoring. Use `scripts/track_theme_continuity.py` when prior ledger/current theme scores are structured. Output carryover status, carryover action, exit reason, next review time, and updated ledger. If a theme such as yesterday's `创新药` is no longer a top theme, still write whether it is continued, downgraded, or ended.
   - Run a stock authenticity review when structured stock evidence exists. Use `scripts/score_stock_relevance.py` to label `产业链核心/产业链相关/概念映射/蹭概念/待验证`, assign evidence level, surface role permission, and render the report-facing `display_name` short form such as `金海通（A）`.

10. **Generate report**
   - Before rendering the human-readable report, serialize the final structured decision state to the hidden sidecar `.alpha-studio-tracking.json` with schema `alpha.premarket_theme.v2`. Treat this file as the source of truth for the workbench; HTML/PDF must reflect the same probabilities, gates, roles, holding windows, and trigger conditions, but their layout is never parsed for automatic tracking.
   - Use `references/report-structure.md` for the report modules.
   - For printable HTML/PDF, copy or adapt `assets/alpha-studio-report-template.html`, `assets/report-style.css`, and `assets/alpha-studio-logo.png` (the company logo shown on the cover). Keep all three together so the relative `./alpha-studio-logo.png` reference resolves.
   - Include a data-quality / 口径说明 section whenever generation is after the open, source counts conflict, or API snapshots are used.
   - Keep 情绪指标 separate from catalyst narrative: the sentiment dashboard is price/market behavior, while the catalyst map is news/policy/company evidence.
   - For standard daily reports, include enough substance to cover market timing, execution gate, overnight/global lead map, capital-attack hypothesis, previous theme continuity, previous feedback, catalyst map, theme lifecycle, theme duration/holding window, capital type, stock roles, compact industry-chain authenticity suffixes, triggers, forbidden trades, sources, and disclaimer. If space is tight, add pages rather than deleting core analysis.
   - Use a business layout hierarchy: conclusion headline, metric dashboard, source-aware tables, compact callouts, then action/risk tables. Do not replace analysis with decorative blocks.
   - Validate the finished HTML with `scripts/validate_report.py` when possible. If Markdown and structured inputs are available, pass them to the validator for cross-checks.
   - Always run `python3 scripts/validate_tracking_sidecar.py <report-dir>/.alpha-studio-tracking.json` before finishing. If it fails, repair the sidecar and rerun it; do not work around the failure with ad-hoc `jq` checks or by weakening the contract. This validator protects automatic import, per-stock condition display, daily SQLite archiving, and later conversational backtests.
   - Before finishing, re-read `.alpha-studio-tracking.json`, confirm it is valid JSON with the required schema and no missing/placeholder values, but do not mention or link this internal file in the final reply.

## Report Voice

Write like a professional institutional research desk: concise, evidence-led, decisive, and explicit about uncertainty. Prefer "today's operating plan" over vague market commentary. Use Chinese unless the user requests another language.

Default prose style:
- Use a `结论 -> 证据 -> 触发/失效 -> 风险` order in each major module.
- Write the first operating sentence as a command-level decision, e.g. `今日只做AI硬件发酵主线的中军/趋势核心；不做高潮后排和消息未验证分支。` Avoid vague summaries such as `关注多个方向`.
- When a prior theme changes state, write the transition explicitly: `创新药：昨日触发后做 -> 今日缺席复核/减仓退出，原因是...`. Do not simply omit it from the ranking.
- When listing stocks in the role matrix, distinguish market role from business reality with rating-only suffixes: `金海通（A）`、`华亚智能（D）`. Put meaning and restrictions in a short note below the table, not in the `标的` cell.
- Keep paragraphs short: 1-3 sentences, one judgment per paragraph, no long narrative buildup.
- Prefer concrete market signals, source口径, lifecycle labels, and trigger conditions over adjectives.
- Avoid slogan-like language, poetic metaphors, redundant background explanation, and repeated "可能/或将" hedging. State the uncertainty once, then give the operating implication.
- In tables, use compact phrases rather than full paragraphs; put longer reasoning in one focused note below the table.

## Resource Map

- `references/lifecycle.md`: theme size, lifecycle stages, stage-specific tactics.
- `references/attack-probability-framework.md`: overnight/global-to-A-share attack-path funnel, probability factors, and intraday validation logic.
- `references/scoring-model.md`: scoring factors, thresholds, probability mapping, weight rules.
- `references/stock-role-framework.md`: leader/central-capacity/laggard definitions and logic.
- `references/data-sources.md`: source hierarchy, daily data schema, collection checklist.
- `references/report-structure.md`: pre-market report, intraday update, and printable HTML layout.
- `scripts/score_market_sentiment.py`: deterministic market timing score.
- `scripts/score_auction_confirmation.py`: deterministic 9:25 auction confirmation and upgrade/downgrade helper.
- `scripts/classify_lifecycle.py`: deterministic lifecycle classifier.
- `scripts/score_themes.py`: deterministic theme grade, attack-probability, path, and weight helper.
- `scripts/score_stock_relevance.py`: deterministic stock industry-chain authenticity/relevance helper.
- `scripts/track_theme_continuity.py`: merge previous active theme ledger with current theme scores and produce continue/downgrade/exit/missing-review actions.
- `scripts/validate_report.py`: lightweight HTML/page-count validator.
- `scripts/validate_tracking_sidecar.py`: mandatory machine-data validator for automatic workbench import and per-stock condition binding.

# Report Structure

## Output Depths

Pick one depth before writing:

| Depth | Pages | When to Use | Content Rule |
|---|---:|---|---|
| Morning brief | 1-2 A4 pages | Only when the user asks for 快报/简版/只要结论 | Keep only strategy, sentiment, top themes, triggers, risks |
| 9:25 auction confirmation | 1 A4 page or compact chat brief | User asks for 9:25/集合竞价确认, or report is generated at 09:25-09:30 | Validate or deny the pre-market attack hypothesis; do not rewrite the full report |
| Standard daily report | 8-10 A4 pages | Default for formal daily theme tracking when continuity/authenticity/overnight-global/attack-path modules are present | Include all modules below; do not compress into a short skeleton |
| Deep strategy report | 10-14 A4 pages | User asks for deep research, client deck, or investment committee material | Add sector fundamentals, industry chain, valuation/earnings sensitivity, detailed stock narratives |

Unless the user explicitly asks for a quick brief, generate the standard daily report. If new required modules make a page dense, add pages or split tables; do not delete previously required modules.

## Pre-Market Report Before 9:00

Use this default order for the standard daily report:

1. Cover / header (page 1)
   - Alpha Studio Research team, report date, coverage period, risk label.
2. One-line strategy and market dashboard (page 2)
   - Example: "Market sentiment is active; focus on confirmed fermentation themes, avoid climax back-row."
   - Required 今日执行闸门 before the dashboard: one global state (`完全不做` / `只观察` / `触发后轻仓试错` / `只做主线核心` / `持有/减仓优先`), plus `今日只做`, `今日不做`, `触发再做`, and `失效动作`.
   - Required 今日资金进攻路径 immediately after the execution gate: primary route, backup route, invalidation route, `今日进攻概率`, and the one-sentence reason funds would attack this path now.
   - The first operating sentence must be unambiguous. Use command-level language such as `今日只做...` or `今日完全不做...`; do not open with a neutral theme inventory.
   - Score, regime, key evidence, main risk.
   - Required 情绪指标仪表盘: market breadth/up-down ratio, media vs vendor涨停 counts, 跌停 pressure, consecutive-board count, max board height, seal rate, failed-board rate, leader/high-position feedback, theme concentration, turnover change, and fund-flow pressure when available.
   - Keep this dashboard as a distinct table or metric grid. Do not bury emotion metrics inside prose or only mention a single sentiment score.
   - If source口径 conflicts, show both counts with labels and explain which one drives broad sentiment vs board-quality analysis.
   - Do not place a full 情绪指标仪表盘 and a full previous-day feedback table on the same A4 page if the dashboard exceeds 6 rows. Split the feedback into a separate page and make the report 8 pages rather than letting the browser clip the lower table.
3. Overnight/global lead and domestic catalyst translation (page 3)
   - Required `隔夜全球线索`: US risk appetite, US sector leads, China ADR/HK/A50 read-through, FX/rates, commodities, and macro/event calendar.
   - Map each important overnight move to A-share candidate themes and required domestic confirmation. Include negative read-throughs.
   - Separate source-verified facts from model translation. Do not write that a US sector move "will drive" A-shares unless A-share evidence also confirms.
4. Data quality / 口径说明 and yesterday feedback (page 4)
   - Required when generated after the open, when market counts conflict, or when quote-vendor API snapshots are used.
   - State which numbers use media/all-market口径, which use vendor pool口径, and whether current-day data is only an open/intraday check.
   - Required 上一期主题连续跟踪 before today's new catalyst map when a prior report/ledger exists. Include every prior actionable/tracked theme and label `继续`, `降级观察`, `减仓退出`, `结束`, or `缺席复核`.
   - If no previous ledger exists, state `未获得上一期主题台账，本期从零建立连续跟踪`; do not pretend continuity was checked.
   - Profit effect, loss effect, high-position feedback, leader behavior.
5. News/theme panorama and catalyst hierarchy (page 5)
   - National-level, industry-level, stock-level catalysts.
   - Include news freshness and source authority. High social heat without official/media confirmation must remain secondary evidence.
6. Theme ranking and lifecycle map (page 6)
   - S/A/B/C grade, lifecycle, capital type, `今日进攻概率`, 1-3 day `研究概率`, `资金进攻路径`, observation weight, risk flags.
   - Required execution columns: `今日结论`, `今日只做`, `今日不做`.
   - Required duration columns for S/A/B themes: `已运行`, `预计剩余窗口`, `默认持有协议`, `延长条件`, `缩短/退出条件`.
   - State duration basis as `历史样本校准`, `模型估计`, or `混合估计`. Do not imply historical backtest support unless a sample/source is cited.
   - Do not let all themes look equally actionable. If the top theme is only observation-grade, say so clearly and mark lower themes as `只看不做` or `禁止`.
   - Mark whether each theme is `新进`, `延续`, `降级`, or `结束复核` in relation to the previous ledger when applicable.
7. Stock role matrix (page 7)
   - Leader, central-capacity, trend core, emotion core, laggard, arbitrage.
   - Explain why each stock has that role.
   - Include role-level holding distinction when relevant: central-capacity/trend core may hold longer than emotion leader; laggard/arbitrage usually requires T+1 or intraday review.
   - Preserve the original `龙头 / 中军 / 趋势核心 / 补涨矩阵` table. Required columns remain: `题材`, `角色`, `标的`, `角色逻辑`, `确认/失效`, and holding/review notes when available.
   - Keep the `标的` cell compact and allow multiple stocks in one cell as before, separated by `、` or `；`. Merge stocks with the same theme-role, role logic, confirmation/failure condition, and holding review into one row. Do not split every stock into one row unless each stock has materially different role logic or invalidation conditions.
   - Show 产业链真实性 as a rating-only parenthetical suffix after each stock name, e.g. `金海通（A）`、`多氟多（A-）`、`海南海药（C+）`、`华亚智能（D）`. Do not use large pill badges, big colored blocks, a separate authenticity table, or extra lines in the `标的` cell.
   - Required inline authenticity details are limited to the rating in parentheses. Put a short `评级说明` note below the table, e.g. `A/A-为官方证据强且链条清晰；B为产业链相关但收入/订单仍需确认；C为概念映射；D为弱相关或待验证，不能作为中军/趋势核心依据。`
   - Do not label a stock as 中军/趋势核心 unless it is `产业链核心` or strong `产业链相关`. If it is `概念映射`, `蹭概念/弱相关`, or `待验证`, mark it as emotion/arbitrage/observation and state the risk.
8. Today's intraday trigger plan and forbidden trades (page 8)
   - 9:15-9:25 auction, 9:30-9:45 confirmation, 10:00 breadth check, afternoon rotation check.
   - Climax back-row, retreat-stage averaging, rumor-only stock-level themes, weak central-capacity divergence.
   - Include a holding/review plan: what can be carried overnight, what must be reviewed at next open, and what must be exited if triggers fail.
9. Sources, disclaimer, and appendix (page 9, optional if page 8 has room)

The report may be 8 pages only if all required modules fit cleanly. Use 9-10 pages when overnight/global maps, continuity tables, role matrices, or source notes would otherwise crowd the page. It should never feel thinner than the previous detailed daily tracking report.

## 9:25 Auction Confirmation Brief

Use this mode at 09:25-09:30 or when the user explicitly asks for 集合竞价确认. Keep it compact and decisive. It is a trigger/deny report, not a full replacement for the pre-market report.

Required order:

1. `9:25确认结论`
   - Choose exactly one: `主线确认`, `触发后轻仓试错`, `假强转观察`, `冲高兑现/不新开`, or `竞价证伪`.
   - State the primary theme, backup theme, and denied theme if any.
   - State whether the pre-market attack path was confirmed, partially confirmed, or denied.
2. `竞价证据表`
   - Columns: theme, baseline role, leader premium/matched amount, central-capacity premium/matched amount, group breadth, chain pattern, confirmation score, conclusion.
   - Chain pattern values: `leader_plus_central_plus_breadth`, `leader_only`, `central_only`, `backrow_only`, `no_chain`.
3. `只做 / 不做`
   - `只做什么角色`: leader, central-capacity, trend core, first credible laggard, or none.
   - `不做什么角色`: weak back-row, pure concept mapper, high-open crowded laggard, retreat rebound, or all new trades.
4. `9:30-9:45二次确认`
   - Require first 5-15 minute breadth, leader feedback, central-capacity trend, turnover support, and failed-board pressure.
   - Borderline themes stay `触发后轻仓试错` until this confirms.
5. `失败动作`
   - Downgrade to observe, no new opening, reduce/exit existing research position, or close tracking.

Format:

```text
9:25集合竞价确认版
9:25确认结论：{主线确认/触发后轻仓试错/假强转观察/冲高兑现不新开/竞价证伪}
盘前路径复核：{primary confirmed/partial/denied}
主线：{theme + score + reason}
备选：{theme + trigger}
只做：{allowed roles}
不做：{forbidden roles}
9:30-9:45二次确认：{breadth + leader + central-capacity + turnover}
失败动作：{downgrade/reduce/exit/observe}
```

Do not use 9:25高开 alone as a buy signal. If leader is strong but central-capacity and breadth fail, write `假强转观察`. If back-row opens strongest while leader or central-capacity is weak, write `冲高兑现/不新开` or `竞价证伪`.

## Delayed / Intraday / Post-Market Variants

When the report is not generated before 9:00, keep the same institutional voice but change the title and data windows:

- `盘前延迟版`: generated after 9:00 but before or near the open. Use previous-close sentiment; add auction/open check.
- `盘中更新`: generated during trading. State what changed since the baseline report and give trigger-based actions only.
- `复盘 + 次日前瞻`: generated after 15:00. Use current-day close for sentiment and create tomorrow's trigger plan.

Never let current-day live data overwrite previous-close sentiment unless the report mode is explicitly post-market.

## Intraday Update

Use when the user asks for盘中提醒/加仓/建仓/更新:
- Keep it short.
- Re-score only changed fields.
- State what changed since pre-market.
- Give trigger-based action, not unconditional buy/sell.

Format:
```text
盘中更新 HH:MM
市场情绪：score/regime/change
主线确认：theme/stage/change
核心观察：leader, central-capacity, breadth
动作：increase / hold / reduce / observe
失效条件：...
```

## Printable HTML/PDF

Always build on `assets/alpha-studio-report-template.html` + `assets/report-style.css` + `assets/alpha-studio-logo.png`. The stylesheet defines a clean business research look: white/light-gray paper, charcoal text, restrained corporate-blue accents, neutral table structure, low-saturation tags, and A-share red/green price conventions. Do not hand-roll a new visual style or inline ad-hoc CSS; fill the template and reuse its classes. Export all three files to the same folder so the cover logo (`./alpha-studio-logo.png`) resolves.

Structure rules:
- Keep every `section.page` and its bottom `.footer` (page numbers) intact — the validator counts them. Standard daily report = 8 pages only when content fits cleanly; use 9-10 pages when market dashboard, overnight/global maps, continuity, sources, or role tables would otherwise overflow.
- Keep the per-page header (`.page-head` with `.eyebrow` + `.page-kicker`) and wrap page content in `.page-body`. Footer stays pinned at the bottom of each page.
- Every page footer must include the Alpha Studio Research text brand lock (`.footer-brand`) and a compact numeric page mark such as `1 / 8`. Do not put the logo image in the footer; keep the logo on the cover so footer alignment remains clean while copied pages remain visibly attributable.
- Separate cover page; one A4 page per `section.page`.
- Use compact print styles (`compact-page`) for the source/disclaimer page and for dense execution/risk tables that have been checked by the validator.
- Keep the report business-like: no decorative gradients, oversized empty hero areas, warm/gold-dominant color blocks, or marketing copy. Use tables, metric grids, and callouts to organize decisions and evidence.
- Never delete a required module to fit the page. If `龙头 / 中军 / 趋势核心 / 补涨矩阵` is long, split it into `角色矩阵（续）` pages and update footers/page counts.

Fill the page — avoid large empty bottoms:
- Each A4 page should be visually full. If a page (e.g. stock-role or sources) looks thin, add substantive analysis (extra rows, a short narrative paragraph, methodology/口径 notes, more sources) rather than leaving the lower half blank.
- Never compress real analysis just to shorten a page; add a page instead.

Reuse these classes when replacing placeholders:
- Theme grade pills: `<span class="tag grade-s|grade-a|grade-b|grade-c">S</span>`.
- Lifecycle stage badges: `<span class="tag stage stage-startup|stage-fermentation|stage-climax|stage-retreat">发酵</span>`.
- A-share price color convention (红涨绿跌): up/positive cells `class="positive"`, down/negative cells `class="negative"`.
- Highlight boxes: `<div class="callout teal|gold"><span class="callout-label">口径说明</span>…</div>` (default blue accent if no modifier).
- Metric tiles support `accent-rust` / `accent-gold` for the regime and main-theme cards. These class names are preserved for compatibility; the default palette remains restrained.
- Catalyst columns go in `.panel` blocks; start each with an `<h3>` title.

Content rules:
- Include the 今日执行闸门 near the top of the market timing page before the 情绪指标仪表盘. It must contain `今日只做` and `今日不做`.
- Include `今日资金进攻路径` near the top of the report before broad theme ranking. It must contain primary route, backup route, invalidation route, and `今日进攻概率`.
- Include `隔夜全球线索` before the theme ranking in pre-market and next-day strategy reports. For intraday reports, state what overnight/global thesis has been confirmed or invalidated.
- Include `上一期主题连续跟踪` when previous tracked themes exist. This section must appear before today's new theme ranking and must show carryover action for any prior active theme.
- Keep a data-quality note visible before the theme ranking when口径 differences matter (use a `.callout`).
- Include the 情绪指标仪表盘 on the market timing page before theme ranking, as a real table — show the raw emotion indicators, not only the final score/regime.
- Include a `题材持续时间与持有复核` table in the lifecycle or execution section. It must show estimated remaining trading-day windows and review/exit conditions. This is not the same as the 1-3 day research probability.
- Include 产业链真实性 as rating-only parenthetical suffixes inside the stock role matrix, not as badges or a replacement table. Use codes such as `A`, `A-`, `B+`, `B`, `C`, `D`; explain the rating scale once below the table and explain only material exceptions in `角色逻辑`.
- Write each major module in `结论 -> 证据 -> 触发/失效 -> 风险` order. Keep paragraphs to 1-3 sentences and tables to compact phrases.
- Avoid long background storytelling, stacked adjectives, slogan-like conclusions, and repeated hedging. State the research uncertainty once, then give the operational implication.
- Validate page count and content with `scripts/validate_report.py` before delivery.
- Treat validator density warnings as blockers for printable reports. The validator cannot fully replace render QA, but if it reports that a page may visually overflow, split the content, add another page, or use a verified compact layout before delivery.

## Required Language

Include these labels in formal reports:
- "研究概率" rather than "确定上涨".
- "今日进攻概率" rather than "必涨方向".
- "资金进攻路径" rather than vague "关注方向".
- "观察权重" rather than "建议仓位" unless the user explicitly asks for portfolio construction.
- "风险提示：本报告为公开信息整理和模型化研究，不构成证券投资咨询、个性化投资建议或收益承诺。"

## Morning Decision Template

```text
今日执行闸门：{完全不做/只观察/触发后轻仓试错/只做主线核心/持有减仓优先}
今日策略：{defensive/trial/active/aggressive}
主线优先级：S: {theme}; A: {theme}; B: {theme}
今日资金进攻路径：{primary route/theme/probability}; 备选：{backup}; 失效：{invalidation}
隔夜全球线索：{US/global lead -> A-share translation -> domestic confirmation}
最佳窗口：{startup/fermentation/climax/retreat}
资金类型：{institutional/hot_money/mixed}
今日只做：{leaders/trend core/central-capacity/confirmed laggards}
今日不做：{forbidden trades}
盘中确认：{auction + breadth + central-capacity conditions}
持有复核：{estimated remaining window + review point + extension/exit conditions}
上一期主题连续跟踪：{theme -> 继续/降级观察/减仓退出/结束/缺席复核 + 已有观察仓处理 + 下一次复核}
产业链真实性评级：{stock（A/A-/B+/B/C/D） inside 标的 cell；表后一句说明评级含义}
```

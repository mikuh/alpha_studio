# Alpha Studio Scoring Model

Use scores to make daily reports consistent. Scores guide judgment; they do not replace source verification.

## Market Sentiment Score

Use `scripts/score_market_sentiment.py` when data is structured.

Factor weights:
- Limit-up count: 15
- Consecutive-board count: 14
- Max board height: 12
- Seal rate / failed-board rate: 14
- Yesterday limit-up premium: 12
- Turnover and turnover change: 10
- Index stability: 10
- Theme concentration: 8
- Limit-down pressure: 5 negative

Regime:
- 0-44: defensive. Cash first; observe only.
- 45-59: trial. Small positions, first confirmations only.
- 60-74: active. Main-line participation allowed.
- 75-100: aggressive. Core theme attack allowed, but avoid climax back-row.

## Theme Strength / Attack Score

Suggested factors:
- Catalyst authority, freshness, and continuity: 18
- Overnight/global lead and A-share transmission: 10
- Limit-up breadth and internal diffusion: 13
- Leader height and feedback: 10
- Central-capacity stock trend: 12
- Relative strength and price confirmation: 10
- Liquidity/capital-flow/turnover quality: 8
- Fundamental / industry-chain validation: 8
- Positioning gap / consensus still not fully priced: 6
- Lifecycle stage adjustment: +8 to -20
- Risk penalty: -20 to 0

Grade:
- S: 85-100. Main line candidate.
- A: 75-84. Strong theme; participate if market timing permits.
- B: 60-74. Rotational or secondary theme.
- C: below 60. Observe or avoid.

## Lifecycle Score Adjustment

Apply after base theme score:
- Startup: +0 for stock-level, +5 for industry/national themes with credible catalyst.
- Fermentation: +8, best risk-reward.
- Climax: -8 unless already positioned in core.
- Retreat: -20 and cap grade at B-.

## Capital Attack Probability

`今日进攻概率` means the research probability that a theme becomes or remains the primary same-day/next-session capital attack direction, not the probability that every stock in the theme rises.

Core adjustments:
- Add when overnight/global lead, domestic catalyst, prior relative strength, leader feedback, and central-capacity trend point to the same theme.
- Add when the theme has a clear route: `中军先行`, `龙头先行`, or `双核共振`.
- Add when the catalyst is fresh and authoritative while the theme is still startup/fermentation rather than climax.
- Subtract when the theme is crowded, media consensus is already extreme, back-row diffusion is weak, or a stronger theme is siphoning liquidity.
- Subtract sharply when market sentiment is defensive, failed-board pressure rises, or the theme enters retreat.

Attack probability bands:
- 68-78%: Top attack route, but still requires listed confirmation triggers.
- 58-67%: Strong candidate; trade only the allowed core role after confirmation.
- 48-57%: Watchlist/rotation candidate; no open-at-open action.
- Below 48%: Observation or forbidden unless a new catalyst/auction reversal changes the evidence.

Always print both:
- `今日进攻概率`: same-day/next-session capital attack probability.
- `研究概率`: 1-3 trading day probability of rising or outperforming the broad market.

Do not convert either number into a guarantee or a personalized position size.

## Probability Mapping

Default probability means chance of rising or outperforming broad market over the next 1-3 trading days.

Base mapping:
- S: 62-68%
- A: 55-61%
- B: 47-54%
- C: below 47%

Adjustments:
- Market defensive: cap all probabilities at 52%.
- Market aggressive: add 2-4 points to confirmed fermentation themes only.
- Climax back-row: subtract 8-15 points.
- Retreat: cap at 45% unless explicitly marked oversold rebound.

## Execution Gate Mapping

Scores are incomplete unless translated into a daily action gate. Use this gate before writing theme narratives.

| Market Regime | Theme Grade / Stage | Default Gate |
|---|---|---|
| Defensive | Any grade | `完全不做` or `只观察`; no new theme trade |
| Trial | S/A startup or fermentation | `触发后轻仓试错`; wait for auction + breadth + leader confirmation |
| Trial | B/C, climax, retreat | `只观察`, `只持有不新开`, or `禁止` |
| Active | S/A fermentation | `只做主线核心`; leader/central-capacity/trend core only |
| Active | Startup | `触发后做`; no open-at-open trade without confirmation |
| Active | Climax | `只持有不新开`; reduce when diffusion quality worsens |
| Aggressive | S/A confirmed fermentation | `只做主线核心`; do not chase climax back-row |
| Aggressive | Retreat | `禁止` unless explicitly framed as high-risk rebound |

Required gate fields:
- `今日结论`: one of 可做 / 触发后做 / 只看不做 / 只持有不新开 / 减仓退出 / 禁止.
- `今日只做`: specific allowed roles and setups.
- `今日不做`: forbidden roles and setups.
- `触发再做`: auction, breadth, leader, central-capacity, and catalyst checks.
- `失效动作`: downgrade/exit instruction.

If a gate cannot be assigned from available data, assign `只看不做` and state the missing confirmation. Do not present an ambiguous S/A/B/C table as if it were an action plan.

## Attack Route Mapping

Every S/A/B theme should receive one route label:

| Evidence Stack | Route | Default Gate |
|---|---|---|
| Institutional catalyst + liquid central-capacity stock turns first + market regime active/trial | `中军先行` | `只做主线核心` or `触发后做` |
| Hot-money catalyst + leader height/auction/breadth drive the theme | `龙头先行` | `触发后做`; leader/emotion core only |
| Leader and central-capacity confirm together, with fresh catalyst and active/aggressive market | `双核共振` | `只做主线核心` |
| Weak broad risk but defensive/resource/dividend trend has relative strength | `轮动防守` | `只观察` or core trend only |
| Data conflicts, no confirmation, or retreat/climax risk dominates | `无主线观察` | `只观察`, `持有/减仓优先`, or `禁止` |

Route-level invalidation outranks theme grade. If a supposed `双核共振` loses either leader or central-capacity confirmation, downgrade it to `触发后做` or `只观察`.

## 9:25 Auction Confirmation Score

Use `scripts/score_auction_confirmation.py` when structured auction data is available. This score is a trigger/deny score for the pre-market attack hypothesis, not a standalone theme score.

Suggested factors:
- Leader auction premium and matched amount: 25
- Central-capacity/trend-core confirmation: 25
- Theme group opening breadth: 20
- Chain pattern quality: 15
- Crowding / high-open risk penalty: -15 to 0
- Baseline priority bonus: primary +8, backup +4, watch +0
- Catalyst still valid: 7

Confirmation labels:
- 75-100: `主线确认`. The pre-market route is confirmed; only allowed core roles can be considered after 9:30-9:45 secondary confirmation.
- 62-74: `触发后轻仓试错`. Strong but incomplete; wait for first 5-15 minute breadth and central-capacity confirmation.
- 48-61: `假强转观察`. Some auction strength exists, but the chain is incomplete or crowding risk is high.
- 35-47: `冲高兑现/不新开`. Opening strength is late/crowded or not supported by the role structure.
- 0-34: `竞价证伪`. The auction denies the pre-market route; no new trade and review backup/defense.

Hard downgrade rules:
- Leader strong but central-capacity and breadth fail: cap at `假强转观察`.
- Back-row opens strongest while leader/central-capacity is weak: cap at `冲高兑现/不新开`.
- Negative group breadth with weak central-capacity: `竞价证伪`.
- Climax/retreat theme with high crowding: cap at `冲高兑现/不新开`.

## Stock Industry-Chain Authenticity Score

Score each named stock separately from price behavior. The goal is to distinguish real supply-chain participants from pure concept mappers.

Suggested factors:
- Official business evidence: 30. Annual report, prospectus, exchange filing, company announcement, disclosed product/customer/order/capacity.
- Theme product/service match: 20. Direct product/service in the theme chain scores higher than adjacent tooling or generic exposure.
- Revenue/order/customer materiality: 20. Segment revenue, order size, named customer, capacity, or production link.
- Source quality and recency: 15. Official/current sources > broker/media > old or vague concept tags.
- Role consistency: 10. Business evidence supports the proposed role (e.g. equipment chain stock as equipment supplier, not just broad concept).
- Risk penalty: -25 to 0. Denial/clarification, tiny exposure, only互动易 vague answers, only concept-board tags, or pure name association.

Label mapping:
- 80-100: `产业链核心`.
- 60-79: `产业链相关`.
- 40-59: `概念映射`.
- 1-39: `蹭概念/弱相关`.
- 0 or insufficient evidence: `待验证`.

Report display mapping:
- Convert the full label and evidence level into a rating-only stock-name suffix: `产业链核心+A` -> `（A）`, `产业链相关+B` -> `（B）`, `概念映射+C` -> `（C）`, `蹭概念/弱相关+D` -> `（D）`, `待验证+D` -> `（D）`.
- Keep the suffix small and textual. It is not a role badge and should not force one stock per table row. Explain the scale once below the role matrix instead of repeating `产业链相关/证据等级/角色权限` under every stock.

Role permission:
- `产业链核心`: eligible for central-capacity/trend-core role if liquidity and price structure confirm.
- `产业链相关`: eligible but needs shorter holding window and stronger price confirmation.
- `概念映射`: emotion/arbitrage only; do not use as capacity proof.
- `蹭概念/弱相关`: high-risk observation or exclusion.
- `待验证`: observation only until evidence is found.

Theme-level adjustment:
- If the supposed leader/central-capacity/trend core is only `概念映射` or weaker, reduce theme grade or mark it hot-money-led.
- If a theme has at least one high-liquidity `产业链核心`/strong `产业链相关` stock with positive trend, confidence in institutional capacity improves.
- If all stocks under a theme are concept-only, do not call it an industry main line.

## Continuity State Mapping

After current theme scores are produced, compare them with the previous active theme ledger. A theme's daily score is incomplete until its continuity state is assigned.

| Prior State / Today Evidence | Continuity State | Action |
|---|---|---|
| Prior active and today still S/A/B with core/do-on-trigger gate | `继续` | Keep following role-level holding protocol; update remaining window |
| Prior active but today score drops >= 15, grade weakens, or gate changes to observe-only | `降级观察` | No new opening; existing research position reduces risk or waits for re-confirmation |
| Prior active and today gate becomes hold-only/climax | `降级观察` or `减仓退出` | Manage existing core only; no back-row or fresh laggard |
| Prior active and today gate becomes reduce/forbidden, stage retreat, leader breaks, or remaining window is 0 | `减仓退出` / `结束` | Exit/close with evidence and close reason |
| Prior active but absent from today's current theme scores/news list | `缺席复核` | Do not delete; verify direct evidence, default to no new opening and carryover risk reduction |
| Prior exit-review theme remains absent or still fails direct evidence review | `结束` | Close active tracking; keep only low-frequency watch unless a new catalyst restarts the cycle |
| Not in prior ledger and today becomes actionable | `新进` | Define start trigger, review clock, invalidation, and next-day follow-up |

Required continuity fields:
- `上一期状态`, `今日状态`, `连续性结论`.
- `已有观察仓处理`: 继续持有 / 降级减仓 / 开盘或反抽退出 / 无仓不新开.
- `结束条件命中`: leader break, breadth fade, central-capacity break, catalyst invalidation, market downgrade, stronger theme siphon, or duration expiry.
- `下一次复核`: auction, 10:00 breadth, close, next pre-market, or after named catalyst.

Never let a prior actionable theme disappear only because it is not one of today's top-ranked themes.

## Duration / Holding Window Mapping

Theme probability is not the same as holding time. Estimate the remaining window separately.

Base total duration comes from theme size:
- National-level: 5-60 trading days depending on stage and policy continuity.
- Industry-level: 3-15 trading days.
- Stock-level: 1-5 trading days.

Stage multiplier:
- Startup: early but unconfirmed; remaining window can be long, but default holding is T+1 review until confirmation.
- Fermentation: best risk-reward; holding can extend beyond next open when breadth and central-capacity/trend core confirm.
- Climax: strong but late; shorten to intraday/T+1 unless already holding confirmed core.
- Retreat: no default holding window; exit/observe unless a new catalyst creates a fresh cycle.

Capital-type adjustment:
- Institutional-led: extend trend core / central-capacity holding window; use daily close and trend break as review points.
- Hot-money-led: shorten leader/emotion-core holding window; use auction, board quality, and leader feedback as review points.
- Mixed: split role-level windows. The central-capacity/trend core can outlast the emotion leader.

Daily adjustment factors:
- Extend when catalyst continuity, leader positive feedback, internal breadth, central-capacity trend, and turnover quality improve together.
- Shorten when first_seen_days is near the historical upper bound, leader height is extreme, failed-board rate rises, central-capacity diverges, or a stronger new theme absorbs liquidity.
- Defensive market caps all new holding protocols to observe/T+1 review even if theme score is high.

Required report labels:
- `已运行` and `预计剩余窗口`.
- `默认持有协议`.
- `延长条件`.
- `缩短/退出条件`.

## Weight Rules

Observation weight is not a personalized allocation. It is a model weight for research attention.

Start from theme score and market regime:
- Defensive: total active theme weight <= 30%.
- Trial: total active theme weight <= 55%.
- Active: total active theme weight <= 80%.
- Aggressive: total active theme weight <= 95%.

Role-based stock weight inside a theme:
- Institutional-led: central-capacity/trend core 55-75%, leader/emotion core 15-30%, laggard/arbitrage <= 15%.
- Hot-money-led: leader/emotion core 45-65%, central-capacity 15-30%, laggard 10-25%.
- Mixed: split between central-capacity and emotion leader; laggard only after leader height confirms.

Attack-weight override:
- A high `今日进攻概率` can raise research attention only if the execution gate is not `禁止`, `减仓退出`, or pure `只观察`.
- In defensive markets, even a high attack probability must be expressed as watchlist priority, not an active allocation.
- If the route is `中军先行`, allocate role attention first to central-capacity/trend core, then leader. If the route is `龙头先行`, allocate first to leader/emotion core and treat central-capacity as confirmation.

## Risk Flags

Always surface these:
- High-position consensus / one-word board exhaustion.
- Leader breaks with negative feedback.
- Central-capacity stock fails to follow.
- Theme breadth expands only to weak back-row names.
- News source is non-official or rumor-only.
- Broad market sentiment is defensive.
- Company announcement denies or weakens the narrative.

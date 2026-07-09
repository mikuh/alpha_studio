# Data Sources and Daily Collection

Use the best available source for each claim and cite it in reports.

## Source Hierarchy

1. Official sources:
   - State Council, ministries, commissions, exchanges, company announcements, exchange filings.
   - Use for policy, regulation, disclosure, trading rules.
2. Market data:
   - Exchange/quote vendors, Wind/Choice/同花顺/东方财富/腾讯行情 where available.
   - Use for prices, turnover, limit-up statistics, sector moves.
   - When premium terminals or local packages are unavailable, use public quote/vendor pages or endpoints as a fallback. Treat this as vendor market data, not official exchange data.
3. Reliable financial media:
   - 财联社、证券时报、上海证券报、中国证券报、第一财经、澎湃、东方财富等。
   - Use for market recaps, theme summaries, industry news.
4. Overnight/global market sources:
   - US indices and sector ETFs, SOX, Nasdaq leaders, China ADRs, Hang Seng Tech/A50, futures, Treasury yields, USD/CNH, VIX/risk indicators, major commodities.
   - Use as cross-market lead evidence. Never treat it as sufficient proof for an A-share trade unless domestic catalyst and A-share price confirmation also align.
5. Macro calendar and event sources:
   - Official macro calendars, central bank calendars, exchange/company disclosure calendars, industry conference calendars, product-launch calendars, earnings calendars.
   - Use to identify timing risk, gap-risk, and catalyst freshness.
6. Secondary or social information:
   - Forums, social media, unverified screenshots, rumors.
   - Use only as "stock-level rumor/speculation" and never as a main-line catalyst by itself.

## Overnight / Morning Global Checklist

Run this before pre-market and next-day strategy reports:

- US broad risk: S&P 500, Nasdaq, Russell, VIX, Treasury yields, dollar index, USD/CNH.
- US sector leads: SOX/semiconductors, AI hardware, software, cloud, EV/Tesla chain, biotech, crypto, energy, metals, defense, consumer.
- China read-through: China ADRs, Nasdaq Golden Dragon, Hang Seng Tech, A50 futures, offshore RMB, US-listed peers for A-share sectors.
- Commodities/futures: crude oil, natural gas, coal, copper, aluminum, lithium chain proxies when available, gold, silver, agricultural commodities tied to domestic themes.
- Macro/event calendar: US CPI/PCE/NFP/ISM/FOMC/Fed speakers, China CPI/PPI/PMI/credit data, PBOC liquidity, major policy meetings, exchange rule changes.
- Catalyst translation: For each major overnight move, name the A-share theme it supports, the likely leader/central-capacity stock pool, and the domestic confirmation needed.
- Negative translation: Name which A-share themes may be pressured by rates, dollar, commodity cost, geopolitical headlines, or overseas leader weakness.

## Pre-Market Collection Checklist

Run before 9:00 China time:
- Previous trading day market stats: indexes, turnover, limit-ups, limit-downs, consecutive boards, max board height, seal rate, failed-board rate.
- Yesterday leader feedback: top leaders, broken boards, next-day premium, high-position loss examples.
- Overnight policy/news: national-level and ministry-level catalysts first.
- Industry data: prices, supply-demand, orders, overseas leader stocks, commodities, futures.
- Company announcements: major contracts, earnings, restructuring, risk clarification.
- Global-to-A-share map: overnight sector leads, ADR/HK/A50 read-through, USD/CNH/rates/risk appetite, and whether the move is new or already priced.
- Morning news heat: official policy > exchange/company announcement > reliable media > broad newswire > social heat. Track timestamp, source class, freshness, and whether it changes the prior probability.
- Theme map: candidate themes, catalysts, internal stocks, first-seen date, current lifecycle stage.
- Stock industry-chain verification: for each stock named in role matrices, collect official/high-quality evidence for product/service, revenue/order/customer/capacity, and supply-chain position. Mark concept-only stocks explicitly.

## Delayed / Intraday / Post-Market Mode

Pick one mode before collecting data:

| Mode | China time | Market sentiment input | Current-day input | Required label |
|---|---:|---|---|---|
| Pre-market | before 09:00 | Previous trading day close | Overnight/morning news | 盘前策略 |
| Delayed pre-market | 09:00-09:30 | Previous trading day close | Auction or pre-open checks | 盘前延迟版 |
| Auction confirmation | 09:25-09:30 | Previous trading day close as baseline | Final opening auction snapshot | 9:25集合竞价确认版 |
| Intraday | 09:30-15:00 | Previous trading day close as baseline | Live open/breadth/leader checks | 盘中更新 |
| Post-market | after 15:00 | Current trading day close | After-close announcements | 复盘 + 次日前瞻 |

Do not blend current-day live data into the previous-close sentiment score. Use live data only as `open_check`, `intraday_check`, or `post_close_check` depending on mode.

## 9:25 Auction Confirmation Checklist

Use this when the user asks for 9:25 confirmation or runs the report at 09:25-09:30:

- Compare the auction result with the pre-market primary and backup attack hypotheses.
- Check leader auction premium, final indicative open, matched amount, matched volume vs prior-day volume/turnover, and whether the leader is opening strong but not excessively crowded.
- Check central-capacity/trend-core stock expected open, matched amount, and whether it confirms institutional capacity rather than diverging from the leader.
- Check group breadth: number of same-theme stocks opening positive, strongly positive, limit-up/near-limit, flat, and negative.
- Check whether the chain opens as `leader + central-capacity + breadth`, `leader only`, `central-capacity only`, `back-row only`, or `no chain`.
- Check high-open risk: too many weak back-row stocks, one-word board crowding, or a leader that opens too high without matched amount support.
- Upgrade only if leader, breadth, central-capacity, and catalyst source remain aligned. If only one layer confirms, mark `假强转观察`.
- Treat 9:25 as a trigger/deny layer. Require 9:30-9:45 secondary confirmation before upgrading a borderline theme into active participation.

## Data Freshness and 口径 Rules

- Web search can lag on the same morning. If search results are sparse, collect direct market snapshots first, then use official/media pages to verify catalysts.
- If two sources report different涨停/跌停 counts, do not force reconciliation. Report both with labels such as `media_all_market`, `Wind/Choice口径`, `vendor_non_st_pool`, or `manual_api_pool`.
- For 东方财富 concept/涨停池 endpoints, keep both the requested date and vendor response `qdate`. In practice these can differ; the requested date is the intended trading-day filter, while `qdate` is a vendor snapshot field.
- Use all-market/media counts for broad sentiment language. Use pool-level counts for seal rate, failed-board rate, max board height, industry distribution, and stock-role evidence.
- If local packages such as akshare or pandas are unavailable, continue with standard-library HTTP collection and document the fallback in the report notes.

## Daily Data Schema

Use this shape when creating machine-readable snapshots:

```json
{
  "date": "YYYY-MM-DD",
  "report_mode": "pre_market|delayed_pre_market|auction_confirmation|intraday|post_market",
  "generated_at": "YYYY-MM-DD HH:MM:SS timezone",
  "previous_theme_ledger": [
    {
      "name": "theme name",
      "status": "active|watch|hold_only|exit_review|closed",
      "last_report_date": "YYYY-MM-DD",
      "last_verdict": "core_only|do_on_trigger|observe_only|hold_only|reduce_exit|forbidden",
      "last_grade": "S|A|B|C",
      "last_score": 0.0,
      "last_lifecycle_stage": "startup|fermentation|climax|retreat",
      "carryover_exposure": "none|observation|test|core",
      "opened_on": "YYYY-MM-DD",
      "allowed_roles": [],
      "planned_exit_conditions": [],
      "next_review": ""
    }
  ],
  "market": {
    "data_window": "previous_close|current_close",
    "limit_up_count_media_all_market": 0,
    "limit_up_count_vendor_non_st_pool": 0,
    "limit_up_count": 0,
    "limit_down_count": 0,
    "consecutive_limit_count": 0,
    "max_board_height": 0,
    "seal_rate": 0.0,
    "failed_board_rate": 0.0,
    "yesterday_limit_premium": 0.0,
    "turnover_amount_cny_bn": 0.0,
    "turnover_change_pct": 0.0,
    "index_stability_score": 0,
    "theme_concentration_score": 0,
    "emotion_indicators": {
      "up_count": 0,
      "down_count": 0,
      "up_down_ratio": 0.0,
      "limit_up_count_media_all_market": 0,
      "limit_up_count_vendor_non_st_pool": 0,
      "limit_down_count_media_all_market": 0,
      "consecutive_limit_count": 0,
      "max_board_height": 0,
      "board_promotion_rate_pct": 0.0,
      "seal_rate_pct_vendor_pool": 0.0,
      "failed_board_rate_pct_vendor_pool": 0.0,
      "dominant_emotion_line": "",
      "negative_feedback_line": ""
    }
  },
  "overnight_global": {
    "data_window": "previous_us_session|current_morning|post_close",
    "risk_appetite_score": 0,
    "us_index_summary": {
      "sp500_pct": 0.0,
      "nasdaq_pct": 0.0,
      "russell_pct": 0.0,
      "vix_pct": 0.0
    },
    "rates_fx": {
      "us_10y_yield_change_bp": 0.0,
      "dxy_pct": 0.0,
      "usdcnh_pct": 0.0
    },
    "sector_leads": [
      {
        "name": "SOX/AI hardware/EV/biotech/etc",
        "direction": "positive|negative|mixed",
        "strength_score": 0,
        "a_share_readthrough": [],
        "domestic_confirmation_needed": []
      }
    ],
    "commodities": [
      {
        "name": "copper/oil/gold/lithium_proxy/etc",
        "direction": "positive|negative|mixed",
        "related_themes": [],
        "risk_note": ""
      }
    ],
    "sources": []
  },
  "macro_calendar": [
    {
      "event": "CPI/FOMC/PMI/company earnings/industry conference/etc",
      "time": "YYYY-MM-DD HH:MM timezone",
      "relevance": "market_liquidity|theme_catalyst|risk_event",
      "affected_themes": [],
      "expected_market_sensitivity": "high|medium|low",
      "source": ""
    }
  ],
  "news_flow": [
    {
      "timestamp": "YYYY-MM-DD HH:MM timezone",
      "source_class": "official|filing|reliable_media|vendor|social",
      "headline": "",
      "themes": [],
      "freshness_score": 0,
      "authority_score": 0,
      "incremental_change": "new|followup|priced_in|denial|rumor",
      "source_url": ""
    }
  ],
  "attack_hypothesis": {
    "primary_route": "中军先行|龙头先行|双核共振|轮动防守|无主线观察",
    "primary_theme": "",
    "backup_route": "",
    "invalidation_route": "",
    "attack_probability_today": 0.0,
    "why_funds_attack": [],
    "required_confirmations": [],
    "forbidden_trades": []
  },
  "auction_check_925": {
    "time": "09:25",
    "baseline_primary_theme": "",
    "baseline_backup_theme": "",
    "overall_confirmation": "mainline_confirmed|test_after_trigger|false_strength_observe|take_profit_no_new|auction_denied",
    "overall_confirmation_label": "主线确认|触发后轻仓试错|假强转观察|冲高兑现/不新开|竞价证伪",
    "market_auction_notes": "",
    "theme_checks": [
      {
        "name": "theme name",
        "baseline_role": "primary|backup|watch|prior_active",
        "leader": {
          "name": "",
          "auction_premium_pct": 0.0,
          "matched_amount_cny_mn": 0.0,
          "matched_volume_vs_prev_day_pct": 0.0,
          "near_limit_or_limit": false,
          "crowding_risk": "low|medium|high"
        },
        "central_capacity": {
          "name": "",
          "auction_premium_pct": 0.0,
          "matched_amount_cny_mn": 0.0,
          "confirmed": false
        },
        "breadth": {
          "positive_open_count": 0,
          "strong_open_count": 0,
          "near_limit_or_limit_count": 0,
          "flat_or_weak_count": 0,
          "negative_open_count": 0,
          "group_open_strength_score": 0
        },
        "chain_pattern": "leader_plus_central_plus_breadth|leader_only|central_only|backrow_only|no_chain",
        "auction_confirmation_score": 0,
        "confirmation_label": "主线确认|触发后轻仓试错|假强转观察|冲高兑现/不新开|竞价证伪",
        "allowed_roles": [],
        "forbidden_roles": [],
        "secondary_confirmation_930_945": [],
        "failure_action": ""
      }
    ]
  },
  "open_check": {
    "time": "HH:MM",
    "index_moves": {},
    "limit_up_count": 0,
    "leading_boards": []
  },
  "themes": [
    {
      "name": "theme name",
      "theme_level": "national|industry|stock",
      "capital_type": "institutional|hot_money|mixed",
      "first_seen_days": 0,
      "catalysts": [],
      "limit_up_count": 0,
      "limit_up_delta": 0,
      "leader_height": 0,
      "central_capacity_trend_score": 0,
      "diffusion_score": 0,
      "fundamental_score": 0,
      "risk_score": 0,
      "overnight_lead_score": 0,
      "us_sector_lead_score": 0,
      "hadr_a50_lead_score": 0,
      "commodity_lead_score": 0,
      "macro_liquidity_score": 0,
      "news_heat_score": 0,
      "catalyst_authority_score": 0,
      "catalyst_freshness_score": 0,
      "catalyst_continuity_score": 0,
      "relative_strength_score": 0,
      "positioning_gap_score": 0,
      "liquidity_capacity_score": 0,
      "auction_confirmation_score": 0,
      "leader_break": false,
      "capital_attack_path": {
        "route": "中军先行|龙头先行|双核共振|轮动防守|无主线观察",
        "today_attack_probability": 0.0,
        "primary_driver": "",
        "confirmation_focus": [],
        "blockers": []
      },
      "execution_gate": {
        "today_verdict": "core_only|do_on_trigger|observe_only|hold_only|reduce_exit|forbidden",
        "today_only_do": [],
        "today_do_not_do": [],
        "confirmation_triggers": [],
        "failure_action": ""
      },
      "holding_window": {
        "elapsed_trading_days": 0,
        "estimated_remaining_trading_days": "2-5",
        "estimate_basis": "historical_sample|model_estimate|mixed",
        "estimate_basis_label": "历史样本校准|模型估计|混合估计",
        "calibration_source": "",
        "default_holding_protocol": "",
        "extension_conditions": [],
        "shorten_exit_conditions": [],
        "review_frequency": ""
      },
      "continuity": {
        "previous_status": "new|active|watch|hold_only|exit_review|closed|unknown",
        "continuity_status": "new|continue|downgrade_watch|reduce_exit|end|missing_review",
        "continuity_label": "新进|继续|降级观察|减仓退出|结束|缺席复核",
        "carryover_action": "继续持有|降级减仓|开盘或反抽退出|无仓不新开|只观察",
        "close_reason": "",
        "next_review": ""
      },
      "stocks": [
        {
          "name": "stock name",
          "role": "leader|central_capacity|trend_core|emotion_core|laggard|arbitrage|observation",
          "supply_chain_relevance": {
            "relevance_label": "产业链核心|产业链相关|概念映射|蹭概念/弱相关|待验证",
            "relevance_score": 0,
            "evidence_level": "A|B|C|D",
            "compact_relevance_label": "A|A-|B+|B|C|D",
            "display_name": "stock name（A）",
            "industry_chain_position": "",
            "business_link": "",
            "revenue_order_customer_evidence": "",
            "evidence_sources": [],
            "concept_risk_flag": false,
            "role_permission": "can_be_core|can_be_related|emotion_arbitrage_only|observe_only|exclude"
          }
        }
      ]
    }
  ],
  "theme_continuity": [
    {
      "name": "theme name",
      "previous_status": "active|watch|hold_only|exit_review|closed|unknown",
      "continuity_status": "new|continue|downgrade_watch|reduce_exit|end|missing_review",
      "continuity_label": "新进|继续|降级观察|减仓退出|结束|缺席复核",
      "today_verdict_label": "",
      "carryover_action": "",
      "evidence_summary": "",
      "close_reason": "",
      "next_review": ""
    }
  ]
}
```

## Evidence Rules

- A "main line" must have both price evidence and catalyst evidence.
- A "likely attack direction" must have at least two aligned evidence layers among overnight/global lead, domestic catalyst, previous-day price strength, leader/central-capacity confirmation, and auction/breadth validation. If only one layer exists, mark it as `假设观察`.
- A 9:25 confirmation requires role-level auction evidence. `leader only` is not enough for `主线确认`; it needs central-capacity/trend-core confirmation or group breadth. If the chain is incomplete, mark `触发后轻仓试错` or `假强转观察`.
- Overnight US/global data upgrades a theme only when it has a credible A-share transmission chain and domestic confirmation. Do not turn a US sector move into an A-share main line by name association alone.
- News heat is a velocity signal, not truth. Authority and incremental freshness outrank headline volume.
- A "national-level" theme requires official or highly authoritative policy/strategy evidence.
- A "central-capacity stock" must have liquidity/market-cap relevance, not only concept purity.
- A "fundamental driver" requires at least one concrete item: demand, price, order, earnings, policy budget, capacity constraint, or industry chain change.
- A "stock role" requires industry-chain authenticity verification. Price涨停, concept tags, and market attention are not business evidence.
- A "central-capacity stock" or "trend core" requires `产业链核心` or strong `产业链相关` evidence. If evidence is only concept mapping, downgrade role permission to emotion/arbitrage/observation.
- In printable role matrices, use the compact `display_name` suffix inside the existing `标的` cell. Multiple stocks with the same role can stay in one cell as `金海通（A）、华亚智能（D）`; do not create one row per stock solely for authenticity labels. Do not add verbose sublines like `产业链相关 / 证据等级A / 可作相关核心`; put a single rating note below the table.
- A "data-quality note" is required when generation is after the open, market counts conflict, or a vendor API fallback is used.
- A "holding window" requires at least first credible evidence date or elapsed trading days. If first_seen_days is uncertain, label it as estimated and shorten the action to observation/trigger-only.
- A theme with no clear execution gate must be marked observe-only, even if it has news catalysts.
- A prior active theme requires a continuity row even when it is absent from today's theme list. Missing evidence is not an exit by itself; mark `缺席复核`, then decide after direct leader/breadth/central-capacity/catalyst checks.
- A theme can move to `closed` only after the report states the end reason and whether it remains on a low-frequency watchlist.

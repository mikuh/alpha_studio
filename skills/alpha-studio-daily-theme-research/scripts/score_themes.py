#!/usr/bin/env python3
"""Score and rank themes for Alpha Studio daily theme research."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


LEVEL_POINTS = {"national": 20, "industry": 15, "stock": 8}
LIFECYCLE_ADJ = {"startup": 3, "fermentation": 8, "climax": -8, "retreat": -20}
BASE_DURATION_DAYS = {
    "national": {
        "startup": (5, 20),
        "fermentation": (5, 30),
        "climax": (1, 5),
        "retreat": (0, 2),
    },
    "industry": {
        "startup": (2, 7),
        "fermentation": (3, 15),
        "climax": (1, 3),
        "retreat": (0, 1),
    },
    "stock": {
        "startup": (1, 3),
        "fermentation": (1, 5),
        "climax": (0, 2),
        "retreat": (0, 0),
    },
}


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def has_value(mapping: dict, key: str) -> bool:
    return key in mapping and mapping.get(key) is not None and mapping.get(key) != ""


def score_0_100(value, default: float = 50.0, *, twenty_point: bool = False) -> float:
    """Normalize a loose model input into a 0-100 score.

    Existing snapshots sometimes store catalyst scores on a 0-20 scale while
    newer inputs use 0-100. `twenty_point` preserves that compatibility.
    """

    if value is None or value == "":
        return default
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if twenty_point and numeric <= 20:
        numeric *= 5
    elif numeric <= 1.5:
        numeric *= 100
    return clamp(numeric)


def average_available(theme: dict, keys: list[str], default: float = 50.0) -> float:
    values = [score_0_100(theme.get(key), default) for key in keys if has_value(theme, key)]
    if not values:
        return default
    return sum(values) / len(values)


def weighted(score: float, points: float) -> float:
    return points * clamp(score) / 100


def catalyst_signal(theme: dict, level: str) -> float:
    authority_default = clamp(LEVEL_POINTS.get(level, 12) * 5)
    authority = score_0_100(
        theme.get("catalyst_authority_score", theme.get("catalyst_score")),
        authority_default,
        twenty_point=True,
    )
    freshness = score_0_100(theme.get("catalyst_freshness_score"), 58 if has_value(theme, "catalyst_score") else 50)
    continuity = score_0_100(theme.get("catalyst_continuity_score"), 55 if has_value(theme, "catalyst_score") else 50)
    return (authority * 0.5) + (freshness * 0.25) + (continuity * 0.25)


def overnight_signal(theme: dict) -> float:
    if has_value(theme, "overnight_lead_score"):
        return score_0_100(theme.get("overnight_lead_score"))
    return average_available(
        theme,
        ["us_sector_lead_score", "hadr_a50_lead_score", "commodity_lead_score", "macro_liquidity_score"],
        50,
    )


def leader_feedback_signal(theme: dict) -> float:
    explicit = score_0_100(theme.get("leader_feedback_score"), -1)
    leader_height = float(theme.get("leader_height", 0) or 0)
    height_score = clamp(leader_height * 16)
    if explicit >= 0:
        return max(explicit, height_score)
    return height_score


def route_label_for(theme: dict, stage: str, market_score: float, gate_code: str) -> str:
    if gate_code in {"forbidden", "reduce_exit"} or stage == "retreat":
        return "无主线观察"
    if gate_code == "hold_only" or stage == "climax":
        return "无主线观察"

    regime = market_regime(market_score)
    capital_type = str(theme.get("capital_type", "mixed"))
    central = score_0_100(theme.get("central_capacity_trend_score"), 0)
    leader = leader_feedback_signal(theme)
    diffusion = score_0_100(theme.get("diffusion_score"), 0)

    if regime == "defensive":
        return "轮动防守" if central >= 60 and capital_type == "institutional" else "无主线观察"
    if central >= 65 and leader >= 45 and diffusion >= 45:
        return "双核共振"
    if capital_type == "institutional" and central >= 55:
        return "中军先行"
    if capital_type == "hot_money" and leader >= 35:
        return "龙头先行"
    if central >= leader and central >= 55:
        return "中军先行"
    if leader > central and leader >= 35:
        return "龙头先行"
    return "无主线观察"


def attack_probability(score: float, stage: str, market_score: float, theme: dict, gate_code: str) -> float:
    p = 20 + score * 0.45
    if stage == "fermentation":
        p += 5
    elif stage == "startup":
        p += 2
    elif stage == "climax":
        p -= 7
    elif stage == "retreat":
        p -= 18

    regime = market_regime(market_score)
    if regime == "defensive":
        p = min(p, 42)
    elif regime == "trial":
        p = min(p + 1, 58)
    elif regime == "active":
        p += 3
    elif regime == "aggressive":
        p += 5

    overnight = overnight_signal(theme)
    relative = score_0_100(theme.get("relative_strength_score"), 50)
    auction = score_0_100(theme.get("auction_confirmation_score"), 50)
    positioning_gap = score_0_100(theme.get("positioning_gap_score"), 50)
    consensus = score_0_100(theme.get("consensus_score"), 50)

    p += (overnight - 50) * 0.06
    p += (relative - 50) * 0.05
    if has_value(theme, "auction_confirmation_score"):
        p += (auction - 50) * 0.06
    p += (positioning_gap - 50) * 0.04

    if consensus >= 82 and stage in {"climax", "fermentation"}:
        p -= 4
    if gate_code in {"observe_only", "hold_only"}:
        p = min(p, 57)
    if gate_code in {"forbidden", "reduce_exit"}:
        p = min(p, 42)
    return round(clamp(p, 15, 78), 1)


def capital_attack_path(theme: dict, score: float, stage: str, market_score: float, gate: dict) -> dict:
    gate_code = str(gate.get("today_verdict", ""))
    route = str((theme.get("capital_attack_path") or {}).get("route") or route_label_for(theme, stage, market_score, gate_code))
    probability_today = attack_probability(score, stage, market_score, theme, gate_code)

    driver_candidates = {
        "隔夜全球线索": overnight_signal(theme),
        "催化权威/新鲜度": catalyst_signal(theme, str(theme.get("theme_level", "industry"))),
        "相对强度": score_0_100(theme.get("relative_strength_score"), 50),
        "龙头反馈": leader_feedback_signal(theme),
        "中军承接": score_0_100(theme.get("central_capacity_trend_score"), 0),
        "共识差": score_0_100(theme.get("positioning_gap_score"), 50),
    }
    top_drivers = [
        {"factor": name, "score": round(value, 1)}
        for name, value in sorted(driver_candidates.items(), key=lambda item: item[1], reverse=True)[:3]
    ]
    blockers: list[str] = []
    risk = float(theme.get("risk_score", 0) or 0)
    if risk >= 65:
        blockers.append("risk score is elevated")
    if stage in {"climax", "retreat"}:
        blockers.append(f"lifecycle stage is {stage}")
    if score_0_100(theme.get("central_capacity_trend_score"), 0) < 45 and str(theme.get("theme_level", "industry")) != "stock":
        blockers.append("central-capacity confirmation is weak")
    if not has_value(theme, "overnight_lead_score") and not any(has_value(theme, key) for key in ["us_sector_lead_score", "hadr_a50_lead_score", "commodity_lead_score"]):
        blockers.append("overnight/global lead is not provided")

    return {
        "route": route,
        "today_attack_probability": probability_today,
        "primary_driver": top_drivers[0]["factor"] if top_drivers else "",
        "top_drivers": top_drivers,
        "confirmation_focus": gate.get("confirmation_triggers", []),
        "blockers": blockers,
    }


def infer_stage(theme: dict) -> str:
    if theme.get("lifecycle_stage"):
        return str(theme["lifecycle_stage"])
    if theme.get("leader_break") or float(theme.get("risk_score", 0) or 0) >= 75:
        return "retreat"
    if float(theme.get("limit_up_count", 0) or 0) >= 10 and float(theme.get("consensus_score", 0) or 0) >= 70:
        return "climax"
    if float(theme.get("diffusion_score", 0) or 0) >= 45 or float(theme.get("leader_height", 0) or 0) >= 2:
        return "fermentation"
    return "startup"


def grade(score: float) -> str:
    if score >= 85:
        return "S"
    if score >= 75:
        return "A"
    if score >= 60:
        return "B"
    return "C"


def market_regime(market_score: float) -> str:
    if market_score < 45:
        return "defensive"
    if market_score < 60:
        return "trial"
    if market_score < 75:
        return "active"
    return "aggressive"


def probability(score: float, stage: str, market_score: float) -> float:
    if score >= 85:
        p = 62 + min(6, (score - 85) * 0.4)
    elif score >= 75:
        p = 55 + (score - 75) * 0.6
    elif score >= 60:
        p = 47 + (score - 60) * (7 / 15)
    else:
        p = 35 + min(11, score * (11 / 60))
    if stage == "fermentation":
        p += 3
    elif stage == "climax":
        p -= 7
    elif stage == "retreat":
        p -= 12
    if market_score < 45:
        p = min(p, 52)
    elif market_score >= 75 and stage == "fermentation":
        p += 3
    if score < 60:
        p = min(p, 46.5)
    return round(clamp(p, 35, 70), 1)


def execution_gate(theme: dict, score: float, grade_value: str, stage: str, market_score: float) -> dict:
    regime = market_regime(market_score)
    level = str(theme.get("theme_level", "industry"))
    capital_type = str(theme.get("capital_type", "mixed"))
    central = float(theme.get("central_capacity_trend_score", 0) or 0)

    if regime == "defensive":
        code = "observe_only"
        label = "只看不做"
        only_do = ["观察竞价、宽度、龙头反馈；不主动新开"]
        do_not_do = ["不做开盘抢入", "不做后排补涨", "不做退潮反抽"]
    elif stage == "retreat":
        code = "reduce_exit"
        label = "减仓退出"
        only_do = ["已有仓位按失效条件降风险；新仓只观察"]
        do_not_do = ["不做退潮加仓", "不做后排摊低成本"]
    elif stage == "climax":
        code = "hold_only"
        label = "只持有不新开"
        only_do = ["仅管理已确认核心；强分歧后再复核"]
        do_not_do = ["不追高潮后排", "不追一字板扩散", "不做弱补涨"]
    elif grade_value in {"S", "A"} and stage == "fermentation" and regime in {"active", "aggressive"}:
        code = "core_only"
        label = "只做主线核心"
        only_do = ["龙头/情绪核心", "中军/趋势核心", "首次有效补涨"]
        do_not_do = ["不做低纯度映射", "不做无量跟风", "不做高位后排"]
    elif grade_value in {"S", "A"} and stage in {"startup", "fermentation"}:
        code = "do_on_trigger"
        label = "触发后做"
        only_do = ["确认后轻仓试错", "优先最纯龙头或首个中军转强"]
        do_not_do = ["不在确认前开盘买入", "不做低纯度扩散"]
    elif score >= 60 and stage == "fermentation":
        code = "observe_only"
        label = "只看不做"
        only_do = ["等待龙头、宽度、中军三者共振"]
        do_not_do = ["不提前埋伏弱确认分支"]
    elif score >= 45:
        code = "observe_only"
        label = "只看不做"
        only_do = ["观察是否补齐催化、宽度、龙头和中军确认"]
        do_not_do = ["不提前埋伏弱确认分支", "不做低纯度扩散", "不做后排套利"]
    else:
        code = "forbidden"
        label = "禁止"
        only_do = ["不参与；仅记录是否出现新催化"]
        do_not_do = ["不做消息未验证题材", "不做弱势后排", "不做退潮摊低"]

    confirmation = [
        "auction leader premium and matched volume confirm",
        "first 15-30 minute breadth expands as a group",
        "central-capacity/trend core confirms rather than diverges",
        "catalyst source remains valid",
    ]
    if level == "stock":
        confirmation.append("single-stock catalyst is confirmed by announcement or reliable media")
    if capital_type == "hot_money":
        confirmation.append("leader avoids negative feedback after open")
    if central < 45 and level != "stock":
        confirmation.append("central-capacity weakness must be repaired before upgrading")

    return {
        "today_verdict": code,
        "today_verdict_label": label,
        "today_only_do": only_do,
        "today_do_not_do": do_not_do,
        "confirmation_triggers": confirmation,
        "failure_action": "downgrade to observe/reduce if leader breaks, breadth fades, central-capacity diverges, or catalyst is denied",
    }


def duration_multiplier(theme: dict, grade_value: str, stage: str, market_score: float) -> float:
    capital_type = str(theme.get("capital_type", "mixed"))
    central = float(theme.get("central_capacity_trend_score", 0) or 0)
    risk = float(theme.get("risk_score", 0) or 0)
    multiplier = 1.0

    if capital_type == "institutional":
        multiplier *= 1.25
    elif capital_type == "hot_money":
        multiplier *= 0.75

    if grade_value == "S":
        multiplier *= 1.2
    elif grade_value == "B":
        multiplier *= 0.8
    elif grade_value == "C":
        multiplier *= 0.55

    regime = market_regime(market_score)
    if regime == "defensive":
        multiplier *= 0.6
    elif regime == "trial":
        multiplier *= 0.8
    elif regime == "aggressive" and stage == "fermentation":
        multiplier *= 1.1

    if central < 45 and str(theme.get("theme_level", "industry")) != "stock":
        multiplier *= 0.8
    if risk >= 65:
        multiplier *= 0.65
    return multiplier


def range_text(lo: int, hi: int) -> str:
    if hi <= 0:
        return "0"
    if lo <= 0 and hi <= 2:
        return "intraday-T+1"
    if lo == hi:
        return str(hi)
    return f"{lo}-{hi}"


def holding_protocol(theme: dict, stage: str, capital_type: str) -> str:
    level = str(theme.get("theme_level", "industry"))
    if stage == "retreat":
        return "No default overnight hold; reduce/exit unless a new catalyst and price confirmation restart the cycle."
    if stage == "climax":
        return "Intraday/T+1 review; only already-confirmed core can be managed, back-row should not be newly opened."
    if capital_type == "institutional" and stage == "fermentation":
        return "Trend core/central-capacity can be held through daily close review while trend, turnover quality, and catalyst continuity remain valid."
    if capital_type == "hot_money":
        return "Leader/emotion core uses auction and T+1 review; extend only when leader feedback and breadth remain positive."
    if level == "stock":
        return "T+1 review by default; extend only if the single-stock catalyst upgrades into broader theme confirmation."
    return "Review at next open and close; extend only when leader, breadth, and central-capacity confirmation persist."


def holding_window(theme: dict, grade_value: str, stage: str, market_score: float) -> dict:
    level = str(theme.get("theme_level", "industry"))
    capital_type = str(theme.get("capital_type", "mixed"))
    first_seen = theme.get("first_seen_days")
    elapsed = max(0, int(round(float(first_seen or 0))))
    elapsed_known = first_seen is not None
    base_min, base_max = BASE_DURATION_DAYS.get(level, BASE_DURATION_DAYS["industry"]).get(stage, (1, 3))
    multiplier = duration_multiplier(theme, grade_value, stage, market_score)
    total_min = max(0, int(round(base_min * multiplier)))
    total_max = max(total_min, int(round(base_max * multiplier)))
    remaining_min = max(0, total_min - elapsed)
    remaining_max = max(0, total_max - elapsed)

    if stage == "retreat" or grade_value == "C":
        remaining_min = 0
        remaining_max = min(remaining_max, 1)
    elif stage == "climax":
        remaining_max = min(remaining_max, 2 if level == "stock" else 3)
    elif remaining_max > 0 and remaining_min == 0:
        remaining_min = 1
    estimate_basis = str(theme.get("duration_estimate_basis", "model_estimate"))
    estimate_basis_label = {
        "historical_sample": "历史样本校准",
        "model_estimate": "模型估计",
        "mixed": "混合估计",
    }.get(estimate_basis, estimate_basis)

    return {
        "elapsed_trading_days": elapsed,
        "elapsed_is_estimated": not elapsed_known,
        "estimated_remaining_trading_days": range_text(remaining_min, remaining_max),
        "basis": f"{level}/{stage}/{capital_type}, grade {grade_value}, market {market_regime(market_score)}",
        "estimate_basis": estimate_basis,
        "estimate_basis_label": estimate_basis_label,
        "calibration_source": str(theme.get("duration_calibration_source", "")),
        "default_holding_protocol": holding_protocol(theme, stage, capital_type),
        "extension_conditions": [
            "catalyst continuity remains valid",
            "leader feedback stays positive",
            "internal breadth expands or remains healthy",
            "central-capacity/trend core confirms",
        ],
        "shorten_exit_conditions": [
            "leader breaks or opens with negative feedback",
            "failed-board pressure rises",
            "central-capacity stock diverges negatively",
            "catalyst is denied or a stronger new theme absorbs liquidity",
        ],
        "review_frequency": "auction + first 15-30 minutes + close; update remaining window daily",
    }


def score_theme(theme: dict, market_score: float) -> dict:
    stage = infer_stage(theme)
    level = str(theme.get("theme_level", "industry"))
    catalyst = catalyst_signal(theme, level)
    overnight = overnight_signal(theme)
    diffusion = score_0_100(theme.get("diffusion_score"), 0)
    leader_feedback = leader_feedback_signal(theme)
    central = score_0_100(theme.get("central_capacity_trend_score"), 0)
    capital = score_0_100(theme.get("capital_flow_score"), 50)
    liquidity = score_0_100(theme.get("liquidity_capacity_score"), capital)
    relative_strength = score_0_100(theme.get("relative_strength_score"), 50)
    fundamental = score_0_100(theme.get("fundamental_score"), 40)
    positioning_gap = score_0_100(theme.get("positioning_gap_score"), 50)
    risk = float(theme.get("risk_score", 0) or 0)

    base = (
        weighted(catalyst, 18)
        + weighted(overnight, 10)
        + weighted(diffusion, 13)
        + weighted(leader_feedback, 10)
        + weighted(central, 12)
        + weighted(relative_strength, 10)
        + weighted(liquidity, 8)
        + weighted(fundamental, 8)
        + weighted(positioning_gap, 6)
        + LIFECYCLE_ADJ.get(stage, 0)
        - min(20, risk * 0.2)
    )
    score = round(clamp(base, 0, 100), 1)
    g = grade(score)
    p = probability(score, stage, market_score)
    gate = execution_gate(theme, score, g, stage, market_score)
    attack_path = capital_attack_path(theme, score, stage, market_score, gate)

    risk_flags = list(theme.get("risk_flags", []))
    if stage == "climax":
        risk_flags.append("theme may be in climax; avoid back-row chasing")
    if stage == "retreat":
        risk_flags.append("theme is in retreat; reduce or observe")
    if central < 45 and level != "stock":
        risk_flags.append("central-capacity confirmation is weak")

    return {
        "name": theme.get("name", ""),
        "grade": g,
        "score": score,
        "probability_attack_today": attack_path["today_attack_probability"],
        "probability_up_1_3d": p,
        "lifecycle_stage": stage,
        "theme_level": level,
        "capital_type": theme.get("capital_type", "mixed"),
        "capital_attack_path": attack_path,
        "execution_gate": gate,
        "holding_window": holding_window(theme, g, stage, market_score),
        "risk_flags": risk_flags,
        "raw": {
            "catalyst_authority_freshness_continuity": round(catalyst, 1),
            "overnight_global_lead": round(overnight, 1),
            "diffusion": diffusion,
            "leader_feedback": round(leader_feedback, 1),
            "central_capacity": central,
            "capital_flow": round(capital, 1),
            "liquidity_capacity": round(liquidity, 1),
            "relative_strength": round(relative_strength, 1),
            "fundamental": fundamental,
            "positioning_gap": round(positioning_gap, 1),
            "risk": risk,
        },
    }


def assign_weights(scored: list[dict], market_score: float) -> list[dict]:
    if market_score < 45:
        cap = 30
    elif market_score < 60:
        cap = 55
    elif market_score < 75:
        cap = 80
    else:
        cap = 95
    def weight_base(item: dict) -> float:
        gate = item.get("execution_gate", {}).get("today_verdict")
        if gate in {"forbidden", "reduce_exit"} or item["score"] < 60:
            return 0.0
        if gate == "hold_only":
            return max(0, item["score"] - 60) * 0.35
        return max(0, item["score"] - 55)

    positives = [weight_base(item) for item in scored]
    total = sum(positives) or 1
    for item, value in zip(scored, positives):
        item["observation_weight"] = round(cap * value / total, 1) if value else 0.0
    return scored


def load_json(path: str | None):
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    parser.add_argument("--market-score", type=float, help="Override market sentiment score")
    args = parser.parse_args()
    data = load_json(args.input)
    market_score = args.market_score
    if market_score is None:
        market_score = float(data.get("market_sentiment_score", data.get("market", {}).get("score", 60)) or 60)
    themes = data.get("themes", data if isinstance(data, list) else [])
    scored = sorted((score_theme(theme, market_score) for theme in themes), key=lambda x: x["score"], reverse=True)
    print(json.dumps(assign_weights(scored, market_score), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

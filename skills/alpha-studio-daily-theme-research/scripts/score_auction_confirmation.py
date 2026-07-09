#!/usr/bin/env python3
"""Score 9:25 auction confirmation for Alpha Studio daily theme research.

Input: JSON object from stdin or --input. Accepts either:
- {"auction_check_925": {"theme_checks": [...]}}
- {"theme_checks": [...]}
- a list of theme-check objects

Output: compact confirmation labels and role-level execution gates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


CHAIN_SCORES = {
    "leader_plus_central_plus_breadth": 100,
    "leader_only": 55,
    "central_only": 60,
    "backrow_only": 35,
    "no_chain": 10,
}
BASELINE_BONUS = {"primary": 8, "backup": 4, "watch": 0, "prior_active": 2}
LABELS = [
    (75, "mainline_confirmed", "主线确认"),
    (62, "test_after_trigger", "触发后轻仓试错"),
    (48, "false_strength_observe", "假强转观察"),
    (35, "take_profit_no_new", "冲高兑现/不新开"),
    (0, "auction_denied", "竞价证伪"),
]


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def number(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def nested(item: dict, key: str, field: str, default=0.0):
    value = item.get(key) or {}
    if isinstance(value, dict):
        return value.get(field, default)
    return default


def premium_score(pct: float) -> float:
    if pct <= -1:
        return 0
    if pct < 0:
        return 20
    if pct < 1:
        return 45 + pct * 15
    if pct < 3:
        return 60 + (pct - 1) * 12
    if pct < 7:
        return 84 + (pct - 3) * 3
    return 92


def matched_amount_score(amount_mn: float) -> float:
    if amount_mn <= 0:
        return 0
    if amount_mn < 10:
        return 25 + amount_mn * 2
    if amount_mn < 50:
        return 45 + (amount_mn - 10) * 0.9
    if amount_mn < 150:
        return 81 + (amount_mn - 50) * 0.12
    return 93


def volume_ratio_score(ratio_pct: float) -> float:
    if ratio_pct <= 0:
        return 45
    if ratio_pct < 2:
        return 50 + ratio_pct * 8
    if ratio_pct < 8:
        return 66 + (ratio_pct - 2) * 4
    return 90


def leader_score(item: dict) -> float:
    premium = number(nested(item, "leader", "auction_premium_pct", item.get("leader_auction_premium_pct")))
    amount = number(nested(item, "leader", "matched_amount_cny_mn", item.get("leader_matched_amount_cny_mn")))
    ratio = number(nested(item, "leader", "matched_volume_vs_prev_day_pct", item.get("leader_matched_volume_vs_prev_day_pct")))
    return (premium_score(premium) * 0.45) + (matched_amount_score(amount) * 0.35) + (volume_ratio_score(ratio) * 0.2)


def central_score(item: dict) -> float:
    premium = number(nested(item, "central_capacity", "auction_premium_pct", item.get("central_auction_premium_pct")))
    amount = number(nested(item, "central_capacity", "matched_amount_cny_mn", item.get("central_matched_amount_cny_mn")))
    confirmed = bool(nested(item, "central_capacity", "confirmed", item.get("central_confirmed", False)))
    score = (premium_score(premium) * 0.55) + (matched_amount_score(amount) * 0.45)
    if confirmed:
        score = max(score, 70)
    return score


def breadth_score(item: dict) -> float:
    breadth = item.get("breadth") or {}
    explicit = breadth.get("group_open_strength_score", item.get("group_open_strength_score"))
    if explicit not in {None, ""}:
        return clamp(number(explicit))
    positive = number(breadth.get("positive_open_count", item.get("positive_open_count")))
    strong = number(breadth.get("strong_open_count", item.get("strong_open_count")))
    near_limit = number(breadth.get("near_limit_or_limit_count", item.get("near_limit_or_limit_count")))
    weak = number(breadth.get("flat_or_weak_count", item.get("flat_or_weak_count")))
    negative = number(breadth.get("negative_open_count", item.get("negative_open_count")))
    total = positive + weak + negative
    if total <= 0:
        return 35
    raw = 35 + (positive / total) * 30 + min(25, strong * 4 + near_limit * 5) - min(25, negative * 5)
    return clamp(raw)


def crowding_penalty(item: dict) -> float:
    risk = str(nested(item, "leader", "crowding_risk", item.get("crowding_risk", "low"))).lower()
    if risk == "high":
        return 15
    if risk == "medium":
        return 7
    return 0


def catalyst_bonus(item: dict) -> float:
    value = item.get("catalyst_still_valid", item.get("catalyst_valid", True))
    if isinstance(value, bool):
        return 7 if value else -7
    return 7 if str(value).strip().lower() not in {"0", "false", "no", "否", "invalid"} else -7


def label_for(score: float) -> tuple[str, str]:
    for threshold, code, label in LABELS:
        if score >= threshold:
            return code, label
    return "auction_denied", "竞价证伪"


def apply_hard_caps(item: dict, score: float) -> tuple[float, list[str]]:
    caps: list[tuple[float, str]] = []
    chain = str(item.get("chain_pattern", "no_chain"))
    central = central_score(item)
    breadth = breadth_score(item)
    lifecycle = str(item.get("lifecycle_stage", item.get("stage", ""))).lower()

    if chain == "leader_only" and (central < 55 or breadth < 55):
        caps.append((61, "leader is strong but central-capacity or breadth is incomplete"))
    if chain == "backrow_only":
        caps.append((47, "back-row opens strongest while leader/central-capacity is weak"))
    if chain == "no_chain" or (breadth < 35 and central < 45):
        caps.append((34, "auction does not show a theme chain"))
    if lifecycle in {"climax", "retreat"} and crowding_penalty(item) >= 15:
        caps.append((47, "climax/retreat theme has high crowding risk"))

    reasons: list[str] = []
    for cap, reason in caps:
        if score > cap:
            score = cap
            reasons.append(reason)
    return score, reasons


def allowed_roles(label_code: str, chain: str) -> list[str]:
    if label_code == "mainline_confirmed":
        if chain == "leader_plus_central_plus_breadth":
            return ["leader/emotion core after 9:30 confirmation", "central-capacity/trend core after 9:30 confirmation"]
        return ["confirmed core only after 9:30 confirmation"]
    if label_code == "test_after_trigger":
        return ["small test only after 9:30-9:45 secondary confirmation", "purest leader or central-capacity repair"]
    return ["none before secondary confirmation"]


def forbidden_roles(label_code: str) -> list[str]:
    base = ["weak back-row", "rumor-only concept mapper", "high-open crowded laggard"]
    if label_code in {"false_strength_observe", "take_profit_no_new", "auction_denied"}:
        return base + ["all new trades before re-confirmation"]
    return base


def score_theme_check(item: dict) -> dict:
    chain = str(item.get("chain_pattern", "no_chain"))
    baseline = str(item.get("baseline_role", "watch"))
    raw_score = (
        leader_score(item) * 0.25
        + central_score(item) * 0.25
        + breadth_score(item) * 0.20
        + CHAIN_SCORES.get(chain, 10) * 0.15
        + BASELINE_BONUS.get(baseline, 0)
        + catalyst_bonus(item)
        - crowding_penalty(item)
    )
    score, cap_reasons = apply_hard_caps(item, clamp(raw_score))
    code, label = label_for(score)
    secondary = [
        "9:30-9:45 theme breadth remains positive",
        "leader avoids open-high-fade negative feedback",
        "central-capacity/trend core confirms with price and turnover",
        "failed-board pressure stays contained",
    ]

    return {
        "name": str(item.get("name", "")),
        "baseline_role": baseline,
        "auction_confirmation_score": round(score, 1),
        "confirmation_code": code,
        "confirmation_label": label,
        "chain_pattern": chain,
        "allowed_roles": allowed_roles(code, chain),
        "forbidden_roles": forbidden_roles(code),
        "secondary_confirmation_930_945": secondary,
        "failure_action": "downgrade to observe/no-new-trade if breadth fades, leader opens high and falls, central-capacity diverges, or catalyst is invalidated",
        "hard_cap_reasons": cap_reasons,
        "raw": {
            "leader_score": round(leader_score(item), 1),
            "central_capacity_score": round(central_score(item), 1),
            "breadth_score": round(breadth_score(item), 1),
            "chain_score": CHAIN_SCORES.get(chain, 10),
            "baseline_bonus": BASELINE_BONUS.get(baseline, 0),
            "crowding_penalty": crowding_penalty(item),
        },
    }


def extract_theme_checks(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if "auction_check_925" in data:
        return (data.get("auction_check_925") or {}).get("theme_checks", [])
    if "theme_checks" in data:
        return data["theme_checks"]
    return data.get("themes", [])


def overall(scored: list[dict]) -> dict:
    if not scored:
        return {
            "overall_confirmation": "auction_denied",
            "overall_confirmation_label": "竞价证伪",
            "primary_theme": "",
            "backup_theme": "",
        }
    ordered = sorted(scored, key=lambda item: item["auction_confirmation_score"], reverse=True)
    best = ordered[0]
    primary = next((item for item in scored if item.get("baseline_role") == "primary"), None)
    backup = next((item for item in ordered if item.get("baseline_role") == "backup"), None)
    chosen = primary if primary and primary["auction_confirmation_score"] >= 62 else best
    return {
        "overall_confirmation": chosen["confirmation_code"],
        "overall_confirmation_label": chosen["confirmation_label"],
        "primary_theme": chosen["name"],
        "backup_theme": backup["name"] if backup else "",
        "best_score": chosen["auction_confirmation_score"],
    }


def load_json(path: str | None):
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    args = parser.parse_args()
    data = load_json(args.input)
    scored = [score_theme_check(item) for item in extract_theme_checks(data)]
    print(
        json.dumps(
            {
                "auction_confirmation": overall(scored),
                "theme_confirmations": scored,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

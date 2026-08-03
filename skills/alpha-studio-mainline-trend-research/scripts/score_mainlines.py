#!/usr/bin/env python3
"""Score industry-mainline candidates with adaptive P/C/L/O pillars."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


PILLARS = ("policy", "directed_credit", "long_term_capital", "overseas_cycle")
GAP_LABELS = {
    "policy": "政策方向",
    "directed_credit": "定向信贷/产业投入",
    "long_term_capital": "长线机构资金",
    "overseas_cycle": "海外产业景气",
}
GAP_PRIORITY = {
    "directed_credit": 4,
    "long_term_capital": 3,
    "overseas_cycle": 2,
    "policy": 1,
}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def as_number(value: Any, default: float) -> float:
    if isinstance(value, bool):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def validate_pricing_scope(value: Any) -> str:
    if value not in {"domestic", "global", "mixed"}:
        raise ValueError("pricing_scope must be domestic, global, or mixed")
    return str(value)


def normalize_pillar(raw: Any, *, active: bool) -> dict[str, Any]:
    if not active:
        return {
            "active": False,
            "strength": None,
            "marginal": None,
            "confidence": None,
            "confirmed": False,
            "accelerating": False,
            "score": None,
            "status": "N/A",
        }

    raw = raw if isinstance(raw, dict) else {}
    strength = int(clamp(as_number(raw.get("strength"), 0), 0, 5))
    confidence = clamp(as_number(raw.get("confidence"), 0), 0, 1)
    marginal_raw = raw.get("marginal")
    marginal = int(marginal_raw) if marginal_raw in {-1, 0, 1} else None
    marginal_bonus = {1: 20, 0: 0, -1: -20, None: -25}[marginal]
    score = clamp(strength * 16 + marginal_bonus, 0, 100) * (0.6 + 0.4 * confidence)
    confirmed = strength >= 3 and confidence >= 0.65 and marginal in {0, 1}
    accelerating = confirmed and marginal == 1
    status = "改善" if marginal == 1 else "持平" if marginal == 0 else "恶化" if marginal == -1 else "未知"
    return {
        "active": True,
        "strength": strength,
        "marginal": marginal,
        "confidence": round(confidence, 3),
        "confirmed": confirmed,
        "accelerating": accelerating,
        "score": round(score, 1),
        "status": status,
    }


def pick_largest_gap(pillars: dict[str, dict[str, Any]]) -> str:
    active = [(name, pillar) for name, pillar in pillars.items() if pillar["active"]]
    deficient = [(name, pillar) for name, pillar in active if not pillar["confirmed"]]
    if not deficient:
        return "无硬支柱缺口；继续检查价格、估值、市场风险与证据时效"

    def sort_key(item: tuple[str, dict[str, Any]]) -> tuple[int, int, float, float]:
        name, pillar = item
        worsening = 1 if pillar["marginal"] == -1 else 0
        return (
            worsening,
            GAP_PRIORITY[name],
            -as_number(pillar["strength"], 0),
            -as_number(pillar["confidence"], 0),
        )

    name, pillar = max(deficient, key=sort_key)
    if pillar["marginal"] == -1:
        reason = "边际恶化"
    elif pillar["marginal"] is None:
        reason = "边际方向未知"
    elif pillar["strength"] < 3:
        reason = "证据强度不足"
    else:
        reason = "可信度不足"
    return f"{GAP_LABELS[name]}：{reason}"


def grade_for(score: float, full_resonance: bool, hard_cap_b: bool) -> str:
    if full_resonance and score >= 82:
        grade = "S"
    elif score >= 72:
        grade = "A"
    elif score >= 58:
        grade = "B"
    else:
        grade = "C"
    if hard_cap_b and grade in {"S", "A"}:
        return "B"
    return grade


def execution_checks_pass(raw: Any) -> tuple[bool, bool]:
    if not isinstance(raw, dict):
        return False, False
    required = ("price_structure", "valuation", "market_risk", "evidence_freshness")
    present = all(key in raw for key in required)
    return present, present and all(raw.get(key) == "pass" for key in required)


def score_track(track: dict[str, Any]) -> dict[str, Any]:
    name = str(track.get("name") or "").strip()
    if not name:
        raise ValueError("each track requires a non-empty name")
    scope = validate_pricing_scope(track.get("pricing_scope"))
    overseas_active = scope in {"global", "mixed"}
    raw_pillars = track.get("pillars") if isinstance(track.get("pillars"), dict) else {}
    pillars = {
        "policy": normalize_pillar(raw_pillars.get("policy"), active=True),
        "directed_credit": normalize_pillar(raw_pillars.get("directed_credit"), active=True),
        "long_term_capital": normalize_pillar(raw_pillars.get("long_term_capital"), active=True),
        "overseas_cycle": normalize_pillar(raw_pillars.get("overseas_cycle"), active=overseas_active),
    }
    active = [pillar for pillar in pillars.values() if pillar["active"]]
    confirmed_count = sum(1 for pillar in active if pillar["confirmed"])
    accelerating_count = sum(1 for pillar in active if pillar["accelerating"])
    has_negative_or_unknown = any(pillar["marginal"] not in {0, 1} for pillar in active)
    all_confirmed = confirmed_count == len(active)
    full_resonance = all_confirmed and accelerating_count >= 2 and not has_negative_or_unknown

    if full_resonance:
        resonance_state = "主升共振"
    elif confirmed_count == len(active) - 1 and confirmed_count >= 2 and not has_negative_or_unknown:
        resonance_state = "趋势候选"
    elif confirmed_count >= 2:
        resonance_state = "部分共振"
    elif confirmed_count == 1:
        resonance_state = "单因子脉冲"
    else:
        resonance_state = "未形成主线"

    score = round(sum(pillar["score"] for pillar in active) / len(active), 1)
    credit_confirmed = pillars["directed_credit"]["confirmed"]
    capital_confirmed = pillars["long_term_capital"]["confirmed"]
    overseas_confirmed = not overseas_active or pillars["overseas_cycle"]["confirmed"]
    policy_confirmed = pillars["policy"]["confirmed"]
    hard_cap_b = not (credit_confirmed and capital_confirmed and overseas_confirmed and policy_confirmed)
    grade = grade_for(score, full_resonance, hard_cap_b)
    checks_present, checks_pass = execution_checks_pass(track.get("execution_checks"))

    if full_resonance and score >= 78 and checks_pass:
        permission = "允许重仓主线核心"
    elif full_resonance:
        permission = "共振成立，重仓权限待执行闸门确认"
    elif resonance_state == "趋势候选":
        permission = "中等仓位参与"
    elif resonance_state == "部分共振":
        permission = "轻仓验证"
    elif resonance_state == "单因子脉冲":
        permission = "禁止重仓，仅观察脉冲"
    else:
        permission = "不参与"

    if not credit_confirmed:
        filter_result = "未通过：定向信贷/产业投入未确认，按伪题材高风险处理"
    elif not capital_confirmed:
        filter_result = "初步通过验真，但长线机构资金未确认，趋势持续性不足"
    elif not overseas_confirmed:
        filter_result = "国内证据有效，但全球/混合赛道缺少海外景气确认"
    else:
        filter_result = "通过硬支柱验真；仍需执行闸门控制仓位"

    return {
        "name": name,
        "pricing_scope": scope,
        "overseas_gate": "on" if overseas_active else "off",
        "pillars": pillars,
        "active_pillar_count": len(active),
        "confirmed_pillar_count": confirmed_count,
        "accelerating_pillar_count": accelerating_count,
        "score": score,
        "grade": grade,
        "resonance_state": resonance_state,
        "heavy_position_permission": permission,
        "false_theme_filter": filter_result,
        "largest_evidence_gap": pick_largest_gap(pillars),
        "execution_checks_present": checks_present,
    }


def score_payload(payload: dict[str, Any]) -> dict[str, Any]:
    tracks = payload.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise ValueError("input must contain a non-empty tracks array")
    scored = [score_track(track) for track in tracks]
    scored.sort(key=lambda item: (item["score"], item["confirmed_pillar_count"]), reverse=True)
    return {
        "schema": "alpha.mainline_score.v1",
        "as_of": payload.get("as_of"),
        "tracks": scored,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON input path")
    parser.add_argument("-o", "--output", type=Path, help="optional JSON output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        result = score_payload(payload)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"score_mainlines: {exc}", file=sys.stderr)
        return 2
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

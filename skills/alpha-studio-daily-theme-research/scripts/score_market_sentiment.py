#!/usr/bin/env python3
"""Score A-share market sentiment for Alpha Studio daily theme research.

Input: JSON object from stdin or --input.
Output: JSON with score, regime, drivers, and warnings.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def pct(value: float | int | None) -> float:
    if value is None:
        return 0.0
    value = float(value)
    return value / 100.0 if value > 1.5 else value


def scale(value: float | int | None, lo: float, hi: float) -> float:
    if value is None:
        return 0.0
    return clamp((float(value) - lo) / (hi - lo))


def score_market(data: dict) -> dict:
    if "market" in data and isinstance(data["market"], dict):
        data = data["market"]
    limit_up = float(data.get("limit_up_count", 0) or 0)
    limit_down = float(data.get("limit_down_count", 0) or 0)
    consecutive = float(data.get("consecutive_limit_count", 0) or 0)
    max_height = float(data.get("max_board_height", 0) or 0)
    seal_rate = pct(data.get("seal_rate", 0))
    failed_rate = pct(data.get("failed_board_rate", 0))
    premium = float(data.get("yesterday_limit_premium", 0) or 0)
    turnover = float(data.get("turnover_amount_cny_bn", data.get("turnover_amount", 0)) or 0)
    turnover_change = float(data.get("turnover_change_pct", 0) or 0)
    index_stability = float(data.get("index_stability_score", 50) or 50)
    concentration = float(data.get("theme_concentration_score", 50) or 50)

    components = {
        "limit_up_breadth": 15 * scale(limit_up, 20, 120),
        "consecutive_board_breadth": 14 * scale(consecutive, 3, 28),
        "leader_height": 12 * scale(max_height, 2, 8),
        "board_quality": 14 * clamp((seal_rate * 0.72) + ((1 - failed_rate) * 0.28)),
        "yesterday_premium": 12 * scale(premium, -4, 8),
        "turnover": 6 * scale(turnover, 800, 3200),
        "turnover_change": 4 * scale(turnover_change, -15, 20),
        "index_stability": 10 * clamp(index_stability / 100),
        "theme_concentration": 8 * clamp(concentration / 100),
        "limit_down_penalty": -5 * scale(limit_down, 0, 35),
    }
    raw_score = sum(components.values())
    score = round(clamp(raw_score, 0, 100), 1)

    if score < 45:
        regime = "defensive"
        action = "cash first; observe only"
    elif score < 60:
        regime = "trial"
        action = "small test positions after confirmation"
    elif score < 75:
        regime = "active"
        action = "main-line participation allowed"
    else:
        regime = "aggressive"
        action = "core theme attack allowed; avoid climax back-row"

    drivers = sorted(components.items(), key=lambda item: abs(item[1]), reverse=True)[:5]
    warnings = []
    if failed_rate >= 0.35:
        warnings.append("failed-board rate is high")
    if premium < 0:
        warnings.append("yesterday limit-up premium is negative")
    if limit_down >= 20:
        warnings.append("limit-down pressure is elevated")
    if index_stability < 45:
        warnings.append("index stability is weak")

    return {
        "score": score,
        "regime": regime,
        "action": action,
        "components": {k: round(v, 2) for k, v in components.items()},
        "top_drivers": [{"factor": k, "points": round(v, 2)} for k, v in drivers],
        "warnings": warnings,
    }


def load_json(path: str | None) -> dict:
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    args = parser.parse_args()
    print(json.dumps(score_market(load_json(args.input)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

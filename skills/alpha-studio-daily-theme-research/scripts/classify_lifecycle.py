#!/usr/bin/env python3
"""Classify theme lifecycle stage for Alpha Studio daily theme research."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def pct(value) -> float:
    if value is None:
        return 0.0
    value = float(value)
    return value / 100.0 if value > 1.5 else value


def classify(theme: dict) -> dict:
    name = theme.get("name", "")
    first_seen = float(theme.get("first_seen_days", 0) or 0)
    limit_up = float(theme.get("limit_up_count", 0) or 0)
    limit_delta = float(theme.get("limit_up_delta", 0) or 0)
    leader_height = float(theme.get("leader_height", 0) or 0)
    diffusion = float(theme.get("diffusion_score", 0) or 0)
    central = float(theme.get("central_capacity_trend_score", 0) or 0)
    consensus = float(theme.get("consensus_score", 0) or 0)
    failed_rate = pct(theme.get("failed_board_rate", 0))
    leader_break = bool(theme.get("leader_break", False))
    risk_score = float(theme.get("risk_score", 0) or 0)

    reasons: list[str] = []

    if leader_break or failed_rate >= 0.38 or risk_score >= 75:
        stage = "retreat"
        reasons.append("leader failed or failed-board/risk pressure is high")
    elif (
        limit_up >= 10
        and leader_height >= 4
        and diffusion >= 70
        and consensus >= 70
    ):
        stage = "climax"
        reasons.append("broad batch limit-ups with high consensus and leader height")
    elif (
        (limit_up >= 4 and diffusion >= 45)
        or (leader_height >= 2 and central >= 55)
        or (limit_delta > 0 and first_seen >= 2 and diffusion >= 40)
    ):
        stage = "fermentation"
        reasons.append("theme breadth, leader height, or central-capacity trend is confirming")
    else:
        stage = "startup"
        reasons.append("early evidence exists but breadth/consensus is not fully confirmed")

    if first_seen <= 1 and stage in {"fermentation", "climax"}:
        reasons.append("stage is fast-moving because evidence compressed into the first day")
    if central < 40 and stage in {"fermentation", "climax"}:
        reasons.append("central-capacity confirmation is weak; watch for hot-money-only behavior")

    return {
        "name": name,
        "stage": stage,
        "reasons": reasons,
        "inputs": {
            "first_seen_days": first_seen,
            "limit_up_count": limit_up,
            "limit_up_delta": limit_delta,
            "leader_height": leader_height,
            "diffusion_score": diffusion,
            "central_capacity_trend_score": central,
            "consensus_score": consensus,
            "failed_board_rate": failed_rate,
            "leader_break": leader_break,
        },
    }


def load_json(path: str | None):
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    args = parser.parse_args()
    data = load_json(args.input)
    themes = data.get("themes", data) if isinstance(data, dict) else data
    if isinstance(themes, dict):
        result = classify(themes)
    else:
        result = [classify(theme) for theme in themes]
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

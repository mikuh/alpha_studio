#!/usr/bin/env python3
"""Calculate deterministic probability calibration metrics from JSON observations."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def calculate(rows: object) -> dict[str, object]:
    if not isinstance(rows, list):
        raise ValueError("input must be a JSON array")
    clean: list[tuple[float, float]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"row {index} must be an object")
        probability = row.get("probability")
        outcome = row.get("outcome")
        if not isinstance(probability, (int, float)) or isinstance(probability, bool) or not 0 <= probability <= 1:
            raise ValueError(f"row {index}.probability must be between 0 and 1")
        if not isinstance(outcome, (int, float)) or isinstance(outcome, bool) or not 0 <= outcome <= 1:
            raise ValueError(f"row {index}.outcome must be between 0 and 1")
        clean.append((float(probability), float(outcome)))
    if not clean:
        return {"sampleCount": 0, "sampleSufficient": False, "brierScore": None, "mae": None, "bias": None, "buckets": []}
    count = len(clean)
    buckets = []
    for lower in (0.0, 0.2, 0.4, 0.6, 0.8):
        upper = lower + 0.2
        selected = [(p, y) for p, y in clean if (lower <= p <= upper) if upper == 1.0]
        if upper != 1.0:
            selected = [(p, y) for p, y in clean if lower <= p < upper]
        if selected:
            buckets.append({
                "lower": lower,
                "upper": upper,
                "count": len(selected),
                "meanProbability": sum(p for p, _ in selected) / len(selected),
                "meanOutcome": sum(y for _, y in selected) / len(selected),
            })
    mean_probability = sum(p for p, _ in clean) / count
    mean_outcome = sum(y for _, y in clean) / count
    return {
        "sampleCount": count,
        "sampleSufficient": count >= 20,
        "meanProbability": mean_probability,
        "meanOutcome": mean_outcome,
        "brierScore": sum((p - y) ** 2 for p, y in clean) / count,
        "mae": sum(abs(p - y) for p, y in clean) / count,
        "bias": mean_probability - mean_outcome,
        "buckets": buckets,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: calibrate_research.py OBSERVATIONS.json", file=sys.stderr)
        return 2
    rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(calculate(rows), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Portable first-pass evaluator for cross-sectional factor panels.

Input is a CSV containing at least:
    date,instrument,factor,forward_return

An optional tradable column may contain true/false, 1/0, yes/no. The evaluator
uses only the Python standard library and is intentionally limited to screening
statistics. It does not perform point-in-time auditing, HAC/bootstrap inference,
transaction-cost modeling, capacity analysis, or a production backtest.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


def finite_float(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def parse_bool(raw: Any) -> bool:
    if raw is None or str(raw).strip() == "":
        return True
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "t"}


def mean(values: Iterable[float]) -> float | None:
    materialized = list(values)
    return statistics.fmean(materialized) if materialized else None


def sample_std(values: Iterable[float]) -> float | None:
    materialized = list(values)
    if len(materialized) < 2:
        return None
    return statistics.stdev(materialized)


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    x_centered = [value - x_mean for value in xs]
    y_centered = [value - y_mean for value in ys]
    numerator = sum(x * y for x, y in zip(x_centered, y_centered))
    x_norm = math.sqrt(sum(value * value for value in x_centered))
    y_norm = math.sqrt(sum(value * value for value in y_centered))
    denominator = x_norm * y_norm
    return numerator / denominator if denominator > 0 else None


def average_ranks(values: list[float]) -> list[float]:
    ordered = sorted(enumerate(values), key=lambda pair: pair[1])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and ordered[end][1] == ordered[start][1]:
            end += 1
        average_rank = (start + 1 + end) / 2.0
        for position in range(start, end):
            ranks[ordered[position][0]] = average_rank
        start = end
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    return pearson(average_ranks(xs), average_ranks(ys))


def quantile_returns(
    factors: list[float],
    returns: list[float],
    quantiles: int,
) -> dict[str, float | None]:
    ordered = sorted(range(len(factors)), key=lambda index: factors[index])
    buckets: list[list[float]] = [[] for _ in range(quantiles)]
    for position, index in enumerate(ordered):
        bucket = min(quantiles - 1, position * quantiles // len(ordered))
        buckets[bucket].append(returns[index])
    return {
        str(index + 1): mean(bucket)
        for index, bucket in enumerate(buckets)
    }


def clean_values(values: Iterable[float | None]) -> list[float]:
    return [value for value in values if value is not None and math.isfinite(value)]


def aggregate_series(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "std": None,
            "ir": None,
            "positive_ratio": None,
            "naive_t_stat": None,
        }
    average = statistics.fmean(values)
    standard_deviation = sample_std(values)
    return {
        "count": len(values),
        "mean": average,
        "median": statistics.median(values),
        "std": standard_deviation,
        "ir": (
            average / standard_deviation
            if standard_deviation is not None and standard_deviation > 0
            else None
        ),
        "positive_ratio": sum(value > 0 for value in values) / len(values),
        "naive_t_stat": (
            average / (standard_deviation / math.sqrt(len(values)))
            if standard_deviation is not None and standard_deviation > 0
            else None
        ),
    }


def load_panel(args: argparse.Namespace) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with args.input.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            args.date_column,
            args.instrument_column,
            args.factor_column,
            args.return_column,
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"missing CSV columns: {', '.join(sorted(missing))}")
        if args.tradable_column and args.tradable_column not in (reader.fieldnames or []):
            raise ValueError(
                f"tradable column not found: {args.tradable_column}"
            )

        for row_number, row in enumerate(reader, start=2):
            day = str(row.get(args.date_column, "")).strip()
            instrument = str(row.get(args.instrument_column, "")).strip()
            if not day or not instrument:
                continue
            grouped[day].append(
                {
                    "instrument": instrument,
                    "factor": finite_float(row.get(args.factor_column)),
                    "return": finite_float(row.get(args.return_column)),
                    "tradable": parse_bool(
                        row.get(args.tradable_column)
                        if args.tradable_column
                        else None
                    ),
                    "row_number": row_number,
                }
            )
    return grouped


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    grouped = load_panel(args)
    if not grouped:
        raise ValueError("no usable rows found")

    direction_multiplier = -1.0 if args.direction == "negative" else 1.0
    daily: list[dict[str, Any]] = []
    rank_maps: dict[str, dict[str, float]] = {}
    total_eligible = 0
    total_valid = 0

    for day in sorted(grouped):
        rows = grouped[day]
        eligible = [
            row
            for row in rows
            if row["tradable"] and row["return"] is not None
        ]
        valid = [row for row in eligible if row["factor"] is not None]
        total_eligible += len(eligible)
        total_valid += len(valid)

        record: dict[str, Any] = {
            "date": day,
            "rows": len(rows),
            "eligible": len(eligible),
            "valid": len(valid),
            "coverage": len(valid) / len(eligible) if eligible else None,
            "pearson_ic": None,
            "rank_ic": None,
            "quantile_returns": {},
            "top_minus_bottom": None,
            "quantile_monotonicity": None,
        }

        if len(valid) >= args.min_cross_section:
            factors = [
                direction_multiplier * float(row["factor"])
                for row in valid
            ]
            returns = [float(row["return"]) for row in valid]
            record["pearson_ic"] = pearson(factors, returns)
            record["rank_ic"] = spearman(factors, returns)
            quantile_map = quantile_returns(factors, returns, args.quantiles)
            record["quantile_returns"] = quantile_map
            bottom = quantile_map.get("1")
            top = quantile_map.get(str(args.quantiles))
            if top is not None and bottom is not None:
                record["top_minus_bottom"] = top - bottom
            quantile_values = [
                quantile_map[str(index)]
                for index in range(1, args.quantiles + 1)
                if quantile_map.get(str(index)) is not None
            ]
            if len(quantile_values) == args.quantiles:
                record["quantile_monotonicity"] = spearman(
                    [float(index) for index in range(1, args.quantiles + 1)],
                    [float(value) for value in quantile_values],
                )
            ranks = average_ranks(factors)
            rank_maps[day] = {
                row["instrument"]: rank
                for row, rank in zip(valid, ranks)
            }
        daily.append(record)

    rank_autocorrelations: list[float] = []
    sorted_days = sorted(rank_maps)
    for previous_day, current_day in zip(sorted_days, sorted_days[1:]):
        previous = rank_maps[previous_day]
        current = rank_maps[current_day]
        common = sorted(set(previous) & set(current))
        if len(common) >= args.min_common_instruments:
            value = pearson(
                [previous[instrument] for instrument in common],
                [current[instrument] for instrument in common],
            )
            if value is not None:
                rank_autocorrelations.append(value)

    pearson_values = clean_values(record["pearson_ic"] for record in daily)
    rank_ic_values = clean_values(record["rank_ic"] for record in daily)
    spread_values = clean_values(record["top_minus_bottom"] for record in daily)
    monotonicity_values = clean_values(
        record["quantile_monotonicity"] for record in daily
    )
    coverage_values = clean_values(record["coverage"] for record in daily)

    return {
        "schema_version": "alpha.cross_section_screen.v1",
        "input": str(args.input),
        "configuration": {
            "direction": args.direction,
            "quantiles": args.quantiles,
            "min_cross_section": args.min_cross_section,
            "min_common_instruments": args.min_common_instruments,
            "columns": {
                "date": args.date_column,
                "instrument": args.instrument_column,
                "factor": args.factor_column,
                "forward_return": args.return_column,
                "tradable": args.tradable_column,
            },
        },
        "coverage": {
            "eligible_rows": total_eligible,
            "valid_factor_rows": total_valid,
            "overall": (
                total_valid / total_eligible if total_eligible else None
            ),
            "mean_daily": mean(coverage_values),
        },
        "pearson_ic": aggregate_series(pearson_values),
        "rank_ic": aggregate_series(rank_ic_values),
        "top_minus_bottom": aggregate_series(spread_values),
        "quantile_monotonicity": aggregate_series(monotonicity_values),
        "factor_rank_autocorrelation": aggregate_series(
            rank_autocorrelations
        ),
        "daily": daily,
        "limitations": [
            "naive_t_stat assumes independent daily observations and is diagnostic only",
            "no point-in-time or historical-universe audit is performed",
            "no HAC, bootstrap, multiple-testing, cost, capacity, risk, or portfolio backtest is performed",
            "quantile returns use equal-weighted forward returns from the supplied panel",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate a cross-sectional factor CSV without third-party dependencies"
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--date-column", default="date")
    parser.add_argument("--instrument-column", default="instrument")
    parser.add_argument("--factor-column", default="factor")
    parser.add_argument("--return-column", default="forward_return")
    parser.add_argument("--tradable-column")
    parser.add_argument(
        "--direction",
        choices=("positive", "negative"),
        default="positive",
        help="Expected relation between raw factor and forward return",
    )
    parser.add_argument("--quantiles", type=int, default=5)
    parser.add_argument("--min-cross-section", type=int, default=20)
    parser.add_argument("--min-common-instruments", type=int, default=10)
    args = parser.parse_args()

    if args.quantiles < 2:
        parser.error("--quantiles must be at least 2")
    if args.min_cross_section < args.quantiles:
        parser.error("--min-cross-section must be at least the number of quantiles")
    if args.min_common_instruments < 2:
        parser.error("--min-common-instruments must be at least 2")

    try:
        result = evaluate(args)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    rendered = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    args.output.write_text(rendered + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "daily_count": len(result["daily"]),
                "rank_ic_mean": result["rank_ic"]["mean"],
                "top_minus_bottom_mean": result["top_minus_bottom"]["mean"],
                "overall_coverage": result["coverage"]["overall"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


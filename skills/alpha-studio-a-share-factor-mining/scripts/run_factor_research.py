#!/usr/bin/env python3
"""Portable A-share quantitative factor research baseline.

This script deliberately uses only the Python standard library. It calculates
several transparent factor families from a long-form daily CSV, performs daily
cross-sectional preprocessing, builds forward returns, reports IC/RankIC and
quantile returns, and runs a rolling-cohort long-short screening backtest.

It is a research baseline, not a production execution or capacity simulator.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from validate_research_config import load_config, validate_config


Key = tuple[str, str]


def finite_float(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_bool(raw: Any) -> bool:
    if raw is None or str(raw).strip() == "":
        return True
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "t"}


def mean(values: Iterable[float | None]) -> float | None:
    valid = [float(value) for value in values if value is not None and math.isfinite(value)]
    return statistics.fmean(valid) if valid else None


def sample_std(values: Iterable[float | None]) -> float | None:
    valid = [float(value) for value in values if value is not None and math.isfinite(value)]
    return statistics.stdev(valid) if len(valid) >= 2 else None


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    x_centered = [value - x_mean for value in xs]
    y_centered = [value - y_mean for value in ys]
    numerator = sum(x * y for x, y in zip(x_centered, y_centered))
    denominator = math.sqrt(sum(x * x for x in x_centered) * sum(y * y for y in y_centered))
    return numerator / denominator if denominator > 0 else None


def average_ranks(values: list[float]) -> list[float]:
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and ordered[end][1] == ordered[start][1]:
            end += 1
        rank = (start + 1 + end) / 2.0
        for position in range(start, end):
            ranks[ordered[position][0]] = rank
        start = end
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    return pearson(average_ranks(xs), average_ranks(ys))


def aggregate(values: Iterable[float | None]) -> dict[str, float | int | None]:
    valid = [float(value) for value in values if value is not None and math.isfinite(value)]
    if not valid:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "std": None,
            "ir": None,
            "positive_ratio": None,
        }
    average = statistics.fmean(valid)
    deviation = statistics.stdev(valid) if len(valid) >= 2 else None
    return {
        "count": len(valid),
        "mean": average,
        "median": statistics.median(valid),
        "std": deviation,
        "ir": average / deviation if deviation and deviation > 0 else None,
        "positive_ratio": sum(value > 0 for value in valid) / len(valid),
    }


def zscore(values: list[float]) -> list[float]:
    if not values:
        return []
    average = statistics.fmean(values)
    deviation = statistics.pstdev(values)
    if deviation <= 0:
        return [0.0] * len(values)
    return [(value - average) / deviation for value in values]


def rank_zscore(values: list[float]) -> list[float]:
    return zscore(average_ranks(values))


def safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or abs(denominator) < 1e-15:
        return None
    value = numerator / denominator
    return value if math.isfinite(value) else None


def split_for_date(day: str, splits: dict[str, Any]) -> str | None:
    for name in ("discovery", "validation", "final_holdout"):
        bounds = splits[name]
        if bounds["start"] <= day <= bounds["end"]:
            return name
    return None


def required_source_columns(config: dict[str, Any]) -> set[str]:
    columns = config["data"]["columns"]
    required = {
        columns["date"],
        columns["instrument"],
        columns["signal_price"],
        columns["fill_price"],
    }
    for optional in ("tradable", "industry", "market_cap"):
        value = columns.get(optional)
        if value:
            required.add(value)
    for factor in config["factors"]:
        source = factor.get("source_column")
        if source:
            required.add(source)
    return required


def load_panel(config: dict[str, Any], config_path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    configured_path = Path(config["data"]["input_csv"])
    input_path = configured_path if configured_path.is_absolute() else config_path.parent / configured_path
    columns = config["data"]["columns"]
    required = required_source_columns(config)
    rows: list[dict[str, Any]] = []
    seen: set[Key] = set()

    with input_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        missing = required - set(fieldnames)
        if missing:
            raise ValueError(f"input CSV is missing columns: {', '.join(sorted(missing))}")

        for row_number, source in enumerate(reader, start=2):
            day = str(source.get(columns["date"], "")).strip()
            instrument = str(source.get(columns["instrument"], "")).strip()
            if not day or not instrument:
                continue
            try:
                datetime.strptime(day, "%Y-%m-%d")
            except ValueError as exc:
                raise ValueError(f"invalid date at CSV row {row_number}: {day}") from exc
            key = (day, instrument)
            if key in seen:
                raise ValueError(f"duplicate date/instrument at CSV row {row_number}: {day}, {instrument}")
            seen.add(key)
            tradable_column = columns.get("tradable")
            rows.append(
                {
                    "date": day,
                    "instrument": instrument,
                    "signal_price": finite_float(source.get(columns["signal_price"])),
                    "fill_price": finite_float(source.get(columns["fill_price"])),
                    "tradable": parse_bool(source.get(tradable_column)) if tradable_column else True,
                    "industry": str(source.get(columns.get("industry"), "")).strip()
                    if columns.get("industry")
                    else "",
                    "market_cap": finite_float(source.get(columns.get("market_cap")))
                    if columns.get("market_cap")
                    else None,
                    "source": source,
                    "row_number": row_number,
                }
            )
    if not rows:
        raise ValueError("input CSV has no usable date/instrument rows")
    rows.sort(key=lambda row: (row["date"], row["instrument"]))
    return rows, fieldnames


def compute_factor_values(
    rows: list[dict[str, Any]], config: dict[str, Any]
) -> dict[str, dict[Key, float | None]]:
    by_instrument: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_instrument[row["instrument"]].append(row)
    for instrument_rows in by_instrument.values():
        instrument_rows.sort(key=lambda row: row["date"])

    result: dict[str, dict[Key, float | None]] = {
        factor["name"]: {} for factor in config["factors"]
    }
    for instrument_rows in by_instrument.values():
        for index, row in enumerate(instrument_rows):
            key = (row["date"], row["instrument"])
            for factor in config["factors"]:
                kind = factor["kind"]
                sign = float(factor.get("sign", 1))
                value: float | None = None
                if kind in {"momentum", "reversal"}:
                    lookback = int(factor["lookback"])
                    if index >= lookback:
                        current = row["signal_price"]
                        prior = instrument_rows[index - lookback]["signal_price"]
                        ratio = safe_ratio(current, prior)
                        if ratio is not None:
                            value = ratio - 1.0
                            if kind == "reversal":
                                value = -value
                elif kind == "low_volatility":
                    lookback = int(factor["lookback"])
                    if index >= lookback:
                        daily_returns: list[float] = []
                        for offset in range(index - lookback + 1, index + 1):
                            current = instrument_rows[offset]["signal_price"]
                            prior = instrument_rows[offset - 1]["signal_price"]
                            ratio = safe_ratio(current, prior)
                            if ratio is not None:
                                daily_returns.append(ratio - 1.0)
                        if len(daily_returns) == lookback:
                            value = -statistics.pstdev(daily_returns)
                elif kind == "turnover_mean":
                    lookback = int(factor["lookback"])
                    if index + 1 >= lookback:
                        source_column = factor["source_column"]
                        values = [
                            finite_float(item["source"].get(source_column))
                            for item in instrument_rows[index - lookback + 1 : index + 1]
                        ]
                        if all(item is not None for item in values):
                            value = statistics.fmean(float(item) for item in values if item is not None)
                elif kind == "turnover_change":
                    short_window = int(factor["short_window"])
                    long_window = int(factor["long_window"])
                    if index + 1 >= long_window:
                        source_column = factor["source_column"]
                        window = [
                            finite_float(item["source"].get(source_column))
                            for item in instrument_rows[index - long_window + 1 : index + 1]
                        ]
                        if all(item is not None for item in window):
                            prior_values = [float(item) for item in window[:-short_window] if item is not None]
                            recent_values = [float(item) for item in window[-short_window:] if item is not None]
                            ratio = safe_ratio(
                                statistics.fmean(recent_values),
                                statistics.fmean(prior_values),
                            )
                            if ratio is not None:
                                value = ratio - 1.0
                else:
                    source = finite_float(row["source"].get(factor["source_column"]))
                    if kind in {"earnings_yield", "book_to_price"}:
                        value = 1.0 / source if source is not None and source > 0 else None
                    elif kind == "roe" or kind == "column":
                        value = source
                    elif kind == "low_leverage":
                        value = -source if source is not None else None
                    elif kind == "small_size":
                        value = -math.log(source) if source is not None and source > 0 else None
                result[factor["name"]][key] = value * sign if value is not None else None
    return result


def compute_forward_returns(
    rows: list[dict[str, Any]], config: dict[str, Any]
) -> tuple[dict[Key, float | None], dict[Key, tuple[str | None, str | None]]]:
    entry_lag = int(config["timing"]["entry_lag"])
    holding_period = int(config["timing"]["holding_period"])
    by_instrument: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_instrument[row["instrument"]].append(row)
    forward: dict[Key, float | None] = {}
    dates: dict[Key, tuple[str | None, str | None]] = {}
    for instrument_rows in by_instrument.values():
        instrument_rows.sort(key=lambda row: row["date"])
        for index, row in enumerate(instrument_rows):
            key = (row["date"], row["instrument"])
            entry_index = index + entry_lag
            exit_index = entry_index + holding_period
            value: float | None = None
            entry_date: str | None = None
            exit_date: str | None = None
            if exit_index < len(instrument_rows):
                entry = instrument_rows[entry_index]
                exit_row = instrument_rows[exit_index]
                entry_date = entry["date"]
                exit_date = exit_row["date"]
                if entry["tradable"] and exit_row["tradable"]:
                    ratio = safe_ratio(exit_row["fill_price"], entry["fill_price"])
                    if ratio is not None:
                        value = ratio - 1.0
            forward[key] = value
            dates[key] = (entry_date, exit_date)
    return forward, dates


def purge_cross_split_forward_returns(
    forward: dict[Key, float | None],
    dates: dict[Key, tuple[str | None, str | None]],
    config: dict[str, Any],
) -> dict[Key, float | None]:
    """Mask labels whose entry or exit crosses a configured split boundary."""
    purged: dict[Key, float | None] = {}
    for key, value in forward.items():
        split = split_for_date(key[0], config["splits"])
        entry_date, exit_date = dates.get(key, (None, None))
        if (
            split is None
            or entry_date is None
            or exit_date is None
            or split_for_date(entry_date, config["splits"]) != split
            or split_for_date(exit_date, config["splits"]) != split
        ):
            purged[key] = None
        else:
            purged[key] = value
    return purged


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    size = len(vector)
    augmented = [list(matrix[row]) + [vector[row]] for row in range(size)]
    for pivot in range(size):
        best = max(range(pivot, size), key=lambda row: abs(augmented[row][pivot]))
        if abs(augmented[best][pivot]) < 1e-12:
            return None
        augmented[pivot], augmented[best] = augmented[best], augmented[pivot]
        divisor = augmented[pivot][pivot]
        augmented[pivot] = [value / divisor for value in augmented[pivot]]
        for row in range(size):
            if row == pivot:
                continue
            multiplier = augmented[row][pivot]
            if multiplier == 0:
                continue
            augmented[row] = [
                current - multiplier * pivot_value
                for current, pivot_value in zip(augmented[row], augmented[pivot])
            ]
    return [augmented[row][-1] for row in range(size)]


def ols_residuals(xs: list[list[float]], ys: list[float]) -> list[float] | None:
    if not xs or len(xs) != len(ys):
        return None
    width = len(xs[0])
    if len(xs) <= width + 1:
        return None
    xtx = [[0.0] * width for _ in range(width)]
    xty = [0.0] * width
    for row, target in zip(xs, ys):
        for left in range(width):
            xty[left] += row[left] * target
            for right in range(width):
                xtx[left][right] += row[left] * row[right]
    for index in range(1, width):
        xtx[index][index] += 1e-10
    coefficients = solve_linear_system(xtx, xty)
    if coefficients is None:
        return None
    return [
        target - sum(value * coefficient for value, coefficient in zip(row, coefficients))
        for row, target in zip(xs, ys)
    ]


def preprocess_factor(
    rows_by_key: dict[Key, dict[str, Any]],
    raw_values: dict[Key, float | None],
    config: dict[str, Any],
) -> tuple[
    dict[Key, float | None],
    dict[Key, float | None],
    dict[Key, str],
    list[dict[str, Any]],
]:
    preprocessing = config["preprocessing"]
    grouped: dict[str, list[Key]] = defaultdict(list)
    for key, value in raw_values.items():
        row = rows_by_key[key]
        if row["tradable"] and value is not None and math.isfinite(value):
            grouped[key[0]].append(key)

    clean_values: dict[Key, float | None] = {key: None for key in raw_values}
    processed_values: dict[Key, float | None] = {key: None for key in raw_values}
    statuses: dict[Key, str] = {key: "missing_or_ineligible" for key in raw_values}
    audit: list[dict[str, Any]] = []

    for day in sorted(grouped):
        keys = grouped[day]
        values = [float(raw_values[key]) for key in keys if raw_values[key] is not None]
        clipped = list(values)
        clipped_count = 0
        if preprocessing["winsorize"] == "mad" and values:
            median = statistics.median(values)
            mad = statistics.median(abs(value - median) for value in values)
            if mad > 0:
                distance = float(preprocessing["mad_multiplier"]) * 1.4826 * mad
                lower, upper = median - distance, median + distance
                clipped = [min(upper, max(lower, value)) for value in values]
                clipped_count = sum(original != result for original, result in zip(values, clipped))
        for key, value in zip(keys, clipped):
            clean_values[key] = value

        eligible_keys = list(keys)
        neutralize = preprocessing["neutralize"]
        industries = sorted(
            {rows_by_key[key]["industry"] for key in eligible_keys if rows_by_key[key]["industry"]}
        )
        industry_columns = industries[1:] if "industry" in neutralize else []
        xs: list[list[float]] = []
        ys: list[float] = []
        regression_keys: list[Key] = []
        for key in eligible_keys:
            row = rows_by_key[key]
            design = [1.0]
            missing_control = False
            if "log_market_cap" in neutralize:
                market_cap = row["market_cap"]
                if market_cap is None or market_cap <= 0:
                    missing_control = True
                else:
                    design.append(math.log(market_cap))
            if "industry" in neutralize:
                if not row["industry"]:
                    missing_control = True
                else:
                    design.extend(1.0 if row["industry"] == industry else 0.0 for industry in industry_columns)
            if not missing_control and clean_values[key] is not None:
                xs.append(design)
                ys.append(float(clean_values[key]))
                regression_keys.append(key)

        neutralization_status = "not_requested"
        base_values: list[float] = []
        base_keys: list[Key] = []
        if neutralize:
            residuals = ols_residuals(xs, ys)
            if residuals is None:
                neutralization_status = "insufficient_or_singular"
            else:
                neutralization_status = "applied"
                base_values = residuals
                base_keys = regression_keys
        else:
            base_values = [float(clean_values[key]) for key in eligible_keys if clean_values[key] is not None]
            base_keys = [key for key in eligible_keys if clean_values[key] is not None]

        if base_values:
            if preprocessing["standardize"] == "zscore":
                transformed = zscore(base_values)
            elif preprocessing["standardize"] == "rank":
                transformed = rank_zscore(base_values)
            else:
                transformed = base_values
            for key, value in zip(base_keys, transformed):
                processed_values[key] = value
                statuses[key] = neutralization_status

        audit.append(
            {
                "date": day,
                "eligible": len(keys),
                "processed": len(base_keys),
                "clipped": clipped_count,
                "neutralization": neutralization_status,
            }
        )
    return clean_values, processed_values, statuses, audit


def build_combination(
    base_processed: dict[str, dict[Key, float | None]],
    combination: dict[str, Any],
) -> tuple[dict[Key, float | None], dict[Key, float | None]]:
    weights = {name: float(weight) for name, weight in combination["weights"].items()}
    minimum = int(combination.get("minimum_available", len(weights)))
    all_keys = set().union(*(values.keys() for values in base_processed.values()))
    raw: dict[Key, float | None] = {}
    grouped: dict[str, list[Key]] = defaultdict(list)
    for key in all_keys:
        available = [
            (weights[name], base_processed[name].get(key))
            for name in weights
            if base_processed[name].get(key) is not None
        ]
        if len(available) < minimum:
            raw[key] = None
            continue
        denominator = sum(abs(weight) for weight, _ in available)
        raw[key] = (
            sum(weight * float(value) for weight, value in available if value is not None) / denominator
            if denominator > 0
            else None
        )
        if raw[key] is not None:
            grouped[key[0]].append(key)
    processed: dict[Key, float | None] = {key: None for key in all_keys}
    for keys in grouped.values():
        values = [float(raw[key]) for key in keys if raw[key] is not None]
        for key, value in zip(keys, zscore(values)):
            processed[key] = value
    return raw, processed


def quantile_map(values: list[float], quantiles: int) -> list[int]:
    ordered = sorted(range(len(values)), key=lambda index: values[index])
    buckets = [0] * len(values)
    for position, index in enumerate(ordered):
        buckets[index] = min(quantiles, position * quantiles // len(values) + 1)
    return buckets


def evaluate_factors(
    factor_values: dict[str, dict[Key, float | None]],
    rows_by_key: dict[Key, dict[str, Any]],
    forward_returns: dict[Key, float | None],
    config: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    quantiles = int(config["evaluation"]["quantiles"])
    minimum = int(config["evaluation"]["min_cross_section"])
    daily_records: list[dict[str, Any]] = []
    summaries: dict[str, dict[str, Any]] = {}

    for factor_name, values_by_key in factor_values.items():
        by_day: dict[str, list[Key]] = defaultdict(list)
        for key, row in rows_by_key.items():
            if row["tradable"] and forward_returns.get(key) is not None:
                by_day[key[0]].append(key)
        prior_top: dict[str, set[str]] = {}
        prior_bottom: dict[str, set[str]] = {}
        prior_ranks: dict[str, dict[str, float]] = {}
        factor_daily: list[dict[str, Any]] = []

        for day in sorted(by_day):
            split = split_for_date(day, config["splits"])
            if split is None:
                continue
            eligible = by_day[day]
            valid = [key for key in eligible if values_by_key.get(key) is not None]
            record: dict[str, Any] = {
                "factor_name": factor_name,
                "date": day,
                "split": split,
                "eligible": len(eligible),
                "valid": len(valid),
                "coverage": len(valid) / len(eligible) if eligible else None,
                "pearson_ic": None,
                "rank_ic": None,
                "top_minus_bottom": None,
                "quantile_monotonicity": None,
                "top_turnover": None,
                "bottom_turnover": None,
                "rank_autocorrelation": None,
            }
            for quantile in range(1, quantiles + 1):
                record[f"q{quantile}_return"] = None
            if len(valid) >= minimum:
                factors = [float(values_by_key[key]) for key in valid if values_by_key[key] is not None]
                returns = [float(forward_returns[key]) for key in valid if forward_returns[key] is not None]
                record["pearson_ic"] = pearson(factors, returns)
                record["rank_ic"] = spearman(factors, returns)
                buckets = quantile_map(factors, quantiles)
                bucket_returns: dict[int, list[float]] = defaultdict(list)
                top: set[str] = set()
                bottom: set[str] = set()
                for key, bucket, value in zip(valid, buckets, returns):
                    bucket_returns[bucket].append(value)
                    if bucket == quantiles:
                        top.add(key[1])
                    if bucket == 1:
                        bottom.add(key[1])
                means: list[float] = []
                for quantile in range(1, quantiles + 1):
                    bucket_mean = mean(bucket_returns.get(quantile, []))
                    record[f"q{quantile}_return"] = bucket_mean
                    if bucket_mean is not None:
                        means.append(bucket_mean)
                if len(means) == quantiles:
                    record["top_minus_bottom"] = means[-1] - means[0]
                    record["quantile_monotonicity"] = spearman(
                        [float(value) for value in range(1, quantiles + 1)], means
                    )
                if split in prior_top and prior_top[split]:
                    record["top_turnover"] = 1.0 - len(top & prior_top[split]) / len(prior_top[split])
                if split in prior_bottom and prior_bottom[split]:
                    record["bottom_turnover"] = 1.0 - len(bottom & prior_bottom[split]) / len(prior_bottom[split])
                prior_top[split] = top
                prior_bottom[split] = bottom
                rank_values = average_ranks(factors)
                rank_map = {key[1]: rank for key, rank in zip(valid, rank_values)}
                if split in prior_ranks:
                    common = sorted(set(rank_map) & set(prior_ranks[split]))
                    if len(common) >= minimum:
                        record["rank_autocorrelation"] = pearson(
                            [prior_ranks[split][instrument] for instrument in common],
                            [rank_map[instrument] for instrument in common],
                        )
                prior_ranks[split] = rank_map
            factor_daily.append(record)
            daily_records.append(record)

        summaries[factor_name] = {}
        for split in ("discovery", "validation", "final_holdout"):
            selected = [record for record in factor_daily if record["split"] == split]
            summaries[factor_name][split] = {
                "dates": len(selected),
                "coverage": aggregate(record["coverage"] for record in selected),
                "pearson_ic": aggregate(record["pearson_ic"] for record in selected),
                "rank_ic": aggregate(record["rank_ic"] for record in selected),
                "top_minus_bottom": aggregate(record["top_minus_bottom"] for record in selected),
                "quantile_monotonicity": aggregate(
                    record["quantile_monotonicity"] for record in selected
                ),
                "top_turnover": aggregate(record["top_turnover"] for record in selected),
                "bottom_turnover": aggregate(record["bottom_turnover"] for record in selected),
                "rank_autocorrelation": aggregate(
                    record["rank_autocorrelation"] for record in selected
                ),
                "quantile_returns": {
                    str(quantile): aggregate(
                        record[f"q{quantile}_return"] for record in selected
                    )
                    for quantile in range(1, quantiles + 1)
                },
            }
    daily_records.sort(key=lambda record: (record["factor_name"], record["date"]))
    return daily_records, summaries


def build_backtests(
    factor_values: dict[str, dict[Key, float | None]],
    rows_by_key: dict[Key, dict[str, Any]],
    config: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    all_dates = sorted({key[0] for key in rows_by_key})
    date_index = {day: index for index, day in enumerate(all_dates)}
    instruments_by_day: dict[str, list[str]] = defaultdict(list)
    for day, instrument in rows_by_key:
        instruments_by_day[day].append(instrument)
    quantiles = int(config["evaluation"]["quantiles"])
    minimum = int(config["evaluation"]["min_cross_section"])
    entry_lag = int(config["timing"]["entry_lag"])
    holding_period = int(config["timing"]["holding_period"])
    rebalance_every = int(config["timing"]["rebalance_every"])
    cost_rate = float(config["evaluation"]["cost_bps"]) / 10000.0
    annualization = int(config["evaluation"]["annualization"])
    records: list[dict[str, Any]] = []
    summaries: dict[str, dict[str, Any]] = {}

    for factor_name, values_by_key in factor_values.items():
        cohorts_by_start: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for signal_index, signal_day in enumerate(all_dates):
            if signal_index % rebalance_every != 0:
                continue
            entry_index = signal_index + entry_lag
            exit_index = entry_index + holding_period
            if exit_index >= len(all_dates):
                continue
            signal_split = split_for_date(signal_day, config["splits"])
            if signal_split is None:
                continue
            if (
                split_for_date(all_dates[entry_index], config["splits"]) != signal_split
                or split_for_date(all_dates[exit_index], config["splits"]) != signal_split
            ):
                continue
            candidates: list[tuple[str, float]] = []
            for instrument in instruments_by_day[signal_day]:
                signal_key = (signal_day, instrument)
                entry_key = (all_dates[entry_index], instrument)
                value = values_by_key.get(signal_key)
                entry_row = rows_by_key.get(entry_key)
                if (
                    value is not None
                    and entry_row is not None
                    and entry_row["tradable"]
                    and entry_row["fill_price"] is not None
                ):
                    candidates.append((instrument, float(value)))
            if len(candidates) < minimum:
                continue
            factors = [value for _, value in candidates]
            buckets = quantile_map(factors, quantiles)
            top = [instrument for (instrument, _), bucket in zip(candidates, buckets) if bucket == quantiles]
            bottom = [instrument for (instrument, _), bucket in zip(candidates, buckets) if bucket == 1]
            if not top or not bottom:
                continue
            weights = {instrument: 1.0 / len(top) for instrument in top}
            for instrument in bottom:
                weights[instrument] = weights.get(instrument, 0.0) - 1.0 / len(bottom)
            cohorts_by_start[entry_index].append(
                {"end": exit_index, "weights": weights, "signal_date": signal_day}
            )

        active: list[dict[str, Any]] = []
        previous_weights: dict[str, float] = {}
        gross_nav = 1.0
        net_nav = 1.0
        factor_records: list[dict[str, Any]] = []
        for index, day in enumerate(all_dates[:-1]):
            active = [cohort for cohort in active if index < cohort["end"]]
            active.extend(cohorts_by_start.get(index, []))
            weights: dict[str, float] = defaultdict(float)
            if active:
                for cohort in active:
                    for instrument, weight in cohort["weights"].items():
                        weights[instrument] += weight / len(active)
            instruments = set(weights) | set(previous_weights)
            turnover = sum(
                abs(weights.get(instrument, 0.0) - previous_weights.get(instrument, 0.0))
                for instrument in instruments
            )
            gross_return = 0.0
            missing_weight = 0.0
            next_day = all_dates[index + 1]
            for instrument, weight in weights.items():
                current = rows_by_key.get((day, instrument))
                following = rows_by_key.get((next_day, instrument))
                ratio = safe_ratio(
                    following["fill_price"] if following else None,
                    current["fill_price"] if current else None,
                )
                if ratio is None:
                    missing_weight += abs(weight)
                else:
                    gross_return += weight * (ratio - 1.0)
            cost = turnover * cost_rate
            net_return = gross_return - cost
            gross_nav *= 1.0 + gross_return
            net_nav *= 1.0 + net_return
            record = {
                "factor_name": factor_name,
                "date": day,
                "split": split_for_date(day, config["splits"]),
                "gross_return": gross_return,
                "turnover": turnover,
                "cost": cost,
                "net_return": net_return,
                "gross_nav": gross_nav,
                "net_nav": net_nav,
                "holdings": sum(abs(weight) > 0 for weight in weights.values()),
                "gross_exposure": sum(abs(weight) for weight in weights.values()),
                "missing_return_weight": missing_weight,
                "active_cohorts": len(active),
            }
            factor_records.append(record)
            records.append(record)
            previous_weights = dict(weights)

        summaries[factor_name] = {}
        for split in ("discovery", "validation", "final_holdout"):
            selected = [record for record in factor_records if record["split"] == split]
            net_returns = [float(record["net_return"]) for record in selected]
            gross_returns = [float(record["gross_return"]) for record in selected]
            cumulative_gross = math.prod(1.0 + value for value in gross_returns) - 1.0 if selected else None
            cumulative_net = math.prod(1.0 + value for value in net_returns) - 1.0 if selected else None
            net_mean = mean(net_returns)
            net_std = sample_std(net_returns)
            running = 1.0
            peak = 1.0
            max_drawdown = 0.0
            for value in net_returns:
                running *= 1.0 + value
                peak = max(peak, running)
                if peak > 0:
                    max_drawdown = min(max_drawdown, running / peak - 1.0)
            summaries[factor_name][split] = {
                "days": len(selected),
                "cumulative_gross_return": cumulative_gross,
                "cumulative_net_return": cumulative_net,
                "annualized_gross_return": mean(gross_returns) * annualization
                if selected
                else None,
                "annualized_net_return": net_mean * annualization
                if net_mean is not None
                else None,
                "annualized_net_volatility": net_std * math.sqrt(annualization)
                if net_std is not None
                else None,
                "net_sharpe": net_mean / net_std * math.sqrt(annualization)
                if net_mean is not None and net_std is not None and net_std > 0
                else None,
                "max_drawdown": max_drawdown if selected else None,
                "average_turnover": mean(record["turnover"] for record in selected),
                "average_cost": mean(record["cost"] for record in selected),
                "average_gross_exposure": mean(
                    record["gross_exposure"] for record in selected
                ),
                "average_missing_return_weight": mean(
                    record["missing_return_weight"] for record in selected
                ),
            }
    records.sort(key=lambda record: (record["factor_name"], record["date"]))
    return records, summaries


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    if fieldnames is None:
        fieldnames = []
        seen: set[str] = set()
        for row in rows:
            for key in row:
                if key not in seen:
                    seen.add(key)
                    fieldnames.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def json_hash(value: Any) -> str:
    contents = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(contents.encode("utf-8")).hexdigest()


def fmt(value: Any, digits: int = 4) -> str:
    if value is None:
        return "not_evaluable"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def build_report(
    config: dict[str, Any],
    warnings: list[str],
    summaries: dict[str, dict[str, Any]],
    backtests: dict[str, dict[str, Any]],
    factor_definitions: dict[str, dict[str, Any]],
) -> str:
    data_ready = (
        config["data"]["point_in_time"] is True
        and config["universe"]["historical_membership"] is True
        and config["universe"]["include_delisted"] is True
    )
    status = "RESEARCH_ONLY"
    lines = [
        f"# 因子研究报告｜{config['research']['research_id']}",
        "",
        "## 结论与状态",
        "",
        f"- 状态：`{status}`",
        "- 结论：内置脚本已完成可复算的首轮因子计算、横截面处理、IC/分组评测与滚动组合成本回测；生产准入仍需独立 PIT 审计、正式统计推断、容量/冲击和 shadow 验证。",
        f"- 数据声明：{'PIT、历史股票池与退市样本均由配置声明' if data_ready else '配置未满足完整 PIT/历史股票池声明，结果只能探索使用'}。",
        "- 数值标签：下表均为 `computed`；配置假设为 `assumed`。",
        "",
        "## 因子定义与经济逻辑",
        "",
        f"- 假设：{config['research']['hypothesis']}",
        f"- 可证伪预测：{config['research']['falsifiable_prediction']}",
        "",
        "| 因子 | 类型 | 参数/权重 |",
        "|---|---|---|",
    ]
    for name, definition in factor_definitions.items():
        lines.append(
            f"| `{name}` | {definition.get('kind', 'combination')} | "
            f"`{json.dumps(definition, ensure_ascii=False, sort_keys=True)}` |"
        )
    lines.extend(
        [
            "",
            "## 数据、时点与股票池",
            "",
            f"- Dataset ID：`{config['data']['dataset_id']}`",
            f"- Universe ID：`{config['universe']['universe_id']}`",
            f"- 信号/成交：`{config['timing']['signal_time']}` → `{config['timing']['fill_time']}`，entry lag {config['timing']['entry_lag']}，持有 {config['timing']['holding_period']} 个交易日。",
            f"- 预处理：`{json.dumps(config['preprocessing'], ensure_ascii=False, sort_keys=True)}`",
            "",
            "## IC/RankIC、分组收益与样本外",
            "",
            "| 因子 | 区间 | RankIC | ICIR | IC胜率 | Top-Bottom | 覆盖率 |",
            "|---|---|---:|---:|---:|---:|---:|",
        ]
    )
    for factor_name, by_split in summaries.items():
        for split, metrics in by_split.items():
            lines.append(
                f"| `{factor_name}` | {split} | {fmt(metrics['rank_ic']['mean'])} | "
                f"{fmt(metrics['rank_ic']['ir'])} | {fmt(metrics['rank_ic']['positive_ratio'])} | "
                f"{fmt(metrics['top_minus_bottom']['mean'])} | {fmt(metrics['coverage']['mean'])} |"
            )
    lines.extend(
        [
            "",
            "## 换手、成本与回撤",
            "",
            f"成本假设：每单位交易名义金额 `{config['evaluation']['cost_bps']}` bps（`assumed`）。",
            "",
            "| 因子 | 区间 | 年化净收益 | 净Sharpe | 最大回撤 | 平均换手 | 累计净收益 |",
            "|---|---|---:|---:|---:|---:|---:|",
        ]
    )
    for factor_name, by_split in backtests.items():
        for split, metrics in by_split.items():
            lines.append(
                f"| `{factor_name}` | {split} | {fmt(metrics['annualized_net_return'])} | "
                f"{fmt(metrics['net_sharpe'])} | {fmt(metrics['max_drawdown'])} | "
                f"{fmt(metrics['average_turnover'])} | {fmt(metrics['cumulative_net_return'])} |"
            )
    lines.extend(
        [
            "",
            "## 失败条件、限制与下一步",
            "",
            "### 预先声明的失效规则",
            "",
        ]
    )
    lines.extend(f"- {rule}" for rule in config["research"]["invalidation_rules"])
    lines.extend(
        [
            "",
            "### 警告",
            "",
        ]
    )
    lines.extend(f"- {warning}" for warning in warnings)
    lines.extend(
        [
            "- `not_evaluable`：正式 HAC/block-bootstrap 推断、多重检验修正、订单簿成交、冲击与容量、借券可得性、真实规则回放、因子库冗余和 shadow 表现。",
            "- 组合回测是日频滚动 cohort 的透明基线，不等同于生产订单执行结果。",
            "- 下一步：冻结候选与阈值，补充上述不可评估项，再决定是否进入 shadow；不得根据 final holdout 反复调参。",
            "",
            "> 本报告仅用于量化研究，不构成个性化投资建议或收益保证。",
            "",
        ]
    )
    return "\n".join(lines)


def output_targets(output_dir: Path) -> list[Path]:
    return [
        output_dir / "research_config.json",
        output_dir / "trial_ledger.csv",
        output_dir / "factor_values.csv",
        output_dir / "daily_metrics.csv",
        output_dir / "factor_metrics.json",
        output_dir / "backtest_daily.csv",
        output_dir / "factor_report.md",
    ]


def run(config_path: Path, output_dir: Path, overwrite: bool = False) -> dict[str, Any]:
    config = load_config(config_path)
    validation = validate_config(config, config_path, check_input=True)
    if validation["errors"]:
        raise ValueError("invalid research config:\n- " + "\n- ".join(validation["errors"]))

    output_dir.mkdir(parents=True, exist_ok=True)
    existing = [path for path in output_targets(output_dir) if path.exists()]
    if existing and not overwrite:
        raise ValueError(
            "refusing to overwrite existing output files; use --overwrite for these exact targets: "
            + ", ".join(str(path) for path in existing)
        )

    rows, _ = load_panel(config, config_path)
    rows_by_key: dict[Key, dict[str, Any]] = {
        (row["date"], row["instrument"]): row for row in rows
    }
    raw_by_factor = compute_factor_values(rows, config)
    forward_returns, forward_dates = compute_forward_returns(rows, config)
    forward_returns = purge_cross_split_forward_returns(
        forward_returns, forward_dates, config
    )
    clean_by_factor: dict[str, dict[Key, float | None]] = {}
    processed_by_factor: dict[str, dict[Key, float | None]] = {}
    status_by_factor: dict[str, dict[Key, str]] = {}
    preprocessing_audit: dict[str, list[dict[str, Any]]] = {}

    for factor in config["factors"]:
        name = factor["name"]
        clean, processed, statuses, audit = preprocess_factor(
            rows_by_key, raw_by_factor[name], config
        )
        clean_by_factor[name] = clean
        processed_by_factor[name] = processed
        status_by_factor[name] = statuses
        preprocessing_audit[name] = audit

    factor_definitions = {factor["name"]: factor for factor in config["factors"]}
    if config.get("combination"):
        combination = config["combination"]
        name = combination["name"]
        raw, processed = build_combination(processed_by_factor, combination)
        raw_by_factor[name] = raw
        clean_by_factor[name] = dict(raw)
        processed_by_factor[name] = processed
        status_by_factor[name] = {
            key: "combined" if value is not None else "missing_components"
            for key, value in processed.items()
        }
        preprocessing_audit[name] = []
        factor_definitions[name] = {
            "kind": "combination",
            "weights": combination["weights"],
            "minimum_available": combination.get("minimum_available"),
        }

    daily_metrics, factor_summaries = evaluate_factors(
        processed_by_factor, rows_by_key, forward_returns, config
    )
    backtest_daily, backtest_summaries = build_backtests(
        processed_by_factor, rows_by_key, config
    )

    factor_value_rows: list[dict[str, Any]] = []
    for factor_name in processed_by_factor:
        for key in sorted(rows_by_key):
            entry_date, exit_date = forward_dates.get(key, (None, None))
            factor_value_rows.append(
                {
                    "date": key[0],
                    "instrument": key[1],
                    "factor_name": factor_name,
                    "factor_raw": raw_by_factor[factor_name].get(key),
                    "factor_clean": clean_by_factor[factor_name].get(key),
                    "factor_processed": processed_by_factor[factor_name].get(key),
                    "forward_return": forward_returns.get(key),
                    "entry_date": entry_date,
                    "exit_date": exit_date,
                    "tradable": rows_by_key[key]["tradable"],
                    "split": split_for_date(key[0], config["splits"]),
                    "quality_flags": status_by_factor[factor_name].get(key),
                }
            )

    run_id = f"{config['research']['research_id']}-{json_hash(config)[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    trial_rows: list[dict[str, Any]] = []
    for index, (factor_name, definition) in enumerate(factor_definitions.items(), start=1):
        holdout_seen = (
            factor_summaries[factor_name]["final_holdout"]["rank_ic"]["count"] > 0
            or backtest_summaries[factor_name]["final_holdout"]["days"] > 0
        )
        trial_rows.append(
            {
                "run_id": run_id,
                "trial_id": f"trial-{index:04d}",
                "parent_trial_id": "",
                "factor_name": factor_name,
                "factor_kind": definition.get("kind", "combination"),
                "parameters_json": json.dumps(definition, ensure_ascii=False, sort_keys=True),
                "dataset_id": config["data"]["dataset_id"],
                "universe_id": config["universe"]["universe_id"],
                "config_hash": json_hash(config),
                "split_role": "discovery+validation+final_holdout",
                "status": "succeeded",
                "failure_reason": "",
                "holdout_seen": str(holdout_seen).lower(),
                "created_at": now,
            }
        )

    metrics = {
        "schema_version": "alpha.quant_factor_metrics.v1",
        "run_id": run_id,
        "status": "RESEARCH_ONLY",
        "configuration_hash": json_hash(config),
        "validation_warnings": validation["warnings"],
        "factor_metrics": factor_summaries,
        "backtest_metrics": backtest_summaries,
        "preprocessing_audit": preprocessing_audit,
        "limitations": [
            "point-in-time and historical-universe claims are declared by config, not independently verified",
            "IC inference does not include HAC or block-bootstrap confidence intervals",
            "multiple-testing correction is not computed",
            "cost uses configured bps per traded notional and does not model market impact or capacity",
            "backtest does not model order-book queues, partial fills, borrow availability, T+1 inventory, or lot rounding",
            "a production or approved decision cannot be issued by this script",
        ],
    }

    (output_dir / "research_config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(output_dir / "trial_ledger.csv", trial_rows)
    write_csv(output_dir / "factor_values.csv", factor_value_rows)
    write_csv(output_dir / "daily_metrics.csv", daily_metrics)
    (output_dir / "factor_metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    write_csv(output_dir / "backtest_daily.csv", backtest_daily)
    (output_dir / "factor_report.md").write_text(
        build_report(
            config,
            validation["warnings"],
            factor_summaries,
            backtest_summaries,
            factor_definitions,
        ),
        encoding="utf-8",
    )
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Calculate, preprocess, evaluate, and backtest A-share factors"
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        metrics = run(args.config, args.output_dir, args.overwrite)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": metrics["status"],
                "run_id": metrics["run_id"],
                "output_dir": str(args.output_dir.resolve()),
                "warnings": len(metrics["validation_warnings"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

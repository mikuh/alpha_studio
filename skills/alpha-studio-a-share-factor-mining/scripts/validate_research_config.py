#!/usr/bin/env python3
"""Validate an Alpha Studio A-share quantitative factor research config.

The validator uses only the Python standard library so the skill remains
portable. The JSON Schema is the integration contract; this script adds the
cross-field and anti-leakage checks that JSON Schema cannot express clearly.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "alpha.quant_factor_research.v1"
FACTOR_KINDS = {
    "momentum",
    "reversal",
    "low_volatility",
    "turnover_mean",
    "turnover_change",
    "earnings_yield",
    "book_to_price",
    "roe",
    "low_leverage",
    "small_size",
    "column",
}
LOOKBACK_KINDS = {"momentum", "reversal", "low_volatility", "turnover_mean"}
SOURCE_KINDS = {
    "turnover_mean",
    "turnover_change",
    "earnings_yield",
    "book_to_price",
    "roe",
    "low_leverage",
    "small_size",
    "column",
}
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")
SELECTION_METRICS = {
    "rank_ic",
    "rank_ic_ir",
    "rank_ic_positive_ratio",
    "net_sharpe",
    "max_drawdown",
    "turnover",
    "stability",
}
WEIGHT_SCHEMES = {"equal", "validation_ic"}


def load_config(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"config file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(value, dict):
        raise ValueError("top-level config must be a JSON object")
    return value


def get_path(value: dict[str, Any], dotted: str) -> Any:
    current: Any = value
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def require_paths(config: dict[str, Any], paths: list[str], errors: list[str]) -> None:
    for dotted in paths:
        value = get_path(config, dotted)
        if value is None or value == "":
            errors.append(f"missing required field: {dotted}")


def parse_date(raw: Any, field: str, errors: list[str]) -> date | None:
    if not isinstance(raw, str):
        errors.append(f"{field} must be an ISO date string")
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        errors.append(f"{field} must use YYYY-MM-DD")
        return None


def positive_int(raw: Any) -> bool:
    return isinstance(raw, int) and not isinstance(raw, bool) and raw > 0


def validate_config(
    config: dict[str, Any],
    config_path: Path | None = None,
    check_input: bool = False,
) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    require_paths(
        config,
        [
            "schema_version",
            "research.research_id",
            "research.hypothesis",
            "research.falsifiable_prediction",
            "research.invalidation_rules",
            "data.input_csv",
            "data.dataset_id",
            "data.point_in_time",
            "data.columns.date",
            "data.columns.instrument",
            "data.columns.signal_price",
            "data.columns.fill_price",
            "universe.market",
            "universe.universe_id",
            "universe.historical_membership",
            "universe.include_delisted",
            "timing.signal_time",
            "timing.fill_time",
            "timing.entry_lag",
            "timing.holding_period",
            "timing.rebalance_every",
            "splits.discovery.start",
            "splits.discovery.end",
            "splits.validation.start",
            "splits.validation.end",
            "splits.final_holdout.start",
            "splits.final_holdout.end",
            "preprocessing.winsorize",
            "preprocessing.standardize",
            "preprocessing.neutralize",
            "factors",
            "evaluation.quantiles",
            "evaluation.min_cross_section",
            "evaluation.cost_bps",
            "evaluation.annualization",
            "guardrails.record_all_trials",
            "guardrails.final_holdout_single_use",
            "guardrails.allow_same_close_fill",
        ],
        errors,
    )

    if config.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    if get_path(config, "universe.market") != "CN_A":
        errors.append("universe.market must be CN_A")

    invalidation_rules = get_path(config, "research.invalidation_rules")
    if not isinstance(invalidation_rules, list) or not invalidation_rules:
        errors.append("research.invalidation_rules must be a non-empty array")

    if get_path(config, "guardrails.record_all_trials") is not True:
        errors.append("guardrails.record_all_trials must be true")
    if get_path(config, "guardrails.final_holdout_single_use") is not True:
        errors.append("guardrails.final_holdout_single_use must be true")
    if get_path(config, "guardrails.allow_same_close_fill") is not False:
        errors.append("guardrails.allow_same_close_fill must be false")

    entry_lag = get_path(config, "timing.entry_lag")
    if not isinstance(entry_lag, int) or isinstance(entry_lag, bool) or entry_lag < 0:
        errors.append("timing.entry_lag must be a non-negative integer")
    if entry_lag == 0:
        errors.append(
            "timing.entry_lag=0 is forbidden by allow_same_close_fill=false; "
            "a signal using the current bar must enter at a later executable bar"
        )
    for field in ("holding_period", "rebalance_every"):
        if not positive_int(get_path(config, f"timing.{field}")):
            errors.append(f"timing.{field} must be a positive integer")

    quantiles = get_path(config, "evaluation.quantiles")
    if not positive_int(quantiles) or not 2 <= quantiles <= 20:
        errors.append("evaluation.quantiles must be an integer from 2 to 20")
    if not positive_int(get_path(config, "evaluation.min_cross_section")):
        errors.append("evaluation.min_cross_section must be a positive integer")
    cost_bps = get_path(config, "evaluation.cost_bps")
    if not isinstance(cost_bps, (int, float)) or isinstance(cost_bps, bool) or cost_bps < 0:
        errors.append("evaluation.cost_bps must be a non-negative number")
    if not positive_int(get_path(config, "evaluation.annualization")):
        errors.append("evaluation.annualization must be a positive integer")

    ranges: list[tuple[str, date, date]] = []
    for split in ("discovery", "validation", "final_holdout"):
        start = parse_date(get_path(config, f"splits.{split}.start"), f"splits.{split}.start", errors)
        end = parse_date(get_path(config, f"splits.{split}.end"), f"splits.{split}.end", errors)
        if start and end:
            if start > end:
                errors.append(f"splits.{split}.start is after splits.{split}.end")
            ranges.append((split, start, end))
    for previous, current in zip(ranges, ranges[1:]):
        if previous[2] >= current[1]:
            errors.append(
                f"splits.{previous[0]} overlaps or touches splits.{current[0]}; "
                "use disjoint chronological ranges"
            )

    preprocessing = config.get("preprocessing")
    if isinstance(preprocessing, dict):
        if preprocessing.get("winsorize") not in {"none", "mad"}:
            errors.append("preprocessing.winsorize must be none or mad")
        if preprocessing.get("standardize") not in {"none", "zscore", "rank"}:
            errors.append("preprocessing.standardize must be none, zscore, or rank")
        neutralize = preprocessing.get("neutralize")
        if not isinstance(neutralize, list):
            errors.append("preprocessing.neutralize must be an array")
        else:
            invalid = sorted(set(neutralize) - {"industry", "log_market_cap"})
            if invalid:
                errors.append(f"unsupported neutralization controls: {', '.join(invalid)}")
            if "industry" in neutralize and not get_path(config, "data.columns.industry"):
                errors.append("industry neutralization requires data.columns.industry")
            if "log_market_cap" in neutralize and not get_path(config, "data.columns.market_cap"):
                errors.append("log_market_cap neutralization requires data.columns.market_cap")
        if preprocessing.get("winsorize") == "mad":
            multiplier = preprocessing.get("mad_multiplier")
            if not isinstance(multiplier, (int, float)) or multiplier <= 0:
                errors.append("MAD winsorization requires a positive mad_multiplier")
    elif preprocessing is not None:
        errors.append("preprocessing must be an object")

    mining = config.get("mining")
    mining_enabled = isinstance(mining, dict) and mining.get("enabled") is True
    factors = config.get("factors")
    factor_names: set[str] = set()
    if not isinstance(factors, list):
        errors.append("factors must be an array")
    elif not factors and not mining_enabled:
        errors.append("factors must be non-empty unless mining.enabled=true")
    else:
        for index, factor in enumerate(factors):
            prefix = f"factors[{index}]"
            if not isinstance(factor, dict):
                errors.append(f"{prefix} must be an object")
                continue
            name = factor.get("name")
            kind = factor.get("kind")
            if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
                errors.append(f"{prefix}.name must match {NAME_PATTERN.pattern}")
            elif name in factor_names:
                errors.append(f"duplicate factor name: {name}")
            else:
                factor_names.add(name)
            if kind not in FACTOR_KINDS:
                errors.append(f"{prefix}.kind is unsupported: {kind}")
                continue
            if kind in LOOKBACK_KINDS and not positive_int(factor.get("lookback")):
                errors.append(f"{prefix}.lookback must be a positive integer for {kind}")
            if kind in SOURCE_KINDS and not isinstance(factor.get("source_column"), str):
                errors.append(f"{prefix}.source_column is required for {kind}")
            if kind == "turnover_change":
                short_window = factor.get("short_window")
                long_window = factor.get("long_window")
                if not positive_int(short_window) or not positive_int(long_window):
                    errors.append(f"{prefix} requires positive short_window and long_window")
                elif short_window >= long_window:
                    errors.append(f"{prefix}.short_window must be smaller than long_window")
            if factor.get("sign", 1) not in {-1, 1}:
                errors.append(f"{prefix}.sign must be 1 or -1")

    if mining is not None:
        if not isinstance(mining, dict):
            errors.append("mining must be an object")
        else:
            if mining.get("enabled") is not True:
                errors.append("mining.enabled must be true when mining is provided")
            templates = mining.get("candidate_templates", [])
            if not isinstance(templates, list):
                errors.append("mining.candidate_templates must be an array")
                templates = []
            if not factor_names and not templates:
                errors.append("mining requires factors or candidate_templates")
            for index, template in enumerate(templates):
                prefix = f"mining.candidate_templates[{index}]"
                if not isinstance(template, dict):
                    errors.append(f"{prefix} must be an object")
                    continue
                kind = template.get("kind")
                if kind not in FACTOR_KINDS:
                    errors.append(f"{prefix}.kind is unsupported: {kind}")
                    continue
                signs = template.get("signs", [1])
                if not isinstance(signs, list) or not signs or any(sign not in {-1, 1} for sign in signs):
                    errors.append(f"{prefix}.signs must be a non-empty array containing only -1 or 1")
                if kind in LOOKBACK_KINDS:
                    lookbacks = template.get("lookbacks")
                    if not isinstance(lookbacks, list) or not lookbacks or any(
                        not positive_int(value) for value in lookbacks
                    ):
                        errors.append(f"{prefix}.lookbacks must contain positive integers")
                if kind in SOURCE_KINDS and not isinstance(template.get("source_column"), str):
                    errors.append(f"{prefix}.source_column is required for {kind}")
                if kind == "turnover_change":
                    pairs = template.get("window_pairs")
                    if not isinstance(pairs, list) or not pairs:
                        errors.append(f"{prefix}.window_pairs must be a non-empty array")
                    else:
                        for pair_index, pair in enumerate(pairs):
                            if (
                                not isinstance(pair, dict)
                                or not positive_int(pair.get("short_window"))
                                or not positive_int(pair.get("long_window"))
                                or pair["short_window"] >= pair["long_window"]
                            ):
                                errors.append(
                                    f"{prefix}.window_pairs[{pair_index}] requires positive short_window < long_window"
                                )

            for field in (
                "max_factor_candidates",
                "top_single_factors",
                "top_combinations",
                "combination_pool_size",
                "max_combination_candidates",
            ):
                if field in mining and not positive_int(mining[field]):
                    errors.append(f"mining.{field} must be a positive integer")
            max_correlation = mining.get("max_pair_correlation", 0.75)
            if (
                not isinstance(max_correlation, (int, float))
                or isinstance(max_correlation, bool)
                or not 0 <= float(max_correlation) < 1
            ):
                errors.append("mining.max_pair_correlation must be in [0, 1)")
            sizes = mining.get("combination_sizes", [2, 3])
            if not isinstance(sizes, list) or not sizes or any(
                not positive_int(size) or size < 2 for size in sizes
            ):
                errors.append("mining.combination_sizes must contain integers >= 2")
            schemes = mining.get("weight_schemes", ["equal", "validation_ic"])
            if not isinstance(schemes, list) or not schemes:
                errors.append("mining.weight_schemes must be a non-empty array")
            else:
                invalid_schemes = sorted(set(schemes) - WEIGHT_SCHEMES)
                if invalid_schemes:
                    errors.append(
                        "unsupported mining.weight_schemes: " + ", ".join(invalid_schemes)
                    )
            if "require_combination_increment" in mining and not isinstance(
                mining["require_combination_increment"], bool
            ):
                errors.append("mining.require_combination_increment must be boolean")

            selection = mining.get("selection", {})
            if not isinstance(selection, dict):
                errors.append("mining.selection must be an object")
            else:
                metric_weights = selection.get("metric_weights", {})
                if not isinstance(metric_weights, dict) or not metric_weights:
                    errors.append("mining.selection.metric_weights must be a non-empty object")
                else:
                    unknown_metrics = sorted(set(metric_weights) - SELECTION_METRICS)
                    if unknown_metrics:
                        errors.append(
                            "unsupported mining selection metrics: " + ", ".join(unknown_metrics)
                        )
                    for metric, weight in metric_weights.items():
                        if (
                            not isinstance(weight, (int, float))
                            or isinstance(weight, bool)
                            or float(weight) < 0
                        ):
                            errors.append(f"selection weight for {metric} must be non-negative")
                    if not any(
                        float(weight) > 0
                        for weight in metric_weights.values()
                        if isinstance(weight, (int, float)) and not isinstance(weight, bool)
                    ):
                        errors.append("at least one mining selection weight must be positive")
                min_days = selection.get("min_validation_rank_ic_days", 1)
                if not positive_int(min_days):
                    errors.append("mining.selection.min_validation_rank_ic_days must be positive")
                min_coverage = selection.get("min_validation_coverage", 0.0)
                if (
                    not isinstance(min_coverage, (int, float))
                    or isinstance(min_coverage, bool)
                    or not 0 <= float(min_coverage) <= 1
                ):
                    errors.append("mining.selection.min_validation_coverage must be in [0, 1]")

    combination = config.get("combination")
    if combination is not None:
        if not isinstance(combination, dict):
            errors.append("combination must be an object or null")
        else:
            name = combination.get("name")
            if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
                errors.append("combination.name must use a valid factor identifier")
            if name in factor_names:
                errors.append("combination.name must not duplicate a base factor name")
            weights = combination.get("weights")
            if not isinstance(weights, dict) or len(weights) < 2:
                errors.append("combination.weights must contain at least two factors")
            else:
                unknown = sorted(set(weights) - factor_names)
                if unknown:
                    errors.append(f"combination references unknown factors: {', '.join(unknown)}")
                for factor_name, weight in weights.items():
                    if not isinstance(weight, (int, float)) or isinstance(weight, bool):
                        errors.append(f"combination weight for {factor_name} must be numeric")
                if not any(float(weight) != 0 for weight in weights.values() if isinstance(weight, (int, float))):
                    errors.append("combination weights must not all be zero")
            minimum_available = combination.get("minimum_available", len(weights) if isinstance(weights, dict) else 0)
            if not positive_int(minimum_available):
                errors.append("combination.minimum_available must be a positive integer")
            elif isinstance(weights, dict) and minimum_available > len(weights):
                errors.append("combination.minimum_available exceeds the number of weights")

    if get_path(config, "data.point_in_time") is not True:
        warnings.append("data.point_in_time is false; results are exploratory and cannot support promotion")
    if get_path(config, "universe.historical_membership") is not True:
        warnings.append("historical_membership is false; survivorship bias is not controlled")
    if get_path(config, "universe.include_delisted") is not True:
        warnings.append("include_delisted is false; document the survivorship-bias impact")

    dataset_id = str(get_path(config, "data.dataset_id") or "")
    universe_id = str(get_path(config, "universe.universe_id") or "")
    if "replace-with" in dataset_id:
        warnings.append("data.dataset_id is still a template placeholder")
    if "replace-with" in universe_id:
        warnings.append("universe.universe_id is still a template placeholder")

    if check_input and isinstance(get_path(config, "data.input_csv"), str):
        input_path = Path(get_path(config, "data.input_csv"))
        if not input_path.is_absolute() and config_path is not None:
            input_path = config_path.parent / input_path
        if not input_path.is_file():
            errors.append(f"input CSV not found: {input_path}")

    return {"errors": errors, "warnings": warnings}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an A-share factor research config")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--check-input", action="store_true")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    try:
        config = load_config(args.config)
        result = validate_config(config, args.config, args.check_input)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for error in result["errors"]:
            print(f"ERROR: {error}", file=sys.stderr)
        for warning in result["warnings"]:
            print(f"WARNING: {warning}", file=sys.stderr)
        if not result["errors"]:
            print(f"VALID with {len(result['warnings'])} warning(s)")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

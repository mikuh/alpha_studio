#!/usr/bin/env python3
"""Validate Alpha Studio A-share research and factor specifications.

This validator intentionally uses only the Python standard library. It checks the
hard invariants that are most important before a formal factor experiment. The
JSON Schema files remain the complete integration contracts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any


ARCHETYPES = {
    "cross_sectional",
    "time_series",
    "event",
    "fundamental",
    "alternative_data",
    "microstructure",
    "risk",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(value, dict):
        raise ValueError("top-level JSON value must be an object")
    return value


def get_path(value: dict[str, Any], dotted: str) -> Any:
    current: Any = value
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def require(
    value: dict[str, Any],
    paths: list[str],
    errors: list[str],
) -> None:
    for dotted in paths:
        item = get_path(value, dotted)
        if item is None or item == "":
            errors.append(f"missing required field: {dotted}")


def parse_iso_date(raw: Any, field: str, errors: list[str]) -> date | None:
    if not isinstance(raw, str):
        errors.append(f"{field} must be an ISO date string")
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        errors.append(f"{field} must use YYYY-MM-DD")
        return None


def validate_research(
    value: dict[str, Any],
    errors: list[str],
    warnings: list[str],
) -> None:
    require(
        value,
        [
            "schema_version",
            "research_id",
            "objective",
            "primary_archetype",
            "trial_family_id",
            "hypothesis.mechanism",
            "hypothesis.falsifiable_prediction",
            "hypothesis.expected_direction",
            "hypothesis.failure_scenarios",
            "universe.market",
            "universe.exchanges",
            "universe.boards",
            "universe.historical_membership",
            "universe.include_delisted",
            "universe.tradability_policy.st",
            "universe.tradability_policy.suspension",
            "universe.tradability_policy.price_limit",
            "universe.tradability_policy.t_plus_one",
            "universe.tradability_policy.lot_size",
            "timing.frequency",
            "timing.timezone",
            "timing.decision_time",
            "timing.earliest_order_time",
            "timing.earliest_fill_time",
            "timing.label_interval",
            "timing.holding_period",
            "timing.rebalance_frequency",
            "data_split.discovery.start",
            "data_split.discovery.end",
            "data_split.validation.start",
            "data_split.validation.end",
            "data_split.final_holdout.start",
            "data_split.final_holdout.end",
            "search_policy.allowed_methods",
            "search_policy.max_trials",
            "search_policy.stopping_rule",
            "guardrails.point_in_time_required",
            "guardrails.record_all_trials",
            "guardrails.final_holdout_single_use",
        ],
        errors,
    )

    if value.get("schema_version") != "alpha.factor_research.v1":
        errors.append("schema_version must be alpha.factor_research.v1")
    if value.get("primary_archetype") not in ARCHETYPES:
        errors.append("primary_archetype is not supported")
    if get_path(value, "universe.market") != "CN_A":
        errors.append("universe.market must be CN_A")
    if get_path(value, "universe.historical_membership") is not True:
        errors.append("historical_membership must be true")
    if get_path(value, "timing.timezone") != "Asia/Shanghai":
        errors.append("timing.timezone must be Asia/Shanghai")

    for key in (
        "point_in_time_required",
        "record_all_trials",
        "final_holdout_single_use",
    ):
        if get_path(value, f"guardrails.{key}") is not True:
            errors.append(f"guardrails.{key} must be true")

    exchanges = get_path(value, "universe.exchanges")
    if isinstance(exchanges, list):
        if not exchanges:
            errors.append("universe.exchanges must not be empty")
        invalid = sorted(set(exchanges) - {"SSE", "SZSE", "BSE"})
        if invalid:
            errors.append(f"unsupported exchanges: {', '.join(invalid)}")
    boards = get_path(value, "universe.boards")
    if isinstance(boards, list) and not boards:
        errors.append("universe.boards must not be empty")
    failure_scenarios = get_path(value, "hypothesis.failure_scenarios")
    if isinstance(failure_scenarios, list) and not failure_scenarios:
        errors.append("hypothesis.failure_scenarios must not be empty")
    allowed_methods = get_path(value, "search_policy.allowed_methods")
    if isinstance(allowed_methods, list) and not allowed_methods:
        errors.append("search_policy.allowed_methods must not be empty")

    max_trials = get_path(value, "search_policy.max_trials")
    if not isinstance(max_trials, int) or isinstance(max_trials, bool) or max_trials < 1:
        errors.append("search_policy.max_trials must be a positive integer")

    ranges: list[tuple[str, date, date]] = []
    for split in ("discovery", "validation", "final_holdout", "shadow"):
        raw = get_path(value, f"data_split.{split}")
        if raw is None:
            continue
        if not isinstance(raw, dict):
            errors.append(f"data_split.{split} must be an object")
            continue
        start = parse_iso_date(raw.get("start"), f"data_split.{split}.start", errors)
        end = parse_iso_date(raw.get("end"), f"data_split.{split}.end", errors)
        if start and end:
            if start > end:
                errors.append(f"data_split.{split} starts after it ends")
            ranges.append((split, start, end))

    order = {"discovery": 0, "validation": 1, "final_holdout": 2, "shadow": 3}
    ranges.sort(key=lambda item: order[item[0]])
    for previous, current in zip(ranges, ranges[1:]):
        if current[1] <= previous[2]:
            errors.append(
                f"data_split.{previous[0]} overlaps or touches "
                f"data_split.{current[0]}; use disjoint date ranges"
            )

    if get_path(value, "universe.include_delisted") is not True:
        warnings.append(
            "include_delisted is false; document why this does not create survivorship bias"
        )


def validate_factor(
    value: dict[str, Any],
    errors: list[str],
    warnings: list[str],
) -> None:
    require(
        value,
        [
            "schema_version",
            "name",
            "trial_family_id",
            "primary_archetype",
            "hypothesis",
            "expected_direction",
            "implementation",
            "data_fields",
            "universe_ref",
            "timing.formation_window",
            "timing.decision_time",
            "timing.earliest_fill_time",
            "timing.holding_period",
            "timing.rebalance_frequency",
            "preprocessing.missing",
            "preprocessing.winsorize",
            "preprocessing.standardize",
            "preprocessing.neutralize",
            "parameters",
            "falsification.expected_failures",
            "falsification.invalidation_rules",
        ],
        errors,
    )

    if value.get("schema_version") != "alpha.factor_spec.v1":
        errors.append("schema_version must be alpha.factor_spec.v1")
    if value.get("primary_archetype") not in ARCHETYPES:
        errors.append("primary_archetype is not supported")
    if value.get("expected_direction") not in {"positive", "negative", "two_sided"}:
        errors.append("expected_direction must be positive, negative, or two_sided")

    name = value.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,63}", name):
        errors.append(
            "name must contain 3-64 lowercase letters, digits, underscores, or hyphens"
        )

    implementation = value.get("implementation")
    if isinstance(implementation, dict):
        expression_mode = bool(implementation.get("expression"))
        code_mode = bool(implementation.get("code_ref"))
        if expression_mode == code_mode:
            errors.append(
                "implementation must define exactly one of expression or code_ref"
            )
        if expression_mode and not implementation.get("dsl_version"):
            errors.append("expression implementation requires dsl_version")
        if code_mode and not implementation.get("code_hash"):
            errors.append("code_ref implementation requires code_hash")

        expression = str(implementation.get("expression", "")).lower()
        forbidden_patterns = {
            r"\blead\s*\(": "lead() is a future reference",
            r"\bfuture\s*\(": "future() is a future reference",
            r"\b(?:ref|lag|shift)\s*\([^)]*,\s*-\d+": "negative lag is forbidden",
            r"\bt\s*\+\s*\d+": "explicit future t+n reference is forbidden",
        }
        for pattern, message in forbidden_patterns.items():
            if re.search(pattern, expression):
                errors.append(message)
    elif implementation is not None:
        errors.append("implementation must be an object")

    fields = value.get("data_fields")
    if isinstance(fields, list):
        if not fields:
            errors.append("data_fields must not be empty")
        for index, field in enumerate(fields):
            if not isinstance(field, dict):
                errors.append(f"data_fields[{index}] must be an object")
                continue
            for key in (
                "name",
                "source",
                "frequency",
                "known_at_rule",
                "availability_lag",
                "adjustment",
            ):
                if field.get(key) in (None, ""):
                    errors.append(f"data_fields[{index}].{key} is required")
            adjustment = str(field.get("adjustment", "")).lower()
            if adjustment in {"", "unknown", "default", "unspecified"}:
                errors.append(
                    f"data_fields[{index}].adjustment must be explicit"
                )
    elif fields is not None:
        errors.append("data_fields must be an array")

    decision_time = get_path(value, "timing.decision_time")
    fill_time = get_path(value, "timing.earliest_fill_time")
    if decision_time == fill_time and decision_time:
        warnings.append(
            "decision_time equals earliest_fill_time; prove the signal is frozen before execution"
        )

    neutralize = get_path(value, "preprocessing.neutralize")
    if not isinstance(neutralize, list):
        errors.append("preprocessing.neutralize must be an array")
    for dotted in (
        "falsification.expected_failures",
        "falsification.invalidation_rules",
    ):
        rules = get_path(value, dotted)
        if isinstance(rules, list) and not rules:
            errors.append(f"{dotted} must not be empty")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate Alpha Studio A-share factor specifications"
    )
    parser.add_argument("--kind", choices=("research", "factor"), required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional JSON result path; stdout is always populated",
    )
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    try:
        value = load_json(args.input)
        if args.kind == "research":
            validate_research(value, errors, warnings)
        else:
            validate_factor(value, errors, warnings)
    except ValueError as exc:
        errors.append(str(exc))

    result = {
        "valid": not errors,
        "kind": args.kind,
        "input": str(args.input),
        "errors": errors,
        "warnings": warnings,
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())

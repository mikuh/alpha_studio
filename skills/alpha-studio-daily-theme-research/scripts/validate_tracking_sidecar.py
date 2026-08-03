#!/usr/bin/env python3
"""Validate Alpha Studio's machine-readable daily-theme sidecar contract."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SCHEMA = "alpha.premarket_theme.v2"
EVALUATORS = {"quote", "breadth", "time", "ai", "manual"}
OPERATORS = {"gt", "gte", "lt", "lte", "eq", "contains"}
PLACEHOLDERS = {"未给出", "待确认", "待验证", "TODO"}
CODE_RE = re.compile(r"^[0-9]{6}\.(?:XSHG|XSHE)$")


def nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value.strip() not in PLACEHOLDERS


def text_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(nonempty_text(item) for item in value)


def add(errors: list[str], condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def validate_trigger(trigger: Any, path: str, errors: list[str], seen: set[str]) -> None:
    add(errors, isinstance(trigger, dict), f"{path} must be an object")
    if not isinstance(trigger, dict):
        return
    trigger_id = trigger.get("id")
    add(errors, nonempty_text(trigger_id), f"{path}.id is required")
    if nonempty_text(trigger_id):
        add(errors, trigger_id not in seen, f"{path}.id must be globally unique: {trigger_id}")
        seen.add(trigger_id)
    evaluator = trigger.get("evaluator")
    add(errors, evaluator in EVALUATORS, f"{path}.evaluator must be one of {sorted(EVALUATORS)}")
    for field in ("label", "dataSource", "actionOnTrigger", "actionOnFailure"):
        add(errors, nonempty_text(trigger.get(field)), f"{path}.{field} is required")
    add(errors, isinstance(trigger.get("confirmForSeconds"), (int, float)) and trigger["confirmForSeconds"] >= 0,
        f"{path}.confirmForSeconds must be a non-negative number")
    if evaluator == "quote":
        add(errors, nonempty_text(trigger.get("subjectCode")), f"{path}.subjectCode is required for quote rules")
        add(errors, nonempty_text(trigger.get("field")), f"{path}.field is required for quote rules")
    if evaluator in {"quote", "breadth"}:
        add(errors, trigger.get("operator") in OPERATORS, f"{path}.operator must use canonical names {sorted(OPERATORS)}")
        add(errors, trigger.get("threshold") not in (None, ""), f"{path}.threshold is required")
    if evaluator == "time":
        add(errors, trigger.get("operator") in OPERATORS, f"{path}.operator is required for time rules")
        add(errors, trigger.get("threshold") not in (None, "") or nonempty_text(trigger.get("windowStart")),
            f"{path} needs threshold or windowStart")


def validate_payload(payload: Any) -> list[str]:
    errors: list[str] = []
    add(errors, isinstance(payload, dict), "root must be an object")
    if not isinstance(payload, dict):
        return errors
    add(errors, payload.get("schema") == SCHEMA, f"schema must equal {SCHEMA}")
    for field in ("tradeDate", "generatedAt", "dataCutoff", "reportMode", "title", "marketSentiment"):
        add(errors, nonempty_text(payload.get(field)), f"{field} must be a non-placeholder string")

    gate = payload.get("executionGate")
    add(errors, isinstance(gate, dict), "executionGate must be an object")
    if isinstance(gate, dict):
        add(errors, nonempty_text(gate.get("state")), "executionGate.state is required")
        add(errors, text_list(gate.get("todayOnlyDo")), "executionGate.todayOnlyDo must be a non-empty string list")
        add(errors, text_list(gate.get("todayDoNotDo")), "executionGate.todayDoNotDo must be a non-empty string list")
        add(errors, text_list(gate.get("triggerBeforeAction")), "executionGate.triggerBeforeAction must be a non-empty string list")
        add(errors, nonempty_text(gate.get("failureAction")), "executionGate.failureAction is required")

    path = payload.get("capitalAttackPath")
    add(errors, isinstance(path, dict), "capitalAttackPath must be an object")
    if isinstance(path, dict):
        for field in ("primaryRoute", "backupRoute", "invalidationRoute", "todayAttackProbability", "rationale", "actionCondition"):
            add(errors, nonempty_text(path.get(field)), f"capitalAttackPath.{field} is required")

    continuity = payload.get("previousContinuity")
    add(errors, isinstance(continuity, list) and bool(continuity), "previousContinuity must be non-empty")
    if isinstance(continuity, list):
        for index, row in enumerate(continuity):
            add(errors, isinstance(row, dict), f"previousContinuity[{index}] must be an object")
            if isinstance(row, dict):
                for field in ("name", "status", "action", "evidence"):
                    add(errors, nonempty_text(row.get(field)), f"previousContinuity[{index}].{field} is required")
    add(errors, text_list(payload.get("risks")), "risks must be a non-empty string list")
    add(errors, text_list(payload.get("sourceNotes")), "sourceNotes must be a non-empty string list")

    themes = payload.get("themes")
    add(errors, isinstance(themes, list) and bool(themes), "themes must be non-empty")
    seen_trigger_ids: set[str] = set()
    if not isinstance(themes, list):
        return errors
    for theme_index, theme in enumerate(themes):
        prefix = f"themes[{theme_index}]"
        add(errors, isinstance(theme, dict), f"{prefix} must be an object")
        if not isinstance(theme, dict):
            continue
        for field in ("id", "name", "conclusion", "lifecycle", "capitalType", "attackPath", "todayAttackProbability",
                      "researchProbability", "observationWeight", "invalidation", "risk"):
            add(errors, nonempty_text(theme.get(field)), f"{prefix}.{field} is required")
        add(errors, isinstance(theme.get("rank"), int) and theme["rank"] > 0, f"{prefix}.rank must be a positive integer")
        add(errors, theme.get("grade") in {"S", "A", "B", "C"}, f"{prefix}.grade must be S/A/B/C")
        add(errors, text_list(theme.get("todayOnlyDo")), f"{prefix}.todayOnlyDo must be non-empty")
        add(errors, text_list(theme.get("todayDoNotDo")), f"{prefix}.todayDoNotDo must be non-empty")
        holding = theme.get("holdingWindow")
        add(errors, isinstance(holding, dict), f"{prefix}.holdingWindow is required")
        if isinstance(holding, dict):
            for field in ("elapsedTradingDays", "estimatedRemainingWindow", "defaultProtocol"):
                add(errors, nonempty_text(holding.get(field)), f"{prefix}.holdingWindow.{field} is required")
            add(errors, text_list(holding.get("extensionConditions")), f"{prefix}.holdingWindow.extensionConditions must be non-empty")
            add(errors, text_list(holding.get("exitConditions")), f"{prefix}.holdingWindow.exitConditions must be non-empty")
        triggers = theme.get("triggerSpecs")
        add(errors, isinstance(triggers, list) and bool(triggers), f"{prefix}.triggerSpecs must be non-empty")
        theme_trigger_ids: set[str] = set()
        if isinstance(triggers, list):
            for trigger_index, trigger in enumerate(triggers):
                validate_trigger(trigger, f"{prefix}.triggerSpecs[{trigger_index}]", errors, seen_trigger_ids)
                if isinstance(trigger, dict) and nonempty_text(trigger.get("id")):
                    theme_trigger_ids.add(trigger["id"])
        stocks = theme.get("stocks")
        add(errors, isinstance(stocks, list) and bool(stocks), f"{prefix}.stocks must be non-empty")
        if isinstance(stocks, list):
            for stock_index, stock in enumerate(stocks):
                stock_path = f"{prefix}.stocks[{stock_index}]"
                add(errors, isinstance(stock, dict), f"{stock_path} must be an object")
                if not isinstance(stock, dict):
                    continue
                for field in ("name", "role", "authenticity"):
                    add(errors, nonempty_text(stock.get(field)), f"{stock_path}.{field} is required")
                add(errors, isinstance(stock.get("code"), str) and bool(CODE_RE.fullmatch(stock["code"])),
                    f"{stock_path}.code must be exchange-qualified, e.g. 600000.XSHG")
                add(errors, isinstance(stock.get("roleRank"), int) and stock["roleRank"] > 0,
                    f"{stock_path}.roleRank must be a positive integer")
                trigger_ids = stock.get("triggerIds")
                add(errors, text_list(trigger_ids), f"{stock_path}.triggerIds must bind the stock to report conditions")
                if isinstance(trigger_ids, list):
                    for trigger_id in trigger_ids:
                        add(errors, trigger_id in theme_trigger_ids, f"{stock_path}.triggerIds references unknown id: {trigger_id}")
                add(errors, text_list(stock.get("entryConditions")), f"{stock_path}.entryConditions must be non-empty")
                add(errors, text_list(stock.get("invalidationConditions")), f"{stock_path}.invalidationConditions must be non-empty")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sidecar", type=Path)
    args = parser.parse_args()
    try:
        payload = json.loads(args.sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "errors": [str(error)]}, ensure_ascii=False, indent=2))
        return 1
    errors = validate_payload(payload)
    print(json.dumps({"ok": not errors, "schema": SCHEMA, "errors": errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Validate the Alpha Studio alpha.company_thesis.v1 interchange contract."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

STATUSES = {"building", "strengthened", "unchanged", "weakened", "invalidated", "archived"}
ARRAYS = ("coreThesis", "keyMetrics", "valuationAssumptions", "catalysts", "risks", "disconfirmingEvidence", "invalidationConditions", "evidenceIds", "changeSummary")


def iso8601(value: object) -> bool:
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return isinstance(value, str) and bool(value)
    except ValueError:
        return False


def validate(payload: object) -> list[str]:
    if not isinstance(payload, dict) or payload.get("schema") != "alpha.company_thesis.v1":
        return ["schema must be alpha.company_thesis.v1"]
    theses = payload.get("theses")
    if not isinstance(theses, list) or not theses:
        return ["theses must be a non-empty array"]
    errors: list[str] = []
    for index, thesis in enumerate(theses):
        prefix = f"theses[{index}]"
        if not isinstance(thesis, dict):
            errors.append(f"{prefix} must be an object")
            continue
        company = thesis.get("company")
        if not isinstance(company, dict) or not all(isinstance(company.get(k), str) and company[k].strip() for k in ("code", "name")):
            errors.append(f"{prefix}.company needs code and name")
        if thesis.get("status") not in STATUSES:
            errors.append(f"{prefix}.status is invalid")
        if not isinstance(thesis.get("version"), int) or thesis["version"] < 1:
            errors.append(f"{prefix}.version must be a positive integer")
        for field in ("id",):
            if not isinstance(thesis.get(field), str) or not thesis[field].strip():
                errors.append(f"{prefix}.{field} must be a non-empty string")
        for field in ("asOf", "dataCutoff", "nextReviewAt"):
            if not iso8601(thesis.get(field)):
                errors.append(f"{prefix}.{field} must be ISO 8601")
        for field in ARRAYS:
            value = thesis.get(field)
            if not isinstance(value, list):
                errors.append(f"{prefix}.{field} must be an array")
        if isinstance(thesis.get("risks"), list) and not thesis["risks"]:
            errors.append(f"{prefix}.risks cannot be empty")
        if isinstance(thesis.get("invalidationConditions"), list) and not thesis["invalidationConditions"]:
            errors.append(f"{prefix}.invalidationConditions cannot be empty")
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_thesis.py RECORD.json", file=sys.stderr)
        return 2
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(payload)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"valid alpha.company_thesis.v1: {len(payload['theses'])} thesis record(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the Alpha Studio alpha.evidence.v1 interchange contract."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

REQUIRED_TIMES = ("occurredAt", "publishedAt", "ingestedAt", "earliestTradableAt")


def iso8601(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict) or payload.get("schema") != "alpha.evidence.v1":
        return ["schema must be alpha.evidence.v1"]
    records = payload.get("records")
    if not isinstance(records, list) or not records:
        return ["records must be a non-empty array"]
    for index, record in enumerate(records):
        prefix = f"records[{index}]"
        if not isinstance(record, dict):
            errors.append(f"{prefix} must be an object")
            continue
        for field in ("id", "eventType", "contentHash"):
            if not isinstance(record.get(field), str) or not record[field].strip():
                errors.append(f"{prefix}.{field} must be a non-empty string")
        for field in REQUIRED_TIMES:
            if not iso8601(record.get(field)):
                errors.append(f"{prefix}.{field} must be ISO 8601")
        if iso8601(record.get("publishedAt")) and iso8601(record.get("earliestTradableAt")):
            published = datetime.fromisoformat(record["publishedAt"].replace("Z", "+00:00"))
            tradable = datetime.fromisoformat(record["earliestTradableAt"].replace("Z", "+00:00"))
            if tradable < published:
                errors.append(f"{prefix}.earliestTradableAt cannot precede publishedAt")
        source = record.get("source")
        if not isinstance(source, dict) or not all(isinstance(source.get(k), str) and source[k].strip() for k in ("title", "url", "kind", "authority")):
            errors.append(f"{prefix}.source needs title, url, kind, authority")
        for field in ("subjectCodes", "facts", "interpretations", "contradictions", "qualityFlags"):
            value = record.get(field)
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                errors.append(f"{prefix}.{field} must be a string array")
        confidence = record.get("confidence")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
            errors.append(f"{prefix}.confidence must be between 0 and 1")
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_evidence.py RECORD.json", file=sys.stderr)
        return 2
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(payload)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"valid alpha.evidence.v1: {len(payload['records'])} record(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

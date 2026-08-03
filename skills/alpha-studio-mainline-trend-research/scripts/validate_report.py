#!/usr/bin/env python3
"""Validate a formal mainline HTML report and its tracking sidecar."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


REQUIRED_HTML_MARKERS = (
    "今日主线结论",
    "主线重仓权限",
    "多因子边际共振总表",
    "政策方向",
    "定向信贷",
    "长线机构资金",
    "海外产业景气",
    "伪题材过滤",
    "最大证据缺口",
    "不构成证券投资",
)
ALLOWED_PERMISSIONS = {
    "允许重仓主线核心",
    "共振成立，重仓权限待执行闸门确认",
    "中等仓位参与",
    "轻仓验证",
    "禁止重仓，仅观察脉冲",
    "不参与",
}
ALLOWED_STATES = {"主升共振", "趋势候选", "部分共振", "单因子脉冲", "未形成主线"}


def validate_html(path: Path, *, brief: bool = False) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    pages = len(re.findall(r'<section\s+class="[^"]*\bpage\b', text))
    minimum, maximum = (1, 3) if brief else (8, 12)
    if not minimum <= pages <= maximum:
        label = "brief" if brief else "formal report"
        errors.append(f"{label} must contain {minimum}-{maximum} A4 pages; found {pages}")
    for marker in REQUIRED_HTML_MARKERS:
        if marker not in text:
            errors.append(f"missing HTML marker: {marker}")
    unresolved = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", text)))
    if unresolved:
        errors.append(f"unresolved template placeholders: {', '.join(unresolved[:12])}")
    if "N/A（不计分、不扣分）" not in text and "overseas-gate-on" not in text:
        errors.append("report must show an overseas gate decision")
    return errors


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_tracking(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"tracking JSON is invalid: {exc}"]
    if payload.get("schema") != "alpha.mainline_trend.v1":
        errors.append("tracking schema must be alpha.mainline_trend.v1")
    for key in ("tradeDate", "generatedAt", "dataCutoff", "mode", "overallConclusion"):
        if not nonempty_string(payload.get(key)):
            errors.append(f"tracking field must be non-empty: {key}")
    if payload.get("heavyPositionPermission") not in ALLOWED_PERMISSIONS:
        errors.append("tracking has invalid heavyPositionPermission")
    mainlines = payload.get("mainlines")
    if not isinstance(mainlines, list) or not mainlines:
        errors.append("tracking mainlines must be a non-empty array")
        return errors
    for index, mainline in enumerate(mainlines):
        prefix = f"mainlines[{index}]"
        for key in ("id", "name", "falseThemeFilter", "largestEvidenceGap"):
            if not nonempty_string(mainline.get(key)):
                errors.append(f"{prefix}.{key} must be non-empty")
        if mainline.get("resonanceState") not in ALLOWED_STATES:
            errors.append(f"{prefix}.resonanceState is invalid")
        if mainline.get("heavyPositionPermission") not in ALLOWED_PERMISSIONS:
            errors.append(f"{prefix}.heavyPositionPermission is invalid")
        pillars = mainline.get("pillars")
        if not isinstance(pillars, dict):
            errors.append(f"{prefix}.pillars must be an object")
            continue
        for pillar in ("policy", "directedCredit", "longTermCapital", "overseasCycle"):
            if pillar not in pillars:
                errors.append(f"{prefix}.pillars missing {pillar}")
        scope = mainline.get("pricingScope")
        overseas = pillars.get("overseasCycle", {})
        if scope == "domestic" and overseas.get("active") is not False:
            errors.append(f"{prefix} domestic track must disable overseasCycle")
        if scope in {"global", "mixed"} and overseas.get("active") is not True:
            errors.append(f"{prefix} global/mixed track must enable overseasCycle")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    parser.add_argument("--tracking", type=Path, required=True)
    parser.add_argument("--brief", action="store_true", help="accept a 1-3 page quick brief")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        errors = validate_html(args.html, brief=args.brief) + validate_tracking(args.tracking)
    except OSError as exc:
        print(f"validate_report: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Mainline report validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

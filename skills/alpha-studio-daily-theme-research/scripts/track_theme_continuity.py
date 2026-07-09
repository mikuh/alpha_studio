#!/usr/bin/env python3
"""Track continuity between prior Alpha Studio themes and current scores."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ACTIONABLE_VERDICTS = {"core_only", "do_on_trigger", "hold_only"}
OPEN_STATUSES = {"active", "watch", "hold_only", "exit_review", "unknown", ""}
GRADE_RANK = {"S": 4, "A": 3, "B": 2, "C": 1, "": 0}


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[\s/_\-·]+", "", value).lower()


def aliases(item: dict) -> set[str]:
    values = {normalize_name(str(item.get("name", "")))}
    for key in ("aliases", "related_names"):
        for alias in item.get(key, []) or []:
            values.add(normalize_name(str(alias)))
    return {value for value in values if value}


def verdict(item: dict) -> str:
    gate = item.get("execution_gate") or {}
    return str(gate.get("today_verdict", item.get("today_verdict", "")))


def verdict_label(item: dict) -> str:
    gate = item.get("execution_gate") or {}
    return str(gate.get("today_verdict_label", item.get("today_verdict_label", "")))


def stage(item: dict) -> str:
    return str(item.get("lifecycle_stage", item.get("stage", "")))


def grade(item: dict) -> str:
    return str(item.get("grade", "")).upper()


def score(item: dict) -> float:
    try:
        return float(item.get("score", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def remaining_window(item: dict) -> str:
    holding = item.get("holding_window") or {}
    return str(holding.get("estimated_remaining_trading_days", ""))


def is_zero_window(item: dict) -> bool:
    text = remaining_window(item).strip().lower()
    return text in {"0", "0-0", "intraday", "none"}


def is_previous_open(item: dict) -> bool:
    status = str(item.get("status", item.get("previous_status", "unknown")))
    last_verdict = str(item.get("last_verdict", item.get("today_verdict", "")))
    if status in {"closed", "ended", "end"}:
        return False
    if status in OPEN_STATUSES:
        return True
    return last_verdict in ACTIONABLE_VERDICTS or bool(item.get("carryover_exposure"))


def current_index(current: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for item in current:
        for name in aliases(item):
            index[name] = item
    return index


def previous_status(item: dict) -> str:
    return str(item.get("status", item.get("previous_status", "unknown")) or "unknown")


def previous_grade(item: dict) -> str:
    return str(item.get("last_grade", item.get("grade", ""))).upper()


def previous_score(item: dict) -> float:
    try:
        return float(item.get("last_score", item.get("score", 0)) or 0)
    except (TypeError, ValueError):
        return 0.0


def evidence_summary(current: dict | None) -> str:
    if current is None:
        return "not present in current ranked themes; direct evidence review required"
    parts = [
        f"grade {grade(current) or 'NA'}",
        f"score {score(current):.1f}",
        f"stage {stage(current) or 'NA'}",
        f"gate {verdict_label(current) or verdict(current) or 'NA'}",
    ]
    if remaining_window(current):
        parts.append(f"remaining {remaining_window(current)}")
    return ", ".join(parts)


def continuity_for_previous(prev: dict, current: dict | None) -> dict:
    name = str(prev.get("name", current.get("name") if current else ""))
    prev_grade = previous_grade(prev)
    prev_score = previous_score(prev)
    prev_verdict = str(prev.get("last_verdict", ""))
    prev_status = previous_status(prev)

    if current is None:
        if prev_status == "exit_review":
            status = "end"
            label = "结束"
            carryover = "上一期已进入退出复核，今日仍无回流证据；关闭主动跟踪，仅低频观察"
            close_reason = "prior exit-review theme remains absent from current ranked themes"
            next_review = "low-frequency watch only unless a new catalyst restarts the cycle"
        else:
            status = "missing_review"
            label = "缺席复核"
            carryover = "无仓不新开；已有观察仓降级管理，等待直接证据复核"
            close_reason = "today's ranked themes do not include this prior active theme"
            next_review = "09:30-10:00 leader/breadth/central-capacity check and close review"
    else:
        current_verdict = verdict(current)
        current_stage = stage(current)
        score_drop = prev_score - score(current)
        grade_down = GRADE_RANK.get(grade(current), 0) < GRADE_RANK.get(prev_grade, 0)

        if current_stage == "retreat" or current_verdict in {"reduce_exit", "forbidden"} or is_zero_window(current):
            status = "reduce_exit"
            label = "减仓退出"
            carryover = "已有观察仓按开盘/反抽纪律退出；无仓不新开"
            close_reason = "retreat/forbidden gate or remaining window exhausted"
            next_review = "open strength/rebound exit and close confirmation"
        elif current_verdict == "hold_only" or score_drop >= 15 or grade_down or current_verdict == "observe_only":
            status = "downgrade_watch"
            label = "降级观察"
            carryover = "已有观察仓降级减仓或仅持核心；无仓不新开"
            close_reason = "score/gate weakened versus prior report"
            next_review = "auction + first 30 minutes + close"
        else:
            status = "continue"
            label = "继续"
            carryover = "按角色持有协议继续复核；只在触发条件满足时新增"
            close_reason = ""
            next_review = "auction + breadth + close"

        if prev_verdict in ACTIONABLE_VERDICTS and current_verdict not in ACTIONABLE_VERDICTS and status == "continue":
            status = "downgrade_watch"
            label = "降级观察"
            carryover = "昨日可做降为观察；已有观察仓降低风险"
            close_reason = "actionable gate was not preserved"
            next_review = "re-confirm before any new action"

    return {
        "name": name,
        "previous_status": previous_status(prev),
        "previous_verdict": prev_verdict,
        "continuity_status": status,
        "continuity_label": label,
        "today_verdict_label": verdict_label(current) if current else "",
        "carryover_action": carryover,
        "evidence_summary": evidence_summary(current),
        "close_reason": close_reason,
        "next_review": next_review,
        "current": current or {},
        "previous": prev,
    }


def continuity_for_new(current: dict) -> dict:
    current_verdict = verdict(current)
    if current_verdict in {"forbidden", "reduce_exit"}:
        label = "新进观察"
        status = "new_watch"
        carryover = "无仓不新开，仅记录是否形成新周期"
    elif current_verdict == "observe_only":
        label = "新进观察"
        status = "new_watch"
        carryover = "等待确认，不做开盘抢入"
    else:
        label = "新进"
        status = "new"
        carryover = "定义触发、失效和下一次复核；满足条件后才进入观察仓"

    return {
        "name": str(current.get("name", "")),
        "previous_status": "none",
        "previous_verdict": "",
        "continuity_status": status,
        "continuity_label": label,
        "today_verdict_label": verdict_label(current),
        "carryover_action": carryover,
        "evidence_summary": evidence_summary(current),
        "close_reason": "",
        "next_review": "next pre-market and intraday trigger review",
        "current": current,
        "previous": {},
    }


def ledger_status(entry: dict) -> str:
    status = entry["continuity_status"]
    if status == "end":
        return "closed"
    if status == "reduce_exit":
        return "exit_review"
    if status == "missing_review":
        return "exit_review"
    if status in {"downgrade_watch", "new_watch"}:
        return "watch"
    return "active"


def next_ledger_entry(entry: dict, report_date: str) -> dict:
    current = entry.get("current") or {}
    previous = entry.get("previous") or {}
    return {
        "name": entry["name"],
        "status": ledger_status(entry),
        "last_report_date": report_date,
        "last_verdict": verdict(current) or previous.get("last_verdict", ""),
        "last_grade": grade(current) or previous.get("last_grade", ""),
        "last_score": score(current) if current else previous_score(previous),
        "last_lifecycle_stage": stage(current) or previous.get("last_lifecycle_stage", ""),
        "carryover_exposure": previous.get("carryover_exposure", "observation"),
        "opened_on": previous.get("opened_on", report_date),
        "allowed_roles": previous.get("allowed_roles", []),
        "planned_exit_conditions": previous.get("planned_exit_conditions", []),
        "next_review": entry["next_review"],
        "continuity_status": entry["continuity_status"],
        "continuity_label": entry["continuity_label"],
        "carryover_action": entry["carryover_action"],
    }


def summarize(entries: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for entry in entries:
        key = entry["continuity_status"]
        counts[key] = counts.get(key, 0) + 1
    return counts


def load_json(path: str | None):
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def load_previous(args: argparse.Namespace, data: dict) -> list[dict]:
    if args.previous:
        previous_data = load_json(args.previous)
        if isinstance(previous_data, dict):
            return previous_data.get("active_theme_ledger", previous_data.get("previous_theme_ledger", previous_data.get("themes", [])))
        return previous_data
    return data.get("previous_theme_ledger", data.get("active_theme_ledger_previous", []))


def load_current(data) -> list[dict]:
    if isinstance(data, list):
        return data
    return data.get("theme_scores", data.get("scored_themes", data.get("themes", [])))


def track(previous: list[dict], current: list[dict], report_date: str) -> dict:
    index = current_index(current)
    used: set[int] = set()
    entries: list[dict] = []

    for prev in previous:
        if not is_previous_open(prev):
            continue
        match = None
        for name in aliases(prev):
            if name in index:
                match = index[name]
                break
        if match is not None:
            used.add(id(match))
        entries.append(continuity_for_previous(prev, match))

    for item in current:
        if id(item) in used:
            continue
        entries.append(continuity_for_new(item))

    return {
        "theme_continuity": entries,
        "active_theme_ledger": [next_ledger_entry(entry, report_date) for entry in entries if ledger_status(entry) != "closed"],
        "summary": summarize(entries),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    parser.add_argument("--previous", help="Previous active theme ledger JSON")
    parser.add_argument("--report-date", help="Report date for next ledger entries")
    args = parser.parse_args()
    data = load_json(args.input)
    previous = load_previous(args, data if isinstance(data, dict) else {})
    current = load_current(data)
    report_date = args.report_date or (data.get("date", "") if isinstance(data, dict) else "")
    print(json.dumps(track(previous, current, report_date), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Score stock industry-chain authenticity for Alpha Studio reports."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


HIGH_QUALITY_SOURCES = {
    "annual_report",
    "prospectus",
    "filing",
    "exchange_filing",
    "announcement",
    "official",
    "company_official",
}
MID_QUALITY_SOURCES = {"broker_research", "research", "reliable_media", "media", "industry_report"}
LOW_QUALITY_SOURCES = {"concept_tag", "board_tag", "social", "rumor", "interactive_vague"}
VALID_DISPLAY_LEVELS = {"A", "A-", "B+", "B", "C+", "C", "D"}
RATING_NOTE = (
    "评级说明：A/A-为官方证据强且产业链位置清晰；B/B+为产业链相关但收入、订单或权重仍需确认；"
    "C为概念映射；D为弱相关或待验证，不能作为中军/趋势核心依据。"
)


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def text_blob(stock: dict) -> str:
    parts: list[str] = []
    for key in (
        "name",
        "theme",
        "business_link",
        "industry_chain_position",
        "revenue_order_customer_evidence",
        "evidence_summary",
    ):
        value = stock.get(key)
        if value:
            parts.append(str(value))
    relevance = stock.get("supply_chain_relevance") or {}
    for key in ("business_link", "industry_chain_position", "revenue_order_customer_evidence"):
        value = relevance.get(key)
        if value:
            parts.append(str(value))
    for source in stock.get("evidence_sources", relevance.get("evidence_sources", [])) or []:
        parts.append(str(source))
    return " ".join(parts)


def boolish(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "有", "是"}


def source_quality(stock: dict) -> str:
    relevance = stock.get("supply_chain_relevance") or {}
    value = stock.get("source_quality", relevance.get("source_quality", "unknown"))
    return str(value).strip().lower()


def official_score(stock: dict, source: str) -> float:
    if boolish(stock.get("official_evidence")) or source in HIGH_QUALITY_SOURCES:
        return 30
    if source in MID_QUALITY_SOURCES:
        return 18
    if source in LOW_QUALITY_SOURCES:
        return 5
    return 0


def product_match_score(stock: dict, blob: str) -> float:
    match = str(stock.get("product_match", "")).strip().lower()
    if match in {"direct", "core", "直接", "核心"}:
        return 20
    if match in {"adjacent", "related", "partial", "相关", "部分"}:
        return 12
    if match in {"generic", "concept", "mapping", "概念"}:
        return 5
    direct_words = ["产品", "设备", "材料", "封装", "测试", "订单", "客户", "产能", "供应", "收入"]
    if any(word in blob for word in direct_words):
        return 12
    return 0


def materiality_score(stock: dict, blob: str) -> float:
    pct = stock.get("revenue_exposure_pct")
    try:
        pct_value = float(pct)
    except (TypeError, ValueError):
        pct_value = None
    if pct_value is not None:
        if pct_value >= 20:
            return 20
        if pct_value >= 5:
            return 14
        if pct_value > 0:
            return 7
    materiality = str(stock.get("revenue_materiality", "")).strip().lower()
    if materiality in {"high", "material", "核心", "高"}:
        return 20
    if materiality in {"medium", "partial", "中", "部分"}:
        return 12
    if materiality in {"low", "tiny", "小", "很小"}:
        return 5
    negative_phrases = ["未提供", "无直接", "没有", "缺少", "待核", "待验证", "未见"]
    if any(phrase in blob for phrase in negative_phrases):
        return 0
    if boolish(stock.get("order_or_customer_evidence")) or any(word in blob for word in ["订单", "客户", "收入", "营收", "合同"]):
        return 12
    return 0


def recency_source_score(source: str) -> float:
    if source in HIGH_QUALITY_SOURCES:
        return 15
    if source in MID_QUALITY_SOURCES:
        return 10
    if source in LOW_QUALITY_SOURCES:
        return 2
    return 0


def role_consistency_score(stock: dict, relevance_label_hint: str = "") -> float:
    role = str(stock.get("role", "")).strip().lower()
    if role in {"central_capacity", "trend_core", "中军", "趋势核心"}:
        return 10 if relevance_label_hint in {"产业链核心", "产业链相关"} else 0
    if role in {"leader", "emotion_core", "arbitrage", "laggard", "龙头", "情绪核心", "套利", "补涨"}:
        return 6
    return 4


def risk_penalty(stock: dict, source: str) -> tuple[float, list[str]]:
    flags: list[str] = []
    penalty = 0.0
    clarification = str(stock.get("clarification", "")).strip().lower()
    if clarification in {"denied", "deny", "否认", "澄清无关"}:
        penalty += 25
        flags.append("company clarification denies or weakens the theme link")
    elif clarification in {"weakened", "weak", "淡化"}:
        penalty += 14
        flags.append("company clarification weakens the theme link")
    if boolish(stock.get("only_concept_tag")) or source in {"concept_tag", "board_tag"}:
        penalty += 18
        flags.append("only concept-board/tag evidence")
    if boolish(stock.get("vague_interactive_answer")) or source == "interactive_vague":
        penalty += 12
        flags.append("vague investor-interaction style evidence")
    if boolish(stock.get("name_association_only")):
        penalty += 20
        flags.append("name association only")
    return min(25, penalty), flags


def label_for(score: float, has_any_evidence: bool, cap_concept: bool) -> str:
    if cap_concept and has_any_evidence and score <= 0:
        return "蹭概念/弱相关"
    if not has_any_evidence or score <= 0:
        return "待验证"
    if cap_concept and score > 39:
        score = 39
    if score >= 80:
        return "产业链核心"
    if score >= 60:
        return "产业链相关"
    if score >= 40:
        return "概念映射"
    return "蹭概念/弱相关"


def evidence_level(label: str, source: str) -> str:
    if label == "产业链核心" and source in HIGH_QUALITY_SOURCES:
        return "A"
    if label in {"产业链核心", "产业链相关"}:
        return "B"
    if label == "概念映射":
        return "C"
    return "D"


def role_permission(label: str) -> str:
    if label == "产业链核心":
        return "can_be_core"
    if label == "产业链相关":
        return "can_be_related"
    if label == "概念映射":
        return "emotion_arbitrage_only"
    if label == "蹭概念/弱相关":
        return "observe_only"
    return "observe_only"


def compact_label(label: str, level: str) -> str:
    if label in {"待验证", "蹭概念/弱相关"}:
        return "D"
    return level if level in VALID_DISPLAY_LEVELS else "D"


def score_stock(stock: dict) -> dict:
    source = source_quality(stock)
    blob = text_blob(stock)
    penalty, risk_flags = risk_penalty(stock, source)
    source_points = official_score(stock, source)
    product_points = product_match_score(stock, blob)
    materiality_points = materiality_score(stock, blob)
    recency_points = recency_source_score(source)
    has_any_evidence = bool(blob.strip()) or source_points > 0 or product_points > 0 or materiality_points > 0

    preliminary_label = "产业链相关" if source_points + product_points + materiality_points >= 45 else ""
    role_points = role_consistency_score(stock, preliminary_label)
    raw_score = source_points + product_points + materiality_points + recency_points + role_points - penalty
    cap_concept = boolish(stock.get("only_concept_tag")) or source in LOW_QUALITY_SOURCES
    relevance_score = round(clamp(raw_score), 1)
    label = label_for(relevance_score, has_any_evidence, cap_concept)
    if cap_concept and label not in {"待验证", "蹭概念/弱相关"}:
        label = "蹭概念/弱相关" if relevance_score < 40 else "概念映射"
    level = evidence_level(label, source)
    permission = role_permission(label)
    compact = compact_label(label, level)
    name = stock.get("name", "")

    return {
        "name": name,
        "theme": stock.get("theme", ""),
        "role": stock.get("role", ""),
        "relevance_score": relevance_score,
        "relevance_label": label,
        "evidence_level": level,
        "compact_relevance_label": compact,
        "display_name": f"{name}（{compact}）" if name else "",
        "industry_chain_position": stock.get("industry_chain_position", ""),
        "business_link": stock.get("business_link", ""),
        "revenue_order_customer_evidence": stock.get("revenue_order_customer_evidence", ""),
        "evidence_sources": stock.get("evidence_sources", []),
        "concept_risk_flag": label in {"概念映射", "蹭概念/弱相关", "待验证"},
        "role_permission": permission,
        "risk_flags": risk_flags,
        "raw": {
            "official_business_evidence": source_points,
            "product_match": product_points,
            "materiality": materiality_points,
            "source_recency_quality": recency_points,
            "role_consistency": role_points,
            "risk_penalty": penalty,
            "source_quality": source,
        },
    }


def extract_stocks(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if "stocks" in data:
        return data["stocks"]
    stocks: list[dict] = []
    for theme in data.get("themes", []):
        theme_name = theme.get("name", "")
        for stock in theme.get("stocks", []) or []:
            item = dict(stock)
            item.setdefault("theme", theme_name)
            stocks.append(item)
    return stocks


def load_json(path: str | None):
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text)


def summarize(scored: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for item in scored:
        label = item["relevance_label"]
        counts[label] = counts.get(label, 0) + 1
    return counts


def grouped_display(scored: list[dict]) -> list[dict]:
    """Group stocks at the same theme/role for compact matrix cells."""

    grouped: dict[tuple[str, str], list[str]] = {}
    for item in scored:
        key = (item.get("theme", ""), item.get("role", ""))
        display_name = item.get("display_name") or item.get("name", "")
        if display_name:
            grouped.setdefault(key, []).append(display_name)
    return [
        {
            "theme": theme,
            "role": role,
            "stock_cell": "、".join(names),
        }
        for (theme, role), names in grouped.items()
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", help="JSON input file; defaults to stdin")
    args = parser.parse_args()
    stocks = extract_stocks(load_json(args.input))
    scored = [score_stock(stock) for stock in stocks]
    print(
        json.dumps(
            {
                "stock_relevance": scored,
                "grouped_stock_cells": grouped_display(scored),
                "rating_note": RATING_NOTE,
                "summary": summarize(scored),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

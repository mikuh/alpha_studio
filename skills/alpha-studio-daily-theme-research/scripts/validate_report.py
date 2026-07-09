#!/usr/bin/env python3
"""Validate an Alpha Studio printable HTML report.

Optionally pass Markdown and structured input snapshots for stronger checks.
"""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


class BasicHTMLValidator(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.errors: list[str] = []

    def error(self, message: str) -> None:  # pragma: no cover - kept for parser API compatibility
        self.errors.append(message)


def validate(path: Path, expected_pages: int | None) -> dict:
    text = path.read_text(encoding="utf-8")
    parser = BasicHTMLValidator()
    parser.feed(text)
    pages = len(re.findall(r'<section\b[^>]*class="[^"]*\bpage\b', text))
    footers = re.findall(r">\s*(?:Page\s+)?\d+\s*/\s*\d+\s*<", text)
    footer_brands = re.findall(r'class="[^"]*\bfooter-brand\b', text)
    issues: list[str] = []

    if "TODO" in text:
        issues.append("report still contains TODO")
    if "Alpha Studio Research" not in text:
        issues.append("missing Alpha Studio Research branding")
    if expected_pages is not None and pages != expected_pages:
        issues.append(f"expected {expected_pages} pages, found {pages}")
    if pages and len(footers) < pages - 1:
        issues.append("some pages may be missing visible page numbers")
    if pages and len(footer_brands) < pages:
        issues.append("some pages may be missing footer brand lock")
    if "page-break-after: always" in text and "last-of-type" not in text:
        issues.append("last page may force an extra blank PDF page")
    issues.extend(layout_density_issues(text))

    return {
        "file": str(path),
        "ok": not issues and not parser.errors,
        "page_sections": pages,
        "page_footers": len(footers),
        "issues": issues + parser.errors,
    }


def strip_html(text: str) -> str:
    text = re.sub(r"<script\b.*?</script>", "", text, flags=re.S | re.I)
    text = re.sub(r"<style\b.*?</style>", "", text, flags=re.S | re.I)
    return re.sub(r"<[^>]+>", "", text)


def layout_density_issues(html_text: str) -> list[str]:
    """Flag pages that are likely to overflow an A4 frame.

    This is a static heuristic, not a substitute for render QA. It catches the
    common failure mode where a page contains multiple full tables and passes
    page-count validation while the browser clips the lower content.
    """

    issues: list[str] = []
    sections = re.findall(r'(<section\b[^>]*class="[^"]*\bpage\b[^>]*>.*?</section>)', html_text, flags=re.S)
    for page_num, section in enumerate(sections, start=1):
        class_match = re.search(r'<section\b[^>]*class="([^"]+)"', section)
        class_name = class_match.group(1) if class_match else ""
        if "cover" in class_name:
            continue
        body_match = re.search(r'<div class="page-body">(.*?)<div class="footer">', section, flags=re.S)
        body = body_match.group(1) if body_match else section
        compact_chars = len(re.sub(r"\s+", "", strip_html(body)))
        table_rows = len(re.findall(r"<tr\b", body))
        tables = len(re.findall(r"<table\b", body))
        h2_count = len(re.findall(r"<h2\b", body))
        callouts = len(re.findall(r'class="[^"]*\bcallout\b', body))

        compact = "compact-page" in class_name
        row_limit = 18 if compact else 13
        density_limit = 31 if compact else 24.5
        char_limit = 1500 if compact else 1250
        density = compact_chars / 90 + table_rows * 0.8 + tables * 1.4 + h2_count * 0.8 + callouts * 1.2

        if table_rows > row_limit or compact_chars > char_limit or density > density_limit:
            issues.append(
                "page "
                f"{page_num} may visually overflow "
                f"(chars={compact_chars}, table_rows={table_rows}, tables={tables}, density={density:.1f}); "
                "split content, add a page, or use a verified compact layout"
            )
    return issues


def strip_markdown_code(text: str) -> str:
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "", text)


def has_rating_only_authenticity_label(text: str) -> bool:
    return bool(
        re.search(
            r"[\u4e00-\u9fffA-Za-z0-9]{2,16}\s*[（(]\s*[A-D][+-]?\s*[）)]",
            text,
        )
    )


def has_verbose_authenticity_cell_text(text: str) -> bool:
    return any(
        phrase in text
        for phrase in [
            "证据等级",
            "可作相关核心",
            "可作核心",
            "可作中军",
            "可作趋势核心",
            "产业链相关 /",
            "产业链核心 /",
            "蹭概念/弱相关 /",
        ]
    )


def validate_extended(
    html: Path,
    markdown: Path | None,
    inputs: Path | None,
    expected_pages: int | None,
    allow_placeholders: bool = False,
) -> dict:
    result = validate(html, expected_pages)
    html_text = html.read_text(encoding="utf-8")
    md_text = markdown.read_text(encoding="utf-8") if markdown else ""
    combined = html_text + "\n" + md_text
    check_text = re.sub(r"<!--.*?-->", "", combined, flags=re.S)
    placeholder_scan_text = html_text + "\n" + strip_markdown_code(md_text)
    issues = result["issues"]

    if not allow_placeholders and ("{{" in placeholder_scan_text or "}}" in placeholder_scan_text):
        issues.append("unresolved template placeholder")
    if allow_placeholders and not markdown and not inputs:
        result["ok"] = not issues
        result["issues"] = issues
        return result
    if "研究概率" not in check_text:
        issues.append("missing 研究概率 label")
    if "今日进攻概率" not in check_text:
        issues.append("missing 今日进攻概率 label")
    if "资金进攻路径" not in check_text and "今日资金进攻路径" not in check_text:
        issues.append("missing 资金进攻路径 section")
    if "隔夜全球线索" not in check_text and "overnight" not in check_text.lower():
        issues.append("missing 隔夜全球线索 section")
    if "观察权重" not in check_text:
        issues.append("missing 观察权重 label")
    if "情绪指标" not in check_text and "sentiment indicator" not in check_text.lower():
        issues.append("missing 情绪指标 dashboard")
    if "今日只做" not in check_text:
        issues.append("missing 今日只做 execution instruction")
    if "今日不做" not in check_text:
        issues.append("missing 今日不做 forbidden instruction")
    if "预计剩余窗口" not in check_text:
        issues.append("missing 预计剩余窗口 duration instruction")
    if not any(label in check_text for label in ["持有复核", "持有窗口", "隔夜持有"]):
        issues.append("missing theme holding review section")
    if "预计剩余窗口" in check_text and not any(label in check_text for label in ["模型估计", "历史样本", "混合估计"]):
        issues.append("missing duration estimate basis label")
    if not has_rating_only_authenticity_label(check_text):
        issues.append("missing rating-only stock authenticity suffix labels")
    if has_verbose_authenticity_cell_text(check_text):
        issues.append("stock authenticity text is too verbose; use stock（A/B/C/D） in 标的 cell and move explanations below the table")
    if not any(label in check_text for label in ["龙头 / 中军 / 趋势核心 / 补涨矩阵", "补涨矩阵"]):
        issues.append("missing original stock role matrix title")
    if "确认/失效" not in check_text and "确认失效" not in check_text:
        issues.append("missing stock role confirmation/failure column")
    if "风险提示" not in check_text:
        issues.append("missing 风险提示")
    if not allow_placeholders and len(re.findall(r"https?://", check_text)) < 5:
        issues.append("too few visible source links")

    if inputs:
        data = json.loads(inputs.read_text(encoding="utf-8"))
        market = data.get("market", {})
        score = str(market.get("sentiment_score", market.get("score", "")))
        regime = str(market.get("sentiment_regime", market.get("regime", "")))
        if score and score not in check_text:
            issues.append(f"sentiment score {score} not reflected in report")
        if regime and regime not in check_text:
            issues.append(f"sentiment regime {regime} not reflected in report")
        if market.get("emotion_indicators") and "情绪指标" not in check_text:
            issues.append("emotion indicators present in inputs but missing 情绪指标 section")

        has_multiple_limit_counts = (
            "limit_up_count_media_all_market" in market
            and (
                "limit_up_count_vendor_non_st_pool" in market
                or "limit_up_count_non_st_pool" in market
                or "limit_up_count_vendor_pool" in market
            )
        )
        if has_multiple_limit_counts and "口径" not in check_text:
            issues.append("multiple limit-up counts present but missing 口径 explanation")

        generated_at = str(data.get("generated_at", ""))
        after_open = bool(re.search(r"\s(09|1\d|2[0-3]):", generated_at))
        if after_open and not any(label in check_text for label in ["延迟版", "开盘校验", "集合竞价确认", "盘中更新", "复盘"]):
            issues.append("after-open report missing delayed/intraday/post-market label")
        if data.get("report_mode") == "auction_confirmation":
            if "9:25确认结论" not in check_text:
                issues.append("auction-confirmation report missing 9:25确认结论")
            if not any(label in check_text for label in ["主线确认", "触发后轻仓试错", "假强转观察", "冲高兑现", "竞价证伪"]):
                issues.append("auction-confirmation report missing confirmation label")
            if "9:30-9:45" not in check_text:
                issues.append("auction-confirmation report missing 9:30-9:45 secondary confirmation")

        if any(theme.get("stage") == "retreat" or theme.get("lifecycle_stage") == "retreat" for theme in data.get("theme_scores", data.get("themes", []))):
            if "退潮" not in check_text:
                issues.append("retreat theme exists but report does not mention 退潮")

        themes_for_gate = data.get("theme_scores", data.get("themes", []))
        if any(theme.get("execution_gate") for theme in themes_for_gate):
            if "今日只做" not in check_text or "今日不做" not in check_text:
                issues.append("execution gate present in inputs but report does not show do/not-do instructions")
        if any(theme.get("holding_window") for theme in themes_for_gate):
            if "预计剩余窗口" not in check_text:
                issues.append("holding windows present in inputs but report does not show duration/review instructions")
        if any(theme.get("capital_attack_path") or theme.get("probability_attack_today") for theme in themes_for_gate):
            if "今日进攻概率" not in check_text or ("资金进攻路径" not in check_text and "今日资金进攻路径" not in check_text):
                issues.append("capital attack path present in inputs but report does not show attack probability/path")
        if data.get("overnight_global") and "隔夜全球线索" not in check_text and "overnight" not in check_text.lower():
            issues.append("overnight global inputs present but report lacks 隔夜全球线索 section")

        prior_ledger = data.get("previous_theme_ledger", data.get("active_theme_ledger_previous", []))
        continuity = data.get("theme_continuity", [])
        if prior_ledger or continuity:
            if "上一期主题连续跟踪" not in check_text:
                issues.append("previous theme ledger present but report lacks 上一期主题连续跟踪 section")
            if not any(label in check_text for label in ["继续", "降级观察", "减仓退出", "结束", "缺席复核"]):
                issues.append("previous theme ledger present but report lacks continuity status labels")
        if any(item.get("continuity_status") == "missing_review" for item in continuity):
            if "缺席复核" not in check_text:
                issues.append("missing-review continuity exists but report does not mention 缺席复核")
        if any(item.get("continuity_status") in {"reduce_exit", "end"} for item in continuity):
            if not any(label in check_text for label in ["减仓退出", "结束"]):
                issues.append("exit/end continuity exists but report does not show exit/end action")

        stock_relevance = data.get("stock_relevance", [])
        if not stock_relevance:
            for theme in data.get("themes", []):
                for stock in theme.get("stocks", []) or []:
                    if stock.get("supply_chain_relevance"):
                        stock_relevance.append(stock)
        if stock_relevance:
            if not has_rating_only_authenticity_label(check_text):
                issues.append("stock relevance present in inputs but report lacks rating-only authenticity suffix labels")

    result["ok"] = not issues
    result["issues"] = issues
    if markdown:
        result["markdown"] = str(markdown)
    if inputs:
        result["inputs"] = str(inputs)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html")
    parser.add_argument("--markdown", help="Optional Markdown report for text-level checks")
    parser.add_argument("--inputs", help="Optional structured JSON snapshot for consistency checks")
    parser.add_argument("--expected-pages", type=int)
    parser.add_argument("--allow-placeholders", action="store_true", help="Allow template placeholders and sparse sources")
    args = parser.parse_args()
    print(
        json.dumps(
            validate_extended(
                Path(args.html),
                Path(args.markdown) if args.markdown else None,
                Path(args.inputs) if args.inputs else None,
                args.expected_pages,
                args.allow_placeholders,
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

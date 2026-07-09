#!/usr/bin/env python3
"""Fetch a no-dependency Eastmoney market snapshot for Alpha Studio reports.

This helper is a fallback for environments without akshare, pandas, Wind,
Choice, or other richer market-data tooling. It preserves vendor response
fields because public quote endpoints may use date semantics that differ from
the requested trading-day filter.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path


UT = "7eea3edcaed734bea9cbfc24409ed989"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://quote.eastmoney.com/",
}
INDEX_SECIDS = {
    "1.000001": "上证指数",
    "0.399001": "深证成指",
    "0.399006": "创业板指",
    "1.000688": "科创50",
    "1.000985": "中证全指",
    "0.899050": "北证50",
}


def fetch_json(url: str, timeout: int = 15, retries: int = 2) -> dict:
    last_error: Exception | None = None
    request = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8", "ignore"))
        except Exception as exc:  # network/vendor endpoints can be flaky
            last_error = exc
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"request failed after {retries + 1} attempts: {last_error}")


def build_url(base: str, params: dict) -> str:
    params = {**params, "_": int(time.time() * 1000)}
    return f"{base}?{urllib.parse.urlencode(params)}"


def fetch_topic_pool(kind: str, requested_date: str, page_size: int) -> dict:
    page_sizes = [page_size]
    for fallback in (1000, 200, 50):
        if fallback not in page_sizes and fallback < page_size:
            page_sizes.append(fallback)
    errors: list[str] = []
    for size in page_sizes:
        url = build_url(
            f"https://push2ex.eastmoney.com/getTopic{kind}Pool",
            {
                "ut": UT,
                "dpt": "wz.ztzt",
                "Pageindex": 0,
                "pagesize": size,
                "sort": "fbt:asc",
                "date": requested_date,
            },
        )
        try:
            raw = fetch_json(url)
            data = raw.get("data") or {}
            pool = data.get("pool") or []
            return {
                "kind": kind,
                "requested_date": requested_date,
                "vendor_qdate": data.get("qdate"),
                "total": data.get("tc", len(pool)),
                "pool_len": len(pool),
                "pool": pool,
                "page_size_used": size,
                "endpoint": "push2ex.eastmoney.com",
            }
        except Exception as exc:
            errors.append(f"pagesize={size}: {exc}")
    return {
        "kind": kind,
        "requested_date": requested_date,
        "vendor_qdate": None,
        "total": None,
        "pool_len": 0,
        "pool": [],
        "endpoint": "push2ex.eastmoney.com",
        "error": "; ".join(errors),
    }


def fetch_indices() -> list[dict]:
    fields = "f12,f14,f2,f3,f4,f6,f17,f18,f104,f105,f106"
    url = build_url(
        "https://push2.eastmoney.com/api/qt/ulist.np/get",
        {
            "fltt": 2,
            "invt": 2,
            "fields": fields,
            "secids": ",".join(INDEX_SECIDS.keys()),
        },
    )
    raw = fetch_json(url)
    return (raw.get("data") or {}).get("diff") or []


def fetch_boards(fs: str, limit: int) -> list[dict]:
    fields = "f12,f14,f2,f3,f4,f6,f104,f105,f106,f128,f140,f136"
    url = build_url(
        "https://push2.eastmoney.com/api/qt/clist/get",
        {
            "pn": 1,
            "pz": limit,
            "po": 1,
            "np": 1,
            "ut": UT,
            "fltt": 2,
            "invt": 2,
            "fid": "f3",
            "fs": fs,
            "fields": fields,
        },
    )
    raw = fetch_json(url, timeout=20)
    return (raw.get("data") or {}).get("diff") or []


def summarize_pool(zt: dict, dt: dict, zb: dict) -> dict:
    zt_pool = zt.get("pool") or []
    limit_up_count = int(zt.get("total") or len(zt_pool) or 0)
    failed_count = None if zb.get("total") is None else int(zb.get("total") or 0)
    limit_down_count = None if dt.get("total") is None else int(dt.get("total") or 0)
    denom = limit_up_count + failed_count if failed_count is not None else 0
    industries = Counter(item.get("hybk") or "未分类" for item in zt_pool)
    max_height = max((int(item.get("lbc") or 0) for item in zt_pool), default=0)
    consecutive = sum(1 for item in zt_pool if int(item.get("lbc") or 0) >= 2)
    top_boards = sorted(
        zt_pool,
        key=lambda item: (-(int(item.get("lbc") or 0)), item.get("fbt") or 999999),
    )[:30]
    return {
        "limit_up_count_vendor_pool": limit_up_count,
        "limit_down_count_vendor_total": limit_down_count,
        "failed_board_count_vendor_total": failed_count,
        "seal_rate_estimate": round(limit_up_count / denom, 4) if denom else None,
        "failed_board_rate_estimate": round(failed_count / denom, 4) if denom else None,
        "max_board_height": max_height,
        "consecutive_limit_count": consecutive,
        "top_industries_by_limit_up": industries.most_common(20),
        "top_board_stocks": [
            {
                "code": item.get("c"),
                "name": item.get("n"),
                "pct": item.get("zdp"),
                "board_count": item.get("lbc"),
                "industry": item.get("hybk"),
                "first_limit_time": item.get("fbt"),
                "turnover_amount": item.get("amount"),
            }
            for item in top_boards
        ],
    }


def build_snapshot(args: argparse.Namespace) -> dict:
    zt = fetch_topic_pool("ZT", args.date, args.page_size)
    dt = fetch_topic_pool("DT", args.date, args.page_size)
    zb = fetch_topic_pool("ZB", args.date, args.page_size)
    errors = [
        f"{name}: {pool['error']}"
        for name, pool in {"ZT": zt, "DT": dt, "ZB": zb}.items()
        if pool.get("error")
    ]
    try:
        indices = fetch_indices()
    except Exception as exc:
        indices = []
        errors.append(f"indices: {exc}")
    snapshot = {
        "requested_date": args.date,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "Eastmoney push2/push2ex public quote endpoints",
        "errors": errors,
        "notes": [
            "Use as quote-vendor market data, not official exchange data.",
            "requested_date and vendor_qdate may differ; preserve both in reports.",
            "Counts from this pool may differ from media all-market or Wind/Choice口径.",
        ],
        "indices": indices,
        "pools": {
            "limit_up": zt,
            "limit_down": dt,
            "failed_board": zb,
        },
        "summary": summarize_pool(zt, dt, zb),
    }
    if args.with_boards:
        boards = {}
        for name, fs in {"industries": "m:90+t:2", "concepts": "m:90+t:3"}.items():
            try:
                boards[name] = fetch_boards(fs, args.board_limit)
            except Exception as exc:
                boards[name] = []
                errors.append(f"{name}_boards: {exc}")
        snapshot["boards"] = boards
    return snapshot


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Trading date filter in YYYYMMDD format")
    parser.add_argument("--output", "-o", type=Path, help="Write JSON snapshot to this path")
    parser.add_argument("--page-size", type=int, default=10000)
    parser.add_argument("--with-boards", action="store_true", help="Also fetch top industry/concept boards")
    parser.add_argument("--board-limit", type=int, default=30)
    args = parser.parse_args()
    snapshot = build_snapshot(args)
    text = json.dumps(snapshot, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

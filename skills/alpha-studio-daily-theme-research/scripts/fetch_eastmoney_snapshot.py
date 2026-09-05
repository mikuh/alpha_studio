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
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
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

DEFAULT_REQUEST_TIMEOUT_SECONDS = 6.0
DEFAULT_RETRIES = 1
DEFAULT_COLLECTION_BUDGET_SECONDS = 25.0
DEFAULT_WORKERS = 4
RETRYABLE_HTTP_STATUS = {408, 429, 500, 502, 503, 504}
PAGE_SIZE_HTTP_STATUS = {400, 413, 414, 422}


class FetchError(RuntimeError):
    """Base class for bounded snapshot collection failures."""


class FetchPageSizeError(FetchError):
    """The endpoint rejected the requested response/page size."""


class FetchUnavailableError(FetchError):
    """The endpoint is unavailable and page-size fallback cannot help."""


class FetchTransportError(FetchUnavailableError):
    """DNS, TCP, TLS, or socket I/O failed."""


class CollectionBudget:
    def __init__(self, seconds: float):
        self.deadline = time.monotonic() + max(0.1, seconds)

    def request_timeout(self, preferred: float) -> float:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise FetchUnavailableError("market-data collection budget exhausted")
        return max(0.1, min(max(0.1, preferred), remaining))

    def sleep(self, seconds: float) -> None:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise FetchUnavailableError("market-data collection budget exhausted")
        time.sleep(min(seconds, remaining))


class HostCircuitBreaker:
    def __init__(self):
        self._failed_hosts: set[str] = set()
        self._lock = threading.Lock()

    def ensure_available(self, url: str) -> None:
        host = urllib.parse.urlparse(url).hostname or ""
        with self._lock:
            if host in self._failed_hosts:
                raise FetchTransportError(f"host circuit is open for {host}")

    def record_transport_failure(self, url: str) -> None:
        host = urllib.parse.urlparse(url).hostname or ""
        if not host:
            return
        with self._lock:
            self._failed_hosts.add(host)


def fetch_json(
    url: str,
    timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
    *,
    budget: CollectionBudget | None = None,
    circuit_breaker: HostCircuitBreaker | None = None,
) -> dict:
    last_error: Exception | None = None
    request = urllib.request.Request(url, headers=HEADERS)
    retries = max(0, retries)
    for attempt in range(retries + 1):
        if circuit_breaker:
            circuit_breaker.ensure_available(url)
        request_timeout = budget.request_timeout(timeout) if budget else max(0.1, timeout)
        try:
            with urllib.request.urlopen(request, timeout=request_timeout) as response:
                return json.loads(response.read().decode("utf-8", "ignore"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in PAGE_SIZE_HTTP_STATUS:
                raise FetchPageSizeError(f"HTTP {exc.code}") from exc
            if exc.code not in RETRYABLE_HTTP_STATUS or attempt >= retries:
                raise FetchUnavailableError(f"HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as exc:
            last_error = exc
            if attempt >= retries:
                if circuit_breaker:
                    circuit_breaker.record_transport_failure(url)
                raise FetchTransportError(
                    f"transport failed after {attempt + 1} attempt(s): {exc}"
                ) from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise FetchUnavailableError(f"invalid JSON response: {exc}") from exc
        if attempt < retries:
            delay = 0.5 * (attempt + 1)
            if budget:
                budget.sleep(delay)
            else:
                time.sleep(delay)
    raise FetchUnavailableError(
        f"request failed after {retries + 1} attempt(s): {last_error}"
    )


def build_url(base: str, params: dict) -> str:
    params = {**params, "_": int(time.time() * 1000)}
    return f"{base}?{urllib.parse.urlencode(params)}"


def fetch_topic_pool(
    kind: str,
    requested_date: str,
    page_size: int,
    *,
    timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
    budget: CollectionBudget | None = None,
    circuit_breaker: HostCircuitBreaker | None = None,
) -> dict:
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
            raw = fetch_json(
                url,
                timeout=timeout,
                retries=retries,
                budget=budget,
                circuit_breaker=circuit_breaker,
            )
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
        except FetchPageSizeError as exc:
            errors.append(f"pagesize={size}: {exc}")
        except FetchError as exc:
            errors.append(f"pagesize={size}: {exc}")
            break
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


def fetch_indices(
    *,
    timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
    budget: CollectionBudget | None = None,
    circuit_breaker: HostCircuitBreaker | None = None,
) -> list[dict]:
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
    raw = fetch_json(
        url,
        timeout=timeout,
        retries=retries,
        budget=budget,
        circuit_breaker=circuit_breaker,
    )
    return (raw.get("data") or {}).get("diff") or []


def fetch_boards(
    fs: str,
    limit: int,
    *,
    timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
    budget: CollectionBudget | None = None,
    circuit_breaker: HostCircuitBreaker | None = None,
) -> list[dict]:
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
    raw = fetch_json(
        url,
        timeout=timeout,
        retries=retries,
        budget=budget,
        circuit_breaker=circuit_breaker,
    )
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
    request_timeout = min(30.0, max(0.5, float(args.request_timeout)))
    retries = min(2, max(0, int(args.retries)))
    budget = CollectionBudget(float(args.collection_budget))
    circuit_breaker = HostCircuitBreaker()
    workers = min(6, max(1, int(args.workers)))

    pool_args = {
        "timeout": request_timeout,
        "retries": retries,
        "budget": budget,
        "circuit_breaker": circuit_breaker,
    }
    results: dict[str, object] = {}
    task_errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="alpha-market") as executor:
        futures = {
            "ZT": executor.submit(fetch_topic_pool, "ZT", args.date, args.page_size, **pool_args),
            "DT": executor.submit(fetch_topic_pool, "DT", args.date, args.page_size, **pool_args),
            "ZB": executor.submit(fetch_topic_pool, "ZB", args.date, args.page_size, **pool_args),
            "indices": executor.submit(fetch_indices, **pool_args),
        }
        if args.with_boards:
            futures["industries"] = executor.submit(
                fetch_boards, "m:90+t:2", args.board_limit, **pool_args
            )
            futures["concepts"] = executor.submit(
                fetch_boards, "m:90+t:3", args.board_limit, **pool_args
            )
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception as exc:
                task_errors[name] = str(exc)

    def failed_pool(kind: str) -> dict:
        return {
            "kind": kind,
            "requested_date": args.date,
            "vendor_qdate": None,
            "total": None,
            "pool_len": 0,
            "pool": [],
            "endpoint": "push2ex.eastmoney.com",
            "error": task_errors.get(kind, "collection failed"),
        }

    zt = results.get("ZT") or failed_pool("ZT")
    dt = results.get("DT") or failed_pool("DT")
    zb = results.get("ZB") or failed_pool("ZB")
    errors = [
        f"{name}: {pool['error']}"
        for name, pool in {"ZT": zt, "DT": dt, "ZB": zb}.items()
        if pool.get("error")
    ]
    indices = results.get("indices") or []
    if "indices" in task_errors:
        errors.append(f"indices: {task_errors['indices']}")
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
        boards = {
            "industries": results.get("industries") or [],
            "concepts": results.get("concepts") or [],
        }
        for name in ("industries", "concepts"):
            if name in task_errors:
                errors.append(f"{name}_boards: {task_errors[name]}")
        snapshot["boards"] = boards
    return snapshot


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Trading date filter in YYYYMMDD format")
    parser.add_argument("--output", "-o", type=Path, help="Write JSON snapshot to this path")
    parser.add_argument("--page-size", type=int, default=10000)
    parser.add_argument("--with-boards", action="store_true", help="Also fetch top industry/concept boards")
    parser.add_argument("--board-limit", type=int, default=30)
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=DEFAULT_REQUEST_TIMEOUT_SECONDS,
        help="Per-attempt timeout in seconds (default: 6, clamped to 0.5-30)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_RETRIES,
        help="Retries per request (default: 1, clamped to 0-2)",
    )
    parser.add_argument(
        "--collection-budget",
        type=float,
        default=DEFAULT_COLLECTION_BUDGET_SECONDS,
        help="Shared wall-clock budget for all market requests (default: 25 seconds)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Concurrent market requests (default: 4, clamped to 1-6)",
    )
    args = parser.parse_args()
    snapshot = build_snapshot(args)
    text = json.dumps(snapshot, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

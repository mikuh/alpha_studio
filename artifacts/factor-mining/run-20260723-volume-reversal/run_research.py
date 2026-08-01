#!/usr/bin/env python3
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from jqdatasdk import auth, get_extras, get_index_stocks, get_price, get_query_count, get_trade_days

ROOT = Path(__file__).resolve().parent
CONFIG = Path("/Users/geb/.alpha-studio/jqdata-config.json")
INDEX = "000905.XSHG"
START_BUFFER = "2017-11-01"
START = "2018-01-01"
END = "2025-12-31"
END_BUFFER = "2026-02-01"
RNG = np.random.default_rng(20260723)


def dump(name, obj):
    (ROOT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str) + "\n")


def sha256_text(text):
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def rank_ic(frame):
    return frame["factor"].corr(frame["forward_return"], method="spearman")


def pearson_ic(frame):
    return frame["factor"].corr(frame["forward_return"], method="pearson")


def nw_mean_stats(values, max_lag=5):
    x = np.asarray(pd.Series(values).dropna(), dtype=float)
    n = len(x)
    if n < 3:
        return {"n": n, "mean": None, "se_hac": None, "t_hac": None}
    mean = x.mean()
    u = x - mean
    gamma0 = np.dot(u, u) / n
    lrv = gamma0
    lag = min(max_lag, n - 1)
    for k in range(1, lag + 1):
        gamma = np.dot(u[k:], u[:-k]) / n
        lrv += 2 * (1 - k / (lag + 1)) * gamma
    se = math.sqrt(max(lrv, 0) / n)
    return {"n": n, "mean": mean, "se_hac": se, "t_hac": mean / se if se else None}


def block_bootstrap_ci(values, block=10, reps=1000):
    x = np.asarray(pd.Series(values).dropna(), dtype=float)
    n = len(x)
    if n < block:
        return [None, None]
    starts = np.arange(0, n - block + 1)
    means = []
    blocks_needed = math.ceil(n / block)
    for _ in range(reps):
        sample = np.concatenate([x[s:s + block] for s in RNG.choice(starts, blocks_needed)])[:n]
        means.append(sample.mean())
    return [float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))]


def cross_section_process(group):
    g = group.copy()
    x = g["factor_raw"].replace([np.inf, -np.inf], np.nan)
    med = x.median()
    mad = (x - med).abs().median()
    if pd.notna(mad) and mad > 0:
        x = x.clip(med - 5 * mad, med + 5 * mad)
    controls = g[["log_adv20", "volatility20"]].replace([np.inf, -np.inf], np.nan)
    valid = x.notna() & controls.notna().all(axis=1)
    resid = pd.Series(np.nan, index=g.index)
    if valid.sum() >= 20:
        X = controls.loc[valid].to_numpy(dtype=float)
        X = np.column_stack([np.ones(len(X)), X])
        y = x.loc[valid].to_numpy(dtype=float)
        beta = np.linalg.lstsq(X, y, rcond=None)[0]
        resid.loc[valid] = y - X @ beta
    g["factor_winsorized"] = x
    g["factor"] = resid.rank(pct=True) - 0.5
    return g


def split_name(date):
    year = pd.Timestamp(date).year
    if year <= 2021:
        return "discovery"
    if year <= 2023:
        return "validation"
    return "final_holdout"


def summarize(panel, label):
    daily = panel.groupby("date", sort=True).apply(
        lambda g: pd.Series({"rank_ic": rank_ic(g), "pearson_ic": pearson_ic(g)}),
        include_groups=False,
    )
    rank = daily["rank_ic"].dropna()
    pearson = daily["pearson_ic"].dropna()
    quantile_returns = {}
    q_spreads = []
    for date, g in panel.groupby("date", sort=True):
        if len(g) < 50:
            continue
        q = pd.qcut(g["factor"].rank(method="first"), 5, labels=False)
        means = g.groupby(q)["forward_return"].mean()
        if len(means) == 5:
            q_spreads.append(means.iloc[-1] - means.iloc[0])
            for k, v in means.items():
                quantile_returns.setdefault(str(int(k) + 1), []).append(float(v))
    return {
        "sample": label,
        "rows": int(len(panel)),
        "dates": int(panel["date"].nunique()),
        "instruments": int(panel["instrument"].nunique()),
        "rank_ic": {
            **nw_mean_stats(rank),
            "median": float(rank.median()) if len(rank) else None,
            "std": float(rank.std(ddof=1)) if len(rank) > 1 else None,
            "icir_unannualized": float(rank.mean() / rank.std(ddof=1)) if len(rank) > 1 and rank.std(ddof=1) else None,
            "positive_ratio": float((rank > 0).mean()) if len(rank) else None,
            "block_bootstrap_95": block_bootstrap_ci(rank),
        },
        "pearson_ic": {**nw_mean_stats(pearson), "block_bootstrap_95": block_bootstrap_ci(pearson)},
        "quantile_forward_return_mean": {k: float(np.mean(v)) for k, v in quantile_returns.items()},
        "top_bottom_5d": {**nw_mean_stats(q_spreads), "block_bootstrap_95": block_bootstrap_ci(q_spreads)},
    }


def membership_and_universe(days):
    memberships = {}
    union = set()
    for i, day in enumerate(days):
        ds = str(pd.Timestamp(day).date())
        members = set(get_index_stocks(INDEX, date=ds))
        memberships[pd.Timestamp(day)] = members
        union.update(members)
        if i % 250 == 0:
            print(f"membership {i}/{len(days)} union={len(union)}", flush=True)
    return memberships, sorted(union)


def fetch_prices(codes):
    pieces = []
    for i in range(0, len(codes), 120):
        batch = codes[i:i + 120]
        frame = get_price(
            batch,
            start_date=START_BUFFER,
            end_date=END_BUFFER,
            frequency="daily",
            fields=["open", "close", "volume", "money", "paused", "high_limit", "low_limit"],
            skip_paused=False,
            fq="pre",
            panel=False,
        )
        pieces.append(frame)
        print(f"prices {min(i + len(batch), len(codes))}/{len(codes)} rows={len(frame)}", flush=True)
    return pd.concat(pieces, ignore_index=True)


def main():
    started = time.time()
    cfg = json.loads(CONFIG.read_text())
    auth(cfg["username"], cfg["password"])
    days = pd.DatetimeIndex(get_trade_days(start_date=START_BUFFER, end_date=END_BUFFER))
    research_days = days[(days >= START) & (days <= END)]
    memberships, codes = membership_and_universe(research_days)
    prices = fetch_prices(codes)
    prices["time"] = pd.to_datetime(prices["time"])
    prices = prices.sort_values(["code", "time"]).drop_duplicates(["code", "time"])
    is_st = get_extras("is_st", codes, start_date=START_BUFFER, end_date=END_BUFFER, df=True)
    is_st.index = pd.to_datetime(is_st.index)
    st_long = is_st.stack().rename("is_st").rename_axis(["time", "code"]).reset_index()
    prices = prices.merge(st_long, on=["time", "code"], how="left")

    by_code = prices.groupby("code", sort=False)
    prices["ret5"] = by_code["close"].pct_change(5, fill_method=None)
    prices["volume_median20"] = by_code["volume"].transform(lambda x: x.rolling(20, min_periods=15).median())
    prices["adv20"] = by_code["money"].transform(lambda x: x.rolling(20, min_periods=15).mean())
    prices["volatility20"] = by_code["close"].transform(
        lambda x: x.pct_change(fill_method=None).rolling(20, min_periods=15).std()
    )
    prices["factor_raw"] = -prices["ret5"] * np.log1p(prices["volume"] / prices["volume_median20"])
    prices["log_adv20"] = np.log(prices["adv20"].where(prices["adv20"] > 0))
    prices["entry_open"] = by_code["open"].shift(-1)
    prices["exit_open"] = by_code["open"].shift(-6)
    prices["entry_paused"] = by_code["paused"].shift(-1)
    prices["exit_paused"] = by_code["paused"].shift(-6)
    prices["entry_volume"] = by_code["volume"].shift(-1)
    prices["exit_volume"] = by_code["volume"].shift(-6)
    prices["entry_high_limit"] = by_code["high_limit"].shift(-1)
    prices["entry_low_limit"] = by_code["low_limit"].shift(-1)
    prices["exit_high_limit"] = by_code["high_limit"].shift(-6)
    prices["exit_low_limit"] = by_code["low_limit"].shift(-6)
    prices["forward_return"] = prices["exit_open"] / prices["entry_open"] - 1
    prices["delayed_forward_return"] = by_code["open"].shift(-7) / by_code["open"].shift(-2) - 1

    mask_membership = []
    for t, code in zip(prices["time"], prices["code"]):
        mask_membership.append(code in memberships.get(t, set()))
    prices["historical_member"] = mask_membership
    entry_ok = (
        prices["entry_paused"].fillna(1).eq(0)
        & prices["entry_volume"].gt(0)
        & prices["entry_open"].gt(prices["entry_low_limit"])
        & prices["entry_open"].lt(prices["entry_high_limit"])
    )
    exit_ok = (
        prices["exit_paused"].fillna(1).eq(0)
        & prices["exit_volume"].gt(0)
        & prices["exit_open"].gt(prices["exit_low_limit"])
        & prices["exit_open"].lt(prices["exit_high_limit"])
    )
    prices["tradable"] = entry_ok & exit_ok & ~prices["is_st"].fillna(True)
    sample = prices[
        prices["time"].between(START, END)
        & prices["historical_member"]
        & prices["tradable"]
        & prices["factor_raw"].notna()
        & prices["forward_return"].notna()
    ].copy()
    sample = sample.groupby("time", group_keys=False).apply(cross_section_process, include_groups=False)
    sample = sample.dropna(subset=["factor"]).reset_index(drop=True)
    sample["date"] = sample["time"].dt.strftime("%Y-%m-%d")
    sample["instrument"] = sample["code"]
    sample["factor_id"] = "volume_amplified_reversal_5_20"
    sample["available_at"] = sample["date"] + " 15:30:00+08:00"
    sample["quality_flags"] = "historical_member|non_st|entry_exit_unlocked"
    sample["split"] = sample["time"].map(split_name)

    raw_cols = ["date", "instrument", "factor_id", "factor_raw", "available_at", "quality_flags", "split"]
    proc_cols = raw_cols + ["factor_winsorized", "factor", "forward_return", "delayed_forward_return", "tradable", "log_adv20", "volatility20"]
    sample[raw_cols].to_csv(ROOT / "factor_values_raw.csv", index=False)
    sample[proc_cols].to_csv(ROOT / "factor_values_processed.csv", index=False)
    sample[["date", "instrument", "factor", "forward_return", "tradable"]].to_csv(ROOT / "factor_panel.csv", index=False)

    metrics = {"all": summarize(sample, "all")}
    for split, part in sample.groupby("split"):
        metrics[split] = summarize(part, split)
    delayed = sample.dropna(subset=["delayed_forward_return"]).rename(
        columns={"forward_return": "original_forward_return", "delayed_forward_return": "forward_return"}
    )
    metrics["one_day_delay_validation"] = summarize(
        delayed[delayed["split"] == "validation"], "one_day_delay_validation"
    )
    dump("factor_metrics_extended.json", metrics)

    # Annual and liquidity slices.
    slices = []
    for year, part in sample.groupby(sample["time"].dt.year):
        s = summarize(part, f"year_{year}")
        slices.append({"slice_type": "year", "slice": str(year), "rank_ic": s["rank_ic"]["mean"], "rank_ic_t_hac": s["rank_ic"]["t_hac"], "top_bottom_5d": s["top_bottom_5d"]["mean"], "rows": s["rows"]})
    sample["liquidity_bucket"] = sample.groupby("date")["log_adv20"].transform(
        lambda x: pd.qcut(x.rank(method="first"), 3, labels=["low", "mid", "high"])
    )
    for bucket, part in sample.groupby("liquidity_bucket", observed=True):
        s = summarize(part, f"liquidity_{bucket}")
        slices.append({"slice_type": "liquidity", "slice": str(bucket), "rank_ic": s["rank_ic"]["mean"], "rank_ic_t_hac": s["rank_ic"]["t_hac"], "top_bottom_5d": s["top_bottom_5d"]["mean"], "rows": s["rows"]})
    pd.DataFrame(slices).to_csv(ROOT / "slice_metrics.csv", index=False)

    # Daily top/bottom membership turnover and fixed-cost sensitivity.
    holdings = {}
    daily_spread = []
    daily_turn = []
    for date, g in sample.groupby("date", sort=True):
        q = pd.qcut(g["factor"].rank(method="first"), 5, labels=False)
        top = set(g.loc[q == 4, "instrument"])
        bottom = set(g.loc[q == 0, "instrument"])
        spread = g.loc[q == 4, "forward_return"].mean() - g.loc[q == 0, "forward_return"].mean()
        if holdings:
            prev_top, prev_bottom = holdings["top"], holdings["bottom"]
            top_turn = 1 - len(top & prev_top) / max(len(top), 1)
            bottom_turn = 1 - len(bottom & prev_bottom) / max(len(bottom), 1)
            daily_turn.append((top_turn + bottom_turn) / 2)
        holdings = {"top": top, "bottom": bottom}
        daily_spread.append(spread)
    gross = float(np.nanmean(daily_spread))
    turnover = float(np.nanmean(daily_turn))
    cost_report = {
        "method": "illustrative fixed-bps screen; not a production impact/capacity model",
        "gross_top_bottom_5d_mean": gross,
        "mean_daily_one_way_membership_turnover": turnover,
        "base_round_trip_cost_bps_per_leg": 20,
        "pessimistic_round_trip_cost_bps_per_leg": 50,
        "base_net_top_bottom_5d_approx": gross - 2 * turnover * 20 / 10000,
        "pessimistic_net_top_bottom_5d_approx": gross - 2 * turnover * 50 / 10000,
        "break_even_round_trip_cost_bps_per_leg": gross / (2 * turnover) * 10000 if turnover else None,
        "capacity": "not_evaluable",
        "borrow": "not_evaluable",
        "impact_model": "not_evaluable"
    }
    dump("cost_capacity_report.json", cost_report)
    dump("multiple_testing_report.json", {
        "trial_family_count": 1,
        "candidate_count": 1,
        "parameter_variants": 1,
        "correction": "not_required_for_single_pre_registered_candidate",
        "final_holdout_views": 1
    })
    dump("walk_forward_report.json", {
        "design": "fixed formula; discovery 2018-2021, validation 2022-2023, untouched final holdout 2024-2025",
        "metrics_ref": "factor_metrics_extended.json",
        "purge": "labels are computed within each dated observation; boundary observations whose exit crosses a split boundary were excluded below",
        "warning": "main split metrics currently group by signal date; use boundary-purged metrics for formal inference"
    })

    # Boundary purge for formal split inference.
    split_end = {"discovery": pd.Timestamp("2021-12-31"), "validation": pd.Timestamp("2023-12-31"), "final_holdout": pd.Timestamp("2025-12-31")}
    day_pos = {d: i for i, d in enumerate(days)}
    def exit_date(t):
        i = day_pos.get(t)
        return days[i + 6] if i is not None and i + 6 < len(days) else pd.NaT
    sample["label_exit_date"] = sample["time"].map(exit_date)
    purged = sample[sample.apply(lambda r: r["label_exit_date"] <= split_end[r["split"]], axis=1)]
    formal = {split: summarize(part, split) for split, part in purged.groupby("split")}
    dump("formal_split_metrics.json", formal)

    factor_spec = json.loads((ROOT / "factor_spec.json").read_text())
    normalized = json.dumps(factor_spec["implementation"], sort_keys=True, ensure_ascii=False)
    factor_hash = sha256_text(normalized)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    env_hash = sha256_text(json.dumps({"python": sys.version, "platform": platform.platform(), "pandas": pd.__version__, "numpy": np.__version__}, sort_keys=True))
    elapsed = time.time() - started
    trial = {
        "schema_version": "alpha.factor_trial.v1",
        "run_id": "run-20260723-volume-reversal",
        "trial_id": "trial-0001",
        "trial_family_id": "cn-a-volume-reversal-family-v1",
        "parent_trial_id": None,
        "factor_id": factor_hash,
        "normalized_ast_hash": factor_hash,
        "dataset_snapshot_id": f"jqdata-{START}-{END}-fetched-20260723",
        "universe_snapshot_id": f"jqdata-{INDEX}-daily-membership-{START}-{END}",
        "code_commit": commit,
        "environment_hash": env_hash,
        "random_seed": 20260723,
        "parameters": factor_spec["parameters"],
        "preprocessing": factor_spec["preprocessing"],
        "label": "open(t+1) to open(t+6)",
        "split": "discovery+validation+single_final_holdout",
        "status": "succeeded",
        "failure_reason": None,
        "metrics_uri": str(ROOT / "formal_split_metrics.json"),
        "artifact_uri": str(ROOT),
        "model_prompt_version": "codex-hypothesis-v1",
        "token_cost": 0,
        "compute_seconds": round(elapsed, 2),
        "holdout_seen": True,
        "created_at": pd.Timestamp.now(tz="Asia/Shanghai").isoformat(),
        "owner": "alpha-research"
    }
    pd.DataFrame([trial]).to_csv(ROOT / "trial_ledger.csv", index=False)
    dump("factor_lineage.json", {"factor_id": factor_hash, "parent": None, "generation": "single pre-registered economic template", "normalized_expression": normalized})
    dump("data_manifest.json", {
        "dataset_snapshot_id": trial["dataset_snapshot_id"],
        "provider": "JQData",
        "created_at": trial["created_at"],
        "calendar": "SSE-SZSE",
        "timezone": "Asia/Shanghai",
        "universe_snapshot_id": trial["universe_snapshot_id"],
        "fields": [
            {"name": f, "source": f"JQData.get_price.{f}", "frequency": "1d", "unit": "provider_native", "adjustment": "pre", "known_at_rule": "official daily field after close", "revision_policy": "provider snapshot at fetch"}
            for f in ["open", "close", "volume", "money", "paused", "high_limit", "low_limit"]
        ],
        "tradability_rules_version": "daily-open-unlocked-v1",
        "cost_model_version": "illustrative-fixed-bps-v1",
        "license_boundary": "authorized-user-research"
    })
    dump("data_audit.json", {
        "point_in_time": "pass_for_daily_market_data",
        "historical_universe": "pass_daily_get_index_stocks replay",
        "delisted_constituents": "included when returned by historical membership and price history",
        "st": "excluded using get_extras(is_st) at decision date",
        "suspension": "excluded at entry and exit",
        "price_limit": "conservative exclusion when entry or exit open equals either daily limit",
        "corporate_actions": "pre-adjusted price for signal and return continuity; executable open therefore modelled on adjusted series, a limitation",
        "time_travel_recomputation": "not_evaluable_without_immutable_prior vendor snapshot",
        "execution_replay": "partial_daily_bar_only",
        "query_count_after": get_query_count(),
        "universe_codes": len(codes),
        "research_days": len(research_days),
        "panel_rows": len(sample)
    })
    print(f"complete rows={len(sample)} codes={len(codes)} seconds={elapsed:.1f}", flush=True)


if __name__ == "__main__":
    main()

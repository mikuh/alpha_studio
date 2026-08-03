#!/usr/bin/env python3
"""Bounded, leakage-aware A-share quantitative factor miner.

The miner expands an explicit candidate space, calculates all candidates,
ranks them using discovery/validation evidence only, removes highly correlated
signals, searches bounded combinations, freezes the shortlist, and only then
opens the final holdout for shortlisted factors. It uses only Python's standard
library and the transparent primitives in ``run_factor_research.py``.

This is a research candidate generator, not an execution or approval engine.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run_factor_research import (
    Key,
    build_backtests,
    build_combination,
    compute_factor_values,
    compute_forward_returns,
    evaluate_factors,
    fmt,
    json_hash,
    load_panel,
    mean,
    preprocess_factor,
    purge_cross_split_forward_returns,
    spearman,
    split_for_date,
    write_csv,
)
from validate_research_config import LOOKBACK_KINDS, load_config, validate_config


DEFAULT_METRIC_WEIGHTS = {
    "rank_ic": 0.25,
    "rank_ic_ir": 0.15,
    "rank_ic_positive_ratio": 0.10,
    "net_sharpe": 0.20,
    "max_drawdown": 0.10,
    "turnover": 0.10,
    "stability": 0.10,
}
LOWER_IS_BETTER = {"turnover"}


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9_-]+", "_", value.lower()).strip("_-")
    if len(cleaned) < 3:
        cleaned = f"factor_{cleaned or 'candidate'}"
    return cleaned[:63]


def candidate_name(prefix: str, suffix: str, sign: int) -> str:
    sign_suffix = "" if sign == 1 else "_neg"
    return slug(f"{prefix}_{suffix}{sign_suffix}")


def expand_candidate_space(config: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    mining = config.get("mining", {})
    maximum = int(mining.get("max_factor_candidates", 60))
    expanded: list[dict[str, Any]] = [copy.deepcopy(item) for item in config.get("factors", [])]
    generated: list[dict[str, Any]] = []

    for template in mining.get("candidate_templates", []):
        kind = template["kind"]
        prefix = str(template.get("name_prefix") or kind)
        signs = [int(value) for value in template.get("signs", [1])]
        common = {
            key: copy.deepcopy(value)
            for key, value in template.items()
            if key
            not in {
                "lookbacks",
                "window_pairs",
                "signs",
                "name_prefix",
            }
        }
        if kind in LOOKBACK_KINDS:
            for lookback, sign in itertools.product(template["lookbacks"], signs):
                item = dict(common)
                item.update(
                    {
                        "name": candidate_name(prefix, str(lookback), sign),
                        "kind": kind,
                        "lookback": int(lookback),
                        "sign": sign,
                        "generated_by": "bounded_grid",
                    }
                )
                generated.append(item)
        elif kind == "turnover_change":
            for pair, sign in itertools.product(template["window_pairs"], signs):
                short_window = int(pair["short_window"])
                long_window = int(pair["long_window"])
                item = dict(common)
                item.update(
                    {
                        "name": candidate_name(prefix, f"{short_window}_{long_window}", sign),
                        "kind": kind,
                        "short_window": short_window,
                        "long_window": long_window,
                        "sign": sign,
                        "generated_by": "bounded_grid",
                    }
                )
                generated.append(item)
        else:
            for sign in signs:
                source = str(template.get("source_column") or kind)
                item = dict(common)
                item.update(
                    {
                        "name": candidate_name(prefix, slug(source), sign),
                        "kind": kind,
                        "sign": sign,
                        "generated_by": "bounded_grid",
                    }
                )
                generated.append(item)

    seen: dict[str, str] = {}
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for item in expanded + generated:
        name = item["name"]
        fingerprint = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if name in seen:
            if seen[name] != fingerprint:
                raise ValueError(f"candidate name collision with different definitions: {name}")
            rejected.append({"definition": item, "reason": "duplicate_definition"})
            continue
        seen[name] = fingerprint
        if len(accepted) >= maximum:
            rejected.append({"definition": item, "reason": "factor_budget_exceeded"})
            continue
        accepted.append(item)
    if not accepted:
        raise ValueError("candidate expansion produced no factors")
    return accepted, rejected


def selection_only_config(config: dict[str, Any]) -> dict[str, Any]:
    selected = copy.deepcopy(config)
    selected["splits"]["final_holdout"] = {
        "start": "9998-01-01",
        "end": "9998-12-31",
    }
    return selected


def metric_features(
    factor_summary: dict[str, Any], backtest_summary: dict[str, Any]
) -> dict[str, float | None]:
    discovery_ic = factor_summary["discovery"]["rank_ic"]["mean"]
    validation = factor_summary["validation"]
    validation_backtest = backtest_summary["validation"]
    validation_ic = validation["rank_ic"]["mean"]
    stability = None
    if discovery_ic is not None and validation_ic is not None:
        stability = -abs(float(discovery_ic) - float(validation_ic))
    return {
        "rank_ic": validation_ic,
        "rank_ic_ir": validation["rank_ic"]["ir"],
        "rank_ic_positive_ratio": validation["rank_ic"]["positive_ratio"],
        "net_sharpe": validation_backtest["net_sharpe"],
        "max_drawdown": validation_backtest["max_drawdown"],
        "turnover": validation_backtest["average_turnover"],
        "stability": stability,
    }


def percentile_scores(values: dict[str, float | None], lower_is_better: bool) -> dict[str, float]:
    valid = sorted(float(value) for value in values.values() if value is not None and math.isfinite(value))
    result: dict[str, float] = {}
    for name, value in values.items():
        if value is None or not math.isfinite(value) or not valid:
            result[name] = 0.0
            continue
        less = sum(item < float(value) for item in valid)
        equal = sum(item == float(value) for item in valid)
        percentile = (less + 0.5 * equal) / len(valid)
        result[name] = 1.0 - percentile if lower_is_better else percentile
    return result


def gate_reasons(
    factor_summary: dict[str, Any], backtest_summary: dict[str, Any], selection: dict[str, Any]
) -> list[str]:
    reasons: list[str] = []
    discovery_ic = factor_summary["discovery"]["rank_ic"]["mean"]
    validation = factor_summary["validation"]
    validation_ic = validation["rank_ic"]["mean"]
    if validation["rank_ic"]["count"] < int(selection.get("min_validation_rank_ic_days", 20)):
        reasons.append("insufficient_validation_rank_ic_days")
    coverage = validation["coverage"]["mean"]
    if coverage is None or coverage < float(selection.get("min_validation_coverage", 0.5)):
        reasons.append("insufficient_validation_coverage")
    minimum_ic = selection.get("min_validation_rank_ic", 0.0)
    if minimum_ic is not None and (
        validation_ic is None or validation_ic < float(minimum_ic)
    ):
        reasons.append("validation_rank_ic_below_gate")
    if selection.get("require_discovery_validation_same_sign", True):
        if (
            discovery_ic is None
            or validation_ic is None
            or float(discovery_ic) * float(validation_ic) <= 0
        ):
            reasons.append("discovery_validation_direction_mismatch")
    minimum_sharpe = selection.get("min_validation_net_sharpe")
    validation_sharpe = backtest_summary["validation"]["net_sharpe"]
    if minimum_sharpe is not None and (
        validation_sharpe is None or validation_sharpe < float(minimum_sharpe)
    ):
        reasons.append("validation_net_sharpe_below_gate")
    return reasons


def rank_candidates(
    definitions: dict[str, dict[str, Any]],
    summaries: dict[str, dict[str, Any]],
    backtests: dict[str, dict[str, Any]],
    config: dict[str, Any],
    candidate_type: str,
) -> list[dict[str, Any]]:
    selection = config.get("mining", {}).get("selection", {})
    weights = selection.get("metric_weights", DEFAULT_METRIC_WEIGHTS)
    features = {
        name: metric_features(summaries[name], backtests[name]) for name in definitions
    }
    normalized: dict[str, dict[str, float]] = {}
    for metric in weights:
        normalized[metric] = percentile_scores(
            {name: values.get(metric) for name, values in features.items()},
            metric in LOWER_IS_BETTER,
        )
    weight_total = sum(float(value) for value in weights.values())
    rows: list[dict[str, Any]] = []
    for name, definition in definitions.items():
        failures = gate_reasons(summaries[name], backtests[name], selection)
        score = sum(
            float(weight) * normalized[metric][name]
            for metric, weight in weights.items()
        ) / weight_total
        validation = summaries[name]["validation"]
        validation_backtest = backtests[name]["validation"]
        row = {
            "candidate_type": candidate_type,
            "factor_name": name,
            "factor_kind": definition.get("kind", "combination"),
            "parameters_json": json.dumps(definition, ensure_ascii=False, sort_keys=True),
            "selection_score": score,
            "passes_gates": not failures,
            "gate_failures": ";".join(failures),
            "discovery_rank_ic": summaries[name]["discovery"]["rank_ic"]["mean"],
            "validation_rank_ic": validation["rank_ic"]["mean"],
            "validation_rank_ic_ir": validation["rank_ic"]["ir"],
            "validation_rank_ic_positive_ratio": validation["rank_ic"]["positive_ratio"],
            "validation_rank_ic_days": validation["rank_ic"]["count"],
            "validation_coverage": validation["coverage"]["mean"],
            "validation_top_minus_bottom": validation["top_minus_bottom"]["mean"],
            "validation_net_sharpe": validation_backtest["net_sharpe"],
            "validation_annualized_net_return": validation_backtest["annualized_net_return"],
            "validation_max_drawdown": validation_backtest["max_drawdown"],
            "validation_average_turnover": validation_backtest["average_turnover"],
            "redundant_with": "",
            "selected_for_holdout": False,
            "final_holdout_rank_ic": None,
            "final_holdout_net_sharpe": None,
            "holdout_assessment": "not_opened",
        }
        for metric in weights:
            row[f"score_{metric}"] = normalized[metric][name]
        rows.append(row)
    rows.sort(key=lambda row: (-float(row["selection_score"]), row["factor_name"]))
    for index, row in enumerate(rows, start=1):
        row["selection_rank"] = index
    return rows


def daily_factor_correlations(
    values_by_factor: dict[str, dict[Key, float | None]],
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    names = sorted(values_by_factor)
    minimum = int(config["evaluation"]["min_cross_section"])
    validation = config["splits"]["validation"]
    rows: list[dict[str, Any]] = []
    for left_index, left in enumerate(names):
        for right in names[left_index + 1 :]:
            correlations: list[float] = []
            by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
            common_keys = set(values_by_factor[left]) & set(values_by_factor[right])
            for key in common_keys:
                if not validation["start"] <= key[0] <= validation["end"]:
                    continue
                left_value = values_by_factor[left].get(key)
                right_value = values_by_factor[right].get(key)
                if left_value is not None and right_value is not None:
                    by_day[key[0]].append((float(left_value), float(right_value)))
            for pairs in by_day.values():
                if len(pairs) >= minimum:
                    correlation = spearman(
                        [pair[0] for pair in pairs], [pair[1] for pair in pairs]
                    )
                    if correlation is not None:
                        correlations.append(correlation)
            rows.append(
                {
                    "factor_a": left,
                    "factor_b": right,
                    "validation_rank_correlation": mean(correlations),
                    "overlap_days": len(correlations),
                }
            )
    return rows


def correlation_lookup(rows: list[dict[str, Any]]) -> dict[tuple[str, str], float | None]:
    result: dict[tuple[str, str], float | None] = {}
    for row in rows:
        result[tuple(sorted((row["factor_a"], row["factor_b"])))] = row[
            "validation_rank_correlation"
        ]
    return result


def select_diverse(
    ranking: list[dict[str, Any]],
    correlations: dict[tuple[str, str], float | None],
    limit: int,
    threshold: float,
) -> list[str]:
    selected: list[str] = []
    for row in ranking:
        if not row["passes_gates"]:
            continue
        redundant_with = ""
        for existing in selected:
            correlation = correlations.get(tuple(sorted((row["factor_name"], existing))))
            if correlation is not None and abs(float(correlation)) >= threshold:
                redundant_with = existing
                break
        row["redundant_with"] = redundant_with
        if redundant_with:
            continue
        selected.append(row["factor_name"])
        if len(selected) >= limit:
            break
    return selected


def build_combinations(
    pool: list[str],
    single_rows: dict[str, dict[str, Any]],
    processed: dict[str, dict[Key, float | None]],
    config: dict[str, Any],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[Key, float | None]],
    dict[str, dict[Key, float | None]],
    list[dict[str, Any]],
]:
    mining = config["mining"]
    maximum = int(mining.get("max_combination_candidates", 100))
    sizes = sorted(set(int(size) for size in mining.get("combination_sizes", [2, 3])))
    schemes = mining.get("weight_schemes", ["equal", "validation_ic"])
    definitions: dict[str, dict[str, Any]] = {}
    raw_values: dict[str, dict[Key, float | None]] = {}
    processed_values: dict[str, dict[Key, float | None]] = {}
    rejected: list[dict[str, Any]] = []
    for size in sizes:
        for components in itertools.combinations(pool, size):
            for scheme in schemes:
                if scheme == "equal":
                    weights = {name: 1.0 / len(components) for name in components}
                else:
                    positive_ics = {
                        name: max(0.0, float(single_rows[name]["validation_rank_ic"] or 0.0))
                        for name in components
                    }
                    total = sum(positive_ics.values())
                    if total <= 0:
                        rejected.append(
                            {
                                "definition": {"components": components, "scheme": scheme},
                                "reason": "non_positive_validation_ic_weights",
                            }
                        )
                        continue
                    weights = {name: value / total for name, value in positive_ics.items()}
                signature = json.dumps(
                    {"components": components, "scheme": scheme, "weights": weights},
                    sort_keys=True,
                )
                name = f"combo_{'eq' if scheme == 'equal' else 'vic'}_{hashlib.sha256(signature.encode()).hexdigest()[:10]}"
                definition = {
                    "kind": "combination",
                    "weight_scheme": scheme,
                    "weights": weights,
                    "minimum_available": len(components),
                    "selection_data": "discovery+validation_only",
                }
                if len(definitions) >= maximum:
                    rejected.append({"definition": {"name": name, **definition}, "reason": "combination_budget_exceeded"})
                    continue
                raw, combined = build_combination(processed, definition)
                definitions[name] = definition
                raw_values[name] = raw
                processed_values[name] = combined
    return definitions, raw_values, processed_values, rejected


def merge_final_holdout(
    selection_summaries: dict[str, dict[str, Any]],
    selection_backtests: dict[str, dict[str, Any]],
    holdout_summaries: dict[str, dict[str, Any]],
    holdout_backtests: dict[str, dict[str, Any]],
) -> None:
    for name in holdout_summaries:
        selection_summaries[name]["final_holdout"] = holdout_summaries[name]["final_holdout"]
        selection_backtests[name]["final_holdout"] = holdout_backtests[name]["final_holdout"]


def assess_holdout(rank_ic: float | None, net_sharpe: float | None) -> str:
    if rank_ic is None:
        return "not_evaluable"
    if rank_ic > 0 and net_sharpe is not None and net_sharpe > 0:
        return "confirmed_direction_and_net_portfolio"
    if rank_ic > 0:
        return "direction_confirmed_portfolio_mixed"
    return "decayed_or_reversed"


def factor_formula(definition: dict[str, Any]) -> str:
    kind = definition.get("kind")
    sign = int(definition.get("sign", 1))
    multiplier = "" if sign == 1 else "-1 * "
    if kind == "momentum":
        return f"{multiplier}(close_t / close_t-{definition['lookback']} - 1)"
    if kind == "reversal":
        return f"{multiplier}-(close_t / close_t-{definition['lookback']} - 1)"
    if kind == "low_volatility":
        return f"{multiplier}-std(daily_return, {definition['lookback']})"
    if kind == "turnover_mean":
        return f"{multiplier}mean({definition['source_column']}, {definition['lookback']})"
    if kind == "turnover_change":
        return (
            f"{multiplier}mean({definition['source_column']}, recent_{definition['short_window']}) / "
            f"mean({definition['source_column']}, prior_{definition['long_window'] - definition['short_window']}) - 1"
        )
    if kind in {"earnings_yield", "book_to_price"}:
        return f"{multiplier}1 / {definition['source_column']}"
    if kind == "low_leverage":
        return f"{multiplier}-{definition['source_column']}"
    if kind == "small_size":
        return f"{multiplier}-log({definition['source_column']})"
    if kind in {"roe", "column"}:
        return f"{multiplier}{definition['source_column']}"
    if kind == "combination":
        return " + ".join(
            f"{float(weight):.6f}*z({name})" for name, weight in definition["weights"].items()
        )
    return json.dumps(definition, ensure_ascii=False, sort_keys=True)


def build_strategy_candidate(
    name: str,
    definition: dict[str, Any],
    ranking_row: dict[str, Any],
    summaries: dict[str, dict[str, Any]],
    backtests: dict[str, dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    candidate = {
        "factor_name": name,
        "formula": factor_formula(definition),
        "direction": "higher_factor_value_means_higher_expected_return",
        "definition": definition,
        "selection_rank": ranking_row["selection_rank"],
        "selection_score": ranking_row["selection_score"],
        "selected_without_final_holdout": True,
        "validation": {
            "rank_ic": summaries[name]["validation"]["rank_ic"],
            "top_minus_bottom": summaries[name]["validation"]["top_minus_bottom"],
            "backtest": backtests[name]["validation"],
        },
        "final_holdout": {
            "rank_ic": summaries[name]["final_holdout"]["rank_ic"],
            "top_minus_bottom": summaries[name]["final_holdout"]["top_minus_bottom"],
            "backtest": backtests[name]["final_holdout"],
            "assessment": ranking_row["holdout_assessment"],
        },
        "trading_research_spec": {
            "signal_time": config["timing"]["signal_time"],
            "earliest_fill": config["timing"]["fill_time"],
            "entry_lag": config["timing"]["entry_lag"],
            "holding_period": config["timing"]["holding_period"],
            "rebalance_every": config["timing"]["rebalance_every"],
            "portfolio": f"long top {100 / config['evaluation']['quantiles']:.1f}% and short bottom {100 / config['evaluation']['quantiles']:.1f}% for research backtest",
            "cost_bps_per_traded_notional": config["evaluation"]["cost_bps"],
        },
    }
    if definition.get("kind") == "combination":
        candidate["combination_increment"] = {
            "validation_rank_ic_vs_best_component": ranking_row.get(
                "validation_rank_ic_increment_vs_best_component"
            ),
            "validation_net_sharpe_vs_best_component": ranking_row.get(
                "validation_net_sharpe_increment_vs_best_component"
            ),
            "validation_max_drawdown_vs_best_component": ranking_row.get(
                "validation_max_drawdown_improvement_vs_best_component"
            ),
            "assessment": ranking_row.get("combination_increment_assessment"),
        }
    return candidate


def build_mining_report(
    config: dict[str, Any],
    single_ranking: list[dict[str, Any]],
    combo_ranking: list[dict[str, Any]],
    top_singles: list[str],
    top_combos: list[str],
    definitions: dict[str, dict[str, Any]],
    warnings: list[str],
) -> str:
    by_name = {row["factor_name"]: row for row in single_ranking + combo_ranking}
    lines = [
        f"# 量化因子挖掘报告｜{config['research']['research_id']}",
        "",
        "## 结论",
        "",
        "- 状态：`RESEARCH_ONLY`。本次结果是可交易研究候选，不是收益承诺或自动生产准入。",
        f"- 已批量评测 `{len(single_ranking)}` 个单因子和 `{len(combo_ranking)}` 个组合候选。",
        f"- 最终入围 `{len(top_singles)}` 个去冗余单因子和 `{len(top_combos)}` 个组合；选择分数只使用 discovery + validation，入围冻结后才查看 final holdout。",
        "- 排名采用显式硬门槛 + 多指标百分位得分；验证集 RankIC、稳定性、成本后 Sharpe、回撤和换手不会被单一漂亮指标掩盖。",
        "",
        "## Top 单因子",
        "",
        "| 排名 | 因子 | 公式 | 选择分数 | 验证RankIC | 验证净Sharpe | 留出RankIC | 留出判断 |",
        "|---:|---|---|---:|---:|---:|---:|---|",
    ]
    for rank, name in enumerate(top_singles, start=1):
        row = by_name[name]
        lines.append(
            f"| {rank} | `{name}` | `{factor_formula(definitions[name])}` | {fmt(row['selection_score'])} | "
            f"{fmt(row['validation_rank_ic'])} | {fmt(row['validation_net_sharpe'])} | "
            f"{fmt(row['final_holdout_rank_ic'])} | `{row['holdout_assessment']}` |"
        )
    if not top_singles:
        lines.append("| - | 没有候选通过预设门槛 | - | - | - | - | - | - |")
    lines.extend(
        [
            "",
            "## Top 组合",
            "",
            "| 排名 | 组合 | 权重 | 验证RankIC | 验证净Sharpe | Sharpe增量 | 组合判断 | 留出判断 |",
            "|---:|---|---|---:|---:|---:|---|---|",
        ]
    )
    for rank, name in enumerate(top_combos, start=1):
        row = by_name[name]
        lines.append(
            f"| {rank} | `{name}` | `{json.dumps(definitions[name]['weights'], ensure_ascii=False, sort_keys=True)}` | "
            f"{fmt(row['validation_rank_ic'])} | {fmt(row['validation_net_sharpe'])} | "
            f"{fmt(row.get('validation_net_sharpe_increment_vs_best_component'))} | "
            f"`{row.get('combination_increment_assessment', 'not_evaluable')}` | "
            f"`{row['holdout_assessment']}` |"
        )
    if not top_combos:
        lines.append("| - | 没有组合通过预设门槛 | - | - | - | - | - | - |")
    lines.extend(
        [
            "",
            "## 交易研究配置",
            "",
            f"- 信号/成交：`{config['timing']['signal_time']}` → `{config['timing']['fill_time']}`；entry lag `{config['timing']['entry_lag']}`。",
            f"- 调仓/持有：每 `{config['timing']['rebalance_every']}` 个交易日调仓，持有 `{config['timing']['holding_period']}` 个交易日并使用滚动 cohort。",
            f"- 组合：做多最高分位、做空最低分位的研究基线；成本 `{config['evaluation']['cost_bps']}` bps/单位成交名义金额。",
            "- 实盘前仍需按用户约束转成长-only或可借券实现，并补齐冲击、容量、涨跌停排队、T+1、整手和真实成交验证。",
            "",
            "## 方法与防过拟合",
            "",
            f"- 单因子预算：`{config['mining'].get('max_factor_candidates', 60)}`；组合预算：`{config['mining'].get('max_combination_candidates', 100)}`。",
            f"- 去冗余阈值：验证期逐日横截面 Spearman 相关绝对值 `< {config['mining'].get('max_pair_correlation', 0.75)}`。",
            "- `candidate_ranking.csv` 保留所有成功候选和硬门槛失败原因；`trial_ledger.csv` 还保留预算淘汰项。",
            "- 未入围候选的 final holdout 收益被遮蔽，防止用最终留出集反复挑选。",
            "",
            "## 警告与失效条件",
            "",
        ]
    )
    lines.extend(f"- {warning}" for warning in warnings)
    lines.extend(f"- 失效：{rule}" for rule in config["research"]["invalidation_rules"])
    lines.extend(
        [
            "- `not_evaluable`：市场冲击与容量、借券可得性、逐笔排队、正式多重检验、独立 PIT 审计和 shadow 表现。",
            "",
            "> 仅用于量化研究，不构成个性化投资建议或收益保证。",
            "",
        ]
    )
    return "\n".join(lines)


def output_targets(output_dir: Path) -> list[Path]:
    return [
        output_dir / name
        for name in (
            "research_config.json",
            "mining_config.json",
            "trial_ledger.csv",
            "candidate_ranking.csv",
            "factor_correlation.csv",
            "factor_values.csv",
            "daily_metrics.csv",
            "factor_metrics.json",
            "backtest_daily.csv",
            "top_single_factors.json",
            "top_combinations.json",
            "strategy_candidates.json",
            "mining_report.md",
        )
    ]


def run_mining(config_path: Path, output_dir: Path, overwrite: bool = False) -> dict[str, Any]:
    original_config = load_config(config_path)
    validation = validate_config(original_config, config_path, check_input=True)
    if validation["errors"]:
        raise ValueError("invalid mining config:\n- " + "\n- ".join(validation["errors"]))
    if not original_config.get("mining", {}).get("enabled"):
        raise ValueError("mine_quant_factors.py requires mining.enabled=true")

    output_dir.mkdir(parents=True, exist_ok=True)
    existing = [path for path in output_targets(output_dir) if path.exists()]
    if existing and not overwrite:
        raise ValueError(
            "refusing to overwrite existing output files; use --overwrite for these exact targets: "
            + ", ".join(str(path) for path in existing)
        )

    factors, expansion_rejections = expand_candidate_space(original_config)
    config = copy.deepcopy(original_config)
    config["factors"] = factors
    config.pop("combination", None)

    rows, _ = load_panel(config, config_path)
    rows_by_key = {(row["date"], row["instrument"]): row for row in rows}
    raw_by_factor = compute_factor_values(rows, config)
    forward_returns, forward_dates = compute_forward_returns(rows, config)
    forward_returns = purge_cross_split_forward_returns(
        forward_returns, forward_dates, config
    )
    clean_by_factor: dict[str, dict[Key, float | None]] = {}
    processed_by_factor: dict[str, dict[Key, float | None]] = {}
    status_by_factor: dict[str, dict[Key, str]] = {}
    preprocessing_audit: dict[str, list[dict[str, Any]]] = {}
    for factor in factors:
        name = factor["name"]
        clean, processed, statuses, audit = preprocess_factor(
            rows_by_key, raw_by_factor[name], config
        )
        clean_by_factor[name] = clean
        processed_by_factor[name] = processed
        status_by_factor[name] = statuses
        preprocessing_audit[name] = audit

    selection_config = selection_only_config(config)
    selection_daily, factor_summaries = evaluate_factors(
        processed_by_factor, rows_by_key, forward_returns, selection_config
    )
    selection_backtest_daily, backtest_summaries = build_backtests(
        processed_by_factor, rows_by_key, selection_config
    )
    base_definitions = {factor["name"]: factor for factor in factors}
    single_ranking = rank_candidates(
        base_definitions, factor_summaries, backtest_summaries, config, "single"
    )
    base_correlations = daily_factor_correlations(processed_by_factor, config)
    base_correlation_lookup = correlation_lookup(base_correlations)
    mining = config["mining"]
    top_single_limit = int(mining.get("top_single_factors", 10))
    combination_pool_limit = max(
        top_single_limit, int(mining.get("combination_pool_size", 8))
    )
    diverse_pool = select_diverse(
        single_ranking,
        base_correlation_lookup,
        combination_pool_limit,
        float(mining.get("max_pair_correlation", 0.75)),
    )
    top_singles = diverse_pool[:top_single_limit]

    single_by_name = {row["factor_name"]: row for row in single_ranking}
    combo_definitions, combo_raw, combo_processed, combo_rejections = build_combinations(
        diverse_pool, single_by_name, processed_by_factor, config
    )
    combo_ranking: list[dict[str, Any]] = []
    combo_summaries: dict[str, dict[str, Any]] = {}
    combo_backtests: dict[str, dict[str, Any]] = {}
    combo_daily: list[dict[str, Any]] = []
    combo_backtest_daily: list[dict[str, Any]] = []
    if combo_definitions:
        combo_daily, combo_summaries = evaluate_factors(
            combo_processed, rows_by_key, forward_returns, selection_config
        )
        combo_backtest_daily, combo_backtests = build_backtests(
            combo_processed, rows_by_key, selection_config
        )
        combo_ranking = rank_candidates(
            combo_definitions, combo_summaries, combo_backtests, config, "combination"
        )
        for row in combo_ranking:
            components = list(combo_definitions[row["factor_name"]]["weights"])
            component_rank_ics = [
                single_by_name[name]["validation_rank_ic"] for name in components
            ]
            component_sharpes = [
                single_by_name[name]["validation_net_sharpe"] for name in components
            ]
            component_drawdowns = [
                single_by_name[name]["validation_max_drawdown"] for name in components
            ]
            valid_rank_ics = [
                float(value) for value in component_rank_ics if value is not None
            ]
            valid_sharpes = [float(value) for value in component_sharpes if value is not None]
            valid_drawdowns = [
                float(value) for value in component_drawdowns if value is not None
            ]
            row["validation_rank_ic_increment_vs_best_component"] = (
                float(row["validation_rank_ic"]) - max(valid_rank_ics)
                if row["validation_rank_ic"] is not None and valid_rank_ics
                else None
            )
            row["validation_net_sharpe_increment_vs_best_component"] = (
                float(row["validation_net_sharpe"]) - max(valid_sharpes)
                if row["validation_net_sharpe"] is not None and valid_sharpes
                else None
            )
            row["validation_max_drawdown_improvement_vs_best_component"] = (
                float(row["validation_max_drawdown"]) - max(valid_drawdowns)
                if row["validation_max_drawdown"] is not None and valid_drawdowns
                else None
            )
            increments = [
                row["validation_rank_ic_increment_vs_best_component"],
                row["validation_net_sharpe_increment_vs_best_component"],
                row["validation_max_drawdown_improvement_vs_best_component"],
            ]
            row["combination_increment_assessment"] = (
                "adds_validation_value"
                if any(value is not None and float(value) > 1e-12 for value in increments)
                else "no_increment_keep_simpler_factor"
            )
            if (
                mining.get("require_combination_increment", True)
                and row["combination_increment_assessment"]
                == "no_increment_keep_simpler_factor"
            ):
                row["passes_gates"] = False
                row["gate_failures"] = ";".join(
                    value
                    for value in (
                        row["gate_failures"],
                        "no_validation_increment_vs_best_component",
                    )
                    if value
                )
        combo_correlations = daily_factor_correlations(combo_processed, config)
        combo_lookup = correlation_lookup(combo_correlations)
        top_combos = select_diverse(
            combo_ranking,
            combo_lookup,
            int(mining.get("top_combinations", 5)),
            float(mining.get("max_pair_correlation", 0.75)),
        )
    else:
        combo_correlations = []
        top_combos = []

    shortlisted = top_singles + top_combos
    all_processed = {**processed_by_factor, **combo_processed}
    holdout_values = {name: all_processed[name] for name in shortlisted}
    holdout_daily: list[dict[str, Any]] = []
    holdout_backtest_daily: list[dict[str, Any]] = []
    if holdout_values:
        holdout_daily, holdout_summaries = evaluate_factors(
            holdout_values, rows_by_key, forward_returns, config
        )
        holdout_backtest_daily, holdout_backtests = build_backtests(
            holdout_values, rows_by_key, config
        )
        merge_final_holdout(
            factor_summaries, backtest_summaries,
            {name: holdout_summaries[name] for name in top_singles},
            {name: holdout_backtests[name] for name in top_singles},
        )
        merge_final_holdout(
            combo_summaries, combo_backtests,
            {name: holdout_summaries[name] for name in top_combos},
            {name: holdout_backtests[name] for name in top_combos},
        )
    else:
        holdout_summaries = {}
        holdout_backtests = {}

    all_summaries = {**factor_summaries, **combo_summaries}
    all_backtests = {**backtest_summaries, **combo_backtests}
    all_definitions = {**base_definitions, **combo_definitions}
    all_rankings = single_ranking + combo_ranking
    ranking_by_name = {row["factor_name"]: row for row in all_rankings}
    for name in shortlisted:
        row = ranking_by_name[name]
        row["selected_for_holdout"] = True
        rank_ic = all_summaries[name]["final_holdout"]["rank_ic"]["mean"]
        net_sharpe = all_backtests[name]["final_holdout"]["net_sharpe"]
        row["final_holdout_rank_ic"] = rank_ic
        row["final_holdout_net_sharpe"] = net_sharpe
        row["holdout_assessment"] = assess_holdout(rank_ic, net_sharpe)

    top_single_payload = [
        build_strategy_candidate(
            name, all_definitions[name], ranking_by_name[name], all_summaries, all_backtests, config
        )
        for name in top_singles
    ]
    top_combo_payload = [
        build_strategy_candidate(
            name, all_definitions[name], ranking_by_name[name], all_summaries, all_backtests, config
        )
        for name in top_combos
    ]

    factor_value_rows: list[dict[str, Any]] = []
    all_raw = {**raw_by_factor, **combo_raw}
    all_clean = {**clean_by_factor, **{name: values for name, values in combo_raw.items()}}
    for name in all_processed:
        for key in sorted(rows_by_key):
            actual_split = split_for_date(key[0], config["splits"])
            holdout_masked = actual_split == "final_holdout" and name not in shortlisted
            entry_date, exit_date = forward_dates.get(key, (None, None))
            factor_value_rows.append(
                {
                    "date": key[0],
                    "instrument": key[1],
                    "factor_name": name,
                    "factor_raw": all_raw[name].get(key),
                    "factor_clean": all_clean[name].get(key),
                    "factor_processed": all_processed[name].get(key),
                    "forward_return": None if holdout_masked else forward_returns.get(key),
                    "entry_date": None if holdout_masked else entry_date,
                    "exit_date": None if holdout_masked else exit_date,
                    "tradable": rows_by_key[key]["tradable"],
                    "split": actual_split,
                    "quality_flags": (
                        "holdout_masked_not_selected"
                        if holdout_masked
                        else status_by_factor.get(name, {}).get(key, "combined")
                    ),
                }
            )

    daily_records = [
        row for row in selection_daily + combo_daily if row["split"] in {"discovery", "validation"}
    ] + [row for row in holdout_daily if row["split"] == "final_holdout"]
    backtest_records = [
        row
        for row in selection_backtest_daily + combo_backtest_daily
        if row["split"] in {"discovery", "validation"}
    ] + [row for row in holdout_backtest_daily if row["split"] == "final_holdout"]
    daily_records.sort(key=lambda row: (row["factor_name"], row["date"]))
    backtest_records.sort(key=lambda row: (row["factor_name"], row["date"]))

    run_id = f"{config['research']['research_id']}-{json_hash(config)[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    trial_rows: list[dict[str, Any]] = []
    for index, name in enumerate(all_definitions, start=1):
        trial_rows.append(
            {
                "run_id": run_id,
                "trial_id": f"trial-{index:04d}",
                "parent_trial_id": "" if name in base_definitions else "combination-search",
                "factor_name": name,
                "factor_kind": all_definitions[name].get("kind", "combination"),
                "parameters_json": json.dumps(all_definitions[name], ensure_ascii=False, sort_keys=True),
                "dataset_id": config["data"]["dataset_id"],
                "universe_id": config["universe"]["universe_id"],
                "config_hash": json_hash(config),
                "split_role": "discovery+validation+frozen_final_holdout" if name in shortlisted else "discovery+validation",
                "status": "succeeded",
                "failure_reason": "",
                "holdout_seen": str(name in shortlisted).lower(),
                "created_at": now,
            }
        )
    for rejection in expansion_rejections + combo_rejections:
        trial_rows.append(
            {
                "run_id": run_id,
                "trial_id": f"trial-{len(trial_rows) + 1:04d}",
                "parent_trial_id": "candidate-expansion",
                "factor_name": rejection["definition"].get("name", "budgeted_candidate"),
                "factor_kind": rejection["definition"].get("kind", "combination"),
                "parameters_json": json.dumps(rejection["definition"], ensure_ascii=False, sort_keys=True),
                "dataset_id": config["data"]["dataset_id"],
                "universe_id": config["universe"]["universe_id"],
                "config_hash": json_hash(config),
                "split_role": "not_evaluated",
                "status": "skipped",
                "failure_reason": rejection["reason"],
                "holdout_seen": "false",
                "created_at": now,
            }
        )

    metrics = {
        "schema_version": "alpha.quant_factor_mining_metrics.v1",
        "run_id": run_id,
        "status": "RESEARCH_ONLY",
        "selection_protocol": "ranked_on_discovery_and_validation_only_then_frozen_before_final_holdout",
        "configuration_hash": json_hash(config),
        "validation_warnings": validation["warnings"],
        "shortlisted_for_holdout": shortlisted,
        "factor_metrics": all_summaries,
        "backtest_metrics": all_backtests,
        "preprocessing_audit": preprocessing_audit,
        "limitations": [
            "point-in-time and historical-universe claims are declared by config, not independently verified",
            "selection score is a configured research ranking, not statistical proof or production approval",
            "multiple-testing correction, HAC/block bootstrap, impact, capacity, borrow, queues, T+1 inventory and lot rounding are not modeled",
            "final holdout is reported only for the frozen shortlist; unselected holdout outcomes are masked",
        ],
    }
    strategy_payload = {
        "schema_version": "alpha.quant_factor_strategy_candidates.v1",
        "run_id": run_id,
        "status": "RESEARCH_ONLY",
        "selection_protocol": metrics["selection_protocol"],
        "top_single_factors": top_single_payload,
        "top_combinations": top_combo_payload,
        "invalidation_rules": config["research"]["invalidation_rules"],
        "not_evaluable": [
            "market_impact_capacity",
            "borrow_availability",
            "order_queue_and_partial_fill",
            "independent_point_in_time_audit",
            "shadow_performance",
        ],
    }

    (output_dir / "research_config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "mining_config.json").write_text(
        json.dumps(original_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(output_dir / "trial_ledger.csv", trial_rows)
    write_csv(output_dir / "candidate_ranking.csv", all_rankings)
    write_csv(output_dir / "factor_correlation.csv", base_correlations + combo_correlations)
    write_csv(output_dir / "factor_values.csv", factor_value_rows)
    write_csv(output_dir / "daily_metrics.csv", daily_records)
    (output_dir / "factor_metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    write_csv(output_dir / "backtest_daily.csv", backtest_records)
    (output_dir / "top_single_factors.json").write_text(
        json.dumps(top_single_payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    (output_dir / "top_combinations.json").write_text(
        json.dumps(top_combo_payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    (output_dir / "strategy_candidates.json").write_text(
        json.dumps(strategy_payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    (output_dir / "mining_report.md").write_text(
        build_mining_report(
            config,
            single_ranking,
            combo_ranking,
            top_singles,
            top_combos,
            all_definitions,
            validation["warnings"],
        ),
        encoding="utf-8",
    )
    return {
        "status": "RESEARCH_ONLY",
        "run_id": run_id,
        "single_candidates": len(single_ranking),
        "combination_candidates": len(combo_ranking),
        "top_single_factors": top_singles,
        "top_combinations": top_combos,
        "output_dir": str(output_dir.resolve()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mine, de-redund, combine, and holdout-test A-share quantitative factors"
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        result = run_mining(args.config, args.output_dir, args.overwrite)
    except (OSError, ValueError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

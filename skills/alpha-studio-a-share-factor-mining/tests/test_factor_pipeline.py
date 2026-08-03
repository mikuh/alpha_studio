from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from run_factor_research import run  # noqa: E402
from mine_quant_factors import run_mining  # noqa: E402
from validate_research_config import validate_config  # noqa: E402


class FactorPipelineTest(unittest.TestCase):
    def build_fixture(self, root: Path) -> Path:
        panel_path = root / "panel.csv"
        start = date(2020, 1, 1)
        instruments = [f"{600000 + index:06d}.SH" for index in range(40)]
        with panel_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "date",
                    "instrument",
                    "close",
                    "tradable",
                    "industry",
                    "float_market_cap",
                    "alpha_column",
                    "quality_column",
                    "holdout_only_alpha",
                ],
            )
            writer.writeheader()
            for day_index in range(170):
                day = (start + timedelta(days=day_index)).isoformat()
                for instrument_index, instrument in enumerate(instruments):
                    quality = instrument_index % 5
                    drift = (instrument_index - 19.5) * 0.00003 + (quality - 2) * 0.0003
                    close = (10.0 + instrument_index * 0.1) * ((1.0 + drift) ** day_index)
                    writer.writerow(
                        {
                            "date": day,
                            "instrument": instrument,
                            "close": f"{close:.10f}",
                            "tradable": "true",
                            "industry": f"industry-{instrument_index % 4}",
                            "float_market_cap": 1_000_000_000 + instrument_index * 10_000_000,
                            "alpha_column": instrument_index,
                            "quality_column": quality,
                            "holdout_only_alpha": instrument_index if day_index >= 106 else 0,
                        }
                    )

        config = {
            "schema_version": "alpha.quant_factor_research.v1",
            "research": {
                "research_id": "synthetic-momentum-test",
                "hypothesis": "persistent synthetic cross-sectional drift creates measurable momentum",
                "falsifiable_prediction": "momentum has positive RankIC in validation and holdout",
                "invalidation_rules": ["validation RankIC is not positive"],
            },
            "data": {
                "input_csv": "panel.csv",
                "dataset_id": "synthetic-pit-v1",
                "point_in_time": True,
                "columns": {
                    "date": "date",
                    "instrument": "instrument",
                    "signal_price": "close",
                    "fill_price": "close",
                    "tradable": "tradable",
                    "industry": "industry",
                    "market_cap": "float_market_cap",
                },
            },
            "universe": {
                "market": "CN_A",
                "universe_id": "synthetic-historical-v1",
                "historical_membership": True,
                "include_delisted": True,
            },
            "timing": {
                "signal_time": "after_close_t",
                "fill_time": "close_t_plus_1",
                "entry_lag": 1,
                "holding_period": 5,
                "rebalance_every": 1,
            },
            "splits": {
                "discovery": {"start": "2020-01-01", "end": "2020-02-29"},
                "validation": {"start": "2020-03-01", "end": "2020-04-15"},
                "final_holdout": {"start": "2020-04-16", "end": "2020-06-18"},
            },
            "preprocessing": {
                "winsorize": "none",
                "standardize": "rank",
                "neutralize": [],
            },
            "factors": [
                {"name": "momentum_20", "kind": "momentum", "lookback": 20, "sign": 1},
                {
                    "name": "custom_alpha",
                    "kind": "column",
                    "source_column": "alpha_column",
                    "sign": 1,
                },
            ],
            "combination": {
                "name": "combined_alpha",
                "weights": {"momentum_20": 0.5, "custom_alpha": 0.5},
                "minimum_available": 2,
            },
            "evaluation": {
                "quantiles": 5,
                "min_cross_section": 20,
                "cost_bps": 5,
                "annualization": 252,
            },
            "guardrails": {
                "record_all_trials": True,
                "final_holdout_single_use": True,
                "allow_same_close_fill": False,
            },
        }
        config_path = root / "config.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        return config_path

    def test_pipeline_calculates_momentum_and_combination(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = self.build_fixture(root)
            output_dir = root / "run"
            metrics = run(config_path, output_dir)

            validation_rank_ic = metrics["factor_metrics"]["momentum_20"]["validation"]["rank_ic"]
            holdout_rank_ic = metrics["factor_metrics"]["momentum_20"]["final_holdout"]["rank_ic"]
            self.assertGreater(validation_rank_ic["mean"], 0.99)
            self.assertGreater(holdout_rank_ic["mean"], 0.99)
            self.assertIn("combined_alpha", metrics["factor_metrics"])
            self.assertGreater(
                metrics["backtest_metrics"]["combined_alpha"]["validation"]["days"], 0
            )
            for filename in (
                "research_config.json",
                "trial_ledger.csv",
                "factor_values.csv",
                "daily_metrics.csv",
                "factor_metrics.json",
                "backtest_daily.csv",
                "factor_report.md",
            ):
                self.assertTrue((output_dir / filename).is_file(), filename)

    def test_same_bar_fill_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = self.build_fixture(Path(directory))
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["timing"]["entry_lag"] = 0
            result = validate_config(config)
            self.assertTrue(
                any("entry_lag=0" in error for error in result["errors"]), result
            )

    def test_industry_and_market_cap_neutralization_runs_cross_sectionally(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = self.build_fixture(root)
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["preprocessing"]["neutralize"] = ["industry", "log_market_cap"]
            config_path.write_text(json.dumps(config), encoding="utf-8")

            metrics = run(config_path, root / "neutralized-run")
            audit = metrics["preprocessing_audit"]["momentum_20"]
            self.assertTrue(any(day["neutralization"] == "applied" for day in audit))
            self.assertGreater(
                metrics["factor_metrics"]["momentum_20"]["validation"]["rank_ic"]["count"],
                0,
            )

    def test_miner_generates_candidates_de_redunds_combinations_and_freezes_holdout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = self.build_fixture(root)
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["research"]["research_id"] = "synthetic-bounded-mining-test"
            config["factors"] = [
                {
                    "name": "custom_alpha",
                    "kind": "column",
                    "source_column": "alpha_column",
                    "sign": 1,
                },
                {
                    "name": "quality_alpha",
                    "kind": "column",
                    "source_column": "quality_column",
                    "sign": 1,
                },
                {
                    "name": "holdout_only_alpha",
                    "kind": "column",
                    "source_column": "holdout_only_alpha",
                    "sign": 1,
                },
            ]
            config.pop("combination", None)
            config["mining"] = {
                "enabled": True,
                "candidate_templates": [
                    {
                        "kind": "reversal",
                        "name_prefix": "reversal",
                        "lookbacks": [5],
                        "signs": [1],
                    },
                    {
                        "kind": "low_volatility",
                        "name_prefix": "low_volatility",
                        "lookbacks": [5],
                        "signs": [1],
                    },
                ],
                "max_factor_candidates": 12,
                "top_single_factors": 2,
                "top_combinations": 2,
                "combination_pool_size": 3,
                "combination_sizes": [2],
                "weight_schemes": ["equal", "validation_ic"],
                "require_combination_increment": True,
                "max_combination_candidates": 10,
                "max_pair_correlation": 0.999,
                "selection": {
                    "min_validation_rank_ic_days": 10,
                    "min_validation_coverage": 0.8,
                    "min_validation_rank_ic": 0.0,
                    "min_validation_net_sharpe": None,
                    "require_discovery_validation_same_sign": True,
                    "metric_weights": {
                        "rank_ic": 0.3,
                        "rank_ic_ir": 0.1,
                        "rank_ic_positive_ratio": 0.1,
                        "net_sharpe": 0.2,
                        "max_drawdown": 0.1,
                        "turnover": 0.1,
                        "stability": 0.1,
                    },
                },
            }
            config_path.write_text(json.dumps(config), encoding="utf-8")

            output_dir = root / "mining-run"
            result = run_mining(config_path, output_dir)

            self.assertEqual(result["single_candidates"], 5)
            self.assertGreaterEqual(len(result["top_single_factors"]), 1)
            self.assertGreaterEqual(result["combination_candidates"], 1)
            self.assertGreaterEqual(len(result["top_combinations"]), 1)
            self.assertNotIn("holdout_only_alpha", result["top_single_factors"])
            for filename in (
                "candidate_ranking.csv",
                "factor_correlation.csv",
                "top_single_factors.json",
                "top_combinations.json",
                "strategy_candidates.json",
                "mining_report.md",
            ):
                self.assertTrue((output_dir / filename).is_file(), filename)

            with (output_dir / "candidate_ranking.csv").open(
                "r", encoding="utf-8", newline=""
            ) as handle:
                rankings = list(csv.DictReader(handle))
            holdout_only = next(
                row for row in rankings if row["factor_name"] == "holdout_only_alpha"
            )
            self.assertEqual(holdout_only["selected_for_holdout"], "False")
            self.assertEqual(holdout_only["holdout_assessment"], "not_opened")
            selected_combo = next(
                row
                for row in rankings
                if row["candidate_type"] == "combination"
                and row["selected_for_holdout"] == "True"
            )
            self.assertIn(
                selected_combo["combination_increment_assessment"],
                {"adds_validation_value", "no_increment_keep_simpler_factor"},
            )
            self.assertIn(
                "validation_net_sharpe_increment_vs_best_component", selected_combo
            )

            with (output_dir / "factor_values.csv").open(
                "r", encoding="utf-8", newline=""
            ) as handle:
                masked_rows = [
                    row
                    for row in csv.DictReader(handle)
                    if row["factor_name"] == "holdout_only_alpha"
                    and row["split"] == "final_holdout"
                ]
            self.assertTrue(masked_rows)
            self.assertTrue(all(row["forward_return"] == "" for row in masked_rows))
            self.assertTrue(
                all(row["quality_flags"] == "holdout_masked_not_selected" for row in masked_rows)
            )

    def test_miner_can_start_without_a_user_supplied_factor_formula(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = self.build_fixture(root)
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["research"]["research_id"] = "synthetic-auto-discovery-test"
            config["factors"] = []
            config.pop("combination", None)
            config["mining"] = {
                "enabled": True,
                "candidate_templates": [
                    {
                        "kind": "momentum",
                        "name_prefix": "momentum",
                        "lookbacks": [5, 10, 20],
                        "signs": [1],
                    },
                    {
                        "kind": "reversal",
                        "name_prefix": "reversal",
                        "lookbacks": [5],
                        "signs": [1],
                    },
                ],
                "max_factor_candidates": 8,
                "top_single_factors": 1,
                "top_combinations": 1,
                "combination_pool_size": 2,
                "combination_sizes": [2],
                "weight_schemes": ["equal"],
                "require_combination_increment": True,
                "max_combination_candidates": 4,
                "max_pair_correlation": 0.9,
                "selection": {
                    "min_validation_rank_ic_days": 10,
                    "min_validation_coverage": 0.8,
                    "min_validation_rank_ic": 0.0,
                    "min_validation_net_sharpe": None,
                    "require_discovery_validation_same_sign": True,
                    "metric_weights": {"rank_ic": 0.5, "net_sharpe": 0.5},
                },
            }
            config_path.write_text(json.dumps(config), encoding="utf-8")

            validation = validate_config(config, config_path, check_input=True)
            self.assertFalse(validation["errors"], validation)
            result = run_mining(config_path, root / "auto-discovery-run")
            self.assertEqual(result["single_candidates"], 4)
            self.assertEqual(len(result["top_single_factors"]), 1)
            self.assertTrue(result["top_single_factors"][0].startswith("momentum_"))


if __name__ == "__main__":
    unittest.main()

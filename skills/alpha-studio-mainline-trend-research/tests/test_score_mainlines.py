from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "score_mainlines.py"
SPEC = importlib.util.spec_from_file_location("score_mainlines", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def pillar(strength: int, marginal: int | None, confidence: float = 0.9):
    return {"strength": strength, "marginal": marginal, "confidence": confidence}


class ScoreMainlinesTests(unittest.TestCase):
    def test_domestic_track_disables_overseas_without_penalty(self):
        result = MODULE.score_track(
            {
                "name": "电网设备",
                "pricing_scope": "domestic",
                "pillars": {
                    "policy": pillar(5, 1),
                    "directed_credit": pillar(4, 1),
                    "long_term_capital": pillar(4, 0),
                },
                "execution_checks": {
                    "price_structure": "pass",
                    "valuation": "pass",
                    "market_risk": "pass",
                    "evidence_freshness": "pass",
                },
            }
        )
        self.assertEqual(result["overseas_gate"], "off")
        self.assertEqual(result["pillars"]["overseas_cycle"]["status"], "N/A")
        self.assertEqual(result["resonance_state"], "主升共振")
        self.assertEqual(result["heavy_position_permission"], "允许重仓主线核心")

    def test_policy_only_is_capped_as_single_factor_pulse(self):
        result = MODULE.score_track(
            {
                "name": "低空概念",
                "pricing_scope": "domestic",
                "pillars": {
                    "policy": pillar(5, 1),
                    "directed_credit": pillar(1, None, 0.4),
                    "long_term_capital": pillar(1, 0, 0.4),
                },
            }
        )
        self.assertEqual(result["resonance_state"], "单因子脉冲")
        self.assertEqual(result["grade"], "C")
        self.assertEqual(result["heavy_position_permission"], "禁止重仓，仅观察脉冲")
        self.assertIn("定向信贷", result["false_theme_filter"])

    def test_global_track_requires_overseas_cycle(self):
        result = MODULE.score_track(
            {
                "name": "半导体设备",
                "pricing_scope": "global",
                "pillars": {
                    "policy": pillar(4, 1),
                    "directed_credit": pillar(4, 1),
                    "long_term_capital": pillar(4, 0),
                    "overseas_cycle": pillar(2, -1),
                },
            }
        )
        self.assertEqual(result["overseas_gate"], "on")
        self.assertNotEqual(result["resonance_state"], "主升共振")
        self.assertIn(result["grade"], {"B", "C"})
        self.assertNotEqual(result["heavy_position_permission"], "允许重仓主线核心")

    def test_full_resonance_without_execution_checks_keeps_permission_pending(self):
        result = MODULE.score_track(
            {
                "name": "AI 算力基础设施",
                "pricing_scope": "global",
                "pillars": {
                    "policy": pillar(5, 1),
                    "directed_credit": pillar(5, 1),
                    "long_term_capital": pillar(5, 0),
                    "overseas_cycle": pillar(5, 0),
                },
            }
        )
        self.assertEqual(result["resonance_state"], "主升共振")
        self.assertEqual(
            result["heavy_position_permission"],
            "共振成立，重仓权限待执行闸门确认",
        )


if __name__ == "__main__":
    unittest.main()

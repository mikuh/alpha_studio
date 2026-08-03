import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_tracking_sidecar.py"
SPEC = importlib.util.spec_from_file_location("validate_tracking_sidecar", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def valid_payload():
    return {
        "schema": "alpha.premarket_theme.v2",
        "tradeDate": "2026-08-04",
        "generatedAt": "2026-08-04T08:30:00+08:00",
        "dataCutoff": "2026-08-04T08:25:00+08:00",
        "reportMode": "pre_market",
        "title": "8月4日盘前主题研究",
        "executionGate": {
            "state": "触发后轻仓试错",
            "todayOnlyDo": ["只做主线核心"],
            "todayDoNotDo": ["不追后排"],
            "triggerBeforeAction": ["宽度确认"],
            "failureAction": "失败则只观察",
        },
        "capitalAttackPath": {
            "primaryRoute": "电网中军先行",
            "backupRoute": "AI应用核心回流",
            "invalidationRoute": "容量核心转弱",
            "todayAttackProbability": "57%",
            "rationale": "政策与容量共振",
            "actionCondition": "宽度与容量同时确认",
        },
        "marketSentiment": "trial · 57.8分",
        "previousContinuity": [{"name": "电网", "status": "继续", "action": "继续观察", "evidence": "容量延续"}],
        "risks": ["指数偏弱"],
        "sourceNotes": ["东方财富 · 盘前快照 · 截至08:25"],
        "themes": [{
            "id": "theme-grid",
            "rank": 1,
            "name": "电网设备",
            "grade": "A",
            "conclusion": "触发后只做核心",
            "lifecycle": "fermentation",
            "capitalType": "institutional",
            "attackPath": "中军先行",
            "todayAttackProbability": "57%",
            "researchProbability": "55%",
            "observationWeight": "33%",
            "holdingWindow": {
                "elapsedTradingDays": "1日",
                "estimatedRemainingWindow": "4-12日，模型估计",
                "defaultProtocol": "收盘复核",
                "extensionConditions": ["宽度延续"],
                "exitConditions": ["容量核心转弱"],
            },
            "todayOnlyDo": ["只做中军"],
            "todayDoNotDo": ["不追缩量板"],
            "invalidation": "容量核心转弱",
            "risk": "盘中回落",
            "triggerSpecs": [{
                "id": "grid-core-change",
                "label": "中国西电涨幅不低于2%",
                "evaluator": "quote",
                "subjectCode": "601179.XSHG",
                "field": "changePct",
                "operator": "gte",
                "threshold": 2,
                "confirmForSeconds": 60,
                "dataSource": "eastmoney",
                "actionOnTrigger": "进入二次确认",
                "actionOnFailure": "禁止新开",
            }],
            "stocks": [{
                "name": "中国西电",
                "code": "601179.XSHG",
                "role": "中军",
                "roleRank": 1,
                "authenticity": "A",
                "triggerIds": ["grid-core-change"],
                "entryConditions": ["涨幅与宽度共振"],
                "invalidationConditions": ["放量转负"],
            }],
        }],
    }


class ValidateTrackingSidecarTests(unittest.TestCase):
    def test_accepts_canonical_workbench_contract(self):
        self.assertEqual(MODULE.validate_payload(valid_payload()), [])

    def test_rejects_schema_drift_that_breaks_automatic_import(self):
        payload = valid_payload()
        payload["marketSentiment"] = {"regime": "trial"}
        payload["sourceNotes"] = [{"source": "eastmoney"}]
        payload["themes"][0]["triggerSpecs"][0]["operator"] = ">="
        payload["themes"][0]["stocks"][0]["triggerIds"] = []
        errors = MODULE.validate_payload(payload)
        self.assertTrue(any("marketSentiment" in error for error in errors))
        self.assertTrue(any("sourceNotes" in error for error in errors))
        self.assertTrue(any("canonical names" in error for error in errors))
        self.assertTrue(any("triggerIds" in error for error in errors))


if __name__ == "__main__":
    unittest.main()

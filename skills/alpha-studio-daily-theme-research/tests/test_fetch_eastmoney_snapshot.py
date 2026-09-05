import importlib.util
import json
import sys
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "fetch_eastmoney_snapshot.py"
SPEC = importlib.util.spec_from_file_location("fetch_eastmoney_snapshot", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class FetchEastmoneySnapshotTests(unittest.TestCase):
    def test_transport_failure_retries_once_without_page_size_fallbacks(self):
        with patch.object(
            MODULE.urllib.request,
            "urlopen",
            side_effect=urllib.error.URLError("offline"),
        ) as urlopen:
            result = MODULE.fetch_topic_pool(
                "ZT",
                "20260905",
                10000,
                timeout=0.1,
                retries=1,
                budget=MODULE.CollectionBudget(2),
                circuit_breaker=MODULE.HostCircuitBreaker(),
            )

        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(result["pool_len"], 0)
        self.assertIn("transport failed after 2 attempt", result["error"])
        self.assertNotIn("; pagesize=1000:", result["error"])

    def test_explicit_page_size_rejection_uses_smaller_fallback(self):
        requested_sizes = []

        def fake_urlopen(request, timeout):
            del timeout
            query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
            size = int(query["pagesize"][0])
            requested_sizes.append(size)
            if size != 50:
                raise urllib.error.HTTPError(request.full_url, 413, "too large", None, None)
            return FakeResponse({"data": {"qdate": 20260905, "tc": 1, "pool": [{"c": "000001"}]}})

        with patch.object(MODULE.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = MODULE.fetch_topic_pool(
                "ZT",
                "20260905",
                10000,
                timeout=0.1,
                retries=0,
                budget=MODULE.CollectionBudget(2),
                circuit_breaker=MODULE.HostCircuitBreaker(),
            )

        self.assertEqual(requested_sizes, [10000, 1000, 200, 50])
        self.assertEqual(result["page_size_used"], 50)
        self.assertEqual(result["pool_len"], 1)


if __name__ == "__main__":
    unittest.main()

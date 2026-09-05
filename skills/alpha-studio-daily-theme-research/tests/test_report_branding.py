import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from apply_report_branding import apply_branding, DEFAULT_LOGO
from validate_report import validate


class ReportBrandingTest(unittest.TestCase):
    def test_default_customer_and_reset_branding_are_consistent_and_portable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.html"
            report.write_text((ROOT / "assets/alpha-studio-report-template.html").read_text())
            apply_branding(report)
            self.assertTrue(validate(report, 8)["ok"])
            self.assertNotIn("Alpha Studio", report.read_text())
            config = root / "branding.json"
            logo = root / "client.png"
            logo.write_bytes(DEFAULT_LOGO.read_bytes())
            name = '客户 & <研究> "品牌"'
            config.write_text(json.dumps({"name": name, "logoPath": str(logo)}))
            apply_branding(report, config)
            self.assertTrue(validate(report, 8, config)["ok"])
            text = report.read_text()
            self.assertIn("客户 &amp; &lt;研究&gt; &quot;品牌&quot;", text)
            self.assertNotIn("元流涌现", text)
            self.assertIn(base64.b64encode(logo.read_bytes()).decode(), text)
            # Customer source files may move after delivery; the HTML remains usable.
            logo.unlink()
            self.assertTrue(validate(report, 8)["ok"])
            apply_branding(report)
            self.assertTrue(validate(report, 8)["ok"])
            self.assertIn("元流涌现", report.read_text())

    def test_validator_rejects_inconsistent_branding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.html"
            report.write_text((ROOT / "assets/alpha-studio-report-template.html").read_text())
            config = root / "branding.json"
            config.write_text(json.dumps({"name": "客户研究"}))
            apply_branding(report, config)
            report.write_text(report.read_text().replace('data-report-brand="name">客户研究', 'data-report-brand="name">Alpha Studio', 1))
            self.assertIn("missing or inconsistent report brand name", validate(report, 8, config)["issues"])
            (root / "report-style.css").write_text('.cover::after { content: "ALPHA STUDIO"; }')
            self.assertIn("report stylesheet still contains an Alpha Studio watermark", validate(report, 8, config)["issues"])


if __name__ == "__main__":
    unittest.main()

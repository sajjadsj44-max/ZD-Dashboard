"""Data rules for the #raGrnLatest block (Rate Database lines refreshed from the latest GRN).

    python3 -m unittest tools/test_grn_latest_data.py
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "zameen-developments" / "index.html").read_text(encoding="utf-8")
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def block(i):
    return json.loads(re.search(rf'<script type="application/json" id="{i}">(.*?)</script>', HTML, re.S).group(1))


G, B = block("raGrnData"), block("raGrnLatest")
RECEIPTS = {(G["sites"][G["items"][ix][0]], grn, date) for ix, date, rate, qty, grn, vi in G["rc"]}


class GrnLatest(unittest.TestCase):
    def test_block_not_empty(self):
        self.assertGreater(len(B["rates"]), 50)
        self.assertEqual(len({r["code"] for r in B["rates"]}), len(B["rates"]))

    def test_every_line_follows_the_source_rule(self):
        """CLAUDE.md: `<source>, DD-Mon-YYYY — <details>`, the effective date the same date, a receipt that exists."""
        for r in B["rates"]:
            with self.subTest(code=r["code"]):
                y, m, d = r["date"].split("-")
                m_ = re.match(r"(.+?) GRN (RCP-\d+), (\d\d-[A-Z][a-z]{2}-\d{4}) — ", r["src"])
                self.assertTrue(m_, r["src"])
                self.assertEqual(m_.group(3), f"{d}-{MON[int(m) - 1]}-{y}")
                self.assertIn((m_.group(1), m_.group(2), r["date"]), RECEIPTS, "cited receipt is in the GRN register")
                self.assertGreater(r["rate"], 0)
                self.assertEqual(r["vs"], "V")

    def test_prev_never_holds_the_new_value(self):
        for r in B["rates"]:
            with self.subTest(code=r["code"]):
                self.assertTrue(r["prev"])
                self.assertNotIn([r["rate"], r["date"]], [p[:2] for p in r["prev"]])

    def test_page_applies_it_to_saved_libraries(self):
        self.assertIn("function raSyncGrnLatest(e,force)", HTML)
        self.assertIn("raSyncGrnLatest(e),e.set=", HTML)
        self.assertIn('raSyncGrnLatest(RA, true)', HTML)


if __name__ == "__main__":
    unittest.main()

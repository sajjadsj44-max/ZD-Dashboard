"""Tests for the rate-refresh data block (#raRefreshData), written by tools/ra_refresh_data.py.

    python3 -m unittest tools/test_ra_refresh_data.py

Browser checks (fresh library, a library saved before the block, a rate typed by hand): tools/test_ra_refresh.js.
"""
import datetime as dt
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ra_refresh_data as rf  # noqa: E402
from civil_gap_data import Mrs  # noqa: E402
from qs_engine_data import Grn  # noqa: E402

HTML = Path(__file__).resolve().parent.parent / "zameen-developments" / "index.html"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def block(html, bid):
    m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % bid, html, re.S)
    return json.loads(m.group(1)) if m else None


class RefreshData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        cls.d = block(cls.html, "raRefreshData")
        cls.rates = {r["code"]: r for r in cls.d["rates"]}
        cls.as_of = dt.date.fromisoformat(cls.d["asOf"])
        cls.mrs = Mrs(cls.html, cls.as_of)
        cls.market = json.loads(rf.MARKET.read_text(encoding="utf-8"))["lines"]

    def test_block_present_and_merged_last(self):
        self.assertIsNotNone(self.d)
        self.assertIn(rf.LOADER_NEW, self.html)
        self.assertEqual(self.html.count('raBlk("raRefreshData")'), 1)

    def test_every_rate_follows_the_source_rule(self):
        """CLAUDE.md: '<source>, DD-Mon-YYYY — <details>' with the same date as the effective date."""
        for r in self.d["rates"]:
            with self.subTest(code=r["code"]):
                self.assertGreater(r["rate"], 0)
                self.assertIn(r["vs"], ("V", "I"))
                y, m, dd = r["date"].split("-")
                self.assertIn(f"{dd}-{MON[int(m) - 1]}-{y} —", r["src"], "effective date must appear in the remarks")
                self.assertNotIn("ASSUMPTION", r["src"].split(" — ")[0])

    def test_market_lines_are_the_reviewed_ones(self):
        used = [c for c in self.market if c in self.rates]
        self.assertGreater(len(used), 150)
        for code in used:
            with self.subTest(code=code):
                m, r = self.market[code], self.rates[code]
                self.assertEqual((r["rate"], r["date"], r["src"], r["unit"]), (m["rate"], m["date"], m["src"], m["unit"]))
                self.assertTrue(m["url"].startswith("http"), "every market price keeps its page")

    def test_fallbacks_match_their_registers(self):
        pbs = rf.Pbs(self.html)
        grn = Grn(self.html, self.as_of)
        for code, fbs in rf.FALLBACK.items():
            if code in self.market or code not in self.rates:
                continue
            kind, *args = fbs[0]
            r = self.rates[code]
            with self.subTest(code=code, via=kind):
                if kind == "pbs":
                    name, k, _ = args
                    self.assertAlmostEqual(r["rate"], round(pbs.value(name) * k, 4), places=4)
                    self.assertEqual(r["date"], pbs.date)
                elif kind == "mrs":
                    key, which, k, _ = args
                    it = self.mrs.items["MRS-" + self.mrs.resolve(key)]
                    v = {"comp": it["compP"], "lab": it["labP"]}.get(which)
                    if which == "mat":
                        v = it["compP"] - it["labP"]
                    self.assertAlmostEqual(r["rate"], round(v * it["k"] * k, 4), places=3)
                    self.assertEqual(r["date"], self.mrs.meta["from"])
                    self.assertTrue(r["src"].startswith("Punjab MRS 2nd Bi-Annual 2026 (Lahore), 01-Jul-2026"))
                else:
                    site, desc, k, _ = args
                    hits = [it for it in grn.items if it["site"] == site and it["desc"] == desc and it["last"]]
                    last = max((it["last"] for it in hits), key=lambda l: (l["date"], l["grn"]))
                    self.assertAlmostEqual(r["rate"], round(last["rate"] * k, 4), places=4)
                    self.assertEqual(r["date"], last["date"])
                    self.assertTrue(r["src"].startswith(f"{site} GRN "))

    def test_refreshed_lines_carry_their_previous_value(self):
        """Every library line this block moves on lists the value it had before, so a saved library follows."""
        for code in list(self.market) + list(rf.FALLBACK):
            if code in self.rates:
                with self.subTest(code=code):
                    self.assertIn(code, self.d["prevRates"])
                    self.assertNotIn([self.rates[code]["rate"], self.rates[code]["date"]], self.d["prevRates"][code])

    def test_new_items(self):
        ids = [i["id"] for i in self.d["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 80)
        for it in self.d["items"]:
            with self.subTest(item=it["id"]):
                self.assertTrue(it["desc"].endswith("complete in all respects"))
                self.assertIn(it["qc"], {f"C{n:02d}" for n in range(1, 20)})
                rows = it["M"] + it["L"] + it["P"]
                self.assertTrue(rows)
                for row in rows:
                    line = self.rates.get(row["ref"])
                    self.assertIsNotNone(line, row["ref"])
                    self.assertEqual(line["unit"], it["unit"])
                    self.assertGreater(row["qty"], 0)

    def test_new_item_lines_are_the_lahore_register(self):
        for code, qc, qs, cat, desc, key, unit in rf.NEW:
            with self.subTest(item=code):
                it = self.mrs.items["MRS-" + self.mrs.resolve(key)]
                line = self.rates["MRS-" + key]
                k = rf.UNIT_AS_PRINTED[key][1] if key in rf.UNIT_AS_PRINTED else it["k"]
                self.assertAlmostEqual(line["rate"], round(it["compP"] * k, 4), places=4)
                self.assertIn(f"p.{it['page']}", line["src"])

    def test_worked_examples(self):
        # 24" bored pile, 4000 psi: MRS Ch.6 item 8 line 18, composite 3,177.20 per Rft
        self.assertEqual(self.rates["MRS-C6-8-18"]["rate"], 3177.2)
        # road base course printed per 100 Cft: 18,304.65 ÷ 100
        self.assertAlmostEqual(self.rates["MRS-C18-P105-5"]["rate"], 183.0465, places=4)
        # 3/4" MS Sch-40: composite 318.35 less labour 22.10
        self.assertAlmostEqual(self.rates["MEP-Z-MS075"]["rate"], 296.25, places=2)


if __name__ == "__main__":
    unittest.main()

"""Data rules for the #raGrnItems block (new rate analyses from the October-2026 GRNs), written by tools/grn_items_data.py.

    python3 -m unittest tools/test_grn_items_data.py

Browser checks (fresh library, a library saved before the block, a rate typed by hand): tools/test_grn_items.js.
"""
import datetime as dt
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import grn_items_data as gi  # noqa: E402
from qs_engine_data import Grn  # noqa: E402

HTML = Path(__file__).resolve().parent.parent / "zameen-developments" / "index.html"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class GrnItemsData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        cls.d = gi.block(cls.html, gi.BLOCK_ID)
        cls.rates = {r["code"]: r for r in cls.d["rates"]}
        cls.as_of = dt.date.fromisoformat(cls.d["asOf"])
        cls.grn = Grn(cls.html, cls.as_of)
        cls.lib = {}
        for b in gi.SRC_BLOCKS:
            for r in (gi.block(cls.html, b) or {}).get("rates") or []:
                cls.lib[r["code"]] = r

    def test_block_present_and_merged_after_the_refresh(self):
        self.assertIn(gi.LOADER_NEW, self.html)
        self.assertEqual(self.html.count('raBlk("raGrnItems")'), 1)
        self.assertGreaterEqual(len(self.d["items"]), 18)

    def test_block_is_what_the_tool_builds(self):
        """Re-running tools/grn_items_data.py on this page changes nothing (same lines, items and revision)."""
        again = gi.make(self.html, self.as_of)
        self.assertEqual(again["rev"], self.d["rev"])
        self.assertEqual(again["rates"], self.d["rates"])
        self.assertEqual(again["items"], self.d["items"])

    def test_every_rate_follows_the_source_rule(self):
        """CLAUDE.md: '<source>, DD-Mon-YYYY — <details>', the effective date the same date, a receipt that exists."""
        for r in self.d["rates"]:
            with self.subTest(code=r["code"]):
                self.assertGreater(r["rate"], 0)
                y, m, d = r["date"].split("-")
                day = f"{d}-{MON[int(m) - 1]}-{y}"
                g = re.match(r"(.+?) GRN (RCP-\d+), (\d\d-[A-Z][a-z]{2}-\d{4}) — ", r["src"])
                if r["code"].startswith("MRS-"):
                    self.assertTrue(r["src"].startswith(f"Punjab MRS 2nd Bi-Annual 2026 (Lahore), {day} — "), r["src"])
                    continue
                self.assertTrue(g, r["src"])
                self.assertEqual(g.group(3), day)
                hits = [rc for it in self.grn.items if it["site"] == g.group(1) and it["db"] == r["code"]
                        for rc in it["rc"] if rc["grn"] == g.group(2) and rc["date"] == r["date"]]
                self.assertTrue(any(abs(rc["rate"] - r["rate"]) < 0.005 for rc in hits), "cited receipt in the register")
                self.assertEqual(r["vs"], "V")

    def test_new_lines_do_not_overwrite_library_lines(self):
        for code, r in self.rates.items():
            if code in self.lib:
                with self.subTest(code=code):
                    self.assertEqual(self.lib[code]["rate"], r["rate"])

    def test_items(self):
        ids = [i["id"] for i in self.d["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        others = set()
        for b in gi.SRC_BLOCKS:
            others |= {i["id"] for i in (gi.block(self.html, b) or {}).get("items") or []}
        for it in self.d["items"]:
            with self.subTest(item=it["id"]):
                self.assertNotIn(it["id"], others, "a new item, not one the library already has")
                self.assertEqual((it["oh"], it["prof"], it["wast"]), (8, 10, 0))
                self.assertIn("05-Nov-2026", it["note"])
                rows = it["M"] + it["L"]
                self.assertTrue(it["M"])
                for r in rows:
                    line = self.rates.get(r["ref"]) or self.lib.get(r["ref"])
                    self.assertIsNotNone(line, r["ref"])
                    self.assertEqual(line["unit"], it["unit"], r["ref"])
                    self.assertGreater(r["qty"], 0)
                if it["id"].startswith(("ELE-", "MF-", "MH-", "MP-")):
                    self.assertTrue(all(r["ref"].startswith("MAK-") for r in it["L"]), "installed at a MAK contract rate")


if __name__ == "__main__":
    unittest.main()

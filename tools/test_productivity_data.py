"""Tests for the Productivity tab's data block (#prodData), written by tools/productivity_data.py.

    python -m unittest tools/test_productivity_data.py

Browser checks (estimator maths, wages, coverage, site output check): tools/test_productivity.js.
"""
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import productivity_data as pd  # noqa: E402

HTML = Path(__file__).resolve().parent.parent / "zameen-developments" / "index.html"
DATE = re.compile(r"^((\d{2}-)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}|\d{4}|accessed \d{2}-[A-Z][a-z]{2}-\d{4})$")


def block(html):
    return json.loads(re.search(r'<script type="application/json" id="prodData">(.*?)</script>', html, re.S).group(1))


class ProdData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        cls.d = block(cls.html)
        cls.refs = json.loads(pd.REFS.read_text(encoding="utf-8"))

    def test_block_is_up_to_date(self):
        """Rebuilding from the workbook, the refs file and the page gives the block that is in the page."""
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "index.html"
            shutil.copy(HTML, p)
            pd.main(str(p))
            self.assertEqual(block(p.read_text(encoding="utf-8")), self.d)

    def test_every_source_is_dated(self):
        for k, s in self.d["src"].items():
            self.assertTrue(s.get("t"), k)
            self.assertRegex(s.get("d", ""), DATE, k)

    def test_every_crew_output_names_a_source(self):
        for a in self.d["acts"]:
            self.assertTrue(a["v"], a["id"])
            for v in a["v"]:
                self.assertIn(v["s"], self.d["src"], a["id"])
                self.assertGreater(v["out"], 0, a["id"])
                self.assertTrue(v["crew"], a["id"])
                self.assertIn(v["st"], ("A", "B", "S"), a["id"])
                self.assertTrue(v["ref"], a["id"])
                if v["st"] == "A":
                    self.assertIn("No dated benchmark", v["ref"], a["id"])
                if v["st"] == "S":   # a published constant keeps the figure as printed and a quote
                    self.assertTrue(v.get("orig") and v.get("q"), a["id"])

    def test_every_trade_is_priced(self):
        for a in self.d["acts"]:
            for v in a["v"]:
                for code, n in v["crew"]:
                    self.assertGreater(n, 0)
                    self.assertIn(code, self.d["roles"])
                    self.assertGreater(self.d["wages"][code]["r"], 0, code)
                    self.assertRegex(self.d["wages"][code]["d"], r"^\d{4}-\d{2}-\d{2}$", code)

    def test_constants_become_crews(self):
        """1 m3 of work taking 1 mason-day and 2 beldar-days: 35.3147 cft a day by 1 mason + 2 helpers."""
        hu, out, crew = pd.crew_from_constants({"src_unit": "m3", "labour": [["Mason", 1.0], ["Beldar", 2.0]]})
        self.assertEqual(hu, "cft")
        self.assertAlmostEqual(out, 35.31466672, places=6)
        self.assertEqual(crew, [["L-MASON", 1.0], ["L-HELPER", 2.0]])
        hu, out, crew = pd.crew_from_constants({"src_unit": "10 m2", "labour": [["Beldar", 0.5]]})
        self.assertEqual((hu, crew), ("Sft", [["L-HELPER", 1.0]]))
        self.assertAlmostEqual(out, 107.639104 / 0.5, places=4)

    def test_published_rows_match_the_refs_file(self):
        acts = {a["id"]: a for a in self.d["acts"]}
        for r in self.refs["norms"]:
            v = [x for x in acts[r["act"]]["v"] if x["s"] == r["s"] and x["ref"] == r["ref"]]
            self.assertEqual(len(v), 1, (r["act"], r["s"], r["ref"]))
            hu, out, crew = pd.crew_from_constants(r)
            self.assertAlmostEqual(v[0]["out"], out, places=3)

    def test_library_rows_as_in_the_workbook(self):
        brick = next(a for a in self.d["acts"] if a["id"] == "brick9")
        lib = next(v for v in brick["v"] if v["s"] == "zdra7")
        self.assertEqual((lib["code"], lib["out"], lib["crew"], lib["st"]), ("PR-BRK", 50.0, [["L-MASON", 1.0], ["L-HELPER", 1.5]], "B"))
        fws = next(v for a in self.d["acts"] if a["id"] == "fw_slab" for v in a["v"] if v["s"] == "zdra7")
        self.assertEqual(fws["st"], "A")

    def test_floor_factors_from_the_mrs_register(self):
        L = self.d["lift"]
        self.assertEqual((L["brick"]["base"], L["brick"]["ex"], L["brick"]["add"]), (90.5655, [17.9345, 40.269, 62.603, 100.505], 10.7605))
        self.assertEqual((L["rcc"]["base"], L["rcc"]["add"], L["rcc"]["from"]), (296.0, 60.9, 1))
        self.assertEqual((L["floor"]["base"], L["floor"]["add"]), (80.35, 12.181))

    def test_mrs_cross_check_units_match(self):
        for a in self.d["acts"]:
            if "mrs" in a:
                self.assertGreater(a["mrs"]["lab"], 0, a["id"])
                self.assertRegex(a["mrs"]["ref"], r"^Ch\.\d+ item \w+ line \d+, p\.\d+", a["id"])

    def test_coverage_rows(self):
        self.assertGreaterEqual(len(self.d["cov"]), 20)
        for c in self.d["cov"]:
            self.assertIn(c["s"], self.d["src"], c["m"])
            self.assertGreater(c["lo"], 0, c["m"])
            self.assertGreaterEqual(c["hi"], c["lo"], c["m"])
            self.assertIn(c["mode"], ("cov", "use", "pct"))
            self.assertTrue(c["orig"] and c["q"] and c["url"], c["m"])
            self.assertRegex(c["d"], DATE, c["m"])

    def test_coverage_conversion(self):
        c = pd.coverage({"category": "Paint", "material": "x", "product": "y", "coverage_low": 10, "coverage_high": 12,
                         "coverage_unit": "m2/L", "s": "z"}, 0)
        self.assertEqual((c["lo"], c["hi"], c["u"], c["mode"]), (107.6, 129.2, "Sft/L", "cov"))
        c = pd.coverage({"category": "Tile adhesive", "material": "x", "product": "y", "coverage_low": 4, "coverage_high": 4,
                         "coverage_unit": "kg/m2", "s": "z"}, 0)
        self.assertEqual((c["lo"], c["u"], c["mode"]), (0.3716, "kg per Sft", "use"))


if __name__ == "__main__":
    unittest.main()

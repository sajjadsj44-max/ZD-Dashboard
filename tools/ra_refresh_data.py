#!/usr/bin/env python3
"""Rate refresh of the Rate Analysis library (#raRefreshData), October 2026.

    node tools/ra_library_dump.js base.json --without raRefreshData     # the library as published before
    tools/ra_refresh_data.py --baseline base.json                      # writes zameen-developments/index.html
    tools/ra_refresh_data.py --baseline base.json --as-of 2026-10-18 --html path/to/index.html --report out.md

Sajjad asked on 18-Oct-2026 to bring the library's rates to current market rates and to add the rate
analyses it is missing. This block does both.

1. Rate lines that are still an ASSUMPTION, carry no rate, or are dated more than 12 months before the
   refresh (the page's own "older than 12 months" review flag) take a current dated price, looked for in
   the order Sajjad set:
     a. current market price — a web search of 18-Oct-2026, reviewed line by line (tools/ra_refresh_market.json:
        page, quote and arithmetic for every figure; prices for another spec, another basis or from pages
        that contradict themselves were left out);
     b. PBS Annex-III, latest month, Lahore (#raPbsData);
     c. Punjab MRS 2nd Bi-Annual 2026, District Lahore (#raMrsData). An installed / all-in line takes the
        composite rate; a supply-only material line takes the material share (composite less labour, both
        as printed), since its labour is priced in the items; a labour line takes the labour figure;
     d. the latest GRN of the same material in the GRN Price Register (#raGrnData).
   A line none of these prices keeps its value and flag, and is listed in the report.
2. New rate analyses for work in the 2025–26 project BOQs (D:\\Estimation Folder) that the library has no
   item for: bored piles, tube wells, sewers, road base courses, sheet roofing, steel and aluminium doors and
   windows, joinery, ceilings, electrical distribution and street lighting. Each is the Lahore MRS composite
   for the same work as one line (status I), like the civil block's composite items.

Every line follows CLAUDE.md: `<source>, DD-Mon-YYYY — <details>` with the same date as its effective date.
The page merges this block after the other blocks (raSyncBlk, revision key refRev): a line still at a value
listed in prevRates — the value published before this block — takes the new one; a rate typed by hand is kept.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qs_engine_data import Grn, dmy, rs  # noqa: E402
from civil_gap_data import Mrs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "zameen-developments" / "index.html"
MARKET = Path(__file__).resolve().parent / "ra_refresh_market.json"
BLOCK_RE = re.compile(r'(<script type="application/json" id="raRefreshData">)(.*?)(</script>)', re.S)
PBS_RE = re.compile(r'<script type="application/json" id="raPbsData">(.*?)</script>', re.S)
ANCHOR = '<script type="application/json" id="calcData">'
LOADER_OLD = 'raSyncGrnLatest(e),e.set='
LOADER_NEW = 'raSyncGrnLatest(e),raSyncBlk(e,raBlk("raRefreshData"),"refRev"),e.set='
NOSRC = "ASSUMPTION — no dated source"
STALE_MONTHS = 12


def months_old(date, as_of):
    if not re.match(r"^\d{4}-\d\d-\d\d", date or ""):
        return 10 ** 6
    d = dt.date.fromisoformat(date[:10])
    return (as_of.year - d.year) * 12 + (as_of.month - d.month) - (1 if as_of.day < d.day else 0)


def r4(v):
    return round(v + 1e-12, 4)


# --------------------------------------------------------------------------- PBS
class Pbs:
    """Latest month of the PBS Annex-III table, Lahore column (#raPbsData)."""

    def __init__(self, html):
        m = PBS_RE.search(html)
        if not m:
            sys.exit("PBS block (#raPbsData) not found")
        d = json.loads(m.group(1))
        self.items = [i[0] for i in d["items"]]
        self.units = {i[0]: i[1] for i in d["items"]}
        city = d["cities"].index("Lahore")
        self.month = d["months"][-1]
        self.row = d["r"][-1][city]
        y, mo = map(int, self.month.split("-"))
        nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
        self.date = (nxt - dt.timedelta(days=1)).isoformat()      # prices of that month: its last day

    def value(self, name):
        v = self.row[self.items.index(name)]
        if v is None:
            sys.exit(f"PBS {self.month}: no Lahore figure for {name}")
        return v


# --------------------------------------------------------------------------- build context
class Ctx:
    def __init__(self, html, base, as_of):
        self.as_of = as_of
        self.mrs = Mrs(html, as_of)
        self.pbs = Pbs(html)
        self.grn = Grn(html, as_of)
        self.base = {r["code"]: r for r in base["rates"]}
        self.base_items = {i["id"] for i in base["items"]}
        self.market = json.loads(MARKET.read_text(encoding="utf-8"))["lines"] if MARKET.exists() else {}
        self.rates, self.how, self.items = {}, {}, []

    # -- the four sources, each returning a rate line for an existing library line --------------------
    def keep(self, code):
        b = self.base[code]
        return {k: b[k] for k in ("code", "kind", "name", "unit", "loc") if k in b}

    def from_market(self, code):
        m = self.market[code]
        line = self.keep(code)
        if m["unit"] != line["unit"]:
            sys.exit(f"{code}: market price is per {m['unit']}, the line is per {line['unit']}")
        line.update(rate=m["rate"], date=m["date"], src=m["src"], vs=m.get("vs", "I"))
        return line

    def from_pbs(self, code, name, k, how):
        v = self.pbs.value(name)
        line = self.keep(code)
        rate = r4(v * k)
        src = (f"PBS Monthly Review on Price Indices, Annex-III, {dmy(self.pbs.date)} — Lahore, {name}: "
               f"{rs(v)} {self.pbs.units[name]} ({self.pbs.month[:4]}-{self.pbs.month[5:]} prices)"
               + (f"; {how} = {rs(rate)} per {line['unit']}" if k != 1 or how else ""))
        line.update(rate=rate, date=self.pbs.date, src=src, vs="I")
        return line

    def from_mrs(self, code, key, which, k, how):
        """which: comp (installed / all-in line), mat (supply-only line: composite less labour), lab."""
        at = self.mrs.resolve(key)
        it = self.mrs.items.get("MRS-" + at)
        if not it:
            sys.exit(f"{code}: MRS line {key} not found")
        d = self.mrs.meta
        lab, comp = it["labP"], it["compP"]
        if which == "comp":
            if comp is None:
                sys.exit(f"{code}: MRS {key} has no composite rate")
            v, what = comp, f"composite {comp:,.2f}"
        elif which == "lab":
            if lab is None:
                sys.exit(f"{code}: MRS {key} has no labour rate")
            v, what = lab, f"labour {lab:,.2f}"
        else:
            if comp is None or lab is None:
                sys.exit(f"{code}: MRS {key} needs both labour and composite for a material share")
            v, what = comp - lab, (f"{MAT}: composite {comp:,.2f} less labour {lab:,.2f} = {comp - lab:,.2f}")
        per = re.sub(r"^(per|p)\.?\s*", "", it["mrsUnit"], flags=re.I)
        rate = r4(v * it["k"] * k)
        line = self.keep(code)
        src = (f"{self.mrs.edition()}, {dmy(d['from'])} — {it['ref']} ({self.mrs.ch[it['ch']]}), p.{it['page']}, "
               f"\"{(it['path'])[:110]}\"; {what} per {per} as printed"
               + (f", converted to per {it['unit']}" if it["k"] != 1 else "")
               + (f"; {how}" if how else "") + f" = {rs(rate)} per {line['unit']}; valid {dmy(d['from'])} to {dmy(d['to'])}")
        if it["xc"] == -1:
            src += f". MRS British and metric figures disagree for this line — verify on p.{it['page']}"
        line.update(rate=rate, date=d["from"], src=src, vs="I")
        return line

    def from_grn(self, code, site, desc, k, how):
        # the same description can sit under two item codes of a site: the newest receipt of them is the price
        hits = [it for it in self.grn.items if it["site"] == site and it["desc"] == desc and it["last"]]
        if not hits:
            sys.exit(f"{code}: GRN item {site} / {desc!r} not found")
        it = max(hits, key=lambda it: (it["last"]["date"], it["last"]["grn"]))
        l = it["last"]
        line = self.keep(code)
        rate = r4(l["rate"] * k)
        src = self.grn.remark(it) + (f"; {how} = {rs(rate)} per {line['unit']}" if k != 1 or how else "")
        line.update(rate=rate, date=l["date"], src=src, vs="V" if l["vendor"] else "I")
        return line

    # -- new lines and items -----------------------------------------------------------------------
    def add(self, line):
        old = self.rates.get(line["code"])
        if old and old != line:
            sys.exit(f"rate line {line['code']} defined twice with different content")
        self.rates[line["code"]] = line
        return line["code"]

    def M(self, key, which="comp"):
        """An MRS line as a rate line of its own (same code as the register's + Rate DB button)."""
        line = self.mrs.line(key, "comp" if which == "comp" else "lab")
        if line["code"] in self.base and self.base[line["code"]]["rate"] != line["rate"]:
            sys.exit(f"{line['code']} is already in the library at another rate")
        return self.add(line)

    def item(self, code, qc, qs, cat, desc, spec, unit, M=(), L=(), P=(), wast=0, note=""):
        if code in self.base_items or any(i["id"] == code for i in self.items):
            sys.exit(f"item {code} already exists")
        for rows in (M, L, P):
            for r in rows:
                if r["ref"] not in self.rates and r["ref"] not in self.base:
                    sys.exit(f"{code}: rate line {r['ref']} is neither new nor a library line")
        self.items.append({"id": code, "code": code, "cat": cat, "sub": qs, "qc": qc, "qs": qs, "desc": desc,
                           "spec": spec, "unit": unit, "M": list(M), "L": list(L), "P": list(P), "wast": wast,
                           "oh": 8, "prof": 10, "acc": 0, "trans": 0, "gen": None, "note": note})


def row(ref, qty, note=""):
    r = {"ref": ref, "qty": r4(qty)}
    if note:
        r["note"] = note
    return r


# =========================================================================== 1. refresh of existing lines
# fallbacks after the market price, tried in order: ("pbs", item, factor, how) | ("mrs", key, comp|mat|lab,
# factor, how) | ("grn", site, description, factor, how). A GRN of the same item received within GRN_MARKET_DAYS
# of the refresh is an actual Lahore purchase at today's prices and is listed first (CLAUDE.md: a current dated
# Lahore market rate first); an older GRN is the last resort. Each pairing was checked by hand against the
# register's own wording (item, size, unit) — see docs/rate-refresh-2026-10.md.
GRN_MARKET_DAYS = 90
MAT = "material share (installation is priced in the items)"
FALLBACK = {
    # ---- labour: PBS survey of Lahore day wages (the Punjab minimum wage, 40,000 / 26 = 1,538, is the floor)
    "L-HELPER": [("pbs", "Labour (unskilled)", 1, "")],
    # ---- ready-mix concrete: what Lahore sites paid in Sep-2026 (above all national price guides)
    "RMC-5000": [("grn", "DTR", "Concrete 5000 PSI", 1, "")],
    "RMC-6000": [("grn", "GVR", "Concrete 6000 PSI", 1, "")],
    "RMC-LEAN": [("grn", "Vault", "Lean Strength Concrete SRM PSI", 1, "")],
    # ---- civil all-in benchmarks the Lahore MRS prints
    "BM-CV-031": [("mrs", "C6-12-3", "comp", 1, "welded mesh at the MRS Grade-60 bar fabrication rate, as the benchmark")],
    "BM-CV-111": [("mrs", "C9-48-3", "comp", 1, "")],
    "BM-CV-122": [("mrs", "C18-10-3", "comp", 0.02, "per inch per 100 Sft × 2 inch ÷ 100")],
    # ---- finishes / joinery / façade
    "DOOR-W": [("mrs", "C12-12-1", "mat", 1, "")],
    "MAT-ACCP": [("mrs", "C9-54-1", "comp", 1, "")],
    "MAT-CPT": [("mrs", "C10-60-1", "comp", 1, "")],
    "MAT-ACP": [("grn", "Quadrangle", "Aluminium Composite Panel 4mm Thickness (Eurobond)", 1, "")],
    "MEP-Z-MIRROR": [("mrs", "C19-55-1", "mat", 1, "6 mm glass in the MRS line")],
    "SS-RAIL": [("mrs", "C25-38-1", "mat", 1, "")],
    "GRN-QUA-ARC-000002": [("grn", "Quadrangle", "Signage Board 3D Black & White Acrylic Words 24.5'x5'", 67.5,
                            "per Sft × 15 ft × 4.5 ft")],
    "MAT-LIFT": [("grn", "Quadrangle", "Passenger Elevator", 1, "")],
    # ---- electrical
    "COND-PVC": [("mrs", "C24-3-2", "mat", 1, "")],
    "EARTH": [("mrs", "C24-P186-2", "mat", 1, "")],
    "GRN-QUA-ELE-000593": [("mrs", "C24-10-12", "mat", 1, "")],
    "GRN-QUA-ELE-000692": [("mrs", "C24-10-13", "mat", 1, "")],
    "GRN-QUA-ELE-000693": [("mrs", "C24-10-14", "mat", 1, "")],
    "MEP-Z-FOB": [("mrs", "C24-100-160", "mat", 1, "")],
    "MEP-Z-IPS32": [("mrs", "C24-100-87", "mat", 1, "")],
    "GRN-QUA-ELE-000542": [("grn", "NEO", "Elv DB W/Back Box", 1, "")],
    "GRN-QUA-MEP-002144": [("grn", "Quadrangle", "Emergency Twin Spot 3W 6500K EL50, 6580 3H Wall Mounted", 1,
                            "same fitting, wall-mounted version")],
    "MEP-Z-SPK20": [("grn", "Mall 35", "Wall Mount Speaker TZ-206 TOA; 10-20w", 1, "")],
    # ---- fire alarm
    "GRN-QUA-MEP-000301": [("mrs", "C24-P199-6", "mat", 1, "")],
    "GRN-QUA-MEP-002185": [("mrs", "C24-P199-7", "mat", 1, "")],
    # ---- fire fighting and plumbing valves, strainers, pipe
    "GRN-QUA-MEP-001372": [("grn", "NEO", "DI OS & Y Gate Valve 4\" Dia 100mm", 1, "")],
    "GRN-QUA-MEP-001815": [("grn", "NEO", "Gate Valve 6\" DI Flanged Type PN-16", 1, "")],
    "GRN-QUA-MEP-001816": [("grn", "NEO", "Gate Valve 4\" DI Flanged Type PN-16", 1, "")],
    "GRN-QUA-MEP-001817": [("grn", "NEO", "Gate Valve 3\" DI Flanged Type PN-16", 1, "")],
    "GRN-QUA-MEP-002029": [("grn", "NEO", "DI Strainer 6\" Y Type flanged PN-16", 1, "")],
    "GRN-QUA-MEP-002030": [("grn", "NEO", "DI Strainer 4\" Y Type flanged PN-16", 1, "")],
    "GRN-QUA-MEP-001759": [("grn", "NEO", "Fire Hose Cabinet 4'X2'X10\" Hose Pipe 2-1/2\"X30Mtr &Nozzle", 1, "")],
    "MAT-HRC": [("grn", "NEO", "Fire Hose Cabinet 34''X32''X11'' & Real 1\"X30Mtr & Nozzle", 1, "")],
    "GRN-QUA-MEP-001040": [("grn", "Mall 35", "Isophnic Pipe Clamp 4\" - M110", 1, "")],
    "GRN-QUA-MEP-001670": [("mrs", "C23-42-5", "mat", 1, "")],
    "GRN-QUA-MEP-001793": [("mrs", "C23-42-3", "mat", 1, "")],
    "GRN-QUA-MEP-001913": [("mrs", "C23-42-6", "mat", 1, "")],
    "MEP-Z-GV075": [("mrs", "C23-42-2", "mat", 1, "brass threaded valve in the MRS line")],
    "MEP-Z-GV125": [("mrs", "C23-42-4", "mat", 1, "")],
    "MEP-Z-GV8": [("mrs", "C23-42-12", "mat", 1, "")],
    "MEP-Z-GV10": [("mrs", "C23-42-13", "mat", 1, "")],
    "MEP-Z-YS075": [("mrs", "C23-40-2", "mat", 1, "")],
    "MEP-Z-YS100": [("mrs", "C23-40-3", "mat", 1, "")],
    "MEP-Z-YS125": [("mrs", "C23-40-4", "mat", 1, "")],
    "MEP-Z-YS150": [("mrs", "C23-40-5", "mat", 1, "")],
    "MEP-Z-YS200": [("mrs", "C23-40-6", "mat", 1, "")],
    "SPRINK": [("mrs", "C23-55-1", "mat", 1, "pendent head with flush plate")],
    "MEP-Z-SPRSW": [("mrs", "C23-55-8", "mat", 1, "")],
    "MEP-Z-MS075": [("mrs", "C23-34-2", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "MEP-Z-MS8": [("mrs", "C23-34-12", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "MEP-Z-MS10": [("mrs", "C23-34-13", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "MEP-Z-MS12": [("mrs", "C23-34-14", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "GRN-QUA-MEP-001294": [("mrs", "C23-34-8", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "GRN-QUA-MEP-001295": [("mrs", "C23-34-7", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "GRN-QUA-MEP-001296": [("mrs", "C23-34-6", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "GRN-QUA-MEP-001297": [("mrs", "C23-34-5", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "GRN-QUA-MEP-001298": [("mrs", "C23-34-4", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "MAT-BSP-200": [("mrs", "C23-34-6", "mat", 1, "MRS seamless Sch-40 line includes specials")],
    "MEP-Z-MESH": [("grn", "ARX", "Chicken Wire Mesh 2\"x2\" 14g", 1, "")],
    # ---- HVAC
    "MEP-Z-ALF": [("mrs", "C27-23-2", "mat", 1, "")],
    "MEP-Z-DIFF": [("mrs", "C27-18-1", "mat", 1, "")],
    "MEP-Z-FDC": [("mrs", "C27-21-3", "mat", 1, "")],
    "MEP-Z-FX200": [("mrs", "C27-22-1", "mat", 1, "bellow-type connector in the MRS line")],
    "MEP-Z-NBR13": [("mrs", "C27-11-3", "mat", 1, "12 mm in the MRS line")],
    "MEP-NBR19": [("mrs", "C27-11-4", "mat", 1, "19 mm in the MRS line")],
    "MEP-Z-PE6": [("mrs", "C27-12-1", "mat", 1, "5 mm PE on a 3/4\" pipe in the MRS line")],
}


def candidates(c):
    out = []
    for code, b in c.base.items():
        if b.get("vs") == "A" or not b.get("rate") or months_old(b.get("date"), c.as_of) >= STALE_MONTHS:
            out.append(code)
    return out


def refresh(c):
    report = []
    for code in candidates(c):
        b = c.base[code]
        why = "assumption" if b.get("vs") == "A" else "no rate" if not b.get("rate") else f"dated {b.get('date')}"
        line = how = None
        if code in c.market:
            line, how = c.from_market(code), "market"
        else:
            for f in FALLBACK.get(code, []):
                kind = f[0]
                line = (c.from_pbs(code, *f[1:]) if kind == "pbs" else c.from_mrs(code, *f[1:]) if kind == "mrs"
                        else c.from_grn(code, *f[1:]))
                how = kind
                break
        if not line:
            report.append((code, why, "kept", b.get("rate"), None, ""))
            continue
        if months_old(line["date"], c.as_of) >= STALE_MONTHS and not (b.get("vs") == "A" or not b.get("rate")):
            report.append((code, why, "kept (newest source is no newer)", b.get("rate"), None, ""))
            continue
        c.add(line)
        c.how[code] = how
        report.append((code, why, how, b.get("rate"), line["rate"], line["src"]))
    return report


# =========================================================================== 2. new items
# (code, QS category, QS sub-category, description, MRS key, unit, note). Each is the Lahore MRS composite for
# the same work as one line, as the civil block's composite items; overhead 8 % and profit 10 % are the
# library's own, editable per item.
CIV, FIN, PLB, ELE, EXT, MSC = "Civil / Structural", "Finishing", "Plumbing", "Electrical", "External Works", "Miscellaneous"
DONE = " complete in all respects"
PILE = ("Providing and casting in situ bored RCC pile {d}\" dia, {psi} psi, batching-plant concrete by transit "
        "mixer, including boring, equipment and platform (reinforcement cage, concrete pump and admixture paid "
        "separately)" + DONE)
NEW = [
    # ---- piling (Vault, Hive, Jade, GVR) -------------------------------------------------------------
    ("CIV-PIL-101", "C02", "Piling", CIV, PILE.format(d=18, psi=4000), "C6-8-15", "Rft"),
    ("CIV-PIL-102", "C02", "Piling", CIV, PILE.format(d=24, psi=4000), "C6-8-18", "Rft"),
    ("CIV-PIL-103", "C02", "Piling", CIV, PILE.format(d=30, psi=4000), "C6-8-19", "Rft"),
    ("CIV-PIL-104", "C02", "Piling", CIV, PILE.format(d=36, psi=4000), "C6-8-20", "Rft"),
    ("CIV-PIL-105", "C02", "Piling", CIV, PILE.format(d=42, psi=4000), "C6-8-21", "Rft"),
    ("CIV-PIL-106", "C02", "Piling", CIV, PILE.format(d=48, psi=4000), "C6-8-22", "Rft"),
    ("CIV-PIL-107", "C02", "Piling", CIV, PILE.format(d=60, psi=4000), "C6-8-24", "Rft"),
    ("CIV-PIL-108", "C02", "Piling", CIV, PILE.format(d=72, psi=4000), "C6-8-26", "Rft"),
    ("CIV-PIL-109", "C02", "Piling", CIV, PILE.format(d=24, psi=3000), "C6-8-4", "Rft"),
    ("CIV-PIL-110", "C02", "Piling", CIV, PILE.format(d=36, psi=3000), "C6-8-6", "Rft"),
    ("CIV-PIL-111", "C04", "Reinforcement", CIV, "Fabricating Grade-60 deformed bar cage for bored RCC piles, including cutting, "
     "bending, welding, binding wire, rust removal and lowering the cage by crane" + DONE, "C6-11-2", "Kg"),
    # ---- tube well (Hive tube well BOQ) -----------------------------------------------------------------
    ("PLB-TW-101", "C13", "Tube well", PLB, "Boring for tubewell 6\" i/d in all soils except shingle and rock, 0 to 100 ft depth, "
     "including sinking and withdrawing casing pipe" + DONE, "C23-1-4", "Rft"),
    ("PLB-TW-102", "C13", "Tube well", PLB, "Boring for tubewell 8\" i/d, 0 to 100 ft depth, including casing pipe" + DONE, "C23-1-5", "Rft"),
    ("PLB-TW-103", "C13", "Tube well", PLB, "Boring for tubewell 10\" i/d, 0 to 100 ft depth, including casing pipe" + DONE, "C23-1-6", "Rft"),
    ("PLB-TW-104", "C13", "Tube well", PLB, "Boring for tubewell 12\" i/d, 0 to 100 ft depth, including casing pipe" + DONE, "C23-1-7", "Rft"),
    ("PLB-TW-105", "C13", "Tube well", PLB, "Boring for tubewell 8\" i/d, 101 to 200 ft depth, including casing pipe" + DONE, "C23-1-12", "Rft"),
    ("PLB-TW-106", "C13", "Tube well", PLB, "Boring for tubewell 10\" i/d, 101 to 200 ft depth, including casing pipe" + DONE, "C23-1-13", "Rft"),
    ("PLB-TW-107", "C13", "Tube well", PLB, "Boring for tubewell 12\" i/d, 101 to 200 ft depth, including casing pipe" + DONE, "C23-1-14", "Rft"),
    ("PLB-TW-108", "C13", "Tube well", PLB, "Direct / reverse rotary drilling of tubewell bore 15\" to 18\" i/d, ground level to 250 ft, "
     "all soils except shingle, gravel and rock" + DONE, "C23-2-1", "Rft"),
    ("PLB-TW-109", "C13", "Tube well", PLB, "Providing and installing PVC strainer B.S.S. Class-B 6\" i/d in tubewell bore, including sockets "
     "and solvent" + DONE, "C23-8-4", "Rft"),
    ("PLB-TW-110", "C13", "Tube well", PLB, "Providing and installing PVC strainer B.S.S. Class-B 8\" i/d in tubewell bore" + DONE, "C23-8-5", "Rft"),
    ("PLB-TW-111", "C13", "Tube well", PLB, "Providing and installing PVC strainer B.S.S. Class-B 10\" i/d in tubewell bore" + DONE, "C23-8-6", "Rft"),
    ("PLB-TW-112", "C13", "Tube well", PLB, "Providing and installing PVC blind pipe B.S.S. Class-B (6 bar) 6\" i/d in tubewell bore, "
     "jointed with the strainer" + DONE, "C23-13-4", "Rft"),
    ("PLB-TW-113", "C13", "Tube well", PLB, "Providing and installing PVC blind pipe B.S.S. Class-B (6 bar) 8\" i/d in tubewell bore" + DONE, "C23-13-5", "Rft"),
    ("PLB-TW-114", "C13", "Tube well", PLB, "Providing and installing PVC blind pipe B.S.S. Class-B (6 bar) 10\" i/d in tubewell bore" + DONE, "C23-13-6", "Rft"),
    ("PLB-TW-115", "C13", "Tube well", PLB, "Providing and installing MS blind (housing) pipe 8\" i/d, 3/16\" thick, socketed / welded, "
     "with reducers where necessary, in tubewell bore" + DONE, "C23-12-7", "Rft"),
    ("PLB-TW-116", "C13", "Tube well", PLB, "Providing and installing MS blind (housing) pipe 10\" i/d, 1/4\" thick, in tubewell bore" + DONE, "C23-12-9", "Rft"),
    ("PLB-TW-117", "C13", "Tube well", PLB, "Shrouding with graded pea gravel 3/8\" to 1/8\" around tubewell in bore hole, "
     "including wastage" + DONE, "C23-17-1", "Cft"),
    ("PLB-TW-118", "C13", "Tube well", PLB, "Testing and developing tubewell 6\" i/d and above, continuously, discharge up to 1.5 cusec "
     "(per hour of pumping)" + DONE, "C23-16-1", "Hour"),
    # ---- sewers (GVR, external works) --------------------------------------------------------------------
    ("EXT-SWR-101", "C17", "External drainage", EXT, "Providing and laying RCC pipe sewer 9\" i/d, 1\" wall, spigot-socket / collar "
     "joint, to line and grade, jointing, cutting and testing" + DONE, "C21-P125-7", "Rft"),
    ("EXT-SWR-102", "C17", "External drainage", EXT, "Providing and laying RCC pipe sewer Class-II 12\" i/d, jointed with rubber ring, "
     "to line and grade, testing" + DONE, "C21-P125-9", "Rft"),
    ("EXT-SWR-103", "C17", "External drainage", EXT, "Providing and laying RCC pipe sewer Class-II 15\" i/d, rubber-ring joints" + DONE, "C21-P125-10", "Rft"),
    ("EXT-SWR-104", "C17", "External drainage", EXT, "Providing and laying RCC pipe sewer Class-II 18\" i/d, rubber-ring joints" + DONE, "C21-P125-11", "Rft"),
    ("EXT-SWR-105", "C17", "External drainage", EXT, "Providing and laying RCC pipe sewer Class-II 24\" i/d, rubber-ring joints" + DONE, "C21-P125-13", "Rft"),
    # ---- road base courses -------------------------------------------------------------------------------
    ("EXT-RD-101", "C18", "Paving", EXT, "Providing and laying sub-base course of crushed stone aggregate, compacted to required depth, "
     "camber, grade and density" + DONE, "C18-P105-4", "Cft"),
    ("EXT-RD-102", "C18", "Paving", EXT, "Providing and laying base course of crushed stone aggregate with stone screening, mixed, "
     "spread and compacted (consolidated base)" + DONE, "C18-P105-5", "Cft"),
    ("EXT-RD-103", "C18", "Paving", EXT, "Providing and laying bituminous priming coat, 10 lb kerosene and 10 lb binder per 100 Sft" + DONE,
     "C18-P106-2", "Sft"),
    ("EXT-RD-104", "C18", "Paving", EXT, "Providing and laying bituminous tack coat, 5 lb bitumen per 100 Sft" + DONE, "C18-P106-3", "Sft"),
    ("EXT-RD-105", "C18", "Paving", EXT, "Providing and fixing W-beam guard rail, 1/8\" galvanized sheet on galvanized channel posts, "
     "single face" + DONE, "C18-35-1", "Rft"),
    ("EXT-RD-106", "C18", "Paving", EXT, "Supply and installation of rubber speed breaker 20\" x 14\" x 2\"" + DONE, "C18-40-1", "Rft"),
    # ---- roofing, insulation, sheds and fencing (ARX batching plant, plant rooms) -------------------------
    ("CIV-ROF-101", "C07", "Roofing", CIV, "Providing and fixing corrugated galvanized iron sheet roofing 22 BWG with GI bolts, nuts, "
     "limpet and bitumen washers and wind ties (valleys and ridges excluded)" + DONE, "C9-13-2", "Sft"),
    ("CIV-ROF-102", "C07", "Roofing", CIV, "Providing and fixing corrugated galvanized iron sheet roofing 24 BWG with GI bolts, nuts, "
     "washers and wind ties" + DONE, "C9-13-3", "Sft"),
    ("CIV-ROF-103", "C07", "Roofing", CIV, "Plain GI sheet ridging 22 gauge, 6\" lap and 18\" overall, including timber ridge roll" + DONE,
     "C9-29-1", "Rft"),
    ("CIV-ROF-104", "C07", "Roofing", CIV, "Plain 22 gauge GI sheet gutter, semi-circular 8\" dia" + DONE, "C9-30-1", "Rft"),
    ("CIV-ROF-105", "C07", "Roofing", CIV, "Plain GI sheet 22 SWG rain-water down pipe 4\" dia with clamps, fixed" + DONE, "C9-17-1", "Rft"),
    ("CIV-ROF-106", "C07", "Insulation", CIV, "Providing and laying extruded polystyrene (XPS) rigid insulation board 1\" thick, density "
     "32-38 kg/m3, on roof or walls" + DONE, "C9-45-1", "Sft"),
    ("CIV-ROF-107", "C07", "Insulation", CIV, "Providing and laying extruded polystyrene (XPS) rigid insulation board 2\" thick on roof "
     "or walls" + DONE, "C9-45-3", "Sft"),
    ("CIV-ROF-108", "C07", "Roofing", CIV, "Providing and fixing sandwich panels (two steel skins, PU foam core 40 kg/m3) 2\" thick" + DONE,
     "C26-48-1", "Sft"),
    ("CIV-ROF-109", "C19", "Other", MSC, "Supply and erection of car parking shed, 3 mm three-layer fibreglass sheet roof on moulded "
     "curved steel frame" + DONE, "C26-44-1", "Sft"),
    ("EXT-FNC-101", "C17", "External works", EXT, "Providing and fixing hot-dip galvanized chain-link fence 2\"x2\" mesh with flat-iron "
     "stretchers on posts" + DONE, "C26-47-1", "Sft"),
    # ---- steel and aluminium doors, windows, gates ---------------------------------------------------------
    ("MISC-STL-101", "C11", "Doors", MSC, "Providing and fixing steel window with openable glazed panels, beam / Z-section frame, "
     "4 mm glass, without wire gauze" + DONE, "C25-44-4", "Sft"),
    ("MISC-STL-102", "C11", "Doors", MSC, "Providing and fixing MS box-section window, frame 2\"x1-1/2\" 16 SWG, leaves 1-1/2\"x1\" "
     "box section, with glazing" + DONE, "C25-46-1", "Sft"),
    ("MISC-STL-103", "C11", "Doors", MSC, "Providing and fixing iron door, leaves of 1-1/4\"x1-1/4\"x3/16\" MS angle frame with braces "
     "and sheet, with fittings" + DONE, "C25-61-1", "Sft"),
    ("MISC-STL-104", "C11", "Doors", MSC, "Providing and fixing 1-1/2\" thick GI sheet forged door, double-skin pressed 22 SWG panels" + DONE,
     "C25-62-1", "Sft"),
    ("MISC-STL-105", "C11", "Doors", MSC, "Providing and fixing MS louvered door, 16 SWG louvers in 2\"x4\" 16 SWG MS pipe frame" + DONE,
     "C25-68-1", "Sft"),
    ("MISC-STL-106", "C19", "Metal work", MSC, "Providing and fixing collapsible gate, tee-iron top and bottom with channel verticals, "
     "with locking arrangement" + DONE, "C25-40-1", "Sft"),
    ("MISC-STL-107", "C19", "Metal work", MSC, "Providing and fixing 24 SWG GI sheet rolling shutter with MS channel frame, spring box "
     "and locking arrangement" + DONE, "C25-41-1", "Sft"),
    ("MISC-STL-108", "C19", "Metal work", MSC, "Providing and fixing 5 ft dia MS spiral stair, triangular angle-iron steps with "
     "chequered plate, central pipe and railing" + DONE, "C25-63-1", "Rft"),
    ("FAC-ALU-101", "C12", "Aluminium windows", FIN, "Providing and fixing double-glazed aluminium window, 2 mm anodised / powder-coated "
     "deluxe sections, partly fixed and partly sliding, 5 mm glass" + DONE, "C25-55-1", "Sft"),
    ("FAC-ALU-102", "C12", "Aluminium windows", FIN, "Providing and fixing glazed aluminium door 1.6 mm deluxe section, anodised / "
     "powder-coated, partly fixed and partly openable, 8 mm glass" + DONE, "C25-51-2", "Sft"),
    ("FAC-ALU-103", "C12", "Glass partitions", FIN, "Providing and fixing glazed aluminium partition, anodised / powder-coated "
     "sections" + DONE, "C25-56-1", "Sft"),
    ("FAC-ALU-104", "C12", "Aluminium windows", FIN, "Providing and fixing aluminium fly screen, fibre / aluminium wire gauze in "
     "aluminium frame" + DONE, "C25-53-1", "Sft"),
    ("FAC-ALU-105", "C12", "Glass partitions", FIN, "Providing and fixing automatic sliding glass door, 12 mm tempered glass, framed, "
     "with IR sensor, operator and track" + DONE, "C25-70-1", "Sft"),
    # ---- joinery, doors and hardware -------------------------------------------------------------------
    ("FIN-DOR-101", "C11", "Doors", FIN, "Providing and fixing 40 mm factory-made solid-core laminated door, soft-wood frame with "
     "tubular board, MDF laminated both sides, 2 mm PVC lipping, with or without vision panel" + DONE, "C12-68-1", "Sft"),
    ("FIN-DOR-102", "C11", "Doors", FIN, "Providing and fixing 1-1/2\" solid flush door, 2.5 mm commercial ply pressed over 1\" packing "
     "wood" + DONE, "C12-12-1", "Sft"),
    ("FIN-DOR-103", "C11", "Doors", FIN, "Providing and fixing 1-1/2\" solid flush door, 2.5 mm deodar / ash / oak ply with grooves" + DONE,
     "C12-13-1", "Sft"),
    ("FIN-DOR-104", "C11", "Doors", FIN, "Providing and fixing 38 mm factory-made premium WPC door, 5 mm wall thickness (waterproof, "
     "termite-resistant)" + DONE, "C26-50-1", "Sft"),
    ("FIN-DOR-105", "C11", "Doors", FIN, "Providing and fixing imported heavy-duty hydraulic door closer" + DONE, "C12-62-1", "Nos"),
    ("FIN-DOR-106", "C11", "Doors", FIN, "Providing and fixing concealed floor hinge (hydraulic door stopper) with 3 mm SS plate and top "
     "pivot, cutting and making good the floor" + DONE, "C12-63-1", "Nos"),
    ("FIN-DOR-107", "C11", "Doors", FIN, "Providing and fixing imported mortice lever-handle lock with cylinder, lever handles and back "
     "plates" + DONE, "C12-64-1", "Nos"),
    ("FIN-JNR-101", "C11", "Joinery", FIN, "Providing and fixing 24\" deep box-type wardrobe, 3/4\" UV-coated MDF shutters and 3/4\" "
     "laminated MDF box, hot-pressed PVC edge tape and hardware" + DONE, "C12-26-1", "Sft"),
    ("FIN-JNR-102", "C11", "Joinery", FIN, "Providing and fixing box-type kitchen cabinet, 3/4\" both-side laminated MDF shutters and "
     "boxes, 3 mm laminated MDF back, PVC edge binding and self-closing hinges" + DONE, "C12-59-1", "Sft"),
    ("FIN-JNR-103", "C11", "Joinery", FIN, "Providing and fixing roller blinds, polyester fabric on aluminium roller tube with chain "
     "control" + DONE, "C12-69-1", "Sft"),
    ("FIN-JNR-104", "C11", "Joinery", FIN, "Providing and fixing zebra blinds, double-visual polyester fabric on aluminium roller "
     "tube" + DONE, "C12-70-1", "Sft"),
    # ---- ceilings --------------------------------------------------------------------------------------
    ("FIN-CLG-101", "C08", "Tile / grid ceiling", FIN, "Providing and fixing false ceiling of laminated gypsum board tiles 2'x2', "
     "9 mm, on exposed grid" + DONE, "C9-48-3", "Sft"),
    ("FIN-CLG-102", "C08", "Gypsum board ceiling", FIN, "Providing and fixing wooden false ceiling of low-VOC laminated MDF board on "
     "wooden framing and hanging system" + DONE, "C9-53-1", "Sft"),
    ("FIN-CLG-103", "C08", "Gypsum board ceiling", FIN, "Providing and fixing 600 x 600 mm powder-coated aluminium access panel in "
     "false ceiling" + DONE, "C9-54-1", "Nos"),
    # ---- electrical distribution and street lighting ---------------------------------------------------
    ("ELE-DIS-101", "C14", "Distribution", ELE, "Providing and fixing ACB triple pole 800 A, 65 kA (Legrand / GE / Schneider / ABB), "
     "tested and commissioned" + DONE, "C24-88-1", "Nos"),
    ("ELE-DIS-102", "C14", "Distribution", ELE, "Providing and fixing floor-mounted ATS panel, 14 SWG sheet, 15-40 kVA" + DONE,
     "C24-92-1", "Nos"),
    ("ELE-DIS-103", "C14", "Distribution", ELE, "Providing and fixing PFI (power factor improvement) plant 62.5 kVAr with capacitors, "
     "contactors and controller" + DONE, "C24-93-1", "Nos"),
    ("ELE-DIS-104", "C14", "Distribution", ELE, "Supply, installation, testing and commissioning of 415 V 5-pole compact copper busway "
     "400 A" + DONE, "C24-95-1", "Rft"),
    ("EXT-LGT-101", "C14", "Lighting", EXT, "Supply, installation and commissioning of LED street light luminaire 90 W, 12,600 lumens "
     "(140 lm/W)" + DONE, "C24-70-4", "Nos"),
    ("EXT-LGT-102", "C14", "Lighting", EXT, "Supply, installation, testing and commissioning of octagonal street light pole, single arm, "
     "8 m high" + DONE, "C24-69-1", "Nos"),
    # ---- basement waterproofing, interiors and finishes (Jade / Hive / ARX basements, Taif, renovations, NEO roof)
    ("CIV-WP-101", "C07", "Waterproofing", CIV, "Providing and embedding 10\" wide PVC water stopper, 6 mm thick, in expansion / "
     "construction joints of RCC retaining walls, water tanks and slabs" + DONE, "C6-32-1", "Rft"),
    ("CIV-WP-102", "C07", "Waterproofing", CIV, "Providing and embedding 10\" wide PVC water stopper, 10 mm thick, in expansion / "
     "construction joints of RCC retaining walls, water tanks and slabs" + DONE, "C6-32-2", "Rft"),
    ("FIN-INT-101", "C09", "Counter tops", FIN, "Providing, fabricating and laying Corian (acrylic solid-surface) slab / counter 1/2\" "
     "thick, customised size and colour, with cut-outs and joints" + DONE, "C10-49-1", "Sft"),
    ("FIN-INT-102", "C09", "Counter tops", FIN, "Providing, fabricating and laying Corian (acrylic solid-surface) slab / counter 3/4\" "
     "thick, customised size and colour, with cut-outs and joints" + DONE, "C10-49-2", "Sft"),
    ("FIN-INT-103", "C09", "Wall finishes", FIN, "Providing and fixing WPC wall panelling 6-18 mm thick, plain / grooved (fluted), "
     "approved colour and texture, with trims" + DONE, "C11-48-3", "Sft"),
    ("FIN-INT-104", "C09", "Wall finishes", FIN, "Providing and fixing PVC wall panelling, high quality 8-10 mm thick, plain / "
     "grooved, with trims" + DONE, "C11-48-2", "Sft"),
    ("FIN-INT-105", "C12", "Glass partitions", FIN, "Providing and fixing looking glass (mirror) 6 mm thick, best quality, with PVC "
     "edging or 1-1/2\" to 2-1/2\" bevelled edge" + DONE, "C19-55-1", "Sft"),
    ("FIN-INT-106", "C13", "Drainage", PLB, "Providing and fixing stainless steel floor trap jali 6\"x6\", 11 SWG" + DONE,
     "C10-64-1", "Nos"),
    ("FIN-INT-107", "C10", "Wall finishes", FIN, "Providing and fixing plaster of Paris moulding / gola 1-1/2\" wide on wall or "
     "ceiling, approved design" + DONE, "C11-50-2", "Rft"),
    ("FIN-INT-108", "C10", "Wall finishes", FIN, "Providing and fixing PVC moulding / gola 1-1/2\" x 16 mm on wall or ceiling, "
     "approved design" + DONE, "C11-51-3", "Rft"),
    ("FIN-FLR-101", "C09", "Porcelain / ceramic tiles", FIN, "Providing and laying wood-look (textured, full-body porcelain) plank "
     "tile 6\"x36\" / 8\"x36\" / 9\"x36\" with adhesive over 3/4\" bedding, grouted" + DONE, "C10-63-1", "Sft"),
]

# Build-up items: rows from priced lines. Each new material line is a market price found on 18-Oct-2026 (page,
# quote and arithmetic in the line) and its fixing labour the MRS labour of the nearest MRS operation.
NEW_LINES = {
    "MAT-LDRAIN-24": {"code": "MAT-LDRAIN-24", "kind": "M", "name": "Linear shower drain 24\" x 3\", SS304 grating, built-in trap",
                      "unit": "Nos", "rate": 13000.0, "loc": "Lahore", "date": "2026-10-18", "vs": "I",
                      "src": "Web search 18-Oct-2026 — Maxiflow 'Style Sifonik' linear shower drain 60 cm (24\") x 3\", SS304 mesh "
                             "grating on PVC body with built-in siphon trap, 50 mm outlet, Rs 13,000 (daraz.pk listing, National "
                             "Trading Solutions; a local tile-insert type without grating is Rs 5,500)"},
}
BUILT = [
    ("FIN-INT-110", "C13", "Drainage", PLB, "Providing and fixing 24\"x3\" stainless steel linear shower drain channel with grating "
     "and built-in trap, connected to the outlet and sealed to the waterproofing membrane" + DONE, "Nos",
     [("MAT-LDRAIN-24", 1, "drain channel with grating and trap")], [("C10-64-1", 1, "fixing labour as the MRS floor-trap labour")],
     "Washroom renovation BOQs. Material is the dated market price; fixing labour is the Lahore MRS labour for fixing a "
     "6\"x6\" SS floor trap (Ch.10 item 64) — sealing to the membrane is in the waterproofing item."),
]


# MRS lines whose unit cell the register could not read whole (it is split over rows or ditto'd): the unit
# and factor as printed on the page, checked against the PDF (p.132 tube-well boring "Per Rft. / of bore /
# ditto"; p.105 road base "100Cft. of consolidated sub-base").
UNIT_AS_PRINTED = {
    "C23-1-4": ("Rft", 1, "per Rft of bore as printed (unit cell \"Per Rft. / of bore / ditto\")"),
    "C23-1-5": ("Rft", 1, "per Rft of bore as printed (unit cell \"Per Rft. / of bore / ditto\")"),
    "C23-1-6": ("Rft", 1, "per Rft of bore as printed (unit cell \"Per Rft. / of bore / ditto\")"),
    "C23-1-7": ("Rft", 1, "per Rft of bore as printed (unit cell \"Per Rft. / of bore / ditto\")"),
    "C23-1-12": ("Rft", 1, "per Rft of bore as printed"),
    "C23-1-13": ("Rft", 1, "per Rft of bore as printed"),
    "C23-1-14": ("Rft", 1, "per Rft of bore as printed"),
    "C23-2-1": ("Rft", 1, "per Rft of bore as printed"),
    "C18-P105-4": ("Cft", 0.01, "printed per 100 Cft of consolidated sub-base, converted to per Cft"),
    "C18-P105-5": ("Cft", 0.01, "printed per 100 Cft of consolidated base, converted to per Cft"),
}


def mrs_comp(c, key):
    """The MRS composite line for `key` as a rate line (unit fixed where UNIT_AS_PRINTED says so)."""
    if key not in UNIT_AS_PRINTED:
        return c.M(key, "comp")
    line = c.mrs.line(key, "comp")
    it = c.mrs.items["MRS-" + c.mrs.resolve(key)]
    unit, k, how = UNIT_AS_PRINTED[key]
    line["unit"] = unit
    line["rate"] = r4(it["compP"] * k)
    line["src"] = re.sub(r" as printed(, converted to per [^;]+)?;", f" as printed; {how} = {rs(line['rate'])} per {unit};",
                         line["src"], count=1)
    if line["code"] in c.base and c.base[line["code"]]["rate"] != line["rate"]:
        sys.exit(f"{line['code']} is already in the library at another rate")
    return c.add(line)


def new_items(c):
    for code, qc, qs, cat, desc, unit, mats, labs, note in BUILT:
        M = [row(c.add(dict(NEW_LINES[ref])), q, n) for ref, q, n in mats]
        L = [row(c.add(c.mrs.line(key, "lab")), q, n) for key, q, n in labs]
        for r in M + L:
            if c.rates[r["ref"]]["unit"] != unit:
                sys.exit(f"{code}: line {r['ref']} is per {c.rates[r['ref']]['unit']}, the item per {unit}")
        c.item(code, qc, qs, cat, desc, "Build-up: " + ", ".join(r["ref"] for r in M + L), unit, M=M, L=L,
               note=note + " Added 18-Oct-2026.")
    for code, qc, qs, cat, desc, key, unit in NEW:
        ref = mrs_comp(c, key)
        line = c.rates[ref]
        if line["unit"] != unit:
            sys.exit(f"{code}: MRS {key} is per {line['unit']}, the item per {unit}")
        it = c.mrs.items["MRS-" + c.mrs.resolve(key)]
        c.item(code, qc, qs, cat, desc, f"Punjab MRS 2nd Bi-Annual 2026 (Lahore) Ch.{it['ch']} item {it['item']}, line {it['line']}",
               unit, M=[row(ref, 1, f"MRS composite per {unit}")],
               note=(f"Lahore MRS composite for the same work ({it['ref']}, p.{it['page']}), used as one line; it includes "
                     f"material, labour and plant as printed. Overhead and profit are the library's own. Added 18-Oct-2026 "
                     f"from the project BOQs (piling, tube well, external works, plant rooms, interiors)."))


# =========================================================================== block
def make(html, base, as_of):
    c = Ctx(html, base, as_of)
    report = refresh(c)
    new_items(c)
    rates = [c.rates[k] for k in sorted(c.rates)]
    body = json.dumps({"rates": rates, "items": c.items}, ensure_ascii=False, sort_keys=True)
    rev = f"{as_of.isoformat()}-{hashlib.sha1(body.encode()).hexdigest()[:8]}"
    prev = prev_rates(html, c, rates)
    return {"rev": rev, "asOf": as_of.isoformat(),
            "source": "Rate refresh of 18-Oct-2026: market (web) → PBS → Punjab MRS Lahore → GRN; new items from the "
                      "project BOQs (tools/ra_refresh_data.py, docs/rate-refresh-2026-10.md)",
            "rates": rates, "items": c.items, "prevRates": prev, "prevItems": {}}, report


def prev_rates(html, c, rates):
    """The value each refreshed line had before this block (the baseline), plus every value an earlier
    version of this block published for it, so a saved library still holding one moves on."""
    m = BLOCK_RE.search(html)
    old = json.loads(m.group(2)) if m else {}
    prev = {}
    for k, vs in (old.get("prevRates") or {}).items():
        prev[k] = [list(v) for v in vs]
    was = {r["code"]: r for r in old.get("rates") or []}
    for r in rates:
        for o in (c.base.get(r["code"]), was.get(r["code"])):
            if o and (o.get("rate"), o.get("date") or "") != (r["rate"], r["date"]):
                v = [o.get("rate") or 0, o.get("date") or ""]
                if v not in prev.setdefault(r["code"], []):
                    prev[r["code"]].append(v)
    return {k: vs for k, vs in sorted(prev.items()) if vs}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--html", type=Path, default=DEFAULT_HTML)
    ap.add_argument("--baseline", type=Path, required=True, help="tools/ra_library_dump.js output, without this block")
    ap.add_argument("--as-of", default=dt.date.today().isoformat())
    ap.add_argument("--report", type=Path, help="also write the line-by-line report (Markdown)")
    ap.add_argument("--dump", type=Path, help="also write the block to this JSON file")
    a = ap.parse_args()
    html = a.html.read_text(encoding="utf-8")
    base = json.loads(a.baseline.read_text(encoding="utf-8"))
    data, report = make(html, base, dt.date.fromisoformat(a.as_of))
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    if BLOCK_RE.search(html):
        html = BLOCK_RE.sub(lambda m: m.group(1) + js + m.group(3), html)
    else:
        if ANCHOR not in html:
            sys.exit("anchor for the new block not found")
        html = html.replace(ANCHOR, f'<script type="application/json" id="raRefreshData">{js}</script>\n' + ANCHOR, 1)
    if LOADER_NEW not in html:
        if html.count(LOADER_OLD) != 1:
            sys.exit("raLoad: the place to merge the block was not found exactly once")
        html = html.replace(LOADER_OLD, LOADER_NEW)
    a.html.write_text(html, encoding="utf-8")
    if a.dump:
        a.dump.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.report:
        write_report(a.report, report, data)
    kinds = {}
    for code, why, how, *_ in report:
        kinds[how] = kinds.get(how, 0) + 1
    print(f"raRefreshData {data['rev']}: {len(data['rates'])} rate lines, {len(data['items'])} new items; "
          f"refresh {kinds}")


def write_report(path, report, data):
    """Line-by-line record of the refresh (docs/rate-refresh-2026-10.md is written from it)."""
    how_name = {"market": "Market (web, 18-Oct-2026)", "pbs": "PBS Lahore", "mrs": "Punjab MRS Lahore 2nd BA-2026",
                "grn": "GRN (latest purchase)"}
    out = [f"# Rate refresh {data['asOf']} — {data['rev']}", "",
           "| Code | Why it was due | Priced from | Was | Now | Change | Source |", "|---|---|---|---:|---:|---:|---|"]
    for code, why, how, old, new, src in sorted(report, key=lambda r: (r[2].startswith("kept"), r[0])):
        if how.startswith("kept"):
            continue
        ch = f"{(new / old - 1) * 100:+.0f}%" if old else "new value"
        out.append(f"| {code} | {why} | {how_name.get(how, how)} | {rs(old or 0)} | {rs(new)} | {ch} | {src.replace('|', '/')} |")
    kept = [r for r in report if r[2].startswith("kept")]
    out += ["", f"## Kept as they were ({len(kept)})", "", "| Code | Why it was due | Value |", "|---|---|---:|"]
    out += [f"| {c} | {w} | {rs(o or 0)} |" for c, w, h, o, *_ in sorted(kept)]
    out += ["", f"## New items ({len(data['items'])})", "", "| Code | Item | Unit | MRS line |", "|---|---|---|---|"]
    out += [f"| {i['code']} | {i['desc'][:120]} | {i['unit']} | {i['spec']} |" for i in data["items"]]
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

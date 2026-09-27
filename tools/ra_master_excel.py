#!/usr/bin/env python3
"""Update the Master Rate Analysis workbook Rev06 -> Rev07 (reconciled with the dashboard).

    tools/ra_master_excel.py RA_Master_Pakistan_FINAL_Rev06_2026-09-27.xlsx OUT.xlsx
    tools/ra_master_excel.py OUT.xlsx OUT.xlsx --reconcile dash.json   # add sheets 18/19 after the
                                                                        # dashboard has been built and dumped

Step 1 (default) edits the workbook in place of its inputs, keeping every formula live:
  * 05 / 06  Lahore inputs of the resources the dashboard also holds are set to one dated rate
             (tools/ra_master_config.py EXCEL_RATE_UPDATES, sources SRC-39..48 added to 09);
  * 13       crew outputs checked against Punjab MRS 2026 labour shares / MAK installation rates / SRC-06
             piece rates; new productivity codes; columns for per-worker output, crew cost, benchmark and
             deviation; analyses in 04 re-linked to the new codes;
  * 04 / 03  new rate analyses (floor-level extras from MRS, HDPE pipe, landing valve, signage, and vendor
             items with blank red inputs listed in 16 RFQ);
  * 17       Missing Items Register (workbook items vs the dashboard before Rev07, trade-scope gaps);
  * 01 / 02 / 10 / 14 revision notes, wider ranges, new QC checks.
Recalculate with LibreOffice afterwards (tools/ra_master_build.sh does both).

Step 2 (--reconcile) adds 18 DASHBOARD RECONCILIATION (item by item: unit, description, rate in both
files) and 19 REVISION LOG from a JSON dump of the dashboard library.
"""
import argparse
import copy
import datetime as dt
import json
import re
import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ra_master_config as C  # noqa: E402
from qs_engine_data import Grn  # noqa: E402
from civil_gap_data import Mrs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "zameen-developments" / "index.html"
S03, S04, S05, S06, S07, S08 = ("03 MASTER RATE LIBRARY", "04 DETAILED RATE ANALYSIS", "05 MATERIAL RATE LIBRARY",
                                "06 LABOUR RATE LIBRARY", "07 EQUIPMENT RATE LIBRARY", "08 LOCATION RATE LIBRARY")
S13, S16 = "13 PRODUCTIVITY LIBRARY", "16 VENDOR ENQUIRY (RFQ)"
Q = lambda s: f"'{s}'"  # noqa: E731
GREEN = PatternFill("solid", fgColor="FFE2EFDA")
GREY = PatternFill("solid", fgColor="FFD9D9D9")
HEAD = PatternFill("solid", fgColor="FFD6DCE4")
YELLOW = PatternFill("solid", fgColor="FFFFF2CC")
RED = PatternFill("solid", fgColor="FFF8CBAD")
BLUE = PatternFill("solid", fgColor="FFDDEBF7")
BOLD = Font(bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")

# Closest dashboard item for each workbook item (before Rev07), used by the Missing Items Register.
EQUIV = {
    "CIV-CON-001": "RCC-DM-AR-5000", "CIV-CON-002": "RCC-DM-AR-1000", "CIV-CON-003": "RCC-DM-AR-6000",
    "CIV-CON-004": "PCC-136-V", "CIV-CON-005": "RCC-DM-AR-4500", "CIV-CON-006": "RCC-DM-AR-4000",
    "CIV-CON-011": "RCC-DM-AR-3000", "CIV-CON-012": "RCC-DM-AR-4000", "CIV-CON-013": "RCC-DM-AR-4500",
    "CIV-CON-014": "RCC-DM-AR-5000", "CIV-CON-015": "RCC-DM-AR-5500", "CIV-RFT-002": "ST-200",
    "CIV-CON-007": "RCC-DM-ACI-1500", "CIV-CON-008": "RCC-DM-ACI-4000", "CIV-CON-009": "RCC-DM-ACI-4500",
    "CIV-CON-010": "RCC-DM-ACI-6000", "CIV-CON-016": "PCC-148-V", "CIV-CON-017": "RCC-124",
    "CIV-CON-018": "RCC-1153", "CIV-CON-019": "PCC-136-V", "CIV-CON-020": "RCC-RMC-4000",
    "CIV-CON-021": "RCC-RMC-4500", "CIV-CON-022": "RCC-RMC-6000", "CIV-CON-023": "CV-016",
    "CIV-RFT-001": "ST-200", "CIV-MAS-001": "CV-034", "CIV-MAS-002": "BRK-45-14", "CIV-MAS-003": "BLK-H8-16",
    "CIV-MAS-004": "BLK-H6-16", "CIV-MAS-005": "BLK-S4-16", "CIV-MAS-006": "CV-035",
    "FIN-PLS-001": "PLS-I05-14", "FIN-PLS-002": "PLS-I075-16", "FIN-PLS-003": "PLS-E075-14",
    "FIN-PLS-004": "CV-057", "FIN-SCR-001": "CV-067", "FIN-SCR-002": "QS-SCR-2", "FIN-SCR-003": "CV-068",
    "FIN-SCR-004": "SC-420", "CIV-FWK-001": "FW-320", "CIV-FWK-002": "FW-310", "CIV-FWK-003": "FW-300",
    "CIV-FWK-004": "FW-330", "CIV-FWK-005": "FW-340", "CIV-FWK-006": "FW-350", "FIN-WPF-001": "WP-400",
    "FIN-WPF-002": "CV-048", "FIN-WPF-003": "CV-047", "FIN-FLR-001": "FN-500", "FIN-WAL-001": "FN-505",
    "FIN-WAL-002": "QS-TIL-W2448", "FIN-FLR-003": "FN-510", "FIN-FLR-004": "FN-510", "FIN-CLG-001": "FN-550",
    "FIN-CLG-002": "FN-550", "FIN-PNT-001": "FN-535", "FIN-PNT-002": "FN-540", "PRE-GEN-001": "CV-066",
    "PRE-GEN-002": "CV-005", "CIV-EW-001": "CV-008", "CIV-EW-002": "EX-115", "CIV-EW-003": "EX-110",
    "CIV-EW-004": "EX-120", "CIV-EW-005": "CV-013", "CIV-EW-006": "CV-009", "CIV-EW-007": "EX-140",
    "FIN-DOR-002": "CV-087", "FIN-WIN-001": "FN-570", "FIN-WIN-002": "CV-089", "FIN-JNR-001": "CV-095",
    "FAC-CW-001": "CV-098", "FAC-ACP-001": "CV-099", "EXT-PAV-001": "EW-950", "EXT-KRB-001": "CV-119",
    "EXT-RD-001": "CV-120", "EXT-RD-002": "CV-122", "EXT-DRN-001": "EW-960", "EXT-LND-001": "CV-128",
    "PLB-PPR-100": "MP-201A", "PLB-PPR-125": "MP-201B", "PLB-PPR-150": "MP-201C", "PLB-PPR-175": "MP-201D",
    "PLB-PPR-200": "MP-201E", "PLB-PPR-250": "MP-201F", "PLB-PPR-300": "MP-201G", "PLB-PPR-400": "MP-201H",
    "PLB-SWV-200": "MP-301A", "PLB-SWV-300": "MP-301B", "PLB-SWV-400": "MP-301C", "PLB-FIX-001": "PL-720",
    "PLB-FIX-002": "PL-730", "FF-PIP-100": "MF-401A", "FF-PIP-200": "MF-401D", "FF-PIP-400": "MF-401G",
    "FF-SPL-001": "FF-810", "ELE-CND-075": "EL-600", "ELE-CBL-329": "EL-610", "ELE-PNT-001": "EL-615",
    "ELE-PNT-002": "EL-620", "ELE-ERT-001": "EL-660", "ELE-DB-001": "EL-640", "ELV-CCTV-001": "MX-1203",
    "LS-FA-001": "MX-1104", "MEP-HVAC-001": "MH-301", "MEP-HVAC-002": "MN-H10", "MEP-HVAC-003": "MN-H18",
    "MISC-RLG-001": "FN-580", "MISC-GLB-001": "CV-097", "FIN-FLR-005": "CV-081", "FIN-FLR-006": "CV-082",
    "FIN-FLR-007": "CV-080", "FIN-SKT-001": "CV-083",
}
# Trade-scope items found in neither library before Rev07 (keyword sweep of both, 27-Sep-2026)
SCOPE_GAPS = [
    ("PRE", "Mobilization / demobilization", "PRE-GEN-003"), ("PRE", "Site office & establishment", "PRE-GEN-004"),
    ("PRE", "Temporary water & power", "PRE-GEN-005"), ("PRE", "Concrete testing", "PRE-GEN-006"),
    ("PRE", "Final cleaning", "PRE-GEN-007"), ("CIV", "RCC extra labour above ground storey", "CIV-CON-024"),
    ("CIV", "Brickwork extra labour by floor (1st–4th and above)", "CIV-MAS-007..011"),
    ("FIN", "Plaster above 20 ft extra", "FIN-PLS-005"), ("FIN", "Flooring extra per storey", "FIN-FLR-008"),
    ("FIN", "Fire-rated gypsum ceiling", "FIN-CLG-003"), ("FIN", "Metal clip-in ceiling", "FIN-CLG-004"),
    ("FIN", "Ceiling access panel", "FIN-CLG-005"), ("FIN", "Carpet tiles", "FIN-FLR-009"),
    ("FIN", "Wallpaper", "FIN-WAL-003"), ("FIN", "Acoustic wall panels", "FIN-WAL-004"),
    ("FIN", "Frameless glass door", "FIN-DOR-003"), ("FAC", "GRC panels", "FAC-GRC-001"),
    ("FAC", "EIFS", "FAC-EIFS-001"), ("FAC", "Canopy", "FAC-CNP-001"), ("FAC", "Skylight", "FAC-SKY-001"),
    ("PLB", "HDPE pipe", "PLB-HDPE-110"), ("PLB", "CPVC pipe", "PLB-CPVC-100"), ("PLB", "Urinal", "PLB-URN-001"),
    ("FF", "Landing valve", "FF-LV-001"), ("LS", "Fire stopping", "LS-FST-001"), ("ELV", "Access control", "ELV-ACS-001"),
    ("ELE", "Main distribution board", "ELE-MDB-001"), ("HVAC", "VRF system", "MEP-HVAC-004"),
    ("LFT", "Escalator", "LFT-002"), ("EXT", "Irrigation", "EXT-IRR-001"), ("MISC", "Signage", "MISC-SGN-001"),
]


PRICED = {"CIV-CON-024", "CIV-MAS-007", "FIN-PLS-005", "FIN-FLR-008", "PLB-HDPE-110", "FF-LV-001", "MISC-SGN-001"}


def ymd(d):
    return d.isoformat() if isinstance(d, (dt.date, dt.datetime)) else (d or "")


def last_row(ws, col=1):
    r = ws.max_row
    while r > 1 and ws.cell(r, col).value in (None, ""):
        r -= 1
    return r


def find_row(ws, code, col=1, start=5):
    for r in range(start, ws.max_row + 1):
        if ws.cell(r, col).value == code:
            return r
    return None


def style_like(ws, src_row, dst_row, ncol):
    for c in range(1, ncol + 1):
        s, d = ws.cell(src_row, c), ws.cell(dst_row, c)
        if s.has_style:
            d._style = copy.copy(s._style)


# --------------------------------------------------------------------------- dashboard lines
class Lines:
    """Dated rate lines of the dashboard page (MRS register, GRN register) by code."""

    def __init__(self, html, as_of):
        self.mrs = Mrs(html)
        self.grn = Grn(html, as_of)
        self.gby = {it["db"]: it for it in self.grn.items if it["last"]}

    def get(self, code):
        if code.startswith("MRS-"):
            key = code[4:-2] if code.endswith("-L") else code[4:]
            ln = self.mrs.line(key, "lab")
            if ln["code"] != code:
                sys.exit(f"MRS line code mismatch {code} vs {ln['code']}")
            return ln
        if code.startswith("GRN-"):
            it = self.gby.get(code)
            if not it:
                sys.exit(f"GRN line {code} not found")
            return self.grn.line(it["site"], it["desc"])
        return None


# --------------------------------------------------------------------------- step 1
def update(wb, lines):
    log = []
    w05, w06, w07, w08, w04, w03, w13, w16 = (wb[S05], wb[S06], wb[S07], wb[S08], wb[S04], wb[S03], wb[S13],
                                              wb[S16])

    # ---- 05 / 06 rate updates
    for code, (rate, date, status, src, note) in C.EXCEL_RATE_UPDATES.items():
        if code.startswith("LAB-"):
            r = find_row(w06, code)
            old = w06.cell(r, 13).value
            w06.cell(r, 13).value, w06.cell(r, 8).value, w06.cell(r, 9).value = rate, date, status
            w06.cell(r, 10).value, w06.cell(r, 11).value = src, note
        else:
            r = find_row(w05, code)
            old = w05.cell(r, 14).value
            w05.cell(r, 14).value, w05.cell(r, 9).value, w05.cell(r, 10).value = rate, date, status
            w05.cell(r, 11).value, w05.cell(r, 12).value = src, note
            w05.cell(r, 14).fill = YELLOW if status != "GRN verified" else w05.cell(r, 14).fill
        log.append(("Rate", code, old, rate, note))

    # ---- 09 sources
    w09 = wb["09 SOURCE REGISTER"]
    r0 = last_row(w09) + 1
    for i, s in enumerate(C.SOURCES):
        for j, v in enumerate(s):
            w09.cell(r0 + i, j + 1, v)
        style_like(w09, r0 - 1, r0 + i, 6)
    w09["A2"] = "Searched 2026-09-27 (Rev06) and reconciled with the dashboard 2026-09-27 (Rev07, SRC-39..48)."

    # ---- new resources in 05 / 06 (+08 rows)
    r08 = last_row(w08) + 1
    new_rfq = []
    for code, (kind, desc, unit) in C.NEW_RES.items():
        ln = lines.get(code)
        ws = w05 if kind == "M" else w06
        r = last_row(ws) + 1
        style_like(ws, r - 1, r, ws.max_column)
        w08.cell(r08, 1, code), w08.cell(r08, 2, desc), w08.cell(r08, 3, unit)
        style_like(w08, r08 - 1, r08, 15)
        if kind == "M":
            inp = f"{Q(S05)}!N{r}"
            vals = {1: code, 2: desc, 3: ln["name"] if ln else "Vendor supply & install", 4: unit,
                    5: (f"=IF(INDEX({Q(S08)}!$D${r08}:$N${r08},MATCH(City,{Q(S08)}!$D$4:$N$4,0))=\"\",\"\","
                        f"INDEX({Q(S08)}!$D${r08}:$N${r08},MATCH(City,{Q(S08)}!$D$4:$N$4,0)))"),
                    6: None, 7: None, 8: "=City", 9: ln["date"] if ln else None,
                    10: ("GRN verified" if ln and code.startswith("GRN") and ln["vs"] == "V" else
                         "Market indication" if ln else "NO SOURCE"),
                    11: "SRC-48" if ln else "—", 12: (ln["src"] if ln else "No dated source found (web search "
                                                    "27-Sep-2026) – enter a quotation in 16 RFQ."),
                    13: f'=IF(NOT(ISNUMBER(E{r})),0,IF(OR(J{r}="OLD SOURCE",J{r}="UNDATED SOURCE"),2,1))',
                    14: ln["rate"] if ln else None, 15: "City-specific"}
            if ln and (dt.date.fromisoformat(AS_OF) - dt.date.fromisoformat(ln["date"])).days > 365:
                vals[10] = "OLD SOURCE"
        else:
            inp = f"{Q(S06)}!M{r}"
            vals = {1: code, 2: desc, 3: unit,
                    4: (f"=IF(INDEX({Q(S08)}!$D${r08}:$N${r08},MATCH(City,{Q(S08)}!$D$4:$N$4,0))=\"\",\"\","
                        f"INDEX({Q(S08)}!$D${r08}:$N${r08},MATCH(City,{Q(S08)}!$D$4:$N$4,0)))"),
                    5: None, 6: None, 7: "=City", 8: ln["date"], 9: "Govt MRS", 10: "SRC-46",
                    11: ln["src"], 12: f"=IF(ISNUMBER(D{r}),1,0)", 13: ln["rate"]}
        for c, v in vals.items():
            ws.cell(r, c).value = v
        w08.cell(r08, 4).value = f'=IF(ISNUMBER({inp}),{inp},"")'
        w08.cell(r08, 15).value = "City-specific – enter dated local rate"
        if not ln:
            new_rfq.append((code, desc, unit))
        r08 += 1
        log.append(("New resource", code, None, ln["rate"] if ln else None, ln["src"] if ln else "NO SOURCE"))

    # ---- 16 RFQ: new blank inputs
    rr = last_row(w16) + 1
    for code, desc, unit in new_rfq:
        for c, v in {1: "Vendor / sub-contract", 2: code, 3: desc, 4: "Rev07 new item", 5: unit,
                     7: "NO SOURCE"}.items():
            w16.cell(rr, c, v)
        style_like(w16, rr - 1, rr, 12)
        r5 = find_row(w05, code)
        w05.cell(r5, 14).value = f"=IF(ISNUMBER({Q(S16)}!H{rr}),{Q(S16)}!H{rr},\"\")"
        w05.cell(r5, 10).value = f'=IF(ISNUMBER({Q(S16)}!H{rr}),"Vendor quote","NO SOURCE")'
        rr += 1
    w16.auto_filter.ref = f"A4:L{rr - 1}"

    # ---- Rev07a: assumed values for every blank input (fallback behind the RFQ quote cell)
    rfq = {w16.cell(r, 2).value: r for r in range(5, last_row(w16) + 1)}
    for code, (val, basis) in C.ASSUMED.items():
        note = (f"ASSUMPTION — no dated source ({C.ASSUME_DATE}, assumed on request): {basis}. "
                f"Replace with a quotation in 16 RFQ col H.")
        rr = rfq.get(code)
        ws, (cin, cst, csrc, cnote, cdate) = next(
            (wb[s_], cols) for s_, cols in ((S05, (14, 10, 11, 12, 9)), (S06, (13, 9, 10, 11, 8)),
                                            (S07, (9, 5, 6, 7, None))) if find_row(wb[s_], code))
        r = find_row(ws, code)
        old = ws.cell(r, cin).value
        if rr:
            ws.cell(r, cin).value = f"=IF(ISNUMBER({Q(S16)}!H{rr}),{Q(S16)}!H{rr},{val})"
            ws.cell(r, cst).value = f'=IF(ISNUMBER({Q(S16)}!H{rr}),"Vendor quote","ASSUMED")'
            w16.cell(rr, 6).value, w16.cell(rr, 7).value = val, "ASSUMED" if val else "SUPERSEDED"
            w16.cell(rr, 12).value = basis
        else:
            ws.cell(r, cin).value, ws.cell(r, cst).value = val, "ASSUMED"
        ws.cell(r, csrc).value, ws.cell(r, cnote).value = "SRC-49", note
        if cdate:
            ws.cell(r, cdate).value = C.ASSUME_DATE
        ws.cell(r, cin).fill = RED
        log.append(("Assumption", code, None if isinstance(old, str) else old, val, basis))
    # FF pipe items: one fittings line per pipe size
    for item, code in C.FFFIT.items():
        for r in parse_blocks(w04)[item]["rows"]:
            if w04.cell(r, 3).value == "MAT-FFFIT":
                g, k = fmla_res("M", 0, code)
                w04.cell(r, 3).value, w04.cell(r, 7).value, w04.cell(r, 11).value = code, g, k
                w04.cell(r, 4).value = f"Fittings & couplings – {code}"
        log.append(("Relink", item, "MAT-FFFIT", code, "size-specific fittings allowance"))

    # ---- 13 productivity
    wages = {}
    for r in range(5, last_row(w06) + 1):
        v = w06.cell(r, 13).value
        if isinstance(v, str):  # =IF(ISNUMBER(RFQ quote),quote,<assumed wage>)
            v = float(re.findall(r"[\d.]+", v)[-1])
        wages[w06.cell(r, 1).value] = v
    for code, (rate, *_r) in C.EXCEL_RATE_UPDATES.items():
        if code.startswith("LAB-"):
            wages[code] = rate
    hdr = ["Skilled labour code", "Output per skilled worker / day", "Output per worker (whole crew) / day",
           "Crew cost / day PKR", "Labour cost / unit PKR", "Benchmark (dated source)", "Benchmark labour / unit PKR",
           "Crew output implied by benchmark", "Rev06 output", "Rev06 labour / unit at Rev07 wages",
           "Rev06 deviation vs benchmark", "Rev07 status"]
    for j, h in enumerate(hdr):
        c = w13.cell(4, 8 + j, h)
        c._style = copy.copy(w13.cell(4, 7)._style)
    rows13 = {}
    for r in range(5, last_row(w13) + 1):
        rows13[w13.cell(r, 1).value] = r
    nxt = last_row(w13) + 1
    for code, (act, unit, out, sk, hp, skc, blabel, bval, basis) in C.PROD.items():
        r = rows13.get(code)
        rev06 = w13.cell(r, 4).value if r else C.REV06_NEW.get(code)
        if not r:
            r = nxt
            nxt += 1
            rows13[code] = r
            style_like(w13, 5, r, 7)
        crew = sk * (wages.get(skc) or 0) + hp * wages["LAB-HLP"]
        w13.cell(r, 1, code), w13.cell(r, 2, act), w13.cell(r, 3, unit)
        w13.cell(r, 4, out), w13.cell(r, 5, sk), w13.cell(r, 6, hp)
        within = bool(bval and rev06 and abs(crew / rev06 / bval - 1) <= C.TOL)
        status = ("Kept – within ±35% of benchmark" if within and rev06 == out
                  else "Aligned to benchmark (Rev06 was within ±35%)" if within
                  else "Corrected to benchmark" if bval and rev06 and rev06 != out
                  else "New – set from benchmark" if bval and not rev06
                  else "Kept – market band" if bval
                  else "ASSUMPTION – no dated benchmark, confirm by site time study")
        w13.cell(r, 7, f"{basis} Crew: {sk:g} skilled + {hp:g} helper(s).")
        w13.cell(r, 8, skc)
        w13.cell(r, 9, f"=IF(E{r}>0,D{r}/E{r},\"—\")")
        w13.cell(r, 10, f"=D{r}/(E{r}+F{r})")
        w13.cell(r, 11, (f"=E{r}*INDEX({Q(S06)}!$D$5:$D$100,MATCH(H{r},{Q(S06)}!$A$5:$A$100,0))"
                         f"+F{r}*INDEX({Q(S06)}!$D$5:$D$100,MATCH(\"LAB-HLP\",{Q(S06)}!$A$5:$A$100,0))"))
        w13.cell(r, 12, f"=K{r}/D{r}")
        w13.cell(r, 13, blabel)
        w13.cell(r, 14, bval)
        w13.cell(r, 15, f"=IF(ISNUMBER(N{r}),K{r}/N{r},\"—\")")
        w13.cell(r, 16, rev06)
        w13.cell(r, 17, round(crew / rev06, 2) if rev06 else None)
        w13.cell(r, 18, round(crew / rev06 / bval - 1, 3) if (rev06 and bval) else None)
        w13.cell(r, 19, status)
        for c in range(8, 20):
            w13.cell(r, c)._style = copy.copy(w13.cell(r, 7)._style)
        w13.cell(r, 4).fill = YELLOW if not bval else BLUE
        w13.cell(r, 18).number_format = "0%"
        for c in (11, 12, 14, 15, 17):
            w13.cell(r, c).number_format = "#,##0.00"
        if rev06 and rev06 != out:
            log.append(("Productivity", code, rev06, out, basis))
        elif not rev06:
            log.append(("Productivity (new)", code, None, out, basis))
    w13["A2"] = ("Output per crew-day (gang). Labour / unit = (skilled nos × skilled rate + helper nos × helper rate) "
                 "÷ crew output. Rev07: each output checked against a dated benchmark (Punjab MRS 2026 labour share, "
                 "MAK installation rate ÷ 1.18, SRC-06 Lahore piece rate); kept within ±35%, otherwise reset.")
    for col, wdt in zip("HIJKLMNOPQRS", (12, 12, 12, 12, 12, 60, 12, 12, 10, 12, 10, 34)):
        w13.column_dimensions[col].width = wdt

    def pr(code, part):
        r = rows13[code]
        return {"S": f"={Q(S13)}!E{r}/{Q(S13)}!D{r}", "H": f"={Q(S13)}!F{r}/{Q(S13)}!D{r}",
                "P": f"=1/{Q(S13)}!D{r}"}[part]

    # ---- 04 relink
    blocks = parse_blocks(w04)
    for item, pcode in C.RELINK.items():
        b = blocks[item]
        for r in b["rows"]:
            comp, res = w04.cell(r, 2).value, w04.cell(r, 3).value
            if comp == "Labour" and res == "LAB-HLP":
                w04.cell(r, 6).value = pr(pcode, "H")
            elif comp == "Labour":
                w04.cell(r, 6).value = pr(pcode, "S")
            elif comp == "Equipment" and res in ("EQ-VIB", "EQ-MIX") and "13 PRODUCTIVITY" in str(w04.cell(r, 6).value):
                w04.cell(r, 6).value = pr(pcode, "P")
            else:
                continue
            d = str(w04.cell(r, 4).value or "")
            w04.cell(r, 4).value = re.sub(r"PR-[A-Z0-9-]+ crew|\d+(\.\d+)?/\d+|\d\.\d+ day|\d\.\d+$",
                                          f"{pcode} crew", d) if re.search(r"PR-|/\d|\d\.\d", d) else f"{d} – {pcode} crew"
        log.append(("Relink", item, None, pcode, "labour rows now read crew output from 13"))

    # ---- widen lookup ranges everywhere
    widen(wb)

    # ---- new analyses
    add_items(wb, blocks, pr, log)

    # ---- 03 / 02 / 01 / 10 / 14 housekeeping
    n03 = last_row(w03)
    w03.auto_filter.ref = f"A4:AB{n03}"
    for r in range(5, n03 + 1):
        w03.cell(r, 9).value = C.AS_OF
    readme(wb)
    qc(wb)
    missing_register(wb, blocks)
    return log


def parse_blocks(w04):
    blocks, cur = {}, None
    for r in range(1, w04.max_row + 1):
        a, j = w04.cell(r, 1).value, w04.cell(r, 10).value
        if a and isinstance(j, str) and j.startswith("Unit:"):
            cur = {"head": r, "rows": [], "sum": {}}
            blocks[a] = cur
            continue
        if cur is None:
            continue
        if a and w04.cell(r, 2).value in ("Material", "Labour", "Equipment", "Transport"):
            cur["rows"].append(r)
        elif w04.cell(r, 4).value and j is not None and not a:
            cur["sum"][w04.cell(r, 4).value] = r
    return blocks


def widen(wb):
    pats = [(r"(\$[A-Z]\$5:\$[A-Z]\$)180\b", r"\g<1>400"), (r"(06 LABOUR RATE LIBRARY'!\$[A-Z]\$5:\$[A-Z]\$)21\b",
                                                            r"\g<1>100"),
            (r"(07 EQUIPMENT RATE LIBRARY'!\$[A-Z]\$5:\$[A-Z]\$)17\b", r"\g<1>100")]
    ws = wb[S04]
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                v = c.value
                for p, rpl in pats:
                    v = re.sub(p, rpl, v)
                c.value = v


def fmla_res(sheet, col, code, lastcol_code="A"):
    lib = {"M": S05, "L": S06, "P": S07}[sheet]
    valcol = {"M": "E", "L": "D", "P": "D"}[sheet]
    flag = {"M": "M", "L": "L", "P": "H"}[sheet]
    rng = "400" if sheet == "M" else "100"
    g = f'=N(INDEX({Q(lib)}!${valcol}$5:${valcol}${rng},MATCH("{code}",{Q(lib)}!$A$5:$A${rng},0)))'
    k = (f'=IF(INDEX({Q(lib)}!${flag}$5:${flag}${rng},MATCH("{code}",{Q(lib)}!$A$5:$A${rng},0))=1,"",'
         f'IF(INDEX({Q(lib)}!${flag}$5:${flag}${rng},MATCH("{code}",{Q(lib)}!$A$5:$A${rng},0))=2,"OLD RATE","NO RATE"))')
    return g, k


def res_sheet(wb, code):
    for k, s in (("M", S05), ("L", S06), ("P", S07)):
        if find_row(wb[s], code):
            return k
    sys.exit(f"resource {code} not in 05/06/07")


def add_items(wb, blocks, pr, log):
    w04, w03 = wb[S04], wb[S03]
    tmpl = blocks["CIV-RFT-001"]
    r = last_row(w04, 10) + 2
    for it in C.NEW_ITEMS:
        head = r
        w04.cell(r, 1, it["code"]), w04.cell(r, 2, it["desc"]), w04.cell(r, 10, f"Unit: {it['unit']}")
        style_like(w04, tmpl["head"], r, 11)
        r += 1
        for c in range(1, 12):
            w04.cell(r, c).value = w04.cell(tmpl["head"] + 1, c).value
        style_like(w04, tmpl["head"] + 1, r, 11)
        r += 1
        first = r
        for comp, res, desc, unit, cons, wst in it["rows"]:
            kind = res_sheet(wb, res)
            g, k = fmla_res(kind, 0, res)
            if isinstance(cons, str) and cons.startswith("PR:"):
                _, pc, part = cons.split(":")
                cons = pr(pc, part)
            vals = [it["code"], comp, res, desc, unit, cons, g, wst, f"=F{r}*(1+H{r})", f"=I{r}*G{r}", k]
            for c, v in enumerate(vals, 1):
                w04.cell(r, c).value = v
            style_like(w04, tmpl["rows"][0], r, 11)
            r += 1
        last = r - 1
        rng = lambda col: f"{col}{first}:{col}{last}"  # noqa: E731
        summ = [("Material – net (excl. wastage)", f'=SUMPRODUCT(({rng("B")}="Material")*{rng("F")}*{rng("G")})'),
                ("Material – wastage", f'=SUMIF({rng("B")},"Material",{rng("J")})-J{r}'),
                ("Material total", f'=SUMIF({rng("B")},"Material",{rng("J")})'),
                ("Labour total", f'=SUMIF({rng("B")},"Labour",{rng("J")})'),
                ("Equipment total", f'=SUMIF({rng("B")},"Equipment",{rng("J")})'),
                ("Transport / handling total", f'=SUMIF({rng("B")},"Transport",{rng("J")})'),
                ("DIRECT COST", None), ("Site overheads @ OH_Site", None), ("Head-office overheads @ OH_HO", None),
                ("Profit @ Profit", None), ("Rate excl. tax", None), ("Sales tax (only if Tax_On = Yes)", None),
                (f"FINAL RATE per {it['unit']} (rounded)", None),
                ("Blank / old (red) inputs in this analysis",
                 f'=COUNTIF({rng("K")},"NO RATE")+COUNTIF({rng("K")},"OLD RATE")')]
        s0 = r
        f = {6: f"=J{s0+2}+J{s0+3}+J{s0+4}+J{s0+5}", 7: f"=J{s0+6}*OH_Site", 8: f"=J{s0+6}*OH_HO",
             9: f"=J{s0+6}*Profit", 10: f"=J{s0+6}+J{s0+7}+J{s0+8}+J{s0+9}",
             11: f'=IF(Tax_On="Yes",J{s0+10}*N(Tax_Rate),0)', 12: f"=ROUND(J{s0+10}+J{s0+11},0)"}
        src_sum = tmpl["sum"]
        tlabels = list(src_sum.keys())
        for i, (lab, fm) in enumerate(summ):
            w04.cell(r, 4, lab)
            w04.cell(r, 10, fm if fm else f[i])
            if i == 1:
                w04.cell(r, 10).value = f'=SUMIF({rng("B")},"Material",{rng("J")})-J{s0}'
            style_like(w04, src_sum[tlabels[i]], r, 11)
            r += 1
        # 03 row
        m = last_row(w03) + 1
        style_like(w03, m - 1, m, 28)
        cat, qc = C.legacy_cat(it["code"])
        J = lambda k: f"={Q(S04)}!J{s0 + k}"  # noqa: E731
        vals = {1: it["code"], 2: it["trade"], 3: it["sub"], 4: it["cat"], 5: it["desc"], 6: it["spec"],
                7: it["unit"], 8: "=City", 9: C.AS_OF, 10: J(0), 11: J(3), 12: J(4), 13: J(5), 14: J(1), 15: J(6),
                16: f"={Q(S04)}!J{s0 + 7}+{Q(S04)}!J{s0 + 8}", 17: J(9), 18: J(11), 19: J(12), 20: f"=S{m}*100",
                21: f'=IF(W{m}>0,"INCOMPLETE – "&W{m}&" blank/old input(s)","Market-derived + assumptions")',
                22: it.get("conf", "Low"), 23: J(13), 24: "See 09 SOURCE REGISTER (SRC-46..48) and resource notes",
                25: C.AS_OF, 26: "see 09", 27: "Rev07 new item. " + it.get("note", ""),
                28: f'=IF(COUNTIF($A$5:$A$999,A{m})>1,"DUPLICATE","")'}
        for c, v in vals.items():
            w03.cell(m, c).value = v
        log.append(("New item", it["code"], None, it["unit"], it["desc"][:90]))
        r += 1


def readme(wb):
    w = wb["01 README"]
    w["A2"] = f"Doc: {C.DOC}"
    r = last_row(w) + 1
    w.cell(r, 1, "Rev07 (2026-09-27)")
    w.cell(r, 2, "Reconciled with the SAJ QSCOST dashboard Rate Analysis library: one dated rate per shared resource "
                 "(cement 1,575, Lawrencepur 240, Sargodha 185, Margalla 180, A-brick 17.5, blocks 140/165, sub-base 100, "
                 "plaster mason 2,150, tile fixer 2,500, painter 2,100); crew outputs checked against Punjab MRS 2026 "
                 "labour shares, MAK installation rates and SRC-06 piece rates (13, columns H–S); 35 new analyses; "
                 "17 Missing Items Register; 18 Dashboard Reconciliation; 19 Revision Log.")
    w.cell(r + 1, 1, "Dashboard link")
    w.cell(r + 1, 2, "Every item in 03 is in the dashboard Item Library under the same code, with the same "
                     "resources and adjusted quantities (Rate Analysis → Item Library, category filter). Shared "
                     "resources use the dashboard Rate Database line named in 18.")
    for rr in (r, r + 1):
        w.cell(rr, 1).font = BOLD
        w.cell(rr, 2).alignment = WRAP
    w10 = wb["10 ASSUMPTIONS"]
    for rr in range(38, last_row(w10) + 1):
        v = w10.cell(rr, 1).value
        if isinstance(v, str) and v.startswith("A-07"):
            w10.cell(rr, 1).value = ("A-07 Labour productivities in 13 are checked against dated benchmarks (Punjab MRS "
                                     "2026 labour share, MAK installation rate ÷ 1.18, SRC-06 piece rate). Rows with no "
                                     "benchmark (formwork, blockwork, cementitious WP) remain assumptions – see 13 col S.")
    w02 = wb["02 DASHBOARD"]
    for row in w02.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                c.value = re.sub(r"!([A-Z]+)5:([A-Z]+)129\b", r"!\g<1>5:\g<2>400", c.value)
    w02["A2"] = f"Rate basis: Lahore · {C.REV} reconciled with dashboard · Last updated {C.AS_OF}"


def qc(wb):
    w = wb["14 VALIDATION QC"]
    for row in w.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                v = re.sub(r"!([A-Z]+)5:([A-Z]+)129\b", r"!\g<1>5:\g<2>400", c.value)
                v = re.sub(r"M5:M180\b", "M5:M400", v)
                v = v.replace("L5:L21", "L5:L100").replace("H5:H17", "H5:H100")
                v = v.replace("=COUNTBLANK('03 MASTER RATE LIBRARY'!G5:G400)",
                              "=COUNTIFS('03 MASTER RATE LIBRARY'!A5:A400,\"?*\",'03 MASTER RATE LIBRARY'!G5:G400,\"\")")
                c.value = v
    r = 18
    merged = [str(m) for m in w.merged_cells.ranges]
    for m in merged:
        w.unmerge_cells(m)
    w.insert_rows(r, 4)
    for m in merged:  # insert_rows does not move merged ranges
        a, b = m.split(":")
        sh = lambda ref: re.sub(r"\d+", lambda x: str(int(x.group()) + 4 if int(x.group()) >= r else int(x.group())), ref)  # noqa: E731
        w.merge_cells(f"{sh(a)}:{sh(b)}")
    add = [(14, "Productivity rows with no dated benchmark (13 col S)",
            "=COUNTIF('13 PRODUCTIVITY LIBRARY'!S5:S100,\"ASSUMPTION*\")", "info"),
           (15, "Productivity rows corrected in Rev07", "=COUNTIF('13 PRODUCTIVITY LIBRARY'!S5:S100,\"Corrected*\")",
            "info"),
           (16, "Items reconciled with dashboard (18 col N = OK)", "=COUNTIF('18 DASHBOARD RECONCILIATION'!N5:N400,\"OK\")",
            "info"),
           (17, "Items NOT reconciled with dashboard", "=COUNTIF('18 DASHBOARD RECONCILIATION'!N5:N400,\"CHECK*\")",
            '=IF(C21=0,"OK","CHECK 18")')]
    for i, (n, t, f, s) in enumerate(add):
        for j, v in enumerate((n, t, f, s), 1):
            w.cell(r + i, j, v)
            w.cell(r + i, j)._style = copy.copy(w.cell(17, j)._style)


def missing_register(wb, blocks):
    ws = wb.create_sheet("17 MISSING ITEMS REGISTER")
    ws["A1"] = "17 · MISSING ITEMS REGISTER (Rev07, 2026-09-27)"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = ("Part A: every workbook analysis checked against the dashboard Item Library as it stood before Rev07 "
                "(787 items). Part B: trade-scope items found in neither library, each now developed as an analysis in 04 "
                "and added to the dashboard under the same code. Rates in C/D are read live from 03.")
    hdr = ["Part", "Item code", "Description", "Unit", "Status before Rev07", "Closest dashboard item (before Rev07)",
           "Action in Rev07", "Workbook final rate (03)", "Rate status (03)", "Closest item – dashboard rate (Rev07)",
           "Closest item unit", "Difference vs workbook", "Review note"]
    for j, h in enumerate(hdr, 1):
        c = ws.cell(4, j, h)
        c.font, c.fill, c.alignment = BOLD, HEAD, WRAP
    w03 = wb[S03]
    r = 5
    for m in range(5, last_row(w03) + 1):
        code = w03.cell(m, 1).value
        new = any(it["code"] == code for it in C.NEW_ITEMS)
        if new:
            continue
        eq = EQUIV.get(code)
        vals = ["A", code, w03.cell(m, 5).value, w03.cell(m, 7).value,
                "Missing from dashboard (code not in Item Library)",
                eq or "— no equivalent (concept missing)",
                "Added to dashboard Item Library with the same code, resources, adjusted quantities and OH/profit",
                f"='{S03}'!S{m}", f"='{S03}'!U{m}"]
        for j, v in enumerate(vals, 1):
            ws.cell(r, j, v).alignment = WRAP
        r += 1
    for trade, scope, code in SCOPE_GAPS:
        m = find_row(w03, code.split("..")[0])
        vals = ["B", code, scope, w03.cell(m, 7).value if m else "", "Missing from both workbook and dashboard", "—",
                "Developed in 04 (" + ("priced from dated MRS / GRN inputs" if code.split("..")[0] in PRICED
                                       else "structure complete; vendor rate blank – listed in 16 RFQ") +
                ") and added to the dashboard", f"='{S03}'!S{m}" if m else "", f"='{S03}'!U{m}" if m else ""]
        for j, v in enumerate(vals, 1):
            ws.cell(r, j, v).alignment = WRAP
        r += 1
    for col, wdt in zip("ABCDEFGHIJKLM", (6, 16, 70, 7, 26, 26, 50, 14, 30, 14, 8, 11, 60)):
        ws.column_dimensions[col].width = wdt
    ws.freeze_panes = "C5"
    ws.auto_filter.ref = f"A4:M{r - 1}"
    for rr in range(5, r):
        ws.cell(rr, 8).number_format = "#,##0"


# --------------------------------------------------------------------------- step 2
def reconcile(wb, src, dash, log_path):
    """dash: {"items": [...dashboard items], "rates": {code: rate}, "excel": {...}, "excelRates": {...}}"""
    wv = openpyxl.load_workbook(src, data_only=True)
    w03v = wv[S03]
    D = {i["id"]: i for i in dash["items"]}
    for name in ("18 DASHBOARD RECONCILIATION", "19 REVISION LOG"):
        if name in wb.sheetnames:
            del wb[name]
    ws = wb.create_sheet("18 DASHBOARD RECONCILIATION")
    ws["A1"] = "18 · DASHBOARD RECONCILIATION – workbook 03 vs dashboard Item Library (same code)"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = (f"Dashboard figures read from the built page on {C.AS_OF} (raCalc, Lahore). Workbook rate = 03 col O "
                "direct cost + 8% OH + 10% profit, unrounded (col S rounds it). OK = same unit, same description, "
                "same resource rows and |difference| < 0.05 PKR.")
    hdr = ["Item code", "Unit (workbook)", "Unit (dashboard)", "Description match", "Resource rows (workbook)",
           "Resource rows (dashboard)", "Rows match", "Direct cost (workbook)", "Rate excl. tax (workbook)",
           "Rate (dashboard)", "Difference PKR", "Final rate rounded (03 S)", "Dashboard rate lines used", "Result"]
    for j, h in enumerate(hdr, 1):
        c = ws.cell(4, j, h)
        c.font, c.fill, c.alignment = BOLD, HEAD, WRAP
    r = 5
    ok = 0
    for m in range(5, last_row(w03v) + 1):
        code = w03v.cell(m, 1).value
        x = dash["excel"][code]
        d = D.get(code)
        dc = w03v.cell(m, 15).value or 0
        rex = x["rateExTax"]
        vals = [code, x["unit"], d["unit"] if d else "—", "yes" if d and d["desc"] == x["desc"] else "NO",
                len(x["rows"]), len(d["rows"]) if d else 0,
                "yes" if d and [[a, round(b, 6)] for a, b in d["rows"]] == [[a, round(b, 6)] for a, b in x["rows"]] else "NO",
                dc, rex, d["rate"] if d else None, (d["rate"] - rex) if d else None, w03v.cell(m, 19).value,
                ", ".join(sorted({a for a, _ in x["rows"]}))[:250]]
        good = d and vals[3] == "yes" and vals[6] == "yes" and abs(vals[10]) < 0.05 and vals[1] == vals[2]
        vals.append("OK" if good else "CHECK – see columns C–K")
        ok += bool(good)
        for j, v in enumerate(vals, 1):
            ws.cell(r, j, v)
        for j in (8, 9, 10, 11, 12):
            ws.cell(r, j).number_format = "#,##0.00"
        ws.cell(r, 14).fill = GREEN if good else RED
        r += 1
    for col, wdt in zip("ABCDEFGHIJKLMN", (14, 9, 9, 9, 9, 9, 7, 12, 12, 12, 10, 11, 60, 16)):
        ws.column_dimensions[col].width = wdt
    ws.freeze_panes = "B5"
    ws.auto_filter.ref = f"A4:N{r - 1}"
    # 18b: shared resource lines
    r += 1
    ws.cell(r, 1, "Shared resources – workbook code → dashboard Rate Database line").font = BOLD
    r += 1
    for j, h in enumerate(["Workbook code", "Dashboard code", "Workbook Lahore rate", "Dashboard rate", "Match"], 1):
        c = ws.cell(r, j, h)
        c.font, c.fill = BOLD, HEAD
    r += 1
    for xc, dcode in C.MAP.items():
        xr = dash["excelRates"].get(xc)
        dr = dash["rates"].get(dcode)
        for j, v in enumerate([xc, dcode, xr, dr, "OK" if xr is not None and dr is not None and abs(xr - dr) < 1e-6
                               else "CHECK"], 1):
            ws.cell(r, j, v)
        r += 1
    # 17: closest dashboard item's Rev07 rate beside the workbook rate
    w17, w17v = wb["17 MISSING ITEMS REGISTER"], wv["17 MISSING ITEMS REGISTER"]
    allr, allu = dash.get("allRates", {}), dash.get("allUnits", {})
    for rr in range(5, w17.max_row + 1):
        eq, fin = w17.cell(rr, 6).value, w17v.cell(rr, 8).value
        if eq in allr and isinstance(fin, (int, float)) and fin:
            w17.cell(rr, 10, round(allr[eq], 2))
            w17.cell(rr, 11, allu.get(eq))
            ux = str(w17.cell(rr, 4).value).lower()
            same = ux == str(allu.get(eq, "")).lower()
            if same:
                dif = allr[eq] / fin - 1
                w17.cell(rr, 12, dif).number_format = "0%"
                note = ("Within ±15% – consistent" if abs(dif) <= .15 else
                        "Differs 15–30% – build-ups differ (spec / mix / crew); see 04 vs the dashboard item" if abs(dif) <= .30
                        else "Differs >30% – review both build-ups before pricing")
            else:
                note = "Different unit of measurement – compare after conversion"
            w17.cell(rr, 13, note)
            w17.cell(rr, 10).number_format = "#,##0.00"
    # QC rows that read this sheet (written here: the sheet does not exist during step 1)
    w14 = wb["14 VALIDATION QC"]
    for rr in range(5, w14.max_row + 1):
        t = str(w14.cell(rr, 2).value or "")
        if t.startswith("Items reconciled with dashboard"):
            w14.cell(rr, 3).value = "=COUNTIF('18 DASHBOARD RECONCILIATION'!N5:N400,\"OK\")"
            w14.cell(rr, 4).value = "info"
        elif t.startswith("Items NOT reconciled"):
            w14.cell(rr, 3).value = "=COUNTIF('18 DASHBOARD RECONCILIATION'!N5:N400,\"CHECK*\")"
            w14.cell(rr, 4).value = f'=IF(C{rr}=0,"OK","CHECK 18")'
    # 19 revision log
    wl = wb.create_sheet("19 REVISION LOG")
    wl["A1"] = f"19 · REVISION LOG – {C.REV} ({C.AS_OF})"
    wl["A1"].font = Font(bold=True, size=13)
    for j, h in enumerate(["#", "Type", "Code", "Rev06", "Rev07", "Basis / note"], 1):
        c = wl.cell(3, j, h)
        c.font, c.fill = BOLD, HEAD
    for i, (t, code, old, new, note) in enumerate(json.loads(Path(log_path).read_text()), 1):
        for j, v in enumerate([i, t, code, old, new, note], 1):
            wl.cell(3 + i, j, v).alignment = WRAP
    for col, wdt in zip("ABCDEF", (5, 18, 18, 12, 14, 110)):
        wl.column_dimensions[col].width = wdt
    wl.freeze_panes = "A4"
    return ok


AS_OF = C.AS_OF


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--html", type=Path, default=HTML)
    ap.add_argument("--reconcile", type=Path, help="dashboard dump JSON (tools/ra_master_data.py --dump-check)")
    ap.add_argument("--log", type=Path, help="revision log JSON (written by step 1, read by step 2)")
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.src)
    log_path = a.log or a.out.with_suffix(".log.json")
    if a.reconcile:
        ok = reconcile(wb, a.src, json.loads(a.reconcile.read_text()), log_path)
        wb.save(a.out)
        print(f"reconciled: {ok} items OK -> {a.out}")
        return
    lines = Lines(a.html.read_text(encoding="utf-8"), dt.date.fromisoformat(C.AS_OF))
    log = update(wb, lines)
    wb.save(a.out)
    log_path.write_text(json.dumps(log, ensure_ascii=False, default=str, indent=0))
    print(f"{a.out}: {len(log)} changes logged -> {log_path}")


if __name__ == "__main__":
    main()

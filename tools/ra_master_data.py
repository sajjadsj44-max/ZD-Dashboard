#!/usr/bin/env python3
"""Build the Master Rate Analysis block of the dashboard (#raMasterData) from the Rev07 workbook.

    tools/ra_master_data.py RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx      # recalculated workbook
    tools/ra_master_data.py WB.xlsx --html path/to/index.html --excel-json out.json

Every analysis in sheet 03 becomes an Item Library item with the SAME code, description, unit and
resource rows as sheet 04:

  row qty    = workbook adjusted quantity (consumption × (1 + wastage)) — the wastage is inside the row,
               so item wastage B is 0 (as the QS engine builders do); the note shows the working
  rate line  = the dashboard Rate Database line the resource shares with the dashboard
               (tools/ra_master_config.py MAP; the build stops if the two rates differ), otherwise a line
               with the workbook's own code, rate, date and source (sheet 05/06/07 + 09 register);
               resources with no dated source are 0 / "ASSUMPTION — no dated source"
  OH / profit = 8% (3% site + 5% head office) and 10%, as the workbook's 10 ASSUMPTIONS

It also carries the Rev07 corrections to existing dashboard items that have a dated benchmark:
  * ST-200 / ST-205 / ST-210 rebar labour 100 kg per fixer-day -> 360 kg per fixer + helper day
    (Punjab MRS 2026 Ch.6 item 12(b)(ii) labour share 11.03 per kg), applied only while the item is
    still as seeded;
  * QE-TIMB-CFT 3,000 (undated assumption) -> 3,680 per cft (Phoenix GRN RCP-277, 10-Jun-2026).
The brick / plaster generator labour fix is in the page script (raGenBrick / raGenPlaster / raSyncMaster).

Saved libraries pick the block up like the MEP and civil blocks (raSyncBlk, revision key masRev).
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ra_master_config as C  # noqa: E402
from qs_engine_data import dmy  # noqa: E402
from ra_master_excel import Lines, parse_blocks, S03, S04, S05, S06, S07  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "zameen-developments" / "index.html"
BLOCK_RE = re.compile(r'(<script type="application/json" id="raMasterData">)(.*?)(</script>)', re.S)
ANCHOR = '<script type="application/json" id="calcData">'
NOSRC = "ASSUMPTION — no dated source"
UNIT = {"cft": "Cft", "kg": "Kg", "ton": "Ton", "sft": "Sft", "rft": "Rft", "nos": "Nos", "bag": "Bag",
        "litre": "Ltr", "day": "Day", "sheet": "Sheet", "gallon": "Gallon", "set": "Set", "job": "Job",
        "month": "Month", "tr": "TR"}
KIND = {"Material": "M", "Labour": "L", "Equipment": "P", "Transport": "P"}
STL = "Punjab MRS 1st Bi-Annual 2026 (Rawalpindi), 01-Jan-2026, Ch.6 item 12(b)(ii)"


def unit(u):
    return UNIT.get(str(u).strip().lower(), str(u).strip())


def dmy_s(d):
    d = d.isoformat()[:10] if isinstance(d, (dt.date, dt.datetime)) else str(d or "")
    return dmy(d) if re.match(r"^\d{4}-\d{2}-\d{2}$", d) else d


def num(v):
    return float(v) if isinstance(v, (int, float)) else 0.0


def fmt(v):
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return s or "0"


def dash_lines(html):
    """Rate Database lines a fresh library ends up with (seed, then the blocks in the page's load order)."""
    out = {}
    seed = re.search(r"RA_MAT_SEED=(\[\[.*?\]\])[,;]", html, re.S)
    for a in json.loads(seed.group(1)):
        out[a[0]] = {"code": a[0], "kind": a[1], "name": a[2], "unit": a[3], "rate": a[4], "loc": a[5],
                     "src": a[6], "date": a[7], "vs": a[8]}

    def blk(i):
        m = re.search(rf'<script type="application/json" id="{i}">(.*?)</script>', html, re.S)
        return json.loads(m.group(1)) if m else {}
    for i in ("raMepData", "raCivilData", "raQsEngine"):
        d = blk(i)
        prev = d.get("prevRates") or {}
        for r in d.get("rates", []):
            if r["code"] not in out or r["code"] in prev:
                out[r["code"]] = dict(r)
        for f in d.get("fixes", []):
            if f.get("code") in out and isinstance(f.get("to"), dict):
                out[f["code"]].update(f["to"])
    return out


def build(wb_f, wb_v, html, as_of):
    lines = Lines(html, as_of)
    cur = dash_lines(html)
    reg = {}
    w09 = wb_v["09 SOURCE REGISTER"]
    for r in range(5, w09.max_row + 1):
        if w09.cell(r, 1).value:
            reg[w09.cell(r, 1).value] = w09.cell(r, 2).value
    # workbook resources
    res = {}
    for sheet, kind, cols in ((S05, "M", dict(u=4, v=5, d=9, st=10, s=11, n=12, desc=2, spec=3)),
                              (S06, "L", dict(u=3, v=4, d=8, st=9, s=10, n=11, desc=2, spec=None)),
                              (S07, "P", dict(u=3, v=4, d=None, st=5, s=6, n=7, desc=2, spec=None))):
        w = wb_v[sheet]
        for r in range(5, w.max_row + 1):
            code = w.cell(r, 1).value
            if not code:
                continue
            g = lambda k: (w.cell(r, cols[k]).value if cols[k] else None)  # noqa: E731
            res[code] = {"kind": kind, "name": g("desc") + (f" — {g('spec')}" if g("spec") else ""),
                         "unit": unit(g("u")), "rate": num(g("v")), "date": g("d"), "status": str(g("st") or ""),
                         "srcid": g("s"), "note": g("n") or ""}

    def line_for(code):
        if code.startswith(("MRS-", "GRN-")):
            return lines.get(code)
        x = res[code]
        date = x["date"].isoformat()[:10] if isinstance(x["date"], (dt.date, dt.datetime)) else (x["date"] or "")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(date)):
            date = ""
        srcs = [reg.get(s.strip(), s.strip()) for s in str(x["srcid"] or "").split(";") if s.strip() not in ("", "—")]
        label = "; ".join(srcs) or "Master Rate Analysis Rev07"
        st = x["status"].upper()
        body = f"{label}, {dmy_s(date)} — {x['note']} [Master RA {C.REV} {code}, status {x['status']}]" if date else ""
        if not x["rate"] or not date:
            src, vs = f"{NOSRC}. {x['note'] or 'Enter a quotation'} [Master RA {C.REV} {code}]", "A"
        elif "ASSUM" in st or "PROXY" in x["note"].upper():
            src, vs = f"ASSUMPTION — {body}", "A"
        elif "GRN" in st or "QUOTE" in st:
            src, vs = body, "V"
        else:
            src, vs = body, "I"
        return {"code": code, "kind": x["kind"], "name": x["name"], "unit": x["unit"], "rate": round(x["rate"], 4),
                "loc": "Lahore", "src": src, "date": date if x["rate"] else "", "vs": vs}

    w04f, w04v, w03v = wb_f[S04], wb_v[S04], wb_v[S03]
    blocks = parse_blocks(w04f)
    rates, items, excel = {}, [], {}
    for m in range(5, w03v.max_row + 1):
        code = w03v.cell(m, 1).value
        if not code:
            continue
        b = blocks[code]
        cat, qc = C.legacy_cat(code)
        new = next((it for it in C.NEW_ITEMS if it["code"] == code), None)
        qs = new["qs"] if new else C.QS_SUB[qc]
        if new:
            qc = new["qc"]
        it = {"id": code, "code": code, "cat": cat, "sub": w03v.cell(m, 3).value, "qc": qc, "qs": qs,
              "desc": w03v.cell(m, 5).value, "spec": w03v.cell(m, 6).value, "unit": unit(w03v.cell(m, 7).value),
              "M": [], "L": [], "P": [], "wast": 0, "oh": 8, "prof": 10, "acc": 0, "trans": 0, "gen": None,
              "note": (f"Master Rate Analysis {C.REV} ({C.AS_OF}) item {code}, sheet 04 rows {b['head']}–"
                       f"{b['rows'][-1]}. Row quantities = consumption × (1 + wastage), so item wastage is 0. "
                       f"OH 8% (3% site + 5% HO) and profit 10% as the workbook. "
                       + (str(w03v.cell(m, 27).value or "")))}
        for r in b["rows"]:
            comp, rc, desc = w04f.cell(r, 2).value, w04f.cell(r, 3).value, w04f.cell(r, 4).value
            cons, w, adj = num(w04v.cell(r, 6).value), num(w04v.cell(r, 8).value), num(w04v.cell(r, 9).value)
            ref = C.MAP.get(rc, rc)
            if ref == rc:
                ln = line_for(rc)
                if rc in rates and rates[rc] != ln:
                    sys.exit(f"line {rc} built twice differently")
                rates[rc] = ln
            else:
                d = cur.get(ref)
                want = C.DASH_RATE_UPDATES.get(ref, {}).get("rate", d and d["rate"])
                if d is None or abs(num(w04v.cell(r, 7).value) - num(want)) > 1e-6:
                    sys.exit(f"{code}: shared line {rc}->{ref} differs: workbook {w04v.cell(r, 7).value}, "
                             f"dashboard {want}")
                if unit(w04v.cell(r, 5).value) != d["unit"]:
                    sys.exit(f"{code}: unit of {rc} ({w04v.cell(r, 5).value}) != {ref} ({d['unit']})")
            fm = str(w04f.cell(r, 6).value)
            note = (f"{desc}: {fmt(cons)} × (1 + {fmt(w * 100)}%) = {fmt(adj)}" if w else f"{desc}: {fmt(adj)}")
            if fm.startswith("="):
                pr = re.search(r"13 PRODUCTIVITY LIBRARY'!([DEF])(\d+)", fm)
                note += " — crew output from sheet 13" if pr else f" — workbook formula {fm[1:60]}"
            it[KIND[comp]].append({"ref": ref, "qty": round(adj, 8), "note": note})
        xrows = [[r["ref"], r["qty"]] for k in "MLP" for r in it[k]]
        items.append(it)
        excel[code] = {"unit": it["unit"], "desc": it["desc"], "rows": xrows,
                       "rateExTax": num(w04v.cell(b["sum"]["Rate excl. tax"], 10).value),
                       "final": num(w03v.cell(m, 19).value)}
    for code, u in C.DASH_RATE_UPDATES.items():
        d = dict(cur[code])
        d.update({k: v for k, v in u.items() if k != "prev"})
        rates[code] = d
    # seed rebar items: labour to the MRS benchmark (only while still as seeded)
    q = round(1 / 360, 8)
    upd, prev_items = [], {}
    for iid, M in (("ST-200", [["STL60", 1], ["BWIRE", 0.012]]), ("ST-205", [["STL72", 1], ["BWIRE", 0.012]]),
                   ("ST-210", [["BWIRE", 0.012]])):
        upd.append({"id": iid, "M": [{"ref": a, "qty": b} for a, b in M], "full": True,
                    "L": [{"ref": "L-STEEL", "qty": q, "note": "1 steel fixer per 360 kg (Rev07)"},
                          {"ref": "L-HELPER", "qty": q, "note": "1 helper per 360 kg (Rev07)"}],
                    "P": [{"ref": "P-BENDER", "qty": 0.0012}],
                    "note": (f"Labour corrected {C.AS_OF} (Master RA {C.REV}): the seed priced 1 steel fixer-day per "
                             f"100 kg (36.80/kg). {STL} prints a labour share of 11.03 per kg for cutting, bending, "
                             f"placing and binding; a fixer + helper crew at 360 kg/day gives 11.08/kg." +
                             (" For fixing-only work this is an upper bound." if iid == "ST-210" else ""))})
        prev_items[iid] = [M]
    wanted = {r["ref"] for it in items for k in "MLP" for r in it[k]}
    missing = [c for c in wanted if c not in rates and c not in cur]
    if missing:
        sys.exit(f"rate lines missing: {missing}")
    rates_l = [rates[k] for k in sorted(rates)]
    body = json.dumps({"rates": rates_l, "items": items, "upd": upd}, ensure_ascii=False, sort_keys=True)
    rev = f"{C.AS_OF}-{hashlib.sha1(body.encode()).hexdigest()[:8]}"
    data = {"rev": rev, "source": f"Master Rate Analysis {C.DOC} (reconciled with this library, docs/"
                                   "master-rate-analysis-rev07.md)",
            "rates": rates_l, "items": items, "upd": upd,
            "prevRates": {k: v["prev"] for k, v in C.DASH_RATE_UPDATES.items()}, "prevItems": prev_items}
    xr = {code: x["rate"] for code, x in res.items()}
    return data, {"excel": excel, "excelRates": xr}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("workbook", type=Path, help="recalculated Rev07 workbook")
    ap.add_argument("--html", type=Path, default=DEFAULT_HTML)
    ap.add_argument("--excel-json", type=Path, help="write the workbook side of the reconciliation here")
    a = ap.parse_args()
    html = a.html.read_text(encoding="utf-8")
    wf = openpyxl.load_workbook(a.workbook)
    wv = openpyxl.load_workbook(a.workbook, data_only=True)
    data, xside = build(wf, wv, html, dt.date.fromisoformat(C.AS_OF))
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    if BLOCK_RE.search(html):
        html = BLOCK_RE.sub(lambda m: m.group(1) + js + m.group(3), html)
    else:
        if ANCHOR not in html:
            sys.exit("anchor for the new block not found")
        html = html.replace(ANCHOR, f'<script type="application/json" id="raMasterData">{js}</script>\n' + ANCHOR, 1)
    a.html.write_text(html, encoding="utf-8")
    if a.excel_json:
        a.excel_json.write_text(json.dumps(xside, ensure_ascii=False, indent=0, default=str))
    kinds = {}
    for r in data["rates"]:
        k = r["code"].split("-")[0]
        kinds[k] = kinds.get(k, 0) + 1
    print(f"raMasterData {data['rev']}: {len(data['items'])} items, {len(data['rates'])} rate lines {kinds}, "
          f"{len(data['upd'])} seed corrections")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""New rate analyses from the October-2026 GRNs (#raGrnItems), 05-Nov-2026.

    tools/grn_register.py "Material Received at Store 28.xlsx"     # the receipts first
    node tools/grn_rates.js                                         # then the Rate Database from the latest GRN
    tools/grn_items_data.py                                         # writes zameen-developments/index.html
    tools/grn_items_data.py --as-of 2026-11-05 --html path/to/index.html --dry-run

Sajjad asked on 05-Nov-2026 to update the GRN register and the Rate Analysis library from the store's workbook
Material Received at Store 28 (all Zameen Developments projects, receipts to 29-Oct-2026), and to build the rate
analysis of any item received that the library has none for. Every construction material received in October
2026 was checked against the library (the items' own material lines, not only their wording); these had no item:

  * MEP equipment priced from the GRN, installed at the MAK contract rate of the same operation (the library's MEP
    pattern, as MF-408A or MP-303): zone check assembly 3", 6" rubber bellow, MLTP with 125 kVAr PFI panel,
    synchronising generator panel, sub-main panel, missile-type submersible pumps 0.75 / 3 HP, uPVC backflow
    preventers 4" / 6" and uPVC check valve 6";
  * metal work and bulkheads billed by the fabricators (Malik Steel Works, Usman Shabbir) through the store. Their
    GRNs carry measured quantities (319.84 Rft of railing, 925.21 Sft of louvre, 193.12 Sft of bulkhead), so they
    are the fabricators' fabricate-and-fix bills: the GRN line is the item's whole cost (like FIN-FLR-009 on MAT-CPT);
  * modular carpet tile from the GRN with the Lahore MRS labour for laying carpet tile.

Panels made for one building's floors (ATS-2F … ATS-GF & FF, MTPB-2F …) have no rating on the GRN and are left
out, as are site consumables, tools, PPE, stationery and pantry items.

Every line follows CLAUDE.md: `<site> GRN RCP-n, DD-Mon-YYYY — <vendor> …` with the GRN date as its effective date
(the register's own remark, as its + Rate DB button writes it). The page merges this block after the rate refresh
(raSyncBlk, revision key grnItRev): new lines and items are added; a line or item the library already has is left
as it is.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qs_engine_data import Grn  # noqa: E402
from civil_gap_data import Mrs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "zameen-developments" / "index.html"
BLOCK_ID = "raGrnItems"
BLOCK_RE = re.compile(r'(<script type="application/json" id="raGrnItems">)(.*?)(</script>)', re.S)
ANCHOR = '<script type="application/json" id="calcData">'
LOADER_OLD = 'raSyncBlk(e,raBlk("raRefreshData"),"refRev"),'
LOADER_NEW = LOADER_OLD + 'raSyncBlk(e,raBlk("raGrnItems"),"grnItRev"),'
SRC_BLOCKS = ("raMepData", "raCivilData", "raQsEngine", "raMasterData", "raRefreshData")
DONE = ", complete in all respects"
ADDED = "Added 05-Nov-2026 from Material Received at Store 28 (GRNs to 29-Oct-2026)."

# --------------------------------------------------------------------------- items
# MEP: (code, cat, sub, qc, qs, description, (site, GRN description), [(MAK install line, note)], note)
MEP = [
    ("MF-408C", "Fire Fighting", "Valves", "C16", "Piping",
     "Providing, installing, testing and commissioning zone check assembly 3\" (alarm valve, flow switch, gauges, drain)" + DONE,
     ("NEO", "Zone Control Valve Assembly 3\""), [("MAK-MF-408A", "installation at the MAK rate for the 4\" assembly")],
     "The MAK agreement has no 3\" assembly; its 4\" installation (MF-408A) is used."),
    ("MH-221J", "HVAC", "Valves", "C15", "Equipment",
     "Supplying and installing 6\" flexible rubber bellow (expansion joint) with matching flanges, nuts and bolts in pump room" + DONE,
     ("NEO", "Flexible Rubber Bellow 6'' with matching Flanges Nuts Bolts"),
     [("MAK-MN-P14", "installing a bellow-type flexible connector in pump room")], ""),
    ("ELE-DIS-105", "Electrical", "Distribution", "C14", "Distribution",
     "Supplying, installing, testing and commissioning Main LT Panel Board (MLTP) with power factor improvement panel 125 kVAr, "
     "free standing, as per approved SLD" + DONE,
     ("NEO", "Main Low Tension Panel Board MLTP & PFIP-125 KVAR"),
     [("MAK-ME-201", "installing the MLTP"), ("MAK-ME-206", "installing the PFI panel (100–175 kVAr)")],
     "NEO's MLTP and its 125 kVAr PFI panel are one GRN line; both MAK installations are added."),
    ("ELE-DIS-106", "Electrical", "Distribution", "C14", "Distribution",
     "Supplying, installing, testing and commissioning auto load-sharing synchronising generator panel board, as per approved SLD" + DONE,
     ("NEO", "Auto Load Sharing Syncronizing Generator Panel Board"),
     [("MAK-ME-205", "installing the synchronising panel")], ""),
    ("ELE-DIS-107", "Electrical", "Distribution", "C14", "Distribution",
     "Supplying, installing, testing and commissioning sub-main panel board (SMPB) for common services, as per approved SLD" + DONE,
     ("NEO", "Sub Main Panel Board (SMPB) - Common"),
     [("MAK-ME-202", "installing a sub-main panel board")], ""),
    ("MP-809A", "Plumbing", "Water supply", "C13", "Water supply",
     "Supplying, installing, testing and commissioning submersible pump, missile (borehole) type, 0.75 HP" + DONE,
     ("Phoenix", "Submersible Pump Missile Type 0.75Hp"), [("MAK-MP-809", "installing a submersible pump")],
     "Installation is the MAK final-bill rate for installing a submersible pump (MP-809); column pipe and cable are measured separately."),
    ("MP-809B", "Plumbing", "Water supply", "C13", "Water supply",
     "Supplying, installing, testing and commissioning submersible pump, missile (borehole) type, 3 HP" + DONE,
     ("EON", "Submersible Pump Missile Type 3HP"), [("MAK-MP-809", "installing a submersible pump")],
     "Installation is the MAK final-bill rate for installing a submersible pump (MP-809); column pipe and cable are measured separately."),
    ("MP-811A", "Plumbing", "Drainage", "C13", "Drainage",
     "Supplying and fixing uPVC backflow preventer 4\" Class D (BS 3505) on drainage outlet, jointed" + DONE,
     ("NEO", "UPVC Back Flow Preventer 4\" Class D BS-3505"), [("MAK-MP-811", "installing a PVC check valve")],
     "Fixing at the MAK rate for a 2\" PVC ball / check valve (MP-811), the only PVC valve installation in the agreement."),
    ("MP-811B", "Plumbing", "Drainage", "C13", "Drainage",
     "Supplying and fixing uPVC backflow preventer 6\" Class D (BS 3505) on drainage outlet, jointed" + DONE,
     ("NEO", "UPVC Backflow Preventer 6\" Class D BS-3505"), [("MAK-MP-811", "installing a PVC check valve")],
     "Fixing at the MAK rate for a 2\" PVC ball / check valve (MP-811), the only PVC valve installation in the agreement."),
    ("MP-811C", "Plumbing", "Drainage", "C13", "Drainage",
     "Supplying and fixing uPVC check (non-return) valve 6\" Class D, jointed" + DONE,
     ("NEO", "UPVC Check Valve 6\" Class D"), [("MAK-MP-811", "installing a PVC check valve")],
     "Fixing at the MAK rate for a 2\" PVC ball / check valve (MP-811), the only PVC valve installation in the agreement."),
]

# fabricated and fixed by the vendor, billed through the store: (code, cat, sub, qc, qs, description, (site, GRN description), note)
FAB = "Fabricator's GRN at a measured quantity, i.e. its fabricate-and-fix bill: the line is the whole cost."
ALL_IN = [
    ("MISC-STL-109", "Miscellaneous", "Metal work", "C19", "Metal work",
     "Providing and fixing MS parapet / roof railing 4'-0\" high of 1\"x1\" 18 SWG MS pipe, fabricated and fixed" + DONE,
     ("NEO", "MS Parapet Raling Wall 4'x0\" Pipe (18 SWG)1\"x1\""), "Finish as the fabricator's bill (not stated on the GRN)."),
    ("MISC-STL-110", "Miscellaneous", "Metal work", "C19", "Metal work",
     "Providing and fixing MS railing of 1\"x1\" 18 SWG MS pipe with 2\"x2\" 16 SWG top rail, powder coated" + DONE,
     ("Quadrangle", "MS Railing 1\"x1\" 18 swg with 2\"x2\" top pipe 16 swg Powder Co"), "Height not stated on the GRN."),
    ("MISC-STL-111", "Miscellaneous", "Metal work", "C19", "Metal work",
     "Providing and fixing MS louvre screen of 2\"x1\" MS pipe louvres at 3\" spacing in 3\"x1\" MS pipe frame, fabricated and fixed" + DONE,
     ("NEO", "MS Louver H=70'X4\"-6',Pipe 3\"x1\",W=2\"x1\" Spacing 3\""), "NEO façade screen, 70 ft high."),
    ("MISC-STL-112", "Miscellaneous", "Metal work", "C19", "Metal work",
     "Providing and fixing MS manhole cover 30\"x30\" of 18 SWG sheet with 1.5\"x1.5\"x6 mm angle-iron frame" + DONE,
     ("NEO", "MS Manhole Cover 18G 30\"x30\" With Frame 1.5\"x1.5\"x6mm"), ""),
    ("MISC-STL-113", "Miscellaneous", "Metal work", "C19", "Metal work",
     "Providing and fixing MS manhole cover 36\"x36\" of 18 SWG sheet with 1.5\"x1.5\"x6 mm angle-iron frame" + DONE,
     ("NEO", "MS Manhole Cover 18G 36\"x36\" With Frame 1.5\"x1.5\"x6mm"), ""),
    ("FIN-CLG-104", "Finishing", "Gypsum board ceiling", "C08", "Gypsum board ceiling",
     "Providing and fixing cement-board bulkhead, board on one side, on 1\"x1\" 18 SWG MS pipe framing, measured per Sft of board" + DONE,
     ("NEO", "Bulkhead Cement Board with MS pipe 18 swg 1\"x1\" SS"), ""),
    ("FIN-CLG-105", "Finishing", "Gypsum board ceiling", "C08", "Gypsum board ceiling",
     "Providing and fixing cement-board bulkhead, board on both sides, on 1\"x1\" 18 SWG MS pipe framing, measured per Sft of bulkhead" + DONE,
     ("NEO", "Bulkhead Cement Board with MS pipe 18 swg 1\"x1\" DS"), ""),
]

CARPET = ("FIN-FLR-102", "Finishing", "Porcelain / ceramic tiles", "C09", "Porcelain / ceramic tiles",
          "Providing and laying modular carpet tiles (Nexus Founder or equal) over levelled screed" + DONE,
          ("NEO", "Carpet Tile (Modular Nexus Founder)"), 1.05, "C10-60-1",
          "Carpet tile as NEO bought it; 5 % for cutting and fitting; laying labour is the Lahore MRS labour for carpet "
          "tile (Ch.10 item 60). The GRN has no adhesive / tackifier: add it where the supplier does not include it. "
          "FIN-FLR-009 is the all-in MRS polypropylene tile.")


def r4(v):
    return round(v + 0.0, 4)


def block(html, bid):
    m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % bid, html, re.S)
    return json.loads(m.group(1)) if m and m.group(1).strip() else None


class Ctx:
    def __init__(self, html, as_of):
        self.grn = Grn(html, as_of)
        self.mrs = Mrs(html, as_of)
        # the library as the other blocks publish it (this block's own lines and items are not counted)
        self.lib_rates, self.lib_items = {}, set()
        for b in SRC_BLOCKS:
            d = block(html, b) or {}
            for r in d.get("rates") or []:
                self.lib_rates[r["code"]] = r
            for it in d.get("items") or []:
                self.lib_items.add(it["id"])
        self.rates, self.items = {}, []

    def known(self, code):
        return code in self.lib_rates or code in self.rates

    def add(self, line):
        old = self.lib_rates.get(line["code"])
        if old and old.get("rate") not in (None, line["rate"]):
            sys.exit(f"{line['code']} is already in the library at {old.get('rate')}, not {line['rate']}")
        self.rates[line["code"]] = line
        return line["code"]

    def grn_line(self, site, desc):
        line = self.grn.line(site, desc)
        if not re.match(r"^\d{4}-\d\d-\d\d$", line["date"]) or line["rate"] <= 0:
            sys.exit(f"{site} / {desc}: no dated, priced receipt")
        return self.add(line)

    def item(self, code, cat, qs, qc, desc, spec, unit, M=(), L=(), note=""):
        if code in self.lib_items or any(i["id"] == code for i in self.items):
            sys.exit(f"item {code} already exists")
        for r in list(M) + list(L):
            if not self.known(r["ref"]):
                sys.exit(f"{code}: rate line {r['ref']} is neither new nor a library line")
            u = (self.rates.get(r["ref"]) or self.lib_rates.get(r["ref"]) or {}).get("unit")
            if u and u != unit:
                sys.exit(f"{code}: line {r['ref']} is per {u}, the item per {unit}")
        self.items.append({"id": code, "code": code, "cat": cat, "sub": qs, "qc": qc, "qs": qs, "desc": desc,
                           "spec": spec, "unit": unit, "M": list(M), "L": list(L), "P": [], "wast": 0,
                           "oh": 8, "prof": 10, "acc": 0, "trans": 0, "gen": None, "note": note})


def row(ref, qty, note=""):
    r = {"ref": ref, "qty": r4(qty)}
    if note:
        r["note"] = note
    return r


def build(c):
    for code, cat, sub, qc, qs, desc, (site, gdesc), labs, note in MEP:
        m = c.grn_line(site, gdesc)
        M = [row(m, 1, "as received")]
        L = [row(ref, 1, n) for ref, n in labs]
        g = c.rates[m]
        c.item(code, cat, qs, qc, desc, "Build-up: " + ", ".join(r["ref"] for r in M + L), "Nos", M=M, L=L,
               note=f"{g['src'].split(' — ')[0]}: {gdesc}, {g['rate']:,.2f} per Nos. " + (note + " " if note else "") + ADDED)
    for code, cat, sub, qc, qs, desc, (site, gdesc), note in ALL_IN:
        m = c.grn_line(site, gdesc)
        g = c.rates[m]
        c.item(code, cat, qs, qc, desc, f"GRN all-in: {m}", g["unit"], M=[row(m, 1, "fabricate-and-fix bill as received")],
               note=f"{g['src'].split(' — ')[0]}: {gdesc}, {g['rate']:,.2f} per {g['unit']}. {FAB} " + (note + " " if note else "") + ADDED)
    code, cat, sub, qc, qs, desc, (site, gdesc), k, key, note = CARPET
    m = c.grn_line(site, gdesc)
    lab = c.add(c.mrs.line(key, "lab"))
    c.item(code, cat, qs, qc, desc, f"Build-up: {m}, {lab}", "Sft",
           M=[row(m, k, "carpet tile + 5 % cutting and fitting")], L=[row(lab, 1, "MRS labour for laying carpet tile")],
           note=note + " " + ADDED)


def make(html, as_of):
    c = Ctx(html, as_of)
    build(c)
    rates = [c.rates[k] for k in sorted(c.rates)]
    body = json.dumps({"rates": rates, "items": c.items}, ensure_ascii=False, sort_keys=True)
    rev = f"{as_of.isoformat()}-{hashlib.sha1(body.encode()).hexdigest()[:8]}"
    return {"rev": rev, "asOf": as_of.isoformat(),
            "source": "New rate analyses from Material Received at Store 28 (GRNs to 29-Oct-2026), 05-Nov-2026: GRN material "
                      "+ MAK installation, fabricators' all-in GRNs, GRN + Lahore MRS labour (tools/grn_items_data.py)",
            "rates": rates, "items": c.items, "prevRates": {}, "prevItems": {}}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--html", type=Path, default=DEFAULT_HTML)
    ap.add_argument("--as-of", default="2026-11-05")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    html = a.html.read_text(encoding="utf-8")
    data = make(html, dt.date.fromisoformat(a.as_of))
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    if BLOCK_RE.search(html):
        html = BLOCK_RE.sub(lambda m: m.group(1) + js + m.group(3), html)
    else:
        if html.count(ANCHOR) != 1:
            sys.exit("anchor for the new block not found exactly once")
        html = html.replace(ANCHOR, f'<script type="application/json" id="{BLOCK_ID}">{js}</script>\n' + ANCHOR, 1)
    if LOADER_NEW not in html:
        if html.count(LOADER_OLD) != 1:
            sys.exit("raLoad: the place to merge the block was not found exactly once")
        html = html.replace(LOADER_OLD, LOADER_NEW)
    for r in data["rates"]:
        print(f"  {r['code']:24} {r['unit']:5} {r['rate']:>14,.2f}  {r['date']}  {r['src'][:90]}")
    for it in data["items"]:
        print(f"  {it['id']:13} {it['unit']:4} {it['spec'][:60]:60}  {it['desc'][:70]}")
    if not a.dry_run:
        a.html.write_text(html, encoding="utf-8")
    print(f"{BLOCK_ID} {data['rev']}: {len(data['rates'])} rate lines, {len(data['items'])} new items"
          + (" (dry run)" if a.dry_run else f" -> {a.html}"))


if __name__ == "__main__":
    main()

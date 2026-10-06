#!/usr/bin/env python3
"""Merge material receiving (GRN) exports into the dashboard's GRN Price Register.

    tools/grn_register.py RECEIVING.xlsx [MORE.xlsx ...]
    tools/grn_register.py --html path/to/index.html RECEIVING.xlsx

Each workbook is the ERP "material receiving" export: first sheet, header row
`Site | RCPHSEQ | PO # | GRN # | GRN Date | Vendor Name | ... | Item Code |
LOCATION | Item Description | Category | HASCOMMENT | UOM | Rec.Qty | ... |
UNITCOST | Value | Main Category | Sub Category`, or a compiled workbook with
one sheet per site (`Location | PO# | GRN# | GRN Date | Vendor Name | Main
Category | Sub Category | ITEMNO | LOCATION | ITEMDESC | UOM | Received Qty |
UNITCOST | Total Cost`) beside glossary sheets. Every sheet with these columns
is read; columns are found by header name, so extra or reordered columns are fine.
Mixed date styles are resolved per GRN (see resolve_dates).

Receipts already in the register are kept. A receipt counts as already held when
site, GRN, item code, description, quantity and rate match one in the register
(compared by count, since a GRN can repeat a line), so re-running with an
updated, cumulative export only adds the new GRNs. The data lives in the
`<script type="application/json" id="raGrnData">` block of the dashboard.

Units are normalised to the house units (Nos, Rft, Sft, Cft, Kg, Ton, Ltr ...).
Metric GRN units are converted, and the original unit is kept for the remarks:
Cubic Mtr -> Cft (rate / 35.3147), Metre -> Rft (rate x 0.3048),
Sq.Mt -> Sft (rate x 0.09290304).
"""
import argparse
import datetime as dt
import json
import re
import sys
from collections import Counter
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "zameen-developments" / "index.html"
BLOCK_RE = re.compile(
    r'(<script type="application/json" id="raGrnData">)(.*?)(</script>)', re.S)

# GRN unit (lower-cased) -> (house unit, factor applied to the GRN rate)
UNIT_MAP = {
    "each": ("Nos", 1), "pcs": ("Nos", 1), "nos": ("Nos", 1), "no": ("Nos", 1),
    "rft": ("Rft", 1), "kgs": ("Kg", 1), "kg": ("Kg", 1),
    "cubic mtr": ("Cft", 1 / 35.3147), "cum": ("Cft", 1 / 35.3147),
    "metre": ("Rft", 0.3048), "meter": ("Rft", 0.3048), "mtr": ("Rft", 0.3048),
    "sq.mt": ("Sft", 0.09290304), "sqm": ("Sft", 0.09290304),
    "m.ton": ("Ton", 1), "ton": ("Ton", 1),
    "ltr": ("Ltr", 1), "litre": ("Ltr", 1), "sq.ft": ("Sft", 1), "sft": ("Sft", 1),
    "cft": ("Cft", 1), "coil": ("Coil", 1), "pack": ("Pack", 1),
    "bottle": ("Bottle", 1), "roll": ("Roll", 1), "bucket": ("Bucket", 1),
    "pair": ("Pair", 1), "gallon": ("Gallon", 1), "box": ("Box", 1),
    "length": ("Length", 1), "set": ("Set", 1), "bag": ("Bag", 1),
}

# field -> accepted header names (lower-cased, spaces squeezed); the first one present is used
HEAD = {
    "site": ("site", "location"), "grn": ("grn #", "grn#"), "date": ("grn date",),
    "vendor": ("vendor name",), "code": ("item code", "itemno"),
    "desc": ("item description", "itemdesc", "description"), "uom": ("uom",),
    "qty": ("rec.qty", "received qty"), "rate": ("unitcost",),
    "main": ("main category", "material main category"), "sub": ("sub category",),
}
OPTIONAL = {"total": ("value", "total cost")}

# a site's name in the receiving workbook -> the name the dashboard uses (as in the PO register)
SITE_NAME = {"mall35": "Mall 35"}


def clean(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def to_num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(clean(v).replace(",", ""))
    except ValueError:
        return None


def date_options(v):
    """Every reading of a GRN date cell, the cell's own first.

    The exports mix m/d/yyyy text, dd-mm-yyyy text and real Excel dates, and an Excel
    date with a day of 12 or less may have had its day and month swapped on entry,
    so the swapped reading is offered too; resolve_dates() picks one per GRN."""
    if isinstance(v, (dt.datetime, dt.date)):
        d = v.date() if isinstance(v, dt.datetime) else v
        opts = [d]
        if d.day <= 12 and d.day != d.month:
            opts.append(dt.date(d.year, d.day, d.month))
        return opts
    if isinstance(v, (int, float)):
        return date_options(dt.date(1899, 12, 30) + dt.timedelta(days=int(v)))
    s = clean(v)
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return [dt.date(*map(int, m.groups()))]
    m = re.match(r"(\d{1,2})([/.-])(\d{1,2})\2(\d{4})", s)
    if not m:
        return []
    a, sep, b, y = int(m.group(1)), m.group(2), int(m.group(3)), int(m.group(4))
    order = [(a, b), (b, a)] if sep == "/" else [(b, a), (a, b)]   # (month, day): slash = US m/d first
    opts = []
    for mo, d in order:
        try:
            x = dt.date(y, mo, d)
        except ValueError:
            continue
        if x not in opts:
            opts.append(x)
    return opts


def grn_seq(g):
    m = re.match(r"[A-Za-z]+-(\d+)$", g)
    return int(m.group(1)) if m else None


def resolve_dates(rows):
    """Pick one date per GRN from its rows' readings (row["opts"], the cell's own first).

    A GRN whose rows agree on a single reading is fixed. A site's GRNs are numbered in
    date order, so a GRN left with two readings takes the one that falls between the
    fixed GRNs numbered either side of it. When both fall there, it follows how the
    nearest such decided GRNs went (cell reading or day/month swapped), since a sheet
    keeps one date habit for long stretches. Returns how many GRNs were decided by
    their neighbours, and how many kept the cell's reading with nothing to check it by."""
    groups = {}
    for r in rows:
        # an unnumbered GRN ("Cash") is a group only with rows entered on the same day
        own = None if grn_seq(r["grn"]) is not None else tuple(r["opts"])
        groups.setdefault((r["site"], r["grn"], own), []).append(r)
    cand = {}
    for k, rs in groups.items():
        sets = [set(r["opts"]) for r in rs if r["opts"]]
        common = set.intersection(*sets) if sets else set()
        first = [o for r in rs for o in r["opts"]]
        cand[k] = [o for o in dict.fromkeys(first) if o in common] or first[:1]
    fixed = {}
    for (site, g, _), c in cand.items():
        n = grn_seq(g)
        if len(c) == 1 and n is not None:
            fixed.setdefault(site, []).append((n, c[0]))
    for v in fixed.values():
        v.sort()

    def gaps(site, n, c):
        f = fixed.get(site, [])
        lo = [d for m, d in f if m <= n][-1:]
        hi = [d for m, d in f if m >= n][:1]
        if not lo and not hi:
            return None
        a, b = min(lo + hi), max(lo + hi)
        return [0 if a <= d <= b else min(abs((d - a).days), abs((d - b).days)) for d in c]

    pick, open_, habit = {}, [], {}
    kept = 0
    for k, c in cand.items():
        site, g, _ = k
        n = grn_seq(g)
        if len(c) < 2:
            pick[k] = c[0] if c else None
            continue
        gp = gaps(site, n, c) if n is not None else None
        if gp is None:
            pick[k] = c[0]
            kept += 1
        elif gp[0] != gp[1]:
            i = 0 if gp[0] < gp[1] else 1
            pick[k] = c[i]
            habit.setdefault(site, []).append((n, i))
        else:
            open_.append((k, n))
    for k, n in open_:
        near = sorted(habit.get(k[0], []), key=lambda h: abs(h[0] - n))[:7]
        swaps = sum(i for _, i in near)
        pick[k] = cand[k][1 if near and swaps * 2 > len(near) else 0]
    for k, rs in groups.items():
        for r in rs:
            r["date"] = pick[k].isoformat() if pick[k] else ""
            del r["opts"]
    return sum(len(v) for v in habit.values()) + len(open_), kept


def grn_no(v):
    m = re.match(r"([A-Za-z]+)0*(\d+)$", clean(v))
    return f"{m.group(1).upper()}-{int(m.group(2))}" if m else clean(v)


def find_cols(header):
    col = {}
    for key, names in list(HEAD.items()) + list(OPTIONAL.items()):
        hit = next((header.index(n) for n in names if n in header), None)
        if hit is None and key in HEAD:
            return None
        col[key] = hit
    return col


def read_sheet(ws, label):
    rows = ws.iter_rows(values_only=True)
    try:
        header = [clean(h).lower() for h in next(rows)]
    except StopIteration:
        return None
    col = find_cols(header)
    if col is None:
        return None
    out, skipped, seen = [], Counter(), set()
    for r in rows:
        # a compiled workbook can repeat a row cell for cell where the ERP export has it
        # once; a GRN line listed twice still differs from its twin (sequence, location)
        if r in seen and any(r):
            skipped["repeated row"] += 1
            continue
        seen.add(r)
        g = lambda k: r[col[k]] if col[k] is not None and col[k] < len(r) else None
        site = clean(g("site"))
        if not site:
            continue
        qty, rate, total = to_num(g("qty")), to_num(g("rate")), to_num(g("total"))
        if rate is None and qty:
            # a row shifted one cell right of its header (a blank under UNITCOST): take
            # the first number after the quantity whose product with it is the next cell
            nums = [to_num(x) for x in r[col["qty"] + 1:]]
            rate = next((a for a, b in zip(nums, nums[1:]) if a and b
                         and abs(qty * a - b) <= max(2, 0.01 * b)), None)
        if qty is None and rate and total:
            qty = total / rate
        if not rate or rate <= 0:
            skipped["no rate"] += 1
            continue
        opts = date_options(g("date"))
        if not opts:
            skipped["no date"] += 1
            continue
        out.append({
            "site": SITE_NAME.get(site.lower().replace(" ", ""), site), "grn": grn_no(g("grn")),
            "opts": opts, "vendor": clean(g("vendor")),
            "code": clean(g("code")), "desc": clean(g("desc")),
            "uom": clean(g("uom")), "qty": round(qty or 0, 3),
            "rate": round(rate, 2), "main": clean(g("main")),
            "sub": clean(g("sub")),
        })
    by_nb, kept = resolve_dates(out)
    note = f"{label}: {len(out)} rows"
    if skipped:
        note += ", skipped " + ", ".join(f"{n} {k}" for k, n in skipped.items())
    if by_nb or kept:
        note += f"; {by_nb} GRN dates read by neighbouring GRNs, {kept} left as entered"
    print("  " + note)
    return out


def read_xlsx(path):
    """Every sheet with a GRN header (the old single-sheet export, or a workbook with
    one sheet per site and glossary sheets beside them)."""
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out, found = [], False
    for ws in wb.worksheets:
        rows = read_sheet(ws, f"{path.name} [{ws.title.strip()}]")
        if rows is not None:
            found = True
            out += rows
    if not found:
        sys.exit(f"{path}: no sheet with GRN columns (" + ", ".join(n[0] for n in HEAD.values()) + ")")
    return out


def unpack(data):
    """Flatten the stored register back into receipt dicts."""
    if not data:
        return []
    items, out = data["items"], []
    for ix, date, rate, qty, grn, vi in data["rc"]:
        s, code, desc, mi, si, uom = items[ix][:6]
        out.append({
            "site": data["sites"][s], "grn": grn, "date": date,
            "vendor": data["vendors"][vi], "code": code, "desc": desc,
            "uom": uom, "qty": qty, "rate": rate,
            "main": data["cats"][mi], "sub": data["cats"][si],
        })
    return out


def pack(receipts, sources):
    sites, vendors, cats, items = [], [], [], []
    idx = lambda lst, v: lst.index(v) if v in lst else (lst.append(v) or len(lst) - 1)
    item_ix = {}
    receipts.sort(key=lambda r: (r["site"], r["desc"].lower(), r["code"], r["uom"], r["date"], r["grn"]))
    rc = []
    for r in receipts:
        key = (r["site"], r["code"], r["desc"], r["uom"])
        if key not in item_ix:
            unit, k = UNIT_MAP.get(r["uom"].lower(), (r["uom"].title() or "Nos", 1))
            item_ix[key] = len(items)
            items.append([idx(sites, r["site"]), r["code"], r["desc"],
                          idx(cats, r["main"]), idx(cats, r["sub"]), r["uom"],
                          unit, round(k, 8)])
        rc.append([item_ix[key], r["date"], r["rate"], r["qty"], r["grn"], idx(vendors, r["vendor"])])
    dates = [r["date"] for r in receipts]
    return {
        "rev": dt.date.today().isoformat(), "sources": sources,
        "from": min(dates), "to": max(dates),
        "sites": sites, "vendors": vendors, "cats": cats, "items": items, "rc": rc,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("xlsx", nargs="+", type=Path)
    ap.add_argument("--html", type=Path, default=DEFAULT_HTML)
    ap.add_argument("--dry-run", action="store_true", help="report what would be added, write nothing")
    a = ap.parse_args()

    html = a.html.read_text(encoding="utf-8")
    m = BLOCK_RE.search(html)
    if not m:
        sys.exit(f"{a.html}: no raGrnData block found")
    old = json.loads(m.group(2)) if m.group(2).strip() else None

    receipts = unpack(old)
    key = lambda r: (r["site"], r["grn"], r["code"], r["desc"], r["qty"], r["rate"])
    line = lambda r: (r["site"], r["grn"], r["code"])
    # a GRN can list the same item twice, so compare counts rather than presence
    have = Counter(key(r) for r in receipts)
    sources = list(old["sources"]) if old else []
    added = 0
    for p in a.xlsx:
        rows = read_xlsx(p)
        # 1st pass: the same receipt, value for value
        rest = []
        for r in rows:
            k = key(r)
            if have[k]:
                have[k] -= 1
            else:
                rest.append(r)
        # 2nd pass: a held line of the same site, GRN and item code that the first pass
        # left unmatched is the same receipt exported differently (a compiled workbook
        # rounds the rate, or carries a corrected quantity) - the held one stays
        loose = Counter({k_[:3]: 0 for k_ in have})
        for k_, v in have.items():
            loose[k_[:3]] += v
        n = same = 0
        for r in rest:
            if loose[line(r)]:
                loose[line(r)] -= 1
                same += 1
                continue
            receipts.append(r)
            n += 1
        have = Counter(key(r) for r in receipts)
        if same:
            print(f"  {p.name}: {same} rows already held under the same site, GRN and item code "
                  "with a different rate or quantity - the held line kept")
        if n:
            sources.append(f"{p.name} ({n} receipts, merged {dt.date.today().isoformat()})")
        added += n

    data = pack(receipts, sources)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html[:m.start(2)] + blob + html[m.end(2):]
    if not a.dry_run:
        a.html.write_text(html, encoding="utf-8")
    print(f"{added} new receipts {'would be ' if a.dry_run else ''}added; register now {len(data['rc'])} receipts, "
          f"{len(data['items'])} items, {data['from']} to {data['to']}")


if __name__ == "__main__":
    main()

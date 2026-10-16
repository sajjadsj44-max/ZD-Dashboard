#!/usr/bin/env python3
"""PBS construction & energy prices -> QS Cost Control "PBS Pakistan Bureau of Statistics".

    python tools/pbs_rates.py                               # default folder below
    python tools/pbs_rates.py --dir "D:/Estimation Folder/Escalation Rate" --html zameen-developments/index.html
    python tools/pbs_rates.py --check                       # parse and validate only, write nothing

Reads every `Urbn-Construction_YYYY-MM_Month.xlsx` in the folder: the Pakistan Bureau of Statistics
monthly table "Urban Inter-City Consumer Prices of Construction and Energy Items" (Annex-III of the
Monthly Review on Price Indices), 35 cities x 14 items. Each file must print the same month and year
as its name and carry the 14 known columns in the known order, or the run stops and writes nothing.
A "-" cell (PBS: not available) is kept as null. The whole series replaces the
`<script type="application/json" id="raPbsData">` block in the dashboard page.
"""
import argparse, datetime, glob, json, os, re, sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "zameen-developments" / "index.html"
DEFAULT_DIR = r"D:\Estimation Folder\Escalation Rate"
BLOCK = re.compile(r'(<script type="application/json" id="raPbsData">)(.*?)(</script>)', re.S)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
TITLE = "Urban Inter-City Consumer Prices of Construction and Energy Items"

# header as printed by PBS -> (name, unit, group)
ITEMS = [
    ('Bricks (New first class) (1000)', "Bricks (new, first class)", "per 1000", "Material"),
    ('Cement Blocks (6"x8"x12") (100)', 'Cement blocks (6"x8"x12")', "per 100", "Material"),
    ('Bajri (rata) (per truck) (100 CFT)', "Bajri (rata)", "per truck (100 Cft)", "Material"),
    ('Sand (Black Pit) (per truck) (100 CFT)', "Sand (black pit)", "per truck (100 Cft)", "Material"),
    ('Cement (local) (50kg bag)', "Cement (local)", "per 50 kg bag", "Material"),
    ('Iron bars (1/2" 40 grade) (M.S. bars) (per tonne)', 'Steel bars (1/2" grade 40, M.S.)', "per tonne", "Material"),
    ('Synthetic Enamel (ICI Balti) (3.64 ltr)', "Synthetic enamel (ICI)", "per 3.64 ltr", "Material"),
    ('Painter (per day)', "Painter", "per day", "Labour"),
    ('Mason (raj) (per day)', "Mason (raj)", "per day", "Labour"),
    ('Labour (unskilled) (per day)', "Labour (unskilled)", "per day", "Labour"),
    ('Plumber (per day)', "Plumber", "per day", "Labour"),
    ('Electrician (per point)', "Electrician", "per point", "Labour"),
    ('Petrol Super (per ltr)', "Petrol super", "per ltr", "Energy"),
    ('High Speed Diesel (per ltr)', "High speed diesel", "per ltr", "Energy"),
]
PROVINCE = [
    ("Punjab", ["Rawalpindi", "Attock", "Lahore", "Sahiwal", "Gujranwala", "Sialkot", "Faisalabad", "Jhang",
                "Multan", "D. G. Khan", "Vehari", "Sargodha", "Mianwali", "Bahawalpur", "Bahawalnagar", "R. Y. Khan"]),
    ("Islamabad", ["Islamabad"]),
    ("Sindh", ["Karachi", "Hyderabad", "Nawabshah", "Mirpukhas", "Sukkur", "Larkana", "Dadu"]),
    ("Khyber Pakhtunkhwa", ["Peshawar", "Abbottabad", "Bannu", "D. I. Khan", "Mingora"]),
    ("Balochistan", ["Quetta", "Turbat", "Gawadar", "Loralai", "Khuzdar", "D. M. Jamali"]),
]


def clean(s):
    return re.sub(r"\s+", " ", str(s).replace("\n", " ")).strip()


def read_file(path):
    base = os.path.basename(path)
    m = re.match(r"Urbn-Construction_(\d{4})-(\d{2})_([A-Za-z]+)\.xlsx$", base)
    if not m:
        raise ValueError(f"{base}: name is not Urbn-Construction_YYYY-MM_Month.xlsx")
    key = f"{m.group(1)}-{m.group(2)}"
    if m.group(3) != MONTHS[int(m.group(2)) - 1]:
        raise ValueError(f"{base}: month number and month name disagree")
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    printed, hdr_i, titled = None, None, False
    for i, r in enumerate(rows):
        first = next((c for c in r if c is not None), None)
        if first is None:
            continue
        t = clean(first)
        titled = titled or t.lower() == TITLE.lower()
        mm = re.match(r"^([A-Za-z]+),?\s*(\d{4})$", t)
        if mm and printed is None and mm.group(1).capitalize() in MONTHS:
            printed = f"{mm.group(2)}-{MONTHS.index(mm.group(1).capitalize()) + 1:02d}"
        if t.lower().startswith("names of urban"):
            hdr_i = i
            break
    if not titled:
        raise ValueError(f"{base}: title '{TITLE}' not found")
    if printed != key:
        raise ValueError(f"{base}: the sheet prints {printed}, the file name says {key}")
    if hdr_i is None:
        raise ValueError(f"{base}: header row 'Names of Urban Centers' not found")
    hdr = rows[hdr_i]
    cc = next(j for j, c in enumerate(hdr) if c is not None)
    cols = [(j, clean(c)) for j, c in enumerate(hdr) if c is not None and j > cc]
    if [c for _, c in cols] != [x[0] for x in ITEMS]:
        raise ValueError(f"{base}: columns differ from the known 14 items: {[c for _, c in cols]}")
    out = {}
    for r in rows[hdr_i + 1:]:
        if cc >= len(r) or r[cc] is None:
            continue
        city = clean(r[cc])
        vals = []
        for j, _ in cols:
            v = r[j] if j < len(r) else None
            if isinstance(v, (int, float)):
                vals.append(round(float(v), 2))
            elif v is None or clean(v) in ("-", ""):
                vals.append(None)
            else:
                try:
                    vals.append(round(float(clean(v).replace(",", "")), 2))
                except ValueError:
                    raise ValueError(f"{base}: {city}: unreadable value {v!r}")
        if any(x is not None for x in vals):
            out[city] = vals
    return key, base, out


def build(folder):
    files = sorted(glob.glob(os.path.join(folder, "Urbn-Construction_*.xlsx")))
    if not files:
        raise ValueError(f"no Urbn-Construction_*.xlsx in {folder}")
    cities = [c for _, cs in PROVINCE for c in cs]
    months, names, rates = [], [], []
    for f in files:
        key, base, data = read_file(f)
        if key in months:
            raise ValueError(f"{base}: {key} appears twice")
        if sorted(data) != sorted(cities):
            raise ValueError(f"{base}: cities differ — missing {sorted(set(cities) - set(data))}, extra {sorted(set(data) - set(cities))}")
        months.append(key); names.append(base)
        rates.append([data[c] for c in cities])
    order = sorted(range(len(months)), key=lambda i: months[i])
    return {
        "source": "Pakistan Bureau of Statistics (PBS), Monthly Review on Price Indices, Annex-III — " + TITLE,
        "url": "https://www.pbs.gov.pk/",
        "folder": DEFAULT_DIR,
        "built": datetime.date.today().isoformat(),
        "items": [[n, u, g] for _, n, u, g in ITEMS],
        "provinces": [[p, cs] for p, cs in PROVINCE],
        "cities": cities,
        "months": [months[i] for i in order],
        "files": [names[i] for i in order],
        "r": [rates[i] for i in order],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--html", default=str(DEFAULT_HTML))
    ap.add_argument("--check", action="store_true", help="validate only")
    a = ap.parse_args()
    try:
        d = build(a.dir)
    except ValueError as e:
        sys.exit(f"pbs_rates: {e}")
    print(f"{len(d['months'])} months {d['months'][0]} .. {d['months'][-1]}, {len(d['cities'])} cities, {len(d['items'])} items")
    if a.check:
        return
    with open(a.html, encoding="utf-8", newline="") as fh:   # keep the page's CRLF line ends
        html = fh.read()
    if not BLOCK.search(html):
        sys.exit(f"pbs_rates: {a.html}: no raPbsData block found")
    js = json.dumps(d, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = BLOCK.sub(lambda m: m.group(1) + js + m.group(3), html, count=1)
    with open(a.html, "w", encoding="utf-8", newline="") as fh:
        fh.write(html)
    print(f"wrote raPbsData ({len(js) // 1024} KB) into {a.html}")


if __name__ == "__main__":
    main()

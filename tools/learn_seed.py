"""Makes takeoff/learn-seed.json, the reference method the PDF Takeoff learning agent starts from (learnSeedLoad in takeoff.js):
the Phoenix finishing BOQ as a reference project in learnFacts' format ({rooms: {KIND: {n, items: {key: {n, how, per}}}}, conds}),
plus the room names the app did not know and the measured-area / written-size ratio per room kind.

items.json and x2_<floor>.json are what the Phoenix BOQ job (5-Nov-2026) drew its Backup Drawings and Excel from: every row is a
room's name, the item, its CAD outline and quantity. ROOM_KINDS / ROOM_RX / VOID_RX copy takeoff.js's: change them together.

   python tools/learn_seed.py <items.json> <x2 folder> takeoff/learn-seed.json"""
import json, re, sys, collections, statistics

items = json.load(open(sys.argv[1], encoding='utf-8'))['items']
X2 = sys.argv[2]
OUT = sys.argv[3]

ROOM_KINDS = [(r"\bBATH|TOILET|\bW\.?\s?C\b|WASH\s*ROOM|POWDER|\bPWD\b|SHOWER", "BATH"), (r"\bBED\s*(ROOM)?\b|\bB\.?\s?R\.?\s?\d", "BED ROOM"), (r"KITCHEN|\bKIT\b|PANTRY", "KITCHEN"),
  (r"LOUNGE|LIVING|DRAWING|FAMILY|\bT\.?\s?V\b|SITTING", "LOUNGE"), (r"DINING", "DINING"), (r"BALCONY|TERRACE|VERANDAH?", "BALCONY"), (r"DRESS|\bWARD(ROBE)?\b|W\.?I\.?C\b|CLOSET", "DRESS"),
  (r"STORE|LAUNDRY|UTILITY", "STORE"), (r"PASSAGE|CORRIDOR|LOBBY|FOYER|ENTRANCE|GALLERY", "PASSAGE"), (r"STAIR", "STAIR"), (r"SERVANT|MAID|DRIVER", "SERVANT ROOM")]
ROOM_RX = re.compile(r"\b(MASTER\s+)?(BED\s*ROOM|BED|LOUNGE|LIVING|DRAWING|DINING|FAMILY|TV|KITCHEN|KIT|PANTRY|BATH|TOILET|W\.?C|POWDER|PWD|JACUZZI|WASH|DRESS(ING)?|WARDROBE|WARD\.?|W\.?I\.?C|STORE|LAUNDRY|UTILITY|SERVANT|MAID|DRIVER|GUARD|LOBBY|FOYER|ENTRANCE|PASSAGE|CORRIDOR|GALLERY|BALCONY|TERRACE|VERANDAH?|PORCH|LAWN|GARAGE|PARKING|STUDY|OFFICE|PRAYER|GYM|HALL|RECEPTION|STAIR(CASE|S)?|LIFT|LOBBY|DUCT|SHAFT|ELECTRIC(AL)?\s+ROOM|PLANT|SHOP|ROOM)\b", re.I)
VOID_RX = re.compile(r"\b(SHAFT|DUCT|VOID|LIFT|O\.?T\.?S|OPEN\s+TO\s+SKY|CUT\s*-?\s*OUT|LIGHT\s*WELL|STAIR\s*WELL)\b", re.I)

def room_type(label):   # as roomType() in takeoff.js (the app's own rule)
    u = str(label or '').upper()
    if not u.strip(): return ''
    for rx, t in ROOM_KINDS:
        if re.search(rx, u): return t
    w = [x for x in re.sub(r"[^A-Z\s]", " ", u).split() if len(x) > 1 and x not in ("NO", "THE", "OF", "AND", "AREA")]
    return " ".join(w[:2])

# the items, as conditions the app can make (name, type, unit, H) and how they go with a room
CONDS = {
  "A1": ("Floor tile 24x24 (gloss porcelain)", "area", "Sft", 0, "area"),
  "A2": ("Common area floor tile", "area", "Sft", 0, "area"),
  "A3": ("Bath floor tile 24x24 (matte)", "area", "Sft", 0, "area"),
  "A4": ("Balcony floor tile (outdoor matte)", "area", "Sft", 0, "area"),
  "A5": ("Skirting 4in", "linear", "ft", 0, "wall"),
  "A6": ("Bath wall tiles", "linear", "Sft", 8.5, "wall"),
  "B1": ("Wall paint (emulsion)", "linear", "Sft", 10.0, "wall"),
  "B2": ("Ceiling paint", "area", "Sft", 0, "area"),
  "C1": ("POP false ceiling", "area", "Sft", 0, "area"),
  "C2": ("Corridor false ceiling", "area", "Sft", 0, "area"),
  "C3": ("Bath false ceiling", "area", "Sft", 0, "area"),
  "H1": ("Wet-area waterproofing", "area", "Sft", 0, "area"),
}
COUNTS = {   # per room, from the item totals (F rows are per floor, not per room)
  "BATH": [("F1", "WC with muslim shower"), ("F2", "Wash basin"), ("F5", "Bath mirror"), ("F3", "Shower mixer set"), ("F4", "Shower glass enclosure")],
  "KITCHEN": [("F6", "Kitchen sink")],
}
key = lambda name, ty, unit: name.strip().lower() + "|" + ty + "|" + unit

def pos_rows(code):   # one row per room the item was taken in: positive rows with a drawn outline
    return [r for r in items[code]['rows'] if (r.get('nos') or 0) > 0 and r.get('geom')]

ROOM_ITEMS = ["A1", "A2", "A3", "A4"]   # every room measured has one floor item: those are the rooms
rooms = collections.Counter()
for c in ROOM_ITEMS:
    for r in pos_rows(c): rooms[room_type(r['loc'])] += 1
rooms.pop('', None)

facts = {}
for ty, n in rooms.items(): facts[ty] = {"n": n, "items": {}}
for c, (name, typ, unit, h, how) in CONDS.items():
    cnt = collections.Counter(room_type(r['loc']) for r in pos_rows(c))
    for ty, m in cnt.items():
        if ty in facts: facts[ty]["items"][key(name, typ, unit)] = {"n": min(m, facts[ty]["n"]), "how": how, "per": []}
tot = {c: sum((r.get('qty') or 0) for r in items[c]['rows']) for c in ["F1", "F2", "F3", "F4", "F5", "F6"]}
for ty, L in COUNTS.items():
    if ty not in facts: continue
    nr = facts[ty]["n"]
    for c, name in L:
        share = min(1.0, tot[c] / (223 if ty == "BATH" else 86))   # 223 baths, 86 kitchens in the BOQ (the totals' own base)
        m = round(nr * share)
        if m: facts[ty]["items"][key(name, "count", "Nos")] = {"n": m, "how": "count", "per": [1] * m}

conds = {}
for c, (name, typ, unit, h, how) in CONDS.items(): conds[key(name, typ, unit)] = {"name": name, "type": typ, "unit": unit, "h": h, "t": 0, "faces": 1, "ded": 0}
for L in COUNTS.values():
    for c, name in L: conds[key(name, "count", "Nos")] = {"name": name, "type": "count", "unit": "Nos", "h": 0, "t": 0, "faces": 1, "ded": 0}

# room names the app's room words do not know
words = collections.Counter()
for c in ROOM_ITEMS + ["C2", "J2", "J8"]:
    for r in items[c]['rows']:
        lb = str(r.get('loc') or '')
        if not lb.strip() or ROOM_RX.search(lb) or VOID_RX.search(lb) or lb.lower().startswith('less'): continue
        t = room_type(lb)
        if t and len(t) >= 3: words[t] += 1

# written size (L x W on the label) against the area of the outline measured
FT = re.compile(r"(\d+)\s*'\s*-?\s*(\d+)?\s*(½|1/2)?\s*\"?")
def feet(s):
    m = FT.match(s.strip())
    if not m: return None
    return int(m.group(1)) + (int(m.group(2) or 0) + (0.5 if m.group(3) else 0)) / 12
SZ = re.compile(r"(\d+\s*'\s*-?\s*\d*\s*(?:½|1/2)?\s*\"?)\s*[xX×]\s*(\d+\s*'\s*-?\s*\d*\s*(?:½|1/2)?\s*\"?)")
ratios = collections.defaultdict(list)
for c in ROOM_ITEMS:
    for r in pos_rows(c):
        lb = str(r['loc']).replace('�', '½'); m = SZ.search(lb)
        if not m or not r.get('cad'): continue
        a, b = feet(m.group(1)), feet(m.group(2))
        if not a or not b: continue
        ratios[room_type(lb)].append(r['cad'] / (a * b))
sizes = {}
for ty, L in ratios.items():
    if len(L) < 6: continue
    L.sort(); q = lambda p: L[min(len(L) - 1, int(p * len(L)))]
    sizes[ty] = {"n": len(L), "med": round(statistics.median(L), 3), "p10": round(q(0.10), 3), "p90": round(q(0.90), 3)}

# doors and the openings the outlines were closed at (from the room engine's door list), per floor plan
dw = collections.Counter()
for f in ["GF", "1ST", "2ND", "PH"]:
    try: x = json.load(open(X2 + "/x2_" + f + ".json", encoding='utf-8'))
    except Exception: continue
    for d in x.get('doors', []): dw[round(d.get('width_in') or 0)] += 1
seed = {
  "v": 1, "format": "zd-learn-seed",
  "src": "Zameen Phoenix finishing BOQ, 05-Nov-2026 - 49 items measured from 03-WORKING PLAN 08-01-2026 (Backup Drawings Item 01-49)",
  "at": "2026-11-05T00:00:00Z",
  "projects": {"seed:phoenix": {"name": "Zameen Phoenix (reference)", "at": "2026-11-05T00:00:00Z", "rooms": facts, "conds": conds}},
  "words": dict(words),
  "sizes": sizes,
  "doors": {str(k): v for k, v in sorted(dw.items()) if k},
}
json.dump(seed, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print("rooms", dict(rooms))
for ty, f in facts.items(): print(" ", ty, f["n"], {k.split("|")[0]: v["n"] for k, v in f["items"].items()})
print("words", dict(words)); print("sizes", sizes); print("doors", seed["doors"])

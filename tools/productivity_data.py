#!/usr/bin/env python3
"""Build the Productivity tab's reference data (the prodData JSON block).

Every crew output, coverage figure and day-rate in the Productivity tab comes from this
script, never from the UI code, and every one names its source and date:

  docs/RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx   sheet "13 PRODUCTIVITY LIBRARY": crew
        outputs per 8-hour day already checked against a dated Pakistani benchmark (Punjab MRS
        2026 labour share, MAK Mall-35 installation rates, ConcretesMath Lahore piece rates);
        rows with no dated benchmark stay marked as assumed
  tools/productivity_refs.json   labour constants of IS 7272 (Part 1):1974 North Zone and the CPWD
        Delhi Analysis of Rates, and material coverage from manufacturers' data sheets, each
        typed as printed with its clause / page and a verbatim quote
  zameen-developments/index.html   the Punjab MRS 2nd Bi-Annual 2026 (Lahore) register
        (raMrsData) for the MRS labour share of each activity and the extra-labour items behind
        the floor factors; the Rate Database blocks for the built-in day-rates

Units are converted to the house units (cft, Sft, Rft, kg, Nos) here, with the printed figure
kept beside it. A published labour constant (days of each trade per unit) becomes a crew: the
lead skilled trade (the first one the source prints) is 1, every other trade is its days ÷ the lead's days, and the crew output
per day is 1 ÷ the lead's days per house unit.

Usage:
  pip install openpyxl
  tools/productivity_data.py zameen-developments/index.html
  python -m unittest tools/test_productivity_data.py

The block <script type="application/json" id="prodData"> is replaced in place.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "docs" / "RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx"
REFS = ROOT / "tools" / "productivity_refs.json"
REV = "2026-10-20"
DAY_HOURS = 8

CFT_PER_M3 = 35.31466672148859      # (1 / 0.3048)^3, exact foot
SFT_PER_M2 = 10.763910416709722     # (1 / 0.3048)^2
RFT_PER_M = 3.280839895013123       # 1 / 0.3048

# house unit and size of one printed base unit: a labour constant per printed unit ÷ size = per house unit.
# A printed unit may carry a count, as the CPWD analyses do ("10 m3", "135 m2", "3.95 quintal").
BASE = {
    "m3": ("cft", CFT_PER_M3), "cum": ("cft", CFT_PER_M3), "m2": ("Sft", SFT_PER_M2), "sqm": ("Sft", SFT_PER_M2),
    "m": ("Rft", RFT_PER_M), "rm": ("Rft", RFT_PER_M), "metre": ("Rft", RFT_PER_M),
    "kg": ("kg", 1.0), "quintal": ("kg", 100.0), "tonne": ("kg", 1000.0), "mt": ("kg", 1000.0),
    "each": ("Nos", 1.0), "nos": ("Nos", 1.0), "no": ("Nos", 1.0), "point": ("Point", 1.0),
    "cft": ("cft", 1.0), "sft": ("Sft", 1.0), "rft": ("Rft", 1.0),
}


def unit(printed):
    m = re.match(r"^\s*(\d+(?:\.\d+)?)?\s*([A-Za-z]+[23]?)\s*$", printed)
    if not m or m.group(2).lower() not in BASE:
        raise SystemExit("unknown unit " + repr(printed))
    hu, f = BASE[m.group(2).lower()]
    return hu, f * float(m.group(1) or 1)

# trades as printed in IS 7272 / CPWD (grade and class words dropped) → the Rate Database day-rate code that prices them.
# A row can name the code itself where the same word means another trade (CPWD's "Fitter" in steel formwork is the
# shuttering carpenter; in structural steel the fabricator).
ROLE = {
    "mason": "L-MASON", "mason (average)": "L-MASON", "mason (special)": "L-MASON", "mason 1st class": "L-MASON",
    "mason 2nd class": "L-MASON", "stone mason": "L-MASON", "tile layer": "L-TILE", "tile fixer": "L-TILE",
    "beldar": "L-HELPER", "coolie": "L-HELPER", "mazdoor": "L-HELPER", "bhisti": "L-HELPER", "helper": "L-HELPER",
    "labour": "L-HELPER", "unskilled": "L-HELPER", "khalasi": "L-HELPER", "mate": "L-HELPER", "chowkidar": "L-HELPER",
    "carpenter": "L-CARP", "carpenter 1st class": "L-CARP", "carpenter 2nd class": "L-CARP",
    "blacksmith": "L-STEEL", "blacksmith 1st class": "L-STEEL", "blacksmith 2nd class": "L-STEEL", "bar bender": "L-STEEL",
    "steel fixer": "L-STEEL", "painter": "L-PAINT", "plumber": "L-PLUMB", "fitter": "L-PLUMB", "pipe fitter": "L-PLUMB",
    "electrician": "L-ELEC", "wireman": "L-ELEC", "welder": "LAB-FAB", "fabricator": "LAB-FAB", "glazier": "LAB-GLZ",
    "operator": "L-OPER", "mixer operator": "L-OPER", "vibrator operator": "L-OPER", "foreman": "L-FORE",
    "beldar/coolie": "L-HELPER", "skilled beldar": "L-HELPER", "bandhani": "L-HELPER", "bar-bender": "L-STEEL",
    "khallasi": "L-HELPER", "mistry": "L-FORE", "polisher": "L-PAINT", "washer": "L-PAINT", "white washer": "L-PAINT",
}


def role_code(entry):
    if len(entry) > 2:
        return entry[2]
    r = re.sub(r"\(.*?\)", " ", entry[0].lower())
    r = re.sub(r"\b(1st|2nd|first|second) class\b|\bgrade \d\b", " ", r)
    r = re.sub(r"\s+", " ", r).strip(" ,")
    if r not in ROLE:
        raise SystemExit("unknown trade " + repr(entry[0]))
    return ROLE[r]

# Master RA Rev07 labour codes (sheet 13) → Rate Database day-rate codes
LAB = {"LAB-MSN": "L-MASON", "LAB-HLP": "L-HELPER", "LAB-SFX": "L-STEEL", "LAB-PLS": "L-PLMASON", "LAB-CRP": "L-CARP",
       "LAB-WPA": "LAB-WPA", "LAB-TIL": "L-TILE", "LAB-PNT": "L-PAINT", "LAB-CLG": "LAB-CLG", "LAB-PLB": "L-PLUMB",
       "LAB-ELC": "L-ELEC", "LAB-PFT": "LAB-PFT", "LAB-HVT": "LAB-HVT", "LAB-FAB": "LAB-FAB", "LAB-GLZ": "LAB-GLZ"}

ROLE_NAME = {"L-MASON": "Mason", "L-PLMASON": "Plaster mason", "L-HELPER": "Helper", "L-STEEL": "Steel fixer",
             "L-CARP": "Carpenter", "L-TILE": "Tile fixer", "L-PAINT": "Painter", "L-ELEC": "Electrician", "L-PLUMB": "Plumber",
             "L-HVAC": "HVAC technician", "L-OPER": "Mixer operator", "L-FORE": "Foreman", "LAB-WPA": "Waterproofer",
             "LAB-CLG": "Ceiling fixer", "LAB-PFT": "Pipe fitter", "LAB-HVT": "Duct fitter", "LAB-FAB": "Fabricator",
             "LAB-GLZ": "Glazier", "LAB-SCF": "Scaffolder", "LAB-CLD": "Cladding fixer"}
UNSKILLED = {"L-HELPER"}

# ---------------------------------------------------------------------------------------------
# Activities. id, trade, name, house unit, floor factor key, Punjab MRS (chapter, item, line) for the
# labour-share cross-check, search words.
# ---------------------------------------------------------------------------------------------
A = []


def act(i, t, n, u, lift=None, mrs=None, k=""):
    A.append({"id": i, "t": t, "n": n, "u": u, "lift": lift, "mrs": mrs, "k": k})


act("exc_surface", "Earthwork", "Surface excavation by hand up to 1 ft deep", "Sft", k="khudai digging levelling")
act("exc_trench", "Earthwork", "Trench excavation by hand — soft / ordinary soil, up to 5 ft deep", "cft", mrs=(3, 21, 2), k="khudai digging trench foundation")
act("exc_hard", "Earthwork", "Excavation by hand over areas — hard soil, up to 5 ft deep", "cft", mrs=(3, 21, 3), k="khudai digging murrum")
act("backfill", "Earthwork", "Backfilling in 6\" layers, watered & rammed", "cft", mrs=(3, 15, 1), k="bharai filling compaction")
act("sand_fill", "Earthwork", "Sand filling under floors in 6\" layers", "cft", mrs=(10, 3, 1), k="ret reti bharai")
act("carriage", "Earthwork", "Earth carriage by hand — first 50 m lead, incl. loading & unloading", "cft", k="mitti disposal head load")
act("pcc", "Concrete", "PCC / lean concrete — mixer, placed & compacted", "cft", mrs=(6, 5, 9), k="lean concrete 1:4:8 1:2:4")
act("pcc_hand", "Concrete", "PCC in foundations — hand mixed", "cft", mrs=(6, 5, 9), k="lean concrete hand mix")
act("rcc_site", "Concrete", "RCC — site-batched (mixer), placing, compacting & curing", "cft", lift="rcc", mrs=(6, 5, 6), k="concrete slab beam column")
act("rcc_rmc", "Concrete", "RCC — ready-mix, pumped placing, compacting & curing", "cft", k="ready mix pump concrete")
act("rcc_fdn", "Concrete", "RCC in foundations, footings & rafts — mixer", "cft", mrs=(6, 6, 10), k="concrete footing raft")
act("rcc_slab", "Concrete", "RCC in slabs — mixer", "cft", lift="rcc", mrs=(6, 6, 1), k="concrete chhat roof slab")
act("rcc_beam", "Concrete", "RCC in beams — mixer", "cft", lift="rcc", mrs=(6, 6, 1), k="concrete beam")
act("rcc_col", "Concrete", "RCC in columns & walls — mixer", "cft", lift="rcc", mrs=(6, 6, 1), k="concrete column")
act("rcc_stair", "Concrete", "RCC in stairs — mixer", "cft", lift="rcc", mrs=(6, 6, 1), k="concrete sidhi stair")
act("rebar", "Reinforcement", "Rebar — cut, bend, place & tie", "kg", mrs=(6, 12, 3), k="sariya steel bar bending binding")
act("fw_slab", "Formwork", "Formwork — slab soffit (fix & strip)", "Sft", lift="rcc", k="shuttering centering")
act("fw_beam", "Formwork", "Formwork — beam sides & soffit (fix & strip)", "Sft", lift="rcc", k="shuttering")
act("fw_col", "Formwork", "Formwork — columns (fix & strip)", "Sft", lift="rcc", k="shuttering")
act("fw_wall", "Formwork", "Formwork — walls / shear walls / lift core", "Sft", lift="rcc", k="shuttering")
act("fw_found", "Formwork", "Formwork — foundations, footings & plinth beams", "Sft", k="shuttering")
act("fw_stair", "Formwork", "Formwork — staircase", "Sft", k="shuttering sidhi")
act("brick_fdn", "Masonry", "Brick masonry in foundation & plinth (1:6)", "cft", mrs=(7, 4, 5), k="eent chunai brickwork")
act("brick9", "Masonry", "Brick masonry 9\" & above — superstructure (1:6)", "cft", lift="brick", mrs=(7, 5, 5), k="eent chunai brickwork")
act("brick135", "Masonry", "Brick masonry 13½\" and thicker walls", "cft", lift="brick", k="eent chunai brickwork")
act("brick9w", "Masonry", "Brick masonry 9\" wall — per Sft of wall face", "Sft", lift="brick", k="eent chunai brickwork")
act("brick45", "Masonry", "Brick masonry 4½\" wall", "Sft", lift="brick", k="eent chunai half brick partition")
act("block8", "Masonry", "Concrete block masonry 8\"", "Sft", k="blockwork")
act("block6", "Masonry", "Concrete block masonry 6\"", "Sft", k="blockwork")
act("block4", "Masonry", "Concrete block masonry 4\"", "Sft", k="blockwork")
act("stone_rr", "Masonry", "Random rubble stone masonry", "cft", mrs=(8, 1, 6), k="pathar stone")
act("dpc", "Masonry", "DPC 1½\" concrete with bitumen coats", "Sft", mrs=(6, 37, 4), k="damp proof course")
act("plaster_half", "Plaster", "Cement plaster ⅜\"–½\" — walls", "Sft", mrs=(11, 9, 2), k="palaster plaster")
act("plaster_3q", "Plaster", "Cement plaster ¾\" — walls (internal / external)", "Sft", mrs=(11, 11, 3), k="palaster plaster")
act("plaster_ceil", "Plaster", "Cement plaster ⅜\" — ceilings / soffits", "Sft", mrs=(11, 12, 3), k="palaster plaster chhat")
act("pointing", "Plaster", "Pointing on brickwork", "Sft", mrs=(11, 16, 1), k="tip pointing")
act("screed1", "Flooring", "Floor screed / topping 1\"", "Sft", mrs=(10, 16, 1), k="farsh floor topping")
act("screed15", "Flooring", "Floor / roof screed 1½\"", "Sft", mrs=(10, 16, 3), k="farsh floor topping")
act("screed2", "Flooring", "Floor screed 2\"", "Sft", mrs=(10, 16, 5), k="farsh floor topping")
act("screed3", "Flooring", "Floor screed 3\"", "Sft", mrs=(10, 16, 9), k="farsh floor topping")
act("terrazzo", "Flooring", "Terrazzo (chips) flooring in situ — lay, grind & polish", "Sft", lift="floor", k="farsh chips")
act("terrazzo_tile", "Flooring", "Precast terrazzo tile flooring — lay, grind & polish", "Sft", lift="floor", k="farsh chips tiles")
act("tile_floor", "Tiling", "Floor tiling on tile adhesive (ceramic / porcelain)", "Sft", lift="floor", mrs=(10, 23, 1), k="tiles farsh")
act("tile_floor_mortar", "Tiling", "Floor tiling on cement mortar bed (ceramic / porcelain)", "Sft", lift="floor", mrs=(10, 23, 1), k="tiles farsh")
act("tile_wall", "Tiling", "Wall tiling / dado", "Sft", mrs=(10, 24, 1), k="tiles dado")
act("marble_floor", "Tiling", "Marble flooring in mortar bed, rubbed & polished", "Sft", lift="floor", k="marble farsh")
act("granite_floor", "Tiling", "Granite flooring in mortar bed", "Sft", lift="floor", k="granite farsh")
act("stone_clad", "Tiling", "Stone cladding — granite tiles on walls in mortar", "Sft", k="granite cladding")
act("stone_dry", "Tiling", "Stone cladding — dry fixed with clamps, 30 mm", "Sft", k="cladding facade")
act("paint_int", "Painting", "Internal emulsion system (primer + 2 putty + 2 finish)", "Sft", k="rang paint emulsion")
act("paint_ext", "Painting", "External weather-shield system (primer + 2 finish)", "Sft", k="rang paint weather")
act("emulsion_coat", "Painting", "Emulsion paint — one coat on prepared surface", "Sft", k="rang paint")
act("emulsion2", "Painting", "Emulsion paint — two coats on walls", "Sft", k="rang paint")
act("putty_coat", "Painting", "Wall putty — one coat", "Sft", k="putty")
act("primer_wall", "Painting", "Wall primer / sealer — one coat", "Sft", k="primer")
act("primer_wood", "Painting", "Primer on wood — one coat", "Sft", k="primer")
act("primer_steel", "Painting", "Red oxide primer on steel — one coat", "Sft", k="primer")
act("distemper", "Painting", "Distemper — two coats", "Sft", mrs=(11, 24, 2), k="rang distemper")
act("whitewash", "Painting", "White wash — three coats", "Sft", k="safedi chuna")
act("enamel2", "Painting", "Synthetic enamel on wood / steel — two coats", "Sft", k="rang enamel oil paint")
act("cement_paint", "Painting", "Waterproof cement paint, exterior — two coats", "Sft", k="rang cement paint")
act("french_polish", "Painting", "French polish on wood", "Sft", k="polish")
act("wp_torch", "Waterproofing", "Torch-on membrane incl. primer", "Sft", k="waterproofing membrane roof")
act("wp_cem", "Waterproofing", "Cementitious waterproofing — 2 coats", "Sft", k="waterproofing")
act("wp_bitumen", "Waterproofing", "Bitumen coating to roof / walls", "Sft", mrs=(13, 9, 2), k="bitumen coal tar")
act("wp_felt", "Waterproofing", "Bitumen felt waterproofing, 4 courses", "Sft", k="felt roof")
act("wp_cem_wet", "Waterproofing", "Cementitious waterproofing — sunken WC / bath", "Sft", k="waterproofing bathroom")
act("roof_mud", "Waterproofing", "Roof mud phuska 4\" (mitti + bhusa) laid to slope", "Sft", k="mitti roof insulation")
act("roof_tile", "Waterproofing", "Brick tile layer on roof over mud, grouted", "Sft", k="tiles roof")
act("gyp_ceiling", "Ceiling & partitions", "Gypsum board ceiling — frame, board, tape & joint", "Sft", mrs=(9, 49, 1), k="false ceiling gypsum")
act("gyp_part", "Ceiling & partitions", "Gypsum board partition", "Sft", mrs=(9, 50, 1), k="drywall partition")
act("tbar_ceiling", "Ceiling & partitions", "T-bar grid false ceiling with tiles", "Sft", k="false ceiling")
act("door_frame", "Doors & windows", "Door frame (chokhat) — wood, wrought, framed & fixed", "Nos", k="chokhat darwaza")
act("door_shutter", "Doors & windows", "Door shutter fixing with fittings (ready-made)", "Sft", k="darwaza shutter")
act("hinges", "Doors & windows", "Butt hinges — fixing", "Nos", k="qabza hinge")
act("tower_bolt", "Doors & windows", "Tower bolt — fixing", "Nos", k="kunda bolt")
act("alu_frame", "Doors & windows", "Aluminium doors / windows — frames, fabricate & fix", "kg", k="khirki window aluminium")
act("alu_shutter", "Doors & windows", "Aluminium doors / windows — shutters, fabricate & fix", "kg", k="khirki window aluminium")
act("glazing", "Doors & windows", "Glazing", "Sft", k="sheesha glass")
act("ppr_s", "Plumbing", "PPR pipe ½\"–1\" with fittings, clamps & testing", "Rft", k="pipe water supply")
act("ppr_m", "Plumbing", "PPR pipe 1¼\"–2\"", "Rft", k="pipe water supply")
act("ppr_65", "Plumbing", "PPR pipe 2½\"", "Rft", k="pipe")
act("ppr_80", "Plumbing", "PPR pipe 3\"", "Rft", k="pipe")
act("ppr_110", "Plumbing", "PPR / HDPE pipe 4\" (110 mm)", "Rft", k="pipe")
act("gi_pipe", "Plumbing", "GI pipe ½\" (15 mm) with fittings & clamps", "Rft", k="pipe galvanised")
act("gi_pipe1", "Plumbing", "GI pipe 1\" (25 mm) with fittings & clamps", "Rft", k="pipe galvanised")
act("gi_pipe2", "Plumbing", "GI pipe 2\" (50 mm) with fittings & clamps", "Rft", k="pipe galvanised")
act("ci_pipe", "Plumbing", "Cast iron soil / waste pipe 4\"", "Rft", k="pipe drain")
act("upvc2", "Plumbing", "uPVC SWV pipe 2\"", "Rft", k="drain soil waste vent")
act("upvc3", "Plumbing", "uPVC SWV pipe 3\"", "Rft", k="drain soil waste vent")
act("upvc4", "Plumbing", "uPVC SWV pipe 4\"", "Rft", k="drain soil waste vent")
act("wc", "Plumbing", "WC suite fixing & connection", "Nos", k="commode toilet sanitary")
act("wc_indian", "Plumbing", "Squatting (Indian) WC fixing", "Nos", k="toilet sanitary")
act("basin", "Plumbing", "Wash basin fixing & connection", "Nos", k="sanitary sink")
act("sink", "Plumbing", "Kitchen sink fixing & connection", "Nos", k="sanitary")
act("sewer", "Drainage", "Stoneware sewer pipe 4\" — lay & joint", "Rft", k="drainage sewer")
act("sewer6", "Drainage", "Stoneware sewer pipe 6\" — lay & joint", "Rft", k="drainage sewer")
act("conduit", "Electrical", "PVC conduit 20 mm — surface or recessed", "Rft", k="wiring pipe electric")
act("wiring_pt", "Electrical", "Point wiring (light / fan point)", "Point", k="wiring electric")
act("wiring_ckt", "Electrical", "Circuit wiring 2 × 1.5 mm² + earth in conduit", "Rft", k="wiring electric")
act("wire_draw", "Electrical", "Drawing wires in existing conduit", "Rft", k="wiring electric")
act("switch", "Electrical", "Modular switch / socket — fixing", "Nos", k="electric")
act("switch_board", "Electrical", "Switch board box with plate — fixing", "Nos", k="electric")
act("db", "Electrical", "Distribution board SPN 8-way — fixing", "Nos", k="electric panel")
act("db_tpn", "Electrical", "Distribution board TPN 4-way — fixing", "Nos", k="electric panel")
act("mcb", "Electrical", "MCB in existing board — fixing", "Nos", k="electric breaker")
act("light", "Electrical", "Light fixture (LED) — fixing & connection", "Nos", k="electric light")
act("fan", "Electrical", "Ceiling fan — installation", "Nos", k="pankha electric")
act("cable", "Electrical", "LV cable up to 35 mm² — laid & clamped on wall", "Rft", k="electric")
act("fire1", "Fire fighting", "MS Sch-40 fire pipe 1\"", "Rft", k="sprinkler pipe")
act("fire2", "Fire fighting", "MS Sch-40 fire pipe 2\"", "Rft", k="sprinkler pipe")
act("fire4", "Fire fighting", "MS Sch-40 fire pipe 4\" grooved", "Rft", k="sprinkler pipe")
act("sprinkler", "Fire fighting", "Sprinkler head with drop", "Nos", k="fire")
act("duct", "HVAC", "GI ductwork — fabricate & install", "Sft", k="duct air conditioning")
act("duct_ins", "HVAC", "Duct insulation 1\"", "Sft", k="insulation")
act("steel_fab", "Steel structure", "Structural steel — built-up sections / trusses, fabricate & erect", "kg", k="steel structure fabrication truss")
act("steel_erect", "Steel structure", "Structural steel — single sections, cut, hoist & fix", "kg", k="steel structure erection")
act("scaffold", "Other", "Scaffolding — erect, maintain & remove (per Sft of elevation)", "Sft", k="paar scaffolding")
act("demo_pcc", "Demolition", "Demolishing plain concrete (1:3:6 or richer)", "cft", k="torna demolition")
act("demo_rcc", "Demolition", "Demolishing RCC incl. stacking the bars", "cft", mrs=(4, 20, 1), k="torna demolition")
act("demo_brick", "Demolition", "Demolishing brickwork in cement mortar", "cft", mrs=(4, 13, 1), k="torna demolition")
act("demo_stone", "Demolition", "Demolishing stone masonry in cement mortar", "cft", k="torna demolition")

# Master RA Rev07 sheet-13 codes → activity
LIB_ACT = {
    "PR-RCC": "rcc_site", "PR-PCC": "pcc", "PR-RMC": "rcc_rmc", "PR-RFT": "rebar", "PR-FWS": "fw_slab",
    "PR-FWB": "fw_beam", "PR-FWC": "fw_col", "PR-FWW": "fw_wall", "PR-BRK": "brick9", "PR-BRKF": "brick_fdn",
    "PR-BRK45": "brick45", "PR-BLK8": "block8", "PR-BLK6": "block6", "PR-BLK4": "block4", "PR-PLS": "plaster_half",
    "PR-PLS75": "plaster_3q", "PR-PLSC": "plaster_ceil", "PR-SCR1": "screed1", "PR-SCR": "screed15",
    "PR-SCR2": "screed2", "PR-SCR3": "screed3", "PR-WPM": "wp_torch", "PR-WPC": "wp_cem", "PR-DPC": "dpc",
    "PR-TLF": "tile_floor", "PR-TLW": "tile_wall", "PR-MBL": "marble_floor", "PR-CLG": "gyp_ceiling",
    "PR-PNT": "paint_int", "PR-PNX": "paint_ext", "PR-BKF": "backfill", "PR-SNF": "sand_fill",
    "PR-PPR-S": "ppr_s", "PR-PPR-M": "ppr_m", "PR-PPR-250": "ppr_65", "PR-PPR-300": "ppr_80",
    "PR-PPR-400": "ppr_110", "PR-SWV2": "upvc2", "PR-SWV3": "upvc3", "PR-SWV4": "upvc4", "PR-FFP1": "fire1",
    "PR-FFP2": "fire2", "PR-FFP4": "fire4", "PR-SPK": "sprinkler", "PR-WC": "wc", "PR-WB": "basin",
    "PR-DINS": "duct_ins", "PR-DUCT": "duct",
}

# Floor factors: MRS extra labour for upper floors. ex = extra PKR / unit for the 1st, 2nd … floor
# (kind "table"), add = each further floor; "from" = one flat extra from that floor up; "each" = add × floor.
LIFT = {
    "brick": {"n": "Brick masonry (9\" and 4½\")", "kind": "table", "base": (7, 5, 5),
              "ex": [(7, 6, 1), (7, 6, 2), (7, 6, 3), (7, 6, 4)], "add": (7, 6, 5),
              "ref": "Ch.7 item 5(i) 1:6 ground-floor labour share; item 6 extra labour for 1st–4th floor and each floor above"},
    "rcc": {"n": "RCC placing and formwork", "kind": "from", "from": 1, "base": (6, 6, 1), "add": (6, 6, 17),
            "ref": "Ch.6 item 6(a) RCC labour share (incl. forms, placing, curing); item 6(f) extra labour for 2nd and subsequent storeys (= 1st floor and above)"},
    "floor": {"n": "Floor tiling, marble / stone flooring", "kind": "each", "base": (10, 23, 1), "add": (10, 19, 1),
              "ref": "Ch.10 item 23 ceramic tile floor labour share; item 19 extra labour for each storey above ground"},
}

METHOD = [
    "A crew output is what one gang completes in an 8-hour working day. Crew-days = quantity ÷ crew output; man-days = crew-days × crew size; duration = crew-days ÷ number of crews.",
    "Published labour constants (IS 7272, CPWD) give days of each trade per unit. They are turned into a crew: the lead skilled trade (the first the source prints) = 1, each other trade = its days ÷ the lead's days, crew output = 1 ÷ the lead's days per unit.",
    "Metric units are converted with the exact foot (0.3048 m): 1 m³ = 35.3147 cft, 1 m² = 10.7639 Sft, 1 m = 3.2808 Rft. The figure as printed is kept beside every converted one.",
    "Pakistan rows come from the Master Rate Analysis Rev07 productivity library: each crew output was checked against a dated benchmark (Punjab MRS 2026 labour share, MAK Mall-35 installation rate, Lahore piece rate) and kept within ±35% or reset. Rows with no dated benchmark are marked assumed.",
    "MRS labour PKR / unit is the labour share printed in the Punjab MRS 2nd Bi-Annual 2026 (Lahore) for the nearest item — a government schedule figure to compare the norm's labour cost with.",
    "Floor factor = MRS base labour ÷ (base labour + MRS extra labour for that floor). It slows the crew output on upper floors for brickwork, RCC / formwork and floor finishes.",
    "Labour PKR / unit = Σ (crew size of each trade × its day-rate) ÷ crew output. Day-rates come from the Rate Database (QS Cost Control) when it is on the device, else the dated rate built in here. Overheads, tools, scaffolding and profit are not included.",
    "IS 7272 (1974) and CPWD constants are Indian norms for comparison. Prefer the Pakistan row, and replace any norm with your own site output (Site Output Check) when you have it.",
]


def block(html, bid):
    m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % bid, html, re.S)
    if not m:
        raise SystemExit("index.html has no %s block" % bid)
    return json.loads(m.group(1))


def mrs_index(html):
    d = block(html, "raMrsData")
    idx = {}
    for a in d["items"]:
        idx[(a[0], str(a[1]), a[2])] = {"page": a[3], "head": d["heads"][a[4]], "desc": a[5], "unit": a[7],
                                        "lab": None if a[9] is None else round(a[9] * a[8], 4)}
    ed = "Punjab MRS %s (%s), %s" % (d["edition"], d["district"], dmy(d["from"]))
    return idx, ed


def dmy(iso):
    y, m, d = iso[:10].split("-")
    return "%s-%s-%s" % (d, ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][int(m) - 1], y)


def mrs_line(idx, key):
    ch, it, ln = key
    r = idx.get((ch, str(it), ln))
    if not r or r["lab"] is None:
        raise SystemExit("MRS register has no labour share for Ch.%s item %s line %s" % key)
    return r


def wages(html):
    """Day-rate for each labour code as the Rate Database ends up with it: the page's seed list, then the data blocks
    in the order raLoad() merges them (civil gap review, Master RA, rate refresh) -- a later block replaces an earlier one."""
    best = {}

    def take(code, name, rate, date, src, vs):
        if not rate or float(rate) <= 0:
            return
        best[code] = {"r": round(float(rate), 2), "d": date or "", "s": src, "n": name,
                      "a": vs == "A" or str(src).upper().startswith("ASSUMPTION")}
    for m in re.finditer(r'\["(L(?:AB)?-[A-Z]+)","L","([^"]+)","Day",([\d.]+),"[^"]*","([^"]*)","(\d{4}-\d{2}-\d{2})","([AI])"\]', html):
        take(m.group(1), m.group(2), m.group(3), m.group(5), m.group(4), m.group(6))
    for bid in ("raCivilData", "raMasterData", "raRefreshData"):
        for r in block(html, bid)["rates"]:
            if r.get("kind") == "L" and str(r.get("unit", "")).lower() == "day":
                take(r["code"], r["name"], r["rate"], r.get("date"), r.get("src", ""), r.get("vs"))
    return best


def library(mrs):
    import openpyxl
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["13 PRODUCTIVITY LIBRARY"]
    out = {}
    for r in ws.iter_rows(min_row=4, values_only=True):
        code = r[0]
        if not code or code not in LIB_ACT:
            continue
        out_day, sk_n, hl_n, basis, sk_code, bench, status = r[3], r[4], r[5], r[6], r[7], r[12], r[18]
        crew = []
        if sk_n:
            crew.append([LAB[sk_code], float(sk_n)])
        if hl_n:
            crew.append(["L-HELPER", float(hl_n)])
        assumed = str(status).upper().startswith("ASSUMPTION")
        out[LIB_ACT[code]] = {"s": "zdra7", "code": code, "out": float(out_day), "crew": crew, "st": "A" if assumed else "B",
                              "ref": ("No dated benchmark — " + str(status)) if assumed else "Benchmark: " + str(bench),
                              "note": str(basis or "")}
    missing = set(LIB_ACT) - {v["code"] for v in out.values()}
    if missing:
        raise SystemExit("sheet 13 lacks " + ", ".join(sorted(missing)))
    return out


def crew_from_constants(row):
    """IS / CPWD labour constants per printed unit → crew + output per day in house units."""
    hu, f = unit(row["src_unit"])
    per = {}
    for e in row["labour"]:
        code = role_code(e)
        per[code] = per.get(code, 0.0) + float(e[1]) / f
    skilled = [k for k, v in per.items() if k not in UNSKILLED and v > 0]   # in the order the source prints them
    lead = skilled[0] if skilled else max(per, key=per.get)
    ld = per[lead]
    crew = [[lead, 1.0]] + [[k, round(v / ld, 3)] for k, v in sorted(per.items(), key=lambda x: -x[1]) if k != lead and v > 0]
    return hu, 1.0 / ld, crew


def main(path):
    html = Path(path).read_text(encoding="utf-8")
    refs = json.loads(REFS.read_text(encoding="utf-8"))
    idx, mrs_ed = mrs_index(html)
    lib = library(idx)
    W = wages(html)

    src = {
        "zdra7": {"t": "Master Rate Analysis Rev07 — 13 Productivity Library (RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx)",
                  "d": "27-Sep-2026", "k": "pk", "sh": "Pakistan · RA Rev07",
                  "use": "Crew outputs benchmarked to Punjab MRS 2026 labour shares, MAK Mall-35 installation rates and Lahore piece rates"},
        "mrs26": {"t": mrs_ed.split(", ")[0] + " — labour share columns (dashboard MRS register)", "d": mrs_ed.split(", ")[-1], "k": "pk",
                  "sh": "Punjab MRS 2026", "use": "MRS labour PKR / unit cross-check and the floor factors"},
    }
    for k, s in refs["sources"].items():
        src[k] = s

    acts = []
    for a in A:
        v = []
        if a["id"] in lib:
            v.append(lib[a["id"]])
        for r in refs["norms"]:
            if r["act"] != a["id"]:
                continue
            hu, out, crew = crew_from_constants(r)
            if hu != a["u"]:
                raise SystemExit("%s: %s converts to %s, activity is in %s" % (a["id"], r["src_unit"], hu, a["u"]))
            orig = " + ".join("%s %s day" % (e[0], e[1]) for e in r["labour"]) + " per " + r.get("printed_unit", r["src_unit"])
            v.append({"s": r["s"], "out": round(out, 4), "crew": crew, "st": "S", "ref": r["ref"], "orig": orig,
                      "q": r.get("q", ""), "note": r.get("note", ""), "cond": r.get("cond", "")})
        if not v:
            continue
        o = {"id": a["id"], "t": a["t"], "n": a["n"], "u": a["u"], "k": a["k"], "v": v}
        if a["lift"]:
            o["lift"] = a["lift"]
        if a["mrs"]:
            m = mrs_line(idx, a["mrs"])
            if m["unit"].lower() != a["u"].lower():
                raise SystemExit("%s: MRS line is per %s, activity per %s" % (a["id"], m["unit"], a["u"]))
            o["mrs"] = {"lab": m["lab"], "ref": "Ch.%s item %s line %s, p.%s — %s" % (a["mrs"][0], a["mrs"][1], a["mrs"][2], m["page"], (m["head"] + " " + m["desc"]).strip()[:160])}
        acts.append(o)

    lift = {}
    for k, L in LIFT.items():
        base = mrs_line(idx, L["base"])["lab"]
        o = {"n": L["n"], "kind": L["kind"], "base": base, "add": mrs_line(idx, L["add"])["lab"], "s": "mrs26", "ref": L["ref"]}
        if L["kind"] == "table":
            o["ex"] = [mrs_line(idx, e)["lab"] for e in L["ex"]]
            o["txt"] = "1st %s · 2nd %s · 3rd %s · 4th %s · each floor above +%s PKR / unit" % tuple([round(x, 2) for x in o["ex"]] + [round(o["add"], 2)])
        elif L["kind"] == "from":
            o["from"] = L["from"]
            o["txt"] = "+%s PKR / unit from the %s floor up" % (round(o["add"], 2), "1st")
        else:
            o["txt"] = "+%s PKR / unit for each storey above ground" % round(o["add"], 2)
        lift[k] = o

    used = sorted({c[0] for a in acts for v in a["v"] for c in v["crew"]})
    roles = {c: {"n": ROLE_NAME.get(c, W.get(c, {}).get("n", c)), "sk": 0 if c in UNSKILLED else 1} for c in used}
    wg = {}
    for c in used:
        if c not in W:
            raise SystemExit("no day-rate anywhere for " + c)
        wg[c] = {k: W[c][k] for k in ("r", "d", "s", "a")}

    cov = []
    for i, c in enumerate(refs["coverage"]):
        cov.append(coverage(c, i))

    data = {"rev": REV, "day": DAY_HOURS, "src": src, "roles": roles, "wages": wg, "lift": lift, "method": METHOD,
            "acts": acts, "cov": cov}
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    new, n = re.subn(r'(<script type="application/json" id="prodData">)(.*?)(</script>)',
                     lambda m: m.group(1) + js + m.group(3), html, flags=re.S)
    if n != 1:
        raise SystemExit("index.html needs exactly one prodData block (found %d)" % n)
    Path(path).write_text(new, encoding="utf-8")
    nv = sum(len(a["v"]) for a in acts)
    print("prodData: %d activities, %d crew outputs (%d assumed), %d coverage rows, %d sources, %d day-rates"
          % (len(acts), nv, sum(1 for a in acts for v in a["v"] if v["st"] == "A"), len(cov), len(src), len(wg)))


# coverage units as printed → (base unit, material unit, factor to base unit, mode)
# mode cov: lo/hi are base units per material unit;  use: material units per base unit
COV_UNIT = {
    "m2/L": ("Sft", "L", SFT_PER_M2, "cov"), "m2/l": ("Sft", "L", SFT_PER_M2, "cov"),
    "sft/L": ("Sft", "L", 1.0, "cov"), "m2/kg": ("Sft", "kg", SFT_PER_M2, "cov"), "sft/kg": ("Sft", "kg", 1.0, "cov"),
    "m2/roll": ("Sft", "roll", SFT_PER_M2, "cov"), "m2/board": ("Sft", "board", SFT_PER_M2, "cov"),
    "kg/m2": ("Sft", "kg", 1 / SFT_PER_M2, "use"), "L/m2": ("Sft", "L", 1 / SFT_PER_M2, "use"),
    "l/m2": ("Sft", "L", 1 / SFT_PER_M2, "use"), "kg/sft": ("Sft", "kg", 1.0, "use"),
    "nos/m2": ("Sft", "Nos", 1 / SFT_PER_M2, "use"), "m/m2": ("Sft", "Rft", RFT_PER_M / SFT_PER_M2, "use"),
    "nos/m3": ("cft", "Nos", 1 / CFT_PER_M3, "use"), "nos/cft": ("cft", "Nos", 1.0, "use"),
    "m3/m3": ("cft", "cft", 1.0, "use"), "kg/tonne": ("kg steel", "kg", 1 / 1000.0, "use"),
    "kg/m3": ("cft", "kg", 1 / CFT_PER_M3, "use"), "bags/m3": ("cft", "bag", 1 / CFT_PER_M3, "use"),
    "m2/bag": ("Sft", "bag", SFT_PER_M2, "cov"), "sft/bag": ("Sft", "bag", 1.0, "cov"),
    "nos/100sft": ("Sft", "Nos", 0.01, "use"), "units/bag": ("blocks", "bag", 1.0, "cov"),
    "%cement": ("kg cement", "kg", 1.0, "pct"), "%binder": ("kg binder", "kg", 1.0, "pct"),
}


def coverage(c, i):
    bu, per, f, mode = COV_UNIT[c["coverage_unit"]]
    lo, hi = float(c["coverage_low"]), float(c["coverage_high"])
    lo, hi = lo * f, hi * f
    if mode == "cov":
        u = "%s/%s" % (bu, per)
    elif mode == "pct":
        u = "%% of %s weight" % bu.split(" ")[1]
    else:
        u = "%s per %s" % (per, bu)
    rnd = lambda x: float("%.4g" % x)
    o = {"id": "c%d" % i, "c": c["category"], "m": c["material"], "p": c["product"], "lo": rnd(min(lo, hi)),
         "hi": rnd(max(lo, hi)), "u": u, "bu": bu, "per": per, "mode": mode, "coat": bool(c.get("per_coat")),
         "cond": c.get("conditions", ""), "pack": c.get("pack", ""), "s": c["s"], "ref": c.get("ref", ""),
         "d": c.get("d", ""), "url": c.get("url", ""),
         "orig": "%s–%s %s" % (c["coverage_low"], c["coverage_high"], c.get("printed", c["coverage_unit"])) if c["coverage_low"] != c["coverage_high"]
         else "%s %s" % (c["coverage_low"], c.get("printed", c["coverage_unit"])), "q": c.get("quote", "")}
    if c.get("pack_qty"):
        o["packN"] = float(c["pack_qty"])
    return o


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

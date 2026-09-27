"""Shared decisions for the Master Rate Analysis reconciliation (Rev06 -> Rev07, 27-Sep-2026).

Used by tools/ra_master_excel.py (updates the Excel master) and tools/ra_master_data.py (writes the
dashboard's #raMasterData block from the updated Excel), so both files carry the same numbers.

Every rate here names its source and date (CLAUDE.md). Productivity is corrected only against a
dated published benchmark:
  * Punjab MRS 1st Bi-Annual 2026 (Rawalpindi), 01-Jan-2026 — labour-only share per unit
    (the #raMrsData block of the dashboard);
  * MAK Contractors installation rates, Mall-35 MEP contract 25-Sep-2023 (the MAK-* lines of the
    dashboard) — they include MAK's margin and 7.5% income tax, so they are divided by 1.18 before
    comparing with direct labour (the same 8% OH + 10% profit the library adds);
  * ConcretesMath Lahore labour guide 23-May-2026 piece rates (SRC-06 in the workbook) for plaster,
    tiling and painting.
Rule: an Excel crew output is kept when its labour cost per unit is within +/-35% of the benchmark;
otherwise the output is reset to crew-day cost / benchmark (rounded). No benchmark -> kept and
flagged "ASSUMPTION — confirm by site time study".
"""

REV = "Rev07"
AS_OF = "2026-09-27"
DOC = "RA_Master_Pakistan_FINAL_Rev07_2026-09-27"
MARGIN = 1.18          # MAK subcontract rate / direct labour (8% OH + 10% profit, as the library)
TOL = 0.35             # accepted deviation from a benchmark

# --------------------------------------------------------------------------- rate reconciliation
# Excel resource code -> dashboard Rate Database code (same resource, same unit). Both files must
# hold the same rate after Rev07; tools/ra_master_data.py stops if they do not.
MAP = {
    "MAT-CEM-OPC": "CEM", "MAT-SND-LWP": "SAND-LP", "MAT-SND-CHN": "SAND-CH", "MAT-SND-RAV": "SAND-RV",
    "MAT-CRS-SGD": "CRSH-SG", "MAT-CRS-MGL": "CRSH-MG", "MAT-STL-G60": "STL60", "MAT-BWIRE": "BWIRE",
    "MAT-BRK-A": "BRK-1", "MAT-BLK-8H": "BLK-H8", "MAT-BLK-6H": "BLK-H6", "MAT-BLK-4S": "BLK-S4",
    "MAT-TIM-CHR": "QE-TIMB-CFT", "MAT-NAIL": "NAILS", "MAT-ADM-SP": "ADMIX-SP", "MAT-BIT-HOT": "BITUMEN",
    "MAT-SUBB": "GRAVEL-SB", "MAT-TURF": "GRASS-DHAKA", "MAT-UPW": "UPVC-WIN", "MAT-FRD": "FIRE-DOOR",
    "MAT-EPX": "EPOXY-FLR", "MAT-LAM": "LAM-SUP", "MAT-RMC-4000": "RMC-4000", "MAT-RMC-4500": "RMC-4500",
    "MAT-RMC-6500": "RMC-6500", "MAT-RMC-LEAN": "RMC-LEAN",
    "LAB-MSN": "L-MASON", "LAB-HLP": "L-HELPER", "LAB-SFX": "L-STEEL", "LAB-PLS": "L-PLMASON",
    "LAB-CRP": "L-CARP", "LAB-TIL": "L-TILE", "LAB-PNT": "L-PAINT", "LAB-PLB": "L-PLUMB", "LAB-ELC": "L-ELEC",
    "EQ-PUMP": "P-PUMP",
}

# New source-register rows (sheet 09)
SOURCES = [
    ("SRC-39", "SAJ QSCOST dashboard – CEM line: Lahore market price dashboard, 05-Sep-2026",
     "https://sajjadsj44-max.github.io/zd-dashboards/zameen-developments/", "2026-09-05", "Lahore",
     "OPC supplier band 1,520–1,605 per bag (Flying 1,520 · Gharibwal/Lucky 1,575 · Maple 1,605); web summary "
     "27-Sep-2026 (icons.com.pk / hamariweb.com 04-Sep-2026) gives 1,500–1,610 – consistent"),
    ("SRC-40", "Market rates supplied by Sajjad (QS), 04-Sep-2026", "Dashboard lines SAND-LP / CRSH-SG", "2026-09-04",
     "Lahore", "Lawrencepur sand 240 per cft; Sargodha crush 1/2\" & 3/8\" 185 per cft, delivered"),
    ("SRC-41", "SAJ QSCOST dashboard – CRSH-MG line (web search 23-Sep-2026, July-2026 market pages)",
     "Dashboard line CRSH-MG", "2026-07-01", "Lahore",
     "Margalla crush about 180 per cft; Lahore delivery may add 30–80. Rev06 midpoint 145 was below the "
     "04-Sep-2026 Sargodha quote (185) although Margalla hauls further – 180 adopted"),
    ("SRC-42", "Wooden Box Trading brick rates via Claude chat research (Part 1), 26-Sep-2026",
     "Dashboard lines BRK-1 / BRK-2", "2026-09-26", "Lahore",
     "A-class bricks Rs 16,000–19,000 per 1,000 ('last updated Sep 2026'); cross-check The M Square 23-Jan-2026"),
    ("SRC-43", "Zarea Lahore quotation, 05-Sep-2026", "Dashboard lines BLK-S4 / BLK-H6", "2026-09-05", "Lahore",
     "Solid 4\"x8\"x12\" 140 · hollow 6\"x8\"x16\" 165 per block, MOQ 500, 1200–1500 psi, delivery extra"),
    ("SRC-44", "PropertyDealer.pk bajri rate, 24-Sep-2026", "Dashboard line GRAVEL-SB", "2026-09-24", "Lahore",
     "C-grade sub-base / road crush Rs 95–105 per cft"),
    ("SRC-45", "Web search 23-Sep-2026 – Lahore painting cost guides", "Dashboard line L-PAINT", "2026-09-23",
     "Lahore", "Skilled painters 1,800–2,500 per day; mid 2,100"),
    ("SRC-46", "Punjab MRS 1st Bi-Annual 2026 (Rawalpindi) – labour-only shares used as productivity benchmarks",
     "Dashboard Punjab MRS register (Punjab rates 385_20260110213957.pdf)", "2026-01-01", "Rawalpindi (Punjab)",
     "Labour share per unit printed beside each composite rate; period 01-Jan to 30-Jun-2026 (lapsed – "
     "reconfirm against the Lahore 2nd Bi-Annual 2026 edition when loaded)"),
    ("SRC-47", "MAK Contractors & Associates – Mall-35 MEP installation contract rates (final bill IPC-09)",
     "Dashboard MAK-* lines (MAK Final Bill Checking.xlsx)", "2023-09-25", "Lahore (Mall-35)",
     "Installation-only rates incl. MAK margin and 7.5% income tax; BOQ rates dated 25-Sep-2023, Non-BOQ "
     "31-May-2025. Divided by 1.18 to compare with direct labour"),
    ("SRC-48", "SAJ QSCOST dashboard – GRN Price Register (latest receipt per item)",
     "https://sajjadsj44-max.github.io/zd-dashboards/zameen-developments/", "2021-03 to 2026-09",
     "Lahore sites", "GRN number, date and vendor quoted in each resource note"),
]

# Rate changes applied to the Excel Lahore inputs (05 col N / 06 col M): code -> (rate, date, status, src, note)
EXCEL_RATE_UPDATES = {
    "MAT-CEM-OPC": (1575, "2026-09-05", "Market indication", "SRC-39",
                    "Rev07: 1,415 (Phoenix GRN RCP-266, 06-May-2026, >4 months) -> 1,575 Lahore market 05-Sep-2026 "
                    "(band 1,520–1,605; web 04-Sep-2026 1,500–1,610). Same as dashboard CEM."),
    "MAT-SND-LWP": (240, "2026-09-04", "Market indication", "SRC-40",
                    "Rev07: 190 (SRC-03 national north band, Jul-2026) -> 240 Lahore market rate supplied by Sajjad "
                    "04-Sep-2026. Same as dashboard SAND-LP."),
    "MAT-CRS-SGD": (185, "2026-09-04", "Market indication", "SRC-40",
                    "Rev07: 190 (Quadrangle GRN RCP-2607, Jul-2025, >12 months) -> 185 Lahore market 04-Sep-2026. "
                    "Same as dashboard CRSH-SG."),
    "MAT-CRS-MGL": (180, "2026-07-01", "Market indication", "SRC-41",
                    "Rev07: 145 -> 180. Rev06 midpoint was below the 04-Sep-2026 Sargodha quote (185) although "
                    "Margalla hauls further; 180 = dashboard CRSH-MG (web, Jul-2026). Get a delivered quote."),
    "MAT-BRK-A": (17.5, "2026-09-26", "Market indication", "SRC-42",
                  "Rev07: 18 -> 17.5 (Rs 16,000–19,000 per 1,000, Sep-2026). Same as dashboard BRK-1."),
    "MAT-BLK-6H": (165, "2026-09-05", "Vendor quote", "SRC-43",
                   "Rev07: 110 (national ex-factory midpoint, Jun-2026) -> 165 Zarea Lahore quotation 05-Sep-2026. "
                   "Same as dashboard BLK-H6."),
    "MAT-BLK-4S": (140, "2026-09-05", "Vendor quote", "SRC-43",
                   "Rev07: 103 (Phoenix GRN RCP-213, Oct-2025, >11 months) -> 140 Zarea Lahore quotation "
                   "05-Sep-2026. Same as dashboard BLK-S4."),
    "MAT-SUBB": (100, "2026-09-24", "Market indication", "SRC-44",
                 "Rev07: 120 (Phoenix GRN RCP-149, 30-Apr-2025, >12 months) -> 100 (Rs 95–105, 24-Sep-2026). "
                 "Same as dashboard GRAVEL-SB."),
    "LAB-PLS": (2150, "2025-10-11", "Market indication", "SRC-33",
                "Rev07: 2,200 (mason band, no trade source) -> 2,150 ConcretesMath Lahore plaster mason "
                "(range 1,900–2,400). Same as dashboard L-PLMASON."),
    "LAB-TIL": (2500, "2025-10-11", "Market indication", "SRC-33",
                "Rev07: 2,200 (mason band) -> 2,500 ConcretesMath Lahore tile/marble fixer (2,200–2,800). "
                "Same as dashboard L-TILE."),
    "LAB-PNT": (2100, "2026-09-23", "Market indication", "SRC-45",
                "Rev07: 2,200 (mason band) -> 2,100 Lahore painters 1,800–2,500 (web 23-Sep-2026). Same as "
                "dashboard L-PAINT."),
}

# Dashboard lines moved by the block (only while still at the published value; a hand edit is kept)
DASH_RATE_UPDATES = {
    "QE-TIMB-CFT": {"rate": 3680, "date": "2026-06-10", "vs": "V", "prev": [[3000, ""]],
                    "src": "Phoenix GRN RCP-277, 10-Jun-2026 — Taha International, wooden planks 1.5\"×9\"×10' at "
                           "3,450 each ÷ 0.9375 cft = 3,680 per cft (species not stated on the GRN). Adopted from "
                           "the Master Rate Analysis Rev07 (MAT-TIM-CHR); replaces the undated 3,000 assumption"},
}

# --------------------------------------------------------------------------- productivity
# code: activity, unit, Rev07 output/crew-day, skilled nos, helper nos, skilled labour code,
#       benchmark label, benchmark labour per unit (direct, PKR) or None, basis note
# Rev06 outputs are read from the workbook; rows not in the workbook are new in Rev07.
MRS = "Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026"
MAK = "MAK Mall-35 install rate, 25-Sep-2023"
PROD = {
    "PR-RCC": ("RCC placing & compacting – site-batched (mixer)", "cft", 100, 1, 8, "LAB-MSN",
               f"{MRS} Ch.6 item 5 labour share 140.26/cft (plain concrete placed, compacted, cured, site-mixed)",
               140.263, "Kept: 145.04/cft is within 3% of the MRS labour share."),
    "PR-PCC": ("PCC / lean concrete placing – site-batched", "cft", 80, 1, 6, "LAB-MSN",
               f"{MRS} Ch.6 item 5(i) 1:4:8 labour share 140.26/cft", 140.263,
               "Corrected 150 -> 80 cft/day: Rev06 labour 76.19/cft was 46% below MRS."),
    "PR-RFT": ("Rebar cut, bend & fix", "kg", 360, 1, 1, "LAB-SFX",
               f"{MRS} Ch.6 item 12(b)(ii) Grade-60 labour share 11.03/kg (cut, bend, place, bind)", 11.031,
               "Corrected 250 -> 360 kg/day: Rev06 labour 15.95/kg was 45% above MRS."),
    "PR-BRK": ("Brick masonry 9\" and above – ground floor", "cft", 50, 1, 1.5, "LAB-MSN",
               f"{MRS} Ch.7 item 5(i) labour share 90.57/cft (1:6, ground floor)", 90.566,
               "Corrected 80 -> 50 cft/day (≈675 bricks per mason-day): Rev06 labour 56.34/cft was 38% below MRS."),
    "PR-PLS": ("Cement plaster ⅜\"–½\" – walls", "Sft", 100, 1, 1, "LAB-PLS",
               f"{MRS} Ch.11 item 9(b) ½\" 1:4 labour share 36.20/Sft; SRC-06 Lahore piece rate 28–38/Sft", 36.2,
               "Kept: 36.88/Sft agrees with MRS and SRC-06."),
    "PR-FWS": ("Formwork – slab soffit (fix + strip)", "Sft", 150, 1, 1, "LAB-CRP", "No dated benchmark", None,
               "ASSUMPTION — confirm by site time study. Dashboard FW-320 uses 55 Sft/day (also unsourced)."),
    "PR-FWB": ("Formwork – beam sides & soffit", "Sft", 100, 1, 1, "LAB-CRP", "No dated benchmark", None,
               "ASSUMPTION — confirm by site time study."),
    "PR-FWC": ("Formwork – columns", "Sft", 120, 1, 1, "LAB-CRP", "No dated benchmark", None,
               "ASSUMPTION — confirm by site time study."),
    "PR-FWW": ("Formwork – walls / shear walls / lift core", "Sft", 130, 1, 1, "LAB-CRP", "No dated benchmark", None,
               "ASSUMPTION — confirm by site time study."),
    "PR-BLK8": ("Block masonry 8\"", "Sft", 100, 1, 1, "LAB-MSN", "No dated benchmark (MRS has no block item)", None,
                "ASSUMPTION — confirm. Dashboard BLK-* generator uses 50 Sft/day (also unsourced)."),
    "PR-BLK6": ("Block masonry 6\"", "Sft", 120, 1, 1, "LAB-MSN", "No dated benchmark", None, "ASSUMPTION — confirm."),
    "PR-BLK4": ("Block masonry 4\"", "Sft", 150, 1, 1, "LAB-MSN", "No dated benchmark", None, "ASSUMPTION — confirm."),
    "PR-BRK45": ("Brick masonry 4½\"", "Sft", 120, 1, 1, "LAB-MSN",
                 f"{MRS} Ch.7 item 5 90.57/cft × 0.375 ft = 33.96/Sft", 33.962,
                 "Kept: 31.15/Sft within 8% of the MRS-derived rate."),
    "PR-SCR": ("Floor/roof screed 1½\"", "Sft", 95, 1, 2, "LAB-MSN",
               f"{MRS} Ch.10 item 16(c) 1½\" floor topping labour share 56.39/Sft", 56.391,
               "Corrected 250 -> 95 Sft/day: Rev06 21.10/Sft was 63% below MRS. MRS topping includes panel "
               "finishing; screed under tiles may be faster — confirm by time study."),
    "PR-WPM": ("Torch-on membrane incl. primer", "Sft", 180, 1, 1, "LAB-WPA",
               f"{MRS} Ch.9 item 46(a)(ii) 4 mm torch-on labour share 20.45/Sft", 20.45,
               "Corrected 400 -> 180 Sft/day: Rev06 9.35/Sft was 54% below MRS."),
    "PR-WPC": ("Cementitious waterproofing 2 coats", "Sft", 300, 1, 1, "LAB-WPA", "No dated benchmark", None,
               "ASSUMPTION — confirm. Dashboard CV-048 / WP-410 use 200 Sft/day (also unsourced)."),
    "PR-DPC": ("DPC 1.5\" concrete + bitumen coats", "Sft", 125, 1, 2, "LAB-MSN",
               f"{MRS} Ch.6 item 37(b)(i) labour share 41.94/Sft", 41.941,
               "Corrected 200 -> 125 Sft/day: Rev06 26.38/Sft was 37% below MRS."),
    "PR-TLF": ("Floor tiling on adhesive", "Sft", 120, 1, 1, "LAB-TIL",
               "SRC-06 ConcretesMath Lahore tiling piece rate 30–55/Sft (23-May-2026); MRS Ch.10 item 23/36 "
               "prints 80.35/Sft (government schedule, on 1:2 mortar bed)", 42.5,
               "Kept: 33.65/Sft sits inside the Lahore market piece-rate band."),
    "PR-TLW": ("Wall tiling on adhesive", "Sft", 100, 1, 1, "LAB-TIL", "SRC-06 30–55/Sft (as PR-TLF)", 42.5,
               "Kept: 40.38/Sft inside the band."),
    "PR-MBL": ("Marble flooring in mortar bed", "Sft", 80, 1, 1, "LAB-TIL", "SRC-06 30–55/Sft (tiling band)", 42.5,
               "Kept: 50.48/Sft inside the band; grinding/polishing excluded."),
    "PR-CLG": ("Gypsum ceiling – frame, board, tape & joint", "Sft", 150, 2, 1, "LAB-CLG",
               f"{MRS} Ch.9 item 49(ii) labour share 45.20/Sft", 45.2, "Kept: 39.59/Sft within 12% of MRS."),
    "PR-PNT": ("Internal paint system (primer + 2 putty + 2 finish)", "Sft", 150, 1, 0.5, "LAB-PNT",
               f"{MRS} Ch.13 items 31(a)+31(b) emulsion 7.94 + 6.09 + 2 × item 46 putty 3.74 = 21.51/Sft; "
               "SRC-06 painting 12–22/Sft", 21.51, "Kept: 19.13/Sft within 11% of MRS."),
    "PR-PNX": ("External weather-shield system (primer + 2 finish)", "Sft", 70, 1, 0.5, "LAB-PNT",
               f"{MRS} Ch.13 item 33(a) new surface 1st coat 26.80 + 2nd coat 14.72 = 41.52/Sft (incl. primer, prep)",
               41.522, "Corrected 200 -> 70 Sft/day: Rev06 14.35/Sft was 65% below MRS. Access (cradle/scaffold) "
                       "still measured separately."),
    # ---- new in Rev07
    "PR-RMC": ("Ready-mix concrete – pumped placing, compacting & curing", "cft", 155, 1, 8, "LAB-MSN",
               f"{MRS} Ch.6 item 9(c) plant-batched RCC placing labour share 93.70/cft", 93.7,
               "New: CIV-CON-020..023 used the site-mix crew (145.04/cft, 55% above MRS). Dashboard RCC-RMC-* uses "
               "the same MRS basis."),
    "PR-BRKF": ("Brick masonry in foundation & plinth", "cft", 55, 1, 1.5, "LAB-MSN",
                f"{MRS} Ch.7 item 4(i) foundation 1:6 labour share 80.28/cft", 80.279, "New for CIV-MAS-006."),
    "PR-PLS75": ("Cement plaster ¾\" – walls (int./ext.)", "Sft", 80, 1, 1, "LAB-PLS",
                 f"{MRS} Ch.11 item 9(c) ¾\" labour share 45.54/Sft", 45.54,
                 "New: ¾\" plaster (FIN-PLS-002/003) used the ½\" output; MRS prints 26% more labour."),
    "PR-PLSC": ("Cement plaster ⅜\" – ceilings / soffits", "Sft", 90, 1, 1, "LAB-PLS",
                f"{MRS} Ch.11 item 12 soffit ⅜\" labour share 41.48/Sft", 41.48, "New for FIN-PLS-004."),
    "PR-SCR1": ("Floor screed 1\"", "Sft", 115, 1, 2, "LAB-MSN", f"{MRS} Ch.10 item 16(a) 1\" topping 45.21/Sft",
                45.21, "New for FIN-SCR-004."),
    "PR-SCR2": ("Floor screed 2\"", "Sft", 80, 1, 2, "LAB-MSN", f"{MRS} Ch.10 item 16(e) 2\" topping 67.57/Sft",
                67.571, "New for FIN-SCR-002."),
    "PR-SCR3": ("Floor screed 3\"", "Sft", 65, 1, 2, "LAB-MSN", f"{MRS} Ch.10 item 16(i) 3\" topping 78.75/Sft",
                78.751, "New for FIN-SCR-003."),
    "PR-BKF": ("Backfilling in 6\" layers, watered (plate compactor separate)", "cft", 375, 0, 2, "LAB-HLP",
               f"{MRS} Ch.3 item 15(i) filling, watering and ramming earth under floors 8.16/cft", 8.155,
               "New: CIV-EW-004 used 2 helpers/200 cft (15.38/cft, 89% above MRS)."),
    "PR-SNF": ("Sand filling under floors in 6\" layers", "cft", 450, 0, 2, "LAB-HLP",
               f"{MRS} Ch.10 item 3 supplying and filling sand under floor labour share 6.77/cft", 6.767,
               "New: CIV-EW-005 used 2 helpers/200 cft (15.38/cft)."),
    "PR-PPR-S": ("PPR pipe ½\"–1\" with fittings, clamps, testing", "Rft", 45, 1, 1, "LAB-PLB",
                 f"{MAK} MP-201A PPR 25 mm 105.49/Rft ÷ 1.18", 89.40, "New: Rev06 80 Rft/day was 42% below MAK."),
    "PR-PPR-M": ("PPR pipe 1¼\"–2\"", "Rft", 35, 1, 1, "LAB-PLB", f"{MAK} MP-201D PPR 50 mm 141.86/Rft ÷ 1.18",
                 120.22, "New: Rev06 50 Rft/day was 31–42% below MAK."),
    "PR-PPR-250": ("PPR pipe 2½\"", "Rft", 25, 1, 1, "LAB-PLB", f"{MAK} MP-201F PPR 75 mm 189.15/Rft ÷ 1.18",
                   160.30, "New."),
    "PR-PPR-300": ("PPR pipe 3\"", "Rft", 20, 1, 1, "LAB-PLB", f"{MAK} MP-201G PPR 90 mm 238.09/Rft ÷ 1.18",
                   201.77, "New."),
    "PR-PPR-400": ("PPR / HDPE pipe 4\" (110 mm)", "Rft", 17, 1, 1, "LAB-PLB",
                   f"{MAK} MP-201H PPR 110 mm 291.00/Rft ÷ 1.18", 246.61, "New."),
    "PR-SWV2": ("uPVC SWV pipe 2\"", "Rft", 35, 1, 1, "LAB-PLB", f"{MAK} MP-301A uPVC 2\" 134.59/Rft ÷ 1.18",
                114.06, "New: Rev06 60 Rft/day was 40% below MAK."),
    "PR-SWV3": ("uPVC SWV pipe 3\"", "Rft", 16, 1, 1, "LAB-PLB", f"{MAK} MP-301B uPVC 3\" 301.91/Rft ÷ 1.18",
                255.86, "New."),
    "PR-SWV4": ("uPVC SWV pipe 4\"", "Rft", 15, 1, 1, "LAB-PLB", f"{MAK} MP-301C uPVC 4\" 327.38/Rft ÷ 1.18",
                277.44, "New."),
    "PR-FFP1": ("MS Sch-40 fire pipe 1\"", "Rft", 23, 1, 1, "LAB-PFT", f"{MAK} MF-401A MS 1\" 210.98/Rft ÷ 1.18",
                178.79, "New: Rev06 40 Rft/day was 42% below MAK."),
    "PR-FFP2": ("MS Sch-40 fire pipe 2\"", "Rft", 14, 1, 1, "LAB-PFT", f"{MAK} MF-401D MS 2\" 349.20/Rft ÷ 1.18",
                295.93, "New."),
    "PR-FFP4": ("MS Sch-40 fire pipe 4\" grooved", "Rft", 7.5, 1, 1, "LAB-PFT",
                f"{MAK} MF-401G MS 4\" 647.48/Rft ÷ 1.18", 548.71, "New."),
    "PR-SPK": ("Sprinkler head with drop", "Nos", 5.8, 1, 1, "LAB-PFT", f"{MAK} MF-404A sprinkler 836.63 ÷ 1.18",
               709.0, "New: Rev06 10 heads/day was 42% below MAK."),
    "PR-WC": ("WC suite fixing & connection", "Nos", 0.83, 1, 1, "LAB-PLB",
              f"{MAK} MP-101 European WC with fittings 5,856.38 ÷ 1.18", 4963.03,
              "New: Rev06 0.5 crew-day per WC was 58% below MAK."),
    "PR-WB": ("Wash basin fixing & connection", "Nos", 0.9, 1, 1, "LAB-PLB",
              f"{MAK} MP-104 pedestal basin 5,438 ÷ 1.18", 4608.47, "New."),
    "PR-DINS": ("Duct insulation 1\"", "Sft", 74, 1, 1, "LAB-HVT", f"{MAK} MN-H10 1\" duct insulation 69.00/Sft ÷ 1.18",
                58.47, "New: Rev06 150 Sft/day was 51% below MAK."),
    "PR-DUCT": ("GI ductwork fabricate & install", "Sft", 50, 1, 1, "LAB-HVT",
                f"{MAK} MH-301 GI ductwork 95.74/Sft ÷ 1.18", 81.13, "Kept 50 Sft/day (within 7% of MAK)."),
}

# Rev06 outputs behind the new codes (the formulas they replace), for the deviation column
REV06_NEW = {"PR-RMC": 100, "PR-BRKF": 80, "PR-PLS75": 100, "PR-PLSC": 100, "PR-SCR1": 250, "PR-SCR2": 250,
             "PR-SCR3": 250, "PR-BKF": 200, "PR-SNF": 200, "PR-PPR-S": 80, "PR-PPR-M": 50, "PR-PPR-250": 50,
             "PR-PPR-300": 50, "PR-PPR-400": 50, "PR-SWV2": 60, "PR-SWV3": 60, "PR-SWV4": 60, "PR-FFP1": 40,
             "PR-FFP2": 40, "PR-FFP4": 40, "PR-SPK": 10, "PR-WC": 2, "PR-WB": 2, "PR-DINS": 150, "PR-DUCT": 50}

# Blocks whose labour rows are re-linked to a productivity code: item -> code (both skilled and helper rows,
# and 1-per-crew-day plant rows)
RELINK = {
    "CIV-CON-020": "PR-RMC", "CIV-CON-021": "PR-RMC", "CIV-CON-022": "PR-RMC", "CIV-CON-023": "PR-RMC",
    "FIN-PLS-002": "PR-PLS75", "FIN-PLS-003": "PR-PLS75", "FIN-PLS-004": "PR-PLSC",
    "FIN-SCR-002": "PR-SCR2", "FIN-SCR-003": "PR-SCR3", "FIN-SCR-004": "PR-SCR1",
    "CIV-MAS-006": "PR-BRKF", "CIV-EW-004": "PR-BKF", "CIV-EW-005": "PR-SNF",
    "PLB-PPR-075": "PR-PPR-S", "PLB-PPR-100": "PR-PPR-S", "PLB-PPR-125": "PR-PPR-S",
    "PLB-PPR-150": "PR-PPR-M", "PLB-PPR-175": "PR-PPR-M", "PLB-PPR-200": "PR-PPR-M",
    "PLB-PPR-250": "PR-PPR-250", "PLB-PPR-300": "PR-PPR-300", "PLB-PPR-400": "PR-PPR-400",
    "PLB-SWV-200": "PR-SWV2", "PLB-SWV-300": "PR-SWV3", "PLB-SWV-400": "PR-SWV4",
    "FF-PIP-100": "PR-FFP1", "FF-PIP-200": "PR-FFP2", "FF-PIP-400": "PR-FFP4", "FF-SPL-001": "PR-SPK",
    "PLB-FIX-001": "PR-WC", "PLB-FIX-002": "PR-WB", "MEP-HVAC-002": "PR-DINS", "MEP-HVAC-001": "PR-DUCT",
}

# --------------------------------------------------------------------------- new resources
# Excel code (== dashboard code) -> sheet, description, unit, source key. Rate/date/src come from the dashboard
# line of the same code (MRS / GRN), or are left blank (NO SOURCE) for the skeleton inputs.
NEW_RES = {
    # MRS labour-only item rates (06), per unit of work
    "MRS-C6-6-17": ("L", "Extra labour for RCC in 2nd and subsequent storeys (MRS item rate)", "cft"),
    "MRS-C7-6-1": ("L", "Extra labour for brickwork in 1st floor (MRS item rate)", "cft"),
    "MRS-C7-6-2": ("L", "Extra labour for brickwork in 2nd floor (MRS item rate)", "cft"),
    "MRS-C7-6-3": ("L", "Extra labour for brickwork in 3rd floor (MRS item rate)", "cft"),
    "MRS-C7-6-4": ("L", "Extra labour for brickwork in 4th floor (MRS item rate)", "cft"),
    "MRS-C7-6-5": ("L", "Extra labour for brickwork, each floor above 4th (MRS item rate)", "cft"),
    "MRS-C11-29-1": ("L", "Extra labour for plaster above 20 ft, each 10 ft (MRS item rate)", "Sft"),
    "MRS-C10-19-1": ("L", "Extra labour for flooring, each storey above ground (MRS item rate)", "Sft"),
    # GRN materials (05)
    "GRN-QUA-HDW-000614": ("M", "HDPE pipe 110 mm", "Rft"),
    "GRN-QUA-MEP-001380": ("M", "HDPE elbow 90° 110 mm", "Nos"),
    "GRN-QUA-MEP-001381": ("M", "HDPE tee 110 mm", "Nos"),
    "GRN-QUA-MEP-000939": ("M", "MS landing valve 2½\" flange type", "Nos"),
    "GRN-QUA-ARC-000002": ("M", "Signage board 3D acrylic letters 15 ft × 4.5 ft", "Nos"),
    # skeleton inputs – no dated source (RFQ)
    "MAT-MOB": ("M", "Mobilization & demobilization (contractor quote)", "Job"),
    "MAT-SITEOFF": ("M", "Site office, stores & welfare establishment (contractor quote)", "Job"),
    "MAT-TEMPSVC": ("M", "Temporary water & electricity supply incl. running (per month)", "Month"),
    "MAT-CUBE": ("M", "Concrete cylinder / cube test set incl. sampling & lab fee", "Nos"),
    "MAT-CLEAN": ("M", "Final builder's clean (sub-contract rate)", "Sft"),
    "MAT-GYP-SYSFR": ("M", "Fire-rated gypsum ceiling system material (FR board on GI frame)", "Sft"),
    "MAT-MCLG": ("M", "Aluminium clip-in / lay-in metal ceiling 2'×2' with grid", "Sft"),
    "MAT-ACCP": ("M", "Access panel 2'×2' for gypsum ceiling, supplied & installed", "Nos"),
    "MAT-CPT": ("M", "Carpet tiles 20\"×20\" with adhesive, supplied & installed", "Sft"),
    "MAT-WPP": ("M", "Vinyl wallpaper with adhesive, supplied & installed", "Sft"),
    "MAT-ACPNL": ("M", "Acoustic wall panel system, supplied & installed", "Sft"),
    "MAT-GLDR": ("M", "12 mm toughened glass door 3'×7' with patch fittings & floor spring", "Nos"),
    "MAT-GRC": ("M", "GRC façade panel with fixings, supplied & installed", "Sft"),
    "MAT-EIFS": ("M", "EIFS insulated render system, supplied & applied", "Sft"),
    "MAT-CNPY": ("M", "Steel / glass entrance canopy, supplied & installed", "Sft"),
    "MAT-SKYL": ("M", "Skylight – polycarbonate / glass on aluminium frame", "Sft"),
    "MAT-URN": ("M", "Wall-hung urinal with flush valve & trap", "Nos"),
    "MAT-CPVC-100": ("M", "CPVC pipe ¾\" SDR-11 with fittings", "Rft"),
    "MAT-ACS": ("M", "Access control door set (reader, maglock, exit button, controller)", "Nos"),
    "MAT-ESC": ("M", "Escalator complete (vendor supply & install)", "Nos"),
    "MAT-IRR": ("M", "Drip / sprinkler irrigation system (vendor)", "Sft"),
    "MAT-VRF": ("M", "VRF system – outdoor + indoor units, piping & controls (vendor)", "TR"),
    "MAT-MDB": ("M", "Main distribution board (panel builder quote)", "Nos"),
}

# --------------------------------------------------------------------------- new rate analyses
# rows: (component, resource, description, unit, consumption, wastage). Consumption may be a number, an
# Excel formula string ("=1/67.5"), or "PR:<code>:S|H|P" (skilled / helper / plant per unit from sheet 13).
def _mrs_extra(code, trade, sub, cat, desc, unit, mrs, note, qc, qs):
    return {"code": code, "trade": trade, "sub": sub, "cat": cat, "desc": desc, "unit": unit, "qc": qc, "qs": qs,
            "spec": "Extra-over item – add to the base item for work at the stated level; labour only",
            "rows": [("Labour", mrs, "MRS extra labour – item rate per unit", unit, 1, 0)], "note": note, "conf": "Medium"}


def _skel(code, trade, sub, cat, desc, unit, res, qc, qs, extra_rows=(), note=""):
    return {"code": code, "trade": trade, "sub": sub, "cat": cat, "desc": desc, "unit": unit, "qc": qc, "qs": qs,
            "spec": "Vendor / sub-contract supply & install – enter a dated quotation in 16 RFQ",
            "rows": [("Material", res, "Supply & install – vendor quote (RFQ)", unit, 1, 0)] + list(extra_rows),
            "note": "INCOMPLETE until quoted: no dated Pakistan price found (web search 27-Sep-2026). " + note,
            "conf": "Low"}


NEW_ITEMS = [
    _mrs_extra("CIV-CON-024", "Civil", "Concrete", "Extra-over", "Extra labour over RCC items for placing concrete in "
               "2nd and subsequent storeys, complete in all respects.", "cft", "MRS-C6-6-17",
               "Punjab MRS Ch.6 item 6(f). Covers the lift the base items (ground-floor basis) leave out.", "C03",
               "RCC — nominal mix"),
    _mrs_extra("CIV-MAS-007", "Civil", "Masonry", "Extra-over", "Extra labour over brick masonry for work in 1st floor, "
               "complete in all respects.", "cft", "MRS-C7-6-1", "Punjab MRS Ch.7 item 6(i).", "C05", "Brick masonry"),
    _mrs_extra("CIV-MAS-008", "Civil", "Masonry", "Extra-over", "Extra labour over brick masonry for work in 2nd floor, "
               "complete in all respects.", "cft", "MRS-C7-6-2", "Punjab MRS Ch.7 item 6(ii).", "C05", "Brick masonry"),
    _mrs_extra("CIV-MAS-009", "Civil", "Masonry", "Extra-over", "Extra labour over brick masonry for work in 3rd floor, "
               "complete in all respects.", "cft", "MRS-C7-6-3", "Punjab MRS Ch.7 item 6(iii).", "C05", "Brick masonry"),
    _mrs_extra("CIV-MAS-010", "Civil", "Masonry", "Extra-over", "Extra labour over brick masonry for work in 4th floor, "
               "complete in all respects.", "cft", "MRS-C7-6-4", "Punjab MRS Ch.7 item 6(iv).", "C05", "Brick masonry"),
    _mrs_extra("CIV-MAS-011", "Civil", "Masonry", "Extra-over", "Extra labour over brick masonry for each floor above "
               "the 4th floor (add per floor), complete in all respects.", "cft", "MRS-C7-6-5",
               "Punjab MRS Ch.7 item 6(v).", "C05", "Brick masonry"),
    _mrs_extra("FIN-PLS-005", "Finishes", "Plaster", "Extra-over", "Extra labour over cement plaster for work above "
               "20 ft height, for each additional 10 ft or part, complete in all respects.", "Sft", "MRS-C11-29-1",
               "Punjab MRS Ch.11 item 29.", "C06", "Internal plaster"),
    _mrs_extra("FIN-FLR-008", "Finishes", "Flooring", "Extra-over", "Extra labour over tile / stone / mosaic flooring "
               "for each storey above ground, complete in all respects.", "Sft", "MRS-C10-19-1",
               "Punjab MRS Ch.10 item 19.", "C09", "Porcelain / ceramic tiles"),
    {"code": "PLB-HDPE-110", "trade": "MEP", "sub": "Drainage", "cat": "HDPE 110 mm", "unit": "Rft", "qc": "C13",
     "qs": "Drainage", "conf": "Low",
     "desc": "Providing and fixing HDPE PN-10 pipe 110 mm with butt-fusion elbows and tees and clamps, tested, "
             "complete in all respects.",
     "spec": "Materials from Quadrangle GRNs (Plasco, 2024–2025); fitting frequency as the PPR items",
     "rows": [("Material", "GRN-QUA-HDW-000614", "HDPE pipe 110 mm", "Rft", 1, 0.05),
              ("Material", "GRN-QUA-MEP-001380", "Elbows 0.05 per Rft (ASSUMPTION)", "Nos", 0.05, 0),
              ("Material", "GRN-QUA-MEP-001381", "Tees 0.03 per Rft (ASSUMPTION)", "Nos", 0.03, 0),
              ("Material", "MAT-CLMP", "Clamps @4 ft", "Nos", 0.25, 0),
              ("Labour", "LAB-PLB", "Plumber – PR-PPR-400 crew (110 mm proxy)", "day", "PR:PR-PPR-400:S", 0),
              ("Labour", "LAB-HLP", "Helper – PR-PPR-400 crew", "day", "PR:PR-PPR-400:H", 0)],
     "note": "GRNs dated 2024–2025 (>12 months) – reconfirm. Butt-fusion machine hire not priced."},
    {"code": "FF-LV-001", "trade": "MEP", "sub": "Fire fighting", "cat": "Landing valve", "unit": "Nos", "qc": "C16",
     "qs": "Piping", "conf": "Low",
     "desc": "Supplying and installing 2½\" flanged landing valve with blank cap, connected and tested, complete in "
             "all respects.",
     "spec": "Quadrangle GRN RCP (Elite Fire & Safety), 21-Oct-2024",
     "rows": [("Material", "GRN-QUA-MEP-000939", "Landing valve 2½\" flanged", "Nos", 1, 0),
              ("Labour", "LAB-PFT", "Pipe fitter 0.5 day (as FF-HR-001, ASSUMPTION)", "day", 0.5, 0),
              ("Labour", "LAB-HLP", "Helper 0.5 day", "day", 0.5, 0)],
     "note": "GRN dated Oct-2024 (>12 months) – reconfirm. Labour as the workbook's hose-reel assumption."},
    {"code": "MISC-SGN-001", "trade": "Misc", "sub": "Signage", "cat": "3D acrylic", "unit": "Sft", "qc": "C19",
     "qs": "Other", "conf": "Low",
     "desc": "Supplying and fixing 3D acrylic-letter signage board, measured on board face area, complete in all "
             "respects.",
     "spec": "Quadrangle GRN (Latitude Advertising), 16-Jan-2023: 15 ft × 4.5 ft board = 67.5 Sft",
     "rows": [("Material", "GRN-QUA-ARC-000002", "Board 1 ÷ 67.5 Sft (supplied & fixed)", "Nos", "=1/67.5", 0)],
     "note": "GRN dated Jan-2023 (>3 years) – indicative only, re-quote."},
    _skel("PRE-GEN-003", "Prelims", "General", "Mobilization", "Mobilization and demobilization of plant, equipment, "
          "staff and temporary facilities, complete in all respects.", "Job", "MAT-MOB", "C01", "Site preparation"),
    _skel("PRE-GEN-004", "Prelims", "General", "Site establishment", "Providing, maintaining and removing site office, "
          "stores, labour welfare and security cabin, complete in all respects.", "Job", "MAT-SITEOFF", "C01",
          "Site preparation"),
    _skel("PRE-GEN-005", "Prelims", "General", "Temporary services", "Providing and running temporary water and "
          "electricity supply for construction, per month, complete in all respects.", "Month", "MAT-TEMPSVC", "C01",
          "Site preparation", note="Diesel is on GRN (DIESEL 392/Ltr, Phoenix RCP-311, 28-Aug-2026) if a genset "
          "build-up is preferred."),
    _skel("PRE-GEN-006", "Prelims", "General", "Testing", "Sampling, curing and testing concrete cylinders / cubes "
          "(set of 3) at an approved laboratory, complete in all respects.", "Nos", "MAT-CUBE", "C01",
          "Site preparation"),
    _skel("PRE-GEN-007", "Prelims", "General", "Cleaning", "Final builder's cleaning of floors, walls, glazing and "
          "fixtures before handover, complete in all respects.", "Sft", "MAT-CLEAN", "C01", "Site preparation"),
    _skel("FIN-CLG-003", "Finishes", "Ceilings", "Fire-rated", "Providing and fixing concealed-grid suspended ceiling "
          "of ½\" fire-rated gypsum board on GI frame, taped and jointed, complete in all respects.", "Sft",
          "MAT-GYP-SYSFR", "C08", "Gypsum board ceiling",
          extra_rows=[("Labour", "LAB-CLG", "Installer – PR-CLG crew", "day", "PR:PR-CLG:S", 0),
                      ("Labour", "LAB-HLP", "Helper – PR-CLG crew", "day", "PR:PR-CLG:H", 0)],
          note="Material line is material only; labour from PR-CLG (MRS-checked)."),
    _skel("FIN-CLG-004", "Finishes", "Ceilings", "Metal ceiling", "Providing and fixing aluminium clip-in / lay-in "
          "metal ceiling tiles 2'×2' on suspended grid, complete in all respects.", "Sft", "MAT-MCLG", "C08",
          "Tile / grid ceiling"),
    _skel("FIN-CLG-005", "Finishes", "Ceilings", "Access panel", "Providing and fixing 2'×2' access panel in gypsum "
          "ceiling with frame and push-latch, complete in all respects.", "Nos", "MAT-ACCP", "C08",
          "Gypsum board ceiling"),
    _skel("FIN-FLR-009", "Finishes", "Flooring", "Carpet", "Providing and laying carpet tiles on adhesive over "
          "levelled screed, complete in all respects.", "Sft", "MAT-CPT", "C09", "Porcelain / ceramic tiles"),
    _skel("FIN-WAL-003", "Finishes", "Wall finishes", "Wallpaper", "Providing and fixing vinyl wallpaper on prepared "
          "plastered walls, complete in all respects.", "Sft", "MAT-WPP", "C10", "Emulsion"),
    _skel("FIN-WAL-004", "Finishes", "Wall finishes", "Acoustic", "Providing and fixing acoustic wall panels on "
          "framing, complete in all respects.", "Sft", "MAT-ACPNL", "C10", "Emulsion"),
    _skel("FIN-DOR-003", "Finishes", "Doors", "Glass door", "Supplying and installing 12 mm toughened glass door "
          "3'×7' with patch fittings, floor spring and handle, complete in all respects.", "Nos", "MAT-GLDR", "C11",
          "Doors"),
    _skel("FAC-GRC-001", "Façade", "Cladding", "GRC", "Supplying and fixing GRC façade panels with stainless fixings, "
          "complete in all respects.", "Sft", "MAT-GRC", "C12", "Façade"),
    _skel("FAC-EIFS-001", "Façade", "Cladding", "EIFS", "Providing and applying EIFS insulated render system on "
          "external walls, complete in all respects.", "Sft", "MAT-EIFS", "C12", "Façade"),
    _skel("FAC-CNP-001", "Façade", "Canopy", "Canopy", "Supplying and installing steel-framed glass entrance canopy, "
          "measured on plan area, complete in all respects.", "Sft", "MAT-CNPY", "C12", "Façade"),
    _skel("FAC-SKY-001", "Façade", "Skylight", "Skylight", "Supplying and installing skylight glazing on aluminium "
          "frame with flashings, complete in all respects.", "Sft", "MAT-SKYL", "C12", "Façade"),
    _skel("PLB-URN-001", "MEP", "Fixtures", "Urinal", "Supplying and fixing wall-hung urinal with flush valve, trap and "
          "connections, complete in all respects.", "Nos", "MAT-URN", "C13", "Sanitary ware",
          extra_rows=[("Labour", "LAB-PLB", "Plumber – PR-WB crew (proxy)", "day", "PR:PR-WB:S", 0),
                      ("Labour", "LAB-HLP", "Helper – PR-WB crew", "day", "PR:PR-WB:H", 0)],
          note="Material line is supply only; labour from PR-WB (MAK-checked)."),
    _skel("PLB-CPVC-100", "MEP", "Water supply", "CPVC", "Providing and fixing CPVC SDR-11 pipe ¾\" with solvent-welded "
          "fittings and clamps, tested, complete in all respects.", "Rft", "MAT-CPVC-100", "C13", "Water supply",
          extra_rows=[("Labour", "LAB-PLB", "Plumber – PR-PPR-S crew (proxy)", "day", "PR:PR-PPR-S:S", 0),
                      ("Labour", "LAB-HLP", "Helper – PR-PPR-S crew", "day", "PR:PR-PPR-S:H", 0)],
          note="Material line is supply only; labour from PR-PPR-S (MAK-checked)."),
    _skel("ELV-ACS-001", "MEP", "ELV", "Access control", "Supplying, installing and commissioning access control on "
          "one door (reader, maglock, exit button, controller share, cabling), complete in all respects.", "Nos",
          "MAT-ACS", "C14", "Wiring"),
    _skel("LS-FST-001", "MEP", "Life safety", "Fire stopping", "Providing and applying fire-stop sealant / smoke seal "
          "at slab edges and service penetrations, complete in all respects.", "Rft", "MAT-FSTOP", "C16",
          "Fire alarm"),
    _skel("LFT-002", "MEP", "Lifts", "Escalator", "Supplying, installing, testing and commissioning escalator per "
          "specification, complete in all respects.", "Nos", "MAT-ESC", "C19", "Other"),
    _skel("EXT-IRR-001", "External", "Landscaping", "Irrigation", "Providing and installing drip / sprinkler irrigation "
          "system for landscaped areas, complete in all respects.", "Sft", "MAT-IRR", "C18", "Landscaping"),
    _skel("MEP-HVAC-004", "MEP", "HVAC", "VRF", "Supplying and installing VRF air-conditioning system (outdoor and "
          "indoor units, refrigerant piping, controls), per TR, complete in all respects.", "TR", "MAT-VRF", "C15",
          "Equipment"),
    _skel("ELE-MDB-001", "MEP", "Electrical", "MDB", "Supplying and installing main distribution board with incomer, "
          "outgoing breakers, metering and busbars per SLD, complete in all respects.", "Nos", "MAT-MDB", "C14",
          "Distribution"),
]

# Legacy dashboard category and QS category for the 125 workbook items, by code prefix
PREFIX_CAT = [
    ("CIV-CON", "Civil / Structural", "C03"), ("CIV-RFT", "Civil / Structural", "C04"),
    ("CIV-FWK", "Civil / Structural", "C02"), ("CIV-MAS", "Civil / Structural", "C05"),
    ("CIV-EW", "Civil / Structural", "C01"), ("PRE-", "Civil / Structural", "C01"),
    ("FIN-PLS", "Finishing", "C06"), ("FIN-SCR", "Finishing", "C06"), ("FIN-WPF", "Civil / Structural", "C07"),
    ("FIN-FLR", "Finishing", "C09"), ("FIN-SKT", "Finishing", "C09"), ("FIN-WAL", "Finishing", "C09"),
    ("FIN-CLG", "Finishing", "C08"), ("FIN-PNT", "Finishing", "C10"), ("FIN-DOR", "Finishing", "C11"),
    ("FIN-WIN", "Finishing", "C12"), ("FIN-JNR", "Finishing", "C11"), ("FAC-", "Finishing", "C12"),
    ("EXT-", "External Works", "C17"), ("PLB-", "Plumbing", "C13"), ("FF-", "Fire Fighting", "C16"),
    ("ELE-", "Electrical", "C14"), ("ELV-", "ELV", "C14"), ("LS-", "Fire Fighting", "C16"),
    ("MEP-HVAC", "HVAC", "C15"), ("LFT-", "Miscellaneous", "C19"), ("MISC-", "Miscellaneous", "C19"),
]
QS_SUB = {"C01": "Earthwork", "C02": "Formwork", "C03": "RCC — lab design mix", "C04": "Reinforcement",
          "C05": "Brick masonry", "C06": "Internal plaster", "C07": "Waterproofing", "C08": "Gypsum board ceiling",
          "C09": "Porcelain / ceramic tiles", "C10": "Emulsion", "C11": "Doors", "C12": "Façade",
          "C13": "Water supply", "C14": "Wiring", "C15": "Ductwork", "C16": "Piping", "C17": "External works",
          "C18": "Landscaping", "C19": "Other"}


def legacy_cat(code):
    for p, cat, qc in PREFIX_CAT:
        if code.startswith(p):
            return cat, qc
    return "Miscellaneous", "C19"

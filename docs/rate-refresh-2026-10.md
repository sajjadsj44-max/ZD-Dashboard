# Rate refresh — October 2026

Asked on 18-Oct-2026: bring the Rate Analysis library to current market rates (and, where no market rate
can be found, use PBS, the Punjab MRS and the GRN register, in that order), and add the rate analyses the
library is missing. The line-by-line record is in [rate-refresh-2026-10-lines.md](rate-refresh-2026-10-lines.md).

## What changed

| | Before | After |
|---|---:|---:|
| Rate lines marked ASSUMPTION (no dated source) | 270 | 142 |
| Rate lines dated more than 12 months ago, other than the Mall-35 MAK contract rates | 147 | 39 |
| Items in the library | 947 | 1,042 (95 new) |
| Items whose rate moved | | 542 |
| Punjab MRS register | Rawalpindi, 1st Bi-Annual 2026 (lapsed 30-Jun-2026), 15 chapters, 1,539 lines | **Lahore, 2nd Bi-Annual 2026 (valid to 31-Dec-2026), 21 chapters, 3,938 lines** |

236 existing lines took a new dated price: 168 from the market, 48 from the Lahore MRS, 19 from GRN and 1 from
PBS. Every one names its source and date in the form `<source>, DD-Mon-YYYY — <details>` (CLAUDE.md).

## Where the prices come from

1. **Current market (web, 18-Oct-2026).** 416 lines were researched — every ASSUMPTION line and every line
   older than 12 months except the MAK installation rates. 248 prices were found and **reviewed by hand**:
   168 accepted, 69 rejected (table below), 179 lines had no qualifying 2026 page. Accepted prices are in
   `tools/ra_refresh_market.json` with the page, the exact quote and the arithmetic. The main sources are
   makers' current lists (Popular Pipes Sep/Oct-2026, Pakistan Cables 01-Oct-2026, Berger shop), a Lahore
   cable dealer (03-Oct-2026), Lahore electrical, sanitary and IT shops, and dated Lahore rate pages.
2. **PBS** Annex-III, Sep-2026, Lahore: used for the unskilled helper (1,746.91/day, surveyed wage). The
   Punjab minimum wage, 40,000 ÷ 26 = 1,538/day, is still the floor — no FY2026-27 rate was notified by 01-Oct-2026.
3. **Punjab MRS 2nd Bi-Annual 2026, District Lahore** (Finance Department, `416_20260716141808.pdf`). An
   installed / all-in line takes the MRS composite. A supply-only line takes the **material share** —
   composite less labour, both as printed — because its labour is priced separately in the items. The
   Lahore input-rate books (labour, equipment, materials) were read for plant and a few materials; each
   figure used was checked on the PDF page itself, since the text layer of those books is misaligned.
4. **GRN register.** A GRN of the same item received within 90 days is an actual Lahore purchase at
   today's prices and is used first (ready-mix concrete, DI gate valves and Y-strainers, hose cabinets, the
   Quadrangle passenger lift). An older GRN is the last resort.

Prices that moved a lot and why:

* **Copper cables +50–150 %** — 2026 makers' lists against 2024–25 receipts. Pakistan Cables' list includes
  sales tax; a dealer sells about 30 % below it, so net prices will be lower.
* **PVC conduit, PPR and uPVC pipe +45–190 %** — Popular's 2026 consumer price list (with tax) against
  negotiated 2023–25 receipts. Part of the rise is list against net.
* **Ready-mix concrete** — 5000 psi 368.12 and 6000 psi 370.95 per Cft are what DTR and GVR paid in
  Sep-2026. National price guides quote 560–620; they were not used.
* **Plant** — mixer 5,000, vibrator 4,184, plate compactor 4,984 per day are the Lahore MRS input rates
  (hourly × 8); the vibrator was 1,500 and an ownership-cost assumption of 227 before.
* **Haulage** (EQ-TRUCK) 45 → 11.85 per Cft — MRS carriage by truck, 8 km, loading and unloading included;
  no dumping fee. CIV-EW-006 and PRE-GEN-002 drop with it; add a tipping fee where the site charges one.
* **Fabric acoustic panels** 900 → 310 per Sft, **asphalt 2"** 280 → 131 per Sft (MRS bituminous carpet),
  **PU membrane** 140 → 70 per Sft.

## What was not changed

* **463 Mall-35 MAK installation rates** (2023 agreement, 2025 final bill). They are executed contract
  rates; the MRS prints labour without contractor margin, which is a different basis, so they were kept.
  They need fresh MEP installation quotations.
* **142 ASSUMPTION lines** where no dated source exists — the civil all-in benchmarks (hoarding, shoring,
  dewatering, couplers, curtain wall, septic tank …), PICVs, motorised valves, flexible pipe connectors
  below 2", FCU, VRF, escalator, site office, mobilisation, PRV assemblies and similar specialist items. They
  stay marked ASSUMPTION so they show as Assumed until a quotation replaces them.
* The three lines at 0 (glass spigot, SS baluster, laminate underlay) are included in other composite lines
  by design.

## Missing rate analyses added (95 items)

Work found in the 2025–26 project BOQs (`D:\Estimation Folder`: Vault, Hive, Jade, GVR, ARX batching plant,
Phoenix, Quadrangle, Taif, renovations, NEO roof) with no item in the library. 94 are the Lahore MRS composite
for the same work as one line, with the library's 8 % overhead and 10 % profit; one is a build-up:

* **Piling** — bored cast-in-situ piles 18"–72" (4000 psi) and 24", 36" (3000 psi); Grade-60 pile cage per kg.
  The MRS pile rate excludes reinforcement, concrete pump and admixture.
* **Tube well** — boring 6"–12" (0–100 ft, 101–200 ft), rotary drilling 15"–18", PVC strainer and blind pipe
  6"–10", MS housing pipe 8"/10", pea-gravel shrouding, testing and developing per hour.
* **External works** — RCC sewer 9"–24", crushed-stone sub-base and base course, prime and tack coat,
  W-beam guard rail, speed breaker, chain-link fence, LED street light and pole.
* **Roofing and plant rooms** — CGI sheet 22/24 BWG, ridging, gutter, down pipe, XPS insulation, sandwich
  panels, car-parking shed.
* **Steel and aluminium** — steel and box-section windows, iron, GI and louvered doors, collapsible gate,
  rolling shutter, spiral stair, double-glazed windows, aluminium door and partition, fly screen,
  automatic sliding door.
* **Joinery and ceilings** — solid-core laminated, commercial-ply and veneer flush doors, WPC door, door
  closer, floor hinge, lever lock, UV-MDF wardrobe, laminated kitchen cabinet, roller and zebra blinds,
  gypsum tile ceiling, MDF ceiling, access panel.
* **Electrical** — ACB 800 A, ATS panel, PFI plant 62.5 kVAr, busway 400 A.
* **Basements and interiors** — PVC water stopper 10" (6 mm, 10 mm), Corian counters ½" and ¾", WPC and PVC
  wall panelling, 6 mm mirror with edging, SS floor trap, POP and PVC mouldings, wood-look porcelain plank tile
  6"x36", and a 24" SS linear shower drain (market price of the drain + MRS floor-trap fixing labour).

Not added for want of any dated source: PVC rear guard (external waterstop), 12" water stopper, shotcrete,
broadloom carpet, crystalline slurry. A framed mirror (mirror + MS box frame + powder coating) is best built
per design from the 6 mm mirror item, MS box pipe and powder coating.

## Market prices found but not used (69)

| Code | Price found | Why it was not used |
|---|---:|---|
| BM-CV-078 | 227.58 | the figure adds a labour allowance the page does not print |
| BM-CV-096 | 15,000.00 | vanity without its counter top |
| BM-CV-098 | 1,150.00 | shop-front glazing, not a curtain-wall system |
| BM-CV-106 | 300.00 | floor epoxy coating; the line is wall / steel paint |
| BM-CV-111 | 127.00 | generic 'false ceiling' figure, ceiling type not stated |
| BM-CV-124 | 59,000.00 | the guide's own material list gives about double its tank price |
| BM-CV-125 | 30,000.00 | shallow pit from the same inconsistent guide |
| COND-PVC | 43.00 | pipe only; the line includes accessories |
| CTRAY | 960.12 | size assumed and supports excluded |
| DOOR-W | 408.16 | hollow commercial-ply leaf; the line is an approved solid flush shutter |
| GRN-QUA-ELE-000541 | 4,400.00 | bare isolator; the line is an isolator box for shops |
| GRN-QUA-MEP-000301 | 9,500.00 | price not shown on the page (embedded data only) |
| GRN-QUA-MEP-000643 | 2,675.00 | midpoint of a range covering all tray widths |
| GRN-QUA-MEP-001123 | 19.00 | Karachi sale price |
| GRN-QUA-MEP-001125 | 88.00 | Karachi sale price |
| GRN-QUA-MEP-001278 | 325.00 | midpoint of a range covering all tray widths |
| GRN-QUA-MEP-001282 | 5,075.00 | midpoint of a range covering all tray widths |
| GRN-QUA-MEP-001294 | 1,300.00 | price unit uncertain |
| GRN-QUA-MEP-001295 | 972.00 | price unit uncertain |
| GRN-QUA-MEP-001296 | 656.50 | price unit uncertain |
| GRN-QUA-MEP-001297 | 475.00 | price unit uncertain |
| GRN-QUA-MEP-001298 | 403.00 | price unit uncertain |
| GRN-QUA-MEP-001372 | 113,700.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001670 | 10,800.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001757 | 28,960.00 | not UL-listed, bolts excluded (fire-fighting valve) |
| GRN-QUA-MEP-001793 | 6,300.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001815 | 212,500.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001816 | 113,700.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001817 | 77,500.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-001913 | 19,100.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-002029 | 160,000.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-002030 | 82,000.00 | premium Japanese brand (KITZ) |
| GRN-QUA-MEP-002147 | 492.13 | plain channel; the line is a track meter |
| GRN-QUA-MEP-002185 | 18,500.00 | price not shown on the page (embedded data only) |
| L-HELPER | 1,538.46 | statutory minimum wage, not a market wage — PBS Lahore survey used |
| MAT-ACP | 435.00 | local ACP, coating not stated; the line is PVDF |
| MAT-BSP-200 | 656.50 | price unit uncertain |
| MAT-HRC | 62,000.00 | inlet valve not included |
| MAT-LIFT | 5,250,000.00 | range of 25–80 lakh, not a price |
| MEP-Z-BULK | 3,430.00 | flood light, not a bulkhead |
| MEP-Z-DCOCK | 2,500.00 | a ball valve, not a drain cock |
| MEP-Z-GI1 | 353.21 | pipe only; the line includes fittings |
| MEP-Z-GI2 | 737.87 | pipe only; the line includes fittings |
| MEP-Z-GV075 | 4,850.00 | premium Japanese brand (KITZ) |
| MEP-Z-GV10 | 540,000.00 | premium Japanese brand (KITZ) |
| MEP-Z-GV125 | 9,300.00 | premium Japanese brand (KITZ) |
| MEP-Z-GV8 | 333,000.00 | premium Japanese brand (KITZ) |
| MEP-Z-IPS32 | 17,100.00 | two sources differ 4.5x |
| MEP-Z-MS075 | 225.00 | price unit uncertain (per length shown as per foot); list looks unrepriced since 2024 |
| MEP-Z-MS10 | 11,476.50 | price unit uncertain |
| MEP-Z-MS12 | 14,600.00 | price unit uncertain |
| MEP-Z-MS8 | 6,300.00 | price unit uncertain |
| MEP-Z-PRV32 | 22,420.00 | valve body only; the line is a PRV assembly |
| MEP-Z-PRV50 | 36,850.00 | valve body only; the line is a PRV assembly |
| MEP-Z-PRV63 | 455,000.00 | premium Japanese brand (Yoshitake) |
| MEP-Z-YS075 | 8,950.00 | premium Japanese brand (KITZ) |
| MEP-Z-YS100 | 10,400.00 | premium Japanese brand (KITZ) |
| MEP-Z-YS125 | 13,400.00 | premium Japanese brand (KITZ) |
| MEP-Z-YS150 | 19,800.00 | premium Japanese brand (KITZ) |
| MEP-Z-YS200 | 25,800.00 | premium Japanese brand (KITZ) |
| PPRC | 145.39 | pipe only; the line includes fittings |
| RMC-3000 | 417.67 | national guide; above what Lahore sites paid for 4000 psi in Sep-2026 |
| RMC-3500 | 467.23 | national guide; above Lahore GRNs |
| RMC-5000 | 566.34 | national guide; Lahore GRN of 23-Sep-2026 used instead |
| RMC-6000 | 622.97 | national guide; Lahore GRN of 21-Sep-2026 used instead |
| RMC-LEAN | 368.12 | national guide; Lahore GRN used instead |
| SAN-WB | 14,999.00 | basin and pedestal only; the line includes fittings |
| TOPSOIL | 8.25 | source price of good earth, no carriage |
| UPVC-D | 507.00 | pipe only; the line includes fittings |

## How to re-run

```
python3 -m http.server 8765 &                                         # from the repo root
node tools/ra_library_dump.js base.json --without raRefreshData       # the library as published before the block
python3 tools/ra_refresh_data.py --baseline base.json --report docs/rate-refresh-2026-10-lines.md
python3 -m unittest tools/test_ra_refresh_data.py && node tools/test_ra_refresh.js
```

The page merges the block after all other blocks (`raSyncBlk(e,raBlk("raRefreshData"),"refRev")`). A line
still at the value it had before the refresh takes the new one; a rate typed by hand is kept. To change a
market price, edit `tools/ra_refresh_market.json` (keep the page, quote and arithmetic) and re-run.

The MRS register now loads chapters 2–13, 18–21 and 23–27 (`tools/mrs_register.py`). The 2nd Bi-Annual
2026 renumbered six items the civil block uses; `MRS_MOVED` in `tools/civil_gap_data.py` keeps their codes
and reads them at the new numbers. Ch.27 (HVAC) prints its header over three lines; the loader now reads it.

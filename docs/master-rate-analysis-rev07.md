# Master Rate Analysis Rev07 — revision and validation report (27-Sep-2026)

Source reviewed: `RA_Master_Pakistan_FINAL_Rev06_2026-09-27.xlsx` (16 sheets, 125 rate analyses, 699 resource
rows, 176 materials, 17 labour and 13 plant lines, 23 productivity rows). Output:
[`RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx`](RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx) (19 sheets, 160
analyses) and the dashboard block `#raMasterData` (Rate Analysis → Item Library, same codes).

## How it was done

1. **Every block of sheet 04 was parsed** (component, resource, consumption formula, rate, wastage, amount) and
   re-computed; every 03 row was checked against its 04 block, and every resource against 05/06/07 and 09.
2. **One rate per shared resource.** 36 workbook resources are the same resource as a dashboard Rate Database
   line (cement, sands, crush, steel, blocks, bricks, ready-mix, labour trades …). Where the two disagreed, the
   rule in `CLAUDE.md` decided: the most recent dated Lahore rate wins (GRN or quotation over a web band). The
   workbook's Lahore inputs were changed for 11 lines; the dashboard moved one line (`QE-TIMB-CFT`, an undated
   3,000 assumption → the workbook's Phoenix GRN 3,680). The build stops if a shared rate ever differs.
3. **Crew productivity checked against dated benchmarks**, never invented:
   * Punjab MRS 1st Bi-Annual 2026 (Rawalpindi), 01-Jan-2026 — the labour-only share printed beside each composite
     rate (already in the dashboard's MRS register);
   * MAK Contractors' Mall-35 installation rates (25-Sep-2023 / 31-May-2025), divided by 1.18 to strip the same
     8% OH + 10% profit the library adds back;
   * ConcretesMath Lahore piece rates, 23-May-2026 (SRC-06) for plaster, tiling and painting.

   A crew output is kept when its labour cost per unit is within ±35% of the benchmark; otherwise it is reset to
   *crew-day cost ÷ benchmark labour per unit* and rounded. Rows with no dated benchmark (formwork, blockwork,
   cementitious waterproofing) are kept and marked **ASSUMPTION — confirm by site time study**. Sheet 13 now shows,
   for every code, the crew, output per skilled worker and per crew member, crew-day cost, labour per unit, the
   benchmark, the output it implies, the Rev06 deviation and the status.
4. **Missing items.** Part A of sheet 17 lists all 125 workbook items (none were in the dashboard under their code)
   with the closest dashboard item and its rate; Part B lists the 31 trade-scope items found in neither library
   (keyword sweep of all 787 dashboard items and 125 workbook items against the trade list in sheet 12). All of
   them are now analyses in 04 and items in the dashboard.
5. **Dashboard.** All 160 analyses were added with their workbook code, description, unit, resource rows (adjusted
   quantity = consumption × (1 + wastage), so item wastage is 0) and 8% / 10% OH / profit. Every row stays editable
   and re-prices from the shared Rate Database line. Errors found in existing dashboard analyses with a dated
   benchmark were corrected (below); others are listed for review, not overwritten.

## Errors found in Rev06 (corrected)

| # | Item(s) | Finding | Rev07 |
|---|---|---|---|
| 1 | 11 lab-mix / nominal concretes, 23 items using cement | Cement 1,415 (GRN 06-May-2026) while the dashboard and the 04-Sep-2026 market show 1,575 | 1,575 |
| 2 | 5 lab mixes on Lawrencepur sand | Sand 190 from a national band; Lahore rate 240 (04-Sep-2026) | 240 |
| 3 | 11 items on Margalla crush | Margalla 145 was below the user's own Sargodha quote (185) although it hauls further | 180 |
| 4 | CIV-MAS-004 / -005 | Blocks 110 (ex-factory national) and 103 (GRN Oct-2025) vs Lahore quotation 165 / 140 (05-Sep-2026) | quotation |
| 5 | EXT-RD-001 | Sub-base 120 (GRN Apr-2025, >12 months) | 100 (24-Sep-2026) |
| 6 | Plaster, tiling, painting | Trades priced at the mason band (2,200) with no trade source | 2,150 / 2,500 / 2,100 (dated) |
| 7 | CIV-MAS-001 / -006 | 80 cft/day per mason + 1.5 helpers (≈1,080 bricks): 38% below MRS labour | 50 / 55 cft/day |
| 8 | CIV-RFT-001 / -002 | 250 kg/day: 45% above MRS labour | 360 kg/day |
| 9 | PCC items (6) | 150 cft/day: 46% below MRS labour for site-mixed plain concrete | 80 cft/day |
| 10 | CIV-CON-020…023 | Pumped ready-mix placed with the site-mix crew (145/cft, +55% vs MRS 9(c)) | new PR-RMC 155 cft/day |
| 11 | FIN-SCR-001…004 | One output (250 Sft/day) for 1"–3" screed, 53–73% below MRS topping labour | PR-SCR1/SCR/SCR2/SCR3 by thickness |
| 12 | FIN-PLS-002 / -003 / -004 | ¾" and ceiling plaster at the ½" wall output | PR-PLS75 80, PR-PLSC 90 Sft/day |
| 13 | FIN-WPF-001 / -003, FIN-PNT-002 | Torch-on 400, DPC 200, weather-shield 200 Sft/day: 37–65% below MRS | 180 / 125 / 70 |
| 14 | CIV-EW-004 / -005 | Backfill / sand filling 200 cft/day for 2 helpers: 89–127% above MRS | 375 / 450 cft/day |
| 15 | PPR, uPVC, MS fire pipe, sprinklers, WC, basin, duct insulation | 40–81% below MAK installation rates | MAK-based outputs (sheet 13) |
| 16 | 33 blocks | Labour rows typed as `=1/80`, `0.5` … could not be edited from one place | re-linked to sheet 13 codes |

Found and **flagged, not changed** (need a quotation or a decision):

* CIV-CON-021 (4500 psi RMC 331.31) is cheaper than CIV-CON-020 (4000 psi 337.25): two suppliers' GRNs.
* EXT-KRB-001 bedding rows are 0 — the MRS kerb material rate already includes the 1:4:8 bed; keep them at 0.
* CIV-MAS-001 uses the traditional 13.5 bricks per cft (≈1,350 per 100 cft); the dashboard generator derives
  12.1 per cft from 9"×4½"×3" + ¼" joints. Both conventions are stated; confirm the brick size on site.
* PLB-PPR-075 fittings, FF fittings allowance, clamps (2024 GRN), black-steel pipe (2024 GRN), DB (2023 GRN),
  admixture (2024 GRN), cementitious coating (2024 GRN): priced but old, shown as `OLD RATE`.
* Steel: the GRN 242/kg (30-Aug-2026) is kept; web lists of Sep-2026 quote 260–268/kg for branded G-60 — get a
  current mill quote before tender.
* Formwork: workbook 26–39/Sft labour, dashboard FW-3xx 71–97/Sft — neither has a dated source (props hire is also
  blank). This is the largest open productivity question.

## Dashboard changes

* **+160 items** (`CIV-*`, `FIN-*`, `PRE-*`, `EXT-*`, `PLB-*`, `FF-*`, `ELE-*`, `ELV-*`, `LS-*`, `MEP-HVAC-*`, `LFT-*`,
  `MISC-*`, `FAC-*`), each with its QS category, so the category / sub-category filters and search find them.
* **+196 Rate Database lines** carrying the workbook codes, rates, dates and sources (`<source>, DD-Mon-YYYY — …`;
  no-source lines at 0 marked `ASSUMPTION — no dated source`).
* **ST-200 / ST-205 / ST-210** rebar labour 36.80 → 11.08 per kg (MRS 11.03).
* **Brick generator (BRK-45/9/135-*)**: labour was the same 92.79 per Sft for 4½", 9" and 13½" walls; now
  proportional to thickness at 50 cft per mason-day (MRS 90.57/cft): 33.80 / 67.60 / 101.41 per Sft.
* **Plaster generator (PLS-*)**: labour was 49.48/Sft for every thickness (60.55 external); now 36.88 for ⅜"–½"
  and 46.10 for ¾"–1" (MRS 36.20 / 45.54), cradle kept as its own plant line for external plaster.
* **QE-TIMB-CFT** 3,000 (undated) → 3,680 (Phoenix GRN RCP-277, 10-Jun-2026).
* Saved libraries are upgraded on their next load (`raSyncBlk`, key `masRev`, plus `raSyncMaster` for the
  generators): missing items and lines are added; a line or item still at its published value is moved;
  anything edited by hand, any typed rate and every user-added item is left alone.

### Rates reconciled (workbook Lahore inputs)

| Resource | Dashboard line | Rev06 | Rev07 | Basis |
|---|---|---:|---:|---|
| MAT-CEM-OPC | CEM | 1,415 | 1,575 | 1,415 (Phoenix GRN RCP-266, 06-May-2026, >4 months) -> 1,575 Lahore market 05-Sep-2026 (band 1,520–1,605; web 04-Sep-2026 1,500–1,610). Same as dashboard CEM. |
| MAT-SND-LWP | SAND-LP | 190 | 240 | 190 (SRC-03 national north band, Jul-2026) -> 240 Lahore market rate supplied by Sajjad 04-Sep-2026. Same as dashboard SAND-LP. |
| MAT-CRS-SGD | CRSH-SG | 190 | 185 | 190 (Quadrangle GRN RCP-2607, Jul-2025, >12 months) -> 185 Lahore market 04-Sep-2026. Same as dashboard CRSH-SG. |
| MAT-CRS-MGL | CRSH-MG | 145 | 180 | 145 -> 180. Rev06 midpoint was below the 04-Sep-2026 Sargodha quote (185) although Margalla hauls further; 180 = dashboard CRSH-MG (web, Jul-2026). Get a delivered quote. |
| MAT-BRK-A | BRK-1 | 18 | 17.5 | 18 -> 17.5 (Rs 16,000–19,000 per 1,000, Sep-2026). Same as dashboard BRK-1. |
| MAT-BLK-6H | BLK-H6 | 110 | 165 | 110 (national ex-factory midpoint, Jun-2026) -> 165 Zarea Lahore quotation 05-Sep-2026. Same as dashboard BLK-H6. |
| MAT-BLK-4S | BLK-S4 | 103 | 140 | 103 (Phoenix GRN RCP-213, Oct-2025, >11 months) -> 140 Zarea Lahore quotation 05-Sep-2026. Same as dashboard BLK-S4. |
| MAT-SUBB | GRAVEL-SB | 120 | 100 | 120 (Phoenix GRN RCP-149, 30-Apr-2025, >12 months) -> 100 (Rs 95–105, 24-Sep-2026). Same as dashboard GRAVEL-SB. |
| LAB-PLS | L-PLMASON | 2,200 | 2,150 | 2,200 (mason band, no trade source) -> 2,150 ConcretesMath Lahore plaster mason (range 1,900–2,400). Same as dashboard L-PLMASON. |
| LAB-TIL | L-TILE | 2,200 | 2,500 | 2,200 (mason band) -> 2,500 ConcretesMath Lahore tile/marble fixer (2,200–2,800). Same as dashboard L-TILE. |
| LAB-PNT | L-PAINT | 2,200 | 2,100 | 2,200 (mason band) -> 2,100 Lahore painters 1,800–2,500 (web 23-Sep-2026). Same as dashboard L-PAINT. |

### Crew productivity (sheet 13)

| Code | Activity | Crew | Rev06 output/day | Rev07 output/day | Labour/unit Rev07 | Benchmark | Status |
|---|---|---|---:|---:|---:|---|---|
| PR-RCC | RCC placing & compacting – site-batched (mixer) | 1 + 8 helper | 100 cft | 100 cft | 145.04 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.6 item 5 labour share 140.26/cft (plain concrete placed, compacted, cured, site-mixed) (140.26) | Kept – within ±35% of benchmark |
| PR-PCC | PCC / lean concrete placing – site-batched | 1 + 6 helper | 150 cft | 80 cft | 142.85 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.6 item 5(i) 1:4:8 labour share 140.26/cft (140.26) | Corrected to benchmark |
| PR-RFT | Rebar cut, bend & fix | 1 + 1 helper | 250 kg | 360 kg | 11.08 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.6 item 12(b)(ii) Grade-60 labour share 11.03/kg (cut, bend, place, bind) (11.03) | Corrected to benchmark |
| PR-BRK | Brick masonry 9" and above – ground floor | 1 + 1.5 helper | 80 cft | 50 cft | 90.14 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.7 item 5(i) labour share 90.57/cft (1:6, ground floor) (90.57) | Corrected to benchmark |
| PR-PLS | Cement plaster ⅜"–½" – walls | 1 + 1 helper | 100 Sft | 100 Sft | 36.88 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.11 item 9(b) ½" 1:4 labour share 36.20/Sft; SRC-06 Lahore piece rate 28–38/Sft (36.20) | Kept – within ±35% of benchmark |
| PR-FWS | Formwork – slab soffit (fix + strip) | 1 + 1 helper | 150 Sft | 150 Sft | 26.25 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-FWB | Formwork – beam sides & soffit | 1 + 1 helper | 100 Sft | 100 Sft | 39.38 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-FWC | Formwork – columns | 1 + 1 helper | 120 Sft | 120 Sft | 32.82 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-FWW | Formwork – walls / shear walls / lift core | 1 + 1 helper | 130 Sft | 130 Sft | 30.29 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-BLK8 | Block masonry 8" | 1 + 1 helper | 100 Sft | 100 Sft | 37.38 | No dated benchmark (MRS has no block item) | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-BLK6 | Block masonry 6" | 1 + 1 helper | 120 Sft | 120 Sft | 31.15 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-BLK4 | Block masonry 4" | 1 + 1 helper | 150 Sft | 150 Sft | 24.92 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-BRK45 | Brick masonry 4½" | 1 + 1 helper | 120 Sft | 120 Sft | 31.15 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.7 item 5 90.57/cft × 0.375 ft = 33.96/Sft (33.96) | Kept – within ±35% of benchmark |
| PR-SCR | Floor/roof screed 1½" | 1 + 2 helper | 250 Sft | 95 Sft | 55.54 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.10 item 16(c) 1½" floor topping labour share 56.39/Sft (56.39) | Corrected to benchmark |
| PR-WPM | Torch-on membrane incl. primer | 1 + 1 helper | 400 Sft | 180 Sft | 20.77 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.9 item 46(a)(ii) 4 mm torch-on labour share 20.45/Sft (20.45) | Corrected to benchmark |
| PR-WPC | Cementitious waterproofing 2 coats | 1 + 1 helper | 300 Sft | 300 Sft | 12.46 | No dated benchmark | ASSUMPTION – no dated benchmark, confirm by site time study |
| PR-DPC | DPC 1.5" concrete + bitumen coats | 1 + 2 helper | 200 Sft | 125 Sft | 42.21 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.6 item 37(b)(i) labour share 41.94/Sft (41.94) | Corrected to benchmark |
| PR-TLF | Floor tiling on adhesive | 1 + 1 helper | 120 Sft | 120 Sft | 33.65 | SRC-06 ConcretesMath Lahore tiling piece rate 30–55/Sft (23-May-2026); MRS Ch.10 item 23/36 prints 80.35/Sft (government schedule, on 1:2 mortar bed) (42.50) | Kept – within ±35% of benchmark |
| PR-TLW | Wall tiling on adhesive | 1 + 1 helper | 100 Sft | 100 Sft | 40.38 | SRC-06 30–55/Sft (as PR-TLF) (42.50) | Kept – within ±35% of benchmark |
| PR-MBL | Marble flooring in mortar bed | 1 + 1 helper | 80 Sft | 80 Sft | 50.48 | SRC-06 30–55/Sft (tiling band) (42.50) | Kept – within ±35% of benchmark |
| PR-CLG | Gypsum ceiling – frame, board, tape & joint | 2 + 1 helper | 150 Sft | 150 Sft | 39.59 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.9 item 49(ii) labour share 45.20/Sft (45.20) | Kept – within ±35% of benchmark |
| PR-PNT | Internal paint system (primer + 2 putty + 2 finish) | 1 + 0.5 helper | 150 Sft | 150 Sft | 19.13 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.13 items 31(a)+31(b) emulsion 7.94 + 6.09 + 2 × item 46 putty 3.74 = 21.51/Sft; SRC-06 painting 12–22/Sft (21.51) | Kept – within ±35% of benchmark |
| PR-PNX | External weather-shield system (primer + 2 finish) | 1 + 0.5 helper | 200 Sft | 70 Sft | 40.99 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.13 item 33(a) new surface 1st coat 26.80 + 2nd coat 14.72 = 41.52/Sft (incl. primer, prep) (41.52) | Corrected to benchmark |
| PR-RMC | Ready-mix concrete – pumped placing, compacting & curing | 1 + 8 helper | 100 cft | 155 cft | 93.57 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.6 item 9(c) plant-batched RCC placing labour share 93.70/cft (93.70) | Corrected to benchmark |
| PR-BRKF | Brick masonry in foundation & plinth | 1 + 1.5 helper | 80 cft | 55 cft | 81.95 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.7 item 4(i) foundation 1:6 labour share 80.28/cft (80.28) | Aligned to benchmark (Rev06 was within ±35%) |
| PR-PLS75 | Cement plaster ¾" – walls (int./ext.) | 1 + 1 helper | 100 Sft | 80 Sft | 46.10 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.11 item 9(c) ¾" labour share 45.54/Sft (45.54) | Aligned to benchmark (Rev06 was within ±35%) |
| PR-PLSC | Cement plaster ⅜" – ceilings / soffits | 1 + 1 helper | 100 Sft | 90 Sft | 40.98 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.11 item 12 soffit ⅜" labour share 41.48/Sft (41.48) | Aligned to benchmark (Rev06 was within ±35%) |
| PR-SCR1 | Floor screed 1" | 1 + 2 helper | 250 Sft | 115 Sft | 45.88 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.10 item 16(a) 1" topping 45.21/Sft (45.21) | Corrected to benchmark |
| PR-SCR2 | Floor screed 2" | 1 + 2 helper | 250 Sft | 80 Sft | 65.95 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.10 item 16(e) 2" topping 67.57/Sft (67.57) | Corrected to benchmark |
| PR-SCR3 | Floor screed 3" | 1 + 2 helper | 250 Sft | 65 Sft | 81.17 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.10 item 16(i) 3" topping 78.75/Sft (78.75) | Corrected to benchmark |
| PR-BKF | Backfilling in 6" layers, watered (plate compactor separate) | 0 + 2 helper | 200 cft | 375 cft | 8.20 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.3 item 15(i) filling, watering and ramming earth under floors 8.16/cft (8.15) | Corrected to benchmark |
| PR-SNF | Sand filling under floors in 6" layers | 0 + 2 helper | 200 cft | 450 cft | 6.84 | Punjab MRS 1st BA-2026 (Rawalpindi), 01-Jan-2026 Ch.10 item 3 supplying and filling sand under floor labour share 6.77/cft (6.77) | Corrected to benchmark |
| PR-PPR-S | PPR pipe ½"–1" with fittings, clamps, testing | 1 + 1 helper | 80 Rft | 45 Rft | 91.96 | MAK Mall-35 install rate, 25-Sep-2023 MP-201A PPR 25 mm 105.49/Rft ÷ 1.18 (89.40) | Corrected to benchmark |
| PR-PPR-M | PPR pipe 1¼"–2" | 1 + 1 helper | 50 Rft | 35 Rft | 118.23 | MAK Mall-35 install rate, 25-Sep-2023 MP-201D PPR 50 mm 141.86/Rft ÷ 1.18 (120.22) | Aligned to benchmark (Rev06 was within ±35%) |
| PR-PPR-250 | PPR pipe 2½" | 1 + 1 helper | 50 Rft | 25 Rft | 165.52 | MAK Mall-35 install rate, 25-Sep-2023 MP-201F PPR 75 mm 189.15/Rft ÷ 1.18 (160.30) | Corrected to benchmark |
| PR-PPR-300 | PPR pipe 3" | 1 + 1 helper | 50 Rft | 20 Rft | 206.90 | MAK Mall-35 install rate, 25-Sep-2023 MP-201G PPR 90 mm 238.09/Rft ÷ 1.18 (201.77) | Corrected to benchmark |
| PR-PPR-400 | PPR / HDPE pipe 4" (110 mm) | 1 + 1 helper | 50 Rft | 17 Rft | 243.41 | MAK Mall-35 install rate, 25-Sep-2023 MP-201H PPR 110 mm 291.00/Rft ÷ 1.18 (246.61) | Corrected to benchmark |
| PR-SWV2 | uPVC SWV pipe 2" | 1 + 1 helper | 60 Rft | 35 Rft | 118.23 | MAK Mall-35 install rate, 25-Sep-2023 MP-301A uPVC 2" 134.59/Rft ÷ 1.18 (114.06) | Corrected to benchmark |
| PR-SWV3 | uPVC SWV pipe 3" | 1 + 1 helper | 60 Rft | 16 Rft | 258.62 | MAK Mall-35 install rate, 25-Sep-2023 MP-301B uPVC 3" 301.91/Rft ÷ 1.18 (255.86) | Corrected to benchmark |
| PR-SWV4 | uPVC SWV pipe 4" | 1 + 1 helper | 60 Rft | 15 Rft | 275.87 | MAK Mall-35 install rate, 25-Sep-2023 MP-301C uPVC 4" 327.38/Rft ÷ 1.18 (277.44) | Corrected to benchmark |
| PR-FFP1 | MS Sch-40 fire pipe 1" | 1 + 1 helper | 40 Rft | 23 Rft | 179.91 | MAK Mall-35 install rate, 25-Sep-2023 MF-401A MS 1" 210.98/Rft ÷ 1.18 (178.79) | Corrected to benchmark |
| PR-FFP2 | MS Sch-40 fire pipe 2" | 1 + 1 helper | 40 Rft | 14 Rft | 295.57 | MAK Mall-35 install rate, 25-Sep-2023 MF-401D MS 2" 349.20/Rft ÷ 1.18 (295.93) | Corrected to benchmark |
| PR-FFP4 | MS Sch-40 fire pipe 4" grooved | 1 + 1 helper | 40 Rft | 7.5 Rft | 551.73 | MAK Mall-35 install rate, 25-Sep-2023 MF-401G MS 4" 647.48/Rft ÷ 1.18 (548.71) | Corrected to benchmark |
| PR-SPK | Sprinkler head with drop | 1 + 1 helper | 10 Nos | 5.8 Nos | 713.45 | MAK Mall-35 install rate, 25-Sep-2023 MF-404A sprinkler 836.63 ÷ 1.18 (709.00) | Corrected to benchmark |
| PR-WC | WC suite fixing & connection | 1 + 1 helper | 2 Nos | 0.83 Nos | 4,985.54 | MAK Mall-35 install rate, 25-Sep-2023 MP-101 European WC with fittings 5,856.38 ÷ 1.18 (4,963.03) | Corrected to benchmark |
| PR-WB | Wash basin fixing & connection | 1 + 1 helper | 2 Nos | 0.9 Nos | 4,597.78 | MAK Mall-35 install rate, 25-Sep-2023 MP-104 pedestal basin 5,438 ÷ 1.18 (4,608.47) | Corrected to benchmark |
| PR-DINS | Duct insulation 1" | 1 + 1 helper | 150 Sft | 74 Sft | 58.62 | MAK Mall-35 install rate, 25-Sep-2023 MN-H10 1" duct insulation 69.00/Sft ÷ 1.18 (58.47) | Corrected to benchmark |
| PR-DUCT | GI ductwork fabricate & install | 1 + 1 helper | 50 Sft | 50 Sft | 86.76 | MAK Mall-35 install rate, 25-Sep-2023 MH-301 GI ductwork 95.74/Sft ÷ 1.18 (81.13) | Kept – within ±35% of benchmark |

### Final rates that moved (Rev06 → Rev07, rounded PKR incl. 8% OH + 10% profit)

| Item | Unit | Rev06 | Rev07 | Change | Labour/unit Rev06 → Rev07 |
|---|---|---:|---:|---:|---|
| CIV-CON-001 | cft | 1,051 | 1,132 | +7.7% | 145.04 → 145.04 |
| CIV-CON-002 | cft | 577 | 743 | +28.8% | 76.19 → 142.85 |
| CIV-CON-003 | cft | 986 | 1,100 | +11.6% | 145.04 → 145.04 |
| CIV-CON-004 | cft | 498 | 636 | +27.7% | 76.19 → 142.85 |
| CIV-CON-005 | cft | 924 | 1,031 | +11.6% | 145.04 → 145.04 |
| CIV-CON-006 | cft | 901 | 1,007 | +11.8% | 145.04 → 145.04 |
| CIV-CON-007 | cft | 569 | 736 | +29.3% | 76.19 → 142.85 |
| CIV-CON-008 | cft | 826 | 926 | +12.1% | 145.04 → 145.04 |
| CIV-CON-009 | cft | 868 | 973 | +12.1% | 145.04 → 145.04 |
| CIV-CON-010 | cft | 978 | 1,091 | +11.6% | 145.04 → 145.04 |
| CIV-CON-011 | cft | 784 | 880 | +12.2% | 145.04 → 145.04 |
| CIV-CON-012 | cft | 882 | 985 | +11.7% | 145.04 → 145.04 |
| CIV-CON-013 | cft | 923 | 1,030 | +11.6% | 145.04 → 145.04 |
| CIV-CON-014 | cft | 968 | 1,078 | +11.4% | 145.04 → 145.04 |
| CIV-CON-015 | cft | 982 | 1,093 | +11.3% | 145.04 → 145.04 |
| CIV-CON-016 | cft | 472 | 612 | +29.7% | 76.19 → 142.85 |
| CIV-CON-017 | cft | 679 | 751 | +10.6% | 145.04 → 145.04 |
| CIV-CON-018 | cft | 752 | 832 | +10.6% | 145.04 → 145.04 |
| CIV-CON-019 | cft | 515 | 657 | +27.6% | 76.19 → 142.85 |
| CIV-CON-020 | cft | 613 | 551 | -10.1% | 145.04 → 93.57 |
| CIV-CON-021 | cft | 606 | 544 | -10.2% | 145.04 → 93.57 |
| CIV-CON-022 | cft | 722 | 660 | -8.6% | 145.04 → 93.57 |
| CIV-CON-023 | cft | 450 | 471 | +4.7% | 76.19 → 93.57 |
| CIV-EW-004 | cft | 21 | 13 | -38.1% | 15.38 → 8.20 |
| CIV-EW-005 | cft | 95 | 85 | -10.5% | 15.38 → 6.84 |
| CIV-MAS-001 | cft | 458 | 497 | +8.5% | 56.34 → 90.14 |
| CIV-MAS-003 | Sft | 333 | 335 | +0.6% | 37.38 → 37.38 |
| CIV-MAS-004 | Sft | 192 | 264 | +37.5% | 31.15 → 31.15 |
| CIV-MAS-005 | Sft | 216 | 280 | +29.6% | 24.92 → 24.92 |
| CIV-MAS-006 | cft | 482 | 514 | +6.6% | 56.34 → 81.95 |
| CIV-RFT-001 | kg | 317 | 311 | -1.9% | 15.95 → 11.08 |
| CIV-RFT-002 | ton | 317,021 | 311,270 | -1.8% | 15,952.00 → 11,077.78 |
| EXT-DRN-001 | Nos | 54,989 | 55,911 | +1.7% | 15,828.00 → 15,828.00 |
| EXT-RD-001 | cft | 182 | 153 | -15.9% | 1.54 → 1.54 |
| FF-PIP-100 | Rft | 541 | 631 | +16.6% | 103.45 → 179.91 |
| FF-PIP-200 | Rft | 965 | 1,192 | +23.5% | 103.45 → 295.57 |
| FF-PIP-400 | Rft | 2,485 | 3,014 | +21.3% | 103.45 → 551.73 |
| FF-SPL-001 | Nos | 3,868 | 4,221 | +9.1% | 413.80 → 713.45 |
| FIN-FLR-001 | Sft | 321 | 324 | +0.9% | 31.15 → 33.65 |
| FIN-FLR-002 | Sft | 215 | 218 | +1.4% | 31.15 → 33.65 |
| FIN-FLR-003 | Sft | 528 | 537 | +1.7% | 46.73 → 50.48 |
| FIN-FLR-004 | Sft | 219 | 227 | +3.7% | 46.73 → 50.48 |
| FIN-FLR-005 | Sft | 302 | 303 | +0.3% | 14.95 → 16.15 |
| FIN-FLR-006 | Sft | 460 | 461 | +0.2% | 14.95 → 16.15 |
| FIN-PLS-001 | Sft | 67 | 68 | +1.5% | 37.38 → 36.88 |
| FIN-PLS-002 | Sft | 71 | 84 | +18.3% | 37.38 → 46.10 |
| FIN-PLS-003 | Sft | 78 | 92 | +17.9% | 37.38 → 46.10 |
| FIN-PLS-004 | Sft | 64 | 70 | +9.4% | 37.38 → 40.98 |
| FIN-PNT-001 | Sft | 59 | 58 | -1.7% | 19.79 → 19.13 |
| FIN-PNT-002 | Sft | 71 | 101 | +42.3% | 14.85 → 40.99 |
| FIN-SCR-001 | Sft | 85 | 131 | +54.1% | 21.10 → 55.54 |
| FIN-SCR-002 | Sft | 105 | 165 | +57.1% | 21.10 → 65.95 |
| FIN-SCR-003 | Sft | 167 | 251 | +50.3% | 21.10 → 81.17 |
| FIN-SCR-004 | Sft | 72 | 106 | +47.2% | 21.10 → 45.88 |
| FIN-SKT-001 | Rft | 124 | 126 | +1.6% | 24.92 → 26.92 |
| FIN-WAL-001 | Sft | 218 | 222 | +1.8% | 37.38 → 40.38 |
| FIN-WAL-002 | Sft | 324 | 328 | +1.2% | 37.38 → 40.38 |
| FIN-WPF-001 | Sft | 144 | 157 | +9.0% | 9.35 → 20.77 |
| FIN-WPF-003 | Sft | 117 | 145 | +23.9% | 26.38 → 42.21 |
| MEP-HVAC-002 | Sft | 460 | 495 | +7.6% | 28.92 → 58.62 |
| PLB-FIX-001 | Nos | 40,079 | 43,520 | +8.6% | 2,069.00 → 4,985.54 |
| PLB-FIX-002 | Nos | 21,751 | 24,735 | +13.7% | 2,069.00 → 4,597.78 |
| PLB-PPR-075 | Rft | 232 | 279 | +20.3% | 51.73 → 91.96 |
| PLB-PPR-100 | Rft | 309 | 357 | +15.5% | 51.73 → 91.96 |
| PLB-PPR-125 | Rft | 445 | 493 | +10.8% | 51.73 → 91.96 |
| PLB-PPR-150 | Rft | 658 | 700 | +6.4% | 82.76 → 118.23 |
| PLB-PPR-175 | Rft | 1,004 | 1,046 | +4.2% | 82.76 → 118.23 |
| PLB-PPR-200 | Rft | 1,571 | 1,613 | +2.7% | 82.76 → 118.23 |
| PLB-PPR-250 | Rft | 2,250 | 2,348 | +4.4% | 82.76 → 165.52 |
| PLB-PPR-300 | Rft | 3,378 | 3,525 | +4.4% | 82.76 → 206.90 |
| PLB-PPR-400 | Rft | 5,134 | 5,323 | +3.7% | 82.76 → 243.41 |
| PLB-SWV-200 | Rft | 350 | 408 | +16.6% | 68.97 → 118.23 |
| PLB-SWV-300 | Rft | 528 | 752 | +42.4% | 68.97 → 258.62 |
| PLB-SWV-400 | Rft | 907 | 1,151 | +26.9% | 68.97 → 275.87 |

### New rate analyses (added to the workbook and the dashboard)

| Code | Unit | Description | Rev07 rate | Status |
|---|---|---|---:|---|
| CIV-CON-024 | cft | Extra labour over RCC items for placing concrete in 2nd and subsequent storeys, complete in all respects. | 72 | Market-derived + assumptions |
| CIV-MAS-007 | cft | Extra labour over brick masonry for work in 1st floor, complete in all respects. | 21 | Market-derived + assumptions |
| CIV-MAS-008 | cft | Extra labour over brick masonry for work in 2nd floor, complete in all respects. | 48 | Market-derived + assumptions |
| CIV-MAS-009 | cft | Extra labour over brick masonry for work in 3rd floor, complete in all respects. | 74 | Market-derived + assumptions |
| CIV-MAS-010 | cft | Extra labour over brick masonry for work in 4th floor, complete in all respects. | 119 | Market-derived + assumptions |
| CIV-MAS-011 | cft | Extra labour over brick masonry for each floor above the 4th floor (add per floor), complete in all respects. | 13 | Market-derived + assumptions |
| FIN-PLS-005 | Sft | Extra labour over cement plaster for work above 20 ft height, for each additional 10 ft or part, complete in a | 8 | Market-derived + assumptions |
| FIN-FLR-008 | Sft | Extra labour over tile / stone / mosaic flooring for each storey above ground, complete in all respects. | 14 | Market-derived + assumptions |
| PLB-HDPE-110 | Rft | Providing and fixing HDPE PN-10 pipe 110 mm with butt-fusion elbows and tees and clamps, tested, complete in a | 965 | INCOMPLETE – 4 blank/old input(s) |
| FF-LV-001 | Nos | Supplying and installing 2½" flanged landing valve with blank cap, connected and tested, complete in all respe | 54,573 | INCOMPLETE – 1 blank/old input(s) |
| MISC-SGN-001 | Sft | Supplying and fixing 3D acrylic-letter signage board, measured on board face area, complete in all respects. | 2,449 | INCOMPLETE – 1 blank/old input(s) |
| PRE-GEN-003 | Job | Mobilization and demobilization of plant, equipment, staff and temporary facilities, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| PRE-GEN-004 | Job | Providing, maintaining and removing site office, stores, labour welfare and security cabin, complete in all re | 0 | INCOMPLETE – 1 blank/old input(s) |
| PRE-GEN-005 | Month | Providing and running temporary water and electricity supply for construction, per month, complete in all resp | 0 | INCOMPLETE – 1 blank/old input(s) |
| PRE-GEN-006 | Nos | Sampling, curing and testing concrete cylinders / cubes (set of 3) at an approved laboratory, complete in all  | 0 | INCOMPLETE – 1 blank/old input(s) |
| PRE-GEN-007 | Sft | Final builder's cleaning of floors, walls, glazing and fixtures before handover, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-CLG-003 | Sft | Providing and fixing concealed-grid suspended ceiling of ½" fire-rated gypsum board on GI frame, taped and joi | 47 | INCOMPLETE – 1 blank/old input(s) |
| FIN-CLG-004 | Sft | Providing and fixing aluminium clip-in / lay-in metal ceiling tiles 2'×2' on suspended grid, complete in all r | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-CLG-005 | Nos | Providing and fixing 2'×2' access panel in gypsum ceiling with frame and push-latch, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-FLR-009 | Sft | Providing and laying carpet tiles on adhesive over levelled screed, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-WAL-003 | Sft | Providing and fixing vinyl wallpaper on prepared plastered walls, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-WAL-004 | Sft | Providing and fixing acoustic wall panels on framing, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FIN-DOR-003 | Nos | Supplying and installing 12 mm toughened glass door 3'×7' with patch fittings, floor spring and handle, comple | 0 | INCOMPLETE – 1 blank/old input(s) |
| FAC-GRC-001 | Sft | Supplying and fixing GRC façade panels with stainless fixings, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FAC-EIFS-001 | Sft | Providing and applying EIFS insulated render system on external walls, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FAC-CNP-001 | Sft | Supplying and installing steel-framed glass entrance canopy, measured on plan area, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| FAC-SKY-001 | Sft | Supplying and installing skylight glazing on aluminium frame with flashings, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| PLB-URN-001 | Nos | Supplying and fixing wall-hung urinal with flush valve, trap and connections, complete in all respects. | 5,425 | INCOMPLETE – 1 blank/old input(s) |
| PLB-CPVC-100 | Rft | Providing and fixing CPVC SDR-11 pipe ¾" with solvent-welded fittings and clamps, tested, complete in all resp | 109 | INCOMPLETE – 1 blank/old input(s) |
| ELV-ACS-001 | Nos | Supplying, installing and commissioning access control on one door (reader, maglock, exit button, controller s | 0 | INCOMPLETE – 1 blank/old input(s) |
| LS-FST-001 | Rft | Providing and applying fire-stop sealant / smoke seal at slab edges and service penetrations, complete in all  | 0 | INCOMPLETE – 1 blank/old input(s) |
| LFT-002 | Nos | Supplying, installing, testing and commissioning escalator per specification, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| EXT-IRR-001 | Sft | Providing and installing drip / sprinkler irrigation system for landscaped areas, complete in all respects. | 0 | INCOMPLETE – 1 blank/old input(s) |
| MEP-HVAC-004 | TR | Supplying and installing VRF air-conditioning system (outdoor and indoor units, refrigerant piping, controls), | 0 | INCOMPLETE – 1 blank/old input(s) |
| ELE-MDB-001 | Nos | Supplying and installing main distribution board with incomer, outgoing breakers, metering and busbars per SLD | 0 | INCOMPLETE – 1 blank/old input(s) |

### Dashboard items whose rate differs >30% from the workbook equivalent (17, col M) — review

| Workbook item | Rev07 | Dashboard item | Dashboard rate | Difference |
|---|---:|---|---:|---:|
| CIV-FWK-001 | 90 | FW-320 | 160.36 | +78% |
| CIV-FWK-002 | 109 | FW-310 | 191.08 | +75% |
| CIV-FWK-003 | 100 | FW-300 | 175.32 | +75% |
| CIV-FWK-004 | 99 | FW-330 | 188.83 | +91% |
| FIN-FLR-001 | 324 | FN-500 | 495.63 | +53% |
| FIN-WAL-001 | 222 | FN-505 | 365.43 | +65% |
| FIN-FLR-004 | 227 | FN-510 | 616.75 | +172% |
| FIN-CLG-001 | 255 | FN-550 | 119.85 | -53% |
| FIN-CLG-002 | 255 | FN-550 | 119.85 | -53% |
| CIV-EW-001 | 11 | CV-008 | 15.36 | +40% |
| CIV-EW-002 | 13 | EX-115 | 314.05 | +2316% |
| CIV-EW-003 | 23 | EX-110 | 119.13 | +418% |
| CIV-EW-004 | 13 | EX-120 | 26.02 | +100% |
| CIV-EW-007 | 11 | EX-140 | 30.22 | +175% |
| FIN-WIN-001 | 1,659 | FN-570 | 2,362.52 | +42% |
| FIN-JNR-001 | 1,766 | CV-095 | 7,670.00 | +334% |
| FAC-ACP-001 | 123 | CV-099 | 885.00 | +620% |
| EXT-RD-002 | 168 | CV-122 | 330.40 | +97% |
| EXT-LND-001 | 15 | CV-128 | 48.56 | +224% |
| PLB-PPR-175 | 1,046 | MP-201D | 565.55 | -46% |
| PLB-PPR-200 | 1,613 | MP-201E | 1,061.76 | -34% |
| PLB-PPR-250 | 2,348 | MP-201F | 223.20 | -90% |
| FF-PIP-200 | 1,192 | MF-401D | 1,609.92 | +35% |
| FF-PIP-400 | 3,014 | MF-401G | 4,215.94 | +40% |
| ELE-CND-075 | 111 | EL-600 | 77.50 | -30% |
| ELE-CBL-329 | 37 | EL-610 | 48.50 | +31% |
| ELE-PNT-002 | 8,903 | EL-620 | 1,689.93 | -81% |
| ELE-ERT-001 | 58,536 | EL-660 | 28,373.63 | -52% |
| ELE-DB-001 | 75,656 | EL-640 | 18,930.50 | -75% |
| ELV-CCTV-001 | 25,723 | MX-1203 | 13,002.12 | -49% |
| LS-FA-001 | 16,825 | MX-1104 | 9,519.50 | -43% |
| MEP-HVAC-002 | 495 | MN-H10 | 81.42 | -84% |
| MEP-HVAC-003 | 173,033 | MN-H18 | 4,720.00 | -97% |
| FIN-FLR-005 | 303 | CV-081 | 570.24 | +88% |
| FIN-SKT-001 | 126 | CV-083 | 164.69 | +31% |
| CIV-FWK-005 | 109 | FW-340 | 236.86 | +117% |
| CIV-FWK-006 | 99 | FW-350 | 139.27 | +41% |

### Inputs still without a dated source (16 RFQ) — 76 lines

* **Ceiling systems** (7): MAT-GI-FC, MAT-GI-MC, MAT-GI-WA, MAT-GYP-12, MAT-GYP-MR, MAT-GYP-SYSMR, MAT-JTAPE
* **Chemicals, paints & sealants** (6): MAT-ADM-SP, MAT-BIT-PRM, MAT-CWP, MAT-JCMP, MAT-SHOIL, MAT-VADH
* **Civil materials & external** (2): MAT-SND-ZDP, MAT-WTR
* **Doors, timber & joinery** (4): MAT-CAB-HW, MAT-FRD, MAT-MDF-18, MAT-POL
* **Electrical & ELV** (1): MAT-DB
* **Façade, glazing & metalwork** (8): MAT-ACP, MAT-ALSF, MAT-ALW, MAT-BRKT, MAT-CW, MAT-FSTOP, MAT-GRN, MAT-SSANC
* **Fire fighting & life safety** (4): MAT-BSP-100, MAT-BSP-200, MAT-BSP-400, MAT-FFFIT
* **Labour contractors** (8): LAB-CLD, LAB-CLG, LAB-FAB, LAB-GLZ, LAB-HVT, LAB-PFT, LAB-SCF, LAB-WPA
* **Lifts** (1): MAT-LIFT
* **Plant hire** (8): EQ-BP, EQ-CRADLE, EQ-MIX, EQ-PROP, EQ-SCAF, EQ-TORCH, EQ-TRUCK, EQ-VIB
* **Plumbing & sanitary** (4): MAT-CLMP, MAT-PPR-075-EL, MAT-PPR-075-SO, MAT-PPR-075-TE
* **Vendor / sub-contract** (23): MAT-MOB, MAT-SITEOFF, MAT-TEMPSVC, MAT-CUBE, MAT-CLEAN, MAT-GYP-SYSFR, MAT-MCLG, MAT-ACCP, MAT-CPT, MAT-WPP, MAT-ACPNL, MAT-GLDR, MAT-GRC, MAT-EIFS, MAT-CNPY, MAT-SKYL, MAT-URN, MAT-CPVC-100, MAT-ACS, MAT-ESC, MAT-IRR, MAT-VRF, MAT-MDB

## Validation

| Check | Result |
|---|---|
| Workbook recalculated (LibreOffice) — formula errors in any sheet | 0 |
| 14 VALIDATION QC: duplicates / missing units / complete items at zero | 0 / 0 / 0 |
| 18 DASHBOARD RECONCILIATION — same code, unit, description, resource rows and rate (±0.05 PKR) | **160 of 160 OK** |
| Shared resource lines, workbook rate = dashboard rate | 36 of 36 OK (the build stops otherwise) |
| `tools/test_ra_master.js` (fresh library, saved-library upgrade, hand edits kept, user items kept, rate edit re-prices, search) | 21 passed, 0 failed |
| Existing browser suites `test_civil_gap.js` / `test_qs_engine.js` | 18 / 46 passed, 0 failed (46 = baseline; 2 Excel checks skip offline) |
| Python suites `test_civil_gap_data`, `test_lab_mix_data`, `test_mep_rates`, `test_qs_engine_data`, `test_ra_master_data` | OK |
| Page errors on load | none |

Workbook totals (14): 160 analyses; 83 fully priced, 77 still carry at least one blank or old input — every one of
those inputs is listed in 16 RFQ. Enter a quotation there and both the workbook and (after re-running
`tools/ra_master_build.sh`) the dashboard update.

## Rebuild

```sh
python3 -m http.server 8765 &                                   # repo root
tools/ra_master_build.sh RA_Master_Pakistan_FINAL_Rev06_2026-09-27.xlsx docs/
python3 -m unittest tools/test_ra_master_data.py
```

`tools/ra_master_config.py` holds every decision (shared-line map, rate updates, productivity table with
benchmarks, new items); `tools/ra_master_excel.py` edits the workbook; `tools/ra_master_data.py` writes the
dashboard block; `tools/test_ra_master.js` checks the page.


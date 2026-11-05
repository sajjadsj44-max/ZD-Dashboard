# GRN refresh — November 2026

Asked on 05-Nov-2026: update the GRN Price Register and the Rate Analysis library (QS Cost Control, `zameen-developments/?app=ra`) from the store's workbook **Material Received at Store 28** (all Zameen Developments projects, receipts to 29-Oct-2026), and build the rate analysis of any item received that the library has none for.

## What changed

| | Before | After |
|---|---:|---:|
| GRN receipts in the register | 21,840 | 22,085 (+245) |
| Latest receipt | 30-Sep-2026 | 29-Oct-2026 |
| Rate lines refreshed from a newer GRN | | 54 (37 at a new rate) |
| Items in the library | 1,042 | 1,060 (+18) |
| Rate lines | 1,281 | 1,300 (+19) |
| Existing items whose rate moved | | 155 (38 up, 117 down) |

## 1. GRN Price Register

`tools/grn_register.py` added **245 receipts**, all dated 01–29 Oct 2026: NEO 72, ARX 49, Vault 35, Phoenix 28, Jade 22, DTR 18, EON 12, GVR 8, Quadrangle 1. The other rows of the workbook were already held (Material Received at Store 21 and the ERP exports). 38 rows the workbook rounds (diesel, tea, pens, a cable at 185 against 185.08 …) or carries with another quantity under the same site, GRN and item code keep the ERP export's line, as before.

## 2. Rate Database from the latest GRN

`node tools/grn_rates.js` (block `raGrnLatest`): a line takes the latest GRN of its material — the quantity-weighted average of the latest day, any project — only when that GRN is dated after the line's own date; a newer GRN at the same rate refreshes the date and source only; a change of more than 3× is held. New this time: **`ALIASES`**, a hand-checked table of lines whose material the store describes in other words ("Sand Lawerncepur", a 20 kg tile-bond bag for a per-kg line, a 305 m Cat-6 coil for a per-Rft line). Lines marked *alias* below come from it.

| Code | Line | Unit | Was | Now | Change | GRN (source / remarks) |
|---|---|---|---:|---:|---:|---|
| ADMIX-SP *alias* | Superplasticizer admixture — FosPak SP 568 / approved equal  | Kg | 185 | 215 | +16.2% | Jade GRN RCP-538, 13-Oct-2026 — FOSPAK (PRIVATE) LIMITED, 4,780 KGS. Replaces 185 of 15-Jul-2025 |
| BM-CV-116 *alias* | MS cat ladder — benchmark, all-in | Rft | 1,400 | 1,117 | -20.2% | NEO GRN RCP-3619, 25-Oct-2026 — USMAN SHABBIR, 40 RFT; pipe-frame ladder, 1"x1" rungs at 7.5", the fabricator's measured bill. Replaces 1,400 (undated) |
| CRSH-SG *alias* | Crush — Sargodha, 1/2" and 3/8" | Cft | 185 | 168 | -9.2% | Jade GRN RCP-536, 13-Oct-2026 — Abdul Haseeb Stone Supplier Agent, 9,918 CFT; 2 receipts that day (Jade RCP-536); the GRN does not name the quarry. Replaces 185 of 04-Sep-2026 |
| DIESEL | Diesel — generator / plant fuel | Ltr | 380.66 | 380.15 | -0.1% | EON GRN RCP-12, 05-Oct-2026 — Malak Jan Enterprises, 1,010.95 LTR; 10 receipts that day (EON RCP-12), quantity-weighted average of 366–392. Replaces 380.66 of 30-Sep-2026 |
| GRN-PHO-COM-000001 *alias* | Dahua POE Switch 8-Port | Nos | 13,300 | 11,564 | -13.1% | Jade GRN RCP-541, 23-Oct-2026 — CYG TECHNOLOGIES, 2 PCS. Replaces 13,300 of 27-Feb-2026 |
| GRN-PHO-MAE-000024 *alias* | Cat-6 UTP Data Cable | Rft | 51 | 61.91 | +21.4% | NEO GRN RCP-3601, 13-Oct-2026 — Net Soft Solutions, 3 Coil; billed 61,950 per Coil, ÷ 1,000.66 (Rft in a 305 m coil). Replaces 51 of 01-Jun-2026 |
| GRN-QUA-ELE-000473 *alias* | Gluing PVC Solution (Solvent Cement) 500ML | Nos | 1,000 | 550 | -45.0% | ARX GRN RCP-325, 01-Oct-2026 — Local Cash Purchases, 1 Each. Replaces 1,000 of 14-Sep-2026 |
| GRN-QUA-FIN-000260 *alias* | Bathroom Floor Tile IM 612002 Grey Matt 24"x48" | Sft | 183.95 | 180.23 | -2.0% | NEO GRN RCP-3438, 27-Jul-2026 — OREAL CERAMICS INDUSTRIAL (PRIVATE) LIMITED, 409.36 Sq.Mt; billed 1,940 per Sq.Mt, converted to per Sft; the same grey matt 24"x48" range. Replaces 183.95 of 30-Oct-2025 |
| GRN-QUA-FIN-000261 *alias* | Bathroom Wall Tile OR 612040 Karara White Gloss 24"x48" | Sft | 178.37 | 183.95 | +3.1% | NEO GRN RCP-3611, 19-Oct-2026 — OREAL CERAMICS INDUSTRIAL (PRIVATE) LIMITED, 216 Sq.Mt; billed 1,980 per Sq.Mt, converted to per Sft; white marble-texture (Carrara) gloss 24"x48". Replaces 178.37 of 02-May-2025 |
| GRN-QUA-HDW-000623-10353 *alias* | PPRC Tee 32mm | Nos | 115 | 67 | -41.7% | Vault GRN RCP-163, 03-Sep-2026 — Local Cash Purchase, 6 Each. Replaces 115 of 05-Aug-2026 |
| GRN-QUA-MEP-000108 | ms back box 6" x 3" | Nos | 360 | 300 | -16.7% | NEO GRN RCP-3610, 19-Oct-2026 — Local Cash Purchases, 44 each. Replaces 360 of 18-Oct-2026 |
| GRN-QUA-MEP-000608 *alias* | tee stop cock | Nos | 1,360 | 1,124 | -17.4% | NEO GRN RCP-3595, 06-Oct-2026 — AGILITY & CO, 210 Each. Replaces 1,360 of 28-Jul-2026 |
| GRN-QUA-MEP-000828 *alias* | Floor Drain 6" x 6" | Nos | 1,100 | 2,150 | +95.5% | NEO GRN RCP-3592, 06-Oct-2026 — Local Cash Purchases, 34 Each. Replaces 1,100 of 05-Apr-2026 |
| GRN-QUA-MEP-000867 *alias* | Cu Pipe 1/4" Dia Insulation, 9mm thick | Rft | 20 | 32 | +60.0% | NEO GRN RCP-3445, 27-Jul-2026 — Orico Enterprises, 177.12 RFT. Replaces 20 of 02-Dec-2025 |
| GRN-QUA-MEP-001124 *alias* | PPRC Socket 32mm | Nos | 68 | 34 | -50.0% | Vault GRN RCP-163, 03-Sep-2026 — Local Cash Purchase, 11 Each. Replaces 68 of 05-Aug-2026 |
| GRN-QUA-MEP-001186 *alias* | Cu Pipe Insulation 9mm thick O type 1/2" | Rft | 28 | 38 | +35.7% | NEO GRN RCP-3445, 27-Jul-2026 — Orico Enterprises, 32 RFT. Replaces 28 of 28-Nov-2025 |
| GRN-QUA-MEP-001228 *alias* | Gland for Cable 4C x 50 sq.mm | Nos | 820 | 830 | +1.2% | Mall 35 GRN RCP-1022, 28-Jul-2026 — Faizan Traders, 2 Each. Replaces 820 of 27-Jul-2026 |
| GRN-QUA-MEP-001462 | MS Pipe (Schedule 40 Seamless) 6" | Rft | 3,220 | 3,116 | -3.2% | NEO GRN RCP-3593, 06-Oct-2026 — Star Corporation, 39.36 RFT. Replaces 3,220 of 12-May-2026 |
| GRN-QUA-MEP-001734 | 1 Gang Switch | Nos | 303 | 302 | -0.3% | NEO GRN RCP-3620, 25-Oct-2026 — A.S Traders, 4 Each. Replaces 303 of 17-Aug-2026 |
| GRN-QUA-MEP-001738 | 6 Gang Switch | Nos | 1,558 | 1,557 | -0.1% | NEO GRN RCP-3620, 25-Oct-2026 — A.S Traders, 2 Each. Replaces 1,558 of 17-Aug-2026 |
| GRN-QUA-MEP-001760 | Breeching Inlet 4" 2 way | Nos | 56,640 | 76,509 | +35.1% | NEO GRN RCP-3589, 01-Oct-2026 — H.S Ahmed Ally, 1 Each. Replaces 56,640 of 21-Oct-2024 |
| GRN-QUA-MEP-001763 | Zone Control Valve Assembly 4" | Nos | 214,590 | 199,670 | -7.0% | NEO GRN RCP-3589, 01-Oct-2026 — H.S Ahmed Ally, 1 Each. Replaces 214,590 of 21-Oct-2024 |
| GRN-QUA-MEP-002102 | Two Gang Switch | Nos | 468 | 467 | -0.2% | NEO GRN RCP-3620, 25-Oct-2026 — A.S Traders, 8 Each. Replaces 468 of 17-Aug-2026 |
| HESSIAN | Hessian cloth 270 GSM, 3.5 ft wide — curing | Sft | 18 | 11 | -38.9% | GVR GRN RCP-23, 29-Oct-2026 — Surkhail Engineering, 11,880 Sq.Ft. Replaces 18 of 03-Aug-2026 |
| MAT-CAT6 *alias* | Cat-6 UTP cable — 305 coil | Rft | 51 | 61.91 | +21.4% | NEO GRN RCP-3601, 13-Oct-2026 — Net Soft Solutions, 3 Coil; billed 61,950 per Coil, ÷ 1,000.66 (Rft in a 305 m coil). Replaces 51 of 01-Jun-2026 |
| MAT-DSTP *alias* | Door stopper | Nos | 900 | 555 | -38.3% | Quadrangle GRN RCP-3498, 31-Aug-2026 — Bin Arif Industries (Private) Limited, 680 Each. Replaces 900 of 01-Jul-2026 |
| MAT-MEM-APP *alias* | APP modified bitumen membrane 4-thick (torch-on) — Polyester | Sft | 108 | 122.33 | +13.3% | Jade GRN RCP-529, 29-Sep-2026 — GRACE CHEMICALS (SMC-PRIVATE) LIMITED, 12,321 Sq.Ft; 2 receipts that day (Jade RCP-529, Jade RCP-528), quantity-weighted average of 108–127. Replaces 108 of 22-May-2026 |
| MAT-SAC *alias* | Split AC 1.5 ton inverter (indoor+outdoor) | Nos | 123,500 | 118,260 | -4.2% | NEO GRN RCP-3508, 01-Sep-2026 — Haier Pakistan (Private) Limited, 76 PCS. Replaces 123,500 of 20-Jan-2026 |
| MAT-SW | Switch 1-gang with plate — Approved brand | Nos | 303 | 302 | -0.3% | NEO GRN RCP-3620, 25-Oct-2026 — A.S Traders, 4 Each. Replaces 303 of 17-Aug-2026 |
| MAT-TADH *alias* | Tile adhesive 20 kg bag — Cementitious C1 (Bestway / Stile B | Bag | 650 | 578 | -11.1% | NEO GRN RCP-3612, 19-Oct-2026 — KENNCOAT CONSTRUCTION CHEMICALS, 240 Each; one 20 kg bag. Replaces 650 of 27-Sep-2026 |
| MEP-E1C16 *alias* | Earth cable 1C × 16 mm² Cu/PVC 450/750 V (BS 6004) | Rft | 241.3 | 315.77 | +30.9% | NEO GRN RCP-3516, 07-Sep-2026 — Newage Cables (PVT) Ltd, 35 Metre; billed 1,036 per Metre, converted to per Rft. Replaces 241.3 of 03-Jun-2026 |
| MEP-NBR19 *alias* | NBR / elastomeric insulation sheet 3/4" thick | Sft | 229.3 | 273.4 | +19.2% | NEO GRN RCP-3606, 19-Oct-2026 — Bmexon Engineering Services, 1 Each; billed 29,428 per Each, ÷ 107.64 (Sft in a 1 m × 10 m roll). Replaces 229.3 of 01-Jul-2026 |
| QE-PNT-PUT *alias* | Wall putty (Berger), per kg | Kg | 116.67 | 93.33 | -20.0% | NEO GRN RCP-3413, 13-Jul-2026 — Berger Paints Pakistan Limited, 100 Bucket; billed 2,800 per Bucket, ÷ 30 (kg per bucket). Replaces 116.67 of 01-Jun-2026 |
| SAND-LP *alias* | Sand — Lawrencepur | Cft | 240 | 229.17 | -4.5% | Jade GRN RCP-534, 12-Oct-2026 — Mughal Brothers (3869403-4), 10,552 CFT; 2 receipts that day (Jade RCP-534, Jade RCP-535), quantity-weighted average of 225–230. Replaces 240 of 04-Sep-2026 |
| SEALANT *alias* | Silicone sealant — approved | Rft | 25.73 | 15.27 | -40.7% | NEO GRN RCP-3614, 21-Oct-2026 — Umer Enterprises, 113 Each; billed 385 per Each, ÷ 25.22 (Rft of ¼"×¼" bead per 310 ml cartridge, as the line). Replaces 25.73 of 18-Oct-2026 |
| STL60 | Reinforcement steel — Grade 60 deformed bar | Kg | 238 | 242.86 | +2.0% | Phoenix GRN RCP-329, 06-Oct-2026 — Kamran Steel Re-Rolling Mills (Pvt) LTD / Kamran Steel Re Rolling Mills Pvt Ltd, 70.19 M.Ton; 2 receipts that day (Phoenix RCP-329, GVR RCP-21), quantity-weighted average of 242–244; billed 242,000 per M.Ton, converted to per Kg. Replaces 238 of 26-Sep-2026 |
| TILEADH *alias* | Tile adhesive — approved | Kg | 35 | 28.9 | -17.4% | NEO GRN RCP-3612, 19-Oct-2026 — KENNCOAT CONSTRUCTION CHEMICALS, 240 Each; billed 578 per Each, ÷ 20 (kg per bag). Replaces 35 of 01-Jun-2026 |
| BLK-H4 | Hollow concrete block 4"×8"×16" | Nos | 135 | 135 | date / source | Phoenix GRN RCP-328, 01-Oct-2026 — Azmat Sons, 2,230 Each. Replaces 135 of 19-Sep-2026 |
| BLK-H8 | Hollow concrete block 8"×8"×16" | Nos | 210 | 210 | date / source | Phoenix GRN RCP-328, 01-Oct-2026 — Azmat Sons, 2,216 Each. Replaces 210 of 19-Sep-2026 |
| BLK-S8 | Solid concrete block 8"×8"×12" | Nos | 215 | 215 | date / source | Phoenix GRN RCP-328, 01-Oct-2026 — Azmat Sons, 1,102 Each. Replaces 215 of 21-Sep-2026 |
| BWIRE | Binding wire — 20 SWG | Kg | 345 | 345 | date / source | Jade GRN RCP-542, 26-Oct-2026 — Ibrahim Nizami Steel Wire Industries Pvt Ltd, 549 KGS. Replaces 345 of 21-Sep-2026 |
| GRN-QUA-MEP-000191 | drop in anchor 10mm | Nos | 18 | 18 | date / source | NEO GRN RCP-3598, 10-Oct-2026 — Surkhail Engineering, 500 each. Replaces 18 of 15-Sep-2026 |
| GRN-QUA-MEP-000299 *alias* | Fire Rated Fire Alarm (FA) 1x2 core (1.5mm2) cable | Rft | 126 | 126 | date / source | NEO GRN RCP-3428, 24-Jul-2026 — MUHAMMAD TUFAIL & SONS, 5,003 RFT. Replaces 126 of 13-Apr-2026 |
| GRN-QUA-MEP-001027 *alias* | UPVC Pipe Class-B 2" | Rft | 121 | 121 | date / source | Mall 35 GRN RCP-1026, 05-Aug-2026 — Plasco PVC Pipe Industries (Private) Limited, 17 RFT. Replaces 121 of 17-Jul-2026 |
| GRN-QUA-MEP-001030 *alias* | UPVC Elbow 90 Degree Class-B 2" | Nos | 99 | 99 | date / source | Mall 35 GRN RCP-1026, 05-Aug-2026 — Plasco PVC Pipe Industries (Private) Limited, 16 Each. Replaces 99 of 29-Jun-2026 |
| GRN-QUA-MEP-001042 *alias* | PPRC Elbow 90 Degree 25mm | Nos | 46 | 46 | date / source | NEO GRN RCP-3529, 14-Sep-2026 — Plasco PVC Pipe Industries (Private) Limited, 26 Each. Replaces 46 of 17-Jul-2026 |
| MAT-FRC *alias* | Fire-rated alarm cable 2-core — FP200 or equal | Rft | 126 | 126 | date / source | NEO GRN RCP-3428, 24-Jul-2026 — MUHAMMAD TUFAIL & SONS, 5,003 RFT. Replaces 126 of 13-Apr-2026 |
| MAT-GIS *alias* | GI sheet for ductwork (24–26 gauge) | Kg | 366 | 366 | date / source | NEO GRN RCP-3588, 01-Oct-2026 — GLOBAL TRADERS, 103.5 kgs. Replaces 366 of 29-Sep-2026 |
| P-PUMP | Concrete pump / placing boom | Cft | 32.56 | 32.56 | date / source | GVR GRN RCP-22, 09-Oct-2026 — Local Cash Purchase, 205 Cubic Mtr; billed 1,150 per Cubic Mtr, converted to per Cft. Replaces 32.56 of 24-Sep-2026 |
| RMC-4000 | Ready-mix concrete — 4000 psi, delivered | Cft | 356.79 | 356.79 | date / source | DTR GRN RCP-223, 08-Oct-2026 — Local Cash Purchases, 270 Cubic Mtr; 2 receipts that day (DTR RCP-223, DTR RCP-222); billed 12,600 per Cubic Mtr, converted to per Cft. Replaces 356.79 of 23-Sep-2026 |
| RMC-4500 | Ready-mix concrete — 4500 psi, delivered | Cft | 362.46 | 362.46 | date / source | GVR GRN RCP-22, 09-Oct-2026 — Local Cash Purchase, 204 Cubic Mtr; billed 12,800 per Cubic Mtr, converted to per Cft. Replaces 362.46 of 24-Sep-2026 |
| RMC-5000 | Ready-mix concrete — 5000 psi, delivered | Cft | 368.12 | 368.12 | date / source | DTR GRN RCP-223, 08-Oct-2026 — Local Cash Purchases, 13 Cubic Mtr; billed 13,000 per Cubic Mtr, converted to per Cft. Replaces 368.12 of 23-Sep-2026 |
| SAND-CH | Sand — Chenab | Cft | 80 | 80 | date / source | NEO GRN RCP-3599, 10-Oct-2026 — MUSHTAQ & SONS GENERAL ORDER SUPPLIER, 1,168 CFT. Replaces 80 of 18-Sep-2026 |
| SAND-RV | Sand — Ravi | Cft | 52 | 52 | date / source | Jade GRN RCP-537, 13-Oct-2026 — MUSHTAQ & SONS GENERAL ORDER SUPPLIER, 2,106 CFT. Replaces 52 of 27-Aug-2026 |

Held for a decision (unchanged from 07-Oct): GRN-PHO-MEP-100089 self-tapping screw 1-1/2" — 2.5 per piece (Phoenix) against 250 (Vault RCP-128), more than 3×.

## 3. New rate analyses (block `raGrnItems`)

Every construction material received in October 2026 was checked against the library by the material lines the items use, not only their wording. These had no item. Overhead 8 % and profit 10 % are the library's own.

* **MEP** — the GRN price plus the MAK contract installation of the same operation (the library's MEP pattern, as MF-408A or MP-303).
* **Metal work and bulkheads** — the fabricators (Malik Steel Works, Usman Shabbir) bill through the store at measured quantities (319.84 Rft of railing, 925.21 Sft of louvre, 193.12 Sft of bulkhead), so their GRN is the fabricate-and-fix rate and the whole cost of the item (as FIN-FLR-009 on MAT-CPT).
* **Carpet tile** — the GRN price + 5 % with the Lahore MRS labour for laying carpet tile.

| Code | Item | Unit | Rate | Build-up |
|---|---|---|---:|---|
| MF-408C | Providing, installing, testing and commissioning zone check assembly 3" (alarm valve, flow switch, gauges, drain), complete in all respects | Nos | 235,672.55 | GRN-NEO-MEP-001764 × 1 (182,990), MAK-MF-408A × 1 (16,732.5) |
| MH-221J | Supplying and installing 6" flexible rubber bellow (expansion joint) with matching flanges, nuts and bolts in pump room, complete in all respects | Nos | 27,950.22 | GRN-NEO-MEP-001203 × 1 (21,240), MAK-MN-P14 × 1 (2,446.63) |
| ELE-DIS-105 | Supplying, installing, testing and commissioning Main LT Panel Board (MLTP) with power factor improvement panel 125 kVAr, free standing, as per approved SLD, complete in all respects | Nos | 3,877,652.28 | GRN-NEO-MEP-002428 × 1 (3,140,646), MAK-ME-201 × 1 (109,125), MAK-ME-206 × 1 (36,375) |
| ELE-DIS-106 | Supplying, installing, testing and commissioning auto load-sharing synchronising generator panel board, as per approved SLD, complete in all respects | Nos | 3,139,394.72 | GRN-NEO-ELE-000556 × 1 (2,478,629), MAK-ME-205 × 1 (181,875) |
| ELE-DIS-107 | Supplying, installing, testing and commissioning sub-main panel board (SMPB) for common services, as per approved SLD, complete in all respects | Nos | 2,285,108.35 | GRN-NEO-MEP-001356 × 1 (1,896,520), MAK-ME-202 × 1 (40,012.5) |
| MP-809A | Supplying, installing, testing and commissioning submersible pump, missile (borehole) type, 0.75 HP, complete in all respects | Nos | 56,640 | GRN-PHO-MEP-100564 × 1 (28,000), MAK-MP-809 × 1 (20,000) |
| MP-809B | Supplying, installing, testing and commissioning submersible pump, missile (borehole) type, 3 HP, complete in all respects | Nos | 92,040 | GRN-EON-MEP-100606 × 1 (58,000), MAK-MP-809 × 1 (20,000) |
| MP-811A | Supplying and fixing uPVC backflow preventer 4" Class D (BS 3505) on drainage outlet, jointed, complete in all respects | Nos | 12,594.29 | GRN-NEO-MEP-002936 × 1 (6,490), MAK-MP-811 × 1 (4,183.13) |
| MP-811B | Supplying and fixing uPVC backflow preventer 6" Class D (BS 3505) on drainage outlet, jointed, complete in all respects | Nos | 18,163.89 | GRN-NEO-MEP-002935 × 1 (11,210), MAK-MP-811 × 1 (4,183.13) |
| MP-811C | Supplying and fixing uPVC check (non-return) valve 6" Class D, jointed, complete in all respects | Nos | 27,238.09 | GRN-NEO-MEP-002933 × 1 (18,900), MAK-MP-811 × 1 (4,183.13) |
| MISC-STL-109 | Providing and fixing MS parapet / roof railing 4'-0" high of 1"x1" 18 SWG MS pipe, fabricated and fixed, complete in all respects | Rft | 3,131.72 | GRN-NEO-MEP-002768 × 1 (2,654) |
| MISC-STL-110 | Providing and fixing MS railing of 1"x1" 18 SWG MS pipe with 2"x2" 16 SWG top rail, powder coated, complete in all respects | Rft | 1,298 | GRN-QUA-FIN-000259 × 1 (1,100) |
| MISC-STL-111 | Providing and fixing MS louvre screen of 2"x1" MS pipe louvres at 3" spacing in 3"x1" MS pipe frame, fabricated and fixed, complete in all respects | Sft | 962.88 | GRN-NEO-MEP-002746 × 1 (816) |
| MISC-STL-112 | Providing and fixing MS manhole cover 30"x30" of 18 SWG sheet with 1.5"x1.5"x6 mm angle-iron frame, complete in all respects | Nos | 13,184.14 | GRN-NEO-MEP-002733 × 1 (11,173) |
| MISC-STL-113 | Providing and fixing MS manhole cover 36"x36" of 18 SWG sheet with 1.5"x1.5"x6 mm angle-iron frame, complete in all respects | Nos | 14,503.38 | GRN-NEO-MEP-002734 × 1 (12,291) |
| FIN-CLG-104 | Providing and fixing cement-board bulkhead, board on one side, on 1"x1" 18 SWG MS pipe framing, measured per Sft of board, complete in all respects | Sft | 922.76 | GRN-NEO-FIN-000470 × 1 (782) |
| FIN-CLG-105 | Providing and fixing cement-board bulkhead, board on both sides, on 1"x1" 18 SWG MS pipe framing, measured per Sft of bulkhead, complete in all respects | Sft | 1,450.22 | GRN-NEO-FIN-000469 × 1 (1,229) |
| FIN-FLR-102 | Providing and laying modular carpet tiles (Nexus Founder or equal) over levelled screed, complete in all respects | Sft | 761.34 | GRN-NEO-FIN-000159 × 1.05 (570), MRS-C10-60-1-L × 1 (46.7) |

New rate lines (GRN, each `<site> GRN RCP-n, DD-Mon-YYYY — <vendor>` with the GRN date as its effective date):

| Code | Material | Unit | Rate | Source / remarks |
|---|---|---|---:|---|
| GRN-EON-MEP-100606 | Submersible Pump Missile Type 3HP | Nos | 58,000 | EON GRN RCP-14, 26-Oct-2026 — AM pump |
| GRN-NEO-ELE-000556 | Auto Load Sharing Syncronizing Generator Panel Board | Nos | 2,478,629 | NEO GRN RCP-3602, 13-Oct-2026 — ERCON INDUSTRIES (PVT.) LIMITED |
| GRN-NEO-FIN-000159 | Carpet Tile (Modular Nexus Founder) | Sft | 570 | NEO GRN RCP-3591, 04-Oct-2026 — PAK CARPET & INTERIORS (PRIVATE) LIMITED |
| GRN-NEO-FIN-000469 | Bulkhead Cement Board with MS pipe 18 swg 1"x1" DS | Sft | 1,229 | NEO GRN RCP-3615, 22-Oct-2026 — Malik Steel Works |
| GRN-NEO-FIN-000470 | Bulkhead Cement Board with MS pipe 18 swg 1"x1" SS | Sft | 782 | NEO GRN RCP-3615, 22-Oct-2026 — Malik Steel Works |
| GRN-NEO-MEP-001203 | Flexible Rubber Bellow 6'' with matching Flanges Nuts Bolts | Nos | 21,240 | NEO GRN RCP-3594, 06-Oct-2026 — Star Corporation |
| GRN-NEO-MEP-001356 | Sub Main Panel Board (SMPB) - Common | Nos | 1,896,520 | NEO GRN RCP-3602, 13-Oct-2026 — ERCON INDUSTRIES (PVT.) LIMITED |
| GRN-NEO-MEP-001764 | Zone Control Valve Assembly 3" | Nos | 182,990 | NEO GRN RCP-3589, 01-Oct-2026 — H.S Ahmed Ally; 2 receipts, range 182,990–182,990 |
| GRN-NEO-MEP-002428 | Main Low Tension Panel Board MLTP & PFIP-125 KVAR | Nos | 3,140,646 | NEO GRN RCP-3602, 13-Oct-2026 — ERCON INDUSTRIES (PVT.) LIMITED |
| GRN-NEO-MEP-002733 | MS Manhole Cover 18G 30"x30" With Frame 1.5"x1.5"x6mm | Nos | 11,173 | NEO GRN RCP-3618, 22-Oct-2026 — USMAN SHABBIR |
| GRN-NEO-MEP-002734 | MS Manhole Cover 18G 36"x36" With Frame 1.5"x1.5"x6mm | Nos | 12,291 | NEO GRN RCP-3618, 22-Oct-2026 — USMAN SHABBIR |
| GRN-NEO-MEP-002746 | MS Louver H=70'X4"-6',Pipe 3"x1",W=2"x1" Spacing 3" | Sft | 816 | NEO GRN RCP-3618, 22-Oct-2026 — USMAN SHABBIR |
| GRN-NEO-MEP-002768 | MS Parapet Raling Wall 4'x0" Pipe (18 SWG)1"x1" | Rft | 2,654 | NEO GRN RCP-3616, 22-Oct-2026 — Malik Steel Works |
| GRN-NEO-MEP-002933 | UPVC Check Valve 6" Class D | Nos | 18,900 | NEO GRN RCP-3607, 19-Oct-2026 — HYDROPLAST (PRIVATE) LIMITED |
| GRN-NEO-MEP-002935 | UPVC Backflow Preventer 6" Class D BS-3505 | Nos | 11,210 | NEO GRN RCP-3590, 01-Oct-2026 — MUHAMMAD TUFAIL & SONS |
| GRN-NEO-MEP-002936 | UPVC Back Flow Preventer 4" Class D BS-3505 | Nos | 6,490 | NEO GRN RCP-3590, 01-Oct-2026 — MUHAMMAD TUFAIL & SONS |
| GRN-PHO-MEP-100564 | Submersible Pump Missile Type 0.75Hp | Nos | 28,000 | Phoenix GRN RCP-332, 20-Oct-2026 — umer Enterprises |
| GRN-QUA-FIN-000259 | MS Railing 1"x1" 18 swg with 2"x2" top pipe 16 swg Powder Co | Rft | 1,100 | Quadrangle GRN RCP-3410, 12-Jul-2026 — Malik Steel Works; 4 receipts, range 870–1,150 |
| MRS-C10-60-1-L | Providing and laying Premium Quality Imported, Heavy Duty Carpet Tiles | Sft | 46.7 | Punjab MRS 2nd Bi-Annual 2026 (Lahore), 01-Jul-2026 — Ch.10 item 60, line 1 (Flooring), p.66; labour share 46.70 per Sft as printed; valid 01-Jul-2026 to 31-Dec-2026 |

## 4. Left as they were, and why

* **Cement** — no October receipt; CEM stays at 1,615 (ARX RCP-322, 27-Sep-2026).
* **Bricks** — the latest GRN, "Bricks B Classs" 23 each (ARX RCP-293, 24-Aug-2026; Vault 21–23 in Aug), is older than BRK-2's 13 (web research, 26-Sep-2026), so the line keeps its rate. The two differ by 75 %: worth a fresh quotation.
* **Ready-mix 2500 / 3000 / 3500 psi** — no GRN of these grades; still ASSUMPTION.
* **Paints, primer, putty (MAT-PUTTY), PPR PN-20 pipe and fittings, uPVC Class B / D pipe** — no receipt of the same specification newer than the line (a PN-16 pipe, a threaded fitting or another class is not the same item).
* **Ball valve 3/4" (GRN-QUA-MEP-000567)** — the line is a brass double-line valve (1,575); the October receipt is a GI ball valve (860). Not used.
* **Brass gate valve 1-1/4" (MEP-Z-GV125)** — NEO paid 13,498 (01-Oct-2026), Quadrangle 5,930 (07-Jun-2026) for the same description; the line stays on the Lahore MRS until the brand is known.
* **Carpet tile** — the existing FIN-FLR-009 rests on the MRS all-in polypropylene tile (MAT-CPT 526.70 supplied and laid), below NEO's supply price alone (570); FIN-FLR-102 prices NEO's tile.
* **Panels made for NEO's floors** (ATS-2F … ATS-GF & FF 491,271–1,515,420; MTPB-2F … 367,932–527,621; MCCB box 630 A 262,176) — the GRN gives no rating, so no general item was made. The installation items ME-202 / ME-207 apply.
* **Sika Grout-114 (600/kg), SikaRep (3,600 per 25 kg), Sika ViscoCrete 3355 (290/kg), Sikament RB-858 (250–258/kg)** — no library line uses them; concrete items price admixture on ADMIX-SP (FosPak SP568, now 215).
* **Site running costs and consumables** — diesel is in the library; tea, sugar, milk, stationery, janitorial, PPE, tools, drill bits, filters, engine oil and genset servicing are overheads, not rate-analysis items.

## 5. Items that moved most

| Item | Description | Unit | Was | Now | Change |
|---|---|---|---:|---:|---:|
| MP-303 | Providing and fixing 4" floor drain with P-trap and stainless steel grating, com | Nos | 2,482.66 | 3,721.66 | +49.9% |
| MF-406 | Providing, installing, testing and commissioning fire brigade (Siamese) inlet co | Nos | 75,226.55 | 98,671.97 | +31.2% |
| ME-504D | Supplying and laying 1C × 16 mm² green/yellow PVC insulated earth conductor, com | Rft | 327.61 | 418.12 | +27.6% |
| CV-116 | MS cat ladder of angle / flat / round bars, primed and painted, fixed, complete  | Rft | 1,652 | 1,318.06 | -20.2% |
| MP-202B | Providing and laying Armaflex insulation on 32 mm hot water pipe, complete in al | Rft | 256.91 | 296.42 | +15.4% |
| MP-202C | Providing and laying Armaflex insulation on 40 mm hot water pipe, complete in al | Rft | 288.79 | 332.78 | +15.2% |
| MH-228 | Supplying and installing 3/4" elastomeric closed-cell insulation with fibreglass | Sft | 365.69 | 420.33 | +14.9% |
| MH-231-6 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 780.02 | 896.24 | +14.9% |
| MP-202D | Providing and laying Armaflex insulation on 50 mm hot water pipe, complete in al | Rft | 335.23 | 384.84 | +14.8% |
| MH-231-8 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 979.1 | 1,123.95 | +14.8% |
| MH-231-10 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 1,199.82 | 1,375.05 | +14.6% |
| MH-231-12 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 1,411.45 | 1,615.31 | +14.4% |
| MH-231-2 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 394.77 | 450.18 | +14.0% |
| MH-231-4 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 622.06 | 707.9 | +13.8% |
| MH-231-112 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 359.55 | 408.18 | +13.5% |
| MH-231-114 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 341.65 | 386.83 | +13.2% |
| MH-231-3 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 547.62 | 619.15 | +13.1% |
| MH-231-1 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 316.08 | 356.35 | +12.7% |
| MH-231-212 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 501.03 | 563.59 | +12.5% |
| MH-231-34 | Supplying and installing elastomeric closed-cell insulation with fibreglass clot | Rft | 296.47 | 332.97 | +12.3% |
| FIN-WPF-001 | Providing and applying one layer 4-thick APP modified bitumen membrane, torch-ap | Sft | 176.9 | 195.84 | +10.7% |
| MX-1208 | Supplying, installing, testing and commissioning 8-port POE / core network switc | Nos | 22,990.83 | 20,942.35 | -8.9% |
| MX-1202 | Supplying, installing and commissioning Cat-6 UTP uplink cable on tray / in cond | Rft | 165 | 178.26 | +8.0% |
| CV-121 | Road base of graded crushed aggregate in 6" layers, watered and compacted, compl | Cft | 316.17 | 291.1 | -7.9% |
| MX-1217 | Providing FCU control wiring with Cat-6 UTP in 1" PVC / flexible conduit or on t | Point | 6,721.28 | 7,251.68 | +7.9% |
| FN-530 | Apply wall putty two coats, rubbed to a smooth even surface | Sft | 36.12 | 33.52 | -7.2% |
| MX-1201 | Providing camera point wiring, Cat-6 UTP in 1" PVC conduit from RJ45 outlet to p | Point | 11,272.95 | 12,068.55 | +7.1% |
| MX-1216 | Providing data / telephone outlet wiring, Cat-6 UTP in 1" PVC conduit to patch p | Point | 11,272.95 | 12,068.55 | +7.1% |
| MF-408A | Providing, installing, testing and commissioning zone check assembly 4" (alarm v | Nos | 272,960.55 | 255,354.95 | -6.4% |
| MP-202A | Providing and laying Armaflex insulation on 25 mm hot water pipe, complete in al | Rft | 580.69 | 616.42 | +6.2% |

All 155 items are in the page's own Rate Analysis view (QS Cost Control → Rate Analysis).

## How to re-run

```
tools/grn_register.py "Material Received at Store NN.xlsx"      # new receipts only; --dry-run to preview
node tools/grn_rates.js                                          # Rate Database from the latest GRN (+ ALIASES)
tools/grn_items_data.py                                          # the raGrnItems block (rebuilds the same block)
python3 -m unittest tools/test_grn_latest_data.py tools/test_grn_items_data.py
node tools/test_grn_items.js && node tools/test_price_trends.js
```

A saved library takes a new GRN rate only while the line still holds a value published earlier, and the new items and lines are added to it; a rate typed in by hand is kept.

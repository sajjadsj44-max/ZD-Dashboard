# Rate research request for Claude chat — 3 parts

Paste the **common rules** plus **one part** into each Claude chat conversation (3 separate chats keep
each answer complete). Ask each chat for an Excel file, then upload all 3 files to Claude Code.

---

## COMMON RULES (paste at the top of every part)

```
I am a quantity surveyor in Lahore, Pakistan. Search the web deeply and fill an Excel workbook with
CURRENT market rates for the items listed below. Today is 26-Sep-2026.

RULES
1. Prefer Lahore rates dated within the last 30 days (Aug–Sep 2026). If none, use the latest
   Pakistan rate you can find and say so. Never invent or estimate a rate — if you cannot find a dated
   source, leave Rate blank and write "not found" in Notes.
2. Every rate needs: source name, full URL, and the date shown on that page (DD-Mon-YYYY).
   If the page has no date, write "undated" and the date you searched.
3. Give the low–high range seen and the rate you recommend (normally the mid of the standard band).
4. Units: feet-based only — Sft, Cft, Rft, Nos, Kg, Ton, Day, Ltr, Bag, Sheet, Set. Convert any metre /
   m² / m³ / mm price to feet units and show the conversion in Notes (1 m² = 10.7639 Sft,
   1 m³ = 35.3147 Cft, 1 m = 3.2808 Rft). Rebar / cable sizes may stay in mm / mm².
5. Say what the rate covers: "supply only", "supply + install", "labour only", or "hire per day
   incl. operator & fuel", and whether GST is included.
6. Check at least 2 sources where possible and list the second one in the "Cross-check" column.
7. Open supplier price lists, dealer pages, OLX/Daraz listings, manufacturer PDFs, government
   schedules (Punjab Finance Department MRS, PPRA tenders) — not just blog summaries.

EXCEL FORMAT (one sheet named "Rates", no blank rows, one row per item)
Code | Item | Specification searched | Unit | Rate PKR (recommended) | Low | High |
Rate covers (supply / supply+install / labour / hire) | GST incl? | Source name | Source URL |
Source date (DD-Mon-YYYY) | Cross-check source + URL + rate | Notes / conversion

Keep my Code column exactly as given.
```

---

## PART 1 — Core inputs, labour and plant (paste after the common rules)

```
PART 1: base material, labour and plant rates, Lahore

A. Core materials (confirm current Lahore rate)
CEM Cement OPC 50 kg bag (Lucky, Maple Leaf, DG, Bestway, Fauji, Flying) | Bag
SAND-CH Chenab sand | Cft
SAND-RV Ravi sand | Cft
CRSH-SG Sargodha crush 1/2" & 3/8" | Cft
GRAVEL-SB Sub-base gravel / crush 1.5"–2" | Cft
STL60 Deformed steel bar Grade 60 (Amreli, Mughal, Ittefaq, FF) | Kg
STL72 Deformed steel bar Grade 72 | Kg
BRK-1 1st class (A-class) brick 9"x4.5"x3" | Nos
BRK-2 2nd class (B-class) brick | Nos
BLK-S4 / BLK-S6 / BLK-S8 Solid concrete block 4", 6", 8" x 8" x 12" | Nos
BLK-H4 / BLK-H6 / BLK-H8 Hollow concrete block 4", 6", 8" x 8" x 16" | Nos
RMC-LEAN, RMC-2500, RMC-3000, RMC-3500, RMC-4000, RMC-4500, RMC-5000, RMC-6000 Ready-mix concrete
  delivered Lahore, per psi grade (convert per m³ to per Cft) | Cft
P-PUMP Concrete pump charges | Cft
FLYASH Fly ash Class F bulk for concrete | Kg
ADMIX-SP Superplasticizer (FosPak SP 568 / Sika ViscoCrete / equal) | Kg
ADMIX-WP Water-proofing admixture (FosPak WP-400 / equal) | Ltr
WATER Construction water by tanker (per 1,000 gallons → per Cft) | Cft
QE-PLY-SH Shuttering plywood 1/2" 8x4 ft sheet | Sheet
QE-TIMB-CFT Shuttering timber / battens (kail / partal) | Cft
PROPS Steel props / shuttering hire | Sft per use or per prop per month
MOULD Shuttering release (mould) oil | Ltr
NAILS MS wire nails 2" | Kg
BWIRE Binding wire 20 SWG | Kg

B. Labour — daily wage in Lahore, Sep 2026 (per 8-hour day)
L-HELPER Helper / mazdoor (also note Punjab minimum wage 2026-27 notification)
L-MASON Mason (raj mistri) — concrete / brickwork
L-PLMASON Plaster / finishing mason
L-CARP Shuttering carpenter
L-STEEL Steel fixer
L-TILE Tile / marble fixer
L-PAINT Painter
L-ELEC Electrician
L-PLUMB Plumber
L-HVAC HVAC technician
L-OPER Machine operator
L-FORE Foreman / supervisor
L-WELD Welder / steel fabricator
Also: piece-rate (thekedar) labour rates in Lahore per Sft for plaster, tiling, painting, brickwork per cft,
and grey-structure labour per Sft of covered area.

C. Plant hire, Lahore (per day incl. operator & fuel unless stated)
P-EXCAV Excavator PC200 class (also per hour) | Day
P-MIXER Concrete mixer 1 bag | Day
P-VIBR Needle vibrator | Day
P-COMP Plate compactor | Day
P-ROLLER Vibratory road roller | Day
P-CUTTER Tile / marble cutting machine | Day
P-BENDER Bar bending & cutting machine | Day
P-GEN Generator 5 kVA | Day
P-HOIST Material hoist | Day
P-CRADLE Suspended façade cradle | Day or month
P-BREAKER Electric / pneumatic breaker (jack hammer) | Day
P-DEWATER Dewatering pump set | Day
P-SCAFF Pipe scaffolding hire | per Sft of elevation per month
P-HAUL Tractor-trolley / dumper for malba and surplus earth | per trip (give trip volume in Cft and lead)

D. Government schedule
Find and give me the download link for the Punjab Finance Department "Market Rates System (MRS)
2nd Bi-Annual 2026" (01-Jul-2026 to 31-Dec-2026), District LAHORE (and Rawalpindi if Lahore is not
published). Also the KPK MRS 2026 2nd Bi-Annual if published.
```

---

## PART 2 — Civil items still priced on assumption (paste after the common rules)

```
PART 2: civil items, Lahore — give an all-in "supply + install" rate AND, where you can, the main
material price separately (e.g. board price per sheet, block price per Nos) in the Notes column.

GYPSUM (highest priority — no price found yet)
QE-GYP-BD12 Gypsum board 1/2" (12.5 mm) 8x4 ft tapered edge (Gyproc, Knauf, Boral, United Gypsum) | Sheet
QE-GYP-MC GI main (carrying) channel for suspended ceiling | Rft
QE-GYP-FC GI furring channel | Rft
QE-GYP-WA GI perimeter / wall angle | Rft
QE-GYP-CON Main-to-furring connector clip | Nos
QE-GYP-HNG Hanger bracket / soffit cleat | Nos
QE-GYP-TAPE Joint tape (paper / fibre mesh) | Rft
QE-GYP-JC Jointing compound | Kg
QE-GYP-STUD GI stud for drywall partition | Rft
QE-GYP-TRK GI track (runner) for drywall partition | Rft
QE-INS-RW Rock-wool / mineral-wool infill for partitions | Sft
FN-550 Gypsum board false ceiling, installed rate | Sft
QS-GYP-P01 Drywall partition, board both sides, installed rate | Sft
CV-113 Gypsum bulkhead up to 2 ft girth | Rft
CV-111 Vinyl-faced gypsum ceiling tile 2'x2' on exposed grid | Sft
MINCEIL Mineral-fibre ceiling tile 2'x2' with T-grid | Sft
CV-112 Metal linear (aluminium) ceiling | Sft

SITE / EARTHWORK
CV-005 Carting away malba off site, Lahore (per Cft, state lead) | Cft
CV-009 Disposal of surplus earth off site | Cft
CV-006 Temporary site hoarding 8 ft high (GI sheet on steel frame) | Rft
CV-007 Setting out and survey with total station (building) | Job / per day
CV-010 Dewatering (pump set + operator + fuel) | Day
CV-011 Shoring / sheet piling for basement | Sft
TOPSOIL Topsoil / sweet earth for lawns (per trolley → per Cft) | Cft

CONCRETE / FORMWORK / STEEL
CV-024 Power-trowel floor with dry-shake hardener (also hardener price per kg / bag) | Sft
CV-028 Circular column formwork | Sft
CV-029 Steel panel formwork hire | Sft
CV-030 Fair-face formwork with film-faced plywood (also film-faced ply sheet price) | Sft
CV-031 Welded wire mesh / reinforcement fabric (per Kg or per sheet with weight) | Kg
CV-032 Mechanical rebar coupler, installed (by bar size) | Nos
CV-033 Chemical rebar dowel with Hilti RE-500 / equal (also cartridge price) | Nos
CV-115 Structural steel sections: MS angle, channel, I-beam/girder, plate price per Kg,
       and fabrication + erection labour per Kg | Kg

MASONRY / WATERPROOFING / PLASTER
CV-040 AAC block (size, price per block, per Cft) + thin-bed adhesive per bag | Cft
CV-049 PU liquid waterproofing membrane, 2 coats, applied | Sft
CV-050 Basement tanking: bitumen membrane 4 mm + primer + protection board | Sft
WPROOF Torch-applied bitumen membrane 4 mm (material only) | Sft
DPC-BIT Bitumen 60/70 for DPC | Kg
CV-056 Crack injection grouting PU / epoxy | Rft
CV-065 Gypsum plaster ready-mix (bag price + coverage) | Sft
CV-066 Scaffolding on elevation | Sft
CV-070 Self-levelling screed (bag price + coverage) | Sft
WSTOP PVC water stopper 6" / 9" | Rft
SEALANT Silicone / PU sealant 300 ml tube | Nos

FLOORING / FINISHES
CV-078 Terracotta floor tiles | Sft
GRANITE Granite slab (local: Sunny Grey, Tiger Skin, Black Galaxy imported) | Sft
MARBLE Marble (Ziarat White, Botticino, Verona) | Sft
TILE-POR / TILE-CER Porcelain and ceramic tiles, local brands (Master, Stile, Shabbir) | Sft
TILEADH Tile adhesive 20 kg bag | Bag
GROUT Tile grout 1 kg | Kg
QE-TSPACER Tile spacers 2 mm pack | pack (Nos per pack)
CV-103 PU wood polish / lacquer, multi-coat | Sft
CV-106 Epoxy paint 2 coats | Sft
QE-PNT-WS Weather-shield exterior emulsion (Berger, Diamond, Brighto, ICI Dulux) | Ltr
QE-PNT-EMU Matt emulsion | Ltr
QE-PNT-PRM Wall primer | Ltr
QE-PNT-PUT Wall putty | Kg

DOORS / WINDOWS / JOINERY / FAÇADE
DOOR-W Wooden flush door shutter (per Sft) | Sft
DOOR-HW Door hardware set (lock, 3 hinges, stopper, handle) | Set
Deodar wood price per Cft (Lahore timber market) | Cft
CV-094 Built-in wardrobe MDF / laminate (per Rft or per Sft of front) | Rft
CV-095 Kitchen cabinets MDF / laminate (per Rft) | Rft
CV-096 Bathroom vanity with top | Nos
CV-098 Aluminium / glass curtain wall | Sft
CV-099 ACP cladding with framing | Sft
GLASS-12 12 mm toughened glass (per Sft) and patch fittings set | Sft
SS-RAIL SS 304 handrail / balustrade | Rft
CV-116 MS cat ladder | Rft

EXTERNAL WORKS
CV-118 Boundary wall 9" brick, plastered both sides, per Sft of elevation | Sft
CV-122 Asphalt carpet 2" (also asphalt per ton) | Sft
CV-123 RCC road 6" | Sft
CV-124 Septic tank for 8–10 users | Nos
CV-125 Soakage pit | Nos
CV-127 Storm-water drain (masonry / RCC) | Rft
CV-129 Masonry planter | Nos
Kerb stone precast (per piece, size) | Nos
Tuff paver 60 mm and 80 mm grey and coloured | Sft

REPAIR
CV-R01 Crack treatment (chase, fill, sealant, mesh) | Rft
CV-R02 Epoxy injection crack repair | Rft
```

---

## PART 3 — MEP materials still at 0 or assumption (paste after the common rules)

```
PART 3: MEP material prices, Lahore (supply only unless stated). Brands: Pakistan Cables, Fast,
Newage for cable; Dadex, Beta, Popular for pipe; Master / Porta / Faisal for sanitary.

ASSUMED MEP LINES
COND-PVC PVC conduit 3/4" with accessories | Rft
SOCKET 13 A socket with plate | Nos
SWITCH Switch with plate | Nos
DB-BOARD Distribution board with MCBs | Nos
CTRAY GI cable tray with supports | Rft
EARTH Earth pit complete | Nos
PPRC PPRC pipe with fittings | Rft
UPVC-D uPVC drainage pipe with fittings | Rft
SAN-WC WC suite complete | Set
SAN-WB Wash basin complete | Set
FIRE-PIPE MS fire-fighting pipe with fittings | Rft
SPRINK Sprinkler head | Nos
DUCT-GI GI duct with insulation | Sft
FCU Fan coil unit | Nos

UNPRICED MEP MATERIALS (rate 0 now)
MEP-Z-2C4 Cable 2C × 4 mm² Cu/PVC/PVC | Rft
MEP-Z-3C16 Cable 3C × 16 mm² Cu/PVC/PVC | Rft
MEP-Z-3C4 Cable 3C × 4 mm² Cu/PVC/PVC | Rft
MEP-Z-AAV Automatic air vent | Nos
MEP-Z-ABL Ablution tap mixer | Nos
MEP-Z-ALF Washable aluminium filter 2" | Sft
MEP-Z-ARMAW Armawave pipe sound insulation 4" | Rft
MEP-Z-BELL Door bell | Nos
MEP-Z-BFAN Wall bracket fan 18" | Nos
MEP-Z-BOOST HDTV booster | Nos
MEP-Z-BULK LED bulkhead light 10 W | Nos
MEP-Z-BV050 Ball valve 1/2" | Nos
MEP-Z-BV125 Ball valve 1-1/4" | Nos
MEP-Z-BV150 Ball valve 1-1/2" | Nos
MEP-Z-CAM4 Outdoor IP camera 4 MP | Nos
MEP-Z-COND6 PVC conduit 6" heavy duty | Rft
MEP-Z-CT4 GI perforated cable tray 4" × 3" | Rft
MEP-Z-CUSTRIP Copper tape 30 × 2 with clips | Rft
MEP-Z-DCOCK Drain cock 1" | Nos
MEP-Z-DIFF Aluminium air diffuser | Sft
MEP-Z-DL20 LED recessed downlight 20 W | Nos
MEP-Z-DLSQ LED square downlight 3 × 10 W | Nos
MEP-Z-DND DND / PCU panel set | Set
MEP-Z-EXT Portable fire extinguisher DCP / CO2 | Nos
MEP-Z-EXTC Ceiling-hanging automatic extinguisher | Nos
MEP-Z-FDC Flexible duct connector | Rft
MEP-Z-FOB MS floor outlet box 16 SWG | Nos
MEP-Z-FX075 / FX100 / FX125 / FX150 / FX200 Insulated flexible pipe connector 3/4", 1", 1-1/4",
  1-1/2", 2", 4 ft long | Nos
MEP-Z-GI1 GI pipe 1" with fittings | Rft
MEP-Z-GI2 GI pipe 2" with fittings | Rft
MEP-Z-GTRAP Stainless steel grease trap | Nos
MEP-Z-GV075 Bronze gate valve 3/4" | Nos
MEP-Z-GV10 Flanged gate valve 10" | Nos
MEP-Z-GV125 Gate valve 1-1/4" | Nos
MEP-Z-GV8 Flanged gate valve 8" | Nos
MEP-Z-IPS32 Industrial socket 5-pin 32 A with plug | Nos
MEP-Z-KEYCARD RFID key-card switch | Nos
MEP-Z-MAST GI mast pipe 1-1/2" for ESE lightning arrester | Nos
MEP-Z-MAT Insulation rubber mat 3.5 mm | Sft
MEP-Z-MESH Wire mesh | Sft
MEP-Z-MIRROR Looking glass (mirror) 5 mm | Sft
MEP-Z-MS075 / MS8 / MS10 / MS12 MS Sch-40 pipe 3/4", 8", 10", 12" | Rft
MEP-Z-MV075 / MV100 / MV125 / MV150 / MV200 Motorised 2-way valve 3/4"–2" | Nos
MEP-Z-NBR13 Elastomeric insulation sheet 1/2" | Sft
MEP-Z-PCORD Cat-6 patch cord 1 m | Nos
MEP-Z-PE6 Polyethylene insulation 1/4" with GI tape | Rft
MEP-Z-PICV075 / PICV100 / PICV125 / PICV150 / PICV200 PICV valve 3/4"–2" | Nos
MEP-Z-PP8 / PP24 / PP32 Cat-6 patch panel 8, 24, 32 port | Nos
MEP-Z-PPR75 PPR PN20 pipe 75 mm | Rft
MEP-Z-PRV32 / PRV50 / PRV63 PRV assembly 32, 50, 63 mm | Nos
MEP-Z-RACK12 / RACK24 / RACK42 Data cabinet 12U, 24U, 42U | Nos
MEP-Z-RLG Return linear grille | Rft
MEP-Z-ROPE LED rope light | Rft
MEP-Z-SHAVER Shaver socket | Nos
MEP-Z-SINK Kitchen sink | Nos
MEP-Z-SOAPD Soap dispenser | Nos
MEP-Z-SPK20 Wall speaker 20 W | Nos
MEP-Z-SPK6 Ceiling speaker 6 W | Nos
MEP-Z-SPLIT MATV splitter | Nos
MEP-Z-SPRSW Sidewall sprinkler K5.6 | Nos
MEP-Z-STRIP LED flexible strip light IP65 | Rft
MEP-Z-SW32 POE switch 32-port | Nos
MEP-Z-TAP Tap 3/4" | Nos
MEP-Z-UE1 / UE2 / UE3 uPVC Class E pipe 1", 2", 3" | Rft
MEP-Z-UPVC12 uPVC pipe 12" | Rft
MEP-Z-VOLC Volume controller | Nos
MEP-Z-WAP Wireless access point | Nos
MEP-Z-WASH LED linear wall washer 48 W | Nos
MEP-Z-WPSKT Weather-proof 13 A socket | Nos
MEP-Z-YS075 / YS100 / YS125 / YS150 / YS200 Y-strainer threaded 3/4"–2" | Nos

(Where a code covers several sizes, give one row per size and keep the code, e.g. MEP-Z-FX100.)
```

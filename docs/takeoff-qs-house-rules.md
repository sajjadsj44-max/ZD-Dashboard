# PDF Takeoff — QS house rules (learned from Bluebeam takeoffs)

How the quantities are taken by hand in the marked-up Bluebeam drawings of past bills, and what Auto area and the
🧱 Block masonry agent now do to match. Measured against those drawings on this PC only; the drawings themselves are
never committed. The rules are tested on hand-written drawings in `tools/test_takeoff_qsrules.js`.

## Floor finish (tiles, skirting)

| By hand | Auto area |
|---|---|
| Each room clear inside its walls; columns notched out | as before (wall faces, columns) |
| Bath taken separately; the **shower and its 4" kerb / screen partition are part of the bath** | **new:** in a room named BATH / TOILET / W.C. / WASH / POWDER, a small closed space behind a thin line or a partition up to 4½" with a fitting drawn in it (floor trap, `SH.`) is taken in |
| A cupboard / duct behind the bath wall stays out | an empty space, a duct or a named space is never taken in |
| The room's own entry passage (to its door) is part of the room | **new:** a closed, unnamed space up to 4'-6" wide and under 60 Sft, shut off by its door, is taken in even when wider than the door gap |
| Wardrobe recesses are left out | a recess under 2'-9" is never taken in as a passage |
| Door thresholds of the doors opening into the room are included up to the far wall face | not yet — the outline stops at the door line (about 2 % per room) |
| Skirting = room perimeter × 0.46 ft, less 2.5 ft per bath door (D3) and 4.83 ft per room door + jambs (D1) | the perimeter is on every area; count the D1 / D3 tags with the Doors / windows agent for the deductions |

### Apartment floor tile (Zameen Quadrangle, "Floor Area as per Drawing", 10 floors, 698 polygons)

| By hand | Auto area / agent |
|---|---|
| Baths are never in floor tile — they are bath / wash floor tile | **new:** a *Floor tile* item's "measure all rooms" leaves wet rooms out; a *Bath floor tile* item takes them only |
| Balconies are their own polygons (balcony tile) | left out of floor tile; a *Balcony tile* item takes balconies / terraces only |
| Wardrobes are left out; the passage beside them to the balcony door is in | **fixed:** labels written up the page (WARD., WARDROBE) are placed where they are drawn, so the wardrobe stays out and the passage is no longer rejected as "taking in the wardrobe" |
| The floor runs to the door, into the door's bay | **new:** a doorway's bay is kept (setting `thresh`, on by default) |
| Lounge + kitchen as one polygon (open kitchen), bedroom + dress as one | measured as two outlines — the total is the same |
| Door thresholds as small separate pieces (5–12 Sft) | not automatic — the bay rule above takes part of them into the room |

4th & 5th floor, single rooms: −11 % → −7.7 % against the hand polygons; no change on the Mall-35 checks.

## Ceiling / paint

| By hand | Auto area |
|---|---|
| Room ceilings to the wall faces; an open kitchen with its lounge | as before (a counter line may still split them — click both) |
| Wardrobe ceiling, bath ceiling, balcony ceiling and corridor as their own items | named spaces stop each other; corridors trace as one space |
| Gypsum ceiling only where drawn (bulkheads, passages) — follows the ceiling lines, not walls | not an Auto area case: draw it |

## Block masonry (🧱 Block masonry agent)

| By hand (Working.xlsx) | Agent |
|---|---|
| Runs on the wall centre line by block: 4" → 4"×8"×12", 8" external (outside / balcony / courtyard / look-below void on one side) → 8"×8"×16", 8" internal → 8"×8"×12" | the same split, from the drawing's face lines; each run marked AI to check |
| Runs carry on through openings; stop at columns; RCC lift / stair walls and balcony parapets are not block work | runs bridged through openings, cut where the band has concrete hatch, parapets (outside both sides) dropped |
| Walls = Nos × L × thickness (0.33 / 0.67) × (floor to floor − slab) = 12 − 0.625 = 11.375 ft | the same, H from the dialog |
| Doors: −count × width × thickness × 7 ft on the wall they are in (D1 4.0, D1a 4.17, D2 3.5, D3 3.0, D4 2.5) | each tag placed as an opening on its nearest run, sizes from the schedule or the house sizes (to check) |
| Windows: −width × 8.5 ft; ventilators (V1) 2 × 5 | from the schedule or typed in the dialog |
| Beam d/d: −beam length × thickness × (21 − 7.5) / 12 | beam lengths per block given in the dialog |
| Blocks = cft × 0.9 ÷ (0.33 × 0.67 × 1), (0.67 × 0.67 × 1), (0.67 × 0.67 × 1.33) | the same |
| Wardrobe pad: + length × 0.33 | add as its own row |

First-floor check (Recon block work, 4" / 8"×8"×12" / 8"×8"×16"): runs found 1,176 / 512 / 681 ft on the hand-measured
1,285 / 668 / 990 ft; door deductions on the same walls as by hand. Review the external / internal split before billing.

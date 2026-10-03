# PDF Takeoff — QA audit report, 02-Oct-2026

Full audit of `takeoff/` (PDF Takeoff): features added first, then every area of the 28-section QA brief tested in a real browser, every P0 / P1 / P2 bug found fixed and re-tested, P3 where practical. Branch `ccr-5548ef6f-qnqhta`.

**How it was tested.** `tools/test_takeoff_qa.js` drives the app in Chromium (Playwright, headless, 1440 × 900) with pdf.js 4.10.38, ExcelJS and pdf-lib served from local copies of the CDN files. Every quantity is checked against a hand-worked figure from the fixture's own geometry (`tools/takeoff_qa_fixture.js`), never against the app's own formulas:

- **8-page QA set** — p.1 a house at 1/4" = 1'-0" (9 rooms, total 1,268.250 Sft; 9" outer wall, 4.5" partitions, D1 × 7, D2 × 2, W1 × 5, W2 × 3, furniture, room sizes written); p.2 turned 90° by the PDF; p.3 an offset page box; p.4 blank; p.5 1:50 metric note; p.6 3/16" with a DETAIL at 1-1/2"; p.7 a tiled room, a 45° room, a round room and an L room; p.8 A4 with no scale note.
- **120-page PDF**, a **200 dpi scanned sheet** (raster only — no lines, no text), a **150,000-line CAD sheet**, an **AES-128 password-protected PDF**, empty / truncated / non-PDF files.
- The original suite `tools/test_takeoff.js` (3-page fixture) was re-run after every fix.

Units throughout: decimal feet (3 dp), Sft, cft, Nos. Scale factors are in PDF points (1 pt = 1/72 inch on paper) per foot.

## Features added before testing

- **Pages tab** — thumbnails of every page of every PDF (drawn as they scroll into view), scale status and measurement count per page, **Remove PDF** (backup first).
- **View menu** — fit page (`F`), **fit width** (`Shift+F`), dimmer, line weights, PDF layers, hide markups, labels; `Home` / `End` first / last page.
- **Chosen scale** — architectural / engineering / metric ratio lists, typed scale, and the paper size it was drawn for (ISO, ARCH, ANSI) to correct reduced prints; shown as *chosen — not verified*.
- **Password-protected PDFs**, flattened PDF export for locked / turned pages.
- **Ctrl+S**, save on close / hide, **two-tab warning**, project-file **repair on import**.
- **Self-crossing outline** check; quantities to **3 dp** (Nos whole) on screen, CSV and Excel.
- **Auto area** for corridors / passages, angled, round, tiled and L rooms and scans; **walls agent** across corridors and + junctions; **scale check against the room sizes written on the drawing**.

## A. Test summary

| | Result |
|---|---|
| QA audit checks (`test_takeoff_qa.js`) | **406 passed, 0 failed** |
| of which calculation checks | 157 passed, 0 failed |
| performance timings | 33 within limit, 0 over |
| original suite (`test_takeoff.js`) | 150 / 150 |
| page errors / console errors during the run | none |

| QA brief area | Suite section | Passed | Failed |
|---|---|---:|---:|
| PDF loading, rendering, navigation | 1. PDF loading, pages, view | 24 | 0 |
| PDF loading; edge cases | 2. Bad, locked and odd PDFs | 17 | 0 |
| Scale (zoom never changes a quantity) | 3. Scale — notes, chosen, calibrated, per page, zoom | 78 | 0 |
| Single-click area | 4. Single-click area (Auto area) | 35 | 0 |
| Single-click area; calculation | 4b. Free agents, scale check against room sizes, viewport, turned page | 24 | 0 |
| Data accuracy; layers | 5. Data integrity and conditions (layers) | 15 | 0 |
| Editing | 6. Editing stress — 60 measurements, 80 random edits, undo all, redo all | 5 | 0 |
| Markups | 7. Markups (note, cloud, arrow, highlight) | 11 | 0 |
| OCR / text | 8. PDF text — find, room names, door / window tags | 4 | 0 |
| Overlay compare | 9. Overlay compare | 3 | 0 |
| Page management | 10. Page management — add / remove PDFs, measurements stay on their page | 8 | 0 |
| QS workflow | 11. QS workflow — the house: floors, ceilings, skirting, walls, openings, doors, windows | 16 | 0 |
| BOQ register | 12. Measurement sheet / register | 6 | 0 |
| Export / import | 13. Export → import round trip (Excel, CSV, PDF, PNG, JSON) | 25 | 0 |
| Save / recovery | 14. Save, auto-save, recovery, two tabs | 6 | 0 |
| Undo / redo master test | 15. Undo / redo master test | 9 | 0 |
| Performance / stress | 16. Performance and stress | 16 | 0 |
| Edge cases | 17. Edge cases | 19 | 0 |
| UI / UX | 18. UI — every control on screen, menus, dialogs, phone width | 9 | 0 |
| Keyboard / mouse | 19. Keyboard and mouse | 16 | 0 |
| Data validation | 20. Input validation — no NaN, Infinity or undefined quantities | 12 | 0 |
| Calculation validation | 21. Calculation validation (independent of the app's formulas) | 24 | 0 |
| Security | 22. Security and data integrity | 5 | 0 |
| Performance; edge cases | 23. Scanned drawing (raster, no lines, no text) and a 150,000-line CAD sheet | 19 | 0 |
| | **Total** | **406** | **0** |

The other areas of the brief: **inventory** — the whole source (`takeoff.js`, ~5,200 lines, and `index.html`) was read before testing and the feature list is in the README; **code quality** — no page or console errors in either suite, syntax checked after every change, attempts that did not work were reverted rather than left in; **regression** — the original suite was re-run after every fix and the full QA suite at the end, on the final code.

**Not tested** (with reason):

- **NOT TESTED — OCR of scanned drawings**: not in the app (PDF text only); scanned pages measure but have no text — listed in the parity notes
- **NOT TESTED — Reorder / duplicate / rotate / delete single pages of a PDF**: not in the app: the PDF is the drawing as issued; pages are viewed as they are (turned pages shown turned, as the PDF says)
- **NOT TESTED — Sort / search / pagination of the measurement sheet**: not in the app: the sheet is grouped by condition in drawing order (house format); QA filters and Find text cover lookup
- **NOT TESTED — Claude API agent (the 🤖 Claude panel's model calls)**: needs an Anthropic API key; the free (no-key) agents — rooms, walls, doors / windows, scale check — were tested
- **NOT TESTED — Firefox, Safari**: only Chromium is installed on the test machine (Edge is Chromium-based)
- **NOT TESTED — Touch / pinch zoom / press-and-hold on a tablet**: no touch device; mouse, wheel and keyboard tested
- **NOT TESTED — Real project drawings (Revit / AutoCAD exports)**: none available on the test machine — hand-built fixtures with known answers were used; first item of the retest checklist
- **NOT TESTED — Browser storage quota (very large PDFs filling IndexedDB)**: quota depends on the user's disk; a 120-page PDF and 1,000+ measurements were tested

## B. Bug register

Severity: P0 Critical (silently wrong quantities, lost work or a security hole), P1 High, P2 Medium, P3 Low. All found bugs below are **fixed** and re-tested.

| ID | Feature | Bug | Severity | Root cause | Fix applied | Retested |
|---|---|---|---|---|---|---|
| B01 | Page navigation | Two page changes overlapping (PgDn twice, a sheet row clicked while a page loads) could give one page's key the other page's drawing — the page got the wrong scale note and lines (seen: p.2 `1:100 @ A1` read as `1/8"`). | P0 Critical | `gotoPage` rendered and indexed asynchronously with no check that it was still the latest change; `S.page` and `S.key` were set at different times. | Sequence guard (`S.navSeq`): only the latest change is applied; page and key set together; the low-res render is committed only if the page has not changed; text indexing keeps its own file id. | Yes — §1 rapid PgDn / PgUp, §10, original suite |
| B02 | Security / import | A condition colour in an imported project file was written straight into the drawing's SVG — a crafted file ran script in the page. | P0 Critical | No validation of imported fields; colour interpolated into markup. | `migrate()` checks every imported field: colour must be `#rgb` / `#rrggbb`, type / unit / numbers / points validated; anything bad is repaired or left out and listed as *Repaired* in the import report. | Yes — §22 (script in colour, name, note), §13 |
| B03 | Scale notes | `1-1/2" = 1'-0"` (and `1 1/2"`) was read as `1/2"` — every length on the sheet 3 × too long. | P0 Critical | The fraction pattern took the last fraction and dropped the whole number. | Whole-dash-fraction and whole-space-fraction read first; vulgar fractions (¼ ½ ¾ ⅛ …) read. | Yes — §3 (24 scale notes), §4b (DETAIL at 1-1/2" inside a 3/16" sheet) |
| B04 | Save | A change made within 300 ms of closing or reloading the tab was lost. | P0 Critical | Saves are debounced 300 ms; nothing flushed the pending save when the page went away. | Pending save written on `pagehide`, `visibilitychange → hidden`, `beforeunload`, before another project opens, and on `Ctrl+S` (now saves at once). | Yes — §14 (a measurement made 30 ms before a reload is kept; Ctrl+S) |
| B05 | Save / two tabs | The same project open in two tabs: each tab silently overwrote the other's saves. | P1 High | No coordination between tabs. | BroadcastChannel: both tabs show a warning, with *Reload this one*; every save is announced. | Yes — §14 (second tab) |
| B06 | Import | Broken points, bad units or non-numbers in a project file crashed the measurement sheet. | P1 High | Imported items were trusted. | Same `migrate()` repair as B02; repairs toasted on open and listed on import. | Yes — §13, §22 |
| B07 | PDF opening | A password-protected PDF could not be opened (error only). | P1 High | No password handling in `getDocument`. | Password prompt (retry on a wrong password, cancel); password kept with the PDF in this browser so it reopens. | Yes — §2 (AES-128 locked PDF, wrong then right password) |
| B08 | Export PDF | Marked-up PDF of an encrypted drawing: the page content was copied still encrypted (blank page). | P1 High | pdf-lib copies encrypted streams as they are. | Encrypted (and rotated) pages are flattened to an image with the markups drawn on. | Yes — §2 (export of the locked page opens with no password), §4b (turned page upright) |
| B09 | Auto area | A room traced on one page could be dropped onto another page if the page changed during the trace. | P1 High | No check after the asynchronous trace. | `S.autoBusy` + the page key is re-checked after the trace; a second click while busy is ignored. | Yes — §4 (page changed during a trace: nothing added; traced again on its page) |
| B10 | UI header | At 1280–1366 px the top bar pushed the scale chip, Undo / Redo and Export off-screen. | P1 High | Fixed-height, no-wrap header. | Header wraps (`--hh` follows its height); view toggles grouped under a **View** menu. | Yes — §18 (1280 / 1366 / 1920 px, phone 390 px) |
| B11 | Auto area | A 4 ft corridor with its entrance leaked into the next rooms (door gap never closed). | P1 High | Wall faces grouped in 0.5° bins took the bin's direction: a vertical wall came out 0.22° off, so two pieces of one face never lined up across the opening. | Face groups keep their own direction (snapped to 90° only when within 0.25°); the door-closing lines are also snap targets. | Yes — §4 CORRIDOR 123.000 Sft exact |
| B12 | Auto area | Round rooms and curved walls had no wall at all — every curve was dropped as a door swing. | P1 High | All curves treated as swings. | Only a swing-like arc (35–120°, radius 1.2–6.5 ft, hinge at a line end) is ignored; a round room is fitted as a circle. | Yes — §4 round room 113.13 vs 113.10 Sft |
| B13 | Auto area | Floor tile grids / stair treads were taken as walls: a tiled room closed on a tile line. | P1 High | Every line was a barrier. | Runs of 5+ evenly spaced parallel lines are hatching, not walls; the end lines stay walls when the wall's other face runs beside them. | Yes — §4 tiled room 100.000 Sft |
| B14 | Calculation | A self-crossing outline (figure-of-eight) was accepted and its area silently wrong. | P1 High | No check. | Self-crossing outlines flagged: toast on finish / vertex drag, note on the sheet, ERROR in *Check before export*. | Yes — §17 (figure-of-eight: toast, sheet, export ERROR) |
| B15 | QA sign-off | *Mark Checked* never worked in a browser with no QA name stored. | P1 High | The name dialog returned a plain string, which the dialog code treats as an error message — it never closed. | Returns `{n}`. | Yes — §12 (marked checked, by whom and when) |
| B16 | Count | Find text → *Count all* defaulted to the count condition last used: counting D2 right after D1 put the D2 doors into D1. | P1 High | Default selection. | Defaults to a condition named after the search (reused if one exists). | Yes — §11 (D1, D2, W1, W2 counted one after another, each into its own condition: 7 / 2 / 5 / 3) |
| B17 | PDF text | Foot marks came back as `’` (`12’-0"x12’-0"`), so room sizes written on the drawing were never read — the scale check against room sizes and the agents' size checks did nothing. | P1 High | No quote normalisation of PDF text. | Quote marks normalised when the page text is read. | Yes — §4b |
| B18 | Scale check | Rays from the room name hit door swings and furniture: rooms measured ~6 % small and a wrong `1/8"` note was 'corrected' to 1:50 instead of `1/4"`. | P1 High | One ray each way. | Seven parallel rays each way, the span most agree on; swings ignored; the standard scale most rooms agree with is suggested. | Yes — §4b (wrong note → 1/4" suggested) |
| B19 | Walls agent | A partition was bridged straight across a 4 ft corridor as if it were a door. | P1 High | Gap bridging did not look for walls crossing the gap. | A gap is bridged only if no other wall crosses the wall's band inside it. | Yes — §4b (partitions in the expected number of runs; corridor not bridged) |
| B20 | Walls agent | A window's glass line beside a bed was taken as a 9" wall. | P1 High | Any two parallel lines at wall spacing paired. | A line running on between the two 'faces' rules the pair out. | Yes — §4b (9" wall 150.750 ft, 4.5" partitions 154.250 ft) |
| B21 | Walls agent | At a + junction the crossing walls were both counted through the junction. | P1 High | Overlapping runs. | The shorter run is cut at the longer one's faces. House: 9" outer wall 150.750 ft, 4.5" partitions 154.250 ft. | Yes — §4b (+ junction counted once) |
| B22 | Scale notes | Vulgar fractions (`¼" = 1'-0"`) not read. | P2 Medium | Pattern did not know them. | `vulgar()` before parsing. | Yes — §3 |
| B23 | Input | Metric lengths typed into a length box were not understood. | P2 Medium | `parseFt` knew ft-in only. | Converted to decimal feet (3 dp) on entry. | Yes — §20 (7 length forms) |
| B24 | Dialogs | A dialog opened over another left the first one listening for Enter. | P2 Medium | Handlers not torn down. | Opening a dialog cancels the previous one. | Yes — §19 (dialog over dialog, Esc, then Enter creates nothing) |
| B25 | Register | Quantities shown to 2 dp on screen, CSV and Excel (spec: 3 dp, Nos whole). | P2 Medium | Formatting. | 3 dp everywhere; Excel `#,##0.000` / `#,##0`. | Yes — §12, §13 |
| B26 | Auto area | Round room: the wall's hollow ring was taken in as a furniture pocket. | P2 Medium | Pocket fill did not recognise a ring. | A component spanning ≥ 90 % of the room both ways is never filled. | Yes — §4 |
| B27 | Auto area | Room drawn at 45° came out 102.07 Sft instead of 100. | P2 Medium | Snapping only square to the sheet. | Outlines snap side by side to parallel drawing lines. | Yes — §4 99.973 Sft |
| B28 | Performance | Pointer moves over 1,000 measurements took 36 ms each (whole overlay rebuilt). | P2 Medium | Static takeoff re-drawn on every move. | Overlay split in two: the takeoff layer is rebuilt only when it changes. | Yes — §16 (≈19 ms) |
| B29 | Undo | Undo history had no memory limit. | P2 Medium | Snapshots kept without bound. | 200 steps or ~80 MB of history (never under 20 steps). | Yes — §19 (210 nudges → 200 steps kept), §6 / §15 (undo all, redo all) |
| B30 | Auto area (scan) | On a scanned sheet a corridor clicked off-centre failed (passage as narrow as the door gap). | P2 Medium | Gap closing used the full door gap, which also closes the passage. | Passage detected; smaller gaps tried in turn (0.9 → 0.6 × gap) with a note; a partial result is flagged. | Yes — §23 |
| B31 | Input | Space-pan stuck on after Alt+Tab. | P3 Low | keyup lost on blur. | Window blur resets it. | Yes — §19 (Space held, window blur → released) |
| B32 | Input | Middle-drag started the browser's autoscroll as well as panning. | P3 Low | Default not prevented. | `preventDefault` on middle mousedown. | Yes — §19 (default prevented), §1 (middle-drag pans) |
| B33 | Validation | Nos accepted 99,999,999,999. | P3 Low | No upper limit. | Capped at 100,000 with a message. | Yes — §17 (abc, -5, 0, 2.6, 1e3, 99999999999) |
| B34 | Drawing | An area drawn as a figure of eight with equal halves (net 0 Sft) vanished on Enter with no message. | P3 Low | Zero-area outlines were dropped silently. | Refused with a message saying the outline crosses itself and its halves cancel out; an uneven figure of eight is kept and flagged (B14). | Yes — §17 (both cases) |
| B35 | Auto area (scan) | Scanned sheet, CORRIDOR (a 4 ft passage as wide as the door gap): 128.751 Sft against 123.000 (+4.7 %) — the room grown back through the 3 ft entrance came out past the building's outer face, and the faces beside the entrance sat 0.26 ft inside the wall. | P2 Medium | Gap closing on a raster widens the walls and grows the room back; with the passage barely wider than the gap the regrowth pushed through the opening. The tab trim only took tabs up to 3 ft wide with ink along the cut, and a doorway has none. | A tab whose far side crosses open space and whose two sides run along the jambs is a doorway: closed on the room's face of the wall (up to the door-gap width). On scans, a side lying deep in a wall's ink goes back to its face. Now 123.547–124.721 Sft (+0.4 to +1.4 %, ±1 px a side). | Yes — §23 (tolerance tightened from 6 % to 1.5 %); vector drawings unchanged (§4, original suite) |
| B36 | Performance | Auto area froze the page for the whole trace — about 3 s on the house at 1/4", 3 s+ on a 150,000-line sheet (one unbroken task; clicks, scrolling and the busy note stopped). | P3 Low | The trace ran as one block on the page's main thread; the pocket steps flooded the whole 90 ft window, and pdf.js resumed its 15 ms render chunks at once instead of letting the browser in. | The trace hands the page back to the browser about every 40 ms; the pocket and closing steps work on the room's area only (same result); pdf.js renders resume on the browser's next turn. Longest freeze now 198 ms (house), 229 ms (150,000 lines); a room traces in about 1,148 ms. | Yes — §4 and §23 longest-freeze checks (limit 400 ms); all auto-area areas unchanged |
| B37 | Performance | Opening a 150,000-line sheet froze the page for 0.6–1 s while it was drawn. | P3 Low | pdf.js page renders resumed each 15 ms chunk straight away, so a dense page drew in one block. | Every page render (sheet, detail, thumbnails, compare, exports) resumes on the browser's next turn. Longest freeze opening the sheet now 240 ms. | Yes — §23 (limit 400 ms) |

**Known issues left open:** none.

By design (not a bug): a hidden condition stays in the totals — hiding is a view filter, as in Bluebeam / PlanSwift; the sheet still lists it.

## C. Calculation tests

157 of 157 pass. Expected values are worked by hand from the fixture geometry. *exact* = to 1e-9.

Single-click auto area on the house (p.1, 1/4" = 1'-0"):

| Room | Expected Sft | Got Sft | Time ms |
|---|---:|---:|---:|
| BED ROOM 1 | 144.000 | 144.000 | 1,148 |
| BATH 1 | 72.000 | 72.000 | 1,007 |
| BED ROOM 2 | 144.000 | 144.000 | 1,035 |
| CORRIDOR | 123.000 | 123.000 | 993 |
| LIVING | 257.250 | 257.250 | 972 |
| KITCHEN | 168.000 | 168.000 | 1,185 |
| BED ROOM 3 | 144.000 | 144.000 | 952 |
| BATH 2 | 72.000 | 72.000 | 942 |
| STORE | 144.000 | 144.000 | 976 |
| **Total** | **1,268.250** | **1,268.250** | |

| # | Test | Expected | Actual | Difference | Tolerance | Unit | Result |
|---:|---|---:|---:|---:|---|---|---|
| 1 | turned page: 20'-0" line | 20.000 | 20.000 | 0.000 | ±0.001 | ft | PASS |
| 2 | offset page box: 10'-0" line | 10.000 | 10.000 | 0.000 | ±0.001 | ft | PASS |
| 3 | 1:50 metric page: scale 1 ft (pt) | 17.280 | 17.280 | 0.000 | exact | pt | PASS |
| 4 | 1:50 metric page: line dimensioned 5000 on the metric drawing, in ft | 16.404 | 16.404 | 0.000 | ±0.001 | ft | PASS |
| 5 | scale note “SCALE 1/8" = 1'-0"” → pt per ft | 9.000 | 9.000 | 0.000 | exact | pt | PASS |
| 6 | scale note “SCALE 1/4"=1'-0"” → pt per ft | 18.000 | 18.000 | 0.000 | exact | pt | PASS |
| 7 | scale note “SCALE: 3/16" = 1'-0"” → pt per ft | 13.500 | 13.500 | 0.000 | exact | pt | PASS |
| 8 | scale note “1/2" = 1'-0"” → pt per ft | 36.000 | 36.000 | 0.000 | exact | pt | PASS |
| 9 | scale note “SCALE 1" = 1'-0"” → pt per ft | 72.000 | 72.000 | 0.000 | exact | pt | PASS |
| 10 | scale note “SCALE 3/32" = 1'-0"” → pt per ft | 6.750 | 6.750 | 0.000 | exact | pt | PASS |
| 11 | scale note “SCALE 1-1/2" = 1'-0"” → pt per ft | 108.000 | 108.000 | 0.000 | exact | pt | PASS |
| 12 | scale note “SCALE 1 1/2" = 1'-0"” → pt per ft | 108.000 | 108.000 | 0.000 | exact | pt | PASS |
| 13 | scale note “SCALE 3" = 1'-0"” → pt per ft | 216.000 | 216.000 | 0.000 | exact | pt | PASS |
| 14 | scale note “SCALE ¼" = 1'-0"” → pt per ft | 18.000 | 18.000 | 0.000 | exact | pt | PASS |
| 15 | scale note “SCALE 1/8”=1’-0”” → pt per ft | 9.000 | 9.000 | 0.000 | exact | pt | PASS |
| 16 | scale note “SCALE 1/4"=1'0"” → pt per ft | 18.000 | 18.000 | 0.000 | exact | pt | PASS |
| 17 | scale note “SCALE 1" = 10'-0"” → pt per ft | 7.200 | 7.200 | 0.000 | exact | pt | PASS |
| 18 | scale note “SCALE 1" = 20'” → pt per ft | 3.600 | 3.600 | 0.000 | exact | pt | PASS |
| 19 | scale note “SCALE 1"=30'” → pt per ft | 2.400 | 2.400 | 0.000 | exact | pt | PASS |
| 20 | scale note “SCALE 1:50” → pt per ft | 17.280 | 17.280 | 0.000 | exact | pt | PASS |
| 21 | scale note “SCALE 1:100” → pt per ft | 8.640 | 8.640 | 0.000 | exact | pt | PASS |
| 22 | scale note “SCALE 1 : 200” → pt per ft | 4.320 | 4.320 | 0.000 | exact | pt | PASS |
| 23 | scale note “1:100” → pt per ft | 8.640 | 8.640 | 0.000 | exact | pt | PASS |
| 24 | scale note “SCALE 1:1250” → pt per ft | 0.691 | 0.691 | 0.000 | exact | pt | PASS |
| 25 | scale note “NTS” → pt per ft | 0.000 | 0.000 | 0.000 | exact | pt | PASS |
| 26 | scale note “SCALE: NOT TO SCALE” → pt per ft | 0.000 | 0.000 | 0.000 | exact | pt | PASS |
| 27 | scale note “DATE 12:30” → pt per ft | 0.000 | 0.000 | 0.000 | exact | pt | PASS |
| 28 | scale note “ROOM 12 x 14” → pt per ft | 0.000 | 0.000 | 0.000 | exact | pt | PASS |
| 29 | chosen scale 3/32" = 1'-0" | 6.750 | 6.750 | 0.000 | exact | pt / ft | PASS |
| 30 | chosen scale 1/8" = 1'-0" | 9.000 | 9.000 | 0.000 | exact | pt / ft | PASS |
| 31 | chosen scale 3/16" = 1'-0" | 13.500 | 13.500 | 0.000 | exact | pt / ft | PASS |
| 32 | chosen scale 1/4" = 1'-0" | 18.000 | 18.000 | 0.000 | exact | pt / ft | PASS |
| 33 | chosen scale 3/8" = 1'-0" | 27.000 | 27.000 | 0.000 | exact | pt / ft | PASS |
| 34 | chosen scale 1/2" = 1'-0" | 36.000 | 36.000 | 0.000 | exact | pt / ft | PASS |
| 35 | chosen scale 3/4" = 1'-0" | 54.000 | 54.000 | 0.000 | exact | pt / ft | PASS |
| 36 | chosen scale 1" = 1'-0" | 72.000 | 72.000 | 0.000 | exact | pt / ft | PASS |
| 37 | chosen scale 1-1/2" = 1'-0" | 108.000 | 108.000 | 0.000 | exact | pt / ft | PASS |
| 38 | chosen scale 3" = 1'-0" | 216.000 | 216.000 | 0.000 | exact | pt / ft | PASS |
| 39 | chosen scale 1/16" = 1'-0" | 4.500 | 4.500 | 0.000 | exact | pt / ft | PASS |
| 40 | chosen scale 1/32" = 1'-0" | 2.250 | 2.250 | 0.000 | exact | pt / ft | PASS |
| 41 | chosen scale 1" = 10' | 7.200 | 7.200 | 0.000 | exact | pt / ft | PASS |
| 42 | chosen scale 1" = 20' | 3.600 | 3.600 | 0.000 | exact | pt / ft | PASS |
| 43 | chosen scale 1" = 30' | 2.400 | 2.400 | 0.000 | exact | pt / ft | PASS |
| 44 | chosen scale 1" = 40' | 1.800 | 1.800 | 0.000 | exact | pt / ft | PASS |
| 45 | chosen scale 1" = 50' | 1.440 | 1.440 | 0.000 | exact | pt / ft | PASS |
| 46 | chosen scale 1" = 60' | 1.200 | 1.200 | 0.000 | exact | pt / ft | PASS |
| 47 | chosen scale 1" = 100' | 0.720 | 0.720 | 0.000 | exact | pt / ft | PASS |
| 48 | chosen scale 1:20 | 43.200 | 43.200 | 0.000 | exact | pt / ft | PASS |
| 49 | chosen scale 1:25 | 34.560 | 34.560 | 0.000 | exact | pt / ft | PASS |
| 50 | chosen scale 1:50 | 17.280 | 17.280 | 0.000 | exact | pt / ft | PASS |
| 51 | chosen scale 1:75 | 11.520 | 11.520 | 0.000 | exact | pt / ft | PASS |
| 52 | chosen scale 1:100 | 8.640 | 8.640 | 0.000 | exact | pt / ft | PASS |
| 53 | chosen scale 1:125 | 6.912 | 6.912 | 0.000 | exact | pt / ft | PASS |
| 54 | chosen scale 1:150 | 5.760 | 5.760 | 0.000 | exact | pt / ft | PASS |
| 55 | chosen scale 1:200 | 4.320 | 4.320 | 0.000 | exact | pt / ft | PASS |
| 56 | chosen scale 1:250 | 3.456 | 3.456 | 0.000 | exact | pt / ft | PASS |
| 57 | chosen scale 1:500 | 1.728 | 1.728 | 0.000 | exact | pt / ft | PASS |
| 58 | chosen scale 1:1000 | 0.864 | 0.864 | 0.000 | exact | pt / ft | PASS |
| 59 | 1:100 drawn for A1, printed on this A4 page | 3.051 | 3.051 | 0.000 | exact | pt / ft | PASS |
| 60 | typed custom scale 3/16" = 1'-0" | 13.500 | 13.500 | 0.000 | exact | pt / ft | PASS |
| 61 | calibrate 90 pt = 5'-0" | 18.000 | 18.000 | 0.000 | exact | pt / ft | PASS |
| 62 | calibrate 90 pt = 1524mm | 18.000 | 18.000 | 0.000 | exact | pt / ft | PASS |
| 63 | calibrate 90 pt = 60" | 18.000 | 18.000 | 0.000 | exact | pt / ft | PASS |
| 64 | calibrate 90 pt = 5 | 18.000 | 18.000 | 0.000 | exact | pt / ft | PASS |
| 65 | Rect on BATH 1 corners (snapped), fit zoom | 72.000 | 72.000 | 0.000 | ±0.001 | Sft | PASS |
| 66 | BATH 1 at 3× zoom (same measurement) | 72.000 | 72.000 | 0.000 | exact | Sft | PASS |
| 67 | BATH 1 at 9× zoom (same measurement) | 72.000 | 72.000 | 0.000 | exact | Sft | PASS |
| 68 | BATH 1 drawn again at 4× zoom | 72.000 | 72.000 | 0.000 | ±0.001 | Sft | PASS |
| 69 | BATH 1 after visiting another page | 72.000 | 72.000 | 0.000 | exact | Sft | PASS |
| 70 | Auto area BED ROOM 1 (BED ROOM 1) | 144.000 | 144.000 | 0.000 | ±0.720 | Sft | PASS |
| 71 | Auto area BATH 1 (BATH 1) | 72.000 | 72.000 | 0.000 | ±0.500 | Sft | PASS |
| 72 | Auto area BED ROOM 2 (BED ROOM 2) | 144.000 | 144.000 | 0.000 | ±0.720 | Sft | PASS |
| 73 | Auto area CORRIDOR (CORRIDOR) | 123.000 | 123.000 | 0.000 | ±0.615 | Sft | PASS |
| 74 | Auto area LIVING (LIVING) | 257.250 | 257.250 | 0.000 | ±1.286 | Sft | PASS |
| 75 | Auto area KITCHEN (KITCHEN) | 168.000 | 168.000 | 0.000 | ±0.840 | Sft | PASS |
| 76 | Auto area BED ROOM 3 (BED ROOM 3) | 144.000 | 144.000 | 0.000 | ±0.720 | Sft | PASS |
| 77 | Auto area BATH 2 (BATH 2) | 72.000 | 72.000 | 0.000 | ±0.500 | Sft | PASS |
| 78 | Auto area STORE (STORE) | 144.000 | 144.000 | 0.000 | ±0.720 | Sft | PASS |
| 79 | Auto area p.7 hatch room | 100.000 | 100.000 | 0.000 | ±1.000 | Sft | PASS |
| 80 | Auto area p.7 turned room | 100.000 | 99.973 | -0.027 | ±1.000 | Sft | PASS |
| 81 | Auto area p.7 round room | 113.097 | 113.130 | 0.033 | ±1.131 | Sft | PASS |
| 82 | Auto area p.7 ell room | 108.000 | 108.000 | 0.000 | ±1.080 | Sft | PASS |
| 83 | Rooms agent BED ROOM 1 | 144.000 | 144.000 | 0.000 | ±0.010 | Sft | PASS |
| 84 | Rooms agent BATH 1 | 72.000 | 72.000 | 0.000 | ±0.010 | Sft | PASS |
| 85 | Rooms agent BED ROOM 2 | 144.000 | 144.000 | 0.000 | ±0.010 | Sft | PASS |
| 86 | Rooms agent CORRIDOR | 123.000 | 123.000 | 0.000 | ±0.010 | Sft | PASS |
| 87 | Rooms agent LIVING | 257.250 | 257.250 | 0.000 | ±0.010 | Sft | PASS |
| 88 | Rooms agent KITCHEN | 168.000 | 168.000 | 0.000 | ±0.010 | Sft | PASS |
| 89 | Rooms agent BED ROOM 3 | 144.000 | 144.000 | 0.000 | ±0.010 | Sft | PASS |
| 90 | Rooms agent BATH 2 | 72.000 | 72.000 | 0.000 | ±0.010 | Sft | PASS |
| 91 | Rooms agent STORE | 144.000 | 144.000 | 0.000 | ±0.010 | Sft | PASS |
| 92 | Walls agent 9" centre / face-to-face length | 150.750 | 150.750 | 0.000 | ±0.010 | ft | PASS |
| 93 | Walls agent 4.5" centre / face-to-face length | 154.250 | 154.250 | 0.000 | ±0.010 | ft | PASS |
| 94 | 2'-0" line inside the 1-1/2" detail | 2.000 | 2.000 | 0.000 | exact | ft | PASS |
| 95 | 16'-0" line outside the detail (sheet 3/16") | 16.000 | 16.000 | 0.000 | exact | ft | PASS |
| 96 | Floor area: 9 rooms by auto area | 1,268.250 | 1,268.250 | 0.000 | ±0.010 | Sft | PASS |
| 97 | Ceiling = floor area (assembly A) | 1,268.250 | 1,268.250 | 0.000 | ±0.010 | Sft | PASS |
| 98 | Skirting = room perimeters (assembly P) | 450.250 | 450.250 | -0.000300 | ±0.010 | ft | PASS |
| 99 | Floor tiles + 5 % (assembly A*1.05) | 1,331.662 | 1,331.662 | 0.000 | ±0.010 | Sft | PASS |
| 100 | 9" outer wall centre line, typed 31'-6" + 43'-10 1/2" + 31.5 + 43.875 | 150.750 | 150.750 | 0.000 | ±0.001 | ft | PASS |
| 101 | 9" outer wall: 150.75 × 0.75 × 10 | 1,130.625 | 1,130.625 | 0.000 | ±0.001 | cft | PASS |
| 102 | Entrance opening width (clicked on the jambs) | 3.000 | 3.000 | 0.000 | ±0.001 | ft | PASS |
| 103 | Entrance deduction −1 × 3 × 0.75 × 7 | -15.750 | -15.750 | 0.000 | ±0.001 | cft | PASS |
| 104 | 9" wall net | 1,114.875 | 1,114.875 | 0.000 | ±0.001 | cft | PASS |
| 105 | Count D1 from the drawing text | 7.000 | 7.000 | 0.000 | exact | Nos | PASS |
| 106 | Count D2 from the drawing text | 2.000 | 2.000 | 0.000 | exact | Nos | PASS |
| 107 | Count W1 from the drawing text | 5.000 | 5.000 | 0.000 | exact | Nos | PASS |
| 108 | Count W2 from the drawing text | 3.000 | 3.000 | 0.000 | exact | Nos | PASS |
| 109 | Excel total = takeoff: Floor area | 1,268.250 | 1,268.250 | 0.000 | exact | Sft | PASS |
| 110 | Excel total = takeoff: Brick masonry 9" wall | 1,114.875 | 1,114.875 | 0.000 | exact | cft | PASS |
| 111 | Excel total = takeoff: D1 | 7.000 | 7.000 | 0.000 | exact | Nos | PASS |
| 112 | Excel total = takeoff: D2 | 2.000 | 2.000 | 0.000 | exact | Nos | PASS |
| 113 | Excel total = takeoff: W1 | 5.000 | 5.000 | 0.000 | exact | Nos | PASS |
| 114 | Excel total = takeoff: W2 | 3.000 | 3.000 | 0.000 | exact | Nos | PASS |
| 115 | CSV total = takeoff: Floor area | 1,268.250 | 1,268.250 | 0.000 | exact | Sft | PASS |
| 116 | CSV total = takeoff: Brick masonry 9" wall | 1,114.875 | 1,114.875 | 0.000 | exact | cft | PASS |
| 117 | CSV total = takeoff: D1 | 7.000 | 7.000 | 0.000 | exact | Nos | PASS |
| 118 | CSV total = takeoff: D2 | 2.000 | 2.000 | 0.000 | exact | Nos | PASS |
| 119 | CSV total = takeoff: W1 | 5.000 | 5.000 | 0.000 | exact | Nos | PASS |
| 120 | CSV total = takeoff: W2 | 3.000 | 3.000 | 0.000 | exact | Nos | PASS |
| 121 | tiny rectangle 0.01 × 0.01 ft | 0.000100 | 0.000100 | 0.000 | exact | Sft | PASS |
| 122 | huge rectangle 1000 × 1000 ft | 1,000,000.000 | 1,000,000.000 | 0.000 | exact | Sft | PASS |
| 123 | Rectangle 12'-0" × 14'-0" (Nos × L × W) | 168.000 | 168.000 | 0.000 | exact | Sft | PASS |
| 124 | Rectangle 12'-6" × 10'-4 1/2" | 129.688 | 129.688 | 0.000 | exact | Sft | PASS |
| 125 | L-shape 12 × 12 less 6 × 6 (coordinates) | 108.000 | 108.000 | 0.000 | exact | Sft | PASS |
| 126 | Triangle base 10, height 6 (½ × b × h) | 30.000 | 30.000 | 0.000 | exact | Sft | PASS |
| 127 | Room turned 30°, 10 × 8 | 80.000 | 80.000 | 0.000 | ±0.002 | Sft | PASS |
| 128 | Circle dia 10 ft: π/4 × D² | 78.540 | 78.540 | 0.000 | exact | Sft | PASS |
| 129 | Round wall dia 10 ft: π × D | 31.416 | 31.416 | 0.000 | exact | ft | PASS |
| 130 | Nos 2 × 12 × 14 | 336.000 | 336.000 | 0.000 | exact | Sft | PASS |
| 131 | Deduction 4 × 4 (void in an area) | -16.000 | -16.000 | 0.000 | exact | Sft | PASS |
| 132 | Slab 12 × 14 × 0.5 ft | 84.000 | 84.000 | 0.000 | exact | cft | PASS |
| 133 | Slab void 0.8 × 0.6 × 0.5 = 0.24 cft ≤ 0.50: not deducted | 0.000 | 0.000 | 0.000 | exact | cft | PASS |
| 134 | Run 3 legs 10 + 5.5 + 3.25 | 18.750 | 18.750 | 0.000 | exact | ft | PASS |
| 135 | Run 3'-4 1/2" + 2'-7 1/4" | 5.979 | 5.979 | 0.000 | exact | ft | PASS |
| 136 | Semicircular run radius 5 ft (A arc): π × 5 | 15.708 | 15.707 | -0.001 | ±0.002 | ft | PASS |
| 137 | Internal plaster both faces: 2 × 20 × 10 | 400.000 | 400.000 | 0.000 | exact | Sft | PASS |
| 138 | Plaster opening 3 × 7, both faces: −2 × 3 × 7 | -42.000 | -42.000 | 0.000 | exact | Sft | PASS |
| 139 | Plaster opening 0.9 × 1.0 = 0.9 Sft ≤ 1.00: not deducted | 0.000 | 0.000 | 0.000 | exact | Sft | PASS |
| 140 | 9" wall 20 × 0.75 × 10 | 150.000 | 150.000 | 0.000 | exact | cft | PASS |
| 141 | 9" wall door 3 × 7: −1 × 3 × 0.75 × 7 | -15.750 | -15.750 | 0.000 | exact | cft | PASS |
| 142 | Count 7 points × Nos 3 | 21.000 | 21.000 | 0.000 | exact | Nos | PASS |
| 143 | ft-in 12'-6" → decimal ft | 12.500 | 12.500 | 0.000 | exact | ft | PASS |
| 144 | ft-in 3'-4 1/2" → decimal ft | 3.375 | 3.375 | 0.000 | exact | ft | PASS |
| 145 | metric length typed as “3000mm” → decimal ft | 9.842 | 9.842 | 0.000 | exact | ft | PASS |
| 146 | rounding: dimensions to 3 dp, quantity their product (12.3456 × 7.8912) | 97.422 | 97.422 | 0.000 | exact | Sft | PASS |
| 147 | scan calibrated on its 10'-0" bar (1/4" = 18 pt per ft) | 18.000 | 18.000 | 0.000 | ±0.100 | pt / ft | PASS |
| 148 | scan: auto area BED ROOM 1 | 144.000 | 143.638 | -0.362 | ±1.440 | Sft | PASS |
| 149 | scan: auto area BATH 1 | 72.000 | 72.144 | 0.144 | ±0.720 | Sft | PASS |
| 150 | scan: auto area BED ROOM 2 | 144.000 | 143.638 | -0.362 | ±1.440 | Sft | PASS |
| 151 | scan: auto area CORRIDOR (passage as wide as the door gap, entrance closed on the wall's inner face) | 123.000 | 124.721 | 1.721 | ±1.845 | Sft | PASS |
| 152 | scan: auto area LIVING | 257.250 | 257.353 | 0.103 | ±2.573 | Sft | PASS |
| 153 | scan: auto area KITCHEN | 168.000 | 167.996 | -0.004 | ±1.680 | Sft | PASS |
| 154 | scan: auto area BED ROOM 3 | 144.000 | 143.638 | -0.362 | ±1.440 | Sft | PASS |
| 155 | scan: auto area BATH 2 | 72.000 | 72.615 | 0.615 | ±0.720 | Sft | PASS |
| 156 | scan: auto area STORE | 144.000 | 143.638 | -0.362 | ±1.440 | Sft | PASS |
| 157 | …BED ROOM 1 on the heavy sheet | 144.000 | 144.000 | 0.000 | ±0.720 | Sft | PASS |

## D. Performance

Headless Chromium on the build machine (no GPU); times include the test's own overhead. A real laptop with a GPU is usually faster at drawing, similar at tracing.

| Test | Time ms | Limit ms | Result | Note |
|---|---:|---:|---|---|
| open the 8-page QA set (to page 1 indexed, scale read) | 325 | 5,000 | PASS |  |
| auto area BED ROOM 1 | 1,148 | 6,000 | PASS |  |
| auto area BATH 1 | 1,007 | 6,000 | PASS |  |
| auto area BED ROOM 2 | 1,035 | 6,000 | PASS |  |
| auto area CORRIDOR | 993 | 6,000 | PASS |  |
| auto area LIVING | 972 | 6,000 | PASS |  |
| auto area KITCHEN | 1,185 | 6,000 | PASS |  |
| auto area BED ROOM 3 | 952 | 6,000 | PASS |  |
| auto area BATH 2 | 942 | 6,000 | PASS |  |
| auto area STORE | 976 | 6,000 | PASS |  |
| longest freeze during the 9 auto-area traces (the page stays live) | 198 | 400 | PASS | 61 tasks over 50 ms |
| Rooms agent: 9 rooms traced and checked | 7,425 | 30,000 | PASS |  |
| Excel export (6 conditions) | 601 | 8,000 | PASS |  |
| marked-up PDF, all measured pages | 1,976 | 15,000 | PASS |  |
| 100 measurements: one edit (undo snapshot + sheet + drawing) | 13 | 150 | PASS |  |
| 100 measurements: 20 mouse moves | 340 | 1,200 | PASS | ≈17 ms each incl. test overhead |
| 500 measurements: one edit (undo snapshot + sheet + drawing) | 45 | 150 | PASS |  |
| 500 measurements: 20 mouse moves | 328 | 1,200 | PASS | ≈16 ms each incl. test overhead |
| 1000 measurements: one edit (undo snapshot + sheet + drawing) | 81 | 300 | PASS |  |
| 1000 measurements: 20 mouse moves | 433 | 2,500 | PASS | ≈22 ms each incl. test overhead |
| Excel export with 1000+ measurements | 668 | 15,000 | PASS |  |
| project JSON export with 1000+ measurements | 303 | 3,000 | PASS |  |
| open a 120-page PDF (first page shown and indexed) | 351 | 6,000 | PASS |  |
| 10 page changes on the 120-page PDF (each shown and indexed) | 1,199 | 6,000 | PASS | 120 ms each |
| Pages tab: first thumbnails of 120 drawn | 100 | 8,000 | PASS |  |
| Find text across 120 pages | 227 | 15,000 | PASS |  |
| JS heap after the 120-page run | 13 MB | 1,500 MB | PASS |  |
| open a 200 dpi scanned sheet | 1,556 | 6,000 | PASS |  |
| open a sheet of 150,000 lines (shown and indexed) | 3,505 | 8,000 | PASS | 150180 lines |
| …longest freeze opening it (lines indexed, page drawn) | 240 | 400 | PASS |  |
| auto area on the 150,000-line sheet | 3,357 | 6,000 | PASS |  |
| …longest freeze during that trace | 229 | 400 | PASS |  |
| 30 mouse moves with snapping on the heavy sheet | 886 | 3,000 | PASS |  |

## E. Remaining risks

- **Real drawings differ from fixtures.** CAD exports with blocks, dashed / hidden lines, text drawn as outlines, very thin walls or walls drawn as single lines may trace differently. Auto area and the free agents are the most exposed; manual drawing, scale and the sheet are not.
- **Scanned sheets** have no text (no OCR): no scale note, room names or tags are read; scale must be calibrated; auto area works on the ink, to about ±1 px a side (0.06 ft on the 200 dpi test scan — ±1.5 % of a 4 ft corridor's width).
- **One browser only.** Projects live in the browser's IndexedDB; clearing site data or a different browser / host loses them unless exported (*Export → Project .json*). Backups (last 10) are in the same browser.
- **Browser crash** (not a normal close) inside the 300 ms save window could lose the last change; normal close / reload / tab hide now save at once (tested).
- **Only Chromium tested** — Firefox / Safari untested; the app uses standard APIs (IndexedDB, BroadcastChannel, IntersectionObserver, ResizeObserver) that both support.
- **Slow machines** — auto area and dense sheets now hand the page back to the browser every ~40 ms (longest freeze under 0.3 s on the test machine); a much slower computer stretches the trace itself, not the freezes.
- **Claude API agent** untested (no key) — its answers are flagged AI until checked, as before.
- **Rates** are not part of this audit: the takeoff takes rates only from the Rate Analysis library with a dated source (*RATE NOT AVAILABLE* otherwise) — no rate was added or changed.

## F. Tomorrow's live-retest checklist

On a real project PDF, in Chrome. Before merging, the PR's deploy preview is https://deploy-preview-68--zd-dashboard.netlify.app/takeoff/ (its own browser storage — projects on the live site are not there; use Export / Import .json to move one). After merging: the live site.

1. **Scale.** Open a real sheet with a scale note: the chip reads the note (⚠ From note). Measure a dimension written on the drawing → *Verify* (±1 %). If the sheet has room sizes written, a wrong note is flagged with a suggested scale. Zoom in / out and re-measure the same line — the length must not change.
1. **Rapid paging.** PgDn / PgUp quickly 10 times, click a sheet row while a page loads — each page keeps its own scale note (the chip matches the page's note).
1. **Auto area.** Click inside 5 rooms including a corridor and a room with furniture / tiles / door swings: compare with the drawing's dimensions (room sizes written × each other). Look at the outline — it should sit on the inner wall faces.
1. **Walls agent / doors-windows agent.** Run on one floor; compare wall lengths and door / window counts with the schedule.
1. **Measurement sheet.** Every row reads `Nos × L × W × H`, 3 dp, Nos whole; deductions / openings as separate negative rows.
1. **Excel export.** Open in Excel: totals are formulas, Sft 0.000, Nos whole, Summary links to Measurement; Validation sheet lists missing H / T / scale.
1. **Save.** Make a change and close the tab immediately; reopen — the change is there. `Ctrl+S` toasts *Saved*. Open the project in a second tab — both warn.
1. **Project file.** *Export → Project .json*, import it back: validation table all PASS; re-attach the PDF.
1. **Password PDF** (if you have one): asks for the password, opens; export marked-up PDF.
1. **Header at your screen width** (1366 / 1920): scale chip, Undo / Redo, Export visible; View menu opens.
1. **Pages tab:** thumbnails appear, scale status icons right; *Remove PDF* asks first.
1. **Scanned sheet** (if any): calibrate on a known dimension, measure by hand; auto area on rooms and a corridor — outlines on the wall faces, doorways closed on the room's side.

## QA status

```
QA STATUS: PASS
Critical Bugs: 0 open (4 found and fixed: B01, B02, B03, B04)
High Bugs: 0 open (17 found and fixed: B05, B06, B07, B08, B09, B10, B11, B12, B13, B14, B15, B16, B17, B18, B19, B20, B21)
Medium Bugs: 0 open; 10 found and fixed
Low Bugs: 0 open; 6 found and fixed
Fixed Today: 37 (B01–B37)
Not Tested: OCR of scanned drawings; Reorder / duplicate / rotate / delete single pages of a PDF; Sort / search / pagination of the measurement sheet; Claude API agent (the 🤖 Claude panel's model calls); Firefox, Safari; Touch / pinch zoom / press-and-hold on a tablet; Real project drawings (Revit / AutoCAD exports); Browser storage quota (very large PDFs filling IndexedDB)
Tomorrow's Retest Priority: 1 scale on a real sheet (note, verify, zoom), 2 rapid paging keeps each page's scale, 3 auto area + walls on a real floor plan, 4 save on close / two tabs, 5 Excel totals and 3 dp
```

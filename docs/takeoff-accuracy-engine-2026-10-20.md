# PDF Takeoff — accuracy engine audit and upgrade (20-Oct-2026)

Branch `claude/takeoff-accuracy-engine`, based on `main` at `50267c7` (PR #188). This report covers the audit, the defects found with
their root causes, what was changed, and how it was tested. It ends with the limits that remain and a procedure for checking the
result on a real floor plan.

The working rule throughout: language models interpret and propose; validated geometry measures; deterministic formulas
calculate; explicit checks and a person's review establish trust. Nothing in this report claims 100 % accuracy. Every figure
below comes from a test that was run, and each one is marked as either synthetic or real.

## 1. How the takeoff works (as found in the code)

| Step | Where (takeoff.js unless named) | What it does |
|---|---|---|
| Import | `addFiles`, `openPdf`, `cadLoad` (cad.js) | A PDF is opened by pdf.js 4.10.38. A DWG / DXF is read by cad.js and laid out at a standard plot scale. |
| Page processing | `indexPage` | Vector lines go into `S.geo[key].segs` (Béziers become 8 straight pieces), text into `S.texts[key]`, and layers are recorded. |
| Coordinates | `vpOf`, `pgRot`, `rotDoc`, `toBase` / `toScr` | One page space: PDF points at scale 1, y pointing down, with the page's /Rotate applied. Zoom and pan (`S.view`) only move the canvas. No quantity is computed from screen pixels. |
| Scale | `P.proj.scales[key]` `{ptPerFt, how, verified}`; `P.proj.viewports[key]`; `scaleAt`, `itemScale` | Points per foot, per page, with detail viewports. Sources: a note (`inPerFtOf`, `scaleCandidates`), PDF /VP data, dimension strings, chosen by hand, K calibration, Verify. |
| Geometry | `autoRoom` (raster flood fill + `squareUp` / `snapToWalls` / `squareToWalls`), `traceAt` (trace.js on layered CAD PDFs), `findWalls` (paired face lines), `scanTags` | Room outlines, wall centre lines, door / window tags. |
| Interpretation | `agentCmd` / `agentStep` (rule agent, no key); `aiSend` (Claude), `aiSendLocal` (Ollama / Claude Code) with `AI_TOOLS*` | Text is turned into tool calls. |
| Measurement | `rowsOf` → `condTotals` → sheet / Excel | Every row is Nos × L × W × H in decimal feet. Each dimension is rounded to 3 dp first (the house rule: the sheet re-measures from its own printed figures). |
| Review | `needsReview`, QA statuses, `validation()`, `agentCheck` | Each measurement is flagged AI, copied, recheck or checked. There is a check before export. |
| Save | IndexedDB, Export JSON v2 (lossless), backups | |

The conversion path itself was sound. The page scale is points per foot. Lengths are points ÷ k and areas are points² ÷ k². Rotation and the crop box are handled by pdf.js. All 25.4 / 304.8 / 0.3048 / 12 constants were checked and are correct. No lookup falls back to another page's scale. Zooming does not change any stored quantity, and the zoom checks in §6 confirm this.

## 2. Defects found, and their root causes

Each defect was reproduced before it was fixed. Synthetic means a generated drawing with known dimensions.

| # | Symptom (evidence) | Root cause | Function | Status |
|---|---|---|---|---|
| D1 | A T-shaped corridor of 205.375 Sft traced as 49.500 Sft (−75.9 %) on all three pages. The warning said "only 70 % follows the lines" (synthetic apartment). | `jambLines` closes a gap of 1.2–5 ft from the end of every wall face as a doorway with no door drawn. The end of the partition where the corridor turns is the outside corner of an L junction, not a free wall end, so the closing line cut the corridor in two. The same thing happened at x = 24.5, and was hidden only because the kitchen doorway lay in the ray's path. | `jambLines` | **Fixed.** A face end is a jamb only if no line through it runs across the wall and on past its other face. |
| D2 | BATH 1 traced from its label came out at 44.01 Sft instead of 48 (−8.3 %). From another click it gave 48: the result depended on the click. | `jambLines` takes any two parallel lines 0.25–1.6 ft apart as wall faces. The WC (1.5 ft) and basin (1.3 × 1.1 ft) boxes qualified, and the closing rays from their corners fenced off the floor around them. Whether `squareUp` then refilled the notch depended on the click. | `jambLines` | **Fixed.** A small closed box standing free in a room is furniture or a fixture, not a wall. |
| D3 | 9" walls came out at 147.875 ft instead of 140.750 (+5.06 %) on all three pages. | The top line of the WC and basin boxes lies exactly 0.75 ft from the washroom's wall face. The walls agent paired that face, already the inner face of the 9" outer wall, with the fixture line as a second 9" wall. | `findWalls` | **Fixed.** A line is a wall face on one side only: a short pair whose face is claimed on its other side by a much longer pair of a thickness drawn on the page is rejected. |
| D4 | Rooms turned 8° and 12° traced at 158.537 and 149.914 Sft instead of 168 (−5.6 %, −10.8 %), with a warning. | `orthoEdges` treats any edge within 15° of an axis as horizontal or vertical, and `squareUp` rebuilt an axis-aligned outline through the edges' midpoints. | `squareUp` | **Fixed.** A room whose long walls are 1.5° or more off the page axes, or which has a long sloped wall, is not squared to the page. It goes the same way as a 45° room: sides snapped to their own wall lines. |
| D5 | The agents' `count_tags`, `detect_walls`, `measure_rooms`, `set_condition`, `list_measured` and `delete_area` refused with "The page changed — press Read this view". | One guard asked every tool for a picture of the view, though only the five tools that take pixel coordinates need one. | `aiRunTool0` | **Fixed.** |
| D6 | "Undo the last AI measurement" **measured rooms** instead of undoing. "Find duplicate … wall measurements" ran room measuring. "Create a separate corridor area" measured every room with an "a" in its name. "Measure all rooms on the current floor" answered "no room matches current". | The rule agent's branches matched substrings (`/measure/` hits "measurement", `/count/` hits "percentage"). Filler words were left in the room filter, and its words were OR-ed ("bed room" matched every ROOM). There was no undo, compare, review or slab intent. | `agentStep`, `agentMeasure` | **Fixed.** Structured QS commands are checked first, the remaining branches match whole words, and room names are matched as whole phrases with synonyms. |
| D7 | "Measured 0 of 5" and "Specialist done" were shown as success; `auto_area_page` with nothing added showed ✓. | Replies did not check what was done. | `agentMeasure`, `measure_rooms` | **Fixed.** A run that measured nothing is an error, with each room's reason. |
| D8 | A person's count marked **Checked** turned back into an unchecked AI item when an agent counted on the same page. | Every count path took any count item of the condition and set `ai = true; qa = ""`. | `putCounts`, `agentCount`, `add_counts`, the swing counts, `freeImport` | **Fixed** (`aiCountItem`). The agent adds only to its own unchecked item, never adds a mark twice, and leaves a person's count and sign-off alone. |
| D9 | The local AI route could do a request twice. | When any later turn failed, the whole request was re-run by the rule agent, even after tools had already run. | `aiSendLocal` | **Fixed.** The rule agent answers only if no tool ran. |
| D10 | The agent could delete a person's measurement unseen. | `delete_area` deleted any item by id. | `aiRunTool0` | **Fixed.** It asks first for a measurement the person made, and refuses a locked one. |
| D11 | Tool arguments were checked against their schemas on the Ollama route only. | `toolArgsCheck` was not called on the Claude and claude.ai routes. | `aiRunTool` | **Fixed.** Every route is checked. |
| D12 | A detail viewport added without a scale silently measured at the **page's** scale. | `viewportAt` skipped viewports with `ptPerFt` 0. | `viewportAt`, `scaleAt` | **Fixed.** What is measured in an uncalibrated viewport has no scale (it is out of the totals and shows Needs calibration). |
| D13 | Nested viewports resolved by creation order. | `find` returned the first match. | `viewportAt` | **Fixed.** The innermost viewport wins. Bluebeam lets the topmost in its list govern; the nested-detail case is the one that matters here. |
| D14 | K with both points inside a detail viewport overwrote the page's scale. Verify inside a viewport compared against the page scale, and "Recalibrate" rewrote the page. | Both used the page scale. | `finish` (K), `verifyMeasure` | **Fixed.** |
| D15 | `3/4" = 1'-6"` was read as `3/4" = 1'-0"` (0.75 in/ft instead of 0.5: +50 % in length, +125 % in area). | The architectural pattern ended `1'-0?` and ignored the inches after the feet. | `inPerFtOf` | **Fixed.** |
| D16 | A bare `1:12` (a ramp's slope) or `1:12 RAMP` was taken as a scale note and applied automatically (72 pt/ft). | Any text line starting `1:N` counted. | `inPerFtOf` | **Fixed.** A bare ratio counts only on its own and with a standard drawing-scale denominator, and never with slope / ramp words. |
| D17 | Counts on a page not yet calibrated were dropped from the totals. | Every quantity path skipped items with no scale, though a count needs none. | `rowsOf` and its 25 callers | **Fixed** (`qScale`). |
| D18 | A Bluebeam markup import replaced a **verified** page scale. | Only "calibrated" scales were protected. | `bbImport` | **Fixed.** A verified scale is kept, and the difference is reported. |
| D19 | One measurement's Properties showed Area × Nos but Perimeter × 1, and the condition panel left counts out on unscaled pages. | Inconsistent display formulas. | `itemTotalsList`, `condTotalsList` | **Fixed.** |
| D20 | A calibration on a very short line was accepted silently. | There was no check on the span. | `finish` (K) | **Fixed.** Spans under 1 inch of paper are warned. |
| D21 | AI tools reported lengths and areas at the page scale, while the sheet used the item's viewport scale. | They used `curScale()`. | `trace_room`, `draw_area`, `draw_length` | **Fixed.** |
| D22 | `measure_rooms` split `["BED ROOM"]` into words OR-ed together. | It used `names.join(" ")`. | `aiRunTool0` | **Fixed.** Names are matched as whole phrases. |
| D23 | The agent could not choose the condition to measure into, so "a separate corridor area" was impossible. | `set_condition` never made the condition current. | `aiRunTool0` | **Fixed** (also the `condition` input of `qs_command`). |
| D24 | On a page turned 90°, the agent measured baths at 45.747 / 38.751 Sft instead of 48 / 40. | `agentMeasure` and nine other places took a room name's centre from its text box, which lies across on a turned page. The rotation-correct centre (`cx`, `cy`) was already computed but not used. | `agentMeasure`, `agentCheck`, the room pass of `fullTakeoff` | **Fixed** (`nameCentre`). `scaleFromRooms` still casts its rays along the text box; this is listed in §6. |
| D25 | "walls 9"" from the chat gave a total for the part on screen without saying so. | `agentWallsCmd` used the view, and its reply did not state the scope. | `agentWallsCmd`, `wallsAgent` | **Fixed.** "Whole page" measures the page, and the reply says which was measured. |
| D26 | The drawing suite's trapezoid room (sloped walls, 168 Sft) went from −0.32 % to −0.92 % after the fixes above. This was caught by re-recording the suite. | `squareToWalls` squares each corner in one right-angled wall grid. At an oblique corner it took the sloped wall's grid, and the top edge's two ends landed on two different lines. Before, that result had been rejected for this shape. | `squareToWalls` | **Fixed.** An outline whose long walls meet more than 5° off square is left as traced. Its sides are already on their own wall lines. It is back to −0.32 %, and turned rectangles stay exact. |

## 3. What was built

### 3.1 Three capabilities kept apart

- **Drawing interpreter.** `qsParse` reads typed commands for the free rule agent, and `qs_command` is the tool the language models call. Both produce the same structured command: `{action, scope, inputs}`.
- **Measurement engine.** This is the deterministic code the app already had: Auto area, the walls agent, the tag scan and `rowsOf`. A new module, `takeoff/measure.js`, adds pure geometry and QS formulas with no DOM:
  - polygon area, perimeter and validity (open, crossing, touching, repeated corners)
  - corner deviation and collinear-overlap detection
  - calibration and scale checks
  - exact unit conversions (ft ↔ m, Sft ↔ m², Cft ↔ m³, kg ↔ ton, mm, cm and in)
  - wall finish, masonry, slab, concrete, formwork and counts, each with house thresholds

  Every formula returns its formula string, inputs and missing inputs. None assumes a height, thickness or opening size; a missing one gives `value: null` and lists what is missing. It is unit-tested in plain Node by `tools/test_takeoff_measure.js`.
- **Validation and review.** `qsChecks` runs inside the ✅ check. `reviewStatus` gives each measurement one of the statuses in §3.4. The new checks are:
  - an outline that is not a valid boundary
  - an agent outline that does not follow the drawing's lines (an incomplete boundary)
  - a measurement edited since it was detected
  - a measurement with no scale in an uncalibrated viewport, or lying across a viewport's edge
  - a sheet quantity that is not its outline's geometry
  - one wall measured in two conditions of the same thickness

### 3.2 The QS commands (`QS_COMMANDS`)

Each command declares its target, its scopes and its typed inputs. Unknown inputs are refused. A command that changes the takeoff runs as one recorded **agent run** (one undo step). A result that changed nothing is not reported as success.

| Request | Action | What it does |
|---|---|---|
| Measure all rooms on the current floor | `measure_rooms` | Auto area at every room name on the page, the whole page even when zoomed in. Each room is its own measurement, marked AI. |
| Measure every washroom separately | `measure_rooms {names: [washroom]}` | "Washroom" covers BATH, TOILET, W.C., WASH, POWDER and LAV. Each one is measured separately. |
| Create a separate corridor area | `measure_rooms {condition: "Corridor area"}` | Uses or creates that area condition, then measures the corridors into it. |
| Give me the linear length of each washroom wall | `room_wall_lengths` | Each side of each measured room's outline, which is its internal face, room by room. It explains that a shared wall appears in both rooms (two faces), and that the walls agent counts it once on its centre line. |
| Measure only the internal face of these walls | `internal_faces` | Wall-face runs around the selected rooms. With wall centre lines selected it asks for the rooms instead (one focused question). |
| Count doors and windows separately | `count_openings {separate}` | Doors, Windows and Ventilators each go in their own condition. "None found" is never presented as a verified zero. |
| Measure the slab area and deduct confirmed openings | `slab_area` | Uses the selected outline, or one already measured, or proposes the outside face of the thickest wall ring (marked AI, to check). It deducts only openings a person has checked, lists the others, and works out no volume without a thickness. |
| Show rooms with incomplete boundaries | `incomplete_boundaries` | Invalid or incomplete outlines (selected on the drawing), plus rooms named on the page with no outline. |
| Find duplicate or overlapping wall measurements | `duplicate_walls` | Runs lying on one another, in the same condition or the same thickness in two conditions. They are selected, never deleted. |
| Compare manually measured quantities with AI quantities | `compare_ai_manual` | Agent and by-hand totals per condition, and any room measured both ways side by side with the difference. |
| Show the exact walls included in this quantity | `show_quantity_items` | Every measurement of the selected condition with its sheet rows (and legs), all selected on the drawing. |
| Recalculate the room after I correct its boundary | `recalc_room` | The edited outline's area, perimeter and sheet quantity (always live from the points), the detected area, the written size, validity and status. |
| Undo the last AI measurement | `undo_ai` | Removes exactly the last agent run as a new, itself undoable step. Measurements the person has since checked or edited are kept. |
| Run a quality check before I export the BOQ | `quality_check` | The ✅ check (now including `qsChecks`) plus the export check's notes. |
| Accept / reject | `accept`, `reject` | Accept is a ✓ check under the person's name. Reject applies only to an agent's measurements: they leave the quantities and stay on record in `P.proj.rejected`. |

### 3.3 Agent runs

`mutate()` records which `ai` measurements each change adds, and the marks added to the agent's own counts, in `P.proj.aiRuns` (the last 50, saved with the project). A command in progress gathers all its changes into one run and one undo step. This is what lets "undo the last AI measurement" take back exactly the agent's work without discarding later manual edits. The snapshot undo stack cannot do that on its own.

### 3.4 Review statuses

| Status | When |
|---|---|
| Needs calibration | No scale where the measurement lies (a page, or an uncalibrated viewport), or a scale not yet checked against a dimension: from a note, inherited, from the dimension strings or the PDF's data. |
| Needs review | Made by an agent, copied, or flagged, and not yet checked; or a QA recheck. |
| Verified | Checked by a person, on a checked (calibrated or verified) scale. |
| Measured | Drawn by hand on a checked scale. |
| Rejected | An agent measurement taken out of the takeoff on review, kept on record. |

A count needs no scale. Nothing an agent makes is shown as Verified until a person has checked it.

## 4. Research: how the reference products do it

| Source (official pages, read 20-Oct-2026) | What they say | What this app does |
|---|---|---|
| [Bluebeam — Set the page scale](https://support.bluebeam.com/revu/how-to/set-the-page-scale-on-drawing.html) | Calibrate on a known length (two end points), apply to this page, all pages or a range. Use a preset only if the PDF was not resized. Viewports are zones at their own scale. | The same. A note scale stays **not verified** until a dimension is measured against it, and Verify / Calibrate act on the viewport the points lie in. |
| [Bluebeam — viewports (Revu 20 help)](https://support.bluebeam.com/online-help/revu20/Content/RevuHelp/Menus/Tools/Measure/Calibrate--MV.htm) | A page can have viewports at other scales, with separate X / Y scales possible. | Viewports at their own scale. The innermost governs (Bluebeam: the topmost in its list). |
| [Autodesk Takeoff — Set scale](https://help.autodesk.com/cloudhelp/ENU/Takeoff-Takeoff/files/Set_Scale.html) | Scale must be set before takeoff. Calibrate from two points and must snap on vector PDFs. One scale can be applied to several sheets with no takeoff yet. | Unscaled pages keep their measurements out of the totals. Snapping goes to vector endpoints and intersections. "Copy scale to" marks copies inherited, not verified. |
| [PlanSwift — Auto Count](https://www.planswift.com/features/auto-count/), [features](https://www.planswift.com/features/) | AI counts and auto takeoff are a first pass: "Review and verify results before using them in an estimate". No accuracy rate is stated. | Every agent result is marked AI and Needs review until checked. The KPI page shows only recorded results, never an invented accuracy. |

Methods chosen for the browser:

- Vector geometry first: paired face lines, the PDF's own endpoints, layers where present.
- The raster flood fill only where there are no lines (scans).
- Polygon checks and collinear overlap in plain JavaScript (`measure.js`).

No new library or model was added. Nothing needs a paid service, an API key or a backend, and no drawing is uploaded.

## 5. Tests and results

### 5.1 New tests

| File | Kind | Checks |
|---|---|---|
| `tools/test_takeoff_measure.js` | plain Node, no browser | 62. Rectangles, an L, the T corridor, a trapezoid and a hexagon; polylines; corners; open, crossing and doubled-back outlines; shared and duplicated runs; calibration (imperial and metric) and a scale against more dimensions; turned shapes; units; wall finish, masonry, slab, concrete and formwork with thresholds; counts. |
| `tools/takeoff_apartment_fixture.js` | fixture | An apartment with two bed rooms, two washrooms, a T corridor, living, kitchen and store, joined by 9" and 4.5" walls at L and T junctions, with doors, windows, furniture and a dimension string. It is drawn on three pages: 1/4" = 1'-0" (ARCH D), 1:100 (A3), and 1/8" = 1'-0" with /Rotate 90. There are also four rooms turned 3°, 8°, 12° and 30°. |
| `tools/test_takeoff_accuracy.js` | browser | 181. Per page: the scale from the note; each room's area, perimeter, corner count and squareness; total floor area; 9" and 4.5" wall centre lines; door and window tags (the agents' own `count_tags`); sheet = agent total. Then zoom 0.3 / 3, the agent over every room, sheet = outline for every measurement, save → reload, export → import, the turned rooms, scale notes, viewports, counts with no scale and review status. `TK_REPORT=out.json` writes every check with reference, result, absolute error, % error and tolerance. |
| `tools/test_takeoff_agentcmds.js` | browser | 36. The fourteen requests above through the rule agent and `qs_command`, each checked on the takeoff itself. Refusals: an unknown request, an unknown command, a wrong input, a schema violation, rejecting a person's measurement, no scale. A person's checked count is never touched, and nothing is sent to a cloud service. |

The tolerances were fixed before the first run and were not widened afterwards: area and perimeter ±0.5 %, walls ±0.5 %, scale
±0.1 %, zoom ±0.05 %, the sheet against its outline 0.015 (the sheet's 3 dp rounding of each dimension), and reload / import exact
to 1e-6.

### 5.2 Before and after: synthetic apartment, the same test against `main` and this branch

Reference quantities are hand-worked from the drawing's own coordinates. "main" is the same test file run against an unchanged `main` (`50267c7`) served side by side.

| Check (all three pages unless noted) | Reference | `main` | this branch |
|---|---|---|---|
| Scale read from the note (p.1 / p.2 / p.3) | 18 / 8.64 / 9 pt/ft | exact | exact |
| 7 rectangular rooms: area, perimeter, corner count, square corners | e.g. BED ROOM 1 156.000 Sft, 50.000 ft | exact | exact |
| CORRIDOR (T-shaped) area | 205.375 Sft | 49.500 (−155.875, **−75.90 %**) | 205.375 (0.000 %) |
| CORRIDOR perimeter / corners | 92.250 ft / 8 | 32.750 (−64.50 %) / 4 | 92.250 / 8 |
| Total floor area, 8 rooms | 1,127.625 Sft | 971.750 (**−13.82 %**) | 1,127.625 (0.000 %) |
| 9" outer walls, centre line | 140.750 ft | 147.875 (+7.125, **+5.06 %**) | 140.750 (0.000 %) |
| 4.5" partitions, centre line (to faces at T's) | 136.250 ft | 136.250 | 136.250 |
| Door / window tags: D1 5, D2 2, D3 1, W1 4, W2 1, V1 2 | 15 tags | correct by the engine; the agents' `count_tags` tool **refused** ("the page changed") | correct, through the agents' tool |
| Zoom 0.3 and 3: three rooms and the 4.5" walls | unchanged | unchanged | unchanged |
| Agent `auto_area_page`: BATH 1 / CORRIDOR (p.1) | 48.000 / 205.375 Sft | 44.010 (**−8.31 %**) / 49.500 (**−75.90 %**) | 48.000 / 205.375 |
| Every measurement's sheet quantity = its outline | ≤ 0.015 | pass | pass |
| Save → reload; export → import | exact | pass | pass |
| Scale note `3/4" = 1'-6"` | 0.5 in/ft | 0.75 (**+50 %** in length) | 0.5 |
| `1:12` / `1:12 RAMP` alone on the sheet | not a scale | read as 1:12 (1 in/ft) | not a scale |
| Viewport rules, counts with no scale, review status | — | not in that build | pass |
| **Whole accuracy test** | | **147 passed, 24 failed** of 171 | **all passed** (see §5.3) |

Measured on this branch before each fix, on the same code as `main` for that path. These cases were probed directly; the test cases that guard them were added with the fixes.

| Case | Reference | Before the fix | After |
|---|---|---|---|
| Room 12 × 14 turned 3° / 8° / 12° / 30° (Auto area) | 168.000 Sft each | 168.000 / 158.537 (**−5.63 %**) / 149.914 (**−10.77 %**) / 168.000 | 168.000 each, 4 corners, no warning |
| The agent measuring washrooms on the page turned 90° (p.3) | BATH 1 48, BATH 2 40 Sft | 45.747 (**−4.69 %**) / 38.751 (**−3.12 %**) | 48.000 / 40.000 |
| BATH 1 traced from its label vs from open floor (p.1) | 48.000 Sft | 44.012 vs 48.000, so the result depended on the click | 48.000 from every click tried (6 points; pockets on or off, squaring on or off) |

### 5.3 Whole regression

The final pass ran on the finished code, 20-Oct-2026, in Chrome under Playwright, with nothing else running. It covered every takeoff suite in `tools/`.

| Result | Suites |
|---|---|
| **All passed** (2,231 numbered checks, plus 7 suites that report "all passed") | `test_takeoff_measure` 62 · `test_takeoff_accuracy` 181 · `test_takeoff_agentcmds` 36 · `test_takeoff` 168 · `_agentflow` 34 · `_appearance` 36 · `_area` 21 · `_autoarea` 21 · `_blend` 15 · `_bluebeam` 27 · `_boost` 10 · `_cad` 80 · `_cadedit` 38 · `_cmdline` 29 · `_columns` 53 · `_coverage` 43 · `_cutout` 26 · `_drawings` 77 (the 42-seed drawing suite: no silent miss) · `_edmode` 31 · `_labels` 54 · `_markup` 80 · `_materials` 56 · `_measure2` 64 · `_overlap` 76 · `_pages2` 55 · `_pdfscale` 22 · `_platform` 61 · `_qa` **460** · `_qsrules` 18 · `_ribbon` 57 · `_smart` 30 · `_split` 76 · `_touch` 14 · `test_trace_engine`, `_legend`, `_trace`, `_verify`, `_walls`, `_walls2`, `_walls3` |
| One check fails, **the same on unchanged `main`** | `test_takeoff_localai`, 46 of 47: "a site not in OLLAMA_ORIGINS is refused". The check opens a hard-coded `http://localhost:8765`, and the test server here ran on another port, so it reports "n/a". It is an environment artefact. |
| One check fails, **the same on unchanged `main`** | `test_takeoff_print`, 74 of 75: "line weights stay as chosen whatever the label size (3.6, 3.6, 3.6, 5.4)". This predates this branch and is not touched by it. |

During development, one run of the QA audit missed its timing limit for "longest freeze during 9 Auto-area traces" (437 ms against 400 ms) while other browser tests ran on the same PC. Run alone it measured 364 ms, and 460 / 460 passed. The new free-standing-box test in `jambLines` is worked out once per wall face, not once per end.

### 5.4 What was not tested

- **No real project drawing was available in this session**, so there is no real-world benchmark. Every figure above is synthetic. The recorded drawing suite (`takeoff/kpi/drawing-tests.json`, 36 conditions) is synthetic too. The last hand reconciliation on real drawings is the one in `docs/takeoff-qs-house-rules.md`, where the block-masonry agent found 1,176 / 512 / 681 ft against 1,285 / 668 / 990 ft by hand. That was not re-run here.
- Scanned drawings were not re-measured beyond the existing suite (`scan-clean` +1.25 %, `scan-faint` +1.44 %, `scan-skewed` +0.24 %). Scanned accuracy is **not** claimed equal to vector accuracy.
- The interactive Verify / Calibrate dialogs inside a viewport were checked by reading the code and through `scaleAt`, not driven click by click.
- The language-model routes (Claude API, claude.ai, Ollama) were exercised through `aiRunTool` and the stand-in Ollama only, not against live models.

## 6. Known limits (not fixed here)

- **Scanned drawings.** Auto area follows the ink (`inkMask`), with no vector lines to snap to; the result is about one image pixel. Calibrate first and review every outline. No image-understanding model runs in the browser. The browser-local `local-ai.js` (Qwen 0.5B through WebLLM) reads text only, is not loaded by any page, and is not a drawing-vision model. The Ollama route can send a view image to a vision model on the user's own PC, but its answers go through the same tools, and quantities never come from the model.
- **Oblique corners** (trapezoids, splayed bays, any two walls meeting more than 5° off square) keep the outline as traced. The sides lie on their wall lines, but the raster's small chamfer at each oblique corner is not repaired: the suite's trapezoid is −0.32 % (168 Sft reference). Right-angled rooms, including turned ones, are squared and exact.
- **"Walls from the PDF's vector lines" (a non-default Auto area mode)** still leaves 4.5 Sft out of the 48 Sft bath around its fixtures. Before the fixes it was 33.6. The default image mode is exact.
- **trace.js** (layered CAD PDFs) keeps tolerances in points (1.8 pt snap, a 6.8 pt default bath wall), so its behaviour changes with plot scale. Its `Lines.match` prefers overlap over distance. Neither was exercised by the apartment, which has no layers.
- **Seeds and leaks.** `seedIn` can still pick a free pixel across a thin wall in a space narrower than the door gap; the passage retry mitigates this. A door threshold is still not taken to the far wall face (house rules, about 2 % per room).
- **The walls agent works on the view by default.** Its reply now says so, and "whole page" measures the page. Re-running it after panning can still leave runs from the old view. The new duplicate check finds these, but they are not removed automatically.
- **The scale check by room sizes** (`scaleFromRooms`) casts its rays along the room name's text box, which lies across on a page turned 90°. On such a page that check can miss a disagreement. The scale itself is unaffected.
- **Scale from dimension strings or room sizes snaps to the nearest standard scale within 2–2.5 %.** On a fit-to-page print that is a systematic error. It stays marked not verified until a dimension is measured.
- **Smaller items:**
  - Paste is not rescaled when two scales differ by ≤ 0.5 %.
  - "Copy scale to…" copies the page scale but not its viewports.
  - DXF export divides each item by its own scale.
  - The `@ A1` paper-size correction reads ISO sizes only (ARCH / ANSI only in the dialog).
- **Snapping tolerance is 11 screen pixels**, as in Bluebeam, so a click snaps to the vector point. The stored point is the exact vector coordinate, so quantities do not depend on zoom; the zoom checks in §5 confirm this.
- **Rounding.** The sheet rounds each dimension to 3 dp before multiplying (`=PRODUCT(D:G)` must reproduce it). That is an error of at most 0.0005 ft per dimension, kept on purpose as the house rule.

## 7. Checking it on a real floor plan

1. Open the plan. Read the scale chip: *From note — not verified* is expected.
2. Press **K**, click both ends of the longest dimension written on the plan, and type it. Then **Verify** a second, independent dimension. If it is off by more than 1 %, stop and find out why (a fit-to-page print, or a viewport) before measuring anything.
3. Agent panel → *measure all rooms on the current floor*. Look at every outline (all marked AI) against the walls.
4. Run *show rooms with incomplete boundaries* and fix each one with **Fence** or by dragging its points. Then run *recalculate the room after I correct its boundary* on each one corrected.
5. Run *give me the linear length of each washroom wall* and compare two or three walls with the plan's own dimensions.
6. Add up two rooms by hand from their written sizes and compare them with the sheet. Click a sheet row: the outline it came from is selected on the drawing.
7. Run *find duplicate or overlapping wall measurements* and *compare manually measured quantities with AI quantities* if anything was also measured by hand.
8. Run *run a quality check before I export the BOQ*. Fix each ❌, look at each ⚠, then ✓ check the page. Only then are the measurements **Verified**.

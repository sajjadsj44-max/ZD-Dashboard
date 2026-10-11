# PDF Takeoff + CAD — audit and upgrade, 11-Oct-2026

Scope: the "master development" brief (PDF Takeoff + AutoCAD-style CAD workspace, default landing page). Rule followed:
**what already exists is kept; what exists but can be improved is improved; what is missing and fits the architecture is
added.** Nothing was rewritten — the audit found the architecture (`takeoff/takeoff.js`, ~11,100 lines; `cad.js` DWG/DXF
reader; IndexedDB storage; pdf.js viewer) able to carry every change made.

Earlier parity review: `docs/takeoff-bluebeam-planswift-parity.md` (02-Oct-2026). This note lists only what was found now.

## 1. Audit — what already works (inspected in code and run by the test suites)

| Area | Already there | Evidence |
|---|---|---|
| PDF | upload, multi-page, thumbnails, page search, fit page / width, wheel zoom, pan, overlays held in drawing coordinates (stay aligned at any zoom / pan / window size), split windows, PDF layers (optional content), locked PDFs (password asked each time, never kept) | `test_takeoff.js`, `test_takeoff_split.js`, `test_lock.js` |
| Scale | read from the drawing's note and dimension strings, calibrate (K), per-page and per-viewport scale, "not verified" warning, measurements on unscaled pages kept out of totals | `test_takeoff_pdfscale.js` |
| Takeoff | length, area, rectangle, circle, count, deduction, opening, auto area, fence, find similar (auto count), volume through H / T, Nos multiplier, house-format sheet (Nos × L × W × H), formulas, assemblies, materials | `test_takeoff_area.js`, `test_takeoff_materials.js` |
| CAD modify | move, copy, duplicate, array, rotate (any angle), scale, stretch, mirror, offset, trim, extend, fillet, chamfer, break, join, explode, close, lock, match properties | `test_takeoff_cadedit.js` (38 ✓) |
| Selection | click, window (L→R), crossing (R→L), lasso, Tab cycling, select all, select similar, AutoCAD-object pick with QSELECT | `test_takeoff_ribbon.js`, `test_takeoff_cad.js` |
| Drafting aids | ortho, polar, object snaps (end, mid, intersection, nearest, centre, tangent), cross-hair, typed lengths (12'-6") | `test_takeoff_smart.js` |
| DWG / DXF | DWG and DXF read in the browser (`cad.js` + worker) with layers, linetypes, blocks, text; DXF export of the takeoff | `test_takeoff_cad.js` |
| Markup / legend / register | notes, clouds, arrows, dimensions, highlights, stamps, Markups list, movable legend, searchable / sortable measurement sheet, bill, opening schedule | `test_takeoff_markup.js` |
| Project | new, rename, edit, duplicate, delete (confirmed), search, backups, import / export JSON, project + PDFs bundle, auto-save, switch | start screen |
| Export | Excel, CSV, marked-up PDF, DXF, JSON | Export tab |
| Commands | Ctrl+K palette with AutoCAD aliases and typed numbers (ro 37, sc 1.5, f 0.5) | `test_takeoff_cadedit.js` |
| AI | takeoff agents (local, no service needed) and optional Claude assistant with the user's own API key; results marked AI until checked | `test_takeoff_qa.js` |

## 2. Gaps found, by priority

| Priority | Gap | Status |
|---|---|---|
| **Critical** | Site address `…/ZD-Dashboard/` opened the dashboard list, not the Takeoff (brief §15) | **Done** — root now opens `takeoff/` |
| High | No persistent AutoCAD-style command line — commands only through the Ctrl+K pop-up | **Done** — status-bar command line |
| High | No Invert selection; no Quick select for measurements / markups (only for DWG objects) | **Done** |
| Medium | No POLYGON (regular n-sided) draw command | **Done** |
| Medium | No "Deselect all" in the page menu | **Done** |
| Medium | ELLIPSE, SPLINE, XLINE / RAY, MLINE, DONUT | Not done — need a new curve entity type through every quantity path (sheet, offset, trim, DXF); today they can be traced with Draw + A (arc) |
| Medium | User-created CAD layers for drawn geometry (lock / colour / linetype per layer) | Not done — conditions act as the takeoff layers (colour, visibility, select by condition); markups have their own layers; DWG layers are read-only views |
| Medium | Grid display / grid snap | Not done |
| Medium | Rotating the page view (90° steps) | Not done — every overlay, snap and export works in the PDF page's own coordinates; a view rotation must go through all of them |
| Low | SVG import / export of geometry | Not done (SVG is used inside the PDF export only) |
| Low | Full menu bar (File / Edit / View…) in place of the ribbon tabs | Not done — the ribbon already groups the same commands; changing it would move every tool users know |
| — | Native DWG **write** | Not claimed. DWG is read; takeoff goes out as DXF |

## 3. What was changed

| File | Change | Why |
|---|---|---|
| `index.html` (root) | Replaced by a redirect page: `location.replace("takeoff/" + search + hash)`, meta refresh and a plain link as fallbacks | Brief §15 — the site address opens the Takeoff workspace (its start screen lists saved projects) |
| `dashboards/index.html` | The former root page, links made `../…` | Keep the dashboards list; every dashboard keeps its own URL |
| `drawing-tracker/index.html` | "All dashboards" → `../dashboards/` | Its back link pointed at the old root |
| `takeoff/index.html` | Command line in the status bar; Polygon button + icon; "All dashboards" link on the start screen; script `?v=2026-10-11h` | New features; cache-buster per CLAUDE.md |
| `takeoff/takeoff.js` | `cmdRun` / `cmdFind` / `cmdWire` (command line), `polyPts` / `polySides` + polygon tool, `invertSel`, `quickSelect`, `clearSel`; aliases `pol`, `qs`, `qselect`, `inv`; typed `pol N`; Keys help updated | Gaps above |
| `tools/test_root.js` | New | Landing, no redirect loop, every dashboard link |
| `tools/test_takeoff_cmdline.js` | New | Command line, polygon geometry, selection |
| `tools/test_lock.js` | Checks `dashboards/` instead of the old root page | The root page no longer carries the lock (it hands over to `takeoff/`, which does) |
| `README.md` | Landing page, command line, polygon, selection | Docs |

No storage format changed: polygons are saved as ordinary outlines, so older projects and older copies of the app read them.
IndexedDB is per site (origin), so moving the landing page does not touch saved projects.

## 4. Measurement checks (known geometry, fixture at 9 pt per ft)

| Test | Expected | Result |
|---|---|---|
| Hexagon, circumradius 10.000 ft — side | 10.000 ft | 10.000 ft ✓ |
| Hexagon — area (3√3 / 2 × 10²) | 259.808 Sft | 259.808 Sft on the sheet ✓ |
| Square run, circumradius 5.000 ft — perimeter (4 × 5√2) | 28.284 ft | 28.284 ft ✓, run closed (5 points) |
| Trim / extend / fillet / chamfer / rotate / scale (existing suite) | as hand-worked | 38 / 38 ✓ |

## 5. Limitations (stated plainly)

- Projects and PDFs live in the browser's IndexedDB on one device — not cloud storage. Export → Project + PDFs moves them.
- A PDF is a reference drawing, not an editable DWG: its lines are snapped to and can be taken off, but not edited. DWG / DXF
  files are read with their layers and objects; edits made in AutoCAD mode are kept as an edit layer in the project, and the
  takeoff exports as DXF. The DWG file itself is never rewritten.
- The Claude assistant needs the user's own API key and internet; the local agents and every manual tool work without it.

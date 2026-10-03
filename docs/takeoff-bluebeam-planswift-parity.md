# PDF Takeoff — Bluebeam Revu / PlanSwift feature parity

Reviewed 02-Oct-2026 against the latest versions:

- **Bluebeam Revu 21** (Basics / Core / Complete) and **Bluebeam Max** (announced at Unbound, Oct 2025; global launch early 2026).
- **PlanSwift 11** — current build **v11.0.0.191, 21-Sep-2026**, with **Takeoff Boost** AI tools (release notes 06-May-2026).

Sources are listed at the end. The vendors' help pages could not be opened from the build machine (network policy), so the
behaviour below is taken from their published help text as returned by search, and is marked as such.

Status in ZD PDF Takeoff: **✓** had before this upgrade · **★** added in this upgrade · **◐** partly · **✗** not yet.

## 1. Selecting (mouse)

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Click to select; Shift+click adds / removes | ✓ | ✓ | ✓ (Ctrl+click too ★) |
| Box left → right selects what is **wholly inside** (window) | ✓ | — | ★ blue solid box |
| Box right → left selects what it **touches** (crossing) | ✓ | — | ★ green dashed box |
| Lasso select (Shift+O) | ✓ | — | ★ Lasso tool, Shift+O |
| Select all (Ctrl+A) | ✓ | ✓ | ✓ |
| Select all of one kind ("select similar") | ✓ (markups list filter) | ✓ (by item) | ★ right-click → Select all "…" on this page |
| Hover highlight + tooltip of the quantity | ✓ | ◐ | ★ glow + "BED ROOM · Floor area · 168.00 Sft" |
| Step through objects on top of each other | — | — | ★ Tab |
| Selection totals | ✓ (markups list) | ✓ | ★ "Selected: Floor area 312.00 Sft · Doors 4 Nos" |

## 2. Moving, copying, pasting

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Drag a markup to move it; Shift = straight | ✓ | ✓ | ★ (the grabbed point snaps to the drawing) |
| Alt+drag moves without selecting first | ✓ | — | ★ |
| Ctrl+drag copies | ✓ | — | ★ |
| Arrow keys nudge | ✓ | ✓ | ✓ |
| Copy / cut / paste at the cursor | ✓ | ✓ | ★ multi-selection, markups too, any page; pasted at the **same real size** when the page scale differs |
| Paste in place (same spot on another sheet) | ✓ | ✓ | ★ Ctrl+Shift+V |
| Duplicate | ✓ | ✓ | ★ Ctrl+D |
| Click to place several copies | — | ✓ (Ctrl+click) | ★ right-click → Place copies by clicking |
| Copy at a distance / array (Ctrl + arrow, Advanced Copy) | — | ✓ | ★ Ctrl+arrow: copies across / down by distances in ft |
| Copy to other pages / typical floors | ✓ (apply to pages) | ✓ (typical groups) | ✓ Typical (aligned or same place) + ★ selection → Copy to other pages |
| Rotate 90°, flip | ✓ | ✓ (mirror / rotate) | ★ right-click → Arrange / rotate |
| Bring to front / send to back | ✓ | — | ★ |
| Lock (Ctrl+Shift+L) | ✓ | — | ★ locked objects are not moved, edited or deleted |
| Group / ungroup (Ctrl+G) | ✓ | — | ✗ — multi-selection and conditions cover it |

## 3. Drawing and undo

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Ctrl+Z / Backspace takes back the last click while drawing | ✓ | ✓ | ✓ — now step-based ★: an arc is one step, **Ctrl+Y puts it back**, Ctrl+Z during a drag cancels it |
| Named undo / redo (what will be undone) | ◐ | — | ★ "Undo: Move 3 objects" on the button and in a toast; 200 steps |
| Shift = ortho (0° / 90°) | ✓ | ✓ | ✓ |
| Override snap while placing a point | ✓ (Ctrl) | — | ★ Ctrl+click |
| Arc segments while drawing | ✓ (convert point to arc) | ✓ ("A" = arc point) | ★ A, point on the arc, its end — one leg on the sheet |
| Type the length of the next segment (sketch to scale) | ✓ | — | ★ type 12'-6" + Enter; rectangle: L x W |
| Resume / continue a polyline | ✓ (right-click endpoint → Resume) | ✓ (New section) | ★ right-click → Continue drawing this run |
| Finish: Enter / double-click / right-click | ✓ | ✓ | ✓ |

## 4. Editing what is drawn

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Drag a point (control point) | ✓ | ✓ | ✓ — now only after a 3 px drag (a click does not move it) and it no longer snaps onto itself ★ |
| Add a point | ✓ Shift+click a segment | ✓ right-click | ★ double-click a side · Shift+click · drag the **+** at a side's middle · right-click |
| Remove a point | ✓ Shift+click the point | ✓ select + Del | ★ double-click the point · Shift+click · select it + Delete · right-click |
| Break a line in two | — | ✓ | ★ Break tool (B) or right-click → Break here |
| Delete one segment | — | ✓ | ★ Shift+click with Break, or right-click |
| Cut a gap out of a run (a door across skirting) | — | ◐ | ★ right-click → Cut a gap from here… |
| Join runs | — | ◐ | ★ select runs → Join (gaps bridged and reported) |
| Explode a run into one row per segment | ◐ | ✓ (segment takeoff) | ★ right-click → Explode into segments |
| Close a run into a loop | ✓ | ✓ | ★ |
| Offset (parallel copy / grow-shrink outline) | ◐ | ✓ (offset) | ★ Offset… (default: half the condition's thickness) |
| Cut-out / deduction | ✓ | ✓ | ✓ Deduct (D); ★ right-click → Add a cut-out |
| Area outline → perimeter run (skirting, plaster) | ◐ | — | ★ right-click → Make a perimeter run in… |
| Run → area | — | — | ★ right-click → Make an area in… |
| Move to another condition / item | ✓ | ✓ | ✓ (and in the menu ★) |

## 5. Right-click menu

| On | ZD Takeoff (★ all new) |
|---|---|
| A measurement | Properties, Rename (F2) · add / delete point · break, delete segment, cut a gap, continue, explode, close · offset · cut-out / opening · make a perimeter run / an area · cut, copy, paste, paste in place, duplicate, array, place copies, copy to pages · arrange / rotate / flip · lock · move to condition · select all of this condition · condition (edit, colour, hide, show only, show all, draw more) · mark checked / needs recheck · zoom to · delete |
| Several selected | The same, acting on all of them, with their totals in the header, and Join N runs |
| A markup | Edit text, colour, clipboard, arrange, lock, select all of the type, zoom to, delete |
| The empty drawing | Paste here / in place, select all, undo / redo (named), tools, view (fit, zoom window, labels, snap, markups), shortcuts |
| Touch (tablet) | press and hold opens the same menu |

A right-drag still pans; only a right-click without dragging opens the menu, and a right-click while drawing still finishes the shape.

## 6. Counting doors and windows (AI / auto count)

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Symbol search across pages | ✓ VisualSearch | ✓ Auto Count (Takeoff Boost, up to 10 pages) | ✓ Find similar (page or PDF) |
| Count tag text | ◐ (text search) | ✓ (label matching) | ★ **every spelling**: D1, D-1, D.01, DR-02, DOOR 3, SD / FD / FRD / MD / GD / AD / DD / RS…, W1, WN-2, WIN 3, WINDOW 4, KW / TW / BW / CW / SW / FW / AW / SKY…, V1, VT, VENT 1, LV, DW, primed W1', suffix W1A; D-01 = D1 |
| Tags written in two pieces (letter over number in a circle) | — | — | ★ joined |
| Leave schedule-table marks out of the count | — | — | ★ rows with a size, and columns of marks |
| Read sizes and quantity from the door / window schedule | — | — | ★ ft-in, inches, decimal ft, mm (converted to ft); schedule qty ≠ count is flagged; sizes go to the opening schedule |
| This page / every page of the PDF / whole project | ◐ | ✓ | ★ |
| Review before counting | ✓ | ✓ ("verify the matches") | ★ tick what to count; markers flagged AI until checked |
| Count doors from swing symbols (no tags) | — | ◐ (Auto Takeoff counts) | ★ swing arcs 1.2–6 ft; double doors as one |
| Natural-language agent ("count all doors") | ✓ Bluebeam Max (Claude) | — | ✓ Claude panel + free agent: *count doors on all pages*, *count door swings* |

## 6b. Pages, view and scale (added in the QA pass, 02-Oct-2026)

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Page thumbnails / page navigator | ✓ Thumbnails panel | ✓ Pages tab | ★ Pages tab: every PDF, thumbnails drawn as they scroll into view, scale status and measurement count per page |
| Fit page / fit width | ✓ | ✓ | ✓ fit page (`F`) + ★ fit width (`Shift+F`), View menu |
| First / last page | ✓ | ✓ | ★ Home / End |
| Pick a standard scale from a list | ✓ | ✓ | ★ architectural, engineering, metric ratio, typed; with the paper size it was drawn for (ISO / ARCH / ANSI) |
| Scale checked against dimensions on the sheet | — | ◐ Auto Scale (Takeoff Boost) | ★ room sizes written on the sheet measured across each room; a wrong note is flagged with the scale most rooms agree with |
| Password-protected PDFs | ✓ | ✓ | ★ asks for the open password; marked-up export flattened |
| Remove a PDF from the project | ✓ | ✓ | ★ (backup first) |

## 7. Not in ZD Takeoff yet (and why)

| Feature | Where | Note |
|---|---|---|
| Studio sessions (live multi-user markup) | Bluebeam | The takeoff is private by design (browser storage); projects move as JSON. |
| Quantity Link (live link to Excel cells) | Bluebeam Complete | Excel export is formula-driven instead (PRODUCT / SUM in the house format). |
| Stitching sheets, Smart Overlay with AI, AI-REVIEW / AI-MATCH | Bluebeam Max | Compare (colour overlay of two revisions) and Revision compare (quantities) cover the QS side. |
| Auto Bookmark | PlanSwift Takeoff Boost | Sheet info (sheet no., title, revision, floor) is entered per page. |
| OCR of scanned drawings | both | Scanned PDFs measure but have no text or lines to read. |
| Slope / pitch factor on areas | both | Use the assembly formula on the condition. |
| Group / ungroup | Bluebeam | Multi-select and conditions instead. |
| Reorder / rotate / delete pages inside a PDF | both | The PDF is kept as issued; a turned page is shown as the PDF turns it. |

## Sources (searched 02-Oct-2026)

- Bluebeam — Use modifier keys (Alt moves, Ctrl overrides snap / Ctrl+drag copies, Shift straight): https://support.bluebeam.com/revu/how-to/tips-and-tricks/use-modifier-keys.html
- Bluebeam — Select markups (left → right inside, right → left touching; Lasso Shift+O): https://support.bluebeam.com/revu/how-to/select-markups.html
- Bluebeam — Control points (Shift+click adds / removes a point, Ctrl+click converts to arc): https://support.bluebeam.com/user-manual/menus/tools/control-points.html
- Bluebeam — Keyboard shortcuts (Ctrl+Shift+L lock, Ctrl+G group, flip): https://support.bluebeam.com/resources/pdfs/keyboard-shortcuts.pdf
- Bluebeam — Polylength (resume from an endpoint): https://support.bluebeam.com/online-help/revu21/Content/RevuHelp/Menus/Tools/Measure/Polylength--MTV.htm
- Bluebeam — Bluebeam Max at Unbound 2025 (Claude integration, AI-REVIEW / AI-MATCH, Magic Markups, Stitching, Smart Overlay): https://press.bluebeam.com/2025/10/bluebeam-unveils-bluebeam-max-next-generation-ai-powered-innovations-at-unbound-2025/
- PlanSwift — Takeoff Boost release notes, 06-May-2026 (Auto Takeoff, Auto Count, Auto Scale, Auto Bookmark): https://help.constructconnect.com/latest-product-reveal-release-notes-229/planswift-with-takeoff-boost-ai-powered-tools-release-notes-2026-05-06-2752
- PlanSwift — release v11.0.0.191, 21-Sep-2026: https://www.planswift.com/release/
- PlanSwift — Auto Count (box a symbol, shape or label matching, up to 10 pages, verify): https://www.planswift.com/features/auto-count/
- PlanSwift — Keyboard hotkeys (Backspace last point, A arc point, N new section, Shift ortho, Ctrl+arrow copies): https://constructconnect-help.atlassian.net/wiki/spaces/PSUPPORT/pages/49545397/Settings+Tab:+Keyboard+Hotkeys
- PlanSwift — Copying and pasting takeoffs / Advanced Copy Pro (array, mirror, rotate, Ctrl+click copies): https://help.constructconnect.com/03-a-detailed-look-at-the-home-tab-and-drawing-takeoff-and-annotations-176/planswift-03-12-12-copying-and-pasting-takeoffs-1491

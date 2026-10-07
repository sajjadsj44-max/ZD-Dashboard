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
| Natural-language agent ("count all doors") | ✓ Bluebeam Max (Claude) | — | ✓ Claude panel + free agent: *count doors on all pages*, *count door swings*; chained commands, *how many D1*, *total floor area* answered from the takeoff |
| One-click full takeoff (rooms, walls, doors / windows, finishes) over a page, PDF or project | ◐ Max (prompted) | ◐ Auto Takeoff (per item) | ★ ⚡ free, no API key; one report; one Ctrl+Z; doubtful-scale pages skipped |
| Room finishes from the room outlines (plaster / paint, skirting, ceiling) | — | ◐ assemblies | ★ 🎨 per room, every door and window its own deduction row; sizes from the opening schedule, never assumed |
| Takeoff audit (missed rooms, double measures, uncounted tags, schedule qty) | — | — | ★ ✅ each finding with Show / fix |

## 6b. Pages, view and scale (added in the QA pass, 02-Oct-2026)

| Feature | Bluebeam | PlanSwift | ZD Takeoff |
|---|---|---|---|
| Page thumbnails / page navigator | ✓ Thumbnails panel | ✓ Pages tab | ★ Pages tab: searchable sheet cards for every PDF page, thumbnails drawn as they scroll into view, sheet number / title, scale and measurement count; edit sheet info or run OCR |
| Fit page / fit width | ✓ | ✓ | ✓ fit page (`F`) + ★ fit width (`Shift+F`), View menu |
| First / last page | ✓ | ✓ | ★ Home / End |
| Pick a standard scale from a list | ✓ | ✓ | ★ architectural, engineering, metric ratio, typed; with the paper size it was drawn for (ISO / ARCH / ANSI) |
| Scale checked against dimensions on the sheet | — | ◐ Auto Scale (Takeoff Boost) | ★ room sizes written on the sheet measured across each room; a wrong note is flagged with the scale most rooms agree with |
| Password-protected PDFs | ✓ | ✓ | ★ asks for the open password; marked-up export flattened |
| Remove a PDF from the project | ✓ | ✓ | ★ (backup first) |

## 6c. Pages, AI and Forma Takeoff 2D (added 05-Oct-2026)

Reviewed 04/05-Oct-2026 against **Autodesk Forma Takeoff** (formerly Autodesk Takeoff) 2D workflow and **Forma Data
Management** (formerly Autodesk Docs) — the "Learn Forma Data Management and Takeoff in 90 minutes" course content —
plus the AI features of **Bluebeam Max** (global launch 19-May-2026), **PlanSwift Takeoff Boost**, **Togal.AI** and **Kreo**.

| Feature | Forma Takeoff / Data Mgmt | Bluebeam / PlanSwift / AI tools | ZD Takeoff |
|---|---|---|---|
| Sheets panel: search, filter (with takeoff…), sort, bookmark | ✓ Sheets & Models panel | ✓ Thumbnails | ★ Pages tab: search sheet no. / title / PDF; filter with takeoff, no takeoff, no scale, not verified, pinned, read by OCR, version set; sort by drawing order, sheet no., title, most measured; ★ pin |
| Select several sheets at once | ✓ | ✓ | ★ tick pages (Shift+click a range, Ctrl+click a thumbnail, tick all shown, tick pages with takeoff) → Export / Sheet info / OCR / Pin |
| Export sheets with takeoff to PDF: this sheet / all with takeoff / selected; filter by takeoff type; legend with or without quantities, S / M / L, in the margin | ✓ Export sheets to PDF | ◐ Bluebeam Flatten / Batch | ★ Export pages: this page · pages with takeoff · ticked pages · every page · choose by range (1-3, 7) per PDF; condition filter; legend on the drawing (any corner) or in a margin strip (Forma style), quantities on / off, S / M / L; title stamp; fade the drawing |
| Formats and quality | PDF | Bluebeam Export → Image (PNG / JPEG, page range) | ★ one PDF (each drawing stays the original vector page), a PDF per page (.zip), PNG (.zip) or JPEG (.zip) at 150–600 DPI — as large as the browser can hold, and said when capped |
| Upload many PDFs; version set (name + issue date); sheet numbers and titles extracted, reviewed before publishing | ✓ Publish sheets | ◐ | ★ Import: several PDFs or a folder, tick the pages wanted (thumbnails, range, or "pages saying PLAN"), version set + issue date kept per PDF, then sheet info read and reviewed |
| Extract pages and attributes (title block template: capture areas for sheet no., title; OCR) | ✓ Forma Data Mgmt | ✓ Bluebeam AutoMark, PlanSwift Auto Bookmark, Kreo / Togal AI renaming | ★ Sheet info from the title blocks: by labels and the title block's place, or inside capture areas dragged once (a template for pages of the same paper size); sheet no., title, revision (the latest in the block), floor (from the title), discipline (from the sheet no.'s letters); every value shown for checking |
| OCR of scanned drawings | ✓ (title block extraction) | ✓ | ★ Tesseract OCR in the browser (free, nothing uploaded): the words found work as the page's text — Find, the agents, scale notes (1:100 read off a scan), tags, sheet info; kept with the project |
| Photos / scans as sheets | — | ◐ | ★ JPG / PNG added as pages at their scan DPI (read from the file), so a scan comes in at its paper size |
| Automatic hyperlinks between sheet callouts and sheets | ✓ | ◐ Bluebeam links | ★ a sheet no. written on the drawing (A-301, 3/A-301) opens that sheet: double-click it, or right-click → Open sheet / Sheets referenced on this page |
| Symbol detection (box a symbol, 90° turns, review, save the ticked) | ✓ | ✓ VisualSearch, Auto Count | ✓ Find similar (already) |
| Cutout: an area over another takes out the overlap | ✓ | ◐ | ★ right-click → Cut out of the area it overlaps: the overlapping part becomes a deduction in that area's condition, the area itself stays |
| Minimap | ✓ | — | ★ View → Minimap (shows when zoomed in; click or drag to move) |
| Full screen | ✓ | ✓ | ★ View → Full screen, Workspace menu |
| Inventory grouped by document / sheet | ✓ Group by Document | — | ★ Bill → Group by drawing (PDF) or by sheet / page (as well as building / floor) |
| Reports (inventory report, cover page, PDF) | ✓ Reports | ◐ | ★ Export → Report (print / save as PDF): summary, quantities by condition (gross, deductions, net), by floor, the bill, drawings measured with QA and scale, the takeoff check |
| Natural-language assistant | — | ✓ Bluebeam Max (Claude), Kreo Caddie, Togal.CHAT | ✓ Claude (API key) and the free agents + ★ page commands: *export pages with takeoff to pdf*, *export all pages as png 300 dpi*, *read sheet info*, *ocr this page*, *select pages 1-5*, *go to A-101*, *import pdfs*, *report*, *focus mode*; an unknown command offers the matching commands by name |
| Workspace / command access | ✓ | ✓ Bluebeam profiles | ★ Workspace menu: takeoff, drawing only, pages + drawing, check layouts; icons-only toolbar; minimap; full screen; thumbnail size; ★ ⌘ Commands button (Ctrl+K palette) |

## 6d. Bluebeam Revu Basics — every feature of the plan (reviewed 06/07-Oct-2026)

Checked against Bluebeam's own plan table (bluebeam.com/pricing, *Compare plans*, Basics column). **★** added in the
markup-tools release (07-Oct-2026) · **✓** already in · **◐** partly · **→ n** coming in part *n* of this work
(3 pages and documents, 4 workspace and import) · **n/a** desktop / cloud only.

| Bluebeam Basics | ZD Takeoff |
|---|---|
| Mark up PDFs with text, highlighters, shapes, stamps and vector pen annotations | ★ text box, callout, line, polyline, polygon, rectangle, ellipse, pen, highlighter pen, stamps, image · ✓ note, cloud, arrow, highlight, dimension |
| Track and manage annotations; view, filter and sort markups and comments in the Markups List | ★ Markups list (Alt+L): this page or all pages, sort by any column, search, filter by type / status / author / layer / space; replies signed with your name |
| Save and reuse tools from the Tool Chest; subject and comment; scale on tool sets | ✓ Tool Chest (Phase 1) · ★ every new markup tool saves to it · ★ sizes in page units, so a tool keeps its printed size |
| Make markups on captured photos | ✓ photos / scans added as pages |
| Multiply markups | ✓ array, place copies, copy to pages |
| Assign markups to layers | ★ markup layers (Layers tab): hidden on the drawing and in exports |
| Flatten PDF markups | ✓ every PDF / PNG / JPEG export |
| Import PDF markups | → 4 |
| Redact PDF content permanently | ★ redaction: the exported page is flattened, what is under the box is gone |
| Translate markups | ◐ the Claude panel (API key) translates text on request |
| Create and add dynamic stamps | ★ 16 standard stamps, your own text and picture stamps, `{name} {date} {time} {project} {sheet} {page}` |
| 2D photo markups, photos and 360° photos / videos in markups (Capture) | ◐ ★ file attachment pins (any file, opened in the browser or saved) → 4 photos on any markup |
| Hyperlinks, a hyperlink on an area | ★ to a web page or a page of the project; real links in exported PDFs · ✓ sheet callouts open their sheet |
| Custom Markups List filters | ★ saved with the project |
| Calibrate tool sets to resize with the scale / viewport | ◐ markup sizes are in page units; viewports ✓ |
| Markup legends in the Tool Chest | ✓ export legend · → 3 a legend markup |
| Custom hatch patterns | ★ 11 patterns + custom angle, spacing, line, crossed, colour |
| Sketch to Scale: polygons, polylines, rectangles, ellipses | ✓ measurements (typed lengths, L x W) · ★ polyline / polygon markups take typed lengths |
| Custom statuses | ★ Bluebeam's statuses and your own, set in Properties or the list |
| Measure length and area; viewports of other scales | ✓ |
| Headers and footers | → 3 |
| Combine documents into one PDF; split documents; insert pages of another PDF | ✓ Export pages (one PDF / a PDF per page), import with page choice |
| Size of new pages, resize pages | → 3 blank pages |
| Embed file attachments | ★ file attachment markups, inside exported PDFs |
| Erase and cut PDF content | ★ erase (white-out), applied in exports |
| Extract, delete, rotate and insert blank pages | ✓ extract (export pages) → 3 rotate, remove, blank pages |
| Table of contents from bookmarks; bookmarks and page labels by hand and automatically | ◐ sheet numbers / titles read from title blocks ✓ → 3 bookmarks, PDF outline, contents page |
| Reduce file size | ✓ export resolution 150–600 DPI |
| Create and edit form fields; fill PDF forms | → 3 |
| Compare revisions with overlay pages | ✓ Compare (colour overlay) |
| Process colours | ✓ black and white, monochrome, dimming, black background |
| Sets (navigate many PDFs as one) | ✓ the project's Pages tab, version sets |
| Change markup properties and save them for reuse | ★ Properties for every markup, Set as default for every kind |
| Customise keyboard shortcuts and toolbars | ◐ workspace layouts ✓ → 4 |
| OCR | ✓ Tesseract in the browser |
| VisualSearch (symbols) | ✓ Find similar |
| PDF / CSV / XML summary of markups; reports on markups in regions (Spaces) | ★ CSV, XML, printable PDF with a picture of each markup · ★ Spaces: the named room each markup sits in |
| Digital signatures; track signatures | ◐ ★ picture stamps of a signature (not a certified digital ID) |
| Password protection and permissions | → 3 password-protected exports (the password asked, never kept) |
| Multiple windows, recent files, multi-monitor, local drive search | n/a desktop · ✓ projects list, a second browser tab |
| Office / SharePoint / ProjectWise plug-ins, PDF printer, scanned PDF to Word / Excel | n/a desktop |
| Studio Sessions and Projects, Bluebeam Cloud, DMS links | n/a cloud — the takeoff stays in this browser by design; Project + PDFs moves it |

## 6e. Toolbar review — grouped ribbon, Modify tools, Ortho / Polar, sheet search (07-Oct-2026)

A full review of the toolbar and the measurement sheet, prompted by a feature-gap review (Bluebeam Revu, Autodesk Forma Takeoff,
PlanSwift / ConstructConnect). The vendor behaviour in that review was **not re-checked against vendor pages in this session** —
what is listed here is what the app now does, each item covered by `tools/test_takeoff_ribbon.js`.

**The mess that was found:** 35 buttons in one wrapping row (Unicode symbols that draw differently on Windows / Android / Mac), the
editing tools (rotate, mirror, join, explode, close, offset, array) only in the right-click menu, no way to switch Ortho on
(Shift only), no choice of object snaps, no search or sort on the measurement sheet, "Next unchecked" but no "Previous".

| Change | Where |
|---|---|
| Toolbar in **groups (tabs)**: Takeoff · Modify · Markup · Review; Select / Match / Lasso / Pan always on show; the tab follows the tool (press W → Takeoff, N → Markup) | toolbar |
| **SVG icons** (one stroke style, drawn with the text colour) in place of Unicode symbols; names + shortcuts in the tooltips; names shown beside the icons when the drawing area is wide enough (≥ 1020 px), icons only when it is narrow | toolbar |
| **Modify tab**: Move · Copy / Place copies · Duplicate · Array… · Rotate (both ways) · Mirror H / V · To front · Offset… · Break · Join · Explode · Close · Lock — each acts on the selection and says what to select when nothing is | toolbar |
| **Review tab**: Previous / Next unchecked · Check selected · Check page · Recheck · Check before export · Compare · Typical | toolbar |
| **Ortho (F8)** and **Polar (F10)** switches (as AutoCAD: one turns the other off); Shift frees one click while Ortho is on; Polar pulls a direction within 4° of every 5° / 10° / 15° / 30° / 45° / 90° onto it (object snaps win) | toolbar, status bar |
| **Object snap list** (Snap ▾): endpoint, midpoint, intersection, **perpendicular to the last point (new)**, nearest; the choice is kept in the browser; Ctrl+click still places a point with no snap | toolbar |
| Quick measure shows the **corner angle** at the last corner as well as the direction of the leg | status bar |
| **Measurement sheet: search** (every word must match item, condition, BOQ code, unit, page or room) and **sort** (drawing order · by page · largest first · name); the totals stay the whole condition's; "3 of 12 shown" | right panel |
| QA bar: **Prev** next to Next unchecked, and a **no BOQ code** count | right panel |
| Commands (Ctrl+K) find every new button, Ortho, Polar, Object snaps and "Search the measurement sheet" | palette |

**Still not in the app** (from the same review, in the order they would pay back): sheet column chooser / custom and formula columns
(waste %, gross qty); Quick Line (click a wall → whole connected run) and Quick Box (box → largest room / all walls); a Volume
measurement; dynamic Auto-area naming rules; Revision Manager (replace a sheet, keep the takeoff, flag changed quantities, cost delta);
sheet reorder / rotate / delete; legend column width / order; material · labour · equipment split in the bill; Firefox / Safari / touch
testing. None of these was started — each needs its own design.

## 7. Not in ZD Takeoff yet (and why)

| Feature | Where | Note |
|---|---|---|
| Studio sessions (live multi-user markup) | Bluebeam | The takeoff is private by design (browser storage); projects move as JSON. |
| Quantity Link (live link to Excel cells) | Bluebeam Complete | Excel export is formula-driven instead (PRODUCT / SUM in the house format). |
| Stitching sheets, Smart Overlay with AI, AI-REVIEW / AI-MATCH | Bluebeam Max | Compare (colour overlay of two revisions) and Revision compare (quantities) cover the QS side. |
| Combine areas (union of two outlines) | Forma Takeoff | Cut-out is there; a union of irregular outlines needs a polygon-clipping library — measure the combined outline instead. |
| Packages / 3D (BIM) takeoff | Forma Takeoff | Conditions with BOQ codes and the bill's groups play the package's part; the takeoff is 2D PDF only. |
| Slope / pitch factor on areas | both | Use the assembly formula on the condition. |
| Group / ungroup | Bluebeam | Multi-select and conditions instead. |
| Reorder / rotate / delete pages inside a PDF | both | The PDF is kept as issued (import can leave pages out); a turned page is shown as the PDF turns it. |

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

## Sources for 6d (06-Oct-2026)

- Bluebeam — plans and pricing, *Compare plans* table (Basics / Core / Complete / Max): https://www.bluebeam.com/pricing/
- SolidCAD — Bluebeam plans comparison, Basics vs Core vs Complete vs Max: https://blog.solidcad.ca/en/bluebeam-plans-comparison-basics-vs-core-vs-complete-vs-max

## Sources for 6c (searched 04/05-Oct-2026)

- Autodesk — Learn Forma Data Management and Takeoff in 90 minutes (course, available until 15-Oct-2026): https://www.autodesk.com/learn/ondemand/course/learn-docs-and-takeoff-in-90-minutes
- Autodesk Forma Takeoff help (via Autodesk Product Help search): Export Sheets to PDF in Takeoff; Work with Sheets & Models in the Takeoff Viewer; Viewer Tools (Combine, Cutout, Minimap, Symbol Detection, Full Screen); Symbol Detection; Perform Takeoff on 2D Sheets; Publish 2D Files as Sheets; Takeoff Types; Inventory; Takeoff Reports; Comparing Sheets in the Takeoff Viewer; Formulas in Takeoff; Perform Area Takeoff With Quick Fill (Beta)
- Autodesk Forma Data Management — Automated Drawing Extraction / Extract Pages and Attributes / Title Block Templates: https://help.autodesk.com/view/DOCS/ENU/?guid=Automated_Drawing_Extraction
- Autodesk — AI features in Autodesk Forma (Symbol Detection in Takeoff, Autodesk Assistant…): https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/AI-features-in-Autodesk-Construction-Cloud.html
- Bluebeam Max global launch, 19-May-2026 (Claude via MCP, Stitching, Magic Markups, Smart Overlay, Smart Review): https://press.bluebeam.com/2026/05/bluebeam-max-launches-globally-bringing-ai-powered-productivity-to-aec-teams-everywhere/
- Bluebeam Revu — AutoMark page labels from a page region; Export → Image (PNG / JPEG, page range): https://novedge.com/blogs/design-news/bluebeam-tip-batch-auto-rename-in-bluebeam-revu-using-page-labels
- PlanSwift Takeoff Boost (Auto Takeoff, Auto Count, Auto Scale, Auto Bookmark), 06-May-2026: https://help.constructconnect.com/latest-product-reveal-release-notes-229/planswift-with-takeoff-boost-ai-powered-tools-release-notes-2026-05-06-2752
- Kreo — AI construction takeoff (Auto Measure, One-Click Area, Auto Count, Caddie, AI renaming, AI scale, PDF export): https://www.kreo.net/solutions/ai-construction-takeoff-sofware
- Togal.AI — auto-naming of drawings, text / image / pattern search, Togal.CHAT, compare: https://www.togal.ai/

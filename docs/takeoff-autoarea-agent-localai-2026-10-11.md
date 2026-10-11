# Auto Area, Takeoff Agent and free local AI: research, audit and upgrade (11-Oct-2026)

This covers the "Advanced Auto Area + Takeoff Agent + free offline AI" brief, which arrived in two parts:
- **Phases 1–4.3** — sections 1–8 below.
- **§4.4 and Phases 5–9** — sections 9–15.
The rule followed throughout: what works is kept, what can be improved is improved, and what is missing and fits is added.

## 1. Research (what was consulted, and how)

The vendor sites (bluebeam.com, kreo.net, togal.ai, construction.autodesk.com) and docs.ollama.com could not be opened
from the build machine because its network policy blocks them. Their behaviour below comes from web-search summaries of
their own help pages, marked as such. Nothing here is copied from them.

| Source | Date | What it showed | Lesson for this app |
|---|---|---|---|
| Bluebeam Cutout tool — [support.bluebeam.com/…/cutout-tool](https://support.bluebeam.com/fi/user-manual/menus/tools/cutout-tool.html) (search summary) | current manual | Cutouts subtract polygons / ellipses from an Area or Volume; a cutout can become its own area | Already here: Cut-out / Deduct as their own rows |
| Bluebeam Dynamic Fill — [novedge tips](https://novedge.com/blogs/design-news/bluebeam-tip-enhance-efficiency-with-dynamic-fill-for-accurate-area-calculations-in-bluebeam-revu) (third-party) | 2025–26 | Click inside a region and Revu fills it from the boundary; extra boundary lines ("caps") close openings and voids | Same idea as Auto area plus the Fence; the missing part was **seeing the outline before accepting it**, which this upgrade adds |
| Togal help — [The Togal button](https://intercom.help/togalai-dc6fc0bc1374/en/articles/15602961-the-togal-button-togal-s-automated-takeoff), [AI features](https://help.togal.ai/ai-features) (search summary) | current | One button produces areas, lines and counts into a quantities panel, then the user reviews, reclassifies and edits. Togal.CHAT answers questions about the plans | Results must stay **editable, reviewable and traceable**. Chat answers must come from the project |
| Togal FAQ — [togal.ai/faq](https://www.togal.ai/faq) | current | Claims 98 % accuracy and that it "learns from corrections" | A vendor claim, not verified. This app labels everything AI-made for checking instead of claiming an accuracy |
| Kreo reviews — [GetApp](https://www.getapp.co.uk/software/2058370/kreo-2d-takeoff), [Capterra](https://www.capterra.in/reviews/1014073/kreo-2d-takeoff) | 2025–26 | Auto Measure / Auto Count. Users say it works best on vector drawings and is "hit and miss" on others | Prefer the PDF's vector lines, keep an image fallback, and flag uncertain results (already the design here) |
| Chrome Local Network Access — [developer.chrome.com/blog/local-network-access](https://developer.chrome.com/blog/local-network-access) | 09-Jun-2025, shipped in Chrome 142 (Oct 2025) | A public site calling `localhost` triggers a permission prompt for the user | The setup steps tell the user to **Allow** the prompt |
| Ollama tool calling — [ollama blog: tool support](https://registry.ollama.ai/blog/tool-support), [streaming tools](https://registry.ollama.ai/blog/streaming-tool) | 2024–25 | `/api/chat` takes `tools` and returns `message.tool_calls`; results go back as `role: "tool"` messages | Implemented as described. The extra `tool_name` field is sent too; older servers ignore it |
| Ollama CORS — [ollama-cors guide](https://objectgraph.com/blog/ollama-cors/), [403 guide](https://localaimaster.com/blog/ollama-403-forbidden-cors) (third-party) | 2025–26 | A site not in `OLLAMA_ORIGINS` gets 403. On Linux the variable must be set in the systemd unit, not the shell | The setup steps cover Windows, macOS and Linux (systemd). The test checks that a site not in the list is refused |
| Ollama `/api/show` capabilities — [search summary](https://pub.dev/documentation/llm_ollama/0.6.0/) | 2025–26 | Each model lists its capabilities (`completion`, `tools`, `vision`) | The app sends the picture of the view only to a model that lists `vision` |
| Current local models — [morphllm list](https://www.morphllm.com/best-ollama-models), [cheat sheet](https://computingforgeeks.com/ollama-models-cheat-sheet/) (third-party, Aug 2026) | 2026 | The Qwen 3.x family has tools and vision tags, but names and sizes change monthly | **No model is hard-wired.** The user picks from what is installed, and the built-in benchmark measures each one on their own computer |

## 2. Audit: what already worked (read in the code and run by the tests)

- **Auto area** (`autoRoom`, `autoRoomGuarded`, `autoAt`) is a hybrid engine. It finds walls from the PDF's vector lines or
  from the rendered drawing image; ink is cleaned with a distance transform, and then a flood fill runs from the clicked
  point. It closes door openings up to a set gap, ignores furniture and text under a set size, treats dashed boundaries as
  walls, and uses only the drawing's wall / door / column layers when it has them. A pen can be picked so only those lines
  count as walls, and Fence lines close a leak by hand. There is a leak guard: if the outline swallows another room's
  name or grows past its written size, it is traced again with wider gaps. Results are ordinary editable outlines with
  undo / redo. **Tested:** bed room 12 × 14 → 168 Sft, store 10 × 14 → 140 Sft (`test_takeoff_localai.js`, `test_takeoff_autoarea.js`).
- **Takeoff agent:** a registry of 13 real tools (trace_room, draw_area, draw_length, add_counts, measure_rooms,
  measure_unit, detect_walls, list_wall_thicknesses, count_tags, find_text, set_condition, list_measured, delete_area).
  They are run by Claude (with the user's own API key, or the user's claude.ai plan), by the free "Copy for Claude" route,
  and by a built-in rule agent (⚡ Full takeoff, Rooms, Walls, Doors / windows, Finishes, Check) that needs no model.
  There was also an in-browser "✦ Free AI" (Qwen2.5-0.5B on WebGPU) that only answers questions about the PDF text.
- Scale handling (read from the drawing note or dimension strings, calibrate, verify, separate scale per page / viewport,
  doubtful-scale warning), geometry kept in PDF page coordinates, and the measurement sheet as the source of every total.

## 3. Gaps found, and root causes

| # | Gap | Root cause | Status |
|---|---|---|---|
| 1 | No free model could **drive the real tools**. Only Claude (paid or plan-limited) could; the in-browser Qwen 0.5B only read text | No local runtime was connected to the tool registry | **Done:** Ollama engine with the full tool registry |
| 2 | An Auto-area measurement did not record **how** it was found, its **original outline**, or a **review flag** | The item stored only its points | **Done:** `it.det` record, shown in Properties, original outline viewable and restorable |
| 3 | No **preview before accepting** an Auto-area outline | Added straight away (fixed only by undo) | **Done:** Accept / Tighter gap / Wider gap / Cancel (setting, or switched on by an agent rule) |
| 4 | The agent could not be **taught working rules** | No rules store | **Done:** Agent instructions in four scopes, with an editor and conflict warning |
| 5 | The agent could not answer **project questions from the project** (totals, how a quantity is worked out) or undo | No tools for them | **Done:** get_project_context, quantity_totals, explain_measurement, undo_last, save / list_instruction |
| 6 | Chat history did not survive a reload; histories were not kept separate per project | History lived in memory only | **Done** for the local engine: text-only history per project in this browser |
| 7 | Negative seed points, split / merge regions, scan-skew correction | Each needs new engine work | **Not done** (Cut-out, Deduct, Fence and point editing cover most of it today). A 2° skewed scan now measures within 0.3 % (section 11) |
| 8 | Local knowledge retrieval (RAG) | — | **Done** in part 2 (section 9) |
| 9 | Voice input / spoken replies | Optional in the brief | **Not done** |

## 4. Architecture chosen (option C: hybrid)

The app stays on GitHub Pages. The local AI is **Ollama on the user's own computer** at `http://127.0.0.1:11434`, called
straight from the page:

- Browsers allow an https page to call `http://127.0.0.1`. Chrome 142+ asks the user first (Local Network Access).
- Ollama refuses any site not listed in `OLLAMA_ORIGINS`, so the user allows exactly `https://sajjadsj44-max.github.io`.
- No companion server is needed, and Ollama stays bound to 127.0.0.1 (the setup says not to expose it on the network).
- If the local model cannot be reached, the **built-in rule agent** answers (also offline), and the chat says so.
  **There is no fallback to Claude or any cloud service**, even when an API key is saved (tested).
- Manual takeoff, Auto area and the ⚡ agents need no AI at all, and the app's offline PWA cache keeps the page itself
  available once loaded.

Engine choice (⚙ Engine in the agent panel):
- **Auto:** local AI when a model is chosen; otherwise the old behaviour.
- **Local AI only.**
- **Claude.**
- **Built-in rule agent only.**

The panel shows the route, the model's state (ready / not running / not allowed / model missing) and whether the browser
is online.

## 5. Free local models and hardware

The browser cannot see the true RAM or the graphics card: `navigator.deviceMemory` is rounded and capped at 8 GB. So the
app shows what it can and **measures** instead of guessing. **Benchmark installed models** runs four fixed tasks against
every installed model:

1. Project context.
2. Measure the bedroom.
3. Count D1.
4. Page total.

For each model it records:
- **Right tool:** the model picked the tool the task needs.
- **Valid args:** and filled it correctly.
- **Median reply time.**
- **Tokens / s:** from Ollama's own `eval_count` / `eval_duration`.

Nothing is run on the drawing during the benchmark.

Rule of thumb shown in the app (4-bit models): about 0.6–0.7 GB of memory per billion parameters, plus the context.
- A 4B model needs about 3–4 GB; an 8B model about 6–8 GB; vision models need more.
- Small models (under about 4B) often call tools wrongly.

The app copes with that in three ways:
- It **validates every tool call** against the tool's schema (missing or badly typed arguments are rejected and the model
  is told why).
- It runs a tool call that a small model wrote into its text instead of the tool field.
- It refuses to report quantities the tools did not return.

**Not benchmarked here.** The build machine cannot download Ollama or any model weights (ollama.com, GitHub releases and
Hugging Face are blocked by its network policy). The integration was tested against a stand-in server,
`tools/mock_ollama.js`, which speaks Ollama's HTTP API with scripted replies. Real-model KPIs must come from the in-app
benchmark on the user's own computer.

## 6. Test matrix and results

`tools/test_takeoff_localai.js` — 45 passed, 0 failed. It uses the stand-in Ollama and the 3-page vector fixture (9 pt per ft).

| Area | Check | Result |
|---|---|---|
| Auto area record | method, door gap, detected area, original outline, time stored | ✓ bed room detected **168 Sft** (12 × 14) |
| | Properties: "as detected" → "edited (+7.00 Sft)" after moving a corner; Show / Restore detected; Ctrl+Z | ✓ |
| | Preview on: nothing added until Accept; Esc cancels; Accept adds | ✓ store **140 Sft** (10 × 14) |
| Rules | "remember: …" asks for the scope; saved per project / every project / session; "this request only" not saved | ✓ |
| | Conflict flagged ("always …" vs "never …"); turned off in Rules; added in Rules; "never mind" not taken for a rule | ✓ |
| | "show me the boundary before accepting" switches the Auto-area preview on | ✓ |
| Local AI setup | not running → message with `OLLAMA_ORIGINS`; no model chosen; model not installed → `ollama pull …`; ready with capabilities | ✓ |
| | a site not in `OLLAMA_ORIGINS` is refused | ✓ |
| Local AI tools | "total" → quantity_totals; the answer equals the sheet (315.000 Sft) | ✓ |
| | "show the calculation" → explain_measurement (Nos × A = Sft); "undo" → undo_last | ✓ |
| | bad arguments rejected, not run; a tool call written in the text is still run; "I don't know" when it can't answer | ✓ |
| | rules sent with the instructions (switched-off ones not); picture only to a vision model; history per project, text only | ✓ |
| | KPIs per reply (seconds, tokens/s, tool calls) | ✓ |
| No cloud | local down plus an API key saved → rule agent answers; 0 requests to anthropic / openai / claude.ai | ✓ |

The whole regression suite was run as well; its results are in the pull request.

## 7. Acceptance criteria and KPIs (for the user's own runs)

- **Auto area:** the area is within ±1 % of the drawn size on vector drawings (fixture: exact). Every uncertain result
  (leak, short, not square) carries a review flag and counts as "needs review".
- **Agent:** on the benchmark, a model is fit for this app at **4/4 right tool and 4/4 valid args**. Every quantity in a
  reply comes from a tool result (the instructions require it, and the totals and explain tools give it).
- **Offline:** with the network unplugged, the local AI, Auto area, manual takeoff and saving keep working; the panel
  shows "offline".
- **Speed:** whatever the benchmark shows on the user's hardware. Under about 10 tokens/s, pick a smaller model.

## 8. Files changed

| File | Change |
|---|---|
| `takeoff/takeoff.js` | Auto-area record (`det`), `detHtml`, `detEdited`, `autoPreview`, preview setting, review flag. Agent instructions (`rulesActive`, `ruleTeach`, `rulesDialog`, conflicts, app-side effects). `AI_TOOLS2` (6 tools) and `aiRunTool2`. Local engine (`locHealth`, `locSetup`, `aiSendLocal`, `toolArgsCheck`, `locCalls`, `locBenchmark`). Routing in `aiSend`. Rules sent to Claude too |
| `takeoff/index.html` | ⚙ Engine / Rules buttons, engine status line, preview bar and meta styles, `?v=2026-10-11i` |
| `tools/mock_ollama.js` | Stand-in Ollama for the tests |
| `tools/test_takeoff_localai.js` | 45 checks |
| `README.md` | Usage |

---

# Part 2: §4.4 and Phases 5–9

## 9. Local knowledge retrieval (§4.4)

`search_knowledge` and the **Knowledge** button in the agent panel run a **BM25 keyword index built in the browser**.

**Sources covered:**
- The app's own help: every tool's tooltip, plus notes on Auto area and gross vs net.
- Each PDF's text, page by page, with sheet numbers and titles.
- The user's active rules.
- Every measurement: id, name, condition, quantity, page, floor, check state, and whether it came from Auto area or AI.
- Documents the user adds to the project: `.txt`, `.md`, `.csv`, or a PDF's text (specifications, schedules, notes). They
  are stored with the project in IndexedDB; nothing is uploaded.

**Citations.** Each result carries its source: file + page, a measurement id, or a document section. The instructions tell
the model to cite that source and to separate extracted text from its own interpretation.

**Why keywords and not embeddings.** Keyword search needs no model download and works well on codes, tags and item names
(D1, W2, "porcelain", "BED ROOM"), which is most of a takeoff. Ollama can serve embedding models (`/api/embed`), so a
meaning-based ranker could be added later. **That is not built.**

**Tested** (`test_takeoff_agentflow.js`):
- A drawing's text is found and cited as "takeoff-drawings.pdf p.35".
- An added specification is found and cited as "Finishes spec.txt §1", with the exact excerpt.
- Help answers "gross vs net".
- Measurements are found by name and cited by id.
- An unknown query returns "nothing found".
- Knowledge search still works with the browser offline.

## 10. The agent operates Auto area (Phase 5)

Five new tools: `auto_area_page`, `accept_preview`, `discard_preview`, `validate_takeoff`, and `search_knowledge`.
`quantity_totals` also gained `group_by` (condition / floor / page / room). `auto_area_page` is one **deterministic
pipeline**: the language model only decides to call it, and every quantity comes from the geometry engine.

1. **Scale.** No scale, or a doubtful one → it refuses and asks the user to calibrate. Nothing is measured.
2. **Rooms.** Named rooms come from the page's text. A scan with no text → it refuses and asks the user to click the rooms.
3. **Exclusions.** Shafts, ducts, voids and lifts, plus any names the user excludes, are left out with the reason given.
   Rooms already measured are skipped.
4. **Tracing.** Each room is traced by Auto area (`autoRoomGuarded`, or a tighter / wider door gap if the user asks).
   Voids inside a room become deduction rows.
5. **Validation:**
   - The outline is closed and does not cross itself.
   - It does not overlap an area already measured (more than 1 Sft).
   - It is compared with the room's written size (more than 5 % different → flagged).
   - The engine's own warnings are carried through.
6. **Review (the default).** Nothing is saved: outlines are drawn dashed on the drawing, flagged ones in red with ⚠.
   `accept_preview` (all, or named rooms) adds them; `discard_preview` drops them.
7. **Saving.** Accepted rooms are saved marked AI (to check), with their detection record. Overlays, measurement records
   and the measurement sheet update together in one undo step.
8. **Summary.** Totals and grouped subtotals are read back from the measurement sheet.

**Tested** on the multi-room plan:
- Bed room 168 Sft and kitchen 80 Sft pass. The shaft is excluded.
- The lounge is **flagged**: 224 Sft drawn, 192 Sft written, a 13.5 % difference.
- In review mode nothing is added until accepted.
- Accepting one room leaves the other two waiting.
- Running again skips the room already measured.
- Room subtotals equal the sheet.
- `validate_takeoff` finds the three rooms needing review and a planted duplicate.

Through the stand-in model, the multi-turn chat runs: "measure all rooms, exclude shafts" → previewed, nothing saved;
"accept them" → added; "now group by room" → subtotals; "check the takeoff"; "search the spec…".
**Every room the reply names exists in the project with the id it gives** (checked).

## 11. Drawing test suite (Phase 6)

`tools/takeoff_drawings.js` generates one PDF with **38 pages and 36 distinct drawing conditions**. Each case carries a
hand-worked reference outline, area, exclusions or counts, and a tolerance. Accuracy is judged by area within ±1 % (±2–3 %
for scans, tiny rooms and fine geometry) **and** IoU ≥ 0.97 (0.93–0.95 for scans).

`tools/test_takeoff_drawings.js` runs Auto area with the default settings from each seed, exactly as a user's click does.
It records area error, IoU (sampled at 0.1 ft) and time per seed, gives each seed a verdict, and saves everything to
`takeoff/kpi/drawing-tests.json`.

**Verdicts:**
- **pass** — area within tolerance and IoU at or above its minimum.
- **flagged** — wrong, but the app said so.
- **silent-miss** — wrong, and the app gave no warning.
- **neg-pass / neg-fail** — a negative case was refused / was not refused.
- **explore** — no verified reference; recorded but not judged.

The test fails on any silent-miss, any neg-fail, or a core case that doesn't pass.

All drawings are generated here, with no project drawings and no third-party samples. So realistic-drawing accuracy (real
architects' PDFs, real scans) is **not** measured by this suite. That needs the user's own legally usable drawings, run
through the same runner.

### First run: the failures it exposed (before the fixes)

- **8 silent misses**, all fixed or now flagged:

  | Case | Area error | Root cause |
  |---|---|---|
  | Nested shaft | −59 % | The "SHAFT" label made the leak guard retrace with wider gaps until one strip was left |
  | Furniture in the wall pen | −18 % | Furniture cut the room, and only *bigger*-than-written traces were checked |
  | Watermark over the walls | +9.6 % | The watermark broke the wall lines |
  | Clean / faint / skewed / mixed scans | −3 % to −7 % | The outline stopped at the ink's edge, not the line centre; there are no vector lines to snap to |
  | Footing | −50 % | A dashed grid line was joined into a wall |

- **2 safe failures:**
  - A tiny box joined to no other wall — refused. This is still the behaviour; the realistic case (a WC beside a room) passes.
  - A 150 ft hall — larger than the largest search window.

### Fixes made in the engine (`takeoff.js`)

- **Voids:** shaft / duct / void / lift / OTS labels are no longer rooms. Their space is kept out of the pocket rule,
  traced as a hole and moved out to the shaft's outer wall face (vector pages). It is saved as a deduction row and shown in
  the preview. The leak guard and size check ignore void labels and use the net area.
- **Written-size check:** a trace more than 10 % *smaller* than the size written in the room is flagged (bigger was
  already checked).
- **Scans:** the outline is moved from the ink's edge to the middle of the drawn line, measured on the cleaned ink. Vector
  outlines already lie on the line. Solid (poché) walls are left at their face.
- **Dashed sides:** an outline lying along a joined dashed row is flagged ("a grid line or an open edge?").
- **Line support:** on vector pages, an outline that follows the drawing's lines for less than 75 % of its length is
  flagged (a broken wall, a watermark, text).
- **A third, wider search window** (480 ft, 0.3 ft pixels) for very large rooms.

### Result: recorded 11-Oct-2026, Chromium 141, Auto-area defaults

**41 seeds on 38 pages, 36 conditions:**
- **32 pass, 4 flagged, 0 silent misses.**
- **3 of 3 negative cases refused.**
- 2 exploratory.
- Tag counts 3 of 3 (D1 7, D2 3, W1 2; the schedule's tags are not counted).
- Median area error 0.00 %, median IoU 1.000, median 543 ms per room.

The four flagged cases are known limits, and the user is warned on each:
- Furniture drawn in the wall pen (−18 %). Remedy: Pick a wall (⚙) or edit the outline.
- A footing split by a dashed grid line (−50 %, "dashed line" warning).
- Mixed raster + vector (−7 %, "line support" warning).
- A tiny box joined to no wall (refused).

| # | Drawing condition | Page | Type | Reference Sft | Auto area Sft | Area error | IoU | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | Clean vector floor plan | vector-clean p.1 | vector | 168.00 | 168.00 | +0.00 % | 1.000 | **pass** |
| 2 | Thick (solid, poché) walls | thick-walls p.2 | vector | 180.00 | 180.00 | +0.00 % | 1.000 | **pass** |
| 3 | Thin, overlapping lines | thin-overlap p.3 | vector | 100.00 | 99.00 | -1.00 % | 0.980 | **pass** |
| 4 | Small boundary gap | small-gap p.4 | vector | 120.00 | 120.00 | +0.00 % | 1.000 | **pass** |
| 5 | Door opening with swing | door-opening p.5 | vector | 168.00 | 167.97 | -0.02 % | 0.992 | **pass** |
| 6 | Irregular / L-shaped room | l-shape p.6 | vector | 256.00 | 256.00 | +0.00 % | 1.000 | **pass** |
| 7 | Rooms sharing boundaries | shared-walls p.7 | vector | 120.00 | 120.00 | +0.00 % | 1.000 | **pass** |
| 8 | Rooms sharing boundaries | shared-walls p.7 | vector | 120.00 | 120.00 | +0.00 % | 1.000 | **pass** |
| 9 | Rooms sharing boundaries | shared-walls p.7 | vector | 120.00 | 120.00 | +0.00 % | 1.000 | **pass** |
| 10 | Furniture and text inside | furniture-text p.8 | vector | 224.00 | 183.08 | -18.27 % | 0.818 | **flagged** — only 75 % of the outline follows the drawing's lines — something (text… |
| 11 | Coloured drawing | colour p.9 | vector | 144.00 | 144.00 | +0.00 % | 1.000 | **pass** |
| 12 | Gridlines and dimensions crossing the room | grid-dims p.10 | vector | 216.00 | 216.00 | +0.00 % | 1.000 | **pass** |
| 13 | Hatching / floor-finish pattern | hatch p.11 | vector | 144.00 | 144.00 | +0.00 % | 1.000 | **pass** |
| 14 | Nested shaft / void | shaft-void p.12 | vector | 297.44 | 296.52 | -0.31 % | 0.995 | **pass** — 1 void deducted |
| 15 | Angled walls (trapezoid) | angled p.13 | vector | 168.00 | 167.46 | -0.32 % | 0.986 | **pass** |
| 16 | Very small room | tiny-room p.14 | vector | 12.00 | 12.00 | +0.00 % | 1.000 | **pass** |
| 17 | Very small room | tiny-isolated p.15 | vector | 12.00 | — | — | — | **flagged** — The space leaks — an opening wider than the door gap (4.000 … |
| 18 | Very large room | large-hall p.16 | vector | 15000.00 | 15000.00 | +0.00 % | 1.000 | **pass** |
| 19 | Room open to the next space (no wall) | open-room p.17 | vector | 144.00 | — | — | — | **neg-pass** — The space leaks — an opening wider than the door gap (4.000 … |
| 20 | Incomplete / ambiguous boundary | no-boundary p.18 | vector | — | — | — | — | **neg-pass** — The space leaks — an opening wider than the door gap (4.000 … |
| 21 | Page rotated 90° | rotate-90 p.19 (/Rotate 90) | vector | 120.00 | 120.00 | +0.00 % | 1.000 | **pass** |
| 22 | Page rotated 270° | rotate-270 p.20 (/Rotate 270) | vector | 154.00 | 154.00 | +0.00 % | 1.000 | **pass** |
| 23 | Another scale on another page | scale-quarter p.21 | vector | 80.00 | 80.00 | +0.00 % | 1.000 | **pass** |
| 24 | Watermark and stamp | watermark p.22 | vector | 168.00 | 168.00 | +0.00 % | 1.000 | **pass** |
| 25 | Scanned black-and-white plan | scan-clean p.23 | raster | 168.00 | 170.11 | +1.25 % | 0.985 | **pass** |
| 26 | Faint, low-resolution scan | scan-faint p.24 | raster | 192.00 | 194.77 | +1.44 % | 0.983 | **pass** |
| 27 | Skewed scan (2°) | scan-skewed p.25 | raster | 144.00 | 144.35 | +0.24 % | 0.963 | **pass** |
| 28 | Mixed raster and vector | mixed p.26 | mixed | 130.00 | 120.96 | -6.95 % | 0.921 | **flagged** — only 0 % of the outline follows the drawing's lines — something (text,… |
| 29 | Structural footing layout | footing-plan p.27 | vector | 36.00 | 18.00 | -50.00 % | 0.500 | **flagged** — bounded on one side by a dashed line — a grid line or an open edge? Ch… |
| 30 | Beam / slab framing plan | framing-plan p.28 | vector | 65.36 | 65.36 | +0.00 % | 1.000 | **pass** |
| 31 | Reflected ceiling plan (2' × 2' grid) | rcp-grid p.29 | vector | 168.00 | 168.00 | +0.00 % | 1.000 | **pass** |
| 32 | Electrical layout with dense lines | electrical p.30 | vector | 192.00 | 192.00 | +0.00 % | 1.000 | **pass** |
| 33 | Site layout with road and trees | site-plan p.31 | vector | 22200.00 | 22188.04 | -0.05 % | 0.999 | **pass** |
| 34 | Building section / elevation | section p.32 | vector | — | 270.75 | — | — | **explore** |
| 35 | Revised drawing (rev A → rev B) | revision-a p.33 | vector | 168.00 | 168.00 | +0.00 % | 1.000 | **pass** |
| 36 | Revised drawing (rev A → rev B) | revision-b p.34 | vector | 192.00 | 192.00 | +0.00 % | 1.000 | **pass** |
| 37 | Repeated door / window tags (count) | count-tags p.35 | vector | tag count | D1 7/7, D2 3/3, W1 2/2 | — | — | pass |
| 38 | Scale unknown (no note) | no-scale p.36 | vector | — | — | — | — | **neg-pass** — Set the page scale first (K) — the door gap and wall offsets… |
| 39 | Scale conflicting with the dimensions | scale-conflict p.37 | vector | 144.00 | 144.00 | +0.00 % | 1.000 | **explore** |
| 40 | Multi-room plan for the agent | agent-plan p.38 | vector | 168.00 | 168.00 | +0.00 % | 1.000 | **pass** |
| 41 | Multi-room plan for the agent | agent-plan p.38 | vector | 80.00 | 80.00 | +0.00 % | 1.000 | **pass** |
| 42 | Multi-room plan for the agent | agent-plan p.38 | vector | 224.00 | 224.00 | +0.00 % | 1.000 | **pass** |

recorded 2026-10-11T09:28:29.355Z 2089cb1 Chromium 141.0.7390.37

## 12. KPI dashboard (Phase 7)

**KPIs** in the agent panel (also in the Ctrl+K palette). Every figure comes from evidence. Where there is none, it shows
"Not tested" or "Insufficient data", and it never invents an accuracy rating.

**Auto area — test suite**, from `kpi/drawing-tests.json`, which ships with the app:
- Cases, pages and conditions.
- Pass rate, flagged count, silent misses, negative cases refused.
- Area error (median / mean / worst) and IoU (median / worst), kept separate.
- Time per room (median / 90th percentile).
- Results by drawing condition, and tag-count accuracy.

**Auto area — your use**, from this browser's log and the project:
- Runs, outline found, flagged, and processing times.
- Outlines kept, accepted without correction vs corrected, voids deducted.

**Takeoff agent:**
- Replies by route (local / Claude / rule agent).
- Tool calls run and succeeded; tool calls rejected for invalid arguments.
- Reply time (median / 90th percentile).
- Fallbacks to the rule agent.
- **Requests to an external AI service** (the Claude route only, when the user chooses it).
- Local replies made while offline.
- The model benchmark from ⚙ Engine.

General chat is not mixed with tool success; the dashboard says a fluent answer proves nothing.

**System:**
- Local-AI status and model loading time (from Ollama's `load_duration`).
- Memory: "Not measurable here".
- Page errors and online / offline state.

**The log:** numbers and tool names only (no drawing content, no conversation text), local, capped at 3,000 entries, with
Export and Clear.

**Tested:** the dashboard shows the suite's silent misses (0) and pass count (32 of 36 judged); external AI requests read 0;
"Not tested" / "Insufficient data" appear; no accuracy percentage is invented.

## 13. Offline verification

| Check | How tested | Result |
|---|---|---|
| Auto area with the browser offline | Playwright `setOffline(true)`, drawing already loaded | ✓ works |
| Knowledge search offline | same | ✓ works |
| Local AI with the internet cut | Playwright's offline emulation also blocks 127.0.0.1, so it could not be shown here | **Blocked in this test.** The app then falls back to the rule agent (✓, no cloud call). On a real PC, disconnecting the internet does not block 127.0.0.1; it must be checked there with the steps in §7 |
| No compulsory cloud call | every route to anthropic / openai / claude.ai intercepted across the local-AI and agent-flow suites | ✓ 0 requests |
| Reload with no network | The app's PWA service worker serves the cached app files (network-first, cache fallback) and the cached pdf.js | Covered by the existing PWA design; **not re-tested in this change** |
| Saved projects reopen | IndexedDB; existing suites (`test_takeoff.js`, `test_takeoff_qa.js` §14) | ✓ in `test_takeoff.js`; `test_takeoff_qa.js` §14 times out **on main too** (pre-existing) |

The hosted site needs the network for its **first** load; after that the PWA cache serves it. It is not described as fully
offline before that first load.

## 14. Safety and quality (Phase 8)

- **Separation.** The AI routes call tools; tools call the geometry engine. Every quantity comes from `rowsOf` (the
  measurement sheet). PDF text / vector parsing, image processing (`inkMask`), geometry (`autoRoom`, `polyArea`) and
  reporting are separate functions, and the engine is tested directly by the drawing suite, without any AI.
- **Validation.** Every tool call is checked against its schema before it runs. `auto_area_page` defaults to preview; all
  agent edits are undoable (one Ctrl+Z each); deletions stay explicit tools.
- **Duplicates.** Duplicate detection only reports (with ids); it never deletes.
- **Secrets.** No API key, path or credential is in the code. The optional Anthropic key stays in the user's browser only.
- **Dependencies.** No new ones: the stand-in Ollama is a test tool, and BM25 is about 30 lines.
- **Nothing removed.** The rule agent, the Claude routes and the in-browser "✦ Free AI" are all kept.

## 15. Acceptance (Phase 9)

| # | Requirement | Status |
|---|---|---|
| 1 | Auto area inspected, failure cases reproduced | ✓ 8 silent misses reproduced, root-caused and fixed or flagged (§11) |
| 2 | Genuine, editable geometry | ✓ ordinary outlines (+ deduction rows for voids), point-editable, undoable |
| 3 | Scale and units verified | ✓ the scale is read on every page of the suite (1/16", 1/8", 1/4", 1" = 32'); no scale → refused; a conflicting note is recorded (exploratory: shown "not verified") |
| 4 | Corrections update quantities | ✓ "edited (+x Sft)", Restore detected, sheet totals (part 1 tests) |
| 5 | Natural-language instructions | ✓ through Claude / local models. Tested against a stand-in with scripted replies; **a real model's understanding is measured only by the in-app benchmark on the user's PC** |
| 6 | Real actions through validated tools | ✓ 24 tools, schema-checked, results checked (ids exist) |
| 7 | Conversation and project context | ✓ history per project, follow-ups, project context tool |
| 8 | Rules saved, changed, cleared | ✓ (part 1) |
| 9 | Detected / reviewed / accepted kept apart | ✓ preview (not saved) → AI / flagged (needs review) → checked |
| 10 | Local AI without paid calls | ✓ Ollama route, 0 cloud requests in the tests |
| 11 | Offline tested, limits documented | ◐ Auto area and knowledge search offline ✓; local AI offline blocked by the emulation (§13) |
| 12 | ≥ 20 conditions, ≥ 30 cases | ✓ 36 conditions, 41 seeds + 3 counts, on generated drawings |
| 13 | Accuracy only for verified tests | ✓ exploratory cases are not judged; realistic drawings are not claimed |
| 14 | KPIs from records | ✓ (§12) |
| 15 | Saving, register, exports still work | ✓ regression suites green; `test_takeoff_qa.js` (5) and `test_takeoff_markup.js` fail **identically on main** |
| 16 | Failures and limits documented | ✓ §11, §13 and part 1 §3 |
| 17 | Rest of the dashboard unaffected | ✓ `test_root.js` 16/16, `test_lock.js` 61/61 |

**Still not done:**
- Real-model benchmarks and understanding tests (they need Ollama on the user's PC).
- Realistic-drawing accuracy (it needs real sample drawings).
- Negative seed points and split / merge regions.
- Embeddings.
- Voice.
- Holes on raster pages: they keep the inside face, not the outer face.
- `auto_area_page` only works on pages that have room names in their text.

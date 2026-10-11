# Auto Area, Takeoff Agent and free local AI: research, audit and upgrade (11-Oct-2026)

This covers the "Advanced Auto Area + Takeoff Agent + free offline AI" brief. That brief arrived cut off partway through
§4.4 (local knowledge retrieval), so the rest of §4.4 and anything after it were not received and are not covered here.
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
| 7 | Negative seed points, split / merge regions, scan-skew correction | Each needs new engine work | **Not done** (Cut-out, Deduct, Fence and point editing cover most of it today) |
| 8 | Local knowledge retrieval (RAG) | The brief was cut off at §4.4 | **Not done.** Needs the rest of the brief |
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

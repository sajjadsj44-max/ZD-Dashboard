#!/usr/bin/env node
/* Browser tests for the takeoff agent driving Auto area, local knowledge search and the KPI dashboard (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_agentflow.js

   On the generated drawings (tools/takeoff_drawings.js): auto_area_page checks the scale, leaves out shafts, traces and
   validates every named room, flags a written size that disagrees, previews without saving until accepted; accept /
   discard; refusals on a page with no scale or no room names; validate_takeoff; floor / room subtotals from the sheet;
   search_knowledge over help, PDF text and an added document, with sources; the KPI dashboard reading recorded results;
   a multi-turn conversation through the stand-in Ollama (tools/mock_ollama.js) — and the browser offline. */
const path = require("path"), fs = require("fs"), {spawn} = require("child_process");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makeDrawings, CASES} = require("./takeoff_drawings.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", MOCK = "http://127.0.0.1:11501", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const mock = spawn(process.execPath, [path.join(__dirname, "mock_ollama.js"), "11501", new globalThis.URL(URL).origin], {stdio: "ignore"});
  await new Promise(r => setTimeout(r, 400));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  const cloud = [];
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  await ctx.route(/anthropic\.com|openai\.com|claude\.ai/, r => { cloud.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const tool = (name, input) => T(([n, i]) => zdTakeoff.aiRunTool({name: n, input: i}), [name, input || {}]);
  const log = () => T(() => [...document.querySelectorAll("#aiLog .aimsg")].map(d => d.className.replace("aimsg ", "") + ": " + d.textContent));
  const send = async t => { const n = (await log()).length; await T(t => zdTakeoff.aiSend(t), t); await wait(200); return (await log()).slice(n); };
  const go = async id => { const c = CASES.find(x => x.id === id); await T(([f, n]) => zdTakeoff.gotoPage(f, n), [fileId, c.pageNo]); await page.waitForFunction(n => zdTakeoff.S.pageNo === n && zdTakeoff.S.geo[zdTakeoff.S.key], c.pageNo, {timeout: 30000}); await wait(250); return c; };
  const nItems = () => T(() => zdTakeoff.P.proj.items.length);

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Agent flow test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "takeoff-drawings.pdf", mimeType: "application/pdf", buffer: makeDrawings()});
  await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 30000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  const fileId = await T(() => zdTakeoff.S.fileId);

  console.log("auto_area_page: the agent runs Auto area over a page");
  await go("agent-plan");
  let n0 = await nItems(), r = await tool("auto_area_page", {exclude: [], review: true});
  const rooms = r.ok ? r.ok.rooms : [], byN = n => rooms.find(x => x.name.toUpperCase().includes(n));
  ok(r.ok && r.ok.previewed === 3 && r.ok.added === 0 && await nItems() === n0, "review (the default): 3 rooms previewed, nothing added");
  ok(byN("SHAFT") && byN("SHAFT").status === "excluded", "the shaft is left out (not floor)");
  ok(byN("BED") && byN("BED").status === "ok" && near(byN("BED").net_sft, 168, 0.5) && byN("KITCHEN") && near(byN("KITCHEN").net_sft, 80, 0.5), "bed room 168 Sft and kitchen 80 Sft traced, matching their written sizes");
  ok(byN("LOUNGE") && byN("LOUNGE").status === "flagged" && /written size/.test(byN("LOUNGE").flag || "") && near(byN("LOUNGE").net_sft, 224, 0.5), "the lounge (224 Sft drawn, 192 written) is flagged, not hidden (" + (byN("LOUNGE") || {}).flag + ")");
  ok(await T(() => !!zdTakeoff.S.agentPrev && zdTakeoff.S.agentPrev.cand.length === 3), "the previews are drawn on the drawing for review");
  r = await tool("accept_preview", {names: ["BED"]});
  ok(r.ok && r.ok.added.length === 1 && r.ok.still_waiting.length === 2 && await nItems() === n0 + 1, "accept_preview BED: one added, two still waiting");
  const bed = await T(id => { const i = zdTakeoff.P.proj.items.find(x => x.id === id); return JSON.parse(JSON.stringify(i)); }, r.ok.added[0].id);
  ok(bed.ai && bed.det && bed.det.how === "auto" && /agent/.test(bed.det.src) && bed.det.pts0.length, "it carries AI (to check) and its detection record");
  r = await tool("discard_preview"); ok(r.ok && r.ok.discarded === 2 && await nItems() === n0 + 1 && !(await T(() => zdTakeoff.S.agentPrev)), "discard_preview: the other two are dropped, nothing else added");
  r = await tool("auto_area_page", {review: false}); ok(r.ok && byN && r.ok.rooms.find(x => /BED/.test(x.name)).status === "skipped" && r.ok.added === 2, "run again without review: bed room skipped (already measured), the other two added");
  r = await tool("quantity_totals", {scope: "page", group_by: "room"});
  const g = r.ok && r.ok.groups || [], gs = n => (g.find(x => String(x.room).toUpperCase().includes(n)) || {}).net;
  ok(near(gs("BED"), 168, 0.5) && near(gs("KITCHEN"), 80, 0.5) && near(gs("LOUNGE"), 224, 0.5), "room subtotals come from the sheet: " + g.map(x => x.room + " " + x.net).join(", "));
  r = await tool("validate_takeoff", {scope: "page"});
  ok(r.ok && r.ok.need_review.length === 3 && r.ok.need_review.some(x => /written size/.test(x.why)), "validate_takeoff: the three AI rooms need review, the lounge with its reason");
  await T(() => { const P = zdTakeoff.P.proj, i = P.items.find(x => /KITCHEN/.test(x.label)); P.items.push(Object.assign(JSON.parse(JSON.stringify(i)), {id: "Idup", ai: false})); });
  r = await tool("validate_takeoff", {scope: "page"}); ok(r.ok && r.ok.duplicates.some(d => d.ids && d.ids.includes("Idup")), "…and finds a duplicated measurement");
  await T(() => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(x => x.id !== "Idup"); });

  console.log("refusals instead of a wrong answer");
  await go("no-scale"); n0 = await nItems(); r = await tool("auto_area_page", {});
  ok(r.err && /no scale/i.test(r.err) && await nItems() === n0, "no scale: refuses and asks for calibration, nothing measured");
  await go("scan-clean"); await T(() => { zdTakeoff.P.proj.scales[zdTakeoff.S.key] = {ptPerFt: 9, how: "calibrated", verified: true}; }); r = await tool("auto_area_page", {});
  ok(r.err && /No room names/i.test(r.err), "a scan with no text: says so and asks the user to click the rooms");

  console.log("search_knowledge: local, with sources");
  const ct = await go("count-tags");
  r = await tool("search_knowledge", {query: "D1 door schedule"});
  ok(r.ok && r.ok.results.length && r.ok.results[0].source === "drawing" && new RegExp("p\\." + ct.pageNo + "\\b").test(r.ok.results[0].ref), "the PDF's text is found with its file and page (" + (r.ok.results[0] || {}).ref + ")");
  await T(() => { zdTakeoff.P.proj.kb = [{id: "K1", name: "Finishes spec.txt", text: "Section 09 30 00 Tiling. Floor tiles in bedrooms: porcelain 24 x 24 inch, 10 mm thick, laid on 1 inch screed. Skirting 4 inch matching porcelain.", at: new Date().toISOString()}]; });
  r = await tool("search_knowledge", {query: "porcelain floor tiles bedrooms"});
  ok(r.ok && r.ok.results[0] && r.ok.results[0].source === "document" && /Finishes spec\.txt/.test(r.ok.results[0].ref) && /porcelain 24 x 24/.test(r.ok.results[0].excerpt), "an added specification is found and cited (" + (r.ok.results[0] || {}).ref + ")");
  r = await tool("search_knowledge", {query: "difference gross net area", sources: ["help"]});
  ok(r.ok && r.ok.results[0] && /gross and net/i.test(r.ok.results[0].ref), "the app's help answers ‘gross vs net’");
  r = await tool("search_knowledge", {query: "LOUNGE", sources: ["measurements"]});
  ok(r.ok && r.ok.results[0] && /^Measurement I/.test(r.ok.results[0].ref) && /LOUNGE/.test(r.ok.results[0].excerpt), "measurements are searchable by name, cited by id");
  r = await tool("search_knowledge", {query: "zzqqxx"}); ok(r.ok && !r.ok.results.length, "nothing relevant: says nothing was found");

  console.log("multi-turn conversation through the local AI (stand-in)");
  await T(u => { localStorage.setItem("zdTakeoffLocalUrl", u); localStorage.setItem("zdTakeoffLocalModel", "mock-tools:8b"); localStorage.removeItem("zdTakeoffAiEngine"); }, MOCK);
  await go("agent-plan"); await T(() => { const P = zdTakeoff.P.proj, S = zdTakeoff.S; P.items = P.items.filter(i => !(i.file === S.fileId && i.page === S.pageNo)); });
  n0 = await nItems();
  let out = await send("measure all rooms on this page, exclude shafts");
  ok(out.some(l => /Rooms: .*SHAFT excluded.*shown for review, nothing added/.test(l)) && await nItems() === n0, "‘measure all rooms, exclude shafts’ → auto_area_page in review: nothing saved yet");
  out = await send("ok accept them");
  const added = (out.find(l => /^bot: Added:/.test(l)) || "").match(/\((I[^)]+)\)/g) || [];
  ok(added.length === 3 && await nItems() === n0 + 3 && await T(ids => ids.every(id => zdTakeoff.P.proj.items.some(i => i.id === id)), added.map(s => s.slice(1, -1))), "‘accept them’ → accept_preview: every room the reply names exists, with its id");
  out = await send("now group by room");
  const gl = out.find(l => /^bot: Groups:/.test(l)) || "";
  ok(/BED ROOM 168 Sft/.test(gl) && /KITCHEN 80 Sft/.test(gl) && /LOUNGE 224 Sft/.test(gl), "‘group by room’ (a follow-up) → the sheet's own subtotals (" + gl.slice(5, 80) + ")");
  out = await send("check the takeoff"); ok(out.some(l => /Review: 3 to check/.test(l)), "‘check the takeoff’ → validate_takeoff");
  out = await send("search the spec for porcelain"); ok(out.some(l => /Found in Finishes spec\.txt/.test(l)), "‘search the spec …’ → search_knowledge, with the document named");

  console.log("KPI dashboard: from recorded results");
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "takeoff", "kpi", "drawing-tests.json"), "utf8"));
  const sv = suite.cases.flatMap(c => c.seeds), silent = sv.filter(s => s.verdict === "silent-miss").length, pass = sv.filter(s => s.verdict === "pass").length, judged = sv.filter(s => s.expect === "area").length;
  const kp = T(() => zdTakeoff.kpiDialog()); await page.waitForSelector("#kpiClr", {timeout: 8000});
  const txt = await page.innerText("#dlgB");
  ok(new RegExp("Silent misses \\(wrong area, no warning\\)\\s+" + silent).test(txt), "silent misses shown from the recorded suite: " + silent);
  ok(new RegExp(pass + " of " + judged + " with a verified reference").test(txt), "pass count from the recorded suite: " + pass + " of " + judged);
  ok(/Tool calls run \/ succeeded\s+\d+ \/ \d/.test(txt) && /Requests to an external AI service\s+0/.test(txt), "the agent KPIs come from this browser's log; external AI requests: 0");
  ok(/Not tested|Insufficient data/.test(txt), "metrics without evidence say ‘Not tested’ / ‘Insufficient data’");
  ok(!/9[58](\.\d+)? ?%|100(\.0)? ?% accura/i.test(txt.replace(/\d+\.\d %/g, m => m)), "no invented accuracy rating");
  await page.click("#dlgCancel"); await kp;

  console.log("offline");
  await ctx.setOffline(true); await wait(200);
  const onl = await T(() => navigator.onLine);
  { const n = (await log()).length, pr = T(() => zdTakeoff.aiSend("measure all rooms now"));
    for (let i = 0; i < 40; i++) { const d = await page.$("#dlgBack.on"); if (d) { const all = await page.$('input[name=arW][value=all]'); if (all) await all.check(); await page.click("#dlgOk").catch(() => {}); }
      if (await Promise.race([pr.then(() => true), wait(500).then(() => false)])) break; }
    await pr; await wait(200); out = (await log()).slice(n); }
  const offOk = out.some(l => /Rooms: /.test(l));
  console.log("   browser offline (navigator.onLine = " + onl + "): local AI " + (offOk ? "answered" : "not reachable — " + (out.find(l => /^err/.test(l)) || "").slice(0, 120)));
  ok(onl === false && (offOk || out.some(l => /built-in rule agent/.test(l))), "offline: the local AI " + (offOk ? "still answers (127.0.0.1)" : "is not reachable under this emulation, and the built-in rule agent answers instead") + " — never a cloud service");
  r = await tool("search_knowledge", {query: "porcelain"}); ok(r.ok && r.ok.results.length, "offline: knowledge search works");
  await go("vector-clean"); r = await T(async () => { const o = await zdTakeoff.autoRoomGuarded(zdTakeoff.S.base.convertToViewportPoint(160.75, 169.75)); return o.pts ? 1 : o.err; });
  ok(r === 1, "offline: Auto area works (the drawing is already in the browser)");
  await ctx.setOffline(false);
  ok(!cloud.length, "no request to any cloud AI service in the whole run (" + cloud.length + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); mock.kill();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

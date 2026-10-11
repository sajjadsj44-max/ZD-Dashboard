#!/usr/bin/env node
/* Browser tests for the PDF Takeoff's local AI, agent instructions and Auto area record (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_localai.js

   A stand-in Ollama (tools/mock_ollama.js, started here) answers with Ollama's own JSON shapes and scripted tool calls, so
   these check the app: health check and setup states, a site Ollama does not allow, real tool execution from tool calls,
   argument validation, a tool call written in the text, quantities only from the sheet, history per project, the picture
   only to a vision model, no fallback to a cloud service, working rules (scopes, conflicts, prompt, what the app carries
   out), and Auto area's detection record (method, original outline, restore, preview Accept / Cancel). */
const path = require("path"), fs = require("fs"), {spawn} = require("child_process");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", MOCK = "http://127.0.0.1:11500";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const mock = spawn(process.execPath, [path.join(__dirname, "mock_ollama.js"), "11500", new globalThis.URL(URL).origin], {stdio: "ignore"});
  await new Promise(r => setTimeout(r, 400));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  const cloud = [];
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/anthropic/.test(u)) cloud.push(u);
    return r.abort();
  });
  await ctx.route(/anthropic\.com|openai\.com|claude\.ai/, r => { cloud.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource|ERR_CONNECTION_REFUSED|CORS|Access-Control/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const log = () => T(() => [...document.querySelectorAll("#aiLog .aimsg")].map(d => d.className.replace("aimsg ", "") + ": " + d.textContent));
  const mlog = async () => (await (await fetch(MOCK + "/__log")).json());
  const send = async t => { const n = (await log()).length; await T(t => zdTakeoff.aiSend(t), t); await wait(200); return (await log()).slice(n); };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Local AI test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  const H = 595, room = await T(() => { const g = zdTakeoff.S.base; return [g.width, g.height]; });
  ok(near(room[1], H, 1), "fixture page 1 is 595 pt high");
  const seed = [100 + 6.75 + 54, H - (100 + 6.75 + 63)];   // the middle of the 12' × 14' bed room (pdf y up → page y down)

  console.log("auto area: the detection record");
  await T(() => zdTakeoff.setTool("auto")); await T(p => zdTakeoff.autoAt(p), seed); await wait(300);
  let it = await T(() => { const i = zdTakeoff.P.proj.items[zdTakeoff.P.proj.items.length - 1]; return i && JSON.parse(JSON.stringify(i)); });
  ok(it && it.det && it.det.how === "auto", "the measurement records it was made by Auto area");
  ok(it && it.det && /drawing image|vector lines/.test(it.det.src) && it.det.gap > 0, "…with the method (" + (it && it.det && it.det.src) + ") and the door gap (" + (it && it.det && it.det.gap) + " ft)");
  ok(it && it.det && near(it.det.a0, 168, 1.5), "…and the detected area " + (it && it.det && it.det.a0) + " Sft (bed room 12 × 14 = 168)");
  ok(it && it.det && it.det.pts0.length === it.pts.length && it.det.at, "…the original outline and when it was found");
  await T(id => { zdTakeoff.setSel([id]); zdTakeoff.refresh(); }, it.id); await wait(100);
  ok(/Auto area · from the/.test(await page.innerText("#props")) && /as detected/.test(await page.innerText("#props")), "Properties show the detection line, ‘as detected’");
  await T(id => { const i = zdTakeoff.P.proj.items.find(x => x.id === id); zdTakeoff.P.proj.items[zdTakeoff.P.proj.items.indexOf(i)].pts = i.pts.map((p, j) => j === 0 ? [p[0] - 9, p[1]] : p); zdTakeoff.refresh(); }, it.id); await wait(100);
  ok(await T(id => zdTakeoff.detEdited(zdTakeoff.P.proj.items.find(x => x.id === id)), it.id) && /edited/.test(await page.innerText("#props")), "a moved corner shows as edited, with the area change");
  await page.click('[data-act="detShow"]'); await wait(80);
  ok(await T(() => zdTakeoff.S.detShow) && await T(() => document.querySelector("#svg, svg") !== null), "Show detected draws the original outline next to the current one");
  await page.click('[data-act="detRestore"]'); await wait(100);
  ok(!(await T(id => zdTakeoff.detEdited(zdTakeoff.P.proj.items.find(x => x.id === id)), it.id)), "Restore detected puts the outline back");
  await T(() => zdTakeoff.undoAny()); await wait(80);
  ok(await T(id => zdTakeoff.detEdited(zdTakeoff.P.proj.items.find(x => x.id === id)), it.id), "Ctrl+Z undoes the restore");
  await page.click('[data-act="detShow"]');
  // preview before adding
  const n0 = await T(() => zdTakeoff.P.proj.items.length);
  await T(() => { zdTakeoff.P.proj.auto = Object.assign({}, zdTakeoff.P.proj.auto || {}, {confirm: true}); });
  const seedStore = [100 + 6.75 + 108 + 3.375 + 45, H - (100 + 6.75 + 63)];
  let pr = T(p => zdTakeoff.autoAt(p), seedStore); await page.waitForSelector("#autoPrevBar.on", {timeout: 8000});
  ok(/STORE|Room/.test(await page.innerText("#autoPrevBar")) && await T(() => !!zdTakeoff.S.autoPrev), "preview on: the outline is shown with Accept / Tighter / Wider / Cancel before anything is added");
  ok(await T(() => zdTakeoff.P.proj.items.length) === n0, "…and nothing is added yet");
  await page.keyboard.press("Escape"); await pr; await wait(100);
  ok(await T(() => zdTakeoff.P.proj.items.length) === n0 && !(await T(() => zdTakeoff.S.autoPrev)), "Esc cancels: nothing added");
  pr = T(p => zdTakeoff.autoAt(p), seedStore); await page.waitForSelector("#autoPrevBar.on", {timeout: 8000});
  await page.click('[data-ap="ok"]'); await pr; await wait(150);
  const st = await T(() => { const i = zdTakeoff.P.proj.items[zdTakeoff.P.proj.items.length - 1]; return {n: zdTakeoff.P.proj.items.length, a: i.det && i.det.a0}; });
  ok(st.n === n0 + 1 && near(st.a, 140, 1.5), "Accept adds it: store " + st.a + " Sft (10 × 14 = 140)");
  await T(() => { zdTakeoff.P.proj.auto.confirm = false; });
  await T(() => zdTakeoff.setTool("select"));

  console.log("working rules");
  pr = T(() => zdTakeoff.aiSend("remember: always show me the detected boundary before accepting new areas")); await page.waitForSelector("#ruTx", {timeout: 4000});
  ok(/show me the detected boundary/i.test(await page.inputValue("#ruTx")) && await page.isChecked('input[name=ruSc][value=project]'), "‘remember: …’ asks to save the rule, this project picked");
  ok(/Auto area shows each outline first/.test(await page.innerText("#dlgB")), "…and says what the app will do about it");
  await page.click("#dlgOk"); await pr; await wait(100);
  let rules = await T(() => zdTakeoff.rulesActive());
  ok(rules.length === 1 && rules[0].scope === "project", "saved as a project rule");
  ok(await T(() => !!zdTakeoff.P.proj.auto.confirm), "…and Auto area's preview is switched on by it");
  ok((await log()).some(l => /Rule saved for this project/.test(l)), "the chat confirms where it was saved");
  pr = T(() => zdTakeoff.aiSend("never show me the detected boundary before accepting new areas")); await page.waitForSelector("#ruTx", {timeout: 4000});
  ok(/may conflict/.test(await page.innerText("#dlgB")), "an opposite rule is flagged as a conflict");
  await page.click('input[name=ruSc][value=global]'); await page.click("#dlgOk"); await pr; await wait(100);
  ok(await T(() => zdTakeoff.rulesOf("global").length) === 1 && await T(() => JSON.parse(localStorage.getItem("zdTakeoffAgentRules")).length) === 1, "an every-project rule is kept in this browser");
  pr = T(() => zdTakeoff.aiSend("remember: just for this, use Sft")); await page.waitForSelector("#ruTx", {timeout: 4000});
  await page.click('input[name=ruSc][value=once]'); await page.click("#dlgOk"); await pr; await wait(150);
  ok(await T(() => zdTakeoff.rulesActive().length) === 2, "‘this request only’ is not saved");
  pr = T(() => zdTakeoff.rulesDialog()); await wait(200);
  await page.uncheck('[data-ruon="global:0"]'); await page.fill("#ruNew", "Group finishing quantities by floor and trade"); await page.click("#dlgOk"); await pr; await wait(100);
  rules = await T(() => zdTakeoff.rulesActive().map(r => r.text));
  ok(rules.length === 2 && rules.includes("Group finishing quantities by floor and trade") && !rules.some(r => /^never/i.test(r)), "Rules: switch one off, add one (" + rules.length + " active)");
  ok(await T(() => zdTakeoff.ruleTeach("never mind, leave it")) === false && await T(() => zdTakeoff.ruleTeach("measure the lounge")) === false, "‘never mind…’ and ordinary requests are not taken for rules");

  console.log("local AI: setup states");
  await T(u => { localStorage.setItem("zdTakeoffLocalUrl", u); localStorage.removeItem("zdTakeoffLocalModel"); }, "http://127.0.0.1:11999");
  let L = await T(() => zdTakeoff.locHealth().then(x => ({st: x.st, msg: x.msg})));
  ok(L.st === "offline" && /Ollama is not running/.test(L.msg) && /Ollama is running/.test(L.msg), "nothing listening: says Ollama is not running, how to check (" + L.msg.slice(0, 70) + "…)");
  // Ollama running but not allowing this site (OLLAMA_ORIGINS unset): told apart from "not running"
  const mock2 = spawn(process.execPath, [path.join(__dirname, "mock_ollama.js"), "11503", "https://some-other-site.example"], {stdio: "ignore"}); await new Promise(r => setTimeout(r, 400));
  await T(u => localStorage.setItem("zdTakeoffLocalUrl", u), "http://127.0.0.1:11503");
  L = await T(() => zdTakeoff.locHealth().then(x => ({st: x.st, msg: x.msg})));
  ok(L.st === "blocked" && /IS running/.test(L.msg) && /OLLAMA_ORIGINS=/.test(L.msg) && /Quit Ollama|QUIT Ollama/i.test(L.msg), "running but not allowed: says so, with OLLAMA_ORIGINS and ‘quit and restart Ollama’ (" + L.msg.slice(0, 60) + "…)");
  mock2.kill();
  const pr0 = T(() => zdTakeoff.locSetup()); await page.waitForSelector("#leSetx", {timeout: 6000});
  ok(new RegExp('setx OLLAMA_ORIGINS "' + new globalThis.URL(URL).origin.replace(/[.]/g, "\\.") + '"').test(await page.innerText("#leSetx")) && await page.isVisible("#leOpen"), "the setup shows the one-line Windows command (setx) with this site, and a link to open Ollama's own page");
  await page.click("#dlgCancel"); await pr0;
  await T(u => localStorage.setItem("zdTakeoffLocalUrl", u), MOCK);
  L = await T(() => zdTakeoff.locHealth().then(x => ({st: x.st, msg: x.msg, models: x.models.map(m => m.name)})));
  ok(L.st === "none" && L.models.length === 2, "Ollama running, no model chosen: lists the installed models (" + L.models.join(", ") + ")");
  await T(() => localStorage.setItem("zdTakeoffLocalModel", "qwen-not-there:1b"));
  L = await T(() => zdTakeoff.locHealth().then(x => ({st: x.st, msg: x.msg})));
  ok(L.st === "nomodel" && /ollama pull qwen-not-there:1b/.test(L.msg), "a model that is not installed: says ‘ollama pull …’");
  await T(() => localStorage.setItem("zdTakeoffLocalModel", "mock-tools:8b"));
  L = await T(() => zdTakeoff.locHealth().then(x => ({st: x.st, msg: x.msg})));
  ok(L.st === "ready" && /tools/.test(L.msg), "chosen and installed: ready, with its capabilities (" + L.msg + ")");
  // a site Ollama does not allow (another origin): refused
  const page2 = await ctx.newPage(); await page2.goto("http://localhost:8765/takeoff/", {waitUntil: "load"}).catch(() => {});
  const blocked = await page2.evaluate(async u => { try { await fetch(u + "/api/version"); return "allowed"; } catch (e) { return "refused"; } }, MOCK).catch(() => "n/a");
  ok(blocked === "refused", "a site not in OLLAMA_ORIGINS is refused by Ollama (" + blocked + ")"); await page2.close();

  console.log("local AI: the agent uses the real tools");
  await T(() => zdTakeoff.aiToggle ? 0 : 0);
  let out = await send("What is the total area on this page?");
  const sheetTotal = await T(() => { const P = zdTakeoff.P.proj; return P.items.filter(i => i.file === zdTakeoff.S.fileId && i.page === zdTakeoff.S.pageNo).reduce((a, i) => a + zdTakeoff.rowsOf(i, 9).reduce((b, r) => b + r.qty, 0), 0); });
  const totLine = out.find(l => /^bot: Totals:/.test(l)) || "";
  ok(out.some(l => /^tool:/.test(l)) && new RegExp("Floor area " + (+sheetTotal.toFixed(3)) + " Sft").test(totLine), "‘total’ → quantity_totals ran here; the answer is the sheet's own " + sheetTotal.toFixed(3) + " Sft (" + totLine.slice(0, 60) + ")");
  ok(out.some(l => /^meta: local · mock-tools:8b · .* 40\.0 tokens\/s · 1 tool call · nothing sent to the internet/.test(l)), "each reply shows its KPIs: time, tokens/s, tool calls");
  let M = await mlog(); const first = M[0];
  ok(first && first.tools.includes("quantity_totals") && first.tools.includes("trace_room") && first.tools.length >= 19, "the model is offered the whole tool registry (" + (first && first.tools.length) + " tools)");
  ok(first && /THE USER'S WORKING RULES/.test(first.sys) && /show me the detected boundary/.test(first.sys) && !/^never/im.test(first.sys.split("WORKING RULES")[1] || ""), "the active rules go with the instructions (the switched-off one does not)");
  ok(first && !first.images, "a model without vision gets no picture");
  ok(M.some(x => x.last && x.last.role === "tool" && x.last.tool_name === "quantity_totals"), "tool results go back as role ‘tool’ with the tool's name");
  await T(id => { zdTakeoff.setSel([id]); zdTakeoff.refresh(); }, it.id);
  out = await send("Show the calculation for this room");
  ok(out.some(l => /^bot: Calculation: .*Sft/.test(l)), "‘show the calculation’ → explain_measurement: rows with Nos × L × W × H (" + (out.find(l => /Calculation/.test(l)) || "").slice(0, 70) + ")");
  const nItems = await T(() => zdTakeoff.P.proj.items.length);
  out = await send("undo that");
  ok(await T(() => zdTakeoff.P.proj.items.length) <= nItems && out.some(l => /Undone:/.test(l)), "‘undo’ → undo_last undid the last change");
  await T(() => zdTakeoff.redoAny());
  out = await send("bad args please");
  ok(out.some(l => /^err: .*rejected \(missing what\)/.test(l)) && out.some(l => /^bot: The tool failed/.test(l)), "a tool call with a missing argument is rejected, not run, and the model is told why");
  out = await send("json in text");
  ok(out.some(l => /^tool:/.test(l)), "a tool call written in the reply text (small models) is still run");
  out = await send("who won the 2030 world cup?");
  ok(out.some(l => /I don't know/.test(l)) && !out.some(l => /^tool:/.test(l)), "a question it cannot answer offline: it says it does not know");
  const hist = await T(() => JSON.parse(localStorage.getItem("zdTakeoffChat:" + zdTakeoff.P.proj.id) || "[]"));
  ok(hist.length >= 8 && hist.every(h => !/base64|data:image/.test(h.content)), "the conversation is kept for this project (" + hist.length + " messages, text only)");
  M = await mlog(); ok(M[M.length - 1].n > 3, "follow-up messages carry the earlier conversation");
  await T(() => localStorage.setItem("zdTakeoffLocalModel", "mock-vision:4b")); await T(() => zdTakeoff.locHealth());
  await send("conditions in this project?");
  M = await mlog(); ok(M[M.length - 2].images === true, "a vision model gets the picture of the view");

  console.log("no cloud fallback");
  await T(() => localStorage.setItem("zdTakeoffApiKey", "sk-ant-test-not-real"));
  await T(u => localStorage.setItem("zdTakeoffLocalUrl", u), "http://127.0.0.1:11999"); await T(() => { zdTakeoff.LOC.checked = 0; });
  { const n = (await log()).length, pr2 = T(() => zdTakeoff.aiSend("count all doors"));
    const dlg = await page.waitForSelector("#dlgBack.on", {timeout: 6000}).catch(() => null);
    if (dlg) { const all = await page.$('input[name=arW][value=all]'); if (all) await all.check(); await page.click("#dlgOk"); }
    await pr2; await wait(200); out = (await log()).slice(n); }
  ok(out.some(l => /built-in rule agent/.test(l)) && !cloud.length, "local AI down (with an API key set): the built-in rule agent answers, nothing goes to a cloud service (" + cloud.length + " cloud requests)");
  await T(() => localStorage.removeItem("zdTakeoffApiKey"));

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); mock.kill();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

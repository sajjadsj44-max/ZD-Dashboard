#!/usr/bin/env node
/* Browser tests for PDF Takeoff's start-up ribbon tab and the Settings window (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_settings.js

   The ribbon opens on My tools after a refresh even when the project reopens with a condition (the Length tool active), and stays on
   My tools when a tool is picked there; Settings (⚙ in the top bar, Ctrl+,): every page opens, search finds a setting on any page, a
   change applies at once and is kept (start-up tab, ribbon following the tool, open the last project, snap distance, dimmer, labels,
   measurement colour, ribbon tabs), your own shortcut runs a command, settings to a file and back, Reset all keeps My tools; phone width. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  // the relay and the chat-archive branch (Team logins reads who used the app): empty, no network
  await ctx.route(/ntfy\.sh|raw\.githubusercontent\.com/, r => r.fulfill({status: 200, contentType: "text/plain", headers: {"Access-Control-Allow-Origin": "*"}, body: ""}));
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const tab = () => T(() => (document.querySelector("#tools .rtab.on") || {dataset: {}}).dataset.rtab);
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "settings-" + n + ".png")}); };
  const reload = async (proj = true) => { await page.reload({waitUntil: "load"});
    await page.waitForFunction(p => window.zdTakeoff && (p ? zdTakeoff.P.proj && zdTakeoff.S.page : document.getElementById("start").classList.contains("on")), proj, {timeout: 20000}); await wait(500); };
  const openSet = async pg => { await T(p => { zdTakeoff.settingsDialog(p); }, pg); await wait(200); };   // (not awaited: it resolves when the window closes)
  const close = async () => { await page.click("#dlgCancel"); await wait(150); };
  const setVal = async (name, v) => { await T(([n, v]) => { const r = [...document.querySelectorAll("#stgBody .srow")].find(x => (x.querySelector(".sl b") || {}).textContent === n), c = r && r.querySelector("[data-si]");
    if (!c) throw new Error("no setting " + n); if (c.type === "checkbox") c.checked = !!v; else c.value = v; c.dispatchEvent(new Event("change", {bubbles: true})); }, [name, v]); await wait(200); };
  const btn = async name => { await T(n => { const r = [...document.querySelectorAll("#stgBody .srow")].find(x => (x.querySelector(".sl b") || {}).textContent === n), b = r && r.querySelector("[data-sb]"); if (!b) throw new Error("no button " + n); b.click(); }, name); await wait(250); };

  console.log("start-up tab — the user's case: a project with a condition reopened after a refresh");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Settings test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await page.click('[data-rtab="takeoff"]'); await wait();
  await reload();
  ok(await T(() => zdTakeoff.S.tool) === "draw", "the project reopens with its condition and the Length tool, as before");
  ok(await tab() === "mine", "…and the ribbon shows My tools, not Takeoff (" + await tab() + ")");
  ok(await T(() => !document.querySelector('[data-rp="mine"]').hidden && document.querySelector('[data-rp="takeoff"]').hidden), "the My tools panel is the one on show");

  console.log("a tool picked in My tools keeps My tools open");
  await page.click('[data-rtab="takeoff"]'); await wait();
  await page.dragAndDrop('[data-tool="rect"]', '[data-rtab="mine"]'); await wait(350);
  ok(await tab() === "mine" && (await page.locator("#mineBox [data-mine]").count()) >= 1, "Rect dragged into My tools");
  await page.click('#mineBox [data-mine="takeoff/rect"]'); await wait();
  ok(await T(() => zdTakeoff.S.tool) === "rect" && await tab() === "mine", "clicking it there starts Rect and stays on My tools");
  await page.keyboard.press("r"); await wait();
  ok(await tab() === "mine", "pressing R (a tool in My tools) stays on My tools");
  await page.keyboard.press("e"); await wait();
  ok(await tab() === "takeoff", "pressing E (Circle, not in My tools) shows its Takeoff tab");
  await page.keyboard.press("Escape"); await page.keyboard.press("v");

  console.log("Settings window");
  await page.click("#bSettings"); await wait(250);
  ok(await dlgOpen() && await page.isVisible("#stgNav"), "⚙ Settings in the top bar opens the Settings window");
  const pages = await T(() => [...document.querySelectorAll("#stgNav [data-spg]")].map(b => b.dataset.spg));
  ok(pages.length >= 13 && ["general", "ribbon", "panels", "view", "snap", "measure", "markup", "labels", "keys", "export", "ai", "save", "file"].every(p => pages.includes(p)), "13 pages: " + pages.join(", "));
  let bad = [];
  for (const p of pages) { await page.click(`#stgNav [data-spg="${p}"]`); await wait(80); const n = await T(() => document.querySelectorAll("#stgBody .srow").length); if (!n) bad.push(p); if (p === "general") await shot("general"); }
  ok(!bad.length, "every page shows its settings" + (bad.length ? " — empty: " + bad.join(", ") : ""));
  await page.fill("#stgQ", "dimmer"); await wait(150);
  ok(await T(() => [...document.querySelectorAll("#stgBody .srow .sl b")].map(b => b.textContent).includes("Dimmer")), "search “dimmer” finds the Dimmer from the Drawing page");
  await page.fill("#stgQ", "zzqx"); await wait(100);
  ok(await T(() => /No setting matches/.test(document.getElementById("stgBody").textContent)), "a search with no match says so");
  await page.fill("#stgQ", ""); await close();
  ok(!(await dlgOpen()), "Close closes it");
  await page.keyboard.press("Control+Comma"); await wait(250);
  ok(await dlgOpen() && await page.isVisible("#stgNav"), "Ctrl+, opens Settings");
  await page.keyboard.press("Escape"); await wait(150);
  ok(!(await dlgOpen()), "Esc closes it");
  await page.click('[data-rtab="costing"]'); await page.click('#tools [data-px="bDefaults"]'); await wait(250);
  ok(await dlgOpen() && await T(() => (document.querySelector("#stgNav .spg.on") || {dataset: {}}).dataset.spg) === "measure", "Costing → Defaults opens Settings on its Measurements page");
  await close();

  console.log("General: start-up tab, the ribbon following the tool, the last project");
  await openSet("general"); await setVal("Ribbon tab when the app opens", "view"); await close();
  ok(await T(() => zdTakeoff.setPref().homeTab) === "view", "start-up tab set to View");
  await reload(); ok(await tab() === "view", "after a refresh the ribbon opens on View");
  await openSet("general"); await setVal("Ribbon tab when the app opens", "mine");
  await setVal("When a tool is picked by its key or a menu", "never"); await close();
  await page.click('[data-rtab="review"]'); await page.keyboard.press("e"); await wait();
  ok(await tab() === "review" && await T(() => zdTakeoff.S.tool) === "circle", "“Keep the tab I am on”: E starts Circle and the Review tab stays");
  await openSet("general"); await setVal("When a tool is picked by its key or a menu", "smart"); await setVal("Open the last project when the app starts", false); await close();
  await reload(false);
  ok(await T(() => document.getElementById("start").classList.contains("on")), "“Open the last project” off: the app starts on the project list");
  await T(() => zdTakeoff.setSave({openLast: true})); await reload();
  ok(await T(() => !!zdTakeoff.P.proj) && await tab() === "mine", "switched back on: the project opens again, on My tools");

  console.log("a change applies at once and is kept");
  await openSet("snap"); await setVal("Snap distance", 18);
  ok(await T(() => zdTakeoff.SNAP_PX) === 18, "Snap distance 18 px is used at once");
  await setVal("Snap distance", 400);
  ok(await T(() => zdTakeoff.SNAP_PX) === 40, "a distance over the limit is held at 40 px");
  await page.click('#stgNav [data-spg="view"]'); await wait(100); await setVal("Dimmer", 35);
  ok(await T(() => zdTakeoff.S.dim && zdTakeoff.S.dimPct === 35 && localStorage.getItem("zdTakeoffDim") === "35"), "Dimmer 35 % dims the drawing and is kept");
  await page.click('#stgNav [data-spg="labels"]'); await wait(100); await setVal("Condition name", true); await setVal("Label size", 150);
  ok(await T(() => { const o = JSON.parse(localStorage.getItem("zdTakeoffLbl")); return o.cond === true && o.scale === 1.5 && zdTakeoff.S.lbl.cond; }), "Labels: condition name on, size 150 % — kept with the label settings");
  await T(() => { const l = [...document.querySelectorAll("#stgBody .srow")].find(x => (x.querySelector(".sl b") || {}).textContent === "Units (Sft, ft, cft, Nos)"); l.querySelector(".sl").click(); }); await wait(150);
  ok(await T(() => zdTakeoff.S.lbl.units === false), "clicking a switch's words flips it (Units off)");
  await page.click('#stgNav [data-spg="measure"]'); await wait(100); await setVal("Colour of new conditions", "#e34948");
  ok(await T(() => JSON.parse(localStorage.getItem("zdTakeoffDefaults")).condColor === "#e34948"), "Measurements: the colour of new conditions is saved");
  await page.click('#stgNav [data-spg="ribbon"]'); await wait(100); await setVal("Costing tab", false);
  ok(await T(() => document.querySelector('[data-rtab="costing"]').style.display === "none"), "Ribbon: unticking the Costing tab hides it");
  await setVal("Costing tab", true);
  ok(await T(() => document.querySelector('[data-rtab="costing"]').style.display !== "none"), "ticking it shows it again");
  await T(() => { const o = JSON.parse(localStorage.getItem("zdTakeoffTb") || "{}"); o.tabs = ["takeoff", "modify", "markup", "review", "costing", "material", "export", "view"]; localStorage.setItem("zdTakeoffTb", JSON.stringify(o)); });
  await page.click('#stgNav [data-spg="general"]'); await page.click('#stgNav [data-spg="ribbon"]'); await wait(100);
  await setVal("★ My tools tab", false);
  ok(await T(() => !(JSON.parse(localStorage.getItem("zdTakeoffTb")).tabs || []).includes("mine") || JSON.parse(localStorage.getItem("zdTakeoffTb")).tabs.length < 9), "the last tab shown cannot be hidden");
  await T(() => { const o = JSON.parse(localStorage.getItem("zdTakeoffTb") || "{}"); o.tabs = []; localStorage.setItem("zdTakeoffTb", JSON.stringify(o)); });
  await page.click('#stgNav [data-spg="snap"]'); await wait(100); await page.click("#stgReset"); await wait(200);
  ok(await T(() => zdTakeoff.SNAP_PX) === 11, "Snap & drafting → Reset this page: snap distance back to 11 px");
  await close();

  console.log("your own shortcut");
  await openSet("keys");
  await page.click("#skKey"); await page.keyboard.press("Control+Alt+KeyJ"); await wait(80);
  ok(await page.inputValue("#skKey") === "Ctrl+Alt+J", "pressing Ctrl+Alt+J in the box reads it as “Ctrl+Alt+J”");
  const rectCmd = await T(() => (zdTakeoff.keyCmd("Rect") || zdTakeoff.paletteCmds().find(c => /^Rect/.test(c.t)) || {}).t);
  await page.fill("#skCmd", rectCmd || "Rect"); await page.click("#skAdd"); await wait(200);
  ok(await T(() => zdTakeoff.setPref().keys.some(k => k.k === "Ctrl+Alt+J")), "Add keeps it: Ctrl+Alt+J → " + rectCmd);
  await page.click("#skKey"); await page.keyboard.press("KeyQ"); await wait(50); await page.fill("#skCmd", rectCmd || "Rect"); await page.click("#skAdd"); await wait(150);
  ok(await T(() => !zdTakeoff.setPref().keys.some(k => k.k === "Q")), "a single key (Q) is refused — it is a tool's own key");
  await close();
  await page.keyboard.press("v"); await wait(80); await page.keyboard.press("Control+Alt+KeyJ"); await wait(200);
  ok(await T(() => zdTakeoff.S.tool) === "rect", "Ctrl+Alt+J on the drawing starts Rect");
  await openSet("keys"); await T(() => document.querySelector("#stgBody [data-skrm]").click()); await wait(150);
  ok(await T(() => !zdTakeoff.setPref().keys.length), "✕ takes the shortcut out"); await close();

  console.log("settings to a file and back; Reset all");
  await openSet("general"); await setVal("Ribbon tab when the app opens", "markup");
  await page.click('#stgNav [data-spg="file"]'); await wait(100);
  const [down] = await Promise.all([page.waitForEvent("download"), btn("Save my settings to a file")]);
  const file = JSON.parse(fs.readFileSync(await down.path(), "utf8"));
  ok(file.app === "ZD Takeoff settings" && JSON.parse(file.keys.zdTakeoffSet).homeTab === "markup" && !("zdTakeoffApiKey" in file.keys) && !("zdTakeoffLast" in file.keys), "Export: a JSON file with the settings (start-up tab: Markup), without the AI key or the last project");
  ok(!!file.keys.zdTakeoffTb && JSON.parse(file.keys.zdTakeoffTb).mine.includes("takeoff/rect"), "…and My tools");
  await btn("Reset every setting"); await wait(100);
  ok(await dlgOpen() && /Click again/.test(await T(() => [...document.querySelectorAll("#stgBody [data-sb]")].map(b => b.textContent).join("|"))), "Reset all asks for a second click first");
  await Promise.all([page.waitForEvent("load"), btn("Reset every setting")]);
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(500);
  ok(await T(() => zdTakeoff.setPref().homeTab === "mine" && !zdTakeoff.S.dim && JSON.parse(localStorage.getItem("zdTakeoffDefaults") || "{}").condColor !== "#e34948" && !zdTakeoff.S.lbl.cond), "after Reset all: start-up tab My tools, dimmer off, measurement colour and labels back to the defaults");
  ok(await T(() => (JSON.parse(localStorage.getItem("zdTakeoffTb") || "{}").mine || []).includes("takeoff/rect")) && await tab() === "mine", "My tools is kept, and the ribbon opens on it");
  await openSet("file");
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), btn("Load settings from a file")]);
  await Promise.all([page.waitForEvent("load"), fc.setFiles({name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file))})]);
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(500);
  ok(await T(() => zdTakeoff.setPref().homeTab) === "markup" && await tab() === "markup", "Import: the file's settings are back (opens on Markup)");
  ok(await T(() => JSON.parse(localStorage.getItem("zdTakeoffDefaults") || "{}").condColor) === "#e34948", "…with the measurement colour");
  await T(() => zdTakeoff.setSave({homeTab: "mine"}));

  console.log("phone width");
  await page.setViewportSize({width: 390, height: 800}); await wait(300);
  await openSet("labels"); await wait(200); await shot("phone");
  ok(await T(() => { const d = document.querySelector(".dlg"), r = d.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }), "Settings fits at 390 px (no sideways scroll)");
  await close();
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));

  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

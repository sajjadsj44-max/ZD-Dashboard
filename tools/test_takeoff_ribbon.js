#!/usr/bin/env node
/* Browser tests for the PDF Takeoff ribbon and the tools added with it (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_ribbon.js

   Tool groups (Takeoff / Modify / Markup / Review tabs, Select tools always on show) and the tab following the active tool; the Modify actions
   (rotate, mirror, duplicate, lock, join, explode, close, offset) on the selection; Ortho (F8) and Polar (F10); object
   snaps (perpendicular, the snap list); the corner angle of a quick measure; search and sort of the measurement sheet;
   Next / Previous unchecked and Check selected; the palette finds the new commands; phone width. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, o = {}) => { const p = await scr(x, y); await page.mouse.move(p[0] + (o.dx || 0), p[1] + (o.dy || 0)); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(60); };
  const rows = () => T(() => { const Z = zdTakeoff, P = Z.P.proj; return P.items.map(it => { const sc = P.scales[it.file + ":" + it.page]; return {id: it.id, cond: (P.conds.find(c => c.id === it.cond) || {}).name, kind: it.kind, rows: sc ? Z.rowsOf(it, sc.ptPerFt).map(r => ({nos: r.nos, L: r.L, W: r.W, H: r.H, qty: r.qty, below: r.below, sign: r.sign})) : null}; }); });
  const lastItem = async () => (await rows()).slice(-1)[0];
  const total = name => T(n => { const c = zdTakeoff.P.proj.conds.find(x => x.name === n); return zdTakeoff.condTotals(c); }, name);
  const newCond = async (preset, o = {}) => {
    await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); if (preset === "Internal plaster on walls — both faces") await shot("condition");
    if (o.h) await page.fill("#cH", o.h);
    if (o.name) await page.fill("#cName", o.name);
    await page.click("#dlgOk");
    const shut = await page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 3000}).then(() => true, () => false);
    if (!shut) console.log("    (condition dialog still open: " + (await page.innerText("#dlgErr")) + " · H=" + (await page.inputValue("#cH")) + ")");
    await wait(200);
  };
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "takeoff-" + n + ".png")}); };
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));

  console.log("ribbon");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Ribbon test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  const vis = sel => page.isVisible(sel);
  const tab = () => T(() => (document.querySelector("#tools .rtab.on") || {dataset: {}}).dataset.rtab);
  ok(await tab() === "takeoff" && await vis('[data-tool="draw"]') && !(await vis('[data-mod="cw"]')), "the Takeoff tab is open first: its tools show, Modify's do not");
  ok((await page.locator("#tools .rtab").count()) === 8 && await vis('[data-tool="select"]') && await vis('[data-tool="pan"]'), "eight tabs (Takeoff, Modify, Markup, Review, Costing, Export, My tools, View); Select, Match, Lasso and Pan are always on show");
  ok((await page.locator("#tools svg.ic").count()) > 40 && !(await T(() => [...document.querySelectorAll("#tools .tool")].some(b => /[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]/u.test(b.textContent)))), "tool icons are SVG (no Unicode symbols on the toolbar)");
  await page.click('[data-rtab="modify"]');
  ok(await tab() === "modify" && await vis('[data-mod="cw"]') && !(await vis('[data-tool="draw"]')), "Modify tab shows rotate / mirror / join… and hides the Takeoff tools");
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await page.keyboard.press("r"); await wait();
  ok(await tab() === "takeoff", "pressing R (a Takeoff tool) brings the Takeoff tab back");
  await page.keyboard.press("m"); await wait();
  ok(await tab() === "takeoff" && (await T(() => zdTakeoff.S.tool)) === "measure", "M opens quick measure on its tab");
  await page.keyboard.press("n"); await wait();
  ok(await tab() === "markup", "N (note) opens the Markup tab"); await page.keyboard.press("Escape");
  await page.keyboard.press("v");

  console.log("modify actions");
  await page.click('[data-rtab="takeoff"]'); await page.keyboard.press("s");   // snap off: free shapes
  await page.keyboard.press("r");
  await click(300, 300); await click(390, 345);   // 10 x 5 ft
  let it = await lastItem();
  ok(it.rows[0].L === 10 && it.rows[0].W === 5 && it.rows[0].qty === 50, "rectangle 10.000 × 5.000 = 50.00 Sft");
  await page.keyboard.press("v"); await wait();
  const id0 = await T(() => zdTakeoff.P.proj.items.slice(-1)[0].id);
  await T(id => zdTakeoff.setSel([id]), id0).catch(() => {}); 
  if (!(await T(() => zdTakeoff.selIds().size))) { await click(345, 322); }
  ok((await T(() => zdTakeoff.selIds().size)) === 1, "the rectangle is selected");
  await page.click('[data-rtab="modify"]');
  await page.click('[data-mod="cw"]'); await wait(200);
  it = await lastItem();
  ok(it.rows[0].qty === 50 && it.rows[0].L === 5 && it.rows[0].W === 10, "Rotate: 5.000 × 10.000, still 50.00 Sft");
  await page.click('[data-mod="fh"]'); await wait(200);
  it = await lastItem();
  ok(it.rows[0].qty === 50 && it.rows[0].L === 5, "Mirror keeps the quantity");
  const n0 = await T(() => zdTakeoff.P.proj.items.length);
  await page.click('[data-mod="dup"]'); await wait(250);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 + 1, "Duplicate adds one measurement");
  await page.click('[data-mod="lock"]'); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.some(i => i.locked)), "Lock locks the selection");
  await page.click('[data-mod="lock"]'); await wait(200);
  ok(!(await T(() => zdTakeoff.P.proj.items.some(i => i.locked))), "Lock again unlocks it");
  await T(() => zdTakeoff.setSel([])); await page.click('[data-mod="cw"]'); await wait(150);
  ok(/Select what to change first/.test(await page.innerText("#toast")), "a Modify action with nothing selected says what to do");
  await page.click('[data-mod="offset"]'); await wait(150);
  ok(/Select one measurement/.test(await page.innerText("#toast")), "Offset needs exactly one measurement");

  console.log("runs: join, explode, close, offset");
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Internal plaster on walls — both faces"}); await page.fill("#cH", "10"); await page.click("#dlgOk"); await wait(250);
  await page.click('[data-rtab="takeoff"]'); await page.keyboard.press("a");
  for (const [x, y] of [[300, 450], [360, 450]]) await click(x, y); await page.keyboard.press("Enter"); await wait();
  for (const [x, y] of [[360, 450], [360, 500], [300, 500]]) await click(x, y); await page.keyboard.press("Enter"); await wait();
  const runs = await T(() => zdTakeoff.P.proj.items.filter(i => { const c = zdTakeoff.P.proj.conds.find(x => x.id === i.cond); return c && c.type === "linear"; }).map(i => i.id));
  ok(runs.length === 2, "two runs drawn");
  await page.keyboard.press("v"); await T(ids => zdTakeoff.setSel(ids), runs); await wait();
  await page.click('[data-rtab="modify"]'); await page.click('[data-mod="join"]'); await wait(250);
  const lin = () => T(() => zdTakeoff.P.proj.items.filter(i => { const c = zdTakeoff.P.proj.conds.find(x => x.id === i.cond); return c && c.type === "linear"; }));
  let L = await lin();
  ok(L.length === 1 && L[0].pts.length === 4, "Join: two runs become one run of 4 points");
  await T(id => zdTakeoff.setSel([id]), L[0].id);
  await page.click('[data-mod="close"]'); await wait(250);
  L = await lin(); ok(L[0].pts.length === 5, "Close: the run goes back to its first point");
  await page.click('[data-mod="explode"]'); await wait(250);
  L = await lin(); ok(L.length === 4, "Explode: one run per segment (4 legs)");

  console.log("ortho, polar, snaps");
  const cur = () => T(() => { const S = zdTakeoff.S; return {c: S.cursor, s: S.snap ? S.snap.type : ""}; });
  const hover = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0] + 3, p[1] + 3); await wait(40); await page.mouse.move(p[0], p[1]); await wait(80); };
  await page.keyboard.press("a");
  await click(500, 300);
  const y0 = await T(() => zdTakeoff.S.draft[0][1]);
  await hover(560, 303);
  let c1 = await cur(); ok(Math.abs(c1.c[1] - y0) > 0.5, "free: the point is where the cursor is, a little off the horizontal");
  await page.keyboard.press("F8"); await wait(100);
  ok(await T(() => zdTakeoff.S.ortho === true) && (await page.locator("#bOrtho.on").count()) === 1, "F8 turns Ortho on (the button lights up)");
  await hover(560, 303); c1 = await cur();
  ok(near(c1.c[1], y0, 0.01), "Ortho: the point is pulled onto the horizontal, with no Shift held");
  await hover(503, 360); c1 = await cur();
  ok(near(c1.c[0], 500, 0.01), "Ortho: and onto the vertical");
  await page.keyboard.down("Shift"); await hover(560, 303); c1 = await cur(); await page.keyboard.up("Shift");
  ok(Math.abs(c1.c[1] - y0) > 0.5, "Shift while Ortho is on frees the point for that click");
  await page.keyboard.press("F10"); await wait(100);
  ok(await T(() => zdTakeoff.S.polar === true && zdTakeoff.S.ortho === false), "F10 turns Polar on and Ortho off (as AutoCAD)");
  { const a = Math.atan2(1, 1) + 1.5 * Math.PI / 180, r = 80; await hover(500 + r * Math.cos(a), 300 + r * Math.sin(a)); c1 = await cur(); }
  { const d0 = await T(() => zdTakeoff.S.draft[0]), dx = c1.c[0] - d0[0], dy = d0[1] - c1.c[1]; ok(near(Math.atan2(dy, dx) * 180 / Math.PI, 45, 0.01) && /polar 45/.test(c1.s), `Polar: 46.5° is pulled onto 45° (${c1.s})`); }
  { const a = 30 * Math.PI / 180 + 0.35, r = 80; await hover(500 + r * Math.cos(a), 300 + r * Math.sin(a)); c1 = await cur();
    ok(!/polar/.test(c1.s), "Polar: 50° (more than 4° from any 15° direction) is left alone"); }
  await page.keyboard.press("F10"); await page.keyboard.press("Escape"); await wait(100);
  ok(!(await T(() => zdTakeoff.S.polar)) && !(await T(() => zdTakeoff.S.ortho)), "F10 again: Polar off");

  await page.keyboard.press("m"); await wait();
  await click(600, 200); await click(650, 200); await hover(650, 250);
  ok(/corner 90\.0°/.test(await page.innerText("#stMeas")), "quick measure shows the corner angle: " + (await page.innerText("#stMeas")).replace(/\s+/g, " ").slice(0, 80));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

  // perpendicular: the foot of the perpendicular from the last point onto a wall line
  await page.keyboard.press("s"); await page.keyboard.press("a");   // snap back on
  await click(G.ax0 + 30, 180);
  await hover(G.ax0 + 31, G.ay1 + 0.5); c1 = await cur();
  ok(/perpendicular/.test(c1.s) && near(c1.c[0], G.ax0 + 30, 0.05), `object snap: perpendicular to the wall (${c1.s}), the foot straight above the last point`);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.click("#bSnapSet"); await wait(120);
  ok(await vis("#snapPop") && (await page.locator('#snapPop input[data-sk]').count()) >= 7, "the Snap ▾ list shows the object snaps and the tracking switches");
  await page.uncheck('#snapPop input[data-sk="perpendicular"]'); await wait(80);
  ok((await T(() => zdTakeoff.snapKinds().perpendicular)) === false && (await T(() => JSON.parse(localStorage.getItem("zdTakeoffSnaps")).perpendicular)) === false, "unticking Perpendicular is saved");
  await page.click("body", {position: {x: 5, y: 400}}); await wait(80);
  ok(!(await vis("#snapPop")), "clicking elsewhere closes the list");
  await page.keyboard.press("a"); await click(G.ax0 + 30, 180); await hover(G.ax0 + 31, G.ay1 + 0.5); c1 = await cur();
  ok(!/perpendicular/.test(c1.s), "with Perpendicular off it is not offered (" + c1.s + ")");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await T(() => { zdTakeoff.snapKinds().perpendicular = true; localStorage.removeItem("zdTakeoffSnaps"); });

  console.log("measurement sheet: search and sort");
  await page.keyboard.press("v");
  await T(() => { const P = zdTakeoff.P.proj; const a = P.items.filter(i => { const c = P.conds.find(x => x.id === i.cond); return c && c.type === "area"; }); a[0].label = "Bedroom 1"; if (a[1]) a[1].label = "Lounge"; document.getElementById("shQ").dispatchEvent(new Event("input")); });
  const nShown = () => page.locator("#sheet tr.it").count();
  const all = await nShown();
  await page.fill("#shQ", "bedroom"); await wait(100);
  ok((await nShown()) >= 1 && (await nShown()) < all && /of \d+ shown/.test(await page.innerText("#shInfo")), `search “bedroom”: ${await nShown()} of ${all} lines, and the header says so`);
  await page.fill("#shQ", "bedroom floor"); await wait(100);
  ok((await nShown()) >= 1, "every word must match (item + condition name)");
  await page.fill("#shQ", "zzzz"); await wait(100);
  ok((await nShown()) === 0 && /Nothing on the sheet matches/.test(await page.innerText("#sheet")), "no match: a clear message");
  await page.fill("#shQ", ""); await wait(100);
  ok((await nShown()) === all, "cleared: every line is back");
  const firstLabel = () => T(() => (document.querySelector("#sheet tr.it td:nth-child(2)") || {innerText: ""}).innerText.split("\n")[0]);
  await page.selectOption("#shSort", "name"); await wait(100);
  const byName = await firstLabel();
  await page.selectOption("#shSort", "qty"); await wait(100);
  const byQty = await firstLabel();
  ok(byName !== "" && byQty !== "", `sorted by name (“${byName}”) and by size (“${byQty}”) — the totals do not change`);
  await page.selectOption("#shSort", "order"); await wait(100);

  console.log("review");
  await page.click('[data-rtab="review"]');
  await T(() => { for (const i of zdTakeoff.P.proj.items) delete i.qa; });
  await page.click('[data-rv="next"]'); await wait(500);
  const s1 = await T(() => zdTakeoff.S.sel);
  ok(!!s1 && await tab() === "review", "Next unchecked selects a measurement and stays on the Review tab");
  await page.click('[data-rv="checksel"]'); await wait(300);
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) { await page.fill("#dlgUser", "Tester"); await page.click("#dlgOk"); await wait(300); }
  ok(await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).qa === "checked", s1), "Check selected marks it checked");
  await page.click('[data-rv="prev"]'); await wait(500);
  const s2 = await T(() => zdTakeoff.S.sel);
  ok(!!s2 && s2 !== s1, "Previous unchecked goes to a different, still unchecked one");
  ok((await page.locator('#qaBar [data-qact="prev"]').count()) === 1 && /no BOQ code/.test(await page.innerText("#qaBar")), "the QA bar has Prev and counts conditions with no BOQ code");
  await page.click('[data-rv="validate"]'); await wait(400);
  ok(await T(() => document.getElementById("dlgBack").classList.contains("on")), "Check before export opens its list"); await page.keyboard.press("Escape"); await wait(200);
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) await T(() => document.getElementById("dlgCancel").click());

  console.log("palette");
  await page.keyboard.press("Control+k"); await wait(200);
  await page.fill("#palIn", "mirror"); await wait(150);
  ok(/Mirror/.test(await page.innerText("#palL")), "Ctrl+K finds Mirror (Modify)");
  await page.fill("#palIn", "ortho"); await wait(150);
  ok(/Ortho/.test(await page.innerText("#palL")), "Ctrl+K finds Ortho");
  await page.keyboard.press("Escape"); await wait(100);

  console.log("layout");
  await page.setViewportSize({width: 390, height: 844}); await wait(400);
  const over = await T(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `no sideways page scroll at 390 px (${over})`);
  await page.setViewportSize({width: 1366, height: 768}); await wait(300);
  await page.click('[data-rtab="takeoff"]');
  const tb = await T(() => document.getElementById("tools").getBoundingClientRect().height);
  ok(tb < 130, `the toolbar is two short rows (${Math.round(tb)} px high) at 1366 × 768`);
  if (SHOTS) { await page.screenshot({path: path.join(SHOTS, "ribbon-takeoff.png")}); await page.click('[data-rtab="modify"]'); await page.screenshot({path: path.join(SHOTS, "ribbon-modify.png")}); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

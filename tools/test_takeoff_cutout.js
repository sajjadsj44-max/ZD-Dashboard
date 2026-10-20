#!/usr/bin/env node
/* Browser tests for the PDF Takeoff cut-outs: Cut-out rect (Shift+D) and Cut-out poly (D), on the vector PDF of
   tools/takeoff_fixture.js (scale from its note: 1/8" = 1'-0" → 9 pt per ft).

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_cutout.js          # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) and TK_SHOTS as in tools/test_takeoff.js.

   Checks: both Cut-out buttons in the ribbon and their keys; a rectangle cut-out from two corners and from a typed L x W is a
   deduction with its own −L × W row, so net = gross − cut-outs; the live preview reads "Cut-out … = − … Sft" in red; the
   polyline cut-out still closes on its first point and on Enter; Ctrl+Z takes a cut-out back; on a length condition the
   rectangle cut-out falls back to the polyline; the area's right-click menu offers both; no page errors. */
const path = require("path"), fs = require("fs");
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
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see tools/test_takeoff.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
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
  const move = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); };
  const click = async (x, y, o = {}) => { await move(x, y); await page.mouse.down({button: o.button || "left"}); await page.mouse.up({button: o.button || "left"}); await wait(60); };
  const ft = (fx, fy) => [G.ax0 + fx * 9, G.ay0 + fy * 9];   // a point in room A, in ft from its bottom-left corner
  const items = () => T(() => { const Z = zdTakeoff, P = Z.P.proj; return P.items.map(it => { const sc = P.scales[it.file + ":" + it.page];
    return {id: it.id, cond: (P.conds.find(c => c.id === it.cond) || {}).name, kind: it.kind, n: it.pts.length, rows: sc ? Z.rowsOf(it, sc.ptPerFt).map(r => ({L: r.L, W: r.W, qty: r.qty})) : []}; }); });
  const last = async () => (await items()).slice(-1)[0];
  const total = name => T(n => zdTakeoff.condTotals(zdTakeoff.P.proj.conds.find(x => x.name === n)), name);
  const tool = () => T(() => zdTakeoff.S.tool);
  const on = t => T(t => { const b = document.querySelector('#tools .tool[data-tool="' + t + '"]'); return !!b && b.classList.contains("on"); }, t);
  const hintTxt = () => page.innerText("#stHint");
  const newCond = async preset => { await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); await page.click("#dlgOk");
    await page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 3000}).catch(() => {}); await wait(200); };
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, "cutout-" + n + ".png")}); } };

  console.log("project, PDF and an area");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Cut-out test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  ok(near((await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt)), 9, 1e-9), "scale 9 pt per ft from the note");
  await newCond("Floor area");
  await page.keyboard.press("r");
  await click(G.ax0, G.ay0); await click(G.ax1, G.ay1);
  let it = await last();
  ok(it.kind === "shape" && it.rows[0].qty === 168, "room A drawn as a 12 × 14 rectangle = 168.00 Sft");
  await page.keyboard.press("s");   // snap off: the cut-outs go exactly where clicked

  console.log("ribbon and keys");
  const btn = await T(() => ["dedrect", "ded"].map(t => { const b = document.querySelector('#tools .tool[data-tool="' + t + '"]'); return b ? {lbl: b.querySelector(".tl").textContent, vis: b.offsetParent !== null, ic: (b.querySelector("use") || {}).getAttribute("href")} : null; }));
  ok(btn[0] && btn[0].lbl === "Cut-out rect" && btn[0].vis && btn[0].ic === "#i-dedrect", "Cut-out rect button in the Takeoff ribbon");
  ok(btn[1] && btn[1].lbl === "Cut-out poly" && btn[1].vis && btn[1].ic === "#i-ded", "Cut-out poly button beside it");
  await page.keyboard.press("Shift+D");
  ok((await tool()) === "dedrect" && await on("dedrect") && !(await on("ded")), "Shift+D picks Cut-out rect (its button lights up)");
  ok(/Rectangular cut-out from Floor area: click two opposite corners/.test(await hintTxt()), "status bar explains the rectangle cut-out");
  await page.keyboard.press("d");
  ok((await tool()) === "ded" && await on("ded"), "D picks Cut-out poly");
  ok(/Polyline cut-out from Floor area/.test(await hintTxt()), "status bar explains the polyline cut-out");
  await page.click('#tools .tool[data-tool="dedrect"]');
  ok((await tool()) === "dedrect", "clicking Cut-out rect picks it");

  console.log("rectangle cut-out");
  const n0 = (await items()).length;
  await click(...ft(2, 2)); await move(...ft(6, 5));
  const live = await page.innerText("#stMeas"), red = await T(() => !!document.querySelector('polygon[stroke="#d03b3b"][stroke-dasharray="6 3"]'));
  ok(/^Cut-out 4\.0\d* × 3\.0\d* ft = − 12\.\d+ Sft$/.test(live.trim()) && red, "live preview: red dashed box, “" + live.trim() + "”");
  await shot("preview");
  await click(...ft(6, 5));
  it = await last();
  ok((await items()).length === n0 + 1 && it.kind === "ded" && it.n === 4 && it.cond === "Floor area", "two corners → one rectangular deduction in Floor area");
  ok(it.rows.length === 1 && near(it.rows[0].L, 4, 0.03) && near(it.rows[0].W, 3, 0.03) && near(it.rows[0].qty, -12, 0.2), `its row: −${it.rows[0].L} × ${it.rows[0].W} = ${it.rows[0].qty.toFixed(2)} Sft`);
  ok((await tool()) === "dedrect", "the tool stays on for the next cut-out");
  await click(...ft(7, 8)); await move(...ft(9, 10));
  await page.keyboard.type("2 x 1.5"); await wait();   // the space bar pans, so the buffer reads 2x1.5
  ok(/L x W: 2 ?x ?1\.5/.test(await page.innerText("#tip")), "typing after the first corner shows “L x W: 2x1.5” at the cursor");
  await page.keyboard.press("Enter"); await wait();
  it = await last();
  ok(it.kind === "ded" && near(it.rows[0].L, 2, 1e-6) && near(it.rows[0].W, 1.5, 1e-6) && near(it.rows[0].qty, -3, 1e-6), "typed 2 x 1.5 → exactly −2.000 × 1.500 = −3.00 Sft");
  let t = await total("Floor area");
  ok(near(t.gross, 168, 0.01) && near(t.net, 168 - 12 - 3, 0.3), `Floor area: gross 168.00 − cut-outs = net ${t.net.toFixed(2)} Sft`);
  ok((await page.locator("#sheet tr.ded").count()) === 2, "each cut-out is its own red row on the sheet");

  console.log("polyline cut-out");
  await page.keyboard.press("d");
  for (const p of [ft(8, 2), ft(11, 2), ft(11, 5)]) await click(...p);
  await click(...ft(8, 2));   // back on the first point closes it
  it = await last();
  ok(it.kind === "ded" && it.n === 3 && near(it.rows.reduce((a, r) => a + r.qty, 0), -4.5, 0.15), "triangle closed on its first point: ½ × 3 × 3 = −4.50 Sft");
  for (const p of [ft(2, 9), ft(5, 9), ft(5, 12), ft(2, 12)]) await click(...p);
  await page.keyboard.press("Enter"); await wait();
  it = await last();
  ok(it.kind === "ded" && it.n === 4 && near(it.rows.reduce((a, r) => a + r.qty, 0), -9, 0.2), "four corners + Enter: −9.00 Sft");
  t = await total("Floor area");
  ok(near(t.net, 168 - 12 - 3 - 4.5 - 9, 0.5), `net with four cut-outs: ${t.net.toFixed(2)} Sft (139.50 expected)`);
  const nBefore = (await items()).length;
  await page.keyboard.press("Control+z"); await wait();
  ok((await items()).length === nBefore - 1, "Ctrl+Z takes the last cut-out back");
  await page.keyboard.press("Control+y"); await wait();
  ok((await items()).length === nBefore, "Ctrl+Y puts it back");

  console.log("right-click menu of the area");
  await page.keyboard.press("v");
  const p = await scr(...ft(10.5, 11)); await page.mouse.click(p[0], p[1], {button: "right"}); await wait(250);
  const menu = await page.innerText("#ctx").catch(() => "");
  ok(/Add a rectangular cut-out/.test(menu) && /Add a polyline cut-out/.test(menu), "the area's menu offers a rectangular and a polyline cut-out");
  await page.locator("#ctx").getByText("Add a rectangular cut-out").click(); await wait();
  ok((await tool()) === "dedrect", "“Add a rectangular cut-out” picks Cut-out rect");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

  console.log("length condition");
  await newCond("Skirting");
  await page.keyboard.press("Shift+D"); await wait();
  ok((await tool()) === "ded", "on a length condition Shift+D falls back to the polyline cut-out (a rectangle has no length)");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

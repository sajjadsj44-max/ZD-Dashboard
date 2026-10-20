#!/usr/bin/env node
/* Browser tests for the takeoff's labels on screen: sized as the drawing's own text (they grow and shrink with the zoom),
   left out when too small to read, and never on top of one another — on the vector PDF of tools/takeoff_fixture.js
   (scale from its note: 1/8" = 1'-0" → 9 pt per ft).

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_labels.js          # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) and TK_SHOTS as in tools/test_takeoff.js.

   Checks: a label's text size follows the zoom (100 % = its set size, capped at 2.5 ×); zoomed far out the labels are left
   out but the selected object's stays readable; small labels that would overlap keep only the bigger object's; View →
   Labels "grow and shrink with the zoom" off keeps one size, "leave out a label that would cover another" off shows them
   all; the hover tip still names a hidden label's object; no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.05 : t);

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
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, "labels-" + n + ".png")}); } };
  const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];   // page points (y down)
  /* labels drawn now: text and font size of each .aplbl group's first line */
  const labels = () => T(() => { return [...document.querySelectorAll("#ov g.aplbl")].map(g => { const t = g.querySelector("text"); return {s: t.textContent, fs: +t.getAttribute("font-size")}; }); });
  const zoomTo = async s => { await T(s => { const Z = zdTakeoff, v = Z.S.view; v.s = s; Z.applyView(); }, s); await wait(250); };
  const setLbl = async o => { await T(o => { const Z = zdTakeoff; Z.S.lbl = Object.assign({}, Z.S.lbl, o); Z.refresh(); }, o); await wait(150); };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Label test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  /* one floor area 40 × 30 ft (360 × 270 pt) named HALL, and three small cut-outs side by side, closer than their labels are wide */
  await T(([big, c1, c2, c3]) => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId;
    P.conds.push({id: "CF", name: "Floor area", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0});
    const it = (id, pts, kind, label) => P.items.push({id, cond: "CF", file: f, page: 1, kind, pts, nos: 1, label});
    it("IB", big, "shape", "HALL"); it("D1", c1, "ded", ""); it("D2", c2, "ded", ""); it("D3", c3, "ded", "");
    Z.S.cond = "CF"; Z.save(); Z.refresh(); },
    [sq(100, 100, 360, 270), sq(150, 330, 27, 27), sq(185, 330, 27, 27), sq(220, 330, 27, 27)]);
  await setLbl({on: true, small: false, zoom: true, declutter: true, name: true, qty: true});

  console.log("labels follow the zoom");
  await zoomTo(1); let L = await labels(); const hall1 = L.find(x => x.s === "HALL");
  ok(hall1 && near(hall1.fs, 11.5, 0.06), "at 100 % a label is its set size (11.5 px): " + (hall1 && hall1.fs));
  await zoomTo(2); L = await labels(); const hall2 = L.find(x => x.s === "HALL");
  ok(hall2 && near(hall2.fs, 23, 0.06), "at 200 % it is twice the size, as the drawing's text (" + (hall2 && hall2.fs) + " px)");
  await zoomTo(6); L = await labels(); const hall6 = L.find(x => x.s === "HALL");
  ok(hall6 && near(hall6.fs, 11.5 * 2.5, 0.06), "zoomed far in it stops at 2.5 × (" + (hall6 && hall6.fs) + " px), not a giant label");
  await zoomTo(0.7); L = await labels(); const hall07 = L.find(x => x.s === "HALL");
  ok(hall07 && near(hall07.fs, 11.5 * 0.7, 0.06), "at 70 % it is 0.7 × (" + (hall07 && hall07.fs) + " px) — smaller with the drawing, never larger");
  await shot("70pct");
  await zoomTo(0.3); L = await labels();
  ok(L.length === 0, "at 30 % (3.5 px text) no label is drawn — too small to read, so it does not clutter (" + L.length + ")");
  await T(() => { zdTakeoff.S.sel = "IB"; zdTakeoff.refresh(); }); await wait(200); L = await labels();
  ok(L.length === 1 && L[0].s === "HALL" && L[0].fs >= 9.7, "…but the selected object's label stays readable (" + (L[0] && L[0].fs) + " px)");
  await T(() => { zdTakeoff.S.sel = null; zdTakeoff.refresh(); }); await wait(150);

  console.log("labels do not cover one another");
  await zoomTo(1); L = await labels();
  const ded = L.filter(x => x.s !== "HALL");
  ok(L.some(x => x.s === "HALL") && ded.length >= 1 && ded.length < 3, "three cut-outs closer than their labels: " + ded.length + " of 3 labelled, HALL's label kept");
  const boxes = await T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => { const r = g.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]));
  ok(!overlap, "no two labels on screen overlap");
  await shot("declutter");
  await setLbl({declutter: false}); L = await labels();
  ok(L.filter(x => x.s !== "HALL").length === 3, "View → Labels “leave out a label that would cover another” off: all 3 cut-out labels shown");
  await setLbl({declutter: true});

  console.log("one size when asked");
  await setLbl({zoom: false});
  const sizes = [];
  for (const s of [0.3, 1, 3]) { await zoomTo(s); const x = (await labels()).find(y => y.s === "HALL"); sizes.push(x ? x.fs : 0); }
  ok(sizes.every(v => near(v, 11.5, 0.06)), "“grow and shrink with the zoom” off: 11.5 px at 30 %, 100 % and 300 % (" + sizes.join(", ") + ")");
  await setLbl({zoom: true});

  console.log("what the labels show (View ribbon → ⚙ by Labels, Cut-out labels)");
  await zoomTo(1); await setLbl({declutter: false});
  const groups = () => T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => [...g.querySelectorAll("text")].map(t => t.textContent)));
  const menu = async item => { await page.click("#rbLblMenu"); await wait(150); await page.locator("#ctx .ci", {hasText: item}).first().click(); await wait(200); };
  let G0 = await groups(), cut = G0.filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.length === 1 && /^-9\.000 Sft$/.test(g[0])), "a cut-out's label shows its quantity only by default (" + JSON.stringify(cut[0]) + ")");
  await page.click('[data-rtab="view"]'); await wait(200);
  ok(await page.isVisible("#rbLblMenu") && await page.isVisible("#rbLblDed") && (await page.innerText("#rbLblDed")).trim() === "Cut-outs", "the View ribbon has ⚙ label options and a Cut-outs (labels) button beside Labels");
  const oneRow = await T(() => { const g = [...document.querySelectorAll('[data-rp="view"] .rg')].filter(x => x.offsetParent); return new Set(g.map(x => Math.round(x.getBoundingClientRect().top))).size; });
  ok(oneRow === 1, "the View ribbon still fits on one row at 1440 px (" + oneRow + " row" + (oneRow > 1 ? "s" : "") + ")");
  ok(await T(() => document.getElementById("rbLblDed").classList.contains("on")), "Cut-out labels shows on");
  await page.click("#rbLblMenu"); await wait(150);
  const items = await page.locator("#ctx .ci").allInnerTexts();
  ok(["Labels: full", "Labels: name + qty", "Labels: qty only", "Labels: name only", "Cut-outs: full", "Cut-outs: name + qty", "Cut-outs: qty only", "Cut-outs: hidden", "Follow the zoom", "No overlap", "More label settings"].every(t => items.some(x => x.indexOf(t) >= 0)),
    "⚙ lists what labels and cut-out labels show, Follow the zoom, No overlap and More label settings");
  ok(items.some(x => /✓\s*Cut-outs: qty only/.test(x)) && items.some(x => /✓\s*Labels: full/.test(x)), "…with the current choices ticked (Labels: full, Cut-outs: qty only)");
  await page.keyboard.press("Escape"); await T(() => document.getElementById("ctx").classList.remove("on"));
  await menu("Cut-outs: name + qty"); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.length === 2 && g[0] === "Cut-out" && /^-9\.000 Sft$/.test(g[1])), "Cut-outs: name + qty → “Cut-out / -9.000 Sft”");
  await menu("Cut-outs: full"); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.some(t => /^P 12\.000 ft$/.test(t))), "Cut-outs: full → with its perimeter, as the Labels ticks say");
  await page.click("#rbLblDed"); await wait(200); G0 = await groups();
  ok(G0.length === 1 && G0[0][0] === "HALL" && !(await T(() => document.getElementById("rbLblDed").classList.contains("on"))), "Cut-out labels button off — only HALL is labelled");
  ok((await T(() => zdTakeoff.condTotals(zdTakeoff.P.proj.conds.find(c => c.id === "CF")).net)) === 1173, "…the cut-outs still count: net 1,200 − 27 = 1,173 Sft");
  await page.click("#rbLblDed"); await wait(200); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut[0].some(t => /^P 12\.000 ft$/.test(t)), "…on again: back to the detail chosen before (full)");
  await menu("Cut-outs: hidden"); G0 = await groups();
  ok(G0.length === 1 && !(await T(() => document.getElementById("rbLblDed").classList.contains("on"))), "Cut-outs: hidden in ⚙ does the same, and the button follows");
  await page.click("#rbLblDed"); await wait(200);
  await menu("Labels: qty only"); G0 = await groups();
  ok(G0.some(g => g.length === 1 && g[0] === "1,200.000 Sft"), "Labels: qty only → the hall reads just 1,200.000 Sft");
  await menu("Labels: name only"); G0 = await groups();
  ok(G0.some(g => g.length === 1 && g[0] === "HALL"), "Labels: name only → HALL");
  await menu("Labels: name + qty"); G0 = await groups();
  ok(G0.some(g => g.length === 2 && g[0] === "HALL" && g[1] === "1,200.000 Sft"), "Labels: name + qty → HALL / 1,200.000 Sft (no perimeter)");
  await menu("Labels: full"); await menu("Cut-outs: qty only");
  await menu("Follow the zoom");
  ok((await T(() => zdTakeoff.S.lbl.zoom)) === false, "⚙ Follow the zoom turns zoom-sized labels off");
  await menu("Follow the zoom"); await menu("No overlap");
  ok((await T(() => zdTakeoff.S.lbl.zoom && zdTakeoff.S.lbl.declutter)) === true, "…and on again; ⚙ No overlap turns the overlap rule on");
  const kept = await T(() => JSON.parse(localStorage.getItem("zdTakeoffLbl") || "{}"));
  ok(kept.show === "full" && kept.dedShow === "qty" && kept.zoom === true && kept.declutter === true, "the choices are kept for the next visit");
  await page.click('[data-rtab="takeoff"]'); await wait(150);

  console.log("the Labels dialog and the hover tip");
  await T(() => document.getElementById("bLblSet").click()); await wait(300);
  const dlg = await T(() => ({zoom: !!document.querySelector('[data-lb="zoom"]'), dec: !!document.querySelector('[data-lb="declutter"]'), zc: (document.querySelector('[data-lb="zoom"]') || {}).checked,
    show: (document.querySelector('[data-lbs="show"]') || {}).value, ded: (document.querySelector('[data-lbs="dedShow"]') || {}).value}));
  ok(dlg.zoom && dlg.dec && dlg.zc, "View → Labels has both options, “grow and shrink with the zoom” on by default");
  ok(dlg.show === "full" && dlg.ded === "qty", "…and “every label shows” (full) and “cut-out / deduction labels show” (qty only)");
  await page.keyboard.press("Escape"); await wait(200);
  await zoomTo(0.3); await page.keyboard.press("v");
  const c = await T(() => { const Z = zdTakeoff, v = Z.S.view, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + 400 * v.s + v.tx, r.top + 160 * v.s + v.ty]; });
  await page.mouse.move(c[0], c[1]); await page.mouse.move(c[0] + 2, c[1] + 1); await wait(300);
  const hv = await page.innerText("#tip").catch(() => "");
  ok(/HALL|Floor area/.test(hv) && (await labels()).length === 0, "zoomed out with no labels drawn, hovering still names the object (" + hv.trim().replace(/\s+/g, " ") + ")");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser tests for the PDF Takeoff app (takeoff/): a PDF marked up in Bluebeam Revu — its measurements become conditions and
   items, its other markups this app's markups, and the PDF's own drawing of them is switched off.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_bluebeam.js

   TK_LIBS  folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there; pdf-lib also
            writes the test PDF here)
   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/)

   Test PDF — annotations as Bluebeam writes them (/IT intent, /Measure at C = 1/9 ft per pt → 9 pt per ft, /Subj, /Label,
   /Contents with Bluebeam's quantity, /NM ids):
   p.1  842 × 595 pt: "Floor tile" areas 90 × 45 pt with a 18 × 9 pt cutout (50 − 2 = 48 Sft, label Lounge) and 45 × 45 pt
        (25 Sft); "Skirting" polyline 90 + 45 pt (15 ft); a "Length Measurement" line 27 pt (3 ft); three "D1" count markers;
        "Check me" 45 × 45 pt whose Contents says 99 sf (reported as differing); a FreeText box, a rectangle, a Legend stamp
        (not brought in) and a hidden polygon (left out)
   p.2  595 × 842 pt turned 90°: one more "Floor tile" area 90 × 45 pt (50 Sft) */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.002 : t);

async function makeBbPdf(){
  const L = require(path.join(LIBS, "pdf-lib"));
  const d = await L.PDFDocument.create(), ctx = d.context, S = t => L.PDFString.of(t);
  const meas = () => ctx.obj({Type: "Measure", Subtype: "RL", R: S("1/8 in = 1 ft' in\""), X: [ctx.obj({Type: "NumberFormat", U: S("'"), C: 1 / 9, D: 2})], D: [ctx.obj({Type: "NumberFormat", U: S("'"), C: 1})], A: [ctx.obj({Type: "NumberFormat", U: S("sf"), C: 1})]});
  const annot = (pg, o) => { const a = {Type: "Annot", F: 4}; Object.entries(o).forEach(([k, v]) => { a[k] = ["Subj", "Contents", "Label", "NM", "T", "DS"].includes(k) ? S(v) : v; });
    const ref = ctx.register(ctx.obj(a)); let an = pg.node.lookup(L.PDFName.of("Annots")); if (!an) { an = ctx.obj([]); pg.node.set(L.PDFName.of("Annots"), an); } an.push(ref); };
  const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];
  const p1 = d.addPage([842, 595]);
  p1.drawRectangle({x: 60, y: 60, width: 720, height: 470, borderWidth: 0.8, borderColor: L.rgb(0, 0, 0)});
  const area = {Subtype: "Polygon", IT: "PolygonDimension", Subj: "Floor tile", C: [0, 0, 1], IC: [1, 1, 0.5], FillOpacity: 0.3, BS: ctx.obj({W: 0.5, S: "S"}), DS: "font: bold Helvetica 9pt; color:#FF0000", BM: "Multiply", T: "QS"};
  annot(p1, Object.assign({}, area, {Vertices: rect(100, 300, 90, 45), Cutouts: [rect(120, 310, 18, 9)], Measure: meas(), Label: "Lounge", Contents: "Lounge\r48.00 sf", NM: "AREA1", Rect: [95, 295, 195, 350]}));
  annot(p1, Object.assign({}, area, {Vertices: rect(220, 300, 45, 45), Measure: meas(), Contents: "25.00 sf", NM: "AREA2", Rect: [215, 295, 270, 350]}));
  annot(p1, {Subtype: "PolyLine", IT: "PolyLineDimension", Subj: "Skirting", C: [1, 0, 0], BS: ctx.obj({W: 3, S: "S"}), Vertices: [100, 100, 190, 100, 190, 145], Measure: meas(), Contents: "L = 15.00 ft", NM: "LEN1", Rect: [95, 95, 195, 150]});
  annot(p1, {Subtype: "Line", IT: "LineDimension", Subj: "Length Measurement", C: [1, 0, 0], L: [100, 400, 127, 400], Measure: meas(), Contents: "3.00'", NM: "LINE1", Rect: [95, 395, 130, 405]});
  [300, 320, 340].forEach((x, i) => annot(p1, {Subtype: "Polygon", IT: "PolygonCount", Subj: "D1", C: [1, 0, 0], IC: [1, 0, 0], CA: 0.5, CountStyle: "Circle", Vertices: rect(x - 4, 296, 8, 8), BBMeasure: meas(), Contents: "3", NM: "CNT" + i, Rect: [x - 9, 291, x + 9, 309]}));
  annot(p1, Object.assign({}, area, {Subj: "Check me", Vertices: rect(400, 300, 45, 45), Measure: meas(), Contents: "99.00 sf", NM: "BAD1", Rect: [395, 295, 450, 350]}));
  annot(p1, {Subtype: "FreeText", Subj: "Note", C: [1, 1, 0.5], FillOpacity: 0.7, DS: "font: Helvetica 12pt; color:#FF0000", Contents: "Total = 73 sft", Rect: [500, 450, 700, 520], NM: "FT1", T: "QS"});
  annot(p1, {Subtype: "Square", Subj: "Rectangle", C: [0, 0.5, 0], BS: ctx.obj({W: 2, S: "S"}), Rect: [600, 100, 700, 180], NM: "SQ1"});
  annot(p1, {Subtype: "Stamp", IT: "StampSnapshot", Subj: "Legend", BSILegend: ctx.obj({Title: S("Legend")}), Rect: [480, 120, 580, 220], NM: "LEG1"});
  annot(p1, Object.assign({}, area, {F: 6, Subj: "Hidden", Vertices: rect(500, 300, 45, 45), Measure: meas(), Contents: "25.00 sf", NM: "HID1", Rect: [495, 295, 550, 350]}));
  const p2 = d.addPage([595, 842]); p2.setRotation(L.degrees(90));
  annot(p2, Object.assign({}, area, {Vertices: rect(200, 300, 90, 45), Measure: meas(), Contents: "50 sf", NM: "AREA3", Rect: [195, 295, 295, 350]}));
  return Buffer.from(await d.save());
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs")) || !fs.existsSync(path.join(LIBS, "pdf-lib"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see the header"); process.exit(2); }
  const pdf = await makeBbPdf();
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const closeDlg = async () => { await T(() => { const c = document.getElementById("dlgCancel"); if (c && document.getElementById("dlgBack").classList.contains("on")) c.click(); }); await wait(200); };

  console.log("Bluebeam markups → conditions");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Bluebeam"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "bluebeam.pdf", mimeType: "application/pdf", buffer: pdf});
  await page.waitForFunction(() => { const f = zdTakeoff.P.proj.files[0]; return f && zdTakeoff.P.proj.bbImp && zdTakeoff.P.proj.bbImp[f.id] && document.getElementById("dlgBack").classList.contains("on") && /Bluebeam/.test(document.getElementById("dlgT").textContent); }, null, {timeout: 30000}).catch(() => {});
  const rep = await T(() => document.getElementById("dlgB").innerText);
  const R = await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = P.files[0];
    const I = (P.bbImp || {})[f.id] || {}; return {bbOff: !!I.off, nms: (I.nms || []).slice().sort(), conds: P.conds.map(c => ({name: c.name, type: c.type, unit: c.unit, color: c.color, sw: c.sw, sym: c.sym, ap: c.ap || {}, n: P.items.filter(i => i.cond === c.id).length, net: Z.condTotals(c).net})),
      items: P.items.map(i => ({cond: (P.conds.find(c => c.id === i.cond) || {}).name, kind: i.kind, page: i.page, label: i.label, n: i.pts.length, bb: i.bb, pts: i.pts})),
      marks: (P.marks || []).map(m => ({type: m.type, text: m.text, color: m.color, fill: m.fill, fs: m.fs, width: m.width, subject: m.subject, author: m.author, bb: m.bb})),
      sc1: P.scales[f.id + ":1"] || null, sc2: P.scales[f.id + ":2"] || null, W2: null}; });
  const C = n => R.conds.find(c => c.name === n) || {};
  ok(R.conds.length === 5, "five conditions, named by their Bluebeam subject: " + R.conds.map(c => c.name + " (" + c.type + ")").join(", "));
  ok(C("Floor tile").type === "area" && C("Floor tile").unit === "Sft" && near(C("Floor tile").net, 48 + 25 + 50, 0.01), "Floor tile: area in Sft, 48 + 25 + 50 = 123 Sft over two pages, the cutout deducted (" + C("Floor tile").net + ")");
  ok(C("Floor tile").color === "#ffff80" && C("Floor tile").ap.fillOp === 30 && C("Floor tile").ap.blend === "multiply" && C("Floor tile").ap.fcol === "#ff0000" && C("Floor tile").ap.fb === true && C("Floor tile").ap.lbg === false, "Floor tile drawn as in Bluebeam: its fill colour, 30 % fill, multiply, bold red caption without a box → " + JSON.stringify([C("Floor tile").color, C("Floor tile").ap]));
  const ded = R.items.find(i => i.kind === "ded");
  ok(ded && ded.cond === "Floor tile" && ded.label === "cutout in Lounge" && ded.n === 4 && ded.bb === "AREA1", "the cutout became a deduction of the same condition, named after its room");
  ok(R.items.some(i => i.cond === "Floor tile" && i.kind === "shape" && i.label === "Lounge"), "Bluebeam's label kept on the measurement (Lounge)");
  ok(C("Skirting").type === "linear" && C("Skirting").unit === "ft" && near(C("Skirting").net, 15) && C("Skirting").color === "#ff0000" && C("Skirting").sw === 3 && C("Skirting").ap.swU === "pt", "Skirting: a 15.000 ft run, red, 3 pt wide on paper (" + C("Skirting").net + ")");
  ok(near(C("Length Measurement").net, 3), "a Bluebeam line (LineDimension) measures 3.000 ft (" + C("Length Measurement").net + ")");
  const cnt = R.items.find(i => i.cond === "D1");
  ok(C("D1").type === "count" && C("D1").net === 3 && C("D1").n === 1 && cnt && cnt.n === 3 && C("D1").sym === "circle", "D1: three count markers on one count of the page, Bluebeam's circle symbol");
  ok(cnt && cnt.pts.map(p => p[0].toFixed(1)).join() === "300.0,320.0,340.0" && cnt.pts.every(p => near(p[1], 595 - 300, 0.01)), "count markers placed at the middle of each Bluebeam marker (y down): " + (cnt && cnt.pts.map(p => p.map(v => v.toFixed(1)).join("/")).join(" ")));
  const a1 = R.items.find(i => i.bb === "AREA1" && i.kind === "shape");
  ok(a1 && near(a1.pts[0][0], 100, 0.01) && near(a1.pts[0][1], 595 - 300, 0.01), "page 1 points mapped onto the page, y down (" + (a1 && a1.pts[0].join(", ")) + ")");
  const a3 = R.items.find(i => i.bb === "AREA3");
  ok(a3 && a3.page === 2 && a3.pts.every(p => p[0] >= 0 && p[0] <= 842 && p[1] >= 0 && p[1] <= 595) && near(a3.pts[0][0], 300, 0.01) && near(a3.pts[0][1], 200, 0.01), "page turned 90°: the area lands where the page shows it (" + (a3 && a3.pts.map(p => p.map(v => v.toFixed(0)).join("/")).join(" ")) + ")");
  ok(R.sc1 && R.sc1.how === "pdf" && near(R.sc1.ptPerFt, 9, 1e-6) && !R.sc1.verified && R.sc1.text === "1/8 in = 1 ft", "page scale from the measurements: 1 ft = 9 pt, Bluebeam's scale text, not verified (" + JSON.stringify(R.sc1 && [R.sc1.ptPerFt, R.sc1.text]) + ")");
  ok(R.sc2 && near(R.sc2.ptPerFt, 9, 1e-6), "the turned page has its scale too");
  const tx = R.marks.find(m => m.type === "text"), bx = R.marks.find(m => m.type === "box");
  ok(R.marks.length === 2 && tx && bx, "the FreeText box and the rectangle became markups (" + R.marks.map(m => m.type).join(", ") + ")");
  ok(tx && tx.text === "Total = 73 sft" && tx.color === "#ff0000" && tx.fill === "#ffff80" && tx.fs === 12 && tx.subject === "Note" && tx.author === "QS", "text box: its text, red 12 pt, yellow fill, subject and author kept");
  ok(bx && bx.color === "#008000" && bx.width === 2, "rectangle: green, 2 wide");
  ok(!R.conds.some(c => c.name === "Hidden") && !R.nms.includes("HID1") && !R.nms.includes("LEG1"), "a hidden markup and the legend stamp are not brought in");
  ok(R.bbOff, "the PDF's own drawing of its markups is switched off (nothing shows twice)");
  ok(/1 of 9/.test(rep) && /Check me/.test(rep) && /99\.00 sf in Bluebeam/.test(rep), "the report checks each quantity against Bluebeam's and names the one that differs → " + JSON.stringify(rep.split("\n").slice(0, 2).join(" | ")));
  ok(/1 legend/i.test(rep), "the report says what was not brought in (the legend)");
  await closeDlg();

  console.log("the PDF's own markups");
  const segs = () => T(async () => { const Z = zdTakeoff, f = Z.P.proj.files[0]; await Z.gotoPage(f.id, 1); for (let i = 0; i < 60 && !Z.S.geo[Z.S.key]; i++) await new Promise(r => setTimeout(r, 100)); return Z.S.geo[Z.S.key] ? Z.S.geo[Z.S.key].segs.length : -1; });
  await wait(800);
  const off = await segs();
  await T(() => zdTakeoff.bbShowPdf(zdTakeoff.P.proj.files[0].id, true)); await wait(800);
  const on = await segs();
  ok(off > 0 && on > off, "the PDF's markups are not read as drawing lines while hidden (" + off + " lines), and are when shown again (" + on + ")");
  await T(() => zdTakeoff.bbShowPdf(zdTakeoff.P.proj.files[0].id, false)); await wait(600);
  ok((await segs()) === off, "hidden again: back to the drawing's own lines");

  console.log("import again, undo");
  const n0 = await T(() => zdTakeoff.P.proj.items.length + zdTakeoff.P.proj.marks.length);
  await T(() => zdTakeoff.bbImport(zdTakeoff.P.proj.files[0].id)); await wait(400);
  ok((await T(() => zdTakeoff.P.proj.items.length + zdTakeoff.P.proj.marks.length)) === n0 && /No new Bluebeam markups/.test(await page.innerText("#toast")), "importing again brings nothing twice (" + n0 + " objects)");
  await T(() => { const Z = zdTakeoff, f = Z.P.proj.files[0]; const I = Z.P.proj.bbImp[f.id]; I.nms = I.nms.filter(x => x !== "SQ1"); Z.P.proj.marks = Z.P.proj.marks.filter(m => m.bb !== "SQ1"); });
  await T(() => zdTakeoff.bbImport(zdTakeoff.P.proj.files[0].id)); await page.waitForFunction(() => zdTakeoff.P.proj.marks.some(m => m.bb === "SQ1"), null, {timeout: 10000}).catch(() => {});
  ok((await T(() => zdTakeoff.P.proj.marks.filter(m => m.bb === "SQ1").length)) === 1 && (await T(() => zdTakeoff.P.proj.items.length + zdTakeoff.P.proj.marks.length)) === n0, "a markup not imported yet is brought in on its own");
  await closeDlg();
  await page.keyboard.press("Escape"); await page.click("#stage", {position: {x: 5, y: 5}}).catch(() => {});
  await page.keyboard.press("Control+z"); await wait(300); await page.keyboard.press("Control+z"); await wait(400);
  const U = await T(() => { const P = zdTakeoff.P.proj, f = P.files[0]; const I = (P.bbImp || {})[f.id]; return {items: P.items.length, marks: P.marks.length, conds: P.conds.length, bbOff: !!(I && I.off), bb: !!I}; });
  ok(U.items === 0 && U.marks === 0 && U.conds === 0 && !U.bbOff && !U.bb, "Ctrl+Z takes the whole import back — measurements, markups, conditions, the PDF's markups shown again → " + JSON.stringify(U));

  console.log("a plain PDF");
  await page.click("#bProjects"); await wait(400); await page.click("#bNewProj"); await page.fill("#dlgName", "Plain"); await page.click("#dlgOk"); await wait(400);
  const L = require(path.join(LIBS, "pdf-lib")), dp = await L.PDFDocument.create(); dp.addPage([842, 595]).drawLine({start: {x: 100, y: 100}, end: {x: 300, y: 100}, thickness: 1});
  await page.setInputFiles("#fileIn", {name: "plain.pdf", mimeType: "application/pdf", buffer: Buffer.from(await dp.save())});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length === 1, null, {timeout: 20000}); await wait(1200);
  ok(!(await dlgOn()) && (await T(() => zdTakeoff.P.proj.conds.length === 0 && !(zdTakeoff.P.proj.bbImp || {})[zdTakeoff.P.proj.files[0].id])), "a PDF with no markups: no dialog, nothing added");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

#!/usr/bin/env node
/* Browser tests for the PDF Takeoff app (takeoff/): the scale saved inside a PDF (/VP viewports with a /Measure
   dictionary, as Bluebeam and Acrobat write it) and the QA checks for measurements drawn twice and floors where a
   condition is missing.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_pdfscale.js

   TK_LIBS  folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there; pdf-lib also
            writes the test PDF here)
   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/)

   Test PDF (written with compressed object streams, so the viewports are not visible as plain text):
   p.1  842 × 595 pt, whole-page viewport "1/8" = 1'-0"" in ft (C = 1/9 → 9 pt per ft) and a "Detail A" box at
        1-1/2" = 1'-0"" in inches (C = 1/3 in per pt → 36 pt per ft)
   p.2  842 × 595 pt, no viewport and no text → no scale
   p.3  842 × 595 pt, one small box (under a quarter of the sheet) in metres → a viewport only, no page scale
   p.4  595 × 842 pt turned 90°, whole-page viewport in mm, 1:100 (C = 25.4 / 72 × 100 mm per pt)
   p.5  842 × 595 pt, a geographic (GEO) measure → ignored */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

async function makeVpPdf(){
  const L = require(path.join(LIBS, "pdf-lib"));
  const d = await L.PDFDocument.create(), ctx = d.context, S = t => L.PDFString.of(t);
  const meas = (u, C, R, geo) => ctx.obj({Type: "Measure", Subtype: geo ? "GEO" : "RL", R: S(R), X: [ctx.obj({Type: "NumberFormat", U: S(u), C})], D: [ctx.obj({Type: "NumberFormat", U: S(u), C: 1})], A: [ctx.obj({Type: "NumberFormat", U: S("sq " + u), C: 1})]});
  const vp = (pg, list) => pg.node.set(L.PDFName.of("VP"), ctx.obj(list.map(v => ctx.obj({Type: "Viewport", BBox: v.b, Name: S(v.n), Measure: v.m}))));
  const p1 = d.addPage([842, 595]); vp(p1, [{b: [0, 0, 842, 595], n: "Plan", m: meas("ft", 1 / 9, "1/8 in = 1 ft")}, {b: [600, 50, 800, 250], n: "Detail A", m: meas("in", 1 / 3, "1-1/2 in = 1 ft")}]);
  p1.drawLine({start: {x: 100, y: 300}, end: {x: 190, y: 300}, thickness: 0.6});
  d.addPage([842, 595]);
  const p3 = d.addPage([842, 595]); vp(p3, [{b: [100, 100, 300, 250], n: "Section", m: meas("m", 0.3048 / 18, "1:48")}]);
  const p4 = d.addPage([595, 842]); p4.setRotation(L.degrees(90)); vp(p4, [{b: [0, 0, 595, 842], n: "", m: meas("mm", 25.4 / 72 * 100, "1:100")}]);
  const p5 = d.addPage([842, 595]); vp(p5, [{b: [0, 0, 842, 595], n: "Map", m: meas("ft", 1 / 9, "geo", true)}]);
  return Buffer.from(await d.save({useObjectStreams: true}));
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs")) || !fs.existsSync(path.join(LIBS, "pdf-lib"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see the header"); process.exit(2); }
  const pdf = await makeVpPdf();
  ok(!pdf.includes("/VP"), "test PDF hides its viewports in compressed object streams");
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
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
  const go = async p => { await T(p => zdTakeoff.gotoPage(zdTakeoff.P.proj.files[0].id, p), p); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.texts[zdTakeoff.S.key], p, {timeout: 15000}); await wait(900); };
  const sc = () => T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key] || null);
  const vps = () => T(() => zdTakeoff.P.proj.viewports[zdTakeoff.S.key] || []);

  console.log("scale saved in the PDF");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "PDF scale"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "vp.pdf", mimeType: "application/pdf", buffer: pdf});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000}).catch(() => {});
  let s = await sc();
  ok(s && s.how === "pdf" && near(s.ptPerFt, 9), "p.1: page scale read from the PDF — 1 ft = 9 pt (" + (s && s.ptPerFt) + ")");
  ok(s && !s.verified, "p.1: a PDF scale starts as not verified");
  ok(s && /1\/8 in = 1 ft/.test(s.text), "p.1: the PDF's own scale text is kept (" + (s && s.text) + ")");
  let v = await vps();
  ok(v.length === 1 && near(v[0].ptPerFt, 36) && v[0].name === "Detail A", "p.1: the detail box at another scale became a viewport, 1 ft = 36 pt");
  ok(v.length === 1 && near(v[0].r[0], 600, 0.01) && near(v[0].r[1], 595 - 250, 0.01) && near(v[0].r[2], 800, 0.01) && near(v[0].r[3], 595 - 50, 0.01), "p.1: viewport box placed on the page (y down): " + (v[0] && v[0].r.map(x => x.toFixed(1)).join(", ")));
  const L10 = await T(() => { const Z = zdTakeoff, P = Z.P.proj, c = {id: "CL", name: "Line", type: "linear", unit: "ft", color: "#2a78d6", h: "", t: "", faces: 1}; P.conds.push(c);
    const it = {id: "IL", cond: "CL", file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[100, 295], [190, 295]], nos: 1}; P.items.push(it); return Z.rowsOf(it, P.scales[Z.S.key].ptPerFt)[0].L; });
  ok(near(L10, 10, 1e-9), "p.1: a 90 pt line measures 10.000 ft at the PDF scale (" + L10 + ")");
  const chip = await page.innerText("#scaleChip").catch(() => "");
  ok(/saved in the PDF/.test(chip), "scale chip says the scale was saved in the PDF (" + chip.replace(/\s+/g, " ").trim() + ")");

  await go(2); s = await sc();
  ok(!s, "p.2: no viewport and no note — no scale invented");

  await go(3); s = await sc(); v = await vps();
  ok(!s, "p.3: a small box gives no page scale");
  ok(v.length === 1 && near(v[0].ptPerFt, 18, 1e-6), "p.3: the small box (metres) became a viewport, 1 ft = 18 pt (" + (v[0] && v[0].ptPerFt) + ")");

  await go(4); s = await sc();
  ok(s && s.how === "pdf" && near(s.ptPerFt, 72 * 12 / 100, 1e-6), "p.4: turned page, mm at 1:100 — 1 ft = 8.640 pt (" + (s && s.ptPerFt) + ")");

  await go(5); s = await sc();
  ok(!s, "p.5: a geographic measure is not used as a drawing scale");

  await go(1);
  await page.click("#scaleChip"); await wait(500);
  const dlg = await page.innerText("#dlgB");
  ok(/Scale saved in this PDF/.test(dlg) && /Detail A/.test(dlg), "scale dialog lists the scales saved in the PDF");
  await page.click("#dlgCancel"); await wait(200);

  console.log("QA: drawn twice, floor gaps");
  const dup = await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, c = {id: "CA", name: "Floor", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, boq: "F-1"}, n = {id: "CN", name: "Lights", type: "count", unit: "Nos", color: "#d03b3b", boq: "E-1"};
    P.conds.push(c, n);
    const sq = [[300, 300], [390, 300], [390, 390], [300, 390]];
    P.items.push({id: "IA1", cond: "CA", file: f, page: 1, kind: "shape", pts: sq, nos: 1, label: "Bed 1"}, {id: "IA2", cond: "CA", file: f, page: 1, kind: "shape", pts: [sq[2], sq[3], sq[0], [sq[1][0] + 0.4, sq[1][1] - 0.3]], nos: 1, label: "Bed 1 again"},
      {id: "IA3", cond: "CA", file: f, page: 1, kind: "shape", pts: sq.map(p => [p[0] + 120, p[1]]), nos: 1, label: "Bed 2"},
      {id: "IA4", cond: "CA", file: f, page: 1, kind: "ded", pts: sq, nos: 1, label: "Ded"},
      {id: "IC1", cond: "CN", file: f, page: 1, kind: "shape", pts: [[50, 50], [80, 50], [50.5, 50.5]], nos: 1}, {id: "IC2", cond: "CN", file: f, page: 1, kind: "shape", pts: [[80.3, 49.8], [120, 50]], nos: 1});
    return Z.dupFind().map(d => ({c: d.c.name, a: d.a.id, b: d.b && d.b.id, n: d.n || 0}));
  });
  ok(dup.some(d => d.c === "Floor" && d.a === "IA1" && d.b === "IA2"), "an area drawn twice (points in another order, 0.4 pt off) is found");
  ok(!dup.some(d => d.a === "IA3" || d.b === "IA3" || d.a === "IA4" || d.b === "IA4"), "a different room and a deduction on the same outline are not called duplicates");
  ok(dup.some(d => d.c === "Lights" && d.n === 2), "two count markers on one spot (same item and across items) are found: " + JSON.stringify(dup.filter(d => d.c === "Lights")));
  const msgs = await T(() => zdTakeoff.validation().L.map(x => x.msg));
  ok(msgs.some(m => /drawn twice/.test(m)) && msgs.some(m => /placed twice/.test(m)), "validation lists both as warnings");

  const gaps = await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, mk = (id, cond, fl, b) => ({id, cond, file: f, page: 1, kind: "shape", pts: [[400 + id.length, 400], [450, 400], [450, 450], [400, 450]], nos: 1, floor: fl, bldg: b || "Block A"});
    P.items.push(mk("G1", "CA", "GF"), mk("G22", "CA", "FF"), mk("G333", "CA", "SF"), mk("G4444", "CL", "TF"), mk("G55555", "CL", "Roof"), mk("H1", "CA", "GF", "Block B"), mk("H22", "CA", "FF", "Block B"));
    return Z.floorGaps().map(g => ({c: g.c.name, b: g.bldg, miss: g.miss.join(",")}));
  });
  ok(gaps.some(g => g.c === "Floor" && g.b === "Block A" && g.miss === "Roof,TF"), "Floor measured on GF, FF, SF of Block A but not TF / Roof is flagged: " + JSON.stringify(gaps));
  ok(!gaps.some(g => g.c === "Line"), "a condition on only 2 of 5 floors is not flagged (under half)");
  ok(!gaps.some(g => g.b === "Block B"), "a building with under 3 floors is not checked");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

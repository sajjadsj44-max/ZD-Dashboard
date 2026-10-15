#!/usr/bin/env node
/* Print preview, plot label size, the report builder and the magnifier (takeoff/takeoff.js), against the vector PDF of
   tools/takeoff_fixture.js (9 pt per ft on pages 1 and 3) with measurements whose quantities are known.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_print.js

   TK_LIBS holds pdfjs-dist, pdf-lib and exceljs — the CDN requests are answered from there (offline / sandboxed runs).
   Checks: Plot → Preview renders the plot's own PDF (fit, zoom, paper size, scale, line weight, labels shown), Back keeps the
   settings, Save PDF saves the very bytes previewed, Print goes to the print frame, "always preview" (on by default) puts the
   preview before Print / Save PDF and can be turned off; Export pages → Preview (one PDF of several pages, a PDF per page),
   page arrows, Back with the pages and name kept; the marked-up page from the Export menu; the preview lets go of its canvas and
   pdf.js document on close. Labels on paper Off / Small / Normal / Large (0.4 / 0.6 / 0.9 pt per screen px, lines unchanged), kept.
   Report builder: grouping by condition / page / floor / condition then page, columns, group and grand totals that agree with
   the measurement sheet (condTotals), Excel with SUM / SUMIFS formulas, CSV. Magnifier: Shift+G, a 3× loupe at the cursor
   while drawing, hidden off the stage, cheap per frame. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, pdf-lib and exceljs — see the header"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib")), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zdprint_"));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: js, headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const pvOpen = () => T(() => !!document.getElementById("pvWrap"));
  const pvReady = () => page.waitForFunction(() => { const c = document.querySelector("#pvWrap .pvs canvas"); return c && c.width > 50; }, null, {timeout: 30000});
  const download = async click => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), click()]); const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f); return {f, name: d.suggestedFilename(), buf: fs.readFileSync(f)}; };
  const pvInk = () => T(() => { const c = document.querySelector("#pvWrap .pvs canvas"); if (!c) return -1; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++; return n; });

  console.log("project");
  await page.goto(URL, {waitUntil: "load"}); await wait(500);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Print test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000}); await wait(400);
  /* the takeoff: Floor area (Sft, rated) — bed room 12 × 14 and store 10 × 14 on p.1 less a 4 × 3 void, a 5 × 5 porch on p.3;
     Doors (Nos) — 2 on p.1, 1 on p.3; Skirting (ft) — the bed room's 52 ft on p.1. Page 1 is on the Ground floor (sheet info). */
  await T(G => { const Z = zdTakeoff, P = Z.P.proj, f = P.files[0].id, H = 595, y = v => H - v, R = (x0, y0, x1, y1) => [[x0, y(y1)], [x1, y(y1)], [x1, y(y0)], [x0, y(y0)]];
    [1, 3].forEach(p => { P.scales[f + ":" + p] = {ptPerFt: 9, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()}; });
    P.sheets = Object.assign(P.sheets || {}, {[f + ":1"]: {no: "A-101", title: "Ground floor plan", floor: "Ground floor"}});
    P.conds.push({id: "Cfa", name: "Floor area", type: "area", unit: "Sft", color: "#2b7de9", h: "", t: "", faces: 1, dedMin: 1, boq: "FL-01", rate: 100, rateSrc: "test quote", rateDate: "2026-10-01"},
      {id: "Cdr", name: "Doors", type: "count", unit: "Nos", color: "#d03b3b", h: "", t: "", faces: 1, dedMin: 0, boq: "DR-01"},
      {id: "Csk", name: "Skirting", type: "linear", unit: "ft", color: "#16a34a", h: "", t: "", faces: 1, dedMin: 0});
    const it = (id, cond, page, kind, pts, label) => P.items.push({id, cond, file: f, page, kind, pts, nos: 1, label});
    it("I1", "Cfa", 1, "shape", R(G.ax0, G.ay0, G.ax1, G.ay1), "Bed room"); it("I2", "Cfa", 1, "shape", R(G.bx0, G.ay0, G.bx1, G.ay1), "Store");
    it("I3", "Cfa", 1, "ded", R(G.ax0 + 18, G.ay0 + 18, G.ax0 + 54, G.ay0 + 45), "void"); it("I4", "Cfa", 3, "shape", R(300, 300, 345, 345), "Porch");
    it("I5", "Cdr", 1, "shape", [[G.d0 + 13, y(G.ay0 + 4)], [G.ax1 + 3, y(G.p0 + 9)]], "D1"); it("I6", "Cdr", 3, "shape", [[320, 200]], "D2");
    it("I7", "Csk", 1, "shape", [[G.ax0, y(G.ay0)], [G.ax1, y(G.ay0)], [G.ax1, y(G.ay1)], [G.ax0, y(G.ay1)], [G.ax0, y(G.ay0)]], "Bed room skirting");
    Z.save(); Z.refresh(); }, G);
  await wait(400);
  const tot = await T(() => zdTakeoff.P.proj.conds.map(c => [c.name, zdTakeoff.condTotals(c).net]));
  ok(near(tot[0][1], 168 + 140 - 12 + 25, 1e-6) && tot[1][1] === 3 && near(tot[2][1], 52, 1e-6), "the takeoff: floor area 321.00 Sft, doors 3 Nos, skirting 52.00 ft (" + JSON.stringify(tot) + ")");

  console.log("plot: preview");
  await page.keyboard.press("Control+p"); await wait(500);
  ok(await dlgOpen() && await page.isVisible("#plPvGo") && (await T(() => document.getElementById("plLb").value)) === "normal", "the plot dialog has Preview and Labels on paper (Normal by default)");
  ok(await T(() => document.getElementById("plPv").checked && zdTakeoff.prevAlways()), "“Always preview before Print / Save PDF” is on by default");
  await page.selectOption("#plPaper", "A4"); await page.selectOption("#plLb", "small"); await page.selectOption("#plTw", "fine");
  await page.click("#plPvGo"); await pvReady(); await wait(300);
  ok(!(await dlgOpen()) && await pvOpen(), "Preview: the settings close, the preview opens");
  const pv1 = await T(() => { const c = document.querySelector("#pvWrap .pvs canvas"), b = document.getElementById("pvS"); return {cw: parseFloat(c.style.width), ch: parseFloat(c.style.height), bw: b.clientWidth, bh: b.clientHeight, info: document.getElementById("pvInfo").textContent, sz: document.getElementById("pvSz").textContent, pg: document.getElementById("pvPg").textContent, z: document.getElementById("pvZ").textContent}; });
  ok(pv1.cw > 500 && (Math.abs(pv1.cw - (pv1.bw - 24)) < 2 || Math.abs(pv1.ch - (pv1.bh - 24)) < 2), "the page fills the window (fit): " + pv1.cw.toFixed(0) + " × " + pv1.ch.toFixed(0) + " px in " + pv1.bw + " × " + pv1.bh);
  ok(/A4/.test(pv1.info) && /scale/.test(pv1.info) && /takeoff lines Fine/.test(pv1.info) && /labels Small/.test(pv1.info), "paper, scale, line weight and label size shown: " + pv1.info);
  ok(/297 × 210 mm — A4 landscape|210 × 297 mm — A4 portrait/.test(pv1.sz) && pv1.pg === "1 / 1" && pv1.z === "100%", "the page's paper size read from the PDF: " + pv1.sz + " · page " + pv1.pg);
  ok(await pvInk() > 200, "the plot is drawn in the preview (" + await pvInk() + " inked samples)");
  await page.click("#pvIn"); await wait(400);
  const z2 = await T(() => ({w: parseFloat(document.querySelector("#pvWrap .pvs canvas").style.width), z: document.getElementById("pvZ").textContent}));
  ok(z2.z === "125%" && near(z2.w, pv1.cw * 1.25, 2), "+ zooms in 125 % (" + z2.w.toFixed(0) + " px)");
  const bx = await page.locator("#pvS").boundingBox(); await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.wheel(0, -200); await wait(400);
  ok((await T(() => document.getElementById("pvZ").textContent)) === "150%", "the wheel zooms too (150 %)");
  await page.waitForFunction(() => { const c = document.querySelector("#pvWrap .pvs canvas"); return c && Math.abs(c.width / parseFloat(c.style.width) - Math.min(window.devicePixelRatio || 1, 2)) < 0.05; }, null, {timeout: 5000}).catch(() => {});
  ok(await T(() => { const c = document.querySelector("#pvWrap .pvs canvas"); return document.querySelectorAll("#pvWrap .pvs canvas").length === 1 && c.width / parseFloat(c.style.width) > 0.95 * Math.min(window.devicePixelRatio || 1, 2); }), "zoomed in, the page is drawn again sharp (one canvas, at screen resolution)");
  await page.click("#pvFit"); await wait(300);
  await page.click("#pvBk"); await wait(500);
  ok(!(await pvOpen()) && await dlgOpen() && (await T(() => [document.getElementById("plPaper").value, document.getElementById("plLb").value, document.getElementById("plTw").value].join())) === "A4,small,fine", "Back: the plot dialog again with its settings (A4, small labels, fine lines)");
  ok(await T(() => zdTakeoff.pdfPreview.cur == null && !document.querySelector("#pvWrap canvas")), "the preview let go of its canvas and its pdf.js document");
  await page.click("#plPvGo"); await pvReady(); await wait(200);
  const sv = await download(() => page.click("#pvSave"));
  const same = await T(b => { const L = zdTakeoff.pdfPreview.last, s = zdTakeoff.pvSig(new Uint8Array(b)); return !!L && L.length === 1 && !(L[0] instanceof Uint8Array) && L[0].len === s.len && L[0].crc === s.crc; }, Array.from(sv.buf));
  ok(/_plot_.*\.pdf$/.test(sv.name) && same, "Save PDF in the preview saves the very bytes the preview drew (" + sv.buf.length + " bytes, same length and fingerprint) — the preview keeps no copy of them");
  ok(!(await pvOpen()) && !(await dlgOpen()), "…and the preview closes");
  const pd = await PL.PDFDocument.load(sv.buf), psz = pd.getPage(0).getSize();
  ok(pd.getPageCount() === 1 && near(Math.max(psz.width, psz.height), 841.89, 0.5), "the saved plot is one A4 page");
  ok(await T(() => zdTakeoff.plotPref().plbl === "small"), "Labels on paper is kept with the plot settings (small)");

  console.log("plot: always preview");
  await page.keyboard.press("Control+p"); await wait(400);
  await page.click("#dlgOk"); await pvReady(); await wait(200);
  ok(await pvOpen(), "Print opens the preview first (always preview on)");
  const fr0 = await T(() => document.querySelectorAll("iframe").length);
  await page.click("#pvPrint"); await wait(600);
  ok(!(await pvOpen()) && (await T(() => [...document.querySelectorAll("iframe")].filter(f => /^blob:/.test(f.src)).length)) > 0 && (await T(() => document.querySelectorAll("iframe").length)) > fr0, "Print in the preview sends the PDF to the print frame");
  T(() => { zdTakeoff.plotDialog(); }); await wait(400);   // (the print frame has the keyboard now)
  await page.click("#plPv"); await wait(100);
  ok(await T(() => !zdTakeoff.prevAlways() && localStorage.getItem("zdTakeoffPrev") === "0"), "the box turns “always preview” off (kept)");
  const sv2 = await download(() => page.click("#dlgBack .df .btn:not(.pri):not(#dlgCancel):not(#plPvGo):not(#plPng)"));
  ok(/\.pdf$/.test(sv2.name) && !(await pvOpen()), "with it off, Save PDF saves at once (no preview)");
  await T(() => localStorage.removeItem("zdTakeoffPrev"));
  T(() => { zdTakeoff.plotDialog(); }); await wait(400); await page.click("#plPvGo"); await pvReady();
  await page.keyboard.press("Escape"); await wait(400);
  ok(!(await pvOpen()) && await dlgOpen(), "Esc in the preview is Back");
  await page.click("#dlgCancel"); await wait(200);

  console.log("plot: labels on paper");
  const lb = await T(() => { const Z = zdTakeoff, S = Z.S, cs = 3, s = 0.5, W = Math.ceil(S.base.width * cs), H = Math.ceil(S.base.height * cs), o = v => Z.plotTkOpts({tlw: "thin", plbl: v}, cs, s);
    const svg = v => Z.pageOverlaySvg(S.fileId, S.pageNo, cs, W, H, o(v)), fs = t => Math.max(0, ...[...t.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1])), sw = t => [...t.matchAll(/<(?:polygon|polyline)[^>]*fill="none"[^>]*stroke-width="([\d.]+)"/g)].map(m => +m[1]).sort().join();
    const r = {}; ["off", "small", "normal", "large"].forEach(v => { const t = svg(v); r[v] = {fs: fs(t), sw: sw(t), txt: (t.match(/<text/g) || []).length, z: o(v).z, lbl: o(v).lbl}; }); return r; });
  ok(near(lb.small.z / lb.normal.z, 0.4 / 0.6, 1e-9) && near(lb.large.z / lb.normal.z, 0.9 / 0.6, 1e-9) && near(lb.normal.z, 3 / 0.5 * 0.6, 1e-9), "Small / Normal / Large: 0.4 / 0.6 / 0.9 pt on paper per screen px");
  ok(lb.small.fs > 0 && near(lb.small.fs / lb.large.fs, 0.4 / 0.9, 0.02) && lb.normal.fs > lb.small.fs, "label text scales with it (" + lb.small.fs + " / " + lb.normal.fs + " / " + lb.large.fs + " px)");
  ok(lb.small.sw === lb.normal.sw && lb.large.sw === lb.normal.sw && lb.normal.sw.length > 0, "line weights stay as chosen whatever the label size (" + lb.normal.sw + ")");
  ok(lb.off.lbl === false && lb.off.txt < lb.normal.txt, "Off leaves the labels out (" + lb.off.txt + " texts vs " + lb.normal.txt + ")");
  const pl = await T(async () => { const Z = zdTakeoff, b = {area: "page", paper: "A3", orient: "auto", scale: "fit", style: "color", lw: true, tk: true, tlw: "thin", legend: false, stamp: false, center: true, np: true};
    const a = await Z.plotPdf(Object.assign({}, b, {plbl: "off"})), c = await Z.plotPdf(Object.assign({}, b, {plbl: "large"})); return [a.length, c.length]; });
  ok(pl[0] > 1000 && pl[1] > 1000 && pl[0] !== pl[1], "plotPdf with labels off and large (" + pl.join(" / ") + " bytes)");

  console.log("export pages: preview");
  T(() => { zdTakeoff.exportPagesDialog({scope: "tk"}); }); await wait(400);
  ok(await page.isVisible("#xPvGo") && await T(() => document.getElementById("xPv").checked), "Export pages has Preview and the always-preview box");
  await page.selectOption("#xFmt", "png"); await wait(100);
  ok(!(await page.isVisible("#xPvGo")), "…Preview is for the PDF formats (hidden for PNG / JPEG)");
  await page.selectOption("#xFmt", "pdf"); await page.selectOption("#xDpi", "150"); await page.fill("#xName", "my_sheets"); await wait(100);
  await page.click("#xPvGo"); await pvReady(); await wait(300);
  ok((await T(() => document.getElementById("pvPg").textContent)) === "1 / 2" && /takeoff at 150 DPI/.test(await T(() => document.getElementById("pvInfo").textContent)), "the two pages with takeoff in one PDF: page 1 / 2, 150 DPI shown");
  await page.click("#pvNext"); await pvReady(); await wait(300);
  ok((await T(() => document.getElementById("pvPg").textContent)) === "2 / 2" && await T(() => document.getElementById("pvNext").disabled), "▶ goes to page 2 (the last)");
  await page.keyboard.press("PageUp"); await wait(300);
  ok((await T(() => document.getElementById("pvPg").textContent)) === "1 / 2", "PgUp back to page 1");
  await page.click("#pvBk"); await wait(500);
  ok(await dlgOpen() && (await T(() => [document.querySelector('#xBody input[name="xSc"]:checked').value, document.getElementById("xName").value, document.getElementById("xDpi").value].join())) === "tk,my_sheets,150", "Back: Export pages again with the pages, name and resolution kept");
  await page.selectOption("#xFmt", "pdfs"); await wait(100); await page.click("#xPvGo"); await pvReady(); await wait(200);
  ok((await T(() => document.getElementById("pvPg").textContent)) === "1 / 2" && (await T(() => document.getElementById("pvSave").textContent)) === "Save .zip" && (await T(() => zdTakeoff.pdfPreview.n)) === 2, "a PDF per page: both previewed in turn, saved as a .zip");
  const zp = await download(() => page.click("#pvSave"));
  ok(/^my_sheets\.zip$/.test(zp.name) && zp.buf.readUInt32LE(0) === 0x04034b50, "Save .zip from the preview: " + zp.name);
  T(() => { zdTakeoff.exportPagesDialog({scope: "page"}); }); await wait(400); await page.selectOption("#xFmt", "pdf"); await page.click("#dlgOk"); await pvReady(); await wait(200);
  ok(await pvOpen(), "Export (always preview on) shows the PDF first");
  const one = await download(() => page.click("#pvSave"));
  ok(/\.pdf$/.test(one.name) && (await PL.PDFDocument.load(one.buf)).getPageCount() === 1, "…and Save PDF saves it (" + one.name + ")");

  console.log("marked-up page from the Export menu");
  await page.click("#bExport"); await wait(200); await page.click("#exPdf1"); await pvReady(); await wait(200);
  ok(await pvOpen() && !(await T(() => !!document.getElementById("pvBk"))), "Marked-up page (.pdf) opens the preview (no settings to go back to)");
  ok(await T(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest("#pvWrap"); }), "nothing behind the preview keeps the keyboard (the button that opened it is let go)");
  let got = false; const h = () => { got = true; }; page.on("download", h);
  await page.click("#pvX"); await wait(800); page.off("download", h);
  ok(!(await pvOpen()) && !got, "× closes it — nothing saved");
  ok(await T(async a => { const u = new Uint8Array(a), b = await zdTakeoff.pdfMerge([u, u]); const L = window.PDFLib, d = await L.PDFDocument.load(b); return d.getPageCount() === 2; }, Array.from(one.buf)), "PDFs per page are put together for Print (pdfMerge)");
  console.log("report builder");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /^Report… — rows by condition/.test(c.t))), "the palette has Report…");
  await page.click("#bExport"); await wait(200); await page.click("#exRepB"); await wait(400);
  ok(await dlgOpen() && (await T(() => document.querySelectorAll("#rbPrev table.rbt tbody tr").length)) > 5, "Report… in the Export menu opens the report builder with the table previewed");
  const agree = await T(() => { const Z = zdTakeoff, out = {};
    for (const grp of ["cond", "page", "floor", "condpage"]) for (const rows of ["items", "sum"]) {
      const R = Z.reportBuild({grp, rows, cols: ["cond", "boq", "page", "lbl", "nos", "qty", "unit", "rate", "amt", "n", "note"]}), lines = R.groups.flatMap(g => g.sub ? g.sub.flatMap(s => s.rows) : g.rows);
      const bad = Z.P.proj.conds.filter(c => { const t = Z.condTotals(c).net, b = R.byCond.find(x => x.c.id === c.id), l = lines.filter(r => r.c.id === c.id).reduce((a, r) => a + r.qty, 0); return !b || Math.abs(b.qty - t) > 1e-9 || Math.abs(l - t) > 1e-9; });
      const gsum = R.groups.every(g => g.qty == null || Math.abs(g.qty - (g.sub ? g.sub : g.rows).reduce((a, r) => a + r.qty, 0)) < 1e-9);
      out[grp + "/" + rows] = {bad: bad.map(c => c.name), gsum, n: R.n, groups: R.groups.map(g => g.name + (g.qty == null ? "" : " = " + g.qty) + (g.sub ? " [" + g.sub.map(s => s.name + " = " + s.qty).join("; ") + "]" : "")), amt: R.amt}; }
    return out; });
  ok(Object.values(agree).every(x => !x.bad.length && x.n === 7), "every grouping (by condition / page / floor / condition then page, each line or summed): each condition's grand total = condTotals, and its lines add up to it");
  ok(Object.values(agree).every(x => x.gsum && near(x.amt, 321 * 100, 1e-6)), "group totals add their lines; the grand amount is 321.00 Sft × 100 = 32,100.00 (only the rated condition priced)");
  ok(agree["floor/items"].groups.length === 2 && /^Ground floor/.test(agree["floor/items"].groups[0]) && /test-plans p\.3/.test(agree["floor/items"].groups[1]), "by floor: the sheet's floor (Ground floor), else the page (" + agree["floor/items"].groups.join(" | ") + ")");
  ok(/Floor area \(Sft\) = 321 \[A-101 · Ground floor plan \(test-plans p\.1\) = 296; test-plans p\.3 = 25\]/.test(agree["condpage/sum"].groups[0]), "by condition then page: Floor area 321 = p.1 296 + p.3 25 (" + agree["condpage/sum"].groups[0] + ")");
  ok(agree["page/items"].groups.length === 2 && agree["page/items"].groups.every(g => !/=/.test(g)), "by page: a page with several units has no quantity total (mixed units), only amounts and counts");
  const gt1 = await T(() => { const Z = zdTakeoff, C = Z.P.proj.conds, u0 = C.map(c => c.unit), mix = Z.reportHtml(Z.reportBuild({grp: "cond", rows: "sum"}), 300);
    C.forEach(c => { c.unit = "Sft"; }); let one, R; try { R = Z.reportBuild({grp: "cond", rows: "sum"}); one = Z.reportHtml(R, 300); } finally { C.forEach((c, i) => { c.unit = u0[i]; }); }
    const gt = h => (/<tr class="tot gt">([\s\S]*?)<\/tr>/.exec(h) || [, ""])[1];
    return {mix: /mixed units/.test(gt(mix)), one: !/mixed units/.test(gt(one)) && gt(one).includes(Z.fq(R.gqty, "Sft")), gq: R.gqty}; });
  ok(gt1.mix && gt1.one, "the preview's grand total: “mixed units” only when the units differ — all in Sft, it is their sum (" + gt1.gq + ")");
  await page.selectOption("#rbGrp", "page"); await page.uncheck('#dlgB [data-rbc="lbl"]'); await page.check('#dlgB [data-rbc="n"]'); await page.check('#dlgB [data-rbc="note"]'); await page.fill("#rbNote", "Checked by"); await wait(200);
  const pvw = await T(() => ({head: [...document.querySelectorAll("#rbPrev table.rbt:first-child thead th")].map(t => t.textContent), grp: [...document.querySelectorAll("#rbPrev tr.grp")].map(t => t.textContent), fa: (document.querySelector('#rbPrev [data-rbq="Cfa"]') || {}).textContent || ""}));
  ok(pvw.head.join("|") === "Condition|BOQ code|Page / sheet|Nos|Quantity|Unit|Rate PKR|Amount PKR|Measurements|Checked by" && /A-101/.test(pvw.grp[0]), "the preview follows the choices: grouped by page, Label out, Measurements and the note column (“Checked by”) in");
  ok(/321\.000/.test(pvw.fa) && /32,100\.00/.test(pvw.fa), "…with the grand total by condition: " + pvw.fa);
  await page.selectOption("#rbGrp", "condpage"); await wait(150);
  const xl = await download(() => page.click("#dlgOk"));
  ok(/_Report\.xlsx$/.test(xl.name) && await T(() => zdTakeoff.repPref().grp === "condpage" && zdTakeoff.repPref().note === "Checked by"), "Excel saved (" + xl.name + "), the choices kept for next time");
  const XL = require(path.join(LIBS, "exceljs")), wb = new XL.Workbook(); await wb.xlsx.load(xl.buf);
  const ws = wb.getWorksheet("Report"), bc = wb.getWorksheet("Totals by condition"), num = v => v && typeof v === "object" ? (v.result != null ? +v.result : NaN) : +v;
  const cellV = a => num(ws.getCell(a).value), evalSum = f => f.replace(/^SUM\(|\)$/g, "").split(",").reduce((t, r) => { const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(r); let s2 = 0; for (let i = +m[2]; i <= +(m[4] || m[2]); i++) s2 += cellV(m[1] + i) || 0; return t + s2; }, 0);
  const sums = []; ws.eachRow(r => r.eachCell(c => { const v = c.value; if (v && typeof v === "object" && /^SUM\(/.test(v.formula || "")) sums.push({f: v.formula, r: +(v.result || 0), got: evalSum(v.formula), at: c.address}); }));
  ok(sums.length >= 6 && sums.every(x => Math.abs(x.got - x.r) < 1e-6), "Report sheet: " + sums.length + " SUM totals (lines → page → condition → grand), each equal to what it adds: " + sums.filter(x => Math.abs(x.got - x.r) >= 1e-6).concat(sums).slice(0, 3).map(x => x.at + "=" + x.f + " → " + x.r + (Math.abs(x.got - x.r) < 1e-6 ? "" : " (adds to " + x.got + ")")).join(", "));
  const hcol = ws.columnCount; let qcol = 0; ws.getRow(4).eachCell((c, j) => { if (c.value === "Quantity") qcol = j; });
  const bcr = []; bc.eachRow((r, i) => { if (i > 1 && r.getCell(7).value) bcr.push({id: r.getCell(7).value, f: (r.getCell(3).value || {}).formula || "", q: num(r.getCell(3).value), n: num(r.getCell(5).value)}); });
  const manual = id => { let t = 0; ws.eachRow((r, i) => { if (i >= 5 && r.getCell(hcol - 1).value === id && r.getCell(hcol).value === "m") t += num(r.getCell(qcol).value); }); return t; };
  const ct = await T(() => Object.fromEntries(zdTakeoff.P.proj.conds.map(c => [c.id, zdTakeoff.condTotals(c).net])));
  ok(bcr.length === 3 && bcr.every(x => /^SUMIFS\(Report!\$/.test(x.f) && Math.abs(x.q - ct[x.id]) < 1e-6 && Math.abs(manual(x.id) - ct[x.id]) < 1e-6), "Totals by condition: SUMIFS over the report's lines = condTotals (" + bcr.map(x => x.id + " " + x.q).join(", ") + ")");
  ok(ws.getColumn(hcol).hidden && ws.getColumn(hcol - 1).hidden, "the helper columns for SUMIFS are hidden");
  await page.click("#bExport"); await wait(200); await page.click("#exRepB"); await wait(400);
  ok((await T(() => document.getElementById("rbGrp").value)) === "condpage" && (await T(() => document.getElementById("rbNote").value)) === "Checked by", "the dialog opens again as it was left");
  await page.selectOption("#rbGrp", "cond"); await wait(100);
  const csv = await download(() => page.click("#rbCsv")), ct2 = csv.buf.toString("utf8").replace(/^\ufeff/, "").split(/\r\n/);
  ok(/_Report\.csv$/.test(csv.name) && ct2.includes("Floor area,FL-01,321.000,Sft,4,32100.00") && ct2.includes("Doors,DR-01,3,Nos,2,") && ct2.some(l => /^Total FL-01 · Floor area \(Sft\),/.test(l)), "CSV: the groups, their totals and the grand total by condition (Floor area 321.000 Sft, Doors 3)");

  console.log("magnifier");
  await T(() => { if (document.activeElement) document.activeElement.blur(); }); await page.keyboard.press("f"); await wait(600);
  await page.keyboard.press("Shift+G"); await wait(100);
  ok(await T(() => zdTakeoff.MAG.on && localStorage.getItem("zdTakeoffMag") === "1"), "Shift+G turns the magnifier on (kept)");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /^Magnifier on \/ off/.test(c.t) && c.k === "Shift+G")), "…and it is in the palette with its key");
  await page.keyboard.press("m"); await wait(100);
  const wp = await T(G => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + G.X0 * S.view.s + S.view.tx, r.top + (595 - (G.Y0 + 60)) * S.view.s + S.view.ty]; }, G);   // on the outer face of the left wall
  await page.mouse.move(wp[0] - 30, wp[1]); await wait(60); await page.mouse.move(wp[0], wp[1]); await wait(300);
  const mg = await T(([x, y]) => { const el = document.querySelector("#stage .mglass"); if (!el || el.style.display !== "block") return null; const b = el.getBoundingClientRect(), c = el.getContext("2d"), k = el.width / b.width, m = el.width / 2;
    const lum = (px, py) => { const d = c.getImageData(Math.round(px), Math.round(py), 1, 1).data; return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]; };
    let mid = 255; for (let dx = -5; dx <= 5; dx++) mid = Math.min(mid, lum(m + dx * k, m + 3 * k));
    return {w: b.width, h: b.height, over: x >= b.left && x <= b.right && y >= b.top && y <= b.bottom, mid, out: lum(m - 45 * k, m + 3 * k), t: zdTakeoff.MAG.t, k: zdTakeoff.MAG.k}; }, wp);
  ok(mg && near(mg.w, 184, 2.5) && near(mg.h, 184, 2.5) && !mg.over, "measuring (M): a round glass (180 px inside its border) beside the cursor, not over it" + (mg ? " (" + mg.w + " px)" : ""));
  ok(mg && mg.k === 3 && mg.mid < mg.out - 15, "it shows the drawing at 3×: the wall line under the cursor dark at its centre (" + (mg && mg.mid.toFixed(0)) + " vs " + (mg && mg.out.toFixed(0)) + " beside it)");
  ok(mg && mg.t < 12, "one frame of it is cheap: " + (mg && mg.t.toFixed(2)) + " ms");
  const perf = await T(async () => { const Z = zdTakeoff, t = []; if (Z.S.tool !== "measure") return 99; for (let i = 0; i < 30; i++) { const a = performance.now(); Z.magDraw(); t.push(performance.now() - a); await new Promise(r => requestAnimationFrame(r)); } t.sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; });
  ok(perf < 8, "median frame " + perf.toFixed(2) + " ms (drawn once per animation frame, from the canvases on screen)");
  await page.mouse.move(wp[0] + 80, wp[1] + 40); await wait(250);
  const ov = await T(() => { const o = zdTakeoff.MAG.ov[0]; return !!o.img && o.img.naturalWidth > 0; });
  ok(ov, "the takeoff overlay is in the glass too (made into a picture when it changes)");
  await page.mouse.move(wp[0], 8); await wait(200);
  ok(await T(() => document.querySelector("#stage .mglass").style.display === "none"), "off the stage, the glass is hidden");
  await page.keyboard.press("Escape"); await page.keyboard.press("v"); await page.mouse.move(wp[0] + 5, wp[1] + 5); await wait(200);
  ok(await T(() => document.querySelector("#stage .mglass").style.display === "none"), "with the select tool (not drawing) it stays hidden");
  await page.keyboard.press("Shift+G"); await wait(100);
  ok(await T(() => !zdTakeoff.MAG.on && !localStorage.getItem("zdTakeoffMag")), "Shift+G again turns it off");

  console.log("save as PNG");
  const ihdr = b => ({png: b.slice(0, 8).toString("hex") === "89504e470d0a1a0a", w: b.readUInt32BE(16), h: b.readUInt32BE(20)});
  T(() => { zdTakeoff.plotDialog(); }); await wait(400);
  ok(await page.isVisible("#plPng") && (await T(() => document.getElementById("plDpi").value)) === "300", "the plot dialog has Save PNG and a PNG resolution (300 DPI by default)");
  await page.selectOption("#plPaper", "A4"); await page.selectOption("#plDpi", "150");
  const lo = await T(() => { const o = Object.assign(zdTakeoff.plotPref(), {paper: "A4", dpi: 150}); const L = zdTakeoff.plotLayout(o, zdTakeoff.plotWin(o)); return {PW: L.PW, PH: L.PH}; });
  const png1 = await download(() => page.click("#plPng")); const i1 = ihdr(png1.buf);
  ok(i1.png && /_150dpi\.png$/.test(png1.name) && !(await pvOpen()), "Save PNG saves a PNG at once, named with its DPI (" + png1.name + ")");
  ok(Math.abs(i1.w - Math.ceil(lo.PW * 150 / 72)) <= 1 && Math.abs(i1.h - Math.ceil(lo.PH * 150 / 72)) <= 1, "…the A4 sheet at 150 DPI: " + i1.w + " × " + i1.h + " px");
  const big = await T(() => { const o = Object.assign(zdTakeoff.plotPref(), {paper: "ARCH E 36×48", dpi: 600}); const L = zdTakeoff.plotLayout(o, zdTakeoff.plotWin(o)); const d = zdTakeoff.plotPngDpi(o, L); return {d, w: L.PW * d / 72, h: L.PH * d / 72}; });
  ok(big.d < 600 && Math.max(big.w, big.h) <= 16000 && big.w * big.h <= 100e6 + 1, "a sheet too big for one picture (ARCH E at 600 DPI) is drawn at the most that fits: " + big.d + " DPI");
  T(() => { zdTakeoff.plotDialog(); }); await wait(400); await page.click("#plPvGo"); await pvReady(); await wait(200);
  ok(await page.isVisible("#pvPng"), "the plot preview has Save PNG too");
  const png2 = await download(() => page.click("#pvPng"));
  ok(ihdr(png2.buf).png && !(await pvOpen()), "…which saves the picture and closes the preview");
  const ink = await T(async b64 => { const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode(); const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++; return n / (d.length / 4); }, png1.buf.toString("base64"));
  ok(ink > 0.001, "the PNG holds the drawing, not a blank sheet (" + (ink * 100).toFixed(2) + " % ink)");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

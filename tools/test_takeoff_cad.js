#!/usr/bin/env node
/* Browser tests for AutoCAD drawings in the PDF Takeoff (takeoff/cad.js and its use in takeoff/takeoff.js), against the
   drawings in tools/cad_fixtures — made by AutoCAD 2024 itself from make_zd_test*.lsp (accoreconsole), so the answers are
   known: a 10'-0" x 12'-0" room (120 Sft) inside a 9" wall outline (155.25 Sft), a 20'-0" line, a DOOR3 block inserted
   twice, solid and ANSI31 hatches (25 Sft each), layers off and frozen, a CENTER linetype; and in mm (INSUNITS 4) blocks
   with attributes, a mirrored and a scaled block, a bulged heavy polyline (81.49 Sft), a wide polyline, hatches with an
   island, a gradient, true colours, dimensions, leaders, xlines and rays.

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cad.js

   TK_LIBS holds pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json — the CDN requests are answered from
   there (offline / sandboxed runs). Checks: DWG 2018 / 2000 and DXF read; the scale from the drawing's units; AutoCAD's
   layers (colours, off / frozen start off, isolate); the screen on black (colour 7 white, colours as AutoCAD), white and
   monochrome, drawn from the scene on every zoom step; a room measured by snapping to the drawing = 120.00 Sft; CAD
   quantities by layer and block into the takeoff; right-click on an object; Ctrl+P plot (window, scale, monochrome) as a
   PDF; exports keep layers off; Project + PDFs carries the DWG; the scene read again from the DWG lands on the same page. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", FIX = path.join(__dirname, "cad_fixtures");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "@mlightcad/libredwg-web/wasm/libredwg-web.wasm"))) { console.log("TK_LIBS must hold pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json — see the header"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib"));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: js, headers: H});   // the CAD worker imports the ES-module build
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    let m = /@mlightcad\/libredwg-web@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/libredwg-web", m[1]), contentType: /\.wasm$/.test(m[1]) ? "application/wasm" : js, headers: H});
    m = /@mlightcad\/dxf-json@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/dxf-json", m[1]), contentType: js, headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(70); };
  /* a page point of the drawing (inches / mm in model space) */
  const pp = (X, Y) => T(([X, Y]) => { const m = zdTakeoff.cadMeta(zdTakeoff.S.fileId).map, k = 72 * m.uIn / m.den; return [m.ox + (X - m.x0) * k, m.oy + (m.y1 - Y) * k]; }, [X, Y]);
  const pix = async (X, Y) => { const p = await pp(X, Y), q = await scr(p[0], p[1]); return T(([x, y]) => { const c = document.getElementById("hi"), r = c.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2), g = c.getContext("2d").getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data; return [g[0], g[1], g[2]]; }, q); };
  const add = async f => { await page.setInputFiles("#fileIn", path.join(FIX, f)); await page.waitForFunction(n => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files.find(x => x.name === n); return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id]; }, f, {timeout: 60000}); await wait(500); };

  await page.goto(URL, {waitUntil: "load"}); await wait(500);
  await page.click("#bNewProj"); await page.fill("#dlgName", "CAD test"); await page.click("#dlgOk"); await wait(400);

  console.log("DWG 2018 (inches)");
  const t0 = Date.now(); await add("zd_test_2018.dwg"); const tRead = Date.now() - t0;
  const m1 = await T(() => { const Z = zdTakeoff, f = Z.P.proj.files[0]; return {cad: f.cad, sc: Z.P.proj.scales[f.id + ":1"], off: (Z.P.proj.layersOff || {})[f.id] || [], name: f.name, chip: document.getElementById("scaleChip").textContent}; });
  ok(m1.cad && m1.cad.fmt === "DWG" && m1.cad.units === 1 && m1.cad.unitName === "inches", "read as an AutoCAD DWG in inches (" + tRead + " ms with the reader's first load)");
  ok(m1.cad.den === 16 && near(m1.cad.ptPerFt, 54), "laid out at a standard scale, 1:16 (3/4\" = 1'-0\"), 54 pt per ft");
  ok(m1.sc && m1.sc.how === "cad" && m1.sc.verified && near(m1.sc.ptPerFt, 54), "the page's scale is set from the drawing's units, verified");
  ok(/from the drawing/.test(m1.chip), "the scale chip says it comes from the drawing (" + m1.chip.trim() + ")");
  ok(m1.off.includes("A-FURN") && m1.off.includes("A-FROZEN") && !m1.off.includes("A-WALL"), "layers off / frozen in the drawing start off (" + m1.off.join(", ") + ")");
  const L1 = await T(() => zdTakeoff.cadMeta(zdTakeoff.S.fileId).layers.map(l => [l.name, l.c]));
  ok(L1.find(l => l[0] === "A-WALL")[1] === 0xff0000 && L1.find(l => l[0] === "A-DOOR")[1] === 0xffff00 && L1.find(l => l[0] === "A-TEXT")[1] === -1, "AutoCAD's layer colours: A-WALL red, A-DOOR yellow, A-TEXT colour 7 (ink)");

  console.log("the screen");
  ok(await T(() => document.getElementById("stage").classList.contains("dark")), "an AutoCAD drawing opens on black (View → Background: Auto)");
  await page.click("#bFit"); await wait(500);
  ok(JSON.stringify(await pix(500, 200)) === "[0,0,0]", "model space is black");
  const wall = await pix(0, 72);   // the room's left side (inner face)
  ok(wall[0] > 180 && wall[1] < 60 && wall[2] < 60, "A-WALL drawn red " + JSON.stringify(wall));
  const txt = await T(() => { const Z = zdTakeoff, pg = Z.cadPage(); return pg && pg.tS.includes("BEDROOM"); });
  ok(txt, "text is in the scene (BEDROOM)");
  const furnHidden = await T(() => { const Z = zdTakeoff, sc = Z.S.cadSc[Z.S.fileId], h = Z.cadHidden(Z.S.fileId, sc); return h[sc.layers.findIndex(l => l.name === "A-FURN")] === 1; });
  ok(furnHidden, "a layer that is off is left out of the screen");
  const perf = await T(async () => { const Z = zdTakeoff, st = document.getElementById("stage"), t = []; for (let i = 0; i < 12; i++) { const a = performance.now(); Z.S.view.s *= 1.15; Z.applyView(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); t.push(performance.now() - a); } return {max: Math.max(...t), rendered: Z.S.rendered && Math.abs(Z.S.rendered.s - Z.S.view.s) < 1e-9}; });
  ok(perf.rendered, "every zoom step is drawn from the scene at once (rendered view = view)");
  ok(perf.max < 250, "zoom steps stay quick (slowest frame " + perf.max.toFixed(0) + " ms)");
  await page.click("#bFit"); await wait(400);
  await T(() => zdTakeoff.setMono(true)); await wait(300);
  const mono = await pix(0, 72); ok(mono[0] > 200 && mono[1] > 200 && mono[2] > 200, "monochrome on black: the red wall drawn white " + JSON.stringify(mono));
  await T(() => { zdTakeoff.setMono(false); zdTakeoff.setBg("white"); }); await wait(300);
  const paper = await pix(500, 200); ok(JSON.stringify(paper) === "[255,255,255]" && !(await T(() => document.getElementById("stage").classList.contains("dark"))), "Background: White — white paper " + JSON.stringify(paper));
  const ink = await pix(324, 100); ok(ink.every(v => v < 120), "…colour 7 (the circle on layer 0) drawn black on white " + JSON.stringify(ink));
  await T(() => zdTakeoff.setBg("auto")); await wait(300);
  ok((await page.locator("#bBg_black").count()) === 1 && (await page.locator("#bMono").count()) === 1, "View menu has Background (Auto / Black / White) and Monochrome");

  console.log("layers");
  await T(() => { document.getElementById("tLay").click(); }); await wait(300);
  ok(await page.locator("#layerList .lsw").count() >= 9, "the Layers tab shows AutoCAD's layers with their colour swatches");
  const wallId = await T(() => { const cfg = zdTakeoff.S.ocgs[zdTakeoff.S.fileId]; return Object.entries(cfg.getGroups()).find(([, g]) => g.name === "A-WALL")[0]; });
  await page.click(`#layerList [data-liso="${wallId}"]`); await wait(400);
  const iso = await T(() => (zdTakeoff.P.proj.layersOff || {})[zdTakeoff.S.fileId] || []);
  ok(!iso.includes("A-WALL") && iso.includes("A-DOOR") && iso.includes("A-TEXT"), "isolate (LAYISO): only A-WALL left on");
  const sw0 = await pix(60, 114); ok(sw0[0] < 40 && sw0[1] < 40, "…the yellow door swing is gone from the screen " + JSON.stringify(sw0));
  await page.click(`#layerList [data-liso="${wallId}"]`); await wait(400);
  ok(((await T(() => (zdTakeoff.P.proj.layersOff || {})[zdTakeoff.S.fileId] || [])).length === 0), "isolate again: every layer back on");
  await T(() => { const Z = zdTakeoff, f = Z.S.fileId, cfg = Z.S.ocgs[f]; Object.entries(cfg.getGroups()).forEach(([id, g]) => { if (/A-FURN|A-FROZEN/.test(g.name)) cfg.setVisibility(id, false); }); Z.P.proj.layersOff[f] = ["A-FURN", "A-FROZEN"]; Z.save(); });

  console.log("measure on the drawing");
  await page.waitForFunction(() => { const Z = zdTakeoff; return Z.S.geo[Z.S.key] && Z.S.geo[Z.S.key].segs.length > 50; }, null, {timeout: 20000});
  const segs = await T(() => zdTakeoff.S.geo[zdTakeoff.S.key].segs.length); ok(segs > 50, "the drawing's lines are indexed for snapping (" + segs + ")");
  await page.click("#tCond"); await wait(150); await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(300);
  await page.keyboard.press("r"); await wait(100);
  const c0 = await pp(0, 0), c1 = await pp(120, 144);
  await click(c0[0] + 0.4, c0[1] - 0.3); await click(c1[0] - 0.3, c1[1] + 0.4); await wait(300);
  const room = await T(() => { const Z = zdTakeoff, it = Z.P.proj.items[Z.P.proj.items.length - 1], k = Z.P.proj.scales[it.file + ":" + it.page].ptPerFt; return Z.rowsOf(it, k)[0]; });
  ok(room && near(room.qty, 120, 0.005), "the 10'-0\" x 12'-0\" room, snapped to the drawing's corners: " + (room ? room.qty.toFixed(3) : "?") + " Sft");

  console.log("CAD quantities");
  const before = await T(() => zdTakeoff.P.proj.items.length);
  const got = await T(() => { const Z = zdTakeoff, sc = Z.S.cadSc[Z.S.fileId], pg = sc.pages[0], li = sc.layers.findIndex(l => l.name === "A-WALL"), hi = sc.layers.findIndex(l => l.name === "A-HATCH");
    return Z.cadTakeoff(sc, pg, {lens: new Set([li]), areas: new Set([li, hi]), blocks: new Set(["DOOR3"]), vis: true}); });
  ok(got.area === 4 && got.line === 1 && got.count === 2, "A-WALL / A-HATCH outlines, the A-WALL line and DOOR3 taken off: " + JSON.stringify(got));
  const q = await T(() => { const Z = zdTakeoff, P = Z.P.proj, tot = n => { const c = P.conds.find(x => x.name === n.split("|")[0] && x.type === n.split("|")[1]); return c ? Z.condTotals(c).net : null; }; return {wallA: tot("A-WALL|area"), wallL: tot("A-WALL|linear"), hatch: tot("A-HATCH|area"), door: tot("DOOR3|count"), ai: P.items.slice(-6).every(i => i.ai)}; });
  ok(near(q.wallA, 275.25, 0.01), "A-WALL areas = 120 + 155.25 = " + (q.wallA || 0).toFixed(3) + " Sft");
  ok(near(q.wallL, 20, 0.001), "A-WALL line = 20.000 ft (" + (q.wallL || 0).toFixed(3) + ")");
  ok(near(q.hatch, 50, 0.01), "A-HATCH outlines = 2 × 25 Sft (" + (q.hatch || 0).toFixed(3) + ")");
  ok(q.door === 2, "DOOR3 counted twice");
  ok(q.ai && (await T(() => zdTakeoff.P.proj.items.length)) === before + 6, "taken off as 6 AI-marked measurements (4 areas, 1 run, 1 count of 2)");
  await T(() => zdTakeoff.undoAny()); await wait(200);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === before, "one undo takes the whole CAD takeoff back");
  const ctxL = await T(async () => { const Z = zdTakeoff, p = await Promise.resolve(null); const m = Z.cadMeta(Z.S.fileId).map, k = 72 * m.uIn / m.den; return Z.cadCtxItems([m.ox + (0 - m.x0) * k, m.oy + (m.y1 - 72) * k]).map(i => i.t || i.h); });
  ok(ctxL.some(t => /AutoCAD: lwpolyline · A-WALL/.test(t)) && ctxL.some(t => /Take off its area — 120\.00 Sft/.test(t)), "right-click on the room's outline: “Take off its area — 120.00 Sft”");
  const ctxD = await T(() => { const Z = zdTakeoff, m = Z.cadMeta(Z.S.fileId).map, k = 72 * m.uIn / m.den; return Z.cadCtxItems([m.ox + (30 - m.x0) * k, m.oy + (m.y1 - 18) * k]).map(i => i.t || i.h); });
  ok(ctxD.some(t => /block DOOR3/.test(t)) && ctxD.some(t => /Count every DOOR3 \(2\)/.test(t)), "right-click on a door: block DOOR3, count every one (2)");

  console.log("plot (Ctrl+P)");
  await page.keyboard.press("Control+p"); await wait(500);
  ok(await page.isVisible("#plPaper") && await page.isVisible("#plPrev"), "Ctrl+P opens the plot dialog with a preview (not the browser's print)");
  await page.click("#dlgCancel"); await wait(200);
  const lay = await T(() => { const Z = zdTakeoff, m = Z.cadMeta(Z.S.fileId).map, k = 72 * m.uIn / m.den, w = [m.ox + (0 - m.x0) * k, m.oy + (m.y1 - 144) * k, m.ox + (120 - m.x0) * k, m.oy + (m.y1 - 0) * k];
    const L = Z.plotLayout({paper: "A3", orient: "auto", scale: "48", center: true, stamp: true}, w); return {s: L.s, pw: L.pw, ph: L.ph, sc: L.scTxt, land: L.land}; });
  ok(near(lay.pw, 180, 0.01) && near(lay.ph, 216, 0.01) && /1\/4/.test(lay.sc), "the room plotted at 1/4\" = 1'-0\": 2.5\" × 3\" on the paper (" + lay.pw.toFixed(2) + " × " + lay.ph.toFixed(2) + " pt)");
  const pdf1 = await T(async () => Array.from(await zdTakeoff.plotPdf({area: "extents", paper: "A3", orient: "auto", scale: "fit", style: "mono", lw: true, tk: true, legend: true, stamp: true, center: true, np: true})));
  const pd1 = await PL.PDFDocument.load(Uint8Array.from(pdf1)); const sz = pd1.getPage(0).getSize();
  ok(pd1.getPageCount() === 1 && near(sz.width, 1190.55, 0.5) && near(sz.height, 841.89, 0.5), "plot PDF: one A3 landscape page (" + sz.width.toFixed(1) + " × " + sz.height.toFixed(1) + ")");
  const raw = Buffer.from(Uint8Array.from(pdf1)).toString("latin1");
  ok(raw.length > 3000, "…a vector plot (" + raw.length + " bytes)");

  console.log("export keeps layers off");
  const exp = await T(async () => { const L = window.PDFLib || await new Promise(r => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"; s.onload = () => r(window.PDFLib); document.head.appendChild(s); });
    const Z = zdTakeoff, rec = await new Promise((ok2, bad) => { const q = indexedDB.open("zdTakeoff"); q.onsuccess = () => { const t = q.result.transaction("pdfs").objectStore("pdfs").get(Z.S.fileId); t.onsuccess = () => ok2(t.result); t.onerror = bad; }; q.onerror = bad; });
    const src = await L.PDFDocument.load(rec.data.slice(0)), out = await L.PDFDocument.create(), [cp] = await out.copyPages(src, [0]); out.addPage(cp); Z.ocFix(L, out, [Z.S.fileId]);
    const oc = out.catalog.lookup(L.PDFName.of("OCProperties")), D = oc && oc.lookup(L.PDFName.of("D")), off = D ? D.lookup(L.PDFName.of("OFF")) : null;
    return off ? off.asArray().map(r => out.context.lookup(r).lookup(L.PDFName.of("Name")).decodeText()) : null; });
  ok(exp && exp.includes("A-FURN") && exp.includes("A-FROZEN") && !exp.includes("A-WALL"), "an exported page keeps A-FURN and A-FROZEN off (" + (exp || []).join(", ") + ")");

  console.log("DWG 2000 and DXF (mm)");
  await add("zd_test_2000.dwg");
  ok(await T(() => { const f = zdTakeoff.P.proj.files.find(x => x.name === "zd_test_2000.dwg"); return f && f.cad && f.cad.den === 16 && f.cad.ver === "AC1015"; }), "an AutoCAD 2000 DWG reads the same (1:16)");
  await add("zd_test2_2018.dxf");
  const m2 = await T(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "zd_test2_2018.dxf"), sc = Z.S.cadSc[f.id], Q = Z.S.cadSc[f.id].pages[0]; return {cad: f.cad, ents: Q.ents.length, tS: Q.tS}; });
  ok(m2.cad.fmt === "DXF" && m2.cad.units === 4 && m2.cad.den === 100 && near(m2.cad.ptPerFt, 8.64), "a DXF in millimetres: 1:100, 8.64 pt per ft");
  ok(m2.tS.includes("C7") && m2.tS.includes("C9") && m2.tS.includes("THIRD Ø50 ° ±5"), "attributes and MTEXT (with %%c %%d %%p) read");
  const eq = await T(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "zd_test2_2018.dxf"), sc = Z.S.cadSc[f.id], li = sc.layers.findIndex(l => l.name === "A-EQPM");
    const r = sc.pages[0].ents.filter(e => e.L === li); return {area: r.reduce((a, e) => a + (e.cl ? e.area || 0 : 0), 0), len: r.reduce((a, e) => a + (!e.cl ? e.len || 0 : 0), 0)}; });
  ok(near(eq.area, 81.491, 0.002), "the bulged heavy polyline: 3000 × 2000 mm + a 1000 mm half circle = " + eq.area.toFixed(3) + " Sft");
  ok(near(eq.len, 16.404, 0.002), "the wide polyline: 5000 mm = " + eq.len.toFixed(3) + " ft");
  await add("zd_test2_2018.dwg");
  const same = await T(() => { const Z = zdTakeoff, a = Z.P.proj.files.find(x => x.name === "zd_test2_2018.dwg"), b = Z.P.proj.files.find(x => x.name === "zd_test2_2018.dxf"), qa = Z.S.cadSc[a.id].pages[0].ents, qb = Z.S.cadSc[b.id].pages[0].ents, s = (q, L) => q.reduce((t, e) => t + (e.area || 0), 0);
    return [s(qa), s(qb)]; });
  ok(near(same[0], same[1], 0.01), "the same drawing as DWG and as DXF gives the same areas (" + same.map(v => v.toFixed(2)).join(" = ") + " Sft)");

  console.log("kept in this browser");
  await page.reload({waitUntil: "load"}); await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 30000}); await wait(800);
  const back = await T(async () => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "zd_test_2018.dwg"); await Z.gotoPage(f.id, 1); return {cad: !!Z.cadPage(), on: Z.cadOn(), dark: document.getElementById("stage").classList.contains("dark")}; });
  ok(back.cad && back.on && back.dark, "after a reload the drawing opens from its stored scene (fast screen, black)");
  const reread = await T(async () => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "zd_test_2018.dwg"), m0 = JSON.stringify(Z.cadMeta(f.id).map);
    const db = await new Promise(r => { const q = indexedDB.open("zdTakeoff"); q.onsuccess = () => r(q.result); });
    const rec = await new Promise(r => { const t = db.transaction("pdfs").objectStore("pdfs").get(f.id); t.onsuccess = () => r(t.result); });
    rec.scene.ver = 0; await new Promise(r => { const t = db.transaction("pdfs", "readwrite").objectStore("pdfs").put(rec, f.id); t.onsuccess = r; });
    delete Z.S.cadSc[f.id]; const sc = await Z.cadLoad(f.id); return {same: JSON.stringify(sc.pages[0].map) === m0, n: sc.pages[0].n, ver: sc.ver}; });
  ok(reread.same && reread.n > 20 && reread.ver >= 1, "a scene from an older reader is read again from the DWG onto exactly the same page");

  console.log("Project + PDFs");
  const bnd = await T(async () => { const Z = zdTakeoff, rec = await new Promise(r => { const q = indexedDB.open("zdTakeoff"); q.onsuccess = () => { const t = q.result.transaction("pdfs").objectStore("pdfs").get(Z.P.proj.files[0].id); t.onsuccess = () => r(t.result); }; });
    return {src: !!rec.src && rec.src.byteLength, pdf: rec.data.byteLength}; });
  ok(bnd.src === fs.statSync(path.join(FIX, "zd_test_2018.dwg")).size, "the DWG itself is kept with its PDF (" + bnd.src + " bytes)");
  const [dl] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), T(() => zdTakeoff.P.proj && document.getElementById("bExport").click()).then(async () => { await wait(300); await page.click("#exBnd"); })]);
  const bf = path.join(os.tmpdir(), "tk_cad_" + dl.suggestedFilename()); await dl.saveAs(bf);
  const B = fs.readFileSync(bf), ML = "ZDTAKEOFF-BUNDLE-1\n".length, hl = B.readUInt32BE(ML), H = JSON.parse(B.slice(ML + 4, ML + 4 + hl).toString("utf8"));
  ok(H.pdfs.filter(p => p.srcSize > 0).length === 4, "Project + PDFs carries the 4 drawings' DWG / DXF files too");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

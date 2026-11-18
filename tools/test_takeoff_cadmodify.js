#!/usr/bin/env node
/* Browser tests for editing an AutoCAD drawing's own objects in the PDF Takeoff — Erase, Move, Copy, Rotate, Mirror, Scale, Copy to
   clipboard / Paste (on another drawing, and on a PDF page as markups) and Copy to another page:

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cadmodify.js

   TK_LIBS as for test_takeoff_cad.js (pdfjs-dist, pdf-lib, @mlightcad/libredwg-web, @mlightcad/dxf-json). The drawing is
   tools/cad_fixtures/zd_test_2018.dxf (inches): a 20'-0" line at y 0 and a magenta line at y 20, both from x 200 to 440; a circle
   r 24 at (300, 100); the text BEDROOM at (30, 80). Every answer below is worked out by hand from that geometry. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", FIX = path.join(__dirname, "cad_fixtures");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.05 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "@mlightcad/dxf-json"))) { console.log("TK_LIBS must hold pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: js, headers: H});
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
  const pp = (X, Y) => T(([X, Y]) => { const m = zdTakeoff.cadMeta(zdTakeoff.S.fileId).map, k = 72 * m.uIn / m.den; return [m.ox + (X - m.x0) * k, m.oy + (m.y1 - Y) * k]; }, [X, Y]);
  const at = async (X, Y, o = {}) => { const p = await pp(X, Y), q = await scr(p[0], p[1]); await page.mouse.move(q[0], q[1]); await wait(40); if (o.shift) await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.up(); if (o.shift) await page.keyboard.up("Shift"); await wait(120); };
  /* the drawing's edits in drawing units: the copies' boxes {x0, y0, x1, y1}, how much is taken out, the snips, the selection */
  const D = () => T(() => { const Z = zdTakeoff, m = Z.cadMeta(Z.S.fileId).map, k = 72 * m.uIn / m.den, r = Z.cedRec(), pg = Z.cadPage(), ed = Z.cedC(Z.S.fileId, pg);
    const X = (x, y) => [+(m.x0 + (x - m.ox) / k).toFixed(3), +(m.y1 - (y - m.oy) / k).toFixed(3)];
    return {cp: (ed && ed.cp || []).map(ci => { const a = X(ci.b[0], ci.b[3]), b = X(ci.b[2], ci.b[1]); return {id: ci.cid, x0: a[0], y0: a[1], x1: b[0], y1: b[1], n: ci.n, tn: ci.tn, t0: ci.tn ? ci.tM[0] : null}; }),
      hp: r ? r.hp.length : 0, ht: r ? r.ht.length : 0, sn: r && r.sn ? Object.keys(r.sn).length : 0, sel: Z.cadSelIds().length, xs: Z.cadSelXs(), tool: Z.S.tool}; });
  const box = (c, x0, y0, x1, y1) => c && near(c.x0, x0) && near(c.y0, y0) && near(c.x1, x1) && near(c.y1, y1);
  const cact = async a => { await page.click(`#props [data-cact="${a}"]`); await wait(150); };

  await page.goto(URL, {waitUntil: "load"}); await wait(500);
  await page.click("#bNewProj"); await page.fill("#dlgName", "CAD modify test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", path.join(FIX, "zd_test_2018.dxf"));
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files[0]; return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo[Z.S.key]; }, null, {timeout: 60000}); await wait(500);
  await page.click("#bFit"); await wait(400);
  const F1 = await T(() => zdTakeoff.S.fileId);
  await page.keyboard.press("s"); await wait(80);   // snap off: every point lands where it is put
  const plot = () => T(async () => (await zdTakeoff.plotPdf({area: "extents", paper: "A3", orient: "auto", scale: "fit", style: "mono", lw: true, tk: false, legend: false, stamp: false, center: true, np: true})).length);
  const plot0 = await plot();

  console.log("Erase");
  await T(() => zdTakeoff.setTool("cadsel")); await wait(100);
  await at(420, 0); let d = await D();
  ok(d.sel === 1, "a click on the 20'-0\" line selects it");
  ok(await page.locator('#props [data-cact="erase"]').count() === 1 && await page.locator('#props [data-cact="topage"]').count() === 1, "the selection bar has Erase … Copy to page");
  await page.keyboard.press("Delete"); await wait(200); d = await D();
  ok(d.sel === 0 && d.hp >= 1, "Delete erases it (taken out of the drawing) → " + JSON.stringify({hp: d.hp, sel: d.sel}));
  await at(420, 0); ok((await D()).sel === 0, "an erased line cannot be picked any more");
  await page.keyboard.press("Control+z"); await wait(250);
  await at(420, 0); ok((await D()).sel === 1 && (await D()).hp === 0, "Ctrl+Z brings it back, and it is picked again");
  await page.keyboard.press("Escape"); await wait(80);

  console.log("Move");
  await at(324, 100); ok((await D()).sel === 1, "the circle selected");
  await cact("move"); ok((await D()).tool === "cadxf", "Move waits for its points");
  await at(300, 100); await at(300, 200); d = await D();
  ok(d.cp.length === 1 && box(d.cp[0], 276, 176, 324, 224), "Move (300,100) → (300,200): the circle now 276..324 × 176..224 → " + JSON.stringify(d.cp[0]));
  ok(d.hp >= 1 && d.tool === "cadsel" && d.xs.length === 1 && d.xs[0] === d.cp[0].id, "the original taken out, the moved circle selected");
  ok(await T(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key]; return g.segs.some(s => s[8] < 0); }), "its lines are in the snapping index");
  await page.keyboard.press("Control+z"); await wait(250); d = await D();
  ok(d.cp.length === 0 && d.hp === 0, "Ctrl+Z: the circle back where it was");
  await page.keyboard.press("Control+y"); await wait(250); d = await D();
  ok(d.cp.length === 1 && box(d.cp[0], 276, 176, 324, 224), "Ctrl+Y: moved again (the copy kept through the undo history)");

  console.log("Copy (again and again)");
  await at(324, 200); d = await D(); ok(d.xs.length === 1 && d.sel === 0, "a click on the moved circle selects it (as one object)");
  await cact("copy"); await at(300, 200); await at(400, 200); await at(500, 200); await page.keyboard.press("Escape"); await wait(150); d = await D();
  const c4 = d.cp.find(c => near(c.x0, 376)), c5 = d.cp.find(c => near(c.x0, 476));
  ok(d.cp.length === 3 && box(c4, 376, 176, 424, 224) && box(c5, 476, 176, 524, 224), "two copies at x 400 and x 500 → " + JSON.stringify(d.cp.map(c => [c.x0, c.y0, c.x1, c.y1])));
  ok(d.sn === 1, "the three share one snip (" + d.sn + ")");

  console.log("Rotate (typed angle)");
  await T(() => zdTakeoff.setTool("cadsel")); await at(420, 20); ok((await D()).sel === 1, "the magenta line selected");
  await cact("rotate"); await at(200, 20); await page.keyboard.press("Enter"); await wait(250);
  await page.fill("#cxRo", "90"); await page.click("#dlgOk"); await wait(250); d = await D();
  const ro = d.cp.find(c => near(c.x0, 200) && near(c.x1, 200));
  ok(box(ro, 200, 20, 200, 260), "Rotate 90° about its start: it runs up from (200,20) to (200,260) → " + JSON.stringify(ro));

  console.log("Mirror (keeps the original)");
  const hp0 = d.hp; await page.keyboard.press("Escape"); await at(420, 0);
  await cact("mirror"); await at(500, -50); await at(500, 50); d = await D();
  const mi = d.cp.find(c => near(c.x0, 560));
  ok(box(mi, 560, 0, 800, 0), "Mirror about x 500: a copy from 560 to 800 → " + JSON.stringify(mi));
  ok(d.hp === hp0, "the original line kept (Erase source: No)");

  console.log("Scale");
  await T(() => zdTakeoff.setTool("cadsel")); await at(524, 200); ok((await D()).xs.length === 1, "the copy at x 500 selected");
  await cact("scale"); await at(500, 200); await wait(200); await page.fill("#cxSc", "2"); await page.click("#dlgOk"); await wait(250); d = await D();
  ok(d.cp.some(c => box(c, 452, 152, 548, 248)), "Scale ×2 about its centre: 452..548 × 152..248");

  console.log("Mirror a text (the ribbon's Mirror H on an AutoCAD selection)");
  await T(() => zdTakeoff.setTool("cadsel")); await at(40, 82); d = await D(); ok(d.sel === 1, "BEDROOM selected");
  const ht0 = d.ht; await T(() => zdTakeoff.cadXfQuick("fh")); await wait(200); d = await D();
  const tx = d.cp.find(c => c.tn === 1);
  ok(tx && d.ht === ht0 + 1 && tx.t0 > 0, "mirrored in place as a copy that still reads left to right (MIRRTEXT 0) → " + JSON.stringify(tx));

  console.log("Plot");
  const plot1 = await plot(); ok(plot1 > plot0, "the plot carries the copies (" + plot0 + " → " + plot1 + " bytes)");

  console.log("Copy to clipboard → paste on another drawing");
  await T(() => zdTakeoff.setTool("cadsel")); await at(424, 200); await page.keyboard.press("Control+c"); await wait(150);
  ok(await T(() => !!zdTakeoff.S.cadClip && zdTakeoff.S.clipKind === "cad"), "Ctrl+C keeps the AutoCAD objects");
  await page.setInputFiles("#fileIn", path.join(FIX, "zd_test_2018.dxf").replace("zd_test_2018", "zd_test2_2018"));
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files[1]; return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo[Z.S.key]; }, null, {timeout: 60000}); await wait(500);
  await page.click("#bFit"); await wait(300);
  const F2 = await T(() => zdTakeoff.S.fileId);
  const kk = await T(([a, b]) => { const Z = zdTakeoff, k = f => { const m = Z.cadMeta(f).map; return 72 * m.uIn / m.den; }; return [k(a), k(b)]; }, [F1, F2]);
  await page.keyboard.press("Control+v"); await wait(150); ok((await D()).tool === "cadxf", "Ctrl+V: the copy follows the cursor");
  await at(100, 100); d = await D();
  ok(d.cp.length === 1 && box(d.cp[0], 100, 100, 1319.2, 1319.2), "pasted with its lower-left corner at (100,100), at its real size — 48\" = 1219.2 mm across on this drawing in millimetres → " + JSON.stringify(d.cp[0]) + " (pt per unit " + kk.join(" / ") + ")");
  ok(d.xs.length === 1, "the pasted objects are selected");

  console.log("Copy to another page (dialog)");
  await T(([f]) => zdTakeoff.gotoPage(f, 1), [F1]); await page.waitForFunction(f => zdTakeoff.S.fileId === f && zdTakeoff.S.geo[zdTakeoff.S.key], F1, {timeout: 30000}); await wait(300);
  await T(() => zdTakeoff.setTool("cadsel")); await at(420, 0); ok((await D()).sel === 1, "the 20'-0\" line selected on the first drawing");
  const pB = await pp(200, 0);   // its start on the page: the clipboard's base point (the lower-left corner)
  await cact("topage"); await wait(200);
  await page.selectOption("#cxPg", F2 + "|1"); await page.check('input[name="cxAt"][value="same"]'); await page.click("#dlgOk");
  await page.waitForFunction(f => zdTakeoff.S.fileId === f && zdTakeoff.S.geo[zdTakeoff.S.key], F2, {timeout: 30000}); await wait(400); d = await D();
  const q2 = await T(([p]) => { const m = zdTakeoff.cadMeta(zdTakeoff.S.fileId).map, k = 72 * m.uIn / m.den; return [m.x0 + (p[0] - m.ox) / k, m.y1 - (p[1] - m.oy) / k]; }, [pB]);
  ok(d.cp.length === 2 && d.cp.some(c => box(c, q2[0], q2[1], q2[0] + 6096, q2[1])), "on the second drawing at the same place on the page, 240\" = 6096 mm long → " + JSON.stringify(d.cp.map(c => [c.x0, c.y0, c.x1, c.y1])) + " start " + JSON.stringify(q2));

  console.log("Paste on a PDF page — as markups");
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files[2]; return F && Z.S.fileId === F.id && Z.S.page; }, null, {timeout: 60000}); await wait(600);
  await page.keyboard.press("Control+v"); await wait(150);
  const st = await page.locator("#stage").boundingBox(); await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2); await wait(60); await page.mouse.down(); await page.mouse.up(); await wait(300);
  const mk = await T(() => { const Z = zdTakeoff; return (Z.P.proj.marks || []).filter(m => m.file === Z.S.fileId && m.subject === "AutoCAD paste").map(m => ({type: m.type, n: m.pts.length})); });
  ok(mk.length === 1 && mk[0].type === "polyline" && mk[0].n === 2, "the last thing copied (the 20'-0\" line, by Copy to page) became one polyline markup → " + JSON.stringify(mk));
  await T(([f]) => zdTakeoff.gotoPage(f, 1), [F1]); await page.waitForFunction(f => zdTakeoff.S.fileId === f && zdTakeoff.S.geo[zdTakeoff.S.key], F1, {timeout: 30000}); await wait(300);
  await T(() => zdTakeoff.setTool("cadsel")); await at(424, 200); await page.keyboard.press("Control+c"); await wait(150);
  await T(([f]) => zdTakeoff.gotoPage(f, 1), [await T(() => zdTakeoff.P.proj.files[2].id)]); await page.waitForFunction(() => zdTakeoff.S.fileId === zdTakeoff.P.proj.files[2].id && zdTakeoff.S.page, null, {timeout: 30000}); await wait(400);
  await page.keyboard.press("Control+Shift+v"); await wait(300);
  const mk2 = await T(() => { const Z = zdTakeoff; return (Z.P.proj.marks || []).filter(m => m.file === Z.S.fileId && m.subject === "AutoCAD paste").map(m => ({type: m.type, n: m.pts.length})); });
  ok(mk2.length === 2 && mk2[1].type === "polygon" && mk2[1].n > 20, "a circle copied, then Ctrl+Shift+V (same place): one closed polygon markup → " + JSON.stringify(mk2[1]));

  console.log("Kept with the project");
  const keep = await T(([a]) => { const e = zdTakeoff.P.proj.cadEd[a]; return {cp: e.cp.length, json: JSON.stringify(e).length}; }, [F1]);
  ok(keep.cp === 6, "the first drawing keeps its 6 copies (" + JSON.stringify(keep) + ")");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(fail ? fail + " failed, " + pass + " passed" : "all passed (" + pass + ")");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

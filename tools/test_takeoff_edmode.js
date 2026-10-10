#!/usr/bin/env node
/* Browser tests for PDF mode / AutoCAD mode in the PDF Takeoff (the two buttons after the search box):

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_edmode.js

   TK_LIBS as for test_takeoff_cad.js (pdfjs-dist, pdf-lib, @mlightcad/libredwg-web, @mlightcad/dxf-json).
   PDF mode sets dimmer 60 %, white, monochrome and line weights on; AutoCAD mode dimmer 0 %, black, colours. In AutoCAD mode
   Offset, Trim, Extend, Fillet, Break, Join and Explode work on the drawing's own objects — checked on tools/cad_fixtures/
   zd_test_2018.dxf (inches): a 10'-0" x 12'-0" room inside a 9" wall outline, a 20'-0" line at y 0 from x 200, a magenta line
   at y 20, a circle r 24 at (300, 100). Every answer below is worked out by hand from that geometry. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", FIX = path.join(__dirname, "cad_fixtures");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

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
  const at = async (X, Y, o = {}) => { const p = await pp(X, Y), q = await scr(p[0], p[1]); await page.mouse.move(q[0], q[1]); await wait(40); if (o.shift) await page.keyboard.down("Shift"); await page.mouse.down(); await page.mouse.up(); if (o.shift) await page.keyboard.up("Shift"); await wait(120); };
  const pix = async (X, Y) => { const p = await pp(X, Y), q = await scr(p[0], p[1]); return T(([x, y]) => { const c = document.getElementById("hi"), r = c.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2), g = c.getContext("2d").getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data; return [g[0], g[1], g[2]]; }, q); };
  /* the edited objects, in drawing units: {len, cl, a (start), b (end), cv (has arcs)} */
  const adds = () => T(() => { const Z = zdTakeoff, r = Z.cedRec(), m = Z.cadMeta(Z.S.fileId).map, k = 72 * m.uIn / m.den; if (!r) return [];
    const X = p => [+(m.x0 + (p[0] - m.ox) / k).toFixed(3), +(m.y1 - (p[1] - m.oy) / k).toFixed(3)];
    return r.add.map(a => { let L = 0; const n = a.cl ? a.pts.length : a.pts.length - 1; for (let j = 0; j < n; j++) { const p = a.pts[j], q = a.pts[(j + 1) % a.pts.length]; L += Math.hypot(q[0] - p[0], q[1] - p[1]); }
      return {len: L / k, cl: !!a.cl, n: a.pts.length, a: X(a.pts[0]), b: X(a.pts[a.pts.length - 1]), cv: !!a.cv}; }); });
  const flat = (A, y, x0, x1) => A.find(o => near(o.a[1], y, 0.01) && near(o.b[1], y, 0.01) && near(Math.min(o.a[0], o.b[0]), x0, 0.01) && near(Math.max(o.a[0], o.b[0]), x1, 0.01));
  const toast = () => T(() => document.getElementById("toast").textContent);

  await page.goto(URL, {waitUntil: "load"}); await wait(500);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Edit mode test"); await page.click("#dlgOk"); await wait(400);

  console.log("the two mode buttons");
  const box = async s => (await page.locator(s).boundingBox()) || {x: -1, y: -1, width: 0};
  const fb = await box("#findIn"), bp = await box("#bModePdf"), bc = await box("#bModeCad");
  ok(bp.x > fb.x + fb.width - 2 && bc.x > bp.x && Math.abs(bp.y - bc.y) < 2, "PDF Mode and AutoCAD Mode sit right after the search box");
  await page.click("#bModePdf"); await wait(200);
  let v = await T(() => { const S = zdTakeoff.S; return {dim: S.dim, pct: S.dimPct, bg: S.bg, mono: S.mono, thin: S.thin, mode: S.edMode, on: document.getElementById("bModePdf").classList.contains("on"), lw: document.getElementById("bLw").classList.contains("on")}; });
  ok(v.dim && v.pct === 60 && v.bg === "white" && v.mono && !v.thin && v.lw && v.mode === "pdf" && v.on, "PDF Mode: dimmer 60 %, white background, monochrome on, line weights on → " + JSON.stringify(v));
  await page.click("#bModeCad"); await wait(200);
  v = await T(() => { const S = zdTakeoff.S; return {dim: S.dim, bg: S.bg, mono: S.mono, mode: S.edMode, on: document.getElementById("bModeCad").classList.contains("on"), off: !document.getElementById("bModePdf").classList.contains("on"), lbl: document.getElementById("dimLbl").textContent}; });
  ok(!v.dim && v.lbl === "0%" && v.bg === "black" && !v.mono && v.mode === "cad" && v.on && v.off, "AutoCAD Mode: dimmer 0 %, black background, monochrome off → " + JSON.stringify(v));

  console.log("AutoCAD mode on zd_test_2018.dxf");
  await page.setInputFiles("#fileIn", path.join(FIX, "zd_test_2018.dxf"));
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files[0]; return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo[Z.S.key]; }, null, {timeout: 60000}); await wait(500);
  await page.click("#bFit"); await wait(400);
  ok(await T(() => document.getElementById("stage").classList.contains("dark")), "the drawing is on black");
  await page.keyboard.press("s"); await wait(80);   // snap off: the clicks land where they are put

  await T(() => zdTakeoff.setTool("extend")); await wait(100);
  await at(205, 0); let A = await adds();
  ok(A.length === 1 && flat(A, 0, 129, 440) && near(A[0].len, 311), "Extend: the 20'-0\" line's start grows to the outer wall face at x 129 → 311\" (" + JSON.stringify(A) + ")");
  await at(205, 20); A = await adds();
  ok(A.length === 2 && flat(A, 20, 129, 440), "Extend: the magenta line too, to x 129");
  const red = await pix(129, 100); ok(red[0] > 150 && red[1] < 80, "the outer wall still drawn red (its own colour) " + JSON.stringify(red));
  ok(await T(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key]; return g.edv === Z.cedRec().v && g.segs.some(s => s[8] < 0); }), "the snapping lines are read again with the edits");

  await T(() => zdTakeoff.setTool("trim")); await wait(100);
  await at(129, 10); A = await adds();
  const wall = A.find(o => near(o.len, 580, 0.02));
  ok(wall && !wall.cl && A.length === 3, "Trim: the closed 9\" wall outline cut between the two lines at x 129 — open, 600\" - 20\" = 580\" (" + (wall ? wall.len.toFixed(3) : JSON.stringify(A.map(o => o.len))) + ")");
  ok(JSON.stringify(await pix(129, 10)) === "[0,0,0]" && (await pix(129, 100))[0] > 150, "the trimmed part is gone from the screen, the rest still red");
  await at(400, 20, {shift: true}); A = await adds();
  { const m = A.find(o => near(o.a[1], 20) && near(o.b[1], 20) && near(o.a[0], 129)); ok(m && m.b[0] > 440.5 && /Extended/.test(await toast()), "Shift+click in Trim extends: the magenta line's far end grows to the next object in line (x " + (m ? m.b[0] : "-") + ")"); }

  await T(() => zdTakeoff.setTool("break")); await wait(100);
  await at(300, 0); A = await adds();
  const b1 = flat(A, 0, 129, 300), b2 = flat(A, 0, 300, 440);
  ok(b1 && b2 && near(b1.len, 171) && near(b2.len, 140), "Break: the line cut in two at x 300 → 171\" + 140\"");

  await page.click('[data-rtab="modify"]'); await wait(100);
  await page.click('[data-mod="join"]'); await wait(100);
  ok(await T(() => zdTakeoff.S.tool === "cedjoin"), "Join in AutoCAD mode picks objects");
  await at(200, 0); await at(400, 0); await page.keyboard.press("Enter"); await wait(250); A = await adds();
  const j = flat(A, 0, 129, 440);
  ok(j && j.n === 2 && near(j.len, 311) && !flat(A, 0, 129, 300), "Join: the two halves one line again, 2 points (in line: one segment), 311\"");

  await page.click('[data-mod="explode"]'); await wait(100);
  await at(60, 0); A = await adds();
  const sides = [flat(A, 0, 0, 120), flat(A, 144, 0, 120), A.find(o => near(o.a[0], 0) && near(o.b[0], 0) && near(o.len, 144)), A.find(o => near(o.a[0], 120) && near(o.b[0], 120) && near(o.len, 144))];
  ok(sides.every(Boolean), "Explode: the room's closed polyline into its 4 lines (120\" × 144\")");
  await page.keyboard.press("Escape"); await wait(80);

  await T(() => zdTakeoff.setTool("fillet")); await wait(200);
  await page.fill("#fcR", "1"); await page.click("#dlgOk"); await wait(150);
  await at(100, 0); await at(120, 30); A = await adds();
  const fb2 = flat(A, 0, 0, 108), fr = A.find(o => near(o.a[0], 120) && near(o.b[0], 120) && near(o.len, 132)), arc = A.find(o => o.cv && near(o.len, Math.PI / 2 * 12, 0.005));
  ok(fb2 && fr && arc, "Fillet r 1'-0\": bottom ends at x 108, right side starts at y 12, and a 90° arc of 18.850\" joins them (" + (arc ? arc.len.toFixed(4) : JSON.stringify(A.filter(o => o.cv).map(o => o.len))) + ")");

  const nBefore = (await adds()).length;
  await page.click('[data-mod="offset"]'); await wait(200);
  await page.fill("#cedOD", "1"); await page.click("#dlgOk"); await wait(150);
  await at(300, 0); await at(300, -6); A = await adds();
  ok(A.length === nBefore + 1 && flat(A, -12, 129, 440), "Offset 1'-0\": a parallel copy of the line on the side clicked, at y -12");
  await at(300, 124); await at(300, 130); A = await adds();
  const big = A.find(o => o.cl && near(o.len, 2 * Math.PI * 36, 0.005));
  ok(A.length === nBefore + 3 && big, "Offset of the circle outward: a closed circle r 36 exactly concentric → 226.195\" (to 0.005\") (" + (big ? big.len.toFixed(4) : JSON.stringify(A.filter(o => o.cl).map(o => o.len))) + ")");
  await page.keyboard.press("Escape"); await wait(80);

  await T(() => zdTakeoff.setTool("break")); await wait(100);
  await at(300, 76); A = await adds();
  const circ = A.find(o => !o.cl && near(o.len, 2 * Math.PI * 24, 0.005));
  ok(circ && A.length === nBefore + 3, "Break on a circle: it opens at that point, 2π × 24 = 150.796\" (to 0.005\") (" + (circ ? circ.len.toFixed(4) : "-") + ")");

  await page.keyboard.press("Control+z"); await wait(300); A = await adds();
  ok(A.length === nBefore + 3 && !A.some(o => !o.cl && near(o.len, 2 * Math.PI * 24, 0.02)) && A.some(o => o.cl && near(o.len, 2 * Math.PI * 24, 0.02)), "Ctrl+Z takes the last AutoCAD edit back (the circle closed again)");
  await page.keyboard.press("Control+y"); await wait(300); A = await adds();
  ok(A.some(o => !o.cl && near(o.len, 2 * Math.PI * 24, 0.02)), "Ctrl+Y puts it back");

  console.log("PDF mode: the tools leave the drawing alone");
  const v0 = await T(() => zdTakeoff.cedRec().v);
  await page.click("#bModePdf"); await wait(200);
  await T(() => zdTakeoff.setTool("trim")); await wait(100);
  await at(129, 100);
  ok(await T(v0 => zdTakeoff.cedRec().v === v0, v0) && /length run/.test(await toast()), "Trim in PDF mode works on the takeoff's runs, not on the drawing (" + (await toast()).slice(0, 60) + ")");
  await page.keyboard.press("Escape");

  console.log("put back");
  await T(() => zdTakeoff.cedRestore()); await wait(300);
  ok((await adds()).length === 0 && await T(() => zdTakeoff.cedRec().hp.length === 0), "Restore: the drawing is back as it was read");
  await page.click("#bModeCad"); await wait(400);
  ok((await pix(129, 10))[0] > 150, "the wall shows again where it was trimmed (AutoCAD mode: red on black)");

  console.log("blocks, arcs and circles");
  await page.click('[data-rtab="modify"]'); await wait(100);
  await page.click('[data-mod="explode"]'); await wait(100);
  await at(30 + 36 * Math.cos(Math.PI / 4), 36 * Math.sin(Math.PI / 4)); A = await adds();
  const leaf = A.find(o => !o.cv && near(o.len, 36)), swing = A.find(o => o.cv && near(o.len, Math.PI / 2 * 36, 0.005));
  ok(A.length === 2 && leaf && swing, "Explode: block DOOR3 into its leaf (36\") and its swing (a 90° arc r 36 = 56.549\") on their own layer");
  await page.keyboard.press("Escape"); await wait(80);
  await T(() => zdTakeoff.setTool("extend")); await wait(100);
  await at(30 + 36 * Math.cos(80 * Math.PI / 180), 36 * Math.sin(80 * Math.PI / 180)); A = await adds();
  const th = Math.PI - Math.acos(30 / 36), sw2 = A.find(o => o.cv && near(o.len, 36 * th, 0.005));
  ok(sw2 && near(Math.hypot(sw2.b[0] - 30, sw2.b[1]), 36, 0.002) && near(sw2.b[0], 0, 0.002), "Extend an arc: round its own circle to the room's wall at x 0 → 146.44°, 92.013\" (" + (sw2 ? sw2.len.toFixed(4) + " to " + JSON.stringify(sw2.b) : JSON.stringify(A)) + ")");
  await page.click('[data-mod="offset"]'); await wait(200);
  await page.fill("#cedOD", "2"); await page.click("#dlgOk"); await wait(150);
  await at(520, 72); await at(520, 80); await page.keyboard.press("Escape"); await wait(80); A = await adds();
  ok(flat(A, 96, -40, 560), "Offset the CENTER grid line 2'-0\" up → y 96, right across the circle");
  await T(() => zdTakeoff.setTool("trim")); await wait(100);
  await at(300, 124); A = await adds();
  const kept = A.find(o => !o.cl && near(o.len, 24 * (Math.PI - 2 * Math.asin(4 / 24)), 0.005));
  ok(kept && near(kept.a[1], 96, 0.002) && near(kept.b[1], 96, 0.002), "Trim a circle: the part above the line cut away, the 160.81° below kept → 67.361\" (" + (kept ? kept.len.toFixed(4) : JSON.stringify(A.map(o => o.len))) + ")");

  console.log("kept with the project");
  const nA = (await adds()).length, pid = await T(() => zdTakeoff.P.proj.id);
  await T(() => zdTakeoff.flushSave && zdTakeoff.flushSave()); await wait(600);
  await page.reload({waitUntil: "load"}); await wait(800);
  await T(id => { if (!zdTakeoff.P.proj || zdTakeoff.P.proj.id !== id) return zdTakeoff.openProject(id); }, pid);
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files[0]; return F && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo[Z.S.key]; }, null, {timeout: 60000}); await wait(600);
  ok((await adds()).length === nA && await T(() => zdTakeoff.S.edMode === "cad" && document.getElementById("bModeCad").classList.contains("on")), "after a reload the edits are there and AutoCAD mode is still on (" + nA + " edited objects)");
  ok(await T(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key]; return g.edv === Z.cedRec().v; }), "the snapping lines are read with the edits after a reload");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

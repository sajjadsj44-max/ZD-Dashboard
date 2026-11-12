#!/usr/bin/env node
/* Browser test: the beams agent (🏗 Beams) — beam centre lines from the beam layer's two edge lines, as the JADE BOQ backup drawings
   are drawn (Beam Claude.dwg: one layer per width, face to face of columns, walls and beams, a mark per span); the same drawing read
   with no layers at all (a flat PDF, a Revit one), and a page that is a picture (a Revit sheet printed as one) read off its pixels. On a DXF written here:
     three 24" columns at x = 0, 300, 600 (in); beam B1, 15" wide (edges y = ±7.5), over two spans from column face to column face
     (12 → 288, 312 → 588: 276" each), marked once ("B1", under the first span); its top edge broken where B2 frames in;
     beam B2, 12" wide (edges x = 144, 156), from B1's top face (y = 7.5) to a shear wall's face (y = 207): 199.5", marked "B2 (12x18)"
     along it — 18" deep.
     python -m http.server 8765 --bind 127.0.0.1 ; TK_LIBS=/path/with/node_modules node tools/test_takeoff_beams.js   (TK_URL for another port)
   TK_LIBS must hold pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json (as for test_takeoff_cad.js). */
const path = require("path"), fs = require("fs"), pw = require("playwright");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);
const L = (lay, x0, y0, x1, y1) => ["0", "LINE", "8", lay, "10", String(x0), "20", String(y0), "30", "0", "11", String(x1), "21", String(y1), "31", "0"];
const TX = (lay, x, y, h, s, rot) => ["0", "TEXT", "8", lay, "10", String(x), "20", String(y), "30", "0", "40", String(h), "1", s, "50", String(rot || 0)];
const box = (lay, x0, y0, x1, y1) => [...L(lay, x0, y0, x1, y0), ...L(lay, x1, y0, x1, y1), ...L(lay, x1, y1, x0, y1), ...L(lay, x0, y1, x0, y0)];
const ents = [
  ...box("COLUMNS", -12, -12, 12, 12), ...box("COLUMNS", 288, -12, 312, 12), ...box("COLUMNS", 588, -12, 612, 12),
  ...L("S-Beam", 12, -7.5, 288, -7.5), ...L("S-Beam", 312, -7.5, 588, -7.5),                    // B1's bottom edge, both spans
  ...L("S-Beam", 12, 7.5, 144, 7.5), ...L("S-Beam", 156, 7.5, 288, 7.5), ...L("S-Beam", 312, 7.5, 588, 7.5),   // its top edge, broken by B2
  ...L("S-Beam", 144, 7.5, 144, 207), ...L("S-Beam", 156, 7.5, 156, 207),                       // B2
  ...box("SHEAR WALLS", 100, 207, 220, 225), ...[110, 130, 150, 170, 190].flatMap(x => L("HATCH", x, 208, x + 16, 224)),   // the wall, hatched
  ...TX("Text", 130, -32, 9, "B1"), ...TX("Text", 136, 80, 9, "B2 (12x18)", 90),
  ...L("Beam Text", 40, -30, 60, -30),                                                          // a beam layer's text (an underline): not an edge layer
  ...L("BC-CL-W15", 12, 0, 288, 0)];                                                            // a centre line already drawn: never read as an edge
const dxf = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "1", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"].join("\n");
(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "@mlightcad/dxf-json"))) { console.log("TK_LIBS must hold pdfjs-dist, pdf-lib and @mlightcad/* — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    let m = /@mlightcad\/libredwg-web@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/libredwg-web", m[1]), contentType: /\.wasm$/.test(m[1]) ? "application/wasm" : js, headers: H});
    m = /@mlightcad\/dxf-json@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/dxf-json", m[1]), contentType: js, headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  const T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 250);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Beams"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "zd_beams.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf, "utf8")});
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj.files[0]; const web = [...document.querySelectorAll("#dlgBack.on #dlgF button")].find(x => x.textContent === "Read in the browser"); if (web) web.click();
    return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo && Z.S.geo[Z.S.key] && Z.S.geo[Z.S.key].segs.length; }, null, {timeout: 60000}); await wait(800);
  console.log("the drawing's layers");
  const ly = await T(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key], L = Z.beamLayers(g); return L && L.names; });
  ok(ly && ly.join() === "S-Beam", "the beam layer is S-Beam — the centre-line layer BC-CL-W15 and the text layer Beam Text are not edge layers (" + ly + ")");
  console.log("the agent");
  const r = await T(() => zdTakeoff.beamsAgent({page: true}));
  ok(!r.error && r.spans === 3, "3 spans: B1 twice (column face to face), B2 once (" + (r.error || r.spans) + ")");
  ok(r.widths_in && r.widths_in.join() === "15,12", "widths read from the drawing: 15\" and 12\" (" + r.widths_in + ")");
  const its = await T(() => { const Z = zdTakeoff, k = Z.P.proj.scales[Z.S.key].ptPerFt, d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    return Z.P.proj.items.filter(i => i.beamAuto).map(i => { const c = Z.P.proj.conds.find(x => x.id === i.cond); return {mark: i.label, ft: d(i.pts[0], i.pts[1]) / k, cond: c.name, t: c.t, h: c.h, ai: i.ai}; }).sort((a, b) => b.ft - a.ft || a.mark.localeCompare(b.mark)); });
  const B1 = its.filter(i => i.mark === "B1"), B2 = its.find(i => i.mark === "B2");
  ok(B1.length === 2 && B1.every(i => near(i.ft, 23, 0.02)), "B1: two spans of 276\" = 23 ft, from column face to column face, not centre to centre (" + B1.map(i => i.ft.toFixed(3)).join(", ") + ")");
  ok(B1.length === 2, "…the second span, with no mark of its own, takes B1 from the span it continues");
  ok(B2 && near(B2.ft, 16.625, 0.02), "B2: 199.5\" = 16.625 ft, from B1's face to the shear wall's face (" + (B2 && B2.ft.toFixed(3)) + ")");
  ok(B1.every(i => /Beam 15" wide/.test(i.cond) && near(i.t, 1.25, 1e-3)) && B2 && /Beam 12" wide/.test(B2.cond) && near(B2.t, 1, 1e-3), "a condition per width, as the BC-CL-W15 / -W12 layers: Beam 15\" wide, Beam 12\" wide, T = the width");
  ok(B2 && near(+B2.h, 1.5, 1e-6), "the depth from the label B2 (12x18): H 1.5 ft (" + (B2 && B2.h) + ")");
  ok(its.every(i => i.ai), "every span is marked AI, to be checked");
  ok(Math.abs(r.total_length_ft - 62.625) < 0.05, "total 23 + 23 + 16.625 = 62.625 ft (" + r.total_length_ft + ")");
  console.log("again, grouped by mark, and undo");
  const r2 = await T(() => zdTakeoff.beamsAgent({page: true, group: "mark"}));
  const n2 = await T(() => zdTakeoff.P.proj.items.filter(i => i.beamAuto).length), conds2 = r2.conditions.map(c => c.cond).sort();
  ok(n2 === 3, "run again: what it drew before is replaced, not doubled (" + n2 + ")");
  ok(conds2.join("|") === 'B1 — Beam 15" wide (centre line)|B2 — Beam 12" wide (centre line)', "grouped per mark: " + conds2.join(" | "));
  await page.keyboard.press("Escape"); await T(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.mouse.click(700, 450); await page.keyboard.press("Control+z"); await wait(300);
  const n3 = await T(() => zdTakeoff.P.proj.items.filter(i => i.beamAuto && /^B[12] —/.test((zdTakeoff.P.proj.conds.find(c => c.id === i.cond) || {}).name || "")).length);
  ok(n3 === 0, "Ctrl+Z takes the run back in one step (" + n3 + " left)");
  console.log("no layers at all (a PDF plotted flat, or from Revit)");
  const r4 = await T(async () => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key], keep = g.layerIds; g.layerIds = []; try { const r = await Z.beamsAgent({page: true}); const k = Z.P.proj.scales[Z.S.key].ptPerFt;
    return Object.assign(r, {its: Z.P.proj.items.filter(i => i.beamAuto).map(i => ({mark: i.label, ft: Math.hypot(i.pts[1][0] - i.pts[0][0], i.pts[1][1] - i.pts[0][1]) / k, w: i.bw * 12})).sort((a, b) => b.ft - a.ft)}); } finally { g.layerIds = keep; } });
  ok(!r4.error && r4.how === "styles", "with no layers the agent still runs, picking the beams out by their shape (" + (r4.error || r4.how) + ")");
  const f4 = (r4.its || []).map(i => i.mark + " " + i.ft.toFixed(2) + " ft " + i.w.toFixed(1) + "\"").join(", ");
  ok(r4.spans === 3 && r4.its.filter(i => i.mark === "B1" && near(i.ft, 23, 0.02) && near(i.w, 15, 0.01)).length === 2 && r4.its.some(i => i.mark === "B2" && near(i.ft, 16.625, 0.02) && near(i.w, 12, 0.01)),
    "…the same 3 spans: the columns found by their outlines, the hatched wall as a wall, the centre line between B1's edges not an edge (" + f4 + ")");
  console.log("a page that is a picture (a Revit sheet printed as one, a scan)");
  const pic = await T(() => { const Z = zdTakeoff, W = 600, H = 200, g = new Uint8Array(W * H).fill(255), box = (x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * W + x] = v; };
    box(50, 84, 82, 116, 110); box(450, 84, 482, 116, 110);   // two 24" columns, filled grey (4 px a point, 4 pt a foot: 16 px a foot)
    for (const y of [92, 108]) for (let x = 82; x < 450; x++) if ((x - 82) % 12 < 8) g[y * W + x] = 220;   // the beam's edges 12" apart, in light grey dashes (a beam under the slab)
    for (let x = 0; x < W; x++) if (x % 40 < 30 || x % 40 === 34) g[100 * W + x] = 0;   // the grid line down its middle, black dash-dot
    const R = Z.beamPixLines(g, W, H, 4, 16), px = 0.25, k = 4, segs = R.segs.map(s => [s[0] * px, s[1] * px, s[2] * px, s[3] * px, s[4], s[5], s[6]]);
    const src = Z.beamSource({segs, styles: []}, segs.map((_, i) => i), k, [], {tv: 1.5 * px, res: px, skipStyle: si => si % 3 === 2 && si < 9});
    const F = Z.beamCore(src.segs, src.kind, [], k, {loose: true, res: px}); Z.beamSnapW(F.runs, 1.25 * px / k * 12);
    return {boxes: R.boxes, styles: R.segs.filter(s => !(s[4] & 4)).map(s => s[6]).sort(), runs: F.runs.map(r => ({w: r.w * 12, ft: Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / k}))}; });
  ok(pic.boxes === 2, "the picture's two filled columns are read as boxes (" + pic.boxes + ")");
  ok(pic.styles.filter(s => s === 7).length === 2 && pic.styles.every(s => s === 7 || s === 2) && pic.styles.includes(2), "its lines: the two dashed light-grey edges (style 7) and the dash-dot grid line (style 2, in pieces between the columns), which is never an edge (" + pic.styles + ")");
  ok(pic.runs.length === 1 && near(pic.runs[0].w, 12, 1e-6) && near(pic.runs[0].ft, 23, 0.1), "one span, 12\" wide, 23 ft from column face to column face (" + JSON.stringify(pic.runs) + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

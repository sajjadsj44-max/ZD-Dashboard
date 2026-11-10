#!/usr/bin/env node
/* Browser test: the beams agent (🏗 Beams) — beam centre lines from the beam layer's two edge lines, as the JADE BOQ backup drawings
   are drawn (Beam Claude.dwg: one layer per width, face to face of columns, walls and beams, a mark per span). On a DXF written here:
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
  ...box("SHEAR WALLS", 100, 207, 220, 225),
  ...TX("Text", 130, -32, 9, "B1"), ...TX("Text", 136, 80, 9, "B2 (12x18)", 90),
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
  ok(ly && ly.join() === "S-Beam", "the beam layer is S-Beam — the centre-line layer BC-CL-W15 is not an edge layer (" + ly + ")");
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
  console.log("no beam layer");
  const r4 = await T(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key], keep = g.layerIds; g.layerIds = []; const r = Z.beamsAgent({page: true}); g.layerIds = keep; return r; });
  ok(r4.error && /No beam layer/.test(r4.error), "a page with no beam layer says so: " + (r4.error || "").slice(0, 70));
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

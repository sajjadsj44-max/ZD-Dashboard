#!/usr/bin/env node
/* Browser test: the slab agent (▦ Slabs) — a slab's outline on the outer face of its perimeter beams and its openings deducted, as the
   JADE slab backup (06 Slab.dwg) is taken off. On a DXF written here (inches):
     perimeter beam 12" wide: outer face 0,0 – 480,360, inner face 12,12 – 468,348  -> gross 480 × 360 = 1,200 Sft (the outer face)
     beam at x = 234 / 246 (edges) across the slab; beam at y = 174 / 186 from x = 246 to the perimeter
     VOID in the bay 246 – 468 × 186 – 348 (the beams' inner faces), less the column's 6" × 6" corner in it -> 249.75 − 0.25 = 249.5 Sft
     a 24" duct box with its X on DUCTS at 100,100                                    -> 4 Sft
     a lift shaft in 9" shear walls: outer 300 – 380 × 40 – 120, inner 309 – 371 × 49 – 111 -> 62 × 62 = 26.694 Sft (the walls' ring
       itself is not deducted), a column 228 – 252 × 168 – 192 (not deducted), title FIRST FLOOR SLAB, note SLAB THICKNESS = 6"
     net 1,200 − 249.5 − 4 − 26.694 = 919.806 Sft
     python -m http.server 8765 --bind 127.0.0.1 ; TK_LIBS=/path/with/node_modules node tools/test_takeoff_slabs.js   (TK_URL for another port)
   TK_LIBS must hold pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json (as for test_takeoff_cad.js). */
const path = require("path"), fs = require("fs"), pw = require("playwright");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);
const L = (lay, x0, y0, x1, y1) => ["0", "LINE", "8", lay, "10", String(x0), "20", String(y0), "30", "0", "11", String(x1), "21", String(y1), "31", "0"];
const TX = (lay, x, y, h, s) => ["0", "TEXT", "8", lay, "10", String(x), "20", String(y), "30", "0", "40", String(h), "1", s, "50", "0"];
const box = (lay, x0, y0, x1, y1) => [...L(lay, x0, y0, x1, y0), ...L(lay, x1, y0, x1, y1), ...L(lay, x1, y1, x0, y1), ...L(lay, x0, y1, x0, y0)];
const ents = [
  ...box("S-Beam", 0, 0, 480, 360), ...box("S-Beam", 12, 12, 468, 348),
  ...L("S-Beam", 234, 12, 234, 348), ...L("S-Beam", 246, 12, 246, 348), ...L("S-Beam", 246, 174, 468, 174), ...L("S-Beam", 246, 186, 468, 186),
  ...TX("Text", 330, 260, 9, "VOID"),
  ...box("DUCTS", 100, 100, 124, 124), ...L("DUCTS", 100, 100, 124, 124), ...L("DUCTS", 100, 124, 124, 100),
  ...box("SHEAR WALLS", 300, 40, 380, 120), ...box("SHEAR WALLS", 309, 49, 371, 111),
  ...box("COLUMNS", 228, 168, 252, 192),
  ...TX("Text", 120, -40, 12, "BEAMS FRAMING LAYOUT PLAN (FIRST FLOOR SLAB)"), ...TX("Text", 120, -70, 9, 'SLAB THICKNESS = 6"')];
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
  await page.click("#bNewProj"); await page.fill("#dlgName", "Slabs"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "zd_slab.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf, "utf8")});
  await page.waitForFunction(() => { const Z = zdTakeoff, F = Z.P.proj.files[0]; const web = [...document.querySelectorAll("#dlgBack.on #dlgF button")].find(x => x.textContent === "Read in the browser"); if (web) web.click();
    return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id] && Z.S.geo && Z.S.geo[Z.S.key] && Z.S.geo[Z.S.key].segs.length; }, null, {timeout: 60000}); await wait(800);
  console.log("the agent, at the default 2\" grid");
  const r = await T(() => zdTakeoff.slabsAgent({page: true}));
  ok(!r.error && r.slabs === 1, "one slab traced (" + (r.error || r.slabs) + ")");
  const c = r.conditions && r.conditions[0] || {};
  ok(near(r.gross_sft, 1200, 0.05), "gross 1,200 Sft: the outline on the perimeter beam's OUTER face, snapped onto the drawn line (" + r.gross_sft + ")");
  ok(/First Floor Slab 6"/.test(c.cond || "") && c.t_in === 6, "named from its plan title, T from the note: " + c.cond);
  const its = await T(() => { const Z = zdTakeoff, k = Z.P.proj.scales[Z.S.key].ptPerFt, A = P => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 / k / k;
    return Z.P.proj.items.filter(i => i.slabAuto).map(i => ({kind: i.kind, label: i.label, sft: A(i.pts), ai: i.ai})); });
  const ded = its.filter(i => i.kind === "ded"), V = ded.find(i => i.label === "Void"), Du = ded.find(i => i.label === "Duct"), Li = ded.find(i => /Lift/.test(i.label));
  ok(V && near(V.sft, 249.5, 0.2), "the VOID: the bay to the beams' inner faces, 222 × 162 less the column corner in it = 249.5 Sft (" + (V && V.sft.toFixed(3)) + ")");
  ok(Du && near(Du.sft, 4, 0.05), "the duct box with its X: 24 × 24 = 4 Sft — one cut-out, not four triangles (" + (Du && Du.sft.toFixed(3)) + ")");
  ok(Li && near(Li.sft, 26.694, 0.3), "the lift shaft walled in by shear walls: 62 × 62 = 26.694 Sft (" + (Li && Li.sft.toFixed(3)) + ")");
  ok(ded.length === 3, "nothing else deducted — not the column, not the shear walls' own ring (" + ded.map(d => d.label + " " + d.sft.toFixed(1)).join(", ") + ")");
  ok(near(r.net_sft, 919.556, 0.5), "net 1,200 − 249.5 − 4 − 26.694 = 919.806 Sft (" + r.net_sft + ")");
  ok(its.every(i => i.ai), "outline and cut-outs are marked AI, to be checked");
  const q = await T(() => { const Z = zdTakeoff, c2 = Z.P.proj.conds.find(x => /First Floor Slab/.test(x.name)); return {unit: c2.unit, ded: c2.dedMin}; });
  ok(q.unit === "Sft" && q.ded === 0, "an area condition that deducts every opening, however small (dedMin 0)");
  console.log("again: replaced, not doubled; undo");
  await T(() => zdTakeoff.slabsAgent({page: true}));
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.slabAuto).length) === 4, "run again: what it drew before is replaced (4 items)");
  await page.mouse.click(700, 450); await page.keyboard.press("Control+z"); await wait(300);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.slabAuto).length) === 4, "Ctrl+Z takes back the second run only — the first one's 4 items are there");
  console.log("options");
  const r2 = await T(() => zdTakeoff.slabsAgent({page: true, ducts: false, one: true}));
  ok(r2.conditions[0].cond === 'Slab 6"' && r2.openings === 2, "ducts not deducted when unticked; all in one condition: " + r2.conditions[0].cond + ", " + r2.openings + " openings");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

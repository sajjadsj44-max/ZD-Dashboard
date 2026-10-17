#!/usr/bin/env node
/* The takeoff legend's symbols and the perimeter of areas, with known answers (18 pt per ft):
   A. each legend symbol is drawn as its measurements are: an area's fill colour (set apart from its line colour) and its
      outline, a measurement's own colour when all of a condition's share one, a run as a line with its dash, a count as its
      marker — on the sheet's legend and in the exported legend;
   B. the legend's Perimeter column: the outlines of a condition's areas, × Nos, as P in the bill (10 × 12 + 2 × (8 × 5) =
      44 + 52 = 96 ft); a long name shortened with … (the full name on hover); a legend made before keeps its columns;
   C. an area's label shows its perimeter (labels set before this are switched to it once; switched off, it stays off); an
      area drawn, or taken with Auto area, says its area and perimeter;
   D. a legend is kept through Undo and when the project is opened again (both used to drop it), its Properties open.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_legend.js     (pdfjs-dist) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const F = require("./takeoff_trace_fixture");
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; return !!c; };
const LONG = "Ceiling plaster — a condition named far too long to fit its column in the legend";
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "legend"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: F.tracePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await wait(400);
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) { await page.keyboard.press("Escape"); await wait(150); }
  await T(L => { const Z = zdTakeoff, S = Z.S, P = Z.P.proj, f = S.fileId, pg = S.pageNo, X = v => 100 + v * 18;
    P.scales[S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()};
    const box = (x0, y0, x1, y1) => [[X(x0), X(y0)], [X(x1), X(y0)], [X(x1), X(y1)], [X(x0), X(y1)]];
    P.conds.push({id: "A1", name: "Floor finish", type: "area", unit: "Sft", color: "#2563eb", h: "", t: "", faces: 1, dedMin: 0, ap: {fill: "#a3e635", fillOp: 40}},
      {id: "A2", name: L, type: "area", unit: "Sft", color: "#dc2626", h: "", t: "", faces: 1, dedMin: 0},
      {id: "L1", name: "Skirting", type: "linear", unit: "ft", color: "#0891b2", h: "", t: "", faces: 1, dedMin: 0, ap: {dash: "dash"}},
      {id: "N1", name: "Doors", type: "count", unit: "Nos", color: "#f59e0b", sym: "triangle", h: "", t: "", faces: 1, dedMin: 0});
    P.items.push({id: "i1", cond: "A1", file: f, page: pg, kind: "shape", pts: box(0, 0, 10, 12), nos: 1, label: "ROOM 1"},
      {id: "i2", cond: "A1", file: f, page: pg, kind: "shape", pts: box(12, 0, 20, 5), nos: 2, label: "ROOM 2"},
      {id: "i3", cond: "A2", file: f, page: pg, kind: "shape", pts: box(0, 14, 5, 19), nos: 1, label: "", ap: {col: "#16a34a"}},
      {id: "i4", cond: "L1", file: f, page: pg, kind: "shape", pts: [[X(0), X(21)], [X(10), X(21)]], nos: 1, label: ""},
      {id: "i5", cond: "N1", file: f, page: pg, kind: "shape", pts: [[X(25), X(2)], [X(26), X(2)], [X(27), X(2)]], nos: 1, label: ""});
    Z.refresh(); }, LONG);

  console.log("A. the legend's symbols");
  const L = await T(() => { const Z = zdTakeoff; Z.createLegend(); const P = Z.P.proj, m = P.marks[P.marks.length - 1];
    const rows = Z.legendRows(m), svg = Z.legendSvg0(m, p => p, 1), sym = {};
    rows.forEach(r => { sym[r.c.id] = Z.legSym(r.c, r.ap, 0, 0, 40, 12, 1); });   // the symbol each row is drawn with (the same in the exported legend)
    return {cols: m.columns, rows: rows.map(r => ({id: r.c.id, q: +r.q.toFixed(3), per: +r.per.toFixed(3)})), svg, sym}; });
  const sym = id => L.sym[id] || "";
  ok(L.svg.includes('fill="#a3e635"') && L.svg.includes('stroke="#16a34a"') && /<line[^>]*stroke="#0891b2"/.test(L.svg) && /<path d="M[^"]*Z" fill="#f59e0b"/.test(L.svg), "the legend on the sheet draws these symbols");
  ok(/fill="#a3e635" fill-opacity="0\.40"/.test(sym("A1")) && /stroke="#2563eb"/.test(sym("A1")), "Floor finish: its fill colour (#a3e635, 40%) set apart from its line colour (#2563eb), with that outline — not one square of the line colour");
  ok(/stroke="#16a34a"/.test(sym("A2")) && !/#dc2626/.test(sym("A2")), "a condition whose measurements all have their own colour (#16a34a) shows that colour, not the condition's (#dc2626)");
  ok(/<line[^>]*stroke="#0891b2"[^>]*stroke-dasharray/.test(sym("L1")) && !/<rect[^>]*fill="#0891b2"/.test(sym("L1")), "Skirting (a length): a dashed line, not a filled square");
  ok(/<path d="M[^"]*Z" fill="#f59e0b"/.test(sym("N1")), "Doors (a count): its triangle marker");

  console.log("B. the Perimeter column");
  const R = Object.fromEntries(L.rows.map(r => [r.id, r]));
  ok(L.cols.includes("perim"), "a new legend has a Perimeter column (" + L.cols.join(", ") + ")");
  ok(R.A1 && R.A1.q === 200 && R.A1.per === 96, "Floor finish: 200 Sft, perimeter 96 ft = 44 + 2 × 26 (" + JSON.stringify(R.A1) + ")");
  ok(R.A2 && R.A2.per === 20 && R.L1 && R.L1.per === 0, "the 5 × 5 ceiling 20 ft; Skirting has none (" + JSON.stringify([R.A2, R.L1]) + ")");
  ok(/>Perimeter</.test(L.svg) && /text-anchor="end"[^>]*>96\.000 ft</.test(L.svg) && /text-anchor="end"[^>]*>20\.000 ft</.test(L.svg), "…shown as 96.000 ft and 20.000 ft");
  ok(/<title>Ceiling plaster — a condition named far too long[^<]*<\/title><text[^>]*>[^<]*…</.test(L.svg), "a long name is shortened with … and kept whole on hover");
  const old = await T(() => { const Z = zdTakeoff, P = Z.P.proj, m = Object.assign({}, P.marks[P.marks.length - 1], {columns: ["symbol", "description", "unit", "qty"], colWidths: [.11, .31, .11, .16]}); return Z.legendSvg0(m, p => p, 1); });
  ok(!/Perimeter/.test(old) && /Floor finish/.test(old), "a legend made before keeps its own columns (Perimeter is ticked in Edit Legend)");
  const ex = await T(() => { const Z = zdTakeoff, S = Z.S; return Z.pageOverlaySvg(S.fileId, S.pageNo, 1, 900, 700, {legend: "tl", lcols: ["qty", "unit", "per"], stamp: false}); });
  ok(/>Perimeter</.test(ex) && />96\.000 ft</.test(ex) && /fill="#a3e635"/.test(ex) && /<line[^>]*stroke="#0891b2"/.test(ex), "the exported legend: the same symbols and a Perimeter column (96.000 ft)");

  console.log("C. an area's perimeter on its label and as it is taken");
  const cap = await T(() => { const Z = zdTakeoff, P = Z.P.proj; return Z.capLines(P.items.find(i => i.id === "i1"), P.conds.find(c => c.id === "A1"), 18); });
  ok(cap.includes("P 44.000 ft") && cap.some(t => /120\.000 Sft/.test(t)), "ROOM 1's label: 120.000 Sft and P (its perimeter) 44.000 ft (" + cap.join(" / ") + ")");
  const cap2 = await T(() => { const Z = zdTakeoff, P = Z.P.proj; return Z.capLines(P.items.find(i => i.id === "i2"), P.conds.find(c => c.id === "A1"), 18); });
  ok(cap2.includes("P 26.000 ft × 2") && cap2.some(t => /80\.000 Sft/.test(t)), "ROOM 2 (Nos 2): 80.000 Sft and P 26.000 ft × 2 (" + cap2.join(" / ") + ")");
  const mig = await T(() => { const Z = zdTakeoff, k = "zdTakeoffLbl", keep = localStorage.getItem(k), out = {};
    localStorage.setItem(k, JSON.stringify({on: true, name: true, qty: true, area: false, perim: false, len: true}));
    Z.loadLbl(); out.before = Z.S.lbl.perim; localStorage.setItem(k, JSON.stringify(Object.assign({}, Z.S.lbl, {perim: false})));
    Z.loadLbl(); out.off = Z.S.lbl.perim; if (keep == null) localStorage.removeItem(k); else localStorage.setItem(k, keep); Z.loadLbl(); return out; });
  ok(mig.before === true && mig.off === false, "labels set before: the perimeter switched on once; switched off again, it stays off (" + JSON.stringify(mig) + ")");
  const drawn = await T(async () => { const Z = zdTakeoff, X = v => 100 + v * 18; Z.S.cond = "A1"; Z.setTool("draw");
    await Z.finishDraft([[X(22), X(6)], [X(28), X(6)], [X(28), X(10)], [X(22), X(10)]]); return document.getElementById("toast").textContent; });
  ok(/24\.000 Sft · perimeter 20\.000 ft/.test(drawn), "an area drawn (6 × 4) says 24.000 Sft · perimeter 20.000 ft (" + drawn + ")");
  const au = await T(async p => { const Z = zdTakeoff; Z.S.cond = "A2"; Z.setTool("select"); await Z.autoAt(p); return document.getElementById("toast").textContent; }, F.at.lounge);
  ok(/123\.141 Sft · perimeter 45\.500 ft/.test(au), "Auto area in the lounge (13'-10½\" × 8'-10½\") says 123.141 Sft · perimeter 45.500 ft (" + au.slice(0, 120) + ")");
  console.log("D. a legend is kept");
  const D = await T(async () => { const Z = zdTakeoff, n = () => (Z.P.proj.marks || []).filter(m => m.type === "legend").length, out = {};
    Z.createLegend(); out.two = n(); await new Promise(r => setTimeout(r, 200)); out.props = /Edit legend…/.test(document.getElementById("props").textContent);   // (the legend just placed is selected)
    Z.undoAny(); out.undo = n(); await Z.flushSave(); await Z.openProject(Z.P.proj.id); await new Promise(r => setTimeout(r, 800)); out.reopen = n();
    const bad = {marks: [{id: "m1", type: "legend", file: "f", page: 1, pts: [[0, 0], [100, 80]], border: 'red"/><script>alert(1)</script>', fill: "#ffffff"}]}, rep = []; Z.migrate(bad, rep);
    out.kept = bad.marks.length === 1 && bad.marks[0].border === undefined && bad.marks[0].fill === "#ffffff"; out.rep = rep.join("; "); return out; });
  ok(D.props, "selected, the legend's Properties show Edit legend… (it used to fail with an error)");
  ok(D.two === 2 && D.undo === 1, "with two legends one Undo takes back only the last (" + D.two + " → " + D.undo + "; it used to drop every legend)");
  ok(D.reopen === 1, "the legend is kept when the project is opened again (" + D.reopen + ")");
  ok(D.kept && /not a colour/.test(D.rep), "a legend in a project file keeps its place; a colour that is not a colour is reset, never written into the drawing (" + D.rep + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

#!/usr/bin/env node
/* Browser test for PDF Takeoff quantities that disagreed between views (review of 17-Nov-2026):
   a wall in ft with H / T takes each opening off at its own height (bill, wall area, volume, legend, panel, materials);
   counts on a page with no scale count everywhere (bill, legend Nos, sheet); a cut-out's threshold is for each one, not Nos × it;
   a sloped area's A and volume are along the slope; a near-rectangle is L × W only when that is its area; a circle's area and
   perimeter are exact in the panel and legend; an opening by its schedule width; the Excel total of a condition with no row is 0.
     python -m http.server 8765 --bind 127.0.0.1      # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_qtyfix.js      (TK_URL for another port) */
const path = require("path");
const pw = require("playwright");
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-3 : e);
(async () => {
  if (!LIBS) { console.log("TK_LIBS needed"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  const T = (f, a) => page.evaluate(f, a);
  await T(() => document.getElementById("bProjects").click()); await page.waitForTimeout(400);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Qty fixes"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000});
  const R = await T(() => {
    const Z = zdTakeoff, P = Z.P, f = Z.S.fileId, key = f + ":1", out = {};
    P.proj.scales[key] = {ptPerFt: 10, how: "calibrated", verified: true}; delete P.proj.scales[f + ":3"];
    let n = 0; const C = o => { const c = Object.assign({id: "C" + (++n), name: "c" + n, type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0}, o); P.proj.conds.push(c); return c; };
    const I = o => { const it = Object.assign({id: "I" + (++n), file: f, page: 1, kind: "shape", nos: 1, label: ""}, o); P.proj.items.push(it); return it; };
    const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    // a 20 ft wall, H 10, T 0.75, one door 3 ft × 7 ft — in ft, cft and Sft (2 faces)
    const cw = C({name: "Wall ft", type: "linear", unit: "ft", h: 10, t: 0.75}), cc = C({name: "Wall cft", type: "linear", unit: "cft", h: 10, t: 0.75}), cs = C({name: "Plaster Sft", type: "linear", unit: "Sft", h: 10, t: 0.05, faces: 2});
    [[cw, 300], [cc, 320], [cs, 340]].forEach(([c, y]) => { I({cond: c.id, pts: [[100, y], [300, y]]}); I({cond: c.id, kind: "open", pts: [[150, y], [180, y]], oh: 7}); });
    const cn = C({name: "Wall no door height", type: "linear", unit: "ft", h: 10, t: 0.75}); I({cond: cn.id, pts: [[100, 360], [300, 360]]}); I({cond: cn.id, kind: "open", pts: [[150, 360], [180, 360]]});
    Z.refresh();
    const BL = Z.billLines();
    out.wall = {bill: BL.find(l => l.c === cw).qty, billU: BL.find(l => l.c === cw).unit, cft: Z.condTotals(cc).net, sft: Z.condTotals(cs).net, area: Z.condQ(cw, "area").v, vol: Z.condQ(cw, "vol").v, sftVol: Z.condQ(cs, "vol").v,
      noH: Z.condQ(cn, "vol").v, panel: Z.condTotalsList(cw, P.proj.items.filter(i => i.cond === cw.id)).map(r => r.join(": ")).join(" | ")};
    const mc = Object.assign(cw, {mat: {kind: "brick", mix: "1:4"}});
    out.wall.mat = (Z.matFor(P.proj.items.filter(i => i.cond === cw.id)).find(o => o.c === mc) || {r: {}}).r.basis || "";
    delete cw.mat;
    const lr = Z.legendRows({scope: "all", sort: "list"});
    const wr = (lr || []).find(r => r.c === cw);
    out.wall.legArea = wr ? Z.legVal({id: "area"}, wr, {}).v : null; out.wall.legVol = wr ? Z.legVal({id: "volume"}, wr, {}).v : null;
    // 5 lights on a page with no scale
    const cl = C({name: "Lights", type: "count", unit: "Nos"}); I({cond: cl.id, page: 3, pts: [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]]}); Z.refresh();
    out.count = {tot: Z.condTotals(cl).net, bill: Z.billLines().find(l => l.c === cl).qty, N: Z.condVars(cl).N};
    Z.renderSheet(); out.count.sheet = document.getElementById("sheet").innerText; out.count.warn = document.getElementById("warnbar").innerText;
    // a 0.5 Sft void × 3 under a 1 Sft threshold
    const ca = C({name: "Floor", type: "area", unit: "Sft", dedMin: 1}); I({cond: ca.id, pts: rect(400, 100, 100, 100)}); I({cond: ca.id, kind: "ded", nos: 3, pts: rect(420, 120, 5, 10)}); Z.refresh();
    out.ded = {net: Z.condTotals(ca).net, panel: Z.condTotalsList(ca, P.proj.items.filter(i => i.cond === ca.id)).map(r => r.join(": ")).join(" | ")};
    // a 10 × 10 slab at 4:12, T 0.5
    const p = 4 / 12, rs = C({name: "Slab Sft", type: "area", unit: "Sft", t: 0.5, pitch: p}), rc = C({name: "Slab cft", type: "area", unit: "cft", t: 0.5, pitch: p});
    I({cond: rs.id, pts: rect(600, 100, 100, 100)}); I({cond: rc.id, pts: rect(600, 250, 100, 100)}); Z.refresh();
    out.slope = {q: Z.condTotals(rs).net, vol: Z.condQ(rs, "vol").v, cft: Z.condTotals(rc).net, area: Z.condQ(rc, "sarea").v};
    // a 200 × 200 ft outline with a 4" step over 20 ft
    P.proj.scales[key].ptPerFt = 1; const j = I({cond: ca.id, pts: [[0, 0], [200, 0], [200, 180], [199.667, 180], [199.667, 200], [0, 200]]}); Z.refresh();
    out.jog = Z.rowsOf(j, 1)[0]; P.proj.items = P.proj.items.filter(i => i !== j); P.proj.scales[key].ptPerFt = 10;
    // a circle 20 ft across; an opening with a schedule width of 4 ft drawn 3 ft
    const ck = C({name: "Tank", type: "area", unit: "Sft"}); I({cond: ck.id, shape: "circle", pts: [[500, 500], [600, 500]]}); Z.refresh();
    out.circle = {q: Z.condTotals(ck).net, panel: Z.condTotalsList(ck, P.proj.items.filter(i => i.cond === ck.id)).map(r => r.join(": ")).join(" | ")};
    return out;
  });
  console.log("a wall with a door 3 × 7 ft in a 20 ft run, H 10, T 0.75");
  ok(near(R.wall.bill, 134.25) && R.wall.billU === "cft", "a wall in ft bills its volume less the door at its own height: 20 × 10 × 0.75 − 3 × 7 × 0.75 = 134.25 cft (" + R.wall.bill + " " + R.wall.billU + ")");
  ok(near(R.wall.cft, 134.25) && near(R.wall.vol, 134.25), "…the same as the wall measured in cft (" + R.wall.cft + ", " + R.wall.vol + ")");
  ok(near(R.wall.area, 179), "its wall area: 200 − 21 = 179 Sft (" + R.wall.area + ")");
  ok(near(R.wall.sft, 358) && near(R.wall.sftVol, 179 * 0.05), "a 2-face finish in Sft: 2 × 179 = 358 Sft, its volume one face × T (" + R.wall.sft + ", " + R.wall.sftVol + ")");
  ok(near(R.wall.noH, 127.5), "an opening with no height given still goes off at the wall's height, as before (" + R.wall.noH + ")");
  ok(/Wall area \(× H, less openings\): 179\.000/.test(R.wall.panel) && /Volume \(× H × T, less openings\): 134\.250/.test(R.wall.panel), "the condition panel shows the same (" + R.wall.panel + ")");
  ok(/= 134\.250 cft/.test(R.wall.mat) && /openings at their own height/.test(R.wall.mat), "the materials work on the same volume (" + R.wall.mat + ")");
  ok(near(R.wall.legArea, 179) && near(R.wall.legVol, 134.25), "the legend's wall area / volume too (" + R.wall.legArea + ", " + R.wall.legVol + ")");
  console.log("counts on a page with no scale");
  ok(R.count.tot === 5 && R.count.bill === 5 && R.count.N === 5, "5 lights: totals, bill and Nos all 5 (" + [R.count.tot, R.count.bill, R.count.N].join(", ") + ")");
  ok(!/scale not set/.test(R.count.sheet.split("Lights")[1] || "") && !/left out of the totals/.test(R.count.warn), "the sheet lists them and no warning says they are left out");
  console.log("cut-outs, slopes, outlines, circles");
  ok(near(R.ded.net, 100) && !/Deducted/.test(R.ded.panel), "3 voids of 0.5 Sft under a 1 Sft threshold: each is under it — none taken off, the panel agrees (" + R.ded.net + ")");
  ok(near(R.slope.q, 105.409, 0.01) && near(R.slope.vol, 52.705, 0.01) && near(R.slope.cft, 52.705, 0.01) && near(R.slope.area, 105.409, 0.01), "a slab at 4:12: area and volume along the slope whatever its unit (" + [R.slope.q, R.slope.vol, R.slope.cft, R.slope.area].join(", ") + ")");
  ok(R.jog.how === "poly" && near(R.jog.qty, 39993.4, 0.1), "a 200 ft outline with a 4\" step is measured as drawn, not squared off (" + R.jog.how + " " + R.jog.qty + ")");
  ok(/Area: 314\.159/.test(R.circle.panel) && /Perimeter: 62\.832/.test(R.circle.panel), "a circle 20 ft across: 314.159 Sft and 62.832 ft in the panel (" + R.circle.panel + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

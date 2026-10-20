#!/usr/bin/env node
/* Accuracy and reconciliation test of the PDF Takeoff against a floor plan with known quantities
   (tools/takeoff_apartment_fixture.js: two bed rooms, two washrooms, a T-shaped corridor, living, kitchen, store; 9" outer walls
   and 4.5" partitions meeting at L and T junctions; doors, windows, furniture) drawn on three pages at 1/4" = 1'-0", 1:100 and
   1/8" = 1'-0" (the last with /Rotate 90).

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_accuracy.js      (pdfjs-dist, exceljs)
     TK_REPORT=out.json …                               # every check with reference, result, error and tolerance

   Checked on every page: the scale read from the note; each room's Auto-area outline (area, perimeter, corners square, no
   extra points) against the reference outline; the walls agent's centre-line length per thickness; door / window tags; the
   measurement sheet against the outline it was worked from. On p.1: the same quantities zoomed in and out, after save and
   reload, and after export → import. The tolerances are fixed here, before the run, and are not widened to pass. */
const path = require("path"), fs = require("fs");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const A = require("./takeoff_apartment_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const TOL = {scale: 0.1, area: 0.5, perim: 0.5, wall: 0.5, zoom: 0.05, sheet: 0.01, reload: 1e-6};   // % (scale, area, perimeter, wall, zoom) or absolute (sheet Sft, reload)
const rows = []; let fails = 0, passes = 0;
function ok(cond, msg, rec){ if (cond) passes++; else fails++; console.log((cond ? "  ✓ " : "  ✗ ") + msg); rows.push(Object.assign({check: msg, pass: !!cond}, rec || {})); }
/* a quantity against its reference: absolute and % error, within tol % (or tolAbs) */
function cmp(what, ref, got, tolPct, unit, tolAbs){
  const abs = got == null || !isFinite(got) ? null : got - ref, pct = abs == null || !ref ? null : 100 * abs / ref;
  const pass = abs != null && (tolAbs != null ? Math.abs(abs) <= tolAbs : Math.abs(pct) <= tolPct);
  ok(pass, `${what}: ref ${fmt(ref)} ${unit}, got ${got == null ? "—" : fmt(got)} ${unit}` + (abs == null ? "" : ` (${abs >= 0 ? "+" : ""}${fmt(abs)}${pct == null ? "" : ", " + (pct >= 0 ? "+" : "") + pct.toFixed(3) + " %"})`),
    {ref, got, abs_err: abs, pct_err: pct, tol: tolAbs != null ? tolAbs + " " + unit : "±" + tolPct + " %", unit});
  return pass;
}
const fmt = v => (Math.round(v * 1000) / 1000).toFixed(3);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  await ctx.route(/anthropic\.com|openai\.com|claude\.ai/, r => r.abort());
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Accuracy"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "apartment.pdf", mimeType: "application/pdf", buffer: A.pdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await wait(400);
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  const fileId = await T(() => zdTakeoff.S.fileId), areaCond = await T(() => zdTakeoff.S.cond);
  const helper = () => T(() => { window.__q = it => { const Z = zdTakeoff, k = Z.scaleAt ? Z.scaleAt(it.file, it.page, it.pts[0]) : (Z.P.proj.scales[it.file + ":" + it.page] || {}).ptPerFt;   // the sheet's quantity of one measurement
    return k ? Z.rowsOf(it, k).reduce((a, r) => a + r.qty, 0) : null; }; });
  await helper();
  const go = async n => { await T(([f, p]) => zdTakeoff.gotoPage(f, p), [fileId, n]); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key], n, {timeout: 30000}); await wait(300); };
  /* Auto area from a room's seed (plan ft → PDF point → the page's base viewport); the outline in ft back in plan axes */
  const trace = (i, nm) => T(async ([seedPdf, nm]) => {
    const Z = zdTakeoff, S = Z.S, k = (Z.scaleAt ? Z.scaleAt(S.fileId, S.pageNo) : (Z.P.proj.scales[S.key] || {}).ptPerFt);
    const o = await Z.autoRoomGuarded(S.base.convertToViewportPoint(seedPdf[0], seedPdf[1]));
    if (!o || !o.pts) return {err: o && o.err || "no outline", name: nm};
    const pts = o.pts, n = pts.length, area = Math.abs(pts.reduce((a, p, j) => { const q = pts[(j + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 / k / k;
    const per = pts.reduce((a, p, j) => a + Math.hypot(pts[(j + 1) % n][0] - p[0], pts[(j + 1) % n][1] - p[1]), 0) / k;
    // corners: the turn at each point (degrees off 90 / 180), on the outline as stored
    const ang = pts.map((p, j) => { const a = pts[(j + n - 1) % n], b = pts[(j + 1) % n], u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
      const t = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI); return Math.min(Math.abs(t - 90), Math.abs(t), Math.abs(t - 180)); });
    return {area, per, n, worstCorner: Math.max(...ang), leak: o.leak || "", warn: o.warn || o.short || "", k};
  }, [A.toPdf(i, ...A.seedOf(nm)), nm]);

  for (let i = 0; i < A.PAGES.length; i++) {
    const g = A.PAGES[i], pn = i + 1; await go(pn);
    console.log(`\np.${pn} — SCALE ${g.note}${g.rotate ? ", /Rotate " + g.rotate : ""} (${g.k.toFixed(4)} pt per ft)`);
    const sc = await T(() => { const Z = zdTakeoff; return {k: Z.scaleAt ? Z.scaleAt(Z.S.fileId, Z.S.pageNo) : (Z.P.proj.scales[Z.S.key] || {}).ptPerFt, st: Z.scaleState(Z.P.proj.scales[Z.S.key]), how: (Z.P.proj.scales[Z.S.key] || {}).how}; });
    cmp(`p.${pn} scale from the note (pt per ft)`, g.k, sc.k, TOL.scale, "pt/ft");
    ok(sc.st && !/verified/i.test(String(sc.st.label || sc.st)) || (sc.st && /not verified|note/i.test(JSON.stringify(sc.st))), `p.${pn} a scale read from the note is not shown as verified (${JSON.stringify(sc.st)})`);
    let tot = 0;
    for (const [nm] of A.ROOMS) {
      const ref = A.REF.rooms[nm], r = await trace(i, nm);
      if (r.err) { ok(false, `p.${pn} ${nm}: Auto area failed — ${r.err}`, {ref: ref.area, got: null, unit: "Sft"}); continue; }
      tot += r.area;
      cmp(`p.${pn} ${nm} area`, ref.area, r.area, TOL.area, "Sft");
      cmp(`p.${pn} ${nm} perimeter`, ref.perim, r.per, TOL.perim, "ft");
      const refN = A.ROOMS.find(q => q[0] === nm)[1].length;
      ok(r.n === refN, `p.${pn} ${nm} outline has ${refN} corners (got ${r.n})`, {ref: refN, got: r.n});
      ok(r.worstCorner < 0.5, `p.${pn} ${nm} corners square (worst ${r.worstCorner.toFixed(2)}° off 90°)`, {ref: 0, got: r.worstCorner, unit: "deg"});
      if (r.leak || r.warn) console.log(`     note: ${nm}: ${r.leak || r.warn}`);
    }
    cmp(`p.${pn} total floor area (8 rooms)`, Object.values(A.REF.rooms).reduce((a, r) => a + r.area, 0), tot, TOL.area, "Sft");
    for (const [t, ref, nm] of [[0.75, A.REF.wall9, '9" outer walls'], [0.375, A.REF.wall4, '4.5" partitions']]) {
      const w = await T(t => zdTakeoff.wallsAgent({t, page: true, bridge: 6}), t);
      if (w.error) { ok(false, `p.${pn} ${nm}: walls agent — ${w.error}`, {ref, got: null, unit: "ft"}); continue; }
      cmp(`p.${pn} ${nm} centre line`, ref, w.total_length_ft, TOL.wall, "ft");
      const sheet = await T(c => { const Z = zdTakeoff, its = Z.P.proj.items.filter(x => x.wallAuto && x.cond === c && x.page === Z.S.pageNo); return its.reduce((a, it) => a + (__q(it) || 0), 0); }, await T(() => zdTakeoff.S.cond));
      cmp(`p.${pn} ${nm} on the sheet = the agent's total`, w.total_length_ft, sheet, null, "ft", TOL.sheet + 0.005);
    }
    const tags = await T(() => zdTakeoff.aiRunTool({name: "count_tags", input: {what: "all", scope: "page"}})), cnt = tags && tags.ok && tags.ok.counts;   // the agents' own tool (no picture of the view needed)
    for (const [tag, n] of Object.entries(Object.assign({}, A.REF.doors, A.REF.windows))) {
      const got = cnt && cnt[tag] != null ? +cnt[tag] : null;
      ok(got === n, `p.${pn} tag ${tag}: ${n} (got ${got})`, {ref: n, got, unit: "Nos"});
    }
    if (pn === 1 && process.env.TK_DEBUG) console.log("count_tags →", JSON.stringify(tags).slice(0, 600));
  }

  console.log("\np.1 — the same quantities zoomed out and in");
  await go(1);
  const base = {};
  for (const nm of ["BED ROOM 1", "CORRIDOR", "LIVING"]) base[nm] = (await trace(0, nm)).area;
  base.w4 = (await T(() => zdTakeoff.wallsAgent({t: 0.375, page: true, bridge: 6}))).total_length_ft;
  for (const z of [0.3, 3]) {
    await T(z => { const Z = zdTakeoff, S = Z.S; S.view.s = z; Z.refresh(); }, z); await wait(600);
    for (const nm of Object.keys(base).filter(x => x !== "w4")) cmp(`zoom ${z}: ${nm} area`, base[nm], (await trace(0, nm)).area, TOL.zoom, "Sft");
    cmp(`zoom ${z}: 4.5" partitions`, base.w4, (await T(() => zdTakeoff.wallsAgent({t: 0.375, page: true, bridge: 6}))).total_length_ft, TOL.zoom, "ft");
  }
  await T(() => zdTakeoff.fitWidth && zdTakeoff.fitWidth()); await wait(300);

  console.log("\np.1 — the agent measures every room; the sheet against the outlines");
  await T(() => { const Z = zdTakeoff, S = Z.S; Z.P.proj.items = Z.P.proj.items.filter(i => !(i.page === S.pageNo && i.kind === "shape" && !i.wallAuto)); });
  await T(c => { zdTakeoff.S.cond = c; }, areaCond);
  const ag = await T(() => zdTakeoff.aiRunTool({name: "auto_area_page", input: {review: false}}));
  const agRooms = ag.ok ? ag.ok.rooms : [];
  ok(ag.ok && ag.ok.added === A.ROOMS.length, `auto_area_page added ${A.ROOMS.length} rooms (got ${ag.ok ? ag.ok.added : ag.err})`, {ref: A.ROOMS.length, got: ag.ok ? ag.ok.added : null});
  for (const [nm] of A.ROOMS) { const r = agRooms.find(x => x.name.toUpperCase() === nm); if (r) cmp(`agent ${nm}`, A.REF.rooms[nm].area, r.net_sft, TOL.area, "Sft"); else ok(false, `agent ${nm}: not in the result`); }
  const sheetChk = await T(() => { const Z = zdTakeoff, S = Z.S; return Z.P.proj.items.filter(i => i.page === S.pageNo && i.file === S.fileId && i.kind === "shape").map(it => {
    const k = Z.scaleAt ? Z.scaleAt(it.file, it.page, it.pts[0]) : (Z.P.proj.scales[it.file + ":" + it.page] || {}).ptPerFt, n = it.pts.length, c = Z.P.proj.conds.find(x => x.id === it.cond);
    const geo = c.type === "area" ? Math.abs(it.pts.reduce((a, p, j) => { const q = it.pts[(j + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 / k / k
      : it.pts.slice(1).reduce((a, p, j) => a + Math.hypot(p[0] - it.pts[j][0], p[1] - it.pts[j][1]), 0) / k;
    return {label: it.label, unit: c.unit, geo, sheet: __q(it)}; }); });
  const worst = sheetChk.reduce((m, x) => Math.max(m, Math.abs(x.sheet - x.geo)), 0);
  ok(sheetChk.length && worst <= TOL.sheet + 0.005, `every measurement's sheet quantity = its outline on the drawing (${sheetChk.length} measurements, worst ${worst.toFixed(4)})`, {ref: 0, got: worst, tol: TOL.sheet + 0.005});

  console.log("\nsave, reload, export → import");
  const snap = () => T(() => { const Z = zdTakeoff; return Z.P.proj.items.map(it => [it.id, __q(it)]).sort(); });
  const before = await snap(); await T(() => zdTakeoff.flushSave ? zdTakeoff.flushSave() : zdTakeoff.save()); await wait(600);
  await page.reload(); await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.P.proj.items.length, null, {timeout: 30000}); await wait(1200); await helper();
  const after = await snap(), diff = before.filter(([id, q]) => { const a = after.find(x => x[0] === id); return !a || Math.abs((a[1] || 0) - (q || 0)) > TOL.reload; });
  ok(after.length === before.length && !diff.length, `after reload: ${after.length} of ${before.length} measurements, ${diff.length} changed`, {ref: before.length, got: after.length});
  const json = await T(() => JSON.stringify(zdTakeoff.P.proj));
  const imp = await T(async j => { await zdTakeoff.importProject(JSON.stringify(Object.assign({format: "zd-takeoff", exported: new Date().toISOString()}, JSON.parse(j)))); return true; }, json).catch(e => "import threw: " + e.message);
  await wait(1200);
  const imported = await T(() => { const Z = zdTakeoff; return {name: Z.P.proj.name, n: Z.P.proj.items.length, q: Z.P.proj.items.map(it => [it.id, __q(it)]).sort()}; });
  const qs = a => a.map(x => x[1] || 0).sort((u, v) => u - v), bq = qs(before), iq = qs(imported.q);   // ids may be renewed on import: compare the quantities
  const idiff = iq.filter((q, j) => Math.abs(q - (bq[j] || 0)) > TOL.reload);
  ok(imp === true && imported.n === before.length && !idiff.length, `export → import: ${imported.n} measurements, ${idiff.length} quantities changed (${typeof imp === "string" ? imp : "imported"})`, {ref: before.length, got: imported.n});

  console.log("\nrooms drawn turned 3°, 8°, 12° and 30° (12 × 14 = 168 Sft): squared to their own walls, not to the page");
  await page.setInputFiles("#fileIn", {name: "turned.pdf", mimeType: "application/pdf", buffer: A.turnedPdf()}); await wait(1500);
  const turnedId = await T(() => zdTakeoff.P.proj.files.find(f => /turned/.test(f.name)).id);
  for (let i = 0; i < A.TURNED.length; i++) {
    await T(([f, p]) => zdTakeoff.gotoPage(f, p), [turnedId, i + 1]); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key], i + 1, {timeout: 30000}); await wait(300);
    const r = await T(async () => { const Z = zdTakeoff, S = Z.S, o = await Z.autoRoomGuarded(S.base.convertToViewportPoint(600, 380)), k = (Z.P.proj.scales[S.key] || {}).ptPerFt;
      if (!o.pts) return {err: o.err}; const n = o.pts.length, a = Math.abs(o.pts.reduce((s, p, j) => { const q = o.pts[(j + 1) % n]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 / k / k; return {a, n, k, warn: o.warn || o.short || ""}; });
    cmp(`turned ${A.TURNED[i]}°: area (scale from the note ${r.k} pt/ft)`, 168, r.a, TOL.area, "Sft");
    ok(r.n === 4 && !r.warn, `turned ${A.TURNED[i]}°: 4 corners, no warning (got ${r.n}${r.warn ? ", " + r.warn : ""})`, {ref: 4, got: r.n});
  }
  await go(1);

  console.log("\nscale rules: notes, viewports, counts with no scale, review status");
  const notes = await T(() => [`3/4" = 1'-6"`, `1/4" = 1'-0"`, `1-1/2" = 1'-0"`, `1/8"=1'0"`, `1" = 20'`, "SCALE 1:100", "1:12", "1:12 RAMP", "RAMP SLOPE 1:12", "1:50", "SCALE 1:12"].map(s => [s, zdTakeoff.inPerFtOf(s).v]));
  const want = {[`3/4" = 1'-6"`]: 0.5, [`1/4" = 1'-0"`]: 0.25, [`1-1/2" = 1'-0"`]: 1.5, [`1/8"=1'0"`]: 0.125, [`1" = 20'`]: 0.05, "SCALE 1:100": 0.12, "1:12": 0, "1:12 RAMP": 0, "RAMP SLOPE 1:12": 0, "1:50": 0.24, "SCALE 1:12": 1};
  notes.forEach(([s, v]) => ok(Math.abs(v - want[s]) < 1e-9, `scale note “${s}” → ${want[s]} in per ft (got ${v})${want[s] === 0 ? " — not a scale" : ""}`, {ref: want[s], got: v, unit: "in/ft"}));
  await go(1);
  const vp = await T(() => { const Z = zdTakeoff, S = Z.S, P = Z.P.proj, k = S.key, A = {id: "Vout", name: "Detail outer", r: [100, 100, 900, 900], ptPerFt: 9}, B = {id: "Vin", name: "Detail A", r: [200, 200, 400, 400], ptPerFt: 36}, C = {id: "Vnone", name: "Detail B (not calibrated)", r: [1500, 1200, 1800, 1500], ptPerFt: 0};
    P.viewports = P.viewports || {}; P.viewports[k] = [A, B, C];
    const ac = P.conds.find(c => c.type === "area"), sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
    P.items.push({id: "Tin", cond: ac.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: sq(250, 250, 36), nos: 1, label: "in detail A"}, {id: "Tnone", cond: ac.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: sq(1550, 1250, 18), nos: 1, label: "in detail B"});
    const q = id => Z.qtyOf(P.items.find(i => i.id === id)), r = {inner: Z.scaleAt(S.fileId, S.pageNo, [300, 300]), outer: Z.scaleAt(S.fileId, S.pageNo, [600, 600]), none: Z.scaleAt(S.fileId, S.pageNo, [1600, 1300]), page: Z.scaleAt(S.fileId, S.pageNo, [2000, 100]),
      qin: q("Tin"), qnone: q("Tnone"), stNone: Z.reviewStatus(P.items.find(i => i.id === "Tnone")).t, noScale: Z.condTotals(ac).noScale};
    P.viewports[k] = []; P.items = P.items.filter(i => !["Tin", "Tnone"].includes(i.id)); return r; });
  ok(vp.inner === 36 && vp.outer === 9, `nested viewports: the innermost one's scale wins (36 inside detail A, 9 in the outer one; got ${vp.inner}, ${vp.outer})`);
  ok(vp.none === 0 && vp.page === 18, `a viewport not yet calibrated has no scale (got ${vp.none}) — never the page's (18 outside it, got ${vp.page})`);
  cmp("a 36 pt square in detail A (36 pt per ft) is 1 Sft", 1, vp.qin, null, "Sft", 1e-9);
  ok(vp.qnone === null && vp.noScale >= 1 && vp.stNone === "Needs calibration", `a measurement in the uncalibrated viewport: no quantity, out of the totals, “Needs calibration” (got ${vp.qnone}, ${vp.stNone})`);
  const cs = await T(() => { const Z = zdTakeoff, S = Z.S, P = Z.P.proj, k = S.key, keep = P.scales[k]; delete P.scales[k];
    const c = {id: "Ccnt", name: "Test count", type: "count", unit: "Nos", color: "#333", h: "", t: "", faces: 1, dedMin: 0}; P.conds.push(c);
    P.items.push({id: "Icnt", cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [[10, 10], [20, 20], [30, 30]], nos: 1, label: ""});
    const r = {net: Z.condTotals(c).net, st: Z.reviewStatus(P.items.find(i => i.id === "Icnt")).t};
    P.items = P.items.filter(i => i.id !== "Icnt"); P.conds = P.conds.filter(x => x.id !== "Ccnt"); P.scales[k] = keep; return r; });
  ok(cs.net === 3 && cs.st !== "Needs calibration", `3 doors counted on a page with no scale are in the totals (a count needs none): ${cs.net} Nos, status “${cs.st}”`);
  const st = await T(() => { const Z = zdTakeoff, S = Z.S, P = Z.P.proj, k = S.key, ac = P.conds.find(c => c.type === "area"), it = {id: "Ist", cond: ac.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [[2000, 100], [2036, 100], [2036, 136], [2000, 136]], nos: 1, label: "status"};
    P.items.push(it); const r = []; const was = Object.assign({}, P.scales[k]);
    r.push(Z.reviewStatus(it).t); it.ai = true; r.push(Z.reviewStatus(it).t); it.qa = "checked"; it.qaBy = "T"; r.push(Z.reviewStatus(it).t); P.scales[k].verified = true; r.push(Z.reviewStatus(it).t); it.ai = false; it.qa = ""; r.push(Z.reviewStatus(it).t);
    P.scales[k] = was; P.items = P.items.filter(i => i !== it); return r; });
  ok(st.join(" | ") === "Needs calibration | Needs review | Needs calibration | Verified | Measured", "review status: hand-drawn on an unverified note scale → Needs calibration; an agent's → Needs review; checked but the scale unverified → Needs calibration; checked on a verified scale → Verified; hand-drawn on it → Measured (" + st.join(" | ") + ")");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  if (process.env.TK_REPORT) fs.writeFileSync(process.env.TK_REPORT, JSON.stringify({at: new Date().toISOString(), tolerances: TOL, reference: A.REF, checks: rows}, null, 1));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

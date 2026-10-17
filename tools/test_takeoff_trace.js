#!/usr/bin/env node
/* The vector trace inside the app (takeoff/trace.js through takeoff.js), on the plan of takeoff_trace_fixture.js made into a
   PDF with layers Wall, WH (hatch) and DUCTS: an Auto area click takes the traced room (verified against its written size),
   a click in a door gives its threshold, the window scan adds the rest, "Trace the whole floor" fills the L-01 … L-09
   conditions with the quantities worked out by hand, running it again replaces its own trace (never doubles), Ctrl+Z takes
   it back, the agent's "trace the whole floor" runs it, and with the setting off Auto area traces from the image as before.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_trace.js     (pdfjs-dist, exceljs) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const F = require("./takeoff_trace_fixture");
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; return !!c; };
const near = (a, b, t) => a != null && Math.abs(a - b) <= (t || 0.02);
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "trace"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "trace.pdf", mimeType: "application/pdf", buffer: F.tracePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.ocgs && zdTakeoff.S.ocgs[zdTakeoff.S.fileId] !== undefined, null, {timeout: 20000}); await wait(500);
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) { await page.keyboard.press("Escape"); await wait(150); }
  await T(() => { const Z = zdTakeoff, S = Z.S; Z.P.proj.scales[S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()};
    Z.P.proj.conds.push({id: "CF", name: "Floor area", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0}); S.cond = "CF"; });
  const qty = id => T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); return it ? Z.rowsOf(it, 18).reduce((a, r) => a + r.qty, 0) : null; }, id);
  const last = () => T(() => { const it = zdTakeoff.P.proj.items[zdTakeoff.P.proj.items.length - 1]; return it && {id: it.id, label: it.label, how: it.det && it.det.how, st: it.ver && it.ver.st, cond: it.cond}; });

  console.log("A. the page's trace");
  const R = await T(async () => { const t = await zdTakeoff.traceGet(); return t && {err: t.err, n: t.spaces && t.spaces.length, thr: t.thresholds && t.thresholds.length, layers: t.layers, names: t.spaces && t.spaces.map(s => s.names.join("+") + ":" + s.status).sort()}; });
  ok(R && !R.err && R.n === 3 && R.thr === 2, "read from the PDF's layers: 3 rooms, 2 thresholds (" + JSON.stringify(R) + ")");
  ok(R && R.layers && R.layers.outline.includes("Wall") && R.layers.outline.includes("DUCTS") && R.layers.hatch.includes("WH"), "walls from Wall + DUCTS, the hatch from WH");
  ok(R && R.names && R.names.join() === "BATH:dims,BED ROOM:dims,LOUNGE:dims", "each room named from the page's text and verified against its written size (" + (R && R.names) + ")");

  const TL = await T(() => zdTakeoff.textLines([{s: "BALCONY", x: 580.6, y: 1336.7, w: 84.2, h: 19.7, r: -Math.PI / 2}, {s: "12'-5 1/2\"x11'-6\"", x: 690, y: 1340, w: 117.7, h: 19.7, r: 0},
    {s: "BED", x: 100, y: 100, w: 30, h: 10, r: 0}, {s: "ROOM", x: 134, y: 100.5, w: 40, h: 10, r: 0}]).map(l => l.s).sort());
  ok(JSON.stringify(TL) === JSON.stringify(["12'-5 1/2\"x11'-6\"", "BALCONY", "BED ROOM"]), "page text: a word written up the page never joins one written across (a balcony's name and the bed room's size beside it, as on the Phoenix 3rd floor); BED + ROOM still join (" + TL.join(" | ") + ")");
  console.log("B. an Auto area click");
  await T(p => zdTakeoff.autoAt(p), F.at.bed); await wait(200);
  let it = await last();
  ok(it && it.how === "trace" && it.st === "dims" && /BED ROOM/.test(it.label) && it.cond === "CF", "the click in the bed room takes its traced outline: " + JSON.stringify(it));
  ok(near(await qty(it.id), 263.625), "…263.625 Sft = 14'-3\" × 18'-6\", wall face to wall face (" + (await qty(it.id)) + ")");
  await T(p => zdTakeoff.autoAt(p), F.at.shut); await wait(200);
  it = await last();
  ok(it && it.how === "trace" && near(await qty(it.id), 2.5 * 0.375), "a click in the door drawn closed takes its threshold: 2'-6\" × 4½\" = 0.9375 Sft (" + (await qty(it.id)) + ")");

  console.log("C. the window scan");
  const W = await T(async w => zdTakeoff.autoAreaWindow(w), [F.X(-2), F.X(-2), F.X(32), F.X(22)]);
  ok(W && W.added === 2 && near(W.sft, 125.344 + 123.141, 0.05) && W.skipped && W.skipped.existing === 1, "adds the bath and the lounge (248.485 Sft), skips the bed room already measured (" + JSON.stringify(W) + ")");

  console.log("D. Trace the whole floor");
  const n0 = await T(() => zdTakeoff.P.proj.items.length);
  const A = await T(async () => { const r = await zdTakeoff.traceFloorTakeoff({replace: true}); return r.err ? r : r.ok; });
  ok(A && !A.err && A.spaces === 3 && A.thresholds === 2, "traced: " + JSON.stringify(A));
  const tot = () => T(() => { const Z = zdTakeoff; return Object.fromEntries(Z.TRACE_LAYERS.map(([code, name]) => { const c = Z.P.proj.conds.find(x => x.name === name); return [code, c ? [Z.P.proj.items.filter(i => i.cond === c.id).length, +Z.condTotals(c).net.toFixed(3)] : null]; })); });
  const t1 = await tot();
  ok(t1["L-01"] && near(t1["L-01"][1], 600), "L-01 the floor: 600 Sft to the walls' outer face (" + JSON.stringify(t1["L-01"]) + ")");
  ok(t1["L-02"] && near(t1["L-02"][1], 125.344, 0.01), "L-02 washrooms: the bath 125.344 Sft, the duct left out (" + JSON.stringify(t1["L-02"]) + ")");
  ok(t1["L-04"] && near(t1["L-04"][1], 263.625, 0.01), "L-04 rooms: the bed room 263.625 Sft (" + JSON.stringify(t1["L-04"]) + ")");
  ok(t1["L-04K"] && near(t1["L-04K"][1], 123.141, 0.01), "L-04K kitchen + lounge: the lounge 123.141 Sft, in its own condition (" + JSON.stringify(t1["L-04K"]) + ")");
  ok(t1["L-04P"] && t1["L-04P"][0] === 0 && t1["L-04B"] && t1["L-04B"][0] === 0, "L-04P passages and L-04B balconies: none on this plan");
  ok(A && near(A.floor_tile_sft, 263.625 + 123.141, 0.02) && near(A.rooms_sft, 263.625, 0.01) && near(A.kitchen_lounge_sft, 123.141, 0.01), "floor tile = rooms + kitchen / lounge + passages + corridors = 386.766 Sft, the bath apart (" + (A && A.floor_tile_sft) + ")");
  ok(t1["L-04T"] && t1["L-04T"][0] === 2 && near(t1["L-04T"][1], 1.125 + 0.9375, 0.01), "L-04T thresholds: 3 × 4½\" and 2'-6\" × 4½\" = 2.0625 Sft (" + JSON.stringify(t1["L-04T"]) + ")");
  ok(t1["L-05"] && near(t1["L-05"][1], 46.25, 0.01), "L-05 the bath's wall face, gross: 2 × (13'-10½\" + 9'-3\") = 46.25 ft (" + JSON.stringify(t1["L-05"]) + ")");
  ok(t1["L-05D"] && t1["L-05D"][0] === 1 && near(t1["L-05D"][1], 2.5, 0.06), "L-05D its door opening, kept apart: 2'-6\" (" + JSON.stringify(t1["L-05D"]) + ")");
  ok(t1["L-08"] && near(t1["L-08"][1], 3, 0.01), "L-08 the duct box: 3 Sft (" + JSON.stringify(t1["L-08"]) + ")");
  ok(t1["L-07"] && t1["L-07"][0] === 1, "L-07 the bath's wall centreline, for reference");
  const V = await T(() => { const Z = zdTakeoff, its = Z.P.proj.items.filter(i => i.det && i.det.how === "trace" && i.det.batch); return {n: its.length, ver: its.every(i => i.ver && Z.VER_NAMES[i.ver.st]), bath: (its.find(i => /BATH/.test(i.label) && i.kind === "shape") || {}).ver}; });
  ok(V.n > 0 && V.ver, "every measurement carries its verification (" + V.n + ")");
  ok(V.bath && V.bath.st === "dims", "the bath: " + (V.bath && V.bath.st) + " — " + (V.bath && V.bath.note));
  const n1 = await T(() => zdTakeoff.P.proj.items.length);
  const B2 = await T(async () => { const r = await zdTakeoff.traceFloorTakeoff({replace: true}); return r.err ? r : r.ok; });
  const t2 = await tot(), n2 = await T(() => zdTakeoff.P.proj.items.length);
  ok(B2 && B2.replaced === A.measurements && n2 === n1 && JSON.stringify(t2) === JSON.stringify(t1), "run again it replaces its own " + (B2 && B2.replaced) + " measurements: nothing doubled (" + n1 + " → " + n2 + ")");
  ok((await T(() => zdTakeoff.P.proj.items.filter(i => i.cond === "CF").length)) === 4, "the measurements made by hand / Auto area in Floor area are kept (4)");
  await T(() => zdTakeoff.undoAny()); await wait(100);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n1, "one Ctrl+Z takes the second run back");
  await T(() => zdTakeoff.undoAny()); await wait(100);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n0, "another takes the first back (" + n0 + ")");

  console.log("E. the agent");
  const G = await T(async () => { const r = await zdTakeoff.agentCmd("trace the whole floor"); return r && (r.error ? r : {spaces: r.spaces, overall: r.overall_sft, bath: r.washroom_sft}); });
  ok(G && G.spaces === 3 && near(G.overall, 600) && near(G.bath, 125.34, 0.01), "\"trace the whole floor\" runs it: " + JSON.stringify(G));
  const G2 = T(async () => { const r = await zdTakeoff.agentCmd("trace the whole floor"); return r && (r.error ? r : {replaced: r.replaced}); });
  await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 10000}).catch(() => {});
  const askd = await T(() => document.getElementById("dlgBack").classList.contains("on") && /already has/.test(document.getElementById("dlgBody") ? document.getElementById("dlgBody").textContent : document.body.textContent));
  if (askd) await page.click("#dlgOk");
  const g2 = await G2;
  ok(askd && g2 && g2.replaced > 0, "asked again, it asks before replacing the earlier trace, then replaces it (" + JSON.stringify(g2) + ")");

  console.log("F. the setting off");
  await T(() => { zdTakeoff.P.proj.auto = Object.assign({}, zdTakeoff.P.proj.auto || {}, {trace: false}); zdTakeoff.S.cond = "CF"; zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => i.cond !== "CF"); });
  await T(p => zdTakeoff.autoAt(p), F.at.lounge); await wait(300);
  it = await last();
  ok(it && it.cond === "CF" && it.how === "auto", "with \"read the whole floor from the PDF's wall layers\" off, Auto area traces as before (" + JSON.stringify(it) + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

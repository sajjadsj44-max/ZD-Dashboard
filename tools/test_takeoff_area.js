#!/usr/bin/env node
/* Browser tests for the takeoff area: before the takeoff agent, auto area of the rooms, counting and Find similar run, the app
   asks where — a part of the page boxed now (or the box already drawn) or the whole page — and keeps only what is inside.
   On the fixture page 1 (tools/takeoff_fixture.js): bed room 12' × 14' and store 10' × 14', side by side.
     - box around the bed room → only the bed room is measured; the box stays shown
     - the box already drawn is offered next time; Whole page → the store too, and the box goes
     - Esc while boxing → nothing runs
     - wall runs cut at the box edge, counts outside it left out, what was there before untouched (areaClip)

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/> node tools/test_takeoff_area.js
*/
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Area"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  await T(() => { const k = zdTakeoff.S.key; zdTakeoff.P.proj.scales[k].verified = true; });
  const scr = ([x, y]) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async p => { const q = await scr(p); await page.mouse.click(q[0], q[1]); await wait(80); };
  const dlg = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const rooms = () => T(() => zdTakeoff.P.proj.items.filter(i => (zdTakeoff.P.proj.conds.find(c => c.id === i.cond) || {}).type === "area").map(i => (i.label || "").toUpperCase()).sort());
  const box = [[G.X0 - 2, G.oy1 + 6], [G.ax1 + 1.5, G.Y0 - 2]];   // around the bed room only (pdf points, y up)

  console.log("box an area, then auto area of the rooms");
  let run = T(() => zdTakeoff.agentCmd("measure all rooms"));
  await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 5000});
  ok(/Where — auto area/.test(await page.textContent(".dlg")) && await T(() => document.querySelector('input[name="arW"][value="box"]').checked), "asks where first — “Box an area now” chosen");
  await page.click("#dlgOk"); await wait(200);
  ok(await T(() => zdTakeoff.S.tool === "area"), "the box tool is on");
  await click(box[0]); await click(box[1]); await run; await wait(300);
  let R = await rooms();
  ok(R.length === 1 && /BED/.test(R[0]), "only the room inside the box is measured: " + JSON.stringify(R));
  ok(await T(() => !!zdTakeoff.areaOf()), "the takeoff area stays on the page");
  ok(await T(() => /Takeoff area/.test(document.getElementById("hi") ? document.getElementById("hi").innerHTML + document.body.innerHTML : "")), "drawn as a dashed box labelled Takeoff area");

  console.log("the box drawn is offered again; whole page");
  run = T(() => zdTakeoff.agentCmd("measure all rooms"));
  await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 5000});
  ok(await T(() => { const c = document.querySelector('input[name="arW"][value="cur"]'); return !!c && c.checked; }), "next time the area already boxed is offered first");
  await page.check('input[name="arW"][value="all"]'); await page.click("#dlgOk"); await run; await wait(300);
  R = await rooms();
  ok(R.length === 2 && R.some(x => /STORE/.test(x)), "Whole page: the store is measured too " + JSON.stringify(R));
  ok(await T(() => !zdTakeoff.areaOf()), "choosing the whole page takes the box away");

  console.log("Esc cancels");
  await T(() => { const P = zdTakeoff.P.proj; P.items = []; zdTakeoff.refresh(); });
  run = T(() => zdTakeoff.agentCmd("measure all rooms"));
  await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 5000});
  await page.click("#dlgOk"); await wait(150); await click(box[0]); await page.keyboard.press("Escape"); const rr = await run; await wait(200);
  ok((await rooms()).length === 0 && rr && rr.error === "cancelled" && await T(() => zdTakeoff.S.tool !== "area"), "Esc while boxing: nothing measured, the tool is left");
  ok(!(await dlg()), "no dialog left open");

  console.log("what is kept inside the box");
  const res = await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, key = Z.S.key, r = [100, 100, 200, 200];
    P.conds.push({id: "L", name: "Wall", type: "linear", unit: "ft", color: "#333333", h: "", t: "", faces: 1, dedMin: 0}, {id: "N", name: "Tags", type: "count", unit: "Nos", color: "#ff0000", h: "", t: "", faces: 1, dedMin: 0},
      {id: "A", name: "Floor", type: "area", unit: "Sft", color: "#00aa00", h: "", t: "", faces: 1, dedMin: 0});
    P.items = [{id: "old", cond: "N", file: f, page: 1, kind: "shape", nos: 1, pts: [[300, 300]]}];   // there before, outside: kept
    const snap = Z.areaSnap();
    P.items.push({id: "w1", cond: "L", file: f, page: 1, kind: "shape", nos: 1, pts: [[50, 150], [150, 150], [150, 250]]},   // crosses the left and bottom edges
      {id: "w2", cond: "L", file: f, page: 1, kind: "shape", nos: 1, pts: [[50, 50], [90, 50]]},                              // outside
      {id: "w3", cond: "L", file: f, page: 1, kind: "shape", nos: 1, pts: [[50, 120], [250, 120], [250, 180], [50, 180]]},    // in, out, in again → two pieces
      {id: "c1", cond: "N", file: f, page: 1, kind: "shape", nos: 1, pts: [[120, 120], [400, 400], [150, 190]]},
      {id: "a1", cond: "A", file: f, page: 1, kind: "shape", nos: 1, pts: [[110, 110], [140, 110], [140, 140], [110, 140]]},
      {id: "a2", cond: "A", file: f, page: 1, kind: "shape", nos: 1, pts: [[300, 300], [340, 300], [340, 340], [300, 340]]});
    P.items.find(i => i.id === "old").pts.push([120, 130], [500, 500]);   // gained one inside, one outside
    const left = Z.areaClip(snap, r, key), I = id => P.items.find(i => i.id === id);
    const w3 = P.items.filter(i => i.cond === "L" && i.id !== "w1").map(i => i.pts);
    return {left, w1: I("w1") && I("w1").pts, w2: !!I("w2"), w3, c1: I("c1") && I("c1").pts, a1: !!I("a1"), a2: !!I("a2"), old: I("old").pts}; });
  ok(JSON.stringify(res.w1) === JSON.stringify([[100, 150], [150, 150], [150, 200]]), "a wall run crossing the box is cut at its edges: " + JSON.stringify(res.w1));
  ok(!res.w2, "a run wholly outside is left out");
  ok(res.w3.length === 2 && res.w3.every(q => q.length === 2), "a run going out and back in becomes two pieces");
  ok(JSON.stringify(res.c1) === JSON.stringify([[120, 120], [150, 190]]), "counts outside the box are left out");
  ok(res.a1 && !res.a2, "rooms by their centre: inside kept, outside left out");
  ok(JSON.stringify(res.old) === JSON.stringify([[300, 300], [120, 130]]), "what was there before stays; only its new points are checked");
  ok(res.left === 4, `4 things left out and reported — a run, a tag, a room, a new point (got ${res.left})`);

  console.log("the full takeoff agent asks for the area too");
  await T(() => { zdTakeoff.P.proj.items = []; zdTakeoff.refresh(); });
  run = T(() => zdTakeoff.agentCmd("full takeoff"));
  await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on") && /Full takeoff agent/.test(document.querySelector(".dlg").textContent), null, {timeout: 5000});
  await page.uncheck("#ftW"); await page.uncheck("#ftD"); await page.click("#dlgOk");
  await page.waitForFunction(() => /Where — full takeoff/.test((document.querySelector(".dlg") || {}).textContent || ""), null, {timeout: 5000});
  ok(true, "⚡ Full takeoff (this page) → asks where next");
  await page.click("#dlgOk"); await wait(150); await click(box[0]); await click(box[1]); await run; await wait(400);
  R = await rooms(); ok(R.length === 1 && /BED/.test(R[0]), "full takeoff in the box: only the bed room " + JSON.stringify(R));

  console.log("Find similar asks for the area too");
  await T(() => { zdTakeoff.S.cond = "N"; zdTakeoff.setTool("vsearch"); });
  await click([G.d0 - 2, G.ay0 + 2]); await click([G.d0 + 8, G.ay0 - 8]); await wait(250);
  ok(await dlg() && await T(() => { const s = document.getElementById("vsWhere"); return !!s && s.value === "cur" && [...s.options].some(o => o.value === "area" && /box it next/.test(o.text)); }), "Find similar: “Inside the takeoff area” first (one is boxed), “box it next” offered");
  await page.click("#dlgCancel"); await wait(150);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

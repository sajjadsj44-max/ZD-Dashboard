#!/usr/bin/env node
/* Tests for areas counted twice and polygon booleans.
   1. polyBool (takeoff.js, read out of the file and run in node): intersection, union and difference of squares and L-shapes,
      shared sides, a corner on a side, touching corners, holes, a cut in two, rotated and far from the origin.
   2. In the browser, on the fixture page 1 (tools/takeoff_fixture.js, 9 pt per ft), areas drawn to overlap:
     - overlapCheck: one condition's areas, two floor finishes (floor tile / bath floor tile) — not a ceiling over a floor,
       not a sliver under 0.5 Sft, not a circle; Sft of each overlap
     - the export check: "N Sft counted twice where X and Y overlap" (the same outline twice is left to its own warning)
     - the dialog: a row per pair, Show selects both, Fix cuts the overlap out of the larger outline, Fix all deletes an
       outline drawn twice (same outline, same Nos), never one of two conditions (cut out of the larger instead), locked areas
       left; all of Fix all is one Ctrl+Z
     - the rules: a bath inside a floor becomes a void of the floor (nothing deleted) and is no longer reported; half or more
       of a smaller outline of one condition is cut out of the smaller; the same outline with other Nos is left; a duplicate
       goes with its own copy of a void
     - an outline cut in two by the fix: the other piece a copy of it
     - Combine into one area (right-click, selection panel, palette): two areas sharing a side become one outline with the
       first one's label and look, a space closed round becomes a void; areas touching at a corner only, in two
       conditions, or with other Nos or slopes are not combined (and say why); one Ctrl+Z puts them back
     - Merge areas apart: a gap between them (a wall) up to 2 ft is filled at once (gapBridges, also in node: a taller room, a
       gap that widens, one turned, far from the origin); a wider one asks first and is filled up to the distance given;
       the Modify ribbon's Merge areas button

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/> node tools/test_takeoff_overlap.js
*/
const fs = require("fs"), path = require("path");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

function unit(){
  console.log("polyBool (node)");
  const src = fs.readFileSync(path.join(__dirname, "..", "takeoff", "takeoff.js"), "utf8"), line = re => src.match(re)[0];
  const fn = name => { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && !--d) break; } return src.slice(i, j + 1); };
  const lib = [line(/const dist = [^\r\n]*/), line(/const polySigned = [^\r\n]*/), fn("pointInPoly"), fn("distSeg"), fn("cleanPoly"), fn("polyBool"), line(/const boolArea = [^\r\n]*/), line(/const bbOf = [^\r\n]*/), fn("gapBridges")].join("\n");
  const {polyBool, boolArea, polySigned, gapBridges} = new Function(lib + "\nreturn {polyBool, boolArea, polySigned, gapBridges};")();
  const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const t = (A, B, op, area, n, m) => { const R = polyBool(A, B, op), a = boolArea(R); ok(near(a, area, 1e-6) && (n == null || R.length === n), `${m}: ${op} ${+a.toFixed(6)} (${area})${n != null ? ", " + R.length + " outline" + (R.length === 1 ? "" : "s") : ""}`); return R; };
  const A = sq(0, 0, 10, 10), B = sq(5, 5, 10, 10), L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  t(A, B, "inter", 25, 1, "squares overlapping"); t(A, B, "union", 175, 1, "squares overlapping"); t(A, B, "diff", 75, 1, "squares overlapping");
  t(A, B.slice().reverse(), "diff", 75, 1, "the other drawn clockwise");
  t(A, sq(10, 0, 10, 10), "union", 200, 1, "squares sharing a side → one outline"); t(A, sq(10, 0, 10, 10), "inter", 0, 0, "squares sharing a side");
  const R1 = t(A, sq(10, 3, 5, 4), "union", 120, 1, "a smaller square on a side"); ok(R1[0].length === 8, "…its outline has 8 corners (" + R1[0].length + ")");
  t(A, sq(10, 10, 5, 5), "union", 125, 2, "squares touching at a corner stay two outlines");
  const R2 = t(A, sq(2, 2, 3, 3), "diff", 91, 2, "a square inside: a hole"); ok(R2.filter(Q => polySigned(Q) < 0).length === 1, "…the hole comes back clockwise");
  t(A, sq(0, 0, 10, 10), "diff", 0, 0, "the same square: nothing left"); t(A, sq(0, 0, 10, 10), "inter", 100, 1, "the same square: itself");
  t(L, sq(2, 2, 10, 1), "inter", 8, 1, "L-shape × a bar"); t(L, sq(2, 2, 10, 1), "diff", 56, 1, "L-shape less a bar into it");
  t(L, sq(-1, 2, 12, 1), "diff", 54, 2, "L-shape cut in two by a bar right across");
  t(L, sq(4, 4, 6, 6), "union", 100, 1, "L-shape + its missing square = the square");
  t(L, sq(4, 0, 6, 4), "inter", 24, 1, "L-shape × its own leg (sides along each other)"); t(L, sq(4, 0, 6, 4), "diff", 40, 1, "L-shape less its own leg");
  t([[0, 0], [10, 0], [0, 10]], sq(0, 0, 5, 5), "inter", 25, 1, "triangle × square with a corner on the slope");
  t(A, [[5, 0], [10, 5], [5, 10], [0, 5]], "diff", 50, 4, "square less a diamond touching its sides: 4 corners");
  const U = [[0, 0], [9, 0], [9, 9], [6, 9], [6, 3], [3, 3], [3, 9], [0, 9]], R3 = t(U, sq(0, 9, 9, 3), "union", 90, 2, "U-shape closed by a bar");
  ok(R3.filter(Q => polySigned(Q) > 0).length === 1 && R3.filter(Q => polySigned(Q) < 0).length === 1, "…one outline round one hole");
  t([sq(0, 0, 10, 10), sq(2, 2, 3, 3).reverse()], sq(1, 1, 2, 2), "inter", 3, null, "an outline with a hole × a square");
  const L2 = [[5, 2], [12, 2], [12, 12], [8, 12], [8, 6], [5, 6]], ia = boolArea(polyBool(L, L2, "inter"));
  ok(ia > 0 && near(boolArea(polyBool(L, L2, "union")), 64 + 52 - ia, 1e-6) && near(boolArea(polyBool(L, L2, "diff")), 64 - ia, 1e-6) && near(boolArea(polyBool(L2, L, "diff")), 52 - ia, 1e-6), "two L-shapes: union = A + B − A∩B, A − B = A − A∩B (A∩B " + ia + ")");
  const rot = (Q, a, o) => Q.map(([x, y]) => [o + x * Math.cos(a) - y * Math.sin(a), o + x * Math.sin(a) + y * Math.cos(a)]);
  ok(near(boolArea(polyBool(rot(A, 0.3, 3000), rot(B, 0.3, 3000), "inter")), 25, 1e-6), "rotated, 3000 pt from the origin: the overlap still 25");
  const R4 = polyBool(rot(A, 0.7, 2500), rot(sq(10, 0, 10, 10), 0.7, 2500), "union"); ok(R4.length === 1 && near(boolArea(R4), 200, 1e-6), "rotated squares sharing a side: still one outline");
  const circ = (cx, cy, r, n) => Array.from({length: n}, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]), t0 = Date.now();
  { const merge = (A2, B2, lim, area, m, corners) => { const U2 = polyBool(A2, B2, "union"), G = gapBridges(U2.filter(Q => polySigned(Q) > 0), lim, 0.05); let V = U2; G.quads.forEach(q => { V = polyBool(V, q, "union"); }); V = V.filter(Q => polySigned(Q) > 0 || -polySigned(Q) >= 1);   // (a pocket under 1 Sft left inside is filled, as combineAreas does)
      const o = V.filter(Q => polySigned(Q) > 0); ok(o.length === 1 && near(boolArea(V), area, 1e-6) && (corners == null || o[0].length === corners), `gap filled — ${m}: ${o.length} outline${o.length === 1 ? "" : "s"}, ${+boolArea(V).toFixed(6)} (${area})${corners != null ? ", " + (o[0] || []).length + " corners" : ""}`); return G; };
    const G1 = merge(A, sq(10.75, 0, 10, 10), 2, 207.5, "two rooms, a 9\" wall between", 4); ok(near(G1.lo, 0.75, 1e-9) && near(G1.hi, 0.75, 1e-9), "…the gap reported 0.75 (" + G1.lo + "–" + G1.hi + ")");
    merge(A, sq(10.75, 0, 9.25, 15), 2, 246.25, "the other room longer: only the part across is filled", 6);
    merge(sq(0, 0, 6, 6), [[6.5, 0], [12, 0], [12, 6], [7, 6]], 2, 72, "a gap that widens 0.5 → 1 ft (a side 4.8° off)", 4);
    merge(sq(0, 0, 6, 6), [[6.5, 0], [12, 0], [12, 6], [7.5, 6]], 1, 68.25, "a gap widening 0.5 → 1.5 ft, 1 ft to fill: filled as far as it is 1 ft");
    merge(rot(A, 0.3, 3000), rot(sq(10.75, 0, 10, 10), 0.3, 3000), 2, 207.5, "turned 17°, 3000 from the origin");
    merge(L, sq(4.5, 4.5, 5.5, 5.5), 2, 100, "a square in an L's corner, a 0.5 gap on two sides: the L's square");
    const far = gapBridges([sq(0, 0, 5, 5), sq(8, 0, 5, 5)], 2, 0.05); ok(!far.quads.length && near(far.near, 3, 1e-9), "3 apart, 2 to fill: nothing filled, the gap (3) reported for asking (" + far.near + ")");
    const cor = gapBridges([sq(0, 0, 5, 5), sq(5.5, 5.5, 5, 5)], 2, 0.05); ok(!cor.quads.length && cor.near === Infinity, "near at a corner only: nothing filled, nothing to ask");
    const back = gapBridges([sq(0, 0, 10, 10), sq(0, 11, 10, 0.5)], 2, 0.05); ok(back.quads.length === 1 && near(back.hi, 1, 1e-9), "a thin strip 1 away: only its near side is filled across, never its far side (" + back.quads.length + " strip)"); }
  polyBool(circ(0, 0, 100, 400), circ(50, 30, 100, 400), "inter"); ok(Date.now() - t0 < 1000, "two 400-corner outlines in " + (Date.now() - t0) + " ms");
}

(async () => {
  unit();
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
  const {makePdf} = require("./takeoff_fixture.js");
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
  await page.click("#bNewProj"); await page.fill("#dlgName", "Overlap"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  ok(await T(() => Math.abs(zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt - 9) < 1e-6), "fixture page 1 at 9 pt per ft");
  await T(() => { const k = zdTakeoff.S.key; zdTakeoff.P.proj.scales[k].verified = true; });
  const toast = () => T(() => document.getElementById("toast").textContent);
  const sft = id => T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); return it ? Z.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0) : null; }, id);
  const ids = () => T(() => zdTakeoff.P.proj.items.map(i => i.id).sort().join(","));

  console.log("overlapCheck");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, sq = (x, y, w, h) => [[300 + x * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + (y + h) * 9], [300 + x * 9, 200 + (y + h) * 9]];
    const C = (id, name) => ({id, name, type: "area", unit: "Sft", color: "#00aa00", h: "", t: "", faces: 1, dedMin: 0});
    P.conds.push(C("FT", "Floor tile"), C("BT", "Bath floor tile"), C("CP", "Ceiling plaster"));
    const I = (id, cond, label, pts, o) => Object.assign({id, cond, file: f, page: 1, kind: "shape", nos: 1, label, pts}, o || {});
    P.items = [I("f1", "FT", "Hall", sq(0, 0, 20, 20)), I("f2", "FT", "Lobby", sq(16, 5, 10, 10)),   // 4 × 10 = 40 Sft, 40 % of the lobby
      I("f3", "FT", "Bed 1", sq(30, 0, 10, 10)), I("b1", "BT", "Bath 1", sq(34, 2, 8, 8)),                // floor tile / bath floor tile: 6 × 8 = 48, 75 % of the bath
      I("d1", "FT", "Store", sq(45, 0, 6, 6)), I("d2", "FT", "Store", sq(45, 0, 6, 6)),                    // the same outline twice: 36
      I("c1", "CP", "Hall ceiling", sq(0, 0, 20, 20)),                                                      // a ceiling over the floor: not counted twice
      I("g1", "FT", "Pass", sq(0, 25, 5, 5)), I("g2", "FT", "Pass 2", sq(4.95, 25, 5, 5)),                 // 0.05 × 5 = 0.25 Sft: a sliver
      I("r1", "FT", "Round", [[390, 290], [390, 335]], {shape: "circle"}),                                  // a circle: left to the cut-out
      I("k1", "FT", "Locked", sq(0, 32, 10, 10), {locked: true}), I("k2", "FT", "Kitchen", sq(5, 32, 10, 10))];   // 50, one locked
    Z.refresh(); });
  let L = await T(() => zdTakeoff.overlapCheck("project").map(p => [p.a.id, p.b.id, +p.sft.toFixed(3)]));
  ok(JSON.stringify(L) === JSON.stringify([["k1", "k2", 50], ["f3", "b1", 48], ["f1", "f2", 40], ["d1", "d2", 36]]), "four pairs, the largest first, Sft exact: " + JSON.stringify(L));
  ok(await T(() => zdTakeoff.overlapCheck("page").length === 4 && zdTakeoff.floorFin(zdTakeoff.P.proj.conds.find(c => c.id === "BT")) && !zdTakeoff.floorFin(zdTakeoff.P.proj.conds.find(c => c.id === "CP"))), "this page: the same four · bath floor tile a floor finish, ceiling plaster not");

  console.log("the export check");
  const V = await T(() => zdTakeoff.validation().L.filter(x => /counted twice/.test(x.msg)).map(x => x.lvl + " " + x.msg));
  ok(V.some(m => /^WARNING 40(\.0+)? Sft counted twice where Hall and Lobby overlap — Floor tile on /.test(m)), "WARNING “40 Sft counted twice where Hall and Lobby overlap — Floor tile”");
  ok(V.some(m => /^WARNING 48(\.0+)? Sft counted twice where Bed 1 and Bath 1 overlap — Floor tile \/ Bath floor tile/.test(m)), "two floor finishes: “… Bed 1 and Bath 1 overlap — Floor tile / Bath floor tile”");
  ok(V.filter(m => /Store/.test(m)).length === 1 && V.some(m => /Store.*drawn twice/.test(m)), "the same outline twice: only its own “drawn twice” warning, not a second one");
  await T(() => document.querySelector('[data-rv="validate"]').click()); await wait(100);
  ok(await T(() => !!document.getElementById("exOv")), "Export: a “Fix overlaps…” button");
  await T(() => document.getElementById("dlgCancel").click());

  console.log("the dialog");
  await T(() => document.querySelector('[data-rv="overlap"]').click()); await wait(150);
  ok(await T(() => document.getElementById("dlgBack").classList.contains("on") && document.getElementById("dlgT").textContent === "Areas counted twice"), "Review → Overlaps opens “Areas counted twice”");
  ok(await T(() => document.querySelectorAll("#dlgB [data-ov]").length === 4 && /174(\.0+)? Sft/.test(document.getElementById("dlgB").textContent)), "a row per pair, 174 Sft counted twice in all");
  ok(await T(() => { const r = document.querySelector('#dlgB [data-ov="0"]'); return /Locked and Kitchen/.test(r.textContent) && r.querySelector("[data-ovf]").disabled && /locked/.test(r.textContent); }), "a locked pair: Fix off, “nothing — locked”");
  ok(await T(() => /cut it out of Bed 1/.test(document.querySelector('#dlgB [data-ov="1"]').textContent) && /cut it out of Hall/.test(document.querySelector('#dlgB [data-ov="2"]').textContent) && /delete Store \(drawn twice\)/.test(document.querySelector('#dlgB [data-ov="3"]').textContent)), "says what Fix will do: cut it out of Bed 1 (two conditions: nothing deleted) · cut it out of Hall · delete Store (drawn twice)");
  await T(() => document.querySelector('#dlgB [data-ovs="1"]').click()); await wait(300);
  ok(await T(() => !document.getElementById("dlgBack").classList.contains("on") && [...zdTakeoff.selIds()].sort().join() === "b1,f3"), "Show: the dialog closes, both areas selected");
  await T(() => zdTakeoff.overlapDialog("page")); await wait(100);
  const u0 = await T(() => zdTakeoff.S.undo.length);
  await T(() => document.querySelector('#dlgB [data-ovf="2"]').click()); await wait(200);
  ok(near(await sft("f1"), 360) && near(await sft("f2"), 100), "Fix: the 40 Sft cut out of Hall (400 → 360), Lobby kept whole");
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "f1").pts.length === 8 && !zdTakeoff.P.proj.items.some(i => i.kind === "ded")), "…Hall's outline now notched (8 corners), no void needed");
  ok(await T(() => document.getElementById("dlgBack").classList.contains("on") && document.querySelectorAll("#dlgB [data-ov]").length === 3), "the dialog stays, 3 pairs left");
  await T(() => document.getElementById("ovAll").click()); await wait(200);
  ok(/1 overlap cut out, 1 outline deleted as drawn twice/.test(await toast()), "Fix all: " + await toast());
  ok(await ids() === "b1,c1,d1,f1,f2,f3,g1,g2,k1,k2,r1", "the second Store deleted; Bath 1 kept, the locked pair, the ceiling, the sliver, the circle left: " + await ids());
  ok(near(await sft("f3"), 52) && near(await sft("b1"), 64), "two conditions: the 48 Sft cut out of Bed 1 (100 → 52), Bath 1 kept whole (64)");
  ok(await T(() => zdTakeoff.overlapCheck("project").map(p => p.a.id + p.b.id).join() === "k1k2" && document.querySelectorAll("#dlgB [data-ov]").length === 1), "only the locked pair is left");
  ok(await T(() => zdTakeoff.S.undo.length) === u0 + 2, "Fix and Fix all: one step each");
  await T(() => document.getElementById("dlgCancel").click());
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(await ids() === "b1,c1,d1,d2,f1,f2,f3,g1,g2,k1,k2,r1" && near(await sft("f1"), 360) && near(await sft("f3"), 100), "Ctrl+Z puts back all Fix all deleted and cut, in one step");
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(near(await sft("f1"), 400) && await T(() => zdTakeoff.P.proj.items.find(i => i.id === "f1").pts.length === 4), "Ctrl+Z again: Hall whole again");

  console.log("an outline cut in two");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, sq = (x, y, w, h) => [[300 + x * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + (y + h) * 9], [300 + x * 9, 200 + (y + h) * 9]];
    P.items = [{id: "s1", cond: "FT", file: f, page: 1, kind: "shape", nos: 2, label: "Strip", pts: sq(0, 10, 30, 6), qa: "checked"}, {id: "s2", cond: "FT", file: f, page: 1, kind: "shape", nos: 1, label: "Bar", pts: sq(10, 3, 4, 20)}];   // 4 × 6 = 24: 30 % of the bar
    Z.refresh(); });
  const n2 = await T(() => zdTakeoff.overlapFix(null, "page"));
  const parts = await T(() => zdTakeoff.P.proj.items.filter(i => /^Strip/.test(i.label || "")).map(i => ({l: i.label, nos: i.nos, qa: i.qa || "", a: zdTakeoff.rowsOf(i, 9).reduce((a, r) => a + r.qty, 0)})));
  ok(n2.cut === 1 && parts.length === 2 && near(parts[0].a, 2 * 96) && near(parts[1].a, 2 * 60) && parts[1].l === "Strip (2)" && parts.every(p => p.nos === 2), "Strip cut in two by the bar: 16 × 6 and “Strip (2)” 10 × 6, both Nos 2 — " + JSON.stringify(parts));
  ok(parts[0].qa === "", "the outline changed: no longer marked checked");

  console.log("the rules: nothing deleted across conditions, Nos kept, voids counted");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, sq = (x, y, w, h) => [[300 + x * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + (y + h) * 9], [300 + x * 9, 200 + (y + h) * 9]];
    const I = (id, cond, label, pts, o) => Object.assign({id, cond, file: f, page: 1, kind: "shape", nos: 1, label, pts}, o || {});
    P.items = [I("w1", "FT", "Hall", sq(0, 0, 20, 20)), I("w2", "BT", "Bath", sq(5, 5, 5, 5)),   // a bath's floor tile wholly inside the hall's: 100 % of the smaller
      I("h1", "FT", "A", sq(30, 0, 10, 10)), I("h2", "FT", "B", sq(30, 6, 10, 6)),                  // 10 × 4 = 40: 67 % of B
      I("n1", "FT", "N", sq(45, 0, 6, 6)), I("n2", "FT", "N twice", sq(45, 0, 6, 6), {nos: 2}),     // the same outline, other Nos
      I("e1", "FT", "E", sq(0, 30, 10, 10)), I("e2", "FT", "E again", sq(0, 30, 10, 10)),          // drawn twice, each with its void
      I("v1", "FT", "Shaft", sq(2, 32, 2, 2), {kind: "ded"}), I("v2", "FT", "Shaft", sq(2, 32, 2, 2), {kind: "ded"})];
    Z.refresh(); });
  const L0 = await T(() => zdTakeoff.overlapCheck("page").map(p => [p.a.id + p.b.id, +p.sft.toFixed(3)]));
  ok(JSON.stringify(L0) === JSON.stringify([["e1e2", 96], ["h1h2", 40], ["n1n2", 36], ["w1w2", 25]]), "four pairs; the duplicate's overlap less its void (100 − 4 = 96): " + JSON.stringify(L0));
  const plan = await T(() => { const Z = zdTakeoff, it = id => Z.P.proj.items.find(i => i.id === id), q = (a, b) => { const p = Z.ovPlan(it(a), it(b)); return (p.act || "none") + (p.t ? ":" + p.t.id : ""); }; return [q("w1", "w2"), q("h1", "h2"), q("n1", "n2"), q("e1", "e2")].join(" "); });
  ok(plan === "cut:w1 cut:h2 none dup:e2", "what Fix will do: cut out of the hall (larger, two conditions), out of B (smaller), nothing (other Nos), delete the copy → " + plan);
  const n3 = await T(() => zdTakeoff.overlapFix(null, "page"));
  const R3 = await T(() => { const Z = zdTakeoff, P = Z.P.proj, q = id => { const it = P.items.find(i => i.id === id); return it ? +Z.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0).toFixed(3) : null; };
    return {ids: P.items.filter(i => i.kind === "shape").map(i => i.id).sort().join(), w1: q("w1"), w2: q("w2"), h1: q("h1"), h2: q("h2"), n1: q("n1"), n2: q("n2"), voids: P.items.filter(i => i.kind === "ded").map(i => (i.label || "") + " " + +Z.rowsOf(i, 9).reduce((a, r) => a + r.qty, 0).toFixed(3)).sort(), left: Z.overlapCheck("page").map(p => p.a.id + p.b.id)}; });
  ok(n3.cut === 2 && n3.dup === 1, "Fix all: 2 cut, 1 deleted as drawn twice → " + JSON.stringify(n3));
  ok(R3.w2 === 25 && R3.w1 === 400 && R3.voids.includes("Void in Hall -25"), "two conditions: Bath kept (25), cut out of Hall as a void (400 − 25) → " + JSON.stringify(R3));
  ok(R3.h1 === 100 && R3.h2 === 20, "one condition, 67 % of the smaller: cut out of the smaller (B 60 → 20), A whole — together they cover 120 as before");
  ok(R3.n1 === 36 && R3.n2 === 72, "the same outline with other Nos: left as it is (36 and 2 × 36)");
  ok(!/e2/.test(R3.ids) && R3.voids.filter(v => /^Shaft/.test(v)).length === 1, "the duplicate deleted with its own copy of the void; one void left for the outline kept → " + R3.voids.join(" | "));
  ok(JSON.stringify(R3.left) === JSON.stringify(["n1n2"]), "left reported: only the pair with other Nos (the bath cut out as a void is not reported again) → " + JSON.stringify(R3.left));

  console.log("combine areas (union)");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, sq = (x, y, w, h) => [[300 + x * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + y * 9], [300 + (x + w) * 9, 200 + (y + h) * 9], [300 + x * 9, 200 + (y + h) * 9]];
    const I = (id, cond, label, pts, o) => Object.assign({id, cond, file: f, page: 1, kind: "shape", nos: 1, label, pts}, o || {});
    P.items = [I("m1", "FT", "Room A", sq(0, 0, 10, 10), {nos: 2, ap: {lw: 3}}), I("m2", "FT", "Room B", sq(10, 0, 10, 10), {nos: 2, arcs: [[0, 1]]}),   // sharing a side
      I("u1", "FT", "U", [[0, 15], [9, 15], [9, 24], [6, 24], [6, 18], [3, 18], [3, 24], [0, 24]].map(([x, y]) => [300 + x * 9, 200 + y * 9])), I("u2", "FT", "Bar", sq(0, 24, 9, 3)),   // closes round a 3 × 6 space
      I("x1", "FT", "Far 1", sq(30, 0, 5, 5)), I("x2", "FT", "Far 2", sq(35, 5, 5, 5)),   // touching at a corner only
      I("y1", "CP", "Ceiling", sq(30, 15, 5, 5)), I("q1", "FT", "Q1", sq(30, 30, 5, 5)), I("q2", "FT", "Q2", sq(35, 30, 5, 5), {nos: 3}),   // sharing a side, other Nos
      I("s1", "FT", "S1", sq(30, 40, 5, 5), {pitch: 0.3333}), I("s2", "FT", "S2", sq(35, 40, 5, 5)),   // sharing a side, other slopes
      I("g1", "FT", "Lounge", sq(42, 0, 6, 6)), I("g2", "FT", "Dining", sq(48.75, 0, 6, 9)),   // a 9" wall between
      I("w1", "FT", "W1", sq(42, 12, 5, 5)), I("w2", "FT", "W2", sq(50, 12, 5, 5)), I("v1", "FT", "V1", sq(42, 20, 5, 5)), I("v2", "FT", "V2", sq(50, 20, 5, 5))];   // 3 ft apart
    Z.refresh(); Z.setSel(["m1", "m2"]); Z.setTool("select"); Z.zoomTo(["m1", "m2"]); Z.refresh(); });
  ok(await T(() => /Merge areas/.test(document.getElementById("props").textContent)), "two areas selected: “Merge areas” in the selection panel");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /Combine the selected areas into one/.test(c.t))), "…and in the command palette (Ctrl+K)");
  { const q = await T(() => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(), p = [300, 200 + 5 * 9]; return [r.left + p[0] * S.view.s + S.view.tx, r.top + p[1] * S.view.s + S.view.ty]; });
    await page.mouse.click(q[0], q[1], {button: "right"}); await wait(200); }
  ok(await page.isVisible("#ctx") && /Merge into one area/.test(await page.innerText("#ctx")), "right-click on the selection: “Merge into one area”" + (await page.isVisible("#ctx") ? "" : " (no menu)"));
  const u1 = await T(() => zdTakeoff.S.undo.length);
  await page.locator("#ctx .ci", {hasText: "Merge into one area"}).click(); await wait(200);
  const m = await T(() => { const it = zdTakeoff.P.proj.items.find(i => i.id === "m1"); return {n: zdTakeoff.P.proj.items.filter(i => /^m/.test(i.id)).length, pts: it.pts.length, a: zdTakeoff.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0), label: it.label, nos: it.nos, ap: it.ap, sel: [...zdTakeoff.selIds()].join()}; });
  ok(m.n === 1 && m.pts === 4 && near(m.a, 2 * 200) && m.label === "Room A" && m.nos === 2 && m.ap && m.ap.lw === 3 && m.sel === "m1", "one 20 × 10 outline (4 corners), Room A's label, Nos 2 and look kept, selected: " + JSON.stringify(m));
  ok(/Combined 2 areas into one — 200(\.0+)? Sft/.test(await toast()) && /· Nos 2/.test(await toast()), "toast: " + await toast());
  ok(await T(() => zdTakeoff.S.undo.length) === u1 + 1, "one step");
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => /^m/.test(i.id)).length === 2 && zdTakeoff.P.proj.items.find(i => i.id === "m1").pts.length === 4 && Math.abs(zdTakeoff.rowsOf(zdTakeoff.P.proj.items.find(i => i.id === "m1"), 9)[0].qty - 200) < 1e-6 && !!zdTakeoff.P.proj.items.find(i => i.id === "m2").arcs),"Ctrl+Z: both areas back as they were");
  const U = await T(() => { const Z = zdTakeoff, it = Z.combineAreas(new Set(["u1", "u2"])), P = Z.P.proj, d = P.items.filter(i => i.kind === "ded"); return {ok: !!it, n: P.items.filter(i => /^u/.test(i.id)).length, ded: d.map(i => ({c: i.cond, l: i.label, a: Z.rowsOf(i, 9).reduce((a, r) => a + r.qty, 0)})), gross: Z.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0)}; });
  ok(U.ok && U.n === 1 && near(U.gross, 108) && U.ded.length === 1 && U.ded[0].c === "FT" && near(U.ded[0].a, -18) && U.ded[0].l === "Void in U", "U-shape + bar: one 9 × 12 outline, the 3 × 6 space inside a void of Floor tile (net 90): " + JSON.stringify(U));
  ok(/1 space closed round taken off as void/.test(await toast()), "…and the toast says so");
  const n0 = await T(() => zdTakeoff.S.undo.length);
  ok(await T(() => zdTakeoff.combineAreas(new Set(["x1", "x2"]))) === null && /2 separate outlines/.test(await toast()), "touching at a corner only: not combined — " + await toast());
  ok(await T(() => zdTakeoff.combineAreas(new Set(["x1", "y1"]))) === null && /different conditions/.test(await toast()), "different conditions: not combined — " + await toast());
  ok(await T(() => zdTakeoff.combineAreas(new Set(["x1"]))) === null && /two or more areas/.test(await toast()), "one area: not combined");
  ok(await T(() => zdTakeoff.combineAreas(new Set(["q1", "q2"]))) === null && /different Nos/.test(await toast()), "other Nos: not combined — " + await toast());
  ok(await T(() => zdTakeoff.combineAreas(new Set(["s1", "s2"]))) === null && /different slopes/.test(await toast()), "other slopes: not combined — " + await toast());
  ok(await T(() => zdTakeoff.S.undo.length) === n0 && await T(() => zdTakeoff.P.proj.items.filter(i => /^[xy]/.test(i.id)).length === 3), "nothing changed by those, no undo step");

  console.log("merge areas with a gap between them");
  const area = id => T(i => { const Z = zdTakeoff, it = Z.P.proj.items.find(x => x.id === i); return it ? Z.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0) : null; }, id);
  const G = await T(() => { const Z = zdTakeoff, it = Z.combineAreas(new Set(["g1", "g2"])); return {ok: !!it, ids: Z.P.proj.items.filter(i => /^g/.test(i.id)).map(i => i.id).join(), pts: it && it.pts.length, label: it && it.label, ded: Z.P.proj.items.filter(i => i.kind === "ded" && /Lounge/.test(i.label || "")).length}; });
  ok(G.ok && G.ids === "g1" && G.pts === 6 && G.label === "Lounge" && G.ded === 0 && near(await area("g1"), 36 + 4.5 + 54), "a 0.75 ft wall between: one outline (6 corners), the wall strip 0.75 × 6 filled — " + await area("g1") + " Sft (94.5): " + JSON.stringify(G));
  ok(/Combined 2 areas into one — 94\.5/.test(await toast()) && /gap 0\.750 ft filled \(\+4\.5/.test(await toast()), "toast says the gap filled: " + await toast());
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => /^g/.test(i.id)).length) === 2 && near(await area("g1"), 36), "Ctrl+Z: both back");
  const n1 = await T(() => zdTakeoff.S.undo.length);
  ok(await T(() => zdTakeoff.combineAreas(new Set(["w1", "w2"]))) === null, "3 ft apart: nothing done at once…");
  ok(await page.isVisible("#dlgBack") && /3\.000 ft apart/.test(await page.innerText("#dlgB")) && await page.inputValue("#mgG") === "3.000", "…it asks, the gap filled in (" + (await page.isVisible("#dlgBack") ? await page.inputValue("#mgG") : "no dialog") + ")");
  await page.click("#dlgCancel"); await wait(150);
  ok(await T(() => zdTakeoff.S.undo.length) === n1 && await T(() => zdTakeoff.P.proj.items.filter(i => /^w/.test(i.id)).length) === 2, "Cancel: nothing changed");
  await T(() => { zdTakeoff.combineAreas(new Set(["w1", "w2"])); }); await page.fill("#mgG", "2.5"); await page.click("#dlgOk"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => /^w/.test(i.id)).length) === 2 && /gap between them is 3\.000 ft, more than the 2\.500 ft to fill/.test(await toast()), "2.5 ft asked for, 3 ft apart: not combined, and says so — " + await toast());
  await T(() => { zdTakeoff.combineAreas(new Set(["w1", "w2"])); }); await page.click("#dlgOk"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => /^w/.test(i.id)).length) === 1 && near(await area("w1"), 65) && /gap 3\.000 ft filled/.test(await toast()), "Fill and merge: one 13 × 5 area, 65 Sft — " + await toast());
  ok(await T(() => zdTakeoff.S.undo.length) === n1 + 1, "one undo step");
  await T(() => { const Z = zdTakeoff; Z.setSel(["v1", "v2"]); Z.refresh(); Z.ribShow && Z.ribShow("modify"); });
  ok(await T(() => !!document.querySelector('#tools [data-mod="merge"]')), "Modify ribbon: a Merge areas button");
  await T(() => document.querySelector('#tools [data-mod="merge"]').click()); await wait(150);
  ok(await page.isVisible("#dlgBack") && /3\.000 ft apart/.test(await page.innerText("#dlgB")), "…it merges the selection (asking for the 3 ft gap)");
  await page.click("#dlgOk"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => /^v/.test(i.id)).length) === 1 && near(await area("v1"), 65), "…and merges them: " + await area("v1"));
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /^Merge areas/.test(c.t) && (c.al || []).includes("merge"))), "palette: Merge areas, typed as ‘merge’ too");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

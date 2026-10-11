#!/usr/bin/env node
/* Walls agent II — what a QS found wrong on a real floor plan (Jade 2nd floor), drawn here with known answers, 18 pt / ft:
   A. a wardrobe's hangers / shelves (a comb of parallel lines 4" apart) are not 4" walls;
   B. a window 8 ft long in an 8" wall, drawn on its own lines at both faces and the glass between, is part of the wall run
      (longer than the 6 ft bridge, jambs crossing the band) — so it is deducted as an opening, like the other windows;
   C. a 4" wall in line with an 8" wall (flush with one face) is not taken into the 8" wall as if it were a window;
   D. a door between an 8" wall and a 4" wall: the opening goes to the 4" (the thinner) wall;
   and count markers shrink when the drawing is zoomed far out (they covered a whole floor at 38 %).

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_walls2.js     (pdfjs-dist) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {pdfFrom} = require("./takeoff_qa_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const K = 18, OX = 60, H = 842, L = [], P = (x, y) => [(OX + x * K).toFixed(3), (H - (OX + y * K)).toFixed(3)];
const seg = (x0, y0, x1, y1) => L.push(`${P(x0, y0).join(" ")} m ${P(x1, y1).join(" ")} l S`);
const rect = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
const quarter = (cx, cy, r) => { const c = 0.5523 * r, a = P(cx - r, cy), b = P(cx - r, cy - c), d = P(cx - c, cy - r), e = P(cx, cy - r);   // from (cx - r, cy) to (cx, cy - r)
  L.push(`${a.join(" ")} m ${b.join(" ")} ${d.join(" ")} ${e.join(" ")} c S`); };
// A. a wardrobe: a box with twelve shelves 2.5 ft long, 4" apart
rect(1.8, 1.8, 6, 4.6); for (let i = 0; i < 12; i++) seg(2 + i / 3, 2, 2 + i / 3, 4.5);
// B. an 8" wall with an 8 ft window: wall x 1-4, window 4-12 (four lines: its frame at both faces and two glass lines, jamb caps), wall 12-15
seg(1, 8, 4, 8); seg(1, 8 + 2 / 3, 4, 8 + 2 / 3); seg(1, 8, 1, 8 + 2 / 3);
[0.05, 0.25, 0.417, 2 / 3 - 0.05].forEach(d => seg(4, 8 + d, 12, 8 + d));   // (its frame 0.05 ft in from the faces, as often drawn: not a pair of wall faces) seg(4, 8, 4, 8 + 2 / 3); seg(12, 8, 12, 8 + 2 / 3);
seg(12, 8, 15, 8); seg(12, 8 + 2 / 3, 15, 8 + 2 / 3); seg(15, 8, 15, 8 + 2 / 3);
// C. 8" (x 1-4) — 4" flush with the top face (x 4-14) — 8" again (x 14-17)
seg(1, 12, 17, 12); seg(1, 12 + 2 / 3, 4, 12 + 2 / 3); seg(4, 12 + 1 / 3, 14, 12 + 1 / 3); seg(14, 12 + 2 / 3, 17, 12 + 2 / 3);
seg(1, 12, 1, 12 + 2 / 3); seg(4, 12 + 1 / 3, 4, 12 + 2 / 3); seg(14, 12 + 1 / 3, 14, 12 + 2 / 3); seg(17, 12, 17, 12 + 2 / 3);
// D. 8" wall x 1-5, a 3 ft door (hinge at x 8, swing and leaf), 4" wall x 8-16 flush with the top face
seg(1, 18, 5, 18); seg(1, 18 + 2 / 3, 5, 18 + 2 / 3); seg(1, 18, 1, 18 + 2 / 3); seg(5, 18, 5, 18 + 2 / 3);
seg(8, 18, 16, 18); seg(8, 18 + 1 / 3, 16, 18 + 1 / 3); seg(8, 18, 8, 18 + 1 / 3); seg(16, 18, 16, 18 + 1 / 3);
quarter(8, 18 + 1 / 6, 3); seg(8, 18 + 1 / 6, 8, 15 + 1 / 6);
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(); page.on("pageerror", e => ok(false, "page error: " + e)); page.on("dialog", d => d.dismiss());
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "walls 2"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "walls2.pdf", mimeType: "application/pdf", buffer: pdfFrom([{w: 595, h: 842, content: ["0.6 w"].concat(L).join("\n")}])});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await page.waitForTimeout(500);
  const runs = await page.evaluate(() => { const Z = zdTakeoff; Z.P.proj.scales[Z.S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true};
    const f = T => (Z.findWalls(T, null, 6) || []).map(r => [r.a, r.b].map(p => [+((p[0] - 60) / 18).toFixed(3), +((p[1] - 60) / 18).toFixed(3)]));
    return {w4: f(1 / 3), w8: f(2 / 3)}; });
  if (process.env.TK_DEBUG) console.log(JSON.stringify(runs));
  const inBox = (R, x0, y0, x1, y1) => R.filter(r => r.every(p => p[0] >= x0 - 0.01 && p[0] <= x1 + 0.01 && p[1] >= y0 - 0.01 && p[1] <= y1 + 0.01));
  const len = r => Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), tot = R => +R.reduce((a, r) => a + len(r), 0).toFixed(3);
  const along = (R, y) => R.filter(r => Math.abs(r[0][1] - y) < 0.02 && Math.abs(r[1][1] - y) < 0.02);
  console.log("A. wardrobe");
  ok(!inBox(runs.w4, 1.7, 1.7, 6.1, 4.7).length && !inBox(runs.w8, 1.7, 1.7, 6.1, 4.7).length, "no 4\" or 8\" walls among a wardrobe's shelves (" + inBox(runs.w4, 1.7, 1.7, 6.1, 4.7).length + " / " + inBox(runs.w8, 1.7, 1.7, 6.1, 4.7).length + ")");
  console.log("B. window");
  const B8 = along(runs.w8, 8 + 1 / 3);
  ok(B8.length === 1 && Math.abs(tot(B8) - 14) < 0.02, "the 8\" wall runs through its 8 ft window: one run, 14.000 ft (got " + B8.length + " run(s), " + tot(B8) + " ft)");
  console.log("C. a thinner wall in line");
  const C8 = along(runs.w8, 12 + 1 / 3), C4 = along(runs.w4, 12 + 1 / 6);
  ok(C8.length === 2 && Math.abs(tot(C8) - 6) < 0.02, "the two 8\" pieces stay apart — the 4\" wall between them is not a window: 2 runs, 6.000 ft (got " + C8.length + ", " + tot(C8) + ")");
  ok(C4.length === 1 && Math.abs(tot(C4) - 10) < 0.02, "the 4\" wall between them: 10.000 ft (got " + tot(C4) + ")");
  console.log("D. a door between an 8\" and a 4\" wall");
  const D4 = along(runs.w4, 18 + 1 / 6), D8 = along(runs.w8, 18 + 1 / 3);
  ok(D4.length === 1 && Math.abs(tot(D4) - 11) < 0.02 && Math.min(D4[0][0][0], D4[0][1][0]) < 5.02, "the 4\" wall takes the door's opening: x 5 → 16, 11.000 ft (got " + JSON.stringify(D4) + ")");
  ok(D8.length === 1 && Math.abs(tot(D8) - 4) < 0.02, "the 8\" wall stops at its jamb: 4.000 ft (got " + tot(D8) + ")");
  console.log("count markers when zoomed out");
  const r = await page.evaluate(async () => { const Z = zdTakeoff, P = Z.P; const c = {id: "Ccnt", name: "Doors", type: "count", unit: "Nos", color: "#c0392b", sym: "circle", cap: "seq", sz: "m"}; P.proj.conds.push(c);
    P.proj.items.push({id: "Icnt", cond: c.id, file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[200, 200], [260, 200]], nos: 1});
    const rad = async s => { Z.S.view.s = s; Z.applyView(); Z.refresh(); await new Promise(q => setTimeout(q, 120)); const m = [...document.querySelectorAll("#ov circle")].map(e => +e.getAttribute("r")).filter(v => v > 2); return {r: Math.max(...m), txt: /<text[^>]*>1<\/text>/.test(document.getElementById("ov").innerHTML)}; };
    return {near: await rad(1), far: await rad(0.15)}; });
  ok(Math.abs(r.near.r - 10) < 0.01 && r.near.txt, "at 18 px per ft a marker is its full size (r 10) with its number (got r " + r.near.r + ")");
  ok(r.far.r <= 3.01 && !r.far.txt, "zoomed far out (under 3 px per ft) it shrinks to 30 % and its number goes (got r " + r.far.r + ", number " + r.far.txt + ")");
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

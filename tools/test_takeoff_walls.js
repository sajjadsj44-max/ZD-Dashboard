#!/usr/bin/env node
/* Walls agent: short wall pieces at door openings (a nib off a wall face at a door jamb, a short return at a corner
   beside a door) are measured, and a door frame beside them is not a wall. A one-page vector drawing at 18 pt / ft.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_walls.js     (pdfjs-dist) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {pdfFrom} = require("./takeoff_qa_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const K = 18, OX = 100, H = 595, L = [], P = (x, y) => [(OX + x * K).toFixed(3), (H - (OX + y * K)).toFixed(3)];
const seg = (x0, y0, x1, y1) => L.push(`${P(x0, y0).join(" ")} m ${P(x1, y1).join(" ")} l S`);
const rect = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
rect(10, 0, 10.75, 14);                                                  // a 9" wall, 14 ft
seg(9.55, 4, 10, 4); seg(9.55, 4.75, 10, 4.75); seg(9.55, 4, 9.55, 4.75);   // a 0.45 ft nib off its face (door jamb)
rect(9.43, 4, 9.55, 7);                                                  // the door frame beside it
seg(2, 9, 10, 9); seg(2.75, 9.75, 10, 9.75);                             // a 9" wall into it, with a short return at its far end
seg(2, 9, 2, 10.25); seg(2.75, 9.75, 2.75, 10.25); seg(2, 10.25, 2.75, 10.25);
// a door beside a wall corner, as drawn in CAD: the wall over the door broken where a 4.5" partition meets it from above,
// a door leaf / frame drawn inside that wall's band running on past the partition; a jamb stub; a nib below the door with
// its frame running up into the opening; a column; the wall on below it (columns are never bridged)
seg(14, 1, 19, 1); seg(19.375, 1, 30, 1); seg(14.75, 1.75, 30, 1.75); seg(19, -2, 19, 1); seg(19.375, -2, 19.375, 1);
seg(15, 1.5, 21, 1.5);
seg(14, 1, 14, 3); seg(14.75, 1.75, 14.75, 3); seg(14, 3, 14.75, 3);
seg(14, 7, 14.75, 7); seg(14, 7, 14, 9); seg(14.75, 7, 14.75, 9); rect(14.2, 6.3, 14.4, 8.5);
rect(14, 9, 16, 11);
seg(14, 11, 14, 14); seg(14.75, 11, 14.75, 14); seg(14, 14, 14.75, 14);
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(); page.on("pageerror", e => ok(false, "page error: " + e)); page.on("dialog", d => d.dismiss());
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "walls"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "walls.pdf", mimeType: "application/pdf", buffer: pdfFrom([{w: 842, h: 595, content: ["0.6 w"].concat(L).join("\n")}])});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const Z = zdTakeoff; Z.P.proj.scales[Z.S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true};
    const w = Z.wallsAgent({t: 0.75, page: true, bridge: 6});
    return {w, runs: Z.P.proj.items.filter(i => i.wallAuto).map(i => i.pts.map(p => [(p[0] - 100) / 18, (p[1] - 100) / 18]))}; });
  const has = (pts, want) => r.runs.some(q => q.length === want.length && q.every((p, i) => Math.abs(p[0] - want[i][0]) < 0.01 && Math.abs(p[1] - want[i][1]) < 0.01) ||
    q.length === want.length && q.slice().reverse().every((p, i) => Math.abs(p[0] - want[i][0]) < 0.01 && Math.abs(p[1] - want[i][1]) < 0.01));
  if (process.env.TK_DEBUG) console.log(JSON.stringify(r.runs.map(q => q.map(p => p.map(v => +v.toFixed(3))))));
  ok(Math.abs(r.w.total_length_ft - 49.2) < 0.01, `9" walls: 49.200 ft (0.450 nib + 8.500 wall with its return + 14.000; 23.250 wall over the door, its jamb, the door bridged and the nib + 3.000), got ${r.w.total_length_ft}`);
  ok(r.w.runs === 5, `…in 5 runs, got ${r.w.runs}`);
  ok(has(null, [[9.55, 4.375], [10, 4.375]]), "the 0.45 ft nib at the door jamb, from its end to the wall's face");
  ok(has(null, [[2.375, 10.25], [2.375, 9.375], [10, 9.375]]), "the 0.5 ft return joined to its wall on the centre line");
  ok(has(null, [[14.375, 9], [14.375, 1.375], [30, 1.375]]), "the wall over the door (a door leaf drawn in its band) whole, the partition's T bridged; its jamb, the door (bridged, deducted as an opening) and the nib below it, whose frame runs up into the opening, down to the column");
  ok(has(null, [[14.375, 11], [14.375, 14]]), "the wall below the column, not bridged through it (the column is not masonry)");
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

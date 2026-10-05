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
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}});
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
  ok(Math.abs(r.w.total_length_ft - 22.95) < 0.01, `9" walls: 22.950 ft (0.450 nib + 8.500 wall with its return + 14.000), got ${r.w.total_length_ft}`);
  ok(r.w.runs === 3, `…in 3 runs, got ${r.w.runs}`);
  ok(has(null, [[9.55, 4.375], [10, 4.375]]), "the 0.45 ft nib at the door jamb, from its end to the wall's face");
  ok(has(null, [[2.375, 10.25], [2.375, 9.375], [10, 9.375]]), "the 0.5 ft return joined to its wall on the centre line");
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

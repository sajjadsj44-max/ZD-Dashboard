#!/usr/bin/env node
/* Walls agent III — walls a QS found missed (and one wardrobe taken for a wall) on a real floor plan (Jade, 2nd floor DWG),
   drawn here with known answers, 18 pt / ft, on PDF layers "Wall", "Window" and "WOOD PARTITION" (a wall-role layer):
   E. a dashed line (a unit's centre line, a duct's axis) running through a gap in a wall's face does not cut the wall;
   F. an 8" pier beside a wardrobe: the wardrobe's hangers stop at its ends, the pier's faces run on — the pier is a wall;
   G. a wardrobe drawn with its hangers as thin boxes and its frame double ("slats") gives no walls;
   H. a window at a wall's end (between the wall and a cross wall's face) is part of the wall's run;
   I. a wall-role layer switched off is left out of a whole-page run (as a box run always did);
   J. a short stub meeting a wall at 60° (a rotated wing) is kept — the stub rules are not for square corners only;
   K. a 4" wall drawn through an 8" wall: the crossing square is the 8" wall's, not bridged into the 4" one too.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_walls3.js     (pdfjs-dist) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const K = 18, OX = 60, H = 842, P = (x, y) => [(OX + x * K).toFixed(3), (H - (OX + y * K)).toFixed(3)];
const LAY = {W: [], N: [], P: []}; let cur = "W", dash = false;
const seg = (x0, y0, x1, y1) => LAY[cur].push((dash ? "[3 2] 0 d " : "[] 0 d ") + `${P(x0, y0).join(" ")} m ${P(x1, y1).join(" ")} l S`);
const rect = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
const rot = (cx, cy, a) => (x, y) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
// E. an 8" wall x 1-15 (faces y 2 and 2.667), its lower face broken x 6-7.2 (a duct's mouth), a dashed axis through the gap
seg(1, 2, 15, 2); seg(1, 2 + 2 / 3, 6, 2 + 2 / 3); seg(7.2, 2 + 2 / 3, 15, 2 + 2 / 3); seg(1, 2, 1, 2 + 2 / 3); seg(15, 2, 15, 2 + 2 / 3);
seg(6, 2 + 2 / 3, 6, 5); seg(7.2, 2 + 2 / 3, 7.2, 5); dash = true; seg(6.6, 1, 6.6, 6); dash = false;
// F. an 8" pier x 1-1.667, y 7-11.2 between two doors, a 4" wall meeting its right face at y 8.17-8.5, a wardrobe below that
//    (x 1.667-3.667, y 8.5-10.5) with its hangers parallel to the pier
seg(1, 7, 1, 11.2); seg(1, 7, 1 + 2 / 3, 7); seg(1, 11.2, 1 + 2 / 3, 11.2); seg(1 + 2 / 3, 7, 1 + 2 / 3, 8.17); seg(1 + 2 / 3, 8.5, 1 + 2 / 3, 11.2);
seg(1 + 2 / 3, 8.17, 6, 8.17); seg(1 + 2 / 3, 8.5, 6, 8.5);
cur = "P"; rect(1 + 2 / 3, 8.5, 3 + 2 / 3, 10.5); for (let i = 0; i < 6; i++) seg(2 + i / 3, 8.67, 2 + i / 3, 10.33); cur = "W";
// G. a wardrobe (x 20-24, y 6-10.5): frame drawn double, a divider, two hangers drawn as thin boxes 4" apart
cur = "P"; rect(20, 6, 24, 10.5); rect(20.083, 6.083, 23.917, 10.417); seg(21, 6.083, 21, 10.417); seg(21.083, 6.083, 21.083, 10.417);
rect(20.17, 8.0, 21.82, 8.043); rect(20.17, 8.383, 21.82, 8.426); cur = "W";
// H. an 8" wall x 1-5 (faces y 15, 15.667), a 3 ft window x 5-8 at its end (Window layer: frame at both faces, glass), a 4" wall x 8-8.333 across
seg(1, 15, 5, 15); seg(1, 15 + 2 / 3, 5, 15 + 2 / 3); seg(1, 15, 1, 15 + 2 / 3); seg(5, 15, 5, 15 + 2 / 3);
cur = "N"; [0, 0.25, 0.417, 2 / 3].forEach(d => seg(5, 15 + d, 8, 15 + d)); cur = "W";
seg(8, 13, 8, 19); seg(8 + 1 / 3, 13, 8 + 1 / 3, 19); seg(8, 13, 8 + 1 / 3, 13); seg(8, 19, 8 + 1 / 3, 19);
// I. a 4" wall x 20-26 at y 14 on the WOOD PARTITION layer (switched off in the test)
cur = "P"; rect(20, 14, 26, 14 + 1 / 3); cur = "W";
// J. a wing at 60°: a 12 ft 4" wall along 60° from (14, 20), a 4" wall along x 1-13 at y 22 (faces 22, 22.333), and a 1.5 ft
//    4" stub along 60° standing off the x-wall's lower face at x 6
{ const r = rot(14, 20, Math.PI / 3); const q = (a, b, c, d) => { const A = r(a, b), B = r(c, d); seg(A[0], A[1], B[0], B[1]); };
  q(0, 0, 12, 0); q(0, 1 / 3, 12, 1 / 3); q(0, 0, 0, 1 / 3); q(12, 0, 12, 1 / 3); }
seg(1, 22, 13, 22); seg(1, 22 + 1 / 3, 13, 22 + 1 / 3); seg(1, 22, 1, 22 + 1 / 3); seg(13, 22, 13, 22 + 1 / 3);
{ const r = rot(6, 22, -2 * Math.PI / 3), q = (a, b, c, d) => { const A = r(a, b), B = r(c, d); seg(A[0], A[1], B[0], B[1]); };   // from the face y 22 down-left at 60°
  const u = 1 / 3 / Math.sin(Math.PI / 3); q(0, -1 / 6, 1.5, -1 / 6); q(0, 1 / 6, 1.5, 1 / 6); q(1.5, -1 / 6, 1.5, 1 / 6); void u; }
// K. a 4" wall (faces y 30, 30.333) x 1-12 drawn through an 8" wall x 6-6.667 (y 26-34, its faces broken by the 4" wall)
seg(1, 30, 6, 30); seg(6 + 2 / 3, 30, 12, 30); seg(1, 30 + 1 / 3, 6, 30 + 1 / 3); seg(6 + 2 / 3, 30 + 1 / 3, 12, 30 + 1 / 3); seg(1, 30, 1, 30 + 1 / 3); seg(12, 30, 12, 30 + 1 / 3);
seg(6, 26, 6, 30); seg(6, 30 + 1 / 3, 6, 34); seg(6 + 2 / 3, 26, 6 + 2 / 3, 30); seg(6 + 2 / 3, 30 + 1 / 3, 6 + 2 / 3, 34); seg(6, 26, 6 + 2 / 3, 26); seg(6, 34, 6 + 2 / 3, 34);
/* a one-page PDF with three optional-content groups (layers) */
function layeredPdf(){
  const names = {W: "Wall", N: "Window", P: "WOOD PARTITION"}, keys = Object.keys(names);
  const content = ["0.6 w"].concat(keys.map(kk => `/OC /${kk} BDC\n` + LAY[kk].join("\n") + "\nEMC")).join("\n");
  const objs = [], ocg = keys.map((kk, i) => 5 + i);
  objs.push(`<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${ocg.map(n => n + " 0 R").join(" ")}] /D << /Order [${ocg.map(n => n + " 0 R").join(" ")}] /ON [${ocg.map(n => n + " 0 R").join(" ")}] >> >> >>`);
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Contents 4 0 R /Resources << /Properties << ${keys.map((kk, i) => "/" + kk + " " + ocg[i] + " 0 R").join(" ")} >> >> >>`);
  objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  keys.forEach(kk => objs.push(`<< /Type /OCG /Name (${names[kk]}) >>`));
  let out = "%PDF-1.5\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
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
  await page.click("#bNewProj"); await page.fill("#dlgName", "walls 3"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "walls3.pdf", mimeType: "application/pdf", buffer: layeredPdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.ocgs && zdTakeoff.S.ocgs[zdTakeoff.S.fileId] !== undefined, null, {timeout: 20000}); await page.waitForTimeout(500);
  const R = await page.evaluate(() => { const Z = zdTakeoff, S = Z.S; Z.P.proj.scales[S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true};
    const f = T => (Z.findWalls(T, null, 6) || []).map(r => [r.a, r.b].map(p => [+((p[0] - 60) / 18).toFixed(3), +((p[1] - 60) / 18).toFixed(3)]));
    const cfg = S.ocgs[S.fileId], L = Z.layerInfo(S.fileId), out = {layers: L ? Object.values(L).map(l => l.name + ":" + l.role) : null, flags: Z.S.geo[S.key].segs.some(s => s[4] & 2), on: {w4: f(1 / 3), w8: f(2 / 3), w45: f(0.375)}};
    if (cfg) { Object.entries(cfg.getGroups()).forEach(([id, g]) => { if (g.name === "WOOD PARTITION") cfg.setVisibility(id, false); }); out.off = {w4: f(1 / 3)}; Object.keys(cfg.getGroups()).forEach(id => cfg.setVisibility(id, true)); }
    return out; });
  if (process.env.TK_DEBUG) console.log(JSON.stringify(R));
  ok(R.layers && R.layers.length === 3 && R.layers.includes("WOOD PARTITION:wall") && R.layers.includes("Window:opening"), "the PDF's layers are read: Wall, Window, WOOD PARTITION (a wall layer) (" + (R.layers || []).join(", ") + ")");
  ok(R.flags, "the dashed line is read as dashed");
  const len = r => Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]), tot = A => +A.reduce((a, r) => a + len(r), 0).toFixed(3);
  const along = (A, y, x0, x1) => A.filter(r => Math.abs(r[0][1] - y) < 0.02 && Math.abs(r[1][1] - y) < 0.02 && Math.min(r[0][0], r[1][0]) >= x0 - 0.02 && Math.max(r[0][0], r[1][0]) <= x1 + 0.02);
  const alongX = (A, x, y0, y1) => A.filter(r => Math.abs(r[0][0] - x) < 0.02 && Math.abs(r[1][0] - x) < 0.02 && Math.min(r[0][1], r[1][1]) >= y0 - 0.02 && Math.max(r[0][1], r[1][1]) <= y1 + 0.02);
  const inBox = (A, x0, y0, x1, y1) => A.filter(r => r.some(p => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1));
  console.log("E. a dashed line through a wall");
  const E8 = along(R.on.w8, 2 + 1 / 3, 0, 16);
  ok(E8.length === 1 && Math.abs(tot(E8) - 14) < 0.02, "the 8\" wall is one run, 14.000 ft, through the gap the dashed axis crosses (got " + E8.length + " run(s), " + tot(E8) + " ft)");
  console.log("F. a pier beside a wardrobe");
  const F8 = alongX(R.on.w8, 1 + 1 / 3, 6.9, 11.3);
  ok(F8.length === 1 && Math.abs(tot(F8) - 4.2) < 0.02, "the 8\" pier is a wall: one run, 4.200 ft (got " + F8.length + ", " + tot(F8) + ")");
  ok(!inBox(R.on.w4, 1.75, 8.6, 3.6, 10.4).length && !inBox(R.on.w8, 1.75, 8.6, 3.6, 10.4).length, "…and the wardrobe's hangers beside it are still no walls");
  console.log("G. a wardrobe drawn with slats");
  const G = [R.on.w4, R.on.w8, R.on.w45].map(A => inBox(A, 19.9, 5.9, 24.1, 10.6).length);
  ok(G.every(n => n === 0), "no 4\", 8\" or 4.5\" walls in it (" + G.join(" / ") + ")");
  console.log("H. a window at a wall's end");
  const H8 = along(R.on.w8, 15 + 1 / 3, 0, 9);
  ok(H8.length === 1 && Math.abs(tot(H8) - 7) < 0.02, "the 8\" wall's run takes its window to the cross wall's face: x 1 → 8, 7.000 ft (got " + JSON.stringify(H8) + ")");
  console.log("I. a wall layer switched off");
  ok(inBox(R.on.w4, 19.9, 13.9, 26.1, 14.4).length === 1, "with the WOOD PARTITION layer on, its 4\" wall is found");
  ok(R.off && inBox(R.off.w4, 19.9, 13.9, 26.1, 14.4).length === 0, "switched off, a whole-page run leaves it out (got " + (R.off ? inBox(R.off.w4, 19.9, 13.9, 26.1, 14.4).length : "no layers") + ")");
  console.log("J. a stub at 60°");
  const J = inBox(R.on.w4, 4.9, 20.3, 6.3, 21.95);
  ok(J.length === 1 && Math.abs(len(J[0]) - 1.5) < 0.25, "the 1.5 ft stub standing off the wall at 60° is kept (got " + JSON.stringify(J) + ")");
  console.log("K. a 4\" wall drawn through an 8\" wall");
  const K4 = along(R.on.w4, 30 + 1 / 6, 0, 13), K8 = alongX(R.on.w8, 6 + 1 / 3, 25, 35);
  ok(K4.length === 2 && Math.abs(tot(K4) - 10.333) < 0.02, "the 4\" wall stops at the 8\" wall's faces: 2 runs, 10.333 ft (got " + K4.length + ", " + tot(K4) + ")");
  ok(K8.length === 1 && Math.abs(tot(K8) - 8) < 0.02, "the 8\" wall runs through: 8.000 ft (got " + K8.length + ", " + tot(K8) + ")");
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

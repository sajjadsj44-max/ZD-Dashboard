#!/usr/bin/env node
/* QA drawing set for the PDF Takeoff app (tools/test_takeoff_qa.js): PDFs written by hand, no library, so every
   dimension in them is known exactly.

     node tools/takeoff_qa_fixture.js out.pdf       # write the 8-page set
     node tools/takeoff_qa_fixture.js big.pdf 120   # a 120-page set (performance)

   p.1  ARCH D 2592 × 1728 pt, "SCALE 1/4" = 1'-0"" (18 pt per ft): a house — 3 bed rooms, 2 baths, living, kitchen,
        corridor, store — 9" outer walls and 4.5" partitions drawn as each room's inside face, 3' doors (2'6" to the
        baths) with leaf and swing, windows in the outer walls, a bed against a wall, a table, a kitchen counter, the
        room names and their sizes. Clear sizes (HOUSE below): bed rooms 12 × 12, baths 6 × 12, corridor 30.75 × 4,
        living 18.375 × 14, kitchen 12 × 14, store 12 × 12.
   p.2  842 × 595 pt with /Rotate 90, "SCALE 1/8" = 1'-0"": one 20'-0" line (shown turned on screen).
   p.3  MediaBox [100 100 942 695] (not at 0,0), "SCALE 1/8" = 1'-0"": one 10'-0" line from (150, 150).
   p.4  blank A4 page (no text, no lines).
   p.5  A3 landscape "SCALE 1:50": one line 5000 mm long on the ground = 100 mm on paper = 283.465 pt.
   p.6  842 × 595 "SCALE 3/16" = 1'-0"" (13.5 pt per ft): one 16'-0" line; a detail box "DETAIL A  SCALE 1-1/2" = 1'-0"".
   p.7  ARCH D at 1/4" = 1'-0": rooms for auto area — a 10 × 10 room with a tile hatch, a 10 × 10 room turned 45°, a round
        room of radius 6 ft (113.097 Sft), an L-shaped room 12 × 12 less 6 × 6 (108 Sft).
   p.8  A4 portrait 595 × 842, no scale note (mixed page sizes), one 90 pt line.
   Coordinates in the tables are the app's (y down from the top of the page). */
const S1 = 18, OX = 200, OY = 150;   // p.1: 1/4" = 1'-0", house origin (outer corner) at (200, 150) pt
const ft = v => v * S1;
const X = {e0: 0, a0: 0.75, a1: 12.75, b0: 13.125, b1: 19.125, c0: 19.5, c1: 31.5, e1: 32.25};
const Y = {e0: 0, r1a: 0.75, r1b: 12.75, r2a: 13.125, r2b: 17.125, r3a: 17.5, r3b: 31.5, r4a: 31.875, r4b: 43.875, e1: 44.625};
/* rooms: name, x0, y0, x1, y1 (ft from the outer corner), written size */
const HOUSE = [
  ["BED ROOM 1", X.a0, Y.r1a, X.a1, Y.r1b, "12'-0\"x12'-0\""], ["BATH 1", X.b0, Y.r1a, X.b1, Y.r1b, "6'-0\"x12'-0\""], ["BED ROOM 2", X.c0, Y.r1a, X.c1, Y.r1b, "12'-0\"x12'-0\""],
  ["CORRIDOR", X.a0, Y.r2a, X.c1, Y.r2b, ""], ["LIVING", X.a0, Y.r3a, X.b1, Y.r3b, "18'-4 1/2\"x14'-0\""], ["KITCHEN", X.c0, Y.r3a, X.c1, Y.r3b, "12'-0\"x14'-0\""],
  ["BED ROOM 3", X.a0, Y.r4a, X.a1, Y.r4b, "12'-0\"x12'-0\""], ["BATH 2", X.b0, Y.r4a, X.b1, Y.r4b, "6'-0\"x12'-0\""], ["STORE", X.c0, Y.r4a, X.c1, Y.r4b, "12'-0\"x12'-0\""]];
/* doors: in a horizontal partition between y top face ya and bottom face yb, from x d0 to d1, swing into the room above (up) or below (down) */
const DOORS = [[4, 7, Y.r1b, Y.r2a, "up", "D1"], [14, 16.5, Y.r1b, Y.r2a, "up", "D2"], [23, 26, Y.r1b, Y.r2a, "up", "D1"],
  [5, 8, Y.r2b, Y.r3a, "down", "D1"], [22, 25, Y.r2b, Y.r3a, "down", "D1"],
  [4, 7, Y.r3b, Y.r4a, "down", "D1"], [14, 16.5, Y.r3b, Y.r4a, "down", "D2"], [23, 26, Y.r3b, Y.r4a, "down", "D1"]];
const ENTRY = [13.625, 16.625];   // main door in the left outer wall of the corridor (y range)
const WINDOWS = [["top", 4, 8], ["top", 14.5, 17.5], ["top", 23.5, 27.5], ["left", 21, 27], ["right", 21, 26], ["bottom", 4, 8], ["bottom", 14.5, 17.5], ["bottom", 23.5, 27.5]];

function linesHouse(H){
  const L = [], seg = (x0, y0, x1, y1) => L.push(`${(OX + ft(x0)).toFixed(3)} ${(H - OY - ft(y0)).toFixed(3)} m ${(OX + ft(x1)).toFixed(3)} ${(H - OY - ft(y1)).toFixed(3)} l S`);
  const curve = (p0, c1, c2, p1) => L.push([p0, c1, c2].map((p, i) => `${(OX + ft(p[0])).toFixed(3)} ${(H - OY - ft(p[1])).toFixed(3)}${i ? "" : " m"}`).join(" ").replace(/ m (.*)$/, " m $1") + ` ${(OX + ft(p1[0])).toFixed(3)} ${(H - OY - ft(p1[1])).toFixed(3)} c S`);
  // a horizontal face from x0 to x1 at y, broken where a door opening is
  const hface = (x0, x1, y, gaps) => { let x = x0; gaps.filter(g => g[1] > x0 && g[0] < x1).sort((a, b) => a[0] - b[0]).forEach(g => { if (g[0] > x) seg(x, y, g[0], y); x = Math.max(x, g[1]); }); if (x < x1) seg(x, y, x1, y); };
  const vface = (x, y0, y1, gaps) => { let y = y0; gaps.filter(g => g[1] > y0 && g[0] < y1).sort((a, b) => a[0] - b[0]).forEach(g => { if (g[0] > y) seg(x, y, x, g[0]); y = Math.max(y, g[1]); }); if (y < y1) seg(x, y, x, y1); };
  // outer face of the building, the entrance broken out
  hface(X.e0, X.e1, Y.e0, []); hface(X.e0, X.e1, Y.e1, []); vface(X.e1, Y.e0, Y.e1, []); vface(X.e0, Y.e0, Y.e1, [ENTRY]);
  // each room's inside face, with the doors on it broken out
  HOUSE.forEach(([nm, x0, y0, x1, y1]) => {
    const onY = y => DOORS.filter(d => (Math.abs(d[2] - y) < 1e-9 || Math.abs(d[3] - y) < 1e-9) && d[1] > x0 && d[0] < x1).map(d => [d[0], d[1]]);
    hface(x0, x1, y0, onY(y0)); hface(x0, x1, y1, onY(y1));
    vface(x0, y0, y1, nm === "CORRIDOR" ? [ENTRY] : []); vface(x1, y0, y1, []);
  });
  // door jambs, leaves and swings
  DOORS.forEach(([d0, d1, ya, yb, dir]) => { seg(d0, ya, d0, yb); seg(d1, ya, d1, yb);
    const w = d1 - d0, k = 0.5523 * w, hy = dir === "up" ? ya : yb, s = dir === "up" ? -1 : 1;
    seg(d0, hy, d0, hy + s * w);                                                     // leaf, open
    curve([d0, hy + s * w], [d0 + k, hy + s * w], [d1, hy + s * k], [d1, hy]); });  // swing to the far jamb
  seg(X.e0, ENTRY[0], X.a0, ENTRY[0]); seg(X.e0, ENTRY[1], X.a0, ENTRY[1]);        // entrance jambs
  // windows: two glass lines in the middle of the 9" outer wall
  WINDOWS.forEach(([side, a, b]) => { for (const o of [0.3, 0.45]) {
    if (side === "top") seg(a, o, b, o); else if (side === "bottom") seg(a, Y.e1 - o, b, Y.e1 - o); else if (side === "left") seg(o, a, o, b); else seg(X.e1 - o, a, X.e1 - o, b); } });
  // furniture: a bed against the top wall of bed room 1 (with a pillow), a table in the living, a counter along the kitchen's right wall
  const box = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
  box(3.75, Y.r1a, 8.75, 7.25); box(4.25, 1.25, 8.25, 2.75);
  box(7, 21.5, 11, 27.5);
  box(29.5, Y.r3a, X.c1, Y.r3b);
  return L;
}
function textsHouse(H){
  const T = [["SCALE 1/4\" = 1'-0\"", 2200, 120, 14], ["GROUND FLOOR PLAN", 2200, 150, 14]];
  HOUSE.forEach(([nm, x0, y0, x1, y1, sz]) => { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + (nm === "BED ROOM 1" ? 2 : nm === "KITCHEN" ? -3 : 0);
    T.push([nm, OX + ft(cx) - nm.length * 3, H - OY - ft(cy), 10]); if (sz) T.push([sz, OX + ft(cx) - sz.length * 2.6, H - OY - ft(cy) - 13, 8]); });
  DOORS.forEach(([d0, d1, ya, yb, dir, tag]) => T.push([tag, OX + ft((d0 + d1) / 2) - 5, H - OY - ft((ya + yb) / 2) - 3, 7]));
  T.push(["D1", OX + ft(1.6), H - OY - ft(15.4), 7]);
  WINDOWS.forEach(([side, a, b], i) => { const m = (a + b) / 2, tag = "W" + (i < 3 || i > 5 ? 1 : 2), p = side === "top" ? [m, -1.4] : side === "bottom" ? [m, Y.e1 + 1.8] : side === "left" ? [-2.2, m] : [X.e1 + 0.8, m];
    T.push([tag, OX + ft(p[0]) - 5, H - OY - ft(p[1]), 7]); });
  return T;
}
const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const text = T => T.map(([s, x, y, sz]) => `BT /F1 ${sz} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);

/* ------------------------------------------------------------------ the pages */
const A3W = 1190.55, A3H = 841.89, AD_W = 2592, AD_H = 1728;
const MM = 72 / 25.4;
function pages(){
  const P = [];
  P.push({w: AD_W, h: AD_H, content: ["0.5 w"].concat(linesHouse(AD_H), text(textsHouse(AD_H))).join("\n")});
  // p.2 turned 90°: the content is written unturned; the viewer shows it turned
  P.push({w: 842, h: 595, rotate: 90, content: ["0.6 w", `100 300 m ${(100 + 20 * 9).toFixed(3)} 300 l S`, "BT /F1 9 Tf 560 70 Td (SCALE 1/8\" = 1'-0\") Tj ET", "BT /F1 8 Tf 150 310 Td (20'-0\") Tj ET"].join("\n")});
  // p.3 page box not at 0,0
  P.push({w: 842, h: 595, box: [100, 100, 942, 695], content: ["0.6 w", `150 150 m ${(150 + 10 * 9).toFixed(3)} 150 l S`, "BT /F1 9 Tf 700 120 Td (SCALE 1/8\" = 1'-0\") Tj ET", "BT /F1 8 Tf 170 160 Td (10'-0\") Tj ET"].join("\n")});
  P.push({w: 595.28, h: 841.89, content: ""});
  // p.5 metric: 5000 mm at 1:50 = 100 mm on paper
  P.push({w: A3W, h: A3H, content: ["0.6 w", `100 400 m ${(100 + 100 * MM).toFixed(4)} 400 l S`, `100 395 m 100 405 l S`, `${(100 + 100 * MM).toFixed(4)} 395 m ${(100 + 100 * MM).toFixed(4)} 405 l S`,
    "BT /F1 9 Tf 900 60 Td (SCALE 1:50) Tj ET", "BT /F1 8 Tf 160 410 Td (5000) Tj ET"].join("\n")});
  // p.6 3/16" = 1'-0" (13.5 pt / ft) and a detail drawn at 1-1/2" = 1'-0" (108 pt / ft)
  P.push({w: 842, h: 595, content: ["0.6 w", `100 300 m ${(100 + 16 * 13.5).toFixed(3)} 300 l S`, "BT /F1 9 Tf 560 70 Td (SCALE 3/16\" = 1'-0\") Tj ET", "BT /F1 8 Tf 150 310 Td (16'-0\") Tj ET",
    "450 150 m 800 150 l 800 450 l 450 450 l h S", `480 200 m ${(480 + 2 * 108).toFixed(3)} 200 l S`, "BT /F1 8 Tf 460 430 Td (DETAIL A  SCALE 1-1/2\" = 1'-0\") Tj ET", "BT /F1 8 Tf 540 208 Td (2'-0\") Tj ET"].join("\n")});
  // p.7 auto-area rooms (1/4" = 1'-0", 18 pt / ft), each with a 9" wall drawn as two faces
  P.push({w: AD_W, h: AD_H, content: ["0.5 w"].concat(rooms7(AD_H)).join("\n")});
  P.push({w: 595.28, h: 841.89, content: ["0.6 w", "100 500 m 190 500 l S", "BT /F1 8 Tf 130 508 Td (5'-0\") Tj ET"].join("\n")});
  return P;
}
/* p.7 rooms, app coordinates (y down) in pt: [name, cx, cy] (a point inside), expected Sft */
const R7 = {hatch: [400, 400, 100], turned: [900, 400, 100], round: [1400, 400, Math.PI * 36], ell: [400 + 3 * 18, 1000 + 3 * 18, 108]};
function rooms7(H){
  const L = [], ln = (a, b) => L.push(`${a[0].toFixed(3)} ${(H - a[1]).toFixed(3)} m ${b[0].toFixed(3)} ${(H - b[1]).toFixed(3)} l S`), poly = Q => Q.forEach((q, i) => ln(q, Q[(i + 1) % Q.length]));
  const sq = (cx, cy, half, rot) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = u * half, y = v * half, c = Math.cos(rot), s = Math.sin(rot); return [cx + x * c - y * s, cy + x * s + y * c]; });
  // 10 × 10 room with 9" walls and a 1 ft tile hatch on its floor
  poly(sq(400, 400, 5 * 18, 0)); poly(sq(400, 400, 5.75 * 18, 0));
  for (let i = 1; i < 10; i++) { ln([310 + i * 18, 310], [310 + i * 18, 490]); ln([310, 310 + i * 18], [490, 310 + i * 18]); }
  // the same room turned 45°
  poly(sq(900, 400, 5 * 18, Math.PI / 4)); poly(sq(900, 400, 5.75 * 18, Math.PI / 4));
  // round room r 6 ft, wall 9": circles as 4 Bezier quarters
  const circ = (cx, cy, r) => { const k = 0.5523 * r; L.push(`${(cx + r).toFixed(3)} ${(H - cy).toFixed(3)} m ${(cx + r).toFixed(3)} ${(H - cy - k).toFixed(3)} ${(cx + k).toFixed(3)} ${(H - cy - r).toFixed(3)} ${cx.toFixed(3)} ${(H - cy - r).toFixed(3)} c ${(cx - k).toFixed(3)} ${(H - cy - r).toFixed(3)} ${(cx - r).toFixed(3)} ${(H - cy - k).toFixed(3)} ${(cx - r).toFixed(3)} ${(H - cy).toFixed(3)} c ${(cx - r).toFixed(3)} ${(H - cy + k).toFixed(3)} ${(cx - k).toFixed(3)} ${(H - cy + r).toFixed(3)} ${cx.toFixed(3)} ${(H - cy + r).toFixed(3)} c ${(cx + k).toFixed(3)} ${(H - cy + r).toFixed(3)} ${(cx + r).toFixed(3)} ${(H - cy + k).toFixed(3)} ${(cx + r).toFixed(3)} ${(H - cy).toFixed(3)} c S`); };
  circ(1400, 400, 6 * 18); circ(1400, 400, 6.75 * 18);
  // L-shaped room: 12 × 12 less the 6 × 6 top-right corner
  const ell = (o) => [[400 - o, 1000 - o], [400 + 6 * 18 + o, 1000 - o], [400 + 6 * 18 + o, 1000 + 6 * 18 - o], [400 + 12 * 18 + o, 1000 + 6 * 18 - o], [400 + 12 * 18 + o, 1000 + 12 * 18 + o], [400 - o, 1000 + 12 * 18 + o]];
  poly(ell(0)); poly(ell(0.75 * 18));
  L.push(`BT /F1 14 Tf 2200 ${(H - 120).toFixed(2)} Td (SCALE 1/4" = 1'-0") Tj ET`);
  return L;
}
function bigPages(n){
  const P = [];
  for (let i = 1; i <= n; i++) { const w = i % 3 === 0 ? A3W : 842, h = i % 3 === 0 ? A3H : 595;
    const c = ["0.6 w"]; for (let j = 0; j < 40; j++) c.push(`${100 + j * 15} 100 m ${100 + j * 15} 400 l S`);
    c.push(`BT /F1 9 Tf 560 70 Td (SCALE 1/8" = 1'-0") Tj ET`, `BT /F1 12 Tf 100 450 Td (SHEET A-${String(100 + i)}) Tj ET`);
    P.push({w, h, content: c.join("\n")}); }
  return P;
}

/* ------------------------------------------------------------------ the PDF writer */
function pdfFrom(P){
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], kids = [];
  P.forEach(pg => {
    const cid = objs.length + 2, pid = objs.length + 1, box = pg.box || [0, 0, pg.w, pg.h];
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [${box.join(" ")}]${pg.rotate ? " /Rotate " + pg.rotate : ""} /Contents ${cid} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(pg.content, "latin1")} >>\nstream\n${pg.content}\nendstream`);
    kids.push(pid + " 0 R");
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${P.length} >>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
/* a scanned drawing: the house of p.1 as a 200 dpi grey image (no text, no lines to snap to), 24 × 18 in page; and a heavy
   CAD page: n short hatch strokes over the same house */
function makeScanPdf(){
  const zlib = require("zlib"), dpi = 200, W = 24 * dpi, H = 18 * dpi, px = new Uint8Array(W * H).fill(255), sc = dpi / 72;   // page pt -> px
  const fill = (x0, y0, x1, y1) => { for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) px.fill(0, y * W + Math.max(0, Math.round(x0)), y * W + Math.min(W, Math.round(x1))); };
  const P = v => (OX + v * S1) * sc, Q = v => (OY + v * S1) * sc;   // house ft -> px (same place as p.1, the page 1728 × 1296 pt)
  // walls as solid bands between their faces: outer 9", partitions 4.5"
  const band = (x0, y0, x1, y1) => fill(P(x0), Q(y0), P(x1), Q(y1));
  band(X.e0, Y.e0, X.e1, Y.r1a); band(X.e0, Y.r4b, X.e1, Y.e1); band(X.e0, Y.e0, X.a0, ENTRY[0]); band(X.e0, ENTRY[1], X.a0, Y.e1); band(X.c1, Y.e0, X.e1, Y.e1);
  const hp = (y0, y1, gaps) => { let x = X.a0; gaps.sort((a, b) => a[0] - b[0]).forEach(g => { band(x, y0, g[0], y1); x = g[1]; }); band(x, y0, X.c1, y1); };
  hp(Y.r1b, Y.r2a, DOORS.filter(d => d[2] === Y.r1b).map(d => [d[0], d[1]])); hp(Y.r2b, Y.r3a, DOORS.filter(d => d[2] === Y.r2b).map(d => [d[0], d[1]])); hp(Y.r3b, Y.r4a, DOORS.filter(d => d[2] === Y.r3b).map(d => [d[0], d[1]]));
  band(X.a1, Y.r1a, X.b0, Y.r1b); band(X.b1, Y.r1a, X.c0, Y.r1b); band(X.b1, Y.r3a, X.c0, Y.r3b); band(X.a1, Y.r4a, X.b0, Y.r4b); band(X.b1, Y.r4a, X.c0, Y.r4b);
  // scan noise: a few specks and a 10'-0" scale bar under the plan (its ends ticked)
  for (let i = 0; i < 4000; i++) { const x = (i * 7919) % W, y = (i * 104729) % H; px[y * W + x] = 90; }
  band(0, 47, 10, 47.1); band(0, 46.6, 0.06, 47.5); band(9.94, 46.6, 10, 47.5);
  const img = zlib.deflateSync(Buffer.from(px), {level: 6}), pw = W / sc, ph = H / sc;
  const content = `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /Im1 Do Q`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  const head = `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`;
  const parts = []; let len = 0; const add = b => { parts.push(b); len += b.length; }, offs = [];
  add(Buffer.from("%PDF-1.4\n", "latin1"));
  objs.forEach((o, i) => { offs.push(len); add(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")); });
  offs.push(len); add(Buffer.from(`5 0 obj\n${head}`, "latin1")); add(img); add(Buffer.from("\nendstream\nendobj\n", "latin1"));
  const x = len; add(Buffer.from(`xref\n0 6\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}
function makeHeavyPdf(n){   // the p.1 house with n short diagonal hatch strokes on its walls' outside (a dense CAD sheet)
  const c = ["0.5 w"].concat(linesHouse(AD_H), text(textsHouse(AD_H)), ["0.2 w"]);
  for (let i = 0; i < (n || 150000); i++) { const x = 1300 + (i % 600) * 2, y = 100 + Math.floor(i / 600) * 6; c.push(`${x} ${AD_H - y} m ${x + 4} ${AD_H - y - 4} l S`); }
  return pdfFrom([{w: AD_W, h: AD_H, content: c.join("\n")}]);
}
const makeQaPdf = () => pdfFrom(pages());
const makeBigPdf = n => pdfFrom(bigPages(n || 120));
/* a room's clear rectangle in page points (app coordinates) */
const roomRect = nm => { const r = HOUSE.find(x => x[0] === nm); return [OX + ft(r[1]), OY + ft(r[2]), OX + ft(r[3]), OY + ft(r[4])]; };
module.exports = {makeScanPdf, makeHeavyPdf, makeQaPdf, makeBigPdf, pdfFrom, HOUSE, DOORS, WINDOWS, ENTRY, R7, S1, OX, OY, X, Y, roomRect, MM, AD_W, AD_H};
if (require.main === module) { const n = +process.argv[3]; require("fs").writeFileSync(process.argv[2] || "takeoff_qa.pdf", n ? makeBigPdf(n) : makeQaPdf()); console.log("written", process.argv[2] || "takeoff_qa.pdf"); }

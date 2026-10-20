#!/usr/bin/env node
/* Apartment floor plan with known quantities, for the accuracy tests (tools/test_takeoff_accuracy.js). Written by hand —
   no PDF library — so every dimension is exact. The same plan is drawn on three pages at three scales:

     p.1  ARCH D 2592 × 1728 pt, SCALE 1/4" = 1'-0"   (18 pt per ft)
     p.2  A3 1190.55 × 841.89 pt, SCALE 1:100         (8.64 pt per ft — 304.8 mm at 1:100 = 3.048 mm on paper)
     p.3  842 × 595 pt with /Rotate 90, SCALE 1/8" = 1'-0"   (9 pt per ft; shown turned on screen)

   so a quantity that changes with the page's scale, units or rotation shows up as a difference between pages.

     node tools/takeoff_apartment_fixture.js out.pdf

   Plan (feet, x right / y down from the building's outer top-left corner): 9" outer walls (0.75 ft), 4.5" partitions
   (0.375 ft) drawn as each room's inside face; doors with jambs, leaf and swing; windows as glass lines in the outer
   wall; room names with their written sizes; furniture and a dimension string outside the building.

     BED ROOM 1 12 × 13 = 156.000 Sft   BATH 1 6 × 8 = 48.000   BATH 2 5 × 8 = 40.000   BED ROOM 2 13 × 13 = 169.000
     CORRIDOR (T-shaped, round the two baths' doors) 37.125 × 4 + 11.375 × 5 = 205.375 Sft
     LIVING 18 × 14 = 252.000   KITCHEN 10 × 14 = 140.000   STORE 8.375 × 14 = 117.250        total 1,127.625 Sft

   Walls on the centre line, openings carried through (the house rule): 9" outer = 2 × (37.875 + 32.5) = 140.750 ft;
   4.5" partitions each to the face of the wall it meets (a T stops at the face; at an L one runs to the corner) =
   13.375 + 8 + 13.375 + 11.375 + 12 + 13 + 37.125 + 14 + 14 = 136.250 ft. */
const T9 = 0.75, T4 = 0.375;
const W = 38.625, H = 33.25;                                  // outer size
/* rooms: name, inside-face outline (clockwise, y down), written size */
const ROOMS = [
  ["BED ROOM 1", [[0.75, 0.75], [12.75, 0.75], [12.75, 13.75], [0.75, 13.75]], "12'-0\"x13'-0\""],
  ["BATH 1", [[13.125, 0.75], [19.125, 0.75], [19.125, 8.75], [13.125, 8.75]], "6'-0\"x8'-0\""],
  ["BATH 2", [[19.5, 0.75], [24.5, 0.75], [24.5, 8.75], [19.5, 8.75]], "5'-0\"x8'-0\""],
  ["BED ROOM 2", [[24.875, 0.75], [37.875, 0.75], [37.875, 13.75], [24.875, 13.75]], "13'-0\"x13'-0\""],
  ["CORRIDOR", [[0.75, 14.125], [13.125, 14.125], [13.125, 9.125], [24.5, 9.125], [24.5, 14.125], [37.875, 14.125], [37.875, 18.125], [0.75, 18.125]], ""],
  ["LIVING", [[0.75, 18.5], [18.75, 18.5], [18.75, 32.5], [0.75, 32.5]], "18'-0\"x14'-0\""],
  ["KITCHEN", [[19.125, 18.5], [29.125, 18.5], [29.125, 32.5], [19.125, 32.5]], "10'-0\"x14'-0\""],
  ["STORE", [[29.5, 18.5], [37.875, 18.5], [37.875, 32.5], [29.5, 32.5]], "8'-4 1/2\"x14'-0\""]];
/* where each room's label goes (and the Auto-area click): its centre, or a clear spot for the corridor */
const SEED = {"CORRIDOR": [6, 16.125], "BED ROOM 1": [6.75, 9.5], "BED ROOM 2": [31.375, 10.5], "LIVING": [5, 24]};
/* doors: wall direction ("h" = in a horizontal wall, gap along x; "v" = in a vertical wall, gap along y), gap from a0 to a1,
   the wall's two faces, which way the leaf swings, tag */
const DOORS = [
  ["h", 4, 7, 13.75, 14.125, "up", "D1"], ["h", 28, 31, 13.75, 14.125, "up", "D1"],          // bed rooms, off the corridor
  ["h", 14.5, 17, 8.75, 9.125, "up", "D2"], ["h", 20.5, 23, 8.75, 9.125, "up", "D2"],        // the baths, off the corridor stub
  ["h", 5, 8, 18.125, 18.5, "down", "D1"], ["h", 22, 25, 18.125, 18.5, "down", "D1"], ["h", 31, 34, 18.125, 18.5, "down", "D1"],
  ["v", 14.625, 17.625, 0, 0.75, "right", "D3"]];                                              // the entrance, in the outer wall
/* windows: side of the outer wall, from, to, tag */
const WINDOWS = [["top", 4, 8, "W1"], ["top", 15, 17, "V1"], ["top", 21, 23, "V1"], ["top", 29, 33, "W1"],
  ["bottom", 5, 11, "W2"], ["bottom", 22, 26, "W1"], ["right", 23, 27, "W1"]];
const REF = {
  rooms: Object.fromEntries(ROOMS.map(([n, pts]) => [n, {area: polyArea(pts), perim: polyPerim(pts)}])),
  wall9: 140.75, wall4: 136.25,
  doors: {D1: 5, D2: 2, D3: 1}, windows: {W1: 4, W2: 1, V1: 2}};
function polyArea(p){ let a = 0; p.forEach((q, i) => { const r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }); return Math.abs(a) / 2; }
function polyPerim(p){ return p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + Math.hypot(r[0] - q[0], r[1] - q[1]); }, 0); }

/* the plan as PDF content: k pt per ft, building corner at (ox, oy) measured from the page's top-left, page height ph */
function plan(k, ox, oy, ph, note){
  const L = [], X = x => (ox + x * k).toFixed(3), Y = y => (ph - oy - y * k).toFixed(3);
  const seg = (x0, y0, x1, y1) => L.push(`${X(x0)} ${Y(y0)} m ${X(x1)} ${Y(y1)} l S`);
  const curve = (p0, c1, c2, p1) => L.push(`${X(p0[0])} ${Y(p0[1])} m ${X(c1[0])} ${Y(c1[1])} ${X(c2[0])} ${Y(c2[1])} ${X(p1[0])} ${Y(p1[1])} c S`);
  const box = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
  const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const text = (s, x, y, sz) => L.push(`BT /F1 ${sz.toFixed(2)} Tf ${X(x)} ${Y(y)} Td (${esc(s)}) Tj ET`);
  // a face from a to b (one axis fixed), broken where a door's gap lies on it
  const gapsOn = (dir, at) => DOORS.filter(d => d[0] === dir && (Math.abs(d[3] - at) < 1e-9 || Math.abs(d[4] - at) < 1e-9)).map(d => [d[1], d[2]]);
  const face = (p, q) => {
    const horiz = Math.abs(p[1] - q[1]) < 1e-9, at = horiz ? p[1] : p[0], a0 = Math.min(horiz ? p[0] : p[1], horiz ? q[0] : q[1]), a1 = Math.max(horiz ? p[0] : p[1], horiz ? q[0] : q[1]);
    let a = a0; gapsOn(horiz ? "h" : "v", at).filter(g => g[1] > a0 && g[0] < a1).sort((u, v) => u[0] - v[0]).forEach(g => {
      if (g[0] > a) horiz ? seg(a, at, g[0], at) : seg(at, a, at, g[0]); a = Math.max(a, g[1]); });
    if (a < a1) horiz ? seg(a, at, a1, at) : seg(at, a, at, a1);
  };
  L.push("0.8 w");
  [[[0, 0], [W, 0]], [[W, 0], [W, H]], [[W, H], [0, H]], [[0, H], [0, 0]]].forEach(([p, q]) => face(p, q));   // outer face
  ROOMS.forEach(([, pts]) => pts.forEach((p, i) => face(p, pts[(i + 1) % pts.length])));                     // inside faces
  L.push("0.35 w");
  DOORS.forEach(([dir, a0, a1, f0, f1, sw]) => {                       // jambs, leaf (open) and swing to the far jamb
    const w = a1 - a0, c = 0.5523 * w;
    if (dir === "h") { seg(a0, f0, a0, f1); seg(a1, f0, a1, f1);
      const hy = sw === "up" ? f0 : f1, s = sw === "up" ? -1 : 1;
      seg(a0, hy, a0, hy + s * w); curve([a0, hy + s * w], [a0 + c, hy + s * w], [a1, hy + s * c], [a1, hy]); }
    else { seg(f0, a0, f1, a0); seg(f0, a1, f1, a1);
      const hx = f1; seg(hx, a0, hx + w, a0); curve([hx + w, a0], [hx + w, a0 + c], [hx + c, a1], [hx, a1]); }
  });
  WINDOWS.forEach(([side, a, b]) => { for (const o of [0.3, 0.45]) {   // two glass lines in the middle of the outer wall
    if (side === "top") seg(a, o, b, o); else if (side === "bottom") seg(a, H - o, b, H - o); else if (side === "left") seg(o, a, o, b); else seg(W - o, a, W - o, b); } });
  // furniture (closed boxes inside the rooms, never touching two walls) and fittings in the baths
  box(3.5, 0.75, 8.5, 7.5); box(4, 1.25, 8, 2.5);                       // bed and pillow against BED ROOM 1's top wall
  box(28.5, 0.75, 33.5, 7.5);                                           // bed in BED ROOM 2
  box(14, 1.5, 15.5, 4); box(17.6, 1.5, 18.9, 2.6);                     // WC and basin in BATH 1
  box(20, 1.5, 21.5, 4);                                                // WC in BATH 2
  box(7, 23, 11, 28);                                                   // table in the living
  box(19.125, 30.5, 29.125, 32.5);                                      // kitchen counter along the bottom wall
  // a dimension string above the building: dimension line, ticks and extension lines, the overall length written on it
  seg(0, -3, W, -3); seg(0, -3.6, 0, -0.4); seg(W, -3.6, W, -0.4); seg(-0.3, -3.3, 0.3, -2.7); seg(W - 0.3, -3.3, W + 0.3, -2.7);
  text("38'-7 1/2\"", W / 2 - 1.5, -3.4, k * 0.5);
  // labels
  ROOMS.forEach(([nm, pts, sz]) => {
    const c = SEED[nm] || [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2];
    text(nm, c[0] - nm.length * 0.17, c[1] - 0.6, k * 0.55); if (sz) text(sz, c[0] - sz.length * 0.13, c[1] + 0.6, k * 0.42);
  });
  DOORS.forEach(([dir, a0, a1, f0, f1, , tag]) => dir === "h" ? text(tag, (a0 + a1) / 2 - 0.4, (f0 + f1) / 2 + (f0 < 10 ? 1.6 : -1.2), k * 0.4) : text(tag, f1 + 0.4, (a0 + a1) / 2 + 0.2, k * 0.4));
  WINDOWS.forEach(([side, a, b, tag]) => { const m = (a + b) / 2, p = side === "top" ? [m - 0.4, -0.8] : side === "bottom" ? [m - 0.4, H + 1.4] : side === "left" ? [-2, m] : [W + 0.6, m];
    text(tag, p[0], p[1], k * 0.4); });
  text("SCALE " + note, 0, H + 4, Math.max(8, k * 0.6)); text("APARTMENT TYPE A - FLOOR PLAN", 0, H + 5.5, Math.max(8, k * 0.6));
  return L.join("\n");
}
/* the three pages: size, scale (pt per ft), where the building sits, the note, rotation */
const PAGES = [
  {w: 2592, h: 1728, k: 18, ox: 300, oy: 250, note: "1/4\" = 1'-0\""},
  {w: 1190.55, h: 841.89, k: 72 / 25.4 * 304.8 / 100, ox: 150, oy: 120, note: "1:100"},
  {w: 842, h: 595, k: 9, ox: 120, oy: 110, note: "1/8\" = 1'-0\"", rotate: 90}];
/* a point of the plan (ft) in PDF user space (y up) on page i (0-based) */
const toPdf = (i, x, y) => { const g = PAGES[i]; return [g.ox + x * g.k, g.h - g.oy - y * g.k]; };
/* the Auto-area click for a room: its label spot (its centre, or SEED) */
const seedOf = nm => { const r = ROOMS.find(q => q[0] === nm), pts = r[1]; return SEED[nm] || [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2 + 1.5]; };
function pdf(){
  const {pdfFrom} = require("./takeoff_qa_fixture.js");
  return pdfFrom(PAGES.map(g => ({w: g.w, h: g.h, rotate: g.rotate, content: plan(g.k, g.ox, g.oy, g.h, g.note)})));
}
/* rooms drawn turned: a 12 × 14 ft room (168 Sft clear) with 9" walls, turned 3°, 8°, 12° and 30°, one per page at 1/4" = 1'-0".
   Its centre is at (600, 400) pt; TURNED lists the angles in page order */
const TURNED = [3, 8, 12, 30];
function turnedPdf(){
  const {pdfFrom} = require("./takeoff_qa_fixture.js");
  return pdfFrom(TURNED.map(deg => {
    const a = deg * Math.PI / 180, c = [600, 400], k = 18, R = (x, y) => [c[0] + (x * Math.cos(a) - y * Math.sin(a)) * k, c[1] + (x * Math.sin(a) + y * Math.cos(a)) * k];
    const L = ["0.8 w"], ring = (x0, y0, x1, y1) => { const P = [R(x0, y0), R(x1, y0), R(x1, y1), R(x0, y1)]; L.push(P.map((p, i) => p[0].toFixed(3) + " " + p[1].toFixed(3) + (i ? " l" : " m")).join(" ") + " h S"); };
    ring(-6, -7, 6, 7); ring(-6.75, -7.75, 6.75, 7.75);
    L.push("BT /F1 12 Tf 60 40 Td (SCALE 1/4\" = 1'-0\") Tj ET", `BT /F1 10 Tf ${c[0] - 20} ${c[1]} Td (ROOM) Tj ET`);
    return {w: 1190, h: 842, content: L.join("\n")};
  }));
}
module.exports = {ROOMS, DOORS, WINDOWS, REF, PAGES, toPdf, seedOf, pdf, polyArea, polyPerim, T9, T4, W, H, TURNED, turnedPdf};
if (require.main === module) { const out = process.argv[2] || "apartment.pdf"; require("fs").writeFileSync(out, pdf()); console.log("written", out, PAGES.length, "pages; reference", JSON.stringify(REF)); }

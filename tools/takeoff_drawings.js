#!/usr/bin/env node
/* Test drawings for Auto area and the takeoff agent: one PDF, one page per drawing condition, written by hand (no PDF library)
   so every reference outline, area and count is known exactly.

     node tools/takeoff_drawings.js out.pdf        # write it (tools/test_takeoff_drawings.js builds it in memory)

   Each case: the page (vector content, or a raster "scan" drawn here pixel by pixel and embedded as an image), its scale,
   seed points with the reference outline (clear inside faces of the walls) and the expected result:
     area   — Auto area from the seed must give the reference outline (area within tol %, IoU ≥ iou)
     none   — no valid room there: the right outcome is an error / warning asking for manual input (negative test)
     count  — door / window tags to count
     explore— no verified reference: results are recorded, not judged
   Page coordinates are PDF points, y up. Generated drawings only — no project drawing is used or published. */
const zlib = require("zlib");
const W0 = 842, H0 = 595;

/* ---------- vector helpers (feet → points at scale k, origin ox, oy) */
function V(k, ox, oy){
  const L = [], P = (x, y) => [ox + x * k, oy + y * k], n = v => v.toFixed(3);
  const api = {
    k, ox, oy, L, P,
    w: lw => { L.push(n(lw) + " w"); return api; },
    rgb: (r, g, b) => { L.push(`${r} ${g} ${b} RG`); return api; },
    fillRgb: (r, g, b) => { L.push(`${r} ${g} ${b} rg`); return api; },
    gray: g => { L.push(`${g} G`); return api; },
    dash: (a, b) => { L.push(a ? `[${a} ${b}] 0 d` : "[] 0 d"); return api; },
    line: (x1, y1, x2, y2) => { const a = P(x1, y1), b = P(x2, y2); L.push(`${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S`); return api; },
    poly: (pts, close, fill) => { const q = pts.map(p => P(p[0], p[1])); L.push(q.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? "l" : "m"}`).join(" ") + (close ? " h" : "") + (fill === "f" ? " f" : fill === "B" ? " B" : " S")); return api; },
    rect: (x, y, w, h, fill) => api.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, fill),
    circle: (cx, cy, r) => { const c = P(cx, cy), R = r * k, m = 0.5523 * R; L.push(`${n(c[0] + R)} ${n(c[1])} m ${n(c[0] + R)} ${n(c[1] + m)} ${n(c[0] + m)} ${n(c[1] + R)} ${n(c[0])} ${n(c[1] + R)} c ${n(c[0] - m)} ${n(c[1] + R)} ${n(c[0] - R)} ${n(c[1] + m)} ${n(c[0] - R)} ${n(c[1])} c ${n(c[0] - R)} ${n(c[1] - m)} ${n(c[0] - m)} ${n(c[1] - R)} ${n(c[0])} ${n(c[1] - R)} c ${n(c[0] + m)} ${n(c[1] - R)} ${n(c[0] + R)} ${n(c[1] - m)} ${n(c[0] + R)} ${n(c[1])} c S`); return api; },
    text: (x, y, s, size, absolute) => { const p = absolute ? [x, y] : P(x, y); L.push(`BT /F1 ${size || 8} Tf ${n(p[0])} ${n(p[1])} Td (${s.replace(/[()\\]/g, m => "\\" + m)}) Tj ET`); return api; },
    raw: s => { L.push(s); return api; },
    /* a room's walls as two lines each side: inner rectangle (the clear room) and outer rectangle t further out; gaps
       [{side:"S"|"N"|"W"|"E", at, w}] leave openings in both lines (a door) */
    walls: (x, y, w, h, t, gaps) => {
      gaps = gaps || [];
      const side = (s, a0, a1, fixed, o) => {   // one line along side s from a0 to a1 at the fixed coordinate, cut by its gaps
        const G = gaps.filter(g => g.side === s).map(g => [g.at, g.at + g.w]).sort((p, q) => p[0] - q[0]);
        let cur = a0; const segs = [];
        G.forEach(([g0, g1]) => { if (g0 > cur) segs.push([cur, g0]); cur = Math.max(cur, g1); }); if (cur < a1) segs.push([cur, a1]);
        segs.forEach(([p, q]) => (s === "S" || s === "N") ? api.line(x + p + o[0], fixed, x + q + o[1], fixed) : api.line(fixed, y + p + o[0], fixed, y + q + o[1]));
      };
      side("S", 0, w, y, [0, 0]); side("N", 0, w, y + h, [0, 0]); side("W", 0, h, x, [0, 0]); side("E", 0, h, x + w, [0, 0]);
      side("S", -t, w + t, y - t, [0, 0]); side("N", -t, w + t, y + h + t, [0, 0]); side("W", -t, h + t, x - t, [0, 0]); side("E", -t, h + t, x + w + t, [0, 0]);
      gaps.forEach(g => {   // the jambs: short lines closing the wall thickness at each side of an opening
        const a = [g.at, g.at + g.w];
        a.forEach(v => { if (g.side === "S") api.line(x + v, y, x + v, y - t); if (g.side === "N") api.line(x + v, y + h, x + v, y + h + t);
          if (g.side === "W") api.line(x, y + v, x - t, y + v); if (g.side === "E") api.line(x + w, y + v, x + w + t, y + v); });
      });
      return api;
    },
    content: () => L.join("\n")
  };
  return api;
}
const scaleNote = (s, x, y) => `BT /F1 9 Tf ${x || 600} ${y || 40} Td (SCALE ${s.replace(/[()\\]/g, m => "\\" + m)}) Tj ET`;
const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const ftToPt = (v, pts) => pts.map(p => [v.ox + p[0] * v.k, v.oy + p[1] * v.k]);

/* ---------- raster helpers: a greyscale "scan" drawn here, embedded as an image covering the page */
function Raster(dpi, opts){
  opts = opts || {};
  const sc = dpi / 72, Wp = Math.round(W0 * sc), Hp = Math.round(H0 * sc), px = new Uint8Array(Wp * Hp).fill(255);
  const ang = (opts.skewDeg || 0) * Math.PI / 180, cx = W0 / 2, cy = H0 / 2, ink = opts.ink == null ? 0 : opts.ink;
  const tr = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(ang) - dy * Math.sin(ang), cy + dx * Math.sin(ang) + dy * Math.cos(ang)]; };
  const api = {
    tr,
    seg: (x1, y1, x2, y2, lwPt) => {   // a line lwPt points wide, in page coordinates (y up)
      const a = tr(x1, y1), b = tr(x2, y2), r = Math.max(0.5, lwPt * sc / 2);
      const A = [a[0] * sc, (H0 - a[1]) * sc], B = [b[0] * sc, (H0 - b[1]) * sc];
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0]) - r - 1)), x1_ = Math.min(Wp - 1, Math.ceil(Math.max(A[0], B[0]) + r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1]) - r - 1)), y1_ = Math.min(Hp - 1, Math.ceil(Math.max(A[1], B[1]) + r + 1));
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1;
      for (let y = y0; y <= y1_; y++) for (let x = x0; x <= x1_; x++) {
        let t = ((x + 0.5 - A[0]) * dx + (y + 0.5 - A[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
        const ex = A[0] + t * dx - x - 0.5, ey = A[1] + t * dy - y - 0.5, d = Math.sqrt(ex * ex + ey * ey);
        if (d <= r) px[y * Wp + x] = Math.min(px[y * Wp + x], ink); else if (d <= r + 1) px[y * Wp + x] = Math.min(px[y * Wp + x], Math.round(ink + (255 - ink) * (d - r)));
      }
      return api;
    },
    noise: (amount, seed) => { let s = seed || 7; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < px.length; i++) { const v = px[i] + (rnd() - 0.5) * amount; px[i] = Math.max(0, Math.min(255, Math.round(v))); } return api; },
    specks: (n, seed) => { let s = seed || 3; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < n; i++) { const x = Math.floor(rnd() * Wp), y = Math.floor(rnd() * Hp); px[y * Wp + x] = 40; } return api; },
    image: () => ({w: Wp, h: Hp, data: zlib.deflateSync(Buffer.from(px))})
  };
  return api;
}
/* the walls of a room drawn into a raster: inner and outer lines, as on a plotted plan */
function rWalls(R, v, x, y, w, h, t, lw, gaps){
  const g = V(v.k, v.ox, v.oy); g.walls(x, y, w, h, t, gaps);
  g.L.filter(s => / l S$/.test(s)).forEach(s => { const m = s.match(/([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/); R.seg(+m[1], +m[2], +m[3], +m[4], lw); });
}

/* ---------- the cases */
const K8 = 9, K4 = 18;   // 1/8" = 1'-0" → 9 pt per ft; 1/4" = 1'-0" → 18 pt per ft
const C = [];
const add = c => { C.push(c); return c; };
const room = (v, x, y, w, h, extra) => Object.assign({seed: [v.ox + (x + w / 2) * v.k, v.oy + (y + h / 2) * v.k], ref: ftToPt(v, rectPts(x, y, w, h)), sft: w * h}, extra || {});

{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 14, 0.75); v.text(4, 7, "BED ROOM");
  add({id: "vector-clean", cat: "Clean vector floor plan", desc: "12' × 14' room, 9\" double-line walls", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 12, 14)]}); }
{ const v = V(K8, 100, 100); v.fillRgb(0, 0, 0).raw("0 g");
  const t = 1.125, x = 0, y = 0, w = 15, h = 12; v.poly([[x - t, y - t], [x + w + t, y - t], [x + w + t, y + h + t], [x - t, y + h + t]], true, "f"); v.raw("1 g"); v.rect(x, y, w, h, "f"); v.raw("0 g"); v.text(5, 6, "LOUNGE");
  add({id: "thick-walls", cat: "Thick (solid, poché) walls", desc: "15' × 12' room, 13½\" walls filled solid", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 15, 12)]}); }
{ const v = V(K8, 100, 100); v.w(0.25);
  [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]].forEach(([a, b, c, d]) => { const ex = 1; const dx = Math.sign(c - a), dy = Math.sign(d - b);
    v.line(a - dx * ex, b - dy * ex, c + dx * ex, d + dy * ex); v.line(a - dx * ex + 0.05 * dy, b - dy * ex + 0.05 * dx, c + dx * ex + 0.05 * dy, d + dy * ex + 0.05 * dx); });
  add({id: "thin-overlap", cat: "Thin, overlapping lines", desc: "10' × 10' room bounded by single thin lines drawn twice, slightly offset, overshooting the corners by 1'", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 10, 10, {tol: 2, iou: 0.95})]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 10, 0.75, [{side: "E", at: 4, w: 0.4}]);
  add({id: "small-gap", cat: "Small boundary gap", desc: "12' × 10' room with a 0.4' drafting gap in one wall", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 12, 10)]}); }
{ const v = V(K8, 100, 120); v.w(0.6).walls(0, 0, 14, 12, 0.75, [{side: "S", at: 2, w: 3}]);
  v.line(2, 0, 2, 3); v.raw(`${(100 + 2 * K8).toFixed(3)} ${(120 + 3 * K8).toFixed(3)} m ${(100 + 3.66 * K8).toFixed(3)} ${(120 + 3 * K8).toFixed(3)} ${(100 + 5 * K8).toFixed(3)} ${(120 + 1.66 * K8).toFixed(3)} ${(100 + 5 * K8).toFixed(3)} ${(120).toFixed(3)} c S`);
  v.text(5, 6, "DRAWING ROOM");
  add({id: "door-opening", cat: "Door opening with swing", desc: "14' × 12' room, 3' door with leaf and swing arc", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 14, 12)]}); }
{ const v = V(K8, 100, 100), t = 0.75, P = [[0, 0], [20, 0], [20, 8], [12, 8], [12, 16], [0, 16]];
  v.w(0.6).poly(P, true); const off = [[-t, -t], [20 + t, -t], [20 + t, 8 + t], [12 + t, 8 + t], [12 + t, 16 + t], [-t, 16 + t]]; v.poly(off, true); v.text(3, 8, "FAMILY");
  add({id: "l-shape", cat: "Irregular / L-shaped room", desc: "L-shaped room 20' × 16' less an 8' × 8' corner = 256 Sft", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [{seed: [100 + 6 * K8, 100 + 8 * K8], ref: ftToPt(v, P), sft: 256}]}); }
{ const v = V(K8, 100, 100), p = 0.375; v.w(0.6);
  [0, 10 + p, 20 + 2 * p].forEach(x => v.walls(x, 0, 10, 12, p)); ["ROOM A", "ROOM B", "ROOM C"].forEach((s, i) => v.text(i * (10 + p) + 3, 6, s));
  add({id: "shared-walls", cat: "Rooms sharing boundaries", desc: "three 10' × 12' rooms side by side on 4½\" partitions — each must stay separate", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [room(v, 10 + p, 0, 10, 12), room(v, 0, 0, 10, 12), room(v, 20 + 2 * p, 0, 10, 12)]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 16, 14, 0.75); v.w(0.4).rect(1, 8, 6, 5).rect(1.5, 12, 2, 0.8).rect(4.5, 12, 2, 0.8).circle(11, 5, 1.8).rect(13, 1, 2.5, 4);
  v.text(7, 3, "MASTER BED"); v.text(7, 2, "16'-0\" x 14'-0\""); v.text(9, 10, "WARDROBE");
  add({id: "furniture-text", cat: "Furniture and text inside", desc: "16' × 14' room with bed, side tables, round table, cabinet and labels", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 16, 14, {seed: [100 + 10 * K8, 100 + 9 * K8]})]}); }
{ const v = V(K8, 100, 100); v.raw("1 0.95 0.75 rg"); v.rect(0, 0, 12, 12, "f"); v.rgb(0.8, 0.1, 0.1).w(0.8).walls(0, 0, 12, 12, 0.75); v.rgb(0.1, 0.3, 0.9).w(0.4).rect(2, 2, 3, 3); v.raw("0 0 0 RG");
  add({id: "colour", cat: "Coloured drawing", desc: "12' × 12' room, red walls, tinted floor fill, a blue fixture", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 12, 12, {seed: [100 + 8 * K8, 100 + 8 * K8]})]}); }
{ const v = V(K8, 120, 110); v.w(0.6).walls(0, 0, 18, 12, 0.75); v.w(0.25).dash(12, 3);
  v.line(-4, 6, 22, 6); v.line(9, -4, 9, 16); v.dash(0); v.w(0.3).line(0, 9, 18, 9).line(0, 8.6, 0, 9.4).line(18, 8.6, 18, 9.4); v.text(8, 9.3, "18'-0\"");
  add({id: "grid-dims", cat: "Gridlines and dimensions crossing the room", desc: "18' × 12' room crossed by two chain-dashed gridlines and a dimension line", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 18, 12, {seed: [120 + 4 * K8, 110 + 3 * K8]})]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 12, 0.75); v.w(0.2);
  for (let d = -12; d <= 12; d += 1) { const a = [Math.max(0, d), Math.max(0, -d)], b = [Math.min(12, 12 + d), Math.min(12, 12 - d)]; if (b[0] > a[0]) v.line(a[0], a[1], b[0], b[1]); }
  add({id: "hatch", cat: "Hatching / floor-finish pattern", desc: "12' × 12' room filled with a 45° hatch at 1' spacing", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 12, 12, {seed: [100 + 3 * K8, 100 + 9.5 * K8]})]}); }
{ const v = V(K8, 100, 100), p = 0.375; v.w(0.6).walls(0, 0, 20, 16, 0.75).walls(8, 6, 4, 4, p); v.text(9, 7.5, "SHAFT", 6); v.text(2, 13, "HALL");
  const outer = rectPts(0, 0, 20, 16), hole = rectPts(8 - p, 6 - p, 4 + 2 * p, 4 + 2 * p);
  add({id: "shaft-void", cat: "Nested shaft / void", desc: "20' × 16' hall with a walled 4' × 4' shaft inside (shaft 4'-9\" outside) — net 297.44 Sft", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [{seed: [100 + 3 * K8, 100 + 3 * K8], ref: ftToPt(v, outer), hole: ftToPt(v, hole), sft: 320 - (4 + 2 * p) ** 2, tol: 1}]}); }
{ const v = V(K8, 100, 100), t = 0.75, P = [[0, 0], [18, 0], [14, 12], [4, 12]], O = [[-t * 1.2, -t], [18 + t * 1.2, -t], [14 + t * 0.6, 12 + t], [4 - t * 0.6, 12 + t]];
  v.w(0.6).poly(P, true).poly(O, true);
  add({id: "angled", cat: "Angled walls (trapezoid)", desc: "trapezoid room 18' / 10' × 12' deep = 168 Sft", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [{seed: [100 + 9 * K8, 100 + 6 * K8], ref: ftToPt(v, P), sft: 168}]}); }
{ const v = V(K8, 100, 100), p = 0.375; v.w(0.6).walls(0, 0, 14, 10, 0.75).walls(14.75, 0, 4, 3, p, [{side: "N", at: 0.5, w: 2.5}]); v.text(15.1, 1.2, "WC", 6); v.text(5, 5, "BED ROOM");
  add({id: "tiny-room", cat: "Very small room", desc: "4' × 3' WC beside a bed room, 2'-6\" door", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 14.75, 0, 4, 3, {seed: [100 + (14.75 + 3) * K8, 100 + 1 * K8], tol: 3})]}); }
{ const v = V(K8, 200, 200); v.w(0.6).walls(0, 0, 4, 3, 0.375); v.text(0.5, 1.2, "WC", 6);
  add({id: "tiny-isolated", cat: "Very small room", desc: "4' × 3' box drawn on its own, joined to no other wall", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 4, 3, {seed: [200 + 3 * K8, 200 + 2 * K8], tol: 3})]}); }
{ const v = V(4.5, 70, 80); v.w(0.6).walls(0, 0, 150, 100, 1.125); v.text(60, 50, "WAREHOUSE");
  add({id: "large-hall", cat: "Very large room", desc: "150' × 100' hall at 1/16\" = 1'-0\"", page: v.content() + "\n" + scaleNote('1/16" = 1\'-0"'), k: 4.5, rooms: [room(v, 0, 0, 150, 100, {seed: [70 + 30 * 4.5, 80 + 20 * 4.5]})]}); }
{ const v = V(K8, 100, 150); v.w(0.6).walls(0, 0, 12, 12, 0.75, [{side: "E", at: 0, w: 12}]); v.line(12.75, -0.75, 40, -0.75).line(12.75, 12.75, 40, 12.75);
  add({id: "open-room", cat: "Room open to the next space (no wall)", desc: "12' × 12' room whose whole east side is open to a long corridor", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [{seed: [100 + 6 * K8, 150 + 6 * K8], expect: "none", sft: 144, ref: ftToPt(v, rectPts(0, 0, 12, 12))}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).line(0, 0, 10, 0).line(0, 0, 0, 10); v.text(3, 3, "OPEN AREA");
  add({id: "no-boundary", cat: "Incomplete / ambiguous boundary", desc: "two loose lines meeting at a corner — nothing closed", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [{seed: [100 + 20 * K8, 100 + 15 * K8], expect: "none"}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 10, 0.75); v.text(4, 5, "STUDY");
  add({id: "rotate-90", cat: "Page rotated 90°", desc: "12' × 10' room on a page with /Rotate 90", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), rotate: 90, k: K8, rooms: [room(v, 0, 0, 12, 10)]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 14, 11, 0.75); v.text(5, 5, "OFFICE");
  add({id: "rotate-270", cat: "Page rotated 270°", desc: "14' × 11' room on a page with /Rotate 270", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), rotate: 270, k: K8, rooms: [room(v, 0, 0, 14, 11)]}); }
{ const v = V(K4, 120, 100); v.w(0.6).walls(0, 0, 10, 8, 0.5); v.text(3, 4, "KITCHEN");
  add({id: "scale-quarter", cat: "Another scale on another page", desc: "10' × 8' kitchen at 1/4\" = 1'-0\" (18 pt per ft)", page: v.content() + "\n" + scaleNote('1/4" = 1\'-0"'), k: K4, rooms: [room(v, 0, 0, 10, 8)]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 14, 12, 0.75);
  v.raw("q 0.8 g BT /F1 90 Tf 0.7071 0.7071 -0.7071 0.7071 160 120 Tm (DRAFT) Tj ET Q"); v.raw("q 0.5 G 1 w 640 470 150 80 re S BT /F1 10 Tf 650 520 Td (APPROVED FOR) Tj ET BT /F1 10 Tf 650 505 Td (CONSTRUCTION) Tj ET Q");
  add({id: "watermark", cat: "Watermark and stamp", desc: "14' × 12' room under a large grey DRAFT watermark, stamp box in the corner", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 14, 12, {seed: [100 + 3 * K8, 100 + 9 * K8]})]}); }
{ const v = V(K8, 100, 100), R = Raster(150); rWalls(R, v, 0, 0, 12, 14, 0.75, 1.0);
  add({id: "scan-clean", cat: "Scanned black-and-white plan", desc: "12' × 14' room as a 150 dpi scan (no vector lines, no text)", raster: R.image(), k: K8, calibrate: true, rooms: [room(v, 0, 0, 12, 14, {tol: 2, iou: 0.95})]}); }
{ const v = V(K8, 100, 100), R = Raster(72, {ink: 150}); rWalls(R, v, 0, 0, 16, 12, 0.75, 0.8); R.noise(40, 11).specks(1500, 5);
  add({id: "scan-faint", cat: "Faint, low-resolution scan", desc: "16' × 12' room, 72 dpi, grey lines, noise and specks", raster: R.image(), k: K8, calibrate: true, rooms: [room(v, 0, 0, 16, 12, {tol: 3, iou: 0.93})]}); }
{ const v = V(K8, 100, 100), R = Raster(150, {skewDeg: 2}); rWalls(R, v, 0, 0, 12, 12, 0.75, 1.0);
  const ref = ftToPt(v, rectPts(0, 0, 12, 12)).map(p => R.tr(p[0], p[1])), sd = R.tr(100 + 6 * K8, 100 + 6 * K8);
  add({id: "scan-skewed", cat: "Skewed scan (2°)", desc: "12' × 12' room scanned 2° off square — area unchanged, outline turned", raster: R.image(), k: K8, calibrate: true, rooms: [{seed: sd, ref, sft: 144, tol: 2, iou: 0.94}]}); }
{ const v = V(K8, 100, 100), R = Raster(150); rWalls(R, v, 0, 0, 13, 10, 0.75, 1.0);
  const vv = V(K8, 100, 100); vv.w(0.3).line(0, -2.5, 13, -2.5).line(0, -3, 0, -2).line(13, -3, 13, -2); vv.text(5.5, -2.2, "13'-0\""); vv.text(4, 5, "GUEST ROOM");
  add({id: "mixed", cat: "Mixed raster and vector", desc: "13' × 10' room as a scanned image, dimensions and labels as vector text on top", raster: R.image(), page: vv.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 13, 10, {tol: 2, iou: 0.95})]}); }
{ const v = V(K4, 100, 100); v.w(0.8); [[0, 0], [14, 0], [28, 0], [0, 12], [14, 12], [28, 12]].forEach(([x, y]) => v.rect(x, y, 6, 6)); v.w(0.3).dash(8, 3); v.line(-2, 3, 36, 3).line(-2, 15, 36, 15); v.dash(0); v.text(1.5, 2.5, "F1", 7);
  add({id: "footing-plan", cat: "Structural footing layout", desc: "six 6' × 6' isolated footings (single closed outlines) on dashed grid lines", page: v.content() + "\n" + scaleNote('1/4" = 1\'-0"'), k: K4,
    rooms: [{seed: [100 + 15 * K4, 100 + 13.5 * K4], ref: ftToPt(v, rectPts(14, 12, 6, 6)), sft: 36, tol: 2}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 24, 18, 0.75); v.w(1.2); [[0, 9, 24, 9]].forEach(([a, b, c, d]) => { v.line(a, b - 0.4, c, d - 0.4); v.line(a, b + 0.4, c, d + 0.4); });
  [[8, 0], [16, 0]].forEach(([x]) => { v.line(x - 0.4, 0, x - 0.4, 18); v.line(x + 0.4, 0, x + 0.4, 18); }); v.text(2, 4, "S1  6\" SLAB");
  add({id: "framing-plan", cat: "Beam / slab framing plan", desc: "24' × 18' bay split by drawn beams into slab panels; the panel 8' × 9' clear of beams (less beam halves)", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [{seed: [100 + 4 * K8, 100 + 4 * K8], ref: ftToPt(v, rectPts(0, 0, 7.6, 8.6)), sft: 7.6 * 8.6, tol: 3}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 14, 12, 0.75); v.w(0.15); for (let x = 2; x < 14; x += 2) v.line(x, 0, x, 12); for (let y = 2; y < 12; y += 2) v.line(0, y, 14, y);
  v.text(5, 7, "OFFICE"); v.text(5, 6, "14'-0\" x 12'-0\"");
  add({id: "rcp-grid", cat: "Reflected ceiling plan (2' × 2' grid)", desc: "14' × 12' office with a 2' × 2' ceiling grid drawn across the whole room", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [room(v, 0, 0, 14, 12, {seed: [100 + 3 * K8, 100 + 3 * K8]})]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 16, 12, 0.75); v.w(0.3);
  for (let i = 0; i < 6; i++) { v.circle(2 + i * 2.5, 9, 0.35); v.line(2 + i * 2.5, 8.65, 2 + i * 2.5, 4); }
  for (let i = 0; i < 5; i++) v.raw(`${(100 + (2 + i * 2.5) * K8).toFixed(2)} ${(100 + 4 * K8).toFixed(2)} m ${(100 + (3.25 + i * 2.5) * K8).toFixed(2)} ${(100 + 2.5 * K8).toFixed(2)} ${(100 + (4.5 + i * 2.5) * K8).toFixed(2)} ${(100 + 4 * K8).toFixed(2)} v S`);
  add({id: "electrical", cat: "Electrical layout with dense lines", desc: "16' × 12' room with light fittings and curved wiring runs", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 16, 12, {seed: [100 + 13 * K8, 100 + 10.5 * K8]})]}); }
{ const v = V(2.25, 80, 60), P = [[0, 0], [180, 0], [180, 90], [120, 130], [0, 130]]; v.w(0.8).poly(P, true); v.w(0.5).line(-20, -10, 200, -10).line(-20, -40, 200, -40); v.text(80, -27, "MAIN ROAD 30'-0\"", 7);
  v.w(0.3); [[30, 40], [60, 90], [140, 30]].forEach(([x, y]) => v.circle(x, y, 4)); v.text(60, 60, "PLOT 12", 8);
  add({id: "site-plan", cat: "Site layout with road and trees", desc: "five-sided plot boundary (single line) beside a road, trees inside; 1\" = 32' (2.25 pt per ft)", page: v.content() + "\n" + scaleNote('1" = 32\''), k: 2.25,
    rooms: [{seed: [80 + 90 * 2.25, 80 + 0 * 2.25 + 40 * 2.25], ref: ftToPt(v, P), sft: 22200, tol: 2}]}); }
{ const v = V(K8, 100, 120); v.w(0.8).line(-5, 0, 40, 0); v.w(0.6); [0, 10, 20].forEach(y => v.rect(0, y, 30, 0.5)); v.rect(0, 0, 0.75, 30.5).rect(29.25, 0, 0.75, 30.5); v.poly([[0, 30.5], [15, 38], [30, 30.5]], true); v.text(32, 10, "FFL +10'-0\"", 7);
  add({id: "section", cat: "Building section / elevation", desc: "two-storey section: floor slabs, walls, roof — no single room area is defined", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [{seed: [100 + 15 * K8, 120 + 5 * K8], expect: "explore"}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 14, 0.75); v.text(4, 7, "BED ROOM"); v.text(30, 30, "REV A", 10);
  const w = V(K8, 100, 100); w.w(0.6).walls(0, 0, 12, 16, 0.75); w.text(4, 7, "BED ROOM"); w.text(30, 30, "REV B", 10);
  add({id: "revision-a", cat: "Revised drawing (rev A → rev B)", desc: "rev A: bed room 12' × 14'", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(v, 0, 0, 12, 14)]});
  add({id: "revision-b", cat: "Revised drawing (rev A → rev B)", desc: "rev B: the same room lengthened to 12' × 16' (+24 Sft)", page: w.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, rooms: [room(w, 0, 0, 12, 16)]}); }
{ const v = V(K8, 60, 80); v.w(0.6).walls(0, 0, 40, 30, 0.75); const tags = [[3, 3, "D1"], [10, 3, "D1"], [17, 3, "D1"], [24, 3, "D1"], [31, 3, "D1"], [3, 25, "D1"], [10, 25, "D1"], [17, 25, "D2"], [24, 25, "D2"], [31, 25, "D2"], [20, 14, "W1"], [26, 14, "W1"]];
  tags.forEach(([x, y, s]) => { v.w(0.4).circle(x + 0.6, y + 0.3, 1.1); v.text(x, y, s, 7); }); v.raw("BT /F1 7 Tf 600 500 Td (DOOR SCHEDULE) Tj ET BT /F1 7 Tf 600 490 Td (D1  3'-0\" x 7'-0\") Tj ET BT /F1 7 Tf 600 480 Td (D2  2'-6\" x 7'-0\") Tj ET");
  add({id: "count-tags", cat: "Repeated door / window tags (count)", desc: "7 × D1, 3 × D2, 2 × W1 tags on the plan, plus a door schedule (not counted)", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, counts: {d1: 7, d2: 3, w1: 2}}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 12, 0.75); v.text(4, 6, "STORE");
  add({id: "no-scale", cat: "Scale unknown (no note)", desc: "12' × 12' room, no scale note anywhere — Auto area must ask for the scale", page: v.content(), k: 0, rooms: [{seed: [100 + 6 * K8, 100 + 6 * K8], expect: "none", why: "scale"}]}); }
{ const v = V(K8, 100, 100); v.w(0.6).walls(0, 0, 12, 12, 0.75); v.w(0.3).line(0, -3, 12, -3).line(0, -3.5, 0, -2.5).line(12, -3.5, 12, -2.5); v.text(5, -2.7, "24'-0\"");
  add({id: "scale-conflict", cat: "Scale conflicting with the dimensions", desc: "note says 1/8\" = 1'-0\" but the dimension string reads 24'-0\" over a 12' (at 1/8\") line", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8, scaleConflict: true, rooms: [room(v, 0, 0, 12, 12, {expect: "explore"})]}); }

{ const v = V(K8, 80, 80), p = 0.375; v.w(0.6).walls(0, 0, 12, 14, 0.75).walls(12.75, 0, 10, 8, p).walls(0, 14.75, 16, 14, p).walls(16 + p, 14.75, 4, 4, p);
  v.text(3, 8, "BED ROOM"); v.text(3, 7, "12'-0\" x 14'-0\""); v.text(14, 5, "KITCHEN"); v.text(14, 4, "10'-0\" x 8'-0\""); v.text(4, 22, "LOUNGE"); v.text(4, 21, "16'-0\" x 12'-0\""); v.text(16.6, 16.9, "SHAFT", 6);
  add({id: "agent-plan", cat: "Multi-room plan for the agent", desc: "bed room, kitchen and lounge with written sizes (the lounge's is wrong: 16' × 12' written, 16' × 14' drawn) and a shaft to be left out", page: v.content() + "\n" + scaleNote('1/8" = 1\'-0"'), k: K8,
    rooms: [room(v, 0, 0, 12, 14, {seed: [80 + 6 * K8, 80 + 10 * K8]}), room(v, 12.75, 0, 10, 8, {seed: [80 + (12.75 + 7) * K8, 80 + 6 * K8]}), room(v, 0, 14.75, 16, 14, {seed: [80 + 10 * K8, 80 + (14.75 + 7) * K8]})],
    agent: {measured: ["BED ROOM", "KITCHEN", "LOUNGE"], excluded: ["SHAFT"], flagged: ["LOUNGE"]}}); }

function makeDrawings(){
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], kids = [];
  const bin = [];   // binary streams kept aside, written as latin1
  C.forEach(c => {
    const pid = objs.length + 1; let res = "/Font << /F1 3 0 R >>", content = c.page || "";
    if (c.raster) { const iid = objs.length + 2; objs.push(null); objs.push({img: c.raster}); res += ` /XObject << /Im1 ${iid} 0 R >>`; content = `q ${W0} 0 0 ${H0} 0 0 cm /Im1 Do Q\n` + content; }
    else objs.push(null);
    const cid = objs.length + 1; objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    objs[pid - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W0} ${H0}]${c.rotate ? " /Rotate " + c.rotate : ""} /Contents ${cid} 0 R /Resources << ${res} >> >>`;
    kids.push(pid + " 0 R"); c.pageNo = kids.length;
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]; let len = parts[0].length; const offs = [];
  objs.forEach((o, i) => {
    offs.push(len);
    const b = o && o.img ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${o.img.w} /Height ${o.img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${o.img.data.length} >>\nstream\n`, "latin1"), o.img.data, Buffer.from("\nendstream\nendobj\n", "latin1")])
      : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1");
    parts.push(b); len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
module.exports = {makeDrawings, CASES: C, W0, H0};
if (require.main === module) { const out = process.argv[2] || "takeoff_drawings.pdf"; require("fs").writeFileSync(out, makeDrawings()); console.log("written", out, C.length, "pages,", new Set(C.map(c => c.cat)).size, "drawing conditions"); }

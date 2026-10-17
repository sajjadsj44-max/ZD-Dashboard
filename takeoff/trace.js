/* Vector trace: a whole floor's rooms from a CAD-plotted PDF, the way a QS measures it by hand — every space's clear
   outline on its wall faces, doors closed at both faces (the threshold its own small piece), each outline checked against
   the size written in it. Pure functions (no page, no DOM): run in trace-worker.js off the page's thread, or in node tests.

   1  wall bodies: the plan's own wall layers (wall, column, window, duct outlines) are drawn on a raster; an enclosed
      piece between them is wall when it holds the wall hatch or is no thicker than a wall; isolated marks drawn on a wall
      layer (a set-out cross) are left out; a wall face the drawing leaves out where a duct box meets the wall is carried
      across where the hatch runs on beside it
   2  openings: two in-line runs of the same wall face with a gap of up to 8'-7" get the face drawn across the gap; a wall
      that stops short of the next wall (a door beside a corner) has both faces carried on to it, up to 4'-7"
   3  spaces: the free pieces left; a room name (with its written size under it) names the piece it sits in; unnamed
      pieces join the corridor they open off, the lift shaft round them, the balcony across a parapet break, or the one
      room they open to (a niche); thin pieces between two rooms are door thresholds; a door drawn closed (the wall
      outline running on, its hatch stopping) is a threshold too; a piece closed on all sides is a shaft / void
   4  outlines: each piece is traced and every side moved onto the drawn line it follows, corners at the lines' crossings —
      square corners stay square, a 45° wall keeps its angle
   5  checks: the written L × W must be found as two pairs of facing sides (to the inch); a room named with another one
      it is open to (Bed room + Dress) is split on the written size when the walls fit it, else kept as one (open plan)

   Units: page points (y down) in, the page's scale k (pt per ft). */
export const TRACE_VER = 1;

const NAME_SKIP = /^(UP|DN|DOWN|N|S|E|W|NORTH|SOUTH|FROM\s+ROAD\s+LEVEL|SCALE.*|.*\bPLAN\b.*|SC|SECTION.*|\d+(\.\d+)?)$/i;
const SIZE_RX = /(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"?\s*[xX×]\s*(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"?/;
const WIDE_RX = /(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"\s*WIDE/i;
export function sizeOf(s){   // "12'-6 1/2"x11'-6"" -> [12.5417, 11.5] ft, or null
  const m = SIZE_RX.exec(String(s || "")); if (!m) return null;
  const f = (a, b, n, d, h) => +a + ((+b || 0) + (n && +d ? +n / +d : 0) + (h ? 0.5 : 0)) / 12;
  return [f(m[1], m[2], m[3], m[4], m[5]), f(m[6], m[7], m[8], m[9], m[10])];
}
function wideOf(s){ const m = WIDE_RX.exec(String(s || "")); return m ? +m[1] + ((+m[2] || 0) + (m[3] && +m[4] ? +m[3] / +m[4] : 0) + (m[5] ? 0.5 : 0)) / 12 : null; }
export function kindOf(nm){
  const n = String(nm || "").toUpperCase();
  if (/\bBATH|TOILET|\bW\.?C\b|POWDER|WASH\s*ROOM|\bPWD\b|\bWR\b/.test(n)) return "bath";
  if (/^LIFT\b(?!\s*LOBBY)|\bELEVATOR\b/.test(n)) return "lift";
  if (/STAIR/.test(n)) return "stair";
  if (/GARBAGE|CHUTE/.test(n)) return "chute";
  if (/\bDUCT\b|\bSHAFT\b|\bVOID\b|\bO\.?T\.?S\b/.test(n)) return "void";
  if (/BALCON|TERRACE|VERANDA/.test(n)) return "balcony";
  if (/^CORRIDOR|^GALLERY|^(LIFT\s+)?LOBBY$|^COMMON|^PASSAGE\s+\d|^LIFT LOBBY/.test(n)) return "corridor";
  return "room";
}

/* ------------------------------------------------------------------ raster helpers (a grid of R px per pt over the plan) */
function Grid(x0, y0, x1, y1, R){ this.R = R; this.x0 = x0; this.y0 = y0; this.W = Math.ceil((x1 - x0) * R) + 2; this.H = Math.ceil((y1 - y0) * R) + 2; this.N = this.W * this.H; }
Grid.prototype.px = function(x){ return Math.floor((x - this.x0) * this.R); };
Grid.prototype.py = function(y){ return Math.floor((y - this.y0) * this.R); };
function line(G, m, x0, y0, x1, y1, v){   // a 1 px line from pt to pt
  const a = (x0 - G.x0) * G.R, b = (y0 - G.y0) * G.R, c = (x1 - G.x0) * G.R, d = (y1 - G.y0) * G.R, n = Math.max(1, Math.ceil(Math.max(Math.abs(c - a), Math.abs(d - b))));
  for (let i = 0; i <= n; i++) { const x = Math.floor(a + (c - a) * i / n), y = Math.floor(b + (d - b) * i / n); if (x >= 0 && y >= 0 && x < G.W && y < G.H) m[y * G.W + x] = v == null ? 1 : v; }
}
function label4(G, free){   // 4-connected labels of free pixels (two passes, union-find) -> {lab: Int32Array, n}
  const {W, H} = G, lab = new Int32Array(G.N), par = [0];
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!free[i]) continue;
    const l = x > 0 && free[i - 1] ? lab[i - 1] : 0, u = y > 0 && free[i - W] ? lab[i - W] : 0;
    if (!l && !u) { par.push(par.length); lab[i] = par.length - 1; }
    else if (l && u) { const a = find(l), b = find(u); lab[i] = Math.min(a, b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    else lab[i] = l || u; }
  const map = new Int32Array(par.length); let n = 0;
  for (let i = 1; i < par.length; i++) { const r = find(i); if (!map[r]) map[r] = ++n; map[i] = map[r]; }
  for (let i = 0; i < G.N; i++) if (lab[i]) lab[i] = map[lab[i]];
  return {lab, n};
}
function chamfer(G, free){   // distance to the nearest non-free pixel, ×3 (3-4 chamfer)
  const {W, H} = G, d = new Int32Array(G.N), INF = 1 << 28;
  for (let i = 0; i < G.N; i++) d[i] = free[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!d[i]) continue; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); if (y > 0) { v = Math.min(v, d[i - W] + 3); if (x > 0) v = Math.min(v, d[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4); } d[i] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!d[i]) continue; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3); if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (x > 0) v = Math.min(v, d[i + W - 1] + 4); } d[i] = v; }
  return d;
}
function boxMax(G, m, r){   // dilation by a (2r+1)² box, separable
  const {W, H} = G, t = new Uint8Array(G.N), o = new Uint8Array(G.N);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= r) t[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; if (y - last <= r) o[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= r) o[y * W + x] = 1; } }
  return o;
}
function boxMin(G, m, r){ const inv = new Uint8Array(G.N); for (let i = 0; i < G.N; i++) inv[i] = m[i] ? 0 : 1; const d = boxMax(G, inv, r); for (let i = 0; i < G.N; i++) d[i] = d[i] ? 0 : 1; return d; }
function fillOutside(G, wall){   // free pixels reached from the border -> 1
  const {W, H} = G, out = new Uint8Array(G.N), st = new Int32Array(G.N); let top = 0;
  const push = i => { if (!wall[i] && !out[i]) { out[i] = 1; st[top++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) { const i = st[--top], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < G.N - W) push(i + W); }
  return out;
}

/* ------------------------------------------------------------------ the drawn lines a traced side may sit on */
function Lines(segs){
  this.L = segs.filter(s => Math.hypot(s[2] - s[0], s[3] - s[1]) >= 1);
  this.cell = 24; this.grid = new Map();
  this.L.forEach((s, i) => { const l = Math.hypot(s[2] - s[0], s[3] - s[1]); s.u = [(s[2] - s[0]) / l, (s[3] - s[1]) / l]; s.l = l; s.th = ((Math.atan2(s.u[1], s.u[0]) % Math.PI) + Math.PI) % Math.PI;
    const c = this.cell, a0 = Math.floor(Math.min(s[0], s[2]) / c), a1 = Math.floor(Math.max(s[0], s[2]) / c), b0 = Math.floor(Math.min(s[1], s[3]) / c), b1 = Math.floor(Math.max(s[1], s[3]) / c);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = a + "," + b; let A = this.grid.get(k); if (!A) this.grid.set(k, A = []); A.push(i); } });
}
Lines.prototype.near = function(x0, y0, x1, y1){ const c = this.cell, s = new Set();
  for (let a = Math.floor(x0 / c); a <= Math.floor(x1 / c); a++) for (let b = Math.floor(y0 / c); b <= Math.floor(y1 / c); b++) (this.grid.get(a + "," + b) || []).forEach(i => s.add(i));
  return [...s].map(i => this.L[i]); };
/* the line a traced side follows: parallel (within 2.5° and a pixel's lean), within SNAP pt, preferring one that runs along it */
Lines.prototype.match = function(p, q, SNAP, reach){
  const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); if (l < 1e-6) return null;
  const u = [dx / l, dy / l], th = ((Math.atan2(u[1], u[0]) % Math.PI) + Math.PI) % Math.PI, tol = 2.5 * Math.PI / 180 + Math.atan(1 / l), m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let best = null, bs = Infinity;
  for (const s of this.near(Math.min(p[0], q[0]) - reach, Math.min(p[1], q[1]) - reach, Math.max(p[0], q[0]) + reach, Math.max(p[1], q[1]) + reach)) {
    let dt = Math.abs(s.th - th); dt = Math.min(dt, Math.PI - dt); if (dt > tol) continue;
    const n = [-s.u[1], s.u[0]], d = Math.abs((m[0] - s[0]) * n[0] + (m[1] - s[1]) * n[1]); if (d > SNAP) continue;
    const t0 = (s[0] - p[0]) * u[0] + (s[1] - p[1]) * u[1], t1 = (s[2] - p[0]) * u[0] + (s[3] - p[1]) * u[1], lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    const ov = Math.max(0, Math.min(hi, l) - Math.max(lo, 0)) / l, gap = Math.max(0, lo - l, -hi), sc = d + 0.02 * gap - Math.min(ov, 1);
    if (sc < bs) { bs = sc; best = {p: [s[0], s[1]], u: s.u, d, ov}; } }
  return best;
};
function isect(p1, u1, p2, u2){ const den = u1[0] * u2[1] - u1[1] * u2[0]; if (Math.abs(den) < 1e-9) return null; const t = ((p2[0] - p1[0]) * u2[1] - (p2[1] - p1[1]) * u2[0]) / den; return [p1[0] + t * u1[0], p1[1] + t * u1[1]]; }
function fitRing(ring, LN, snap){   // traced corners -> corners on the drawn lines; -> {pts, un: sides with no line under them}
  const n = ring.length, E = [];
  for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n], m = LN.match(p, q, snap, snap + 2);
    if (m) E.push({p: m.p, u: m.u, ok: true}); else { const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; E.push({p, u: [(q[0] - p[0]) / l, (q[1] - p[1]) / l], ok: false, a: p, b: q}); } }
  const out = []; let un = 0; fitRing.last = E.filter(e => !e.ok).map(e => [e.a, e.b]);
  for (let i = 0; i < n; i++) { const a = E[(i + n - 1) % n], b = E[i]; if (!b.ok) un++;
    if (a.ok && b.ok && Math.abs(Math.abs(a.u[0] * b.u[0] + a.u[1] * b.u[1]) - 1) < 1e-4 && Math.abs((b.p[0] - a.p[0]) * -a.u[1] + (b.p[1] - a.p[1]) * a.u[0]) < 0.05) continue;   // one line: no corner
    const v = isect(a.p, a.u, b.p, b.u); out.push(v && Math.hypot(v[0] - ring[i][0], v[1] - ring[i][1]) < 6 * snap ? v : ring[i].slice()); }
  return {pts: out, un};
}

/* ------------------------------------------------------------------ outlines of a pixel mask: every loop, on pixel edges */
function loops(G, inside, bx){   // bx: [x0, y0, x1, y1] px box to look in -> [{pts (pt), hole}]
  const [X0, Y0, X1, Y1] = bx, W = G.W, at = (x, y) => x >= X0 && y >= Y0 && x < X1 && y < Y1 && inside(y * W + x);
  const next = new Map(), key = (x, y) => x + "," + y;
  // directed boundary edges with the inside on the right (screen, y down): top edge left->right, etc.
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y); if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1); if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1); if (!at(x - 1, y)) add(x, y + 1, x, y); }
  function add(a, b, c, d){ const k = key(a, b); let L = next.get(k); if (!L) next.set(k, L = []); L.push([c, d, a, b]); }
  const out = [];
  for (const [k0, L0] of next) while (L0.length) {
    const e0 = L0.pop(), pts = [[e0[2], e0[3]]]; let cur = e0, guard = 0;
    while (guard++ < 4e6) { const kk = key(cur[0], cur[1]); if (cur[0] === e0[2] && cur[1] === e0[3]) break;
      const L = next.get(kk); if (!L || !L.length) break; pts.push([cur[0], cur[1]]);
      // at a pixel corner with two ways on, turn right (keeps diagonal-touching pixels apart)
      let j = 0; if (L.length > 1) { const din = [cur[0] - cur[2], cur[1] - cur[3]]; let bestT = -9;
        L.forEach((c, i) => { const dout = [c[0] - cur[0], c[1] - cur[1]], cr = din[0] * dout[1] - din[1] * dout[0], dt = din[0] * dout[0] + din[1] * dout[1], t = cr > 0 ? 2 : dt > 0 ? 1 : 0; if (t > bestT) { bestT = t; j = i; } }); }
      cur = L.splice(j, 1)[0]; }
    if (pts.length < 4) continue;
    let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    out.push({px: pts, hole: a < 0, apx: Math.abs(a) / 2});
  }
  return out.map(o => ({pts: o.px.map(([x, y]) => [x / G.R + G.x0, y / G.R + G.y0]), hole: o.hole, apx: o.apx}));
}
function dp(P, eps){   // Douglas–Peucker on a closed ring
  const n = P.length; if (n < 5) return P.slice();
  let far = 1; for (let i = 2; i < n; i++) if (d2(P[0], P[i]) > d2(P[0], P[far])) far = i;
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const rec = (a, b) => { let md = eps, mi = -1; const A = P[a], B = P[b % n];
    for (let i = a + 1; i < b; i++) { const d = segDist(P[i], A, B); if (d > md) { md = d; mi = i; } } if (mi >= 0) { keep[mi] = 1; rec(a, mi); rec(mi, b); } };
  rec(0, far); rec(far, n);
  return P.filter((_, i) => keep[i]);
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
function segDist(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; if (!l) return Math.sqrt(d2(p, a)); let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
export function area(P){ let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function inPoly(p, P){ let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

/* ------------------------------------------------------------------ the trace */
export function traceFloor(inp, opt){
  const res0 = {}, t0 = Date.now(), k = inp.k, o = Object.assign({gap: 8.6, ext: 4.6, maxPx: 26e6}, opt || {}), log = [], ft = v => v * k;
  if (!(k > 0)) return {err: "no scale"};
  const names = inp.layers || [], role = i => names[i] ? names[i].role : "", nm = i => names[i] ? names[i].name : "";
  // which layers bound rooms: walls, columns, windows, duct boxes — not doors, stairs, railings, furniture, text, hatch
  const isHatchName = s => /hatch|patt|poch|^wh$|^h$|^hatch1$/i.test(s), isDuct = s => /duct|shaft/i.test(s);
  const outlineL = new Set(), hatchL = new Set(), coreL = new Set(), wallL = new Set();
  names.forEach((L, i) => { const s = L.name || "";
    if (isHatchName(s) || (L.role === "column" && /hatch/i.test(s))) { hatchL.add(i); return; }
    if (/door|stair|step|rail|furn|fix|text|dim|grid|title|plot|tag|note|mep|elec|plumb|light|louv|point|defpoint|wood|mdf|timber|glass/i.test(s) && !/^walls?$/i.test(s)) return;
    if (L.role === "wall" || L.role === "column" || /window|glaz/i.test(s) || isDuct(s) || /^walls?$/i.test(s)) { outlineL.add(i); if (!/low|parapet|rail|balcon/i.test(s)) coreL.add(i); if (L.role === "wall") wallL.add(i); } });
  // content-based hatch: a layer of short parallel diagonal strokes is a hatch, whatever its name (not text: its strokes run every way)
  const st = new Map();
  inp.segs.forEach(s => { const li = s[5]; if (li == null || li < 0 || (s[4] & 1)) return; const l = Math.hypot(s[2] - s[0], s[3] - s[1]); let r = st.get(li); if (!r) st.set(li, r = {n: 0, sd: 0, ang: new Map()});
    r.n++; const a = ((Math.atan2(s[3] - s[1], s[2] - s[0]) * 180 / Math.PI) % 180 + 180) % 180, a9 = a % 90; if (l < 12 && a9 > 20 && a9 < 70) { r.sd++; const b = Math.round(a / 4); r.ang.set(b, (r.ang.get(b) || 0) + 1); } });
  st.forEach((r, li) => { const top = Math.max(0, ...r.ang.values()); if (r.n > 40 && r.sd / r.n > 0.6 && top / Math.max(1, r.sd) > 0.4 && !outlineL.has(li) && !["text", "tag"].includes(role(li))) hatchL.add(li); });
  if (!outlineL.size) return {err: "no wall layers", why: "the PDF has no wall / column / window layers to read walls from"};
  const isOut = s => !(s[4] & 1) && !(s[4] & 8) && outlineL.has(s[5]), isHat = s => hatchL.has(s[5]);
  let OUT = inp.segs.filter(isOut), HAT = inp.segs.filter(isHat);
  if (OUT.length < 20) return {err: "no wall layers", why: "too few wall lines"};
  // the plan's extent: its wall lines
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  OUT.forEach(s => { bx0 = Math.min(bx0, s[0], s[2]); by0 = Math.min(by0, s[1], s[3]); bx1 = Math.max(bx1, s[0], s[2]); by1 = Math.max(by1, s[1], s[3]); });
  bx0 -= 20; by0 -= 20; bx1 += 20; by1 += 20;
  let R = 2;   // px per pt: a 4.5" wall at 1/8" = 1'-0" is still 7 px thick
  while ((bx1 - bx0) * (by1 - by0) * R * R > o.maxPx && R > 0.75) R /= 1.25;
  const G = new Grid(bx0, by0, bx1, by1, R), {W, H, N} = G, P2 = R / k;   // P2: px per ft
  const pxft = v => v * k * R;
  // ---- 1 wall faces left out where a duct box meets the wall: carried across when the hatch runs on beside the gap
  const hatchM = new Uint8Array(N); HAT.forEach(s => line(G, hatchM, s[0], s[1], s[2], s[3]));
  const hatchNear = (x, y, r) => { const cx = G.px(x), cy = G.py(y), rr = Math.ceil(r * R); for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const X = cx + dx, Y = cy + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && hatchM[Y * W + X]) return true; } return false; };
  const repairs = [], byLine = new Map();
  OUT.forEach(s => { if (!wallL.has(s[5])) return; const v = Math.abs(s[0] - s[2]) < 0.02, h = Math.abs(s[1] - s[3]) < 0.02; if (!v && !h) return;
    const key = (v ? "V" : "H") + Math.round((v ? s[0] : s[1]) * 10); let L = byLine.get(key); if (!L) byLine.set(key, L = {o: v ? "V" : "H", c: v ? s[0] : s[1], iv: []}); L.iv.push(v ? [Math.min(s[1], s[3]), Math.max(s[1], s[3])] : [Math.min(s[0], s[2]), Math.max(s[0], s[2])]); });
  byLine.forEach(L => { L.iv.sort((a, b) => a[0] - b[0]); const m = []; L.iv.forEach(([a, b]) => { if (m.length && a <= m[m.length - 1][1] + 0.05) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); });
    for (let i = 0; i + 1 < m.length; i++) { const g = m[i + 1][0] - m[i][1]; if (!(g > 1 && g <= 40)) continue; const mid = (m[i][1] + m[i + 1][0]) / 2;
      const sd = L.o === "V" ? [hatchNear(L.c - 3, mid, 2.5), hatchNear(L.c + 3, mid, 2.5)] : [hatchNear(mid, L.c - 3, 2.5), hatchNear(mid, L.c + 3, 2.5)];
      if (sd[0] !== sd[1]) repairs.push(L.o === "V" ? [L.c, m[i][1], L.c, m[i + 1][0], 0, -2] : [m[i][1], L.c, m[i + 1][0], L.c, 0, -2]); } });
  OUT = OUT.concat(repairs);
  // duct boxes (dashes joined): each closed with its four sides, so the shaft is never part of the room it stands in
  const ducts = [];
  { const dm = new Uint8Array(N); OUT.forEach(s => { if (isDuct(nm(s[5]))) line(G, dm, s[0], s[1], s[2], s[3]); });
    const dc = boxMin(G, boxMax(G, dm, 5), 5); const {lab: dl, n: dn} = label8(G, dc); const db = new Float64Array(4 * (dn + 1)).fill(NaN);
    for (let i = 0; i < N; i++) { const l = dl[i]; if (!l) continue; const x = i % W, y = (i - x) / W, b = 4 * l; if (isNaN(db[b])) { db[b] = db[b + 2] = x; db[b + 1] = db[b + 3] = y; } else { db[b] = Math.min(db[b], x); db[b + 1] = Math.min(db[b + 1], y); db[b + 2] = Math.max(db[b + 2], x); db[b + 3] = Math.max(db[b + 3], y); } }
    const DS = OUT.filter(s => isDuct(nm(s[5])));
    for (let l = 1; l <= dn; l++) { const b = 4 * l, x0 = db[b] / R + bx0, y0 = db[b + 1] / R + by0, x1 = (db[b + 2] + 1) / R + bx0, y1 = (db[b + 3] + 1) / R + by0; if (x1 - x0 < 6 || y1 - y0 < 6) continue;
      const inn = DS.filter(s => Math.min(s[0], s[2]) >= x0 - 1 && Math.max(s[0], s[2]) <= x1 + 1 && Math.min(s[1], s[3]) >= y0 - 1 && Math.max(s[1], s[3]) <= y1 + 1); if (!inn.length) continue;
      const xs = inn.flatMap(s => [s[0], s[2]]), ys = inn.flatMap(s => [s[1], s[3]]); ducts.push({box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]}); }
    ducts.sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
    for (let i = ducts.length - 1; i >= 0; i--) { const a = ducts[i].box; if (ducts.some((d, j) => j < i && a[0] >= d.box[0] - 1 && a[1] >= d.box[1] - 1 && a[2] <= d.box[2] + 1 && a[3] <= d.box[3] + 1)) ducts.splice(i, 1); } }
  ducts.forEach(d => { const [x0, y0, x1, y1] = d.box; OUT.push([x0, y0, x1, y0, 0, -3], [x1, y0, x1, y1, 0, -3], [x1, y1, x0, y1, 0, -3], [x0, y1, x0, y0, 0, -3]); });
  // ---- wall bodies
  const lines = new Uint8Array(N), wl = new Uint8Array(N), diag = new Uint8Array(N);   // diag: pixels of slanted lines (a duct's X): they block, but are no wall face to bridge from
  OUT.forEach(s => { line(G, wallL.has(s[5]) ? wl : lines, s[0], s[1], s[2], s[3]); const a = Math.abs(Math.atan2(s[3] - s[1], s[2] - s[0]) * 180 / Math.PI) % 90; if (a > 2 && a < 88) line(G, diag, s[0], s[1], s[2], s[3]); });
  { // stray marks on a wall layer (a set-out cross): small, touching no other line
    const {lab: cl, n} = label8(G, wl), bb = new Float64Array(4 * (n + 1)).fill(NaN);
    for (let i = 0; i < N; i++) { const l = cl[i]; if (!l) continue; const x = i % W, y = (i - x) / W, b = 4 * l; if (isNaN(bb[b])) { bb[b] = bb[b + 2] = x; bb[b + 1] = bb[b + 3] = y; } else { bb[b] = Math.min(bb[b], x); bb[b + 1] = Math.min(bb[b + 1], y); bb[b + 2] = Math.max(bb[b + 2], x); bb[b + 3] = Math.max(bb[b + 3], y); } }
    const near = boxMax(G, lines, 3), drop = new Uint8Array(n + 1);
    for (let l = 1; l <= n; l++) { const b = 4 * l, ext = Math.max(bb[b + 2] - bb[b], bb[b + 3] - bb[b + 1]) / R; if (ext >= 20) continue;
      let alone = true; for (let y = Math.max(0, bb[b + 1] - 6); y <= Math.min(H - 1, bb[b + 3] + 6) && alone; y++) for (let x = Math.max(0, bb[b] - 6); x <= Math.min(W - 1, bb[b + 2] + 6); x++) { const i = y * W + x, c = cl[i]; if ((c && c !== l) || (c === l && near[i])) { alone = false; break; } }
      if (alone) drop[l] = 1; }
    for (let i = 0; i < N; i++) if (wl[i] && !drop[cl[i]]) lines[i] = 1;
    const nd = drop.reduce((a, v) => a + v, 0); if (nd) log.push(nd + " stray mark" + (nd > 1 ? "s" : "") + " on a wall layer left out");
  }
  const free0 = new Uint8Array(N); for (let i = 0; i < N; i++) free0[i] = lines[i] ? 0 : 1;
  // hatch cover: a wall's inside is hatched all over; a room only has a few hatch strokes running past the wall face into it
  // (a PDF reader that does not clip the hatch to its boundary), which must not make it wall
  const hCov = boxMax(G, hatchM, 2);
  const {lab: pl, n: pn} = label4(G, free0), dist = chamfer(G, free0), radPx = new Float64Array(pn + 1), hasH = new Uint8Array(pn + 1), hN = new Int32Array(pn + 1), pN = new Int32Array(pn + 1);
  for (let i = 0; i < N; i++) { const l = pl[i]; if (!l) continue; pN[l]++; if (dist[i] > radPx[l]) radPx[l] = dist[i]; if (hatchM[i]) hasH[l] = 1; if (hCov[i]) hN[l]++; }
  const outP = pl[0] || pl[W + 1], inch = v => v / 3 / R / k * 12;   // the plan's outside, a chamfer radius in inches
  const body = new Uint8Array(N), wide = new Uint8Array(pn + 1);
  // (a wider piece with hatch in it is a wall whose end the drawing leaves open: its hatched part is wall — when the hatch fills it, not a few strokes in a room)
  for (let l = 1; l <= pn; l++) { if (l === outP) continue; const r = inch(radPx[l]); if ((hasH[l] && r <= 9) || r <= 3.6) wide[l] = 1; else if (hN[l] > 0.3 * pN[l] && r <= 30) wide[l] = 2; }
  let hc = null;
  for (let i = 0; i < N; i++) { if (lines[i]) { body[i] = 1; continue; } const w = wide[pl[i]]; if (w === 1) body[i] = 1; else if (w === 2) { if (!hc) hc = boxMax(G, boxMin(G, boxMax(G, hatchM, 3), 3), 4); if (hc[i]) body[i] = 1; } }   // (the hatch filled out to the wall's lines: no slivers left along its faces)
  // ---- 2 openings: in-line face runs bridged; wall ends carried to the next wall
  const B = new Uint8Array(N), GMAX = Math.round(pxft(o.gap)), GEXT = Math.round(pxft(o.ext)), TMIN = Math.max(2, Math.round(pxft(2.5 / 12))), TMAX = Math.round(pxft(15 / 12)), RMIN = Math.max(3, Math.round(pxft(0.3)));
  const face = new Uint8Array(N); for (let i = 0; i < N; i++) face[i] = body[i] && !(diag[i] && lines[i]) ? 1 : 0;   // wall pixels a face can run along
  const bridgeRuns = (get, set, A, Bn, isF) => {   // A rows of Bn pixels; get(r, c) = wall, isF(r, c) = a wall pixel a face may run along
    for (let r = 1; r < A; r++) for (const side of [-1, 1]) {   // wall pixels with free space above (side -1) / below (+1)
      let runs = [], s = -1;
      for (let c = 0; c <= Bn; c++) { const f = c < Bn && isF(r, c) && !(r + side >= 0 && r + side < A && get(r + side, c)) && r + side >= 0 && r + side < A;
        if (f && s < 0) s = c; else if (!f && s >= 0) { runs.push([s, c - 1]); s = -1; } }
      for (let a = 0; a + 1 < runs.length; a++) { const c1 = runs[a][1], c2 = runs[a + 1][0], g = c2 - c1 - 1;
        if (g < 2 || g > GMAX || runs[a][1] - runs[a][0] < RMIN || runs[a + 1][1] - runs[a + 1][0] < RMIN) continue;
        let clear = true; for (let c = c1 + 1; c < c2; c++) if (get(r, c)) { clear = false; break; }
        if (clear) for (let c = c1 + 1; c < c2; c++) set(r, c); } } };
  bridgeRuns((r, c) => body[r * W + c], (r, c) => { B[r * W + c] = 1; }, H, W, (r, c) => face[r * W + c]);
  bridgeRuns((r, c) => body[c * W + r], (r, c) => { B[c * W + r] = 1; }, W, H, (r, c) => face[c * W + r]);
  const stubs = (get, set, A, Bn, isF) => {   // columns as rows: A = number of columns, Bn = rows per column
    const runsOf = (c, left) => { const out = []; let s = -1; for (let r = 0; r <= Bn; r++) { const f = r < Bn && isF(r, c) && (left ? c > 0 && !get(r, c - 1) : c + 1 < A && !get(r, c + 1)); if (f && s < 0) s = r; else if (!f && s >= 0) { out.push([s, r - 1]); s = -1; } } return out; };
    const RR = new Map(); for (let c = 0; c < A; c++) RR.set(c, null);
    const rruns = c => { let v = RR.get(c); if (v === null || v === undefined) { v = runsOf(c, false); RR.set(c, v); } return v; };
    for (let c = 1; c < A; c++) for (const [s, e] of runsOf(c, true)) { if (e - s < 4) continue;
      for (let t = TMIN; t <= TMAX; t++) { const cr = c + t - 1; if (cr >= A) break;
        for (const [s2, e2] of rruns(cr)) { if (e2 - s2 < 4) continue;
          for (const [end, end2, stp] of [[s, s2, -1], [e, e2, 1]]) { if (Math.abs(end - end2) > 2) continue;
            const r0 = stp < 0 ? Math.min(end, end2) : Math.max(end, end2); let solid = true; for (let x = c; x <= cr; x++) if (!get(r0, x)) { solid = false; break; } if (!solid) continue;
            const nr = r0 + stp; if (nr < 0 || nr >= Bn) continue; let open = true; for (let x = c; x <= cr; x++) if (get(nr, x)) { open = false; break; } if (!open) continue;
            let kk = nr, ok = false;
            while (kk >= 0 && kk < Bn && Math.abs(kk - r0) <= GEXT) { let all = true; for (let x = c; x <= cr; x++) if (!get(kk, x)) { all = false; break; } if (all) { ok = true; break; } if (get(kk, c) || get(kk, cr)) break; kk += stp; }
            if (ok && Math.abs(kk - r0) > 2) { const a = Math.min(nr, kk - stp), b = Math.max(nr, kk - stp); for (let r = a; r <= b; r++) { set(r, c); set(r, cr); } } } } } } };
  stubs((r, c) => body[r * W + c], (r, c) => { B[r * W + c] = 1; }, W, H, (r, c) => face[r * W + c]);          // vertical walls: columns c, rows r
  stubs((r, c) => body[c * W + r], (r, c) => { B[c * W + r] = 1; }, H, W, (r, c) => face[c * W + r]);          // horizontal walls
  // ---- 3 spaces
  const bar = new Uint8Array(N); for (let i = 0; i < N; i++) bar[i] = body[i] || B[i] ? 1 : 0;
  const free = new Uint8Array(N); for (let i = 0; i < N; i++) free[i] = bar[i] ? 0 : 1;
  const {lab, n} = label4(G, free), out0 = lab[W + 1];
  const cnt = new Int32Array(n + 1), sx = new Float64Array(n + 1), sy = new Float64Array(n + 1), bb = new Int32Array(4 * (n + 1)).fill(-1);
  for (let i = 0; i < N; i++) { const l = lab[i]; if (!l) continue; const x = i % W, y = (i - x) / W; cnt[l]++; sx[l] += x; sy[l] += y; const b = 4 * l;
    if (bb[b] < 0) { bb[b] = bb[b + 2] = x; bb[b + 1] = bb[b + 3] = y; } else { if (x < bb[b]) bb[b] = x; if (y < bb[b + 1]) bb[b + 1] = y; if (x > bb[b + 2]) bb[b + 2] = x; if (y > bb[b + 3]) bb[b + 3] = y; } }
  const sft = l => cnt[l] / R / R / k / k, bft = l => [(bb[4 * l + 2] - bb[4 * l] + 1) / R / k, (bb[4 * l + 3] - bb[4 * l + 1] + 1) / R / k], cen = l => [sx[l] / cnt[l] / R + bx0, sy[l] / cnt[l] / R + by0];
  const thin = l => { const [w, h] = bft(l); return Math.min(w, h) <= 1.3 && sft(l) <= 14; };
  // regions touching across an opening line or a single drawn line (up to 3 px; 5 for a thin piece) — never through a wall
  const touch = (l, depth) => {
    const b = 4 * l, res = new Map(), X0 = Math.max(0, bb[b] - depth), Y0 = Math.max(0, bb[b + 1] - depth), X1 = Math.min(W - 1, bb[b + 2] + depth), Y1 = Math.min(H - 1, bb[b + 3] + depth);
    const w = X1 - X0 + 1, seen = new Uint8Array(w * (Y1 - Y0 + 1)); let fr = [];
    for (let y = bb[b + 1]; y <= bb[b + 3]; y++) for (let x = bb[b]; x <= bb[b + 2]; x++) if (lab[y * W + x] === l) { seen[(y - Y0) * w + x - X0] = 1; fr.push(x, y); }
    for (let dd = 0; dd < depth && fr.length; dd++) { const nf = [];
      for (let q = 0; q < fr.length; q += 2) { const x = fr[q], y = fr[q + 1];
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ax, Y = y + ay; if (X < X0 || Y < Y0 || X > X1 || Y > Y1) continue; const j = (Y - Y0) * w + X - X0; if (seen[j]) continue; seen[j] = 1;
          const i = Y * W + X, o2 = lab[i]; if (o2 && o2 !== l) { if (o2 !== out0) res.set(o2, (res.get(o2) || 0) + 1); continue; } nf.push(X, Y); } }   // (through a drawn line or two: a wall is 13 px and more)
      fr = nf; }
    res.forEach((v, kk) => res.set(kk, v / R / k)); return res; };
  const ADJ = new Map(), nbrs = l => { let v = ADJ.get(l); if (!v) { v = touch(l, thin(l) ? 5 : 3); ADJ.set(l, v); } return v; };
  // the inside of the external walls: wall lines (no parapets, railings) and opening lines, holes filled
  const core = new Uint8Array(N); OUT.forEach(s => { if (coreL.has(s[5]) || s[5] === -2 || s[5] === -3) line(G, core, s[0], s[1], s[2], s[3]); });
  for (let i = 0; i < N; i++) if (B[i]) core[i] = 1;
  const outside = fillOutside(G, core), INSIDE = new Uint8Array(N); for (let i = 0; i < N; i++) INSIDE[i] = outside[i] ? 0 : 1;
  const isOutside = l => { const [x, y] = cen(l); const X = G.px(x), Y = G.py(y); return !(X >= 0 && Y >= 0 && X < W && Y < H && INSIDE[Y * W + X]); };
  const inDuct = l => { const [x, y] = cen(l); return ducts.some(d => x >= d.box[0] - 1 && x <= d.box[2] + 1 && y >= d.box[1] - 1 && y <= d.box[3] + 1); };
  // room names and their written sizes: a name line, the lines right under it that carry the name on ("MAID/KIDS" / "ROOM"),
  // and the size line under them — read across the text's own direction (a balcony's name written up the page)
  const TL = (inp.lines || []).filter(t => t.s && String(t.s).trim()).map(t => { const s0 = String(t.s).trim(), rest = s0.replace(SIZE_RX, "").replace(WIDE_RX, "").replace(/\bWIDE\b/i, "");
    const vert = Math.abs(Math.sin(t.r || 0)) > 0.7; return {s: s0, cx: t.cx != null ? t.cx : t.x + t.w / 2, cy: t.cy != null ? t.cy : t.y - t.h / 2, h: t.h || 6, w: t.w || 0, vert,
      size: !!(sizeOf(s0) || WIDE_RX.test(s0)), alpha: /[A-Z]{2,}/i.test(rest) && !NAME_SKIP.test(s0) && !/^[A-Z]?\d{3,4}[A-Z]?$/.test(s0)}; });
  TL.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const usedT = new Set(), labels = [];
  const below = (c, p) => { const along = c.vert ? Math.abs(p.cy - c.cy) : Math.abs(p.cx - c.cx), across = c.vert ? Math.abs(p.cx - c.cx) : p.cy - c.cy;   // the next line under c
    return p !== c && !usedT.has(p) && p.vert === c.vert && along < Math.max(3 * c.h, c.w / 2 + c.h) && across > 0.4 * c.h && across < 1.9 * c.h; };
  TL.forEach(t => { if (!t.alpha || usedT.has(t)) return; usedT.add(t);
    let name = t.s.replace(SIZE_RX, "").trim(), size = sizeOf(t.s) ? SIZE_RX.exec(t.s)[0] : "", cur = t;
    for (let guard = 0; guard < 4 && !size; guard++) {
      const nx = TL.filter(p => below(cur, p)).sort((p, q) => (cur.vert ? Math.abs(p.cx - cur.cx) - Math.abs(q.cx - cur.cx) : p.cy - q.cy))[0]; if (!nx) break;
      if (nx.size && !nx.alpha) { size = (SIZE_RX.exec(nx.s) || WIDE_RX.exec(nx.s) || [nx.s])[0]; usedT.add(nx); break; }
      if (nx.alpha) { name += " " + nx.s.replace(SIZE_RX, "").trim(); usedT.add(nx); if (sizeOf(nx.s)) size = SIZE_RX.exec(nx.s)[0]; cur = nx; continue; }
      break; }
    if (!size && WIDE_RX.test(name)) size = WIDE_RX.exec(name)[0];
    labels.push({name: name.replace(/\s+/g, " ").trim(), size: size.trim(), x: t.cx, y: t.cy, h: t.h}); });
  const regAt = (x, y) => { for (const [dx, dy] of [[0, 0], [0, 6], [0, -6], [6, 0], [-6, 0], [0, 12], [0, -12], [12, 0], [-12, 0]]) { const X = G.px(x + dx), Y = G.py(y + dy); if (X >= 0 && Y >= 0 && X < W && Y < H && lab[Y * W + X] && lab[Y * W + X] !== out0) return lab[Y * W + X]; } return 0; };
  const spaces = [], r2s = new Map(), done = new Set([out0]);
  const byReg = new Map(); labels.forEach(l => { const r = regAt(l.x, l.y); if (!r) return; let L = byReg.get(r); if (!L) byReg.set(r, L = []); L.push(l); });
  byReg.forEach((L, r) => { const ns = [], ss = []; L.forEach(l => { if (!ns.includes(l.name)) { ns.push(l.name); ss.push(l.size); } });
    const kinds = ns.map(kindOf), kd = kinds.includes("corridor") ? "corridor" : new Set(kinds).size === 1 ? kinds[0] : "room";
    const s = {regs: [r], names: ns, sizes: ss, kind: kd, lx: L[0].x, ly: L[0].y, labs: L, notes: [], how: "traced"}; spaces.push(s); r2s.set(r, s); done.add(r); });
  const nbS = (regs, thinDepth) => { const out = new Map(); regs.forEach(r => nbrs(r).forEach((v, o2) => { if (regs.includes(o2)) return; const s = r2s.get(o2); if (s) out.set(s, (out.get(s) || 0) + v); })); return [...out.entries()].sort((a, b) => b[1] - a[1]); };
  let ch = true;
  while (ch) { ch = false; for (let r = 1; r <= n; r++) { if (done.has(r) || sft(r) < 0.4 || thin(r) || inDuct(r) || isOutside(r)) continue;   // corridor parts
    const nb = nbS([r]); if (nb.length && nb[0][0].kind === "corridor" && nb[0][1] >= 2) { nb[0][0].regs.push(r); r2s.set(r, nb[0][0]); done.add(r); ch = true; } } }
  spaces.filter(s => s.kind === "lift").forEach(s => { const b = 4 * s.regs[0], m = 40;   // lift shaft parts behind the car line
    for (let r = 1; r <= n; r++) { if (done.has(r) || sft(r) < 3 || thin(r)) continue; const q = 4 * r;
      if (bb[q] >= bb[b] - m && bb[q + 2] <= bb[b + 2] + m && bb[q + 1] >= bb[b + 1] - m && bb[q + 3] <= bb[b + 3] + m) { s.regs.push(r); r2s.set(r, s); done.add(r); s.notes.push("lift shaft parts behind the car outline joined"); } } });
  const pending = []; for (let r = 1; r <= n; r++) if (!done.has(r) && (sft(r) >= 0.4 || (thin(r) && sft(r) >= 0.02)) && !inDuct(r)) pending.push(r);
  // thin pieces that touch each other (one doorway cut in two by a stray opening line) are one piece
  const par = new Map(); pending.filter(thin).forEach(r => par.set(r, r));
  const find = r => { while (par.get(r) !== r) { par.set(r, par.get(par.get(r))); r = par.get(r); } return r; };
  par.forEach((_, r) => nbrs(r).forEach((_, o2) => { if (par.has(o2)) par.set(find(o2), find(r)); }));
  const groups = new Map(); par.forEach((_, r) => { const f = find(r); let L = groups.get(f); if (!L) groups.set(f, L = []); L.push(r); });
  const gOf = new Map(); groups.forEach(g => g.forEach(r => gOf.set(r, g)));
  const voids = [];
  pending.slice().sort((a, b) => sft(b) - sft(a)).forEach(r => { if (thin(r) || done.has(r)) return;
    const direct = nbS([r]), via = new Map(); nbrs(r).forEach((_, o2) => { const g = gOf.get(o2); if (g && !g.some(x => done.has(x))) nbS(g).forEach(([s, v]) => via.set(s, v)); });
    const all = direct.concat([...via.entries()]), kinds = new Set(all.map(e => e[0].kind));
    if ((kinds.size === 1 && kinds.has("balcony")) || (isOutside(r) && kinds.has("balcony"))) { const tb = all.filter(e => e[0].kind === "balcony").sort((a, b) => b[1] - a[1])[0][0]; tb.regs.push(r); r2s.set(r, tb); done.add(r); tb.notes.push("balcony piece of " + sft(r).toFixed(1) + " Sft across a parapet / railing break joined"); return; }
    if (isOutside(r)) { log.push("a piece of " + sft(r).toFixed(1) + " Sft outside the external walls, touching no balcony, left out"); done.add(r); return; }
    if (!direct.length && !via.size) { if (sft(r) >= 0.8) { const s = {regs: [r], names: ["VOID / SHAFT"], sizes: [""], kind: "void", notes: ["closed by walls on all sides, no name on the drawing: pipe shaft / void"], how: "traced", unlabelled: true}; spaces.push(s); r2s.set(r, s); done.add(r); } return; }
    if (direct.length === 1 && !via.size) { const s = direct[0][0]; s.regs.push(r); r2s.set(r, s); done.add(r); s.notes.push("niche of " + sft(r).toFixed(1) + " Sft (open to this room only) joined"); return; }
    if (sft(r) < 1) return;
    const s = {regs: [r], names: ["PASSAGE"], sizes: [""], kind: "room", notes: ["no name on the drawing: passage between rooms"], how: "traced", unlabelled: true}; spaces.push(s); r2s.set(r, s); done.add(r); });
  const thresholds = [];
  groups.forEach(g => { if (g.some(r => done.has(r))) return; const nb = nbS(g);
    if (nb.length >= 2) { thresholds.push({regs: g, kind: "threshold", notes: g.length > 1 ? [g.length + " slivers of one doorway joined"] : [], how: "traced", between: [nb[0][0], nb[1][0]]}); g.forEach(r => done.add(r)); }
    else if (nb.length === 1) { const s = nb[0][0]; g.forEach(r => { s.regs.push(r); r2s.set(r, s); done.add(r); }); s.notes.push("recess of " + g.reduce((a, r) => a + sft(r), 0).toFixed(1) + " Sft joined"); }
    else { const a2 = g.reduce((a, r) => a + sft(r), 0); if (a2 >= 0.8 && !g.some(isOutside)) { const s = {regs: g, names: ["VOID / SHAFT"], sizes: [""], kind: "void", notes: ["closed by walls on all sides, no name on the drawing: pipe shaft / void"], how: "traced", unlabelled: true}; spaces.push(s); g.forEach(r => r2s.set(r, s)); } g.forEach(r => done.add(r)); } });
  // ---- 4 outlines
  const LN = new Lines(OUT.map(s => s.slice ? s.slice(0, 4) : s)), SNAP = 1.8;
  const traceRegs = regs => {   // the regions' pixels (1 px gaps between them closed) -> {outer: [[pts]], holes, un}
    let X0 = W, Y0 = H, X1 = 0, Y1 = 0; regs.forEach(r => { const b = 4 * r; X0 = Math.min(X0, bb[b]); Y0 = Math.min(Y0, bb[b + 1]); X1 = Math.max(X1, bb[b + 2]); Y1 = Math.max(Y1, bb[b + 3]); });
    X0 = Math.max(0, X0 - 2); Y0 = Math.max(0, Y0 - 2); X1 = Math.min(W - 1, X1 + 2); Y1 = Math.min(H - 1, Y1 + 2);
    const set = new Set(regs), w = X1 - X0 + 1, h = Y1 - Y0 + 1, m = new Uint8Array(w * h);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (set.has(lab[y * W + x])) m[(y - Y0) * w + x - X0] = 1;
    if (regs.length > 1) { for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (m[i]) continue;   // a 1–2 px line between two of them: closed
      if ((m[i - 1] && (m[i + 1] || m[i + 2])) || (m[i - w] && (m[i + w] || m[i + 2 * w]))) m[i] = 2; } }
    const L = loops(G, i => { const x = i % W, y = (i - x) / W; return m[(y - Y0) * w + x - X0] > 0; }, [X0, Y0, X1 + 1, Y1 + 1]);
    const outer = [], holes = []; let un = 0;
    const unE = []; L.forEach(lp => { if (lp.apx < 6) return; const f = fitRing(dp(lp.pts, 1.2 / R), LN, SNAP); un += f.un; unE.push(...fitRing.last); if (f.pts.length >= 3) (lp.hole ? holes : outer).push(f.pts); });
    return {outer, holes, un, unE}; };
  const setGeom = (s, gm) => { s.outer = gm.outer.filter(p => area(p) > 0.5); s.holes = gm.holes.filter(p => area(p) > 0.5);
    s.sft = (s.outer.reduce((a, p) => a + area(p), 0) - s.holes.reduce((a, p) => a + area(p), 0)) / k / k; s.unsnapped = gm.un; if (gm.unE && gm.unE.length) s.unsnE = gm.unE.slice(0, 40);
    const xs = s.outer.flatMap(p => p.map(q => q[0])), ys = s.outer.flatMap(p => p.map(q => q[1])); s.bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    s.bw = (s.bounds[2] - s.bounds[0]) / k; s.bh = (s.bounds[3] - s.bounds[1]) / k; };
  spaces.concat(thresholds).forEach(s => setGeom(s, traceRegs(s.regs)));
  // doors drawn closed: the wall outline runs on across the opening, the hatch stops — a threshold between the two rooms
  { const unh = new Uint8Array(N), lnD = boxMax(G, lines, 1), hD = boxMax(G, hatchM, 6), winD = new Uint8Array(N);
    OUT.forEach(s => { if (/window|glaz|duct|louv/i.test(nm(s[5]))) line(G, winD, s[0], s[1], s[2], s[3]); }); const winX = boxMax(G, winD, 4);
    for (let i = 0; i < N; i++) unh[i] = body[i] && !lnD[i] && !hD[i] && !winX[i] ? 1 : 0;
    const {lab: ul, n: un} = label8(G, unh), ub = new Int32Array(4 * (un + 1)).fill(-1), uc = new Int32Array(un + 1);
    for (let i = 0; i < N; i++) { const l = ul[i]; if (!l) continue; uc[l]++; const x = i % W, y = (i - x) / W, b = 4 * l; if (ub[b] < 0) { ub[b] = ub[b + 2] = x; ub[b + 1] = ub[b + 3] = y; } else { ub[b] = Math.min(ub[b], x); ub[b + 1] = Math.min(ub[b + 1], y); ub[b + 2] = Math.max(ub[b + 2], x); ub[b + 3] = Math.max(ub[b + 3], y); } }
    const HS = HAT, D = 6, kept = [];
    for (let l = 1; l <= un; l++) { const b = 4 * l, x0 = ub[b], y0 = ub[b + 1], x1 = ub[b + 2] + 1, y1 = ub[b + 3] + 1, w = x1 - x0, h = y1 - y0, hz = w >= h, Lft = ((hz ? w : h) + 2 * D) / R / k;
      if (Lft < 1.75 || Lft > 8.5 || uc[l] < 0.5 * w * h) continue;
      let a, bq, s1, s2, bxp;
      if (hz) { const cx = (x0 + x1) >> 1; a = y0; bq = y1; while (a > 0 && body[(a - 1) * W + cx]) a--; while (bq < H && body[bq * W + cx]) bq++; s1 = a >= 3 ? lab[(a - 3) * W + cx] : 0; s2 = bq + 2 < H ? lab[(bq + 2) * W + cx] : 0; bxp = [x0 - D, a, x1 + D, bq]; }
      else { const cy = (y0 + y1) >> 1; a = x0; bq = x1; while (a > 0 && body[cy * W + a - 1]) a--; while (bq < W && body[cy * W + bq]) bq++; s1 = a >= 3 ? lab[cy * W + a - 3] : 0; s2 = bq + 2 < W ? lab[cy * W + bq + 2] : 0; bxp = [a, y0 - D, bq, y1 + D]; }
      const tft = (bq - a) / R / k; if (tft > 1.3 || !s1 || !s2 || s1 === out0 || s2 === out0 || s1 === s2) continue;
      const sa = r2s.get(s1), sb = r2s.get(s2); if (!sa || !sb || sa === sb) continue;
      // its ends: where the wall hatch stops on either side of the stretch
      const P0 = bxp.map((v, i) => (i % 2 ? v / R + by0 : v / R + bx0)), c = hz ? (P0[0] + P0[2]) / 2 : (P0[1] + P0[3]) / 2, ends = [];
      HS.forEach(s => { for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) { if (hz ? (y >= P0[1] - 0.5 && y <= P0[3] + 0.5 && x >= P0[0] - 30 && x <= P0[2] + 30) : (x >= P0[0] - 0.5 && x <= P0[2] + 0.5 && y >= P0[1] - 30 && y <= P0[3] + 30)) ends.push(hz ? x : y); } });
      const lo = ends.filter(v => v < c), hi = ends.filter(v => v > c); if (!lo.length || !hi.length) continue;
      const j0 = Math.max(...lo), j1 = Math.min(...hi); if ((j1 - j0) / k < 1.75) continue;   // narrower than a door once its ends are found
      // the long sides on the two rooms' faces (the drawn lines)
      const fa = LN.match(hz ? [j0, P0[1]] : [P0[0], j0], hz ? [j1, P0[1]] : [P0[0], j1], 2.5, 4), fb = LN.match(hz ? [j0, P0[3]] : [P0[2], j0], hz ? [j1, P0[3]] : [P0[2], j1], 2.5, 4);
      const ya = fa ? (hz ? fa.p[1] : fa.p[0]) : (hz ? P0[1] : P0[0]), yb = fb ? (hz ? fb.p[1] : fb.p[0]) : (hz ? P0[3] : P0[2]);
      const pts = hz ? [[j0, ya], [j1, ya], [j1, yb], [j0, yb]] : [[ya, j0], [yb, j0], [yb, j1], [ya, j1]];
      if (kept.some(q => Math.abs(q[0][0] - pts[0][0]) < 2 && Math.abs(q[0][1] - pts[0][1]) < 2)) continue;
      kept.push(pts);
      const t = {regs: [], kind: "threshold", how: "closed-door", notes: ["door drawn closed: the wall outline runs on across it; its width is where the wall hatch stops"], between: [sa, sb], unsnapped: 0, closedBox: pts};
      setGeom(t, {outer: [pts], holes: [], un: 0}); thresholds.push(t); } }
  const TOL = 1 / 12;
  const span = (s, d, hz) => { const E = []; s.outer.concat(s.holes).forEach(P => P.forEach((p, i) => { const q = P[(i + 1) % P.length]; if (hz ? Math.abs(p[1] - q[1]) < 0.05 : Math.abs(p[0] - q[0]) < 0.05) E.push([p, q]); }));
    let best = null; for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) { const [p1, q1] = E[i], [p2, q2] = E[j], a = hz ? 0 : 1, c1 = hz ? p1[1] : p1[0], c2 = hz ? p2[1] : p2[0];
      const lo = Math.max(Math.min(p1[a], q1[a]), Math.min(p2[a], q2[a])), hi = Math.min(Math.max(p1[a], q1[a]), Math.max(p2[a], q2[a])); if (hi - lo < 6) continue;
      const e = Math.abs(Math.abs(c1 - c2) / k - d); if (best == null || e < best) best = e; }
    return best; };
  // ---- open to another room it is named with (Bed room + Dress): split on the written size when the walls fit it
  const splits = [];
  spaces.slice().forEach(s => { if (s.names.length !== 2 || s.outer.length !== 1) return;
    for (let j = 1; j >= 0; j--) { const sz = sizeOf(s.sizes[j]); if (!sz) continue; const lb = s.labs.find(l => l.name === s.names[j]); if (!lb) continue;
      const P = s.outer[0], hit = (x, y, dx, dy) => { let best = null; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], q = isectSeg([x, y], [x + dx * 1e4, y + dy * 1e4], a, b); if (q && (best == null || q < best)) best = q; } return best; };
      const db = hit(lb.x, lb.y, 0, 1); if (db == null) continue; const yb = lb.y + db * 1e4 * 1, yw = yb - 5;
      const dl = hit(lb.x, yw, -1, 0), dr = hit(lb.x, yw, 1, 0); if (dl == null || dr == null) continue;
      const xl = lb.x - dl * 1e4, xr = lb.x + dr * 1e4, wid = (xr - xl) / k;
      const [a1, b1] = sz, wide = Math.abs(wid - a1) <= Math.abs(wid - b1) ? a1 : b1, deep = wide === a1 ? b1 : a1;
      if (Math.abs(wid - wide) > 1 / 12) continue;   // the walls do not fit the written size: open plan, kept as one
      const yt = yb - deep * k, cut = [[xl, yt], [xr, yt], [xr, yb], [xl, yb]];
      if (!cut.every(q => inPoly([q[0] + (q[0] < (xl + xr) / 2 ? 0.5 : -0.5), q[1] + (q[1] < (yt + yb) / 2 ? 0.5 : -0.5)], P))) continue;
      const onWall = (a, b) => { let n2 = 0; for (let f = 0.05; f < 1; f += 0.1) { const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; if (P.some((u, i) => segDist(q, u, P[(i + 1) % P.length]) < 1)) n2++; } return n2 >= 9; };
      if (!(onWall([xl, yt], [xl, yb]) && onWall([xr, yt], [xr, yb]) && onWall([xl, yb], [xr, yb]))) continue;   // not walled on three sides: an open plan
      // split the pixels on the line, both parts traced (the line given to the snap so its side is exact)
      LN.L.push(Object.assign([xl, yt, xr, yt], {u: [1, 0], l: xr - xl, th: 0})); LN.grid = null; rebuildGrid(LN);
      const yPx = G.py(yt), other = s.names[1 - j];
      const A = Object.assign({}, s, {names: [other], sizes: [s.sizes[1 - j]], labs: s.labs.filter(l => l.name === other), notes: s.notes.concat(["split from its open " + s.names[j] + " on the written size " + s.sizes[j]]), how: "manual"});
      const Bs = Object.assign({}, s, {names: [s.names[j]], sizes: [s.sizes[j]], labs: [lb], kind: kindOf(s.names[j]), notes: ["no wall between " + s.names[j] + " and " + other + " on the drawing: " + s.names[j] + " = the wall faces left, right and below its name, " + (deep * 12).toFixed(1) + "\" deep (written " + s.sizes[j] + ")"], how: "manual"});
      const inRect = i => { const x = i % W, y = (i - x) / W, X = x / R + bx0, Y = y / R + by0; return X >= xl && X <= xr && Y >= yt && Y <= yb; };
      const gm = (keepIn) => { const regs = s.regs; let X0 = W, Y0 = H, X1 = 0, Y1 = 0; regs.forEach(r => { const b = 4 * r; X0 = Math.min(X0, bb[b]); Y0 = Math.min(Y0, bb[b + 1]); X1 = Math.max(X1, bb[b + 2]); Y1 = Math.max(Y1, bb[b + 3]); });
        const set = new Set(regs), Lp = loops(G, i => set.has(lab[i]) && (keepIn ? inRect(i) : !inRect(i)) && !(Math.abs(Math.floor(i / W) - yPx) < 1 && !keepIn), [Math.max(0, X0 - 2), Math.max(0, Y0 - 2), Math.min(W, X1 + 3), Math.min(H, Y1 + 3)]);
        const outer = [], holes = []; let un = 0; Lp.forEach(lp => { if (lp.apx < 6) return; const f = fitRing(dp(lp.pts, 1.2 / R), LN, SNAP); un += f.un; if (f.pts.length >= 3) (lp.hole ? holes : outer).push(f.pts); }); return {outer, holes, un}; };
      setGeom(A, gm(false)); setGeom(Bs, gm(true));
      const za = sizeOf(A.sizes[0]);   // the room left over must then be its own written size too
      if (!za || ![[za[0], za[1]], [za[1], za[0]]].some(([p1, q1]) => { const ex = span(A, p1, false), ey = span(A, q1, true); return ex != null && ey != null && ex <= TOL && ey <= TOL; })) { LN.L.pop(); rebuildGrid(LN); continue; }
      spaces.splice(spaces.indexOf(s), 1, A, Bs); splits.push({line: [[xl, yt], [xr, yt]], what: s.names[j] + " / " + other});
      thresholds.forEach(t => { t.between = t.between.map(x => x === s ? A : x); });
      break; } });
  // ---- 5 checks: the written L × W as two pairs of facing sides
  spaces.forEach(s => { s.chk = [];
    if (s.names.length === 1) {
      s.sizes.forEach(z => { const d = sizeOf(z); if (!d) return; let bestO = null;
        for (const [a, b] of [d, [d[1], d[0]]]) { const ex = span(s, a, false), ey = span(s, b, true); if (ex != null && ey != null && (bestO == null || ex + ey < bestO[0])) bestO = [ex + ey, ex, ey]; }
        if (!bestO) s.chk.push({size: z, ok: false, why: "no two pairs of facing sides"}); else s.chk.push({size: z, ok: bestO[1] <= TOL && bestO[2] <= TOL, off: Math.max(bestO[1], bestO[2]) * 12, rect: Math.abs(s.sft - d[0] * d[1]) <= 0.01 * d[0] * d[1] + 0.2, more: s.sft > d[0] * d[1]}); });
      const w = wideOf(s.names.concat(s.sizes).join(" ")); if (w && !s.chk.length) { const ex = span(s, w, false), ey = span(s, w, true), e = [ex, ey].filter(v => v != null); s.chk.push({size: (WIDE_RX.exec(s.names.concat(s.sizes).join(" ")) || [""])[0], ok: e.length && Math.min(...e) <= TOL, off: e.length ? Math.min(...e) * 12 : null, wide: true}); }
    }
    const slanted = s.outer.some(P => P.some((p, i) => { const q = P[(i + 1) % P.length]; return Math.abs(p[0] - q[0]) > 0.05 && Math.abs(p[1] - q[1]) > 0.05; })), bad = s.chk.filter(c => !c.ok);
    bad.forEach(c => s.notes.push("written " + c.size + " not found between the drawn walls" + (c.off != null ? " (nearest " + c.off.toFixed(1) + "\" off)" : "")));
    if (s.how === "manual") s.status = "manual";
    else if (s.unsnapped > 2) { s.status = "auto"; s.notes.push(s.unsnapped + " sides traced where no drawn line runs — check"); }
    else if (s.chk.length && !bad.length) s.status = "dims";
    else if (bad.length && s.kind === "balcony" && slanted) { s.status = "walls"; s.notes.push("tapered balcony: the written width holds at one end only"); }
    else if (bad.length) s.status = "auto";
    else s.status = "walls";
    if (s.names.length > 1) s.notes.push("open plan: " + s.names.map((x, i) => (x + " " + (s.sizes[i] || "")).trim()).join(", ") + " — no walls between them on the drawing, measured as one floor");
    const nr = s.chk.find(c => c.rect === false); if (s.chk.length && !bad.length && nr) s.notes.push("written size = the main rectangle; the outline " + (nr.more ? "also takes in a recess / bay along the drawn walls" : "leaves out a duct / pier standing in it")); });
  thresholds.forEach(t => { t.status = t.unsnapped > 1 ? "auto" : "walls"; t.w_ft = Math.max(t.bw, t.bh); t.t_ft = Math.min(t.bw, t.bh); });
  // ---- every side of a washroom / corridor: wall face or opening, and the wall's thickness
  const CD = new Uint8Array(N); thresholds.forEach(t => { if (!t.closedBox) return; const [p, , q] = [t.closedBox[0], 0, t.closedBox[2]]; for (let y = G.py(Math.min(p[1], q[1])); y <= G.py(Math.max(p[1], q[1])); y++) for (let x = G.px(Math.min(p[0], q[0])); x <= G.px(Math.max(p[0], q[0])); x++) if (x >= 0 && y >= 0 && x < W && y < H) CD[y * W + x] = 1; });
  const pxAt = (x, y) => { const X = Math.floor((x - bx0) * R), Y = Math.floor((y - by0) * R); return X >= 0 && Y >= 0 && X < W && Y < H ? Y * W + X : -1; };
  spaces.forEach(s => { if (!["bath", "corridor"].includes(s.kind) || s.outer.length !== 1) return; const P = s.outer[0]; s.edges = [];
    P.forEach((p, i) => { const q = P[(i + 1) % P.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-6) return; const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L; let nx = -uy, ny = ux;
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (inPoly([mx + nx * 1.5, my + ny * 1.5], P)) { nx = -nx; ny = -ny; }
      const steps = Math.max(2, Math.floor(L / 0.5)), lb = [];
      for (let j = 0; j <= steps; j++) { const x = p[0] + ux * L * j / steps, y = p[1] + uy * L * j / steps; let op = false, wa = false;
        for (const dd of [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]) { const ii = pxAt(x + nx * dd, y + ny * dd); if (ii < 0) continue; if ((B[ii] || CD[ii]) && dd <= 1) op = true; if (body[ii]) wa = true; }
        lb.push(op ? 2 : wa ? 1 : 0); }
      const ops = []; for (let j = 0; j <= steps;) { if (lb[j] !== 2) { j++; continue; } let e = j; while (e + 1 <= steps && lb[e + 1] === 2) e++; if ((e - j) / steps * L >= 0.9 * k) ops.push([j / steps * L / k, e / steps * L / k]); j = e + 1; }
      if (ops.length) {   // each end onto the jamb: a corner of the threshold on this face (on the vector lines), when within a pixel or two
        const at = []; thresholds.forEach(t => t.outer.forEach(P0 => P0.forEach(v => { const dx = v[0] - p[0], dy = v[1] - p[1], u = dx * ux + dy * uy; if (Math.abs(dy * ux - dx * uy) < 1.5 && u > -1 && u < L + 1) at.push(u / k); })));
        ops.forEach(o => [0, 1].forEach(i => { let b = null; at.forEach(u => { if (Math.abs(u - o[i]) < 1.2 / k && (b == null || Math.abs(u - o[i]) < Math.abs(b - o[i]))) b = u; }); if (b != null) o[i] = Math.max(0, Math.min(L / k, b)); })); }
      const thick = []; for (const f of [0.2, 0.4, 0.6, 0.8]) { let d = 0.5, seen = false, got = null; const x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f;
        while (d < 40) { const ii = pxAt(x + nx * d, y + ny * d); if (ii < 0) break; if (body[ii] || B[ii]) seen = true; else if (seen) { got = d; break; } d += 0.5; } if (got) thick.push(got); }
      thick.sort((a, b) => a - b); const tm = thick.length ? thick[thick.length >> 1] : null, wf = lb.filter(v => v === 1).length / lb.length;
      const bi = pxAt(mx + nx * 3, my + ny * 3), beyond = bi >= 0 && lab[bi] && lab[bi] !== out0 && !body[bi] && !inDuct(lab[bi]);   // (a duct box's side is its wall, never a door)
      if ((tm == null || tm < 2) && wf > 0.5 && L / k >= 1.5 && beyond) { ops.length = 0; ops.push([0, L / k]); s.notes.push("an opening drawn as a single line (" + (L / k).toFixed(2) + " ft) taken as a door"); }
      s.edges.push({p, q, L: L / k, open: ops, t: tm, n: [nx, ny]}); });
    if (s.kind === "bath") {   // its walls' centre line, for reference: each face moved out by half its wall
      const E = s.edges, Lc = E.map(e => { const off = (e.t || 6.8) / 2; return [[e.p[0] + e.n[0] * off, e.p[1] + e.n[1] * off], [e.q[0] - e.p[0], e.q[1] - e.p[1]]]; });
      s.centre = Lc.map((b, i) => { const a = Lc[(i + Lc.length - 1) % Lc.length], v = isect(a[0], norm(a[1]), b[0], norm(b[1])); return v || b[0]; }); } });
  // corridor zones: the line between two zones is no wall
  const corr = spaces.filter(s => s.kind === "corridor");
  corr.forEach(s => { if (!s.edges) return; const before = s.edges.length;
    s.edges = s.edges.filter(e => { const m = [(e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2]; return !corr.some(o2 => o2 !== s && o2.outer.some(P => P.some((a, i) => segDist(m, a, P[(i + 1) % P.length]) < 0.6))); });
    if (s.edges.length < before) s.notes.push((before - s.edges.length) + " side(s) shared with the next corridor zone: no wall there, not in the wall length"); });
  // ---- flats: door connections from each flat's number, never through common areas
  const COMMON = new Set(["corridor", "lift", "stair", "chute", "void"]), link = new Map(), addL = (a, b) => { if (a === b) return; (link.get(a) || link.set(a, new Set()).get(a)).add(b); (link.get(b) || link.set(b, new Set()).get(b)).add(a); };
  thresholds.forEach(t => { if (t.how !== "closed-door") addL(t.between[0], t.between[1]); });
  spaces.forEach(s => s.regs.forEach(r => nbrs(r).forEach((v, o2) => { const so = r2s.get(o2); if (so && so !== s && v > 1) addL(s, so); })));
  splits.forEach(() => {}); // (split rooms share their split line: linked below)
  for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) if (spaces[i].how === "manual" && spaces[j].how === "manual" && spaces[i].regs === spaces[j].regs) addL(spaces[i], spaces[j]);
  const unitT = (inp.lines || []).filter(t => /^[A-Z]?\d{3,4}[A-Z]?$/.test(String(t.s).trim()));
  const flats = () => { spaces.forEach(s => { delete s.unit; });
    unitT.forEach(t => { const x = t.cx != null ? t.cx : t.x + t.w / 2, y = t.cy != null ? t.cy : t.y - t.h / 2, s0 = spaces.find(s => s.outer.some(P => inPoly([x, y], P))); if (!s0) return;
      const q = [s0], seen = new Set([s0]); while (q.length) { const s = q.pop(); s.unit = String(t.s).trim(); (link.get(s) || []).forEach(o2 => { if (seen.has(o2) || COMMON.has(o2.kind) || /^ELECTRIC/i.test(o2.names[0])) return; seen.add(o2); q.push(o2); }); } }); };
  flats();
  for (const t of thresholds.filter(t => t.how === "closed-door")) { const [a, b] = t.between;
    if (a.unit && b.unit && a.unit !== b.unit) { log.push("an unhatched stretch of wall between " + a.names[0] + " (" + a.unit + ") and " + b.names[0] + " (" + b.unit + ") is not taken as a door: it would join two flats"); thresholds.splice(thresholds.indexOf(t), 1); continue; }
    addL(a, b); flats(); }
  spaces.forEach(s => { if (!s.unit) s.unit = COMMON.has(s.kind) || /^ELECTRIC/i.test(s.names[0]) ? "" : null; });
  spaces.forEach(s => { if (s.unit !== null) return; let best = null, bd = 2 * k; spaces.forEach(o2 => { if (!o2.unit) return; const d = Math.hypot(((s.bounds[0] + s.bounds[2]) - (o2.bounds[0] + o2.bounds[2])) / 2, ((s.bounds[1] + s.bounds[3]) - (o2.bounds[1] + o2.bounds[3])) / 2) - (Math.max(s.bw, s.bh) + Math.max(o2.bw, o2.bh)) * k / 2; if (d < bd) { bd = d; best = o2; } }); s.unit = best ? best.unit : ""; });
  // ---- the floor's outline: the external face of the external walls, balconies outside it
  let overall = null;
  { const balR = new Set(spaces.filter(s => s.kind === "balcony").flatMap(s => s.regs)), M = new Uint8Array(N);
    for (let i = 0; i < N; i++) M[i] = INSIDE[i] && !balR.has(lab[i]) ? 1 : 0;
    // thin necks cut (a 3 px opening): a balcony's parapet strip, left joined to the building by a pixel or two, falls away as a sliver
    const Mo = boxMax(G, boxMin(G, M, 1), 1); for (let i = 0; i < N; i++) M[i] = M[i] && Mo[i] ? 1 : 0;
    const Lp = loops(G, i => M[i], [0, 0, W, H]);
    const outer = [], holes = []; Lp.forEach(lp => { if (lp.apx / R / R / k / k < 2) return; const f = fitRing(dp(lp.pts, 1.2 / R), LN, SNAP); (lp.hole ? holes : outer).push(f.pts); });
    if (outer.length) { overall = {kind: "overall", names: ["FLOOR — OVERALL"], notes: ["to the external face of the external walls; balconies outside it"], how: "traced"}; setGeom(overall, {outer, holes: holes.filter(h => area(h) / k / k > 2), un: 0}); } }
  if (o.debug) res0.debug = o.debug.map(([x, y]) => { const X = G.px(x), Y = G.py(y), r = X >= 0 && Y >= 0 && X < W && Y < H ? lab[Y * W + X] : -1; if (r <= 0) return {r, body: r === 0 ? body[Y * W + X] : null, B: r === 0 ? B[Y * W + X] : null};
    const sp = r2s.get(r), th = thresholds.find(t => t.regs.includes(r)); return {r, sft: sft(r), thin: thin(r), inDuct: inDuct(r), outside: isOutside(r), nbrs: [...nbrs(r)].map(([o2, v]) => [o2, +v.toFixed(2), r2s.get(o2) ? r2s.get(o2).names[0] : null]), group: gOf.get(r), owner: sp ? sp.names : th ? "threshold" : null}; });
  spaces.forEach(s => { delete s.labs; });
  thresholds.forEach(t => { t.between = t.between.map(x => spaces.indexOf(x)); });
  const res = {ver: TRACE_VER, ms: Date.now() - t0, R, spaces: spaces.map(s => { const c = Object.assign({}, s); c.regs = undefined; return c; }), thresholds: thresholds.map(t => Object.assign({}, t, {regs: undefined})),
    ducts: ducts.map(d => ({box: d.box, outer: [[[d.box[0], d.box[1]], [d.box[2], d.box[1]], [d.box[2], d.box[3]], [d.box[0], d.box[3]]]], sft: (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]) / k / k})),
    overall, repairs: repairs.map(s => [s[0], s[1], s[2], s[3]]), splits, log, layers: {outline: [...outlineL].map(nm), hatch: [...hatchL].map(nm)}};
  if (res0.debug) res.debug = res0.debug;
  if (o.crop) { const [a, b, c, d] = o.crop, X0 = G.px(a), Y0 = G.py(b), X1 = G.px(c), Y1 = G.py(d), rows = [];
    for (let y = Y0; y <= Y1; y++) { let r = ""; for (let x = X0; x <= X1; x++) { const i = y * W + x; r += lines[i] ? "#" : body[i] ? "+" : B[i] ? "B" : lab[i] ? String.fromCharCode(97 + lab[i] % 26) : " "; } rows.push(r); } res.crop = rows; }
  if (inp.regionMap) res.map = {lab, W, H, R, x0: bx0, y0: by0, r2s: spaces.map(s => s.regs)};
  return res;
}
const norm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
function isectSeg(p, q, a, b){   // fraction along p->q where it crosses a->b, or null
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den, u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  return t > 1e-9 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
function rebuildGrid(LN){ LN.grid = new Map(); const c = LN.cell; LN.L.forEach((s, i) => { const a0 = Math.floor(Math.min(s[0], s[2]) / c), a1 = Math.floor(Math.max(s[0], s[2]) / c), b0 = Math.floor(Math.min(s[1], s[3]) / c), b1 = Math.floor(Math.max(s[1], s[3]) / c);
  for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const kk = a + "," + b; let A = LN.grid.get(kk); if (!A) LN.grid.set(kk, A = []); A.push(i); } }); }
function label8(G, m){   // 8-connected labels of set pixels
  const {W, H} = G, lab = new Int32Array(G.N), par = [0];
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!m[i]) continue; let l = 0;
    for (const j of [x > 0 ? i - 1 : -1, y > 0 && x > 0 ? i - W - 1 : -1, y > 0 ? i - W : -1, y > 0 && x < W - 1 ? i - W + 1 : -1]) { if (j < 0 || !m[j]) continue; if (!l) l = lab[j]; else uni(l, lab[j]); }
    if (!l) { par.push(par.length); l = par.length - 1; } lab[i] = l; }
  const map = new Int32Array(par.length); let n = 0;
  for (let i = 1; i < par.length; i++) { const r = find(i); if (!map[r]) map[r] = ++n; map[i] = map[r]; }
  for (let i = 0; i < G.N; i++) if (lab[i]) lab[i] = map[lab[i]];
  return {lab, n};
}

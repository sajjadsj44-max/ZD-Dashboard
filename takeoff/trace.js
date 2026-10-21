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
export const TRACE_VER = 2;   // 2: plans of an AutoCAD sheet one by one at 9 pt per ft, solid fills as hatch, open plans split on wall lines, foyers

const NOTE_RX = /Ø|\bT\s*\/\s*B\b|\bRWP\b|\bF\s*\/\s*B\b|\b[SWVB]\.\s*[SDF]\b|VALVE|BREECH|\bRISER\b|\bPIPES?\b|\bGAS\b|\bFHC\b|SPRINKL|HYDRANT|\bC\.?\s*H\s*=|F\.?F\.?L\b|^LEV\b|\bRATIO\b|^TYPE\s*[-–]|\bS\.?\s*FT\b|\bSQ\.?\s*FT\b|FIRE\s+DEPART|WALK\s+THROUGH|ENTRANCE\s+GATE|PLOT\s+LINE|TALL\s+UNIT|^\(?TYPICAL\)?$|OPENING\s+IN\b|^SIZE\s*:|\bSLAB\b|\bCOUNTER\b|\bSINK\b|FRIDGE|\bW\s*\/\s*M\b|VANITY|\bHOB\b|CUPBOARD/i;   // notes in a space, never its name
const NAME_SKIP = /^(UP|DN|DOWN|N|S|E|W|NORTH|SOUTH|FROM\s+ROAD\s+LEVEL|SCALE.*|.*\bPLAN\b.*|SC|SECTION.*|\d+(\.\d+)?|\d+\s*(UP|DN|DOWN)|(UP|DN|DOWN)\s*\d+)$/i;
const WEAK_RX = /^(STAIR|TREAD|RISER|LANDING)\s*=/i;   // a stair's note (STAIR = 4'-6" WIDE, TREAD = 11"): names a space only when nothing else does
const SIZE_RX = /(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"?\s*[xX×]\s*(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"?/;
const WIDE_RX = /(\d+)\s*'\s*-?\s*(\d+)?\s*(?:(\d)\s*\/\s*(\d))?\s*(½)?\s*"\s*WIDE/i;
export function sizeOf(s){   // "12'-6 1/2"x11'-6"" -> [12.5417, 11.5] ft, or null
  const m = SIZE_RX.exec(String(s || "")); if (!m) return null;
  const f = (a, b, n, d, h) => +a + ((+b || 0) + (n && +d ? +n / +d : 0) + (h ? 0.5 : 0)) / 12;
  return [f(m[1], m[2], m[3], m[4], m[5]), f(m[6], m[7], m[8], m[9], m[10])];
}
function wideOf(s){ const m = WIDE_RX.exec(String(s || "")); return m ? +m[1] + ((+m[2] || 0) + (m[3] && +m[4] ? +m[3] / +m[4] : 0) + (m[5] ? 0.5 : 0)) / 12 : null; }
export function kindOf(nm){   // (the written width is not part of the name: "PASSAGE 5'-0\" WIDE" is a flat's passage, "10'-0\" WIDE LOBBY" a lobby)
  const n = String(nm || "").toUpperCase().replace(/\d+\s*'\s*-?\s*\d*(\s*\d\s*\/\s*\d)?\s*(½)?\s*"?\s*WIDE?\b/g, " ").replace(/\s+/g, " ").trim();
  if (/LOOKING\s+BELOW|OPEN\s+TO\s+(SKY|BELOW)|\bCUT\s*-?\s*OUT\b|\bLIGHT\s*WELL\b/.test(n)) return "void";
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
/* which layers bound rooms: walls, columns, windows, duct boxes, and the railings / parapets round a balcony (those bound the
   balcony only: not the building's external walls) — not doors, stairs, furniture, text, hatch */
function layerSets(names){
  const isHatchName = s => /hatch|patt|poch|^wh$|^h$|^hatch1$/i.test(s), isDuct = s => /duct|shaft/i.test(s);
  const outlineL = new Set(), hatchL = new Set(), coreL = new Set(), wallL = new Set();
  names.forEach((L, i) => { const s = L.name || "";
    if (isHatchName(s) || (L.role === "column" && /hatch/i.test(s))) { hatchL.add(i); return; }
    if ((L.role === "railing" || /rail|\brall\b|parapet|balustr/i.test(s)) && !/stair|step/i.test(s)) { outlineL.add(i); return; }   // (RALL: an office's railing layer)
    if (/door|stair|step|furn|fix|text|dim|grid|title|plot|tag|note|mep|elec|plumb|light|louv|point|defpoint|wood|mdf|timber|glass/i.test(s) && !/^walls?$/i.test(s)) return;
    if (L.role === "wall" || L.role === "column" || /window|glaz|\bwin\b|^wn$|wndw/i.test(s) || isDuct(s) || /^walls?$/i.test(s)) { outlineL.add(i); if (!/low|parapet|rail|balcon/i.test(s)) coreL.add(i); if (L.role === "wall") wallL.add(i); } });
  return {outlineL, hatchL, coreL, wallL};
}
/* grid lines drawn on the column layer run right across the plan: a column's side is a few feet long, a grid line tens of feet */
const gridLine = (s, names, k) => names[s[5]] && names[s[5]].role === "column" && Math.hypot(s[2] - s[0], s[3] - s[1]) > 25 * k;

/* any drawing, any plot scale. An AutoCAD drawing's model space holds every plan of the job side by side and is laid out at 1:960 or
   so — a 9" wall would be a pixel thick at the trace's resolution, and its limits (set in points for a plan at 1/8" = 1'-0") would
   mean ten times as much. So each plan (a cluster of wall lines with names in it, apart from the next by open paper) is traced on
   its own, at 9 pt per ft, and its outlines put back on the page. A PDF of one plan at a usual scale is traced as before. */
export function traceFloor(inp, opt){
  const k = inp.k; if (!(k > 0)) return {err: "no scale"};
  const boxes = planBoxes(inp);
  if (boxes.length <= 1 && k >= 4.5 && k <= 18) return traceOne(inp, opt);
  const f = 9 / k, t0 = Date.now(), parts = [];
  const sc = v => v * f;
  for (const b of (boxes.length ? boxes : [null])) {
    const inB = b ? (x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] : () => true;
    const segs = inp.segs.filter(s => inB(s[0], s[1]) || inB(s[2], s[3])).map(s => [sc(s[0]), sc(s[1]), sc(s[2]), sc(s[3]), s[4], s[5], s[6]]);
    const lines = (inp.lines || []).filter(t => inB(t.cx != null ? t.cx : t.x, t.cy != null ? t.cy : t.y)).map(t => Object.assign({}, t, {x: sc(t.x), y: sc(t.y), w: sc(t.w || 0), h: sc(t.h || 0), cx: t.cx != null ? sc(t.cx) : t.cx, cy: t.cy != null ? sc(t.cy) : t.cy}));
    const o2 = Object.assign({}, opt || {}); if (o2.debug) o2.debug = o2.debug.map(([x, y]) => [sc(x), sc(y)]); delete o2.crop;
    const r = traceOne(Object.assign({}, inp, {segs, lines, k: 9, regionMap: false}), o2);
    if (r.err) { if (boxes.length <= 1) return r; continue; }
    parts.push(unscale(r, 1 / f));
  }
  if (!parts.length) return {err: "no wall layers", why: "no plan with wall lines and room names was found on the page"};
  return mergeParts(parts, Date.now() - t0, boxes.length);
}
/* the plans on a page: wall-layer lines gathered into cells 15 ft square; cells touching one another are one plan. A plan needs a
   few names written in it (an elevation or a section drawn on the wall layer has none) */
export function planBoxes(inp){
  const k = inp.k, names = inp.layers || [], {outlineL} = layerSets(names), C = 15 * k, cells = new Map();
  inp.segs.forEach(s => { if ((s[4] & 1) || (s[4] & 8) || (s[4] & 16) || !outlineL.has(s[5]) || gridLine(s, names, k)) return;
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / C));
    for (let j = 0; j <= n; j++) { const x = s[0] + (s[2] - s[0]) * j / n, y = s[1] + (s[3] - s[1]) * j / n, key = Math.floor(x / C) + "," + Math.floor(y / C); if (!cells.has(key)) cells.set(key, null); } });
  if (!cells.size) return [];
  const par = new Map(); cells.forEach((_, key) => par.set(key, key));
  const find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
  cells.forEach((_, key) => { const [cx, cy] = key.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const o = (cx + dx) + "," + (cy + dy); if (par.has(o)) { const a = find(key), b = find(o); if (a !== b) par.set(a, b); } } });
  const box = new Map(); cells.forEach((_, key) => { const r = find(key), [cx, cy] = key.split(",").map(Number); let b = box.get(r); if (!b) box.set(r, b = [Infinity, Infinity, -Infinity, -Infinity, 0]);
    b[0] = Math.min(b[0], cx * C); b[1] = Math.min(b[1], cy * C); b[2] = Math.max(b[2], (cx + 1) * C); b[3] = Math.max(b[3], (cy + 1) * C); b[4]++; });
  const named = b => (inp.lines || []).filter(t => { const x = t.cx != null ? t.cx : t.x, y = t.cy != null ? t.cy : t.y; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && /[A-Z]{3,}/i.test(String(t.s || "")); }).length;
  return [...box.values()].filter(b => b[4] >= 3 && (b[2] - b[0]) >= 12 * k && (b[3] - b[1]) >= 12 * k && named(b) >= 3).map(b => [b[0] - 2 * k, b[1] - 2 * k, b[2] + 2 * k, b[3] + 2 * k]);
}
/* a plan's result, traced at 9 pt per ft, back in the page's points */
function unscale(r, f){
  const P = q => [q[0] * f, q[1] * f], PP = A => A.map(P), geo = o => { if (!o) return o;
    if (o.outer) o.outer = o.outer.map(PP); if (o.holes) o.holes = o.holes.map(PP); if (o.bounds) o.bounds = o.bounds.map(v => v * f);
    if (o.lx != null) { o.lx *= f; o.ly *= f; } if (o.centre) o.centre = PP(o.centre); if (o.unsnE) o.unsnE = o.unsnE.map(e => e.map(P)); if (o.closedBox) o.closedBox = PP(o.closedBox);
    if (o.edges) o.edges.forEach(e => { e.p = P(e.p); e.q = P(e.q); if (e.t != null) e.t *= f; });
    return o; };
  r.spaces.forEach(geo); r.thresholds.forEach(geo); geo(r.overall);
  r.ducts.forEach(d => { d.box = d.box.map(v => v * f); d.outer = d.outer.map(PP); });
  r.repairs = r.repairs.map(x => x.map(v => v * f)); r.splits.forEach(x => { x.line = PP(x.line); });
  if (r.debug) r.debug.forEach(d => { d.scaled = f; });
  return r;
}
export function traceMerge(parts){ return mergeParts(parts, parts.reduce((a, r) => a + (r.ms || 0), 0), parts.length); }   // plans traced one by one (each kept as it was traced)
function mergeParts(parts, ms, nPlans){
  const out = {ver: TRACE_VER, ms, R: parts[0].R, plans: nPlans, prof: parts.map(r => r.prof), spaces: [], thresholds: [], ducts: [], overall: null, repairs: [], splits: [], log: [], layers: parts[0].layers};
  parts.forEach((r, n) => { const off = out.spaces.length;
    out.spaces.push(...r.spaces); out.thresholds.push(...r.thresholds.map(t => Object.assign({}, t, {between: t.between.map(i => i < 0 ? i : i + off)})));
    out.ducts.push(...r.ducts); out.repairs.push(...r.repairs); out.splits.push(...r.splits); out.log.push(...r.log.map(x => (nPlans > 1 ? "plan " + (n + 1) + ": " : "") + x));
    if (r.overall) { if (!out.overall) out.overall = Object.assign({}, r.overall, {outer: [], holes: [], notes: r.overall.notes}); out.overall.outer.push(...r.overall.outer); out.overall.holes.push(...r.overall.holes); }
    if (r.debug) out.debug = (out.debug || []).concat(r.debug); });
  if (out.overall) { const xs = out.overall.outer.flatMap(p => p.map(q => q[0])), ys = out.overall.outer.flatMap(p => p.map(q => q[1])); out.overall.bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  return out;
}
function traceOne(inp, opt){
  const prof = [], mark = n => prof.push([n, Date.now() - t0]);
  const res0 = {}, t0 = Date.now(), k = inp.k, o = Object.assign({gap: 8.6, ext: 4.6, maxPx: 26e6}, opt || {}), log = [], ft = v => v * k;
  if (!(k > 0)) return {err: "no scale"};
  const names = inp.layers || [], role = i => names[i] ? names[i].role : "", nm = i => names[i] ? names[i].name : "";
  const isDuct = s => /duct|shaft/i.test(s), {outlineL, hatchL, coreL, wallL} = layerSets(names);
  // content-based hatch: a layer of short parallel diagonal strokes is a hatch, whatever its name (not text: its strokes run every way)
  const st = new Map();
  inp.segs.forEach(s => { const li = s[5]; if (li == null || li < 0 || (s[4] & 1)) return; const l = Math.hypot(s[2] - s[0], s[3] - s[1]); let r = st.get(li); if (!r) st.set(li, r = {n: 0, sd: 0, ang: new Map()});
    r.n++; const a = ((Math.atan2(s[3] - s[1], s[2] - s[0]) * 180 / Math.PI) % 180 + 180) % 180, a9 = a % 90; if (l < 12 && a9 > 20 && a9 < 70) { r.sd++; const b = Math.round(a / 4); r.ang.set(b, (r.ang.get(b) || 0) + 1); } });
  st.forEach((r, li) => { const top = Math.max(0, ...r.ang.values()); if (r.n > 40 && r.sd / r.n > 0.6 && top / Math.max(1, r.sd) > 0.4 && !outlineL.has(li) && !["text", "tag"].includes(role(li))) hatchL.add(li); });
  if (!outlineL.size) return {err: "no wall layers", why: "the PDF has no wall / column / window layers to read walls from"};
  const isOut = s => !(s[4] & 1) && !(s[4] & 8) && !(s[4] & 16) && outlineL.has(s[5]), isHat = s => hatchL.has(s[5]);   // (16: a CAD hatch's pattern line — hatch, never a wall line)
  let OUT = inp.segs.filter(isOut), HAT = inp.segs.filter(isHat);
  { const n0 = OUT.length; OUT = OUT.filter(s => !gridLine(s, names, k)); if (OUT.length < n0) log.push((n0 - OUT.length) + " grid line" + (n0 - OUT.length > 1 ? "s" : "") + " on the column layer left out (longer than 25 ft)"); }
  { // a railing with stair treads on both sides of it is the rail between two flights (the stair is one space, ended by its landing):
    // not a boundary. A balcony's railing, or the one round a stairwell, has treads on one side at most
    const ST = inp.segs.filter(s => /stair|step|tread/i.test(nm(s[5])) && !(s[4] & 17)), SL = new Lines(ST.map(s => s.slice(0, 4)));
    const treadNear = p => SL.near(p[0] - ft(0.75), p[1] - ft(0.75), p[0] + ft(0.75), p[1] + ft(0.75)).some(t => segDist(p, [t[0], t[1]], [t[2], t[3]]) < ft(0.75));   // (a tread line within 9")
    const isRail = i => names[i] && (names[i].role === "railing" || /rail|\brall\b|balustr/i.test(names[i].name || ""));
    if (ST.length) { const n0 = OUT.length;
      OUT = OUT.filter(s => { if (!isRail(s[5])) return true; const L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < ft(1)) return true; const n = [-(s[3] - s[1]) / L, (s[2] - s[0]) / L];
        let both = 0, tries = 0; for (const f of [0.25, 0.5, 0.75]) { const m = [s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f]; tries++;
          if (treadNear([m[0] + n[0] * ft(1.5), m[1] + n[1] * ft(1.5)]) && treadNear([m[0] - n[0] * ft(1.5), m[1] - n[1] * ft(1.5)])) both++; }
        return both < 2; });
      if (OUT.length < n0) log.push((n0 - OUT.length) + " railing line" + (n0 - OUT.length > 1 ? "s" : "") + " between two stair flights left out (the stair is one space)"); } }
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
  { // solid fills (a wall's or a column's poché, AutoCAD's SOLID hatch): the inside painted as hatch, not only its outline — a column
    // filled solid is then wall, never a pocket of the room beside it. A fill's outline is one subpath (s[6]); fills on text,
    // dimension, furniture or door layers (arrow heads, symbols, a text's mask) are left alone
    const FP = new Map(); inp.segs.forEach(s => { if (!(s[4] & 4) || s[6] == null || outlineL.has(s[5])) return;
      const n0 = nm(s[5]), r0 = role(s[5]); if (/text|tag|dim|anno|note|title|furn|fix|door|stair|plant|tree|land/i.test(n0) || ["text", "tag", "fixture"].includes(r0)) return;
      let P0 = FP.get(s[6]); if (!P0) FP.set(s[6], P0 = []); if (!P0.length) P0.push([s[0], s[1]]); P0.push([s[2], s[3]]); });
    let nf = 0; FP.forEach(P0 => { if (P0.length < 4) return; const a = area(P0) / k / k; if (a < 0.05 || a > 400) return; fillPoly(G, hatchM, P0); nf++; });
    if (nf) log.push(nf + " solid fill" + (nf > 1 ? "s" : "") + " (wall / column poché) read as hatch"); }
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
  // doors set across a corner (a bath's chamfered door): no wall line runs across the opening, only the leaf and its swing on the
  // door layer — the opening is closed where the leaf shuts, from the hinge (the swing's centre) to the swing's far end. A door in
  // line with its wall is left to the face bridges below.
  const doorFix = [], swings = [];
  { const isDoor = i => /door/i.test(nm(i)) && !/window/i.test(nm(i)), DL = inp.segs.filter(s => isDoor(s[5]) && !(s[4] & 24)), len = s => Math.hypot(s[2] - s[0], s[3] - s[1]);
    const cvs = DL.filter(s => (s[4] & 1) && len(s) <= 6 && len(s) > 0.05);   // (the swing's curve pieces alone, when the drawing marks curves: a door's frame lines spoil the circle)
    const sh = cvs.length >= 12 ? cvs : DL.filter(s => len(s) <= 6 && len(s) > 0.05), lg = DL.filter(s => len(s) > 6), n = sh.length, par = Array.from({length: n}, (_, i) => i);
    const fd = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const cell = 6, gi = new Map(), key = (x, y) => Math.floor(x / cell) + "," + Math.floor(y / cell);
    sh.forEach((s, i) => [[s[0], s[1]], [s[2], s[3]]].forEach(([x, y]) => { const kk = key(x, y); let a = gi.get(kk); if (!a) gi.set(kk, a = []); a.push([i, x, y]); }));
    sh.forEach((s, i) => [[s[0], s[1]], [s[2], s[3]]].forEach(([x, y]) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (gi.get((cx + dx) + "," + (cy + dy)) || []).forEach(([j, x2, y2]) => { if (j !== i && Math.hypot(x2 - x, y2 - y) <= 5) par[fd(i)] = fd(j); }); }));
    const grp = new Map(); sh.forEach((s, i) => { const r = fd(i); let a = grp.get(r); if (!a) grp.set(r, a = []); a.push(s); });
    const fit = Q0 => { const mx = Q0.reduce((a, q) => a + q[0], 0) / Q0.length, my = Q0.reduce((a, q) => a + q[1], 0) / Q0.length, P0 = Q0.map(([x, y]) => [x - mx, y - my]);   // (about their middle: page coordinates squared lose the circle)
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const m = P0.length; P0.forEach(([x, y]) => { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; });
      const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, m]], bb = [sxz, syz, sz], det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D0 = det(A); if (Math.abs(D0) < 1e-9) return null; const col = c => A.map((row, i) => row.map((v, j) => j === c ? bb[i] : v)), a = det(col(0)) / D0, b = det(col(1)) / D0, c = det(col(2)) / D0;
      const cx = a / 2, cy = b / 2, r = Math.sqrt(c + cx * cx + cy * cy); return isFinite(r) ? {cx: cx + mx, cy: cy + my, r} : null; };
    grp.forEach(G0 => { if (G0.length < 6) return; let P0 = G0.map(s => [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]), c = fit(P0); if (!c) return;
      P0 = P0.filter(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < 1.5); if (P0.length < 6 || !(c = fit(P0))) return;
      const res = P0.map(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r)); if (Math.max(...res) > 1.2 || c.r < 1.6 * k || c.r > 4.6 * k) return;
      const an = P0.map(([x, y]) => Math.atan2(y - c.cy, x - c.cx)), a0 = an[0], rel = an.map(v => { let d = v - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; });
      const lo = Math.min(...rel), hi = Math.max(...rel), sweep = (hi - lo) * 180 / Math.PI; if (sweep < 50 || sweep > 120) return;
      swings.push({cx: c.cx, cy: c.cy, r: c.r});
      const end = t => [c.cx + c.r * Math.cos(a0 + t), c.cy + c.r * Math.sin(a0 + t)], E1 = end(lo), E2 = end(hi);
      // the leaf: a long door-layer line from near the hinge to one end of the swing — the other end is where it shuts
      const leafTo = E => lg.some(s => { const q = [[s[0], s[1]], [s[2], s[3]]]; return q.some(([x, y], i) => Math.hypot(x - E[0], y - E[1]) < 0.3 * c.r && Math.hypot(q[1 - i][0] - c.cx, q[1 - i][1] - c.cy) < 0.35 * c.r); });
      const l1 = leafTo(E1), l2 = leafTo(E2); if (l1 === l2) return; const C = l1 ? E2 : E1;
      const dx = C[0] - c.cx, dy = C[1] - c.cy, L = Math.hypot(dx, dy), a9 = ((Math.atan2(dy, dx) * 180 / Math.PI) % 90 + 90) % 90; if (a9 < 10 || a9 > 80) return;   // in line with the walls: bridged as any door
      const ux = dx / L, uy = dy / L, e = 3; doorFix.push([c.cx - ux * e, c.cy - uy * e, C[0] + ux * e, C[1] + uy * e, 0, -4]); });
    if (swings.length) log.push(swings.length + " door swing" + (swings.length > 1 ? "s" : "") + " on the door layers");
    if (doorFix.length) { OUT = OUT.concat(doorFix); log.push(doorFix.length + " door" + (doorFix.length > 1 ? "s" : "") + " set across a corner closed where the leaf shuts"); } }
  mark("doors");
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
  // (a drawing plotted without its wall hatch: an enclosed piece up to 15" thick, at least four times as long as it is thick and
  //  with no room name written in it is a wall too — a 9" wall is a strip, a door gap drawn closed is short, a room has its name)
  const named = new Set(); (inp.lines || []).forEach(t => { const s0 = String(t.s || "").trim(); if (!/[A-Z]{3,}/i.test(s0) || /^[A-Z]{0,2}\d+[A-Z]?$/i.test(s0)) return;
    const X = G.px(t.cx != null ? t.cx : t.x + (t.w || 0) / 2), Y = G.py(t.cy != null ? t.cy : t.y - (t.h || 0) / 2); if (X >= 0 && Y >= 0 && X < W && Y < H && pl[Y * W + X]) named.add(pl[Y * W + X]); });
  for (let l = 1; l <= pn; l++) { if (l === outP) continue; const r = inch(radPx[l]), th = 2 * radPx[l] / 3; if ((hasH[l] && r <= 9) || r <= 3.6) wide[l] = 1; else if (hN[l] > 0.3 * pN[l] && r <= 30) wide[l] = 2; else if (!hasH[l] && r <= 7.5 && !named.has(l) && pN[l] >= 4 * th * th) wide[l] = 1; }
  let hc = null;
  for (let i = 0; i < N; i++) { if (lines[i]) { body[i] = 1; continue; } const w = wide[pl[i]]; if (w === 1) body[i] = 1; else if (w === 2) { if (!hc) hc = boxMax(G, boxMin(G, boxMax(G, hatchM, 3), 3), 4); if (hc[i]) body[i] = 1; } }   // (the hatch filled out to the wall's lines: no slivers left along its faces)
  mark("bodies");
  // ---- 2 openings: in-line face runs bridged; wall ends carried to the next wall
  const B = new Uint8Array(N), GMAX = Math.round(pxft(o.gap)), GEXT = Math.round(pxft(o.ext)), TMIN = Math.max(2, Math.round(pxft(2.5 / 12))), TMAX = Math.round(pxft(15 / 12)), RMIN = Math.max(3, Math.round(pxft(0.3))), FMIN = Math.round(pxft(1.2));
  const face = new Uint8Array(N); for (let i = 0; i < N; i++) face[i] = body[i] && !(diag[i] && lines[i]) ? 1 : 0;   // wall pixels a face can run along
  const bridgeRuns = (get, set, A, Bn, isF) => {   // A rows of Bn pixels; get(r, c) = wall, isF(r, c) = a wall pixel a face may run along
    // (the face on the far side of the gap may be up to 2 px out of line — a column a little proud of its wall: the gap is closed on
    //  this face's row and carried across to the other face at the gap's end; both faces 1.2 ft or more — a wall, not a door jamb)
    const RC = [new Map(), new Map()], runsAt = (r, side) => { const M0 = RC[side > 0 ? 1 : 0]; let runs = M0.get(r); if (runs) return runs; runs = []; let s = -1;
      if (r >= 0 && r < A) for (let c = 0; c <= Bn; c++) { const f = c < Bn && isF(r, c) && !(r + side >= 0 && r + side < A && get(r + side, c)) && r + side >= 0 && r + side < A;
        if (f && s < 0) s = c; else if (!f && s >= 0) { runs.push([s, c - 1]); s = -1; } }
      M0.set(r, runs); if (M0.size > 8) M0.delete(M0.keys().next().value); return runs; };
    for (let r = 1; r < A; r++) for (const side of [-1, 1]) {   // wall pixels with free space above (side -1) / below (+1)
      const runs = runsAt(r, side);
      for (let a = 0; a < runs.length; a++) { const c1 = runs[a][1]; if (runs[a][1] - runs[a][0] < RMIN) continue;
        let nx = null; for (const dr of [0, -1, 1, -2, 2]) { const R2 = runsAt(r + dr, side); for (const q of R2) { if (q[0] <= c1 + 1) continue; if (!nx || q[0] < nx.c2) nx = {c2: q[0], len: q[1] - q[0], dr}; break; } }
        if (!nx) continue; const c2 = nx.c2, g = c2 - c1 - 1;
        if (g < 2 || g > GMAX || nx.len < RMIN || (nx.dr && Math.min(nx.len, runs[a][1] - runs[a][0]) < FMIN)) continue;
        let clear = true; for (let c = c1 + 1; c < c2; c++) if (get(r, c)) { clear = false; break; }
        if (!clear) continue;
        for (let c = c1 + 1; c < c2; c++) set(r, c);
        if (nx.dr) for (let d = 0; d !== nx.dr; d += Math.sign(nx.dr)) if (!get(r + d, c2)) set(r + d, c2); } } };
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
  mark("openings");
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
  const touch = (l, depth, blk) => {
    const b = 4 * l, res = new Map(), X0 = Math.max(0, bb[b] - depth), Y0 = Math.max(0, bb[b + 1] - depth), X1 = Math.min(W - 1, bb[b + 2] + depth), Y1 = Math.min(H - 1, bb[b + 3] + depth);
    const w = X1 - X0 + 1, seen = new Uint8Array(w * (Y1 - Y0 + 1)); let fr = [];
    for (let y = bb[b + 1]; y <= bb[b + 3]; y++) for (let x = bb[b]; x <= bb[b + 2]; x++) if (lab[y * W + x] === l) { seen[(y - Y0) * w + x - X0] = 1; fr.push(x, y); }
    for (let dd = 0; dd < depth && fr.length; dd++) { const nf = [];
      for (let q = 0; q < fr.length; q += 2) { const x = fr[q], y = fr[q + 1];
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ax, Y = y + ay; if (X < X0 || Y < Y0 || X > X1 || Y > Y1) continue; const j = (Y - Y0) * w + X - X0; if (seen[j]) continue; seen[j] = 1;
          const i = Y * W + X, o2 = lab[i]; if (blk && blk[i]) continue; if (o2 && o2 !== l) { if (o2 !== out0) res.set(o2, (res.get(o2) || 0) + 1); continue; } nf.push(X, Y); } }   // (through a drawn line or two: a wall is 13 px and more)
      fr = nf; }
    res.forEach((v, kk) => res.set(kk, v / R / k)); return res; };
  const ADJ = new Map(), nbrs = l => { let v = ADJ.get(l); if (!v) { v = touch(l, thin(l) ? 5 : 3); ADJ.set(l, v); } return v; };
  // a balcony's railing: what lies beyond it (a ledge for the pipes, a planter, the gap to the next flat's balcony) is not the balcony
  const railM = new Uint8Array(N); let railN = 0;
  OUT.forEach(s => { const L = names[s[5]]; if (L && (L.role === "railing" || /rail|\brall\b|balustr/i.test(L.name || "")) && !/stair|step/i.test(L.name || "")) { line(G, railM, s[0], s[1], s[2], s[3]); railN++; } });
  const acrossRail = (g, s) => railN > 0 && g.every(r => { const v = touch(r, thin(r) ? 5 : 3, railM); return !s.regs.some(x => v.has(x)); });
  // the inside of the external walls: wall lines (no parapets, railings) and opening lines, holes filled
  const core = new Uint8Array(N); OUT.forEach(s => { if (coreL.has(s[5]) || s[5] === -2 || s[5] === -3) line(G, core, s[0], s[1], s[2], s[3]); });
  for (let i = 0; i < N; i++) if (B[i]) core[i] = 1;
  const outside = fillOutside(G, core), INSIDE = new Uint8Array(N); for (let i = 0; i < N; i++) INSIDE[i] = outside[i] ? 0 : 1;
  const isOutside = l => { const [x, y] = cen(l); const X = G.px(x), Y = G.py(y); return !(X >= 0 && Y >= 0 && X < W && Y < H && INSIDE[Y * W + X]); };
  const inDuct = l => { const [x, y] = cen(l); return ducts.some(d => x >= d.box[0] - 1 && x <= d.box[2] + 1 && y >= d.box[1] - 1 && y <= d.box[3] + 1); };
  // room names and their written sizes: a name line, the lines right under it that carry the name on ("MAID/KIDS" / "ROOM"),
  // and the size line under them — read across the text's own direction (a balcony's name written up the page)
  const TL = (inp.lines || []).filter(t => t.s && String(t.s).trim() && !NOTE_RX.test(String(t.s))).map(t => { const s0 = String(t.s).trim(), rest = s0.replace(SIZE_RX, "").replace(WIDE_RX, "").replace(/\bWIDE\b/i, "");
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
    const nm0 = name.replace(/\s+/g, " ").trim(); labels.push({name: nm0, size: size.trim(), x: t.cx, y: t.cy, h: t.h, weak: WEAK_RX.test(nm0)}); });
  const regAt = (x, y) => { for (const [dx, dy] of [[0, 0], [0, 6], [0, -6], [6, 0], [-6, 0], [0, 12], [0, -12], [12, 0], [-12, 0]]) { const X = G.px(x + dx), Y = G.py(y + dy); if (X >= 0 && Y >= 0 && X < W && Y < H && lab[Y * W + X] && lab[Y * W + X] !== out0) return lab[Y * W + X]; } return 0; };
  const spaces = [], r2s = new Map(), done = new Set([out0]);
  const byReg = new Map(); labels.forEach(l => { const r = regAt(l.x, l.y); if (!r) return; let L = byReg.get(r); if (!L) byReg.set(r, L = []); L.push(l); });
  byReg.forEach((L, r) => { const ns = [], ss = []; if (L.some(l => !l.weak)) L = L.filter(l => !l.weak); L.forEach(l => { if (!ns.includes(l.name)) { ns.push(l.name); ss.push(l.size); } });
    const kinds = ns.map(kindOf), kd = kinds.includes("corridor") ? "corridor" : new Set(kinds).size === 1 ? kinds[0] : "room";
    const s = {regs: [r], names: ns, sizes: ss, kind: kd, lx: L[0].x, ly: L[0].y, labs: L, notes: [], how: "traced"}; spaces.push(s); r2s.set(r, s); done.add(r); });
  const nbS = (regs, thinDepth) => { const out = new Map(); regs.forEach(r => nbrs(r).forEach((v, o2) => { if (regs.includes(o2)) return; const s = r2s.get(o2); if (s) out.set(s, (out.get(s) || 0) + v); })); return [...out.entries()].sort((a, b) => b[1] - a[1]); };
  let ch = true;
  // a flat's entrance foyer: a small piece off the corridor (through its door, or an opening the drawing leaves without one) with doors
  // on into the flat's own rooms — the flat's floor, not the corridor's. A door: a swing hinged on the line between the two
  const doorTo = r => { const out = new Set(); swings.forEach(w => { const X = G.px(w.cx), Y = G.py(w.cy), d = Math.ceil(ft(1.2) * R); let mine = false; const oth = new Set();
    for (let y = Math.max(0, Y - d); y <= Math.min(H - 1, Y + d); y++) for (let x = Math.max(0, X - d); x <= Math.min(W - 1, X + d); x++) { const l = lab[y * W + x]; if (l === r) mine = true; else if (l && l !== out0) oth.add(l); }
    if (mine) oth.forEach(l => out.add(l)); }); return out; };
  const foyerLike = r => { if (sft(r) < 10 || sft(r) > 80) return false; const ds = doorTo(r); return [...ds].some(l => { const so = r2s.get(l); return so && so.kind !== "corridor" && !["lift", "stair", "chute", "void"].includes(so.kind); }); };
  while (ch) { ch = false; for (let r = 1; r <= n; r++) { if (done.has(r) || sft(r) < 0.4 || thin(r) || inDuct(r) || isOutside(r)) continue;   // corridor parts
    const nb = nbS([r]); if (nb.length && nb[0][0].kind === "corridor" && nb[0][1] >= 2 && !foyerLike(r)) { nb[0][0].regs.push(r); r2s.set(r, nb[0][0]); done.add(r); ch = true; } } }
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
    const walk = isOutside(r) ? all.filter(([o2]) => o2.kind !== "balcony" && o2.names.some(x => /PASSAGE|CORRIDOR|WALKWAY|GALLERY|WALK/i.test(x))) : [];
    if (walk.length && all.every(([o2]) => o2 === walk[0][0] || o2.kind === "balcony") && new Set(walk.map(e => e[0])).size === 1) { const s = walk[0][0]; s.regs.push(r); r2s.set(r, s); done.add(r); s.notes.push("an open walk of " + sft(r).toFixed(1) + " Sft outside the walls, off this passage only, joined"); return; }
    if ((kinds.size === 1 && kinds.has("balcony")) || (isOutside(r) && kinds.has("balcony"))) { const tb = all.filter(e => e[0].kind === "balcony").sort((a, b) => b[1] - a[1])[0][0];
      if (all.filter(e => e[0].kind === "balcony").every(e => acrossRail([r], e[0])) && (isOutside(r) || kinds.size === 1)) { log.push("a piece of " + sft(r).toFixed(1) + " Sft beyond the railing of " + tb.names[0] + " left out (a ledge / planter outside the rail)"); done.add(r); return; }
      tb.regs.push(r); r2s.set(r, tb); done.add(r); tb.notes.push("balcony piece of " + sft(r).toFixed(1) + " Sft across a parapet / railing break joined"); return; }
    if (isOutside(r)) { log.push("a piece of " + sft(r).toFixed(1) + " Sft outside the external walls, touching no balcony, left out"); done.add(r); return; }
    if (!direct.length && !via.size) { if (sft(r) >= 0.8) { const s = {regs: [r], names: ["VOID / SHAFT"], sizes: [""], kind: "void", notes: ["closed by walls on all sides, no name on the drawing: pipe shaft / void"], how: "traced", unlabelled: true}; spaces.push(s); r2s.set(r, s); done.add(r); } return; }
    if (direct.length === 1 && !via.size) { const s = direct[0][0]; s.regs.push(r); r2s.set(r, s); done.add(r); s.notes.push("niche of " + sft(r).toFixed(1) + " Sft (open to this room only) joined"); return; }
    if (sft(r) < 1) return;
    const fy = all.some(([o2]) => o2.kind === "corridor") && foyerLike(r);   // off the common corridor (directly, or through its doorway's threshold), doors on into the flat: its entrance foyer
    const s = {regs: [r], names: [fy ? "FOYER" : "PASSAGE"], sizes: [""], kind: "room", notes: [fy ? "no name on the drawing: the flat's entrance foyer, behind its door off the corridor" : "no name on the drawing: passage between rooms"], how: "traced", unlabelled: true}; spaces.push(s); r2s.set(r, s); done.add(r); });
  const thresholds = [];
  groups.forEach(g => { if (g.some(r => done.has(r))) return; const nb = nbS(g);
    if (nb.length >= 2) { thresholds.push({regs: g, kind: "threshold", notes: g.length > 1 ? [g.length + " slivers of one doorway joined"] : [], how: "traced", between: [nb[0][0], nb[1][0]]}); g.forEach(r => done.add(r)); }
    else if (nb.length === 1 && nb[0][0].kind === "balcony" && acrossRail(g, nb[0][0])) { log.push("a strip of " + g.reduce((a, r) => a + sft(r), 0).toFixed(1) + " Sft beyond the railing of " + nb[0][0].names[0] + " left out (a ledge outside the rail)"); g.forEach(r => done.add(r)); }
    else if (nb.length === 1) { const s = nb[0][0]; g.forEach(r => { s.regs.push(r); r2s.set(r, s); done.add(r); }); s.notes.push("recess of " + g.reduce((a, r) => a + sft(r), 0).toFixed(1) + " Sft joined"); }
    else { const a2 = g.reduce((a, r) => a + sft(r), 0); if (a2 >= 0.8 && !g.some(isOutside)) { const s = {regs: g, names: ["VOID / SHAFT"], sizes: [""], kind: "void", notes: ["closed by walls on all sides, no name on the drawing: pipe shaft / void"], how: "traced", unlabelled: true}; spaces.push(s); g.forEach(r => r2s.set(r, s)); } g.forEach(r => done.add(r)); } });
  mark("spaces");
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
  mark("outlines");
  // ---- an open plan named as several rooms (a lounge open to its passage and drawing room, the zones of a lobby): split on wall
  // lines — a wall face carried on from an inside corner to the facing wall (or to a pier standing in the space), or a dashed beam
  // line across the opening — the fewest and shortest that part the names, as a QS closes an open plan by hand. Kitchen + lounge +
  // dining (one floor) stay one space, and a bed room with a dress that has no written size of its own; a shaft's or a lift's name written in a lobby is a
  // note, not a zone of it
  { const KEEP1 = /KITCHEN|LOUNGE|DINING|LIVING|PANTRY|\bTV\b|FAMILY/i, beamL = new Set(); names.forEach((L, i) => { if (/dash|beam|hidden|lintel|soffit/i.test(L.name || "")) beamL.add(i); });
    const BEAM = inp.segs.filter(s => beamL.has(s[5]) && !(s[4] & 17) && Math.hypot(s[2] - s[0], s[3] - s[1]) >= ft(1.5));
    const RISER = (() => { const S0 = inp.segs.filter(s => /stair|step|tread/i.test(nm(s[5])) && !(s[4] & 17)), rows = new Map(), out = [];   // a stair open to the room beside it ends on its last riser
      S0.forEach(s => { const h = Math.abs(s[1] - s[3]) < 0.05, v = Math.abs(s[0] - s[2]) < 0.05; if (!h && !v) { if (Math.hypot(s[2] - s[0], s[3] - s[1]) >= ft(2)) out.push(s); return; }
        const key = (h ? "H" : "V") + Math.round((h ? s[1] : s[0]) * 4); let r = rows.get(key); if (!r) rows.set(key, r = {h, c: h ? s[1] : s[0], iv: []}); r.iv.push(h ? [Math.min(s[0], s[2]), Math.max(s[0], s[2])] : [Math.min(s[1], s[3]), Math.max(s[1], s[3])]); });
      rows.forEach(r => { r.iv.sort((a, b) => a[0] - b[0]); const m = []; r.iv.forEach(([a, b]) => { if (m.length && a <= m[m.length - 1][1] + ft(0.3)) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); });   // (one flight's tread and the next one's, end to end)
        m.forEach(([a, b]) => { if (b - a >= ft(2)) out.push(r.h ? [a, r.c, b, r.c, 0, -5] : [r.c, a, r.c, b, 0, -5]); }); });
      return out; })();
    const RAILS = OUT.filter(s => { const L = names[s[5]]; return L && (L.role === "railing" || /rail|\brall\b|balustr/i.test(L.name || "")) && !/stair|step/i.test(L.name || "") && Math.hypot(s[2] - s[0], s[3] - s[1]) >= ft(2); });
    // a stair drawn with no name on it (DN / UP only): its flights — five treads or more, parallel, as long as one another, 7" to 16"
    // apart — one seed for the stair at its first flight's middle
    const treadSeeds = s => { const P0 = s.outer[0], len = t => Math.hypot(t[2] - t[0], t[3] - t[1]), mid = t => [(t[0] + t[2]) / 2, (t[1] + t[3]) / 2];
      const T0 = RISER.filter(t => len(t) <= ft(8) && inPoly(mid(t), P0)); if (T0.length < 5) return [];
      const ang = t => ((Math.atan2(t[3] - t[1], t[2] - t[0]) % Math.PI) + Math.PI) % Math.PI, used = new Set(), fl = [];
      T0.forEach((t, i) => { if (used.has(i)) return; const L = len(t), a = ang(t), u = [(t[2] - t[0]) / L, (t[3] - t[1]) / L], n0 = [-u[1], u[0]], m0 = mid(t), F = [];
        T0.forEach((q, j) => { let d = Math.abs(ang(q) - a); d = Math.min(d, Math.PI - d); if (d > 0.05 || Math.abs(len(q) - L) > 0.35 * L) return; const mq = mid(q);
          if (Math.abs((mq[0] - m0[0]) * u[0] + (mq[1] - m0[1]) * u[1]) > 0.3 * L) return; F.push({j, off: (mq[0] - m0[0]) * n0[0] + (mq[1] - m0[1]) * n0[1]}); });
        F.sort((p, q) => p.off - q.off); let best = [], cur = [];
        F.forEach(f => { if (!cur.length) { cur.push(f); return; } const g = f.off - cur[cur.length - 1].off; if (g < ft(7 / 12)) return; if (g <= ft(16 / 12)) cur.push(f); else { if (cur.length > best.length) best = cur; cur = [f]; } });
        if (cur.length > best.length) best = cur;
        if (best.length >= 5) { best.forEach(f => used.add(f.j)); const ms = best.map(f => mid(T0[f.j])); fl.push([ms.reduce((a2, p) => a2 + p[0], 0) / ms.length, ms.reduce((a2, p) => a2 + p[1], 0) / ms.length]); } });
      const out = []; fl.forEach(p => { if (!out.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < ft(14))) out.push({name: "STAIR", size: "", lab: null, x: p[0], y: p[1], treads: true}); });
      return out; };
    const together = sd => { const ns = sd.map(q => q.name), dr = sd.find(q => /DRESS|WARD|W\.?I\.?C/i.test(q.name));
      return ns.every(x => KEEP1.test(x)) || (ns.length === 2 && ns.some(x => /BED/i.test(x)) && dr && !sizeOf(dr.size || ""))   // (a dress with its own written size is a room of its own)
        || (ns.length === 2 && ns.some(x => /RECEPTION/i.test(x)) && ns.some(x => /LOBBY|ENTRANCE|FOYER/i.test(x))); };   // (the reception desk is in the entrance lobby)
    const seedsOf = s => { const out = [], kd0 = (s.labs || []).map(l => kindOf(l.name)), st = kd0.length && !kd0.includes("stair") ? treadSeeds(s) : [], kd1 = kd0.concat(st.map(() => "stair"));
      const mixed = kd1.some(x => ["stair", "lift"].includes(x)) && kd1.some(x => ["room", "corridor", "bath"].includes(x));
      (s.labs || []).forEach((l, li) => { if (["void", "chute"].includes(kd0[li]) || (["lift", "stair"].includes(kd0[li]) && !mixed)) return;
      if (!out.some(o2 => o2.name === l.name && Math.hypot(o2.x - l.x, o2.y - l.y) < ft(6))) out.push({name: l.name, size: l.size, lab: l, x: l.x, y: l.y}); });
      if (mixed && out.length) st.forEach(q => out.push(q)); return out; };
    const near0 = (P, p) => { let b = Infinity; P.forEach((a, i) => { b = Math.min(b, segDist(p, a, P[(i + 1) % P.length])); }); return b; };
    const rayHit = (o, u, a, b) => { const v0 = [b[0] - a[0], b[1] - a[1]], den = u[0] * v0[1] - u[1] * v0[0]; if (Math.abs(den) < 1e-9) return null;
      const t = ((a[0] - o[0]) * v0[1] - (a[1] - o[1]) * v0[0]) / den, v = ((a[0] - o[0]) * u[1] - (a[1] - o[1]) * u[0]) / den; return v >= -1e-6 && v <= 1 + 1e-6 && t > 0.3 ? t : null; };
    const wt = c => (c.beam ? 0.6 : 1) * (c.jamb ? 1.3 : 1);   // a drawn beam / railing line favoured; a jamb's line not
    const chords = (rings, sd) => { const out = [], P0 = rings[0], Hs = rings.slice(1), inside = p => inPoly(p, P0) && !Hs.some(h => inPoly(p, h)) && rings.every(R0 => near0(R0, p) >= 0.5);
      const hitB = (o, u) => { let best = null; rings.forEach(R0 => R0.forEach((a, i) => { const t = rayHit(o, u, a, R0[(i + 1) % R0.length]); if (t != null && (best == null || t < best)) best = t; })); return best; };
      rings.forEach(R0 => R0.forEach((v, i) => { for (const nb of [R0[(i + R0.length - 1) % R0.length], R0[(i + 1) % R0.length]]) {   // from an inside corner, on along its wall face
        const dx = v[0] - nb[0], dy = v[1] - nb[1], L = Math.hypot(dx, dy); if (L < 1) continue; const u = [dx / L, dy / L];
        if (!inside([v[0] + u[0] * 2, v[1] + u[1] * 2])) continue;
        const t = hitB(v, u); if (t == null || t > ft(20)) continue; out.push({a: v, b: [v[0] + u[0] * t, v[1] + u[1] * t], len: t, beam: false, jamb: L < ft(0.9)}); } }));
      const dirs = P0.map((p, i) => { const q = P0[(i + 1) % P0.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; });
      BEAM.forEach(s => { const m = [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]; if (!inside(m)) return;   // a beam line across the opening, running with the walls (an X marking a void above is not one)
        const L = Math.hypot(s[2] - s[0], s[3] - s[1]), u = [(s[2] - s[0]) / L, (s[3] - s[1]) / L]; if (!dirs.some(d => Math.abs(d[0] * u[1] - d[1] * u[0]) < 0.035)) return;
        const t1 = hitB(m, u), t2 = hitB(m, [-u[0], -u[1]]); if (t1 == null || t2 == null || t1 + t2 > L + ft(3)) return;
        out.push({a: [m[0] - u[0] * t2, m[1] - u[1] * t2], b: [m[0] + u[0] * t1, m[1] + u[1] * t1], len: t1 + t2, beam: true}); });
      RAILS.forEach(s => { const L = Math.hypot(s[2] - s[0], s[3] - s[1]), u = [(s[2] - s[0]) / L, (s[3] - s[1]) / L];   // a railing standing in the space (a stair's, a void's): on to the walls
        if (!dirs.some(d => Math.abs(d[0] * u[1] - d[1] * u[0]) < 0.035)) return;
        const A = [s[0], s[1]], Bp = [s[2], s[3]], m = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2]; if (!inPoly(m, P0) || Hs.some(h => inPoly(m, h))) return;
        const ext = (p, v) => inside([p[0] + v[0] * 1.5, p[1] + v[1] * 1.5]) ? hitB(p, v) : 0, tB = ext(Bp, u), tA = ext(A, [-u[0], -u[1]]);
        if (tA == null || tB == null || tA + tB < 1 || tA + tB > ft(6)) return;
        out.push({a: [A[0] - u[0] * tA, A[1] - u[1] * tA], b: [Bp[0] + u[0] * tB, Bp[1] + u[1] * tB], len: L + tA + tB, beam: true, rail: true}); });
      if (sd && sd.some(q => kindOf(q.name) === "stair") && sd.some(q => kindOf(q.name) !== "stair")) {   // the stair's line nearest the room's name
        const room = sd.filter(q => kindOf(q.name) !== "stair");
        RISER.forEach(s => { const m = [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]; if (!inside(m)) return;
          const L = Math.hypot(s[2] - s[0], s[3] - s[1]), u = [(s[2] - s[0]) / L, (s[3] - s[1]) / L], t1 = hitB(m, u), t2 = hitB(m, [-u[0], -u[1]]); if (t1 == null || t2 == null || t1 + t2 > L + ft(2)) return;
          const dR = Math.min(...room.map(q => Math.hypot(q.x - m[0], q.y - m[1])));
          out.push({a: [m[0] - u[0] * t2, m[1] - u[1] * t2], b: [m[0] + u[0] * t1, m[1] + u[1] * t1], len: (t1 + t2) * 0.5 + dR * 0.05, beam: false, riser: true}); }); }
      const uniq = []; out.sort((p, q) => wt(p) * p.len - wt(q) * q.len).forEach(c => { if (!uniq.some(o2 => Math.hypot(o2.a[0] - c.a[0], o2.a[1] - c.a[1]) + Math.hypot(o2.b[0] - c.b[0], o2.b[1] - c.b[1]) < 2 || Math.hypot(o2.a[0] - c.b[0], o2.a[1] - c.b[1]) + Math.hypot(o2.b[0] - c.a[0], o2.b[1] - c.a[1]) < 2)) uniq.push(c); });
      return uniq.slice(0, 60); };
    const cutLine = (g, m, c) => {   // a cut drawn 2 px thick and run 2 pt on into the walls at both ends: no gap where it meets a jamb's corner
      const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) || 1, u = [(c.b[0] - c.a[0]) / L, (c.b[1] - c.a[1]) / L], e = 2, o = 0.5 / g.R;
      for (const d of [-o, o]) line(g, m, c.a[0] - u[0] * e - u[1] * d, c.a[1] - u[1] * e + u[0] * d, c.b[0] + u[0] * e - u[1] * d, c.b[1] + u[1] * e + u[0] * d); };
    const splitPx = (s, sd) => {   // -> [{outer, holes, un, sd}] or null
      let X0 = W, Y0 = H, X1 = 0, Y1 = 0; s.regs.forEach(r => { const q = 4 * r; X0 = Math.min(X0, bb[q]); Y0 = Math.min(Y0, bb[q + 1]); X1 = Math.max(X1, bb[q + 2]); Y1 = Math.max(Y1, bb[q + 3]); });
      X0 = Math.max(0, X0 - 2); Y0 = Math.max(0, Y0 - 2); X1 = Math.min(W - 1, X1 + 2); Y1 = Math.min(H - 1, Y1 + 2);
      const w = X1 - X0 + 1, h = Y1 - Y0 + 1, set = new Set(s.regs), M = new Uint8Array(w * h);
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (set.has(lab[y * W + x])) M[(y - Y0) * w + x - X0] = 1;
      if (s.regs.length > 1) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!M[i] && ((M[i - 1] && (M[i + 1] || M[i + 2])) || (M[i - w] && (M[i + w] || M[i + 2 * w])))) M[i] = 2; }   // (the 1–2 px line between two of its regions)
      const GL = {x0: bx0 + X0 / R, y0: by0 + Y0 / R, R, W: w, H: h};
      const seedPx = sd.map(q => { const cx = Math.floor((q.x - GL.x0) * R), cy = Math.floor((q.y - GL.y0) * R); for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h && M[y * w + x]) return y * w + x; } return -1; });
      if (seedPx.some(v => v < 0)) return null;
      const cand = chords([s.outer[0]].concat(s.holes), sd);
      // the search runs on the space at half resolution (the cut's pixels at full resolution only once, at the end)
      const MF = new Map(), maskAt = f => { let v = MF.get(f); if (v) return v; const ww = Math.ceil(w / f), hh = Math.ceil(h / f), Mf = new Uint8Array(ww * hh);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M[y * w + x]) Mf[Math.floor(y / f) * ww + Math.floor(x / f)] = 1; MF.set(f, v = Mf); return v; };
      const comps = (cuts, f) => { const ww = Math.ceil(w / f), hh = Math.ceil(h / f), Mf = maskAt(f), C = new Uint8Array(ww * hh);
        const GF = {x0: GL.x0, y0: GL.y0, R: R / f, W: ww, H: hh}; cuts.forEach(c => cutLine(GF, C, c));
        const id = new Int32Array(ww * hh), st = new Int32Array(ww * hh); let n0 = 0;
        for (let i0 = 0; i0 < ww * hh; i0++) { if (!Mf[i0] || C[i0] || id[i0]) continue; n0++; let top = 0; id[i0] = n0; st[top++] = i0;
          while (top) { const i = st[--top], x = i % ww;
            if (x > 0 && Mf[i - 1] && !C[i - 1] && !id[i - 1]) { id[i - 1] = n0; st[top++] = i - 1; }
            if (x < ww - 1 && Mf[i + 1] && !C[i + 1] && !id[i + 1]) { id[i + 1] = n0; st[top++] = i + 1; }
            if (i >= ww && Mf[i - ww] && !C[i - ww] && !id[i - ww]) { id[i - ww] = n0; st[top++] = i - ww; }
            if (i + ww < ww * hh && Mf[i + ww] && !C[i + ww] && !id[i + ww]) { id[i + ww] = n0; st[top++] = i + ww; } } }
        const at = i => { const x = Math.floor((i % w) / f), y = Math.floor(Math.floor(i / w) / f), j = y * ww + x; if (id[j]) return id[j];
          for (const q of [j - 1, j + 1, j - ww, j + ww, j - ww - 1, j - ww + 1, j + ww - 1, j + ww + 1]) if (q >= 0 && q < ww * hh && id[q]) return id[q]; return 0; };
        const sid = seedPx.map(at), cnt = new Map(); for (let i = 0; i < ww * hh; i++) if (id[i]) cnt.set(id[i], (cnt.get(id[i]) || 0) + 1);
        let sep = 0; for (let i = 0; i < sid.length; i++) for (let j = i + 1; j < sid.length; j++) if (sid[i] !== sid[j]) sep++;
        const small = sid.some(v => !v || (cnt.get(v) || 0) * f * f / R / R / k / k < 6);   // a name left in a sliver: not the cut
        let err = 0; sid.forEach((v, i) => { if (sid.filter(x => x === v).length !== 1) return; const z = sizeOf(sd[i].size); if (!z) return; const a = (cnt.get(v) || 0) * f * f / R / R / k / k, w0 = z[0] * z[1]; err += Math.min(2, Math.abs(a - w0) / w0); });   // (its written size: the piece a QS would cut)
        const pxOf = p => { const x = Math.floor((p[0] - GL.x0) * R / f), y = Math.floor((p[1] - GL.y0) * R / f); return x >= 0 && y >= 0 && x < ww && y < hh ? id[y * ww + x] : 0; };
        return {id, sid, sep, small, err, n: n0, ww, f, pxOf}; };
      const want = sd.length * (sd.length - 1) / 2, cuts = []; let cur = comps(cuts, 2);
      const live = (c, t) => { const m = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2], v = t.pxOf(m) || t.pxOf([m[0] + 1, m[1] + 1]) || t.pxOf([m[0] - 1, m[1] - 1]);   // a chord inside a piece that still holds two names
        return v && t.sid.filter(x => x === v).length >= 2; };
      for (let guard = 0; guard < 10 && cur.sep < want; guard++) { let best = null;
        const pool = cand.filter(c => !cuts.includes(c) && live(c, cur));
        for (const c of pool) { const t = comps(cuts.concat([c]), 2); if (t.small || t.sep <= cur.sep) continue;
          const sc = Math.round(t.err * 10) * 1e5 + wt(c) * c.len / (t.sep - cur.sep) + t.err * ft(8); if (!best || sc < best.sc) best = {cs: [c], t, sc}; }   // (a room nearest its written size first, to the 10 %; then the shortest line — of two as long, the one nearer the sizes)
        if (!best || best.t.err > 0.1) {   // two lines at once (a drawing room open to the lounge on one side and to the passage through its door), when one line leaves a room far off its written size
          const P2 = pool.slice(0, 10);
          for (let i = 0; i < P2.length; i++) for (let j = i + 1; j < P2.length; j++) { const t = comps(cuts.concat([P2[i], P2[j]]), 2); if (t.small || t.sep <= cur.sep) continue;
            const sc = Math.round(t.err * 10) * 1e5 + (wt(P2[i]) * P2[i].len + wt(P2[j]) * P2[j].len) / (t.sep - cur.sep) + t.err * ft(8); if (!best || sc < best.sc) best = {cs: [P2[i], P2[j]], t, sc}; } }
        if (!best) break; cuts.push(...best.cs); cur = best.t; }
      if (!cuts.length) return null;
      cur = comps(cuts, 1); if (cur.small) return null;
      // the pieces: one per name group; a piece with no name (between two cut lines) goes with the named piece it touches most; the cut
      // lines' own pixels with the piece beside them
      const {id, sid} = cur, own = new Map(); sid.forEach((v, i) => { if (!own.has(v)) own.set(v, []); own.get(v).push(i); });
      const toP = new Map(); own.forEach((_, v) => toP.set(v, v));
      for (let pass = 0; pass < 3; pass++) for (let i = 0; i < w * h; i++) { if (!M[i] || toP.has(id[i])) continue; if (!id[i]) continue;
        const tally = new Map(); for (const j of [i - 2, i + 2, i - 2 * w, i + 2 * w]) if (j >= 0 && j < w * h && toP.has(id[j])) tally.set(toP.get(id[j]), (tally.get(toP.get(id[j])) || 0) + 1);
        if (tally.size) toP.set(id[i], [...tally.entries()].sort((p, q) => q[1] - p[1])[0][0]); }
      const pm = new Int32Array(w * h); for (let i = 0; i < w * h; i++) if (M[i] && id[i] && toP.has(id[i])) pm[i] = toP.get(id[i]);
      for (let pass = 0; pass < 4; pass++) for (let i = 0; i < w * h; i++) if (M[i] && !pm[i]) { for (const j of [i - w, i - 1, i + 1, i + w]) if (j >= 0 && j < w * h && pm[j]) { pm[i] = pm[j]; break; } }
      cuts.forEach(c => { const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]); LN.L.push(Object.assign([c.a[0], c.a[1], c.b[0], c.b[1]], {u: [(c.b[0] - c.a[0]) / L, (c.b[1] - c.a[1]) / L], l: L, th: ((Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) % Math.PI) + Math.PI) % Math.PI})); }); rebuildGrid(LN);
      const out = []; own.forEach((seeds, v) => { const Lp = loops(G, i => { const x = i % W, y = (i - x) / W; return x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && pm[(y - Y0) * w + x - X0] === v; }, [X0, Y0, X1 + 1, Y1 + 1]);
        const outer = [], holes = []; let un = 0; Lp.forEach(lp => { if (lp.apx < 6) return; const f = fitRing(dp(lp.pts, 1.2 / R), LN, SNAP); un += f.un; if (f.pts.length >= 3) (lp.hole ? holes : outer).push(f.pts); });
        if (outer.length) out.push({outer, holes, un, sd: seeds.map(i => sd[i])}); });
      return out.length > 1 ? {pieces: out, cuts} : null; };
    spaces.slice().forEach(s => { if (s.outer.length !== 1 || s.kind === "balcony") return; const sd = seedsOf(s); if (sd.length < 2 || together(sd)) return;
      if (new Set(sd.map(q => q.name)).size === 1 && sd.every(q => ["stair", "lift"].includes(kindOf(q.name)))) return;
      const r = splitPx(s, sd); if (!r) { log.push("open plan kept as one: " + sd.map(q => q.name).join(" + ") + " — no wall line parts them"); return; }
      r.pieces.filter(x => x.sd.length > 1).forEach(x => log.push("open plan kept as one: " + x.sd.map(q => q.name).join(" + ") + " — no wall line parts them"));
      const pieces = r.pieces.map(x => { const ns = [], ss = []; x.sd.forEach(q => { if (!ns.includes(q.name)) { ns.push(q.name); ss.push(q.size); } });
        const kinds = ns.map(kindOf), kd = kinds.includes("corridor") ? "corridor" : new Set(kinds).size === 1 ? kinds[0] : "room";
        const p = Object.assign({}, s, {names: ns, sizes: ss, kind: kd, labs: x.sd.map(q => q.lab).filter(Boolean), how: "manual", lx: x.sd[0].x, ly: x.sd[0].y, edges: undefined, centre: undefined,
          notes: s.notes.concat(["open plan: split from " + [...new Set(sd.map(q => q.name))].filter(z => !ns.includes(z)).join(", ") + " on a wall line (no wall on the drawing)"])});
        setGeom(p, {outer: x.outer, holes: x.holes, un: x.un}); return p; });
      r.cuts.forEach(c => splits.push({line: [c.a, c.b], what: sd.map(q => q.name).join(" / ") + (c.beam ? " (on the beam line)" : "")}));
      spaces.splice(spaces.indexOf(s), 1, ...pieces);
      thresholds.forEach(t => { t.between = t.between.map(x => { if (x !== s) return x; const c = t.outer && t.outer[0] ? [t.outer[0].reduce((a2, q) => a2 + q[0], 0) / t.outer[0].length, t.outer[0].reduce((a2, q) => a2 + q[1], 0) / t.outer[0].length] : [s.lx, s.ly];
        return pieces.slice().sort((p1, p2) => near0(p1.outer[0], c) - near0(p2.outer[0], c))[0]; }); }); }); }
  mark("open plans");
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
    const nr = s.chk.find(c => c.rect === false); if (s.chk.length && !bad.length && nr) s.notes.push("written size = the main rectangle; the outline " + (nr.more ? "also takes in a recess / bay along the drawn walls" : "leaves out what stands in it (a bath, duct or pier in a corner)")); });
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
  mark("end"); res.prof = prof;
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
function fillPoly(G, m, P){   // the inside of a polygon (pt) set on the raster, by scan lines (even-odd)
  let y0 = Infinity, y1 = -Infinity; P.forEach(q => { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
  const Y0 = Math.max(0, G.py(y0)), Y1 = Math.min(G.H - 1, G.py(y1));
  for (let Y = Y0; Y <= Y1; Y++) { const y = G.y0 + (Y + 0.5) / G.R, xs = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) { const X0 = Math.max(0, G.px(xs[i])), X1 = Math.min(G.W - 1, G.px(xs[i + 1])); for (let X = X0; X <= X1; X++) m[Y * G.W + X] = 1; } }
}
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

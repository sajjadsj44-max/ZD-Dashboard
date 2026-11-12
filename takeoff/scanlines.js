/* ZD PDF Takeoff — reading the lines of a scanned drawing ("line OCR").
   A page that is only a picture (a scan, a photo, a PDF of images) has no lines the agents can work on: the walls, block masonry and
   beams agents, snapping and Trace all read a CAD drawing's own lines. This reads them off the picture, free and in this browser:
   readLines(gray, W, H, o) runs in a worker (the page stays live) and in plain Node (tools/test_takeoff_scanlines.js).
   Loaded with takeoff.js's own ?v= — bump it in takeoff/index.html whenever this file changes.

   gray: Uint8Array W × H, 0 black … 255 paper; o: {dpi (the picture's resolution), words: [[x0, y0, x1, y1]] text boxes in pixels,
   deskew (default true)} -> {segs: [[x0, y0, x1, y1, flags, w]], skew, stroke, n…}. Coordinates are pixels of the picture given
   (pixel i spans i … i + 1); w the line's thickness in pixels. flags: 2 dashed (a hidden beam, a centre line), 4 the outline of a filled
   shape (a column, a wall drawn solid), 1 a piece of a curve (a door swing).

   1. ink: the paper's own shade taken out (a yellowed or shaded scan), then the threshold between ink and paper (Otsu)
   2. the skew of the scan measured from its lines and turned out (a sheet fed at 0.7°: every wall would step otherwise)
   3. letters, figures, arrow heads and specks left out — small separate marks, and the ink inside the text boxes given that is not
      a line running through them; short straight dashes are kept for 5
   4. solid fills (ink deeper than three lines both ways): their outlines, as the edges of filled columns and walls
   5. straight strokes across and down: each one centre line to a fraction of a pixel (weighted by darkness); the pieces of one line
      set on one offset (so the two faces of a wall or a beam pair up exactly); a row of dashes joined into one dashed line — only with
      free ends and regular gaps: a wall face broken at a doorway has a jamb line at each end
   6. lines at other angles and curves (door swings, splayed walls) from a thinned skeleton of the ink left over */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function readLines(gray, W, H, o){
  o = o || {}; const t0 = Date.now(), N = W * H, dpi = +o.dpi || 200, mm = dpi / 25.4;
  if (!(W > 8 && H > 8) || !gray || gray.length < N) return {segs: [], err: "no picture"};
  // 1. ink
  let g = flatten(gray, W, H, Math.max(8, Math.round(2 * mm)));
  const T = clamp(otsu(g), 110, 205);
  let ink = new Uint8Array(N); for (let i = 0; i < N; i++) ink[i] = g[i] < T ? 1 : 0;
  // 2. skew
  let skew = 0;
  if (o.deskew !== false) {
    skew = measureSkew(ink, W, H);
    if (Math.abs(skew) >= 0.03) { g = turn(g, W, H, skew * Math.PI / 180); for (let i = 0; i < N; i++) ink[i] = g[i] < T ? 1 : 0; } else skew = 0;
  }
  const a = skew * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), cx = W / 2, cy = H / 2;
  const back = (x, y) => skew ? [cs * (x - cx) - sn * (y - cy) + cx, sn * (x - cx) + cs * (y - cy) + cy] : [x, y];   // a point of the straightened picture -> the picture given
  const fwd = (x, y) => skew ? [cs * (x - cx) + sn * (y - cy) + cx, -sn * (x - cx) + cs * (y - cy) + cy] : [x, y];
  // 3. text boxes and small marks
  let wiped = 0;
  (o.words || []).forEach(b => { if (!Array.isArray(b) || b.length < 4) return; const p = [fwd(b[0], b[1]), fwd(b[2], b[1]), fwd(b[0], b[3]), fwd(b[2], b[3])];
    wiped += wipeBox(ink, W, H, Math.min(...p.map(q => q[0])) - 1, Math.min(...p.map(q => q[1])) - 1, Math.max(...p.map(q => q[0])) + 1, Math.max(...p.map(q => q[1])) + 1); });
  const stroke = strokeWidth(ink, W, H, mm);
  const S = Math.max(Math.round(2.5 * stroke + 1), Math.round(0.7 * mm)), maxT = S - 1;   // deeper than S both ways: a fill; a line is thinner than that
  const marks = dropMarks(ink, W, H, {tiny: Math.max(2, 0.35 * mm), text: 4.5 * mm, dashT: Math.max(maxT, 0.9 * mm), solidMin: 1.0 * mm});
  // 4. fills
  const aux = new Uint8Array(N), fills = solids(ink, aux, W, H, S, Math.round(mm * mm)), segs = [];
  fills.edges.forEach(e => segs.push([e[0], e[1], e[2], e[3], 4, 0]));
  // 5. strokes across and down
  aux.fill(0);   // (now: the pixels used by a straight stroke)
  const P = {Lrun: Math.max(4, Math.round(0.5 * mm)), maxT, mm, stroke};
  const Hs = strokes(ink, g, aux, W, H, true, P), Vs = strokes(ink, g, aux, W, H, false, P);
  P.g = g; P.T = T; const lineH = lines(Hs, ink, W, H, true, P), lineV = lines(Vs, ink, W, H, false, P);
  lineH.forEach(l => segs.push([l.a, l.c, l.b, l.c, l.f, l.t]));
  lineV.forEach(l => segs.push([l.c, l.a, l.c, l.b, l.f, l.t]));
  // 6. other angles and curves
  const other = leftovers(ink, aux, W, H, P);
  other.forEach(s => segs.push(s));
  // 7. patterns: tile grids, brick and floor hatch, treads — flagged 16, as a CAD hatch's pattern lines are
  const npat = patterns(segs, mm);
  const out = segs.map(s => { const p = back(s[0], s[1]), q = back(s[2], s[3]); return [r2(p[0]), r2(p[1]), r2(q[0]), r2(q[1]), s[4], r2(s[5])]; });
  return {segs: out, skew: +skew.toFixed(3), stroke: +stroke.toFixed(2), threshold: T, fills: fills.n, text: marks.text, dashes: marks.dash, wiped,
    n: {across: lineH.length, down: lineV.length, dashed: lineH.concat(lineV).filter(l => l.f & 2).length, fill: fills.edges.length, other: other.length, pattern: npat}, ms: Date.now() - t0};
}
/* a pattern is four or more parallel lines side by side at one spacing (0.8 – 30 mm), each the nearest of the next and none with a
   partner close beside it — a tile grid, a brick or floor hatch, a stair's treads. A wall's face is never one: its other face lies close
   by (a row of rooms has its partitions at one spacing too, but each a pair of faces). Its lines get flag 16 (hatch, never a wall line) */
function patterns(segs, mm){
  const G = new Map(); let n = 0;
  segs.forEach((s, i) => { if (s[4] & 7) return; const dx = s[2] - s[0], dy = s[3] - s[1], L = Math.hypot(dx, dy); if (L < 1) return;
    let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI; if (a >= Math.PI - 0.009) a -= Math.PI; const k = Math.round(a / 0.035);   // 2° groups
    if (!G.has(k)) G.set(k, []); G.get(k).push(i); });
  G.forEach((ids, k) => {
    const a = k * 0.035, u = [Math.cos(a), Math.sin(a)], nn = [-u[1], u[0]];
    const L = ids.map(i => { const s = segs[i], t0 = u[0] * s[0] + u[1] * s[1], t1 = u[0] * s[2] + u[1] * s[3]; return {i, c: (nn[0] * (s[0] + s[2]) + nn[1] * (s[1] + s[3])) / 2, a: Math.min(t0, t1), b: Math.max(t0, t1)}; }).sort((p, q) => p.c - q.c);
    const ov = (p, q) => Math.min(p.b, q.b) - Math.max(p.a, q.a) >= 0.5 * Math.min(p.b - p.a, q.b - q.a);
    const up = new Int32Array(L.length).fill(-1), dn = new Int32Array(L.length).fill(-1);   // the nearest line beside each, overlapping it, either side
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].c - L[i].c <= 30 * mm; j++) { if (L[j].c - L[i].c < 0.3 || !ov(L[i], L[j])) continue; if (up[i] < 0) up[i] = j; if (dn[j] < 0 || L[i].c > L[dn[j]].c) dn[j] = i; }
    const sp = (i, j) => L[j].c - L[i].c, same = (d, e) => Math.abs(d - e) <= Math.max(1.2, 0.08 * d);
    const done = new Uint8Array(L.length);
    for (let i = 0; i < L.length; i++) { if (done[i] || up[i] < 0 || dn[up[i]] !== i) continue;
      const d = sp(i, up[i]); if (d < 0.8 * mm) continue;
      if (dn[i] >= 0 && sp(dn[i], i) < 0.6 * d) continue;   // (its partner close below: a wall's face)
      const run = [i]; let c = i;
      while (up[c] >= 0 && dn[up[c]] === c && same(d, sp(c, up[c]))) { c = up[c]; run.push(c); }
      if (up[c] >= 0 && sp(c, up[c]) < 0.6 * d) run.pop();   // (the last one's partner close above: a wall's face)
      if (run.length < 4) continue;
      run.forEach(r => { done[r] = 1; segs[L[r].i][4] |= 16; n++; }); }
  });
  return n;
}
const r2 = v => Math.round(v * 100) / 100;

/* the paper's shade: the lightest value in blocks of B px, widened two blocks each way (a filled column does not darken its own
   paper), floored at 150 (a large black area stays black) — each pixel taken as a share of its paper */
function flatten(gray, W, H, B){
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B), mx = new Uint8Array(bw * bh);
  for (let y = 0; y < H; y++) { const by = (y / B | 0) * bw, r = y * W; for (let x = 0; x < W; x++) { const v = gray[r + x], j = by + (x / B | 0); if (v > mx[j]) mx[j] = v; } }
  const bg = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= bh) continue; for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= bw) continue; const v = mx[yy * bw + xx]; if (v > m) m = v; } } bg[y * bw + x] = Math.max(150, m); }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const by = (y / B | 0) * bw, r = y * W; for (let x = 0; x < W; x++) { const b = bg[by + (x / B | 0)], v = gray[r + x]; out[r + x] = v >= b ? 255 : (v * 255 / b) | 0; } }
  return out;
}
function otsu(g){
  const h = new Float64Array(256); for (let i = 0; i < g.length; i++) h[g[i]]++;
  let tot = g.length, sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) { wB += h[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * h[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t + 1; } }
  return th;
}
/* the angle (degrees) the drawing's lines run at: the turn that stacks the ink into the fewest rows and columns (−3° … 3°) */
function measureSkew(ink, W, H){
  const pts = []; let n = 0; for (let i = 0; i < ink.length; i++) if (ink[i]) n++;
  if (n < 200) return 0;
  const step = Math.max(1, Math.floor(n / 150000));
  for (let y = 0, c = 0; y < H; y++) for (let x = 0, r = y * W; x < W; x++) if (ink[r + x] && (c++ % step) === 0) pts.push(x, y);
  const M = Math.ceil(Math.hypot(W, H)) + 4, hy = new Float64Array(2 * M + 2), hx = new Float64Array(2 * M + 2);
  const score = deg => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); hy.fill(0); hx.fill(0);   // (each pixel shared between the two rows it falls between: the score runs smooth with the angle — finer bins only alias with the pixel grid)
    for (let i = 0; i < pts.length; i += 2) { const x = pts[i] + 0.5 - W / 2, y = pts[i + 1] + 0.5 - H / 2, v = M + (-x * s + y * c), u = M + (x * c + y * s), v0 = Math.floor(v), u0 = Math.floor(u), fv = v - v0, fu = u - u0;
      hy[v0] += 1 - fv; hy[v0 + 1] += fv; hx[u0] += 1 - fu; hx[u0 + 1] += fu; }
    let v = 0; for (let i = 0; i < hy.length; i++) v += hy[i] * hy[i] + hx[i] * hx[i]; return v; };
  let best = 0, bv = score(0);
  for (let d = -3; d <= 3.0001; d += 0.1) { const v = score(d); if (v > bv * 1.0000001) { bv = v; best = d; } }
  const c0 = best; for (let d = c0 - 0.1; d <= c0 + 0.1001; d += 0.005) { const v = score(d); if (v > bv) { bv = v; best = d; } }
  return Math.abs(best) < 0.005 ? 0 : best;
}
/* the picture turned by −a about its centre (bilinear; paper outside) */
function turn(g, W, H, a){
  const out = new Uint8Array(W * H), c = Math.cos(a), s = Math.sin(a), cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) { const dy = y + 0.5 - cy; for (let x = 0; x < W; x++) { const dx = x + 0.5 - cx, sx = c * dx - s * dy + cx - 0.5, sy = s * dx + c * dy + cy - 0.5;
    const x0 = Math.floor(sx), y0 = Math.floor(sy); if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[y * W + x] = 255; continue; }
    const fx = sx - x0, fy = sy - y0, i = y0 * W + x0; out[y * W + x] = (g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + W] * (1 - fx) * fy + g[i + W + 1] * fx * fy) | 0; } }
  return out;
}
/* a text box: its ink goes, except what runs through it (a line crossing a room name runs out of the box at both ends) */
function wipeBox(ink, W, H, x0, y0, x1, y1){
  x0 = clamp(Math.floor(x0), 0, W - 1); y0 = clamp(Math.floor(y0), 0, H - 1); x1 = clamp(Math.ceil(x1), 0, W - 1); y1 = clamp(Math.ceil(y1), 0, H - 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw < 2 || bh < 2 || bw * bh > 4e6) return 0;
  const keep = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1;) { if (!ink[y * W + x]) { x++; continue; } let a = x; while (a > 0 && ink[y * W + a - 1]) a--; let b = x; while (b < W - 1 && ink[y * W + b + 1]) b++;
    if (a < x0 && b > x1) for (let xx = x; xx <= Math.min(b, x1); xx++) keep[(y - y0) * bw + xx - x0] = 1; x = b + 1; }
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1;) { if (!ink[y * W + x]) { y++; continue; } let a = y; while (a > 0 && ink[(a - 1) * W + x]) a--; let b = y; while (b < H - 1 && ink[(b + 1) * W + x]) b++;
    if (a < y0 && b > y1) for (let yy = y; yy <= Math.min(b, y1); yy++) keep[(yy - y0) * bw + x - x0] = 1; y = b + 1; }
  let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (ink[i] && !keep[(y - y0) * bw + x - x0]) { ink[i] = 0; n++; } }
  return n;
}
/* the usual thickness of a line: across the middle of long runs (median) */
function strokeWidth(ink, W, H, mm){
  const L = Math.max(10, Math.round(4 * mm)), v = [], sy = Math.max(1, Math.floor(H / 1500)), sx = Math.max(1, Math.floor(W / 1500));
  for (let y = 0; y < H && v.length < 4000; y += sy) for (let x = 0; x < W;) { const r = y * W; if (!ink[r + x]) { x++; continue; } let b = x; while (b < W && ink[r + b]) b++;
    if (b - x >= L) { const m = (x + b) >> 1; let u = y, d = y; while (u > 0 && ink[(u - 1) * W + m]) u--; while (d < H - 1 && ink[(d + 1) * W + m]) d++; if (d - u + 1 < L / 2) v.push(d - u + 1); } x = b; }
  for (let x = 0; x < W && v.length < 8000; x += sx) for (let y = 0; y < H;) { if (!ink[y * W + x]) { y++; continue; } let b = y; while (b < H && ink[b * W + x]) b++;
    if (b - y >= L) { const m = (y + b) >> 1, r = m * W; let l = x, rr = x; while (l > 0 && ink[r + l - 1]) l--; while (rr < W - 1 && ink[r + rr + 1]) rr++; if (rr - l + 1 < L / 2) v.push(rr - l + 1); } y = b; }
  if (!v.length) return Math.max(1, 0.25 * mm);
  v.sort((p, q) => p - q); return v[v.length >> 1];
}
/* growable stack of pixel indexes */
function Stack(){ let a = new Int32Array(1 << 16), n = 0; return {push(i){ if (n === a.length) { const b = new Int32Array(a.length * 2); b.set(a); a = b; } a[n++] = i; }, pop(){ return a[--n]; }, get n(){ return n; }, clear(){ n = 0; }}; }
/* small separate marks (8-connected) left out: specks, letters and figures, ticks and arrow heads — not solid blobs (a small column)
   and not thin straight dashes (a dashed line: decided in lines()) */
function dropMarks(ink, W, H, o){
  const st = Stack(), drop = []; let text = 0, dash = 0;
  for (let s = 0; s < ink.length; s++) { if (ink[s] !== 1) continue;
    let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0; ink[s] = 2; st.push(s);
    while (st.n) { const i = st.pop(), x = i % W, y = (i - x) / W; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const j = yy * W + xx; if (ink[j] === 1) { ink[j] = 2; st.push(j); } } } }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, mx = Math.max(bw, bh), mn = Math.min(bw, bh);
    if (mx < o.tiny) { drop.push(s); continue; }
    if (mx > o.text) continue;
    if (n >= 0.72 * bw * bh && mn >= o.solidMin) continue;   // a small solid blob: a column
    if (mn <= o.dashT && mx >= 2.5 * mn) { dash++; continue; }   // thin and straight across or down: perhaps a dash
    drop.push(s); text++; }
  drop.forEach(s => { if (ink[s] !== 2) return; ink[s] = 0; st.push(s);
    while (st.n) { const i = st.pop(), x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const j = yy * W + xx; if (ink[j] === 2) { ink[j] = 0; st.push(j); } } } } });
  for (let i = 0; i < ink.length; i++) if (ink[i]) ink[i] = 1;
  return {text, dash};
}
/* fills: ink at least S deep across and down; blobs under minA px left as ink. Their outlines are the cracks between a fill pixel
   and a paper one, joined into straight edges -> {edges: [[x0, y0, x1, y1]], n}; the fills are taken out of ink */
function solids(ink, mark, W, H, S, minA){
  const hr = mark; for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W;) { if (!ink[r + x]) { x++; continue; } let b = x; while (b < W && ink[r + b]) b++; const L = Math.min(255, b - x); for (let i = x; i < b; i++) hr[r + i] = L; x = b; } }
  let any = false;
  for (let x = 0; x < W; x++) for (let y = 0; y < H;) { if (!ink[y * W + x]) { y++; continue; } let b = y; while (b < H && ink[b * W + x]) b++;
    if (b - y >= S) for (let yy = y; yy < b; yy++) { const i = yy * W + x; if (hr[i] >= S) { ink[i] = 3; any = true; } } y = b; }
  if (!any) return {edges: [], n: 0};
  const st = Stack(); let n = 0;   // blobs too small: back to ink (a line's corner where two thick lines meet)
  for (let s = 0; s < ink.length; s++) { if (ink[s] !== 3) continue; const L = []; ink[s] = 4; st.push(s);
    while (st.n) { const i = st.pop(); L.push(i); const x = i % W; if (x > 0 && ink[i - 1] === 3) { ink[i - 1] = 4; st.push(i - 1); } if (x < W - 1 && ink[i + 1] === 3) { ink[i + 1] = 4; st.push(i + 1); } if (i >= W && ink[i - W] === 3) { ink[i - W] = 4; st.push(i - W); } if (i + W < ink.length && ink[i + W] === 3) { ink[i + W] = 4; st.push(i + W); } }
    if (L.length < minA) L.forEach(i => { ink[i] = 1; }); else n++; }
  const f = i => ink[i] === 4, hz = [], vt = [];
  for (let y = 0; y <= H; y++) for (let x = 0; x < W;) { const up = y > 0 && f((y - 1) * W + x), dn = y < H && f(y * W + x); if (up === dn) { x++; continue; } let b = x + 1;
    while (b < W) { const u2 = y > 0 && f((y - 1) * W + b), d2 = y < H && f(y * W + b); if (u2 !== up || d2 !== dn) break; b++; } hz.push({a: x, b, c: y, s: dn ? 1 : -1}); x = b; }
  for (let x = 0; x <= W; x++) for (let y = 0; y < H;) { const l = x > 0 && f(y * W + x - 1), r = x < W && f(y * W + x); if (l === r) { y++; continue; } let b = y + 1;
    while (b < H) { const l2 = x > 0 && f(b * W + x - 1), r2 = x < W && f(b * W + x); if (l2 !== l || r2 !== r) break; b++; } vt.push({a: y, b, c: x, s: r ? 1 : -1}); y = b; }
  for (let i = 0; i < ink.length; i++) if (ink[i] === 4) ink[i] = 0;
  /* an edge a little off square (what the deskew left, a rough scan) steps one pixel now and then: its pieces on the same side, each
     starting where the last ends, within two rows, are one edge again — and the one-pixel cracks at its steps go */
  const join = E => { const key = (s2, c, a) => s2 + "|" + c + "|" + a, byA = new Map(), used = new Uint8Array(E.length), out = [], steps = new Set();
    E.forEach((e, i) => byA.set(key(e.s, e.c, e.a), i));
    E.map((_, i) => i).sort((p, q) => E[p].a - E[q].a).forEach(i => { if (used[i]) return; used[i] = 1; const ch = [E[i]]; let cur = E[i], lo = cur.c, hi = cur.c;
      for (;;) { let nx = -1;
        for (const dc of [1, -1]) { const c = cur.c + dc; if (Math.max(hi, c) - Math.min(lo, c) > 1) continue;
          for (const da of [0, -1, 1]) { const j = byA.get(key(cur.s, c, cur.b + da)); if (j != null && !used[j]) { nx = j; break; } } if (nx >= 0) break; }
        if (nx < 0) break; const q = E[nx]; used[nx] = 1; steps.add(cur.b + "|" + Math.min(cur.c, q.c)); steps.add(q.a + "|" + Math.min(cur.c, q.c)); lo = Math.min(lo, q.c); hi = Math.max(hi, q.c); ch.push(q); cur = q; }
      let L = 0, sc = 0; ch.forEach(e => { L += e.b - e.a; sc += (e.b - e.a) * e.c; }); out.push({a: ch[0].a, b: cur.b, c: sc / L, n: ch.length}); });
    return {out, steps}; };
  const JH = join(hz), JV = join(vt), edges = [];
  JH.out.forEach(e => { if (!(e.n === 1 && e.b - e.a === 1 && JV.steps.has(e.c + "|" + e.a))) edges.push([e.a, e.c, e.b, e.c]); });
  JV.out.forEach(e => { if (!(e.n === 1 && e.b - e.a === 1 && JH.steps.has(e.c + "|" + e.a))) edges.push([e.c, e.a, e.c, e.b]); });
  return {edges, n};
}
/* straight strokes in one direction: runs of ink along the rows (across) or columns (down), Lrun long or more, stacked from line to line
   while they overlap; a stack up to maxT thick is one stroke -> [{c, a, b, t}] (c its centre line, a … b its extent, t thickness);
   their pixels are marked in used */
function strokes(ink, g, used, W, H, across, P){
  const nL = across ? H : W, nP = across ? W : H, ix = across ? (l, p) => l * W + p : (l, p) => p * W + l, out = [];
  let act = [];
  const close = s => { if (s.runs.length > P.maxT) return;
    let mx = 0; s.runs.forEach(r => { if (r[2] - r[1] > mx) mx = r[2] - r[1]; });
    let a = Infinity, b = -Infinity, ca = -Infinity, cb = Infinity; s.runs.forEach(r => { if (r[2] - r[1] >= 0.6 * mx) { if (r[1] < a) a = r[1]; if (r[2] > b) b = r[2]; if (r[1] > ca) ca = r[1]; if (r[2] < cb) cb = r[2]; } });
    if (s.runs.length > 1 && cb - ca < 0.7 * (b - a) - 2) return;   // its rows step along (a curve, a steep line): not one straight stroke — left to leftovers()
    let sw = 0, sc = 0; const l0 = s.runs[0][0], l1 = s.runs[s.runs.length - 1][0];
    for (let l = Math.max(0, l0 - 1); l <= Math.min(nL - 1, l1 + 1); l++) for (let p = a; p < b; p += (b - a > 400 ? 2 : 1)) { const v = 255 - g[ix(l, p)]; if (v > 8) { sw += v; sc += v * (l + 0.5); } }
    s.runs.forEach(r => { for (let p = r[1]; p < r[2]; p++) used[ix(r[0], p)] = 1; });
    out.push({c: sw ? sc / sw : (l0 + l1 + 1) / 2, a, b, t: l1 - l0 + 1}); };
  for (let l = 0; l < nL; l++) {
    const runs = []; for (let p = 0; p < nP;) { if (!ink[ix(l, p)]) { p++; continue; } let q = p; while (q < nP && ink[ix(l, q)]) q++; if (q - p >= P.Lrun) runs.push([l, p, q]); p = q; }
    const next = []; let j = 0;
    runs.forEach(r => { let best = null, bo = 0;
      while (j < act.length && act[j].b <= r[1]) j++;
      for (let k = j; k < act.length && act[k].a < r[2]; k++) { const s = act[k]; if (s.taken === l) continue; const ov = Math.min(r[2], s.b) - Math.max(r[1], s.a); if (ov >= 0.5 * Math.min(r[2] - r[1], s.b - s.a) && ov > bo) { bo = ov; best = s; } }
      if (best) { best.runs.push(r); best.taken = l; best.na = r[1]; best.nb = r[2]; next.push(best); }
      else next.push({runs: [r], taken: l, na: r[1], nb: r[2]}); });
    act.forEach(s => { if (s.taken !== l) close(s); });
    act = next.map(s => { s.a = s.na; s.b = s.nb; return s; }).sort((p, q) => p.a - q.a);
  }
  act.forEach(close);
  return out;
}
/* one direction's strokes -> lines: pieces of one line on one offset, small breaks joined, rows of dashes joined into a dashed line */
function lines(L, ink, W, H, across, P){
  if (!L.length) return [];
  const mm = P.mm, inkAt = (l, p) => { const x = across ? p : l, y = across ? l : p; return x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x] === 1; };
  // pieces lying inside a longer one on the same line (a broken edge row of a thick line): gone
  L.sort((p, q) => p.c - q.c || p.a - q.a);
  const keep = L.filter((p, i) => { for (let j = i - 1; j >= 0 && p.c - L[j].c <= 2; j--) { const q = L[j]; if (Math.abs(p.c - q.c) <= (p.t + q.t) / 2 && p.a >= q.a - 1 && p.b <= q.b + 1 && q.b - q.a > p.b - p.a) return false; }
    for (let j = i + 1; j < L.length && L[j].c - p.c <= 2; j++) { const q = L[j]; if (Math.abs(p.c - q.c) <= (p.t + q.t) / 2 && p.a >= q.a - 1 && p.b <= q.b + 1 && q.b - q.a > p.b - p.a) return false; }
    return true; });
  // one line, one offset: pieces within 0.9 px of the line's running mean
  const groups = []; keep.forEach(p => { const G = groups[groups.length - 1]; if (G && Math.abs(p.c - G.c) <= 0.9 && p.c - G.c0 <= 1.4) { G.ps.push(p); G.w += p.b - p.a; G.c += (p.c - G.c) * (p.b - p.a) / G.w; } else groups.push({c: p.c, c0: p.c, w: p.b - p.a, ps: [p]}); });
  const out = [], gapS = Math.max(2, 0.8 * P.stroke), dashMax = 25 * mm, gapMax = 7 * mm, minLen = Math.max(5, 0.6 * mm);
  const bare = (c, a, b) => {   // the gap between two dashes is paper in the picture itself (not a column's fill taken out, not a line crossing)
    let n = 0, d = 0; const l = Math.round(c - 0.5); for (let p = Math.ceil(a); p < Math.floor(b); p++) { const x = across ? p : l, y = across ? l : p; if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; if (P.g[y * W + x] < P.T) d++; }
    return d <= Math.max(1, 0.15 * n); };
  const free = (c, t, p, side) => {   // nothing drawn across the line's end: no jamb, no other line meeting it there
    const l0 = Math.floor(c - t / 2) - 1, l1 = Math.ceil(c + t / 2);
    for (let d = 0; d <= 2; d++) { const pp = side < 0 ? p - 1 + d : p - d; for (let l = l0 - 3; l <= l1 + 3; l++) { if (l >= l0 && l <= l1) continue; if (inkAt(l, pp)) return false; } }
    return true; };
  groups.forEach(G => {
    const ps = G.ps.sort((p, q) => p.a - q.a), M = [];
    ps.forEach(p => { const q = M[M.length - 1]; if (q && p.a - q.b <= gapS) { q.b = Math.max(q.b, p.b); q.t = Math.max(q.t, p.t); } else M.push({a: p.a, b: p.b, t: p.t}); });
    // dashed rows: three or more short pieces, gaps alike and the ends at each gap free
    let i = 0;
    while (i < M.length) {
      let j = i; const isDash = k => M[k].b - M[k].a <= dashMax;
      if (isDash(i)) { while (j + 1 < M.length && isDash(j + 1) && M[j + 1].a - M[j].b <= gapMax && free(G.c, M[j].t, M[j].b, 1) && free(G.c, M[j + 1].t, M[j + 1].a, -1) && bare(G.c, M[j].b, M[j + 1].a)) j++; }
      let dashed = false;
      if (j - i >= 2) { const gaps = [], lens = []; for (let k = i; k < j; k++) gaps.push(M[k + 1].a - M[k].b); for (let k = i + 1; k < j; k++) lens.push(M[k].b - M[k].a);
        const gmx = Math.max(...gaps), gmn = Math.min(...gaps), lmx = lens.length ? Math.max(...lens) : 0, lmn = lens.length ? Math.min(...lens) : 0;
        dashed = gmn > 0 && gmx <= 2.5 * gmn + 2 && (!lens.length || lmx <= 3 * lmn + 2); }
      if (dashed) { out.push({c: G.c, a: M[i].a, b: M[j].b, t: Math.max(...M.slice(i, j + 1).map(m => m.t)), f: 2}); i = j + 1; }
      else { const len = M[i].b - M[i].a;   // (a short line free at both ends is a letter's stroke, a tick or a lone dash: not a wall's nib, which meets its jamb)
        if (len >= minLen && (len >= 5 * mm || !free(G.c, M[i].t, M[i].a, -1) || !free(G.c, M[i].t, M[i].b, 1))) out.push({c: G.c, a: M[i].a, b: M[i].b, t: M[i].t, f: 0}); i++; }
    }
  });
  return out;
}
/* ink no straight stroke took: thinned to a one-pixel skeleton, traced into chains, each chain simplified (Douglas-Peucker, 1 px)
   into straight pieces; a chain that bends one way all along is a curve (its pieces flagged 1) */
function leftovers(ink, used, W, H, P){
  const N = W * H, m = new Uint8Array(N); let n = 0;
  for (let i = 0; i < N; i++) if (ink[i] && !used[i]) { m[i] = 1; n++; }
  if (!n) return [];
  thin(m, W, H);   // (the bits a straight stroke leaves along its sides thin to short chains, left out below)
  const out = [], nb = i => { const x = i % W, y = (i - x) / W, r = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && m[yy * W + xx]) r.push(yy * W + xx); } return r; };
  const seen = used; seen.fill(0); const minLen = Math.max(8, 1.2 * P.mm), tr = s => { const pts = [s]; seen[s] = 1; let cur = s;
    for (;;) { const nx = nb(cur).filter(j => !seen[j]); if (!nx.length) break; const j = nx.length === 1 ? nx[0] : nx.sort((p, q) => { const a = Math.abs(p - cur), b = Math.abs(q - cur); return (a === 1 || a === W ? 0 : 1) - (b === 1 || b === W ? 0 : 1); })[0]; seen[j] = 1; pts.push(j); cur = j; if (nb(j).length > 2) break; }
    return pts; };
  const chains = [];
  for (let i = 0; i < N; i++) if (m[i] && !seen[i] && nb(i).length === 1) chains.push(tr(i));
  for (let i = 0; i < N; i++) if (m[i] && !seen[i]) chains.push(tr(i));
  chains.forEach(ch => { if (ch.length < minLen) return; const pts = ch.map(i => { const x = i % W; return [x + 0.5, (i - x) / W + 0.5]; });
    const D = dp(pts, 1.0); if (D.length < 2) return;
    let turnS = 0, turns = 0; for (let k = 1; k + 1 < D.length; k++) { const a = D[k - 1], b = D[k], c = D[k + 1], cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) > 1e-9) { turnS += Math.sign(cr); turns++; } }
    const curve = turns >= 2 && Math.abs(turnS) === turns;
    for (let k = 1; k < D.length; k++) { const a = D[k - 1], b = D[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (curve || L >= minLen) out.push([a[0], a[1], b[0], b[1], curve ? 1 : 0, P.stroke]); } });
  return out;
}
function dp(pts, tol){
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(), A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1; let mx = -1, mi = -1;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((pts[k][0] - A[0]) * dy - (pts[k][1] - A[1]) * dx) / L; if (d > mx) { mx = d; mi = k; } }
    if (mx > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  return pts.filter((_, k) => keep[k]);
}
/* Zhang–Suen thinning, in place */
function thin(m, W, H){
  const del = [];
  for (let it = 0, ch = true; ch && it < 40; it++) { ch = false;
    for (const pass of [0, 1]) { del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!m[i]) continue;
        const p2 = m[i - W], p3 = m[i - W + 1], p4 = m[i + 1], p5 = m[i + W + 1], p6 = m[i + W], p7 = m[i + W - 1], p8 = m[i - 1], p9 = m[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2); if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(i); }
      if (del.length) { ch = true; for (const i of del) m[i] = 0; } } }
}

/* in a worker: {id, gray, W, H, o} -> {id, res} */
if (typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = e => { const {id, gray, W, H, o} = e.data || {};
    try { self.postMessage({id, res: readLines(gray, W, H, o)}); } catch (err) { self.postMessage({id, res: {segs: [], err: "reading the lines failed: " + (err && err.message || err)}}); } };
}

/* ZD PDF Takeoff — measurement engine: the deterministic geometry and QS formulas, no DOM and no app state, so every function
   can be unit-tested in Node (tools/test_takeoff_measure.js). Loaded by takeoff.js with its own ?v= (as cad.js and trace.js).

   Units. Geometry comes in page points (pt) with the page's scale k in pt per ft; results are in feet: ft (Rft), Sft, Cft. Metric
   and weight units are converted with exact factors (NIST SP 811). Nothing is rounded here — rounding is for display only (fmt).

   Rules. A formula never assumes an input: a wall finish without a height, a volume without a thickness, an opening without a size
   is not worked out — the result lists what is missing (missing: [...]) and its value is null. Deductions at or under the
   threshold are listed but not deducted, saying so (the house rule: masonry and plaster 1.00 Sft, formwork 5.00 Sft, concrete
   0.50 cft). Every result carries its formula as printed, its inputs and its unit, for the measurement sheet's audit trail. */

export const FT_M = 0.3048, SFT_M2 = 0.09290304, CFT_M3 = 0.028316846592, KG_TON = 1000;   // exact; "ton" = metric tonne (Pakistan steel)
export const UNITS = {
  ft: {to: "m", f: FT_M}, Rft: {to: "m", f: FT_M}, Sft: {to: "m2", f: SFT_M2}, Cft: {to: "m3", f: CFT_M3}, cft: {to: "m3", f: CFT_M3},
  m: {to: "ft", f: 1 / FT_M}, m2: {to: "Sft", f: 1 / SFT_M2}, m3: {to: "Cft", f: 1 / CFT_M3}, kg: {to: "ton", f: 1 / KG_TON}, ton: {to: "kg", f: KG_TON}, No: {to: "No", f: 1}, Nos: {to: "Nos", f: 1}};
/* v in unit `from` -> unit `to` (ft/Rft ↔ m, Sft ↔ m2, Cft ↔ m3, kg ↔ ton, mm / cm / in ↔ ft); throws on an unknown pair rather than guess */
export function convert(v, from, to){
  if (from === to) return v;
  const LEN = {ft: 1, Rft: 1, m: 1 / FT_M, mm: 1 / 304.8, cm: 1 / 30.48, in: 1 / 12}, AREA = {Sft: 1, m2: 1 / SFT_M2}, VOL = {Cft: 1, cft: 1, m3: 1 / CFT_M3}, MASS = {kg: 1, ton: KG_TON};
  for (const T of [LEN, AREA, VOL, MASS]) if (from in T && to in T) return v * T[from] / T[to];
  throw new Error("no conversion from " + from + " to " + to);
}
/* display rounding only: dp decimals (3 for ft / Sft / Cft as the sheet prints, 0 for Nos) */
export const fmt = (v, dp = 3) => v == null || !isFinite(v) ? "—" : (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp);

/* ------------------------------------------------------------------ geometry (page points) */
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function signedArea(P){ let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export const polyArea = P => Math.abs(signedArea(P));
export const perimeter = P => P.reduce((s, p, i) => s + dist(p, P[(i + 1) % P.length]), 0);
export const polylineLength = P => P.slice(1).reduce((s, p, i) => s + dist(P[i], p), 0);
/* each side's length (closed: n sides; open: n - 1 legs) */
export const sides = (P, closed) => (closed ? P : P.slice(0, -1)).map((p, i) => dist(p, P[(i + 1) % P.length]));
function segInter(a, b, c, d, eps){   // -> "cross" (proper), "touch" (an end on the other, or collinear overlap), or null
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const on = (p, q, r) => Math.min(p[0], q[0]) - eps <= r[0] && r[0] <= Math.max(p[0], q[0]) + eps && Math.min(p[1], q[1]) - eps <= r[1] && r[1] <= Math.max(p[1], q[1]) + eps;
  const L = Math.max(dist(a, b), dist(c, d), 1e-12), d1 = o(c, d, a) / L, d2 = o(c, d, b) / L, d3 = o(a, b, c) / L, d4 = o(a, b, d) / L;
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return "cross";
  if ((Math.abs(d1) <= eps && on(c, d, a)) || (Math.abs(d2) <= eps && on(c, d, b)) || (Math.abs(d3) <= eps && on(a, b, c)) || (Math.abs(d4) <= eps && on(a, b, d))) return "touch";
  return null;
}
/* a closed outline checked as a room boundary: at least 3 corners, a real area, no side crossing or touching another (a figure
   of eight, a side doubling back on itself), no repeated corner, no zero-length side. eps: page units treated as one point.
   -> {ok, issues: [{type, at, why}]} */
export function validatePolygon(P, eps = 1e-6){
  const issues = [], n = P ? P.length : 0;
  if (n < 3) return {ok: false, issues: [{type: "open", at: null, why: "fewer than 3 corners — not a closed outline"}]};
  if (polyArea(P) <= eps * eps) issues.push({type: "degenerate", at: null, why: "no area — the corners lie on one line"});
  for (let i = 0; i < n; i++) if (dist(P[i], P[(i + 1) % n]) <= eps) issues.push({type: "repeat", at: i, why: "corner " + (i + 1) + " repeats the next one"});
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;   // neighbouring sides share a corner
    const r = segInter(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n], eps);
    if (r) issues.push({type: r === "cross" ? "self-cross" : "self-touch", at: [i, j], why: "side " + (i + 1) + " " + (r === "cross" ? "crosses" : "touches") + " side " + (j + 1)});
  }
  return {ok: !issues.length, issues};
}
/* the turn at each corner, in degrees off the nearest of 0 / 90 / 180: a square room has 0 everywhere */
export function cornerDeviation(P){
  const n = P.length; return P.map((p, j) => { const a = P[(j + n - 1) % n], b = P[(j + 1) % n], u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    const t = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI); return Math.min(Math.abs(t - 90), t, Math.abs(t - 180)); });
}
/* two straight pieces lying on one another (within tolDist page units and tolDeg degrees): the length they share, else 0 —
   a wall run measured twice */
export function collinearOverlap(a, b, c, d, tolDist, tolDeg = 1){
  const La = dist(a, b), Lc = dist(c, d); if (!La || !Lc) return 0;
  const u = [(b[0] - a[0]) / La, (b[1] - a[1]) / La], w = [(d[0] - c[0]) / Lc, (d[1] - c[1]) / Lc];
  if (Math.abs(u[0] * w[1] - u[1] * w[0]) > Math.sin(tolDeg * Math.PI / 180)) return 0;
  const off = p => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]); if (off(c) > tolDist || off(d) > tolDist) return 0;
  const t = p => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], t0 = Math.max(0, Math.min(t(c), t(d))), t1 = Math.min(La, Math.max(t(c), t(d)));
  return Math.max(0, t1 - t0);
}
/* runs (polylines, page units) that lie on one another: [{i, j, shared}] with shared in page units over tol */
export function runOverlaps(runs, tolDist, minShared){
  const out = [], segs = runs.map(r => r.slice(1).map((p, k) => [r[k], p]));
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) { let s = 0;
    segs[i].forEach(([a, b]) => segs[j].forEach(([c, d]) => { s += collinearOverlap(a, b, c, d, tolDist); }));
    if (s > minShared) out.push({i, j, shared: s}); }
  return out;
}
/* count points closer than tol to one already counted: the same object marked twice */
export function duplicatePoints(pts, tol){ const dup = []; pts.forEach((p, i) => { for (let j = 0; j < i; j++) if (dist(p, pts[j]) < tol) { dup.push([j, i]); break; } }); return dup; }

/* ------------------------------------------------------------------ scale */
/* two clicked points (pt) and the length they span on the ground -> pt per ft. unit: ft | in | m | mm | cm. A span shorter than
   72 pt (1 inch of paper) or under 4 ft on the ground magnifies the click error: warned, not refused */
export function calibrate(p, q, length, unit = "ft"){
  const d = dist(p, q), ft = convert(+length, unit, "ft");
  if (!(d > 0) || !(ft > 0)) return {err: "two different points and a length above zero are needed"};
  const warn = [];
  if (d < 72) warn.push("the two points are under 1 inch apart on the paper — a click off by one screen pixel changes the scale by over 1 %; calibrate on a longer dimension");
  if (ft < 4) warn.push("the known length is under 4 ft — use the longest dimension you can find");
  return {ptPerFt: d / ft, spanPt: d, lengthFt: ft, warn};
}
/* a scale checked against more known dimensions: each [{pt, ft}] measured at k; the worst disagreement in % and whether it is
   within tolPct (1 % — Bluebeam's own advice is to check a second dimension after calibrating) */
export function checkScale(k, dims, tolPct = 1){
  const rows = dims.map(d => { const got = d.pt / k, err = 100 * (got - d.ft) / d.ft; return {ref: d.ft, got, errPct: err, ok: Math.abs(err) <= tolPct}; });
  const worst = rows.reduce((m, r) => Math.max(m, Math.abs(r.errPct)), 0);
  return {ok: rows.length > 0 && rows.every(r => r.ok), worstPct: worst, rows, tolPct};
}

/* ------------------------------------------------------------------ QS quantities (feet in, feet out) */
const need = (o, keys) => keys.filter(k => !(o[k] > 0));
const res = (value, unit, formula, inputs, extra) => Object.assign({value, unit, formula, inputs, missing: []}, extra || {});
const miss = (unit, formula, inputs, missing) => ({value: null, unit, formula, inputs, missing});
/* openings / deductions [{w, h, nos, name}] in ft against a threshold (Sft each): those at or under it are listed, not deducted */
function deduct(list, threshold, factor){
  const rows = (list || []).map(o => { const nos = +o.nos || 1, a = (+o.w || 0) * (+o.h || 0), below = a <= threshold;
    return {name: o.name || "", nos, w: +o.w || 0, h: +o.h || 0, each: a * (factor || 1), qty: below ? 0 : nos * a * (factor || 1), below, why: below ? "at or under " + threshold + " Sft — not deducted (house rule)" : ""}; });
  const bad = rows.filter(r => !(r.w > 0) || !(r.h > 0)).map(r => "opening size (" + (r.name || "unnamed") + ")");
  return {rows, total: rows.reduce((s, r) => s + r.qty, 0), bad};
}
/* room floor area: the outline (pt) at k pt per ft, less voids (outlines inside it) */
export function roomArea(outline, k, voids = []){
  if (!(k > 0)) return miss("Sft", "area by coordinates ÷ k²", {k}, ["page scale"]);
  const v = validatePolygon(outline, 1e-6 * k), gross = polyArea(outline) / k / k, ded = voids.reduce((s, h) => s + polyArea(h) / k / k, 0);
  return res(gross - ded, "Sft", "Σ(xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ) ÷ 2 ÷ k²" + (voids.length ? " − voids" : ""), {k, corners: outline.length}, {gross, deductions: ded, perimeter: perimeter(outline) / k, valid: v});
}
/* a wall's length on the sheet: the sum of its legs (pt) at k */
export function wallLength(runs, k){
  if (!(k > 0)) return miss("ft", "Σ legs ÷ k", {k}, ["page scale"]);
  const legs = runs.flatMap(r => sides(r, false).map(d => d / k)); return res(legs.reduce((s, v) => s + v, 0), "ft", "Σ legs ÷ k", {k, legs: legs.length}, {legs});
}
/* wall finish (plaster / paint): face length × height × faces, less openings over the threshold (1.00 Sft) */
export function wallFinishArea(o){
  const m = need(o, ["length", "height"]); if (m.length) return miss("Sft", "faces × L × H − openings", o, m.map(x => x === "height" ? "wall height H (never assumed)" : "face length"));
  const faces = +o.faces || 1, gross = faces * o.length * o.height, d = deduct(o.openings, o.threshold == null ? 1 : +o.threshold, faces);
  if (d.bad.length) return miss("Sft", "faces × L × H − openings", o, d.bad);
  return res(gross - d.total, "Sft", `${faces} × ${fmt(o.length)} × ${fmt(o.height)} − openings`, o, {gross, deductions: d.total, openings: d.rows});
}
/* masonry: length × height × thickness, less openings (w × h × thickness) over the threshold (1.00 Sft of face) */
export function masonryVolume(o){
  const m = need(o, ["length", "height", "thickness"]); if (m.length) return miss("Cft", "L × H × T − openings × T", o, m.map(x => x === "height" ? "wall height H (never assumed)" : x === "thickness" ? "wall thickness T (never assumed)" : "length"));
  const gross = o.length * o.height * o.thickness, d = deduct(o.openings, o.threshold == null ? 1 : +o.threshold, o.thickness);
  if (d.bad.length) return miss("Cft", "L × H × T − openings × T", o, d.bad);
  return res(gross - d.total, "Cft", `${fmt(o.length)} × ${fmt(o.height)} × ${fmt(o.thickness)} − openings`, o, {gross, deductions: d.total, openings: d.rows});
}
/* slab: its outline's area less the openings through it the user has CONFIRMED (shafts, stair voids) — an unconfirmed opening is
   listed, never deducted. Areas in Sft; thickness gives Cft (never assumed) */
export function slabArea(o){
  const conf = (o.openings || []).filter(x => x.confirmed), unconf = (o.openings || []).filter(x => !x.confirmed), thr = o.threshold == null ? 0 : +o.threshold;
  if (!(o.area > 0)) return miss("Sft", "slab outline − confirmed openings", o, ["slab outline"]);
  const rows = conf.map(x => ({name: x.name || "", area: +x.area || 0, below: (+x.area || 0) <= thr})), ded = rows.reduce((s, r) => s + (r.below ? 0 : r.area), 0);
  const out = res(o.area - ded, "Sft", "slab outline − confirmed openings", o, {gross: o.area, deductions: ded, openings: rows, unconfirmed: unconf.map(x => x.name || "opening")});
  if (o.thickness > 0) { out.volume = out.value * o.thickness; out.volumeUnit = "Cft"; } else out.volumeMissing = "slab thickness T (never assumed)";
  return out;
}
/* concrete: plan area × depth, or section (b × d, ft) × length; openings over 0.50 cft deducted */
export function concreteVolume(o){
  if (o.area != null) { const m = need(o, ["area", "depth"]); if (m.length) return miss("Cft", "A × D", o, m.map(x => x === "depth" ? "depth / thickness (never assumed)" : "plan area"));
    return res(o.area * o.depth, "Cft", `${fmt(o.area)} × ${fmt(o.depth)}`, o); }
  const m = need(o, ["b", "d", "length"]); if (m.length) return miss("Cft", "b × d × L", o, m.map(x => x === "length" ? "member length" : "section size " + x + " (never assumed)"));
  return res(o.b * o.d * o.length, "Cft", `${fmt(o.b)} × ${fmt(o.d)} × ${fmt(o.length)}`, o);
}
/* formwork of a slab: soffit area + edge (perimeter × depth); openings in the soffit over 5.00 Sft deducted (house rule) */
export function slabFormwork(o){
  const m = need(o, ["area", "perimeter", "depth"]); if (m.length) return miss("Sft", "soffit + perimeter × D", o, m.map(x => x === "depth" ? "slab depth D (never assumed)" : x));
  const d = (o.openings || []).map(x => ({name: x.name || "", area: +x.area || 0})).map(x => Object.assign(x, {below: x.area <= 5})), ded = d.reduce((s, x) => s + (x.below ? 0 : x.area), 0);
  return res(o.area - ded + o.perimeter * o.depth, "Sft", `${fmt(o.area)} − openings + ${fmt(o.perimeter)} × ${fmt(o.depth)}`, o, {soffit: o.area - ded, edges: o.perimeter * o.depth, openings: d});
}
/* ------------------------------------------------------------------ earthworks: cut and fill from spot levels */
const inPoly = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
/* Delaunay triangles of points [[x, y], …] (Bowyer–Watson) -> [[i, j, k], …]; fewer than 3 points, or all on one line, give [] */
export function delaunay(P){
  const n = P.length; if (n < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; P.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  const d = Math.max(x1 - x0, y1 - y0) || 1, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const V = P.map(p => [p[0] - mx, p[1] - my]).concat([[-20 * d, -d], [0, 20 * d], [20 * d, -d]]);   // (worked about the middle: smaller numbers, less rounding)
  const circ = v => { const [A, B, C] = v.map(i => V[i]), D = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(D) < 1e-12 * d * d) return {x: 0, y: 0, r2: Infinity};   // three points on a line: always replaced
    const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = C[0] * C[0] + C[1] * C[1];
    const x = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / D, y = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / D;
    return {x, y, r2: (A[0] - x) ** 2 + (A[1] - y) ** 2}; };
  let T = [{v: [n, n + 1, n + 2]}]; T[0].c = circ(T[0].v);
  for (let i = 0; i < n; i++) {
    const p = V[i], bad = [], keep = [];
    T.forEach(t => ((p[0] - t.c.x) ** 2 + (p[1] - t.c.y) ** 2 < t.c.r2 ? bad : keep).push(t));
    const E = new Map();   // the hole's edges: those of one bad triangle only
    bad.forEach(t => [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => { const u = t.v[a], w = t.v[b], key = u < w ? u + "," + w : w + "," + u; if (E.has(key)) E.get(key).n++; else E.set(key, {u, w, n: 1}); }));
    T = keep; E.forEach(e => { if (e.n === 1) { const t = {v: [e.u, e.w, i]}; t.c = circ(t.v); T.push(t); } });
  }
  const area2 = v => { const [A, B, C] = v.map(i => V[i]); return (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); };
  return T.filter(t => t.v.every(i => i < n) && Math.abs(area2(t.v)) > 1e-12 * d * d).map(t => t.v);
}
/* the ground level at q from spot levels P (points) with levels Z and their triangles T: the plane through the triangle q is
   in, else (outside the outermost levels) the levels weighted by 1 / distance² -> {z, out} */
export function groundAt(q, P, Z, T){
  for (const [a, b, c] of T) {
    const A = P[a], B = P[b], C = P[c], D = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (!D) continue;
    const u = ((B[1] - C[1]) * (q[0] - C[0]) + (C[0] - B[0]) * (q[1] - C[1])) / D, v = ((C[1] - A[1]) * (q[0] - C[0]) + (A[0] - C[0]) * (q[1] - C[1])) / D, w = 1 - u - v;
    if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return {z: u * Z[a] + v * Z[b] + w * Z[c], out: false};
  }
  let s = 0, sw = 0; for (let i = 0; i < P.length; i++) { const d2 = (P[i][0] - q[0]) ** 2 + (P[i][1] - q[1]) ** 2; if (d2 < 1e-18) return {z: Z[i], out: true}; s += Z[i] / d2; sw += 1 / d2; }
  return {z: s / sw, out: true};
}
/* cut and fill over an outline: o = {outline (pt), levels: [{p: [x, y] (pt), z (ft)}], formation (ft), k (pt per ft), cells}.
   The ground between the spot levels is the plane of each triangle of their Delaunay triangulation (a TIN, as a level sheet is
   worked by hand); outside the outermost levels the nearest ones decide, and the share of the area lying there is reported
   (outside). The outline is worked in cells (about 62,500 over its box): cut = Σ (ground − formation) where the ground is above
   the formation, fill = Σ (formation − ground) where it is below, each cell carrying the outline's exact area ÷ the cells. The
   formation level is never assumed. value = cut − fill (Cft) */
export function cutFill(o){
  const k = +o.k, F = o.formation === "" || o.formation == null ? NaN : +o.formation, L = (o.levels || []).filter(l => l && Array.isArray(l.p) && isFinite(+l.z));
  const miss2 = []; if (!(k > 0)) miss2.push("page scale"); if (!(o.outline && o.outline.length >= 3)) miss2.push("the outline");
  if (L.length < 3) miss2.push("3 spot levels or more (" + L.length + " given)"); if (!isFinite(F)) miss2.push("formation level (never assumed)");
  const inputs = {k, levels: L.length, formation: F};
  if (miss2.length) return miss("Cft", "Σ cells (ground − formation) × cell area", inputs, miss2);
  const ft = p => [p[0] / k, p[1] / k], O = o.outline.map(ft), Pt = [], Z = [];
  L.forEach(l => { const q = ft(l.p); if (Pt.some(x => Math.hypot(x[0] - q[0], x[1] - q[1]) < 1e-6)) return; Pt.push(q); Z.push(+l.z); });   // two levels on one point: the first
  const T = delaunay(Pt); if (!T.length) return miss("Cft", "Σ cells (ground − formation) × cell area", inputs, ["spot levels not all on one line"]);
  const A = polyArea(O); let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; O.forEach(p => { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); });
  const s = Math.max(Math.sqrt((bx1 - bx0) * (by1 - by0) / (+o.cells || 62500)), 1e-3), nx = Math.max(1, Math.ceil((bx1 - bx0) / s)), ny = Math.max(1, Math.ceil((by1 - by0) / s));
  const sx = (bx1 - bx0) / nx, sy = (by1 - by0) / ny;   // a whole number of cells across the box each way: a plane comes out exact
  let cut = 0, fill = 0, n = 0, out = 0, zl = Infinity, zh = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = bx0 + (i + 0.5) * sx, y = by0 + (j + 0.5) * sy;
    if (!inPoly([x, y], O)) continue; n++; const g = groundAt([x, y], Pt, Z, T); if (g.out) out++;
    zl = Math.min(zl, g.z); zh = Math.max(zh, g.z); const d = g.z - F; if (d > 0) cut += d; else fill -= d;
  }
  if (!n) return miss("Cft", "Σ cells (ground − formation) × cell area", inputs, ["an outline larger than one cell"]);
  cut *= A / n; fill *= A / n;
  return res(cut - fill, "Cft", "Σ cells (ground − formation) × cell area, ground from the TIN of the spot levels", inputs,
    {cut, fill, area: A, cells: n, cell: [sx, sy], outside: out / n, triangles: T.length, ground: [zl, zh], depthCut: cut / A, depthFill: fill / A});
}
/* objects counted: distinct points (marks closer than tol are one), the reviewed ones apart. found 0 is "none found", not a
   verified zero — that needs the user to confirm the page was looked over */
export function countObjects(pts, tol, reviewed){
  const dup = duplicatePoints(pts, tol), n = pts.length - dup.length;
  return {value: n, unit: "No", duplicates: dup, reviewed: reviewed ? Math.min(+reviewed, n) : 0, verifiedZero: false, status: n ? "counted" : "none found (not a verified zero)"};
}

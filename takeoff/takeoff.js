/* ZD PDF Takeoff — Phase 1.
   PDF drawings measured in the browser: the scale is read from the drawing's scale note (or set from a known
   length), points snap to the drawing's own vector lines, and every quantity is written to a measurement
   sheet in the house format (BOQ house standards): decimal feet, Nos × L × W × H on every row, deductions as
   their own negative rows with the house thresholds, Sft / cft / ft / Nos.
   Nothing leaves the browser: PDFs and projects are kept in IndexedDB. */
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";
const EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
                "#00a3c4", "#8e44ad", "#c0392b", "#d35400", "#16a085", "#7f8c8d", "#2c3e50", "#b8860b",
                "#ff1493", "#6b8e23", "#1e90ff", "#a0522d", "#20b2aa", "#9acd32", "#ff6347", "#000000"];
const SNAP_PX = 11, HIT_PX = 7;
let pdfjs = null;
const CADV = (() => { try { return new URL(import.meta.url).search; } catch (e) { return ""; } })();   // cad.js comes with takeoff.js's ?v=
let CAD = null;                       // cad.js (AutoCAD drawings), loaded on first use

/* ------------------------------------------------------------------ utilities */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const r3 = v => Math.round(v * 1000) / 1000;                       // lengths: decimal feet, 3 dp
const f3 = v => r3(v).toFixed(3);
const f2 = v => (Math.round(v * 100) / 100).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});   // money (PKR), thresholds
/* a quantity as shown: ft, Sft and cft to 3 dp (as the dimensions); Nos as a whole number (3 dp only if a formula gives a part) */
const fq = (v, unit) => { v = +v || 0; const d = /^\s*nos?\.?\s*$/i.test(String(unit || "")) && Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 3, x = Math.round(v * 10 ** d) / 10 ** d;
  return (x === 0 ? 0 : x).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d}); };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = iso => { const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "-" + MON[+p[1] - 1] + "-" + p[0] : "—"; };
function toast(msg, ms){ const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, ms || 2600); }
function busy(msg){ const b = $("busy"); b.textContent = msg || ""; b.style.display = msg ? "block" : "none"; }

/* the page's text with foot and inch marks as typed: PDF fonts give ' and " back as ’ ‘ ′ and ” “ ″ (12’-0"x12’-0") */
const normQ = s => String(s).replace(/[’‘′`´]/g, "'").replace(/[”“″]/g, '"');
/* vulgar fractions as written by some CAD fonts: "1½" -> "1 1/2", "¼" -> "1/4", 1⁄4 (fraction slash) -> 1/4 */
const VF = {"¼": "1/4", "½": "1/2", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅓": "1/3", "⅔": "2/3", "⅙": "1/6", "⅚": "5/6", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅒": "1/10"};
const vulgar = s => String(s).replace(/(\d)?(\s*)([¼½¾⅛⅜⅝⅞⅓⅔⅙⅚⅕⅖⅗⅘⅒])/g, (_, d, sp, f) => d ? d + " " + VF[f] : sp + VF[f]).replace(/(\d)\s*⁄\s*(\d)/g, "$1/$2");
/* "12'-6\"", "12' 6", "12-6", "12.5", "150\"", "12'6 1/2\"" -> decimal feet (NaN if not a length). A metric dimension
   ("3000mm", "300 cm", "3.05m") is converted to decimal feet — the sheet stays in feet. */
function parseFt(s){
  s = vulgar(String(s || "")).trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/\s+/g, " ");
  if (!s) return NaN;
  const frac = t => { t = t.trim(); if (!t) return 0; const m = /^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/.exec(t); if (!m || (m[2] && !(+m[3] > 0))) return NaN; return (m[1] ? +m[1] : 0) + (m[2] ? +m[2] / +m[3] : 0); };
  let m = /^(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|m)$/i.exec(s);                // 3000mm, 300 cm, 3.05 m
  if (m) return +m[1] / {mm: 304.8, cm: 30.48, m: 0.3048}[m[2].toLowerCase()];
  m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*([\d.\s/]*)"?$/.exec(s);              // 12'-6", 12' 6 1/2"
  if (m) { const i = frac(m[2]); return isNaN(i) ? NaN : +m[1] + i / 12; }
  m = /^([\d.\s/]+)\s*(?:"|in|inch|inches)$/i.exec(s);                     // 150", 150 in
  if (m) { const i = frac(m[1]); return isNaN(i) ? NaN : i / 12; }
  m = /^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/.exec(s);                           // 12-6
  if (m) return +m[1] + +m[2] / 12;
  m = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:ft)?$/i.exec(s);                      // 12.5
  return m ? +m[1] : NaN;
}

/* ------------------------------------------------------------------ geometry */
const polyLen = (P, closed) => { let s = 0; for (let i = 1; i < P.length; i++) s += dist(P[i - 1], P[i]); if (closed && P.length > 2) s += dist(P[P.length - 1], P[0]); return s; };
const polyArea = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(s) / 2; };
/* a closed outline whose sides cross (corners clicked out of order, a point dragged across a side): its area by
   coordinates is then not the area enclosed, so it is flagged on the sheet, in the export check and when drawn */
function selfCross(P){
  const n = P.length; if (n < 4) return false;
  const o = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-9 ? 0 : Math.sign(v); };
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n];
    for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const c = P[j], d = P[(j + 1) % n];
      if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true; } }
  return false;
}
const crossed = it => { const c = cond(it.cond); return !!c && c.type === "area" && it.shape !== "circle" && it.kind !== "open" && selfCross(it.pts); };
const crossMsg = "⚠ This outline crosses itself — its area is not the area drawn. Drag the points so the sides do not cross (or Ctrl+Z).";
function pointInPoly(p, P){ let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
function distSeg(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function projSeg(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return [a[0] + t * dx, a[1] + t * dy]; }
function segX(a, b, c, d){ const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? [a[0] + t * r[0], a[1] + t * r[1]] : null; }
/* closed polygon (feet) whose every edge is horizontal or vertical -> rectangles [{L, W}] (vertical strips, equal strips merged) */
function cluster(vals, tol){   // coordinates within tol of each other -> their mean (values are kept, not rounded to a grid)
  const out = [];
  vals.slice().sort((a, b) => a - b).forEach(v => { const g = out[out.length - 1]; if (g && v - g.max <= tol) { g.vs.push(v); g.max = v; } else out.push({vs: [v], max: v}); });
  return out.map(g => g.vs.reduce((a, b) => a + b, 0) / g.vs.length);
}
function rectilinear(P0, tol){
  for (let i = 0; i < P0.length; i++) { const a = P0[i], b = P0[(i + 1) % P0.length]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; }
  const cx = cluster(P0.map(p => p[0]), tol), cy = cluster(P0.map(p => p[1]), tol);
  const near = (v, R) => R.reduce((b, r) => Math.abs(r - v) < Math.abs(b - v) ? r : b, R[0]);
  const P = P0.map(p => [near(p[0], cx), near(p[1], cy)]);
  tol = 1e-9;
  const xs = cx, strips = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2, ys = [];
    for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; if (Math.abs(a[1] - b[1]) <= tol && Math.min(a[0], b[0]) < xm && Math.max(a[0], b[0]) > xm) ys.push((a[1] + b[1]) / 2); }
    ys.sort((a, b) => a - b);
    const iv = []; for (let k = 0; k + 1 < ys.length; k += 2) iv.push([ys[k], ys[k + 1]]);
    strips.push({x0: xs[i], x1: xs[i + 1], iv});
  }
  const out = [];
  for (let i = 0; i < strips.length; i++) {
    let j = i; while (j + 1 < strips.length && JSON.stringify(strips[j + 1].iv.map(v => v.map(r3))) === JSON.stringify(strips[i].iv.map(v => v.map(r3)))) j++;
    strips[i].iv.forEach(v => out.push({L: strips[j].x1 - strips[i].x0, W: v[1] - v[0]}));
    i = j;
  }
  return out.filter(r => r.L > tol && r.W > tol);
}
/* simple polygon -> triangles, each {base, height} so area = 0.5 × base × height (ear clipping) */
function triangles(P){
  const pts = P.slice(); let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  if (s < 0) pts.reverse();
  const idx = pts.map((_, i) => i), out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some(k => { const p = pts[k]; if (p === a || p === b || p === c) return false; return cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0; })) continue;
      out.push([a, b, c]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map(k => pts[k]));
  return out.map(([a, b, c]) => { const base = dist(a, b), ar = Math.abs(cross(a, b, c)) / 2; return {base, height: base ? 2 * ar / base : 0}; }).filter(t => t.base > 0 && t.height > 1e-9);
}

/* ------------------------------------------------------------------ storage (IndexedDB) */
let DB = null;
function openDB(){
  return new Promise((ok, bad) => {
    const rq = indexedDB.open("zdTakeoff", 2);
    rq.onupgradeneeded = () => { const db = rq.result, has = n => db.objectStoreNames.contains(n);
      if (!has("projects")) db.createObjectStore("projects", {keyPath: "id"});
      if (!has("pdfs")) db.createObjectStore("pdfs");
      if (!has("backups")) db.createObjectStore("backups", {keyPath: "id"}).createIndex("pid", "pid"); };
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => bad(rq.error);
  });
}
function tx(store, mode, fn){
  return new Promise((ok, bad) => { const t = DB.transaction(store, mode), s = t.objectStore(store); const r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error); });
}
const dbPut = (store, v, k) => tx(store, "readwrite", s => k === undefined ? s.put(v) : s.put(v, k));
const dbGet = (store, k) => tx(store, "readonly", s => s.get(k));
const dbDel = (store, k) => tx(store, "readwrite", s => s.delete(k));
const dbAll = store => tx(store, "readonly", s => s.getAll());

/* ------------------------------------------------------------------ state */
const P = {proj: null};               // the open project (saved)
const S = {                           // session state (not saved)
  docs: {},                           // fileId -> PDFDocumentProxy
  fileId: null, pageNo: 1, page: null, base: null, key: "",
  view: {s: 1, tx: 0, ty: 0}, rendered: null, renderTask: null, low: null, legendOn: true,
  tool: "select", cond: null, draft: [], cursor: null, snap: null, sel: null, selPt: -1,
  geo: {},                            // "fileId:page" -> {segs, grid, cell, n}
  texts: {},                          // "fileId:page" -> [{s, x, y}]
  undo: [], redo: [], drag: null, space: false, measure: null, measures: [], pinch: null,
  multi: new Set(), box: null, condSel: new Set(), matchSource: null   // multi-selection (shift-click, box, Ctrl+A); conditions ticked in the list
};
const keyOf = (f, p) => f + ":" + p;
const curScale = () => P.proj && P.proj.scales[S.key] ? P.proj.scales[S.key].ptPerFt : 0;
/* scale at a point: a viewport (a part of the sheet drawn at another scale, e.g. an enlarged detail) wins over the page */
function viewportAt(file, page, p){
  const vps = P.proj && P.proj.viewports && P.proj.viewports[keyOf(file, page)];
  return p && vps ? vps.find(v => v.ptPerFt > 0 && p[0] >= v.r[0] && p[0] <= v.r[2] && p[1] >= v.r[1] && p[1] <= v.r[3]) || null : null;
}
function scaleAt(file, page, p){ const v = viewportAt(file, page, p); if (v) return v.ptPerFt; const sc = P.proj && P.proj.scales[keyOf(file, page)]; return sc ? sc.ptPerFt : 0; }
const itemScale = it => scaleAt(it.file, it.page, it.pts && it.pts[0]);
const hereScale = p => scaleAt(S.fileId, S.pageNo, p);
/* a circle is stored as [centre, a point on the rim]; everything that needs an outline uses this polygon */
function itemPoly(it){
  if (it.shape !== "circle") return it.pts;
  const c = it.pts[0], r = dist(it.pts[0], it.pts[1]), out = [];
  for (let i = 0; i < 72; i++) out.push([c[0] + r * Math.cos(i * Math.PI / 36), c[1] + r * Math.sin(i * Math.PI / 36)]);
  return out;
}
const cond = id => P.proj.conds.find(c => c.id === id) || null;
const hiddenItem = it => { const c = cond(it.cond); return !!(c && c.hidden); };

/* ------------------------------------------------------------------ project lifecycle */
/* project file version. v1: files scales conds items last (+ viewports marks auto layersOff added over time).
   v2: + sheets (sheet no / title / revision / building / floor per page), openings (door & window schedule); items may
   carry location (bldg floor zone room), QA (qa qaBy qaAt qaNote), ai / copied flags, sch (schedule mark), doorW.
   migrate() upgrades any older file in place and never drops a property it does not know. */
const SCHEMA = 2;
function newProject(name){
  return {id: uid("P"), name: name || "Untitled takeoff", created: new Date().toISOString(), updated: new Date().toISOString(), v: SCHEMA,
          files: [], scales: {}, conds: [], items: [], last: {}, viewports: {}, marks: [], sheets: {}, openings: []};
}
/* rep (optional): an array that gets one line per repair. A project file comes from anywhere (a colleague, an old
   version, a damaged disk): values the app draws or multiplies are checked here — a colour that is not a colour (it is
   written into the drawing's SVG), points that are not numbers, a unit that does not belong to its type. Measurements
   or markups that cannot be drawn are left out and reported, never kept half-broken. */
const HEXCOL = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i;
function migrate(p, rep){
  const from = +p.v || 1, obj = v => v && typeof v === "object" && !Array.isArray(v), arr = Array.isArray, note = m => { if (rep) rep.push(m); };
  const num = v => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? +v : NaN;
  const pt = q => arr(q) && q.length >= 2 && isFinite(num(q[0])) && isFinite(num(q[1])) ? [num(q[0]), num(q[1])] : null;
  const pts = (P0, min) => { if (!arr(P0)) return null; const o = P0.map(pt); return o.every(Boolean) && o.length >= min ? o : null; };
  if (!arr(p.files)) p.files = []; if (!arr(p.conds)) p.conds = []; if (!arr(p.items)) p.items = []; if (!arr(p.marks)) p.marks = []; if (!arr(p.openings)) p.openings = [];
  if (!obj(p.scales)) p.scales = {}; if (!obj(p.viewports)) p.viewports = {}; if (!obj(p.last)) p.last = {}; if (!obj(p.sheets)) p.sheets = {};
  if (typeof p.name !== "string") p.name = String(p.name == null ? "Untitled takeoff" : p.name);
  let n = p.files.length; p.files = p.files.filter(f => obj(f) && f.id != null); if (p.files.length < n) note((n - p.files.length) + " PDF entr" + (n - p.files.length > 1 ? "ies" : "y") + " without an id left out");
  p.files.forEach(f => { f.id = String(f.id); f.name = String(f.name == null ? f.id : f.name); f.pages = Math.max(1, Math.round(num(f.pages)) || 1); });
  n = p.conds.length; p.conds = p.conds.filter(c => obj(c) && c.id != null); if (p.conds.length < n) note((n - p.conds.length) + " condition" + (n - p.conds.length > 1 ? "s" : "") + " without an id left out");
  p.conds.forEach((c, i) => {
    c.id = String(c.id); c.name = String(c.name == null ? "Condition " + (i + 1) : c.name);
    if (!UNITS[c.type]) { note(c.name + ": type “" + c.type + "” is not area / linear / count — set to area"); c.type = "area"; }
    if (!UNITS[c.type].includes(c.unit)) { note(c.name + ": unit “" + c.unit + "” does not fit " + c.type + " — set to " + UNITS[c.type][0]); c.unit = UNITS[c.type][0]; }
    if (!HEXCOL.test(String(c.color || ""))) { if (c.color != null && c.color !== "") note(c.name + ": colour “" + String(c.color).slice(0, 40) + "” is not a colour — replaced"); c.color = COLORS[i % COLORS.length]; }
    ["h", "t"].forEach(k => { if (c[k] !== "" && c[k] != null && !(num(c[k]) > 0)) { note(c.name + ": " + (k === "h" ? "height" : "thickness") + " “" + c[k] + "” is not a length — cleared"); c[k] = ""; } else if (c[k] !== "" && c[k] != null) c[k] = num(c[k]); });
    c.faces = Math.max(1, Math.min(2, Math.round(num(c.faces)) || 1)); c.dedMin = Math.max(0, num(c.dedMin) || 0);
    ["rate"].forEach(k => { if (c[k] != null && !isFinite(num(c[k]))) c[k] = 0; });
    if (c.asm != null && !arr(c.asm)) c.asm = [];
  });
  let bad = 0;
  p.items = p.items.filter(it => {
    if (!obj(it) || it.id == null) { bad++; return false; }
    const c = p.conds.find(x => x.id === String(it.cond));
    const min = it.kind === "open" || it.shape === "circle" ? 2 : !c || c.type === "count" ? 0 : c.type === "area" ? 3 : 2, q = pts(it.pts, min);   // (an empty count is kept: harmless, and flagged as zero by the export check)
    if (!q) { bad++; return false; }
    it.id = String(it.id); it.cond = String(it.cond); it.file = String(it.file); it.page = Math.max(1, Math.round(num(it.page)) || 1); it.pts = q;
    return true; });
  if (bad) note(bad + " measurement" + (bad > 1 ? "s" : "") + " with missing or broken points left out (they could not be drawn or measured)");
  p.items.forEach(it => { const nn = Math.round(num(it.nos)); it.nos = nn >= 1 && isFinite(nn) ? nn : 1; if (it.label == null) it.label = ""; it.label = String(it.label);
    if (!["shape", "ded", "open"].includes(it.kind)) it.kind = "shape";
    if (it.arcs != null && !(arr(it.arcs) && it.arcs.every(a => arr(a) && a.length === 2 && Number.isInteger(a[0]) && Number.isInteger(a[1])))) delete it.arcs;
    ["ow", "oh", "doorW"].forEach(k => { if (it[k] != null && it[k] !== "" && !isFinite(num(it[k]))) delete it[k]; }); });
  bad = 0;
  p.marks = p.marks.filter(m => { const q = obj(m) && m.id != null && MARK_TOOLS[m.type] && pts(m.pts, MK_MINPTS[m.type] || 2); if (!q) { bad++; return false; } m.pts = q; m.id = String(m.id); m.text = String(m.text == null ? "" : m.text);
    if (MK_TYPES.has(m.type)) mkSanitize(m);
    mkCommon(m);
    if (m.color != null && !HEXCOL.test(String(m.color))) { note("A markup's colour “" + String(m.color).slice(0, 40) + "” is not a colour — replaced"); m.color = "#d03b3b"; } return true; });
  if (bad) note(bad + " markup" + (bad > 1 ? "s" : "") + " with missing or broken points left out");
  mkProjCommon(p);
  Object.keys(p.scales).forEach(k => { const sc = p.scales[k]; if (!obj(sc) || !(num(sc.ptPerFt) > 0) || !isFinite(num(sc.ptPerFt))) { note("Page scale " + k + " is not a number — removed (set it again)"); delete p.scales[k]; } else sc.ptPerFt = num(sc.ptPerFt); });
  Object.keys(p.viewports).forEach(k => { if (!arr(p.viewports[k])) { delete p.viewports[k]; return; }
    p.viewports[k] = p.viewports[k].filter(v => { const ok = obj(v) && arr(v.r) && v.r.length === 4 && v.r.every(x => isFinite(num(x))) && isFinite(num(v.ptPerFt || 0)); if (!ok) note("A viewport on " + k + " is broken — removed"); else { v.r = v.r.map(num); v.ptPerFt = Math.max(0, num(v.ptPerFt || 0)); v.name = String(v.name == null ? "Viewport" : v.name); } return ok; }); });
  p.openings = p.openings.filter(o => { const ok = obj(o) && o.id != null && num(o.w) > 0 && num(o.h) > 0; if (!ok) note("Opening schedule mark " + (obj(o) ? o.mark : "?") + " has no valid size — removed"); else { o.w = num(o.w); o.h = num(o.h); o.mark = String(o.mark == null ? "" : o.mark); } return ok; });
  p.v = SCHEMA;
  return from;
}
/* every change is written to IndexedDB 300 ms after it (one write for a burst of changes), and at once on Ctrl+S, before
   the page is closed, reloaded or hidden, and before another project is opened — so a measurement made just before
   closing the tab is not lost. The project is taken when the change is made, not when the timer fires. */
let saveT = null, savePr = null;
const TAB = uid("T");
function save(){ if (!P.proj) return; S.ver = (S.ver || 0) + 1; P.proj.updated = new Date().toISOString(); savePr = P.proj; clearTimeout(saveT); saveT = setTimeout(flushSave, 300); saveSay("wait"); }
function flushSave(){
  clearTimeout(saveT); saveT = null; const pr = savePr; savePr = null;
  if (!pr || !DB) return Promise.resolve(false);
  return dbPut("projects", pr).then(() => { tabSay({t: "saved", id: pr.id, at: pr.updated}); if (!savePr && P.proj === pr) saveSay("ok", pr.updated); return true; })
    .catch(e => { toast("Could not save: " + e.message, 5000); if (P.proj === pr) saveSay("bad", e.message); return false; });
}
/* the save state next to the project name: "Saved 14:32" · "Saving…" · "NOT SAVED" (stays until a save works) */
function saveSay(st, x){
  const el = $("saveSt"); if (!el) return;
  if (st === "wait" && el.classList.contains("bad")) return;
  el.className = "savest " + st;
  const t = iso => { const d = new Date(iso); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  el.textContent = st === "ok" ? "✓ Saved " + t(x) : st === "wait" ? "Saving…" : st === "bad" ? "⚠ NOT SAVED" : "";
  el.title = st === "ok" ? "Saved in this browser at " + t(x) + " — Export → Project + PDFs to keep a copy elsewhere" : st === "bad" ? "The last change could not be saved in this browser: " + x + " — press Ctrl+S to try again, and export a copy" : "Writing the last change to this browser's storage";
}
/* the same project open in two tabs: each would overwrite the other's work on its next save — say so in both */
const TABCH = typeof BroadcastChannel === "function" ? new BroadcastChannel("zdTakeoff") : null;
function tabSay(m){ try { if (TABCH) TABCH.postMessage(Object.assign({tab: TAB}, m)); } catch (e) {} }
if (TABCH) TABCH.onmessage = e => { const m = e.data || {}; if (!P.proj || m.tab === TAB || m.id !== P.proj.id) return;
  if (m.t === "open") tabSay({t: "here", id: P.proj.id});
  S.otherTab = m.t === "saved" ? "changed in another tab or window at " + String(m.at || "").slice(11, 16) : "also open in another tab or window";
  renderSheet(); };
const UNDO_KEYS = ["conds", "items", "scales", "viewports", "marks", "sheets", "openings", "mkLayers", "mkStatuses", "mkFilters"];
function snapshot(){ const o = {}; UNDO_KEYS.forEach(k => { o[k] = P.proj[k]; }); return JSON.stringify(o); }
/* every change goes through mutate(): the project before it is kept for Ctrl+Z (200 steps), with a name for the
   undo / redo buttons ("Undo: Move 3 measurements") */
function mutate(fn, label){
  S.undo.push({js: snapshot(), label: label || ""});
  let tot = 0; S.undo.forEach(e => { tot += undoEntry(e).js.length; });   // 200 steps, fewer (20 at least) for a big project: about 80 MB of history at most
  while (S.undo.length > 200 || (S.undo.length > 20 && tot > 40e6)) tot -= undoEntry(S.undo.shift()).js.length;
  S.redo = []; S.draftRedo = [];
  fn(); save(); refresh();
}
/* the shape being drawn keeps its own history in steps: a click is one step, an arc (many points) is one step, so
   Ctrl+Z / Backspace take back the last click or the whole arc and Ctrl+Y puts it back. With nothing being drawn,
   Ctrl+Z / Ctrl+Y step through the project history. */
const DRAFT_TOOLS = ["draw", "ded", "measure", "fence", "rect", "open", "cal", "circle", "vp", "cloud", "arrow", "dimension", "hilite", "vsearch", "typref",
  "mk_polyline", "mk_polygon", "mk_line", "mk_box", "mk_ellipse", "mk_link", "mk_redact", "mk_erase", "mk_callout", "mk_text", "mk_stamp", "mk_image"];
function draftPush(pts, arc){
  if (!S.draftSteps || S.draftSteps.reduce((a, n) => a + n, 0) !== S.draft.length) S.draftSteps = S.draft.map(() => 1);
  if (arc) (S.draftArcs = S.draftArcs || []).push([S.draft.length - 1, S.draft.length - 1 + pts.length]);
  S.draft.push(...pts); S.draftSteps.push(pts.length); S.draftRedo = [];
  if (S.tool === "measure") S.measure = S.draft.slice();
}
function draftClear(){ S.draft = []; S.draftSteps = []; S.draftArcs = []; S.arcMode = 0; S.arcMid = null; S.typed = ""; }
function draftBack(){   // take back the last step of the shape being drawn -> true if there was one
  if (S.arcMid) { S.arcMid = null; draw(); return true; }
  if (S.arcMode) { S.arcMode = 0; hint(); draw(); return true; }
  if (!S.draft.length) return false;
  if (!S.draftSteps || S.draftSteps.reduce((a, n) => a + n, 0) !== S.draft.length) S.draftSteps = S.draft.map(() => 1);
  const n = Math.min(S.draft.length, S.draftSteps.pop() || 1), start = S.draft.length - n;
  (S.draftRedo = S.draftRedo || []).push({pts: S.draft.splice(start, n), arc: (S.draftArcs || []).some(a => a[0] === start - 1)});
  S.draftArcs = (S.draftArcs || []).filter(a => a[1] < start);
  if (S.resume && !S.draft.length) S.resume = null;
  if (S.tool === "measure") S.measure = S.draft.slice();
  draftBtns(); draw(); return true;
}
function undoAny(){
  if (S.drag && (S.drag.vertex != null || S.drag.move)) return cancelDrag();
  if (draftBack()) return;
  S.draftRedo = []; undo();
}
function redoAny(){
  const st = S.draftRedo && S.draftRedo.length ? S.draftRedo[S.draftRedo.length - 1] : null;
  if (st && DRAFT_TOOLS.indexOf(S.tool) >= 0) { S.draftRedo.pop(); const keep = S.draftRedo; draftPush(st.pts, st.arc); S.draftRedo = keep; draftBtns(); draw(); return; }
  redo();
}
const undoEntry = e => typeof e === "string" ? {js: e, label: ""} : e;
function draftBtns(){
  const u = S.undo.length ? undoEntry(S.undo[S.undo.length - 1]).label : "", r = S.redo.length ? undoEntry(S.redo[S.redo.length - 1]).label : "";
  $("bUndo").disabled = !S.draft.length && !S.undo.length; $("bRedo").disabled = !(S.draftRedo && S.draftRedo.length) && !S.redo.length;
  $("bUndo").title = S.draft.length ? "Undo the last point (Ctrl+Z)" : "Undo" + (u ? ": " + u : "") + " (Ctrl+Z)";
  $("bRedo").title = S.draftRedo && S.draftRedo.length ? "Redo the point (Ctrl+Y)" : "Redo" + (r ? ": " + r : "") + " (Ctrl+Y)";
}
function undo(){ if (!S.undo.length) return; const e = undoEntry(S.undo.pop()); S.redo.push({js: snapshot(), label: e.label}); restore(e.js); toast("Undone" + (e.label ? ": " + e.label : ""), 1600); }
function redo(){ if (!S.redo.length) return; const e = undoEntry(S.redo.pop()); S.undo.push({js: snapshot(), label: e.label}); restore(e.js); toast("Redone" + (e.label ? ": " + e.label : ""), 1600); }
function restore(js){ const o = JSON.parse(js); UNDO_KEYS.forEach(k => { if (o[k] !== undefined) P.proj[k] = o[k]; }); migrate(P.proj);
  if (S.sel && !P.proj.items.some(i => i.id === S.sel)) { S.sel = null; S.selPt = -1; }
  const live = new Set(P.proj.items.map(i => i.id).concat((P.proj.marks || []).map(m => m.id))); [...S.multi].forEach(id => { if (!live.has(id)) S.multi.delete(id); });
  if (S.selMark && !live.has(S.selMark)) S.selMark = null;
  save(); refresh(); }

async function openProject(id){
  await flushSave();   // the project being left keeps its last change
  const pr = await dbGet("projects", id);
  if (!pr) return toast("Project not found");
  const rep = [];
  if ((+pr.v || 1) < SCHEMA) { const from = migrate(pr, rep); await dbPut("projects", pr); toast("Project upgraded from file version " + from + " to " + SCHEMA, 3000); } else migrate(pr, rep);
  if (rep.length) setTimeout(() => toast("The stored project had damaged entries, repaired: " + rep.slice(0, 2).join(" · ") + (rep.length > 2 ? " · …" : ""), 8000), 400);
  Object.values(S.docs).forEach(d => d.destroy && d.destroy());
  P.proj = pr; S.docs = {}; S.geo = {}; S.texts = {}; S.sizes = {}; S.thumbs = {}; S.thumbQ = []; S.ocgs = {}; S.ocBound = {}; S.undo = []; S.redo = []; S.sel = null; S.multi.clear(); S.selMark = null; draftClear(); S.page = null; S.fileId = null; S.otherTab = "";
  S.pgSel = new Set(); S.pgLast = null; S.pgQ = ""; S.pgF = ""; S.cadSc = {}; S.cadP = {}; S.iso = null; freeCadBitmap();
  tabSay({t: "open", id: pr.id});
  S.cond = (pr.conds[0] || {}).id || null;
  localStorage.setItem("zdTakeoffLast", pr.id);
  $("start").classList.remove("on");
  $("projName").value = pr.name; saveSay("ok", pr.updated);
  buildPageSel();
  const first = pr.last && pr.last.file && pr.files.some(f => f.id === pr.last.file) ? pr.last : pr.files[0] ? {file: pr.files[0].id, page: 1} : null;
  if (first) await gotoPage(first.file, first.page || 1); else showDrop(true);
  setTool(S.cond ? "draw" : "select");
  refresh();
  backupNow("opened").catch(() => {});
}
async function showStart(){
  await flushSave();
  const all = (await dbAll("projects")).sort((a, b) => b.updated.localeCompare(a.updated));
  const q = String(($("projectSearch") || {}).value || "").trim().toLowerCase();
  const list = q ? all.filter(p => String(p.name || "").toLowerCase().includes(q)) : all;
  $("projList").innerHTML = list.length ? '<table class="plist"><thead><tr><th>Project</th><th>PDFs</th><th>Measurements</th><th>Last changed</th><th></th></tr></thead><tbody>' +
    list.map(p => `<tr><td><a class="plink" data-open="${esc(p.id)}" title="Open project">${esc(p.name)}</a></td><td>${p.files.length}</td><td>${p.items.length}</td><td>${dmy(p.updated)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-edit="${esc(p.id)}">Edit</button> <button class="btn sm" data-bak="${esc(p.id)}">Backups</button> <button class="btn sm" data-dup="${esc(p.id)}">Duplicate</button> <button class="btn sm dng" data-del="${esc(p.id)}">Delete</button></td></tr>`).join("") + "</tbody></table>"
    : (q ? '<div class="empty">No projects match your search.</div>' : '<div class="empty">No projects yet — start one with <b>+ New project</b>, then drop a PDF drawing on it.</div>');
  $("start").classList.add("on");
}

/* ------------------------------------------------------------------ PDFs */
async function loadPdfjs(){
  if (pdfjs) return pdfjs;
  try { pdfjs = await import(PDFJS + "pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs"; }
  catch (e) { pdfjs = null; throw new Error("The PDF engine (pdf.js) could not be loaded — check the internet connection."); }
  return pdfjs;
}
/* a stored PDF, opened once per visit. A locked one asks for its password (never kept) the first time it is needed — one question
   for every caller waiting on it; turned down, it is not asked again by what runs in the background (thumbnails, agents, exports)
   until one of its pages is opened (ask1) */
async function doc(fileId, ask1){
  if (S.docs[fileId]) return S.docs[fileId];
  S.docP = S.docP || {}; S.pwNo = S.pwNo || new Set();
  if (S.docP[fileId]) return S.docP[fileId];
  const f = P.proj && P.proj.files.find(x => x.id === fileId);
  if (S.pwNo.has(fileId) && !ask1) throw new Error(((f && f.name) || "The PDF") + " is locked with a password — open one of its pages to enter it");
  S.docP[fileId] = (async () => {
    const rec = await dbGet("pdfs", fileId);
    if (!rec) throw new Error("PDF missing — add “" + ((f || {}).name || fileId) + "” again with + PDF to re-attach it.");
    if (rec.pw) { delete rec.pw; await dbPut("pdfs", rec, fileId).catch(() => {}); }   // a password an earlier version kept with the PDF: not kept any more
    try { const {d} = await openPdfData(await loadPdfjs(), rec.data, (f && f.name) || rec.name || "the PDF", "opened"); S.pwNo.delete(fileId); return S.docs[fileId] = d; }
    catch (e) { if (e && e.pwNo) S.pwNo.add(fileId); throw e; }
  })().finally(() => { delete S.docP[fileId]; });
  return S.docP[fileId];
}
/* a secret typed in (a PDF's open password, the API key): a plain text field drawn as dots — never a browser password field, so no
   browser or password manager offers to save or fill it. Where the browser cannot draw a field as dots, dots are typed and the
   secret kept aside */
const SECRET_IN = 'type="text" class="secret" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"';
const DOTS = !!(window.CSS && CSS.supports && CSS.supports("-webkit-text-security", "disc")), SECRETS = new WeakMap();
function secretField(el){
  if (!el || el.dataset.secret) return el; el.dataset.secret = "1";
  ["copy", "cut", "dragstart"].forEach(t => el.addEventListener(t, e => e.preventDefault()));
  const keep = e => {
    if (DOTS || (e && e.isComposing)) return;
    const v = el.value, s0 = SECRETS.get(el) || ""; let at = v.search(/[^\u2022]/); const add = at < 0 ? "" : v.slice(at).replace(/\u2022[\s\S]*$/, "");
    if (at < 0) at = el.selectionStart == null ? v.length : el.selectionStart;
    const s1 = s0.slice(0, at) + add + s0.slice(Math.max(at, s0.length - (v.length - at - add.length)));
    SECRETS.set(el, s1); el.value = "\u2022".repeat(s1.length); try { el.setSelectionRange(at + add.length, at + add.length); } catch (er) {}
  };
  el.addEventListener("input", keep); el.addEventListener("compositionend", keep);
  return el;
}
const secretVal = el => !el ? "" : DOTS ? el.value : SECRETS.get(el) || "";
function secretSet(el, v){ v = v || ""; if (DOTS) el.value = v; else { SECRETS.set(el, v); el.value = "\u2022".repeat(v.length); } }
/* a PDF locked with an open password: asked for each time it is opened (wrong → asked again) — never kept, in this browser or in an
   exported project */
async function openPdfData(lib, data, name, verb){
  let pw, turn = null;
  try {
    for (let tries = 0; ; tries++) {
      try { return {d: await lib.getDocument({data: new Uint8Array(data.slice(0)), isEvalSupported: false, password: pw}).promise}; }
      catch (e) {
        if (!e || e.name !== "PasswordException") throw e;
        if (!turn) { const prev = openPdfData.q; let go; openPdfData.q = new Promise(r => { go = r; }); turn = go; await prev; }   // one password question at a time
        busy("");
        const q = ask("Password — " + name, `<p>${tries ? "<b style='color:var(--red)'>That password is not right.</b> " : ""}This PDF is locked with a password. Enter it to open the drawing.</p>
          <div class="fg w2" style="margin-top:8px"><label>Password</label><input ${SECRET_IN} id="dlgPw"></div>
          <p class="small" style="margin-top:6px">Not saved — it is asked each time this PDF is opened.</p>`, "Open", () => ({pw: secretVal($("dlgPw"))}), "dlgPw");
        secretField($("dlgPw")); const v = await q;
        if (!v) throw Object.assign(new Error(name + " is locked with a password — not " + (verb || "added")), {pwNo: true});
        pw = v.pw; busy("Opening " + name + "…");
      }
    }
  } finally { if (turn) turn(); }
}
/* a PDF is known by a fingerprint of its content (SHA-256), not by its name and size: the same drawing added again
   (under any name) is re-attached to its measurements; a different drawing under a name already in the project is asked
   about — add it as a new drawing, or replace the old one as its revision — never swapped in silently */
async function sha256(buf){ try { const h = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); } catch (e) { return ""; } }
async function pdfSha(id){   // the stored PDF's fingerprint (worked out once for a PDF stored before fingerprints); null = not in this browser
  const rec = await dbGet("pdfs", id); if (!rec) return null; if (rec.sha) return rec.sha;
  const h = await sha256(rec.data); if (h) { rec.sha = h; await dbPut("pdfs", rec, id).catch(() => {}); } return h;
}
/* a dialog with its own buttons: resolves to the chosen button's v, or null (Cancel / Esc / Enter) */
function choose(title, body, btns){
  const p = ask(title, body, ""), cur = ask.cur;
  $("dlgF").insertAdjacentHTML("beforeend", btns.map((b, i) => `<button class="btn${b.pri ? " pri" : ""}" data-ch="${i}">${esc(b.t)}</button>`).join(""));
  $("dlgF").querySelectorAll("[data-ch]").forEach(x => x.onclick = () => cur(btns[+x.dataset.ch].v));
  return p.then(v => v === true ? null : v);
}
/* the project's references to one PDF moved to a new id (its measurements, markups, scales, viewports, sheet info, layers) */
function remapFileId(text, from, to){ return text.split('"' + from + '"').join('"' + to + '"').split('"' + from + ':').join('"' + to + ':'); }
function dropFileCache(fid){
  if (S.docs[fid]) { try { S.docs[fid].destroy(); } catch (e) {} delete S.docs[fid]; }
  const mine = k => String(k).split(":")[0] === fid;
  [S.geo, S.texts, S.sizes, S.thumbs].forEach(o => o && Object.keys(o).forEach(k => { if (mine(k)) delete o[k]; }));
  if (S.ocgs) delete S.ocgs[fid]; if (S.ocBound) delete S.ocBound[fid]; if (S.pdfVp) delete S.pdfVp[fid]; if (S.cadSc) delete S.cadSc[fid]; if (S.cadP) delete S.cadP[fid];
}
async function addFiles(files){
  if (!P.proj) return;
  for (const f of files) {
    const cadF = isCadFile(f);
    if (!cadF && !/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { toast(f.name + " is not a PDF or an AutoCAD drawing (DWG / DXF)"); continue; }
    busy("Opening " + f.name + "…");
    try {
      let data = await f.arrayBuffer(), cad = null; const sha = await sha256(data);
      if (cadF) { const pre = P.proj.files.find(x => x.sha === sha && x.cad); cad = await cadImport(f, data, pre && pre.cad.map); data = cad.pdf; }   // the drawing as a layered vector PDF (+ its scene)
      const lib = await loadPdfjs();
      const {d} = await openPdfData(lib, data, f.name);
      for (const x of P.proj.files) if (!x.sha) { const h = await pdfSha(x.id); if (h) x.sha = h; }   // PDFs added before fingerprints
      let meta = sha ? P.proj.files.find(x => x.sha === sha) : null, name = f.name, how = meta ? "same" : "new";
      const named = meta ? null : P.proj.files.find(x => x.name === f.name);
      if (named && !sha) { if (named.size === f.size) { meta = named; how = "same"; } }   // no fingerprint in this browser: the old name + size rule
      else if (named && !named.sha && named.size === f.size && !(await dbGet("pdfs", named.id))) { meta = named; how = "same"; }   // nothing to compare with: re-attached as before
      else if (named) {
        busy("");
        const here = !!(await dbGet("pdfs", named.id)), n = P.proj.items.filter(i => i.file === named.id).length;
        const v = await choose("Different drawing, same name — " + f.name, `<p><b>${esc(f.name)}</b> is already in this project, but the file you added is a <b>different drawing</b> (its content does not match${here ? "" : " the one the project was measured on"}).</p>
          <p style="margin-top:6px"><b>${n}</b> measurement${n === 1 ? " is" : "s are"} on the drawing already here.</p>
          <ul class="small" style="margin:6px 0 0 18px"><li><b>Add as new drawing</b> — kept side by side; nothing already measured moves.</li>
          <li><b>${here ? "Replace — it is a revision" : "Attach anyway"}</b> — the measurements stay where they are and now sit on this drawing: check them against it.${here ? " The project is backed up first." : ""}</li></ul>`,
          [{t: here ? "Replace — it is a revision" : "Attach anyway", v: "replace"}, {t: "Add as new drawing", v: "new", pri: true}]);
        if (!v) { toast(f.name + " not added"); continue; }
        busy("Opening " + f.name + "…");
        if (v === "replace") { meta = named; how = "replace"; }
        else { const used = new Set(P.proj.files.map(x => x.name)), ext = (/\.(pdf|dwg|dxf)$/i.exec(f.name) || [".pdf"])[0], stem = f.name.slice(0, f.name.length - (/\.(pdf|dwg|dxf)$/i.test(f.name) ? ext.length : 0)); for (let i = 2; used.has(name); i++) name = stem + " (" + i + ")" + ext; }
      }
      if (how === "replace") {
        savePr = P.proj; await flushSave(); await backupNow("before replacing " + meta.name).catch(() => {});
        const shared = (await dbAll("projects")).some(x => x.id !== P.proj.id && (x.files || []).some(y => y.id === meta.id));
        if (shared) {   // a duplicated project shares the stored PDF: it keeps the old drawing, this project gets its own
          const nid = uid("F"), o = JSON.parse(remapFileId(JSON.stringify(P.proj), meta.id, nid));
          dropFileCache(meta.id); Object.keys(o).forEach(k => { P.proj[k] = o[k]; }); S.undo = []; S.redo = []; S.sel = null; S.selMark = null; S.multi.clear();
          meta = P.proj.files.find(x => x.id === nid);
        }
      }
      const id = meta ? meta.id : uid("F");
      await dbPut("pdfs", Object.assign({name, size: f.size, data, sha}, cad ? {src: cad.src, scene: cad.scene, pdfSha: await sha256(data)} : {}), id);   // stored first: a PDF listed in the project is always one that can be opened
      if (!meta) { meta = {id, name, size: f.size, sha, pages: d.numPages, added: new Date().toISOString()}; if (cad) meta.cad = cad.meta; P.proj.files.push(meta); }
      else { meta.pages = d.numPages; meta.size = f.size; if (sha) meta.sha = sha; if (how === "replace") meta.replaced = new Date().toISOString(); if (cad) meta.cad = cad.meta; else delete meta.cad; }
      if (cad) cadAdopt(meta, cad, how);
      dropFileCache(meta.id);
      S.docs[meta.id] = d; if (cad) { S.cadSc = S.cadSc || {}; S.cadSc[meta.id] = cad.scene; }
      save(); buildPageSel();
      await gotoPage(meta.id, 1);
      toast(how === "replace" ? f.name + " replaced — " + d.numPages + " page" + (d.numPages > 1 ? "s" : "") + " · check the measurements sit on the new drawing"
        : name + (name !== f.name ? " (added as a new drawing)" : how === "same" ? " (same drawing — re-attached)" : "") + " — " + d.numPages + " page" + (d.numPages > 1 ? "s" : ""), how === "new" && name === f.name ? 2600 : 5000);
      if (cad) setTimeout(() => toast(cadSay(name, cad.meta), 9000), 300);
    } catch (e) { const m = e && e.message || String(e); toast(/password/i.test(m) ? m : f.name + " could not be opened — " + m + (/Invalid PDF|empty/i.test(m) ? " (is it a PDF, and complete?)" : ""), 6000); }
    busy("");
  }
}
function buildPageSel(){
  const sel = $("pageSel"), o = [];
  P.proj.files.forEach(f => { for (let i = 1; i <= f.pages; i++) o.push(`<option value="${esc(f.id)}|${i}">${esc(f.name.replace(/\.pdf$/i, ""))} — p.${i}</option>`); });
  sel.innerHTML = o.join("") || "<option>No PDF yet</option>";
  if (S.fileId) sel.value = S.fileId + "|" + S.pageNo;
}
function showDrop(on){ $("drop").style.display = on ? "flex" : "none"; }

/* ------------------------------------------------------------------ PDF layers (optional content, e.g. AutoCAD layers)
   One visibility config per PDF, passed to every render — screen, auto area, find similar, exports, Claude — so a
   layer switched off (furniture, text, hatch) is gone everywhere. Switched-off layers are saved by name. */
/* layer roles, from the layer names: what bounds a room (walls, doors and windows, columns, railings) and what does
   not (furniture, fixtures, glass screens, hatch, text, clouds). Used by auto area, the agents and the presets. */
const ROLES = [["column", /column|^col\b/i], ["hatch", /hatch|patt/i], ["glass", /glass|glaz/i], ["wall", /\bwalls?\b|r\.?c\.?c|partition|block ?work|masonry|parapet/i],
  ["tag", /^\s*d\s*-\s*w\s*$|tag/i], ["opening", /door|window|gate|vent/i], ["railing", /railing|balcon|metal.*frame/i], ["unit", /apartment|appartment|\bunit\b/i],
  ["text", /text|title|area|size|dim|grid|note|section|seal|cloud|label|tag|lable/i], ["fixture", /fixt|fict|furn|bath|kit|sanit|plant|tree|equip|mep|elect|light|lcd|marble|stair|step|\bwh\b|d\.b|j\.b|access|trap|cupboard|ac |wood|landscape|ramp|parking|ceiling|beam|lintel/i]];
const BOUND = new Set(["wall", "opening", "column", "railing"]);
function layerRole(name){ for (const [r, rx] of ROLES) if (rx.test(name)) return r; return "other"; }
function layerInfo(fileId){   // {id: {name, role}} of the PDF's layers, or null
  const cfg = S.ocgs && S.ocgs[fileId]; if (!cfg) return null;
  const out = {}; Object.entries(cfg.getGroups()).forEach(([id, gr]) => { out[id] = {name: gr.name, role: layerRole(gr.name)}; }); return out;
}
function segRoleFilter(g, roles){   // a test for segment ids: on a layer of one of these roles (null: the PDF has no such layers)
  const L = g && g.layerIds && g.file && layerInfo(g.file); if (!L || !g.layerIds.length) return null;
  const ok = g.layerIds.map(id => !!(L[id] && roles.has(L[id].role)));
  if (!ok.some(Boolean)) return null;
  return i => { const li = g.segs[i][7]; return li >= 0 && ok[li]; };
}
async function boundCfg(fileId){   // an optional-content config with only the room-boundary layers shown (for auto area's picture)
  S.ocBound = S.ocBound || {};
  if (S.ocBound[fileId] !== undefined) return S.ocBound[fileId];
  let cfg = null; try { const L = layerInfo(fileId); if (L && Object.values(L).some(l => l.role === "wall")) { cfg = await (await doc(fileId)).getOptionalContentConfig();
    Object.keys(L).forEach(id => cfg.setVisibility(id, BOUND.has(L[id].role) && !(((P.proj.layersOff || {})[fileId] || []).includes(L[id].name)))); } } catch (e) { cfg = null; }
  S.ocBound[fileId] = cfg; return cfg;
}
const ocOn = (cfg, id) => { const g = cfg && cfg.getGroup && cfg.getGroup(id); return !g || g.visible !== false; };   // (isVisible() wants a group object, not an id)
const lay = fileId => S.ocgs && S.ocgs[fileId] ? {optionalContentConfigPromise: Promise.resolve(S.ocgs[fileId])} : {};
async function loadLayers(fileId){
  S.ocgs = S.ocgs || {};
  if (S.ocgs[fileId] !== undefined) return S.ocgs[fileId];
  let cfg = null;
  try { cfg = await (await doc(fileId)).getOptionalContentConfig(); if (!cfg || !cfg.getGroups()) cfg = null; } catch (e) { cfg = null; }
  if (cfg) { const off = new Set(((P.proj.layersOff || {})[fileId]) || []); Object.entries(cfg.getGroups()).forEach(([id, g]) => { if (off.has(g.name)) cfg.setVisibility(id, false); }); }
  S.ocgs[fileId] = cfg; return cfg;
}
function renderLayers(){
  const el = $("layerList"); if (!el) return;
  const cfg = S.ocgs && S.ocgs[S.fileId];
  if (!S.page) { el.innerHTML = ""; return; }
  if (!cfg) { el.innerHTML = mkLayersHtml() + '<div class="empty">This PDF has no layers. AutoCAD keeps them when you plot with <b>DWG To PDF.pc3</b> and “Include layer information” ticked (Page Setup → PDF Options) — or add the <b>DWG</b> itself with <b>+ PDF</b>: its AutoCAD layers come with it.</div>'; return; }
  const cm = cadMeta(S.fileId), CL = cm ? new Map(cm.layers.map(l => [l.name, l])) : null, dark = darkNow();
  const G = Object.entries(cfg.getGroups()).sort((a, b) => a[1].name.localeCompare(b[1].name, undefined, {numeric: true}));
  const RN = {wall: "wall", opening: "door / window", column: "column", railing: "railing", glass: "glass", hatch: "hatch", text: "text / dims", tag: "tags", unit: "unit area", fixture: "fixtures / MEP", other: ""};
  const sw = l => l ? `<span class="lsw" style="background:${l.c === -1 ? (dark ? "#ffffff" : "#000000") : "#" + (l.c & 0xffffff).toString(16).padStart(6, "0")}" title="${l.aci ? "Colour " + l.aci : "True colour"}"></span>` : "";
  el.innerHTML = mkLayersHtml() + (cm ? `<div class="lyrbar"><b style="flex:1;color:var(--navy)">AutoCAD layers · ${G.length}</b><button class="btn sm" data-cadq="1" title="Quantities from the drawing's own objects: lengths and areas by layer, blocks by name">CAD quantities…</button></div>` : "") +
    `<div class="lyrbar"><button class="btn sm" data-lall="1">All on</button><button class="btn sm" data-lall="0">All off</button><input type="search" id="lyrQ" placeholder="Filter layers"></div>
    <div class="lyrbar"><span class="small" style="width:100%">Clean the drawing:</span><button class="btn sm pri" data-lpre="clean" title="Only walls, doors / windows, columns and railings">Walls & openings only</button><button class="btn sm" data-lpre="text" title="Text, dimensions, grid, titles, clouds">Text off</button><button class="btn sm" data-lpre="fixture" title="Furniture, sanitary, kitchen, MEP, electrical">Fixtures off</button><button class="btn sm" data-lpre="hatch">Hatch off</button></div>` +
    G.map(([id, g]) => { const r = layerRole(g.name), l = CL && CL.get(g.name);
      return `<label class="lyr" data-name="${esc(g.name.toLowerCase())}"><input type="checkbox" data-lid="${esc(id)}"${ocOn(cfg, id) ? " checked" : ""}> ${sw(l)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" title="${l ? esc(g.name + " · linetype " + l.lt.toLowerCase() + (l.frozen ? " · frozen in the drawing" : l.off ? " · off in the drawing" : "") + (l.plot ? "" : " · not plotted")) : esc(g.name)}">${esc(g.name)}</span>${RN[r] ? `<span class="tag ${BOUND.has(r) ? "g" : "a"}" title="${BOUND.has(r) ? "Bounds rooms for auto area" : "Ignored by auto area"}">${RN[r]}</span>` : ""}${cm ? `<button type="button" class="lyiso${S.iso === id ? " on" : ""}" data-liso="${esc(id)}" title="Only this layer (AutoCAD's LAYISO) — again: every layer back">&#9678;</button>` : ""}</label>`; }).join("") +
    '<div class="small" style="padding:8px 12px">Green roles bound rooms for <b>Auto area</b> and the agents (setting ⚙ “Use the PDF\'s layers”). Layers switched off here are left out of snapping, auto area and the agents too.' + (cm ? " Right-click an object on the drawing to take it off, or isolate its layer." : "") + "</div>";
}
let layT = null;
function setLayer(ids, on){
  const cfg = S.ocgs && S.ocgs[S.fileId]; if (!cfg) return;
  ids.forEach(id => cfg.setVisibility(id, on));
  P.proj.layersOff = P.proj.layersOff || {};
  P.proj.layersOff[S.fileId] = Object.entries(cfg.getGroups()).filter(([id]) => !ocOn(cfg, id)).map(([, g]) => g.name);
  if (S.ocBound) delete S.ocBound[S.fileId];
  save(); clearTimeout(layT); layT = setTimeout(() => { renderLow(); renderHi(true); }, 60);
}

/* page changes can overlap (PgDn pressed twice, a sheet row clicked while a page is loading): only the latest one is
   applied, and the page shown, its key, scale and indexed lines are always set together — never page 2's key with page
   3's drawing */
async function gotoPage(fileId, pageNo){
  const seq = S.navSeq = (S.navSeq || 0) + 1, stale = () => seq !== S.navSeq;
  let d;
  try { d = await doc(fileId, true); } catch (e) { if (!stale()) { toast(e.message, 6000); showDrop(true); } return; }
  if (stale()) return;
  pageNo = Math.max(1, Math.min(d.numPages, +pageNo || 1));
  await loadLayers(fileId);
  if (stale()) return;
  if (cadMeta(fileId)) { await cadLoad(fileId); if (stale()) return; }   // an AutoCAD drawing: its scene draws the screen
  let pg; try { pg = await d.getPage(pageNo); } catch (e) { if (!stale()) toast("Page " + pageNo + " could not be read: " + (e.message || e), 6000); return; }
  if (stale()) return;
  if (S.renderTask) { try { S.renderTask.cancel(); } catch (e) {} S.renderTask = null; }
  S.fileId = fileId; S.pageNo = pageNo; S.key = keyOf(fileId, pageNo);
  S.page = pg;
  if (S.cadBmp && S.cadBmp.page !== pg) freeCadBitmap();
  S.base = S.page.getViewport({scale: 1});
  S.rendered = null; $("hi").style.display = "none"; { const lc = $("low"); lc.width = lc.width; }   // the last page's picture goes at once
  draftClear(); S.resume = null; S.gap = null; S.multi.clear(); S.hover = null; S.measure = null; S.measures = []; S.snap = null; S.autoShow = null; S.cmp = null; $("cmpLegend").style.display = "none";
  P.proj.last = {file: fileId, page: pageNo}; save();
  $("pageSel").value = fileId + "|" + pageNo; pgMark();
  showDrop(false); S.iso = null; bgMark();
  fit(); renderLayers();
  await renderLow();
  if (stale()) return;
  renderHi(true);
  indexPage();   // vector lines + scale note, in the background
  refresh();
}

/* ------------------------------------------------------------------ rendering */
const stage = () => $("stage");
function fitWidth(){   // the page's width across the window, from its top
  if (!S.base) return;
  const w = stage().clientWidth, s = Math.max(0.05, Math.min(5000, (w - 24) / S.base.width));
  S.view = {s, tx: (w - S.base.width * s) / 2, ty: 12}; applyView(); renderHi();
}
function fit(){
  if (!S.base) return;
  const st = stage(), w = st.clientWidth, h = st.clientHeight, s = Math.min((w - 24) / S.base.width, (h - 24) / S.base.height);
  S.view = {s: s > 0 ? s : 1, tx: (w - S.base.width * s) / 2, ty: (h - S.base.height * s) / 2};
  applyView();
}
/* line weights off: every stroke drawn 1 device pixel wide, whatever the PDF says (as Bluebeam's toggle) */
const LW = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "lineWidth");
function thinLines(ctx){
  if (!S.thin) return ctx;
  const stroke = ctx.stroke;
  ctx.stroke = function(){ const m = this.getTransform(), s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; LW.set.call(this, 1 / s); return stroke.apply(this, arguments); };
  return ctx;
}
/* overlay compare: this page in blue, the compared page (an older revision) in red, multiplied together — lines on
   both come out dark, lines only on this page blue (added), only on the other red (removed) */
function tint(ctx, w, h, blue){
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const k = Math.min(d[i], d[i + 1], d[i + 2]); if (blue) { d[i] = k; d[i + 1] = k; d[i + 2] = 255; } else { d[i] = 255; d[i + 1] = k; d[i + 2] = k; } d[i + 3] = 255; }
  ctx.putImageData(im, 0, 0);
}
async function overlayCmp(ctx, w, h, scale, tx, ty){
  if (!S.cmp || !S.cmp.pg) return;
  tint(ctx, w, h, true);
  const o = document.createElement("canvas"); o.width = w; o.height = h;
  const c2 = o.getContext("2d", {willReadFrequently: true}); c2.fillStyle = "#fff"; c2.fillRect(0, 0, w, h);
  try { await sliced(S.cmp.pg.render({...lay(S.cmp.file), canvasContext: thinLines(c2), viewport: S.cmp.pg.getViewport({scale}), transform: [1, 0, 0, 1, tx + S.cmp.dx * scale, ty + S.cmp.dy * scale]})).promise; } catch (e) { return; }
  tint(c2, w, h, false);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(o, 0, 0); ctx.restore();
}
async function compareDialog(){
  if (!S.page) return;
  const opts = []; P.proj.files.forEach(f => { for (let i = 1; i <= f.pages; i++) if (!(f.id === S.fileId && i === S.pageNo)) opts.push({f, i}); });
  if (!opts.length && !S.cmp) return toast("Add the other revision's PDF first (+ PDF), then compare");
  const v = await ask("Compare with another revision", `<p>This page is drawn in <b style="color:#2a52d6">blue</b>, the page you pick in <b style="color:#d03b3b">red</b>. Lines on both come out dark; <b style="color:#2a52d6">blue</b> = only on this page (added), <b style="color:#d03b3b">red</b> = only on the other (removed).</p>
    <div class="fg w2" style="margin-top:8px"><label>Compare with</label><select id="cmpSel">${S.cmp ? '<option value="off">— Turn compare off —</option>' : ""}${opts.map((o, n) => `<option value="${n}">${esc(o.f.name.replace(/\.pdf$/i, ""))} — p.${o.i}</option>`).join("")}</select></div>
    <p class="small" style="margin-top:8px">If the sheets are not lined up, nudge the red one with <b>Alt + arrow keys</b> (Shift for bigger steps).</p>`, "Compare", () => ({v: $("cmpSel").value}));
  if (!v) return;
  if (v.v === "off") { S.cmp = null; $("cmpLegend").style.display = "none"; renderLow(); renderHi(true); return; }
  const o = opts[+v.v];
  try { await loadLayers(o.f.id); S.cmp = {file: o.f.id, page: o.i, pg: await (await doc(o.f.id)).getPage(o.i), dx: 0, dy: 0, name: o.f.name.replace(/\.pdf$/i, "") + " p." + o.i}; } catch (e) { return toast(e.message, 5000); }
  $("cmpLegend").innerHTML = `<b style="color:#2a52d6">■ this page</b> · <b style="color:#d03b3b">■ ${esc(S.cmp.name)}</b> · dark = same <button class="btn sm" id="cmpOff">Off</button>`; $("cmpLegend").style.display = "flex";
  $("cmpOff").onclick = () => { S.cmp = null; $("cmpLegend").style.display = "none"; renderLow(); renderHi(true); };
  renderLow(); renderHi(true);
}
async function renderLow(){   // drawn off screen, then shown only if the page is still the one on screen
  if (cadOn()) return cadLow();   // an AutoCAD drawing: from its scene
  const page = S.page, fileId = S.fileId, longSide = Math.max(S.base.width, S.base.height), sc = Math.min(3, 3000 / longSide);
  const vp = page.getViewport({scale: sc}), off = document.createElement("canvas");
  off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
  const ctx = inkCtx(thinLines(off.getContext("2d")), !S.cmp && darkNow(), !S.cmp && !!S.mono);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, off.width, off.height); try { await sliced(page.render({...lay(fileId), canvasContext: ctx, viewport: vp})).promise; } catch (e) {}
  if (S.page !== page) return;
  await overlayCmp(ctx, off.width, off.height, sc, 0, 0);
  if (S.page !== page) return;
  const c = $("low"); c.width = off.width; c.height = off.height; c.getContext("2d").drawImage(off, 0, 0);
  S.low = {s: sc};
  applyView();
}
let hiT = null;
function renderHi(now){
  clearTimeout(hiT);
  if (cadOn()) { if (S.renderTask) { try { S.renderTask.cancel(); } catch (e) {} S.renderTask = null; } return cadHi(!!now); }   // a CAD drawing: drawn from its scene, at once
  hiT = setTimeout(async () => {
    if (!S.page) return;
    if (S.renderTask) { try { S.renderTask.cancel(); } catch (e) {} }
    const st = stage(), dpr = Math.min(window.devicePixelRatio || 1, 2), c = $("hi"), v = Object.assign({}, S.view);
    const w = Math.max(1, Math.floor(st.clientWidth * dpr)), h = Math.max(1, Math.floor(st.clientHeight * dpr));
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const ctx = inkCtx(thinLines(off.getContext("2d")), !S.cmp && darkNow(), !S.cmp && !!S.mono);
    const task = sliced(S.page.render({...lay(S.fileId), canvasContext: ctx, viewport: S.page.getViewport({scale: v.s * dpr}), transform: [1, 0, 0, 1, v.tx * dpr, v.ty * dpr]}));
    S.renderTask = task;
    try { await task.promise; } catch (e) { return; }
    if (S.renderTask !== task) return;
    await overlayCmp(ctx, w, h, v.s * dpr, v.tx * dpr, v.ty * dpr);
    if (S.renderTask !== task) return;
    S.renderTask = null;
    c.width = w; c.height = h; c.style.width = st.clientWidth + "px"; c.style.height = st.clientHeight + "px";
    c.getContext("2d").drawImage(off, 0, 0);
    S.rendered = Object.assign({dpr}, v);
    applyView();
  }, now ? 0 : 140);
}
function applyView(){
  const v = S.view;
  if (S.low) { const k = v.s / S.low.s; $("low").style.transform = `translate(${v.tx}px,${v.ty}px) scale(${k})`; }
  const r = S.rendered, hi = $("hi");
  if (r) { const k = v.s / r.s; hi.style.transform = `translate(${v.tx - r.tx * k}px,${v.ty - r.ty * k}px) scale(${k})`; hi.style.display = Math.abs(k - 1) < 1e-9 || k > 0.25 ? "block" : "none"; }
  $("zoomPct").textContent = S.base ? Math.round(v.s * 100) + "%" : "—";
  if (cadOn()) cadHi(false);   // a CAD drawing follows every zoom / pan step at once
  draw(); miniUpdate();
}
function zoomAt(f, sx, sy){
  const v = S.view, ns = Math.max(0.05, Math.min(5000, v.s * f)); f = ns / v.s;
  S.view = {s: ns, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f};
  applyView(); renderHi();
}
const toScr = p => [p[0] * S.view.s + S.view.tx, p[1] * S.view.s + S.view.ty];
const toBase = (x, y) => [(x - S.view.tx) / S.view.s, (y - S.view.ty) / S.view.s];

/* ------------------------------------------------------------------ vector lines (snapping) and scale note */
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const app = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
async function indexPage(){
  const key = S.key, page = S.page, base = S.base, file = S.fileId, pageNo = S.pageNo, cpg = cadPage();
  if (cpg && !S.geo[key]) {   // an AutoCAD drawing: its lines and text come straight from its scene — no PDF to parse
    const ix = CAD.cadIndex(cpg), sc = S.cadSc[file], cfg = S.ocgs && S.ocgs[file], byName = new Map(), cell = 24, grid = new Map();
    if (cfg) Object.entries(cfg.getGroups()).forEach(([id, g]) => byName.set(g.name, id));
    ix.segs.forEach((s2, i) => { const x0 = Math.floor(Math.min(s2[0], s2[2]) / cell), x1 = Math.floor(Math.max(s2[0], s2[2]) / cell), y0 = Math.floor(Math.min(s2[1], s2[3]) / cell), y1 = Math.floor(Math.max(s2[1], s2[3]) / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + "," + y; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); } });
    S.geo[key] = {segs: ix.segs, grid, cell, images: 0, styles: ix.styles, layerIds: sc.layers.map(l => byName.get(l.name) || null), file, cad: true};
    if (!S.texts[key]) S.texts[key] = withOcr(key, ix.texts.map(t => ({s: normQ(t.s), x: t.x, y: t.y, w: t.w, h: t.h})));
  }
  if (!S.geo[key]) {
    busy("Reading drawing lines…");
    try {
      const ops = await page.getOperatorList(), O = pdfjs.OPS, segs = [], stack = [], styles = [], styleIx = new Map();
      let ctm = base.transform.slice(), images = 0, lw = 1, dash = false, sCol = "0,0,0", fCol = "0,0,0", sp = 0, pend = -1, pendCtm = ctm, cur = null, start = null;
      const mc = [], layerIds = [], layerIx = new Map(); let lay0 = -1;   // PDF layers (optional content): the layer each line is drawn on
      const curLayer = () => { for (let j = mc.length - 1; j >= 0; j--) if (mc[j] >= 0) return mc[j]; return -1; };
      const push = (a, b, fl) => { if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.05 && segs.length < 600000) segs.push([a[0], a[1], b[0], b[1], fl || 0, sp, -1, lay0]); };
      const colKey = a => typeof a[0] === "string" ? a[0] : Array.from(a || []).slice(0, 3).map(v => Math.round(v)).join(",");
      const style = (col, w) => { const key = col + "|" + (Math.round(w * 10) / 10); let i = styleIx.get(key); if (i == null) { i = styles.length; styles.push(key); styleIx.set(key, i); } return i; };
      const paint = (stroke, fill) => {   // the paint operator after a path says how its lines were drawn (stroked, filled, or only a clip)
        if (pend < 0) return;
        const st = style(stroke ? sCol : fCol, stroke ? lw * Math.sqrt(Math.abs(pendCtm[0] * pendCtm[3] - pendCtm[1] * pendCtm[2])) : 0);
        for (let i = pend; i < segs.length; i++) { const s = segs[i]; s[6] = st; if (!stroke && !fill) s[4] |= 8; else if (!stroke) s[4] |= 4; if (stroke && dash) s[4] |= 2; }
        pend = -1;
      };
      const PAINT = new Map([[O.stroke, [1, 0]], [O.closeStroke, [1, 0]], [O.fill, [0, 1]], [O.eoFill, [0, 1]], [O.fillStroke, [1, 1]], [O.eoFillStroke, [1, 1]],
        [O.closeFillStroke, [1, 1]], [O.closeEOFillStroke, [1, 1]], [O.endPath, [0, 0]]]);
      const gs = () => ({ctm, lw, dash, sCol, fCol});
      const setGs = g => { if (g) ({ctm, lw, dash, sCol, fCol} = g); };
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], ar = ops.argsArray[i];
        if (fn === O.beginMarkedContentProps) { let li = -1; const pr = ar && ar[1]; const id = ar && ar[0] === "OC" && pr ? (typeof pr === "string" ? pr : pr.id || (pr.ids && pr.ids[0])) : null;
          if (id) { li = layerIx.get(id); if (li == null) { li = layerIds.length; layerIds.push(id); layerIx.set(id, li); } } mc.push(li); lay0 = curLayer(); }
        else if (fn === O.beginMarkedContent) mc.push(-1);
        else if (fn === O.endMarkedContent) { mc.pop(); lay0 = curLayer(); }
        else if (fn === O.save) stack.push(gs());
        else if (fn === O.restore) setGs(stack.pop());
        else if (fn === O.transform) ctm = mul(ctm, ar);
        else if (fn === O.paintFormXObjectBegin) { stack.push(gs()); if (ar[0]) ctm = mul(ctm, ar[0]); }
        else if (fn === O.paintFormXObjectEnd) setGs(stack.pop());
        else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) images++;
        else if (fn === O.setLineWidth) lw = +ar[0] || 0;
        else if (fn === O.setDash) dash = Array.isArray(ar[0]) && ar[0].some(v => v > 0);
        else if (fn === O.setStrokeRGBColor) sCol = colKey(ar);
        else if (fn === O.setFillRGBColor) fCol = colKey(ar);
        else if (fn === O.setGState) (ar[0] || []).forEach(([k, v]) => { if (k === "LW") lw = +v || 0; else if (k === "D") dash = !!(v && Array.isArray(v[0]) && v[0].some(x => x > 0)); });
        else if (PAINT.has(fn)) { const [st, fi] = PAINT.get(fn); if ((fn === O.closeStroke || fn === O.closeFillStroke || fn === O.closeEOFillStroke) && cur && start) push(cur, start); paint(st, fi); }
        else if (fn === O.constructPath) {
          const [po, c] = ar; let k = 0;
          if (pend < 0) { pend = segs.length; pendCtm = ctm; }
          for (const op of po) {
            if (op === O.moveTo) { sp++; cur = start = app(ctm, c[k++], c[k++]); }
            else if (op === O.lineTo) { const p = app(ctm, c[k++], c[k++]); if (cur) push(cur, p); cur = p; }
            else if (op === O.rectangle) { sp++; const x = c[k++], y = c[k++], w = c[k++], h = c[k++]; const q = [app(ctm, x, y), app(ctm, x + w, y), app(ctm, x + w, y + h), app(ctm, x, y + h)];
              push(q[0], q[1]); push(q[1], q[2]); push(q[2], q[3]); push(q[3], q[0]); cur = start = q[0]; }
            else if (op === O.curveTo || op === O.curveTo2 || op === O.curveTo3) {
              let p1, p2, p3;
              if (op === O.curveTo) { p1 = [c[k++], c[k++]]; p2 = [c[k++], c[k++]]; p3 = [c[k++], c[k++]]; }
              else if (op === O.curveTo2) { p2 = [c[k++], c[k++]]; p3 = [c[k++], c[k++]]; p1 = null; }
              else { p1 = [c[k++], c[k++]]; p3 = [c[k++], c[k++]]; p2 = null; }
              if (!cur) continue;
              const P0 = cur, P1 = p1 ? app(ctm, p1[0], p1[1]) : P0, P3 = app(ctm, p3[0], p3[1]), P2 = p2 ? app(ctm, p2[0], p2[1]) : P3;
              let prev = P0;
              for (let t = 1; t <= 8; t++) { const u = t / 8, a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, cc = 3 * u * u * (1 - u), d = u ** 3;
                const q = [a * P0[0] + b * P1[0] + cc * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + cc * P2[1] + d * P3[1]]; push(prev, q, 1); prev = q; }
              cur = P3;
            }
            else if (op === O.closePath) { if (cur && start) push(cur, start); cur = start; }
          }
        }
      }
      const cell = 24, grid = new Map();
      segs.forEach((s, i) => {
        const x0 = Math.floor(Math.min(s[0], s[2]) / cell), x1 = Math.floor(Math.max(s[0], s[2]) / cell), y0 = Math.floor(Math.min(s[1], s[3]) / cell), y1 = Math.floor(Math.max(s[1], s[3]) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return;   // page borders / hatch fills are not useful snap targets at this cost
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + "," + y; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); }
      });
      S.geo[key] = {segs, grid, cell, images, styles, layerIds, file};
    } catch (e) { S.geo[key] = {segs: [], grid: new Map(), cell: 24, images: 0, styles: [], err: String(e)}; }
    busy("");
  }
  if (!S.texts[key]) {
    try {
      const tc = await page.getTextContent();
      S.texts[key] = withOcr(key, tc.items.filter(t => t.str && t.str.trim()).map(t => { const p = base.convertToViewportPoint(t.transform[4], t.transform[5]); return {s: normQ(t.str), x: p[0], y: p[1], w: (t.width || 0) * Math.hypot(base.transform[0], base.transform[1]), h: Math.hypot(t.transform[2], t.transform[3]) || 6}; }));
    } catch (e) { S.texts[key] = withOcr(key, []); }
  }
  if (key === S.key && P.proj && !P.proj.scales[key]) {   // a scale saved in the PDF first, then a scale note in its text
    let V = []; try { V = await pdfScalesOn(file, pageNo, base); } catch (e) {}
    if (key === S.key && !P.proj.scales[key] && V.length) { const r = applyPdfScales(key, V); save();
      toast(keyName(key) + ": " + (r.main ? "scale saved in the PDF, " + r.main.label : "no page scale in the PDF") + (r.vps ? " · " + r.vps + " viewport" + (r.vps > 1 ? "s" : "") + " at another scale" : "") + " — check it against a known dimension (scale chip → Verify)", 5200);
      if (r.main) checkScale(key, !S.agentRun); }
  }
  if (key === S.key && P.proj && !P.proj.scales[key]) {
    const c = scaleCandidates(key);
    if (c.length) { P.proj.scales[key] = {ptPerFt: c[0].ptPerFt, how: "note", text: c[0].text, note: c[0].note || "", factor: c[0].factor || 1, verified: false, at: new Date().toISOString()}; save(); toast(keyName(key) + ": scale read from the drawing, " + c[0].label + " — check it against a known dimension (scale chip → Verify)", 5200);
      checkScale(key, !S.agentRun); }   // (an agent working through the pages checks it itself, with no dialog in its way)
  }
  if (key === S.key && P.proj && (P.proj.scales[key] || {}).how === "cad") cadUnitsCheck(key);
  if (key === S.key) refresh();
}
/* ------------------------------------------------------------------ scale check: the room sizes written on the drawing
   (BEDROOM 12'-9"x11'-0") against the room as drawn. From each room's name the clear span to the walls is found left,
   right, up and down (rays against the PDF's own lines, from three points, the middle span kept, so a door opening or a
   bed in the way of one does not count); span ÷ written size gives pt per ft for that room, the median of all rooms the drawing's scale. A note that
   disagrees by more than 15 % is flagged: the PDF is then printed at another size than the note was written for. */
function sizeDims(t){ const m = /^\s*([^xX×*]+?)\s*[xX×*]\s*([^xX×*]+?)\s*$/.exec(String(t || "")); if (!m) return null; const a = parseFt(m[1]), b = parseFt(m[2]); return a > 0 && b > 0 ? [a, b] : null; }
async function scaleFromRooms(key){
  const [f, pg] = key.split(":"), g = S.geo[key]; if (!g || !g.segs.length) return null;
  const F = await drawingFacts(f, +pg), est = [], bf = segRoleFilter(g, BOUND);   // walls / openings / columns only, when the PDF has layers: a bed or a table is not the room's edge
  const ray = (c, dx, dy, R) => {   // distance from c to the first drawing line along (dx, dy), up to R
    let best = R; segsIn(g, c[0] - (dx < 0 ? R : 0), c[1] - (dy < 0 ? R : 0), c[0] + (dx > 0 ? R : 0), c[1] + (dy > 0 ? R : 0)).forEach(i => { const s = g.segs[i]; if (s[4] & 9 || (bf && !bf(i))) return;   // (curves — door swings — are not the room's edge)
      if (dy === 0) { const y0 = Math.min(s[1], s[3]), y1 = Math.max(s[1], s[3]); if (c[1] < y0 || c[1] > y1 || y1 === y0) return; const x = s[0] + (s[2] - s[0]) * (c[1] - s[1]) / (s[3] - s[1]), d = (x - c[0]) * dx; if (d > 0.5 && d < best) best = d; }
      else { const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]); if (c[0] < x0 || c[0] > x1 || x1 === x0) return; const y = s[1] + (s[3] - s[1]) * (c[0] - s[0]) / (s[2] - s[0]), d = (y - c[1]) * dy; if (d > 0.5 && d < best) best = d; } });
    return best; };
  F.rooms.forEach(r => {
    const d = sizeDims(r.size); if (!d || d[0] < 4 || d[1] < 4) return;
    const R = 40 * r.h * Math.max(d[0], d[1]) / 10, c = [r.x + r.w / 2, r.y - r.h / 2], below = r.sizeY != null ? r.sizeY + r.h * 0.6 : r.y + r.h * 1.5;
    // seven parallel rays each way (across: at seven heights round the name; up and down: at seven places side by side); the
    // span most of them agree on (within 1 %) is the room's: a ray through a door or one blocked by a bed disagrees with the rest
    const mid = [c[0], (c[1] + below) / 2];
    const span = (dx, dy) => { const st = dy ? Math.max(r.w * 0.35, 1.5 * r.h) : 1.2 * r.h, v = [];
      for (let j = -3; j <= 3; j++) { const q = dy ? [mid[0] + j * st, mid[1]] : [mid[0], mid[1] + j * st]; v.push(ray(q, dx, dy, R) + ray(q, -dx, -dy, R)); }
      let best = null; v.forEach(a => { const n = v.filter(b => Math.abs(b / a - 1) < 0.01).length; if (!best || n > best.n || (n === best.n && a < best.a)) best = {a, n}; });
      return best.n >= 2 ? v.filter(b => Math.abs(b / best.a - 1) < 0.01).reduce((t, b) => t + b, 0) / best.n : 2 * R; };
    const w = span(1, 0), h = span(0, 1); if (!(w < 2 * R && h < 2 * R)) return;
    const a = [w / d[0], h / d[1]], b = [w / d[1], h / d[0]], A = Math.abs(Math.log(a[0] / a[1])), B = Math.abs(Math.log(b[0] / b[1]));
    const pr = A <= B ? a : b; if (Math.min(A, B) > 0.22) return;
    est.push(Math.sqrt(pr[0] * pr[1]));
  });
  if (est.length < 3) return null;
  est.sort((x, y) => x - y); const med = est[est.length >> 1], agree = est.filter(v => Math.abs(v / med - 1) < 0.1).length;
  if (agree < 3 || agree < est.length / 4) return null;   // written sizes too scattered to say anything
  return {ptPerFt: med, rooms: est.length, agree, est};
}
const STD_SCALES = [[1 / 32, "1/32\""], [1 / 16, "1/16\""], [3 / 32, "3/32\""], [1 / 8, "1/8\""], [3 / 16, "3/16\""], [1 / 4, "1/4\""], [3 / 8, "3/8\""], [1 / 2, "1/2\""], [3 / 4, "3/4\""], [1, "1\""], [1.5, "1-1/2\""], [3, "3\""]]
  .map(([v, t]) => ({ptPerFt: 72 * v, label: t + " = 1'-0\""})).concat([20, 25, 50, 75, 100, 125, 150, 200, 250, 500].map(n => ({ptPerFt: 864 / n, label: "1:" + n})));
async function checkScale(key, ask2){
  const sc = P.proj && P.proj.scales[key]; if (!sc || sc.verified || sc.how === "calibrated") return null;
  let ev; try { ev = await scaleFromRooms(key); } catch (e) { ev = null; }
  if (!ev || ev.agree < 3) return null;
  const r = ev.ptPerFt / sc.ptPerFt; if (Math.abs(Math.log(r)) < Math.log(1.15)) { if (sc.doubt) { delete sc.doubt; save(); refresh(); } return {ok: true, ev}; }
  // the standard scale most rooms agree with (within 3 %), then the one nearest the median — not just the nearest: a median
  // pulled a little by furniture can sit closer to 1:50 than to the 1/4" the rooms are drawn at
  const votes = x => ev.est.filter(v => Math.abs(v / x.ptPerFt - 1) < 0.03).length;
  const std = STD_SCALES.slice().sort((a, b) => votes(b) - votes(a) || Math.abs(Math.log(a.ptPerFt / ev.ptPerFt)) - Math.abs(Math.log(b.ptPerFt / ev.ptPerFt)))[0];
  // the rooms' median, then: a standard scale within 2.5 %; else the walls (drawn exactly 4.5" / 9" / 13.5") within 4 %; else the median
  const isStd = Math.abs(Math.log(std.ptPerFt / ev.ptPerFt)) < Math.log(1.025) || votes(std) >= Math.max(3, ev.est.length / 2), wl = isStd ? null : wallScale(key, ev.ptPerFt);
  const sug = isStd ? std : wl && Math.abs(Math.log(wl.ptPerFt / ev.ptPerFt)) < Math.log(1.04) ? wl : {ptPerFt: ev.ptPerFt, label: "1 ft = " + ev.ptPerFt.toFixed(3) + " pt"};
  ev.agree = ev.est.filter(v => Math.abs(v / sug.ptPerFt - 1) < 0.1).length;
  sc.doubt = {label: sug.label, ptPerFt: sug.ptPerFt, ratio: +(sug.ptPerFt / sc.ptPerFt).toFixed(3), rooms: ev.rooms, agree: ev.agree}; save(); refresh();
  if (ask2 && key === S.key && !$("dlgBack").classList.contains("on")) {   // (a dialog already open is not cancelled for this: the chip shows the doubt)
    const pv = ask("Scale note does not match the drawing", `<p>The note says <b>${esc(sc.text)}</b>, but <b>${ev.agree} of ${ev.rooms}</b> room sizes written on this drawing${sug.walls ? ` and its ${esc(sug.walls)} walls` : ""} measure at <b>${esc(sug.label)}</b> — <b>× ${(sug.ptPerFt / sc.ptPerFt).toFixed(2)}</b> of the note. The PDF is printed at another size than the note was written for; at the note's scale every length would come out × ${(sug.ptPerFt / sc.ptPerFt).toFixed(2)} and every area × ${((sug.ptPerFt / sc.ptPerFt) ** 2).toFixed(2)} of the truth.</p>
      <p class="small" style="margin-top:8px"><b>Then verify it with one dimension printed on the drawing</b> (scale chip → Verify) — written room sizes are nominal, so this is an estimate, not a certainty. Nothing is measured until the scale is settled.</p>`, "Use " + sug.label);
    const cb = document.createElement("button"); cb.className = "btn"; cb.textContent = "Calibrate from a dimension…"; cb.style.marginRight = "auto";
    let cal = false; cb.onclick = () => { cal = true; $("dlgCancel").click(); }; $("dlgF").prepend(cb);
    const v = await pv;
    if (cal) { S.calVp = null; setTool("cal"); toast("Click both ends of a dimension printed on the drawing, then type its length", 5000); return {ok: false, ev, sug}; }
    if (v) mutate(() => { P.proj.scales[key] = {ptPerFt: sug.ptPerFt, how: "note", text: sug.label + " (measured from " + ev.agree + " written room sizes" + (sug.walls ? " and the " + sug.walls + " walls" : "") + "; the note says " + sc.text + ")", note: "PDF printed at × " + (sug.ptPerFt / sc.ptPerFt).toFixed(3) + " of the note's paper size", factor: sug.ptPerFt / sc.ptPerFt, verified: false, roomsCheck: ev, at: new Date().toISOString()}; });
  }
  return {ok: false, ev, sug};
}
/* the scale from the walls: the most-drawn spacing of parallel wall faces (wall layers when the PDF has them) is a
   4.5", 9" or 13.5" wall; the one of those that the room-size estimate est agrees with (within 10 %) gives the scale. */
function wallScale(key, est){
  const g = S.geo[key]; if (!g || !g.segs.length || !est) return null;
  const wf = segRoleFilter(g, new Set(["wall"])), ids = g.segs.map((_, i) => i).filter(i => !wf || wf(i)), G = faceLines(null, est, ids); if (!G) return null;
  const H = new Map(); G.forEach(gr => facePairs(gr, 0.25 * est, 1.6 * est, 1.5 * est, (d, o, t0, t1) => { const b = Math.round(d * 4); H.set(b, (H.get(b) || 0) + (t1 - t0)); }));
  const peaks = [...H.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); if (!peaks.length) return null;
  let best = null;
  peaks.forEach(([b, len]) => { const d = b / 4; [[0.375, "4.5\""], [0.75, "9\""], [1.125, "13.5\""]].forEach(([ft, nm]) => { const c = d / ft, e = Math.abs(Math.log(c / est));
    if (e < Math.log(1.1) && (!best || len > best.len || (len === best.len && e < best.e))) best = {c, e, len, nm, d}; }); });
  if (!best) return null;
  const std = STD_SCALES.find(x => Math.abs(x.ptPerFt / best.c - 1) < 0.01);
  return {ptPerFt: std ? std.ptPerFt : best.c, label: std ? std.label : "1 ft = " + best.c.toFixed(3) + " pt", walls: best.nm};
}
const scaleDoubt = () => { const sc = P.proj && P.proj.scales[S.key]; return sc && sc.doubt && !sc.verified ? sc.doubt : null; };

/* scale notes on the page: 1/8" = 1'-0", 3/16"=1'-0", 1" = 20', 1:100 (with "@ A1" paper size if given) */
const ISO = {A0: 3370.39, A1: 2383.94, A2: 1683.78, A3: 1190.55, A4: 841.89};
/* paper sizes a drawing may be drawn for (long side in pt): ISO A and ARCH / ANSI */
const PAPER = Object.assign({}, ISO, {"ARCH C 18×24 in": 1728, "ARCH D 24×36 in": 2592, "ARCH E 36×48 in": 3456, "ANSI C 17×22 in": 1584, "ANSI D 22×34 in": 2448, "ANSI E 34×44 in": 3168});
const MAN_SCALES = [["Architectural (inch = foot)", ["3/32\" = 1'-0\"", "1/8\" = 1'-0\"", "3/16\" = 1'-0\"", "1/4\" = 1'-0\"", "3/8\" = 1'-0\"", "1/2\" = 1'-0\"", "3/4\" = 1'-0\"", "1\" = 1'-0\"", "1-1/2\" = 1'-0\"", "3\" = 1'-0\"", "1/16\" = 1'-0\"", "1/32\" = 1'-0\""]],
  ["Engineering (1 inch = feet)", ["1\" = 10'", "1\" = 20'", "1\" = 30'", "1\" = 40'", "1\" = 50'", "1\" = 60'", "1\" = 100'"]],
  ["Metric (ratio)", ["1:20", "1:25", "1:50", "1:75", "1:100", "1:125", "1:150", "1:200", "1:250", "1:500", "1:1000"]]];   // ISO 216 long side in pt (A1 594 × 841 → 841 / 25.4 × 72)
/* "1/8\" = 1'-0\"", "1\" = 20'", "1:100" -> inches on paper per foot (0 if none). loose: a bare 1:N counts */
function inPerFtOf(raw, loose){
  const s = vulgar(String(raw || "")).replace(/[’′]/g, "'").replace(/[”″“]/g, '"');
  let m;
  // 1/8" = 1'-0" · 1 1/2" = 1'-0" · 1-1/2" = 1'-0" (a mixed number written with a hyphen is 1½", not ½")
  if ((m = /(\d+\s*-\s*\d+\/\d+|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*"\s*=\s*1\s*'\s*-?\s*0?\s*"?/.exec(s))) {
    const t = m[1].trim(), q = /^(\d+)\s*[-\s]\s*(\d+)\/(\d+)$/.exec(t), f = /^(\d+)\/(\d+)$/.exec(t);
    const v = q ? +q[1] + +q[2] / +q[3] : f ? +f[1] / +f[2] : +t;
    if (v > 0 && isFinite(v)) return {v, label: m[0].replace(/\s+/g, " ").trim()};
  }
  if ((m = /\b1\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'/.exec(s))) return {v: 1 / +m[1], label: m[0]};
  if ((m = /(?:^|[^\d.:\/])1\s*:\s*(\d{1,4})(?![\d:])/.exec(s)) && (loose || /scale|^\s*1\s*:/i.test(s))) return {v: 12 / +m[1], label: "1:" + m[1]};
  return {v: 0, label: ""};
}
function scaleCandidates(key){
  const T = S.texts[key] || [], out = [], seen = {};
  const sz = key === S.key && S.base ? [S.base.width, S.base.height] : (S.sizes || {})[key], longPt = sz ? Math.max(sz[0], sz[1]) : 0;   // that page's own size (the "@ A1" correction)
  const lines = T.map(t => t.s).concat(T.map((t, i) => T[i + 1] && Math.abs(T[i + 1].y - t.y) < 3 ? t.s + " " + T[i + 1].s : "")).filter(Boolean);
  for (const raw of lines) {
    const s = raw.replace(/[’′]/g, "'").replace(/[”″“]/g, '"');
    const sc = inPerFtOf(s), inPerFt = sc.v, label = sc.label;
    if (!inPerFt || inPerFt > 12) continue;
    let ptPerFt = 72 * inPerFt, note = "", factor = 1;
    const a = /@\s*(A[0-4])\b/i.exec(s);
    if (a && longPt) { const k = longPt / ISO[a[1].toUpperCase()]; if (Math.abs(k - 1) > 0.02) { ptPerFt *= k; factor = k; note = "drawn for " + a[1].toUpperCase() + ", this PDF page is " + (k < 1 ? "reduced" : "enlarged") + " × " + k.toFixed(3); } }
    const id = ptPerFt.toFixed(4); if (seen[id]) continue; seen[id] = 1;
    out.push({ptPerFt, label, text: raw.trim(), note, factor});
  }
  return out.sort((x, y) => (/scale/i.test(y.text) ? 1 : 0) - (/scale/i.test(x.text) ? 1 : 0));
}
/* ------------------------------------------------------------------ scale saved in the PDF itself
   Bluebeam, Acrobat and other PDF tools keep a page's calibration in the page's /VP entries: a box on the page with a
   /Measure dictionary whose first number format says how many real units one PDF point is (/C) and in what unit (/U).
   Read once per PDF with pdf-lib (only when the file can hold one); the box is put on this app's page by pdf.js.
   Geographic measures, pages with a /UserUnit and units not known here are left alone. Such a scale is exact for the
   page as printed, but it is still only "from the PDF" — not verified until a known dimension is measured. */
const FT_PER = [[/^(ft|feet|foot|')$/, 1], [/^(in|inch|inches|")$/, 1 / 12], [/^mm$/, 1 / 304.8], [/^cm$/, 1 / 30.48], [/^(m|meter|meters|metre|metres)$/, 1 / 0.3048], [/^(yd|yard|yards)$/, 3], [/^km$/, 1000 / 0.3048]];
function bytesHave(b, s){ const c = [...s].map(x => x.charCodeAt(0)), n = c.length; outer: for (let i = 0; i + n <= b.length; i++) { if (b[i] !== c[0]) continue; for (let j = 1; j < n; j++) if (b[i + j] !== c[j]) continue outer; return true; } return false; }
function pdfVpRead(fileId){   // -> {pageNo: [{bbox, ptPerFt, label, name}]}; {} when the PDF has none or cannot be read
  S.pdfVp = S.pdfVp || {};
  return S.pdfVp[fileId] = S.pdfVp[fileId] || (async () => {
    const out = {};
    try {
      const rec = await dbGet("pdfs", fileId); if (!rec) return out;
      const raw = new Uint8Array(rec.data.slice(0));
      if (!bytesHave(raw, "/VP") && !bytesHave(raw, "/ObjStm")) return out;   // no viewport anywhere (and none hidden in a compressed object stream)
      const L = await loadPdfLib(), d = await L.PDFDocument.load(raw, {ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: 1500});
      const N = n => L.PDFName.of(n), num = o => o instanceof L.PDFNumber ? o.asNumber() : NaN, txt = o => { try { return o && o.decodeText ? o.decodeText() : ""; } catch (e) { return ""; } };
      d.getPages().forEach((pg, i) => {
        const node = pg.node, vp = node.lookup(N("VP")); if (!(vp instanceof L.PDFArray)) return;
        const uu = node.lookup(N("UserUnit")); if (uu && num(uu) !== 1) return;
        const list = [];
        for (let j = 0; j < vp.size(); j++) {
          const v = vp.lookup(j); if (!(v instanceof L.PDFDict)) continue;
          const m = v.lookup(N("Measure")); if (!(m instanceof L.PDFDict)) continue;
          const sub = m.lookup(N("Subtype")); if (sub && String(sub) !== "/RL") continue;
          const X = m.lookup(N("X")); if (!(X instanceof L.PDFArray) || !X.size()) continue;
          const f0 = X.lookup(0); if (!(f0 instanceof L.PDFDict)) continue;
          const C = num(f0.lookup(N("C"))), U = txt(f0.lookup(N("U"))).trim().toLowerCase(), u = FT_PER.find(([re]) => re.test(U));
          if (!(C > 0) || !u) continue;
          const ptPerFt = 1 / (C * u[1]); if (!(ptPerFt > 0.01 && ptPerFt < 900)) continue;
          const bb = v.lookup(N("BBox")), box = bb instanceof L.PDFArray && bb.size() === 4 ? [0, 1, 2, 3].map(k => num(bb.lookup(k))) : null;
          list.push({bbox: box && box.every(isFinite) ? box : null, ptPerFt, label: txt(m.lookup(N("R"))).trim(), name: txt(v.lookup(N("Name"))).trim()});
        }
        if (list.length) out[i + 1] = list;
      });
    } catch (e) { /* encrypted or unreadable — no scale from the PDF */ }
    return out;
  })();
}
async function pdfScalesOn(fileId, pageNo, base){   // that page's saved scales on the page (pt, y down), largest box first
  const L = (await pdfVpRead(fileId))[pageNo]; if (!L || !base) return [];
  const W = base.width, H = base.height;
  return L.map(v => { let r = v.bbox ? base.convertToViewportRectangle(v.bbox) : [0, 0, W, H];
    r = [Math.max(0, Math.min(r[0], r[2])), Math.max(0, Math.min(r[1], r[3])), Math.min(W, Math.max(r[0], r[2])), Math.min(H, Math.max(r[1], r[3]))];
    const share = Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]) / (W * H);
    return Object.assign({}, v, {r, share, label: v.label || "1 ft = " + v.ptPerFt.toFixed(3) + " pt"}); }).filter(v => v.share > 0).sort((a, b) => b.share - a.share);
}
/* a box covering a quarter of the sheet or more gives the page's scale; boxes at another scale become viewports (only on
   a page with none yet) */
function applyPdfScales(key, V){
  const now = new Date().toISOString(), main = V.find(v => v.share >= 0.25) || null;
  const vps = V.filter(v => v !== main && (!main || Math.abs(v.ptPerFt - main.ptPerFt) / main.ptPerFt > 0.005));
  if (main) P.proj.scales[key] = {ptPerFt: main.ptPerFt, how: "pdf", text: main.label, note: "scale saved in the PDF" + (main.name ? " (viewport “" + main.name + "”)" : ""), factor: 1, verified: false, at: now};
  const add = vps.length && !(P.proj.viewports[key] || []).length;
  if (add) P.proj.viewports[key] = vps.map((v, i) => ({id: uid("V"), name: v.name || "PDF viewport " + (i + 1), r: v.r, ptPerFt: v.ptPerFt, text: v.label + " · saved in the PDF"}));
  return {main, vps: add ? vps.length : 0};
}

function cornerDeg(a, b, c){   // the angle at b between a and c, 0–180°
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]], m = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  return m ? Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / m))) * 180 / Math.PI : 0;
}
function snapAt(q, ex){   // ex(item, i): points of the drawing's own takeoff to leave out (what is being dragged)
  const g = S.geo[S.key], r = SNAP_PX / S.view.s;
  let best = null;
  const take = (p, type, pri) => { const d = dist(p, q); if (d <= r && (!best || pri < best.pri || (pri === best.pri && d < best.d))) best = {p, type, pri, d}; };
  // points already measured rank with the drawing's endpoints (nearest wins); of the shape being drawn only its first
  // point is a target (closing an area) — never the last one, which would make a zero-length run
  (P.proj.items || []).forEach(it => { if (it.file === S.fileId && it.page === S.pageNo && !hiddenItem(it)) it.pts.forEach((p, i) => { if (!ex || !ex(it, i)) take(p, "point", 1); }); });
  if (S.draft.length >= 2 && isAreaDraft()) take(S.draft[0], "first point", 0);
  if ($("snapOn").checked && g && g.segs.length) {
    const c = g.cell, x0 = Math.floor((q[0] - r) / c), x1 = Math.floor((q[0] + r) / c), y0 = Math.floor((q[1] - r) / c), y1 = Math.floor((q[1] + r) / c), ids = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (g.grid.get(x + "," + y) || []).forEach(i => ids.add(i));
    const near = [];
    ids.forEach(i => { const s = g.segs[i], a = [s[0], s[1]], b = [s[2], s[3]]; if (distSeg(q, a, b) <= r) near.push([a, b]); });
    const K = snapKinds(), from = S.drag ? null : S.draft[S.draft.length - 1];
    if (K.endpoint) near.forEach(([a, b]) => { take(a, "endpoint", 1); take(b, "endpoint", 1); });
    if (K.intersection && near.length < 80) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) { const x = segX(near[i][0], near[i][1], near[j][0], near[j][1]); if (x) take(x, "intersection", 1); }
    if (K.midpoint) near.forEach(([a, b]) => take([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], "midpoint", 2));
    if (K.perpendicular && from && near.length < 80) near.forEach(([a, b]) => { const f = projSeg(from, a, b), t = dist(f, a) + dist(f, b); if (Math.abs(t - dist(a, b)) < 1e-6 && dist(f, from) > 1e-6) take(f, "perpendicular", 2.5); });   // the foot of the perpendicular from the last point, on the segment itself
    if (K.nearest) near.forEach(([a, b]) => take(projSeg(q, a, b), "on line", 3));
  }
  return best;
}

/* ------------------------------------------------------------------ auto area: one click inside a room
   The room is found from the drawing's own vector lines. Lines that do not bound a room are left out first: door swings
   (curves, or short-segment arcs) with their leaves, dashed lines, clip paths and short strokes (text, hatch). The rest
   are drawn on a raster widened to the door gap, so door openings close, and the space is flood-filled from the click
   (the room's core). The core is grown back out over the thin lines to the wall faces, pockets narrower than the
   furniture setting are filled (furniture against a wall), and the outline is traced, squared up when the room is
   rectilinear (the bulge through a door opening is dropped there) and snapped onto the wall lines. */
const AUTO_DEF = {src: "image", gap: 4, minLen: 0.5, pocket: 7, skipDoors: true, dashBound: true, wall: null, show: false, layers: true};
const autoOpt = () => Object.assign({}, AUTO_DEF, (P.proj && P.proj.auto) || {});
function segsIn(g, x0, y0, x1, y1){   // lines in a box — not those on PDF layers switched off
  const c = g.cell, ids = new Set(), off = layerOffIx(g);
  for (let x = Math.floor(x0 / c); x <= Math.floor(x1 / c); x++) for (let y = Math.floor(y0 / c); y <= Math.floor(y1 / c); y++) (g.grid.get(x + "," + y) || []).forEach(i => { if (!off || !off.has(g.segs[i][7])) ids.add(i); });
  return [...ids].sort((a, b) => a - b);
}
function layerOffIx(g){   // layer indexes (of this page's lines) switched off by the user
  const cfg = g && g.file && S.ocgs && S.ocgs[g.file]; if (!cfg || !g.layerIds || !g.layerIds.length) return null;
  const off = new Set(); g.layerIds.forEach((id, i) => { try { if (!ocOn(cfg, id)) off.add(i); } catch (e) {} }); return off.size ? off : null;
}
function doorSymbols(g, ids, k){   // -> Set of segment ids that are door swings or door leaves
  const skip = new Set(), arcs = [], G = g.segs, len = i => Math.hypot(G[i][2] - G[i][0], G[i][3] - G[i][1]);
  const chains = []; let ch = null;
  ids.forEach(i => { const s = G[i], p = ch && G[ch[ch.length - 1]];
    if (p && p[5] === s[5] && (p[4] & 1) === (s[4] & 1) && Math.abs(p[2] - s[0]) + Math.abs(p[3] - s[1]) < 0.01) ch.push(i); else chains.push(ch = [i]); });
  chains.forEach(c => {
    const a = G[c[0]], b = G[c[c.length - 1]], A = [a[0], a[1]], B = [b[2], b[3]];
    let arc = (a[4] & 1) === 1;
    if (!arc && c.length >= 4) {   // a curve exported as many short straight pieces turning one way
      const tot = c.reduce((t, i) => t + len(i), 0); let turn = 0, sign = 0, ok = tot > 0.8 * k && tot < 15 * k && c.every(i => len(i) < 0.35 * tot);
      for (let j = 1; j < c.length && ok; j++) { const p = G[c[j - 1]], q = G[c[j]];
        let t = Math.atan2(q[3] - q[1], q[2] - q[0]) - Math.atan2(p[3] - p[1], p[2] - p[0]); while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI;
        if (Math.abs(t) > 0.6 || Math.abs(t) < 0.004 || (sign && Math.sign(t) !== sign)) ok = false; sign = Math.sign(t); turn += Math.abs(t); }
      arc = ok && turn > 0.7;
    }
    if (arc && !swingLike(c, A, B)) arc = false;   // a round room, a curved wall: a wall, not a door swing
    if (arc) { c.forEach(i => skip.add(i)); if (dist(A, B) > 0.8 * k) { const mi = G[c[Math.floor(c.length / 2)]]; arcs.push([A, B, [mi[0], mi[1]]]); } }
  });
  /* a door swing: a short curve, or a quarter turn or so (35°–120°) of radius 1.2–6.5 ft whose centre (the hinge) is the end
     of a straight line (the leaf, or the jamb). A whole circle, a long curved wall or an arc centred in the open is not. */
  function swingLike(c, A, B){
    const tot = c.reduce((t, i) => t + len(i), 0); if (tot <= 2 * k) return true;
    let turn = 0; for (let j = 1; j < c.length; j++) { const p = G[c[j - 1]], q = G[c[j]]; let t = Math.atan2(q[3] - q[1], q[2] - q[0]) - Math.atan2(p[3] - p[1], p[2] - p[0]); while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI; turn += t; }
    const sweep = Math.abs(turn) * c.length / Math.max(1, c.length - 1); if (sweep < 0.6 || sweep > 2.1) return false;
    const mi = G[c[Math.floor(c.length / 2)]], C = circumcentre(A, [mi[0], mi[1]], B); if (!C) return false;
    const Rr = (dist(C, A) + dist(C, B)) / 2; if (Rr < 1.2 * k || Rr > 6.5 * k) return false;
    const mine = new Set(c), r = 0.35 * k;
    return segsIn(g, C[0] - r, C[1] - r, C[0] + r, C[1] + r).some(i => !mine.has(i) && !(G[i][4] & 1) && (dist([G[i][0], G[i][1]], C) < r || dist([G[i][2], G[i][3]], C) < r));
  }
  // a door leaf runs from the hinge to one end of the swing, as long as the swing's radius (hinge to the other end)
  if (arcs.length) ids.forEach(i => {
    if (skip.has(i)) return; const s = G[i], p = [s[0], s[1]], q = [s[2], s[3]], L = dist(p, q);
    if (L < 1.2 * k || L > 7 * k) return;
    for (const [A, B] of arcs) for (const [tip, hinge] of [[p, q], [q, p]]) for (const [T, J] of [[A, B], [B, A]])
      if (dist(tip, T) < 0.35 * k && Math.abs(dist(hinge, J) - L) < 0.2 * L) { skip.add(i); return; }
  });
  // the door opening: from the swing's centre (hinge) to the end of the swing that lies on the wall face, i.e. the end
  // whose line has the wall continuing behind the hinge and beyond the jamb
  const lines = [], swings = [], wallNear = (pt, u) => ids.some(i => { if (skip.has(i)) return false; const s = G[i], l = Math.hypot(s[2] - s[0], s[3] - s[1]); if (l < 0.3 * k) return false;
    return Math.abs(u[0] * (s[3] - s[1]) - u[1] * (s[2] - s[0])) / l < 0.12 && distSeg(pt, [s[0], s[1]], [s[2], s[3]]) < 0.25 * k; });
  arcs.forEach(([A, B, M]) => {
    const C = circumcentre(A, M, B); if (!C) return;
    const R = (dist(C, A) + dist(C, B)) / 2; if (R < 1.2 * k || R > 6 * k) return;
    swings.push({C, R, A, B, M});
    const sc = X => { const u = [(X[0] - C[0]) / R, (X[1] - C[1]) / R]; return (wallNear([C[0] - u[0] * 0.5 * k, C[1] - u[1] * 0.5 * k], u) ? 1 : 0) + (wallNear([X[0] + u[0] * 0.5 * k, X[1] + u[1] * 0.5 * k], u) ? 1 : 0); };
    const a = sc(A), b = sc(B);
    if (a >= b) lines.push([C[0], C[1], A[0], A[1]]); if (b >= a) lines.push([C[0], C[1], B[0], B[1]]);
  });
  skip.lines = lines; skip.swings = swings;
  return skip;
}
function circumcentre(a, b, c){
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null;
  const A = a[0] * a[0] + a[1] * a[1], B = b[0] * b[0] + b[1] * b[1], C = c[0] * c[0] + c[1] * c[1];
  return [(A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d, (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d];
}
/* revision clouds: chains of six or more small arcs (each under 1.5 ft) joined end to end. Not walls — a cloud drawn
   across a room would otherwise split it, or close a bath onto the next room. Found once per page. */
function cloudIds(g, k){
  if (g.clouds && g.clouds.k === k) return g.clouds.set;
  const G = g.segs, sp = new Map();
  G.forEach((s, i) => { let e = sp.get(s[5]); if (!e) { e = {ids: [], curve: true, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9}; sp.set(s[5], e); }
    e.ids.push(i); if (!(s[4] & 1)) e.curve = false; e.x0 = Math.min(e.x0, s[0], s[2]); e.y0 = Math.min(e.y0, s[1], s[3]); e.x1 = Math.max(e.x1, s[0], s[2]); e.y1 = Math.max(e.y1, s[1], s[3]); });
  const arcs = [...sp.values()].filter(e => e.curve && Math.max(e.x1 - e.x0, e.y1 - e.y0) <= 1.5 * k), par = arcs.map((_, n) => n), at = new Map();
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  arcs.forEach((e, n) => { const a = G[e.ids[0]], z = G[e.ids[e.ids.length - 1]];
    [[a[0], a[1]], [z[2], z[3]]].forEach(([x, y]) => { const key = Math.round(x * 2) + "," + Math.round(y * 2); if (at.has(key)) par[find(n)] = find(at.get(key)); else at.set(key, n); }); });
  const cnt = new Map(); arcs.forEach((_, n) => cnt.set(find(n), (cnt.get(find(n)) || 0) + 1));
  const set = new Set(); arcs.forEach((e, n) => { if (cnt.get(find(n)) >= 6) e.ids.forEach(i => set.add(i)); });
  g.clouds = {k, set}; return set;
}
/* door openings closed at their jambs: from each end of a wall face (a line paired with another 0.25-1.6 ft away — a
   wall's two faces, hatched or thin-line partitions) the line is followed on; if it meets another wall or the next
   piece of the same face 1.2 ft to "close gaps" + 1 ft further, a line is drawn across there. That closes doors between
   two wall ends and doors beside a cross wall (a door in a corner), so a room never runs on through a doorway into the
   next room — on drawings whose door swings are dashed, or not drawn, nothing else closes the opening. */
function jambLines(ids, k, gapFt){
  const g = S.geo[S.key], G = faceLines(null, k, ids), out = []; if (!G || !g) return out;
  const gMin = 1.2 * k, gMax = (Math.max(gapFt, 3) + 1) * k, near = 0.15 * k;
  const segs = ids.map(i => g.segs[i]);
  const ray = (E, d) => {   // nearest line hit from E along d, beyond the lines E itself touches
    let best = Infinity;
    segsIn(g, Math.min(E[0], E[0] + d[0] * gMax) - 1, Math.min(E[1], E[1] + d[1] * gMax) - 1, Math.max(E[0], E[0] + d[0] * gMax) + 1, Math.max(E[1], E[1] + d[1] * gMax) + 1).forEach(i => {
      const s = g.segs[i]; if (s[4] & 9) return; const a = [s[0], s[1]], b = [s[2], s[3]];
      if (distSeg(E, a, b) < near) return;
      const r = [b[0] - a[0], b[1] - a[1]], den = d[0] * r[1] - d[1] * r[0]; if (Math.abs(den) < 1e-9) return;
      const t = ((a[0] - E[0]) * r[1] - (a[1] - E[1]) * r[0]) / den, u = ((a[0] - E[0]) * d[1] - (a[1] - E[1]) * d[0]) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t; });
    return best; };
  G.forEach(gr => {
    // hatching is not a wall face: skew lines (walls run square) unless long, and runs of 5+ overlapping parallels
    const axis = Math.min(Math.abs(gr.u[0]), Math.abs(gr.u[1])) < 0.035;
    const L = gr.L.slice().filter(l => axis || l.t1 - l.t0 >= 2.5 * k).sort((a, b) => a.o - b.o), wall = new Set();
    const ov = (a, b) => Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0) >= 0.5 * k;
    const hatch = new Set(L.filter((l, i) => { let n = 0; for (let j = 0; j < L.length && n < 4; j++) if (j !== i && Math.abs(L[j].o - l.o) <= 2.5 * k && Math.abs(L[j].o - l.o) > 0.03 * k && ov(l, L[j])) n++; return n >= 4; }));
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].o - L[i].o <= 1.6 * k; j++) {
      if (hatch.has(L[i]) || hatch.has(L[j])) continue;
      if (L[j].o - L[i].o < 0.25 * k) continue; if (ov(L[i], L[j])) { wall.add(L[i]); wall.add(L[j]); } }
    wall.forEach(l => [[l.t0, -1], [l.t1, 1]].forEach(([t, sg]) => {
      const E = [gr.u[0] * t + gr.n[0] * l.o, gr.u[1] * t + gr.n[1] * l.o], d = [gr.u[0] * sg, gr.u[1] * sg];
      // the next piece of the same face (no end cap drawn): collinear, so the ray cannot meet it
      let hit = ray(E, d);
      L.forEach(q => { if (q === l || Math.abs(q.o - l.o) > 0.03 * k) return; const gap = sg > 0 ? q.t0 - t : t - q.t1; if (gap > 0 && gap < hit) hit = gap; });
      if (hit >= gMin && hit <= gMax) out.push([E[0], E[1], E[0] + d[0] * hit, E[1] + d[1] * hit]);
    }));
  });
  return out;
}
/* room names (BEDROOM, BATH…) written in the window, as pixel masks: a space that has its own name is never taken
   into another room as a recess or pocket */
function labelMask(x0, y0, W, H, px, own){   // own: the name of the room being measured (not a reason to stop)
  const m = new Uint8Array(W * H), T = S.texts[S.key] || [];
  textLines(T).forEach(l => { if (l.tag || !ROOM_RX.test(l.s) || l.s.length > 32) return;
    if (own && dist(own, [l.x + l.w / 2, l.y - l.h / 2]) < Math.max(2, l.h)) return;
    const x = Math.round((l.x + l.w / 2 - x0) / px), y = Math.round((l.y - l.h / 2 - y0) / px), r = Math.max(2, Math.round(l.h / px / 2));
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) m[yy * W + xx] = 1; } });
  return m;
}
/* floor tile grids, stair treads, ramp lines: five or more parallel lines, 2 ft or longer, evenly spaced 0.4–3 ft apart and
   lying side by side — the pattern on a floor, not its walls. Found once per page. */
function hatchIds(g, k){
  if (g.hatchK && g.hatchK.k === k) return g.hatchK.set;
  const groups = new Map(), set = new Set();
  g.segs.forEach((s, i) => { if (s[4] & 9) return; const dx = s[2] - s[0], dy = s[3] - s[1], L = Math.hypot(dx, dy); if (L < 2 * k) return;
    let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI; if (a >= Math.PI - 0.0087) a -= Math.PI; const b = Math.round(a / 0.0175);
    let G = groups.get(b) || groups.get(b - 1) || groups.get(b + 1); if (!G) { G = {u: [Math.cos(a), Math.sin(a)], L: []}; groups.set(b, G); }
    const n = [-G.u[1], G.u[0]], t0 = G.u[0] * s[0] + G.u[1] * s[1], t1 = G.u[0] * s[2] + G.u[1] * s[3];
    G.L.push({i, o: n[0] * (s[0] + s[2]) / 2 + n[1] * (s[1] + s[3]) / 2, t0: Math.min(t0, t1), t1: Math.max(t0, t1)}); });
  groups.forEach(G => {
    const L = G.L.sort((a, b) => a.o - b.o), used = new Set();
    for (let i = 0; i < L.length; i++) { if (used.has(i)) continue;
      const run = [i]; let last = i, sp = null;
      for (;;) { let nx = -1;
        for (let j = last + 1; j < L.length && L[j].o - L[last].o <= 3 * k; j++) { if (used.has(j)) continue; const d = L[j].o - L[last].o; if (d < 0.4 * k) continue;
          const ov = Math.min(L[last].t1, L[j].t1) - Math.max(L[last].t0, L[j].t0); if (ov < 0.7 * Math.min(L[last].t1 - L[last].t0, L[j].t1 - L[j].t0)) continue;
          if (sp != null && Math.abs(d - sp) > 0.12 * sp) continue; nx = j; break; }
        if (nx < 0) break; sp = L[nx].o - L[last].o; run.push(nx); last = nx; }
      if (run.length < 5) continue;
      // the end lines of a run are a wall's face when the wall's other face runs beside them, outside the pattern (tiles laid from the wall)
      const face = (j, sg) => L.some((q, m) => m !== j && (q.o - L[j].o) * sg >= 0.25 * k && (q.o - L[j].o) * sg <= 1.6 * k && Math.min(q.t1, L[j].t1) - Math.max(q.t0, L[j].t0) >= 0.5 * (L[j].t1 - L[j].t0));
      run.forEach((j, n) => { used.add(j); if ((n === 0 && face(j, -1)) || (n === run.length - 1 && face(j, 1))) return; set.add(L[j].i); }); }
  });
  g.hatchK = {k, set}; return set;
}
function barrierIds(g, ids, k, o){
  const door = o.skipDoors ? doorSymbols(g, ids, k) : new Set(), minL = o.minLen * k, cloud = cloudIds(g, k), hat = hatchIds(g, k);
  const wall = o.wall ? {col: o.wall.split("|")[0], w: +o.wall.split("|")[1] || 0} : null;
  const out = ids.filter(i => { const s = g.segs[i];
    if (door.has(i) || cloud.has(i) || hat.has(i) || (s[4] & 8) || (!o.dashBound && (s[4] & 2))) return false;
    if (Math.hypot(s[2] - s[0], s[3] - s[1]) < minL) return false;
    if (wall) { const st = (g.styles[s[6]] || "|0").split("|"); if (st[0] !== wall.col || +st[1] < 0.9 * wall.w) return false; }
    return true; });
  out.doors = (door.lines || []).concat(jambLines(out, k, o.gap)); out.doorIds = [...door].concat(ids.filter(i => cloud.has(i)));
  out.hatch = ids.filter(i => hat.has(i)).map(i => { const s = g.segs[i], L = Math.hypot(s[2] - s[0], s[3] - s[1]), e = Math.min(0.2 * k, L / 4) / L, dx = (s[2] - s[0]) * e, dy = (s[3] - s[1]) * e; return [s[0] + dx, s[1] + dy, s[2] - dx, s[3] - dy]; });   // erased from the picture short of their ends, so the wall they touch stays whole
  return out;
}
/* long work (auto area) hands the page back to the browser about every 40 ms, so clicks, scrolling and the busy note
   stay live while a room is traced instead of the page freezing for seconds */
let lastBreath = 0;
function breathe(){ if (performance.now() - lastBreath < 40) return null;
  return new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { lastBreath = performance.now(); r(); }; c.port2.postMessage(0); }); }
function sliced(task){ task.onContinue = go => { const b = breathe(); if (b) b.then(go); else go(); }; return task; }   // a pdf.js render that lets the browser in between its 15 ms chunks
function edt2(f, W, H){   // squared Euclidean distance transform in place (Felzenszwalb & Huttenlocher); f = 0 on features, 1e20 elsewhere
  const n = Math.max(W, H), g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const one = len => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) g[y] = f[y * W + x]; one(H); for (let y = 0; y < H; y++) f[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) g[x] = f[y * W + x]; one(W); for (let x = 0; x < W; x++) f[y * W + x] = d[x]; }
}
/* runs fn on the part of the window round the mask's extent (pad px each way) and writes the mask back: the pocket and
   closing steps can only change pixels that near the room, and a room is a small part of the 90 ft window */
function cropRun(m, W, H, pad, others, fn){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  if (x1 < x0 || (x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === H - 1)) return fn(m, W, H, others);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, cut = a => { if (!a) return a; const o = new a.constructor(w * h); for (let y = 0; y < h; y++) o.set(a.subarray((y + y0) * W + x0, (y + y0) * W + x0 + w), y * w); return o; };
  const mc = cut(m); fn(mc, w, h, others.map(cut));
  for (let y = 0; y < h; y++) m.set(mc.subarray(y * w, (y + 1) * w), (y + y0) * W + x0);
}
function closeMask(m, W, H, R){ cropRun(m, W, H, Math.ceil(R) + 3, [], (mm, w, h) => closeMaskWin(mm, w, h, R)); }
function closeMaskWin(m, W, H, R){   // morphological closing with a disc of radius R px: fills pockets and notches narrower than 2R
  const N = W * H, f = new Float32Array(N), R2 = R * R;
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H);
  for (let i = 0; i < N; i++) { const x = i % W, y = (i - x) / W, dil = f[i] <= R2 && x > 0 && y > 0 && x < W - 1 && y < H - 1; f[i] = dil ? 1e20 : 0; }
  edt2(f, W, H);
  for (let i = 0; i < N; i++) if (f[i] > R2) m[i] = 1;
}
/* pockets: with the walls right round the room counted as room, whatever is then fully enclosed — furniture or a
   wardrobe against a wall, a door swing — is a pocket of this room and is added (up to maxPx pixels). The next room is
   never enclosed: its own walls, further off, join it to the outside. */
function fillPockets(m, ink, W, H, wallPx, maxPx, minTouch, minPx, named){   // (a pocket lies within the walls round the room)
  cropRun(m, W, H, Math.ceil(wallPx) + 10, [ink, named], (mm, w, h, [ic, nc]) => fillPocketsWin(mm, ic, w, h, wallPx, maxPx, minTouch, minPx, nc)); }
function fillPocketsWin(m, ink, W, H, wallPx, maxPx, minTouch, minPx, named){
  const N = W * H, f = new Float32Array(N);
  let rx0 = W, ry0 = H, rx1 = -1, ry1 = -1; for (let i = 0; i < N; i++) if (m[i]) { const x = i % W, y = (i - x) / W; if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; }   // the room's extent
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H);
  const solid = new Uint8Array(N), w2 = wallPx * wallPx;
  for (let i = 0; i < N; i++) solid[i] = m[i] || (ink[i] && f[i] <= w2) ? 1 : 0;
  const seen = new Uint8Array(N), st = new Int32Array(N);
  for (let i0 = 0; i0 < N; i0++) {
    if (solid[i0] || seen[i0]) continue;
    const comp = []; let top = 0, open = false, touch = 0, cnt = 0, cx0 = W, cy0 = H, cx1 = -1, cy1 = -1; seen[i0] = 1; st[top++] = i0;
    while (top) { const i = st[--top], x = i % W, y = (i - x) / W; if (!open && ++cnt <= maxPx) comp.push(i); if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
      if (f[i] <= 64) touch++;   // within 8 px of the room: only an outline between
      if (x > 0 && !solid[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st[top++] = i - 1; }
      if (x < W - 1 && !solid[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st[top++] = i + 1; }
      if (y > 0 && !solid[i - W] && !seen[i - W]) { seen[i - W] = 1; st[top++] = i - W; }
      if (y < H - 1 && !solid[i + W] && !seen[i + W]) { seen[i + W] = 1; st[top++] = i + W; } }
    const ring = rx1 >= rx0 && cx1 - cx0 >= 0.9 * (rx1 - rx0) && cy1 - cy0 >= 0.9 * (ry1 - ry0);   // all the way round the room: the hollow of its wall (a round room's), not furniture
    if (!open && !ring && touch >= minTouch && cnt >= minPx && cnt <= maxPx && !(named && comp.some(i => named[i]))) comp.forEach(i => { m[i] = 1; });   // gaps in a wall's hatching are smaller
  }
  // the room's own ink inside it (furniture outlines, text) is part of the floor too
  for (let i = 0; i < N; i++) if (!m[i] && ink[i]) { const x = i % W; let n = 0;
    if (x > 0 && m[i - 1]) n++; if (x < W - 1 && m[i + 1]) n++; if (i >= W && m[i - W]) n++; if (i + W < N && m[i + W]) n++; if (n >= 3) m[i] = 1; }
}
function outerLoop(m, W, H){   // boundary of the mask along pixel edges, region on the right; the largest outer loop, in pixel corners
  const N = W + 1, nx = new Map();
  const add = (ax, ay, bx, by) => { const a = ay * N + ax, b = by * N + bx, e = nx.get(a); if (e) e.push(b); else nx.set(a, [b]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!m[y * W + x]) continue;
    if (y === 0 || !m[(y - 1) * W + x]) add(x, y, x + 1, y);
    if (x === W - 1 || !m[y * W + x + 1]) add(x + 1, y, x + 1, y + 1);
    if (y === H - 1 || !m[(y + 1) * W + x]) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || !m[y * W + x - 1]) add(x, y + 1, x, y); }
  let best = null, bestA = 0;
  const xy = v => [v % N, Math.floor(v / N)];
  while (nx.size) {
    const v0 = nx.keys().next().value, loop = []; let cur = v0, pd = null, guard = 0;
    do {
      const outs = nx.get(cur); if (!outs) break;
      let j = 0;
      if (outs.length > 1 && pd) { const c = xy(cur); j = outs.findIndex(o => { const p = xy(o), d = [p[0] - c[0], p[1] - c[1]]; return pd[0] * d[1] - pd[1] * d[0] > 0; }); if (j < 0) j = 0; }
      const nv = outs.splice(j, 1)[0]; if (!outs.length) nx.delete(cur);
      const c = xy(cur), p = xy(nv); pd = [p[0] - c[0], p[1] - c[1]];
      loop.push(c); cur = nv;
    } while (cur !== v0 && ++guard < 4e6);
    let a = 0; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
    if (a > bestA) { bestA = a; best = loop; }
  }
  if (!best) return null;
  return best.filter((p, i) => { const a = best[(i + best.length - 1) % best.length], b = best[(i + 1) % best.length]; return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0; });
}
function dpOpen(P, eps){
  if (P.length < 3) return P.slice();
  let idx = 0, dm = 0; for (let i = 1; i < P.length - 1; i++) { const d = distSeg(P[i], P[0], P[P.length - 1]); if (d > dm) { dm = d; idx = i; } }
  if (dm <= eps) return [P[0], P[P.length - 1]];
  return dpOpen(P.slice(0, idx + 1), eps).slice(0, -1).concat(dpOpen(P.slice(idx), eps));
}
function dpClosed(P, eps){
  let a = 0, dm = 0; P.forEach((p, i) => { const d = dist(P[0], p); if (d > dm) { dm = d; a = i; } });
  let b = 0; dm = 0; P.forEach((p, i) => { const d = dist(P[a], p); if (d > dm) { dm = d; b = i; } });
  const R = P.slice(a).concat(P.slice(0, a)), m = (b - a + P.length) % P.length;
  return dpOpen(R.slice(0, m + 1), eps).slice(0, -1).concat(dpOpen(R.slice(m).concat([R[0]]), eps).slice(0, -1));
}
function signedArea(Q){ let s = 0; for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function orthoEdges(Q){ return Q.map((a, i) => { const b = Q[(i + 1) % Q.length], dx = b[0] - a[0], dy = b[1] - a[1], ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
  const o = ang <= 15 ? "H" : ang >= 75 ? "V" : "D"; return {o, c: o === "H" ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2, L: Math.hypot(dx, dy), dir: o === "H" ? Math.sign(dx) : Math.sign(dy), a, b}; }); }
function edgesToPoly(E){
  const V = [];
  for (let i = 0; i < E.length; i++) { const e = E[i], f = E[(i + 1) % E.length];
    if (e.o !== f.o) V.push(e.o === "H" ? [f.c, e.c] : [e.c, f.c]);
    else { const t = e.o === "H" ? (e.b[0] + f.a[0]) / 2 : (e.b[1] + f.a[1]) / 2; if (e.o === "H") V.push([t, e.c], [t, f.c]); else V.push([e.c, t], [f.c, t]); } }
  return cleanPoly(V);
}
function cleanPoly(V){
  let Q = V.filter((p, i) => dist(p, V[(i + 1) % V.length]) > 1e-6), changed = true;
  while (changed && Q.length > 3) { changed = false;
    for (let i = 0; i < Q.length; i++) { const a = Q[(i + Q.length - 1) % Q.length], p = Q[i], b = Q[(i + 1) % Q.length];
      if (Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) < 1e-6 * Math.max(1, dist(a, b) ** 2)) { Q.splice(i, 1); changed = true; break; } } }
  return Q;
}
function squareUp(Q, tol, gap, maxD, k){   // near-rectilinear outline -> rectilinear; detours shorter than the gap (door bulges) dropped
  const all = orthoEdges(Q), tot = all.reduce((a, e) => a + e.L, 0);
  let E = all.filter(e => e.o !== "D");
  // slanted pieces may only be the short rounding left at inside corners and door openings, never a real slanted wall
  if (E.reduce((a, e) => a + e.L, 0) < 0.6 * tot || all.some(e => e.o === "D" && e.L > 1.6 * maxD) || E.length < 4) return null;
  let changed = true;
  while (changed && E.length > 4) { changed = false;
    for (let i = 0; i < E.length && !changed; i++) for (let s = 1; s <= 5 && s < E.length - 1 && !changed; s++) {
      const e = E[i], f = E[(i + s) % E.length]; if (e.o !== f.o || e.dir !== f.dir || Math.abs(e.c - f.c) > tol) continue;
      let mid = 0; for (let t = 1; t < s; t++) mid += E[(i + t) % E.length].L;
      if (mid > 2.5 * gap) continue;
      const m = {o: e.o, c: e.L >= f.L ? e.c : f.c, L: e.L + f.L + mid, dir: e.dir, a: e.a, b: f.b}, drop = new Set();
      for (let t = 1; t <= s; t++) drop.add((i + t) % E.length);
      E = E.map((x, j) => j === i ? m : x).filter((_, j) => !drop.has(j)); changed = true;
    } }
  if (E.length < 4) return null;
  // squaring may only tidy: a long sloped wall (a gable, a bay, a chamfer — longer than a door gap) squared away would add or
  // drop real area, so the outline is kept when squaring it changes the area by more than a bulge's worth
  const R = edgesToPoly(E);
  return R && all.some(e => e.o === "D" && e.L > gap) && Math.abs(polyArea(R) - polyArea(Q)) > 0.05 * polyArea(Q) + 1.5 * k * k ? null : R;   // (k: points per foot)
}
/* the outline's small bites into the walls, trimmed: at a door jamb or a wall end the fill can slip a few inches into
   the wall's thickness, leaving a tab (out and back) or a step (the face jumps out and carries on). A tab up to 1 ft deep
   and 3 ft wide, or a step up to 0.75 ft, is cut back to the room's face when that face is a drawn line (ink along at
   least 30% of it) or the bite is under 1.5 Sft. Only bites outward (that add area) are cut. */
function deTab(Q, k, inkAt, px, gap){
  const ink = (a, b) => { const L = dist(a, b), n = Math.max(2, Math.ceil(L / px)); let h = 0; for (let i = 0; i <= n; i++) if (inkAt(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) h++; return h / (n + 1); };
  const ok = (cut, rem) => rem > 0 && rem <= 4 * k * k && (rem <= 1.5 * k * k || ink(cut[0], cut[1]) >= 0.3);
  const dir = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  for (let guard = 0; guard < 40; guard++) {
    const n = Q.length, A0 = polyArea(Q); if (n < 5) break;
    const at = i => Q[((i % n) + n) % n];
    let done = false;
    for (let i = 0; i < n && !done; i++) {
      const b = at(i), c = at(i + 1), d = at(i + 2), e = at(i + 3);
      // tab: b→c out, c→d across, d→e back
      if (n >= 6) { const u1 = dir(b, c), u2 = dir(c, d), u3 = dir(d, e), l1 = dist(b, c), l2 = dist(c, d), l3 = dist(d, e);
        if (Math.abs(dot(u1, u2)) < 0.05 && dot(u1, u3) < -0.95 && Math.abs(l1 - l3) <= 0.15 * k) {
          const Q2 = Q.filter((_, j) => j !== (i + 1) % n && j !== (i + 2) % n), rem = A0 - polyArea(Q2);
          if (l1 <= k && l3 <= k && l2 <= 3 * k && ok([b, e], rem)) { Q = Q2; done = true; continue; }
          // a doorway: the tab's far side crosses open space (where the gap was closed) and its two sides run along the
          // jambs — the opening is closed on the room's face of the wall, whatever its width up to the door gap
          if (gap && l1 <= 1.25 * k && l3 <= 1.25 * k && l2 <= (gap + 0.5) * k && rem > 0 && rem <= (gap + 0.5) * 1.25 * k * k
            && ink([c[0] + (d[0] - c[0]) * 0.15, c[1] + (d[1] - c[1]) * 0.15], [c[0] + (d[0] - c[0]) * 0.85, c[1] + (d[1] - c[1]) * 0.85]) < 0.15   // (its ends pass the jambs' corners)
            && ink(b, c) >= 0.5 && ink(d, e) >= 0.5) { Q = Q2; done = true; continue; } } }
      // step: a→b along, b→c short jog, c→d along the same way
      const a = at(i - 1), z = at(i - 2), l = dist(b, c), ua = dir(a, b), uj = dir(b, c), ud = dir(c, d);
      if (l <= 0.75 * k && Math.abs(dot(ua, uj)) < 0.05 && dot(ua, ud) > 0.95) {
        const opts = [];
        // move a→b onto c→d's line (a slides along z→a)
        { const uz = dir(z, a), den = uz[0] * ud[1] - uz[1] * ud[0];
          if (Math.abs(den) > 0.5) { const t = ((c[0] - a[0]) * ud[1] - (c[1] - a[1]) * ud[0]) / den, a2 = [a[0] + uz[0] * t, a[1] + uz[1] * t];
            const Q2 = Q.map((q, j) => j === ((i - 1) % n + n) % n ? a2 : q).filter((_, j) => j !== i % n && j !== (i + 1) % n); opts.push({Q2, cut: [a2, c]}); } }
        // or c→d back onto a→b's line (d slides along d→e)
        { const ue = dir(d, e), den = ue[0] * ua[1] - ue[1] * ua[0];
          if (Math.abs(den) > 0.5) { const t = ((b[0] - d[0]) * ua[1] - (b[1] - d[1]) * ua[0]) / den, d2 = [d[0] + ue[0] * t, d[1] + ue[1] * t];
            const Q2 = Q.map((q, j) => j === (i + 2) % n ? d2 : q).filter((_, j) => j !== i % n && j !== (i + 1) % n); opts.push({Q2, cut: [b, d2]}); } }
        for (const o of opts) { const rem = A0 - polyArea(o.Q2); if (o.Q2.length >= 4 && ok(o.cut, rem)) { Q = o.Q2; done = true; break; } }
      }
    }
    if (!done) break;
  }
  return Q;
}
/* a scanned drawing has no lines to snap to: a side of a square outline that lies inside a wall — where it runs along the
   wall it is several pixels into the wall's ink (the room grown back through an opening as wide as the door gap) — goes
   back to the wall's face. Sides only move inward, and only when most of the ink they run along is deep. */
function pushSides(Q, inkPx, px, k){
  const n = Q.length; if (n < 4) return Q;
  const A0 = polyArea(Q); let R = Q.map(p => p.slice());
  for (let i = 0; i < n; i++) {
    const a = R[i], b = R[(i + 1) % n], L = dist(a, b); if (L < 3 * px) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; if (Math.abs(ux) > 1e-6 && Math.abs(uy) > 1e-6) continue;   // square sides only
    let nx = -uy, ny = ux; if (!pointInPoly([(a[0] + b[0]) / 2 + nx * px, (a[1] + b[1]) / 2 + ny * px], R)) { nx = -nx; ny = -ny; }   // inward
    const ds = []; let cnt = 0;
    for (let t = 2 * px; t <= L - 2 * px; t += px) { cnt++; const x = a[0] + ux * t, y = a[1] + uy * t; if (!inkPx(x, y)) continue;   // (not at the corners)
      let d = 0; while (d < 0.6 * k && inkPx(x + nx * d, y + ny * d)) d += px / 2; if (d < 0.6 * k) ds.push(d); }   // (ink on and on: another wall met end-on)
    if (!ds.length || ds.length < 0.15 * cnt) continue;
    // the ink of a scan reaches about 1.5 px past the wall's face, and a side on the face sits that far into it
    ds.sort((p, q) => p - q); const med = ds[ds.length >> 1]; if (med < 3.5 * px) continue;
    const sh = med - 1.5 * px, R2 = R.map(p => p.slice()); R2[i] = [a[0] + nx * sh, a[1] + ny * sh]; R2[(i + 1) % n] = [b[0] + nx * sh, b[1] + ny * sh];
    if (!selfCross(R2) && polyArea(R2) < polyArea(R) && polyArea(R2) > 0.9 * A0) R = R2;
  }
  return R;
}
/* an outline that is not square to the sheet (a room turned 45°, a bay, a round room): a round one is fitted as a circle on
   the wall it follows; otherwise each side long enough is moved onto the drawing line parallel to it within tol (the
   outward one first: a wall face is outside the room), the rest out by dflt, and the corners re-made where the sides
   meet. Falls back to the plain offset if the result is not a clean outline near the traced one. */
function snapPoly(Q, segs, tol, k, dflt, slack){
  const base = offsetPoly(Q, dflt), n = Q.length; if (n < 3) return base;
  const A0 = polyArea(base);
  // round: every corner about as far from the centre
  if (n >= 10) { const c = [Q.reduce((a, q) => a + q[0], 0) / n, Q.reduce((a, q) => a + q[1], 0) / n], rr = Q.map(q => dist(q, c)), r = rr.reduce((a, v) => a + v, 0) / n;
    if (r > 1.5 * k && rr.every(v => Math.abs(v - r) < 0.04 * r)) {
      const near = []; segs.forEach(s => { if (!(s[4] & 1)) return; const d = (dist([s[0], s[1]], c) + dist([s[2], s[3]], c)) / 2; if (Math.abs(d - r) < tol) near.push(d); });
      let R0 = r + dflt; if (near.length >= 6) { near.sort((a, b) => a - b); const inner = near.filter(d => d >= r - slack); R0 = (inner.length ? inner : near)[0]; R0 = near.filter(d => Math.abs(d - R0) < 0.05 * k).reduce((a, v, _, z) => a + v / z.length, 0); }
      const m = 120, f = Math.sqrt(2 * Math.PI / (m * Math.sin(2 * Math.PI / m)));   // a 120-gon with the circle's area (its corners just outside the circle)
      const C = Array.from({length: m}, (_, i) => [c[0] + R0 * f * Math.cos(2 * Math.PI * i / m), c[1] + R0 * f * Math.sin(2 * Math.PI * i / m)]);
      if (Math.abs(polyArea(C) / A0 - 1) < 0.15) return C; } }
  const sg = signedArea(Q) > 0 ? 1 : -1, L = [];
  for (let i = 0; i < n; i++) {
    const a = Q[i], b = Q[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, u = [dx / len, dy / len], nn = [sg * dy / len, -sg * dx / len];
    let best = null;
    if (len >= 0.75 * k) segs.forEach(s => { const sx = s[2] - s[0], sy = s[3] - s[1], sl = Math.hypot(sx, sy); if (sl < 0.3 * k) return;
      if (Math.abs(u[0] * sy - u[1] * sx) / sl > 0.035) return;   // not parallel (2°)
      const off = (s[0] - (a[0] + b[0]) / 2) * nn[0] + (s[1] - (a[1] + b[1]) / 2) * nn[1]; if (Math.abs(off) > tol) return;
      const t = (x, y) => (x - a[0]) * u[0] + (y - a[1]) * u[1], t0 = Math.min(t(s[0], s[1]), t(s[2], s[3])), t1 = Math.max(t(s[0], s[1]), t(s[2], s[3]));
      if (Math.min(len, t1) - Math.max(0, t0) < Math.min(0.3 * len, k)) return;
      const o = off >= -(slack || 0) ? 0 : 1; if (!best || o < best.o || (o === best.o && Math.abs(off) < Math.abs(best.off))) best = {off, o}; });
    const d = best ? best.off : dflt; L.push({p: [a[0] + nn[0] * d, a[1] + nn[1] * d], u, n: nn, d});
  }
  const out = Q.map((q, i) => { const A = L[(i + n - 1) % n], B = L[i], den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 0.05) return [q[0] + (A.n[0] * A.d + B.n[0] * B.d) / 2, q[1] + (A.n[1] * A.d + B.n[1] * B.d) / 2];
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den; return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]; });
  return selfCross(out) || Math.abs(polyArea(out) / A0 - 1) > 0.15 ? base : out;
}
function offsetPoly(Q, d){   // every edge moved outward by d
  const n = Q.length, s = signedArea(Q) > 0 ? 1 : -1, L = [];
  for (let i = 0; i < n; i++) { const a = Q[i], b = Q[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nn = [s * dy / l, -s * dx / l];
    L.push({p: [a[0] + nn[0] * d, a[1] + nn[1] * d], u: [dx / l, dy / l], n: nn}); }
  return Q.map((q, i) => { const A = L[(i + n - 1) % n], B = L[i], den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 1e-6) return [q[0] + B.n[0] * d, q[1] + B.n[1] * d];
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den; return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]; });
}
function snapToWalls(Q, g, ids, tol, k, slack, extra){   // rectilinear outline: each edge onto the nearest parallel drawing line it runs along —
  const E = orthoEdges(Q), sgn = signedArea(Q) > 0 ? 1 : -1;   // on the outward side first: a wall face is outside the room, furniture inside
  if (E.some(e => e.o === "D")) return Q;
  const segs = ids.map(i => g.segs[i]).concat(extra || []);   // (extra: the lines closing door openings — they run along the wall face)
  E.forEach(e => {
    const out = e.o === "H" ? -sgn * e.dir : sgn * e.dir;   // outward normal of this edge along y (H) or x (V)
    const lo = Math.min(e.o === "H" ? e.a[0] : e.a[1], e.o === "H" ? e.b[0] : e.b[1]), hi = Math.max(e.o === "H" ? e.a[0] : e.a[1], e.o === "H" ? e.b[0] : e.b[1]);
    let best = null;
    segs.forEach(s => { const h = Math.abs(s[3] - s[1]) <= 0.02 * Math.abs(s[2] - s[0]), v = Math.abs(s[2] - s[0]) <= 0.02 * Math.abs(s[3] - s[1]);
      if (e.o === "H" ? !h : !v) return;
      const c = e.o === "H" ? (s[1] + s[3]) / 2 : (s[0] + s[2]) / 2, d = Math.abs(c - e.c); if (d > tol) return;
      const a0 = Math.min(e.o === "H" ? s[0] : s[1], e.o === "H" ? s[2] : s[3]), a1 = Math.max(e.o === "H" ? s[0] : s[1], e.o === "H" ? s[2] : s[3]);
      if (Math.min(hi, a1) - Math.max(lo, a0) < Math.min(0.3 * (hi - lo), 1 * k)) return;
      const o = (c - e.c) * out >= -(slack || 0) ? 0 : 1;
      if (!best || o < best.o || (o === best.o && d < best.d)) best = {c, d, o}; });
    if (best) e.c = best.c;
  });
  return edgesToPoly(E);
}
/* walls from the rendered drawing (what is seen on screen): every non-white pixel is ink; small separate marks (text,
   dashes of dashed lines, dots of stipple, dashed door swings) are dropped. Works for any PDF, scans included. */
async function inkMask(x0, y0, W, H, px, minPx, dashBound, kft, erase, ocb){
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", {willReadFrequently: true}); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  const rt = sliced(S.page.render({...(ocb ? {optionalContentConfigPromise: Promise.resolve(ocb)} : lay(S.fileId)), canvasContext: ctx, viewport: S.page.getViewport({scale: 1 / px}), transform: [1, 0, 0, 1, -x0 / px, -y0 / px]}));
  await rt.promise; await breathe();
  const d = ctx.getImageData(0, 0, W, H).data, N = W * H, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 190 ? 1 : 0;
  if (erase && erase.length) {   // door swings and leaves: not walls, and a leaf open against a wall must not fuse into it
    const ec = document.createElement("canvas"); ec.width = W; ec.height = H; const ex = ec.getContext("2d", {willReadFrequently: true});
    ex.setTransform(1 / px, 0, 0, 1 / px, -x0 / px, -y0 / px); ex.lineWidth = 2.5 * px; ex.lineCap = "butt"; ex.strokeStyle = "#000"; ex.beginPath();
    erase.forEach(s => { ex.moveTo(s[0], s[1]); ex.lineTo(s[2], s[3]); }); ex.stroke();
    const ed = ex.getImageData(0, 0, W, H).data; for (let i = 0; i < N; i++) if (ed[i * 4 + 3] > 24) m[i] = 0;
  }
  const seen = new Uint8Array(N), st = new Int32Array(N);
  const comps = (mask, fn) => {   // 8-connected marks of the mask -> fn(pixels, bbox width, bbox height)
    seen.fill(0);
    for (let i0 = 0; i0 < N; i0++) {
      if (!mask[i0] || seen[i0]) continue;
      let top = 0, x0c = W, x1c = 0, y0c = H, y1c = 0; const comp = []; seen[i0] = 1; st[top++] = i0;
      while (top) { const i = st[--top], x = i % W, y = (i - x) / W; comp.push(i);
        if (x < x0c) x0c = x; if (x > x1c) x1c = x; if (y < y0c) y0c = y; if (y > y1c) y1c = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (mask[j] && !seen[j]) { seen[j] = 1; st[top++] = j; } } }
      fn(comp, x1c - x0c, y1c - y0c);
    }
  };
  // small separate marks go first: letters, stipple dots, dashed door swings — and the dashes of dashed lines, unless they
  // run on in a straight row (a dashed boundary of an open area): those rows are joined into one solid line and kept
  const small = []; await breathe();
  comps(m, (c, w, h) => { if (Math.max(w, h) < minPx) small.push({c, x0: c.reduce((a, i) => Math.min(a, i % W), W), y0: c.reduce((a, i) => Math.min(a, (i - i % W) / W), H), w, h}); });
  if (dashBound) {
    const G = 0.8 * kft / px, L = 2 * kft / px, keep = new Set();
    for (const dir of ["H", "V"]) {
      const D = small.filter(d => dir === "H" ? d.w + 1 >= 3 * (d.h + 1) && d.w >= 2 : d.h + 1 >= 3 * (d.w + 1) && d.h >= 2)
        .map(d => dir === "H" ? {d, a: d.x0, b: d.x0 + d.w, c: d.y0 + d.h / 2, t: d.h} : {d, a: d.y0, b: d.y0 + d.h, c: d.x0 + d.w / 2, t: d.w})
        .sort((p, q) => p.c - q.c || p.a - q.a);
      const used = new Set();
      for (let i = 0; i < D.length; i++) {   // a row: dashes on one line, each gap under 0.8 ft, 2 ft or more in all
        if (used.has(i)) continue;
        const run = [D[i]]; used.add(i);
        for (let j = i + 1; j < D.length && D[j].c - D[i].c <= 2.5; j++) { const last = run[run.length - 1];
          if (!used.has(j) && Math.abs(D[j].c - last.c) <= 2 && D[j].a - last.b <= G && D[j].a >= last.a) { run.push(D[j]); used.add(j); } }
        if (run.length < 2 || run[run.length - 1].b - run[0].a < L) continue;
        run.forEach(r => keep.add(r.d));
        const c = Math.round(run.reduce((s2, r) => s2 + r.c, 0) / run.length), t = Math.max(1, Math.round(run.reduce((s2, r) => s2 + r.t, 0) / run.length / 2));
        for (let a = Math.floor(run[0].a); a <= Math.ceil(run[run.length - 1].b); a++) for (let o2 = -t; o2 <= t; o2++) {
          const x = dir === "H" ? a : c + o2, y = dir === "H" ? c + o2 : a; if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1; }
      }
    }
    small.forEach(d => { if (!keep.has(d)) d.c.forEach(i => { m[i] = 0; }); });
    keep.forEach(d => d.c.forEach(i => { m[i] = 1; }));
  } else small.forEach(d => d.c.forEach(i => { m[i] = 0; }));
  // then ink closer than ~0.4 ft fuses (hatching into a solid wall, so no fill runs between its strokes), 1 px thicker
  // so an 8-neighbour step cannot slip between diagonal pixels
  await breathe();
  const rc = Math.max(1.5, 0.2 * kft / px), f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H); await breathe();
  const dil = new Uint8Array(N); for (let i = 0; i < N; i++) dil[i] = f[i] <= rc * rc ? 1 : 0;
  for (let i = 0; i < N; i++) f[i] = dil[i] ? 1e20 : 0;
  edt2(f, W, H); await breathe();
  const thin = new Uint8Array(N), keep = (rc - 1) * (rc - 1);
  for (let i = 0; i < N; i++) thin[i] = m[i] || f[i] > keep ? 1 : 0;
  // the wall network: marks spanning 8 ft or more. Loose marks inside a room (a word, a tag, a free-standing bed) bound
  // the room but must not split its core when openings are closed
  await breathe(); const big = new Uint8Array(N), bigPx = 8 * kft / px;
  comps(thin, (c, w, h) => { if (Math.max(w, h) >= bigPx) c.forEach(i => { big[i] = 1; }); });
  return {thin, big};
}
function widen(m, W, H, r){   // every ink pixel widened to a disc of radius r px
  const N = W * H, f = new Float32Array(N), out = new Uint8Array(N), r2 = r * r;
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H);
  for (let i = 0; i < N; i++) out[i] = f[i] <= r2 ? 1 : 0;
  return out;
}
async function autoRoom(seed, over){   // -> {pts} or {err}; over: settings for this one trace (a smaller door gap for a small room)
  const k = hereScale(seed), g = S.geo[S.key] || {segs: [], grid: new Map(), cell: 24, styles: []};
  if (!k) return {err: "Set the page scale first (K) — the door gap and wall offsets are in feet."};
  const o = Object.assign(autoOpt(), over || {}), img = o.src !== "vector";
  if (!img && !g.segs.length) return {err: "This page has no vector lines — switch Auto area settings (⚙) to ‘walls from the drawing image’."};
  for (const [half, pxFt] of [[45, 0.06], [110, 0.14]]) {
    const px = pxFt * k, W = Math.ceil(2 * half * k / px), H = W, x0 = seed[0] - half * k, y0 = seed[1] - half * k;
    const bf = o.layers ? segRoleFilter(g, BOUND) : null, ocb = o.layers && bf ? await boundCfg(S.fileId) : null;   // the PDF's wall / door / window / column / railing layers only
    const ids = barrierIds(g, segsIn(g, x0, y0, x0 + W * px, y0 + H * px).filter(i => !bf || bf(i)), k, o);
    const raster = (lw, doorsOnly) => {   // barrier lines (and door openings) stroked lw (pt) wide -> 1 = blocked
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d", {willReadFrequently: true});
      ctx.setTransform(1 / px, 0, 0, 1 / px, -x0 / px, -y0 / px);
      ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.strokeStyle = "#000"; ctx.beginPath();
      if (!doorsOnly) ids.forEach(i => { const s = g.segs[i]; ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); });
      ids.doors.forEach(s => { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); });
      ctx.stroke();
      const img = ctx.getImageData(0, 0, W, H).data, b = new Uint8Array(W * H);
      for (let i = 0; i < b.length; i++) b[i] = img[i * 4 + 3] > 24 ? 1 : 0;
      return b;
    };
    const N = W * H, seedIn = (bar, rmax) => {   // nearest open pixel to the click
      const sx = Math.floor((seed[0] - x0) / px), sy = Math.floor((seed[1] - y0) / px);
      for (let r = 0; r <= rmax; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = sx + dx, y = sy + dy; if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !bar[y * W + x]) return y * W + x; }
      return -1;
    };
    const fill = (bar, si, stopAtEdge) => {   // -> {m, edge}; null when it reaches the window edge and stopAtEdge
      const m = new Uint8Array(N), st = new Int32Array(N); let top = 0, edge = false;
      m[si] = 1; st[top++] = si;
      while (top) { const i = st[--top], x = i % W, y = (i - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { if (stopAtEdge) return null; edge = true; continue; }
        for (const j of [i - 1, i + 1, i - W, i + W]) if (!m[j] && !bar[j]) { m[j] = 1; st[top++] = j; } }
      return {m, edge};
    };
    const rpx = Math.ceil(o.gap * k / px / 2) + 2;
    const fences = (P.proj.marks || []).filter(m => m.type === "fence" && m.file === S.fileId && m.page === S.pageNo);
    const fenceMask = () => { const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d", {willReadFrequently: true});
      ctx.setTransform(1 / px, 0, 0, 1 / px, -x0 / px, -y0 / px); ctx.lineWidth = 2.5 * px; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#000"; ctx.beginPath();
      fences.forEach(f => f.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
      const d = ctx.getImageData(0, 0, W, H).data, b = new Uint8Array(W * H); for (let i = 0; i < b.length; i++) b[i] = d[i * 4 + 3] > 24 ? 1 : 0; return b; };
    let thin, bar, ink = null;
    if (img) { ink = await inkMask(x0, y0, W, H, px, Math.max(o.minLen, 1) * k / px, o.dashBound, k, (ids.doorIds || []).map(i => g.segs[i]).concat(ids.hatch || []), ocb); thin = ink.thin;   // a solid door swing stays in: its area is a pocket, added back
      if (ids.doors.length) { const dl = raster(2 * px, true); for (let i = 0; i < N; i++) if (dl[i]) { thin[i] = 1; ink.big[i] = 1; } }
      await breathe(); bar = widen(ink.big, W, H, o.gap * k / px / 2); }
    else { thin = raster(2 * px); bar = raster(Math.max(o.gap * k, 2 * px)); }
    await breathe();
    if (g.segs.length) { const cav = wallCavities(x0, y0, W, H, px, k, img ? ink.big : null, ids); for (let i = 0; i < N; i++) if (cav[i]) thin[i] = 1; }   // hollow walls are wall, not a recess of the room
    if (fences.length) { const fm = fenceMask(); for (let i = 0; i < N; i++) if (fm[i]) { thin[i] = 1; bar[i] = 1; } }   // the user's fences close what the drawing leaves open
    { const done = P.proj.items.filter(it => it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && !hiddenItem(it) && (cond(it.cond) || {}).type === "area" && it.shape !== "circle" && !pointInPoly(seed, it.pts));
      if (done.length) {   // rooms already measured are solid: a new outline stops where they begin — no area counted twice
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d", {willReadFrequently: true});
        ctx.setTransform(1 / px, 0, 0, 1 / px, -x0 / px, -y0 / px); ctx.fillStyle = "#000";
        done.forEach(it => { ctx.beginPath(); it.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill(); });
        const d = ctx.getImageData(0, 0, W, H).data; for (let i = 0; i < N; i++) if (d[i * 4 + 3] > 128) { thin[i] = 1; bar[i] = 1; } } }
    if (o.show) S.autoShow = {key: S.key, x0, y0, px, W, H, url: maskUrl(thin, W, H)};
    await breathe(); const named = labelMask(x0, y0, W, H, px, o.own);
    // the click in a space narrower than the door gap (a passage, a corridor as wide as a door): its width and length here
    const csx = Math.floor((seed[0] - x0) / px), csy = Math.floor((seed[1] - y0) / px); let passage = null;
    if (csx > 0 && csy > 0 && csx < W - 1 && csy < H - 1 && !thin[csy * W + csx] && bar[csy * W + csx]) {
      const run = (dx, dy) => { let n = 0, x = csx, y = csy; while (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !thin[y * W + x]) { x += dx; y += dy; n++; } return n; };
      const hx = run(1, 0) + run(-1, 0), vy = run(0, 1) + run(0, -1), rm = Math.ceil(o.gap * k / px);
      let d2 = Infinity; for (let dy = -rm; dy <= rm; dy++) for (let dx = -rm; dx <= rm; dx++) { const x = csx + dx, y = csy + dy, q = dx * dx + dy * dy; if (q < d2 && x >= 0 && y >= 0 && x < W && y < H && thin[y * W + x]) d2 = q; }
      passage = {w: 2 * Math.sqrt(d2) * px / k, along: Math.max(hx, vy) * px / k, horiz: hx >= vy}; }   // width: twice the way to the nearest wall (a ray across could run out through a doorway)
    // B: every line widened to the door gap, so all openings close — the room's core — grown back out to the wall faces
    const sb = seedIn(bar, rpx), sa = seedIn(thin, 4);
    let m;
    if (sb >= 0) {
      await breathe(); const B = fill(bar, sb, true); if (!B) continue; await breathe();
      m = B.m; let front = []; for (let i = 0; i < N; i++) if (m[i]) front.push(i);
      for (let layer = 0; layer < rpx && front.length; layer++) {
        const nf = [];
        front.forEach(i => { const x = i % W; for (const j of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1]) {
          if (j < 0 || j >= N || m[j] || thin[j]) continue; if (Math.abs(j % W - x) > 1) continue; m[j] = 1; nf.push(j); } });
        front = nf;
      }
      // A: the thin lines with the door swings' openings closed. What A reaches beyond B is added back where it is too
      // narrow to be a room of its own (the strip beside a bed or a wardrobe); a part with an open core of its own is the
      // next room, through an opening with no door drawn, and stays out.
      await breathe(); const A = sa >= 0 ? fill(thin, sa, false) : null; await breathe();
      if (A) {
        const seen = new Uint8Array(N), st = new Int32Array(N);
        for (let i0 = 0; i0 < N; i0++) {
          if (!A.m[i0] || m[i0] || seen[i0]) continue;
          const comp = []; let top = 0, room = false; seen[i0] = 1; st[top++] = i0;
          while (top) { const i = st[--top], x = i % W, y = (i - x) / W; comp.push(i);
            if (!bar[i] || x === 0 || y === 0 || x === W - 1 || y === H - 1) room = true;
            for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && A.m[j] && !m[j] && !seen[j] && Math.abs(j % W - x) <= 1) { seen[j] = 1; st[top++] = j; } }
          if (!room && !comp.some(i => named[i])) comp.forEach(i => { m[i] = 1; });
        }
      }
    } else {   // narrower than the gap all over (a passage): the thin-line fill alone, if it stays closed
      const A = sa >= 0 ? fill(thin, sa, true) : null;
      if (!A) return {err: "This space is narrower than the door gap (" + f3(o.gap) + " ft) and is not closed — lower ‘Close gaps’ in the auto-area settings (⚙), or draw it.", passage};
      m = A.m;
    }
    await breathe();
    if (o.pocket > 0) { for (let pass = 0; pass < 2; pass++) { await breathe(); fillPockets(m, thin, W, H, Math.max(1.5, o.pocket / 2 + 0.5) * k / px, (o.pocket * k / px) ** 2 * 1.2, k / px, 2 * (k / px) ** 2, named); } await breathe(); closeMask(m, W, H, Math.min(o.pocket, 3) * k / px / 2); }
    let partial = false;
    if (passage) { let n = 0; if (passage.horiz) { for (let x = 0; x < W; x++) if (m[csy * W + x]) n++; } else for (let y = 0; y < H; y++) if (m[y * W + csx]) n++;
      partial = n * px / k < 0.6 * passage.along; }   // the outline takes in less than 60 % of the passage's length: a piece by a doorway, not the passage
    await breathe(); const loop = outerLoop(m, W, H); if (!loop || loop.length < 4) return {err: "No closed space found at that point.", passage};
    let Q = dpClosed(loop.map(p => [x0 + p[0] * px, y0 + p[1] * px]), 1.6 * px);
    const sq = squareUp(Q, 3 * px, o.gap * k, Math.max(o.gap, o.pocket) * k, k);
    Q = sq ? (ids.length ? snapToWalls(sq, g, ids, Math.max(4 * px, 0.35 * k), k, px, ids.doors) : offsetPoly(sq, (img ? 1.5 : 1) * px))
      : ids.length ? snapPoly(Q, ids.map(i => g.segs[i]).concat(ids.doors), Math.max(4 * px, 0.35 * k), k, (img ? 1.5 : 1) * px, px) : offsetPoly(Q, (img ? 1.5 : 1) * px);
    Q = cleanPoly(Q);
    const inkPx = (x, y) => { const u = Math.round((x - x0) / px), v = Math.round((y - y0) / px); return u >= 0 && v >= 0 && u < W && v < H && !!thin[v * W + u]; };
    if (sq && !ids.length) Q = cleanPoly(pushSides(Q, inkPx, px, k));   // (before the tabs: a doorway's two jambs then line up)
    if (sq) Q = cleanPoly(deTab(Q, k, (x, y) => { const xx = Math.round((x - x0) / px), yy = Math.round((y - y0) / px);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const u = xx + dx, v = yy + dy; if (u >= 0 && v >= 0 && u < W && v < H && thin[v * W + u]) return true; } return false; }, px, o.gap));
    if (sq && !ids.length) Q = cleanPoly(pushSides(Q, inkPx, px, k));
    if (Q.length < 3 || polyArea(Q) < 1e-6) return {err: "No closed space found at that point.", passage};
    return {pts: Q, rect: !!sq, passage, partial};
  }
  return {err: "The space leaks — an opening wider than the door gap (" + f3(autoOpt().gap) + " ft) joins it to the outside. Raise ‘Close gaps’ (⚙ next to Auto area) or draw it."};
}
/* the inside of walls drawn as two lines with nothing between them: without this, the empty strip between a wall's faces
   is an enclosed space next to the room and the pocket rule would add it (the room would run to the wall's far face).
   Pairs of parallel lines 0.3-1.6 ft apart, running 1 ft or more together, that belong to the wall network (image mode:
   both lines are part of the 8 ft+ ink network) are painted solid. */
function wallCavities(x0, y0, W, H, px, k, big, ids){   // ids: the barrier lines (door swings and leaves already left out)
  const out = new Uint8Array(W * H), G = faceLines(null, k, ids, 1.6 * k); if (!G) return out;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", {willReadFrequently: true}); ctx.setTransform(1 / px, 0, 0, 1 / px, -x0 / px, -y0 / px); ctx.fillStyle = "#000";
  const onBig = q => { const x = Math.round((q[0] - x0) / px), y = Math.round((q[1] - y0) / px); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && big[yy * W + xx]) return true; } return false; };
  let n = 0;
  G.forEach(g => facePairs(g, 0.3 * k, 1.6 * k, (big ? 1 : 2) * k, (d, o, t0, t1) => {
    const P = (t, off) => [g.u[0] * t + g.n[0] * off, g.u[1] * t + g.n[1] * off];
    if (big && ![0.2, 0.5, 0.8].every(f => { const t = t0 + (t1 - t0) * f; return onBig(P(t, o - d / 2)) && onBig(P(t, o + d / 2)); })) return;
    // a wall's hollow is closed at an end (end cap, or the wall it runs into); a strip open at both ends is floor
    // between two things (a bed and a wall), not a wall
    // (a hollow wider than a 9" wall must be closed at both ends: 13.5" walls are capped, a gap beside furniture is not)
    if (big) { const shut = [[t0, -1], [t1, 1]].filter(([t, sg]) => [0.15, 0.3, 0.45].some(f => onBig(P(t + sg * f * k, o)))).length;
      if (d > 1.3 * k || (d > 0.85 * k && shut < 2)) return; }
    const a = P(t0, o - d / 2), b = P(t1, o - d / 2), c = P(t1, o + d / 2), e = P(t0, o + d / 2);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.closePath(); ctx.fill(); n++; }));
  if (!n) return out;
  const im = ctx.getImageData(0, 0, W, H).data; for (let i = 0; i < out.length; i++) out[i] = im[i * 4 + 3] > 24 ? 1 : 0;
  return out;
}
function maskUrl(m, W, H){   // what auto area treated as walls, for the "show detected walls" overlay
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d"), im = ctx.createImageData(W, H);
  for (let i = 0; i < m.length; i++) if (m[i]) { im.data[i * 4] = 255; im.data[i * 4 + 1] = 0; im.data[i * 4 + 2] = 140; im.data[i * 4 + 3] = 170; }
  ctx.putImageData(im, 0, 0); return cv.toDataURL();
}
async function autoAt(p){
  const c = S.cond ? cond(S.cond) : null; if (!c) return;
  if (P.proj.items.some(it => it.cond === c.id && it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && c.type === "area" && pointInPoly(p, it.pts)))
    return toast("Already measured — this point is inside an area of " + c.name);
  if (S.autoBusy) return toast("Still tracing the last room…", 1500);
  busy("Finding the room…"); S.autoBusy = true;
  const key = S.key;
  await new Promise(r => setTimeout(r, 20));
  let res; try { res = await autoRoomGuarded(p); } catch (e) { res = {err: "Auto area failed: " + (e.message || e)}; }
  busy(""); S.autoBusy = false;
  if (S.key !== key || !cond(c.id)) return toast("The page changed while the room was traced — nothing added; click again", 4000);   // never a room of one page put on another
  if (res.err) return toast(res.err, 6000);
  const id = uid("I"), nm = S.lbl.autoName ? roomNameAt(res.pts) : "";
  mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: res.pts, nos: 1, label: nm}); });
  S.sel = id; draw(); renderSheet();
  const k = hereScale(p);
  if (res.short && !res.leak) return toast("⚠ " + (nm || "Room") + " " + fq(polyArea(res.pts) / k / k) + " Sft — " + res.short + ".", 9000);
  if (res.leak) { if (!autoOpt().show) { P.proj.auto = Object.assign({}, P.proj.auto || {}, {show: true}); save(); }
    return toast("⚠ " + (nm || "Room") + " " + fq(polyArea(res.pts) / k / k) + " Sft — it still leaks (" + res.leak + "). The pink lines show the walls found: draw a Fence (orange) across the gap where it escapes, Ctrl+Z, and click again.", 9000); }
  toast((nm || "Room") + " " + fq(polyArea(res.pts) / k / k) + " Sft" + (res.note ? " · " + res.note : "") + (res.rect ? "" : " (not square — check the outline)") + " — Select (V) and drag points to adjust", 4200);
}
/* Leak guard: a room's outline must not swallow another room's name, nor grow far past its own written size.
   When it does, trace again closing wider gaps and dashed lines, and keep the first clean outline. */
async function autoRoomGuarded(p){
  let first = await autoRoom(p);
  // a passage about as narrow as the door gap (a 4 ft corridor, gap 4 ft): traced again closing openings just under its width
  // (doorways on it close, it does not), when the first trace failed or took in only a piece of it
  if (first.passage && (first.err || first.partial)) {
    for (const f of [0.9, 0.8, 0.7, 0.6]) { const g2 = Math.max(1.2, f * autoOpt().gap); busy("A passage as narrow as the door gap — closing openings up to " + f3(g2) + " ft…");
      const r2 = await autoRoom(p, {gap: g2}); if (!r2.err && !r2.partial) { r2.note = "passage narrower than the door gap: openings closed up to " + f3(g2) + " ft"; first = r2; break; } }
    if (!first.err && first.partial) first.short = "only part of a passage narrower than the door gap was found — Ctrl+Z, set ‘Close gaps’ (⚙) below the passage's width and click again";
  }
  if (first.err) return first;
  let F = null; try { F = await drawingFacts(S.fileId, S.pageNo); } catch (e) {}
  if (!F || !F.rooms.length) return first;
  const k = hereScale(p), o = autoOpt();
  const judge = r => { const inn = F.rooms.filter(m => pointInPoly([m.x + m.w / 2, m.y - m.h / 2], r.pts)), a = polyArea(r.pts) / k / k;
    const own = inn.length === 1 ? inn[0] : null, big = own && own.sft && a > own.sft * 1.25;
    return {n: inn.length, bad: inn.length > 1 || big, names: inn.map(m => m.name), a}; };
  let j = judge(first); if (!j.bad) return first;
  let best = {res: first, j};
  for (const over of [{dashBound: true}, {dashBound: true, gap: o.gap * 1.5}, {dashBound: true, gap: o.gap * 2, pocket: Math.max(o.pocket || 0, 1.5)}, {dashBound: true, gap: o.gap * 3, pocket: Math.max(o.pocket || 0, 2)}]) {
    busy("Room leaked into " + j.names.filter(Boolean).slice(0, 3).join(", ") + " — closing wider gaps…"); await new Promise(r => setTimeout(r, 10));
    const r2 = await autoRoom(p, over); if (r2.err) continue;
    const j2 = judge(r2);
    if (!j2.bad && j2.n >= 1) { r2.note = "leak closed (gap " + f3(over.gap || o.gap) + " ft" + (over.dashBound ? ", dashed lines as walls" : "") + ")"; return r2; }
    if (j2.n >= 1 && (j2.n < best.j.n || (j2.n === best.j.n && j2.a < best.j.a))) best = {res: r2, j: j2};
  }
  best.res.leak = best.j.n > 1 ? "takes in " + best.j.names.join(" + ") : "much bigger than its written size";
  return best.res;
}
async function autoSettings(){
  const o = autoOpt();
  const v = await ask("Auto area settings", `<div class="grid">
    <div class="fg w2"><label>Find walls from</label><select id="aoSrc"><option value="image"${o.src !== "vector" ? " selected" : ""}>The drawing as seen on screen (recommended — works with any PDF)</option><option value="vector"${o.src === "vector" ? " selected" : ""}>The PDF's vector lines (CAD exports only)</option></select></div>
    <div class="fg"><label>Close gaps up to (ft)</label><input type="text" id="aoGap" value="${f3(o.gap)}"><span class="small">door openings — set to the widest door</span></div>
    <div class="fg"><label>Ignore furniture / recesses narrower than (ft)</label><input type="text" id="aoPk" value="${f3(o.pocket)}"><span class="small">0 = follow every notch</span></div>
    <div class="fg"><label>Ignore marks smaller than (ft)</label><input type="text" id="aoMin" value="${f3(o.minLen)}"><span class="small">text, dashes, hatching (image: at least 1 ft)</span></div>
    <div class="fg"><label>Wall lines</label><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="small" id="aoWall">${o.wall ? "colour " + esc(o.wall.split("|")[0]) + ", " + esc(o.wall.split("|")[1]) + " pt and heavier" : "any drawing line"}</span>
      <button class="btn sm" id="aoPick" type="button">Pick a wall…</button>${o.wall ? '<button class="btn sm" id="aoClr" type="button">Any line</button>' : ""}</div></div>
    <div class="fg w2"><label><input type="checkbox" id="aoLay" style="width:auto"${o.layers ? " checked" : ""}> Use the PDF's layers: only walls, doors / windows, columns and railings bound a room (furniture, fixtures, glass screens, hatch, text and clouds ignored) — when the PDF has them</label></div>
    <div class="fg w2"><label><input type="checkbox" id="aoDoor" style="width:auto"${o.skipDoors ? " checked" : ""}> Ignore door swings and door leaves</label></div>
    <div class="fg w2"><label><input type="checkbox" id="aoDash" style="width:auto"${o.dashBound ? " checked" : ""}> Straight dashed lines bound a room (e.g. an open dress / wardrobe area) — untick if dashed lines on your drawings are beams overhead</label></div>
    <div class="fg w2"><label><input type="checkbox" id="aoShow" style="width:auto"${o.show ? " checked" : ""}> Show the detected walls (pink) after each auto area — to see why a room leaks</label></div></div>
    <p class="small" style="margin-top:10px">If furniture or fixtures are drawn in the same pen as the walls, <b>Pick a wall</b> so only lines of that colour and weight bound the room.</p>`, "Save", () => {
      const gap = parseFt($("aoGap").value), pocket = parseFt($("aoPk").value || "0"), minLen = parseFt($("aoMin").value || "0");
      if (!(gap > 0.2 && gap < 30)) return "Close gaps: a width in ft, e.g. 4";
      if (isNaN(pocket) || isNaN(minLen)) return "Enter decimal feet";
      return {src: $("aoSrc").value, gap, pocket: Math.max(0, pocket), minLen: Math.max(0, minLen), skipDoors: $("aoDoor").checked, layers: $("aoLay").checked, dashBound: $("aoDash").checked, show: $("aoShow").checked}; }, "aoGap");
  if (v) { P.proj.auto = Object.assign({}, P.proj.auto || {}, v); if (!v.show) S.autoShow = null; save(); draw(); toast("Auto area settings saved"); }
}
document.addEventListener("click", e => {   // auto-area dialog: pick / clear the wall pen
  if (e.target.id === "aoPick") { $("dlgCancel").click(); S.pickWall = true; setTool("auto"); toast("Click a wall line on the drawing", 4000); }
  if (e.target.id === "aoClr") { if (P.proj.auto) P.proj.auto.wall = null; save(); $("aoWall").textContent = "any drawing line"; e.target.remove(); }
});
function pickWallAt(sp){
  S.pickWall = false;
  const g = S.geo[S.key], q = toBase(sp[0], sp[1]), r = HIT_PX / S.view.s; if (!g) return;
  let best = null; segsIn(g, q[0] - r, q[1] - r, q[0] + r, q[1] + r).forEach(i => { const s = g.segs[i], d = distSeg(q, [s[0], s[1]], [s[2], s[3]]); if (d <= r && s[6] >= 0 && !(s[4] & 8) && (!best || d < best.d)) best = {d, i}; });
  if (!best) return toast("No line there — zoom in and click right on a wall line");
  const key = g.styles[g.segs[best.i][6]];
  P.proj.auto = Object.assign({}, P.proj.auto || {}, {wall: key}); save();
  toast("Wall lines set: colour " + key.split("|")[0] + ", " + key.split("|")[1] + " pt and heavier — now click inside a room", 5000);
}

/* ------------------------------------------------------------------ quantities (house measurement rules) */
const UNITS = {area: ["Sft", "cft"], linear: ["ft", "Sft", "cft"], count: ["Nos"]};
/* rows of one measurement on the sheet. Every quantity = product of the dimensions as printed (rounded), so the
   sheet re-measures from its own figures. */
function rowsOf(it, k){
  const c = cond(it.cond); if (!c || !k) return [];
  const nos = +it.nos || 1, sign = it.kind === "shape" ? 1 : -1, ft = p => [p[0] / k, p[1] / k];
  const R = (o) => Object.assign({it: it.id, sign, nos: null, A: null, L: null, W: null, H: null, unit: c.unit, below: false}, o);
  const qty = r => r.sign * [r.nos, r.A, r.L, r.W, r.H].filter(v => v != null).reduce((a, v) => a * v, 1);
  let rows = [];
  if (c.type === "count") rows = [R({nos: it.pts.length * nos, desc: "count"})];
  else if (it.shape === "circle") {   // Nos × π/4 × D² (area) or Nos × π × D (length) — the diameter on the sheet
    const D = r3(2 * dist(it.pts[0], it.pts[1]) / k), H = c.unit === "cft" ? r3(+c.t || 0) : null, faces = +c.faces || 1;
    if (c.type === "area") rows = [R({nos, A: r3(Math.PI / 4 * D * D), H, how: "circle", D})];
    else { const L = r3(Math.PI * D); rows = [c.unit === "ft" ? R({nos, L, how: "circle", D}) : c.unit === "Sft" ? R({nos: nos * faces, L, H: r3(+c.h || 0), how: "circle", D}) : R({nos, L, W: r3(+c.t || 0), H: r3(+c.h || 0), how: "circle", D})]; }
    if (it.kind === "ded" && c.type === "area") { const tot = rows.reduce((a, r) => a + Math.abs(qty(r)), 0); if (tot <= (+c.dedMin || 0)) rows.forEach(r => { r.below = true; }); }
  }
  else if (c.type === "linear") {
    if (it.kind === "open") {
      const sch = schOf(it.sch), w = sch ? +sch.w : it.ow ? +it.ow : r3(dist(it.pts[0], it.pts[1]) / k), h = sch ? +sch.h : +it.oh || 0, faces = c.unit === "Sft" ? (+c.faces || 1) : 1;
      const r = c.unit === "ft" ? R({nos, L: r3(w), desc: "opening"}) : c.unit === "Sft" ? R({nos: nos * faces, L: r3(w), H: r3(h), desc: "opening"}) : R({nos, L: r3(w), W: r3(+c.t || 0), H: r3(h), desc: "opening"});
      if (c.unit !== "ft" && r3(w) * r3(h) <= (+c.dedMin || 0)) r.below = true;
      rows = [r];
    } else {
      const runs = [], arcs = Array.isArray(it.arcs) ? it.arcs : [];   // an arc drawn with A is one leg (its short pieces summed)
      for (let i = 1; i < it.pts.length;) { const a = arcs.find(q => q[0] === i - 1 && q[1] > q[0] && q[1] < it.pts.length);
        if (a) { let L = 0; for (let j = a[0] + 1; j <= a[1]; j++) L += dist(it.pts[j - 1], it.pts[j]); runs.push(r3(L / k)); i = a[1] + 1; } else { runs.push(r3(dist(it.pts[i - 1], it.pts[i]) / k)); i++; } }
      const L = r3(runs.reduce((a, v) => a + v, 0)), faces = +c.faces || 1;
      const r = c.unit === "ft" ? R({nos, L}) : c.unit === "Sft" ? R({nos: nos * faces, L, H: r3(+c.h || 0)}) : R({nos, L, W: r3(+c.t || 0), H: r3(+c.h || 0)});
      r.runs = runs; rows = [r];
    }
  } else {
    // one measured shape = one row: a plain rectangle as L × W, any other outline as its plan area (by coordinates)
    const F = it.pts.map(ft), tol = 0.002 * Math.max(1, Math.sqrt(polyArea(F)));
    const parts = rectilinear(F, tol), H = c.unit === "cft" ? r3(+c.t || 0) : null;
    rows = parts && parts.length === 1 ? [R({nos, L: r3(parts[0].L), W: r3(parts[0].W), H, how: "rect"})]
         : [R({nos, A: r3(polyArea(F)), H, how: "poly", sides: F.length})];
    if (it.kind === "ded") { const tot = rows.reduce((a, r) => a + Math.abs(qty(r)), 0); if (tot <= (+c.dedMin || 0)) rows.forEach(r => { r.below = true; }); }
  }
  rows.forEach(r => { r.qty = r.below ? 0 : qty(r); });
  return rows;
}
function condTotals(c){
  const out = {gross: 0, ded: 0, net: 0, n: 0, noScale: 0};
  P.proj.items.filter(i => i.cond === c.id).forEach(it => {
    const k = itemScale(it);
    if (!k) { out.noScale++; return; }
    rowsOf(it, k).forEach(r => { if (r.sign > 0) out.gross += r.qty; else out.ded += -r.qty; out.n++; });
  });
  out.net = out.gross - out.ded;
  return out;
}
/* ------------------------------------------------------------------ assemblies and the bill
   A condition's measured quantity drives derived items by formula (PlanSwift-style assemblies), each with a rate.
   Variables: Q net quantity in the condition's unit · A net plan area Sft · P perimeter ft of its areas · PD that
   perimeter less the door openings on it (skirting) · D the door widths taken off · L net length ft · N count · H height
   ft · T thickness ft. Functions: ceil floor round min max abs sqrt. Rates carry a source and a date (typed, or the
   built-up rate of a Rate Analysis code); a rate without them is flagged, never assumed.
   only(it) limits everything to some measurements (one revision's sheets, one floor). */
function condVars(c, only){
  const v = {Q: 0, A: 0, P: 0, PD: 0, D: 0, L: 0, N: 0, H: +c.h || 0, T: +c.t || 0};
  P.proj.items.filter(i => i.cond === c.id && (!only || only(i))).forEach(it => {
    const k = itemScale(it); if (!k) return;
    const rows = rowsOf(it, k), sg = it.kind === "shape" ? 1 : -1, nos = +it.nos || 1;
    rows.forEach(r => { v.Q += r.qty; if (r.below) return;
      if (c.type === "area") v.A += r.sign * (r.nos || 1) * (r.A != null ? r.A : (r.L || 0) * (r.W || 0)); });
    if (c.type === "area" && it.kind === "shape") { const per = polyLen(itemPoly(it), true) / k, dr = Math.min(per, doorsOn(it).ft); v.P += nos * per; v.D += nos * dr; v.PD += nos * (per - dr); }
    if (c.type === "linear" && it.kind !== "open") v.L += sg * nos * (it.shape === "circle" ? Math.PI * 2 * dist(it.pts[0], it.pts[1]) : polyLen(it.pts)) / k;
    if (c.type === "count") v.N += it.pts.length * nos; else if (it.kind === "shape") v.N += nos;
  });
  return v;
}
function evalFormula(src, vars){   // + - * / ^ ( ) numbers, variables, functions; throws on anything else
  const t = String(src).replace(/\s+/g, "").match(/\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_]+|[-+*/^(),]/g) || [];
  if (t.join("") !== String(src).replace(/\s+/g, "")) throw new Error("Only numbers, + - * / ^ ( ) and " + Object.keys(vars).join(" ") + " are allowed");
  let i = 0;
  const F = {ceil: Math.ceil, floor: Math.floor, round: (x, d) => d ? Math.round(x * 10 ** d) / 10 ** d : Math.round(x), min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt};
  const peek = () => t[i], take = x => { if (t[i] !== x) throw new Error("Expected " + x); i++; };
  const prim = () => {
    const a = t[i++];
    if (a === undefined) throw new Error("Formula ends early");
    if (a === "(") { const v = expr(); take(")"); return v; }
    if (a === "-") return -pow();
    if (a === "+") return pow();
    if (/^[\d.]/.test(a)) return +a;
    const u = a.toUpperCase();
    if (vars[u] !== undefined) return vars[u];
    const fn = F[a.toLowerCase()];
    if (fn && peek() === "(") { i++; const args = [expr()]; while (peek() === ",") { i++; args.push(expr()); } take(")"); return fn(...args); }
    throw new Error("Unknown name: " + a);
  };
  const pow = () => { let v = prim(); while (peek() === "^") { i++; v = Math.pow(v, prim()); } return v; };
  const term = () => { let v = pow(); while (peek() === "*" || peek() === "/") { const o = t[i++], b = pow(); v = o === "*" ? v * b : v / b; } return v; };
  const expr = () => { let v = term(); while (peek() === "+" || peek() === "-") { const o = t[i++], b = term(); v = o === "+" ? v + b : v - b; } return v; };
  const v = expr(); if (i < t.length) throw new Error("Unexpected " + t[i]);
  if (!isFinite(v)) throw new Error("Result is not a number");
  return v;
}
function billLines(only){   // [{c, kind:"cond"|"asm", a, name, unit, qty, rate, src, date, ra, na, boq, f, err}]
  const out = [];
  P.proj.conds.forEach(c => {
    const vars = condVars(c, only);
    if (!P.proj.items.some(i => i.cond === c.id && (!only || only(i))) && (only || !(c.asm || []).length)) return;
    out.push(Object.assign({c, kind: "cond", name: c.name, unit: c.unit, qty: vars.Q, boq: c.boq || ""}, rateOf(c, c.unit)));
    (c.asm || []).forEach(a => { let qty = 0, err = ""; try { qty = evalFormula(a.f || "0", vars); } catch (e) { err = e.message; }
      out.push(Object.assign({c, kind: "asm", a, name: a.name, unit: a.unit, qty, f: a.f, err, boq: a.boq || ""}, rateOf(a, a.unit))); });
  });
  return out;
}
const rateOk = l => !l.na && (!(l.rate > 0) || !!(l.src && l.date));
const rateNote = l => l.na ? '<span style="color:var(--red)">' + esc(l.na) + "</span>" : !rateOk(l) ? '<span style="color:var(--red)">rate: ASSUMPTION — no dated source</span>'
  : l.rate > 0 ? (l.ra ? "RA " + esc(l.ra) + (l.cached ? " (last read " + esc(dmy(l.date)) + ")" : "") + (l.assumed ? ' · <span style="color:var(--amber)">' + l.assumed + " assumed row" + (l.assumed > 1 ? "s" : "") + "</span>" : "") : "rate: " + esc(l.src) + ", " + esc(dmy(l.date))) : "rate not set";
function renderBill(){
  const el = $("bill"); if (!P.proj) { el.innerHTML = ""; return; }
  const bar = `<div class="billbar"><label class="small">Group <select id="billGrp"><option value="">— none —</option><option value="floor"${S.billGrp === "floor" ? " selected" : ""}>by building / floor</option><option value="file"${S.billGrp === "file" ? " selected" : ""}>by drawing (PDF)</option><option value="sheet"${S.billGrp === "sheet" ? " selected" : ""}>by sheet / page</option></select></label><span style="flex:1"></span>
    <button class="btn sm" data-bact="open" title="Door and window marks with their sizes">Opening schedule</button><button class="btn sm" data-bact="rev" title="Old revision against new: quantity and cost variance">Revision compare</button></div>`;
  const groups = S.billGrp === "floor" ? floorGroups() : S.billGrp === "file" ? P.proj.files.map(f => ({name: f.name.replace(/\.pdf$/i, ""), only: it => it.file === f.id}))   // Forma inventory: group by document
    : S.billGrp === "sheet" ? allPages().map(o => { const sh = (P.proj.sheets || {})[o.key] || {}; return {name: [sh.no, sh.title, o.f.name.replace(/\.pdf$/i, "") + " p." + o.i].filter(Boolean).join(" · "), only: it => it.file === o.f.id && it.page === o.i}; }) : [{name: "", only: null}];
  let all = 0, any = false, h = "";
  groups.forEach(g => {
    const L = billLines(g.only); if (!L.length) return; any = true;
    let tot = 0, n = 0;
    if (g.name) h += `<tr class="grp"><td colspan="4">${esc(g.name)}</td></tr>`;
    L.forEach(l => {
      const amt = l.qty * l.rate; tot += amt;
      h += `<tr class="${l.kind === "cond" ? "ch2" : "it"}"><td>${l.kind === "asm" ? "↳ " : `${++n}. <span class="sw" style="background:${l.c.color}"></span>`}${l.boq ? `<span class="boq">${esc(l.boq)}</span> ` : ""}${esc(l.name)}${l.kind === "cond" ? ` <button class="rn" data-asm="${esc(l.c.id)}" title="Items this condition drives, and rates">&#9881; Assembly</button>` : ""}
        <div class="ds">${l.kind === "asm" ? (l.err ? '<span style="color:var(--red)">' + esc(l.err) + "</span>" : "= " + esc(l.f)) : "measured"} · ${rateNote(l)}</div></td>
        <td class="n">${fq(l.qty, l.unit)}<div class="ds">${esc(l.unit)}</div></td><td class="n">${l.rate ? f2(l.rate) : "—"}</td><td class="n">${l.rate ? f2(amt) : "—"}</td></tr>`;
    });
    all += tot;
    h += `<tr class="tot"><td>Total${g.name ? " " + esc(g.name) : ""}</td><td></td><td></td><td class="n">${f2(tot)}</td></tr>`;
  });
  if (!any) { el.innerHTML = bar + '<div class="empty">The bill lists every condition with its quantity, plus the items each one drives (open a condition’s <b>Assembly</b> — e.g. floor tiles from the floor area, skirting from its perimeter less doors, PD). Rates are typed with their source and date, or linked to a Rate Analysis code.</div>'; return; }
  if (groups.length > 1) h += `<tr class="tot"><td>Grand total</td><td></td><td></td><td class="n">${f2(all)}</td></tr>`;
  el.innerHTML = bar + '<table class="sh bill"><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount PKR</th></tr></thead><tbody>' + h + "</tbody></table>";
}
function floorGroups(){   // one group per building / floor found, plus the measurements with no floor
  const keyL = it => { const L = locOf(it); return [L.bldg, L.floor].filter(Boolean).join(" · "); }, names = [...new Set(P.proj.items.map(keyL))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
  return names.map(n => ({name: n || "No floor given", only: it => keyL(it) === n}));
}
async function asmDialog(c){
  const rows = JSON.parse(JSON.stringify(c.asm || [])), vars = condVars(c);
  const row = (a, n) => `<tr data-r="${n}"><td><input type="text" data-k="name" value="${esc(a.name || "")}" placeholder="e.g. Floor tiles"></td><td><input type="text" data-k="unit" value="${esc(a.unit || "")}" style="width:52px" placeholder="Sft"></td>
    <td><input type="text" data-k="f" value="${esc(a.f || "")}" placeholder="A*1.05"></td><td><input type="text" data-k="boq" value="${esc(a.boq || "")}" style="width:78px" placeholder="BOQ code"></td><td><input type="text" data-k="ra" value="${esc(a.ra || "")}" style="width:92px" placeholder="RA code" list="dlRa2"></td><td><input type="number" data-k="rate" value="${a.rate || ""}" style="width:80px" placeholder="0"></td>
    <td><input type="text" data-k="src" value="${esc(a.src || "")}" placeholder="source"></td><td><input type="date" data-k="date" value="${esc(a.date || "")}"></td><td><button class="btn sm dng" data-del="${n}" type="button">&times;</button></td></tr>`;
  const cr = rateOf(c, c.unit);
  const body = () => `<p class="small">Now: Q = ${fq(vars.Q, c.unit)} ${esc(c.unit)}${c.type === "area" ? ` · A = ${fq(vars.A)} Sft · P = ${f3(vars.P)} ft · PD = ${f3(vars.PD)} ft (P less ${f3(vars.D)} ft of doors)` : ""}${c.type === "linear" ? ` · L = ${f3(vars.L)} ft` : ""} · N = ${vars.N}${vars.H ? " · H = " + f3(vars.H) : ""}${vars.T ? " · T = " + f3(vars.T) : ""}.
    Formulas use Q A P PD D L N H T and ceil floor round min max abs sqrt, e.g. <code>A*1.05</code>, <code>PD</code> (skirting), <code>ceil(A/4)</code>.</p>
    ${c.ra ? `<p class="small" style="margin-top:6px">${esc(c.name)} is linked to Rate Analysis <b>${esc(c.ra)}</b> (condition editor): ${cr.na ? `<span style="color:var(--red)">${esc(cr.na)}</span>` : "PKR " + f2(cr.rate) + " / " + esc(c.unit) + " — the typed rate below is not used"}.</p>` : ""}
    <div class="grid" style="margin:8px 0"><div class="fg"><label>Rate for ${esc(c.name)} (PKR / ${esc(c.unit)})</label><input type="number" id="crRate" value="${c.rate || ""}" placeholder="0"></div>
    <div class="fg"><label>Rate source</label><input type="text" id="crSrc" value="${esc(c.rateSrc || "")}" placeholder="e.g. Phoenix GRN RCP-312"></div><div class="fg"><label>Rate date</label><input type="date" id="crDate" value="${esc(c.rateDate || "")}"></div></div>
    <datalist id="dlRa2">${raLib().o ? [...raLib().items.values()].map(i => `<option value="${esc(i.code || i.id)}">${esc(String(i.desc || "").slice(0, 60) + " (" + i.unit + ")")}</option>`).join("") : ""}</datalist>
    <table class="asm"><thead><tr><th>Item it drives</th><th>Unit</th><th>Formula</th><th>BOQ code</th><th>RA code</th><th>Rate PKR</th><th>Source</th><th>Date</th><th></th></tr></thead><tbody id="asmB">${rows.map(row).join("")}</tbody></table>
    <button class="btn sm" id="asmAdd" type="button" style="margin-top:6px">+ Item</button>
    <p class="small" style="margin-top:8px">No rate is assumed: leave it 0 if there is no dated source. A rate without source and date is shown as an assumption. An RA code takes the item's built-up rate from the Rate Analysis library instead of the typed rate; if the code is missing, in another unit or not fully priced the line shows RATE NOT AVAILABLE.</p>`;
  const read = () => document.querySelectorAll("#asmB tr").forEach(tr => { const a = rows[+tr.dataset.r]; tr.querySelectorAll("[data-k]").forEach(inp => { a[inp.dataset.k] = inp.dataset.k === "rate" ? (+inp.value || 0) : inp.dataset.k === "ra" ? inp.value.trim().toUpperCase() : inp.value.trim(); }); });
  const p = ask("Assembly — " + c.name, body(), "Save", () => {
    read(); for (const a of rows) { if (!a.name) return "Every item needs a name"; try { evalFormula(a.f || "0", vars); } catch (e) { return a.name + ": " + e.message; } }
    return {rows, rate: +$("crRate").value || 0, src: $("crSrc").value.trim(), date: $("crDate").value};
  });
  const wire = () => { $("asmAdd").onclick = () => { read(); rows.push({id: uid("A"), name: "", unit: "", f: "Q"}); $("dlgB").querySelector("#asmB").innerHTML = rows.map(row).join(""); wire(); };
    document.querySelectorAll("#asmB [data-del]").forEach(b => b.onclick = () => { read(); rows.splice(+b.dataset.del, 1); $("dlgB").querySelector("#asmB").innerHTML = rows.map(row).join(""); wire(); }); };
  wire();
  const v = await p; if (!v) return;
  mutate(() => { c.asm = v.rows; c.rate = v.rate; c.rateSrc = v.src; c.rateDate = v.date; });
}

function dimText(r){
  const parts = [r.nos, r.A, r.L, r.W, r.H].map((v, i) => v == null ? null : i === 0 ? String(v) : i === 1 ? f3(v) + " Sft" : f3(v)).filter(v => v != null);
  return parts.join(" × ");
}

/* ------------------------------------------------------------------ tools and pointer */
function setTool(t){
  const keepSel = t === "select" || t === "lasso" || t === "zoomwin" || t === "stamp" || t === "match";
  if (!keepSel) { S.sel = null; S.selPt = -1; S.selMark = null; S.multi.clear(); }
  if (t === "match" || S.tool === "match") S.matchSource = null;
  if (t === "zoomwin" && S.tool !== "zoomwin") S.prevTool = S.tool;
  const c = S.cond ? cond(S.cond) : null;
  if (["draw", "rect", "ded", "open", "auto"].indexOf(t) >= 0 && !c && t !== "count") { toast("Pick or create a condition first (left panel)"); t = "select"; S.pickWall = false; }
  if (t === "rect" && c && c.type !== "area") { toast("Rectangle is for area conditions"); t = "draw"; }
  if (t === "circle" && c && c.type === "count") { toast("Circle is for area (round slab, column) or length (round wall) conditions"); t = "draw"; }
  if (t === "circle" && !c) { toast("Pick or create a condition first (left panel)"); t = "select"; }
  if (t === "count" || t === "vsearch") {   // the count tools work on a count condition: the active one, else the first, else a new "Count"
    let cc = c && c.type === "count" ? c : P.proj && P.proj.conds.find(x => x.type === "count");
    if (!cc && P.proj) { cc = {id: uid("C"), name: "Count", type: "count", unit: "Nos", color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0}; P.proj.conds.push(cc); save(); renderConds(); }
    if (cc) S.cond = cc.id;
  }
  if (t === "auto" && c && c.type !== "area" && !S.pickWall) { toast("Auto area is for area conditions (floor, ceiling, slab…)"); t = "draw"; }
  if (t === "open" && c && !(c.type === "linear")) { toast("Openings are deducted from a wall (length) condition"); t = "draw"; }
  if (t === "ded" && c && c.type === "count") { toast("Counts have no deductions — select a point and press Delete"); t = "draw"; }
  if (t === "stamp" && !S.clip) { toast("Copy something first (Ctrl+C) — then click each place for a copy"); t = "select"; }
  if (t !== "auto") S.pickWall = false;
  if (t !== "open") S.openMark = null;
  if (t !== "draw") S.resume = null;
  if (t !== "gap") S.gap = null;
  if (t !== "typref" && S.typ) { S.typ = null; $("cmpLegend").style.display = "none"; toast("Typical copy stopped — nothing copied"); }
  S.mkd = null;
  S.tool = t; draftClear(); S.draftRedo = []; S.measure = t === "measure" ? S.measure : null; S.press = null; S.lasso = null; S.zbox = null; S.hover = null;
  if (t === "match" && S.sel) {
    const it = P.proj.items.find(i => i.id === S.sel);
    if (it && onPage(it) && !hiddenItem(it)) S.matchSource = matchSourceOf(it);
  }
  document.querySelectorAll("#tools .tool[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  { const mb = $("bMk"); if (mb) { mb.classList.toggle("on", mkIsTool(t)); const tl = mb.querySelector(".tl"); if (tl) tl.textContent = mkIsTool(t) ? MK_TOOL_NAMES[t] : "Markup"; } }
  ribFollow(t);
  if (t === "mk_stamp" && !S.stampNoPick) setTimeout(() => { if (S.tool === "mk_stamp") stampPicker().then(v => { if (!v && S.tool === "mk_stamp") setTool("select"); }); }, 0);
  stage().className = t === "pan" ? "pan" : t === "select" ? "" : t === "lasso" ? "lasso" : t === "zoomwin" ? "zoomwin" : "draw";
  stage().style.cursor = "";
  hint(); draw(); renderProps(); draftBtns();
}
function hint(){
  const c = S.cond ? cond(S.cond) : null, t = S.tool;
  const drawing = " · type a length + Enter (12'-6\") · A: arc · Ctrl+click: no snap · Ctrl+Z / Backspace: last point back · Ctrl+Y: again";
  const H = {select: "Click to select · drag a box left→right (wholly inside) or right→left (touching) · drag a selected object to move it, Ctrl+drag to copy · double-click an edge to add a point, a point to remove it · right-click for more.",
    lasso: "Lasso: drag round the objects to select (touching counts) · Shift adds to the selection.", pan: "Drag to pan; scroll to zoom.",
    draw: !c ? "" : c.type === "area" ? "Click the corners; click the first point, right-click or press Enter to close." + drawing : c.type === "linear" ? (S.resume ? "Continuing the run — click on; Enter, double-click or right-click to finish." : "Click along the run; Enter, double-click or right-click to finish.") + drawing : "Click each item to count it; Esc when done.",
    fence: "Draw a line across the opening where Auto area leaks (click points; double-click, right-click or Enter to finish). It counts as a wall for Auto area only.", vsearch: "Box one symbol (two corners) — every matching symbol is counted.", note: "Click where the note goes, then type it.", cloud: "Click two opposite corners of the area to cloud.", arrow: "Click the tail, then the head of the arrow.", hilite: "Click two opposite corners to highlight.",
    rect: "Click two opposite corners — or one corner, then type L x W (e.g. 12 x 14) and Enter.", circle: "Click the centre, then a point on the edge.", vp: "Click two opposite corners of the detail drawn at another scale.", count: "Click each item to count it — numbered as you go. Select (V) a marker and press Delete to remove it.", auto: S.pickWall ? "Click a wall line — only lines of its colour and weight will bound rooms." : "Click inside a room — its area is traced from the walls, across door openings. ⚙ for settings.", ded: (c && c.type === "area" ? "Draw the void / cut-out to deduct; Enter to close." : "Draw the length to deduct; Enter to finish.") + drawing,
    open: schOf(S.openMark) ? "Placing " + schOf(S.openMark).mark + " (" + f3(schOf(S.openMark).w) + " × " + f3(schOf(S.openMark).h) + ") — click both sides of each opening. Esc stops." : "Click both sides of the opening, then enter its height or pick its schedule mark.",
    typref: S.typ ? (S.key === S.typ.src ? "Typical copy: click reference point " + (S.typ.a.length + 1) + " of 2 on this (source) sheet." : "Typical copy: click the same reference point " + (S.typ.b.length + 1) + " of 2 on this sheet.") : "", measure: "Click points; double-click, right-click or Enter ends a measurement (it stays on screen). Esc clears. Nothing is saved." + drawing,
    cal: "Click both ends of a known dimension, then enter its length.",
    break: "Break: click a length run where it should be cut in two · Shift+click a segment to delete just that segment · Esc when done.",
    gap: "Cut a gap: click the other end of the gap on the same run (e.g. the far side of a door) · Esc cancels.",
    stamp: "Place copies: click each place for a copy of what you copied (" + (S.clip ? S.clip.n : 0) + " object" + (S.clip && S.clip.n === 1 ? "" : "s") + ") · Esc when done.",
    zoomwin: "Zoom window: drag a box round the part to see (a click zooms in 2×).",
    match: S.matchSource ? `Matching ${S.matchSource.name} — click compatible area, linear or count objects to apply its properties; Esc finishes.` : "Click a source area, linear or count object (or select one before starting Match), then click compatible targets; Esc finishes."};
  let h = H[t] || MK_HINTS[t] || "";
  if (S.arcMode) h = S.arcMid ? "Arc: click the end of the arc." : "Arc: click a point on the arc (then its end) · A again for straight.";
  $("stHint").textContent = h;
}
function evPos(e){ const r = stage().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function cursorPoint(e, sp){
  const raw = toBase(sp[0], sp[1]);
  let p = raw, s = null;
  const free = e && (e.ctrlKey || e.metaKey) && S.tool !== "select";   // Ctrl: the point goes exactly where clicked, no snap (Bluebeam)
  const ex = S.drag && S.drag.vertex != null ? ((it, i) => it.id === S.drag.item && i === S.drag.vertex) : null;   // a dragged point never snaps onto itself
  if (!free && (["draw", "rect", "ded", "open", "measure", "cal", "circle", "vp", "arrow", "dimension", "fence", "typref", "break", "gap", "stamp"].indexOf(S.tool) >= 0 || (mkIsTool(S.tool) && S.tool !== "mk_pen" && S.tool !== "mk_hpen") || (S.drag && (S.drag.vertex != null || S.drag.mh != null)))) { s = snapAt(raw, ex); if (s) p = s.p; }
  let last = S.drag ? null : S.draft[S.draft.length - 1];
  if (S.drag && S.drag.vertex != null) { const it = P.proj.items.find(i => i.id === S.drag.item); if (it) last = S.drag.orig[S.drag.vertex - 1] || S.drag.orig[S.drag.vertex + 1] || null; }
  if (((e && e.shiftKey) !== !!S.ortho) && last && !S.arcMid) { const dx = Math.abs(p[0] - last[0]), dy = Math.abs(p[1] - last[1]); p = dx >= dy ? [p[0], last[1]] : [last[0], p[1]]; if (s) s = Object.assign({}, s, {type: s.type + " + straight"}); }   // Shift, or Ortho (F8; Shift then frees one click)
  else if (S.polar && last && !S.arcMid && !free && !s && !(e && e.shiftKey)) {   // Polar (F10): within 4° of a 15° (5° … 90°) direction -> onto it, the length kept
    const dx = p[0] - last[0], dy = last[1] - p[1], len = Math.hypot(dx, dy), inc = polarDeg() * Math.PI / 180;
    if (len > 1e-6) { const a = Math.atan2(dy, dx), n = Math.round(a / inc) * inc;
      if (Math.abs(a - n) <= 4 * Math.PI / 180) { p = [last[0] + len * Math.cos(n), last[1] - len * Math.sin(n)]; s = {p, type: "polar " + (((n * 180 / Math.PI) % 360 + 360) % 360).toFixed(0) + "°", pri: 5, d: 0}; } } }
  if (free) s = {p, type: "free (Ctrl — no snap)", pri: 9, d: 0, free: true};
  return {p, s};
}
function onDown(e){
  if (!S.page || (e.target.closest && e.target.closest("#cmpLegend"))) return;   // the floating bar's own buttons
  ctxClose();
  const sp = evPos(e);
  stage().setPointerCapture(e.pointerId);
  if (e.pointerType === "touch") {
    S.touches = S.touches || {}; S.touches[e.pointerId] = sp;
    const ids = Object.keys(S.touches);
    if (ids.length === 2) { if (S.lp) { clearTimeout(S.lp.t); S.lp = null; } const a = S.touches[ids[0]], b = S.touches[ids[1]]; S.pinch = {d: dist(a, b), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: Object.assign({}, S.view)}; S.drag = null; S.press = null; return; }
    if (ids.length === 1 && !S.draft.length && (S.tool === "select" || S.tool === "pan")) { const cx = e.clientX, cy = e.clientY;   // touch: press and hold for the right-click menu (tablets)
      S.lp = {sp, t: setTimeout(() => { if (!S.lp) return; S.lp.fired = true; cancelDrag0(); ctxOpen(sp, {clientX: cx, clientY: cy}); }, 550)}; }
  }
  if (e.button === 2 && S.draft.length && ["draw", "ded", "measure", "fence", "mk_polyline", "mk_polygon"].indexOf(S.tool) >= 0) { e.preventDefault(); return endDraft(); }   // right-click ends the line / area
  if (e.button === 1 || S.space || S.tool === "pan" || (e.button === 2)) { S.drag = {pan: true, sp, v: Object.assign({}, S.view), rc: e.button === 2 && !S.space}; stage().classList.add("panning"); e.preventDefault(); return; }   // right-drag pans; a right-click (no drag) opens the menu
  if (e.button !== 0) return;
  if (S.pickWall) return pickWallAt(sp);
  if (S.tool === "auto") return autoAt(toBase(sp[0], sp[1]));
  if (S.tool === "lasso") { S.lasso = {pts: [sp], add: e.shiftKey}; return; }
  if (S.tool === "zoomwin") { S.zbox = {a: sp, b: sp}; return; }
  if (S.tool === "select") return selectDown(sp, e);
  if (S.tool === "match") return matchClick(sp);
  const {p} = cursorPoint(e, sp);
  if (mkIsTool(S.tool)) return mkDown(p, sp, e);
  if (S.tool === "break") return breakClick(sp, e);
  if (S.tool === "gap") return gapClick(sp);
  if (S.tool === "stamp") { stampAt(p); return; }
  if (S.tool === "typref") { if (!(S.typ && S.typ.T)) typClick(p).then(hint); return; }
  if (S.tool === "count" || (S.tool === "draw" && cond(S.cond).type === "count")) return addCount(p);
  if (S.tool === "rect") { if (!S.draft.length) draftPush([p]); else { const a = S.draft[0]; finish([a, [p[0], a[1]], p, [a[0], p[1]]]); } draftBtns(); draw(); return; }
  if (S.tool === "draw" || S.tool === "ded" || S.tool === "measure" || S.tool === "fence") {
    if (S.arcMode && S.draft.length) return arcClick(p);
    const closeArea = isAreaDraft() && S.draft.length >= 3 && dist(toScr(S.draft[0]), toScr(p)) <= SNAP_PX;
    if (closeArea) return finish(S.draft.slice());
    if (S.draft.length && dist(S.draft[S.draft.length - 1], p) < 1e-6) return;
    draftPush([p]); draftBtns(); draw(); return;
  }
  if (S.tool === "open" || S.tool === "cal" || S.tool === "circle" || S.tool === "vp") { draftPush([p]); if (S.draft.length === 2) finish(S.draft.slice()); draftBtns(); draw(); }
  if (S.tool === "note") return addMark("note", [p]);
  if (S.tool === "vsearch") { draftPush([toBase(sp[0], sp[1])]); if (S.draft.length === 2) { const d = S.draft.slice(); draftClear(); findSimilar([Math.min(d[0][0], d[1][0]), Math.min(d[0][1], d[1][1]), Math.max(d[0][0], d[1][0]), Math.max(d[0][1], d[1][1])]); } draftBtns(); draw(); return; }
  if (S.tool === "cloud" || S.tool === "arrow" || S.tool === "dimension" || S.tool === "hilite") { draftPush([p]); if (S.draft.length === 2) { const d = S.draft.slice(); draftClear(); addMark(S.tool, d); } draftBtns(); draw(); }
}
function typedPoint(buf){   // the next point at a typed length, along the cursor's direction (a rectangle: L x W towards the cursor)
  S.typed = "";
  const last = S.draft[S.draft.length - 1], k = hereScale(last); if (!k) { toast("Set the page scale first (K)", 2200); draw(); return; }
  const ft = t => { t = t.trim(); let v = parseFt(t); if (isNaN(v) && /^\d+(\.\d+)?\s*"$/.test(t)) v = parseFloat(t) / 12; return v; };
  const cur = S.cursor || [last[0] + 1, last[1]];
  if (S.tool === "rect") { const m = /^(.+?)\s*[xX×]\s*(.+)$/.exec(buf); if (!m) { toast("Type the rectangle as L x W, e.g. 12 x 14 or 12'-6\" x 10'", 3000); draw(); return; }
    const L = ft(m[1]), W = ft(m[2]); if (!(L > 0 && W > 0)) { toast("Could not read “" + buf + "” as L x W", 2600); draw(); return; }
    const a = S.draft[0], sx = Math.sign(cur[0] - a[0]) || 1, sy = Math.sign(cur[1] - a[1]) || 1, p = [a[0] + sx * L * k, a[1] + sy * W * k];
    finish([a, [p[0], a[1]], p, [a[0], p[1]]]); return; }
  const L = ft(buf); if (!(L > 0)) { toast("Could not read “" + buf + "” as a length — e.g. 12.5, 12'-6\" or 150\"", 2600); draw(); return; }
  const dx = cur[0] - last[0], dy = cur[1] - last[1], l = Math.hypot(dx, dy) || 1;
  draftPush([[last[0] + dx / l * L * k, last[1] + dy / l * L * k]]); draftBtns(); draw();
}
/* arcs while drawing (PlanSwift "A"): A, then a point on the arc, then its end — the arc is kept as short straight
   pieces (one every 2.5°) and counted as one leg on the sheet */
function arcClick(p){
  if (!S.arcMid) { S.arcMid = p; hint(); draw(); return; }
  const a = S.draft[S.draft.length - 1], pts = arcPts(a, S.arcMid, p);
  S.arcMid = null; S.arcMode = 0; draftPush(pts, true); hint(); draftBtns(); draw();
}
function arcPts(a, m, b){   // points along the circle from a through m to b (a itself left out); in line -> straight to m and b
  const C = circumcentre(a, m, b); if (!C || dist(a, b) < 1e-6) return [m.slice(), b.slice()];
  const R = dist(C, a), ang = q => Math.atan2(q[1] - C[1], q[0] - C[0]), norm = x => { x %= 2 * Math.PI; return x < 0 ? x + 2 * Math.PI : x; };
  const t0 = ang(a); let sweep = norm(ang(b) - t0); if (norm(ang(m) - t0) > sweep) sweep -= 2 * Math.PI;   // the way round that passes m
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 72))), out = [];   // a point every 2.5°: the chords are within 0.01 % of the arc
  for (let i = 1; i <= n; i++) { const t = t0 + sweep * i / n; out.push([C[0] + R * Math.cos(t), C[1] + R * Math.sin(t)]); }
  out[out.length - 1] = b.slice();
  return out;
}
function endDraft(){   // finish the line / area / measurement being drawn (Enter, double-click, right-click)
  const D = S.draft.slice(), arcEnd = Math.max(0, ...(S.draftArcs || []).map(a => a[1]));
  for (let n = 0; n < 2 && D.length > 1 && D.length - 1 > arcEnd && dist(toScr(D[D.length - 1]), toScr(D[D.length - 2])) <= HIT_PX / 2; n++) D.pop();   // the extra click of a double-click (never an arc's own points)
  if (isAreaDraft() || S.tool === "mk_polygon" ? D.length >= 3 : D.length >= 2) return finish(D);
  S.draft = D; draw();
}
function isAreaDraft(){ const c = S.cond ? cond(S.cond) : null; return c && c.type === "area" && (S.tool === "draw" || S.tool === "ded"); }
function onMove(e){
  if (!S.page) return;
  const sp = evPos(e);
  if (S.pinch && e.pointerType === "touch") {
    S.touches[e.pointerId] = sp; const ids = Object.keys(S.touches); if (ids.length < 2) return;
    const a = S.touches[ids[0]], b = S.touches[ids[1]], f = dist(a, b) / S.pinch.d, c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v = S.pinch.v;
    const ns = Math.max(0.05, Math.min(5000, v.s * f)), k = ns / v.s;
    S.view = {s: ns, tx: c[0] - (S.pinch.c[0] - v.tx) * k, ty: c[1] - (S.pinch.c[1] - v.ty) * k}; applyView(); renderHi(); return;
  }
  if (S.lp && !S.lp.fired && dist(sp, S.lp.sp) > 8) { clearTimeout(S.lp.t); S.lp = null; }
  if (S.drag && S.drag.pan) { if (S.drag.rc && dist(sp, S.drag.sp) > 4) S.drag.rcMoved = true; S.view = {s: S.drag.v.s, tx: S.drag.v.tx + sp[0] - S.drag.sp[0], ty: S.drag.v.ty + sp[1] - S.drag.sp[1]}; applyView(); renderHi(); return; }
  if (S.lasso) { const L = S.lasso.pts; if (dist(L[L.length - 1], sp) > 3) L.push(sp); draw(); return; }
  if (S.zbox) { S.zbox.b = sp; draw(); return; }
  if (S.mkd) { mkMoveDrag(sp, e); S.cursorScr = sp; draw(); return; }
  if (S.press && !S.drag && dist(sp, S.press.sp) > 4) startMove(S.press, e);
  if (S.drag && S.drag.move) { moveDrag(sp, e); return; }
  if (S.box) { S.box.b = sp; if (S.box.pending && dist(S.box.a, sp) > 6) { S.box.pending = false; if (!S.box.add) S.sel = null; } if (!S.box.pending) { draw(); return; } }
  const {p, s} = cursorPoint(e, sp);
  S.cursor = p; S.snap = s; S.cursorScr = sp;
  if (S.drag && S.drag.mh != null) { if (S.drag.moved || dist(sp, S.drag.sp0) > 2) mkHandleDrag(S.drag, p, e); draw(); return; }
  if (S.drag && S.drag.ghost != null && dist(sp, S.drag.sp0) > 3) { const G = S.drag, it = P.proj.items.find(i => i.id === G.item);   // dragging a +: a new point there
    if (it) { const orig = it.pts.map(q => q.slice()), arcs = it.arcs; it.pts.splice(G.ghost + 1, 0, midOf(it, G.ghost)); delete it.arcs; S.drag = {vertex: G.ghost + 1, item: it.id, orig, arcs, moved: true, ins: true, live: true, sp0: G.sp0}; S.selPt = G.ghost + 1; } else S.drag = null; }
  if (S.drag && S.drag.vertex != null) { const D = S.drag, it = P.proj.items.find(i => i.id === D.item);   // a point moves once the mouse has gone 3 px (a click is not a drag)
    if (!D.live && (!D.sp0 || dist(sp, D.sp0) > 3)) D.live = true;
    if (it && D.live) { it.pts[D.vertex] = p; D.moved = true; refreshSheetSoon(); } }
  if (S.tool === "select" && !S.drag) hoverAt(sp, e);
  const k = hereScale(p), vp = viewportAt(S.fileId, S.pageNo, p);
  $("stPos").innerHTML = k ? `x <b>${f3(p[0] / k)}</b> ft · y <b>${f3(p[1] / k)}</b> ft${vp ? " · <b>" + esc(vp.name) + "</b>" : ""}` : "Scale not set";
  $("stSnap").textContent = s ? "Snap: " + s.type : "";
  draw();
}
function cancelDrag0(){   // a long press became the menu: drop what the press had started, without a toast
  const D = S.drag; S.press = null; S.box = null; S.lasso = null;
  if (D && D.vertex != null) { const it = P.proj.items.find(i => i.id === D.item); if (it) it.pts = D.orig; }
  if (D && D.mh != null) { const m = objById(D.mark); if (m) m.pts = D.orig; }
  if (D && D.move) { D.orig.forEach((pts, id) => { const o = objById(id); if (o) o.pts = pts.map(p => p.slice()); }); if (D.added && D.added.length) { const a = new Set(D.added); P.proj.items = P.proj.items.filter(i => !a.has(i.id)); P.proj.marks = (P.proj.marks || []).filter(m => !a.has(m.id)); } }
  S.drag = null;
}
function onUp(e){
  if (S.lp) { clearTimeout(S.lp.t); const fired = S.lp.fired; S.lp = null; if (fired) { if (S.touches) delete S.touches[e.pointerId]; return; } }
  if (S.mkd) { mkUp(); return; }
  if (S.drag && S.drag.mh != null) { const D = S.drag, m = objById(D.mark); S.drag = null;
    if (m && D.moved) { const np = m.pts.map(q => q.slice()); m.pts = D.orig; mutate(() => { m.pts = np; m.mod = new Date().toISOString(); }, "Edit " + (MARK_TOOLS[m.type] || "markup").toLowerCase()); } else draw(); return; }
  if (S.drag && S.drag.pan && S.drag.rc && !S.drag.rcMoved) { S.drag = null; stage().classList.remove("panning"); ctxOpen(evPos(e), e); return; }
  if (S.lasso) { lassoEnd(); return; }
  if (S.zbox) { zoomBoxEnd(); return; }
  if (S.press) { const pr = S.press; S.press = null; pressClick(pr); }
  if (S.box) boxSelect();
  if (S.touches) { delete S.touches[e.pointerId]; if (Object.keys(S.touches).length < 2) S.pinch = null; }
  if (S.drag && S.drag.move) { endMove(); return; }
  if (S.drag && S.drag.vertex != null && S.drag.moved) { const D = S.drag, it = P.proj.items.find(i => i.id === D.item);
    if (it) { const pts = it.pts.slice(); it.pts = D.orig; if (D.arcs) it.arcs = D.arcs; mutate(() => { it.pts = pts; if (D.ins) delete it.arcs; qaMoved(it); }, D.ins ? "Add point" : "Move point"); if (D.ins) S.lastIns = {id: it.id, vi: D.vertex, t: Date.now()}; if (crossed(it)) toast(crossMsg, 6000); } }
  S.drag = null; stage().classList.remove("panning");
}
const qaMoved = it => { if (it.qa === "checked") { it.qa = ""; it.qaNote = "outline changed after it was checked"; } };
function cancelDrag(){   // Esc / Ctrl+Z during a drag: everything back where it was
  const D = S.drag; S.drag = null; if (!D) return;
  if (D.vertex != null) { const it = P.proj.items.find(i => i.id === D.item); if (it) { it.pts = D.orig; if (D.arcs) it.arcs = D.arcs; } }
  if (D.mh != null) { const m = objById(D.mark); if (m) m.pts = D.orig; }
  if (D.move) { D.orig.forEach((pts, id) => { const o = objById(id); if (o) o.pts = pts.map(p => p.slice()); });
    if (D.added && D.added.length) { const a = new Set(D.added); P.proj.items = P.proj.items.filter(i => !a.has(i.id)); P.proj.marks = (P.proj.marks || []).filter(m => !a.has(m.id)); setSel(D.before || []); } }
  stage().style.cursor = ""; S.snap = null; refresh(); toast("Cancelled", 1200);
}

/* ------------------------------------------------------------------ selection (Bluebeam / PlanSwift mouse)
   Click selects (the smallest area under the cursor, or a line, marker or markup on it). A box dragged left → right
   selects what is wholly inside it (window, blue); right → left what it touches (crossing, green). Shift / Ctrl+click
   add or take out; Lasso (Shift+O) selects what a free shape touches; Tab steps through objects lying on top of each
   other. A selected object drags to move (Shift: straight), Ctrl+drag copies it, Alt+drag moves an object without
   selecting it first. Its points drag, a + at the middle of each side adds a point there. */
const objById = id => P.proj.items.find(i => i.id === id) || (P.proj.marks || []).find(m => m.id === id) || null;
const onPage = o => o && o.file === S.fileId && o.page === S.pageNo;
const pageItems = () => S.hideMk ? [] : P.proj.items.filter(i => onPage(i) && !hiddenItem(i));
const pageMarks = () => S.hideMk ? [] : (P.proj.marks || []).filter(m => onPage(m) && !mkHidden(m));
function selOne(){ if (S.multi.size || !S.sel) return null; const it = P.proj.items.find(i => i.id === S.sel); return it && onPage(it) && !hiddenItem(it) ? it : null; }
function setSel(ids, pt){
  S.multi.clear(); S.sel = null; S.selMark = null; S.selPt = -1;
  ids = [...ids].filter(id => objById(id));
  if (ids.length === 1) { const o = objById(ids[0]); if (P.proj.items.includes(o)) { S.sel = o.id; S.selPt = pt == null ? -1 : pt; if (o.cond !== S.cond) S.cond = o.cond; } else S.selMark = o.id; }
  else ids.forEach(id => S.multi.add(id));
}
function selIds(){ const ids = new Set(S.multi); if (S.sel) ids.add(S.sel); if (S.selMark) ids.add(S.selMark); return ids; }
const editPts = it => { const c = cond(it.cond); return !!c && c.type !== "count" && it.kind !== "open" && it.shape !== "circle"; };
const isRun = it => { const c = cond(it.cond); return !!c && c.type === "linear" && it.kind !== "open" && it.shape !== "circle"; };
const closedOf = it => { const c = cond(it.cond); return !!c && (c.type === "area" || it.shape === "circle"); };
function vertexAt(it, sp){ const pts = it.pts; let bi = -1, bd = HIT_PX + 0.01; pts.forEach((p, i) => { const d = dist(toScr(p), sp); if (d < bd) { bd = d; bi = i; } }); return bi; }
function segAt(it, sp, tol){   // the side of an outline / leg of a run under a screen point -> {i, p (on it, page units), d}
  const poly = it.shape === "circle" ? itemPoly(it) : it.pts, closed = closedOf(it), n = closed ? poly.length : poly.length - 1; let best = null;
  for (let i = 0; i < n; i++) { const a = toScr(poly[i]), b = toScr(poly[(i + 1) % poly.length]), d = distSeg(sp, a, b);
    if (d <= (tol || HIT_PX) && (!best || d < best.d)) { const q = projSeg(sp, a, b); best = {i, d, p: toBase(q[0], q[1])}; } }
  return best;
}
function ghostAt(it, sp){   // the "+" at the middle of a side of the selected outline -> side index
  if (!editPts(it) || it.locked) return -1; const closed = closedOf(it), n = closed ? it.pts.length : it.pts.length - 1;
  for (let i = 0; i < n; i++) { const a = toScr(it.pts[i]), b = toScr(it.pts[(i + 1) % it.pts.length]); if (dist(a, b) < 34) continue; if (dist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], sp) <= 6.5) return i; }
  return -1;
}
const midOf = (it, i) => { const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
function hitInfo(sp){   // the measurement under a screen point -> {it, edge, pt} (a marker or line first, then the smallest area containing it)
  const q = toBase(sp[0], sp[1]), items = pageItems();
  let hit = null, hitA = Infinity;
  for (let n = items.length - 1; n >= 0; n--) { const it = items[n], c = cond(it.cond); if (!c) continue;
    if (c.type === "count") { const vi = vertexAt(it, sp); if (vi >= 0) return {it, edge: true, pt: vi}; continue; }
    const closed = closedOf(it), poly = itemPoly(it);
    for (let i = 1; i < poly.length + (closed ? 1 : 0); i++) if (distSeg(sp, toScr(poly[i - 1]), toScr(poly[i % poly.length])) <= HIT_PX) return {it, edge: true, pt: -1};
    if (closed && pointInPoly(q, poly)) { const a = polyArea(poly); if (a < hitA) { hit = it; hitA = a; } } }
  return hit ? {it: hit, edge: false, pt: -1} : null;
}
function matchSourceOf(it){
  const c = cond(it.cond);
  return c ? {id: it.id, cond: c.id, name: c.name, type: c.type, kind: it.kind || "shape",
    label: it.label || "", nos: Math.max(1, +it.nos || 1), ow: it.ow, oh: it.oh, sch: it.sch} : null;
}
function applyMatchProperties(it, src){
  it.cond = src.cond;
  it.label = src.label;
  it.nos = src.nos;
  if (src.type !== "count" && src.kind !== "open") it.kind = src.kind;
  if (src.kind === "open") ["ow", "oh", "sch"].forEach(k => { if (src[k] == null) delete it[k]; else it[k] = src[k]; });
}
function matchClick(sp){
  const hit = hitInfo(sp);
  if (!hit) return toast(S.matchSource ? "Click a compatible measurement to match, or Esc to finish" : "Click the source measurement to match");
  const it = hit.it, c = cond(it.cond);
  if (!S.matchSource) {
    const src = matchSourceOf(it);
    if (!src) return toast("That measurement has no condition to match");
    S.matchSource = src; setSel([it.id], hit.pt); refresh(); hint();
    return toast("Source: " + src.name + " — click compatible targets; Esc to finish", 3000);
  }
  const src = S.matchSource, srcCond = cond(src.cond);
  if (!srcCond) { S.matchSource = null; hint(); return toast("The source condition no longer exists — select another source"); }
  if (it.id === src.id) return toast("That is the source object — click a target to apply its properties");
  if (!c || c.type !== src.type) return toast("Match only works between the same measurement type (" + src.type + ")");
  if ((it.kind === "open") !== (src.kind === "open")) return toast("Openings can only match other openings");
  if (it.locked) return lockedMsg();
  let matched = it, matchedPt = hit.pt;
  if (src.type === "count") {
    const point = it.pts[hit.pt];
    if (!point) return toast("Could not identify that count marker — try again");
    const host = P.proj.items.find(i => i.id !== it.id && i.cond === src.cond && i.file === it.file && i.page === it.page && i.kind === "shape");
    if (host && host.locked) return toast("Unlock the matching count group before adding this marker");
    if (host) {
      matchedPt = host.pts.length;
      mutate(() => {
        it.pts.splice(hit.pt, 1); host.pts.push(point.slice()); applyMatchProperties(host, src);
        if (!it.pts.length) P.proj.items = P.proj.items.filter(i => i.id !== it.id);
      }, "Match properties");
      matched = host;
    } else if (it.pts.length > 1) {
      mutate(() => {
        it.pts.splice(hit.pt, 1);
        matched = Object.assign(JSON.parse(JSON.stringify(it)), {id: uid("I"), pts: [point.slice()]});
        applyMatchProperties(matched, src); P.proj.items.push(matched);
      }, "Match properties");
      matchedPt = 0;
    } else {
      mutate(() => applyMatchProperties(it, src), "Match properties");
    }
  } else {
    mutate(() => applyMatchProperties(it, src), "Match properties");
  }
  setSel([matched.id], matchedPt); refresh(); hint();
  toast("Matched to " + src.name + " — click another target or Esc to finish", 2600);
}
function hitItem(sp){ const h = hitInfo(sp); return h ? h.it : null; }
function underCursor(sp){   // every object under a screen point, top first (Tab steps through them)
  const q = toBase(sp[0], sp[1]), out = [];
  pageMarks().slice().reverse().forEach(m => { if (markAt(sp, m)) out.push(m.id); });
  pageItems().slice().reverse().forEach(it => { const c = cond(it.cond); if (!c) return;
    if (c.type === "count") { if (vertexAt(it, sp) >= 0) out.push(it.id); return; }
    const closed = closedOf(it), poly = itemPoly(it); let on = false;
    for (let i = 1; i < poly.length + (closed ? 1 : 0) && !on; i++) on = distSeg(sp, toScr(poly[i - 1]), toScr(poly[i % poly.length])) <= HIT_PX;
    if (on || (closed && pointInPoly(q, poly))) out.push(it.id); });
  return out;
}
function cycleSel(){
  if (!S.cursorScr || S.tool !== "select") return false;
  const L = underCursor(S.cursorScr); if (L.length < 2) return false;
  const cur = S.sel || S.selMark, i = L.indexOf(cur), j = (i + 1) % L.length;
  setSel([L[j]]); refresh(); toast((j + 1) + " of " + L.length + " under the cursor — Tab for the next", 1800); return true;
}
function selectDown(sp, e){
  const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, one = selOne();
  { const mo = S.selMark && !S.multi.size ? objById(S.selMark) : null;   // the selected markup's handles: resize, move a point
    if (mo && onPage(mo) && !mo.locked && !shift && !ctrl && !alt) { const hi = mkHandleAt(mo, sp); if (hi >= 0) { S.drag = {mh: hi, mark: mo.id, orig: mo.pts.map(p => p.slice()), sp0: sp}; draw(); return; } } }
  if (one && !one.locked && !shift && !ctrl && !alt) {   // the selected outline's own handles first
    const vi = vertexAt(one, sp);
    if (vi >= 0) { S.drag = {vertex: vi, item: one.id, orig: one.pts.map(p => p.slice()), sp0: sp}; S.selPt = vi; draw(); return; }
    const gi = ghostAt(one, sp);
    if (gi >= 0) { S.drag = {ghost: gi, item: one.id, sp0: sp}; return; }   // the + becomes a new point once it is dragged (a click on it is just a click)
  }
  if (one && !one.locked && shift && editPts(one)) {   // Bluebeam: Shift+click a point removes it, Shift+click a side adds one
    const vi = vertexAt(one, sp); if (vi >= 0) return delPoint(one, vi);
    const sg = segAt(one, sp); if (sg) return addPoint(one, sg.i, sg.p);
  }
  const mk = markAt(sp), hi = mk ? null : hitInfo(sp), id = mk ? mk.id : hi ? hi.it.id : null, ids = selIds(), inSel = !!id && ids.has(id);
  if (shift) {   // add to / take out of the selection; a drag from here adds a box
    if (S.sel) S.multi.add(S.sel); if (S.selMark) S.multi.add(S.selMark); S.sel = null; S.selMark = null;
    if (id) { if (S.multi.has(id)) S.multi.delete(id); else S.multi.add(id); }
    if (S.multi.size === 1) setSel([...S.multi]);
    S.box = {a: sp, b: sp, add: true, pending: true}; refresh(); return;
  }
  if (!id) { setSel([]); S.box = {a: sp, b: sp, pending: true}; refresh(); return; }
  if (ctrl) { S.press = {sp, id, copy: true, toggle: true}; return; }   // Ctrl+drag copies; Ctrl+click adds / takes out
  if (inSel) { S.press = {sp, id, collapse: ids.size > 1, pt: hi ? hi.pt : -1}; if (hi && hi.pt >= 0 && id === S.sel) { S.selPt = hi.pt; draw(); } return; }
  setSel([id], hi ? hi.pt : -1);
  if (mk || alt || (hi && (hi.edge || hi.pt >= 0))) S.press = {sp, id};   // taken by its line / marker (or Alt: anywhere) — a drag moves it
  else S.box = {a: sp, b: sp, pending: true};   // clicked inside an area: a drag from here selects with a box
  refresh();
}
function pressClick(pr){   // a press on an object that did not become a drag
  if (pr.toggle) { const ids = selIds(); if (ids.has(pr.id)) ids.delete(pr.id); else ids.add(pr.id); setSel([...ids]); refresh(); return; }
  if (pr.collapse) { setSel([pr.id], pr.pt); refresh(); }
}
function hoverAt(sp, e){
  let id = null, cur = "";
  { const mo = S.selMark && !S.multi.size ? objById(S.selMark) : null;
    if (mo && onPage(mo) && !mo.locked) { const hi = mkHandleAt(mo, sp); if (hi >= 0) { const box = MK_BOXY.has(mo.type) || mo.type === "pen" || (mo.type === "callout" && hi > 0), c = mo.type === "callout" ? hi - 1 : hi;
      if (S.hover !== mo.id) S.hover = mo.id; stage().style.cursor = box ? (c % 2 ? "nesw-resize" : "nwse-resize") : "grab"; return; } } }
  const one = selOne();
  if (one && !one.locked && vertexAt(one, sp) >= 0) { cur = "grab"; id = one.id; }
  else if (one && ghostAt(one, sp) >= 0) { cur = "copy"; id = one.id; }
  else { const mk = markAt(sp), hi = mk ? null : hitInfo(sp); id = mk ? mk.id : hi ? hi.it.id : null;
    if (id) cur = e.ctrlKey || e.metaKey ? "copy" : selIds().has(id) || mk || hi.edge || hi.pt >= 0 ? (objById(id).locked ? "not-allowed" : "move") : "pointer"; }
  if (S.hover !== id) S.hover = id;
  stage().style.cursor = cur;
}
function startMove(pr, e){
  S.press = null; S.box = null;
  const before = [...selIds()];
  let ids = selIds().has(pr.id) ? selIds() : new Set([pr.id]);
  if (!pr.copy) { const all = ids.size; ids = new Set([...ids].filter(id => !(objById(id) || {}).locked)); if (!ids.size) { toast("Locked — right-click → Unlock to move it", 2500); return; } if (ids.size < all) toast((all - ids.size) + " locked — left where they are", 2000); }
  let added = [];
  if (pr.copy) { const cl = clipOf(ids); if (!cl) return; added = placeClip(cl, null, {raw: true}).ids; ids = new Set(added); setSel(added); }
  const orig = new Map(); ids.forEach(id => { const o = objById(id); if (o) orig.set(id, o.pts.map(p => p.slice())); });
  const g0 = toBase(pr.sp[0], pr.sp[1]); let g = g0, gv = false;   // the grab point: the nearest point of the object when it is close, so it snaps onto the drawing
  const o0 = objById(added.length ? added[0] : pr.id);
  if (o0) o0.pts.forEach(p => { if (dist(toScr(p), pr.sp) <= 2 * HIT_PX && (!gv || dist(p, g0) < dist(g, g0))) { g = p.slice(); gv = true; } });
  S.drag = {move: true, ids, orig, sp0: pr.sp, g, gv, copy: !!pr.copy, added, before, d: [0, 0]};
  stage().style.cursor = pr.copy ? "copy" : "move";
  moveDrag(evPos(e), e);
}
function moveDrag(sp, e){
  const D = S.drag, t = toBase(sp[0], sp[1]);
  let dx = t[0] - toBase(D.sp0[0], D.sp0[1])[0], dy = t[1] - toBase(D.sp0[0], D.sp0[1])[1];
  S.snap = null;
  if (D.gv && !e.altKey) { const s = snapAt([D.g[0] + dx, D.g[1] + dy], it => D.ids.has(it.id)); if (s) { dx = s.p[0] - D.g[0]; dy = s.p[1] - D.g[1]; S.snap = s; } }
  if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }   // Shift: straight across, or straight up / down
  D.orig.forEach((pts, id) => { const o = objById(id); if (o) o.pts = pts.map(p => [p[0] + dx, p[1] + dy]); });
  D.d = [dx, dy]; D.moved = D.moved || Math.hypot(dx, dy) * S.view.s > 0.5;
  S.cursorScr = sp; S.cursor = t;
  const k = hereScale(t);
  $("stMeas").innerHTML = "<b>" + (D.copy ? "Copy" : "Move") + (k ? " " + f3(dx / k) + " ft, " + f3(dy / k) + " ft (" + f3(Math.hypot(dx, dy) / k) + " ft)" : "") + "</b>";
  draw();
}
function endMove(){
  const D = S.drag; S.drag = null; stage().style.cursor = ""; S.snap = null;
  if (!D.moved) { if (D.added.length) { const a = new Set(D.added); P.proj.items = P.proj.items.filter(i => !a.has(i.id)); P.proj.marks = (P.proj.marks || []).filter(m => !a.has(m.id)); setSel(D.before); } refresh(); return; }
  const fin = new Map(); D.orig.forEach((pts, id) => { const o = objById(id); if (o) { fin.set(id, o.pts); o.pts = pts; } });
  let objs = [];
  if (D.added.length) { const a = new Set(D.added); objs = P.proj.items.filter(i => a.has(i.id)).concat((P.proj.marks || []).filter(m => a.has(m.id))); P.proj.items = P.proj.items.filter(i => !a.has(i.id)); P.proj.marks = (P.proj.marks || []).filter(m => !a.has(m.id)); }
  const k = hereScale(D.g), n = D.ids.size, keep = [];
  mutate(() => {
    if (D.added.length) objs.forEach(o => { o.pts = fin.get(o.id) || o.pts;
      if (P.proj.items.indexOf(o) < 0 && o.cond) { const c = cond(o.cond), host = c && c.type === "count" ? P.proj.items.find(i => i.cond === o.cond && onPage(i) && i.kind === "shape") : null;   // copied count markers join the page's count
        if (host) { o.pts.forEach(p => { if (!host.pts.some(q => dist(q, p) < 0.5)) host.pts.push(p); }); keep.push(host.id); return; }
        P.proj.items.push(o); keep.push(o.id); }
      else if (!o.cond) { (P.proj.marks = P.proj.marks || []).push(o); keep.push(o.id); } });
    else fin.forEach((pts, id) => { const o = objById(id); if (o) { o.pts = pts; if (o.cond) qaMoved(o); } });
  }, (D.copy ? "Copy " : "Move ") + n + " object" + (n > 1 ? "s" : ""));
  if (D.added.length) setSel(keep); refresh();
  if (k) toast((D.copy ? "Copied " : "Moved ") + n + " by " + f3(Math.hypot(D.d[0], D.d[1]) / k) + " ft" + (D.copy ? "" : " — Ctrl+Z puts " + (n > 1 ? "them" : "it") + " back"), 2200);
}
/* box (window / crossing) and lasso: what is selected */
function objPolyScr(o){ if (!o.cond) return mkPolyScr(o); const c = o.cond ? cond(o.cond) : null; const poly = o.cond ? itemPoly(o) : o.pts; return {P: poly.map(toScr), closed: o.cond ? closedOf(o) : o.type === "hilite" || o.type === "cloud", count: !!(c && c.type === "count")}; }
function segsCross(a, b, c, d){ const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
function touchesPoly(O, L){   // an object (screen outline) touching a closed screen polygon L
  if (O.P.some(p => pointInPoly(p, L))) return true;
  if (O.count) return false;
  if (O.closed && L.some(p => pointInPoly(p, O.P))) return true;
  const n = O.closed ? O.P.length : O.P.length - 1;
  for (let i = 0; i < n; i++) { const a = O.P[i], b = O.P[(i + 1) % O.P.length]; for (let j = 0; j < L.length; j++) if (segsCross(a, b, L[j], L[(j + 1) % L.length])) return true; }
  return false;
}
function boxSelect(){
  const b = S.box; S.box = null; if (!b || b.pending) { draw(); return; }
  const x0 = Math.min(b.a[0], b.b[0]), x1 = Math.max(b.a[0], b.b[0]), y0 = Math.min(b.a[1], b.b[1]), y1 = Math.max(b.a[1], b.b[1]);
  if (x1 - x0 < 4 && y1 - y0 < 4) { draw(); return; }
  const cross = b.b[0] < b.a[0], R = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], inB = q => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
  const ids = b.add ? selIds() : new Set();
  pageItems().concat(pageMarks()).forEach(o => { const O = objPolyScr(o); if (cross ? touchesPoly(O, R) : O.P.every(inB)) ids.add(o.id); });
  setSel([...ids]); refresh();
  if (ids.size) toast(ids.size + " selected — " + (cross ? "touching the box (right → left)" : "wholly inside the box (left → right)") + " · Delete removes · drag moves · right-click for more", 3200);
}
function lassoEnd(){
  const L = S.lasso; S.lasso = null;
  if (L.pts.length < 3) { draw(); return; }
  const ids = L.add ? selIds() : new Set();
  pageItems().concat(pageMarks()).forEach(o => { if (touchesPoly(objPolyScr(o), L.pts)) ids.add(o.id); });
  setSel([...ids]); setTool("select"); refresh();
  toast(ids.size ? ids.size + " selected by the lasso" : "Nothing inside the lasso", 2200);
}
function zoomBoxEnd(){
  const z = S.zbox; S.zbox = null; const st = stage();
  if (Math.abs(z.b[0] - z.a[0]) < 8 && Math.abs(z.b[1] - z.a[1]) < 8) zoomAt(2, z.a[0], z.a[1]);
  else { const a = toBase(Math.min(z.a[0], z.b[0]), Math.min(z.a[1], z.b[1])), b = toBase(Math.max(z.a[0], z.b[0]), Math.max(z.a[1], z.b[1]));
    const s2 = Math.max(0.05, Math.min(5000, Math.min(st.clientWidth / (b[0] - a[0]), st.clientHeight / (b[1] - a[1]))));
    S.view = {s: s2, tx: st.clientWidth / 2 - (a[0] + b[0]) / 2 * s2, ty: st.clientHeight / 2 - (a[1] + b[1]) / 2 * s2}; applyView(); renderHi(); }
  setTool(S.prevTool && S.prevTool !== "zoomwin" ? S.prevTool : "select");
}
function zoomTo(ids){
  const pts = [...ids].map(objById).filter(onPage).flatMap(o => o.cond ? itemPoly(o) : o.pts); if (!pts.length) return;
  const st = stage(), x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1])), m = 40 / S.view.s;
  const s2 = Math.max(0.05, Math.min(5000, Math.min(st.clientWidth / (x1 - x0 + 2 * m), st.clientHeight / (y1 - y0 + 2 * m))));
  S.view = {s: s2, tx: st.clientWidth / 2 - (x0 + x1) / 2 * s2, ty: st.clientHeight / 2 - (y0 + y1) / 2 * s2}; applyView(); renderHi();
}
function selectAll(){
  setSel(pageItems().map(i => i.id).concat(pageMarks().map(m => m.id)));
  setTool("select"); refresh(); toast(selIds().size + " selected on this page", 2000);
}
function selectSimilar(o){   // every object of the same condition (or markup type) on this page
  const ids = o.cond ? pageItems().filter(i => i.cond === o.cond).map(i => i.id) : pageMarks().filter(m => m.type === o.type).map(m => m.id);
  setSel(ids); setTool("select"); refresh(); toast(ids.length + " × " + (o.cond ? cond(o.cond).name : MARK_TOOLS[o.type]) + " selected on this page", 2200);
}
function nudgeSel(dx, dy){   // arrow keys: move the selection (screen pixels)
  const ids = new Set([...selIds()].filter(id => !(objById(id) || {}).locked)); if (!ids.size) return false; const d = [dx / S.view.s, dy / S.view.s];
  mutate(() => { P.proj.items.forEach(i => { if (ids.has(i.id)) { i.pts = i.pts.map(p => [p[0] + d[0], p[1] + d[1]]); qaMoved(i); } });
    (P.proj.marks || []).forEach(m => { if (ids.has(m.id)) m.pts = m.pts.map(p => [p[0] + d[0], p[1] + d[1]]); }); }, "Nudge");
  return true;
}
function addCount(p){
  const c = cond(S.cond); if (!c) return;
  let it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape");
  mutate(() => {
    if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
    it.pts.push(p);
  }, "Count " + c.name);
}
async function finish(pts){
  const c = S.cond ? cond(S.cond) : null, t = S.tool, arcs = (S.draftArcs || []).filter(a => a[1] < pts.length).map(a => a.slice()), resume = S.resume;
  draftClear(); S.draftRedo = []; S.resume = null; hint();
  if (t === "measure") { S.measure = pts; S.measures.push(pts); draw(); return; }
  if (t === "mk_polyline" || t === "mk_polygon") { mkPoly(t, pts); return; }
  if (t === "fence") { if (pts.length >= 2) mutate(() => { (P.proj.marks = P.proj.marks || []).push({id: uid("M"), type: "fence", file: S.fileId, page: S.pageNo, pts, text: "", color: "#ff7a00", at: new Date().toISOString()}); }); draw(); return; }
  if (t === "vp") {
    const r = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
    if (r[2] - r[0] < 2 || r[3] - r[1] < 2) { draw(); return; }
    const inside = (S.texts[S.key] || []).filter(x => x.x >= r[0] && x.x <= r[2] && x.y >= r[1] && x.y <= r[3]).map(x => inPerFtOf(x.s)).find(x => x.v);
    const v = await ask("Viewport", `<div class="grid"><div class="fg w2"><label>Name</label><input type="text" id="vpName" placeholder="e.g. Toilet detail" value="Detail ${((P.proj.viewports || {})[S.key] || []).length + 1}"></div>
      <div class="fg w2"><label>Scale written for it</label><input type="text" id="vpSc" placeholder='e.g. 1/4" = 1&#39;-0" or 1:50' value="${inside ? esc(inside.label) : ""}"></div></div>
      <p class="small" style="margin-top:8px">Leave the scale empty to calibrate it from a known dimension inside the viewport next.${(P.proj.scales[S.key] || {}).factor && Math.abs(P.proj.scales[S.key].factor - 1) > 0.02 ? " This PDF page is printed at × " + P.proj.scales[S.key].factor.toFixed(3) + " of its paper size; the same factor is applied." : ""}</p>`, "Add viewport",
      () => { const n = $("vpName").value.trim() || "Viewport", t2 = $("vpSc").value.trim(), sc = t2 ? inPerFtOf(t2, true) : {v: 0}; if (t2 && !(sc.v > 0)) return "Write the scale like 1/4\" = 1'-0\" or 1:50 — or leave it empty to calibrate"; return {n, sc, t2}; }, "vpName");
    if (!v) { setTool("select"); return; }
    const id = uid("V"), f = (P.proj.scales[S.key] || {}).factor || 1;
    mutate(() => { P.proj.viewports = P.proj.viewports || {}; (P.proj.viewports[S.key] = P.proj.viewports[S.key] || []).push({id, name: v.n, r, ptPerFt: v.sc.v ? 72 * v.sc.v * f : 0, text: v.sc.v ? v.sc.label : ""}); });
    if (!v.sc.v) { S.calVp = id; setTool("cal"); toast("Now click both ends of a known dimension inside the viewport", 4000); } else { setTool("select"); toast("Viewport added: " + v.n + " at " + v.sc.label); }
    return;
  }
  if (t === "cal") {
    const d = dist(pts[0], pts[1]); if (d < 1) { draw(); return; }
    const vp = S.calVp && ((P.proj.viewports || {})[S.key] || []).find(x => x.id === S.calVp);
    if (vp) {
      const v = await ask("Viewport scale — " + vp.name, `<p>The two points are <b>${d.toFixed(2)} pt</b> apart. Enter the real length they measure.</p><div class="grid" style="margin-top:10px"><div class="fg w2"><label>Real length (ft, or ft-in like 12'-6")</label><input type="text" id="dlgLen" autocomplete="off"></div></div>`, "Set scale",
        () => { const ft = parseFt($("dlgLen").value); return ft > 0 ? ft : "Enter a length, e.g. 12.5 or 12'-6\""; }, "dlgLen");
      S.calVp = null;
      if (v) mutate(() => { vp.ptPerFt = d / v; vp.text = "calibrated: " + f3(v) + " ft over " + d.toFixed(2) + " pt"; });
      setTool("select"); return;
    }
    const v = await ask("Set the scale", `<p>The two points are <b>${d.toFixed(2)} pt</b> apart on the sheet. Enter the real length they measure.</p>
      <div class="grid" style="margin-top:10px"><div class="fg w2"><label>Real length (ft, or ft-in like 12'-6")</label><input type="text" id="dlgLen" autocomplete="off"></div>
      <div class="fg w2"><label><input type="checkbox" id="dlgAll" style="width:auto"> Then choose other pages to copy it to (Copy scale to…)</label></div></div>`, "Set scale",
      () => { const ft = parseFt($("dlgLen").value); if (!(ft > 0)) return "Enter a length, e.g. 12.5 or 12'-6\""; return {ft, all: $("dlgAll").checked}; }, "dlgLen");
    if (v) mutate(() => {
      const k = d / v.ft;
      P.proj.scales[S.key] = {ptPerFt: k, how: "calibrated", text: f3(v.ft) + " ft over " + d.toFixed(2) + " pt", cal: {a: pts[0], b: pts[1], ft: v.ft, page: S.key}, verified: true, at: new Date().toISOString()};
      toast("Scale set: 1 ft = " + k.toFixed(4) + " pt");
    });
    setTool("select");
    if (v && v.all) copyScaleDialog();
    return;
  }
  if (!c) return;
  if (t === "open") {
    const ko = hereScale(pts[0]), w = ko ? dist(pts[0], pts[1]) / ko : 0, sticky = schOf(S.openMark);
    if (sticky) { mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "open", pts, nos: 1, label: sticky.mark, sch: sticky.id, oh: sticky.h, ow: sticky.w}); }); draw(); return; }
    const OP = P.proj.openings || [];
    const pr = ask("Opening", `<div class="grid"><div class="fg w2"><label>Schedule mark</label><select id="dlgSch"><option value="">— new / not in the schedule —</option>${OP.map(o => `<option value="${esc(o.id)}">${esc(o.mark)} — ${f3(o.w)} × ${f3(o.h)} ft · ${esc(o.type)}</option>`).join("")}</select></div>
      <div class="fg"><label>Width (ft)</label><input type="text" id="dlgW" value="${w ? f3(w) : ""}"></div>
      <div class="fg"><label>Height (ft)</label><input type="text" id="dlgH" value="${P.proj.last.oh ? f3(P.proj.last.oh) : ""}" autocomplete="off"></div>
      <div class="fg"><label>Label / mark</label><input type="text" id="dlgLbl" placeholder="e.g. D1 / W2"></div>
      <div class="fg"><label>Type</label><select id="dlgTyp"><option>door</option><option>window</option><option>other</option></select></div>
      <div class="fg w2"><label><input type="checkbox" id="dlgSave" style="width:auto"> Add this mark to the opening schedule</label><label><input type="checkbox" id="dlgKeep" style="width:auto"> Keep placing this mark without asking (Esc or another tool stops)</label></div></div>
      <p class="small" style="margin-top:8px">Deducted from <b>${esc(c.name)}</b> as its own row. Openings of ${f2(+c.dedMin || 0)} Sft or less are listed but not deducted (house rule). A schedule mark's size wins over the clicked width.</p>`, "Add opening",
      () => { const sch = schOf($("dlgSch").value), W = parseFt($("dlgW").value), H = parseFt($("dlgH").value), lbl = $("dlgLbl").value.trim();
        if (sch) return {sch, W: sch.w, H: sch.h, lbl: sch.mark, keep: $("dlgKeep").checked};
        if (!(W > 0)) return "Enter the width"; if (c.unit !== "ft" && !(H > 0)) return "Enter the height";
        if ($("dlgSave").checked) { if (!lbl) return "Give the mark (e.g. D1) to add it to the schedule"; if (!(H > 0)) return "Enter the height for the schedule"; if (OP.some(o => o.mark.toUpperCase() === lbl.toUpperCase())) return lbl + " is already in the schedule — pick it above"; }
        return {W, H, lbl, add: $("dlgSave").checked, type: $("dlgTyp").value, keep: $("dlgKeep").checked}; }, "dlgH");
    const syncSch = () => { const s = schOf($("dlgSch").value); ["dlgW", "dlgH", "dlgLbl", "dlgTyp", "dlgSave"].forEach(id => { $(id).disabled = !!s; }); if (s) { $("dlgW").value = f3(s.w); $("dlgH").value = f3(s.h); $("dlgLbl").value = s.mark; $("dlgTyp").value = s.type; } };
    $("dlgSch").onchange = syncSch;
    $("dlgLbl").oninput = () => { const l = $("dlgLbl").value.trim(); $("dlgSave").checked = !!l && !OP.some(o => o.mark.toUpperCase() === l.toUpperCase()); if (/^d/i.test(l)) $("dlgTyp").value = "door"; else if (/^[wv]/i.test(l)) $("dlgTyp").value = "window"; };
    const v = await pr;
    if (v) mutate(() => {
      let sch = v.sch; if (!sch && v.add) { sch = {id: uid("O"), mark: v.lbl, type: v.type, w: r3(v.W), h: r3(v.H)}; P.proj.openings.push(sch); }
      P.proj.last.oh = v.H;
      const it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "open", pts, nos: 1, label: v.lbl, oh: v.H, ow: Math.abs(v.W - w) > 0.0005 ? v.W : 0};
      if (sch) { it.sch = sch.id; it.ow = sch.w; it.oh = sch.h; }
      P.proj.items.push(it);
      if (v.keep && sch) S.openMark = sch.id;
    });
    hint(); draw(); return;
  }
  if (t === "circle") { if (dist(pts[0], pts[1]) < 0.5) { draw(); return; } mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", shape: "circle", pts, nos: 1, label: ""}); }); return; }
  const area = c.type === "area";
  if (area && (pts.length < 3 || polyArea(pts) < 1e-6)) { if (selfCross(pts)) toast("⚠ This outline crosses itself and its two halves cancel out (0 Sft) — nothing added. Draw it again without crossing the sides.", 7000); draw(); return; }   // a figure of eight with equal halves: said why, never dropped silently
  if (!area && pts.length < 2) { draw(); return; }
  const ri = resume && P.proj.items.find(i => i.id === resume.id);
  if (ri) {   // a run continued (right-click → Continue drawing): the same measurement, longer
    const np = resume.atStart ? pts.slice().reverse() : pts;
    mutate(() => { ri.pts = np; delete ri.arcs; qaMoved(ri); }, "Continue run");
    S.sel = null; toast("Run continued: " + f3(polyLen(np) / (itemScale(ri) || 1)) + (itemScale(ri) ? " ft" : " pt"), 1800); return;
  }
  const nm = area && t !== "ded" && S.lbl.autoName ? roomNameAt(pts) : "";
  const ni = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: t === "ded" ? "ded" : "shape", pts, nos: 1, label: nm};
  if (arcs.length) ni.arcs = arcs;
  mutate(() => { P.proj.items.push(ni); }, (t === "ded" ? "Deduction" : area ? "Area" : "Run") + " in " + c.name);
  if (area && crossed(ni)) toast(crossMsg, 7000);
  else if (nm) toast("Named " + nm + " from the drawing", 1800);
}

/* ------------------------------------------------------------------ overlay */
let raf = 0;
function draw(){ if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
function drawNow(){
  const svg = $("ov"), svg2 = $("ov2"), tip = $("tip");
  if (!S.page || !P.proj) { svg.innerHTML = ""; svg2.innerHTML = ""; S.ovSig = null; S.ovHtml = ""; tip.style.display = "none"; return; }
  /* two layers: the takeoff (measurements, markups, labels — rebuilt only when it or the view changes) and, above it,
     what follows the cursor (the shape being drawn, snap marker, selection box). A mouse move over a page with a
     thousand measurements then redraws only the cursor layer. */
  let k = curScale(); const h = [], dyn = [];
  const sig = [P.proj.id, S.ver, S.key, S.view.s, S.view.tx, S.view.ty, S.sel, S.selMark, [...S.multi].join(","), S.hover, S.selPt, S.tool, S.hideMk, JSON.stringify(S.lbl), S.drag || S.typ ? Math.random() : 0, S.autoShow ? S.autoShow.key + S.autoShow.url.length : ""].join("|");
  const keep = sig === S.ovSig;
  if (!keep) h.push('<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(208,59,59,.08)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(208,59,59,.55)" stroke-width="1.5"/></pattern></defs>');
  const ptsS = P => P.map(p => toScr(p).map(v => v.toFixed(1)).join(",")).join(" ");
  const A = S.autoShow; if (!keep && A && A.key === S.key) { const q = toScr([A.x0, A.y0]); h.push(`<image href="${A.url}" x="${q[0].toFixed(1)}" y="${q[1].toFixed(1)}" width="${(A.W * A.px * S.view.s).toFixed(1)}" height="${(A.H * A.px * S.view.s).toFixed(1)}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`); }
  if (!keep) ((P.proj.viewports || {})[S.key] || []).forEach(v => { const a = toScr([v.r[0], v.r[1]]), b = toScr([v.r[2], v.r[3]]);
    h.push(`<rect x="${a[0].toFixed(1)}" y="${a[1].toFixed(1)}" width="${(b[0] - a[0]).toFixed(1)}" height="${(b[1] - a[1]).toFixed(1)}" fill="none" stroke="#7b5ce0" stroke-width="1.5" stroke-dasharray="8 4"/>`);
    h.push(label([a[0] + 6 + (v.name.length + 14) * 3.2, a[1] + 12], v.name + " · " + (v.ptPerFt ? v.text || "own scale" : "scale not set"), "#4b3b8f")); });
  if (!keep && !S.hideMk) (P.proj.marks || []).filter(m => m.file === S.fileId && m.page === S.pageNo && !mkHidden(m)).forEach(m => h.push(markSvg(m, toScr, 1)));
  if (!keep && !S.hideMk && S.selMark && !S.multi.size && S.tool === "select") { const m = objById(S.selMark); if (m && onPage(m) && !m.locked) h.push(mkHandlesSvg(m)); }
  if (!keep && S.typ) {   // typical copy: reference points, and the copies placed by them (dashed) before they are confirmed
    const T = S.typ;
    if (T.T && S.key !== T.src) T.mine.forEach(it => { const c = cond(it.cond), Q = (it.shape === "circle" ? itemPoly(it) : it.pts).map(T.T.f);
      if (c && c.type === "count") Q.forEach(p => { const q = toScr(p); h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="7" fill="none" stroke="#7b5ce0" stroke-width="2" stroke-dasharray="3 2"/>`); });
      else h.push(`<${c && c.type === "area" || it.shape === "circle" ? "polygon" : "polyline"} points="${ptsS(Q)}" fill="${c && c.type === "area" ? "rgba(123,92,224,.10)" : "none"}" stroke="#7b5ce0" stroke-width="2" stroke-dasharray="7 4"/>`); });
    (S.key === T.src ? T.a : T.b).forEach((p, i) => { const q = toScr(p); h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="9" fill="rgba(255,45,85,.15)" stroke="#ff2d55" stroke-width="2"/><text x="${(q[0] + 12).toFixed(1)}" y="${(q[1] - 10).toFixed(1)}" font-size="13" font-weight="700" fill="#ff2d55" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1}</text>`); });
  }
  if (S.tool === "vsearch" && S.draft.length && S.cursor) { const a = toScr(S.draft[0]), b = toScr(S.cursor); dyn.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="rgba(42,120,214,.08)" stroke="#2a78d6" stroke-width="1.5" stroke-dasharray="4 3"/>`); }
  if (mkIsTool(S.tool)) dyn.push(mkDraftSvg());
  if (["cloud", "arrow", "dimension", "hilite"].indexOf(S.tool) >= 0 && S.draft.length && S.cursor) dyn.push(markSvg({type: S.tool, pts: [S.draft[0], S.cursor], color: S.tool === "dimension" ? "#2b7de9" : "#d03b3b", size: 13, width: 2, arrow: 10}, toScr, 1));
  if (S.flash && S.flash.key === S.key && Date.now() < S.flash.until) { const q = toScr(S.flash.p); dyn.push(`<circle cx="${q[0]}" cy="${q[1] - 5}" r="26" fill="none" stroke="#ff2d55" stroke-width="3"><animate attributeName="r" values="18;30;18" dur="1s" repeatCount="indefinite"/></circle>`); }
  if (S.tool === "vp" && S.draft.length && S.cursor) { const a = toScr(S.draft[0]), b = toScr(S.cursor); dyn.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="rgba(123,92,224,.06)" stroke="#7b5ce0" stroke-width="1.5" stroke-dasharray="8 4"/>`); }
  if (S.box && !S.box.pending) { const a = S.box.a, b = S.box.b, cr = b[0] < a[0];   // window (left → right, blue, solid) / crossing (right → left, green, dashed)
    dyn.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="${cr ? "rgba(27,175,122,.10)" : "rgba(42,120,214,.10)"}" stroke="${cr ? "#139a68" : "#2a78d6"}" stroke-width="1.5" ${cr ? 'stroke-dasharray="6 4"' : ""}/>`);
    dyn.push(label([Math.min(a[0], b[0]) + 52, Math.min(a[1], b[1]) - 12], cr ? "touching ← crossing" : "window → wholly inside", cr ? "#0e7a52" : "#1d5fae")); }
  if (S.lasso && S.lasso.pts.length > 1) dyn.push(`<polygon points="${S.lasso.pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="rgba(27,175,122,.10)" stroke="#139a68" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  if (S.zbox) { const a = S.zbox.a, b = S.zbox.b; dyn.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="rgba(15,41,66,.06)" stroke="#0f2942" stroke-width="1.5" stroke-dasharray="3 3"/>`); }
  if (!keep && !S.hideMk) P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && !hiddenItem(i)).forEach(it => {
    const c = cond(it.cond); if (!c) return;
    const col = c.color, sel = it.id === S.sel || S.multi.has(it.id), k = itemScale(it), pts0 = it.pts;
    if (it.shape === "circle") it = Object.assign({}, it, {pts: itemPoly(it), _pts: pts0});
    if ((it.id === S.hover && S.tool === "select" && !S.drag) || (sel && S.multi.size)) {   // hover glow (Bluebeam), and every object of a multiple selection
      const gc = sel ? "#4b3b8f" : col;
      if (c.type === "count") it.pts.forEach(p => { const q = toScr(p); h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="15" fill="none" stroke="${gc}" stroke-width="4" opacity=".35"/>`); });
      else h.push(`<${c.type === "area" || it._pts ? "polygon" : "polyline"} points="${ptsS(it.pts)}" fill="none" stroke="${gc}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" opacity="${sel ? 0.28 : 0.22}"/>`);
    }
    if (c.type === "count") {
      h.push(countSvg(c, it.pts, toScr, 1, sel ? S.selPt : -1));
      if (it.locked && sel) it.pts.forEach(p => { const q = toScr(p); h.push(lockBadge([q[0] + 9, q[1] - 12])); });
      return;
    }
    if (it.kind === "open") {
      const a = toScr(it.pts[0]), b = toScr(it.pts[1]);
      h.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d03b3b" stroke-width="${sel ? 6 : Math.max(1, +c.sw || 4)}" stroke-linecap="round" opacity=".85"/>`);
      if (k) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = rowsOf(it, k)[0]; h.push(label(m, (it.label ? it.label + " " : "") + f3(r.L) + " × " + f3(+it.oh || 0), "#9b2222")); }
    } else if (c.type === "area") {
      const ded = it.kind === "ded";
      h.push(`<polygon points="${ptsS(it.pts)}" fill="${ded ? "url(#hatch)" : col}" fill-opacity="${ded ? 1 : 0.22}" stroke="${ded ? "#d03b3b" : col}" stroke-width="${sel ? 3 : Math.max(1, +c.sw || 1.6)}" ${ded ? 'stroke-dasharray="5 3"' : ""}/>`);
      if (k && S.lbl.on) { const scr = it.pts.map(toScr), ar = polyArea(scr); if (ar > 2500 || sel || !S.lbl.small) { const L = capLines(it._pts ? Object.assign({}, it, {pts: it._pts}) : it, c, k); if (L.length) h.push(labelBox(labelPt(scr), L, ded ? "#9b2222" : "#0b0b0b")); } }
    } else {
      const ded = it.kind === "ded";
      h.push(`<poly${it._pts ? "gon" : "line"} points="${ptsS(it.pts)}" fill="none" stroke="${ded ? "#d03b3b" : col}" stroke-width="${sel ? 5 : Math.max(1, +c.sw || 3)}" stroke-linejoin="round" stroke-linecap="round" opacity=".85" ${ded ? 'stroke-dasharray="7 4"' : ""}/>`);
      if (k && S.lbl.on && (sel || polyLen(it.pts) * S.view.s > 60 || !S.lbl.small)) { const L = capLines(it._pts ? Object.assign({}, it, {pts: it._pts}) : it, c, k); if (L.length) h.push(labelBox(lineLabelPt(it.pts.map(toScr)), L, ded ? "#9b2222" : "#0b0b0b")); }
    }
    if (k && it.kind !== "open" && it.shape !== "circle" && (sel || (S.lbl.on && S.lbl.seg))) h.push(segLabels(it.pts.map(toScr), it.pts, k, c.type === "area", 1));
    if (sel && !S.multi.size) {
      (it._pts || it.pts).forEach((p, i) => { const q = toScr(p); h.push(`<rect x="${(q[0] - 4).toFixed(1)}" y="${(q[1] - 4).toFixed(1)}" width="8" height="8" fill="${it.locked ? "#e8ecf1" : i === S.selPt ? "#0b0b0b" : "#fff"}" stroke="${it.locked ? "#8a97a6" : i === S.selPt ? "#0b0b0b" : col}" stroke-width="2"/>`); });
      if (!it.locked && editPts(it) && S.tool === "select") { const n = closedOf(it) ? it.pts.length : it.pts.length - 1;   // a "+" at the middle of each side: drag it to add a point
        for (let i = 0; i < n; i++) { const a = toScr(it.pts[i]), b = toScr(it.pts[(i + 1) % it.pts.length]); if (dist(a, b) < 34) continue; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          h.push(`<g opacity=".85"><circle cx="${m[0].toFixed(1)}" cy="${m[1].toFixed(1)}" r="5" fill="#fff" stroke="${col}" stroke-width="1.5"/><path d="M${(m[0] - 3).toFixed(1)} ${m[1].toFixed(1)}h6M${m[0].toFixed(1)} ${(m[1] - 3).toFixed(1)}v6" stroke="${col}" stroke-width="1.5"/></g>`); } }
      if (it.locked) { const q = toScr((it._pts || it.pts)[0]); h.push(lockBadge([q[0] + 10, q[1] - 14])); }
    }
  });
  const c = S.cond ? cond(S.cond) : null, cur = S.cursor;
  let live = "";
  { const kk = hereScale(S.draft[0] || cur); if (kk) k = kk; }
  if (S.draft.length && cur && S.tool === "circle") {
    const a = S.draft[0], r = dist(a, cur), q = toScr(a), col = c ? c.color : "#0b0b0b";
    dyn.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(r * S.view.s).toFixed(1)}" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-width="2"/>`);
    if (k) live = "dia " + f3(2 * r / k) + " ft · " + fq(Math.PI * r * r / k / k) + " Sft · round " + f3(2 * Math.PI * r / k) + " ft";
  } else if (S.draft.length && cur && !mkIsTool(S.tool)) {
    const D = S.arcMid && S.draft.length ? S.draft.concat(arcPts(S.draft[S.draft.length - 1], S.arcMid, cur)) : S.draft.concat([S.tool === "rect" ? null : cur]).filter(Boolean);
    if (S.arcMode && !S.arcMid && S.draft.length) { const q = toScr(cur); dyn.push(`<text x="${(q[0] + 12).toFixed(1)}" y="${(q[1] - 12).toFixed(1)}" font-size="11" font-weight="700" fill="#4b3b8f" stroke="#fff" stroke-width="3" paint-order="stroke">arc: point on it</text>`); }
    if (S.arcMid) { const q = toScr(S.arcMid); dyn.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5" fill="#4b3b8f"/>`); }
    if (S.tool === "rect") { const a = S.draft[0]; const R = [a, [cur[0], a[1]], cur, [a[0], cur[1]]]; dyn.push(`<polygon points="${ptsS(R)}" fill="${c.color}" fill-opacity=".15" stroke="${c.color}" stroke-width="2"/>`);
      if (k) live = f3(Math.abs(cur[0] - a[0]) / k) + " × " + f3(Math.abs(cur[1] - a[1]) / k) + " ft = " + fq(Math.abs(cur[0] - a[0]) * Math.abs(cur[1] - a[1]) / k / k) + " Sft"; }
    else {
      const col = S.tool === "fence" ? "#ff7a00" : S.tool === "ded" || S.tool === "open" ? "#d03b3b" : S.tool === "measure" || S.tool === "cal" ? "#0b0b0b" : c ? c.color : "#0b0b0b";
      if (isAreaDraft() && D.length >= 3) dyn.push(`<polygon points="${ptsS(D)}" fill="${col}" fill-opacity=".12" stroke="none"/>`);
      dyn.push(`<polyline points="${ptsS(D)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="${S.tool === "measure" || S.tool === "cal" ? "6 3" : "none"}"/>`);
      S.draft.forEach(p => { const q = toScr(p); dyn.push(`<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fff" stroke="${col}" stroke-width="2"/>`); });
      if (k) { const L = polyLen(D) / k, seg = dist(D[D.length - 2], D[D.length - 1]) / k;
        const a1 = D[D.length - 2], a2 = D[D.length - 1], ang = (Math.atan2(a1[1] - a2[1], a2[0] - a1[0]) * 180 / Math.PI + 360) % 360;
        live = (isAreaDraft() && D.length >= 3 ? fq(polyArea(D) / k / k) + " Sft · perimeter " + f3(polyLen(D, true) / k) + " ft" : (D.length > 2 ? "run " + f3(seg) + " · total " : "") + f3(L) + " ft") + " · ∠ " + ang.toFixed(1) + "°" + (D.length > 2 && !isAreaDraft() ? " · corner " + cornerDeg(D[D.length - 3], a1, a2).toFixed(1) + "°" : ""); }
      else if (S.tool === "cal") live = (dist(D[0], D[D.length - 1])).toFixed(2) + " pt";
    }
  }
  S.measures.forEach(m => {   // finished measurements stay until Esc
    dyn.push(`<polyline points="${ptsS(m)}" fill="none" stroke="#0b0b0b" stroke-width="2" stroke-dasharray="6 3"/>`);
    m.forEach(p => { const q = toScr(p); dyn.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.5" fill="#0b0b0b"/>`); });
    if (k) { const q = toScr(m[m.length - 1]); dyn.push(label([q[0] + 8, q[1] - 10], f3(polyLen(m) / k) + " ft", "#0b0b0b")); }
  });
  if (S.snap && cur && ((S.tool !== "select" && S.tool !== "pan") || S.drag)) {
    const q = toScr(S.snap.p), t = S.snap.type;
    if (/endpoint|point/.test(t)) dyn.push(`<rect x="${q[0] - 6}" y="${q[1] - 6}" width="12" height="12" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
    else if (/intersection/.test(t)) dyn.push(`<path d="M${q[0] - 6} ${q[1] - 6}L${q[0] + 6} ${q[1] + 6}M${q[0] + 6} ${q[1] - 6}L${q[0] - 6} ${q[1] + 6}" stroke="#1baf7a" stroke-width="2.2"/>`);
    else if (/perpendicular/.test(t)) dyn.push(`<path d="M${q[0] - 6} ${q[1] + 6}H${q[0] + 6}M${q[0] - 6} ${q[1] + 6}V${q[1] - 6}M${q[0] - 6} ${q[1] + 1}H${q[0] - 1}V${q[1] + 6}" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
    else if (/polar/.test(t)) dyn.push(`<path d="M${q[0]} ${q[1] - 7}L${q[0] + 7} ${q[1]}L${q[0]} ${q[1] + 7}L${q[0] - 7} ${q[1]}Z" fill="none" stroke="#2b7de9" stroke-width="2"/>`);
    else if (/midpoint/.test(t)) dyn.push(`<path d="M${q[0]} ${q[1] - 7}L${q[0] + 6} ${q[1] + 5}L${q[0] - 6} ${q[1] + 5}Z" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
    else dyn.push(`<circle cx="${q[0]}" cy="${q[1]}" r="5" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
  }
  if (!keep) { S.ovSig = sig; const html = h.join(""); if (html !== S.ovHtml) { svg.innerHTML = html; S.ovHtml = html; } }
  svg2.innerHTML = dyn.join("");
  $("stMeas").innerHTML = live ? "<b>" + esc(live) + "</b>" : "";
  if (S.typed && S.draft.length) live = (S.tool === "rect" ? "L x W: " : "Length: ") + S.typed + " ▏ Enter to place · Esc clears";
  if (!live && S.tool === "select" && S.hover && !S.drag && !S.box && S.cursorScr) live = hoverText(S.hover);   // what is under the cursor, as Bluebeam's tooltip
  if (live && S.cursorScr) { tip.textContent = live; tip.style.display = "block"; tip.style.left = Math.min(S.cursorScr[0] + 16, stage().clientWidth - 220) + "px"; tip.style.top = (S.cursorScr[1] + 18) + "px"; }
  else tip.style.display = "none";
}
function lockBadge(p){ return `<g><rect x="${(p[0] - 7).toFixed(1)}" y="${(p[1] - 7).toFixed(1)}" width="14" height="14" rx="3" fill="#0f2942"/><text x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="#fff">&#128274;</text></g>`; }
function hoverText(id){
  const o = objById(id); if (!o) return "";
  if (!o.cond) return MK_TYPES.has(o.type) ? mkHover(o) : MARK_TOOLS[o.type] + (o.text ? " — " + o.text : "") + (o.locked ? " · locked" : "");
  const c = cond(o.cond), k = itemScale(o); if (!c) return "";
  const q = k ? rowsOf(o, k).reduce((a, r) => a + r.qty, 0) : null;
  return (o.label ? o.label + " · " : "") + c.name + (q == null ? " · scale not set" : " · " + fq(q, c.unit) + " " + c.unit) + (o.locked ? " · locked" : "");
}
function label(p, text, col){
  const t = esc(text), w = text.length * 6.4 + 10;
  return `<g><rect x="${(p[0] - w / 2).toFixed(1)}" y="${(p[1] - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="4" fill="rgba(255,255,255,.88)"/><text x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${col}">${t}</text></g>`;
}
/* measurement captions, as Bluebeam's "show caption": which values a label shows is set once (🏷 ▾) and used on screen
   and in the marked-up exports. Areas: name, quantity, area, perimeter, L × W; lengths: name, length, quantity, H / T. */
const LBL_DEF = {on: true, name: true, qty: true, area: false, perim: false, len: true, dims: false, cond: false, seg: false, units: true, small: true, autoName: true};
function loadLbl(){ let o = null; try { o = JSON.parse(pref("zdTakeoffLbl") || "null"); } catch (e) { o = null; } S.lbl = Object.assign({}, LBL_DEF, o || {}); }
function capLines(it, c, k){
  const o = S.lbl, out = [], u = t => o.units ? " " + t : "", rows = rowsOf(it, k), q = rows.reduce((a, r) => a + r.qty, 0), poly = itemPoly(it);
  if (o.name && it.label) out.push(it.label);
  if (o.cond) out.push(c.name);
  if (c.type === "area") {
    const A = polyArea(poly) / k / k * (it.kind === "ded" ? -1 : 1), P = polyLen(poly, true) / k, r = rows[0];
    if (o.qty) out.push(fq(q, c.unit) + u(c.unit));
    if (o.area && !(o.qty && c.unit === "Sft")) out.push("A " + fq(A) + u("Sft"));
    if (o.perim) out.push("P " + f3(P) + u("ft"));
    if (o.dims && r) { if (r.how === "rect") out.push(f3(r.L) + " × " + f3(r.W) + u("ft")); else if (r.how === "circle") out.push("Ø " + f3(r.D) + u("ft")); }
  } else if (c.type === "linear") {
    const L = (it.shape === "circle" ? polyLen(poly, true) : polyLen(it.pts)) / k;
    if (o.len) out.push("L " + f3(it.kind === "ded" ? -L : L) + u("ft"));
    if (o.qty && (c.unit !== "ft" || !o.len)) out.push(fq(q, c.unit) + u(c.unit));
    if (o.dims && c.unit !== "ft") out.push((+c.h ? "H " + f3(+c.h) : "") + (+c.t ? (+c.h ? " · " : "") + "T " + f3(+c.t) : "") + ((+c.faces || 1) > 1 && c.unit === "Sft" ? " · " + c.faces + " faces" : ""));
  }
  if (!out.length && it.label) out.push(it.label);
  return out.filter(Boolean);
}
function labelBox(p, lines, col, z){   // a caption of one or more lines centred on p (screen units × z)
  z = z || 1; const lh = 14 * z, w = Math.max(...lines.map(t => t.length)) * 6.4 * z + 10 * z, hh = lines.length * lh + 4 * z, y0 = p[1] - hh / 2;
  return `<g><rect x="${(p[0] - w / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${4 * z}" fill="rgba(255,255,255,.88)"/>` +
    lines.map((t, i) => `<text x="${p[0].toFixed(1)}" y="${(y0 + 2 * z + lh * (i + 0.75)).toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="${11.5 * z}" font-weight="${i === 0 && lines.length > 1 ? 700 : 600}" fill="${col}">${esc(t)}</text>`).join("") + "</g>";
}
function labelPt(P){   // a point inside the outline for its caption: the centroid, or the middle of the widest span through it
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const f = P[j][0] * P[i][1] - P[i][0] * P[j][1]; a += f; cx += (P[j][0] + P[i][0]) * f; cy += (P[j][1] + P[i][1]) * f; }
  const c = Math.abs(a) > 1e-9 ? [cx / (3 * a), cy / (3 * a)] : [P.reduce((s2, p) => s2 + p[0], 0) / P.length, P.reduce((s2, p) => s2 + p[1], 0) / P.length];
  if (pointInPoly(c, P)) return c;
  const xs = [];
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const A = P[j], B = P[i]; if ((A[1] > c[1]) !== (B[1] > c[1])) xs.push(A[0] + (c[1] - A[1]) * (B[0] - A[0]) / (B[1] - A[1])); }
  xs.sort((x, y) => x - y); let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? [(best[0] + best[1]) / 2, c[1]] : c;
}
function lineLabelPt(P, z){   // beside the middle of the longest run, clear of its segment length
  z = z || 1; let bi = 1, bl = -1; for (let i = 1; i < P.length; i++) { const l = dist(P[i - 1], P[i]); if (l > bl) { bl = l; bi = i; } }
  const a = P[bi - 1], b = P[bi] || a, L = dist(a, b) || 1, n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L], off = (S.lbl.seg ? 34 : 18) * z, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return Math.abs(n[0]) > Math.abs(n[1]) ? [m[0] + (n[0] < 0 ? -1 : 1) * (off + 30 * z), m[1]] : [m[0], m[1] - off];
}
function segLabels(scr, pts, k, closed, z){   // the length of every side, at its middle (Bluebeam "show segment values")
  const out = [], n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) { const a = scr[i], b = scr[(i + 1) % scr.length]; if (dist(a, b) < 46 * z) continue;
    const t = f3(dist(pts[i], pts[(i + 1) % pts.length]) / k), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push(`<text x="${m[0].toFixed(1)}" y="${(m[1] - 4 * z).toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="${10 * z}" font-weight="600" fill="#33475b" stroke="#fff" stroke-width="${3 * z}" paint-order="stroke">${t}</text>`); }
  return out.join("");
}
async function labelDialog(){
  const o = S.lbl, cb = (k2, t) => `<label class="pk"><input type="checkbox" data-lb="${k2}"${o[k2] ? " checked" : ""}> ${t}</label>`;
  const v = await ask("Labels on the drawing", `<div class="grid"><div class="fg"><label>Show on every label</label>${cb("name", "Name (room / label)")}${cb("cond", "Condition name")}${cb("qty", "Quantity in the condition's unit")}${cb("units", "Units (Sft, ft, cft, Nos)")}</div>
    <div class="fg"><label>Areas</label>${cb("area", "Area Sft (when the unit is not Sft)")}${cb("perim", "Perimeter ft")}${cb("dims", "L × W of rectangles · Ø of circles · H / T of walls")}
      <label style="margin-top:6px">Lengths</label>${cb("len", "Length ft")}</div>
    <div class="fg w2"><label>Display</label>${cb("seg", "Length of every side / segment (always shown on the selected one)")}${cb("small", "Hide labels on shapes too small to read at this zoom")}${cb("autoName", "Name new areas from the room name written inside them (manual, rectangle, auto area, Claude)")}</div></div>
    <p class="small" style="margin-top:8px">The same labels go on the marked-up PNG / PDF exports. <b>L</b> shows or hides all labels.</p>`, "Save", () => { const n = {on: o.on}; document.querySelectorAll("[data-lb]").forEach(x => { n[x.dataset.lb] = x.checked; }); return n; });
  if (!v) return;
  S.lbl = Object.assign({}, S.lbl, v); pref("zdTakeoffLbl", JSON.stringify(S.lbl)); draw();
  if (P.proj && S.page) { const n = P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && !i.label && i.kind === "shape" && (cond(i.cond) || {}).type === "area").length;
    if (n && S.lbl.autoName && await ask("Name the areas already drawn?", `<p>${n} area${n > 1 ? "s" : ""} on this page ${n > 1 ? "have" : "has"} no name. Name ${n > 1 ? "them" : "it"} from the room text inside?</p>`, "Name them")) nameAreas(); }
}
/* ------------------------------------------------------------------ embedded takeoff legend (Bluebeam-style) */
const LEGEND_COLS = [{id:'symbol',label:'Symbol',on:true},{id:'boq',label:'BOQ',on:true},{id:'description',label:'Description',on:true},{id:'unit',label:'Unit',on:true},{id:'qty',label:'Quantity',on:true},{id:'rate',label:'Rate',on:false},{id:'amount',label:'Amount',on:false}];
function legendOfPage(file=S.fileId,page=S.pageNo){return (P.proj.marks||[]).filter(m=>m.type==='legend'&&m.file===file&&m.page===page);}
function legendCols(m){const src=Array.isArray(m.columns)?m.columns:LEGEND_COLS.filter(x=>x.on).map(x=>x.id);return src.map(id=>LEGEND_COLS.find(x=>x.id===id)).filter(Boolean);}
function legendRows(m){const map=new Map(), list=m.scope==='all'?P.proj.items.filter(i=>!hiddenItem(i)):P.proj.items.filter(i=>i.file===m.file&&i.page===m.page&&!hiddenItem(i));list.forEach(it=>{const c=cond(it.cond);if(!c)return;let q=0,has=false;if(c.type==='count'){q=(+it.pts?.length||0)*Math.max(1,+it.nos||1);has=true}else{const k=itemScale(it);if(k){q=rowsOf(it,k).reduce((a,r)=>a+(+r.qty||0),0);has=true}}if(!has&&!q)return;const old=map.get(c.id);map.set(c.id,{c,q:(old?old.q:0)+q,has:!!(old&&old.has)||has})});let rows=[...map.values()].filter(x=>x.has||x.q!==0);const s=m.sort||'drawing';if(s==='condition')rows.sort((a,b)=>String(a.c.name).localeCompare(String(b.c.name)));else if(s==='boq')rows.sort((a,b)=>String(a.c.boq||'').localeCompare(String(b.c.boq||'')));return rows;}
function legendQty(x,m){const d=Math.max(0,Math.min(3,Math.round(+m.precision||3)));return x.has?(+x.q||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';}
function legendRate(c,m){const r=Number(c&&c.rate);if(!isFinite(r)||r===0)return'—';const d=Math.max(0,Math.min(2,Math.round(+m.moneyPrecision||2)));return r.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function legendSvg(m,T,z){
 const pp=m.pts||[[80,80],[420,260]],a=T(pp[0]),b=T(pp[1]),x0=Math.min(a[0],b[0]),y0=Math.min(a[1],b[1]),x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),W=Math.max(80,x1-x0),H=Math.max(60,y1-y0),cols=legendCols(m),rows=legendRows(m),fs=Math.max(5,Math.min(32,+m.fontSize||9))*z,rh=Math.max(fs*1.55,Math.min(80,+m.rowH||18)*z),hh=m.showHeaders===false?0:Math.max(fs*1.8,Math.min(80,+m.headerH||22)*z),th=m.showTitle===false?0:Math.max(fs*1.9,Math.min(80,+m.titleH||24)*z),pad=Math.max(2,Math.min(20,+m.pad||5))*z,bw=Math.max(0,Math.min(8,+m.lineWidth||1))*z,fill=m.fill||'#ffffff',head=m.headerFill||'#eef2f7',border=m.border||'#40556b',textCol=m.textColor||'#172b3f';
 const defs='<defs><clipPath id="lg'+esc(m.id)+'"><rect x="'+x0.toFixed(1)+'" y="'+y0.toFixed(1)+'" width="'+W.toFixed(1)+'" height="'+H.toFixed(1)+'"/></clipPath></defs>';let out='<g>'+defs+'<rect x="'+x0.toFixed(1)+'" y="'+y0.toFixed(1)+'" width="'+W.toFixed(1)+'" height="'+H.toFixed(1)+'" rx="3" fill="'+fill+'" fill-opacity="'+(m.fillOpacity==null?.96:Math.max(.05,Math.min(1,+m.fillOpacity)))+'" stroke="'+border+'" stroke-width="'+bw.toFixed(1)+'"/>';let yy=y0+pad;
 if(th){out+='<rect x="'+x0.toFixed(1)+'" y="'+y0.toFixed(1)+'" width="'+W.toFixed(1)+'" height="'+th.toFixed(1)+'" fill="'+(m.titleFill||head)+'"/><text x="'+(x0+pad).toFixed(1)+'" y="'+(y0+th*.68).toFixed(1)+'" font-size="'+fs.toFixed(1)+'" font-family="Arial,sans-serif" font-weight="700" fill="'+textCol+'">'+esc(m.title||'Takeoff Legend')+'</text>';yy+=th}
 const widths=Array.isArray(m.colWidths)?m.colWidths.map(Number):[],weights=cols.map((c,i)=>Math.max(.05,Number(widths[i])||({symbol:.11,boq:.14,description:.31,unit:.11,qty:.16,rate:.12,amount:.15}[c.id]||.15))),sum=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=sum;const xs=[];let xx=x0;cols.forEach((c,i)=>{xs.push(xx);xx+=W*weights[i]});
 if(hh){out+='<rect x="'+x0.toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+W.toFixed(1)+'" height="'+hh.toFixed(1)+'" fill="'+head+'"/>';cols.forEach((c,i)=>{out+='<text x="'+(xs[i]+pad).toFixed(1)+'" y="'+(yy+hh*.67).toFixed(1)+'" font-size="'+Math.max(5,fs*.9).toFixed(1)+'" font-family="Arial,sans-serif" font-weight="700" fill="'+textCol+'">'+esc(c.label)+'</text>'});yy+=hh}
 const cell=function(x,y,w,s,al,bold){al=al||'start';const tx=al==='end'?x+w-pad:al==='middle'?x+w/2:x+pad;return '<text x="'+tx.toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="'+(al==='end'?'end':al==='middle'?'middle':'start')+'" font-size="'+fs.toFixed(1)+'" font-family="Arial,sans-serif" font-weight="'+(bold?700:400)+'" fill="'+textCol+'">'+esc(s==null?'—':s)+'</text>';};
 rows.forEach(function(r,ri){const y=yy+ri*rh,c=r.c,color=HEXCOL.test(String(c.color||''))?c.color:'#4b3b8f';if(ri%2)out+='<rect x="'+x0.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+W.toFixed(1)+'" height="'+rh.toFixed(1)+'" fill="#f7f9fb"/>';cols.forEach(function(col,i){const cw=W*weights[i],x=xs[i];if(col.id==='symbol')out+='<rect x="'+(x+pad).toFixed(1)+'" y="'+(y+rh*.28).toFixed(1)+'" width="'+Math.min(cw-pad*2,rh*.42).toFixed(1)+'" height="'+Math.min(cw-pad*2,rh*.42).toFixed(1)+'" rx="2" fill="'+color+'" stroke="'+border+'" stroke-width=".6"/>';else if(col.id==='boq')out+=cell(x,y+rh*.67,cw,c.boq||'—');else if(col.id==='description')out+=cell(x,y+rh*.67,cw,c.name||'—');else if(col.id==='unit')out+=cell(x,y+rh*.67,cw,c.unit||'—','middle');else if(col.id==='qty')out+=cell(x,y+rh*.67,cw,legendQty(r,m),'end');else if(col.id==='rate')out+=cell(x,y+rh*.67,cw,legendRate(c,m),'end');else{const rate=Number(c.rate),amt=isFinite(rate)&&rate?(+r.q||0)*rate:null;out+=cell(x,y+rh*.67,cw,amt==null?'—':f2(amt),'end')}})});
 if(cols.length>1)for(let i=1;i<cols.length;i++){out+='<line x1="'+xs[i].toFixed(1)+'" y1="'+(y0+pad).toFixed(1)+'" x2="'+xs[i].toFixed(1)+'" y2="'+Math.min(y1,y0+pad+th+hh+rows.length*rh).toFixed(1)+'" stroke="'+border+'" stroke-opacity=".22" stroke-width=".6"/>'}
 out+='</g>';return out;
}
function defaultLegend(file=S.fileId,page=S.pageNo){const w=340,h=190,base=S.base||{width:1000,height:1000},x0=Math.max(20,Math.min(Math.max(20,base.width-w-20),base.width-80)),y0=30;return{id:uid('M'),type:'legend',file,page,pts:[[x0,y0],[x0+w,y0+h]],title:'Takeoff Legend',showTitle:true,showHeaders:true,columns:LEGEND_COLS.filter(x=>x.on).map(x=>x.id),precision:3,moneyPrecision:2,fontSize:9,rowH:18,headerH:22,titleH:24,pad:5,lineWidth:1,border:'#40556b',fill:'#ffffff',fillOpacity:.96,headerFill:'#eef2f7',textColor:'#172b3f',sort:'drawing',colWidths:[.11,.14,.31,.11,.16],subject:'Takeoff Legend',author:qaUser(),status:'',at:new Date().toISOString()};}
async function editLegend(m){const cols=legendCols(m),body='<div class="grid"><div class="fg w2"><label>Title</label><input type="text" id="lgTitle" value="'+esc(m.title||'Takeoff Legend')+'"></div><div class="fg"><label>Font size (pt)</label><input type="number" id="lgFs" min="5" max="32" step=".5" value="'+(+m.fontSize||9)+'"></div><div class="fg"><label>Row height (pt)</label><input type="number" id="lgRh" min="8" max="60" step="1" value="'+(+m.rowH||18)+'"></div><div class="fg"><label>Precision</label><select id="lgPrec">'+[0,1,2,3].map(n=>'<option value="'+n+'" '+((+m.precision||3)===n?'selected':'')+'>'+n+' decimals</option>').join('')+'</select></div><div class="fg"><label>Sort</label><select id="lgSort"><option value="drawing">Drawing order</option><option value="condition">Condition</option><option value="boq">BOQ code</option></select></div><div class="fg"><label>Border colour</label><input type="color" id="lgBorder" value="'+(HEXCOL.test(m.border||'')?m.border:'#40556b')+'"></div><div class="fg"><label>Header fill</label><input type="color" id="lgHead" value="'+(HEXCOL.test(m.headerFill||'')?m.headerFill:'#eef2f7')+'"></div><div class="fg"><label>Fill</label><input type="color" id="lgFill" value="'+(HEXCOL.test(m.fill||'')?m.fill:'#ffffff')+'"></div><div class="fg w2"><label><input type="checkbox" id="lgTitleOn" style="width:auto" '+(m.showTitle===false?'':'checked')+'> Show title</label><label><input type="checkbox" id="lgHeadOn" style="width:auto" '+(m.showHeaders===false?'':'checked')+'> Show column headers</label></div><div class="fg w2"><label>Columns</label><div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+LEGEND_COLS.map(c=>'<label class="pk"><input type="checkbox" data-lgcol="'+c.id+'" style="width:auto" '+(cols.some(x=>x.id===c.id)?'checked':'')+'> '+esc(c.label)+'</label>').join('')+'</div></div></div><p class="small">Unit and Quantity are live from the takeoff condition. Rate and Amount use the condition rate when one exists; no rate is invented.</p>';const v=await ask('Edit Legend',body,'Save',()=>{const columns=[...document.querySelectorAll('[data-lgcol]:checked')].map(x=>x.dataset.lgcol);if(!columns.length)return'Choose at least one column';return{title:$('lgTitle').value.trim()||'Takeoff Legend',fontSize:Math.max(5,Math.min(32,+$('lgFs').value||9)),rowH:Math.max(8,Math.min(60,+$('lgRh').value||18)),precision:+$('lgPrec').value||0,sort:$('lgSort').value,border:$('lgBorder').value,headerFill:$('lgHead').value,fill:$('lgFill').value,showTitle:$('lgTitleOn').checked,showHeaders:$('lgHeadOn').checked,columns}});if(v)mutate(()=>Object.assign(m,v),'Edit Legend');}
async function createLegend(){if(!P.proj||!S.page)return toast('Open a drawing page first');const m=defaultLegend();mutate(()=>{(P.proj.marks=P.proj.marks||[]).push(m)},'Add Legend');setSel([m.id]);setTool('select');refresh();toast('Legend placed on the drawing — drag the corners to resize; double-click to edit',3200)}
function legendButton(){const s=S.selMark&&objById(S.selMark);if(s&&s.type==='legend')return editLegend(s);return createLegend();}
function setLblOn(on){ S.lbl.on = on; pref("zdTakeoffLbl", JSON.stringify(S.lbl)); $("bLbl").classList.toggle("on", on); $("bLbl").title = on ? "Labels shown — click (or L) to hide" : "Labels hidden — click (or L) to show"; viewMark(); draw(); }
function loadLegend(){ S.legendOn = pref("zdTakeoffLegend") !== "0"; }
function setLegendOn(on){
  S.legendOn = !!on; pref("zdTakeoffLegend", S.legendOn ? "1" : "0");
  const b = $("bLegend"); if (b) { b.classList.toggle("on", S.legendOn); b.title = S.legendOn ? "Hide the takeoff legend on the drawing" : "Show the takeoff legend on the drawing"; }
  renderLiveLegend();
}
function renderLiveLegend(){ const el=$("takeoffLegend"); if(el){ el.classList.remove("on"); el.innerHTML=""; } }

/* the View button shows a dot while something is dimmed, thinned or hidden — so a hidden markup is never a surprise */
function viewMark(){ const b = $("bView"); if (b) b.classList.toggle("mod", !!(S.dim || S.thin || S.hideMk || (S.lbl && !S.lbl.on))); }
/* the room name written inside an outline (BEDROOM 2, LOUNGE…), from the PDF's own text; "" if none */
function roomNameAt(poly, key){
  const T = S.texts[key || S.key]; if (!T || !T.length || !poly || poly.length < 3) return "";
  const lines = textLines(T).filter(l => !l.tag && pointInPoly([l.x + l.w / 2, l.y - l.h / 2], poly));
  const ok = l => /[A-Za-z]{2,}/.test(l.s.replace(SIZE_RX, "")) && l.s.length <= 40 && !/\bSCALE\b|\bPLAN\b|SECTION|ELEVATION|DETAIL|\bNOTES?\b|\bLVL\b|F\.?F\.?L|\bUP\b|\bDN\b|^\s*[+\-±]?\s*\d+\s*'/i.test(l.s);
  const c = labelPt(poly), by = (a, b) => b.h - a.h || dist([a.x + a.w / 2, a.y], c) - dist([b.x + b.w / 2, b.y], c);
  const pick = lines.filter(l => ok(l) && ROOM_RX.test(l.s)).sort(by)[0] || lines.filter(ok).sort(by)[0];
  return pick ? pick.s.replace(SIZE_RX, "").replace(/[\s,:;-]+$/, "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
function nameAreas(){
  let n = 0; mutate(() => P.proj.items.forEach(i => { if (i.file === S.fileId && i.page === S.pageNo && !i.label && i.kind === "shape" && (cond(i.cond) || {}).type === "area") { const t = roomNameAt(itemPoly(i)); if (t) { i.label = t; n++; } } }));
  toast(n ? n + " area" + (n > 1 ? "s" : "") + " named from the drawing" : "No room names found inside the unnamed areas");
}
/* ------------------------------------------------------------------ panels */
function refresh(){ mlSoon(); S.doorIx = null; S.ver = (S.ver || 0) + 1; if (S.leftTab === "pages") renderPages(); renderConds(); renderSheet(); renderQaBar(); if (S.billView) renderBill(); renderScaleChip(); renderProps(); renderLiveLegend(); draw(); draftBtns(); }
let sheetT = null;
function refreshSheetSoon(){ clearTimeout(sheetT); sheetT = setTimeout(() => { renderSheet(); renderConds(); }, 120); }
function renderScaleChip(){
  const ch = $("scaleChip"), sc = P.proj && P.proj.scales[S.key];
  if (!S.page) { ch.className = "chip bad"; ch.lastElementChild.textContent = "No page"; return; }
  if (!sc) { ch.className = "chip bad"; ch.lastElementChild.textContent = "Scale not set — press K"; }
  else { ch.className = "chip " + scaleState(sc).k; ch.lastElementChild.textContent = (sc.how === "note" ? scaleLabel(sc) + " · from note" : sc.how === "pdf" ? sc.text + " · saved in the PDF" : sc.how === "cad" ? sc.text + " · from the drawing" : sc.how === "manual" ? sc.text + " · chosen" : sc.how === "inherited" ? "1 ft = " + sc.ptPerFt.toFixed(3) + " pt · inherited from " + keyName(sc.from) : "1 ft = " + sc.ptPerFt.toFixed(3) + " pt · calibrated") + (sc.verified ? " · verified" : sc.doubt ? " · doubtful" : " · not verified"); ch.title = "Page scale: " + scaleState(sc).t + " — click to set or check"; }
  markPageSel();
}
/* a page's scale status: Verified / Calibrated (both checked against a known length), Inherited (copied from another page,
   not yet checked), From note (read from the drawing's note, not yet checked), Unknown */
function scaleState(sc){
  if (!sc) return {k: "bad", ic: "✕", t: "Unknown"};
  if (sc.doubt && !sc.verified) return {k: "bad", ic: "✕", t: "Doubtful — the drawing measures " + sc.doubt.label};
  if (sc.how === "inherited") return sc.verified ? {k: "ok", ic: "✓", t: "Inherited · verified"} : {k: "warn", ic: "⚠", t: "Inherited from " + keyName(sc.from)};
  if (sc.how === "calibrated") return {k: "ok", ic: "✓", t: "Calibrated"};
  if (sc.how === "manual") return sc.verified ? {k: "ok", ic: "✓", t: "Chosen · verified"} : {k: "warn", ic: "⚠", t: "Chosen by hand — not verified"};
  if (sc.how === "cad") return sc.verified ? {k: "ok", ic: "✓", t: "From the drawing's units"} : {k: "warn", ic: "⚠", t: "Drawing units not set — check it"};
  if (sc.how === "pdf") return sc.verified ? {k: "ok", ic: "✓", t: "From the PDF · verified"} : {k: "warn", ic: "⚠", t: "Saved in the PDF — not verified"};
  return sc.verified ? {k: "ok", ic: "✓", t: "Verified"} : {k: "warn", ic: "⚠", t: "From note — not verified"};
}
function keyName(key){ if (!key) return "?"; const [f, p] = String(key).split(":"); return pageName({file: f, page: +p}); }
function markPageSel(){
  if (!P.proj) return;
  [...$("pageSel").options].forEach(o => { const [f, p] = o.value.split("|"); if (!p) return; const sh = (P.proj.sheets || {})[keyOf(f, +p)] || {}, st = scaleState(P.proj.scales[keyOf(f, +p)]);
    const t = (sh.no ? sh.no + (sh.rev ? " " + sh.rev : "") + " · " : "") + ((P.proj.files.find(x => x.id === f) || {name: "?"}).name.replace(/\.pdf$/i, "")) + " — p." + p + "  " + st.ic;
    if (o.textContent !== t) o.textContent = t; o.title = "Scale: " + st.t; });
}
/* the Pages tab (Forma Takeoff's Sheets panel): a thumbnail of every page (drawn when it scrolls into view, one at a time,
   and kept), its sheet no., title, scale status and how many measurements are on it; click to open. Search, filter (with
   takeoff, no scale, pinned, version set…), sort, pin; tick pages to export, read or OCR them together. Remove PDF takes a
   wrong drawing out of the project. */
function renderPages(){
  const el = $("pageList"); if (!el || !P.proj) return;
  if (!P.proj.files.length) { el.innerHTML = '<div class="empty">No PDF yet — add one with <b>+ PDF</b>, or <b>&#9662;</b> next to it to choose pages, a folder, or photos / scans.</div>'; return; }
  S.thumbs = S.thumbs || {}; S.pgSel = S.pgSel || new Set();
  const all = allPages(), keys = new Set(all.map(o => o.key)); [...S.pgSel].forEach(k => { if (!keys.has(k)) S.pgSel.delete(k); });
  const L = pagesShown(), sets = [...new Set(P.proj.files.map(f => f.vset).filter(Boolean))], ns = S.pgSel.size, nShown = L.filter(o => S.pgSel.has(o.key)).length, F = S.pgF || "";
  const opt = (v, t, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(t)}</option>`;
  const card = o => { const st = scaleState(P.proj.scales[o.key]), th = S.thumbs[o.key], t = o.sh.title || "", on = S.pgSel.has(o.key);
    return `<div class="pgt${o.key === S.key ? " on" : ""}${on ? " sel" : ""}" data-pg="${esc(o.f.id)}|${o.i}" title="${esc(o.f.name)} p.${o.i}${t ? " — " + esc(t) : ""} · scale: ${esc(st.t)}"><input type="checkbox" class="pgck" data-pgck="${esc(o.key)}"${on ? " checked" : ""} title="Tick to export, read or OCR several pages at once (Shift+click: a range)" aria-label="Tick page"><button type="button" class="pgpin${o.pin ? " on" : ""}" data-pin="${esc(o.key)}" title="${o.pin ? "Pinned to the top — click to unpin" : "Pin to the top (bookmark)"}">${o.pin ? "&#9733;" : "&#9734;"}</button><img data-th="${esc(o.key)}" alt="" ${th && th !== "x" ? `src="${th}"` : ""}><div class="pgl">${o.sh.no ? esc(o.sh.no) + " · " : ""}p.${o.i} · ${o.n}</div>${t ? `<div class="pgl pgtt">${esc(t)}</div>` : ""}<div class="pgl ${st.k}">${st.ic} ${esc(st.k === "bad" && !P.proj.scales[o.key] ? "no scale" : st.t.split(" — ")[0])}</div><div class="pgact"><button class="btn sm" data-sheet="${esc(o.f.id)}|${o.i}" title="Edit sheet number, title, revision, discipline, building and floor">Info</button><button class="btn sm" data-ocr="${esc(o.f.id)}|${o.i}" title="Read this sheet’s text (OCR for a scanned page) and suggest its sheet info">Read</button></div></div>`; };
  const grid = list => `<div class="pgg">${list.map(card).join("")}</div>`;
  const bar = `<div class="pgbar"><input type="search" id="pgQ" placeholder="Search sheet no., title, PDF…" value="${esc(S.pgQ || "")}" aria-label="Search the pages"><select id="pgF" title="Show only…">${[["", "All pages"], ["tk", "With takeoff"], ["none", "No takeoff yet"], ["noscale", "No scale"], ["unver", "Scale not verified"], ["pin", "★ Pinned"], ["ocr", "Read by OCR"]].concat(sets.map(s => ["set:" + s, "Set: " + s])).map(([v, t]) => opt(v, t, F)).join("")}</select><select id="pgSort" title="Order">${[["", "Drawing order"], ["no", "Sheet no."], ["title", "Title"], ["n", "Most measured"]].map(([v, t]) => opt(v, t, S.pgSort || "")).join("")}</select></div>
    <div class="pgsel"><input type="checkbox" data-pgall="1" title="Tick / untick every page shown"${L.length && nShown === L.length ? " checked" : ""}>${ns ? `<b>${ns} ticked</b><button class="btn sm pri" data-pga="export" title="Export the ticked pages — PDF, PNG or JPEG">&#8681; Export…</button><button class="btn sm" data-pga="sheet" title="Read sheet no., title, revision and floor from their title blocks">&#127991; Sheet info</button><button class="btn sm" data-pga="ocr" title="Read the text of scanned pages (OCR)">&#128292; OCR</button><button class="btn sm" data-pga="pin" title="Pin / unpin the ticked pages">&#9733;</button><button class="btn sm" data-pga="clear" title="Untick all">&#10005;</button>`
      : `<span class="small">${L.length === all.length ? all.length + " page" + (all.length === 1 ? "" : "s") : L.length + " of " + all.length + " pages"} · tick to export or read several</span><span style="flex:1"></span><button class="btn sm" data-pga="tk" title="Tick every page that has takeoff or markups">Tick pages with takeoff</button>`}</div>`;
  let body;
  if (!L.length) body = '<div class="empty">No page matches — clear the search or the filter.</div>';
  else if (!S.pgSort) {   // drawing order: PDF by PDF, pinned pages first
    const pin = L.filter(o => o.pin), rest = L.filter(o => !o.pin);
    body = (pin.length ? `<div class="pgf"><b>&#9733; Pinned</b><span class="small">${pin.length} p.</span></div>` + grid(pin) : "") + P.proj.files.map(f => { const fl = rest.filter(o => o.f.id === f.id); if (!fl.length && (S.pgQ || F || pin.some(o => o.f.id === f.id))) return "";
      return `<div class="pgf"><b title="${esc(f.name)}">${esc(f.name.replace(/\.pdf$/i, ""))}</b>${f.vset ? `<span class="tag g" title="Version set${f.vdate ? " · issued " + esc(dmy(f.vdate)) : ""}">${esc(f.vset)}</span>` : ""}<span class="small">${f.pages} p.</span><button class="btn sm dng" data-rmpdf="${esc(f.id)}" title="Remove this PDF and its measurements from the project">Remove</button></div>` + grid(fl); }).join("");
  } else body = grid(L);
  const top = el.scrollTop, a = document.activeElement, foc = a && a.id === "pgQ", caret = foc ? a.selectionStart : 0;
  el.style.setProperty("--pgw", (PG_SZ[S.pgSz] || PG_SZ.m) + "px");
  el.innerHTML = '<div class="pghd">' + bar + "</div>" + body; el.scrollTop = top;
  if (foc) { const q = $("pgQ"); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
  if (!S.thumbIO) S.thumbIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { S.thumbIO.unobserve(e.target); thumbWant(e.target.dataset.th); } }), {root: el, rootMargin: "200px"});
  el.querySelectorAll("img[data-th]").forEach(im => { if (!im.getAttribute("src")) S.thumbIO.observe(im); });
}
function thumbWant(k){ S.thumbQ = S.thumbQ || []; if ((S.thumbs || {})[k] || S.thumbQ.includes(k)) return; S.thumbQ.push(k); thumbRun(); }
async function thumbRun(){
  if (S.thumbBusy) return; S.thumbBusy = true;
  const pr = P.proj;
  while (S.thumbQ.length && P.proj === pr) {
    const k = S.thumbQ.shift(); if (S.thumbs[k]) continue; const [f, p] = k.split(":");
    try { const csc = CAD && +p === 1 && S.cadSc && S.cadSc[f], cpg = csc && csc.pages[0];
      if (cpg) { const s2 = 200 / Math.max(cpg.w, cpg.h), cv = document.createElement("canvas"); cv.width = Math.ceil(cpg.w * s2); cv.height = Math.ceil(cpg.h * s2);   // a CAD page: from its scene
        await CAD.cadDrawAsync(cv.getContext("2d"), cpg, {s: s2, tx: 0, ty: 0, W: cv.width, H: cv.height}, {dark: false, mono: false, hidden: cadHidden(f, csc), dpr: 1}); S.thumbs[k] = cv.toDataURL("image/png"); }
      else { const pg = await (await doc(f)).getPage(+p), v0 = pg.getViewport({scale: 1}), vp = pg.getViewport({scale: 200 / Math.max(v0.width, v0.height)}), cv = document.createElement("canvas");
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await sliced(pg.render({...lay(f), canvasContext: ctx, viewport: vp})).promise; S.thumbs[k] = cv.toDataURL("image/png"); } }
    catch (e) { S.thumbs[k] = "x"; }   // PDF not attached in this browser: left blank
    const im = [...document.querySelectorAll("#pageList img[data-th]")].find(x => x.dataset.th === k); if (im && S.thumbs[k] !== "x") im.src = S.thumbs[k];
    if (k === S.key) miniUpdate();
  }
  S.thumbBusy = false;
}
async function removePdf(fid){
  const f = P.proj.files.find(x => x.id === fid); if (!f) return;
  const its = P.proj.items.filter(i => i.file === fid).length, mks = (P.proj.marks || []).filter(m => m.file === fid && m.type !== "fence").length;
  const ok = await ask("Remove PDF", `<p>Remove <b>${esc(f.name)}</b> (${f.pages} page${f.pages > 1 ? "s" : ""}) from this project${its || mks ? ` with its <b>${its}</b> measurement${its === 1 ? "" : "s"}${mks ? " and " + mks + " markup" + (mks > 1 ? "s" : "") : ""}` : ""}?</p>
    <p class="small" style="margin-top:6px">The project is backed up first (Export → Backups… brings the measurements back; the PDF is then added again with + PDF). Ctrl+Z history is cleared.</p>`, "Remove");
  if (!ok) return;
  savePr = P.proj; await flushSave(); await backupNow("before removing " + f.name).catch(() => {});
  const pr = P.proj, mine = k => String(k).split(":")[0] === fid;
  pr.files = pr.files.filter(x => x.id !== fid); pr.items = pr.items.filter(i => i.file !== fid); pr.marks = (pr.marks || []).filter(m => m.file !== fid);
  ["scales", "viewports", "sheets", "ocr"].forEach(n => Object.keys(pr[n] || {}).forEach(k => { if (mine(k)) delete pr[n][k]; }));
  if (pr.pins) pr.pins = pr.pins.filter(k => !mine(k)); if (S.pgSel) [...S.pgSel].forEach(k => { if (mine(k)) S.pgSel.delete(k); });
  if (pr.layersOff) delete pr.layersOff[fid]; if (pr.last && pr.last.file === fid) pr.last = {};
  S.undo = []; S.redo = []; S.multi.clear(); S.sel = null; S.selMark = null; Object.keys(S.thumbs || {}).forEach(k => { if (mine(k)) delete S.thumbs[k]; });
  if (S.docs[fid]) { try { S.docs[fid].destroy(); } catch (e) {} delete S.docs[fid]; }
  const others = (await dbAll("projects")).filter(x => x.id !== pr.id); if (!others.some(x => (x.files || []).some(y => y.id === fid))) await dbDel("pdfs", fid).catch(() => {});   // (a duplicated project keeps its copy)
  save(); buildPageSel();
  if (S.fileId === fid) { S.navSeq = (S.navSeq || 0) + 1; S.page = null; S.base = null; S.fileId = null; S.key = ""; S.rendered = null; $("hi").style.display = "none"; { const lc = $("low"); lc.width = lc.width; }
    if (pr.files[0]) await gotoPage(pr.files[0].id, 1); else showDrop(true); }
  refresh(); toast(f.name + " removed" + (its ? " with " + its + " measurement" + (its > 1 ? "s" : "") : "") + " — a backup was taken first", 4000);
}
function scaleLabel(sc){ const c = (S.texts[S.key] ? scaleCandidates(S.key) : []).find(x => Math.abs(x.ptPerFt - sc.ptPerFt) < 1e-6); return c ? c.label : "1 ft = " + sc.ptPerFt.toFixed(3) + " pt"; }
function renderConds(){
  const L = $("condList");
  if (!P.proj) { L.innerHTML = ""; return; }
  if (!P.proj.conds.length) { L.innerHTML = '<div class="empty">A <b>condition</b> is what you are measuring — e.g. <i>9" brick wall</i>, <i>floor tiles</i>, <i>doors</i>. Create one, then draw on the drawing.<br><br><button class="btn pri" id="bFirstCond">+ New condition</button></div>'; return; }
  S.condSel.forEach(id => { if (!cond(id)) S.condSel.delete(id); });
  const ns = S.condSel.size, bar = `<div class="lyrbar"><label class="pk" style="flex:none" title="Tick all / none"><input type="checkbox" data-cka="1"${ns && ns === P.proj.conds.length ? " checked" : ""}></label>
    ${ns ? `<b style="font-size:11.5px">${ns} ticked:</b><button class="btn sm" data-cact="show">Show</button><button class="btn sm" data-cact="hide">Hide</button><button class="btn sm" data-cact="only">Only these</button><button class="btn sm dng" data-cact="del">Delete</button>`
      : `<button class="btn sm" data-cact="allon" title="Show every condition">All on</button><button class="btn sm" data-cact="alloff" title="Hide every condition">All off</button><span class="small">tick conditions to show / hide several</span>`}</div>`;
  L.innerHTML = bar + P.proj.conds.map((c, i) => { const t = condTotals(c);
    return `<div class="cond${c.id === S.cond ? " on" : ""}${c.hidden ? " off" : ""}" data-cond="${esc(c.id)}"><input type="checkbox" data-ck="${esc(c.id)}"${S.condSel.has(c.id) ? " checked" : ""} title="Tick to show / hide / delete several" style="flex:none"><button class="sw" style="background:${c.color}" title="Change colour" data-color="${esc(c.id)}"></button><div class="nm"><b>${i < 9 ? (i + 1) + ". " : ""}${esc(c.name)}</b><span>${c.type === "area" ? "Area" : c.type === "linear" ? "Length" : "Count"}${c.h ? " · H " + f3(+c.h) : ""}${c.t ? " · T " + f3(+c.t) : ""}${c.faces > 1 ? " · " + c.faces + " faces" : ""}</span></div>
      <div class="q">${fq(t.net, c.unit)}<br><span style="font-weight:400;color:var(--muted);font-size:10.5px">${esc(c.unit)}</span></div><button class="ed eye" title="${c.hidden ? "Hidden — click to show on the drawing" : "Shown — click to hide on the drawing"}" data-eye="${esc(c.id)}">${c.hidden ? "&#128065;&#824;" : "&#128065;"}</button><button class="ed" title="Edit condition" data-edit="${esc(c.id)}">&#9998;</button></div>`; }).join("");
}
/* search and sort of the measurement sheet: every word typed must appear in the item, its condition, BOQ code, page, room or unit;
   sorting only reorders the lines inside each condition — the totals are always the whole condition's */
function shText(it, c){ return [it.label, kindName(it, c), c.name, c.boq, c.unit, pageName(it), locText(locOf(it))].join(" ").toLowerCase(); }
function shMatch(it, c){ const q = (S.shQ || "").trim().toLowerCase(); return !q || q.split(/\s+/).every(w => shText(it, c).includes(w)); }
function shSorted(its, c){
  const m = S.shSort || "order"; if (m === "order") return its;
  const key = it => { const k = itemScale(it); return k ? rowsOf(it, k).reduce((a, r) => a + Math.abs(r.qty), 0) : 0; }, fi = id => P.proj.files.findIndex(f => f.id === id);
  const A = its.map((it, n) => ({it, n}));
  A.sort(m === "qty" ? (a, b) => key(b.it) - key(a.it) || a.n - b.n : m === "name" ? (a, b) => String(a.it.label || kindName(a.it, c)).localeCompare(String(b.it.label || kindName(b.it, c)), undefined, {numeric: true}) || a.n - b.n
    : (a, b) => fi(a.it.file) - fi(b.it.file) || a.it.page - b.it.page || a.n - b.n);
  return A.map(o => o.it);
}
function renderSheet(){
  const el = $("sheet");
  if (!P.proj) { el.innerHTML = ""; return; }
  const missing = P.proj.items.filter(it => !itemScale(it)).length;
  const unv = Object.values(P.proj.scales).filter(s => !s.verified && s.how !== "inherited").length, inh = Object.values(P.proj.scales).filter(s => !s.verified && s.how === "inherited").length;
  const wb = $("warnbar"), msgs = [];
  if (missing) msgs.push(missing + " measurement" + (missing > 1 ? "s are" : " is") + " on a page with no scale — set it with <b>K</b>; they are left out of the totals.");
  if (unv) msgs.push(unv + " page scale" + (unv > 1 ? "s were" : " was") + " read from the drawing note or chosen by hand, and not yet checked — click the scale chip → <b>Verify</b> with a known dimension.");
  if (inh) msgs.push(inh + " page scale" + (inh > 1 ? "s were" : " was") + " copied from another page (inherited) and not yet checked on that page — open it, click the scale chip → <b>Verify</b>.");
  if (S.otherTab) msgs.unshift(`<b>⚠ This project is ${esc(S.otherTab)}.</b> Two open copies overwrite each other's work when they save — keep one open. <button class="btn sm" data-reload="1">Reload this one</button>`);
  wb.innerHTML = msgs.join("<br>"); wb.classList.toggle("on", msgs.length > 0);
  if (!P.proj.items.length) { el.innerHTML = '<div class="empty">Measurements appear here as you draw, in the house format: <b>Nos × L × W × H</b> in decimal feet, deductions as their own rows.</div>'; $("shInfo").textContent = ""; return; }
  let h = '<table class="sh"><thead><tr><th>#</th><th>Description</th><th class="n">Nos × L × W × H</th><th class="n">Qty</th></tr></thead><tbody>', n = 0;
  P.proj.conds.forEach(c => {
    const its = shSorted(P.proj.items.filter(i => i.cond === c.id && qaFilterOk(i) && shMatch(i, c)), c); if (!its.length) return;
    const t = condTotals(c);
    h += `<tr class="ch"><td colspan="4"><span class="sw" style="background:${c.color}"></span>${c.boq ? `<span class="boq">${esc(c.boq)}</span> ` : ""}${esc(c.name)} <span style="font-weight:400;color:var(--muted)">(${esc(c.unit)})</span></td></tr>`;
    its.forEach(it => {
      const k = itemScale(it), vp = viewportAt(it.file, it.page, it.pts[0]), lt = locText(locOf(it)), pg = pageName(it) + (vp ? " · " + vp.name : "") + (lt ? " · " + lt : "");
      if (!k) { h += `<tr class="it${it.id === S.sel ? " sel" : ""}" data-item="${esc(it.id)}"><td>${++n}</td><td>${esc(it.label || kindName(it, c))}<div class="ds">${esc(pg)} · scale not set</div></td><td class="n">—</td><td class="n">—</td></tr>`; return; }
      rowsOf(it, k).forEach((r, i) => {
        const desc = (r.sign < 0 ? "Ded. " : "") + (it.label || kindName(it, c)) + (r.part ? " — part " + String.fromCharCode(96 + r.part) : "");
        const sub = [pg, r.runs && r.runs.length > 1 ? "runs " + r.runs.map(f3).join(" + ") : "", r.how === "poly" ? "plan area of the " + r.sides + "-sided outline" : "", r.how === "circle" ? "circle, dia " + f3(r.D) + " ft" + (c.type === "area" ? " — area = π/4 × D²" : " — length = π × D") : "",
                     c.type === "linear" && c.unit === "Sft" && (+c.faces || 1) > 1 && it.kind !== "ded" ? "Nos includes " + c.faces + " faces" : "",
                     r.below ? "≤ " + f2(+c.dedMin || 0) + " " + (c.unit === "cft" && c.type === "area" ? "cft" : "Sft") + " — not deducted (house rule)" : "",
                     i === 0 && crossed(it) ? "⚠ OUTLINE CROSSES ITSELF — area not right, fix the points" : ""].filter(Boolean).join(" · ");
        h += `<tr class="it${r.sign < 0 ? " ded" : ""}${r.below ? " below" : ""}${it.id === S.sel ? " sel" : ""}" data-item="${esc(it.id)}"><td>${i === 0 ? ++n : ""}</td><td>${esc(desc)}${i === 0 ? qaBadges(it) + `<button class="rn" title="Rename (e.g. Bedroom 1)" data-rename="${esc(it.id)}">&#9998;</button>` : ""}<div class="ds">${esc(sub)}</div></td>
          <td class="n">${dimText(r)}</td><td class="n">${fq(r.below ? 0 : r.qty, c.unit)}</td></tr>`;
      });
    });
    h += `<tr class="tot"><td></td><td>Total ${esc(c.name)}${t.ded ? `<div class="ds">gross ${fq(t.gross, c.unit)} − deductions ${fq(t.ded, c.unit)}</div>` : ""}</td><td></td><td class="n">${fq(t.net, c.unit)} ${esc(c.unit)}</td></tr>`;
  });
  const shown = P.proj.items.filter(i => { const c = cond(i.cond); return c && qaFilterOk(i) && shMatch(i, c); }).length;
  el.innerHTML = shown ? h + "</tbody></table>" : '<div class="empty">Nothing on the sheet matches' + ((S.shQ || "").trim() ? " “" + esc(S.shQ.trim()) + "”" : "") + (S.qaFilter ? " with this check filter" : "") + '.</div>';
  $("shInfo").textContent = shown === P.proj.items.length ? P.proj.items.length + " measurements" : shown + " of " + P.proj.items.length + " shown";
}
function qaBadges(it){
  const b = [];
  if (it.qa === "checked") b.push(`<span class="tag g" title="Checked by ${esc(it.qaBy)} on ${esc(dmy(it.qaAt))}">✓ checked</span>`);
  if (it.qa === "recheck") b.push(`<span class="tag r" title="${esc(it.qaNote || "")}">recheck</span>`);
  if (it.ai && it.qa !== "checked") b.push('<span class="tag a" title="Measured by the AI assistant — check it">AI</span>');
  if (it.copied && it.qa !== "checked") b.push(`<span class="tag a" title="Copied from ${esc(keyName(it.copied.from))} (${esc(it.copied.how)}) — check it">copied</span>`);
  return b.length ? " " + b.join("") : "";
}
function pageName(it){ const f = P.proj.files.find(x => x.id === it.file); return (f ? f.name.replace(/\.pdf$/i, "") : "?") + " p." + it.page; }
function kindName(it, c){ return it.kind === "open" ? "Opening" : c.type === "count" ? c.name : c.type === "area" ? (it.kind === "ded" ? "void" : "area") : (it.kind === "ded" ? "length" : "run"); }
function renderProps(){
  $("bDel").disabled = !(S.sel || S.selMark || S.multi.size);
  if (S.multi.size && P.proj) { const its = P.proj.items.filter(i => S.multi.has(i.id)), nm = S.multi.size - its.length;
    $("props").innerHTML = `<h4>${S.multi.size} selected <span style="font-weight:400;color:var(--muted);font-size:11px">${its.length} measurement${its.length === 1 ? "" : "s"}${nm ? " · " + nm + " markup" + (nm > 1 ? "s" : "") : ""} · Shift-click adds or removes · arrow keys move · Esc clears</span></h4>
      <div class="row"><div class="fg" style="flex:2"><label>Move to condition</label><select data-mact="cond"><option value="">—</option>${P.proj.conds.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
      <button class="btn" data-mact="check">✓ Mark checked</button><button class="btn" data-mact="hide">Hide their conditions</button><button class="btn dng" data-mact="del">Delete ${S.multi.size}</button></div>
      <div class="row" style="margin-top:6px">${(() => { const t = selTotals(S.multi); return t ? `<span class="small" style="flex:1"><b>Selected:</b> ${esc(t)}</span>` : ""; })()}
      ${its.filter(isRun).length >= 2 ? '<button class="btn sm" data-mact="join" title="Make the selected runs one run">Join runs</button>' : ""}<button class="btn sm" data-mact="dup" title="Duplicate (Ctrl+D)">Duplicate</button><button class="btn sm" data-mact="lock" title="Lock / unlock (Ctrl+Shift+L)">${[...S.multi].map(objById).every(o => o && o.locked) ? "Unlock" : "Lock"}</button><button class="btn sm" data-mact="rot" title="Rotate 90° clockwise">&#8635; 90°</button></div>`;
    $("props").classList.add("on"); return; }
  const el = $("props"), it = S.sel && P.proj ? P.proj.items.find(i => i.id === S.sel) : null;
  const mk = !it && S.selMark && P.proj ? (P.proj.marks || []).find(m => m.id === S.selMark) : null;
  if (mk) { el.innerHTML = mkPropsHtml(mk); el.classList.add("on"); return; }
  if (!it) { el.classList.remove("on"); el.innerHTML = ""; return; }
  const c = cond(it.cond), k = itemScale(it), poly = itemPoly(it);
  const meas = !k ? "scale not set" : it.shape === "circle" ? "dia " + f3(2 * dist(it.pts[0], it.pts[1]) / k) + " ft · " + (c.type === "area" ? fq(polyArea(poly) / k / k) + " Sft" : f3(polyLen(poly, true) / k) + " ft round")
    : c.type === "area" ? fq(polyArea(it.pts) / k / k) + " Sft measured · perimeter " + f3(polyLen(it.pts, true) / k) + " ft" : c.type === "linear" ? f3(it.kind === "open" ? dist(it.pts[0], it.pts[1]) / k : polyLen(it.pts) / k) + " ft measured" : it.pts.length + " points";
  el.innerHTML = `<h4>${esc(c.name)} — ${esc(kindName(it, c))} <span style="font-weight:400;color:var(--muted);font-size:11px">${esc(meas)}</span></h4>
    <div class="row"><div class="fg" style="flex:2"><label>Label</label><input type="text" data-prop="label" value="${esc(it.label)}" placeholder="e.g. Bed room 1"></div>
    <div class="fg"><label>Nos (×)</label><input type="number" min="1" step="1" data-prop="nos" value="${+it.nos || 1}"></div>
    ${it.kind === "open" ? `<div class="fg"><label>Width ft</label><input type="text" data-prop="ow" value="${it.ow ? f3(it.ow) : ""}" placeholder="${k ? f3(dist(it.pts[0], it.pts[1]) / k) : ""}"></div><div class="fg"><label>Height ft</label><input type="text" data-prop="oh" value="${f3(+it.oh || 0)}"></div>` : ""}
    ${c.type !== "count" && it.kind !== "open" ? `<div class="fg"><label>Measured as</label><select data-prop="kind"><option value="shape"${it.kind === "shape" ? " selected" : ""}>Add</option><option value="ded"${it.kind === "ded" ? " selected" : ""}>Deduct</option></select></div>` : ""}
    <div class="fg"><label>Condition</label><select data-prop="cond">${P.proj.conds.filter(x => x.type === c.type).map(x => `<option value="${esc(x.id)}"${x.id === it.cond ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div><div class="fg"><label>Condition colour</label><input type="color" data-prop="color" value="${/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#2a78d6"}" style="height:30px;padding:0"></div><div class="fg"><label>Line weight</label><input type="number" min="1" max="12" step="1" data-prop="sw" value="${+c.sw || 2}"></div>
    <button class="btn dng" data-act="delItem"${it.locked ? " disabled" : ""}>Delete</button></div>
    <div class="row" style="margin-top:6px;gap:4px">${it.locked ? '<span class="tag a">&#128274; locked</span>' : ""}<button class="btn sm" data-act="lock" title="Ctrl+Shift+L">${it.locked ? "&#128275; Unlock" : "&#128274; Lock"}</button><button class="btn sm" data-act="dup" title="Ctrl+D">Duplicate</button>
      ${isRun(it) ? '<button class="btn sm" data-act="brk" title="Break tool (B): click where to cut the run">&#9986; Break…</button>' : ""}${S.selPt >= 0 && (c.type === "count" || editPts(it)) ? '<button class="btn sm dng" data-act="delPoint">Remove point ' + (S.selPt + 1) + "</button>" : ""}
      <span class="small" style="flex:1;min-width:160px">${editPts(it) && !it.locked ? "Double-click a side to add a point, a point to remove it · drag the + to add one" : ""} · right-click for more</span></div>
    ${it.kind === "open" ? `<div class="row" style="margin-top:6px"><div class="fg"><label>Schedule mark</label><select data-prop="sch"><option value="">— none (own size) —</option>${(P.proj.openings || []).map(o => `<option value="${esc(o.id)}"${o.id === it.sch ? " selected" : ""}>${esc(o.mark)} — ${f3(o.w)} × ${f3(o.h)} ${esc(o.type)}</option>`).join("")}</select></div></div>` : ""}
    ${c.type === "area" && it.kind === "shape" && k ? (() => { const dr = doorsOn(it), per = polyLen(poly, true) / k; return `<div class="row" style="margin-top:6px"><div class="fg"><label>Doors on outline (ft)</label><input type="text" data-prop="doorW" value="${dr.manual ? f3(dr.ft) : ""}" placeholder="auto ${f3(dr.ft)}"></div>
      <div class="fg" style="flex:2"><span class="small">P ${f3(per)} − doors ${f3(Math.min(per, dr.ft))} = <b>PD ${f3(per - Math.min(per, dr.ft))} ft</b> ${dr.manual ? "(typed)" : "(auto: " + dr.n + " door opening" + (dr.n === 1 ? "" : "s") + " on this outline)"}</span></div></div>`; })() : ""}
    <div class="row" style="margin-top:6px">${LOC_KEYS.map(lk => { const sh = (P.proj.sheets || {})[keyOf(it.file, it.page)] || {}; return `<div class="fg"><label>${LOC_NAMES[lk]}</label><input type="text" data-prop="${lk}" list="dlp_${lk}" value="${esc(it[lk] || "")}" placeholder="${esc(sh[lk] || (lk === "room" ? it.label || "" : ""))}"><datalist id="dlp_${lk}">${locValues(lk).map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>`; }).join("")}</div>
    <div class="row" style="margin-top:6px"><div class="fg"><label>QA status</label><select data-prop="qa">${Object.entries(QA_NAMES).map(([q, n]) => `<option value="${q}"${(it.qa || "") === q ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="fg" style="flex:2"><label>QA note</label><input type="text" data-prop="qaNote" value="${esc(it.qaNote || "")}" placeholder="e.g. confirm against section B-B"></div></div>
    <div class="small" style="margin-top:4px">${it.qa === "checked" ? "Checked by " + esc(it.qaBy) + ", " + esc(dmy(it.qaAt)) : "Not checked"}${it.ai ? " · AI-generated" : ""}${it.copied ? " · copied from " + esc(keyName(it.copied.from)) + " (" + esc(it.copied.how) + ")" : ""}</div>`;
  el.classList.add("on");
}

/* ------------------------------------------------------------------ count markers (Bluebeam-style symbols and captions) */
const SYMS = {check: "Check ✓", circle: "Circle", square: "Square", triangle: "Triangle", diamond: "Diamond", cross: "Cross ✕", dot: "Dot"};
function countSvg(c, pts, T, z, selIdx){
  const sym = c.sym || "circle", cap = c.cap || "seq", r = ({s: 7, m: 10, l: 14}[c.sz || "m"]) * z, col = c.color, out = [];
  pts.forEach((p, i) => {
    const q = T(p), x = q[0], y = q[1], w = (i === selIdx ? 3.5 : 2.5) * z, fo = 'fill-opacity=".3"';
    if (sym === "check") out.push(`<path d="M${x - r} ${y}L${x - r * 0.3} ${y + r * 0.7}L${x + r} ${y - r * 0.8}" fill="none" stroke="${col}" stroke-width="${w + z}" stroke-linecap="round" stroke-linejoin="round"/>`);
    else if (sym === "square") out.push(`<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${col}" ${fo} stroke="${col}" stroke-width="${w}"/>`);
    else if (sym === "triangle") out.push(`<path d="M${x} ${y - r}L${x + r} ${y + r * 0.8}L${x - r} ${y + r * 0.8}Z" fill="${col}" ${fo} stroke="${col}" stroke-width="${w}"/>`);
    else if (sym === "diamond") out.push(`<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${col}" ${fo} stroke="${col}" stroke-width="${w}"/>`);
    else if (sym === "cross") out.push(`<path d="M${x - r * 0.8} ${y - r * 0.8}L${x + r * 0.8} ${y + r * 0.8}M${x + r * 0.8} ${y - r * 0.8}L${x - r * 0.8} ${y + r * 0.8}" stroke="${col}" stroke-width="${w + z}" stroke-linecap="round"/>`);
    else if (sym === "dot") out.push(`<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="${col}" stroke="#fff" stroke-width="${z}"/>`);
    else out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" ${fo} stroke="${col}" stroke-width="${w}"/>`);
    const t = cap === "seq" ? String(i + 1) : cap === "name" ? c.name : cap === "text" ? (c.capText || "") : "";
    if (t) { const inside = cap === "seq" && ["circle", "square", "diamond"].indexOf(sym) >= 0 && t.length <= 3;
      out.push(inside ? `<text x="${x}" y="${y + 4 * z}" text-anchor="middle" font-size="${11.5 * z}" font-weight="700" fill="#0b0b0b">${esc(t)}</text>`
        : `<text x="${x + r + 3 * z}" y="${y + 4 * z}" font-size="${11 * z}" font-weight="700" fill="${col}" stroke="#fff" stroke-width="${3 * z}" paint-order="stroke">${esc(t)}</text>`); }
  });
  return out.join("");
}

/* ------------------------------------------------------------------ editing: points, segments, break / gap / join, convert
   Points: drag; double-click (or Shift+click) a side to add one, a point to remove it; the + at the middle of a side
   drags out a new point. Runs (lengths): Break (B) cuts one in two where clicked, Shift+click with Break deletes one
   segment, Cut a gap takes out the part between two clicks (a door across a skirting), Join makes selected runs one,
   Continue drawing carries a run on from its nearer end. An area's outline can become a run (skirting, plaster) and a
   run of 3+ points an area. Locked objects (Ctrl+Shift+L) are not moved, edited or deleted. */
const lockedMsg = () => toast("Locked — right-click → Unlock first (Ctrl+Shift+L)", 2500);
function delPoint(it, vi){
  const c = cond(it.cond); if (!c) return;
  if (it.locked) return lockedMsg();
  if (c.type === "count") { if (it.pts.length <= 1) return delObjects(new Set([it.id])); mutate(() => { it.pts.splice(vi, 1); }, "Remove count point"); S.selPt = -1; draw(); return; }
  if (!editPts(it)) return toast(it.kind === "open" ? "An opening has two ends — drag them to change it" : "A circle is its centre and edge point — drag them to change it", 3000);
  const min = c.type === "area" ? 3 : 2;
  if (it.pts.length <= min) return toast(c.type === "area" ? "An area needs at least 3 points — delete the whole area instead (Delete)" : "A run needs at least 2 points — delete the whole run instead (Delete)", 3200);
  mutate(() => { it.pts.splice(vi, 1); delete it.arcs; qaMoved(it); }, "Remove point");
  S.selPt = -1; draw();
}
function addPoint(it, i, p){
  if (it.locked) return lockedMsg();
  if (!editPts(it)) return toast("Points can be added to areas and runs only", 2500);
  mutate(() => { it.pts.splice(i + 1, 0, p.slice()); delete it.arcs; qaMoved(it); }, "Add point");
  S.selPt = i + 1; draw();
}
function runAt(sp){   // the length run under a screen point -> {it, i, p, d}
  const items = pageItems();
  for (let n = items.length - 1; n >= 0; n--) { const it = items[n]; if (!isRun(it)) continue; const s = segAt(it, sp); if (s) return Object.assign({it}, s); }
  return null;
}
function cloneItem(it, pts){ const nb = Object.assign(JSON.parse(JSON.stringify(it)), {id: uid("I"), pts: pts.map(p => p.slice())}); delete nb.arcs; delete nb.locked; return nb; }
function breakRun(it, i, p){
  if (it.locked) return lockedMsg();
  const A = it.pts.slice(0, i + 1).map(q => q.slice()), B = it.pts.slice(i + 1).map(q => q.slice());
  if (dist(A[A.length - 1], p) > 1e-6) A.push(p.slice()); if (!B.length || dist(B[0], p) > 1e-6) B.unshift(p.slice());
  if (A.length < 2 || B.length < 2 || polyLen(A) < 1e-6 || polyLen(B) < 1e-6) return toast("That is the end of the run — nothing to break there", 2500);
  const nb = cloneItem(it, B);
  mutate(() => { it.pts = A; delete it.arcs; qaMoved(it); qaMoved(nb); P.proj.items.splice(P.proj.items.indexOf(it) + 1, 0, nb); }, "Break run");
  setSel([it.id, nb.id]); refresh();
  const k = itemScale(it); toast("Broken in two" + (k ? ": " + f3(polyLen(A) / k) + " + " + f3(polyLen(B) / k) + " ft" : "") + " — both halves selected", 2600);
}
function delSegment(it, i){
  if (it.locked) return lockedMsg();
  if (!isRun(it)) return toast("Only a run's segments can be deleted — for an area, remove a point (double-click it)", 3200);
  const A = it.pts.slice(0, i + 1), B = it.pts.slice(i + 1), keep = [A, B].filter(x => x.length >= 2), k = itemScale(it), gone = dist(it.pts[i], it.pts[i + 1]);
  mutate(() => {
    if (!keep.length) { P.proj.items = P.proj.items.filter(x => x !== it); return; }
    it.pts = keep[0].map(q => q.slice()); delete it.arcs; qaMoved(it);
    if (keep[1]) P.proj.items.splice(P.proj.items.indexOf(it) + 1, 0, cloneItem(it, keep[1]));
  }, "Delete segment");
  if (!keep.length) setSel([]); refresh();
  toast("Segment deleted" + (k ? " (" + f3(gone / k) + " ft)" : "") + (keep.length === 2 ? " — the run is now two" : ""), 2400);
}
function breakClick(sp, e){
  const r = runAt(sp);
  if (!r) { const hi = hitInfo(sp); return toast(hi ? "Break works on lengths (runs). For an area, double-click a point to remove it or a side to add one." : "Click on a length run to break it there", 3000); }
  if (r.it.locked) return lockedMsg();
  if (e.shiftKey) return delSegment(r.it, r.i);
  const vi = vertexAt(r.it, sp);
  if (vi > 0 && vi < r.it.pts.length - 1) return breakRun(r.it, vi - 1, r.it.pts[vi]);
  breakRun(r.it, r.i, r.p);
}
function startGap(it, at){ if (!at) return; setTool("gap"); S.gap = {id: it.id, i: at.i, p: at.p.slice()}; hint(); toast("Now click the other end of the gap on the same run", 2600); }
function gapClick(sp){
  const g = S.gap, it = g && P.proj.items.find(i => i.id === g.id); if (!it) { setTool("select"); return; }
  const r = runAt(sp); if (!r || r.it.id !== it.id) return toast("Click on the same run", 2000);
  cutGap(it, g.i, g.p, r.i, r.p); setTool("select");
}
function cutGap(it, i1, p1, i2, p2){
  const t = (i, p) => i + dist(it.pts[i], p) / Math.max(1e-9, dist(it.pts[i], it.pts[i + 1]));
  if (t(i2, p2) < t(i1, p1)) [i1, p1, i2, p2] = [i2, p2, i1, p1];
  const A = it.pts.slice(0, i1 + 1).concat([p1]).map(q => q.slice()), B = [p2].concat(it.pts.slice(i2 + 1)).map(q => q.slice());
  const keep = [A, B].filter(x => x.length >= 2 && polyLen(x) > 1e-6), k = itemScale(it), before = polyLen(it.pts);
  mutate(() => {
    if (!keep.length) { P.proj.items = P.proj.items.filter(x => x !== it); return; }
    it.pts = keep[0]; delete it.arcs; qaMoved(it);
    if (keep[1]) P.proj.items.splice(P.proj.items.indexOf(it) + 1, 0, cloneItem(it, keep[1]));
  }, "Cut gap");
  refresh(); const after = keep.reduce((a, x) => a + polyLen(x), 0);
  toast("Gap cut out" + (k ? ": " + f3((before - after) / k) + " ft" : ""), 2400);
}
function joinRuns(ids){
  const runs = P.proj.items.filter(i => ids.has(i.id) && isRun(i));
  if (runs.length < 2) return toast("Select two or more runs (lengths) to join", 2500);
  if (runs.some(r => r.locked)) return lockedMsg();
  let chain = runs[0].pts.map(p => p.slice()), rest = runs.slice(1), gap = 0;
  while (rest.length) {   // the nearest free end each time
    let best = null; const s0 = chain[0], e0 = chain[chain.length - 1];
    rest.forEach((r, ri) => { const a = r.pts[0], b = r.pts[r.pts.length - 1]; [[dist(e0, a), "ea"], [dist(e0, b), "eb"], [dist(s0, b), "sb"], [dist(s0, a), "sa"]].forEach(([d, how]) => { if (!best || d < best.d) best = {d, how, ri}; }); });
    const r = rest.splice(best.ri, 1)[0]; let Q = r.pts.map(p => p.slice()); gap += best.d; const touch = best.d < 1e-6;
    if (best.how === "eb" || best.how === "sa") Q.reverse();
    chain = best.how === "ea" || best.how === "eb" ? chain.concat(touch ? Q.slice(1) : Q) : (touch ? Q.slice(0, -1) : Q).concat(chain);
  }
  const k = itemScale(runs[0]), drop = new Set(runs.slice(1).map(r => r.id)), mixed = new Set(runs.map(r => r.cond)).size > 1;
  mutate(() => { runs[0].pts = chain; delete runs[0].arcs; qaMoved(runs[0]); P.proj.items = P.proj.items.filter(i => !drop.has(i.id)); }, "Join " + runs.length + " runs");
  setSel([runs[0].id]); refresh();
  toast("Joined into one run" + (k && gap / k > 0.01 ? " — " + f3(gap / k) + " ft of line added across the gaps" : "") + (mixed ? " · kept in " + cond(runs[0].cond).name : ""), 3600);
}
function resumeRun(it, q){   // carry on drawing a run from its nearer end (Bluebeam "Resume")
  if (it.locked) return lockedMsg();
  const atStart = q && dist(q, it.pts[0]) < dist(q, it.pts[it.pts.length - 1]);
  S.cond = it.cond; setTool("draw");
  S.resume = {id: it.id, atStart};
  S.draft = (atStart ? it.pts.slice().reverse() : it.pts.slice()).map(p => p.slice()); S.draftSteps = [S.draft.length]; S.draftArcs = [];
  hint(); draftBtns(); draw(); toast("Continuing the run from its " + (atStart ? "start" : "end") + " — click on, Enter to finish, Esc to leave it as it was", 3000);
}
function toRun(it, condId){   // an area's outline (or a circle's rim) as a run in a length condition: skirting, plaster, walls of a room
  const c = cond(condId); if (!c) return;
  const nb = it.shape === "circle" ? {id: uid("I"), cond: condId, file: it.file, page: it.page, kind: "shape", shape: "circle", pts: it.pts.map(p => p.slice()), nos: 1, label: it.label || ""}
    : {id: uid("I"), cond: condId, file: it.file, page: it.page, kind: "shape", pts: it.pts.map(p => p.slice()).concat([it.pts[0].slice()]), nos: 1, label: it.label || ""};
  LOC_KEYS.forEach(lk => { if (it[lk]) nb[lk] = it[lk]; });
  mutate(() => { P.proj.items.push(nb); }, "Perimeter run in " + c.name);
  S.cond = condId; setSel([nb.id]); refresh();
  const k = itemScale(nb); toast("Perimeter run added to " + c.name + (k ? ": " + f3(it.shape === "circle" ? polyLen(itemPoly(nb), true) / k : polyLen(nb.pts) / k) + " ft" : "") + " — openings are deducted with O", 3200);
}
function toArea(it, condId){
  const c = cond(condId); if (!c) return;
  let pts = it.pts.map(p => p.slice()); if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  if (pts.length < 3 || polyArea(pts) < 1e-6) return toast("A run needs 3 or more points round an area to make one", 2800);
  const nb = {id: uid("I"), cond: condId, file: it.file, page: it.page, kind: "shape", pts, nos: 1, label: it.label || ""};
  LOC_KEYS.forEach(lk => { if (it[lk]) nb[lk] = it[lk]; });
  mutate(() => { P.proj.items.push(nb); }, "Area in " + c.name);
  S.cond = condId; setSel([nb.id]); refresh();
  const k = itemScale(nb); toast("Area added to " + c.name + (k ? ": " + fq(polyArea(pts) / k / k) + " Sft" : ""), 2600);
}
function explodeRun(it){   // PlanSwift "segment" takeoff: every leg its own run (an arc stays one piece)
  if (it.locked) return lockedMsg();
  const arcs = Array.isArray(it.arcs) ? it.arcs : [], cuts = [0];
  for (let i = 1; i < it.pts.length - 1; i++) if (!arcs.some(a => i > a[0] && i < a[1])) cuts.push(i);
  cuts.push(it.pts.length - 1);
  if (cuts.length < 3) return toast("A single segment — nothing to explode", 2000);
  const pieces = []; for (let j = 1; j < cuts.length; j++) pieces.push(it.pts.slice(cuts[j - 1], cuts[j] + 1));
  const news = pieces.slice(1).map(q => { const nb = cloneItem(it, q), a = arcs.find(r => r[0] === cuts[pieces.indexOf(q)]); if (a) nb.arcs = [[0, q.length - 1]]; return nb; });
  mutate(() => { const a0 = arcs.find(r => r[0] === 0 && r[1] === pieces[0].length - 1); it.pts = pieces[0].map(q => q.slice()); if (a0) it.arcs = [[0, it.pts.length - 1]]; else delete it.arcs; qaMoved(it); P.proj.items.splice(P.proj.items.indexOf(it) + 1, 0, ...news); }, "Explode into " + pieces.length + " segments");
  setSel([it.id].concat(news.map(n => n.id))); refresh(); toast("Exploded into " + pieces.length + " runs, one per segment", 2400);
}
function closeRun(it){
  if (it.locked) return lockedMsg();
  if (it.pts.length < 3) return toast("A run needs 3 or more points to close into a loop", 2400);
  if (dist(it.pts[0], it.pts[it.pts.length - 1]) < 1e-6) return toast("This run already closes on its start", 2000);
  mutate(() => { it.pts.push(it.pts[0].slice()); qaMoved(it); }, "Close run");
  const k = itemScale(it); if (k) toast("Closed: " + f3(polyLen(it.pts) / k) + " ft", 1800);
}
function offsetRun(Q, d){   // a run moved sideways by d (+ to the left of its direction on screen, − to the right), corners mitred
  const L = []; for (let i = 0; i + 1 < Q.length; i++) { const a = Q[i], b = Q[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; L.push({p: [a[0] + dy / l * d, a[1] - dx / l * d], u: [dx / l, dy / l], n: [dy / l, -dx / l]}); }
  return Q.map((q, i) => { const A = L[Math.max(0, i - 1)], B = L[Math.min(L.length - 1, i)];
    if (i === 0 || i === Q.length - 1) { const N = i === 0 ? B : A; return [q[0] + N.n[0] * d, q[1] + N.n[1] * d]; }
    const den = A.u[0] * B.u[1] - A.u[1] * B.u[0]; if (Math.abs(den) < 1e-6) return [q[0] + B.n[0] * d, q[1] + B.n[1] * d];
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den; return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]; });
}
function offsetItem(it, ft, keep){   // an area grown (+) / shrunk (−), or a run moved sideways, by ft; keep: add a copy, else change it
  const k = itemScale(it); if (!k) return toast("Set the page scale first (K) — the distance is in feet", 2600);
  if (!keep && it.locked) return lockedMsg();
  const c = cond(it.cond), d = ft * k; let pts;
  if (it.shape === "circle") { const r = dist(it.pts[0], it.pts[1]), u = [(it.pts[1][0] - it.pts[0][0]) / r, (it.pts[1][1] - it.pts[0][1]) / r]; if (r + d <= 0) return toast("That is more than the radius", 2200); pts = [it.pts[0].slice(), [it.pts[0][0] + u[0] * (r + d), it.pts[0][1] + u[1] * (r + d)]]; }
  else if (c.type === "area") { pts = offsetPoly(it.pts, d); if (polyArea(pts) < 1e-6 || (d < 0 && polyArea(pts) >= polyArea(it.pts))) return toast("The outline would turn inside out — use a smaller distance", 2600); }
  else pts = offsetRun(it.pts, d);
  if (keep) { const nb = cloneItem(it, pts); if (it.shape === "circle") nb.shape = "circle"; mutate(() => { P.proj.items.splice(P.proj.items.indexOf(it) + 1, 0, nb); }, "Offset copy"); setSel([nb.id]); }
  else mutate(() => { it.pts = pts; delete it.arcs; qaMoved(it); }, "Offset");
  refresh();
}
async function offsetDialog(it){
  const c = cond(it.cond), area = c.type === "area" || it.shape === "circle", t = +c.t || 0;
  const v = await ask("Offset " + (area ? "outline" : "run"), `<p>${area ? "Grow or shrink the outline by a distance — e.g. the slab's outer edge from the room's inside face, a ceiling less a cornice." : "Move the run sideways by a distance — e.g. from a wall face to its centre line (half the thickness)."}</p>
    <div class="grid" style="margin-top:8px"><div class="fg"><label>Distance (ft, or ft-in)</label><input type="text" id="ofD" value="${t ? f3(t / 2) : ""}" placeholder="e.g. 0.375 or 4 1/2&quot;"></div>
    <div class="fg"><label>Direction</label><select id="ofS">${area ? '<option value="1">Outward (bigger)</option><option value="-1">Inward (smaller)</option>' : '<option value="1">Left of its direction (as drawn)</option><option value="-1">Right of its direction</option>'}</select></div>
    <div class="fg w2"><label class="pk"><input type="checkbox" id="ofK" checked> Keep the original — add the offset as a new measurement</label></div></div>
    ${t ? `<p class="small" style="margin-top:6px">Filled with half of ${esc(c.name)}'s thickness (T ${f3(t)} ft).</p>` : ""}`, "Offset",
    () => { const raw = $("ofD").value.trim(); let d = parseFt(raw); if (isNaN(d) && /^\d+(\.\d+)?\s*"$/.test(raw)) d = parseFloat(raw) / 12; if (!(d > 0)) return "Enter a distance, e.g. 0.375 or 4 1/2\""; return {d: d * +$("ofS").value, keep: $("ofK").checked}; }, "ofD");
  if (v) offsetItem(it, v.d, v.keep);
}
/* rotate / flip (about the middle of the selection), order, lock */
function transformSel(kind){
  const objs = [...selIds()].map(objById).filter(o => o && onPage(o));
  if (!objs.length) return toast("Select something first", 2000);
  const free = objs.filter(o => !o.locked); if (!free.length) return lockedMsg();
  const pts = free.flatMap(o => o.pts), c = [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2];
  const F = {cw: p => [c[0] - (p[1] - c[1]), c[1] + (p[0] - c[0])], ccw: p => [c[0] + (p[1] - c[1]), c[1] - (p[0] - c[0])], fh: p => [2 * c[0] - p[0], p[1]], fv: p => [p[0], 2 * c[1] - p[1]]}[kind];
  mutate(() => free.forEach(o => { o.pts = o.pts.map(F); if (o.cond) qaMoved(o); }), {cw: "Rotate 90° clockwise", ccw: "Rotate 90° anticlockwise", fh: "Flip left–right", fv: "Flip up–down"}[kind]);
}
function orderSel(dir){   // 1: bring to front (drawn last, picked first), -1: send to back
  const ids = selIds(); if (!ids.size) return;
  mutate(() => { ["items", "marks"].forEach(k => { const A = P.proj[k] || [], mine = A.filter(o => ids.has(o.id)), rest = A.filter(o => !ids.has(o.id)); P.proj[k] = dir > 0 ? rest.concat(mine) : mine.concat(rest); }); }, dir > 0 ? "Bring to front" : "Send to back");
}
function lockSel(){
  const objs = [...selIds()].map(objById).filter(Boolean); if (!objs.length) return toast("Select something first", 2000);
  const lock = objs.some(o => !o.locked);
  mutate(() => objs.forEach(o => { if (lock) o.locked = true; else delete o.locked; }), lock ? "Lock" : "Unlock");
  toast((lock ? "Locked " : "Unlocked ") + objs.length + (lock ? " — not moved, edited or deleted until unlocked" : ""), 2600);
}
function delObjects(ids){
  const objs = [...ids].map(objById).filter(Boolean), lk = objs.filter(o => o.locked).length, del = new Set(objs.filter(o => !o.locked).map(o => o.id));
  if (!del.size) return lockedMsg();
  mutate(() => { P.proj.items = P.proj.items.filter(i => !del.has(i.id)); P.proj.marks = (P.proj.marks || []).filter(m => !del.has(m.id)); }, "Delete " + del.size + " object" + (del.size > 1 ? "s" : ""));
  setSel([...ids].filter(id => !del.has(id))); refresh();
  toast(del.size + " deleted" + (lk ? " · " + lk + " locked left" : "") + " — Ctrl+Z brings " + (del.size > 1 ? "them" : "it") + " back", 2600);
}
/* delete what is selected: a markup, a count point, a selected point of an outline, or measurements (🗑, Delete) */
function delSelected(){
  if (!P.proj) return;
  const one = selOne();
  if (one && S.selPt >= 0 && !one.locked) {
    const c = cond(one.cond);
    if (c && c.type === "count" && one.pts.length > 1) { mutate(() => { one.pts.splice(S.selPt, 1); }, "Remove count point"); S.selPt = -1; refresh(); return; }
    if (editPts(one) && one.pts.length > (c.type === "area" ? 3 : 2)) { delPoint(one, S.selPt); toast("Point removed — Delete again removes the whole measurement", 2400); return; }
  }
  const ids = selIds();
  if (!ids.size) return toast("Select a measurement or markup first (Select V, then click it)");
  delObjects(ids);
}
/* ------------------------------------------------------------------ copy / paste (Bluebeam, PlanSwift)
   Ctrl+C keeps the selection (measurements and markups) with the page it came from and that page's scale. Ctrl+V
   pastes at the cursor, on any page, at the same real size (rescaled if the page's scale differs); Ctrl+Shift+V
   pastes in the same place (typical floors); Ctrl+D duplicates beside; Ctrl+X cuts; Ctrl+drag copies; "Place copies"
   puts a copy at every click; Copy at a distance / array (Ctrl+arrow) copies across and down by distances in ft. */
function clipOf(ids, onePt){
  let items = P.proj.items.filter(i => ids.has(i.id)).map(i => JSON.parse(JSON.stringify(i)));
  if (onePt) items = items.map(i => i.id === onePt.id ? Object.assign(i, {pts: [i.pts[onePt.i]]}) : i);
  const marks = (P.proj.marks || []).filter(m => ids.has(m.id)).map(m => JSON.parse(JSON.stringify(m)));
  const all = items.flatMap(i => i.pts).concat(marks.flatMap(m => m.pts)); if (!all.length) return null;
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]), anchor = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return {items, marks, key: S.key, k: hereScale(anchor), anchor, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), n: items.length + marks.length};
}
function placeClip(cl, at, o){   // -> {ids, f}: the clipboard placed on this page (inside mutate, or raw while a Ctrl+drag is live)
  o = o || {};
  const kd = hereScale(at || cl.anchor), f = at && cl.k && kd && Math.abs(kd / cl.k - 1) > 0.005 ? kd / cl.k : 1, A = cl.anchor;
  const T = o.off ? (p => [p[0] + o.off[0], p[1] + o.off[1]]) : at ? (p => [at[0] + (p[0] - A[0]) * f, at[1] + (p[1] - A[1]) * f]) : (p => p.slice());
  const ids = [];
  cl.items.forEach(src => {
    const c = cond(src.cond); if (!c) return;
    const pts = src.pts.map(T);
    if (c.type === "count" && !o.raw) { const host = P.proj.items.find(i => i.cond === c.id && onPage(i) && i.kind === "shape");
      if (host) { pts.forEach(p => { if (!host.pts.some(q => dist(q, p) < 0.5)) host.pts.push(p); }); if (!ids.includes(host.id)) ids.push(host.id); return; } }
    const it = Object.assign(JSON.parse(JSON.stringify(src)), {id: uid("I"), file: S.fileId, page: S.pageNo, pts});
    delete it.locked; it.qa = ""; delete it.qaBy; delete it.qaAt;
    P.proj.items.push(it); ids.push(it.id);
  });
  cl.marks.forEach(src => { const m = Object.assign(JSON.parse(JSON.stringify(src)), {id: uid("M"), file: S.fileId, page: S.pageNo, pts: src.pts.map(T)}); delete m.locked; (P.proj.marks = P.proj.marks || []).push(m); ids.push(m.id); });
  return {ids, f};
}
function copySel(cut){
  const ids = selIds();
  if (!ids.size) return toast("Select something first (V, click or box), then Ctrl+C");
  const one = selOne(), c1 = one && cond(one.cond), onePt = one && c1 && c1.type === "count" && S.selPt >= 0 && one.pts.length > 1 ? {id: one.id, i: S.selPt} : null;
  S.clip = clipOf(ids, onePt); if (!S.clip) return;
  if (cut) { delObjects(ids); toast("Cut " + S.clip.n + " — Ctrl+V pastes at the cursor, Ctrl+Shift+V in the same place", 2600); return; }
  toast("Copied " + (onePt ? "1 count point" : S.clip.n + " object" + (S.clip.n > 1 ? "s" : "")) + " — Ctrl+V at the cursor, Ctrl+Shift+V in the same place, on any page", 2800);
}
function pasteClip(mode, at){
  const cl = S.clip; if (!cl || !S.page) return toast("Nothing copied yet — select, then Ctrl+C", 2200);
  if (cl.items.length && cl.items.every(i => !cond(i.cond)) && !cl.marks.length) return toast("The copied measurement's condition was deleted", 2600);
  const inplace = mode === "inplace", p = inplace ? null : at || S.cursor || toBase(stage().clientWidth / 2, stage().clientHeight / 2);
  let r;
  mutate(() => { r = placeClip(cl, p); }, (inplace ? "Paste in place " : "Paste ") + cl.n);
  setSel(r.ids); if (S.tool !== "select" && S.tool !== "stamp") setTool("select"); refresh();
  if (r.f !== 1) toast("Pasted at the same real size — this page's scale is × " + r.f.toFixed(3) + " of the copied page's", 3600);
  else if (inplace && cl.key !== S.key) toast("Pasted in the same place as on " + keyName(cl.key), 2200);
}
function stampAt(p){ if (!S.clip) return setTool("select"); let r; mutate(() => { r = placeClip(S.clip, p); }, "Place copy"); setSel(r.ids); refresh(); }
function duplicateSel(){
  const ids = selIds(); if (!ids.size) return toast("Select something first, then Ctrl+D", 2000);
  const cl = clipOf(ids); if (!cl) return; let r;
  mutate(() => { r = placeClip(cl, null, {off: [18 / S.view.s, 18 / S.view.s]}); }, "Duplicate " + cl.n);
  setSel(r.ids); refresh();
}
async function arrayDialog(dir){   // PlanSwift Ctrl + arrow / Advanced Copy: copies at a distance, or a grid of them
  const ids = selIds(); if (!ids.size) return toast("Select what to copy first", 2000);
  const cl = clipOf(ids); if (!cl) return;
  const k = hereScale(cl.anchor); if (!k) return toast("Set the page scale first (K) — the distances are in feet", 3000);
  const bw = r3(cl.w / k), bh = r3(cl.h / k), D = {right: [1, 0], left: [1, 0], down: [0, 1], up: [0, 1]}[dir] || [1, 0], sg = dir === "left" || dir === "up" ? -1 : 1;
  const v = await ask("Copy at a distance / array", `<p>Copies of the ${cl.n} selected object${cl.n > 1 ? "s" : ""} (${f3(bw)} × ${f3(bh)} ft) — across (+ right, − left) and down (+ down, − up).</p>
    <div class="grid" style="margin-top:8px"><div class="fg"><label>Copies across</label><input type="number" id="arNx" min="0" step="1" value="${D[0]}"></div><div class="fg"><label>Distance across (ft, centre to centre)</label><input type="text" id="arDx" value="${f3(sg * bw)}"></div>
    <div class="fg"><label>Copies down</label><input type="number" id="arNy" min="0" step="1" value="${D[1]}"></div><div class="fg"><label>Distance down (ft)</label><input type="text" id="arDy" value="${f3(sg * bh)}"></div></div>
    <p class="small" style="margin-top:8px">Distances take decimal feet or ft-in (12'-6"). Every copy is its own measurement.</p>`, "Copy",
    () => { const nx = Math.max(0, Math.round(+$("arNx").value || 0)), ny = Math.max(0, Math.round(+$("arNy").value || 0)), dx = parseFt($("arDx").value.replace(/^\s*-/, "")) * (/^\s*-/.test($("arDx").value) ? -1 : 1), dy = parseFt($("arDy").value.replace(/^\s*-/, "")) * (/^\s*-/.test($("arDy").value) ? -1 : 1);
      if (!nx && !ny) return "Give at least one copy"; if ((nx && isNaN(dx)) || (ny && isNaN(dy))) return "Enter the distances in ft"; if ((nx + 1) * (ny + 1) - 1 > 400) return "400 copies at most"; return {nx, ny, dx: dx || 0, dy: dy || 0}; }, "arNx");
  if (!v) return;
  const all = [];
  mutate(() => { for (let i = 0; i <= v.nx; i++) for (let j = 0; j <= v.ny; j++) if (i || j) all.push(...placeClip(cl, null, {off: [i * v.dx * k, j * v.dy * k]}).ids); }, "Array " + ((v.nx + 1) * (v.ny + 1) - 1) + " copies");
  setSel(all); refresh(); toast(((v.nx + 1) * (v.ny + 1) - 1) + " copies made", 2200);
}
async function copyToPagesDialog(){
  const ids = selIds(); if (!ids.size) return toast("Select what to copy first", 2000);
  const cl = clipOf(ids); if (!cl) return;
  const pages = allPages().filter(o => o.key !== S.key); if (!pages.length) return toast("This project has only one page", 2200);
  pages.forEach(o => { o.html = esc(o.f.name.replace(/\.pdf$/i, "")) + " — p." + o.i + ` <span class="small">${esc(scaleState(P.proj.scales[o.key]).ic + " " + scaleState(P.proj.scales[o.key]).t)}</span>`; });
  const v = await ask("Copy to other pages", `<p>Copy the ${cl.n} selected object${cl.n > 1 ? "s" : ""} to the same place on the pages you tick (typical floors). The copies are marked <b>copied — not checked</b>.</p>${pageList(pages, "cp")}`, "Copy",
    () => { const t = [...document.querySelectorAll("[data-cp]")].filter(x => x.checked).map(x => pages[+x.dataset.cp]); return t.length ? {t} : "Tick at least one page"; });
  if (!v) return;
  const cur = {f: S.fileId, p: S.pageNo}; let n = 0;
  mutate(() => { v.t.forEach(o => { S.fileId = o.f.id; S.pageNo = o.i; const r = placeClip(cl, null); r.ids.forEach(id => { const it = P.proj.items.find(i => i.id === id); if (it) it.copied = {from: cl.key, how: "copy to pages", at: new Date().toISOString()}; }); n += r.ids.length; }); S.fileId = cur.f; S.pageNo = cur.p; }, "Copy to " + v.t.length + " pages");
  toast(n + " copies on " + v.t.length + " page" + (v.t.length > 1 ? "s" : ""), 2600);
}
async function renameItem(it){
  if (!it) return;
  const v = await ask("Name this measurement", `<div class="fg w2"><label>Name as it should read on the sheet</label><input type="text" id="dlgLbl" value="${esc(it.label)}" placeholder="e.g. Bedroom 1, Lounge, Kitchen"></div>
    <p class="small" style="margin-top:8px">Leave blank to show the default (“${esc(kindName(it, cond(it.cond)))}”).</p>`, "Save", () => ({v: $("dlgLbl").value.trim()}), "dlgLbl");
  if (v) mutate(() => { it.label = v.v; }, "Rename");
}
async function editMarkText(m){
  if (MK_TYPES.has(m.type)) return mkEditText(m);
  const v = await ask(MARK_TOOLS[m.type], `<div class="fg w2"><label>Text</label><input type="text" id="mkT" value="${esc(m.text || "")}"></div>`, "Save", () => ({t: $("mkT").value.trim()}), "mkT");
  if (v) mutate(() => { m.text = v.t; }, "Edit text");
}
function focusProps(){ if (S.rHide) { S.rHide = false; setPanels(); } renderProps(); const f = document.querySelector('#props [data-prop="label"],#props [data-mprop="text"]'); if (f) { f.focus(); f.select(); } }
/* ------------------------------------------------------------------ find similar symbols (auto count)
   The symbol boxed by the user is cut from the rendered page as an ink mask; every window of the page (and of the
   other pages, if asked) whose ink matches it — template ink found in the window, window ink explained by the
   template, both within 1 px — scores F = 2RP/(R+P). Windows over the strictness are counted, the best of any
   overlapping group only. Rotations by 90° are optional (doors, fittings drawn turned). */
function inkOf(ctx, W, H){ const d = ctx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 170 ? 1 : 0; return m; }
function dil1(m, W, H){ const o = new Uint8Array(m.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!m[i]) continue; o[i] = 1; if (x) o[i - 1] = 1; if (x < W - 1) o[i + 1] = 1; if (y) o[i - W] = 1; if (y < H - 1) o[i + W] = 1; } return o; }
function rot90(m, w, h){ const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + (h - 1 - y)] = m[y * w + x]; return {m: o, w: h, h: w}; }
async function renderInk(page, sc, fid){
  const vp = page.getViewport({scale: sc}), W = Math.ceil(vp.width), H = Math.ceil(vp.height), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", {willReadFrequently: true}); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await sliced(page.render({...lay(fid || S.fileId), canvasContext: ctx, viewport: vp})).promise;
  return {m: inkOf(ctx, W, H), W, H};
}
function matchInk(I, W, H, T, tw, th, thr){
  const Id = dil1(I, W, H), Td = dil1(T, tw, th), tp = [], tdp = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { if (T[y * tw + x]) tp.push(y * W + x); if (Td[y * tw + x]) tdp.push(y * W + x); }
  const nT = tp.length; if (nT < 6) return [];
  const S2 = new Int32Array((W + 1) * (H + 1));   // integral image of the page ink
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += I[y * W + x]; S2[(y + 1) * (W + 1) + x + 1] = S2[y * (W + 1) + x + 1] + row; } }
  const out = [], need = Math.ceil(thr * nT);
  for (let y = 0; y + th <= H; y++) for (let x = 0; x + tw <= W; x++) {
    const nI = S2[(y + th) * (W + 1) + x + tw] - S2[y * (W + 1) + x + tw] - S2[(y + th) * (W + 1) + x] + S2[y * (W + 1) + x];
    if (nI < 0.55 * nT || nI > 1.8 * nT) continue;
    const o = y * W + x; let hit = 0;
    for (let j = 0; j < nT; j++) { if (Id[o + tp[j]]) hit++; else if (hit + nT - j - 1 < need) { hit = -1; break; } }
    if (hit < need) continue;
    let cov = 0; for (let j = 0; j < tdp.length; j++) cov += I[o + tdp[j]];
    const R = hit / nT, P2 = Math.min(1, cov / nI), F = 2 * R * P2 / (R + P2);
    if (F >= thr) out.push({x: x + tw / 2, y: y + th / 2, F});
  }
  return out;
}
/* Find similar: the boxed symbol is looked for on this page, every page of this PDF, or every PDF of the project; what
   is found is shown as a list of small pictures, weakest match first, to tick or untick — only the ticked ones are counted */
async function findSimilar(rect){
  const c0 = cond(S.cond); if (!c0 || c0.type !== "count") { setTool("count"); }
  const c = cond(S.cond);
  const nPdf = P.proj.files.length;
  const v = await ask("Find similar — " + esc(c.name), `<p>Every symbol that looks like the one you boxed is found and shown to you first — untick any wrong ones, and only the ticked ones are counted into <b>${esc(c.name)}</b>.</p>
    <div class="grid" style="margin-top:10px"><div class="fg"><label>Search</label><select id="vsWhere"><option value="page">This page</option><option value="pdf">Every page of this PDF</option>${nPdf > 1 ? `<option value="all">Every PDF of the project (${nPdf})</option>` : ""}</select></div>
    <div class="fg"><label>Match</label><select id="vsThr"><option value="0.9">Strict (90%)</option><option value="0.82" selected>Normal (82%)</option><option value="0.72">Loose (72%)</option></select></div>
    <div class="fg w2"><label><input type="checkbox" id="vsRot" style="width:auto" checked> Also find it turned 90°, 180°, 270°</label></div></div>`, "Find",
    () => ({where: $("vsWhere").value, thr: +$("vsThr").value, rot: $("vsRot").checked}));
  if (!v) { setTool("count"); return; }
  const longSym = Math.max(rect[2] - rect[0], rect[3] - rect[1]); if (longSym < 1) return;
  const sc = Math.max(0.5, Math.min(6, 30 / longSym, 7000 / Math.max(S.base.width, S.base.height)));
  busy("Reading the symbol…"); await new Promise(r => setTimeout(r, 20));
  const cands = [], skipped = [], fid0 = S.fileId, pn0 = S.pageNo;
  try {
    const here = await renderInk(S.page, sc);
    let x0 = Math.floor(rect[0] * sc), y0 = Math.floor(rect[1] * sc), x1 = Math.ceil(rect[2] * sc), y1 = Math.ceil(rect[3] * sc);
    let bx0 = x1, by0 = y1, bx1 = x0, by1 = y0;   // trim the box to its ink
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (here.m[y * here.W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    if (bx1 <= bx0 || by1 <= by0) { busy(""); return toast("No drawing inside the box — box the symbol itself"); }
    bx0 = Math.max(0, bx0 - 1); by0 = Math.max(0, by0 - 1); bx1 = Math.min(here.W - 1, bx1 + 1); by1 = Math.min(here.H - 1, by1 + 1);
    const tw = bx1 - bx0 + 1, th = by1 - by0 + 1, T0 = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) T0[y * tw + x] = here.m[(by0 + y) * here.W + bx0 + x];
    const vars = [{m: T0, w: tw, h: th}]; if (v.rot) for (let r = 0; r < 3; r++) vars.push(rot90(vars[r].m, vars[r].w, vars[r].h));
    const files = v.where === "all" ? P.proj.files : P.proj.files.filter(f => f.id === fid0);
    const pages = []; files.forEach(f => { if (v.where === "page") pages.push({f, pn: pn0}); else for (let i = 1; i <= f.pages; i++) pages.push({f, pn: i}); });
    for (let k = 0; k < pages.length; k++) {
      const {f, pn} = pages[k], cur = f.id === fid0 && pn === pn0;
      busy("Searching " + (pages.length > 1 ? "page " + (k + 1) + " of " + pages.length + " — " : "") + f.name.replace(/\.pdf$/i, "") + " p." + pn + "…"); await new Promise(r => setTimeout(r, 10));
      let pg, ink;
      try {
        pg = cur ? S.page : await (await doc(f.id)).getPage(pn);
        const bv = pg.getViewport({scale: 1}); if (!cur && Math.max(bv.width, bv.height) * sc > 12000) { skipped.push(f.name.replace(/\.pdf$/i, "") + " p." + pn + " (sheet too large at this symbol size)"); continue; }
        if (!cur) await loadLayers(f.id);
        ink = cur ? here : await renderInk(pg, sc, f.id);
      } catch (e) { skipped.push(f.name.replace(/\.pdf$/i, "") + " p." + pn + " (" + (e.message || e) + ")"); continue; }
      let hits = [];
      vars.forEach(t => { hits = hits.concat(matchInk(ink.m, ink.W, ink.H, t.m, t.w, t.h, v.thr).map(q => Object.assign(q, {r: Math.max(t.w, t.h)}))); });
      hits.sort((a, b) => b.F - a.F);
      const keep = [];
      hits.forEach(q => { if (!keep.some(k2 => Math.hypot(k2.x - q.x, k2.y - q.y) < 0.6 * Math.max(k2.r, q.r))) keep.push(q); });
      const it = P.proj.items.find(i => i.cond === c.id && i.file === f.id && i.page === pn && i.kind === "shape"), near = Math.max(4, longSym * 0.5);
      keep.forEach(q => { const pt = [q.x / sc, q.y / sc]; if (it && it.pts.some(p2 => dist(p2, pt) < near)) return;   // already counted
        cands.push({f, pn, pt, F: q.F, img: inkThumb(ink, q.x, q.y, q.r)}); });
    }
  } catch (e) { busy(""); toast("Search failed: " + (e.message || e), 5000); setTool("count"); return; }
  busy("");
  if (!cands.length) { setTool("count"); return toast("No other matches" + (skipped.length ? " (" + skipped.length + " page" + (skipped.length > 1 ? "s" : "") + " skipped)" : "") + " — try Loose, or box the symbol more tightly", 5000); }
  const ok = await reviewMatches(c, cands, v.thr, skipped);
  if (S.fileId !== fid0 || S.pageNo !== pn0) await gotoPage(fid0, pn0);
  setTool("count");
  if (!ok || !ok.length) return toast("Nothing counted");
  let total = 0; const pagesHit = new Set(), near = Math.max(4, longSym * 0.5);
  mutate(() => {
    ok.forEach(m => {
      let it = P.proj.items.find(i => i.cond === c.id && i.file === m.f.id && i.page === m.pn && i.kind === "shape");
      if (!it) { it = {id: uid("I"), cond: c.id, file: m.f.id, page: m.pn, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
      if (!it.pts.some(q => dist(q, m.pt) < near)) { it.pts.push(m.pt); total++; pagesHit.add(m.f.id + ":" + m.pn); }
    });
  }, "Find similar");
  refresh();
  toast("Counted " + total + " matching symbol" + (total === 1 ? "" : "s") + (pagesHit.size > 1 ? " on " + pagesHit.size + " pages" : "") + " into " + c.name, 5000);
}
/* a small picture of a match, cut from the page's ink: what the eye needs to tick or untick it */
function inkThumb(ink, cx, cy, r){
  const half = Math.max(8, Math.round(r * 0.85)), sz = 2 * half, cv = document.createElement("canvas"); cv.width = sz; cv.height = sz;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(sz, sz), x0 = Math.round(cx) - half, y0 = Math.round(cy) - half;
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) { const X = x0 + x, Y = y0 + y, on = X >= 0 && Y >= 0 && X < ink.W && Y < ink.H && ink.m[Y * ink.W + X], o = 4 * (y * sz + x); im.data[o] = im.data[o + 1] = im.data[o + 2] = on ? 30 : 255; im.data[o + 3] = 255; }
  ctx.putImageData(im, 0, 0); return cv.toDataURL("image/png");
}
/* the found symbols, weakest match first, each ticked; a page can be ticked / unticked at once; resolves to the ticked ones or null */
function reviewMatches(c, cands, thr, skipped){
  const groups = []; cands.forEach((m, i) => { m.i = i; let g = groups.find(x => x.f === m.f && x.pn === m.pn); if (!g) groups.push(g = {f: m.f, pn: m.pn, L: []}); g.L.push(m); });
  groups.forEach(g => g.L.sort((a, b) => a.F - b.F));
  const weak = m => m.F < thr + 0.05, shown = 400;
  let n = 0;
  const body = `<p>${cands.length} possible match${cands.length > 1 ? "es" : ""} on ${groups.length} page${groups.length > 1 ? "s" : ""} for <b>${esc(c.name)}</b> — weakest first, the doubtful ones framed in amber. Untick the wrong ones; only the ticked ones are counted.</p>
    <div style="display:flex;gap:6px;margin:8px 0"><button class="btn sm" data-rv="all">Tick all</button><button class="btn sm" data-rv="none">Untick all</button><button class="btn sm" data-rv="weak">Untick the doubtful</button><span class="small" id="rvN" style="align-self:center"></span></div>
    <div style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:6px">${groups.map(g => `<div style="margin-bottom:8px"><label style="font-weight:700;font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" checked data-rvg="${g.L[0].i}" style="width:auto"> ${esc(g.f.name.replace(/\.pdf$/i, ""))} — p.${g.pn} <span class="small" style="font-weight:400">(${g.L.length})</span></label>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${g.L.map(m => (n++ < shown) ? `<label title="${Math.round(m.F * 100)}% match" style="display:flex;flex-direction:column;align-items:center;border:2px solid ${weak(m) ? "var(--amber)" : "var(--line)"};border-radius:5px;padding:2px;cursor:pointer;font-size:10px;background:#fff"><img src="${m.img}" width="44" height="44" style="image-rendering:pixelated;display:block"><span><input type="checkbox" checked data-rvm="${m.i}" data-g="${g.L[0].i}" style="width:auto;margin:0 2px 0 0">${Math.round(m.F * 100)}%</span></label>` : `<input type="checkbox" checked data-rvm="${m.i}" data-g="${g.L[0].i}" hidden>`).join("")}</div></div>`).join("")}
      ${n > shown ? `<p class="small">${n - shown} more not pictured (ticked) — tick / untick them with their page.</p>` : ""}</div>
    ${skipped.length ? `<p class="small" style="margin-top:6px;color:#8a5a00">Not searched: ${esc(skipped.slice(0, 5).join(" · "))}${skipped.length > 5 ? " · …" : ""}</p>` : ""}`;
  const p = ask("Check the matches — " + c.name, body, "Count ticked", () => cands.filter(m => { const b = $("dlgB").querySelector(`[data-rvm="${m.i}"]`); return b && b.checked; }));
  const B = $("dlgB"), boxes = () => [...B.querySelectorAll("[data-rvm]")];
  const upd = () => { const k = boxes().filter(x => x.checked).length; $("rvN").textContent = k + " of " + cands.length + " ticked"; if ($("dlgOk")) $("dlgOk").textContent = "Count " + k; };
  B.addEventListener("change", e => { const g = e.target.dataset.rvg; if (g != null) boxes().filter(x => x.dataset.g === g).forEach(x => { x.checked = e.target.checked; }); upd(); });
  B.querySelectorAll("[data-rv]").forEach(b => b.onclick = () => { const w = b.dataset.rv; boxes().forEach(x => { if (w === "all") x.checked = true; else if (w === "none") x.checked = false; else if (weak(cands[+x.dataset.rvm])) x.checked = false; }); upd(); });
  upd(); return p;
}

/* ------------------------------------------------------------------ find text on the drawings */
async function pageTexts(fileId, pageNo){
  const key = keyOf(fileId, pageNo);
  if (S.texts[key]) return S.texts[key];
  try {
    const pg = await (await doc(fileId)).getPage(pageNo), base = pg.getViewport({scale: 1}), tc = await pg.getTextContent();
    S.texts[key] = withOcr(key, tc.items.filter(t => t.str && t.str.trim()).map(t => { const p = base.convertToViewportPoint(t.transform[4], t.transform[5]); return {s: normQ(t.str), x: p[0], y: p[1], w: (t.width || 0) * Math.hypot(base.transform[0], base.transform[1]), h: Math.hypot(t.transform[2], t.transform[3]) || 6}; }));
  } catch (e) { S.texts[key] = withOcr(key, []); }   // (a PDF not attached in this browser still has its OCR words)
  return S.texts[key];
}
async function findText(q){
  const box = $("findRes"); q = String(q || "").trim();
  if (!q || !P.proj) { box.classList.remove("on"); return; }
  const r0 = $("findIn").getBoundingClientRect(); box.style.left = Math.max(8, Math.min(r0.left, window.innerWidth - 350)) + "px";
  box.innerHTML = '<div class="fr small">Searching…</div>'; box.classList.add("on");
  const ql = q.toLowerCase(), hits = [];
  for (const f of P.proj.files) for (let i = 1; i <= f.pages && hits.length < 300; i++) {
    (await pageTexts(f.id, i)).forEach(t => { if (t.s.toLowerCase().includes(ql) && hits.length < 300) hits.push({f, i, t}); });
  }
  box.innerHTML = hits.length ? `<div class="fr small" style="flex-direction:row;align-items:center;gap:6px;cursor:default">${hits.length}${hits.length >= 300 ? "+" : ""} found <span style="flex:1"></span><button class="btn sm pri" data-cntall="1" title="Put a count marker on every hit">&#10003; Count all</button></div>` + hits.map((h, n) => `<div class="fr" data-hit="${n}" style="flex-direction:row;align-items:center;gap:6px"><span style="flex:1;display:flex;flex-direction:column"><b>${esc(h.t.s.trim().slice(0, 60))}</b><span class="small">${esc(h.f.name.replace(/\.pdf$/i, ""))} p.${h.i}</span></span><button class="btn sm" data-cnt1="${n}" title="Count this one">+1</button></div>`).join("")
    : '<div class="fr small">Not found in the text of these PDFs. A scanned drawing has no text until it is read: <b>Pages → tick → OCR</b>, or Ctrl+K → OCR.</div>';
  box.onclick = async e => {
    const ca = e.target.closest("[data-cntall],[data-cnt1]");
    if (ca) { e.stopPropagation(); return countTextHits(q, ca.dataset.cntall ? hits : [hits[+ca.dataset.cnt1]]); }
    const r = e.target.closest("[data-hit]"); if (!r) return; const h = hits[+r.dataset.hit];
    if (h.f.id !== S.fileId || h.i !== S.pageNo) await gotoPage(h.f.id, h.i);
    const s2 = Math.max(S.view.s, 2.5), st = stage(); S.view = {s: s2, tx: st.clientWidth / 2 - h.t.x * s2, ty: st.clientHeight / 2 - h.t.y * s2}; applyView(); renderHi();
    S.flash = {key: S.key, p: [h.t.x, h.t.y], until: Date.now() + 2500}; draw(); setTimeout(draw, 2600); };
}

async function countTextHits(q, hits){   // text found on the drawings -> count markers (one count condition, per page)
  const ex = P.proj.conds.filter(x => x.type === "count");
  const v = await ask("Count “" + q + "”", `<p>${hits.length} marker${hits.length > 1 ? "s go" : " goes"} on the found text, page by page.</p>
    <div class="grid" style="margin-top:8px"><div class="fg w2"><label>Count into</label><select id="ctC"><option value="">+ New count condition “${esc(q.toUpperCase())}”</option>${ex.map(c => `<option value="${esc(c.id)}"${c.name.trim().toUpperCase() === q.trim().toUpperCase() ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <div class="fg"><label>Symbol (new condition)</label><select id="ctS">${Object.entries(SYMS).map(([k2, v2]) => `<option value="${k2}"${k2 === "check" ? " selected" : ""}>${v2}</option>`).join("")}</select></div>
    <div class="fg"><label>Caption (new condition)</label><select id="ctP"><option value="seq">Number</option><option value="name">Name</option><option value="none">None</option></select></div></div>`, "Count",
    () => ({c: $("ctC").value, sym: $("ctS").value, cap: $("ctP").value}));
  if (!v) return;
  let added = 0;
  mutate(() => {
    let c = v.c ? cond(v.c) : P.proj.conds.find(x => x.type === "count" && x.name.trim().toUpperCase() === q.trim().toUpperCase()) || null;   // (a new "D2" count, never the last one used; an existing "D2" is added to)
    if (!c) { c = {id: uid("C"), name: q.toUpperCase(), type: "count", unit: "Nos", color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0, sym: v.sym, cap: v.cap}; P.proj.conds.push(c); }
    hits.forEach(h => { let it = P.proj.items.find(i => i.cond === c.id && i.file === h.f.id && i.page === h.i && i.kind === "shape");
      if (!it) { it = {id: uid("I"), cond: c.id, file: h.f.id, page: h.i, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
      const p = [h.t.x, h.t.y - 4]; if (!it.pts.some(o => dist(o, p) < 2)) { it.pts.push(p); added++; } });
    S.cond = c.id;
  });
  $("findRes").classList.remove("on");
  toast(added + " counted" + (added < hits.length ? " (" + (hits.length - added) + " already had a marker)" : ""), 4000);
}

/* ------------------------------------------------------------------ markups: notes, clouds, arrows, highlights (no quantity) */
const MARK_TOOLS = {note: "Note", cloud: "Cloud", arrow: "Arrow", dimension: "Dimension", hilite: "Highlight", fence: "Fence (auto-area wall)",
  text: "Text box", callout: "Callout", line: "Line", polyline: "Polyline", polygon: "Polygon", box: "Rectangle", ellipse: "Ellipse", pen: "Pen", stamp: "Stamp", image: "Image", link: "Hyperlink", attach: "File attachment", redact: "Redaction"};
function cloudPath(a, b, r){   // scalloped rectangle between screen points a and b
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const side = (p, q) => { const L = dist(p, q), n = Math.max(1, Math.round(L / (2 * r))), out = []; for (let i = 1; i <= n; i++) { const t = i / n; out.push(`A ${(L / n / 2).toFixed(1)} ${(L / n / 2).toFixed(1)} 0 0 1 ${(p[0] + (q[0] - p[0]) * t).toFixed(1)} ${(p[1] + (q[1] - p[1]) * t).toFixed(1)}`); } return out.join(" "); };
  return `M ${x0} ${y0} ` + side([x0, y0], [x1, y0]) + " " + side([x1, y0], [x1, y1]) + " " + side([x1, y1], [x0, y1]) + " " + side([x0, y1], [x0, y0]) + " Z";
}
function markSvg(m, T, z){   // T: base -> screen; z: px per screen unit (1 on screen)
  const sel = m.id === S.selMark || S.multi.has(m.id);
  if (sel && m.locked && z === 1) { const q = T(m.pts[0]); return markSvg0(m, T, z) + lockBadge([q[0] - 10, q[1] - 14]); }
  return markSvg0(m, T, z);
}
function markSvg0(m, T, z){
  const col = m.color || "#d03b3b", sel = m.id === S.selMark || S.multi.has(m.id);
  if (m.type === 'legend') return legendSvg(m, T, z);
  if (MK_TYPES.has(m.type)) return mkSvg(m, T, z, sel);
  if (m.type === "fence") { const d = m.pts.map(p => T(p).map(v => v.toFixed(1)).join(",")).join(" ");
    return `<polyline points="${d}" fill="none" stroke="#ff7a00" stroke-width="${(sel ? 4 : 3) * z}" stroke-dasharray="${6 * z} ${3 * z}" stroke-linecap="round"/>`; }
  if (m.type === "dimension") {
    const p = m.pts[0], q = m.pts[1], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const off = (+m.offset || 24), a = T([p[0] + nx * off, p[1] + ny * off]), b = T([q[0] + nx * off, q[1] + ny * off]), e1 = T(p), e2 = T(q), w = Math.max(1, +m.width || 2) * z, fs = Math.max(8, +m.size || 13) * z, al = Math.max(5, +m.arrow || 10) * z;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), arrow = (x, y, sign) => { const h1 = [x - sign * al * Math.cos(ang - .45), y - sign * al * Math.sin(ang - .45)], h2 = [x - sign * al * Math.cos(ang + .45), y - sign * al * Math.sin(ang + .45)]; return `<path d="M${h1[0]} ${h1[1]}L${x} ${y}L${h2[0]} ${h2[1]}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; };
    const k = scaleAt(m.file, m.page, p), val = m.text || (k ? f3(dist(p, q) / k) : f3(dist(p, q)) + " pt"), mx = (a[0] + b[0]) / 2 - Math.sin(ang) * (fs * .65), my = (a[1] + b[1]) / 2 + Math.cos(ang) * (fs * .65);
    return `<g><line x1="${e1[0]}" y1="${e1[1]}" x2="${a[0]}" y2="${a[1]}" stroke="${col}" stroke-width="${w}"/><line x1="${e2[0]}" y1="${e2[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${w}"/><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${w}"/>${arrow(a[0], a[1], -1)}${arrow(b[0], b[1], 1)}<text x="${mx}" y="${my}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${col}" stroke="#fff" stroke-width="${Math.max(2, fs * .22)}" paint-order="stroke">${esc(val)}</text></g>`;
  }
  if (m.type === "hilite") { const a = T(m.pts[0]), b = T(m.pts[1]); return `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="${m.color || "#ffe14d"}" fill-opacity="${Math.max(0.05, Math.min(1, +m.opacity || .38))}" stroke="${sel ? "#0b0b0b" : "none"}"/>`; }
  if (m.type === "cloud") { const a = T(m.pts[0]), b = T(m.pts[1]); return `<path d="${cloudPath(a, b, 9 * z)}" fill="none" stroke="${col}" stroke-width="${(sel ? 3 : Math.max(1, +m.width || 2)) * z}"/>` + (m.text ? label([Math.max(a[0], b[0]), Math.min(a[1], b[1]) - 12 * z], m.text, col) : ""); }
  if (m.type === "arrow") { const a = T(m.pts[0]), b = T(m.pts[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = 12 * z;
    const h1 = [b[0] - hl * Math.cos(ang - 0.4), b[1] - hl * Math.sin(ang - 0.4)], h2 = [b[0] - hl * Math.cos(ang + 0.4), b[1] - hl * Math.sin(ang + 0.4)];
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${(sel ? 3 : Math.max(1, +m.width || 2)) * z}"/><path d="M${h1[0]} ${h1[1]}L${b[0]} ${b[1]}L${h2[0]} ${h2[1]}" fill="none" stroke="${col}" stroke-width="${(sel ? 3 : Math.max(1, +m.width || 2)) * z}"/>` + (m.text ? label([a[0], a[1] - 12 * z], m.text, col) : ""); }
  const q = T(m.pts[0]), t = m.text || "Note", w = Math.min(320, t.length * 6.6 + 14) * z;
  return `<g><rect x="${q[0]}" y="${q[1] - 11 * z}" width="${w}" height="${22 * z}" rx="${3 * z}" fill="#fffbe0" stroke="${sel ? "#0b0b0b" : col}" stroke-width="${1.5 * z}"/><text x="${q[0] + 7 * z}" y="${q[1] + 4 * z}" font-size="${12 * z}" font-weight="600" fill="#5b3b00">${esc(t.length > 48 ? t.slice(0, 47) + "…" : t)}</text></g>`;
}
function markAt(sp, only){   // the markup under a screen point (only: test just that one)
  return (only ? [only] : pageMarks().slice().reverse()).find(m => {
    if (MK_TYPES.has(m.type) || m.type === "legend") return mkHit(m, sp);
    const a = toScr(m.pts[0]), b = m.pts[1] ? toScr(m.pts[1]) : null;
    if (m.type === "note") return sp[0] >= a[0] - 4 && sp[0] <= a[0] + Math.min(320, (m.text || "Note").length * 6.6 + 14) && Math.abs(sp[1] - a[1]) <= 12;
    if (m.type === "arrow" || m.type === "dimension") return distSeg(sp, a, b) <= HIT_PX + (+m.width || 0) + 4;
    if (m.type === "fence") { for (let i = 1; i < m.pts.length; i++) if (distSeg(sp, toScr(m.pts[i - 1]), toScr(m.pts[i])) <= HIT_PX) return true; return false; }
    const inR = sp[0] >= Math.min(a[0], b[0]) - 4 && sp[0] <= Math.max(a[0], b[0]) + 4 && sp[1] >= Math.min(a[1], b[1]) - 4 && sp[1] <= Math.max(a[1], b[1]) + 4;
    return m.type === "hilite" ? inR : inR && (Math.abs(sp[0] - a[0]) < 10 || Math.abs(sp[0] - b[0]) < 10 || Math.abs(sp[1] - a[1]) < 10 || Math.abs(sp[1] - b[1]) < 10);
  }) || null;
}
async function addMark(type, pts){
  let text = "";
  if (type === "dimension") {
    const d = toolDefaults();
    const v = await ask("Dimension", `<div class="grid"><div class="fg"><label>Colour</label><input type="color" id="dimCol" value="${d.dimColor}"></div><div class="fg"><label>Line width (px)</label><input type="number" id="dimW" min="1" max="12" step="1" value="${d.dimWidth}"></div><div class="fg"><label>Text size (px)</label><input type="number" id="dimS" min="8" max="48" step="1" value="${d.dimSize}"></div><div class="fg"><label>Arrow size (px)</label><input type="number" id="dimA" min="5" max="40" step="1" value="${d.dimArrow}"></div><div class="fg"><label>Offset from measured line (pt)</label><input type="number" id="dimO" min="0" max="500" step="1" value="${d.dimOffset}"></div><div class="fg w2"><label>Label override (optional)</label><input type="text" id="dimT" placeholder="Leave blank for measured length"></div></div><p class="small">The default label uses the page scale. Increase text, line and arrow size for printed drawings.</p>`, "Add", () => ({color: $("dimCol").value, width: Math.max(1, Math.min(12, +$("dimW").value || 2)), size: Math.max(8, Math.min(48, +$("dimS").value || 13)), arrow: Math.max(5, Math.min(40, +$("dimA").value || 10)), offset: Math.max(0, Math.min(500, +$("dimO").value || 24)), t: $("dimT").value.trim()}));
    if (!v) { draw(); return; }
    const m = {id: uid("M"), type, file: S.fileId, page: S.pageNo, pts, text: v.t, color: v.color, width: v.width, size: v.size, arrow: v.arrow, offset: v.offset, at: new Date().toISOString()};
    mutate(() => { (P.proj.marks = P.proj.marks || []).push(m); });
    return;
  }
  if (type === "note" || type === "cloud" || type === "arrow") {
    const v = await ask(MARK_TOOLS[type], `<div class="fg w2"><label>${type === "note" ? "Note" : "Comment (optional)"}</label><input type="text" id="mkT" placeholder="${type === "cloud" ? "e.g. Revised — check with Rev 07" : "e.g. Confirm slab thickness with structure"}"></div>`, "Add", () => { const t = $("mkT").value.trim(); return type === "note" && !t ? "Write the note" : {t}; }, "mkT");
    if (!v) { draw(); return; } text = v.t;
  }
  const d = toolDefaults();
  const m = {id: uid("M"), type, file: S.fileId, page: S.pageNo, pts, text, color: type === "hilite" ? d.hiliteColor : d.markColor, width: d.markWidth, opacity: type === "hilite" ? d.hiliteOpacity : undefined, at: new Date().toISOString()};
  mutate(() => { (P.proj.marks = P.proj.marks || []).push(m); });
}

/* ------------------------------------------------------------------ markup tools (Bluebeam Revu Basics)
   Text box, callout, line, polyline, polygon, rectangle, ellipse, pen and highlighter pen, stamps (with your name and the
   date), images, hyperlinks, file attachments, redaction and erase — each with Bluebeam's properties: subject, author,
   status, colour, fill, opacity, line style, arrow ends, font and hatch pattern. What sits on the drawing (text, boxes, hatch
   spacing, the highlighter's width) is in page units, so it prints at the size it was drawn; line weights are screen widths,
   as for the other markups. Pictures and files are kept in this browser beside the PDFs, not in the project record, so undo
   and saving stay light; Project + PDFs carries them. */
const MK_TYPES = new Set(["text", "callout", "line", "polyline", "polygon", "box", "ellipse", "pen", "stamp", "image", "link", "attach", "redact"]);
const MK_TOOL_NAMES = {mk_text: "Text box", mk_callout: "Callout", mk_line: "Line", mk_polyline: "Polyline", mk_polygon: "Polygon", mk_box: "Rectangle", mk_ellipse: "Ellipse",
  mk_pen: "Pen", mk_hpen: "Highlighter pen", mk_stamp: "Stamp", mk_image: "Image", mk_link: "Hyperlink", mk_attach: "File attachment", mk_redact: "Redaction", mk_erase: "Erase (white-out)"};
const MK_MINPTS = {note: 1, attach: 1, polygon: 3, callout: 3};
const MK_BOXY = new Set(["text", "box", "ellipse", "stamp", "image", "link", "redact", "hilite", "cloud", "legend"]);   // drawn between two opposite corners
const MK_PLACE = new Set(["text", "stamp", "image", "attach"]);   // a click places it (a drag sizes it)
const mkKindOf = m => m.type === "pen" && m.hl ? "hpen" : m.type === "redact" && m.erase ? "erase" : m.type;
const mkTypeOf = kind => kind === "hpen" ? "pen" : kind === "erase" ? "redact" : kind;
const mkIsTool = t => typeof t === "string" && t.startsWith("mk_");
const MK_DASH = {solid: "Solid", dash: "Dashed", dot: "Dotted", dashdot: "Dash-dot"};
const MK_ENDS = {none: "None", arrow: "Arrow", open: "Open arrow", dot: "Dot", square: "Square", slash: "Slash (tick)"};
const MK_FONT = {sans: "Segoe UI, Arial, Helvetica, sans-serif", serif: "Georgia, Times New Roman, serif", mono: "Consolas, Courier New, monospace"};
const MK_STATUSES = ["", "Accepted", "Rejected", "Cancelled", "Completed", "Reviewed", "For information"];
const mkStatusList = () => MK_STATUSES.concat((P.proj && P.proj.mkStatuses || []).filter(s => typeof s === "string" && s && MK_STATUSES.indexOf(s) < 0));
const HATCHES = {diag: "Diagonal /", diag2: "Diagonal \\", cross: "Cross-hatch ✕", horiz: "Horizontal", vert: "Vertical", grid: "Grid", dots: "Dots", brick: "Brick", concrete: "Concrete", earth: "Earth", zigzag: "Insulation (zigzag)", custom: "Custom…"};

/* each tool's style: the last one set as default (right-click → Set as default, or the Tool Chest), else these */
const MK_STYLE_KEY = "zdTakeoffMarkStyles";
const MK_STYLE0 = {
  text: {color: "#d03b3b", width: 1, fill: "#ffffff", fillOp: 0.9, fs: 10, font: "sans", bold: false, align: "left", op: 1},
  callout: {color: "#d03b3b", width: 1.5, fill: "#ffffff", fillOp: 0.9, fs: 10, font: "sans", bold: false, align: "left", a0: "arrow", op: 1},
  line: {color: "#d03b3b", width: 2, dash: "solid", a0: "none", a1: "none", op: 1},
  polyline: {color: "#d03b3b", width: 2, dash: "solid", a0: "none", a1: "none", op: 1},
  polygon: {color: "#d03b3b", width: 2, dash: "solid", fill: "#d03b3b", fillOp: 0.12, hatch: null, op: 1},
  box: {color: "#d03b3b", width: 2, dash: "solid", fill: "", fillOp: 0.15, hatch: null, op: 1},
  ellipse: {color: "#d03b3b", width: 2, dash: "solid", fill: "", fillOp: 0.15, hatch: null, op: 1},
  pen: {color: "#d03b3b", width: 2, op: 1},
  hpen: {color: "#ffd400", width: 9, op: 0.4},
  stamp: {color: "#1e8e5a", op: 0.92},
  image: {color: "#0b0b0b", width: 0, op: 1},
  link: {color: "#2a78d6"},
  attach: {color: "#2a78d6"},
  redact: {fill: "#000000"},
  erase: {fill: "#ffffff"}
};
const MK_STYLE_KEYS = ["color", "width", "fill", "fillOp", "fs", "font", "bold", "align", "dash", "a0", "a1", "hatch", "op"];
function mkClean(o){   // a markup's style fields, checked (a project or Tool Chest file can come from anywhere)
  const r = {}, col = v => typeof v === "string" && HEXCOL.test(v), n = (v, lo, hi) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; };
  o = o && typeof o === "object" ? o : {};
  if (col(o.color)) r.color = o.color;
  if (o.fill === "" || col(o.fill)) r.fill = o.fill;
  [["width", 0, 40], ["fillOp", 0, 1], ["op", 0.05, 1], ["fs", 1, 500]].forEach(([k, lo, hi]) => { if (o[k] != null && n(o[k], lo, hi) != null) r[k] = n(o[k], lo, hi); });
  if (MK_FONT[o.font]) r.font = o.font;
  if (o.bold != null) r.bold = !!o.bold;
  if (["left", "center", "right"].indexOf(o.align) >= 0) r.align = o.align;
  if (MK_DASH[o.dash]) r.dash = o.dash;
  ["a0", "a1"].forEach(k => { if (MK_ENDS[o[k]]) r[k] = o[k]; });
  if (o.hatch === null) r.hatch = null;
  else if (o.hatch && typeof o.hatch === "object" && HATCHES[o.hatch.p]) { const h = o.hatch; r.hatch = {p: h.p, sp: n(h.sp, 0.5, 500) || 6, lw: n(h.lw, 0.2, 12) || 0.8}; if (h.p === "custom") { r.hatch.ang = n(h.ang, -360, 360) || 0; r.hatch.x = !!h.x; } if (col(h.col)) r.hatch.col = h.col; }
  return r;
}
function mkStyle(kind){ let o = null; try { o = JSON.parse(pref(MK_STYLE_KEY) || "null"); } catch (e) { o = null; } return Object.assign({}, MK_STYLE0[kind] || {}, mkClean(o && o[kind])); }
function mkStyleOf(m){ return mkClean(m); }
function saveMkStyle(kind, st){ let o = {}; try { o = JSON.parse(pref(MK_STYLE_KEY) || "{}") || {}; } catch (e) { o = {}; } o[kind] = mkClean(st); pref(MK_STYLE_KEY, JSON.stringify(o)); }
const safeUrl = u => { u = String(u == null ? "" : u).trim(); return /^(https?:\/\/|mailto:)[^\s<>"'`]+$/i.test(u) ? u : ""; };
function mkSanitize(m){   // a markup read from a project: its fields checked, so nothing in a file can break the drawing or reach a script
  const st = mkClean(m); MK_STYLE_KEYS.forEach(k => { delete m[k]; }); Object.assign(m, st);
  if (!m.color) m.color = (MK_STYLE0[mkKindOf(m)] || {}).color || "#d03b3b";
  ["subject", "author", "status"].forEach(k => { if (m[k] != null) m[k] = String(m[k]).slice(0, 200); });
  m.text = String(m.text == null ? "" : m.text).slice(0, 20000);
  if (m.type === "stamp") { const s = m.stamp && typeof m.stamp === "object" ? m.stamp : {}; m.stamp = {label: String(s.label || m.text || "STAMP").slice(0, 80), sub: String(s.sub || "").slice(0, 200)}; if (typeof s.aid === "string") m.stamp.aid = s.aid.slice(0, 40); }
  if (m.type === "image") { const i = m.img && typeof m.img === "object" ? m.img : {}; m.img = {aid: String(i.aid || "").slice(0, 40), w: Math.max(0, +i.w || 0), h: Math.max(0, +i.h || 0), name: String(i.name || "").slice(0, 200)}; }
  if (m.type === "attach") { const a = m.att && typeof m.att === "object" ? m.att : {}; m.att = {aid: String(a.aid || "").slice(0, 40), name: String(a.name || "file").slice(0, 200), size: Math.max(0, +a.size || 0), type: String(a.type || "").slice(0, 100)}; }
  if (m.type === "link") { const l = m.link && typeof m.link === "object" ? m.link : {}; m.link = safeUrl(l.url) ? {url: safeUrl(l.url)} : typeof l.key === "string" && /^[^:]+:\d+$/.test(l.key) ? {key: l.key} : {}; m.show = !!m.show; }
  if (m.type === "pen") m.hl = !!m.hl;
  if (m.type === "redact") m.erase = !!m.erase;
  if (m.replies != null) m.replies = Array.isArray(m.replies) ? m.replies.filter(r => r && typeof r === "object" && typeof r.text === "string").slice(0, 500).map(r => ({id: String(r.id || uid("R")).slice(0, 40), author: String(r.author || "").slice(0, 100), at: String(r.at || "").slice(0, 40), text: r.text.slice(0, 5000)})) : [];
}

/* pictures and files of markups: in this browser's PDF store under "asset:<id>" (never listed, so nothing else reads them) */
const ASSET_URL = new Map(), ASSET_WAIT = new Map();
const assetKey = aid => "asset:" + aid;
async function assetPut(blob, name){ const aid = uid("A"); await dbPut("pdfs", {asset: true, name: String(name || ""), type: blob.type || "application/octet-stream", size: blob.size, data: await blob.arrayBuffer(), at: new Date().toISOString()}, assetKey(aid)); return aid; }
const assetRec = aid => aid ? dbGet("pdfs", assetKey(aid)) : Promise.resolve(null);
const dataUrlOf = blob => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(r.error); r.readAsDataURL(blob); });
const IMG_TYPES = /^image\/(png|jpeg|gif|webp|bmp)$/i;
function assetLoad(aid){   // -> a picture's data URL (or null), read once a session
  if (!aid) return Promise.resolve(null);
  if (ASSET_URL.has(aid)) return Promise.resolve(ASSET_URL.get(aid));
  if (!ASSET_WAIT.has(aid)) ASSET_WAIT.set(aid, assetRec(aid).then(r => r && IMG_TYPES.test(r.type) ? dataUrlOf(new Blob([r.data], {type: r.type})) : null).catch(() => null)
    .then(u => { ASSET_URL.set(aid, u); ASSET_WAIT.delete(aid); return u; }));
  return ASSET_WAIT.get(aid);
}
function assetNow(aid){ if (!aid) return null; if (ASSET_URL.has(aid)) return ASSET_URL.get(aid); assetLoad(aid).then(() => { S.ovSig = null; draw(); }); return null; }   // drawn once it has loaded
const mkAids = m => [m.img && m.img.aid, m.stamp && m.stamp.aid, m.att && m.att.aid].concat((m.photos || []).map(x => x && x.aid)).filter(Boolean);
async function mkAssetsFor(file, page){ if (P.proj) await Promise.all((P.proj.marks || []).filter(m => m.file === file && m.page === page).flatMap(mkAids).map(assetLoad)); }
function pickFiles(accept, multi){
  return new Promise(ok => { const i = document.createElement("input"); i.type = "file"; if (accept) i.accept = accept; i.multiple = !!multi;
    let done = false; const fin = L => { if (done) return; done = true; ok(L); }; i.onchange = () => fin([...i.files]); i.addEventListener("cancel", () => fin([])); i.click(); });
}
async function imageAsset(file){   // a picture for a markup, kept at most 2000 px across -> {aid, w, h, name}
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw new Error(file.name + " is not a picture this browser can read (PNG, JPEG, GIF, WebP or BMP)"); }
  const sc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), W = Math.max(1, Math.round(bmp.width * sc)), H = Math.max(1, Math.round(bmp.height * sc));
  let blob = file;
  if (sc < 1 || file.size > 1.5e6 || !/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) {
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"), alpha = /png|gif|webp/i.test(file.type);
    if (!alpha) { x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); } x.drawImage(bmp, 0, 0, W, H);
    blob = await new Promise(r => c.toBlob(r, alpha ? "image/png" : "image/jpeg", 0.88));
    if (alpha && blob && blob.size > 2.5e6) { x.globalCompositeOperation = "destination-over"; x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88)); }
    c.width = 0;
  }
  if (bmp.close) bmp.close();
  if (!blob) throw new Error("the picture could not be stored");
  const aid = await assetPut(blob, file.name); ASSET_URL.delete(aid); return {aid, w: W, h: H, name: file.name};
}
async function attachAsset(file){ if (file.size > 60e6) throw new Error(file.name + " is larger than 60 MB — attach a smaller file"); return {aid: await assetPut(file, file.name), name: file.name, size: file.size, type: file.type || "application/octet-stream"}; }
async function openAsset(aid, name, save){   // a file of a markup: opened (pictures, PDF, plain text) or saved; never run in this page
  const r = await assetRec(aid); if (!r) return toast("That file is not in this browser — the project came without it (use Export → Project + PDFs to move files)", 6000);
  const blob = new Blob([r.data], {type: r.type}), view = !save && (IMG_TYPES.test(r.type) || r.type === "application/pdf" || r.type === "text/plain");
  if (!view) return saveBlob(blob, name || r.name || "file");
  const u = URL.createObjectURL(blob), w = window.open(u, "_blank", "noopener"); if (!w) saveBlob(blob, name || r.name || "file"); setTimeout(() => URL.revokeObjectURL(u), 120000);
}

/* text in boxes: measured in page units, wrapped to the box */
let MK_CTX = null; const MK_WRAP = new Map(), MK_LH = 1.22, mkPad = fs => fs * 0.35;
function mkMeasure(t, fs, font, bold){ if (!MK_CTX) MK_CTX = document.createElement("canvas").getContext("2d"); MK_CTX.font = (bold ? "700 " : "400 ") + fs + "px " + (MK_FONT[font] || MK_FONT.sans); return MK_CTX.measureText(t).width; }
function mkWrap(text, fs, font, bold, maxW){   // the lines of a text in a box maxW wide (page units); a word longer than a line is cut
  const key = [text, fs, font, bold ? 1 : 0, Math.round(maxW * 10)].join("\u0001"), hit = MK_WRAP.get(key); if (hit) return hit;
  const W = t => mkMeasure(t, fs, font, bold), out = [];
  const cut = w => { while (w.length > 1 && W(w) > maxW) { let n = w.length - 1; while (n > 1 && W(w.slice(0, n)) > maxW) n--; out.push(w.slice(0, n)); w = w.slice(n); } return w; };
  String(text == null ? "" : text).split(/\r?\n/).forEach(par => { let line = "";
    par.split(/ +/).forEach(w => { const t = line ? line + " " + w : w; if (maxW <= 0 || W(t) <= maxW) { line = t; return; } if (line) out.push(line); line = cut(w); });
    out.push(line); });
  if (MK_WRAP.size > 600) MK_WRAP.clear(); MK_WRAP.set(key, out); return out;
}
function mkTextWidth(m){ const fs = +m.fs || 10; return Math.max(...String(m.text || " ").split(/\r?\n/).map(l => mkMeasure(l || " ", fs, m.font, m.bold))) + 2 * mkPad(fs) + 1; }
function mkTextHeight(m, w){ const fs = +m.fs || 10; return mkWrap(m.text || "", fs, m.font, m.bold, w - 2 * mkPad(fs)).length * fs * MK_LH + 2 * mkPad(fs); }
function mkFit(m, keepW){   // a text box / callout fitted to its text: as wide as its longest line (at most 40 em) unless keepW, as tall as its lines
  const bi = m.type === "callout" ? 1 : 0, a = m.pts[bi], b = m.pts[bi + 1], fs = +m.fs || 10, x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  let w = Math.abs(b[0] - a[0]); if (!keepW || w < 2 * fs) w = Math.min(mkTextWidth(m), 40 * fs);
  m.pts[bi] = [x0, y0]; m.pts[bi + 1] = [x0 + w, y0 + mkTextHeight(m, w)];
}

/* drawing a markup (screen and exports): T page -> px, z the screen-width factor (1 on screen) */
let mkPatSeq = 0;
const f1 = p => p[0].toFixed(1) + " " + p[1].toFixed(1);
const mkBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const mkCorners = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
const mkTwo = (a, b) => { const r = mkBox(a, b); return [[r[0], r[1]], [r[2], r[3]]]; };   // top-left, bottom-right
function hatchDef(id, h, col, k, z){   // a fill pattern in page units (h.sp pt apart; never closer than 4 px on screen)
  const s = +Math.max(4, (+h.sp || 6) * k).toFixed(2), lw = Math.max(0.5, (+h.lw || 0.8) * z).toFixed(2), st = `stroke="${col}" stroke-width="${lw}" fill="none" stroke-linecap="square"`;
  const ang = h.p === "custom" ? +h.ang || 0 : {diag: -45, diag2: 45, cross: 45, horiz: 0, vert: 90}[h.p] || 0;
  let w = s, body;
  switch (h.p) {
    case "cross": case "grid": body = `<path d="M0 ${s / 2}H${s}M${s / 2} 0V${s}" ${st}/>`; break;
    case "dots": body = `<circle cx="${s / 2}" cy="${s / 2}" r="${Math.max(0.6, +lw * 0.9).toFixed(2)}" fill="${col}"/>`; break;
    case "brick": w = 2 * s; body = `<path d="M0 0.5H${w}M0 ${s / 2}H${w}M${s / 2} 0V${s / 2}M${s * 1.5} ${s / 2}V${s}" ${st}/>`; break;
    case "concrete": body = `<circle cx="${(s * .22).toFixed(2)}" cy="${(s * .28).toFixed(2)}" r="${(s * .07).toFixed(2)}" fill="${col}"/><circle cx="${(s * .8).toFixed(2)}" cy="${(s * .2).toFixed(2)}" r="${(s * .045).toFixed(2)}" fill="${col}"/><path d="M${(s * .5).toFixed(2)} ${(s * .82).toFixed(2)}l${(s * .17).toFixed(2)} ${(-s * .28).toFixed(2)}l${(s * .17).toFixed(2)} ${(s * .28).toFixed(2)}z" ${st}/>`; break;
    case "earth": body = `<path d="M0 ${s}L${s} 0M${(s * .1).toFixed(2)} ${(s * .55).toFixed(2)}H${(s * .42).toFixed(2)}" ${st}/>`; break;
    case "zigzag": body = `<path d="M0 ${s / 2}L${s / 4} 0L${s * .75} ${s}L${s} ${s / 2}" ${st}/>`; break;
    default: body = `<path d="M0 ${s / 2}H${s}${h.x ? `M${s / 2} 0V${s}` : ""}" ${st}/>`;   // lines: diagonal, horizontal, vertical, custom
  }
  return `<pattern id="${id}" width="${w}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})">${body}</pattern>`;
}
function mkDash(d, w){ w = Math.max(1, w); return d === "dash" ? `${(5 * w).toFixed(1)} ${(3 * w).toFixed(1)}` : d === "dot" ? `0.1 ${(2.6 * w).toFixed(1)}` : d === "dashdot" ? `${(7 * w).toFixed(1)} ${(2.6 * w).toFixed(1)} 0.1 ${(2.6 * w).toFixed(1)}` : ""; }
function mkEnd(kind, tip, from, w, col){   // an arrow head, dot, square or slash at tip, facing away from `from` (px)
  if (!kind || kind === "none" || !from || dist(tip, from) < 0.01) return "";
  const L = Math.max(8, 4.5 * w), ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]), c = Math.cos(ang), s = Math.sin(ang);
  const pt = (al, sd) => (tip[0] - c * al - s * sd).toFixed(1) + " " + (tip[1] - s * al + c * sd).toFixed(1);
  if (kind === "arrow") return `<path d="M${pt(L, L * .42)}L${pt(0, 0)}L${pt(L, -L * .42)}Z" fill="${col}" stroke="${col}" stroke-width="${(w * .5).toFixed(2)}" stroke-linejoin="round"/>`;
  if (kind === "open") return `<path d="M${pt(L, L * .45)}L${pt(0, 0)}L${pt(L, -L * .45)}" fill="none" stroke="${col}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (kind === "dot") return `<circle cx="${tip[0].toFixed(1)}" cy="${tip[1].toFixed(1)}" r="${(L * .3).toFixed(1)}" fill="${col}"/>`;
  if (kind === "square") { const r = L * .28; return `<rect x="${(tip[0] - r).toFixed(1)}" y="${(tip[1] - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" fill="${col}" transform="rotate(${(ang * 180 / Math.PI).toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)})"/>`; }
  if (kind === "slash") { const r = L * .55, a2 = ang + Math.PI / 4; return `<path d="M${(tip[0] - Math.cos(a2) * r).toFixed(1)} ${(tip[1] - Math.sin(a2) * r).toFixed(1)}L${(tip[0] + Math.cos(a2) * r).toFixed(1)} ${(tip[1] + Math.sin(a2) * r).toFixed(1)}" stroke="${col}" stroke-width="${(w * 1.4).toFixed(2)}" stroke-linecap="round"/>`; }
  return "";
}
function mkSmooth(P){ if (P.length < 3) return "M" + P.map(f1).join("L"); let d = "M" + f1(P[0]); for (let i = 1; i < P.length - 1; i++) d += "Q" + f1(P[i]) + " " + f1([(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2]); return d + "L" + f1(P[P.length - 1]); }
function mkTextSvg(m, r, k, col){   // the lines of a text box inside the screen box r, the font in page units
  const fs = +m.fs || 10, pad = mkPad(fs), fpx = fs * k; if (fpx < 1.5) return "";
  const L = mkWrap(m.text || "", fs, m.font, m.bold, (r[2] - r[0]) / k - 2 * pad), al = m.align === "center" ? "middle" : m.align === "right" ? "end" : "start";
  const x = al === "middle" ? (r[0] + r[2]) / 2 : al === "end" ? r[2] - pad * k : r[0] + pad * k, fam = esc(MK_FONT[m.font] || MK_FONT.sans);
  return L.map((l, i) => `<text x="${x.toFixed(1)}" y="${(r[1] + pad * k + (i + 0.8) * fs * MK_LH * k).toFixed(1)}" font-size="${fpx.toFixed(2)}" font-family="${fam}" font-weight="${m.bold ? 700 : 400}" fill="${col}" text-anchor="${al}" xml:space="preserve">${esc(l)}</text>`).join("");
}
function calloutKnee(r, tip, z, k, fs){ const left = tip[0] < (r[0] + r[2]) / 2, side = left ? r[0] : r[2], kl = Math.min(28 * z, Math.max(8 * z, fs * k)), cy = (r[1] + r[3]) / 2; return {knee: [side + (left ? -kl : kl), cy], foot: [side, cy]}; }
function mkSvg(m, T, z, sel){
  const k = Math.abs(T([1, 0])[0] - T([0, 0])[0]) || 1, ex = !!S.mkExport, col = m.color || "#d03b3b", op = m.op == null ? 1 : Math.max(0.05, Math.min(1, +m.op));
  const w = Math.max(0, m.width == null ? 2 : +m.width) * z, P = m.pts.map(T), dash = mkDash(m.dash, w);
  const strokeA = w > 0 ? `stroke="${col}" stroke-width="${w.toFixed(2)}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round" stroke-linejoin="round"` : `stroke="none"`;
  const fillA = m.fill ? `fill="${m.fill}" fill-opacity="${m.fillOp == null ? 0.15 : Math.max(0, Math.min(1, +m.fillOp))}"` : `fill="none"`;
  const pid = m.hatch && m.hatch.p ? "mkp" + (++mkPatSeq) : "", defs = pid ? `<defs>${hatchDef(pid, m.hatch, m.hatch.col || col, k, z)}</defs>` : "";
  const shape = attrs => `<${attrs} ${fillA} ${strokeA}/>` + (pid ? `<${attrs} fill="url(#${pid})" stroke="none"/>` : "");
  const rectA = r => `rect x="${r[0].toFixed(1)}" y="${r[1].toFixed(1)}" width="${Math.max(0, r[2] - r[0]).toFixed(1)}" height="${Math.max(0, r[3] - r[1]).toFixed(1)}"`;
  const selBox = r => sel && !ex ? `<rect x="${(r[0] - 3).toFixed(1)}" y="${(r[1] - 3).toFixed(1)}" width="${(r[2] - r[0] + 6).toFixed(1)}" height="${(r[3] - r[1] + 6).toFixed(1)}" fill="none" stroke="#4b3b8f" stroke-width="1" stroke-dasharray="4 3"/>` : "";
  const glow = d => sel && !ex ? `<path d="${d}" fill="none" stroke="#4b3b8f" stroke-width="${(w + 7).toFixed(1)}" stroke-opacity=".2" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  let out = "";
  switch (m.type) {
    case "box": { const r = mkBox(P[0], P[1]); out = defs + shape(rectA(r)) + selBox(r); break; }
    case "ellipse": { const r = mkBox(P[0], P[1]); out = defs + shape(`ellipse cx="${((r[0] + r[2]) / 2).toFixed(1)}" cy="${((r[1] + r[3]) / 2).toFixed(1)}" rx="${((r[2] - r[0]) / 2).toFixed(1)}" ry="${((r[3] - r[1]) / 2).toFixed(1)}"`) + selBox(r); break; }
    case "polygon": { const d = "M" + P.map(f1).join("L") + "Z"; out = glow(d) + defs + shape(`path d="${d}"`); break; }
    case "line": case "polyline": {
      const Q = P.map(p => p.slice()), L = Math.max(8, 4.5 * Math.max(1, w)), trim = (i, j, kind) => { if (kind !== "arrow") return; const d = dist(Q[i], Q[j]); if (d > L) Q[i] = [Q[i][0] + (Q[j][0] - Q[i][0]) / d * L * .6, Q[i][1] + (Q[j][1] - Q[i][1]) / d * L * .6]; };
      if (Q.length < 2) break; trim(0, 1, m.a0); trim(Q.length - 1, Q.length - 2, m.a1);
      out = glow("M" + P.map(f1).join("L")) + `<path d="M${Q.map(f1).join("L")}" fill="none" ${strokeA}/>` + mkEnd(m.a0, P[0], P[1], Math.max(1, w), col) + mkEnd(m.a1, P[P.length - 1], P[P.length - 2], Math.max(1, w), col); break; }
    case "pen": { const d = mkSmooth(P), pw = m.hl ? Math.max(1, (+m.width || 9) * k) : Math.max(0.5, w); out = glow(d) + `<path d="${d}" fill="none" stroke="${col}" stroke-width="${pw.toFixed(2)}" stroke-linecap="${m.hl ? "square" : "round"}" stroke-linejoin="round"/>`; break; }
    case "text": case "callout": {
      const bi = m.type === "callout" ? 1 : 0, r = mkBox(P[bi], P[bi + 1]);
      if (m.type === "callout") { const {knee, foot} = calloutKnee(r, P[0], z, k, +m.fs || 10), lw = Math.max(1, w || z);
        out += `<path d="M${f1(P[0])}L${f1(knee)}L${f1(foot)}" fill="none" stroke="${col}" stroke-width="${lw.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>` + mkEnd(m.a0 || "arrow", P[0], knee, lw, col); }
      out += defs + shape(rectA(r)) + mkTextSvg(m, r, k, col) + selBox(r); break; }
    case "stamp": {
      const r = mkBox(P[0], P[1]), W = r[2] - r[0], H = r[3] - r[1], st = m.stamp || {};
      if (st.aid) { const u = assetNow(st.aid); out = u ? `<image href="${u}" x="${r[0].toFixed(1)}" y="${r[1].toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>` : `<${rectA(r)} fill="none" stroke="${col}" stroke-dasharray="4 3"/>`; out += selBox(r); break; }
      const main = st.label || m.text || "STAMP", sub = st.sub || "", bw = Math.max(0.6, Math.min(W, H) * 0.045), ins = bw * 2.4;
      const f1s = Math.min(H * (sub ? 0.44 : 0.6), W * 0.86 / Math.max(0.01, mkMeasure(main, 1, "sans", true) * 1.06)), f2s = sub ? Math.min(H * 0.2, W * 0.9 / Math.max(0.01, mkMeasure(sub, 1, "sans", false))) : 0, cx = (r[0] + r[2]) / 2, fam = esc(MK_FONT.sans);
      out = `<${rectA(r)} rx="${(H * .12).toFixed(1)}" fill="${col}" fill-opacity=".05" stroke="${col}" stroke-width="${bw.toFixed(2)}"/><rect x="${(r[0] + ins).toFixed(1)}" y="${(r[1] + ins).toFixed(1)}" width="${Math.max(0, W - 2 * ins).toFixed(1)}" height="${Math.max(0, H - 2 * ins).toFixed(1)}" rx="${(H * .08).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(bw * .45).toFixed(2)}"/>`
        + (f1s * 1 >= 1 ? `<text x="${cx.toFixed(1)}" y="${(sub ? r[1] + H * .54 : r[1] + H / 2 + f1s * .36).toFixed(1)}" font-family="${fam}" font-weight="800" font-size="${f1s.toFixed(2)}" letter-spacing="${(f1s * .04).toFixed(2)}" fill="${col}" text-anchor="middle">${esc(main)}</text>` : "")
        + (sub && f2s >= 1 ? `<text x="${cx.toFixed(1)}" y="${(r[1] + H * .8).toFixed(1)}" font-family="${fam}" font-weight="600" font-size="${f2s.toFixed(2)}" fill="${col}" text-anchor="middle">${esc(sub)}</text>` : "") + selBox(r); break; }
    case "image": { const r = mkBox(P[0], P[1]), u = m.img && assetNow(m.img.aid);
      out = u ? `<image href="${u}" x="${r[0].toFixed(1)}" y="${r[1].toFixed(1)}" width="${(r[2] - r[0]).toFixed(1)}" height="${(r[3] - r[1]).toFixed(1)}" preserveAspectRatio="none"/>`
        : `<${rectA(r)} fill="#eef2f7" stroke="#9fb0c6" stroke-dasharray="4 3"/>` + (ex ? "" : `<text x="${((r[0] + r[2]) / 2).toFixed(1)}" y="${((r[1] + r[3]) / 2).toFixed(1)}" font-size="${11 * z}" text-anchor="middle" fill="#5f6b7a">${m.img && m.img.aid ? "picture…" : "picture missing"}</text>`);
      if (w > 0) out += `<${rectA(r)} fill="none" ${strokeA}/>`; out += selBox(r); break; }
    case "link": { const r = mkBox(P[0], P[1]);
      if (ex) { out = m.show ? `<${rectA(r)} fill="none" stroke="${col}" stroke-width="${z}"/>` : ""; break; }
      out = `<${rectA(r)} fill="${col}" fill-opacity=".07" stroke="${col}" stroke-width="${(1.2 * z).toFixed(1)}" stroke-dasharray="${5 * z} ${3 * z}"/><text x="${(r[2] - 4 * z).toFixed(1)}" y="${(r[1] + 12 * z).toFixed(1)}" font-size="${11 * z}" text-anchor="end" fill="${col}">&#128279;</text>` + selBox(r); break; }
    case "attach": { const q = P[0], s2 = 9 * z, X = x => (q[0] + x * z).toFixed(1), Y = y => (q[1] + y * z).toFixed(1);
      out = `<rect x="${(q[0] - s2).toFixed(1)}" y="${(q[1] - s2).toFixed(1)}" width="${2 * s2}" height="${2 * s2}" rx="${3 * z}" fill="#fff" stroke="${col}" stroke-width="${1.4 * z}"/><path d="M${X(-2.5)} ${Y(4)}V${Y(-3)}A${(2.5 * z).toFixed(1)} ${(2.5 * z).toFixed(1)} 0 0 1 ${X(2.5)} ${Y(-3)}V${Y(4)}A${(1.4 * z).toFixed(1)} ${(1.4 * z).toFixed(1)} 0 0 1 ${X(-0.3)} ${Y(4)}V${Y(-2)}" fill="none" stroke="${col}" stroke-width="${(1.3 * z).toFixed(2)}" stroke-linecap="round"/>`
        + (m.att && m.att.name && !ex ? `<text x="${(q[0] + s2 + 4 * z).toFixed(1)}" y="${(q[1] + 4 * z).toFixed(1)}" font-size="${11 * z}" fill="${col}" stroke="#fff" stroke-width="${3 * z}" paint-order="stroke">${esc(m.att.name.length > 32 ? m.att.name.slice(0, 31) + "…" : m.att.name)}</text>` : "")
        + (sel && !ex ? `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(s2 + 4).toFixed(1)}" fill="none" stroke="#4b3b8f" stroke-dasharray="4 3"/>` : ""); break; }
    case "redact": { const r = mkBox(P[0], P[1]), fill = m.fill || (m.erase ? "#ffffff" : "#000000"), tc = /^#(?:f|e|d|c)/i.test(fill) ? "#0b0b0b" : "#ffffff", cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, fs = Math.min(14 * z, (r[3] - r[1]) * .5);
      const word = m.text ? `<text x="${cx.toFixed(1)}" y="${(cy + fs * .35).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="${esc(MK_FONT.sans)}" font-weight="700" text-anchor="middle" fill="${tc}">${esc(m.text)}</text>` : "";
      if (ex) { out = `<${rectA(r)} fill="${fill}"/>` + word; break; }
      out = `<${rectA(r)} fill="${fill}" fill-opacity="${m.erase ? 0.92 : 0.78}" stroke="#d03b3b" stroke-width="${(1.5 * z).toFixed(1)}" stroke-dasharray="${6 * z} ${3 * z}"/>` + word
        + (m.erase || m.text ? "" : `<text x="${cx.toFixed(1)}" y="${(cy + 4 * z).toFixed(1)}" font-size="${10 * z}" font-weight="700" text-anchor="middle" fill="#ff8a80">REDACT</text>`) + selBox(r); break; }
  }
  return op < 1 && out ? `<g opacity="${op}">${out}</g>` : out;
}

/* hit test and outline (selection by click, box, lasso) */
function mkHit(m, sp){
  const P = m.pts.map(toScr), tol = HIT_PX + Math.max(0, +m.width || 0) / 2 + 2, filled = !!(m.fill || m.hatch);
  const near = (Q, closed, t2) => { for (let i = 1; i < Q.length + (closed ? 1 : 0); i++) if (distSeg(sp, Q[i - 1], Q[i % Q.length]) <= (t2 || tol)) return true; return false; };
  const inR = (r, pad) => sp[0] >= r[0] - pad && sp[0] <= r[2] + pad && sp[1] >= r[1] - pad && sp[1] <= r[3] + pad;
  switch (m.type) {
    case "line": return distSeg(sp, P[0], P[1]) <= tol;
    case "polyline": return near(P, false);
    case "pen": return near(P, false, m.hl ? Math.max(tol, (+m.width || 9) * S.view.s / 2 + 2) : tol);
    case "polygon": return near(P, true) || (filled && pointInPoly(sp, P));
    case "box": { const r = mkBox(P[0], P[1]); return filled ? inR(r, 3) : inR(r, tol) && !inR([r[0] + tol, r[1] + tol, r[2] - tol, r[3] - tol], 0); }
    case "ellipse": { const r = mkBox(P[0], P[1]), rx = Math.max(1, (r[2] - r[0]) / 2), ry = Math.max(1, (r[3] - r[1]) / 2), q = Math.hypot((sp[0] - (r[0] + r[2]) / 2) / rx, (sp[1] - (r[1] + r[3]) / 2) / ry);
      return filled ? q <= 1 + tol / Math.min(rx, ry) : Math.abs(q - 1) * Math.min(rx, ry) <= tol; }
    case "callout": { const r = mkBox(P[1], P[2]); if (inR(r, 3)) return true; const {knee, foot} = calloutKnee(r, P[0], 1, S.view.s, +m.fs || 10); return distSeg(sp, P[0], knee) <= tol || distSeg(sp, knee, foot) <= tol; }
    case "attach": return dist(sp, P[0]) <= 13;
    default: return inR(mkBox(P[0], P[1]), 3);   // text, stamp, image, link, redaction
  }
}
function mkPolyScr(m){   // a markup's outline on screen (box / lasso selection)
  const P = m.pts.map(toScr), t = m.type;
  if (t === "note" || t === "attach") return {P: [P[0]], closed: false, count: false};
  if (MK_BOXY.has(t)) return {P: mkCorners(mkBox(P[0], P[1])), closed: true, count: false};
  if (t === "callout") return {P: mkCorners(mkBox(P[1], P[2])).concat([P[0]]), closed: false, count: false};
  return {P, closed: t === "polygon", count: false};
}

/* the selected markup's handles: box corners (a picture or stamp keeps its shape unless Shift), line ends, points */
function mkHandles(m){
  const t = m.type, P = m.pts.map(toScr);
  if (t === "note" || t === "attach") return [];
  if (MK_BOXY.has(t)) return mkCorners(mkBox(P[0], P[1])).map((p, i) => ({p, i}));
  if (t === "pen") { const xs = P.map(p => p[0]), ys = P.map(p => p[1]); return mkCorners([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).map((p, i) => ({p, i})); }
  if (t === "callout") return [{p: P[0], i: 0}].concat(mkCorners(mkBox(P[1], P[2])).map((p, j) => ({p, i: j + 1})));
  return P.map((p, i) => ({p, i}));
}
function mkHandleAt(m, sp){ const H = mkHandles(m); let bi = -1, bd = 8; H.forEach(h => { const d = dist(h.p, sp); if (d <= bd) { bd = d; bi = h.i; } }); return bi; }
function mkHandlesSvg(m){
  return mkHandles(m).map(h => `<rect x="${(h.p[0] - 4).toFixed(1)}" y="${(h.p[1] - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#4b3b8f" stroke-width="1.6"/>`).join("");
}
function mkCornerBox(o0, o1, i, q, keep){   // a box resized by its corner i to q (keep: its shape, as a picture's)
  const r = mkBox(o0, o1), c = mkCorners(r), opp = c[(i + 2) % 4];
  if (keep) { const w0 = r[2] - r[0] || 1, h0 = r[3] - r[1] || 1, a = w0 / h0; let w = Math.abs(q[0] - opp[0]), h = Math.abs(q[1] - opp[1]); if (w / h > a) w = h * a; else h = w / a;
    q = [opp[0] + (q[0] < opp[0] ? -w : w), opp[1] + (q[1] < opp[1] ? -h : h)]; }
  return [[Math.min(q[0], opp[0]), Math.min(q[1], opp[1])], [Math.max(q[0], opp[0]), Math.max(q[1], opp[1])]];
}
function mkHandleDrag(D, p, e){
  const m = objById(D.mark); if (!m) return; const o = D.orig, t = m.type; D.moved = true;
  if (t === "pen") { const xs = o.map(q => q[0]), ys = o.map(q => q[1]), r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], [a, b] = mkCornerBox([r[0], r[1]], [r[2], r[3]], D.mh, p, !e.shiftKey);
    const sx = (b[0] - a[0]) / Math.max(1e-6, r[2] - r[0]), sy = (b[1] - a[1]) / Math.max(1e-6, r[3] - r[1]); m.pts = o.map(q => [a[0] + (q[0] - r[0]) * sx, a[1] + (q[1] - r[1]) * sy]); return; }
  if (MK_BOXY.has(t)) { m.pts = mkCornerBox(o[0], o[1], D.mh, p, (t === "image" || t === "stamp") !== !!e.shiftKey); if (t === "text") mkFit(m, true); return; }
  if (t === "callout") { if (D.mh === 0) { m.pts = [p, o[1], o[2]]; return; } const [a, b] = mkCornerBox(o[1], o[2], D.mh - 1, p, false); m.pts = [o[0], a, b]; mkFit(m, true); return; }
  m.pts = o.map((q, i) => i === D.mh ? p : q.slice());
}

/* placing: a press-drag-release sizes a box / line; a click without a drag is its first corner (click again for the other)
   — or, for a text box, stamp, picture or attachment, places it there */
function mkNew(kind, pts){
  const type = mkTypeOf(kind), m = Object.assign({id: uid("M"), type, file: S.fileId, page: S.pageNo, pts, text: "", subject: MK_TOOL_NAMES["mk_" + kind] || MARK_TOOLS[type], author: qaUser(), status: "", at: new Date().toISOString()}, JSON.parse(JSON.stringify(mkStyle(kind))));
  if (kind === "hpen") m.hl = true; if (kind === "erase") m.erase = true;
  return m;
}
const mkAdd = (m, what) => mutate(() => { (P.proj.marks = P.proj.marks || []).push(m); }, "Add " + (what || MARK_TOOLS[m.type]).toLowerCase());
function mkDown(p, sp, e){
  const kind = S.tool.slice(3);
  if (kind === "polyline" || kind === "polygon") {
    if (kind === "polygon" && S.draft.length >= 3 && dist(toScr(S.draft[0]), toScr(p)) <= SNAP_PX) return finish(S.draft.slice());
    if (S.draft.length && dist(S.draft[S.draft.length - 1], p) < 1e-6) return;
    draftPush([p]); draftBtns(); draw(); return;
  }
  if (kind === "pen" || kind === "hpen") { S.mkd = {kind, pts: [toBase(sp[0], sp[1])], last: sp}; return; }
  if (kind === "callout" && !S.draft.length) { draftPush([p]); draftBtns(); draw(); return; }
  if (kind !== "callout" && S.draft.length) { const a = S.draft[0]; draftClear(); draftBtns(); mkMake(kind, a, p); return; }
  S.mkd = {kind, a: p, b: p, sp0: sp, tip: kind === "callout" ? S.draft[0] : null};
}
function mkMoveDrag(sp, e){
  const D = S.mkd;
  if (D.pts) { if (dist(sp, D.last) >= 1.5) { D.pts.push(toBase(sp[0], sp[1])); D.last = sp; } return; }
  let q = cursorPoint(e, sp).p;
  if (e.shiftKey) { const dx = q[0] - D.a[0], dy = q[1] - D.a[1];
    if (D.kind === "line") q = Math.abs(dx) >= Math.abs(dy) ? [q[0], D.a[1]] : [D.a[0], q[1]];
    else if (["box", "ellipse", "link", "redact", "erase"].indexOf(D.kind) >= 0) { const s = Math.max(Math.abs(dx), Math.abs(dy)); q = [D.a[0] + Math.sign(dx || 1) * s, D.a[1] + Math.sign(dy || 1) * s]; } }
  D.b = q;
}
function mkUp(){
  const D = S.mkd; S.mkd = null; if (!D) return;
  if (D.pts) return mkPen(D);
  const moved = dist(toScr(D.a), toScr(D.b)) > 4;
  if (D.kind === "callout") { draftClear(); draftBtns(); return mkMake("callout", D.a, moved ? D.b : null, D.tip); }
  if (moved) return mkMake(D.kind, D.a, D.b);
  if (MK_PLACE.has(D.kind)) return mkMake(D.kind, D.a, null);
  draftPush([D.a]); draftBtns(); draw();   // the first corner: click again for the other
}
function mkPen(D){
  const sp = D.pts.map(toScr), keep = [0];   // the stroke simplified to 0.6 px on screen (Douglas–Peucker)
  const dp = (i, j) => { let bi = -1, bd = 0.6; for (let n = i + 1; n < j; n++) { const d = distSeg(sp[n], sp[i], sp[j]); if (d > bd) { bd = d; bi = n; } } if (bi > 0) { dp(i, bi); keep.push(bi); dp(bi, j); } };
  if (sp.length > 2) dp(0, sp.length - 1); keep.push(sp.length - 1);
  const pts = [...new Set(keep)].sort((a, b) => a - b).map(i => D.pts[i]);
  if (pts.length < 2 || dist(sp[0], sp[sp.length - 1]) < 2 && pts.length < 3) { draw(); return; }
  mkAdd(mkNew(D.kind, pts), MK_TOOL_NAMES["mk_" + D.kind]);
}
function mkPoly(t, pts){ const kind = t.slice(3); if (pts.length < (kind === "polygon" ? 3 : 2)) { draw(); return; } mkAdd(mkNew(kind, pts)); }
async function mkMake(kind, a, b, tip){
  const px = v => v / S.view.s, m = mkNew(kind, null), type = m.type;
  if (["line", "box", "ellipse", "link", "redact"].indexOf(type) >= 0 && (!b || dist(toScr(a), toScr(b)) < 3)) { draw(); return; }
  if (type === "line") m.pts = [a, b];
  else if (type === "text" || type === "callout") {
    const v = await mkTextAsk(type === "callout" ? "Callout" : "Text box", "", m); if (!v) { draw(); return; }
    m.text = v.text; Object.assign(m, v.style);
    if (type === "text") { m.pts = b ? mkTwo(a, b) : [a, [a[0] + 1, a[1] + 1]]; mkFit(m, !!b); }
    else { const r = b ? mkBox(a, b) : [a[0], a[1], a[0] + 1, a[1] + 1]; m.pts = [tip || a, [r[0], r[1]], [r[2], r[3]]]; mkFit(m, !!b); }
  }
  else if (type === "box" || type === "ellipse" || type === "redact") m.pts = mkTwo(a, b);
  else if (type === "stamp") {
    const s = S.stampSel || await stampPicker(); if (!s) { draw(); return; }
    if (/\{name\}/.test(s.tpl || "") && !qaUser()) await askUser();
    m.stamp = {label: s.label, sub: s.tpl ? stampSub(s.tpl) : ""}; if (s.aid) m.stamp.aid = s.aid; if (s.color) m.color = s.color;
    if (b) m.pts = mkTwo(a, b);
    else { const H = px(44), W = s.aid && s.w && s.h ? H * s.w / s.h : Math.max(px(120), mkMeasure(s.label, H * .44, "sans", true) * 1.12 + H * .5, m.stamp.sub ? mkMeasure(m.stamp.sub, H * .2, "sans", false) * 1.12 + H * .4 : 0); m.pts = [[a[0] - W / 2, a[1] - H / 2], [a[0] + W / 2, a[1] + H / 2]]; }
    if (!m.text) m.text = s.label;
  }
  else if (type === "image") {
    const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp,image/bmp"); if (!f) { draw(); return; }
    let im; try { busy("Reading " + f.name + "…"); im = await imageAsset(f); } catch (e2) { busy(""); toast(e2.message || String(e2), 5000); return; } busy("");
    m.img = im; m.text = f.name;
    if (b) { const r = mkBox(a, b); m.pts = [[r[0], r[1]], [r[2], r[3]]]; }
    else { const W = Math.min(px(320), S.base.width / 3), H = W * im.h / im.w; m.pts = [a, [a[0] + W, a[1] + H]]; }
    await assetLoad(im.aid);
  }
  else if (type === "link") { const L = await linkAsk(); if (!L) { draw(); return; } m.link = L.link; m.text = L.text; m.pts = mkTwo(a, b); }
  else if (type === "attach") {
    const [f] = await pickFiles(""); if (!f) { draw(); return; }
    try { busy("Storing " + f.name + "…"); m.att = await attachAsset(f); } catch (e2) { busy(""); toast(e2.message || String(e2), 5000); return; } busy("");
    m.pts = [a]; m.text = f.name;
  }
  mkAdd(m, MK_TOOL_NAMES["mk_" + kind]);
  if (type === "text" || type === "callout" || type === "image" || type === "attach" || type === "link") { setSel([m.id]); renderProps(); draw(); }
}
async function mkTextAsk(title, text, m){   // the text of a text box / callout, with its size and weight
  const v = await ask(title, `<div class="fg w2"><label>Text</label><textarea id="mkTx" rows="5" style="width:100%;font:inherit">${esc(text)}</textarea></div>
    <div class="grid" style="margin-top:6px"><div class="fg"><label>Font size (pt on the sheet)</label><input type="number" id="mkFs" min="2" max="200" step="0.5" value="${+m.fs || 10}"></div>
    <div class="fg"><label>Font</label><select id="mkFn">${Object.keys(MK_FONT).map(f => `<option value="${f}"${m.font === f ? " selected" : ""}>${{sans: "Sans (Arial)", serif: "Serif", mono: "Monospace"}[f]}</option>`).join("")}</select></div>
    <div class="fg"><label>&nbsp;</label><label style="font-weight:400"><input type="checkbox" id="mkBd" style="width:auto"${m.bold ? " checked" : ""}> Bold</label></div></div>
    <p class="small">Enter starts a new line inside the text; the box grows to fit. Change colour, fill and border in Properties.</p>`, "Place",
    () => { const t = $("mkTx").value.replace(/\s+$/, ""); if (!t.trim()) return "Type the text"; return {text: t, style: {fs: Math.max(1, Math.min(500, +$("mkFs").value || 10)), font: $("mkFn").value, bold: $("mkBd").checked}}; }, "mkTx");
  return v;
}
async function mkEditText(m){
  if (m.type === "stamp") {
    const s = m.stamp || {}, v = await ask("Stamp text", `<div class="grid"><div class="fg w2"><label>Stamp</label><input type="text" id="stL" value="${esc(s.label || "")}"></div><div class="fg w2"><label>Second line (name, date…)</label><input type="text" id="stS" value="${esc(s.sub || "")}"></div></div>`, "Save", () => ({l: $("stL").value.trim() || "STAMP", s: $("stS").value.trim()}), "stL");
    if (v) mutate(() => { m.stamp = Object.assign({}, m.stamp, {label: v.l, sub: v.s}); m.text = v.l; m.mod = new Date().toISOString(); }, "Edit stamp");
    return;
  }
  if (m.type === "link") { const L = await linkAsk(m); if (L) mutate(() => { m.link = L.link; m.text = L.text; m.mod = new Date().toISOString(); }, "Edit hyperlink"); return; }
  if (m.type === "text" || m.type === "callout") {
    const v = await mkTextAsk(MARK_TOOLS[m.type], m.text || "", m);
    if (v) mutate(() => { m.text = v.text; Object.assign(m, v.style); mkFit(m, true); m.mod = new Date().toISOString(); }, "Edit text");
    return;
  }
  const v = await ask(MARK_TOOLS[m.type], `<div class="fg w2"><label>Comment</label><textarea id="mkTx" rows="3" style="width:100%;font:inherit">${esc(m.text || "")}</textarea></div>`, "Save", () => ({t: $("mkTx").value.trim()}), "mkTx");
  if (v) mutate(() => { m.text = v.t; m.mod = new Date().toISOString(); }, "Edit comment");
}
async function linkAsk(m){   // -> {link: {url} | {key}, text}
  const cur = m && m.link || {}, pages = allPages();
  const v = await ask("Hyperlink", `<div class="grid"><div class="fg w2"><label><input type="radio" name="lkT" value="url" style="width:auto"${cur.key ? "" : " checked"}> Web address</label><input type="text" id="lkU" placeholder="https://…" value="${esc(cur.url || "")}"></div>
    <div class="fg w2"><label><input type="radio" name="lkT" value="key" style="width:auto"${cur.key ? " checked" : ""}> A page of this project</label><select id="lkK">${pages.map(o => `<option value="${esc(o.key)}"${o.key === cur.key ? " selected" : ""}>${esc(keyName(o.key))}</option>`).join("")}</select></div>
    <div class="fg w2"><label>Tooltip (optional)</label><input type="text" id="lkX" value="${esc(m ? m.text || "" : "")}" placeholder="e.g. Door schedule"></div></div>
    <p class="small">Double-click the link (Select tool) to follow it. Exported PDFs keep it as a real link.</p>`, "Save",
    () => { const ty = (document.querySelector('input[name="lkT"]:checked') || {}).value, x = $("lkX").value.trim();
      if (ty === "key") return $("lkK").value ? {link: {key: $("lkK").value}, text: x} : "Pick a page";
      let u = $("lkU").value.trim(); if (u && !/^[a-z]+:/i.test(u)) u = "https://" + u; u = safeUrl(u); return u ? {link: {url: u}, text: x} : "Type a web address (https://…) or pick a page"; }, "lkU");
  const sync = () => { const ty = (document.querySelector('input[name="lkT"]:checked') || {}).value; if ($("lkU")) { $("lkU").disabled = ty === "key"; $("lkK").disabled = ty !== "key"; } };
  if ($("lkU")) { document.querySelectorAll('input[name="lkT"]').forEach(r => r.onchange = sync); $("lkU").oninput = () => { document.querySelector('input[name="lkT"][value="url"]').checked = true; sync(); }; sync(); }
  return v;
}
function followLink(m){
  const L = m.link || {};
  if (L.url && safeUrl(L.url)) { window.open(L.url, "_blank", "noopener"); return; }
  if (L.key && allPages().some(o => o.key === L.key)) { toast("Hyperlink → " + keyName(L.key), 1600); gotoKey(L.key); return; }
  toast("This hyperlink has no target any more — double-click with the Select tool after setting one (right-click → Edit link)", 4000);
}

/* stamps: Bluebeam's standard ones, your own (text or a picture: a signature, a seal), a second line filled when it is placed */
const STAMPS = [["APPROVED", "#1e8e5a"], ["APPROVED AS NOTED", "#1e8e5a"], ["REVIEWED", "#2a62c9"], ["REVISE AND RESUBMIT", "#d9822b"], ["REJECTED", "#c62828"], ["NOT APPROVED", "#c62828"],
  ["FOR INFORMATION ONLY", "#2a62c9"], ["FOR CONSTRUCTION", "#1e8e5a"], ["CHECKED", "#1e8e5a"], ["RECEIVED", "#2a62c9"], ["COMPLETED", "#1e8e5a"], ["AS BUILT", "#6a3fb5"],
  ["PRELIMINARY", "#5f6b7a"], ["DRAFT", "#5f6b7a"], ["VOID", "#c62828"], ["CONFIDENTIAL", "#c62828"]];
const STAMP_KEY = "zdTakeoffStamps", STAMP_TPL = "{name} · {date} {time}";
function myStamps(){ let L = []; try { L = JSON.parse(pref(STAMP_KEY) || "[]"); } catch (e) { L = []; }
  return Array.isArray(L) ? L.filter(s => s && typeof s.label === "string").map(s => ({label: s.label.slice(0, 80), color: HEXCOL.test(s.color) ? s.color : "#c62828", aid: typeof s.aid === "string" ? s.aid : undefined, w: +s.w || 0, h: +s.h || 0})) : []; }
function stampSub(tpl){   // the second line: {name} {date} {time} {project} {sheet} {page}
  const sh = (P.proj.sheets || {})[S.key] || {}, d = new Date();
  return String(tpl || "").replace(/\{(name|date|time|project|sheet|page)\}/g, (_, k) => k === "name" ? qaUser() || "—" : k === "date" ? dmy(today()) : k === "time" ? ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) : k === "project" ? P.proj.name : k === "sheet" ? sh.no || "" : keyName(S.key)).replace(/\s*·\s*$/, "").trim();
}
async function stampPicker(){   // -> {label, color, tpl, aid?, w?, h?}; kept as the Stamp tool's choice
  const L = STAMPS.map(([label, color]) => ({label, color})).concat(myStamps().map(s => Object.assign({mine: true}, s))), cur = S.stampSel || {};
  const prev = (s, i) => `<button type="button" class="stp${cur.label === s.label ? " on" : ""}" data-st="${i}" style="--sc:${s.color}" title="${esc(s.label)}">${s.aid ? '<span class="small">&#128444; ' + esc(s.label) + "</span>" : esc(s.label)}${s.mine ? `<span class="stx" data-stdel="${i}" title="Remove this stamp">&times;</span>` : ""}</button>`;
  let pick = Math.max(0, L.findIndex(s => s.label === cur.label));
  const p = ask("Stamp", `<div class="stgrid" id="stGrid">${L.map(prev).join("")}</div>
    <div class="grid" style="margin-top:8px"><div class="fg w2"><label><input type="checkbox" id="stDyn" style="width:auto"${cur.tpl === "" ? "" : " checked"}> Second line, filled when placed</label><input type="text" id="stTpl" value="${esc(cur.tpl || STAMP_TPL)}"><span class="small">{name} {date} {time} {project} {sheet} {page} — your name is the one used for checking (asked once, kept in this browser)</span></div>
    <div class="fg"><label>Your own stamp</label><input type="text" id="stNew" placeholder="e.g. ENGINEER CHECKED" maxlength="60"></div><div class="fg"><label>Colour</label><input type="color" id="stCol" value="#c62828" style="height:30px;padding:0"></div>
    <div class="fg w2"><button type="button" class="btn sm" id="stAdd">+ Add text stamp</button> <button type="button" class="btn sm" id="stImg">+ Picture stamp (signature, seal, logo)…</button></div></div>`, "Use stamp",
    () => { const s = L[pick]; if (!s) return "Pick a stamp"; return Object.assign({}, s, {tpl: $("stDyn").checked ? $("stTpl").value.trim() : ""}); });
  const B = $("dlgB"), save = () => pref(STAMP_KEY, JSON.stringify(L.filter(s => s.mine).map(s => ({label: s.label, color: s.color, aid: s.aid, w: s.w, h: s.h}))));
  const redraw = () => { $("stGrid").innerHTML = L.map(prev).join(""); B.querySelectorAll("[data-st]").forEach(b => b.classList.toggle("on", +b.dataset.st === pick)); };
  B.onclick = async e => {
    const d = e.target.closest("[data-stdel]"); if (d) { e.stopPropagation(); L.splice(+d.dataset.stdel, 1); pick = 0; save(); redraw(); return; }
    const b = e.target.closest("[data-st]"); if (b) { pick = +b.dataset.st; redraw(); return; }
    if (e.target.id === "stAdd") { const t = $("stNew").value.trim().toUpperCase(); if (!t) return toast("Type the stamp's text", 2000); L.push({label: t, color: $("stCol").value, mine: true}); pick = L.length - 1; save(); redraw(); $("stNew").value = ""; return; }
    if (e.target.id === "stImg") { const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp"); if (!f) return; try { const im = await imageAsset(f); L.push({label: f.name.replace(/\.[a-z0-9]+$/i, ""), color: "#0b0b0b", aid: im.aid, w: im.w, h: im.h, mine: true}); pick = L.length - 1; save(); redraw(); } catch (e2) { toast(e2.message || String(e2), 5000); } }
  };
  redraw();
  const v = await p; B.onclick = null;
  if (v) { S.stampSel = v; if (v.aid) assetLoad(v.aid); }
  return v;
}

/* properties of a markup (the panel on the right) */
function mkPropsHtml(mk){
  const t = mk.type, nu = MK_TYPES.has(t), fillT = ["box", "ellipse", "polygon", "text", "callout"].includes(t), lineT = ["line", "polyline"].includes(t), textT = ["text", "callout"].includes(t);
  const strokeT = !["image", "link", "attach", "redact", "stamp", "hilite", "fence"].includes(t) && !(t === "pen" && mk.hl), dashT = nu && ["line", "polyline", "polygon", "box", "ellipse"].includes(t);
  const fg = (label, html, flex) => `<div class="fg"${flex ? ` style="flex:${flex}"` : ""}><label>${label}</label>${html}</div>`;
  const colIn = (prop, v, d) => `<input type="color" data-mprop="${prop}" value="${/^#[0-9a-f]{6}$/i.test(v || "") ? v : d}" style="height:30px;padding:0">`;
  const num = (prop, v, lo, hi, st) => `<input type="number" data-mprop="${prop}" min="${lo}" max="${hi}" step="${st}" value="${v}">`;
  const sel = (prop, v, opts) => `<select data-mprop="${prop}">${Object.entries(opts).map(([k, n]) => `<option value="${esc(k)}"${k === String(v) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  const h = mk.hatch || null, rows = [];
  rows.push(`<div class="row">${fg("Subject", `<input type="text" data-mprop="subject" value="${esc(mk.subject || MARK_TOOLS[t])}">`, 1.4)}
    ${textT ? fg("Text", `<textarea data-mprop="text" rows="2" style="width:100%;font:inherit;resize:vertical">${esc(mk.text)}</textarea>`, 3) : t === "stamp" ? fg("Stamp", `<input type="text" data-mprop="stamp.label" value="${esc((mk.stamp || {}).label || "")}">`, 2) + fg("Second line", `<input type="text" data-mprop="stamp.sub" value="${esc((mk.stamp || {}).sub || "")}">`, 2)
      : fg(t === "dimension" ? "Text / label" : t === "link" ? "Tooltip" : t === "redact" ? "Overlay text" : "Comment", `<input type="text" data-mprop="text" value="${esc(mk.text)}" placeholder="${t === "dimension" ? "Override the measured length" : ""}">`, 3)}
    ${t !== "redact" && t !== "link" && t !== "attach" && !(t === "stamp" && (mk.stamp || {}).aid) ? fg(textT ? "Text / line colour" : "Colour", colIn("color", mk.color, "#d03b3b")) : ""}
    ${strokeT ? fg("Line width", num("width", mk.width == null ? 2 : +mk.width, t === "text" || t === "callout" ? 0 : 1, 24, 0.5)) : t === "pen" && mk.hl ? fg("Width (pt)", num("width", +mk.width || 9, 1, 200, 1)) : ""}
    ${dashT ? fg("Line style", sel("dash", mk.dash || "solid", MK_DASH)) : ""}
    ${nu && t !== "link" && t !== "attach" && t !== "redact" ? fg("Opacity", num("op", mk.op == null ? 1 : +mk.op, 0.05, 1, 0.05)) : ""}
    ${t === "hilite" ? fg("Opacity", num("opacity", +mk.opacity || .38, 0.05, 1, 0.05)) : ""}</div>`);
  if (t === "dimension") rows.push(`<div class="row">${fg("Text size", num("size", +mk.size || 13, 8, 48, 1))}${fg("Arrow size", num("arrow", +mk.arrow || 10, 5, 40, 1))}${fg("Offset", num("offset", +mk.offset || 24, 0, 500, 1))}</div>`);
  if (fillT) rows.push(`<div class="row">${fg("Fill", `<span style="display:flex;gap:6px;align-items:center">${colIn("fill", mk.fill, "#ffffff")}<label style="font-weight:400;white-space:nowrap"><input type="checkbox" data-mprop="nofill" style="width:auto"${mk.fill ? "" : " checked"}> none</label></span>`)}
    ${fg("Fill opacity", num("fillOp", mk.fillOp == null ? 0.15 : +mk.fillOp, 0, 1, 0.05))}
    ${fg("Hatch", sel("hatch.p", h ? h.p : "", Object.assign({"": "None"}, HATCHES)))}
    ${h ? fg("Spacing (pt)", num("hatch.sp", +h.sp || 6, 0.5, 500, 0.5)) + fg("Hatch line", num("hatch.lw", +h.lw || 0.8, 0.2, 12, 0.1)) + fg("Hatch colour", colIn("hatch.col", h.col || mk.color, "#d03b3b")) : ""}
    ${h && h.p === "custom" ? fg("Angle °", num("hatch.ang", +h.ang || 0, -360, 360, 5)) + fg("&nbsp;", `<label style="font-weight:400"><input type="checkbox" data-mprop="hatch.x" style="width:auto"${h.x ? " checked" : ""}> crossed</label>`) : ""}</div>`);
  if (lineT || t === "callout") rows.push(`<div class="row">${fg(t === "callout" ? "Leader end" : "Start", sel("a0", mk.a0 || (t === "callout" ? "arrow" : "none"), MK_ENDS))}${lineT ? fg("End", sel("a1", mk.a1 || "none", MK_ENDS)) : ""}</div>`);
  if (textT) rows.push(`<div class="row">${fg("Font size (pt)", num("fs", +mk.fs || 10, 1, 500, 0.5))}${fg("Font", sel("font", mk.font || "sans", {sans: "Sans (Arial)", serif: "Serif", mono: "Monospace"}))}${fg("Align", sel("align", mk.align || "left", {left: "Left", center: "Centre", right: "Right"}))}${fg("&nbsp;", `<label style="font-weight:400"><input type="checkbox" data-mprop="bold" style="width:auto"${mk.bold ? " checked" : ""}> Bold</label>`)}</div>`);
  if (t === "link") rows.push(`<div class="row"><span class="small" style="flex:1">→ ${esc(mk.link && mk.link.url ? mk.link.url : mk.link && mk.link.key ? keyName(mk.link.key) : "no target")}</span><button class="btn sm" data-mact2="link">Edit link…</button><button class="btn sm" data-mact2="follow">Open</button><label style="font-weight:400"><input type="checkbox" data-mprop="show" style="width:auto"${mk.show ? " checked" : ""}> Show a frame in exports</label></div>`);
  if (t === "attach") rows.push(`<div class="row"><span class="small" style="flex:1">&#128206; ${esc((mk.att || {}).name || "file")} · ${fmtBytes((mk.att || {}).size || 0)}</span><button class="btn sm" data-mact2="open">Open</button><button class="btn sm" data-mact2="save">Save a copy</button><button class="btn sm" data-mact2="replace">Replace…</button></div>`);
  if (t === "image") rows.push(`<div class="row"><span class="small" style="flex:1">${esc((mk.img || {}).name || "picture")}${mk.img && mk.img.w ? " · " + mk.img.w + " × " + mk.img.h + " px" : ""}</span><button class="btn sm" data-mact2="replace">Replace picture…</button>${fg("Border width", num("width", +mk.width || 0, 0, 24, 0.5))}</div>`);
  if (t === "redact") rows.push(`<div class="row">${fg("Fill", colIn("fill", mk.fill || (mk.erase ? "#ffffff" : "#000000"), "#000000"))}<span class="small" style="flex:3">Applied in every export: the page is flattened to a picture so what is under it is gone for good (the PDF in this project is not changed).</span></div>`);
  rows.push(`<div class="row">${fg("Status", sel("status", mk.status || "", Object.fromEntries(mkStatusList().map(s => [s, s || "None"]))))}
    ${fg("Layer", sel("layer", mk.layer || "", Object.assign({"": "None"}, Object.fromEntries(mkLayers().map(l => [l.id, l.name])))))}
    ${nu || t === "note" || t === "cloud" || t === "arrow" ? `<button class="btn sm" data-mact2="edit">${textT ? "Edit text…" : t === "stamp" ? "Edit stamp…" : t === "link" ? "Edit link…" : "Comment…"}</button>` : ""}
    <button class="btn sm" data-mact2="default" title="Use this style for new ${esc(MARK_TOOLS[t].toLowerCase())}s">Set as default</button>
    <button class="btn sm" data-act="lock">${mk.locked ? "&#128275; Unlock" : "&#128274; Lock"}</button><button class="btn dng" data-act="delMark"${mk.locked ? " disabled" : ""}>Delete</button></div>
    <div class="small" style="margin-top:4px">${mk.author ? "By " + esc(mk.author) + " · " : ""}${mk.at ? "added " + esc(dmy(mk.at)) : ""}${mk.mod ? " · changed " + esc(dmy(mk.mod)) : ""}</div>`);
  return `<h4>${esc(MARK_TOOLS[t])} <span style="font-weight:400;color:var(--muted);font-size:11px">markup — not a quantity · drag to move${nu && t !== "attach" ? " · drag a handle to resize" : ""}</span></h4>` + rows.join("");
}
const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B";
function mkPropSet(mk, f, el){   // a field of the markup's properties changed
  const v = el.type === "checkbox" ? el.checked : el.value, NUM = ["width", "size", "arrow", "offset", "opacity", "fs", "fillOp", "op", "hatch.sp", "hatch.lw", "hatch.ang"];
  mutate(() => {
    if (f === "nofill") { if (v) { mk._fill = mk.fill || mk._fill; mk.fill = ""; } else mk.fill = mk._fill || "#ffffff"; delete mk._fill; }
    else if (f === "hatch.p") { if (!v) mk.hatch = null; else mk.hatch = Object.assign({sp: 6, lw: 0.8}, mk.hatch || {}, {p: v}, v === "custom" ? {ang: (mk.hatch || {}).ang || 45} : {}); }
    else if (f.indexOf(".") > 0) { const [a, b] = f.split("."); mk[a] = Object.assign({}, mk[a] || {}); mk[a][b] = NUM.includes(f) ? +v || 0 : v; if (a === "stamp" && b === "label") mk.text = v; }
    else if (NUM.includes(f)) mk[f] = Math.max(0, +v || 0);
    else mk[f] = v;
    if (MK_TYPES.has(mk.type)) { Object.assign(mk, mkClean(mk)); if ((mk.type === "text" || mk.type === "callout") && ["text", "fs", "font", "bold"].includes(f)) mkFit(mk, true); mk.mod = new Date().toISOString(); }
  }, "Markup " + f.replace(/\..*/, ""));
}
async function mkPropAct(mk, act){
  if (act === "edit") return mkEditText(mk);
  if (act === "default") return setDefaultsFromSelection(mk);
  if (act === "link") return mkEditText(mk);
  if (act === "follow") return followLink(mk);
  if (act === "open" || act === "save") return mk.att && openAsset(mk.att.aid, mk.att.name, act === "save");
  if (act === "replace" && mk.type === "attach") { const [f] = await pickFiles(""); if (!f) return; try { const a = await attachAsset(f); mutate(() => { mk.att = a; mk.text = f.name; mk.mod = new Date().toISOString(); }, "Replace attachment"); } catch (e) { toast(e.message || String(e), 5000); } return; }
  if (act === "replace" && mk.type === "image") { const [f] = await pickFiles("image/png,image/jpeg,image/gif,image/webp,image/bmp"); if (!f) return; try { const im = await imageAsset(f); await assetLoad(im.aid); mutate(() => { mk.img = im; mk.text = f.name; const r = mkBox(mk.pts[0], mk.pts[1]), W = r[2] - r[0]; mk.pts = [[r[0], r[1]], [r[2], r[1] + W * im.h / im.w]]; mk.mod = new Date().toISOString(); }, "Replace picture"); } catch (e) { toast(e.message || String(e), 5000); } }
}
function mkHover(o){
  const t = o.type, nm = o.subject && o.subject !== MARK_TOOLS[t] ? o.subject : MARK_TOOLS[t];
  if (t === "link") return nm + " → " + (o.link && o.link.url ? o.link.url : o.link && o.link.key ? keyName(o.link.key) : "no target") + (o.text ? " · " + o.text : "") + " · double-click to open";
  if (t === "attach") return "📎 " + ((o.att || {}).name || "file") + " · double-click to open";
  if (t === "stamp") return "Stamp " + ((o.stamp || {}).label || "") + ((o.stamp || {}).sub ? " · " + o.stamp.sub : "");
  const txt = String(o.text || "").replace(/\s+/g, " "); return nm + (txt ? " — " + (txt.length > 60 ? txt.slice(0, 59) + "…" : txt) : "") + (o.status ? " · " + o.status : "") + (o.locked ? " · locked" : "");
}
function mkMenu(anchor){   // Markup ▾: every markup tool
  const r = anchor.getBoundingClientRect(), T = (t, k) => ({t: (MK_TOOL_NAMES[t] || MARK_TOOLS[t]), k, fn: () => setTool(t), on: S.tool === t});
  ctxShow([{h: "Markup tools", s: "Bluebeam-style · not quantities"}, T("mk_text", "T"), T("mk_callout", "Q"), T("note", "N"), {sep: 1},
    T("mk_line", "Shift+L"), T("arrow"), T("mk_polyline", "Y"), T("mk_polygon", "G"), T("mk_box", "Shift+R"), T("mk_ellipse", "Shift+E"), T("cloud", "U"), T("dimension"), {sep: 1},
    T("mk_pen", "P"), T("mk_hpen", "Shift+H"), T("hilite"), {sep: 1},
    T("mk_stamp", "X"), T("mk_image", "I"), T("mk_link"), T("mk_attach"), {sep: 1},
    T("mk_redact"), T("mk_erase")], r.left, r.bottom + 4);
}
async function mkAssetsCleanup(gone){   // pictures and files no project uses any more (a project deleted): taken out of this browser
  const used = new Set(); (await dbAll("projects")).forEach(p => (p.marks || []).forEach(m => mkAids(m).forEach(a => used.add(a))));
  try { const L = JSON.parse(pref(STAMP_KEY) || "[]"); if (Array.isArray(L)) L.forEach(s => s && s.aid && used.add(s.aid)); } catch (e) {}
  for (const a of gone) if (!used.has(a)) await dbDel("pdfs", assetKey(a)).catch(() => {});
}
const MK_HINTS = {mk_text: "Text box: click to place it, or drag its width — then type (Enter makes a new line).",
  mk_callout: "Callout: click the point it points at, then where the text goes (click, or drag the box) — then type.",
  mk_line: "Line: drag, or click both ends (Shift: straight) · arrow ends and line style in Properties.",
  mk_polyline: "Polyline: click the points; Enter, double-click or right-click to finish · type a length + Enter (12'-6\").",
  mk_polygon: "Polygon: click the corners; click the first point, Enter or right-click to close.",
  mk_box: "Rectangle: drag, or click two opposite corners (Shift: square).", mk_ellipse: "Ellipse: drag, or click two opposite corners (Shift: circle).",
  mk_pen: "Pen: draw freehand with the mouse, a stylus or a finger.", mk_hpen: "Highlighter pen: draw over what to highlight.",
  mk_stamp: "Stamp: click to place it (drag to size it) · its second line takes your name and the date · X picks another stamp.",
  mk_image: "Image: click to place a picture (drag to size it).", mk_link: "Hyperlink: drag a box over what should open a web page or another sheet.",
  mk_attach: "File attachment: click where its pin goes, then choose the file.", mk_redact: "Redaction: drag a box over what must not be seen — every export removes it for good.",
  mk_erase: "Erase (white-out): drag a box over what to hide — exports white it out for good."};
function mkPreview(kind, base, a, b){   // what a box / line being drawn will look like
  if (kind === "text" || kind === "image" || kind === "attach" || kind === "callout") { const p = toScr(a), q = toScr(b); return `<rect x="${Math.min(p[0], q[0]).toFixed(1)}" y="${Math.min(p[1], q[1]).toFixed(1)}" width="${Math.abs(q[0] - p[0]).toFixed(1)}" height="${Math.abs(q[1] - p[1]).toFixed(1)}" fill="rgba(42,120,214,.06)" stroke="#2a78d6" stroke-width="1.2" stroke-dasharray="5 3"/>`; }
  return mkSvg(Object.assign({}, base, {pts: kind === "line" ? [a, b] : mkTwo(a, b)}), toScr, 1, false);
}
function mkDraftSvg(){   // the markup being drawn (cursor layer)
  const kind = S.tool.slice(3), base = Object.assign({type: mkTypeOf(kind), hl: kind === "hpen", erase: kind === "erase", text: "", stamp: {label: (S.stampSel || {}).label || "STAMP"}}, mkStyle(kind)), D = S.mkd, out = [];
  if (D && D.pts) out.push(mkSvg(Object.assign({}, base, {pts: D.pts.length > 1 ? D.pts : D.pts.concat([D.pts[0]])}), toScr, 1, false));
  else if (D && D.a) { if (kind === "callout" && D.tip) { const t = toScr(D.tip), a = toScr(D.a); out.push(`<line x1="${t[0]}" y1="${t[1]}" x2="${a[0]}" y2="${a[1]}" stroke="#2a78d6" stroke-width="1.2" stroke-dasharray="5 3"/>`); } if (dist(toScr(D.a), toScr(D.b)) > 3) out.push(mkPreview(kind, base, D.a, D.b)); }
  else if (S.draft.length && S.cursor) {
    if (kind === "polyline" || kind === "polygon") { out.push(mkSvg(Object.assign({}, base, {pts: S.draft.concat([S.cursor])}), toScr, 1, false)); S.draft.forEach(p => { const q = toScr(p); out.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5" fill="#fff" stroke="${base.color || "#d03b3b"}" stroke-width="2"/>`); }); }
    else if (kind === "callout") { const t = toScr(S.draft[0]), c = toScr(S.cursor); out.push(`<line x1="${t[0]}" y1="${t[1]}" x2="${c[0]}" y2="${c[1]}" stroke="${base.color}" stroke-width="1.5" stroke-dasharray="5 3"/>`); }
    else out.push(mkPreview(kind, base, S.draft[0], S.cursor));
  }
  return out.join("");
}
const mkRedacted = (f, p) => !!P.proj && (P.proj.marks || []).some(m => m.type === "redact" && m.file === f && m.page === p);
function mkPdfLinks(L, out, page, f, p, map, Q){   // the page's hyperlinks as real links in the exported PDF (a page link once its target page is in it)
  (P.proj.marks || []).filter(m => m.type === "link" && m.file === f && m.page === p && m.link && m.pts.length > 1).forEach(m => {
    const r = mkBox(m.pts[0], m.pts[1]), a = map(r[0], r[3]), b = map(r[2], r[1]), rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    if (m.link.url && safeUrl(m.link.url)) page.node.addAnnot(out.context.register(out.context.obj({Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], F: 4, A: {Type: "Action", S: "URI", URI: L.PDFString.of(m.link.url)}})));
    else if (m.link.key && Q) Q.push({page, rect, key: m.link.key});
  });
}
function mkPdfLinksDone(out, Q, byKey){ (Q || []).forEach(q => { const tp = byKey[q.key]; if (tp) q.page.node.addAnnot(out.context.register(out.context.obj({Type: "Annot", Subtype: "Link", Rect: q.rect, Border: [0, 0, 0], F: 4, Dest: [tp.ref, "Fit"]}))); }); }
async function mkPdfAttach(out, keys){   // the files attached on these pages go inside the PDF too
  if (typeof out.attach !== "function" || !P.proj) return 0; let n = 0;
  for (const m of (P.proj.marks || []).filter(x => x.type === "attach" && x.att && x.att.aid && keys.has(keyOf(x.file, x.page)))) {
    const r = await assetRec(m.att.aid); if (!r) continue;
    await out.attach(new Uint8Array(r.data), m.att.name || r.name || "file", {mimeType: r.type || "application/octet-stream", description: (m.subject || "Attachment") + " — " + keyName(keyOf(m.file, m.page)), creationDate: new Date(m.at || Date.now()), modificationDate: new Date(m.mod || m.at || Date.now())}); n++;
  }
  return n;
}
function mkCtxItems(m, many){   // right-click on a markup: what its kind can do
  if (many) return [];
  const t = m.type;
  if (t === "link") return [{t: "Open link", k: "Dbl-click", fn: () => followLink(m)}, {t: "Edit link…", fn: () => mkEditText(m)}];
  if (t === "attach") return [{t: "Open file", k: "Dbl-click", fn: () => m.att && openAsset(m.att.aid, m.att.name)}, {t: "Save a copy…", fn: () => m.att && openAsset(m.att.aid, m.att.name, true)}, {t: "Replace file…", fn: () => mkPropAct(m, "replace")}];
  if (t === "image") return [{t: "Replace picture…", fn: () => mkPropAct(m, "replace")}];
  if (t === "text" || t === "callout") return [{t: "Edit text…", k: "Dbl-click", fn: () => mkEditText(m)}];
  if (t === "stamp") return [{t: "Edit stamp…", k: "Dbl-click", fn: () => mkEditText(m)}];
  if (MK_TYPES.has(t)) return [{t: "Comment…", k: "Dbl-click", fn: () => mkEditText(m)}];
  return t !== "hilite" && t !== "fence" && t !== "dimension" ? [{t: "Edit text…", k: "Dbl-click", fn: () => editMarkText(m)}] : [];
}

/* ------------------------------------------------------------------ Markups List (Bluebeam Revu): every markup in one table —
   this page or the whole project — sorted by any column, filtered (and the filter saved), statuses (your own too), replies,
   markup layers, the room each markup sits in (Spaces); summaries as CSV, XML and a printable PDF with a picture of each */
const ML_KEY = "zdTakeoffMkList";
function mlPref(){ let o = null; try { o = JSON.parse(pref(ML_KEY) || "null"); } catch (e) { o = null; } return Object.assign({open: false, h: 300, scope: "page", sort: "page", dir: 1}, o && typeof o === "object" ? o : {}); }
function mlSet(ch){ pref(ML_KEY, JSON.stringify(Object.assign(mlPref(), ch))); }
S.ml = {q: "", type: "", status: "", author: "", layer: "", space: "", ticked: new Set(), focus: null};
const mkLayers = () => (P.proj && P.proj.mkLayers) || [];
const mkLayerOf = m => m && m.layer ? mkLayers().find(l => l.id === m.layer) || null : null;
const mkHidden = m => { const l = mkLayerOf(m); return !!(l && l.hidden); };
function mkCommon(m){   // the fields every markup can carry (any kind, any age), checked when a project is opened
  ["subject", "author", "status"].forEach(k => { if (m[k] != null) m[k] = String(m[k]).slice(0, 200); });
  if (m.layer != null) m.layer = String(m.layer).slice(0, 40);
  if (m.replies != null) m.replies = Array.isArray(m.replies) ? m.replies.filter(r => r && typeof r === "object" && typeof r.text === "string").slice(0, 500).map(r => ({id: String(r.id || uid("R")).slice(0, 40), author: String(r.author || "").slice(0, 100), at: String(r.at || "").slice(0, 40), text: r.text.slice(0, 5000)})) : [];
}
function mlFilterClean(f){ f = f && typeof f === "object" ? f : {}; const o = {}; ["q", "type", "status", "author", "layer", "space"].forEach(k => { o[k] = String(f[k] == null ? "" : f[k]).slice(0, 120); }); o.scope = f.scope === "all" ? "all" : "page"; return o; }
function mkProjCommon(p){   // a project's markup layers, statuses and saved filters, checked
  const arr = Array.isArray, obj = v => v && typeof v === "object" && !arr(v);
  if (p.mkLayers != null) p.mkLayers = arr(p.mkLayers) ? p.mkLayers.filter(l => obj(l) && l.id != null).slice(0, 200).map(l => ({id: String(l.id).slice(0, 40), name: String(l.name == null ? "Layer" : l.name).slice(0, 80), hidden: !!l.hidden})) : [];
  if (p.mkStatuses != null) p.mkStatuses = arr(p.mkStatuses) ? [...new Set(p.mkStatuses.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 40)))].slice(0, 60) : [];
  if (p.mkFilters != null) p.mkFilters = arr(p.mkFilters) ? p.mkFilters.filter(x => obj(x) && typeof x.name === "string" && x.name.trim()).slice(0, 60).map(x => ({id: String(x.id || uid("F")).slice(0, 40), name: x.name.trim().slice(0, 60), f: mlFilterClean(x.f)})) : [];
}
const mkCenter = m => { if (m.type === "note" || m.type === "attach") return m.pts[0]; const P2 = m.type === "callout" ? m.pts.slice(1) : m.pts, xs = P2.map(p => p[0]), ys = P2.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
function mkSpaceOf(m){   // the room a markup sits in: the smallest named area measured under its middle (Bluebeam's Spaces)
  const c = mkCenter(m); let best = "", ba = Infinity;
  P.proj.items.forEach(i => { if (i.file !== m.file || i.page !== m.page || !i.label || i.kind === "ded") return; const cd = cond(i.cond); if (!cd || cd.type !== "area") return;
    const poly = itemPoly(i); if (poly.length > 2 && pointInPoly(c, poly)) { const a = Math.abs(polyArea(poly)); if (a < ba) { ba = a; best = i.label; } } });
  return best;
}
const mkName = m => MK_TOOL_NAMES["mk_" + mkKindOf(m)] || MARK_TOOLS[m.type] || m.type;
const mkPlain = m => m.type === "stamp" ? ((m.stamp || {}).label || "") + ((m.stamp || {}).sub ? " · " + m.stamp.sub : "") : m.type === "link" ? ((m.text ? m.text + " → " : "") + (m.link && (m.link.url || (m.link.key ? keyName(m.link.key) : "")) || "")) : m.type === "attach" ? (m.att || {}).name || "" : m.type === "image" ? (m.img || {}).name || "" : String(m.text || "");
function mlRows(){
  const o = mlPref(), f = S.ml, q = f.q.trim().toLowerCase(), order = new Map(); allPages().forEach((x, i) => order.set(x.key, i));
  let L = (P.proj.marks || []).filter(m => m.type !== "fence" && (o.scope === "all" || (m.file === S.fileId && m.page === S.pageNo)));
  if (f.type) L = L.filter(m => mkKindOf(m) === f.type);
  if (f.status) L = L.filter(m => (m.status || "") === (f.status === "(none)" ? "" : f.status));
  if (f.author) L = L.filter(m => (m.author || "") === (f.author === "(none)" ? "" : f.author));
  if (f.layer) L = L.filter(m => (m.layer || "") === (f.layer === "(none)" ? "" : f.layer));
  let R = L.map(m => ({m, id: m.id, type: mkName(m), subject: m.subject || MARK_TOOLS[m.type], text: mkPlain(m), page: keyName(keyOf(m.file, m.page)), po: order.has(keyOf(m.file, m.page)) ? order.get(keyOf(m.file, m.page)) : 1e9,
    author: m.author || "", at: m.at || "", status: m.status || "", layer: (mkLayerOf(m) || {}).name || "", space: mkSpaceOf(m), replies: (m.replies || []).length, color: m.color || ""}));
  if (f.space) R = R.filter(r => r.space === (f.space === "(none)" ? "" : f.space));
  if (q) R = R.filter(r => [r.type, r.subject, r.text, r.page, r.author, r.status, r.layer, r.space].concat((r.m.replies || []).map(x => x.text)).join(" ").toLowerCase().includes(q));
  const k = o.sort, d = o.dir === -1 ? -1 : 1;
  R.sort((a, b) => { const v = k === "page" ? a.po - b.po || mkCenter(a.m)[1] - mkCenter(b.m)[1] : k === "replies" ? a.replies - b.replies : k === "at" ? String(a.at).localeCompare(String(b.at)) : String(a[k] || "").localeCompare(String(b[k] || ""), undefined, {numeric: true, sensitivity: "base"}); return v * d || a.po - b.po; });
  return R;
}
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? "" : ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };   // local time
const ML_COLS = [["type", "Type"], ["subject", "Subject"], ["text", "Comments"], ["page", "Page"], ["author", "Author"], ["at", "Date"], ["status", "Status"], ["layer", "Layer"], ["space", "Space"], ["replies", "Replies"]];
function mlToggle(open){ const o = mlPref(); mlSet({open: open == null ? !o.open : !!open}); mlRender(true); setTimeout(() => { if (S.page) { applyView(); renderHi(); } }, 0); }
let mlT = 0;
function mlSoon(){ if (!mlPref().open || mlT) return; mlT = requestAnimationFrame(() => { mlT = 0; mlRender(); }); }
function mlRender(head){
  const el = $("mkList"); if (!el) return; const o = mlPref(), on = !!(o.open && P.proj);
  el.style.display = on ? "flex" : "none"; el.style.height = Math.max(120, Math.min(700, +o.h || 300)) + "px";
  const tb = $("bMkList"); if (tb) tb.classList.toggle("on", on);
  if (!on) return;
  if (head || !$("mlHead")) {
    const all = (P.proj.marks || []).filter(m => m.type !== "fence"), f = S.ml, opt = (v, n, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(n)}</option>`;
    const kinds = [...new Set(all.map(mkKindOf))].sort(), authors = [...new Set(all.map(m => m.author || ""))].sort(), sts = mkStatusList().slice(1), saved = P.proj.mkFilters || [];
    const spaces = [...new Set(all.map(mkSpaceOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    el.innerHTML = `<div class="mlrz" id="mlRz" title="Drag to resize"></div><div class="mlhead" id="mlHead"><b>Markups list</b>
      <select id="mlScope" title="Which markups">${opt("page", "This page", o.scope)}${opt("all", "All pages", o.scope)}</select>
      <input type="search" id="mlQ" placeholder="Search comments, subjects, authors…" value="${esc(f.q)}">
      <select id="mlType" title="Type"><option value="">All types</option>${kinds.map(k => opt(k, MK_TOOL_NAMES["mk_" + k] || MARK_TOOLS[k] || k, f.type)).join("")}</select>
      <select id="mlSt" title="Status"><option value="">Any status</option>${opt("(none)", "No status", f.status)}${sts.map(s => opt(s, s, f.status)).join("")}</select>
      <select id="mlAu" title="Author"><option value="">Any author</option>${authors.map(a => opt(a || "(none)", a || "No author", f.author)).join("")}</select>
      <select id="mlLy" title="Markup layer"><option value="">Any layer</option>${opt("(none)", "No layer", f.layer)}${mkLayers().map(l => opt(l.id, l.name, f.layer)).join("")}</select>
      ${spaces.length ? `<select id="mlSp" title="Space (the room it sits in)"><option value="">Any space</option>${opt("(none)", "Not in a room", f.space)}${spaces.map(s => opt(s, s, f.space)).join("")}</select>` : ""}
      <select id="mlSaved" title="Saved filters"><option value="">Filters…</option>${saved.map(x => opt(x.id, x.name, "")).join("")}<option value="+">Save this filter…</option>${saved.length ? '<option value="-">Delete a filter…</option>' : ""}</select>
      <span class="sp"></span><button class="btn sm" id="mlExp" title="Summary of the markups listed: CSV, XML or a printable PDF">Summary ▾</button><button class="btn sm" id="mlStat" title="Your own statuses">Statuses…</button><button class="btn sm" id="mlClose" title="Close (Alt+L)">&times;</button></div>
      <div class="mlbody" id="mlBody"></div>`;
  }
  const R = mlRows(), f = S.ml, foc = f.focus && objById(f.focus);
  [...f.ticked].forEach(id => { if (!objById(id)) f.ticked.delete(id); });
  const nT = [...f.ticked].length, sts = mkStatusList();
  const row = r => `<tr data-mlid="${esc(r.id)}" class="${r.id === f.focus || selIds().has(r.id) ? "on" : ""}"><td><input type="checkbox" data-mlt="${esc(r.id)}"${f.ticked.has(r.id) ? " checked" : ""}></td>
    <td><span class="mlsw" style="background:${esc(r.color || "#9fb0c6")}"></span>${esc(r.type)}</td><td>${esc(r.subject)}</td><td class="mltx" title="${esc(r.text)}">${esc(r.text.length > 90 ? r.text.slice(0, 89) + "…" : r.text)}</td>
    <td>${esc(r.page)}</td><td>${esc(r.author)}</td><td>${esc(dmy(r.at))}</td>
    <td><select data-mlst="${esc(r.id)}">${sts.map(s => `<option value="${esc(s)}"${s === r.status ? " selected" : ""}>${esc(s || "—")}</option>`).join("")}</select></td>
    <td>${esc(r.layer)}</td><td>${esc(r.space)}</td><td class="n">${r.replies || ""}</td></tr>`;
  const SHOW = 1500;
  $("mlBody").innerHTML = `<div class="mltab"><div class="mlbar">${R.length} markup${R.length === 1 ? "" : "s"}${R.length > SHOW ? " (the first " + SHOW + " shown — filter to see the rest)" : ""}${nT ? ` · <b>${nT} ticked</b>
      <select id="mlBSt"><option value="">Set status…</option>${sts.map(s => `<option value="${esc(s) || "(none)"}">${esc(s || "None")}</option>`).join("")}</select>
      <select id="mlBLy"><option value="">Move to layer…</option><option value="(none)">No layer</option>${mkLayers().map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}<option value="+">New layer…</option></select>
      <button class="btn sm" id="mlBSel">Select on the drawing</button><button class="btn sm dng" id="mlBDel">Delete</button>` : ""}</div>
    <div class="mlscroll"><table class="mlt"><thead><tr><th><input type="checkbox" id="mlAll"${R.length && R.every(r => f.ticked.has(r.id)) ? " checked" : ""} title="Tick all listed"></th>${ML_COLS.map(([k, n]) => `<th data-mls="${k}" class="${mlPref().sort === k ? "on" : ""}">${n}${mlPref().sort === k ? (mlPref().dir === -1 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead>
    <tbody>${R.slice(0, SHOW).map(row).join("") || `<tr><td colspan="${ML_COLS.length + 1}" class="mlempty">No markups${S.ml.q || S.ml.type || S.ml.status || S.ml.author || S.ml.layer || S.ml.space ? " match the filter" : mlPref().scope === "page" ? " on this page — draw one with ✎ Markup ▾, or list All pages" : " yet"}.</td></tr>`}</tbody></table></div></div>
    ${foc ? mlDetail(foc) : ""}`;
}
function mlDetail(m){   // the focused markup: its comment and its replies
  const R = m.replies || [];
  return `<div class="mldet"><div class="mldh"><b>${esc(mkName(m))}</b> · ${esc(keyName(keyOf(m.file, m.page)))}<span class="sp"></span><button class="btn sm" data-mlgo="${esc(m.id)}">Show</button><button class="btn sm" id="mlDetX" title="Close">&times;</button></div>
    <div class="small">${esc(m.author || "—")} · ${esc(dmy(m.at))}${m.status ? " · <b>" + esc(m.status) + "</b>" : ""}</div>
    <div class="mlc">${esc(mkPlain(m)) || '<span class="small">no comment</span>'}</div>
    <div class="mlreps">${R.map(r => `<div class="mlrep"><div class="small"><b>${esc(r.author || "—")}</b> · ${esc(dmy(r.at))} ${esc(hhmm(r.at))}<button class="mlrx" data-mlrdel="${esc(r.id)}" title="Delete this reply">&times;</button></div>${esc(r.text)}</div>`).join("") || '<div class="small">No replies yet.</div>'}</div>
    <textarea id="mlRep" rows="2" placeholder="Reply…"></textarea><button class="btn sm pri" id="mlRepGo">Reply</button></div>`;
}
async function mlGo(id){   // a row clicked: the page, the markup selected and in view
  const m = objById(id); if (!m) return;
  if (m.file !== S.fileId || m.page !== S.pageNo) await gotoPage(m.file, m.page);
  if (!onPage(m)) return;
  setTool("select"); setSel([id]); refresh();
  const sp = toScr(mkCenter(m)), st = stage(); if (sp[0] < 0 || sp[1] < 0 || sp[0] > st.clientWidth || sp[1] > st.clientHeight) zoomTo(new Set([id]));
  S.flash = {key: S.key, p: mkCenter(m), until: Date.now() + 1500}; draw(); setTimeout(draw, 1600);
}
async function mlReply(m, text){
  text = String(text || "").trim(); if (!text) return;
  const who = qaUser() || await askUser();
  mutate(() => { m.replies = (m.replies || []).concat([{id: uid("R"), author: who || "", at: new Date().toISOString(), text: text.slice(0, 5000)}]); m.mod = new Date().toISOString(); }, "Reply");
}
async function mlStatuses(){   // your own statuses, beside Bluebeam's
  const cur = (P.proj.mkStatuses || []).join("\n");
  const v = await ask("Markup statuses", `<p class="small">Bluebeam's statuses are always there: ${MK_STATUSES.slice(1).map(esc).join(", ")}. Add your own, one per line (e.g. <i>Back-charge</i>, <i>Site to confirm</i>). They are kept with this project.</p>
    <textarea id="stList" rows="7" style="width:100%;font:inherit">${esc(cur)}</textarea>`, "Save", () => ({L: [...new Set($("stList").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean))].slice(0, 60).map(x => x.slice(0, 40))}), "stList");
  if (v) { mutate(() => { P.proj.mkStatuses = v.L.filter(x => MK_STATUSES.indexOf(x) < 0); }, "Markup statuses"); mlRender(true); }
}
async function mkLayerNew(){
  const v = await ask("New markup layer", `<div class="fg w2"><label>Name</label><input type="text" id="mklN" placeholder="e.g. Site comments, QS review, Client"></div>`, "Add", () => { const n = $("mklN").value.trim(); return n ? {n: n.slice(0, 80)} : "Name the layer"; }, "mklN");
  if (!v) return null; const id = uid("L"); mutate(() => { (P.proj.mkLayers = P.proj.mkLayers || []).push({id, name: v.n, hidden: false}); }, "New markup layer"); return id;
}
function mkLayersHtml(){
  const L = mkLayers(), n = id => (P.proj.marks || []).filter(m => (m.layer || "") === id).length;
  return `<div class="lyrbar"><b style="flex:1;color:var(--navy)">Markup layers · ${L.length}</b><button class="btn sm" data-mkl="add" title="A layer for markups (yours, the site's, the client's…)">+ Layer</button><button class="btn sm" data-mkl="list" title="Markups list (Alt+L)">☰ List</button></div>`
    + L.map(l => `<label class="lyr"><input type="checkbox" data-mklv="${esc(l.id)}"${l.hidden ? "" : " checked"}> <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(l.name)} <span class="small">(${n(l.id)})</span></span><button type="button" class="lyiso" data-mklr="${esc(l.id)}" title="Rename">&#9998;</button><button type="button" class="lyiso" data-mkld="${esc(l.id)}" title="Delete the layer (its markups stay, on no layer)">&times;</button></label>`).join("")
    + `<div class="small" style="padding:4px 12px 10px">${L.length ? "A layer switched off is hidden on the drawing and left out of exports (a redaction still applies). " : ""}Put markups on a layer from their Properties or the Markups list.</div>`;
}
async function mkLayerAct(t){
  const id = t.dataset.mklr || t.dataset.mkld, l = mkLayers().find(x => x.id === id);
  if (t.dataset.mkl === "add") { await mkLayerNew(); renderLayers(); mlRender(true); return; }
  if (t.dataset.mkl === "list") return mlToggle(true);
  if (!l) return;
  if (t.dataset.mklr) { const v = await ask("Rename layer", `<div class="fg w2"><label>Name</label><input type="text" id="mklN" value="${esc(l.name)}"></div>`, "Save", () => { const n = $("mklN").value.trim(); return n ? {n: n.slice(0, 80)} : "Name the layer"; }, "mklN"); if (v) mutate(() => { l.name = v.n; }, "Rename markup layer"); }
  if (t.dataset.mkld) { if (!confirm("Delete the layer “" + l.name + "”? Its markups stay, on no layer.")) return; mutate(() => { P.proj.mkLayers = mkLayers().filter(x => x.id !== id); (P.proj.marks || []).forEach(m => { if (m.layer === id) delete m.layer; }); }, "Delete markup layer"); }
  renderLayers(); mlRender(true);
}
/* summaries of the markups listed */
const mlCols = r => [r.page, ((P.proj.sheets || {})[keyOf(r.m.file, r.m.page)] || {}).no || "", r.type, r.subject, r.text, r.author, r.at ? dmy(r.at) + " " + hhmm(r.at) : "", r.m.mod ? dmy(r.m.mod) : "", r.status, r.layer, r.space, r.color, (r.m.replies || []).map(x => (x.author || "—") + " (" + dmy(x.at) + "): " + x.text).join(" | ")];
const ML_HEAD = ["Page", "Sheet", "Type", "Subject", "Comments", "Author", "Date", "Modified", "Status", "Layer", "Space", "Colour", "Replies"];
function mlCsv(R){
  const t = [ML_HEAD].concat(R.map(mlCols)).map(r => r.map(v => { v = String(v == null ? "" : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n");
  saveBlob(new Blob(["﻿" + t], {type: "text/csv;charset=utf-8"}), fileBase() + "_Markups.csv");
}
function mlXml(R){
  const x = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<Markups project="${x(P.proj.name)}" exported="${x(new Date().toISOString())}" count="${R.length}">`];
  R.forEach(r => { const m = r.m;
    out.push(`  <Markup id="${x(m.id)}" type="${x(mkKindOf(m))}">`, `    <Page>${x(r.page)}</Page>`, `    <Sheet>${x(((P.proj.sheets || {})[keyOf(m.file, m.page)] || {}).no || "")}</Sheet>`, `    <Subject>${x(r.subject)}</Subject>`, `    <Comments>${x(r.text)}</Comments>`,
      `    <Author>${x(r.author)}</Author>`, `    <Date>${x(r.at)}</Date>`, `    <Modified>${x(m.mod || "")}</Modified>`, `    <Status>${x(r.status)}</Status>`, `    <Layer>${x(r.layer)}</Layer>`, `    <Space>${x(r.space)}</Space>`, `    <Color>${x(r.color)}</Color>`,
      `    <Bounds>${x(mkPolyBounds(m).map(v => v.toFixed(2)).join(","))}</Bounds>`);
    if ((m.replies || []).length) { out.push("    <Replies>"); m.replies.forEach(p => out.push(`      <Reply author="${x(p.author)}" date="${x(p.at)}">${x(p.text)}</Reply>`)); out.push("    </Replies>"); }
    out.push("  </Markup>"); });
  out.push("</Markups>");
  saveBlob(new Blob([out.join("\n")], {type: "application/xml"}), fileBase() + "_Markups.xml");
}
function mkPolyBounds(m){ const xs = m.pts.map(p => p[0]), ys = m.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
async function mlSummary(R, pics){   // a printable summary (print → Save as PDF), a picture of each markup when asked
  const w = window.open("", "_blank"); if (!w) return toast("The browser blocked the new tab — allow pop-ups for this page, then try again", 5000);
  w.document.write("<!doctype html><title>Markups summary…</title><p style='font:14px Segoe UI,Arial'>Building the markups summary…</p>");
  const shots = new Map();
  if (pics) {
    const byPage = new Map(); R.slice(0, 300).forEach(r => { const k = keyOf(r.m.file, r.m.page); if (!byPage.has(k)) byPage.set(k, []); byPage.get(k).push(r.m); });
    for (const [k, L] of byPage) {
      busy("Pictures of the markups… " + keyName(k));
      try { const [f, p0] = k.split(":"), p = +p0, pg = await (await doc(f)).getPage(p), base = pg.getViewport({scale: 1}), sc = Math.min(2, 2400 / Math.max(base.width, base.height));
        const cv = document.createElement("canvas"); cv.width = Math.ceil(base.width * sc); cv.height = Math.ceil(base.height * sc); const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        await loadLayers(f); await sliced(pg.render({...lay(f), canvasContext: ctx, viewport: pg.getViewport({scale: sc})})).promise;
        await mkAssetsFor(f, p); await svgOnto(ctx, pageOverlaySvg(f, p, sc, cv.width, cv.height, {legend: "none", meas: false}));
        L.forEach(m => { const b = mkPolyBounds(m), mg = 24, x0 = Math.max(0, (b[0] - mg) * sc), y0 = Math.max(0, (b[1] - mg) * sc), x1 = Math.min(cv.width, (b[2] + mg) * sc), y1 = Math.min(cv.height, (b[3] + mg) * sc);
          const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0), k2 = Math.min(1, 260 / W, 180 / H), t = document.createElement("canvas"); t.width = Math.max(1, Math.round(W * k2)); t.height = Math.max(1, Math.round(H * k2));
          t.getContext("2d").drawImage(cv, x0, y0, W, H, 0, 0, t.width, t.height); shots.set(m.id, t.toDataURL("image/jpeg", 0.82)); t.width = 0; });
        cv.width = 0; } catch (e) { /* a page that cannot be drawn: listed without pictures */ }
    }
    busy("");
  }
  const groups = new Map(); R.forEach(r => { const k = r.page; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const css = `body{font:12px "Segoe UI",Arial,sans-serif;color:#1e2b3a;margin:24px}h1{font-size:18px;color:#0f2942;margin:0 0 4px}h2{font-size:14px;color:#0f2942;margin:18px 0 6px;border-bottom:2px solid #0f2942;padding-bottom:3px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #c9d6e4;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eef2f7;font-size:11px}td.p{width:180px}td.p img{max-width:260px;max-height:180px;display:block}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
    .rep{margin-top:4px;padding:3px 6px;border-left:3px solid #c9d6e4;color:#33475b}.meta{color:#6b7d92}@media print{h2{break-after:avoid}tr{break-inside:avoid}}`;
  const body = [...groups].map(([pg, rows]) => `<h2>${esc(pg)}</h2><table><tr>${pics ? "<th>Markup</th>" : ""}<th>Type / subject</th><th>Comments</th><th>Author · date</th><th>Status</th><th>Layer · space</th></tr>${rows.map(r => `<tr>${pics ? `<td class="p">${shots.get(r.id) ? `<img src="${shots.get(r.id)}" alt="">` : ""}</td>` : ""}
    <td><span class="sw" style="background:${esc(r.color || "#9fb0c6")}"></span><b>${esc(r.type)}</b>${r.subject !== r.type ? "<br>" + esc(r.subject) : ""}</td><td>${esc(r.text).replace(/\n/g, "<br>")}${(r.m.replies || []).map(x => `<div class="rep"><b>${esc(x.author || "—")}</b> <span class="meta">${esc(dmy(x.at))}</span><br>${esc(x.text)}</div>`).join("")}</td>
    <td>${esc(r.author || "—")}<br><span class="meta">${esc(dmy(r.at))}</span></td><td>${esc(r.status || "—")}</td><td>${esc([r.layer, r.space].filter(Boolean).join(" · ") || "—")}</td></tr>`).join("")}</table>`).join("");
  w.document.open(); w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(P.proj.name)} — markups summary</title><style>${css}</style></head><body><h1>${esc(P.proj.name)} — markups summary</h1>
    <div class="meta">${R.length} markup${R.length === 1 ? "" : "s"} · ${esc(dmy(today()))}${qaUser() ? " · " + esc(qaUser()) : ""} · Print → Save as PDF</div>${body || "<p>No markups listed.</p>"}</body></html>`); w.document.close();
}
async function mlExport(anchor){
  const R = mlRows(), r = anchor.getBoundingClientRect();
  ctxShow([{h: "Summary of " + R.length + " markup" + (R.length === 1 ? "" : "s"), s: "the markups listed, as filtered and sorted"}, {t: "PDF summary with pictures (print → Save as PDF)…", fn: () => mlSummary(R, true)}, {t: "PDF summary, text only…", fn: () => mlSummary(R, false)},
    {sep: 1}, {t: "CSV (Excel)", fn: () => mlCsv(R)}, {t: "XML", fn: () => mlXml(R)}], r.left, r.bottom + 4);
}
async function mlSavedAct(v){
  if (v === "+") { const n = await ask("Save this filter", `<div class="fg w2"><label>Name</label><input type="text" id="mlfN" placeholder="e.g. Open site comments"></div>`, "Save", () => { const x = $("mlfN").value.trim(); return x ? {x: x.slice(0, 60)} : "Name the filter"; }, "mlfN");
    if (n) mutate(() => { (P.proj.mkFilters = P.proj.mkFilters || []).push({id: uid("F"), name: n.x, f: mlFilterClean(Object.assign({}, S.ml, {scope: mlPref().scope}))}); }, "Save filter"); mlRender(true); return; }
  if (v === "-") { const L = P.proj.mkFilters || [], d = await ask("Delete a filter", `<div class="fg w2"><label>Filter</label><select id="mlfD">${L.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></div>`, "Delete", () => ({id: $("mlfD").value}));
    if (d) mutate(() => { P.proj.mkFilters = L.filter(x => x.id !== d.id); }, "Delete filter"); mlRender(true); return; }
  const x = (P.proj.mkFilters || []).find(y => y.id === v); if (!x) return;
  Object.assign(S.ml, mlFilterClean(x.f), {ticked: new Set(), focus: null}); mlSet({scope: x.f.scope === "all" ? "all" : "page"}); mlRender(true); toast("Filter: " + x.name, 1600);
}
function mlWire(){
  const el = $("mkList"); if (!el) return;
  el.addEventListener("input", e => { if (e.target.id === "mlQ") { S.ml.q = e.target.value; mlRender(); } });
  el.addEventListener("change", e => {
    const t = e.target, id = t.dataset.mlst || t.dataset.mlt;
    if (t.id === "mlScope") { mlSet({scope: t.value}); S.ml.ticked.clear(); return mlRender(true); }
    if (t.id === "mlType" || t.id === "mlSt" || t.id === "mlAu" || t.id === "mlLy" || t.id === "mlSp") { S.ml[{mlType: "type", mlSt: "status", mlAu: "author", mlLy: "layer", mlSp: "space"}[t.id]] = t.value; return mlRender(); }
    if (t.id === "mlSaved") { const v = t.value; t.value = ""; if (v) mlSavedAct(v); return; }
    if (t.dataset.mlst) { const m = objById(id); if (m) mutate(() => { m.status = t.value; m.mod = new Date().toISOString(); }, "Status " + (t.value || "none")); return; }
    if (t.dataset.mlt) { if (t.checked) S.ml.ticked.add(id); else S.ml.ticked.delete(id); return mlRender(); }
    if (t.id === "mlAll") { const R = mlRows(); if (t.checked) R.forEach(r => S.ml.ticked.add(r.id)); else S.ml.ticked.clear(); return mlRender(); }
    if (t.id === "mlBSt" && t.value) { const v = t.value === "(none)" ? "" : t.value, ids = new Set(S.ml.ticked); mutate(() => (P.proj.marks || []).forEach(m => { if (ids.has(m.id)) { m.status = v; m.mod = new Date().toISOString(); } }), "Status " + (v || "none") + " on " + ids.size); return; }
    if (t.id === "mlBLy" && t.value) { const ids = new Set(S.ml.ticked), go = async () => { let v = t.value; if (v === "+") { v = await mkLayerNew(); if (!v) return mlRender(); } mutate(() => (P.proj.marks || []).forEach(m => { if (ids.has(m.id)) { if (v === "(none)") delete m.layer; else m.layer = v; } }), "Move " + ids.size + " to a layer"); renderLayers(); mlRender(true); }; go(); return; }
  });
  el.addEventListener("click", e => {
    const t = e.target;
    if (t.id === "mlClose") return mlToggle(false);
    if (t.id === "mlExp") return mlExport(t);
    if (t.id === "mlStat") return mlStatuses();
    if (t.id === "mlDetX") { S.ml.focus = null; return mlRender(); }
    if (t.id === "mlRepGo") { const m = objById(S.ml.focus); if (m) mlReply(m, $("mlRep").value).then(() => mlRender()); return; }
    if (t.dataset.mlrdel) { const m = objById(S.ml.focus); if (m && confirm("Delete this reply?")) mutate(() => { m.replies = (m.replies || []).filter(r => r.id !== t.dataset.mlrdel); }, "Delete reply"); return; }
    if (t.dataset.mlgo) return mlGo(t.dataset.mlgo);
    if (t.id === "mlBSel") { const ids = [...S.ml.ticked].filter(id => onPage(objById(id))); if (!ids.length) return toast("None of the ticked markups is on this page", 2500); setTool("select"); setSel(ids); refresh(); return; }
    if (t.id === "mlBDel") { const ids = new Set(S.ml.ticked); if (ids.size && confirm("Delete " + ids.size + " markup" + (ids.size === 1 ? "" : "s") + "?")) { delObjects(ids); S.ml.ticked.clear(); } return; }
    const th = t.closest("th[data-mls]"); if (th) { const o = mlPref(); mlSet(o.sort === th.dataset.mls ? {dir: -o.dir || -1} : {sort: th.dataset.mls, dir: 1}); return mlRender(); }
    const tr = t.closest("tr[data-mlid]"); if (tr && !t.closest("input,select,button")) { S.ml.focus = tr.dataset.mlid; mlGo(tr.dataset.mlid).then(() => mlRender()); }
  });
  el.addEventListener("dblclick", e => { const tr = e.target.closest("tr[data-mlid]"); if (tr && !e.target.closest("input,select,button")) { const m = objById(tr.dataset.mlid); if (m) editMarkText(m); } });
  el.addEventListener("keydown", e => { if (e.target.id === "mlRep" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("mlRepGo").click(); } });
  el.addEventListener("pointerdown", e => {   // the top edge: drag to make the list taller or shorter
    if (e.target.id !== "mlRz") return; e.preventDefault(); const y0 = e.clientY, h0 = el.offsetHeight;
    const mv = ev => { el.style.height = Math.max(120, Math.min(700, h0 + y0 - ev.clientY)) + "px"; };
    const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); mlSet({h: el.offsetHeight}); if (S.page) { applyView(); renderHi(); } };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  });
}

/* ------------------------------------------------------------------ colour picker (condition swatch) */
function swatches(cur){ return COLORS.map(x => `<button type="button" class="swb${x === cur ? " on" : ""}" data-sw="${x}" style="background:${x}" title="${x}"></button>`).join(""); }
function colorPop(anchor, c){
  const pop = $("pop"), r = anchor.getBoundingClientRect();
  pop.innerHTML = `<div class="swg">${swatches(c.color)}</div><label class="cust">Custom <input type="color" id="popCustom" value="${/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#2a78d6"}"></label>`;
  pop.style.left = Math.min(r.left, window.innerWidth - 230) + "px"; pop.style.top = (r.bottom + 6) + "px"; pop.classList.add("on");
  const set = col => { if (col && col !== c.color) mutate(() => { c.color = col; }); };
  pop.onclick = e => { const b = e.target.closest("[data-sw]"); if (b) { set(b.dataset.sw); pop.classList.remove("on"); } };
  $("popCustom").onchange = e => { set(e.target.value); pop.classList.remove("on"); };
  setTimeout(() => document.addEventListener("pointerdown", function off(e){ if (!pop.contains(e.target)) { pop.classList.remove("on"); document.removeEventListener("pointerdown", off, true); } }, true), 0);
}

/* ------------------------------------------------------------------ dialogs */
function ask(title, body, okLabel, read, focusId){
  if (ask.cur) ask.cur(null);   // a dialog opened over another: the one underneath is cancelled, never left listening for Enter
  return new Promise(res => {
    $("dlgT").textContent = title; $("dlgB").innerHTML = body + '<div class="err" id="dlgErr"></div>';
    $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Cancel</button>${okLabel ? `<button class="btn pri" id="dlgOk">${esc(okLabel)}</button>` : ""}`;
    $("dlgBack").classList.add("on");
    const done = v => { if (ask.cur === done) ask.cur = null; $("dlgBack").classList.remove("on"); document.removeEventListener("keydown", key, true); res(v); };
    ask.cur = done;
    const ok = () => { const v = read ? read() : true; if (typeof v === "string") { $("dlgErr").textContent = v; return; } done(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); e.stopPropagation(); ok(); } };
    document.addEventListener("keydown", key, true);
    $("dlgCancel").onclick = () => done(null);
    if ($("dlgOk")) $("dlgOk").onclick = ok;
    const f = focusId && $(focusId); if (f) { f.focus(); if (f.select) f.select(); }   // at once: a delayed focus could steal keystrokes already typed
  });
}
const PRESETS = [
  {name: "Floor area", type: "area", unit: "Sft"},
  {name: "RCC slab — state thickness", type: "area", unit: "cft", dedMin: 0.5, needT: true},
  {name: "Ceiling plaster", type: "area", unit: "Sft", dedMin: 1.0},
  {name: "Formwork — soffit", type: "area", unit: "Sft", dedMin: 5.0},
  {name: "Brick masonry 9\" wall", type: "linear", unit: "cft", t: 0.75, dedMin: 1.0, needH: true},
  {name: "Brick masonry 13.5\" wall", type: "linear", unit: "cft", t: 1.125, dedMin: 1.0, needH: true},
  {name: "Partition wall 4.5\" (thickness 0.375 ft)", type: "linear", unit: "Sft", t: 0.375, dedMin: 1.0, needH: true},
  {name: "Internal plaster on walls — both faces", type: "linear", unit: "Sft", faces: 2, dedMin: 1.0, needH: true},
  {name: "External plaster", type: "linear", unit: "Sft", faces: 1, dedMin: 1.0, needH: true},
  {name: "Skirting", type: "linear", unit: "ft"},
  {name: "Doors", type: "count", unit: "Nos"},
  {name: "Windows", type: "count", unit: "Nos"},
  {name: "Custom area", type: "area", unit: "Sft"}, {name: "Custom length", type: "linear", unit: "ft"}, {name: "Custom count", type: "count", unit: "Nos"}
];
async function defaultsDialog(){
  const d = toolDefaults();
  const v = await ask("Professional takeoff defaults", `<p class="small">These defaults are used for new conditions, measurements, markups and dimensions. Existing objects are unchanged unless you select one of the apply options.</p>
    <div class="grid"><div class="fg"><label>Measurement colour</label><input type="color" id="dfCond" value="${d.condColor}"></div><div class="fg"><label>Measurement line weight</label><input type="number" id="dfCondW" min="1" max="12" value="${d.condWidth}"></div>
    <div class="fg"><label>Markup colour</label><input type="color" id="dfMark" value="${d.markColor}"></div><div class="fg"><label>Markup line weight</label><input type="number" id="dfMarkW" min="1" max="12" value="${d.markWidth}"></div>
    <div class="fg"><label>Dimension colour</label><input type="color" id="dfDim" value="${d.dimColor}"></div><div class="fg"><label>Dimension line weight</label><input type="number" id="dfDimW" min="1" max="12" value="${d.dimWidth}"></div>
    <div class="fg"><label>Dimension text size</label><input type="number" id="dfDimS" min="8" max="48" value="${d.dimSize}"></div><div class="fg"><label>Dimension arrow size</label><input type="number" id="dfDimA" min="5" max="40" value="${d.dimArrow}"></div>
    <div class="fg"><label>Dimension offset</label><input type="number" id="dfDimO" min="0" max="500" value="${d.dimOffset}"></div><div class="fg"><label>Highlight colour</label><input type="color" id="dfHi" value="${d.hiliteColor}"></div>
    <div class="fg"><label>Highlight opacity</label><input type="number" id="dfHiO" min="0.05" max="1" step="0.05" value="${d.hiliteOpacity}"></div></div>
    <div class="row" style="margin-top:10px"><label class="pk"><input type="checkbox" id="dfApplyMk"> Apply markup defaults to existing markups</label><label class="pk"><input type="checkbox" id="dfApplyC"> Apply measurement colour / weight to all existing conditions</label></div>`, "Save defaults", () => ({
      condColor: $("dfCond").value, condWidth: Math.max(1, Math.min(12, +$("dfCondW").value || 2)), markColor: $("dfMark").value, markWidth: Math.max(1, Math.min(12, +$("dfMarkW").value || 2)), dimColor: $("dfDim").value, dimWidth: Math.max(1, Math.min(12, +$("dfDimW").value || 2)), dimSize: Math.max(8, Math.min(48, +$("dfDimS").value || 13)), dimArrow: Math.max(5, Math.min(40, +$("dfDimA").value || 10)), dimOffset: Math.max(0, Math.min(500, +$("dfDimO").value || 24)), hiliteColor: $("dfHi").value, hiliteOpacity: Math.max(.05, Math.min(1, +$("dfHiO").value || .38)), applyMk: $("dfApplyMk").checked, applyC: $("dfApplyC").checked
    }));
  if (!v) return;
  const d2 = Object.assign({}, v); delete d2.applyMk; delete d2.applyC; saveToolDefaults(d2);
  mutate(() => { if (v.applyC) P.proj.conds.forEach(c => { c.color = v.condColor; c.sw = v.condWidth; }); if (v.applyMk) (P.proj.marks || []).forEach(m => { m.color = m.type === "dimension" ? v.dimColor : m.type === "hilite" ? v.hiliteColor : v.markColor; m.width = m.type === "dimension" ? v.dimWidth : v.markWidth; if (m.type === "dimension") { m.size = v.dimSize; m.arrow = v.dimArrow; m.offset = v.dimOffset; } if (m.type === "hilite") m.opacity = v.hiliteOpacity; }); });
  toast("Professional defaults saved" + (v.applyMk || v.applyC ? " and applied" : ""), 2500);
}
async function editCond(c){
  const isNew = !c, used = c && P.proj.items.some(i => i.cond === c.id);
  const dflt = toolDefaults();
  const d = c ? Object.assign({}, c) : {name: "", type: "area", unit: "Sft", color: dflt.condColor, sw: dflt.condWidth, h: "", t: "", faces: 1, dedMin: 0};
  const unitOpts = t => UNITS[t].map(u => `<option${u === d.unit ? " selected" : ""}>${u}</option>`).join("");
  const body = (isNew ? `<div class="fg w2" style="margin-bottom:10px"><label>Start from</label><select id="cPre"><option value="">— choose a common item —</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select></div>` : "") +
    `<div class="grid"><div class="fg w2"><label>Name (as it should read on the sheet)</label><input type="text" id="cName" value="${esc(d.name)}"></div>
     <div class="fg"><label>Measured as</label><select id="cType"${used ? " disabled" : ""}><option value="area"${d.type === "area" ? " selected" : ""}>Area</option><option value="linear"${d.type === "linear" ? " selected" : ""}>Length</option><option value="count"${d.type === "count" ? " selected" : ""}>Count</option></select></div>
     <div class="fg"><label>Quantity unit</label><select id="cUnit">${unitOpts(d.type)}</select></div>
     <div class="fg"><label>Height H (ft)</label><input type="text" id="cH" value="${d.h ? f3(+d.h) : ""}" placeholder="walls: floor to ceiling"></div>
     <div class="fg"><label>Thickness T (ft)</label><input type="text" id="cT" value="${d.t ? f3(+d.t) : ""}" placeholder="9&quot; = 0.75"></div>
     <div class="fg"><label>Faces</label><input type="number" id="cF" min="1" max="2" step="1" value="${+d.faces || 1}"></div>
     <div class="fg"><label>Deduct openings / voids over</label><input type="text" id="cD" value="${f2(+d.dedMin || 0)}"></div>
     <div class="fg"><label>BOQ / WBS code</label><input type="text" id="cBoq" value="${esc(d.boq || "")}" placeholder="e.g. CW-01-009"></div>
     <div class="fg"><label>Rate Analysis code</label><input type="text" id="cRa" value="${esc(d.ra || "")}" list="dlRa" placeholder="e.g. CIV-MAS-001" autocomplete="off"><datalist id="dlRa">${raLib().o ? [...raLib().items.values()].map(i => `<option value="${esc(i.code || i.id)}">${esc((i.qs || i.sub || "") + " — " + String(i.desc || "").slice(0, 60) + " (" + i.unit + ")")}</option>`).join("") : ""}</datalist></div>
     <div class="fg w2 small" id="cRaInfo"></div>
     <div class="fg cntonly"><label>Count symbol</label><select id="cSym">${Object.entries(SYMS).map(([k2, v2]) => `<option value="${k2}"${(d.sym || "circle") === k2 ? " selected" : ""}>${v2}</option>`).join("")}</select></div>
     <div class="fg cntonly"><label>Caption</label><select id="cCap"><option value="seq"${(d.cap || "seq") === "seq" ? " selected" : ""}>Number 1, 2, 3…</option><option value="name"${d.cap === "name" ? " selected" : ""}>Condition name</option><option value="text"${d.cap === "text" ? " selected" : ""}>Custom label</option><option value="none"${d.cap === "none" ? " selected" : ""}>None</option></select></div>
     <div class="fg cntonly"><label>Custom label</label><input type="text" id="cCapT" value="${esc(d.capText || "")}" placeholder="e.g. LGT-EM"></div>
     <div class="fg cntonly"><label>Size</label><select id="cSz"><option value="s"${d.sz === "s" ? " selected" : ""}>Small</option><option value="m"${(d.sz || "m") === "m" ? " selected" : ""}>Medium</option><option value="l"${d.sz === "l" ? " selected" : ""}>Large</option></select></div>
     <div class="fg w2"><label>Colour</label><input type="hidden" id="cC" value="${esc(d.color)}"><div class="swg" id="cSw">${swatches(d.color)}<label class="cust">Custom <input type="color" id="cCx" value="${/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#2a78d6"}"></label></div></div></div>
     <p class="small" style="margin-top:10px">Area → Sft, or cft with T (slab, screed). Length → ft; Sft with H (plaster, 4.5" partition — 2 faces for internal plaster); cft with H and T (9" and thicker walls).
     House thresholds: masonry and plaster openings 1.00 Sft, formwork 5.00 Sft, concrete voids 0.50 cft.</p>`;
  const pr = ask(isNew ? "New condition" : "Edit condition", body, isNew ? "Create" : "Save", () => {
    const name = $("cName").value.trim(), type = $("cType").value, unit = $("cUnit").value, H = $("cH").value.trim() ? parseFt($("cH").value) : 0, T = $("cT").value.trim() ? parseFt($("cT").value) : 0;
    if (!name) return "Give the condition a name";
    if (isNaN(H) || isNaN(T)) return "Height and thickness are decimal feet (or ft-in like 10'-6\")";
    if (type === "linear" && unit !== "ft" && !(H > 0)) return "A wall measured in " + unit + " needs its height H";
    if (unit === "cft" && !(T > 0)) return "A quantity in cft needs the thickness T";
    return {name, type, unit, h: H || "", t: T || "", faces: Math.max(1, Math.min(2, +$("cF").value || 1)), dedMin: Math.max(0, parseFloat($("cD").value) || 0), color: $("cC").value,
      sym: $("cSym").value, cap: $("cCap").value, capText: $("cCapT").value.trim(), sz: $("cSz").value, boq: $("cBoq").value.trim(), ra: $("cRa").value.trim().toUpperCase()};
  }, "cName");
  const raInfo = () => { const code = $("cRa").value.trim(); if (!code) { $("cRaInfo").innerHTML = raLib().o ? "Link a Rate Analysis item to take its built-up rate (or type the rate in the bill’s Assembly)." : "Rate Analysis library not found in this browser — open SAJ QSCOST → Rate Analysis on this site once to link codes."; return; }
    const r = rateOf({ra: code.toUpperCase()}, $("cUnit").value), p = raPrice(code);
    $("cRaInfo").innerHTML = r.na ? `<span style="color:var(--red)">${esc(r.na)}</span>` : `<b>${esc(p.code)}</b> — ${esc(String(p.desc).slice(0, 110))} · <b>PKR ${f2(r.rate)} / ${esc(p.unit)}</b>${r.assumed ? ` · <span style="color:var(--amber)">${r.assumed} assumed row(s)</span>` : ""}`; };
  $("cRa").addEventListener("input", raInfo); $("cUnit").addEventListener("change", raInfo); raInfo();
  const showCnt = () => document.querySelectorAll(".dlg .cntonly").forEach(el => { el.style.display = $("cType").value === "count" ? "" : "none"; });
  showCnt(); $("cType").addEventListener("change", showCnt);
  let del = false;
  if (!isNew) { const b = document.createElement("button"); b.className = "btn dng"; b.textContent = "Delete condition"; b.style.marginRight = "auto"; b.onclick = () => { del = true; $("dlgCancel").click(); }; $("dlgF").prepend(b); }
  const v = await pr;
  if (del) {
    const n = P.proj.items.filter(i => i.cond === c.id).length;
    const ok = await ask("Delete condition", `<p>Delete <b>${esc(c.name)}</b>${n ? ` and its <b>${n}</b> measurement${n > 1 ? "s" : ""}` : ""}? Undo (Ctrl+Z) brings it back.</p>`, "Delete");
    if (ok) { mutate(() => { P.proj.items = P.proj.items.filter(i => i.cond !== c.id); P.proj.conds = P.proj.conds.filter(x => x.id !== c.id); }); if (S.cond === c.id) S.cond = (P.proj.conds[0] || {}).id || null; S.sel = null; refresh(); }
    return;
  }
  if (!v) return;
  mutate(() => {
    if (isNew) { const nc = Object.assign({id: uid("C")}, v); P.proj.conds.push(nc); S.cond = nc.id; }
    else Object.assign(cond(c.id), v);
  });
  if (isNew) setTool("draw");
}
document.addEventListener("click", e => {   // dialog: colour swatches
  const b = e.target.closest("#cSw [data-sw]"); if (!b) return;
  $("cC").value = b.dataset.sw; $("cSw").querySelectorAll(".swb").forEach(x => x.classList.toggle("on", x === b));
});
document.addEventListener("change", e => {   // dialog: preset and type change
  if (e.target.id === "cCx") { $("cC").value = e.target.value; $("cSw").querySelectorAll(".swb").forEach(x => x.classList.remove("on")); }
  if (e.target.id === "cPre" && e.target.value !== "") {
    const p = PRESETS[+e.target.value];
    $("cName").value = p.name; $("cType").value = p.type; $("cUnit").innerHTML = UNITS[p.type].map(u => `<option${u === p.unit ? " selected" : ""}>${u}</option>`).join("");
    $("cT").value = p.t ? f3(p.t) : ""; $("cF").value = p.faces || 1; $("cD").value = f2(p.dedMin || 0);   // H is the project's, never the preset's: left as typed
    $("dlgErr").textContent = p.needH && !$("cH").value.trim() ? "Enter the height H (floor to ceiling / slab soffit) — it is not assumed." : p.needT ? "Enter the thickness T — it is not assumed." : "";
  }
  if (e.target.id === "cType") $("cUnit").innerHTML = UNITS[e.target.value].map(u => `<option>${u}</option>`).join("");
});
async function scaleDialog(){
  if (!S.page) return;
  const key0 = S.key; let pv = []; try { pv = await pdfScalesOn(S.fileId, S.pageNo, S.base); } catch (e) {}
  if (key0 !== S.key) return;
  const sc = P.proj.scales[S.key], cands = scaleCandidates(S.key);
  const body = `<p>Current: <b>${sc ? (sc.how === "note" ? esc(scaleLabel(sc)) + " (from the drawing note)" : sc.how === "pdf" ? esc(sc.text) + " (saved in the PDF)" : sc.how === "manual" ? esc(sc.text) + " (chosen by hand)" : sc.how === "inherited" ? "inherited — " + esc(sc.text) : "calibrated — " + esc(sc.text)) : "not set"}</b>${sc ? (sc.verified ? " · <span style='color:var(--green)'>verified</span>" : " · <span style='color:var(--amber)'>not verified</span>") : ""} · status <b>${esc(scaleState(sc).ic + " " + scaleState(sc).t)}</b></p>
    ${sc && sc.note ? `<p class="small">${esc(sc.note)}</p>` : ""}
    ${cands.length ? `<p style="margin-top:10px"><b>Scale notes found on this page</b></p>` + cands.map((c, i) => `<div class="cand" data-cand="${i}"><b>${esc(c.label)}</b><span class="small">“${esc(c.text.slice(0, 70))}”${c.note ? " · " + esc(c.note) : ""}</span></div>`).join("") : '<p class="small" style="margin-top:10px">No scale note was found in the text of this page (scanned drawings have no text).</p>'}
    ${pv.length ? `<p style="margin-top:10px"><b>Scale saved in this PDF</b> <span class="small">— by Bluebeam, Acrobat or the CAD plot; exact for the page as printed</span></p>` + pv.map((v, i) => `<div class="cand" data-pv="${i}"><b>${esc(v.label)}</b><span class="small">${v.name ? esc(v.name) + " · " : ""}${v.share >= 0.999 ? "whole page" : Math.round(v.share * 100) + "% of the sheet"} · 1 ft = ${v.ptPerFt.toFixed(4)} pt</span></div>`).join("") : ""}
    <p class="small" style="margin-top:10px">A scale note is only right if the PDF is printed at the drawing's paper size. <b>Verify</b> by measuring a dimension you know; <b>Calibrate</b> sets the scale from it.</p>
    <p style="margin-top:12px"><b>Or choose the scale</b> <span class="small">— architectural, engineering or metric, for a page with no note or a wrong one</span></p>
    <div class="grid" style="margin-top:6px"><div class="fg"><label>Scale</label><select id="msSel"><option value="">— pick —</option>${MAN_SCALES.map(g => `<optgroup label="${esc(g[0])}">${g[1].map(t => `<option>${esc(t)}</option>`).join("")}</optgroup>`).join("")}</select></div>
      <div class="fg"><label>…or type it</label><input type="text" id="msTxt" placeholder='3/16" = 1&#39;-0" · 1" = 40&#39; · 1:75' autocomplete="off"></div>
      <div class="fg"><label>Drawn for paper size</label><select id="msPaper"><option value="">This PDF page as it is (${(S.base.width / 72).toFixed(1)} × ${(S.base.height / 72).toFixed(1)} in)</option>${Object.keys(PAPER).map(p2 => `<option value="${p2}">${esc(p2)} — printed on this page: × ${(Math.max(S.base.width, S.base.height) / PAPER[p2]).toFixed(3)}</option>`).join("")}</select></div>
      <div class="fg" style="justify-content:flex-end"><button class="btn" id="msSet" type="button">Use this scale</button></div></div>
    <div class="small" id="msInfo" style="margin-top:4px;min-height:1.2em"></div>
    <p style="margin-top:12px"><b>Viewports</b> <span class="small">— parts of this sheet drawn at another scale (enlarged details, sections). Measurements inside one use its scale.</span></p>
    ${((P.proj.viewports || {})[S.key] || []).map(v => `<div class="cand"><b>${esc(v.name)}</b><span class="small">${v.ptPerFt ? esc(v.text || "1 ft = " + v.ptPerFt.toFixed(3) + " pt") : "scale not set"}</span><span style="flex:1"></span><button class="btn sm" data-vpcal="${esc(v.id)}">Calibrate</button><button class="btn sm dng" data-vpdel="${esc(v.id)}">Delete</button></div>`).join("") || '<p class="small">None on this page.</p>'}`;
  $("dlgT").textContent = "Page scale"; $("dlgB").innerHTML = body;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button><button class="btn" id="dlgVp">+ Viewport…</button>${sc ? '<button class="btn" id="dlgAll">Copy scale to…</button><button class="btn" id="dlgVer">Verify…</button>' : ""}${sc ? '<button class="btn" id="dlgChk" title="Compare the scale with the room sizes written on the drawing">Check vs room sizes</button>' : ""}<button class="btn pri" id="dlgCal">Calibrate…</button>`;
  $("dlgBack").classList.add("on");
  const close = () => $("dlgBack").classList.remove("on");
  $("dlgCancel").onclick = close;
  $("dlgCal").onclick = () => { close(); S.calVp = null; setTool("cal"); };
  if ($("dlgChk")) $("dlgChk").onclick = async () => { close(); const sc2 = P.proj.scales[S.key]; if (sc2) { delete sc2.doubt; sc2.verified = false; } busy("Checking the scale against the room sizes…"); const r = await checkScale(S.key, true); busy("");
    if (!r) toast("Not enough written room sizes on this page to check the scale — verify with a known dimension", 5000); else if (r.ok) toast("Scale agrees with " + r.ev.agree + " written room sizes (1 ft = " + r.ev.ptPerFt.toFixed(2) + " pt measured)", 5000); };
  $("dlgVp").onclick = () => { close(); setTool("vp"); toast("Click two opposite corners of the part drawn at another scale"); };
  $("dlgB").querySelectorAll("[data-vpdel]").forEach(b => b.onclick = () => { mutate(() => { P.proj.viewports[S.key] = P.proj.viewports[S.key].filter(v => v.id !== b.dataset.vpdel); }); close(); scaleDialog(); });
  $("dlgB").querySelectorAll("[data-vpcal]").forEach(b => b.onclick = () => { close(); S.calVp = b.dataset.vpcal; setTool("cal"); toast("Click both ends of a known dimension inside the viewport"); });
  if (sc) {
    $("dlgVer").onclick = () => { close(); S.verify = true; setTool("measure"); toast("Measure a dimension you know, then press Enter"); };
    $("dlgAll").onclick = () => { close(); copyScaleDialog(); };
  }
  const manRead = () => { const t = $("msTxt").value.trim() || $("msSel").value, sc2 = t ? inPerFtOf(t, true) : {v: 0}, paper = $("msPaper").value;
    if (!t) return {err: ""}; if (!(sc2.v > 0) || sc2.v > 12 * 10) return {err: "Write it like 1/4\" = 1'-0\", 1\" = 20' or 1:100"};
    const f = paper ? Math.max(S.base.width, S.base.height) / PAPER[paper] : 1;
    return {ptPerFt: 72 * sc2.v * f, label: sc2.label + (paper ? " @ " + paper : ""), f, paper}; };
  const manShow = () => { const r = manRead(); $("msInfo").innerHTML = r.err != null ? (r.err ? `<span style="color:var(--red)">${esc(r.err)}</span>` : "") : `1 ft = <b>${r.ptPerFt.toFixed(4)} pt</b> on this page${r.paper ? " (× " + r.f.toFixed(3) + " for " + esc(r.paper) + " printed on this page)" : ""} — marked not verified until a known dimension is measured`; };
  ["msSel", "msPaper"].forEach(id => $(id).addEventListener("change", () => { if (id === "msSel") $("msTxt").value = ""; manShow(); })); $("msTxt").addEventListener("input", manShow);
  $("msSet").onclick = () => { const r = manRead(); if (r.err != null) { $("msInfo").innerHTML = `<span style="color:var(--red)">${esc(r.err || "Pick or type a scale first")}</span>`; return; }
    close(); mutate(() => { P.proj.scales[S.key] = {ptPerFt: r.ptPerFt, how: "manual", text: r.label, note: r.paper ? "drawn for " + r.paper + ", this PDF page is × " + r.f.toFixed(3) : "", factor: r.f, verified: false, at: new Date().toISOString()}; }, "Scale " + r.label);
    toast("Scale set: " + r.label + " — verify it with a dimension printed on the drawing (scale chip → Verify)", 4500); };
  $("dlgB").querySelectorAll("[data-pv]").forEach(el => el.onclick = () => { const v = pv[+el.dataset.pv]; close();
    mutate(() => { P.proj.scales[S.key] = {ptPerFt: v.ptPerFt, how: "pdf", text: v.label, note: "scale saved in the PDF" + (v.name ? " (viewport “" + v.name + "”)" : ""), factor: 1, verified: false, at: new Date().toISOString()}; }, "Scale " + v.label);
    toast("Scale set from the PDF: " + v.label + " — verify it with a dimension printed on the drawing", 4500); });
  $("dlgB").querySelectorAll("[data-cand]").forEach(el => el.onclick = () => { const c = cands[+el.dataset.cand]; close(); mutate(() => { P.proj.scales[S.key] = {ptPerFt: c.ptPerFt, how: "note", text: c.text, note: c.note || "", factor: c.factor || 1, verified: false, at: new Date().toISOString()}; }); });
}
async function verifyMeasure(){
  const k = curScale(), m = S.measure; if (!k || !m || m.length < 2) return;
  const meas = polyLen(m) / k;
  const v = await ask("Verify the scale", `<p>Measured on the drawing: <b>${f3(meas)} ft</b>.</p><div class="grid" style="margin-top:8px"><div class="fg w2"><label>The dimension printed on the drawing (ft or ft-in)</label><input type="text" id="dlgLen"></div></div>`,
    "Check", () => { const ft = parseFt($("dlgLen").value); return ft > 0 ? ft : "Enter the printed dimension"; }, "dlgLen");
  S.verify = false;
  if (!v) return;
  const err = (meas - v) / v * 100;
  if (Math.abs(err) <= 1) { mutate(() => { P.proj.scales[S.key].verified = true; P.proj.scales[S.key].check = {measured: r3(meas), printed: r3(v), at: new Date().toISOString()}; }); toast("Scale verified: " + f3(meas) + " ft measured vs " + f3(v) + " ft printed (" + err.toFixed(2) + "%)", 4000); }
  else {
    const fix = await ask("Scale does not agree", `<p>Measured <b>${f3(meas)} ft</b> against <b>${f3(v)} ft</b> printed — off by <b>${err.toFixed(1)}%</b>. The PDF is probably not at the drawing's paper size.</p><p class="small">Recalibrate this page from this measurement?</p>`, "Recalibrate");
    if (fix) mutate(() => { const kk = polyLen(m) / v; P.proj.scales[S.key] = {ptPerFt: kk, how: "calibrated", text: f3(v) + " ft over " + polyLen(m).toFixed(2) + " pt", cal: {pts: m, ft: v, page: S.key}, verified: true, at: new Date().toISOString()}; });
  }
  S.measure = null; setTool("select");
}

/* ------------------------------------------------------------------ exports */
function sheetRows(){
  const out = [];
  P.proj.conds.forEach(c => {
    const its = P.proj.items.filter(i => i.cond === c.id); if (!its.length) return;
    const rows = [];
    its.forEach(it => { const k = itemScale(it); if (!k) return; rowsOf(it, k).forEach((r, i) => rows.push({r, it, i})); });
    out.push({c, rows, t: condTotals(c)});
  });
  return out;
}
function loadExcel(){ return window.ExcelJS ? Promise.resolve(window.ExcelJS) : new Promise((ok, bad) => { const s = document.createElement("script"); s.src = EXCELJS; s.onload = () => ok(window.ExcelJS); s.onerror = () => bad(new Error("Excel library could not be loaded (offline?) — use CSV")); document.head.appendChild(s); }); }
function saveBlob(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
const fileBase = () => (P.proj.name || "takeoff").replace(/[^A-Za-z0-9]+/g, "_") + "_" + today();
function rowDesc(x){ const {r, it, i} = x, c = cond(it.cond); return (r.sign < 0 ? "Ded. " : "") + (it.label || kindName(it, c)) + (r.part ? " — part " + String.fromCharCode(96 + r.part) : "") + (r.below ? " (≤ " + f2(+c.dedMin || 0) + " — not deducted)" : "") + (r.how === "poly" ? " (plan area, " + r.sides + "-sided outline — area in the L column)" : r.how === "circle" ? " (circle dia " + f3(r.D) + " ft" + (r.A != null ? ", π/4 × D² — area in the L column)" : ", π × D)") : ""); }
async function exportExcel(){
  busy("Building Excel…");
  try {
    const X = await loadExcel(), wb = new X.Workbook(); wb.creator = "ZD PDF Takeoff"; wb.created = new Date();
    const BLUE = {type: "pattern", pattern: "solid", fgColor: {argb: "FFDDEBFF"}}, GREEN = {type: "pattern", pattern: "solid", fgColor: {argb: "FFE2F4E8"}},
          GREY = {type: "pattern", pattern: "solid", fgColor: {argb: "FFE6E9EE"}}, YELLOW = {type: "pattern", pattern: "solid", fgColor: {argb: "FFFFF2C2"}}, HEAD = {type: "pattern", pattern: "solid", fgColor: {argb: "FF12263F"}};
    const ws = wb.addWorksheet("Measurement", {views: [{state: "frozen", ySplit: 4}], pageSetup: {paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0}});
    ws.columns = [{width: 6}, {width: 48}, {width: 16}, {width: 8}, {width: 11}, {width: 11}, {width: 11}, {width: 13}, {width: 7}, {width: 26}, {width: 22}];
    ws.mergeCells("A1:I1"); ws.getCell("A1").value = "MEASUREMENT SHEET — " + P.proj.name; ws.getCell("A1").font = {bold: true, size: 13};
    ws.mergeCells("A2:I2"); ws.getCell("A2").value = "PDF takeoff · " + dmy(today()) + " · decimal feet · Qty = Nos × L × W × H (blank = not used) · deductions as negative rows";
    ws.getCell("A2").font = {size: 9, color: {argb: "FF52514E"}};
    ws.mergeCells("A3:I3"); ws.getCell("A3").value = "Blue = measured / input · green = formula · grey = totals · yellow = check (see Assumptions)"; ws.getCell("A3").font = {size: 9, color: {argb: "FF52514E"}};
    const hr = ws.getRow(4); hr.values = ["S.No", "Description", "Drawing / page", "Nos", "L (ft) / Area", "W (ft)", "H (ft)", "Qty", "Unit", "Location", "QA"];
    hr.font = {bold: true, color: {argb: "FFFFFFFF"}}; hr.eachCell(c => { c.fill = HEAD; });
    let row = 5, sn = 0; const totals = [];
    for (const g of sheetRows()) {
      const head = ws.getRow(row); head.values = ["", (g.c.boq ? g.c.boq + " — " : "") + g.c.name + " (" + g.c.unit + ")" + (g.c.type === "linear" && g.c.unit !== "ft" ? " — H " + f3(+g.c.h) + " ft" + (g.c.t ? ", T " + f3(+g.c.t) + " ft" : "") + ((+g.c.faces || 1) > 1 ? ", " + g.c.faces + " faces" : "") : g.c.unit === "cft" ? " — T " + f3(+g.c.t) + " ft" : "")];
      head.font = {bold: true}; for (let n = 1; n <= 9; n++) head.getCell(n).fill = GREY;
      const first = ++row;
      g.rows.forEach(x => {
        const {r, it, i} = x, rr = ws.getRow(row);
        rr.getCell(1).value = i === 0 ? ++sn : null;
        rr.getCell(2).value = rowDesc(x);
        rr.getCell(3).value = pageName(it);
        [r.nos, r.A != null ? r.A : r.L, r.W, r.H].forEach((v, j) => {
          const cell = rr.getCell(4 + j);
          if (j === 1 && r.runs && r.runs.length > 1) cell.value = {formula: r.runs.map(f3).join("+"), result: r.L};
          else cell.value = v == null ? null : v;
          if (v != null) { cell.fill = BLUE; cell.numFmt = j === 0 ? "0.###" : "0.000"; cell.protection = {locked: false}; }
        });
        const q = rr.getCell(8);
        q.value = r.below ? {formula: "0", result: 0} : {formula: (r.sign < 0 ? "-" : "") + `PRODUCT(D${row}:G${row})`, result: r.qty};
        q.fill = r.below ? YELLOW : GREEN; q.numFmt = qFmt(r.unit);
        rr.getCell(9).value = r.unit;
        if (i === 0) { rr.getCell(10).value = locText(locOf(it)); rr.getCell(11).value = QA_NAMES[it.qa || ""] + (it.qa === "checked" ? " — " + it.qaBy + ", " + dmy(it.qaAt) : "") + (it.ai && it.qa !== "checked" ? " · AI-generated" : "") + (it.copied && it.qa !== "checked" ? " · copied, not checked" : "");
          if (it.qa !== "checked") rr.getCell(11).fill = YELLOW; }
        if (r.sign < 0) rr.font = {color: {argb: "FFB32D2D"}};
        row++;
      });
      const tr = ws.getRow(row); tr.getCell(2).value = "Total " + g.c.name; tr.getCell(9).value = g.c.unit;
      tr.getCell(8).value = {formula: `SUM(H${first}:H${row - 1})`, result: g.t.net}; tr.getCell(8).numFmt = qFmt(g.c.unit);
      tr.font = {bold: true}; for (let n = 1; n <= 9; n++) tr.getCell(n).fill = GREY;
      totals.push({c: g.c, cell: "H" + row, t: g.t}); row++;
    }
    await ws.protect("", {selectLockedCells: true, selectUnlockedCells: true, formatColumns: true});
    const bl = wb.addWorksheet("Bill");
    bl.columns = [{header: "S.No", width: 6}, {header: "BOQ code", width: 13}, {header: "Item", width: 46}, {header: "Formula", width: 18}, {header: "Qty", width: 13}, {header: "Unit", width: 8}, {header: "Rate PKR", width: 13}, {header: "Amount PKR", width: 15}, {header: "RA code", width: 13}, {header: "Rate source / date", width: 60}];
    bl.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; bl.getRow(1).eachCell(c2 => { c2.fill = HEAD; });
    let bn = 0, br = 2; const BL = billLines();
    BL.forEach(l => { const r = bl.addRow([l.kind === "cond" ? ++bn : "", l.boq || "", (l.kind === "asm" ? "   " : "") + l.name, l.kind === "asm" ? l.f : "measured", +l.qty.toFixed(3), l.unit, l.rate || 0, {formula: `E${br}*G${br}`, result: l.qty * (l.rate || 0)}, l.ra || "",
        l.na ? l.na : l.rate ? (rateOk(l) ? l.src + (l.ra ? "" : ", " + dmy(l.date)) : "ASSUMPTION — no dated source") : "rate not set"]);
      r.getCell(5).numFmt = qFmt(l.unit); r.getCell(7).numFmt = "#,##0.00"; r.getCell(8).numFmt = "#,##0.00"; r.getCell(5).fill = GREEN; r.getCell(7).fill = BLUE; r.getCell(8).fill = GREEN;
      if (l.kind === "cond") r.font = {bold: true}; if (!rateOk(l) || !(l.rate > 0)) r.getCell(10).fill = YELLOW; br++; });
    const bt = bl.addRow(["", "", "Total", "", "", "", "", {formula: `SUM(H2:H${br - 1})`, result: BL.reduce((a, l) => a + l.qty * (l.rate || 0), 0)}]); bt.font = {bold: true}; bt.getCell(8).numFmt = "#,##0.00"; bt.eachCell(c2 => { c2.fill = GREY; });
    const lc = wb.addWorksheet("By location");
    lc.columns = [{header: "Building / floor", width: 26}, {header: "BOQ code", width: 13}, {header: "Item", width: 46}, {header: "Qty", width: 13}, {header: "Unit", width: 8}, {header: "Rate PKR", width: 13}, {header: "Amount PKR", width: 15}];
    lc.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; lc.getRow(1).eachCell(c2 => { c2.fill = HEAD; });
    floorGroups().forEach(g => billLines(g.only).forEach(l => { const r = lc.addRow([g.name, l.boq || "", (l.kind === "asm" ? "   " : "") + l.name, +l.qty.toFixed(3), l.unit, l.rate || 0, {formula: `D${lc.rowCount + 1}*F${lc.rowCount + 1}`, result: l.qty * (l.rate || 0)}]);
      r.getCell(4).numFmt = "#,##0.000"; r.getCell(6).numFmt = "#,##0.00"; r.getCell(7).numFmt = "#,##0.00"; }));
    if ((P.proj.openings || []).length) {
      const os = wb.addWorksheet("Openings");
      os.columns = [{header: "Mark", width: 10}, {header: "Type", width: 10}, {header: "Width ft", width: 11}, {header: "Height ft", width: 11}, {header: "Area Sft", width: 11}, {header: "Placed", width: 9}];
      os.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; os.getRow(1).eachCell(c2 => { c2.fill = HEAD; });
      P.proj.openings.forEach(o => { const r = os.addRow([o.mark, o.type, +o.w, +o.h, {formula: `C${os.rowCount + 1}*D${os.rowCount + 1}`, result: o.w * o.h}, P.proj.items.filter(i => i.sch === o.id).length]); r.getCell(3).numFmt = "0.000"; r.getCell(4).numFmt = "0.000"; r.getCell(5).numFmt = "#,##0.000"; });
    }
    const V = validation(), vs = wb.addWorksheet("Validation");
    vs.columns = [{header: "Status", width: 12}, {header: "Check — " + V.lvl, width: 110}];
    vs.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; vs.getRow(1).eachCell(c2 => { c2.fill = HEAD; });
    (V.L.length ? V.L : [{lvl: "PASS", msg: "No errors or warnings"}]).forEach(x => { const r = vs.addRow([x.lvl, x.msg]); r.getCell(1).font = {bold: true, color: {argb: x.lvl === "ERROR" ? "FFB32D2D" : x.lvl === "WARNING" ? "FF8A5A00" : "FF16723F"}}; });
    const sm = wb.addWorksheet("Summary");
    sm.columns = [{header: "Condition", width: 48}, {header: "Qty", width: 14}, {header: "Unit", width: 8}, {header: "Measurements", width: 14}];
    sm.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; sm.getRow(1).eachCell(c => { c.fill = HEAD; });
    totals.forEach(t => { const r = sm.addRow([t.c.name, {formula: "Measurement!" + t.cell, result: t.t.net}, t.c.unit, P.proj.items.filter(i => i.cond === t.c.id).length]); r.getCell(2).numFmt = qFmt(t.c.unit); r.getCell(2).fill = GREEN; });
    const au = wb.addWorksheet("Scale & audit");
    au.columns = [{header: "Drawing", width: 34}, {header: "Page", width: 7}, {header: "Scale", width: 26}, {header: "1 ft on the sheet (pt)", width: 18}, {header: "How", width: 12}, {header: "Verified", width: 10}, {header: "Check", width: 40}, {header: "Status", width: 26}];
    au.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; au.getRow(1).eachCell(c => { c.fill = HEAD; });
    Object.entries(P.proj.scales).forEach(([kk, sc]) => { const [fid, pg] = kk.split(":"), f = P.proj.files.find(x => x.id === fid); if (!f) return;
      const r = au.addRow([f.name, +pg, sc.how === "calibrated" ? "calibrated: " + sc.text : sc.text, +sc.ptPerFt.toFixed(5), sc.how === "note" ? "scale note" : sc.how === "pdf" ? "PDF scale data" : sc.how === "inherited" ? "inherited" : sc.how === "manual" ? "chosen" : "calibrated", sc.verified ? "yes" : "NO", sc.check ? `measured ${f3(sc.check.measured)} ft vs printed ${f3(sc.check.printed)} ft` : sc.note || "", scaleState(sc).t]);
      if (!sc.verified) r.eachCell(c => { c.fill = YELLOW; }); });
    const as = wb.addWorksheet("Assumptions");
    as.columns = [{header: "#", width: 5}, {header: "Item to confirm", width: 90}];
    as.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; as.getRow(1).eachCell(c => { c.fill = HEAD; });
    let an = 0;
    Object.entries(P.proj.scales).forEach(([kk, sc]) => { if (!sc.verified) { const [fid, pg] = kk.split(":"), f = P.proj.files.find(x => x.id === fid); as.addRow([++an, `Scale of ${f ? f.name : fid} p.${pg} ${sc.how === "manual" ? "chosen by hand" : sc.how === "inherited" ? "copied from another page" : sc.how === "pdf" ? "read from the scale saved in the PDF" : "read from its note"} (${sc.text}) and not checked against a printed dimension`]).getCell(2).fill = YELLOW; } });
    P.proj.conds.filter(c => c.h || c.t).forEach(c => as.addRow([++an, `${c.name}: ${c.h ? "height H " + f3(+c.h) + " ft" : ""}${c.h && c.t ? ", " : ""}${c.t ? "thickness T " + f3(+c.t) + " ft" : ""} entered for the condition — confirm against the sections`]));
    P.proj.items.filter(i => i.kind === "open").forEach(i => as.addRow([++an, `Opening ${i.label || ""} on ${pageName(i)}: height ${f3(+i.oh || 0)} ft entered — confirm against the door / window schedule`]));
    if (!an) as.addRow([1, "None"]);
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), fileBase() + "_Measurement.xlsx");
  } catch (e) { toast(e.message || String(e), 5000); }
  busy("");
}
const isNos = u => /^\s*nos?\.?\s*$/i.test(String(u || ""));
const qFmt = u => isNos(u) ? "#,##0" : "#,##0.000";   // Excel: quantities 3 dp, Nos whole
const qCsv = (v, u) => { v = +v || 0; const x = isNos(u) && Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Math.round(v * 1000) / 1000; return (x === 0 ? 0 : x).toFixed(isNos(u) && Number.isInteger(x) ? 0 : 3); };
function exportCsv(){
  const rows = [["S.No", "Condition", "Description", "Drawing / page", "Nos", "L (ft) / Area (Sft)", "W (ft)", "H (ft)", "Qty", "Unit", "BOQ code", "Location", "QA"]];
  let sn = 0;
  sheetRows().forEach(g => { g.rows.forEach(x => { const r = x.r; rows.push([x.i === 0 ? ++sn : "", g.c.name, rowDesc(x), pageName(x.it), r.nos ?? "", r.A != null ? f3(r.A) : r.L == null ? "" : f3(r.L), r.W == null ? "" : f3(r.W), r.H == null ? "" : f3(r.H), qCsv(r.qty, r.unit), r.unit, g.c.boq || "", x.i === 0 ? locText(locOf(x.it)) : "", x.i === 0 ? QA_NAMES[x.it.qa || ""] + (x.it.ai && x.it.qa !== "checked" ? " · AI" : "") + (x.it.copied && x.it.qa !== "checked" ? " · copied" : "") : ""]); });
    rows.push(["", g.c.name, "Total " + g.c.name, "", "", "", "", "", qCsv(g.t.net, g.c.unit), g.c.unit, g.c.boq || "", "", ""]); });
  const t = rows.map(r => r.map(v => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n");
  saveBlob(new Blob(["﻿" + t], {type: "text/csv;charset=utf-8"}), fileBase() + "_Measurement.csv");
}
/* the takeoff of one page as an SVG over the page at scale sc (pt -> px): areas, lengths, counts, labels, markups, legend.
   legend: true / false (the legend top left), or the export options {legend: none|tl|tr|bl|br|margin, lsz: s|m|l, lq,
   lbl, meas, mk, stamp, conds: Set of condition ids, ox: the margin strip's width in px (the page is drawn right of it)} */
function pageOverlaySvg(file, page, sc, W, H, legend){ const ex0 = S.mkExport; S.mkExport = true; try { return pageOverlaySvg0(file, page, sc, W, H, legend); } finally { S.mkExport = ex0; } }
function pageOverlaySvg0(file, page, sc, W, H, legend){
  const o = legend && typeof legend === "object" ? legend : {legend: legend ? "tl" : "none"}, ox = +o.ox || 0, lblOn = o.lbl == null ? S.lbl.on : !!o.lbl;
  const T = p => [p[0] * sc + ox, p[1] * sc], z = Math.max(1, sc / 1.6), h = [];
  const ps = P => P.map(p => T(p).map(v => v.toFixed(1)).join(",")).join(" ");
  const tot = {}, shown = it => o.conds ? o.conds.has(it.cond) : !hiddenItem(it);
  if (ox) h.push(`<rect x="0" y="0" width="${ox.toFixed(1)}" height="${H}" fill="#fff"/><line x1="${ox.toFixed(1)}" y1="0" x2="${ox.toFixed(1)}" y2="${H}" stroke="#9fb0c6" stroke-width="${z}"/>`);
  if (o.meas !== false) P.proj.items.filter(i => i.file === file && i.page === page && shown(i)).forEach(it => {
    const c = cond(it.cond); if (!c) return;
    const k = itemScale(it), rows = k ? rowsOf(it, k) : [], q = rows.reduce((a, r) => a + r.qty, 0), col = c.color, ded = it.kind === "ded";
    tot[c.id] = (tot[c.id] || 0) + q;
    if (c.type === "count") { h.push(countSvg(c, it.pts, T, z, -1)); return; }
    if (it.kind === "open") { const a = T(it.pts[0]), b = T(it.pts[1]); h.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d03b3b" stroke-width="${4 * z}" stroke-linecap="round"/>`); return; }
    const poly = itemPoly(it);
    if (c.type === "area") {
      h.push(`<polygon points="${ps(poly)}" fill="${ded ? "#d03b3b" : col}" fill-opacity="${ded ? 0.14 : 0.22}" stroke="${ded ? "#d03b3b" : col}" stroke-width="${1.8 * z}" ${ded ? `stroke-dasharray="${5 * z} ${3 * z}"` : ""}/>`);
      if (k && lblOn) { const scr = poly.map(T), L = capLines(it, c, k); if (L.length) h.push(labelBox(labelPt(scr), L, ded ? "#9b2222" : "#0b0b0b", z)); if (S.lbl.seg && it.shape !== "circle") h.push(segLabels(scr, it.pts, k, true, z)); }
    } else {
      h.push(`<poly${it.shape === "circle" ? "gon" : "line"} points="${ps(poly)}" fill="none" stroke="${ded ? "#d03b3b" : col}" stroke-width="${3 * z}" stroke-linejoin="round" stroke-linecap="round" ${ded ? `stroke-dasharray="${7 * z} ${4 * z}"` : ""}/>`);
      if (k && lblOn) { const scr = poly.map(T), L = capLines(it, c, k), m = lineLabelPt(scr, z); if (L.length) h.push(labelBox(m, L, ded ? "#9b2222" : "#0b0b0b", z)); if (S.lbl.seg && it.shape !== "circle") h.push(segLabels(scr, it.pts, k, false, z)); }
    }
  });
  if (o.mk !== false) (P.proj.marks || []).filter(m => m.file === file && m.page === page && m.type !== "fence" && (!mkHidden(m) || m.type === "redact")).forEach(m => h.push(markSvg(Object.assign({}, m, {id: ""}), T, z)));
  const sh = (P.proj.sheets || {})[keyOf(file, page)] || {}, lz = z * ({s: 0.8, m: 1, l: 1.3}[o.lsz] || 1), pos = o.legend || "none";
  if (pos !== "none") {
    const lines = (pos === "margin" ? [[P.proj.name, "", 700], [[sh.no, sh.title].filter(Boolean).join(" · ") || pageName({file, page}), "", 600], [pageName({file, page}), "", 400]].filter((l, i) => i < 2 || sh.no || sh.title)
      : [[P.proj.name + " — " + pageName({file, page}), "", 700]]).concat(P.proj.conds.filter(c => tot[c.id] !== undefined).map(c => [c.name + (o.lq === false ? "" : ": " + fq(tot[c.id], c.unit) + " " + c.unit), c.color, 400]));
    const cw = 6.6 * lz, room = pos === "margin" ? Math.max(8, Math.floor((ox - 46 * lz) / cw)) : 200, txt = l => l[0].length > room ? l[0].slice(0, room - 1) + "…" : l[0];
    const lw = pos === "margin" ? ox - 16 * lz : Math.max(...lines.map(l => txt(l).length)) * cw + 30 * lz, lh = (lines.length * 17 + 10) * lz;
    const x = pos === "margin" ? 8 * lz : pos === "tr" || pos === "br" ? W - lw - 8 * z : ox + 8 * z, y = pos === "bl" || pos === "br" ? H - lh - 8 * z : 8 * z;
    h.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" fill="rgba(255,255,255,.93)" stroke="#c9d6e4"/>`);
    lines.forEach((l, i) => { const ty = y + (16 + i * 17) * lz; if (l[1]) h.push(`<rect x="${(x + 8 * lz).toFixed(1)}" y="${(ty - 9 * lz).toFixed(1)}" width="${9 * lz}" height="${9 * lz}" fill="${l[1]}"/>`);
      h.push(`<text x="${(x + (l[1] ? 22 : 8) * lz).toFixed(1)}" y="${ty.toFixed(1)}" font-family="Segoe UI,Arial" font-size="${12 * lz}" font-weight="${l[2]}" fill="#0b0b0b">${esc(txt(l))}</text>`); });
  }
  if (o.stamp) {   // project · sheet · page · date, along the bottom of the drawing
    const t = [P.proj.name, [sh.no, sh.title].filter(Boolean).join(" "), pageName({file, page}), "takeoff " + dmy(today())].filter(Boolean).join("  ·  "), sw = t.length * 5.9 * z + 16 * z, sx = pos === "bl" ? W - sw - 8 * z : ox + 8 * z, sy = H - 26 * z;
    h.push(`<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${18 * z}" fill="rgba(255,255,255,.93)" stroke="#c9d6e4"/><text x="${(sx + 8 * z).toFixed(1)}" y="${(sy + 13 * z).toFixed(1)}" font-family="Segoe UI,Arial" font-size="${10.5 * z}" fill="#33475b">${esc(t)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${h.join("")}</svg>`;
}
async function svgOnto(ctx, svg){ const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode(); ctx.drawImage(img, 0, 0); }
async function exportPng(){
  if (!S.page) return;
  busy("Rendering marked-up page…");
  try {
    const sc = Math.min(4, 6000 / Math.max(S.base.width, S.base.height)), vp = S.page.getViewport({scale: sc}), cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await sliced(S.page.render({...lay(S.fileId), canvasContext: ctx, viewport: vp})).promise;
    await mkAssetsFor(S.fileId, S.pageNo); await svgOnto(ctx, pageOverlaySvg(S.fileId, S.pageNo, sc, cv.width, cv.height, true));
    cv.toBlob(b => saveBlob(b, fileBase() + "_p" + S.pageNo + "_markup.png"), "image/png");
  } catch (e) { toast(e.message || String(e), 5000); }
  busy("");
}
/* The source page stays vector (sharp at any zoom); its takeoff goes on top as a transparent image. All-pages export
   includes unmarked sheets too. Rotated or encrypted pages are flattened to an image instead. */
const PDFLIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
function loadPdfLib(){ return window.PDFLib ? Promise.resolve(window.PDFLib) : new Promise((ok, bad) => { const s2 = document.createElement("script"); s2.src = PDFLIB; s2.onload = () => ok(window.PDFLib); s2.onerror = () => bad(new Error("PDF library could not be loaded (offline?)")); document.head.appendChild(s2); }); }
async function exportPdf(all){
  if (!all && !S.page) return;
  busy("Building marked-up PDF…");
  try {
    const L = await loadPdfLib(), out = await L.PDFDocument.create();
    const pages = all ? allPages().map(o => ({f: o.f.id, p: o.i})) : [{f: S.fileId, p: S.pageNo}];
    if (!pages.length) throw new Error("There are no project sheets to export");
    const srcCache = {}, linkQ = [], byKey = {};
    for (const {f, p} of pages) {
      busy("Building marked-up PDF… page " + (pages.findIndex(x => x.f === f && x.p === p) + 1) + " of " + pages.length);
      const pg = await (await doc(f)).getPage(p), base = pg.getViewport({scale: 1}), sc = Math.min(3, 4000 / Math.max(base.width, base.height));
      const W = Math.ceil(base.width * sc), H = Math.ceil(base.height * sc), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      if (!srcCache[f]) { const rec = await dbGet("pdfs", f); srcCache[f] = await L.PDFDocument.load(rec.data.slice(0), {ignoreEncryption: true}); }
      const flat = pg.rotate % 360 !== 0 || srcCache[f].isEncrypted || mkRedacted(f, p);   // an encrypted PDF cannot be copied page for page (its content would stay encrypted), and a redacted page must lose what is under the redaction: flattened like a turned page
      if (flat) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); await loadLayers(f); await sliced(pg.render({...lay(f), canvasContext: ctx, viewport: pg.getViewport({scale: sc})})).promise; }
      await mkAssetsFor(f, p); await svgOnto(ctx, pageOverlaySvg(f, p, sc, W, H, true));
      const png = await out.embedPng(await (await new Promise(r => cv.toBlob(r, "image/png"))).arrayBuffer());
      if (flat) { const np = out.addPage([base.width, base.height]); np.drawImage(png, {x: 0, y: 0, width: base.width, height: base.height}); byKey[keyOf(f, p)] = np; mkPdfLinks(L, out, np, f, p, (x, y) => [x, base.height - y], linkQ); continue; }
      const [cp] = await out.copyPages(srcCache[f], [p - 1]); out.addPage(cp);
      const vb = pg.view;   // [x0, y0, x1, y1] of the shown box, in PDF space
      cp.drawImage(png, {x: vb[0], y: vb[1], width: vb[2] - vb[0], height: vb[3] - vb[1]});
      byKey[keyOf(f, p)] = cp; mkPdfLinks(L, out, cp, f, p, (x, y) => [vb[0] + x, vb[3] - y], linkQ);
    }
    mkPdfLinksDone(out, linkQ, byKey); await mkPdfAttach(out, new Set(pages.map(x => keyOf(x.f, x.p))));
    ocFix(L, out, pages.map(x => x.f));
    saveBlob(new Blob([await out.save()], {type: "application/pdf"}), fileBase() + (all ? "_takeoff" : "_p" + S.pageNo + "_markup") + ".pdf");
  } catch (e) { toast("PDF export failed: " + (e.message || e), 6000); }
  busy("");
}
function exportJson(){ saveBlob(new Blob([JSON.stringify(Object.assign({format: "zd-takeoff", exported: new Date().toISOString()}, P.proj), null, 1)], {type: "application/json"}), fileBase() + ".takeoff.json"); }
/* Project + PDFs in one file, to move a takeoff to another browser or computer with its drawings:
   "ZDTAKEOFF-BUNDLE-1\n", a 4-byte length, a JSON header (the project and each PDF's name, size, fingerprint, place), then the PDFs */
const BUNDLE_MAGIC = "ZDTAKEOFF-BUNDLE-1\n";
async function exportBundle(){
  savePr = P.proj; await flushSave();
  busy("Packing the project and its PDFs…");
  try {
    const exported = new Date().toISOString(), parts = [], pdfs = [], miss = []; let off = 0;
    for (const f of P.proj.files) {
      const rec = await dbGet("pdfs", f.id); if (!rec) { miss.push(f.name); continue; }
      const sha = rec.src ? rec.pdfSha || await sha256(rec.data) : rec.sha || await sha256(rec.data), e = {id: f.id, name: f.name, size: rec.data.byteLength, sha, off};
      parts.push(rec.data); off += rec.data.byteLength;
      if (rec.src) { e.srcSha = rec.sha || await sha256(rec.src); e.srcOff = off; e.srcSize = rec.src.byteLength; parts.push(rec.src); off += rec.src.byteLength; }   // the DWG / DXF too
      pdfs.push(e);
    }
    const assets = [];   // pictures and files of markups
    for (const aid of [...new Set((P.proj.marks || []).flatMap(mkAids))]) { const r = await assetRec(aid); if (!r || !r.data) continue; assets.push({aid, name: r.name, type: r.type, size: r.data.byteLength, off}); parts.push(r.data); off += r.data.byteLength; }
    const head = new TextEncoder().encode(JSON.stringify({format: "zd-takeoff-bundle", exported, project: Object.assign({format: "zd-takeoff", exported}, P.proj), pdfs, assets}));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
    saveBlob(new Blob([BUNDLE_MAGIC, len, head, ...parts], {type: "application/octet-stream"}), fileBase() + ".zdtakeoff");
    toast(miss.length ? "Saved without " + miss.join(", ") + " — not in this browser (add it with + PDF first)" : "Project + " + pdfs.length + " PDF" + (pdfs.length === 1 ? "" : "s") + " saved in one file — open it with Import project", miss.length ? 7000 : 4000);
  } catch (e) { toast("Export failed: " + (e.message || e), 6000); }
  busy("");
}
function isBundle(buf){ const m = new TextEncoder().encode(BUNDLE_MAGIC), u = new Uint8Array(buf, 0, Math.min(buf.byteLength, m.length)); return u.length === m.length && m.every((b, i) => u[i] === b); }
async function importBundle(buf){
  const start = BUNDLE_MAGIC.length + 4;
  if (buf.byteLength < start) throw new Error("the file is cut short");
  const hl = new DataView(buf, BUNDLE_MAGIC.length, 4).getUint32(0);
  let h; try { h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, Math.min(hl, buf.byteLength - start)))); } catch (e) { throw new Error("the file is damaged (its header cannot be read)"); }
  if (!h || h.format !== "zd-takeoff-bundle" || !h.project || !Array.isArray(h.pdfs)) throw new Error("not a takeoff project file");
  let text = JSON.stringify(h.project); const base = start + hl, pre = [];
  busy("Unpacking the PDFs…");
  try {
    for (const p of h.pdfs) {
      const a = base + (+p.off || 0), b = a + (+p.size || 0);
      if (!(p.size > 0) || b > buf.byteLength) { pre.push({what: "PDF in the file: " + p.name, a: "1", b: "0", st: "FAIL", note: "cut short — not attached"}); continue; }
      const data = buf.slice(a, b), sha = await sha256(data);
      if (p.sha && sha && sha !== p.sha) { pre.push({what: "PDF in the file: " + p.name, a: "1", b: "0", st: "FAIL", note: "damaged — its fingerprint does not match — not attached"}); continue; }
      let src = null; if (p.srcSize > 0) { const a2 = base + (+p.srcOff || 0), b2 = a2 + +p.srcSize; if (b2 <= buf.byteLength) { src = buf.slice(a2, b2); if (p.srcSha && await sha256(src) !== p.srcSha) src = null; } }
      let id = String(p.id); const have = await pdfSha(id), ident = src ? p.srcSha || sha : sha;
      if (have !== null && have === ident && ident) continue;   // the same drawing is already in this browser
      if (have !== null) { const nid = uid("F"); text = remapFileId(text, id, nid); id = nid; }   // another drawing already uses this id here: this one gets its own
      await dbPut("pdfs", Object.assign({name: p.name, size: src ? src.byteLength : data.byteLength, data, sha: ident}, src ? {src, pdfSha: sha} : {}), id);
    }
    for (const x of Array.isArray(h.assets) ? h.assets : []) {   // pictures and files of markups (kept as they are when already here)
      const a = base + (+x.off || 0), b = a + (+x.size || 0);
      if (!x || typeof x.aid !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(x.aid) || !(x.size > 0) || b > buf.byteLength || await assetRec(x.aid)) continue;
      await dbPut("pdfs", {asset: true, name: String(x.name || "").slice(0, 200), type: String(x.type || "application/octet-stream").slice(0, 100), size: x.size, data: buf.slice(a, b), at: new Date().toISOString()}, assetKey(x.aid));
    }
  } finally { busy(""); }
  if (!pre.length) pre.push({what: "PDFs in the file", a: h.pdfs.length, b: h.pdfs.length, st: "PASS", note: "fingerprints checked"});
  return importProject(text, pre);
}
async function exportMenu(){
  if (!P.proj) return;
  const V = validation(), nE = V.L.filter(x => x.lvl === "ERROR").length, nW = V.L.length - nE;
  $("dlgT").textContent = "Export";
  $("dlgB").innerHTML = `<div class="wide"></div><p><b>Takeoff check: <span style="color:${lvlCol(V.lvl)}">${V.lvl}</span></b>${V.L.length ? ` — ${nE} error${nE === 1 ? "" : "s"}, ${nW} warning${nW === 1 ? "" : "s"}` : " — scales, heights, thicknesses, codes, rates, QA all in order"}</p>
    ${V.L.length ? `<div style="max-height:240px;overflow:auto;margin:6px 0;border:1px solid var(--line);border-radius:6px">${V.L.map(x => `<div style="padding:4px 8px;border-bottom:1px solid #f0f4f8;font-size:12px"><b style="color:${lvlCol(x.lvl)};display:inline-block;width:70px">${x.lvl}</b>${esc(x.msg)}</div>`).join("")}</div>` : ""}
    <p class="small">${V.lvl === "PASS" ? "" : "You can still export; the Excel file carries this list on its Validation sheet. "}Measurement sheet in the house format (Nos × L × W × H, decimal feet, deductions as rows).</p>`;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button><button class="btn" id="exBak">Backups…</button><button class="btn" id="exJson" title="Measurements only — the PDFs are not inside">Project (.json)</button><button class="btn" id="exBnd" title="The project and all its PDFs in one file, to move it to another browser or computer">Project + PDFs</button><button class="btn" id="exPng"${S.page ? "" : " disabled"}>Marked-up page (.png)</button><button class="btn" id="exPdf1"${S.page ? "" : " disabled"}>Marked-up page (.pdf)</button><button class="btn" id="exPdfA" title="Every sheet of the project in one PDF, with or without markups">All project sheets (.pdf)</button>
    <button class="btn pri" id="exPages" title="Choose the pages (this page, pages with takeoff, ticked pages, or any), the format (PDF, a PDF per page, PNG, JPEG), the resolution up to 600 DPI and the legend">&#8681; Pages — PDF / PNG / JPEG…</button><button class="btn" id="exPlot" title="A window, the view or the page on a paper size, at a scale, colour / monochrome — print it or save it as PDF (Ctrl+P)">&#128424; Plot / print…</button><button class="btn" id="exRep" title="A printable takeoff report with a summary, quantities by condition and floor, the bill, the drawings measured and the check — print it or save it as PDF">&#128438; Report (print / PDF)</button><button class="btn" id="exCsv">CSV</button><button class="btn pri" id="exXls">Excel</button>`;
  $("dlgBack").classList.add("on");
  const close = () => $("dlgBack").classList.remove("on");
  $("dlgCancel").onclick = close;
  $("exXls").onclick = () => { close(); exportExcel(); }; $("exCsv").onclick = () => { close(); exportCsv(); };
  $("exPng").onclick = () => { close(); exportPng(); }; $("exPdf1").onclick = () => { close(); exportPdf(false); }; $("exPdfA").onclick = () => { close(); exportPdf(true); }; $("exJson").onclick = () => { close(); exportJson(); }; $("exBnd").onclick = () => { close(); exportBundle(); }; $("exBak").onclick = () => backupsDialog();
  $("exPages").onclick = () => { close(); exportPagesDialog(); }; $("exPlot").onclick = () => { close(); plotDialog(); }; $("exRep").onclick = () => { close(); reportPrint(); };
}

/* ------------------------------------------------------------------ pages manager (Forma Takeoff 2D "Sheets", Bluebeam batch)
   Pages tab: search, filter, sort, pin (bookmark) and tick pages. Ticked pages are exported together — one PDF (each
   drawing stays the original vector page), a PDF per page, or PNG / JPEG at a chosen resolution — with a legend on the
   drawing or in a margin strip, as Forma Takeoff's "Export sheets to PDF". Their sheet no., title, revision and floor are
   read from the title block (Forma "Extract pages and attributes", PlanSwift Auto Bookmark, Bluebeam AutoMark); scanned
   pages are read by OCR. PDFs come in with a choice of pages and a version set; photos and scans come in as pages. */
const PG_SZ = {s: 72, m: 92, l: 150};
function pagesWithTakeoff(){ const s = new Set(); P.proj.items.forEach(i => s.add(keyOf(i.file, i.page))); (P.proj.marks || []).forEach(m => { if (m.type !== "fence") s.add(keyOf(m.file, m.page)); }); return allPages().map(o => o.key).filter(k => s.has(k)); }
function pagesShown(){   // the Pages tab's pages after its search, filter and sort: [{f, i, key, sh, n, tk, pin}]
  const q = String(S.pgQ || "").trim().toLowerCase(), F = S.pgF || "", pins = new Set(P.proj.pins || []), tk = new Set(pagesWithTakeoff()), cnt = new Map();
  P.proj.items.forEach(i => { const k = keyOf(i.file, i.page); cnt.set(k, (cnt.get(k) || 0) + 1); });
  let L = allPages().map(o => Object.assign(o, {sh: (P.proj.sheets || {})[o.key] || {}, n: cnt.get(o.key) || 0, tk: tk.has(o.key), pin: pins.has(o.key)}));
  if (q) L = L.filter(o => [o.f.name, o.sh.no, o.sh.title, o.sh.rev, o.sh.disc, o.sh.bldg, o.sh.floor, o.f.vset, "p." + o.i, "page " + o.i].filter(Boolean).join(" · ").toLowerCase().includes(q));
  const sc = o => P.proj.scales[o.key];
  if (F === "tk") L = L.filter(o => o.tk); else if (F === "none") L = L.filter(o => !o.tk); else if (F === "noscale") L = L.filter(o => !sc(o)); else if (F === "unver") L = L.filter(o => sc(o) && !sc(o).verified);
  else if (F === "pin") L = L.filter(o => o.pin); else if (F === "ocr") L = L.filter(o => P.proj.ocr && P.proj.ocr[o.key]); else if (F.startsWith("set:")) L = L.filter(o => (o.f.vset || "") === F.slice(4));
  const nat = (a, b) => !a && !b ? 0 : !a ? 1 : !b ? -1 : String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: "base"});
  if (S.pgSort === "no") L.sort((a, b) => nat(a.sh.no, b.sh.no)); else if (S.pgSort === "title") L.sort((a, b) => nat(a.sh.title, b.sh.title)); else if (S.pgSort === "n") L.sort((a, b) => b.n - a.n);
  if (S.pgSort) L.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0));   // pinned pages first (a stable sort keeps the order chosen)
  return L;
}
function pgTick(k, on, range){   // tick / untick a page; Shift: every page shown between the last one ticked and this one
  S.pgSel = S.pgSel || new Set(); const L = pagesShown().map(o => o.key);
  if (range && S.pgLast && S.pgLast !== k && L.includes(S.pgLast) && L.includes(k)) { const a = L.indexOf(S.pgLast), b = L.indexOf(k); L.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => { if (on) S.pgSel.add(x); else S.pgSel.delete(x); }); }
  else if (on) S.pgSel.add(k); else S.pgSel.delete(k);
  S.pgLast = k; renderPages();
}
function pgMark(){   // the page being opened is framed in the Pages tab at once (not only after it has been drawn)
  const el = $("pageList"); if (!el) return; const k = S.fileId + "|" + S.pageNo;
  el.querySelectorAll(".pgt").forEach(x => x.classList.toggle("on", x.dataset.pg === k));
}
function pinPages(keys){   // Forma "bookmark": pinned pages come first in the Pages tab
  if (!keys.length) return;
  const pins = new Set(P.proj.pins || []), off = keys.every(k => pins.has(k));
  keys.forEach(k => { if (off) pins.delete(k); else pins.add(k); }); P.proj.pins = [...pins]; save(); renderPages();
  toast(keys.length + " page" + (keys.length > 1 ? "s" : "") + (off ? " unpinned" : " pinned to the top of Pages"), 1800);
}
function pgAct(a){
  const sel = allPages().map(o => o.key).filter(k => S.pgSel.has(k));
  if (a === "export") return exportPagesDialog({keys: sel});
  if (a === "sheet") return autoSheetDialog(sel);
  if (a === "ocr") return ocrDialog(sel);
  if (a === "pin") return pinPages(sel);
  if (a === "clear") { S.pgSel.clear(); return renderPages(); }
  if (a === "tk") { const t = pagesWithTakeoff(); t.forEach(k => S.pgSel.add(k)); if (!t.length) toast("No page has takeoff yet", 2000); return renderPages(); }
}

/* export: one dialog for every page format (Forma "Export sheets to PDF": this sheet / sheets with takeoff / chosen
   sheets, filtered by condition, legend with or without quantities, small / medium / large) */
const EXP_DEF = {fmt: "pdf", dpi: 300, legend: "tl", lsz: "m", lq: true, meas: true, lbl: true, mk: true, stamp: true, fade: 0};
const EXP_STRIP = {s: 170, m: 230, l: 310};   // the margin-strip legend's width, pt
function expPref(){ let o = null; try { o = JSON.parse(pref("zdTakeoffExp") || "null"); } catch (e) { o = null; } return Object.assign({}, EXP_DEF, o && typeof o === "object" ? o : {}); }
async function exportPagesDialog(pre){
  if (!P.proj || !P.proj.files.length) return toast("Add a PDF first");
  pre = pre || {};
  const o = Object.assign(expPref(), pre.fmt ? {fmt: pre.fmt} : {}, pre.dpi ? {dpi: pre.dpi} : {}), all = allPages(), tk = pagesWithTakeoff();
  const sel = pre.keys && pre.keys.length ? pre.keys : all.map(x => x.key).filter(k => (S.pgSel || new Set()).has(k)), tkSet = new Set(tk);
  const SC = {page: S.page ? [S.key] : [], tk, sel, all: all.map(x => x.key)};
  let scope = pre.scope && SC[pre.scope] && SC[pre.scope].length ? pre.scope : sel.length ? "sel" : S.page ? "page" : tk.length ? "tk" : "all";
  const used = P.proj.conds.filter(c => P.proj.items.some(i => i.cond === c.id)), nm = n => n + " page" + (n === 1 ? "" : "s");
  const rad = (v, t, n) => `<label class="pk"><input type="radio" name="xSc" value="${v}"${scope === v ? " checked" : ""}${n === 0 ? " disabled" : ""}> ${t}${n != null ? ` <span class="small">(${nm(n)})</span>` : ""}</label>`;
  const sel1 = (id, L, cur) => `<select id="${id}">${L.map(([v, t]) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select>`;
  const lists = P.proj.files.map(f => `<div class="xpf"><label class="pk" style="font-weight:700"><input type="checkbox" data-xpf="${esc(f.id)}"> ${esc(f.name.replace(/\.pdf$/i, ""))} <span class="small">${f.pages} p.</span></label>${all.filter(x => x.f.id === f.id).map(x => { const sh = (P.proj.sheets || {})[x.key] || {};
    return `<label class="pk xpi"><input type="checkbox" data-xp="${esc(x.key)}"> p.${x.i}${sh.no ? " · " + esc(sh.no) : ""}${sh.title ? " · " + esc(sh.title) : ""}${tkSet.has(x.key) ? ' <span class="tag g">takeoff</span>' : ""}</label>`; }).join("")}</div>`).join("");
  const body = `<div id="xBody"><div class="wide"></div><div class="grid">
    <div class="fg w2"><label>Pages</label><div class="xrad">${rad("page", "This page", SC.page.length)}${rad("tk", "Pages with takeoff", tk.length)}${rad("sel", "Pages ticked in the Pages tab", sel.length)}${rad("all", "Every page", all.length)}${rad("pick", "Choose…", null)}</div>
      <div id="xPick"${scope === "pick" ? "" : ' style="display:none"'}><div class="xrow"><textarea id="xRange" rows="1" placeholder="e.g. 1-3, 7" title="Page numbers of the PDF chosen next to it; Enter ticks them"></textarea><select id="xRangeF">${P.proj.files.map(f => `<option value="${esc(f.id)}"${f.id === S.fileId ? " selected" : ""}>${esc(f.name.replace(/\.pdf$/i, ""))}</option>`).join("")}</select><button class="btn sm" type="button" id="xRangeGo">Tick these</button><button class="btn sm" type="button" data-xq="tk">With takeoff</button><button class="btn sm" type="button" data-xq="all">All</button><button class="btn sm" type="button" data-xq="none">None</button></div><div class="xlist">${lists}</div></div></div>
    <div class="fg"><label>Format</label>${sel1("xFmt", [["pdf", "PDF — one file (drawings stay vector)"], ["pdfs", "PDF — a file per page (.zip)"], ["png", "PNG images (.zip)"], ["jpg", "JPEG images (.zip)"]], o.fmt)}</div>
    <div class="fg"><label id="xDpiL">Resolution</label>${sel1("xDpi", [[150, "150 DPI — screen"], [200, "200 DPI"], [300, "300 DPI — print (high)"], [400, "400 DPI"], [600, "600 DPI — maximum"]], o.dpi)}<span class="small" id="xPx"></span></div>
    <div class="fg"><label>Legend</label>${sel1("xLeg", [["none", "No legend"], ["tl", "On the drawing — top left"], ["tr", "On the drawing — top right"], ["bl", "On the drawing — bottom left"], ["br", "On the drawing — bottom right"], ["margin", "In a margin strip on the left (Forma)"]], o.legend)}</div>
    <div class="fg"><label>Legend size</label>${sel1("xLsz", [["s", "Small"], ["m", "Medium"], ["l", "Large"]], o.lsz)}<label class="pk"><input type="checkbox" id="xLq"${o.lq ? " checked" : ""}> Quantities in the legend</label></div>
    <div class="fg"><label>Show</label><label class="pk"><input type="checkbox" id="xMeas"${o.meas ? " checked" : ""}> Measurements and counts</label><label class="pk"><input type="checkbox" id="xLbl"${o.lbl ? " checked" : ""}> Labels (as View → Labels)</label><label class="pk"><input type="checkbox" id="xMk"${o.mk ? " checked" : ""}> Notes, clouds, arrows, highlights</label><label class="pk"><input type="checkbox" id="xStamp"${o.stamp ? " checked" : ""}> Title stamp — project · sheet · date</label></div>
    <div class="fg"><label>Fade the drawing</label>${sel1("xFade", [[0, "No"], [25, "25 % — takeoff stands out"], [50, "50 %"], [70, "70 %"]], o.fade)}
      <label style="margin-top:6px">Conditions</label>${sel1("xCnd", [["shown", "Shown on the drawing (eye on)"], ["all", "Every condition"]].concat(used.length ? [["pick", "Choose…"]] : []), "shown")}
      <div id="xCndL" style="display:none;max-height:130px;overflow:auto;margin-top:4px">${used.map(c => `<label class="pk"><input type="checkbox" data-xc="${esc(c.id)}"${c.hidden ? "" : " checked"}><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c.color}"></span> ${esc(c.name)}</label>`).join("")}</div></div>
    <div class="fg w2"><label>File name</label><input type="text" id="xName" value="${esc(fileBase() + "_pages")}"></div></div>
    <p class="small" style="margin-top:8px">PDF keeps each drawing as its original vector page and puts the takeoff on top at the resolution chosen; PNG / JPEG are whole pictures of the page. A very large sheet at a high resolution is made as large as this browser allows, and the export says so.</p></div>`;
  const keysNow = () => { const sc = (document.querySelector('#xBody input[name="xSc"]:checked') || {}).value || scope; return sc === "pick" ? [...document.querySelectorAll("#xBody [data-xp]")].filter(x => x.checked).map(x => x.dataset.xp) : SC[sc] || []; };
  const p = ask("Export pages", body, "Export", () => {
    const keys = keysNow(); if (!keys.length) return "Tick at least one page";
    let conds = null; const cm = $("xCnd").value;
    if (cm === "all") conds = new Set(P.proj.conds.map(c => c.id));
    else if (cm === "pick") { conds = new Set([...document.querySelectorAll("#xBody [data-xc]")].filter(x => x.checked).map(x => x.dataset.xc)); if (!conds.size) return "Tick at least one condition"; }
    return {keys, fmt: $("xFmt").value, dpi: +$("xDpi").value, legend: $("xLeg").value, lsz: $("xLsz").value, lq: $("xLq").checked, meas: $("xMeas").checked, lbl: $("xLbl").checked, mk: $("xMk").checked, stamp: $("xStamp").checked, fade: +$("xFade").value, conds,
      name: ($("xName").value.trim() || fileBase()).replace(/[\\/:*?"<>|]+/g, "_")}; });
  const B = $("xBody"), boxes = () => [...B.querySelectorAll("[data-xp]")], tickIf = f => boxes().forEach(x => { x.checked = !!f(x.dataset.xp); });   // (listeners on the dialog's own body: it goes with the dialog)
  const upd = () => {
    const keys = keysNow(), dpi = +$("xDpi").value, k0 = keys[0], sz = k0 && (k0 === S.key && S.base ? [S.base.width, S.base.height] : (S.sizes || {})[k0]), img = $("xFmt").value === "png" || $("xFmt").value === "jpg";
    $("xDpiL").textContent = img ? "Resolution" : "Takeoff sharpness";
    $("xPx").textContent = sz ? (img ? "" : "takeoff layer ") + Math.round(sz[0] * dpi / 72) + " × " + Math.round(sz[1] * dpi / 72) + " px for " + keyName(k0) : "";
    if ($("dlgOk")) $("dlgOk").textContent = "Export " + nm(keys.length);
    B.querySelectorAll("[data-xpf]").forEach(g => { const L = boxes().filter(x => x.dataset.xp.split(":")[0] === g.dataset.xpf); g.checked = L.length > 0 && L.every(x => x.checked); g.indeterminate = L.some(x => x.checked) && !g.checked; });
  };
  tickIf(k => SC[scope === "pick" ? "page" : scope].includes(k));
  B.addEventListener("change", e => {
    if (e.target.name === "xSc") { const v = e.target.value; $("xPick").style.display = v === "pick" ? "" : "none"; if (v !== "pick") { scope = v; tickIf(k => (SC[v] || []).includes(k)); } }
    if (e.target.dataset.xpf) boxes().filter(x => x.dataset.xp.split(":")[0] === e.target.dataset.xpf).forEach(x => { x.checked = e.target.checked; });
    if (e.target.id === "xCnd") $("xCndL").style.display = e.target.value === "pick" ? "" : "none";
    upd(); });
  const goRange = () => { const f = P.proj.files.find(x => x.id === $("xRangeF").value), R = f ? parseRange($("xRange").value, f.pages) : new Set(); if (!R.size) return toast("Type page numbers, e.g. 1-3, 7", 2500); boxes().forEach(x => { const [fid, pg] = x.dataset.xp.split(":"); if (fid === f.id && R.has(+pg)) x.checked = true; }); upd(); };
  $("xRangeGo").onclick = goRange;
  $("xRange").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); goRange(); } });
  B.querySelectorAll("[data-xq]").forEach(b => b.onclick = () => { const q = b.dataset.xq; tickIf(k => q === "all" || (q === "tk" && tkSet.has(k))); upd(); });
  upd();
  const v = await p; if (!v) return;
  pref("zdTakeoffExp", JSON.stringify({fmt: v.fmt, dpi: v.dpi, legend: v.legend, lsz: v.lsz, lq: v.lq, meas: v.meas, lbl: v.lbl, mk: v.mk, stamp: v.stamp, fade: v.fade}));
  return runExport(v);
}
function parseRange(s, max){   // "1-3, 7" -> Set {1, 2, 3, 7} (within 1..max)
  const o = new Set(); String(s || "").replace(/\s*[-–]\s*/g, "-").split(/[,;\s]+/).forEach(t => { const m = /^(\d+)(?:-(\d+))?$/.exec(t.trim()); if (!m) return; let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a]; for (let i = Math.max(1, a); i <= Math.min(max, b); i++) o.add(i); }); return o; }
function rangeText(a){ const o = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; o.push(j > i ? a[i] + "-" + a[j] : String(a[i])); i = j; } return o.join(","); }
/* a progress card with Cancel: {set(i, n, what), sub(text), stop, done()} */
function progress(title){
  let el = $("xprog"); if (!el) { el = document.createElement("div"); el.id = "xprog"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = '<b></b><div class="xpb"><i></i></div><span class="small"></span><button class="btn sm" type="button">Stop</button>'; el.classList.add("on");
  const o = {stop: false, set(i, n, t){ el.querySelector("b").textContent = title + " — " + Math.min(n, i + 1) + " of " + n; el.querySelector("i").style.width = Math.round(100 * i / Math.max(1, n)) + "%"; el.querySelector(".small").textContent = t || ""; },
    sub(t){ el.querySelector(".small").textContent = t; }, done(){ el.classList.remove("on"); }};
  el.querySelector("b").textContent = title; el.querySelector("button").onclick = () => { o.stop = true; el.querySelector(".small").textContent = "Stopping after this page…"; };
  return o;
}
async function runExport(o){
  const pdf = o.fmt === "pdf" || o.fmt === "pdfs", pr = progress(pdf ? "Building the PDF" : "Rendering the pages");
  o.notes = [];
  try {
    if (pdf) await expPdf(o, pr); else await expImages(o, pr);
    if (pr.stop) toast("Export stopped — nothing was saved", 3000);
    else toast((o.keys.length === 1 ? "1 page" : o.keys.length + " pages") + " exported" + (o.notes.length ? " · " + o.notes.slice(0, 2).join(" · ") + (o.notes.length > 2 ? " · …" : "") : ""), o.notes.length ? 8000 : 3500);
  } catch (e) { toast("Export failed: " + (e.message || e), 7000); }
  pr.done();
}
/* the largest canvas this browser can really hold, up to w0 × h0 pt at sc0 px per pt (16 384 px a side, 80 MP) */
function canvasFor(W, H){
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.width === W && c.height === H && c.getContext("2d");
  try { if (x) { x.fillStyle = "#010203"; x.fillRect(W - 1, H - 1, 1, 1); const d = x.getImageData(W - 1, H - 1, 1, 1).data; if (d[0] === 1 && d[2] === 3) { x.clearRect(W - 1, H - 1, 1, 1); return c; } } } catch (e) {}
  c.width = 0; return null;
}
function expCanvas(w0, h0, sc0){
  let sc = Math.min(sc0, 16384 / Math.max(w0, h0), Math.sqrt(80e6 / (w0 * h0)));
  for (let t = 0; t < 6; t++, sc *= 0.75) { const W = Math.max(1, Math.ceil(w0 * sc)), H = Math.max(1, Math.ceil(h0 * sc)), cv = canvasFor(W, H); if (cv) return {cv, sc, W, H}; }
  throw new Error("this browser cannot hold a picture that large — choose a lower resolution");
}
function expNote(o, sc, key){ const d = Math.round(sc * 72); if (o.notes && d < o.dpi - 2) o.notes.push(keyName(key) + " at " + d + " DPI (the largest this browser allows)"); }
const blobBuf = (cv, type, q) => new Promise((ok, bad) => cv.toBlob(b => b ? b.arrayBuffer().then(ok, bad) : bad(new Error("the browser could not encode the picture — choose a lower resolution")), type, q));
function expName(key, n){ const [f, p] = key.split(":"), sh = (P.proj.sheets || {})[key] || {}, fl = P.proj.files.find(x => x.id === f);
  return (String(n + 1).padStart(2, "0") + "_" + (sh.no ? sh.no + "_" : "") + (fl ? fl.name.replace(/\.pdf$/i, "") : "page") + "_p" + p).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120); }
async function expPageImage(key, o){   // the page and its takeoff as one picture at o.dpi, on white: {cv, sc, W, H}
  const [f, p0] = key.split(":"), p = +p0, pg = await (await doc(f)).getPage(p), base = pg.getViewport({scale: 1}), strip = o.legend === "margin" ? EXP_STRIP[o.lsz] || EXP_STRIP.m : 0;
  const {cv, sc, W, H} = expCanvas(base.width + strip, base.height, o.dpi / 72); expNote(o, sc, key);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await loadLayers(f);
  await sliced(pg.render(Object.assign({...lay(f), canvasContext: ctx, viewport: pg.getViewport({scale: sc})}, strip ? {transform: [1, 0, 0, 1, strip * sc, 0]} : {}))).promise;
  if (o.fade) { ctx.fillStyle = "rgba(255,255,255," + o.fade / 100 + ")"; ctx.fillRect(strip * sc, 0, W - strip * sc, H); }
  await mkAssetsFor(f, p); await svgOnto(ctx, pageOverlaySvg(f, p, sc, W, H, Object.assign({}, o, {ox: strip * sc})));
  return {cv, sc, W, H};
}
async function expPdf(o, pr){   // the drawing stays the original vector page; the takeoff goes on top as a transparent picture
  const L = await loadPdfLib(), src = {}, per = o.fmt === "pdfs", files = [], strip = o.legend === "margin" ? EXP_STRIP[o.lsz] || EXP_STRIP.m : 0;
  let out = per ? null : await L.PDFDocument.create(), linkQ = [], byKey = {};
  for (const [n, key] of o.keys.entries()) {
    if (pr.stop) return;
    pr.set(n, o.keys.length, keyName(key));
    const [f, p0] = key.split(":"), p = +p0, pg = await (await doc(f)).getPage(p), base = pg.getViewport({scale: 1});
    if (per) { out = await L.PDFDocument.create(); linkQ = []; byKey = {}; }
    if (!src[f]) { const rec = await dbGet("pdfs", f); if (!rec) throw new Error("PDF missing — add “" + ((P.proj.files.find(x => x.id === f) || {}).name || f) + "” again with + PDF"); src[f] = await L.PDFDocument.load(rec.data.slice(0), {ignoreEncryption: true}); }
    if (pg.rotate % 360 !== 0 || src[f].isEncrypted || mkRedacted(f, p)) {   // a turned, password-locked or redacted page: flattened to one picture
      const im = await expPageImage(key, o), png = await out.embedPng(await blobBuf(im.cv, "image/png")); im.cv.width = 0;
      const np = out.addPage([base.width + strip, base.height]); np.drawImage(png, {x: 0, y: 0, width: base.width + strip, height: base.height});
      byKey[key] = np; mkPdfLinks(L, out, np, f, p, (x, y) => [strip + x, base.height - y], linkQ);
      if (mkRedacted(f, p) && o.notes) o.notes.push(keyName(key) + " flattened to apply its redactions");
    } else {
      const vb = pg.view, vw = vb[2] - vb[0], vh = vb[3] - vb[1], {cv, sc, W, H} = expCanvas(vw + strip, vh, o.dpi / 72); expNote(o, sc, key);
      await mkAssetsFor(f, p); await svgOnto(cv.getContext("2d"), pageOverlaySvg(f, p, sc, W, H, Object.assign({}, o, {ox: strip * sc})));
      const png = await out.embedPng(await blobBuf(cv, "image/png")); cv.width = 0;
      let np, x0 = vb[0], y0 = vb[1];
      if (!strip) { [np] = await out.copyPages(src[f], [p - 1]); out.addPage(np); }
      else { const ep = await out.embedPage(src[f].getPage(p - 1), {left: vb[0], bottom: vb[1], right: vb[2], top: vb[3]}); np = out.addPage([vw + strip, vh]); np.drawPage(ep, {x: strip, y: 0, width: vw, height: vh}); x0 = 0; y0 = 0; }
      if (o.fade) np.drawRectangle({x: x0 + strip, y: y0, width: vw, height: vh, color: L.rgb(1, 1, 1), opacity: o.fade / 100});
      np.drawImage(png, {x: x0, y: y0, width: vw + strip, height: vh});
      byKey[key] = np; mkPdfLinks(L, out, np, f, p, strip ? (x, y) => [strip + x, vh - y] : (x, y) => [vb[0] + x, vb[3] - y], linkQ);
    }
    if (per) { mkPdfLinksDone(out, linkQ, byKey); await mkPdfAttach(out, new Set([key])); ocFix(L, out, [f]); files.push({name: expName(key, n) + ".pdf", data: await out.save()}); }
  }
  pr.sub("Saving…");
  if (!per) { mkPdfLinksDone(out, linkQ, byKey); await mkPdfAttach(out, new Set(o.keys)); ocFix(L, out, o.keys.map(k => k.split(":")[0])); return saveBlob(new Blob([await out.save()], {type: "application/pdf"}), o.name + ".pdf"); }
  if (files.length === 1) saveBlob(new Blob([files[0].data], {type: "application/pdf"}), o.name + "_" + files[0].name); else saveBlob(await zipBlob(files), o.name + ".zip");
}
async function expImages(o, pr){
  const jpg = o.fmt === "jpg", type = jpg ? "image/jpeg" : "image/png", files = [];
  for (const [n, key] of o.keys.entries()) {
    if (pr.stop) return;
    pr.set(n, o.keys.length, keyName(key));
    const im = await expPageImage(key, o);
    const b = await new Promise((ok, bad) => im.cv.toBlob(x => x ? ok(x) : bad(new Error("the browser could not encode " + keyName(key) + " — choose a lower resolution")), type, 0.92)); im.cv.width = 0;
    files.push({name: expName(key, n) + (jpg ? ".jpg" : ".png"), blob: b});
  }
  pr.sub("Saving…");
  if (files.length === 1) saveBlob(files[0].blob, o.name + "_" + files[0].name); else saveBlob(await zipBlob(files), o.name + ".zip");
}
/* .zip with the files stored as they are (PNG, JPEG and PDF are compressed already); UTF-8 names */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u){ let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function zipBlob(files){   // [{name, blob | data}] -> Blob
  const enc = new TextEncoder(), parts = [], cen = [], d = new Date(), seen = new Set(); let off = 0;
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const f of files) {
    let name = f.name; for (let i = 2; seen.has(name); i++) name = f.name.replace(/(\.[^.]+)?$/, "_" + i + "$1"); seen.add(name);
    const data = f.data ? new Uint8Array(f.data) : new Uint8Array(await f.blob.arrayBuffer()), nmb = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, tm, 2], [12, dt, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nmb.length, 2], [28, 0, 2]].forEach(([at, v, n]) => n === 4 ? h.setUint32(at, v, true) : h.setUint16(at, v, true));
    parts.push(new Blob([h.buffer, nmb, data]));
    const c = new DataView(new ArrayBuffer(46)); [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, tm, 2], [14, dt, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nmb.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([at, v, n]) => n === 4 ? c.setUint32(at, v, true) : c.setUint16(at, v, true));
    cen.push(c.buffer, nmb); off += 30 + nmb.length + data.length;
  }
  const cl = cen.reduce((a, b) => a + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cl, 4], [16, off, 4], [20, 0, 2]].forEach(([at, v, n]) => n === 4 ? e.setUint32(at, v, true) : e.setUint16(at, v, true));
  return new Blob([...parts, ...cen, e.buffer], {type: "application/zip"});
}

/* import: PDFs with a choice of pages (the rest left out — the ticked pages are copied into a new PDF in this browser),
   a version set (Forma: name + issue date), a folder of PDFs, photos and scans (JPG / PNG) as pages at their scan DPI */
const isPdfFile = f => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const isImgFile = f => /^image\/(jpeg|png|webp|gif|bmp)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
function importMenu(x, y){
  ctxShow([{h: "Add drawings", s: "PDFs stay in this browser — nothing is uploaded"},
    {t: "PDFs — every page", fn: () => $("fileIn").click()},
    {t: "PDFs — choose pages, version set…", fn: () => $("impPdfIn").click()},
    {t: "A folder of PDFs…", fn: () => $("dirIn").click()},
    {t: "Photos / scans as pages (JPG, PNG)…", fn: () => $("imgIn").click()}, {sep: 1},
    {t: "Read sheet info from the title blocks…", fn: () => autoSheetDialog(), dis: !P.proj || !P.proj.files.length},
    {t: "Read scanned pages (OCR)…", fn: () => ocrDialog(), dis: !P.proj || !P.proj.files.length}], x, y);
}
async function importDialog(files){
  if (!P.proj) return toast("Open or start a project first");
  files = [...files];
  const cads = files.filter(isCadFile); if (cads.length) { await addFiles(cads); files = files.filter(f => !isCadFile(f)); if (!files.length) return; }
  const pdfs = files.filter(isPdfFile), imgs = files.filter(f => !isPdfFile(f) && isImgFile(f)), skip = files.length - pdfs.length - imgs.length;
  if (!pdfs.length && !imgs.length) return toast(skip ? skip + " file" + (skip > 1 ? "s" : "") + " left out — only PDF, JPG and PNG drawings can be added" : "No file chosen", 4000);
  if (pdfs.length > 12) {   // a big folder: every PDF opened at once to picture its pages is heavy — ask first
    const how = await choose("Import " + pdfs.length + " PDFs", `<p><b>${pdfs.length}</b> PDFs${imgs.length ? " and " + imgs.length + " image" + (imgs.length > 1 ? "s" : "") : ""}. Add every page of each as it is, or open them all to choose their pages (slower with many large drawings)?</p>`, [{t: "Choose pages", v: "pick"}, {t: "Add every page", v: "all", pri: true}]);
    if (!how) return;
    if (how === "all") { await addFiles(pdfs); if (imgs.length) await importDialog(imgs); return; }
  }
  const lib = await loadPdfjs(), E = [];
  for (const f of pdfs) { busy("Reading " + f.name + "…"); try { const data = await f.arrayBuffer(), {d} = await openPdfData(lib, data, f.name); E.push({f, data, d, n: d.numPages, on: new Set(Array.from({length: d.numPages}, (_, i) => i + 1))}); } catch (e) { toast(f.name + " could not be opened — " + (e.message || e), 5000); } }
  busy("");
  if (!E.length && !imgs.length) return;
  const sets = [...new Set(P.proj.files.map(f => f.vset).filter(Boolean))], SHOW = 400;
  const body = `<div id="imBody"><div class="wide"></div><div class="grid"><div class="fg"><label>Version set (optional)</label><input type="text" id="imSet" list="dlSets" placeholder="e.g. IFC Rev-03, Tender set"><datalist id="dlSets">${sets.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div><div class="fg"><label>Issue date</label><input type="date" id="imDate"></div></div>
    ${E.map((e, n) => `<div class="imf"><div class="imh"><b title="${esc(e.f.name)}">${esc(e.f.name)}</b><span class="small" id="imN${n}"></span><span style="flex:1"></span><textarea rows="1" data-imr="${n}" placeholder="Pages e.g. 1-3, 7" title="Type page numbers and press Enter: only those stay ticked"></textarea><textarea rows="1" data-imk="${n}" placeholder="Pages saying… e.g. PLAN" title="Ticks only the pages whose own text has one of these words (commas between words)"></textarea><button class="btn sm" type="button" data-imkgo="${n}">Find</button><button class="btn sm" type="button" data-ima="${n}">All</button><button class="btn sm" type="button" data-imz="${n}">None</button></div>
      <div class="pgg imgg">${Array.from({length: Math.min(e.n, SHOW)}, (_, i) => `<label class="pgt sel" data-imp="${n}:${i + 1}"><input type="checkbox" class="pgck" data-imc="${n}:${i + 1}" checked><img data-imt="${n}:${i + 1}" alt=""><div class="pgl">p.${i + 1}</div></label>`).join("")}</div>${e.n > SHOW ? `<p class="small">Pages after ${SHOW} are not pictured — tick them with page numbers.</p>` : ""}</div>`).join("")}
    ${imgs.length ? `<div class="imf"><div class="imh"><b>${imgs.length} photo / scan${imgs.length > 1 ? "s" : ""}</b><span class="small">${esc(imgs.slice(0, 4).map(f => f.name).join(", "))}${imgs.length > 4 ? ", …" : ""}</span></div>
      <div class="grid"><div class="fg"><label>Scanned at</label><select id="imDpi"><option value="0">The DPI stored in the file (else 300)</option><option value="150">150 DPI</option><option value="200">200 DPI</option><option value="300">300 DPI</option><option value="400">400 DPI</option><option value="600">600 DPI</option></select></div>
      <div class="fg"><label>&nbsp;</label><label class="pk"><input type="checkbox" id="imOne"${imgs.length > 1 ? " checked" : ""}> One PDF with every image as a page</label></div></div>
      <p class="small">At the right DPI a scan comes in at its paper size, so a scale written on it (1:100) holds; a phone photo has no true scale — set it with <b>K</b> from a known length. Run <b>OCR</b> on them to read their text.</p></div>` : ""}
    <label class="pk" style="margin-top:8px"><input type="checkbox" id="imAuto" checked> Read sheet numbers and titles from the title blocks afterwards (checked by you before they are saved)</label>
    <p class="small">A PDF with every page ticked is added as it is; with pages left out, the ticked ones are copied into a new PDF in this browser — nothing is uploaded.</p></div>`;
  const p = ask("Import drawings", body, "Import", () => ({set: $("imSet").value.trim().slice(0, 60), date: $("imDate").value, auto: $("imAuto").checked, dpi: $("imDpi") ? +$("imDpi").value : 0, one: $("imOne") ? $("imOne").checked : true}));
  const B = $("imBody"), me = ask.cur;
  const show = n => { const e = E[n]; B.querySelectorAll(`[data-imc^="${n}:"]`).forEach(x => { const i = +x.dataset.imc.split(":")[1]; x.checked = e.on.has(i); x.parentElement.classList.toggle("sel", x.checked); }); const t = $("imN" + n); if (t) t.textContent = e.on.size + " of " + e.n + " page" + (e.n > 1 ? "s" : "") + " ticked"; };
  E.forEach((_, n) => show(n));
  B.addEventListener("change", e => { const c = e.target.dataset.imc; if (!c) return; const [n, i] = c.split(":").map(Number); if (e.target.checked) E[n].on.add(i); else E[n].on.delete(i); show(n); });
  B.addEventListener("click", async e => {
    const b = e.target.closest("[data-ima],[data-imz],[data-imkgo]"); if (!b) return;
    if (b.dataset.ima != null) { const n = +b.dataset.ima; E[n].on = new Set(Array.from({length: E[n].n}, (_, i) => i + 1)); return show(n); }
    if (b.dataset.imz != null) { const n = +b.dataset.imz; E[n].on.clear(); return show(n); }
    const n = +b.dataset.imkgo, words = B.querySelector(`[data-imk="${n}"]`).value.split(/[,;]+/).map(w => w.trim().toUpperCase()).filter(Boolean); if (!words.length) return toast("Type a word the pages should have, e.g. PLAN", 2500);
    b.disabled = true; const on = new Set();
    for (let i = 1; i <= E[n].n && ask.cur === me; i++) { b.textContent = i + "/" + E[n].n; try { const tc = await (await E[n].d.getPage(i)).getTextContent(), s = tc.items.map(t => t.str).join(" ").toUpperCase().replace(/\s+/g, " "); if (words.some(w => s.includes(w))) on.add(i); } catch (er) {} }
    b.disabled = false; b.textContent = "Find"; if (ask.cur !== me) return;
    if (!on.size) return toast("No page's own text has " + words.join(" / ") + (E[n].d ? " (a scanned PDF has no text — tick the pages by hand)" : ""), 4000);
    E[n].on = on; show(n); });
  B.addEventListener("keydown", e => { const r = e.target.dataset && e.target.dataset.imr, k = e.target.dataset && e.target.dataset.imk; if (e.key !== "Enter" || (r == null && k == null)) return; e.preventDefault();
    if (k != null) return B.querySelector(`[data-imkgo="${k}"]`).click();
    const n = +r, R = parseRange(e.target.value, E[n].n); if (!R.size) return toast("Type page numbers, e.g. 1-3, 7", 2500); E[n].on = R; show(n); });
  const q = [], io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { io.unobserve(x.target); q.push(x.target); pump(); } }), {root: $("dlgB"), rootMargin: "120px"});
  let busyT = false;
  const pump = async () => { if (busyT) return; busyT = true;
    while (q.length && ask.cur === me) { const im = q.shift(), [n, i] = im.dataset.imt.split(":").map(Number);
      try { const pg = await E[n].d.getPage(i), v0 = pg.getViewport({scale: 1}), vp = pg.getViewport({scale: 130 / Math.max(v0.width, v0.height)}), cv = document.createElement("canvas"); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); await pg.render({canvasContext: cx, viewport: vp}).promise; im.src = cv.toDataURL("image/png"); } catch (er) {} }
    busyT = false; };
  B.querySelectorAll("img[data-imt]").forEach(im => io.observe(im));
  const v = await p; io.disconnect();
  if (!v) { E.forEach(e => { try { e.d.destroy(); } catch (x) {} }); return; }
  const before = new Set(P.proj.files.map(f => f.id)), add = [];
  for (const e of E) { if (!e.on.size) continue;
    if (e.on.size === e.n) add.push(e.f);
    else { busy("Copying the ticked pages of " + e.f.name + "…"); try { add.push(await subsetPdf(e)); } catch (er) { toast(e.f.name + ": the pages could not be copied (" + (er.message || er) + ") — every page is added", 6000); add.push(e.f); } } }
  E.forEach(e => { try { e.d.destroy(); } catch (x) {} });
  if (imgs.length) { try { add.push(...await imagesToPdf(imgs, v.dpi, v.one)); } catch (er) { toast("The images could not be added: " + (er.message || er), 6000); } }
  busy("");
  if (!add.length) return toast("Nothing ticked — nothing added");
  await addFiles(add);
  const added = P.proj.files.filter(f => !before.has(f.id));
  if (added.length && (v.set || v.date)) { added.forEach(f => { if (v.set) f.vset = v.set; if (v.date) f.vdate = v.date; }); save(); }
  refresh();
  if (v.auto && added.length) await autoSheetDialog(added.flatMap(f => Array.from({length: f.pages}, (_, i) => keyOf(f.id, i + 1))));
}
async function subsetPdf(e){   // the ticked pages of a PDF as a new PDF: "Plans (p.1-3,7).pdf"
  const L = await loadPdfLib(), src = await L.PDFDocument.load(e.data.slice(0), {ignoreEncryption: true});
  if (src.isEncrypted) throw new Error("it is locked with a password");
  const out = await L.PDFDocument.create(), idx = [...e.on].sort((a, b) => a - b);
  (await out.copyPages(src, idx.map(i => i - 1))).forEach(pg => out.addPage(pg));
  return new File([await out.save()], e.f.name.replace(/\.pdf$/i, "") + " (p." + rangeText(idx) + ").pdf", {type: "application/pdf"});
}
function imgDpi(buf){   // the DPI a JPEG (JFIF) or PNG (pHYs) says it was scanned at, or 0
  const u = new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536)), dv = new DataView(u.buffer, u.byteOffset, u.length);
  if (u[0] === 0xFF && u[1] === 0xD8) { for (let i = 2; i + 18 < u.length;) { if (u[i] !== 0xFF) break; const m = u[i + 1], len = dv.getUint16(i + 2);
      if (m === 0xE0 && String.fromCharCode(u[i + 4], u[i + 5], u[i + 6], u[i + 7]) === "JFIF") { const un = u[i + 11], x = dv.getUint16(i + 12); return un === 1 ? x : un === 2 ? Math.round(x * 2.54) : 0; }
      if (m === 0xDA) break; i += 2 + len; } }
  if (u[0] === 0x89 && u[1] === 0x50) { for (let i = 8; i + 12 < u.length;) { const len = dv.getUint32(i), t = String.fromCharCode(u[i + 4], u[i + 5], u[i + 6], u[i + 7]);
      if (t === "pHYs" && i + 17 < u.length) return u[i + 16] === 1 ? Math.round(dv.getUint32(i + 8) * 0.0254) : 0;
      if (t === "IDAT" || t === "IEND") break; i += 12 + len; } }
  return 0;
}
async function imagesToPdf(imgs, dpi0, one){   // photos / scans -> PDFs, each image a page at its paper size (px × 72 / DPI)
  const L = await loadPdfLib(), out = [], all = one ? await L.PDFDocument.create() : null;
  imgs = imgs.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
  for (const f of imgs) {
    busy("Adding " + f.name + "…");
    const buf = await f.arrayBuffer(), d0 = imgDpi(buf), dpi = dpi0 || (d0 >= 50 && d0 <= 2400 ? d0 : 300);
    let bmp; try { bmp = await createImageBitmap(new Blob([buf], {type: f.type || "image/" + (/png$/i.test(f.name) ? "png" : "jpeg")}), {imageOrientation: "from-image"}); } catch (e) { bmp = await createImageBitmap(new Blob([buf], {type: f.type})); }
    const doc1 = all || await L.PDFDocument.create(), png = /png$/i.test(f.type) || /\.png$/i.test(f.name);
    let img = null;
    if (png) { try { img = await doc1.embedPng(buf); } catch (e) { img = null; } }   // a PNG goes in as it is (lossless)
    if (!img) { const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height; const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0);
      img = png ? await doc1.embedPng(await blobBuf(cv, "image/png")) : await doc1.embedJpg(await blobBuf(cv, "image/jpeg", 0.95)); cv.width = 0; }   // a photo turned as the camera held it
    const w = bmp.width * 72 / dpi, h = bmp.height * 72 / dpi; bmp.close && bmp.close();
    doc1.addPage([w, h]).drawImage(img, {x: 0, y: 0, width: w, height: h});
    if (!all) out.push(new File([await doc1.save()], f.name.replace(/\.[^.]+$/, "") + ".pdf", {type: "application/pdf"}));
  }
  if (all) out.push(new File([await all.save()], (imgs.length === 1 ? imgs[0].name.replace(/\.[^.]+$/, "") : "Scans " + today()) + ".pdf", {type: "application/pdf"}));
  busy(""); return out;
}

/* sheet info from the title block (no., title, revision, floor, discipline): read from the page's own text (and OCR text
   of a scan) — by the labels and the title block's place, or inside capture areas picked once on one page (a title block
   template). Every value is shown for checking before it is saved; nothing is guessed. */
const SHEET_NO_RX = /^[A-Z]{1,4}\s?[-–._]?\s?\d{1,4}(?:[._-]\d{1,3})?[A-Z]?$/i;
const TB_NO = /\b(?:SHEET|DRG|DWG|DRAWING)\.?\s*(?:NO|NUMBER|NUM|#)\b\.?\s*:?/i, TB_TITLE = /\b(?:DRAWING|SHEET|DWG|DRG)\.?\s*(?:TITLE|NAME)\b\s*:?|^\s*TITLE\b\s*:?/i, TB_REV = /\bREV(?:ISION)?\b\.?\s*(?:NO\.?)?\s*[:#-]?\s*/i;
const TITLE_RX = /\b(PLANS?|ELEVATIONS?|SECTIONS?|DETAILS?|LAYOUTS?|SCHEDULES?|ROOF|FOUNDATIONS?|FRAMING|SITE|REFLECTED|CEILING|STAIRS?|FLOOR|BASEMENT|PLINTH|SLAB|BEAMS?|COLUMNS?|FOOTINGS?|ELECTRICAL|PLUMBING|DRAINAGE|LIGHTING|POWER|HVAC|FINISH(?:ES|ING)?|DOORS?|WINDOWS?|TOILETS?|KITCHENS?|LANDSCAPE)\b/i;
const FLOOR_RX = /\b((?:LOWER\s+|UPPER\s+)?GROUND\s+FLOOR|MEZZANINE(?:\s+FLOOR)?|BASEMENT(?:\s*[-–]?\s*\d{1,2})?(?:\s+FLOOR)?|(?:\d{1,2}\s*(?:ST|ND|RD|TH)|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|TYPICAL)\s+FLOOR|ROOF(?:\s*TOP)?|TERRACE|PENTHOUSE|LEVEL\s*[-–]?\s*\d{1,3})\b/i;
const DISC = [[/^(A|AR|ARC|ARCH)$/, "Architectural"], [/^(S|ST|STR|STRUC)$/, "Structural"], [/^(E|EL|ELE|ELEC)$/, "Electrical"], [/^(M|ME|MEC|MECH|HVAC|H|AC)$/, "Mechanical"], [/^(P|PL|PH|PLB|PLUMB)$/, "Plumbing"],
  [/^(C|CV|CIV|CE)$/, "Civil"], [/^(L|LA|LS|LND)$/, "Landscape"], [/^(I|ID|IN|INT)$/, "Interior"], [/^(F|FP|FF|FA|FS)$/, "Fire"], [/^(G|GN|GEN)$/, "General"]];
function sheetGuess(T, sz, tpl){   // a page's text -> {no, title, rev, floor, disc}; tpl: capture areas as fractions of the page
  const W = sz[0], H = sz[1], L = textLines(T || []).map(l => ({s: String(l.s).replace(/\s+/g, " ").trim(), x: l.x, y: l.y, w: l.w || 0, h: l.h || 6})).filter(l => l.s), out = {};
  const clean = s => String(s || "").replace(/^[\s:.#\-–]+|[\s:.,;\-–]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (tpl) {
    const inR = (l, r) => { const cx = (l.x + l.w / 2) / W, cy = (l.y - l.h / 2) / H; return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; };
    const grab = r => L.filter(l => inR(l, r)).sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.s).join(" ");
    if (tpl.no) out.no = clean(grab(tpl.no).replace(TB_NO, "")); if (tpl.title) out.title = clean(grab(tpl.title).replace(TB_TITLE, ""));
    if (tpl.rev) out.rev = clean(grab(tpl.rev).replace(TB_REV, "")); if (tpl.floor) out.floor = clean(grab(tpl.floor));
  } else {
    const tb = l => l.x + l.w / 2 > 0.6 * W || l.y > 0.78 * H;   // the title block: the right-hand strip or the bottom band
    const after = (lab, rx, ok) => {   // the value written after a label: on its line, to its right, or under it
      const rest = clean(lab.s.replace(rx, "")); if (rest && ok(rest)) return {s: rest, l: lab};
      const r = L.filter(l => l !== lab && Math.abs(l.y - lab.y) < 0.7 * Math.max(l.h, lab.h) && l.x > lab.x + 0.5 * lab.w && l.x - (lab.x + lab.w) < 0.2 * W && ok(clean(l.s))).sort((a, b) => a.x - b.x)[0];
      if (r) return {s: clean(r.s), l: r};
      const b = L.filter(l => l !== lab && l.y > lab.y + 0.3 * lab.h && l.y - lab.y < Math.max(4 * lab.h, 0.05 * H) && l.x + l.w > lab.x - 2 * lab.h && l.x < lab.x + lab.w + 0.1 * W && ok(clean(l.s))).sort((a, c) => a.y - c.y || Math.abs(a.x - lab.x) - Math.abs(c.x - lab.x))[0];
      return b ? {s: clean(b.s), l: b} : null;
    };
    const okNo = s => /\d/.test(s) && s.length <= 20 && /^[A-Z0-9][A-Z0-9 .\-–\/_]*$/i.test(s) && !TB_NO.test(s);
    for (const lab of L.filter(l => TB_NO.test(l.s))) { const v = after(lab, TB_NO, okNo); if (v) { out.no = v.s; break; } }
    if (!out.no) { const c = L.filter(l => tb(l) && SHEET_NO_RX.test(l.s) && !/^[DWVCBRP]\s?[-.]?\s?\d{1,2}$|^A[0-4]$/i.test(l.s)).sort((a, b) => b.h - a.h || (b.x + b.y) - (a.x + a.y))[0]; if (c) out.no = clean(c.s); }
    const okT = s => /[A-Z]{3,}/i.test(s) && s.length <= 70 && !TB_NO.test(s) && !/\b(SCALE|DATE|DRAWN|CHECKED|APPROVED|CLIENT|CONSULTANT|ARCHITECT|PROJECT|SIGN|REV(ISION)?)\b/i.test(s);
    let tl = null;
    for (const lab of L.filter(l => TB_TITLE.test(l.s))) { const v = after(lab, TB_TITLE, okT); if (v) { tl = v; break; } }
    if (!tl) { const c = L.filter(l => TITLE_RX.test(l.s) && okT(l.s)).sort((a, b) => (tb(b) ? 1 : 0) - (tb(a) ? 1 : 0) || b.h - a.h)[0]; if (c) tl = {s: clean(c.s), l: c}; }
    if (tl) { let s = tl.s; const nx = L.find(l => l !== tl.l && l.y > tl.l.y && l.y - tl.l.y < 2.2 * tl.l.h && Math.abs(l.x - tl.l.x) < 2 * tl.l.h && Math.abs(l.h - tl.l.h) < 0.35 * tl.l.h && okT(l.s) && !TB_TITLE.test(l.s));
      if (nx && (s + " " + nx.s).length <= 80) s += " " + clean(nx.s); out.title = s; }
    const revs = [];
    L.forEach(l => { if (!tb(l)) return; const m = /\bREV(?:ISION)?\b\.?\s*(?:NO\.?)?\s*[:#-]?\s*([A-Z]?\d{1,2}[A-Z]?|[A-Z])\b/i.exec(l.s); if (m) revs.push(m[1].toUpperCase()); });
    if (!revs.length) { const lab = L.find(l => tb(l) && /^\s*REV(?:ISION)?\b\.?\s*(?:NO\.?)?\s*:?\s*$/i.test(l.s)), v = lab && after(lab, /^\s*REV(?:ISION)?\b\.?\s*(?:NO\.?)?\s*:?/i, s => /^[A-Z]?\d{0,2}[A-Z]?$/i.test(s) && s.length >= 1 && s.length <= 4); if (v) revs.push(v.s.toUpperCase()); }
    if (revs.length) out.rev = revs.sort((a, b) => a.localeCompare(b, undefined, {numeric: true})).pop();   // the latest revision in the block
  }
  if (!out.floor && out.title) { const m = FLOOR_RX.exec(out.title); if (m) out.floor = m[1].replace(/\s+/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase()); }
  if (out.no) { const m = /^([A-Z]{1,5})/i.exec(out.no.replace(/\s+/g, "")), d = m && DISC.find(([rx]) => rx.test(m[1].toUpperCase())); if (d) out.disc = d[1]; }
  Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
  return out;
}
function sheetGuessFor(T, sz){   // sheetGuess inside the title-block template's capture areas when they fit pages of this paper shape
  const tpl = P.proj.tbTpl && Array.isArray(P.proj.tbTpl.size) ? P.proj.tbTpl : null, fit = tpl && Math.abs(sz[0] / sz[1] - tpl.size[0] / tpl.size[1]) < 0.03;
  let g = sheetGuess(T, sz, fit ? tpl : null); if (fit && !g.no && !g.title) g = sheetGuess(T, sz, null);
  return g;
}
async function autoSheetDialog(keys){
  if (!P.proj || !P.proj.files.length) return toast("Add a PDF first");
  keys = keys && keys.length ? keys : allPages().map(o => o.key);
  const tpl = P.proj.tbTpl && Array.isArray(P.proj.tbTpl.size) ? P.proj.tbTpl : null, rows = [];
  for (const [n, key] of keys.entries()) {
    busy("Reading title blocks… " + (n + 1) + " of " + keys.length);
    const [f, p] = key.split(":"); let T = [], sz = null;
    try { T = await pageTexts(f, +p); sz = await pageSize(f, +p); } catch (e) {}
    const cur = (P.proj.sheets || {})[key] || {};
    if (!sz) { rows.push({key, cur, g: {}, err: "PDF not attached"}); continue; }
    rows.push({key, cur, g: sheetGuessFor(T, sz), scan: !T.some(t => !t.ocr)});
  }
  busy("");
  const FL = [["no", "Sheet no.", 84], ["title", "Title", 210], ["rev", "Rev", 46], ["floor", "Floor", 96], ["disc", "Discipline", 96]];
  const found = rows.filter(r => FL.some(([k]) => r.g[k])).length, scans = rows.filter(r => r.scan && !r.err && !((P.proj.ocr || {})[r.key])).length;
  const body = `<div class="wide"></div><p><b>${found}</b> of ${rows.length} page${rows.length > 1 ? "s" : ""}: sheet information read from the drawing's own text${tpl ? " — inside the capture areas picked on " + esc(keyName(tpl.from)) : " — the title block found by its labels and its place"}. Values read are <span class="gs">highlighted</span>: check them, correct them, untick a page to leave it as it is.</p>
    ${scans ? `<p class="small" style="color:#8a5a00;margin-top:4px">${scans} page${scans > 1 ? "s have" : " has"} no text layer (scanned) — run <b>OCR</b> first, then read again.</p>` : ""}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"><button class="btn sm" type="button" id="asTpl" title="Drag a box round the sheet no. and round the title in this page's title block; pages of the same paper size are then read there (a title block template)">&#9634; Pick title-block areas on this page…</button>${tpl ? '<button class="btn sm" type="button" id="asTplX">Forget the areas</button>' : ""}<button class="btn sm" type="button" id="asAll" title="Put what was read into every field, over what is there now">Use what was read everywhere</button></div>
    <div style="max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:6px"><table class="sti"><thead><tr><th><input type="checkbox" id="asCk" checked title="Tick / untick all"></th><th>Page</th>${FL.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead><tbody>${rows.map((r, n) => `<tr data-as="${n}"><td><input type="checkbox" data-asck="${n}"${!r.err && FL.some(([k]) => r.g[k] || r.cur[k]) ? " checked" : ""}${r.err ? " disabled" : ""}></td><td class="small">${esc(keyName(r.key))}${r.err ? " — " + esc(r.err) : ""}</td>${FL.map(([k, , w]) => { const v = r.cur[k] || r.g[k] || "", gs = !r.cur[k] && r.g[k];
      return `<td><input type="text" data-asf="${k}" value="${esc(v)}" style="width:${w}px"${gs ? ' class="gs"' : ""}${r.g[k] && r.cur[k] && r.g[k] !== r.cur[k] ? ` title="Read on the drawing: ${esc(r.g[k])}"` : ""}></td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="small" style="margin-top:6px">The discipline comes from the sheet no.'s letters (A architectural, S structural, E electrical, P plumbing, M mechanical…); the floor from the title. A field the drawing does not show stays blank.</p>`;
  let next = "";
  const p = ask("Sheet info from the title blocks", body, "Save sheet info", () => { const out = []; document.querySelectorAll("#dlgB tr[data-as]").forEach(tr => { const r = rows[+tr.dataset.as]; if (!tr.querySelector("[data-asck]").checked) return; const v = {}; tr.querySelectorAll("[data-asf]").forEach(i => { v[i.dataset.asf] = i.value.trim().slice(0, 120); }); out.push({key: r.key, v}); }); return out.length ? {out} : "Tick at least one page"; });
  $("asCk").onchange = e => document.querySelectorAll("#dlgB [data-asck]:not(:disabled)").forEach(x => { x.checked = e.target.checked; });
  $("asAll").onclick = () => document.querySelectorAll("#dlgB tr[data-as]").forEach(tr => { const r = rows[+tr.dataset.as]; tr.querySelectorAll("[data-asf]").forEach(i => { const g = r.g[i.dataset.asf]; if (g) { i.value = g; i.classList.add("gs"); } }); });
  $("asTpl").onclick = () => { next = "tpl"; $("dlgCancel").click(); };
  if ($("asTplX")) $("asTplX").onclick = () => { delete P.proj.tbTpl; save(); next = "again"; $("dlgCancel").click(); };
  document.querySelectorAll("#dlgB [data-asf]").forEach(i => i.addEventListener("input", () => i.classList.remove("gs")));
  const v = await p;
  if (next === "tpl") { if (await pickTitleBlock()) toast("Capture areas kept — reading the pages again", 2500); return autoSheetDialog(keys); }
  if (next === "again") return autoSheetDialog(keys);
  if (!v) return;
  mutate(() => { P.proj.sheets = P.proj.sheets || {}; v.out.forEach(({key, v: w}) => { const cur = Object.assign({}, P.proj.sheets[key] || {}); FL.forEach(([k]) => { if (w[k]) cur[k] = w[k]; else delete cur[k]; }); P.proj.sheets[key] = cur; }); }, "Sheet info of " + v.out.length + " page" + (v.out.length > 1 ? "s" : ""));
  buildPageSel(); refresh();
  toast("Sheet info saved for " + v.out.length + " page" + (v.out.length > 1 ? "s" : "") + " — shown in Pages, the page list and the exports", 3500);
}
async function pickTitleBlock(){   // capture areas dragged on this page: sheet no., title (revision, floor if wanted)
  if (!S.page) { toast("Open a page with a title block first", 3000); return null; }
  const tpl = {}, F = [["no", "the sheet no."], ["title", "the drawing title"], ["rev", "the revision (Esc to skip)"], ["floor", "the floor (Esc to skip)"]];
  for (const [k, t] of F) { const r = await dragBox("Drag a box round " + t + " in the title block — zoom with the wheel"); if (!r) { if (k === "no" && !Object.keys(tpl).length) return null; continue; }
    tpl[k] = [r[0] / S.base.width, r[1] / S.base.height, r[2] / S.base.width, r[3] / S.base.height]; }
  if (!tpl.no && !tpl.title) return null;
  P.proj.tbTpl = Object.assign(tpl, {size: [S.base.width, S.base.height], from: S.key, at: new Date().toISOString()}); save();
  return P.proj.tbTpl;
}
function dragBox(msg){   // one box dragged on the drawing -> [x0, y0, x1, y1] in page points, or null (Esc); the wheel still zooms, right-drag pans
  return new Promise(res => {
    const ov = document.createElement("div"), bx = document.createElement("div"), tip = document.createElement("div");
    ov.className = "tbpick"; bx.className = "tbbox"; tip.className = "tbtip"; tip.textContent = msg + " · Esc to skip"; ov.append(bx, tip); stage().appendChild(ov);
    let a = null;
    const done = v => { ov.remove(); document.removeEventListener("keydown", key, true); res(v); };
    const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", key, true);
    ov.addEventListener("pointerdown", e => { if (e.button !== 0 || S.space) return; e.preventDefault(); e.stopPropagation(); ov.setPointerCapture(e.pointerId); a = evPos(e); });
    ov.addEventListener("pointermove", e => { if (!a) return; e.stopPropagation(); const b = evPos(e); Object.assign(bx.style, {display: "block", left: Math.min(a[0], b[0]) + "px", top: Math.min(a[1], b[1]) + "px", width: Math.abs(b[0] - a[0]) + "px", height: Math.abs(b[1] - a[1]) + "px"}); });
    ov.addEventListener("pointerup", e => { if (!a) return; e.stopPropagation(); const b = evPos(e), a0 = a; a = null;
      if (Math.abs(b[0] - a0[0]) < 4 || Math.abs(b[1] - a0[1]) < 4) { bx.style.display = "none"; return; }
      const p = toBase(Math.min(a0[0], b[0]), Math.min(a0[1], b[1])), q = toBase(Math.max(a0[0], b[0]), Math.max(a0[1], b[1])); done([p[0], p[1], q[0], q[1]]); });
  });
}

/* OCR of scanned pages: Tesseract (free, runs in this browser; the engine and its English data come from the jsDelivr
   CDN once and are kept by the browser). The page is read in overlapping tiles at 150–300 DPI; the words found are kept
   with the project (P.proj.ocr) and used like a PDF's own text — Find, the agents, scale notes, tags, sheet info. */
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
function loadTess(){ return window.Tesseract ? Promise.resolve(window.Tesseract) : new Promise((ok, bad) => { const s2 = document.createElement("script"); s2.src = TESS; s2.onload = () => ok(window.Tesseract); s2.onerror = () => bad(new Error("the OCR engine could not be loaded (offline?)")); document.head.appendChild(s2); }); }
function ocrItems(key){ const o = P.proj && P.proj.ocr && P.proj.ocr[key]; return o && Array.isArray(o.items) ? o.items.filter(a => Array.isArray(a) && a.length >= 5 && [1, 2, 3, 4].every(i => isFinite(+a[i]))).map(a => ({s: normQ(String(a[0])), x: +a[1], y: +a[2], w: +a[3], h: +a[4], ocr: 1})) : []; }
function withOcr(key, T){   // a page's text with its OCR words added (those not on top of a word the PDF has already)
  const O = ocrItems(key); if (!O.length) return T;
  const on = (a, b) => Math.abs(a.y - b.y) < 0.6 * Math.max(a.h, b.h) && a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2;
  return T.concat(O.filter(o => !T.some(t => on(t, o))));
}
async function ocrDialog(keys){
  if (!P.proj || !P.proj.files.length) return toast("Add a PDF first");
  keys = keys && keys.length ? keys : null;
  const v = await ask("Read scanned pages (OCR)", `<p>Reads the words on scanned or photographed drawings with OCR running in this browser (Tesseract — free, nothing is uploaded; the first run downloads the engine, about 15 MB, kept for next time). The words are then used like a PDF's own text: <b>Find</b> (Ctrl+F), room names and sizes for the agents, scale notes, door / window tags and sheet info.</p>
    <div class="grid" style="margin-top:8px"><div class="fg"><label>Pages</label><select id="ocP">${keys ? `<option value="keys">The ${keys.length} page${keys.length > 1 ? "s" : ""} chosen</option>` : ""}${S.page ? '<option value="page">This page</option>' : ""}<option value="scan">Pages with no text layer (scans)</option><option value="pdf">Every page of this PDF</option><option value="all">Every page of the project</option></select></div>
    <div class="fg"><label>Detail</label><select id="ocD"><option value="200">Normal — 200 DPI</option><option value="300">Fine print — 300 DPI (slower)</option><option value="150">Fast — 150 DPI</option></select></div></div>
    <label class="pk" style="margin-top:6px"><input type="checkbox" id="ocRe"> Read again pages that were read before</label>
    <p class="small" style="margin-top:6px">OCR reads level text best: vertical labels and handwriting may be missed, and a misread is possible — check what the agents find. A page with a PDF text layer gains only the words missing from it. About 20–60 s a page.</p>`, "Read the text", () => ({p: $("ocP").value, dpi: +$("ocD").value, re: $("ocRe").checked}));
  if (!v) return;
  let L = v.p === "keys" ? keys : v.p === "page" ? [S.key] : v.p === "pdf" ? allPages().filter(o => o.f.id === S.fileId).map(o => o.key) : allPages().map(o => o.key);
  if (v.p === "scan") { const o = []; for (const [n, x] of allPages().entries()) { busy("Finding pages with no text… " + (n + 1)); const T = await pageTexts(x.f.id, x.i); if (T.filter(t => !t.ocr).length < 3) o.push(x.key); } busy(""); L = o; if (!L.length) return toast("Every page has a text layer — no OCR needed", 4000); }
  if (!v.re) { const n0 = L.length; L = L.filter(k => !(P.proj.ocr && P.proj.ocr[k])); if (!L.length) return toast(n0 > 1 ? "Those pages were read before — tick “Read again”" : "This page was read before — tick “Read again”", 4000); }
  return ocrPages(L, {dpi: v.dpi});
}
async function ocrPages(keys, o){
  const pr = progress("Reading text (OCR)"); let worker = null, words = 0, done = 0;
  try {
    pr.sub("Loading the OCR engine…");
    const Tz = await loadTess();
    worker = await Tz.createWorker("eng", 1, {logger: m => { if (m && m.status && /load|init/i.test(m.status)) pr.sub(m.status + (m.progress ? " " + Math.round(m.progress * 100) + " %" : "")); }});
    await worker.setParameters({tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", user_defined_dpi: String(o.dpi)});
    for (const [n, key] of keys.entries()) {
      if (pr.stop) break;
      pr.set(n, keys.length, keyName(key));
      const items = await ocrPage(worker, key, o, pr); if (pr.stop) break;
      P.proj.ocr = P.proj.ocr || {}; P.proj.ocr[key] = {at: new Date().toISOString(), dpi: o.dpi, n: items.length, items}; words += items.length; done++;
      delete S.texts[key]; if (key === S.key) await indexPage();   // this page: its text again (and a scale note now readable)
      save();
    }
  } catch (e) { toast("OCR failed: " + (e.message || e), 7000); }
  finally { if (worker) { try { await worker.terminate(); } catch (e) {} } pr.done(); }
  if (done) { refresh(); toast("OCR: " + words + " text item" + (words === 1 ? "" : "s") + " read on " + done + " page" + (done > 1 ? "s" : "") + " — Find, the agents and sheet info use them now", 5000); }
  return {pages: done, words};
}
async function ocrPage(worker, key, o, pr){   // one page -> [[text, x, y (baseline), w, h], …] in page points
  const [f, p] = key.split(":"), pg = await (await doc(f)).getPage(+p), base = pg.getViewport({scale: 1});
  const sc = Math.min(o.dpi / 72, 9000 / Math.max(base.width, base.height)), W = Math.ceil(base.width * sc), H = Math.ceil(base.height * sc), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await loadLayers(f); await sliced(pg.render({...lay(f), canvasContext: ctx, viewport: pg.getViewport({scale: sc})})).promise;
  const TS = 2400, OV = 200, nx = Math.max(1, Math.ceil((W - OV) / (TS - OV))), ny = Math.max(1, Math.ceil((H - OV) / (TS - OV))), out = [];
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    if (pr && pr.stop) { cv.width = 0; return out; }
    const x0 = Math.max(0, Math.min(tx * (TS - OV), W - TS)), y0 = Math.max(0, Math.min(ty * (TS - OV), H - TS)), w = Math.min(TS, W - x0), h = Math.min(TS, H - y0);
    const cx0 = tx ? x0 + OV / 2 : 0, cy0 = ty ? y0 + OV / 2 : 0, cx1 = tx < nx - 1 ? x0 + w - OV / 2 : W, cy1 = ty < ny - 1 ? y0 + h - OV / 2 : H;   // the part this tile answers for
    const t = document.createElement("canvas"); t.width = w; t.height = h; t.getContext("2d").drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    if (pr) pr.sub(keyName(key) + " — part " + (ty * nx + tx + 1) + " of " + nx * ny);
    const r = await worker.recognize(t, {}, {blocks: true, text: false}); t.width = 0;
    ocrLines(r && r.data || {}).forEach(line => { let cur = null;
      line.forEach(wd => { const b = wd.bbox || {}, mx = x0 + (b.x0 + b.x1) / 2, my = y0 + (b.y0 + b.y1) / 2, s = String(wd.text || "").trim(), cf = +wd.confidence || 0;
        if (!(mx >= cx0 && mx < cx1 && my >= cy0 && my < cy1)) { cur = null; return; }   // the neighbouring tile reads this word
        const an = (s.match(/[A-Za-z0-9]/g) || []).length;
        if (!s || cf < 55 || !an || an < s.length / 2 || (s.length === 1 && cf < 80)) { cur = null; return; }   // hatch and line noise
        const X0 = (x0 + b.x0) / sc, X1 = (x0 + b.x1) / sc, Y1 = (y0 + b.y1) / sc, hh = (b.y1 - b.y0) / sc;
        if (cur && X0 - cur.x1 < 1.2 * Math.max(hh, cur.h)) { cur.s += " " + s; cur.x1 = X1; cur.y = Math.max(cur.y, Y1); cur.h = Math.max(cur.h, hh); }
        else { cur = {s, x: X0, x1: X1, y: Y1, h: hh}; out.push(cur); } }); });
  }
  cv.width = 0;
  return out.map(c => [normQ(c.s).slice(0, 200), +c.x.toFixed(1), +c.y.toFixed(1), +(c.x1 - c.x).toFixed(1), +c.h.toFixed(1)]);
}
function ocrLines(d){   // tesseract.js result -> lines of words, from whichever shape the version returns
  const L = []; (d.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => L.push(l.words || []))));
  if (!L.length && Array.isArray(d.lines)) d.lines.forEach(l => L.push(l.words || []));
  if (!L.length && Array.isArray(d.words)) L.push(d.words);
  return L;
}

/* sheet links (Forma automatic hyperlinks): a sheet no. written on the drawing ("A-301", "3/A-301") opens that sheet —
   double-click it, or right-click → Open sheet */
const sheetNorm = s => String(s || "").toUpperCase().replace(/[\s._\-–—]+/g, "");
function sheetIndex(){ const m = new Map(); Object.entries((P.proj && P.proj.sheets) || {}).forEach(([k, sh]) => { const n = sh && sheetNorm(sh.no); if (n && n.length >= 2 && /\d/.test(n) && /[A-Z]/.test(n) && !m.has(n)) m.set(n, k); }); return m; }   // (a letter and a figure: "01" alone is any dimension)
function sheetRefsNear(q, r){   // sheet references written on this page ([{k, no, t}]); q: only those within r points of q
  const idx = sheetIndex(); if (!idx.size || !S.page) return [];
  const out = [], seen = new Set();
  (S.texts[S.key] || []).forEach(t => { if (q && !(q[0] >= t.x - r && q[0] <= t.x + (t.w || 0) + r && q[1] >= t.y - (t.h || 6) - r && q[1] <= t.y + r)) return;
    String(t.s).split(/[\s\/(),;:]+/).forEach(w => { const k = idx.get(sheetNorm(w)); if (k && k !== S.key && !seen.has(k + "|" + (q ? "" : w))) { seen.add(k + "|" + (q ? "" : w)); out.push({k, no: w, t}); } }); });
  return out;
}
function gotoKey(k){ const i = String(k).lastIndexOf(":"); if (i > 0) return gotoPage(k.slice(0, i), +k.slice(i + 1)); }
function sheetLinkItems(q){   // the right-click menu's sheet links
  const near = sheetRefsNear(q, 14 / S.view.s), all = sheetRefsNear(null), name = k => { const sh = (P.proj.sheets || {})[k] || {}; return (sh.no || keyName(k)) + (sh.title ? " — " + sh.title : ""); }, L = [];
  const uniq = A => A.filter((x, i) => A.findIndex(y => y.k === x.k) === i);
  uniq(near).slice(0, 3).forEach(x => L.push({t: "Open sheet " + name(x.k), k: "Dbl-click", fn: () => gotoKey(x.k)}));
  const A = uniq(all); if (A.length) L.push({t: "Sheets referenced on this page (" + A.length + ")", sub: A.slice(0, 40).map(x => ({t: name(x.k), fn: () => gotoKey(x.k)}))});
  return L.length ? L.concat([{sep: 1}]) : [];
}

/* cut-out (Forma Takeoff 2D "Cutout"): an area drawn over another area is taken out of it as a deduction in that area's
   condition — only the overlapping part, the area itself stays */
const isConvex = P0 => { let sg = 0; for (let i = 0; i < P0.length; i++) { const a = P0[i], b = P0[(i + 1) % P0.length], c = P0[(i + 2) % P0.length], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(z) < 1e-9) continue; if (sg && Math.sign(z) !== sg) return false; sg = Math.sign(z); } return true; };
const polySigned = P0 => { let s = 0; for (let i = 0, j = P0.length - 1; i < P0.length; j = i++) s += P0[j][0] * P0[i][1] - P0[i][0] * P0[j][1]; return s / 2; };
function clipPoly(subj, clip){   // Sutherland–Hodgman: subj (any outline) clipped by a convex outline
  const n = clip.length, ccw = polySigned(clip) > 0; let out = subj.slice();
  const cut = (p, q, a, b) => { const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null; const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den; return [p[0] + t * r[0], p[1] + t * r[1]]; };
  for (let i = 0; i < n && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % n], inside = p => { const z = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); return ccw ? z >= -1e-9 : z <= 1e-9; }, inp = out; out = [];
    for (let j = 0; j < inp.length; j++) { const p = inp[j], q = inp[(j + 1) % inp.length], pi = inside(p), qi = inside(q); if (pi) out.push(p); if (pi !== qi) { const x = cut(p, q, a, b); if (x) out.push(x); } }
  }
  return out;
}
function overlapPoly(A, B){   // the part of outline A inside outline B, or null (needs one of them convex, or A wholly inside B)
  let X = isConvex(A) ? clipPoly(B, A) : isConvex(B) ? clipPoly(A, B) : A.every(p => pointInPoly(p, B)) ? A.slice() : null;
  if (!X || X.length < 3) return null; X = cleanPoly(X); return X.length >= 3 && polyArea(X) > 1e-3 * Math.min(polyArea(A), polyArea(B)) ? X : null;
}
function cutTargets(it){ const A = itemPoly(it); return P.proj.items.filter(o => o !== it && onPage(o) && !hiddenItem(o) && o.kind === "shape" && (cond(o.cond) || {}).type === "area" && overlapPoly(A, itemPoly(o))); }
function cutOutOf(it, T){
  const A = itemPoly(it), adds = [], c0 = cond(it.cond);
  (T || cutTargets(it)).forEach(o => { const X = overlapPoly(A, itemPoly(o)); if (!X) return;
    const whole = Math.abs(polyArea(X) - polyArea(A)) < 0.005 * polyArea(A);
    adds.push(Object.assign({id: uid("I"), cond: o.cond, file: o.file, page: o.page, kind: "ded", nos: 1, label: "Cut-out: " + (it.label || (c0 ? c0.name : "area"))}, whole ? (it.shape === "circle" ? {pts: it.pts.map(p => p.slice()), shape: "circle"} : {pts: it.pts.map(p => p.slice())}) : {pts: X})); });
  if (!adds.length) return toast("Nothing to cut: this area overlaps no other area (or both outlines are irregular — draw the cut-out with Deduct, D)", 5000);
  mutate(() => { P.proj.items.push(...adds); }, "Cut out of " + adds.length + " area" + (adds.length > 1 ? "s" : ""));
  toast("Cut out of " + adds.map(a => (cond(a.cond) || {}).name).filter((x, i, A2) => A2.indexOf(x) === i).join(", ") + " as a deduction" + (adds.length > 1 ? "s" : "") + " — the area itself stays", 3500);
}

/* workspace: layouts, icon-only toolbar, minimap, full screen (kept per browser) */
function wsPref(){ let o = null; try { o = JSON.parse(pref("zdTakeoffWs") || "null"); } catch (e) { o = null; } return Object.assign({tb: "full", mini: false}, o && typeof o === "object" ? o : {}); }
function wsSet(ch){ const o = Object.assign(wsPref(), ch); pref("zdTakeoffWs", JSON.stringify(o)); wsApply(o); }
function wsApply(o){ o = o || wsPref(); document.body.classList.toggle("tbicons", o.tb === "icons"); const b = $("bMini"); if (b) b.classList.toggle("on", !!o.mini); miniUpdate(); }
function wsLayout(l){
  if (l === "focus") { S.lHide = true; S.rHide = true; } else { S.lHide = false; S.rHide = l === "pages"; }
  setPanels();
  const tab = l === "pages" || l === "check" ? "tPages" : "tCond"; if ($(tab)) $(tab).click();
  if (l === "check" && $("vSheet")) $("vSheet").click();
  toast("Workspace: " + {takeoff: "takeoff", focus: "drawing only", pages: "pages + drawing", check: "pages + measurement sheet"}[l], 1500);
}
function wsMenu(x, y){
  const W = wsPref(), sz = S.pgSz || "m";
  ctxShow([{h: "Workspace", s: "layout, toolbar and navigation — kept in this browser"},
    {t: "Takeoff — conditions · drawing · sheet", fn: () => wsLayout("takeoff")}, {t: "Drawing only", fn: () => wsLayout("focus")},
    {t: "Pages + drawing", fn: () => wsLayout("pages")}, {t: "Check — pages + measurement sheet", fn: () => wsLayout("check")}, {sep: 1},
    {t: "Toolbar: icons only", on: W.tb === "icons", fn: () => wsSet({tb: W.tb === "icons" ? "full" : "icons"})},
    {t: "Minimap", on: !!W.mini, fn: () => wsSet({mini: !W.mini})},
    {t: "Full screen", on: !!document.fullscreenElement, fn: fullScreen},
    {t: "Page thumbnails", sub: [["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([z, t]) => ({t, on: sz === z, fn: () => { S.pgSz = z; pref("zdTakeoffPgSz", z); renderPages(); }}))}, {sep: 1},
    {t: "Reset panel sizes", fn: () => { S.lw = 250; S.rw = 420; S.lHide = false; S.rHide = false; setPanels(); }},
    {t: "All commands…", k: "Ctrl+K", fn: openPalette}], x, y);
}
function fullScreen(){ const d = document, el = d.documentElement; if (d.fullscreenElement) { d.exitFullscreen().catch(() => {}); return; } if (!el.requestFullscreen) return toast("Full screen is not available here — press F11", 3000); el.requestFullscreen().catch(() => toast("Full screen is not available here — press F11", 3000)); }
/* ------------------------------------------------------------------ ribbon: tool groups, Modify, Review, Ortho / Polar, object snaps
   The toolbar is grouped into tabs (Select, Takeoff, Modify, Markup, Review) so the tools a QS uses are all visible and
   named, not hidden in the right-click menu. The tab follows the active tool (a shortcut such as W opens Takeoff). */
const SNAP_KEY = "zdTakeoffSnaps", ORTHO_KEY = "zdTakeoffOrtho", POLAR_KEY = "zdTakeoffPolar";
const SNAP_KINDS = [["endpoint", "Endpoint"], ["midpoint", "Midpoint"], ["intersection", "Intersection"], ["perpendicular", "Perpendicular to the last point"], ["nearest", "Nearest (anywhere on a line)"]];
function snapKinds(){
  if (!S.snapK) { let o = null; try { o = JSON.parse(pref(SNAP_KEY) || "null"); } catch (e) { o = null; }
    S.snapK = Object.assign({endpoint: true, midpoint: true, intersection: true, perpendicular: true, nearest: true}, o && typeof o === "object" ? o : {}); }
  return S.snapK;
}
function ribShow(tab){
  document.querySelectorAll("#tools [data-rtab]").forEach(b => { const on = b.dataset.rtab === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  document.querySelectorAll("#tools [data-rp]").forEach(pn => { pn.hidden = pn.dataset.rp !== tab; });
}
function ribFollow(t){   // the tab of the tool just picked (Select / Match / Lasso / Pan are always on show and change nothing)
  const b = document.querySelector(`#tools [data-tool="${t}"]`), pn = b && b.closest("[data-rp]");
  if (pn) ribShow(pn.dataset.rp); else if (mkIsTool(t)) ribShow("markup");
}
function setOrtho(on, quiet){
  S.ortho = !!on; if (on) S.polar = false;
  pref(ORTHO_KEY, S.ortho ? "1" : ""); pref(POLAR_KEY, S.polar ? "1" : "");
  $("bOrtho").classList.toggle("on", S.ortho); $("bPolar").classList.toggle("on", !!S.polar);
  if (!quiet) toast("Ortho " + (S.ortho ? "on — points go straight across or up / down (Shift: free for one click)" : "off"), 2200);
}
function setPolar(on, quiet){
  S.polar = !!on; if (on) S.ortho = false;
  pref(POLAR_KEY, S.polar ? "1" : ""); pref(ORTHO_KEY, S.ortho ? "1" : "");
  $("bPolar").classList.toggle("on", S.polar); $("bOrtho").classList.toggle("on", !!S.ortho);
  if (!quiet) toast("Polar " + (S.polar ? "on — directions every " + polarDeg() + "° are pulled in" : "off"), 2200);
}
const polarDeg = () => { const d = +pref("zdTakeoffPolarDeg"); return d > 0 && d <= 90 ? d : 15; };
function snapPopToggle(on){
  const pop = $("snapPop"), show = on == null ? !pop.classList.contains("on") : !!on;
  if (show) {
    const K = snapKinds();
    pop.innerHTML = '<b>Object snap</b>' + SNAP_KINDS.map(([k, n]) => `<label><input type="checkbox" data-sk="${k}"${K[k] ? " checked" : ""}> ${esc(n)}</label>`).join("") +
      '<b>Tracking</b><label><input type="checkbox" data-sk="_ortho"' + (S.ortho ? " checked" : "") + '> Ortho — 0° / 90° (F8)</label><label><input type="checkbox" data-sk="_polar"' + (S.polar ? " checked" : "") + '> Polar — every <select id="polDeg">' +
      [5, 10, 15, 30, 45, 90].map(d => `<option${d === polarDeg() ? " selected" : ""}>${d}</option>`).join("") + '</select>° (F10)</label>' +
      '<span class="small" style="font-size:10.5px;color:var(--muted)">Ctrl+click places a point with no snap at all.</span>';
  }
  pop.classList.toggle("on", show);
}
function ribbonInit(){
  document.querySelectorAll("#tools [data-rtab]").forEach(b => b.addEventListener("click", () => ribShow(b.dataset.rtab)));
  document.querySelectorAll("#tools [data-mod]").forEach(b => b.addEventListener("click", () => modAct(b.dataset.mod)));
  document.querySelectorAll("#tools [data-rv]").forEach(b => b.addEventListener("click", () => revAct(b.dataset.rv)));
  $("bOrtho").onclick = () => setOrtho(!S.ortho); $("bPolar").onclick = () => setPolar(!S.polar);
  S.ortho = pref(ORTHO_KEY) === "1"; S.polar = !S.ortho && pref(POLAR_KEY) === "1"; setOrtho(S.ortho, true); setPolar(S.polar, true);
  $("bSnapSet").onclick = e => { e.stopPropagation(); snapPopToggle(); };
  $("snapPop").addEventListener("click", e => e.stopPropagation());
  $("snapPop").addEventListener("change", e => {
    const k = e.target.dataset && e.target.dataset.sk;
    if (e.target.id === "polDeg") { pref("zdTakeoffPolarDeg", e.target.value); return; }
    if (k === "_ortho") return setOrtho(e.target.checked, true) || snapPopToggle(true);
    if (k === "_polar") return setPolar(e.target.checked, true) || snapPopToggle(true);
    if (k) { snapKinds()[k] = e.target.checked; pref(SNAP_KEY, JSON.stringify(snapKinds())); }
  });
  document.addEventListener("click", () => $("snapPop").classList.remove("on"));
  $("shQ").addEventListener("input", () => { S.shQ = $("shQ").value; renderSheet(); });
  $("shSort").addEventListener("change", () => { S.shSort = $("shSort").value; renderSheet(); });
}
function modAct(a){
  if (!P.proj || !S.page) return;
  const items = [...selIds()].map(objById).filter(o => o && onPage(o)), meas = items.filter(o => o.cond);
  const need = () => { setTool("select"); toast("Select what to change first — click it, or drag a box round it", 2800); };
  if (a === "move") { setTool("select"); return toast(items.length ? "Drag the selection to move it · Shift keeps it straight · arrow keys nudge · Alt+drag moves without selecting" : "Click an object, then drag it to move it", 3600); }
  if (a === "copy") { if (!items.length) return need(); copySel(); setTool("stamp"); return; }
  if (a === "dup") return items.length ? duplicateSel() : need();
  if (a === "array") return items.length ? arrayDialog("right") : need();
  if (a === "cw" || a === "ccw" || a === "fh" || a === "fv") return items.length ? transformSel(a) : need();
  if (a === "front") return items.length ? orderSel(1) : need();
  if (a === "lock") return items.length ? lockSel() : need();
  if (a === "offset") { if (meas.length !== 1) return toast("Select one measurement to offset", 2600); const c = cond(meas[0].cond); if (meas[0].kind === "open" || (c && c.type === "count")) return toast("A count point or an opening cannot be offset", 2600); return offsetDialog(meas[0]); }
  const runs = meas.filter(isRun);
  if (a === "join") return runs.length >= 2 ? joinRuns(new Set(runs.map(r => r.id))) : toast("Select two or more length runs to join", 2600);
  if (a === "explode") return runs.length === 1 && runs[0].pts.length >= 3 ? explodeRun(runs[0]) : toast("Select one length run with three or more points to explode", 2800);
  if (a === "close") { const rr = runs.filter(r => r.pts.length >= 3 && !r.locked); return rr.length ? rr.forEach(closeRun) : toast("Select a length run with three or more points to close", 2800); }
}
function revAct(a){
  if (!P.proj) return;
  const items = [...selIds()].map(objById).filter(o => o && o.cond && onPage(o));
  if (a === "next") return nextUnchecked(1);
  if (a === "prev") return nextUnchecked(-1);
  if (a === "checkpage") return S.page ? setQa(P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && i.qa !== "checked"), "checked") : null;
  if (a === "checksel" || a === "recheck") return items.length ? setQa(items, a === "recheck" ? "recheck" : "checked") : toast("Select the measurements first", 2400);
  if (a === "validate") return exportMenu();
  if (a === "compare") return $("bCompare").click();
  if (a === "typical") return $("bTypical").click();
}
function iconize(){   // each toolbar button's words in their own span, so "icons only" can hide them (the palette still reads them)
  document.querySelectorAll("#tools .tool, header > button.btn").forEach(b => { const n = b.firstChild; if (!n || n.nodeType !== 3 || b.querySelector(".tl")) return;
    const m = /^\s*(\S+)\s+([\s\S]+)$/.exec(n.textContent); if (!m || !/[^\x00-\x7F]/.test(m[1])) return;
    const sp = document.createElement("span"); sp.className = "tl"; n.textContent = m[1] + " "; sp.textContent = m[2]; b.insertBefore(sp, n.nextSibling); while (sp.nextSibling) sp.appendChild(sp.nextSibling); });
}
/* minimap (Forma): the page small, the part on screen framed; click or drag it to move there */
function miniUpdate(){
  const m = $("mini"); if (!m) return;
  if (!(wsPref().mini && S.page && S.base)) { m.style.display = "none"; return; }
  const th = (S.thumbs || {})[S.key], im = $("miniImg");
  if (!th) { thumbWant(S.key); m.style.display = "none"; return; }
  if (th === "x") { m.style.display = "none"; return; }
  if (im.getAttribute("src") !== th) im.src = th;
  const st = stage(), a = toBase(0, 0), b = toBase(st.clientWidth, st.clientHeight), W = S.base.width, H = S.base.height;
  if (a[0] <= 1 && a[1] <= 1 && b[0] >= W - 1 && b[1] >= H - 1) { m.style.display = "none"; return; }   // the whole page is on screen
  const mw = W >= H ? 190 : 130, k = mw / W; im.style.width = mw + "px"; im.style.height = Math.round(H * k) + "px"; m.style.display = "block";
  const x0 = Math.max(0, a[0]) * k, y0 = Math.max(0, a[1]) * k, x1 = Math.min(W, b[0]) * k, y1 = Math.min(H, b[1]) * k;
  Object.assign($("miniVp").style, {left: x0 + "px", top: y0 + "px", width: Math.max(3, x1 - x0) + "px", height: Math.max(3, y1 - y0) + "px"});
}
function miniGo(e){ const r = $("miniImg").getBoundingClientRect(), k = S.base.width / r.width, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, st = stage();
  S.view.tx = st.clientWidth / 2 - x * S.view.s; S.view.ty = st.clientHeight / 2 - y * S.view.s; applyView(); renderHi(); }

/* takeoff report (Forma "Reports": a printable inventory report with a cover) — opens in a new tab to print or save as PDF */
function reportPrint(){
  if (!P.proj) return;
  const V = validation(), q = qaCounts(), BL = billLines(), tot = BL.reduce((a, l) => a + l.qty * (l.rate || 0), 0), w = window.open("", "_blank");
  if (!w) return toast("The browser blocked the new tab — allow pop-ups for this page, then try again", 5000);
  const row = c => { const t = condTotals(c), n = P.proj.items.filter(i => i.cond === c.id).length; return n ? `<tr><td><span class="sw" style="background:${c.color}"></span>${c.boq ? esc(c.boq) + " · " : ""}${esc(c.name)}</td><td class="n">${n}</td><td class="n">${fq(t.gross, c.unit)}</td><td class="n">${t.ded ? "−" + fq(t.ded, c.unit) : ""}</td><td class="n"><b>${fq(t.net, c.unit)}</b></td><td>${esc(c.unit)}</td></tr>` : ""; };
  const pages = allPages().filter(o => P.proj.items.some(i => i.file === o.f.id && i.page === o.i)).map(o => { const sh = (P.proj.sheets || {})[o.key] || {}, n = P.proj.items.filter(i => i.file === o.f.id && i.page === o.i), st = scaleState(P.proj.scales[o.key]);
    return `<tr><td>${esc(sh.no || "")}</td><td>${esc(sh.title || "")}</td><td>${esc(o.f.name.replace(/\.pdf$/i, ""))} p.${o.i}</td><td>${esc([sh.bldg, sh.floor].filter(Boolean).join(" · "))}</td><td class="n">${n.length}</td><td class="n">${n.filter(i => i.qa === "checked").length}</td><td>${esc(st.t)}</td></tr>`; }).join("");
  const fl = floorGroups(), byFloor = fl.length > 1 ? fl.map(g => `<tr class="g"><td colspan="3">${esc(g.name)}</td></tr>` + billLines(g.only).filter(l => l.kind === "cond").map(l => `<tr><td>${esc(l.name)}</td><td class="n">${fq(l.qty, l.unit)}</td><td>${esc(l.unit)}</td></tr>`).join("")).join("") : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(P.proj.name)} — takeoff report</title><style>
    body{font:12px "Segoe UI",Arial,sans-serif;color:#1e2b3a;margin:24px}h1{font-size:20px;color:#0f2942;margin:0 0 4px}h2{font-size:14px;color:#0f2942;margin:22px 0 6px;border-bottom:2px solid #0f2942;padding-bottom:3px}
    table{width:100%;border-collapse:collapse}th{background:#12263f;color:#fff;font-size:10.5px;text-align:left;padding:5px 6px}td{padding:4px 6px;border-bottom:1px solid #e3e8ef;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    tr.g td{background:#f1f4f9;font-weight:700}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}.cov{border:1px solid #dde5ee;border-radius:8px;padding:14px 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px}
    .cov b{display:block;font-size:16px;color:#0f2942}.muted{color:#6b7d92}.st{font-weight:700;color:${lvlCol(V.lvl)}}@media print{body{margin:10mm}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
    <h1>${esc(P.proj.name)}</h1><div class="muted">Quantity takeoff report · ${esc(dmy(today()))} · decimal feet, deductions as their own rows · ZD PDF Takeoff</div>
    <h2>Summary</h2><div class="cov"><div><span class="muted">Drawings</span><b>${P.proj.files.length} PDF · ${allPages().length} pages</b></div><div><span class="muted">Measurements</span><b>${q.n}</b></div><div><span class="muted">Checked</span><b>${q.checked} of ${q.n}</b></div>
    <div><span class="muted">AI / copied to check</span><b>${q.review}</b></div><div><span class="muted">Takeoff check</span><b class="st">${esc(V.lvl)}</b></div><div><span class="muted">Bill amount</span><b>${tot ? "PKR " + f2(tot) : "—"}</b></div></div>
    <h2>Quantities by condition</h2><table><thead><tr><th>Condition</th><th class="n">Measurements</th><th class="n">Gross</th><th class="n">Deductions</th><th class="n">Net</th><th>Unit</th></tr></thead><tbody>${P.proj.conds.map(row).join("")}</tbody></table>
    ${byFloor ? `<h2>By building / floor</h2><table><thead><tr><th>Item</th><th class="n">Qty</th><th>Unit</th></tr></thead><tbody>${byFloor}</tbody></table>` : ""}
    ${BL.length ? `<h2>Bill</h2><table><thead><tr><th>Item</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate PKR</th><th class="n">Amount PKR</th></tr></thead><tbody>${BL.map(l => `<tr${l.kind === "cond" ? ' class="g"' : ""}><td>${l.kind === "asm" ? "↳ " : ""}${l.boq ? esc(l.boq) + " · " : ""}${esc(l.name)}</td><td class="n">${fq(l.qty, l.unit)}</td><td>${esc(l.unit)}</td><td class="n">${l.rate ? f2(l.rate) : "—"}</td><td class="n">${l.rate ? f2(l.qty * l.rate) : "—"}</td></tr>`).join("")}<tr class="g"><td>Total</td><td></td><td></td><td></td><td class="n">${f2(tot)}</td></tr></tbody></table>` : ""}
    <h2>Drawings measured</h2><table><thead><tr><th>Sheet no.</th><th>Title</th><th>Drawing</th><th>Building / floor</th><th class="n">Measurements</th><th class="n">Checked</th><th>Scale</th></tr></thead><tbody>${pages || '<tr><td colspan="7" class="muted">Nothing measured yet</td></tr>'}</tbody></table>
    <h2>Takeoff check</h2>${V.L.length ? `<table><tbody>${V.L.map(x => `<tr><td style="width:80px;font-weight:700;color:${lvlCol(x.lvl)}">${esc(x.lvl)}</td><td>${esc(x.msg)}</td></tr>`).join("")}</tbody></table>` : '<p>No errors or warnings.</p>'}
    <script>setTimeout(function(){ window.print(); }, 400);<\/script></body></html>`);
  w.document.close();
}

/* ------------------------------------------------------------------ pages: list, paper sizes */
function allPages(){ const o = []; P.proj.files.forEach(f => { for (let i = 1; i <= f.pages; i++) o.push({f, i, key: keyOf(f.id, i)}); }); return o; }
async function pageSize(fid, i){
  S.sizes = S.sizes || {}; const k = keyOf(fid, i);
  if (S.sizes[k] === undefined) { try { const vp = (await (await doc(fid)).getPage(i)).getViewport({scale: 1}); S.sizes[k] = [vp.width, vp.height]; } catch (e) { S.sizes[k] = null; } }
  return S.sizes[k];
}
const pageList = (rows, id) => `<div style="max-height:280px;overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:4px 6px">${rows.map((o, n) =>
  `<label class="pk"><input type="checkbox" data-${id}="${n}"${o.on ? " checked" : ""}> <span style="flex:1">${o.html}</span></label>`).join("")}</div>`;

/* ------------------------------------------------------------------ copy scale to… (never one scale blindly on every page) */
async function copyScaleDialog(){
  const sc = P.proj.scales[S.key]; if (!sc) return toast("Set this page's scale first");
  const pages = allPages().filter(o => o.key !== S.key);
  if (!pages.length) return toast("This project has only one page");
  busy("Reading page sizes and scale notes…");
  const mine = await pageSize(S.fileId, S.pageNo), myLbl = sc.how === "note" ? (scaleCandidates(S.key).find(c => Math.abs(c.ptPerFt - sc.ptPerFt) < 1e-6) || {}).label : "";
  for (const o of pages) {
    o.size = await pageSize(o.f.id, o.i); await pageTexts(o.f.id, o.i);
    o.paper = !!(o.size && mine && Math.abs(o.size[0] - mine[0]) < 2 && Math.abs(o.size[1] - mine[1]) < 2);
    o.note = scaleCandidates(o.key).some(c => myLbl ? c.label === myLbl : Math.abs(c.ptPerFt - sc.ptPerFt) / sc.ptPerFt < 0.005);
    o.cur = P.proj.scales[o.key];
    o.html = `${esc(o.f.name.replace(/\.pdf$/i, ""))} — p.${o.i} <span class="small">${o.size ? (o.size[0] / 72).toFixed(1) + " × " + (o.size[1] / 72).toFixed(1) + " in" : "PDF not attached"} · now: ${esc(scaleState(o.cur).ic + " " + scaleState(o.cur).t)}${o.note ? " · same scale note" : ""}</span>`;
  }
  busy("");
  const pick = f => document.querySelectorAll("[data-cs]").forEach(x => { x.checked = f(pages[+x.dataset.cs]); });
  const pr = ask("Copy scale to…", `<p>Copy <b>1 ft = ${sc.ptPerFt.toFixed(4)} pt</b> (${esc(scaleState(sc).t)}) from <b>${esc(pageName({file: S.fileId, page: S.pageNo}))}</b> to the pages you tick.
    They are marked <b>⚠ Inherited</b> until you verify each one with a known dimension.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" type="button" id="csPdf">This PDF</button><button class="btn sm" type="button" id="csPaper">Same paper size</button><button class="btn sm" type="button" id="csNote">Same scale note</button><button class="btn sm" type="button" id="csNone">None</button></div>
    ${pageList(pages, "cs")}<p class="small" style="margin-top:6px">A scale is right only for a sheet drawn at the same scale and printed at the same paper size.</p>`, "Copy",
    () => { const t = [...document.querySelectorAll("[data-cs]")].filter(x => x.checked).map(x => pages[+x.dataset.cs]); return t.length ? {t} : "Tick at least one page"; });
  $("csPdf").onclick = () => pick(o => o.f.id === S.fileId); $("csPaper").onclick = () => pick(o => o.paper); $("csNote").onclick = () => pick(o => o.note); $("csNone").onclick = () => pick(() => false);
  const v = await pr; if (!v) return;
  const over = v.t.filter(o => o.cur);
  if (over.length && !(await ask("Replace existing scales?", `<p>${over.length} of the ticked pages already have a scale:</p><ul style="margin:6px 0 0 18px">${over.map(o => `<li>${esc(pageName({file: o.f.id, page: o.i}))} — ${esc(scaleState(o.cur).t)}</li>`).join("")}</ul><p style="margin-top:6px">Replace them with the inherited scale?</p>`, "Replace"))) return;
  mutate(() => v.t.forEach(o => { P.proj.scales[o.key] = {ptPerFt: sc.ptPerFt, how: "inherited", from: S.key, text: "copied from " + pageName({file: S.fileId, page: S.pageNo}) + " (" + (sc.text || "") + ")", factor: sc.factor || 1, verified: false, at: new Date().toISOString()}; }));
  toast("Scale copied to " + v.t.length + " page" + (v.t.length > 1 ? "s" : "") + " — marked inherited until verified", 4000);
}

/* ------------------------------------------------------------------ typical floors: preview, then copy — by the same place
   (checked by matching the sheet's text positions) or aligned by two reference points picked on both sheets */
async function layoutMatch(srcKey, fid, i){   // share of this sheet's words found at the same place on the other sheet
  const [sf, sp] = srcKey.split(":"), A = await pageTexts(sf, +sp), B = await pageTexts(fid, i);
  const a = A.filter(t => t.s.trim().length > 1), b = B.filter(t => t.s.trim().length > 1);
  if (!a.length || !b.length) return null;
  let hit = 0; a.forEach(t => { if (b.some(u => u.s.trim() === t.s.trim() && Math.abs(u.x - t.x) < 3 && Math.abs(u.y - t.y) < 3)) hit++; });
  return hit / a.length;
}
const matchState = m => m == null ? {k: "warn", t: "no text to compare (scanned?) — check by eye"} : m >= 0.6 ? {k: "ok", t: Math.round(m * 100) + "% of the words in the same place"} : m >= 0.3 ? {k: "warn", t: "only " + Math.round(m * 100) + "% of the words in the same place — check"} : {k: "bad", t: "only " + Math.round(m * 100) + "% of the words in the same place — different layout"};
async function copyPageDialog(){
  if (!S.page) return;
  const mine = P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo);
  if (!mine.length) return toast("Nothing measured on this page yet");
  const opts = allPages().filter(o => o.key !== S.key);
  if (!opts.length) return toast("Add another page or PDF first");
  busy("Comparing the sheets…");
  for (const o of opts) { o.m = await layoutMatch(S.key, o.f.id, o.i); o.st = matchState(o.m); o.on = false;
    o.html = `${esc(o.f.name.replace(/\.pdf$/i, ""))} — p.${o.i}${P.proj.scales[o.key] ? "" : " <span class='small'>(no scale)</span>"} <span class="small" style="color:${o.st.k === "ok" ? "var(--green)" : o.st.k === "warn" ? "var(--amber)" : "var(--red)"}">· ${esc(o.st.t)}</span>`; }
  busy("");
  const v = await ask("Typical floors — copy this page's takeoff", `<p>${mine.length} measurement${mine.length > 1 ? "s" : ""} on <b>${esc(pageName({file: S.fileId, page: S.pageNo}))}</b>. Copies are marked <b>Copied — not checked</b> until a checker ticks them on the sheet.</p>
    <div class="fg w2" style="margin-top:8px"><label>Position on the other sheets</label><select id="tyHow"><option value="same">Same place on the sheet (layout checked by the sheet's own text)</option><option value="align">Align by two reference points (sheet moved, turned or rescaled)</option></select></div>
    ${pageList(opts, "cp")}
    <div class="fg w2" style="margin-top:8px"><label><input type="checkbox" id="cpScale" style="width:auto" checked> Give pages without a scale this page's scale — marked inherited, to verify</label></div>`, "Next",
    () => { const pick = [...document.querySelectorAll("[data-cp]")].filter(x => x.checked).map(x => opts[+x.dataset.cp]); return pick.length ? {pick, how: $("tyHow").value, sc: $("cpScale").checked} : "Tick at least one page"; });
  if (!v) return;
  if (v.how === "same") {
    const bad = v.pick.filter(o => o.st.k !== "ok");
    if (bad.length && !(await ask("Check the layout first", `<p>These sheets do not match this one well:</p><ul style="margin:6px 0 0 18px">${bad.map(o => `<li>${esc(pageName({file: o.f.id, page: o.i}))} — ${esc(o.st.t)}</li>`).join("")}</ul><p style="margin-top:6px">Measurements would land in the wrong place if the drawing is shifted or different. Use <b>Align by two reference points</b> instead, or copy anyway (each copy stays <b>not checked</b>).</p>`, "Copy anyway"))) return;
    typCommit(mine, v.pick.map(o => ({o, T: null})), v.sc);
    return;
  }
  S.typ = {src: S.key, srcFile: S.fileId, srcPage: S.pageNo, mine, queue: v.pick.slice(), sc: v.sc, a: [], b: [], done: []};
  setTool("typref");
  toast("Click reference point 1 on this sheet — a grid intersection or building corner you can find on every sheet", 5000);
}
/* similarity transform taking a1→b1, a2→b2 (move, turn, uniform scale) */
function simT(a1, a2, b1, b2){
  const ax = a2[0] - a1[0], ay = a2[1] - a1[1], bx = b2[0] - b1[0], by = b2[1] - b1[1], d = ax * ax + ay * ay;
  if (d < 1e-9) return null;
  const c = (ax * bx + ay * by) / d, s = (ax * by - ay * bx) / d;   // (c + i s) = (b2 - b1) / (a2 - a1)
  return {c, s, k: Math.hypot(c, s), f: p => [b1[0] + c * (p[0] - a1[0]) - s * (p[1] - a1[1]), b1[1] + s * (p[0] - a1[0]) + c * (p[1] - a1[1])]};
}
async function typClick(p){
  const T = S.typ; if (!T) return;
  if (S.key === T.src) { T.a.push(p); if (T.a.length === 1) { toast("Click reference point 2 on this sheet — far from point 1", 4000); draw(); return; }
    const o = T.queue[0]; await gotoPage(o.f.id, o.i); if (S.key !== o.key) { S.typ = null; setTool("select"); return; } setTool("typref"); toast("On this sheet click the same point 1", 4000); return; }
  T.b.push(p); if (T.b.length === 1) { toast("Now the same point 2", 3000); draw(); return; }
  const tr = simT(T.a[0], T.a[1], T.b[0], T.b[1]); if (!tr) { T.b = []; return toast("Points 1 and 2 are the same — pick them again"); }
  T.T = tr; draw(); typBar();
}
function typBar(){
  const T = S.typ, o = T.queue[0], kS = (P.proj.scales[T.src] || {}).ptPerFt, kT = (P.proj.scales[o.key] || {}).ptPerFt;
  const exp = kS && kT ? kT / kS : null, off = exp ? Math.abs(T.T.k / exp - 1) : 0;
  $("cmpLegend").innerHTML = `<b>Preview</b> — ${T.mine.length} measurements placed by your two points (dashed). Turned ${(Math.atan2(T.T.s, T.T.c) * 180 / Math.PI).toFixed(1)}°, scaled × ${T.T.k.toFixed(3)}${exp && off > 0.01 ? ` <b style="color:var(--red)">— the two sheets' scales give × ${exp.toFixed(3)}: check the points or the scales</b>` : ""}
    <button class="btn sm pri" id="tyOk">Copy here</button><button class="btn sm" id="tyRedo">Pick again</button><button class="btn sm" id="tySkip">Skip sheet</button><button class="btn sm dng" id="tyStop">Stop</button>`;
  $("cmpLegend").style.display = "flex";
  $("tyOk").onclick = () => { T.done.push({o, T: T.T}); typNext(); };
  $("tyRedo").onclick = () => { T.b = []; T.T = null; $("cmpLegend").style.display = "none"; draw(); toast("Click the same point 1 again"); };
  $("tySkip").onclick = () => typNext();
  $("tyStop").onclick = () => { S.typ = null; $("cmpLegend").style.display = "none"; setTool("select"); toast("Typical copy stopped — nothing copied"); };
}
async function typNext(){
  const T = S.typ; $("cmpLegend").style.display = "none"; T.queue.shift(); T.b = []; T.T = null;
  if (T.queue.length) { const o = T.queue[0]; await gotoPage(o.f.id, o.i); if (S.key !== o.key) { S.typ = null; setTool("select"); if (T.done.length) typCommit(T.mine, T.done, T.sc, T.src); return; } setTool("typref"); toast("Next sheet: click the same point 1", 4000); return; }
  S.typ = null; setTool("select");
  if (T.done.length) typCommit(T.mine, T.done, T.sc, T.src); else toast("Nothing copied");
}
function typCommit(mine, targets, giveScale, srcKey){
  srcKey = srcKey || S.key;
  const now = new Date().toISOString(), src = P.proj.scales[srcKey];
  mutate(() => targets.forEach(({o, T}) => {
    if (giveScale && !P.proj.scales[o.key] && src) P.proj.scales[o.key] = {ptPerFt: src.ptPerFt * (T ? T.k : 1), how: "inherited", from: srcKey, text: "copied from " + keyName(srcKey) + (T ? " via 2-point alignment" : ""), factor: src.factor || 1, verified: false, at: now};
    if (!T && giveScale && P.proj.viewports[srcKey] && !(P.proj.viewports[o.key] || []).length) P.proj.viewports[o.key] = P.proj.viewports[srcKey].map(x => Object.assign({}, x, {id: uid("V"), r: x.r.slice()}));
    mine.forEach(it => { const c = JSON.parse(JSON.stringify(it));
      if (T) c.pts = c.pts.map(T.f);
      Object.assign(c, {id: uid("I"), file: o.f.id, page: o.i, qa: "", qaBy: "", qaAt: "", copied: {from: srcKey, at: now, how: T ? "aligned" : "same place"}});
      P.proj.items.push(c); });
  }));
  toast(mine.length + " measurement" + (mine.length > 1 ? "s" : "") + " copied to " + targets.length + " sheet" + (targets.length > 1 ? "s" : "") + " — marked Copied, not checked", 4500);
}

/* ------------------------------------------------------------------ doors on a room's outline (skirting: PD = P − doors) */
const schOf = id => id ? (P.proj.openings || []).find(o => o.id === id) || null : null;
function openW(o, k){ const s = schOf(o.sch); return s ? +s.w : o.ow ? +o.ow : dist(o.pts[0], o.pts[1]) / k; }
function openH(o){ const s = schOf(o.sch); return s ? +s.h : +o.oh || 0; }
function isDoor(o){ const s = schOf(o.sch); if (s) return s.type === "door"; const l = String(o.label || "").trim(); if (/^d/i.test(l)) return true; if (/^[wv]/i.test(l)) return false; return openH(o) >= 6; }
/* openings marked as doors (schedule type, label D…, or 6 ft or taller) whose middle lies within 1.25 ft of the outline —
   a door in the wall on either face of the room; the same door drawn in two wall conditions is taken once */
function doorsOfPage(key){   // door openings of one page, indexed once per refresh
  if (!S.doorIx) { S.doorIx = new Map(); P.proj.items.forEach(o => { if (o.kind === "open" && isDoor(o) && !hiddenItem(o)) { const kk = keyOf(o.file, o.page); if (!S.doorIx.has(kk)) S.doorIx.set(kk, []); S.doorIx.get(kk).push(o); } }); }
  return S.doorIx.get(key) || [];
}
function doorsOn(it){
  if (it.doorW !== undefined && it.doorW !== "" && it.doorW !== null) return {ft: +it.doorW || 0, n: null, manual: true};
  const k = itemScale(it); if (!k || it.kind !== "shape") return {ft: 0, n: 0};
  const poly = itemPoly(it), tol = 1.25 * k, seen = []; let ft = 0;
  doorsOfPage(keyOf(it.file, it.page)).forEach(o => {
    const m = [(o.pts[0][0] + o.pts[1][0]) / 2, (o.pts[0][1] + o.pts[1][1]) / 2];
    if (seen.some(s => dist(s, m) < 0.75 * k)) return;
    let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, distSeg(m, poly[i], poly[(i + 1) % poly.length]));
    if (d <= tol) { seen.push(m); ft += openW(o, k); }
  });
  return {ft, n: seen.length};
}

/* ------------------------------------------------------------------ location: building / floor / zone-apartment / room.
   A measurement takes its sheet's building and floor (Sheet info) unless it has its own. */
const LOC_KEYS = ["bldg", "floor", "zone", "room"], LOC_NAMES = {bldg: "Building", floor: "Floor", zone: "Zone / Apt", room: "Room"};
function locOf(it){ const sh = (P.proj.sheets || {})[keyOf(it.file, it.page)] || {}; return {bldg: it.bldg || sh.bldg || "", floor: it.floor || sh.floor || "", zone: it.zone || "", room: it.room || ""}; }
const locText = L => [L.bldg, L.floor, L.zone, L.room].filter(Boolean).join(" · ");
function locValues(k){ const s = new Set(); P.proj.items.forEach(it => { const v = locOf(it)[k]; if (v) s.add(v); }); Object.values(P.proj.sheets || {}).forEach(sh => { if (sh[k]) s.add(sh[k]); }); return [...s].sort(); }
function sheetInfoSuggestions(T){
  const L = textLines(T).map(x => x.s.replace(/\s+/g, " ").trim()).filter(Boolean), out = {};
  const labelled = (rx, valueRx, limit) => {
    for (let i = 0; i < L.length; i++) {
      const m = rx.exec(L[i]); if (!m) continue;
      const direct = valueRx ? valueRx.exec(m[1] || "") : null;
      if (direct && direct[1]) return direct[1].trim().slice(0, limit);
      if (m[1] && m[1].trim() && !valueRx) return m[1].trim().slice(0, limit);
      if (m[1] && m[1].trim()) continue;
      const next = L[i + 1] || "";
      if (next && !rx.test(next) && !/^(?:SHEET|DRAWING|DWG|TITLE|REV(?:ISION)?|DATE|DISCIPLINE|BUILDING|BLOCK|TOWER|FLOOR|LEVEL)\b/i.test(next)) return next.slice(0, limit);
    }
    return "";
  };
  out.no = labelled(/^\s*(?:SHEET(?:\s*(?:NO\.?|NUMBER))?|DWG(?:\.|G)?\s*(?:NO\.?|NUMBER)|DRAWING\s*(?:NO\.?|NUMBER))\s*[:#-]?\s*(.*)$/i,
    /^\s*([A-Z0-9][A-Z0-9.-]{1,19})\b/i, 20);
  out.title = labelled(/^\s*(?:(?:DRAWING)\s+)?TITLE\s*[:#-]?\s*(.*)$/i, null, 80);
  out.rev = labelled(/^\s*REV(?:ISION)?\.?(?!\s*DATE)\s*[:#-]?\s*(.*)$/i, /^\s*([A-Z0-9][A-Z0-9.-]{0,15})\b/i, 16);
  out.revDate = labelled(/^\s*(?:REV(?:ISION)?\s*)?DATE\s*[:#-]?\s*(.*)$/i, /^\s*(\d{4}-\d{2}-\d{2})\b/, 10);
  out.disc = labelled(/^\s*DISCIPLINE\s*[:#-]?\s*(.*)$/i, null, 40);
  out.bldg = labelled(/^\s*(?:BUILDING|BLOCK|TOWER)\s*[:#-]?\s*(.*)$/i, null, 40);
  out.floor = labelled(/^\s*(?:FLOOR|LEVEL|STOREY|STORY)\s*[:#-]\s*(.*)$/i, null, 40);
  Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
  return out;
}
async function sheetInfoDialog(readFirst){
  if (!S.page) return;
  const sh = Object.assign({}, (P.proj.sheets || {})[S.key] || {}), F = [["no", "Sheet no.", "e.g. A-103"], ["title", "Drawing title", "e.g. Typical floor plan"], ["rev", "Revision", "e.g. Rev-03"], ["revDate", "Revision date", ""], ["disc", "Discipline", "e.g. Architectural"], ["bldg", "Building / block", "e.g. Tower A"], ["floor", "Floor", "e.g. Level 12"]];
  const dlg = ask("Sheet info — " + pageName({file: S.fileId, page: S.pageNo}), `<div class="grid">${F.map(([k, l, ph]) => `<div class="fg"><label>${l}</label><input type="${k === "revDate" ? "date" : "text"}" id="si_${k}" value="${esc(sh[k] || "")}" placeholder="${esc(ph)}"${k === "bldg" || k === "floor" ? ` list="dl_${k}"` : ""}></div>`).join("")}</div>
    <datalist id="dl_bldg">${locValues("bldg").map(x => `<option value="${esc(x)}">`).join("")}</datalist><datalist id="dl_floor">${locValues("floor").map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><button class="btn sm" type="button" id="siRead">Read text / OCR</button><span class="small" id="siReadStatus">Reads the title block from the PDF text (OCR for a scan) and fills empty fields only; review before saving.</span></div>
    <p class="small" style="margin-top:8px">Measurements on this sheet take its building and floor unless they are given their own. The sheet no. and revision are used by the revision quantity compare. Suggestions are not saved until you review and save them.</p>`, "Save",
    () => { const o = {}; F.forEach(([k]) => { const x = $("si_" + k).value.trim(); if (x) o[k] = x; }); return o; }, "si_no");
  $("siRead").onclick = async () => {
    const status = $("siReadStatus"); if (!status) return;
    $("siRead").disabled = true; status.textContent = "Reading PDF text…";
    try {
      let T = await pageTexts(S.fileId, S.pageNo), usedOcr = false;
      if (T.filter(t => !t.ocr).length < 3 && !(P.proj.ocr || {})[S.key]) {   // a scan: read it with OCR first (kept with the project)
        status.textContent = "No text layer — reading the sheet with OCR…";
        const r = await ocrPages([S.key], {dpi: 200}); if (!r.pages) throw new Error("OCR could not read this sheet");
        T = await pageTexts(S.fileId, S.pageNo); usedOcr = true;
      }
      const sz = await pageSize(S.fileId, S.pageNo), guesses = Object.assign(sheetInfoSuggestions(T), sz ? sheetGuessFor(T, sz) : {}), keys = Object.keys(guesses);
      keys.forEach(k => { const field = $("si_" + k); if (field && !field.value.trim()) field.value = guesses[k]; });
      if (!keys.length) status.textContent = `Read ${T.length} text entries${usedOcr ? " with OCR" : " from the PDF"}; no labeled sheet fields were recognized.`;
      else status.textContent = `${usedOcr ? "OCR" : "PDF text"} suggested ${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.map(k => F.find(f => f[0] === k)[1]).join(", ")}. Review before saving.`;
    } catch (e) {
      const current = $("siReadStatus"); if (current) current.textContent = e.message || String(e);
    } finally { const b = $("siRead"); if (b) b.disabled = false; }
  };
  if (readFirst) $("siRead").click();
  const v = await dlg;
  if (!v) return;
  mutate(() => { P.proj.sheets[S.key] = v; });
}

/* ------------------------------------------------------------------ QA: Measured → Checked, or Recheck required */
const QA_NAMES = {"": "Measured", checked: "Checked", recheck: "Recheck required"};
const needsReview = it => (it.ai || it.copied) && it.qa !== "checked";
function qaUser(){ return pref("zdTakeoffUser") || ""; }
async function askUser(){
  let u = qaUser(); if (u) return u;
  const v = await ask("Your name", '<div class="fg w2"><label>Name for the QA record (kept in this browser)</label><input type="text" id="dlgUser" placeholder="e.g. Sajjad"></div>', "Save", () => { const n = $("dlgUser").value.trim(); return n ? {n} : "Enter your name"; }, "dlgUser");   // (a plain string from read() is an error message to ask(): the name goes in an object)
  if (!v) return ""; pref("zdTakeoffUser", v.n); return v.n;
}
async function setQa(items, qa){
  if (!items.length) return;
  const by = qa ? await askUser() : ""; if (qa && !by) return;
  const at = new Date().toISOString();
  mutate(() => items.forEach(it => { it.qa = qa; it.qaBy = qa ? by : ""; it.qaAt = qa ? at : ""; }));
}
function qaCounts(){
  const its = P.proj.items, used = new Set(its.map(i => i.cond)), rate = P.proj.conds.reduce((a, c) => a + (used.has(c.id) || (c.asm || []).length ? [c].concat(c.asm || []).filter(o => { const r = rateOf(o, o === c ? c.unit : o.unit); return r.na || !(r.rate > 0); }).length : 0), 0);
  return {n: its.length, checked: its.filter(i => i.qa === "checked").length, recheck: its.filter(i => i.qa === "recheck").length, review: its.filter(needsReview).length,
          boq: P.proj.conds.filter(c => used.has(c.id) && !String(c.boq || "").trim()).length, ai: its.filter(i => i.ai && i.qa !== "checked").length, copied: its.filter(i => i.copied && i.qa !== "checked").length, rate,
          scale: Object.values(P.proj.scales).filter(s => !s.verified).length + new Set(its.filter(i => !itemScale(i)).map(i => keyOf(i.file, i.page))).size};
}
function qaFilterOk(it){ const f = S.qaFilter; return !f || (f === "checked" ? it.qa === "checked" : f === "pending" ? it.qa !== "checked" : f === "recheck" ? it.qa === "recheck" : f === "review" ? needsReview(it) : true); }
/* the next measurement not yet checked, in page order across every PDF (after the selected one); it is opened, selected and zoomed to */
async function nextUnchecked(dir){
  dir = dir === -1 ? -1 : 1;
  if (!P.proj) return;
  const fi = id => P.proj.files.findIndex(f => f.id === id);
  const L = P.proj.items.map((it, n) => ({it, n})).filter(o => o.it.qa !== "checked" && !hiddenItem(o.it) && fi(o.it.file) >= 0)
    .sort((a, b) => fi(a.it.file) - fi(b.it.file) || a.it.page - b.it.page || a.n - b.n).map(o => o.it);
  if (!L.length) return toast("Every measurement is checked ✓", 3000);
  const cur = S.sel && L.findIndex(x => x.id === S.sel);
  let k = cur != null && cur >= 0 ? (cur + dir + L.length) % L.length : L.findIndex(x => fi(x.file) > fi(S.fileId) || (x.file === S.fileId && x.page >= S.pageNo));
  if (cur == null || cur < 0) { if (k < 0) k = dir > 0 ? 0 : L.length - 1; else if (dir < 0) k = (k - 1 + L.length) % L.length; }
  const it = L[k];
  if (it.file !== S.fileId || it.page !== S.pageNo) await gotoPage(it.file, it.page);
  setTool("select"); setSel([it.id]); zoomTo([it.id]); refresh();
  const c = cond(it.cond);
  toast("Unchecked " + (k + 1) + " of " + L.length + " — " + (it.label || (c ? c.name : "measurement")) + " · " + pageName(it) + (it.qa === "recheck" ? " · marked RECHECK" : ""), 3500);
}
function renderQaBar(){
  const el = $("qaBar"); if (!P.proj || !P.proj.items.length) { el.innerHTML = ""; el.style.display = "none"; return; }
  const q = qaCounts(), ch = (f, n, t, cls) => `<button class="qa${cls ? " " + cls : ""}${S.qaFilter === f ? " on" : ""}" data-qf="${f}" title="Show only these on the sheet">${n} ${t}</button>`;
  el.style.display = "";
  el.innerHTML = ch("", q.n, "measured") + ch("checked", q.checked, "checked", "g") + ch("pending", q.n - q.checked, "pending") + ch("recheck", q.recheck, "recheck", q.recheck ? "r" : "") +
    ch("review", q.review, "AI / copied to check", q.review ? "a" : "") + `<span class="qa${q.rate ? " a" : ""}" title="Bill lines without a usable rate">${q.rate} missing rate</span><span class="qa${q.boq ? " a" : ""}" title="Conditions with measurements but no BOQ code">${q.boq} no BOQ code</span><span class="qa${q.scale ? " a" : ""}" title="Page scales not verified, or measurements on a page with no scale">${q.scale} unverified scale</span>` +
    (S.page ? `<button class="btn sm" data-qact="page" title="Mark every measurement on this page as checked by you">✓ Check this page</button>` : "") +
    (q.n - q.checked ? `<button class="btn sm" data-qact="prev" title="Go to the previous measurement not yet checked — on any page">&#8592; Prev</button><button class="btn sm" data-qact="next" title="Go to the next measurement not yet checked — on any page">Next unchecked &#8594;</button>` : "");
}

/* ------------------------------------------------------------------ rates from the ZD Rate Analysis library.
   The Rate Analysis app (SAJ QSCOST, same site) keeps its library in this browser under SAJ_QSCOST_v1; an item's built-up
   rate is worked out exactly as it does (raCalc): materials + wastage + labour + plant + access + transport, then OH and
   profit. Nothing is assumed: a code that is missing, priced in another unit, or with unrated rows gives RATE NOT AVAILABLE. */
const RA_KEY = "SAJ_QSCOST_v1";
let RAL = null;
function raLib(){
  if (RAL && Date.now() - RAL.t < 3000) return RAL;
  let o = null; try { o = JSON.parse(localStorage.getItem(RA_KEY) || "null"); } catch (e) { o = null; }
  RAL = o && Array.isArray(o.items) && Array.isArray(o.rates) ? {o, t: Date.now(), items: new Map(o.items.map(i => [String(i.code || i.id).toUpperCase(), i])), rates: new Map(o.rates.map(r => [r.code, r]))} : {o: null, t: Date.now()};
  return RAL;
}
const raNum = x => { const t = parseFloat(String(x == null ? "" : x).replace(/,/g, "")); return isFinite(t) ? t : 0; };
function raPrice(code){
  const L = raLib(); if (!L.o) return {err: "lib"};
  const it = L.items.get(String(code).trim().toUpperCase()); if (!it) return {err: "code"};
  const rec = r => r.ref ? L.rates.get(r.ref) : null, rr = r => r.ref ? raNum((rec(r) || {}).rate) : raNum(r.rate), amt = r => r.mode === "lump" ? raNum(r.rate) : raNum(r.qty) * rr(r);
  const sum = a => (a || []).reduce((s, r) => s + amt(r), 0), rows = [].concat(it.M || [], it.L || [], it.P || []);
  const A = sum(it.M), C = sum(it.L), D = sum(it.P), B = A * raNum(it.wast) / 100, sub = A + B + C + D + raNum(it.acc) + raNum(it.trans), G = sub * raNum(it.oh) / 100;
  const H = ((L.o.set || {}).profOnOh ? sub + G : sub) * raNum(it.prof) / 100;
  const live = rows.filter(r => raNum(r.qty) !== 0 && !r.opt);
  const dates = live.map(r => (rec(r) || {}).date).filter(Boolean).sort();
  return {code: it.code || it.id, desc: it.desc || "", unit: it.unit || "", rate: sub + G + H, M: A, L: C, Pl: D, oh: G, prof: H,
          gaps: live.filter(r => rr(r) === 0 && r.mode !== "lump").length, assumed: live.filter(r => (r.ref ? (rec(r) || {}).vs || "A" : r.rate ? "V" : "A") === "A").length, d0: dates[0] || "", d1: dates[dates.length - 1] || ""};
}
const normU = u => { u = String(u || "").trim().toLowerCase().replace(/\.$/, ""); return u === "rft" || u === "ft" || u === "rm" ? "ft" : u === "no" || u === "nos" || u === "each" || u === "nr" ? "nos" : u === "kgs" ? "kg" : u; };
/* rate of a condition (rate, rateSrc, rateDate) or assembly line (rate, src, date), either typed or linked by RA code */
function rateOf(o, unit){
  const ra = String(o.ra || "").trim();
  if (!ra) return {rate: +o.rate || 0, src: o.rateSrc != null ? o.rateSrc : o.src || "", date: o.rateDate != null ? o.rateDate : o.date || ""};
  const r = raPrice(ra);
  if (r.err === "lib") return o.raCache && o.raCache.code === ra && normU(o.raCache.unit) === normU(unit) ? Object.assign({}, o.raCache, {ra, cached: true}) : {rate: 0, ra, na: "RATE NOT AVAILABLE — the Rate Analysis library is not in this browser (open SAJ QSCOST → Rate Analysis on this site once)"};
  if (r.err === "code") return {rate: 0, ra, na: "RATE NOT AVAILABLE — " + ra + " is not in the Rate Analysis library"};
  if (normU(r.unit) !== normU(unit)) return {rate: 0, ra, na: `RATE NOT AVAILABLE — ${ra} is priced per ${r.unit}, this line is in ${unit}`};
  if (r.gaps) return {rate: 0, ra, na: `RATE NOT AVAILABLE — ${ra} has ${r.gaps} unrated row${r.gaps > 1 ? "s" : ""} in Rate Analysis`};
  const out = {rate: r.rate, ra, unit: r.unit, date: today(), src: `ZD Rate Analysis ${r.code}, ${dmy(today())} — built-up rate (material ${f2(r.M)} + labour ${f2(r.L)} + plant ${f2(r.Pl)} + OH ${f2(r.oh)} + profit ${f2(r.prof)})${r.d1 ? "; resource rates dated " + dmy(r.d0) + " to " + dmy(r.d1) : ""}${r.assumed ? "; " + r.assumed + " row" + (r.assumed > 1 ? "s" : "") + " ASSUMPTION — no dated source" : ""}`, assumed: r.assumed};
  const cache = {code: ra, rate: out.rate, unit: r.unit, date: out.date, src: out.src};
  if (!o.raCache || o.raCache.rate !== cache.rate || o.raCache.src !== cache.src) { o.raCache = cache; save(); }
  return out;
}

/* ------------------------------------------------------------------ check before export */
function validate(){
  const out = [], E = (lvl, msg) => out.push({lvl, msg});
  if (!P.proj.items.length) E("WARNING", "Nothing is measured yet");
  const noSc = new Map(); P.proj.items.forEach(it => { if (!itemScale(it)) noSc.set(keyOf(it.file, it.page), (noSc.get(keyOf(it.file, it.page)) || 0) + 1); });
  noSc.forEach((n, k) => E("ERROR", `${keyName(k)}: scale not set — ${n} measurement${n > 1 ? "s" : ""} left out of the totals`));
  Object.entries(P.proj.scales).forEach(([k, sc]) => { if (!sc.verified && P.proj.items.some(it => keyOf(it.file, it.page) === k)) E("WARNING", `${keyName(k)}: scale ${scaleState(sc).t.toLowerCase()} — verify with a known dimension`); });
  P.proj.items.forEach(it => { if (!cond(it.cond)) E("ERROR", `A measurement on ${pageName(it)} belongs to a deleted condition`); });
  P.proj.conds.forEach(c => {
    const its = P.proj.items.filter(i => i.cond === c.id); if (!its.length) return;
    if (c.type === "linear" && c.unit !== "ft" && !(+c.h > 0)) E("ERROR", `${c.name}: height H missing (needed for ${c.unit})`);
    if (c.unit === "cft" && !(+c.t > 0)) E("ERROR", `${c.name}: thickness T missing (needed for cft)`);
    if (!String(c.boq || "").trim()) E("WARNING", `${c.name}: no BOQ code`);
    const t = condTotals(c); if (t.net < 0) E("ERROR", `${c.name}: net quantity is negative (${fq(t.net, c.unit)} ${c.unit}) — deductions exceed the gross`);
    its.forEach(it => { const k = itemScale(it); if (!k) return; const q = rowsOf(it, k).reduce((a, r) => a + Math.abs(r.qty), 0);
      if (!(q > 0) && !rowsOf(it, k).some(r => r.below)) E("ERROR", `${c.name} — ${it.label || kindName(it, c)} on ${pageName(it)}: zero quantity`);
      if (it.kind === "open" && c.unit !== "ft" && !(openH(it) > 0)) E("ERROR", `${c.name} — opening ${it.label || ""} on ${pageName(it)}: height missing`);
      if (crossed(it)) E("ERROR", `${c.name} — ${it.label || kindName(it, c)} on ${pageName(it)}: the outline crosses itself, so its area is not the area drawn`);
      if (!locOf(it).floor) noFloor.add(c.name); });
  });
  if (noFloor.size) E("WARNING", `No floor given (Sheet info or the measurement) for some measurements of: ${[...noFloor].join(", ")}`);
  billLines().forEach(l => {
    if (l.err) E("ERROR", `${l.name}: formula error — ${l.err}`);
    else if (l.na) E("WARNING", `${l.name}: ${l.na}`);
    else if (!(l.rate > 0)) E("WARNING", `${l.name}: rate not set`);
    else if (!rateOk(l)) E("WARNING", `${l.name}: rate has no dated source — ASSUMPTION`);
  });
  dupFind().forEach(d => E("WARNING", d.count ? `${d.c.name} on ${pageName(d.a)}: ${d.n} count marker${d.n > 1 ? "s" : ""} placed twice on the same spot — counted twice`
    : `${d.c.name} — ${d.a.label || kindName(d.a, d.c)} on ${pageName(d.a)} is drawn twice (same outline${d.b.label && d.b.label !== d.a.label ? " as " + d.b.label : ""}) — counted twice`));
  floorGaps().forEach(g => E("WARNING", `${g.c.name}: measured on ${g.have} floor${g.have > 1 ? "s" : ""}${g.bldg ? " of " + g.bldg : ""} but not on ${g.miss.join(", ")} — check nothing was missed there`));
  const rc = P.proj.items.filter(i => i.qa === "recheck").length, ai = P.proj.items.filter(i => i.ai && i.qa !== "checked").length, cp = P.proj.items.filter(i => i.copied && i.qa !== "checked").length;
  if (rc) E("ERROR", `${rc} measurement${rc > 1 ? "s" : ""} marked Recheck required`);
  if (ai) E("WARNING", `${ai} AI-generated measurement${ai > 1 ? "s" : ""} not yet checked`);
  if (cp) E("WARNING", `${cp} typical-floor cop${cp > 1 ? "ies" : "y"} not yet checked`);
  return out;
}
/* measurements drawn twice: same condition, page and kind, every point within 1 pt of the other's; for counts, two
   markers of one condition on one spot */
function dupFind(){
  const out = [], groups = new Map(), D = 1;
  P.proj.items.forEach(it => { const c = cond(it.cond); if (!c || !Array.isArray(it.pts) || !it.pts.length) return;
    const k = [it.file, it.page, it.cond, c.type === "count" ? "" : it.kind + "|" + (it.shape || "")].join("|"); if (!groups.has(k)) groups.set(k, {c, its: []}); groups.get(k).its.push(it); });
  groups.forEach(({c, its}) => {
    if (c.type === "count") {   // markers sorted by x, each compared with the ones close to it
      const M = []; its.forEach(it => it.pts.forEach(p => M.push({p, it}))); M.sort((a, b) => a.p[0] - b.p[0]);
      let n = 0, first = null;
      for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length && M[j].p[0] - M[i].p[0] <= D; j++) if (Math.abs(M[j].p[1] - M[i].p[1]) <= D) { n++; first = first || M[i].it; break; }
      if (n) out.push({c, a: first, n, count: true});
      return;
    }
    if (its.length < 2) return;
    const cen = it => it.pts.reduce((a, p) => [a[0] + p[0] / it.pts.length, a[1] + p[1] / it.pts.length], [0, 0]);
    const L = its.map(it => ({it, m: cen(it)})).sort((a, b) => a.m[0] - b.m[0]), used = new Set();
    const same = (A, B) => A.length === B.length && A.every(p => B.some(q => Math.abs(p[0] - q[0]) <= D && Math.abs(p[1] - q[1]) <= D)) && B.every(p => A.some(q => Math.abs(p[0] - q[0]) <= D && Math.abs(p[1] - q[1]) <= D));
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].m[0] - L[i].m[0] <= D; j++) {
      if (used.has(L[j].it.id) || Math.abs(L[j].m[1] - L[i].m[1]) > D || !same(L[i].it.pts, L[j].it.pts)) continue;
      used.add(L[j].it.id); out.push({c, a: L[i].it, b: L[j].it});
    }
  });
  return out;
}
/* a condition taken off on most floors of a building but missing on another floor of it that has other measurements
   (tiles on GF, FF and SF but none on TF) — a reminder, since a roof or a basement may rightly have none */
function floorGaps(){
  const B = new Map(), out = [];
  P.proj.items.forEach(it => { if (!cond(it.cond)) return; const L = locOf(it); if (!L.floor) return;
    if (!B.has(L.bldg)) B.set(L.bldg, {floors: new Set(), by: new Map()}); const b = B.get(L.bldg); b.floors.add(L.floor);
    if (!b.by.has(it.cond)) b.by.set(it.cond, new Set()); b.by.get(it.cond).add(L.floor); });
  B.forEach((b, bldg) => { if (b.floors.size < 3) return;
    b.by.forEach((fl, cid) => { const miss = [...b.floors].filter(f => !fl.has(f)).sort((x, y) => x.localeCompare(y, undefined, {numeric: true}));
      if (fl.size >= 2 && miss.length && fl.size * 2 >= b.floors.size) out.push({c: cond(cid), bldg, have: fl.size, miss}); }); });
  return out;
}
const noFloor = new Set();
function validation(){ noFloor.clear(); const L = validate(), lvl = L.some(x => x.lvl === "ERROR") ? "ERROR" : L.length ? "WARNING" : "PASS"; return {lvl, L}; }
const lvlCol = l => l === "ERROR" ? "var(--red)" : l === "WARNING" ? "var(--amber)" : "var(--green)";

/* ------------------------------------------------------------------ opening schedule: D1 = 3.000 × 7.000 once, reused */
async function openingsDialog(){
  const rows = JSON.parse(JSON.stringify(P.proj.openings || [])), used = id => P.proj.items.filter(i => i.sch === id).length;
  const row = (o, n) => `<tr data-r="${n}"><td><input type="text" data-k="mark" value="${esc(o.mark)}" placeholder="D1"></td><td><select data-k="type">${["door", "window", "other"].map(t => `<option${o.type === t ? " selected" : ""}>${t}</option>`).join("")}</select></td>
    <td><input type="text" data-k="w" value="${o.w ? f3(o.w) : ""}" placeholder="3'-0&quot;"></td><td><input type="text" data-k="h" value="${o.h ? f3(o.h) : ""}" placeholder="7'-0&quot;"></td><td class="small">${used(o.id)}</td>
    <td>${used(o.id) ? "" : `<button class="btn sm dng" data-del="${n}" type="button">&times;</button>`}</td></tr>`;
  const html = () => `<table class="asm"><thead><tr><th>Mark</th><th>Type</th><th>Width ft</th><th>Height ft</th><th>Used</th><th></th></tr></thead><tbody id="opB">${rows.map(row).join("")}</tbody></table>
    <button class="btn sm" id="opAdd" type="button" style="margin-top:6px">+ Mark</button>
    <p class="small" style="margin-top:8px">Sizes from the door / window schedule of the drawings — not assumed. Changing a size here changes every opening placed with that mark. Doors (type door) are taken off the skirting (PD); windows are not.</p>`;
  const read = () => document.querySelectorAll("#opB tr").forEach(tr => { const o = rows[+tr.dataset.r]; tr.querySelectorAll("[data-k]").forEach(inp => { o[inp.dataset.k] = inp.value.trim(); }); });
  const pr = ask("Opening schedule", html(), "Save", () => { read(); const seen = new Set();
    for (const o of rows) { if (!o.mark) return "Every row needs a mark"; if (seen.has(o.mark.toUpperCase())) return "Mark " + o.mark + " is listed twice"; seen.add(o.mark.toUpperCase());
      const w = parseFt(o.w), h = parseFt(o.h); if (!(w > 0) || !(h > 0)) return o.mark + ": enter width and height (ft or ft-in)"; o.w = w; o.h = h; }
    return rows; });
  const wire = () => { $("opAdd").onclick = () => { read(); rows.push({id: uid("O"), mark: "", type: "door", w: "", h: ""}); $("opB").innerHTML = rows.map(row).join(""); wire(); };
    document.querySelectorAll("#opB [data-del]").forEach(b => b.onclick = () => { read(); rows.splice(+b.dataset.del, 1); $("opB").innerHTML = rows.map(row).join(""); wire(); }); };
  wire();
  const v = await pr; if (!v) return;
  mutate(() => { P.proj.openings = v; P.proj.items.forEach(i => { const s = i.sch && v.find(o => o.id === i.sch); if (s) i.label = s.mark; }); });
}

/* ------------------------------------------------------------------ revision quantity compare → Change Management */
function qtyOn(keys){   // bill lines measured on the given pages only
  const ks = new Set(keys); return billLines(it => ks.has(keyOf(it.file, it.page)));
}
async function revCompareDialog(){
  if (!P.proj.items.length) return toast("Measure both revisions first");
  const pages = allPages(), sh = k => (P.proj.sheets || {})[k] || {}, cur = sh(S.key);
  const isNew = o => o.key === S.key, isOld = o => o.key !== S.key && (S.cmp ? keyOf(S.cmp.file, S.cmp.page) === o.key : !!(cur.no && sh(o.key).no === cur.no && sh(o.key).rev !== cur.rev));
  const lbl = o => `${esc(sh(o.key).no ? sh(o.key).no + (sh(o.key).rev ? " " + sh(o.key).rev : "") + " · " : "")}${esc(o.f.name.replace(/\.pdf$/i, ""))} — p.${o.i} <span class="small">${P.proj.items.filter(it => keyOf(it.file, it.page) === o.key).length} measurements</span>`;
  const A = pages.map(o => Object.assign({}, o, {on: isOld(o), html: lbl(o)})), B = pages.map(o => Object.assign({}, o, {on: isNew(o), html: lbl(o)}));
  const v = await ask("Revision quantity compare", `<p>Quantities measured on the <b>old</b> sheets against the <b>new</b> sheets, per condition and assembly item. Give each sheet its no. and revision in <b>Sheet info</b> to pick them faster.</p>
    <div class="grid" style="margin-top:6px"><div class="fg"><label>Old revision — sheets</label>${pageList(A, "ro")}</div><div class="fg"><label>New revision — sheets</label>${pageList(B, "rn")}</div></div>`, "Compare",
    () => { const o = [...document.querySelectorAll("[data-ro]")].filter(x => x.checked).map(x => A[+x.dataset.ro].key), n = [...document.querySelectorAll("[data-rn]")].filter(x => x.checked).map(x => B[+x.dataset.rn].key);
      if (!o.length || !n.length) return "Tick at least one old and one new sheet"; if (o.some(k => n.includes(k))) return "A sheet cannot be both old and new"; return {o, n}; });
  if (!v) return;
  const rows = revRows(v.o, v.n), rl = ks => [...new Set(ks.map(k => { const s = sh(k); return s.no ? s.no + (s.rev ? " " + s.rev : "") : keyName(k); }))].join(", ");
  const tot = rows.reduce((a, r) => a + (r.cost || 0), 0);
  $("dlgT").textContent = "Revision quantity compare";
  $("dlgB").innerHTML = `<p class="small">Old: <b>${esc(rl(v.o))}</b> → New: <b>${esc(rl(v.n))}</b></p>
    <div style="overflow:auto;margin-top:6px"><table class="sh"><thead><tr><th>Item</th><th class="n">Old</th><th class="n">New</th><th class="n">Variance</th><th class="n">%</th><th class="n">Cost impact PKR</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.kind === "asm" ? "" : "ch2"}"><td>${r.kind === "asm" ? "↳ " : ""}${esc(r.name)} <span class="small">${esc(r.unit)}</span>${r.boq ? `<div class="ds">${esc(r.boq)}</div>` : ""}</td><td class="n">${fq(r.old, r.unit)}</td><td class="n">${fq(r.neu, r.unit)}</td>
      <td class="n" style="color:${r.var > 0 ? "var(--red)" : r.var < 0 ? "var(--green)" : "inherit"}">${r.var > 0 ? "+" : ""}${fq(r.var, r.unit)}</td><td class="n">${r.pct == null ? "new" : (r.pct > 0 ? "+" : "") + r.pct.toFixed(2) + "%"}</td><td class="n">${r.cost == null ? `<span class="small" title="${esc(r.na || "rate not set")}">no rate</span>` : f2(r.cost)}</td></tr>`).join("")}
    <tr class="tot"><td>Total cost impact (lines with a rate)</td><td></td><td></td><td></td><td></td><td class="n">${f2(tot)}</td></tr></tbody></table></div>
    <p class="small" style="margin-top:8px">Variance = new − old. Cost impact = variance × the line's rate; lines without a usable rate show “no rate” — never assumed.</p>`;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button><button class="btn pri" id="rcCsv">Change Management CSV</button>`;
  $("dlgBack").classList.add("on");
  $("dlgCancel").onclick = () => $("dlgBack").classList.remove("on");
  $("rcCsv").onclick = () => revCsv(rows, v.o, v.n);
}
function revRows(oldKeys, newKeys){
  const O = qtyOn(oldKeys), N = qtyOn(newKeys), id = l => l.c.id + "|" + (l.kind === "asm" ? l.a.id || l.name : ""), out = [];
  const all = new Map(); O.forEach(l => all.set(id(l), {l, o: l.qty, n: 0})); N.forEach(l => { const x = all.get(id(l)); if (x) { x.n = l.qty; x.l = l; } else all.set(id(l), {l, o: 0, n: l.qty}); });
  all.forEach(({l, o, n}) => { const v = n - o, rated = !l.na && l.rate > 0;
    if (Math.abs(o) < 1e-9 && Math.abs(n) < 1e-9) return;
    out.push({kind: l.kind, name: l.name, unit: l.unit, boq: l.boq || "", old: o, neu: n, var: v, pct: Math.abs(o) > 1e-9 ? v / o * 100 : null, rate: rated ? l.rate : null, cost: rated ? v * l.rate : null, na: l.na || (rated ? "" : "rate not set"), src: rated ? l.src + (l.date ? ", " + dmy(l.date) : "") : ""}); });
  return out;
}
function revCsv(rows, oldKeys, newKeys){
  const sh = k => (P.proj.sheets || {})[k] || {}, refs = ks => [...new Set(ks.map(k => { const s = sh(k); return s.no ? s.no + (s.rev ? " " + s.rev : "") : keyName(k); }))].join(" / ");
  const locs = ks => [...new Set(ks.map(k => [sh(k).bldg, sh(k).floor].filter(Boolean).join(" ")).filter(Boolean))].join(" / ");
  const H = ["Log ID", "Project", "Date Raised", "Discipline", "Raised By", "Type", "Location / Area", "Drawing / Spec Ref.", "Description of Issue / Change", "Reason for Change", "Cost Impact (Y/N)", "Est. Cost Impact", "Schedule Impact (Y/N)", "Status", "Remarks",
             "Item", "BOQ Code", "Unit", "Old Qty", "New Qty", "Qty Variance", "Variance %", "Rate (PKR)"];
  const disc = [...new Set(newKeys.map(k => sh(k).disc).filter(Boolean))].join(" / ");
  const L = rows.filter(r => Math.abs(r.var) > 1e-9).map(r => ["", P.proj.name, today(), disc, qaUser(), "Drawing revision", locs(newKeys), refs(oldKeys) + " → " + refs(newKeys),
    `${r.name}: ${f3(r.old)} → ${f3(r.neu)} ${r.unit} (${r.var > 0 ? "+" : ""}${f3(r.var)})`, "Drawing revision — USER INPUT REQUIRED", r.cost == null ? "" : r.cost !== 0 ? "Y" : "N", r.cost == null ? "" : r.cost.toFixed(2), "", "Pending",
    r.cost == null ? r.na : "Rate: " + r.src, r.name, r.boq, r.unit, r.old.toFixed(3), r.neu.toFixed(3), r.var.toFixed(3), r.pct == null ? "" : r.pct.toFixed(2), r.rate == null ? "" : r.rate.toFixed(2)]);
  if (!L.length) return toast("No quantity changed between the two revisions");
  const t = [H].concat(L).map(r => r.map(v => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n");
  saveBlob(new Blob(["﻿" + t], {type: "text/csv;charset=utf-8"}), fileBase() + "_Revision_Change.csv");
}

/* ------------------------------------------------------------------ backups: last 10 copies of each project in this browser */
const BAK_KEEP = 10;
async function backupsOf(pid){ return (await tx("backups", "readonly", s => s.index("pid").getAll(pid))).sort((a, b) => b.at.localeCompare(a.at)); }
async function backupNow(why, pr){
  pr = pr || P.proj; if (!pr || !DB) return false;
  const data = JSON.stringify(pr), list = await backupsOf(pr.id);
  if (list[0] && list[0].data === data) return false;   // nothing changed since the last one
  await dbPut("backups", {id: uid("B"), pid: pr.id, name: pr.name, at: new Date().toISOString(), why: why || "", n: (pr.items || []).length, data});
  for (const b of list.slice(BAK_KEEP - 1)) await dbDel("backups", b.id);
  return true;
}
async function backupsDialog(pid){
  pid = pid || (P.proj && P.proj.id); if (!pid) return;
  const pr = await dbGet("projects", pid), list = await backupsOf(pid);
  const fmt = iso => dmy(iso) + " " + iso.slice(11, 16);
  $("dlgT").textContent = "Backups — " + (pr ? pr.name : "");
  $("dlgB").innerHTML = `<p class="small">The last ${BAK_KEEP} copies of this project kept in this browser: when it is opened, every 10 minutes while you work, and before a restore. PDFs are not copied (they do not change).</p>
    ${list.length ? `<table class="sh" style="margin-top:8px"><thead><tr><th>Saved</th><th>Why</th><th class="n">Measurements</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td>${esc(fmt(b.at))}</td><td>${esc(b.why)}</td><td class="n">${b.n}</td><td class="n"><button class="btn sm" data-rest="${esc(b.id)}">Restore</button></td></tr>`).join("")}</tbody></table>` : '<p style="margin-top:8px">No backup yet.</p>'}`;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button>${P.proj && P.proj.id === pid ? '<button class="btn pri" id="bakNow">Back up now</button>' : ""}`;
  $("dlgBack").classList.add("on");
  $("dlgCancel").onclick = () => $("dlgBack").classList.remove("on");
  if ($("bakNow")) $("bakNow").onclick = async () => { savePr = P.proj; await flushSave(); toast((await backupNow("manual")) ? "Backed up" : "No change since the last backup"); backupsDialog(pid); };
  $("dlgB").querySelectorAll("[data-rest]").forEach(b => b.onclick = async () => {
    const bk = list.find(x => x.id === b.dataset.rest), old = JSON.parse(bk.data);
    const ok = await ask("Restore this backup?", `<p>Replace <b>${esc(pr ? pr.name : "")}</b> (${pr ? pr.items.length : 0} measurements, changed ${esc(pr ? fmt(pr.updated) : "—")}) with the backup of <b>${esc(fmt(bk.at))}</b> (${bk.n} measurements)?</p><p class="small" style="margin-top:6px">The project as it is now is backed up first, so this can be undone from this list.</p>`, "Restore");
    if (!ok) return backupsDialog(pid);
    if (P.proj && P.proj.id === pid) { savePr = P.proj; await flushSave(); }
    const cur = await dbGet("projects", pid); if (cur) await backupNow("before restore", cur);
    old.id = pid; migrate(old); old.updated = new Date().toISOString(); await dbPut("projects", old);
    if (P.proj && P.proj.id === pid) await openProject(pid); else showStart();
    toast("Restored the backup of " + fmt(bk.at), 4000);
  });
}
setInterval(() => { if (P.proj && document.visibilityState !== "hidden") { savePr = P.proj; flushSave().then(ok => ok && backupNow("every 10 min")).catch(() => {}); } }, 600000);
/* leaving or hiding the page writes the pending change at once (the 300 ms timer would not run) */
window.addEventListener("pagehide", () => { flushSave(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });
window.addEventListener("beforeunload", () => { flushSave(); });

/* ------------------------------------------------------------------ project import: lossless, then validated */
async function importProject(text, pre){
  let o; try { o = JSON.parse(text); } catch (e) { throw new Error("the file is not valid JSON"); }
  if (!o || o.format !== "zd-takeoff" || !Array.isArray(o.items)) throw new Error("not a takeoff project file");
  const pr = JSON.parse(JSON.stringify(o)); delete pr.format; delete pr.exported;
  pr.id = uid("P"); pr.name = pr.name || "Imported takeoff"; pr.created = pr.created || new Date().toISOString(); pr.updated = new Date().toISOString();
  const repairs = [], fromV = migrate(pr, repairs);
  await dbPut("projects", pr);
  const back = await dbGet("projects", pr.id), miss = [];
  const diff = [];
  for (const f of back.files) { const h = await pdfSha(f.id); if (h === null) miss.push(f.name); else if (f.sha && h && h !== f.sha) diff.push(f.name); }
  const cnt = v => Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.values(v).reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0) : v == null ? 0 : 1;
  const ref = JSON.parse(JSON.stringify(o)); migrate(ref);   // the file as upgraded: defaults a v1 file lacks are not losses
  const same = k => JSON.stringify(ref[k] === undefined ? null : ref[k]) === JSON.stringify(back[k] === undefined ? null : back[k]);
  const rows = (pre || []).slice(), add = (what, a, b, st, note) => rows.push({what, a, b, st, note});
  [["files", "PDFs"], ["conds", "Conditions"], ["items", "Measurements"], ["scales", "Page scales"], ["viewports", "Viewports"], ["marks", "Markups"], ["sheets", "Sheet info"], ["openings", "Opening schedule"]].forEach(([k, n]) =>
    add(n, cnt(o[k]), cnt(back[k]), o[k] === undefined || (same(k) && cnt(o[k]) === cnt(back[k])) ? "PASS" : "FAIL", o[k] === undefined ? "not in this file (older version) — empty" : cnt(o[k]) !== cnt(back[k]) ? "the file holds entries that could not be read — see Repaired below" : ""));
  repairs.forEach(r => add("Repaired", "", "", /left out|removed/.test(r) ? "FAIL" : "WARNING", r));
  ["auto", "layersOff", "last"].forEach(k => { if (o[k] !== undefined) add({auto: "Auto area settings", layersOff: "PDF layers off", last: "Last page"}[k], "kept", same(k) ? "kept" : "changed", same(k) ? "PASS" : "FAIL", ""); });
  const known = new Set(["format", "exported", "id", "name", "created", "updated", "v", "files", "conds", "items", "scales", "viewports", "marks", "sheets", "openings", "auto", "layersOff", "last"]);
  Object.keys(o).filter(k => !known.has(k)).forEach(k => add("Other: " + k, "kept", same(k) ? "kept" : "changed", same(k) ? "PASS" : "FAIL", "kept as it was"));
  const orphanC = back.items.filter(i => !back.conds.some(c => c.id === i.cond)).length, orphanF = back.items.filter(i => !back.files.some(f => f.id === i.file)).length;
  add("Measurements → condition", back.items.length, back.items.length - orphanC, orphanC ? "FAIL" : "PASS", orphanC ? orphanC + " point to a condition that is not in the file" : "");
  add("Measurements → PDF", back.items.length, back.items.length - orphanF, orphanF ? "FAIL" : "PASS", orphanF ? orphanF + " point to a PDF that is not in the file" : "");
  add("PDFs attached in this browser", back.files.length, back.files.length - miss.length, miss.length ? "WARNING" : "PASS", miss.length ? "add " + miss.join(", ") + " with + PDF — checked against the drawing it was measured on" : "");
  if (diff.length) add("PDFs are the drawings measured on", back.files.length - miss.length, back.files.length - miss.length - diff.length, "FAIL", "the copy of " + diff.join(", ") + " in this browser is a different drawing (content does not match) — add the right PDF with + PDF");
  add("File version", "v" + fromV, "v" + back.v, "PASS", fromV < SCHEMA ? "upgraded" : "");
  await openProject(pr.id);
  const lvl = rows.some(r => r.st === "FAIL") ? "FAIL" : rows.some(r => r.st === "WARNING") ? "WARNING" : "PASS";
  S.lastImport = {lvl, rows};
  ask("Project Import Validation — " + lvl, `<table class="sh"><thead><tr><th>Check</th><th class="n">In file</th><th class="n">Imported</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.what)}${r.note ? `<div class="ds">${esc(r.note)}</div>` : ""}</td><td class="n">${esc(r.a)}</td><td class="n">${esc(r.b)}</td><td style="font-weight:700;color:${r.st === "PASS" ? "var(--green)" : r.st === "WARNING" ? "var(--amber)" : "var(--red)"}">${r.st}</td></tr>`).join("")}</tbody></table>`, "");
  $("dlgCancel").textContent = "Close";
  return S.lastImport;
}

/* ------------------------------------------------------------------ command palette (Ctrl+K)
   Every tool, button, export, dialog, page and condition by name: type a few letters, arrows to choose, Enter to run.
   The buttons on screen are read as they are, so a tool added later is listed without being added here. */
const PAL_KEY = "zdTakeoffPal";
function palClean(t){ return String(t || "").replace(/[\u2190-\u2BFF\u{1F300}-\u{1FAFF}\uFE0F]/gu, "").replace(/\s+/g, " ").trim(); }
function paletteCmds(){
  const L = [], seen = new Set();
  const add = (t, run, g, k) => { t = palClean(t); if (!t || seen.has(g + "|" + t)) return; seen.add(g + "|" + t); L.push({t, run, g, k: k || ""}); };
  const btn = (b, g) => {
    if (b.disabled || b.closest("#dlgBack,#pal,#ctx")) return;
    const k = [...b.querySelectorAll("kbd")].map(x => x.textContent).join("+"), c = b.cloneNode(true); c.querySelectorAll("kbd,.vdot").forEach(x => x.remove());
    let t = palClean(c.textContent); const ti = palClean((b.title || "").split(/ — | \(|: /)[0]);
    if (t.length < 3) t = ti; else if (ti && ti.toLowerCase() !== t.toLowerCase() && ti.length < 50 && !ti.toLowerCase().includes(t.toLowerCase())) t = t + " — " + ti;
    add(t, () => b.click(), g, k);
  };
  if (!P.proj) {
    add("New project", () => $("bNewProj").click(), "Project"); add("Import project (.json or .zdtakeoff)", () => $("impIn").click(), "Project"); add("Full screen", fullScreen, "View");
    return L;
  }
  document.querySelectorAll("#tools [data-tool]").forEach(b => btn(b, "Tool"));
  document.querySelectorAll("#tools [data-mod]").forEach(b => btn(b, "Modify")); document.querySelectorAll("#tools [data-rv]").forEach(b => btn(b, "Check"));
  add("Ortho on / off", () => setOrtho(!S.ortho), "Tool", "F8"); add("Polar tracking on / off", () => setPolar(!S.polar), "Tool", "F10"); add("Object snaps…", () => snapPopToggle(true), "Tool");
  add("Search the measurement sheet", () => { const q = $("shQ"); if (q) { q.focus(); q.select(); } }, "View");
  Object.entries(MK_TOOL_NAMES).forEach(([t, n]) => add("Markup: " + n, () => setTool(t), "Tool"));
  add("Markups list — filter, statuses, replies, summaries (Alt+L)", () => mlToggle(true), "View");
  add("Next unchecked measurement", nextUnchecked, "Check");
  add("Check before export (errors and warnings)", exportMenu, "Check");
  add("Excel measurement sheet", exportExcel, "Export"); add("CSV", exportCsv, "Export");
  if (S.page) { add("Marked-up page (.png)", exportPng, "Export"); add("Marked-up page (.pdf)", () => exportPdf(false), "Export"); }
  add("All project sheets (.pdf)", () => exportPdf(true), "Export"); add("Project (.json) — measurements only", exportJson, "Export");
  add("Project + PDFs (.zdtakeoff) — to move to another computer", exportBundle, "Export"); add("Backups of this project", () => backupsDialog(), "Project");
  if (S.page) add("Plot / print — a window, the view or the page, at a scale", plotDialog, "Export", "Ctrl+P");
  if (S.page && cadMeta(S.fileId)) add("AutoCAD quantities — lengths, areas and blocks from the drawing", () => cadQtyDialog(), "Page");
  add("Background: black, as AutoCAD's model space", () => setBg("black"), "View"); add("Background: white", () => setBg("white"), "View"); add("Background: auto — black for AutoCAD drawings, white for PDFs", () => setBg("auto"), "View");
  add("Monochrome view on / off", () => setMono(!S.mono), "View");
  add("Export pages… — PDF, PDF per page, PNG or JPEG; pages, resolution, legend", () => exportPagesDialog(), "Export");
  add("Export the pages with takeoff as one PDF…", () => exportPagesDialog({scope: "tk", fmt: "pdf"}), "Export"); add("Export pages as PNG images (high resolution)…", () => exportPagesDialog({fmt: "png"}), "Export");
  add("Takeoff report — print or save as PDF", reportPrint, "Export");
  add("Import PDFs — choose pages, version set…", () => $("impPdfIn").click(), "Project"); add("Add a folder of PDFs…", () => $("dirIn").click(), "Project"); add("Add photos / scans as pages (JPG, PNG)…", () => $("imgIn").click(), "Project");
  add("Sheet info from the title blocks (AI read)…", () => autoSheetDialog(), "Page"); add("Read scanned pages — OCR…", () => ocrDialog(), "Page");
  add("Pages panel — search, filter, pin and tick pages", () => wsLayout("pages"), "View");
  [["takeoff", "Workspace: takeoff (all panels)"], ["focus", "Workspace: drawing only"], ["pages", "Workspace: pages + drawing"], ["check", "Workspace: pages + measurement sheet"]].forEach(([l, t]) => add(t, () => wsLayout(l), "View"));
  add("Toolbar: icons only / icons and names", () => wsSet({tb: wsPref().tb === "icons" ? "full" : "icons"}), "View"); add("Minimap on / off", () => wsSet({mini: !wsPref().mini}), "View"); add("Full screen", fullScreen, "View");
  add("Save now", () => { savePr = P.proj; flushSave().then(ok => toast(ok ? "Saved in this browser" : "Not saved — see the message above")); }, "Project", "Ctrl+S");
  add("Undo", undoAny, "Edit", "Ctrl+Z"); add("Redo", redoAny, "Edit", "Ctrl+Y");
  add("Find text on the drawings", () => { $("findIn").focus(); $("findIn").select(); }, "View", "Ctrl+F");
  add("Set scale", scaleDialog, "Page", "K"); add("Keyboard shortcuts", keysDialog, "Help");
  add("New condition", () => editCond(null), "Condition"); add("All projects", showStart, "Project");
  document.querySelectorAll("header button[id], #viewPop button[id], #qaBar button, aside button[id], .panel button[id]").forEach(b => btn(b, b.closest("#viewPop") ? "View" : b.closest("#qaBar") ? "Check" : "Button"));
  P.proj.conds.forEach(c => add("Use condition: " + c.name + " (" + (c.type === "count" ? "count" : c.unit || c.type) + ")", () => { S.cond = c.id; setTool(c.type === "count" ? "count" : "draw"); refresh(); toast("Condition: " + c.name, 1800); }, "Condition"));
  let n = 0; P.proj.files.forEach(f => { for (let i = 1; i <= f.pages && n < 600; i++, n++) { const sh = (P.proj.sheets || {})[keyOf(f.id, i)] || {}; add("Go to: " + f.name.replace(/\.pdf$/i, "") + " p." + i + (sh.no ? " · " + sh.no : "") + (sh.title ? " " + sh.title : ""), () => gotoPage(f.id, i), "Page"); } });
  return L;
}
function palScore(c, q){
  if (!q) return 1;
  const t = (c.t + " " + c.g).toLowerCase(), w = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!w.every(x => t.includes(x))) return 0;
  const tl = c.t.toLowerCase();
  return 10 + (tl.startsWith(w[0]) ? 6 : new RegExp("(^|[\\s:(—-])" + w[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(tl) ? 3 : 0) + (c.g === "Page" ? -2 : 0) - tl.length / 200;
}
function openPalette(){
  if ($("dlgBack").classList.contains("on")) return;
  let el = $("pal");
  if (!el) { el = document.createElement("div"); el.id = "pal"; el.innerHTML = '<div class="pbx" role="dialog" aria-label="Command palette"><input id="palIn" type="text" placeholder="Type a command, tool, page or condition…" autocomplete="off" spellcheck="false"><div id="palL" role="listbox"></div><div class="pf small">&#8593;&#8595; choose · Enter run · Esc close</div></div>'; document.body.appendChild(el); }
  const cmds = paletteCmds(), inp = $("palIn"), list = $("palL");
  let recent = []; try { recent = JSON.parse(pref(PAL_KEY) || "[]"); } catch (e) { recent = []; }
  let shown = [], at = 0;
  const close = () => { el.classList.remove("on"); document.removeEventListener("keydown", key, true); };
  const run = c => { close(); if (!c) return; try { pref(PAL_KEY, JSON.stringify([c.t].concat(recent.filter(x => x !== c.t)).slice(0, 8))); } catch (e) {} Promise.resolve().then(c.run).catch(e => toast(String(e && e.message || e), 5000)); };
  const draw = () => {
    const q = inp.value.trim();
    shown = q ? cmds.map(c => ({c, s: palScore(c, q)})).filter(o => o.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map(o => o.c)
      : recent.map(t => cmds.find(c => c.t === t)).filter(Boolean).concat(cmds.filter(c => !recent.includes(c.t) && c.g !== "Page")).slice(0, 60);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((c, i) => `<div class="pi${i === at ? " on" : ""}" data-pi="${i}" role="option"><span class="pt">${!q && recent.includes(c.t) ? '<span class="pr">recent</span>' : ""}${esc(c.t)}</span><span class="pg">${esc(c.g)}</span>${c.k ? `<kbd>${esc(c.k)}</kbd>` : ""}</div>`).join("") : '<div class="pi small">Nothing matches — try fewer letters</div>';
    const on = list.querySelector(".pi.on"); if (on) on.scrollIntoView({block: "nearest"});
  };
  const key = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); run(shown[at]); }
  };
  inp.value = ""; at = 0; inp.oninput = () => { at = 0; draw(); };
  list.onmousedown = e => { const r = e.target.closest("[data-pi]"); if (r) { e.preventDefault(); run(shown[+r.dataset.pi]); } };
  el.onmousedown = e => { if (e.target === el) close(); };
  document.addEventListener("keydown", key, true);
  el.classList.add("on"); draw(); inp.focus();
}

/* ------------------------------------------------------------------ right-click menu (Bluebeam / PlanSwift)
   Right-click (without dragging — a right-drag pans) on a measurement, a markup or the drawing opens a menu of what
   can be done there: points and segments, break / gap / join / continue, cut-out and openings, make a perimeter run or
   an area, clipboard, arrange, lock, condition, QA, zoom, delete. With several selected it acts on all of them. */
let CTX_FN = [];
function ctxClose(){ const m = $("ctx"); if (m && m.classList.contains("on")) { m.classList.remove("on"); m.innerHTML = ""; } CTX_FN = []; }
function ctxHtml(L){
  return L.filter(Boolean).map(x => {
    if (x.sep) return '<div class="csep"></div>';
    if (x.h != null) return `<div class="chd"><b>${esc(x.h)}</b>${x.s ? `<span>${esc(x.s)}</span>` : ""}</div>`;
    const i = CTX_FN.push(x.fn || null) - 1;
    if (x.sub) return `<div class="ci sub${x.dis || !x.sub.length ? " dis" : ""}"><span class="ct">${esc(x.t)}</span><span class="ck">&#9656;</span><div class="cm">${x.sub.length ? ctxHtml(x.sub) : '<div class="ci dis"><span class="ct">(none)</span></div>'}</div></div>`;
    return `<div class="ci${x.dis ? " dis" : ""}${x.dng ? " dng" : ""}" data-ci="${i}"><span class="ct">${x.on ? "&#10003; " : ""}${esc(x.t)}</span>${x.k ? `<span class="ck">${esc(x.k)}</span>` : ""}</div>`;
  }).join("");
}
function ctxShow(L, x, y){
  const m = $("ctx"); CTX_FN = [];
  const pin = {t: S.ctxPinned ? "Unpin menu" : "📌 Keep menu open for screenshot", fn: () => { S.ctxPinned = !S.ctxPinned; ctxShow(L, x, y); }};
  m.innerHTML = ctxHtml([pin, {sep: 1}, ...L]); m.classList.add("on");
  const r = m.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  m.style.left = Math.max(4, Math.min(x, W - r.width - 4)) + "px"; m.style.top = Math.max(4, Math.min(y, H - r.height - 4)) + "px";
  m.classList.toggle("flip", x + r.width + 220 > W);   // submenus open to the left near the right edge
  m.querySelectorAll(".cm").forEach(sm => { sm.parentElement.addEventListener("mouseenter", () => { const pr = sm.parentElement.getBoundingClientRect(), h = sm.offsetHeight; sm.style.top = (pr.top + h > H - 4 ? Math.max(-pr.top + 4, H - 4 - pr.top - h) : -4) + "px"; }); });
}
function ctxOpen(sp, e){
  if (!P.proj || !S.page) return;
  if (S.draft.length) return;
  const q = toBase(sp[0], sp[1]), mk = markAt(sp), hi = mk ? null : hitInfo(sp);
  let L;
  if (mk) { if (!selIds().has(mk.id)) setSel([mk.id]); L = ctxMark(mk); }
  else if (hi) { if (!selIds().has(hi.it.id)) setSel([hi.it.id], hi.pt); else if (hi.pt >= 0 && hi.it.id === S.sel) S.selPt = hi.pt; L = ctxItem(hi, sp, q, e); }
  else L = ctxCanvas(q);
  if (S.tool !== "select" && (mk || hi)) { S.tool = "select"; document.querySelectorAll("#tools .tool[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === "select")); stage().className = ""; hint(); }
  refresh();
  ctxShow(L, e.clientX, e.clientY);
}
const ctxClip = q => [{t: "Cut", k: "Ctrl+X", fn: () => copySel(true)}, {t: "Copy", k: "Ctrl+C", fn: () => copySel()}, {t: "Paste", k: "Ctrl+V", fn: () => pasteClip("cursor", q), dis: !S.clip}, {t: "Paste in place", k: "Ctrl+Shift+V", fn: () => pasteClip("inplace"), dis: !S.clip},
  {t: "Duplicate", k: "Ctrl+D", fn: duplicateSel}, {t: "Copy at a distance / array…", k: "Ctrl+→", fn: () => arrayDialog("right")}, {t: "Place copies by clicking…", fn: () => { copySel(); setTool("stamp"); }}, {t: "Copy to other pages…", fn: copyToPagesDialog}];
const ctxArrange = () => ({t: "Arrange / rotate", sub: [{t: "Bring to front", fn: () => orderSel(1)}, {t: "Send to back", fn: () => orderSel(-1)}, {sep: 1},
  {t: "Rotate 90° clockwise", fn: () => transformSel("cw")}, {t: "Rotate 90° anticlockwise", fn: () => transformSel("ccw")}, {t: "Flip left–right", fn: () => transformSel("fh")}, {t: "Flip up–down", fn: () => transformSel("fv")}]});
function selTotals(ids){   // "Floor area 312.00 Sft · Doors 4 Nos" for the selection
  const T = new Map();
  [...ids].map(id => P.proj.items.find(i => i.id === id)).filter(Boolean).forEach(it => { const c = cond(it.cond), k = itemScale(it); if (!c || !k) return; const q = rowsOf(it, k).reduce((a, r) => a + r.qty, 0); const t = T.get(c.id) || {c, q: 0, n: 0}; t.q += q; t.n++; T.set(c.id, t); });
  return [...T.values()].map(t => t.c.name + " " + fq(t.q, t.c.unit) + " " + t.c.unit).join(" · ");
}
function ctxItem(hi, sp, q, e){
  const it = hi.it, c = cond(it.cond), ids = selIds(), many = ids.size > 1, k = itemScale(it), sel = [...ids].map(id => P.proj.items.find(i => i.id === id)).filter(Boolean);
  const runs = sel.filter(isRun), vi = !many && editPts(it) ? vertexAt(it, sp) : -1, sg = !many && (editPts(it) || it.shape === "circle") ? segAt(it, sp) : null;
  const cut = sg || (vi > 0 && vi < it.pts.length - 1 ? {i: vi - 1, p: it.pts[vi]} : null), lk = sel.some(o => o.locked), allLk = sel.length && sel.every(o => o.locked);
  const qty = k ? fq(rowsOf(it, k).reduce((a, r) => a + r.qty, 0), c.unit) + " " + c.unit : "scale not set";
  const L = [{h: many ? ids.size + " selected" : (it.label || kindName(it, c)), s: many ? selTotals(ids) : c.name + " · " + qty + (it.locked ? " · locked" : "")}];
  if (!many) L.push({t: "Properties…", k: "Dbl-click", fn: focusProps}, {t: "Set as default", fn: () => setDefaultsFromSelection(it)}, {t: "Add to Tool Chest…", fn: () => toolChestDialog({object: it, name: (c.name || kindName(it, c)) + " profile"})}, {t: "Rename…", k: "F2", fn: () => renameItem(it)});
  L.push({sep: 1});
  if (!many && c.type === "count" && hi.pt >= 0) L.push({t: "Delete this count point (" + (hi.pt + 1) + ")", fn: () => delPoint(it, hi.pt), dis: it.locked});
  if (!many && editPts(it)) {
    if (vi >= 0) L.push({t: "Delete this point", k: "Dbl-click", fn: () => delPoint(it, vi), dis: it.locked});
    else if (sg) L.push({t: "Add a point here", k: "Dbl-click", fn: () => addPoint(it, sg.i, sg.p), dis: it.locked});
  }
  if (!many && isRun(it)) {
    L.push({t: "Break here", k: "B", fn: () => breakRun(it, cut.i, cut.p), dis: !cut || it.locked});
    L.push({t: "Delete this segment", k: "Shift+B-click", fn: () => delSegment(it, sg.i), dis: !sg || it.locked});
    L.push({t: "Cut a gap from here…", fn: () => startGap(it, cut), dis: !cut || it.locked});
    L.push({t: "Continue drawing this run", fn: () => resumeRun(it, q), dis: it.locked});
    L.push({t: "Explode into segments", fn: () => explodeRun(it), dis: it.locked || it.pts.length < 3});
    L.push({t: "Close the run (back to its start)", fn: () => closeRun(it), dis: it.locked || it.pts.length < 3});
  }
  if (!many && it.kind !== "open" && c.type !== "count") L.push({t: "Offset…", fn: () => offsetDialog(it)});
  if (runs.length >= 2) L.push({t: "Join " + runs.length + " runs into one", fn: () => joinRuns(new Set(runs.map(r => r.id))), dis: lk});
  if (!many && c.type === "area" && it.kind === "shape") L.push({t: "Add a cut-out / deduction", k: "D", fn: () => { S.cond = c.id; setTool("ded"); }});
  if (!many && c.type === "area" && it.kind === "shape") { const under = cutTargets(it); if (under.length) L.push({t: "Cut out of the area" + (under.length > 1 ? "s" : "") + " it overlaps (" + under.slice(0, 2).map(u => u.label || (cond(u.cond) || {}).name).join(", ") + (under.length > 2 ? ", …" : "") + ")", fn: () => cutOutOf(it, under), dis: it.locked}); }
  if (!many && c.type === "linear" && it.kind !== "open") L.push({t: "Add an opening (door / window)", k: "O", fn: () => { S.cond = c.id; setTool("open"); }});
  const lin = P.proj.conds.filter(x => x.type === "linear"), ar = P.proj.conds.filter(x => x.type === "area");
  if (!many && (c.type === "area" || it.shape === "circle") && it.kind === "shape") L.push({t: "Make a perimeter run in", sub: lin.map(x => ({t: x.name, fn: () => toRun(it, x.id)}))});
  if (!many && isRun(it) && it.pts.length >= 3) L.push({t: "Make an area in", sub: ar.map(x => ({t: x.name, fn: () => toArea(it, x.id)}))});
  L.push({sep: 1}, ...ctxClip(q), {sep: 1}, ctxArrange(), {t: allLk ? "Unlock" : "Lock", k: "Ctrl+Shift+L", fn: lockSel}, {sep: 1});
  const same = P.proj.conds.filter(x => x.type === c.type && x.id !== it.cond);
  L.push({t: "Move to condition", sub: same.map(x => ({t: x.name, fn: () => { const bad = sel.filter(i => (cond(i.cond) || {}).type !== x.type).length; mutate(() => sel.forEach(i => { if ((cond(i.cond) || {}).type === x.type) i.cond = x.id; }), "Move to " + x.name); toast("Moved to " + x.name + (bad ? " — " + bad + " of another kind left as they were" : ""), 2600); }})), dis: lk});
  L.push({t: "Select all “" + c.name + "” on this page", fn: () => selectSimilar(it)});
  L.push({t: "Condition", sub: [{t: "Edit “" + c.name + "”…", fn: () => editCond(c)}, {t: "Change colour…", fn: () => colorPop({getBoundingClientRect: () => ({left: e.clientX, bottom: e.clientY})}, c)},
    {t: "Hide this condition", fn: () => { c.hidden = true; setSel([]); save(); refresh(); }}, {t: "Show only this condition", fn: () => { P.proj.conds.forEach(x => { x.hidden = x.id !== c.id; }); save(); refresh(); }},
    {t: "Show all conditions", fn: () => { P.proj.conds.forEach(x => { x.hidden = false; }); save(); refresh(); }}, {sep: 1}, {t: "Draw more “" + c.name + "”", k: "A", fn: () => { S.cond = c.id; setTool(c.type === "count" ? "count" : "draw"); }}]});
  L.push({sep: 1}, {t: "Mark checked ✓", fn: () => setQa(sel, "checked")}, {t: "Needs recheck", fn: () => setQa(sel, "recheck")}, {t: "Zoom to", fn: () => zoomTo(ids)}, {sep: 1}, {t: "Delete", k: "Del", fn: delSelected, dng: 1, dis: allLk});
  return L;
}
function setDefaultsFromSelection(o){
  if (o && MK_TYPES.has(o.type)) { const kind = mkKindOf(o); saveMkStyle(kind, mkStyleOf(o)); toast((MK_TOOL_NAMES["mk_" + kind] || MARK_TOOLS[o.type]) + ": this style is the default for new ones", 2400); return; }
  const d = toolDefaults();
  if (o && o.type) {
    if (o.type === "dimension") Object.assign(d, {dimColor: o.color || d.dimColor, dimWidth: +o.width || d.dimWidth, dimSize: +o.size || d.dimSize, dimArrow: +o.arrow || d.dimArrow, dimOffset: +o.offset || d.dimOffset});
    else if (o.type === "hilite") Object.assign(d, {hiliteColor: o.color || d.hiliteColor, hiliteOpacity: +o.opacity || d.hiliteOpacity});
    else Object.assign(d, {markColor: o.color || d.markColor, markWidth: +o.width || d.markWidth});
    saveToolDefaults(d); toast(MARK_TOOLS[o.type] + " saved as the default", 2200); return;
  }
  const c = o && o.cond ? cond(o.cond) : null;
  if (c) { d.condColor = c.color || d.condColor; d.condWidth = +c.sw || d.condWidth; saveToolDefaults(d); toast("Measurement defaults saved from " + c.name, 2200); }
}

function ctxMark(m){
  const ids = selIds(), many = ids.size > 1, allLk = [...ids].map(objById).filter(Boolean).every(o => o.locked);
  return [{h: many ? ids.size + " selected" : MARK_TOOLS[m.type], s: many ? "" : (m.text || "markup — not a quantity") + (m.locked ? " · locked" : "")},
    ...mkCtxItems(m, many), !many ? {t: "Comments and replies…", fn: () => { S.ml.focus = m.id; mlSet({scope: "page"}); mlToggle(true); }} : null,
    !many ? {t: "Properties…", fn: focusProps} : null, !many ? {t: "Set as default", fn: () => setDefaultsFromSelection(m)} : null, !many && MARK_PROFILE_TYPES.includes(mkKindOf(m)) ? {t: "Add to Tool Chest…", fn: () => toolChestDialog({object: m, name: MARK_TOOLS[m.type] + " profile"})} : null, {sep: 1}, ...ctxClip(null), {sep: 1}, ctxArrange(), {t: allLk ? "Unlock" : "Lock", k: "Ctrl+Shift+L", fn: lockSel},
    {t: "Select all " + MARK_TOOLS[m.type].toLowerCase() + "s on this page", fn: () => selectSimilar(m)}, {t: "Zoom to", fn: () => zoomTo(ids)}, {sep: 1}, {t: "Delete", k: "Del", fn: delSelected, dng: 1, dis: allLk}];
}
function ctxCanvas(q){
  const u = S.undo.length ? undoEntry(S.undo[S.undo.length - 1]).label : "", r = S.redo.length ? undoEntry(S.redo[S.redo.length - 1]).label : "", T = (t, n, key) => ({t: n, k: key, fn: () => setTool(t), on: S.tool === t});
  return [{h: pageName({file: S.fileId, page: S.pageNo}), s: S.clip ? "clipboard: " + S.clip.n + " object" + (S.clip.n > 1 ? "s" : "") : ""}, ...cadCtxItems(q), ...sheetLinkItems(q),
    {t: "Paste here", k: "Ctrl+V", fn: () => pasteClip("cursor", q), dis: !S.clip}, {t: "Paste in place", k: "Ctrl+Shift+V", fn: () => pasteClip("inplace"), dis: !S.clip},
    {t: "Select all on this page", k: "Ctrl+A", fn: selectAll}, {sep: 1},
    {t: "Undo" + (u ? ": " + u : ""), k: "Ctrl+Z", fn: undoAny, dis: !S.undo.length}, {t: "Redo" + (r ? ": " + r : ""), k: "Ctrl+Y", fn: redoAny, dis: !S.redo.length}, {sep: 1},
    {t: "Tools", sub: [T("select", "Select", "V"), T("lasso", "Lasso select", "Shift+O"), T("pan", "Pan", "H"), {sep: 1}, T("draw", "Draw", "A"), T("rect", "Rectangle", "R"), T("auto", "Auto area", "W"), T("circle", "Circle", "E"), T("count", "Count", "C"), T("ded", "Deduct", "D"), T("open", "Opening", "O"), {sep: 1}, T("break", "Break a run", "B"), T("measure", "Measure", "M"), T("cal", "Set scale", "K")]},
    {t: "View", sub: [{t: "Fit page", k: "F", fn: () => { fit(); renderHi(); }}, {t: "Fit width", k: "Shift+F", fn: fitWidth}, {t: "Zoom window", k: "Z", fn: () => setTool("zoomwin")}, {t: "Zoom in", k: "+", fn: () => zoomAt(1.25, stage().clientWidth / 2, stage().clientHeight / 2)}, {t: "Zoom out", k: "−", fn: () => zoomAt(0.8, stage().clientWidth / 2, stage().clientHeight / 2)}, {sep: 1},
      {t: "Labels", k: "L", fn: () => setLblOn(!S.lbl.on), on: S.lbl.on}, {t: "Snap to drawing lines", k: "S", fn: () => { $("snapOn").checked = !$("snapOn").checked; }, on: $("snapOn").checked}, {t: "Markups", fn: () => $("bHideMk").click(), on: !S.hideMk}]},
    {sep: 1}, {t: "Keyboard & mouse shortcuts…", k: "?", fn: keysDialog}];
}
/* the shortcuts, in one place (?) */
function keysDialog(){
  const R = (k, t) => `<tr><td style="white-space:nowrap;padding:2px 10px 2px 0">${k.split(" | ").map(x => `<kbd>${esc(x)}</kbd>`).join(" ")}</td><td style="padding:2px 0">${esc(t)}</td></tr>`;
  const G = (t, rows) => `<tr><td colspan="2" style="padding:8px 0 2px;font-weight:700;color:var(--navy)">${esc(t)}</td></tr>` + rows.map(x => R(x[0], x[1])).join("");
  ask("Keyboard & mouse", `<table class="keyt" style="font-size:12px;border-collapse:collapse;width:100%">
    ${G("Select & edit (Bluebeam / PlanSwift)", [["Click", "select (smallest area, or a line / marker on top)"], ["Drag → (left to right)", "window: selects what is wholly inside"], ["Drag ← (right to left)", "crossing: selects what the box touches"], ["Shift+O", "lasso select (free shape)"], ["Shift | Ctrl+click", "add to / take out of the selection"], ["Tab", "next object under the cursor"], ["Drag a selected object", "move it (Shift: straight)"], ["Ctrl+drag", "copy it"], ["Alt+drag", "move without selecting first"], ["Drag a point", "move the point (Ctrl: no snap)"], ["Double-click a side | Shift+click a side", "add a point"], ["Double-click a point | Shift+click a point", "remove the point"], ["+ at a side's middle", "drag out a new point"], ["Right-click", "menu for what is under the cursor (right-drag pans)"], ["Delete", "selected point, then the object"], ["Arrows | Shift+arrows", "nudge 1 px / 10 px"], ["F2", "rename"], ["Ctrl+Shift+L", "lock / unlock"]])}
    ${G("Find anything", [["Ctrl+K", "command palette: type the name of any tool, export, dialog, page or condition"], ["Ctrl+F", "find text on the drawings"]])}
    ${G("Pages (Forma Takeoff sheets)", [["Tick a thumbnail | Shift+tick", "tick pages to export, read sheet info or OCR together · Shift: the pages in between"], ["Ctrl+click | Shift+click a thumbnail", "tick / untick it without opening it"], ["☆ on a thumbnail", "pin the page to the top"], ["Double-click a sheet no. on the drawing", "open that sheet (right-click lists the sheets referenced)"]])}
    ${G("Markups (Bluebeam)", [["T | Q | N", "text box · callout · note"], ["Shift+L | Y | G", "line · polyline · polygon"], ["Shift+R | Shift+E | U", "rectangle · ellipse · cloud"], ["P | Shift+H", "pen · highlighter pen"], ["X | I", "stamp · image"], ["Markup ▾", "every markup tool: hyperlink, file attachment, redaction, erase…"], ["Dbl-click a markup", "edit its text · open a link or an attached file"], ["Drag a handle", "resize a box, move a line's end or a point"], ["Alt+L", "Markups list: every markup — filter, sort, status, replies, layers, CSV / XML / PDF summary"]])}
    ${G("Clipboard", [["Ctrl+C | Ctrl+X", "copy / cut the selection"], ["Ctrl+V", "paste at the cursor (same real size)"], ["Ctrl+Shift+V", "paste in place (same spot, any page)"], ["Ctrl+D", "duplicate"], ["Ctrl+arrow", "copy at a distance / array"], ["Ctrl+A", "select all on the page"]])}
    ${G("Drawing", [["A | R | W | E | C", "draw · rectangle · auto area · circle · count"], ["D | O", "deduction · opening"], ["F8 | F10", "Ortho (0° / 90°) · Polar tracking (every 15°…) — Shift frees one click while Ortho is on"], ["Snap ▾ (toolbar)", "choose the object snaps: endpoint, midpoint, intersection, perpendicular, nearest"], ["A (while drawing)", "next click is on an arc, the one after its end"], ["Ctrl+click", "place a point with no snap"], ["Shift", "0° / 90°"], ["Ctrl+Z | Backspace", "take back the last point (or arc)"], ["Ctrl+Y", "put it back"], ["Enter | double-click | right-click", "finish"], ["Esc", "cancel"], ["B", "break a run (Shift+click: delete a segment)"]])}
    ${G("View", [["Space+drag | right-drag | H", "pan"], ["Wheel", "zoom"], ["Z", "zoom window"], ["F", "fit page"], ["L | S", "labels · snap"], ["PgUp | PgDn", "page"], ["Home | End", "first / last page"], ["Shift+F", "fit width"], ["Ctrl+F", "find text"], ["Ctrl+S", "save now (also saved on every change)"], ["1–9", "pick a condition"]])}
  </table>`, "Close");
}
/* ------------------------------------------------------------------ events */
function wire(){
  const st = stage();
  document.addEventListener("keydown", e => {   // Ctrl+K: command palette (not the browser's search box)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); if ($("pal") && $("pal").classList.contains("on")) return; openPalette(); }
  }, true);
  document.addEventListener("keydown", e => {   // Ctrl+S: save now (not the browser's "Save page as")
    if (!((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s")) return;
    e.preventDefault(); if (!P.proj) return;
    const a = document.activeElement; if (a && a.closest && a.closest("#props,header") && /^(INPUT|SELECT)$/.test(a.tagName)) a.blur();   // a field being typed in is taken first
    savePr = P.proj; flushSave().then(ok => toast(ok ? "Saved in this browser — " + P.proj.items.length + " measurement" + (P.proj.items.length === 1 ? "" : "s") + " · Export → Project + PDFs to keep a copy elsewhere" : "Not saved — see the message above", 2600));
  }, true);
  document.addEventListener("keydown", e => {   // Ctrl+P: plot (a window, the view, the page) — not the browser's print of this screen
    if (!((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "p")) return;
    e.preventDefault(); e.stopPropagation(); if (P.proj && S.page && !$("dlgBack").classList.contains("on")) plotDialog();
  }, true);
  $("warnbar").addEventListener("click", e => { if (e.target.closest("[data-reload]")) { clearTimeout(saveT); savePr = null; location.reload(); } });   // this tab's pending change is dropped, not written over the other's
  st.addEventListener("pointerdown", onDown);
  st.addEventListener("pointermove", onMove);
  st.addEventListener("pointerup", onUp); st.addEventListener("pointercancel", onUp);
  st.addEventListener("contextmenu", e => e.preventDefault());
  st.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });
  { let mid = 0; st.addEventListener("pointerdown", e => { if (e.button !== 1) return; const t = Date.now(); if (t - mid < 380) { mid = 0; if (S.page) { fit(); renderHi(); } } else mid = t; }); }   // a middle double-click: zoom extents, as AutoCAD   // middle button pans — not the browser's autoscroll
  window.addEventListener("blur", () => { if (S.space) { S.space = false; stage().classList.toggle("pan", S.tool === "pan"); } });   // Space released in another window must not leave pan on
  st.addEventListener("dblclick", e => {
    if (["draw", "ded", "measure", "fence", "mk_polyline", "mk_polygon"].indexOf(S.tool) >= 0 && S.draft.length) return endDraft();
    if (S.tool !== "select" || !P.proj || !S.page) return;
    const sp = evPos(e), mk = markAt(sp);
    if (mk && mk.type === "link") return followLink(mk);
    if (mk && mk.type === "attach") return mk.att && openAsset(mk.att.aid, mk.att.name);
    if (mk && selIds().has(mk.id)) { if (mk.locked) return lockedMsg(); if (mk.type === "legend") { editLegend(mk); return; } if (mk.type !== "hilite" && mk.type !== "fence") editMarkText(mk); return; }
    if (!mk && !hitItem(sp)) { const ln = sheetRefsNear(toBase(sp[0], sp[1]), 10 / S.view.s)[0]; if (ln) { toast("Sheet " + ln.no + " → " + keyName(ln.k), 2000); return gotoKey(ln.k); } }   // a sheet no. written on the drawing: open that sheet
    const one = selOne(); if (!one) return;
    const recent = S.lastIns && S.lastIns.id === one.id && Date.now() - S.lastIns.t < 700 && vertexAt(one, sp) === S.lastIns.vi;   // the second click of a double-click on a "+" that has just added this point
    if (editPts(one)) {   // double-click a point: remove it; double-click a side: add a point there
      const vi = vertexAt(one, sp); if (vi >= 0) { if (one.locked) return lockedMsg(); if (!recent) delPoint(one, vi); return; }
      const sg = segAt(one, sp); if (sg) { if (one.locked) return lockedMsg(); if (!recent) addPoint(one, sg.i, sg.p); return; }
    } else if (vertexAt(one, sp) >= 0 && (cond(one.cond) || {}).type !== "count") return toast(one.kind === "open" ? "An opening has two ends — drag them to change it" : "A circle is its centre and edge point — drag them to change it", 2600);
    if (hitItem(sp) === one) focusProps();
  });
  $("ctx").addEventListener("click", e => { const it = e.target.closest("[data-ci]"); if (!it || it.classList.contains("dis")) return; const fn = CTX_FN[+it.dataset.ci]; if (!(S.ctxPinned && it.dataset.ci === "0")) ctxClose(); if (fn) fn(); });
  $("ctx").addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("pointerdown", e => { if (!S.ctxPinned && !e.target.closest("#ctx")) ctxClose(); }, true);
  window.addEventListener("blur", () => { if (!S.ctxPinned) ctxClose(); });
  st.addEventListener("wheel", e => { if (!S.page) return; e.preventDefault(); ctxClose(); const sp = evPos(e); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), sp[0], sp[1]); }, {passive: false});
  st.addEventListener("pointerleave", () => { S.cursor = null; S.snap = null; S.hover = null; draw(); });
  st.addEventListener("dragover", e => { e.preventDefault(); $("drop").classList.add("over"); });
  st.addEventListener("dragleave", () => $("drop").classList.remove("over"));
  st.addEventListener("drop", e => { e.preventDefault(); $("drop").classList.remove("over"); const L = [...e.dataTransfer.files]; if (!L.length) return;
    if (L.some(f => !isPdfFile(f) && isImgFile(f))) importDialog(L); else addFiles(L); });   // photos / scans among them: the import dialog (images as pages)
  new ResizeObserver(() => { if (S.page) { applyView(); renderHi(); } }).observe(st);
  document.querySelectorAll("#tools .tool[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  $("bAutoSet").onclick = () => P.proj && autoSettings();
  $("bMk").onclick = e => { e.stopPropagation(); if (P.proj && S.page) mkMenu($("bMk")); };
  $("bMkList").onclick = () => { if (P.proj) mlToggle(); };
  mlWire();
  $("bAdd").onclick = () => $("fileIn").click();
  $("fileIn").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  $("pageSel").onchange = e => { const [f, p] = e.target.value.split("|"); if (f && p) gotoPage(f, +p); };
  $("bPrev").onclick = () => stepPage(-1); $("bNext").onclick = () => stepPage(1);
  $("bZi").onclick = () => zoomAt(1.25, stage().clientWidth / 2, stage().clientHeight / 2);
  $("bZo").onclick = () => zoomAt(0.8, stage().clientWidth / 2, stage().clientHeight / 2);
  $("bFit").onclick = () => { fit(); renderHi(); };
  $("bDim").onclick = () => setDim(!S.dim);
  $("dimPct").oninput = e => setDim(+e.target.value);
  $("bTypical").onclick = () => P.proj && copyPageDialog();
  const leftTab = t => { t = t === true ? "lay" : t || "cond"; S.leftTab = t;   // conditions · pages · the PDF's layers
    $("condList").style.display = t === "cond" ? "" : "none"; $("layerList").style.display = t === "lay" ? "" : "none"; $("pageList").style.display = t === "pages" ? "" : "none";
    $("tCond").classList.toggle("on", t === "cond"); $("tLay").classList.toggle("on", t === "lay"); $("tPages").classList.toggle("on", t === "pages"); $("bNewCond").style.display = t === "cond" ? "" : "none";
    if (t === "lay") renderLayers(); if (t === "pages") renderPages(); };
  $("tCond").onclick = () => leftTab("cond"); $("tLay").onclick = () => leftTab("lay"); $("tPages").onclick = () => leftTab("pages");
  $("pageList").addEventListener("click", e => {
    const ck = e.target.closest("[data-pgck]"); if (ck) return pgTick(ck.dataset.pgck, ck.checked, e.shiftKey);
    const all = e.target.closest("[data-pgall]"); if (all) { const L = pagesShown().map(o => o.key); L.forEach(k => { if (all.checked) S.pgSel.add(k); else S.pgSel.delete(k); }); return renderPages(); }
    const pn = e.target.closest("[data-pin]"); if (pn) return pinPages([pn.dataset.pin]);
    const a = e.target.closest("[data-pga]"); if (a) return pgAct(a.dataset.pga);
    if (e.target.closest(".pgbar")) return;
    const si = e.target.closest("[data-sheet],[data-ocr]");   // a card's Info / Read: open the page, then its sheet info (Read: from its text, OCR for a scan)
    if (si) { e.stopPropagation(); const rd = si.hasAttribute("data-ocr"), [f, p] = si.dataset[rd ? "ocr" : "sheet"].split("|");
      return gotoPage(f, +p).then(() => sheetInfoDialog(rd)).catch(er => toast("Could not open sheet info: " + (er.message || er), 5000)); }
    const rm = e.target.closest("[data-rmpdf]"); if (rm) return removePdf(rm.dataset.rmpdf);
    const t = e.target.closest("[data-pg]"); if (t) { if (e.ctrlKey || e.metaKey || e.shiftKey) { const k = t.dataset.pg.replace("|", ":"); return pgTick(k, !S.pgSel.has(k), e.shiftKey); } const [f, p] = t.dataset.pg.split("|"); gotoPage(f, +p); } });
  let pgT = null;
  $("pageList").addEventListener("input", e => { if (e.target.id !== "pgQ") return; clearTimeout(pgT); pgT = setTimeout(() => { S.pgQ = e.target.value; renderPages(); }, 180); });
  $("pageList").addEventListener("change", e => { if (e.target.id === "pgF") { S.pgF = e.target.value; renderPages(); } else if (e.target.id === "pgSort") { S.pgSort = e.target.value; renderPages(); } });
  S.pgSz = pref("zdTakeoffPgSz") || "m";
  $("bAddM").onclick = e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); importMenu(r.left, r.bottom + 4); };
  const pick = (id, f) => { $(id).onchange = e => { const L = [...e.target.files]; e.target.value = ""; if (L.length) f(L); }; };
  pick("impPdfIn", importDialog); pick("imgIn", importDialog);
  pick("dirIn", L => { const ok = L.filter(f => isPdfFile(f) || isImgFile(f) || isCadFile(f)); if (!ok.length) return toast("No PDF, DWG, DXF, JPG or PNG in that folder", 3000); importDialog(ok); });
  $("bToolChest").onclick = () => toolChestDialog();
  $("bDefaults").onclick = () => defaultsDialog();
  $("bWs").onclick = e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); wsMenu(Math.max(4, r.right - 300), r.bottom + 4); };
  $("bCmd").onclick = () => openPalette();
  $("bMini").onclick = () => { wsSet({mini: !wsPref().mini}); toast(wsPref().mini ? "Minimap on — it shows when you zoom in" : "Minimap off", 1800); };
  $("bFull").onclick = () => fullScreen();
  document.addEventListener("fullscreenchange", () => { if ($("bFull")) $("bFull").classList.toggle("on", !!document.fullscreenElement); });
  { const mi = $("mini");
    mi.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); if (!S.base) return; mi.setPointerCapture(e.pointerId); S.miniDrag = true; miniGo(e); });
    mi.addEventListener("pointermove", e => { e.stopPropagation(); if (S.miniDrag) miniGo(e); });
    mi.addEventListener("pointerup", e => { e.stopPropagation(); S.miniDrag = false; });
    ["dblclick", "contextmenu"].forEach(t => mi.addEventListener(t, e => { e.stopPropagation(); e.preventDefault(); })); }
  $("layerList").addEventListener("change", e => {
    if (e.target.dataset.mklv) { const l = mkLayers().find(x => x.id === e.target.dataset.mklv); if (l) { mutate(() => { l.hidden = !e.target.checked; }, (e.target.checked ? "Show" : "Hide") + " layer " + l.name); renderLayers(); } return; }
    if (e.target.dataset.lid) setLayer([e.target.dataset.lid], e.target.checked); });
  $("layerList").addEventListener("click", e => {
    const mkl = e.target.closest("[data-mkl],[data-mklr],[data-mkld]"); if (mkl) { e.preventDefault(); e.stopPropagation(); return mkLayerAct(mkl); }
    const iso = e.target.closest("[data-liso]"); if (iso) { e.preventDefault(); e.stopPropagation(); return cadIsolateId(iso.dataset.liso); }
    if (e.target.closest("[data-cadq]")) return cadQtyDialog();
    const pr = e.target.closest("[data-lpre]");
    if (pr) { const cfg = S.ocgs && S.ocgs[S.fileId]; if (!cfg) return; const G = Object.entries(cfg.getGroups()), t = pr.dataset.lpre;
      if (t === "clean") { setLayer(G.map(([id]) => id), true); setLayer(G.filter(([, g]) => !BOUND.has(layerRole(g.name))).map(([id]) => id), false); }
      else setLayer(G.filter(([, g]) => { const r = layerRole(g.name); return t === "text" ? r === "text" || r === "unit" : t === "fixture" ? r === "fixture" || r === "glass" : r === t; }).map(([id]) => id), false);
      renderLayers(); return; }
    const b = e.target.closest("[data-lall]"); if (!b) return; const cfg = S.ocgs && S.ocgs[S.fileId]; if (!cfg) return; setLayer(Object.keys(cfg.getGroups()), b.dataset.lall === "1"); renderLayers(); });
  $("layerList").addEventListener("input", e => { if (e.target.id !== "lyrQ") return; const q = e.target.value.toLowerCase(); document.querySelectorAll("#layerList .lyr").forEach(l => { l.style.display = l.dataset.name.includes(q) ? "" : "none"; }); });
  $("bCompare").onclick = () => P.proj && compareDialog();
  const view = b => { S.billView = b; $("sheet").style.display = b ? "none" : ""; $("bill").style.display = b ? "" : "none"; $("vSheet").classList.toggle("on", !b); $("vBill").classList.toggle("on", b); if (b) renderBill(); };
  $("vSheet").onclick = () => view(false); $("vBill").onclick = () => view(true);
  $("bill").addEventListener("click", e => { const a = e.target.closest("[data-asm]"); if (a) return asmDialog(cond(a.dataset.asm));
    const b = e.target.closest("[data-bact]"); if (b) return b.dataset.bact === "open" ? openingsDialog() : revCompareDialog(); });
  $("bill").addEventListener("change", e => { if (e.target.id === "billGrp") { S.billGrp = e.target.value; renderBill(); } });
  $("bSheet").onclick = () => P.proj && sheetInfoDialog();
  $("qaBar").addEventListener("click", e => {
    const f = e.target.closest("[data-qf]"); if (f) { S.qaFilter = S.qaFilter === f.dataset.qf ? "" : f.dataset.qf; renderSheet(); renderQaBar(); return; }
    const a = e.target.closest("[data-qact]"); if (a && a.dataset.qact === "next") return nextUnchecked(1); if (a && a.dataset.qact === "prev") return nextUnchecked(-1); if (a) setQa(P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && i.qa !== "checked"), "checked");
  });
  let findT = null; $("findIn").addEventListener("input", e => { clearTimeout(findT); findT = setTimeout(() => findText(e.target.value), 350); });
  $("findIn").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(findT); findText(e.target.value); } if (e.key === "Escape") { $("findRes").classList.remove("on"); e.target.blur(); } });
  document.addEventListener("pointerdown", e => { if (!e.target.closest("#findRes,#findIn")) $("findRes").classList.remove("on"); });
  $("bClaude").onclick = () => aiToggle(!$("aiPanel").classList.contains("on"));
  $("aiClose").onclick = () => aiToggle(false);
  $("aiKeyBtn").onclick = () => aiShowKey($("aiKeyRow").style.display === "none");
  secretField($("aiKey"));
  $("aiKeySave").onclick = () => { const v = secretVal($("aiKey")).trim(); pref("zdTakeoffApiKey", v); AI.client = null; aiShowKey(!v); aiLog("bot", v ? "Key saved in this browser." : "Key removed."); };
  $("aiNew").onclick = () => { if (AI.stop) AI.stop.abort(); AI.plan = []; AI.history = []; AI.view = null; $("aiLog").innerHTML = ""; aiToggle(true); };
  $("aiCopy").onclick = () => freeCopy();
  $("aiImport").onclick = () => freeImport();
  $("aiDetails").onclick = () => agentCmd("drawing details");
  $("agRooms").onclick = () => agentCmd("measure all rooms"); $("agUnit").onclick = () => unitDialog(); $("agWalls").onclick = () => wallsDialog(); $("agTags").onclick = () => doorWinDialog();
  $("agFull").onclick = () => fullTakeoffDialog(); $("agFin").onclick = () => finishesDialog(); $("agCheck").onclick = () => P.proj && agentCheck("all");
  $("aiRead").onclick = () => aiSend($("aiIn").value.trim() || "Measure the floor area of every room in this view.", true).then(() => { $("aiIn").value = ""; });
  $("aiSend").onclick = () => { const t = $("aiIn").value.trim(); if (t) aiSend(t, false).then(() => { $("aiIn").value = ""; }); };
  $("aiIn").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("aiSend").click(); } });
  $("bLw").onclick = () => setThin(!S.thin);
  ["auto", "black", "white"].forEach(v => { $("bBg_" + v).onclick = () => setBg(v); }); $("bMono").onclick = () => setMono(!S.mono); $("bPdfBw").onclick = () => setPdfBw(!(S.bg === "white" && S.mono));
  const vpop = $("viewPop"), vOpen = on => { vpop.classList.toggle("on", on); $("bView").setAttribute("aria-expanded", on ? "true" : "false"); };
  $("bView").onclick = e => { e.stopPropagation(); vOpen(!vpop.classList.contains("on")); };
  document.addEventListener("pointerdown", e => { if (vpop.classList.contains("on") && !e.target.closest("#viewPop,#bView")) vOpen(false); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && vpop.classList.contains("on")) { vOpen(false); e.stopPropagation(); } }, true);
  $("bFitW").onclick = () => { fitWidth(); vOpen(false); };
  { const hd = document.querySelector("header"); new ResizeObserver(() => document.documentElement.style.setProperty("--hh", hd.offsetHeight + "px")).observe(hd); }   // the bar's height (one row, or two on a narrower screen)
  $("bLbl").onclick = () => setLblOn(!S.lbl.on); $("bLblSet").onclick = () => { vOpen(false); labelDialog(); }; $("bLegend").onclick = () => legendButton();
  $("bHideMk").onclick = () => { S.hideMk = !S.hideMk; $("bHideMk").classList.toggle("on", !S.hideMk); $("bHideMk").title = S.hideMk ? "Markups hidden — click to show all" : "Hide all markups (measurements and notes) to see the drawing"; viewMark(); draw(); toast(S.hideMk ? "All markups hidden" : "Markups shown", 1500); };
  $("bLayers").onclick = () => { vOpen(false); S.lHide = false; setPanels(); leftTab(true); if (!(S.ocgs && S.ocgs[S.fileId])) toast("This PDF has no layers — AutoCAD keeps them when plotted with DWG To PDF.pc3 and “Include layer information”", 5000); };
  $("bDel").onclick = () => delSelected();
  $("bKeys").onclick = keysDialog;
  ribbonInit();
  $("bZw").onclick = () => P.proj && S.page && setTool("zoomwin");
  $("bUndo").onclick = undoAny; $("bRedo").onclick = redoAny;
  $("bExport").onclick = exportMenu;
  $("scaleChip").onclick = scaleDialog;
  $("bNewCond").onclick = () => P.proj && editCond(null);
  $("bProjects").onclick = showStart;
  $("projName").onchange = e => { if (P.proj) { P.proj.name = e.target.value.trim() || "Untitled takeoff"; save(); } };
  $("bSaveProj").onclick = async () => {
    if (!P.proj) return toast("Open a project first");
    const typedName = String(($("projName") || {}).value || "").trim();
    if (typedName) P.proj.name = typedName;
    savePr = P.proj; const ok = await flushSave();
    toast(ok ? "Project saved successfully" : "Project could not be saved", 2200);
  };
  $("bRename").onclick = async () => {
    if (!P.proj) return toast("Open a project first");
    const v = await ask("Change Project Name", '<div class="fg w2"><label>Project name</label><input type="text" id="dlgName" value="' + esc(P.proj.name) + '" placeholder="Project name"></div>', "Save Name", () => ({name: $("dlgName").value.trim()}), "dlgName");
    if (!v || !v.name) return;
    P.proj.name = v.name; $("projName").value = v.name; save(); await flushSave();
    toast("Project renamed to " + v.name, 2200);
  };
  $("bNewTop").onclick = () => $("bNewProj").click();
  $("bNewProj").onclick = async () => { const v = await ask("New project", '<div class="fg w2"><label>Project name</label><input type="text" id="dlgName" placeholder="e.g. NEO — Block A ground floor"></div>', "Create", () => ({name: $("dlgName").value.trim() || "Untitled takeoff"}), "dlgName");
    if (!v) return; const pr = newProject(v.name); await dbPut("projects", pr); await openProject(pr.id); };
  $("bImport").onclick = () => $("impIn").click();
  $("impIn").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const buf = await f.arrayBuffer(); await (isBundle(buf) ? importBundle(buf) : importProject(new TextDecoder().decode(buf))); } catch (er) { toast("Could not import: " + er.message, 5000); } };
  $("projList").addEventListener("click", async e => {
    const o = e.target.closest("[data-open],[data-edit],[data-dup],[data-del],[data-bak]"); if (!o) return;
    if (o.dataset.open) return openProject(o.dataset.open);
    if (o.dataset.edit) {
      const pr = await dbGet("projects", o.dataset.edit); if (!pr) return toast("Project not found");
      const v = await ask("Edit Project Name", '<div class="fg w2"><label>Project name</label><input type="text" id="dlgName" value="' + esc(pr.name) + '"></div>', "Save Name", () => ({name: $("dlgName").value.trim()}), "dlgName");
      if (!v || !v.name) return;
      pr.name = v.name; pr.updated = new Date().toISOString(); await dbPut("projects", pr);
      if (P.proj && P.proj.id === pr.id) { P.proj.name = pr.name; $("projName").value = pr.name; saveSay("ok", pr.updated); }
      toast("Project name updated", 1800); return showStart();
    }
    if (o.dataset.bak) return backupsDialog(o.dataset.bak);
    if (o.dataset.dup) { const pr = await dbGet("projects", o.dataset.dup); const cp = Object.assign(JSON.parse(JSON.stringify(pr)), {id: uid("P"), name: pr.name + " (copy)", updated: new Date().toISOString()}); await dbPut("projects", cp); return showStart(); }
    if (o.dataset.del) { const pr = await dbGet("projects", o.dataset.del); const ok = await ask("Delete project", `<p>Delete <b>${esc(pr.name)}</b> with its ${pr.items.length} measurements and stored PDFs? This cannot be undone.</p>`, "Delete");
      if (!ok) return; const others = (await dbAll("projects")).filter(x => x.id !== pr.id), keep = new Set(others.flatMap(x => x.files.map(f => f.id)));
      for (const f of pr.files) if (!keep.has(f.id)) await dbDel("pdfs", f.id); await dbDel("projects", pr.id); await mkAssetsCleanup((pr.marks || []).flatMap(mkAids)); if (P.proj && P.proj.id === pr.id) P.proj = null; showStart(); }
  });
  $("projectSearch").addEventListener("input", () => showStart());  $("condList").addEventListener("click", e => {
    if (e.target.id === "bFirstCond") return editCond(null);
    const ed = e.target.closest("[data-edit]"); if (ed) return editCond(cond(ed.dataset.edit));
    const ck = e.target.closest("[data-ck]"); if (ck) { if (ck.checked) S.condSel.add(ck.dataset.ck); else S.condSel.delete(ck.dataset.ck); renderConds(); return; }
    const cka = e.target.closest("[data-cka]"); if (cka) { S.condSel = cka.checked ? new Set(P.proj.conds.map(c => c.id)) : new Set(); renderConds(); return; }
    const ca = e.target.closest("[data-cact]"); if (ca) { const a = ca.dataset.cact, sel = S.condSel;
      if (a === "del") { const n = P.proj.items.filter(i => sel.has(i.cond)).length;
        ask("Delete " + sel.size + " condition" + (sel.size > 1 ? "s" : ""), `<p>Delete ${[...sel].map(id => "<b>" + esc(cond(id).name) + "</b>").join(", ")}${n ? ` and their <b>${n}</b> measurement${n > 1 ? "s" : ""}` : ""}? Undo (Ctrl+Z) brings them back.</p>`, "Delete").then(ok => { if (!ok) return;
          mutate(() => { P.proj.items = P.proj.items.filter(i => !sel.has(i.cond)); P.proj.conds = P.proj.conds.filter(c => !sel.has(c.id)); }); if (sel.has(S.cond)) S.cond = (P.proj.conds[0] || {}).id || null; S.condSel = new Set(); refresh(); });
        return; }
      P.proj.conds.forEach(c => { c.hidden = a === "allon" ? false : a === "alloff" ? true : a === "show" ? (sel.has(c.id) ? false : c.hidden) : a === "hide" ? (sel.has(c.id) ? true : c.hidden) : !sel.has(c.id); });
      if (S.sel && hiddenItem(P.proj.items.find(i => i.id === S.sel) || {})) S.sel = null; save(); refresh(); return; }
    const ey = e.target.closest("[data-eye]"); if (ey) { const c = cond(ey.dataset.eye); c.hidden = !c.hidden; if (c.hidden && S.sel && P.proj.items.some(i => i.id === S.sel && i.cond === c.id)) S.sel = null; save(); refresh(); return; }
    const co = e.target.closest("[data-color]"); if (co) return colorPop(co, cond(co.dataset.color));
    const c = e.target.closest("[data-cond]"); if (!c) return;
    S.cond = c.dataset.cond; S.sel = null; const ct = cond(S.cond).type;
    setTool(S.tool === "select" || S.tool === "pan" || S.tool === "measure" || S.tool === "cal" || (S.tool === "count" && ct !== "count") || (S.tool === "auto" && ct !== "area") ? (ct === "count" ? "count" : "draw") : S.tool); refresh();
  });
  $("sheet").addEventListener("click", async e => {   // (rows also jump to their page)
    const rn = e.target.closest("[data-rename]");
    if (rn) return renameItem(P.proj.items.find(i => i.id === rn.dataset.rename));
    const tr = e.target.closest("[data-item]"); if (!tr) return;
    const it = P.proj.items.find(i => i.id === tr.dataset.item); if (!it) return;
    if (it.file !== S.fileId || it.page !== S.pageNo) await gotoPage(it.file, it.page);
    S.sel = it.id; S.cond = it.cond; setTool("select"); S.sel = it.id;
    const xs = it.pts.map(p => toScr(p)), x0 = Math.min(...xs.map(p => p[0])), x1 = Math.max(...xs.map(p => p[0])), y0 = Math.min(...xs.map(p => p[1])), y1 = Math.max(...xs.map(p => p[1]));
    const w = stage().clientWidth, h = stage().clientHeight;
    if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) { S.view.tx += w / 2 - (x0 + x1) / 2; S.view.ty += h / 2 - (y0 + y1) / 2; applyView(); renderHi(); }
    refresh();
  });
  $("props").addEventListener("change", e => {
    const mk = e.target.dataset.mprop && (P.proj.marks || []).find(m => m.id === S.selMark);
    if (mk) { mkPropSet(mk, e.target.dataset.mprop, e.target); return; }
    const it = P.proj.items.find(i => i.id === S.sel), f = e.target.dataset.prop; if (!it || !f) return;
    if (f === "qa") return setQa([it], e.target.value);
    mutate(() => {
      if (f === "nos") { const v = Math.round(+e.target.value || 1); it.nos = Math.max(1, Math.min(100000, v)); if (v > 100000) toast("Nos is limited to 100,000 — check the number typed", 3500); }
      else if (f === "ow" || f === "oh") { const v = e.target.value.trim() ? parseFt(e.target.value) : 0; if (!isNaN(v)) it[f] = v; }
      else if (f === "doorW") { const s = e.target.value.trim(); if (!s) delete it.doorW; else { const v = s.split("+").reduce((a, x) => a + parseFt(x), 0); if (!isNaN(v) && v >= 0) it.doorW = r3(v); } }
      else if (f === "color") { const c = cond(it.cond); if (c && HEXCOL.test(e.target.value)) c.color = e.target.value; }
      else if (f === "sw") { const c = cond(it.cond); if (c) c.sw = Math.max(1, Math.min(12, +e.target.value || 2)); }
      else if (f === "sch") { const s = schOf(e.target.value); if (s) { it.sch = s.id; it.label = s.mark; } else delete it.sch; }
      else if (LOC_KEYS.includes(f)) { const v = e.target.value.trim(); if (v) it[f] = v; else delete it[f]; }
      else it[f] = e.target.value;
    });
  });
  $("props").addEventListener("change", e => {   // a multiple selection: move to another condition
    if (e.target.dataset.mact !== "cond" || !e.target.value) return; const c = cond(e.target.value), ids = selIds();
    const bad = P.proj.items.filter(i => ids.has(i.id) && (cond(i.cond) || {}).type !== c.type).length;
    mutate(() => P.proj.items.forEach(i => { if (ids.has(i.id) && (cond(i.cond) || {}).type === c.type) i.cond = c.id; }));
    toast("Moved to " + c.name + (bad ? " — " + bad + " of another kind (area / length / count) left as they were" : ""), 3500); });
  $("props").addEventListener("click", e => {
    const m2 = e.target.closest("[data-mact2]"); if (m2) { const mk = S.selMark && objById(S.selMark); if (mk) mkPropAct(mk, m2.dataset.mact2); return; }
    const ma = e.target.closest("[data-mact]");
    if (ma && ma.dataset.mact === "del") return delSelected();
    if (ma && ma.dataset.mact === "join") return joinRuns(new Set(S.multi));
    if (ma && ma.dataset.mact === "dup") return duplicateSel();
    if (ma && ma.dataset.mact === "lock") return lockSel();
    if (ma && ma.dataset.mact === "rot") return transformSel("cw");
    if (ma && ma.dataset.mact === "check") return setQa(P.proj.items.filter(i => S.multi.has(i.id)), "checked");
    if (ma && ma.dataset.mact === "hide") { const cs = new Set(P.proj.items.filter(i => S.multi.has(i.id)).map(i => i.cond)); P.proj.conds.forEach(c => { if (cs.has(c.id)) c.hidden = true; }); S.multi.clear(); save(); refresh(); return; }
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "lock") return lockSel();
    if (a.dataset.act === "dup") return duplicateSel();
    if (a.dataset.act === "brk") return setTool("break");
    if (a.dataset.act === "delMark") return delObjects(new Set([S.selMark]));
    const it = P.proj.items.find(i => i.id === S.sel); if (!it) return;
    if (a.dataset.act === "delItem") return delObjects(new Set([it.id]));
    if (a.dataset.act === "delPoint" && S.selPt >= 0) { delPoint(it, S.selPt); refresh(); }
  });
  document.addEventListener("keydown", e => {
    if ($("dlgBack").classList.contains("on") || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!P.proj) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if ($("ctx").classList.contains("on")) { if (e.key === "Escape") { ctxClose(); return; } ctxClose(); }
    if (e.altKey && !mod && k === "l") { e.preventDefault(); return mlToggle(); }   // Bluebeam: Alt+L, the Markups list
    if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? redoAny() : undoAny(); }
    if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); return redoAny(); }
    if (e.altKey && S.cmp && /^Arrow/.test(e.key)) { e.preventDefault(); const st2 = (e.shiftKey ? 10 : 1) / S.view.s; S.cmp.dx += e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0; S.cmp.dy += e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0; clearTimeout(S.cmpT); S.cmpT = setTimeout(() => { renderLow(); renderHi(true); }, 120); return; }
    if (mod && k === "a") { e.preventDefault(); return selectAll(); }
    if (mod && /^Arrow/.test(e.key) && selIds().size) { e.preventDefault(); return arrayDialog({ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down"}[e.key]); }   // PlanSwift: Ctrl + arrow copies at a distance
    if (!e.altKey && !mod && /^Arrow/.test(e.key) && selIds().size) { e.preventDefault(); const st2 = e.shiftKey ? 10 : 1; nudgeSel(e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0, e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0); return; }
    if (mod && k === "c") { e.preventDefault(); return copySel(); }
    if (mod && k === "x") { e.preventDefault(); return copySel(true); }
    if (mod && k === "v") { e.preventDefault(); return pasteClip(e.shiftKey ? "inplace" : "cursor"); }
    if (mod && k === "d") { e.preventDefault(); return duplicateSel(); }
    if (mod && e.shiftKey && k === "l") { e.preventDefault(); return lockSel(); }
    if (mod && k === "f") { e.preventDefault(); $("findIn").focus(); $("findIn").select(); return; }
    if (e.key === "Tab" && !mod && !e.altKey) { if (S.tool === "select" && cycleSel()) e.preventDefault(); return; }
    if (e.key === "F2") { e.preventDefault(); const one = selOne(); if (one) renameItem(one); else if (S.selMark) editMarkText(objById(S.selMark)); return; }
    if (mod || e.altKey) return;
    if (e.key === " ") { S.space = true; stage().classList.add("pan"); e.preventDefault(); return; }
    if (e.key === "?") { keysDialog(); return; }
    if (e.key === "F8") { e.preventDefault(); return setOrtho(!S.ortho); }
    if (e.key === "F10") { e.preventDefault(); return setPolar(!S.polar); }
    if (e.key === "Escape" && S.typed) { S.typed = ""; draw(); return; }
    if (e.key === "Escape" && S.mkd) { S.mkd = null; draftClear(); draw(); return; }
    if (e.key === "Escape" && S.drag && (S.drag.vertex != null || S.drag.move || S.drag.mh != null)) { cancelDrag(); return; }
    if (e.key === "Escape" && S.tool === "match") { setTool("select"); return; }
    if (e.key === "Escape" && S.draft.length === 0 && (S.multi.size || S.box || S.lasso)) { S.multi.clear(); S.box = null; S.lasso = null; refresh(); return; }
    if (e.key === "Escape") { if (S.autoShow) { S.autoShow = null; }
      if (S.pickWall) { S.pickWall = false; hint(); }
      else if (S.arcMode) { S.arcMode = 0; S.arcMid = null; hint(); }
      else if (S.draft.length) { if (S.resume) toast("Run left as it was", 1500); S.resume = null; draftClear(); hint(); }
      else if (["gap", "stamp", "break", "zoomwin", "lasso", "match"].indexOf(S.tool) >= 0) setTool("select");
      else if (S.measures.length || S.measure) { S.measures = []; S.measure = null; }
      else if (S.sel || S.selMark) { setSel([]); }
      else setTool("select");
      refresh(); return; }
    if (S.draft.length && ["draw", "ded", "measure", "fence", "rect", "mk_polyline", "mk_polygon"].indexOf(S.tool) >= 0 && !S.arcMid) {   // Bluebeam "sketch to scale": type a length (12'-6", 12.5) — or L x W for a rectangle — and Enter
      const ch = e.key, buf = S.typed || "";
      if (/^[0-9.'"\/]$/.test(ch) || (buf && /^[- xX×]$/.test(ch))) { S.typed = buf + ch; e.preventDefault(); draw(); return; }
      if (buf && e.key === "Backspace") { S.typed = buf.slice(0, -1); e.preventDefault(); draw(); return; }
      if (buf && e.key === "Escape") { S.typed = ""; draw(); return; }
      if (buf && e.key === "Enter") { e.preventDefault(); typedPoint(buf); return; }
    }
    if (e.key === "Enter") {
      if (S.tool === "measure" && S.verify && S.measure && S.measure.length > 1) return verifyMeasure();
      if (S.draft.length) endDraft();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (S.draft.length || S.arcMode) { draftBack(); e.preventDefault(); return; }
      if (S.selMark || S.sel || S.multi.size) { e.preventDefault(); delSelected(); }
      return;
    }
    if (k === "a" && S.draft.length && ["draw", "ded", "measure", "fence"].indexOf(S.tool) >= 0) { S.arcMode = S.arcMode ? 0 : 1; S.arcMid = null; hint(); draw(); return; }   // PlanSwift: A while drawing = arc
    if (k === "o" && e.shiftKey) { setTool("lasso"); return; }   // Bluebeam: Shift+O lasso
    if (e.shiftKey) { const ST = {l: "mk_line", r: "mk_box", e: "mk_ellipse", h: "mk_hpen"}; if (ST[k]) { setTool(ST[k]); return; } }
    const T = {v: "select", h: "pan", a: "draw", r: "rect", w: "auto", c: "count", e: "circle", n: "note", u: "cloud", d: "ded", o: "open", m: "measure", k: "cal", b: "break", z: "zoomwin",
      t: "mk_text", q: "mk_callout", p: "mk_pen", g: "mk_polygon", y: "mk_polyline", x: "mk_stamp", i: "mk_image"};
    if (T[k]) { setTool(T[k]); return; }
    if (k === "l") return setLblOn(!S.lbl.on);
    if (k === "s") { $("snapOn").checked = !$("snapOn").checked; toast("Snap " + ($("snapOn").checked ? "on" : "off")); return; }
    if (k === "f") { if (e.shiftKey) fitWidth(); else { fit(); renderHi(); } return; }
    if (k === "+" || k === "=") return zoomAt(1.25, stage().clientWidth / 2, stage().clientHeight / 2);
    if (k === "-") return zoomAt(0.8, stage().clientWidth / 2, stage().clientHeight / 2);
    if (e.key === "Home" || e.key === "End") { const o = [...$("pageSel").options].map(x => x.value).filter(v => v.indexOf("|") > 0), n = e.key === "Home" ? o[0] : o[o.length - 1]; if (n) { e.preventDefault(); const [f, p] = n.split("|"); gotoPage(f, +p); } return; }
    if (e.key === "PageDown") return stepPage(1);
    if (e.key === "PageUp") return stepPage(-1);
    if (/^[1-9]$/.test(k) && P.proj.conds[+k - 1]) { S.cond = P.proj.conds[+k - 1].id; setTool(S.tool === "select" || S.tool === "pan" ? "draw" : S.tool); refresh(); }
  });
  document.addEventListener("keyup", e => { if (e.key === " ") { S.space = false; stage().classList.toggle("pan", S.tool === "pan"); } });
}
function stepPage(d){
  const o = [...$("pageSel").options].map(x => x.value), i = o.indexOf(S.fileId + "|" + S.pageNo), n = o[i + d];
  if (n && n.indexOf("|") > 0) { const [f, p] = n.split("|"); gotoPage(f, +p); }
}

/* ------------------------------------------------------------------ Claude: reads the drawing and draws the areas
   The view on screen goes to Claude as a picture, with the page's own text (room names, sizes) and positions. Claude
   answers by calling the drawing tools below: trace_room runs the auto-area engine from a point it picks inside a room,
   draw_area draws an outline from corners it reads off the picture, delete_area removes one it got wrong. Every tool
   result carries the area in Sft, so Claude checks it against the size written in the room. Runs in this browser with
   the user's own Anthropic API key (kept in this browser's storage, sent only to api.anthropic.com). */
const ANTHROPIC_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
const AI_MODEL = "claude-opus-5-5";
const AI = {client: null, key: "", history: [], view: null, busy: false};
const AI_SYSTEM = `You are a quantity surveyor's takeoff assistant inside a PDF takeoff tool (Pakistan house standard: decimal feet, Sft, cft, ft, Nos; never metric). You see the part of a construction drawing on the user's screen as an image, with the text found on the PDF page and where it sits.

FIRST, UNDERSTAND THE TASK. If the instruction is unclear or a needed fact is missing — which items, which part of the drawing, which condition, a wall height or slab thickness for Sft / cft, whether openings are deducted — ask ONE short, specific question and stop (call no tools). Offer the likely choices in the question. Never guess a height, thickness, rate or size; if the drawing shows it, say where you read it.

THEN USE THE SPECIALISTS — they work from the PDF's own vector lines and text, so they are fast and exact:
- measure_unit: every room of one apartment by its number on the plan (e.g. 107), with the apartment total.
- measure_rooms: floor areas of rooms named on the drawing (auto-traced from inside the walls, checked against the written size). Use it first for any room / floor area task.
- detect_walls: wall runs from their two parallel face lines (CAD PDFs). Give the thickness (9" = 0.75 ft, 13.5" = 1.125, 4.5" = 0.375); list_wall_thicknesses tells you what is drawn. Openings are bridged — they are deducted separately.
- count_tags: door / window / any tag written on the drawing (D1, W2, V1…), counted from the text.
- find_text: where a word or tag is, and how many times it appears.
- set_condition: make or change a condition (unit, height H, thickness T, faces) — only with values the user gave or the drawing states.
Only when a specialist cannot do it, draw by hand: trace_room (a point inside a room), draw_area (corners at the inside faces of the walls, clockwise; points snap to the nearest drawing corner within 0.5 ft), draw_length (wall centre or face as asked), add_counts (one point on each item), delete_area. list_measured shows what is already on the page.

Coordinates: image pixels, origin top-left, x right, y down; every point must be inside the image.

CHECK YOUR WORK. Compare each area with the size written in the room (more than 5% off: delete it and draw it from corners, or tell the user why). Do not re-measure what is already measured unless asked. Name areas exactly as on the drawing.

REPLY in short plain lines: what you measured (name — quantity unit — ✓ or "check"), what you could not do and why, and the next step you suggest. Keep it brief.`;
const AI_TOOLS = [
  {name: "trace_room", description: "Measure a room's floor area by tracing it automatically from a point inside it (the tool follows the walls, closes door openings and ignores furniture and text). Returns the area in Sft and the traced outline in image pixels, or an error saying why it could not trace.",
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["name", "x", "y"], properties: {
     name: {type: "string", description: "Room name as written on the drawing"},
     x: {type: "number", description: "Image x (px) of a point inside the room, in open floor"},
     y: {type: "number", description: "Image y (px) of a point inside the room, in open floor"}}}},
  {name: "draw_area", description: "Draw an area from its corner points (image pixels, in order around the outline). Use when trace_room fails or gives a wrong outline. Returns the area in Sft.",
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["name", "points"], properties: {
     name: {type: "string", description: "Room name as written on the drawing"},
     points: {type: "array", description: "Corners in order, at least 3", items: {type: "object", additionalProperties: false, required: ["x", "y"], properties: {x: {type: "number"}, y: {type: "number"}}}}}}},
  {name: "draw_length", description: "Measure a length (walls, skirting, pipes) as a run through points in order (image pixels). Recorded under the named length condition, created if missing. Returns the length in ft.",
   input_schema: {type: "object", additionalProperties: false, required: ["condition", "name", "points"], properties: {
     condition: {type: "string", description: "Length condition, e.g. \"Brick masonry 9\\\" wall\" or \"Skirting\""}, name: {type: "string", description: "Label, e.g. the room or wall name"}, snap: {type: "boolean", description: "Snap each point to the nearest drawing corner (faces); leave false for centre lines"},
     points: {type: "array", items: {type: "object", additionalProperties: false, required: ["x", "y"], properties: {x: {type: "number"}, y: {type: "number"}}}}}}},
  {name: "add_counts", description: "Count items (doors, windows, fixtures, lights) by placing one point on each (image pixels). Recorded under the named count condition, created if missing. Returns the new total on this page.",
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["condition", "points"], properties: {
     condition: {type: "string", description: "What is counted, e.g. \"Doors D2\" or \"Windows\""},
     points: {type: "array", items: {type: "object", additionalProperties: false, required: ["x", "y"], properties: {x: {type: "number"}, y: {type: "number"}}}}}}},
  {name: "measure_rooms", description: "Specialist: measure the floor area of rooms named on this PDF page — each is auto-traced from inside its walls at its name and checked against the size written under it. Returns each room's area in Sft, the written size and whether it needs checking. Leave names empty for every room.",
   input_schema: {type: "object", properties: {names: {type: "array", items: {type: "string"}, description: "Room names to measure (e.g. [\"BEDROOM\", \"LOUNGE\"]); empty = all rooms"}}}},
  {name: "measure_unit", description: "Specialist: measure every room of one apartment by its number written on the plan (e.g. \"107\"): rooms belong to the nearest apartment number; each room is traced and checked, and the apartment total is compared with its written area.",
   input_schema: {type: "object", required: ["number"], properties: {number: {type: "string"}}}},
  {name: "list_wall_thicknesses", description: "Specialist: the wall thicknesses drawn in the view (from pairs of parallel face lines), with about how many ft of wall each. Use before detect_walls when the thickness is not given.",
   input_schema: {type: "object", properties: {}}},
  {name: "detect_walls", description: "Specialist: find every wall of the given thickness in the view (or page) from its two parallel face lines and mark it on its centre line in a length condition; openings are bridged (deducted separately); L corners meet on the centre line, T-junctions stop at the face. Returns runs and total length ft. Running it again replaces its earlier runs.",
   input_schema: {type: "object", required: ["thickness_ft"], properties: {thickness_ft: {type: "number", description: "Wall thickness in ft: 0.75 for 9 inch, 1.125 for 13.5 inch, 0.375 for 4.5 inch"},
     condition: {type: "string", description: "Existing length condition name to add to (optional)"}, height_ft: {type: "number", description: "Wall height for a new condition, only if the user gave it or the drawing states it"},
     whole_page: {type: "boolean", description: "Search the whole page, not only the view"}, bridge_ft: {type: "number", description: "Bridge gaps (openings) up to this length; default 6"}}}},
  {name: "count_tags", description: "Specialist: count door / window / ventilator tags (every spelling: D1, D-1, DR-01, DOOR 1, SD2, FD1, W1, WN-2, KW1, V1, VENT 1, primed W1', tags in two pieces) or any exact word written on the drawing (e.g. \"doors\", \"windows\", \"D1\", \"all\"), with one marker on each. Tags in a schedule table are not counted; the table's sizes / quantities are reported for checking. Returns the count per tag.",
   input_schema: {type: "object", required: ["what"], properties: {what: {type: "string"}, scope: {type: "string", enum: ["page", "pdf", "all"], description: "page (default), every page of this PDF, or every PDF in the project"}}}},
  {name: "find_text", description: "Find a word or tag in the page text: how many times it is on the page and where it is in the image (px).",
   input_schema: {type: "object", required: ["text"], properties: {text: {type: "string"}}}},
  {name: "set_condition", description: "Create or change a condition by name. type area | linear | count; unit: area Sft or cft, linear ft / Sft / cft, count Nos. Sft and cft walls need height_ft; cft needs thickness_ft. Only values the user gave or the drawing states.",
   input_schema: {type: "object", required: ["name", "type", "unit"], properties: {name: {type: "string"}, type: {type: "string", enum: ["area", "linear", "count"]}, unit: {type: "string"}, height_ft: {type: "number"}, thickness_ft: {type: "number"}, faces: {type: "number"}}}},
  {name: "list_measured", description: "List what is already measured on this page: id, name, condition, quantity and unit.",
   input_schema: {type: "object", properties: {}}},
  {name: "delete_area", description: "Delete a measured area by its id (from a tool result or the list of measured areas).",
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["id"], properties: {id: {type: "string"}}}}
];
async function aiClient(){
  const key = pref("zdTakeoffApiKey") || "";
  if (!key) return null;
  if (AI.client && AI.key === key) return AI.client;
  let Anthropic;
  try { Anthropic = (await import(ANTHROPIC_SDK)).default; } catch (e) { throw new Error("The Anthropic library could not be loaded — check the internet connection."); }
  AI.client = new Anthropic({apiKey: key, dangerouslyAllowBrowser: true}); AI.key = key;
  return AI.client;
}
async function aiSnapshot(maxMp){   // the part of the page on screen, long side 1600 px at most (and maxMp pixels, if given)
  const st = stage(), v = S.view;
  const bx0 = Math.max(0, -v.tx / v.s), by0 = Math.max(0, -v.ty / v.s);
  const bx1 = Math.min(S.base.width, (st.clientWidth - v.tx) / v.s), by1 = Math.min(S.base.height, (st.clientHeight - v.ty) / v.s);
  const w = bx1 - bx0, h = by1 - by0, sc = Math.min(1600 / Math.max(w, h), 8, maxMp ? Math.sqrt(maxMp / (w * h)) : 8), W = Math.max(1, Math.round(w * sc)), H = Math.max(1, Math.round(h * sc));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await sliced(S.page.render({...lay(S.fileId), canvasContext: ctx, viewport: S.page.getViewport({scale: sc}), transform: [1, 0, 0, 1, -bx0 * sc, -by0 * sc]})).promise;
  return {data: cv.toDataURL("image/png").split(",")[1], x0: bx0, y0: by0, sc, W, H, key: S.key};
}
const aiToPx = (V, p) => [Math.round((p[0] - V.x0) * V.sc), Math.round((p[1] - V.y0) * V.sc)];
const aiToBase = (V, x, y) => [V.x0 + x / V.sc, V.y0 + y / V.sc];
function snapCorner(p, r){   // the drawing corner (line end or crossing) nearest p within r, else null — for corners read off a picture
  const g = S.geo[S.key]; if (!g || !g.segs.length) return null;
  const near = segsIn(g, p[0] - r, p[1] - r, p[0] + r, p[1] + r).map(i => g.segs[i]).filter(s => !(s[4] & 9) && distSeg(p, [s[0], s[1]], [s[2], s[3]]) <= r).slice(0, 80);
  let best = null; const take = q => { const d = dist(p, q); if (d <= r && (!best || d < best.d)) best = {q, d}; };
  near.forEach(s => { take([s[0], s[1]]); take([s[2], s[3]]); });
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) { const x = segX([near[i][0], near[i][1]], [near[i][2], near[i][3]], [near[j][0], near[j][1]], [near[j][2], near[j][3]]); if (x) take(x); }
  return best ? best.q : null;
}
function aiContext(V){   // page text and measured areas inside the view, in image pixels
  const k = curScale(), inV = q => q[0] >= 0 && q[1] >= 0 && q[0] <= V.W && q[1] <= V.H;
  const texts = (S.texts[S.key] || []).map(t => ({s: t.s.trim(), q: aiToPx(V, [t.x, t.y])})).filter(t => t.s && inV(t.q)).slice(0, 400);
  const areas = P.proj.items.filter(it => it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && (cond(it.cond) || {}).type === "area")
    .map(it => ({it, q: it.pts.map(p => aiToPx(V, p))})).filter(a => a.q.some(inV));
  return `Image: ${V.W} × ${V.H} px. Scale: ${k ? "1 ft = " + (k * V.sc).toFixed(3) + " px in this image" : "not set — areas cannot be measured until the scale is set (K)"}.
Text on the page in view (text @ x,y px):
${texts.length ? texts.map(t => `"${t.s}" @ ${t.q[0]},${t.q[1]}`).join("\n") : "(none — the drawing may be a scan; read the image)"}
Already measured here: ${areas.length ? areas.map(a => `${a.it.id} "${a.it.label || "area"}" ${fq(polyArea(a.it.pts) / k / k)} Sft`).join("; ") : "none"}`;
}
function condByName(name, type){   // an existing condition of this type with this name, else a new one
  const n = String(name || "").trim() || (type === "count" ? "Count" : type === "linear" ? "Length" : "Floor area");
  let c = P.proj.conds.find(x => x.type === type && x.name.toLowerCase() === n.toLowerCase());
  if (!c) { c = {id: uid("C"), name: n, type, unit: type === "count" ? "Nos" : type === "linear" ? "ft" : "Sft", color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0}; P.proj.conds.push(c); }
  return c;
}
function aiAreaCond(){
  let c = S.cond ? cond(S.cond) : null;
  if (!c || c.type !== "area") c = P.proj.conds.find(x => x.type === "area");
  if (!c) { c = {id: uid("C"), name: "Floor area", type: "area", unit: "Sft", color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0}; P.proj.conds.push(c); }
  return c;
}
async function aiRunTool(b){
  const V = AI.view, k = curScale(), inp = b.input || {};
  if (!V || V.key !== S.key) return {err: "The page changed — ask the user to press ‘Read this view’ again."};
  if (!k) return {err: "The page scale is not set; ask the user to set it (K) first."};
  if (scaleDoubt()) return {err: "The page scale is doubtful (the drawing measures " + scaleDoubt().label + ", not the note) — ask the user to settle it before measuring."};
  const add = (name, pts) => { const c = aiAreaCond(), id = uid("I"); mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, ai: true, label: String(name || "").slice(0, 60)}); }); return id; };
  if (b.name === "trace_room") {
    const x = +inp.x, y = +inp.y; if (!(x >= 0 && y >= 0 && x <= V.W && y <= V.H)) return {err: "Point is outside the image."};
    const res = await autoRoom(aiToBase(V, x, y)); if (res.err) return {err: res.err};
    const nm = inp.name || roomNameAt(res.pts), id = add(nm, res.pts);
    return {ok: {id, name: nm, area_sft: +(polyArea(res.pts) / k / k).toFixed(2), squared: res.rect, outline_px: res.pts.map(p => aiToPx(V, p))}};
  }
  if (b.name === "draw_area") {
    let pts = (Array.isArray(inp.points) ? inp.points : []).filter(p => p && isFinite(+p.x) && isFinite(+p.y)).map(p => aiToBase(V, +p.x, +p.y));
    if (pts.length < 3 || polyArea(pts) < 1e-6) return {err: "Need at least 3 corners enclosing an area."};
    let snapped = 0; pts = pts.map(p => { const q = snapCorner(p, 0.5 * k); if (q) snapped++; return q || p; });
    const nm = inp.name || roomNameAt(pts), id = add(nm, pts);
    return {ok: {id, name: nm, area_sft: +(polyArea(pts) / k / k).toFixed(2), corners_snapped: snapped + " of " + pts.length}};
  }
  if (b.name === "measure_rooms") { const r = await agentMeasure((Array.isArray(inp.names) ? inp.names : []).join(" ")); return r && r.error ? {err: r.error} : r ? {ok: r} : {err: "No rooms measured."}; }
  if (b.name === "measure_unit") { const r = await agentUnit(String(inp.number || "")); return r && r.error ? {err: r.error} : r ? {ok: r} : {err: "Nothing measured."}; }
  if (b.name === "list_wall_thicknesses") return {ok: {in_view: wallThicknesses(viewRect()).map(w => ({thickness_ft: +w.t.toFixed(3), inches: Math.round(w.t * 24) / 2, wall_length_ft: Math.round(w.len)}))}};
  if (b.name === "detect_walls") { const r = wallsAgent({t: +inp.thickness_ft, cond: inp.condition || null, h: +inp.height_ft || 0, page: !!inp.whole_page, bridge: inp.bridge_ft == null ? 6 : +inp.bridge_ft}); refresh(); return r.error ? {err: r.error} : {ok: r}; }
  if (b.name === "count_tags") { const r = await agentCount(String(inp.what || "").toLowerCase().replace(/^all\s+/, ""), inp.scope === "pdf" || inp.scope === "all" ? inp.scope : "page"); return r && r.error ? {err: r.error} : r && r.counts ? {ok: r} : {err: "Nothing counted."}; }
  if (b.name === "find_text") { const q = String(inp.text || "").trim().toUpperCase(); if (!q) return {err: "No text given."};
    const hits = textLines(S.texts[S.key] || []).filter(l => l.s.toUpperCase().includes(q)), inV = p => p[0] >= 0 && p[1] >= 0 && p[0] <= V.W && p[1] <= V.H;
    return {ok: {on_page: hits.length, in_view: hits.map(l => ({text: l.s, at: aiToPx(V, [l.x + l.w / 2, l.y - l.h / 2])})).filter(h => inV(h.at)).slice(0, 60)}}; }
  if (b.name === "set_condition") { const type = inp.type, unit = String(inp.unit || ""), H = +inp.height_ft || 0, T = +inp.thickness_ft || 0;
    if (!UNITS[type] || !UNITS[type].includes(unit)) return {err: "Unit must be one of " + (UNITS[type] || []).join(", ") + " for " + type};
    if (type === "linear" && unit !== "ft" && !(H > 0)) return {err: "A wall in " + unit + " needs height_ft — ask the user."};
    if (unit === "cft" && !(T > 0)) return {err: "cft needs thickness_ft — ask the user."};
    let c = P.proj.conds.find(x => x.name.toLowerCase() === String(inp.name).toLowerCase() && x.type === type);
    mutate(() => { if (!c) { c = {id: uid("C"), name: String(inp.name).slice(0, 80), type, unit, color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0}; P.proj.conds.push(c); }
      Object.assign(c, {unit, h: H || c.h, t: T || c.t, faces: Math.max(1, Math.min(2, +inp.faces || c.faces || 1))}); });
    return {ok: {id: c.id, name: c.name, type, unit, height_ft: +c.h || null, thickness_ft: +c.t || null}}; }
  if (b.name === "list_measured") return {ok: {items: P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo).slice(0, 120).map(i => { const c = cond(i.cond) || {}, kk = itemScale(i); return {id: i.id, name: i.label || "", condition: c.name, qty: kk ? +rowsOf(i, kk).reduce((a, r) => a + r.qty, 0).toFixed(3) : null, unit: c.unit}; })}};
  if (b.name === "draw_length" || b.name === "add_counts") {
    if (b.name === "draw_length" && inp.snap) inp.points = (inp.points || []).map(p => { const q = p && snapCorner(aiToBase(V, +p.x, +p.y), 0.5 * k); return q ? {x: aiToPx(V, q)[0], y: aiToPx(V, q)[1]} : p; });
    const pts = (Array.isArray(inp.points) ? inp.points : []).filter(p => p && isFinite(+p.x) && isFinite(+p.y)).map(p => aiToBase(V, +p.x, +p.y));
    if (b.name === "draw_length") {
      if (pts.length < 2) return {err: "Need at least 2 points."};
      const c = condByName(inp.condition, "linear"), id = uid("I");
      mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, ai: true, label: String(inp.name || "").slice(0, 60)}); });
      return {ok: {id, name: inp.name, length_ft: +(polyLen(pts) / k).toFixed(3)}};
    }
    if (!pts.length) return {err: "No points."};
    const c = condByName(inp.condition, "count"); let it;
    mutate(() => { it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape");
      if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); } it.ai = true; it.qa = "";
      pts.forEach(p => it.pts.push(p)); });
    return {ok: {id: it.id, name: c.name, count_on_page: it.pts.length}};
  }
  if (b.name === "delete_area") {
    const it = P.proj.items.find(i => i.id === inp.id && i.file === S.fileId && i.page === S.pageNo);
    if (!it) return {err: "No area with that id on this page."};
    mutate(() => { P.proj.items = P.proj.items.filter(i => i !== it); }); if (S.sel === it.id) S.sel = null;
    return {ok: {deleted: it.id}};
  }
  return {err: "Unknown tool " + b.name};
}
const SPECIALISTS = ["measure_rooms", "detect_walls", "count_tags", "measure_unit"];
function aiToolMsg(name, inp, out){   // one line in the panel for a tool step
  const o = out.ok, nm = n => `<span class="small">(${esc(n.replace(/_/g, " "))})</span>`;
  if (!o) return `${esc(inp.name || name.replace(/_/g, " "))}: ${esc(out.err)}`;
  if (SPECIALISTS.includes(name)) return `Specialist ${nm(name)} done${o.total_length_ft != null ? ": <b>" + f3(o.total_length_ft) + " ft</b> in " + o.runs + " runs" : ""}`;
  if (o.deleted) return "Deleted an area";
  if (o.length_ft != null) return `${esc(inp.condition)} ${esc(inp.name || "")}: <b>${f3(o.length_ft)} ft</b> ${nm(name)}`;
  if (o.count_on_page != null && name === "add_counts") return `${esc(o.name)}: <b>${o.count_on_page} Nos</b> on this page ${nm(name)}`;
  if (o.area_sft != null) return `${esc(o.name || inp.name || "")}: <b>${fq(o.area_sft)} Sft</b> ${nm(name)}${o.corners_snapped ? ' <span class="small">corners snapped ' + esc(o.corners_snapped) + "</span>" : ""}`;
  return `${esc(name.replace(/_/g, " "))} ✓`;
}
function aiLog(kind, html){ const d = document.createElement("div"); d.className = "aimsg " + kind; d.innerHTML = html; $("aiLog").appendChild(d); $("aiLog").scrollTop = 1e9; return d; }
const aiText = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
async function aiSend(text, fresh){
  if (AI.busy || !P.proj) return;
  if (!S.page) return aiLog("err", "Open a PDF page first.");
  let client;
  try { client = await aiClient(); } catch (e) { aiLog("err", esc(e.message) + " Answering with the free agent instead."); return agentCmd(text); }
  if (!client) { const smp = await aiSampler(); return smp ? aiSendPlan(smp, text) : agentCmd(text); }   // no API key: Claude through claude.ai, else the free rule-based agent
  AI.busy = true; $("aiSend").disabled = true; $("aiRead").disabled = true;
  aiLog("user", esc(text));
  const wait = aiLog("wait", "Claude is reading the drawing…");
  let replied = false, free = false;   // free: the paid route failed before Claude did anything — the free agent answers instead
  try {
    const content = [];
    if (fresh || !AI.view || AI.view.key !== S.key) {
      AI.view = await aiSnapshot();
      content.push({type: "image", source: {type: "base64", media_type: "image/png", data: AI.view.data}}, {type: "text", text: aiContext(AI.view)});
    }
    content.push({type: "text", text});
    AI.history.push({role: "user", content});
    for (let turn = 0; turn < 16; turn++) {
      const res = await client.beta.messages.create({
        model: AI_MODEL, max_tokens: 16000, output_config: {effort: "high"},
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        system: [{type: "text", text: AI_SYSTEM, cache_control: {type: "ephemeral"}}],
        tools: AI_TOOLS, messages: AI.history
      }); replied = true;
      if (res.stop_reason === "refusal") { AI.history = []; aiLog("err", "Claude declined this request" + (res.stop_details && res.stop_details.explanation ? ": " + esc(res.stop_details.explanation) : "") + ". The chat was reset."); break; }
      AI.history.push({role: "assistant", content: res.content});
      res.content.forEach(b => { if (b.type === "text" && b.text.trim()) aiLog("bot", aiText(b.text)); });
      if (res.stop_reason === "max_tokens") { aiLog("err", "The answer was cut off (too long). Ask for fewer rooms at a time."); break; }
      if (res.stop_reason !== "tool_use") break;
      const results = [];
      for (const b of res.content.filter(x => x.type === "tool_use")) {
        let out; try { out = await aiRunTool(b); } catch (e) { out = {err: e.message || String(e)}; }
        aiLog(out.ok ? "tool" : "err", aiToolMsg(b.name, b.input || {}, out));
        results.push({type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out.ok || {error: out.err}), is_error: !out.ok});
      }
      AI.history.push({role: "user", content: results});
      refresh();
    }
  } catch (e) {
    const st = e && e.status; free = !replied && (st === 401 || st === 403 || !st);
    aiLog("err", (st === 401 ? "The API key was not accepted — check it (above)." : st === 429 ? "Rate limited by the API — wait a minute and try again." : esc("Request failed: " + (e.message || e)))
      + (free ? " Answering with the <b>free agent</b> instead — to use it always, remove the key: <b>Key</b> → clear the box → <b>Save</b>." : ""));
    if (st === 401) aiShowKey(true);
    // keep the conversation valid: drop a trailing user turn the API never answered
    while (AI.history.length && AI.history[AI.history.length - 1].role === "user" && !(AI.history[AI.history.length - 1].content || []).some(x => x.type === "tool_result")) AI.history.pop();
  }
  wait.remove(); AI.busy = false; $("aiSend").disabled = false; $("aiRead").disabled = false; refresh();
  if (free) await agentCmd(text, true);
}
/* the claude.ai route: when this page is opened as a Claude artifact, Claude runs on the viewer's own Claude plan through
   the artifact's `sample` capability — no API key. Same tools as above; each message sends a fresh picture of the view
   (kept under the platform's 1.2 MP limit so the pixel coordinates Claude reads are the ones the tools use). */
let aiSamplerP = null;
function aiSampler(){
  if (!aiSamplerP) aiSamplerP = (async () => {
    if (!window.claude || typeof window.claude.use !== "function") return null;
    try {
      const smp = await window.claude.use("sample"); if (!smp) return null;
      const lim = await smp.limits().catch(() => null);
      if (lim && lim.tools) AI.toolMax = lim.tools.maxCount || 99;
      return lim && lim.images && lim.tools ? smp : null;
    } catch (e) { return null; }
  })();
  return aiSamplerP;
}
async function aiSendPlan(smp, text){
  AI.busy = true; $("aiSend").disabled = true; $("aiRead").disabled = true;
  aiLog("user", esc(text));
  const ctl = new AbortController(); AI.stop = ctl;
  const wait = aiLog("wait", `Claude is reading the drawing… <a href="#" class="aiStop">Stop</a>`);
  wait.querySelector(".aiStop").onclick = e => { e.preventDefault(); ctl.abort(); };
  let bubble = null, said = "", from = 0;   // text after a tool step goes in a new bubble below it
  try {
    AI.view = await aiSnapshot(1150000);
    const blob = await (await fetch("data:image/png;base64," + AI.view.data)).blob();
    const order = ["measure_rooms", "measure_unit", "detect_walls", "count_tags", "list_wall_thicknesses", "trace_room", "draw_area", "draw_length", "add_counts", "delete_area", "find_text", "set_condition", "list_measured"];
    const tools = AI_TOOLS.slice().sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).slice(0, AI.toolMax || 99).map(t => ({name: t.name, description: t.description, inputSchema: t.input_schema,
      execute: async input => {
        if (ctl.signal.aborted) throw new Error("Stopped by the user.");
        const b = {name: t.name, input: input || {}};
        let out; try { out = await aiRunTool(b); } catch (e) { out = {err: e.message || String(e)}; }
        aiLog(out.ok ? "tool" : "err", aiToolMsg(b.name, b.input || {}, out));
        bubble = null; from = said.length; refresh();
        if (!out.ok) throw new Error(out.err);
        return out.ok;
      }}));
    AI.plan = (AI.plan || []).slice(-8);
    const turn = `${aiContext(AI.view)}\n\nThe attached image is the view on screen now; tool coordinates are pixels of this image.\n\n${text}`;
    const input = [{role: "user", content: AI_SYSTEM}, ...AI.plan, {role: "user", content: turn}];
    const res = await smp(input, {images: blob, tools, signal: ctl.signal,
      onText: ({text: t}) => { said = t; const part = t.slice(from).trim(); if (!part) return; if (!bubble) bubble = aiLog("bot", ""); bubble.innerHTML = aiText(part); $("aiLog").scrollTop = 1e9; }});
    if (!said) aiLog("bot", aiText(res.text));
    if (res.truncated) aiLog("err", "The answer was cut short. Ask for fewer rooms at a time.");
    AI.plan.push({role: "user", content: text}, {role: "assistant", content: res.text});
  } catch (e) {
    const c = e && e.code, m = {
      cancelled: "Stopped.", not_granted: "Claude was not allowed for this page. Reload and press Allow to use it.",
      sampling_disabled: "Claude is not available on this account.", rate_limited: "Your Claude usage limit was reached. Try again later.",
      session_expired: "Sign in to claude.ai again.", refused: "Claude declined this request. Rephrase it.",
      prompt_too_large: "Too much on screen. Zoom in to fewer rooms.", image_rejected: "The picture of the view was not accepted. Zoom in and try again."};
    if (bubble && e && e.text == null && c === "refused") bubble.remove();
    aiLog(c === "cancelled" ? "bot" : "err", esc(m[c] || "Request failed: " + ((e && e.message) || e)));
    if (["not_granted", "sampling_disabled", "capability_disabled", "not_declared", "tools_unavailable", "images_unavailable"].includes(c)) aiSamplerP = Promise.resolve(null);
  }
  AI.stop = null; wait.remove(); AI.busy = false; $("aiSend").disabled = false; $("aiRead").disabled = false; refresh();
}
/* the free route: the user's own Claude.ai chat does the reading. The view goes out as a picture plus instructions; the
   reply (JSON) comes back here. Each room is traced from Claude's point; if the trace disagrees with the size written
   on the drawing by more than 5 % and Claude gave corners, the corners are used. */
function freePrompt(V){
  return `I am measuring a construction drawing (floor plan). The attached image is ${V.W} × ${V.H} px; coordinates are image pixels from the top-left corner, x to the right, y down.
${aiContext(V)}

Please measure what I ask below and reply with ONE JSON block only, in this exact shape (leave out parts you do not need):
\`\`\`json
{"rooms": [{"name": "BEDROOM", "size": "14'-6\"x12'-0\"", "seed": [x, y], "corners": [[x, y], [x, y], [x, y], [x, y]]}],
 "lengths": [{"condition": "Brick wall 9 inch", "name": "Bedroom north wall", "points": [[x, y], [x, y]]}],
 "counts": [{"condition": "Doors D2", "points": [[x, y], [x, y]]}]}
\`\`\`
For each room: name as written, the size written under it (or "" if none), a seed point well inside the room in open floor (away from walls, text and furniture), and its corners clockwise at the inside faces of the walls (every corner for L-shapes). Never invent a size.

What I want measured: ${($("aiIn").value || "").trim() || "the floor area of every room in the image"}`;
}
async function freeCopy(){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  if (!curScale()) return aiLog("err", "Set the page scale first (K).");
  AI.freeView = await aiSnapshot();
  const txt = freePrompt(AI.freeView);
  let picOk = false;
  try { const blob = await (await fetch("data:image/png;base64," + AI.freeView.data)).blob(); await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]); picOk = true; } catch (e) {}
  AI.freeText = txt;
  aiLog("bot", `<b>Free route — your Claude.ai chat does the reading.</b><br>1. ${picOk ? "The picture of this view is <b>copied</b>: paste it (Ctrl+V) into a new chat at claude.ai." : "Save the picture: <a href='#' id='frPic'>download view.png</a>, then attach it in a new chat at claude.ai."}<br>
    2. <a href="#" id="frTxt">Copy the instructions</a> and paste them under the picture, then send.<br>3. Copy Claude's whole reply, press <b>Import from Claude</b> below and paste it.<br><span class="small">Keep this view as it is until you import — the reply's points refer to it.</span>`);
  const dl = document.getElementById("frPic"); if (dl) dl.onclick = e => { e.preventDefault(); const a = document.createElement("a"); a.href = "data:image/png;base64," + AI.freeView.data; a.download = "view.png"; a.click(); };
  document.getElementById("frTxt").onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(AI.freeText); aiLog("tool", "Instructions copied — paste them in the Claude.ai chat"); } catch (er) { aiLog("err", "Could not copy — select and copy this text:<br><textarea style='width:100%;height:120px'>" + esc(AI.freeText) + "</textarea>"); } };
}
function sizeArea(t){   // "14'-6\"x12'-0\"" -> 174.00 Sft (0 if not a size)
  const m = /^\s*([^xX×*]+?)\s*[xX×*]\s*([^xX×*]+?)\s*$/.exec(String(t || "")); if (!m) return 0;
  const a = parseFt(m[1]), b = parseFt(m[2]); return a > 0 && b > 0 ? a * b : 0;
}
async function freeImport(){
  const V = AI.freeView;
  if (!V) return aiLog("err", "Press <b>Copy for Claude</b> first — the reply's points refer to that picture.");
  if (V.key !== S.key) return aiLog("err", "The page changed since the picture was copied. Go back to that page, or copy again.");
  const raw = await ask("Import from Claude", `<div class="fg w2"><label>Paste Claude's whole reply</label><textarea id="frIn" style="width:100%;height:220px;font:12px monospace"></textarea></div>`, "Import", () => $("frIn").value.trim() ? {t: $("frIn").value} : "Paste the reply first", "frIn");
  if (!raw) return;
  let J; try { const t = raw.t.indexOf("{"), e2 = raw.t.lastIndexOf("}"); J = JSON.parse(raw.t.slice(t, e2 + 1)); } catch (e) { return aiLog("err", "No readable JSON in the reply — ask Claude to answer with the JSON block only."); }
  const k = curScale(), inImg = q => Array.isArray(q) && q.length === 2 && q[0] >= 0 && q[1] >= 0 && q[0] <= V.W && q[1] <= V.H;
  busy("Drawing Claude's measurements…"); await new Promise(r => setTimeout(r, 20));
  for (const r of (J.rooms || [])) {
    const want = sizeArea(r.size), corners = (r.corners || []).filter(inImg).map(q => aiToBase(V, q[0], q[1]));
    let pts = null, how = "";
    if (inImg(r.seed)) { const res = await autoRoom(aiToBase(V, r.seed[0], r.seed[1])); if (res.pts) { pts = res.pts; how = "traced"; } }
    const ar = q => polyArea(q) / k / k;
    if (pts && want && Math.abs(ar(pts) - want) / want > 0.05 && corners.length >= 3) { how = "from Claude's corners (trace gave " + fq(ar(pts)) + ")"; pts = corners; }
    if (!pts && corners.length >= 3) { pts = corners; how = "from Claude's corners"; }
    if (!pts) { aiLog("err", esc(r.name || "room") + ": no usable seed or corners"); continue; }
    const c = aiAreaCond(), id = uid("I"), a2 = ar(pts);
    mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, ai: true, label: String(r.name || "").slice(0, 60)}); });
    aiLog("tool", `${esc(r.name || "")}: <b>${fq(a2)} Sft</b> <span class="small">${esc(how)}${want ? " · written " + fq(want) + " Sft" + (Math.abs(a2 - want) / want > 0.05 ? " — check" : " ✓") : ""}</span>`);
  }
  for (const l of (J.lengths || [])) { const pts = (l.points || []).filter(inImg).map(q => aiToBase(V, q[0], q[1])); if (pts.length < 2) continue;
    const c = condByName(l.condition, "linear"); mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, ai: true, label: String(l.name || "").slice(0, 60)}); });
    aiLog("tool", `${esc(c.name)} ${esc(l.name || "")}: <b>${f3(polyLen(pts) / k)} ft</b>`); }
  for (const g of (J.counts || [])) { const pts = (g.points || []).filter(inImg).map(q => aiToBase(V, q[0], q[1])); if (!pts.length) continue;
    const c = condByName(g.condition, "count"); let it;
    mutate(() => { it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape"); if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); } it.ai = true; it.qa = ""; pts.forEach(p => it.pts.push(p)); });
    aiLog("tool", `${esc(c.name)}: <b>${pts.length} Nos</b> added`); }
  busy(""); refresh();
}
function aiShowKey(on){ $("aiKeyRow").style.display = on ? "flex" : "none"; if (on) secretSet($("aiKey"), pref("zdTakeoffApiKey") || ""); }
function aiToggle(on){
  $("aiPanel").classList.toggle("on", on); $("bClaude").classList.toggle("on", on);
  if (on) { aiShowKey(false); if (!$("aiLog").children.length) aiLog("bot", "I read the drawing and do the takeoff with you.<br><b>Free agents (no API key, no cost):</b> ⚡ <b>Full takeoff</b> does rooms, walls, doors / windows and finishes in one run — this page, the PDF or the project · 🏠 <b>Rooms</b> traces every named room and checks it against its written size · 🧱 <b>Walls</b> finds walls from their face lines · 🚪 <b>Doors / windows</b> counts the tags · 🎨 <b>Finishes</b> gives each room's plaster / paint, skirting and ceiling, openings deducted · ✅ <b>Check</b> audits the takeoff. Or type <i>measure bedroom</i>, <i>walls 9\"</i>, <i>count D1</i>, <i>how many doors</i>, <i>help</i>.<br><b>Claude:</b> with an API key, or opened in claude.ai — type what you want and press <b>Read this view</b>; Claude uses the agents, draws what they cannot, and asks you when something is unclear."); aiSampler().then(smp => { if (smp && !pref("zdTakeoffApiKey")) aiLog("bot", "<b>Connected to Claude through claude.ai — no API key needed.</b> Zoom to an area, type what to measure (e.g. <i>9\" walls on this floor, count doors D1</i>) and press <b>Read this view</b>. It runs on your Claude plan; the first time, press Allow."); }); setTimeout(() => $("aiIn").focus(), 0); }
}

/* ------------------------------------------------------------------ free drawing agent (no API key)
   Reads the PDF's own text: room names with their written sizes, door / window tags, levels, scale, unit types, stairs.
   Tasks: measure every room (auto area seeded at its name, checked against the written size), count tags, schedule. */
const ROOM_RX = /\b(MASTER\s+)?(BED\s*ROOM|BED|LOUNGE|LIVING|DRAWING|DINING|FAMILY|TV|KITCHEN|KIT|PANTRY|BATH|TOILET|W\.?C|POWDER|WASH|DRESS(ING)?|WARDROBE|W\.?I\.?C|STORE|LAUNDRY|UTILITY|SERVANT|MAID|DRIVER|GUARD|LOBBY|FOYER|ENTRANCE|PASSAGE|CORRIDOR|GALLERY|BALCONY|TERRACE|VERANDAH?|PORCH|LAWN|GARAGE|PARKING|STUDY|OFFICE|PRAYER|GYM|HALL|RECEPTION|STAIR(CASE|S)?|LIFT|LOBBY|DUCT|SHAFT|ELECTRIC(AL)?\s+ROOM|PLANT|SHOP|ROOM)\b/i;
const SIZE_RX = /(\d+(?:\.\d+)?\s*'\s*-?\s*(?:\d+(?:\.\d+)?)?(?:\s*\d\/\d)?\s*(?:"|'')?)\s*[xX×*]\s*(\d+(?:\.\d+)?\s*'\s*-?\s*(?:\d+(?:\.\d+)?)?(?:\s*\d\/\d)?\s*(?:"|'')?)/;
/* door / window / ventilator tags, every way they are written: D1, D-1, D.01, D 1A, D1', DR-1, DOOR 1, SD2, FD1, FRD1,
   MD1, GD1, AD1, DD1, RS1 (rolling shutter), W1, WN-2, WIN 3, WINDOW 4, KW1, TW1, BW1, CW1, SW1, FW1, AW1, SKY1, V1,
   VT1, VENT 1, LV1, DW1 … A tag written as two pieces (a "D" with a "1" beside or under it, as in a circled tag) is
   joined; tags in a door / window schedule table (a row with a size, or a column of marks) are not counted as
   placements — their sizes (and the table's quantity) are read for the opening schedule and the check. */
const TAG_PFX = {Doors: ["DOOR", "DR", "D", "SD", "SLD", "FD", "FRD", "MD", "GD", "AD", "DD", "RS", "RSD", "DW"], Windows: ["WINDOW", "WIN", "WN", "W", "WD", "KW", "TW", "BW", "CW", "SW", "FW", "AW", "GW", "SKY", "SKL"], Ventilators: ["VENT", "VT", "V", "LV"]};
const TAG_CANON = {DOOR: "D", DR: "D", WINDOW: "W", WIN: "W", WN: "W", VENT: "V", VT: "V", SKL: "SKY"};
const TAG_ALL = Object.values(TAG_PFX).flat().sort((a, b) => b.length - a.length);
const TAG_RX = new RegExp("^(" + TAG_ALL.join("|") + ")\\s*[-./]?\\s*(\\d{1,3})\\s*([A-Z]?)\\s*(['’′]{0,2})$", "i");   // W37 and W37' (primed: another size of the type) are different tags
const TAG_LETTERS = new RegExp("^(" + TAG_ALL.join("|") + ")\\s*[-./]?$", "i"), TAG_NUM = /^\d{1,3}[A-Z]?\s*['’′]{0,2}$/i;
const tagFam = pfx => Object.keys(TAG_PFX).find(f => TAG_PFX[f].includes(pfx)) || "Tags";
function tagParse(s){   // "Dr-01a'" -> {k: "D1A'", pfx: "D", fam: "Doors"} or null
  const m = TAG_RX.exec(String(s || "").trim().replace(/\s+/g, " ")); if (!m) return null;
  const p0 = m[1].toUpperCase(), pfx = TAG_CANON[p0] || p0;
  return {k: pfx + String(+m[2]) + (m[3] || "").toUpperCase() + (m[4] ? "'".repeat(m[4].length) : ""), pfx, fam: tagFam(pfx)};   // D-01 and D1 are one mark
}
const tagKind = k => tagFam((/^[A-Z]+/.exec(k) || [""])[0]);
/* a size written in a schedule: 3'-0" x 7'-0" · 3'0"X7'0" · 36" x 84" · 3.000 x 7.000 (ft) · 900 x 2100 (mm, converted) */
function sizePair(t){
  t = String(t || "").replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  let m = /(\d+(?:\.\d+)?\s*'\s*-?\s*[\d\s./]*"?|\d+(?:\.\d+)?\s*")\s*[xX×*]\s*(\d+(?:\.\d+)?\s*'\s*-?\s*[\d\s./]*"?|\d+(?:\.\d+)?\s*")/.exec(t);
  if (m) { const w = parseFt(m[1]), h = parseFt(m[2]); if (w > 0 && h > 0) return {w: r3(w), h: r3(h), how: "ft-in"}; }
  m = /(?:^|[^\d.])(\d{2,4}(?:\.\d+)?)\s*[xX×*]\s*(\d{2,4}(?:\.\d+)?)(?![\d.])/.exec(t);
  if (m && +m[1] >= 300 && +m[2] >= 300) return {w: r3(+m[1] / 304.8), h: r3(+m[2] / 304.8), how: "mm converted to ft"};
  m = /(?:^|[^\d.])(\d{1,2}\.\d{1,3})\s*[xX×*]\s*(\d{1,2}\.\d{1,3})(?![\d.])/.exec(t);
  if (m) return {w: r3(+m[1]), h: r3(+m[2]), how: "ft"};
  return null;
}
function tagsOf(T){   // pdf text pieces of one page -> {plan: {k: [[x, y]…]}, sched: {k: {w, h, qty, how}}, inSched: n}
  const P2 = T.map(p => Object.assign({}, p, {w: p.w || p.s.length * p.h * 0.55}));
  const used = new Set(), extra = [];
  P2.forEach((a, i) => {   // a tag in two pieces: letters, with the number beside them or under them (circled / hexagon tags)
    if (used.has(i) || !TAG_LETTERS.test(a.s.trim())) return;
    let best = null;
    P2.forEach((b, j) => { if (j === i || used.has(j) || !TAG_NUM.test(b.s.trim()) || b.h < 0.6 * a.h || b.h > 1.6 * a.h) return;
      const right = Math.abs(b.y - a.y) < 0.45 * a.h && b.x - (a.x + a.w) > -0.3 * a.h && b.x - (a.x + a.w) < 0.8 * a.h;
      const under = Math.abs((b.x + b.w / 2) - (a.x + a.w / 2)) < 1.2 * a.h && b.y - a.y > 0.6 * a.h && b.y - a.y < 1.8 * a.h;
      if (right || under) { const d = Math.hypot(b.x - a.x, b.y - a.y); if (!best || d < best.d) best = {j, d, under}; } });
    if (best) { const b = P2[best.j]; used.add(i); used.add(best.j);
      extra.push({s: a.s.trim() + b.s.trim(), x: Math.min(a.x, b.x), y: best.under ? (a.y + b.y) / 2 : a.y, w: best.under ? Math.max(a.w, b.w) : b.x + b.w - a.x, h: a.h, joined: true}); }
  });
  let pieces = P2.filter((_, i) => !used.has(i)).concat(extra);
  pieces = pieces.flatMap(p => { const tk = p.s.trim().split(/\s+/); if (tk.length < 2 || tk.length > 8 || !tk.every(x => tagParse(x))) return [p];   // "D1 D2 W1" in one piece: each its own tag
    const n = tk.length; return tk.map((x, i) => Object.assign({}, p, {s: x, x: p.x + p.w * i / n, w: p.w / n})); });
  const lines = textLines(pieces), occ = [];
  lines.forEach(l => { const g = tagParse(l.s); if (g) occ.push({k: g.k, l, x: l.x + l.w / 2, y: l.y - l.h / 2}); });
  const sched = {}, inSch = new Set();
  occ.forEach(o => {   // a schedule row: the tag with a size on the same line to its right
    const l = o.l, cand = lines.filter(r => r !== l && Math.abs(r.y - l.y) < 0.6 * Math.max(r.h, l.h) && r.x > l.x + l.w - l.h && r.x < l.x + 80 * l.h).sort((a, b) => a.x - b.x), row = [];
    let edge = l.x + l.w; for (const r of cand) { if (r.x - edge > 12 * l.h || tagParse(r.s)) break; row.push(r); edge = Math.max(edge, r.x + r.w); }   // the cells of its table row: each close after the last
    let sz = sizePair(row.map(r => r.s).join("  "));
    if (!sz) { const L = (row.map(r => r.s).join("  ").replace(/[’′]/g, "'").replace(/[”″]/g, '"').match(/\d+(?:\.\d+)?\s*'\s*-?\s*(?:\d+(?:\.\d+)?)?(?:\s*\d\/\d)?\s*"?/g) || []).map(parseFt).filter(v => v > 0);   // width and height in their own columns
      if (L.length >= 2) sz = {w: r3(L[0]), h: r3(L[1]), how: "ft-in"}; }
    if (!sz) return;
    const q = row.map(r => /^\s*(\d{1,3})\s*(?:NOS?\.?|PCS|NUMBERS?)?\s*$/i.exec(r.s)).filter(Boolean).pop();
    inSch.add(o); sched[o.k] = Object.assign(sched[o.k] || {}, sz, q ? {qty: +q[1]} : {}, {page: true});
  });
  const byX = occ.filter(o => !inSch.has(o)).sort((a, b) => a.x - b.x || a.y - b.y);   // a column of marks close under each other: a schedule
  for (let i = 0; i < byX.length;) {
    let j = i + 1; while (j < byX.length && Math.abs(byX[j].x - byX[i].x) < 0.8 * byX[i].l.h) j++;
    const col = byX.slice(i, j).sort((a, b) => a.y - b.y); let run = [col[0]];
    const flush = () => { if (run.length >= 3 && new Set(run.map(o => o.k)).size >= Math.min(3, run.length)) run.forEach(o => inSch.add(o)); };
    for (let n = 1; n < col.length; n++) { if (col[n].y - col[n - 1].y < 3 * col[n].l.h) run.push(col[n]); else { flush(); run = [col[n]]; } }
    flush(); i = j;
  }
  const plan = {};
  occ.forEach(o => { if (!inSch.has(o)) (plan[o.k] = plan[o.k] || []).push([o.x, o.y]); });
  return {plan, sched, inSched: inSch.size};
}
/* door swings on the page's own lines (for drawings with no door tags): every swing arc with a 1.2–6 ft radius is a door
   leaf; two leaves hinged at either side of one opening are one double door */
function doorSwings(){
  const g = S.geo[S.key], k = curScale(); if (!g || !k) return null;
  const ids = segsIn(g, 0, 0, S.base.width, S.base.height), sk = doorSymbols(g, ids, k), L = sk.swings || [], used = new Set(), out = [];
  L.forEach((a, i) => { if (used.has(i)) return; used.add(i);
    const j = L.findIndex((b, n) => !used.has(n) && Math.abs(a.R - b.R) < 0.25 * Math.max(a.R, b.R) && Math.abs(dist(a.C, b.C) - (a.R + b.R)) < 0.3 * (a.R + b.R));
    if (j >= 0) { used.add(j); const b = L[j]; out.push({p: [(a.M[0] + b.M[0]) / 2, (a.M[1] + b.M[1]) / 2], leaves: 2, w: (a.R + b.R) / k}); }
    else out.push({p: a.M, leaves: 1, w: a.R / k}); });
  return out;
}
async function scanTags(scope){   // -> [{f, i, key, T: tagsOf}] for this page, this PDF, or every PDF of the project
  const pages = scope === "page" ? [{f: P.proj.files.find(x => x.id === S.fileId), i: S.pageNo}] : allPages().filter(o => scope === "all" || o.f.id === S.fileId);
  const out = [];
  for (const [n, o] of pages.entries()) { if (pages.length > 1) busy("Reading tags — page " + (n + 1) + " of " + pages.length + "…"); out.push({f: o.f, i: o.i, key: keyOf(o.f.id, o.i), T: tagsOf(await pageTexts(o.f.id, o.i))}); }
  busy(""); return out;
}
const tagWanted = (k, f) => !f || f === "ALL" || f === "TAGS" ? true : /^DOORS?$/.test(f) ? tagKind(k) === "Doors" : /^WINDOWS?$/.test(f) ? tagKind(k) === "Windows" : /^VENT/.test(f) ? tagKind(k) === "Ventilators" : (tagParse(f) || {k: f}).k === k;
function putCounts(res, pick, group){   // count markers from scanned tags; group: "mark" (one condition per tag) or "type" (Doors / Windows / Ventilators)
  const lines = {};
  res.forEach(r => pick.forEach(t2 => {
    const pts = r.T.plan[t2]; if (!pts || !pts.length) return;
    const name = group === "type" ? tagKind(t2) : t2, c = condByName(name, "count");
    if (!c.sym) { c.sym = tagKind(t2) === "Doors" ? "square" : tagKind(t2) === "Windows" ? "diamond" : "circle"; c.cap = group === "type" ? "name" : "seq"; }
    let it = P.proj.items.find(i => i.cond === c.id && i.file === r.f.id && i.page === r.i && i.kind === "shape");
    if (!it) { it = {id: uid("I"), cond: c.id, file: r.f.id, page: r.i, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); } it.ai = true; it.qa = "";
    let n = 0; pts.forEach(p => { if (!it.pts.some(o => dist(o, p) < 2)) { it.pts.push(p); n++; } });
    const L = lines[t2] = lines[t2] || {n: 0, added: 0, pages: []}; L.n += pts.length; L.added += n; L.pages.push(pageName({file: r.f.id, page: r.i}) + " " + pts.length);
  }));
  return lines;
}
async function agentCount(filter, scope){
  scope = scope || "page";
  const res = await scanTags(scope), f = String(filter || "").replace(/\s+/g, "").toUpperCase(), all = new Set(); res.forEach(r => Object.keys(r.T.plan).forEach(k2 => all.add(k2)));
  const pick = [...all].filter(t2 => tagWanted(t2, f)).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
  if (!pick.length) {
    if (f && !/^(DOORS?|WINDOWS?|VENT\w*|ALL|TAGS)$/.test(f) && scope === "page") { const T = await pageTexts(S.fileId, S.pageNo), hits = T.filter(x => x.s.trim().toUpperCase() === f);   // any other exact word
      if (hits.length) { let it; const c = condByName(f, "count"); if (!c.sym) c.sym = "circle";
        mutate(() => { it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape"); if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); } it.ai = true; it.qa = "";
          hits.forEach(h => { const p = [h.x + (h.w || 0) / 2, h.y - (h.h || 6) / 2]; if (!it.pts.some(o => dist(o, p) < 2)) it.pts.push(p); }); }, "Count " + f);
        refresh(); aiLog("tool", `${esc(f)}: <b>${hits.length} Nos</b> counted`); return {counts: {[f]: hits.length}}; } }
    aiLog("err", "No matching tags " + (scope === "page" ? "on this page" : "in these pages") + (all.size ? " — tags found: " + [...all].map(esc).join(", ") : "") + ".");
    return {error: "no matching tags; tags found: " + ([...all].join(", ") || "none")};
  }
  let lines; mutate(() => { lines = putCounts(res, pick, "mark"); }, "Count tags");
  refresh();
  const sched = {}; res.forEach(r => Object.assign(sched, r.T.sched));
  aiLog("tool", pick.map(t2 => { const L = lines[t2] || {n: 0, added: 0, pages: []}, sc = sched[t2];
    return `${esc(t2)} <span class="small">${esc(tagKind(t2).replace(/s$/, ""))}</span>: <b>${L.n} Nos</b>${L.added < L.n ? ` <span class="small">(${L.n - L.added} already marked)</span>` : ""}${scope !== "page" && L.pages.length > 1 ? ` <span class="small">— ${esc(L.pages.join(", "))}</span>` : ""}${sc ? ` <span class="small">· schedule ${f3(sc.w)} × ${f3(sc.h)} ft${sc.qty ? ", qty " + sc.qty + (sc.qty !== L.n ? " <b style='color:#b3261e'>≠ " + L.n + " counted</b>" : " ✓") : ""}</span>` : ""}`; }).join("<br>")
    + `<br><span class="small">One count condition per tag — markers sit on the tags. ${res.reduce((a, r) => a + r.T.inSched, 0) ? res.reduce((a, r) => a + r.T.inSched, 0) + " tags in schedule tables were left out. " : ""}A tag written once for several doors needs its Nos edited.</span>`);
  return {counts: Object.fromEntries(pick.map(t2 => [t2, (lines[t2] || {n: 0}).n]))};
}
/* 🚪 Doors / windows agent: scan, review (tick what to count), count — this page, this PDF or the whole project */
async function doorWinDialog(){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  const o = await ask("Doors / windows agent", `<p>Counts every door, window and ventilator tag written on the drawings — D1, D-1, DR-01, DOOR 1, SD2, FD1, W1, WN-2, KW1, V1, VENT 1, primed W1' … — including tags written in two pieces (a letter over a number), and reads the door / window schedule table.</p>
    <div class="grid" style="margin-top:8px"><div class="fg"><label>Where</label><select id="dwScope"><option value="page">This page</option><option value="pdf">Every page of this PDF</option><option value="all">Every PDF in the project</option></select></div>
    <div class="fg"><label>Count into</label><select id="dwGrp"><option value="mark">One condition per mark (D1, D2, W1…)</option><option value="type">One per type (Doors / Windows / Ventilators)</option></select></div>
    <div class="fg w2"><label>Find</label><label class="pk"><input type="checkbox" id="dwD" checked> Doors</label><label class="pk"><input type="checkbox" id="dwW" checked> Windows</label><label class="pk"><input type="checkbox" id="dwV" checked> Ventilators</label>
      <label class="pk"><input type="checkbox" id="dwSw"> Also door swing symbols on this page (drawings with no door tags — vector PDFs, scale set)</label></div></div>
    <p class="small" style="margin-top:8px">Tags inside a schedule table are not counted as doors on the plan; the table's sizes and quantities are used to check the count. You tick what to count next.</p>`, "Scan",
    () => { const fam = []; if ($("dwD").checked) fam.push("Doors"); if ($("dwW").checked) fam.push("Windows"); if ($("dwV").checked) fam.push("Ventilators"); if (!fam.length && !$("dwSw").checked) return "Tick what to find"; return {scope: $("dwScope").value, group: $("dwGrp").value, fam, sw: $("dwSw").checked}; });
  if (!o) return;
  const res = await scanTags(o.scope), sched = {}, tot = {}, pg = {};
  res.forEach(r => { Object.assign(sched, r.T.sched); Object.entries(r.T.plan).forEach(([k2, pts]) => { if (!o.fam.includes(tagKind(k2))) return; tot[k2] = (tot[k2] || 0) + pts.length; (pg[k2] = pg[k2] || []).push(pageName({file: r.f.id, page: r.i}) + ": " + pts.length); }); });
  const fo = k2 => ["Doors", "Windows", "Ventilators"].indexOf(tagKind(k2)), keys = Object.keys(tot).sort((a, b) => fo(a) - fo(b) || a.localeCompare(b, undefined, {numeric: true}));
  let sw = null; if (o.sw) { await indexPage(); sw = doorSwings(); }
  if (!keys.length && !(sw && sw.length)) { aiLog("err", "No door / window tags found" + (o.scope === "page" ? " on this page" : "") + (o.sw ? (sw ? " and no door swings" : " — door swings need the page scale set (K) and a vector PDF") : "") + ". Scanned drawings have no text: use 🔍 Find similar on one tag instead."); return; }
  const newSch = keys.filter(k2 => sched[k2] && !(P.proj.openings || []).some(x => x.mark.toUpperCase() === k2));
  const rowsH = keys.map((k2, n) => { const sc = sched[k2], diff = sc && sc.qty && sc.qty !== tot[k2];
    return `<tr><td><input type="checkbox" data-dw="${n}" checked></td><td><b>${esc(k2)}</b></td><td>${esc(tagKind(k2).replace(/s$/, ""))}</td><td class="n">${tot[k2]}</td><td>${sc ? f3(sc.w) + " × " + f3(sc.h) + (sc.how !== "ft-in" ? ` <span class="small">(${esc(sc.how)})</span>` : "") : "—"}</td><td class="n">${sc && sc.qty ? sc.qty + (diff ? ' <b style="color:var(--red)">≠</b>' : " ✓") : "—"}</td><td class="small">${esc(pg[k2].join(" · "))}</td></tr>`; }).join("");
  const pr = ask("Doors / windows found", `${keys.length ? `<table class="sh" style="font-size:11.5px"><thead><tr><th><input type="checkbox" id="dwAll" checked></th><th>Mark</th><th>Type</th><th class="n">Count</th><th>Schedule size (ft)</th><th class="n">Sch. qty</th><th>Pages</th></tr></thead><tbody>${rowsH}</tbody></table>` : ""}
    ${sw ? `<p style="margin-top:8px"><label class="pk"><input type="checkbox" id="dwSwOk" checked> Door swing symbols on this page: <b>${sw.length}</b> door${sw.length === 1 ? "" : "s"} (${sw.filter(x => x.leaves === 2).length} double) → condition “Doors (swings)”</label></p>` : ""}
    ${newSch.length ? `<p style="margin-top:6px"><label class="pk"><input type="checkbox" id="dwSch" checked> Add the ${newSch.length} size${newSch.length > 1 ? "s" : ""} read from the schedule (${newSch.map(esc).join(", ")}) to the opening schedule</label></p>` : ""}
    <p class="small" style="margin-top:6px">Untick anything that is not a door / window (e.g. a sheet reference). Counted markers are flagged <b>AI</b> until checked. ${res.reduce((a, r) => a + r.T.inSched, 0)} tag${res.reduce((a, r) => a + r.T.inSched, 0) === 1 ? "" : "s"} in schedule tables left out.</p>`, "Count ticked",
    () => ({pick: keys.filter((_, n) => { const x = document.querySelector(`[data-dw="${n}"]`); return x && x.checked; }), sw: !!(sw && $("dwSwOk") && $("dwSwOk").checked), sch: !!($("dwSch") && $("dwSch").checked)}));
  { const a = $("dwAll"); if (a) a.onchange = () => document.querySelectorAll("[data-dw]").forEach(x => { x.checked = a.checked; }); }
  const v = await pr; if (!v) return;
  let lines = {};
  mutate(() => {
    lines = putCounts(res, v.pick, o.group);
    if (v.sw && sw.length) { const c = condByName("Doors (swings)", "count"); if (!c.sym) { c.sym = "square"; c.cap = "seq"; }
      let it = P.proj.items.find(i => i.cond === c.id && onPage(i) && i.kind === "shape"); if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
      it.ai = true; it.qa = ""; sw.forEach(d => { if (!it.pts.some(q => dist(q, d.p) < 2)) it.pts.push(d.p); }); }
    if (v.sch) newSch.forEach(k2 => { const sc = sched[k2]; P.proj.openings.push({id: uid("O"), mark: k2, type: tagKind(k2) === "Doors" ? "door" : tagKind(k2) === "Windows" ? "window" : "other", w: sc.w, h: sc.h, src: "read from the drawing's schedule (" + sc.how + ")"}); });
  }, "Count doors / windows");
  refresh();
  const byT = {}; v.pick.forEach(k2 => { byT[tagKind(k2)] = (byT[tagKind(k2)] || 0) + (lines[k2] ? lines[k2].n : 0); });
  aiLog("tool", `<b>Doors / windows counted</b> (${o.scope === "page" ? "this page" : o.scope === "pdf" ? "this PDF" : "whole project"}): ${Object.entries(byT).map(([t2, n]) => esc(t2) + " <b>" + n + " Nos</b>").join(" · ") || "—"}${v.sw ? ` · door swings <b>${sw.length} Nos</b>` : ""}<br>`
    + v.pick.map(k2 => `${esc(k2)}: ${lines[k2] ? lines[k2].n : 0}${sched[k2] && sched[k2].qty && sched[k2].qty !== (lines[k2] || {}).n ? ` <b style="color:#b3261e">(schedule says ${sched[k2].qty})</b>` : ""}`).join(" · ")
    + (v.sch && newSch.length ? `<br><span class="small">${newSch.length} size${newSch.length > 1 ? "s" : ""} added to the opening schedule (Bill → Opening schedule).</span>` : ""));
  toast("Counted " + v.pick.reduce((a, k2) => a + (lines[k2] ? lines[k2].n : 0), 0) + " tags" + (v.sw ? " + " + sw.length + " door swings" : ""), 3000);
}
function textLines(T){   // pdf text pieces -> lines {s, x, y, w, h, parts}
  const t = T.slice().sort((a, b) => a.y - b.y || a.x - b.x), out = [];
  t.forEach(p => {
    const L = TAG_RX.test(p.s.trim().replace(/\s+/g, "")) ? null : out.find(l => !l.tag && Math.abs(l.y - p.y) < 0.45 * Math.max(l.h, p.h) && p.x - (l.x + l.w) < 1.6 * l.h && p.x - (l.x + l.w) > -0.3 * l.h);
    if (L) { L.s += (p.x - (L.x + L.w) > 0.25 * L.h && !/\s$/.test(L.s) ? " " : "") + p.s; L.w = Math.max(L.w, p.x + p.w - L.x); L.parts.push(p); }
    else out.push({s: p.s, x: p.x, y: p.y, w: p.w || p.s.length * p.h * 0.55, h: p.h, parts: [p], tag: TAG_RX.test(p.s.trim().replace(/\s+/g, ""))});   // a door / window tag stays on its own
  });
  out.forEach(l => { l.s = l.s.replace(/½/g, " 1/2").replace(/¼/g, " 1/4").replace(/¾/g, " 3/4").replace(/⅛/g, " 1/8").replace(/\s+/g, " ").trim(); });   // 13'-5½" is 13'-5 1/2"
  return out;
}
async function drawingFacts(fileId, pageNo){
  const T0 = await pageTexts(fileId, pageNo), lines = textLines(T0), rooms = [], TG = tagsOf(T0), tags = TG.plan, levels = new Set(), types = new Set(), scales = new Set(), notes = new Set();
  const sizes = lines.map(l => ({l, m: SIZE_RX.exec(l.s)})).filter(o => o.m).map(o => ({l: o.l, txt: o.m[0].replace(/\s+/g, ""), a: sizeArea(o.m[1] + "x" + o.m[2])})).filter(o => o.a > 0);
  const used = new Set();
  lines.forEach(l => {
    const u = l.s.toUpperCase();
    let m;
    if (tagParse(u)) return;   // door / window tags: tagsOf()
    if ((m = /SCALE\s*[:=-]?\s*(\d+\/\d+"\s*=\s*1'\s*-?\s*0"?|1"\s*=\s*\d+'\s*-?\s*0"?|1\s*:\s*\d+)/i.exec(l.s))) scales.add(m[1].replace(/\s+/g, ""));
    if ((m = /(?:^|\s)([+\-±]\s*\d+'\s*-\s*\d+(?:\s*\d\/\d)?"?)/.exec(l.s)) || /\b(F\.?F\.?L|LVL|LEVEL)\b/i.test(l.s)) levels.add((m ? m[1] : l.s).replace(/\s+/g, " ").trim().slice(0, 40));
    if ((m = /\b(TYPE\s*[-–]?\s*[A-Z0-9]{1,3}|\d\s*BED(ROOM)?S?\b(?!\s*ROOM\s*\d)|STUDIO|PENTHOUSE|\d{3,5}\s*S\.?\s*FT|\d{3,5}\s*SQ\.?\s*FT)/i.exec(l.s)) && !SIZE_RX.test(l.s)) types.add(l.s.slice(0, 50));
    if (/\b(STAIR|STAIRCASE|LIFT|RAMP|UP|DN|DOWN)\b/i.test(l.s) && /STAIR|LIFT|RAMP|\bUP\b|\bDN\b/i.test(l.s)) notes.add(l.s.slice(0, 60));
    if (ROOM_RX.test(l.s) && !SIZE_RX.test(l.s) && l.s.length <= 32 && !/\bSCALE\b|PLAN\b|DETAIL|SECTION|ELEVATION|NOTE|TYPE\b|TYPE-|S\.?\s*FT|SQ\.?\s*FT|\bUP\b|\bDN\b|\bDOWN\b|^\d+\s*BED/i.test(l.s)) {
      const cx = l.x + l.w / 2;
      const near = sizes.filter(z => !used.has(z) && Math.abs(z.l.x + z.l.w / 2 - cx) < Math.max(3 * l.h, l.w) && z.l.y > l.y - 0.2 * l.h && z.l.y - l.y < 3.2 * l.h).sort((a, b) => a.l.y - b.l.y)[0];
      if (near) used.add(near);
      rooms.push({name: l.s, x: l.x, y: l.y, w: l.w, h: l.h, size: near ? near.txt : "", sft: near ? near.a : 0, sizeY: near ? near.l.y : null});
    } else if (ROOM_RX.test(l.s) && SIZE_RX.test(l.s)) {   // name and size on one line
      const z = sizes.find(o => o.l === l); used.add(z);
      rooms.push({name: l.s.replace(SIZE_RX, "").trim(), x: l.x, y: l.y, w: l.w, h: l.h, size: z.txt, sft: z.a, sizeY: null});
    }
  });
  const uniq = []; rooms.forEach(r => { if (!uniq.some(q => q.name === r.name && Math.abs(q.x - r.x) < 1.5 * r.h && Math.abs(q.y - r.y) < 1.5 * r.h)) uniq.push(r); });   // the same name drawn twice (bold) is one room
  rooms.length = 0; uniq.forEach(r => rooms.push(r));
  return {rooms, tags, sched: TG.sched, inSched: TG.inSched, levels: [...levels], types: [...types], scales: [...scales], notes: [...notes], textCount: lines.length};
}
async function agentCmd(text, echoed){   // echoed: the message is already in the panel (the paid route failed and handed it on)
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  if (!echoed) aiLog("user", esc(text));
  const steps = cmdSteps(text); let out;
  if (steps.length > 1) aiLog("bot", `${steps.length} steps, one after another: ${steps.map((s, i) => (i + 1) + ". <i>" + esc(s) + "</i>").join(" · ")}`);
  for (const s of steps) out = await agentStep(s);
  return out;
}
const CMD_VERB = /(?:measure|count|find|walls?|check|audit|make|do|run|finish(?:es)?|plaster|skirting|paint|take\s*-?\s*off|details?|apartment|unit|flat|list|schedule|how|total|trace)\b/.source;
const CMD_SPLIT = new RegExp(/\s*(?:;|,?\s*\band\s+then\b|,?\s*\bthen\b|,?\s*\balso\b|,\s*(?=VERB)|\s+and\s+(?=VERB))\s*/.source.replace(/VERB/g, CMD_VERB), "i");
function cmdSteps(text){   // "measure all rooms, then count doors and walls 9"": one step each
  return String(text).split(CMD_SPLIT).map(s => s.trim()).filter(Boolean);
}
async function agentStep(text){
  const t = text.toLowerCase().trim(), scope = /\b(project|all\s+pdfs?|every\s+pdf|all\s+drawings)\b/.test(t) ? "all" : /\b(all|every|each)\s+(pages?|sheets?)\b|\bwhole\s+(pdf|set)\b|\bpdf\b/.test(t) ? "pdf" : "page";
  try {
    if (/^(help|\?)$/.test(t)) return agentHelp();
    if (/\b(cad|dwg|dxf|autocad)\b.*\b(quantit\w*|take\s*-?\s*off|layers?|blocks?|counts?)\b|\b(layer|block)s?\s+quantit/.test(t)) { aiLog("bot", "AutoCAD quantities: tick the layers (lengths, areas) and blocks (counts) to take off from the drawing's own objects."); return cadQtyDialog(); }
    if (/^\s*(plot|print)(\s+(this|the)?\s*(window|view|page|drawing|sheet))?\s*$/.test(t)) { aiLog("bot", "Plot: what to plot (a window, the view, the page), the paper and the scale — then Print or Save PDF."); return plotDialog(); }
    if (/\b(sheet\s*(?:info|names?|numbers?|nos?\.?|titles?)|title\s*-?\s*blocks?|auto\s*-?\s*names?|bookmarks?|rename\s+(?:the\s+)?(?:pages|sheets))\b/.test(t) && !/\b(export|download|print)\b/.test(t)) return agentSheets(t);
    if (/\b(export|save|download|print)\b/.test(t) && /\b(pdfs?|png|jpe?g|images?|pictures?|pages?|sheets?|drawings?|mark(?:ed)?[\s-]*ups?)\b/.test(t) && !/\b(csv|excel|xlsx|schedule|json|project)\b/.test(t)) return agentExport(t);
    if (/\breport\b/.test(t) && !/\bschedule\b/.test(t)) { aiLog("bot", "Opening the takeoff report in a new tab — print it or save it as PDF."); return reportPrint(); }
    if (/\bocr\b|\bread\s+(?:the\s+)?(?:text\s+(?:of|on|from)\s+(?:the\s+)?)?scan(?:s|ned(?:\s+pages?)?)?\b/.test(t) && !/\b(measure|count|trace|draw)\b/.test(t)) return agentOcr(t, scope);
    if (/\b(import|add|load|upload)\b.*\b(pdfs?|drawings?|images?|photos?|scans?|folders?|pages?)\b/.test(t) && !/\b(measure|count)\b/.test(t)) return agentImport();
    { const gm = /\b(?:go\s*to|goto|open|jump\s+to)\s+(?:sheet\s+|drawing\s+)?([A-Za-z]{1,4}\s?[-–._]?\s?\d{1,4}(?:[._-]\d{1,3})?[A-Za-z]?|p(?:age)?\.?\s*\d{1,4})\s*$/i.exec(text.trim()); if (gm && !/apartment|unit|flat/i.test(text)) return agentSheetGo(gm[1]); }
    if (/\b(select|tick|choose)\s+(?:the\s+|all\s+)?(?:pages?|sheets?)\b|\b(?:select|tick)\s+all\s+(?:the\s+)?(?:pages?|sheets?)\b/.test(t)) return agentPages(t);
    if (/\b(workspace|focus\s+mode|drawing\s+only|full\s*-?\s*screen|mini\s*-?\s*map|icons?\s+only|compact\s+toolbar)\b/.test(t)) return agentWorkspace(t);
    if (/^(how\s+(many|much)|total\b|sum\b|what(?:'s|\s+is)\s+the\s+(?:total|number))/.test(t)) return agentAnswer(t);
    if (/\b(full|complete|whole|entire|auto(?:matic)?)\s*take\s*-?\s*off\b|^take\s*-?\s*off\b|\beverything\b|\bdo\s+(?:it\s+)?all\b|\ball\s+(?:the\s+)?agents\b/.test(t)) return fullTakeoffDialog(scope);
    if (/\b(check|audit|qa|verify|review|mistakes?|errors?|missing)\b/.test(t)) return agentCheck(/\bpage\b/.test(t) && scope === "page" ? "page" : "all");
    if (/\b(finish(?:es|ing)?|plaster(?:ing)?|paint(?:ing)?|skirting|ceiling)\b/.test(t)) return finishesDialog();
    if (/measure|area|trace/.test(t) && scope !== "page" && !/apartment|appartment|\bapt\b|unit|flat/.test(t)) {   // rooms on every page: the full takeoff with only its rooms
      const w = t.replace(/\b(measure|auto|area|areas|trace|all|every|each|the|rooms?|of|floor|please|on|in|this|pages?|sheets?|pdfs?|project|drawings?|whole|set)\b/g, " ").replace(/\s+/g, " ").trim();
      return fullTakeoff({scope, rooms: true, filter: w}); }
    if (/measure|area|trace/.test(t)) { const w = t.replace(/\b(measure|auto|area|areas|trace|all|every|each|the|rooms?|of|floor|please|on|this|page)\b/g, " ").trim(); return agentMeasure(w); }
    if (/count|tag/.test(t)) {
      if (/swing/.test(t)) return agentSwings();
      let w = t.replace(/\b(on|in|of|the|this|whole|every|each|all|pages?|sheets?|pdfs?|project|drawings?|set)\b/g, " ").replace(/\b(count|tags?|please|marks?)\b/g, " ").trim();
      if (/\b(doors?|windows?|vent\w*)\b.*\b(and|&|\+)\b/.test(w)) w = "all";   // "count doors and windows": every tag
      return agentCount(w, scope); }
    let um = /(?:apartment|appartment|apt|unit|flat)\s*(?:no\.?|#)?\s*([0-9]{1,4}[a-z]?)/.exec(t) || /^\s*(?:measure\s+)?([0-9]{2,4}[a-z]?)\s*$/.exec(t);
    if (um) return agentUnit(um[1]);
    if (/apartment|unit|flat/.test(t)) return unitDialog();
    if (/wall|masonry|brick|block\s*work/.test(t)) return agentWallsCmd(t);
    if (/schedule|list|table|export|csv/.test(t)) return agentSchedule();
    if (/detail|read|what|info|summary|overview/.test(t)) return agentDetails();
    return agentAsk(text);
  } catch (e) { busy(""); aiLog("err", esc(e.message || String(e))); }
}
function agentAsk(text){   // not understood: ask back with the choices, never guess — and the commands whose names match its words
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(the|and|for|with|this|that|all|please|can|you|how|what)$/.test(w));
  const pal = words.length ? paletteCmds().map(c => ({c, s: words.filter(w => (c.t + " " + c.g).toLowerCase().includes(w)).length})).filter(o => o.s > 0).sort((a, b) => b.s - a.s || a.c.t.length - b.c.t.length).slice(0, 5).map(o => o.c) : [];
  const d = aiLog("bot", `I did not understand “${esc(text)}”. Did you mean one of these?<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
    <button class="btn sm pri" data-ask="full takeoff">⚡ Full takeoff</button><button class="btn sm" data-ask="measure all rooms">Measure all rooms</button><button class="btn sm" data-ask="walls">Walls…</button><button class="btn sm" data-ask="count doors">Count doors</button>
    <button class="btn sm" data-ask="count windows">Count windows</button><button class="btn sm" data-ask="finishes">🎨 Finishes</button><button class="btn sm" data-ask="check">✅ Check</button><button class="btn sm" data-ask="drawing details">Drawing details</button><button class="btn sm" data-ask="help">Help</button></div>
    ${pal.length ? `<div style="margin-top:6px"><span class="small">Commands with those words:</span><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${pal.map((c, i) => `<button class="btn sm" data-pal="${i}">${esc(c.t.length > 60 ? c.t.slice(0, 58) + "…" : c.t)}</button>`).join("")}</div></div>` : ""}
    <span class="small">Or write it differently, e.g. <i>measure bedroom</i>, <i>walls 9"</i>, <i>count D1</i>, <i>how many doors</i>, <i>export pages with takeoff to pdf</i>.</span>`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-ask]"); if (b) return agentCmd(b.dataset.ask); const p = e.target.closest("[data-pal]"); if (p) Promise.resolve().then(pal[+p.dataset.pal].run).catch(er => toast(String(er && er.message || er), 5000)); });
}
/* the pages commands: export, OCR, sheet info, import, go to a sheet, tick pages, workspace — each opens its dialog (to be
   checked) rather than acting unseen */
function agentExport(t){
  const fmt = /\bjpe?g\b/.test(t) ? "jpg" : /\b(png|images?|pictures?)\b/.test(t) ? "png" : /\b(per|each|every)\s+page\s+(?:as\s+)?(?:its\s+own|a|separate)\b|\bseparate\s+pdfs?\b|\bpdf\s+per\s+page\b/.test(t) ? "pdfs" : "pdf";
  const scope = /\b(selected|ticked|chosen)\b/.test(t) ? "sel" : /\b(with|having)\s+(?:the\s+)?(?:takeoff|measurements?|markups?)\b|\bmarked[\s-]*up\b|\bmeasured\b/.test(t) ? "tk" : /\b(all|every|whole)\b/.test(t) ? "all" : "page", dm = /(\d{2,3})\s*dpi\b/.exec(t);
  aiLog("bot", `Export: <b>${{pdf: "one PDF", pdfs: "a PDF per page", png: "PNG images", jpg: "JPEG images"}[fmt]}</b> of <b>${{sel: "the ticked pages", tk: "the pages with takeoff", all: "every page", page: "this page"}[scope]}</b>${dm ? " at " + dm[1] + " DPI" : ""} — check the choices and press Export.`);
  return exportPagesDialog({fmt, scope, dpi: dm ? Math.max(72, Math.min(600, +dm[1])) : undefined});
}
function agentOcr(t, scope){
  const keys = scope === "all" ? allPages().map(o => o.key) : scope === "pdf" ? allPages().filter(o => o.f.id === S.fileId).map(o => o.key) : /\bscann?ed\s+pages\b|\bscans\b/.test(t) ? null : [S.key];
  aiLog("bot", "OCR reads the words on scanned pages in this browser (free). Choose the pages and press <b>Read the text</b>.");
  return ocrDialog(keys);
}
function agentSheets(t){
  const keys = /\bthis\s+(?:page|sheet)\b/.test(t) ? [S.key] : /\bthis\s+pdf\b/.test(t) ? allPages().filter(o => o.f.id === S.fileId).map(o => o.key) : null;
  aiLog("bot", "Reading sheet no., title, revision and floor from the title blocks — check them, then <b>Save sheet info</b>.");
  return autoSheetDialog(keys);
}
function agentImport(){
  const d = aiLog("bot", `Choose what to add (the browser asks you to pick the files):<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"><button class="btn sm pri" data-imp="impPdfIn">PDFs — choose pages…</button><button class="btn sm" data-imp="fileIn">PDFs — every page</button><button class="btn sm" data-imp="dirIn">A folder of PDFs…</button><button class="btn sm" data-imp="imgIn">Photos / scans as pages…</button></div>`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-imp]"); if (b) $(b.dataset.imp).click(); });
}
function agentSheetGo(s){
  const pm = /^p(?:age)?\.?\s*(\d{1,4})$/i.exec(s.trim());
  if (pm) { const f = P.proj.files.find(x => x.id === S.fileId), n = +pm[1]; if (!f || n < 1 || n > f.pages) return aiLog("err", "This PDF has " + (f ? f.pages : 0) + " pages."); aiLog("bot", "Page " + n + " of " + esc(f.name.replace(/\.pdf$/i, "")) + "."); return gotoPage(f.id, n); }
  const k = sheetIndex().get(sheetNorm(s));
  if (!k) return aiLog("err", `No sheet numbered <b>${esc(s)}</b> — sheet numbers come from Sheet info (<i>read sheet info</i> fills them from the title blocks).`);
  aiLog("bot", "Opening " + esc(keyName(k)) + "."); return gotoKey(k);
}
function agentPages(t){
  S.pgSel = S.pgSel || new Set(); const r = /(\d[\d\s,–-]*)/.exec(t.replace(/\b(?:with|having)\b.*$/, "")), all = allPages();
  let L;
  if (/\b(with|having)\s+(?:the\s+)?(?:takeoff|measurements?|markups?)\b|\bmeasured\b/.test(t)) L = pagesWithTakeoff();
  else if (/\b(without|no)\s+(?:the\s+)?(?:takeoff|measurements?)\b/.test(t)) { const tk = new Set(pagesWithTakeoff()); L = all.map(o => o.key).filter(k => !tk.has(k)); }
  else if (/\bno\s+scale\b/.test(t)) L = all.map(o => o.key).filter(k => !P.proj.scales[k]);
  else if (r && /\d/.test(r[1])) { const f = P.proj.files.find(x => x.id === S.fileId); L = f ? [...parseRange(r[1], f.pages)].map(i => keyOf(f.id, i)) : []; }
  else if (/\b(all|every)\b/.test(t)) L = all.map(o => o.key);
  else return aiLog("err", "Which pages? e.g. <i>select pages 1-5</i>, <i>select pages with takeoff</i>, <i>select all pages</i>.");
  if (!L.length) return aiLog("bot", /\b(with|having|measured)\b/.test(t) ? "No page has takeoff yet — nothing ticked." : "No page matches — nothing ticked.");
  S.pgSel = new Set(L); S.lHide = false; setPanels(); $("tPages").click(); renderPages();
  const d = aiLog("bot", `<b>${L.length}</b> page${L.length === 1 ? "" : "s"} ticked in the Pages tab.${L.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"><button class="btn sm pri" data-pga="export">&#8681; Export…</button><button class="btn sm" data-pga="sheet">Sheet info…</button><button class="btn sm" data-pga="ocr">OCR…</button><button class="btn sm" data-pga="pin">&#9733; Pin</button></div>` : ""}`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-pga]"); if (b) pgAct(b.dataset.pga); });
}
function agentWorkspace(t){
  if (/full\s*-?\s*screen/.test(t)) { fullScreen(); return aiLog("bot", "Full screen — Esc to leave."); }
  if (/mini\s*-?\s*map/.test(t)) { const on = /\boff\b|\bhide\b/.test(t) ? false : /\bon\b|\bshow\b/.test(t) ? true : !wsPref().mini; wsSet({mini: on}); return aiLog("bot", "Minimap " + (on ? "on — it shows when you zoom in." : "off.")); }
  if (/icons?\s+only|compact/.test(t)) { const on = !/\b(off|names|labels|full)\b/.test(t); wsSet({tb: on ? "icons" : "full"}); return aiLog("bot", "Toolbar: " + (on ? "icons only" : "icons and names") + "."); }
  if (/focus|drawing\s+only/.test(t)) { wsLayout("focus"); return aiLog("bot", "Drawing only — the panels are hidden (⟩ ⟨ at the sides bring them back)."); }
  if (/\bpages?\b/.test(t)) { wsLayout("pages"); return aiLog("bot", "Pages + drawing."); }
  if (/\b(check|review|qa)\b/.test(t)) { wsLayout("check"); return aiLog("bot", "Pages + measurement sheet."); }
  wsLayout("takeoff"); return aiLog("bot", "Takeoff workspace: conditions, drawing and measurement sheet.");
}
function agentHelp(){
  aiLog("bot", `<b>Free drawing agents</b> — no API key, no cost, nothing leaves this browser. They read the lines and text inside the PDF (so not scanned drawings) and work on the page you have open unless you say otherwise. Try:<br>
    • <i>full takeoff</i> (or ⚡) — rooms, walls, doors / windows and finishes in one run, on this page, <i>every page</i> or the <i>whole project</i>; one Ctrl+Z takes it back<br>
    • <i>drawing details</i> — rooms, sizes, door/window tags, levels, scale, unit types, stairs<br>
    • <i>measure all rooms</i> or <i>measure bedroom</i> — auto area at each room name, checked against its written size; add <i>on every page</i> for the whole PDF; a typing slip (<i>bedrom</i>) still finds it<br>
    • <i>count doors</i>, <i>count windows</i>, <i>count D1</i>, <i>count all tags</i> — add <i>on all pages</i> or <i>in the project</i>; 🚪 <b>Doors / windows</b> scans, shows what it found (with the schedule's sizes and quantities) and counts what you tick<br>
    • <i>count door swings</i> — doors from their swing symbols, for drawings with no door tags<br>
    • <i>apartment 107</i> (or just <i>107</i>) — every room of one apartment, with its total<br>
    • <i>walls 9"</i>, <i>walls 4.5"</i>, or <i>walls</i> — wall runs found from their two parallel face lines (vector PDFs)<br>
    • <i>finishes</i> (or 🎨) — each room's wall plaster / paint (Nos × L × H, every door and window its own deduction row), skirting less doors, ceiling<br>
    • <i>check</i> (or ✅) — audits the takeoff: rooms not measured, areas measured twice, double counts, tags not counted, schedule quantities and sizes<br>
    • <i>how many D1</i>, <i>how many doors</i>, <i>total floor area</i>, <i>total bedroom area</i> — answered from what is measured<br>
    • <i>room schedule</i> — the room list as a table you can copy<br>
    <b>Pages</b> (as Forma Takeoff / Bluebeam):<br>
    • <i>export pages with takeoff to pdf</i>, <i>export all pages as png 300 dpi</i>, <i>export this page as jpg</i> — the export dialog with those pages, the legend and the resolution set<br>
    • <i>read sheet info</i> (or <i>title blocks</i>) — sheet no., title, revision and floor read from each title block, checked by you before they are saved<br>
    • <i>ocr this page</i>, <i>read scanned pages</i> — the text of scans read in this browser, so Find, these agents and the scale note work on them<br>
    • <i>select pages 1-5</i>, <i>select pages with takeoff</i>, <i>go to A-101</i>, <i>go to page 4</i> — page management; <i>report</i> — the printable takeoff report<br>
    • <i>import pdfs</i>, <i>add photos as pages</i> — choose pages and a version set on the way in<br>
    • <i>focus mode</i>, <i>full screen</i>, <i>minimap</i>, <i>icons only</i> — the workspace<br>
    Chain them: <i>measure all rooms, then count doors and walls 9"</i>.`);
}
async function agentDetails(){
  const F = await drawingFacts(S.fileId, S.pageNo), k = curScale();
  if (!F.textCount) { const d0 = aiLog("err", 'This page has no text layer (scanned or exported as outlines) — the free agent cannot read it yet. <button class="btn sm pri" data-ocr1="1">Read it with OCR</button> (free, in this browser), or use <b>Copy for Claude</b> / an API key.'); d0.addEventListener("click", e => { if (e.target.closest("[data-ocr1]")) ocrDialog([S.key]); }); return; }
  const groups = {}; Object.entries(F.tags).forEach(([t2, pts]) => { (groups[tagKind(t2)] = groups[tagKind(t2)] || []).push([t2, pts.length]); });
  const tot = F.rooms.reduce((a, r) => a + r.sft, 0);
  const sec = (title, body) => body ? `<div style="margin-top:6px"><b>${title}</b><br>${body}</div>` : "";
  const tasks = [];
  if (F.rooms.length || Object.keys(groups).length) tasks.push(["full", "Full takeoff of this page — rooms, walls, doors / windows (and finishes, given the room height)"]);
  if (F.rooms.length) tasks.push(["measure", `Measure all ${F.rooms.length} rooms with auto area and check them against the written sizes`]);
  Object.keys(groups).forEach(g => tasks.push(["count:" + g, `Count ${g.toLowerCase()} (${groups[g].reduce((a, x) => a + x[1], 0)} tags: ${groups[g].map(x => x[0]).join(", ")})`]));
  if (F.rooms.length) tasks.push(["schedule", "Make the room schedule (copy to Excel)"]);
  const d = aiLog("bot", `<b>Drawing details — ${esc(pageName({file: S.fileId, page: S.pageNo}))}</b>
    ${sec("Scale", (F.scales.length ? "Written: " + F.scales.map(esc).join(", ") : "No scale text found") + " · set: " + (k ? "yes" : "<span style='color:#b3261e'>not set — press K</span>"))}
    ${sec("Unit / type", F.types.map(esc).join("<br>"))}
    ${sec("Rooms (" + F.rooms.length + ")", F.rooms.map(r => `${esc(r.name)}${r.size ? ` — ${esc(r.size)} = <b>${fq(r.sft)} Sft</b>` : ""}`).join("<br>") + (tot ? `<br><span class="small">Written sizes total ${fq(tot)} Sft (inside dimensions, not the covered area)</span>` : ""))}
    ${Object.entries(groups).map(([g, l]) => sec(g + " (" + l.reduce((a, x) => a + x[1], 0) + " Nos)", l.sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true})).map(x => `${esc(x[0])} × ${x[1]}${F.sched[x[0]] ? ` <span class="small">(${f3(F.sched[x[0]].w)} × ${f3(F.sched[x[0]].h)} ft${F.sched[x[0]].qty ? ", sch. qty " + F.sched[x[0]].qty : ""})</span>` : ""}`).join(" · "))).join("")}
    ${Object.keys(F.sched).length ? sec("Door / window schedule (" + Object.keys(F.sched).length + " marks)", Object.entries(F.sched).sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true})).map(([k2, v2]) => `${esc(k2)} ${f3(v2.w)} × ${f3(v2.h)} ft${v2.qty ? " · qty " + v2.qty : ""}`).join("<br>")) : ""}
    ${sec("Levels", F.levels.map(esc).join(" · "))}
    ${sec("Stairs / lifts", F.notes.map(esc).join("<br>"))}
    ${tasks.length ? `<div style="margin-top:8px"><b>Tasks</b> — give one to the agent:</div>` + tasks.map(([id, l2]) => `<div style="display:flex;gap:6px;align-items:center;margin-top:4px"><span style="flex:1">☐ ${esc(l2)}</span><button class="btn sm pri" data-task="${esc(id)}">Do it</button></div>`).join("") : ""}`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-task]"); if (!b) return; const id = b.dataset.task; b.disabled = true; b.textContent = "Done ✓";
    b.parentElement.firstElementChild.textContent = b.parentElement.firstElementChild.textContent.replace("☐", "☑");
    if (id === "full") fullTakeoffDialog("page"); else if (id === "measure") agentMeasure(""); else if (id === "schedule") agentSchedule(); else if (id.startsWith("count:")) agentCount(id.slice(6).toLowerCase()); });
}
const sameRoom = (a, b) => !!a && !!b && a.name === b.name && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;   // one label, whichever list it came from
async function agentMeasure(filter, only, opt){   // only: these rooms (an apartment), whatever the view; opt.quiet: no lines in the panel (the full takeoff reports)
  const say = opt && opt.quiet ? () => document.createElement("div") : aiLog;
  const k = curScale(); if (!k) { say("err", "Set the page scale first (K) — then I can measure."); return {error: "page scale not set"}; }
  if (scaleDoubt()) { say("err", "The page scale is doubtful: the drawing measures " + esc(scaleDoubt().label) + ", not the note. Settle it first (scale chip)."); return {error: "page scale doubtful — the drawing measures " + scaleDoubt().label + "; ask the user to settle the scale first"}; }
  const F = await drawingFacts(S.fileId, S.pageNo);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/s$/, ""));
  let rooms = F.rooms.filter(r => !words.length || words.some(w => r.name.toLowerCase().replace(/\s+/g, "").includes(w.replace(/\s+/g, ""))));
  if (!rooms.length && words.length) rooms = F.rooms.filter(r => words.some(w => nameLike(r.name, w)));   // "bedrom", "kitchn": a slip of the keyboard is still the room
  const vr = viewRect(), zoomed = (vr[2] - vr[0]) * (vr[3] - vr[1]) < 0.6 * S.base.width * S.base.height, all = rooms.length;
  if (only) rooms = only; else if (zoomed) rooms = rooms.filter(r => { const x = r.x + r.w / 2, y = r.y - r.h / 2; return x >= vr[0] && x <= vr[2] && y >= vr[1] && y <= vr[3]; });
  if (!only && zoomed && all && !rooms.length) { say("err", "No room names in the part on screen — pan to the rooms, or zoom out (Fit) for the whole page."); return {error: "no rooms in the view"}; }
  if (!only && zoomed && rooms.length < all) say("bot", `Measuring the <b>${rooms.length}</b> rooms on screen (of ${all} on the page) — press <b>Fit</b> first for all of them.`);
  if (!rooms.length) { say("err", F.rooms.length ? "No room name on this page matches “" + esc(filter) + "”." : "I found no room names in this page's text."); return {error: F.rooms.length ? "no room matches " + filter + "; rooms on the page: " + F.rooms.map(r => r.name).join(", ") : "no room names in the page text (scanned?) — use trace_room / draw_area"}; }
  const done = new Set(P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo).map(i => (i.label || "").toLowerCase()));
  const c = aiAreaCond(), got = [], res = []; let ok = 0, chk = 0, same2 = 0;
  const mine = P.proj.items.filter(i => onPage(i) && i.cond === c.id && i.kind === "shape"), had = rooms.filter(r => mine.some(i => pointInPoly([r.x + r.w / 2, r.y - r.h / 2], itemPoly(i))));
  if (had.length) {   // a room already measured in this condition is left as it is — running the agent again never measures it twice
    rooms = rooms.filter(r => !had.includes(r));
    had.forEach(r => { const it = mine.find(i => pointInPoly([r.x + r.w / 2, r.y - r.h / 2], itemPoly(i))); res.push({name: r.name, already: true, area_sft: +(polyArea(itemPoly(it)) / k / k).toFixed(2)}); });
    say("bot", `${had.length === 1 ? "1 room is" : had.length + " rooms are"} already measured in <b>${esc(c.name)}</b> and left as ${had.length === 1 ? "it is" : "they are"} (delete one to measure it again): ${had.map(r => esc(r.name)).join(", ")}.`);
    if (!rooms.length) return {condition: c.name, rooms: res};
  }
  for (const [n, r] of rooms.entries()) {
    busy(`Measuring ${n + 1} of ${rooms.length}: ${r.name}…`); await new Promise(q => setTimeout(q, 10));
    const cx = r.x + r.w / 2, below = r.sizeY != null ? r.sizeY : r.y, lc = [cx, r.y - r.h / 2];   // lc: the name itself — the room it is written in is the one wanted
    const seeds = [lc, [cx, r.y - r.h * 1.7], [cx, below + r.h * 0.9], [r.x - r.h, r.y - r.h / 2], [r.x + r.w + r.h, r.y - r.h / 2], [cx, below + r.h * 2.5], [cx, r.y - r.h * 3.5]];
    if (got.some(o => o.with.some(q => sameRoom(q, r)))) { const o = got.find(g2 => g2.with.some(q => sameRoom(q, r))); res.push({name: r.name, shared_with: o.name}); say("tool", `${esc(r.name)}: <span class="small">in the same open space as <b>${esc(o.name)}</b> — measured with it</span>`); continue; }
    let best = null; const dd = sizeDims(r.size), tried = [];
    const over = Object.assign({own: lc}, dd ? {gap: Math.max(2.5, Math.min(autoOpt().gap, 0.6 * Math.min(dd[0], dd[1])))} : {});   // a 5 ft bath: close gaps up to 3 ft, not 4
    for (const sd of seeds) {
      const res = await autoRoom(sd, over); if (!res.pts) { if (/leaks/.test(res.err || "") && tried.length === 0 && seeds.indexOf(sd) >= 1) break; continue; }
      const a = polyArea(res.pts) / k / k; if (!(a > 4)) continue;
      const own = pointInPoly(lc, res.pts);   // an outline that misses the room's own name is a neighbouring compartment (the shower of a bath, a wardrobe)
      const err = (r.sft ? Math.abs(a - r.sft) / r.sft : 0) + (own ? 0 : 10);
      if (!best || err < best.err) best = {pts: res.pts, a, err};
      if (err <= 0.05 || tried.some(t => Math.abs(t - a) / a < 0.005)) break;   // within 5 %, or the same outline twice: the room as drawn
      tried.push(a);
    }
    if (best && best.err >= 10) best.err -= 10;
    if (!best) { res.push({name: r.name, error: "could not close the room"}); say("err", `${esc(r.name)}: auto area could not close the room — use the Fence tool on the open side, or draw it`); continue; }
    const cen = q => [q.reduce((a, v) => a + v[0], 0) / q.length, q.reduce((a, v) => a + v[1], 0) / q.length];
    const same = got.find(o => Math.abs(o.a - best.a) / best.a < 0.005 && dist(cen(o.pts), cen(best.pts)) < k);
    if (same) { same2++; res.push({name: r.name, error: "leaked into " + same.name}); say("err", `${esc(r.name)}: came out as the same outline as <b>${esc(same.name)}</b> (${fq(best.a)} Sft) — the line between them is dashed or open. Draw a <b>Fence</b> on it and run again, or turn on dashed boundaries in ⚙.`); continue; }
    const inside = F.rooms.filter(q => q !== r && pointInPoly([q.x + q.w / 2, q.y - q.h / 2], best.pts));
    const hit = inside.find(q => q.name !== r.name && got.some(o => sameRoom(o.room, q)));   // runs into a room already measured on its own: a leak, not open plan
    if (hit) { same2++; res.push({name: r.name, error: "leaked into " + hit.name}); say("err", `${esc(r.name)}: runs on into <b>${esc(hit.name)}</b> (already measured) — an opening is not closed. Draw a <b>Fence</b> across it and run again, or draw this room.`); continue; }
    const dupes = inside.filter(q => q.name === r.name);   // the same name twice in one room (text on two layers): one room
    const others = inside.filter(q => q.name !== r.name && !got.some(o => o.with.some(w => sameRoom(w, q))));   // other names in the same space: open plan
    const nm = [r.name].concat(others.map(q => q.name)).join(" + ").slice(0, 60), wrt = r.sft + others.reduce((a, q) => a + (q.sft || 0), 0);
    if (others.length && r.sft) best.err = Math.abs(best.a - wrt) / wrt;
    got.push({name: nm, a: best.a, pts: best.pts, with: inside.filter(q => !got.some(o => sameRoom(o.room, q))), room: r});
    const dup = done.has(nm.toLowerCase());
    mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: best.pts, nos: 1, ai: true, label: nm}); });
    const bad = r.sft && best.err > 0.05; bad ? chk++ : ok++;   // best.err is against the written sizes of every room in the space
    res.push({name: nm, area_sft: +best.a.toFixed(2), written_sft: r.sft ? +wrt.toFixed(2) : null, check: !!bad, open_plan_with: others.map(q => q.name)});
    say("tool", `${esc(nm)}: <b>${fq(best.a)} Sft</b> <span class="small">${others.length ? "one open space (no wall between) · " : ""}${r.sft ? "written " + (others.length ? fq(wrt) + " Sft together" : esc(r.size) + " = " + fq(r.sft) + " Sft") + (bad ? " — <b style='color:#b3261e'>check (" + (best.a > wrt ? "+" : "") + fq(best.a - wrt) + ")</b> — written sizes are often the main rectangle only; look at the outline" : " ✓") : "no size written"}${dup ? " · already had an area with this name" : ""}</span>`);
  }
  busy(""); refresh();
  say("bot", `Measured ${ok + chk} of ${rooms.length} into <b>${esc(c.name)}</b>${chk ? ` — <b>${chk} to check</b> (more than 5% off the written size: fix with Fence, or the room is not a rectangle)` : ""}${same2 ? ` — <b>${same2}</b> leaked into a neighbour, not added` : ""}. Undo (Ctrl+Z) removes them one by one.`);
  return {condition: c.name, rooms: res};
}
/* apartments: the unit numbers written on the plan — a 2-4 digit number with TYPE-… / n BED / … SFT under it. Each room
   belongs to the nearest unit number. */
async function unitsOf(f, pg){
  const T = await pageTexts(f, pg), L = textLines(T);
  const nums = T.filter(t => /^\s*\d{2,4}[A-Z]?\s*$/i.test(t.s)).map(t => ({s: t.s, x: t.x, y: t.y, w: t.w || t.s.length * t.h * 0.55, h: t.h}));   // the raw pieces: a number beside another word is still a unit number
  return nums.map(n => {
    const near = L.filter(l => Math.abs(l.y - n.y) > 0.5 * n.h && Math.abs(l.x + l.w / 2 - (n.x + n.w / 2)) < 4 * n.h && l.y > n.y && l.y - n.y < 7 * n.h).sort((a, b) => a.y - b.y);
    const type = near.filter(l => /TYPE|BED|STUDIO|PENT|SHOP|OFFICE/i.test(l.s)).map(l => l.s).join(" · "), sm = near.map(l => /(\d{3,6})\s*S\.?\s*F\.?T/i.exec(l.s)).find(Boolean);
    return type || sm ? {no: n.s.trim().toUpperCase(), x: n.x + n.w / 2, y: n.y - n.h / 2, type, sft: sm ? +sm[1] : 0} : null; }).filter(Boolean);
}
async function agentUnit(no){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  const U = await unitsOf(S.fileId, S.pageNo); if (!U.length) { aiLog("err", "No apartment numbers found on this page (a number with TYPE- / BED / SFT written under it). Zoom to the apartment and use 🏠 Rooms instead."); return {error: "no unit numbers on this page"}; }
  const u = U.find(x => x.no === String(no).trim().toUpperCase()); if (!u) { aiLog("err", `No apartment ${esc(no)} on this page. Apartments here: ${U.map(x => esc(x.no)).join(", ")}.`); return {error: "unit not found; units on the page: " + U.map(x => x.no).join(", ")}; }
  const F = await drawingFacts(S.fileId, S.pageNo), cen = r => [r.x + r.w / 2, r.y - r.h / 2];
  const COMMON = /STAIR|LIFT|LOBBY|CORRIDOR|PASSAGE|ELECTRIC|DUCT|SHAFT|CARGO|SERVICE|GENERATOR|PUMP|MUMTY|RAMP|PARKING|GUARD|SECURITY/i;   // common areas belong to no apartment
  const mine = F.rooms.filter(r => !COMMON.test(r.name)).filter(r => { const c = cen(r); let best = null; U.forEach(x => { const d = dist(c, [x.x, x.y]); if (!best || d < best.d) best = {x, d}; }); return best.x === u; });
  if (!mine.length) { aiLog("err", "No rooms found for apartment " + esc(u.no) + "."); return {error: "no rooms"}; }
  { const ds = mine.map(r => dist(cen(r), [u.x, u.y])).sort((a, b) => a - b), md = ds[ds.length >> 1], far = mine.filter(r => dist(cen(r), [u.x, u.y]) > 2.2 * md);   // a room far outside the cluster belongs to an apartment whose number is further off
    if (far.length && mine.length - far.length >= 2) { far.forEach(r => mine.splice(mine.indexOf(r), 1)); aiLog("bot", `Left out ${far.map(r => esc(r.name)).join(", ")} — far from the rest of apartment ${esc(u.no)}; measure ${far.length > 1 ? "them" : "it"} on ${far.length > 1 ? "their" : "its"} own if ${far.length > 1 ? "they belong" : "it belongs"} here.`); } }
  const xs = mine.map(r => cen(r)[0]).concat(u.x), ys = mine.map(r => cen(r)[1]).concat(u.y), st = stage(), m = 20 * (curScale() || 10);
  const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m, sc = Math.min(st.clientWidth / (x1 - x0), st.clientHeight / (y1 - y0));
  S.view = {s: sc, tx: (st.clientWidth - (x0 + x1) * sc) / 2, ty: (st.clientHeight - (y0 + y1) * sc) / 2}; applyView(); renderHi();
  aiLog("bot", `<b>Apartment ${esc(u.no)}</b>${u.type ? " — " + esc(u.type) : ""}: ${mine.length} rooms (${mine.map(r => esc(r.name)).join(", ")}).`);
  const before = new Set(P.proj.items.map(i => i.id));
  const r = await agentMeasure("", mine); if (!r || r.error) return r;
  P.proj.items.forEach(i => { if (!before.has(i.id)) i.unit = u.no; }); save();
  { // a room that touches no other room of the apartment (more than a wall away from all of them) belongs to another apartment
    const k = curScale(), its = P.proj.items.filter(i => i.unit === u.no && !before.has(i.id));
    const gap = (A, B) => { let m = Infinity; A.forEach(p => { for (let i = 0; i < B.length; i++) m = Math.min(m, distSeg(p, B[i], B[(i + 1) % B.length])); }); return m; };
    const lone = its.length > 2 ? its.filter(a => its.every(b => b === a || Math.min(gap(a.pts, b.pts), gap(b.pts, a.pts)) > 1.5 * k)) : [];
    if (lone.length) { const ids = new Set(lone.map(i => i.id)); mutate(() => { P.proj.items = P.proj.items.filter(i => !ids.has(i.id)); });
      r.rooms = r.rooms.filter(x => !lone.some(i => i.label === x.name && Math.abs(polyArea(i.pts) / k / k - (x.area_sft || 0)) < 0.05));
      aiLog("bot", `Removed ${lone.map(i => "<b>" + esc(i.label) + "</b>").join(", ")} — not next to any other room of apartment ${esc(u.no)}, so it belongs to a neighbour. Measure it on its own if it is part of ${esc(u.no)}.`); } }
  const gaps = await fillGaps(u, U);
  r.rooms = r.rooms.concat(gaps);
  const tot = r.rooms.reduce((a, x) => a + (x.area_sft || 0), 0);
  aiLog("bot", `Apartment ${esc(u.no)}: rooms measured <b>${fq(tot)} Sft</b>${u.sft ? ` · written on the drawing <b>${fq(u.sft)} Sft</b> (that figure usually includes the walls and is not a floor-finish area)` : ""}.`);
  return Object.assign(r, {unit: u.no, type: u.type, unit_written_sft: u.sft || null, rooms_total_sft: +tot.toFixed(2)});
}
/* the floor of an apartment that no named room covered — passages, wardrobes, shower stalls, the strip at a door: open
   points on a 1.5 ft grid over the apartment that are nearer this apartment's number than any other, not inside a
   measured area and not on a drawing line, are traced (measured rooms are walls to them) and added on their own */
async function fillGaps(u, U){
  const k = curScale(), g = S.geo[S.key]; if (!k || !g) return [];
  const mine = () => P.proj.items.filter(it => it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && (cond(it.cond) || {}).type === "area" && it.unit === u.no);
  const own = mine(); if (!own.length) return [];
  const xs = own.flatMap(it => it.pts.map(q => q[0])), ys = own.flatMap(it => it.pts.map(q => q[1])), pad = 3 * k;
  const X0 = Math.min(...xs) - pad, X1 = Math.max(...xs) + pad, Y0 = Math.min(...ys) - pad, Y1 = Math.max(...ys) + pad;
  const nearest = q => { let b = null; U.forEach(x => { const d = dist(q, [x.x, x.y]); if (!b || d < b.d) b = {x, d}; }); return b && b.x; };
  const all = () => P.proj.items.filter(it => it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && (cond(it.cond) || {}).type === "area");
  const bf = segRoleFilter(g, BOUND), onLine = q => segsIn(g, q[0] - 0.4 * k, q[1] - 0.4 * k, q[0] + 0.4 * k, q[1] + 0.4 * k).some(i => (!bf || bf(i)) && distSeg(q, [g.segs[i][0], g.segs[i][1]], [g.segs[i][2], g.segs[i][3]]) < 0.4 * k);
  const c = aiAreaCond(), out = []; let tries = 0;
  for (let y = Y0 + 0.75 * k; y < Y1; y += 1.5 * k) for (let x = X0 + 0.75 * k; x < X1; x += 1.5 * k) {
    const q = [x, y]; if (nearest(q) !== u || all().some(it => pointInPoly(q, it.pts)) || onLine(q)) continue;
    if (++tries > 60) break;
    busy("Apartment " + u.no + ": looking for floor not yet measured…"); await new Promise(r => setTimeout(r, 0));
    const res = await autoRoom(q, {gap: 3}); if (!res.pts) continue;
    const a = polyArea(res.pts) / k / k, cen = labelPt(res.pts);
    if (a < 3 || a > 150 || nearest(cen) !== u || res.pts.some(p => p[0] < X0 - 6 * k || p[0] > X1 + 6 * k || p[1] < Y0 - 6 * k || p[1] > Y1 + 6 * k)) continue;   // tiny, or a neighbour's / the outside
    const t0 = roomNameAt(res.pts) || "";
    if (/ACCESS|DUCT|SHAFT|^\s*A\.?P\.?\s*\d|SHAFT|VOID|OPEN\s*TO/i.test(t0)) continue;   // services, not floor
    const nm = /^\s*SH\.?\s*$/i.test(t0) ? "SHOWER" : /^\s*W\.?C\.?\s*$/i.test(t0) ? "WC" : /BALCONY|WIDE/i.test(t0) ? "BALCONY" : /WARD/i.test(t0) ? "WARDROBE" : t0 || "PASSAGE / UNNAMED";
    mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: res.pts, nos: 1, ai: true, unit: u.no, label: (nm + " (" + u.no + ")").slice(0, 60)}); });
    out.push({name: nm, area_sft: +a.toFixed(2), gap: true});
    aiLog("tool", `${esc(nm)}: <b>${f2(a)} Sft</b> <span class="small">floor with no room name — check it belongs to apartment ${esc(u.no)}</span>`);
  }
  busy("");
  if (!out.length) aiLog("bot", `No unmeasured floor left in apartment ${esc(u.no)}.`);
  return out;
}
async function unitDialog(){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  const U = (await unitsOf(S.fileId, S.pageNo)).sort((a, b) => a.no.localeCompare(b.no, undefined, {numeric: true}));
  const v = await ask("Apartment agent", `<p>Measures every room of one apartment (rooms belong to the nearest apartment number), checks each against its written size and totals them.</p>
    <div class="fg w2" style="margin-top:8px"><label>Apartment</label>${U.length ? `<select id="unSel">${U.map(x => `<option value="${esc(x.no)}">${esc(x.no)}${x.type ? " — " + esc(x.type) : ""}${x.sft ? " · " + x.sft + " Sft" : ""}</option>`).join("")}</select>` : '<input type="text" id="unSel" placeholder="e.g. 101">'}</div>
    <p class="small" style="margin-top:8px">${U.length ? U.length + " apartments found on this page." : "No apartment numbers found automatically — type one, or zoom to the apartment and use 🏠 Rooms."} A room name works too: type <i>measure bedroom</i> in the chat.</p>`, "Measure", () => $("unSel").value.trim() ? {no: $("unSel").value.trim()} : "Choose an apartment");
  if (v) agentUnit(v.no);
}
async function agentSwings(){
  if (!curScale()) { aiLog("err", "Set the page scale first (K) — door swings are found by their size."); return {error: "scale not set"}; }
  await indexPage(); const sw = doorSwings();
  if (!sw || !sw.length) { aiLog("err", "No door swing symbols found on this page (vector PDFs only; a swing is an arc of 1.2–6 ft radius)."); return {error: "no door swings"}; }
  mutate(() => { const c = condByName("Doors (swings)", "count"); if (!c.sym) { c.sym = "square"; c.cap = "seq"; }
    let it = P.proj.items.find(i => i.cond === c.id && onPage(i) && i.kind === "shape"); if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
    it.ai = true; it.qa = ""; sw.forEach(d => { if (!it.pts.some(q => dist(q, d.p) < 2)) it.pts.push(d.p); }); }, "Count door swings");
  refresh();
  const dbl = sw.filter(x => x.leaves === 2).length;
  aiLog("tool", `Door swings: <b>${sw.length} doors</b> (${sw.length - dbl} single, ${dbl} double — ${sw.length + dbl} leaves) · leaf widths ${[...new Set(sw.map(x => f3(x.w)))].slice(0, 8).join(", ")} ft <span class="small">— check them: an arc of that size that is not a door is counted too</span>`);
  return {doors: sw.length, double: dbl};
}
async function agentSchedule(){
  const F = await drawingFacts(S.fileId, S.pageNo), k = curScale();
  if (!F.rooms.length) return aiLog("err", "I found no room names in this page's text.");
  const meas = name => { if (!k) return null; const its = P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && (i.label || "").toLowerCase() === name.toLowerCase() && cond(i.cond) && cond(i.cond).type === "area"); if (!its.length) return null; return its.reduce((a, i) => a + polyArea(itemPoly(i)) / k / k, 0); };
  const rows = F.rooms.map((r, i) => { const m = meas(r.name); return [i + 1, r.name, r.size, r.sft ? r.sft.toFixed(3) : "", m == null ? "" : m.toFixed(3), m != null && r.sft ? (m - r.sft).toFixed(3) : ""]; });
  const tsv = [["No", "Room", "Written size", "Written Sft", "Measured Sft", "Diff Sft"]].concat(rows).map(r => r.join("\t")).join("\n");
  const d = aiLog("bot", `<b>Room schedule</b> <button class="btn sm" data-cp="1">Copy for Excel</button><table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px"><tr><th align="left">Room</th><th align="left">Size</th><th align="right">Written</th><th align="right">Measured</th></tr>${rows.map(r => `<tr><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td align="right">${r[3]}</td><td align="right">${r[4]}</td></tr>`).join("")}</table><span class="small">Sft, 3 dp.</span>`);
  d.querySelector("[data-cp]").onclick = async () => { try { await navigator.clipboard.writeText(tsv); toast("Copied — paste into Excel"); } catch (e) { toast("Could not copy"); } };
}

/* ------------------------------------------------------------------ walls agent: wall runs from the drawing's own vector lines.
   A wall is drawn as two parallel face lines its thickness apart; every such pair of lines gives a run along its centre
   line (the method of the floor-plan wall detectors: parallel pairs, spacing histogram). Gaps shorter than "bridge"
   (door / window openings, and the gap a cross wall leaves in one face) are bridged so openings are deducted as their
   own rows (Opening tool), and runs meeting at an L corner are joined at their centre lines — so the cft is exact:
   corners by the centre line, T-junctions face to face, never counted twice. */
function viewRect(){ const st = stage(), v = S.view; return [Math.max(0, -v.tx / v.s), Math.max(0, -v.ty / v.s), Math.min(S.base.width, (st.clientWidth - v.tx) / v.s), Math.min(S.base.height, (st.clientHeight - v.ty) / v.s)]; }
function faceLines(rect, k, only, join, minFt){   // straight drawing lines in rect (or the given ids), grouped by direction -> [{u, n, L: [{o, t0, t1}]}]; join: bridge collinear gaps up to this (pt); minFt: shortest line taken (0.4 ft)
  const g = S.geo[S.key]; if (!g || !g.segs.length) return null;
  const ids = only || (rect ? segsIn(g, rect[0], rect[1], rect[2], rect[3]) : g.segs.map((_, i) => i)), groups = new Map();
  ids.forEach(i => { const s = g.segs[i]; if (s[4] & 11) return;   // curves, dashed lines and clip paths are not wall faces
    const dx = s[2] - s[0], dy = s[3] - s[1], L = Math.hypot(dx, dy); if (L < (minFt || 0.4) * k) return;
    let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI; if (a >= Math.PI - 0.0044) a -= Math.PI;
    const key = Math.round(a / 0.0087);   // 0.5° bins
    let G = groups.get(key) || groups.get(key - 1) || groups.get(key + 1);
    if (!G) { G = {a: Math.abs(a - Math.PI / 2) < 0.0044 ? Math.PI / 2 : a, L: []}; G.u = [Math.cos(G.a), Math.sin(G.a)]; G.n = [-G.u[1], G.u[0]]; groups.set(key, G); }   // the group's own direction (not its 0.5° bin's): a vertical wall stays vertical, so pieces of one face line up
    const t0 = G.u[0] * s[0] + G.u[1] * s[1], t1 = G.u[0] * s[2] + G.u[1] * s[3];
    G.L.push({o: (G.n[0] * (s[0] + s[2]) + G.n[1] * (s[1] + s[3])) / 2, t0: Math.min(t0, t1), t1: Math.max(t0, t1)}); });
  const out = [...groups.values()];
  if (join) out.forEach(G => {   // one face of a wall broken where a cross wall meets it: one line again
    const L = G.L.sort((a, b) => a.o - b.o || a.t0 - b.t0), M = [];
    L.forEach(l => { const q = M.find(m => Math.abs(m.o - l.o) <= 0.02 * k && l.t0 - m.t1 <= join && m.t0 - l.t1 <= join);
      if (q) { q.t0 = Math.min(q.t0, l.t0); q.t1 = Math.max(q.t1, l.t1); } else M.push(Object.assign({}, l)); });
    G.L = M; });
  return out;
}
function facePairs(G, dMin, dMax, minOv, fn){   // every two lines of one direction dMin…dMax apart, overlapping minOv or more
  const L = G.L.slice().sort((a, b) => a.o - b.o);
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].o - L[i].o <= dMax; j++) {
    const d = L[j].o - L[i].o; if (d < dMin) continue;
    const t0 = Math.max(L[i].t0, L[j].t0), t1 = Math.min(L[i].t1, L[j].t1); if (t1 - t0 >= minOv) fn(d, (L[i].o + L[j].o) / 2, t0, t1);
  }
}
function wallLineIds(rect, k){   // the drawing's lines in rect less door swings and leaves (a leaf open against a wall is not a thin wall)
  const g = S.geo[S.key]; if (!g || !g.segs.length) return null;
  const wf = segRoleFilter(g, new Set(["wall"]));   // the PDF's wall layers, when it has them: no furniture, fixtures or hatch
  const ids = (rect ? segsIn(g, rect[0], rect[1], rect[2], rect[3]) : g.segs.map((_, i) => i)).filter(i => !wf || wf(i)), door = doorSymbols(g, ids, k);
  return ids.filter(i => !door.has(i));
}
function wallThicknesses(rect){   // the wall thicknesses drawn here, most wall length first: [{t ft, len ft}]
  const k = curScale(), ids = k && wallLineIds(rect, k), G = ids && faceLines(null, k, ids); if (!k || !G) return [];
  const H = new Map();
  G.forEach(g => facePairs(g, 0.3 * k, 2 * k, 1.5 * k, (d, o, t0, t1) => { const b = Math.round(d / k * 48); H.set(b, (H.get(b) || 0) + (t1 - t0) / k); }));
  const tot = [...H.values()].reduce((a, v) => a + v, 0), out = [];
  [...H.entries()].sort((a, b) => b[1] - a[1]).forEach(([b, len]) => { if (len < 0.04 * tot || len < 6 || out.some(o => Math.abs(o.b - b) <= 1)) return; out.push({b, t: b / 48, len}); });
  return out.slice(0, 5).map(o => ({t: o.t, len: o.len}));
}
function findWalls(T, rect, bridgeFt){   // -> [{a: [x, y], b: [x, y]}] centre-line runs, page units
  const k = curScale(), ids = k && wallLineIds(rect, k), G = ids && faceLines(null, k, ids, 0, 0.2); if (!k || !G) return null;   // (short lines too: a nib at a door jamb)
  const tol = Math.max(0.04, 0.08 * T) * k, bridge = Math.max(1.6 * T, bridgeFt || 0) * k, runs = [], gg = S.geo[S.key];
  /* a gap is bridged (a door or window opening) only if no other line crosses the wall's band inside it: a cross wall,
     a corridor's partition — then the two pieces are separate walls with a room or passage between them */
  const crossed = (g, o, ta, tb) => { const u = g.u, n = g.n, hw = 0.4 * T * k, P = (t, oo) => [u[0] * t + n[0] * oo, u[1] * t + n[1] * oo], a = P(ta, o - hw), b = P(tb, o + hw), c2 = P(ta, o + hw), d2 = P(tb, o - hw);
    const xs = [a[0], b[0], c2[0], d2[0]], ys = [a[1], b[1], c2[1], d2[1]];
    return segsIn(gg, Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1).some(i => { const s2 = gg.segs[i]; if (s2[4] & 9) return false;
      const t1 = u[0] * s2[0] + u[1] * s2[1], o1 = n[0] * s2[0] + n[1] * s2[1], t2 = u[0] * s2[2] + u[1] * s2[3], o2 = n[0] * s2[2] + n[1] * s2[3];
      if (Math.min(o1, o2) > o - hw || Math.max(o1, o2) < o + hw) return false;   // must cross the whole band
      const tc = t1 + (t2 - t1) * (o - o1) / ((o2 - o1) || 1e-9); if (tc > ta + 0.1 * k && tc < tb - 0.1 * k) return true;
      // at the gap's end, a line running on well past a face is a column's (or a wider block's) edge, not a jamb's end cap
      return Math.abs(tc - (tc - ta < tb - tc ? ta : tb)) <= 0.1 * k && (Math.min(o1, o2) < o - T * k / 2 - 0.3 * k || Math.max(o1, o2) > o + T * k / 2 + 0.3 * k); }); };
  G.forEach(g => {
    const C = [];   // centre lines of this direction
    facePairs(g, T * k - tol, T * k + tol, 0.2 * k, (d, o, t0, t1) => {
      // a third line of this direction between the two faces over half their length: not a wall's two faces (a window's
      // glass beside a bed, a cupboard against a wall) — a wall's hollow is empty but for its windows
      // (counted: lines that run on past the pair at both ends — a window's glass lines stop within its wall, and a door's
      // leaf or frame drawn in the wall's band runs on past one end only, into the opening: neither counts)
      const iv = []; g.L.forEach(l => { if (l.o > o - d / 2 + 0.04 * k && l.o < o + d / 2 - 0.04 * k && l.t0 < t0 - 0.5 * k && l.t1 > t1 + 0.5 * k) { const a = Math.max(t0, l.t0), b = Math.min(t1, l.t1); if (b > a) iv.push([a, b]); } });
      iv.sort((a, b) => a[0] - b[0]); let inside = 0, e = -Infinity; iv.forEach(([a, b]) => { if (b > e) { inside += b - Math.max(a, e); e = b; } });
      if (inside <= 0.5 * (t1 - t0)) C.push({o, t0, t1}); });
    C.sort((a, b) => a.o - b.o);
    const lines = []; C.forEach(c => { const l = lines[lines.length - 1]; if (l && c.o - l.o <= 0.12 * k) { l.iv.push([c.t0, c.t1]); l.o = (l.o * l.n + c.o) / (l.n + 1); l.n++; } else lines.push({o: c.o, n: 1, iv: [[c.t0, c.t1]]}); });
    lines.forEach(l => {
      l.iv.sort((a, b) => a[0] - b[0]); const m = [];
      l.iv.forEach(v => { const q = m[m.length - 1]; if (q && (v[0] - q[1] <= 0.1 * k || (v[0] - q[1] <= bridge && !crossed(g, l.o, q[1], v[0])))) q[1] = Math.max(q[1], v[1]); else m.push(v.slice()); });
      m.forEach(v => { if (v[1] - v[0] >= 0.2 * k) runs.push({u: g.u, n: g.n, short: v[1] - v[0] < 0.6 * k, a: [g.u[0] * v[0] + g.n[0] * l.o, g.u[1] * v[0] + g.n[1] * l.o], b: [g.u[0] * v[1] + g.n[0] * l.o, g.u[1] * v[1] + g.n[1] * l.o]}); });
    });
  });
  const reach = 0.65 * T * k + 0.05 * k;
  /* a short piece (under 0.6 ft) is a wall only when it stands square off a longer wall — a nib at a door jamb, the
     return at a corner beside a door: one of its ends at the other's centre line (a T) or at its end (an L). Loose short
     pairs (hatching, ticks, a frame) are dropped. */
  const attached = A => runs.some(B => { if (B === A || B.short || Math.abs(A.u[0] * B.u[0] + A.u[1] * B.u[1]) > 0.2) return false;
    const X = segXInf(A.a, A.b, B.a, B.b); return !!X && Math.min(dist(A.a, X), dist(A.b, X)) <= reach && distSeg(X, B.a, B.b) <= reach; });
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].short && !attached(runs[i])) runs.splice(i, 1);
  // L corners: two runs ending within ~T/2 of where their centre lines cross are both taken to that point
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const A = runs[i], B = runs[j]; if (Math.abs(A.u[0] * B.u[0] + A.u[1] * B.u[1]) > 0.2) continue;
    const X = segXInf(A.a, A.b, B.a, B.b); if (!X) continue;
    const ea = dist(A.a, X) <= reach ? "a" : dist(A.b, X) <= reach ? "b" : null, eb = dist(B.a, X) <= reach ? "a" : dist(B.b, X) <= reach ? "b" : null;
    if (ea && eb) { A[ea] = X.slice(); B[eb] = X.slice(); }
  }
  /* + junctions: two runs crossing in their middles — the longer goes through, the shorter is cut at its faces, so the
     square where they cross is counted once */
  for (let changed = true, guard = 0; changed && guard < 500; guard++) { changed = false;
    for (let i = 0; i < runs.length && !changed; i++) for (let j = 0; j < runs.length && !changed; j++) {
      const A = runs[i], B = runs[j]; if (i === j || Math.abs(A.u[0] * B.u[0] + A.u[1] * B.u[1]) > 0.2) continue;
      const LA = dist(A.a, A.b), LB = dist(B.a, B.b); if (LA > LB || (LA === LB && i > j)) continue;   // A, the shorter, is cut
      const X = segXInf(A.a, A.b, B.a, B.b), h = T * k / 2; if (!X) continue;
      const inA = dist(A.a, X) + dist(X, A.b) - LA < 0.01 * k, inB = dist(B.a, X) + dist(X, B.b) - LB < 0.01 * k;
      if (!inA || !inB || dist(A.a, X) <= h + 0.05 * k || dist(X, A.b) <= h + 0.05 * k || dist(B.a, X) <= h || dist(X, B.b) <= h) continue;
      const v = [(A.b[0] - A.a[0]) / LA, (A.b[1] - A.a[1]) / LA];
      runs.splice(i, 1, Object.assign({}, A, {b: [X[0] - v[0] * h, X[1] - v[1] * h]}), Object.assign({}, A, {a: [X[0] + v[0] * h, X[1] + v[1] * h]})); changed = true; } }
  return runs.filter(r => dist(r.a, r.b) >= (r.short ? 0.2 : 0.6) * k);
}
function segXInf(a, b, c, d){ const r = [b[0] - a[0], b[1] - a[1]], s2 = [d[0] - c[0], d[1] - c[1]], den = r[0] * s2[1] - r[1] * s2[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s2[1] - (c[1] - a[1]) * s2[0]) / den; return [a[0] + t * r[0], a[1] + t * r[1]]; }
function chainRuns(runs, eps){   // runs sharing an end (and only two at that point) joined into polylines
  const key = p => Math.round(p[0] / eps) + "," + Math.round(p[1] / eps), deg = new Map();
  runs.forEach(r => [r.a, r.b].forEach(p => deg.set(key(p), (deg.get(key(p)) || 0) + 1)));
  const used = new Set(), out = [];
  runs.forEach((r, i) => { if (used.has(i)) return; used.add(i); const P = [r.a, r.b];
    for (let grow = true; grow;) { grow = false;
      for (let j = 0; j < runs.length; j++) { if (used.has(j)) continue; const q = runs[j], e = P[P.length - 1], f = P[0];
        if (deg.get(key(e)) === 2 && dist(q.a, e) < eps) { P.push(q.b); used.add(j); grow = true; } else if (deg.get(key(e)) === 2 && dist(q.b, e) < eps) { P.push(q.a); used.add(j); grow = true; }
        else if (deg.get(key(f)) === 2 && dist(q.a, f) < eps) { P.unshift(q.b); used.add(j); grow = true; } else if (deg.get(key(f)) === 2 && dist(q.b, f) < eps) { P.unshift(q.a); used.add(j); grow = true; } } }
    out.push(P); });
  return out;
}
/* run the walls agent: T ft thick, into condition c (or a new one), on the view (or the page); replaces its earlier runs */
function wallsAgent(o){
  const k = curScale(); if (!k) return {error: "Set the page scale first (K)."};
  if (scaleDoubt()) return {error: "The page scale is doubtful — the drawing measures " + scaleDoubt().label + ", not the note. Settle it first (scale chip)."};
  if (!S.geo[S.key] || !S.geo[S.key].segs.length) return {error: "This page has no vector lines (scanned?) — walls cannot be found from face lines. Draw them, or use Claude to read them."};
  const T = +o.t; if (!(T > 0.15 && T < 3)) return {error: "Give the wall thickness in ft, e.g. 0.75 for 9\"."};
  const rect = o.page ? null : viewRect(), runs = findWalls(T, rect, o.bridge == null ? 6 : +o.bridge);
  if (!runs || !runs.length) return {error: `No walls ${f3(T)} ft thick found ${o.page ? "on this page" : "in this view"}. Found thicknesses: ` + (wallThicknesses(rect).map(w => f3(w.t) + " ft (" + Math.round(w.len) + " ft)").join(", ") || "none")};
  let c = o.cond ? (cond(o.cond) || P.proj.conds.find(x => x.type === "linear" && x.name.toLowerCase() === String(o.cond).toLowerCase())) : null;
  const inch = Math.round(T * 12 * 2) / 2;
  if (!c) { const H = +o.h > 0 ? +o.h : 0;
    c = {id: uid("C"), name: o.name || (T >= 0.6 ? "Brick masonry " + inch + "\" wall" : "Partition wall " + inch + "\" (thickness " + f3(T) + " ft)"), type: "linear", unit: H ? (T >= 0.6 ? "cft" : "Sft") : "ft", color: COLORS[P.proj.conds.length % COLORS.length], h: H || "", t: T, faces: 1, dedMin: 1.0}; }
  const polys = chainRuns(runs, 0.05 * k);
  let total = 0;
  mutate(() => {
    if (!P.proj.conds.includes(c)) P.proj.conds.push(c);
    P.proj.items = P.proj.items.filter(i => !(i.wallAuto && i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && (!rect || i.pts.every(q => q[0] >= rect[0] && q[0] <= rect[2] && q[1] >= rect[1] && q[1] <= rect[3]))));
    polys.forEach((pts, n) => { total += polyLen(pts) / k; P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, ai: true, wallAuto: true, label: "Wall " + (n + 1)}); });
  });
  S.cond = c.id; refresh();
  return {condition: c.name, unit: c.unit, thickness_ft: T, runs: polys.length, total_length_ft: +total.toFixed(3), needs_height: c.unit === "ft" && T >= 0.3};
}
async function agentWallsCmd(t){
  const m = /(\d+(?:\.\d+)?)\s*(?:"|in(?:ch)?|''|”)/.exec(t), f = /(\d*\.\d+|\d+)\s*ft/.exec(t);
  const T = m ? +m[1] / 12 : f ? +f[1] : 0;
  if (!T) return wallsDialog();
  const r = wallsAgent({t: T});
  if (r.error) return aiLog("err", esc(r.error));
  aiLog("tool", `<b>${esc(r.condition)}</b>: ${r.runs} run${r.runs > 1 ? "s" : ""}, <b>${f3(r.total_length_ft)} ft</b> centre line`);
  aiLog("bot", "Wall runs are marked (AI — check them). " + (r.needs_height ? "No wall height yet — edit the condition (✎) to give H and the unit cft, then deduct openings with the <b>Opening</b> tool (O)." : "Deduct door and window openings with the <b>Opening</b> tool (O) — they were bridged."));
}
async function wallsDialog(){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  if (!curScale()) return aiLog("err", "Set the page scale first (K).");
  const found = wallThicknesses(viewRect()), lin = P.proj.conds.filter(c => c.type === "linear");
  const v = await ask("Walls agent", `<p>Finds walls from their two parallel face lines (vector PDFs exported from CAD), marks each run on its centre line and adds it to a length condition.</p>
    <div class="grid" style="margin-top:8px"><div class="fg w2"><label>Wall thickness</label><select id="wlT">${found.map(w => `<option value="${w.t}">${f3(w.t)} ft (${Math.round(w.t * 12 * 2) / 2}") — about ${Math.round(w.len)} ft drawn in this view</option>`).join("")}<option value="">Other — type it</option></select>
      <input type="text" id="wlT2" placeholder='e.g. 9" or 0.75' style="margin-top:4px${found.length ? ";display:none" : ""}"></div>
      <div class="fg w2"><label>Into condition</label><select id="wlC"><option value="">+ New condition for this thickness</option>${lin.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="fg"><label>Wall height H (ft) — new condition</label><input type="text" id="wlH" placeholder="from the section; blank = length only"></div>
      <div class="fg"><label>Bridge openings up to (ft)</label><input type="text" id="wlB" value="6.000"></div>
      <div class="fg w2"><label><input type="checkbox" id="wlP" style="width:auto"> Whole page (not only the part on screen) — title blocks and details may add false walls</label></div></div>
    <p class="small" style="margin-top:8px">${found.length ? "Thicknesses found in this view, most wall length first." : "No parallel wall faces found in this view — zoom to the plan, or the PDF has no vector lines."} Openings are bridged so they can be deducted as their own rows (Opening tool, O). Corners meet on the centre line; walls meeting a wall stop at its face, so nothing is counted twice. Running it again replaces its earlier runs.</p>`, "Find walls",
    () => { const tv = $("wlT").value || $("wlT2").value.trim(); let T = 0; const mm = /^(\d+(?:\.\d+)?)\s*("|in)$/.exec(tv); T = mm ? +mm[1] / 12 : parseFt(tv);
      if (!(T > 0.15 && T < 3)) return "Choose or type the wall thickness"; const H = $("wlH").value.trim() ? parseFt($("wlH").value) : 0, B = parseFt($("wlB").value || "0");
      if (isNaN(H) || isNaN(B)) return "Height and bridge are decimal feet"; return {t: T, cond: $("wlC").value || null, h: H, bridge: B, page: $("wlP").checked}; });
  if (!v) return;
  busy("Finding walls…"); await new Promise(r => setTimeout(r, 20));
  const r = wallsAgent(v); busy("");
  if (r.error) return aiLog("err", esc(r.error));
  aiLog("tool", `<b>${esc(r.condition)}</b>: ${r.runs} run${r.runs > 1 ? "s" : ""}, <b>${f3(r.total_length_ft)} ft</b> centre line${r.unit !== "ft" ? " → see the sheet for " + esc(r.unit) : ""}`);
  aiLog("bot", "Check the runs on the drawing (they are marked AI). Deduct doors and windows with the <b>Opening</b> tool (O)." + (r.needs_height ? " Give the condition its height H (✎) to get cft." : ""));
}
document.addEventListener("change", e => { if (e.target.id === "wlT") $("wlT2").style.display = e.target.value ? "none" : ""; });
/* ------------------------------------------------------------------ free agents II: ⚡ full takeoff · 🎨 finishes · ✅ check.
   Still no API key, no cost, nothing sent anywhere. The full takeoff chains the agents above over this page, a PDF or
   the whole project and reports once; the finishes agent puts each room's wall finish and skirting on the sheet in the
   house format, every door and window its own deduction row; the checker audits a takeoff for what a checking QS asks
   about, each finding with a button to show or fix it. A whole run is one undo step. */
const STD_WALLS = [4, 4.5, 5, 6, 8, 9, 10, 12, 13.5, 18];   // inches: thicknesses taken on their own — any other spacing of parallel lines (window glass, a counter) is listed, not measured
const stdWall = t => STD_WALLS.find(s => Math.abs(t * 12 - s) <= 0.26);
const inchOf = t => Math.round(t * 24) / 2 + "\"";
const natSort = (a, b) => String(a).localeCompare(String(b), undefined, {numeric: true});
const isRoomArea = i => i.kind === "shape" && !i.finAuto && (cond(i.cond) || {}).type === "area" && !!String(i.label || "").trim() && i.pts.length >= 2;
const wallCondFor = T => P.proj.conds.find(c => c.type === "linear" && Math.abs(+c.t - T) < 0.005 && !c.finAgent && (c.agentWall || /wall|masonry|partition|block/i.test(c.name)) && !/plaster|paint|finish|skirting/i.test(c.name));
function lev(a, b){ if (Math.abs(a.length - b.length) > 2) return 9; let p = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; }
function nameLike(name, w){   // a room / condition name and a typed word: the same word, give or take a slip of the keyboard
  w = String(w || "").toLowerCase().replace(/[^a-z0-9]/g, ""); if (!w || (w.length < 2 && !/^\d$/.test(w))) return false;
  const toks = String(name || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), joined = toks.join(""), alpha = toks.filter(x => !/^\d+$/.test(x)).join("");
  if (joined.includes(w)) return true;
  const tol = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0; if (!tol) return false;
  return [alpha, joined].concat(toks).some(x => lev(x, w) <= tol || (x.length > w.length && lev(x.slice(0, w.length), w) <= tol));
}
const roomWords = s => String(s || "").toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/s$/, ""));
const roomWanted = (r, words) => !words.length || words.some(w => r.name.toLowerCase().replace(/\s+/g, "").includes(w) || nameLike(r.name, w));
async function asOneStep(label, fn){   // everything fn changes is undone by one Ctrl+Z
  const before = snapshot(), top = S.undo[S.undo.length - 1];
  try { return await fn(); }
  finally { if (snapshot() !== before) { S.undo.splice(top ? S.undo.lastIndexOf(top) + 1 : 0); S.undo.push({js: before, label}); S.redo = []; refresh(); } }
}
async function agentGoto(f, i){   // open a page and wait for its lines and text -> true when it is the page shown
  const key = keyOf(f, i);
  if (S.key !== key || !S.page) await gotoPage(f, i);
  for (let n = 0; n < 1200 && S.key === key && !(S.geo[key] && S.texts[key]); n++) await new Promise(r => setTimeout(r, 25));
  return S.key === key && !!S.geo[key] && !!S.texts[key];
}

/* ⚡ full takeoff: rooms (auto area at every room name not yet measured), walls (every standard thickness drawn, on the
   centre line), door / window tags (with the schedule table's sizes into the opening schedule) and the finishes, page
   after page. A page with no scale, or one its written room sizes disagree with, is skipped and listed. */
async function fullTakeoffDialog(scope){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  if (S.agentRun) return toast("An agent is already running — wait for it to finish");
  const fc = P.proj.conds.find(c => c.finAgent === "wall"), nP = (P.proj.files.find(x => x.id === S.fileId) || {}).pages || 1, nA = allPages().length;
  const v = await ask("⚡ Full takeoff agent", `<p>Runs the free agents one after another and reports once — no API key, nothing leaves this browser.</p>
    <div class="grid" style="margin-top:8px"><div class="fg w2"><label>Where</label><select id="ftScope"><option value="page">This page</option><option value="pdf"${scope === "pdf" ? " selected" : ""}>Every page of this PDF (${nP})</option><option value="all"${scope === "all" ? " selected" : ""}>Every PDF in the project (${nA} pages)</option></select></div>
    <div class="fg w2"><label>Do</label><label class="pk"><input type="checkbox" id="ftR" checked> 🏠 Rooms — auto area at every room name not yet measured, checked against its written size</label>
      <label class="pk"><input type="checkbox" id="ftW" checked> 🧱 Walls — every standard thickness drawn (4.5", 9", 13.5" …), on the centre line</label>
      <label class="pk"><input type="checkbox" id="ftD" checked> 🚪 Doors / windows — every tag counted; sizes in a schedule table go to the opening schedule</label>
      <label class="pk"><input type="checkbox" id="ftF"${fc ? " checked" : ""}> 🎨 Finishes — wall finish and skirting of each room, doors and windows deducted as their own rows</label></div>
    <div class="fg"><label>Room height H (ft) — finishes</label><input type="text" id="ftH" value="${fc && +fc.h ? f3(+fc.h) : ""}" placeholder="floor to ceiling, from the section"></div>
    <div class="fg"><label>Door height (ft) — doors not in the schedule</label><input type="text" id="ftDH" value="${P.proj.finDH ? f3(P.proj.finDH) : ""}" placeholder="from the door schedule"></div></div>
    <p class="small" style="margin-top:8px">A page with no scale, or a scale its written room sizes disagree with, is skipped and listed — nothing is measured at a doubtful scale. Rooms already measured are left as they are; walls and finishes found again replace the agent's own earlier runs. Everything added is marked <b>AI</b> until checked, and one <b>Ctrl+Z</b> takes the whole run back.</p>`, "Run",
    () => { const o = {scope: $("ftScope").value, rooms: $("ftR").checked, walls: $("ftW").checked, doors: $("ftD").checked, fin: $("ftF").checked};
      if (!o.rooms && !o.walls && !o.doors && !o.fin) return "Tick something to do";
      const H = $("ftH").value.trim() ? parseFt($("ftH").value) : 0, DH = $("ftDH").value.trim() ? parseFt($("ftDH").value) : 0;
      if (isNaN(H) || isNaN(DH)) return "Heights are in feet, e.g. 10.5 or 10'-6\"";
      if (o.fin && !(H > 0)) return "Give the room height H for the finishes (or untick Finishes)";
      return Object.assign(o, {H, DH}); });
  if (v) return fullTakeoff(v);
}
async function fullTakeoff(o){   // o: {scope, rooms, walls, doors, fin, H, DH, filter} -> {pages: [one report per page], ms}
  if (!P.proj || !S.page) return {error: "no page open"};
  if (S.agentRun) return {error: "an agent is already running"};
  const pages = o.scope === "page" || !o.scope ? [{f: P.proj.files.find(x => x.id === S.fileId), i: S.pageNo}] : allPages().filter(p => o.scope === "all" || p.f.id === S.fileId);
  const home = [S.fileId, S.pageNo], cond0 = S.cond, rep = [], t0 = Date.now(), words = roomWords(o.filter);
  let roomC = null; S.agentRun = true;
  try { await asOneStep("Full takeoff", async () => {
    for (const [n, p] of pages.entries()) {
      const R = {page: pageName({file: p.f.id, page: p.i}), file: p.f.id, no: p.i}; rep.push(R);
      busy(`⚡ Full takeoff — ${R.page}${pages.length > 1 ? ` (${n + 1} of ${pages.length})` : ""}…`);
      if (!await agentGoto(p.f.id, p.i)) { R.skip = "could not be opened (or another page was opened meanwhile)"; continue; }
      if (!S.geo[S.key].segs.length && !S.texts[S.key].length) { R.skip = "blank — no lines or text"; continue; }
      if (!curScale()) { R.skip = "no scale — set it (K), then run again"; continue; }
      try { await checkScale(S.key, false); } catch (e) {}
      if (scaleDoubt()) { R.skip = "scale doubtful — the written room sizes measure " + scaleDoubt().label + "; settle it on the scale chip"; continue; }
      if (o.rooms) {
        const F = await drawingFacts(S.fileId, S.pageNo), have = P.proj.items.filter(i => onPage(i) && i.kind === "shape" && (cond(i.cond) || {}).type === "area");
        const want = F.rooms.filter(r => roomWanted(r, words)), todo = want.filter(r => !have.some(i => pointInPoly([r.x + r.w / 2, r.y - r.h / 2], itemPoly(i))));
        R.rooms = {named: want.length, had: want.length - todo.length, ok: 0, chk: [], bad: [], sft: 0};
        if (todo.length) {
          if (roomC && cond(roomC)) S.cond = roomC;
          const r = await agentMeasure("", todo, {quiet: true});
          if (r.error) R.rooms.err = r.error;
          else { roomC = (P.proj.conds.find(c => c.type === "area" && c.name === r.condition) || {}).id || roomC; R.rooms.cond = r.condition;
            r.rooms.forEach(x => { if (x.error) R.rooms.bad.push(x.name + " — " + x.error); else if (x.already) R.rooms.had++; else if (x.area_sft != null) { R.rooms.sft += x.area_sft; if (x.check) R.rooms.chk.push(x.name); else R.rooms.ok++; } }); }
        }
      }
      if (o.walls) {
        busy(`⚡ Full takeoff — ${R.page}: walls…`); await new Promise(r => setTimeout(r, 10));
        const found = wallThicknesses(null), seen = new Set(); R.walls = []; R.wallOther = found.filter(w => !stdWall(w.t)).map(w => ({t: w.t, len: w.len}));
        for (const w of found) { const s = stdWall(w.t); if (!s || seen.has(s)) continue; seen.add(s);
          const T = s / 12, ex = wallCondFor(T), r = wallsAgent({t: T, page: true, bridge: 6, cond: ex ? ex.id : null});
          if (!r.error && !ex) { const c = P.proj.conds.find(x => x.type === "linear" && x.name === r.condition); if (c) c.agentWall = true; }
          R.walls.push(r.error ? {t: T, err: r.error} : {t: T, name: r.condition, ft: r.total_length_ft, runs: r.runs, unit: r.unit}); }
      }
      if (o.doors) {
        const res = await scanTags("page"), T = res[0].T, keys = Object.keys(T.plan).filter(k2 => tagKind(k2) !== "Tags").sort(natSort);
        const newSch = Object.keys(T.sched).filter(k2 => !(P.proj.openings || []).some(x => String(x.mark).toUpperCase() === k2));
        R.tags = {}; R.newSch = newSch; R.sch = {}; keys.forEach(k2 => { R.tags[k2] = T.plan[k2].length; }); Object.entries(T.sched).forEach(([k2, sc]) => { if (sc.qty) R.sch[k2] = sc.qty; });
        if (keys.length || newSch.length) mutate(() => { if (keys.length) putCounts(res, keys, "mark");
          newSch.forEach(k2 => { const sc = T.sched[k2]; P.proj.openings.push({id: uid("O"), mark: k2, type: tagKind(k2) === "Doors" ? "door" : tagKind(k2) === "Windows" ? "window" : "other", w: sc.w, h: sc.h, src: "read from the drawing's schedule (" + sc.how + ")"}); }); }, "Count doors / windows");
      }
      if (o.fin) R.fin = !P.proj.items.some(i => onPage(i) && isRoomArea(i)) ? {none: true} : finishesRun({H: o.H, DH: o.DH, cond: roomC && P.proj.items.some(i => onPage(i) && i.cond === roomC && isRoomArea(i)) ? roomC : roomCondOf(), ceiling: true});
    }
  }); } finally { S.agentRun = false; busy(""); if (cond0 && cond(cond0)) S.cond = cond0; }   // the condition the user had picked stays picked
  if (pages.length > 1 && (S.fileId !== home[0] || S.pageNo !== home[1])) await agentGoto(home[0], home[1]);
  const ms = Date.now() - t0; fullReport(o, rep, ms);
  return {pages: rep, ms};
}
function fullReport(o, rep, ms){
  const done = rep.filter(R => !R.skip), skip = rep.filter(R => R.skip), sum = (L, f) => L.reduce((a, x) => a + (+f(x) || 0), 0);
  const roomsL = R => R.rooms.err ? `<span style="color:var(--red)">${esc(R.rooms.err)}</span>` : !R.rooms.named ? "no room names in the page's text" + (o.filter ? " matching “" + esc(o.filter) + "”" : "")
    : R.rooms.had >= R.rooms.named ? `all ${R.rooms.named} rooms were already measured — left as they are`
    : `<b>${R.rooms.ok + R.rooms.chk.length}</b> of ${R.rooms.named} rooms measured${R.rooms.had ? ` (${R.rooms.had} were already)` : ""}${R.rooms.sft ? ` · <b>${fq(R.rooms.sft)} Sft</b>` : ""}${R.rooms.chk.length ? ` · <b style="color:var(--amber)">check</b> ${R.rooms.chk.map(esc).join(", ")}` : ""}${R.rooms.bad.length ? `<br><span class="small" style="color:var(--red)">not closed: ${R.rooms.bad.map(esc).join("; ")} — a Fence across the opening, then run again</span>` : ""}`;
  const wallsL = R => (R.walls.length ? R.walls.map(w => w.err ? `${inchOf(w.t)}: <span style="color:var(--red)">${esc(w.err)}</span>` : `${inchOf(w.t)} <b>${f3(w.ft)} ft</b> <span class="small">(${w.runs} run${w.runs > 1 ? "s" : ""})</span>`).join(" · ") : "no wall faces found (scanned page?)")
    + (R.wallOther.length ? `<br><span class="small">Not taken: ${R.wallOther.map(w => inchOf(w.t) + " (" + Math.round(w.len) + " ft)").join(", ")} — window glass, counters and the like; 🧱 Walls takes one if it is a wall.</span>` : "");
  const tagsL = R => (Object.keys(R.tags).length ? Object.entries(R.tags).map(([m, n]) => esc(m) + " <b>×" + n + "</b>").join(" · ") : "no door / window tags") + (R.newSch.length ? `<br><span class="small">Sizes of ${R.newSch.map(esc).join(", ")} read from the schedule into the opening schedule.</span>` : "");
  const finL = R => R.fin.none ? "no rooms measured on this page" : R.fin.error ? `<span style="color:var(--red)">${esc(R.fin.error)}</span>` : `${R.fin.rooms.length} rooms · wall finish <b>${fq(sum(R.fin.rooms, x => x.wallNet))} Sft</b> net · skirting <b>${fq(sum(R.fin.rooms, x => x.skirt))} ft</b>${sum(R.fin.rooms, x => x.notes.length) ? ` · <b style="color:var(--amber)">${sum(R.fin.rooms, x => x.notes.length)} opening${sum(R.fin.rooms, x => x.notes.length) > 1 ? "s" : ""} not deducted</b> <span class="small">(no size — see 🎨 Finishes)</span>` : ""}`;
  const blk = R => `<div style="margin-top:7px"><b>${esc(R.page)}</b>${R.rooms ? "<br>🏠 " + roomsL(R) : ""}${R.walls ? "<br>🧱 " + wallsL(R) : ""}${R.tags ? "<br>🚪 " + tagsL(R) : ""}${R.fin ? "<br>🎨 " + finL(R) : ""}</div>`;
  let tot = "";
  if (done.length > 1) {   // the run's totals, and the counts against the schedule's quantities
    const W = {}, G = {}; done.forEach(R => { (R.walls || []).forEach(w => { if (!w.err) W[w.t] = (W[w.t] || 0) + w.ft; }); Object.entries(R.tags || {}).forEach(([m, n]) => { G[m] = (G[m] || 0) + n; }); });
    tot = `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px"><b>All ${done.length} pages</b>${o.rooms ? `<br>🏠 <b>${fq(sum(done, R => R.rooms && R.rooms.sft))} Sft</b> of rooms measured` : ""}${Object.keys(W).length ? "<br>🧱 " + Object.keys(W).sort((a, b) => a - b).map(t => inchOf(+t) + " <b>" + f3(W[t]) + " ft</b>").join(" · ") : ""}${Object.keys(G).length ? "<br>🚪 " + Object.keys(G).sort(natSort).map(m => esc(m) + " <b>×" + G[m] + "</b>").join(" · ") : ""}</div>`;
  }
  const sch = {}; rep.forEach(R => Object.assign(sch, R.sch || {}));
  const off = Object.entries(sch).map(([m, q]) => { const c = P.proj.conds.find(x => x.type === "count" && x.name.toUpperCase() === m), n = c ? condTotals(c).net : 0; return n && n !== q ? `${esc(m)}: schedule ${q}, counted ${n}` : ""; }).filter(Boolean);
  const d = aiLog("bot", `<b>⚡ Full takeoff</b> — ${done.length} page${done.length === 1 ? "" : "s"} done${skip.length ? `, ${skip.length} skipped` : ""} in ${(ms / 1000).toFixed(1)} s${done.length > 8 ? `<details><summary class="small">Page by page</summary>${done.map(blk).join("")}</details>` : done.map(blk).join("")}${tot}
    ${off.length ? `<div style="margin-top:6px;color:var(--red)"><b>Counted ≠ schedule quantity:</b> ${off.join(" · ")}</div>` : ""}
    ${skip.length ? `<div style="margin-top:6px" class="small"><b>Skipped:</b> ${skip.map(R => esc(R.page) + " — " + esc(R.skip)).join("<br>")}</div>` : ""}
    <div style="margin-top:6px" class="small">Everything added is marked <b>AI</b> until checked. One <b>Ctrl+Z</b> takes the whole run back.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sm pri" data-fa="check">✅ Check the takeoff</button>${!o.fin && done.length ? '<button class="btn sm" data-fa="fin">🎨 Finishes…</button>' : ""}<button class="btn sm" data-fa="sched">📋 Room schedule</button></div>`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-fa]"); if (!b) return; const a = b.dataset.fa; if (a === "check") agentCheck(o.scope === "page" ? "page" : "all"); else if (a === "fin") finishesDialog(); else agentSchedule(); });
}

/* 🎨 finishes of the rooms measured on this page (named area measurements): each room's wall finish as one closed run
   (Nos × L × H, faces 1) with every door and window on it deducted as its own opening row, its skirting less its doors,
   and its ceiling as an assembly line of the room condition (= A). Doors are the swings drawn (hinge to jamb), sized from
   the opening schedule when a door tag is beside one, else its drawn width × the door height given; windows are the
   window tags in or beside the room, sized from the opening schedule only — a window's height is never on a plan, so one
   with no size is listed, not deducted. Running it again replaces its own earlier runs on the page. */
function roomCondOf(){   // the area condition holding the most named rooms on this page
  const n = {}; P.proj.items.forEach(i => { if (onPage(i) && isRoomArea(i)) n[i.cond] = (n[i.cond] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null;
}
function doorLines(){   // the doors drawn on this page: [{a, b}] hinge to jamb, page units; a double door's two leaves are one
  const g = S.geo[S.key], k = curScale(); if (!g || !k || !g.segs.length) return [];
  const out = [];
  doorSymbols(g, segsIn(g, 0, 0, S.base.width, S.base.height), k).lines.forEach(l => {
    const d = {a: [l[0], l[1]], b: [l[2], l[3]]}, L = dist(d.a, d.b); if (!(L > 0)) return;
    const u = [(d.b[0] - d.a[0]) / L, (d.b[1] - d.a[1]) / L];
    const q = out.find(o => { const M = dist(o.a, o.b), v = [(o.b[0] - o.a[0]) / M, (o.b[1] - o.a[1]) / M];
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.05 || Math.abs((d.a[0] - o.a[0]) * v[1] - (d.a[1] - o.a[1]) * v[0]) > 0.1 * k) return false;   // one line
      const t = [d.a, d.b].map(p => (p[0] - o.a[0]) * v[0] + (p[1] - o.a[1]) * v[1]); return Math.min(...t) < M + 0.3 * k && Math.max(...t) > -0.3 * k; });   // touching or overlapping
    if (!q) { out.push(d); return; }
    const M = dist(q.a, q.b), v = [(q.b[0] - q.a[0]) / M, (q.b[1] - q.a[1]) / M], ts = [q.a, q.b, d.a, d.b].map(p => (p[0] - q.a[0]) * v[0] + (p[1] - q.a[1]) * v[1]), lo = Math.min(...ts), hi = Math.max(...ts), o0 = q.a.slice();
    q.a = [o0[0] + v[0] * lo, o0[1] + v[1] * lo]; q.b = [o0[0] + v[0] * hi, o0[1] + v[1] * hi]; q.leaves = 2;
  });
  return out;
}
function finCond(kind, H){   // the finishes agent's own conditions, made once and reused
  let c = P.proj.conds.find(x => x.finAgent === kind);
  if (!c) { c = kind === "wall" ? {id: uid("C"), name: "Internal wall finish — rooms (plaster / paint)", type: "linear", unit: "Sft", h: H, t: "", faces: 1, dedMin: 1.0, finAgent: "wall"}
                                : {id: uid("C"), name: "Skirting — rooms", type: "linear", unit: "ft", h: "", t: "", faces: 1, dedMin: 0, finAgent: "skirt"};
    c.color = COLORS[P.proj.conds.length % COLORS.length]; P.proj.conds.push(c); }
  if (kind === "wall") c.h = H;
  return c;
}
function finishesRun(o){   // o: {H, DH, cond, ceiling} on this page -> {rooms: [{name, floor, per, skirt, wallGross, wallDed, wallNet, doors, wins, notes}], wall, skirt} or {error}
  const k = curScale(); if (!k) return {error: "Set the page scale first (K)."};
  if (scaleDoubt()) return {error: "The page scale is doubtful — the drawing measures " + scaleDoubt().label + ", not the note. Settle it first (scale chip)."};
  const H = +o.H; if (!(H > 0)) return {error: "Give the room height H (ft) — floor to ceiling, from the section."};
  const DH = +o.DH > 0 ? +o.DH : 0, rooms = P.proj.items.filter(i => onPage(i) && isRoomArea(i) && (!o.cond || i.cond === o.cond));
  if (!rooms.length) return {error: "No named room areas on this page — run 🏠 Rooms first (the finishes go round each measured room)."};
  const T = tagsOf(S.texts[S.key] || []), doors = doorLines(), tol = 1.25 * k, polys = rooms.map(itemPoly), wins = rooms.map(() => []), loose = [];
  const tagPts = fams => Object.entries(T.plan).filter(([m]) => fams.includes(tagKind(m))).flatMap(([m, pts]) => pts.map(p => ({m, p})));
  const dTags = tagPts(["Doors"]);
  dTags.forEach(t2 => {   // each door tag to the door drawn nearest it (within 3 ft): that door's mark
    let best = null; doors.forEach(d => { const e = distSeg(t2.p, d.a, d.b); if (e < 3 * k && (!best || e < best.e)) best = {d, e}; });
    if (best) { t2.d = best.d; if (!best.d.mk || best.e < best.d.mkE) { best.d.mk = t2.m; best.d.mkE = best.e; } } });
  // window tags — and door tags with no swing drawn beside them (an entrance, a sliding door, an opening): each to the room
  // it is in, else the nearest (within 4 ft of its outline), on that room's nearest side
  tagPts(["Windows", "Ventilators"]).concat(dTags.filter(t2 => !t2.d).map(t2 => Object.assign(t2, {door: true}))).forEach(t2 => {
    let best = null;
    polys.forEach((pl, n) => { let e = Infinity, ei = 0; for (let i = 0; i < pl.length; i++) { const x = distSeg(t2.p, pl[i], pl[(i + 1) % pl.length]); if (x < e) { e = x; ei = i; } }
      const sc = pointInPoly(t2.p, pl) ? -1 : e; if (sc < 4 * k && (!best || sc < best.sc)) best = {n, sc, ei}; });
    if (best) wins[best.n].push({m: t2.m, p: t2.p, ei: best.ei, door: !!t2.door}); else loose.push(t2.m); });
  const onRoom = (pl, d) => { const L = dist(d.a, d.b), u = [(d.b[0] - d.a[0]) / L, (d.b[1] - d.a[1]) / L];   // a door along one side of the room, both its ends within 1.25 ft of it
    for (let i = 0; i < pl.length; i++) { const p = pl[i], q = pl[(i + 1) % pl.length], M = dist(p, q); if (!(M > 0)) continue;
      if (Math.abs(u[0] * (q[1] - p[1]) - u[1] * (q[0] - p[0])) / M > 0.1) continue;
      if (distSeg(d.a, p, q) <= tol && distSeg(d.b, p, q) <= tol) return true; }
    return false; };
  const schM = m => (P.proj.openings || []).find(x => String(x.mark).toUpperCase() === m) || null;
  const addSch = Object.entries(T.sched).filter(([m]) => !schM(m)).map(([m, sc]) => ({id: uid("O"), mark: m, type: tagKind(m) === "Doors" ? "door" : tagKind(m) === "Windows" ? "window" : "other", w: sc.w, h: sc.h, src: "read from the drawing's schedule (" + sc.how + ")"}));
  const out = []; let wc, skc;
  mutate(() => {
    addSch.forEach(x => P.proj.openings.push(x)); if (DH) P.proj.finDH = DH;
    wc = finCond("wall", H); skc = finCond("skirt");
    P.proj.items = P.proj.items.filter(i => !(i.finAuto && onPage(i) && (i.cond === wc.id || i.cond === skc.id)));
    if (o.ceiling) [...new Set(rooms.map(i => i.cond))].map(cond).forEach(c => { if (c && !(c.asm || []).some(a => /ceiling/i.test(a.name || ""))) c.asm = (c.asm || []).concat({id: uid("A"), name: "Ceiling finish (plaster / paint)", unit: "Sft", f: "A"}); });
    rooms.forEach((it, n) => {
      const pl = polys[n], name = it.label.trim(), circ = it.shape === "circle", R = {name, nos: +it.nos || 1, it: it.id, doors: [], wins: [], notes: [], w: [], s: []};
      const base = {file: S.fileId, page: S.pageNo, nos: R.nos, ai: true, finAuto: true, room: name};
      const run = c2 => { const pts = pl.map(p => p.slice()).concat([pl[0].slice()]), x = Object.assign({id: uid("I"), cond: c2, kind: "shape", pts, label: name}, base); if (circ) x.arcs = [[0, pts.length - 1]]; P.proj.items.push(x); return x.id; };
      R.w.push(run(wc.id)); R.s.push(run(skc.id));
      const mine = doors.filter(d => onRoom(pl, d));
      mine.forEach(d => {
        const s = d.mk ? schM(d.mk) : null, w = s ? +s.w : dist(d.a, d.b) / k, h = s ? +s.h : DH;
        const op = Object.assign({kind: "open", pts: [d.a.slice(), d.b.slice()], label: d.mk || "Door", ow: r3(w), oh: h ? r3(h) : 0}, s ? {sch: s.id} : {}, base);
        const sk = Object.assign({id: uid("I"), cond: skc.id}, op); P.proj.items.push(sk); R.s.push(sk.id);   // the door's width off the skirting
        if (h > 0) { const wo = Object.assign({id: uid("I"), cond: wc.id}, op); P.proj.items.push(wo); R.w.push(wo.id); }
        else R.notes.push(`${d.mk || "a door"} ${f3(w)} ft wide: no height (not in the opening schedule, no door height given) — not deducted from the wall finish`);
        R.doors.push(d.mk || "door"); });
      wins[n].forEach(wn => {
        if (wn.door && mine.some(d => !d.mk && distSeg(wn.p, d.a, d.b) < 5 * k)) return;   // a tag a little far from a swing with no tag of its own: that door, already taken
        const s = schM(wn.m), lst = wn.door ? R.doors : R.wins;
        if (!s) { R.notes.push(`${wn.m}${wn.door ? " (a door tag with no swing drawn)" : ""}: no size in the opening schedule — not deducted`); lst.push(wn.m + "?"); return; }
        const p = pl[wn.ei], q = pl[(wn.ei + 1) % pl.length], L = dist(p, q), u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], hw = Math.min(L, +s.w * k) / 2;
        const t = Math.max(hw, Math.min(L - hw, (wn.p[0] - p[0]) * u[0] + (wn.p[1] - p[1]) * u[1]));
        const wo = Object.assign({id: uid("I"), cond: wc.id, kind: "open", pts: [[p[0] + u[0] * (t - hw), p[1] + u[1] * (t - hw)], [p[0] + u[0] * (t + hw), p[1] + u[1] * (t + hw)]], label: wn.m, sch: s.id, ow: +s.w, oh: +s.h}, base);
        P.proj.items.push(wo); R.w.push(wo.id); lst.push(wn.m);
        if (wn.door) { const sk = Object.assign({}, wo, {id: uid("I"), cond: skc.id, pts: wo.pts.map(p => p.slice())}); P.proj.items.push(sk); R.s.push(sk.id); } });
      out.push(R);
    });
  }, "Finishes");
  const q = id => { const it = P.proj.items.find(i => i.id === id), kk = it && itemScale(it); return kk ? rowsOf(it, kk).reduce((a, r) => a + r.qty, 0) : 0; };
  out.forEach(R => { R.floor = q(R.it); R.ceil = R.floor; R.per = q(R.s[0]); R.skirt = R.s.reduce((a, id) => a + q(id), 0); R.wallGross = q(R.w[0]); R.wallNet = R.w.reduce((a, id) => a + q(id), 0); R.wallDed = R.wallGross - R.wallNet; });
  return {rooms: out, wall: wc.name, skirt: skc.name, H, loose, schAdded: addSch.map(x => x.mark), ceiling: !!o.ceiling};
}
async function finishesDialog(){
  if (!P.proj || !S.page) return aiLog("err", "Open a PDF page first.");
  if (!curScale()) return aiLog("err", "Set the page scale first (K).");
  const rooms = P.proj.items.filter(i => onPage(i) && isRoomArea(i)), byC = {}; rooms.forEach(i => { byC[i.cond] = (byC[i.cond] || 0) + 1; });
  if (!rooms.length) { const d = aiLog("err", `No named room areas on this page yet — the finishes go round each measured room. <button class="btn sm pri" data-go="1">🏠 Measure the rooms first</button>`);
    d.querySelector("[data-go]").onclick = async () => { const r = await agentMeasure(""); if (r && !r.error) finishesDialog(); }; return; }
  const best = roomCondOf(), cs = Object.keys(byC).map(cond).filter(Boolean), wc = P.proj.conds.find(c => c.finAgent === "wall");
  const v = await ask("🎨 Finishes agent", `<p>For each room measured on this page: the wall finish (plaster / paint) round the room as Nos × L × H with every door and window on it deducted as its own row, the skirting less its doors, and the ceiling (= the floor area).</p>
    <div class="grid" style="margin-top:8px"><div class="fg w2"><label>Rooms from</label><select id="fnC">${cs.map(c => `<option value="${esc(c.id)}"${c.id === best ? " selected" : ""}>${esc(c.name)} (${byC[c.id]} rooms)</option>`).join("")}${cs.length > 1 ? `<option value="">Every area condition (${rooms.length} rooms)</option>` : ""}</select></div>
    <div class="fg"><label>Room height H (ft)</label><input type="text" id="fnH" value="${wc && +wc.h ? f3(+wc.h) : ""}" placeholder="floor to ceiling, from the section"></div>
    <div class="fg"><label>Door height (ft) — doors not in the schedule</label><input type="text" id="fnDH" value="${P.proj.finDH ? f3(P.proj.finDH) : ""}" placeholder="from the door schedule"></div>
    <div class="fg w2"><label class="pk"><input type="checkbox" id="fnCl" checked> Ceiling finish as an assembly line of the room condition (= its floor area A) — for the Bill</label></div></div>
    <p class="small" style="margin-top:8px">Doors are found from their swings; a door tag beside one gives its size from the opening schedule (Bill → Opening schedule), else its drawn width × the door height above. Windows are found from their tags and need a size in the opening schedule — a window's height is never on a plan, so one with no size is listed, not deducted. Openings of 1.00 Sft or less are not deducted (house rule). Running it again replaces its own earlier runs on this page.</p>`, "Do finishes",
    () => { const H = parseFt($("fnH").value), DH = $("fnDH").value.trim() ? parseFt($("fnDH").value) : 0;
      if (!(H > 0)) return "Give the room height H (ft) — floor to ceiling"; if (isNaN(DH)) return "The door height is in feet, e.g. 7 or 7'-0\"";
      return {H, DH, cond: $("fnC").value || null, ceiling: $("fnCl").checked}; }, "fnH");
  if (!v) return;
  const r = await asOneStep("Finishes", () => finishesRun(v));
  if (r.error) return aiLog("err", esc(r.error));
  finReport(r); return r;
}
function finReport(r){
  const tot = f => r.rooms.reduce((a, x) => a + x[f], 0), notes = r.rooms.flatMap(x => x.notes.map(n => `<b>${esc(x.name)}</b>: ${esc(n)}`)).concat(r.loose.map(m => `${esc(m)}: no measured room beside the tag — not deducted`));
  const tsv = [["Room", "Nos", "Floor Sft", "Ceiling Sft", "Perimeter ft", "Doors", "Windows", "Skirting ft", "Wall finish gross Sft", "Openings deducted Sft", "Wall finish net Sft"]]
    .concat(r.rooms.map(x => [x.name, x.nos, x.floor.toFixed(3), x.ceil.toFixed(3), x.per.toFixed(3), x.doors.join(" "), x.wins.join(" "), x.skirt.toFixed(3), x.wallGross.toFixed(3), x.wallDed.toFixed(3), x.wallNet.toFixed(3)])).map(a => a.join("\t")).join("\n");
  const d = aiLog("bot", `<b>🎨 Finishes</b> — ${r.rooms.length} rooms, H = ${f3(r.H)} ft <button class="btn sm" data-cp="1">Copy for Excel</button>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px"><tr><th align="left">Room</th><th align="right">Floor / ceiling Sft</th><th align="right">Wall finish Sft</th><th align="right">Skirting ft</th><th align="left">Openings</th></tr>
    ${r.rooms.map(x => `<tr><td>${esc(x.name)}${x.nos > 1 ? " ×" + x.nos : ""}</td><td align="right">${fq(x.floor)}</td><td align="right">${fq(x.wallNet)}</td><td align="right">${fq(x.skirt)}</td><td class="small">${esc(x.doors.concat(x.wins).join(" ")) || "—"}</td></tr>`).join("")}
    <tr><td><b>Total</b></td><td align="right"><b>${fq(tot("floor"))}</b></td><td align="right"><b>${fq(tot("wallNet"))}</b></td><td align="right"><b>${fq(tot("skirt"))}</b></td><td></td></tr></table>
    <span class="small">On the sheet: <b>${esc(r.wall)}</b> (each room's run, its doors and windows as deduction rows) and <b>${esc(r.skirt)}</b> (less the doors)${r.ceiling ? "; the ceiling is an assembly line of the room condition, in the Bill" : ""}.${r.schAdded.length ? " Sizes of " + r.schAdded.map(esc).join(", ") + " read from the drawing's schedule into the opening schedule." : ""}</span>
    ${notes.length ? `<div style="margin-top:6px;color:#8a5a00"><b>Not deducted (${notes.length})</b> — give the size in Bill → Opening schedule, then run again:<br>${notes.join("<br>")}</div>` : ""}`);
  d.querySelector("[data-cp]").onclick = async () => { try { await navigator.clipboard.writeText(tsv); toast("Copied — paste into Excel"); } catch (e) { toast("Could not copy"); } };
}

/* ✅ the checker: what a checking QS asks about a takeoff — rooms written on the drawing but not measured, the same room
   measured twice, a count marker on top of another, door / window tags not counted (or counted differently), measured
   against written sizes, counts against the schedule's quantities, the schedule's sizes against the opening schedule,
   walls with no height, unchecked agent work, and the export check — each with a button to show or fix it. */
function overlapSft(A, B, k){   // about how much two outlines overlap (Sft), by sampling their common box
  const bb = Q => Q.reduce((o, p) => [Math.min(o[0], p[0]), Math.min(o[1], p[1]), Math.max(o[2], p[0]), Math.max(o[3], p[1])], [1e12, 1e12, -1e12, -1e12]);
  const a = bb(A), b = bb(B), x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
  if (!(x1 > x0 && y1 > y0)) return 0;
  const N = 24, dx = (x1 - x0) / N, dy = (y1 - y0) / N; let n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = [x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy]; if (pointInPoly(p, A) && pointInPoly(p, B)) n++; }
  return n * dx * dy / k / k;
}
async function agentCheck(scope){
  if (!P.proj) return {error: "no project"};
  scope = scope === "page" && S.page ? "page" : "all";
  const out = [], acts = [], passed = [], exp = [];
  const F = (lvl, msg, fn, lbl) => { out.push({lvl, msg, a: fn ? acts.push({fn, lbl: lbl || "Show"}) - 1 : -1}); };
  const split = key => { const j = key.lastIndexOf(":"); return [key.slice(0, j), +key.slice(j + 1)]; };
  const show = (key, ids) => async () => { const [f, p] = split(key); if (!await agentGoto(f, p)) return; setSel(ids); setTool("select"); zoomTo(ids); refresh(); };
  const isCnt = i => (cond(i.cond) || {}).type === "count", lp = r => [r.x + r.w / 2, r.y - r.h / 2];
  const keys = (scope === "page" ? [S.key] : [...new Set(P.proj.items.map(i => keyOf(i.file, i.page)).concat(S.page ? [S.key] : []))]).filter(k2 => P.proj.files.some(x => x.id === split(k2)[0]));
  try {
    for (const [n, key] of keys.entries()) {
      busy(`✅ Checking ${keyName(key)}${keys.length > 1 ? ` (${n + 1} of ${keys.length})` : ""}…`);
      const [f, p] = split(key), pn = esc(keyName(key)), its = P.proj.items.filter(i => i.file === f && i.page === p), Fa = await drawingFacts(f, p);
      const areas = its.filter(i => i.kind === "shape" && (cond(i.cond) || {}).type === "area");
      if (Fa.rooms.length && (areas.length || key === S.key)) {   // rooms written on the drawing, not measured
        const miss = Fa.rooms.filter(r => !areas.some(i => pointInPoly(lp(r), itemPoly(i))));
        if (miss.length) F("warn", `${pn}: <b>${miss.length}</b> of ${Fa.rooms.length} rooms written on the drawing not measured — ${miss.slice(0, 12).map(r => esc(r.name)).join(", ")}${miss.length > 12 ? " …" : ""}`, async () => { if (await agentGoto(f, p)) { const rc = roomCondOf(); if (rc) S.cond = rc; await agentMeasure("", miss); } }, "🏠 Measure them");   // into the condition holding the page's other rooms
        else passed.push(`${pn}: all ${Fa.rooms.length} rooms written on the drawing are measured`);
      }
      let sz = 0, szBad = 0;   // measured against the size written in the room
      areas.forEach(i => { const k = itemScale(i); if (!k || !String(i.label || "").trim()) return; const pl = itemPoly(i), inn = Fa.rooms.filter(r => pointInPoly(lp(r), pl)); if (inn.length !== 1 || !inn[0].sft) return;
        sz++; const a = polyArea(pl) / k / k, w = inn[0].sft, e = (a - w) / w;
        if (Math.abs(e) > 0.05) { szBad++; F("warn", `${pn} — <b>${esc(i.label)}</b>: measured ${fq(a)} Sft, written ${esc(inn[0].size)} = ${fq(w)} Sft (${e > 0 ? "+" : ""}${(100 * e).toFixed(1)} %) — look at the outline; a written size is often the main rectangle only`, show(key, [i.id])); } });
      if (sz && !szBad) passed.push(`${pn}: ${sz} room${sz > 1 ? "s" : ""} within 5 % of the size written in ${sz > 1 ? "them" : "it"}`);
      const byC = new Map(); areas.forEach(i => { if (!byC.has(i.cond)) byC.set(i.cond, []); byC.get(i.cond).push(i); });
      let ov = 0;   // the same floor measured twice: two outlines of one condition overlapping
      byC.forEach((L, cid) => { for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) { const k = itemScale(L[a]); if (!k) continue;
        const A = itemPoly(L[a]), B = itemPoly(L[b]), x = overlapSft(A, B, k); if (!(x > 1 && x > 0.02 * Math.min(polyArea(A), polyArea(B)) / k / k)) continue;
        ov++; F("err", `${pn} — ${esc(cond(cid).name)}: <b>${esc(L[a].label || "an area")}</b> and <b>${esc(L[b].label || "an area")}</b> overlap by about ${fq(x)} Sft — measured twice?`, show(key, [L[a].id, L[b].id])); } });
      if (areas.length > 1 && !ov) passed.push(`${pn}: no two areas of one condition overlap`);
      const cm = new Map(); its.filter(isCnt).forEach(i => i.pts.forEach(pt => { if (!cm.has(i.cond)) cm.set(i.cond, []); cm.get(i.cond).push({pt, id: i.id}); }));
      cm.forEach((L, cid) => {   // a count marker on top of another: counted twice
        const k = scaleAt(f, p, L[0].pt), tl = k ? 0.5 * k : 4, ids = new Set(); let dup = 0; L.sort((a, b) => a.pt[0] - b.pt[0]);
        for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length && L[b].pt[0] - L[a].pt[0] <= tl; b++) if (dist(L[a].pt, L[b].pt) <= tl) { dup++; ids.add(L[a].id); ids.add(L[b].id); }
        if (dup) F("err", `${pn} — <b>${esc(cond(cid).name)}</b>: ${dup} marker${dup > 1 ? "s" : ""} on top of another (within 6") — counted twice?`, show(key, [...ids])); });
      const tags = Object.entries(Fa.tags);
      if (tags.length && (its.length || key === S.key)) {   // door / window tags on the drawing against what is counted
        const cntOf = nm => its.filter(i => isCnt(i) && cond(i.cond).name.toUpperCase() === nm.toUpperCase()).reduce((a, i) => a + i.pts.length, 0), fam = {}, notC = [], diff = [];
        tags.forEach(([m, pts]) => { fam[tagKind(m)] = (fam[tagKind(m)] || 0) + pts.length; const c1 = cntOf(m); if (c1) { if (c1 !== pts.length) diff.push(`${esc(m)}: ${c1} counted, ${pts.length} on the drawing`); } else if (!cntOf(tagKind(m))) notC.push(`${esc(m)} ×${pts.length}`); });
        Object.entries(fam).forEach(([kd, n2]) => { const c2 = cntOf(kd); if (c2 && c2 !== n2) diff.push(`${esc(kd)}: ${c2} counted, ${n2} tags on the drawing`); });
        if (notC.length) F("warn", `${pn}: door / window tags not counted — ${notC.join(" · ")}`, async () => { if (await agentGoto(f, p)) await agentCount("", "page"); }, "🚪 Count them");
        if (diff.length) F("warn", `${pn}: counts differ from the tags on the drawing — ${diff.join(" · ")}`, show(key, its.filter(isCnt).map(i => i.id)));
        if (!notC.length && !diff.length) passed.push(`${pn}: every door / window tag on the drawing is counted (${tags.reduce((a, t2) => a + t2[1].length, 0)})`);
      }
      const un = areas.filter(i => !String(i.label || "").trim());
      if (un.length && Fa.rooms.length) F("info", `${pn}: ${un.length} area${un.length > 1 ? "s" : ""} with no name — name ${un.length > 1 ? "them" : "it"} (✎) so the room schedule and the finishes match`, show(key, un.map(i => i.id)));
    }
    const sp = scope === "page" ? [split(S.key)] : allPages().map(o => [o.f.id, o.i]), sched = {};   // the drawings' door / window schedules
    for (const [n, [f, p]] of sp.entries()) { if (sp.length > 3) busy(`✅ Reading schedules — page ${n + 1} of ${sp.length}…`); Object.entries(tagsOf(await pageTexts(f, p)).sched).forEach(([m, s]) => { sched[m] = Object.assign({at: keyOf(f, p)}, s); }); }
    let schOk = 0;
    Object.keys(sched).sort(natSort).forEach(m => { const s = sched[m], c = P.proj.conds.find(x => x.type === "count" && x.name.toUpperCase() === m), n2 = c ? condTotals(c).net : 0;
      if (s.qty && c) { if (n2 !== s.qty) F("warn", `<b>${esc(m)}</b>: the schedule (${esc(keyName(s.at))}) says <b>${s.qty}</b> Nos, <b>${fq(n2, "Nos")}</b> counted in the project`, null); else schOk++; }
      const o = (P.proj.openings || []).find(x => String(x.mark).toUpperCase() === m);
      if (o && (Math.abs(o.w - s.w) > 0.01 || Math.abs(o.h - s.h) > 0.01)) F("warn", `<b>${esc(m)}</b>: the opening schedule has ${f3(o.w)} × ${f3(o.h)} ft, the drawing's schedule (${esc(keyName(s.at))}) ${f3(s.w)} × ${f3(s.h)} ft — a revised size?`, () => openingsDialog(), "Opening schedule"); });
    if (schOk) passed.push(`${schOk} mark${schOk > 1 ? "s" : ""} counted exactly as the schedule's quantity`);
    P.proj.conds.forEach(c => { if (c.type === "linear" && c.unit === "ft" && +c.t >= 0.3 && P.proj.items.some(i => i.cond === c.id))
      F("info", `<b>${esc(c.name)}</b>: ${f3(condTotals(c).net)} ft of length only — give it the wall height H and the unit cft (✎) for the volume`, () => editCond(c), "✎ Edit"); });
    const rv = P.proj.items.filter(needsReview);
    if (rv.length) F("info", `${rv.length} measurement${rv.length > 1 ? "s" : ""} made by the agents or copied, not yet checked — look ${rv.length > 1 ? "them" : "it"} over, then ✓ Check this page`, () => { S.qaFilter = "review"; S.rHide = false; setPanels(); refresh(); }, "Show on the sheet");
    else if (P.proj.items.length) passed.push("every agent / copied measurement has been checked");
    validation().L.filter(x => !/AI-generated|typical-floor cop/.test(x.msg)).forEach(x => { if (x.lvl === "ERROR") F("err", esc(x.msg), null); else exp.push(esc(x.msg)); });   // the export check: its errors here, its notes (BOQ codes, rates, floors) folded below
  } finally { busy(""); }
  const cnt = l => out.filter(x => x.lvl === l).length, ic = {err: "❌", warn: "⚠️", info: "ℹ️"};
  const d = aiLog("bot", `<b>✅ Takeoff check</b> — ${scope === "page" ? esc(keyName(S.key)) : `the project (${keys.length} page${keys.length === 1 ? "" : "s"} with measurements)`}: <b style="color:var(--red)">${cnt("err")}</b> to fix · <b style="color:#8a5a00">${cnt("warn")}</b> to look at · ${cnt("info")} note${cnt("info") === 1 ? "" : "s"} · <span style="color:var(--green)">${passed.length} passed</span>
    ${["err", "warn", "info"].map(l => out.filter(x => x.lvl === l).map(x => `<div style="margin-top:5px">${ic[l]} ${x.msg}${x.a >= 0 ? ` <button class="btn sm" data-ca="${x.a}">${esc(acts[x.a].lbl)}</button>` : ""}</div>`).join("")).join("")}
    ${!out.length ? '<div style="margin-top:6px;color:var(--green)"><b>Nothing to fix.</b></div>' : ""}
    ${exp.length ? `<details style="margin-top:6px"><summary class="small">Before export — ${exp.length} note${exp.length === 1 ? "" : "s"} (BOQ codes, rates, floors)</summary>${exp.map(x => `<div class="small">• ${x}</div>`).join("")}</details>` : ""}
    ${passed.length ? `<details style="margin-top:6px"><summary class="small">✓ ${passed.length} passed</summary>${passed.map(x => `<div class="small">✓ ${x}</div>`).join("")}</details>` : ""}`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-ca]"); if (b) acts[+b.dataset.ca].fn(); });
  return {errors: cnt("err"), warnings: cnt("warn"), notes: cnt("info"), exportNotes: exp.length, passed: passed.length, findings: out.map(x => ({lvl: x.lvl, text: x.msg.replace(/<[^>]+>/g, "")}))};
}

/* instant answers from the takeoff itself — "how many D1", "how many doors", "total floor area", "total bedroom area":
   nothing is measured or changed */
function agentAnswer(t){
  if (!P.proj) return {answer: []};
  const q0 = String(t).replace(/^\s*(how\s+(many|much)|total|sum(\s+of)?|what(?:'s|\s+is)\s+the\s+(?:total|number)(\s+of)?)\s*/i, "").replace(/\?/g, " "), area = /\b(area|sft|sq)/i.test(q0);
  const q = q0.replace(/\b(are|is|there|do|we|have|in|on|the|this|page|project|of|total|areas?|qty|quantity|measured|counted|please|sft|sq\.?\s*ft|all|every|nos)\b/gi, " ").replace(/\s+/g, " ").trim();
  const used = P.proj.conds.filter(c => P.proj.items.some(i => i.cond === c.id));
  const pageQ = c => P.proj.items.filter(i => i.cond === c.id && onPage(i)).reduce((a, it) => { const k = itemScale(it); return k ? a + rowsOf(it, k).reduce((s2, r) => s2 + r.qty, 0) : a; }, 0);
  const line = c => `<b>${esc(c.name)}</b>: <b>${fq(condTotals(c).net, c.unit)} ${esc(c.unit)}</b>${S.page ? ` <span class="small">(this page ${fq(pageQ(c), c.unit)})</span>` : ""}`;
  const ans = L => L.map(c => ({name: c.name, qty: +condTotals(c).net.toFixed(3), unit: c.unit}));
  if (!q) { const L = used.filter(c => !area || c.type === "area"); aiLog("bot", L.length ? L.map(line).join("<br>") : "Nothing is measured yet."); return {answer: ans(L)}; }
  const tg = tagParse(q.replace(/\s+/g, "")), fam = /^doors?$/i.test(q) ? "Doors" : /^windows?$/i.test(q) ? "Windows" : /^vent/i.test(q) ? "Ventilators" : null, ws = q.split(" ");
  let L = tg ? used.filter(c => c.type === "count" && c.name.toUpperCase() === tg.k)
    : fam ? used.filter(c => c.type === "count" && ((tagParse(c.name) && tagKind(tagParse(c.name).k) === fam) || new RegExp("^" + fam.replace(/s$/, ""), "i").test(c.name)))
    : used.filter(c => (!area || c.type === "area") && ws.every(w => nameLike(c.name, w)));
  const rooms = !tg && !fam && !L.length ? P.proj.items.filter(i => isRoomArea(i) && ws.every(w => nameLike(i.label, w))) : [];
  if (L.length) {
    const marks = fam ? L.filter(c => tagParse(c.name)) : [];
    aiLog("bot", L.map(line).join("<br>") + (marks.length > 1 ? `<br>${esc(fam.replace(/s$/, ""))} marks together: <b>${fq(marks.reduce((a, c) => a + condTotals(c).net, 0), "Nos")} Nos</b>` : ""));
    return {answer: ans(L)};
  }
  if (rooms.length) {
    const qa = it => { const k = itemScale(it); return k ? rowsOf(it, k).reduce((a, r) => a + r.qty, 0) : 0; }, tot = rooms.reduce((a, i) => a + qa(i), 0);
    aiLog("bot", `Rooms named like “${esc(q)}”: <b>${rooms.length}</b> — <b>${fq(tot)} Sft</b><br><span class="small">${rooms.map(i => esc(i.label) + " " + fq(qa(i))).join(" · ")}</span>`);
    return {answer: [{name: q, qty: +tot.toFixed(3), unit: "Sft", rooms: rooms.length}]};
  }
  const onDwg = tg && S.page ? ((tagsOf(S.texts[S.key] || []).plan[tg.k]) || []).length : 0;
  const d = aiLog("bot", `Nothing measured matches “${esc(q)}” yet${onDwg ? ` — this page's drawing has <b>${onDwg}</b> ${esc(tg.k)} tag${onDwg > 1 ? "s" : ""}` : ""}. <button class="btn sm" data-aa="count ${esc(tg ? tg.k : q)}">Count ${esc(tg ? tg.k : q)}</button>${tg ? "" : ` <button class="btn sm" data-aa="measure ${esc(q)}">Measure ${esc(q)}</button>`}`);
  d.addEventListener("click", e => { const b = e.target.closest("[data-aa]"); if (b) agentCmd(b.dataset.aa); });
  return {answer: [], on_drawing: onDwg};
}

/* side panels: drag the inner edge to resize, ⟨ ⟩ to hide; sizes kept per browser */
function setPanels(){
  const app = $("app"), sw = document.querySelector(".app > .stagewrap"), rp = document.querySelector(".app > aside.panel.right"), wide = window.innerWidth > 860;
  sw.style.gridColumn = wide ? "2" : ""; rp.style.gridColumn = wide ? "3" : "";   // a hidden panel must not pull the drawing into its column
  document.querySelector(".app > aside.panel:not(.right)").style.display = S.lHide ? "none" : "";
  rp.style.display = S.rHide ? "none" : "";
  $("openL").style.display = S.lHide ? "" : "none"; $("openR").style.display = S.rHide ? "" : "none";
  const lw = S.lHide ? 0 : S.lw, rw = S.rHide ? 0 : S.rw;
  app.style.gridTemplateColumns = wide ? `${lw}px minmax(0,1fr) ${rw}px` : "";
  pref("zdTakeoffPanels", JSON.stringify({lw: S.lw, rw: S.rw, lHide: !!S.lHide, rHide: !!S.rHide}));
  if (S.page) { applyView(); renderHi(); }
}
function wirePanels(){
  try { Object.assign(S, {lw: 250, rw: 420}, JSON.parse(pref("zdTakeoffPanels") || "{}")); } catch (e) { S.lw = 250; S.rw = 420; }
  const drag = (el, side) => el.addEventListener("pointerdown", e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = side === "l" ? S.lw : S.rw;
    const mv = ev => { const d = ev.clientX - x0; if (side === "l") S.lw = Math.max(160, Math.min(520, w0 + d)); else S.rw = Math.max(260, Math.min(820, w0 - d)); setPanels(); };
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); });
  drag($("rzL"), "l"); drag($("rzR"), "r");
  $("hideL").onclick = () => { S.lHide = true; setPanels(); }; $("hideR").onclick = () => { S.rHide = true; setPanels(); };
  $("openL").onclick = () => { S.lHide = false; setPanels(); }; $("openR").onclick = () => { S.rHide = false; setPanels(); };
  window.addEventListener("resize", () => setPanels());
  setPanels();
}
function pref(k, v){ try { if (v === undefined) return localStorage.getItem(k); if (v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
const DEFAULTS_KEY = "zdTakeoffDefaults";
const DEFAULTS = {condColor: "#2a78d6", condWidth: 2, markColor: "#d03b3b", markWidth: 2, dimColor: "#2b78d6", dimWidth: 2, dimSize: 13, dimArrow: 10, dimOffset: 24, hiliteColor: "#ffe14d", hiliteOpacity: .38};
function toolDefaults(){ let o = null; try { o = JSON.parse(pref(DEFAULTS_KEY) || "null"); } catch (e) {} return Object.assign({}, DEFAULTS, o && typeof o === "object" ? o : {}); }
function saveToolDefaults(o){ pref(DEFAULTS_KEY, JSON.stringify(Object.assign({}, DEFAULTS, o))); }
const CHEST_KEY = "zdTakeoffToolChest";
const MARK_PROFILE_TYPES = ["note", "cloud", "arrow", "dimension", "hilite", "text", "callout", "line", "polyline", "polygon", "box", "ellipse", "pen", "hpen", "stamp", "redact", "erase"];
function starterToolProfiles(){
  const d = Object.assign({}, DEFAULTS);
  const mk = (name, type, props, favorite) => ({id: uid("TC"), name, kind: "markup", type, props, favorite: !!favorite, created: new Date().toISOString()});
  return [mk("Dimension — standard", "dimension", {color: d.dimColor, width: d.dimWidth, size: d.dimSize, arrow: d.dimArrow, offset: d.dimOffset}, true),
    mk("Review arrow — red", "arrow", {color: "#d03b3b", width: 2}, true),
    mk("Revision cloud — red", "cloud", {color: "#d03b3b", width: 2}, false),
    mk("Highlight — yellow", "hilite", {color: d.hiliteColor, opacity: d.hiliteOpacity}, true),
    {id: uid("TC"), name: "Floor area — Sft", kind: "condition", favorite: true, created: new Date().toISOString(), condition: {type: "area", unit: "Sft", color: d.condColor, sw: d.condWidth, faces: 1, dedMin: 0}},
    {id: uid("TC"), name: "Count — standard", kind: "condition", favorite: false, created: new Date().toISOString(), condition: {type: "count", unit: "Nos", color: "#1e8e5a", sw: 2, faces: 1, dedMin: 0, sym: "circle", cap: "seq", sz: "m"}}];
}
function normalizeChestProfile(p){
  if (!p || typeof p !== "object" || typeof p.name !== "string") return null;
  const name = p.name.trim().slice(0, 60); if (!name) return null;
  const color = (x, fallback) => /^#[0-9a-f]{6}$/i.test(String(x || "")) ? String(x) : fallback;
  const num = (x, d, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+x) ? +x : d));
  const common = {id: String(p.id || uid("TC")), name, favorite: !!p.favorite, created: String(p.created || new Date().toISOString())};
  if (p.kind === "markup" && MK_STYLE0[p.type] && MARK_PROFILE_TYPES.includes(p.type)) {   // the Bluebeam markup tools: their style (and a stamp's choice)
    const props = mkClean(p.props), st = p.props && p.props.stamp;
    if (p.type === "stamp" && st && typeof st.label === "string") props.stamp = {label: st.label.slice(0, 80), color: HEXCOL.test(st.color) ? st.color : "#1e8e5a", tpl: String(st.tpl || "").slice(0, 120)};
    return Object.assign(common, {kind: "markup", type: p.type, props});
  }
  if (p.kind === "markup" && MARK_PROFILE_TYPES.includes(p.type)) {
    const q = p.props || {}, d = toolDefaults();
    const props = {color: color(q.color, p.type === "dimension" ? d.dimColor : p.type === "hilite" ? d.hiliteColor : d.markColor), width: num(q.width, d.markWidth, 1, 12)};
    if (p.type === "dimension") Object.assign(props, {width: num(q.width, d.dimWidth, 1, 12), size: num(q.size, d.dimSize, 8, 48), arrow: num(q.arrow, d.dimArrow, 5, 40), offset: num(q.offset, d.dimOffset, 0, 500)});
    if (p.type === "hilite") props.opacity = num(q.opacity, d.hiliteOpacity, .05, 1);
    return Object.assign(common, {kind: "markup", type: p.type, props});
  }
  if (p.kind === "condition") {
    const q = p.condition || {}, type = ["area", "linear", "count"].includes(q.type) ? q.type : "area", units = UNITS[type], unit = units.includes(q.unit) ? q.unit : units[0];
    const condition = {type, unit, color: color(q.color, toolDefaults().condColor), sw: num(q.sw, toolDefaults().condWidth, 1, 12), h: q.h === "" ? "" : num(q.h, 0, 0, 9999), t: q.t === "" ? "" : num(q.t, 0, 0, 9999), faces: Math.round(num(q.faces, 1, 1, 2)), dedMin: num(q.dedMin, 0, 0, 9999)};
    if (type === "count") { condition.sym = ["check", "circle", "square", "triangle", "diamond", "cross", "dot"].includes(q.sym) ? q.sym : "circle"; condition.cap = ["seq", "name", "text", "none"].includes(q.cap) ? q.cap : "seq"; condition.capText = String(q.capText || "").slice(0, 40); condition.sz = ["s", "m", "l"].includes(q.sz) ? q.sz : "m"; }
    return Object.assign(common, {kind: "condition", condition});
  }
  if (p.kind === "defaults") {
    const q = p.settings || {}, d = toolDefaults(), settings = Object.assign({}, d);
    ["condColor", "markColor", "dimColor", "hiliteColor"].forEach(k => settings[k] = color(q[k], d[k]));
    ["condWidth", "markWidth", "dimWidth"].forEach(k => settings[k] = num(q[k], d[k], 1, 12));
    settings.dimSize = num(q.dimSize, d.dimSize, 8, 48); settings.dimArrow = num(q.dimArrow, d.dimArrow, 5, 40); settings.dimOffset = num(q.dimOffset, d.dimOffset, 0, 500); settings.hiliteOpacity = num(q.hiliteOpacity, d.hiliteOpacity, .05, 1);
    return Object.assign(common, {kind: "defaults", settings});
  }
  return null;
}
function toolChestProfiles(){
  let raw = pref(CHEST_KEY), list = null;
  if (raw == null) { list = starterToolProfiles(); pref(CHEST_KEY, JSON.stringify(list)); }
  else { try { list = JSON.parse(raw); } catch (e) { list = []; } if (!Array.isArray(list)) list = []; list = list.map(normalizeChestProfile).filter(Boolean); }
  return list;
}
function storeToolChestProfiles(list){ pref(CHEST_KEY, JSON.stringify((list || []).map(normalizeChestProfile).filter(Boolean))); }
function chestConditionSnapshot(c){ return {type: c.type, unit: c.unit, color: c.color, sw: +c.sw || 2, h: c.h || "", t: c.t || "", faces: +c.faces || 1, dedMin: +c.dedMin || 0, sym: c.sym || "circle", cap: c.cap || "seq", capText: c.capText || "", sz: c.sz || "m"}; }
function captureChestProfile(o, name){
  const d = toolDefaults(), n = String(name || "My tool").trim().slice(0, 60) || "My tool";
  if (o && MK_TYPES.has(o.type)) { const props = mkStyleOf(o); if (o.type === "stamp" && o.stamp) props.stamp = {label: o.stamp.label, color: o.color || "#1e8e5a", tpl: S.stampSel && S.stampSel.label === o.stamp.label ? S.stampSel.tpl || "" : STAMP_TPL};
    return {id: uid("TC"), name: n, kind: "markup", type: mkKindOf(o), props, favorite: false, created: new Date().toISOString()}; }
  if (o && MARK_PROFILE_TYPES.includes(o.type)) {
    const props = {color: o.color || d.markColor, width: +o.width || d.markWidth};
    if (o.type === "dimension") Object.assign(props, {color: o.color || d.dimColor, width: +o.width || d.dimWidth, size: +o.size || d.dimSize, arrow: +o.arrow || d.dimArrow, offset: +o.offset || d.dimOffset});
    if (o.type === "hilite") Object.assign(props, {color: o.color || d.hiliteColor, opacity: +o.opacity || d.hiliteOpacity});
    return {id: uid("TC"), name: n, kind: "markup", type: o.type, props, favorite: false, created: new Date().toISOString()};
  }
  const c = o && o.cond ? cond(o.cond) : null;
  if (c) return {id: uid("TC"), name: n, kind: "condition", condition: chestConditionSnapshot(c), favorite: false, created: new Date().toISOString()};
  return {id: uid("TC"), name: n, kind: "defaults", settings: d, favorite: false, created: new Date().toISOString()};
}
function applyChestProfile(p){
  if (p.kind === "defaults") { saveToolDefaults(Object.assign(toolDefaults(), p.settings || {})); toast("Applied profile: " + p.name, 2200); return; }
  if (p.kind === "markup" && MK_STYLE0[p.type]) {
    const q = Object.assign({}, p.props || {}), st = q.stamp; delete q.stamp; saveMkStyle(p.type, q);
    if (st) { S.stampSel = {label: st.label, color: st.color, tpl: st.tpl || ""}; S.stampNoPick = true; }
    setTool("mk_" + p.type); S.stampNoPick = false; toast("Tool Chest: " + p.name + " — " + (MK_HINTS["mk_" + p.type] || "click the drawing"), 3500); return;
  }
  if (p.kind === "markup") {
    const d = toolDefaults(), q = p.props || {};
    if (p.type === "dimension") Object.assign(d, {dimColor: q.color || d.dimColor, dimWidth: +q.width || d.dimWidth, dimSize: +q.size || d.dimSize, dimArrow: +q.arrow || d.dimArrow, dimOffset: +q.offset || d.dimOffset});
    else if (p.type === "hilite") Object.assign(d, {hiliteColor: q.color || d.hiliteColor, hiliteOpacity: +q.opacity || d.hiliteOpacity});
    else Object.assign(d, {markColor: q.color || d.markColor, markWidth: +q.width || d.markWidth});
    saveToolDefaults(d); setTool(p.type); toast("Tool Chest: " + p.name + " — click the drawing to place", 3000); return;
  }
  if (!P.proj) return toast("Open a project before using a measurement profile");
  const c = Object.assign({id: uid("C"), name: p.name, hidden: false}, JSON.parse(JSON.stringify(p.condition || {})));
  c.id = uid("C"); c.name = p.name; c.color = /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : toolDefaults().condColor;
  mutate(() => { P.proj.conds.push(c); }, "Add condition from Tool Chest");
  S.cond = c.id; setTool(c.type === "count" ? "count" : "draw"); refresh(); toast("Condition profile ready: " + p.name, 2500);
}
function exportToolChest(){
  const data = {format: "zd-takeoff-tool-chest", version: 1, exported: new Date().toISOString(), profiles: toolChestProfiles()};
  saveBlob(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}), "ZD_Takeoff_Tool_Chest.json");
}
async function importToolChest(file){
  try {
    const d = JSON.parse(await file.text()); if (!d || d.format !== "zd-takeoff-tool-chest" || !Array.isArray(d.profiles)) throw new Error("Not a ZD Takeoff Tool Chest file");
    const list = toolChestProfiles();
    d.profiles.forEach(p => { const n = normalizeChestProfile(Object.assign({}, p, {id: uid("TC")})); if (n) list.push(n); });
    storeToolChestProfiles(list); toast("Imported " + d.profiles.length + " Tool Chest profile" + (d.profiles.length === 1 ? "" : "s"), 3000); toolChestDialog();
  } catch (e) { toast("Tool Chest import failed: " + (e.message || e), 5000); }
}
function chestProfileSummary(p){
  const q = p.props || {}, c = p.condition || {};
  if (p.kind === "markup" && MK_STYLE0[p.type]) return (MK_TOOL_NAMES["mk_" + p.type] || p.type) + (q.stamp ? " · " + q.stamp.label : "") + (q.color ? " · " + q.color : "") + (q.width != null ? " · " + q.width + "px" : "") + (q.fill ? " · fill " + q.fill : "") + (q.hatch ? " · " + (HATCHES[q.hatch.p] || "hatch") : "") + (q.fs ? " · " + q.fs + " pt text" : "");
  if (p.kind === "markup") return p.type === "dimension" ? `Dimension · ${q.color || ""} · ${q.width || 2}px · text ${q.size || 13}px · arrow ${q.arrow || 10}px` : p.type === "hilite" ? `Highlight · ${q.color || ""} · opacity ${q.opacity || .38}` : `${MARK_TOOLS[p.type]} · ${q.color || ""} · ${q.width || 2}px`;
  if (p.kind === "condition") return `${({area: "Area", linear: "Length", count: "Count"})[c.type] || "Measurement"} · ${c.unit || ""} · ${c.color || ""}${c.h ? " · H " + c.h + " ft" : ""}${c.t ? " · T " + c.t + " ft" : ""}`;
  return "Reusable color, line-weight and markup settings";
}
function toolChestDialog(options){
  options = options || {};
  const selected = options.object || (S.selMark && P.proj ? (P.proj.marks || []).find(m => m.id === S.selMark) : null) || (S.sel && P.proj ? P.proj.items.find(i => i.id === S.sel) : null);
  const suggested = selected && selected.type ? MARK_TOOLS[selected.type] : selected && selected.cond ? (cond(selected.cond) || {}).name : "My professional defaults";
  const body = `<p class="small">Reusable profiles save appearance and measurement settings, not the exact drawing geometry. Choose a profile to activate its tool with those properties. Favorites stay at the top. Your chest is saved in this browser; export JSON to share or back it up.</p>
    <div class="tcbar"><input type="text" id="tcName" value="${esc(options.name || suggested || "My tool")}" maxlength="60" aria-label="New profile name" placeholder="Profile name"><button class="btn sm pri" type="button" data-tc="save">＋ Save selected / current style</button><button class="btn sm" type="button" data-tc="export">Export JSON</button><label class="btn sm" for="tcImport">Import JSON</label><input id="tcImport" type="file" accept=".json,application/json" hidden></div>
    <input type="search" id="tcSearch" placeholder="Search tools and profiles…" aria-label="Search Tool Chest" style="width:100%;margin:3px 0 8px"><div class="tcgrid" id="tcList"></div><div class="tcfoot small"><span id="tcCount"></span><span>Apply = Properties mode · geometry is drawn fresh</span></div>`;
  const p = ask("Tool Chest", body, "Done", () => true);
  const B = $("dlgB");
  const render = () => {
    if (!$("tcList")) return;
    const query = $("tcSearch").value.trim().toLowerCase();
    const L = toolChestProfiles().slice().sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name)).filter(x => !query || (x.name + " " + chestProfileSummary(x)).toLowerCase().includes(query));
    $("tcList").innerHTML = L.length ? L.map(x => `<article class="tccard${x.favorite ? " fav" : ""}" data-tcid="${esc(x.id)}"><div class="tctop"><span class="tcname" title="${esc(x.name)}">${esc(x.name)}</span><button class="tcstar${x.favorite ? " on" : ""}" data-tc="fav" data-id="${esc(x.id)}" title="${x.favorite ? "Remove favorite" : "Add favorite"}">${x.favorite ? "★" : "☆"}</button></div><div class="tcmeta">${esc(chestProfileSummary(x))}</div><input class="tcnameedit" data-tc-name value="${esc(x.name)}" aria-label="Rename ${esc(x.name)}"><div class="tcactions"><button class="btn sm pri" data-tc="use" data-id="${esc(x.id)}">Use tool</button><button class="btn sm" data-tc="rename" data-id="${esc(x.id)}">Rename</button><button class="btn sm dng" data-tc="delete" data-id="${esc(x.id)}">Delete</button></div></article>`).join("") : '<div class="empty">No profiles match. Save a selected markup or condition, or save current defaults.</div>';
    $("tcCount").textContent = L.length + " profile" + (L.length === 1 ? "" : "s") + " · " + L.filter(x => x.favorite).length + " favorites";
  };
  render();
  B.oninput = e => { if (e.target.id === "tcSearch") render(); };
  B.onchange = e => { if (e.target.id === "tcImport" && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ""; importToolChest(f); } };
  B.onclick = e => {
    const b = e.target.closest("[data-tc]"); if (!b) return;
    const act = b.dataset.tc, id = b.dataset.id, list = toolChestProfiles();
    if (act === "save") {
      const name = $("tcName").value.trim(); if (!name) return toast("Enter a profile name", 2200);
      list.push(captureChestProfile(selected, name)); storeToolChestProfiles(list); render(); toast("Saved to Tool Chest: " + name, 2300); return;
    }
    if (act === "export") { exportToolChest(); return; }
    const profile = list.find(x => x.id === id); if (!profile) return;
    if (act === "fav") { profile.favorite = !profile.favorite; storeToolChestProfiles(list); render(); return; }
    if (act === "rename") { const n = b.closest(".tccard").querySelector("[data-tc-name]").value.trim(); if (!n) return toast("Profile name cannot be blank", 2200); profile.name = n.slice(0, 60); storeToolChestProfiles(list); render(); return; }
    if (act === "delete") { if (!confirm("Delete Tool Chest profile ‘" + profile.name + "’?")) return; storeToolChestProfiles(list.filter(x => x.id !== id)); render(); return; }
    if (act === "use") { applyChestProfile(profile); $("dlgCancel").click(); }
  };
  return p;
}

function setDim(on){   // on = true/false, or a dimming level 0-90 %
  if (typeof on === "number") S.dimPct = Math.max(0, Math.min(90, on)); else if (on && !S.dimPct) S.dimPct = 50;
  S.dim = typeof on === "number" ? on > 0 : on;
  const d = S.dim ? S.dimPct / 100 : 0, c = 1 - d, b = 1 / (0.5 + 0.5 * c);
  stage().style.setProperty("--dimf", d ? `contrast(${c.toFixed(3)}) brightness(${b.toFixed(3)})` : "none");
  $("bDim").classList.toggle("on", S.dim); $("dimPct").value = S.dimPct || 50; $("dimLbl").textContent = (S.dim ? S.dimPct : 0) + "%";
  pref("zdTakeoffDim", S.dim ? String(S.dimPct) : "0"); viewMark();
}
function setThin(on){ S.thin = on; $("bLw").classList.toggle("on", !on); $("bLw").title = on ? "Line weights are off — click to show them" : "Line weights are on — click to draw every line thin"; pref("zdTakeoffThin", on ? "1" : "0"); viewMark(); if (S.page) { renderLow(); renderHi(true); } }

/* ------------------------------------------------------------------ AutoCAD drawings (DWG / DXF) — cad.js
   A drawing added with + PDF is read in this browser and kept as a layered vector PDF — so snapping, auto area, find, the
   agents and the exports work on it as on any PDF — together with the drawing itself and its scene. The scene is what the
   screen shows: drawn straight onto the canvas, only what is on screen, so zoom and pan are as quick as AutoCAD's, on its
   black model space with its colours (View → Background), or monochrome. Its scale comes from the drawing's units. */
const isCadFile = f => /\.(dwg|dxf)$/i.test(f && f.name || "");
async function cadMod(){
  if (!CAD) { try { CAD = await import("./cad.js" + CADV); } catch (e) { throw new Error("the AutoCAD reader (cad.js) could not be loaded — " + (e.message || e)); } }
  return CAD;
}
const cadMeta = fid => { const f = P.proj && P.proj.files.find(x => x.id === fid); return f && f.cad || null; };
const cadPage = () => { const sc = CAD && S.cadSc && S.cadSc[S.fileId]; return sc && S.pageNo === 1 ? sc.pages[0] : null; };
const cadOn = () => !!(cadPage() && !S.cmp);
/* a CAD file's scene: kept in this browser with the drawing; read again from the DWG when the reader has moved on — onto
   exactly the page it was given the first time, so the measurements stay where they are */
function cadLoad(fid){
  S.cadSc = S.cadSc || {}; S.cadP = S.cadP || {};
  if (S.cadSc[fid] !== undefined) return Promise.resolve(S.cadSc[fid]);
  if (S.cadP[fid]) return S.cadP[fid];
  const meta = cadMeta(fid); if (!meta) return Promise.resolve(null);
  return S.cadP[fid] = (async () => {
    const C = await cadMod(), rec = await dbGet("pdfs", fid); let sc = null;
    if (rec && rec.scene && rec.scene.ver === C.CAD_VER) sc = rec.scene;
    else if (rec && rec.src) {
      try { const r = await cadWorker(rec.src, rec.name || "the drawing", meta.map);
        if (r) sc = r.scene; else { busy("Reading " + (rec.name || "the drawing") + "…"); sc = C.cadScene(await C.cadRead(rec.src, rec.name || ""), {map: meta.map}); }
        rec.scene = sc; await dbPut("pdfs", rec, fid).catch(() => {}); } finally { busy(""); } }
    S.cadSc[fid] = sc; delete S.cadP[fid]; return sc;
  })().catch(e => { S.cadSc[fid] = null; delete S.cadP[fid]; toast("Shown from its PDF — the drawing's objects could not be read here (" + (e.message || e) + ")", 6000); return null; });
}
/* a DWG / DXF read off the page's thread, in a worker (cad-worker.js): the page stays responsive while a big drawing is read, and
   the reader's memory goes with the worker. Resolves {scene, pdf}, or null when this browser cannot start the worker (then it is
   read here) */
const PDFLIB_ESM = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js";
function cadWorker(buf, name, map){
  return new Promise((ok, bad) => {
    let w; try { w = new Worker(new URL("./cad-worker.js" + CADV, import.meta.url), {type: "module"}); } catch (e) { return ok(null); }
    const t0 = Date.now(), first = !S.cadRead, label = {load: "Loading the AutoCAD reader…", read: "Reading " + name + (first ? " — the first drawing loads the reader (about 10 MB, once)" : "") + "…",
      scene: "Drawing " + name + "…", pdf: "Writing " + name + " as a layered PDF…"};
    let step = "", started = false, last = Date.now();
    const say = () => busy((label[step] || "Reading " + name + "…") + (Date.now() - t0 > 3000 ? " " + Math.round((Date.now() - t0) / 1000) + " s" : ""));
    const tick = setInterval(() => { say(); if (Date.now() - last > 15 * 60000) { done(); bad(new Error("the reader stopped answering — the drawing may be too big for this browser")); } }, 1000);
    const done = () => { clearInterval(tick); try { w.terminate(); } catch (e) {} };
    w.onmessage = e => { const d = e.data || {}; last = Date.now(); if (d.step) { step = d.step; if (d.step !== "load") started = true; return say(); }
      done(); if (d.ok) { S.cadRead = true; ok(d); } else bad(new Error(d.error || "the drawing could not be read")); };
    w.onerror = e => { done(); if (!started) ok(null); else bad(new Error("the drawing was too big for this browser to read" + (e && e.message ? " (" + e.message + ")" : ""))); };
    say(); const copy = buf.slice(0); w.postMessage({buf: copy, name, map: map || null, pdfLib: PDFLIB_ESM}, [copy]);
  });
}
/* a DWG / DXF file -> the PDF to keep, the drawing itself, its scene and what the project keeps about it */
async function cadImport(f, buf, map){
  const C = await cadMod(); let sc, pdf;
  const r = await cadWorker(buf, f.name, map);
  if (r) { sc = r.scene; pdf = r.pdf.buffer.slice(r.pdf.byteOffset, r.pdf.byteOffset + r.pdf.byteLength); }
  else {   // no worker here: read on this thread
    busy("Reading " + f.name + (S.cadRead ? "…" : " — the first AutoCAD drawing loads the reader (about 10 MB, once)…"));
    const md = await C.cadRead(buf, f.name); S.cadRead = true;
    busy("Drawing " + f.name + "…"); await new Promise(r2 => setTimeout(r2, 0));
    sc = C.cadScene(md, map ? {map} : undefined);
    busy("Writing " + f.name + " as a layered PDF…");
    const bytes = await C.cadPdf(sc, await loadPdfLib(), {title: f.name}); pdf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const pg = sc.pages[0];
  if (!pg.n && !pg.tn) throw new Error("nothing was found in its model space" + (Object.keys(sc.stats.skipped).length ? " (only " + Object.keys(sc.stats.skipped).join(", ") + ")" : "") + " — is the drawing on a layout (paper space)?");
  const st = sc.stats, meta = {fmt: sc.fmt, ver: sc.dver, units: sc.units, unitName: sc.unitName, unitHow: sc.unitHow || "", unitFix: !!sc.unitFix, assumed: sc.assumed, den: pg.den, ptPerFt: pg.ptPerFt, conv: C.CAD_VER, map: pg.map,
    layers: sc.layers.map(l => ({name: l.name, c: l.c, aci: l.aci, off: l.off, frozen: l.frozen, plot: l.plot, lt: l.lt, lw: l.lw})),
    stats: {ents: st.ents, prims: st.prims, texts: st.texts, skipped: st.skipped, missing: Object.keys(st.missing).length, far: st.far, junk: st.junk || 0, trunc: st.trunc}};
  return {pdf, src: buf, scene: sc, meta};
}
function cadAdopt(meta, cad, how){   // a drawing just added: its page's scale from its units; layers off or frozen in the drawing start off
  const key = keyOf(meta.id, 1), m = cad.meta, sc = P.proj.scales[key];
  if (!sc || sc.how === "cad" || how !== "same") P.proj.scales[key] = {ptPerFt: m.ptPerFt, how: "cad", text: "1:" + m.den + " · units " + m.unitName + (m.unitHow ? " (from " + m.unitHow + ")" : ""), verified: !m.assumed && !m.unitFix, at: new Date().toISOString()};
  if (how === "new") { P.proj.layersOff = P.proj.layersOff || {}; P.proj.layersOff[meta.id] = m.layers.filter(l => l.off || l.frozen).map(l => l.name); }
}
function cadSay(name, m){
  const off = m.layers.filter(l => l.off || l.frozen).length, sk = Object.entries(m.stats.skipped || {}).map(([t, n]) => n + " " + t).join(", ");
  return name + " — AutoCAD" + (CAD && CAD.VERS[m.ver] ? " " + CAD.VERS[m.ver] : "") + " model space, 1:" + m.den + " from its units (" + m.unitName + (m.unitHow ? ", read from " + m.unitHow : "") + ")" +
    (m.assumed ? " — ⚠ the drawing has no units set: check the scale (chip → Verify)" : m.unitFix ? " — ⚠ its dimensions disagree with its units setting: check the scale (chip → Verify)" : " — scale exact") +
    " · " + m.layers.length + " layers" + (off ? " (" + off + " off / frozen)" : "") + " · " + (m.stats.ents || 0).toLocaleString() + " objects" +
    (sk ? " · not shown: " + sk : "") + (m.stats.missing ? " · " + m.stats.missing + " block(s) missing (xrefs?)" : "") + (m.stats.far ? " · " + m.stats.far + " far-off object(s) left off the page" : "") + (m.stats.junk ? " · " + m.stats.junk + " damaged object(s) left out" : "") + (m.stats.trunc ? " · ⚠ very large: shown in part" : "");
}
async function cadUnitsCheck(key){   // the drawing's units against the room sizes written on it (drawn in mm, saved as inches…)
  const sc = P.proj && P.proj.scales[key]; if (!sc || sc.how !== "cad" || sc.checked) return; sc.checked = true;
  let ev = null; try { ev = await scaleFromRooms(key); } catch (e) { ev = null; }
  if (!ev || ev.agree < 3) return;
  const r = ev.ptPerFt / sc.ptPerFt; if (Math.abs(Math.log(r)) < Math.log(1.15)) return;
  sc.doubt = {label: "1 ft = " + ev.ptPerFt.toFixed(3) + " pt", ptPerFt: ev.ptPerFt, ratio: +r.toFixed(3), rooms: ev.rooms, agree: ev.agree}; sc.verified = false; save(); refresh();
  toast("⚠ " + keyName(key) + ": the drawing's units say " + sc.text + ", but " + ev.agree + " room sizes written on it measure × " + r.toFixed(2) + " — check the scale (chip → Verify)", 9000);
}
function cadHidden(fid, sc){ const off = new Set(((P.proj && P.proj.layersOff) || {})[fid] || []), h = new Uint8Array(sc.layers.length); sc.layers.forEach((l, i) => { if (off.has(l.name)) h[i] = 1; }); return h; }

/* the background (black as AutoCAD's model space, white, or black for CAD drawings only) and monochrome */
const darkNow = () => S.bg === "black" || (S.bg !== "white" && !!cadMeta(S.fileId));
function viewOpts(dpr, fast){ const sc = S.cadSc && S.cadSc[S.fileId]; return {dark: darkNow(), mono: !!S.mono, thin: !!S.thin, hidden: sc ? cadHidden(S.fileId, sc) : null, dpr, fast}; }
function bgMark(){
  ["auto", "black", "white"].forEach(v => { const b = $("bBg_" + v); if (b) b.classList.toggle("on", (S.bg || "auto") === v); });
  const m = $("bMono"); if (m) m.classList.toggle("on", !!S.mono);
  const bw = $("bPdfBw"); if (bw) bw.classList.toggle("on", S.bg === "white" && !!S.mono);
  stage().classList.toggle("dark", darkNow());
}
function setBg(v){ S.bg = v; pref("zdTakeoffBg", v); bgMark(); if (S.page) { renderLow(); renderHi(true); } renderLayers(); }
function setMono(on){ S.mono = !!on; pref("zdTakeoffMono", on ? "1" : ""); bgMark(); if (S.page) { renderLow(); renderHi(true); } }
function setPdfBw(on){ S.bg = on ? "white" : (pref("zdTakeoffBg") || "auto"); S.mono = !!on; pref("zdTakeoffBg", S.bg); pref("zdTakeoffMono", on ? "1" : ""); bgMark(); if (S.page) { renderLow(); renderHi(true); } renderLayers(); }
/* a PDF drawn dark (white paper black, black ink white, colours kept — a dark one lifted) or in one ink: the colours pdf.js sets on
   this canvas are changed as it sets them */
const FS = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle"), SS = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "strokeStyle");
function inkMap(dark, mono){
  const cache = new Map();
  return v => {
    if (typeof v !== "string") return v; let r = cache.get(v); if (r !== undefined) return r;
    let R, G, B, A = 1; const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { const n = parseInt(m[1], 16); R = n >> 16 & 255; G = n >> 8 & 255; B = n & 255; }
    else { const q = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(v); if (!q) { cache.set(v, v); return v; } R = +q[1]; G = +q[2]; B = +q[3]; A = q[4] == null ? 1 : +q[4]; }
    const L = 0.299 * R + 0.587 * G + 0.114 * B; let o;
    if (mono) o = dark ? [255, 255, 255] : [0, 0, 0];
    else if (Math.max(R, G, B) - Math.min(R, G, B) < 40) { const g = 255 - L; o = [g, g, g]; }
    else { o = [R, G, B]; if (L < 70) o = o.map(c => c + (255 - c) * 0.45); }
    r = A < 1 ? "rgba(" + o.map(c => Math.round(c)).join(",") + "," + A + ")" : "#" + o.map(c => Math.round(c).toString(16).padStart(2, "0")).join("");
    cache.set(v, r); return r;
  };
}
function inkCtx(ctx, dark, mono){
  if (!dark && !mono) return ctx;
  const f = inkMap(dark, mono);
  Object.defineProperty(ctx, "fillStyle", {configurable: true, get(){ return FS.get.call(this); }, set(v){ FS.set.call(this, f(v)); }});
  Object.defineProperty(ctx, "strokeStyle", {configurable: true, get(){ return SS.get.call(this); }, set(v){ SS.set.call(this, f(v)); }});
  return ctx;
}
/* the screen of a CAD drawing, drawn for the view of the moment. A light view (one that draws within a frame) is drawn whole on every
   zoom / pan step. A heavy one — a big drawing seen whole — shows the whole-page picture while it moves, and once it settles its own
   lines, drawn a slice at a time in the background and put on screen when done, as AutoCAD regenerates */
let cadRaf = 0, cadIdleT = null;
function freeCadBitmap(){
  S.cadGen = (S.cadGen || 0) + 1;
  S.cadBmpBusy = 0;
  if (S.cadBmp && S.cadBmp.cv) S.cadBmp.cv.width = 0;
  S.cadBmp = null;
}
const CAD_FRAME = 24;   // ms
const cadMs = cost => cost * (S.cadRate || 1.5e-4);   // ms per path step, measured on this machine as light views are drawn
const cadLook = () => [darkNow(), !!S.mono, !!S.thin].join("|");
const cadKey = () => cadLook() + "|" + JSON.stringify(((P.proj && P.proj.layersOff) || {})[S.fileId] || []);   // what the whole-page picture was drawn with
function cadLowPaint(src, pg){   // the picture under the screen (shown for a moment when a big zoom step outruns the screen)
  const lc = $("low"), sc = Math.min(3, 3000 / Math.max(S.base.width, S.base.height)); lc.width = Math.ceil(S.base.width * sc); lc.height = Math.ceil(S.base.height * sc);
  const x = lc.getContext("2d"); if (src) x.drawImage(src, 0, 0, lc.width, lc.height); else CAD.cadDraw(x, pg, {s: sc, tx: 0, ty: 0, W: lc.width, H: lc.height}, viewOpts(1, false));
  S.low = {s: sc}; const v = S.view; lc.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.s / sc})`;
}
function cadLow(){
  const pg = cadPage(); if (!pg) return;
  const sc = Math.min(3, 3000 / Math.max(S.base.width, S.base.height));
  if (cadMs(CAD.cadCost(pg, {s: sc, tx: 0, ty: 0, W: Math.ceil(S.base.width * sc), H: Math.ceil(S.base.height * sc)})) > CAD_FRAME) return void cadBitmap();
  S.cadGen = (S.cadGen || 0) + 1; S.cadBmpBusy = 0; cadLowPaint(null, pg);   // light: drawn at once
}
/* a heavy drawing's whole page, drawn once a slice at a time between frames, as a picture sharp enough for every view up to ~4096 px across */
async function cadBitmap(){
  const pg = cadPage(), page = S.page; if (!pg) return;
  const key = cadKey(), look = cadLook(), gen = S.cadGen = (S.cadGen || 0) + 1, lim = (navigator.deviceMemory || 8) >= 4 ? 4096 : 2560, s2 = Math.min(8, lim / Math.max(S.base.width, S.base.height));
  const bm = document.createElement("canvas"); bm.width = Math.max(1, Math.ceil(S.base.width * s2)); bm.height = Math.max(1, Math.ceil(S.base.height * s2));
  S.cadBmpBusy = gen; let done = false;
  try { done = await CAD.cadDrawAsync(bm.getContext("2d"), pg, {s: s2, tx: 0, ty: 0, W: bm.width, H: bm.height}, viewOpts(1, false), () => gen !== S.cadGen || S.page !== page); } catch (e) { console.warn(e); }
  if (S.cadBmpBusy === gen) S.cadBmpBusy = 0;
  if (!done || gen !== S.cadGen || S.page !== page) { bm.width = 0; return; }
  if (S.cadBmp && S.cadBmp.cv !== bm) S.cadBmp.cv.width = 0;
  S.cadBmp = {cv: bm, s: s2, page, key, look}; cadLowPaint(bm, pg);
  if (!S.cadExOk && S.cadExBusy !== S.cadEx) cadHi(true);   // the screen still shows a quick sketch: the picture now, the lines when it settles
}
function cadHi(full){
  if (full) { clearTimeout(cadIdleT); S.cadFull = true; }
  if (cadRaf) return;
  cadRaf = requestAnimationFrame(() => {
    cadRaf = 0; const pg = cadPage(); if (!pg || !S.page || S.cmp) return;
    const st = stage(), dpr = Math.min(window.devicePixelRatio || 1, 2), c = $("hi"), v = Object.assign({}, S.view), w = Math.max(1, Math.floor(st.clientWidth * dpr)), h = Math.max(1, Math.floor(st.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } c.style.width = st.clientWidth + "px"; c.style.height = st.clientHeight + "px";
    const full2 = !!S.cadFull; S.cadFull = false; const ex = S.cadEx = (S.cadEx || 0) + 1;   // a new frame: lines still being drawn for the last view are not wanted
    const x = c.getContext("2d"), dv = {s: v.s * dpr, tx: v.tx * dpr, ty: v.ty * dpr, W: w, H: h}, cost = CAD.cadCost(pg, dv), heavy = cadMs(cost) > CAD_FRAME;
    const bm = S.cadBmp, key = cadKey(), mine = !!bm && bm.page === S.page;
    if (mine && bm.key !== key && !S.cadBmpBusy) cadBitmap();   // the picture is out of date (a layer switched off…): made again
    const pic = heavy && mine && dv.s <= bm.s * 1.02 && (bm.key === key || (!!S.cadBmpBusy && bm.look === cadLook()));   // (while it is made again, the last one)
    S.cadExOk = !heavy; S.cadExBusy = 0;
    if (pic) {   // as sharp as the screen here: the picture, at once
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = darkNow() ? "#000000" : "#ffffff"; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      const k = dv.s / bm.s; x.drawImage(bm.cv, dv.tx, dv.ty, bm.cv.width * k, bm.cv.height * k);
    } else {   // the lines (a heavy view without a picture yet: fewer small things)
      const t0 = performance.now();
      try { CAD.cadDraw(x, pg, dv, viewOpts(dpr, heavy)); } catch (e) { console.warn(e); }
      if (!heavy && cost > 20000) { const r = (performance.now() - t0) / cost; S.cadRate = S.cadRate ? 0.7 * S.cadRate + 0.3 * r : r; }
    }
    if (heavy && full2) cadExact(pg, dv, dpr, ex);
    S.rendered = Object.assign({dpr}, v); c.style.transform = "none"; c.style.display = "block";
    if (!full2) { clearTimeout(cadIdleT); cadIdleT = setTimeout(() => cadHi(true), 180); }
  });
}
async function cadExact(pg, dv, dpr, ex){   // a settled heavy view's own lines, a slice at a time; on screen if the view is still this one
  const cv = document.createElement("canvas"), key = cadKey(), stale = () => ex !== S.cadEx || cadPage() !== pg || cadKey() !== key; cv.width = dv.W; cv.height = dv.H; S.cadExBusy = ex;
  let ok = false; try { ok = await CAD.cadDrawAsync(cv.getContext("2d"), pg, dv, viewOpts(dpr, false), stale); } catch (e) { console.warn(e); }
  if (S.cadExBusy === ex) S.cadExBusy = 0;
  const c = $("hi"); if (ok && !stale() && c.width === dv.W && c.height === dv.H) { c.getContext("2d").drawImage(cv, 0, 0); S.cadExOk = true; }
  cv.width = 0;
}
function cadIsolateId(id){   // AutoCAD's LAYISO: only this layer on — again: every layer back on
  const cfg = S.ocgs && S.ocgs[S.fileId]; if (!cfg) return; const all = Object.keys(cfg.getGroups());
  if (S.iso === id) { S.iso = null; setLayer(all, true); } else { S.iso = id; setLayer(all.filter(x => x !== id), false); setLayer([id], true); }
  renderLayers();
}
function cadIsolate(name){ const cfg = S.ocgs && S.ocgs[S.fileId], e = cfg && Object.entries(cfg.getGroups()).find(([, g]) => g.name === name); if (e) cadIsolateId(e[0]); }

/* the drawing's own objects into the takeoff: lines and polylines (lengths), closed outlines (areas), blocks (counts) */
const cadPts = P => P.filter((p, i) => !i || dist(p, P[i - 1]) > 1e-4).map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]);
function cadAddGeom(sc, pg, ei, how, cnd, counts){   // one object -> measurements; inside mutate. how: area | line | count
  const r = pg.ents[ei], g = CAD.cadGeom(pg, ei); if (!r || !g) return 0;
  const lname = (sc.layers[r.L] || {}).name || "0", fid = S.fileId; let n = 0;
  if (how === "count") { if (!r.at) return 0; const c = cnd && cnd.type === "count" ? cnd : condByName(r.n || lname, "count");
    let it = counts && counts.get(c.id) || P.proj.items.find(i => i.cond === c.id && i.file === fid && i.page === 1 && i.kind === "shape");
    if (!it) { it = {id: uid("I"), cond: c.id, file: fid, page: 1, kind: "shape", pts: [], nos: 1, label: "", ai: true}; P.proj.items.push(it); }
    if (counts) counts.set(c.id, it); if (!it.pts.some(q => dist(q, r.at) < 0.5)) { it.pts.push(r.at.slice()); n++; } return n; }
  if (how === "area") { if (g.kind !== "area") return 0; const c = cnd && cnd.type === "area" ? cnd : condByName(lname, "area");
    const L = g.loops.map(cadPts).filter(l => l.length >= 3 && polyArea(l) > 1e-6);
    L.forEach((l, i) => { const hole = L.some((o, j) => j !== i && polyArea(o) > polyArea(l) && pointInPoly(l[0], o));
      P.proj.items.push({id: uid("I"), cond: c.id, file: fid, page: 1, kind: hole ? "ded" : "shape", pts: l, nos: 1, ai: true, label: hole ? "" : roomNameAt(l) || ""}); n++; });
    return n; }
  const c = cnd && cnd.type === "linear" ? cnd : condByName(lname, "linear");
  (g.kind === "area" ? g.loops.map(l => l.concat([l[0]])) : g.runs).forEach(run => { const p = cadPts(run); if (p.length >= 2) { P.proj.items.push({id: uid("I"), cond: c.id, file: fid, page: 1, kind: "shape", pts: p, nos: 1, ai: true, label: ""}); n++; } });
  return n;
}
function cadPick(ei, how){   // the object under the cursor, in the condition picked when its type fits (else one named after its layer / block)
  const sc = S.cadSc[S.fileId], pg = cadPage(); if (!pg) return; let n = 0;
  mutate(() => { n = cadAddGeom(sc, pg, ei, how, S.cond ? cond(S.cond) : null, null); }, "AutoCAD object into the takeoff");
  refresh(); toast(n ? "Taken off from the drawing: " + n + " measurement" + (n > 1 ? "s" : "") + " — marked AI, check them" : "Nothing to take off from that object", 3000);
}
function cadCtxItems(q){   // right-click: the AutoCAD object under the cursor
  const pg = cadPage(); if (!pg || !q) return [];
  const sc = S.cadSc[S.fileId], h = CAD.cadHit(pg, q[0], q[1], 7 / S.view.s, cadHidden(S.fileId, sc)); if (!h) return [];
  const r = pg.ents[h.e]; if (!r || r.L < 0) return [];
  const lname = (sc.layers[r.L] || {}).name || "0", L = [{h: "AutoCAD: " + (r.t === "INSERT" ? "block " + (r.n || "") : r.t.toLowerCase()) + " · " + lname, s: [r.area ? f2(r.area) + " Sft" : "", r.len ? f2(r.len) + " ft" : "", r.att && r.att.length ? r.att.map(a => a.join(" ")).join(", ") : ""].filter(Boolean).join(" · ")}];
  if (r.t === "INSERT") { const same = pg.ents.filter(x => x.t === "INSERT" && x.n === r.n).length; L.push({t: "Count this " + (r.n || "block"), fn: () => cadPick(h.e, "count")}, {t: "Count every " + (r.n || "block") + " (" + same + ")…", fn: () => cadQtyDialog({B: r.n})}); }
  else { if (r.cl && r.area > 0) L.push({t: "Take off its area — " + f2(r.area) + " Sft", fn: () => cadPick(h.e, "area")}); if (r.len > 0) L.push({t: "Take off its length — " + f2(r.len) + " ft", fn: () => cadPick(h.e, "line")}); }
  L.push({t: "Quantities on layer " + lname + "…", fn: () => cadQtyDialog({L: r.L})}, {t: "Isolate layer " + lname + " (LAYISO)", fn: () => cadIsolate(lname)}, {sep: 1});
  return L;
}
async function cadQtyDialog(pre){
  if (!S.page || !cadMeta(S.fileId)) return toast("Open an AutoCAD drawing first — + PDF adds a DWG or DXF", 4000);
  const sc = await cadLoad(S.fileId); if (!sc || !CAD) return toast("The drawing's objects are not in this browser — add the DWG again with + PDF", 5000);
  pre = pre || {}; const pg = sc.pages[0], Q = CAD.cadQty(sc, pg), hid = cadHidden(S.fileId, sc), dark = darkNow();
  const sw = c => `<span class="lsw" style="background:${CAD.cadCss(c, dark, false)}"></span>`;
  const att = b => [...b.att].map(([t, m]) => t + ": " + [...m].slice(0, 6).map(([v, n]) => v + (n > 1 ? " ×" + n : "")).join(", ") + (m.size > 6 ? ", …" : "")).join(" · ");
  const LS = Q.layers.filter(l => l.runs || l.areas), BS = Q.blocks;
  const body = `<div class="wide"></div><p>Read from the drawing's own objects, at its own scale: lines and polylines by layer (length), closed outlines — polylines, circles, hatches — by layer (area), and blocks by name (count). Tick what to take off: each becomes measurements in a condition named after its layer or block, marked <b>AI</b> for you to check.</p>
    <div class="cq"><table class="sh cqt"><thead><tr><th>Layer</th><th class="n">Lines → length</th><th class="n">Closed → area</th></tr></thead><tbody>${LS.map(l => `<tr${hid[l.li] ? ' class="dim"' : ""}><td>${sw(sc.layers[l.li].c)} ${esc(l.name)}${hid[l.li] ? ' <span class="small">(off)</span>' : ""}</td>
      <td class="n">${l.runs ? `<label class="pk"><input type="checkbox" data-ql="${l.li}"${pre.L === l.li ? " checked" : ""}> ${l.runs} · ${f2(l.len)} ft</label>` : ""}</td>
      <td class="n">${l.areas ? `<label class="pk"><input type="checkbox" data-qa="${l.li}"${pre.L === l.li ? " checked" : ""}> ${l.areas} · ${f2(l.area)} Sft</label>` : ""}</td></tr>`).join("") || '<tr><td colspan="3" class="small">No lines or outlines on these layers</td></tr>'}</tbody></table></div>
    <div class="cq"><table class="sh cqt"><thead><tr><th>Block</th><th class="n">Count</th><th>Layer</th><th>Attributes</th></tr></thead><tbody>${BS.map((b, i) => `<tr><td><label class="pk"><input type="checkbox" data-qb="${i}"${pre.B === b.name ? " checked" : ""}> ${esc(b.name)}</label></td><td class="n">${b.n}</td><td class="small">${esc([...b.layers].join(", "))}</td><td class="small">${esc(att(b))}</td></tr>`).join("") || '<tr><td colspan="4" class="small">No blocks in model space</td></tr>'}</tbody></table></div>
    <label class="pk"><input type="checkbox" id="cqVis" checked> Only objects on layers that are switched on</label>`;
  const v = await ask("AutoCAD quantities — " + pageName({file: S.fileId, page: 1}), body, "Add to takeoff", () => {
    const g = a => new Set([...document.querySelectorAll("#dlgB [data-" + a + "]")].filter(x => x.checked).map(x => x.dataset[a]));
    const o = {lens: new Set([...g("ql")].map(Number)), areas: new Set([...g("qa")].map(Number)), blocks: new Set([...g("qb")].map(i => BS[+i].name)), vis: $("cqVis").checked};
    return o.lens.size || o.areas.size || o.blocks.size ? o : "Tick at least one layer or block";
  });
  if (v) cadTakeoff(sc, pg, v);
}
function cadTakeoff(sc, pg, sel){   // sel: {lens: Set(layer index), areas: Set(layer index), blocks: Set(name), vis}
  if (S.pageNo !== 1) return;
  const hid = sel.vis ? cadHidden(S.fileId, sc) : null, got = {area: 0, line: 0, count: 0}, counts = new Map();
  mutate(() => {
    pg.ents.forEach((r, ei) => {
      if (r.L < 0 || (hid && hid[r.L])) return;
      if (r.t === "INSERT") { if (sel.blocks.has(r.n)) got.count += cadAddGeom(sc, pg, ei, "count", null, counts); return; }
      if (r.cl && r.area > 0 && sel.areas.has(r.L)) got.area += cadAddGeom(sc, pg, ei, "area", null, null);
      else if (!r.cl && r.len > 0 && sel.lens.has(r.L)) got.line += cadAddGeom(sc, pg, ei, "line", null, null);
    });
  }, "AutoCAD takeoff");
  refresh();
  toast("From the drawing: " + [got.area && got.area + " area" + (got.area > 1 ? "s" : ""), got.line && got.line + " run" + (got.line > 1 ? "s" : ""), got.count && got.count + " count marker" + (got.count > 1 ? "s" : "")].filter(Boolean).join(", ") + " — marked AI, check them", 5000);
  return got;
}

/* ------------------------------------------------------------------ plot / print (Ctrl+P), as AutoCAD's PLOT
   What to plot (a window picked on the drawing, the view on screen, the drawing's extents or the whole page), the paper and its
   orientation, the scale (fit, or 1:N from the page's scale), colours as drawn / monochrome / grayscale, lineweights, the takeoff
   on top, a legend and a title line. The result is a vector PDF, printed through the browser's print dialog or saved. */
const PAPERS = [["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189], ["Letter", 215.9, 279.4], ["Legal", 215.9, 355.6], ["Tabloid 11×17", 279.4, 431.8],
  ["ARCH C 18×24", 457.2, 609.6], ["ARCH D 24×36", 609.6, 914.4], ["ARCH E 36×48", 914.4, 1219.2]];
const PLOT_SC = [[1, "1:1"], [2, "1:2"], [5, "1:5"], [10, "1:10"], [20, "1:20"], [25, "1:25"], [50, "1:50"], [75, "1:75"], [100, "1:100"], [125, "1:125"], [150, "1:150"], [200, "1:200"], [250, "1:250"],
  [300, "1:300"], [400, "1:400"], [500, "1:500"], [1000, "1:1000"], [12, "1\" = 1'-0\""], [16, "3/4\" = 1'-0\""], [24, "1/2\" = 1'-0\""], [32, "3/8\" = 1'-0\""], [48, "1/4\" = 1'-0\""], [64, "3/16\" = 1'-0\""],
  [96, "1/8\" = 1'-0\""], [128, "3/32\" = 1'-0\""], [192, "1/16\" = 1'-0\""], [120, "1\" = 10'"], [240, "1\" = 20'"], [360, "1\" = 30'"], [480, "1\" = 40'"], [600, "1\" = 50'"]];
function plotPref(){ let o = null; try { o = JSON.parse(pref("zdTakeoffPlot") || "null"); } catch (e) { o = null; }
  return Object.assign({area: "display", paper: "A3", orient: "auto", scale: "fit", style: "color", lw: true, tk: true, legend: true, stamp: true, center: true, np: true}, o && typeof o === "object" ? o : {}); }
function plotWin(o){   // the part of the page plotted, page points [x0, y0, x1, y1]
  const W = S.base.width, H = S.base.height, m = (cadMeta(S.fileId) || {}).map;
  if (o.area === "window" && o.win) return o.win.slice();
  if (o.area === "page") return [0, 0, W, H];
  if (o.area === "extents") return m && S.pageNo === 1 ? [m.ox, m.oy, W - m.ox, H - m.oy] : [0, 0, W, H];
  const st = stage(), a = toBase(0, 0), b = toBase(st.clientWidth, st.clientHeight), r = [Math.max(0, a[0]), Math.max(0, a[1]), Math.min(W, b[0]), Math.min(H, b[1])];
  return r[2] - r[0] > 1 && r[3] - r[1] > 1 ? r : [0, 0, W, H];
}
function plotLayout(o, win){   // the paper (pt), the scale (paper pt per page pt) and where the window lands on the paper
  const pp = PAPERS.find(p => p[0] === o.paper) || PAPERS[1], ww = win[2] - win[0], wh = win[3] - win[1], land = o.orient === "landscape" || (o.orient === "auto" && ww >= wh);
  const PW = (land ? pp[2] : pp[1]) * 72 / 25.4, PH = (land ? pp[1] : pp[2]) * 72 / 25.4, mg = 10 * 72 / 25.4, foot = o.stamp ? 14 : 0, aw = PW - 2 * mg, ah = PH - 2 * mg - foot, k = curScale();
  let s = Math.min(aw / ww, ah / wh), note = "", fixed = o.scale !== "fit" && +o.scale > 0 && k > 0;
  if (fixed) { s = 864 / +o.scale / k; if (ww * s > aw + 0.5 || wh * s > ah + 0.5) note = "At this scale the window is bigger than the paper — it is cut at the paper's edge."; }
  const pw = Math.min(ww * s, aw), ph = Math.min(wh * s, ah), x = o.center ? mg + (aw - pw) / 2 : mg, y = mg + foot + (o.center ? (ah - ph) / 2 : ah - ph);
  const scTxt = fixed ? (PLOT_SC.find(p => p[0] === +o.scale) || [0, "1:" + o.scale])[1] : k > 0 ? "1:" + (864 / (s * k)).toFixed(1).replace(/\.0$/, "") + " (fit)" : "fit to paper";
  return {PW, PH, s, x, y, pw, ph, land, note, scTxt, mg, paper: pp[0], win: [win[0], win[1], win[0] + pw / s, win[1] + ph / s]};
}
function pickWindow(msg){   // AutoCAD's window: click one corner, then the other (or drag) -> [x0, y0, x1, y1] page points, or null (Esc)
  return new Promise(res => {
    const ov = document.createElement("div"), bx = document.createElement("div"), tip = document.createElement("div");
    ov.className = "tbpick"; bx.className = "tbbox"; tip.className = "tbtip"; tip.textContent = msg; ov.append(bx, tip); stage().appendChild(ov);
    let a = null, d0 = null, moved = false;
    const box = sp => { if (!a) return; const p = toScr(a); Object.assign(bx.style, {display: "block", left: Math.min(p[0], sp[0]) + "px", top: Math.min(p[1], sp[1]) + "px", width: Math.abs(sp[0] - p[0]) + "px", height: Math.abs(sp[1] - p[1]) + "px"}); };
    const done = v => { ov.remove(); document.removeEventListener("keydown", key, true); res(v); };
    const fin = sp => { const b = toBase(sp[0], sp[1]), r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      if ((r[2] - r[0]) * S.view.s < 4 || (r[3] - r[1]) * S.view.s < 4) { a = null; bx.style.display = "none"; return; } done(r); };
    const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", key, true);
    ov.addEventListener("pointerdown", e => { if (e.button !== 0 || S.space) return; e.preventDefault(); e.stopPropagation(); const sp = evPos(e);
      if (!a) { a = toBase(sp[0], sp[1]); d0 = sp; moved = false; ov.setPointerCapture(e.pointerId); tip.textContent = "Now the opposite corner — Esc to go back"; } else fin(sp); });
    ov.addEventListener("pointermove", e => { if (!a) return; const sp = evPos(e); if (d0 && Math.hypot(sp[0] - d0[0], sp[1] - d0[1]) > 6) moved = true; box(sp); });
    ov.addEventListener("pointerup", e => { if (a && moved && d0) { d0 = null; fin(evPos(e)); } else d0 = null; });
  });
}
function plotPreview(o){   // the paper, small, with the drawing on it as it will be plotted
  const cv = $("plPrev"); if (!cv || !S.page) return;
  const win = plotWin(o), L = plotLayout(o, win), k = Math.min((cv.width - 16) / L.PW, (cv.height - 16) / L.PH), ox = (cv.width - L.PW * k) / 2, oy = (cv.height - L.PH * k) / 2, c = cv.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#e9edf3"; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = "#fff"; c.fillRect(ox, oy, L.PW * k, L.PH * k); c.strokeStyle = "#9fb0c6"; c.strokeRect(ox + 0.5, oy + 0.5, L.PW * k - 1, L.PH * k - 1);
  const s = L.s * k, dx = ox + L.x * k - L.win[0] * s, dy = oy + (L.PH - L.y - L.ph) * k - L.win[1] * s, px = ox + L.x * k, py = oy + (L.PH - L.y - L.ph) * k;
  c.save(); c.beginPath(); c.rect(px, py, L.pw * k, L.ph * k); c.clip();
  const pg = cadOn() ? cadPage() : null;
  if (pg) { const off = document.createElement("canvas"), gen = S.plGen = (S.plGen || 0) + 1; off.width = Math.max(1, Math.ceil(L.pw * k)); off.height = Math.max(1, Math.ceil(L.ph * k));
    CAD.cadDrawAsync(off.getContext("2d"), pg, {s, tx: dx - px, ty: dy - py, W: off.width, H: off.height}, {dark: false, mono: o.style === "mono", hidden: cadHidden(S.fileId, S.cadSc[S.fileId]), dpr: 1}, () => gen !== S.plGen)
      .then(ok => { if (ok && gen === S.plGen && $("plPrev") === cv) c.drawImage(off, px, py); off.width = 0; }).catch(() => {}); }
  else if (S.low) { const lw = $("low"), r = S.low.s; c.filter = o.style === "mono" ? "grayscale(1) contrast(4)" : o.style === "gray" ? "grayscale(1)" : "none"; c.drawImage(lw, L.win[0] * r, L.win[1] * r, (L.win[2] - L.win[0]) * r, (L.win[3] - L.win[1]) * r, px, py, L.pw * k, L.ph * k); c.filter = "none"; }
  c.restore();
  const info = $("plInfo"); if (info) info.innerHTML = esc(L.paper + " " + (L.land ? "landscape" : "portrait") + " · " + L.scTxt) + (L.note ? '<br><span style="color:#8a5a00">' + esc(L.note) + "</span>" : "");
  const wi = $("plWin"); if (wi) wi.textContent = o.win ? "window picked" : "no window yet — pick one";
}
async function plotDialog(){
  if (!P.proj || !S.page) return toast("Open a drawing first");
  const o = Object.assign(plotPref(), S.plotWin ? {win: S.plotWin, area: "window"} : {});
  for (;;) {
    const r = await plotAsk(o); if (!r) { S.plotWin = null; return; }
    Object.assign(o, r.o);
    const keep = Object.assign({}, o); delete keep.win; if (keep.area === "window") keep.area = "display"; pref("zdTakeoffPlot", JSON.stringify(keep));
    if (r.pick) { const w = await pickWindow("Plot window: click one corner, then the opposite corner (or drag a box) — Esc to go back"); if (w) { o.win = w; o.area = "window"; S.plotWin = w; } continue; }
    S.plotWin = o.win || null; return plotRun(o, r.go);
  }
}
function plotAsk(o){
  const k = curScale(), cad = !!cadOn(), opt = (v, t, cur) => `<option value="${esc(String(v))}"${String(cur) === String(v) ? " selected" : ""}>${esc(t)}</option>`;
  const rad = (v, t) => `<label class="pk"><input type="radio" name="plA" value="${v}"${o.area === v ? " checked" : ""}> ${t}</label>`;
  const body = `<div class="wide"></div><div class="plotw"><div class="grid" style="flex:1;min-width:280px">
    <div class="fg w2"><label>What to plot</label><div class="xrad">${rad("window", "Window")}${rad("display", "Display (the view on screen)")}${rad("extents", cad ? "Extents (the whole drawing)" : "The whole page")}${cad ? rad("page", "The whole page") : ""}</div>
      <div class="xrow"><button class="btn sm" type="button" id="plPick" title="Pick the window on the drawing: one corner, then the other">&#9634; Pick window &lt;</button><span class="small" id="plWin"></span></div></div>
    <div class="fg"><label>Paper size</label><select id="plPaper">${PAPERS.map(p => opt(p[0], p[0] + " (" + p[1] + " × " + p[2] + " mm)", o.paper)).join("")}</select></div>
    <div class="fg"><label>Orientation</label><select id="plOr">${[["auto", "Auto — as the window"], ["landscape", "Landscape"], ["portrait", "Portrait"]].map(([v, t]) => opt(v, t, o.orient)).join("")}</select></div>
    <div class="fg"><label>Plot scale</label><select id="plSc">${opt("fit", "Fit to paper", o.scale)}${k > 0 ? PLOT_SC.map(([v, t]) => opt(v, t, o.scale)).join("") : ""}</select>${k > 0 ? "" : '<span class="small">Set the page\'s scale (K) to plot at a true scale</span>'}</div>
    <div class="fg"><label>Plot style</label><select id="plSt">${[["color", "As drawn — colours"], ["mono", "Monochrome — all black"], ["gray", "Grayscale"]].map(([v, t]) => opt(v, t, o.style)).join("")}</select></div>
    <div class="fg w2"><label>Plot options</label><label class="pk"><input type="checkbox" id="plLw"${o.lw ? " checked" : ""}> Plot lineweights</label><label class="pk"><input type="checkbox" id="plTk"${o.tk ? " checked" : ""}> The takeoff on top (measurements, labels, markups)</label>
      <label class="pk"><input type="checkbox" id="plLg"${o.legend ? " checked" : ""}> Legend — the conditions on this sheet and their quantities</label><label class="pk"><input type="checkbox" id="plTi"${o.stamp ? " checked" : ""}> Title line — project, sheet, scale, date</label>
      <label class="pk"><input type="checkbox" id="plCe"${o.center ? " checked" : ""}> Centre the plot</label>${cad ? `<label class="pk"><input type="checkbox" id="plNp"${o.np ? " checked" : ""}> Leave out layers not set to plot (Defpoints…)</label>` : ""}</div></div>
    <div class="plprev"><canvas id="plPrev" width="300" height="300"></canvas><span class="small" id="plInfo"></span></div></div>
    <p class="small" style="margin-top:6px">A vector PDF: <b>Print</b> opens the browser's print dialog with it (choose the printer, or Save as PDF there); <b>Save PDF</b> downloads it. ${cad ? "The drawing is plotted from its own lines, so monochrome and grayscale are exact." : "Monochrome is plotted as a 200 DPI picture of the page."}</p>`;
  const read = () => ({area: (document.querySelector('#dlgB input[name="plA"]:checked') || {}).value || "display", paper: $("plPaper").value, orient: $("plOr").value, scale: $("plSc").value, style: $("plSt").value,
    lw: $("plLw").checked, tk: $("plTk").checked, legend: $("plLg").checked, stamp: $("plTi").checked, center: $("plCe").checked, np: $("plNp") ? $("plNp").checked : o.np});
  let go = "print", pick = false, snap = null;
  const p = ask("Plot — " + pageName({file: S.fileId, page: S.pageNo}), body, "Print", () => { const v = read(); if (v.area === "window" && !o.win) return "Pick the window first (Pick window <)"; return v; });
  const sv = document.createElement("button"); sv.className = "btn"; sv.textContent = "Save PDF"; sv.onclick = () => { go = "pdf"; $("dlgOk").click(); }; $("dlgOk").before(sv);
  $("plPick").onclick = () => { pick = true; snap = read(); $("dlgCancel").click(); };
  const upd = () => plotPreview(Object.assign({}, o, read()));
  $("dlgB").addEventListener("change", upd); upd();
  return p.then(v => pick ? {o: snap, pick: true} : v ? {o: v, go} : null);
}
async function plotRun(o, go){
  busy("Plotting…");
  try { const bytes = await plotPdf(o), name = fileBase() + "_plot_" + String(pageName({file: S.fileId, page: S.pageNo})).replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40) + ".pdf";
    if (go === "pdf") { saveBlob(new Blob([bytes], {type: "application/pdf"}), name); toast("Plot saved — " + name, 3000); } else printPdf(bytes); }
  catch (e) { toast("Plot failed: " + (e.message || e), 6000); }
  busy("");
}
async function plotPdf(o){
  const Lb = await loadPdfLib(), out = await Lb.PDFDocument.create(), lo = plotLayout(o, plotWin(o)), win = lo.win, f = S.fileId, p = S.pageNo, pgp = S.page;
  out.setTitle(P.proj.name + " — " + pageName({file: f, page: p})); out.setCreator("ZD PDF Takeoff — plot"); out.setProducer("ZD PDF Takeoff");
  const page = out.addPage([lo.PW, lo.PH]), font = await out.embedFont(Lb.StandardFonts.Helvetica), cp = cadOn() ? cadPage() : null;
  if (cp) {
    const sc = S.cadSc[f], hid = cadHidden(f, sc); if (o.np) sc.layers.forEach((l, i) => { if (!l.plot || /^defpoints$/i.test(l.name)) hid[i] = 1; });
    await CAD.cadPlotPage(Lb, out, page, cp, {win, s: lo.s, at: [lo.x, lo.y], style: o.style, hidden: hid, lw: o.lw, font});
  } else {
    const rec = await dbGet("pdfs", f); let src = null; try { src = rec && await Lb.PDFDocument.load(rec.data.slice(0), {ignoreEncryption: true}); } catch (e) { src = null; }
    if (!src || src.isEncrypted || pgp.rotate % 360 || o.style === "mono" || mkRedacted(f, p)) {   // as a picture: a turned, locked or redacted page, or monochrome
      const cs = Math.min(200 / 72 * lo.s, 9000 / Math.max(win[2] - win[0], win[3] - win[1])), W = Math.max(1, Math.ceil((win[2] - win[0]) * cs)), H = Math.max(1, Math.ceil((win[3] - win[1]) * cs));
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = inkCtx(thinLines(cv.getContext("2d")), false, o.style === "mono"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      await loadLayers(f); await sliced(pgp.render({...lay(f), canvasContext: ctx, viewport: pgp.getViewport({scale: cs}), transform: [1, 0, 0, 1, -win[0] * cs, -win[1] * cs]})).promise;
      if (o.style === "gray") { const im = ctx.getImageData(0, 0, W, H), d = im.data; for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; } ctx.putImageData(im, 0, 0); }
      page.drawImage(await out.embedPng(await blobBuf(cv, "image/png")), {x: lo.x, y: lo.y, width: lo.pw, height: lo.ph}); cv.width = 0;
    } else {
      const vb = pgp.view, ep = await out.embedPage(src.getPage(p - 1), {left: vb[0] + win[0], right: vb[0] + win[2], top: vb[3] - win[1], bottom: vb[3] - win[3]});
      page.drawPage(ep, {x: lo.x, y: lo.y, width: lo.pw, height: lo.ph});
      if (o.style === "gray") page.drawRectangle({x: lo.x, y: lo.y, width: lo.pw, height: lo.ph, color: Lb.rgb(0.5, 0.5, 0.5), blendMode: Lb.BlendMode.Saturation});
      ocFix(Lb, out, [f]);
    }
  }
  if (o.tk) {   // the takeoff over the window, as a transparent picture at about 200 DPI
    const cs = Math.min(200 / 72 * lo.s, 6000 / Math.max(win[2] - win[0], win[3] - win[1])), W = Math.max(1, Math.ceil((win[2] - win[0]) * cs)), H = Math.max(1, Math.ceil((win[3] - win[1]) * cs));
    await mkAssetsFor(f, p); const full = pageOverlaySvg(f, p, cs, Math.ceil(S.base.width * cs), Math.ceil(S.base.height * cs), {legend: "none", stamp: false}), inner = full.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    await svgOnto(cv.getContext("2d"), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${(win[0] * cs).toFixed(2)} ${(win[1] * cs).toFixed(2)} ${W} ${H}">${inner}</svg>`);
    page.drawImage(await out.embedPng(await blobBuf(cv, "image/png")), {x: lo.x, y: lo.y, width: lo.pw, height: lo.ph}); cv.width = 0;
  }
  const ink = Lb.rgb(0.12, 0.17, 0.23);
  if (o.legend) {   // the conditions measured on this sheet, with their quantities
    const tot = new Map(); P.proj.items.filter(i => i.file === f && i.page === p && !hiddenItem(i)).forEach(it => { const c = cond(it.cond), kk = itemScale(it); if (!c || !kk) return; tot.set(c.id, (tot.get(c.id) || 0) + rowsOf(it, kk).reduce((a, r) => a + r.qty, 0)); });
    const rows = P.proj.conds.filter(c => tot.has(c.id)).map(c => [c, (c.boq ? c.boq + " · " : "") + c.name + ": " + fq(tot.get(c.id), c.unit) + " " + c.unit]).slice(0, 24);
    if (rows.length) { const fs = 7.5, w = Math.min(lo.pw, 26 + Math.max(...rows.map(r => font.widthOfTextAtSize(r[1], fs)))), h = rows.length * 10 + 8, x = lo.x + 4, y = lo.y + 4;
      page.drawRectangle({x, y, width: w, height: h, color: Lb.rgb(1, 1, 1), opacity: 0.92, borderColor: Lb.rgb(0.79, 0.84, 0.89), borderWidth: 0.5});
      rows.forEach(([c, t], i) => { const yy = y + h - 12 - i * 10, col = /^#[0-9a-f]{6}$/i.test(c.color) ? Lb.rgb(parseInt(c.color.slice(1, 3), 16) / 255, parseInt(c.color.slice(3, 5), 16) / 255, parseInt(c.color.slice(5, 7), 16) / 255) : ink;
        page.drawRectangle({x: x + 6, y: yy, width: 7, height: 7, color: col}); page.drawText(t, {x: x + 18, y: yy + 0.5, size: fs, font, color: ink}); }); }
  }
  if (o.stamp) { const t = [P.proj.name, pageName({file: f, page: p}), "scale " + lo.scTxt, lo.paper, "plotted " + dmy(today())].filter(Boolean).join("   ·   ");
    page.drawText(t.length > 160 ? t.slice(0, 159) + "…" : t, {x: lo.mg, y: lo.mg, size: 7.5, font, color: ink}); }
  return out.save();
}
function printPdf(bytes){   // the PDF in the browser's own print dialog (a hidden frame; a new tab if the browser will not print a frame)
  const url = URL.createObjectURL(new Blob([bytes], {type: "application/pdf"})), fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0;pointer-events:none"; fr.src = url;
  fr.onload = () => setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.open(url, "_blank"); } }, 400);
  document.body.appendChild(fr); setTimeout(() => { fr.remove(); URL.revokeObjectURL(url); }, 300000);
  toast("Plot ready — the print dialog opens (choose the printer, or Save as PDF)", 3500);
}
/* the layers switched off in the takeoff stay off in a PDF made from the drawing's pages (copied pages lose the PDF's own layer list) */
function ocFix(Lb, out, fids){
  const off = new Set(); (fids || []).forEach(f => (((P.proj && P.proj.layersOff) || {})[f] || []).forEach(n => off.add(n)));
  const N = Lb.PDFName.of, all = [], hide = [];
  out.context.enumerateIndirectObjects().forEach(([ref, obj]) => { if (!(obj instanceof Lb.PDFDict) || obj.get(N("Type")) !== N("OCG")) return; all.push(ref);
    const nm = obj.lookup(N("Name")); let s = ""; try { s = nm && nm.decodeText ? nm.decodeText() : ""; } catch (e) { s = ""; } if (off.has(s)) hide.push(ref); });
  if (all.length) out.catalog.set(N("OCProperties"), out.context.obj({OCGs: all, D: {Order: all, ON: all.filter(r => !hide.includes(r)), OFF: hide}}));
}

/* ------------------------------------------------------------------ start */
(async function init(){
  loadLbl(); loadLegend(); wire(); wirePanels(); setLblOn(S.lbl.on); setLegendOn(S.legendOn); iconize(); wsApply();
  { const dv = +pref("zdTakeoffDim") || 0; S.dimPct = dv > 1 ? dv : dv === 1 ? 50 : 50; setDim(dv > 0 ? S.dimPct : 0); } setThin(pref("zdTakeoffThin") === "1");
  S.bg = pref("zdTakeoffBg") || "auto"; S.mono = pref("zdTakeoffMono") === "1"; bgMark();
  try { DB = await openDB(); } catch (e) { $("drop").innerHTML = '<div class="box">This browser blocks local storage (private window?) — projects cannot be saved here.</div>'; return; }
  window.zdTakeoff = {snapKinds, dupFind, floorGaps, pdfVpRead, pdfScalesOn, applyPdfScales, fullTakeoff, finishesRun, agentCheck, agentCmd, agentAnswer, cmdSteps, nameLike, doorLines, overlapSft, save, pageOverlaySvg, applyView, renderHi, inPerFtOf, selfCross, fitWidth, removePdf, flushSave, fq, renderPages, P, S, rowsOf, condTotals, parseFt, scaleCandidates, rectilinear, triangles, gotoPage, openProject, segsIn, doorSymbols, barrierIds, autoRoom, evalFormula, autoRoomGuarded, deTab, drawingFacts, textLines, pageTexts, freeV: () => AI.freeView, migrate, importProject, condVars, billLines, doorsOn, validation, raPrice, rateOf, revRows, backupNow, backupsOf, simT, typCommit, scaleState, locOf, setQa, qaCounts, wallsAgent, unitsOf, agentUnit, wallThicknesses, findWalls, layerInfo, segRoleFilter, scaleFromRooms, checkScale, roomNameAt, viewRect, capLines, delSelected, agentMeasure, agentCount, setTool, setSel, selIds, copySel, pasteClip, duplicateSel, breakRun, delSegment, cutGap, joinRuns, addPoint, delPoint, toRun, toArea, transformSel, lockSel, orderSel, arcPts, undoAny, redoAny, ctxOpen, ctxClose, selectSimilar, placeClip, clipOf, tagsOf, tagParse, sizePair, doorSwings, scanTags, doorWinDialog, agentSwings, keysDialog, indexPage, findSimilar, nextUnchecked, openPalette, paletteCmds, explodeRun, closeRun, offsetItem, offsetRun, typedPoint,
    pagesShown, pagesWithTakeoff, pgTick, pinPages, exportPagesDialog, runExport, zipBlob, crc32, parseRange, rangeText, importDialog, subsetPdf, imagesToPdf, imgDpi, sheetGuess, autoSheetDialog,
    ocrDialog, ocrPages, withOcr, sheetRefsNear, sheetIndex, cutTargets, cutOutOf, overlapPoly, clipPoly, wsLayout, wsSet, wsPref, miniUpdate, reportPrint, allPages, keyName, pickTitleBlock, dragBox, importMenu, wsMenu,
    cadLoad, cadMod, cadPage, cadOn, cadHidden, cadQtyDialog, cadTakeoff, cadPick, cadCtxItems, cadIsolate, cadUnitsCheck, plotDialog, plotPdf, plotWin, plotLayout, pickWindow, printPdf, ocFix, setBg, setMono, darkNow, inkMap, addFiles, cadMeta: fid => cadMeta(fid),
    mkStyle, mkClean, mkSanitize, mkFit, mkWrap, stampSub, assetRec, mkAssetsFor, mkMenu, exportPdf, exportBundle, importBundle, migrate, mlToggle, mlRows, mkLayers, mkSpaceOf, mlSummary};   // for tests and the console
  const last = localStorage.getItem("zdTakeoffLast");
  const all = await dbAll("projects");
  if (last && all.some(p => p.id === last)) await openProject(last); else await showStart();
  loadPdfjs().catch(e => toast(e.message, 6000));
})();

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

/* ------------------------------------------------------------------ utilities */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const r3 = v => Math.round(v * 1000) / 1000;                       // lengths: decimal feet, 3 dp
const f3 = v => r3(v).toFixed(3);
const f2 = v => (Math.round(v * 100) / 100).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = iso => { const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "-" + MON[+p[1] - 1] + "-" + p[0] : "—"; };
function toast(msg, ms){ const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, ms || 2600); }
function busy(msg){ const b = $("busy"); b.textContent = msg || ""; b.style.display = msg ? "block" : "none"; }

/* "12'-6\"", "12' 6", "12-6", "12.5", "150\"", "12'6 1/2\"" -> decimal feet (NaN if not a length) */
function parseFt(s){
  s = String(s || "").trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/\s+/g, " ");
  if (!s) return NaN;
  const frac = t => { t = t.trim(); if (!t) return 0; const m = /^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/.exec(t); if (!m) return NaN; return (m[1] ? +m[1] : 0) + (m[2] ? +m[2] / +m[3] : 0); };
  let m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*([\d.\s/]*)"?$/.exec(s);          // 12'-6", 12' 6 1/2"
  if (m) { const i = frac(m[2]); return isNaN(i) ? NaN : +m[1] + i / 12; }
  m = /^([\d.\s/]+)"$/.exec(s);                                          // 150"
  if (m) { const i = frac(m[1]); return isNaN(i) ? NaN : i / 12; }
  m = /^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/.exec(s);                           // 12-6
  if (m) return +m[1] + +m[2] / 12;
  m = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:ft)?$/i.exec(s);                      // 12.5
  return m ? +m[1] : NaN;
}

/* ------------------------------------------------------------------ geometry */
const polyLen = (P, closed) => { let s = 0; for (let i = 1; i < P.length; i++) s += dist(P[i - 1], P[i]); if (closed && P.length > 2) s += dist(P[P.length - 1], P[0]); return s; };
const polyArea = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(s) / 2; };
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
    const rq = indexedDB.open("zdTakeoff", 1);
    rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore("projects", {keyPath: "id"}); db.createObjectStore("pdfs"); };
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
  view: {s: 1, tx: 0, ty: 0}, rendered: null, renderTask: null, low: null,
  tool: "select", cond: null, draft: [], cursor: null, snap: null, sel: null, selPt: -1,
  geo: {},                            // "fileId:page" -> {segs, grid, cell, n}
  texts: {},                          // "fileId:page" -> [{s, x, y}]
  undo: [], redo: [], drag: null, space: false, measure: null, measures: [], pinch: null
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
function newProject(name){
  return {id: uid("P"), name: name || "Untitled takeoff", created: new Date().toISOString(), updated: new Date().toISOString(), v: 1,
          files: [], scales: {}, conds: [], items: [], last: {}};
}
let saveT = null;
function save(){ if (!P.proj) return; P.proj.updated = new Date().toISOString(); clearTimeout(saveT); saveT = setTimeout(() => dbPut("projects", P.proj).catch(e => toast("Could not save: " + e.message, 5000)), 300); }
function snapshot(){ return JSON.stringify({conds: P.proj.conds, items: P.proj.items, scales: P.proj.scales, viewports: P.proj.viewports || {}, marks: P.proj.marks || []}); }
function mutate(fn){
  S.undo.push(snapshot()); if (S.undo.length > 100) S.undo.shift(); S.redo = [];
  fn(); save(); refresh();
}
function undo(){ if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
function redo(){ if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
function restore(js){ const o = JSON.parse(js); P.proj.conds = o.conds; P.proj.items = o.items; P.proj.scales = o.scales; P.proj.viewports = o.viewports || {}; P.proj.marks = o.marks || []; if (S.sel && !P.proj.items.some(i => i.id === S.sel)) S.sel = null; save(); refresh(); }

async function openProject(id){
  const pr = await dbGet("projects", id);
  if (!pr) return toast("Project not found");
  Object.values(S.docs).forEach(d => d.destroy && d.destroy());
  P.proj = pr; S.docs = {}; S.geo = {}; S.texts = {}; S.undo = []; S.redo = []; S.sel = null; S.draft = []; S.page = null; S.fileId = null;
  S.cond = (pr.conds[0] || {}).id || null;
  localStorage.setItem("zdTakeoffLast", pr.id);
  $("start").classList.remove("on");
  $("projName").value = pr.name;
  buildPageSel();
  const first = pr.last && pr.last.file && pr.files.some(f => f.id === pr.last.file) ? pr.last : pr.files[0] ? {file: pr.files[0].id, page: 1} : null;
  if (first) await gotoPage(first.file, first.page || 1); else showDrop(true);
  setTool(S.cond ? "draw" : "select");
  refresh();
}
async function showStart(){
  const all = (await dbAll("projects")).sort((a, b) => b.updated.localeCompare(a.updated));
  $("projList").innerHTML = all.length ? '<table class="plist"><thead><tr><th>Project</th><th>PDFs</th><th>Measurements</th><th>Last changed</th><th></th></tr></thead><tbody>' +
    all.map(p => `<tr><td><a data-open="${esc(p.id)}">${esc(p.name)}</a></td><td>${p.files.length}</td><td>${p.items.length}</td><td>${dmy(p.updated)}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-dup="${esc(p.id)}">Duplicate</button> <button class="btn sm dng" data-del="${esc(p.id)}">Delete</button></td></tr>`).join("") + "</tbody></table>"
    : '<div class="empty">No projects yet — start one with <b>+ New project</b>, then drop a PDF drawing on it.</div>';
  $("start").classList.add("on");
}

/* ------------------------------------------------------------------ PDFs */
async function loadPdfjs(){
  if (pdfjs) return pdfjs;
  try { pdfjs = await import(PDFJS + "pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs"; }
  catch (e) { pdfjs = null; throw new Error("The PDF engine (pdf.js) could not be loaded — check the internet connection."); }
  return pdfjs;
}
async function doc(fileId){
  if (S.docs[fileId]) return S.docs[fileId];
  const rec = await dbGet("pdfs", fileId);
  if (!rec) throw new Error("PDF missing — add “" + ((P.proj.files.find(f => f.id === fileId) || {}).name || fileId) + "” again with + PDF to re-attach it.");
  const lib = await loadPdfjs();
  S.docs[fileId] = await lib.getDocument({data: new Uint8Array(rec.data.slice(0)), isEvalSupported: false}).promise;
  return S.docs[fileId];
}
async function addFiles(files){
  if (!P.proj) return;
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { toast(f.name + " is not a PDF"); continue; }
    busy("Opening " + f.name + "…");
    try {
      const data = await f.arrayBuffer();
      let meta = P.proj.files.find(x => x.name === f.name && x.size === f.size);
      const lib = await loadPdfjs();
      const d = await lib.getDocument({data: new Uint8Array(data.slice(0)), isEvalSupported: false}).promise;
      if (!meta) { meta = {id: uid("F"), name: f.name, size: f.size, pages: d.numPages, added: new Date().toISOString()}; P.proj.files.push(meta); }
      await dbPut("pdfs", {name: f.name, size: f.size, data}, meta.id);
      if (S.docs[meta.id]) S.docs[meta.id].destroy();
      S.docs[meta.id] = d;
      save(); buildPageSel();
      await gotoPage(meta.id, 1);
      toast(f.name + " — " + d.numPages + " page" + (d.numPages > 1 ? "s" : ""));
    } catch (e) { toast(e.message || String(e), 5000); }
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

async function gotoPage(fileId, pageNo){
  let d;
  try { d = await doc(fileId); } catch (e) { toast(e.message, 6000); showDrop(true); return; }
  pageNo = Math.max(1, Math.min(d.numPages, pageNo));
  if (S.renderTask) { try { S.renderTask.cancel(); } catch (e) {} S.renderTask = null; }
  S.fileId = fileId; S.pageNo = pageNo; S.key = keyOf(fileId, pageNo);
  S.page = await d.getPage(pageNo);
  S.base = S.page.getViewport({scale: 1});
  S.draft = []; S.measure = null; S.measures = []; S.snap = null; S.autoShow = null; S.cmp = null; $("cmpLegend").style.display = "none";
  P.proj.last = {file: fileId, page: pageNo}; save();
  $("pageSel").value = fileId + "|" + pageNo;
  showDrop(false);
  fit();
  await renderLow();
  renderHi(true);
  indexPage();   // vector lines + scale note, in the background
  refresh();
}

/* ------------------------------------------------------------------ rendering */
const stage = () => $("stage");
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
  try { await S.cmp.pg.render({canvasContext: thinLines(c2), viewport: S.cmp.pg.getViewport({scale}), transform: [1, 0, 0, 1, tx + S.cmp.dx * scale, ty + S.cmp.dy * scale]}).promise; } catch (e) { return; }
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
  try { S.cmp = {file: o.f.id, page: o.i, pg: await (await doc(o.f.id)).getPage(o.i), dx: 0, dy: 0, name: o.f.name.replace(/\.pdf$/i, "") + " p." + o.i}; } catch (e) { return toast(e.message, 5000); }
  $("cmpLegend").innerHTML = `<b style="color:#2a52d6">■ this page</b> · <b style="color:#d03b3b">■ ${esc(S.cmp.name)}</b> · dark = same <button class="btn sm" id="cmpOff">Off</button>`; $("cmpLegend").style.display = "flex";
  $("cmpOff").onclick = () => { S.cmp = null; $("cmpLegend").style.display = "none"; renderLow(); renderHi(true); };
  renderLow(); renderHi(true);
}
async function renderLow(){
  const longSide = Math.max(S.base.width, S.base.height), sc = Math.min(3, 3000 / longSide);
  const vp = S.page.getViewport({scale: sc}), c = $("low");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = thinLines(c.getContext("2d")); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  S.low = {s: sc};
  try { await S.page.render({canvasContext: ctx, viewport: vp}).promise; } catch (e) {}
  await overlayCmp(ctx, c.width, c.height, sc, 0, 0);
  applyView();
}
let hiT = null;
function renderHi(now){
  clearTimeout(hiT);
  hiT = setTimeout(async () => {
    if (!S.page) return;
    if (S.renderTask) { try { S.renderTask.cancel(); } catch (e) {} }
    const st = stage(), dpr = Math.min(window.devicePixelRatio || 1, 2), c = $("hi"), v = Object.assign({}, S.view);
    const w = Math.max(1, Math.floor(st.clientWidth * dpr)), h = Math.max(1, Math.floor(st.clientHeight * dpr));
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const ctx = thinLines(off.getContext("2d"));
    const task = S.page.render({canvasContext: ctx, viewport: S.page.getViewport({scale: v.s * dpr}), transform: [1, 0, 0, 1, v.tx * dpr, v.ty * dpr]});
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
  draw();
}
function zoomAt(f, sx, sy){
  const v = S.view, ns = Math.max(0.05, Math.min(60, v.s * f)); f = ns / v.s;
  S.view = {s: ns, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f};
  applyView(); renderHi();
}
const toScr = p => [p[0] * S.view.s + S.view.tx, p[1] * S.view.s + S.view.ty];
const toBase = (x, y) => [(x - S.view.tx) / S.view.s, (y - S.view.ty) / S.view.s];

/* ------------------------------------------------------------------ vector lines (snapping) and scale note */
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const app = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
async function indexPage(){
  const key = S.key, page = S.page, base = S.base;
  if (!S.geo[key]) {
    busy("Reading drawing lines…");
    try {
      const ops = await page.getOperatorList(), O = pdfjs.OPS, segs = [], stack = [], styles = [], styleIx = new Map();
      let ctm = base.transform.slice(), images = 0, lw = 1, dash = false, sCol = "0,0,0", fCol = "0,0,0", sp = 0, pend = -1, pendCtm = ctm, cur = null, start = null;
      const push = (a, b, fl) => { if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.05 && segs.length < 600000) segs.push([a[0], a[1], b[0], b[1], fl || 0, sp, -1]); };
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
        if (fn === O.save) stack.push(gs());
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
      S.geo[key] = {segs, grid, cell, images, styles};
    } catch (e) { S.geo[key] = {segs: [], grid: new Map(), cell: 24, images: 0, styles: [], err: String(e)}; }
    busy("");
  }
  if (!S.texts[key]) {
    try {
      const tc = await page.getTextContent();
      S.texts[key] = tc.items.filter(t => t.str && t.str.trim()).map(t => { const p = base.convertToViewportPoint(t.transform[4], t.transform[5]); return {s: t.str, x: p[0], y: p[1]}; });
    } catch (e) { S.texts[key] = []; }
  }
  if (key === S.key && P.proj && !P.proj.scales[key]) {
    const c = scaleCandidates(key);
    if (c.length) { P.proj.scales[key] = {ptPerFt: c[0].ptPerFt, how: "note", text: c[0].text, note: c[0].note || "", factor: c[0].factor || 1, verified: false, at: new Date().toISOString()}; save(); toast("Scale read from the drawing: " + c[0].label + " — check it against a known dimension (scale chip → Verify)", 5200); }
  }
  if (key === S.key) refresh();
}
/* scale notes on the page: 1/8" = 1'-0", 3/16"=1'-0", 1" = 20', 1:100 (with "@ A1" paper size if given) */
const ISO = {A0: 3370.39, A1: 2383.94, A2: 1683.78, A3: 1190.55, A4: 841.89};   // ISO 216 long side in pt (A1 594 × 841 → 841 / 25.4 × 72)
/* "1/8\" = 1'-0\"", "1\" = 20'", "1:100" -> inches on paper per foot (0 if none). loose: a bare 1:N counts */
function inPerFtOf(raw, loose){
  const s = String(raw || "").replace(/[’′]/g, "'").replace(/[”″“]/g, '"');
  let m;
  if ((m = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*"\s*=\s*1\s*'\s*-?\s*0?\s*"?/.exec(s))) {
    const t = m[1].trim(), q = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t), f = /^(\d+)\/(\d+)$/.exec(t);
    return {v: q ? +q[1] + +q[2] / +q[3] : f ? +f[1] / +f[2] : +t, label: m[0].replace(/\s+/g, " ").trim()};
  }
  if ((m = /\b1\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'/.exec(s))) return {v: 1 / +m[1], label: m[0]};
  if ((m = /(?:^|[^\d.:\/])1\s*:\s*(\d{1,4})(?![\d:])/.exec(s)) && (loose || /scale|^\s*1\s*:/i.test(s))) return {v: 12 / +m[1], label: "1:" + m[1]};
  return {v: 0, label: ""};
}
function scaleCandidates(key){
  const T = S.texts[key] || [], out = [], seen = {};
  const longPt = S.base ? Math.max(S.base.width, S.base.height) : 0;
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

function snapAt(q){
  const g = S.geo[S.key], r = SNAP_PX / S.view.s;
  let best = null;
  const take = (p, type, pri) => { const d = dist(p, q); if (d <= r && (!best || pri < best.pri || (pri === best.pri && d < best.d))) best = {p, type, pri, d}; };
  // points already measured rank with the drawing's endpoints (nearest wins); of the shape being drawn only its first
  // point is a target (closing an area) — never the last one, which would make a zero-length run
  (P.proj.items || []).forEach(it => { if (it.file === S.fileId && it.page === S.pageNo && !hiddenItem(it)) it.pts.forEach(p => take(p, "point", 1)); });
  if (S.draft.length >= 2 && isAreaDraft()) take(S.draft[0], "first point", 0);
  if ($("snapOn").checked && g && g.segs.length) {
    const c = g.cell, x0 = Math.floor((q[0] - r) / c), x1 = Math.floor((q[0] + r) / c), y0 = Math.floor((q[1] - r) / c), y1 = Math.floor((q[1] + r) / c), ids = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (g.grid.get(x + "," + y) || []).forEach(i => ids.add(i));
    const near = [];
    ids.forEach(i => { const s = g.segs[i], a = [s[0], s[1]], b = [s[2], s[3]]; if (distSeg(q, a, b) <= r) near.push([a, b]); });
    near.forEach(([a, b]) => { take(a, "endpoint", 1); take(b, "endpoint", 1); });
    if (near.length < 80) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) { const x = segX(near[i][0], near[i][1], near[j][0], near[j][1]); if (x) take(x, "intersection", 1); }
    near.forEach(([a, b]) => take([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], "midpoint", 2));
    near.forEach(([a, b]) => take(projSeg(q, a, b), "on line", 3));
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
const AUTO_DEF = {src: "image", gap: 4, minLen: 0.5, pocket: 7, skipDoors: true, dashBound: true, wall: null, show: false};
const autoOpt = () => Object.assign({}, AUTO_DEF, (P.proj && P.proj.auto) || {});
function segsIn(g, x0, y0, x1, y1){
  const c = g.cell, ids = new Set();
  for (let x = Math.floor(x0 / c); x <= Math.floor(x1 / c); x++) for (let y = Math.floor(y0 / c); y <= Math.floor(y1 / c); y++) (g.grid.get(x + "," + y) || []).forEach(i => ids.add(i));
  return [...ids].sort((a, b) => a - b);
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
    if (arc) { c.forEach(i => skip.add(i)); if (dist(A, B) > 0.8 * k) { const mi = G[c[Math.floor(c.length / 2)]]; arcs.push([A, B, [mi[0], mi[1]]]); } }
  });
  // a door leaf runs from the hinge to one end of the swing, as long as the swing's radius (hinge to the other end)
  if (arcs.length) ids.forEach(i => {
    if (skip.has(i)) return; const s = G[i], p = [s[0], s[1]], q = [s[2], s[3]], L = dist(p, q);
    if (L < 1.2 * k || L > 7 * k) return;
    for (const [A, B] of arcs) for (const [tip, hinge] of [[p, q], [q, p]]) for (const [T, J] of [[A, B], [B, A]])
      if (dist(tip, T) < 0.35 * k && Math.abs(dist(hinge, J) - L) < 0.2 * L) { skip.add(i); return; }
  });
  // the door opening: from the swing's centre (hinge) to the end of the swing that lies on the wall face, i.e. the end
  // whose line has the wall continuing behind the hinge and beyond the jamb
  const lines = [], wallNear = (pt, u) => ids.some(i => { if (skip.has(i)) return false; const s = G[i], l = Math.hypot(s[2] - s[0], s[3] - s[1]); if (l < 0.3 * k) return false;
    return Math.abs(u[0] * (s[3] - s[1]) - u[1] * (s[2] - s[0])) / l < 0.12 && distSeg(pt, [s[0], s[1]], [s[2], s[3]]) < 0.25 * k; });
  arcs.forEach(([A, B, M]) => {
    const C = circumcentre(A, M, B); if (!C) return;
    const R = (dist(C, A) + dist(C, B)) / 2; if (R < 1.2 * k || R > 6 * k) return;
    const sc = X => { const u = [(X[0] - C[0]) / R, (X[1] - C[1]) / R]; return (wallNear([C[0] - u[0] * 0.5 * k, C[1] - u[1] * 0.5 * k], u) ? 1 : 0) + (wallNear([X[0] + u[0] * 0.5 * k, X[1] + u[1] * 0.5 * k], u) ? 1 : 0); };
    const a = sc(A), b = sc(B);
    if (a >= b) lines.push([C[0], C[1], A[0], A[1]]); if (b >= a) lines.push([C[0], C[1], B[0], B[1]]);
  });
  skip.lines = lines;
  return skip;
}
function circumcentre(a, b, c){
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null;
  const A = a[0] * a[0] + a[1] * a[1], B = b[0] * b[0] + b[1] * b[1], C = c[0] * c[0] + c[1] * c[1];
  return [(A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d, (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d];
}
function barrierIds(g, ids, k, o){
  const door = o.skipDoors ? doorSymbols(g, ids, k) : new Set(), minL = o.minLen * k;
  const wall = o.wall ? {col: o.wall.split("|")[0], w: +o.wall.split("|")[1] || 0} : null;
  const out = ids.filter(i => { const s = g.segs[i];
    if (door.has(i) || (s[4] & 8) || (!o.dashBound && (s[4] & 2))) return false;
    if (Math.hypot(s[2] - s[0], s[3] - s[1]) < minL) return false;
    if (wall) { const st = (g.styles[s[6]] || "|0").split("|"); if (st[0] !== wall.col || +st[1] < 0.9 * wall.w) return false; }
    return true; });
  out.doors = door.lines || [];
  return out;
}
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
function closeMask(m, W, H, R){   // morphological closing with a disc of radius R px: fills pockets and notches narrower than 2R
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
function fillPockets(m, ink, W, H, wallPx, maxPx, minTouch, minPx){
  const N = W * H, f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H);
  const solid = new Uint8Array(N), w2 = wallPx * wallPx;
  for (let i = 0; i < N; i++) solid[i] = m[i] || (ink[i] && f[i] <= w2) ? 1 : 0;
  const seen = new Uint8Array(N), st = new Int32Array(N);
  for (let i0 = 0; i0 < N; i0++) {
    if (solid[i0] || seen[i0]) continue;
    const comp = []; let top = 0, open = false, touch = 0; seen[i0] = 1; st[top++] = i0;
    while (top) { const i = st[--top], x = i % W, y = (i - x) / W; comp.push(i);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
      if (f[i] <= 64) touch++;   // within 8 px of the room: only an outline between
      if (x > 0 && !solid[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st[top++] = i - 1; }
      if (x < W - 1 && !solid[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st[top++] = i + 1; }
      if (y > 0 && !solid[i - W] && !seen[i - W]) { seen[i - W] = 1; st[top++] = i - W; }
      if (y < H - 1 && !solid[i + W] && !seen[i + W]) { seen[i + W] = 1; st[top++] = i + W; } }
    if (!open && touch >= minTouch && comp.length >= minPx && comp.length <= maxPx) comp.forEach(i => { m[i] = 1; });   // gaps in a wall's hatching are smaller
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
function squareUp(Q, tol, gap, maxD){   // near-rectilinear outline -> rectilinear; detours shorter than the gap (door bulges) dropped
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
  return E.length >= 4 ? edgesToPoly(E) : null;
}
function offsetPoly(Q, d){   // every edge moved outward by d
  const n = Q.length, s = signedArea(Q) > 0 ? 1 : -1, L = [];
  for (let i = 0; i < n; i++) { const a = Q[i], b = Q[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nn = [s * dy / l, -s * dx / l];
    L.push({p: [a[0] + nn[0] * d, a[1] + nn[1] * d], u: [dx / l, dy / l], n: nn}); }
  return Q.map((q, i) => { const A = L[(i + n - 1) % n], B = L[i], den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 1e-6) return [q[0] + B.n[0] * d, q[1] + B.n[1] * d];
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den; return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]; });
}
function snapToWalls(Q, g, ids, tol, k, slack){   // rectilinear outline: each edge onto the nearest parallel drawing line it runs along —
  const E = orthoEdges(Q), sgn = signedArea(Q) > 0 ? 1 : -1;   // on the outward side first: a wall face is outside the room, furniture inside
  if (E.some(e => e.o === "D")) return Q;
  E.forEach(e => {
    const out = e.o === "H" ? -sgn * e.dir : sgn * e.dir;   // outward normal of this edge along y (H) or x (V)
    const lo = Math.min(e.o === "H" ? e.a[0] : e.a[1], e.o === "H" ? e.b[0] : e.b[1]), hi = Math.max(e.o === "H" ? e.a[0] : e.a[1], e.o === "H" ? e.b[0] : e.b[1]);
    let best = null;
    ids.forEach(i => { const s = g.segs[i], h = Math.abs(s[3] - s[1]) <= 0.02 * Math.abs(s[2] - s[0]), v = Math.abs(s[2] - s[0]) <= 0.02 * Math.abs(s[3] - s[1]);
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
async function inkMask(x0, y0, W, H, px, minPx, dashBound, kft){
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", {willReadFrequently: true}); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await S.page.render({canvasContext: ctx, viewport: S.page.getViewport({scale: 1 / px}), transform: [1, 0, 0, 1, -x0 / px, -y0 / px]}).promise;
  const d = ctx.getImageData(0, 0, W, H).data, N = W * H, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 190 ? 1 : 0;
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
  const small = [];
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
  const rc = Math.max(1.5, 0.2 * kft / px), f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = m[i] ? 0 : 1e20;
  edt2(f, W, H);
  const dil = new Uint8Array(N); for (let i = 0; i < N; i++) dil[i] = f[i] <= rc * rc ? 1 : 0;
  for (let i = 0; i < N; i++) f[i] = dil[i] ? 1e20 : 0;
  edt2(f, W, H);
  const thin = new Uint8Array(N), keep = (rc - 1) * (rc - 1);
  for (let i = 0; i < N; i++) thin[i] = m[i] || f[i] > keep ? 1 : 0;
  // the wall network: marks spanning 8 ft or more. Loose marks inside a room (a word, a tag, a free-standing bed) bound
  // the room but must not split its core when openings are closed
  const big = new Uint8Array(N), bigPx = 8 * kft / px;
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
async function autoRoom(seed){   // -> {pts} or {err}
  const k = hereScale(seed), g = S.geo[S.key] || {segs: [], grid: new Map(), cell: 24, styles: []};
  if (!k) return {err: "Set the page scale first (K) — the door gap and wall offsets are in feet."};
  const o = autoOpt(), img = o.src !== "vector";
  if (!img && !g.segs.length) return {err: "This page has no vector lines — switch Auto area settings (⚙) to ‘walls from the drawing image’."};
  for (const [half, pxFt] of [[45, 0.06], [110, 0.14]]) {
    const px = pxFt * k, W = Math.ceil(2 * half * k / px), H = W, x0 = seed[0] - half * k, y0 = seed[1] - half * k;
    const ids = barrierIds(g, segsIn(g, x0, y0, x0 + W * px, y0 + H * px), k, o);
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
    let thin, bar;
    if (img) { const ink = await inkMask(x0, y0, W, H, px, Math.max(o.minLen, 1) * k / px, o.dashBound, k); thin = ink.thin;   // a solid door swing stays in: its area is a pocket, added back
      if (ids.doors.length) { const dl = raster(2 * px, true); for (let i = 0; i < N; i++) if (dl[i]) { thin[i] = 1; ink.big[i] = 1; } }
      bar = widen(ink.big, W, H, o.gap * k / px / 2); }
    else { thin = raster(2 * px); bar = raster(Math.max(o.gap * k, 2 * px)); }
    if (fences.length) { const fm = fenceMask(); for (let i = 0; i < N; i++) if (fm[i]) { thin[i] = 1; bar[i] = 1; } }   // the user's fences close what the drawing leaves open
    if (o.show) S.autoShow = {key: S.key, x0, y0, px, W, H, url: maskUrl(thin, W, H)};
    // B: every line widened to the door gap, so all openings close — the room's core — grown back out to the wall faces
    const sb = seedIn(bar, rpx), sa = seedIn(thin, 4);
    let m;
    if (sb >= 0) {
      const B = fill(bar, sb, true); if (!B) continue;
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
      const A = sa >= 0 ? fill(thin, sa, false) : null;
      if (A) {
        const seen = new Uint8Array(N), st = new Int32Array(N);
        for (let i0 = 0; i0 < N; i0++) {
          if (!A.m[i0] || m[i0] || seen[i0]) continue;
          const comp = []; let top = 0, room = false; seen[i0] = 1; st[top++] = i0;
          while (top) { const i = st[--top], x = i % W, y = (i - x) / W; comp.push(i);
            if (!bar[i] || x === 0 || y === 0 || x === W - 1 || y === H - 1) room = true;
            for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && A.m[j] && !m[j] && !seen[j] && Math.abs(j % W - x) <= 1) { seen[j] = 1; st[top++] = j; } }
          if (!room) comp.forEach(i => { m[i] = 1; });
        }
      }
    } else {   // narrower than the gap all over (a passage): the thin-line fill alone, if it stays closed
      const A = sa >= 0 ? fill(thin, sa, true) : null;
      if (!A) return {err: "This space is narrower than the door gap (" + f3(o.gap) + " ft) and is not closed — lower ‘Close gaps’ in the auto-area settings (⚙), or draw it."};
      m = A.m;
    }
    if (o.pocket > 0) { for (let pass = 0; pass < 2; pass++) fillPockets(m, thin, W, H, Math.max(1.5, o.pocket / 2 + 0.5) * k / px, (o.pocket * k / px) ** 2 * 1.2, k / px, 2 * (k / px) ** 2); closeMask(m, W, H, Math.min(o.pocket, 3) * k / px / 2); }
    const loop = outerLoop(m, W, H); if (!loop || loop.length < 4) return {err: "No closed space found at that point."};
    let Q = dpClosed(loop.map(p => [x0 + p[0] * px, y0 + p[1] * px]), 1.6 * px);
    const sq = squareUp(Q, 3 * px, o.gap * k, Math.max(o.gap, o.pocket) * k);
    Q = sq ? (ids.length ? snapToWalls(sq, g, ids, Math.max(4 * px, 0.35 * k), k, px) : offsetPoly(sq, (img ? 1.5 : 1) * px)) : offsetPoly(Q, (img ? 1.5 : 1) * px);
    Q = cleanPoly(Q);
    if (Q.length < 3 || polyArea(Q) < 1e-6) return {err: "No closed space found at that point."};
    return {pts: Q, rect: !!sq};
  }
  return {err: "The space leaks — an opening wider than the door gap (" + f3(autoOpt().gap) + " ft) joins it to the outside. Raise ‘Close gaps’ (⚙ next to Auto area) or draw it."};
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
  busy("Finding the room…");
  await new Promise(r => setTimeout(r, 20));
  let res; try { res = await autoRoom(p); } catch (e) { res = {err: "Auto area failed: " + (e.message || e)}; }
  busy("");
  if (res.err) return toast(res.err, 6000);
  const id = uid("I");
  mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: res.pts, nos: 1, label: ""}); });
  S.sel = id; draw(); renderSheet();
  const k = hereScale(p); toast("Room " + f2(polyArea(res.pts) / k / k) + " Sft" + (res.rect ? "" : " (not square — check the outline)") + " — Select (V) and drag points to adjust", 4200);
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
    <div class="fg w2"><label><input type="checkbox" id="aoDoor" style="width:auto"${o.skipDoors ? " checked" : ""}> Ignore door swings and door leaves</label></div>
    <div class="fg w2"><label><input type="checkbox" id="aoDash" style="width:auto"${o.dashBound ? " checked" : ""}> Straight dashed lines bound a room (e.g. an open dress / wardrobe area) — untick if dashed lines on your drawings are beams overhead</label></div>
    <div class="fg w2"><label><input type="checkbox" id="aoShow" style="width:auto"${o.show ? " checked" : ""}> Show the detected walls (pink) after each auto area — to see why a room leaks</label></div></div>
    <p class="small" style="margin-top:10px">If furniture or fixtures are drawn in the same pen as the walls, <b>Pick a wall</b> so only lines of that colour and weight bound the room.</p>`, "Save", () => {
      const gap = parseFt($("aoGap").value), pocket = parseFt($("aoPk").value || "0"), minLen = parseFt($("aoMin").value || "0");
      if (!(gap > 0.2 && gap < 30)) return "Close gaps: a width in ft, e.g. 4";
      if (isNaN(pocket) || isNaN(minLen)) return "Enter decimal feet";
      return {src: $("aoSrc").value, gap, pocket: Math.max(0, pocket), minLen: Math.max(0, minLen), skipDoors: $("aoDoor").checked, dashBound: $("aoDash").checked, show: $("aoShow").checked}; }, "aoGap");
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
      const w = it.ow ? +it.ow : r3(dist(it.pts[0], it.pts[1]) / k), h = +it.oh || 0, faces = c.unit === "Sft" ? (+c.faces || 1) : 1;
      const r = c.unit === "ft" ? R({nos, L: r3(w), desc: "opening"}) : c.unit === "Sft" ? R({nos: nos * faces, L: r3(w), H: r3(h), desc: "opening"}) : R({nos, L: r3(w), W: r3(+c.t || 0), H: r3(h), desc: "opening"});
      if (c.unit !== "ft" && r3(w) * r3(h) <= (+c.dedMin || 0)) r.below = true;
      rows = [r];
    } else {
      const runs = []; for (let i = 1; i < it.pts.length; i++) runs.push(r3(dist(it.pts[i - 1], it.pts[i]) / k));
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
   Variables: Q net quantity in the condition's unit · A net plan area Sft · P perimeter ft of its areas · L net length
   ft · N count · H height ft · T thickness ft. Functions: ceil floor round min max abs sqrt. Rates carry a source and
   a date; a rate without them is flagged, never assumed. */
function condVars(c){
  const v = {Q: 0, A: 0, P: 0, L: 0, N: 0, H: +c.h || 0, T: +c.t || 0};
  P.proj.items.filter(i => i.cond === c.id).forEach(it => {
    const k = itemScale(it); if (!k) return;
    const rows = rowsOf(it, k), sg = it.kind === "shape" ? 1 : -1, nos = +it.nos || 1;
    rows.forEach(r => { v.Q += r.qty; if (r.below) return;
      if (c.type === "area") v.A += r.sign * (r.nos || 1) * (r.A != null ? r.A : (r.L || 0) * (r.W || 0)); });
    if (c.type === "area" && it.kind === "shape") v.P += nos * polyLen(itemPoly(it), true) / k;
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
function billLines(){   // [{c, kind:"cond"|"asm", a, name, unit, qty, rate, src, date, f, err}]
  const out = [];
  P.proj.conds.forEach(c => {
    const vars = condVars(c);
    if (!P.proj.items.some(i => i.cond === c.id) && !(c.asm || []).length) return;
    out.push({c, kind: "cond", name: c.name, unit: c.unit, qty: vars.Q, rate: +c.rate || 0, src: c.rateSrc || "", date: c.rateDate || ""});
    (c.asm || []).forEach(a => { let qty = 0, err = ""; try { qty = evalFormula(a.f || "0", vars); } catch (e) { err = e.message; }
      out.push({c, kind: "asm", a, name: a.name, unit: a.unit, qty, rate: +a.rate || 0, src: a.src || "", date: a.date || "", f: a.f, err}); });
  });
  return out;
}
const rateOk = l => !(l.rate > 0) || (l.src && l.date);
function renderBill(){
  const el = $("bill"); if (!P.proj) { el.innerHTML = ""; return; }
  const L = billLines(); let tot = 0, n = 0;
  if (!L.length) { el.innerHTML = '<div class="empty">The bill lists every condition with its quantity, plus the items each one drives (open a condition’s <b>Assembly</b> — e.g. floor tiles from the floor area, skirting from its perimeter). Rates are entered by you with their source and date.</div>'; return; }
  let h = '<table class="sh bill"><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount PKR</th></tr></thead><tbody>';
  L.forEach(l => {
    const amt = l.qty * l.rate; tot += amt;
    const flag = !rateOk(l) ? '<span style="color:var(--red)">rate: ASSUMPTION — no dated source</span>' : l.rate > 0 ? "rate: " + esc(l.src) + ", " + esc(dmy(l.date)) : "rate not set";
    h += `<tr class="${l.kind === "cond" ? "ch2" : "it"}"><td>${l.kind === "asm" ? "↳ " : `${++n}. <span class="sw" style="background:${l.c.color}"></span>`}${esc(l.name)}${l.kind === "cond" ? ` <button class="rn" data-asm="${esc(l.c.id)}" title="Items this condition drives, and rates">&#9881; Assembly</button>` : ""}
      <div class="ds">${l.kind === "asm" ? (l.err ? '<span style="color:var(--red)">' + esc(l.err) + "</span>" : "= " + esc(l.f)) : "measured"} · ${flag}</div></td>
      <td class="n">${f2(l.qty)}<div class="ds">${esc(l.unit)}</div></td><td class="n">${l.rate ? f2(l.rate) : "—"}</td><td class="n">${l.rate ? f2(amt) : "—"}</td></tr>`;
  });
  h += `<tr class="tot"><td>Total</td><td></td><td></td><td class="n">${f2(tot)}</td></tr></tbody></table>`;
  el.innerHTML = h;
}
async function asmDialog(c){
  const rows = JSON.parse(JSON.stringify(c.asm || [])), vars = condVars(c);
  const row = (a, n) => `<tr data-r="${n}"><td><input type="text" data-k="name" value="${esc(a.name || "")}" placeholder="e.g. Floor tiles"></td><td><input type="text" data-k="unit" value="${esc(a.unit || "")}" style="width:52px" placeholder="Sft"></td>
    <td><input type="text" data-k="f" value="${esc(a.f || "")}" placeholder="A*1.05"></td><td><input type="number" data-k="rate" value="${a.rate || ""}" style="width:80px" placeholder="0"></td>
    <td><input type="text" data-k="src" value="${esc(a.src || "")}" placeholder="source"></td><td><input type="date" data-k="date" value="${esc(a.date || "")}"></td><td><button class="btn sm dng" data-del="${n}" type="button">&times;</button></td></tr>`;
  const body = () => `<p class="small">Now: Q = ${f2(vars.Q)} ${esc(c.unit)}${c.type === "area" ? ` · A = ${f2(vars.A)} Sft · P = ${f3(vars.P)} ft` : ""}${c.type === "linear" ? ` · L = ${f3(vars.L)} ft` : ""} · N = ${vars.N}${vars.H ? " · H = " + f3(vars.H) : ""}${vars.T ? " · T = " + f3(vars.T) : ""}.
    Formulas use Q A P L N H T and ceil floor round min max abs sqrt, e.g. <code>A*1.05</code>, <code>P</code>, <code>ceil(A/4)</code>.</p>
    <div class="grid" style="margin:8px 0"><div class="fg"><label>Rate for ${esc(c.name)} (PKR / ${esc(c.unit)})</label><input type="number" id="crRate" value="${c.rate || ""}" placeholder="0"></div>
    <div class="fg"><label>Rate source</label><input type="text" id="crSrc" value="${esc(c.rateSrc || "")}" placeholder="e.g. Phoenix GRN RCP-312"></div><div class="fg"><label>Rate date</label><input type="date" id="crDate" value="${esc(c.rateDate || "")}"></div></div>
    <table class="asm"><thead><tr><th>Item it drives</th><th>Unit</th><th>Formula</th><th>Rate PKR</th><th>Source</th><th>Date</th><th></th></tr></thead><tbody id="asmB">${rows.map(row).join("")}</tbody></table>
    <button class="btn sm" id="asmAdd" type="button" style="margin-top:6px">+ Item</button>
    <p class="small" style="margin-top:8px">No rate is assumed: leave it 0 if there is no dated source. A rate without source and date is shown as an assumption.</p>`;
  const read = () => document.querySelectorAll("#asmB tr").forEach(tr => { const a = rows[+tr.dataset.r]; tr.querySelectorAll("[data-k]").forEach(inp => { a[inp.dataset.k] = inp.dataset.k === "rate" ? (+inp.value || 0) : inp.value.trim(); }); });
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
  if (t !== "select") { S.sel = null; S.selPt = -1; S.selMark = null; }
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
  if (t !== "auto") S.pickWall = false;
  S.tool = t; S.draft = []; S.measure = t === "measure" ? S.measure : null;
  document.querySelectorAll("#tools .tool").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  stage().className = t === "pan" ? "pan" : t === "select" ? "" : "draw";
  hint(); draw(); renderProps();
}
function hint(){
  const c = S.cond ? cond(S.cond) : null, t = S.tool;
  const H = {select: "Click a measurement to select it; drag its points to edit; Delete removes it.", pan: "Drag to pan; scroll to zoom.",
    draw: !c ? "" : c.type === "area" ? "Click the corners; click the first point, right-click or press Enter to close." : c.type === "linear" ? "Click along the run; Enter, double-click or right-click to finish." : "Click each item to count it; Esc when done.",
    fence: "Draw a line across the opening where Auto area leaks (click points; double-click, right-click or Enter to finish). It counts as a wall for Auto area only.", vsearch: "Box one symbol (two corners) — every matching symbol is counted.", note: "Click where the note goes, then type it.", cloud: "Click two opposite corners of the area to cloud.", arrow: "Click the tail, then the head of the arrow.", hilite: "Click two opposite corners to highlight.",
    rect: "Click two opposite corners.", circle: "Click the centre, then a point on the edge.", vp: "Click two opposite corners of the detail drawn at another scale.", count: "Click each item to count it — numbered as you go. Select (V) a marker and press Delete to remove it.", auto: S.pickWall ? "Click a wall line — only lines of its colour and weight will bound rooms." : "Click inside a room — its area is traced from the walls, across door openings. ⚙ for settings.", ded: c && c.type === "area" ? "Draw the void / cut-out to deduct; Enter to close." : "Draw the length to deduct; Enter to finish.",
    open: "Click both sides of the opening, then enter its height.", measure: "Click points; double-click, right-click or Enter ends a measurement (it stays on screen). Esc clears. Nothing is saved.",
    cal: "Click both ends of a known dimension, then enter its length."};
  $("stHint").textContent = H[t] || "";
}
function evPos(e){ const r = stage().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function cursorPoint(e, sp){
  const raw = toBase(sp[0], sp[1]);
  let p = raw, s = null;
  if (["draw", "rect", "ded", "open", "measure", "cal", "circle", "vp", "arrow", "fence"].indexOf(S.tool) >= 0 || S.drag) { s = snapAt(raw); if (s) p = s.p; }
  const last = S.drag ? null : S.draft[S.draft.length - 1];
  if (e.shiftKey && last) { const dx = Math.abs(p[0] - last[0]), dy = Math.abs(p[1] - last[1]); p = dx >= dy ? [p[0], last[1]] : [last[0], p[1]]; if (s) s = Object.assign({}, s, {type: s.type + " + straight"}); }
  return {p, s};
}
function onDown(e){
  if (!S.page) return;
  const sp = evPos(e);
  stage().setPointerCapture(e.pointerId);
  if (e.pointerType === "touch") {
    S.touches = S.touches || {}; S.touches[e.pointerId] = sp;
    const ids = Object.keys(S.touches);
    if (ids.length === 2) { const a = S.touches[ids[0]], b = S.touches[ids[1]]; S.pinch = {d: dist(a, b), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: Object.assign({}, S.view)}; S.drag = null; return; }
  }
  if (e.button === 2 && S.draft.length && ["draw", "ded", "measure", "fence"].indexOf(S.tool) >= 0) { e.preventDefault(); return endDraft(); }   // right-click ends the line / area
  if (e.button === 1 || S.space || S.tool === "pan" || (e.button === 2)) { S.drag = {pan: true, sp, v: Object.assign({}, S.view)}; stage().classList.add("panning"); e.preventDefault(); return; }
  if (e.button !== 0) return;
  if (S.pickWall) return pickWallAt(sp);
  if (S.tool === "auto") return autoAt(toBase(sp[0], sp[1]));
  const {p} = cursorPoint(e, sp);
  if (S.tool === "select") return selectAt(sp, e);
  if (S.tool === "count" || (S.tool === "draw" && cond(S.cond).type === "count")) return addCount(p);
  if (S.tool === "rect") { if (!S.draft.length) S.draft = [p]; else { const a = S.draft[0]; finish([a, [p[0], a[1]], p, [a[0], p[1]]]); } draw(); return; }
  if (S.tool === "draw" || S.tool === "ded" || S.tool === "measure" || S.tool === "fence") {
    const closeArea = isAreaDraft() && S.draft.length >= 3 && dist(toScr(S.draft[0]), toScr(p)) <= SNAP_PX;
    if (closeArea) return finish(S.draft.slice());
    if (S.draft.length && dist(S.draft[S.draft.length - 1], p) < 1e-6) return;
    S.draft.push(p); if (S.tool === "measure") S.measure = S.draft.slice(); draw(); return;
  }
  if (S.tool === "open" || S.tool === "cal" || S.tool === "circle" || S.tool === "vp") { S.draft.push(p); if (S.draft.length === 2) finish(S.draft.slice()); draw(); }
  if (S.tool === "note") return addMark("note", [p]);
  if (S.tool === "vsearch") { S.draft.push(toBase(sp[0], sp[1])); if (S.draft.length === 2) { const d = S.draft; S.draft = []; findSimilar([Math.min(d[0][0], d[1][0]), Math.min(d[0][1], d[1][1]), Math.max(d[0][0], d[1][0]), Math.max(d[0][1], d[1][1])]); } draw(); return; }
  if (S.tool === "cloud" || S.tool === "arrow" || S.tool === "hilite") { S.draft.push(p); if (S.draft.length === 2) { const d = S.draft.slice(); S.draft = []; addMark(S.tool, d); } draw(); }
}
function endDraft(){   // finish the line / area / measurement being drawn (Enter, double-click, right-click)
  const D = S.draft.slice();
  while (D.length > 1 && dist(toScr(D[D.length - 1]), toScr(D[D.length - 2])) <= HIT_PX / 2) D.pop();   // the extra click of a double-click
  if (isAreaDraft() ? D.length >= 3 : D.length >= 2) return finish(D);
  S.draft = D; draw();
}
function isAreaDraft(){ const c = S.cond ? cond(S.cond) : null; return c && c.type === "area" && (S.tool === "draw" || S.tool === "ded"); }
function onMove(e){
  if (!S.page) return;
  const sp = evPos(e);
  if (S.pinch && e.pointerType === "touch") {
    S.touches[e.pointerId] = sp; const ids = Object.keys(S.touches); if (ids.length < 2) return;
    const a = S.touches[ids[0]], b = S.touches[ids[1]], f = dist(a, b) / S.pinch.d, c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v = S.pinch.v;
    const ns = Math.max(0.05, Math.min(60, v.s * f)), k = ns / v.s;
    S.view = {s: ns, tx: c[0] - (S.pinch.c[0] - v.tx) * k, ty: c[1] - (S.pinch.c[1] - v.ty) * k}; applyView(); renderHi(); return;
  }
  if (S.drag && S.drag.pan) { S.view = {s: S.drag.v.s, tx: S.drag.v.tx + sp[0] - S.drag.sp[0], ty: S.drag.v.ty + sp[1] - S.drag.sp[1]}; applyView(); renderHi(); return; }
  const {p, s} = cursorPoint(e, sp);
  S.cursor = p; S.snap = s; S.cursorScr = sp;
  if (S.drag && S.drag.vertex != null) { const it = P.proj.items.find(i => i.id === S.drag.item); if (it) { it.pts[S.drag.vertex] = p; S.drag.moved = true; refreshSheetSoon(); } }
  if (S.drag && S.drag.mark) { const m = (P.proj.marks || []).find(x => x.id === S.drag.mark), dx = (sp[0] - S.drag.sp[0]) / S.view.s, dy = (sp[1] - S.drag.sp[1]) / S.view.s; if (m && Math.hypot(dx, dy) * S.view.s > 3) { m.pts = S.drag.orig.map(q => [q[0] + dx, q[1] + dy]); S.drag.moved = true; } }
  const k = hereScale(p), vp = viewportAt(S.fileId, S.pageNo, p);
  $("stPos").innerHTML = k ? `x <b>${f3(p[0] / k)}</b> ft · y <b>${f3(p[1] / k)}</b> ft${vp ? " · <b>" + esc(vp.name) + "</b>" : ""}` : "Scale not set";
  $("stSnap").textContent = s ? "Snap: " + s.type : "";
  draw();
}
function onUp(e){
  if (S.touches) { delete S.touches[e.pointerId]; if (Object.keys(S.touches).length < 2) S.pinch = null; }
  if (S.drag && S.drag.mark && S.drag.moved) { const m = (P.proj.marks || []).find(x => x.id === S.drag.mark), pts = m.pts; m.pts = S.drag.orig; mutate(() => { m.pts = pts; }); }
  if (S.drag && S.drag.vertex != null && S.drag.moved) { const it = P.proj.items.find(i => i.id === S.drag.item), pts = it.pts.slice(); it.pts = S.drag.orig; mutate(() => { it.pts = pts; }); }
  S.drag = null; stage().classList.remove("panning");
}
function selectAt(sp, e){
  const mk = markAt(sp);
  if (mk) { S.selMark = mk.id; S.sel = null; S.drag = {mark: mk.id, sp, orig: mk.pts.map(p => p.slice())}; refresh(); return; }
  S.selMark = null;
  const items = P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && !hiddenItem(i));
  const sel = items.find(i => i.id === S.sel);
  if (sel) {   // grab a point of the selected measurement
    const vi = sel.pts.findIndex(p => dist(toScr(p), sp) <= HIT_PX);
    if (vi >= 0) { S.drag = {vertex: vi, item: sel.id, orig: sel.pts.map(p => p.slice())}; S.selPt = vi; draw(); return; }
  }
  const q = toBase(sp[0], sp[1]);
  let hit = null, hitArea = Infinity, hitPt = -1;
  for (let n = items.length - 1; n >= 0; n--) {
    const it = items[n], c = cond(it.cond); if (!c) continue;
    if (c.type === "count") { const vi = it.pts.findIndex(p => dist(toScr(p), sp) <= HIT_PX); if (vi >= 0) { hit = it; hitPt = vi; break; } continue; }
    const closed = c.type === "area" || it.shape === "circle", poly = itemPoly(it);
    let on = false;
    for (let i = 1; i < poly.length + (closed ? 1 : 0); i++) { const a = poly[i - 1], b = poly[i % poly.length]; if (distSeg(sp, toScr(a), toScr(b)) <= HIT_PX) { on = true; break; } }
    if (on) { hit = it; hitArea = 0; break; }
    if (c.type === "area" && pointInPoly(q, poly)) { const a = polyArea(poly); if (a < hitArea) { hit = it; hitArea = a; } }
  }
  S.sel = hit ? hit.id : null; S.selPt = hitPt;
  if (hit && hit.cond !== S.cond) { S.cond = hit.cond; }
  refresh();
}
function addCount(p){
  const c = cond(S.cond); if (!c) return;
  let it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape");
  mutate(() => {
    if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
    it.pts.push(p);
  });
}
async function finish(pts){
  const c = S.cond ? cond(S.cond) : null, t = S.tool;
  S.draft = [];
  if (t === "measure") { S.measure = pts; S.measures.push(pts); draw(); return; }
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
      <div class="fg w2"><label><input type="checkbox" id="dlgAll" style="width:auto"> Use this scale on every page of this PDF</label></div></div>`, "Set scale",
      () => { const ft = parseFt($("dlgLen").value); if (!(ft > 0)) return "Enter a length, e.g. 12.5 or 12'-6\""; return {ft, all: $("dlgAll").checked}; }, "dlgLen");
    if (v) mutate(() => {
      const k = d / v.ft, keys = v.all ? Array.from({length: (P.proj.files.find(f => f.id === S.fileId) || {pages: 1}).pages}, (_, i) => keyOf(S.fileId, i + 1)) : [S.key];
      keys.forEach(kk => { P.proj.scales[kk] = {ptPerFt: k, how: "calibrated", text: f3(v.ft) + " ft over " + d.toFixed(2) + " pt", cal: {a: pts[0], b: pts[1], ft: v.ft, page: S.key}, verified: true, at: new Date().toISOString()}; });
      toast("Scale set: 1 ft = " + k.toFixed(4) + " pt" + (v.all ? " on every page" : ""));
    });
    setTool("select"); return;
  }
  if (!c) return;
  if (t === "open") {
    const ko = hereScale(pts[0]), w = ko ? dist(pts[0], pts[1]) / ko : 0;
    const v = await ask("Opening", `<div class="grid"><div class="fg"><label>Width (ft)</label><input type="text" id="dlgW" value="${w ? f3(w) : ""}"></div>
      <div class="fg"><label>Height (ft)</label><input type="text" id="dlgH" value="${P.proj.last.oh ? f3(P.proj.last.oh) : ""}" autocomplete="off"></div>
      <div class="fg w2"><label>Label</label><input type="text" id="dlgLbl" placeholder="e.g. D1 / W2"></div></div>
      <p class="small" style="margin-top:8px">Deducted from <b>${esc(c.name)}</b> as its own row. Openings of ${f2(+c.dedMin || 0)} Sft or less are listed but not deducted (house rule).</p>`, "Add opening",
      () => { const W = parseFt($("dlgW").value), H = parseFt($("dlgH").value); if (!(W > 0)) return "Enter the width"; if (c.unit !== "ft" && !(H > 0)) return "Enter the height"; return {W, H, lbl: $("dlgLbl").value.trim()}; }, "dlgH");
    if (v) mutate(() => { P.proj.last.oh = v.H; P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "open", pts, nos: 1, label: v.lbl, oh: v.H, ow: Math.abs(v.W - w) > 0.0005 ? v.W : 0}); });
    draw(); return;
  }
  if (t === "circle") { if (dist(pts[0], pts[1]) < 0.5) { draw(); return; } mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", shape: "circle", pts, nos: 1, label: ""}); }); return; }
  const area = c.type === "area";
  if (area && (pts.length < 3 || polyArea(pts) < 1e-6)) { draw(); return; }
  if (!area && pts.length < 2) { draw(); return; }
  mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: t === "ded" ? "ded" : "shape", pts, nos: 1, label: ""}); });
}

/* ------------------------------------------------------------------ overlay */
let raf = 0;
function draw(){ if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
function drawNow(){
  const svg = $("ov"), tip = $("tip");
  if (!S.page || !P.proj) { svg.innerHTML = ""; tip.style.display = "none"; return; }
  let k = curScale(); const h = [];
  h.push('<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(208,59,59,.08)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(208,59,59,.55)" stroke-width="1.5"/></pattern></defs>');
  const ptsS = P => P.map(p => toScr(p).map(v => v.toFixed(1)).join(",")).join(" ");
  const A = S.autoShow; if (A && A.key === S.key) { const q = toScr([A.x0, A.y0]); h.push(`<image href="${A.url}" x="${q[0].toFixed(1)}" y="${q[1].toFixed(1)}" width="${(A.W * A.px * S.view.s).toFixed(1)}" height="${(A.H * A.px * S.view.s).toFixed(1)}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`); }
  ((P.proj.viewports || {})[S.key] || []).forEach(v => { const a = toScr([v.r[0], v.r[1]]), b = toScr([v.r[2], v.r[3]]);
    h.push(`<rect x="${a[0].toFixed(1)}" y="${a[1].toFixed(1)}" width="${(b[0] - a[0]).toFixed(1)}" height="${(b[1] - a[1]).toFixed(1)}" fill="none" stroke="#7b5ce0" stroke-width="1.5" stroke-dasharray="8 4"/>`);
    h.push(label([a[0] + 6 + (v.name.length + 14) * 3.2, a[1] + 12], v.name + " · " + (v.ptPerFt ? v.text || "own scale" : "scale not set"), "#4b3b8f")); });
  (P.proj.marks || []).filter(m => m.file === S.fileId && m.page === S.pageNo).forEach(m => h.push(markSvg(m, toScr, 1)));
  if (S.tool === "vsearch" && S.draft.length && S.cursor) { const a = toScr(S.draft[0]), b = toScr(S.cursor); h.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="rgba(42,120,214,.08)" stroke="#2a78d6" stroke-width="1.5" stroke-dasharray="4 3"/>`); }
  if (["cloud", "hilite", "arrow"].indexOf(S.tool) >= 0 && S.draft.length && S.cursor) h.push(markSvg({type: S.tool, pts: [S.draft[0], S.cursor], color: "#d03b3b"}, toScr, 1));
  if (S.flash && S.flash.key === S.key && Date.now() < S.flash.until) { const q = toScr(S.flash.p); h.push(`<circle cx="${q[0]}" cy="${q[1] - 5}" r="26" fill="none" stroke="#ff2d55" stroke-width="3"><animate attributeName="r" values="18;30;18" dur="1s" repeatCount="indefinite"/></circle>`); }
  if (S.tool === "vp" && S.draft.length && S.cursor) { const a = toScr(S.draft[0]), b = toScr(S.cursor); h.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="rgba(123,92,224,.06)" stroke="#7b5ce0" stroke-width="1.5" stroke-dasharray="8 4"/>`); }
  P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && !hiddenItem(i)).forEach(it => {
    const c = cond(it.cond); if (!c) return;
    const col = c.color, sel = it.id === S.sel, k = itemScale(it), pts0 = it.pts;
    if (it.shape === "circle") it = Object.assign({}, it, {pts: itemPoly(it), _pts: pts0});
    if (c.type === "count") {
      it.pts.forEach((p, i) => { const q = toScr(p), r = sel && i === S.selPt ? 13 : 11;
        h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${r}" fill="${col}" fill-opacity=".35" stroke="${col}" stroke-width="2.5"/><text x="${q[0].toFixed(1)}" y="${(q[1] + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#0b0b0b">${i + 1}</text>`); });
      return;
    }
    if (it.kind === "open") {
      const a = toScr(it.pts[0]), b = toScr(it.pts[1]);
      h.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d03b3b" stroke-width="${sel ? 6 : 4}" stroke-linecap="round" opacity=".85"/>`);
      if (k) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = rowsOf(it, k)[0]; h.push(label(m, (it.label ? it.label + " " : "") + f3(r.L) + " × " + f3(+it.oh || 0), "#9b2222")); }
    } else if (c.type === "area") {
      const ded = it.kind === "ded";
      h.push(`<polygon points="${ptsS(it.pts)}" fill="${ded ? "url(#hatch)" : col}" fill-opacity="${ded ? 1 : 0.22}" stroke="${ded ? "#d03b3b" : col}" stroke-width="${sel ? 3 : 1.6}" ${ded ? 'stroke-dasharray="5 3"' : ""}/>`);
      if (k) { const scr = it.pts.map(toScr), ar = polyArea(scr); if (ar > 2500 || sel) { const cx = scr.reduce((a, p) => a + p[0], 0) / scr.length, cy = scr.reduce((a, p) => a + p[1], 0) / scr.length;
        const q = rowsOf(it._pts ? Object.assign({}, it, {pts: it._pts}) : it, k).reduce((a, r) => a + r.qty, 0); h.push(label([cx, cy], (it.label ? it.label + ": " : "") + f2(q) + " " + c.unit, ded ? "#9b2222" : "#0b0b0b")); } }
    } else {
      const ded = it.kind === "ded";
      h.push(`<poly${it._pts ? "gon" : "line"} points="${ptsS(it.pts)}" fill="none" stroke="${ded ? "#d03b3b" : col}" stroke-width="${sel ? 5 : 3}" stroke-linejoin="round" stroke-linecap="round" opacity=".85" ${ded ? 'stroke-dasharray="7 4"' : ""}/>`);
      if (k && sel) { const r = rowsOf(it._pts ? Object.assign({}, it, {pts: it._pts}) : it, k)[0], q = toScr(it.pts[it.pts.length - 1]); h.push(label([q[0] + 8, q[1] - 10], f3(r.L) + " ft", "#0b0b0b")); }
    }
    if (sel) (it._pts || it.pts).forEach((p, i) => { const q = toScr(p); h.push(`<rect x="${(q[0] - 4).toFixed(1)}" y="${(q[1] - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="${i === S.selPt ? "#0b0b0b" : col}" stroke-width="2"/>`); });
  });
  const c = S.cond ? cond(S.cond) : null, cur = S.cursor;
  let live = "";
  { const kk = hereScale(S.draft[0] || cur); if (kk) k = kk; }
  if (S.draft.length && cur && S.tool === "circle") {
    const a = S.draft[0], r = dist(a, cur), q = toScr(a), col = c ? c.color : "#0b0b0b";
    h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(r * S.view.s).toFixed(1)}" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-width="2"/>`);
    if (k) live = "dia " + f3(2 * r / k) + " ft · " + f2(Math.PI * r * r / k / k) + " Sft · round " + f3(2 * Math.PI * r / k) + " ft";
  } else if (S.draft.length && cur) {
    const D = S.draft.concat([S.tool === "rect" ? null : cur]).filter(Boolean);
    if (S.tool === "rect") { const a = S.draft[0]; const R = [a, [cur[0], a[1]], cur, [a[0], cur[1]]]; h.push(`<polygon points="${ptsS(R)}" fill="${c.color}" fill-opacity=".15" stroke="${c.color}" stroke-width="2"/>`);
      if (k) live = f3(Math.abs(cur[0] - a[0]) / k) + " × " + f3(Math.abs(cur[1] - a[1]) / k) + " ft = " + f2(Math.abs(cur[0] - a[0]) * Math.abs(cur[1] - a[1]) / k / k) + " Sft"; }
    else {
      const col = S.tool === "fence" ? "#ff7a00" : S.tool === "ded" || S.tool === "open" ? "#d03b3b" : S.tool === "measure" || S.tool === "cal" ? "#0b0b0b" : c ? c.color : "#0b0b0b";
      if (isAreaDraft() && D.length >= 3) h.push(`<polygon points="${ptsS(D)}" fill="${col}" fill-opacity=".12" stroke="none"/>`);
      h.push(`<polyline points="${ptsS(D)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="${S.tool === "measure" || S.tool === "cal" ? "6 3" : "none"}"/>`);
      S.draft.forEach(p => { const q = toScr(p); h.push(`<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fff" stroke="${col}" stroke-width="2"/>`); });
      if (k) { const L = polyLen(D) / k, seg = dist(D[D.length - 2], D[D.length - 1]) / k;
        const a1 = D[D.length - 2], a2 = D[D.length - 1], ang = (Math.atan2(a1[1] - a2[1], a2[0] - a1[0]) * 180 / Math.PI + 360) % 360;
        live = (isAreaDraft() && D.length >= 3 ? f2(polyArea(D) / k / k) + " Sft · perimeter " + f3(polyLen(D, true) / k) + " ft" : (D.length > 2 ? "run " + f3(seg) + " · total " : "") + f3(L) + " ft") + " · ∠ " + ang.toFixed(1) + "°"; }
      else if (S.tool === "cal") live = (dist(D[0], D[D.length - 1])).toFixed(2) + " pt";
    }
  }
  S.measures.forEach(m => {   // finished measurements stay until Esc
    h.push(`<polyline points="${ptsS(m)}" fill="none" stroke="#0b0b0b" stroke-width="2" stroke-dasharray="6 3"/>`);
    m.forEach(p => { const q = toScr(p); h.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.5" fill="#0b0b0b"/>`); });
    if (k) { const q = toScr(m[m.length - 1]); h.push(label([q[0] + 8, q[1] - 10], f3(polyLen(m) / k) + " ft", "#0b0b0b")); }
  });
  if (S.snap && cur && S.tool !== "select" && S.tool !== "pan") {
    const q = toScr(S.snap.p), t = S.snap.type;
    if (/endpoint|point/.test(t)) h.push(`<rect x="${q[0] - 6}" y="${q[1] - 6}" width="12" height="12" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
    else if (/intersection/.test(t)) h.push(`<path d="M${q[0] - 6} ${q[1] - 6}L${q[0] + 6} ${q[1] + 6}M${q[0] + 6} ${q[1] - 6}L${q[0] - 6} ${q[1] + 6}" stroke="#1baf7a" stroke-width="2.2"/>`);
    else if (/midpoint/.test(t)) h.push(`<path d="M${q[0]} ${q[1] - 7}L${q[0] + 6} ${q[1] + 5}L${q[0] - 6} ${q[1] + 5}Z" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
    else h.push(`<circle cx="${q[0]}" cy="${q[1]}" r="5" fill="none" stroke="#1baf7a" stroke-width="2"/>`);
  }
  svg.innerHTML = h.join("");
  $("stMeas").innerHTML = live ? "<b>" + esc(live) + "</b>" : "";
  if (live && S.cursorScr) { tip.textContent = live; tip.style.display = "block"; tip.style.left = Math.min(S.cursorScr[0] + 16, stage().clientWidth - 220) + "px"; tip.style.top = (S.cursorScr[1] + 18) + "px"; }
  else tip.style.display = "none";
}
function label(p, text, col){
  const t = esc(text), w = text.length * 6.4 + 10;
  return `<g><rect x="${(p[0] - w / 2).toFixed(1)}" y="${(p[1] - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="4" fill="rgba(255,255,255,.88)"/><text x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${col}">${t}</text></g>`;
}

/* ------------------------------------------------------------------ panels */
function refresh(){ renderConds(); renderSheet(); if (S.billView) renderBill(); renderScaleChip(); renderProps(); draw(); $("bUndo").disabled = !S.undo.length; $("bRedo").disabled = !S.redo.length; }
let sheetT = null;
function refreshSheetSoon(){ clearTimeout(sheetT); sheetT = setTimeout(() => { renderSheet(); renderConds(); }, 120); }
function renderScaleChip(){
  const ch = $("scaleChip"), sc = P.proj && P.proj.scales[S.key];
  if (!S.page) { ch.className = "chip bad"; ch.lastElementChild.textContent = "No page"; return; }
  if (!sc) { ch.className = "chip bad"; ch.lastElementChild.textContent = "Scale not set — press K"; }
  else { ch.className = "chip " + (sc.verified ? "ok" : "warn"); ch.lastElementChild.textContent = (sc.how === "note" ? scaleLabel(sc) + " · from note" : "1 ft = " + sc.ptPerFt.toFixed(3) + " pt · calibrated") + (sc.verified ? " · verified" : " · not verified"); }
}
function scaleLabel(sc){ const c = (S.texts[S.key] ? scaleCandidates(S.key) : []).find(x => Math.abs(x.ptPerFt - sc.ptPerFt) < 1e-6); return c ? c.label : "1 ft = " + sc.ptPerFt.toFixed(3) + " pt"; }
function renderConds(){
  const L = $("condList");
  if (!P.proj) { L.innerHTML = ""; return; }
  if (!P.proj.conds.length) { L.innerHTML = '<div class="empty">A <b>condition</b> is what you are measuring — e.g. <i>9" brick wall</i>, <i>floor tiles</i>, <i>doors</i>. Create one, then draw on the drawing.<br><br><button class="btn pri" id="bFirstCond">+ New condition</button></div>'; return; }
  L.innerHTML = P.proj.conds.map((c, i) => { const t = condTotals(c);
    return `<div class="cond${c.id === S.cond ? " on" : ""}${c.hidden ? " off" : ""}" data-cond="${esc(c.id)}"><button class="sw" style="background:${c.color}" title="Change colour" data-color="${esc(c.id)}"></button><div class="nm"><b>${i < 9 ? (i + 1) + ". " : ""}${esc(c.name)}</b><span>${c.type === "area" ? "Area" : c.type === "linear" ? "Length" : "Count"}${c.h ? " · H " + f3(+c.h) : ""}${c.t ? " · T " + f3(+c.t) : ""}${c.faces > 1 ? " · " + c.faces + " faces" : ""}</span></div>
      <div class="q">${f2(t.net)}<br><span style="font-weight:400;color:var(--muted);font-size:10.5px">${esc(c.unit)}</span></div><button class="ed eye" title="${c.hidden ? "Hidden — click to show on the drawing" : "Shown — click to hide on the drawing"}" data-eye="${esc(c.id)}">${c.hidden ? "&#128065;&#824;" : "&#128065;"}</button><button class="ed" title="Edit condition" data-edit="${esc(c.id)}">&#9998;</button></div>`; }).join("");
}
function renderSheet(){
  const el = $("sheet");
  if (!P.proj) { el.innerHTML = ""; return; }
  const missing = P.proj.items.filter(it => !itemScale(it)).length;
  const unv = Object.values(P.proj.scales).filter(s => !s.verified).length;
  const wb = $("warnbar"), msgs = [];
  if (missing) msgs.push(missing + " measurement" + (missing > 1 ? "s are" : " is") + " on a page with no scale — set it with <b>K</b>; they are left out of the totals.");
  if (unv) msgs.push(unv + " page scale" + (unv > 1 ? "s were" : " was") + " read from the drawing note and not yet checked — click the scale chip → <b>Verify</b> with a known dimension.");
  wb.innerHTML = msgs.join("<br>"); wb.classList.toggle("on", msgs.length > 0);
  if (!P.proj.items.length) { el.innerHTML = '<div class="empty">Measurements appear here as you draw, in the house format: <b>Nos × L × W × H</b> in decimal feet, deductions as their own rows.</div>'; $("shInfo").textContent = ""; return; }
  let h = '<table class="sh"><thead><tr><th>#</th><th>Description</th><th class="n">Nos × L × W × H</th><th class="n">Qty</th></tr></thead><tbody>', n = 0;
  P.proj.conds.forEach(c => {
    const its = P.proj.items.filter(i => i.cond === c.id); if (!its.length) return;
    const t = condTotals(c);
    h += `<tr class="ch"><td colspan="4"><span class="sw" style="background:${c.color}"></span>${esc(c.name)} <span style="font-weight:400;color:var(--muted)">(${esc(c.unit)})</span></td></tr>`;
    its.forEach(it => {
      const k = itemScale(it), vp = viewportAt(it.file, it.page, it.pts[0]), pg = pageName(it) + (vp ? " · " + vp.name : "");
      if (!k) { h += `<tr class="it${it.id === S.sel ? " sel" : ""}" data-item="${esc(it.id)}"><td>${++n}</td><td>${esc(it.label || kindName(it, c))}<div class="ds">${esc(pg)} · scale not set</div></td><td class="n">—</td><td class="n">—</td></tr>`; return; }
      rowsOf(it, k).forEach((r, i) => {
        const desc = (r.sign < 0 ? "Ded. " : "") + (it.label || kindName(it, c)) + (r.part ? " — part " + String.fromCharCode(96 + r.part) : "");
        const sub = [pg, r.runs && r.runs.length > 1 ? "runs " + r.runs.map(f3).join(" + ") : "", r.how === "poly" ? "plan area of the " + r.sides + "-sided outline" : "", r.how === "circle" ? "circle, dia " + f3(r.D) + " ft" + (c.type === "area" ? " — area = π/4 × D²" : " — length = π × D") : "",
                     c.type === "linear" && c.unit === "Sft" && (+c.faces || 1) > 1 && it.kind !== "ded" ? "Nos includes " + c.faces + " faces" : "",
                     r.below ? "≤ " + f2(+c.dedMin || 0) + " " + (c.unit === "cft" && c.type === "area" ? "cft" : "Sft") + " — not deducted (house rule)" : ""].filter(Boolean).join(" · ");
        h += `<tr class="it${r.sign < 0 ? " ded" : ""}${r.below ? " below" : ""}${it.id === S.sel ? " sel" : ""}" data-item="${esc(it.id)}"><td>${i === 0 ? ++n : ""}</td><td>${esc(desc)}${i === 0 ? `<button class="rn" title="Rename (e.g. Bedroom 1)" data-rename="${esc(it.id)}">&#9998;</button>` : ""}<div class="ds">${esc(sub)}</div></td>
          <td class="n">${dimText(r)}</td><td class="n">${r.below ? "0.00" : f2(r.qty)}</td></tr>`;
      });
    });
    h += `<tr class="tot"><td></td><td>Total ${esc(c.name)}${t.ded ? `<div class="ds">gross ${f2(t.gross)} − deductions ${f2(t.ded)}</div>` : ""}</td><td></td><td class="n">${f2(t.net)} ${esc(c.unit)}</td></tr>`;
  });
  el.innerHTML = h + "</tbody></table>";
  $("shInfo").textContent = P.proj.items.length + " measurements";
}
function pageName(it){ const f = P.proj.files.find(x => x.id === it.file); return (f ? f.name.replace(/\.pdf$/i, "") : "?") + " p." + it.page; }
function kindName(it, c){ return it.kind === "open" ? "Opening" : c.type === "count" ? c.name : c.type === "area" ? (it.kind === "ded" ? "void" : "area") : (it.kind === "ded" ? "length" : "run"); }
function renderProps(){
  const el = $("props"), it = S.sel && P.proj ? P.proj.items.find(i => i.id === S.sel) : null;
  const mk = !it && S.selMark && P.proj ? (P.proj.marks || []).find(m => m.id === S.selMark) : null;
  if (mk) { el.innerHTML = `<h4>${esc(MARK_TOOLS[mk.type])} <span style="font-weight:400;color:var(--muted);font-size:11px">markup — not a quantity · drag to move</span></h4>
      <div class="row"><div class="fg" style="flex:3"><label>Text</label><input type="text" data-mprop="text" value="${esc(mk.text)}"></div>
      <div class="fg"><label>Colour</label><input type="color" data-mprop="color" value="${/^#[0-9a-f]{6}$/i.test(mk.color) ? mk.color : "#d03b3b"}" style="height:30px;padding:0"></div>
      <button class="btn dng" data-act="delMark">Delete</button></div>`; el.classList.add("on"); return; }
  if (!it) { el.classList.remove("on"); el.innerHTML = ""; return; }
  const c = cond(it.cond), k = itemScale(it), poly = itemPoly(it);
  const meas = !k ? "scale not set" : it.shape === "circle" ? "dia " + f3(2 * dist(it.pts[0], it.pts[1]) / k) + " ft · " + (c.type === "area" ? f2(polyArea(poly) / k / k) + " Sft" : f3(polyLen(poly, true) / k) + " ft round")
    : c.type === "area" ? f2(polyArea(it.pts) / k / k) + " Sft measured · perimeter " + f3(polyLen(it.pts, true) / k) + " ft" : c.type === "linear" ? f3(it.kind === "open" ? dist(it.pts[0], it.pts[1]) / k : polyLen(it.pts) / k) + " ft measured" : it.pts.length + " points";
  el.innerHTML = `<h4>${esc(c.name)} — ${esc(kindName(it, c))} <span style="font-weight:400;color:var(--muted);font-size:11px">${esc(meas)}</span></h4>
    <div class="row"><div class="fg" style="flex:2"><label>Label</label><input type="text" data-prop="label" value="${esc(it.label)}" placeholder="e.g. Bed room 1"></div>
    <div class="fg"><label>Nos (×)</label><input type="number" min="1" step="1" data-prop="nos" value="${+it.nos || 1}"></div>
    ${it.kind === "open" ? `<div class="fg"><label>Width ft</label><input type="text" data-prop="ow" value="${it.ow ? f3(it.ow) : ""}" placeholder="${k ? f3(dist(it.pts[0], it.pts[1]) / k) : ""}"></div><div class="fg"><label>Height ft</label><input type="text" data-prop="oh" value="${f3(+it.oh || 0)}"></div>` : ""}
    ${c.type !== "count" && it.kind !== "open" ? `<div class="fg"><label>Measured as</label><select data-prop="kind"><option value="shape"${it.kind === "shape" ? " selected" : ""}>Add</option><option value="ded"${it.kind === "ded" ? " selected" : ""}>Deduct</option></select></div>` : ""}
    <div class="fg"><label>Condition</label><select data-prop="cond">${P.proj.conds.filter(x => x.type === c.type).map(x => `<option value="${esc(x.id)}"${x.id === it.cond ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
    <button class="btn dng" data-act="delItem">Delete</button></div>
    ${c.type === "count" && S.selPt >= 0 ? '<div style="margin-top:8px"><button class="btn sm dng" data-act="delPoint">Remove this point</button></div>' : ""}`;
  el.classList.add("on");
}

/* ------------------------------------------------------------------ copy / paste, typical floors */
function copySel(){
  const it = S.sel && P.proj.items.find(i => i.id === S.sel);
  if (!it) return toast("Select a measurement first (V), then Ctrl+C");
  S.clip = JSON.parse(JSON.stringify(it)); toast("Copied — Ctrl+V pastes it at the cursor, on any page");
}
function pasteClip(){
  const c = S.clip; if (!c || !S.page) return;
  if (!cond(c.cond)) return toast("The copied measurement's condition was deleted");
  const at = S.cursor || toBase(stage().clientWidth / 2, stage().clientHeight / 2), dx = at[0] - c.pts[0][0], dy = at[1] - c.pts[0][1];
  const it = Object.assign(JSON.parse(JSON.stringify(c)), {id: uid("I"), file: S.fileId, page: S.pageNo, pts: c.pts.map(p => [p[0] + dx, p[1] + dy])});
  mutate(() => { P.proj.items.push(it); }); S.sel = it.id; setTool("select"); S.sel = it.id; refresh();
}
/* typical floors: every measurement on this page copied to other pages at the same place (same drawing layout) */
async function copyPageDialog(){
  if (!S.page) return;
  const mine = P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo);
  if (!mine.length) return toast("Nothing measured on this page yet");
  const opts = []; P.proj.files.forEach(f => { for (let i = 1; i <= f.pages; i++) if (!(f.id === S.fileId && i === S.pageNo)) opts.push({f, i}); });
  if (!opts.length) return toast("Add another page or PDF first");
  const v = await ask("Copy this page's takeoff to…", `<p>${mine.length} measurement${mine.length > 1 ? "s" : ""} on <b>${esc(pageName({file: S.fileId, page: S.pageNo}))}</b> are copied to the same place on each page you tick — for typical floors drawn the same way.</p>
    <div style="max-height:260px;overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:6px">${opts.map((o, n) => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0;text-transform:none;letter-spacing:0;font-size:12px;font-weight:400;color:var(--txt)"><input type="checkbox" data-cp="${n}" style="width:auto"> ${esc(o.f.name.replace(/\.pdf$/i, ""))} — p.${o.i}${P.proj.scales[keyOf(o.f.id, o.i)] ? "" : " <span class='small'>(no scale)</span>"}</label>`).join("")}</div>
    <div class="fg w2" style="margin-top:8px"><label><input type="checkbox" id="cpScale" style="width:auto" checked> Give pages without a scale this page's scale (and viewports)</label></div>`, "Copy",
    () => { const pick = [...document.querySelectorAll("[data-cp]")].filter(x => x.checked).map(x => opts[+x.dataset.cp]); return pick.length ? {pick, sc: $("cpScale").checked} : "Tick at least one page"; });
  if (!v) return;
  mutate(() => {
    v.pick.forEach(o => {
      const key = keyOf(o.f.id, o.i);
      if (v.sc && !P.proj.scales[key] && P.proj.scales[S.key]) P.proj.scales[key] = Object.assign({}, P.proj.scales[S.key]);
      if (v.sc && P.proj.viewports && P.proj.viewports[S.key] && !(P.proj.viewports[key] || []).length) P.proj.viewports[key] = P.proj.viewports[S.key].map(x => Object.assign({}, x, {id: uid("V"), r: x.r.slice()}));
      mine.forEach(it => P.proj.items.push(Object.assign(JSON.parse(JSON.stringify(it)), {id: uid("I"), file: o.f.id, page: o.i})));
    });
  });
  toast(mine.length + " measurement" + (mine.length > 1 ? "s" : "") + " copied to " + v.pick.length + " page" + (v.pick.length > 1 ? "s" : ""), 4000);
}

/* ------------------------------------------------------------------ find similar symbols (auto count)
   The symbol boxed by the user is cut from the rendered page as an ink mask; every window of the page (and of the
   other pages, if asked) whose ink matches it — template ink found in the window, window ink explained by the
   template, both within 1 px — scores F = 2RP/(R+P). Windows over the strictness are counted, the best of any
   overlapping group only. Rotations by 90° are optional (doors, fittings drawn turned). */
function inkOf(ctx, W, H){ const d = ctx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < 170 ? 1 : 0; return m; }
function dil1(m, W, H){ const o = new Uint8Array(m.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!m[i]) continue; o[i] = 1; if (x) o[i - 1] = 1; if (x < W - 1) o[i + 1] = 1; if (y) o[i - W] = 1; if (y < H - 1) o[i + W] = 1; } return o; }
function rot90(m, w, h){ const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + (h - 1 - y)] = m[y * w + x]; return {m: o, w: h, h: w}; }
async function renderInk(page, sc){
  const vp = page.getViewport({scale: sc}), W = Math.ceil(vp.width), H = Math.ceil(vp.height), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", {willReadFrequently: true}); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
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
async function findSimilar(rect){
  const c0 = cond(S.cond); if (!c0 || c0.type !== "count") { setTool("count"); }
  const c = cond(S.cond);
  const v = await ask("Find similar — " + esc(c.name), `<p>Every symbol that looks like the one you boxed is counted into <b>${esc(c.name)}</b>. Check the result and delete any wrong ones (Select, click the marker, Delete).</p>
    <div class="grid" style="margin-top:10px"><div class="fg"><label>Search</label><select id="vsWhere"><option value="page">This page</option><option value="pdf">Every page of this PDF</option></select></div>
    <div class="fg"><label>Match</label><select id="vsThr"><option value="0.9">Strict (90%)</option><option value="0.82" selected>Normal (82%)</option><option value="0.72">Loose (72%)</option></select></div>
    <div class="fg w2"><label><input type="checkbox" id="vsRot" style="width:auto" checked> Also find it turned 90°, 180°, 270°</label></div></div>`, "Find",
    () => ({where: $("vsWhere").value, thr: +$("vsThr").value, rot: $("vsRot").checked}));
  if (!v) { setTool("count"); return; }
  const longSym = Math.max(rect[2] - rect[0], rect[3] - rect[1]); if (longSym < 1) return;
  const sc = Math.max(0.5, Math.min(6, 30 / longSym, 7000 / Math.max(S.base.width, S.base.height)));
  busy("Reading the symbol…"); await new Promise(r => setTimeout(r, 20));
  let total = 0, pagesHit = 0;
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
    const pages = v.where === "pdf" ? Array.from({length: (P.proj.files.find(f => f.id === S.fileId) || {pages: 1}).pages}, (_, i) => i + 1) : [S.pageNo];
    const found = {};
    for (const pn of pages) {
      busy("Searching page " + pn + (pages.length > 1 ? " of " + pages.length : "") + "…"); await new Promise(r => setTimeout(r, 10));
      const pg = pn === S.pageNo ? S.page : await (await doc(S.fileId)).getPage(pn), ink = pn === S.pageNo ? here : await renderInk(pg, sc);
      let hits = [];
      vars.forEach(t => { hits = hits.concat(matchInk(ink.m, ink.W, ink.H, t.m, t.w, t.h, v.thr).map(q => Object.assign(q, {r: Math.max(t.w, t.h)}))); });
      hits.sort((a, b) => b.F - a.F);
      const keep = [];
      hits.forEach(q => { if (!keep.some(k2 => Math.hypot(k2.x - q.x, k2.y - q.y) < 0.6 * Math.max(k2.r, q.r))) keep.push(q); });
      if (keep.length) found[pn] = keep.map(q => [q.x / sc, q.y / sc]);
    }
    mutate(() => {
      Object.entries(found).forEach(([pn, pts]) => {
        pn = +pn;
        let it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === pn && i.kind === "shape");
        if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: pn, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
        const near = Math.max(4, longSym * 0.5);
        pts.forEach(p => { if (!it.pts.some(q => dist(q, p) < near)) { it.pts.push(p); total++; } });
        pagesHit++;
      });
    });
  } catch (e) { toast("Search failed: " + (e.message || e), 5000); }
  busy(""); setTool("count");
  toast(total ? "Counted " + total + " matching symbol" + (total > 1 ? "s" : "") + (pagesHit > 1 ? " on " + pagesHit + " pages" : "") + " — check them" : "No other matches — try Loose, or box the symbol more tightly", 5000);
}

/* ------------------------------------------------------------------ find text on the drawings */
async function pageTexts(fileId, pageNo){
  const key = keyOf(fileId, pageNo);
  if (S.texts[key]) return S.texts[key];
  try {
    const pg = await (await doc(fileId)).getPage(pageNo), base = pg.getViewport({scale: 1}), tc = await pg.getTextContent();
    S.texts[key] = tc.items.filter(t => t.str && t.str.trim()).map(t => { const p = base.convertToViewportPoint(t.transform[4], t.transform[5]); return {s: t.str, x: p[0], y: p[1]}; });
  } catch (e) { S.texts[key] = []; }
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
  box.innerHTML = hits.length ? `<div class="fr small">${hits.length}${hits.length >= 300 ? "+" : ""} found</div>` + hits.map((h, n) => `<div class="fr" data-hit="${n}"><b>${esc(h.t.s.trim().slice(0, 60))}</b><span class="small">${esc(h.f.name.replace(/\.pdf$/i, ""))} p.${h.i}</span></div>`).join("")
    : '<div class="fr small">Not found in the text of these PDFs (scanned drawings have no text).</div>';
  box.onclick = async e => { const r = e.target.closest("[data-hit]"); if (!r) return; const h = hits[+r.dataset.hit];
    if (h.f.id !== S.fileId || h.i !== S.pageNo) await gotoPage(h.f.id, h.i);
    const s2 = Math.max(S.view.s, 2.5), st = stage(); S.view = {s: s2, tx: st.clientWidth / 2 - h.t.x * s2, ty: st.clientHeight / 2 - h.t.y * s2}; applyView(); renderHi();
    S.flash = {key: S.key, p: [h.t.x, h.t.y], until: Date.now() + 2500}; draw(); setTimeout(draw, 2600); };
}

/* ------------------------------------------------------------------ markups: notes, clouds, arrows, highlights (no quantity) */
const MARK_TOOLS = {note: "Note", cloud: "Cloud", arrow: "Arrow", hilite: "Highlight", fence: "Fence (auto-area wall)"};
function cloudPath(a, b, r){   // scalloped rectangle between screen points a and b
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const side = (p, q) => { const L = dist(p, q), n = Math.max(1, Math.round(L / (2 * r))), out = []; for (let i = 1; i <= n; i++) { const t = i / n; out.push(`A ${(L / n / 2).toFixed(1)} ${(L / n / 2).toFixed(1)} 0 0 1 ${(p[0] + (q[0] - p[0]) * t).toFixed(1)} ${(p[1] + (q[1] - p[1]) * t).toFixed(1)}`); } return out.join(" "); };
  return `M ${x0} ${y0} ` + side([x0, y0], [x1, y0]) + " " + side([x1, y0], [x1, y1]) + " " + side([x1, y1], [x0, y1]) + " " + side([x0, y1], [x0, y0]) + " Z";
}
function markSvg(m, T, z){   // T: base -> screen; z: px per screen unit (1 on screen)
  const col = m.color || "#d03b3b", sel = m.id === S.selMark;
  if (m.type === "fence") { const d = m.pts.map(p => T(p).map(v => v.toFixed(1)).join(",")).join(" ");
    return `<polyline points="${d}" fill="none" stroke="#ff7a00" stroke-width="${(sel ? 4 : 3) * z}" stroke-dasharray="${6 * z} ${3 * z}" stroke-linecap="round"/>`; }
  if (m.type === "hilite") { const a = T(m.pts[0]), b = T(m.pts[1]); return `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="#ffe14d" fill-opacity=".38" stroke="${sel ? "#0b0b0b" : "none"}"/>`; }
  if (m.type === "cloud") { const a = T(m.pts[0]), b = T(m.pts[1]); return `<path d="${cloudPath(a, b, 9 * z)}" fill="none" stroke="${col}" stroke-width="${(sel ? 3 : 2) * z}"/>` + (m.text ? label([Math.max(a[0], b[0]), Math.min(a[1], b[1]) - 12 * z], m.text, col) : ""); }
  if (m.type === "arrow") { const a = T(m.pts[0]), b = T(m.pts[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = 12 * z;
    const h1 = [b[0] - hl * Math.cos(ang - 0.4), b[1] - hl * Math.sin(ang - 0.4)], h2 = [b[0] - hl * Math.cos(ang + 0.4), b[1] - hl * Math.sin(ang + 0.4)];
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${(sel ? 3 : 2) * z}"/><path d="M${h1[0]} ${h1[1]}L${b[0]} ${b[1]}L${h2[0]} ${h2[1]}" fill="none" stroke="${col}" stroke-width="${(sel ? 3 : 2) * z}"/>` + (m.text ? label([a[0], a[1] - 12 * z], m.text, col) : ""); }
  const q = T(m.pts[0]), t = m.text || "Note", w = Math.min(320, t.length * 6.6 + 14) * z;
  return `<g><rect x="${q[0]}" y="${q[1] - 11 * z}" width="${w}" height="${22 * z}" rx="${3 * z}" fill="#fffbe0" stroke="${sel ? "#0b0b0b" : col}" stroke-width="${1.5 * z}"/><text x="${q[0] + 7 * z}" y="${q[1] + 4 * z}" font-size="${12 * z}" font-weight="600" fill="#5b3b00">${esc(t.length > 48 ? t.slice(0, 47) + "…" : t)}</text></g>`;
}
function markAt(sp){
  const q = toBase(sp[0], sp[1]);
  return (P.proj.marks || []).filter(m => m.file === S.fileId && m.page === S.pageNo).reverse().find(m => {
    const a = toScr(m.pts[0]), b = m.pts[1] ? toScr(m.pts[1]) : null;
    if (m.type === "note") return sp[0] >= a[0] - 4 && sp[0] <= a[0] + Math.min(320, (m.text || "Note").length * 6.6 + 14) && Math.abs(sp[1] - a[1]) <= 12;
    if (m.type === "arrow") return distSeg(sp, a, b) <= HIT_PX;
    if (m.type === "fence") { for (let i = 1; i < m.pts.length; i++) if (distSeg(sp, toScr(m.pts[i - 1]), toScr(m.pts[i])) <= HIT_PX) return true; return false; }
    const inR = sp[0] >= Math.min(a[0], b[0]) - 4 && sp[0] <= Math.max(a[0], b[0]) + 4 && sp[1] >= Math.min(a[1], b[1]) - 4 && sp[1] <= Math.max(a[1], b[1]) + 4;
    return m.type === "hilite" ? inR : inR && (Math.abs(sp[0] - a[0]) < 10 || Math.abs(sp[0] - b[0]) < 10 || Math.abs(sp[1] - a[1]) < 10 || Math.abs(sp[1] - b[1]) < 10);
  }) || null;
}
async function addMark(type, pts){
  let text = "";
  if (type === "note" || type === "cloud" || type === "arrow") {
    const v = await ask(MARK_TOOLS[type], `<div class="fg w2"><label>${type === "note" ? "Note" : "Comment (optional)"}</label><input type="text" id="mkT" placeholder="${type === "cloud" ? "e.g. Revised — check with Rev 07" : "e.g. Confirm slab thickness with structure"}"></div>`, "Add", () => { const t = $("mkT").value.trim(); return type === "note" && !t ? "Write the note" : {t}; }, "mkT");
    if (!v) { draw(); return; } text = v.t;
  }
  const m = {id: uid("M"), type, file: S.fileId, page: S.pageNo, pts, text, color: "#d03b3b", at: new Date().toISOString()};
  mutate(() => { (P.proj.marks = P.proj.marks || []).push(m); });
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
  return new Promise(res => {
    $("dlgT").textContent = title; $("dlgB").innerHTML = body + '<div class="err" id="dlgErr"></div>';
    $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Cancel</button>${okLabel ? `<button class="btn pri" id="dlgOk">${esc(okLabel)}</button>` : ""}`;
    $("dlgBack").classList.add("on");
    const done = v => { $("dlgBack").classList.remove("on"); document.removeEventListener("keydown", key, true); res(v); };
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
async function editCond(c){
  const isNew = !c, used = c && P.proj.items.some(i => i.cond === c.id);
  const d = c ? Object.assign({}, c) : {name: "", type: "area", unit: "Sft", color: COLORS[P.proj.conds.length % COLORS.length], h: "", t: "", faces: 1, dedMin: 0};
  const unitOpts = t => UNITS[t].map(u => `<option${u === d.unit ? " selected" : ""}>${u}</option>`).join("");
  const body = (isNew ? `<div class="fg w2" style="margin-bottom:10px"><label>Start from</label><select id="cPre"><option value="">— choose a common item —</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("")}</select></div>` : "") +
    `<div class="grid"><div class="fg w2"><label>Name (as it should read on the sheet)</label><input type="text" id="cName" value="${esc(d.name)}"></div>
     <div class="fg"><label>Measured as</label><select id="cType"${used ? " disabled" : ""}><option value="area"${d.type === "area" ? " selected" : ""}>Area</option><option value="linear"${d.type === "linear" ? " selected" : ""}>Length</option><option value="count"${d.type === "count" ? " selected" : ""}>Count</option></select></div>
     <div class="fg"><label>Quantity unit</label><select id="cUnit">${unitOpts(d.type)}</select></div>
     <div class="fg"><label>Height H (ft)</label><input type="text" id="cH" value="${d.h ? f3(+d.h) : ""}" placeholder="walls: floor to ceiling"></div>
     <div class="fg"><label>Thickness T (ft)</label><input type="text" id="cT" value="${d.t ? f3(+d.t) : ""}" placeholder="9&quot; = 0.75"></div>
     <div class="fg"><label>Faces</label><input type="number" id="cF" min="1" max="2" step="1" value="${+d.faces || 1}"></div>
     <div class="fg"><label>Deduct openings / voids over</label><input type="text" id="cD" value="${f2(+d.dedMin || 0)}"></div>
     <div class="fg w2"><label>Colour</label><input type="hidden" id="cC" value="${esc(d.color)}"><div class="swg" id="cSw">${swatches(d.color)}<label class="cust">Custom <input type="color" id="cCx" value="${/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#2a78d6"}"></label></div></div></div>
     <p class="small" style="margin-top:10px">Area → Sft, or cft with T (slab, screed). Length → ft; Sft with H (plaster, 4.5" partition — 2 faces for internal plaster); cft with H and T (9" and thicker walls).
     House thresholds: masonry and plaster openings 1.00 Sft, formwork 5.00 Sft, concrete voids 0.50 cft.</p>`;
  const v = await ask(isNew ? "New condition" : "Edit condition", body, isNew ? "Create" : "Save", () => {
    const name = $("cName").value.trim(), type = $("cType").value, unit = $("cUnit").value, H = $("cH").value.trim() ? parseFt($("cH").value) : 0, T = $("cT").value.trim() ? parseFt($("cT").value) : 0;
    if (!name) return "Give the condition a name";
    if (isNaN(H) || isNaN(T)) return "Height and thickness are decimal feet (or ft-in like 10'-6\")";
    if (type === "linear" && unit !== "ft" && !(H > 0)) return "A wall measured in " + unit + " needs its height H";
    if (unit === "cft" && !(T > 0)) return "A quantity in cft needs the thickness T";
    return {name, type, unit, h: H || "", t: T || "", faces: Math.max(1, Math.min(2, +$("cF").value || 1)), dedMin: Math.max(0, parseFloat($("cD").value) || 0), color: $("cC").value};
  }, "cName");
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
  const sc = P.proj.scales[S.key], cands = scaleCandidates(S.key);
  const body = `<p>Current: <b>${sc ? (sc.how === "note" ? esc(scaleLabel(sc)) + " (from the drawing note)" : "calibrated — " + esc(sc.text)) : "not set"}</b>${sc ? (sc.verified ? " · <span style='color:var(--green)'>verified</span>" : " · <span style='color:var(--amber)'>not verified</span>") : ""}</p>
    ${sc && sc.note ? `<p class="small">${esc(sc.note)}</p>` : ""}
    ${cands.length ? `<p style="margin-top:10px"><b>Scale notes found on this page</b></p>` + cands.map((c, i) => `<div class="cand" data-cand="${i}"><b>${esc(c.label)}</b><span class="small">“${esc(c.text.slice(0, 70))}”${c.note ? " · " + esc(c.note) : ""}</span></div>`).join("") : '<p class="small" style="margin-top:10px">No scale note was found in the text of this page (scanned drawings have no text).</p>'}
    <p class="small" style="margin-top:10px">A scale note is only right if the PDF is printed at the drawing's paper size. <b>Verify</b> by measuring a dimension you know; <b>Calibrate</b> sets the scale from it.</p>
    <p style="margin-top:12px"><b>Viewports</b> <span class="small">— parts of this sheet drawn at another scale (enlarged details, sections). Measurements inside one use its scale.</span></p>
    ${((P.proj.viewports || {})[S.key] || []).map(v => `<div class="cand"><b>${esc(v.name)}</b><span class="small">${v.ptPerFt ? esc(v.text || "1 ft = " + v.ptPerFt.toFixed(3) + " pt") : "scale not set"}</span><span style="flex:1"></span><button class="btn sm" data-vpcal="${esc(v.id)}">Calibrate</button><button class="btn sm dng" data-vpdel="${esc(v.id)}">Delete</button></div>`).join("") || '<p class="small">None on this page.</p>'}`;
  $("dlgT").textContent = "Page scale"; $("dlgB").innerHTML = body;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button><button class="btn" id="dlgVp">+ Viewport…</button>${sc ? '<button class="btn" id="dlgAll">Use on every page of this PDF</button><button class="btn" id="dlgVer">Verify…</button>' : ""}<button class="btn pri" id="dlgCal">Calibrate…</button>`;
  $("dlgBack").classList.add("on");
  const close = () => $("dlgBack").classList.remove("on");
  $("dlgCancel").onclick = close;
  $("dlgCal").onclick = () => { close(); S.calVp = null; setTool("cal"); };
  $("dlgVp").onclick = () => { close(); setTool("vp"); toast("Click two opposite corners of the part drawn at another scale"); };
  $("dlgB").querySelectorAll("[data-vpdel]").forEach(b => b.onclick = () => { mutate(() => { P.proj.viewports[S.key] = P.proj.viewports[S.key].filter(v => v.id !== b.dataset.vpdel); }); close(); scaleDialog(); });
  $("dlgB").querySelectorAll("[data-vpcal]").forEach(b => b.onclick = () => { close(); S.calVp = b.dataset.vpcal; setTool("cal"); toast("Click both ends of a known dimension inside the viewport"); });
  if (sc) {
    $("dlgVer").onclick = () => { close(); S.verify = true; setTool("measure"); toast("Measure a dimension you know, then press Enter"); };
    $("dlgAll").onclick = () => { close(); mutate(() => { const f = P.proj.files.find(x => x.id === S.fileId); for (let i = 1; i <= f.pages; i++) P.proj.scales[keyOf(S.fileId, i)] = Object.assign({}, sc); }); toast("Scale copied to every page of this PDF"); };
  }
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
    ws.columns = [{width: 6}, {width: 48}, {width: 16}, {width: 8}, {width: 11}, {width: 11}, {width: 11}, {width: 13}, {width: 7}];
    ws.mergeCells("A1:I1"); ws.getCell("A1").value = "MEASUREMENT SHEET — " + P.proj.name; ws.getCell("A1").font = {bold: true, size: 13};
    ws.mergeCells("A2:I2"); ws.getCell("A2").value = "PDF takeoff · " + dmy(today()) + " · decimal feet · Qty = Nos × L × W × H (blank = not used) · deductions as negative rows";
    ws.getCell("A2").font = {size: 9, color: {argb: "FF52514E"}};
    ws.mergeCells("A3:I3"); ws.getCell("A3").value = "Blue = measured / input · green = formula · grey = totals · yellow = check (see Assumptions)"; ws.getCell("A3").font = {size: 9, color: {argb: "FF52514E"}};
    const hr = ws.getRow(4); hr.values = ["S.No", "Description", "Drawing / page", "Nos", "L (ft) / Area", "W (ft)", "H (ft)", "Qty", "Unit"];
    hr.font = {bold: true, color: {argb: "FFFFFFFF"}}; hr.eachCell(c => { c.fill = HEAD; });
    let row = 5, sn = 0; const totals = [];
    for (const g of sheetRows()) {
      const head = ws.getRow(row); head.values = ["", g.c.name + " (" + g.c.unit + ")" + (g.c.type === "linear" && g.c.unit !== "ft" ? " — H " + f3(+g.c.h) + " ft" + (g.c.t ? ", T " + f3(+g.c.t) + " ft" : "") + ((+g.c.faces || 1) > 1 ? ", " + g.c.faces + " faces" : "") : g.c.unit === "cft" ? " — T " + f3(+g.c.t) + " ft" : "")];
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
        q.fill = r.below ? YELLOW : GREEN; q.numFmt = "#,##0.00";
        rr.getCell(9).value = r.unit;
        if (r.sign < 0) rr.font = {color: {argb: "FFB32D2D"}};
        row++;
      });
      const tr = ws.getRow(row); tr.getCell(2).value = "Total " + g.c.name; tr.getCell(9).value = g.c.unit;
      tr.getCell(8).value = {formula: `SUM(H${first}:H${row - 1})`, result: g.t.net}; tr.getCell(8).numFmt = "#,##0.00";
      tr.font = {bold: true}; for (let n = 1; n <= 9; n++) tr.getCell(n).fill = GREY;
      totals.push({c: g.c, cell: "H" + row, t: g.t}); row++;
    }
    await ws.protect("", {selectLockedCells: true, selectUnlockedCells: true, formatColumns: true});
    const bl = wb.addWorksheet("Bill");
    bl.columns = [{header: "S.No", width: 6}, {header: "Item", width: 46}, {header: "Formula", width: 18}, {header: "Qty", width: 13}, {header: "Unit", width: 8}, {header: "Rate PKR", width: 13}, {header: "Amount PKR", width: 15}, {header: "Rate source / date", width: 42}];
    bl.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; bl.getRow(1).eachCell(c2 => { c2.fill = HEAD; });
    let bn = 0, br = 2;
    billLines().forEach(l => { const r = bl.addRow([l.kind === "cond" ? ++bn : "", (l.kind === "asm" ? "   " : "") + l.name, l.kind === "asm" ? l.f : "measured", +l.qty.toFixed(3), l.unit, l.rate || 0, {formula: `D${br}*F${br}`, result: l.qty * (l.rate || 0)}, l.rate ? (rateOk(l) ? l.src + ", " + dmy(l.date) : "ASSUMPTION — no dated source") : "rate not set"]);
      r.getCell(4).numFmt = "#,##0.000"; r.getCell(6).numFmt = "#,##0.00"; r.getCell(7).numFmt = "#,##0.00"; r.getCell(4).fill = GREEN; r.getCell(6).fill = BLUE; r.getCell(7).fill = GREEN;
      if (l.kind === "cond") r.font = {bold: true}; if (!rateOk(l)) r.getCell(8).fill = YELLOW; br++; });
    const bt = bl.addRow(["", "Total", "", "", "", "", {formula: `SUM(G2:G${br - 1})`, result: billLines().reduce((a, l) => a + l.qty * (l.rate || 0), 0)}]); bt.font = {bold: true}; bt.getCell(7).numFmt = "#,##0.00"; bt.eachCell(c2 => { c2.fill = GREY; });
    const sm = wb.addWorksheet("Summary");
    sm.columns = [{header: "Condition", width: 48}, {header: "Qty", width: 14}, {header: "Unit", width: 8}, {header: "Measurements", width: 14}];
    sm.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; sm.getRow(1).eachCell(c => { c.fill = HEAD; });
    totals.forEach(t => { const r = sm.addRow([t.c.name, {formula: "Measurement!" + t.cell, result: t.t.net}, t.c.unit, P.proj.items.filter(i => i.cond === t.c.id).length]); r.getCell(2).numFmt = "#,##0.00"; r.getCell(2).fill = GREEN; });
    const au = wb.addWorksheet("Scale & audit");
    au.columns = [{header: "Drawing", width: 34}, {header: "Page", width: 7}, {header: "Scale", width: 26}, {header: "1 ft on the sheet (pt)", width: 18}, {header: "How", width: 12}, {header: "Verified", width: 10}, {header: "Check", width: 40}];
    au.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; au.getRow(1).eachCell(c => { c.fill = HEAD; });
    Object.entries(P.proj.scales).forEach(([kk, sc]) => { const [fid, pg] = kk.split(":"), f = P.proj.files.find(x => x.id === fid); if (!f) return;
      const r = au.addRow([f.name, +pg, sc.how === "note" ? sc.text : "calibrated: " + sc.text, +sc.ptPerFt.toFixed(5), sc.how === "note" ? "scale note" : "calibrated", sc.verified ? "yes" : "NO", sc.check ? `measured ${f3(sc.check.measured)} ft vs printed ${f3(sc.check.printed)} ft` : sc.note || ""]);
      if (!sc.verified) r.eachCell(c => { c.fill = YELLOW; }); });
    const as = wb.addWorksheet("Assumptions");
    as.columns = [{header: "#", width: 5}, {header: "Item to confirm", width: 90}];
    as.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; as.getRow(1).eachCell(c => { c.fill = HEAD; });
    let an = 0;
    Object.entries(P.proj.scales).forEach(([kk, sc]) => { if (!sc.verified) { const [fid, pg] = kk.split(":"), f = P.proj.files.find(x => x.id === fid); as.addRow([++an, `Scale of ${f ? f.name : fid} p.${pg} read from its note (${sc.text}) and not checked against a printed dimension`]).getCell(2).fill = YELLOW; } });
    P.proj.conds.filter(c => c.h || c.t).forEach(c => as.addRow([++an, `${c.name}: ${c.h ? "height H " + f3(+c.h) + " ft" : ""}${c.h && c.t ? ", " : ""}${c.t ? "thickness T " + f3(+c.t) + " ft" : ""} entered for the condition — confirm against the sections`]));
    P.proj.items.filter(i => i.kind === "open").forEach(i => as.addRow([++an, `Opening ${i.label || ""} on ${pageName(i)}: height ${f3(+i.oh || 0)} ft entered — confirm against the door / window schedule`]));
    if (!an) as.addRow([1, "None"]);
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), fileBase() + "_Measurement.xlsx");
  } catch (e) { toast(e.message || String(e), 5000); }
  busy("");
}
function exportCsv(){
  const rows = [["S.No", "Condition", "Description", "Drawing / page", "Nos", "L (ft) / Area (Sft)", "W (ft)", "H (ft)", "Qty", "Unit"]];
  let sn = 0;
  sheetRows().forEach(g => { g.rows.forEach(x => { const r = x.r; rows.push([x.i === 0 ? ++sn : "", g.c.name, rowDesc(x), pageName(x.it), r.nos ?? "", r.A != null ? f3(r.A) : r.L == null ? "" : f3(r.L), r.W == null ? "" : f3(r.W), r.H == null ? "" : f3(r.H), (r.qty).toFixed(2), r.unit]); });
    rows.push(["", g.c.name, "Total " + g.c.name, "", "", "", "", "", g.t.net.toFixed(2), g.c.unit]); });
  const t = rows.map(r => r.map(v => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n");
  saveBlob(new Blob(["﻿" + t], {type: "text/csv;charset=utf-8"}), fileBase() + "_Measurement.csv");
}
async function exportPng(){
  if (!S.page) return;
  busy("Rendering marked-up page…");
  try {
    const sc = Math.min(4, 6000 / Math.max(S.base.width, S.base.height)), vp = S.page.getViewport({scale: sc}), cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await S.page.render({canvasContext: ctx, viewport: vp}).promise;
    const k = curScale(), T = p => [p[0] * sc, p[1] * sc];
    P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && !hiddenItem(i)).forEach(it => {
      const c = cond(it.cond); if (!c) return;
      ctx.lineWidth = 2 * sc / 2; ctx.strokeStyle = it.kind === "shape" ? c.color : "#d03b3b"; ctx.fillStyle = c.color;
      if (c.type === "count") { it.pts.forEach(p => { const q = T(p); ctx.beginPath(); ctx.arc(q[0], q[1], 5 * sc / 2, 0, 7); ctx.fill(); }); return; }
      ctx.beginPath(); it.pts.forEach((p, i) => { const q = T(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      if (c.type === "area") { ctx.closePath(); ctx.globalAlpha = it.kind === "shape" ? 0.22 : 0.12; ctx.fillStyle = it.kind === "shape" ? c.color : "#d03b3b"; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.setLineDash(it.kind === "shape" ? [] : [6 * sc / 2, 4 * sc / 2]); ctx.stroke(); ctx.setLineDash([]);
    });
    (P.proj.marks || []).filter(m => m.file === S.fileId && m.page === S.pageNo).forEach(m => {   // markups, drawn from the same SVG
      const z = sc / 2, svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cv.width}" height="${cv.height}">${markSvg(Object.assign({}, m, {id: ""}), T, z)}</svg>`;
      S._mk = (S._mk || []).concat([svg]);
    });
    for (const svg of S._mk || []) { const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode().catch(() => {}); ctx.drawImage(img, 0, 0); }
    S._mk = [];
    let y = 14 * sc / 2; ctx.font = `${12 * sc / 2}px Segoe UI, Arial`;
    const lines = [P.proj.name + " — " + pageName({file: S.fileId, page: S.pageNo}) + (k ? "" : " (scale not set)")].concat(P.proj.conds.map(c => c.name + ": " + f2(condTotals(c).net) + " " + c.unit));
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16 * sc / 2;
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(8, 8, w, lines.length * 17 * sc / 2 + 8);
    lines.forEach((l, i) => { ctx.fillStyle = i ? (P.proj.conds[i - 1].color) : "#0b0b0b"; ctx.fillRect(14, y + 4, i ? 8 * sc / 2 : 0, 8 * sc / 2); ctx.fillStyle = "#0b0b0b"; ctx.fillText(l, 14 + (i ? 12 * sc / 2 : 0), y + 12 * sc / 2); y += 17 * sc / 2; });
    cv.toBlob(b => saveBlob(b, fileBase() + "_p" + S.pageNo + "_markup.png"), "image/png");
  } catch (e) { toast(e.message || String(e), 5000); }
  busy("");
}
function exportJson(){ saveBlob(new Blob([JSON.stringify(Object.assign({format: "zd-takeoff", exported: new Date().toISOString()}, P.proj), null, 1)], {type: "application/json"}), fileBase() + ".takeoff.json"); }
async function exportMenu(){
  if (!P.proj) return;
  $("dlgT").textContent = "Export"; $("dlgB").innerHTML = `<p>Measurement sheet in the house format (Nos × L × W × H, decimal feet, deductions as rows).</p>`;
  $("dlgF").innerHTML = `<button class="btn" id="dlgCancel">Close</button><button class="btn" id="exJson">Project (.json)</button><button class="btn" id="exPng"${S.page ? "" : " disabled"}>Marked-up page (.png)</button><button class="btn" id="exCsv">CSV</button><button class="btn pri" id="exXls">Excel</button>`;
  $("dlgBack").classList.add("on");
  const close = () => $("dlgBack").classList.remove("on");
  $("dlgCancel").onclick = close;
  $("exXls").onclick = () => { close(); exportExcel(); }; $("exCsv").onclick = () => { close(); exportCsv(); };
  $("exPng").onclick = () => { close(); exportPng(); }; $("exJson").onclick = () => { close(); exportJson(); };
}

/* ------------------------------------------------------------------ events */
function wire(){
  const st = stage();
  st.addEventListener("pointerdown", onDown);
  st.addEventListener("pointermove", onMove);
  st.addEventListener("pointerup", onUp); st.addEventListener("pointercancel", onUp);
  st.addEventListener("contextmenu", e => e.preventDefault());
  st.addEventListener("dblclick", e => { if (["draw", "ded", "measure", "fence"].indexOf(S.tool) >= 0 && S.draft.length) endDraft(); });
  st.addEventListener("wheel", e => { if (!S.page) return; e.preventDefault(); const sp = evPos(e); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), sp[0], sp[1]); }, {passive: false});
  st.addEventListener("pointerleave", () => { S.cursor = null; S.snap = null; draw(); });
  st.addEventListener("dragover", e => { e.preventDefault(); $("drop").classList.add("over"); });
  st.addEventListener("dragleave", () => $("drop").classList.remove("over"));
  st.addEventListener("drop", e => { e.preventDefault(); $("drop").classList.remove("over"); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  new ResizeObserver(() => { if (S.page) { applyView(); renderHi(); } }).observe(st);
  document.querySelectorAll("#tools .tool[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  $("bAutoSet").onclick = () => P.proj && autoSettings();
  $("bAdd").onclick = () => $("fileIn").click();
  $("fileIn").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  $("pageSel").onchange = e => { const [f, p] = e.target.value.split("|"); if (f && p) gotoPage(f, +p); };
  $("bPrev").onclick = () => stepPage(-1); $("bNext").onclick = () => stepPage(1);
  $("bZi").onclick = () => zoomAt(1.25, stage().clientWidth / 2, stage().clientHeight / 2);
  $("bZo").onclick = () => zoomAt(0.8, stage().clientWidth / 2, stage().clientHeight / 2);
  $("bFit").onclick = () => { fit(); renderHi(); };
  $("bDim").onclick = () => setDim(!S.dim);
  $("bTypical").onclick = () => P.proj && copyPageDialog();
  $("bCompare").onclick = () => P.proj && compareDialog();
  const view = b => { S.billView = b; $("sheet").style.display = b ? "none" : ""; $("bill").style.display = b ? "" : "none"; $("vSheet").classList.toggle("on", !b); $("vBill").classList.toggle("on", b); if (b) renderBill(); };
  $("vSheet").onclick = () => view(false); $("vBill").onclick = () => view(true);
  $("bill").addEventListener("click", e => { const a = e.target.closest("[data-asm]"); if (a) asmDialog(cond(a.dataset.asm)); });
  let findT = null; $("findIn").addEventListener("input", e => { clearTimeout(findT); findT = setTimeout(() => findText(e.target.value), 350); });
  $("findIn").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(findT); findText(e.target.value); } if (e.key === "Escape") { $("findRes").classList.remove("on"); e.target.blur(); } });
  document.addEventListener("pointerdown", e => { if (!e.target.closest("#findRes,#findIn")) $("findRes").classList.remove("on"); });
  $("bClaude").onclick = () => aiToggle(!$("aiPanel").classList.contains("on"));
  $("aiClose").onclick = () => aiToggle(false);
  $("aiKeyBtn").onclick = () => aiShowKey($("aiKeyRow").style.display === "none");
  $("aiKeySave").onclick = () => { const v = $("aiKey").value.trim(); pref("zdTakeoffApiKey", v); AI.client = null; aiShowKey(!v); aiLog("bot", v ? "Key saved in this browser." : "Key removed."); };
  $("aiNew").onclick = () => { AI.history = []; AI.view = null; $("aiLog").innerHTML = ""; aiToggle(true); };
  $("aiCopy").onclick = () => freeCopy();
  $("aiImport").onclick = () => freeImport();
  $("aiRead").onclick = () => aiSend($("aiIn").value.trim() || "Measure the floor area of every room in this view.", true).then(() => { $("aiIn").value = ""; });
  $("aiSend").onclick = () => { const t = $("aiIn").value.trim(); if (t) aiSend(t, false).then(() => { $("aiIn").value = ""; }); };
  $("aiIn").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("aiSend").click(); } });
  $("bLw").onclick = () => setThin(!S.thin);
  $("bUndo").onclick = undo; $("bRedo").onclick = redo;
  $("bExport").onclick = exportMenu;
  $("scaleChip").onclick = scaleDialog;
  $("bNewCond").onclick = () => P.proj && editCond(null);
  $("bProjects").onclick = showStart;
  $("projName").onchange = e => { if (P.proj) { P.proj.name = e.target.value.trim() || "Untitled takeoff"; save(); } };
  $("bNewProj").onclick = async () => { const v = await ask("New project", '<div class="fg w2"><label>Project name</label><input type="text" id="dlgName" placeholder="e.g. NEO — Block A ground floor"></div>', "Create", () => ({name: $("dlgName").value.trim() || "Untitled takeoff"}), "dlgName");
    if (!v) return; const pr = newProject(v.name); await dbPut("projects", pr); await openProject(pr.id); };
  $("bImport").onclick = () => $("impIn").click();
  $("impIn").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const o = JSON.parse(await f.text()); if (o.format !== "zd-takeoff" || !o.items) throw new Error("not a takeoff project file");
      const pr = Object.assign(newProject(o.name), {conds: o.conds, items: o.items, scales: o.scales, files: o.files, last: o.last || {}}); await dbPut("projects", pr);
      const miss = []; for (const f of pr.files) if (!(await dbGet("pdfs", f.id))) miss.push(f.name);
      await openProject(pr.id);
      toast(miss.length ? "Imported — add " + miss.join(", ") + " with + PDF to re-attach the drawing" + (miss.length > 1 ? "s" : "") : "Imported", 6000); } catch (er) { toast("Could not import: " + er.message, 5000); } };
  $("projList").addEventListener("click", async e => {
    const o = e.target.closest("[data-open],[data-dup],[data-del]"); if (!o) return;
    if (o.dataset.open) return openProject(o.dataset.open);
    if (o.dataset.dup) { const pr = await dbGet("projects", o.dataset.dup); const cp = Object.assign(JSON.parse(JSON.stringify(pr)), {id: uid("P"), name: pr.name + " (copy)", updated: new Date().toISOString()}); await dbPut("projects", cp); return showStart(); }
    if (o.dataset.del) { const pr = await dbGet("projects", o.dataset.del); const ok = await ask("Delete project", `<p>Delete <b>${esc(pr.name)}</b> with its ${pr.items.length} measurements and stored PDFs? This cannot be undone.</p>`, "Delete");
      if (!ok) return; const others = (await dbAll("projects")).filter(x => x.id !== pr.id), keep = new Set(others.flatMap(x => x.files.map(f => f.id)));
      for (const f of pr.files) if (!keep.has(f.id)) await dbDel("pdfs", f.id); await dbDel("projects", pr.id); if (P.proj && P.proj.id === pr.id) P.proj = null; showStart(); }
  });
  $("condList").addEventListener("click", e => {
    if (e.target.id === "bFirstCond") return editCond(null);
    const ed = e.target.closest("[data-edit]"); if (ed) return editCond(cond(ed.dataset.edit));
    const ey = e.target.closest("[data-eye]"); if (ey) { const c = cond(ey.dataset.eye); c.hidden = !c.hidden; if (c.hidden && S.sel && P.proj.items.some(i => i.id === S.sel && i.cond === c.id)) S.sel = null; save(); refresh(); return; }
    const co = e.target.closest("[data-color]"); if (co) return colorPop(co, cond(co.dataset.color));
    const c = e.target.closest("[data-cond]"); if (!c) return;
    S.cond = c.dataset.cond; S.sel = null; const ct = cond(S.cond).type;
    setTool(S.tool === "select" || S.tool === "pan" || S.tool === "measure" || S.tool === "cal" || (S.tool === "count" && ct !== "count") || (S.tool === "auto" && ct !== "area") ? (ct === "count" ? "count" : "draw") : S.tool); refresh();
  });
  $("sheet").addEventListener("click", async e => {   // (rows also jump to their page)
    const rn = e.target.closest("[data-rename]");
    if (rn) { const it = P.proj.items.find(i => i.id === rn.dataset.rename); if (!it) return;
      const v = await ask("Name this measurement", `<div class="fg w2"><label>Name as it should read on the sheet</label><input type="text" id="dlgLbl" value="${esc(it.label)}" placeholder="e.g. Bedroom 1, Lounge, Kitchen"></div>
        <p class="small" style="margin-top:8px">Leave blank to show the default (“${esc(kindName(it, cond(it.cond)))}”).</p>`, "Save", () => ({v: $("dlgLbl").value.trim()}), "dlgLbl");
      if (v) mutate(() => { it.label = v.v; }); return; }
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
    if (mk) { mutate(() => { mk[e.target.dataset.mprop] = e.target.value; }); return; }
    const it = P.proj.items.find(i => i.id === S.sel), f = e.target.dataset.prop; if (!it || !f) return;
    mutate(() => {
      if (f === "nos") it.nos = Math.max(1, Math.round(+e.target.value || 1));
      else if (f === "ow" || f === "oh") { const v = e.target.value.trim() ? parseFt(e.target.value) : 0; if (!isNaN(v)) it[f] = v; }
      else it[f] = e.target.value;
    });
  });
  $("props").addEventListener("click", e => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (a.dataset.act === "delMark") { const id = S.selMark; mutate(() => { P.proj.marks = (P.proj.marks || []).filter(m => m.id !== id); }); S.selMark = null; refresh(); return; }
    const it = P.proj.items.find(i => i.id === S.sel); if (!it) return;
    if (a.dataset.act === "delItem") { mutate(() => { P.proj.items = P.proj.items.filter(i => i.id !== it.id); }); S.sel = null; refresh(); }
    if (a.dataset.act === "delPoint" && S.selPt >= 0) { mutate(() => { it.pts.splice(S.selPt, 1); if (!it.pts.length) P.proj.items = P.proj.items.filter(i => i.id !== it.id); }); S.selPt = -1; refresh(); }
  });
  document.addEventListener("keydown", e => {
    if ($("dlgBack").classList.contains("on") || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!P.proj) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); return redo(); }
    if (e.altKey && S.cmp && /^Arrow/.test(e.key)) { e.preventDefault(); const st2 = (e.shiftKey ? 10 : 1) / S.view.s; S.cmp.dx += e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0; S.cmp.dy += e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0; clearTimeout(S.cmpT); S.cmpT = setTimeout(() => { renderLow(); renderHi(true); }, 120); return; }
    if ((e.ctrlKey || e.metaKey) && k === "c") { e.preventDefault(); return copySel(); }
    if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); return pasteClip(); }
    if ((e.ctrlKey || e.metaKey) && k === "f") { e.preventDefault(); $("findIn").focus(); $("findIn").select(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") { S.space = true; stage().classList.add("pan"); e.preventDefault(); return; }
    if (e.key === "Escape") { if (S.autoShow) { S.autoShow = null; } if (S.pickWall) { S.pickWall = false; hint(); } else if (S.draft.length) { S.draft = []; } else if (S.measures.length || S.measure) { S.measures = []; S.measure = null; } else if (S.sel) { S.sel = null; } else setTool("select"); refresh(); return; }
    if (e.key === "Enter") {
      if (S.tool === "measure" && S.verify && S.measure && S.measure.length > 1) return verifyMeasure();
      if (S.draft.length) endDraft();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (S.draft.length) { S.draft.pop(); if (S.tool === "measure") S.measure = S.draft.slice(); draw(); e.preventDefault(); return; }
      if (S.selMark) { e.preventDefault(); const id = S.selMark; mutate(() => { P.proj.marks = (P.proj.marks || []).filter(m => m.id !== id); }); S.selMark = null; refresh(); return; }
      const it = S.sel && P.proj.items.find(i => i.id === S.sel);
      if (it) { e.preventDefault(); const c = cond(it.cond);
        if (c && c.type === "count" && S.selPt >= 0 && it.pts.length > 1) mutate(() => { it.pts.splice(S.selPt, 1); });
        else mutate(() => { P.proj.items = P.proj.items.filter(i => i.id !== it.id); });
        S.sel = null; S.selPt = -1; refresh(); }
      return;
    }
    const T = {v: "select", h: "pan", a: "draw", r: "rect", w: "auto", c: "count", e: "circle", n: "note", u: "cloud", d: "ded", o: "open", m: "measure", k: "cal"};
    if (T[k]) { setTool(T[k]); return; }
    if (k === "s") { $("snapOn").checked = !$("snapOn").checked; toast("Snap " + ($("snapOn").checked ? "on" : "off")); return; }
    if (k === "f") { fit(); renderHi(); return; }
    if (k === "+" || k === "=") return zoomAt(1.25, stage().clientWidth / 2, stage().clientHeight / 2);
    if (k === "-") return zoomAt(0.8, stage().clientWidth / 2, stage().clientHeight / 2);
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
const AI_SYSTEM = `You are a quantity surveyor's assistant inside a PDF takeoff tool. You see part of a construction drawing (usually a floor plan) as an image, with the text found on the PDF page and where it sits.

Your job: measure what the user asks for — usually the floor area of rooms — by calling the drawing tools, then report briefly.

Coordinates: image pixels, origin at the top-left of the image, x to the right, y down. Every point you give must be inside the image.

How to measure a room:
1. Find the room from its name text (e.g. BEDROOM, LOUNGE, BATH). The size written under the name (e.g. 14'-6"x12'-0" = 14.5 ft × 12.0 ft = 174.00 Sft) is the designer's nominal size — use it to check your result.
2. Call trace_room with a point well inside the room: in open floor, away from walls, furniture and text. The tool traces the room from the drawing's walls and returns the area in Sft and the outline in image pixels.
3. Check the result. If the area is far from the written size (more than about 5%), or the outline runs through a wall into another room, call delete_area on it and then draw_area with the room's corners read off the image, clockwise, at the inside faces of the walls. L-shaped and notched rooms need every corner.
4. Name every area exactly as the room is named on the drawing (e.g. "BEDROOM 1", "LOUNGE"). If two rooms share a name, number them.

Rules:
- Never invent a dimension. If a room has no written size, say so and rely on the traced outline.
- Do not re-measure rooms already listed as measured unless the user asks.
- When asked for walls or other lengths, use draw_length along the wall centre or face as asked; for doors, windows and fixtures, use add_counts with one point on each, using the tags on the drawing (D1, W2…) to name the condition.
- Units: decimal feet, Sft. Never metric.
- Reply in short plain sentences: one line per room — name, area in Sft, and whether it matches the written size. Mention anything you could not measure and why.`;
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
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["condition", "name", "points"], properties: {
     condition: {type: "string", description: "Length condition, e.g. \"Brick masonry 9\\\" wall\" or \"Skirting\""}, name: {type: "string", description: "Label, e.g. the room or wall name"},
     points: {type: "array", items: {type: "object", additionalProperties: false, required: ["x", "y"], properties: {x: {type: "number"}, y: {type: "number"}}}}}}},
  {name: "add_counts", description: "Count items (doors, windows, fixtures, lights) by placing one point on each (image pixels). Recorded under the named count condition, created if missing. Returns the new total on this page.",
   strict: true, input_schema: {type: "object", additionalProperties: false, required: ["condition", "points"], properties: {
     condition: {type: "string", description: "What is counted, e.g. \"Doors D2\" or \"Windows\""},
     points: {type: "array", items: {type: "object", additionalProperties: false, required: ["x", "y"], properties: {x: {type: "number"}, y: {type: "number"}}}}}}},
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
async function aiSnapshot(){   // the part of the page on screen, long side 1600 px at most
  const st = stage(), v = S.view;
  const bx0 = Math.max(0, -v.tx / v.s), by0 = Math.max(0, -v.ty / v.s);
  const bx1 = Math.min(S.base.width, (st.clientWidth - v.tx) / v.s), by1 = Math.min(S.base.height, (st.clientHeight - v.ty) / v.s);
  const w = bx1 - bx0, h = by1 - by0, sc = Math.min(1600 / Math.max(w, h), 8), W = Math.max(1, Math.round(w * sc)), H = Math.max(1, Math.round(h * sc));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  await S.page.render({canvasContext: ctx, viewport: S.page.getViewport({scale: sc}), transform: [1, 0, 0, 1, -bx0 * sc, -by0 * sc]}).promise;
  return {data: cv.toDataURL("image/png").split(",")[1], x0: bx0, y0: by0, sc, W, H, key: S.key};
}
const aiToPx = (V, p) => [Math.round((p[0] - V.x0) * V.sc), Math.round((p[1] - V.y0) * V.sc)];
const aiToBase = (V, x, y) => [V.x0 + x / V.sc, V.y0 + y / V.sc];
function aiContext(V){   // page text and measured areas inside the view, in image pixels
  const k = curScale(), inV = q => q[0] >= 0 && q[1] >= 0 && q[0] <= V.W && q[1] <= V.H;
  const texts = (S.texts[S.key] || []).map(t => ({s: t.s.trim(), q: aiToPx(V, [t.x, t.y])})).filter(t => t.s && inV(t.q)).slice(0, 400);
  const areas = P.proj.items.filter(it => it.file === S.fileId && it.page === S.pageNo && it.kind === "shape" && (cond(it.cond) || {}).type === "area")
    .map(it => ({it, q: it.pts.map(p => aiToPx(V, p))})).filter(a => a.q.some(inV));
  return `Image: ${V.W} × ${V.H} px. Scale: ${k ? "1 ft = " + (k * V.sc).toFixed(3) + " px in this image" : "not set — areas cannot be measured until the scale is set (K)"}.
Text on the page in view (text @ x,y px):
${texts.length ? texts.map(t => `"${t.s}" @ ${t.q[0]},${t.q[1]}`).join("\n") : "(none — the drawing may be a scan; read the image)"}
Already measured here: ${areas.length ? areas.map(a => `${a.it.id} "${a.it.label || "area"}" ${f2(polyArea(a.it.pts) / k / k)} Sft`).join("; ") : "none"}`;
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
  const add = (name, pts) => { const c = aiAreaCond(), id = uid("I"); mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, label: String(name || "").slice(0, 60)}); }); return id; };
  if (b.name === "trace_room") {
    const x = +inp.x, y = +inp.y; if (!(x >= 0 && y >= 0 && x <= V.W && y <= V.H)) return {err: "Point is outside the image."};
    const res = await autoRoom(aiToBase(V, x, y)); if (res.err) return {err: res.err};
    const id = add(inp.name, res.pts);
    return {ok: {id, name: inp.name, area_sft: +(polyArea(res.pts) / k / k).toFixed(2), squared: res.rect, outline_px: res.pts.map(p => aiToPx(V, p))}};
  }
  if (b.name === "draw_area") {
    const pts = (Array.isArray(inp.points) ? inp.points : []).filter(p => p && isFinite(+p.x) && isFinite(+p.y)).map(p => aiToBase(V, +p.x, +p.y));
    if (pts.length < 3 || polyArea(pts) < 1e-6) return {err: "Need at least 3 corners enclosing an area."};
    const id = add(inp.name, pts);
    return {ok: {id, name: inp.name, area_sft: +(polyArea(pts) / k / k).toFixed(2)}};
  }
  if (b.name === "draw_length" || b.name === "add_counts") {
    const pts = (Array.isArray(inp.points) ? inp.points : []).filter(p => p && isFinite(+p.x) && isFinite(+p.y)).map(p => aiToBase(V, +p.x, +p.y));
    if (b.name === "draw_length") {
      if (pts.length < 2) return {err: "Need at least 2 points."};
      const c = condByName(inp.condition, "linear"), id = uid("I");
      mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, label: String(inp.name || "").slice(0, 60)}); });
      return {ok: {id, name: inp.name, length_ft: +(polyLen(pts) / k).toFixed(3)}};
    }
    if (!pts.length) return {err: "No points."};
    const c = condByName(inp.condition, "count"); let it;
    mutate(() => { it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape");
      if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); }
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
function aiLog(kind, html){ const d = document.createElement("div"); d.className = "aimsg " + kind; d.innerHTML = html; $("aiLog").appendChild(d); $("aiLog").scrollTop = 1e9; return d; }
const aiText = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
async function aiSend(text, fresh){
  if (AI.busy || !P.proj) return;
  if (!S.page) return aiLog("err", "Open a PDF page first.");
  let client;
  try { client = await aiClient(); } catch (e) { return aiLog("err", esc(e.message)); }
  if (!client) { aiShowKey(true); return aiLog("err", "Add your Anthropic API key first (above)."); }
  AI.busy = true; $("aiSend").disabled = true; $("aiRead").disabled = true;
  aiLog("user", esc(text));
  const wait = aiLog("wait", "Claude is reading the drawing…");
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
      });
      if (res.stop_reason === "refusal") { AI.history = []; aiLog("err", "Claude declined this request" + (res.stop_details && res.stop_details.explanation ? ": " + esc(res.stop_details.explanation) : "") + ". The chat was reset."); break; }
      AI.history.push({role: "assistant", content: res.content});
      res.content.forEach(b => { if (b.type === "text" && b.text.trim()) aiLog("bot", aiText(b.text)); });
      if (res.stop_reason === "max_tokens") { aiLog("err", "The answer was cut off (too long). Ask for fewer rooms at a time."); break; }
      if (res.stop_reason !== "tool_use") break;
      const results = [];
      for (const b of res.content.filter(x => x.type === "tool_use")) {
        let out; try { out = await aiRunTool(b); } catch (e) { out = {err: e.message || String(e)}; }
        aiLog("tool", out.ok ? (out.ok.deleted ? "Deleted an area" : out.ok.length_ft != null ? `${esc(b.input.condition)} ${esc(b.input.name || "")}: <b>${f3(out.ok.length_ft)} ft</b>` : out.ok.count_on_page != null ? `${esc(out.ok.name)}: <b>${out.ok.count_on_page} Nos</b> on this page` : `${esc(b.input.name || "")}: <b>${f2(out.ok.area_sft)} Sft</b>`) + ` <span class="small">(${esc(b.name.replace("_", " "))})</span>` : `${esc(b.input && b.input.name || b.name)}: ${esc(out.err)}`);
        results.push({type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out.ok || {error: out.err}), is_error: !out.ok});
      }
      AI.history.push({role: "user", content: results});
      refresh();
    }
  } catch (e) {
    const st = e && e.status;
    aiLog("err", st === 401 ? "The API key was not accepted — check it (above)." : st === 429 ? "Rate limited by the API — wait a minute and try again." : esc("Request failed: " + (e.message || e)));
    if (st === 401) aiShowKey(true);
    // keep the conversation valid: drop a trailing user turn the API never answered
    while (AI.history.length && AI.history[AI.history.length - 1].role === "user" && !(AI.history[AI.history.length - 1].content || []).some(x => x.type === "tool_result")) AI.history.pop();
  }
  wait.remove(); AI.busy = false; $("aiSend").disabled = false; $("aiRead").disabled = false; refresh();
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
    if (pts && want && Math.abs(ar(pts) - want) / want > 0.05 && corners.length >= 3) { how = "from Claude's corners (trace gave " + f2(ar(pts)) + ")"; pts = corners; }
    if (!pts && corners.length >= 3) { pts = corners; how = "from Claude's corners"; }
    if (!pts) { aiLog("err", esc(r.name || "room") + ": no usable seed or corners"); continue; }
    const c = aiAreaCond(), id = uid("I"), a2 = ar(pts);
    mutate(() => { P.proj.items.push({id, cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, label: String(r.name || "").slice(0, 60)}); });
    aiLog("tool", `${esc(r.name || "")}: <b>${f2(a2)} Sft</b> <span class="small">${esc(how)}${want ? " · written " + f2(want) + " Sft" + (Math.abs(a2 - want) / want > 0.05 ? " — check" : " ✓") : ""}</span>`);
  }
  for (const l of (J.lengths || [])) { const pts = (l.points || []).filter(inImg).map(q => aiToBase(V, q[0], q[1])); if (pts.length < 2) continue;
    const c = condByName(l.condition, "linear"); mutate(() => { P.proj.items.push({id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts, nos: 1, label: String(l.name || "").slice(0, 60)}); });
    aiLog("tool", `${esc(c.name)} ${esc(l.name || "")}: <b>${f3(polyLen(pts) / k)} ft</b>`); }
  for (const g of (J.counts || [])) { const pts = (g.points || []).filter(inImg).map(q => aiToBase(V, q[0], q[1])); if (!pts.length) continue;
    const c = condByName(g.condition, "count"); let it;
    mutate(() => { it = P.proj.items.find(i => i.cond === c.id && i.file === S.fileId && i.page === S.pageNo && i.kind === "shape"); if (!it) { it = {id: uid("I"), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [], nos: 1, label: ""}; P.proj.items.push(it); } pts.forEach(p => it.pts.push(p)); });
    aiLog("tool", `${esc(c.name)}: <b>${pts.length} Nos</b> added`); }
  busy(""); refresh();
}
function aiShowKey(on){ $("aiKeyRow").style.display = on ? "flex" : "none"; if (on) $("aiKey").value = pref("zdTakeoffApiKey") || ""; }
function aiToggle(on){
  $("aiPanel").classList.toggle("on", on); $("bClaude").classList.toggle("on", on);
  if (on) { aiShowKey(false); if (!$("aiLog").children.length) aiLog("bot", "I read the part of the drawing on screen and measure rooms, walls and counts. Zoom to the area you want and type what to measure, e.g. <i>measure every bedroom</i>.<br><b>With an API key:</b> press <b>Read this view</b>.<br><b>Free, with your Claude.ai plan:</b> press <b>Copy for Claude</b>, paste in a claude.ai chat, then <b>Import from Claude</b>."); setTimeout(() => $("aiIn").focus(), 0); }
}

function pref(k, v){ try { if (v === undefined) return localStorage.getItem(k); if (v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function setDim(on){ S.dim = on; stage().classList.toggle("dim", on); $("bDim").classList.toggle("on", on); pref("zdTakeoffDim", on ? "1" : "0"); }
function setThin(on){ S.thin = on; $("bLw").classList.toggle("on", !on); $("bLw").title = on ? "Line weights are off — click to show them" : "Line weights are on — click to draw every line thin"; pref("zdTakeoffThin", on ? "1" : "0"); if (S.page) { renderLow(); renderHi(true); } }

/* ------------------------------------------------------------------ start */
(async function init(){
  wire();
  setDim(pref("zdTakeoffDim") === "1"); setThin(pref("zdTakeoffThin") === "1");
  try { DB = await openDB(); } catch (e) { $("drop").innerHTML = '<div class="box">This browser blocks local storage (private window?) — projects cannot be saved here.</div>'; return; }
  window.zdTakeoff = {P, S, rowsOf, condTotals, parseFt, scaleCandidates, rectilinear, triangles, gotoPage, openProject, segsIn, doorSymbols, barrierIds, autoRoom, evalFormula, freeV: () => AI.freeView};   // for tests and the console
  const last = localStorage.getItem("zdTakeoffLast");
  const all = await dbAll("projects");
  if (last && all.some(p => p.id === last)) await openProject(last); else await showStart();
  loadPdfjs().catch(e => toast(e.message, 6000));
})();

/* ZD PDF Takeoff — the Workbook: the takeoff's bill of quantities as an estimating workbook, as RIB CostX's — opened full screen
   from Costing → Workbook, kept with the project (P.proj.wb), loaded only when it is opened (with takeoff.js's ?v=).

   A workbook is a Summary (level 1) of sections — bills or trades, each a sheet (level 2) of rows: headings (in levels), items and
   notes. An item is Code · Description · Quantity · Unit · Rate · Total (Qty × Rate), with user columns beside, and:
   - its quantity typed, a formula (=12*3*WASTE), or live-linked to the takeoff — a condition's own quantity, length, wall area,
     volume, area, perimeter, perimeter less doors or count (CostX's quantity types), or one of its assembly lines — one line or a
     quantity breakdown of many (typed, formulas and links, each × a factor), worked out again from the takeoff whenever it opens;
   - its rate typed, a formula, live-linked to a Rate Analysis code of the QS Cost Control library (its built-up rate and its split
     into material, labour, plant and the rest), or its own rate build-up (labour, material, plant, subcontract, other lines, + waste
     on material, OH and profit);
   - the library's items found by code or words and dropped in with their description, unit and rate.
   The Summary has every section's total and its share, then the markups (overheads, profit, contingency, tax — a % of the net or of
   the running total, or a lump sum) down to the grand total. Workbook variables (WASTE = 1.05, H = 10) are used in any formula.
   Generate from takeoff builds it all from the conditions (by BOQ item group, condition group or as one bill) and Update links adds
   what was measured since; Revisions keep its figures to compare against later (quantity, rate, total and the variance, row by
   row); Check lists dead links, unpriced and unmeasured items and formula errors; Export writes it to Excel with live formulas.
   The grid is a spreadsheet: arrows, Tab, Enter, F2, typing, Delete, Ctrl+C / Ctrl+V (to and from Excel), Ctrl+Z / Ctrl+Y,
   Ctrl+Enter a row, Ctrl+Shift+Enter a heading, Ctrl+Delete, Alt+↑↓ to move, Alt+←→ to change a heading's level, Ctrl+D. */
let A = null, UI = null;
const NUMS = /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const KINDS = [["L", "Labour"], ["M", "Material"], ["P", "Plant"], ["S", "Subcontract"], ["O", "Other"]];
const MARK_PRE = [["Overheads", 5], ["Profit", 10], ["Contingency", 5], ["GST / sales tax", 17]];
const QTS = ["q", "len", "area", "vol", "sarea", "per", "pd", "n"];
const MAXREV = 20, MAXUNDO = 120;

export function open(api){
  A = api; css();
  if (!A.P.proj) return A.toast("Open a project first", 2400);
  const wb = A.P.proj.wb = norm(A.P.proj.wb);
  UI = {sec: wb.secs.length ? wb.secs[0].id : "", ri: 0, ck: "desc", anchor: null, edit: null, undo: [], redo: [], q: "", flt: "all", cmp: "", split: false, pane: true};
  build();
  if (!wb.secs.length) generateDialog(true); else render();
}
export function close(){ if (!UI) return; window.removeEventListener("keydown", onKey, true); document.removeEventListener("copy", onCopy, true); document.removeEventListener("paste", onPaste, true);
  const r = document.getElementById("wbRoot"); if (r) r.remove(); UI = null; A.refresh(); }
export const isOpen = () => !!UI;
export async function exportExcel(api){ A = api; if (!A.P.proj) return; A.P.proj.wb = norm(A.P.proj.wb); if (!WB().secs.length) return A.toast("No workbook yet — Costing → Workbook builds it from the takeoff", 2800); await exportXls(); }

/* ------------------------------------------------------------------ the model */
function norm(wb){
  wb = wb && typeof wb === "object" ? wb : {};
  wb.v = 1; wb.secs = Array.isArray(wb.secs) ? wb.secs : []; wb.vars = Array.isArray(wb.vars) ? wb.vars : []; wb.marks = Array.isArray(wb.marks) ? wb.marks : [];
  wb.cols = Array.isArray(wb.cols) ? wb.cols : []; wb.revs = Array.isArray(wb.revs) ? wb.revs : [];
  wb.secs.forEach(s => { s.rows = Array.isArray(s.rows) ? s.rows : []; s.rows.forEach(r => { r.t = r.t || "item"; r.lvl = +r.lvl || 0; }); });
  return wb;
}
const WB = () => A.P.proj.wb;
const secOf = id => WB().secs.find(s => s.id === id) || null;
const rowOf = id => { for (const s of WB().secs) { const r = s.rows.find(x => x.id === id); if (r) return {s, r}; } return null; };
const nid = p => A.uid(p);
const newRow = (o) => Object.assign({id: nid("R"), t: "item", lvl: 0, code: "", desc: "", unit: "", qe: "", re: ""}, o || {});
function edit(fn, keepPane){   // every change: one undo step, saved, drawn again
  UI.undo.push(JSON.stringify(WB())); if (UI.undo.length > MAXUNDO) UI.undo.shift(); UI.redo = [];
  fn(); A.save(); render(keepPane);
}
function undo(redo){
  const from = redo ? UI.redo : UI.undo, to = redo ? UI.undo : UI.redo; if (!from.length) return A.toast(redo ? "Nothing to redo" : "Nothing to undo", 1400);
  to.push(JSON.stringify(WB())); A.P.proj.wb = norm(JSON.parse(from.pop())); if (!secOf(UI.sec) && UI.sec !== "") UI.sec = WB().secs[0] ? WB().secs[0].id : ""; A.save(); render();
}

/* ------------------------------------------------------------------ figures: variables, quantities, rates, totals */
const fac = u => { const f = A.uV(1, u); return f > 0 ? f : 1; };   // a unit as shown (m, m², m³) per its own (ft, Sft, cft)
function varsOf(){   // the workbook's variables, in order (a later one may use an earlier one)
  const out = {}; WB().vars.forEach(v => { const k = String(v.name || "").trim().toUpperCase(); if (!/^[A-Z][A-Z0-9_]*$/.test(k)) return; try { out[k] = A.evalFormula(String(v.e || "0").replace(/^=/, ""), out, A.refOf()); } catch (e) { out[k] = NaN; } });
  return out;
}
function val(e, vars){   // an entry: "" → null, a number, or =formula → {v} or {err}
  const s = String(e == null ? "" : e).trim(); if (!s) return {v: null};
  if (s[0] === "=") { try { return {v: A.evalFormula(s.slice(1), vars, A.refOf()), f: true}; } catch (er) { return {v: null, err: er.message}; } }
  if (NUMS.test(s)) return {v: +s.replace(/,/g, "")};
  return {v: null, err: "Not a number — a formula starts with ="};
}
const inQ = (x, m, u) => x == null ? null : m ? x / fac(u) : x;   // a figure typed as shown → in its own unit
const inR = (x, m, u) => x == null ? null : m ? x * fac(u) : x;
function linkOf(k, memo){   // a live link {cond, qt} or {cond, asm} → {v, unit, name, dead, why}
  const c = A.cond(k.cond); if (!c) return {v: 0, dead: true, why: "its condition was deleted"};
  if (k.asm) { const L = memo.bill || (memo.bill = A.billLines()), l = L.find(x => x.kind === "asm" && x.c.id === c.id && x.a.id === k.asm);
    return l ? {v: l.err ? 0 : l.qty, unit: l.unit, name: c.name + " → " + l.name, err: l.err} : {v: 0, dead: true, why: "the assembly line was deleted"}; }
  const vars = memo.v.get(c.id) || (memo.v.set(c.id, A.condVars(c)), memo.v.get(c.id)), q = A.condQ(c, k.qt || "q", null, vars);
  return q ? {v: q.v, unit: q.unit, name: c.name + " · " + (k.qt && k.qt !== "q" ? A.QT_NAMES[k.qt] : "its quantity")} : {v: 0, dead: true, why: "it has no " + (A.QT_NAMES[k.qt] || "such quantity").toLowerCase() + " (height / thickness not set)"};
}
function qtyOf(r, vars, memo){   // → {v, err, links, dead, f}
  if (Array.isArray(r.qb) && r.qb.length) {
    let v = 0, err = "", links = 0, dead = 0, mis = "";
    r.qb.forEach(l => { const x = val(l.x == null || l.x === "" ? "1" : l.x, vars), m = x.v == null ? 1 : x.v; if (x.err) err = err || "× " + x.err;
      if (l.link) { const k = linkOf(l.link, memo); links++; if (k.dead) { dead++; l._v = 0; return; } if (k.err) err = err || k.err; if (r.unit && k.unit && A.normU(k.unit) !== A.normU(r.unit)) mis = k.unit; l._v = k.v * m; v += l._v; }
      else { const y = val(l.e, vars); if (y.err) err = err || y.err; l._v = (inQ(y.v, l.m, r.unit) || 0) * m; v += l._v; } });
    return {v, err, links, dead, mis};
  }
  const y = val(r.qe, vars); return {v: inQ(y.v, r.qm, r.unit), err: y.err, f: y.f};
}
function rateOfRow(r, vars){   // → {v, err, src, comp: [M, L, P, O] per unit, ra}
  if (r.rb && Array.isArray(r.rb.lines)) {
    const b = r.rb, by = {L: 0, M: 0, P: 0, S: 0, O: 0}; let err = "";
    b.lines.forEach(l => { const q = val(l.q === "" || l.q == null ? "1" : l.q, vars), rt = val(l.r, vars); if (q.err || rt.err) err = err || q.err || rt.err; l._v = (q.v || 0) * (rt.v || 0); by[l.k || "O"] = (by[l.k || "O"] || 0) + l._v; });
    const w = (+b.w || 0) / 100, sub = by.M * (1 + w) + by.L + by.P + by.S + by.O, oh = sub * (+b.oh || 0) / 100, pf = (sub + oh) * (+b.pf || 0) / 100, f = r.rbm ? fac(r.unit) : 1;
    return {v: (sub + oh + pf) * f, err, src: "build-up", comp: [by.M * (1 + w) * f, by.L * f, by.P * f, (by.S + by.O + oh + pf) * f], bu: {by, sub, oh, pf}};
  }
  if (String(r.ra || "").trim()) { const x = A.rateOf({ra: r.ra}, r.unit || "");
    return x.na ? {v: 0, err: x.na, src: "RA " + r.ra, ra: true} : {v: x.rate, src: x.src || "RA " + r.ra, comp: x.comp ? [x.comp.mat, x.comp.lab, x.comp.eqp, x.comp.oth] : null, ra: true, assumed: x.assumed}; }
  const y = val(r.re, vars); return {v: inR(y.v, r.rm, r.unit), err: y.err, f: y.f, src: y.v == null ? "" : y.f ? "formula" : "typed"};
}
/* the whole workbook worked out: each row's quantity, rate and total, headings' subtotals, sections, markups, grand total */
function calc(){
  const wb = WB(), vars = varsOf(), memo = {v: new Map()}, R = new Map(), S = new Map(); let net = 0;
  wb.secs.forEach(s => {
    let tot = 0; const split = [0, 0, 0, 0], user = {};
    s.rows.forEach(r => { if (r.t !== "item") return;
      const q = qtyOf(r, vars, memo), rt = rateOfRow(r, vars), t = (q.v || 0) * (rt.v || 0);
      const sp = rt.comp ? rt.comp.map(x => x * (q.v || 0)) : null; if (sp) sp.forEach((x, i) => { split[i] += x; });
      R.set(r.id, {q, r: rt, t, sp}); tot += t;
      wb.cols.forEach(c => { if (c.kind === "num") { const x = val((r.u || {})[c.id], vars); if (x.v != null) user[c.id] = (user[c.id] || 0) + x.v; } }); });
    // a heading's subtotal: the items after it down to the next heading of its level or above
    s.rows.forEach((r, i) => { if (r.t !== "head") return; let t = 0; for (let j = i + 1; j < s.rows.length; j++) { const x = s.rows[j]; if (x.t === "head" && x.lvl <= r.lvl) break; if (x.t === "item") t += R.get(x.id).t; } R.set(r.id, {t}); });
    S.set(s.id, {t: tot, split, user}); net += tot; });
  let run = net; const M = wb.marks.map(m => { const x = val(m.e, vars), v = x.v == null ? 0 : m.kind === "sum" ? x.v : (m.base === "run" ? run : net) * x.v / 100; run += v; return {m, v, err: x.err}; });
  return {R, S, net, M, grand: run, vars};
}

/* ------------------------------------------------------------------ generate from the takeoff */
function groupOf(c, how){
  if (how === "one") return "Bill of quantities";
  if (how === "folder") return c.group || "General";
  const L = A.raLib(); if (!L.o) return "General";
  const code = String(c.ra || c.boq || "").trim().toUpperCase(), it = code && L.items.get(code); if (!it) return "General";
  for (const [n, f] of A.BOQ_GROUPS) if (f(String(it.sub || ""), String(it.desc || ""), String(it.cat || "").trim())) return n;
  return "Other";
}
function genRows(how, descLib, asm){   // → Map(section name → rows) of every bill line, each live-linked to its condition
  const L = A.raLib(), out = new Map(), lines = A.billLines();
  lines.forEach(l => { if (l.kind === "asm" && !asm) return;
    const c = l.c, g = groupOf(c, how), code = String((l.kind === "asm" ? l.a.boq || l.a.ra : c.boq || c.ra) || "").trim(), ra = String((l.kind === "asm" ? l.a.ra : c.ra) || "").trim();
    const it = L.o && (ra || code) ? L.items.get((ra || code).toUpperCase()) : null;
    const desc = descLib && it && it.desc ? String(it.desc) : l.kind === "asm" ? c.name + " — " + l.name : c.name;
    const link = l.kind === "asm" ? {cond: c.id, asm: l.a.id} : {cond: c.id, qt: l.bq || "q"};
    const r = newRow({code, desc, unit: l.unit, qb: [{id: nid("Q"), desc: l.kind === "asm" ? c.name + " → " + l.name : c.name, link, x: "1"}], src: l.kind === "asm" ? {cond: c.id, asm: l.a.id} : {cond: c.id}});
    if (ra) r.ra = ra; else if (l.rate > 0) { r.re = String(+(+l.rate).toFixed(6)); r.note = "Rate from the condition: " + (l.src || "") + (l.date ? ", " + A.dmy(l.date) : ""); }
    if (!out.has(g)) out.set(g, []); out.get(g).push(r); });
  return out;
}
async function generateDialog(first){
  const has = WB().secs.length;
  const body = `${first ? '<p>This project has no workbook yet. It is built from the takeoff: every condition (and the items its Assembly drives) becomes a row, its quantity <b>live-linked</b> to what is measured, its rate from its Rate Analysis code or its typed rate — then it is yours to edit as a spreadsheet.</p>' : ""}
    <div class="grid"><div class="fg w2"><label>Sections</label><select id="wgHow"><option value="boq">By BOQ item group (Concrete, Masonry, Plaster…) — from each condition's rate code</option><option value="folder">By condition group (the folders of the conditions list)</option><option value="one">One bill</option></select></div>
    <div class="fg w2"><label>Description from</label><select id="wgDesc"><option value="lib">The rate library's item description (the condition's name when it has no code)</option><option value="name">The condition's name</option></select></div>
    <div class="fg w2"><label class="pk"><input type="checkbox" id="wgAsm" checked> Assembly lines as rows of their own (tiles from the floor area, skirting from the perimeter…)</label></div>
    ${has ? '<div class="fg w2"><label>This workbook</label><select id="wgMode"><option value="merge">Update — keep every row and edit; add what was measured since; links of deleted conditions shown dead</option><option value="new">Start again — replace the whole workbook (Undo brings it back)</option></select></div>' : ""}</div>`;
  const v = await A.ask(first ? "Workbook — build it from the takeoff" : "Generate from takeoff", body, first ? "Build workbook" : "Generate", () => ({how: document.getElementById("wgHow").value, desc: document.getElementById("wgDesc").value === "lib", asm: document.getElementById("wgAsm").checked, mode: has ? document.getElementById("wgMode").value : "new"}));
  if (!v) { if (first && !WB().secs.length) { edit(() => { WB().secs.push({id: nid("S"), name: "Bill No. 1", rows: [newRow()]}); }); UI.sec = WB().secs[0].id; render(); } return; }
  const G = genRows(v.how, v.desc, v.asm);
  edit(() => {
    const wb = WB();
    if (v.mode === "new") { wb.secs = []; if (!wb.marks.length) wb.marks = MARK_PRE.slice(0, 2).map(([n, p]) => ({id: nid("M"), name: n, kind: "pct", e: String(p), base: "run"})); }
    const have = new Set(); wb.secs.forEach(s => s.rows.forEach(r => { if (r.src) have.add(r.src.cond + "|" + (r.src.asm || "")); }));
    let added = 0;
    G.forEach((rows, g) => { let s = wb.secs.find(x => x.name === g); if (!s) { s = {id: nid("S"), name: g, rows: []}; wb.secs.push(s); }
      rows.forEach(r => { const k = r.src.cond + "|" + (r.src.asm || ""); if (have.has(k)) return; s.rows.push(r); added++; }); });
    wb.gen = {at: new Date().toISOString(), how: v.how};
    UI.added = added;
  });
  UI.sec = WB().secs[0] ? WB().secs[0].id : ""; render();
  A.toast(UI.added ? UI.added + " row" + (UI.added > 1 ? "s" : "") + " from the takeoff — quantities live-linked" : "Nothing new in the takeoff — every condition already has its row", 3200);
}

/* ------------------------------------------------------------------ the page */
function build(){
  const old = document.getElementById("wbRoot"); if (old) old.remove();
  const root = document.createElement("div"); root.id = "wbRoot"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Workbook");
  root.innerHTML = `<div class="wbHead"><b class="wbT">Workbook</b><span class="wbP"></span><span style="flex:1"></span><span class="wbTot"></span><button class="btn sm" data-w="close" title="Back to the drawing (the workbook is kept with the project)">&times; Close</button></div>
    <div class="wbBar">
      <span class="grpb"><button class="btn sm" data-w="gen" title="Build the workbook from the takeoff, or add what was measured since">&#8635; Generate / update</button><button class="btn sm" data-w="lib" title="Find a rate library item and add it (code, description, unit, rate)">&#128214; Library</button></span>
      <span class="grpb"><button class="btn sm" data-w="row" title="Insert an item below (Ctrl+Enter)">+ Row</button><button class="btn sm" data-w="head" title="Insert a heading below (Ctrl+Shift+Enter)">+ Heading</button><button class="btn sm" data-w="note" title="Insert a note line">+ Note</button><button class="btn sm" data-w="del" title="Delete the selected rows (Ctrl+Delete)">Delete</button><button class="btn sm" data-w="up" title="Move up (Alt+↑)">&#8593;</button><button class="btn sm" data-w="down" title="Move down (Alt+↓)">&#8595;</button><button class="btn sm" data-w="out" title="Heading one level up (Alt+←)">&#8676;</button><button class="btn sm" data-w="in" title="Heading one level down (Alt+→)">&#8677;</button><button class="btn sm" data-w="dup" title="Duplicate (Ctrl+D)">Duplicate</button></span>
      <span class="grpb"><button class="btn sm" data-w="link" title="Link the quantity to the takeoff (a condition's length, wall area, volume, area, perimeter or count)">&#9939; Link qty</button><button class="btn sm" data-w="vars" title="Workbook variables used in formulas (WASTE = 1.05)">Variables</button><button class="btn sm" data-w="cols" title="User columns and the material / labour / plant split">Columns</button></span>
      <span class="grpb"><button class="btn sm" data-w="rev" title="Keep the workbook's figures as a revision; compare with one">Revisions</button><select class="wbCmp" title="Compare with a revision"></select><button class="btn sm" data-w="check" title="Dead links, unpriced or unmeasured items, formula errors">Check</button><button class="btn sm pri" data-w="xls" title="The workbook in Excel — Summary and a sheet per section, live formulas">Export Excel</button></span>
      <span style="flex:1"></span><input type="search" class="wbQ" placeholder="Find code or description" aria-label="Find in the workbook"><select class="wbF" aria-label="Show"><option value="all">All rows</option><option value="unpriced">Unpriced</option><option value="unmeasured">No quantity</option><option value="linked">Linked to takeoff</option><option value="typed">Typed quantity</option><option value="issue">With a problem</option><option value="changed">Changed since revision</option></select>
      <button class="btn sm" data-w="pane" title="Show / hide the row's details">Details</button></div>
    <div class="wbMain"><nav class="wbTree" aria-label="Sections"></nav><div class="wbGridW" tabindex="0"><div class="wbGrid"></div></div><aside class="wbPane"></aside></div>
    <div class="wbFoot"></div>`;
  document.body.appendChild(root);
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", e => { const td = e.target.closest("td[data-ck]"); if (td && !UI.edit) { pick(td); startEdit(); } const ts = e.target.closest("[data-sec]"); if (ts && ts.dataset.sec && e.target.closest(".wbTree")) renameSec(ts.dataset.sec); });
  root.querySelector(".wbQ").addEventListener("input", e => { UI.q = e.target.value; UI.ri = 0; render(true); });
  root.querySelector(".wbF").addEventListener("change", e => { UI.flt = e.target.value; UI.ri = 0; render(true); });
  root.querySelector(".wbCmp").addEventListener("change", e => { UI.cmp = e.target.value; render(true); });
  window.addEventListener("keydown", onKey, true); document.addEventListener("copy", onCopy, true); document.addEventListener("paste", onPaste, true);
}
const $w = s => document.querySelector("#wbRoot " + s);
const money = v => A.f2(v);
const qShow = (v, u) => v == null ? "" : A.fq(v, u);
const rShow = (v, u) => v == null ? "" : A.f2(A.uR(v, u));
function cols(){   // the section sheet's columns
  const C = [{k: "ref", t: "Ref", ro: true}, {k: "code", t: "Code"}, {k: "desc", t: "Description"}, {k: "qty", t: "Quantity", n: true}, {k: "unit", t: "Unit"}, {k: "rate", t: "Rate", n: true}, {k: "tot", t: "Total PKR", n: true, ro: true}];
  if (UI.split) [["sM", "Material"], ["sL", "Labour"], ["sP", "Plant"], ["sO", "OH, profit, other"]].forEach(([k, t]) => C.push({k, t, n: true, ro: true}));
  WB().cols.forEach(c => C.push({k: "u:" + c.id, t: c.name || "Column", n: c.kind === "num"}));
  if (UI.cmp && revOf(UI.cmp)) [["pq", "Prev qty"], ["pr", "Prev rate"], ["pt", "Prev total"], ["dv", "Variance"]].forEach(([k, t]) => C.push({k, t, n: true, ro: true}));
  return C;
}
const revOf = id => WB().revs.find(r => r.id === id) || null;
function visRows(s, X){   // the rows shown: the find text and the filter
  const q = UI.q.trim().toLowerCase(), rv = UI.cmp ? revOf(UI.cmp) : null;
  return s.rows.filter(r => {
    if (q && !(String(r.code || "") + " " + String(r.desc || "")).toLowerCase().includes(q)) return false;
    if (UI.flt === "all") return true; if (r.t !== "item") return false;
    const x = X.R.get(r.id); if (!x) return false;
    if (UI.flt === "unpriced") return !(x.r.v > 0);
    if (UI.flt === "unmeasured") return !(x.q.v > 0);
    if (UI.flt === "linked") return !!x.q.links;
    if (UI.flt === "typed") return !x.q.links;
    if (UI.flt === "issue") return !!(x.q.err || x.q.dead || x.r.err || x.q.mis || !(x.q.v > 0) || !(x.r.v > 0));
    if (UI.flt === "changed") { const p = rv && rv.rows[r.id]; return !p || Math.abs(p[2] - x.t) > 0.005 || Math.abs(p[0] - (x.q.v || 0)) > 1e-6; }
    return true; });
}
function render(keepPane){
  if (!UI) return; const wb = WB(), X = calc(); UI.X = X;
  $w(".wbP").textContent = "— " + (A.P.proj.name || "project") + (wb.gen ? " · generated " + A.dmy(wb.gen.at) : "");
  $w(".wbTot").innerHTML = `Net <b>${money(X.net)}</b> · Grand total <b>PKR ${money(X.grand)}</b>`;
  const cmp = $w(".wbCmp"); cmp.innerHTML = `<option value="">Compare with…</option>` + wb.revs.map(r => `<option value="${A.esc(r.id)}"${r.id === UI.cmp ? " selected" : ""}>${A.esc(r.name)} — ${A.dmy(r.at)}</option>`).join("");
  // the tree: Summary, then the sections with their totals
  $w(".wbTree").innerHTML = `<button class="wbS${UI.sec === "" ? " on" : ""}" data-sec=""><span>Summary</span><b>${money(X.grand)}</b></button>` +
    wb.secs.map((s, i) => `<button class="wbS${UI.sec === s.id ? " on" : ""}" data-sec="${A.esc(s.id)}" title="Double-click to rename"><span>${i + 1}. ${A.esc(s.name)}</span><b>${money(X.S.get(s.id).t)}</b></button>`).join("") +
    `<div class="wbTA"><button class="btn sm" data-w="addsec">+ Section</button><button class="btn sm" data-w="secup" title="Move the section up">&#8593;</button><button class="btn sm" data-w="secdn" title="Move the section down">&#8595;</button><button class="btn sm dng" data-w="secdel" title="Delete the section">&times;</button></div>`;
  const s = secOf(UI.sec);
  if (!s) { UI.sec = ""; renderSummary(X); } else renderSheet(s, X);
  if (!keepPane || !UI.paneOpen) renderPane();
  $w(".wbPane").hidden = !UI.pane; $w(".wbMain").classList.toggle("np", !UI.pane);
  const issues = checkList(X).length;
  $w(".wbFoot").innerHTML = (s ? `${s.rows.filter(r => r.t === "item").length} items in ${A.esc(s.name)} · ` : "") + `${wb.secs.length} sections · ${issues ? `<a href="#" data-w="check" style="color:var(--red)">${issues} to check</a>` : "nothing to check"} · <span class="small">Arrows · Enter / F2 edit · Tab · Ctrl+C / Ctrl+V with Excel · Ctrl+Z · Ctrl+Enter row · Alt+↑↓ move</span>`;
}
function renderSheet(s, X){
  const C = cols(), V = visRows(s, X), si = WB().secs.indexOf(s) + 1, rv = UI.cmp ? revOf(UI.cmp) : null; UI.V = V; UI.C = C;
  if (UI.ri >= V.length) UI.ri = Math.max(0, V.length - 1); if (!C.some(c => c.k === UI.ck)) UI.ck = "desc";
  let n = 0; const ref = new Map(); s.rows.forEach(r => { if (r.t === "item") ref.set(r.id, si + "." + (++n)); });
  const lo = UI.anchor == null ? UI.ri : Math.min(UI.anchor, UI.ri), hi = UI.anchor == null ? UI.ri : Math.max(UI.anchor, UI.ri);
  const cell = (r, c, i) => {
    const x = X.R.get(r.id) || {}, on = i === UI.ri && c.k === UI.ck, cls = [c.n ? "n" : "", on ? "act" : "", c.ro ? "ro" : ""];
    let h = "", tip = "";
    if (r.t === "head") { if (c.k === "desc") h = `<b>${A.esc(r.desc || "")}</b>`; else if (c.k === "code") h = A.esc(r.code || ""); else if (c.k === "tot") h = `<b>${money(x.t || 0)}</b>`; }
    else if (r.t === "note") { if (c.k === "desc") h = `<i>${A.esc(r.desc || "")}</i>`; }
    else if (c.k === "ref") h = ref.get(r.id) || "";
    else if (c.k === "code") h = A.esc(r.code || "");
    else if (c.k === "desc") { h = A.esc(r.desc || ""); if (r.note) { h += ` <span class="wbNt" title="${A.esc(r.note)}">&#9998;</span>`; } }
    else if (c.k === "qty") { const q = x.q; h = qShow(q.v, r.unit);
      if (q.links) { cls.push(q.dead ? "dead" : "lnk"); tip = q.dead ? "A link is dead — open Details" : "Live from the takeoff (" + q.links + " link" + (q.links > 1 ? "s" : "") + ")"; h = `<span class="wbI">${q.dead ? "&#9888;" : "&#9939;"}</span>` + h; }
      else if (q.f) { cls.push("fx"); tip = r.qe; }
      if (q.err) { cls.push("err"); tip = q.err; } if (q.mis) { cls.push("err"); tip = "The linked quantity is in " + q.mis + ", the row in " + r.unit; } }
    else if (c.k === "unit") h = A.esc(A.uL(r.unit || ""));
    else if (c.k === "rate") { const t = x.r; h = rShow(t.v, r.unit);
      if (t.ra) { cls.push(t.err ? "err" : "lnk"); tip = t.err || t.src; h = `<span class="wbI">RA</span>` + (t.err ? "—" : h); }
      else if (t.src === "build-up") { cls.push("bu"); tip = "Rate build-up"; h = `<span class="wbI">&#931;</span>` + h; }
      else if (t.f) { cls.push("fx"); tip = r.re; } if (t.err && !t.ra) { cls.push("err"); tip = t.err; } }
    else if (c.k === "tot") h = money(x.t || 0);
    else if (c.k[0] === "s" && c.k.length === 2) { const j = "MLPO".indexOf(c.k[1]); h = x.sp ? money(x.sp[j]) : ""; }
    else if (c.k.startsWith("u:")) h = A.esc((r.u || {})[c.k.slice(2)] || "");
    else if (rv && r.t === "item") { const p = rv.rows[r.id];
      if (c.k === "pq") h = p ? qShow(p[0], r.unit) : "new"; else if (c.k === "pr") h = p ? rShow(p[1], r.unit) : ""; else if (c.k === "pt") h = p ? money(p[2]) : "";
      else if (c.k === "dv") { const d = (x.t || 0) - (p ? p[2] : 0); h = Math.abs(d) < 0.005 ? "" : (d > 0 ? "+" : "") + money(d); if (d > 0.005) cls.push("up"); else if (d < -0.005) cls.push("dn"); } }
    return `<td class="${cls.join(" ")}" data-ck="${c.k}" data-ri="${i}"${tip ? ` title="${A.esc(tip)}"` : ""}>${h}</td>`;
  };
  const rowsH = V.map((r, i) => `<tr class="${r.t}${i >= lo && i <= hi && (UI.anchor != null) ? " sel" : ""}${i === UI.ri ? " cur" : ""}${r.col ? " c-" + r.col : ""}" style="--lv:${r.lvl || 0}">${C.map(c => cell(r, c, i)).join("")}</tr>`).join("");
  const st = X.S.get(s.id);
  const foot = `<tr class="tot"><td></td><td></td><td><b>Total ${A.esc(s.name)}</b></td><td></td><td></td><td></td><td class="n"><b>${money(st.t)}</b></td>${UI.split ? st.split.map(v => `<td class="n">${money(v)}</td>`).join("") : ""}${WB().cols.map(c => `<td class="n">${c.kind === "num" && st.user[c.id] != null ? A.f2(st.user[c.id]) : ""}</td>`).join("")}${UI.cmp && revOf(UI.cmp) ? (() => { const p = revOf(UI.cmp).secs[s.id], d = st.t - (p || 0); return `<td></td><td></td><td class="n">${p != null ? money(p) : ""}</td><td class="n ${d > 0.005 ? "up" : d < -0.005 ? "dn" : ""}">${Math.abs(d) < 0.005 ? "" : (d > 0 ? "+" : "") + money(d)}</td>`; })() : ""}</tr>`;
  $w(".wbGrid").innerHTML = `<table class="wbT2"><colgroup>${C.map(c => `<col class="k-${c.k.replace(":", "_")}">`).join("")}</colgroup><thead><tr>${C.map(c => `<th class="${c.n ? "n" : ""}">${A.esc(c.t)}</th>`).join("")}</tr></thead><tbody>${rowsH || `<tr><td colspan="${C.length}" class="wbE">${UI.q || UI.flt !== "all" ? "No row matches." : "This section is empty — + Row, or Library to add an item."}</td></tr>`}</tbody><tfoot>${foot}</tfoot></table>`;
  const act = $w("td.act"); if (act && !UI.edit) act.scrollIntoView({block: "nearest", inline: "nearest"});
}
function renderSummary(X){
  const wb = WB(), C = [{k: "ref"}, {k: "code"}, {k: "desc"}, {k: "tot"}, {k: "pct"}]; UI.V = []; UI.C = C;
  const rv = UI.cmp ? revOf(UI.cmp) : null;
  const sec = wb.secs.map((s, i) => { const t = X.S.get(s.id).t, p = rv ? rv.secs[s.id] : null, d = rv ? t - (p || 0) : 0;
    return `<tr class="sumr" data-open="${A.esc(s.id)}"><td>${i + 1}</td><td>${A.esc(s.code || "")}</td><td><a href="#" data-open="${A.esc(s.id)}">${A.esc(s.name)}</a></td><td class="n">${money(t)}</td><td class="n">${X.net ? (t / X.net * 100).toFixed(1) + " %" : ""}</td>${rv ? `<td class="n">${p != null ? money(p) : "new"}</td><td class="n ${d > 0.005 ? "up" : d < -0.005 ? "dn" : ""}">${Math.abs(d) < 0.005 ? "" : (d > 0 ? "+" : "") + money(d)}</td>` : ""}</tr>`; }).join("");
  const mk = X.M.map(({m, v, err}, i) => `<tr class="mk"><td></td><td><select data-mk="${i}" data-mf="kind"><option value="pct"${m.kind !== "sum" ? " selected" : ""}>%</option><option value="sum"${m.kind === "sum" ? " selected" : ""}>Lump sum</option></select></td>
    <td><input type="text" data-mk="${i}" data-mf="name" value="${A.esc(m.name)}" aria-label="Markup name"> ${m.kind !== "sum" ? `<input type="text" data-mk="${i}" data-mf="e" value="${A.esc(m.e)}" style="width:70px" aria-label="Percent"> % of <select data-mk="${i}" data-mf="base"><option value="run"${m.base !== "net" ? " selected" : ""}>the running total</option><option value="net"${m.base === "net" ? " selected" : ""}>the net</option></select>` : `<input type="text" data-mk="${i}" data-mf="e" value="${A.esc(m.e)}" style="width:110px" aria-label="Amount"> PKR`}${err ? ` <span style="color:var(--red)">${A.esc(err)}</span>` : ""}</td>
    <td class="n">${money(v)}</td><td><button class="rn" data-mkdel="${i}" title="Remove">&times;</button></td></tr>`).join("");
  $w(".wbGrid").innerHTML = `<table class="wbT2 sum"><colgroup><col style="width:44px"><col style="width:110px"><col><col style="width:150px"><col style="width:${rv ? 150 : 90}px">${rv ? '<col style="width:150px"><col style="width:130px">' : ""}</colgroup><thead><tr><th>#</th><th>Code</th><th>Section</th><th class="n">Total PKR</th><th class="n">% of net</th>${rv ? '<th class="n">Prev total</th><th class="n">Variance</th>' : ""}</tr></thead><tbody>${sec || `<tr><td colspan="5" class="wbE">No sections yet — Generate / update builds them from the takeoff.</td></tr>`}
    <tr class="tot"><td></td><td></td><td><b>Net total</b></td><td class="n"><b>${money(X.net)}</b></td><td class="n">100 %</td>${rv ? `<td class="n">${money(rv.net)}</td><td></td>` : ""}</tr>${mk}
    <tr class="mk"><td></td><td colspan="4"><button class="btn sm" data-w="addmk">+ Markup</button> ${MARK_PRE.map(([n, p]) => `<button class="btn sm" data-mkpre="${A.esc(n)}|${p}">${A.esc(n)} ${p} %</button>`).join(" ")}</td></tr>
    <tr class="tot grand"><td></td><td></td><td><b>Grand total</b></td><td class="n"><b>PKR ${money(X.grand)}</b></td><td></td>${rv ? `<td class="n">${money(rv.grand)}</td><td class="n">${(X.grand - rv.grand > 0 ? "+" : "") + money(X.grand - rv.grand)}</td>` : ""}</tr></tbody></table>
    <p class="small" style="margin:10px 4px">Click a section to open it. Markups are applied in order: a % of the running total (or of the net), or a lump sum.</p>`;
  $w(".wbGrid").querySelectorAll("[data-mk]").forEach(el => el.addEventListener("change", () => { const i = +el.dataset.mk, f = el.dataset.mf; edit(() => { WB().marks[i][f] = el.value; }); }));
}

/* ------------------------------------------------------------------ the details pane: the active row's quantity, rate, note */
function curRow(){ return UI.V && UI.V[UI.ri] ? UI.V[UI.ri] : null; }
function renderPane(){
  const P = $w(".wbPane"); UI.paneOpen = false; if (!P) return;
  const r = curRow(), s = secOf(UI.sec);
  if (!s) { P.innerHTML = `<h4>Summary</h4><p class="small">The sections' totals, then the markups down to the grand total. Workbook variables: ${WB().vars.length ? WB().vars.map(v => A.esc(v.name)).join(", ") : "none"} <button class="rn" data-w="vars">&#9998;</button></p>`; return; }
  if (!r) { P.innerHTML = '<p class="small">Pick a row.</p>'; return; }
  if (r.t !== "item") { P.innerHTML = `<h4>${r.t === "head" ? "Heading" : "Note"}</h4><p class="small">${r.t === "head" ? "Its total is the items under it, down to the next heading of its level. Alt+← / Alt+→ changes its level." : "A line of text in the bill."}</p>`; return; }
  const X = UI.X, x = X.R.get(r.id), u = r.unit || "", lines = Array.isArray(r.qb) ? r.qb : [];
  const qLine = (l, i) => `<tr><td><input type="text" data-ql="${i}" data-qf="desc" value="${A.esc(l.desc || "")}" placeholder="where / what"></td>
    <td>${l.link ? (() => { const k = linkOf(l.link, {v: new Map()}); return `<span class="${k.dead ? "dead" : "lnk"}" title="${A.esc(k.why || "")}">&#9939; ${A.esc(k.dead ? "dead link — " + k.why : k.name)}</span>`; })() : `<input type="text" data-ql="${i}" data-qf="e" value="${A.esc(l.e || "")}" placeholder="12.5 or =L*H" style="width:90px">`}</td>
    <td>× <input type="text" data-ql="${i}" data-qf="x" value="${A.esc(l.x == null ? "1" : l.x)}" style="width:52px"></td><td class="n">${qShow(l._v, u)}</td><td><button class="rn" data-qdel="${i}" title="Remove">&times;</button></td></tr>`;
  const rb = r.rb && Array.isArray(r.rb.lines) ? r.rb : null, rt = x.r;
  const src = rb ? "bu" : String(r.ra || "").trim() ? "ra" : "typed";
  const buLine = (l, i) => `<tr><td><select data-bl="${i}" data-bf="k">${KINDS.map(([k, n]) => `<option value="${k}"${(l.k || "M") === k ? " selected" : ""}>${n}</option>`).join("")}</select></td><td><input type="text" data-bl="${i}" data-bf="desc" value="${A.esc(l.desc || "")}" placeholder="cement, mason…"></td>
    <td><input type="text" data-bl="${i}" data-bf="q" value="${A.esc(l.q == null ? "" : l.q)}" style="width:56px" placeholder="1"></td><td><input type="text" data-bl="${i}" data-bf="unit" value="${A.esc(l.unit || "")}" style="width:44px"></td><td><input type="text" data-bl="${i}" data-bf="r" value="${A.esc(l.r == null ? "" : l.r)}" style="width:70px"></td><td class="n">${money(l._v || 0)}</td><td><button class="rn" data-bdel="${i}">&times;</button></td></tr>`;
  P.innerHTML = `<h4>${A.esc(r.code ? r.code + " — " : "")}${A.esc(r.desc || "Item")}</h4>
    <div class="wbBox"><div class="wbBH"><b>Quantity</b> <span class="n">${qShow(x.q.v, u)} ${A.esc(A.uL(u))}</span></div>
      ${lines.length ? `<table class="wbQt"><tbody>${lines.map(qLine).join("")}</tbody></table>` : `<p class="small">${r.qe ? "Typed: " + A.esc(r.qe) : "Not measured."} Link it to the takeoff, or break it down into lines.</p>`}
      ${x.q.err ? `<p class="err">${A.esc(x.q.err)}</p>` : ""}${x.q.mis ? `<p class="err">The link gives ${A.esc(x.q.mis)}, this row is in ${A.esc(u)} — change the unit or the link.</p>` : ""}
      <div class="wbBA"><button class="btn sm" data-w="link">&#9939; Link to takeoff</button><button class="btn sm" data-qadd="1">+ Line</button>${lines.length ? '<button class="btn sm" data-qflat="1" title="Keep the figure as a typed quantity (no links)">Unlink</button>' : ""}</div></div>
    <div class="wbBox"><div class="wbBH"><b>Rate</b> <span class="n">${rt.v ? rShow(rt.v, u) + " / " + A.esc(A.uL(u)) : "—"}</span></div>
      <div class="wbSeg"><label><input type="radio" name="wbRs" value="typed"${src === "typed" ? " checked" : ""}> Typed / formula</label><label><input type="radio" name="wbRs" value="ra"${src === "ra" ? " checked" : ""}> Rate Analysis</label><label><input type="radio" name="wbRs" value="bu"${src === "bu" ? " checked" : ""}> Build-up</label></div>
      ${src === "typed" ? `<p class="small">Type it in the Rate cell (a number, or =formula with variables).${r.re ? " Now: " + A.esc(r.re) : ""}</p>` : ""}
      ${src === "ra" ? `<div class="fg"><label>Rate Analysis code</label><input type="text" id="wbRa" value="${A.esc(r.ra || "")}" placeholder="e.g. CIV-MAS-001" list="wbRaL"></div><p class="small">${rt.err ? `<span style="color:var(--red)">${A.esc(rt.err)}</span>` : A.esc(rt.src || "")}</p>${rt.comp ? `<p class="small">Per ${A.esc(A.uL(u))}: material ${money(A.uR(rt.comp[0], u))} · labour ${money(A.uR(rt.comp[1], u))} · plant ${money(A.uR(rt.comp[2], u))} · OH, profit, other ${money(A.uR(rt.comp[3], u))}</p>` : ""}` : ""}
      ${src === "bu" ? `<table class="wbQt bu"><thead><tr><th>Type</th><th>Resource</th><th>Qty</th><th>Unit</th><th>Rate</th><th class="n">Amount</th><th></th></tr></thead><tbody>${rb.lines.map(buLine).join("")}</tbody></table>
        <div class="wbBA"><button class="btn sm" data-badd="1">+ Resource</button><label class="small">Waste on material % <input type="text" data-bp="w" value="${A.esc(rb.w || "")}" style="width:44px"></label><label class="small">OH % <input type="text" data-bp="oh" value="${A.esc(rb.oh || "")}" style="width:44px"></label><label class="small">Profit % <input type="text" data-bp="pf" value="${A.esc(rb.pf || "")}" style="width:44px"></label></div>
        ${rt.bu ? `<p class="small">Material ${money(rt.bu.by.M)} (+ waste) · labour ${money(rt.bu.by.L)} · plant ${money(rt.bu.by.P)} · subcontract ${money(rt.bu.by.S)} · other ${money(rt.bu.by.O)} → ${money(rt.bu.sub)} + OH ${money(rt.bu.oh)} + profit ${money(rt.bu.pf)}</p>` : ""}${rt.err ? `<p class="err">${A.esc(rt.err)}</p>` : ""}` : ""}</div>
    <div class="wbBox"><div class="wbBH"><b>Total</b> <span class="n">PKR ${money(x.t)}</span></div>${x.sp ? `<p class="small">Material ${money(x.sp[0])} · labour ${money(x.sp[1])} · plant ${money(x.sp[2])} · OH, profit, other ${money(x.sp[3])}</p>` : ""}</div>
    <div class="wbBox"><b>Note</b><textarea id="wbNote" rows="3" placeholder="assumptions, source, query…">${A.esc(r.note || "")}</textarea>
      <div class="wbBA"><label class="small">Colour <select id="wbCol"><option value="">none</option>${["yellow", "green", "red", "blue"].map(k => `<option${r.col === k ? " selected" : ""}>${k}</option>`).join("")}</select></label></div></div>`;
  const L = A.raLib();
  if (src === "ra" && L.o && !document.getElementById("wbRaL")) { const dl = document.createElement("datalist"); dl.id = "wbRaL"; dl.innerHTML = [...L.items.values()].slice(0, 3000).map(it => `<option value="${A.esc(it.code || it.id)}">${A.esc(String(it.desc || "").slice(0, 90))} (${A.esc(it.unit || "")})</option>`).join(""); P.appendChild(dl); }
  wirePane(r);
}
function wirePane(r){
  const P = $w(".wbPane"), on = (sel, ev, fn) => P.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
  P.addEventListener("focusin", () => { UI.paneOpen = true; }); P.addEventListener("focusout", () => { UI.paneOpen = false; });
  on("[data-ql]", "change", el => edit(() => { const l = r.qb[+el.dataset.ql], f = el.dataset.qf; l[f] = el.value.trim(); if (f === "e") l.m = A.isM(); }));
  on("[data-qdel]", "click", el => edit(() => { r.qb.splice(+el.dataset.qdel, 1); if (!r.qb.length) delete r.qb; }));
  on("[data-qadd]", "click", () => edit(() => { r.qb = r.qb || []; if (!r.qb.length && r.qe) r.qb.push({id: nid("Q"), desc: "", e: r.qe, m: r.qm, x: "1"}); r.qb.push({id: nid("Q"), desc: "", e: "", x: "1"}); r.qe = ""; }));
  on("[data-qflat]", "click", () => edit(() => { const v = UI.X.R.get(r.id).q.v; r.qe = v == null ? "" : String(+v.toFixed(6)); r.qm = false; delete r.qb; }));
  on("input[name=wbRs]", "change", el => edit(() => { if (el.value === "typed") { delete r.rb; delete r.ra; } else if (el.value === "ra") { delete r.rb; r.ra = r.ra || r.code || ""; } else { const x = UI.X.R.get(r.id).r; delete r.ra; r.rb = r.rb || {lines: x.v ? [{k: "O", desc: "rate as it was", q: "1", unit: r.unit, r: String(+(+x.v).toFixed(4))}] : [{k: "M", desc: "", q: "1", unit: "", r: ""}], w: "", oh: "", pf: ""}; r.rbm = false; } }));
  on("#wbRa", "change", el => edit(() => { r.ra = el.value.trim().toUpperCase(); fillFromLib(r, r.ra, false); }));
  on("[data-bl]", "change", el => edit(() => { r.rb.lines[+el.dataset.bl][el.dataset.bf] = el.value.trim(); }));
  on("[data-bdel]", "click", el => edit(() => { r.rb.lines.splice(+el.dataset.bdel, 1); }));
  on("[data-badd]", "click", () => edit(() => { r.rb.lines.push({k: "M", desc: "", q: "1", unit: "", r: ""}); }));
  on("[data-bp]", "change", el => edit(() => { r.rb[el.dataset.bp] = el.value.trim(); }));
  on("#wbNote", "change", el => edit(() => { r.note = el.value.trim(); if (!r.note) delete r.note; }));
  on("#wbCol", "change", el => edit(() => { r.col = el.value; if (!r.col) delete r.col; }));
}
function fillFromLib(r, code, force){   // a code of the rate library: its description and unit (empty ones, or all when asked), its rate linked
  const L = A.raLib(); if (!L.o) return false; const it = L.items.get(String(code || "").trim().toUpperCase()); if (!it) return false;
  if (force || !r.desc) r.desc = String(it.desc || ""); if (force || !r.unit) r.unit = libUnit(it.unit);
  if (!r.qb && !r.re && !r.rb) r.ra = it.code || it.id; else if (!r.rb && !String(r.re || "").trim()) r.ra = it.code || it.id;
  return true;
}
const libUnit = u => { const n = A.normU(u); return n === "ft" ? "ft" : n === "sft" ? "Sft" : n === "cft" ? "cft" : n === "nos" ? "Nos" : String(u || ""); };

/* ------------------------------------------------------------------ the grid: picking, editing, keys */
function pick(td){ UI.ri = +td.dataset.ri; UI.ck = td.dataset.ck; }
function onClick(e){
  const b = e.target.closest("[data-w]"); if (b) { e.preventDefault(); return cmd(b.dataset.w); }
  const sb = e.target.closest(".wbTree [data-sec]"); if (sb) { UI.sec = sb.dataset.sec; UI.ri = 0; UI.anchor = null; return render(); }
  const op = e.target.closest("[data-open]"); if (op && !e.target.closest("input,select")) { e.preventDefault(); UI.sec = op.dataset.open; UI.ri = 0; return render(); }
  const mp = e.target.closest("[data-mkpre]"); if (mp) { const [n, p] = mp.dataset.mkpre.split("|"); return edit(() => { WB().marks.push({id: nid("M"), name: n, kind: "pct", e: p, base: "run"}); }); }
  const md = e.target.closest("[data-mkdel]"); if (md) return edit(() => { WB().marks.splice(+md.dataset.mkdel, 1); });
  const td = e.target.closest(".wbGrid td[data-ck]"); if (td && !UI.edit) { const i = +td.dataset.ri; if (e.shiftKey) { if (UI.anchor == null) UI.anchor = UI.ri; } else UI.anchor = null; pick(td); UI.ri = i; render(); $w(".wbGridW").focus(); }
}
const editable = ck => ["code", "desc", "qty", "unit", "rate"].includes(ck) || ck.startsWith("u:");
function rawOf(r, ck){
  if (ck === "qty") { if (Array.isArray(r.qb) && r.qb.length) return ""; const s = String(r.qe || ""); return r.qm || !A.isM() || s[0] === "=" || !s ? s : String(+(+s * fac(r.unit)).toFixed(6)); }
  if (ck === "rate") { const s = String(r.re || ""); return r.rm || !A.isM() || s[0] === "=" || !s ? s : String(+(+s / fac(r.unit)).toFixed(6)); }
  if (ck.startsWith("u:")) return String((r.u || {})[ck.slice(2)] || "");
  return String(r[ck] || "");
}
function setCell(r, ck, v){   // a cell typed: the quantity / rate as an entry (typing over a link or a build-up replaces it), a code fills from the library
  v = String(v == null ? "" : v).replace(/\r?\n/g, " ").trim();
  if (ck === "qty") { if (r.t !== "item") return; delete r.qb; r.qe = v; r.qm = A.isM() && !!v; }
  else if (ck === "rate") { if (r.t !== "item") return; delete r.rb; delete r.ra; r.re = v; r.rm = A.isM() && !!v; }
  else if (ck === "code") { r.code = v; if (r.t === "item" && v) fillFromLib(r, v, false); }
  else if (ck === "unit") r.unit = libUnit(v) || v;
  else if (ck.startsWith("u:")) { r.u = r.u || {}; r.u[ck.slice(2)] = v; }
  else r[ck] = v;
}
function startEdit(ch){
  const r = curRow(); if (!r || !editable(UI.ck)) return;
  if ((UI.ck === "qty" || UI.ck === "rate" || UI.ck === "unit") && r.t !== "item") return;
  const td = $w(`td.act`); if (!td) return;
  const linked = UI.ck === "qty" && Array.isArray(r.qb) && r.qb.length, ra = UI.ck === "rate" && (r.ra || r.rb);
  if ((linked || ra) && ch == null) { UI.pane = true; render(); const f = $w(".wbPane input, .wbPane select"); if (f) f.focus(); return A.toast(linked ? "A linked / broken-down quantity — edit its lines here, or type a figure over it to replace it" : "Its rate comes from " + (r.ra ? "Rate Analysis " + r.ra : "its build-up") + " — change it here, or type a rate over it", 3200); }
  const inp = document.createElement("input"); inp.type = "text"; inp.className = "wbEd"; inp.value = ch != null ? ch : rawOf(r, UI.ck);
  td.innerHTML = ""; td.appendChild(inp); inp.focus(); if (ch == null) inp.select(); UI.edit = {inp, rid: r.id, ck: UI.ck};
  if (UI.ck === "code") { const L = A.raLib(); if (L.o) { inp.setAttribute("list", "wbCodeL"); if (!document.getElementById("wbCodeL")) { const dl = document.createElement("datalist"); dl.id = "wbCodeL"; dl.innerHTML = [...L.items.values()].slice(0, 3000).map(it => `<option value="${A.esc(it.code || it.id)}">${A.esc(String(it.desc || "").slice(0, 90))} (${A.esc(it.unit || "")})</option>`).join(""); document.getElementById("wbRoot").appendChild(dl); } } }
  inp.addEventListener("blur", () => { if (UI && UI.edit && UI.edit.inp === inp) commit(); });
}
function commit(move){
  const ed = UI.edit; if (!ed) return; UI.edit = null;
  const x = rowOf(ed.rid); const v = ed.inp.value;
  if (x && v !== rawOf(x.r, ed.ck)) edit(() => setCell(x.r, ed.ck, v)); else render(true);
  if (move) moveSel(move[0], move[1]);
  $w(".wbGridW").focus();
}
function moveSel(dr, dc){
  const C = UI.C || [], V = UI.V || []; let ci = C.findIndex(c => c.k === UI.ck);
  UI.ri = Math.max(0, Math.min(V.length - 1, UI.ri + dr)); ci = Math.max(0, Math.min(C.length - 1, ci + dc)); UI.ck = C[ci] ? C[ci].k : "desc";
  render(true);
}
function onKey(e){
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return;   // a dialog over the workbook: its keys
  const inPane = e.target && e.target.closest && e.target.closest(".wbPane, .wbBar, .wbGrid .mk, .wbTree");
  if (UI.edit) { e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); return commit([1, 0]); } if (e.key === "Tab") { e.preventDefault(); return commit([0, e.shiftKey ? -1 : 1]); }
    if (e.key === "Escape") { e.preventDefault(); UI.edit = null; render(true); return $w(".wbGridW").focus(); } return; }
  if (inPane && e.target.matches("input,select,textarea")) { e.stopPropagation(); if (e.key === "Escape") e.target.blur(); return; }
  e.stopPropagation();   // the drawing's own shortcuts are not for the workbook
  const k = e.key, c = e.ctrlKey || e.metaKey;
  if (c && (k === "z" || k === "Z")) { e.preventDefault(); return undo(e.shiftKey); } if (c && (k === "y" || k === "Y")) { e.preventDefault(); return undo(true); }
  if (!secOf(UI.sec)) return;
  if (c && k === "Enter") { e.preventDefault(); return cmd(e.shiftKey ? "head" : "row"); }
  if (c && (k === "Delete" || k === "-")) { e.preventDefault(); return cmd("del"); }
  if (c && (k === "d" || k === "D")) { e.preventDefault(); return cmd("dup"); }
  if (e.altKey && k === "ArrowUp") { e.preventDefault(); return cmd("up"); } if (e.altKey && k === "ArrowDown") { e.preventDefault(); return cmd("down"); }
  if (e.altKey && k === "ArrowLeft") { e.preventDefault(); return cmd("out"); } if (e.altKey && k === "ArrowRight") { e.preventDefault(); return cmd("in"); }
  const sh = e.shiftKey && k.startsWith("Arrow") && (k === "ArrowUp" || k === "ArrowDown");
  if (sh) { if (UI.anchor == null) UI.anchor = UI.ri; } else if (k.startsWith("Arrow")) UI.anchor = null;
  if (k === "ArrowDown") { e.preventDefault(); return moveSel(1, 0); } if (k === "ArrowUp") { e.preventDefault(); return moveSel(-1, 0); }
  if (k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) { e.preventDefault(); return moveSel(0, 1); } if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) { e.preventDefault(); return moveSel(0, -1); }
  if (k === "Home") { e.preventDefault(); UI.ri = 0; return render(true); } if (k === "End") { e.preventDefault(); UI.ri = (UI.V || []).length - 1; return render(true); }
  if (k === "Enter" || k === "F2") { e.preventDefault(); return startEdit(); }
  if (k === "Delete" || k === "Backspace") { e.preventDefault(); const r = curRow(); if (r && editable(UI.ck) && rawOf(r, UI.ck) !== "") edit(() => setCell(r, UI.ck, "")); return; }
  if (k === "Escape") { UI.anchor = null; return render(true); }
  if (k.length === 1 && !c && !e.altKey) { e.preventDefault(); return startEdit(k); }
}
const selRows = () => { const V = UI.V || []; const lo = UI.anchor == null ? UI.ri : Math.min(UI.anchor, UI.ri), hi = UI.anchor == null ? UI.ri : Math.max(UI.anchor, UI.ri); return V.slice(lo, hi + 1); };
function onCopy(e){
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return; e.stopPropagation();   // (the drawing's own copy is not for the workbook)
  if (UI.edit || (e.target.closest && e.target.closest("input,textarea,select")) || !secOf(UI.sec)) return;
  const X = UI.X, rows = selRows(); if (!rows.length) return;
  const txt = rows.map(r => { const x = X.R.get(r.id) || {}; return [r.code || "", r.desc || "", r.t === "item" ? (x.q.v == null ? "" : +A.uV(x.q.v, r.unit).toFixed(6)) : "", r.unit ? A.uL(r.unit) : "", r.t === "item" ? (x.r.v ? +A.uR(x.r.v, r.unit).toFixed(4) : "") : "", r.t === "item" ? +(x.t || 0).toFixed(2) : ""].join("\t"); }).join("\r\n");
  e.clipboardData.setData("text/plain", txt); e.preventDefault(); A.toast(rows.length + " row" + (rows.length > 1 ? "s" : "") + " copied — paste them in Excel, or here", 1800);
}
function onPaste(e){   // cells from Excel (or here): from the active cell across and down, new rows as needed
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return; e.stopPropagation();   // (nothing is pasted onto the drawing meanwhile)
  if (UI.edit || (e.target.closest && e.target.closest("input,textarea,select")) || !secOf(UI.sec)) return;
  const t = e.clipboardData.getData("text/plain"); if (!t) return; e.preventDefault();
  const grid = t.replace(/\r/g, "").replace(/\n$/, "").split("\n").map(l => l.split("\t")), C = (UI.C || []).filter(c => editable(c.k) || c.k === "tot"), c0 = Math.max(0, C.findIndex(c => c.k === UI.ck)), s = secOf(UI.sec);
  edit(() => { const V = UI.V || []; let at = V[UI.ri] ? s.rows.indexOf(V[UI.ri]) : s.rows.length;
    grid.forEach((cells, i) => { let r = s.rows[at + i]; if (!r) { r = newRow(); s.rows.push(r); }
      cells.forEach((v, j) => { const col = C[c0 + j]; if (!col || col.k === "tot") return; setCell(r, col.k, v); }); }); });
  A.toast(grid.length + " row" + (grid.length > 1 ? "s" : "") + " pasted", 1600);
}

/* ------------------------------------------------------------------ commands */
async function cmd(w){
  const wb = WB(), s = secOf(UI.sec), V = UI.V || [], r = curRow();
  const at = () => r ? s.rows.indexOf(r) : s.rows.length - 1;
  switch (w) {
    case "close": return close();
    case "gen": return generateDialog(false);
    case "lib": return libDialog();
    case "pane": UI.pane = !UI.pane; return render();
    case "vars": return varsDialog();
    case "cols": return colsDialog();
    case "rev": return revDialog();
    case "check": return checkDialog();
    case "xls": return exportXls();
    case "addsec": { const v = await A.ask("New section", '<div class="fg"><label>Name</label><input type="text" id="wbSn" placeholder="e.g. Finishes"></div>', "Add", () => ({n: document.getElementById("wbSn").value.trim() || "Section"}), "wbSn"); if (!v) return; const n = v.n;   // (a dialog's text answer is its error: an object)
      const sec = {id: nid("S"), name: n, rows: [newRow()]}; edit(() => { wb.secs.push(sec); }); UI.sec = sec.id; UI.ri = 0; return render(); }
    case "secup": case "secdn": { const i = wb.secs.indexOf(s); if (!s) return; const j = i + (w === "secup" ? -1 : 1); if (j < 0 || j >= wb.secs.length) return; return edit(() => { wb.secs.splice(j, 0, wb.secs.splice(i, 1)[0]); }); }
    case "secdel": { if (!s) return A.toast("Open the section to delete", 1600); const ok = await A.ask("Delete section", `<p>Delete <b>${A.esc(s.name)}</b> and its ${s.rows.length} rows? (Ctrl+Z brings it back.)</p>`, "Delete"); if (!ok) return;
      edit(() => { wb.secs.splice(wb.secs.indexOf(s), 1); }); UI.sec = ""; return render(); }
    case "addmk": return edit(() => { wb.marks.push({id: nid("M"), name: "Markup", kind: "pct", e: "0", base: "run"}); });
  }
  if (!s) return A.toast("Open a section first", 1600);
  const sel = selRows(), idx = sel.map(x => s.rows.indexOf(x)).filter(i => i >= 0).sort((a, b) => a - b);
  switch (w) {
    case "row": case "head": case "note": { const nr = newRow(w === "row" ? {} : {t: w, lvl: w === "head" ? Math.max(0, r && r.t === "head" ? r.lvl : 0) : 0});
      edit(() => { s.rows.splice(at() + 1, 0, nr); }); UI.q = ""; UI.flt = "all"; $w(".wbQ").value = ""; $w(".wbF").value = "all"; render(); UI.ri = (UI.V || []).indexOf(nr); UI.ck = w === "row" ? "code" : "desc"; UI.anchor = null; render(); return startEdit(); }
    case "del": if (!idx.length) return; edit(() => { for (let i = idx.length - 1; i >= 0; i--) s.rows.splice(idx[i], 1); }); UI.anchor = null; return;
    case "dup": if (!idx.length) return; edit(() => { const cp = idx.map(i => Object.assign(JSON.parse(JSON.stringify(s.rows[i])), {id: nid("R")})); cp.forEach(x => { if (x.qb) x.qb.forEach(l => { l.id = nid("Q"); }); delete x.src; }); s.rows.splice(idx[idx.length - 1] + 1, 0, ...cp); }); return;
    case "up": case "down": { if (!idx.length) return; const d = w === "up" ? -1 : 1, lo = idx[0], hi = idx[idx.length - 1]; if (lo + d < 0 || hi + d >= s.rows.length) return;
      edit(() => { const blk = s.rows.splice(lo, hi - lo + 1); s.rows.splice(lo + d, 0, ...blk); }); UI.ri += d; if (UI.anchor != null) UI.anchor += d; return render(true); }
    case "in": case "out": if (!sel.some(x => x.t === "head")) return A.toast("Levels are for headings — a heading's total takes the items under it", 2200);
      return edit(() => { sel.forEach(x => { if (x.t === "head") x.lvl = Math.max(0, Math.min(3, (x.lvl || 0) + (w === "in" ? 1 : -1))); }); });
    case "link": return linkDialog(r);
  }
}
async function renameSec(id){ const s = secOf(id); if (!s) return;
  const v = await A.ask("Section", `<div class="grid"><div class="fg"><label>Code</label><input type="text" id="wbSc" value="${A.esc(s.code || "")}" placeholder="e.g. B2"></div><div class="fg w2"><label>Name</label><input type="text" id="wbSn" value="${A.esc(s.name)}"></div></div>`, "Save", () => ({code: document.getElementById("wbSc").value.trim(), name: document.getElementById("wbSn").value.trim() || s.name}), "wbSn");
  if (v) edit(() => { s.code = v.code; s.name = v.name; }); }

/* the quantity linked to the takeoff: a condition (searchable) and its quantity type — added to the row's lines, or the row's only link */
async function linkDialog(r){
  if (!r || r.t !== "item") return A.toast("Pick an item row to link its quantity", 1800);
  const C = A.P.proj.conds, X = new Map(C.map(c => [c.id, A.condVars(c)])), L = A.billLines().filter(l => l.kind === "asm");
  const opts = c => A.condQTypes(c).concat(["q"]).filter((v, i, a) => a.indexOf(v) === i).map(qt => { const q = A.condQ(c, qt, null, X.get(c.id)); return q ? `<button class="btn sm" data-lk="${A.esc(c.id)}|${qt}" title="${A.esc(A.QT_NAMES[qt])}">${qt === "q" ? "Own" : A.esc(A.QT_NAMES[qt])} <b>${A.fq(q.v, q.unit)}</b> ${A.esc(A.uL(q.unit))}</button>` : ""; }).join(" ");
  const body = `<p class="small">Click the quantity to link — it stays live: the workbook follows the takeoff. ${Array.isArray(r.qb) && r.qb.length ? "It is added as a line beside the row's other lines." : ""}</p><input type="search" id="wbLq" placeholder="Find a condition" style="width:100%;margin-bottom:6px">
    <div id="wbLl" style="max-height:52vh;overflow:auto">${C.map(c => `<div class="wbLc" data-n="${A.esc(c.name.toLowerCase())}"><div><span class="sw" style="background:${A.esc(c.color)}"></span><b>${A.esc(c.name)}</b> <span class="small">${A.esc(c.group || "")}</span></div><div class="wbLo">${opts(c)}${L.filter(l => l.c.id === c.id).map(l => `<button class="btn sm" data-lka="${A.esc(c.id)}|${A.esc(l.a.id)}">↳ ${A.esc(l.name)} <b>${A.fq(l.qty, l.unit)}</b> ${A.esc(A.uL(l.unit))}</button>`).join(" ")}</div></div>`).join("") || '<p class="small">No conditions yet.</p>'}</div>`;
  const p = A.ask("Link quantity — " + (r.desc || r.code || "item"), body, "");
  const box = document.getElementById("wbLl"); document.getElementById("wbLq").addEventListener("input", e => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll(".wbLc").forEach(d => { d.hidden = q && !d.dataset.n.includes(q); }); });
  box.addEventListener("click", e => { const b = e.target.closest("[data-lk],[data-lka]"); if (!b) return;
    const [cid, k] = (b.dataset.lk || b.dataset.lka).split("|"), c = A.cond(cid), link = b.dataset.lka ? {cond: cid, asm: k} : {cond: cid, qt: k};
    const q = b.dataset.lka ? L.find(l => l.c.id === cid && l.a.id === k) : A.condQ(c, k, null, X.get(cid)), unit = q ? q.unit : "";
    edit(() => { const line = {id: nid("Q"), desc: c.name, link, x: "1"};
      if (Array.isArray(r.qb) && r.qb.length) r.qb.push(line); else { r.qb = [line]; r.qe = ""; }
      if (!r.unit) r.unit = unit; if (!r.desc) r.desc = c.name; });
    A.ask.cur && A.ask.cur(true); });
  await p; render();
}
/* the rate library: found by code or words (or by item group), an item added as a row (or given to the active row) */
async function libDialog(){
  const L = A.raLib(); if (!L.o) return A.ask("Rate library", "<p>The QS Cost Control rate library is not in this browser yet — open <b>New condition</b> once (it reads it from QS Cost Control), or open SAJ QSCOST → Rate Analysis.</p>", "OK");
  const r = curRow(), s = secOf(UI.sec);
  const G = [...A.boqGroups(L).keys()].filter(g => (A.boqGroups(L).get(g) || []).length);
  const body = `<input type="search" id="wbLbQ" placeholder="Code or words — block 8, plaster, RCC slab" style="width:100%"><div class="wbGrp">${G.map(g => `<button class="btn sm" data-g="${A.esc(g)}">${A.esc(g)}</button>`).join("")}</div><div id="wbLb" style="max-height:50vh;overflow:auto;margin-top:6px"></div>
    <p class="small">Click an item to add it as a row below${r && r.t === "item" && !r.code ? ", or Shift+click to give it to the active row" : ""}.</p>`;
  const p = A.ask("Rate library — QS Cost Control", body, "");
  const list = (q, g) => { const M = A.boqMatches(q, "", false, g); document.getElementById("wbLb").innerHTML = M.slice(0, 200).map(o => `<div class="wbLi" data-code="${A.esc(o.it.code || o.it.id)}"><b>${A.esc(o.it.code || o.it.id)}</b> ${A.esc(String(o.it.desc || "").slice(0, 160))} <span class="n">${o.p && !o.p.err ? "PKR " + A.f2(o.p.rate) : ""} / ${A.esc(o.it.unit || "")}</span></div>`).join("") || '<p class="small">Nothing found.</p>'; };
  list("", G[0]);
  document.getElementById("wbLbQ").addEventListener("input", e => list(e.target.value, e.target.value.trim() ? "" : G[0]));
  document.querySelectorAll("[data-g]").forEach(b => b.addEventListener("click", () => { document.getElementById("wbLbQ").value = ""; list("", b.dataset.g); }));
  document.getElementById("wbLb").addEventListener("click", e => { const d = e.target.closest("[data-code]"); if (!d) return; const code = d.dataset.code;
    let sec = s; if (!sec) { sec = WB().secs[0]; if (!sec) { sec = {id: nid("S"), name: "Bill No. 1", rows: []}; } }
    edit(() => { if (!WB().secs.includes(sec)) WB().secs.push(sec);
      if (e.shiftKey && r && r.t === "item") { r.code = code; fillFromLib(r, code, true); }
      else { const nr = newRow({code}); fillFromLib(nr, code, true); const i = r && sec === s ? sec.rows.indexOf(r) + 1 : sec.rows.length; sec.rows.splice(i, 0, nr); UI.sec = sec.id; } });
    A.toast(code + " added — link or type its quantity", 1800); });
  await p; render();
}
async function varsDialog(){
  const V = JSON.parse(JSON.stringify(WB().vars)), vals = varsOf();
  const row = (v, i) => `<tr data-i="${i}"><td><input type="text" data-k="name" value="${A.esc(v.name || "")}" placeholder="WASTE" style="width:110px"></td><td><input type="text" data-k="e" value="${A.esc(v.e || "")}" placeholder="1.05" style="width:140px"></td><td class="n">${vals[String(v.name || "").toUpperCase()] != null && isFinite(vals[String(v.name || "").toUpperCase()]) ? +vals[String(v.name || "").toUpperCase()].toFixed(6) : ""}</td><td><input type="text" data-k="note" value="${A.esc(v.note || "")}" placeholder="what it is" style="width:160px"></td><td><button class="rn" data-del="${i}">&times;</button></td></tr>`;
  const body = () => `<p class="small">Named figures for any quantity or rate formula: <code>=12*H*WASTE</code>. A name is letters, digits and _ (starting with a letter); a value may use the ones above it.</p><table class="asm"><thead><tr><th>Name</th><th>Value / formula</th><th class="n">Now</th><th>Note</th><th></th></tr></thead><tbody id="wbVb">${V.map(row).join("")}</tbody></table><button class="btn sm" id="wbVa" type="button">+ Variable</button>`;
  const read = () => { document.querySelectorAll("#wbVb tr").forEach(tr => { const v = V[+tr.dataset.i]; tr.querySelectorAll("[data-k]").forEach(inp => { v[inp.dataset.k] = inp.value.trim(); }); }); };
  const p = A.ask("Workbook variables", body(), "Save", () => { read(); const bad = V.find(v => v.name && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v.name)); return bad ? "“" + bad.name + "”: letters, digits and _ only, starting with a letter" : V.filter(v => v.name); });
  const wire = () => { document.getElementById("wbVa").onclick = () => { read(); V.push({name: "", e: "", note: ""}); document.getElementById("wbVb").innerHTML = V.map(row).join(""); wire(); };
    document.querySelectorAll("#wbVb [data-del]").forEach(b => b.onclick = () => { read(); V.splice(+b.dataset.del, 1); document.getElementById("wbVb").innerHTML = V.map(row).join(""); wire(); }); };
  wire(); const v = await p; if (v) edit(() => { WB().vars = v; });
}
async function colsDialog(){
  const C = JSON.parse(JSON.stringify(WB().cols));
  const row = (c, i) => `<tr data-i="${i}"><td><input type="text" data-k="name" value="${A.esc(c.name || "")}" placeholder="e.g. Remarks"></td><td><select data-k="kind"><option value="text"${c.kind !== "num" ? " selected" : ""}>Text</option><option value="num"${c.kind === "num" ? " selected" : ""}>Number (totalled)</option></select></td><td><button class="rn" data-del="${i}">&times;</button></td></tr>`;
  const body = `<label class="pk"><input type="checkbox" id="wbSp"${UI.split ? " checked" : ""}> Show each total split into material, labour, plant and OH / profit (from the Rate Analysis rate or the build-up)</label>
    <h4 style="margin:12px 0 4px">User columns</h4><table class="asm"><tbody id="wbCb">${C.map(row).join("")}</tbody></table><button class="btn sm" id="wbCa" type="button">+ Column</button>`;
  const read = () => document.querySelectorAll("#wbCb tr").forEach(tr => { const c = C[+tr.dataset.i]; tr.querySelectorAll("[data-k]").forEach(inp => { c[inp.dataset.k] = inp.value.trim(); }); });
  const p = A.ask("Columns", body, "Save", () => { read(); return {C: C.filter(c => c.name), split: document.getElementById("wbSp").checked}; });
  const wire = () => { document.getElementById("wbCa").onclick = () => { read(); C.push({id: nid("C"), name: "", kind: "text"}); document.getElementById("wbCb").innerHTML = C.map(row).join(""); wire(); };
    document.querySelectorAll("#wbCb [data-del]").forEach(b => b.onclick = () => { read(); C.splice(+b.dataset.del, 1); document.getElementById("wbCb").innerHTML = C.map(row).join(""); wire(); }); };
  wire(); const v = await p; if (!v) return; UI.split = v.split; edit(() => { WB().cols = v.C; });
}
async function revDialog(){
  const wb = WB(), X = calc();
  const body = `<p class="small">A revision keeps every row's quantity, rate and total as they are now — pick it in <b>Compare with…</b> to see what changed (by row and by section), or filter <b>Changed since revision</b>.</p>
    <div class="fg"><label>Keep the workbook now as</label><input type="text" id="wbRn" value="Rev ${wb.revs.length} — ${A.dmy(A.today())}"></div>
    ${wb.revs.length ? `<table class="sh" style="margin-top:8px"><thead><tr><th>Revision</th><th>Kept</th><th class="n">Grand total</th><th></th></tr></thead><tbody>${wb.revs.map((r, i) => `<tr><td>${A.esc(r.name)}</td><td>${A.dmy(r.at)}</td><td class="n">${money(r.grand)}</td><td><button class="rn" data-rdel="${i}" title="Delete">&times;</button></td></tr>`).join("")}</tbody></table>` : ""}`;
  const p = A.ask("Revisions", body, "Keep revision", () => ({name: document.getElementById("wbRn").value.trim() || "Revision"}), "wbRn");   // (a dialog's text answer is its error: an object)
  document.querySelectorAll("[data-rdel]").forEach(b => b.onclick = () => { const i = +b.dataset.rdel; edit(() => { const g = wb.revs.splice(i, 1)[0]; if (g && g.id === UI.cmp) UI.cmp = ""; }); A.ask.cur && A.ask.cur(null); });
  const got = await p; if (!got) return; const name = got.name;
  edit(() => { const rows = {}, secs = {}; wb.secs.forEach(s => { secs[s.id] = X.S.get(s.id).t; s.rows.forEach(r => { const x = X.R.get(r.id); if (r.t === "item" && x) rows[r.id] = [x.q.v || 0, x.r.v || 0, x.t || 0]; }); });
    wb.revs.push({id: nid("V"), name, at: new Date().toISOString(), rows, secs, net: X.net, grand: X.grand}); while (wb.revs.length > MAXREV) wb.revs.shift(); });
  A.toast("Kept as “" + name + "” — compare with it from Compare with…", 2400);
}
function checkList(X){
  const out = [];
  WB().secs.forEach(s => s.rows.forEach(r => { if (r.t !== "item") return; const x = X.R.get(r.id); if (!x) return; const nm = (r.code ? r.code + " " : "") + (r.desc || "item");
    if (x.q.dead) out.push({s, r, lvl: "ERROR", msg: nm + ": a quantity link is dead (" + (r.qb || []).filter(l => l.link).map(l => linkOf(l.link, {v: new Map()})).filter(k => k.dead).map(k => k.why)[0] + ")"});
    if (x.q.err) out.push({s, r, lvl: "ERROR", msg: nm + ": quantity — " + x.q.err});
    if (x.q.mis) out.push({s, r, lvl: "ERROR", msg: nm + ": the link gives " + x.q.mis + ", the row is in " + r.unit});
    if (x.r.err) out.push({s, r, lvl: "ERROR", msg: nm + ": rate — " + x.r.err});
    if (!x.q.err && !x.q.dead && !(x.q.v > 0)) out.push({s, r, lvl: "WARNING", msg: nm + ": no quantity"});
    if (!x.r.err && !(x.r.v > 0)) out.push({s, r, lvl: "WARNING", msg: nm + ": not priced"});
    if (!r.unit) out.push({s, r, lvl: "WARNING", msg: nm + ": no unit"}); }));
  return out;
}
async function checkDialog(){
  const L = checkList(UI.X || calc());
  const p = A.ask("Check the workbook", L.length ? `<p class="small">${L.filter(x => x.lvl === "ERROR").length} errors, ${L.filter(x => x.lvl === "WARNING").length} warnings — click one to go to its row.</p><div style="max-height:56vh;overflow:auto">${L.map((x, i) => `<div class="wbCk ${x.lvl === "ERROR" ? "e" : "w"}" data-ck="${i}"><b>${x.lvl}</b> ${A.esc(x.s.name)} · ${A.esc(x.msg)}</div>`).join("")}</div>` : "<p>Every item is measured and priced, every link is live, no formula fails.</p>", "");
  document.querySelectorAll(".wbCk").forEach(d => d.onclick = () => { const x = L[+d.dataset.ck]; UI.sec = x.s.id; UI.q = ""; UI.flt = "all"; $w(".wbQ").value = ""; $w(".wbF").value = "all"; render(); UI.ri = (UI.V || []).indexOf(x.r); UI.ck = "qty"; UI.anchor = null; A.ask.cur && A.ask.cur(null); render(); });
  await p;
}

/* ------------------------------------------------------------------ Excel: the Summary and a sheet per section, live formulas */
async function exportXls(){
  A.busy("Writing the workbook to Excel…");
  try {
    const XL = await A.loadExcel(), wbx = new XL.Workbook(), wb = WB(), X = calc(); wbx.creator = "Sajjad QS PDF TAKEOFF Software"; wbx.created = new Date();
    const HEAD = {type: "pattern", pattern: "solid", fgColor: {argb: "FF12263F"}}, GREY = {type: "pattern", pattern: "solid", fgColor: {argb: "FFE6E9EE"}}, BLUE = {type: "pattern", pattern: "solid", fgColor: {argb: "FFDDEBFF"}}, GREEN = {type: "pattern", pattern: "solid", fgColor: {argb: "FFE2F4E8"}};
    const used = new Set(), shName = n => { let b = String(n || "Section").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Section", x = b, k = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 25) + " " + k++; used.add(x.toLowerCase()); return x; };
    used.add("summary");
    const sm = wbx.addWorksheet("Summary", {views: [{state: "frozen", ySplit: 3}]});
    const UC = wb.cols, sheets = [];
    wb.secs.forEach((s, si) => {
      const nm = shName(s.name), ws = wbx.addWorksheet(nm, {views: [{state: "frozen", ySplit: 3}], pageSetup: {paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0}});
      ws.columns = [{width: 7}, {width: 14}, {width: 60}, {width: 13}, {width: 7}, {width: 13}, {width: 16}].concat(UC.map(() => ({width: 16})));
      ws.mergeCells("A1:G1"); ws.getCell("A1").value = (s.code ? s.code + " — " : "") + s.name; ws.getCell("A1").font = {bold: true, size: 13};
      ws.getCell("A2").value = "Quantities live from the takeoff at " + A.dmy(A.today()) + (A.isM() ? " · metres" : " · feet") + " · Total = Qty × Rate"; ws.getCell("A2").font = {size: 9, color: {argb: "FF52514E"}};
      const hr = ws.getRow(3); hr.values = ["Ref", "Code", "Description", "Qty", "Unit", "Rate", "Total PKR"].concat(UC.map(c => c.name)); hr.font = {bold: true, color: {argb: "FFFFFFFF"}}; hr.eachCell(c => { c.fill = HEAD; });
      let row = 4, n = 0; const first = row, heads = [];
      s.rows.forEach((r, i) => { const xr = ws.getRow(row), x = X.R.get(r.id) || {};
        if (r.t === "head") { xr.getCell(2).value = r.code || ""; xr.getCell(3).value = (r.lvl ? "  ".repeat(r.lvl) : "") + (r.desc || ""); xr.font = {bold: true}; heads.push({row, r, i}); }
        else if (r.t === "note") { xr.getCell(3).value = r.desc || ""; xr.getCell(3).font = {italic: true}; }
        else { xr.getCell(1).value = (si + 1) + "." + (++n); xr.getCell(2).value = r.code || ""; xr.getCell(3).value = r.desc || ""; xr.getCell(3).alignment = {wrapText: true, vertical: "top"};
          const q = xr.getCell(4); q.value = x.q && x.q.v != null ? +A.uX(x.q.v, r.unit).toFixed(6) : null; q.numFmt = A.qFmt(r.unit); q.fill = BLUE;
          if (x.q && x.q.links) q.note = "Live from the takeoff: " + (r.qb || []).map(l => (l.desc || "") + (l.link ? " [" + linkOf(l.link, {v: new Map()}).name + "]" : " " + (l.e || "")) + (l.x && l.x !== "1" ? " × " + l.x : "")).join("; ");
          xr.getCell(5).value = A.uL(r.unit || "");
          const rt = xr.getCell(6); rt.value = x.r && x.r.v ? +A.uX(x.r.v, r.unit, 1).toFixed(4) : null; rt.numFmt = "#,##0.00"; rt.fill = BLUE; if (x.r && x.r.src) rt.note = x.r.src;
          const t = xr.getCell(7); t.value = {formula: `IF(ISNUMBER(D${row}),D${row},0)*IF(ISNUMBER(F${row}),F${row},0)`, result: x.t || 0}; t.numFmt = "#,##0.00"; t.fill = GREEN; }
        UC.forEach((c, j) => { const v = (r.u || {})[c.id]; if (v == null || v === "") return; const cl = xr.getCell(8 + j); cl.value = c.kind === "num" && NUMS.test(String(v)) ? +String(v).replace(/,/g, "") : v; });
        if (r.note) xr.getCell(3).note = r.note;
        row++; });
      const last = row - 1;
      heads.forEach(h => { let end = last; for (let j = h.i + 1; j < s.rows.length; j++) { const x = s.rows[j]; if (x.t === "head" && x.lvl <= h.r.lvl) { end = h.row + (j - h.i) - 1; break; } }
        const c = ws.getRow(h.row).getCell(7); c.value = {formula: end > h.row ? `SUBTOTAL(9,G${h.row + 1}:G${end})` : "0", result: (X.R.get(h.r.id) || {}).t || 0}; c.numFmt = "#,##0.00"; c.font = {bold: true}; });
      const tr = ws.getRow(row); tr.getCell(3).value = "Total " + s.name; tr.getCell(7).value = {formula: last >= first ? `SUBTOTAL(9,G${first}:G${last})` : "0", result: X.S.get(s.id).t}; tr.getCell(7).numFmt = "#,##0.00"; tr.font = {bold: true}; for (let k = 1; k <= 7; k++) tr.getCell(k).fill = GREY;
      sheets.push({s, nm, cell: "G" + row});
    });
    sm.columns = [{width: 7}, {width: 12}, {width: 56}, {width: 18}, {width: 10}];
    sm.mergeCells("A1:E1"); sm.getCell("A1").value = "WORKBOOK SUMMARY — " + (A.P.proj.name || ""); sm.getCell("A1").font = {bold: true, size: 13};
    sm.getCell("A2").value = "PDF takeoff workbook · " + A.dmy(A.today()) + " · amounts in PKR"; sm.getCell("A2").font = {size: 9, color: {argb: "FF52514E"}};
    const h = sm.getRow(3); h.values = ["#", "Code", "Section", "Total PKR", "% of net"]; h.font = {bold: true, color: {argb: "FFFFFFFF"}}; h.eachCell(c => { c.fill = HEAD; });
    let r0 = 4; sheets.forEach((x, i) => { const r = sm.getRow(r0 + i); r.values = [i + 1, x.s.code || "", x.s.name]; const c = r.getCell(4); c.value = {formula: `'${x.nm.replace(/'/g, "''")}'!${x.cell}`, result: X.S.get(x.s.id).t}; c.numFmt = "#,##0.00"; c.fill = GREEN; });
    const netRow = r0 + sheets.length, nr = sm.getRow(netRow); nr.getCell(3).value = "Net total"; nr.getCell(4).value = {formula: sheets.length ? `SUM(D${r0}:D${netRow - 1})` : "0", result: X.net}; nr.getCell(4).numFmt = "#,##0.00"; nr.font = {bold: true}; for (let k = 1; k <= 5; k++) nr.getCell(k).fill = GREY;
    sheets.forEach((x, i) => { const c = sm.getRow(r0 + i).getCell(5); c.value = {formula: `IF(D${netRow}=0,0,D${r0 + i}/D${netRow})`, result: X.net ? X.S.get(x.s.id).t / X.net : 0}; c.numFmt = "0.0%"; });
    let rr = netRow + 1, runCell = "D" + netRow, runV = X.net;
    X.M.forEach(({m, v}) => { runV += v; const r = sm.getRow(rr), pct = m.kind !== "sum"; r.getCell(3).value = m.name + (pct ? " — " + m.e + " % of the " + (m.base === "net" ? "net" : "running total") : "");
      const xv = val(m.e, X.vars).v || 0; r.getCell(5).value = pct ? xv / 100 : null; if (pct) { r.getCell(5).numFmt = "0.00%"; r.getCell(5).fill = BLUE; }
      r.getCell(4).value = {formula: pct ? `${m.base === "net" ? "D" + netRow : runCell}*E${rr}` : String(xv), result: v}; r.getCell(4).numFmt = "#,##0.00";
      const cum = sm.getRow(rr); cum.getCell(6).value = {formula: `${runCell}+D${rr}`, result: runV}; cum.getCell(6).numFmt = "#,##0.00"; runCell = "F" + rr; rr++; });
    const gr = sm.getRow(rr); gr.getCell(3).value = "GRAND TOTAL"; gr.getCell(4).value = {formula: X.M.length ? runCell : "D" + netRow, result: X.grand}; gr.getCell(4).numFmt = "#,##0.00"; gr.font = {bold: true}; for (let k = 1; k <= 5; k++) gr.getCell(k).fill = GREY;
    if (X.M.length) { sm.getColumn(6).width = 16; sm.getRow(3).getCell(6).value = "Running total"; sm.getRow(3).getCell(6).fill = HEAD; sm.getRow(3).getCell(6).font = {bold: true, color: {argb: "FFFFFFFF"}}; }
    // the quantities behind each item and the rate build-ups, for the audit trail
    const qs = wbx.addWorksheet("Quantities"); qs.columns = [{header: "Ref", width: 8}, {header: "Item", width: 40}, {header: "Line", width: 30}, {header: "Source", width: 50}, {header: "× factor", width: 10}, {header: "Qty", width: 13}, {header: "Unit", width: 8}];
    const bs = wbx.addWorksheet("Rate build-ups"); bs.columns = [{header: "Ref", width: 8}, {header: "Item", width: 40}, {header: "Type", width: 12}, {header: "Resource", width: 30}, {header: "Qty", width: 10}, {header: "Unit", width: 8}, {header: "Rate", width: 12}, {header: "Amount", width: 14}];
    [qs, bs].forEach(w => { w.getRow(1).font = {bold: true, color: {argb: "FFFFFFFF"}}; w.getRow(1).eachCell(c => { c.fill = HEAD; }); });
    wb.secs.forEach((s, si) => { let n = 0; s.rows.forEach(r => { if (r.t !== "item") return; const ref = (si + 1) + "." + (++n);
      (r.qb || []).forEach(l => { const k = l.link ? linkOf(l.link, {v: new Map()}) : null; qs.addRow([ref, r.desc || r.code || "", l.desc || "", k ? (k.dead ? "DEAD LINK — " + k.why : "takeoff: " + k.name) : l.e || "", l.x || "1", +A.uX(l._v || 0, r.unit).toFixed(6), A.uL(r.unit || "")]); });
      if (r.rb && r.rb.lines) { r.rb.lines.forEach(l => bs.addRow([ref, r.desc || r.code || "", (KINDS.find(k => k[0] === l.k) || ["", "Other"])[1], l.desc || "", l.q || "1", l.unit || "", l.r || "", +(l._v || 0).toFixed(2)]));
        bs.addRow([ref, "", "", "Waste " + (r.rb.w || 0) + " % on material · OH " + (r.rb.oh || 0) + " % · profit " + (r.rb.pf || 0) + " % → rate", "", "", "", +(X.R.get(r.id).r.v || 0).toFixed(2)]); } }); });
    const buf = await wbx.xlsx.writeBuffer();
    A.saveBlob(new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), A.fileBase() + "_Workbook.xlsx");
    A.toast("Workbook exported — Summary, " + wb.secs.length + " section sheet" + (wb.secs.length === 1 ? "" : "s") + ", Quantities, Rate build-ups", 2600);
  } catch (e) { A.toast("Excel export failed: " + (e.message || e), 5000); } finally { A.busy(""); }
}

/* ------------------------------------------------------------------ the look */
function css(){
  if (document.getElementById("wbCss")) return;
  const st = document.createElement("style"); st.id = "wbCss";
  st.textContent = `#wbRoot{position:fixed;inset:0;z-index:9;background:var(--bg,#eef2f7);display:flex;flex-direction:column;font-size:12.5px;color:var(--txt,#1e2b3a)}
#wbRoot .wbHead{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--navy,#0f2942);color:#fff}
#wbRoot .wbHead .btn{background:#fff;color:var(--navy,#0f2942)}#wbRoot .wbT{font-size:15px}#wbRoot .wbP{opacity:.8}#wbRoot .wbTot b{color:#ffe28a}
#wbRoot .wbBar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;background:#fff;border-bottom:1px solid var(--line,#dde5ee)}
#wbRoot .grpb{display:inline-flex;gap:2px;padding-right:6px;border-right:1px solid var(--line,#dde5ee)}#wbRoot .wbQ{width:180px}
#wbRoot .wbMain{flex:1;display:grid;grid-template-columns:220px 1fr 360px;min-height:0}#wbRoot .wbMain.np{grid-template-columns:220px 1fr}
#wbRoot .wbTree{background:#fff;border-right:1px solid var(--line,#dde5ee);overflow:auto;padding:6px}
#wbRoot .wbS{display:flex;justify-content:space-between;gap:6px;width:100%;text-align:left;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer;font:inherit}
#wbRoot .wbS b{font-weight:600;color:var(--muted,#6b7d92);font-size:11.5px}#wbRoot .wbS.on{background:#e8eefc;color:var(--purple,#4b3b8f)}#wbRoot .wbS:hover{background:#f2f5fb}
#wbRoot .wbTA{display:flex;gap:3px;margin-top:8px;flex-wrap:wrap}
#wbRoot .wbGridW{overflow:auto;outline:none;background:#fff}#wbRoot .wbT2{border-collapse:collapse;width:100%;table-layout:fixed}
#wbRoot .wbT2 th{position:sticky;top:0;background:#12263f;color:#fff;font-weight:600;padding:6px;text-align:left;z-index:1}#wbRoot .wbT2 th.n,#wbRoot .wbT2 td.n{text-align:right}
#wbRoot .wbT2 td{border-bottom:1px solid #edf1f6;border-right:1px solid #f1f4f8;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:cell}
#wbRoot col.k-ref{width:56px}#wbRoot col.k-code{width:120px}#wbRoot col.k-qty,#wbRoot col.k-rate{width:110px}#wbRoot col.k-unit{width:56px}#wbRoot col.k-tot{width:130px}
#wbRoot .wbT2 tr.head td{background:#f6f8fc}#wbRoot .wbT2 tr.head td[data-ck=desc]{padding-left:calc(6px + var(--lv) * 18px)}#wbRoot .wbT2 tr.note td{color:var(--muted,#6b7d92)}
#wbRoot .wbT2 td.act{outline:2px solid var(--blue,#2b7de9);outline-offset:-2px;background:#eef5ff}#wbRoot .wbT2 tr.sel td{background:#e9f1ff}
#wbRoot .wbT2 td.lnk{color:#16723f}#wbRoot .wbT2 td.dead,#wbRoot .wbT2 td.err{color:var(--red,#d03b3b);background:#fff3f3}#wbRoot .wbT2 td.fx{color:#3550a8}#wbRoot .wbT2 td.bu{color:#7a4bb0}
#wbRoot .wbI{font-size:10px;margin-right:4px;opacity:.75}#wbRoot td.up{color:#b0392f}#wbRoot td.dn{color:#16723f}
#wbRoot .wbT2 tr.c-yellow td{background:#fff8d6}#wbRoot .wbT2 tr.c-green td{background:#e6f6ec}#wbRoot .wbT2 tr.c-red td{background:#fde9e7}#wbRoot .wbT2 tr.c-blue td{background:#e7f0ff}
#wbRoot .wbT2 tfoot td,#wbRoot .wbT2 tr.tot td{background:#e6e9ee;font-weight:600}#wbRoot .wbT2 tr.grand td{background:#12263f;color:#fff}
#wbRoot .wbT2.sum td{cursor:default}#wbRoot .wbT2.sum tr.mk td{white-space:normal;overflow:visible}#wbRoot .wbT2.sum tr.mk input,#wbRoot .wbT2.sum tr.mk select{width:auto;display:inline-block}#wbRoot .wbT2.sum tr.mk input[data-mf=name]{width:170px}#wbRoot .wbT2 tr.mk td{background:#fbfcfe}#wbRoot .wbE{color:var(--muted,#6b7d92);padding:24px!important;text-align:center;white-space:normal}
#wbRoot .wbEd{width:100%;border:0;outline:none;font:inherit;padding:0;background:#fff}
#wbRoot .wbPane{background:#fff;border-left:1px solid var(--line,#dde5ee);overflow:auto;padding:10px 12px}#wbRoot .wbPane h4{margin:2px 0 8px;font-size:13px}
#wbRoot .wbBox{border:1px solid var(--line,#dde5ee);border-radius:8px;padding:8px;margin-bottom:8px}#wbRoot .wbBH{display:flex;justify-content:space-between;margin-bottom:4px}
#wbRoot .wbQt{width:100%;border-collapse:collapse}#wbRoot .wbQt td{white-space:nowrap}#wbRoot .wbQt td span.lnk,#wbRoot .wbQt td span.dead{white-space:normal;display:inline-block;max-width:150px}#wbRoot .wbQt td,#wbRoot .wbQt th{padding:2px 3px;font-size:11.5px}#wbRoot .wbQt input,#wbRoot .wbQt select{width:100%;font-size:11.5px}
#wbRoot .wbBA{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px}#wbRoot .wbSeg{display:flex;gap:10px;margin:4px 0}#wbRoot .wbPane textarea{width:100%;font:inherit}
#wbRoot .wbPane .lnk{color:#16723f}#wbRoot .wbPane .dead{color:var(--red,#d03b3b)}#wbRoot .wbPane .err{color:var(--red,#d03b3b);margin:4px 0}#wbRoot .wbNt{color:var(--amber,#c9822a)}
#wbRoot .wbFoot{padding:4px 12px;background:#fff;border-top:1px solid var(--line,#dde5ee);color:var(--muted,#6b7d92);font-size:11.5px}
.wbLc{border-bottom:1px solid var(--line,#dde5ee);padding:6px 2px}.wbLo{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.wbLi{padding:5px 4px;border-bottom:1px solid var(--line,#dde5ee);cursor:pointer}.wbLi:hover{background:#eef5ff}.wbLi .n{float:right;color:var(--muted,#6b7d92)}
.wbGrp{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}.wbCk{padding:5px;border-bottom:1px solid var(--line,#dde5ee);cursor:pointer}.wbCk.e b{color:var(--red,#d03b3b)}.wbCk.w b{color:var(--amber,#c9822a)}.wbCk:hover{background:#f2f5fb}
@media (max-width:1100px){#wbRoot .wbMain{grid-template-columns:170px 1fr}#wbRoot .wbPane{position:fixed;right:0;top:110px;bottom:24px;width:340px;box-shadow:-8px 0 24px rgba(0,0,0,.12)}}`;
  document.head.appendChild(st);
}

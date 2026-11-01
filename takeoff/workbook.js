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

   The grid works as Excel's. A cell, a range (dragged, Shift+arrows, Shift+click), whole rows (by their numbers at the left), whole
   columns (by their headings) or all (Ctrl+A). A selected column dragged by its heading — or Alt+Shift+←/→ — moves (the order is the
   workbook's, its Excel export too); dragged by its edge it is resized (double-click: fitted); columns are hidden and shown again,
   frozen, their text wrapped. Selected rows dragged by their numbers — or Alt+↑/↓, or cut and pasted — move (dropped on a section of
   the tree: into it); a heading's rows collapse under it. A right-click on a cell, a row number or a column heading has the rest.
   The formula bar shows what the active cell holds (a formula as typed, a link in words) and takes a new entry; the name box goes
   to a ref (2.15) or a code. Ctrl+C / Ctrl+X / Ctrl+V within the workbook keep links, Rate Analysis codes and build-ups (Ctrl+Shift+V:
   the figures only), with Excel they are plain cells; one cell pasted fills the selection. The fill handle and Ctrl+D / Ctrl+R fill
   (numbers and codes like A-1 as a series; Ctrl: copies), Ctrl+Enter while typing fills the selection. Sort A → Z, Find and replace
   (Ctrl+H), Go to (Ctrl+G); the status bar has the selection's average, count and sum; Ctrl+wheel zooms. Keys: arrows (Ctrl: to the
   edge), Tab, Enter / F2, typing, Delete, Ctrl+Z / Ctrl+Y, Ctrl+Enter a row, Ctrl+Shift+Enter a heading, Ctrl++ a row above,
   Ctrl+− delete, Ctrl+Shift+D duplicate, Alt+←→ a heading's level, Shift+Space / Ctrl+Space a row / column, Shift+F10 the menu.
   Recover: what is deleted (rows, sections, markups, columns, variables, revisions) waits in the workbook's bin to be put back where
   it was — one by one, or all at once; versions of the whole workbook are kept in this browser beside the project (when it is
   opened, every 5 minutes of editing, when it is closed, before Generate's start again or a restore), and the owner can take the
   workbook back from one of the project's backups. */
let A = null, UI = null, CLIP = null, SNAPQ = Promise.resolve();
const NUMS = /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const KINDS = [["L", "Labour"], ["M", "Material"], ["P", "Plant"], ["S", "Subcontract"], ["O", "Other"]];
const MARK_PRE = [["Overheads", 5], ["Profit", 10], ["Contingency", 5], ["GST / sales tax", 17]];
const QTS = ["q", "len", "area", "vol", "sarea", "per", "pd", "n"];
const MAXREV = 20, MAXUNDO = 120, MAXBIN = 200, MAXVER = 40, SNAP_MS = 5 * 60e3;
const WIDTH = {gut: 46, ref: 56, code: 120, desc: 320, qty: 110, unit: 64, rate: 110, tot: 130};   // a column's width (px) until it is resized
const HIST = new Map();   // each project's undo / redo while the page is open: closing the workbook and opening it again keeps them
const clone = o => JSON.parse(JSON.stringify(o));

export function open(api){
  A = api; css();
  if (!A.P.proj) return A.toast("Open a project first", 2400);
  const wb = A.P.proj.wb = norm(A.P.proj.wb), h = HIST.get(A.P.proj.id) || {undo: [], redo: []};
  UI = {sec: wb.secs.length ? wb.secs[0].id : "", ri: 0, ck: "desc", anc: null, full: null, edit: null, undo: h.undo, redo: h.redo, q: "", flt: "all", cmp: "", pane: true,
    snapAt: Date.now(), painted: [], ref: new Map(), memo: {v: new Map()}};
  build();
  if (!wb.secs.length) generateDialog(true); else { render(); snap("opened"); }
}
export function close(){ if (!UI) return; snap("closed"); HIST.set(A.P.proj.id, {undo: UI.undo, redo: UI.redo}); menuOff();
  window.removeEventListener("keydown", onKey, true); document.removeEventListener("copy", onCopy, true); document.removeEventListener("cut", onCopy, true); document.removeEventListener("paste", onPaste, true);
  const r = document.getElementById("wbRoot"); if (r) r.remove(); UI = null; CLIP = null; A.refresh(); }
export const isOpen = () => !!UI;
export async function exportExcel(api){ A = api; if (!A.P.proj) return; A.P.proj.wb = norm(A.P.proj.wb); if (!WB().secs.length) return A.toast("No workbook yet — Costing → Workbook builds it from the takeoff", 2800); await exportXls(); }

/* ------------------------------------------------------------------ the model */
function norm(wb){
  wb = wb && typeof wb === "object" ? wb : {};
  wb.v = 1; wb.secs = Array.isArray(wb.secs) ? wb.secs : []; wb.vars = Array.isArray(wb.vars) ? wb.vars : []; wb.marks = Array.isArray(wb.marks) ? wb.marks : [];
  wb.cols = Array.isArray(wb.cols) ? wb.cols : []; wb.revs = Array.isArray(wb.revs) ? wb.revs : []; wb.bin = Array.isArray(wb.bin) ? wb.bin : [];
  const v = wb.view = wb.view && typeof wb.view === "object" ? wb.view : {};   // the sheet's layout: column order, hidden ones, widths, frozen, zoom, wrap, the split
  v.order = Array.isArray(v.order) ? v.order : []; v.hide = Array.isArray(v.hide) ? v.hide : []; v.w = v.w && typeof v.w === "object" ? v.w : {};
  v.freeze = Math.max(0, Math.floor(+v.freeze || 0)); v.zoom = Math.min(200, Math.max(50, +v.zoom || 100)); v.wrap = !!v.wrap; v.split = !!v.split;
  wb.secs.forEach(s => { s.rows = Array.isArray(s.rows) ? s.rows : []; s.rows.forEach(r => { r.t = r.t || "item"; r.lvl = +r.lvl || 0; }); });
  return wb;
}
const WB = () => A.P.proj.wb;
const secOf = id => WB().secs.find(s => s.id === id) || null;
const rowOf = id => { for (const s of WB().secs) { const r = s.rows.find(x => x.id === id); if (r) return {s, r}; } return null; };
const nid = p => A.uid(p);
const newRow = (o) => Object.assign({id: nid("R"), t: "item", lvl: 0, code: "", desc: "", unit: "", qe: "", re: ""}, o || {});
const fresh = r => { r.id = nid("R"); if (r.qb) r.qb.forEach(l => { l.id = nid("Q"); }); delete r.src; return r; };   // a copy of a row: its own ids, no longer the takeoff's row of its condition
function edit(fn, keepPane){   // every change: one undo step, saved, drawn again
  UI.undo.push(JSON.stringify(WB())); if (UI.undo.length > MAXUNDO) UI.undo.shift(); UI.redo = [];
  fn(); A.save(); render(keepPane);
  if (Date.now() - UI.snapAt > SNAP_MS) snap("while editing");
}
function undo(redo){
  const from = redo ? UI.redo : UI.undo, to = redo ? UI.undo : UI.redo; if (!from.length) return A.toast(redo ? "Nothing to redo" : "Nothing to undo", 1400);
  to.push(JSON.stringify(WB())); A.P.proj.wb = norm(JSON.parse(from.pop())); if (!secOf(UI.sec) && UI.sec !== "") UI.sec = WB().secs[0] ? WB().secs[0].id : ""; A.save(); render();
}
/* rows that go together: a collapsed heading moves, copies and is deleted with the rows folded under it */
function unitOf(s, r){
  if (r.t !== "head" || !r.fold) return [r]; const out = [r];
  for (let j = s.rows.indexOf(r) + 1; j < s.rows.length; j++) { const x = s.rows[j]; if (x.t === "head" && x.lvl <= r.lvl) break; out.push(x); }
  return out;
}
const unitEnd = (s, r) => { const u = unitOf(s, r); return u[u.length - 1]; };
function withFolded(s, rows){ const pos = new Map(s.rows.map((r, i) => [r, i])), all = new Set(); rows.forEach(r => unitOf(s, r).forEach(x => all.add(x))); return [...all].filter(x => pos.has(x)).sort((a, b) => pos.get(a) - pos.get(b)); }
function moveRows(rows, from, to, before){   // rows (kept in their order) out of a section, into another or the same one before a row (null: at its end)
  const set = new Set(rows); if (before && set.has(before)) return false;
  const blk = from.rows.filter(x => set.has(x)); from.rows = from.rows.filter(x => !set.has(x));
  const i = before ? to.rows.indexOf(before) : -1; to.rows.splice(i < 0 ? to.rows.length : i, 0, ...blk); return true;
}

/* ------------------------------------------------------------------ Recover: the bin (in the workbook) and the versions (in this browser) */
function toBin(e){ const b = WB().bin; e.id = nid("D"); e.at = new Date().toISOString(); b.push(e); while (b.length > MAXBIN) b.shift(); }
function delRows(s, rows){   // rows out of a section, into the bin — each with the row it came after, to go back there
  const del = new Set(rows), out = []; let prev = null;
  s.rows.forEach((r, i) => { if (del.has(r)) out.push({r, after: prev, i}); prev = r.id; });
  if (!out.length) return 0; s.rows = s.rows.filter(r => !del.has(r)); toBin({kind: "rows", sec: s.id, secName: s.name, secIdx: WB().secs.indexOf(s), rows: out}); return out.length;
}
function recoverEntry(e){   // a thing of the bin put back where it was (rows after the row they came after; a section, if it is gone, made again)
  const wb = WB(), i = wb.bin.indexOf(e); if (i >= 0) wb.bin.splice(i, 1);
  const ids = new Set(); wb.secs.forEach(s => s.rows.forEach(r => ids.add(r.id)));
  if (e.kind === "rows") { let s = secOf(e.sec); if (!s) { s = {id: e.sec, name: e.secName || "Recovered", rows: []}; wb.secs.splice(Math.min(e.secIdx == null ? wb.secs.length : e.secIdx, wb.secs.length), 0, s); }
    e.rows.forEach(x => { if (ids.has(x.r.id)) return; const j = x.after ? s.rows.findIndex(r => r.id === x.after) : -1; s.rows.splice(j >= 0 ? j + 1 : x.after ? Math.min(x.i, s.rows.length) : 0, 0, x.r); ids.add(x.r.id); }); return; }
  if (e.kind === "sec") { const ex = secOf(e.s.id); if (ex) { e.s.rows.forEach(r => { if (!ids.has(r.id)) ex.rows.push(r); }); return; }
    e.s.rows = e.s.rows.filter(r => !ids.has(r.id)); wb.secs.splice(Math.min(e.i, wb.secs.length), 0, e.s); return; }
  if (e.kind === "mark") { if (!wb.marks.some(m => m.id === e.m.id)) wb.marks.splice(Math.min(e.i, wb.marks.length), 0, e.m); return; }
  if (e.kind === "col") { if (!wb.cols.some(c => c.id === e.c.id)) wb.cols.splice(Math.min(e.i, wb.cols.length), 0, e.c); return; }
  if (e.kind === "rev") { if (!wb.revs.some(r => r.id === e.r.id)) wb.revs.push(e.r); return; }
  if (e.kind === "var") { if (!wb.vars.some(v => String(v.name).toUpperCase() === String(e.v.name).toUpperCase())) wb.vars.splice(Math.min(e.i, wb.vars.length), 0, e.v); }
}
function binLabel(e){   // a thing of the bin, in words (HTML)
  const nm = r => A.esc(String((r.code ? r.code + " " : "") + (r.desc || (r.t === "head" ? "heading" : r.t === "note" ? "note" : "item"))).slice(0, 70));
  if (e.kind === "rows") return `<b>${e.rows.length} row${e.rows.length > 1 ? "s" : ""}</b> of ${A.esc(e.secName || "a section")}: ${e.rows.slice(0, 3).map(x => nm(x.r)).join(" · ")}${e.rows.length > 3 ? " …" : ""}`;
  if (e.kind === "sec") return `<b>Section</b> ${A.esc(e.s.name)} (${e.s.rows.length} rows)`;
  if (e.kind === "mark") return `<b>Markup</b> ${A.esc(e.m.name)}`;
  if (e.kind === "col") return `<b>Column</b> ${A.esc(e.c.name)}`;
  if (e.kind === "rev") return `<b>Revision</b> ${A.esc(e.r.name)}`;
  if (e.kind === "var") return `<b>Variable</b> ${A.esc(e.v.name)} = ${A.esc(e.v.e)}`;
  return A.esc(e.kind);
}
/* a version: the whole workbook as it is (the bin aside), kept in this browser unless it is the same as the newest → Promise(kept) */
function snap(why){
  if (!A || !A.wbHist || !A.P.proj || !A.P.proj.wb) return Promise.resolve(false);
  const pid = A.P.proj.id, wb = WB(), data = JSON.stringify(Object.assign({}, wb, {bin: []})); if (UI) UI.snapAt = Date.now();
  const v = {at: new Date().toISOString(), why, secs: wb.secs.length, rows: wb.secs.reduce((n, s) => n + s.rows.length, 0), grand: (UI && UI.X ? UI.X : calc()).grand, data};
  return (SNAPQ = SNAPQ.then(async () => { const rec = (await A.wbHist.get(pid)) || {}, L = Array.isArray(rec.list) ? rec.list : [];
    if (L.length && L[0].data === data) return false; L.unshift(v); await A.wbHist.put(pid, {wbh: true, pid, list: L.slice(0, MAXVER)}); return true; }).catch(() => false));
}
async function restoreWb(w, label){   // a workbook of the past in place of this one — this one kept first as a version; the bin and the revisions stay
  const ok = await A.ask("Restore the workbook?", `<p>Put back ${A.esc(label)} (${w.secs.length} section${w.secs.length === 1 ? "" : "s"}, ${w.secs.reduce((n, s) => n + s.rows.length, 0)} rows) in place of the workbook as it is now?</p><p class="small" style="margin-top:6px">The workbook as it is now is kept first as a version, so this can be taken back from Recover — or Ctrl+Z. What is in the bin and the revisions stay.</p>`, "Restore");
  if (!ok) return;
  await snap("before a restore");
  const cur = WB(), nw = norm(clone(w)), have = new Set(cur.revs.map(r => r.id));
  edit(() => { nw.bin = cur.bin; nw.revs = cur.revs.concat(nw.revs.filter(r => !have.has(r.id))).slice(-MAXREV); A.P.proj.wb = nw; });
  if (!secOf(UI.sec)) UI.sec = nw.secs[0] ? nw.secs[0].id : ""; UI.V = null; render();
  A.toast("Restored " + label, 2800);
}
async function recoverDialog(tab){
  const wb = WB(), pid = A.P.proj.id, when = t => A.dmyHm ? A.dmyHm(t) : A.dmy(t);
  const vers = A.wbHist ? (((await A.wbHist.get(pid).catch(() => null)) || {}).list || []) : [];
  const baks = !A.TEAM && A.wbBackups ? await A.wbBackups(pid).catch(() => []) : [];
  const B = wb.bin.slice().reverse();
  const binT = B.length ? `<div class="wbBA" style="margin-bottom:6px"><button class="btn sm pri" type="button" data-rall>&#9851; Recover all (${B.length})</button><button class="btn sm" type="button" data-rempty>Empty the bin</button></div>
      <div style="max-height:48vh;overflow:auto"><table class="sh"><thead><tr><th>Deleted</th><th>What</th><th></th></tr></thead><tbody>${B.map((e, i) => `<tr><td style="white-space:nowrap">${A.esc(when(e.at))}</td><td>${binLabel(e)}</td><td class="n"><button class="btn sm" type="button" data-rone="${i}">Recover</button></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="small">The bin is empty. Rows, sections, markups, columns, variables and revisions deleted from this workbook wait here, to be put back where they were.</p>';
  const verT = vers.length ? `<div style="max-height:44vh;overflow:auto"><table class="sh"><thead><tr><th>When</th><th>Kept</th><th class="n">Sections</th><th class="n">Rows</th><th class="n">Grand total</th><th></th></tr></thead><tbody>${vers.map((x, i) => `<tr><td style="white-space:nowrap">${A.esc(when(x.at))}</td><td>${A.esc(x.why || "")}</td><td class="n">${x.secs}</td><td class="n">${x.rows}</td><td class="n">${money(x.grand || 0)}</td><td class="n"><button class="btn sm" type="button" data-rver="${i}">Restore</button></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="small">No version kept yet.</p>';
  const bakT = baks.length ? `<div style="max-height:44vh;overflow:auto"><table class="sh"><thead><tr><th>Project backup</th><th></th></tr></thead><tbody>${baks.map(b => `<tr><td>${A.esc(when(b.at))}</td><td class="n"><button class="btn sm" type="button" data-rbak="${A.esc(b.id)}">Restore its workbook</button></td></tr>`).join("")}</tbody></table></div>`
    : '<p class="small">This project has no backup yet.</p>';
  const body = `<div id="wbRc"><div class="wbTabs"><button class="btn sm" type="button" data-tab="bin">Deleted (${B.length})</button><button class="btn sm" type="button" data-tab="ver">Versions (${vers.length})</button>${A.TEAM ? "" : `<button class="btn sm" type="button" data-tab="bak">Project backups (${baks.length})</button>`}</div>
    <div data-pg="bin">${binT}</div>
    <div data-pg="ver" hidden><p class="small">The whole workbook as it was — kept in this browser when it is opened, every 5 minutes while it is edited, when it is closed, and before Generate (start again) or a restore. Restore keeps the bin and the revisions; the workbook as it is now is kept first.</p><div class="wbBA" style="margin-bottom:6px"><button class="btn sm" type="button" data-rkeep>Keep a version now</button></div>${verT}</div>
    ${A.TEAM ? "" : `<div data-pg="bak" hidden><p class="small">The project's own backups (the last ${baks.length || 10} kept in this browser): the workbook alone is taken back from one — the drawings and the measurements stay as they are.</p>${bakT}</div>`}</div>`;
  const p = A.ask("Recover — " + (A.P.proj.name || "workbook"), body, "");
  const box = document.getElementById("wbRc"); if (!box) return p;
  const show = t => { box.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === t)); box.querySelectorAll("[data-pg]").forEach(d => { d.hidden = d.dataset.pg !== t; }); };
  show(tab || (B.length || !vers.length ? "bin" : "ver"));
  box.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tab) return show(b.dataset.tab);
    if (b.dataset.rone != null) { const en = B[+b.dataset.rone]; edit(() => { recoverEntry(en); }); A.toast("Recovered — put back where it was", 2200); return recoverDialog("bin"); }
    if (b.hasAttribute("data-rall")) { const n = WB().bin.length; edit(() => { const L = WB().bin; for (let i = L.length - 1; i >= 0; i--) recoverEntry(L[i]); }); if (A.ask.cur) A.ask.cur(null); return A.toast(n + " recovered — everything deleted is back where it was", 2800); }
    if (b.hasAttribute("data-rempty")) { const ok = await A.ask("Empty the bin?", `<p>Delete for good the ${WB().bin.length} things in the bin? They cannot be recovered from it after this (Ctrl+Z still brings them back while the workbook is open).</p>`, "Empty the bin"); if (ok) edit(() => { WB().bin = []; }); return recoverDialog("bin"); }
    if (b.dataset.rver != null) { const x = vers[+b.dataset.rver]; if (A.ask.cur) A.ask.cur(null); return restoreWb(JSON.parse(x.data), "the version of " + when(x.at) + (x.why ? " (" + x.why + ")" : "")); }
    if (b.hasAttribute("data-rkeep")) { const k = await snap("kept by hand"); A.toast(k ? "Kept as a version" : "No change since the newest version", 2000); return recoverDialog("ver"); }
    if (b.dataset.rbak) { b.disabled = true; A.busy("Reading the backup…"); let w = null; try { w = await A.wbOfBackup(b.dataset.rbak); } catch (er) { w = null; } finally { A.busy(""); }
      if (!w || !Array.isArray(w.secs) || !w.secs.length) { b.disabled = false; return A.toast("That backup has no workbook", 2400); }
      const at = (baks.find(x => x.id === b.dataset.rbak) || {}).at; if (A.ask.cur) A.ask.cur(null); return restoreWb(w, "the workbook of the backup of " + when(at)); }
  });
  return p;
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
    ${has ? '<div class="fg w2"><label>This workbook</label><select id="wgMode"><option value="merge">Update — keep every row and edit; add what was measured since; links of deleted conditions shown dead</option><option value="new">Start again — replace the whole workbook (its sections go to the bin: Recover, or Ctrl+Z, brings them back)</option></select></div>' : ""}</div>`;
  const v = await A.ask(first ? "Workbook — build it from the takeoff" : "Generate from takeoff", body, first ? "Build workbook" : "Generate", () => ({how: document.getElementById("wgHow").value, desc: document.getElementById("wgDesc").value === "lib", asm: document.getElementById("wgAsm").checked, mode: has ? document.getElementById("wgMode").value : "new"}));
  if (!v) { if (first && !WB().secs.length) { edit(() => { WB().secs.push({id: nid("S"), name: "Bill No. 1", rows: [newRow()]}); }); UI.sec = WB().secs[0].id; render(); } return; }
  const G = genRows(v.how, v.desc, v.asm);
  if (has && v.mode === "new") snap("before Generate — start again");
  edit(() => {
    const wb = WB();
    if (v.mode === "new") { wb.secs.forEach((s, i) => toBin({kind: "sec", s, i})); wb.secs = []; if (!wb.marks.length) wb.marks = MARK_PRE.slice(0, 2).map(([n, p]) => ({id: nid("M"), name: n, kind: "pct", e: String(p), base: "run"})); }
    const have = new Set(); wb.secs.forEach(s => s.rows.forEach(r => { if (r.src) have.add(r.src.cond + "|" + (r.src.asm || "")); }));
    let added = 0;
    G.forEach((rows, g) => { let s = wb.secs.find(x => x.name === g); if (!s) { s = {id: nid("S"), name: g, rows: []}; wb.secs.push(s); }
      rows.forEach(r => { const k = r.src.cond + "|" + (r.src.asm || ""); if (have.has(k)) return; s.rows.push(r); added++; }); });
    wb.gen = {at: new Date().toISOString(), how: v.how};
    UI.added = added;
  });
  UI.sec = WB().secs[0] ? WB().secs[0].id : ""; render(); snap(has ? "after Generate" : "built from the takeoff");
  A.toast(UI.added ? UI.added + " row" + (UI.added > 1 ? "s" : "") + " from the takeoff — quantities live-linked" : "Nothing new in the takeoff — every condition already has its row", 3200);
}

/* ------------------------------------------------------------------ the page */
function build(){
  const old = document.getElementById("wbRoot"); if (old) old.remove();
  const root = document.createElement("div"); root.id = "wbRoot"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Workbook");
  const B = (w, tip, h, cls) => `<button class="btn sm${cls ? " " + cls : ""}" data-w="${w}" title="${tip}">${h}</button>`;
  root.innerHTML = `<div class="wbHead"><b class="wbT">Workbook</b><span class="wbP"></span><span style="flex:1"></span><span class="wbTot"></span><button class="btn sm" data-w="close" title="Back to the drawing (the workbook is kept with the project)">&times; Close</button></div>
    <div class="wbBar">
      <span class="grpb" role="group" aria-label="Takeoff">${B("gen", "Build the workbook from the takeoff, or add what was measured since", "&#8635; Generate / update")}${B("lib", "Find a rate library item and add it (code, description, unit, rate)", "&#128214; Library")}${B("link", "Link the quantity to the takeoff (a condition's length, wall area, volume, area, perimeter or count)", "&#9939; Link qty")}</span>
      <span class="grpb" role="group" aria-label="Clipboard">${B("cut", "Cut (Ctrl+X) — pasted, the cells (or whole rows) move", "&#9986; Cut")}${B("copy", "Copy (Ctrl+C) — to Excel, or here with links and rate codes kept", "&#10697; Copy")}${B("paste", "Paste (Ctrl+V) — whole rows copied go in above the active row", "&#128203; Paste")}${B("pastev", "Paste values only (Ctrl+Shift+V) — links and formulas as plain figures", "Values")}</span>
      <span class="grpb" role="group" aria-label="Rows">${B("row", "Insert an item below (Ctrl+Enter) — Ctrl++ inserts one above", "+ Row")}${B("head", "Insert a heading below (Ctrl+Shift+Enter)", "+ Heading")}${B("note", "Insert a note line", "+ Note")}${B("del", "Delete the selected rows (Ctrl+−) — they wait in the bin: Recover", "Delete")}${B("up", "Move the rows up (Alt+↑) — or drag their numbers", "&#8593;")}${B("down", "Move the rows down (Alt+↓)", "&#8595;")}${B("out", "Heading one level up (Alt+←)", "&#8676;")}${B("in", "Heading one level down (Alt+→)", "&#8677;")}${B("dup", "Duplicate the rows (Ctrl+Shift+D)", "Duplicate")}${B("foldall", "Collapse every heading: the bill as its headings and their totals", "&#9656; All")}${B("unfoldall", "Expand every heading", "&#9662; All")}</span>
      <span class="grpb" role="group" aria-label="Columns">${B("colleft", "Move the selected columns left (Alt+Shift+←) — or drag a selected heading", "&#9664; Col")}${B("colright", "Move the selected columns right (Alt+Shift+→)", "Col &#9654;")}${B("colhide", "Hide the selected columns", "Hide")}${B("colshow", "Show every hidden column", "Show all")}${B("freeze", "Freeze the columns up to the active one — they stay as the sheet scrolls across (again: unfreeze)", "&#10052; Freeze")}${B("wrap", "Wrap the text of the description and the text columns", "&#8629; Wrap")}${B("cols", "Columns: order, shown or hidden, user columns, the material / labour / plant split", "Columns…")}</span>
      <span class="grpb" role="group" aria-label="Editing">${B("filldown", "Fill down (Ctrl+D): the top of the selection copied down it — the fill handle (drag the corner) makes a series", "&#8615; Fill")}${B("sortaz", "Sort A → Z by the active column (the items under each heading; the selected rows only, when several)", "A&#8594;Z")}${B("sortza", "Sort Z → A by the active column", "Z&#8594;A")}${B("find", "Find and replace (Ctrl+H)", "&#128269; Replace")}${B("goto", "Go to a ref, a code or a description (Ctrl+G)", "Go to")}</span>
      <span class="grpb" role="group" aria-label="Review">${B("vars", "Workbook variables used in formulas (WASTE = 1.05)", "Variables")}${B("rev", "Keep the workbook's figures as a revision; compare with one", "Revisions")}<select class="wbCmp" title="Compare with a revision"></select>${B("check", "Dead links, unpriced or unmeasured items, formula errors", "Check")}${B("recover", "Recover: what was deleted (one, or all at once), earlier versions of the workbook, a project backup's workbook", "&#9851; Recover")}${B("xls", "The workbook in Excel — Summary and a sheet per section, live formulas, your column order", "Export Excel", "pri")}</span>
      <span style="flex:1"></span><input type="search" class="wbQ" placeholder="Find code or description (Ctrl+F)" aria-label="Find in the workbook"><select class="wbF" aria-label="Show"><option value="all">All rows</option><option value="unpriced">Unpriced</option><option value="unmeasured">No quantity</option><option value="linked">Linked to takeoff</option><option value="typed">Typed quantity</option><option value="issue">With a problem</option><option value="changed">Changed since revision</option></select>
      ${B("pane", "Show / hide the row's details", "Details")}</div>
    <div class="wbFx"><input type="text" class="wbNm" aria-label="Name box — the active cell; type a ref (2.15) or a code and press Enter to go there" title="The active cell — type a ref (2.15), a code or words and press Enter to go there"><span class="wbFxL" aria-hidden="true">fx</span><input type="text" class="wbFxI" aria-label="The active cell's content — type and press Enter" title="What the active cell holds: a figure, a formula as typed (=2*3*WASTE), a link or a rate's source in words"></div>
    <div class="wbMain"><nav class="wbTree" aria-label="Sections"></nav><div class="wbGridW" tabindex="0"><div class="wbGrid"></div><div class="wbMk" hidden></div></div><aside class="wbPane"></aside></div>
    <div class="wbFoot"><span class="wbFi"></span><span class="wbSt" aria-live="polite"></span><span class="wbZm"><button class="rn" data-w="zout" title="Zoom out (Ctrl+wheel)">&minus;</button><button class="rn wbZv" data-w="z100" title="Back to 100 %">100 %</button><button class="rn" data-w="zin" title="Zoom in (Ctrl+wheel)">+</button></span></div>`;
  document.body.appendChild(root);
  root.addEventListener("click", onClick); root.addEventListener("mousedown", onDown); root.addEventListener("dblclick", onDbl); root.addEventListener("contextmenu", onCtx);
  const gw = root.querySelector(".wbGridW");
  gw.addEventListener("wheel", e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoom(e.deltaY < 0 ? 10 : -10); }, {passive: false});
  gw.addEventListener("scroll", () => { if (UI && UI.menu) menuOff(); });
  root.querySelector(".wbQ").addEventListener("input", e => { UI.q = e.target.value; render(true); });
  root.querySelector(".wbF").addEventListener("change", e => { UI.flt = e.target.value; render(true); });
  root.querySelector(".wbCmp").addEventListener("change", e => { UI.cmp = e.target.value; render(true); });
  root.querySelector(".wbNm").addEventListener("focus", e => e.target.select());
  window.removeEventListener("keydown", onKey, true); ["copy", "cut", "paste"].forEach(t => document.removeEventListener(t, t === "paste" ? onPaste : onCopy, true));   // (opened again over itself: one listener each)
  window.addEventListener("keydown", onKey, true); document.addEventListener("copy", onCopy, true); document.addEventListener("cut", onCopy, true); document.addEventListener("paste", onPaste, true);
}
const $w = s => document.querySelector("#wbRoot " + s);
const money = v => A.f2(v);
const qShow = (v, u) => v == null ? "" : A.fq(v, u);
const rShow = (v, u) => v == null ? "" : A.f2(A.uR(v, u));
const focusGrid = () => { const g = $w(".wbGridW"); if (g) g.focus({preventScroll: true}); };
const colW = k => { const w = WB().view.w[k]; return w > 0 ? w : WIDTH[k] || (k.startsWith("u:") ? 130 : 110); };
function colsBase(){   // the section sheet's columns as they come: Ref … Total, the split, the user columns, the revision compared with
  const wb = WB(), C = [{k: "ref", t: "Ref", ro: true}, {k: "code", t: "Code"}, {k: "desc", t: "Description"}, {k: "qty", t: "Quantity", n: true}, {k: "unit", t: "Unit"}, {k: "rate", t: "Rate", n: true}, {k: "tot", t: "Total PKR", n: true, ro: true}];
  if (wb.view.split) [["sM", "Material"], ["sL", "Labour"], ["sP", "Plant"], ["sO", "OH, profit, other"]].forEach(([k, t]) => C.push({k, t, n: true, ro: true}));
  wb.cols.forEach(c => C.push({k: "u:" + c.id, t: c.name || "Column", n: c.kind === "num", u: c}));
  if (UI && UI.cmp && revOf(UI.cmp)) [["pq", "Prev qty"], ["pr", "Prev rate"], ["pt", "Prev total"], ["dv", "Variance"]].forEach(([k, t]) => C.push({k, t, n: true, ro: true}));
  return C;
}
function arrange(C){   // columns in the workbook's order — one not in it (new since) goes after the one it comes after by default
  const o = WB().view.order; if (!o.length) return C;
  const out = C.filter(c => o.includes(c.k)).sort((a, b) => o.indexOf(a.k) - o.indexOf(b.k));
  C.forEach((c, i) => { if (o.includes(c.k)) return; let j = i - 1; while (j >= 0 && !out.includes(C[j])) j--; out.splice(j < 0 ? 0 : out.indexOf(C[j]) + 1, 0, c); });
  return out;
}
const colsAll = () => arrange(colsBase());
function cols(){ const h = WB().view.hide, C = colsAll(), V = C.filter(c => !h.includes(c.k)); return V.length ? V : C; }
const revOf = id => WB().revs.find(r => r.id === id) || null;
function visRows(s, X){   // the rows shown: the find text and the filter — with neither, every row but those under a collapsed heading
  const q = UI.q.trim().toLowerCase(), rv = UI.cmp ? revOf(UI.cmp) : null, plain = !q && UI.flt === "all", out = []; let hid = null, fh = null; UI.foldN = new Map();
  const keep = r => {
    if (q && !(String(r.code || "") + " " + String(r.desc || "")).toLowerCase().includes(q)) return false;
    if (UI.flt === "all") return true; if (r.t !== "item") return false;
    const x = X.R.get(r.id); if (!x) return false;
    if (UI.flt === "unpriced") return !(x.r.v > 0);
    if (UI.flt === "unmeasured") return !(x.q.v > 0);
    if (UI.flt === "linked") return !!x.q.links;
    if (UI.flt === "typed") return !x.q.links;
    if (UI.flt === "issue") return !!(x.q.err || x.q.dead || x.r.err || x.q.mis || !(x.q.v > 0) || !(x.r.v > 0));
    if (UI.flt === "changed") { const p = rv && rv.rows[r.id]; return !p || Math.abs(p[2] - x.t) > 0.005 || Math.abs(p[0] - (x.q.v || 0)) > 1e-6; }
    return true; };
  s.rows.forEach(r => {
    if (hid != null) { if (r.t === "head" && r.lvl <= hid) hid = null; else { UI.foldN.set(fh.id, (UI.foldN.get(fh.id) || 0) + 1); return; } }
    if (!keep(r)) return; out.push(r);
    if (plain && r.t === "head" && r.fold) { hid = r.lvl; fh = r; } });
  return out;
}
function render(keepPane){
  if (!UI) return; const wb = WB(), X = calc(); UI.X = X; UI.memo = {v: new Map()};
  $w(".wbP").textContent = "— " + (A.P.proj.name || "project") + (wb.gen ? " · generated " + A.dmy(wb.gen.at) : "");
  $w(".wbTot").innerHTML = `Net <b>${money(X.net)}</b> · Grand total <b>PKR ${money(X.grand)}</b>`;
  const cmp = $w(".wbCmp"); cmp.innerHTML = `<option value="">Compare with…</option>` + wb.revs.map(r => `<option value="${A.esc(r.id)}"${r.id === UI.cmp ? " selected" : ""}>${A.esc(r.name)} — ${A.dmy(r.at)}</option>`).join("");
  // the tree: Summary, then the sections with their totals
  $w(".wbTree").innerHTML = `<button class="wbS${UI.sec === "" ? " on" : ""}" data-sec=""><span>Summary</span><b>${money(X.grand)}</b></button>` +
    wb.secs.map((s, i) => `<button class="wbS${UI.sec === s.id ? " on" : ""}" data-sec="${A.esc(s.id)}" title="Double-click to rename — drop rows dragged by their numbers here to move them into it"><span>${i + 1}. ${A.esc(s.name)}</span><b>${money(X.S.get(s.id).t)}</b></button>`).join("") +
    `<div class="wbTA"><button class="btn sm" data-w="addsec">+ Section</button><button class="btn sm" data-w="secup" title="Move the section up">&#8593;</button><button class="btn sm" data-w="secdn" title="Move the section down">&#8595;</button><button class="btn sm dng" data-w="secdel" title="Delete the section (it waits in the bin: Recover)">&times;</button></div>`;
  const s = secOf(UI.sec);
  if (!s) { UI.sec = ""; renderSummary(X); } else renderSheet(s, X);
  if (!keepPane || !UI.paneOpen) renderPane();
  $w(".wbPane").hidden = !UI.pane; $w(".wbMain").classList.toggle("np", !UI.pane);
  const v = wb.view, issues = checkList(X).length, bin = wb.bin.length;
  $w('[data-w="freeze"]').classList.toggle("on", v.freeze > 0); $w('[data-w="wrap"]').classList.toggle("on", v.wrap); $w('[data-w="colshow"]').disabled = !v.hide.length;
  $w('[data-w="recover"]').innerHTML = "&#9851; Recover" + (bin ? ` <span class="wbBadge">${bin}</span>` : "");
  $w(".wbFi").innerHTML = (s ? `${s.rows.filter(r => r.t === "item").length} items in ${A.esc(s.name)} · ` : "") + `${wb.secs.length} sections · ${issues ? `<a href="#" data-w="check" style="color:var(--red)">${issues} to check</a>` : "nothing to check"}${v.hide.length ? ` · <a href="#" data-w="colshow">${v.hide.length} column${v.hide.length > 1 ? "s" : ""} hidden</a>` : ""} · <span class="small">Right-click for more · drag a selected column heading or row number to move it · Ctrl+C / Ctrl+V with Excel · Ctrl+Z</span>`;
  applyZoom(); paintSel();
}
function renderSheet(s, X){
  const old = UI.V, oc = old && old[UI.ri], oa = UI.anc && old && old[UI.anc.ri];   // the active row stays the active one, wherever it went
  const C = cols(), V = visRows(s, X), si = WB().secs.indexOf(s) + 1, rv = UI.cmp ? revOf(UI.cmp) : null, vw = WB().view; UI.V = V; UI.C = C; UI.painted = []; UI.fh = null; UI.ha = null;
  if (oc && V.includes(oc)) UI.ri = V.indexOf(oc); if (oa && V.includes(oa)) UI.anc.ri = V.indexOf(oa);
  if (UI.ri >= V.length) UI.ri = Math.max(0, V.length - 1); if (!C.some(c => c.k === UI.ck)) UI.ck = (C.find(c => c.k === "desc") || C[0]).k;
  if (UI.anc && (UI.anc.ri >= V.length || !C.some(c => c.k === UI.anc.ck))) { UI.anc = null; UI.full = null; }
  let n = 0; const ref = UI.ref = new Map(), pos = new Map(); s.rows.forEach((r, i) => { pos.set(r, i); if (r.t === "item") ref.set(r.id, si + "." + (++n)); });
  const fz = Math.min(vw.freeze, C.length), fzc = ci => ci < fz ? " fz" + (ci === fz - 1 ? " fzl" : "") : "", fzs = ci => ci < fz ? ` style="left:var(--l${ci})"` : "";
  const cell = (r, c, i, ci) => {
    const x = X.R.get(r.id) || {}, cls = [c.n ? "n" : "tx", c.ro ? "ro" : ""];
    let h = "", tip = "";
    if (r.t === "head") { if (c.k === "desc") h = `<button class="fo" type="button" data-fold="${A.esc(r.id)}" aria-expanded="${!r.fold}" title="${r.fold ? "Expand" : "Collapse"} the rows under this heading">${r.fold ? "&#9656;" : "&#9662;"}</button><b>${A.esc(r.desc || "")}</b>${r.fold ? `<span class="wbFold">${UI.foldN.get(r.id) || 0} rows</span>` : ""}`; else if (c.k === "code") h = A.esc(r.code || ""); else if (c.k === "tot") h = `<b>${money(x.t || 0)}</b>`; else if (c.k.startsWith("u:")) h = A.esc((r.u || {})[c.k.slice(2)] || ""); }
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
    return `<td class="${cls.join(" ")}${fzc(ci)}" data-ck="${c.k}" data-ri="${i}"${fzs(ci)}${tip ? ` title="${A.esc(tip)}"` : ""}>${h}</td>`;
  };
  const rowsH = V.map((r, i) => `<tr class="${r.t}${r.col ? " c-" + r.col : ""}" data-ri="${i}" style="--lv:${r.lvl || 0}"><td class="gut" data-gi="${i}">${pos.get(r) + 1}</td>${C.map((c, ci) => cell(r, c, i, ci)).join("")}</tr>`).join("");
  const st = X.S.get(s.id), lab = C.some(c => c.k === "desc") ? "desc" : C[0].k, pt = rv ? rv.secs[s.id] : null, d = st.t - (pt || 0);
  const ft = c => c.k === lab ? `<b>Total ${A.esc(s.name)}</b>` : c.k === "tot" ? `<b>${money(st.t)}</b>` : c.k[0] === "s" && c.k.length === 2 ? money(st.split["MLPO".indexOf(c.k[1])]) : c.k.startsWith("u:") ? (c.n && st.user[c.k.slice(2)] != null ? A.f2(st.user[c.k.slice(2)]) : "")
    : rv && c.k === "pt" ? (pt != null ? money(pt) : "") : rv && c.k === "dv" ? (Math.abs(d) < 0.005 ? "" : (d > 0 ? "+" : "") + money(d)) : "";
  const foot = `<tr class="tot"><td class="gut"></td>${C.map((c, ci) => `<td class="${c.n ? "n" : ""}${c.k === "dv" ? (d > 0.005 ? " up" : d < -0.005 ? " dn" : "") : ""}${fzc(ci)}"${fzs(ci)}>${ft(c)}</td>`).join("")}</tr>`;
  const tw = UI.tw = WIDTH.gut + C.reduce((t, c) => t + colW(c.k), 0);
  $w(".wbGrid").innerHTML = `<table class="wbT2 wbSh${vw.wrap ? " wrap" : ""}" style="width:max(100%, ${tw}px)"><colgroup><col style="width:${WIDTH.gut}px">${C.map(c => `<col data-k="${A.esc(c.k)}"${c.k === "desc" && !vw.w.desc ? "" : ` style="width:${colW(c.k)}px"`}>`).join("")}</colgroup>
    <thead><tr><th class="gut" title="Select all (Ctrl+A)"></th>${C.map((c, ci) => `<th class="${c.n ? "n" : ""}${fzc(ci)}" data-hk="${A.esc(c.k)}" data-ci="${ci}"${fzs(ci)} title="${A.esc(c.t)} — click: select the column, then its ◀ ▶ (or a drag of the heading) move it left or right · drag its edge to resize · right-click: sort, move, hide, freeze">${A.esc(c.t)}<span class="rz" data-rz="${A.esc(c.k)}"></span></th>`).join("")}</tr></thead>
    <tbody>${rowsH || `<tr><td class="gut"></td><td colspan="${C.length}" class="wbE">${UI.q || UI.flt !== "all" ? "No row matches." : "This section is empty — + Row, or Library to add an item."}</td></tr>`}</tbody><tfoot>${foot}</tfoot></table>`;
  if (fz) { const t = $w(".wbSh"), th = t.tHead.rows[0].cells; let x = th[0].offsetWidth; for (let i = 0; i < fz; i++) { t.style.setProperty("--l" + i, x + "px"); x += th[i + 1].offsetWidth; } $w(".wbGridW").style.scrollPaddingLeft = x + "px"; }
  else $w(".wbGridW").style.scrollPaddingLeft = WIDTH.gut + "px";
}
function renderSummary(X){
  const wb = WB(), C = [{k: "ref"}, {k: "code"}, {k: "desc"}, {k: "tot"}, {k: "pct"}]; UI.V = []; UI.C = C;
  const rv = UI.cmp ? revOf(UI.cmp) : null;
  const sec = wb.secs.map((s, i) => { const t = X.S.get(s.id).t, p = rv ? rv.secs[s.id] : null, d = rv ? t - (p || 0) : 0;
    return `<tr class="sumr" data-open="${A.esc(s.id)}"><td>${i + 1}</td><td>${A.esc(s.code || "")}</td><td><a href="#" data-open="${A.esc(s.id)}">${A.esc(s.name)}</a></td><td class="n">${money(t)}</td><td class="n">${X.net ? (t / X.net * 100).toFixed(1) + " %" : ""}</td>${rv ? `<td class="n">${p != null ? money(p) : "new"}</td><td class="n ${d > 0.005 ? "up" : d < -0.005 ? "dn" : ""}">${Math.abs(d) < 0.005 ? "" : (d > 0 ? "+" : "") + money(d)}</td>` : ""}</tr>`; }).join("");
  const mk = X.M.map(({m, v, err}, i) => `<tr class="mk"><td></td><td><select data-mk="${i}" data-mf="kind"><option value="pct"${m.kind !== "sum" ? " selected" : ""}>%</option><option value="sum"${m.kind === "sum" ? " selected" : ""}>Lump sum</option></select></td>
    <td><input type="text" data-mk="${i}" data-mf="name" value="${A.esc(m.name)}" aria-label="Markup name"> ${m.kind !== "sum" ? `<input type="text" data-mk="${i}" data-mf="e" value="${A.esc(m.e)}" style="width:70px" aria-label="Percent"> % of <select data-mk="${i}" data-mf="base"><option value="run"${m.base !== "net" ? " selected" : ""}>the running total</option><option value="net"${m.base === "net" ? " selected" : ""}>the net</option></select>` : `<input type="text" data-mk="${i}" data-mf="e" value="${A.esc(m.e)}" style="width:110px" aria-label="Amount"> PKR`}${err ? ` <span style="color:var(--red)">${A.esc(err)}</span>` : ""}</td>
    <td class="n">${money(v)}</td><td><button class="rn" data-mkdel="${i}" title="Remove (it waits in the bin: Recover)">&times;</button></td></tr>`).join("");
  $w(".wbGrid").innerHTML = `<table class="wbT2 sum"><colgroup><col style="width:44px"><col style="width:110px"><col><col style="width:150px"><col style="width:${rv ? 150 : 90}px">${rv ? '<col style="width:150px"><col style="width:130px">' : ""}</colgroup><thead><tr><th>#</th><th>Code</th><th>Section</th><th class="n">Total PKR</th><th class="n">% of net</th>${rv ? '<th class="n">Prev total</th><th class="n">Variance</th>' : ""}</tr></thead><tbody>${sec || `<tr><td colspan="5" class="wbE">No sections yet — Generate / update builds them from the takeoff.</td></tr>`}
    <tr class="tot"><td></td><td></td><td><b>Net total</b></td><td class="n"><b>${money(X.net)}</b></td><td class="n">100 %</td>${rv ? `<td class="n">${money(rv.net)}</td><td></td>` : ""}</tr>${mk}
    <tr class="mk"><td></td><td colspan="4"><button class="btn sm" data-w="addmk">+ Markup</button> ${MARK_PRE.map(([n, p]) => `<button class="btn sm" data-mkpre="${A.esc(n)}|${p}">${A.esc(n)} ${p} %</button>`).join(" ")}</td></tr>
    <tr class="tot grand"><td></td><td></td><td><b>Grand total</b></td><td class="n"><b>PKR ${money(X.grand)}</b></td><td></td>${rv ? `<td class="n">${money(rv.grand)}</td><td class="n">${(X.grand - rv.grand > 0 ? "+" : "") + money(X.grand - rv.grand)}</td>` : ""}</tr></tbody></table>
    <p class="small" style="margin:10px 4px">Click a section to open it. Markups are applied in order: a % of the running total (or of the net), or a lump sum.</p>`;
  $w(".wbGrid").querySelectorAll("[data-mk]").forEach(el => el.addEventListener("change", () => { const i = +el.dataset.mk, f = el.dataset.mf; edit(() => { WB().marks[i][f] = el.value; }); }));
}

/* ------------------------------------------------------------------ the selection: a range of cells, whole rows or whole columns */
function rng(){   // → rows r0…r1 of those shown, columns c0…c1, n cells
  const C = UI.C || [], V = UI.V || [], ix = k => Math.max(0, C.findIndex(c => c.k === k)), a = UI.anc || {ri: UI.ri, ck: UI.ck};
  let r0 = Math.min(a.ri, UI.ri), r1 = Math.max(a.ri, UI.ri), c0 = Math.min(ix(a.ck), ix(UI.ck)), c1 = Math.max(ix(a.ck), ix(UI.ck));
  if (UI.full === "row" || UI.full === "all") { c0 = 0; c1 = C.length - 1; } if (UI.full === "col" || UI.full === "all") { r0 = 0; r1 = V.length - 1; }
  r1 = Math.min(r1, V.length - 1); r0 = Math.max(0, Math.min(r0, r1));
  return {r0, r1, c0, c1, n: Math.max(0, r1 - r0 + 1) * Math.max(0, c1 - c0 + 1)};
}
const selRows = () => { const R = rng(); return (UI.V || []).slice(R.r0, R.r1 + 1); };
function curRow(){ return UI.V && UI.V[UI.ri] ? UI.V[UI.ri] : null; }
function paintSel(noScroll){   // the selection drawn on the sheet as it is (no redraw): range, active cell, headings, row numbers, the fill handle
  if (!UI) return; UI.painted.forEach(([el, c]) => el.classList.remove(...c)); UI.painted = []; if (UI.fh) { UI.fh.remove(); UI.fh = null; } if (UI.ha) { UI.ha.remove(); UI.ha = null; }
  const t = $w(".wbSh"), V = UI.V || [], C = UI.C || []; fxShow();
  if (!t || !V.length || !C.length) return stat(null);
  const R = rng(), body = t.tBodies[0], hs = t.tHead.rows[0].cells, ci = C.findIndex(c => c.k === UI.ck), add = (el, ...c) => { if (el) { el.classList.add(...c); UI.painted.push([el, c]); } };
  for (let i = R.r0; i <= R.r1; i++) { const tr = body.rows[i]; if (!tr) continue; add(tr.cells[0], "hs");
    for (let j = R.c0; j <= R.c1; j++) { const c = ["rs"]; if (i === R.r0) c.push("rT"); if (i === R.r1) c.push("rB"); if (j === R.c0) c.push("rL"); if (j === R.c1) c.push("rR"); add(tr.cells[j + 1], ...c); } }
  for (let j = R.c0; j <= R.c1; j++) add(hs[j + 1], "hs");
  if (UI.full === "col" && hs[ci + 1]) {   // a picked column's heading: ◀ ▶ move it (the columns picked) left or right
    const a = document.createElement("span"); a.className = "wbHa" + (C[ci].n ? " l" : "");
    a.innerHTML = `<button type="button" data-w="colleft" title="Move left (Alt+Shift+←) — or drag the heading"${R.c0 === 0 ? " disabled" : ""}>&#9664;</button><button type="button" data-w="colright" title="Move right (Alt+Shift+→) — or drag the heading"${R.c1 >= C.length - 1 ? " disabled" : ""}>&#9654;</button>`;
    hs[ci + 1].appendChild(a); UI.ha = a; }
  const act = body.rows[UI.ri] && body.rows[UI.ri].cells[ci + 1]; add(act, "act");
  if (CLIP && CLIP.cut && CLIP.sec === UI.sec) { const ids = new Set(CLIP.ids); V.forEach((r, i) => { if (!ids.has(r.id)) return; const tr = body.rows[i];
    if (CLIP.rows) add(tr.cells[0], "cut"); else CLIP.cks.forEach(k => { const j = C.findIndex(c => c.k === k); if (j >= 0) add(tr.cells[j + 1], "cut"); }); }); }
  if (!UI.full && !UI.edit) { const fc = body.rows[R.r1] && body.rows[R.r1].cells[R.c1 + 1]; if (fc) { add(fc, "fh"); const h = document.createElement("span"); h.className = "wbFh"; h.title = "Drag to fill down or up — numbers and codes like A-1 go on as a series (Ctrl: copies)"; fc.appendChild(h); UI.fh = h; } }
  if (act && !noScroll && !UI.edit) act.scrollIntoView({block: "nearest", inline: "nearest"});
  if (curRow() !== UI.paneRow && !UI.paneOpen) renderPane();
  stat(R);
}
function numOf(r, k, X){   // an item's figure as shown (null: none)
  if (!r || r.t !== "item") return null; const x = X.R.get(r.id); if (!x) return null;
  if (k === "qty") return x.q.v == null ? null : A.uV(x.q.v, r.unit);
  if (k === "rate") return x.r.v ? A.uR(x.r.v, r.unit) : null;
  if (k === "tot") return x.t || 0;
  if (k.length === 2 && k[0] === "s") return x.sp ? x.sp["MLPO".indexOf(k[1])] : null;
  if (k.startsWith("u:")) { const c = WB().cols.find(c => "u:" + c.id === k); return c && c.kind === "num" ? val((r.u || {})[c.id], X.vars).v : null; }
  const rv = UI && UI.cmp ? revOf(UI.cmp) : null, p = rv && rv.rows[r.id];
  if (k === "pq") return p ? A.uV(p[0], r.unit) : null; if (k === "pr") return p ? A.uR(p[1], r.unit) : null; if (k === "pt") return p ? p[2] : null; if (k === "dv") return rv ? (x.t || 0) - (p ? p[2] : 0) : null;
  return null;
}
function plainOf(r, k, X){   // a cell as plain text, as Excel reads it: figures unformatted
  const x = X.R.get(r.id) || {};
  if (k === "ref") return UI.ref.get(r.id) || ""; if (k === "unit") return r.t === "item" && r.unit ? A.uL(r.unit) : "";
  if (k === "tot") return r.t !== "note" && x.t != null ? String(+(+x.t).toFixed(2)) : "";
  if (k === "code" || k === "desc") return r.t === "note" && k === "code" ? "" : String(r[k] || "");
  if (k.startsWith("u:") && r.t !== "note") { const c = WB().cols.find(c => "u:" + c.id === k), v = String((r.u || {})[k.slice(2)] || ""); return c && c.kind === "num" && NUMS.test(v.trim()) ? String(+v.replace(/,/g, "")) : v; }
  const v = numOf(r, k, X); return v == null || !isFinite(v) ? "" : String(+v.toFixed(k === "qty" ? 6 : k === "rate" || k === "pr" || k === "pq" ? 4 : 2));
}
function stat(R){   // the status bar, as Excel's: the selection's average, count and sum (items' figures)
  const el = $w(".wbSt"); if (!el) return; if (!R || R.n < 2) { el.innerHTML = ""; return; }
  let n = 0, cnt = 0, sum = 0, mn = Infinity, mx = -Infinity; const X = UI.X;
  for (let i = R.r0; i <= R.r1; i++) { const r = UI.V[i]; for (let j = R.c0; j <= R.c1; j++) { const k = UI.C[j].k, v = numOf(r, k, X);
    if (v != null && isFinite(v)) { n++; cnt++; sum += v; mn = Math.min(mn, v); mx = Math.max(mx, v); } else if (plainOf(r, k, X) !== "") cnt++; } }
  el.innerHTML = n ? `Average <b>${A.f2(sum / n)}</b> · Count <b>${cnt}</b> · Sum <b>${A.f2(sum)}</b> · Min <b>${A.f2(mn)}</b> · Max <b>${A.f2(mx)}</b>` : `Count <b>${cnt}</b>`;
}
function fxShow(){   // the name box and the formula bar: the active cell, and what it holds (a formula as typed; a link or a rate's source in words)
  const nm = $w(".wbNm"), fx = $w(".wbFxI"); if (!nm || !fx) return; const ae = document.activeElement, s = secOf(UI.sec), r = curRow(), c = (UI.C || []).find(x => x.k === UI.ck);
  if (!s || !r || !c) { if (ae !== nm) nm.value = nm.dataset.v = s ? "" : "Summary"; if (ae !== fx) { fx.value = ""; fx.readOnly = true; } return; }
  const R = rng(), x = UI.X.R.get(r.id) || {};
  if (ae !== nm) nm.value = nm.dataset.v = (UI.ref.get(r.id) || "Row " + (s.rows.indexOf(r) + 1)) + " · " + c.t + (R.n > 1 ? "  (" + (R.r1 - R.r0 + 1) + "R × " + (R.c1 - R.c0 + 1) + "C)" : "");
  if (ae === fx) return;
  let v = "", ro = true;
  if (r.t === "item" && c.k === "qty" && Array.isArray(r.qb) && r.qb.length) v = (x.q.links ? "⛓ " : "Σ ") + r.qb.map(l => (l.link ? linkOf(l.link, UI.memo).name : (l.desc ? l.desc + " " : "") + (l.e || "")) + (l.x && l.x !== "1" ? " × " + l.x : "")).join("  +  ") + "   — Details to change it";
  else if (r.t === "item" && c.k === "rate" && r.rb) v = "Σ Rate build-up of " + (r.rb.lines || []).length + " resources — Details to change it";
  else if (r.t === "item" && c.k === "rate" && String(r.ra || "").trim()) v = "RA " + r.ra + " — " + (x.r.err || x.r.src || "");
  else if (c.k === "tot") v = r.t === "item" ? "= Quantity × Rate = " + money(x.t || 0) : r.t === "head" ? "= the items under this heading = " + money(x.t || 0) : "";
  else if (editable(c.k) && fits(r, c.k)) { v = rawOf(r, c.k); ro = false; }
  else v = plainOf(r, c.k, UI.X);
  fx.value = v; fx.readOnly = ro;
}
function moveSel(dr, dc){
  const C = UI.C || [], V = UI.V || []; if (!V.length) return; let ci = C.findIndex(c => c.k === UI.ck);
  UI.ri = Math.max(0, Math.min(V.length - 1, UI.ri + dr)); ci = Math.max(0, Math.min(C.length - 1, ci + dc)); UI.ck = C[ci] ? C[ci].k : "desc";
  paintSel();
}
function selAll(){ if (!(UI.V || []).length) return; UI.anc = {ri: 0, ck: UI.C[0].k}; UI.full = "all"; paintSel(true); }
function selRow(){ UI.anc = {ri: UI.anc ? UI.anc.ri : UI.ri, ck: UI.ck}; UI.full = "row"; paintSel(true); }
function selCol(){ UI.anc = {ri: 0, ck: UI.anc ? UI.anc.ck : UI.ck}; UI.full = "col"; paintSel(true); }
function selectRows(rows, full){   // rows (of those shown) made the selection
  const V = UI.V || [], a = V.indexOf(rows[0]), b = V.indexOf(rows[rows.length - 1]); if (a < 0) return paintSel();
  UI.full = full === undefined ? UI.full : full; UI.anc = {ri: a, ck: UI.C[0].k}; UI.ri = b < 0 ? a : b; if (!UI.full) UI.anc.ck = UI.ck; paintSel();
}
function show(s, r, ck){   // a row made the active one: its section opened, the find text and the filter cleared, the headings over it expanded
  UI.sec = s.id; UI.q = ""; UI.flt = "all"; $w(".wbQ").value = ""; $w(".wbF").value = "all"; unfoldTo(s, r);
  UI.V = null; render(); UI.ri = Math.max(0, UI.V.indexOf(r)); if (ck) UI.ck = ck; UI.anc = null; UI.full = null; paintSel(); focusGrid();
}
function unfoldTo(s, r){ let lv = r.t === "head" ? r.lvl : Infinity; for (let j = s.rows.indexOf(r) - 1; j >= 0 && lv > 0; j--) { const h = s.rows[j]; if (h.t !== "head" || h.lvl >= lv) continue; delete h.fold; lv = h.lvl; } }
function fold(id, on){   // a heading's rows collapsed under it (or shown again) — a view of the bill, not an undo step
  const s = secOf(UI.sec), r = s && s.rows.find(x => x.id === id); if (!r || r.t !== "head") return;
  if (on == null ? !r.fold : on) r.fold = true; else delete r.fold; A.save(); const cur = curRow(); render(true);
  if (cur && UI.V.indexOf(cur) < 0) { UI.ri = Math.max(0, UI.V.indexOf(r)); UI.anc = null; UI.full = null; paintSel(); }
}

/* ------------------------------------------------------------------ the details pane: the active row's quantity, rate, note */
function renderPane(){
  const P = $w(".wbPane"); UI.paneOpen = false; if (!P) return;
  const r = curRow(), s = secOf(UI.sec); UI.paneRow = r;
  if (!s) { P.innerHTML = `<h4>Summary</h4><p class="small">The sections' totals, then the markups down to the grand total. Workbook variables: ${WB().vars.length ? WB().vars.map(v => A.esc(v.name)).join(", ") : "none"} <button class="rn" data-w="vars">&#9998;</button></p>`; return; }
  if (!r) { P.innerHTML = '<p class="small">Pick a row.</p>'; return; }
  if (r.t !== "item") { P.innerHTML = `<h4>${r.t === "head" ? "Heading" : "Note"}</h4><p class="small">${r.t === "head" ? "Its total is the items under it, down to the next heading of its level. Alt+← / Alt+→ changes its level; the arrow before it collapses its rows (a collapsed heading moves, copies and is deleted with them)." : "A line of text in the bill."}</p>`; return; }
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

/* ------------------------------------------------------------------ cells: what is typed, read, copied and filled */
const editable = ck => ["code", "desc", "qty", "unit", "rate"].includes(ck) || ck.startsWith("u:");
const fits = (r, ck) => r.t === "item" ? editable(ck) : r.t === "head" ? ck === "code" || ck === "desc" || ck.startsWith("u:") : ck === "desc";   // a heading has no quantity, a note is its text
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
function cellGet(r, ck){   // a cell whole: a linked or broken-down quantity, a Rate Analysis or built-up rate go with it when copied or filled
  if (r.t === "item" && ck === "qty" && Array.isArray(r.qb) && r.qb.length) return {qb: clone(r.qb), unit: r.unit};
  if (r.t === "item" && ck === "rate" && r.rb) return {rb: clone(r.rb), rbm: r.rbm};
  if (r.t === "item" && ck === "rate" && String(r.ra || "").trim()) return {ra: r.ra};
  return {raw: rawOf(r, ck), plain: true};
}
function cellPut(r, ck, p){
  if (!p || !fits(r, ck)) return; if (p.plain) return setCell(r, ck, p.raw);
  if (p.qb) { r.qb = clone(p.qb).map(l => Object.assign(l, {id: nid("Q")})); r.qe = ""; delete r.qm; if (!r.unit && p.unit) r.unit = p.unit; }
  else if (p.rb) { delete r.ra; r.re = ""; r.rb = clone(p.rb); r.rbm = p.rbm; }
  else if (p.ra) { delete r.rb; r.re = ""; r.ra = p.ra; }
}
function startEdit(ch, f2){   // a cell opened for typing: by a key typed (it replaces the cell), Enter (all of it selected) or F2 / double-click (the caret at its end)
  const r = curRow(); if (!r || !editable(UI.ck) || !fits(r, UI.ck)) return;
  const td = $w(".wbSh td.act"); if (!td) return;
  const linked = UI.ck === "qty" && Array.isArray(r.qb) && r.qb.length, ra = UI.ck === "rate" && (r.ra || r.rb);
  if ((linked || ra) && ch == null) { UI.pane = true; render(); const f = $w(".wbPane input, .wbPane select"); if (f) f.focus(); return A.toast(linked ? "A linked / broken-down quantity — edit its lines here, or type a figure over it to replace it" : "Its rate comes from " + (r.ra ? "Rate Analysis " + r.ra : "its build-up") + " — change it here, or type a rate over it", 3200); }
  if (UI.fh) { UI.fh.remove(); UI.fh = null; }
  const inp = document.createElement("input"); inp.type = "text"; inp.className = "wbEd"; inp.value = ch != null ? ch : rawOf(r, UI.ck);
  td.innerHTML = ""; td.appendChild(inp); inp.focus(); if (ch == null) { if (f2) inp.setSelectionRange(inp.value.length, inp.value.length); else inp.select(); }
  UI.edit = {inp, rid: r.id, ck: UI.ck, typed: ch != null};
  if (UI.ck === "code") { const L = A.raLib(); if (L.o) { inp.setAttribute("list", "wbCodeL"); if (!document.getElementById("wbCodeL")) { const dl = document.createElement("datalist"); dl.id = "wbCodeL"; dl.innerHTML = [...L.items.values()].slice(0, 3000).map(it => `<option value="${A.esc(it.code || it.id)}">${A.esc(String(it.desc || "").slice(0, 90))} (${A.esc(it.unit || "")})</option>`).join(""); document.getElementById("wbRoot").appendChild(dl); } } }
  inp.addEventListener("blur", () => { if (UI && UI.edit && UI.edit.inp === inp) commit(null, true); });
}
function commit(move, away){   // (away: left for another field — the search box, the formula bar: the focus stays there)
  const ed = UI.edit; if (!ed) return; UI.edit = null;
  const x = rowOf(ed.rid); const v = ed.inp.value;
  if (x && v !== rawOf(x.r, ed.ck)) edit(() => setCell(x.r, ed.ck, v)); else render(true);
  if (move) moveSel(move[0], move[1]);
  if (!away) focusGrid();
}
function commitAll(){   // Ctrl+Enter while typing: the entry into every cell of the selection
  const ed = UI.edit; if (!ed) return; UI.edit = null; const v = ed.inp.value, R = rng(), V = UI.V, C = UI.C;
  edit(() => { for (let i = R.r0; i <= R.r1; i++) for (let j = R.c0; j <= R.c1; j++) { const r = V[i], k = C[j].k; if (r && editable(k) && fits(r, k)) setCell(r, k, v); } });
  focusGrid();
}
function clearSel(){   // Delete: every cell of the selection emptied (a linked quantity or a rate code too — Ctrl+Z brings them back)
  const R = rng(), V = UI.V || [], C = UI.C || [], T = [];
  for (let i = R.r0; i <= R.r1; i++) for (let j = R.c0; j <= R.c1; j++) { const r = V[i], k = C[j].k; if (!r || !editable(k) || !fits(r, k)) continue; const p = cellGet(r, k); if (!p.plain || p.raw !== "") T.push([r, k]); }
  if (T.length) edit(() => T.forEach(([r, k]) => setCell(r, k, "")), true);
}
function fillDown(){   // Ctrl+D: the top row of the selection copied down it — one row selected: the cell above copied into it
  const R = rng(), V = UI.V || [], C = UI.C || []; if (!V.length) return;
  let src = R.r0, a = R.r0 + 1, b = R.r1; if (R.r1 === R.r0) { if (R.r0 === 0) return; src = R.r0 - 1; a = b = R.r0; }
  edit(() => { for (let j = R.c0; j <= R.c1; j++) { const k = C[j].k; if (!editable(k) || !fits(V[src], k)) continue; const p = cellGet(V[src], k); for (let i = a; i <= b; i++) cellPut(V[i], k, p); } }, true);
}
function fillRight(){   // Ctrl+R: the left column of the selection copied across it — one column selected: the cell to its left
  const R = rng(), V = UI.V || [], C = UI.C || []; if (!V.length) return;
  let src = R.c0, a = R.c0 + 1, b = R.c1; if (R.c1 === R.c0) { if (R.c0 === 0) return; src = R.c0 - 1; a = b = R.c0; }
  edit(() => { for (let i = R.r0; i <= R.r1; i++) { const r = V[i], v = plainOf(r, C[src].k, UI.X); for (let j = a; j <= b; j++) { const k = C[j].k; if (editable(k) && fits(r, k)) setCell(r, k, k === "qty" || k === "rate" ? v : editable(C[src].k) ? rawOf(r, C[src].k) : v); } } }, true);
}
/* the fill handle: what comes after the cells S (in the order of the fill) — numbers go on as their trend (two or more; one: copied,
   Ctrl: counts on by 1), text ending in a number counts on (A-1, A-2…), anything else (a formula, a link) is copied */
function series(S, ctrl, up){
  const n = S.length, raws = S.map(p => p && p.plain ? String(p.raw || "").trim() : null), copy = j => S[j % n];
  if (raws.some(x => x == null || x === "" || x[0] === "=")) return copy;
  if (raws.every(x => NUMS.test(x))) { if (n >= 2 ? ctrl : !ctrl) return copy;
    const ys = raws.map(x => +x.replace(/,/g, "")), dec = Math.min(10, Math.max(...raws.map(x => (x.replace(/e.*$/i, "").split(".")[1] || "").length)));
    let m = up ? -1 : 1, b0 = ys[0];
    if (n >= 2) { const xm = (n - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; ys.forEach((y, x) => { sxy += (x - xm) * (y - ym); sxx += (x - xm) * (x - xm); }); m = sxy / sxx; b0 = ym - m * xm; }
    return j => ({raw: String(+(b0 + m * (n + j)).toFixed(dec)), plain: true}); }
  const M = raws.map(x => /^(.*?)(\d+)(\D*)$/.exec(x));
  if (!ctrl && M.every(m => m && m[1] === M[0][1] && m[3] === M[0][3])) {
    const ns = M.map(m => +m[2]), st = n >= 2 ? Math.round((ns[n - 1] - ns[0]) / (n - 1)) : up ? -1 : 1, w = M[n - 1][2].length, pad = M[n - 1][2][0] === "0";
    if (!st) return copy;
    return j => { const d = String(Math.abs(ns[n - 1] + st * (j + 1))); return {raw: M[0][1] + (pad ? d.padStart(w, "0") : d) + M[0][3], plain: true}; };
  }
  return copy;
}
function fillRange(R, a, b, ctrl, up){   // the fill handle let go: rows a…b filled from the selection, column by column
  const V = UI.V, C = UI.C, src = V.slice(R.r0, R.r1 + 1), dst = V.slice(a, b + 1); if (up) { src.reverse(); dst.reverse(); }
  edit(() => { for (let j = R.c0; j <= R.c1; j++) { const k = C[j].k; if (!editable(k)) continue; const S = src.filter(r => fits(r, k)).map(r => cellGet(r, k)); if (!S.length) continue;
    const nx = series(S, ctrl, up); let i = 0; dst.forEach(r => { if (fits(r, k)) cellPut(r, k, nx(i++)); }); } }, true);
  UI.anc = {ri: Math.min(a, R.r0), ck: C[R.c0].k}; UI.ri = Math.max(b, R.r1); UI.ck = C[R.c1].k; UI.full = null; paintSel(true);
}

/* ------------------------------------------------------------------ the mouse: picking, dragging (ranges, moves, widths, the fill handle) */
function onClick(e){
  if (e.target.closest(".wbMenu")) return;
  const b = e.target.closest("[data-w]"); if (b) { e.preventDefault(); const p = cmd(b.dataset.w); if (document.activeElement === b) focusGrid(); return p; }
  const sb = e.target.closest(".wbTree [data-sec]"); if (sb) { UI.sec = sb.dataset.sec; UI.ri = 0; UI.anc = null; UI.full = null; UI.V = null; return render(); }
  const op = e.target.closest("[data-open]"); if (op && !e.target.closest("input,select")) { e.preventDefault(); UI.sec = op.dataset.open; UI.ri = 0; UI.V = null; return render(); }
  const mp = e.target.closest("[data-mkpre]"); if (mp) { const [n, p] = mp.dataset.mkpre.split("|"); return edit(() => { WB().marks.push({id: nid("M"), name: n, kind: "pct", e: p, base: "run"}); }); }
  const md = e.target.closest("[data-mkdel]"); if (md) return edit(() => { const i = +md.dataset.mkdel, m = WB().marks.splice(i, 1)[0]; if (m) toBin({kind: "mark", m, i}); });
}
function onDown(e){
  if (e.target.closest(".wbMenu")) return; menuOff();
  if (e.button !== 0 || !e.target.closest(".wbGrid") || !secOf(UI.sec) || e.target.closest(".wbEd")) return;
  if (UI.edit) commit();   // (another cell picked while typing: what was typed is kept)
  const el = document.elementFromPoint(e.clientX, e.clientY) || e.target; if (!el.closest || !el.closest(".wbSh")) return;
  const fo = el.closest("[data-fold]"); if (fo) { e.preventDefault(); return fold(fo.dataset.fold); }
  const rz = el.closest("[data-rz]"); if (rz) { e.preventDefault(); return dragResize(e, rz.dataset.rz); }
  if (el.closest(".wbFh")) { e.preventDefault(); return dragFill(e); }
  if (el.closest(".wbHa")) return e.preventDefault();   // (the heading's ◀ ▶: a click, handled as a command — not a pick or a drag)
  if (el.closest("th.gut")) { e.preventDefault(); focusGrid(); return selAll(); }
  const th = el.closest("th[data-hk]"); if (th) { e.preventDefault(); return downHead(e, th); }
  const gu = el.closest("td.gut[data-gi]"); if (gu) { e.preventDefault(); return downGut(e, +gu.dataset.gi); }
  const td = el.closest("td[data-ck][data-ri]"); if (td) { e.preventDefault(); return downCell(e, td); }
}
function drag(e0, move, up, ax){   // the mouse held down: move(element under it, event) as it goes — the sheet scrolls at its edges (ax: "x", "y" or both) — then up(…)
  const W = $w(".wbGridW"); let last = e0; ax = ax || "xy";
  const auto = setInterval(() => { const b = W.getBoundingClientRect(), x = last.clientX, y = last.clientY, inX = x >= b.left && x <= b.right, inY = y >= b.top && y <= b.bottom;
    const dy = ax.includes("y") && inX ? (y < b.top + 28 ? -24 : y > b.bottom - 8 ? 24 : 0) : 0, dx = ax.includes("x") && inY ? (x < b.left + 8 ? -24 : x > b.right - 8 ? 24 : 0) : 0;   // (not when the pointer is over the tree: rows are dropped there)
    if (!dx && !dy) return; W.scrollBy(dx, dy); move(document.elementFromPoint(Math.min(b.right - 14, Math.max(b.left + 50, x)), Math.min(b.bottom - 14, Math.max(b.top + 34, y))), last); }, 60);
  const mm = ev => { last = ev; move(document.elementFromPoint(ev.clientX, ev.clientY), ev); };
  const mu = ev => { window.removeEventListener("mousemove", mm, true); window.removeEventListener("mouseup", mu, true); clearInterval(auto); if (up && UI) up(document.elementFromPoint(ev.clientX, ev.clientY), ev); };
  window.addEventListener("mousemove", mm, true); window.addEventListener("mouseup", mu, true);
}
function downCell(e, td){
  const ri = +td.dataset.ri, ck = td.dataset.ck;
  if (e.shiftKey) { if (!UI.anc) UI.anc = {ri: UI.ri, ck: UI.ck}; } else UI.anc = {ri, ck};
  UI.full = null; UI.ri = ri; UI.ck = ck; focusGrid(); paintSel(true);   // (focus first: a field of the details pane left gives its change before the pane shows the new row)
  drag(e, el => { const t = el && el.closest(".wbSh td[data-ck][data-ri]"); if (t && (+t.dataset.ri !== UI.ri || t.dataset.ck !== UI.ck)) { UI.ri = +t.dataset.ri; UI.ck = t.dataset.ck; paintSel(true); } });
}
function downHead(e, th){   // a column heading: picked (Shift: to it), dragged across (several) — or, already picked, dragged to move the columns
  const k = th.dataset.hk, ci = +th.dataset.ci, R = rng(), on = (UI.full === "col" || UI.full === "all") && ci >= R.c0 && ci <= R.c1; focusGrid();
  if (on && !e.shiftKey) { const x0 = e.clientX, blk = UI.C.slice(R.c0, R.c1 + 1).map(c => c.k); let moved = false, to = null;
    return drag(e, (el, ev) => { if (!moved && Math.abs(ev.clientX - x0) < 5) return; moved = true; to = colDrop(ev); },
      () => { markOff(); if (!moved) { UI.anc = {ri: 0, ck: k}; UI.ck = k; UI.full = "col"; return paintSel(true); }
        if (to == null || (to >= R.c0 && to <= R.c1 + 1)) return; colsTo(blk, to < UI.C.length ? UI.C[to].k : null); }, "x"); }
  if (e.shiftKey && UI.anc) UI.ck = k; else { UI.anc = {ri: 0, ck: k}; UI.ck = k; }
  UI.full = "col"; paintSel(true);
  drag(e, el => { const h = el && el.closest(".wbSh th[data-hk], .wbSh td[data-ck]"), kk = h && (h.dataset.hk || h.dataset.ck); if (kk && kk !== UI.ck) { UI.ck = kk; paintSel(true); } });
}
function downGut(e, i){   // a row number: the row picked (Shift: to it), dragged across (several) — or, already picked, dragged to move the rows (onto a section of the tree: into it)
  const R = rng(), on = (UI.full === "row" || UI.full === "all") && i >= R.r0 && i <= R.r1, s = secOf(UI.sec); focusGrid();
  if (on && !e.shiftKey) { const y0 = e.clientY, rows = withFolded(s, UI.V.slice(R.r0, R.r1 + 1)); let moved = false, to = null, sec = null;
    const at = (el, ev) => { markOff(); sec = null; to = null;
      const ts = el && el.closest && el.closest(".wbTree [data-sec]"); if (ts && ts.dataset.sec && ts.dataset.sec !== s.id) { sec = ts.dataset.sec; ts.classList.add("drop"); return; }
      to = rowDrop(ev); };
    return drag(e, (el, ev) => { if (!moved && Math.abs(ev.clientY - y0) < 5) return; moved = true; at(el, ev); },
      (el, ev) => { if (moved) at(el, ev); markOff(); if (!moved) { UI.anc = {ri: i, ck: UI.C[0].k}; UI.ri = i; UI.full = "row"; return paintSel(true); }
        if (sec) return moveToSec(sec, rows);
        if (to == null || (to >= R.r0 && to <= R.r1 + 1)) return;
        const V = UI.V, last = V[V.length - 1], before = to < V.length ? V[to] : s.rows[s.rows.indexOf(unitEnd(s, last)) + 1] || null;
        edit(() => { moveRows(rows, s, s, before); }, true); A.toast(rows.length + " row" + (rows.length > 1 ? "s" : "") + " moved", 1400); }, "y"); }
  if (e.shiftKey) { if (!UI.anc) UI.anc = {ri: UI.ri, ck: UI.C[0].k}; } else UI.anc = {ri: i, ck: UI.C[0].k};
  UI.ri = i; UI.full = "row"; paintSel(true);
  drag(e, el => { const tr = el && el.closest(".wbSh tbody tr[data-ri]"); if (tr && +tr.dataset.ri !== UI.ri) { UI.ri = +tr.dataset.ri; paintSel(true); } });
}
function rowDrop(ev){   // where rows dragged go: before the row under the pointer (after it, from its middle down) — shown as a line
  const el = document.elementFromPoint(ev.clientX, ev.clientY), tr = el && el.closest(".wbSh tbody tr[data-ri]"); if (!tr) return null;
  const b = tr.getBoundingClientRect(), low = ev.clientY > b.top + b.height / 2, W = $w(".wbGridW");
  mark("h", (low ? b.bottom : b.top) - W.getBoundingClientRect().top + W.scrollTop); return +tr.dataset.ri + (low ? 1 : 0);
}
function colDrop(ev){   // where columns dragged go: before the column under the pointer (after it, from its middle right)
  const t = $w(".wbSh"); if (!t) return null; const ths = [...t.tHead.rows[0].cells].slice(1), W = $w(".wbGridW"), wl = W.getBoundingClientRect().left - W.scrollLeft;
  for (let i = 0; i < ths.length; i++) { const b = ths[i].getBoundingClientRect(); if (ev.clientX < b.left + b.width / 2) { mark("v", b.left - wl); return i; } }
  const b = ths[ths.length - 1].getBoundingClientRect(); mark("v", b.right - wl); return ths.length;
}
function mark(dir, at){ const m = $w(".wbMk"), W = $w(".wbGridW"); m.hidden = false; m.className = "wbMk " + dir;
  if (dir === "h") Object.assign(m.style, {top: at + "px", left: W.scrollLeft + "px", width: W.clientWidth + "px", height: ""}); else Object.assign(m.style, {left: at + "px", top: W.scrollTop + "px", height: W.clientHeight + "px", width: ""}); }
function markOff(){ const m = $w(".wbMk"); if (m) m.hidden = true; document.querySelectorAll("#wbRoot .drop").forEach(x => x.classList.remove("drop")); }
function dragResize(e, k){   // a column's edge dragged: its width (an undo step when let go)
  const t = $w(".wbSh"), col = t && [...t.querySelectorAll("col[data-k]")].find(c => c.dataset.k === k), th = t && [...t.tHead.rows[0].cells].find(c => c.dataset.hk === k); if (!col || !th) return;
  const x0 = e.clientX, w0 = th.offsetWidth, z = WB().view.zoom / 100; let w = w0;
  drag(e, (el, ev) => { w = Math.max(28, Math.round(w0 + (ev.clientX - x0) / z)); col.style.width = w + "px"; t.style.width = `max(100%, ${UI.tw - colW(k) + w}px)`; },
    () => { if (w !== w0) edit(() => { WB().view.w[k] = w; }, true); });
}
function autofit(k){   // double-click on a column's edge: as wide as its widest cell (its text measured as laid out, not the cell)
  const t = $w(".wbSh"); if (!t) return; const j = (UI.C || []).findIndex(c => c.k === k); if (j < 0) return; if (UI.fh) { UI.fh.remove(); UI.fh = null; }
  const rg = document.createRange(), z = WB().view.zoom / 100, wOf = n => { rg.selectNodeContents(n); return rg.getBoundingClientRect().width / z; }, th = t.tHead.rows[0].cells[j + 1];
  let w = (th.firstChild ? wOf(th.firstChild) : 0) + 24; for (const tr of t.tBodies[0].rows) { const td = tr.cells[j + 1]; if (td && td.dataset.ck) w = Math.max(w, wOf(td) + 16); }
  w = Math.min(900, Math.max(40, Math.ceil(w))); edit(() => { WB().view.w[k] = w; }, true);
}
function dragFill(e){
  const R = rng(); let t = null, ctrl = false;
  drag(e, (el, ev) => { ctrl = ev.ctrlKey; const tr = el && el.closest(".wbSh tbody tr[data-ri]"); if (!tr || +tr.dataset.ri === t) return; t = +tr.dataset.ri; paintFill(R, t); },
    (el, ev) => { paintFill(null); ctrl = ev.ctrlKey || ctrl; if (t == null) return; if (t > R.r1) fillRange(R, R.r1 + 1, t, ctrl, false); else if (t < R.r0) fillRange(R, t, R.r0 - 1, ctrl, true); });
}
function paintFill(R, i){ (UI.fp || []).forEach(el => el.classList.remove("fp")); UI.fp = []; if (!R) return; const body = $w(".wbSh").tBodies[0], a = i > R.r1 ? R.r1 + 1 : i, b = i > R.r1 ? i : R.r0 - 1;
  for (let r = a; r <= b; r++) for (let j = R.c0; j <= R.c1; j++) { const td = body.rows[r] && body.rows[r].cells[j + 1]; if (td) { td.classList.add("fp"); UI.fp.push(td); } } }
function onDbl(e){
  const rz = e.target.closest("[data-rz]"); if (rz) return autofit(rz.dataset.rz);
  const td = e.target.closest(".wbSh td[data-ck][data-ri]"); if (td && !UI.edit) { UI.ri = +td.dataset.ri; UI.ck = td.dataset.ck; UI.anc = null; UI.full = null; paintSel(true); return startEdit(null, true); }
  const ts = e.target.closest(".wbTree [data-sec]"); if (ts && ts.dataset.sec) renameSec(ts.dataset.sec);
}

/* ------------------------------------------------------------------ the right-click menus */
function onCtx(e){
  if (!e.target.closest(".wbGrid") || !secOf(UI.sec) || e.target.closest(".wbEd")) return;   // (the Summary and the panes keep the browser's own menu)
  if (UI.edit) commit();
  const el = document.elementFromPoint(e.clientX, e.clientY) || e.target; if (!el.closest || !el.closest(".wbSh")) return; e.preventDefault();
  const th = el.closest("th[data-hk]"), gu = el.closest("td.gut[data-gi]"), td = el.closest("td[data-ck][data-ri]"), R = rng();
  if (th) { const ci = +th.dataset.ci; if (!((UI.full === "col" || UI.full === "all") && ci >= R.c0 && ci <= R.c1)) { UI.anc = {ri: 0, ck: th.dataset.hk}; UI.ck = th.dataset.hk; UI.full = "col"; paintSel(true); } return menu(e.clientX, e.clientY, colMenu(th.dataset.hk)); }
  if (gu) { const i = +gu.dataset.gi; if (!((UI.full === "row" || UI.full === "all") && i >= R.r0 && i <= R.r1)) { UI.anc = {ri: i, ck: UI.C[0].k}; UI.ri = i; UI.full = "row"; paintSel(true); } return menu(e.clientX, e.clientY, rowMenu()); }
  if (td) { const i = +td.dataset.ri, ci = UI.C.findIndex(c => c.k === td.dataset.ck); if (!(i >= R.r0 && i <= R.r1 && ci >= R.c0 && ci <= R.c1)) { UI.anc = null; UI.full = null; UI.ri = i; UI.ck = td.dataset.ck; paintSel(true); } }
  menu(e.clientX, e.clientY, rowMenu());
}
function menuAtCell(){ const a = $w(".wbSh td.act"); if (!a) return; const b = a.getBoundingClientRect(); menu(b.left + 8, b.bottom, UI.full === "col" ? colMenu(UI.ck) : rowMenu()); }
function menu(x, y, items, back){
  menuOff(); const m = document.createElement("div"); m.className = "wbMenu"; m.setAttribute("role", "menu");
  const L = back ? [{t: "Back", ic: "&#9664;", fn: () => menu(x, y, back)}, "-"].concat(items) : items;
  m.innerHTML = L.map((it, i) => it === "-" ? '<div class="sep" role="separator"></div>' : `<button type="button" role="menuitem" data-mi="${i}"${it.dis ? " disabled" : ""}><span class="ic">${it.ic || ""}</span><span class="tx">${A.esc(it.t)}</span><span class="kb">${it.sub ? "&#9656;" : A.esc(it.k || "")}</span></button>`).join("");
  document.getElementById("wbRoot").appendChild(m); UI.menu = m;
  const b = m.getBoundingClientRect(); m.style.left = Math.max(4, Math.min(x, innerWidth - b.width - 4)) + "px"; m.style.top = Math.max(4, Math.min(y, innerHeight - b.height - 4)) + "px";
  m.addEventListener("click", e => { const btn = e.target.closest("[data-mi]"); if (!btn || btn.disabled) return; const it = L[+btn.dataset.mi]; if (it.sub) return menu(x, y, it.sub(), items); menuOff(); focusGrid(); it.fn(); });
  const f = m.querySelector("button:not([disabled])"); if (f) f.focus();
}
function menuOff(){ if (UI && UI.menu) { UI.menu.remove(); UI.menu = null; } }
function menuKey(e){
  const k = e.key, B = [...UI.menu.querySelectorAll("button:not([disabled])")], i = B.indexOf(document.activeElement);
  if (k === "Escape") { e.preventDefault(); menuOff(); return focusGrid(); }
  if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); const n = B[(i + (k === "ArrowDown" ? 1 : -1) + B.length) % B.length]; if (n) n.focus(); return; }
  if (k === "Enter" || k === " ") { e.preventDefault(); if (B[i]) B[i].click(); return; }
  if (k === "Tab") e.preventDefault();
}
const MI = (t, k, fn, o) => Object.assign({t, k, fn}, o || {});
function rowMenu(){
  const r = curRow(), sel = selRows(), s = secOf(UI.sec), wb = WB(), c = (UI.C || []).find(x => x.k === UI.ck) || {t: ""}, n = sel.length;
  return [MI("Cut", "Ctrl+X", () => cmd("cut"), {ic: "&#9986;"}), MI("Copy", "Ctrl+C", () => cmd("copy"), {ic: "&#10697;"}), MI("Paste", "Ctrl+V", () => cmd("paste"), {ic: "&#128203;"}), MI("Paste values only", "Ctrl+Shift+V", () => cmd("pastev")), "-",
    MI("Insert row above", "Ctrl++", () => cmd("rowabove")), MI("Insert row below", "Ctrl+Enter", () => cmd("row")), MI("Insert heading below", "Ctrl+Shift+Enter", () => cmd("head")), MI("Insert note below", "", () => cmd("note")),
    MI(n > 1 ? "Delete " + n + " rows" : "Delete row", "Ctrl+−", () => cmd("del"), {dis: !n}), MI("Clear contents", "Delete", () => cmd("clear")), MI(n > 1 ? "Duplicate " + n + " rows" : "Duplicate row", "Ctrl+Shift+D", () => cmd("dup"), {dis: !n}), "-",
    MI("Move up", "Alt+↑", () => cmd("up")), MI("Move down", "Alt+↓", () => cmd("down")), MI("Move to section", "", null, {sub: () => wb.secs.filter(x => x !== s).map(x => MI(x.name, "", () => cmd("tosec", x.id))), dis: wb.secs.length < 2}), "-",
    MI("Fill down", "Ctrl+D", () => cmd("filldown"), {ic: "&#8615;"}), MI("Fill right", "Ctrl+R", () => cmd("fillright")), MI("Sort A → Z by " + c.t, "", () => cmd("sortaz")), MI("Sort Z → A by " + c.t, "", () => cmd("sortza")), "-",
    ...(r && r.t === "head" ? [MI(r.fold ? "Expand this heading" : "Collapse this heading", "", () => fold(r.id)), MI("Heading level up", "Alt+←", () => cmd("out")), MI("Heading level down", "Alt+→", () => cmd("in"))] : []),
    MI("Collapse all headings", "", () => cmd("foldall")), MI("Expand all headings", "", () => cmd("unfoldall")), "-",
    MI("Link quantity to the takeoff…", "", () => cmd("link"), {ic: "&#9939;", dis: !(r && r.t === "item")}), MI("Row colour", "", null, {sub: () => [["", "None"], ["yellow", "Yellow"], ["green", "Green"], ["red", "Red"], ["blue", "Blue"]].map(([k, t]) => MI(t, "", () => cmd("color", k)))}),
    MI("Recover what was deleted…", "", () => cmd("recover"), {ic: "&#9851;"})];
}
function colMenu(k){
  const v = WB().view, C = UI.C || [], ci = C.findIndex(x => x.k === k), R = rng(), u = k.startsWith("u:"), hid = v.hide.length;
  return [MI("Sort A → Z", "", () => cmd("sortaz", k)), MI("Sort Z → A", "", () => cmd("sortza", k)), "-",
    MI("Move left", "Alt+Shift+←", () => cmd("colleft"), {ic: "&#9664;", dis: R.c0 === 0}), MI("Move right", "Alt+Shift+→", () => cmd("colright"), {ic: "&#9654;", dis: R.c1 >= C.length - 1}),
    MI("Insert a column left", "", () => insertUserCol(k, false)), MI("Insert a column right", "", () => insertUserCol(k, true)),
    ...(u ? [MI("Rename column…", "", () => renameUserCol(k)), MI("Delete column", "", () => deleteUserCol(k))] : []),
    MI(R.c1 > R.c0 ? "Hide " + (R.c1 - R.c0 + 1) + " columns" : "Hide column", "", () => cmd("colhide")), MI("Show all columns" + (hid ? " (" + hid + " hidden)" : ""), "", () => cmd("colshow"), {dis: !hid}), "-",
    MI("Fit width", "double-click its edge", () => cmd("colfit", k)), MI("Reset column widths", "", () => cmd("colreset")),
    MI("Freeze up to this column", "", () => cmd("freeze", ci), {ic: "&#10052;"}), ...(v.freeze ? [MI("Unfreeze columns", "", () => cmd("unfreeze"))] : []),
    MI((v.wrap ? "✓ " : "") + "Wrap text", "", () => cmd("wrap")), "-", MI("Select column", "Ctrl+Space", () => selCol()), MI("Columns…", "", () => cmd("cols"))];
}

/* ------------------------------------------------------------------ the keys */
function onKey(e){
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return;   // a dialog over the workbook: its keys
  if (UI.menu) { e.stopPropagation(); return menuKey(e); }
  const tg = e.target, inFx = tg && tg.closest && tg.closest(".wbFx");
  if (inFx && tg.matches("input")) { e.stopPropagation(); return fxKey(e, tg); }
  const inPane = tg && tg.closest && tg.closest(".wbPane, .wbBar, .wbGrid .mk, .wbTree");
  if (UI.edit) { e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); return e.ctrlKey || e.metaKey ? commitAll() : commit([e.shiftKey ? -1 : 1, 0]); } if (e.key === "Tab") { e.preventDefault(); return commit([0, e.shiftKey ? -1 : 1]); }
    if (e.key === "Escape") { e.preventDefault(); UI.edit = null; render(true); return focusGrid(); }
    if (UI.edit.typed && /^Arrow/.test(e.key) && !e.shiftKey) { e.preventDefault(); return commit({ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]}[e.key]); }   // (as Excel: a cell typed into is left by the arrows; opened with F2 they move in it)
    return; }
  if (inPane && tg.matches("input,select,textarea")) { e.stopPropagation(); if (e.key === "Escape") tg.blur(); return; }
  e.stopPropagation();   // the drawing's own shortcuts are not for the workbook
  const k = e.key, c = e.ctrlKey || e.metaKey, sh = e.shiftKey, lk = k.length === 1 ? k.toLowerCase() : k, pd = () => e.preventDefault();
  if (c && lk === "z") { pd(); return undo(sh); } if (c && lk === "y") { pd(); return undo(true); }
  if (c && lk === "f") { pd(); const q = $w(".wbQ"); q.focus(); return q.select(); }
  if (c && lk === "h") { pd(); return cmd("find"); } if (c && lk === "g") { pd(); return cmd("goto"); }
  if (!secOf(UI.sec)) return;
  if (c && sh && lk === "v") { if (CLIP) { pd(); return pasteClip(CLIP, true); } UI.pv = true; return; }   // paste values: what was copied here at once; from Excel, its paste is plain figures anyway
  if (c && k === "Enter") { pd(); return cmd(sh ? "head" : "row"); }
  if (c && (k === "+" || (sh && k === "="))) { pd(); return cmd("rowabove"); }
  if (c && (k === "Delete" || k === "-")) { pd(); return cmd("del"); }
  if (c && lk === "d") { pd(); return cmd(sh ? "dup" : "filldown"); } if (c && lk === "r") { pd(); return cmd("fillright"); }
  if (c && lk === "a") { pd(); return selAll(); } if (c && k === " ") { pd(); return selCol(); } if (sh && !c && k === " ") { pd(); return selRow(); }
  if (e.altKey && sh && (k === "ArrowLeft" || k === "ArrowRight")) { pd(); return cmd(k === "ArrowLeft" ? "colleft" : "colright"); }
  if (e.altKey && k === "ArrowUp") { pd(); return cmd("up"); } if (e.altKey && k === "ArrowDown") { pd(); return cmd("down"); }
  if (e.altKey && k === "ArrowLeft") { pd(); return cmd("out"); } if (e.altKey && k === "ArrowRight") { pd(); return cmd("in"); }
  if (k === "ContextMenu" || (sh && k === "F10")) { pd(); return menuAtCell(); }
  const nav = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-20, 0], PageDown: [20, 0]};
  if (k === "Tab") { pd(); UI.anc = null; UI.full = null; return moveSel(0, sh ? -1 : 1); }
  if (nav[k] || k === "Home" || k === "End") { pd();
    if (sh) { if (!UI.anc) UI.anc = {ri: UI.ri, ck: UI.ck}; } else { UI.anc = null; UI.full = null; }
    if (k === "Home" || k === "End") { if (c) UI.ri = k === "Home" ? 0 : (UI.V || []).length - 1; UI.ck = (k === "Home" ? UI.C[0] : UI.C[UI.C.length - 1]).k; return paintSel(); }
    const [dr, dc] = nav[k], far = c && !k.startsWith("Page") ? 1e6 : 1; return moveSel(dr * far, dc * far); }
  if (k === "Enter" || k === "F2") { pd(); return startEdit(null, k === "F2"); }
  if (k === "Delete" || k === "Backspace") { pd(); return clearSel(); }
  if (k === "Escape") { if (CLIP && CLIP.cut) CLIP = null; UI.anc = null; UI.full = null; return paintSel(true); }
  if (k.length === 1 && !c && !e.altKey) { pd(); return startEdit(k); }
}
function fxKey(e, t){   // the name box (Enter: go there) and the formula bar (Enter / Tab: into the cell; Escape: as it was)
  if (t.classList.contains("wbNm")) { if (e.key === "Enter") { e.preventDefault(); const q = t.value.trim(); t.blur(); if (q && q !== t.dataset.v && goTo(q)) return; fxShow(); focusGrid(); } else if (e.key === "Escape") { e.preventDefault(); t.blur(); fxShow(); focusGrid(); } return; }
  if (e.key === "Escape") { e.preventDefault(); t.blur(); fxShow(); return focusGrid(); }
  if (e.key !== "Enter" && e.key !== "Tab") return; e.preventDefault();
  const r = curRow(), k = UI.ck, v = t.value; t.blur();
  if (r && !t.readOnly && editable(k) && fits(r, k) && v !== rawOf(r, k)) edit(() => setCell(r, k, v), true);
  focusGrid(); return e.key === "Tab" ? moveSel(0, e.shiftKey ? -1 : 1) : moveSel(e.shiftKey ? -1 : 1, 0);
}

/* ------------------------------------------------------------------ copy, cut, paste — within the workbook (links kept) and with Excel */
function copySel(cut){
  const s = secOf(UI.sec); if (!s || !(UI.V || []).length) return null;
  const R = rng(), X = UI.X, full = UI.full === "row" || UI.full === "all", rows = UI.V.slice(R.r0, R.r1 + 1), cks = UI.C.slice(R.c0, R.c1 + 1).map(c => c.k), whole = full ? withFolded(s, rows) : rows;
  const txt = whole.map(r => cks.map(k => plainOf(r, k, X)).join("\t")).join("\r\n");
  CLIP = {sec: s.id, cut: !!cut, ids: whole.map(r => r.id), cks, txt, rows: full ? whole.map(r => clone(r)) : null,
    cells: rows.map(r => cks.map(k => editable(k) && fits(r, k) ? cellGet(r, k) : {raw: plainOf(r, k, X), plain: true})),
    vals: rows.map(r => cks.map(k => ({raw: k === "qty" || k === "rate" || !editable(k) ? plainOf(r, k, X) : rawOf(r, k), plain: true})))};
  A.toast((full ? whole.length + " row" + (whole.length > 1 ? "s" : "") : R.n + " cell" + (R.n > 1 ? "s" : "")) + (cut ? " cut — paste to move " + (full ? "them" : "them there") : " copied — paste here (links kept) or in Excel"), 2000);
  return CLIP;
}
const clipWrite = () => { try { navigator.clipboard.writeText(CLIP.txt).catch(() => {}); } catch (e) { /* (no clipboard: pasted within the workbook all the same) */ } };
const clipOk = e => !UI.edit && !(e.target && e.target.closest && e.target.closest("input,textarea,select")) && secOf(UI.sec);
function onCopy(e){   // Ctrl+C / Ctrl+X: the selection as text for Excel, and whole (links, codes, build-ups) for a paste here
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return; e.stopPropagation();   // (the drawing's own copy is not for the workbook)
  if (!clipOk(e)) return; const K = copySel(e.type === "cut"); if (!K) return;
  e.clipboardData.setData("text/plain", K.txt); e.preventDefault(); paintSel(true);
}
function onPaste(e){
  if (!UI || document.getElementById("dlgBack").classList.contains("on")) return; e.stopPropagation();   // (nothing is pasted onto the drawing meanwhile)
  if (!clipOk(e)) return;
  const t = e.clipboardData.getData("text/plain"); if (!t) return; e.preventDefault();
  const pv = UI.pv; UI.pv = false; const same = x => String(x).replace(/\r/g, "").replace(/\n$/, "");
  if (CLIP && same(t) === same(CLIP.txt)) return pasteClip(CLIP, pv); pasteText(t);
}
function pasteMenu(values){ if (CLIP) return pasteClip(CLIP, values);
  try { navigator.clipboard.readText().then(t => t ? pasteText(t) : A.toast("Nothing to paste", 1600)).catch(() => A.toast("Press Ctrl+V to paste what was copied in Excel", 2600)); } catch (e) { A.toast("Press Ctrl+V to paste what was copied in Excel", 2600); } }
function rowsFrom(s, V, r0, h){   // h rows from the r0-th shown down — new item rows after the last one when they run out
  const out = V.slice(r0, r0 + h); let at = out.length ? s.rows.indexOf(unitEnd(s, out[out.length - 1])) + 1 : s.rows.length;
  while (out.length < h) { const nr = newRow(); s.rows.splice(at++, 0, nr); out.push(nr); } return out;
}
function pasteClip(K, values){
  const s = secOf(UI.sec), V = UI.V || [], R = rng(), C = UI.C;
  if (K.rows) {   // whole rows: put in above the active row — moved there when they were cut
    const before = V.length ? V[R.r0] : null;
    if (K.cut) { const src = secOf(K.sec), ids = new Set(K.ids), rows = src ? src.rows.filter(r => ids.has(r.id)) : [];
      if (!rows.length) { CLIP = null; return A.toast("The rows cut are not there any more", 2000); }
      if (before && ids.has(before.id)) return A.toast("Pick a row outside the rows cut, to move them above it", 2400);
      edit(() => { moveRows(rows, src, s, before); }, true); CLIP = null; A.toast(rows.length + " row" + (rows.length > 1 ? "s" : "") + " moved", 1800); return selectRows(rows, "row"); }
    const cp = K.rows.map(r => fresh(clone(r))); edit(() => { const i = before ? s.rows.indexOf(before) : s.rows.length; s.rows.splice(i, 0, ...cp); }, true);
    A.toast(cp.length + " row" + (cp.length > 1 ? "s" : "") + " pasted above", 1800); return selectRows(cp, "row");
  }
  const one = K.cells.length === 1 && K.cells[0].length === 1, h = one ? R.r1 - R.r0 + 1 : K.cells.length, w = one ? R.c1 - R.c0 + 1 : K.cells[0].length, M = values ? K.vals : K.cells;   // one cell copied fills the selection
  edit(() => {
    if (K.cut) { const src = secOf(K.sec); if (src) K.ids.forEach(id => { const r = src.rows.find(x => x.id === id); if (r) K.cks.forEach(k => { if (editable(k) && fits(r, k)) setCell(r, k, ""); }); }); }
    rowsFrom(s, V, V.length ? R.r0 : 0, h).forEach((r, i) => { for (let j = 0; j < w; j++) { const c = C[R.c0 + j]; if (c && editable(c.k)) cellPut(r, c.k, M[one ? 0 : i][one ? 0 : j]); } });
  });
  if (K.cut) CLIP = null;
  UI.anc = {ri: R.r0, ck: C[R.c0].k}; UI.ri = Math.min((UI.V || []).length - 1, R.r0 + h - 1); UI.ck = C[Math.min(C.length - 1, R.c0 + w - 1)].k; UI.full = null; paintSel(true);
  A.toast(h + " row" + (h > 1 ? "s" : "") + " pasted" + (values ? " (values)" : ""), 1600);
}
function pasteText(t){   // cells from Excel (or any text): from the selection's corner, across and down — one value fills the selection
  const s = secOf(UI.sec), V = UI.V || [], R = rng(), C = UI.C, grid = t.replace(/\r/g, "").replace(/\n$/, "").split("\n").map(l => l.split("\t"));
  const one = grid.length === 1 && grid[0].length === 1 && R.n > 1, h = one ? R.r1 - R.r0 + 1 : grid.length, w = one ? R.c1 - R.c0 + 1 : Math.max(...grid.map(g => g.length));
  edit(() => { rowsFrom(s, V, V.length ? R.r0 : 0, h).forEach((r, i) => { for (let j = 0; j < w; j++) { const c = C[R.c0 + j], v = one ? grid[0][0] : grid[i][j]; if (c && v != null && editable(c.k) && fits(r, c.k)) setCell(r, c.k, v); } }); });
  UI.anc = {ri: R.r0, ck: C[R.c0].k}; UI.ri = Math.min((UI.V || []).length - 1, R.r0 + h - 1); UI.ck = C[Math.min(C.length - 1, R.c0 + w - 1)].k; UI.full = null; paintSel(true);
  A.toast(h + " row" + (h > 1 ? "s" : "") + " pasted", 1600);
}

/* ------------------------------------------------------------------ commands */
async function cmd(w, arg){
  menuOff();
  const wb = WB(), s = secOf(UI.sec), r = curRow();
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
    case "recover": return recoverDialog();
    case "find": return replaceDialog();
    case "goto": return goDialog();
    case "zin": return zoom(10); case "zout": return zoom(-10); case "z100": return zoom(0);
    case "colshow": return edit(() => { wb.view.hide = []; }, true);
    case "colreset": return edit(() => { wb.view.w = {}; }, true);
    case "wrap": return edit(() => { wb.view.wrap = !wb.view.wrap; }, true);
    case "unfreeze": return edit(() => { wb.view.freeze = 0; }, true);
    case "addsec": { const v = await A.ask("New section", '<div class="fg"><label>Name</label><input type="text" id="wbSn" placeholder="e.g. Finishes"></div>', "Add", () => ({n: document.getElementById("wbSn").value.trim() || "Section"}), "wbSn"); if (!v) return; const n = v.n;   // (a dialog's text answer is its error: an object)
      const sec = {id: nid("S"), name: n, rows: [newRow()]}; edit(() => { wb.secs.push(sec); }); UI.sec = sec.id; UI.ri = 0; UI.V = null; return render(); }
    case "secup": case "secdn": { const i = wb.secs.indexOf(s); if (!s) return; const j = i + (w === "secup" ? -1 : 1); if (j < 0 || j >= wb.secs.length) return; return edit(() => { wb.secs.splice(j, 0, wb.secs.splice(i, 1)[0]); }); }
    case "secdel": { if (!s) return A.toast("Open the section to delete", 1600); const ok = await A.ask("Delete section", `<p>Delete <b>${A.esc(s.name)}</b> and its ${s.rows.length} rows? It waits in the bin — Recover (or Ctrl+Z) brings it back.</p>`, "Delete"); if (!ok) return;
      edit(() => { const i = wb.secs.indexOf(s); wb.secs.splice(i, 1); toBin({kind: "sec", s, i}); }); UI.sec = ""; return render(); }
    case "addmk": return edit(() => { wb.marks.push({id: nid("M"), name: "Markup", kind: "pct", e: "0", base: "run"}); });
  }
  if (!s) return A.toast("Open a section first", 1600);
  const sel = selRows(), R = rng(), C = UI.C || [];
  switch (w) {
    case "row": case "head": case "note": case "rowabove": {
      const t = w === "head" || w === "note" ? w : "item", k = t === "item" && UI.full === "row" && sel.length > 1 ? sel.length : 1, nr = [];
      for (let j = 0; j < k; j++) nr.push(newRow(t === "item" ? {} : {t, lvl: t === "head" ? Math.max(0, r && r.t === "head" ? r.lvl : 0) : 0}));
      edit(() => { let i; if (w === "rowabove") i = sel.length ? s.rows.indexOf(sel[0]) : 0; else { const last = sel.length ? sel[sel.length - 1] : r; i = last ? s.rows.indexOf(unitEnd(s, last)) + 1 : s.rows.length; } s.rows.splice(Math.max(0, i), 0, ...nr); });
      show(s, nr[0], t === "item" ? "code" : "desc"); if (k === 1) return startEdit(); return selectRows(nr, "row"); }
    case "del": { if (UI.full === "col") return hideCols(); if (!sel.length) return; const rows = withFolded(s, sel);
      edit(() => { delRows(s, rows); }); UI.anc = null; UI.full = null; paintSel(true); return A.toast(rows.length + " row" + (rows.length > 1 ? "s" : "") + " deleted — ♻ Recover (or Ctrl+Z) brings them back", 2600); }
    case "dup": { if (!sel.length) return; const src = withFolded(s, sel), cp = src.map(x => fresh(clone(x)));
      edit(() => { s.rows.splice(s.rows.indexOf(src[src.length - 1]) + 1, 0, ...cp); }); return selectRows(cp); }
    case "up": case "down": { if (!sel.length) return; const V = UI.V, i0 = V.indexOf(sel[0]), i1 = V.indexOf(sel[sel.length - 1]); let before;
      if (w === "up") { if (i0 <= 0) return; before = V[i0 - 1]; } else { if (i1 >= V.length - 1) return; before = s.rows[s.rows.indexOf(unitEnd(s, V[i1 + 1])) + 1] || null; }
      return edit(() => { moveRows(withFolded(s, sel), s, s, before); }, true); }
    case "in": case "out": if (!sel.some(x => x.t === "head")) return A.toast("Levels are for headings — a heading's total takes the items under it", 2200);
      return edit(() => { sel.forEach(x => { if (x.t === "head") x.lvl = Math.max(0, Math.min(3, (x.lvl || 0) + (w === "in" ? 1 : -1))); }); });
    case "link": return linkDialog(r);
    case "cut": case "copy": if (copySel(w === "cut")) clipWrite(); return paintSel(true);
    case "paste": case "pastev": return pasteMenu(w === "pastev");
    case "clear": return clearSel();
    case "filldown": return fillDown();
    case "fillright": return fillRight();
    case "sortaz": case "sortza": return sortCol(arg || UI.ck, w === "sortaz" ? 1 : -1);
    case "colleft": case "colright": return moveCols(w === "colleft" ? -1 : 1);
    case "colhide": return hideCols();
    case "colfit": return autofit(arg || UI.ck);
    case "freeze": { const ci = arg != null ? +arg : C.findIndex(c => c.k === UI.ck); if (arg == null && wb.view.freeze) return edit(() => { wb.view.freeze = 0; }, true);
      edit(() => { wb.view.freeze = ci + 1; }, true); return A.toast("Columns frozen up to " + (C[ci] ? C[ci].t : "") + " — they stay as the sheet scrolls across", 2200); }
    case "foldall": case "unfoldall": s.rows.forEach(x => { if (x.t === "head") { if (w === "foldall") x.fold = true; else delete x.fold; } }); A.save(); return render(true);
    case "tosec": return moveToSec(arg);
    case "color": return edit(() => sel.forEach(x => { if (arg) x.col = arg; else delete x.col; }), true);
  }
}
async function renameSec(id){ const s = secOf(id); if (!s) return;
  const v = await A.ask("Section", `<div class="grid"><div class="fg"><label>Code</label><input type="text" id="wbSc" value="${A.esc(s.code || "")}" placeholder="e.g. B2"></div><div class="fg w2"><label>Name</label><input type="text" id="wbSn" value="${A.esc(s.name)}"></div></div>`, "Save", () => ({code: document.getElementById("wbSc").value.trim(), name: document.getElementById("wbSn").value.trim() || s.name}), "wbSn");
  if (v) edit(() => { s.code = v.code; s.name = v.name; }); }
function moveToSec(id, rows){   // rows into another section (at its end) — from the menu, or dropped on the tree
  const s = secOf(UI.sec), to = secOf(id); if (!s || !to || to === s) return; rows = rows || withFolded(s, selRows()); if (!rows.length) return;
  edit(() => { moveRows(rows, s, to, null); }); UI.anc = null; UI.full = null; paintSel(true);
  A.toast(rows.length + " row" + (rows.length > 1 ? "s" : "") + " moved to " + to.name, 2200);
}
function moveCols(d){   // the selected columns one place left (-1) or right (+1)
  const R = rng(), C = UI.C || []; if (!C.length || (d < 0 ? R.c0 === 0 : R.c1 >= C.length - 1)) return;
  colsTo(C.slice(R.c0, R.c1 + 1).map(c => c.k), d < 0 ? C[R.c0 - 1].k : C[R.c1 + 2] ? C[R.c1 + 2].k : null);
}
function colsTo(blk, before){   // columns (keys) put before another (null: at the end) — the order is the workbook's: every sheet, the Excel export
  if (before && blk.includes(before)) return;
  const all = colsAll().map(c => c.k).filter(k => !blk.includes(k)), i = before ? all.indexOf(before) : -1; all.splice(i < 0 ? all.length : i, 0, ...blk);
  const full = UI.full, ri = UI.anc ? UI.anc.ri : UI.ri;
  edit(() => { WB().view.order = all; }, true);
  UI.anc = {ri, ck: blk[0]}; UI.ck = blk[blk.length - 1]; UI.full = full; paintSel();
}
function hideCols(){ const R = rng(), C = UI.C || [], ks = C.slice(R.c0, R.c1 + 1).map(c => c.k); if (ks.length >= C.length) return A.toast("One column at least stays shown", 1800);
  edit(() => { const h = WB().view.hide; ks.forEach(k => { if (!h.includes(k)) h.push(k); }); }, true); UI.anc = null; UI.full = null; paintSel(true);
  A.toast(ks.length + " column" + (ks.length > 1 ? "s" : "") + " hidden — Show all brings " + (ks.length > 1 ? "them" : "it") + " back", 2200); }
async function insertUserCol(k, right){
  const v = await A.ask("Insert a column", `<div class="grid"><div class="fg"><label>Name</label><input type="text" id="wbNc" placeholder="e.g. Remarks, Floor, Drawing ref"></div><div class="fg"><label>Kind</label><select id="wbNk"><option value="text">Text</option><option value="num">Number (totalled)</option></select></div></div>`, "Insert",
    () => { const n = document.getElementById("wbNc").value.trim(); return n ? {n, kind: document.getElementById("wbNk").value} : "Give the column a name"; }, "wbNc");
  if (!v) return; const c = {id: nid("C"), name: v.n, kind: v.kind}, key = "u:" + c.id;
  edit(() => { const wb = WB(); wb.cols.push(c); const all = colsAll().map(x => x.k).filter(x => x !== key), i = all.indexOf(k); all.splice(i < 0 ? all.length : i + (right ? 1 : 0), 0, key); wb.view.order = all; });
  UI.ck = key; UI.anc = null; UI.full = null; paintSel();
}
async function renameUserCol(k){ const c = WB().cols.find(x => "u:" + x.id === k); if (!c) return;
  const v = await A.ask("Rename column", `<div class="fg"><label>Name</label><input type="text" id="wbNc" value="${A.esc(c.name || "")}"></div>`, "Save", () => { const n = document.getElementById("wbNc").value.trim(); return n ? {n} : "Give the column a name"; }, "wbNc");
  if (v) edit(() => { c.name = v.n; }, true); }
function deleteUserCol(k){ const wb = WB(), i = wb.cols.findIndex(x => "u:" + x.id === k); if (i < 0) return;
  edit(() => { const c = wb.cols.splice(i, 1)[0]; toBin({kind: "col", c, i}); }); A.toast("Column deleted — ♻ Recover brings it back with its figures", 2400); }
function sortKey(r, k, X){   // what a row sorts by in a column: a figure, or text (empty: null — last either way)
  const v = numOf(r, k, X); if (v != null && isFinite(v)) return v;
  const t = k === "unit" ? A.uL(r.unit || "") : k === "ref" ? "" : k.startsWith("u:") ? String((r.u || {})[k.slice(2)] || "") : String(r[k] || ""); return t.trim() ? t.trim() : null;
}
function sortCol(k, dir){   // the items sorted by a column — under each heading on their own (headings and notes stay where they are); several rows selected: those alone
  const s = secOf(UI.sec), X = UI.X, R = rng(), V = UI.V || [], c = (UI.C || []).find(x => x.k === k); if (!s || !V.length) return;
  const part = R.r1 > R.r0 && UI.full !== "col" && UI.full !== "all" ? new Set(V.slice(R.r0, R.r1 + 1)) : null;
  const cmp = (a, b) => { const x = sortKey(a, k, X), y = sortKey(b, k, X); if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, {numeric: true, sensitivity: "base"})) * dir; };
  edit(() => { let blk = []; const flush = () => { const its = blk.map(i => s.rows[i]).sort(cmp); blk.forEach((i, j) => { s.rows[i] = its[j]; }); blk = []; };
    s.rows.forEach((r, i) => { if (r.t === "head" || (part && !part.has(r))) return flush(); if (r.t === "item") blk.push(i); }); flush(); }, true);
  A.toast("Sorted " + (dir > 0 ? "A → Z" : "Z → A") + " by " + (c ? c.t : k) + (part ? " — the rows selected" : " — the items under each heading"), 2000);
}
function zoom(d){ const v = WB().view; v.zoom = d ? Math.min(200, Math.max(50, v.zoom + d)) : 100; A.save(); applyZoom(); }
function applyZoom(){ const g = $w(".wbGrid"), z = WB().view.zoom; if (g) g.style.zoom = z === 100 ? "" : String(z / 100); const b = $w(".wbZv"); if (b) b.textContent = z + " %"; }

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
  const V = clone(WB().vars), vals = varsOf();
  const row = (v, i) => `<tr data-i="${i}"><td><input type="text" data-k="name" value="${A.esc(v.name || "")}" placeholder="WASTE" style="width:110px"></td><td><input type="text" data-k="e" value="${A.esc(v.e || "")}" placeholder="1.05" style="width:140px"></td><td class="n">${vals[String(v.name || "").toUpperCase()] != null && isFinite(vals[String(v.name || "").toUpperCase()]) ? +vals[String(v.name || "").toUpperCase()].toFixed(6) : ""}</td><td><input type="text" data-k="note" value="${A.esc(v.note || "")}" placeholder="what it is" style="width:160px"></td><td><button class="rn" data-del="${i}">&times;</button></td></tr>`;
  const body = () => `<p class="small">Named figures for any quantity or rate formula: <code>=12*H*WASTE</code>. A name is letters, digits and _ (starting with a letter); a value may use the ones above it.</p><table class="asm"><thead><tr><th>Name</th><th>Value / formula</th><th class="n">Now</th><th>Note</th><th></th></tr></thead><tbody id="wbVb">${V.map(row).join("")}</tbody></table><button class="btn sm" id="wbVa" type="button">+ Variable</button>`;
  const read = () => { document.querySelectorAll("#wbVb tr").forEach(tr => { const v = V[+tr.dataset.i]; tr.querySelectorAll("[data-k]").forEach(inp => { v[inp.dataset.k] = inp.value.trim(); }); }); };
  const p = A.ask("Workbook variables", body(), "Save", () => { read(); const bad = V.find(v => v.name && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v.name)); return bad ? "“" + bad.name + "”: letters, digits and _ only, starting with a letter" : V.filter(v => v.name); });
  const wire = () => { document.getElementById("wbVa").onclick = () => { read(); V.push({name: "", e: "", note: ""}); document.getElementById("wbVb").innerHTML = V.map(row).join(""); wire(); };
    document.querySelectorAll("#wbVb [data-del]").forEach(b => b.onclick = () => { read(); V.splice(+b.dataset.del, 1); document.getElementById("wbVb").innerHTML = V.map(row).join(""); wire(); }); };
  wire(); const v = await p; if (!v) return;
  edit(() => { const old = WB().vars, has = n => v.some(x => String(x.name).toUpperCase() === String(n).toUpperCase()); old.forEach((x, i) => { if (x.name && !has(x.name)) toBin({kind: "var", v: x, i}); }); WB().vars = v; });
}
async function colsDialog(){   // the columns: shown or hidden and in what order, the user columns, the split
  const wb = WB(), U = clone(wb.cols), vw = wb.view; let L = colsAll().map(c => ({k: c.k, t: c.t, on: !vw.hide.includes(c.k)})), reset = false;
  const urow = (c, i) => `<tr data-i="${i}"><td><input type="text" data-k="name" value="${A.esc(c.name || "")}" placeholder="e.g. Remarks"></td><td><select data-k="kind"><option value="text"${c.kind !== "num" ? " selected" : ""}>Text</option><option value="num"${c.kind === "num" ? " selected" : ""}>Number (totalled)</option></select></td><td><button class="rn" type="button" data-del="${i}">&times;</button></td></tr>`;
  const lrow = (o, i) => `<tr><td><label class="pk"><input type="checkbox" data-on="${i}"${o.on ? " checked" : ""}> ${A.esc(o.t)}</label></td><td style="white-space:nowrap"><button class="rn" type="button" data-lu="${i}" title="Earlier (left)"${i ? "" : " disabled"}>&#8593;</button><button class="rn" type="button" data-ld="${i}" title="Later (right)"${i < L.length - 1 ? "" : " disabled"}>&#8595;</button></td></tr>`;
  const body = `<label class="pk"><input type="checkbox" id="wbSp"${vw.split ? " checked" : ""}> Show each total split into material, labour, plant and OH / profit (from the Rate Analysis rate or the build-up)</label>
    <div class="grid" style="align-items:start"><div class="fg"><h4 style="margin:12px 0 4px">Shown, in order (left to right)</h4><table class="asm"><tbody id="wbLo">${L.map(lrow).join("")}</tbody></table><button class="btn sm" type="button" id="wbLr" title="Every column shown, in its first order, widths and freeze as they came">Reset layout</button></div>
    <div class="fg"><h4 style="margin:12px 0 4px">User columns</h4><table class="asm"><tbody id="wbCb">${U.map(urow).join("")}</tbody></table><button class="btn sm" id="wbCa" type="button">+ Column</button></div></div>`;
  const readL = () => document.querySelectorAll("#wbLo [data-on]").forEach(b => { L[+b.dataset.on].on = b.checked; });
  const readU = () => document.querySelectorAll("#wbCb tr").forEach(tr => { const c = U[+tr.dataset.i]; tr.querySelectorAll("[data-k]").forEach(inp => { c[inp.dataset.k] = inp.value.trim(); }); });
  const p = A.ask("Columns", body, "Save", () => { readL(); readU(); if (!L.some(o => o.on)) return "One column at least stays shown"; return {C: U.filter(c => c.name), split: document.getElementById("wbSp").checked, order: L.map(o => o.k), hide: L.filter(o => !o.on).map(o => o.k), reset}; });
  const wire = () => { document.getElementById("wbCa").onclick = () => { readU(); U.push({id: nid("C"), name: "", kind: "text"}); document.getElementById("wbCb").innerHTML = U.map(urow).join(""); wire(); };
    document.querySelectorAll("#wbCb [data-del]").forEach(b => b.onclick = () => { readU(); U.splice(+b.dataset.del, 1); document.getElementById("wbCb").innerHTML = U.map(urow).join(""); wire(); });
    document.querySelectorAll("#wbLo [data-lu], #wbLo [data-ld]").forEach(b => b.onclick = () => { readL(); const i = +(b.dataset.lu || b.dataset.ld), j = b.dataset.lu ? i - 1 : i + 1; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; document.getElementById("wbLo").innerHTML = L.map(lrow).join(""); wire(); });
    document.getElementById("wbLr").onclick = () => { reset = true; L = colsBase().map(c => ({k: c.k, t: c.t, on: true})); document.getElementById("wbLo").innerHTML = L.map(lrow).join(""); wire(); }; };
  wire(); const v = await p; if (!v) return;
  edit(() => { wb.cols.forEach((c, i) => { if (!v.C.some(x => x.id === c.id)) toBin({kind: "col", c, i}); }); wb.cols = v.C; vw.split = v.split; vw.order = v.order; vw.hide = v.hide; if (v.reset) { vw.w = {}; vw.freeze = 0; vw.wrap = false; } });
}
async function revDialog(){
  const wb = WB(), X = calc();
  const body = `<p class="small">A revision keeps every row's quantity, rate and total as they are now — pick it in <b>Compare with…</b> to see what changed (by row and by section), or filter <b>Changed since revision</b>.</p>
    <div class="fg"><label>Keep the workbook now as</label><input type="text" id="wbRn" value="Rev ${wb.revs.length} — ${A.dmy(A.today())}"></div>
    ${wb.revs.length ? `<table class="sh" style="margin-top:8px"><thead><tr><th>Revision</th><th>Kept</th><th class="n">Grand total</th><th></th></tr></thead><tbody>${wb.revs.map((r, i) => `<tr><td>${A.esc(r.name)}</td><td>${A.dmy(r.at)}</td><td class="n">${money(r.grand)}</td><td><button class="rn" data-rdel="${i}" title="Delete (it waits in the bin: Recover)">&times;</button></td></tr>`).join("")}</tbody></table>` : ""}`;
  const p = A.ask("Revisions", body, "Keep revision", () => ({name: document.getElementById("wbRn").value.trim() || "Revision"}), "wbRn");   // (a dialog's text answer is its error: an object)
  document.querySelectorAll("[data-rdel]").forEach(b => b.onclick = () => { const i = +b.dataset.rdel; edit(() => { const g = wb.revs.splice(i, 1)[0]; if (g) toBin({kind: "rev", r: g}); if (g && g.id === UI.cmp) UI.cmp = ""; }); A.ask.cur && A.ask.cur(null); });
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
  document.querySelectorAll(".wbCk").forEach(d => d.onclick = () => { const x = L[+d.dataset.ck]; if (A.ask.cur) A.ask.cur(null); show(x.s, x.r, "qty"); });
  await p;
}
/* Find and replace (Ctrl+H): in descriptions, codes, units or every text — this section or the whole workbook */
async function replaceDialog(){
  const body = `<div class="grid"><div class="fg w2"><label>Find what</label><input type="text" id="wbFr" value="${A.esc(UI.q || "")}"></div><div class="fg w2"><label>Replace with</label><input type="text" id="wbFw"></div>
    <div class="fg"><label>Look in</label><select id="wbFin"><option value="desc">Descriptions</option><option value="code">Codes</option><option value="unit">Units</option><option value="text">Every text (codes, descriptions, units, notes, text columns)</option></select></div>
    <div class="fg"><label>Within</label><select id="wbFsc"><option value="sec"${secOf(UI.sec) ? "" : " disabled"}>This section</option><option value="all"${secOf(UI.sec) ? "" : " selected"}>The whole workbook</option></select></div>
    <div class="fg w2"><label class="pk"><input type="checkbox" id="wbFca"> Match case</label> <label class="pk"><input type="checkbox" id="wbFwh"> Match the entire cell</label></div></div>
    <div class="wbBA"><button class="btn sm" type="button" id="wbFall">Find all</button><span class="small" id="wbFn"></span></div><div id="wbFres" style="max-height:30vh;overflow:auto"></div>`;
  const read = () => ({f: document.getElementById("wbFr").value, w: document.getElementById("wbFw").value, in: document.getElementById("wbFin").value, sc: document.getElementById("wbFsc").value, ca: document.getElementById("wbFca").checked, wh: document.getElementById("wbFwh").checked});
  const p = A.ask("Find and replace", body, "Replace all", () => { const o = read(); return o.f ? o : "Type what to find"; }, "wbFr");
  document.getElementById("wbFall").onclick = () => { const o = read(), H = o.f ? finds(o) : []; document.getElementById("wbFn").textContent = H.length + " found";
    document.getElementById("wbFres").innerHTML = H.slice(0, 300).map((h, i) => `<div class="wbCk" data-fi="${i}">${A.esc(h.s.name)} · <b>${A.esc(h.f)}</b>: ${A.esc(String(h.get()).slice(0, 120))}</div>`).join("");
    document.querySelectorAll("#wbFres [data-fi]").forEach(d => d.onclick = () => { const h = H[+d.dataset.fi]; if (A.ask.cur) A.ask.cur(null); show(h.s, h.r, h.k); }); };
  const o = await p; if (!o) return; const H = finds(o); if (!H.length) return A.toast("“" + o.f + "” is not found", 2000);
  const esc = o.f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), re = new RegExp(o.wh ? "^" + esc + "$" : esc, o.ca ? "g" : "gi");
  edit(() => H.forEach(h => h.set(String(h.get()).replace(re, () => o.w)))); A.toast(H.length + " replaced — Ctrl+Z takes them back", 2400);
}
function finds(o){   // every cell of text that has what is looked for → [{s, r, f (its name), k (column), get, set}]
  const wb = WB(), S = o.sc === "sec" && secOf(UI.sec) ? [secOf(UI.sec)] : wb.secs, H = [], low = x => o.ca ? x : x.toLowerCase(), f = low(o.f);
  const hit = v => { v = String(v || ""); return o.wh ? low(v) === f : low(v).includes(f); };
  S.forEach(s => s.rows.forEach(r => {
    const F = o.in === "text" ? ["code", "desc", "unit", "note"].concat(wb.cols.filter(c => c.kind !== "num").map(c => "u:" + c.id)) : [o.in];
    F.forEach(k => { const get = () => k.startsWith("u:") ? (r.u || {})[k.slice(2)] || "" : r[k] || "", set = v => { if (k.startsWith("u:")) { r.u = r.u || {}; r.u[k.slice(2)] = v; } else r[k] = v; };
      if (hit(get())) H.push({s, r, k: k === "note" ? "desc" : k, f: k === "note" ? "note" : k.startsWith("u:") ? (wb.cols.find(c => "u:" + c.id === k) || {}).name || "column" : k === "desc" ? "description" : k, get, set}); }); }));
  return H;
}
async function goDialog(){
  const v = await A.ask("Go to", '<div class="fg"><label>A ref (2.15), a code, or words of a description</label><input type="text" id="wbGo" placeholder="e.g. 2.15, MAS-CFT, plaster"></div>', "Go", () => { const q = document.getElementById("wbGo").value.trim(); return q ? {q} : "Type a ref, a code or words"; }, "wbGo");
  if (v) goTo(v.q);
}
function goTo(q){   // a ref (section.item), a code, or words of a description → that row, made the active one
  q = String(q || "").trim(); if (!q) return false; const wb = WB(), lq = q.toLowerCase(); let hit = null;
  const m = /^(\d+)\.(\d+)$/.exec(q); if (m) { const s = wb.secs[+m[1] - 1], it = s && s.rows.filter(r => r.t === "item")[+m[2] - 1]; if (it) hit = {s, r: it}; }
  if (!hit) for (const s of wb.secs) { const r = s.rows.find(r => String(r.code || "").toLowerCase() === lq); if (r) { hit = {s, r}; break; } }
  if (!hit) for (const s of wb.secs) { const r = s.rows.find(r => String(r.desc || "").toLowerCase().includes(lq)); if (r) { hit = {s, r}; break; } }
  if (!hit) { A.toast("No row “" + q + "”", 1800); return false; }
  show(hit.s, hit.r); return true;
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
    const UC = wb.cols, vw = wb.view, sheets = [];
    // the section sheets' columns in the workbook's order (hidden ones hidden in Excel too), frozen as far as its frozen columns go
    const ord = arrange(["ref", "code", "desc", "qty", "unit", "rate", "tot"].concat(UC.map(c => "u:" + c.id)).map(k => ({k}))).map(c => c.k), ci = k => ord.indexOf(k) + 1, L = k => A.xlLetter(ci(k)), NC = ord.length;
    const TT = {ref: "Ref", code: "Code", desc: "Description", qty: "Qty", unit: "Unit", rate: "Rate", tot: "Total PKR"}, XW = {ref: 7, code: 14, desc: 60, qty: 13, unit: 7, rate: 13, tot: 16};
    const fzK = colsAll().filter(c => !vw.hide.includes(c.k)).slice(0, vw.freeze).map(c => c.k); let xs = 0; while (xs < NC && fzK.includes(ord[xs])) xs++;
    wb.secs.forEach((s, si) => {
      const nm = shName(s.name), ws = wbx.addWorksheet(nm, {views: [Object.assign({state: "frozen", ySplit: 3}, xs ? {xSplit: xs} : {})], pageSetup: {paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0}});
      ws.columns = ord.map(k => ({width: vw.w[k] > 0 ? Math.max(4, Math.round(vw.w[k] / 7)) : XW[k] || 16}));
      ord.forEach((k, i) => { if (vw.hide.includes(k)) ws.getColumn(i + 1).hidden = true; });
      ws.mergeCells("A1:" + A.xlLetter(Math.max(NC, 3)) + "1"); ws.getCell("A1").value = (s.code ? s.code + " — " : "") + s.name; ws.getCell("A1").font = {bold: true, size: 13};
      ws.getCell("A2").value = "Quantities live from the takeoff at " + A.dmy(A.today()) + (A.isM() ? " · metres" : " · feet") + " · Total = Qty × Rate"; ws.getCell("A2").font = {size: 9, color: {argb: "FF52514E"}};
      const hr = ws.getRow(3); hr.values = ord.map(k => TT[k] || (UC.find(c => "u:" + c.id === k) || {}).name || ""); hr.font = {bold: true, color: {argb: "FFFFFFFF"}}; hr.eachCell(c => { c.fill = HEAD; });
      let row = 4, n = 0; const first = row, heads = [];
      s.rows.forEach((r, i) => { const xr = ws.getRow(row), x = X.R.get(r.id) || {};
        if (r.t === "head") { xr.getCell(ci("code")).value = r.code || ""; xr.getCell(ci("desc")).value = (r.lvl ? "  ".repeat(r.lvl) : "") + (r.desc || ""); xr.font = {bold: true}; heads.push({row, r, i}); }
        else if (r.t === "note") { xr.getCell(ci("desc")).value = r.desc || ""; xr.getCell(ci("desc")).font = {italic: true}; }
        else { xr.getCell(ci("ref")).value = (si + 1) + "." + (++n); xr.getCell(ci("code")).value = r.code || ""; xr.getCell(ci("desc")).value = r.desc || ""; xr.getCell(ci("desc")).alignment = {wrapText: true, vertical: "top"};
          const q = xr.getCell(ci("qty")); q.value = x.q && x.q.v != null ? +A.uX(x.q.v, r.unit).toFixed(6) : null; q.numFmt = A.qFmt(r.unit); q.fill = BLUE;
          if (x.q && x.q.links) q.note = "Live from the takeoff: " + (r.qb || []).map(l => (l.desc || "") + (l.link ? " [" + linkOf(l.link, {v: new Map()}).name + "]" : " " + (l.e || "")) + (l.x && l.x !== "1" ? " × " + l.x : "")).join("; ");
          xr.getCell(ci("unit")).value = A.uL(r.unit || "");
          const rt = xr.getCell(ci("rate")); rt.value = x.r && x.r.v ? +A.uX(x.r.v, r.unit, 1).toFixed(4) : null; rt.numFmt = "#,##0.00"; rt.fill = BLUE; if (x.r && x.r.src) rt.note = x.r.src;
          const t = xr.getCell(ci("tot")), Q = L("qty") + row, P = L("rate") + row; t.value = {formula: `IF(ISNUMBER(${Q}),${Q},0)*IF(ISNUMBER(${P}),${P},0)`, result: x.t || 0}; t.numFmt = "#,##0.00"; t.fill = GREEN; }
        UC.forEach(c => { const v = (r.u || {})[c.id]; if (v == null || v === "") return; const cl = xr.getCell(ci("u:" + c.id)); cl.value = c.kind === "num" && NUMS.test(String(v)) ? +String(v).replace(/,/g, "") : v; });
        if (r.note) xr.getCell(ci("desc")).note = r.note;
        row++; });
      const last = row - 1, T = L("tot");
      heads.forEach(h => { let end = last; for (let j = h.i + 1; j < s.rows.length; j++) { const x = s.rows[j]; if (x.t === "head" && x.lvl <= h.r.lvl) { end = h.row + (j - h.i) - 1; break; } }
        const c = ws.getRow(h.row).getCell(ci("tot")); c.value = {formula: end > h.row ? `SUBTOTAL(9,${T}${h.row + 1}:${T}${end})` : "0", result: (X.R.get(h.r.id) || {}).t || 0}; c.numFmt = "#,##0.00"; c.font = {bold: true}; });
      const tr = ws.getRow(row); tr.getCell(ci("desc")).value = "Total " + s.name; tr.getCell(ci("tot")).value = {formula: last >= first ? `SUBTOTAL(9,${T}${first}:${T}${last})` : "0", result: X.S.get(s.id).t}; tr.getCell(ci("tot")).numFmt = "#,##0.00"; tr.font = {bold: true}; for (let k = 1; k <= NC; k++) tr.getCell(k).fill = GREY;
      sheets.push({s, nm, cell: T + row});
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
#wbRoot .wbBar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:5px 10px;background:#fff;border-bottom:1px solid var(--line,#dde5ee)}
#wbRoot .grpb{display:inline-flex;flex-wrap:wrap;gap:2px;padding-right:6px;border-right:1px solid var(--line,#dde5ee)}#wbRoot .wbQ{width:200px}
#wbRoot .wbBar .btn.on{background:#e8f0fe;border-color:#1a73e8;color:#0b57d0}#wbRoot .wbBadge{display:inline-block;min-width:16px;padding:0 4px;border-radius:8px;background:#d03b3b;color:#fff;font-size:10px;line-height:15px;text-align:center}
#wbRoot .wbFx{display:flex;align-items:center;gap:6px;padding:4px 10px;background:#fff;border-bottom:1px solid var(--line,#dde5ee)}
#wbRoot .wbNm{width:190px;flex:none;font:inherit;padding:3px 6px;border:1px solid var(--line,#dde5ee);border-radius:4px}
#wbRoot .wbFxL{font-style:italic;font-weight:700;color:var(--muted,#6b7d92);padding:0 6px;border-left:1px solid var(--line,#dde5ee);border-right:1px solid var(--line,#dde5ee)}
#wbRoot .wbFxI{flex:1;min-width:0;font:inherit;padding:3px 6px;border:1px solid var(--line,#dde5ee);border-radius:4px}#wbRoot .wbFxI[readonly]{background:#f6f8fc;color:#52606d}
#wbRoot .wbMain{flex:1;display:grid;grid-template-columns:220px 1fr 360px;min-height:0}#wbRoot .wbMain.np{grid-template-columns:220px 1fr}
#wbRoot .wbTree{background:#fff;border-right:1px solid var(--line,#dde5ee);overflow:auto;padding:6px}
#wbRoot .wbS{display:flex;justify-content:space-between;gap:6px;width:100%;text-align:left;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer;font:inherit}
#wbRoot .wbS b{font-weight:600;color:var(--muted,#6b7d92);font-size:11.5px}#wbRoot .wbS.on{background:#e8eefc;color:var(--purple,#4b3b8f)}#wbRoot .wbS:hover{background:#f2f5fb}
#wbRoot .wbS.drop{outline:2px dashed #1a73e8;outline-offset:-2px;background:#e8f0fe}
#wbRoot .wbTA{display:flex;gap:3px;margin-top:8px;flex-wrap:wrap}
#wbRoot .wbGridW{position:relative;overflow:auto;outline:none;background:#fff;scroll-padding-top:30px}#wbRoot .wbT2{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed}
#wbRoot .wbT2 th{position:sticky;top:0;background:#12263f;color:#fff;font-weight:600;padding:6px;text-align:left;z-index:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#wbRoot .wbT2 th.n,#wbRoot .wbT2 td.n{text-align:right}
#wbRoot .wbT2 td{border-bottom:1px solid #edf1f6;border-right:1px solid #f1f4f8;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:cell}
#wbRoot .wbSh th{cursor:pointer;user-select:none}#wbRoot .wbSh th.hs{background:#24507f;cursor:grab}#wbRoot .wbSh .rz{position:absolute;top:0;right:0;width:7px;height:100%;cursor:col-resize}#wbRoot .wbSh .rz:hover{background:rgba(255,255,255,.35)}
#wbRoot .wbSh .wbHa{position:absolute;top:50%;right:9px;transform:translateY(-50%);display:flex;gap:2px}#wbRoot .wbSh .wbHa.l{right:auto;left:4px}
#wbRoot .wbSh .wbHa button{width:18px;height:18px;padding:0;border:0;border-radius:3px;background:#fff;color:#12263f;font-size:9px;line-height:18px;cursor:pointer}#wbRoot .wbSh .wbHa button:hover{background:#ffe28a}#wbRoot .wbSh .wbHa button[disabled]{opacity:.35;cursor:default}
#wbRoot .wbSh th.fz{z-index:4}#wbRoot .wbSh td.fz{position:sticky;z-index:1;background:#fff}#wbRoot .wbSh .fzl{border-right:2px solid #9fb3c8}
#wbRoot .wbSh tr td.gut{position:sticky;left:0;z-index:1;background:#f3f5f8;color:#6b7d92;text-align:center;font-size:11px;cursor:pointer;user-select:none;padding:4px 2px;border-right:1px solid #dde3ea}
#wbRoot .wbSh th.gut{left:0;z-index:5;background:#0d1d31;cursor:pointer}#wbRoot .wbSh tfoot td.gut{background:#e6e9ee}
#wbRoot .wbT2 tr.head td{background:#f6f8fc}#wbRoot .wbT2 tr.head td[data-ck=desc]{padding-left:calc(6px + var(--lv) * 18px)}#wbRoot .wbT2 tr.note td{color:var(--muted,#6b7d92)}
#wbRoot .fo{border:0;background:none;padding:0 5px 0 0;cursor:pointer;font-size:10px;color:#52606d;font-family:inherit}#wbRoot .wbFold{color:var(--muted,#6b7d92);font-weight:400;font-size:11px;margin-left:8px}
#wbRoot .wbT2 td.lnk{color:#16723f}#wbRoot .wbT2 td.dead,#wbRoot .wbT2 td.err{color:var(--red,#d03b3b);background:#fff3f3}#wbRoot .wbT2 td.fx{color:#3550a8}#wbRoot .wbT2 td.bu{color:#7a4bb0}
#wbRoot .wbI{font-size:10px;margin-right:4px;opacity:.75}#wbRoot td.up{color:#b0392f}#wbRoot td.dn{color:#16723f}
#wbRoot .wbT2 tr.c-yellow td{background:#fff8d6}#wbRoot .wbT2 tr.c-green td{background:#e6f6ec}#wbRoot .wbT2 tr.c-red td{background:#fde9e7}#wbRoot .wbT2 tr.c-blue td{background:#e7f0ff}
#wbRoot .wbT2 tfoot td,#wbRoot .wbT2 tr.tot td{background:#e6e9ee;font-weight:600}#wbRoot .wbT2 tr.grand td{background:#12263f;color:#fff}
#wbRoot .wbT2.wrap td.tx{white-space:normal;overflow-wrap:anywhere;vertical-align:top}
#wbRoot .wbSh tr td.rs{background:#e8f0fe;box-shadow:inset 0 calc(var(--sT,0) * 2px) 0 #1a73e8,inset 0 calc(var(--sB,0) * -2px) 0 #1a73e8,inset calc(var(--sL,0) * 2px) 0 0 #1a73e8,inset calc(var(--sR,0) * -2px) 0 0 #1a73e8}
#wbRoot .wbSh td.rT{--sT:1}#wbRoot .wbSh td.rB{--sB:1}#wbRoot .wbSh td.rL{--sL:1}#wbRoot .wbSh td.rR{--sR:1}
#wbRoot .wbSh tr td.act{background:#fff;outline:2px solid #1a73e8;outline-offset:-2px}#wbRoot .wbSh tr td.gut.hs{background:#d3e3fd;color:#0b57d0;font-weight:700;cursor:grab}
#wbRoot .wbSh tr td.cut{outline:2px dashed #1a73e8;outline-offset:-3px}#wbRoot .wbSh tr td.fp{background:#f1f6ff;outline:1px dashed #1a73e8;outline-offset:-2px}
#wbRoot .wbSh td.fh:not(.fz){position:relative}#wbRoot .wbFh{position:absolute;right:0;bottom:0;width:7px;height:7px;background:#1a73e8;border:1px solid #fff;cursor:crosshair;z-index:3}
#wbRoot .wbMk{position:absolute;background:#1a73e8;z-index:6;pointer-events:none}#wbRoot .wbMk.h{height:3px;margin-top:-1px}#wbRoot .wbMk.v{width:3px;margin-left:-1px}
#wbRoot .wbT2.sum td{cursor:default}#wbRoot .wbT2.sum tr.mk td{white-space:normal;overflow:visible}#wbRoot .wbT2.sum tr.mk input,#wbRoot .wbT2.sum tr.mk select{width:auto;display:inline-block}#wbRoot .wbT2.sum tr.mk input[data-mf=name]{width:170px}#wbRoot .wbT2 tr.mk td{background:#fbfcfe}#wbRoot .wbE{color:var(--muted,#6b7d92);padding:24px!important;text-align:center;white-space:normal}
#wbRoot .wbEd{width:100%;border:0;outline:none;font:inherit;padding:0;background:#fff}
#wbRoot .wbPane{background:#fff;border-left:1px solid var(--line,#dde5ee);overflow:auto;padding:10px 12px}#wbRoot .wbPane h4{margin:2px 0 8px;font-size:13px}
#wbRoot .wbBox{border:1px solid var(--line,#dde5ee);border-radius:8px;padding:8px;margin-bottom:8px}#wbRoot .wbBH{display:flex;justify-content:space-between;margin-bottom:4px}
#wbRoot .wbQt{width:100%;border-collapse:collapse}#wbRoot .wbQt td{white-space:nowrap}#wbRoot .wbQt td span.lnk,#wbRoot .wbQt td span.dead{white-space:normal;display:inline-block;max-width:150px}#wbRoot .wbQt td,#wbRoot .wbQt th{padding:2px 3px;font-size:11.5px}#wbRoot .wbQt input,#wbRoot .wbQt select{width:100%;font-size:11.5px}
#wbRoot .wbBA{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px}#wbRoot .wbSeg{display:flex;gap:10px;margin:4px 0}#wbRoot .wbPane textarea{width:100%;font:inherit}
#wbRoot .wbPane .lnk{color:#16723f}#wbRoot .wbPane .dead{color:var(--red,#d03b3b)}#wbRoot .wbPane .err{color:var(--red,#d03b3b);margin:4px 0}#wbRoot .wbNt{color:var(--amber,#c9822a)}
#wbRoot .wbFoot{display:flex;align-items:center;gap:14px;padding:4px 12px;background:#fff;border-top:1px solid var(--line,#dde5ee);color:var(--muted,#6b7d92);font-size:11.5px}#wbRoot .wbFi{flex:1;min-width:0}#wbRoot .wbSt{white-space:nowrap}#wbRoot .wbSt b{color:var(--txt,#1e2b3a)}
#wbRoot .wbZm{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}#wbRoot .wbZm .rn{min-width:22px}
#wbRoot .wbMenu{position:fixed;z-index:12;background:#fff;border:1px solid #c9d3df;border-radius:8px;box-shadow:0 10px 30px rgba(15,41,66,.22);padding:4px;min-width:260px;max-height:84vh;overflow:auto;font-size:12.5px}
#wbRoot .wbMenu button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:4px 10px;border-radius:5px;text-align:left;font:inherit;cursor:pointer;color:inherit}
#wbRoot .wbMenu button:hover,#wbRoot .wbMenu button:focus{background:#e8f0fe;outline:none}#wbRoot .wbMenu button[disabled]{opacity:.45;cursor:default;background:none}
#wbRoot .wbMenu .ic{width:16px;text-align:center;flex:none}#wbRoot .wbMenu .tx{flex:1}#wbRoot .wbMenu .kb{color:#6b7d92;font-size:11px;white-space:nowrap}#wbRoot .wbMenu .sep{height:1px;background:#e3e8ef;margin:4px 6px}
.wbTabs{display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap}.wbTabs .btn.on{background:#12263f;color:#fff;border-color:#12263f}
.wbLc{border-bottom:1px solid var(--line,#dde5ee);padding:6px 2px}.wbLo{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.wbLi{padding:5px 4px;border-bottom:1px solid var(--line,#dde5ee);cursor:pointer}.wbLi:hover{background:#eef5ff}.wbLi .n{float:right;color:var(--muted,#6b7d92)}
.wbGrp{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}.wbCk{padding:5px;border-bottom:1px solid var(--line,#dde5ee);cursor:pointer}.wbCk.e b{color:var(--red,#d03b3b)}.wbCk.w b{color:var(--amber,#c9822a)}.wbCk:hover{background:#f2f5fb}
@media (max-width:1100px){#wbRoot .wbMain{grid-template-columns:170px 1fr}#wbRoot .wbPane{position:fixed;right:0;top:150px;bottom:24px;width:340px;box-shadow:-8px 0 24px rgba(0,0,0,.12)}}`;
  document.head.appendChild(st);
}

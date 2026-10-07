/* ZD PDF Takeoff — AutoCAD drawings (DWG and DXF) opened in the browser.
   The drawing is read here: DWG by LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web), DXF by dxf-json — both
   GPL-3.0, loaded from jsDelivr the first time a drawing is opened and then kept by the browser; the drawing itself is
   never uploaded. Model space is flattened (blocks with their attributes, dimensions, hatches, text, leaders) into a scene
   in page points, which is
   - drawn straight onto the canvas, only what is on screen and small things left out when zoomed out, so zoom and pan
     stay fast as in AutoCAD — on AutoCAD's black background with its colours, on white, or monochrome; and
   - written as a vector PDF of the same page with every AutoCAD layer an optional-content layer, so everything the takeoff
     does with a PDF (snapping, auto area, find text, the agents, exports) works on the drawing too.
   The page is laid out at a standard plot scale worked out from the drawing's units (INSUNITS), so the takeoff's scale is
   exact and needs no calibration. */
const LDWG = "https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.14/dist/libredwg-web.js";
const LDXF = "https://cdn.jsdelivr.net/npm/@mlightcad/dxf-json@1.2.8/dist/esm/bundle.mjs";
export const CAD_VER = 1;          // the scene's version: a drawing stored by an older one is read again from its DWG / DXF
export const INK = -1;             // colour 7 (and true black or white): white on a black background, black on white
export const isCadName = n => /\.(dwg|dxf)$/i.test(String(n || ""));
const PI2 = Math.PI * 2, CAP = 0.718, DESC = 0.207;   // Helvetica's cap height and descent, in em: AutoCAD's text height is a capital's

/* ------------------------------------------------------------------ colours, units, lineweights */
/* AutoCAD's 256 index colours, as AutoCAD's own lookup (EntityColor.LookUpRgb) gives them */
const ACI = (h => { const a = new Int32Array(256); for (let i = 0; i < 256; i++) a[i] = parseInt(h.substr(i * 6, 6), 16); return a; })(
  "000000ff0000ffff0000ff0000ffff0000ffff00ffffffff808080c0c0c0ff0000ff7f7fcc0000cc6666990000994c4c7f00007f3f3f4c00004c2626" +
  "ff3f00ff9f7fcc3300cc7f66992600995f4c7f1f007f4f3f4c13004c2f26ff7f00ffbf7fcc6600cc9966994c0099724c7f3f007f5f3f4c26004c3926" +
  "ffbf00ffdf7fcc9900ccb26699720099854c7f5f007f6f3f4c39004c4226ffff00ffff7fcccc00cccc6698980098984c7f7f007f7f3f4c4c004c4c26" +
  "bfff00dfff7f99cc00b2cc6672980085984c5f7f006f7f3f394c00424c267fff00bfff7f66cc0099cc664c980072984c3f7f005f7f3f264c00394c26" +
  "3fff009fff7f33cc007fcc662698005f984c1f7f004f7f3f134c002f4c2600ff007fff7f00cc0066cc660098004c984c007f003f7f3f004c00264c26" +
  "00ff3f7fff9f00cc3366cc7f0098264c985f007f1f3f7f4f004c13264c2f00ff7f7fffbf00cc6666cc9900984c4c9872007f3f3f7f5f004c26264c39" +
  "00ffbf7fffdf00cc9966ccb20098724c9885007f5f3f7f6f004c39264c4200ffff7fffff00cccc66cccc0098984c9898007f7f3f7f7f004c4c264c4c" +
  "00bfff7fdfff0099cc66b2cc0072984c8598005f7f3f6f7f00394c26424c007fff7fbfff0066cc6699cc004c984c7298003f7f3f5f7f00264c26394c" +
  "003fff7f9fff0033cc667fcc0026984c5f98001f7f3f4f7f00134c262f4c0000ff7f7fff0000cc6666cc0000984c4c9800007f3f3f7f00004c26264c" +
  "3f00ff9f7fff3300cc7f66cc2600985f4c981f007f4f3f7f13004c2f264c7f00ffbf7fff6600cc9966cc4c0098724c983f007f5f3f7f26004c39264c" +
  "bf00ffdf7fff9900ccb266cc720098854c985f007f6f3f7f39004c42264cff00ffff7fffcc00cccc66cc980098984c987f007f7f3f7f4c004c4c264c" +
  "ff00bfff7fdfcc0099cc66b2980072984c857f005f7f3f6f4c00394c2642ff007fff7fbfcc0066cc669998004c984c727f003f7f3f5f4c00264c2639" +
  "ff003fff7f9fcc0033cc667f980026984c5f7f001f7f3f4f4c00134c262f3333335b5b5b848484adadadd6d6d6ffffff");
export const aciRgb = i => { i = Math.abs(Math.round(+i)); return i === 7 || !(i >= 1 && i <= 255) ? INK : ACI[i]; };
const tcol = v => { v = (+v) & 0xffffff; return v === 0 || v === 0xffffff ? INK : v; };   // true black / white: ink, else invisible on one background
export const hex6 = c => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
/* the colour a style is drawn in: dark = AutoCAD's black model space, mono = everything in one ink */
export function cadCss(c, dark, mono){ return mono || c === INK ? (dark ? "#ffffff" : "#000000") : hex6(c); }

const USFT = 1200 / 3937 / 0.0254;   // US survey foot, in inches
export const UNIT_IN = [0, 1, 12, 63360, 1 / 25.4, 10 / 25.4, 1000 / 25.4, 1e6 / 25.4, 1e-6, 1e-3, 36, 1e-7 / 25.4, 1e-6 / 25.4, 1e-3 / 25.4,
  100 / 25.4, 1e4 / 25.4, 1e5 / 25.4, 1e12 / 25.4, 1.495978707e14 / 25.4, 9.4607304725808e18 / 25.4, 3.0856775814913673e19 / 25.4, USFT, USFT / 12, USFT * 3, USFT * 5280];
export const UNIT_NAME = ["unitless", "inches", "feet", "miles", "millimetres", "centimetres", "metres", "kilometres", "microinches", "mils", "yards",
  "ångströms", "nanometres", "microns", "decimetres", "decametres", "hectometres", "gigametres", "astronomical units", "light years", "parsecs",
  "US survey feet", "US survey inches", "US survey yards", "US survey miles"];
const METRIC = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
const IMPERIAL = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 120, 192, 240, 384, 480, 600, 960, 1200, 2400, 4800, 9600, 12000, 24000, 48000];
/* a DWG keeps lineweights as an index; DXF in hundredths of a mm. -1 ByLayer, -2 ByBlock, -3 the default (0.25 mm) */
const LW_IX = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const lwDwg = v => v == null || v === 29 ? -1 : v === 30 ? -2 : v >= 0 && v < LW_IX.length ? LW_IX[v] : -3;
const lwDxf = (v, dflt) => v == null || v === "" || !isFinite(+v) ? dflt : +v;
export const VERS = {AC1009: "R11 / R12", AC1012: "R13", AC1014: "R14", AC1015: "2000", AC1018: "2004", AC1021: "2007", AC1024: "2010", AC1027: "2013", AC1032: "2018"};

/* ------------------------------------------------------------------ text: Helvetica widths (WinAnsi), AutoCAD's codes */
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const WIN_HI = {0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140,
  0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159};
const winCode = cp => cp >= 32 && cp < 127 || cp >= 160 && cp <= 255 ? cp : WIN_HI[cp] || 0;
export const emW = s => { let w = 0; for (const ch of String(s)) { const c = winCode(ch.codePointAt(0)); w += c ? HELV[c - 32] : 556; } return w / 1000; };
/* %%c Ø, %%d °, %%p ±, %%nnn a character code, \U+XXXX a Unicode character; %%u / %%o / %%k (underline…) dropped */
export function acadStr(s){
  return String(s == null ? "" : s).replace(/%%%/g, "\u0000").replace(/%%(\d{3})/g, (m, d) => String.fromCharCode(+d)).replace(/%%[cC]/g, "Ø")
    .replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[uUoOkK]/g, "").replace(/\u0000/g, "%")
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/[\t\r\n]+/g, " ");
}
/* MTEXT's formatting codes stripped: the paragraphs it shows (\P a new line, \S1/2; a fraction, \~ a space, {…} groups) */
export function mtextLines(raw){
  const s = String(raw == null ? "" : raw); let out = "";
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const c = s[i + 1];
      if (c === "P" || c === "N") { out += "\n"; i += 2; continue; }
      if (c === "~") { out += " "; i += 2; continue; }
      if (c === "\\" || c === "{" || c === "}") { out += c; i += 2; continue; }
      if (c === "U" && s[i + 2] === "+" && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 3, 4))) { out += String.fromCharCode(parseInt(s.substr(i + 3, 4), 16)); i += 7; continue; }
      if (c === "S") { const e = s.indexOf(";", i + 2), b = e < 0 ? s.slice(i + 2) : s.slice(i + 2, e); if (/\d$/.test(out)) out += " "; out += b.replace(/\s*[\/#]\s*/, "/").replace(/\s*\^\s*/, " "); i = e < 0 ? s.length : e + 1; continue; }
      if ("LlOoKk".includes(c)) { i += 2; continue; }
      if ("fFHWQTACcpXa".includes(c)) { const e = s.indexOf(";", i + 2); i = e < 0 ? s.length : e + 1; continue; }
      i += 1; continue;
    }
    if (ch === "{" || ch === "}") { i++; continue; }
    out += ch; i++;
  }
  return out.split("\n");
}
const wrap = (s, w) => {   // words of a paragraph to lines no wider than w (em)
  const out = []; let cur = "";
  s.split(/(\s+)/).forEach(t => { if (!t) return; const n = cur + t; if (cur.trim() && emW(n.trimEnd()) > w) { out.push(cur.trimEnd()); cur = t.trimStart(); } else cur = n; });
  out.push(cur.trimEnd()); return out;
};
/* a string as WinAnsi bytes for the PDF's Helvetica (a character it has not: "?") */
const winHex = s => { let h = ""; for (const ch of String(s)) h += (winCode(ch.codePointAt(0)) || 63).toString(16).padStart(2, "0"); return h; };

/* ------------------------------------------------------------------ the readers (loaded on first use) */
const LIB = {};
export function cadUse(o){ Object.assign(LIB, o || {}); }   // tests / offline copies: the reader modules handed in
let dwgP = null, dxfP = null;
function dwgLib(){
  return dwgP || (dwgP = (async () => { const m = LIB.dwg || await import(LDWG), lib = await m.LibreDwg.create(LIB.dwgWasm), pr = Object.getPrototypeOf(lib);
    /* a field the reader trips on (it can trap inside the WebAssembly) is read as unset, rather than losing the whole drawing */
    Object.getOwnPropertyNames(pr).filter(k => /^dwg_dynapi_\w+_value$/.test(k) && typeof pr[k] === "function").forEach(k => { const f = pr[k];
      lib[k] = function(){ try { return f.apply(this, arguments); } catch (e) { return {success: false, data: undefined}; } }; });
    Object.getOwnPropertyNames(pr).filter(k => /^dwg_ptr_to_\w+_array$/.test(k) && typeof pr[k] === "function").forEach(k => { const f = pr[k];
      lib[k] = function(ptr, size){ if (!ptr || !(size >= 0 && size <= 4e6)) return []; try { return f.call(this, ptr, size); } catch (e) { return []; } }; });
    return {m, lib}; })()
    .catch(e => { dwgP = null; throw new Error("the DWG reader could not be loaded — check the internet connection (" + (e && e.message || e) + ")"); }));
}
function dxfLib(){
  return dxfP || (dxfP = (async () => LIB.dxf || await import(LDXF))()
    .catch(e => { dxfP = null; throw new Error("the DXF reader could not be loaded — check the internet connection (" + (e && e.message || e) + ")"); }));
}
const head = (u, n) => String.fromCharCode.apply(null, Array.from(u.subarray(0, n)));
/* a DWG / DXF file -> the drawing as one model (whichever the reader, the same fields) */
export async function cadRead(buf, name){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (/^AC1\d{3}/.test(head(u8, 6))) return readDwg(u8);
  if (/\.dwg$/i.test(name || "")) throw new Error("this is not a DWG file (it does not start like one — is it complete?)");
  return readDxf(u8);
}
async function readDwg(u8){
  const ver = head(u8, 6), {m, lib} = await dwgLib(), W = lib.wasmInstance;
  if (ver < "AC1012") throw new Error("AutoCAD " + (VERS[ver] || ver) + " drawings are too old for the DWG reader — save it again in AutoCAD as a newer DWG, or as DXF");
  let ptr = 0, err = 0;
  if (W && W.FS && typeof W.dwg_read_file === "function") {
    const fn = "/zd" + Date.now() % 1e9 + ".dwg";
    try { W.FS.writeFile(fn, u8); const r = W.dwg_read_file(fn); ptr = r && r.data; err = r && r.error || 0; }
    finally { try { W.FS.unlink(fn); } catch (e) {} }
  } else ptr = lib.dwg_read_data(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), m.Dwg_File_Type.DWG);
  const oom = m.Dwg_Error && m.Dwg_Error.OUTOFMEM ? err & m.Dwg_Error.OUTOFMEM : 0;
  if (!ptr || err >= 128) {
    try { if (ptr) (oom && W.dwg_abandon ? W.dwg_abandon(ptr) : lib.dwg_free(ptr)); } catch (e) {}
    throw new Error(oom ? "the drawing is too big for this browser's memory" : "the DWG could not be read" + (VERS[ver] ? " (AutoCAD " + VERS[ver] + " format)" : "") + (err ? " — reader error " + err : ""));
  }
  let db, st = {};
  try { const r = typeof lib.convertEx === "function" ? lib.convertEx(ptr) : {database: lib.convert(ptr)}; db = r.database; st = r.stats || {}; }
  finally { try { lib.dwg_free(ptr); } catch (e) {} }
  const md = normDwg(db); md.ver = ver; md.unk = st.unknownEntityCount || 0; md.warn = err; return md;   // (normDwg throws for a drawing that came out unreadable)
}
async function readDxf(u8){
  const M = await dxfLib(), P = new M.DxfParser();
  let dx;
  if (/^AutoCAD Binary DXF/.test(head(u8, 18))) dx = P.parseBuffer(u8);
  else { let t; try { t = new TextDecoder("utf-8", {fatal: true}).decode(u8); } catch (e) { t = new TextDecoder("windows-1252").decode(u8); } dx = P.parseSync(t); }
  if (!dx || !Array.isArray(dx.entities)) throw new Error("the DXF could not be read");
  return normDxf(dx);
}

/* ------------------------------------------------------------------ one model from either reader
   angles in radians, points [x, y], colours resolved to RGB (or INK), lineweights in 0.01 mm (or -1 / -2 / -3) */
const P2 = p => p ? [+p.x || 0, +p.y || 0] : [0, 0];
const P2n = p => p && (+p.x || +p.y) ? [+p.x || 0, +p.y || 0] : null;
function model(fmt, hv){
  const n = k => { const v = hv(k); return typeof v === "number" ? v : +v; };
  const u = Math.round(n("INSUNITS")) || 0;
  return {fmt, ver: "", units: u >= 0 && u <= 24 ? u : 0, badHeader: !(u >= 0 && u <= 24), metric: n("MEASUREMENT") === 1, ltscale: n("LTSCALE") > 0 ? n("LTSCALE") : 1,
    dimasz: (n("DIMASZ") > 0 ? n("DIMASZ") : 0.18) * (n("DIMSCALE") > 0 ? n("DIMSCALE") : 1), textsize: n("TEXTSIZE") > 0 ? n("TEXTSIZE") : 2.5, lunits: Math.round(n("LUNITS")) || 0,
    layers: new Map(), lorder: [], ltypes: new Map(), blocks: new Map(), bh: new Map(), ents: [], unk: 0, warn: 0};
}
function addLayer(md, name, c, aci, off, frozen, plot, lw, lt){
  name = String(name == null || name === "" ? "0" : name); const k = name.toUpperCase(); if (md.layers.has(k)) return;
  md.layers.set(k, {name, c, aci, off: !!off, frozen: !!frozen, plot: plot !== false, lw: lw == null ? -3 : lw, lt: String(lt || "CONTINUOUS").toUpperCase()}); md.lorder.push(k);
}
function addLtype(md, t){ const k = String(t && t.name || "").toUpperCase(); if (k) md.ltypes.set(k, (t.pattern || []).map(p => +p.elementLength || 0)); }
function normDwg(db){
  const H = db.header || {}, md = model("DWG", k => H[k]), T = db.tables || {};
  ((T.LAYER || {}).entries || []).forEach(l => { const ci = Math.abs(+l.colorIndex || 0), aci = ci >= 1 && ci <= 255;
    addLayer(md, l.name, aci ? aciRgb(ci) : typeof l.color === "number" ? tcol(l.color) : INK, aci ? ci : 0, l.off || +l.colorIndex < 0, l.frozen, l.plotFlag !== 0, lwDwg(l.lineweight), l.lineType); });
  ((T.LTYPE || {}).entries || []).forEach(t => addLtype(md, t));
  const st = {bogus: 0, real: 0}, paper = new Set();
  ((T.BLOCK_RECORD || {}).entries || []).forEach(b => { const k = String(b.name || "").toUpperCase(); if (b.handle) { md.bh.set(String(b.handle), k); if (/^\*PAPER_SPACE/.test(k)) paper.add(String(b.handle)); }
    if (k && !/^\*(MODEL|PAPER)_SPACE/.test(k)) md.blocks.set(k, {name: b.name, base: P2(b.basePoint), ents: normList(b.entities, true, {bogus: 0, real: 0})}); });
  // the reader lists the layouts' objects (title blocks, viewports) with the model's: only model space is drawn, as AutoCAD's zoom extents
  md.ents = normList((db.entities || []).filter(e => !(e && paper.has(String(e.ownerBlockRecordSoftId)))), true, st); md.bogus = st.bogus;
  if (st.bogus > 50 && st.bogus > 9 * st.real) throw new Error("this DWG came out unreadable in the browser's DWG reader (" + st.bogus.toLocaleString() + " of its objects could not be read) — open it in AutoCAD, save it again as DWG 2018 or as DXF (SAVEAS → DXF), and add that file");
  return md;
}
function normDxf(dx){
  const H = dx.header || {}, md = model("DXF", k => H["$" + k]), T = dx.tables || {};
  md.ver = String(H.$ACADVER || "");
  ((T.LAYER || {}).entries || []).forEach(l => { const ci = +l.colorIndex || 7, tc = typeof l.color === "number" ? l.color : null;
    addLayer(md, l.name, tc != null ? tcol(tc) : aciRgb(ci), Math.abs(ci), ci < 0, (+l.standardFlag || 0) & 1, l.isPlotting !== false, lwDxf(l.lineweight, -3), l.lineType); });
  ((T.LTYPE || {}).entries || []).forEach(t => addLtype(md, t));
  const paper = new Set();
  ((T.BLOCK_RECORD || {}).entries || []).forEach(r => { const k = String(r.name || "").toUpperCase(); if (r.handle) { md.bh.set(String(r.handle), k); if (/^\*PAPER_SPACE/.test(k)) paper.add(String(r.handle)); } });
  Object.values(dx.blocks || {}).forEach(b => { const k = String(b && b.name || "").toUpperCase(); if (k && !/^\*(MODEL|PAPER)_SPACE/.test(k)) md.blocks.set(k, {name: b.name, base: P2(b.position), ents: normList(b.entities, false)}); });
  md.ents = normList(dx.entities.filter(e => e && !e.isInPaperSpace && !paper.has(String(e.ownerBlockRecordSoftId || ""))), false);
  return md;
}
function normList(L, dwg, st){
  const out = [], seen = new Set(); let ins = null;
  if (dwg) (L || []).forEach(e => { if (e && e.type === "INSERT" && Array.isArray(e.attribs)) e.attribs.forEach(a => { if (a && a.handle) seen.add(String(a.handle)); }); });
  for (const e of L || []) {
    if (!e || !e.type || e.type === "SEQEND" || e.type === "VERTEX") continue;
    if (dwg && String(e.handle) === "0") { if (st) st.bogus++; continue; }
    if (st && e.type !== "VIEWPORT") st.real++;
    if (e.type === "ATTRIB") { if (dwg && seen.has(String(e.handle))) continue; const a = safeNorm(e, dwg); if (!dwg && ins && a.t === "ATTRIB") ins.att.push(a); else out.push(a); continue; }
    const n = safeNorm(e, dwg); out.push(n); ins = n.t === "INSERT" ? n : null;
  }
  return out;
}
function safeNorm(e, dwg){ try { return norm(e, dwg); } catch (er) { return {t: "SKIP", why: "unreadable " + String(e && e.type || "object").toLowerCase(), vis: true}; } }
const arr = a => Array.isArray(a) ? a.filter(Boolean) : [];
function ex3(e){   // the entity's extrusion when it is not +Z (a mirrored entity has 0,0,-1)
  const v = e.extrusionDirection; if (!v) return null;
  const x = +v.x || 0, y = +v.y || 0, z = +v.z || 0;
  return Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-9 || (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && z > 0) ? null : [x, y, z];
}
function norm(e, dwg){
  const A = v => (+v || 0) * (dwg ? 1 : Math.PI / 180), t = String(e.type);
  const o = {t, h: String(e.handle || ""), L: e.layer == null || e.layer === "" ? "0" : String(e.layer), aci: e.colorIndex == null ? 256 : +e.colorIndex,
    rgb: typeof e.color === "number" ? e.color : null, lw: dwg ? lwDwg(e.lineweight) : lwDxf(e.lineweight, -1),
    lt: e.lineType ? String(e.lineType).toUpperCase() : "BYLAYER", lts: +e.lineTypeScale > 0 ? +e.lineTypeScale : 1, vis: e.isVisible !== false, ex: ex3(e)};
  switch (t) {
    case "LINE": o.a = P2(e.startPoint); o.b = P2(e.endPoint); o.ex = null; break;
    case "XLINE": case "RAY": o.a = P2(e.firstPoint || e.position); o.d = P2(e.unitDirection || e.direction); o.ex = null; break;
    case "POINT": o.a = P2(e.position); o.ex = null; break;
    case "CIRCLE": o.c = P2(e.center); o.r = +e.radius || 0; break;
    case "ARC": o.c = P2(e.center); o.r = +e.radius || 0; o.a0 = A(e.startAngle); o.a1 = A(e.endAngle); break;
    case "ELLIPSE": o.c = P2(e.center); o.m = P2(e.majorAxisEndPoint); o.k = +e.axisRatio || 1; o.a0 = +e.startAngle || 0; o.a1 = e.endAngle == null ? PI2 : +e.endAngle; o.n = o.ex && o.ex[2] < 0 ? -1 : 1; o.ex = null; break;
    case "LWPOLYLINE": o.v = arr(e.vertices).map(v => [+v.x || 0, +v.y || 0, +v.bulge || 0, +v.startWidth || 0, +v.endWidth || 0]); o.closed = dwg ? !!(e.flag & 512) : !!(e.flag & 1); o.w = +e.constantWidth || 0; break;
    case "SPLINE": o.deg = +e.degree || 3; o.kn = (e.knots || []).map(Number); o.cp = arr(e.controlPoints).map(P2); o.wt = Array.isArray(e.weights) && e.weights.length ? e.weights.map(Number) : null;
      o.fp = arr(e.fitPoints).map(P2); { const Q = o.cp.length ? o.cp : o.fp, a = Q[0], b = Q[Q.length - 1];   // (a DWG's spline flags are not DXF's: closed = the ends meet)
        o.closed = !!(a && b && Q.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9 * (1 + Math.abs(a[0]) + Math.abs(a[1]))) || (!dwg && !!((+e.flag || 0) & 1)); } o.ex = null; break;
    case "TEXT": case "ATTRIB": case "ATTDEF": { const b = dwg && t !== "TEXT" ? e.text || {} : e, fl = +((dwg ? e.flags : e.attributeFlag) ?? e.flags ?? 0) || 0;
      o.s = acadStr(b.text); o.p = P2(b.startPoint); o.p2 = P2n(t === "TEXT" ? b.endPoint : b.endPoint || e.alignmentPoint); o.h = +b.textHeight || 0; o.rot = A(b.rotation);
      o.wf = +(b.xScale ?? b.scale) || 1; o.obl = A(b.obliqueAngle); o.ha = +(b.halign ?? b.horizontalJustification ?? b.horizontalAlignment) || 0;
      o.va = +(b.valign ?? b.verticalJustification ?? b.verticalAlignment) || 0; o.gen = +(b.generationFlag ?? b.textGenerationFlag) || 0;
      if (t !== "TEXT") { o.tag = String(e.tag || ""); o.inv = !!(fl & 1); o.cst = !!(fl & 2); if (t === "ATTDEF" && !o.cst) o.s = o.tag; }
      break; }
    case "MTEXT": { const d = P2n(e.direction); o.p = P2(e.insertionPoint); o.h = +(e.textHeight ?? e.height) || 0; o.w = +(e.rectWidth ?? e.width) || 0; o.att = +e.attachmentPoint || 1;
      o.rot = d ? Math.atan2(d[1], d[0]) : +e.rotation || 0; o.s = String(e.text || ""); o.ls = +e.lineSpacing > 0 ? +e.lineSpacing : 1; o.ex = null; break; }
    case "INSERT": o.n = String(e.name || ""); o.p = P2(e.insertionPoint); o.sx = +e.xScale || 1; o.sy = +e.yScale || 1; o.rot = A(e.rotation);
      o.nc = Math.max(1, +e.columnCount || 1); o.nr = Math.max(1, +e.rowCount || 1); o.cs = +e.columnSpacing || 0; o.rs = +e.rowSpacing || 0;
      o.att = dwg ? arr(e.attribs).map(a => safeNorm(a, true)).filter(a => a.t === "ATTRIB") : []; break;
    case "DIMENSION": o.n = String(e.name || ""); o.p = P2(e.insertionPoint); o.mv = +e.measurement || 0; o.tx = String(e.text || ""); o.ex = null; break;   // its block is drawn in world coordinates
    case "ACAD_TABLE": { const d = P2n(e.directionVector); o.n = String(e.name || ""); o.bh = e.blockRecordHandle ? String(e.blockRecordHandle) : ""; o.p = P2(e.startPoint); o.rot = d ? Math.atan2(d[1], d[0]) : 0; break; }
    case "HATCH": o.solid = +e.solidFill === 1 || /^_?SOLID$/i.test(e.patternName || ""); o.style = +e.hatchStyle || 0; o.name = String(e.patternName || "");
      o.loops = arr(e.boundaryPaths).map(b => hatchLoop(b, dwg)).filter(l => l.pts.length >= 3);
      o.pat = arr(e.definitionLines).map(d => ({a: A(d.angle), b: P2(d.base), o: P2(d.offset), d: (d.dashLengths || []).map(Number)}));
      o.grad = +e.gradientFlag === 1 ? gradColor(e) : null; break;
    case "SOLID": case "TRACE": o.q = (e.points ? arr(e.points) : [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean)).map(P2); break;
    case "3DFACE": o.q = (e.vertices ? arr(e.vertices) : [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean)).map(P2); o.ex = null; break;
    case "LEADER": o.v = arr(e.vertices).map(P2); o.arrow = e.isArrowheadEnabled !== false && e.isArrowheadEnabled !== 0; o.ex = null; break;
    case "MULTILEADER": case "MLEADER": { const cs = +e.contentScale || 1, d = P2n(e.textDirection); o.t = "MULTILEADER"; o.lines = []; o.ex = null;
      o.dog = []; arr(e.leaderSections).forEach(s => { const lp = P2n(s.lastLeaderLinePoint);
        arr(s.leaderLines).forEach(l => { const v = arr(l.vertices).map(P2); if (lp) v.push(lp); if (v.length >= 2) o.lines.push(v); });
        const dl = +(s.doglegLength ?? e.doglegLength) || 0; if (lp && s.doglegVector && e.doglegEnabled !== false && dl > 0) { const dv = P2(s.doglegVector); o.dog.push([lp, [lp[0] + dv[0] * dl, lp[1] + dv[1] * dl]]); } });
      o.asz = (+e.arrowheadSize || 0) * cs; o.s = e.hasMText !== false && e.textContent ? String(e.textContent) : ""; o.p = P2(e.textAnchor || e.contentBasePosition);
      o.h = (+e.textHeight || +e.arrowheadSize || 0) * cs; o.rot = d ? Math.atan2(d[1], d[0]) : +e.textRotation || 0; o.att = +e.textAttachmentPoint || 1; o.w = +e.textWidth || 0; break; }
    case "MLINE": { const V = dwg ? arr(e.vertices).map(v => ({p: P2(v.vertex), m: P2(v.miterDirection), el: arr(v.lines).map(l => +((l.segmentParams || [])[0]) || 0)}))
        : arr(e.segments).map(s => ({p: P2(s.position), m: P2(s.miterDirection), el: arr(s.elements).map(l => +((l.parameters || [])[0]) || 0)}));
      const ne = V.reduce((a, v) => Math.max(a, v.el.length), 0); o.closed = !!((+e.flags || 0) & 2); o.ml = []; o.ex = null;
      for (let j = 0; j < ne; j++) o.ml.push(V.map(v => [v.p[0] + v.m[0] * (v.el[j] || 0), v.p[1] + v.m[1] * (v.el[j] || 0)])); break; }
    default:
      if (/^POLYLINE/.test(t)) { const f = +e.flag || 0; o.t = "POLYLINE"; o.p3 = t === "POLYLINE3D" || !!(f & 8);
        if (f & 80 || /MESH|PFACE/.test(t)) { o.t = "SKIP"; o.why = f & 64 || /PFACE/.test(t) ? "polyface mesh" : "polygon mesh"; break; }
        o.v = arr(e.vertices).filter(v => !((+v.flag || 0) & 16)).map(v => [+v.x || 0, +v.y || 0, o.p3 ? 0 : +v.bulge || 0, +v.startWidth || 0, +v.endWidth || 0]);
        o.closed = !!(f & 1); o.w = +e.startWidth > 0 && +e.startWidth === +e.endWidth ? +e.startWidth : 0; if (o.p3) o.ex = null; break; }
      o.t = "SKIP"; o.why = t;
  }
  return o;
}
function gradColor(e){
  const g = arr(e.gradientColors)[0]; if (!g) return INK;
  return typeof g.rgb === "number" && (g.rgb & 0xffffff) ? tcol(g.rgb) : g.colorIndex >= 1 && g.colorIndex <= 255 ? aciRgb(g.colorIndex) : INK;
}
/* a hatch's boundary path as one closed list of points (arcs, ellipses and splines made into short lines) */
function hatchLoop(bp, dwg){
  const A = v => (+v || 0) * (dwg ? 1 : Math.PI / 180), pts = [], flag = +bp.boundaryPathTypeFlag || 0;
  if (Array.isArray(bp.vertices)) { const v = arr(bp.vertices).map(q => [+q.x || 0, +q.y || 0, +q.bulge || 0]); bulgeLoop(v, pts); return {pts, flag}; }
  arr(bp.edges).forEach(ed => {
    const seg = edgePts(ed, A); if (seg.length < 2) return;
    if (pts.length) { const l = pts[pts.length - 1], d0 = (l[0] - seg[0][0]) ** 2 + (l[1] - seg[0][1]) ** 2, n = seg.length - 1, d1 = (l[0] - seg[n][0]) ** 2 + (l[1] - seg[n][1]) ** 2; if (d1 < d0) seg.reverse(); }
    seg.forEach((p, i) => { if (i || !pts.length) pts.push(p); else { const l = pts[pts.length - 1]; if (Math.abs(l[0] - p[0]) + Math.abs(l[1] - p[1]) > 1e-9) pts.push(p); } });
  });
  if (pts.length > 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-9) pts.pop(); }
  return {pts, flag};
}
const sweepOf = (a0, a1) => { let s = (a1 - a0) % PI2; if (s <= 1e-12) s += PI2; return s; };
function edgePts(ed, A){
  const ty = +ed.type;
  if (ty === 1) return [P2(ed.start), P2(ed.end)];
  if (ty === 2 || ty === 3) {   // circular / elliptic arc: a clockwise one keeps its angles mirrored (AutoCAD's convention)
    const c = P2(ed.center), ccw = ed.isCCW !== false && ed.isCCW !== 0, a0 = A(ed.startAngle), a1 = A(ed.endAngle), sw = sweepOf(a0, a1);
    let ux, uy, vx, vy;
    if (ty === 2) { const r = +ed.radius || 0; ux = r; uy = 0; vx = 0; vy = r; }
    else { const m = P2(ed.end), k = +ed.lengthOfMinorAxis || 1; ux = m[0]; uy = m[1]; vx = -m[1] * k; vy = m[0] * k; }
    const t0 = ccw ? a0 : -a0, d = ccw ? sw : -sw, n = Math.max(4, Math.ceil(Math.abs(d) / PI2 * 72)), out = [];
    for (let i = 0; i <= n; i++) { const t = t0 + d * i / n, ct = Math.cos(t), st = Math.sin(t); out.push([c[0] + ux * ct + vx * st, c[1] + uy * ct + vy * st]); }
    return out;
  }
  if (ty === 4) { const cp = arr(ed.controlPoints); return splinePts({deg: +ed.degree || 3, kn: (ed.knots || []).map(Number), cp: cp.map(P2),
    wt: cp.some(p => p.weight != null) ? cp.map(p => +(p.weight ?? 1) || 1) : null, fp: arr(ed.fitDatum).map(P2)}); }
  return [];
}
function bulgeLoop(v, out){   // a closed polyline with bulges -> points
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n]; out.push([a[0], a[1]]);
    const B = a[2] || 0; if (Math.abs(B) < 1e-9) continue;
    const g = bulgeGeo(a[0], a[1], b[0], b[1], B); if (!g) continue;
    const m = Math.max(2, Math.ceil(Math.abs(g.th) / PI2 * 72));
    for (let j = 1; j < m; j++) { const t = g.a0 + g.th * j / m; out.push([g.cx + g.r * Math.cos(t), g.cy + g.r * Math.sin(t)]); }
  }
}
/* the arc of a polyline segment with a bulge (tan of a quarter of its included angle; + counter-clockwise) */
function bulgeGeo(x1, y1, x2, y2, b){
  const dx = x2 - x1, dy = y2 - y1, c = Math.hypot(dx, dy); if (c < 1e-12) return null;
  const th = 4 * Math.atan(b), r = c * (1 + b * b) / (4 * Math.abs(b)), h = c * (1 - b * b) / (4 * b);
  const cx = (x1 + x2) / 2 - dy / c * h, cy = (y1 + y2) / 2 + dx / c * h;
  return {cx, cy, r, th, a0: Math.atan2(y1 - cy, x1 - cx)};
}
/* a spline as points: from its control points and knots (rational de Boor), or through its fit points (Catmull-Rom) */
function splinePts(e){
  const P = e.cp || [], n = P.length;
  if (n >= 2) {
    const p = Math.max(1, Math.min(e.deg || 3, n - 1)); let U = e.kn;
    if (!U || U.length !== n + p + 1) { U = []; for (let i = 0; i <= n + p; i++) U.push(i <= p ? 0 : i >= n ? n - p : i - p); }
    const W = e.wt && e.wt.length === n ? e.wt : null, lo = U[p], hi = U[n], out = [];
    if (!(hi > lo)) return P.slice();
    const at = t => {
      let k = p; while (k < n - 1 && t >= U[k + 1]) k++;
      const X = [], Y = [], Z = [];
      for (let j = 0; j <= p; j++) { const i = k - p + j, w = W ? W[i] : 1; X[j] = P[i][0] * w; Y[j] = P[i][1] * w; Z[j] = w; }
      for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) { const i = k - p + j, d = U[i + p - r + 1] - U[i], a = d > 0 ? (t - U[i]) / d : 0;
        X[j] = (1 - a) * X[j - 1] + a * X[j]; Y[j] = (1 - a) * Y[j - 1] + a * Y[j]; Z[j] = (1 - a) * Z[j - 1] + a * Z[j]; }
      return [X[p] / Z[p], Y[p] / Z[p]];
    };
    for (let s = p; s < n; s++) { const a = U[s], b = U[s + 1]; if (!(b > a)) continue; for (let i = 0; i < 12; i++) out.push(at(a + (b - a) * i / 12)); }
    out.push(at(hi)); return out;
  }
  const F = (e.fp || []).filter((p, i, A) => !i || Math.hypot(p[0] - A[i - 1][0], p[1] - A[i - 1][1]) > 1e-12); if (F.length < 3) return F.slice();
  /* through its fit points: a C2 cubic with chord-length parameters and natural ends, as AutoCAD fits one by default */
  const n2 = F.length, T = [0]; for (let i = 1; i < n2; i++) T.push(T[i - 1] + Math.hypot(F[i][0] - F[i - 1][0], F[i][1] - F[i - 1][1]));
  const second = c => { const M = new Array(n2).fill(0); if (n2 < 3) return M; const a = [], b = [], d = [], r = [];
    for (let i = 1; i < n2 - 1; i++) { const h0 = T[i] - T[i - 1], h1 = T[i + 1] - T[i]; a.push(h0); b.push(2 * (h0 + h1)); d.push(h1); r.push(6 * ((F[i + 1][c] - F[i][c]) / h1 - (F[i][c] - F[i - 1][c]) / h0)); }
    for (let i = 1; i < b.length; i++) { const w = a[i] / b[i - 1]; b[i] -= w * d[i - 1]; r[i] -= w * r[i - 1]; }
    for (let i = b.length - 1; i >= 0; i--) M[i + 1] = (r[i] - (i + 1 < b.length ? d[i] * M[i + 2] : 0)) / b[i];
    return M; };
  const MX = second(0), MY = second(1), out = [F[0]];
  for (let i = 0; i < n2 - 1; i++) { const h = T[i + 1] - T[i];
    for (let s = 1; s <= 12; s++) { const u = s / 12, A = 1 - u, f = (Fv, Mv) => A * Fv[i] + u * Fv[i + 1] + ((A * A * A - A) * Mv[i] + (u * u * u - u) * Mv[i + 1]) * h * h / 6;
      out.push([f(F.map(p => p[0]), MX), f(F.map(p => p[1]), MY)]); } }
  return out;
}
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
function ocs(N){   // AutoCAD's arbitrary axis algorithm: an entity's own coordinate system (x and y as seen from above)
  const l = Math.hypot(N[0], N[1], N[2]) || 1, nx = N[0] / l, ny = N[1] / l, nz = N[2] / l;
  let ax, ay, az;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) { ax = nz; ay = 0; az = -nx; } else { ax = -ny; ay = nx; az = 0; }
  const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  return [ax, ay, ny * az - nz * ay, nz * ax - nx * az, 0, 0];
}
/* hatch pattern lines clipped to the boundary (even-odd) as [x0, y0, x1, y1, …]; null when there would be more than cap */
function patLines(loops, pats, cap){
  const E = []; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  loops.forEach(l => { const p = l.pts; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; E.push(a[0], a[1], b[0], b[1]);
    if (a[0] < x0) x0 = a[0]; if (a[0] > x1) x1 = a[0]; if (a[1] < y0) y0 = a[1]; if (a[1] > y1) y1 = a[1]; } });
  const out = [], sz = Math.max(x1 - x0, y1 - y0, 1e-9), C = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const P of pats) {
    const ux = Math.cos(P.a), uy = Math.sin(P.a), nx = -uy, ny = ux, s = P.o[0] * nx + P.o[1] * ny;
    if (!(Math.abs(s) > 1e-9 * sz)) continue;
    const bn = P.b[0] * nx + P.b[1] * ny; let lo = Infinity, hi = -Infinity; C.forEach(c => { const v = c[0] * nx + c[1] * ny; if (v < lo) lo = v; if (v > hi) hi = v; });
    const ka = (lo - bn) / s, kb = (hi - bn) / s, k0 = Math.ceil(Math.min(ka, kb)), k1 = Math.floor(Math.max(ka, kb));
    if (k1 - k0 > 20000 || (k1 - k0) * E.length > 2e8) return null;
    const D = P.d || [], t0 = D.reduce((a, v) => a + Math.abs(v), 0), dl = D.map(v => v === 0 ? t0 * 0.02 : Math.abs(v)), on = D.map(v => v >= 0), tot = dl.reduce((a, v) => a + v, 0);
    for (let k = k0; k <= k1; k++) {
      const qx = P.b[0] + k * P.o[0], qy = P.b[1] + k * P.o[1], ts = [];
      for (let i = 0; i < E.length; i += 4) { const sa = (E[i] - qx) * nx + (E[i + 1] - qy) * ny, sb = (E[i + 2] - qx) * nx + (E[i + 3] - qy) * ny;
        if ((sa > 0) !== (sb > 0)) { const ta = (E[i] - qx) * ux + (E[i + 1] - qy) * uy, tb = (E[i + 2] - qx) * ux + (E[i + 3] - qy) * uy; ts.push(ta + (tb - ta) * sa / (sa - sb)); } }
      if (ts.length < 2) continue; ts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const a = ts[i], b = ts[i + 1]; if (b - a < 1e-12) continue;
        if (!D.length || !(tot > 0)) out.push(qx + ux * a, qy + uy * a, qx + ux * b, qy + uy * b);
        else { let ph = ((a % tot) + tot) % tot, j = 0; while (ph >= dl[j] && j < D.length - 1) { ph -= dl[j]; j++; }
          let t = a, rem = dl[j] - ph;
          while (t < b) { const e2 = Math.min(b, t + rem); if (on[j] && e2 > t) out.push(qx + ux * t, qy + uy * t, qx + ux * e2, qy + uy * e2); t = e2; j = (j + 1) % D.length; rem = dl[j] || tot; if (out.length > cap * 4) return null; } }
        if (out.length > cap * 4) return null;
      }
    }
  }
  return out;
}
/* a drawing with no units set (INSUNITS 0): architectural / engineering units are inches; else its dimensions — the length
   each measures against its feet-inches text (12'-6") — say what one unit is. null: no evidence (then mm or inches is assumed) */
function ftInText(s){
  s = String(s || "").replace(/\s+/g, " ").trim(); let m = /^(-?\d+(?:\.\d+)?)\s*'(?:\s*-?\s*(\d+(?:\.\d+)?)?(?:\s*(\d+)\/(\d+))?\s*")?$/.exec(s);
  if (m) return +m[1] + ((m[2] ? +m[2] : 0) + (m[3] ? +m[3] / +m[4] : 0)) / 12;
  m = /^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"$/.exec(s); return m ? (+m[1] + (m[2] ? +m[2] / +m[3] : 0)) / 12 : null;
}
export function unitGuess(md, dimsOnly){
  if (!dimsOnly && (md.lunits === 3 || md.lunits === 4)) return {u: 1, how: "architectural units"};
  const votes = new Map(), C = [[12, 1], [1, 2], [304.8, 4], [30.48, 5], [0.3048, 6]];
  for (const e of md.ents) {
    if (e.t !== "DIMENSION" || !(e.mv > 0)) continue;
    let t = e.tx && e.tx !== "<>" && !/<>/.test(e.tx) ? e.tx : "";
    if (!t) { const b = md.blocks.get(String(e.n || "").toUpperCase()), te = b && b.ents.find(x => x.t === "MTEXT" || x.t === "TEXT"); t = te ? te.s : ""; }
    const ft = ftInText(acadStr(mtextLines(t)[0] || "")); if (!(ft > 0)) continue;
    const r = e.mv / ft, c = C.find(([v]) => Math.abs(r / v - 1) < 0.01); if (c) votes.set(c[1], (votes.get(c[1]) || 0) + 1);
    if ([...votes.values()].reduce((a, v) => a + v, 0) >= 40) break;
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0], tot = [...votes.values()].reduce((a, v) => a + v, 0);
  return best && best[1] >= 2 ? {u: best[0], how: "its dimensions (" + best[1] + " agree)", n: best[1], tot} : null;
}
const polyAreaS = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return s / 2; };
const inPoly = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };

/* ------------------------------------------------------------------ the scene: model space flattened into page points */
const MAX_OP = 4e6, MAX_HATCH = 2e6;
export function cadScene(md, opt){
  opt = opt || {};
  const T0 = Date.now(), skipped = {}, missing = {}; let bad = 0, trunc = false, hatchSegs = 0, junk = 0;
  const LAY = [], LIX = new Map();
  md.lorder.forEach(k => { LIX.set(k, LAY.length); LAY.push(md.layers.get(k)); });
  const lay = name => { const k = String(name || "0").toUpperCase(); let i = LIX.get(k); if (i === undefined) { i = LAY.length; LIX.set(k, i); LAY.push({name: String(name || "0"), c: INK, aci: 7, off: false, frozen: false, plot: true, lw: -3, lt: "CONTINUOUS"}); } return i; };
  const STY = [], SIX = new Map();
  const style = (c, lw, wid, dash, a) => { const key = c + "|" + lw + "|" + wid + "|" + (dash ? dash.join(",") : "") + "|" + a; let i = SIX.get(key); if (i === undefined) { i = STY.length; SIX.set(key, i); STY.push({c, lw, wid, dash, a}); } return i; };
  let OP = new Uint8Array(1 << 16), nOp = 0, XY = new Float64Array(1 << 17), nXy = 0, m = [1, 0, 0, 1, 0, 0], bx0, by0, bx1, by1, op0 = 0, q0 = 0, cur = -1;
  const PK = [], PL = [], PS = [], PE = [], PF = [], P0 = [], Q0 = [], BB = [], TX = [], XL = [], ENTS = [];   // PF: 1 hatch pattern lines, 2 a hatch's fill
  const room = k => { if (nOp + 1 > OP.length) { const b = new Uint8Array(OP.length * 2); b.set(OP); OP = b; } if (nXy + k > XY.length) { const b = new Float64Array(Math.max(XY.length * 2, nXy + k)); b.set(XY); XY = b; } };
  const pt = (x, y) => { const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5]; XY[nXy++] = X; XY[nXy++] = Y; if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Y < by0) by0 = Y; if (Y > by1) by1 = Y; };
  const beg = () => { op0 = nOp; q0 = nXy; bx0 = by0 = Infinity; bx1 = by1 = -Infinity; };
  const mv = (x, y) => { room(2); OP[nOp++] = 0; pt(x, y); };
  const ln = (x, y) => { room(2); OP[nOp++] = 1; pt(x, y); };
  const cv = (x1, y1, x2, y2, x3, y3) => { room(6); OP[nOp++] = 2; pt(x1, y1); pt(x2, y2); pt(x3, y3); };
  const cl = () => { room(0); OP[nOp++] = 3; };
  const LIM = 1e12, end = (kind, li, si, fl) => { if (nOp === op0) return;
    if (!(Math.abs(bx0) < LIM && Math.abs(bx1) < LIM && Math.abs(by0) < LIM && Math.abs(by1) < LIM)) { nOp = op0; nXy = q0; junk++; return; }
    PK.push(kind); PL.push(li); PS.push(si); PE.push(cur); PF.push(fl || 0); P0.push(op0); Q0.push(q0); BB.push(bx0, by0, bx1, by1); };
  /* the elliptic arc C + U cos t + V sin t from t0 through the signed sweep sw, as Béziers of at most 90°; how = 0 move, 1 line, 2 already there */
  const arc = (cx, cy, ux, uy, vx, vy, t0, sw, how) => {
    const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2) - 1e-9)), d = sw / n, k = 4 / 3 * Math.tan(d / 4);
    let c0 = Math.cos(t0), s0 = Math.sin(t0);
    if (how === 0) mv(cx + ux * c0 + vx * s0, cy + uy * c0 + vy * s0); else if (how === 1) ln(cx + ux * c0 + vx * s0, cy + uy * c0 + vy * s0);
    for (let i = 1; i <= n; i++) {
      const t = t0 + d * i, c1 = Math.cos(t), s1 = Math.sin(t), ax = cx + ux * c0 + vx * s0, ay = cy + uy * c0 + vy * s0, bx = cx + ux * c1 + vx * s1, by = cy + uy * c1 + vy * s1;
      cv(ax + k * (-ux * s0 + vx * c0), ay + k * (-uy * s0 + vy * c0), bx - k * (-ux * s1 + vx * c1), by - k * (-uy * s1 + vy * c1), bx, by); c0 = c1; s0 = s1;
    }
  };
  const poly = (v, closed) => {   // [[x, y, bulge], …]
    const n = v.length; if (n < 2) return; mv(v[0][0], v[0][1]);
    for (let i = 1; i < n + (closed ? 1 : 0); i++) { const a = v[i - 1], b = v[i % n], B = a[2] || 0;
      if (Math.abs(B) < 1e-9) { ln(b[0], b[1]); continue; } const g = bulgeGeo(a[0], a[1], b[0], b[1], B); if (g) arc(g.cx, g.cy, g.r, 0, 0, g.r, g.a0, g.th, 2); else ln(b[0], b[1]); }
    if (closed) cl();
  };
  const lines = P => { if (P.length < 2) return; mv(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ln(P[i][0], P[i][1]); };
  const dashFor = (name, lts, sc) => {   // a linetype as alternating dash / gap lengths (drawing units), or null for a continuous line
    if (!name || name === "CONTINUOUS" || name === "BYLAYER" || name === "BYBLOCK") return null;
    const d = md.ltypes.get(name); if (!d || !d.length) return null;
    const f = md.ltscale * lts * sc, t0 = d.reduce((a, v) => a + Math.abs(v), 0) * f; if (!(t0 > 0)) return null;
    const out = []; let last = null;
    d.forEach(v => { const on = v >= 0, len = v === 0 ? t0 * 0.03 : Math.abs(v) * f; if (on === last) out[out.length - 1] += len; else { out.push(len); last = on; } });
    if (d[0] < 0) { out.push(out.shift()); }   // start with a dash
    if (out.length % 2) { const a = out.pop(); out[0] += a; }
    return out.length >= 2 ? out.map(v => +v.toPrecision(6)) : null;
  };
  const res = (e, cx) => {   // layer, colour, lineweight and linetype as AutoCAD resolves them (ByLayer, ByBlock, layer 0 in a block)
    const nm = e.L === "0" && cx.L != null ? cx.L : e.L, li = lay(nm), Ly = LAY[li];
    const c = e.rgb != null ? tcol(e.rgb) : e.aci === 0 ? cx.c : e.aci >= 1 && e.aci <= 255 ? aciRgb(e.aci) : Ly.c;
    let lw = e.lw === -1 ? Ly.lw : e.lw === -2 ? cx.lw : e.lw; if (!(lw >= 0)) lw = -3;
    return {nm, li, c, lw, lt: e.lt === "BYLAYER" || !e.lt ? Ly.lt : e.lt === "BYBLOCK" ? cx.lt : e.lt};
  };
  const text = (s, x, y, em, rot, wf, obl, li, c, mx, my) => {   // a line of text, its baseline starting at (x, y), em high
    if (!s || !(em > 0) || TX.length > 400000) return;
    const cr = Math.cos(rot), sr = Math.sin(rot), to = Math.tan(obl || 0);
    let axx = cr * em * wf, axy = sr * em * wf, ayx = (-sr + cr * to) * em, ayy = (cr + sr * to) * em;
    if (mx) { axx = -axx; axy = -axy; } if (my) { ayx = -ayx; ayy = -ayy; }
    const t = {s, li, c, e: cur, o: [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]], ax: [m[0] * axx + m[2] * axy, m[1] * axx + m[3] * axy], ay: [m[0] * ayx + m[2] * ayy, m[1] * ayx + m[3] * ayy]};
    if (![...t.o, ...t.ax, ...t.ay].every(v => Math.abs(v) < 1e12)) { junk++; return; } TX.push(t);
  };
  const textEnt = (e, r) => {
    const h = e.h > 0 ? e.h : md.textsize; let em = h / CAP, wf = e.wf || 1, rot = e.rot, ox = e.p[0], oy = e.p[1];
    const W = emW(e.s) * em * wf, q = e.p2 || e.p;   // (AutoCAD's alignment point: centre, right, middle…)
    if ((e.ha === 3 || e.ha === 5) && e.p2) {   // aligned / fit: between the two points
      const dx = q[0] - e.p[0], dy = q[1] - e.p[1], L = Math.hypot(dx, dy);
      if (L > 1e-9 && W > 0) { rot = Math.atan2(dy, dx); if (e.ha === 5) wf *= L / W; else em *= L / W; }
    } else if (e.ha || e.va) {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const dx = e.ha === 1 || e.ha === 4 ? -W / 2 : e.ha === 2 ? -W : 0, dy = e.ha === 4 ? -h / 2 : e.va === 3 ? -h : e.va === 2 ? -h / 2 : e.va === 1 ? DESC * em : 0;
      ox = q[0] + cr * dx - sr * dy; oy = q[1] + sr * dx + cr * dy;
    }
    text(e.s, ox, oy, em, rot, wf, e.obl, r.li, r.c, e.gen & 2, e.gen & 4);
  };
  const mtextEnt = (e, r) => {
    const h = e.h > 0 ? e.h : md.textsize, em = h / CAP, L = [], wMax = e.w > 0 ? e.w / em : 0;
    mtextLines(e.s).forEach(p => { p = acadStr(p); if (wMax > 0) wrap(p, wMax).forEach(l => L.push(l)); else L.push(p); });
    const pitch = h * 5 / 3 * (e.ls || 1), n = L.length, col = (e.att - 1) % 3, row = Math.floor((e.att - 1) / 3), cr = Math.cos(e.rot), sr = Math.sin(e.rot);
    const y0 = row <= 0 ? -h : row === 1 ? ((n - 1) * pitch + h) / 2 - h : (n - 1) * pitch;
    L.forEach((l, i) => { if (!l.trim()) return; const lw = emW(l) * em, dx = col === 0 ? 0 : col === 1 ? -lw / 2 : -lw, dy = y0 - i * pitch;
      text(l, e.p[0] + cr * dx - sr * dy, e.p[1] + sr * dx + cr * dy, em, e.rot, 1, 0, r.li, r.c); });
  };
  const arrow = (tip, from, sz, li, c) => {   // a closed filled arrowhead at tip, pointing away from `from`
    const dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.hypot(dx, dy); if (!(l > 0) || !(sz > 0)) return;
    const ux = dx / l, uy = dy / l, bx = tip[0] - ux * sz, by = tip[1] - uy * sz, w = sz / 6;
    beg(); mv(tip[0], tip[1]); ln(bx - uy * w, by + ux * w); ln(bx + uy * w, by - ux * w); cl(); end(1, li, style(c, -3, 0, null, 1));
  };
  const stk = [];
  const block = (name, mat, child, e) => {   // a block's entities drawn through mat
    const k = String(name || "").toUpperCase(), b = md.blocks.get(k); if (!b) { if (name) missing[name] = (missing[name] || 0) + 1; return; }
    if (stk.includes(k) || stk.length > 24) return;
    const m0 = m, base = b.base; m = mul(m, mul(mat, [1, 0, 0, 1, -base[0], -base[1]])); stk.push(k);
    try { for (const be of b.ents) { if (be.t === "ATTDEF" && !be.cst) continue; ent(be, child); } } finally { stk.pop(); m = m0; }
    if (e && cur >= 0 && child.d === 1 && ENTS[cur]) ENTS[cur].n = b.name;
  };
  const ent = (e, cx) => {
    if (!e || e.vis === false) return;
    if (e.t === "SKIP") { if (e.why && e.why !== "VIEWPORT") skipped[e.why] = (skipped[e.why] || 0) + 1; return; }
    if (nOp > MAX_OP) { trunc = true; return; }
    if (e.t === "ATTRIB" && e.inv) return;
    const r = res(e, cx), m0 = m; if (e.ex) m = mul(m, ocs(e.ex));
    const rec = cx.d === 0 ? ENTS[cur] : null; if (rec) rec.L = r.li;
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1, stroke = wid => style(r.c, r.lw, (wid || 0) * sc, dashFor(r.lt, e.lts, sc), 1);   // (a scaled block scales its dashes and widths too)
    try {
      switch (e.t) {
        case "LINE": beg(); mv(e.a[0], e.a[1]); ln(e.b[0], e.b[1]); end(0, r.li, stroke()); if (rec) rec.len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); break;
        case "POINT": beg(); mv(e.a[0], e.a[1]); ln(e.a[0], e.a[1]); end(3, r.li, style(r.c, -3, 0, null, 1)); break;
        case "CIRCLE": if (!(e.r > 0)) break; beg(); arc(e.c[0], e.c[1], e.r, 0, 0, e.r, 0, PI2, 0); cl(); end(0, r.li, stroke());
          if (rec) { rec.len = PI2 * e.r; rec.area = Math.PI * e.r * e.r; rec.cl = true; } break;
        case "ARC": { if (!(e.r > 0)) break; const sw = sweepOf(e.a0, e.a1); beg(); arc(e.c[0], e.c[1], e.r, 0, 0, e.r, e.a0, sw, 0); end(0, r.li, stroke()); if (rec) rec.len = e.r * sw; break; }
        case "ELLIPSE": { const ux = e.m[0], uy = e.m[1], vx = -uy * e.k * e.n, vy = ux * e.k * e.n, sw = sweepOf(e.a0, e.a1), full = sw > PI2 - 1e-9;
          beg(); arc(e.c[0], e.c[1], ux, uy, vx, vy, e.a0, sw, 0); if (full) cl(); end(0, r.li, stroke());
          if (rec) { const a = Math.hypot(ux, uy), b = a * Math.abs(e.k); rec.len = full ? Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) : (() => { let s = 0, px = e.c[0] + ux * Math.cos(e.a0) + vx * Math.sin(e.a0), py = e.c[1] + uy * Math.cos(e.a0) + vy * Math.sin(e.a0); for (let i = 1; i <= 64; i++) { const t = e.a0 + sw * i / 64, x = e.c[0] + ux * Math.cos(t) + vx * Math.sin(t), y = e.c[1] + uy * Math.cos(t) + vy * Math.sin(t); s += Math.hypot(x - px, y - py); px = x; py = y; } return s; })();
            if (full) { rec.area = Math.PI * a * b; rec.cl = true; } } break; }
        case "LWPOLYLINE": case "POLYLINE": {
          const v = e.v; if (v.length < 2) break;
          let w = e.w; if (!(w > 0)) { let s = 0, n = 0; v.forEach(q => { if (q[3] > 0 || q[4] > 0) { s += (q[3] + q[4]) / 2; n++; } }); if (n) w = s / n; }
          beg(); poly(v, e.closed); end(0, r.li, stroke(w > 0 ? w : 0));
          if (rec) { let len = 0, area = 0; const n = v.length;
            for (let i = 0; i < n - (e.closed ? 0 : 1); i++) { const a = v[i], b = v[(i + 1) % n], B = a[2] || 0, c = Math.hypot(b[0] - a[0], b[1] - a[1]);
              area += a[0] * b[1] - b[0] * a[1];
              if (Math.abs(B) < 1e-9) len += c; else { const g = bulgeGeo(a[0], a[1], b[0], b[1], B); if (g) { len += g.r * Math.abs(g.th); area += g.r * g.r * (g.th - Math.sin(g.th)); } else len += c; } }
            rec.len = len; if (e.closed) { rec.area = Math.abs(area / 2); rec.cl = true; } }
          break; }
        case "SPLINE": { const P = splinePts(e); if (P.length < 2) break; beg(); lines(P); if (e.closed) cl(); end(0, r.li, stroke());
          if (rec) { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); rec.len = s; if (e.closed) { rec.area = Math.abs(polyAreaS(P)); rec.cl = true; } } break; }
        case "TEXT": case "ATTRIB": case "ATTDEF": textEnt(e, r); if (rec && e.t !== "TEXT") rec.n = e.tag; break;
        case "MTEXT": mtextEnt(e, r); break;
        case "INSERT": {
          const child = {L: r.nm, c: r.c, lw: r.lw, lt: r.lt, sc: cx.sc * Math.sqrt(Math.abs(e.sx * e.sy)), d: cx.d + 1}, cr = Math.cos(e.rot), sr = Math.sin(e.rot);
          for (let i = 0; i < e.nr; i++) for (let j = 0; j < e.nc; j++) { const ox = j * e.cs, oy = i * e.rs;
            block(e.n, [cr * e.sx, sr * e.sx, -sr * e.sy, cr * e.sy, e.p[0] + cr * ox - sr * oy, e.p[1] + sr * ox + cr * oy], child, e); }
          if (rec) { rec.n = rec.n || e.n; rec.at = [m[0] * e.p[0] + m[2] * e.p[1] + m[4], m[1] * e.p[0] + m[3] * e.p[1] + m[5]]; rec.att = e.att.filter(a => a.tag).map(a => [a.tag, a.s]); }
          m = m0; e.att.forEach(a => ent(a, Object.assign({}, child, {d: cx.d + 1})));
          break; }
        case "DIMENSION": block(e.n, [1, 0, 0, 1, e.p[0], e.p[1]], {L: r.nm, c: r.c, lw: r.lw, lt: r.lt, sc: cx.sc, d: cx.d + 1}); break;
        case "ACAD_TABLE": { const cr = Math.cos(e.rot), sr = Math.sin(e.rot); block(md.bh.get(e.bh) || e.n, [cr, sr, -sr, cr, e.p[0], e.p[1]], {L: r.nm, c: r.c, lw: r.lw, lt: r.lt, sc: cx.sc, d: cx.d + 1}); break; }
        case "HATCH": {
          let L = e.loops; if (!L.length) break; if (e.style === 2) { const o = L.filter(l => l.flag & 17); if (o.length) L = o; }
          const fill = (c, a) => { beg(); L.forEach(l => { const p = l.pts; mv(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ln(p[i][0], p[i][1]); cl(); }); end(2, r.li, style(c, -3, 0, null, a), 2); };
          if (e.solid || e.grad != null) fill(e.grad != null && !e.solid ? e.grad : r.c, 1);
          else { const S = e.pat.length && hatchSegs < MAX_HATCH ? patLines(L, e.pat, 60000) : null;
            if (!S) fill(r.c, 0.3);
            else if (S.length) { hatchSegs += S.length / 4; beg(); for (let i = 0; i < S.length; i += 4) { mv(S[i], S[i + 1]); ln(S[i + 2], S[i + 3]); } end(0, r.li, style(r.c, r.lw, 0, null, 1), 1); } }
          if (rec) { let a = 0; const LB = L.map(l => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; l.pts.forEach(q => { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }); return [x0, y0, x1, y1]; });
            L.forEach((l, i) => { const A = Math.abs(polyAreaS(l.pts)), q = l.pts[0]; let inside = 0;
              for (let j = 0; j < L.length; j++) { const b = LB[j]; if (j !== i && q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3] && inPoly(q, L[j].pts)) inside++; } a += inside % 2 ? -A : A; });
            rec.area = Math.abs(a); rec.cl = true; rec.n = e.name; rec.loops = L.map(l => l.pts.map(p => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]])); }
          break; }
        case "SOLID": case "TRACE": { const q = e.q; if (q.length < 3) break; const Q = q.length >= 4 ? [q[0], q[1], q[3], q[2]] : q;
          beg(); lines(Q); cl(); end(1, r.li, style(r.c, -3, 0, null, 1)); if (rec) { rec.area = Math.abs(polyAreaS(Q)); rec.cl = true; } break; }
        case "3DFACE": if (e.q.length < 3) break; beg(); lines(e.q); cl(); end(0, r.li, stroke()); break;
        case "LEADER": if (e.v.length < 2) break; beg(); lines(e.v); end(0, r.li, stroke()); if (e.arrow) arrow(e.v[0], e.v[1], md.dimasz, r.li, r.c); break;
        case "MULTILEADER": e.lines.forEach(v => { beg(); lines(v); end(0, r.li, stroke()); arrow(v[0], v[1], e.asz, r.li, r.c); }); e.dog.forEach(v => { beg(); lines(v); end(0, r.li, stroke()); });
          if (e.s) mtextEnt({p: e.p, h: e.h, w: e.w, att: e.att, rot: e.rot, s: e.s, ls: 1}, r); break;
        case "MLINE": e.ml.forEach(P => { beg(); lines(P); if (e.closed) cl(); end(0, r.li, stroke()); }); break;
        case "XLINE": case "RAY": { const d = [m[0] * e.d[0] + m[2] * e.d[1], m[1] * e.d[0] + m[3] * e.d[1]], l = Math.hypot(d[0], d[1]); if (!(l > 0)) break;
          XL.push({p: [m[0] * e.a[0] + m[2] * e.a[1] + m[4], m[1] * e.a[0] + m[3] * e.a[1] + m[5]], d: [d[0] / l, d[1] / l], ray: e.t === "RAY", li: r.li, si: stroke(), e: cur}); break; }
      }
    } catch (er) { bad++; } finally { m = m0; }
  };
  const top = {L: null, c: INK, lw: -3, lt: "CONTINUOUS", sc: 1, d: 0};
  for (const e of md.ents) { if (trunc) break; cur = ENTS.length; ENTS.push({t: e.t, h: e.h, L: -1}); ent(e, top); }
  /* extents: everything drawn, less a few objects far away from the drawing (a stray block at 0,0 when the plan is at site coordinates) */
  const N = PK.length; let F = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (B, x0, y0, x1, y1) => { if (x0 < B[0]) B[0] = x0; if (y0 < B[1]) B[1] = y0; if (x1 > B[2]) B[2] = x1; if (y1 > B[3]) B[3] = y1; };
  for (let i = 0; i < N; i++) grow(F, BB[4 * i], BB[4 * i + 1], BB[4 * i + 2], BB[4 * i + 3]);
  TX.forEach(t => { const w = emW(t.s); grow(F, Math.min(t.o[0], t.o[0] + t.ax[0] * w), Math.min(t.o[1], t.o[1] + t.ax[1] * w), Math.max(t.o[0], t.o[0] + t.ax[0] * w), Math.max(t.o[1], t.o[1] + t.ax[1] * w)); });
  if (!isFinite(F[0])) F = [0, 0, 100, 100];
  let B = F.slice(), far = 0;
  if (N > 50) {
    const step = Math.max(1, Math.floor(N / 100000)), xs = [], ys = [];
    for (let i = 0; i < N; i += step) { xs.push((BB[4 * i] + BB[4 * i + 2]) / 2); ys.push((BB[4 * i + 1] + BB[4 * i + 3]) / 2); }
    const q = (a, f) => { a.sort((p, r) => p - r); return a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))]; };
    const lo = N > 2000 ? 0.01 : 0.003, X0 = q(xs, lo), X1 = q(xs, 1 - lo), Y0 = q(ys, lo), Y1 = q(ys, 1 - lo), S = Math.max(X1 - X0, Y1 - Y0, 1e-9), E = [X0 - S * 0.5, Y0 - S * 0.5, X1 + S * 0.5, Y1 + S * 0.5];
    if (F[2] - F[0] > 3 * (E[2] - E[0]) || F[3] - F[1] > 3 * (E[3] - E[1])) {
      const C = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < N; i++) { const b = 4 * i; if (BB[b + 2] < E[0] || BB[b] > E[2] || BB[b + 3] < E[1] || BB[b + 1] > E[3]) far++; else grow(C, Math.max(BB[b], E[0]), Math.max(BB[b + 1], E[1]), Math.min(BB[b + 2], E[2]), Math.min(BB[b + 3], E[3])); }
      if (isFinite(C[0])) B = C; else far = 0;
    }
  }
  if (B[2] - B[0] < 1e-9) { B[0] -= 0.5; B[2] += 0.5; } if (B[3] - B[1] < 1e-9) { B[1] -= 0.5; B[3] += 0.5; }
  /* the page: the drawing at a standard plot scale that fits about A0 (or, read again, exactly the page it was given the first time) */
  const inf = md.units ? null : unitGuess(md); let units = md.units || (inf ? inf.u : 0), unitFix = "";
  if (md.units && !(opt.map && opt.map.uIn > 0)) {   // the units the drawing says, checked against its dimensions: drawn in inches but saved as feet measures 12 times over
    const d = unitGuess(md, true), f0 = UNIT_IN[md.units];
    if (d && d.n >= 3 && d.n >= 0.8 * d.tot && f0 && UNIT_IN[d.u] && Math.abs(UNIT_IN[d.u] / f0 - 1) > 0.02) { units = d.u; unitFix = d.how + " — its units setting says " + UNIT_NAME[md.units]; }
  }
  const uIn0 = UNIT_IN[units] || 0, assumed = !uIn0, metricU = units >= 4 && units <= 7 || units >= 12 && units <= 17, MP = opt.map;
  const uIn = MP && MP.uIn > 0 ? MP.uIn : uIn0 || (md.metric ? 1 / 25.4 : 1);
  let Wd = B[2] - B[0], Hd = B[3] - B[1], den, k, W, H, ox, oy;
  if (MP && MP.den > 0 && MP.w > 0) { den = MP.den; k = 72 * uIn / den; W = MP.w; H = MP.h; ox = MP.ox; oy = MP.oy; Wd = (W - 2 * ox) / k; Hd = (H - 2 * oy) / k; B = [MP.x0, MP.y1 - Hd, MP.x0 + Wd, MP.y1]; }
  else { const land = Wd >= Hd, LONG = 3370, SHORT = 2384, fits = N2 => Wd * uIn * 72 / N2 <= (land ? LONG : SHORT) && Hd * uIn * 72 / N2 <= (land ? SHORT : LONG);
    den = (metricU || (assumed && md.metric) ? METRIC : IMPERIAL).find(fits) || Math.ceil(Math.max(Wd * uIn * 72 / (land ? LONG : SHORT), Hd * uIn * 72 / (land ? SHORT : LONG)));
    k = 72 * uIn / den; W = Math.max(Wd * k + 48, 300); H = Math.max(Hd * k + 48, 300); ox = (W - Wd * k) / 2; oy = (H - Hd * k) / 2; }
  const PX = x => ox + (x - B[0]) * k, PY = y => oy + (B[3] - y) * k;
  /* xlines and rays reach across the drawing */
  const R = [B[0] - Wd * 0.02, B[1] - Hd * 0.02, B[2] + Wd * 0.02, B[3] + Hd * 0.02];
  XL.forEach(x => { let t0 = x.ray ? 0 : -Infinity, t1 = Infinity;
    for (const [p, d, lo, hi] of [[x.p[0], x.d[0], R[0], R[2]], [x.p[1], x.d[1], R[1], R[3]]]) { if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) { t0 = 1; t1 = 0; } continue; } const a = (lo - p) / d, b = (hi - p) / d; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
    if (!(t1 > t0)) return; cur = x.e; m = [1, 0, 0, 1, 0, 0]; beg(); mv(x.p[0] + x.d[0] * t0, x.p[1] + x.d[1] * t0); ln(x.p[0] + x.d[0] * t1, x.p[1] + x.d[1] * t1); end(0, x.li, x.si); });
  /* final arrays in drawing order: fills, then lines, then points */
  if (MP) { far = 0; for (let i = 0; i < PK.length; i++) if (BB[4 * i + 2] < B[0] || BB[4 * i] > B[2] || BB[4 * i + 3] < B[1] || BB[4 * i + 1] > B[3]) far++; }
  const crop = far > 0, n0 = PK.length, keep = [], inB = i => !(BB[4 * i + 2] < B[0] || BB[4 * i] > B[2] || BB[4 * i + 3] < B[1] || BB[4 * i + 1] > B[3]);
  [1, 0, 3].forEach(pass => { for (let i = 0; i < n0; i++) { const kd = PK[i]; if ((pass === 1 ? kd === 1 || kd === 2 : kd === pass) && (!crop || inB(i))) keep.push(i); } });
  const n = keep.length; let nO = 0, nQ = 0;
  keep.forEach(i => { const e1 = i + 1 < n0 ? P0[i + 1] : nOp, f1 = i + 1 < n0 ? Q0[i + 1] : nXy; nO += e1 - P0[i]; nQ += f1 - Q0[i]; });
  const pg = {name: "Model", w: W, h: H, k, den, ptPerFt: 864 / den, x0: B[0], y1: B[3], ox, oy, n, kind: new Uint8Array(n), pf: new Uint8Array(n), lay: new Uint16Array(n), sty: new Uint32Array(n), ent: new Int32Array(n),
    p0: new Uint32Array(n + 1), q0: new Uint32Array(n + 1), bb: new Float32Array(4 * n), ops: new Uint8Array(nO), xy: new Float32Array(nQ)};
  let o2 = 0, q2 = 0;
  keep.forEach((i, j) => {
    const e1 = i + 1 < n0 ? P0[i + 1] : nOp, f1 = i + 1 < n0 ? Q0[i + 1] : nXy;
    pg.kind[j] = PK[i]; pg.pf[j] = PF[i]; pg.lay[j] = PL[i]; pg.sty[j] = PS[i]; pg.ent[j] = PE[i]; pg.p0[j] = o2; pg.q0[j] = q2;
    pg.ops.set(OP.subarray(P0[i], e1), o2); o2 += e1 - P0[i];
    for (let q = Q0[i]; q < f1; q += 2) { pg.xy[q2++] = PX(XY[q]); pg.xy[q2++] = PY(XY[q + 1]); }
    pg.bb[4 * j] = PX(BB[4 * i]); pg.bb[4 * j + 1] = PY(BB[4 * i + 3]); pg.bb[4 * j + 2] = PX(BB[4 * i + 2]); pg.bb[4 * j + 3] = PY(BB[4 * i + 1]);
  });
  pg.p0[n] = o2; pg.q0[n] = q2;
  pg.styles = STY.map(s => ({c: s.c, lw: s.lw >= 0 ? s.lw / 100 : 0.25, wid: s.wid > 0 ? s.wid * k : 0, dash: s.dash ? s.dash.map(v => v * k) : null, a: s.a}));
  const T = TX.filter(t => !crop || (t.o[0] >= B[0] && t.o[0] <= B[2] && t.o[1] >= B[1] && t.o[1] <= B[3])), tn = T.length;
  pg.tn = tn; pg.tS = T.map(t => t.s); pg.tL = new Uint16Array(tn); pg.tC = new Int32Array(tn); pg.tE = new Int32Array(tn); pg.tM = new Float32Array(6 * tn); pg.tW = new Float32Array(tn); pg.tB = new Float32Array(4 * tn);
  T.forEach((t, i) => {
    const w = emW(t.s), x = PX(t.o[0]), y = PY(t.o[1]), a = t.ax[0] * k, b = -t.ax[1] * k, c = t.ay[0] * k, d = -t.ay[1] * k;
    pg.tL[i] = t.li; pg.tC[i] = t.c; pg.tE[i] = t.e; pg.tW[i] = w; pg.tM.set([a, b, c, d, x, y], 6 * i);
    const xs = [x, x + a * w, x + c * CAP, x + a * w + c * CAP, x - c * DESC], ys = [y, y + b * w, y + d * CAP, y + b * w + d * CAP, y - d * DESC];
    pg.tB.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 4 * i);
  });
  const fu = uIn / 12;   // drawing units -> feet
  pg.ents = ENTS.map(r => { const o = {t: r.t, h: r.h, L: r.L}; if (r.n) o.n = r.n; if (r.len) o.len = r.len * fu; if (r.area) o.area = r.area * fu * fu; if (r.cl) o.cl = true;
    if (r.at) o.at = [PX(r.at[0]), PY(r.at[1])]; if (r.att && r.att.length) o.att = r.att; if (r.loops) o.loops = r.loops.map(l => l.map(p => [PX(p[0]), PY(p[1])])); return o; });
  pg.map = {den, x0: B[0], y1: B[3], ox, oy, w: W, h: H, uIn};
  return {ver: CAD_VER, fmt: md.fmt, dver: md.ver, units, uIn, assumed, unitHow: unitFix || (md.units ? "" : inf ? inf.how : ""), unitFix: !!unitFix, unitName: units ? UNIT_NAME[units] : md.metric ? "millimetres (assumed)" : "inches (assumed)", metric: !!md.metric,
    layers: LAY.map(l => ({name: l.name, c: l.c, aci: l.aci, off: l.off, frozen: l.frozen, plot: l.plot, lw: l.lw, lt: l.lt})), pages: [pg],
    stats: {ents: md.ents.length, prims: n, texts: tn, segs: nO, skipped, missing, far, junk: junk + (md.bogus || 0), trunc, bad, unk: md.unk || 0, warn: md.warn || 0, ms: Date.now() - T0}};
}

/* ------------------------------------------------------------------ the vector PDF (every AutoCAD layer an optional-content layer) */
/* the content stream written straight as bytes: millions of operators without a string for every number */
class Ops {
  constructor(n){ this.b = new Uint8Array(Math.max(1 << 16, Math.min(n || 0, 1 << 28))); this.n = 0; }
  room(k){ if (this.n + k <= this.b.length) return; let L = this.b.length * 2; while (L < this.n + k) L *= 2; const nb = new Uint8Array(L); nb.set(this.b.subarray(0, this.n)); this.b = nb; }
  s(t){ this.room(t.length); const b = this.b; let n = this.n; for (let i = 0; i < t.length; i++) b[n++] = t.charCodeAt(i) & 255; this.n = n; return this; }
  v(x){   // a number to 3 decimals (no exponent), then a space
    this.room(28); const b = this.b; let n = this.n, k = Math.round(x * 1000);
    if (!isFinite(k)) k = 0; if (k < 0) { b[n++] = 45; k = -k; }
    let ip = Math.floor(k / 1000), fp = k - ip * 1000;
    if (ip === 0) b[n++] = 48; else { const st = n; while (ip > 0) { b[n++] = 48 + ip % 10; ip = Math.floor(ip / 10); } for (let i = st, j = n - 1; i < j; i++, j--) { const t = b[i]; b[i] = b[j]; b[j] = t; } }
    if (fp) { b[n++] = 46; b[n++] = 48 + Math.floor(fp / 100); fp %= 100; if (fp) { b[n++] = 48 + Math.floor(fp / 10); fp %= 10; if (fp) b[n++] = 48 + fp; } }
    b[n++] = 32; this.n = n; return this;
  }
  bytes(){ return this.b.subarray(0, this.n); }
}
/* the page's drawing as PDF operators (y up), into w. o: {fk font key, A alpha -> ExtGState name, oc each layer in its
   optional-content group, hidden layers left out, style "color" | "mono" | "gray", lwk line widths times this (a plot keeps its
   mm widths), thin} */
function pdfOps(pg, o, w){
  const H = pg.h, hid = o.hidden, X = pg.xy, O = pg.ops; let open = -1, sk = "", fk = "", w0 = -1, d0 = 0, g0 = 1;
  const col = (c, fill, op) => {
    if (o.style === "mono") w.s(fill ? "0.75 0.75 0.75 " : "0 0 0 ");
    else if (c === INK) w.s("0 0 0 ");
    else { const r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, bb = (c & 255) / 255;
      if (o.style === "gray") { const y = Math.min(0.85, 0.299 * r + 0.587 * g + 0.114 * bb); w.v(y).v(y).v(y); } else w.v(r).v(g).v(bb); }
    w.s(op + "\n");
  };
  const layer = li => { if (!o.oc || li === open) return; if (open >= 0) w.s("EMC\n"); w.s("/OC /L" + li + " BDC\n"); open = li; };
  const alpha = a => { if (a === g0 || !o.A) return; w.s("/" + o.A.get(a < 1 ? a : 1) + " gs\n"); g0 = a; };
  for (let i = 0; i < pg.n; i++) {
    if (hid && hid[pg.lay[i]]) continue;
    const st = pg.styles[pg.sty[i]], kd = pg.kind[i]; layer(pg.lay[i]); alpha(st.a);
    if (kd === 1 || kd === 2) { const k = "f" + st.c; if (k !== fk) { col(st.c, true, "rg"); fk = k; } }
    else { const k = "s" + st.c; if (k !== sk) { col(st.c, false, "RG"); sk = k; }
      const lw = kd === 3 ? (o.lwk || 1) : st.wid > 0 ? st.wid : (o.thin ? 0.25 : st.lw * 72 / 25.4) * (o.lwk || 1); if (lw !== w0) { w.v(lw).s("w\n"); w0 = lw; }
      const d = st.dash && kd === 0 ? st.dash : null; if (d !== d0) { if (d) { w.s("["); d.forEach(x => w.v(x)); w.s("] 0 d\n"); } else w.s("[] 0 d\n"); d0 = d; } }
    let q = pg.q0[i];
    for (let j = pg.p0[i], e = pg.p0[i + 1]; j < e; j++) { const op = O[j];
      if (op === 0) { w.v(X[q]).v(H - X[q + 1]).s("m "); q += 2; }
      else if (op === 1) { w.v(X[q]).v(H - X[q + 1]).s("l "); q += 2; }
      else if (op === 2) { w.v(X[q]).v(H - X[q + 1]).v(X[q + 2]).v(H - X[q + 3]).v(X[q + 4]).v(H - X[q + 5]).s("c "); q += 6; }
      else w.s("h "); }
    w.s(kd === 1 ? "f\n" : kd === 2 ? "f*\n" : "S\n");
  }
  alpha(1);
  for (let i = 0; i < pg.tn; i++) {
    if (hid && hid[pg.tL[i]]) continue;
    layer(pg.tL[i]); const c = pg.tC[i], k = "t" + c; if (k !== fk) { col(c, false, "rg"); fk = k; }
    const m = 6 * i, M = pg.tM;
    w.s("BT " + o.fk + " 1 Tf ").v(M[m]).v(-M[m + 1]).v(M[m + 2]).v(-M[m + 3]).v(M[m + 4]).v(H - M[m + 5]).s("Tm <" + winHex(pg.tS[i]) + "> Tj ET\n");
  }
  if (open >= 0) w.s("EMC\n");
}
async function opsStream(ctx, w){   // the operators deflated — by the browser's own CompressionStream where there is one (fast), else pdf-lib's
  const raw = w.bytes();
  if (typeof CompressionStream === "function" && typeof Response === "function") {
    try { const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()); return ctx.register(ctx.stream(z, {Filter: "FlateDecode"})); } catch (e) {}
  }
  return ctx.register(ctx.flateStream(raw));
}
function pdfRes(L, doc, page, pg, font){   // the page's font and transparency resources -> {fk, A}
  const res = page.node.normalizedEntries().Resources, N = L.PDFName.of, ctx = doc.context, A = new Map(), gs = {};
  const fk = page.node.newFontDictionary("F", font.ref).toString();
  if (pg.styles.some(s => s.a < 1)) { [1, ...pg.styles.map(s => s.a)].forEach(a => { if (!A.has(a)) { const nm = "GA" + A.size; A.set(a, nm); gs[nm] = ctx.obj({Type: "ExtGState", ca: a, CA: a}); } });
    const eg = res.lookup(N("ExtGState")); if (eg) Object.entries(gs).forEach(([k, v]) => eg.set(N(k), v)); else res.set(N("ExtGState"), ctx.obj(gs)); }
  return {fk, A: A.size ? A : null};
}
export async function cadPdf(sc, L, meta){
  meta = meta || {};
  const doc = await L.PDFDocument.create(), font = await doc.embedFont(L.StandardFonts.Helvetica), ctx = doc.context, N = L.PDFName.of;
  doc.setTitle(meta.title || "AutoCAD drawing"); doc.setCreator("ZD PDF Takeoff — " + sc.fmt + " import"); doc.setProducer("ZD PDF Takeoff");
  const used = new Set(); sc.pages.forEach(pg => { pg.lay.forEach(l => used.add(l)); pg.tL.forEach(l => used.add(l)); });
  const ocg = sc.layers.map((l, i) => used.has(i) ? ctx.register(ctx.obj({Type: "OCG", Name: L.PDFHexString.fromText(l.name)})) : null), refs = ocg.filter(Boolean);
  doc.catalog.set(N("OCProperties"), ctx.obj({OCGs: refs, D: {Name: L.PDFHexString.fromText("AutoCAD layers"), Order: refs, ON: refs, OFF: [], BaseState: N("ON")}}));
  for (const pg of sc.pages) {
    const page = doc.addPage([pg.w, pg.h]), props = {};
    ocg.forEach((r, i) => { if (r) props["L" + i] = r; });
    page.node.normalizedEntries().Resources.set(N("Properties"), ctx.obj(props));
    const R = pdfRes(L, doc, page, pg, font), w = new Ops(pg.ops.length * 14 + pg.tn * 80);
    w.s("q 1 J 1 j\n"); pdfOps(pg, {fk: R.fk, A: R.A, oc: true}, w); w.s("Q\n");
    page.node.set(N("Contents"), ctx.obj([await opsStream(ctx, w)]));
  }
  return doc.save({useObjectStreams: true});
}
/* a window of the drawing plotted onto a paper page (pdf-lib), as AutoCAD's PLOT: o {win: [x0, y0, x1, y1] page points (y down),
   s paper points per page point, at: [x, y] the window's lower-left corner on the paper, style, hidden, lw (plot lineweights), font} */
export async function cadPlotPage(L, doc, page, pg, o){
  const font = o.font || await doc.embedFont(L.StandardFonts.Helvetica), R = pdfRes(L, doc, page, pg, font), [x0, y0, x1, y1] = o.win, s = o.s, ctx = doc.context, N = L.PDFName.of;
  const ww = (x1 - x0) * s, wh = (y1 - y0) * s, tx = o.at[0] - s * x0, ty = o.at[1] - s * (pg.h - y1), w = new Ops(pg.ops.length * 14 + pg.tn * 80);
  w.s("q\n").v(o.at[0]).v(o.at[1]).v(ww).v(wh).s("re W n\n1 J 1 j\n").v(s).s("0 0 ").v(s).v(tx).v(ty).s("cm\n");
  pdfOps(pg, {fk: R.fk, A: R.A, hidden: o.hidden, style: o.style, lwk: 1 / s, thin: o.lw === false}, w); w.s("Q\n");
  const ref = await opsStream(ctx, w), cur = page.node.normalizedEntries().Contents;
  if (cur) cur.push(ref); else page.node.set(N("Contents"), ctx.obj([ref]));
}

/* ------------------------------------------------------------------ the canvas: only what is on screen, fast enough to redraw on every zoom step */
export function cadPrep(pg){
  if (pg._g) return pg._g;
  const n = pg.n, G = 160, cw = Math.max(pg.w, pg.h) / G || 1, nx = Math.max(1, Math.ceil(pg.w / cw)), ny = Math.max(1, Math.ceil(pg.h / cw)), bb = pg.bb;
  const cnt = new Uint32Array(nx * ny + 1), big = [];
  const span = (i, f) => { const x0 = Math.max(0, Math.min(nx - 1, Math.floor(bb[4 * i] / cw))), x1 = Math.max(0, Math.min(nx - 1, Math.floor(bb[4 * i + 2] / cw))),
    y0 = Math.max(0, Math.min(ny - 1, Math.floor(bb[4 * i + 1] / cw))), y1 = Math.max(0, Math.min(ny - 1, Math.floor(bb[4 * i + 3] / cw)));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 48) return false; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * nx + x); return true; };
  for (let i = 0; i < n; i++) if (!span(i, c => cnt[c + 1]++)) big.push(i);
  for (let c = 0; c < nx * ny; c++) cnt[c + 1] += cnt[c];
  const items = new Uint32Array(cnt[nx * ny]), fill = cnt.slice(0, nx * ny), bigS = new Set(big);
  for (let i = 0; i < n; i++) if (!bigS.has(i)) span(i, c => { items[fill[c]++] = i; });
  return pg._g = {cw, nx, ny, start: cnt, items, big: Uint32Array.from(big), stamp: new Uint32Array(n), fr: 0, css: {}, bk: pg.styles.map(() => [])};
}
function cand(pg, g, x0, y0, x1, y1){   // primitives whose cell is in the box, in drawing order
  const fr = ++g.fr, out = [], cx0 = Math.max(0, Math.floor(x0 / g.cw)), cx1 = Math.min(g.nx - 1, Math.floor(x1 / g.cw)), cy0 = Math.max(0, Math.floor(y0 / g.cw)), cy1 = Math.min(g.ny - 1, Math.floor(y1 / g.cw));
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const c = y * g.nx + x; for (let k = g.start[c]; k < g.start[c + 1]; k++) { const i = g.items[k]; if (g.stamp[i] !== fr) { g.stamp[i] = fr; out.push(i); } } }
  for (let k = 0; k < g.big.length; k++) out.push(g.big[k]);
  const a = Uint32Array.from(out); a.sort(); return a;
}
/* about how much drawing a view is (path steps, a text as 30): each primitive counted in the grid cell of its middle, once, so a view's
   cost is the sum over the cells it shows — a light view is drawn on every frame, a heavy one from a picture while it moves */
export function cadCost(pg, v){
  const g = cadPrep(pg);
  if (!g.cost) { const c = new Float64Array(g.nx * g.ny), bb = pg.bb, P0 = pg.p0, cl = (x, n) => Math.max(0, Math.min(n - 1, Math.floor(x / g.cw)));
    for (let i = 0; i < pg.n; i++) { const b = 4 * i; c[cl((bb[b + 1] + bb[b + 3]) / 2, g.ny) * g.nx + cl((bb[b] + bb[b + 2]) / 2, g.nx)] += P0[i + 1] - P0[i]; }
    for (let i = 0; i < pg.tn; i++) c[cl(pg.tM[6 * i + 5], g.ny) * g.nx + cl(pg.tM[6 * i + 4], g.nx)] += 30;
    g.cost = c; }
  const s = v.s, cx0 = Math.max(0, Math.floor(-v.tx / s / g.cw)), cx1 = Math.min(g.nx - 1, Math.floor((v.W - v.tx) / s / g.cw)), cy0 = Math.max(0, Math.floor(-v.ty / s / g.cw)), cy1 = Math.min(g.ny - 1, Math.floor((v.H - v.ty) / s / g.cw));
  let t = 0; for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) t += g.cost[y * g.nx + x];
  return t;
}
/* one primitive onto the path. A closed outline ends with a line back to its start, not closePath(): Chrome's closePath slows down
   with every outline already on the path (a stroke batch of thousands took 40-80 times as long), and with round caps and joins the
   two look the same */
function addPath(ctx, pg, i){
  const O = pg.ops, X = pg.xy; let q = pg.q0[i], sx = 0, sy = 0;
  for (let j = pg.p0[i], e = pg.p0[i + 1]; j < e; j++) { const op = O[j];
    if (op === 0) { sx = X[q]; sy = X[q + 1]; ctx.moveTo(sx, sy); q += 2; } else if (op === 1) { ctx.lineTo(X[q], X[q + 1]); q += 2; }
    else if (op === 2) { ctx.bezierCurveTo(X[q], X[q + 1], X[q + 2], X[q + 3], X[q + 4], X[q + 5]); q += 6; } else ctx.lineTo(sx, sy); }
}
/* the drawing in steps: one frame on screen runs it through (cadDraw); a whole-page picture made in the background runs it a slice
   at a time between frames (cadDrawAsync), with its own buckets so a frame drawn meanwhile does not disturb it */
function* drawSteps(ctx, pg, v, o){
  const g = cadPrep(pg), s = v.s, dark = !!o.dark, mono = !!o.mono, hid = o.hidden || new Uint8Array(0), dpr = o.dpr || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.fillStyle = dark ? "#000000" : "#ffffff"; ctx.fillRect(0, 0, v.W, v.H);
  const x0 = -v.tx / s, y0 = -v.ty / s, x1 = (v.W - v.tx) / s, y1 = (v.H - v.ty) / s, all = x0 <= 0 && y0 <= 0 && x1 >= pg.w && y1 >= pg.h;
  const ids = all ? null : cand(pg, g, x0, y0, x1, y1), cnt = ids ? ids.length : pg.n, at = j => ids ? ids[j] : j;
  const ck = (dark ? 1 : 0) + (mono ? 2 : 0), css = g.css[ck] || (g.css[ck] = pg.styles.map(st => cadCss(st.c, dark, mono)));
  const fillCss = mono ? (dark ? "#4d4d4d" : "#cfcfcf") : null, lod = (o.fast ? 1.6 : 0.45) / s, bb = pg.bb, K = pg.kind, Ly = pg.lay, St = pg.sty;
  const vis = i => { const b = 4 * i; return !hid[Ly[i]] && !(bb[b + 2] < x0 || bb[b] > x1 || bb[b + 3] < y0 || bb[b + 1] > y1); };
  const page = () => { ctx.setTransform(s, 0, 0, s, v.tx, v.ty); ctx.lineCap = "round"; ctx.lineJoin = "round"; };
  const P0 = pg.p0, SLICE = 6000;   // path steps between pauses: a slice of a drawing made in the background stays a few ms
  page();
  for (let j = 0, ops = 0; j < cnt; j++) { const i = at(j), kd = K[i]; if (kd !== 1 && kd !== 2) continue; if (!vis(i)) continue; const b = 4 * i; if (bb[b + 2] - bb[b] + bb[b + 3] - bb[b + 1] < lod) continue;
    const st = pg.styles[St[i]]; ctx.globalAlpha = st.a; ctx.fillStyle = fillCss || css[St[i]]; ctx.beginPath(); addPath(ctx, pg, i); ctx.fill(kd === 2 ? "evenodd" : "nonzero");
    if ((ops += P0[i + 1] - P0[i] + 8) > SLICE) { ops = 0; yield; page(); } }
  ctx.globalAlpha = 1;
  const bk = o.own ? pg.styles.map(() => []) : g.bk; if (!o.own) bk.forEach(x => { x.length = 0; });
  for (let j = 0; j < cnt; j++) { const i = at(j); if (K[i] !== 0 || !vis(i)) continue; const b = 4 * i; if (bb[b + 2] - bb[b] + bb[b + 3] - bb[b + 1] < lod) continue; bk[St[i]].push(i); }
  const px = 1 / s;
  for (let si = 0; si < bk.length; si++) { const L = bk[si]; if (!L.length) continue; const st = pg.styles[si];
    const lwPx = o.thin ? 1 : Math.max(1, Math.round(st.lw / 0.3)), lw = st.wid > 0 ? Math.max(st.wid, lwPx * px * dpr) : lwPx * px * dpr;
    const per = st.dash ? st.dash.reduce((a, b) => a + b, 0) * s : 0;
    const pen = () => { ctx.lineWidth = lw; ctx.setLineDash(per > 4 * dpr ? st.dash : []); ctx.strokeStyle = css[si]; ctx.beginPath(); };
    pen(); let ops = 0;   // one stroke per style, cut into slices (every object is its own subpath: the cut does not show)
    for (let q = 0; q < L.length; q++) { const i = L[q]; addPath(ctx, pg, i); if ((ops += P0[i + 1] - P0[i] + 2) > SLICE && q < L.length - 1) { ctx.stroke(); yield; page(); pen(); ops = 0; } }
    ctx.stroke(); yield; page(); }
  ctx.setLineDash([]);
  if (!o.fast) { const r = 1.2 * px * dpr; for (let j = 0, n = 0; j < cnt; j++) { const i = at(j); if (K[i] !== 3 || !vis(i)) continue; ctx.fillStyle = css[St[i]]; const q = pg.q0[i]; ctx.fillRect(pg.xy[q] - r, pg.xy[q + 1] - r, 2 * r, 2 * r); if (++n % 5000 === 0) { yield; page(); } } }
  if (pg.tn) {
    const tB = pg.tB, tM = pg.tM, minPx = o.fast ? 7 : 3.5; ctx.textBaseline = "alphabetic"; let f0 = "";
    for (let i = 0, n = 0; i < pg.tn; i++) {
      if (hid[pg.tL[i]]) continue; const b = 4 * i; if (tB[b + 2] < x0 || tB[b] > x1 || tB[b + 3] < y0 || tB[b + 1] > y1) continue;
      const m = 6 * i, em = Math.hypot(tM[m + 2], tM[m + 3]) * s; if (em < minPx) continue;
      ctx.setTransform(tM[m] * s / em, tM[m + 1] * s / em, -tM[m + 2] * s / em, -tM[m + 3] * s / em, tM[m + 4] * s + v.tx, tM[m + 5] * s + v.ty);
      const f = em.toFixed(1) + "px Arial, Helvetica, sans-serif"; if (f !== f0) { ctx.font = f; f0 = f; }
      ctx.fillStyle = cadCss(pg.tC[i], dark, mono); ctx.fillText(pg.tS[i], 0, 0);
      if (++n % 300 === 0) { yield; ctx.textBaseline = "alphabetic"; f0 = ""; }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
/* v: {s, tx, ty, W, H} in device pixels (screen = page × s + t); o: {dark, mono, thin, hidden: Uint8Array by layer, dpr, fast} */
export function cadDraw(ctx, pg, v, o){ const it = drawSteps(ctx, pg, v, o); while (!it.next().done); }
/* the same, a slice of about 12 ms at a time; stale(): give up (the page or the view settings changed) -> false */
export async function cadDrawAsync(ctx, pg, v, o, stale){
  const it = drawSteps(ctx, pg, v, Object.assign({}, o, {own: true})); let t = performance.now();
  for (;;) { if (it.next().done) return true; if (performance.now() - t > 12) { await new Promise(r => setTimeout(r, 0)); if (stale && stale()) return false; t = performance.now(); } }
}

/* ------------------------------------------------------------------ the takeoff's index of the page, straight from the scene
   (no PDF parsed): its lines as indexPage makes them from a PDF — [x0, y0, x1, y1, flags (1 on a curve, 2 dashed, 4 a fill's
   outline), subpath, style, layer] with styles "#rrggbb|width" — hatch pattern lines left out (they are noise to snap to); its text
   as [{s, x, y, w, h}] (x, y the baseline's start) */
export function cadIndex(pg, max){
  const segs = [], styles = [], six = new Map(), O = pg.ops, X = pg.xy; let sp = 0; max = max || 600000;
  for (let i = 0; i < pg.n && segs.length < max; i++) {
    const kd = pg.kind[i]; if (kd === 3 || pg.pf[i] === 1) continue;
    const st = pg.styles[pg.sty[i]], fill = kd === 1 || kd === 2, w = fill ? 0 : st.wid > 0 ? st.wid : st.lw * 72 / 25.4;
    const key = (st.c === INK ? "#000000" : hex6(st.c)) + "|" + Math.round(w * 10) / 10; let si = six.get(key); if (si === undefined) { si = styles.length; styles.push(key); six.set(key, si); }
    const f0 = fill ? 4 : st.dash ? 2 : 0, li = pg.lay[i];
    const push = (a, b, c, d, f) => { if (Math.abs(a - c) + Math.abs(b - d) > 0.05 && segs.length < max) segs.push([a, b, c, d, f, sp, si, li]); };
    let q = pg.q0[i], cx = 0, cy = 0, sx = 0, sy = 0;
    for (let j = pg.p0[i], e = pg.p0[i + 1]; j < e; j++) { const op = O[j];
      if (op === 0) { cx = sx = X[q]; cy = sy = X[q + 1]; sp++; q += 2; }
      else if (op === 1) { push(cx, cy, X[q], X[q + 1], f0); cx = X[q]; cy = X[q + 1]; q += 2; }
      else if (op === 2) { let px = cx, py = cy; for (let t = 1; t <= 8; t++) { const u = t / 8, x = bez(cx, X[q], X[q + 2], X[q + 4], u), y = bez(cy, X[q + 1], X[q + 3], X[q + 5], u); push(px, py, x, y, f0 | 1); px = x; py = y; } cx = X[q + 4]; cy = X[q + 5]; q += 6; }
      else { push(cx, cy, sx, sy, f0); cx = sx; cy = sy; } }
  }
  const texts = [];
  for (let i = 0; i < pg.tn; i++) { const m = 6 * i, M = pg.tM, em = Math.hypot(M[m + 2], M[m + 3]); texts.push({s: pg.tS[i], x: M[m + 4], y: M[m + 5], w: Math.hypot(M[m], M[m + 1]) * pg.tW[i], h: em || 6, li: pg.tL[i]}); }
  return {segs, styles, texts};
}

/* ------------------------------------------------------------------ picking and quantities */
const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
/* a primitive's subpaths as point lists (curves as short lines), page points */
export function primPaths(pg, i){
  const O = pg.ops, X = pg.xy, out = []; let q = pg.q0[i], P = null;
  for (let j = pg.p0[i]; j < pg.p0[i + 1]; j++) { const op = O[j];
    if (op === 0) { P = [[X[q], X[q + 1]]]; out.push(P); q += 2; }
    else if (op === 1) { if (P) P.push([X[q], X[q + 1]]); q += 2; }
    else if (op === 2) { if (P) { const p0 = P[P.length - 1]; for (let s = 1; s <= 8; s++) { const t = s / 8; P.push([bez(p0[0], X[q], X[q + 2], X[q + 4], t), bez(p0[1], X[q + 1], X[q + 3], X[q + 5], t)]); } } q += 6; }
    else if (P) P.closed = true; }
  return out;
}
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
/* the drawing object under a page point: {e (its index in ents), i (the primitive), d} or null */
export function cadHit(pg, x, y, tol, hidden){
  const g = cadPrep(pg), ids = cand(pg, g, x - tol, y - tol, x + tol, y + tol), p = [x, y], bb = pg.bb; let best = null;
  for (const i of ids) {
    if (hidden && hidden[pg.lay[i]]) continue; const b = 4 * i; if (bb[b] - tol > x || bb[b + 2] + tol < x || bb[b + 1] - tol > y || bb[b + 3] + tol < y) continue;
    let d = Infinity; const S = primPaths(pg, i), fill = pg.kind[i] === 1 || pg.kind[i] === 2;
    S.forEach(P => { for (let k = 1; k < P.length; k++) d = Math.min(d, segD(p, P[k - 1], P[k])); if ((P.closed || fill) && P.length > 2) d = Math.min(d, segD(p, P[P.length - 1], P[0])); });
    if (fill && d > tol) { let inside = false; S.forEach(P => { if (P.length > 2 && inPoly(p, P)) inside = !inside; }); if (inside) d = tol * 0.95; }
    if (d <= tol && (!best || d < best.d)) best = {e: pg.ent[i], i, d};
  }
  if (!best && pg.tE) for (let t = 0; t < pg.tn; t++) {   // no line here: a text whose box holds the point
    const b = 4 * t; if (hidden && hidden[pg.tL[t]]) continue;
    if (pg.tB[b] - tol <= x && pg.tB[b + 2] + tol >= x && pg.tB[b + 1] - tol <= y && pg.tB[b + 3] + tol >= y && pg.tE[t] >= 0) return {e: pg.tE[t], i: -1, t, d: tol};
  }
  return best;
}
/* the objects' own index: each object's box (page points, over its primitives and texts) and its primitives and texts,
   as lists cut by start offsets — made once per page */
export function cadEnts(pg){
  const g = cadPrep(pg); if (g.en) return g.en;
  const N = pg.ents.length, eb = new Float64Array(4 * N), ps = new Uint32Array(N + 1), ts = new Uint32Array(N + 1), tn = pg.tE ? pg.tn : 0;
  for (let e = 0; e < N; e++) { eb[4 * e] = eb[4 * e + 1] = Infinity; eb[4 * e + 2] = eb[4 * e + 3] = -Infinity; }
  const grow = (e, B, b) => { const k = 4 * e; if (B[b] < eb[k]) eb[k] = B[b]; if (B[b + 1] < eb[k + 1]) eb[k + 1] = B[b + 1]; if (B[b + 2] > eb[k + 2]) eb[k + 2] = B[b + 2]; if (B[b + 3] > eb[k + 3]) eb[k + 3] = B[b + 3]; };
  for (let i = 0; i < pg.n; i++) { const e = pg.ent[i]; if (e >= 0 && e < N) { ps[e + 1]++; grow(e, pg.bb, 4 * i); } }
  for (let t = 0; t < tn; t++) { const e = pg.tE[t]; if (e >= 0 && e < N) { ts[e + 1]++; grow(e, pg.tB, 4 * t); } }
  for (let e = 0; e < N; e++) { ps[e + 1] += ps[e]; ts[e + 1] += ts[e]; }
  const pl = new Uint32Array(ps[N]), tl = new Uint32Array(ts[N]), pf = ps.slice(0, N), tf = ts.slice(0, N);
  for (let i = 0; i < pg.n; i++) { const e = pg.ent[i]; if (e >= 0 && e < N) pl[pf[e]++] = i; }
  for (let t = 0; t < tn; t++) { const e = pg.tE[t]; if (e >= 0 && e < N) tl[tf[e]++] = t; }
  return g.en = {N, eb, ps, pl, ts, tl};
}
const segBox = (a, b, x0, y0, x1, y1) => {   // does the segment a-b meet the box (Liang–Barsky)
  const dx = b[0] - a[0], dy = b[1] - a[1]; let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; } const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  return true;
};
/* the objects a box selects, as AutoCAD's window (wholly inside: every primitive and text of the object) or crossing
   (touching: a line of it crosses the box or lies in it, a text's box meets it, or the box is inside a solid fill or hatch).
   Objects on hidden layers are left out. -> [object index] */
export function cadBox(pg, x0, y0, x1, y1, crossing, hidden){
  const E = cadEnts(pg), eb = E.eb, out = [], ents = pg.ents, bb = pg.bb, c = [(x0 + x1) / 2, (y0 + y1) / 2];
  for (let e = 0; e < E.N; e++) {
    const r = ents[e], k = 4 * e; if (!r || r.L < 0 || (hidden && hidden[r.L]) || !(eb[k] <= eb[k + 2])) continue;
    if (eb[k + 2] < x0 || eb[k] > x1 || eb[k + 3] < y0 || eb[k + 1] > y1) continue;
    if (eb[k] >= x0 && eb[k + 2] <= x1 && eb[k + 1] >= y0 && eb[k + 3] <= y1) { out.push(e); continue; }
    if (!crossing) continue;
    let hit = false;
    for (let j = E.ts[e]; j < E.ts[e + 1] && !hit; j++) { const b = 4 * E.tl[j]; hit = !(pg.tB[b + 2] < x0 || pg.tB[b] > x1 || pg.tB[b + 3] < y0 || pg.tB[b + 1] > y1); }
    for (let j = E.ps[e]; j < E.ps[e + 1] && !hit; j++) { const i = E.pl[j], b = 4 * i;
      if (bb[b + 2] < x0 || bb[b] > x1 || bb[b + 3] < y0 || bb[b + 1] > y1) continue;
      const S = primPaths(pg, i), fill = pg.kind[i] === 1 || pg.kind[i] === 2;
      for (const P of S) { if (P.length === 1) { hit = P[0][0] >= x0 && P[0][0] <= x1 && P[0][1] >= y0 && P[0][1] <= y1; if (hit) break; }
        for (let q = 1; q < P.length && !hit; q++) hit = segBox(P[q - 1], P[q], x0, y0, x1, y1);
        if (!hit && (P.closed || fill) && P.length > 2) hit = segBox(P[P.length - 1], P[0], x0, y0, x1, y1);
        if (hit) break; }
      if (!hit && fill) { let inside = false; S.forEach(P => { if (P.length > 2 && inPoly(c, P)) inside = !inside; }); hit = inside; } }
    if (hit) out.push(e);
  }
  return out;
}
/* an object's geometry for the takeoff: an area's outlines, a run's points, or a block's insertion point */
export function cadGeom(pg, ei){
  const r = pg.ents[ei]; if (!r) return null;
  if (r.at) return {kind: "count", at: r.at, n: r.n || "", att: r.att || []};
  if (r.loops) return {kind: "area", loops: r.loops};
  const subs = []; for (let i = 0; i < pg.n; i++) if (pg.ent[i] === ei && pg.kind[i] !== 3) primPaths(pg, i).forEach(P => subs.push(P));
  if (!subs.length) return null;
  return r.cl ? {kind: "area", loops: subs.filter(P => P.length > 2)} : {kind: "line", runs: subs.filter(P => P.length > 1)};
}
/* what the drawing holds, by layer and by block: counts, lengths (ft) and areas (Sft) */
export function cadQty(sc, pg){
  const byL = new Map(), byB = new Map();
  pg.ents.forEach((r, ei) => {
    if (r.L < 0) return; let l = byL.get(r.L); if (!l) byL.set(r.L, l = {li: r.L, name: (sc.layers[r.L] || {}).name || "?", n: 0, runs: 0, len: 0, areas: 0, area: 0, ins: 0, txt: 0});
    l.n++;
    if (r.t === "INSERT") { l.ins++; const k = r.n || "?"; let b = byB.get(k); if (!b) byB.set(k, b = {name: k, n: 0, layers: new Set(), ents: [], att: new Map()}); b.n++; b.layers.add(l.name); b.ents.push(ei);
      (r.att || []).forEach(([t, v]) => { let m = b.att.get(t); if (!m) b.att.set(t, m = new Map()); m.set(v, (m.get(v) || 0) + 1); }); }
    else if (r.cl && r.area > 0) { l.areas++; l.area += r.area; }
    else if (r.len > 0) { l.runs++; l.len += r.len; }
    else if (/TEXT|ATTRIB|ATTDEF/.test(r.t)) l.txt++;
  });
  return {layers: [...byL.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true})), blocks: [...byB.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))};
}

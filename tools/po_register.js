#!/usr/bin/env node
/* Merge Sage 300 purchase orders (the POPOR01 "PO Purchase Orders" Crystal report, printed to PDF) into the
   dashboard's PO lines, shown in the GRN Price Register beside the GRN receipts.

     TK_LIBS=/path/with/node_modules node tools/po_register.js POPOR01.pdf [MORE.pdf ...]
     node tools/po_register.js --site "Mall 35" --html path/to/index.html POPOR01.pdf

   TK_LIBS   folder holding pdfjs-dist (as for the takeoff tests)
   --site    the site for every PO of these PDFs; otherwise taken from the company the PO book belongs to (COMPANY_SITE)

   Each PO page: company, PO number, vendor, reference, vendor no., PO date, then item lines `qty | description |
   Yes/No | unit cost | UOM | extended`, a purchase discount line if any, subtotal, tax and total. A PO running
   over two pages is one PO. Every PO is checked before anything is written: its lines less its discount must
   equal its subtotal, and subtotal + tax its total — a PO that does not add up stops the merge.

   PO lines already held are kept: a line counts as held when site, PO, description, quantity and rate match one in
   the register (compared by count), so re-running with a bigger export only adds the new POs. Item categories are
   taken from a GRN item with the same description when there is one; otherwise left blank (never guessed). Units
   are normalised as in tools/grn_register.py; the PO's own unit is kept. The data lives in the
   `<script type="application/json" id="raPoData">` block of the dashboard, packed like raGrnData plus a `pos` table
   (subtotal, tax, total and discount of each PO). */
const fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const COMPANY_SITE = [[/^mall\s*35\b/i, "Mall 35"], [/zameen\s+omega/i, "Phoenix"]];   // PO book (company on the PO) -> site
const UNIT_MAP = {   // as tools/grn_register.py: PO unit (lower-cased) -> [house unit, factor on the rate]
  each: ["Nos", 1], pcs: ["Nos", 1], nos: ["Nos", 1], no: ["Nos", 1], rft: ["Rft", 1], kgs: ["Kg", 1], kg: ["Kg", 1],
  "cubic mtr": ["Cft", 1 / 35.3147], cum: ["Cft", 1 / 35.3147], metre: ["Rft", 0.3048], meter: ["Rft", 0.3048], mtr: ["Rft", 0.3048],
  "sq.mt": ["Sft", 0.09290304], sqm: ["Sft", 0.09290304], "m.ton": ["Ton", 1], ton: ["Ton", 1], ltr: ["Ltr", 1], litre: ["Ltr", 1],
  "sq.ft": ["Sft", 1], sft: ["Sft", 1], cft: ["Cft", 1], coil: ["Coil", 1], pack: ["Pack", 1], bottle: ["Bottle", 1], roll: ["Roll", 1],
  bucket: ["Bucket", 1], pair: ["Pair", 1], gallon: ["Gallon", 1], box: ["Box", 1], length: ["Length", 1], set: ["Set", 1], bag: ["Bag", 1]};
const MON = {Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12};
const DATE = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/;
const isNum = s => /^-?[\d,]+(\.\d+)?$/.test(String(s).trim());
const num = s => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) ? v : null; };
const iso = d => { const m = DATE.exec(d || ""); return m ? `${m[3]}-${String(MON[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const poNo = s => { const m = /^PO0*(\d+)$/.exec(s); return m ? "PO-" + +m[1] : s; };   // PO000127, PO00000000000000000004 -> PO-127, PO-4
const clean = s => String(s || "").replace(/\s+/g, " ").trim();

function args(){
  const a = process.argv.slice(2), o = {pdfs: [], html: path.join(ROOT, "zameen-developments", "index.html"), site: ""};
  for (let i = 0; i < a.length; i++) { if (a[i] === "--html") o.html = a[++i]; else if (a[i] === "--site") o.site = a[++i]; else o.pdfs.push(a[i]); }
  if (!o.pdfs.length) { console.error("usage: node tools/po_register.js [--site NAME] [--html index.html] POPOR01.pdf ..."); process.exit(2); }
  return o;
}
async function pdfLines(file){   // pages -> rows of cells (text pieces on one baseline, left to right)
  const libs = process.env.TK_LIBS || "";
  const pdfjs = await import(require("url").pathToFileURL(libs ? path.join(libs, "pdfjs-dist", "legacy", "build", "pdf.mjs") : require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0}).promise, pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(), rows = [];
    tc.items.forEach(t => { if (!t.str.trim()) return; const y = t.transform[5]; let r = rows.find(q => Math.abs(q.y - y) <= 2); if (!r) { r = {y, it: []}; rows.push(r); } r.it.push({x: t.transform[4], s: t.str.trim()}); });
    pages.push(rows.sort((a, b) => b.y - a.y).map(r => r.it.sort((a, b) => a.x - b.x).map(o => o.s)));
  }
  return pages;
}
function parsePos(pages){
  const pos = []; let cur = null;
  pages.forEach((L, pi) => {
    const flat = L.map(r => r.join(" ")).join("\n"), no = (flat.match(/\bPO\d{4,}\b/) || [""])[0], pageNo = L[2] && isNum(L[2][1]) ? +L[2][1] : 1;
    if (!cur || cur.raw !== no || pageNo === 1) {
      cur = {raw: no, po: poNo(no), company: L[1] ? L[1][0] : "", vendor: "", ref: "", vendorNo: "", date: "", items: [], discount: 0, subtotal: null, tax: null, total: null, pages: [pi + 1]};
      pos.push(cur);
      const vi = L.findIndex(r => r[0] === "Vendor Address"); if (vi >= 0 && L[vi + 1]) cur.vendor = clean(L[vi + 1][0]);
      const ri = L.findIndex(r => r[0] === "Reference" && r.includes("Vendor Number"));
      if (ri >= 0 && L[ri + 1]) { const r = L[ri + 1], di = r.findIndex(c => DATE.test(c)); if (di >= 0) { cur.date = iso(r[di]); cur.vendorNo = di > 0 ? r[di - 1] : ""; cur.ref = r.slice(0, Math.max(0, di - 1)).join(" — "); } }
    } else cur.pages.push(pi + 1);
    let inItems = false, last = null;
    L.forEach(r => {
      if (r[0] === "Qty" && r.includes("Description")) { inItems = true; return; }
      if (r[0] === "Comments") inItems = false;
      if (!inItems || (r.length === 1 && r[0] === "Ship")) return;
      const n = r.length, yi = r.findIndex((c, i) => i > 0 && /^(Yes|No)$/.test(c));
      if (/Purchase Discount/.test(r.join(" "))) { cur.discount += num(r.filter(isNum).pop()) || 0; return; }
      if (n >= 4 && isNum(r[0]) && isNum(r[n - 1]) && yi > 0 && isNum(r[yi + 1])) {   // qty | description … | Yes/No | unit cost | UOM | extended
        last = {qty: num(r[0]), desc: clean(r.slice(1, yi).join(" ")), rate: num(r[yi + 1]), uom: yi + 2 < n - 1 ? clean(r.slice(yi + 2, n - 1).join(" ")) : "", ext: num(r[n - 1])};
        cur.items.push(last);
      } else if (last && r.every(c => !isNum(c))) last.desc = clean(last.desc + " " + r.join(" "));   // a description wrapped onto the next line
    });
    const val = rx => { const row = L.find(r => r.some(c => rx.test(c))); const v = row && row.filter(isNum).pop(); return v != null ? num(v) : null; };
    const st = val(/^Subtotal$/), tx = val(/^Total tax$/), tt = val(/^Total purchase order$/);
    if (st != null) cur.subtotal = st; if (tx != null) cur.tax = tx; if (tt != null) cur.total = tt;
  });
  return pos;
}
function check(pos, file){   // every PO adds up, or nothing is written
  const bad = pos.filter(p => !p.raw || !p.date || p.total == null || p.subtotal == null || !p.items.length ||
    Math.abs(p.items.reduce((a, i) => a + i.ext, 0) - p.discount - p.subtotal) > 0.6 || Math.abs(p.subtotal + (p.tax || 0) - p.total) > 0.6);
  if (bad.length) { console.error(`${file}: ${bad.length} PO(s) do not add up or could not be read — nothing written:`);
    bad.slice(0, 10).forEach(p => console.error(`  ${p.po || "(no PO no.)"} p.${p.pages.join(",")} lines ${p.items.length} subtotal ${p.subtotal} total ${p.total}`)); process.exit(1); }
}
function unpack(d){   // the stored block -> lines + PO table
  if (!d) return {lines: [], pos: {}};
  return {lines: d.rc.map(([ix, date, rate, qty, po, vi]) => { const it = d.items[ix]; return {site: d.sites[it[0]], po, date, vendor: d.vendors[vi], desc: it[2], main: d.cats[it[3]], sub: d.cats[it[4]], uom: it[5], qty, rate}; }),
          pos: Object.fromEntries(Object.entries(d.pos || {}).map(([k, v]) => [k, v]))};
}
function pack(lines, posT, sources){
  const sites = [], vendors = [], cats = [], items = [], ixOf = new Map(), idx = (l, v) => { let i = l.indexOf(v); if (i < 0) { l.push(v); i = l.length - 1; } return i; };
  lines.sort((a, b) => a.site.localeCompare(b.site) || a.desc.toLowerCase().localeCompare(b.desc.toLowerCase()) || a.uom.localeCompare(b.uom) || a.date.localeCompare(b.date) || a.po.localeCompare(b.po));
  const rc = lines.map(l => {
    const key = l.site + "\u0001" + l.desc + "\u0001" + l.uom;
    if (!ixOf.has(key)) { const [unit, k] = UNIT_MAP[l.uom.toLowerCase()] || [l.uom ? l.uom[0].toUpperCase() + l.uom.slice(1).toLowerCase() : "Nos", 1];
      ixOf.set(key, items.length); items.push([idx(sites, l.site), "", l.desc, idx(cats, l.main || ""), idx(cats, l.sub || ""), l.uom, unit, +k.toFixed(8)]); }
    return [ixOf.get(key), l.date, l.rate, l.qty, l.po, idx(vendors, l.vendor)];
  });
  const dates = lines.map(l => l.date).sort();
  return {rev: new Date().toISOString().slice(0, 10), sources, from: dates[0], to: dates[dates.length - 1], sites, vendors, cats, items, rc, pos: posT};
}
(async () => {
  const o = args(), html = fs.readFileSync(o.html, "utf8");
  const block = id => new RegExp(`(<script type="application/json" id="${id}">)([\\s\\S]*?)(</script>)`);
  const mPo = block("raPoData").exec(html), mGrn = block("raGrnData").exec(html);
  if (!mPo) { console.error(`${o.html}: no raPoData block found`); process.exit(1); }
  const old = mPo[2].trim() ? JSON.parse(mPo[2]) : null, {lines, pos: posT} = unpack(old), sources = old ? old.sources.slice() : [];
  const grnCat = new Map();   // a GRN item's category, by its description
  if (mGrn) { const g = JSON.parse(mGrn[2]); g.items.forEach(a => { const k = clean(a[2]).toLowerCase(); if (!grnCat.has(k)) grnCat.set(k, [g.cats[a[3]], g.cats[a[4]]]); }); }
  const key = l => [l.site, l.po, l.desc, l.qty, l.rate].join("\u0001"), have = new Map();
  lines.forEach(l => have.set(key(l), (have.get(key(l)) || 0) + 1));
  let added = 0;
  for (const f of o.pdfs) {
    const pos = parsePos(await pdfLines(f)); check(pos, f);
    const fresh = new Map(); let n = 0;
    pos.forEach(p => {
      const site = o.site || (COMPANY_SITE.find(([rx]) => rx.test(p.company)) || [])[1];
      if (!site) { console.error(`${f}: PO ${p.po} — company "${p.company}" has no site; give --site`); process.exit(1); }
      posT[site + "|" + p.po] = [p.date, p.vendor, p.ref, p.subtotal, p.tax || 0, p.total, p.discount || 0];
      p.items.forEach(i => {
        const desc = i.desc || "(no item description on the PO)", [main, sub] = grnCat.get(desc.toLowerCase()) || ["", ""];
        const l = {site, po: p.po, date: p.date, vendor: p.vendor, desc, main, sub, uom: i.uom, qty: i.qty, rate: i.rate}, k = key(l);
        fresh.set(k, (fresh.get(k) || 0) + 1);
        if (fresh.get(k) > (have.get(k) || 0)) { have.set(k, (have.get(k) || 0) + 1); lines.push(l); n++; }
      });
    });
    console.log(`${path.basename(f)}: ${pos.length} POs, ${pos.reduce((a, p) => a + p.items.length, 0)} lines, all add up; ${n} new lines`);
    if (n) sources.push(`${path.basename(f)} (${pos.length} POs, ${n} lines, merged ${new Date().toISOString().slice(0, 10)})`);
    added += n;
  }
  const data = pack(lines, posT, sources), blob = JSON.stringify(data).replace(/<\//g, "<\\/");
  fs.writeFileSync(o.html, html.slice(0, mPo.index + mPo[1].length) + blob + html.slice(mPo.index + mPo[1].length + mPo[2].length));
  console.log(`${added} new PO lines added; PO register now ${data.rc.length} lines, ${data.items.length} items, ${Object.keys(data.pos).length} POs, ${data.from} to ${data.to}`);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Refresh the Rate Database from the latest GRN: builds the #raGrnLatest block of the dashboard.

     node tools/grn_rates.js                 # writes zameen-developments/index.html
     node tools/grn_rates.js --dry-run       # report only
     node tools/grn_rates.js --html path/to/index.html --as-of 2026-10-07

   Needs playwright (npm i -g playwright). The page is opened with an empty library, so every Rate Database
   line is as published, and the page's own Rate DB vs GRN link (zdPriceTrends.links) says which GRN item each
   line is. For every linked line:

     * the item's description is looked for on every project in the GRN register (exact, ignoring case and
       punctuation) in the same house unit, and the receipts of the latest day are taken — the
       quantity-weighted average when there are several that day — converted to the line's unit
       (Metre -> Rft, M.Ton -> Kg, ...) as the link does;
     * only when that day is later than the line's effective date does the line take the rate, the date and a
       remark `<site> GRN RCP-n, DD-Mon-YYYY — <vendor> ...` (CLAUDE.md rate-data rules); a line with no newer
       GRN is left as it is. A newer GRN at the same rate refreshes the date and source only;
     * a new rate more than 3 times or less than a third of the old one is not applied — it is listed for a
       decision (a pack against a piece, a different spec under the same name).

   The block holds, per line, every value the line has been published at (`prev`), so a saved library takes the
   new rate only while the line still holds one of them; a rate typed in by hand is kept (raSyncGrnLatest in the
   page). Entries of an earlier run are kept unless a newer GRN supersedes them. */
const fs = require("fs"), path = require("path"), http = require("http"), crypto = require("crypto");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }

const ROOT = path.resolve(__dirname, "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HTML = path.resolve(arg("--html", path.join(ROOT, "zameen-developments", "index.html")));
const DRY = process.argv.includes("--dry-run");
const AS_OF = arg("--as-of", new Date().toISOString().slice(0, 10));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = d => { const p = d.split("-"); return p[2] + "-" + MON[+p[1] - 1] + "-" + p[0]; };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const r2 = v => Math.round(v * 100) / 100;
const fmt = v => (Math.round(v * 1000) / 1000).toLocaleString("en-US", {maximumFractionDigits: 3});
const GRN_RE = /(<script type="application\/json" id="raGrnData">)(.*?)(<\/script>)/s;
const LAT_RE = /(<script type="application\/json" id="raGrnLatest">)(.*?)(<\/script>)/s;

function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
      r.setHeader("content-type", f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "application/javascript" : "application/octet-stream");
      r.end(fs.readFileSync(f));
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}

(async () => {
  const html = fs.readFileSync(HTML, "utf8");
  const D = JSON.parse(html.match(GRN_RE)[2]);
  const oldBlock = (m => m && m[2].trim() ? JSON.parse(m[2]) : null)(html.match(LAT_RE));

  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/${path.relative(ROOT, HTML).split(path.sep).join("/")}`;
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g/, r => r.abort());
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(url, {waitUntil: "load"});
  await page.waitForTimeout(2500);
  await page.click("#tabRA"); await page.waitForTimeout(300);
  await page.click('.navitem2[data-rvgo="pt"]'); await page.waitForTimeout(800);
  const S = await page.evaluate(() => {
    const L = zdPriceTrends.links().filter(o => !o.why && o.it && o.last && o.lastRate != null).map(o => ({
      code: o.x.code, name: o.x.name, unit: o.x.unit, rate: +o.x.rate, date: o.x.date || "", src: o.x.src || "", vs: o.x.vs || "",
      ix: o.it.ix, last: {date: o.last.date, rcp: o.last.rcp, rate: o.last.rate}, lastRate: o.lastRate}));
    const J = id => { try { return JSON.parse(document.getElementById(id).textContent); } catch (e) { return null; } };
    const hist = {}, add = (c, r, d) => { (hist[c] = hist[c] || []).push([+r, d || ""]); };
    RA_MAT_SEED.forEach(a => add(a[0], a[4], a[7]));
    Object.keys(RA_SEED_PREV).forEach(c => RA_SEED_PREV[c].forEach(p => add(c, p[0], p[1])));
    ["raMepData", "raCivilData", "raQsEngine", "raMasterData", "raGrnLatest"].forEach(k => {
      const b = J(k); if (!b) return;
      (b.rates || []).forEach(r => { add(r.code, r.rate, r.date); (r.prev || []).forEach(p => add(r.code, p[0], p[1])); });
      Object.keys(b.prevRates || {}).forEach(c => b.prevRates[c].forEach(p => add(c, p[0], p[1])));
      (b.fixes || []).forEach(f => { (f.from || []).forEach(p => add(f.code, p[0], p[1])); if (f.to) add(f.code, f.to.rate, f.to.date); });
    });
    RA.rates.forEach(x => add(x.code, x.rate, x.date));
    return {L, hist};
  });
  await browser.close(); srv.close();
  if (errs.length) { console.error("page errors:", errs); process.exit(1); }

  const byDesc = {};
  D.items.forEach((it, ix) => { (byDesc[norm(it[2])] = byDesc[norm(it[2])] || []).push(ix); });
  const rcs = {};
  D.rc.forEach(r => { (rcs[r[0]] = rcs[r[0]] || []).push(r); });

  const out = {}, held = [];
  S.L.forEach(o => {
    const base = D.items[o.ix];
    if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(o.date) || !o.last.rate) return;
    const f = o.lastRate / o.last.rate;                  // house unit -> the line's unit
    const day = [];
    let latest = "";
    byDesc[norm(base[2])].forEach(ix => {
      const it = D.items[ix];
      if (it[6] !== base[6]) return;
      (rcs[ix] || []).forEach(r => {
        if (r[1] > latest) { latest = r[1]; day.length = 0; }
        if (r[1] === latest) day.push({site: D.sites[it[0]], rcp: r[4], uom: it[5], k: it[7], raw: r[2], house: r[2] * it[7], qty: r[3], vendor: D.vendors[r[5]]});
      });
    });
    if (!day.length || latest <= o.date) return;         // no newer GRN: the line stays as it is
    const tq = day.reduce((s, r) => s + Math.max(r.qty, 0), 0);
    const avg = tq > 0 ? day.reduce((s, r) => s + r.house * Math.max(r.qty, 0), 0) / tq : day.reduce((s, r) => s + r.house, 0) / day.length;
    const rate = r2(avg * f);
    const ratio = rate / o.rate;
    if (!(ratio >= 1 / 3 && ratio <= 3)) { held.push({code: o.code, name: o.name, old: o.rate, oldDate: o.date, rate, latest, rcp: day[0].site + " " + day[0].rcp}); return; }
    day.sort((a, b) => b.qty - a.qty);
    const h = day[0], lo = r2(Math.min(...day.map(r => r.house)) * f), hi = r2(Math.max(...day.map(r => r.house)) * f);
    const vendors = [...new Set(day.map(r => r.vendor))];
    let det = vendors.slice(0, 2).join(" / ") + (vendors.length > 2 ? " +" + (vendors.length - 2) : "") + ", " + fmt(tq || h.qty) + " " + h.uom;
    if (day.length > 1) {
      det += `; ${day.length} receipts that day (${[...new Set(day.map(r => r.site + " " + r.rcp))].join(", ")})`;
      det += lo !== hi ? `, quantity-weighted average of ${fmt(lo)}–${fmt(hi)}` : "";
    }
    if (h.k !== 1 || f !== 1) det += `; billed ${fmt(h.raw)} per ${h.uom}, converted to per ${o.unit}`;
    det += `. Replaces ${fmt(o.rate)} of ${dmy(o.date)}`;
    const prev = new Map();
    (S.hist[o.code] || []).forEach(p => prev.set(p[0] + "|" + p[1], p));
    prev.set(o.rate + "|" + o.date, [o.rate, o.date]);
    prev.delete(rate + "|" + latest);
    out[o.code] = {code: o.code, rate, date: latest, vs: "V", src: `${h.site} GRN ${h.rcp}, ${dmy(latest)} — ${det}`, prev: [...prev.values()], _old: o.rate, _name: o.name};
  });

  // earlier runs: kept unless a newer GRN replaced them
  if (oldBlock) oldBlock.rates.forEach(e => { if (!out[e.code]) out[e.code] = e; });
  const rates = Object.keys(out).sort().map(c => { const e = Object.assign({}, out[c]); delete e._old; delete e._name; return e; });

  const changed = Object.values(out).filter(e => e._old != null);
  console.log(`${changed.length} lines have a newer GRN (${changed.filter(e => e.rate !== e._old).length} at a new rate, ${changed.filter(e => e.rate === e._old).length} same rate, date and source refreshed); ${held.length} held for a decision`);
  changed.sort((a, b) => a.code < b.code ? -1 : 1).forEach(e => console.log(`  ${e.code.padEnd(26)} ${String(e._old).padStart(10)} -> ${String(e.rate).padStart(10)}  ${e.date}  ${(e._name || "").slice(0, 34)}`));
  held.forEach(h => console.log(`  HELD ${h.code}: ${h.name} ${h.old} (${h.oldDate}) -> ${h.rate} (${h.rcp}, ${h.latest}) — ratio outside 1/3..3`));

  const rev = AS_OF + "-" + crypto.createHash("sha1").update(JSON.stringify(rates)).digest("hex").slice(0, 8);
  const block = {rev, asOf: AS_OF, source: `GRN Price Register ${D.rev}: ${D.rc.length} receipts of ${D.sites.length} projects`, rates};
  if (!DRY) {
    const json = JSON.stringify(block).replace(/<\//g, "<\\/");
    const tag = `<script type="application/json" id="raGrnLatest">${json}</script>`;
    fs.writeFileSync(HTML, LAT_RE.test(html) ? html.replace(LAT_RE, () => tag) : html.replace(/(<script type="application\/json" id="raPoData">)/, () => tag + "\n$1"));
    console.log(`raGrnLatest ${rev}: ${rates.length} lines → ${HTML}`);
  }
})();

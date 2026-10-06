#!/usr/bin/env node
/* Browser tests for Price Trends & Staleness (QS Cost Control → Price Trends).

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_price_trends.js          # needs playwright (npm i -g playwright)

   PT_URL   page to test (default http://127.0.0.1:8765/zameen-developments/index.html)
   QE_LIBS  folder holding chart.js/dist/chart.umd.js — the real chart is drawn when it is there (offline /
            sandboxed runs); otherwise Chart is stubbed and only the page logic is checked

   Checks, against figures worked out here from the page's own GRN block: receipts per material group and
   their house-unit rates (Ton → Kg), items in another unit left out, latest receipt, the Rate Database tile,
   site / period filters, single-item search, the table view; Rate DB vs latest GRN (which lines are linked,
   assumptions and composites not, the receipt nearest the line on a day with several, tolerance); a new
   RFQ from ticked lines; the staleness map totals and cell lists; phone width; no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.PT_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
const LIBS = process.env.QE_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  const errors = [];
  const realChart = LIBS && fs.existsSync(path.join(LIBS, "chart.js/dist/chart.umd.js"));
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g/, async route => {
    const u = route.request().url();
    if (/chart\.js/.test(u)) return realChart ? route.fulfill({path: path.join(LIBS, "chart.js/dist/chart.umd.js"), contentType: "application/javascript"})
      : route.fulfill({body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript"});
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"});
  await page.waitForTimeout(2500);
  const $ = sel => page.locator("#rav-pt " + sel);
  const T = (fn, arg) => page.evaluate(fn, arg);

  /* independent view of the GRN block */
  const grn = await T(() => {
    const d = JSON.parse(document.getElementById("raGrnData").textContent);
    return d.items.map((a, i) => ({ix: i, site: d.sites[a[0]], desc: a[2], unit: a[6], k: a[7],
      rc: d.rc.filter(r => r[0] === i).map(r => ({date: r[1], rate: Math.round(r[2] * a[7] * 100) / 100, grnRate: r[2], rcp: r[4]}))}));
  });

  console.log("view");
  await page.click("#tabRA");
  await page.waitForTimeout(300);
  await page.click('.navitem2[data-rvgo="pt"]');
  await page.waitForTimeout(500);
  ok(await page.isVisible("#rav-pt"), "sidebar entry opens Price Trends");
  ok((await $(".pt-tabs button").count()) === 3, "three tabs");

  console.log("price trend");
  const cem = await T(() => { const g = zdPriceTrends.group(), p = zdPriceTrends.points(); return {items: g.items.map(i => i.ix), out: g.out.map(i => i.unit), unit: g.unit, db: g.db && g.db.code, n: p.length, last: p.reduce((b, x) => !b || x.r.date > b.r.date ? x : b, null)}; });
  const cemN = grn.filter(i => cem.items.indexOf(i.ix) >= 0).reduce((s, i) => s + i.rc.length, 0);
  ok(cem.unit === "Bag" && cem.db === "CEM" && cem.n === cemN && cem.n > 50, `cement: ${cem.n} receipts per Bag, compared with CEM`);
  ok(cem.out.indexOf("Pack") >= 0 && /Left out/.test(await $(".racard").innerText()), "items in another unit (Pack) are left out and listed");
  ok(/Each read as one bag/.test(await $(".racard").innerText()), "the Each → bag reading is stated");
  const tiles = await $(".rak").allInnerTexts();
  const cemDb = await T(() => RA.rates.find(r => r.code === "CEM"));
  ok(tiles[0].indexOf(cem.last.r.date.split("-").reverse().join("-").replace(/-(\d\d)-/, (m, mm) => "-" + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mm - 1] + "-")) >= 0, "latest-GRN tile shows the latest receipt date");
  ok(tiles[2].indexOf(cemDb.rate.toLocaleString("en-PK", {minimumFractionDigits: 2})) >= 0, "Rate Database tile shows the CEM rate");
  ok((await $("#ptCanvas").count()) === 1, realChart ? "chart drawn (Chart.js)" : "chart canvas placed (Chart stubbed)");

  await $('[data-pt-f="g"]').selectOption("stl");
  await page.waitForTimeout(300);
  const stl = await T(() => zdPriceTrends.points().filter(p => p.it.unit === "Ton").slice(0, 5).map(p => [p.r.grnRate, p.y]));
  ok(stl.length > 0 && stl.every(a => Math.abs(a[0] / 1000 - a[1]) < 0.01), "steel per Ton converted to per Kg (÷ 1,000)");
  await $('[data-pt-f="site"]').selectOption("Quadrangle");
  await page.waitForTimeout(250);
  ok(await T(() => zdPriceTrends.points().every(p => p.it.site === "Quadrangle")), "site filter");
  await $('[data-pt-f="period"]').selectOption("12");
  await page.waitForTimeout(250);
  const cut = new Date(); cut.setMonth(cut.getMonth() - 12);
  ok(await T(c => zdPriceTrends.points().every(p => p.r.date >= c), cut.toISOString().slice(0, 10)), "period filter (last 12 months)");
  await $('[data-pt-f="site"]').selectOption("");
  await $('[data-pt-f="period"]').selectOption("all");
  const one = grn.filter(i => i.rc.length > 5)[0];
  await $('[data-pt-f="item"]').fill(one.desc);
  await $('[data-pt-f="item"]').dispatchEvent("change");
  await page.waitForTimeout(300);
  const single = await T(() => ({n: zdPriceTrends.points().length, key: zdPriceTrends.group().key}));
  const oneSame = grn.filter(i => i.desc.toLowerCase() === one.desc.toLowerCase()).sort((a, b) => b.rc.length - a.rc.length)[0];
  ok(single.key === "item" + oneSame.ix && single.n === oneSame.rc.length, `single-item search plots that item (${single.n} receipts)`);
  await $('[data-pt-act="table"]').click();
  await page.waitForTimeout(250);
  ok((await $("table.ratbl tbody tr").count()) === Math.min(500, single.n), "table view lists every receipt");
  await $('[data-pt-act="table"]').click();

  console.log("Rate DB vs latest GRN");
  await $('[data-pt-tab="grn"]').click();
  await page.waitForTimeout(400);
  const L = await T(() => zdPriceTrends.links().map(o => ({code: o.x.code, why: o.why || "", dev: o.dev, last: o.last ? o.last.rcp : "", how: o.how})));
  const by = c => L.find(o => o.code === c);
  ok(L.length > 150, `${L.length} lines linked to a GRN`);
  /* DIESEL (392/Ltr, Phoenix RCP-311 of 28-Aug-2026) now has a newer GRN: RCP-326 of 30-Sep-2026 with three
     receipts that day (371, 379, 383) — compared with the nearest of them, 383 */
  ok(by("DIESEL") && by("DIESEL").last === "RCP-326" && Math.abs(by("DIESEL").dev - (392 / 383 - 1) * 100) < 0.01,
     "DIESEL: several receipts on the latest day — compared with the nearest of them (+2.35%)");
  ok(by("CEM") && /cross-check/.test(by("CEM").how) && by("CEM").dev > 10, "CEM: its 'Last … GRN' cross-check is compared (market rate above the last receipt)");
  ok(!by("MAT-WB") && !by("MOULD") && !by("MAT-SND-ZDP"), "composites and assumptions are not linked to the receipts they mention");
  ok(by("GRN-PHO-ENAMEL-L") && /per Gallon/.test(by("GRN-PHO-ENAMEL-L").why), "a receipt in another unit is reported, not compared");
  ok(L.filter(o => !o.why).every(o => o.dev == null || isFinite(o.dev)), "every comparable line has a difference");
  const rows1 = await $("table.ratbl tbody tr").count();
  await $('[data-pt-f="thr"]').fill("40");
  await $('[data-pt-f="thr"]').dispatchEvent("change");
  await page.waitForTimeout(300);
  ok((await $("table.ratbl tbody tr").count()) < rows1, "raising the tolerance clears lines from 'needs attention'");
  await $('[data-pt-f="thr"]').fill("10");
  await $('[data-pt-f="thr"]').dispatchEvent("change");
  await page.waitForTimeout(300);
  await $('[data-pt-sel="CEM"]').check();
  await page.waitForTimeout(150);
  await $('[data-pt-act="rfq"]').click();
  await page.waitForTimeout(400);
  ok(await page.isVisible("#rav-rfq") && (await T(() => RA.rfq.rfqs[0].lines.map(l => l.code).join(","))) === "CEM", "ticked line opens a new RFQ in the RFQ Tracker");

  console.log("staleness map");
  await page.click('#raSub button[data-rv="pt"]');
  await page.waitForTimeout(300);
  await $('[data-pt-tab="stale"]').click();
  await page.waitForTimeout(400);
  const used = await T(() => { const u = {}; RA.items.forEach(it => ["M", "L", "P"].forEach(k => (it[k] || []).forEach(r => { if (r.ref && +r.qty) u[r.ref] = 1; }))); return RA.rates.filter(x => u[x.code]).length; });
  const tot = await $(".pt-heat tbody tr:last-child td:last-child").innerText();
  ok(+tot.replace(/,/g, "") === used, `map total = lines used in analyses (${used})`);
  const types = await T(() => Object.fromEntries(["MAT-PPR-075", "DIESEL", "MAT-ASPH", "WATER"].map(c => [c, zdPriceTrends.srcType(RA.rates.find(r => r.code === c))])));
  ok(types["MAT-PPR-075"] === "list" && types.DIESEL === "grn" && types["MAT-ASPH"] === "mrs" && types.WATER === "assump", "source kinds read from the remarks");
  const cell = $(".pt-cell:not(.z)").first();
  const cn = +(await cell.innerText()).replace(/,/g, "");
  await cell.click();
  await page.waitForTimeout(300);
  ok((await $(".racard").nth(1).locator("tbody tr").count()) === Math.min(400, cn), `clicking a cell lists its ${cn} lines`);
  await $('[data-pt-f="kind"]').selectOption("L");
  await page.waitForTimeout(300);
  const totL = +(await $(".pt-heat tbody tr:last-child td:last-child").innerText()).replace(/,/g, "");
  ok(totL > 0 && totL < used, "kind filter (labour only)");

  console.log("layout");
  await page.setViewportSize({width: 390, height: 844});
  for (const tab of ["trend", "grn", "stale"]) {
    await page.evaluate(t => document.querySelector(`#rav-pt [data-pt-tab="${t}"]`).click(), tab);
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 1, `${tab}: no sideways scroll at 390 px (${over})`);
  }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

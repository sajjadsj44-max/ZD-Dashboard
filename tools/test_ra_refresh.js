#!/usr/bin/env node
/* Browser checks for the rate-refresh data block (#raRefreshData, tools/ra_refresh_data.py).

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_ra_refresh.js            # needs playwright (npm i -g playwright)

   Checks: a fresh library takes the block (refRev, refreshed lines, the new items priced as MRS composite + 8 %
   overhead + 10 % profit); a library saved before the block moves on — a line still at its earlier published
   value takes the new one, a missing new item is added — while a rate typed by hand is kept; no page errors. */
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.QE_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext(); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g|cdnjs/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  async function load(){ await page.goto(URL, {waitUntil: "domcontentloaded"}); await page.waitForTimeout(3500); }

  await load();
  await page.evaluate(() => localStorage.clear());
  await load();
  const fresh = await page.evaluate(() => {
    const D = JSON.parse(document.getElementById("raRefreshData").textContent);
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    const B = {}; D.rates.forEach(r => B[r.code] = r);
    const differ = D.rates.filter(b => !R[b.code] || R[b.code].rate !== b.rate || R[b.code].date !== b.date).map(b => b.code);
    const pile = RA.items.find(i => i.id === "CIV-PIL-102");
    return {rev: D.rev, refRev: RA.refRev, n: D.rates.length, differ, items: D.items.map(i => i.id),
            have: D.items.filter(i => RA.items.some(x => x.id === i.id)).length,
            pile: pile && raCalc(pile).rate, pileLine: B["MRS-C6-8-18"].rate, helper: R["L-HELPER"].rate, helperB: B["L-HELPER"].rate,
            prev: D.prevRates};
  });
  console.log("Fresh library");
  ok(fresh.refRev === fresh.rev, "block applied (refRev " + fresh.refRev + ")");
  ok(fresh.differ.length === 0, "all " + fresh.n + " lines hold the block's value" + (fresh.differ.length ? ": " + fresh.differ.slice(0, 8) : ""));
  ok(fresh.have === fresh.items.length && fresh.items.length >= 80, "all " + fresh.items.length + " new items present");
  ok(Math.abs(fresh.pile - fresh.pileLine * 1.18) < 0.05, "24\" pile = MRS 3,177.20 + 8% OH + 10% profit (" + (fresh.pile || 0).toFixed(2) + ")");
  ok(fresh.helper === fresh.helperB, "L-HELPER at the PBS Lahore wage (" + fresh.helper + ")");

  // a library saved before the block: earlier published values, one new item missing, one rate typed by hand
  const setup = await page.evaluate(() => {
    const D = JSON.parse(document.getElementById("raRefreshData").textContent);
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    const moved = ["GROUT", "L-HELPER", "RMC-5000", "MEP-Z-YS100"].filter(c => D.prevRates[c]);
    moved.forEach(c => { const p = D.prevRates[c][0]; R[c].rate = p[0]; R[c].date = p[1]; });
    const typed = "EMUL"; R[typed].rate = 41; R[typed].date = "2026-10-01"; R[typed].src = "Quotation, 01-Oct-2026 — typed by hand";
    RA.items = RA.items.filter(i => i.id !== "PLB-TW-102");
    delete RA.refRev; raPersist();
    return {moved, want: Object.fromEntries(moved.map(c => [c, D.rates.find(r => r.code === c).rate]))};
  });
  await page.waitForTimeout(300);
  await load();
  const up = await page.evaluate(m => {
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    return {refRev: RA.refRev, got: Object.fromEntries(m.map(c => [c, R[c].rate])), emul: R["EMUL"].rate,
            tw: !!RA.items.find(i => i.id === "PLB-TW-102")};
  }, setup.moved);
  console.log("Saved library from before the block");
  ok(!!up.refRev, "block applied on the next load");
  ok(setup.moved.length === 4 && setup.moved.every(c => up.got[c] === setup.want[c]),
     "lines at their earlier published value moved on (" + setup.moved.map(c => c + " " + up.got[c]).join(", ") + ")");
  ok(up.emul === 41, "a rate typed by hand is kept (EMUL 41)");
  ok(up.tw, "a missing new item is added back (PLB-TW-102)");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log("\n" + passes + " passed, " + fails + " failed");
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

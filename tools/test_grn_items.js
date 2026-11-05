#!/usr/bin/env node
/* Browser checks for the new rate analyses from the October-2026 GRNs (#raGrnItems, tools/grn_items_data.py) and the
   GRN-latest lines priced through ALIASES (tools/grn_rates.js).

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_grn_items.js             # needs playwright (npm i -g playwright)

   Checks: a fresh library takes the block (grnItRev, every new line and item, an all-in fabricator item and a
   GRN + MAK item priced as direct cost + 8 % overhead + 10 % profit) and the alias lines carry their GRN; a library
   saved before the block gets the missing items and lines back while a rate typed by hand is kept; no page errors. */
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
    const D = JSON.parse(document.getElementById("raGrnItems").textContent);
    const G = JSON.parse(document.getElementById("raGrnLatest").textContent);
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    const item = id => RA.items.find(i => i.id === id);
    const rate = id => item(id) ? raCalc(item(id)).rate : null;
    const g = {}; G.rates.forEach(r => g[r.code] = r);
    return {rev: D.rev, grnItRev: RA.grnItRev, lines: D.rates.filter(b => R[b.code] && R[b.code].rate === b.rate).length, nLines: D.rates.length,
            items: D.items.filter(i => item(i.id)).length, nItems: D.items.length,
            railing: rate("MISC-STL-109"), railLine: R["GRN-NEO-MEP-002768"] && R["GRN-NEO-MEP-002768"].rate,
            zcv3: rate("MF-408C"), zcvLine: R["GRN-NEO-MEP-001764"] && R["GRN-NEO-MEP-001764"].rate, zcvMak: R["MAK-MF-408A"].rate,
            sand: R["SAND-LP"], sandG: g["SAND-LP"], crush: R["CRSH-SG"], crushG: g["CRSH-SG"], ball: R["GRN-QUA-MEP-000567"].rate};
  });
  console.log("Fresh library");
  ok(fresh.grnItRev === fresh.rev, "block applied (grnItRev " + fresh.grnItRev + ")");
  ok(fresh.lines === fresh.nLines, "all " + fresh.nLines + " new lines at the block's value (" + fresh.lines + ")");
  ok(fresh.items === fresh.nItems && fresh.nItems >= 18, "all " + fresh.nItems + " new items present");
  ok(Math.abs(fresh.railing - fresh.railLine * 1.18) < 0.05, "parapet railing = fabricator's GRN 2,654 + 8% OH + 10% profit (" + (fresh.railing || 0).toFixed(2) + ")");
  ok(Math.abs(fresh.zcv3 - (fresh.zcvLine + fresh.zcvMak) * 1.18) < 0.05, "zone check assembly 3\" = GRN + MAK installation, + 18% (" + (fresh.zcv3 || 0).toFixed(2) + ")");
  ok(fresh.sand.rate === fresh.sandG.rate && /^Jade GRN RCP-534, 12-Oct-2026 — /.test(fresh.sand.src), "SAND-LP from the Lawrencepur sand GRN (" + fresh.sand.rate + ", " + fresh.sand.date + ")");
  ok(fresh.crush.rate === fresh.crushG.rate && /the GRN does not name the quarry/.test(fresh.crush.src), "CRSH-SG from the crush GRN, quarry caveat in the remark (" + fresh.crush.rate + ")");
  ok(fresh.ball === 1575, "brass ball valve line not taken over by a GI ball valve GRN (" + fresh.ball + ")");

  // a library saved before the block: no grnItRev, one new item and one new line missing, a library rate typed by hand
  await page.evaluate(() => {
    RA.items = RA.items.filter(i => i.id !== "FIN-CLG-105");
    RA.rates = RA.rates.filter(r => r.code !== "GRN-NEO-FIN-000469");
    const m = RA.rates.find(r => r.code === "MAK-ME-202"); m.rate = 45000; m.date = "2026-11-01"; m.src = "Quotation, 01-Nov-2026 — typed by hand";
    delete RA.grnItRev; raPersist();
  });
  await page.waitForTimeout(300);
  await load();
  const up = await page.evaluate(() => {
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    const smpb = RA.items.find(i => i.id === "ELE-DIS-107");
    return {grnItRev: RA.grnItRev, bulk: !!RA.items.find(i => i.id === "FIN-CLG-105"), line: R["GRN-NEO-FIN-000469"] && R["GRN-NEO-FIN-000469"].rate,
            mak: R["MAK-ME-202"].rate, smpb: raCalc(smpb).rate, smpbLine: R["GRN-NEO-MEP-001356"].rate};
  });
  console.log("Saved library from before the block");
  ok(!!up.grnItRev, "block applied on the next load");
  ok(up.bulk && up.line === 1229, "a missing new item and its line are added back (FIN-CLG-105, " + up.line + ")");
  ok(up.mak === 45000, "a rate typed by hand is kept (MAK-ME-202 45,000)");
  ok(Math.abs(up.smpb - (up.smpbLine + 45000) * 1.18) < 0.05, "a new item prices on the typed rate (ELE-DIS-107 " + up.smpb.toFixed(2) + ")");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log("\n" + passes + " passed, " + fails + " failed");
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

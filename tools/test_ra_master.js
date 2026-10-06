#!/usr/bin/env node
/* Browser checks for the Master Rate Analysis block (#raMasterData, tools/ra_master_data.py).

     python3 -m http.server 8765 &            # from the repo root
     RA_XSIDE=xside.json node tools/test_ra_master.js    # xside.json from ra_master_data.py --excel-json

   Checks: a fresh library carries every workbook item under its own code, and each built-up rate equals
   the workbook's rate excl. tax (RA_XSIDE); shared lines hold the same rate; the rebar / brick / plaster
   labour corrections apply; changing a rate re-prices the items that use it; the Item Library search and
   category filter find the new items; a saved library from before the block is upgraded on the next load
   while hand-edited items, typed rates and user-added items are left alone; no page errors. */
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const fs = require("fs");
const URL = process.env.QE_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
const X = process.env.RA_XSIDE ? JSON.parse(fs.readFileSync(process.env.RA_XSIDE, "utf8")) : null;
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext(); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g|cdnjs/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  async function load(){ await page.goto(URL, {waitUntil: "domcontentloaded"}); await page.waitForTimeout(3500); }

  await load();
  await page.evaluate(() => localStorage.clear());
  await load();
  const di = process.argv.indexOf("--dump");
  if (di > 0) {   // write the dashboard side of the reconciliation and stop
    const d = await page.evaluate(() => {
      const D = JSON.parse(document.getElementById("raMasterData").textContent), ids = new Set(D.items.map(i => i.id));
      const R = {}; RA.rates.forEach(r => R[r.code] = raNum(r.rate));
      return {items: RA.items.filter(i => ids.has(i.id)).map(i => ({id: i.id, unit: i.unit, desc: i.desc, rate: raCalc(i).rate,
              rows: [].concat(i.M, i.L, i.P).map(r => [r.ref, r.qty])})), rates: R,
              allRates: Object.fromEntries(RA.items.map(i => [i.id, raCalc(i).rate])), allUnits: Object.fromEntries(RA.items.map(i => [i.id, i.unit]))};
    });
    fs.writeFileSync(process.argv[di + 1], JSON.stringify(d)); await browser.close(); process.exit(0);
  }
  const fresh = await page.evaluate(() => {
    const D = JSON.parse(document.getElementById("raMasterData").textContent);
    const R = {}; RA.rates.forEach(r => R[r.code] = r);
    const calc = {}; RA.items.filter(i => D.items.some(d => d.id === i.id)).forEach(i => { const c = raCalc(i); calc[i.id] = {rate: c.rate, unit: i.unit, rows: [].concat(i.M, i.L, i.P).map(r => [r.ref, r.qty])}; });
    const L = id => RA.items.find(i => i.id === id);
    return {rev: D.rev, masRev: RA.masRev, want: D.items.length, calc,
            missing: D.items.flatMap(i => [].concat(i.M, i.L, i.P).map(r => r.ref)).filter(c => !R[c]),
            unsourced: D.rates.filter(d => !/\d{2}-[A-Z][a-z]{2}-\d{4}|ASSUMPTION/.test(R[d.code].src)).map(d => d.code),
            timb: R["QE-TIMB-CFT"].rate, st200: raCalc(L("ST-200")).C, brk45: raCalc(L("BRK-45-14")).C,
            brk9: raCalc(L("BRK-9-16")).C, brk135: raCalc(L("BRK-135-16")).C, pls05: raCalc(L("PLS-I05-14")).C,
            pls075: raCalc(L("PLS-I075-14")).C, qc: L("CIV-CON-020").qc};
  });
  console.log("Fresh library");
  ok(fresh.masRev === fresh.rev, "block applied (masRev " + fresh.masRev + ")");
  ok(Object.keys(fresh.calc).length === fresh.want && fresh.want >= 160, "all " + fresh.want + " workbook items present");
  ok(fresh.missing.length === 0, "every row points at an existing rate line" + (fresh.missing.length ? ": " + fresh.missing : ""));
  ok(fresh.unsourced.length === 0, "every line names a dated source or ASSUMPTION" + (fresh.unsourced.length ? ": " + fresh.unsourced : ""));
  if (X) {
    const bad = Object.entries(X.excel).filter(([id, e]) => { const c = fresh.calc[id]; return !c || Math.abs(c.rate - e.rateExTax) > 0.01 || c.unit !== e.unit
      || JSON.stringify(c.rows.map(r => [r[0], +(+r[1]).toFixed(6)])) !== JSON.stringify(e.rows.map(r => [r[0], +(+r[1]).toFixed(6)])); });
    ok(bad.length === 0, "every item's rate, unit and rows equal the workbook (" + Object.keys(X.excel).length + " checked)" + (bad.length ? ": " + bad.slice(0, 8).map(b => b[0]) : ""));
  }
  ok(fresh.timb === 3680, "QE-TIMB-CFT moved to the GRN rate 3,680");
  ok(Math.abs(fresh.st200 - 11.08) < 0.01, "ST-200 labour 11.08/kg (MRS 11.03) — was 36.80 (" + fresh.st200.toFixed(2) + ")");
  ok(Math.abs(fresh.brk45 * 2 - fresh.brk9) < 0.01 && Math.abs(fresh.brk135 - fresh.brk9 * 1.5) < 0.01, "brick labour scales with wall thickness (4½\" " + fresh.brk45.toFixed(2) + ", 9\" " + fresh.brk9.toFixed(2) + ", 13½\" " + fresh.brk135.toFixed(2) + ")");
  ok(Math.abs(fresh.pls05 - 36.88) < 0.01 && Math.abs(fresh.pls075 - 46.1) < 0.01, "plaster labour by thickness (½\" 36.88, ¾\" 46.10)");
  ok(fresh.qc === "C03", "new items carry their QS category");

  // editing a shared rate re-prices the workbook items that use it
  const repr = await page.evaluate(() => {
    const it = RA.items.find(i => i.id === "CIV-CON-016"), before = raCalc(it).rate;
    const r = RA.rates.find(x => x.code === "CEM"), old = r.rate; r.rate = old + 100;
    const after = raCalc(it).rate; r.rate = old; return {before, after, cem: it.M.find(m => m.ref === "CEM").qty};
  });
  ok(Math.abs((repr.after - repr.before) - repr.cem * 100 * 1.18) < 0.01, "changing CEM re-prices CIV-CON-016 (Δ " + (repr.after - repr.before).toFixed(2) + ")");

  // Item Library search / category filter
  const ui = await page.evaluate(() => {
    raGo("lib"); const q = document.getElementById("raQ"), T = () => document.getElementById("raLibTbl").textContent;
    q.value = "ready-mix 4000 psi pumped"; raRenderLib();
    const t1 = T().includes("CIV-CON-020"), n1 = document.getElementById("raLibN").textContent;
    q.value = "landing valve"; raRenderLib();
    const t2 = T().includes("FF-LV-001") && !T().includes("CIV-CON-020");
    q.value = ""; const f = document.getElementById("raFCat"); f.value = "Fire Fighting"; raRenderLib();
    const t3 = T().includes("FF-PIP-100") && !T().includes("CIV-CON-020"); f.value = ""; raRenderLib();
    return {t1, t2, t3, n: n1};
  });
  ok(ui.t1 && ui.t2 && ui.t3, "Item Library search and category filter find workbook and new items (" + ui.n + ")");

  // an older saved library: no masRev, old generator labour, seed rebar, one hand edit, one user item, one typed rate
  await page.evaluate(() => {
    RA.items = RA.items.filter(i => !JSON.parse(document.getElementById("raMasterData").textContent).items.some(d => d.id === i.id) || i.id === "FIN-PLS-001");
    const f = RA.items.find(i => i.id === "FIN-PLS-001"); f.note = "edited by hand"; f.M[0].qty = 0.02;
    RA.items.filter(i => i.gen && i.gen.k === "brick").forEach(i => i.L = [{ref: "L-MASON", qty: .024}, {ref: "L-HELPER", qty: .026}]);
    RA.items.filter(i => i.gen && i.gen.k === "plaster").forEach(i => i.L = [{ref: "L-PLMASON", qty: i.gen.ext ? .016 : .013}, {ref: "L-HELPER", qty: i.gen.ext ? .017 : .014}]);
    RA.items.find(i => i.id === "PLS-I1-16").L = [{ref: "L-PLMASON", qty: .02}, {ref: "L-HELPER", qty: .02}];   // hand edit
    RA.items.find(i => i.id === "ST-200").L = [{ref: "L-STEEL", qty: .01}, {ref: "L-HELPER", qty: .008}];
    const s5 = RA.items.find(i => i.id === "ST-205"); s5.M[1].qty = 0.015; s5.L = [{ref: "L-STEEL", qty: .01}, {ref: "L-HELPER", qty: .008}];                                                        // hand edit
    RA.items.push({id: "USR-001", code: "USR-001", cat: "Finishing", sub: "Mine", desc: "User item", spec: "", unit: "Sft", M: [{ref: "CEM", qty: 0.01}], L: [], P: [], wast: 5, oh: 8, prof: 10, acc: 0, trans: 0, gen: null, note: ""});
    const t = RA.rates.find(r => r.code === "QE-TIMB-CFT"); t.rate = 3000; t.date = "";
    const n = RA.rates.find(r => r.code === "NAILS"); n.rate = 760; n.date = "2026-09-25";                         // typed rate
    delete RA.masRev; raPersist();
  });
  await page.waitForTimeout(300);
  await load();
  const up = await page.evaluate(() => {
    const L = id => RA.items.find(i => i.id === id);
    const D = JSON.parse(document.getElementById("raMasterData").textContent);
    return {masRev: RA.masRev, n: D.items.filter(d => L(d.id)).length, want: D.items.length, pls: L("FIN-PLS-001"),
            brk: L("BRK-9-16").L.map(r => r.qty), pls05: L("PLS-I05-14").L.map(r => r.qty), pls1: L("PLS-I1-16").L.map(r => r.qty),
            st200: L("ST-200").L.map(r => r.qty), st205: L("ST-205").L.map(r => r.qty), usr: !!L("USR-001"),
            timb: RA.rates.find(r => r.code === "QE-TIMB-CFT").rate, nails: RA.rates.find(r => r.code === "NAILS").rate};
  });
  console.log("Saved library from before the block");
  ok(!!up.masRev && up.n === up.want, "missing workbook items added back (" + up.n + ")");
  ok(up.pls.note === "edited by hand" && up.pls.M[0].qty === 0.02, "a hand-edited workbook item is left alone");
  ok(up.brk[0] === 0.015 && up.pls05[0] === 0.01, "old brick / plaster generator labour migrated");
  ok(up.pls1[0] === 0.02, "hand-edited plaster labour kept");
  ok(Math.abs(up.st200[0] - 1 / 360) < 1e-6, "seed ST-200 labour corrected");
  ok(up.st205[0] === 0.01, "hand-edited ST-205 left alone");
  ok(up.usr, "user-added item kept");
  ok(up.timb === 3680 && up.nails === 760, "published QE-TIMB-CFT moved; typed NAILS 760 kept");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

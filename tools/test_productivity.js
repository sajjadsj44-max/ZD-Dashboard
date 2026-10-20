#!/usr/bin/env node
/* Browser tests for the Productivity tab: labour output norms, material coverage, the labour & duration estimator,
   the site output check and the wages it prices with.

     python3 -m http.server 8765 --bind 127.0.0.1 &   # from the repo root
     node tools/test_productivity.js                  # needs playwright (npm i -g playwright)

   PR_URL  page to test (default http://127.0.0.1:8765/zameen-developments/index.html)

   Checks the estimator against hand calculations (crew-days, crews, duration, man-days by trade, labour cost, floor
   factor, longer days, site efficiency, crews needed for a deadline, lines run together, the finish date over Sundays),
   day-rates from your own entry → the Rate Database → built in, material quantities, the site output check, that an
   estimate survives a reload, CSV export, the dashboard-wide search, switching to and from the other modules, the
   phone-width layout, and that no page errors occur. */
const fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.PR_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
function near(a, b, tol){ return a != null && Math.abs(a - b) <= (tol == null ? 1e-6 * Math.max(1, Math.abs(b)) : tol); }

(async () => {
  const browser = await pw.chromium.launch({});
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  const errors = [];
  await ctx.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|docs\.google\.com|fonts\.g/, route => {
    if (/chart\.js/.test(route.request().url())) return route.fulfill({body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript"});
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "domcontentloaded"});
  await page.evaluate(() => localStorage.clear());
  await page.reload({waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.zdProd && !document.getElementById("zd-lock"), null, {timeout: 20000});

  console.log("Data");
  const D = await page.evaluate(() => zdProd.data);
  const nv = D.acts.reduce((t, a) => t + a.v.length, 0);
  ok(D.acts.length >= 40 && nv >= D.acts.length, D.acts.length + " activities, " + nv + " crew outputs");
  ok(D.acts.every(a => a.v.every(v => v.out > 0 && v.crew.length && D.src[v.s] && D.src[v.s].d)), "every crew output is positive and names a dated source");
  ok(D.acts.every(a => a.v.every(v => v.crew.every(c => D.wages[c[0]] && D.wages[c[0]].r > 0 && D.roles[c[0]]))), "every trade in a crew has a name and a dated day-rate");
  ok(D.cov.length >= 20 && D.cov.every(c => c.lo > 0 && c.hi >= c.lo && D.src[c.s] && D.src[c.s].d), D.cov.length + " material coverage rows, each with a dated source");
  const brick = D.acts.find(a => a.id === "brick9"), lib = brick.v.find(v => v.s === "zdra7");
  ok(lib && lib.out === 50 && JSON.stringify(lib.crew) === JSON.stringify([["L-MASON", 1], ["L-HELPER", 1.5]]), "9\" brickwork (Pakistan library): 1 Mason + 1.5 Helper lay 50 cft a day");
  ok(brick.mrs && near(brick.mrs.lab, 90.5655), "9\" brickwork shows the Punjab MRS labour share 90.5655 / cft");

  console.log("Module switching");
  await page.click("#modProd");
  ok(await page.isVisible("#appPROD") && !(await page.isVisible("#appCALC")) && !(await page.isVisible("#appEXEC")), "Productivity opens on its own screen");
  ok(await page.$eval("#navgroup-prod", g => g.classList.contains("on")) && await page.$eval("#modProd", b => b.classList.contains("on")), "its button and menu are highlighted");
  await page.click("#modCalc");
  ok(!(await page.isVisible("#appPROD")) && await page.isVisible("#appCALC"), "Calculator hides it");
  await page.click("#modProd");
  ok(await page.isVisible("#appPROD") && !(await page.isVisible("#appCALC")), "…and it hides the Calculator");
  await page.click("#modExec");
  ok(!(await page.isVisible("#appPROD")) && !(await page.$eval("#modProd", b => b.classList.contains("on"))), "another module hides it");
  await page.click("#modProd");

  console.log("Every view renders");
  for (const v of ["home", "norms", "cov", "est", "check", "wages", "src"]) {
    await page.click('#navgroup-prod [data-zpgo="' + v + '"]');
    const h = await page.$eval("#zpView", e => e.textContent.length);
    ok(h > 200 && await page.$eval('#navgroup-prod [data-zpgo="' + v + '"]', e => e.classList.contains("active")), v + " (" + h + " characters, menu item active)");
  }

  console.log("Norms table");
  await page.click('[data-zpgo="norms"]');
  ok(await page.$$eval("#zpNormT tbody tr:not(.zp-grp)", r => r.length) === nv, "one row per crew output (" + nv + ")");
  await page.selectOption("#zpNt", "Masonry");
  const mas = await page.$$eval("#zpNormT tbody tr:not(.zp-grp)", r => r.length);
  ok(mas === D.acts.filter(a => a.t === "Masonry").reduce((t, a) => t + a.v.length, 0), "trade filter: Masonry only (" + mas + ")");
  await page.selectOption("#zpNt", "");
  await page.fill("#zpNq", "plaster");
  const want = D.acts.filter(a => /plaster/i.test(a.n + " " + a.t + " " + (a.k || ""))).map(a => a.n).sort().join("|");
  const got = (await page.$$eval("#zpNormT tbody tr.zp-a1 .zp-an b", r => r.map(x => x.textContent))).sort().join("|");
  ok(got && got === want, "search \"plaster\" keeps the plaster activities (by name, trade or site word): " + got.split("|").length);
  ok(await page.$eval("#zpNq", e => document.activeElement === e), "the search box keeps the caret while typing");
  await page.fill("#zpNq", "");

  console.log("Estimator — hand calculations");
  const R = await page.evaluate(() => {
    const E = {hrs: 8, dpw: 6, eff: 100, mode: "gangs", start: "2026-10-19", rows: []};
    const w = c => zdProd.wage(c).r;
    const c1 = zdProd.rowCalc(E, {a: "brick9", s: "zdra7", q: 1000, f: 0, o: "", g: 2});
    const flo = zdProd.rowCalc(E, {a: "brick9", s: "zdra7", q: 1000, f: 1, o: "", g: 2});
    const f6 = zdProd.liftFactor(zdProd.data.acts.find(a => a.id === "brick9"), 6);
    const h10 = zdProd.rowCalc(Object.assign({}, E, {hrs: 10}), {a: "brick9", s: "zdra7", q: 1000, f: 0, o: "", g: 2});
    const e80 = zdProd.rowCalc(Object.assign({}, E, {eff: 80}), {a: "brick9", s: "zdra7", q: 1000, f: 0, o: "", g: 2});
    const own = zdProd.rowCalc(E, {a: "brick9", s: "zdra7", q: 1000, f: 0, o: "40", g: 2});
    const dd = zdProd.rowCalc(Object.assign({}, E, {mode: "days"}), {a: "brick9", s: "zdra7", q: 1000, f: 0, o: "", d: 6});
    const seq = zdProd.schedule(Object.assign({}, E, {rows: [{a: "brick9", s: "zdra7", q: 1000, g: 2}, {a: "brick9", s: "zdra7", q: 500, g: 2}]}));
    const par = zdProd.schedule(Object.assign({}, E, {rows: [{a: "brick9", s: "zdra7", q: 1000, g: 2}, {a: "brick9", s: "zdra7", q: 500, g: 2, par: true}]}));
    const fin = zdProd.addWorkDays(new Date(2026, 9, 19), 15, 6), fin5 = zdProd.addWorkDays(new Date(2026, 9, 19), 15, 5);
    return {c1, flo, f6, h10, e80, own, dd, seq: {end: seq.end, peak: seq.peak, md: seq.md, roles: seq.roles, cost: seq.cost}, par: {end: par.end, peak: par.peak, men: par.men},
      fin: fin.toDateString(), fin5: fin5.toDateString(), mason: w("L-MASON"), helper: w("L-HELPER")};
  });
  const crewDay = R.mason + 1.5 * R.helper;
  ok(near(R.c1.cd, 20) && near(R.c1.dur, 10) && R.c1.men === 5 && near(R.c1.mdTot, 50), "1000 cft ÷ 50 = 20 crew-days; 2 crews → 10 days, 5 men a day, 50 man-days");
  ok(near(R.c1.md["L-MASON"], 20) && near(R.c1.md["L-HELPER"], 30), "man-days by trade: 20 mason + 30 helper");
  ok(near(R.c1.cost, 20 * crewDay, 1e-6) && near(R.c1.unitCost, 20 * crewDay / 1000), "labour cost = 20 crew-days × (mason + 1.5 helper) = PKR " + Math.round(R.c1.cost));
  const f1 = 90.5655 / (90.5655 + 17.9345);
  ok(near(R.flo.lf, f1) && near(R.flo.out, 50 * f1) && near(R.flo.cd, 1000 / (50 * f1)), "1st floor: × 90.5655 ÷ (90.5655 + 17.9345) = " + f1.toFixed(4) + " (Punjab MRS extra labour)");
  ok(near(R.f6, 90.5655 / (90.5655 + 100.505 + 2 * 10.7605)), "6th floor: 4th-floor extra + 2 × each further floor");
  ok(near(R.h10.out, 62.5) && near(R.h10.cd, 16) && near(R.h10.cost, R.c1.cost), "10-hour day: 62.5 cft a day, 16 crew-days, same labour cost (paid pro rata)");
  ok(near(R.e80.out, 40) && near(R.e80.cd, 25), "80% site efficiency: 40 cft a day, 25 crew-days");
  ok(near(R.own.out, 40) && near(R.own.cd, 25), "own output 40 cft a day overrides the norm");
  ok(R.dd.g === 4 && near(R.dd.dur, 5), "6 days allowed for 20 crew-days → 4 crews, done in 5 days");
  ok(near(R.seq.end, 15) && R.seq.peak === 5 && near(R.seq.md, 75), "two lines one after the other: 10 + 5 = 15 days, peak 5 men, 75 man-days");
  ok(near(R.par.end, 10) && R.par.peak === 10 && R.par.men[0] === 10 && R.par.men[9] === 5, "run together: 10 days, 10 men for 5 days then 5 men");
  ok(near(R.seq.roles["L-MASON"], 30) && near(R.seq.cost, 30 * crewDay, 1e-6), "trade totals add up across lines");
  ok(R.fin === new Date(2026, 10, 4).toDateString(), "15 working days from Mon 19-Oct-2026, Sundays off → Wed 04-Nov-2026 (" + R.fin + ")");
  ok(R.fin5 === new Date(2026, 10, 6).toDateString(), "…Saturdays and Sundays off → Fri 06-Nov-2026 (" + R.fin5 + ")");

  console.log("Estimator — in the page");
  await page.click('[data-zpgo="est"]');
  await page.selectOption("#zpAddA", "brick9");
  await page.click('[data-act="radd"]');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.r === "q"), "a new line puts the caret in its quantity");
  await page.keyboard.type("1000");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.r === "q" && document.activeElement.value === "1000"), "typing a quantity keeps the caret in the field");
  await page.fill('[data-r="g"]', "2");
  const kp = await page.$$eval("#zpView .zp-kpi .v", v => v.map(x => x.textContent));
  ok(/^10\b/.test(kp[0]) && /^50\b/.test(kp[1]) && /^5\b/.test(kp[2]), "KPIs: 10 working days, 50 man-days, 5 men a day (" + kp.slice(0, 3).join(" | ") + ")");
  ok(await page.$$eval(".zp-gantt rect.b", r => r.length) === 1 && await page.$$eval(".zp-gantt rect.h", r => r.length) === 10, "programme bar and 10 days of manpower bars");
  await page.selectOption('[data-r="f"]', "2");
  const f2 = await page.evaluate(() => zdProd.est().list[0].rows[0].f);
  ok(f2 === 2, "floor saved on the line");
  await page.click('[data-mode="days"]');
  await page.fill('[data-r="d"]', "4");
  ok(await page.evaluate(() => { const E = zdProd.est().list[0]; return zdProd.rowCalc(E, E.rows[0]).g; }) === Math.ceil(1000 / (50 * 90.5655 / (90.5655 + 40.269)) / 4 - 1e-9), "days mode: crews needed for 4 days on the 2nd floor");
  await page.reload({waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.zdProd && !document.getElementById("zd-lock"));
  ok(await page.evaluate(() => { const E = zdProd.est().list[0]; return E.rows.length === 1 && E.rows[0].q === "1000" && E.mode === "days" && E.rows[0].d === "4"; }), "the estimate is still there after a reload");
  await page.click("#modProd"); await page.click('[data-zpgo="est"]');
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="ecsv"]')]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  ok(/Brick masonry 9/.test(csv) && /Crew-days/.test(csv) && /Mason/.test(csv), "CSV export: lines, crew-days and trades (" + dl.suggestedFilename() + ")");

  console.log("Day-rates");
  const dr = await page.evaluate(() => {
    const before = zdProd.wage("L-MASON"), live = typeof RA !== "undefined" && RA && RA.rates;
    let rdb;
    if (live) {   // the QS Cost Control module is loaded: its live Rate Database is read
      const r = RA.rates.find(x => x.code === "L-MASON"), old = r.rate; r.rate = 3100; rdb = zdProd.wage("L-MASON"); r.rate = old;
    } else {      // not loaded yet: its copy saved on this device is read
      localStorage.setItem("SAJ_QSCOST_v1", JSON.stringify({rates: [{code: "L-MASON", kind: "L", unit: "Day", rate: 3100, src: "test", date: "2026-10-20"}], items: []}));
      rdb = zdProd.wage("L-MASON"); localStorage.removeItem("SAJ_QSCOST_v1");
    }
    return {before, rdb, live: !!live, built: zdProd.data.wages["L-MASON"]};
  });
  ok(dr.before.r > 0 && dr.before.r === (dr.live ? dr.before.r : dr.built.r), "mason day-rate " + dr.before.r + " from " + (dr.live ? "the live Rate Database" : "the built-in dated rate (" + dr.built.d + ")"));
  ok(dr.rdb.r === 3100 && dr.rdb.from === "rdb", "a Rate Database rate takes over (3,100, " + (dr.live ? "live module" : "saved copy") + ")");
  const all = await page.evaluate(() => Object.keys(zdProd.data.roles).map(k => [k, zdProd.wage(k).r]));
  ok(all.every(x => x[1] > 0), "every trade in the norms is priced: " + all.map(x => x[0] + " " + x[1]).join(", "));
  await page.click('[data-zpgo="wages"]');
  await page.fill('[data-w="L-MASON"]', "2800");
  ok(await page.evaluate(() => zdProd.wage("L-MASON").r === 2800 && zdProd.wage("L-MASON").from === "own"), "your own rate wins (2,800)");
  ok(/2,800\s*Your rate/.test(await page.textContent('[data-wrow="L-MASON"]')) && await page.$eval('[data-w="L-MASON"]', e => document.activeElement === e), "its row shows it at once, and the field keeps the caret");
  await page.click('[data-act="wclr"]');
  ok(await page.evaluate(r => zdProd.wage("L-MASON").r === r, dr.before.r), "Clear my rates goes back to " + dr.before.r);

  console.log("Material coverage");
  await page.click('[data-zpgo="cov"]');
  const cv = D.cov.find(c => c.coat && c.mode === "cov") || D.cov[0];
  await page.selectOption("#zpCqId", cv.id);
  await page.fill("#zpCqA", "1200");
  if (cv.coat) await page.fill("#zpCqC", "2");
  const q = await page.evaluate(([id]) => zdProd.covQty(zdProd.data.cov.find(c => c.id === id), 1200, 2), [cv.id]);
  const k = cv.coat ? 2 : 1;
  ok(near(q.lo, cv.mode === "cov" ? 1200 * k / cv.hi : 1200 * k * cv.lo) && near(q.hi, cv.mode === "cov" ? 1200 * k / cv.lo : 1200 * k * cv.hi), cv.m + ": 1200 " + cv.bu + (cv.coat ? " × 2 coats" : "") + " → " + q.lo.toFixed(2) + "–" + q.hi.toFixed(2) + " " + cv.per);
  ok(/\d/.test(await page.textContent("#zpCqR")), "the quick quantity shows a figure");
  await page.fill("#zpCq", "zzzz");
  ok(/No material matches/.test(await page.textContent("#zpView")), "a search with no match says so");
  await page.fill("#zpCq", "");

  console.log("Site output check");
  await page.click('[data-zpgo="check"]');
  await page.selectOption("#zpKa", "brick9");
  await page.selectOption("#zpKs", "zdra7");
  await page.fill('[data-k="q"]', "50"); await page.fill('[data-k="sk"]', "1"); await page.fill('[data-k="hl"]', "1.5"); await page.fill('[data-k="h"]', "8");
  ok(/100%/.test(await page.textContent("#zpKr")), "a gang doing exactly the norm is at 100%");
  await page.fill('[data-k="q"]', "40");
  ok(/80%/.test(await page.textContent("#zpKr")), "40 cft instead of 50 → 80%");

  console.log("Dashboard-wide search");
  await page.click("#modExec");
  await page.fill("#globalSearchInput", "brick masonry");
  await page.waitForTimeout(400);
  const gs = await page.textContent("#globalSearchResults");
  ok(/Productivity/.test(gs), "brick masonry finds the productivity norms");

  console.log("Phone width");
  await page.setViewportSize({width: 390, height: 840});
  await page.evaluate(() => zdProd.open("est"));
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ov <= 1, "no sideways page scroll at 390 px (tables scroll inside their box): " + ov);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

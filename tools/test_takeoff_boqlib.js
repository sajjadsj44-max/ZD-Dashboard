#!/usr/bin/env node
/* Browser tests for the BOQ item picker in PDF Takeoff's New condition, connected to the QS Cost Control rate library:
     - a browser with no library (a friend's, the Windows app) reads it from QS Cost Control on the same site by itself, the way a
       first visit to Rate Analysis builds it, and keeps it where Rate Analysis does (SAJ_QSCOST_v1); offline: says so, Try again
     - the library browsed by item group (Concrete, Block masonry, Plaster, Ceiling, Doors, Windows…), each group listed in full under
       its sub-categories; a search narrows the group; an item picked from a group fills the RA / BOQ codes and the unit
     - doors and windows sorted by what the description names first; a full browser keeps the library for the page only
     - a library read here is read again when QS Cost Control is published anew (its build in version.json)

     python3 -m http.server 8765 &            # from the repo root (QS Cost Control must be served too)
     TK_LIBS=<dir with pdfjs-dist/> node tools/test_takeoff_boqlib.js
*/
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g|cdnjs/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort();   // QS Cost Control's dashboard loads (Google Sheets, charts) are not needed for its library
  });
  let raBlocked = true;   // QS Cost Control out of reach first: an offline read
  const raReq = [];
  await ctx.route(/zameen-developments\/index\.html/, r => { raReq.push(r.request().url()); return raBlocked ? r.abort() : r.continue(); });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await T(() => { localStorage.removeItem("SAJ_QSCOST_v1"); localStorage.removeItem("zd-ra-from"); });
  await page.click("#bNewProj"); await page.fill("#dlgName", "BOQ library"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});

  console.log("no library in this browser, QS Cost Control out of reach");
  await page.click("#bNewCond");
  await page.waitForFunction(() => zdTakeoff.raConnect.state === "fail", null, {timeout: 20000}); await wait(100);
  ok(/could not be read/.test(await page.textContent("#cBoqL")) && (await page.locator("#cBoqTry").count()) === 1, "the list says the library could not be read, with Try again");
  ok(await T(() => !localStorage.getItem("SAJ_QSCOST_v1") && !document.querySelector("iframe")), "nothing saved, and no frame left behind");

  console.log("read from QS Cost Control (Try again)");
  raBlocked = false;
  const stall = T(() => new Promise(res => { let last = performance.now(), worst = 0; const iv = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; }, 10);
    setTimeout(() => { clearInterval(iv); res(worst); }, 6000); }));
  await page.click("#cBoqTry");
  await page.waitForFunction(() => zdTakeoff.raConnect.state === "ok" && document.querySelector("#cBoqG .boqc"), null, {timeout: 60000}); await wait(150);
  const lib = await T(() => { const o = JSON.parse(localStorage.getItem("SAJ_QSCOST_v1") || "null"); return o && {items: o.items.length, rates: o.rates.length, from: localStorage.getItem("zd-ra-from")}; });
  ok(lib && lib.items > 500 && lib.rates > 500, `the library is kept where Rate Analysis keeps it: ${lib && lib.items} items, ${lib && lib.rates} rate lines`);
  ok(lib && lib.from === "local", "where it came from is noted (here: not a deployed build)");
  ok(await T(() => !document.querySelector("iframe")), "the QS Cost Control frame is gone once read");
  ok(await T(() => document.activeElement && document.activeElement.id === "cBoqQ"), "the keyboard stays in the dialog (in the search box), not in the frame");
  console.log("    (longest pause of this page while reading: " + Math.round(await stall) + " ms)");
  ok(/Link a Rate Analysis item/.test(await page.textContent("#cRaInfo")), "the RA code note says what to do now, not where to find the library");

  console.log("browsed by item group");
  const chips = await T(() => Object.fromEntries([...document.querySelectorAll("#cBoqG .boqc")].map(b => [b.dataset.boqg || "Suggested", +(b.querySelector("span") || {}).textContent || 0])));
  for (const g of ["Concrete", "Block masonry", "Brick masonry", "Plaster", "Ceiling", "Flooring & tiles", "Paint", "Doors", "Windows"]) ok(chips[g] > 0, `${g}: ${chips[g]} items`);
  ok("Suggested" in chips && /suggested|type a name/.test(await page.textContent("#cBoqHint")), "Suggested (from the name) is the group at first");
  const rows = () => T(() => [...document.querySelectorAll("#cBoqL .boqr")].map(r => r.dataset.boqpick));
  const inGroup = (g, codes) => T(([g, codes]) => { const G = zdTakeoff.boqGroups(zdTakeoff.raLib()).get(g), s = new Set(G.map(it => String(it.code || it.id))); return codes.every(c => s.has(c)) && codes.length === G.length; }, [g, codes]);
  await page.click('#cBoqG [data-boqg="Plaster"]'); await wait(150);
  { const r = await rows(); ok(r.length === chips.Plaster && await inGroup("Plaster", r), `Plaster lists all its ${r.length} items`); }
  ok(await T(() => { const h = [...document.querySelectorAll("#cBoqL .boqh")].map(x => x.textContent); return h.length >= 2 && h.some(x => /internal plaster/i.test(x)); }), "under their sub-categories (Internal plaster, External plaster…)");
  ok(/items — Plaster/.test(await page.textContent("#cBoqHint")) && await T(() => document.querySelector('#cBoqG [data-boqg="Plaster"]').getAttribute("aria-pressed") === "true"), "the hint and the chip show the group picked");
  await page.click('#cBoqG [data-boqg="Ceiling"]'); await wait(150);
  ok(await T(() => [...document.querySelectorAll("#cBoqL .boqr")].every(x => /ceiling|access panel|bulkhead/i.test(x.title))), "Ceiling: ceiling items only");
  await page.focus('#cBoqG [data-boqg="Paint"]'); await page.keyboard.press("Enter"); await wait(150);
  ok(/items — Paint/.test(await page.textContent("#cBoqHint")) && await T(() => document.getElementById("dlgBack").classList.contains("on")), "Enter on a group picks it — the dialog is not confirmed");
  ok(await T(() => document.activeElement && document.activeElement.dataset.boqg === "Paint"), "the keyboard stays on the group pressed");
  await page.click('#cBoqG [data-boqg="Concrete"]'); await wait(100);
  await page.fill("#cBoqQ", "1:2:4"); await page.dispatchEvent("#cBoqQ", "input"); await wait(150);
  { const r = await rows(); ok(r.length >= 1 && r.length < chips.Concrete && await T(codes => { const s = new Set(zdTakeoff.boqGroups(zdTakeoff.raLib()).get("Concrete").map(it => String(it.code || it.id))); return codes.every(c => s.has(c)); }, r) && /found in Concrete/.test(await page.textContent("#cBoqHint")),
    `a search narrows the group: “1:2:4” → ${r.length} concrete items`); }
  await page.fill("#cBoqQ", ""); await page.dispatchEvent("#cBoqQ", "input");

  console.log("doors and windows by number");
  await page.selectOption("#cPre", {label: "Doors"}); await wait(200);
  await page.click('#cBoqG [data-boqg="Doors"]'); await wait(150);
  const nosDoor = await T(() => (zdTakeoff.boqGroups(zdTakeoff.raLib()).get("Doors").find(it => /^nos$/i.test(it.unit) && zdTakeoff.raPrice(it.code || it.id).rate > 0 && !zdTakeoff.raPrice(it.code || it.id).gaps) || {}).code || "");
  ok(!!nosDoor, "the Doors group holds doors priced per number (Nos): " + nosDoor);
  await page.click(`#cBoqL [data-boqpick="${nosDoor}"]`); await wait(200);
  ok((await page.inputValue("#cRa")) === nosDoor && (await page.inputValue("#cType")) === "count" && (await page.inputValue("#cUnit")) === "Nos" && /PKR [\d,]+\.\d\d \/ Nos/.test(await page.textContent("#cRaInfo")),
    `a door picked from the group: RA ${nosDoor}, counted in Nos, its rate from Rate Analysis`);
  ok(await T(c => document.querySelector(`#cBoqL [data-boqpick="${c}"]`).classList.contains("on"), nosDoor) && (await page.locator("#cBoqL .boqh").count()) >= 1, "the group stays listed, the picked item marked");
  await page.click('#cBoqG [data-boqg="Windows"]'); await wait(150);
  ok((await rows()).length === chips.Windows && await T(() => [...document.querySelectorAll("#cBoqL .boqr")].every(x => /window|screen|grill/i.test(x.title))), "Windows: window items only");
  await page.click('#cBoqG [data-boqg=""]'); await wait(150);
  ok(/suggested from the name/.test(await page.textContent("#cBoqHint")) && (await rows()).length >= 1, "Suggested lists the items matching the name again");
  await page.click("#dlgCancel"); await wait(200);

  console.log("item groups (a small library)");
  { const g = await T(() => { const mk = (code, cat, sub, desc) => ({code, cat, sub, desc, unit: "Sft"});
      const items = [mk("D1", "Finishing", "Doors", "Providing and fixing steel window with openable glazed panels"), mk("D2", "Finishing", "Aluminium windows", "Providing and fixing glazed aluminium door 1.6 mm"),
        mk("D3", "Finishing", "Doors", "Providing and fixing deodar wood chowkat 4.5x3"), mk("D4", "Miscellaneous", "Metal work", "Providing and fixing MS window grill"),
        mk("D5", "ELV", "RFID door lock", "RFID door lock with reader"), mk("D6", "Finishing", "Glass partitions", "Automatic sliding glass door, 12 mm tempered"),
        mk("M1", "Civil / Structural", "Masonry", "Providing and laying 8\" hollow block masonry"), mk("M2", "Civil / Structural", "Masonry", "First class burnt brick masonry 9\" thick"),
        mk("C1", "Finishing", "Tile / grid ceiling", "Vinyl-faced gypsum ceiling tiles 2'x2'"), mk("I1", "HVAC", "Insulation", "Duct insulation"), mk("X1", "Civil / Structural", "General", "Mobilization")];
      const G = zdTakeoff.boqGroups({items: new Map(items.map(i => [i.code, i]))}), of = c => [...G].filter(([, a]) => a.some(i => i.code === c)).map(([n]) => n).join("+");
      return Object.fromEntries(items.map(i => [i.code, of(i.code)])); });
    ok(g.D1 === "Windows" && g.D4 === "Windows", "a steel window filed under Doors, and a window grill: Windows");
    ok(g.D2 === "Doors" && g.D3 === "Doors" && g.D6 === "Doors", "a glazed door under Aluminium windows, a chowkat, a sliding glass door: Doors");
    ok(g.D5 === "ELV" && g.I1 === "HVAC", "a door lock or insulation of a services trade stays in its trade");
    ok(g.M1 === "Block masonry" && g.M2 === "Brick masonry", "Masonry split into block and brick by the description");
    ok(g.C1 === "Ceiling", "ceiling tiles are Ceiling, not Flooring & tiles");
    ok(g.X1 === "Other", "an item no group takes is under Other"); }

  console.log("the library opened in Rate Analysis carries on from it");
  { const p2 = await ctx.newPage(); await p2.goto(new globalThis.URL("../zameen-developments/index.html", URL).href, {waitUntil: "domcontentloaded"});
    const n = await p2.evaluate(() => { raLoad(); return RA.items.length; }); await p2.close();
    ok(n === lib.items, `Rate Analysis reads the same ${n} items`); }

  console.log("a browser that will not store it");
  await T(() => { localStorage.removeItem("SAJ_QSCOST_v1"); const s = Storage.prototype.setItem; window.__setItem = s;
    Storage.prototype.setItem = function (k, v) { if (k === "SAJ_QSCOST_v1") throw new DOMException("full", "QuotaExceededError"); return s.call(this, k, v); }; });
  await page.waitForTimeout(3100);   // raLib reads the browser again after 3 s
  ok(await T(async () => { const r = await zdTakeoff.raConnect(); return r && !localStorage.getItem("SAJ_QSCOST_v1") && zdTakeoff.raLib().o && zdTakeoff.raLib().items.size > 500; }), "the library read is kept for this page, and the picker lists it");
  await T(() => { Storage.prototype.setItem = window.__setItem; });

  console.log("read again when QS Cost Control is published anew");
  await T(() => localStorage.setItem("zd-ra-from", "aaaaaaaaaaaa"));
  await page.route(/\/version\.json/, r => r.fulfill({contentType: "application/json", body: JSON.stringify({"zameen-developments/index.html": "bbbbbbbbbbbb", "takeoff/index.html": "cccccccccccc"})}));
  raReq.length = 0;
  ok(await T(() => zdTakeoff.raFresh()) === true && raReq.some(u => /\?b=bbbbbbbbbbbb$/.test(u)), "a new build in version.json: the library read again, from that build past the browser's copy");
  await T(() => localStorage.setItem("zd-ra-from", "aaaaaaaaaaaa"));
  ok(await T(() => zdTakeoff.raFresh()) === false, "not asked again straight away");
  await T(() => localStorage.removeItem("zd-ra-from"));
  ok(await T(() => { zdTakeoff.raFresh.at = 0; return zdTakeoff.raFresh(); }) === false, "a library Rate Analysis saved itself is left to Rate Analysis");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

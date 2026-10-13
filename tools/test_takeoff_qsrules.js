#!/usr/bin/env node
/* The QS house rules learned from marked-up Bluebeam takeoffs, on the hand-written drawings of tools/takeoff_qsrules_fixture.js:
   Auto area takes a bath's shower in over its partition (a floor trap drawn in it) and leaves out an empty space or a duct
   there; 🧱 Block masonry types every wall run by block (4" → 4"x8"x12", 8" external → 8"x8"x16", 8" internal → 8"x8"x12"),
   cuts it at a column, leaves a balcony parapet out and deducts the door on its wall.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_qsrules.js

   TK_LIBS   folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there)
   TK_URL    page to test (default http://127.0.0.1:8765/takeoff/) */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const FX = require("./takeoff_qsrules_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), errors = [];
  const ctx = await browser.newContext({viewport: {width: 1366, height: 768}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "QS rules"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "qsrules.pdf", mimeType: "application/pdf", buffer: FX.makeQsRulesPdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) { await page.keyboard.press("Escape"); await wait(150); }
  const fid = await T(() => zdTakeoff.P.proj.files[0].id);
  const goto = async n => { await T(([f, p]) => zdTakeoff.gotoPage(f, p), [fid, n]); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.texts[zdTakeoff.S.key], n, {timeout: 15000}); await wait(250);
    await T(k => { const S = zdTakeoff.S; zdTakeoff.P.proj.scales[S.key] = {ptPerFt: k, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()}; }, FX.K); };

  console.log("Auto area in wet rooms (p.1)");
  await goto(1);
  const area = c => T(async ([p, k]) => { const r = await zdTakeoff.autoRoomGuarded(p); if (r.err) return {err: r.err};
    const A = q => { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
    return {a: (A(r.pts) - (r.holes || []).reduce((s, h) => s + A(h.pts), 0)) / k / k, wet: r.wet || 0}; }, [c.click, FX.K]);
  const res = {};
  for (const b of FX.BATHS) { res[b.what] = await area(b); }
  ok(res.trap.a != null && Math.abs(res.trap.a - 48) <= 1, "a shower behind its 4\" partition, a floor trap in it, is part of the bath: 48 Sft (got " + (res.trap.a || 0).toFixed(2) + (res.trap.err ? " — " + res.trap.err : "") + ")");
  ok(res.trap.wet >= 1, "…and the trace says the shower was taken in");
  ok(res.empty.a != null && res.empty.a < 42, "an empty space behind the partition (a cupboard) is left out (got " + (res.empty.a || 0).toFixed(2) + ")");
  ok(res.duct.a != null && res.duct.a < 42, "a space with DUCT written in it is left out (got " + (res.duct.a || 0).toFixed(2) + ")");

  console.log("🧱 Block masonry (p.2)");
  await goto(2);
  const B = FX.BLOCK;
  const r = await T(b => zdTakeoff.blockMasonryAgent({floor: 12, slab: 7.5, beamD: 21, beam: {"4": 0, "8i": 0, "8e": 0}, tags: {[b.tag]: {w: b.doorW, h: 7, at: [b.tagAt]}}, page: true}), B);
  ok(!r.error, "the agent runs" + (r.error ? ": " + r.error : ""));
  const row = n => (r.rows || []).find(x => x.type.includes(n)) || {};
  const near = (v, e, tol) => Math.abs(v - e) <= tol * e;
  ok(r.height_ft === 11.375, "wall height = 12 ft floor to floor less the 7½\" slab = 11.375 ft (" + r.height_ft + ")");
  ok(near(row('8"x8"x16"').run_ft, B.ext, 0.05), "external 8\" walls on 8\"x8\"x16\": " + row('8"x8"x16"').run_ft + " ft (expected " + B.ext.toFixed(2) + ", cut at the column)");
  ok(near(row('8"x8"x12"').run_ft, B.int, 0.08), "the internal 8\" wall on 8\"x8\"x12\": " + row('8"x8"x12"').run_ft + " ft (expected " + B.int.toFixed(2) + ")");
  ok(near(row('4"x8"x12"').run_ft, B.part, 0.08), "the 4\" partition on 4\"x8\"x12\", carried through its door, the parapet left out: " + row('4"x8"x12"').run_ft + " ft (expected " + B.part.toFixed(2) + ")");
  ok(Math.abs(row('4"x8"x12"').ded_cft - B.doorW * 0.33 * 7) < 0.05, "the D2 door deducted from the 4\" wall: 3.5 × 0.33 × 7 = 8.085 cft (" + row('4"x8"x12"').ded_cft + ")");
  ok(row('4"x8"x12"').blocks === Math.round(row('4"x8"x12"').net_cft * 0.9 / (0.33 * 0.67)), "blocks = net cft × 0.9 ÷ 0.33 × 0.67 × 1 (" + row('4"x8"x12"').blocks + ")");
  const sheet = await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === 'Block masonry 4"x8"x12"'), it = Z.P.proj.items.find(i => i.cond === c.id && i.kind === "open");
    return it ? Z.rowsOf(it, Z.P.proj.scales[it.file + ":" + it.page].ptPerFt).map(x => [x.nos, x.L, x.W, x.H, x.qty]) : null; });
  ok(sheet && sheet[0][1] === 3.5 && sheet[0][2] === 0.33 && sheet[0][3] === 7, "the door's sheet row is Nos × width × wall thickness × door height (" + JSON.stringify(sheet) + ")");
  // the dialog: the tags on the page listed with the house sizes prefilled
  if (await page.isVisible("#agBlock")) await page.click("#agBlock"); else await T(() => { zdTakeoff.blockMasonryDialog(); });   // (not awaited: it waits for the dialog)
  await page.waitForSelector('[data-bmw="D2"]', {timeout: 8000}).catch(() => {});
  ok(await page.$('[data-bmw="D2"]') !== null && await page.inputValue('[data-bmw="D2"]') === "3.5", "the Block masonry dialog lists D2 with 3.5 ft prefilled (to check)");
  await page.keyboard.press("Escape"); await wait(200);
  ok(errors.length === 0, "no console or page errors" + (errors.length ? " — " + errors.slice(0, 5).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

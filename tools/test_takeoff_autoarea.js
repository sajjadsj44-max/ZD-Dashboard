#!/usr/bin/env node
/* Auto area regression run for the PDF Takeoff app (takeoff/) on the hand-written rooms of
   tools/takeoff_autoarea_fixture.js — thin, doubled, thick-walled, doored, hatched, leaking, sloped (gable) and shared-wall
   rooms at 1/8" and 1/16" — in headless Chromium at a desktop (1366 × 768) and a phone (390 × 844) size.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_autoarea.js

   TK_LIBS   folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there)
   TK_URL    page to test (default http://127.0.0.1:8765/takeoff/)
   Expected areas come from the drawing's known dimensions; tolerance max(0.5 Sft, 1 %). */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const FX = require("./takeoff_autoarea_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }
const VIEWPORTS = [{width: 1366, height: 768}, {width: 390, height: 844}];

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const errors = [];
  for (const vp of VIEWPORTS) {
    console.log("\nViewport " + vp.width + " × " + vp.height);
    const ctx = await browser.newContext({viewport: vp}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
    await ctx.route(/cdn\.jsdelivr\.net/, r => {
      const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
      if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
      if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
      if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
      if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
      return r.abort();
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(vp.width + ": " + String(e)));
    page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(vp.width + ": console: " + m.text()); });
    page.on("dialog", d => d.dismiss());
    const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
    const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));

    await page.goto(URL, {waitUntil: "load"}); await wait(600);
    await page.click("#bNewProj"); await page.fill("#dlgName", "Auto area " + vp.width); await page.click("#dlgOk"); await wait(400);
    await page.setInputFiles("#fileIn", {name: "autoarea.pdf", mimeType: "application/pdf", buffer: FX.makeAutoAreaPdf()});
    await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
    // the "Floor area" condition, made through + New
    if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); }
    await page.locator("#bNewCond").click({force: true}); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
    const cf = await T(() => (zdTakeoff.P.proj.conds.find(c => c.name === "Floor area") || {}).id);

    for (const pg of FX.CASES) {
      await T(([f, p]) => zdTakeoff.gotoPage(f, p), [await T(() => zdTakeoff.P.proj.files[0].id), pg.page]);
      await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key], pg.page, {timeout: 15000}); await wait(250);
      await T(k => { const S = zdTakeoff.S; zdTakeoff.P.proj.scales[S.key] = {ptPerFt: k, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()}; }, pg.k);
      await T(id => { zdTakeoff.S.cond = id; zdTakeoff.setTool("auto"); }, cf);
      for (const c of pg.cases) {
        // centre the click point, about 30 ft across the stage's smaller side
        const pt = await T(([x, y, k]) => { const S = zdTakeoff.S, st = document.getElementById("stage"), s = Math.min(st.clientWidth, st.clientHeight) / (30 * k);
          S.view = {s, tx: st.clientWidth / 2 - x * s, ty: st.clientHeight / 2 - y * s}; zdTakeoff.applyView();
          const r = st.getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [c.click[0], c.click[1], pg.k]);
        await wait(150);
        const n0 = await T(() => zdTakeoff.P.proj.items.length);
        await page.mouse.move(pt[0], pt[1]); await wait(30); await page.mouse.down(); await page.mouse.up();
        await page.waitForFunction(n => zdTakeoff.P.proj.items.length > n, n0, {timeout: 2500}).catch(() => {});
        await page.waitForFunction(() => !zdTakeoff.S.autoBusy && document.getElementById("busy").style.display !== "block", null, {timeout: 20000}).catch(() => {});
        await wait(100);
        const n1 = await T(() => zdTakeoff.P.proj.items.length), msg = (await page.innerText("#toast").catch(() => "")).replace(/\s+/g, " ");
        const tag = "p." + pg.page + " " + c.name;
        if (c.area == null) { ok(n1 === n0 && /leaks/i.test(msg), tag + ": refused, no area item (" + msg.slice(0, 90) + ")"); continue; }
        if (n1 <= n0) { ok(false, tag + ": expected " + c.area.toFixed(3) + " Sft, got no area — " + msg.slice(0, 120)); continue; }
        const q = await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.slice(-1)[0], k = Z.P.proj.scales[it.file + ":" + it.page]; return Z.rowsOf(it, k.ptPerFt).reduce((a, r) => a + r.qty, 0); });
        const tol = Math.max(0.5, 0.01 * c.area);
        ok(Math.abs(q - c.area) <= tol, tag + ": expected " + c.area.toFixed(3) + " Sft, got " + q.toFixed(3) + " Sft (tolerance " + tol.toFixed(3) + ")");
      }
    }
    await ctx.close();
  }
  ok(errors.length === 0, "no console or page errors" + (errors.length ? " — " + errors.slice(0, 5).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + "/" + (passes + fails) + " passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

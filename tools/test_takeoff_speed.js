#!/usr/bin/env node
/* Browser tests for the takeoff's kept pictures (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_speed.js

   On the apartment plan (tools/takeoff_apartment_fixture.js, 3 pages): back to a page, its sharp picture is shown at once and is
   the same picture; a picture drawn another way (black background) is never taken for it, and back to the white background
   the white one is used again; a zoom in and back out reuses the view; a second project and back is at once; thumbnails and
   whole-page pictures are kept in the browser and used after a reload, without drawing the pages again. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const A = require("./takeoff_apartment_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  /* the view on screen drawn sharp (the picture matches the view, nothing being drawn) */
  const sharp = () => page.waitForFunction(() => { const pn = zdTakeoff.ACT, r = pn.rendered, v = pn.view; return pn.page && r && Math.abs(r.s - v.s) <= 1e-6 * v.s && Math.abs(r.tx - v.tx) < 0.5 && Math.abs(r.ty - v.ty) < 0.5 && !pn.renderTask; }, null, {timeout: 60000, polling: 16});
  const hiHash = () => T(() => { const c = zdTakeoff.ACT.el.hi, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0, ink = 0; for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) | 0; if (d[i] < 128) ink++; } return {h, ink, w: c.width}; });
  /* page p opened: was its sharp picture there the moment gotoPage finished (kept), and how long did it take */
  const goto = (f, p) => T(async ([f, p]) => { const Z = zdTakeoff, pn = Z.ACT, t = performance.now(); await Z.gotoPage(f, p); const r = pn.rendered, v = pn.view;
    return {at_once: !!r && Math.abs(r.s - v.s) <= 1e-6 * v.s && !pn.renderTask, ms: Math.round(performance.now() - t)}; }, [f, p]);

  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Kept pictures"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "apartment.pdf", mimeType: "application/pdf", buffer: A.pdf()});
  await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 30000}); await sharp(); await wait(300);
  const fid = await T(() => zdTakeoff.S.fileId);

  console.log("back to a page");
  const h1 = await hiHash();
  let r = await goto(fid, 2); await sharp(); ok(!r.at_once, "a page not seen before is drawn (" + r.ms + " ms)");
  r = await goto(fid, 1); ok(r.at_once, "back to page 1: its sharp picture is on screen the moment the page opens (" + r.ms + " ms)");
  const h1b = await hiHash(); ok(h1b.h === h1.h && h1b.ink > 1000, "…and it is the same picture as before (" + h1b.ink + " ink pixels)");

  console.log("drawn another way: never the kept picture");
  await T(() => zdTakeoff.setBg("black")); await sharp(); await wait(200);
  const hB = await hiHash(); ok(hB.h !== h1.h, "on a black background the page is drawn again, not shown from the white picture");
  await T(() => zdTakeoff.setBg("white")); await wait(50);
  ok(await T(() => { const pn = zdTakeoff.ACT, r = pn.rendered, v = pn.view; return !!r && Math.abs(r.s - v.s) <= 1e-6 * v.s && !pn.renderTask; }), "back to white: the white picture is used again at once");
  await sharp(); ok((await hiHash()).h === h1.h, "…the same white picture");
  await T(() => zdTakeoff.setBg("auto")); await sharp();

  console.log("zoom in and back out");
  const b = await page.locator("#stage").boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const v0 = await T(() => Object.assign({}, zdTakeoff.ACT.view));
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await wait(40); } await sharp();
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await wait(40); }
  const back = await T(v0 => { const pn = zdTakeoff.ACT, r = pn.rendered, v = pn.view; return {same: Math.abs(v.s - v0.s) <= 1e-6 * v0.s && Math.abs(v.tx - v0.tx) < 0.5, at_once: !!r && Math.abs(r.s - v.s) <= 1e-6 * v.s && Math.abs(r.tx - v.tx) < 0.5 && !pn.renderTask}; }, v0);
  ok(back.same && back.at_once, "zoomed back out to the same view: its sharp picture is shown at once, not drawn again");

  console.log("another project and back");
  await page.click("#bProjects"); await page.waitForFunction(() => document.getElementById("start").classList.contains("on"));
  await page.click("#bNewProj"); await page.fill("#dlgName", "Second"); await page.click("#dlgOk"); await wait(300);
  await page.setInputFiles("#fileIn", {name: "turned.pdf", mimeType: "application/pdf", buffer: A.turnedPdf()}); await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 30000}); await sharp();
  const pid = await T(() => new Promise((ok, bad) => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("projects").objectStore("projects").getAll(); g.onsuccess = () => ok(g.result.find(x => x.name === "Kept pictures").id); g.onerror = bad; }; rq.onerror = bad; }));
  r = await T(async id => { const Z = zdTakeoff, t = performance.now(); await Z.openProject(id); const pn = Z.ACT, x = pn.rendered, v = pn.view; return {at_once: !!x && Math.abs(x.s - v.s) <= 1e-6 * v.s && !pn.renderTask, ms: Math.round(performance.now() - t)}; }, pid);
  ok(r.at_once, "back to the first project: its page's sharp picture is shown at once (" + r.ms + " ms)");
  ok((await hiHash()).h === h1.h, "…the same picture of page 1");

  console.log("kept in the browser across a reload");
  await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 3)); await sharp();
  await page.click("#tPages"); await wait(3000);   // the Pages tab: its thumbnails drawn and kept
  const kept = await T(async () => ({pages: (await (await caches.open("zd-pages-v1")).keys()).length, thumbs: (await (await caches.open("zd-thumbs-v1")).keys()).length}));
  ok(kept.pages >= 3, "the whole-page pictures are kept in the browser (" + kept.pages + ")");
  ok(kept.thumbs >= 1, "the thumbnails are kept in the browser (" + kept.thumbs + ")");
  await page.reload(); await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.S.page && zdTakeoff.ACT.low, null, {timeout: 30000});
  const after = await T(async () => { const S = zdTakeoff.S; await new Promise(r => setTimeout(r, 1500)); return {thumbs: Object.values(S.thumbs || {}).filter(u => /^blob:/.test(u)).length, page: S.pageNo}; });
  ok(after.thumbs >= 1, "after a reload the thumbnails come from the browser, not drawn again (" + after.thumbs + ")");
  r = await goto(await T(() => zdTakeoff.S.fileId), 2);
  ok(await T(() => !!zdTakeoff.ACT.low), "after a reload a page seen before shows its whole-page picture straight from the browser (" + r.ms + " ms)");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

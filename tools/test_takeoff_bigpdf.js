#!/usr/bin/env node
/* Browser tests for a very big PDF in the takeoff (takeoff/): a 1 GB drawing set (tools/takeoff_bigpdf_fixture.js — a vector plan
   and 16 scanned A0 sheets of 64 MB each) is added, opened, drawn and reopened without the page ever holding the whole file.

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_bigpdf.js

   TK_BIG_MB sets the size (default 1024); TK_BIG_PDF keeps the PDF at that path (made once, used again) — else it is made in the
   system's temp folder and deleted at the end. The browser runs on a profile of its own on the disk (as a person's does: a test
   browser's in-memory profile has room for only a few hundred MB), deleted at the end. Every Blob read the page makes
   (Blob.arrayBuffer — pdf.js's range requests, the fingerprint) is counted, so "never read whole" is checked, not assumed.
   A page of the 1 GB set is exported marked up (as a picture: the set is too big for pdf-lib), and the project with its PDF is saved
   in one file and opened in a second browser (its own profile), neither side reading the PDF whole. Last, a browser with no room left to
   keep a copy (its put refused as QuotaExceededError) still opens a big PDF, for that visit, and a revision it cannot keep never
   has the old drawing opened in its place. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const BIG = require("./takeoff_bigpdf_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", MB = +process.env.TK_BIG_MB || 1024;
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const mb = n => (n / 1048576).toFixed(0) + " MB";
const make = (file, n) => { if (fs.existsSync(file) && fs.statSync(file).size >= n * 1048576 * 0.98) return;
  const t = Date.now(), r = BIG.write(file, {mb: n}); console.log("made " + file + ": " + r.pages + " pages, " + mb(r.bytes) + " in " + ((Date.now() - t) / 1000).toFixed(1) + " s"); };

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const file = process.env.TK_BIG_PDF || path.join(os.tmpdir(), "zd-takeoff-big-" + MB + ".pdf"), keep = !!process.env.TK_BIG_PDF, small = path.join(os.tmpdir(), "zd-takeoff-big-64.pdf");
  const revDir = fs.mkdtempSync(path.join(os.tmpdir(), "zdrev_")), rev = path.join(revDir, "zd-takeoff-big-64.pdf");   // (a revision: the same name, another drawing)
  make(file, MB); make(small, 64); make(rev, 64);
  const size = fs.statSync(file).size, pages = 1 + Math.max(1, Math.ceil((MB * 1048576 - 65536) / (BIG.IMG * BIG.IMG)));

  const profs = [], ctxs = [];
  const browserOn = async () => {   // a browser on a profile of its own on the disk (each holds a copy of the 1 GB PDF: deleted at the end)
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "zdbig_")); profs.push(prof);
    const ctx = await pw.chromium.launchPersistentContext(prof, {viewport: {width: 1440, height: 900}}); ctxs.push(ctx); await require("./zd_unlock")(ctx);
    await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
      if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
      if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
      if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: hd});
      if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
      return r.abort(); });
    await ctx.addInitScript(() => { window.__rd = 0; window.__rdMax = 0; const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function(){ window.__rd += this.size; window.__rdMax = Math.max(window.__rdMax, this.size); return ab.call(this); };
      const put = IDBObjectStore.prototype.put;   // (sessionStorage zdNoRoom: this browser has no room left for a big PDF's copy)
      IDBObjectStore.prototype.put = function(v){ if (sessionStorage.getItem("zdNoRoom") && v && v.data instanceof Blob) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return put.apply(this, arguments); }; });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
    return page;
  };
  const errors = [];
  const tidy = async () => { for (const c of ctxs) try { await c.close(); } catch (e) {} for (const d of profs) try { fs.rmSync(d, {recursive: true, force: true}); } catch (e) {}
    if (!keep) try { fs.unlinkSync(file); } catch (e) {} try { fs.unlinkSync(small); } catch (e) {} try { fs.rmSync(revDir, {recursive: true, force: true}); } catch (e) {} };
  try {
    let page = await browserOn();
    const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);   // (page: the browser in use)
    const sharp = ms => page.waitForFunction(() => { const pn = zdTakeoff.ACT, r = pn.rendered, v = pn.view; return pn.page && r && Math.abs(r.s - v.s) <= 1e-6 * v.s && Math.abs(r.tx - v.tx) < 0.5 && Math.abs(r.ty - v.ty) < 0.5 && !pn.renderTask; }, null, {timeout: ms || 120000, polling: 50});
    const reads = () => T(() => { const r = {all: window.__rd, max: window.__rdMax}; window.__rd = 0; window.__rdMax = 0; return r; });
    const shown = name => page.waitForFunction(n => { const Z = zdTakeoff, f = Z.P.proj && Z.P.proj.name === n && Z.P.proj.files[0]; return f && Z.S.fileId === f.id && Z.S.page; }, name, {timeout: 600000, polling: 100});
    const toastHas = re => page.waitForFunction(s => new RegExp(s).test(document.getElementById("toast").textContent), re.source, {timeout: 600000, polling: 100});
    const stored = id0 => T(id0 => new Promise(ok => { const id = id0 || zdTakeoff.P.proj.files[0].id, rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("pdfs").objectStore("pdfs").get(id); g.onsuccess = () => ok(!!g.result); g.onerror = () => ok(false); }; rq.onerror = () => ok(false); }), id0);
    /* the sharp picture on screen: how many pixels are dark (a scan's frame, the plan's walls) */
    const dark = () => T(() => { const c = zdTakeoff.ACT.el.hi, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90) n++; return n; });
    const newProject = async name => { if (!(await T(() => document.getElementById("start").classList.contains("on")))) { await page.click("#bProjects"); await page.waitForFunction(() => document.getElementById("start").classList.contains("on")); }
      await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400); };

    await page.goto(URL); await wait(600);
    await newProject("Big set");

    console.log("adding a " + mb(size) + " PDF (" + pages + " pages)");
    await reads(); let t = Date.now();
    await page.setInputFiles("#fileIn", file);
    await shown("Big set"); await sharp();
    const tAdd = (Date.now() - t) / 1000, r1 = await reads();
    ok(tAdd < 180, "added and its first page drawn in " + tAdd.toFixed(1) + " s");
    const files = await T(() => zdTakeoff.P.proj.files.map(f => ({pages: f.pages, size: f.size, sha: f.sha})));
    ok(files.length === 1 && files[0].pages === pages, "all " + pages + " pages are there (" + (files[0] || {}).pages + ")");
    ok(files[0] && /^[0-9a-f]{64}$/.test(files[0].sha || ""), "it has its SHA-256 fingerprint");
    ok(r1.all < 1.25 * size, "the file was read once for its fingerprint, not copied again and again (" + mb(r1.all) + " read for a " + mb(size) + " file)");
    ok(r1.max < 100 * 1048576, "…a piece at a time, never the whole file at once (largest read " + mb(r1.max) + ")");
    ok(await stored(), "a copy is kept in this browser");
    ok(await dark() > 2000, "page 1 (the plan) is drawn");
    await wait(3000); await reads();   // (the markups / viewports readers, done)

    console.log("a scanned sheet");
    t = Date.now(); await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 6)); await sharp(); const tPg = (Date.now() - t) / 1000, r2 = await reads();
    ok(tPg < 30, "page 6 (a 64 MB scan) drawn in " + tPg.toFixed(1) + " s");
    ok(r2.all < 200 * 1048576, "only that page was read from the file (" + mb(r2.all) + " of " + mb(size) + ")");
    ok(r2.max < 100 * 1048576, "…in pieces, never the whole file at once (largest piece " + mb(r2.max) + ")");
    ok(await dark() > 5000, "the scan is on screen (its dark frame)");
    await T(n => zdTakeoff.gotoPage(zdTakeoff.S.fileId, n), pages); await sharp(); const r3 = await reads();
    ok(r3.all < 200 * 1048576, "the last page too, without reading what lies before it (" + mb(r3.all) + ")");

    console.log("a page exported marked up");
    await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 1)); await sharp(); await reads();
    const [dl] = await Promise.all([page.waitForEvent("download", {timeout: 300000}), T(() => { zdTakeoff.exportPdf(false); })]);
    const ob = fs.readFileSync(await dl.path()), r5 = await reads();
    ok(/^%PDF-/.test(ob.toString("latin1", 0, 8)) && ob.length < 60 * 1048576, "page 1 exported as a marked-up PDF (" + mb(ob.length) + ", " + dl.suggestedFilename() + ")");
    ok(r5.all < 300 * 1048576, "…without the 1 GB file read whole into pdf-lib (" + mb(r5.all) + " read)");

    console.log("reopened after a reload");
    t = Date.now(); await page.reload(); await shown("Big set"); await sharp();
    const tRe = (Date.now() - t) / 1000, r4 = await T(() => ({all: window.__rd, max: window.__rdMax}));
    ok(tRe < 60, "the project opened again with its page drawn in " + tRe.toFixed(1) + " s");
    ok(r4.all < 200 * 1048576, "…read from the browser's copy a piece at a time, not whole (" + mb(r4.all) + ")");
    await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 3)); await sharp();
    ok(await dark() > 5000, "a scan page draws from the browser's copy");

    console.log("the same file added again");
    await page.setInputFiles("#fileIn", file); await toastHas(/same drawing/);
    ok(await T(() => zdTakeoff.P.proj.files.length) === 1, "it is known by its fingerprint: re-attached, not added twice");
    await sharp(); ok(await dark() > 2000, "…and drawn");

    console.log("the project with its PDF in one file, opened on another computer");
    const sha0 = await T(() => zdTakeoff.P.proj.files[0].sha); await reads();
    const [db] = await Promise.all([page.waitForEvent("download", {timeout: 600000}), T(() => { zdTakeoff.exportBundle(); })]);
    const bpath = await db.path(), bsize = fs.statSync(bpath).size, r6 = await reads();
    ok(bsize > size && bsize < size + 50 * 1048576, "saved in one file with its 1 GB PDF (" + mb(bsize) + ", " + db.suggestedFilename() + ")");
    ok(r6.max < 100 * 1048576, "…the PDF going in as the browser keeps it, never read whole into the page (largest read " + mb(r6.max) + ")");
    const page1 = page; page = await browserOn();
    await page.goto(URL); await wait(600); await reads(); t = Date.now();
    await page.setInputFiles("#impIn", bpath);
    await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.S.lastImport && zdTakeoff.P.proj && zdTakeoff.P.proj.name === "Big set", null, {timeout: 600000, polling: 200}); await sharp();
    const tIm = (Date.now() - t) / 1000, r7 = await reads(), imp = await T(() => ({lvl: zdTakeoff.S.lastImport.lvl, bad: zdTakeoff.S.lastImport.rows.filter(r => r.st !== "PASS").map(r => r.what + ": " + r.note), sha: zdTakeoff.P.proj.files[0].sha}));
    await page.keyboard.press("Escape");
    ok(imp.lvl === "PASS", "opened in the second browser: its import check passes (" + tIm.toFixed(1) + " s)" + (imp.bad.length ? " — " + imp.bad.join("; ") : ""));
    ok(imp.sha === sha0 && await stored(), "…the same drawing (its fingerprint), kept in that browser");
    ok(r7.max < 100 * 1048576, "…the 1 GB file read a piece at a time, never whole (largest read " + mb(r7.max) + ", " + mb(r7.all) + " in all)");
    ok(await dark() > 2000, "…and its plan drawn");
    await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 6)); await sharp(); ok(await dark() > 5000, "…and a scan page");
    await ctxs[1].close(); page = page1;

    console.log("no room left in this browser for a copy");
    await T(() => sessionStorage.setItem("zdNoRoom", "1"));
    await newProject("No room");
    await page.setInputFiles("#fileIn", small); await shown("No room"); await sharp();
    await toastHas(/open for this visit only/);
    ok(true, "a 64 MB PDF the browser has no room to keep still opens, and says it is for this visit only");
    ok(!(await stored()), "…no copy was kept");
    ok(await dark() > 2000, "…its page is drawn (read from the file itself)");
    await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 2)); await sharp(); ok(await dark() > 5000, "…and its scan page too");
    await page.reload(); await toastHas(/PDF missing/);
    ok(true, "reopened later, it asks for the PDF to be added again");
    await T(() => sessionStorage.removeItem("zdNoRoom"));
    await page.setInputFiles("#fileIn", small); await toastHas(/same drawing/); await shown("No room"); await sharp();
    ok(await stored() && await T(() => zdTakeoff.P.proj.files.length) === 1, "added again with room: re-attached by its fingerprint, and kept this time");

    console.log("a revision, with no room left");
    await T(() => sessionStorage.setItem("zdNoRoom", "1"));
    const id0 = await T(() => zdTakeoff.P.proj.files[0].id);
    await page.setInputFiles("#fileIn", rev); await page.waitForSelector('#dlgF [data-ch="0"]', {timeout: 120000}); await page.click('#dlgF [data-ch="0"]');   // Replace — it is a revision
    await toastHas(/open for this visit only/);
    const id1 = await T(() => zdTakeoff.P.proj.files.length === 1 && zdTakeoff.P.proj.files[0].id);
    ok(id1 && id1 !== id0, "a revision the browser has no room to keep: the project moves to a new id for it");
    ok(await stored(id0) && !(await stored(id1)), "…the drawing it replaced is still kept as it was, never opened in place of the revision");
    await sharp(); ok(await dark() > 2000, "…and the revision is on screen for this visit");
    await page.reload(); await toastHas(/PDF missing/);
    ok(true, "…reopened later, the revision is asked for again (not the old drawing shown)");
    await T(() => sessionStorage.removeItem("zdNoRoom"));

    ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  } catch (e) { console.log(e); fails++; }
  await tidy();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

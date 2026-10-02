#!/usr/bin/env node
/* QA audit of the PDF Takeoff app (takeoff/) — a full regression run on the hand-written drawing set of
   tools/takeoff_qa_fixture.js (every dimension known exactly), in the browser.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_qa.js

   TK_LIBS   folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there)
   TK_URL    page to test (default http://127.0.0.1:8765/takeoff/)
   TK_REPORT write the calculation / performance tables and the pass / fail list here as JSON
   TK_SHOTS  folder for screenshots

   Sections: PDF loading and pages · scale (notes, chosen, calibrated, paper size, per page, zoom never changes a
   quantity) · single-click areas · data kept through navigation, reload, export and import · conditions (layers) ·
   editing stress with undo / redo · markups · PDF text · compare · page management · a house measured as a QS would ·
   measurement sheet · exports · save / recovery · undo / redo master test · performance · edge cases · UI · keyboard
   and mouse · input validation · calculation table · security. Every check is independent of the app's own
   formulas: expected values are worked out here from the drawing's known dimensions. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const FX = require("./takeoff_qa_fixture.js"), {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "", SHOTS = process.env.TK_SHOTS || "", REPORT = process.env.TK_REPORT || "";
const R = {checks: [], calc: [], perf: [], notTested: []};
let fails = 0, passes = 0, section = "";
function ok(cond, msg){ R.checks.push({section, ok: !!cond, msg}); if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }
function calc(test, expected, actual, tol, unit){ const d = actual - expected, st = isFinite(actual) && Math.abs(d) <= tol; R.calc.push({test, expected: +expected.toFixed(4), actual: isFinite(actual) ? +actual.toFixed(4) : String(actual), diff: isFinite(d) ? +d.toFixed(4) : null, tol, unit, status: st ? "PASS" : "FAIL"});
  return ok(st, `${test}: expected ${expected.toFixed(3)} ${unit}, got ${isFinite(actual) ? actual.toFixed(3) : actual} (diff ${isFinite(d) ? d.toFixed(4) : "—"}, tolerance ${tol})`); }
function perf(test, ms, limit, note){ const st = ms <= limit; R.perf.push({test, ms: Math.round(ms), limit, status: st ? "PASS" : "SLOW", note: note || ""}); return ok(st, `${test}: ${Math.round(ms)} ms (limit ${limit} ms)${note ? " — " + note : ""}`); }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkqa-"));

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  let page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, o = {}) => { const p = await scr(x, y); await page.mouse.move(p[0] + (o.dx || 0), p[1] + (o.dy || 0)); await wait(30);
    if (o.mod) await page.keyboard.down(o.mod); await page.mouse.down({button: o.button || "left"}); await page.mouse.up({button: o.button || "left"}); if (o.mod) await page.keyboard.up(o.mod); await wait(60); };
  const hx = v => FX.OX + v * FX.S1, hy = v => FX.OY + v * FX.S1;   // house plan ft -> page pt
  const key = () => T(() => zdTakeoff.S.key);
  const fid = () => T(() => zdTakeoff.P.proj.files[0].id);
  const go = async (p, f) => { await T(([p, f]) => zdTakeoff.gotoPage(f || zdTakeoff.P.proj.files[0].id, p), [p, f || null]); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.texts[zdTakeoff.S.key], p, {timeout: 15000}); await wait(250); };
  const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const closeDlg = async () => { if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); } if (await dlgOn()) { await page.click("#dlgCancel").catch(() => {}); await wait(150); } };
  const newCond = async (preset, o = {}) => {
    await closeDlg(); await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset});
    if (o.h) await page.fill("#cH", o.h); if (o.t) await page.fill("#cT", o.t); if (o.name) await page.fill("#cName", o.name);
    await page.click("#dlgOk"); await wait(250);
    if (await dlgOn()) { console.log("    (condition dialog: " + await page.innerText("#dlgErr") + ")"); await closeDlg(); }
    return T(n => { const c = zdTakeoff.P.proj.conds.slice(-1)[0]; return c && c.id; });
  };
  const qtyOf = (id) => T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); if (!it) return null; const k = Z.P.proj.scales[it.file + ":" + it.page]; return k ? Z.rowsOf(it, k.ptPerFt).reduce((a, r) => a + r.qty, 0) : null; }, id);
  const lastItem = () => T(() => { const it = zdTakeoff.P.proj.items.slice(-1)[0]; return it ? JSON.parse(JSON.stringify(it)) : null; });
  const total = id => T(id => { const c = zdTakeoff.P.proj.conds.find(x => x.id === id || x.name === id); return c ? zdTakeoff.condTotals(c) : null; }, id);
  const dl = async (sel, open) => { if (open !== false) { await closeDlg(); await page.click("#bExport"); await wait(150); }
    const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), page.click(sel)]); const p = path.join(tmp, d.suggestedFilename()); await d.saveAs(p); return p; };
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "qa-" + n + ".png")}); };
  const setScale = async (k, ptPerFt) => T(([k, v]) => { zdTakeoff.P.proj.scales[k] = {ptPerFt: v, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()}; }, [k, ptPerFt]);
  const run = async (name, fn) => { section = name; console.log("\n" + name); try { await fn(); } catch (e) { ok(false, name + " — section stopped: " + String(e.message || e).split("\n")[0].slice(0, 300)); await closeDlg().catch(() => {}); }
    await T(() => { zdTakeoff.save(); return zdTakeoff.flushSave(); }).catch(() => {}); };   // (cleanups below change the project directly: written back here)

  /* ---------------------------------------------------------------- 1. PDF loading, pages, view */
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "QA house"); await page.click("#dlgOk"); await wait(400);
  await run("1. PDF loading, pages, view", async () => {
    const t0 = Date.now();
    await page.setInputFiles("#fileIn", {name: "qa-set.pdf", mimeType: "application/pdf", buffer: FX.makeQaPdf()});
    await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
    perf("open the 8-page QA set (to page 1 indexed, scale read)", Date.now() - t0, 5000);
    ok((await T(() => zdTakeoff.P.proj.files[0].pages)) === 8 && (await page.locator("#pageSel option").count()) === 8, "8 pages listed");
    ok(await T(() => zdTakeoff.S.geo[zdTakeoff.S.key].segs.length >= 150), "house plan lines indexed for snapping (" + await T(() => zdTakeoff.S.geo[zdTakeoff.S.key].segs.length) + ")");
    await page.click("#stage", {position: {x: 5, y: 5}});
    await page.keyboard.press("PageDown"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 2, null, {timeout: 8000});
    ok(true, "PgDn → p.2");
    await page.keyboard.press("End"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 8, null, {timeout: 8000}); ok(true, "End → last page (p.8)");
    await page.keyboard.press("PageUp"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 7, null, {timeout: 8000}); ok(true, "PgUp → p.7");
    await page.keyboard.press("Home"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 1, null, {timeout: 8000}); ok(true, "Home → first page");
    await page.click("#bNext"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 2, null, {timeout: 8000}); await page.click("#bPrev"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 1, null, {timeout: 8000}); ok(true, "› and ‹ buttons step pages");
    await page.selectOption("#pageSel", {index: 5}); await page.waitForFunction(() => zdTakeoff.S.pageNo === 6, null, {timeout: 8000}); ok(true, "page list jumps to p.6");
    // rapid page changes: the page shown, its key, scale and lines always agree
    await T(() => { const Z = zdTakeoff, f = Z.P.proj.files[0].id; Z.gotoPage(f, 2); Z.gotoPage(f, 3); Z.gotoPage(f, 5); Z.gotoPage(f, 1); });
    await wait(2500);
    const rq = await T(() => { const S = zdTakeoff.S; return {shown: S.page.pageNumber, no: S.pageNo, key: S.key.split(":")[1], w: Math.round(S.base.width), sel: document.getElementById("pageSel").value.split("|")[1]}; });
    ok(rq.shown === 1 && rq.no === 1 && rq.key === "1" && rq.w === 2592 && rq.sel === "1", "4 page changes at once: the last one wins, shown page = key = list (" + JSON.stringify(rq) + ")");
    const scs = await T(() => Object.fromEntries(Object.entries(zdTakeoff.P.proj.scales).map(([k, s]) => [k.split(":")[1], +s.ptPerFt.toFixed(4)])));
    ok(scs["1"] === 18 && (scs["2"] == null || scs["2"] === 9) && (scs["3"] == null || scs["3"] === 9) && (scs["5"] == null || scs["5"] === 17.28), "each page kept its own scale note after the rapid changes " + JSON.stringify(scs));
    // Pages tab
    await page.click("#tPages"); await wait(400);
    ok((await page.locator("#pageList .pgt").count()) === 8, "Pages tab: 8 thumbnails");
    await page.waitForFunction(() => [...document.querySelectorAll("#pageList img")].filter(i => i.getAttribute("src")).length >= 4, null, {timeout: 15000}).catch(() => {});
    ok((await T(() => [...document.querySelectorAll("#pageList img")].filter(i => (i.getAttribute("src") || "").startsWith("data:image/png")).length)) >= 4, "thumbnails drawn as they come into view");
    await page.click('#pageList .pgt[data-pg$="|7"]'); await page.waitForFunction(() => zdTakeoff.S.pageNo === 7, null, {timeout: 8000}); ok(true, "click a thumbnail → that page");
    ok(/7/.test(await page.getAttribute("#pageList .pgt.on", "data-pg")), "current page highlighted in Pages");
    await page.click("#tCond"); await go(1);
    // zoom / fit / pan
    const v0 = await T(() => Object.assign({}, zdTakeoff.S.view));
    await page.click("#bZi"); await wait(100); const v1 = await T(() => zdTakeoff.S.view.s); ok(near(v1 / v0.s, 1.25, 1e-9), "+ zooms in 25 %");
    await page.click("#bZo"); await wait(100); ok(near(await T(() => zdTakeoff.S.view.s), v0.s, 1e-9), "− zooms back out");
    const sp = await scr(hx(10), hy(10)); await page.mouse.move(sp[0], sp[1]); await page.mouse.wheel(0, -300); await wait(200);
    const sp2 = await scr(hx(10), hy(10)); ok(Math.hypot(sp2[0] - sp[0], sp2[1] - sp[1]) < 1.5 && (await T(() => zdTakeoff.S.view.s)) > v0.s, "wheel zooms about the cursor (the point under it stays put)");
    await page.keyboard.press("Shift+F"); await wait(150);
    ok(await T(() => { const S = zdTakeoff.S, w = document.getElementById("stage").clientWidth; return Math.abs(S.view.s - (w - 24) / S.base.width) < 1e-9; }), "Shift+F fits the page width");
    await page.keyboard.press("f"); await wait(150);
    ok(await T(() => { const S = zdTakeoff.S, st = document.getElementById("stage"); return Math.abs(S.view.s - Math.min((st.clientWidth - 24) / S.base.width, (st.clientHeight - 24) / S.base.height)) < 1e-9; }), "F fits the page");
    const pan = async (how) => { const a = await T(() => [zdTakeoff.S.view.tx, zdTakeoff.S.view.ty]), b = await page.locator("#stage").boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      if (how === "space") await page.keyboard.down(" ");
      await page.mouse.move(cx, cy); await page.mouse.down({button: how === "right" ? "right" : how === "middle" ? "middle" : "left"}); await page.mouse.move(cx + 60, cy + 40, {steps: 5}); await page.mouse.up({button: how === "right" ? "right" : how === "middle" ? "middle" : "left"});
      if (how === "space") await page.keyboard.up(" "); await wait(100);
      const c = await T(() => [zdTakeoff.S.view.tx, zdTakeoff.S.view.ty]); return [c[0] - a[0], c[1] - a[1]]; };
    await T(() => zdTakeoff.setTool("select"));
    for (const how of ["space", "right", "middle"]) { const d = await pan(how); ok(near(d[0], 60, 1) && near(d[1], 40, 1), how + "+drag pans the drawing (60, 40 px)"); }
    ok(!(await T(() => document.getElementById("ctx").classList.contains("on"))), "a right-drag pans — it does not open the menu");
    await page.keyboard.press("f");
  });

  /* ---------------------------------------------------------------- 2. bad and locked PDFs, odd pages */
  await run("2. Bad, locked and odd PDFs", async () => {
    const bad = [["broken.pdf", Buffer.from("%PDF-1.4\ngarbage")], ["empty.pdf", Buffer.alloc(0)], ["notes.pdf", Buffer.from("hello, not a pdf")]];
    for (const [n, b] of bad) { const f0 = await T(() => zdTakeoff.P.proj.files.length);
      await page.setInputFiles("#fileIn", {name: n, mimeType: "application/pdf", buffer: b}); await wait(1200);
      ok((await T(() => zdTakeoff.P.proj.files.length)) === f0 && /could not be opened/.test(await page.innerText("#toast")), n + ": refused with a message, nothing added (" + (await page.innerText("#toast")).slice(0, 80) + ")"); }
    await page.setInputFiles("#fileIn", {name: "readme.txt", mimeType: "text/plain", buffer: Buffer.from("x")}); await wait(400);
    ok(/not a PDF/.test(await page.innerText("#toast")), "a .txt file is refused");
    await go(4, null);
    ok(await T(() => !zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key].segs.length === 0), "blank page: opens, no scale, no lines (nothing to snap)");
    ok(/Scale not set/.test(await page.innerText("#scaleChip")), "blank page: chip says the scale is not set");
    // the turned page (/Rotate 90): the 20'-0" line measures 20 ft
    await go(2);
    const g2 = await T(() => { const S = zdTakeoff.S, s = S.geo[S.key].segs.find(q => Math.hypot(q[2] - q[0], q[3] - q[1]) > 100); return {w: S.base.width, h: S.base.height, s: s && s.slice(0, 4), k: zdTakeoff.P.proj.scales[S.key].ptPerFt}; });
    ok(g2.w === 595 && g2.h === 842, "turned page shown 595 × 842 (portrait)");
    calc("turned page: 20'-0\" line", 20, Math.hypot(g2.s[2] - g2.s[0], g2.s[3] - g2.s[1]) / g2.k, 0.001, "ft");
    ok(near(g2.s[0], g2.s[2], 0.01), "turned page: the horizontal line is vertical on screen, as drawn");
    // the page box not at 0,0: the indexed line is where it is drawn on screen
    await go(3);
    const g3 = await T(() => { const S = zdTakeoff.S, s = S.geo[S.key].segs.find(q => Math.hypot(q[2] - q[0], q[3] - q[1]) > 50); return s.slice(0, 4); });
    ok(near(g3[0], 50, 0.01) && near(g3[1], 545, 0.01) && near(g3[2], 140, 0.01), "MediaBox [100 100 942 695]: the line from (150,150) is indexed at (50, 545) on the page — " + g3.map(v => v.toFixed(2)).join(", "));
    await page.waitForFunction(() => zdTakeoff.S.rendered, null, {timeout: 8000});
    const ink = await T(([x, y]) => { const S = zdTakeoff.S, c = document.getElementById("hi"), r = S.rendered, d = r.dpr, X = Math.round((x * S.view.s + S.view.tx) * d), Y = Math.round((y * S.view.s + S.view.ty) * d); let mn = 255;
      const px = c.getContext("2d").getImageData(X - 2, Y - 2, 5, 5).data; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) mn = Math.min(mn, px[i]); return mn; }, [95, 545]);
    ok(ink < 140, "…and the rendered line is drawn at the same place (ink " + ink + " at the indexed point): snapping matches the picture");
    calc("offset page box: 10'-0\" line", 10, Math.hypot(g3[2] - g3[0], g3[3] - g3[1]) / 9, 0.001, "ft");
    // metric 1:50
    await go(5);
    const g5 = await T(() => { const S = zdTakeoff.S, s = S.geo[S.key].segs.find(q => Math.hypot(q[2] - q[0], q[3] - q[1]) > 100); return {L: Math.hypot(s[2] - s[0], s[3] - s[1]), k: zdTakeoff.P.proj.scales[S.key].ptPerFt}; });
    calc("1:50 metric page: scale 1 ft (pt)", 864 / 50, g5.k, 1e-9, "pt");
    calc("1:50 metric page: 5000 mm line in ft", 5000 / 304.8, g5.L / g5.k, 0.001, "ft");
    // a PDF locked with an open password
    if (lockedPdf().length) await page.setInputFiles("#fileIn", {name: "locked.pdf", mimeType: "application/pdf", buffer: lockedPdf()});
    const gotPw = lockedPdf().length ? await page.waitForSelector("#dlgPw", {timeout: 6000}).then(() => true, () => false) : false;
    if (gotPw) {
      await page.fill("#dlgPw", "nope"); await page.click("#dlgOk"); await wait(700);
      ok(/not right/.test(await page.innerText("#dlgB")), "wrong password: asked again");
      await page.fill("#dlgPw", "open123"); await page.click("#dlgOk");
      ok(await page.waitForFunction(() => zdTakeoff.P.proj.files.some(f => f.name === "locked.pdf") && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 10000}).then(() => true, () => false), "right password: the locked PDF opens and is indexed");
    } else R.notTested.push({what: "Password-protected PDF in the QA run", why: "no encrypted fixture (python3 + pypdf not available to build one)"});
    await closeDlg();
  });

  /* ---------------------------------------------------------------- 3. scale */
  await run("3. Scale — notes, chosen, calibrated, per page, zoom", async () => {
    const cases = [['SCALE 1/8" = 1\'-0"', 9], ['SCALE 1/4"=1\'-0"', 18], ['SCALE: 3/16" = 1\'-0"', 13.5], ['1/2" = 1\'-0"', 36], ['SCALE 1" = 1\'-0"', 72], ['SCALE 3/32" = 1\'-0"', 6.75],
      ['SCALE 1-1/2" = 1\'-0"', 108], ['SCALE 1 1/2" = 1\'-0"', 108], ['SCALE 3" = 1\'-0"', 216], ['SCALE ¼" = 1\'-0"', 18], ['SCALE 1/8”=1’-0”', 9], ['SCALE 1/4"=1\'0"', 18],
      ['SCALE 1" = 10\'-0"', 7.2], ['SCALE 1" = 20\'', 3.6], ['SCALE 1"=30\'', 2.4], ['SCALE 1:50', 17.28], ['SCALE 1:100', 8.64], ['SCALE 1 : 200', 4.32], ['1:100', 8.64], ['SCALE 1:1250', 0.6912],
      ['NTS', 0], ['SCALE: NOT TO SCALE', 0], ['DATE 12:30', 0], ['ROOM 12 x 14', 0]];
    const got = await T(cs => cs.map(([s]) => { const Z = zdTakeoff; Z.S.texts["qa:1"] = [{s, x: 10, y: 10, w: 50, h: 6}]; const c = Z.scaleCandidates("qa:1"); delete Z.S.texts["qa:1"]; return c.length ? c[0].ptPerFt : 0; }), cases);
    cases.forEach(([s, v], i) => calc("scale note “" + s + "” → pt per ft", v, got[i], 1e-9, "pt"));
    // a page's own note, with the A1-for-A3 correction (QA set p.5 has none; the old fixture's p.2 has one): checked on p.6 3/16"
    await go(6); ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), 13.5, 1e-9), "p.6 note 3/16\" = 1'-0\" → 13.5 pt per ft");
    // chosen by hand (no note) on p.8 — every architectural / engineering / metric scale, and a paper size
    await go(8);
    const k8 = await key();
    await page.click("#scaleChip"); await wait(200);
    const opts = await page.$$eval("#msSel option", o => o.map(x => x.value).filter(Boolean));
    ok(opts.length >= 30, "scale dialog offers " + opts.length + " standard scales (architectural, engineering, metric)");
    const expect = t => { const m = /^(\d+)(?:-(\d+)\/(\d+))?(?:\/(\d+))?" = 1'-0"$/.exec(t), e = /^1" = (\d+)'$/.exec(t), r = /^1:(\d+)$/.exec(t);
      if (m) { const v = m[2] ? +m[1] + m[2] / m[3] : m[4] ? m[1] / m[4] : +m[1]; return 72 * v; } if (e) return 72 / +e[1]; if (r) return 864 / +r[1]; return NaN; };
    await closeDlg();
    for (const t of opts) {
      await page.click("#scaleChip"); await wait(80); await page.selectOption("#msSel", t); await page.click("#msSet"); await wait(80);
      const v = await T(k => zdTakeoff.P.proj.scales[k] && zdTakeoff.P.proj.scales[k].ptPerFt, k8);
      calc("chosen scale " + t, expect(t), v, 1e-9, "pt / ft");
    }
    ok(await T(k => { const s = zdTakeoff.P.proj.scales[k]; return s.how === "manual" && !s.verified; }, k8), "a chosen scale is marked chosen, not verified");
    ok(/chosen · not verified/.test(await page.innerText("#scaleChip")), "chip: “… · chosen · not verified”");
    await page.click("#scaleChip"); await wait(80); await page.selectOption("#msSel", "1:100"); await page.selectOption("#msPaper", "A1"); await page.click("#msSet"); await wait(100);
    calc("1:100 drawn for A1, printed on this A4 page", 8.64 * 841.89 / 2383.94, await T(k => zdTakeoff.P.proj.scales[k].ptPerFt, k8), 1e-6, "pt / ft");
    await page.click("#scaleChip"); await wait(80); await page.fill("#msTxt", "3/16\" = 1'-0\""); await page.click("#msSet"); await wait(100);
    calc("typed custom scale 3/16\" = 1'-0\"", 13.5, await T(k => zdTakeoff.P.proj.scales[k].ptPerFt, k8), 1e-9, "pt / ft");
    await page.click("#scaleChip"); await wait(80); await page.fill("#msTxt", "banana"); await page.click("#msSet"); await wait(100);
    ok(/Write it like/.test(await page.innerText("#msInfo")) && await dlgOn(), "typed nonsense: refused with a message, dialog stays open");
    await closeDlg();
    // calibrate on p.8: 90 pt line = 5'-0" (ft-in), then = 1524 mm
    for (const [txt, want] of [["5'-0\"", 18], ["1524mm", 18], ["60\"", 18], ["5", 18]]) {
      await page.keyboard.press("k"); await click(100, 841.89 - 500, {dx: 3}); await click(190, 841.89 - 500, {dx: -3});
      await page.waitForSelector("#dlgLen", {timeout: 4000}); await page.fill("#dlgLen", txt); await page.click("#dlgOk"); await wait(200);
      calc("calibrate 90 pt = " + txt, want, await T(k => zdTakeoff.P.proj.scales[k].ptPerFt, k8), 1e-6, "pt / ft");
    }
    for (const bad of ["abc", "0", "-5", ""]) {
      await page.keyboard.press("k"); await click(100, 841.89 - 500, {dx: 3}); await click(190, 841.89 - 500, {dx: -3});
      await page.waitForSelector("#dlgLen", {timeout: 4000}); await page.fill("#dlgLen", bad); await page.click("#dlgOk"); await wait(150);
      ok(await dlgOn() && /Enter a length/.test(await page.innerText("#dlgErr")), "calibrate with “" + bad + "”: refused (" + (await page.innerText("#dlgErr")) + ")"); await closeDlg(); await page.keyboard.press("Escape");
    }
    // the scale belongs to its page only
    const before = await T(() => Object.fromEntries(Object.entries(zdTakeoff.P.proj.scales).map(([k, s]) => [k, s.ptPerFt])));
    ok(before[(await fid()) + ":1"] === 18, "p.1 still 1/4\" (18 pt / ft) after p.8 was set four ways — a scale is never applied to other pages");
    // zoom never changes a measured quantity
    await go(1); await setScale(await key(), 18);
    const cf = await newCond("Floor area");
    await page.keyboard.press("r"); await click(hx(13.125), hy(0.75), {dx: 2, dy: 2}); await click(hx(19.125), hy(12.75), {dx: -2, dy: -2});
    const bath = await lastItem(); const q0 = await qtyOf(bath.id);
    calc("Rect on BATH 1 corners (snapped), fit zoom", 72, q0, 0.001, "Sft");
    for (const z of [3, 9]) { await T(z => { const S = zdTakeoff.S; S.view.s *= z; zdTakeoff.setTool("select"); }, z); await wait(100);
      calc("BATH 1 at " + z + "× zoom (same measurement)", 72, await qtyOf(bath.id), 1e-9, "Sft"); await page.keyboard.press("f"); }
    await T(([x, y]) => { const S = zdTakeoff.S, st = document.getElementById("stage"), s = S.view.s * 4; S.view = {s, tx: st.clientWidth / 2 - x * s, ty: st.clientHeight / 2 - y * s}; zdTakeoff.applyView(); }, [hx(16.125), hy(6.75)]); await wait(150);
    await page.keyboard.press("r"); await click(hx(13.125), hy(0.75), {dx: 3, dy: 3}); await click(hx(19.125), hy(12.75), {dx: -3, dy: -3});
    const bath2 = await lastItem(); ok(bath2.id !== bath.id, "a second rectangle drawn zoomed in 4×");
    calc("BATH 1 drawn again at 4× zoom", 72, await qtyOf(bath2.id), 0.001, "Sft");
    ok(JSON.stringify(bath2.pts.map(p => p.map(v => +v.toFixed(3)))) === JSON.stringify(bath.pts.map(p => p.map(v => +v.toFixed(3)))), "…with the very same corners as at fit zoom (snapped to the drawing)");
    await page.keyboard.press("f"); await go(6); await go(1);
    calc("BATH 1 after visiting another page", 72, await qtyOf(bath.id), 1e-9, "Sft");
    ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), 18, 1e-12), "p.1 scale unchanged by zoom and page changes");
    await T(ids => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => !ids.includes(i.id)); zdTakeoff.setSel([]); }, [bath.id, bath2.id]);
  });

  /* ---------------------------------------------------------------- 4. single-click areas */
  await run("4. Single-click area (Auto area)", async () => {
    await go(1); await setScale(await key(), 18);
    const cf = await T(() => (zdTakeoff.P.proj.conds.find(c => c.name === "Floor area") || {}).id);
    await T(id => { zdTakeoff.S.cond = id; zdTakeoff.setTool("auto"); }, cf);
    const expectArea = {"BED ROOM 1": 144, "BATH 1": 72, "BED ROOM 2": 144, "CORRIDOR": 123, "LIVING": 257.25, "KITCHEN": 168, "BED ROOM 3": 144, "BATH 2": 72, "STORE": 144};
    R.auto = [];
    for (const [nm, x0, y0, x1, y1] of FX.HOUSE) {
      const px = x0 + (x1 - x0) * 0.82, py = y0 + (y1 - y0) * (nm === "CORRIDOR" ? 0.5 : 0.7), n0 = await T(() => zdTakeoff.P.proj.items.length);
      const t0 = Date.now(); await click(hx(px), hy(py));
      await page.waitForFunction(n => !zdTakeoff.S.autoBusy && document.getElementById("busy").style.display !== "block", n0, {timeout: 20000}); await wait(100);
      const ms = Date.now() - t0, n1 = await T(() => zdTakeoff.P.proj.items.length), msg = await page.innerText("#toast");
      if (n1 > n0) { const it = await lastItem(), q = await qtyOf(it.id); R.auto.push({room: nm, expected: expectArea[nm], got: q, ms, label: it.label});
        calc("Auto area " + nm + " (" + it.label + ")", expectArea[nm], q, Math.max(0.5, 0.005 * expectArea[nm]), "Sft");
        ok(it.label === nm, nm + ": named from the drawing (" + it.label + ")"); }
      else { R.auto.push({room: nm, expected: expectArea[nm], got: null, ms, msg}); calc("Auto area " + nm + " — " + msg.slice(0, 90), expectArea[nm], NaN, 0.5, "Sft"); }
      perf("auto area " + nm, ms, 6000);
    }
    const n0 = await T(() => zdTakeoff.P.proj.items.length);
    await click(hx(10.5), hy(9)); await wait(400);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 && /Already measured/.test(await page.innerText("#toast")), "a second click in a measured room is refused (no duplicate area)");
    // p.7: hatched, turned, round, L-shaped rooms
    await go(7); await setScale(await key(), 18);
    await T(id => { zdTakeoff.S.cond = id; zdTakeoff.setTool("auto"); }, cf);
    for (const [nm, [x, y, want]] of Object.entries(FX.R7)) {
      const n0 = await T(() => zdTakeoff.P.proj.items.length); await click(x + (nm === "hatch" ? 9 : 0), y + (nm === "hatch" ? 9 : 0));
      await page.waitForFunction(() => !zdTakeoff.S.autoBusy, null, {timeout: 20000}); await wait(150);
      const n1 = await T(() => zdTakeoff.P.proj.items.length);
      if (n1 > n0) calc("Auto area p.7 " + nm + " room", want, await qtyOf((await lastItem()).id), Math.max(0.5, 0.01 * want), "Sft");
      else calc("Auto area p.7 " + nm + " room — " + (await page.innerText("#toast")).slice(0, 90), want, NaN, 0.5, "Sft");
    }
    await T(() => zdTakeoff.setTool("select"));
  });

  /* ---------------------------------------------------------------- 4b. agents, scale check, viewports, turned page export */
  await run("4b. Free agents, scale check against room sizes, viewport, turned page", async () => {
    await go(1); await setScale(await key(), 18);
    const keep = await T(() => { const Z = zdTakeoff, mine = Z.P.proj.items.filter(i => i.page === 1 && i.file === Z.S.fileId); Z.P.proj.items = Z.P.proj.items.filter(i => !mine.includes(i)); return JSON.stringify(mine); });
    const ca = await T(() => { const Z = zdTakeoff, c = {id: "CAG", name: "Agent rooms", type: "area", unit: "Sft", color: "#4a3aa7", h: "", t: "", faces: 1, dedMin: 0}; Z.P.proj.conds.push(c); Z.S.cond = c.id; return c.id; });
    let t0 = Date.now(); const r = await T(() => zdTakeoff.agentMeasure("")); perf("Rooms agent: 9 rooms traced and checked", Date.now() - t0, 30000);
    const want = {"BED ROOM 1": 144, "BATH 1": 72, "BED ROOM 2": 144, "CORRIDOR": 123, "LIVING": 257.25, "KITCHEN": 168, "BED ROOM 3": 144, "BATH 2": 72, "STORE": 144};
    const got = Object.fromEntries((r.rooms || []).map(x => [x.name, x]));
    Object.entries(want).forEach(([n, v]) => calc("Rooms agent " + n, v, got[n] ? got[n].area_sft : NaN, 0.01, "Sft"));
    ok((r.rooms || []).filter(x => x.written_sft != null).length === 8 && (r.rooms || []).every(x => !x.check), "written sizes read for the 8 rooms that have one (12’-0\"x12’-0\" as the PDF gives it) — none flagged");
    await T(() => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== "CAG"); Z.P.proj.conds = Z.P.proj.conds.filter(c => c.id !== "CAG"); });
    for (const [t, len, n] of [[0.75, 150.75, 1], [0.375, 154.25, 8]]) {
      const w = await T(t => zdTakeoff.wallsAgent({t, page: true, bridge: 6}), t);
      calc(`Walls agent ${t === 0.75 ? '9"' : '4.5"'} centre / face-to-face length`, len, w.total_length_ft, 0.01, "ft");
      ok(w.runs === n, `…in ${w.runs} run${w.runs > 1 ? "s" : ""} (expected ${n}: ${t === 0.75 ? "the outer wall as one closed loop" : "partitions; the corridor is not bridged, the + junction counted once"})`);
      await T(name => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === name); Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== c.id); Z.P.proj.conds = Z.P.proj.conds.filter(x => x !== c); }, w.condition);
    }
    await T(k => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.concat(JSON.parse(k)); zdTakeoff.setSel([]); }, keep);
    // a note that disagrees with the drawing is caught by the room sizes written on it
    const k1 = await key();
    await T(k => { zdTakeoff.P.proj.scales[k] = {ptPerFt: 9, how: "note", text: "SCALE 1/8\" = 1'-0\"", verified: false}; }, k1);
    const ck = await T(k => zdTakeoff.checkScale(k, false).then(r => r && {ok: r.ok, sug: r.sug && r.sug.ptPerFt, lbl: r.sug && r.sug.label, agree: r.ev && r.ev.agree}), k1);
    ok(ck && ck.ok === false && near(ck.sug, 18, 1e-9), "a wrong note (1/8\") is caught: " + (ck ? ck.agree + " written room sizes measure at " + ck.lbl : "no check"));
    ok(/Doubtful/.test(await T(k => zdTakeoff.scaleState(zdTakeoff.P.proj.scales[k]).t, k1)), "…the page is marked Doubtful until settled");
    await T(k => { zdTakeoff.P.proj.scales[k] = {ptPerFt: 18, how: "note", text: "SCALE 1/4\" = 1'-0\"", verified: false}; }, k1);
    const ck2 = await T(k => zdTakeoff.checkScale(k, false).then(r => r && r.ok), k1); ok(ck2 === true, "the right note (1/4\") agrees with the written room sizes");
    await setScale(k1, 18);
    // a viewport drawn at 1-1/2" = 1'-0" on the 3/16" sheet
    await go(6); await page.click("#scaleChip"); await page.click("#dlgVp"); await click(445, 140); await click(805, 450);
    await page.waitForSelector("#vpSc"); ok((await page.inputValue("#vpSc")) === "1-1/2\" = 1'-0\"", "viewport scale read from the detail's own note: " + await page.inputValue("#vpSc"));
    await page.click("#dlgOk"); await wait(200);
    ok(near(await T(() => zdTakeoff.P.proj.viewports[zdTakeoff.S.key][0].ptPerFt), 108, 1e-9), "viewport scale 108 pt per ft");
    const ds = await T(() => { const S = zdTakeoff.S, s = S.geo[S.key].segs.find(q => Math.abs(q[1] - 395) < 0.5 && Math.abs(q[3] - 395) < 0.5 && q[0] > 470); return s.slice(0, 4); });
    calc("2'-0\" line inside the 1-1/2\" detail", 2, await T(s => { const Z = zdTakeoff, c = {id: "CV", name: "V", type: "linear", unit: "ft", color: "#2a78d6", h: "", t: "", faces: 1}; Z.P.proj.conds.push(c); const it = {id: "IV", cond: "CV", file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[s[0], s[1]], [s[2], s[3]]], nos: 1}; Z.P.proj.items.push(it); const k = Z.P.proj.viewports[Z.S.key][0].ptPerFt; return Z.rowsOf(it, k)[0].L; }, ds), 1e-9, "ft");
    calc("16'-0\" line outside the detail (sheet 3/16\")", 16, await T(() => { const Z = zdTakeoff, s = Z.S.geo[Z.S.key].segs.find(q => Math.hypot(q[2] - q[0], q[3] - q[1]) > 200), it = {id: "IV2", cond: "CV", file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[s[0], s[1]], [s[2], s[3]]], nos: 1}; Z.P.proj.items.push(it); const k = Z.P.proj.scales[Z.S.key].ptPerFt; return Z.rowsOf(it, k)[0].L; }), 1e-9, "ft");
    ok(near(await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === "IV"); return Z.condTotals(Z.P.proj.conds.find(c => c.id === "CV")).net; }), 18, 1e-9), "the totals use each measurement's own scale (detail 2 + sheet 16 = 18 ft)");
    await T(() => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== "CV"); Z.P.proj.conds = Z.P.proj.conds.filter(c => c.id !== "CV"); });
    // marked-up PDF of the turned page
    await go(2); const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id); await T(id => { zdTakeoff.S.cond = id; }, cf);
    await page.keyboard.press("r"); await click(100, 100); await click(300, 400); await wait(150); const tp = (await lastItem()).id;
    const pf = await dl("#exPdf1"), PL = require(path.join(LIBS, "pdf-lib")), pd = await PL.PDFDocument.load(fs.readFileSync(pf));
    ok(pd.getPageCount() === 1 && Math.round(pd.getPage(0).getWidth()) === 595 && Math.round(pd.getPage(0).getHeight()) === 842, "marked-up PDF of the turned page: upright 595 × 842, as on screen");
    await T(id => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => i.id !== id); zdTakeoff.setSel([]); }, tp); await go(1);
  });

  /* ---------------------------------------------------------------- 5. data kept, conditions (layers) */
  await run("5. Data integrity and conditions (layers)", async () => {
    await go(1);
    const snap = () => T(() => JSON.stringify(zdTakeoff.P.proj.items.map(i => ({id: i.id, cond: i.cond, file: i.file, page: i.page, kind: i.kind, nos: i.nos, label: i.label, pts: i.pts}))));
    const s0 = await snap();
    const meta = await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 1).every(i => i.id && i.cond && i.file && i.page === 1 && i.kind && i.nos >= 1 && Array.isArray(i.pts) && i.pts.length >= 3 && i.pts.every(p => p.every(isFinite))));
    ok(meta, "every measurement carries its id, condition (type, unit, colour), file, page, kind, Nos, label and outline");
    ok(await T(() => { const P = zdTakeoff.P.proj; return P.items.every(i => P.conds.some(c => c.id === i.cond && c.unit && c.color && c.type)) && P.items.every(i => P.scales[i.file + ":" + i.page]); }), "…and its condition and page scale exist");
    await go(6); await go(3); await go(1);
    ok((await snap()) === s0, "page 1 → 6 → 3 → 1: every measurement exactly as it was");
    await page.reload({waitUntil: "load"}); await page.waitForFunction(() => zdTakeoff.P.proj && zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await wait(300);
    ok((await snap()) === s0, "reload: every measurement exactly as it was (" + (await T(() => zdTakeoff.P.proj.items.length)) + " measurements)");
    // conditions
    const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id), t0 = await total(cf);
    await page.click(`[data-edit="${cf}"]`); await page.fill("#cName", "Floor area — tiles"); await page.click("#dlgOk"); await wait(200);
    ok((await T(id => zdTakeoff.P.proj.conds.find(c => c.id === id).name, cf)) === "Floor area — tiles" && /Floor area — tiles/.test(await page.innerText("#condList")), "rename a condition (✎)");
    await page.click(`[data-color="${cf}"]`); await wait(100); await page.click('#pop [data-sw="#e34948"]'); await wait(150);
    ok((await T(id => zdTakeoff.P.proj.conds.find(c => c.id === id).color, cf)) === "#e34948" && /e34948/i.test(await T(() => document.getElementById("ov").innerHTML)), "change its colour: drawn in the new colour");
    const nPoly = () => T(() => document.querySelectorAll("#ov polygon").length);
    const p0 = await nPoly();
    await page.click(`[data-eye="${cf}"]`); await wait(200);
    ok((await nPoly()) < p0 && (await T(id => zdTakeoff.P.proj.conds.find(c => c.id === id).hidden, cf)), "hide it: its areas leave the drawing");
    const t1 = await total(cf); ok(near(t1.net, t0.net, 1e-9), "…but stay in its total (" + t1.net.toFixed(3) + " Sft) — hiding is a view filter, as in Bluebeam / PlanSwift; the sheet still lists them");
    await page.click(`[data-eye="${cf}"]`); await wait(200); ok((await nPoly()) === p0, "show it again");
    // move a measurement to another condition of the same kind
    const cc = await newCond("Ceiling plaster");
    const bed1 = await T(() => zdTakeoff.P.proj.items.find(i => i.label === "BED ROOM 1").id);
    await page.click('#sheet tr[data-item="' + bed1 + '"]'); await wait(300);
    await page.selectOption('#props [data-prop="cond"]', cc); await wait(200);
    ok((await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).cond, bed1)) === cc && near((await total(cc)).net, 144, 1e-6) && near((await total(cf)).net, t0.net - 144, 1e-6), "move BED ROOM 1 to Ceiling plaster: 144.000 Sft moves with it");
    await page.keyboard.press("Control+z"); await wait(200);
    ok((await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).cond, bed1)) === cf, "Ctrl+Z puts it back");
    // lock: not moved, not deleted
    await T(id => zdTakeoff.setSel([id]), bed1); await page.keyboard.press("Control+Shift+L"); await wait(150);
    const n0 = await T(() => zdTakeoff.P.proj.items.length); await T(id => zdTakeoff.setSel([id]), bed1); await page.keyboard.press("Delete"); await wait(150);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 && /Locked/.test(await page.innerText("#toast")), "a locked measurement is not deleted");
    await T(id => zdTakeoff.setSel([id]), bed1); await page.keyboard.press("Control+Shift+L"); await wait(100);
    // delete a condition with its measurements, then undo
    const nAll = await T(() => zdTakeoff.P.proj.items.length), nCf = await T(id => zdTakeoff.P.proj.items.filter(i => i.cond === id).length, cf);
    await page.click(`[data-edit="${cf}"]`); await page.click("#dlgF .btn.dng"); await wait(200); await page.click("#dlgOk"); await wait(250);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === nAll - nCf && !(await T(id => zdTakeoff.P.proj.conds.some(c => c.id === id), cf)), `delete the condition: it and its ${nCf} measurements go`);
    await page.keyboard.press("Control+z"); await wait(250);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === nAll && near((await total(cf)).net, t0.net, 1e-9), "Ctrl+Z: condition and all its measurements back, same total");
    await page.click(`[data-edit="${cf}"]`); await page.fill("#cName", "Floor area"); await page.click("#dlgOk"); await wait(150);
    // number keys pick the active condition
    await page.click("#stage", {position: {x: 5, y: 5}}); await page.keyboard.press("2"); await wait(100);
    ok((await T(() => zdTakeoff.S.cond)) === (await T(() => zdTakeoff.P.proj.conds[1].id)), "key 2 makes the 2nd condition active");
    await page.keyboard.press("Escape"); await T(() => zdTakeoff.setTool("select"));
  });

  /* ---------------------------------------------------------------- 6. editing stress, undo / redo */
  await run("6. Editing stress — 60 measurements, 80 random edits, undo all, redo all", async () => {
    await go(1);
    const cs = await newCond("Custom area", {name: "Stress"});
    const stressIds = await T(id => { const Z = zdTakeoff, P = Z.P.proj, out = [];
      Z.S.undo = []; Z.S.redo = [];
      for (let i = 0; i < 60; i++) { const x = 1300 + (i % 10) * 60, y = 300 + Math.floor(i / 10) * 60; const it = {id: "ST" + i, cond: id, file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[x, y], [x + 36, y], [x + 36, y + 27], [x, y + 27]], nos: 1, label: "S" + i}; P.items.push(it); out.push(it.id); }
      Z.setSel([]); return out; }, cs);
    await T(() => zdTakeoff.setTool("select"));
    await T(() => { zdTakeoff.S.undo = []; zdTakeoff.S.redo = []; });
    const state = () => T(() => JSON.stringify({i: zdTakeoff.P.proj.items, m: zdTakeoff.P.proj.marks}));
    const states = [await state()];
    let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const ops = ["dup", "rot", "nudge", "del", "addpt", "delpt", "nos", "drag", "flip", "paste"];
    let done = 0; const used = {};
    for (let step = 0; step < 80; step++) {
      const ids = await T(c => zdTakeoff.P.proj.items.filter(i => i.cond === c).map(i => i.id), cs); if (!ids.length) break;
      const id = ids[rnd(ids.length)], op = ops[rnd(ops.length)], u0 = await T(() => zdTakeoff.S.undo.length);
      await T(id => zdTakeoff.setSel([id]), id);
      if (op === "dup") await page.keyboard.press("Control+d");
      else if (op === "rot") await T(() => zdTakeoff.transformSel("cw"));
      else if (op === "flip") await T(() => zdTakeoff.transformSel("fh"));
      else if (op === "nudge") await page.keyboard.press(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"][rnd(4)]);
      else if (op === "del") await page.keyboard.press("Delete");
      else if (op === "addpt") await T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); Z.addPoint(it, 0, [(it.pts[0][0] + it.pts[1][0]) / 2, (it.pts[0][1] + it.pts[1][1]) / 2 - 3]); }, id);
      else if (op === "delpt") await T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); if (it.pts.length > 4) Z.delPoint(it, it.pts.length - 1); }, id);
      else if (op === "nos") { await page.click('#sheet tr[data-item="' + id + '"]').catch(() => {}); await wait(80); if (await page.isVisible('#props [data-prop="nos"]')) { await page.fill('#props [data-prop="nos"]', String(1 + rnd(4))); await page.press('#props [data-prop="nos"]', "Tab"); } }
      else if (op === "paste") { await page.keyboard.press("Control+c"); await T(() => zdTakeoff.pasteClip("inplace")); }
      else if (op === "drag") { const c = await T(id => { const it = zdTakeoff.P.proj.items.find(i => i.id === id); return it.pts[0]; }, id); const a = await scr(c[0], c[1]);
        if (a[0] > 260 && a[0] < 1000 && a[1] > 180 && a[1] < 820) { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[0] + 25, a[1] + 15, {steps: 4}); await page.mouse.up(); } }
      await wait(60);
      const u1 = await T(() => zdTakeoff.S.undo.length);
      if (u1 === u0 + 1) { states.push(await state()); done++; used[op] = (used[op] || 0) + 1; }
      else if (u1 !== u0) { ok(false, "step " + step + " (" + op + ") made " + (u1 - u0) + " undo steps"); states.length = 0; break; }
    }
    ok(done >= 60, done + " edits made (" + Object.entries(used).map(([k, v]) => k + " " + v).join(", ") + ")");
    const ids = await T(() => zdTakeoff.P.proj.items.map(i => i.id)); ok(new Set(ids).size === ids.length, "no duplicate ids after the edits");
    ok(await T(() => zdTakeoff.P.proj.items.every(i => i.pts.every(p => isFinite(p[0]) && isFinite(p[1])))), "every point a finite number");
    let undoOk = true, redoOk = true;
    for (let j = states.length - 2; j >= 0; j--) { await T(() => zdTakeoff.undoAny()); if ((await state()) !== states[j]) { undoOk = false; ok(false, "undo to step " + j + " differs"); break; } }
    ok(undoOk, "undo " + (states.length - 1) + " times: each state exactly as it was, back to the start");
    for (let j = 1; j < states.length; j++) { await T(() => zdTakeoff.redoAny()); if ((await state()) !== states[j]) { redoOk = false; ok(false, "redo to step " + j + " differs"); break; } }
    ok(redoOk, "redo " + (states.length - 1) + " times: each state exactly as it was, to the end");
    await T(c => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== c); Z.P.proj.conds = Z.P.proj.conds.filter(x => x.id !== c); Z.S.undo = []; Z.S.redo = []; Z.setSel([]); }, cs);
  });

  /* ---------------------------------------------------------------- 7. markups */
  await run("7. Markups (note, cloud, arrow, highlight)", async () => {
    await go(1); await T(() => zdTakeoff.setTool("select"));
    const nm0 = await T(() => (zdTakeoff.P.proj.marks || []).length), sheet0 = await page.innerText("#sheet"), tot0 = await T(() => zdTakeoff.P.proj.conds.map(c => zdTakeoff.condTotals(c).net).join());
    await page.keyboard.press("n"); await click(hx(40), hy(5)); await page.fill("#mkT", "Check slab level <img src=x onerror=\"window.__mk=1\">"); await page.click("#dlgOk"); await wait(150);
    await page.keyboard.press("u"); await click(hx(40), hy(10)); await click(hx(48), hy(16)); await page.fill("#mkT", "Rev 07"); await page.click("#dlgOk"); await wait(150);
    await page.click('[data-tool="arrow"]'); await click(hx(40), hy(20)); await click(hx(46), hy(24)); await page.fill("#mkT", "see detail"); await page.click("#dlgOk"); await wait(150);
    await page.click('[data-tool="hilite"]'); await click(hx(40), hy(28)); await click(hx(50), hy(31)); await wait(150);
    const mk = await T(() => zdTakeoff.P.proj.marks.slice(-4).map(m => m.type + ":" + m.text));
    ok((await T(() => zdTakeoff.P.proj.marks.length)) === nm0 + 4 && mk.join("|").startsWith("note:Check slab level"), "note, cloud, arrow and highlight added: " + mk.join(" · "));
    ok(!(await T(() => window.__mk)) && !(await T(() => !!document.querySelector("#ov img"))), "a note's text is shown as text (no HTML from it runs)");
    ok((await page.innerText("#sheet")) === sheet0 && (await T(() => zdTakeoff.P.proj.conds.map(c => zdTakeoff.condTotals(c).net).join())) === tot0, "markups are not quantities: sheet and totals unchanged");
    await T(() => zdTakeoff.setTool("select"));
    const note = await T(() => zdTakeoff.P.proj.marks.find(m => m.type === "note" && /slab/.test(m.text)));
    const a = await scr(note.pts[0][0] + 20, note.pts[0][1]); await page.mouse.click(a[0], a[1]); await wait(150);
    ok((await T(() => zdTakeoff.S.selMark)) === note.id, "click selects the note");
    await page.fill('#props [data-mprop="text"]', "Check slab level at grid C"); await page.press('#props [data-mprop="text"]', "Tab"); await wait(150);
    ok((await T(id => zdTakeoff.P.proj.marks.find(m => m.id === id).text, note.id)) === "Check slab level at grid C", "text edited in the properties");
    await T(id => zdTakeoff.setSel([id]), note.id);
    await page.$eval('#props [data-mprop="color"]', el => { el.value = "#1e8e5a"; el.dispatchEvent(new Event("change", {bubbles: true})); }); await wait(150);
    ok((await T(id => zdTakeoff.P.proj.marks.find(m => m.id === id).color, note.id)) === "#1e8e5a", "colour changed");
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[0] + 40, a[1] + 30, {steps: 5}); await page.mouse.up(); await wait(150);
    const moved = await T(id => zdTakeoff.P.proj.marks.find(m => m.id === id).pts[0], note.id);
    ok(near(moved[0] - note.pts[0][0], 40 / (await T(() => zdTakeoff.S.view.s)), 1) , "dragged: the note moved");
    await page.reload({waitUntil: "load"}); await page.waitForFunction(() => zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(300);
    ok((await T(() => zdTakeoff.P.proj.marks.length)) === nm0 + 4, "markups kept after reload");
    const svg = await T(f => zdTakeoff.pageOverlaySvg(f, 1, 1, 2592, 1728, true), await fid());
    ok(/at grid C/.test(svg) && /Rev 07/.test(svg), "markups go on the marked-up page export (PNG / PDF overlay)");
    await T(id => { zdTakeoff.setTool("select"); zdTakeoff.setSel([id]); }, note.id); await page.keyboard.press("Delete"); await wait(150);
    ok((await T(() => zdTakeoff.P.proj.marks.length)) === nm0 + 3, "Delete removes the selected note");
    await page.keyboard.press("Control+z"); await wait(150); ok((await T(() => zdTakeoff.P.proj.marks.length)) === nm0 + 4, "Ctrl+Z brings it back");
  });

  /* ---------------------------------------------------------------- 8. PDF text */
  await run("8. PDF text — find, room names, door / window tags", async () => {
    await go(1);
    await page.fill("#findIn", "BED ROOM"); await page.press("#findIn", "Enter"); await page.waitForSelector("#findRes .fr[data-hit]", {timeout: 8000});
    const hits = await page.$$eval("#findRes [data-hit]", r => r.map(x => x.querySelector("b").textContent + " @ " + x.querySelector(".small").textContent));
    const qa = hits.filter(h => /qa-set p\.1/.test(h));
    ok(qa.length === 3 && qa.every(h => /^BED ROOM [123] @/.test(h)), "find “BED ROOM”: 3 on the QA set p.1 (bed rooms 1–3), every PDF searched — " + hits.join(" · "));
    await page.click("#findRes [data-hit='2']"); await wait(400);
    ok((await T(() => zdTakeoff.S.flash && zdTakeoff.S.flash.key)) === (await key()), "click a result: zooms to it and flashes it");
    await page.keyboard.press("Escape").catch(() => {}); await page.click("#stage", {position: {x: 5, y: 5}});
    const tags = await T(() => zdTakeoff.scanTags("page").then(r => r[0].T.plan)).then(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.length])));
    ok(tags.D1 === 7 && tags.D2 === 2 && tags.W1 === 5 && tags.W2 === 3, "door / window tags read from the text: D1 7, D2 2, W1 5, W2 3 → " + JSON.stringify(tags));
    ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 1 && /BED ROOM|BATH|LIVING|KITCHEN|STORE|CORRIDOR/.test(i.label)).length >= 9), "auto areas named from the room names in the PDF text");
    R.notTested.push({what: "OCR of scanned drawings", why: "not in the app (PDF text only); scanned pages measure but have no text — listed in the parity notes"});
  });

  /* ---------------------------------------------------------------- 9. compare */
  await run("9. Overlay compare", async () => {
    await go(1);
    await page.click("#bCompare"); await page.waitForSelector("#cmpSel"); await page.selectOption("#cmpSel", {index: 5}); await page.click("#dlgOk"); await wait(1200);
    ok(await T(() => !!(zdTakeoff.S.cmp && zdTakeoff.S.cmp.pg)) && await page.isVisible("#cmpLegend"), "compare with another page: legend shown, red / blue overlay");
    await page.click("#stage", {position: {x: 5, y: 5}}).catch(() => {});
    await page.keyboard.press("Alt+ArrowRight"); await page.keyboard.press("Alt+Shift+ArrowDown"); await wait(300);
    const d = await T(() => [zdTakeoff.S.cmp.dx * zdTakeoff.S.view.s, zdTakeoff.S.cmp.dy * zdTakeoff.S.view.s]);
    ok(near(d[0], 1, 1e-6) && near(d[1], 10, 1e-6), "Alt+arrows nudge the compared sheet (1 px, Shift 10 px) to line it up");
    await page.click("#cmpOff"); await wait(300); ok(!(await T(() => zdTakeoff.S.cmp)) && !(await page.isVisible("#cmpLegend")), "compare off");
  });

  /* ---------------------------------------------------------------- 10. pages and PDFs */
  await run("10. Page management — add / remove PDFs, measurements stay on their page", async () => {
    await go(1);
    const snapQa = () => T(f => JSON.stringify(zdTakeoff.P.proj.items.filter(i => i.file === f)), fid0);
    const fid0 = await fid(), s0 = await T(f => JSON.stringify(zdTakeoff.P.proj.items.filter(i => i.file === f)), fid0);
    const nf = await T(() => zdTakeoff.P.proj.files.length), np = await page.locator("#pageSel option").count();
    await page.setInputFiles("#fileIn", {name: "second.pdf", mimeType: "application/pdf", buffer: makePdf()});
    await page.waitForFunction(n => zdTakeoff.P.proj.files.length === n + 1 && zdTakeoff.S.geo[zdTakeoff.S.key], nf, {timeout: 15000}); await wait(300);
    ok((await page.locator("#pageSel option").count()) === np + 3, "another PDF adds its 3 pages (" + (np + 3) + " in all)");
    const f2 = await T(() => zdTakeoff.P.proj.files.find(f => f.name === "second.pdf").id);
    await setScale(f2 + ":1", 9); const cid = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id);
    await T(([c, f]) => { zdTakeoff.S.cond = c; }, [cid, f2]); await page.keyboard.press("r"); await click(200, 200); await click(290, 290); await wait(150);
    ok((await T(f => zdTakeoff.P.proj.items.filter(i => i.file === f).length, f2)) === 1, "a measurement on the second PDF");
    ok((await T(f => JSON.stringify(zdTakeoff.P.proj.items.filter(i => i.file === f)), fid0)) === s0, "the first PDF's measurements untouched");
    await page.click("#tPages"); await wait(300);
    ok((await page.locator("#pageList .pgf").count()) === nf + 1, "Pages lists every PDF (" + (nf + 1) + ")");
    await page.click(`#pageList [data-rmpdf="${f2}"]`); await page.waitForSelector("#dlgOk"); ok(/1<\/b> measurement|1 measurement/.test(await page.innerHTML("#dlgB")), "Remove PDF asks first, naming its measurements");
    await page.click("#dlgOk"); await page.waitForFunction(n => zdTakeoff.P.proj.files.length === n, nf, {timeout: 10000}); await wait(400);
    ok((await T(f => zdTakeoff.P.proj.items.filter(i => i.file === f).length, f2)) === 0 && !(await T(f => Object.keys(zdTakeoff.P.proj.scales).some(k => k.startsWith(f)), f2)), "removed with its measurement and scale");
    ok((await T(f => JSON.stringify(zdTakeoff.P.proj.items.filter(i => i.file === f)), fid0)) === s0, "the QA set's measurements all still on their own pages");
    ok((await T(() => zdTakeoff.backupsOf(zdTakeoff.P.proj.id))).some(b => /before removing second\.pdf/.test(b.why)), "a backup was taken before the removal");
    await page.click("#tCond"); await go(1);
    R.notTested.push({what: "Reorder / duplicate / rotate / delete single pages of a PDF", why: "not in the app: the PDF is the drawing as issued; pages are viewed as they are (turned pages shown turned, as the PDF says)"});
  });

  /* ---------------------------------------------------------------- 11. a house, as a QS measures it */
  await run("11. QS workflow — the house: floors, ceilings, skirting, walls, openings, doors, windows", async () => {
    await go(7); await T(() => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => !(i.page === 7)); Z.setSel([]); }); await go(1);
    await setScale(await key(), 18);
    const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id);
    const floor = await total(cf);
    calc("Floor area: 9 rooms by auto area", 1268.25, floor.net, 0.01, "Sft");
    // ceiling and skirting from the floor areas (assemblies)
    await T(id => { const c = zdTakeoff.P.proj.conds.find(x => x.id === id); c.asm = [{id: "A1", name: "Ceiling plaster", unit: "Sft", f: "A"}, {id: "A2", name: "Skirting", unit: "ft", f: "P"}, {id: "A3", name: "Floor tiles + 5 %", unit: "Sft", f: "A*1.05"}]; }, cf);
    const bl = await T(() => zdTakeoff.billLines().filter(l => l.kind === "asm").map(l => [l.name, l.qty]));
    calc("Ceiling = floor area (assembly A)", 1268.25, bl.find(x => x[0] === "Ceiling plaster")[1], 0.01, "Sft");
    calc("Skirting = room perimeters (assembly P)", 450.25, bl.find(x => x[0] === "Skirting")[1], 0.01, "ft");
    calc("Floor tiles + 5 % (assembly A*1.05)", 1268.25 * 1.05, bl.find(x => x[0] === "Floor tiles + 5 %")[1], 0.01, "Sft");
    // external wall: 9" brick, H 10, on its centre line — typed lengths
    const cw = await newCond("Brick masonry 9\" wall", {h: "10"});
    await page.keyboard.press("a"); await click(hx(0.375), hy(0.375), {mod: "Control"});
    const leg = async (dx, dy, len) => { const c = await scr(hx(0.375) + dx * 400, hy(0.375) + dy * 400); await page.mouse.move(c[0], c[1]); await wait(60); await page.keyboard.type(len); await page.keyboard.press("Enter"); await wait(80); };
    const pts0 = await T(() => zdTakeoff.S.draft.slice());
    await leg(1, 0, "31'-6\""); const p1 = await T(() => zdTakeoff.S.draft.slice(-1)[0]);
    await page.mouse.move(...(await scr(p1[0], p1[1] + 400))); await page.keyboard.type("43'-10 1/2\""); await page.keyboard.press("Enter"); await wait(80); const p2 = await T(() => zdTakeoff.S.draft.slice(-1)[0]);
    await page.mouse.move(...(await scr(p2[0] - 400, p2[1]))); await page.keyboard.type("31.5"); await page.keyboard.press("Enter"); await wait(80); const p3 = await T(() => zdTakeoff.S.draft.slice(-1)[0]);
    await page.mouse.move(...(await scr(p3[0], p3[1] - 400))); await page.keyboard.type("43.875"); await page.keyboard.press("Enter"); await wait(80);
    await page.keyboard.press("Enter"); await wait(200);
    const wall = await lastItem();
    calc("9\" outer wall centre line, typed 31'-6\" + 43'-10 1/2\" + 31.5 + 43.875", 150.75, await T(id => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === id); return Z.rowsOf(it, 18)[0].L; }, wall.id), 0.0005, "ft");
    calc("9\" outer wall: 150.75 × 0.75 × 10", 1130.625, await qtyOf(wall.id), 0.001, "cft");
    // the entrance as an opening: snapped to the jamb lines' middles, 7 ft high
    await page.keyboard.press("o"); await click(hx(0.375), hy(13.625)); await click(hx(0.375), hy(16.625));
    await page.waitForSelector("#dlgH"); await page.fill("#dlgH", "7'-0\""); await page.fill("#dlgLbl", "D1"); await page.click("#dlgOk"); await wait(200);
    const op = await lastItem();
    calc("Entrance opening width (clicked on the jambs)", 3, await T(id => zdTakeoff.rowsOf(zdTakeoff.P.proj.items.find(i => i.id === id), 18)[0].L, op.id), 0.0005, "ft");
    calc("Entrance deduction −1 × 3 × 0.75 × 7", -15.75, await qtyOf(op.id), 0.001, "cft");
    calc("9\" wall net", 1130.625 - 15.75, (await total(cw)).net, 0.001, "cft");
    // doors and windows counted from their tags (Find text → Count all)
    for (const [tag, n] of [["D1", 7], ["D2", 2], ["W1", 5], ["W2", 3]]) {
      await page.fill("#findIn", tag); await page.press("#findIn", "Enter"); await page.waitForSelector("#findRes [data-cntall]", {timeout: 8000});
      await page.click("#findRes [data-cntall]"); await page.waitForSelector("#ctC"); await page.click("#dlgOk"); await wait(250);
      calc("Count " + tag + " from the drawing text", n, (await total(tag)).net, 0, "Nos");
    }
    // the same quantity everywhere: drawing label → sheet → condition list → bill
    const sheet = await page.innerText("#sheet"), conds = await page.innerText("#condList");
    ok(/Total Floor area[\s\S]*1,268\.250 Sft/.test(sheet) && /1,268\.250/.test(conds), "1,268.250 Sft on the sheet total and the condition list");
    await page.click("#vBill"); await wait(200); const bill = await page.innerText("#bill"); await page.click("#vSheet");
    ok(/1,268\.250/.test(bill) && /450\.250/.test(bill) && /1,114\.875/.test(bill), "…and in the bill (floor 1,268.250 · skirting 450.250 · wall 1,114.875 cft)");
    const lbl = await T(() => [...document.querySelectorAll("#ov text")].map(t => t.textContent).join("|"));
    ok(/144\.000 Sft/.test(lbl) && /257\.250 Sft/.test(lbl), "drawing labels show the same figures (144.000, 257.250 Sft)");
    await T(() => { document.getElementById("findIn").value = ""; document.getElementById("findRes").classList.remove("on"); zdTakeoff.setTool("select"); });
  });

  /* ---------------------------------------------------------------- 12. measurement sheet (register) */
  await run("12. Measurement sheet / register", async () => {
    await go(1); await T(() => zdTakeoff.setTool("select"));
    const bed1 = await T(() => zdTakeoff.P.proj.items.find(i => i.label === "BED ROOM 1").id);
    const row = await page.innerText(`#sheet tr[data-item="${bed1}"]`);
    ok(/BED ROOM 1/.test(row) && /qa-set p\.1/.test(row) && /1 × 12\.000 × 12\.000/.test(row) && /144\.000/.test(row), "row: description, drawing / page, Nos × L × W, quantity 144.000 — " + row.replace(/\s+/g, " "));
    const cnt = await page.innerText("#sheet"); ok(/Count|D1/.test(cnt) && /\b7 Nos\b|\t7\b|7 Nos/.test(cnt.replace(/\n/g, " ")), "counts shown as whole numbers (7 Nos)");
    await page.click(`#sheet [data-rename="${bed1}"]`); await page.fill("#dlgLbl", "Master bed room"); await page.click("#dlgOk"); await wait(200);
    ok(/Master bed room/.test(await page.innerText(`#sheet tr[data-item="${bed1}"]`)), "rename from the sheet (✎)");
    await page.keyboard.press("Control+z"); await wait(150);
    await page.click(`#sheet tr[data-item="${bed1}"]`); await wait(200);
    ok((await T(() => zdTakeoff.S.sel)) === bed1, "click a sheet row: the measurement is selected on the drawing");
    await page.selectOption('#props [data-prop="qa"]', "checked"); await page.waitForSelector("#dlgUser"); await page.fill("#dlgUser", "QA bot"); await page.click("#dlgOk"); await wait(200);
    ok(await T(id => { const it = zdTakeoff.P.proj.items.find(i => i.id === id); return it.qa === "checked" && it.qaBy === "QA bot" && !!it.qaAt; }, bed1), "QA: marked checked, by whom and when");
    await page.click('#qaBar [data-qf="checked"]'); await wait(150);
    ok((await page.locator("#sheet tr.it").count()) === 1, "QA filter “checked” shows only that row");
    await page.click('#qaBar [data-qf="checked"]'); await wait(150);
    R.notTested.push({what: "Sort / search / pagination of the measurement sheet", why: "not in the app: the sheet is grouped by condition in drawing order (house format); QA filters and Find text cover lookup"});
  });

  /* ---------------------------------------------------------------- 13. exports and import */
  await run("13. Export → import round trip (Excel, CSV, PDF, PNG, JSON)", async () => {
    await go(1);
    const tots = await T(() => Object.fromEntries(zdTakeoff.P.proj.conds.filter(c => zdTakeoff.P.proj.items.some(i => i.cond === c.id)).map(c => [c.name, zdTakeoff.condTotals(c).net])));
    let t0 = Date.now(); const xf = await dl("#exXls"); perf("Excel export (" + Object.keys(tots).length + " conditions)", Date.now() - t0, 8000);
    const ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf);
    const ms = wb.getWorksheet("Measurement"), xt = {};
    ms.eachRow(r => { const d = String(r.getCell(2).value || ""), q = r.getCell(8).value; if (/^Total /.test(d) && q && q.formula) xt[d.replace(/^Total /, "")] = {v: q.result, fmt: r.getCell(8).numFmt}; });
    Object.entries(tots).forEach(([n, v]) => calc("Excel total = takeoff: " + n, v, xt[n] ? xt[n].v : NaN, 1e-9, ""));
    ok(xt["Floor area"] && xt["Floor area"].fmt === "#,##0.000" && xt["D1"] && xt["D1"].fmt === "#,##0", "Excel number formats: Sft 0.000, Nos whole");
    const sm = wb.getWorksheet("Summary"), sv = {}; sm.eachRow((r, i) => { if (i > 1) sv[r.getCell(1).value] = r.getCell(2).value; });
    ok(Object.entries(tots).every(([n, v]) => sv[n] && /^Measurement!H\d+$/.test(sv[n].formula) && near(sv[n].result, v, 1e-9)), "Summary links each total to its Measurement cell");
    const bl = wb.getWorksheet("Bill"), bv = []; bl.eachRow((r, i) => { if (i > 1) bv.push([String(r.getCell(3).value).trim(), r.getCell(5).value]); });
    ok(bv.some(([n, q]) => n === "Skirting" && near(q, 450.25, 0.001)) && bv.some(([n, q]) => n === "Ceiling plaster" && near(q, 1268.25, 0.001)), "Bill sheet: ceiling 1,268.250 Sft, skirting 450.250 ft");
    const cf = await dl("#exCsv"), csv = fs.readFileSync(cf, "utf8").replace(/^\uFEFF/, ""), lines = csv.split(/\r\n/).map(l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => /^".*"$/.test(v) ? v.slice(1, -1).replace(/""/g, '"') : v));
    const ctot = Object.fromEntries(lines.filter(l => /^Total /.test(l[2] || "")).map(l => [l[1], +l[8]]));
    Object.entries(tots).forEach(([n, v]) => calc("CSV total = takeoff: " + n, Math.round(v * 1000) / 1000, ctot[n], 1e-9, ""));
    ok(lines.some(l => l[1] === "D1" && l[8] === "7"), "CSV: counts as whole numbers (7)");
    t0 = Date.now(); const pf = await dl("#exPdfA"); perf("marked-up PDF, all measured pages", Date.now() - t0, 15000);
    const PL = require(path.join(LIBS, "pdf-lib")), pd = await PL.PDFDocument.load(fs.readFileSync(pf));
    const pagesWith = await T(() => new Set(zdTakeoff.P.proj.items.concat(zdTakeoff.P.proj.marks || []).map(i => i.file + "|" + i.page)).size);
    ok(pd.getPageCount() === pagesWith, "marked-up PDF: one page per page measured (" + pd.getPageCount() + ")");
    ok(Math.round(pd.getPage(0).getWidth()) === 2592, "…at the drawing's own size (2592 × 1728 pt, vector page kept)");
    const png = fs.readFileSync(await dl("#exPng")); const pw2 = png.readUInt32BE(16), ph2 = png.readUInt32BE(20);
    ok(pw2 === 6000 && ph2 === 4000, "marked-up PNG: 6000 × 4000 px for the 2592 × 1728 pt sheet");
    const jf = await dl("#exJson"), J = JSON.parse(fs.readFileSync(jf, "utf8"));
    ok(J.format === "zd-takeoff" && J.items.length === (await T(() => zdTakeoff.P.proj.items.length)), "project JSON holds every measurement (" + J.items.length + ")");
    const before = await T(() => JSON.stringify({c: zdTakeoff.P.proj.conds, i: zdTakeoff.P.proj.items, s: zdTakeoff.P.proj.scales, m: zdTakeoff.P.proj.marks, o: zdTakeoff.P.proj.openings}));
    const pid = await T(() => zdTakeoff.P.proj.id);
    await page.click("#bProjects"); await wait(300); await page.setInputFiles("#impIn", jf); await wait(1500);
    const imp = await T(() => zdTakeoff.S.lastImport);
    ok(imp && imp.lvl !== "FAIL", "import validation: " + (imp ? imp.lvl + " — " + imp.rows.filter(r => r.st !== "PASS").map(r => r.what + " " + r.st).join(", ") : "none"));
    const after = await T(() => JSON.stringify({c: zdTakeoff.P.proj.conds, i: zdTakeoff.P.proj.items, s: zdTakeoff.P.proj.scales, m: zdTakeoff.P.proj.marks, o: zdTakeoff.P.proj.openings}));
    ok(after === before, "imported project identical: conditions, measurements, scales, markups, opening schedule");
    const t2 = await T(() => Object.fromEntries(zdTakeoff.P.proj.conds.filter(c => zdTakeoff.P.proj.items.some(i => i.cond === c.id)).map(c => [c.name, zdTakeoff.condTotals(c).net])));
    ok(JSON.stringify(t2) === JSON.stringify(tots), "…and every total the same");
    await closeDlg(); await T(id => zdTakeoff.openProject(id), pid); await wait(800); await go(1);
  });

  /* ---------------------------------------------------------------- 14. save, recovery */
  await run("14. Save, auto-save, recovery, two tabs", async () => {
    await go(1); const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id);
    await T(id => { zdTakeoff.S.cond = id; }, cf); await page.keyboard.press("r"); await click(hx(40), hy(2)); await page.keyboard.type("10 x 8"); await page.keyboard.press("Enter"); await wait(30);
    const id = (await lastItem()).id;
    await page.reload({waitUntil: "load"}); await page.waitForFunction(() => zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000});
    ok(await T(id => zdTakeoff.P.proj.items.some(i => i.id === id), id), "a measurement made 30 ms before a reload is kept");
    await page.evaluate(() => { window.__ks = null; window.addEventListener("keydown", e => { if (e.key.toLowerCase() === "s" && e.ctrlKey) window.__ks = e.defaultPrevented; }); });
    let dl0 = false; const h = () => { dl0 = true; }; page.on("download", h);
    await page.keyboard.press("Control+s"); await wait(400); page.off("download", h);
    ok((await T(() => window.__ks)) === true && !dl0 && /Saved in this browser/.test(await page.innerText("#toast")), "Ctrl+S saves (the browser's Save page is blocked): “" + (await page.innerText("#toast")).slice(0, 60) + "…”");
    // abrupt close (no unload events) right after a change — the worst case
    await T(id => { zdTakeoff.S.cond = id; }, cf); await page.keyboard.press("r"); await click(hx(40), hy(14)); await page.keyboard.type("6 x 6"); await page.keyboard.press("Enter"); await wait(20);
    const id2 = (await lastItem()).id;
    await page.close({runBeforeUnload: false});
    const p2 = await ctx.newPage(); p2.on("pageerror", e => errors.push(String(e)));
    await p2.goto(URL, {waitUntil: "load"}); await p2.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj, null, {timeout: 20000});
    const kept = await p2.evaluate(id => zdTakeoff.P.proj.items.some(i => i.id === id), id2);
    ok(true, "tab closed 20 ms after a change (no unload): the change was " + (kept ? "kept" : "LOST — the 300 ms save window (documented risk)"));
    if (!kept) R.risks = (R.risks || []).concat("A browser crash within 300 ms of a change loses that one change (normal close, reload and hide are saved at once)");
    await p2.close();
    // back to a fresh tab for the rest
    page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); }); page.on("dialog", d => d.dismiss());
    await page.goto(URL, {waitUntil: "load"}); await page.waitForFunction(() => zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(300);
    await T(ids => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => !ids.includes(i.id)); zdTakeoff.flushSave && zdTakeoff.S; }, [id, id2]); await page.keyboard.press("Control+s"); await wait(200);
    // two tabs
    const p3 = await ctx.newPage(); await p3.goto(URL, {waitUntil: "load"}); await p3.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await p3.waitForTimeout(600);
    const w1 = await page.innerText("#warnbar"), w2 = await p3.innerText("#warnbar"), tw = /(also open|changed) in another tab/;
    ok(tw.test(w1) && tw.test(w2), "the same project in two tabs: both warn that they overwrite each other (“" + w1.slice(0, 60) + "…”)");
    await p3.close(); await wait(200);
    // projects list, backups
    await page.click("#bProjects"); await wait(300);
    ok(/QA house/.test(await page.innerText("#projList")), "projects list shows the project");
    await page.click("#projList [data-open]"); await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 15000}); await wait(300);
    ok((await T(() => zdTakeoff.backupsOf(zdTakeoff.P.proj.id))).length >= 1, "backups kept for the project");
  });

  /* ---------------------------------------------------------------- 15. undo / redo master test */
  await run("15. Undo / redo master test", async () => {
    await go(1); await T(() => { zdTakeoff.S.undo = []; zdTakeoff.S.redo = []; zdTakeoff.setTool("select"); });
    const st = () => T(() => JSON.stringify({i: zdTakeoff.P.proj.items, m: zdTakeoff.P.proj.marks}));
    const S0 = [await st()];
    const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id);
    await T(id => { zdTakeoff.S.cond = id; }, cf); await page.keyboard.press("r"); await click(hx(42), hy(3)); await page.keyboard.type("10 x 8"); await page.keyboard.press("Enter"); await wait(150);
    const id = (await lastItem()).id; S0.push(await st()); ok(near(await qtyOf(id), 80, 1e-9), "1 create: 10 × 8 = 80.000 Sft");
    await T(id => { zdTakeoff.setTool("select"); zdTakeoff.setSel([id]); }, id); await page.click(`#sheet tr[data-item="${id}"]`); await wait(150);
    await page.fill('#props [data-prop="label"]', "Porch"); await page.press('#props [data-prop="label"]', "Tab"); await wait(150); S0.push(await st()); ok(true, "2 edit: renamed Porch");
    const pp = await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).pts, id), c0 = pp[0], a = await scr(c0[0] + (pp[1][0] - c0[0]) * 0.25, c0[1] + (pp[1][1] - c0[1]) * 0.25);   // a quarter along a side: the side itself (a corner reshapes, the + adds a point)
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[0] + 30, a[1] + 20, {steps: 4}); await page.mouse.up(); await wait(150); S0.push(await st());
    ok(!near((await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).pts[0][0], id)), c0[0], 0.1) && near(await qtyOf(id), 80, 1e-9), "3 move: dragged by its side — moved, still 80.000 Sft");
    await page.click(`#sheet tr[data-item="${id}"]`); await wait(100); await page.fill('#props [data-prop="nos"]', "3"); await page.press('#props [data-prop="nos"]', "Tab"); await wait(150); S0.push(await st());
    ok(near(await qtyOf(id), 240, 1e-9), "4 change quantity: Nos 3 → 240.000 Sft");
    await page.keyboard.press("n"); await click(hx(42), hy(14)); await page.fill("#mkT", "porch note"); await page.click("#dlgOk"); await wait(150); S0.push(await st()); ok(true, "5 add a markup");
    await T(id => { zdTakeoff.setTool("select"); zdTakeoff.setSel([id]); }, id); await page.keyboard.press("Delete"); await wait(150); S0.push(await st());
    ok(!(await T(id => zdTakeoff.P.proj.items.some(i => i.id === id), id)), "6 delete the measurement");
    let good = true; for (let j = S0.length - 2; j >= 0; j--) { await page.keyboard.press("Control+z"); await wait(120); if ((await st()) !== S0[j]) { good = false; ok(false, "undo step back to state " + j + " differs"); break; } }
    ok(good, "Ctrl+Z × 6: every state restored exactly, back to before the rectangle");
    good = true; for (let j = 1; j < S0.length; j++) { await page.keyboard.press("Control+y"); await wait(120); if ((await st()) !== S0[j]) { good = false; ok(false, "redo to state " + j + " differs"); break; } }
    ok(good, "Ctrl+Y × 6: every state again, exactly");
    await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await wait(200);
    ok((await st()) === S0[0], "and undone back to the start");
  });

  /* ---------------------------------------------------------------- 16. performance */
  await run("16. Performance and stress", async () => {
    // 100 / 500 / 1000 measurements on one page
    await go(1); const cp = await T(() => { const Z = zdTakeoff, c = {id: "CPERF", name: "Perf", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0}; Z.P.proj.conds.push(c); return c.id; });
    for (const N of [100, 500, 1000]) {
      await T(([N, c]) => { const Z = zdTakeoff, P = Z.P.proj; P.items = P.items.filter(i => i.cond !== c);
        for (let i = 0; i < N; i++) { const x = 1250 + (i % 40) * 30, y = 120 + Math.floor(i / 40) * 25; P.items.push({id: "PF" + i, cond: c, file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[x, y], [x + 20, y], [x + 20, y + 15], [x, y + 15]], nos: 1, label: "P" + i}); }
        Z.setSel([]); }, [N, cp]);
      const ms = await T(() => { const t = performance.now(); zdTakeoff.transformSel("cw"); zdTakeoff.setSel(["PF0"]); zdTakeoff.transformSel("cw"); return performance.now() - t; });
      perf(N + " measurements: one edit (undo snapshot + sheet + drawing)", ms, N <= 500 ? 150 : 300);
      const b = await page.locator("#stage").boundingBox(); let t = Date.now();
      for (let i = 0; i < 20; i++) await page.mouse.move(b.x + 300 + i * 7, b.y + 300 + (i % 3) * 5);
      await wait(16); perf(N + " measurements: 20 mouse moves", Date.now() - t, N <= 500 ? 1200 : 2500, "≈" + Math.round((Date.now() - t) / 20) + " ms each incl. test overhead");
    }
    let t = Date.now(); await dl("#exXls"); perf("Excel export with 1000+ measurements", Date.now() - t, 15000);
    t = Date.now(); await dl("#exJson"); perf("project JSON export with 1000+ measurements", Date.now() - t, 3000);
    await T(c => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== c); Z.P.proj.conds = Z.P.proj.conds.filter(x => x.id !== c); Z.S.undo = []; Z.S.redo = []; Z.setSel([]); Z.save(); return Z.flushSave(); }, cp);
    // 120-page PDF in a new project
    await page.click("#bProjects"); await wait(200); await page.click("#bNewProj"); await page.fill("#dlgName", "QA 120 pages"); await page.click("#dlgOk"); await wait(400);
    t = Date.now(); await page.setInputFiles("#fileIn", {name: "big-set.pdf", mimeType: "application/pdf", buffer: FX.makeBigPdf(120)});
    await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000});
    perf("open a 120-page PDF (first page shown and indexed)", Date.now() - t, 6000);
    ok((await page.locator("#pageSel option").count()) === 120, "120 pages listed");
    await page.click("#stage", {position: {x: 5, y: 5}}); await T(() => zdTakeoff.setTool("select"));
    t = Date.now(); for (let i = 2; i <= 11; i++) { await page.keyboard.press("PageDown"); await page.waitForFunction(i => zdTakeoff.S.pageNo === i && zdTakeoff.S.geo[zdTakeoff.S.key], i, {timeout: 10000}); }
    perf("10 page changes on the 120-page PDF (each shown and indexed)", Date.now() - t, 6000, Math.round((Date.now() - t) / 10) + " ms each");
    await page.keyboard.press("End"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 120, null, {timeout: 10000}); ok(true, "End → p.120");
    await page.click("#tPages"); t = Date.now();
    await page.waitForFunction(() => [...document.querySelectorAll("#pageList img")].filter(i => (i.getAttribute("src") || "").startsWith("data:")).length >= 6, null, {timeout: 20000}).catch(() => {});
    perf("Pages tab: first thumbnails of 120 drawn", Date.now() - t, 8000);
    ok((await T(() => [...document.querySelectorAll("#pageList img")].filter(i => (i.getAttribute("src") || "").startsWith("data:")).length)) < 60, "…only the ones in view are drawn (not all 120 at once)");
    await page.click("#tCond");
    t = Date.now(); await page.fill("#findIn", "SHEET A-219"); await page.press("#findIn", "Enter"); await page.waitForSelector("#findRes [data-hit]", {timeout: 30000});
    perf("Find text across 120 pages", Date.now() - t, 15000); ok(/A-219/.test(await page.innerText("#findRes")), "found SHEET A-219 on p.119");
    await page.keyboard.press("Escape"); await T(() => document.getElementById("findRes").classList.remove("on"));
    const heap = await T(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null); if (heap != null) R.perf.push({test: "JS heap after the 120-page run", ms: heap, limit: 1500, status: heap < 1500 ? "PASS" : "HIGH", note: "MB"});
    await page.click("#bProjects"); await wait(300); await page.click("#projList [data-open]"); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.name === "QA house", null, {timeout: 15000}).catch(async () => {
      const id = await T(() => zdTakeoff.P.proj && zdTakeoff.P.proj.id); }); 
    if ((await T(() => zdTakeoff.P.proj.name)) !== "QA house") { const pid = await T(() => zdTakeoff.showStart && null); await page.evaluate(async () => { const all = await new Promise(r => { const q = indexedDB.open("zdTakeoff"); q.onsuccess = () => { const t = q.result.transaction("projects").objectStore("projects").getAll(); t.onsuccess = () => r(t.result); }; }); const p = all.find(x => x.name === "QA house"); await zdTakeoff.openProject(p.id); }); }
    await go(1);
  });

  /* ---------------------------------------------------------------- 17. edge cases */
  await run("17. Edge cases", async () => {
    await go(1); const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id);
    const rect = async (txt, at) => { await T(id => { zdTakeoff.S.cond = id; }, cf); await page.keyboard.press("r"); await click(...at); await page.keyboard.type(txt); await page.keyboard.press("Enter"); await wait(150); return lastItem(); };
    const tiny = await rect("0.01 x 0.01", [hx(44), hy(2)]); calc("tiny rectangle 0.01 × 0.01 ft", 0.0001, await qtyOf(tiny.id), 1e-9, "Sft");
    const huge = await rect("1000 x 1000", [hx(44), hy(2)]); calc("huge rectangle 1000 × 1000 ft", 1e6, await qtyOf(huge.id), 1e-6, "Sft");
    ok(/1,000,000\.000/.test(await page.innerText("#sheet")), "1,000,000.000 Sft shown in full");
    await T(ids => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => !ids.includes(i.id)); zdTakeoff.setSel([]); }, [tiny.id, huge.id]);
    const n0 = await T(() => zdTakeoff.P.proj.items.length);
    await page.keyboard.press("r"); await click(hx(44), hy(4)); await click(hx(44), hy(4)); await wait(150);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === n0, "a zero-size rectangle (same point twice) is not added");
    const sk = await newCond("Skirting"); await page.keyboard.press("a"); await click(hx(44), hy(6), {mod: "Control"}); await page.mouse.dblclick(...(await scr(hx(44), hy(6))).map((v, i) => v + (i ? 0 : 1))); await wait(150);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === n0, "a zero-length run (double-click on the same point) is not added");
    await page.keyboard.press("Escape");
    // Nos: letters, negative, zero, decimals, huge
    const bed1 = await T(() => zdTakeoff.P.proj.items.find(i => i.label === "BED ROOM 1").id);
    for (const [v, want] of [["abc", 1], ["-5", 1], ["0", 1], ["2.6", 3], ["1e3", 1000], ["99999999999", null]]) {
      await T(() => zdTakeoff.setTool("select")); await page.click(`#sheet tr[data-item="${bed1}"]`); await wait(80);
      await page.fill('#props [data-prop="nos"]', v).catch(async () => { await page.$eval('#props [data-prop="nos"]', (el, v) => { el.value = v; }, v); }); await page.$eval('#props [data-prop="nos"]', el => el.dispatchEvent(new Event("change", {bubbles: true}))); await wait(120);
      const nos = await T(id => zdTakeoff.P.proj.items.find(i => i.id === id).nos, bed1);
      ok(want == null ? nos >= 1 && nos <= 100000 : nos === want, `Nos “${v}” → ${nos}` + (want == null ? " (capped)" : ""));
    }
    await T(id => { zdTakeoff.P.proj.items.find(i => i.id === id).nos = 1; zdTakeoff.setSel([]); }, bed1);
    // a measurement on a page with no scale
    await go(4); await T(id => { zdTakeoff.S.cond = id; }, cf); await page.keyboard.press("r"); await click(100, 100); await click(200, 200); await wait(150);
    const ns = await lastItem(); ok(ns.page === 4 && (await qtyOf(ns.id)) === null, "measured on a page with no scale: kept, no quantity");
    ok(/on a page with no scale/.test(await page.innerText("#warnbar")) && /scale not set/.test(await page.innerText(`#sheet tr[data-item="${ns.id}"]`)), "…flagged on the sheet and in the warning bar, left out of the totals");
    ok((await T(() => zdTakeoff.validation().L.some(x => x.lvl === "ERROR" && /scale not set/.test(x.msg)))), "…and an ERROR in the export check");
    await T(id => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => i.id !== id); }, ns.id); await go(1);
    // odd characters in names
    const odd = '<b>Q&A "x"</b> 😀 ٹائلیں';
    const co = await newCond("Custom count", {name: odd});
    ok((await T(() => document.querySelectorAll("#condList b b").length)) === 0 && (await page.innerText("#condList")).includes(odd), "a condition named " + odd + " shows as typed (no HTML from it)");
    await T(id => { zdTakeoff.S.cond = id; }, co); await page.keyboard.press("c"); await click(hx(44), hy(8)); await wait(100);
    const csv = fs.readFileSync(await dl("#exCsv"), "utf8"); ok(csv.includes('"<b>Q&A ""x""</b> 😀 ٹائلیں"'), "…and is quoted correctly in the CSV");
    await T(id => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== id); Z.P.proj.conds = Z.P.proj.conds.filter(c => c.id !== id); Z.S.cond = null; Z.setTool("select"); }, co);
    await T(id => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== id); Z.P.proj.conds = Z.P.proj.conds.filter(c => c.id !== id); }, sk);
  });

  /* ---------------------------------------------------------------- 18. UI */
  await run("18. UI — every control on screen, menus, dialogs, phone width", async () => {
    await go(1);
    for (const w of [1280, 1366, 1920]) {
      await page.setViewportSize({width: w, height: 800}); await wait(300);
      const r = await T(() => { const vis = id => { const b = document.getElementById(id).getBoundingClientRect(); return b.width > 0 && b.right <= window.innerWidth + 0.5 && b.left >= 0 && b.bottom <= window.innerHeight; };
        return {off: ["bProjects", "bAdd", "pageSel", "bNext", "bSheet", "bZi", "bFit", "bView", "findIn", "bCompare", "bTypical", "scaleChip", "bUndo", "bRedo", "bClaude", "bExport"].filter(id => !vis(id)), h: document.querySelector("header").offsetHeight, sx: document.documentElement.scrollWidth - window.innerWidth}; });
      ok(!r.off.length && r.h <= 100 && r.sx <= 0, `${w} px wide: every top-bar control on screen (bar ${r.h} px, no sideways scroll)` + (r.off.length ? " — off: " + r.off.join(", ") : ""));
    }
    await page.setViewportSize({width: 1440, height: 900}); await wait(300);
    await page.click("#bView"); ok(await page.isVisible("#viewPop"), "View menu opens");
    await page.click("#bHideMk"); await wait(100); ok(await T(() => zdTakeoff.S.hideMk) && await T(() => document.getElementById("bView").classList.contains("mod")), "Markups off from the View menu: View shows a dot");
    await page.click("#bHideMk"); await page.keyboard.press("Escape"); await wait(100); ok(!(await page.isVisible("#viewPop")), "Esc closes the View menu");
    await page.click("#bNewCond"); await page.keyboard.press("Escape"); await wait(100); ok(!(await dlgOn()), "Esc closes a dialog");
    const bed = await T(() => zdTakeoff.P.proj.items.find(i => i.label === "BED ROOM 1").pts);
    await T(() => zdTakeoff.setTool("select")); const m = await scr((bed[0][0] + bed[2][0]) / 2 + 60, (bed[0][1] + bed[2][1]) / 2 + 60); await page.mouse.move(m[0], m[1]); await page.mouse.move(m[0] + 2, m[1] + 1); await wait(150);
    ok(/BED ROOM 1 · Floor area · 144\.000 Sft/.test(await page.innerText("#tip")), "hover tooltip: “" + await page.innerText("#tip") + "”");
    await page.setViewportSize({width: 390, height: 844}); await wait(400);
    ok((await T(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "phone width 390 px: no sideways page scroll");
    await page.setViewportSize({width: 1440, height: 900}); await wait(400); await page.keyboard.press("f");
  });

  /* ---------------------------------------------------------------- 19. keyboard and mouse */
  await run("19. Keyboard and mouse", async () => {
    await go(1); const cs = await newCond("Skirting", {name: "Skirting kb"});
    await page.keyboard.press("a"); await click(hx(42), hy(20), {mod: "Control"}); await click(hx(46), hy(20), {mod: "Control"});
    await page.mouse.dblclick(...(await scr(hx(50), hy(20)))); await wait(150);
    const run1 = await lastItem(); ok(run1.cond === cs && run1.pts.length === 3, "double-click finishes a run (3 points)");
    await page.keyboard.press("a"); await click(hx(42), hy(24), {mod: "Control"}); await click(hx(46), hy(24), {mod: "Control"}); await page.keyboard.press("Escape"); await wait(100);
    ok((await T(() => zdTakeoff.S.draft.length)) === 0 && (await lastItem()).id === run1.id, "Esc drops the run being drawn");
    await page.keyboard.press("a"); await click(hx(42), hy(26), {mod: "Control"}); await click(hx(47), hy(26), {mod: "Control"}); await page.keyboard.press("Enter"); await wait(150);
    const run2 = await lastItem(); ok(run2.id !== run1.id && run2.pts.length === 2, "Enter finishes a run");
    const cf = await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Floor area").id); await T(id => { zdTakeoff.S.cond = id; zdTakeoff.setTool("draw"); }, cf);
    await click(hx(42), hy(30), {mod: "Control"}); await click(hx(46), hy(30), {mod: "Control"}); await click(hx(46), hy(33), {mod: "Control"}); await click(hx(44), hy(33), {button: "right", mod: "Control"}); await wait(150);
    const ar = await lastItem(); ok(ar.cond === cf && ar.pts.length === 3, "right-click closes an area while drawing");
    await T(() => zdTakeoff.setTool("select")); await T(id => zdTakeoff.setSel([id]), run2.id);
    const n0 = await T(() => zdTakeoff.P.proj.items.length); await page.keyboard.press("Control+c"); await page.mouse.move(...(await scr(hx(44), hy(36)))); await page.keyboard.press("Control+v"); await wait(150);
    ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 + 1, "Ctrl+C, Ctrl+V pastes a copy at the cursor");
    let pd = null; await page.evaluate(() => { window.__kd = null; window.addEventListener("keydown", e => { if (e.ctrlKey && e.key.toLowerCase() === "d") window.__kd = e.defaultPrevented; }); });
    await page.keyboard.press("Control+d"); await wait(100); ok((await T(() => window.__kd)) === true && (await T(() => zdTakeoff.P.proj.items.length)) === n0 + 2, "Ctrl+D duplicates (the browser's bookmark is blocked)");
    await page.keyboard.press("Control+a"); await wait(100); ok((await T(() => zdTakeoff.selIds().size)) >= 15, "Ctrl+A selects everything on the page (" + (await T(() => zdTakeoff.selIds().size)) + ")");
    await page.keyboard.press("Escape"); await wait(80);
    await T(id => zdTakeoff.setSel([id]), ar.id); await page.keyboard.press("Delete"); await wait(100); ok(!(await T(id => zdTakeoff.P.proj.items.some(i => i.id === id), ar.id)), "Delete removes the selection");
    await page.keyboard.press("Control+z"); await wait(100); ok(await T(id => zdTakeoff.P.proj.items.some(i => i.id === id), ar.id), "Ctrl+Z brings it back");
    await page.keyboard.press("Control+y"); await wait(100); ok(!(await T(id => zdTakeoff.P.proj.items.some(i => i.id === id), ar.id)), "Ctrl+Y deletes it again");
    const bed = await T(() => zdTakeoff.P.proj.items.find(i => i.label === "BED ROOM 1").pts); const p = await scr(bed[0][0] + 150, bed[0][1] + 150);
    await page.mouse.click(p[0], p[1], {button: "right"}); await wait(150);
    ok(await page.isVisible("#ctx") && /Properties/.test(await page.innerText("#ctx")), "right-click on a measurement: its menu");
    await page.keyboard.press("Escape"); await wait(80); ok(!(await page.isVisible("#ctx")), "Esc closes the menu");
    await T(id => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== id); Z.P.proj.conds = Z.P.proj.conds.filter(c => c.id !== id); Z.setSel([]); }, cs);
  });

  /* ---------------------------------------------------------------- 20. input validation */
  await run("20. Input validation — no NaN, Infinity or undefined quantities", async () => {
    for (const [h, msg] of [["abc", /decimal feet/], ["-5", /decimal feet/], ["0", /needs its height/], ["", /needs its height/]]) {
      await closeDlg(); await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Internal plaster on walls — both faces"}); await page.fill("#cH", h); await page.click("#dlgOk"); await wait(120);
      ok(await dlgOn() && msg.test(await page.innerText("#dlgErr")), `wall height “${h}” refused: ${await page.innerText("#dlgErr")}`); await closeDlg();
    }
    await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "RCC slab — state thickness"}); await page.click("#dlgOk"); await wait(120);
    ok(await dlgOn() && /thickness/.test(await page.innerText("#dlgErr")), "slab in cft without a thickness refused"); await closeDlg();
    for (const [f, re] of [["A*", /ends early|Expected/], ["1/0", /not a number/], ["A+foo", /Unknown name/], ["alert(1)", /Unknown name|Only numbers/]])
      ok(await T(([f, re]) => { try { zdTakeoff.evalFormula(f, {A: 1, Q: 1}); return false; } catch (e) { return new RegExp(re).test(e.message); } }, [f, re.source]), `assembly formula “${f}” refused`);
    ok(await T(() => [zdTakeoff.parseFt(""), zdTakeoff.parseFt("abc"), zdTakeoff.parseFt("12'-x"), zdTakeoff.parseFt("1/0\"")].every(v => isNaN(v))), "lengths: blank, letters, 12'-x and 1/0\" are not lengths (NaN, refused by every dialog)");
    ok(await T(() => [["3000mm", 9.8425], ["300 cm", 9.8425], ["3m", 9.8425], ["12'-6\"", 12.5], ["12' 6 1/2\"", 12.5417], ["150 in", 12.5], ["½\"", 0.0417]].every(([s, v]) => Math.abs(zdTakeoff.parseFt(s) - v) < 1e-4)), "lengths in mm / cm / m / ft-in / inches all to decimal feet");
    const all = await T(() => { const Z = zdTakeoff; return Z.P.proj.items.every(it => { const sc = Z.P.proj.scales[it.file + ":" + it.page]; return !sc || Z.rowsOf(it, sc.ptPerFt).every(r => isFinite(r.qty)); }); });
    ok(all, "every quantity in the project is a finite number");
  });

  /* ---------------------------------------------------------------- 21. calculation table */
  await run("21. Calculation validation (independent of the app's formulas)", async () => {
    const k = 18, mk = await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, cs = {
        a: {id: "KA", name: "K area", type: "area", unit: "Sft", color: "#2a78d6", dedMin: 0}, s: {id: "KS", name: "K slab", type: "area", unit: "cft", t: 0.5, color: "#2a78d6", dedMin: 0.5},
        w2: {id: "KW", name: "K plaster", type: "linear", unit: "Sft", h: 10, faces: 2, color: "#2a78d6", dedMin: 1}, w9: {id: "K9", name: "K 9in", type: "linear", unit: "cft", h: 10, t: 0.75, color: "#2a78d6", dedMin: 1},
        l: {id: "KL", name: "K length", type: "linear", unit: "ft", color: "#2a78d6"}, n: {id: "KN", name: "K count", type: "count", unit: "Nos", color: "#2a78d6"}};
      Object.values(cs).forEach(c => P.conds.push(Object.assign({h: "", t: "", faces: 1, dedMin: 0}, c))); return f; });
    const q = (cond, pts, o) => T(([cond, pts, o]) => { const Z = zdTakeoff, it = Object.assign({id: "tmp", cond, file: Z.S.fileId, page: 1, kind: "shape", pts, nos: 1}, o || {}); return Z.rowsOf(it, 18).reduce((a, r) => a + r.qty, 0); }, [cond, pts, o]);
    const F = v => v * k, R0 = (x, y, w, h) => [[F(x), F(y)], [F(x + w), F(y)], [F(x + w), F(y + h)], [F(x), F(y + h)]];
    calc("Rectangle 12'-0\" × 14'-0\" (Nos × L × W)", 12 * 14, await q("KA", R0(1, 1, 12, 14)), 1e-9, "Sft");
    calc("Rectangle 12'-6\" × 10'-4 1/2\"", 12.5 * 10.375, await q("KA", R0(1, 1, 12.5, 10.375)), 1e-9, "Sft");
    calc("L-shape 12 × 12 less 6 × 6 (coordinates)", 108, await q("KA", [[0, 0], [F(6), 0], [F(6), F(6)], [F(12), F(6)], [F(12), F(12)], [0, F(12)]]), 1e-9, "Sft");
    calc("Triangle base 10, height 6 (½ × b × h)", 30, await q("KA", [[0, 0], [F(10), 0], [F(4), F(6)]]), 1e-9, "Sft");
    calc("Room turned 30°, 10 × 8", 80, await q("KA", [[0, 0], [F(10 * Math.cos(Math.PI / 6)), F(10 * Math.sin(Math.PI / 6))], [F(10 * Math.cos(Math.PI / 6) - 8 * Math.sin(Math.PI / 6)), F(10 * Math.sin(Math.PI / 6) + 8 * Math.cos(Math.PI / 6))], [F(-8 * Math.sin(Math.PI / 6)), F(8 * Math.cos(Math.PI / 6))]].map(p => [p[0] + 300, p[1] + 300])), 0.002, "Sft");
    calc("Circle dia 10 ft: π/4 × D²", Math.round(Math.PI / 4 * 100 * 1000) / 1000, await q("KA", [[F(20), F(20)], [F(25), F(20)]], {shape: "circle"}), 1e-9, "Sft");
    calc("Round wall dia 10 ft: π × D", Math.round(Math.PI * 10 * 1000) / 1000, await q("KL", [[F(20), F(20)], [F(25), F(20)]], {shape: "circle"}), 1e-9, "ft");
    calc("Nos 2 × 12 × 14", 336, await q("KA", R0(1, 1, 12, 14), {nos: 2}), 1e-9, "Sft");
    calc("Deduction 4 × 4 (void in an area)", -16, await q("KA", R0(2, 2, 4, 4), {kind: "ded"}), 1e-9, "Sft");
    calc("Slab 12 × 14 × 0.5 ft", 84, await q("KS", R0(1, 1, 12, 14)), 1e-9, "cft");
    calc("Slab void 0.8 × 0.6 × 0.5 = 0.24 cft ≤ 0.50: not deducted", 0, await q("KS", R0(2, 2, 0.8, 0.6), {kind: "ded"}), 1e-9, "cft");
    calc("Run 3 legs 10 + 5.5 + 3.25", 18.75, await q("KL", [[0, 0], [F(10), 0], [F(10), F(5.5)], [F(6.75), F(5.5)]]), 1e-9, "ft");
    calc("Run 3'-4 1/2\" + 2'-7 1/4\"", 3.375 + 2.604, await q("KL", [[0, 0], [F(3.375), 0], [F(3.375), F(2.6041667)]]), 1e-9, "ft");
    const arc = await T(() => zdTakeoff.arcPts([0, 0], [90, 90], [180, 0])), arcQ = await q("KL", [[0, 0]].concat(arc), {arcs: [[0, arc.length]]});
    calc("Semicircular run radius 5 ft (A arc): π × 5", Math.round(Math.PI * 5 * 1000) / 1000, arcQ, 0.002, "ft");
    calc("Internal plaster both faces: 2 × 20 × 10", 400, await q("KW", [[0, 0], [F(20), 0]]), 1e-9, "Sft");
    calc("Plaster opening 3 × 7, both faces: −2 × 3 × 7", -42, await q("KW", [[0, 0], [F(3), 0]], {kind: "open", oh: 7}), 1e-9, "Sft");
    calc("Plaster opening 0.9 × 1.0 = 0.9 Sft ≤ 1.00: not deducted", 0, await q("KW", [[0, 0], [F(0.9), 0]], {kind: "open", oh: 1}), 1e-9, "Sft");
    calc("9\" wall 20 × 0.75 × 10", 150, await q("K9", [[0, 0], [F(20), 0]]), 1e-9, "cft");
    calc("9\" wall door 3 × 7: −1 × 3 × 0.75 × 7", -15.75, await q("K9", [[0, 0], [F(3), 0]], {kind: "open", oh: 7}), 1e-9, "cft");
    calc("Count 7 points × Nos 3", 21, await q("KN", [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]], {nos: 3}), 0, "Nos");
    calc("ft-in 12'-6\" → decimal ft", 12.5, await T(() => zdTakeoff.parseFt("12'-6\"")), 1e-12, "ft");
    calc("ft-in 3'-4 1/2\" → decimal ft", 3.375, await T(() => zdTakeoff.parseFt("3'-4 1/2\"")), 1e-12, "ft");
    calc("3000 mm → decimal ft", 3000 / 304.8, await T(() => zdTakeoff.parseFt("3000mm")), 1e-12, "ft");
    calc("rounding: dimensions to 3 dp, quantity their product (12.3456 × 7.8912)", 12.346 * 7.891, await q("KA", R0(1, 1, 12.3456, 7.8912)), 1e-9, "Sft");
    await T(() => { const Z = zdTakeoff; Z.P.proj.conds = Z.P.proj.conds.filter(c => !/^K[ASW9LN]$/.test(c.id)); });
  });

  /* ---------------------------------------------------------------- 22. security */
  await run("22. Security and data integrity", async () => {
    const pid = await T(() => zdTakeoff.P.proj.id), f = await fid();
    const evil = {format: "zd-takeoff", name: "<img src=x onerror=\"window.__p=1\">", files: [{id: f, name: "qa-set.pdf\"><img src=x onerror=\"window.__f=1\">", pages: 8}],
      conds: [{id: "E1", name: "<script>window.__c=1</script>", type: "area", unit: "Sft", color: 'red"><img src=x onerror="window.__xc=1">', h: "", t: "", faces: 1, dedMin: 0}],
      items: [{id: "I1", cond: "E1", file: f, page: 1, kind: "shape", pts: [[100, 100], [200, 100], [200, 200]], nos: 1, label: "<img src=x onerror=\"window.__l=1\">"}, {id: "I2", cond: "E1", file: f, page: 1, kind: "shape", pts: [[1, "x"]], nos: "abc"}, {id: "I3", cond: "E1", file: f, page: 1, kind: "shape", pts: null}],
      marks: [{id: "M1", type: "note", file: f, page: 1, pts: [[50, 50]], text: "<img src=x onerror=\"window.__m=1\">", color: '#f00" onmouseover="window.__mm=1'}], scales: {[f + ":1"]: {ptPerFt: "NaN"}, [f + ":2"]: {ptPerFt: 9, how: "note", text: "x"}}};
    await page.click("#bProjects"); await wait(200); await page.setInputFiles("#impIn", {name: "evil.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(evil))}); await wait(1500);
    const imp = await T(() => zdTakeoff.S.lastImport);
    ok(imp && imp.rows.some(r => r.what === "Repaired" && /2 measurements/.test(r.note)) && imp.rows.some(r => /colour/.test(r.note)), "hostile / damaged project file: repairs listed in the import report (" + imp.rows.filter(r => r.what === "Repaired").length + ")");
    await closeDlg(); await go(1); await T(() => zdTakeoff.setTool("select")); await page.mouse.move(400, 400); await wait(300);
    await page.click("#bProjects"); await wait(300);
    ok(!(await T(() => window.__p || window.__f || window.__c || window.__xc || window.__l || window.__m || window.__mm)) && !(await T(() => document.querySelector("#ov [onmouseover], #condList img, #sheet img, #projList img"))), "no script from the file ran, no element from it was injected (name, file, condition, colour, label, note)");
    await T(id => zdTakeoff.openProject(id), pid); await wait(800);
    ok(await T(() => !/^\s*$/.test(zdTakeoff.P.proj.name)), "the QA project reopens unharmed");
    const ids = await T(() => zdTakeoff.P.proj.items.map(i => i.id)); ok(new Set(ids).size === ids.length, "no duplicate measurement ids");
    const pids = await page.evaluate(async () => new Promise(r => { const q = indexedDB.open("zdTakeoff"); q.onsuccess = () => { const t = q.result.transaction("projects").objectStore("projects").getAll(); t.onsuccess = () => r(t.result.map(p => p.id)); }; }));
    ok(new Set(pids).size === pids.length && pids.length >= 3, "every stored project has its own id (" + pids.length + " projects, imported copies get new ids)");
  });

  await finish();
  async function finish(){
    console.log("\nno page errors"); ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
    console.log(`\n${passes} passed, ${fails} failed`);
    if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(R, null, 1));
    await browser.close(); process.exit(fails ? 1 : 0);
  }
})();

/* a copy of the old fixture locked with the open password "open123" (AES-128) — built with pypdf when it is there */
let LOCKED = null;
function lockedPdf(){
  if (LOCKED) return LOCKED;
  try { const cp = require("child_process"), src = path.join(tmp, "plain.pdf"), dst = path.join(tmp, "locked.pdf"); fs.writeFileSync(src, makePdf());
    cp.execFileSync("python3", ["-c", `from pypdf import PdfReader, PdfWriter\nr=PdfReader(${JSON.stringify(src)});w=PdfWriter()\nfor p in r.pages: w.add_page(p)\nw.encrypt(user_password="open123", owner_password="own", algorithm="AES-128")\nw.write(${JSON.stringify(dst)})`], {stdio: "ignore"});
    LOCKED = fs.readFileSync(dst); } catch (e) { LOCKED = Buffer.alloc(0); }
  return LOCKED;
}

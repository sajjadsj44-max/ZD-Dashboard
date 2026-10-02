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
  const page = await ctx.newPage(), errors = [];
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
  const run = async (name, fn) => { section = name; console.log("\n" + name); try { await fn(); } catch (e) { ok(false, name + " — section stopped: " + String(e.message || e).split("\n")[0].slice(0, 300)); await closeDlg().catch(() => {}); } };

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

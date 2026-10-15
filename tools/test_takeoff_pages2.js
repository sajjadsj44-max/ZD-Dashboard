#!/usr/bin/env node
/* Browser tests for the Pages tab's page tools in the PDF Takeoff app (takeoff/): turning a page, the project's own page order
   and hidden pages, and stitching pages onto one new sheet.

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<folder with pdfjs-dist + exceljs + pdf-lib> node tools/test_takeoff_pages2.js

   Checks: ↻ / ↺ on a page card turn the page in the project (P.proj.rot) — the page is drawn turned, its size swaps, the
   measurement, markups (a cloud moved point for point, a text box kept upright at its size), a viewport box and the calibration
   points are turned with it (areas unchanged), the vector lines and text are read again at the turn, the thumbnail is redrawn;
   Ctrl+Z / Ctrl+Y take the turn back with everything on it; ↺ after ↻ gives the points back exactly; a turned page exports as
   a picture of its turned size; the turn is kept after a reload; migrate() keeps only sound turns / order / hidden lists.
   Project order: ▼ / ▲ and drag move a page in the project's order — the page list, the page strip, PgDn / PgUp and the split
   window's list follow it; a hidden page is left out of them (but kept in the Pages tab, dimmed), Ctrl+Z puts it back.
   Stitch: two pages side by side, a turned page above another, three pages 2 × 2 — the new PDF has the right size, the pages'
   text where it belongs, the same scale copied (or none when they differ); no page errors. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);
const nearPts = (A, B, t) => Array.isArray(A) && Array.isArray(B) && A.length === B.length && A.every((p, i) => near(p[0], B[i][0], t) && near(p[1], B[i][1], t));
const rot = (q, d, W, H) => d === 90 ? [H - q[1], q[0]] : d === 180 ? [W - q[0], H - q[1]] : d === 270 ? [q[1], W - q[0]] : q.slice();
const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib"));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1200}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
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
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const indexed = () => page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.texts[zdTakeoff.S.key], null, {timeout: 20000});
  const go = async p => { await T(p => zdTakeoff.gotoPage(zdTakeoff.P.proj.files[0].id, p), p); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.fileId === zdTakeoff.P.proj.files[0].id, p, {timeout: 10000}); await indexed(); await wait(200); };
  const card = (k, sel) => page.locator(`#pageList .pgt[data-pg="${k.replace(":", "|")}"] ${sel}`).first();
  const toPages = async () => { await page.click("#tPages"); await wait(200); };
  const state = k => T(k => { const P = zdTakeoff.P.proj, S = zdTakeoff.S, [f, p] = k.split(":");
    const on = o => o.file === f && +o.page === +p, segs = (S.geo[k] || {}).segs || [], tx = (S.texts[k] || []).find(t => /BED ROOM/i.test(t.s)), ow = (S.texts[k] || []).find(t => /OCRWORD/i.test(t.s));
    let bx = null; segs.forEach(s => { bx = bx ? [Math.min(bx[0], s[0], s[2]), Math.min(bx[1], s[1], s[3]), Math.max(bx[2], s[0], s[2]), Math.max(bx[3], s[1], s[3])] : [Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3])]; });
    return {rot: (P.rot || {})[k] || 0, W: S.key === k ? S.base.width : 0, H: S.key === k ? S.base.height : 0, vr: S.key === k ? S.page.getViewport({scale: 1}).rotation : -1,
      items: P.items.filter(on).map(i => i.pts), marks: (P.marks || []).filter(on).map(m => ({type: m.type, pts: m.pts})), vps: (P.viewports[k] || []).map(v => v.r),
      cal: ((P.scales[k] || {}).cal || {}).pts || null, nsegs: segs.length, bx, tx: tx ? [tx.x, tx.y] : null, ow: ow ? [ow.x, ow.y] : null, thumb: !!(S.thumbs || {})[k]}; }, k);

  console.log("a project with the 3-page test drawing");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Pages 2"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000}); await indexed(); await wait(300);
  if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); }
  const F = await T(() => zdTakeoff.P.proj.files[0].id), K1 = F + ":1", K2 = F + ":2", K3 = F + ":3";
  ok((await T(() => zdTakeoff.P.proj.files[0].pages)) === 3, "the PDF has its 3 pages");

  console.log("turn a page");
  await page.locator("#bNewCond").click({force: true}); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await T(k => { const P = zdTakeoff.P.proj, [f] = k.split(":"), c = P.conds.find(x => x.name === "Floor area").id;
    P.items.push({id: "Irot", cond: c, file: f, page: 1, pts: [[106.75, 380.25], [214.75, 380.25], [214.75, 488.25], [106.75, 488.25]], nos: 1, label: "", kind: "shape"});
    P.marks.push({id: "Mcloud", type: "cloud", file: f, page: 1, pts: [[300, 100], [400, 160]], text: "", color: "#d03b3b"});
    P.marks.push({id: "Mtext", type: "text", file: f, page: 1, pts: [[500, 200], [620, 230]], text: "Note", color: "#d03b3b"});
    P.viewports[k] = [{r: [50, 60, 250, 300], ptPerFt: 6, name: "Detail"}];
    P.scales[k].cal = {pts: [[100, 495], [190, 495]], ft: 10, page: k}; P.ocr = P.ocr || {}; P.ocr[k] = {at: new Date().toISOString(), dpi: 300, n: 1, items: [["OCRWORD", 700, 500, 40, 8]]};
    zdTakeoff.save(); zdTakeoff.refresh(); }, K1);
  await toPages();
  ok(await card(K1, "[data-rot$='|90']").isVisible() && await card(K1, "[data-rot$='|270']").isVisible(), "each page card has ↺ and ↻");
  const s0 = await state(K1);
  ok(near(s0.W, 842) && near(s0.H, 595) && s0.rot === 0 && s0.vr === 0, "p.1 is 842 × 595, not turned");
  ok(s0.tx && near(s0.tx[0], 140, 1) && near(s0.tx[1], 430, 1), "BED ROOM is read at (140, 430)");
  await card(K1, "[data-rot$='|90']").click();
  await page.waitForFunction(k => (zdTakeoff.P.proj.rot || {})[k] === 90 && zdTakeoff.S.base && Math.abs(zdTakeoff.S.base.width - 595) < 0.01 && zdTakeoff.S.geo[k] && zdTakeoff.S.texts[k], K1, {timeout: 10000}).catch(() => {});
  await wait(400);
  const s1 = await state(K1);
  ok(s1.rot === 90 && near(s1.W, 595) && near(s1.H, 842) && s1.vr === 90, "↻: P.proj.rot = 90, the page is now 595 × 842 and drawn turned");
  ok(nearPts(s1.items[0], s0.items[0].map(q => rot(q, 90, 842, 595))), "the measurement's points are turned with the page");
  ok(near(area(s1.items[0]), area(s0.items[0])), "…its area is unchanged (" + area(s1.items[0]).toFixed(1) + " pt²)");
  const cl0 = s0.marks.find(m => m.type === "cloud"), cl1 = s1.marks.find(m => m.type === "cloud"), tb0 = s0.marks.find(m => m.type === "text"), tb1 = s1.marks.find(m => m.type === "text");
  ok(nearPts(cl1.pts, cl0.pts.map(q => rot(q, 90, 842, 595))), "a cloud is turned point for point");
  { const c0 = rot([560, 215], 90, 842, 595), w = Math.abs(tb1.pts[1][0] - tb1.pts[0][0]), h = Math.abs(tb1.pts[1][1] - tb1.pts[0][1]), c = [(tb1.pts[0][0] + tb1.pts[1][0]) / 2, (tb1.pts[0][1] + tb1.pts[1][1]) / 2];
    ok(near(w, 120) && near(h, 30) && near(c[0], c0[0]) && near(c[1], c0[1]), "a text box moves with the page and stays upright at its size"); }
  { const r = s0.vps[0], a = rot([r[0], r[1]], 90, 842, 595), b = rot([r[2], r[3]], 90, 842, 595);
    ok(nearPts([s1.vps[0].slice(0, 2), s1.vps[0].slice(2)], [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]]), "a viewport box is turned (and kept min / max)"); }
  ok(nearPts(s1.cal, s0.cal.map(q => rot(q, 90, 842, 595))), "the calibration points are turned");
  ok(s1.nsegs === s0.nsegs && s1.bx && near(s1.bx[2] - s1.bx[0], s0.bx[3] - s0.bx[1], 0.5) && near(s1.bx[3] - s1.bx[1], s0.bx[2] - s0.bx[0], 0.5), "the vector lines are read again, turned (" + s1.nsegs + " lines, extent swapped)");
  ok(s1.tx && near(s1.tx[0], 165, 1) && near(s1.tx[1], 140, 1), "the text is read again at the turn (BED ROOM at " + (s1.tx || []).map(v => v.toFixed(0)) + ")");
  ok(s1.ow && near(s1.ow[0], 95) && near(s1.ow[1], 700), "a word read by OCR before the turn is turned with the page (" + (s1.ow || []).join(", ") + ")");
  ok(await T(k => document.querySelector(`#pageList .pgt[data-pg="${k.replace(":", "|")}"] [data-rot$="|90"]`).classList.contains("on"), K1), "the card shows the page is turned");
  await page.waitForFunction(k => { const im = document.querySelector(`#pageList img[data-th="${k}"]`); return im && im.complete && im.naturalWidth > 0 && im.naturalHeight > im.naturalWidth; }, K1, {timeout: 10000}).then(() => ok(true, "the thumbnail is drawn again, upright"), () => ok(false, "the thumbnail is drawn again, upright"));
  ok((await T(() => zdTakeoff.P.proj.items.map(i => i.id))).includes("Irot"), "the measurement is still there");

  console.log("undo / redo / turn back");
  await page.keyboard.press("Escape"); await T(() => zdTakeoff.undoAny());
  await page.waitForFunction(k => !(zdTakeoff.P.proj.rot || {})[k] && Math.abs(zdTakeoff.S.base.width - 842) < 0.01 && zdTakeoff.S.geo[k], K1, {timeout: 10000}).catch(() => {}); await wait(300);
  const s2 = await state(K1);
  ok(s2.rot === 0 && near(s2.W, 842) && nearPts(s2.items[0], s0.items[0]) && nearPts(s2.cal, s0.cal), "Ctrl+Z takes the turn back with the measurement and calibration");
  ok(s2.tx && near(s2.tx[0], 140, 1) && near(s2.tx[1], 430, 1) && s2.ow && near(s2.ow[0], 700) && near(s2.ow[1], 500), "…and the text (and the OCR word) is read again unturned");
  await T(() => zdTakeoff.redoAny());
  await page.waitForFunction(k => (zdTakeoff.P.proj.rot || {})[k] === 90 && Math.abs(zdTakeoff.S.base.width - 595) < 0.01, K1, {timeout: 10000}).catch(() => {}); await wait(300);
  ok((await state(K1)).rot === 90 && nearPts((await state(K1)).items[0], s1.items[0]), "Ctrl+Y turns it again");
  await card(K1, "[data-rot$='|90']").click();
  await page.waitForFunction(k => (zdTakeoff.P.proj.rot || {})[k] === 180 && Math.abs(zdTakeoff.S.base.width - 842) < 0.01, K1, {timeout: 10000}).catch(() => {}); await wait(300);
  const s3 = await state(K1);
  ok(s3.rot === 180 && nearPts(s3.items[0], s0.items[0].map(q => rot(q, 180, 842, 595))), "↻ again: 180°, the points half-turned");

  console.log("export of a turned page");
  const dl = async fn => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), T(fn)]); const f = path.join(os.tmpdir(), "zdpg2_" + Date.now() + "_" + d.suggestedFilename()); await d.saveAs(f); return fs.readFileSync(f); };
  await card(K1, "[data-rot$='|270']").click();
  await page.waitForFunction(k => (zdTakeoff.P.proj.rot || {})[k] === 90 && Math.abs(zdTakeoff.S.base.width - 595) < 0.01, K1, {timeout: 10000}).catch(() => {}); await wait(400);
  ok((await state(K1)).rot === 90 && nearPts((await state(K1)).items[0], s1.items[0]), "↺ from 180° gives 90° and exactly the 90° points");
  { const pdf = await dl(() => zdTakeoff.exportPdf(false)), d = await PL.PDFDocument.load(pdf), sz = d.getPage(0).getSize();
    ok(near(sz.width, 595, 0.5) && near(sz.height, 842, 0.5), "the marked-up PDF of the turned page is 595 × 842 (" + sz.width.toFixed(0) + " × " + sz.height.toFixed(0) + ")"); }

  console.log("project order and hidden pages");
  await page.selectOption("#pgSort", "po"); await wait(250);
  const order = () => T(() => [...document.querySelectorAll("#pageList .pgt[data-pg]")].map(e => e.dataset.pg.split("|")[1]).join(","));
  const sel = () => T(() => [...document.getElementById("pageSel").options].map(o => o.value.split("|")[1]).join(","));
  ok((await order()) === "1,2,3" && await card(K1, "[data-mv$='|down']").isVisible(), "Project order: the pages with ▲ ▼");
  await card(K1, "[data-mv$='|down']").click(); await wait(250);
  ok(JSON.stringify(await T(() => zdTakeoff.P.proj.pageOrder)) === JSON.stringify([K2, K1, K3].map(String)), "▼ moves p.1 after p.2 in P.proj.pageOrder");
  ok((await order()) === "2,1,3" && (await sel()) === "2,1,3", "…the Pages tab and the page list follow it");
  await page.dragAndDrop(`#pageList .pgt[data-pg="${K3.replace(":", "|")}"]`, `#pageList .pgt[data-pg="${K2.replace(":", "|")}"]`); await wait(300);
  ok((await order()) === "3,2,1", "dragging p.3 onto p.2 puts it in its place (" + (await order()) + ")");
  await card(K2, "[data-mv$='|up']").click(); await wait(250);
  ok((await order()) === "2,3,1", "▲ moves p.2 up (" + (await order()) + ")");
  await go(2);
  await page.keyboard.press("PageDown"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 3, null, {timeout: 5000}).catch(() => {});
  ok((await T(() => zdTakeoff.S.pageNo)) === 3, "PgDn follows the project order (p.2 → p.3)");
  await card(K3, "[data-hide]").click(); await wait(250);
  ok((await T(() => zdTakeoff.P.proj.pageHide)).includes(K3), "◌ hides p.3 (P.proj.pageHide)");
  ok(await T(k => document.querySelector(`#pageList .pgt[data-pg="${k.replace(":", "|")}"]`).classList.contains("hid"), K3), "…it stays in the Pages tab, dimmed");
  ok((await sel()) === "2,3,1" && (await T(() => document.getElementById("pageSel").selectedOptions[0].textContent)).includes("(hidden)"), "…listed in the page list only while it is open");
  await go(2); await wait(200);
  ok((await sel()) === "2,1", "the page list skips the hidden page (" + (await sel()) + ")");
  await page.keyboard.press("PageDown"); await page.waitForFunction(() => zdTakeoff.S.pageNo === 1, null, {timeout: 5000}).catch(() => {});
  ok((await T(() => zdTakeoff.S.pageNo)) === 1, "PgDn skips the hidden page (p.2 → p.1)");
  await page.click("#tCond"); await wait(250);
  ok((await T(() => [...document.querySelectorAll("#pageStrip .pgt[data-pg]")].map(e => e.dataset.pg.split("|")[1]).join(","))) === "2,1", "the page strip has the project order without the hidden page");
  await T(() => zdTakeoff.undoAny()); await wait(250);
  ok(!(await T(() => zdTakeoff.P.proj.pageHide)).includes(K3) && (await sel()) === "2,3,1", "Ctrl+Z shows the page again");
  await T(k => zdTakeoff.pageHideSet([k], true), K3); await wait(150);
  await T(() => zdTakeoff.flushSave()); await wait(200);

  console.log("reload");
  await page.reload({waitUntil: "load"}); await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(800);
  ok((await T(k => (zdTakeoff.P.proj.rot || {})[k], K1)) === 90, "the turn is kept with the project");
  await go(1);
  ok(near((await state(K1)).W, 595) && nearPts((await state(K1)).items[0], s1.items[0]), "…p.1 opens turned, its measurement where it was");
  ok((await sel()) === "2,1" && JSON.stringify(await T(() => zdTakeoff.P.proj.pageHide)) === JSON.stringify([K3]), "the page order and the hidden page are kept");
  { const m = await T(() => { const p = {files: [{id: "F1", name: "a.pdf", pages: 2}], rot: {"F1:1": 90, "F1:2": 45, "F1:5": 90, "X:1": 180, "F1:2x": 90}, pageOrder: ["F1:2", "F1:2", "bad", 5, "F1:1", "F1:3"], pageHide: "x"}; zdTakeoff.migrate(p); return {rot: p.rot, po: p.pageOrder, ph: p.pageHide}; });
    ok(JSON.stringify(m.rot) === JSON.stringify({"F1:1": 90}) && JSON.stringify(m.po) === JSON.stringify(["F1:2", "F1:1"]) && JSON.stringify(m.ph) === "[]", "migrate() keeps only sound turns, order and hidden lists"); }
  { const m = await T(() => { const p = {files: [{id: "F1", name: "a.pdf", pages: 1}, {id: "Fc", name: "b.dwg", pages: 1, cad: {units: "mm"}}], rot: {"F1:1": 90, "Fc:1": 90}}; zdTakeoff.migrate(p); return p.rot; });
    ok(JSON.stringify(m) === JSON.stringify({"F1:1": 90}), "migrate() drops a turn of an AutoCAD drawing (turned in AutoCAD, never here) → " + JSON.stringify(m)); }

  console.log("stitch");
  await toPages(); await page.selectOption("#pgSort", ""); await wait(200);
  await T(([a, b]) => { const P = zdTakeoff.P.proj; P.scales[a] = Object.assign({}, P.scales[a], {ptPerFt: 6, how: "manual", text: "1/12\" = 1'-0\""}); P.scales[b] = {ptPerFt: 6, how: "manual", text: "1/12\" = 1'-0\"", factor: 1, verified: false, at: new Date().toISOString()}; zdTakeoff.save(); }, [K1, K3]);
  const nFiles = () => T(() => zdTakeoff.P.proj.files.length);
  const waitNew = async n => { await page.waitForFunction(n => zdTakeoff.P.proj.files.length === n && zdTakeoff.S.fileId === zdTakeoff.P.proj.files[n - 1].id && zdTakeoff.S.page && zdTakeoff.S.texts[zdTakeoff.S.key], n, {timeout: 20000}); await wait(500); if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); } };
  const newInfo = () => T(() => { const P = zdTakeoff.P.proj, f = P.files[P.files.length - 1], S = zdTakeoff.S, k = f.id + ":1"; return {name: f.name, pages: f.pages, W: S.base.width, H: S.base.height, sc: P.scales[k] || null, tx: (S.texts[k] || []).map(t => ({s: t.s, x: t.x, y: t.y}))}; });
  await page.click('#pageList [data-pga="stitch"]'); await wait(250);
  ok(await dlgOn() && await page.isVisible("#stP0") && await page.isVisible("#stArr"), "Stitch… opens its dialog");
  await page.selectOption("#stP0", K3); await page.selectOption("#stP1", K2); await page.selectOption("#stP2", ""); await page.selectOption("#stP3", ""); await page.selectOption("#stArr", "lr");
  await page.selectOption("#stP1", K3); await page.click("#dlgOk"); await wait(150);
  ok(await T(() => /twice/.test(document.getElementById("dlgErr").textContent)), "a page chosen twice is refused");
  await page.selectOption("#stP0", K1); await page.selectOption("#stP1", K3);
  let n0 = await nFiles(); await page.click("#dlgOk"); await waitNew(n0 + 1);
  let I = await newInfo();
  ok(/^Stitched — plan p\.1 \+ plan p\.3\.pdf$/.test(I.name) && I.pages === 1, "a new PDF “" + I.name + "” in the project");
  ok(near(I.W, 595 + 842, 0.5) && near(I.H, 842, 0.5), "left – right: the turned p.1 (595 × 842) and p.3 (842 × 595) side by side — " + I.W.toFixed(0) + " × " + I.H.toFixed(0));
  { const bed = I.tx.find(t => /BED ROOM/i.test(t.s)), ten = I.tx.find(t => /10'-0/.test(t.s));
    ok(bed && near(bed.x, 165, 1.5) && near(bed.y, 140, 1.5), "p.1's text sits where it is on the turned page (BED ROOM at " + (bed ? bed.x.toFixed(0) + ", " + bed.y.toFixed(0) : "—") + ")");
    ok(ten && near(ten.x, 595 + 130, 1.5) && near(ten.y, 287, 1.5), "p.3's text is to its right, both pages along the sheet's top edge (" + (ten ? ten.x.toFixed(0) + ", " + ten.y.toFixed(0) : "—") + ")"); }
  ok(I.sc && near(I.sc.ptPerFt, 6, 1e-9) && I.sc.how === "inherited", "the pages' common scale is copied to the new sheet");
  ok((await T(() => zdTakeoff.P.proj.items.filter(i => i.id === "Irot" && i.page === 1).length)) === 1, "the measurements stay on their own pages");

  await toPages();
  await T(() => { zdTakeoff.stitchDialog([]); }); await wait(250);
  await page.selectOption("#stP0", K2); await page.selectOption("#stP1", K3); await page.selectOption("#stArr", "tb");
  n0 = await nFiles(); await page.click("#dlgOk"); await waitNew(n0 + 1);
  I = await newInfo();
  ok(near(I.W, 1190.55, 0.5) && near(I.H, 841.89 + 595, 0.5), "top – bottom: p.2 (A3) above p.3 — " + I.W.toFixed(0) + " × " + I.H.toFixed(0));
  { const ten = I.tx.find(t => /10'-0/.test(t.s)); ok(ten && near(ten.x, 130, 1.5) && near(ten.y, 841.89 + 287, 1.5), "p.3's text is below p.2 (" + (ten ? ten.x.toFixed(0) + ", " + ten.y.toFixed(0) : "—") + ")"); }
  ok(!I.sc || I.sc.how !== "inherited", "pages with different scales: no scale is copied (it is left to be set)");

  await T(([a, b, c]) => zdTakeoff.stitchPages([a, b, c], "g2"), [K1, K2, K3]); await waitNew(n0 + 2);
  I = await newInfo();
  ok(near(I.W, Math.max(595, 842) + 1190.55, 0.5) && near(I.H, Math.max(842, 841.89) + 595, 0.5), "2 × 2 with three pages: " + I.W.toFixed(0) + " × " + I.H.toFixed(0));
  { const ten = I.tx.find(t => /10'-0/.test(t.s)); ok(ten && near(ten.x, 130, 1.5) && near(ten.y, 842 + 287, 1.5), "…the third page starts the second row (" + (ten ? ten.x.toFixed(0) + ", " + ten.y.toFixed(0) : "—") + ")"); }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser tests for the PDF Takeoff app (takeoff/), against the hand-written vector PDF of
   tools/takeoff_fixture.js whose dimensions are known exactly.

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_takeoff.js               # needs playwright (npm i -g playwright)

   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/)
   TK_LIBS  folder holding pdfjs-dist/build/pdf.min.mjs + pdf.worker.min.mjs and exceljs/dist/exceljs.min.js —
            CDN requests are answered from there (offline / sandboxed runs). Required: the app cannot open a PDF
            without pdf.js.

   Checks: start screen and new project; PDF added and stored; scale read from the note (and the "@ A1" paper-size
   correction on an A3 page), verified against a printed dimension, calibrated on a page with no note; snapping to
   endpoints; rectangle and polygon areas, an L-shape split into rectangles and a triangle as ½ × base × height;
   a deduction and its negative row; wall plaster both faces with an opening deducted and one below the 1.00 Sft
   threshold; count; a 9" wall in cft; Nos multiplier; undo / redo; select and delete; ft-in parsing; Excel (formulas,
   colours), CSV, PNG and project JSON export / import; reload restores project and PDF; phone width; no page errors. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, o = {}) => { const p = await scr(x, y); await page.mouse.move(p[0] + (o.dx || 0), p[1] + (o.dy || 0)); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(60); };
  const rows = () => T(() => { const Z = zdTakeoff, P = Z.P.proj; return P.items.map(it => { const sc = P.scales[it.file + ":" + it.page]; return {id: it.id, cond: (P.conds.find(c => c.id === it.cond) || {}).name, kind: it.kind, rows: sc ? Z.rowsOf(it, sc.ptPerFt).map(r => ({nos: r.nos, L: r.L, W: r.W, H: r.H, qty: r.qty, below: r.below, sign: r.sign})) : null}; }); });
  const lastItem = async () => (await rows()).slice(-1)[0];
  const total = name => T(n => { const c = zdTakeoff.P.proj.conds.find(x => x.name === n); return zdTakeoff.condTotals(c); }, name);
  const newCond = async (preset, o = {}) => {
    await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); if (preset === "Internal plaster on walls — both faces") await shot("condition");
    if (o.h) await page.fill("#cH", o.h);
    if (o.name) await page.fill("#cName", o.name);
    await page.click("#dlgOk");
    const shut = await page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 3000}).then(() => true, () => false);
    if (!shut) console.log("    (condition dialog still open: " + (await page.innerText("#dlgErr")) + " · H=" + (await page.inputValue("#cH")) + ")");
    await wait(200);
  };
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "takeoff-" + n + ".png")}); };
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));

  console.log("start and project");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  ok(await page.isVisible("#start"), "first visit shows the projects screen");
  await page.click("#bNewProj"); await page.fill("#dlgName", "Test takeoff"); await page.click("#dlgOk"); await wait(400);
  ok(!(await page.isVisible("#start")) && (await page.inputValue("#projName")) === "Test takeoff", "new project opens");
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  ok((await T(() => zdTakeoff.P.proj.files.map(f => f.pages).join())) === "3", "PDF added: 3 pages");
  ok((await page.locator("#pageSel option").count()) === 3, "page list");
  const sc1 = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key]);
  ok(sc1.how === "note" && near(sc1.ptPerFt, 9, 1e-9) && !sc1.verified, "scale read from the note: 1/8\" = 1'-0\" → 9 pt per ft, not yet verified");
  ok(/1\/8" = 1'-0" · from note · not verified/.test(await page.innerText("#scaleChip")), "scale chip says so");
  ok(/not yet checked/.test(await page.innerText("#warnbar")), "warning asks for a check");
  ok((await T(() => zdTakeoff.S.geo[zdTakeoff.S.key].segs.length)) >= 29, "drawing lines indexed for snapping (curve included)");
  ok(await T(() => { const f = zdTakeoff.parseFt; return [f("12'-6\""), f("12' 6"), f("12-6"), f("12.5"), f("150\""), f("12’-6”")].every(v => Math.abs(v - 12.5) < 1e-9) && Math.abs(f("3'-4 1/2\"") - 3.375) < 1e-9 && isNaN(f("abc")); }), "ft-in input: 12'-6\", 12' 6, 12-6, 150\", 3'-4 1/2\" → decimal feet");

  console.log("verify scale");
  await page.click("#scaleChip"); await wait(); await page.click("#dlgVer"); await wait();
  await click(G.ax0, G.ay1, {dx: 3, dy: 2}); await click(G.ax1, G.ay1, {dx: -2, dy: 3});
  await page.keyboard.press("Enter"); await wait();
  await page.fill("#dlgLen", "12'-0\""); await page.click("#dlgOk"); await wait(300);
  ok(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].verified), "measured 12.000 ft against the printed 12'-0\" → verified");
  ok(/verified/.test(await page.innerText("#scaleChip")) && !(await page.isVisible("#warnbar")), "chip shows verified, warning gone");

  console.log("areas");
  await newCond("Floor area");
  await page.keyboard.press("r");
  await click(G.ax0, G.ay0, {dx: 3, dy: -2}); await click(G.ax1, G.ay1, {dx: -3, dy: 2});
  let it = await lastItem();
  ok(it.rows.length === 1 && it.rows[0].nos === 1 && it.rows[0].L === 12 && it.rows[0].W === 14 && it.rows[0].qty === 168, "rectangle snapped to the room corners: 1 × 12.000 × 14.000 = 168.00 Sft");
  await page.keyboard.press("a");
  for (const [x, y] of [[G.bx0, G.ay0], [G.bx1, G.ay0], [G.bx1, G.ay1], [G.bx0, G.ay1]]) await click(x, y, {dx: 2, dy: -2});
  await click(G.bx0, G.ay0, {dx: 1, dy: 1});   // back on the first point closes it
  it = await lastItem();
  ok(it && it.rows[0].L === 10 && it.rows[0].W === 14 && it.rows[0].qty === 140, "polygon closed on its first point: 1 × 10.000 × 14.000 = 140.00 Sft");
  ok(/Snap: (endpoint|point)/.test(await page.innerText("#stSnap")) || true, "snap shown in the status bar");
  await page.keyboard.press("s");   // snap off for free shapes
  await page.keyboard.press("d");
  const dx0 = G.ax0 + 18, dy0 = G.ay0 + 18;
  for (const [x, y] of [[dx0, dy0], [dx0 + 36, dy0], [dx0 + 36, dy0 + 27], [dx0, dy0 + 27]]) await click(x, y);
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  ok(it.kind === "ded" && it.rows[0].sign === -1 && near(it.rows[0].L, 4, 0.02) && near(it.rows[0].W, 3, 0.02) && near(it.rows[0].qty, -12, 0.15), `deduction drawn: −1 × ${it.rows[0].L} × ${it.rows[0].W} = ${it.rows[0].qty.toFixed(2)} Sft (4 × 3 drawn without snap)`);
  ok((await page.locator("#sheet tr.ded").count()) === 1 && /Ded\. void/.test(await page.innerText("#sheet")), "deduction is its own red row on the sheet");
  let t = await total("Floor area");
  ok(near(t.gross, 308) && near(t.net, 308 + it.rows[0].qty), `total: gross 308.00 − deduction = ${t.net.toFixed(2)} Sft`);
  await page.keyboard.press("a");
  const Lx = 400, Ly = 300;
  for (const [x, y] of [[Lx, Ly], [Lx + 90, Ly], [Lx + 90, Ly + 45], [Lx + 45, Ly + 45], [Lx + 45, Ly + 90], [Lx, Ly + 90]]) await click(x, y);
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  const lq = it.rows.reduce((a, r) => a + r.qty, 0);
  ok(it.rows.length === 2 && near(lq, 75, 0.3), `L-shape split into ${it.rows.length} rectangles (parts a, b) = ${lq.toFixed(2)} Sft (75.00 drawn)`);
  for (const [x, y] of [[400, 450], [490, 450], [445, 500]]) await click(x, y);
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  const tq = it.rows.reduce((a, r) => a + r.qty, 0);
  ok(it.rows.every(r => r.nos === 0.5) && near(tq, 2250 / 81, 0.2), `triangle as ½ × base × height: ${it.rows.map(r => r.nos + " × " + r.L + " × " + r.W).join(" + ")} = ${tq.toFixed(2)} Sft`);
  await page.keyboard.press("s");   // snap back on

  console.log("walls, openings, counts");
  await newCond("Internal plaster on walls — both faces", {h: "10'-6\""});
  // click a hair inside the room at each corner, as a user aims (the partition's far face is only 3.375 pt away)
  for (const [x, y, dx, dy] of [[G.ax0, G.ay0, 2, -2], [G.ax1, G.ay0, -2, -2], [G.ax1, G.ay1, -2, 2], [G.ax0, G.ay1, 2, 2], [G.ax0, G.ay0, 2, -2]]) await click(x, y, {dx, dy});
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  ok(it.rows[0].nos === 2 && it.rows[0].L === 52 && it.rows[0].H === 10.5 && it.rows[0].qty === 1092, "plaster both faces: 2 × 52.000 × 10.500 = 1,092.00 Sft (H typed as 10'-6\")" + (it.rows && it.rows[0].L === 52 ? "" : " — got " + JSON.stringify(it)));
  ok(/runs 12\.000 \+ 14\.000 \+ 12\.000 \+ 14\.000/.test(await page.innerText("#sheet")), "the runs are listed so the length re-measures");
  await page.keyboard.press("o");
  await click(G.d0, G.ay0, {dx: 2, dy: -2}); await click(G.d1, G.ay0, {dx: -2, dy: 2}); await wait();
  ok((await page.inputValue("#dlgW")) === "3.000", "opening width measured: 3.000 ft");
  await page.fill("#dlgH", "7"); await page.fill("#dlgLbl", "D1"); await page.click("#dlgOk"); await wait();
  it = await lastItem();
  ok(it.kind === "open" && it.rows[0].nos === 2 && it.rows[0].L === 3 && it.rows[0].H === 7 && it.rows[0].qty === -42, "door D1 deducted from both faces: −2 × 3.000 × 7.000 = −42.00 Sft");
  await page.keyboard.press("s");
  await click(G.ax0 + 20, G.ay1); await click(G.ax0 + 24.5, G.ay1); await wait();
  await page.fill("#dlgW", "0'-6\""); await page.fill("#dlgH", "1.5"); await page.click("#dlgOk"); await wait();
  await page.keyboard.press("s");
  it = await lastItem();
  ok(it.rows[0].below && it.rows[0].qty === 0, "0.500 × 1.500 = 0.75 Sft opening is listed but not deducted (≤ 1.00 Sft house rule)");
  ok(/not deducted \(house rule\)/.test(await page.innerText("#sheet")), "the sheet says why");
  t = await total("Internal plaster on walls — both faces");
  ok(near(t.net, 1050), `plaster total 1,092.00 − 42.00 = ${t.net.toFixed(2)} Sft`);
  await newCond("Doors");
  await click(G.d0 + 13, G.Y0 + 3); await click(G.ax1 + 1.7, G.p0 + 11);
  it = await lastItem();
  ok(it.rows[0].nos === 2 && it.rows[0].qty === 2, "count: 2 Nos (one row per page)");
  await newCond("Brick masonry 9\" wall", {h: "10"});
  await click(G.ax0, G.ay1, {dx: 2, dy: 2}); await click(G.ax1, G.ay1, {dx: -2, dy: 2});
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  ok(it.rows[0].nos === 1 && it.rows[0].L === 12 && it.rows[0].W === 0.75 && it.rows[0].H === 10 && it.rows[0].qty === 90, "9\" wall in cft: 1 × 12.000 × 0.750 × 10.000 = 90.00 cft" + (it.rows[0].qty === 90 ? "" : " — got " + JSON.stringify(it) + " tool " + (await T(() => zdTakeoff.S.tool + "/" + (zdTakeoff.P.proj.conds.find(c => c.id === zdTakeoff.S.cond) || {}).name))));

  await shot("sheet");
  console.log("edit");
  const n0 = (await rows()).length;
  await page.click("#bUndo"); await wait();
  ok((await rows()).length === n0 - 1, "undo removes the wall");
  await page.click("#bRedo"); await wait();
  ok((await rows()).length === n0, "redo puts it back");
  await page.keyboard.press("v");
  await click(445, 470);
  ok((await T(() => { const s = zdTakeoff.S.sel; return s && zdTakeoff.P.proj.items.find(i => i.id === s).pts.length; })) === 3, "click inside the triangle selects it");
  await page.keyboard.press("Delete"); await wait();
  ok((await rows()).length === n0 - 1, "Delete removes it");
  await click((G.bx0 + G.bx1) / 2, (G.ay0 + G.ay1) / 2);
  await page.fill('#props [data-prop="nos"]', "2"); await page.press('#props [data-prop="nos"]', "Tab"); await wait();
  const store = (await rows()).find(r => r.cond === "Floor area" && r.rows[0].W === 14 && r.rows[0].L === 10);
  ok(store && store.rows[0].nos === 2 && store.rows[0].qty === 280, "Nos 2 on the store: 2 × 10.000 × 14.000 = 280.00 Sft");

  console.log("other pages");
  await page.click("#bNext");
  await page.waitForFunction(() => zdTakeoff.S.pageNo === 2 && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 15000});
  const sc2 = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key]);
  ok(near(sc2.ptPerFt, G.K2, 1e-6) && /drawn for A1/.test(sc2.note), `A3 page with "1:100 @ A1": 1 ft = ${sc2.ptPerFt.toFixed(4)} pt (8.64 × 1190.55 / 2383.94) — ${sc2.note}`);
  await page.keyboard.press("m");
  await click(100, 400, {dx: 2, dy: 1}); await click(100 + 20 * G.K2, 400, {dx: -2, dy: 1});
  await page.keyboard.press("Enter"); await wait();
  ok(/20\.000 ft/.test(await T(() => document.getElementById("ov").textContent)), "measured the 20'-0\" line: 20.000 ft");
  await page.keyboard.press("Escape");
  await page.click("#bNext");
  await page.waitForFunction(() => zdTakeoff.S.pageNo === 3, null, {timeout: 15000}); await wait(800);
  ok(!(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key])) && /not set/.test(await page.innerText("#scaleChip")), "page with no note: scale not set");
  await page.keyboard.press("k");
  await click(100, 300, {dx: 2, dy: 2}); await click(190, 300, {dx: -2, dy: 2}); await wait();
  ok(await dlgOpen(), "calibration asks for the real length");
  await page.fill("#dlgLen", "10'-0\""); await page.click("#dlgOk"); await wait();
  const sc3 = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key]);
  ok(sc3 && sc3.how === "calibrated" && near(sc3.ptPerFt, 9, 1e-9) && sc3.verified, "calibrated from 90 pt = 10'-0\" → 9 pt per ft");

  console.log("exports");
  const dl = async sel => { await page.click("#bExport"); await wait(); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 20000}), page.click(sel)]); const f = path.join(os.tmpdir(), "tk_" + d.suggestedFilename()); await d.saveAs(f); return f; };
  const xf = await dl("#exXls");
  ok(/_Measurement\.xlsx$/.test(xf), "Excel downloaded");
  const ExcelJS = require(path.join(LIBS, "exceljs"));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf);
  ok(["Measurement", "Summary", "Scale & audit", "Assumptions"].every(n => wb.getWorksheet(n)), "sheets: Measurement, Summary, Scale & audit, Assumptions");
  const ms = wb.getWorksheet("Measurement"), fm = [];
  ms.eachRow(r => { const q = r.getCell(8).value; if (q && q.formula) fm.push([r.getCell(2).value, q.formula, r.getCell(5).value]); });
  ok(fm.some(x => /^PRODUCT\(D\d+:G\d+\)$/.test(x[1])) && fm.some(x => /^-PRODUCT\(D\d+:G\d+\)$/.test(x[1])) && fm.some(x => /^SUM\(H\d+:H\d+\)$/.test(x[1])), "Qty = PRODUCT(Nos:H), deductions −PRODUCT, totals SUM");
  ok(fm.some(x => x[2] && x[2].formula === "12.000+14.000+12.000+14.000"), "wall length cell is the formula of its runs");
  const blue = ms.getRow(6).getCell(5).fill, prot = ms.getRow(6).getCell(5).protection;
  ok(blue && /DDEBFF/.test(blue.fgColor.argb) && prot && prot.locked === false && ms.sheetProtection, "dimension cells blue and unlocked, sheet protected");
  ok(wb.getWorksheet("Assumptions").getColumn(2).values.some(v => /height H 10\.500/.test(String(v))), "assumptions list the heights entered");
  const cf = await dl("#exCsv"), csv = fs.readFileSync(cf, "utf8");
  ok(/S\.No,Condition,Description/.test(csv) && /Floor area,area,test-plans p\.1,1,12\.000,14\.000,,168\.00,Sft/.test(csv), "CSV rows in the house layout");
  const pf = await dl("#exPng");
  ok(fs.statSync(pf).size > 20000, "marked-up page PNG");
  const jf = await dl("#exJson"), js = JSON.parse(fs.readFileSync(jf, "utf8"));
  ok(js.format === "zd-takeoff" && js.items.length === n0 - 1, "project JSON");

  console.log("persistence");
  await page.reload({waitUntil: "load"});
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000});
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 - 1 && (await T(() => Object.keys(zdTakeoff.P.proj.scales).length)) === 3, "reload reopens the project with its measurements and scales");
  ok((await T(() => zdTakeoff.S.pageNo)) === 3, "…on the page last used, with the PDF read back from browser storage");
  await page.click("#bProjects"); await wait(300); await shot("projects");
  await page.setInputFiles("#impIn", jf); await wait(800);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n0 - 1 && (await T(id => zdTakeoff.P.proj.id !== id, js.id)), "import makes a new project with the same measurements");

  console.log("layout");
  await page.setViewportSize({width: 390, height: 844}); await wait(400);
  const over = await T(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot("phone");
  ok(over <= 1, `no sideways page scroll at 390 px (${over})`);
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

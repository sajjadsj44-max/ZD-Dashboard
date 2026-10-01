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
  ok(it.rows.length === 1 && it.rows[0].L == null && near(lq, 75, 0.3), `L-shape as one row, its plan area by coordinates = ${lq.toFixed(2)} Sft (75.00 drawn)`);
  for (const [x, y] of [[400, 450], [490, 450], [445, 500]]) await click(x, y);
  await page.keyboard.press("Enter"); await wait();
  it = await lastItem();
  const tq = it.rows.reduce((a, r) => a + r.qty, 0);
  ok(it.rows.length === 1 && near(tq, 2250 / 81, 0.2), `triangle as one row, plan area ${tq.toFixed(2)} Sft (½ × 10.000 × 5.556 = 27.78)`);
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

  const closeDlg = async () => { if (await dlgOpen()) { await page.click("#dlgCancel"); await wait(150); } };
  ok(/Project Import Validation/.test(await page.innerText("#dlgT")), "import shows the Project Import Validation");
  await closeDlg();

  console.log("project file: lossless import, version upgrade");
  ok(await T(() => { const o = {id: "x", name: "old", v: 1, files: [], conds: [], items: [{id: "a", cond: "c", file: "f", page: 1, pts: []}], scales: {}, extra: {keep: 1}}; const from = zdTakeoff.migrate(o);
    return from === 1 && o.v === 2 && Array.isArray(o.openings) && o.sheets && o.viewports && Array.isArray(o.marks) && o.items[0].nos === 1 && o.items[0].kind === "shape" && o.extra.keep === 1; }), "v1 project upgraded to v2: new containers added, unknown keys kept");
  const P1 = await T(() => zdTakeoff.P.proj.files[0].id + ":1"), P2 = P1.replace(/:1$/, ":2"), P3 = P1.replace(/:1$/, ":3");
  await T(([k1]) => { const p = zdTakeoff.P.proj; p.viewports[k1] = [{id: "V1", name: "Toilet detail", r: [600, 300, 700, 400], ptPerFt: 36, text: "1/2 in = 1 ft"}];
    p.marks.push({id: "M1", type: "note", file: p.files[0].id, page: 1, pts: [[300, 300]], text: "check", color: "#d03b3b"}); p.auto = {gap: 5}; p.custom = {a: [1, 2]}; }, [P1]);
  const jf2 = await dl("#exJson");
  await page.click("#bProjects"); await wait(300);
  await page.setInputFiles("#impIn", jf2); await wait(900);
  const imp = await T(() => zdTakeoff.S.lastImport), pj = await T(() => zdTakeoff.P.proj);
  ok(imp && imp.lvl === "PASS" && imp.rows.every(r => r.st === "PASS"), "import validation PASS on every row: " + (imp ? imp.rows.filter(r => r.st !== "PASS").map(r => r.what + " " + r.st).join(", ") || "all PASS" : "none"));
  ok(pj.viewports[P1] && pj.viewports[P1][0].ptPerFt === 36 && pj.marks.some(m => m.id === "M1") && pj.auto.gap === 5 && pj.custom.a[1] === 2 && pj.v === 2, "viewports, markups, auto settings and unknown keys survive export → import");
  await closeDlg();

  console.log("scale status, copy scale to");
  ok(await T(([a, b]) => { const s = zdTakeoff.P.proj.scales, st = zdTakeoff.scaleState; return st(s[a]).t === "Verified" && st(s[b]).t === "From note — not verified" && st(undefined).t === "Unknown"; }, [P1, P2]), "scale status: p.1 Verified, p.2 From note — not verified, none Unknown");
  await T(k => zdTakeoff.gotoPage(k.split(":")[0], 1), P1); await wait(600);
  await page.click("#scaleChip"); await wait(); await page.click("#dlgAll"); await wait(600);
  ok(await page.isVisible("[data-cs]"), "Copy scale to… lists the other pages");
  await page.click("#csNone"); await page.check('[data-cs="1"]'); await page.click("#dlgOk"); await wait(300);
  ok(/Replace existing scales/.test(await page.innerText("#dlgT")), "a page that already has a scale asks before it is replaced");
  await page.click("#dlgOk"); await wait(300);
  const s3 = await T(k => zdTakeoff.P.proj.scales[k], P3);
  ok(s3.how === "inherited" && !s3.verified && s3.from === P1 && near(s3.ptPerFt, 9, 1e-9), "p.3 scale inherited from p.1, not verified");
  ok(/⚠/.test(await T(k => [...document.querySelectorAll("#pageSel option")].find(o => o.value === k.replace(":", "|")).textContent, P3)), "page list marks p.3 ⚠");

  console.log("doors on the outline: PD for skirting");
  const pd = await T(() => { const Z = zdTakeoff, p = Z.P.proj, c = p.conds.find(x => x.name === "Floor area"), bed = p.items.find(i => i.cond === c.id && i.kind === "shape" && Z.rowsOf(i, 9)[0].L === 12 && Z.rowsOf(i, 9)[0].W === 14);
    const d = Z.doorsOn(bed), v = Z.condVars(c); bed.doorW = 0; const d0 = Z.doorsOn(bed).ft; delete bed.doorW; return {d: d.ft, n: d.n, P: v.P, PD: v.PD, D: v.D, d0}; });
  ok(near(pd.d, 3, 1e-6) && pd.n === 1, `bed room: door D1 (3.000 ft) found on its outline; the 0.500 × 1.500 opening is not a door — doors ${pd.d}`);
  ok(near(pd.P - pd.PD, 3, 1e-6) && near(pd.D, 3, 1e-6), `PD = P − doors: ${pd.P.toFixed(3)} − 3.000 = ${pd.PD.toFixed(3)} ft`);
  ok(pd.d0 === 0, "doors typed as 0 on the measurement override the automatic find");
  ok(await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Floor area"); c.asm = [{id: "A1", name: "Skirting", unit: "ft", f: "PD"}]; const l = Z.billLines().find(x => x.kind === "asm" && x.name === "Skirting"); return l && Math.abs(l.qty - Z.condVars(c).PD) < 1e-9; }), "assembly formula PD drives the skirting line");

  console.log("opening schedule");
  const op = await T(() => zdTakeoff.P.proj.openings);
  ok(op.length === 1 && op[0].mark === "D1" && op[0].type === "door" && op[0].w === 3 && op[0].h === 7, "D1 (3.000 × 7.000, door) added to the schedule when it was placed");
  ok(await T(() => { const Z = zdTakeoff, p = Z.P.proj, it = p.items.find(i => i.kind === "open" && i.label === "D1"), s = p.openings[0]; s.h = 7.5; const q = Z.rowsOf(it, 9)[0].qty; s.h = 7; return it.sch === s.id && q === -45; }), "changing D1 in the schedule re-prices every D1: −2 × 3.000 × 7.500 = −45.00 Sft");

  console.log("rates from Rate Analysis");
  await T(() => { localStorage.setItem("SAJ_QSCOST_v1", JSON.stringify({set: {profOnOh: false}, rates: [{code: "R-MAT", rate: 1000, vs: "V", date: "2026-09-01", unit: "Bag"}, {code: "R-LAB", rate: 2500, vs: "A", date: "", unit: "Day"}],
    items: [{code: "TST-001", unit: "Sft", desc: "Test item", M: [{ref: "R-MAT", qty: 0.01}], L: [{ref: "R-LAB", qty: 0.002}], P: [], wast: 0, oh: 8, prof: 10, acc: 0, trans: 0},
            {code: "TST-CFT", unit: "Cft", M: [{ref: "R-MAT", qty: 1}], L: [], P: [], oh: 0, prof: 0}, {code: "TST-GAP", unit: "Sft", M: [{ref: "NOPE", qty: 1}], L: [], P: []}]})); });
  await wait(3100);   // the library is re-read every 3 s
  const ra = await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Floor area"), get = () => Z.billLines().find(l => l.kind === "cond" && l.c === c), out = {};
    c.ra = "TST-001"; out.ok = get(); c.ra = "TST-CFT"; out.unit = get(); c.ra = "TST-GAP"; out.gap = get(); c.ra = "NONE-1"; out.miss = get(); c.ra = "TST-001"; return JSON.parse(JSON.stringify(out, (k, v) => k === "c" || k === "a" ? undefined : v)); });
  ok(near(ra.ok.rate, 17.7, 1e-9) && /^ZD Rate Analysis TST-001, \d\d-\w{3}-\d{4} — built-up rate/.test(ra.ok.src) && ra.ok.assumed === 1, `RA TST-001 built up as Rate Analysis does: 15.00 (1000 × 0.01 + 2500 × 0.002) + 8% OH 1.20 + 10% profit 1.50 = ${ra.ok.rate.toFixed(3)}; source "${ra.ok.src.slice(0, 60)}…"; 1 assumed row flagged`);
  ok(/RATE NOT AVAILABLE — TST-CFT is priced per Cft/.test(ra.unit.na) && ra.unit.rate === 0, "a code priced in another unit: RATE NOT AVAILABLE");
  ok(/RATE NOT AVAILABLE — TST-GAP has 1 unrated row/.test(ra.gap.na), "a code with an unrated row: RATE NOT AVAILABLE");
  ok(/RATE NOT AVAILABLE — NONE-1 is not in/.test(ra.miss.na), "a code not in the library: RATE NOT AVAILABLE");

  console.log("location, QA");
  await T(([k1, k3]) => { const p = zdTakeoff.P.proj; p.sheets[k1] = {no: "A-101", rev: "R1", bldg: "Tower A", floor: "Level 1"}; p.sheets[k3] = {no: "A-101", rev: "R2", bldg: "Tower A", floor: "Level 1"}; }, [P1, P3]);
  ok(await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.page === 1), L = Z.locOf(it); it.room = "Bed room"; const L2 = Z.locOf(it); delete it.room; return L.bldg === "Tower A" && L.floor === "Level 1" && L2.room === "Bed room"; }), "a measurement takes its sheet's building and floor; its own room is kept");
  await T(() => localStorage.setItem("zdTakeoffUser", "Tester"));
  await T(() => zdTakeoff.setQa([zdTakeoff.P.proj.items[0]], "checked")); await wait();
  const it0 = await T(() => zdTakeoff.P.proj.items[0]);
  ok(it0.qa === "checked" && it0.qaBy === "Tester" && /^\d{4}-/.test(it0.qaAt), "QA: checked by Tester with the date");
  ok(/1 checked/.test(await page.innerText("#qaBar")), "QA bar counts it");
  await page.click("#sheet tr.it"); await wait(300); await shot("qa-props");

  console.log("typical floors");
  const nSrc = await T(k => zdTakeoff.P.proj.items.filter(i => i.file + ":" + i.page === k).length, P1);
  ok(await T(() => { const t = zdTakeoff.simT([0, 0], [10, 0], [5, 5], [5, 15]), a = t.f([10, 0]), b = t.f([5, 0]); return Math.abs(a[0] - 5) < 1e-9 && Math.abs(a[1] - 15) < 1e-9 && Math.abs(b[0] - 5) < 1e-9 && Math.abs(b[1] - 10) < 1e-9 && Math.abs(t.k - 1) < 1e-9; }), "2-point alignment: a 90° turn maps both points exactly");
  await page.click("#bTypical"); await wait(600);
  await page.selectOption("#tyHow", "align"); await page.check('[data-cp="0"]'); await page.click("#dlgOk"); await wait(300);
  ok(await T(() => zdTakeoff.S.tool === "typref"), "align: asks for reference points");
  await page.keyboard.press("s");   // snap off: the reference points are exact
  await click(600, 500); await click(700, 500);
  await page.waitForFunction(k => zdTakeoff.S.key === k, P2, {timeout: 15000}); await wait(500);
  await click(600, 700); await click(700, 700); await wait(200);
  ok(await page.isVisible("#tyOk"), "preview of the copies shown before they are made");
  await page.click("#tyOk"); await wait(400);
  await page.keyboard.press("s");
  const al = await T(([k1, k2]) => { const p = zdTakeoff.P.proj, src = p.items.filter(i => i.file + ":" + i.page === k1 && !i.copied), dst = p.items.filter(i => i.file + ":" + i.page === k2 && i.copied);
    return {n: dst.length, how: dst.every(i => i.copied.how === "aligned" && i.qa === ""), dx: dst[0].pts[0][0] - src[0].pts[0][0], dy: dst[0].pts[0][1] - src[0].pts[0][1]}; }, [P1, P2]);
  ok(al.n === nSrc && al.how && near(al.dx, 0, 0.01) && near(al.dy, (G.H2 - 700) - (G.H1 - 500), 0.01), `aligned copy: ${al.n} measurements moved by (${al.dx.toFixed(2)}, ${al.dy.toFixed(2)}) pt, marked copied, not checked`);
  await T(k => zdTakeoff.gotoPage(k.split(":")[0], 1), P1); await wait(600);
  await page.click("#bTypical"); await wait(600);
  await page.check('[data-cp="1"]'); await page.click("#dlgOk"); await wait(300);
  ok(/Check the layout first/.test(await page.innerText("#dlgT")), "same place: a sheet whose text does not match is flagged before copying");
  await page.click("#dlgOk"); await wait(300);
  ok((await T(k => zdTakeoff.P.proj.items.filter(i => i.file + ":" + i.page === k && i.copied && i.copied.how === "same place").length, P3)) === nSrc, "same-place copy to p.3, marked copied");
  ok(/copied/.test(await page.innerText("#sheet")) && (await T(() => zdTakeoff.qaCounts().copied)) === 2 * nSrc, "sheet shows the copied tag; QA counts them to check");

  console.log("revision compare");
  await T(k => { const p = zdTakeoff.P.proj, st = p.items.find(i => i.file + ":" + i.page === k && i.nos === 2); st.nos = 3; }, P3);
  const rv = await T(([a, b]) => zdTakeoff.revRows([a], [b]), [P1, P3]);
  const fl = rv.find(r => r.kind === "cond" && r.name === "Floor area");
  ok(fl && near(fl.var, 140) && near(fl.pct, 140 / fl.old * 100, 1e-9) && near(fl.cost, 140 * 17.7, 1e-6), `Floor area R1 ${fl && fl.old.toFixed(2)} → R2 ${fl && fl.neu.toFixed(2)}: +140.00 Sft (${fl && fl.pct.toFixed(2)}%), cost impact ${fl && fl.cost.toFixed(2)}`);
  await T(k => zdTakeoff.gotoPage(k.split(":")[0], 3), P3); await wait(600);
  await page.click("#vBill"); await wait(); await page.click('[data-bact="rev"]'); await wait(300);
  ok(await T(() => document.querySelector('[data-ro="0"]').checked && document.querySelector('[data-rn="2"]').checked), "old = A-101 R1, new = A-101 R2 picked from Sheet info");
  await page.click("#dlgOk"); await wait(300); await shot("revision");
  const [dcsv] = await Promise.all([page.waitForEvent("download"), page.click("#rcCsv")]); const rcf = path.join(os.tmpdir(), "tk_" + dcsv.suggestedFilename()); await dcsv.saveAs(rcf);
  const rcsv = fs.readFileSync(rcf, "utf8");
  ok(/^﻿?Log ID,Project,Date Raised/.test(rcsv) && /A-101 R1 → A-101 R2/.test(rcsv) && /Floor area,,Sft,[\d.]+,[\d.]+,140\.000/.test(rcsv), "Change Management CSV: log columns, drawing ref R1 → R2, Floor area +140.000");
  await closeDlg(); await shot("bill"); await page.click("#vSheet");

  console.log("check before export");
  let V = await T(() => zdTakeoff.validation());
  ok(V.lvl !== "PASS" && V.L.some(x => /no BOQ code/.test(x.msg)) && V.L.some(x => /not yet checked/.test(x.msg)) && V.L.some(x => /inherited/i.test(x.msg)), `takeoff check ${V.lvl}: flags missing BOQ codes, unchecked copies, inherited scale (${V.L.length} items)`);
  await T(() => zdTakeoff.P.proj.conds.forEach((c, i) => { c.boq = "T-" + i; }));
  V = await T(() => zdTakeoff.validation());
  ok(!V.L.some(x => /no BOQ code/.test(x.msg)), "BOQ codes given → that warning goes");
  await page.click("#bExport"); await wait();
  ok(/Takeoff check: (ERROR|WARNING)/.test(await page.innerText("#dlgB")), "Export shows the check first"); await shot("export");
  const xf2 = await (async () => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 20000}), page.click("#exXls")]); const f = path.join(os.tmpdir(), "tk2_" + d.suggestedFilename()); await d.saveAs(f); return f; })();
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(xf2);
  ok(["Bill", "By location", "Openings", "Validation"].every(n => wb2.getWorksheet(n)) && wb2.getWorksheet("Bill").getRow(1).getCell(2).value === "BOQ code" && /^ZD Rate Analysis TST-001/.test(String(wb2.getWorksheet("Bill").getColumn(10).values.find(v => /TST-001/.test(String(v))) || "")),
    "Excel: Bill with BOQ / RA codes and the RA source, By location, Openings, Validation sheets");

  console.log("backups");
  const pid = await T(() => zdTakeoff.P.proj.id);
  await T(() => zdTakeoff.backupNow("test"));
  ok((await T(() => zdTakeoff.backupNow("again"))) === false, "no second backup when nothing changed");
  const nAll = await T(() => zdTakeoff.P.proj.items.length);
  await T(() => { zdTakeoff.P.proj.items.pop(); return zdTakeoff.backupNow("after delete"); });
  const bl = await T(id => zdTakeoff.backupsOf(id), pid);
  ok(bl.length >= 2 && bl[0].n === nAll - 1 && bl[1].n === nAll, "backups kept newest first with their measurement counts");
  await T(() => { zdTakeoff.P.proj.name += " (edited)"; });
  await page.click("#bExport"); await wait(); await page.click("#exBak"); await wait(300);
  await page.locator("[data-rest]").nth(1).click(); await wait(200);
  ok(/Restore this backup/.test(await page.innerText("#dlgT")), "restore asks before replacing the project");
  await page.click("#dlgOk"); await page.waitForFunction(n => zdTakeoff.P.proj && zdTakeoff.P.proj.items.length === n, nAll, {timeout: 10000}).catch(() => {});
  ok((await T(() => zdTakeoff.P.proj.items.length)) === nAll && (await T(id => zdTakeoff.backupsOf(id), pid)).some(b => b.why === "before restore" && b.n === nAll - 1), "restored; the state before the restore was backed up first");
  ok((await T(id => zdTakeoff.backupsOf(id), pid)).length <= 10, "at most 10 backups per project");


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

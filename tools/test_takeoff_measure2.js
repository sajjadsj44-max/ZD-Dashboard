#!/usr/bin/env node
/* Browser tests for the PDF Takeoff's slope, rise / drop and the Measure family (Angle, Radius), against the fixture PDF of
   tools/takeoff_fixture.js (p.1 at 9 pt per ft), with synthetic measurements of known size:
     - slope (pitch) on a condition: 4:12, 4/12, 33%, 18.4° read; a 10 × 12 ft area at 6:12 → 1 × 10 × 12 × slope 1.1180 = 134.16 Sft;
       a measurement's own slope (flat, 9:12) over its condition's; deductions, circles and lengths sloped, openings and counts not;
       totals, condVars L, captions, the sheet, Properties and the condition dialog
     - rise / drop on a run: 20 ft on plan + 10 ft riser = 30 ft (its own "rise" row), a drop the same, never sloped;
       typed in Properties, undone with Ctrl+Z
     - Excel: the slope factor in column L inside the row's PRODUCT (live), plain rows still PRODUCT(D:G); CSV column
     - Angle (Shift+M): arm, corner, arm → 90.0° on screen, kept until Esc, nothing saved; Radius: centre, edge → R, Ø, circumference
     - circles: R and D in captions and Properties

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_measure2.js
*/
const path = require("path"), fs = require("fs"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
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
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const scr = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);   // base pt (y down) → screen
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(60); };
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Slope and rise"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  ok(await T(() => Math.abs(zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt - 9) < 1e-9), "fixture p.1 scale 9 pt per ft");

  console.log("slope typed");
  ok(await T(() => { const f = zdTakeoff.parsePitch, n = (a, b) => Math.abs(a - b) < 1e-9;
    return n(f("6:12"), 0.5) && n(f("4/12"), 1 / 3) && n(f("4 : 12"), 1 / 3) && n(f("50%"), 0.5) && n(f("33%"), 0.33) && n(f("26.56505118°"), 0.5) && n(f("45 deg"), 1) && f("") === 0 && f("flat") === 0 && f("0") === 0
      && isNaN(f("6")) && isNaN(f("abc")) && isNaN(f("90°")) && isNaN(f("4:0")); }), "4:12, 4/12, 50 %, 26.57° (= 6:12), 45 deg read as rise / run; blank / flat / 0 = none; a bare 6, 90° or 4:0 refused");
  ok(await T(() => { const Z = zdTakeoff; return Z.slopeF(0.5) === 1.118 && Z.slopeF(1 / 3) === 1.0541 && Z.slopeF(0.75) === 1.25 && Z.pitchIn(0.5) === "6:12" && Z.pitchText(0.5) === "6:12 (26.6°)" && Z.pitchText(0) === "flat"; }),
    "√(1 + p²) to 4 dp: 6:12 → 1.1180, 4:12 → 1.0541, 9:12 → 1.2500; shown as 6:12 (26.6°)");

  // conditions and measurements put in directly (k = 9 pt per ft)
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = P.scales[Z.S.key].ptPerFt, f = Z.S.fileId, x = 300, y = 300;
    const C = (id, name, type, unit, o) => P.conds.push(Object.assign({id, name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}, o));
    C("cR", "Roof sheeting", "area", "Sft", {pitch: 0.5}); C("cF", "Floor tiles", "area", "Sft", {}); C("cS", "Roof slab", "area", "cft", {t: 0.5, pitch: 0.5});
    C("cP", "uPVC pipe", "linear", "ft", {}); C("cG", "Gutter on slope", "linear", "ft", {pitch: 0.5}); C("cW", "Wall plaster", "linear", "Sft", {h: 10, faces: 1, dedMin: 1});
    C("cN", "Downlight", "count", "Nos", {pitch: 0.5}); C("cC", "Round slab", "area", "Sft", {}); C("cK", "Round kerb", "linear", "ft", {});
    const I = (id, cond, pts, o) => P.items.push(Object.assign({id, cond, file: f, page: 1, kind: "shape", nos: 1, label: "", pts}, o || {}));
    const rect = (w, h, x0, y0) => [[x0, y0], [x0 + w * k, y0], [x0 + w * k, y0 + h * k], [x0, y0 + h * k]];
    I("iR", "cR", rect(10, 12, x, y)); I("iRd", "cR", rect(2, 3, x + 9, y + 9), {kind: "ded"}); I("iF", "cF", rect(10, 12, x, y)); I("iS", "cS", rect(10, 12, x, y));
    I("iP", "cP", [[x, y], [x + 12 * k, y], [x + 12 * k, y + 8 * k]], {rise: 10}); I("iD", "cP", [[x, y], [x + 20 * k, y]], {rise: -10, label: "Drain"});
    I("iG", "cG", [[x, y], [x + 20 * k, y]], {rise: 10}); I("iW", "cW", [[x, y], [x + 20 * k, y]], {rise: 3}); I("iO", "cW", [[x, y], [x + 4 * k, y]], {kind: "open", oh: 7});
    I("iN", "cN", [[x, y], [x + 20, y]]); I("iC", "cC", [[x, y], [x + 5 * k, y]], {shape: "circle"}); I("iK", "cK", [[x, y], [x, y + 5 * k]], {shape: "circle"});
    Z.S.cond = "cR"; Z.refresh(); });
  await wait(300);
  const R = id => T(id => { const Z = zdTakeoff, P = Z.P.proj, it = P.items.find(i => i.id === id), k = P.scales[it.file + ":" + it.page].ptPerFt;
    return Z.rowsOf(it, k).map(r => ({nos: r.nos, A: r.A, L: r.L, W: r.W, H: r.H, F: r.F, qty: r.qty, rise: r.rise, sign: r.sign, below: r.below, dims: Z.dimText(r), desc: Z.rowDesc({r, it, i: 0})})); }, id);
  const tot = id => T(id => zdTakeoff.condTotals(zdTakeoff.P.proj.conds.find(c => c.id === id)), id);

  console.log("slope on areas");
  { const r = await R("iR");
    ok(r.length === 1 && r[0].L === 10 && r[0].W === 12 && r[0].F === 1.118 && near(r[0].qty, 134.16, 1e-9), `10 × 12 ft roof at 6:12: ${r[0].dims} = ${r[0].qty} Sft (120 × 1.1180 = 134.16)`);
    ok(r[0].dims === "1 × 10.000 × 12.000 × slope 1.1180" && /× slope 6:12 \(√\(1 \+ p²\) = 1\.1180\)/.test(r[0].desc), "the factor printed as one more dimension: 1 × 10.000 × 12.000 × slope 1.1180, and named in the description"); }
  { const r = await R("iRd"); ok(r[0].sign === -1 && r[0].F === 1.118 && near(r[0].qty, -2 * 3 * 1.118, 1e-9), `a void in the roof is sloped too: −1 × 2 × 3 × 1.1180 = ${r[0].qty.toFixed(4)} Sft`); }
  { const t = await tot("cR"); ok(near(t.gross, 134.16, 1e-9) && near(t.ded, 6.708, 1e-9) && near(t.net, 127.452, 1e-9), `condition total on the slope: 134.16 − 6.708 = ${t.net.toFixed(3)} Sft`); }
  { const r = await R("iF"); ok(r[0].F == null && r[0].qty === 120 && r[0].dims === "1 × 10.000 × 12.000", "a flat condition is untouched: 1 × 10.000 × 12.000 = 120 Sft, no slope factor"); }
  { const r = await R("iS"); ok(r[0].H === 0.5 && r[0].F === 1.118 && near(r[0].qty, 120 * 0.5 * 1.118, 1e-9), `a sloped roof slab in cft: 1 × 10 × 12 × 0.5 × 1.1180 = ${r[0].qty.toFixed(3)} cft`); }
  await T(() => { zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch = 0; });
  { const r = await R("iR"); ok(r[0].F == null && r[0].qty === 120, "the measurement's own slope 'flat' (it.pitch = 0) wins over its condition's 6:12 → 120 Sft"); }
  await T(() => { zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch = 0.75; });
  { const r = await R("iR"); ok(r[0].F === 1.25 && r[0].qty === 150, "its own 9:12 → × 1.2500 = 150 Sft"); }
  await T(() => { delete zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch; });
  { const r = await R("iN"); ok(r.length === 1 && r[0].F == null && r[0].qty === 2, "a count is never sloped (2 points → 2 Nos under a 6:12 condition)"); }

  console.log("rise / drop on runs");
  { const r = await R("iP");
    ok(r.length === 2 && r[0].L === 20 && r[0].F == null && r[1].L === 10 && r[1].rise === 10 && r[0].qty + r[1].qty === 30, `20 ft run (12 + 8) + 10 ft riser = ${r[0].qty + r[1].qty} ft, the riser its own row`);
    ok(/— rise 10\.000 ft$/.test(r[1].desc) && r[1].dims === "1 × 10.000", `rise row: “${r[1].desc}” · ${r[1].dims}`); }
  { const r = await R("iD"); ok(r.length === 2 && r[1].L === 10 && r[1].qty === 10 && r[1].rise === -10 && /Drain — drop 10\.000 ft/.test(r[1].desc), "a drop (−10) adds its length too: 20 + 10 = 30 ft, named ‘drop’"); }
  { const t = await tot("cP"); ok(t.net === 60, "pipe total 30 + 30 = 60 ft"); }
  { const r = await R("iG"); ok(r[0].F === 1.118 && near(r[0].qty, 22.36, 1e-9) && r[1].F == null && r[1].qty === 10, `sloped run 20 × 1.1180 = 22.36 ft + rise 10 (never sloped) = ${(r[0].qty + r[1].qty).toFixed(2)} ft`); }
  { const r = await R("iW"); ok(r.length === 2 && r[1].L === 3 && r[1].H === 10 && r[1].qty === 30, "plaster (Sft, H 10) with a 3 ft rise: its rise row 1 × 3 × 10 = 30 Sft"); }
  { const r = await R("iO"); ok(r.length === 1 && r[0].F == null && r[0].rise == null, "an opening has no slope or rise"); }
  ok(await T(() => { const Z = zdTakeoff, v = Z.condVars(Z.P.proj.conds.find(c => c.id === "cG")); return Math.abs(v.L - (20 * 1.118 + 10)) < 1e-6 && Math.abs(v.Q - 32.36) < 1e-9; }), "assembly variables: L along the slope with the rise (32.36 ft), Q the same");

  console.log("circles: R and D");
  const lblFull = on => T(on => { const Z = zdTakeoff; Z.S.lbl = Object.assign({}, Z.S.lbl, on ? {style: "box", show: "full"} : {style: "ps", show: "nameqty"}); }, on);   // the full captions (R / Ø, slope, rise) are Full labels'; the default is PlanSwift's name + qty
  await lblFull(true);
  { const r = await R("iC"), r2 = await R("iK"); ok(r[0].A === 78.54 && r2[0].L === 31.416, "circle of radius 5 ft: area 78.540 Sft, round 31.416 ft"); }
  ok(await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = 9, c = id => P.conds.find(x => x.id === id), it = id => P.items.find(i => i.id === id);
    return Z.capLines(it("iC"), c("cC"), k).includes("R 5.000 ft · Ø 10.000 ft") && Z.capLines(it("iK"), c("cK"), k).includes("R 5.000 ft · Ø 10.000 ft"); }), "circle captions show R 5.000 ft · Ø 10.000 ft (area and length)");
  await lblFull(false);
  await T(() => { zdTakeoff.setSel(["iC"]); zdTakeoff.refresh(); }); await wait(200);
  ok(await T(() => { const t = document.getElementById("props").textContent; return /Radius R\s*5\.000 ft/.test(t) && /Diameter D\s*10\.000 ft/.test(t) && /R 5\.000 · dia 10\.000 ft/.test(t); }), "Properties of a circle: Radius R 5.000 ft, Diameter D 10.000 ft");

  console.log("captions, sheet, Properties");
  await lblFull(true);
  ok(await T(() => { const Z = zdTakeoff, P = Z.P.proj, c = id => P.conds.find(x => x.id === id), it = id => P.items.find(i => i.id === id), L = Z.capLines(it("iR"), c("cR"), 9), L2 = Z.capLines(it("iP"), c("cP"), 9), L3 = Z.capLines(it("iG"), c("cG"), 9);
    return L.includes("slope 6:12 × 1.1180") && L.some(t => /^134\.160/.test(t)) && L2.includes("L 20.000 ft") && L2.some(t => /^30\.000/.test(t)) && L2.includes("rise 10.000 ft") && L3.includes("slope 6:12 × 1.1180 · rise 10.000 ft"); }),
    "captions: the roof shows slope 6:12 × 1.1180 and 134.160; the pipe L 20.000 ft, 30.000 and rise 10.000 ft; the gutter both");
  await lblFull(false);
  { const sh = await page.innerText("#sheet"); ok(/1 × 10\.000 × 12\.000 × slope 1\.1180/.test(sh) && /slope 6:12 \(26\.6°\)/.test(sh) && /run — rise/.test(sh) && /Drain — drop/.test(sh), "measurement sheet: × slope 1.1180 in the dimensions, the slope named, rise and drop rows"); }
  await T(() => { zdTakeoff.setSel(["iR"]); zdTakeoff.refresh(); }); await wait(200);
  ok(await page.isVisible('#props input[data-prop="pitch"]') && (await page.getAttribute('#props input[data-prop="pitch"]', "placeholder")) === "as condition 6:12" && !(await page.isVisible('#props input[data-prop="rise"]')), "Properties of an area: its own Slope box (placeholder ‘as condition 6:12’), no rise box");
  ok(await T(() => /Slope\s*6:12 \(26\.6°\) × 1\.1180/.test(document.getElementById("props").textContent)), "Properties details: Slope 6:12 (26.6°) × 1.1180");
  await page.fill('#props input[data-prop="pitch"]', "flat"); await page.dispatchEvent('#props input[data-prop="pitch"]', "change"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch === 0) && (await R("iR"))[0].qty === 120, "typing ‘flat’ makes this one flat: 120 Sft");
  await page.fill('#props input[data-prop="pitch"]', "45°"); await page.dispatchEvent('#props input[data-prop="pitch"]', "change"); await wait(200);
  ok(await T(() => Math.abs(zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch - 1) < 1e-9) && (await R("iR"))[0].F === 1.4142, "45° → its own pitch 1 (12:12), × 1.4142");
  await page.fill('#props input[data-prop="pitch"]', "steep"); await page.dispatchEvent('#props input[data-prop="pitch"]', "change"); await wait(200);
  ok(await T(() => Math.abs(zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch - 1) < 1e-9), "‘steep’ refused, the slope kept");
  await page.fill('#props input[data-prop="pitch"]', ""); await page.dispatchEvent('#props input[data-prop="pitch"]', "change"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "iR").pitch === undefined) && (await R("iR"))[0].F === 1.118, "blank → back to the condition's 6:12");
  await T(() => { zdTakeoff.setSel(["iD"]); zdTakeoff.refresh(); }); await wait(200);
  ok(await page.isVisible('#props input[data-prop="rise"]') && (await page.inputValue('#props input[data-prop="rise"]')) === "-10.000", "Properties of a run: Rise / drop box showing −10.000");
  await page.fill('#props input[data-prop="rise"]', "−4'-6\""); await page.press('#props input[data-prop="rise"]', "Tab"); await wait(200);   // typed and left, as a person would
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "iD").rise === -4.5) && (await R("iD"))[1].L === 4.5, "typed −4'-6\" → a 4.5 ft drop row");
  ok(await T(() => zdTakeoff.S.undo.slice(-1)[0].label === "Drop 4.500 ft" && /Drop 4\.500 ft/.test(document.getElementById("bUndo").title)), "the undo step is named ‘Drop 4.500 ft’");
  await T(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press("Control+z"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "iD").rise === -10), "Ctrl+Z puts the drop back to −10");
  await T(() => { zdTakeoff.setSel(["iD"]); zdTakeoff.refresh(); }); await wait(150);
  await page.fill('#props input[data-prop="rise"]', ""); await page.dispatchEvent('#props input[data-prop="rise"]', "change"); await wait(200);
  ok(await T(() => !("rise" in zdTakeoff.P.proj.items.find(i => i.id === "iD"))) && (await R("iD")).length === 1, "blank rise → no rise row");
  await T(() => { zdTakeoff.P.proj.items.find(i => i.id === "iD").rise = -10; zdTakeoff.setSel([]); zdTakeoff.refresh(); });

  console.log("condition dialog");
  { const p = T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cF")); }); await p; await wait(200);
    ok(await page.isVisible("#cPitch") && (await page.inputValue("#cPitch")) === "", "Edit condition has a Slope box (empty = flat)");
    await page.fill("#cPitch", "abc"); await page.click("#dlgOk"); await wait(150);
    ok(await T(() => document.getElementById("dlgBack").classList.contains("on")) && /Slope/.test(await page.innerText("#dlgErr")), "a slope it cannot read is refused with a message");
    await page.fill("#cPitch", "4:12"); await wait(80);
    ok(/× 1\.0541 \(18\.4°\)/.test(await page.innerText("#cPitchF")), "the factor is shown as it is typed: × 1.0541 (18.4°)");
    await page.click("#dlgOk"); await wait(250);
    ok(await T(() => Math.abs(zdTakeoff.P.proj.conds.find(c => c.id === "cF").pitch - 1 / 3) < 1e-6) && (await R("iF"))[0].F === 1.0541 && near((await R("iF"))[0].qty, 120 * 1.0541, 1e-9), "saved as pitch 1/3 → floor tiles now 120 × 1.0541 = 126.492 Sft"); }
  { await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cF")); }); await wait(200);
    ok((await page.inputValue("#cPitch")) === "4:12", "reopened: the box reads 4:12");
    await page.fill("#cPitch", ""); await page.click("#dlgOk"); await wait(250);
    ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cF").pitch === "") && (await R("iF"))[0].qty === 120, "cleared → flat again, 120 Sft"); }
  { await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cN")); }); await wait(200);
    ok(!(await page.isVisible("#cPitch")), "a count condition has no Slope box"); await page.click("#dlgCancel"); await wait(150); }

  console.log("Excel and CSV");
  const dl = async sel => { await page.click("#bExport"); await wait(); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), page.click(sel)]); const f = path.join(os.tmpdir(), "tkm2_" + d.suggestedFilename()); await d.saveAs(f); return f; };
  { const f = await dl("#exXls"), ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
    const ms = wb.getWorksheet("Measurement"), rows = []; ms.eachRow((r, n) => rows.push({n, d: String(r.getCell(2).value || ""), q: r.getCell(8).value, L: r.getCell(12).value, D: r.getCell(4).value, E: r.getCell(5).value, F: r.getCell(6).value}));
    const roof = rows.find(r => /^area × slope 6:12/.test(r.d)), riser = rows.find(r => /run — rise 10\.000 ft/.test(r.d)), floor = rows.find(r => r.q && r.q.formula && /^area/.test(r.d) && r.n > 4 && r.L == null);
    ok(ms.getRow(4).getCell(12).value === "Slope ×", "Measurement header: ‘Slope ×’ in column L");
    ok(roof && roof.L === 1.118 && roof.q.formula === `PRODUCT(D${roof.n}:G${roof.n},L${roof.n})` && near(roof.q.result, 134.16, 1e-9) && roof.E === 10 && roof.F === 12, `roof row: Nos 1 · L 10 · W 12 · slope 1.118 in L, Qty = ${roof && roof.q.formula} = 134.16`);
    ok(ms.getRow(roof.n).getCell(12).fill && ms.getRow(roof.n).getCell(12).fill.fgColor.argb === "FFDDEBFF" && ms.getRow(roof.n).getCell(12).numFmt === "0.0000", "the slope cell is a blue input, 4 dp");
    ok(riser && riser.q.formula === `PRODUCT(D${riser.n}:G${riser.n})` && riser.E === 10 && riser.q.result === 10 && riser.L == null, "the riser row: L 10, plain PRODUCT(D:G), no slope");
    ok(floor && /^PRODUCT\(D\d+:G\d+\)$/.test(floor.q.formula) && floor.q.result === 120, "a flat row keeps the house PRODUCT(D:G)");
    ok(/sloped rows × slope/.test(String(ms.getCell("A2").value)), "the sheet's note says so"); }
  { const csv = fs.readFileSync(await dl("#exCsv"), "utf8"), lines = csv.split(/\r\n/);
    ok(/,QA,Slope ×$/.test(lines[0]) && lines.some(l => /Roof sheeting,area × slope 6:12.*,1,10\.000,12\.000,,134\.160,Sft,.*,1\.1180$/.test(l)), "CSV: Slope × column, the roof row 1 × 10 × 12 → 134.160 with 1.1180"); }

  console.log("Angle and Radius (not saved)");
  await T(() => { const sn = document.getElementById("snapOn"); if (sn) sn.checked = false; zdTakeoff.setSel([]); zdTakeoff.refresh(); });
  await page.click('[data-rtab="takeoff"]'); await wait(150);
  ok(await page.isVisible('#tools [data-tool="angle"]') && await page.isVisible('#tools [data-tool="radius"]') && await T(() => { const m = document.querySelector('#tools [data-tool="measure"]'); return m.nextElementSibling.dataset.tool === "angle" && m.nextElementSibling.nextElementSibling.dataset.tool === "radius"; }), "Takeoff ribbon: Angle and Radius right after Measure");
  await page.mouse.move(700, 450); await page.keyboard.press("Shift+M"); await wait(100);
  ok(await T(() => zdTakeoff.S.tool === "angle"), "Shift+M → Angle");
  const n0 = await T(() => zdTakeoff.P.proj.items.length + (zdTakeoff.P.proj.marks || []).length);
  await click(300, 200); await click(200, 200);
  ok(await T(() => zdTakeoff.S.draft.length === 2 && /second arm/.test(document.getElementById("stHint") ? document.getElementById("stHint").textContent : "second arm")), "two clicks: an arm and the corner");
  await click(200, 100);
  ok(await T(() => { const m = zdTakeoff.S.measures.slice(-1)[0]; return m && m.t === "angle" && zdTakeoff.measText(m, 9) === "∠ 90.0°"; }), "third click: a right angle → ∠ 90.0°");
  ok(await T(() => /∠ 90\.0°/.test(document.querySelector(".ov2, #ov2") ? document.querySelector(".ov2, #ov2").innerHTML : document.getElementById("stage").innerHTML)), "∠ 90.0° drawn on screen");
  await click(400, 200); await click(300, 200); await click(300 + 100 * Math.cos(Math.PI / 4), 200 - 100 * Math.sin(Math.PI / 4));
  ok(await T(() => zdTakeoff.measText(zdTakeoff.S.measures.slice(-1)[0], 9) === "∠ 45.0°" && zdTakeoff.S.measures.length === 2), "a second angle: 45.0°, the first kept");
  ok(await T(() => { const Z = zdTakeoff; return Z.measText(Object.assign([[0, 0], [10, 0], [20, 0]], {t: "angle"}), 9) === "∠ 180.0°" && Z.measText(Object.assign([[10, 0], [0, 0], [10, 10 * Math.sqrt(3)]], {t: "angle"}), 0) === "∠ 60.0°"; }), "a straight line reads 180.0°, 60° needs no scale");
  await page.click('#tools [data-tool="radius"]'); await wait(100);
  await click(500, 300); await click(500 + 5 * 9, 300);
  ok(await T(() => { const m = zdTakeoff.S.measures.slice(-1)[0]; return m && m.t === "radius" && zdTakeoff.measText(m, 9) === "R 5.000 ft · Ø 10.000 ft · circumference 31.416 ft · area 78.540 Sft"; }), "Radius: centre, then edge 45 pt away → R 5.000 ft · Ø 10.000 ft · circumference 31.416 ft · area 78.540 Sft");
  ok(await T(() => zdTakeoff.P.proj.items.length + (zdTakeoff.P.proj.marks || []).length) === n0, "nothing saved to the project");
  await page.keyboard.press("Escape"); await wait(100);
  ok(await T(() => zdTakeoff.S.measures.length === 0), "Esc clears them");
  await page.keyboard.press("Shift+M"); await click(300, 200); await click(200, 200); await page.keyboard.press("Enter"); await wait(80);
  ok(await T(() => zdTakeoff.S.measures.length === 0 && zdTakeoff.S.draft.length === 2), "Enter does not end an angle with two points");
  await page.keyboard.press("Escape"); await wait(80);
  ok(await T(() => zdTakeoff.S.draft.length === 0), "Esc drops the half-drawn angle");
  ok(await T(() => { const L = zdTakeoff.paletteCmds(); const a = L.find(c => /^Angle/.test(c.t)), r = L.find(c => /^Radius/.test(c.t)); return a && r && (a.al || []).includes("dan") && (r.al || []).includes("dra"); }), "command palette: Angle (alias dan) and Radius (alias dra)");
  await page.keyboard.press("v");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser tests for the PDF Takeoff Material tab:
     - the ribbon tab and its tools; the right panel's Material view by floor, by page, by measurement, by condition, this page only
     - brick and block with no thickness in the name take the default wall T (9" brick, 6" block) and the 3/8" mortar joint, said so;
       the joint and T set on the condition, or the project's Material defaults changed, give the figures worked out here
     - tiles (Rate Analysis FN-500: × 1.05, adhesive 0.6 kg / Sft, grout 0.08) and paint (putty 0.08 kg / Sft, primer 100 Sft / litre,
       emulsion 110 Sft / litre a coat) — a deduction taken off
     - Material setup (every condition in one table) and the Excel workbook (Summary, By floor, By page, By measurement, By condition, Basis)

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_material_tab.js
*/
const path = require("path"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);
const BAG = 50 / 1440 / 0.028316846592;
const bricks = (V, jIn) => { const j = jIn / 12; return V / ((0.75 + j) * (0.375 + j) * (0.25 + j)); };
const blocks = (V, T, jIn) => { const j = jIn / 12; return V / ((1 + j) * (8 / 12 + j) * T); };   // 12" × 8" solid block, one leaf

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
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Material tab"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});

  // page 1 = Ground floor, page 2 = First floor (page 2 at page 1's scale). Brick masonry 100 ft × H 10 (Sft, no T in the name);
  // Block masonry 60 ft on page 1 and 40 ft on page 2 (Sft, H 10); Floor tile 20 × 10 less a 2 × 5 void on page 1, 10 × 10 on page 2;
  // Emulsion paint 50 ft × H 10 on page 2; a door count (no materials)
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, k1 = Z.S.key, k = P.scales[k1].ptPerFt, k2 = f + ":2", x = 60, y = 60;
    P.scales[k2] = JSON.parse(JSON.stringify(P.scales[k1])); P.sheets = P.sheets || {}; P.sheets[k1] = {floor: "Ground floor"}; P.sheets[k2] = {floor: "First floor"};
    const C = (id, name, type, unit, o) => P.conds.push(Object.assign({id, name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}, o));
    C("cBr", "Brick masonry", "linear", "Sft", {h: 10}); C("cBl", "Block masonry", "linear", "Sft", {h: 10}); C("cT", "Floor tile", "area", "Sft", {}); C("cE", "Emulsion paint", "linear", "Sft", {h: 10}); C("cD", "Door D-1", "count", "Nos", {});
    const I = (id, cond, pts, pg, kind) => P.items.push({id, cond, file: f, page: pg || 1, kind: kind || "shape", nos: 1, pts});
    const R = (x0, y0, w, h) => [[x0, y0], [x0 + w * k, y0], [x0 + w * k, y0 + h * k], [x0, y0 + h * k]];
    I("i1", "cBr", [[x, y], [x + 100 * k, y]]); I("i2", "cBl", [[x, y + 20], [x + 60 * k, y + 20]]); I("i3", "cBl", [[x, y + 20], [x + 40 * k, y + 20]], 2);
    I("i4", "cT", R(x, y + 40, 20, 10)); I("i5", "cT", R(x + 5, y + 45, 2, 5), 1, "ded"); I("i6", "cT", R(x, y + 40, 10, 10), 2); I("i7", "cE", [[x, y + 60], [x + 50 * k, y + 60]], 2);
    I("i8", "cD", [[x, y], [x + 30, y]]);
    Z.S.cond = "cBr"; Z.refresh(); });
  await wait(300);
  const calc = id => T(id => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.id === id), r = Z.matCalc(c, Z.condTotals(c).net); return r && {err: r.err, basis: r.basis, kind: r.m.kind, rows: Object.fromEntries(r.rows.map(x => [x[0], x[1]])), mats: Object.fromEntries(r.mats.map(x => [x.n, x.q]))}; }, id);

  console.log("ribbon: the Material tab");
  ok(await T(() => !!document.querySelector('#tools .rtab[data-rtab="material"]')), "a Material tab in the ribbon");
  await page.click('[data-rtab="material"]'); await wait(150);
  ok(await T(() => { const p = document.querySelector('.rpanel[data-rp="material"]'); return !!p && !p.hidden && ["matview", "mattot", "matkind", "matfloor", "matpage", "matitem", "matcond", "matset", "matdef", "matxls"].every(f => p.querySelector(`[data-fn="${f}"]`)); }),
    "its tools: Material sheet, Totals & cost, By type / floor / page / measurement / condition, Material setup, Defaults, Excel");
  ok(await T(() => { const s = new Set([...document.querySelectorAll("svg defs symbol")].map(x => x.id)); return [...document.querySelectorAll('.rpanel[data-rp="material"] use')].every(u => s.has(u.getAttribute("href").slice(1))); }), "every icon on it exists");

  console.log("brick and block: default wall T and mortar joint");
  { const r = await calc("cBr"), N = bricks(750, 0.375);
    ok(r.kind === "brick" && !r.err && r.rows.Bricks === Math.ceil(N - 1e-9), `Brick masonry 1,000 Sft, no T in the name → T 9" (default), 750 cft, 3/8" joints → ${r.rows.Bricks} bricks`);
    ok(/T 9" default/.test(r.basis) && /3\/8" joints/.test(r.basis), "the basis says the default T and the joint"); }
  { const r = await calc("cBl"), N = blocks(1000 * 0.5, 0.5, 0.375);
    ok(r.kind === "block" && r.rows.Blocks === Math.ceil(N - 1e-9) && /T 6" default/.test(r.basis) && /6" × 8" × 12" solid/.test(r.basis), `Block masonry 1,000 Sft → T 6" (default), 6" × 8" × 12" solid, ${r.rows.Blocks} blocks`); }
  await T(() => { const Z = zdTakeoff; Z.S.cond = "cBr"; Z.S.sel = null; Z.refresh(); }); await wait(150);
  ok(await T(() => { const j = document.querySelector('#props input[data-matk="jin"]'), t = document.querySelector('#props input[data-matk="T"]'); return !!j && j.placeholder === "0.375 (default)" && !!t && t.placeholder === "9 (default)"; }),
    "Properties › Materials: a Joint box (0.375 default) and a Wall T box (9 default) for brick");
  await page.fill('#props input[data-matk="jin"]', "0.5"); await page.dispatchEvent('#props input[data-matk="jin"]', "change"); await wait(200);
  { const r = await calc("cBr"), N = bricks(750, 0.5);
    ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cBr").mat.jin === 0.5) && r.rows.Bricks === Math.ceil(N - 1e-9), `½" joint on the condition → ${r.rows.Bricks} bricks (kept on it)`);
    const dry = (750 - N * 0.75 * 0.375 * 0.25) * 1.27;
    ok(near(r.rows.Cement, dry / 5 / BAG, 1e-6) && near(r.mats["Chenab sand"], dry * 4 / 5, 1e-6), `…mortar from the thicker joint: cement ${(dry / 5 / BAG).toFixed(2)} bags`); }
  await page.fill('#props input[data-matk="T"]', "4.5"); await page.dispatchEvent('#props input[data-matk="T"]', "change"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cBr").t === 0.375) && (await calc("cBr")).rows.Bricks === Math.ceil(bricks(375, 0.5) - 1e-9), '4½" wall T typed → 375 cft and the bricks for it');
  await T(() => { const c = zdTakeoff.P.proj.conds.find(c => c.id === "cBr"); c.t = ""; delete c.mat; zdTakeoff.refresh(); });

  console.log("Material defaults (the project's)");
  await T(() => { zdTakeoff.matDefDialog(); }); await page.waitForSelector("#md_jBrick");
  await page.fill("#md_jBrick", "0.25"); await page.fill("#md_tBlock", "4"); await page.click("#dlgOk"); await wait(250);
  ok(await T(() => { const d = zdTakeoff.P.proj.matDef; return d && d.jBrick === 0.25 && d.tBlock === 4 && d.jBlock === 0.375 && d.tBrick === 9; }), "saved with the project: brick joint ¼\", block wall 4\", the rest as they were");
  ok((await calc("cBr")).rows.Bricks === Math.ceil(bricks(750, 0.25) - 1e-9), "every brick condition without its own joint takes the new default");
  { const r = await calc("cBl"), V = 1000 * (4 / 12); ok(/T 4" default/.test(r.basis) && /4" × 8" × 12" solid/.test(r.basis) && r.rows.Blocks === Math.ceil(V / ((1 + 0.375 / 12) * (8 / 12 + 0.375 / 12) * (4 / 12)) - 1e-9), "block walls take the new 4\" default (and a 4\" block)"); }
  await T(() => { zdTakeoff.matDefDialog(); }); await page.waitForSelector("#md_jBrick"); await page.fill("#md_jBrick", "3"); await page.click("#dlgOk"); await wait(100);
  ok(/joint that wide/.test(await page.textContent("#dlgErr")), "a 3\" joint is refused with a reason"); await page.click("#dlgCancel"); await wait(100);
  await T(() => { delete zdTakeoff.P.proj.matDef; zdTakeoff.refresh(); });

  console.log("tiles and paint (Rate Analysis consumption)");
  { const r = await calc("cT"), A = 200 - 10 + 100, pcs = Math.ceil(A * 1.05 / ((2 + 0.0625 / 12) ** 2) - 1e-9);
    ok(r.kind === "tile" && near(r.rows.Area, A, 1e-9) && near(r.rows.Tiles, A * 1.05, 1e-9) && r.rows["Tiles (pieces)"] === pcs, `Floor tile ${A} Sft net (void taken off) → porcelain ${(A * 1.05).toFixed(3)} Sft, ${pcs} pieces 24" × 24"`);
    ok(near(r.rows["Tile adhesive"], A * 0.6, 1e-9) && near(r.rows["Tile grout"], A * 0.08, 1e-9), `adhesive ${(A * 0.6).toFixed(1)} kg, grout ${(A * 0.08).toFixed(1)} kg`); }
  { const r = await calc("cE"), A = 500;
    ok(r.kind === "paint" && near(r.mats["Wall putty"], A * 0.08, 1e-9) && near(r.mats.Primer, A / 100, 1e-9) && near(r.mats["Emulsion paint"], A * 3 / 110, 1e-9), `Emulsion paint 500 Sft → putty 40 kg, primer 5 litres, emulsion ${(A * 3 / 110).toFixed(3)} litres (3 coats)`); }

  console.log("the Material view");
  await page.click('[data-rtab="material"]'); await page.click('[data-fn="matview"]'); await wait(250);
  ok(await T(() => document.getElementById("matv").style.display !== "none" && document.getElementById("vMat").classList.contains("on") && document.getElementById("sheet").style.display === "none"), "Material sheet opens the right panel's Material view");
  ok(await T(() => { const t = document.querySelector("#matv .mvtot").textContent; return ["Cement", "Bricks", "Blocks", "Porcelain floor tile", "Tile adhesive", "Wall putty", "Emulsion paint"].every(n => t.includes(n)); }), "Total materials: cement, bricks, blocks, tiles, adhesive, putty, paint");
  ok(await T(() => [...document.querySelectorAll("#matv .mvg > summary b")].map(b => b.textContent).join("|")) === "Ground floor|First floor", "by floor: Ground floor, then First floor");
  { const g = await T(() => { const Z = zdTakeoff, G = Z.matGroups("floor").map(g => Z.matFor(g.its)); return G.map(L => (L.find(o => o.c.id === "cBl") || {}).Q); });
    ok(near(g[0], 600, 1e-6) && near(g[1], 400, 1e-6), "block masonry 600 Sft on the ground floor, 400 on the first"); }
  ok(await T(() => { const Z = zdTakeoff, L = Z.matGroups("floor").map(g => Z.matFor(g.its)), cem = L.map(l => l.reduce((a, o) => a + (o.r.mats.find(x => x.k === "cem") || {q: 0}).q, 0)), tot = [...document.querySelectorAll("#matv .mvtot tr")].find(r => r.cells[0].textContent === "Cement");
    return tot && Math.abs(+tot.cells[1].textContent.replace(/,/g, "") - (cem[0] + cem[1])) < 0.01; }), "the total cement = the two floors' cement added");
  await page.selectOption("#mvBy", "kind"); await wait(200);
  ok(await T(() => [...document.querySelectorAll("#matv .mvg > summary b")].map(b => b.textContent).join("|")) === "Brick masonry|Block masonry|Tiles (floor / wall)|Paint (putty, primer, emulsion)", "by type: brick, block, tiles, paint — each with its own materials");
  ok(await T(() => { const g = [...document.querySelectorAll("#matv .mvg")].find(d => /Block masonry/.test(d.querySelector("summary").textContent)); return !!g && /Blocks/.test(g.textContent) && !/Porcelain/.test(g.textContent); }), "…block masonry shows the blocks and their mortar, not the tiles");
  await page.selectOption("#mvBy", "page"); await wait(200);
  ok(await T(() => [...document.querySelectorAll("#matv .mvg > summary b")].map(b => b.textContent).join("|")) === "test-plans p.1|test-plans p.2", "by page: each page uploaded, in order");
  await page.selectOption("#mvBy", "item"); await wait(200);
  ok(await T(() => document.querySelectorAll("#matv .mvi").length) === 7, "by measurement: every measurement with materials (7; the door count has none)");
  ok(await T(() => { const d = document.querySelector('#matv .mvi[data-mvit="i5"]'); return !!d && /−10\.000 Sft/.test(d.querySelector(".mvh b").textContent) && /-10\.500/.test(d.querySelector(".mvm").textContent); }), "the void: −10 Sft, its tiles taken off (−10.500 Sft)");
  await page.click('#matv .mvi[data-mvit="i7"]'); await wait(500);
  ok(await T(() => zdTakeoff.S.sel === "i7" && zdTakeoff.S.pageNo === 2), "a click on a measurement goes to it (page 2, selected)");
  await page.selectOption("#mvBy", "floor"); await page.check("#mvPg"); await wait(200);
  ok(await T(() => { const t = document.querySelector("#matv .mvtot").textContent; return /this page/.test(t) && t.includes("Emulsion paint") && !t.includes("Bricks"); }), "This page: only page 2's materials (paint, no bricks)");
  await page.uncheck("#mvPg"); await wait(100);
  await page.selectOption("#mvBy", "cond"); await wait(200);
  ok(await T(() => document.querySelectorAll("#matv .mvc").length) === 4, "by condition: the four conditions with materials");

  console.log("Material setup");
  await T(() => { zdTakeoff.matSetupDialog(); }); await page.waitForSelector("#dlgB .mst");
  ok(await T(() => document.querySelectorAll("#dlgB .mst tr[data-sc]").length) === 4, "one row per length / area condition (the count left out)");
  ok(await T(() => document.querySelector('#dlgB tr[data-sc="cBr"] input[data-sk="jin"]').placeholder === "0.375 def." && document.querySelector('#dlgB tr[data-sc="cBr"] input[data-sk="T"]').placeholder === "9 def."), "brick's joint and T boxes show the defaults");
  await page.fill('#dlgB tr[data-sc="cBl"] input[data-sk="jin"]', "0.25"); await page.dispatchEvent('#dlgB tr[data-sc="cBl"] input[data-sk="jin"]', "change");
  await page.fill('#dlgB tr[data-sc="cBl"] input[data-sk="T"]', "8"); await page.dispatchEvent('#dlgB tr[data-sc="cBl"] input[data-sk="T"]', "change");
  await page.selectOption('#dlgB tr[data-sc="cT"] select[data-sk="ts"]', "12x12"); await wait(80);
  await page.selectOption('#dlgB tr[data-sc="cE"] select[data-sk="kind"]', "plaster"); await wait(80);
  ok(await T(() => !!document.querySelector('#dlgB tr[data-sc="cE"] input[data-sk="tin"]') && !document.querySelector('#dlgB tr[data-sc="cE"] select[data-sk="ps"]')), "changing a row's material redraws its boxes (plaster: thickness, no paint system)");
  await page.selectOption('#dlgB tr[data-sc="cE"] select[data-sk="kind"]', "paint"); await wait(80);
  await page.click("#dlgOk"); await wait(250);
  ok(await T(() => { const P = zdTakeoff.P.proj, b = P.conds.find(c => c.id === "cBl"), t = P.conds.find(c => c.id === "cT"), r = P.conds.find(c => c.id === "cBr"); return b.mat.jin === 0.25 && b.t === 0.667 && t.mat.ts === "12x12" && !r.mat; }), "applied: block joint ¼\" and T 8\", tiles 12\" × 12\"; the untouched brick row left as it was");
  { const r = await calc("cBl"), V = 1000 * 0.667, j = 0.25 / 12, N = V / ((1 + j) * (8 / 12 + j) * 0.667);
    ok(r.rows.Blocks === Math.ceil(N - 1e-9) && /8" × 8" × 12" solid/.test(r.basis), `block wall 8" with ¼" joints → ${r.rows.Blocks} blocks 8" × 8" × 12"`); }
  ok(await T(() => zdTakeoff.S.undo[zdTakeoff.S.undo.length - 1].label === "Material setup"), "one undo step");

  console.log("Excel");
  await T(() => zdTakeoff.matShow("floor")); await wait(200);
  { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), page.click('#matv [data-mva="xls"]')]);
    ok(/_Materials\.xlsx$/.test(d.suggestedFilename()), "the Excel button saves …_Materials.xlsx");
    const f = path.join(os.tmpdir(), "tkmt_" + d.suggestedFilename()); await d.saveAs(f); const ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
    ok(["Summary", "By type", "By floor", "By page", "By measurement", "By condition", "Basis"].every(n => wb.getWorksheet(n)), "sheets: Summary, By type, By floor, By page, By measurement, By condition, Basis");
    const ws = wb.getWorksheet("By floor"), hdr = ws.getRow(3).values, ci = hdr.indexOf("Cement (bags)");
    let gt = null, subs = []; ws.eachRow(r => { const a = String(r.getCell(1).value || ""); if (a === "Grand total") gt = r; if (/^Total — /.test(a)) subs.push(r); });
    ok(ci > 0 && gt && subs.length === 2 && /^SUBTOTAL\(9,/.test(gt.getCell(ci).value.formula) && near(gt.getCell(ci).value.result, subs[0].getCell(ci).value.result + subs[1].getCell(ci).value.result, 0.002),
      "By floor: a SUBTOTAL per floor and a grand total that adds them (cement " + (gt ? gt.getCell(ci).value.result : "?") + " bags)");
    const wm = wb.getWorksheet("By measurement"); let ded = null, n = 0; wm.eachRow((r, i) => { if (i > 3 && typeof r.getCell(1).value === "number") n++; if (/^Ded\./.test(String(r.getCell(5).value || ""))) ded = r; });
    const ti = wm.getRow(3).values.findIndex(v => /^Porcelain floor tile 12" × 12" \(Sft\)$/.test(String(v)));
    ok(n === 7 && ded && ti > 0 && near(ded.getCell(ti).value, -10.5, 1e-9), "By measurement: 7 rows, the void's tiles −10.500 Sft");
    const wc = wb.getWorksheet("By condition"); let blk = null; wc.eachRow(r => { if (r.getCell(1).value === "Block masonry") blk = r; });
    ok(blk && /8" × 8" × 12" solid/.test(String(blk.getCell(6).value)) && /1\/4" joints/.test(String(blk.getCell(6).value)), "By condition: each condition's basis (block 8\", ¼\" joints)");
    const bs = wb.getWorksheet("Basis"); let def = null; bs.eachRow(r => { if (r.getCell(1).value === "This project's defaults") def = r; });
    ok(def && /mortar joint: brick 3\/8", block 3\/8"/.test(String(def.getCell(2).value)) && /brick 9", block 6"/.test(String(def.getCell(2).value)), "Basis: the formulas and this project's defaults (3/8\" joints, 9\" / 6\" walls)");
    const sm = wb.getWorksheet("Summary"); let em = null; sm.eachRow(r => { if (r.getCell(1).value === "Emulsion paint") em = r; });
    ok(em && near(em.getCell(2).value, 500 * 3 / 110, 0.001) && em.getCell(3).value === "litre", "Summary: emulsion paint 13.636 litres"); }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

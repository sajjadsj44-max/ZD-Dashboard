#!/usr/bin/env node
/* Browser tests for the PDF Takeoff Materials section and the compact (PlanSwift-style) condition list:
     - cement / sand / crush / blocks / bricks worked out with the Material Calculator's own formulas
       (dry factor 1.27 mortar, 1.54 concrete; 50 kg bag = 1.226 cft; 3/8" joints), checked against figures worked out here
     - the material read from the condition's name, and changed in Properties (kept on the condition)
     - missing H / T asked for, not guessed
     - By page tree: file → page → conditions with that page's quantity; Compact and Cards views; the choice remembered

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_materials.js
*/
const path = require("path"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);
const BAG = 50 / 1440 / 0.028316846592;

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
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
  await page.click("#bNewProj"); await page.fill("#dlgName", "Materials"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});

  // conditions and measurements put in directly: 100 ft of 8" block (H 10), the same 100 ft as wall plaster (Sft, H 10),
  // a 20 × 10 RCC slab (Sft, T 0.5), 100 ft of 9" brick (cft), and doors (count)
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = P.scales[Z.S.key].ptPerFt, f = Z.S.fileId, x = 60, y = 60;
    const C = (id, name, type, unit, o) => P.conds.push(Object.assign({id, name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}, o));
    C("cB", '8" Block', "linear", "ft", {h: 10}); C("cP", "Wall Plaster", "linear", "Sft", {h: 10}); C("cS", "RCC Slab", "area", "Sft", {t: 0.5});
    C("cK", '9" Brick wall', "linear", "cft", {h: 10, t: 0.75}); C("cD", "Door D-1", "count", "Nos", {}); C("cX", "Wardrobe", "linear", "ft", {});
    const I = (id, cond, pts, page) => P.items.push({id, cond, file: f, page: page || 1, kind: "shape", nos: 1, pts});
    I("i1", "cB", [[x, y], [x + 60 * k, y]]); I("i2", "cB", [[x, y + 20], [x + 40 * k, y + 20]]); I("i3", "cP", [[x, y], [x + 100 * k, y]]);
    I("i4", "cS", [[x, y], [x + 20 * k, y], [x + 20 * k, y + 10 * k], [x, y + 10 * k]]); I("i5", "cK", [[x, y], [x + 100 * k, y]]); I("i6", "cD", [[x, y], [x + 30, y]]);
    Z.S.cond = "cB"; Z.refresh(); });
  await wait(300);
  const mat = id => T(id => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.id === id), r = Z.matCalc(c, Z.condTotals(c).net); return r && {err: r.err, basis: r.basis, kind: r.m.kind, mix: r.m.mix, rows: Object.fromEntries(r.rows.map(x => [x[0], x[1]]))}; }, id);

  console.log("materials from the condition's name");
  // 8" block wall: V = 100 × 10 × 0.667, block 8" × 8" × 12" solid (the library's solid block), 1:6
  { const r = await mat("cB"), V = 100 * 10 * (8 / 12), bl = 12 / 12, bw = 8 / 12, bh = 8 / 12, j = 0.375 / 12, N = V / ((bl + j) * (bh + j) * (8 / 12)), wet = V - N * bl * bw * bh, dry = wet * 1.27;
    ok(r && r.kind === "block" && r.mix === "1:6" && !r.err, '8" Block → block masonry 1:6 (read from the name)');
    ok(r.rows.Blocks === Math.ceil(N - 1e-9), `blocks: ${r.rows.Blocks} Nos (V ${V.toFixed(3)} cft / module)`);
    ok(near(r.rows["Dry mortar"], dry, 1e-6) && near(r.rows.Cement, dry / 7 / BAG, 1e-6) && near(r.rows.Sand, dry * 6 / 7, 1e-6), `mortar ${dry.toFixed(3)} cft dry → cement ${(dry / 7 / BAG).toFixed(2)} bags, sand ${(dry * 6 / 7).toFixed(3)} cft`);
    ok(/T 8" from the name/.test(r.basis), "wall thickness T read from the name and said so"); }
  // wall plaster ½" 1:4 on 1000 Sft
  { const r = await mat("cP"), dry = 1000 * 0.5 / 12 * 1.27;
    ok(r.kind === "plaster" && near(r.rows.Area, 1000, 1e-6) && near(r.rows["Dry mortar"], dry, 1e-6) && near(r.rows.Cement, dry / 5 / BAG, 1e-6) && near(r.rows.Sand, dry * 4 / 5, 1e-6), `plaster 1000 Sft × ½" 1:4 → cement ${(dry / 5 / BAG).toFixed(2)} bags, sand ${(dry * 0.8).toFixed(3)} cft`); }
  // RCC slab 200 Sft × 0.5 = 100 cft, 1:2:4
  { const r = await mat("cS"), dry = 100 * 1.54;
    ok(r.kind === "concrete" && r.mix === "1:2:4" && near(r.rows.Concrete, 100, 1e-6) && near(r.rows.Cement, dry / 7 / BAG, 1e-6) && near(r.rows.Sand, dry * 2 / 7, 1e-6) && near(r.rows["Crush (coarse aggregate)"], dry * 4 / 7, 1e-6),
      `RCC 100 cft 1:2:4 → cement ${(dry / 7 / BAG).toFixed(2)} bags, sand ${(dry * 2 / 7).toFixed(3)}, crush ${(dry * 4 / 7).toFixed(3)} cft`); }
  // 9" brick in cft: 100 × 0.75 × 10 = 750 cft, 9 × 4½ × 3 bricks, 1:4
  { const r = await mat("cK"), V = 750, l = 0.75, w = 0.375, h = 0.25, j = 0.375 / 12, N = V / ((l + j) * (w + j) * (h + j)), dry = (V - N * l * w * h) * 1.27;
    ok(r.kind === "brick" && r.rows.Bricks === Math.ceil(N - 1e-9) && near(r.rows.Cement, dry / 5 / BAG, 1e-6), `9" brick 750 cft → ${r.rows.Bricks} bricks, cement ${(dry / 5 / BAG).toFixed(2)} bags`); }
  ok((await mat("cD")) === null && (await mat("cX")) === null, "doors (count) and wardrobes: no materials");
  ok(await T(() => { const t = document.getElementById("props").textContent; return /Materials/.test(t) && /Cement/.test(t) && /bags/.test(t); }), "Properties of the selected condition show the Materials table");

  console.log("changed in Properties");
  await page.selectOption('#props select[data-matk="mix"]', "1:4"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cB").mat.mix === "1:4"), "mix changed to 1:4 and kept on the condition");
  ok((await mat("cB")).mix === "1:4", "materials worked out again with 1:4");
  await page.fill('#props input[data-matk="wst"]', "5"); await page.dispatchEvent('#props input[data-matk="wst"]', "change"); await wait(200);
  { const r = await mat("cB"), V = 100 * 10 * (8 / 12), bl = 12 / 12, bh = 8 / 12, j = 0.375 / 12, N = V / ((bl + j) * (bh + j) * (8 / 12));
    ok(r.rows.Blocks === Math.ceil(N * 1.05 - 1e-9), "5 % waste added to the blocks"); }
  await T(() => { const c = zdTakeoff.P.proj.conds.find(c => c.id === "cB"); c.h = ""; });
  ok(/Type Height H/.test((await mat("cB")).err), "no height on a length condition → asks for H, nothing guessed");
  await T(() => { const c = zdTakeoff.P.proj.conds.find(c => c.id === "cB"); c.h = 10; delete c.mat; zdTakeoff.refresh(); });

  console.log("T and H typed in the Materials section");
  await T(() => { const P = zdTakeoff.P.proj, k = P.scales[zdTakeoff.S.key].ptPerFt; P.conds.push({id: "cC", name: "Roof slab", type: "area", unit: "Sft", color: "#999999", sw: 2, h: "", t: "", faces: 1, dedMin: 0, mat: {kind: "concrete", mix: "1:2:4"}});
    P.items.push({id: "i9", cond: "cC", file: zdTakeoff.S.fileId, page: 1, kind: "shape", nos: 1, pts: [[60, 300], [60 + 10 * k, 300], [60 + 10 * k, 300 + 10 * k], [60, 300 + 10 * k]]}); zdTakeoff.S.cond = "cC"; zdTakeoff.S.sel = null; zdTakeoff.refresh(); });
  await wait(200);
  ok(/Type the thickness T/.test(await page.textContent("#props")) && (await page.locator('#props input[data-matk="T"]').count()) === 1, "concrete area with no T: a Thickness box right in Materials, and it says to type it there");
  await page.fill('#props input[data-matk="T"]', "6"); await page.dispatchEvent('#props input[data-matk="T"]', "change"); await wait(250);
  { const r = await mat("cC"), dry = 100 * 0.5 * 1.54;
    ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cC").t === 0.5) && near(r.rows.Concrete, 50, 1e-6) && near(r.rows.Cement, dry / 7 / BAG, 1e-6) && near(r.rows["Crush (coarse aggregate)"], dry * 4 / 7, 1e-6), `6" typed → T 0.500 ft; 100 Sft slab = 50.000 cft → cement ${(dry / 7 / BAG).toFixed(2)} bags, crush ${(dry * 4 / 7).toFixed(3)} cft`); }
  ok(/Cement/.test(await page.textContent("#props")), "the cement / sand / crush table shows at once");
  await T(() => { const P = zdTakeoff.P.proj; P.items = P.items.filter(i => i.id !== "i9"); P.conds = P.conds.filter(c => c.id !== "cC"); zdTakeoff.S.cond = "cB"; zdTakeoff.refresh(); });

  console.log("priced from the Cost Control rate library");
  ok(await T(() => /open SAJ QSCOST/.test(document.getElementById("props").textContent)), "no library in this browser → says where the rates come from, no rate made up");
  // a small test library (SAJ_QSCOST_v1, as the Rate Analysis app keeps it): resource rates with source and date, and one built-up item
  await T(() => { localStorage.setItem("SAJ_QSCOST_v1", JSON.stringify({set: {}, rates: [
      {code: "CEM", kind: "M", name: "Cement — OPC, 50 kg bag", unit: "Bag", rate: 1600, src: "TEST GRN 1, 01-Oct-2026", date: "2026-10-01", vs: "V"},
      {code: "SAND-CH", kind: "M", name: "Sand — Chenab", unit: "Cft", rate: 80, src: "TEST GRN 2, 01-Oct-2026", date: "2026-10-01", vs: "V"},
      {code: "CRSH-SG", kind: "M", name: "Crush — Sargodha", unit: "Cft", rate: 180, src: "TEST GRN 3, 01-Oct-2026", date: "2026-10-01", vs: "V"},
      {code: "BLK-S8", kind: "M", name: "Solid block 8x8x12", unit: "Nos", rate: 200, src: "TEST GRN 4, 01-Oct-2026", date: "2026-10-01", vs: "V"}],
    items: [{code: "RA-T1", desc: "Test slab", unit: "Sft", M: [{qty: 1, rate: 100}], L: [{qty: 1, rate: 50}], P: [{qty: 1, rate: 10}], wast: 5, acc: 0, trans: 0, oh: 10, prof: 10}]}));
    const Z = zdTakeoff; Z.P.proj.conds.find(c => c.id === "cS").ra = "RA-T1"; Z.S.cond = "cB"; Z.S.sel = null; });
  await page.waitForTimeout(3200); await T(() => zdTakeoff.refresh()); await wait(200);
  { const r = await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.id === "cB"), m = Z.matCalc(c, Z.condTotals(c).net), p = Z.matPriced(m); return {tot: p.tot, miss: p.miss, rows: p.rows.map(x => [x.n, x.q, x.R.rate || 0, x.R.code || ""])}; });
    const blk = r.rows.find(x => x[0] === "Blocks"), cem = r.rows.find(x => x[0] === "Cement"), snd = r.rows.find(x => x[0] === "Sand");
    ok(blk && blk[2] === 200 && blk[3] === "BLK-S8" && cem[2] === 1600 && snd[2] === 80, '8" solid block priced from BLK-S8, cement from CEM, sand from SAND-CH');
    ok(near(r.tot, blk[1] * 200 + cem[1] * 1600 + snd[1] * 80, 1e-6) && r.miss === 0, `material cost ${r.tot.toFixed(2)} PKR = Σ qty × library rate`); }
  ok(await T(() => { const t = document.getElementById("props").textContent; return /Material cost PKR/.test(t) && /BLK-S8, 01-Oct-2026/.test(t); }), "Properties: rate, library code and date on each row, and the material cost");
  await T(() => { const c = zdTakeoff.P.proj.conds.find(c => c.id === "cB"); c.mat = {kind: "block", mix: "1:6", bs: "16x8x8s"}; });
  ok(await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.id === "cB"); return /no library item/.test(Z.matPriced(Z.matCalc(c, Z.condTotals(c).net)).rows.find(x => x.n === "Blocks").R.na); }), "a block size the library does not carry is left unpriced, not priced as another size");
  await T(() => { delete zdTakeoff.P.proj.conds.find(c => c.id === "cB").mat; });

  console.log("bill: material / labour / equipment split");
  await T(() => { zdTakeoff.S.billSplit = true; zdTakeoff.S.billView = true; });
  { const l = await T(() => { const L = zdTakeoff.billLines().find(x => x.c.id === "cS" && x.kind === "cond"); return {rate: L.rate, comp: L.comp, qty: L.qty}; });
    ok(near(l.rate, 198, 1e-9) && l.comp && near(l.comp.mat, 105, 1e-9) && near(l.comp.lab, 50, 1e-9) && near(l.comp.eqp, 10, 1e-9) && near(l.comp.oth, 33, 1e-9), "RA rate 198 = material 105 (incl. 5 % waste) + labour 50 + equipment 10 + OH & profit 33"); }
  await T(() => { document.getElementById("vBill").click(); zdTakeoff.refresh(); }); await wait(200);
  ok(await T(() => { const t = document.querySelector("#bill table.split"); return !!t && /M 21,000\.00/.test(t.textContent) && /L 10,000\.00/.test(t.textContent) && /E 2,000\.00/.test(t.textContent); }), "bill table shows Material 21,000.00 and Labour 10,000.00 for the 200 Sft slab");
  { const tx = await T(() => { const Z = zdTakeoff, M = Z.matSummary(); return M.tot.map(x => x.n + "|" + (x.R.rate || 0)).join(";"); });
    ok(/Cement — OPC, 50 kg bag\|1600/.test(tx) && /Crush — Sargodha\|180/.test(tx), "whole-takeoff materials summary totals each library item"); }

  console.log("compact list and By page tree");
  await T(() => { zdTakeoff.S.condView = "tree"; zdTakeoff.refresh(); }); await wait(200);
  ok(await page.locator("#condList .ctr.root").first().isVisible() && /test-plans/.test(await page.locator("#condList .ctr.root").first().innerText()), "tree: the drawing file at the top");
  ok((await page.locator("#condList .ctr.pg").count()) >= 1, "tree: its page under it");
  ok((await page.locator('#condList .crow[data-cpg]').count()) === 5, "tree: the 5 measured conditions as thin rows under the page");
  ok(/Not measured yet/.test(await page.innerText("#condList")) && (await page.locator('#condList .crow:not([data-cpg])').count()) === 1, "the condition with no measurements under Not measured yet");
  ok(await T(() => { const r = document.querySelector('#condList .crow[data-cond="cP"]'); return r && r.getBoundingClientRect().height <= 24 && /1,000\.000/.test(r.innerText); }), "row is one thin line with the page quantity 1,000.000 Sft");
  await page.click('#condList .ctr.pg >> nth=0'); await wait(150);
  ok((await page.locator('#condList .crow[data-cpg]').count()) === 0, "clicking the page folds it");
  await page.click('#condList .ctr.pg >> nth=0'); await wait(150);
  await page.click('#condList .crow[data-cond="cS"] .cn'); await wait(250);
  ok(await T(() => zdTakeoff.S.cond === "cS"), "clicking a row selects its condition");
  await page.click('#condList [data-cview="list"]'); await wait(150);
  ok((await page.locator("#condList .crow").count()) === 6 && (await page.locator("#condList .ctr").count()) === 0, "Compact: one row per condition");
  ok(await T(() => localStorage.getItem("tkCondView") === "list"), "the view chosen is remembered");
  await page.click('#condList [data-cview="cards"]'); await wait(150);
  ok((await page.locator("#condList .cond").count()) === 6, "Cards: the cards as before");
  await page.click('#condList [data-cview="tree"]'); await wait(150);

  console.log("export legend");
  const leg = o => T(o => { const Z = zdTakeoff, b = Z.S.base, svg = Z.pageOverlaySvg(Z.S.fileId, Z.S.pageNo, 1, b.width, b.height, Object.assign({legend: "tr", lsz: "m", meas: true, lbl: false, mk: false}, o));
    const d = new DOMParser().parseFromString(svg, "image/svg+xml"), tx = [...d.querySelectorAll("text")].map(t => t.textContent), rc = [...d.querySelectorAll("rect")].find(r => r.getAttribute("fill") === "rgba(255,255,255,.93)");
    return {tx, w: rc ? +rc.getAttribute("width") : 0}; }, o);
  { const names = ['8" Block', "Wall Plaster", "RCC Slab", '9" Brick wall', "Door D-1"];
    const order = tx => names.slice().sort((a, b) => tx.indexOf(a) - tx.indexOf(b));
    let r = await leg({lord: "list"}); ok(names.every(n => r.tx.includes(n)) && JSON.stringify(order(r.tx)) === JSON.stringify(names), "legend in condition list order");
    r = await leg({lord: "name"}); ok(order(r.tx)[0] === '8" Block' && order(r.tx)[1] === '9" Brick wall' && order(r.tx)[4] === "Wall Plaster", "legend by name A → Z");
    r = await leg({lord: "qty"}); ok(order(r.tx)[0] === "Wall Plaster" && order(r.tx)[1] === '9" Brick wall' && order(r.tx)[4] === "Door D-1", "legend by quantity, largest first (1,000 Sft, 750 cft, 200, 100, 2)");
    r = await leg({lcols: ["qty", "unit"]}); ok(r.tx.includes("1,000.000") && r.tx.includes("Sft") && !r.tx.includes("PKR") && !r.tx.includes("BOQ"), "Quantity and Unit columns, no amount");
    r = await leg({lcols: ["qty", "unit", "amt"]}); ok(r.tx.includes("PKR") && r.tx.includes("39,600.00") && r.tx.filter(t => t === "—").length === 4, "Amount column: 200 Sft × RA rate 198 = 39,600.00; conditions with no rate show —, nothing made up");
    r = await leg({lcols: []}); ok(!r.tx.includes("1,000.000") && !r.tx.includes("Item"), "no columns ticked: names only");
    r = await leg({lq: false}); ok(!r.tx.includes("1,000.000"), "older setting 'no quantities' still honoured");
    r = await leg({lw: 420}); ok(near(r.w, 420, 0.5), "legend width set to 420 pt");
    const r2 = await leg({lw: 150}); ok(near(r2.w, 150, 0.5) && r2.tx.some(t => /…$/.test(t)), "a narrow legend shortens long names with …, never overflows"); }
  if (process.env.TK_SHOTS) { await T(() => { const Z = zdTakeoff, b = Z.S.base, d = document.createElement("div"); d.id = "legShot"; d.style.cssText = "position:fixed;left:0;top:0;z-index:99999;background:#fff;width:" + b.width + "px;height:" + b.height + "px";
      d.innerHTML = Z.pageOverlaySvg(Z.S.fileId, Z.S.pageNo, 1, b.width, b.height, {legend: "tr", lsz: "m", meas: true, lbl: false, mk: false, lord: "qty", lcols: ["boq", "qty", "unit", "amt"], lw: 330}).replace(/^<svg/, '<svg width="' + b.width + '" height="' + b.height + '"'); document.body.appendChild(d); });
    await page.locator("#legShot").screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-legend.png")}); await T(() => document.getElementById("legShot").remove()); }
  ok(await T(() => { const w = zdTakeoff.legendWidths(["symbol", "description", "qty"], 0.5); return Math.abs(w[1] - 0.5) < 1e-9 && Math.abs(w[0] + w[1] + w[2] - 1) < 0.002; }), "legend markup: description width share kept, other columns share the rest");

  console.log("Excel");
  { await T(() => zdTakeoff.refresh()); await page.click("#bExport"); await wait(); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), page.click("#exXls")]);
    const f = path.join(os.tmpdir(), "tkm_" + d.suggestedFilename()); await d.saveAs(f); const ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
    const bl = wb.getWorksheet("Bill"), ms = wb.getWorksheet("Materials"); let slab = null; bl.eachRow(r => { if (/RCC Slab/.test(String(r.getCell(3).value))) slab = r; });
    ok(bl && bl.getRow(1).getCell(11).value === "Material PKR" && bl.getRow(1).getCell(12).value === "Labour PKR" && slab && near(slab.getCell(11).value.result, 21000, 1e-6) && /E\d+\*105/.test(slab.getCell(11).value.formula), "Excel Bill: Material / Labour / Equipment / OH columns, as formulas (slab material = qty × 105)");
    let cem = null; if (ms) ms.eachRow(r => { if (/Cement — OPC/.test(String(r.getCell(1).value))) cem = r; });
    ok(ms && cem && cem.getCell(4).value === 1600 && /B\d+\*D\d+/.test(cem.getCell(5).value.formula) && /TEST GRN 1/.test(String(cem.getCell(7).value)), "Excel Materials sheet: cement with its library rate, formula and source"); }
  if (process.env.TK_SHOTS) { await T(() => { zdTakeoff.S.cond = "cP"; zdTakeoff.S.sel = null; zdTakeoff.refresh(); }); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-materials.png")});
    await T(() => { const b = document.getElementById("propsBox"); b.style.maxHeight = "80%"; }); await wait(100); await page.locator("#propsBox").screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-materials-props.png")});
    await T(() => { zdTakeoff.S.cond = "cB"; zdTakeoff.refresh(); document.getElementById("props").scrollTop = 9999; }); await wait(150); await page.locator("#propsBox").screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-materials-props2.png")});
    await page.locator("#bill").screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-bill-split.png")}); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

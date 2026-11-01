#!/usr/bin/env node
/* Browser tests for the PDF Takeoff Workbook (takeoff/workbook.js) and the bill's quantity types:
     - a wall in ft with H and T billed by its volume (cft, its Rate Analysis code priced per Cft), one with H only by its wall area,
       one with a rate typed per running foot kept in ft; Bill / summary as in the condition; the Excel Summary's bill quantity
     - the Workbook built from the takeoff: a row per condition, quantities live-linked (volume, wall area, area, count), rates from
       Rate Analysis; spreadsheet editing — a rate typed, a row inserted with a formula quantity on a workbook variable, undo / redo,
       cells pasted from Excel; markups to the grand total
     - live links follow the takeoff; a deleted condition's link is dead and listed by Check; a revision kept and compared; a rate
       build-up; Excel — Summary, a sheet per section, Quantities, Rate build-ups, with live formulas

     python -m http.server 8765 --bind 127.0.0.1        (from the repo root)
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_workbook.js */
const path = require("path"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);
const num = s => +String(s || "").replace(/[^\d.\-]/g, "");

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist and exceljs — see the header"); process.exit(2); }
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
  await page.click("#bNewProj"); await page.fill("#dlgName", "Workbook test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  // a rate library: MAS-CFT, block masonry per Cft = 2 bags × 100 + 1 day × 50 = 250
  await T(() => { localStorage.setItem("SAJ_QSCOST_v1", JSON.stringify({set: {profOnOh: false}, rates: [{code: "R-MAT", rate: 100, vs: "V", date: "2026-10-30", unit: "Bag"}, {code: "R-LAB", rate: 50, vs: "V", date: "2026-10-30", unit: "Day"}],
    items: [{code: "MAS-CFT", unit: "Cft", sub: "Block masonry", desc: "Block masonry 6 inch in cement sand mortar 1:6", M: [{ref: "R-MAT", qty: 2}], L: [{ref: "R-LAB", qty: 1}], P: [], wast: 0, oh: 0, prof: 0, acc: 0, trans: 0}]})); });
  await wait(3100);   // (the library is read again every 3 s)
  // block wall 100 ft (H 10, T 0.5, RA MAS-CFT) · partition 40 ft (H 10 only) · railing 25 ft (H 3.5, T 0.1, a rate typed per rft) ·
  // internal plaster 50 ft (Sft, H 10, 2 faces) · floor tile 20 × 10 · 3 doors
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, k = P.scales[Z.S.key].ptPerFt, x = 60, y = 60;
    const C = (id, name, type, unit, o) => P.conds.push(Object.assign({id, name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}, o));
    C("cW", "Block wall 6in", "linear", "ft", {h: 10, t: 0.5, ra: "MAS-CFT", group: "Masonry"}); C("cH", "Partition", "linear", "ft", {h: 10, group: "Masonry"});
    C("cK", "Railing", "linear", "ft", {h: 3.5, t: 0.1, rate: 1200, rateSrc: "Quote M/S Steel", rateDate: "2026-10-30", group: "Metal"});
    C("cP", "Internal plaster", "linear", "Sft", {h: 10, faces: 2, group: "Finishes"}); C("cF", "Floor tile", "area", "Sft", {group: "Finishes"}); C("cD", "Door D-1", "count", "Nos", {group: "Doors"});
    const I = (id, cond, pts, kind) => P.items.push({id, cond, file: f, page: 1, kind: kind || "shape", nos: 1, pts});
    I("i1", "cW", [[x, y], [x + 100 * k, y]]); I("i2", "cH", [[x, y + 20], [x + 40 * k, y + 20]]); I("i3", "cK", [[x, y + 40], [x + 25 * k, y + 40]]);
    I("i4", "cP", [[x, y + 60], [x + 50 * k, y + 60]]); I("i5", "cF", [[x, y + 80], [x + 20 * k, y + 80], [x + 20 * k, y + 80 + 10 * k], [x, y + 80 + 10 * k]]);
    I("i6", "cD", [[x, y + 120], [x + 30, y + 120], [x + 60, y + 120]]);
    Z.refresh(); });
  await wait(300);

  console.log("the bill's quantity: a wall by its volume, as its rate is priced");
  const bl = await T(() => Object.fromEntries(zdTakeoff.billLines().filter(l => l.kind === "cond").map(l => [l.c.id, {qty: +l.qty.toFixed(6), unit: l.unit, bq: l.bq, rate: l.rate, na: l.na || ""}])));
  ok(near(bl.cW.qty, 500) && /^cft$/i.test(bl.cW.unit) && bl.cW.bq === "vol" && near(bl.cW.rate, 250, 1e-6), "a wall in ft with H and T is billed by its volume: 100 × 10 × 0.5 = 500 cft at its Rate Analysis rate 250 / Cft → " + JSON.stringify(bl.cW));
  ok(near(bl.cH.qty, 400) && bl.cH.unit === "Sft" && bl.cH.bq === "area", "with H only, by its wall area: 40 × 10 = 400 Sft → " + JSON.stringify(bl.cH));
  ok(near(bl.cK.qty, 25) && bl.cK.unit === "ft" && !bl.cK.bq && bl.cK.rate === 1200, "a rate typed per running foot keeps it in ft (its amount does not change) → " + JSON.stringify(bl.cK));
  ok(near(bl.cP.qty, 1000) && bl.cP.unit === "Sft" && near(bl.cF.qty, 200) && bl.cD.qty === 3, "plaster in Sft (50 × 10 × 2 faces), tiles, a count — as before");
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cW")); }); await wait(300);   // (not awaited: it resolves when the dialog closes)
  ok(await page.isVisible("#cBq") && (await page.inputValue("#cBq")) === "", "the condition says what its bill and summary carry: Bill / summary as — Auto");
  await page.selectOption("#cBq", "len"); await page.click("#dlgOk"); await wait(300);
  const asLen = await T(() => { const l = zdTakeoff.billLines().find(x => x.c.id === "cW" && x.kind === "cond"); return {qty: l.qty, unit: l.unit, na: l.na || ""}; });
  ok(near(asLen.qty, 100) && /^ft$/i.test(asLen.unit) && /priced per Cft/.test(asLen.na), "Length chosen: billed per ft — and its Cft rate code says it does not fit → " + JSON.stringify(asLen));
  await T(() => { zdTakeoff.P.proj.conds.find(c => c.id === "cW").bq = ""; zdTakeoff.refresh(); });

  console.log("the Excel Summary carries the bill quantity");
  const dl = async sel => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), sel()]); const f = path.join(os.tmpdir(), "tkwb_" + d.suggestedFilename()); await d.saveAs(f); return f; };
  const ExcelJS = require(path.join(LIBS, "exceljs"));
  const xf = await dl(async () => { await page.click("#bExport"); await wait(); await page.click("#exXls"); });
  { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf); const sm = wb.getWorksheet("Summary"), hd = sm.getRow(1); let cq = 0, ca = 0; hd.eachCell((c, i) => { if (c.value === "Bill qty") cq = i; if (c.value === "Billed as") ca = i; });
    let r = null; sm.eachRow(x => { if (x.getCell(1).value === "Block wall 6in") r = x; });
    const q = r && r.getCell(cq).value;
    ok(cq && r && /^B\d+\*10\*0\.5$/.test(q.formula) && near(q.result, 500) && /Volume = L × H × T/.test(r.getCell(ca).value), "Summary: the wall's bill quantity beside its length — Volume = L × H × T, B × 10 × 0.5 = 500 cft → " + (q && q.formula)); }

  console.log("the Workbook built from the takeoff");
  await page.click("#vWb"); await wait(600);
  ok(/build it from the takeoff/.test(await page.innerText("#dlgT")), "a project with no workbook offers to build it from the takeoff");
  await page.selectOption("#wgHow", "folder"); await page.click("#dlgOk"); await wait(600);
  ok(await page.isVisible("#wbRoot"), "the Workbook opens full screen");
  const tree = await T(() => [...document.querySelectorAll("#wbRoot .wbTree .wbS span")].map(s => s.textContent));
  ok(tree[0] === "Summary" && ["Masonry", "Metal", "Finishes", "Doors"].every(g => tree.some(t => t.endsWith(g))), "sections by the conditions' groups: " + tree.join(" · "));
  const cell = (desc, ck) => T(([d, k]) => { const tr = [...document.querySelectorAll("#wbRoot .wbGrid tbody tr")].find(t => (t.querySelector('td[data-ck="desc"]') || {}).textContent.includes(d)); const td = tr && tr.querySelector(`td[data-ck="${k}"]`); return td ? td.textContent.trim() : null; }, [desc, ck]);
  const open = async name => { await page.click(`#wbRoot .wbTree .wbS:has-text("${name}")`); await wait(200); };
  await open("Masonry");
  ok(await cell("Block masonry 6 inch", "qty") === "⛓500.000" && /^cft$/i.test(await cell("Block masonry 6 inch", "unit")), "the wall's row: its description from the library, 500.000 cft live-linked (⛓)");
  ok(await cell("Block masonry 6 inch", "rate") === "RA250.00" && await cell("Block masonry 6 inch", "tot") === "125,000.00", "…its rate from Rate Analysis MAS-CFT: 250.00 → 125,000.00");
  ok(await cell("Partition", "qty") === "⛓400.000" && await cell("Partition", "unit") === "Sft", "the partition's wall area, 400.000 Sft");
  await open("Finishes");
  ok(await cell("Internal plaster", "qty") === "⛓1,000.000" && await cell("Floor tile", "qty") === "⛓200.000", "plaster 1,000.000 Sft, tiles 200.000 Sft");
  await open("Metal");
  ok(await cell("Railing", "rate") === "1,200.00" && await cell("Railing", "tot") === "30,000.00", "the railing's typed rate 1,200.00 per ft → 30,000.00");

  console.log("editing as a spreadsheet");
  await open("Masonry");
  await page.click('#wbRoot .wbGrid tr:has-text("Partition") td[data-ck="rate"]'); await page.keyboard.type("60"); await page.keyboard.press("Enter"); await wait(200);
  ok(await cell("Partition", "tot") === "24,000.00", "a rate typed in the cell: 400 × 60 = 24,000.00");
  const tot1 = await T(() => document.querySelector("#wbRoot .wbTot").textContent);
  ok(/Net 179,000\.00/.test(tot1) && /PKR 206,745\.00/.test(tot1), "net 125,000 + 24,000 + 30,000 = 179,000; overheads 5 % and profit 10 % → 206,745.00 → " + tot1);
  await page.click('#wbRoot [data-w="vars"]'); await wait(200); await page.click("#wbVa"); await page.fill('#wbVb tr:last-child [data-k="name"]', "WASTE"); await page.fill('#wbVb tr:last-child [data-k="e"]', "1.05"); await page.click("#dlgOk"); await wait(200);
  await page.click('#wbRoot .wbGrid tr:has-text("Partition") td[data-ck="desc"]'); await page.keyboard.press("Control+Enter"); await wait(200);
  await page.keyboard.type("X-1"); await page.keyboard.press("Tab"); await page.keyboard.type("Extra lintel"); await page.keyboard.press("Tab"); await page.keyboard.type("=2*3*WASTE"); await page.keyboard.press("Tab"); await page.keyboard.type("cft"); await page.keyboard.press("Tab"); await page.keyboard.type("100"); await page.keyboard.press("Enter"); await wait(250);
  ok(await cell("Extra lintel", "qty") === "6.300" && await cell("Extra lintel", "tot") === "630.00", "Ctrl+Enter a row; typed across with Tab: a formula quantity =2*3*WASTE (WASTE = 1.05) = 6.300 × 100 = 630.00");
  await page.keyboard.press("Control+z"); await wait(200);
  ok(await cell("Extra lintel", "tot") === "0.00", "Ctrl+Z takes back the last cell (the rate)");
  await page.keyboard.press("Control+y"); await wait(200);
  ok(await cell("Extra lintel", "tot") === "630.00", "Ctrl+Y puts it back");
  await page.keyboard.press("Control+Enter"); await wait(150); await page.keyboard.press("Escape"); await wait(150);   // (an empty row to paste into)
  await T(() => { const dt = new DataTransfer(); dt.setData("text/plain", "P-1\tPasted item\t12\tSft\t40\r\nP-2\tSecond pasted\t3\tNos\t500\r\n"); document.querySelector("#wbRoot .wbGridW").dispatchEvent(new ClipboardEvent("paste", {clipboardData: dt, bubbles: true})); });
  await wait(250);
  ok(await cell("Pasted item", "tot") === "480.00" && await cell("Second pasted", "tot") === "1,500.00", "two rows pasted from Excel (Code, Description, Qty, Unit, Rate): 480.00 and 1,500.00");

  console.log("live links, dead links, Check");
  await page.click('#wbRoot [data-w="close"]'); await wait(200);
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = P.scales[Z.S.key].ptPerFt; P.items.push({id: "i7", cond: "cW", file: Z.S.fileId, page: 1, kind: "shape", nos: 1, pts: [[60, 200], [60 + 20 * k, 200]]});
    P.conds = P.conds.filter(c => c.id !== "cD"); P.items = P.items.filter(i => i.cond !== "cD"); Z.refresh(); });
  await page.click("#vWb"); await wait(500); await open("Masonry");
  ok(await cell("Block masonry 6 inch", "qty") === "⛓600.000" && await cell("Block masonry 6 inch", "tot") === "150,000.00", "20 ft more wall measured: the workbook follows — 600.000 cft, 150,000.00");
  await page.click('#wbRoot [data-w="check"]'); await wait(300);
  const chk = await page.innerText("#dlgB");
  ok(/ERROR.*Door D-1.*link is dead.*deleted/s.test(chk), "the deleted door condition: its row's link is dead, listed by Check → " + chk.split("\n").find(l => /dead/.test(l)));
  await page.click("#dlgCancel"); await wait(150);

  console.log("revisions and compare");
  await page.click('#wbRoot [data-w="rev"]'); await wait(200); await page.fill("#wbRn", "Rev A"); await page.click("#dlgOk"); await wait(250);
  await page.click('#wbRoot .wbGrid tr:has-text("Partition") td[data-ck="rate"]'); await page.keyboard.type("70"); await page.keyboard.press("Enter"); await wait(200);
  const rid = await T(() => zdTakeoff.P.proj.wb.revs[0].id); await page.selectOption("#wbRoot .wbCmp", rid); await wait(200);
  ok(await cell("Partition", "dv") === "+4,000.00" && await cell("Partition", "pt") === "24,000.00", "compared with Rev A: the partition's previous total 24,000.00, variance +4,000.00");
  await page.selectOption("#wbRoot .wbF", "changed"); await wait(200);
  const shown = await T(() => [...document.querySelectorAll('#wbRoot .wbGrid tbody td[data-ck="desc"]')].map(t => t.textContent.trim()));
  ok(shown.length === 1 && /Partition/.test(shown[0]), "Changed since revision shows that row alone → " + shown.join(" · "));
  await page.selectOption("#wbRoot .wbF", "all"); await page.selectOption("#wbRoot .wbCmp", ""); await wait(150);

  console.log("a rate build-up");
  await open("Metal"); await page.click('#wbRoot .wbGrid tr:has-text("Railing") td[data-ck="desc"]'); await wait(150);
  await page.check('#wbRoot .wbPane input[name="wbRs"][value="bu"]'); await wait(250);
  ok(await cell("Railing", "rate") === "Σ1,200.00", "Build-up: the rate it had is its first line (1,200.00)");
  await page.click('#wbRoot .wbPane [data-badd]'); await wait(200);
  await page.selectOption('#wbRoot .wbPane [data-bl="1"][data-bf="k"]', "L"); await wait(150);
  await page.fill('#wbRoot .wbPane [data-bl="1"][data-bf="q"]', "0.5"); await page.press('#wbRoot .wbPane [data-bl="1"][data-bf="q"]', "Tab"); await wait(150);
  await page.fill('#wbRoot .wbPane [data-bl="1"][data-bf="r"]', "400"); await page.press('#wbRoot .wbPane [data-bl="1"][data-bf="r"]', "Tab"); await wait(150);
  await page.fill('#wbRoot .wbPane [data-bp="oh"]', "10"); await page.press('#wbRoot .wbPane [data-bp="oh"]', "Tab"); await wait(200);
  ok(await cell("Railing", "rate") === "Σ1,540.00" && await cell("Railing", "tot") === "38,500.00", "+ labour 0.5 × 400, OH 10 %: (1,200 + 200) × 1.10 = 1,540.00 → 25 ft = 38,500.00");

  if (process.env.TK_SHOTS) { await open("Masonry"); await page.click('#wbRoot .wbGrid tr:has-text("Block masonry") td[data-ck="qty"]'); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wb-sheet.png")});
    await page.click('#wbRoot .wbTree .wbS:has-text("Summary")'); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wb-summary.png")}); await open("Metal"); }   // (screenshots for a look, when asked)
  console.log("Excel");
  const wf = await dl(() => page.click('#wbRoot [data-w="xls"]'));
  { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(wf); const names = wb.worksheets.map(w => w.name);
    ok(["Summary", "Masonry", "Metal", "Finishes", "Doors", "Quantities", "Rate build-ups"].every(n => names.includes(n)), "sheets: " + names.join(", "));
    const ms = wb.getWorksheet("Masonry"); let w = null, tot = null; ms.eachRow(r => { if (/Block masonry 6 inch/.test(r.getCell(3).value)) w = r; if (/^Total Masonry/.test(r.getCell(3).value)) tot = r; });
    ok(w && near(w.getCell(4).value, 600) && near(w.getCell(6).value, 250) && /D\d+.*F\d+/.test(w.getCell(7).value.formula) && /Live from the takeoff/.test((nt => typeof nt === "string" ? nt : nt && nt.texts ? nt.texts.map(t => t.text).join("") : "")(w.getCell(4).note)), "a section sheet row: Qty 600 (noted live from the takeoff), Rate 250, Total = Qty × Rate");
    ok(tot && /^SUBTOTAL\(9,G\d+:G\d+\)$/.test(tot.getCell(7).value.formula), "the section's total: SUBTOTAL over its items");
    const sm = wb.getWorksheet("Summary"); let g = null; sm.eachRow(r => { if (r.getCell(3).value === "GRAND TOTAL") g = r; });
    const grand = num(await T(() => document.querySelector("#wbRoot .wbTot b:last-child").textContent));
    ok(g && near(g.getCell(4).value.result, grand, 0.01) && /^[DF]\d+$/.test(g.getCell(4).value.formula), "the Summary's grand total: a formula through the markups = " + (g && g.getCell(4).value.result));
    ok(wb.getWorksheet("Rate build-ups").rowCount > 2, "the rate build-up written out"); }

  await page.click('#wbRoot [data-w="close"]'); await wait(200);
  ok(!(await page.isVisible("#wbRoot")) && await T(() => zdTakeoff.P.proj.wb && zdTakeoff.P.proj.wb.secs.length === 4), "closed: back to the drawing, the workbook kept with the project");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

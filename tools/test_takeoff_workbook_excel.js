#!/usr/bin/env node
/* Browser tests for the PDF Takeoff Workbook's Excel-style grid and its Recover (takeoff/workbook.js):
     - columns: a heading picked selects the column (the status bar sums it), Alt+Shift+→ and a drag of the picked heading move it,
       its edge dragged resizes it (double-click fits it), hidden and shown again from the right-click menu, frozen; the Excel export
       follows the workbook's column order with its formulas on the right letters; Reset layout
     - rows: picked by their numbers (Shift: several), Alt+↓ and a drag of the numbers move them, dropped on a section of the tree they
       go into it; cut and pasted they move with their links
     - cells: the fill handle makes a series (A-1 → A-2, A-3), Ctrl+D fills down, a linked quantity copied and pasted keeps its link,
       Paste values only makes it a figure, Ctrl+Enter while typing fills the selection; Sort Z → A; Find and replace; the name box
       goes to a ref; a heading's rows collapse (and are deleted with it)
     - Recover: deleted rows and a deleted section back where they were (Recover all, Recover one), a version kept and restored, the
       project backups offered to the owner; undo kept when the workbook is closed and opened again; the right-click menu

     python -m http.server 8765 --bind 127.0.0.1        (from the repo root)
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_workbook_excel.js */
const path = require("path"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist and exceljs — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1500, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 200);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Workbook Excel test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  await T(() => { localStorage.setItem("SAJ_QSCOST_v1", JSON.stringify({set: {profOnOh: false}, rates: [{code: "R-MAT", rate: 100, vs: "V", date: "2026-10-30", unit: "Bag"}, {code: "R-LAB", rate: 50, vs: "V", date: "2026-10-30", unit: "Day"}],
    items: [{code: "MAS-CFT", unit: "Cft", sub: "Block masonry", desc: "Block masonry 6 inch in cement sand mortar 1:6", M: [{ref: "R-MAT", qty: 2}], L: [{ref: "R-LAB", qty: 1}], P: [], wast: 0, oh: 0, prof: 0, acc: 0, trans: 0}]})); });
  await wait(3100);   // (the library is read again every 3 s)
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
  await page.click("#vWb"); await wait(600); await page.selectOption("#wgHow", "folder"); await page.click("#dlgOk"); await wait(600);

  // helpers
  const G = "#wbRoot .wbSh";
  const cell = (desc, ck) => T(([d, k]) => { const tr = [...document.querySelectorAll("#wbRoot .wbSh tbody tr")].find(t => (t.querySelector('td[data-ck="desc"]') || {textContent: ""}).textContent.includes(d)); const td = tr && tr.querySelector(`td[data-ck="${k}"]`); return td ? td.textContent.trim() : null; }, [desc, ck]);
  const sel = (desc, ck) => `${G} tbody tr:has-text("${desc}") td[data-ck="${ck}"]`, gut = desc => `${G} tbody tr:has-text("${desc}") td.gut`, hd = k => `${G} thead th[data-hk="${k}"]`;
  const open = async name => { await page.click(`#wbRoot .wbTree .wbS:has-text("${name}")`); await wait(250); };
  const hdr = () => T(() => [...document.querySelectorAll("#wbRoot .wbSh thead th[data-hk]")].map(t => t.dataset.hk));
  const rows = name => T(n => zdTakeoff.P.proj.wb.secs.find(s => s.name === n).rows.map(r => r.desc), name);
  const wbv = () => T(() => JSON.parse(JSON.stringify(zdTakeoff.P.proj.wb.view)));
  const mi = t => T(t => { const b = [...document.querySelectorAll("#wbRoot .wbMenu button")].find(b => b.querySelector(".tx").textContent === t); if (b) b.click(); return !!b; }, t);
  const ctr = async s => { const b = await page.locator(s).first().boundingBox(); return {x: b.x + b.width / 2, y: b.y + b.height / 2, b}; };
  const mdrag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 3, a.y + 3); await page.mouse.move(b.x, b.y, {steps: 10}); await wait(120); await page.mouse.up(); await wait(300); };
  const clip = (type, text) => T(([t, x]) => { const dt = new DataTransfer(); if (x != null) dt.setData("text/plain", x); document.querySelector("#wbRoot .wbGridW").dispatchEvent(new ClipboardEvent(t, {clipboardData: dt, bubbles: true})); return dt.getData("text/plain"); }, [type, text]);
  const actDesc = () => T(() => { const a = document.querySelector("#wbRoot .wbSh td.act"); return a ? a.closest("tr").querySelector('td[data-ck="desc"]').textContent.trim() : null; });

  console.log("rows to work with");
  await open("Masonry");
  await page.click(sel("Partition", "rate")); await page.keyboard.type("60"); await page.keyboard.press("Enter"); await wait();
  await page.click(sel("Partition", "desc")); await page.keyboard.press("Control+Enter"); await wait(); await page.keyboard.press("Escape"); await wait();
  await clip("paste", "Z-1\tZinc item\t2\tNos\t50\r\nC-1\tCopper item\t10\tNos\t20\r\nB-1\tBrass item\t5\tNos\t300\r\n"); await wait(300);
  ok(JSON.stringify(await rows("Masonry")) === JSON.stringify(["Block masonry 6 inch in cement sand mortar 1:6", "Partition", "Zinc item", "Copper item", "Brass item"]), "Masonry: the wall, the partition and three rows pasted from Excel");

  console.log("columns: select, sum, move, resize, hide, freeze");
  await page.click(hd("tot")); await wait();
  const colSel = await T(() => ({rs: document.querySelectorAll('#wbRoot .wbSh tbody td.rs[data-ck="tot"]').length, other: document.querySelectorAll('#wbRoot .wbSh tbody td.rs:not([data-ck="tot"])').length, hs: !!document.querySelector('#wbRoot .wbSh th.hs[data-hk="tot"]'), st: document.querySelector("#wbRoot .wbSt").textContent}));
  ok(colSel.rs === 5 && !colSel.other && colSel.hs, "a column heading clicked selects the whole column (5 cells, its heading lit)");
  ok(/Sum 150,800\.00/.test(colSel.st) && /Count 5/.test(colSel.st), "the status bar sums the selection: 125,000 + 24,000 + 100 + 200 + 1,500 = 150,800.00 → " + colSel.st);
  await page.click(hd("qty")); await wait(); await page.keyboard.press("Alt+Shift+ArrowRight"); await wait(300);
  ok((await hdr()).slice(0, 7).join() === "ref,code,desc,unit,qty,rate,tot" && (await wbv()).order.indexOf("qty") > (await wbv()).order.indexOf("unit"), "Alt+Shift+→ moves the Quantity column right of Unit → " + (await hdr()).join(","));
  ok(await cell("Block masonry", "qty") === "⛓500.000" && await cell("Block masonry", "tot") === "125,000.00", "…the cells go with it: the wall's linked 500.000 cft, 125,000.00");
  { const a = await ctr(hd("qty")), u = await ctr(hd("unit")); await mdrag(a, {x: u.b.x + 6, y: u.y}); }
  ok((await hdr()).slice(0, 7).join() === "ref,code,desc,qty,unit,rate,tot", "the picked Quantity heading dragged left of Unit: back in its place → " + (await hdr()).join(","));
  { const b = await page.locator(`${hd("code")} .rz`).boundingBox(), a = {x: b.x + b.width / 2, y: b.y + b.height / 2}; await mdrag(a, {x: a.x + 60, y: a.y}); }
  const wCode = (await wbv()).w.code;
  ok(near(wCode, 180, 3), "the Code column's edge dragged 60 px: 120 → " + wCode + " px");
  await page.dblclick(`${hd("code")} .rz`); await wait(300);
  ok((await wbv()).w.code < wCode, "double-click on its edge fits it to its widest cell → " + (await wbv()).w.code + " px");
  await page.click(hd("ref"), {button: "right"}); await wait();
  ok(await page.isVisible("#wbRoot .wbMenu") && await mi("Hide column"), "a right-click on a heading opens its menu: Hide column");
  await wait(300);
  ok(!(await hdr()).includes("ref") && (await wbv()).hide.includes("ref") && /1 column hidden/.test(await page.innerText("#wbRoot .wbFi")), "Ref hidden (the status line says so)");
  await page.click('#wbRoot .wbBar [data-w="colshow"]'); await wait(300);
  ok((await hdr())[0] === "ref" && !(await wbv()).hide.length, "Show all brings it back");
  await page.click(hd("desc"), {button: "right"}); await wait(); await mi("Freeze up to this column"); await wait(300);
  const fz = await T(() => ({f: zdTakeoff.P.proj.wb.view.freeze, pos: getComputedStyle(document.querySelector('#wbRoot .wbSh tbody td[data-ck="desc"]')).position, q: getComputedStyle(document.querySelector('#wbRoot .wbSh tbody td[data-ck="qty"]')).position}));
  ok(fz.f === 3 && fz.pos === "sticky" && fz.q !== "sticky", "Freeze up to Description: Ref, Code and Description stay as the sheet scrolls across");
  await page.click('#wbRoot .wbBar [data-w="freeze"]'); await wait(300);
  ok((await wbv()).freeze === 0, "Freeze again: unfrozen");

  console.log("the Excel export follows the column order");
  await page.click(hd("rate")); await wait(); await page.keyboard.press("Alt+Shift+ArrowLeft"); await wait(200); await page.keyboard.press("Alt+Shift+ArrowLeft"); await wait(300);
  ok((await hdr()).slice(0, 7).join() === "ref,code,desc,rate,qty,unit,tot", "Rate moved before Quantity → " + (await hdr()).join(","));
  const dl = async act => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), act()]); const f = path.join(os.tmpdir(), "tkwbx_" + Date.now() + "_" + d.suggestedFilename()); await d.saveAs(f); return f; };
  const ExcelJS = require(path.join(LIBS, "exceljs"));
  { const f = await dl(() => page.click('#wbRoot [data-w="xls"]')), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ms = wb.getWorksheet("Masonry"), h = ms.getRow(3).values.slice(1);
    let w = null; ms.eachRow(r => { if (/Block masonry 6 inch/.test(String(r.getCell(3).value))) w = r; });
    ok(h.slice(0, 7).join(",") === "Ref,Code,Description,Rate,Qty,Unit,Total PKR", "the section sheet's columns in the workbook's order → " + h.join(","));
    ok(w && near(w.getCell(4).value, 250) && near(w.getCell(5).value, 500) && /ISNUMBER\(E\d+\).*ISNUMBER\(D\d+\)/.test(w.getCell(7).value.formula) && near(w.getCell(7).value.result, 125000), "…its Total = Qty (E) × Rate (D) = 125,000 → " + (w && w.getCell(7).value.formula)); }
  await page.click('#wbRoot [data-w="cols"]'); await wait(); await page.click("#wbLr"); await page.click("#dlgOk"); await wait(300);
  ok((await hdr()).slice(0, 7).join() === "ref,code,desc,qty,unit,rate,tot" && !Object.keys((await wbv()).w).length, "Columns… → Reset layout: the first order and widths");

  await page.click(hd("unit")); await wait();
  ok(await page.isVisible(`${hd("unit")} .wbHa [data-w="colright"]`), "a column picked by its heading shows ◀ ▶ on it");
  await page.click(`${hd("unit")} .wbHa [data-w="colright"]`); await wait(300);
  const afterR = (await hdr()).slice(0, 7).join();
  await page.click(`${hd("unit")} .wbHa [data-w="colleft"]`); await wait(300); await page.click(`${hd("unit")} .wbHa [data-w="colleft"]`); await wait(300);
  ok(afterR === "ref,code,desc,qty,rate,unit,tot" && (await hdr()).slice(0, 7).join() === "ref,code,desc,unit,qty,rate,tot", "▶ moves Unit right of Rate, ◀ ◀ moves it left of Quantity → " + (await hdr()).join(","));
  await page.click(`${hd("unit")} .wbHa [data-w="colright"]`); await wait(300);
  ok((await hdr()).slice(0, 7).join() === "ref,code,desc,qty,unit,rate,tot", "▶ puts it back");

  console.log("rows: pick by number, move, drag, drop on a section, cut and paste");
  await page.click(gut("Zinc item")); await page.click(gut("Copper item"), {modifiers: ["Shift"]}); await wait();
  ok(await T(() => document.querySelectorAll("#wbRoot .wbSh tbody td.gut.hs").length) === 2, "a row number picks the row, Shift+click another: two rows");
  await page.keyboard.press("Alt+ArrowDown"); await wait(300);
  ok((await rows("Masonry")).slice(2).join("|") === "Brass item|Zinc item|Copper item", "Alt+↓ moves them down past Brass");
  { const a = await ctr(gut("Zinc item")), b = await ctr(gut("Block masonry")); await mdrag(a, {x: b.x, y: b.b.y + 3}); }
  ok((await rows("Masonry")).join("|") === "Zinc item|Copper item|Block masonry 6 inch in cement sand mortar 1:6|Partition|Brass item", "dragged by their numbers to the top → " + (await rows("Masonry")).join(" · "));
  await page.click(gut("Brass item")); await wait();
  { const a = await ctr(gut("Brass item")), b = await ctr('#wbRoot .wbTree .wbS:has-text("Finishes")'); await mdrag(a, b); }
  ok(!(await rows("Masonry")).includes("Brass item") && (await rows("Finishes")).slice(-1)[0] === "Brass item", "a row dragged onto the tree's Finishes goes into that section");
  const wid = await T(() => zdTakeoff.P.proj.wb.secs[0].rows.find(r => /Block masonry/.test(r.desc)).id);
  await page.click(gut("Block masonry")); await wait(); await page.click(gut("Block masonry"), {button: "right"}); await wait(); await mi("Cut"); await wait();
  ok(await T(() => document.querySelectorAll("#wbRoot .wbSh td.gut.cut").length) === 1, "Cut: the row is marked to move");
  await page.click(sel("Zinc item", "desc")); await page.click(sel("Zinc item", "desc"), {button: "right"}); await wait(); await mi("Paste"); await wait(300);
  const mv = await T(() => { const r = zdTakeoff.P.proj.wb.secs[0].rows; return {d: r.map(x => x.desc.split(" ")[0]).join("|"), id: r[0].id, link: !!(r[0].qb && r[0].qb[0].link)}; });
  ok(mv.d === "Block|Zinc|Copper|Partition" && mv.id === wid && mv.link && await cell("Block masonry", "qty") === "⛓500.000", "…pasted above Zinc: the same row moved, still live-linked → " + mv.d);

  console.log("cells: fill handle, Ctrl+D, copy and paste with links, values, Ctrl+Enter");
  await page.click(sel("Zinc item", "code")); await page.keyboard.type("A-1"); await page.keyboard.press("Enter"); await wait();
  await page.click(sel("Zinc item", "code")); await wait();
  { const a = await ctr("#wbRoot .wbFh"), b = await ctr(sel("Partition", "code")); await mdrag(a, b); }
  ok(await cell("Copper item", "code") === "A-2" && await cell("Partition", "code") === "A-3", "the fill handle dragged down two rows: A-1 → A-2, A-3");
  await page.click(sel("Zinc item", "rate")); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("Control+d"); await wait(300);
  ok(await cell("Copper item", "tot") === "500.00" && await cell("Partition", "tot") === "20,000.00", "Ctrl+D fills Zinc's rate 50 down: Copper 10 × 50 = 500.00, Partition 400 × 50 = 20,000.00");
  await page.click(sel("Block masonry", "qty")); await wait();
  const copied = await clip("copy");
  await page.click(sel("Zinc item", "qty")); await clip("paste", copied); await wait(300);
  const zq = await cell("Zinc item", "qty");
  ok(copied === "500" && /^⛓500(\.0+)?$/.test(zq) && await T(() => { const r = zdTakeoff.P.proj.wb.secs[0].rows.find(r => r.desc === "Zinc item"); return !!(r.qb && r.qb[0].link.cond === "cW"); }), "the wall's linked quantity copied onto Zinc: pasted with its link (Excel gets the figure, " + copied + ") → " + zq);
  await page.click(sel("Zinc item", "qty"), {button: "right"}); await wait(); await mi("Paste values only"); await wait(300);
  const zv = await cell("Zinc item", "qty");
  ok(/^500(\.0+)?$/.test(zv) && await T(() => !zdTakeoff.P.proj.wb.secs[0].rows.find(r => r.desc === "Zinc item").qb), "Paste values only: the figure, no link → " + zv);
  await page.click(sel("Zinc item", "unit")); await page.click(sel("Partition", "unit"), {modifiers: ["Shift"]}); await page.keyboard.type("Nos"); await page.keyboard.press("Control+Enter"); await wait(300);
  ok(await T(() => zdTakeoff.P.proj.wb.secs[0].rows.filter(r => /Zinc|Copper|Partition/.test(r.desc)).every(r => r.unit === "Nos")), "Ctrl+Enter while typing: the entry goes into every cell of the selection");
  await page.keyboard.press("Control+z"); await wait(300);
  ok(await cell("Partition", "unit") === "Sft", "…and Ctrl+Z takes it back as one step");

  console.log("sort, find and replace, go to");
  await page.click(sel("Block masonry", "tot")); await page.click('#wbRoot [data-w="sortza"]'); await wait(300);
  ok((await rows("Masonry")).map(d => d.split(" ")[0]).join("|") === "Block|Zinc|Partition|Copper", "Z → A by Total: 125,000 · 25,000 · 20,000 · 500 → " + (await rows("Masonry")).map(d => d.split(" ")[0]).join(" · "));
  await page.keyboard.press("Control+h"); await wait(); await page.fill("#wbFr", "Copper"); await page.fill("#wbFw", "Bronze"); await page.click("#wbFall"); await wait();
  ok(/1 found/.test(await page.innerText("#wbFn")), "Find all: 1 found");
  await page.click("#dlgOk"); await wait(300);
  ok(await cell("Bronze item", "tot") === "500.00" && !(await rows("Masonry")).includes("Copper item"), "Replace all: Copper item → Bronze item");
  await page.click("#wbRoot .wbNm"); await page.keyboard.type("1.3"); await page.keyboard.press("Enter"); await wait(300);
  ok(await actDesc() === "Partition" && /^1\.3 · /.test(await page.inputValue("#wbRoot .wbNm")), "the name box: 1.3 goes to the third item of section 1 (Partition)");
  await page.click(sel("Partition", "rate")); await wait();
  ok(await page.inputValue("#wbRoot .wbFxI") === "50", "the formula bar shows what the active cell holds (50)");
  await page.click(sel("Block masonry", "qty")); await wait();
  ok(/^⛓ Block wall 6in · Volume/.test(await page.inputValue("#wbRoot .wbFxI")), "…for a linked quantity, its link in words → " + await page.inputValue("#wbRoot .wbFxI"));

  console.log("a heading's rows collapsed, deleted with it, Recover all");
  await page.click(sel("Block masonry", "desc")); await page.keyboard.press("Control+Shift+Enter"); await wait(); await page.keyboard.type("Group A"); await page.keyboard.press("Enter"); await wait(300);
  await page.click(`${G} tbody tr.head [data-fold]`); await wait(300);
  const fo = await T(() => ({n: document.querySelectorAll("#wbRoot .wbSh tbody tr[data-ri]").length, t: document.querySelector("#wbRoot .wbSh tbody tr.head").textContent}));
  ok(fo.n === 2 && /3 rows/.test(fo.t) && await cell("Group A", "tot") === "45,500.00", "Group A collapsed: its 3 rows folded under it, its total 45,500.00");
  await page.click(gut("Group A")); await page.keyboard.press("Control+Minus"); await wait(300);
  ok((await rows("Masonry")).length === 1, "the collapsed heading deleted with its rows");
  await page.click('#wbRoot [data-w="recover"]'); await wait(400);
  ok(/Deleted \(1\)/.test(await page.innerText("#wbRc")) && /4 rows/.test(await page.innerText("#wbRc")), "Recover lists them: 4 rows of Masonry");
  await page.click("#wbRc [data-rall]"); await wait(400);
  ok((await rows("Masonry")).map(d => d.split(" ")[0]).join("|") === "Block|Group|Zinc|Partition|Bronze" && await T(() => !zdTakeoff.P.proj.wb.bin.length), "Recover all: every row back where it was, the bin empty");
  await page.click('#wbRoot [data-w="unfoldall"]'); await wait(300);
  await open("Doors"); await page.click('#wbRoot [data-w="secdel"]'); await wait(); await page.click("#dlgOk"); await wait(300);
  ok(!(await T(() => zdTakeoff.P.proj.wb.secs.map(s => s.name))).includes("Doors"), "the Doors section deleted");
  await page.click('#wbRoot [data-w="recover"]'); await wait(400); await page.click('#wbRc [data-rone="0"]'); await wait(400); await page.click("#dlgCancel"); await wait();
  ok((await T(() => zdTakeoff.P.proj.wb.secs.map(s => s.name))).join("|") === "Masonry|Metal|Finishes|Doors", "Recover: the section back in its place, with its row");

  console.log("versions and undo");
  await page.click('#wbRoot [data-w="recover"]'); await wait(400); await page.click('#wbRc [data-tab="ver"]'); await wait();
  ok(/built from the takeoff/.test(await page.innerText("#wbRc")), "Versions: the workbook as it was when it was built from the takeoff is kept");
  ok(await page.isVisible('#wbRc [data-tab="bak"]'), "the owner can take the workbook back from a project backup too");
  await page.click("#wbRc [data-rkeep]"); await wait(800); await page.click("#dlgCancel"); await wait();
  await open("Masonry"); await page.click(sel("Partition", "rate")); await page.keyboard.type("99"); await page.keyboard.press("Enter"); await wait(300);
  ok(await cell("Partition", "tot") === "39,600.00", "Partition's rate changed: 400 × 99 = 39,600.00");
  await page.click('#wbRoot [data-w="recover"]'); await wait(400); await page.click('#wbRc [data-tab="ver"]'); await wait();
  ok(/kept by hand/.test(await page.innerText("#wbRc")), "…the version kept by hand is listed");
  await page.click('#wbRc [data-rver="0"]'); await wait(); await page.click("#dlgOk"); await wait(600);
  ok(await cell("Partition", "tot") === "20,000.00", "Restore that version: Partition back to 20,000.00");
  await page.click('#wbRoot [data-w="recover"]'); await wait(400); await page.click('#wbRc [data-tab="ver"]'); await wait();
  ok(/before a restore/.test(await page.innerText("#wbRc")), "…the workbook as it was before is kept as a version too");
  await page.click("#dlgCancel"); await wait();
  await page.click('#wbRoot [data-w="close"]'); await wait(300); await page.click("#vWb"); await wait(600); await open("Masonry");
  await page.keyboard.press("Control+z"); await wait(300);
  ok(await cell("Partition", "tot") === "39,600.00", "closed and opened again, Ctrl+Z still takes back the last step (the restore)");

  console.log("the right-click menu, a column inserted, Excel");
  await page.click(sel("Zinc item", "desc"), {button: "right"}); await wait();
  ok(await T(() => [...document.querySelectorAll("#wbRoot .wbMenu .tx")].map(t => t.textContent)).then(L => ["Insert row above", "Paste values only", "Fill down", "Move to section", "Recover what was deleted…"].every(t => L.includes(t))), "a right-click on a cell: Insert row above, Paste values, Fill down, Move to section, Recover…");
  await page.keyboard.press("Escape"); await wait();
  ok(!(await page.isVisible("#wbRoot .wbMenu")), "Escape closes it");
  await page.click(hd("desc"), {button: "right"}); await wait(); await mi("Insert a column right"); await wait(); await page.fill("#wbNc", "Remarks"); await page.click("#dlgOk"); await wait(300);
  const uk = await T(() => "u:" + zdTakeoff.P.proj.wb.cols[0].id);
  ok((await hdr()).slice(0, 5).join() === "ref,code,desc," + uk + ",qty", "Insert a column right of Description: Remarks");
  await page.click(sel("Zinc item", uk)); await page.click(sel("Bronze item", uk), {modifiers: ["Shift"]}); await page.keyboard.type("checked"); await page.keyboard.press("Control+Enter"); await wait(300);
  ok(await cell("Zinc item", uk) === "checked" && await cell("Partition", uk) === "checked" && await cell("Bronze item", uk) === "checked", "typed into three Remarks cells at once");
  { const f = await dl(() => page.click('#wbRoot [data-w="xls"]')), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ms = wb.getWorksheet("Masonry"), h = ms.getRow(3).values.slice(1);
    let w = null; ms.eachRow(r => { if (/Block masonry 6 inch/.test(String(r.getCell(3).value))) w = r; });
    ok(h.slice(0, 8).join(",") === "Ref,Code,Description,Remarks,Qty,Unit,Rate,Total PKR" && w && /ISNUMBER\(E\d+\).*ISNUMBER\(G\d+\)/.test(w.getCell(8).value.formula), "Excel: Remarks after Description, Total = E × G → " + (w && w.getCell(8).value.formula)); }

  if (process.env.TK_SHOTS) { await page.click(sel("Zinc item", "rate")); await page.click(sel("Bronze item", "tot"), {modifiers: ["Shift"]}); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wbx-range.png")});
    await page.click(sel("Zinc item", "desc"), {button: "right"}); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wbx-menu.png")}); await page.keyboard.press("Escape");
    await page.click('#wbRoot [data-w="recover"]'); await wait(400); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wbx-recover.png")}); await page.click("#dlgCancel");
    await page.click(hd("qty")); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "wbx-header.png"), clip: {x: 210, y: 100, width: 960, height: 240}}); }   // (screenshots for a look, when asked)
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

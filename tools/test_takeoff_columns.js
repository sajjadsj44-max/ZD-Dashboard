#!/usr/bin/env node
/* Browser tests for the PDF Takeoff custom columns and Apply to pages / typical floors:
     - custom columns (Bluebeam custom columns, OST extended properties): made in the Custom columns dialog (name, unit, formula
       of Q A P PD D L N H T and the other columns), checked there (a reserved name, a loop), worked out per condition, shown in
       the conditions list tooltip, the card, the measurement sheet's condition header and Properties; switched off per
       condition (Edit condition, and the dialog's grid); a formula that fails is #ERR with its message, never a broken page;
       one undo step; garbage sanitized by migrate(); the Excel Summary and Bill sheets carry them as live formulas on the
       quantity cell (the Excel form checked against the app's own figure for a set of formulas)
     - Apply to pages: from a condition's right-click menu and from a selection; the page picks (same sheet size, Typical);
       the same points at the same scale, the same real size on a page at another scale; what a page already has is skipped
       (also by the Typical copy); a count; one undo step; the palette has both commands

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_columns.js
*/
const path = require("path"), os = require("os");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

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
  await page.click("#bNewProj"); await page.fill("#dlgName", "Columns"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  const K = await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = P.scales[Z.S.key].ptPerFt, f = Z.S.fileId;
    P.conds.push({id: "cF", name: "Floor tiles", type: "area", unit: "Sft", color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 1},
                 {id: "cD", name: "Doors", type: "count", unit: "Nos", color: "#d03b3b", sw: 2, h: "", t: "", faces: 1, dedMin: 0});
    P.items.push({id: "iF", cond: "cF", file: f, page: 1, kind: "shape", nos: 1, pts: [[60, 60], [60 + 20 * k, 60], [60 + 20 * k, 60 + 10 * k], [60, 60 + 10 * k]]},
                 {id: "iD", cond: "cD", file: f, page: 1, kind: "shape", nos: 1, pts: [[300, 300], [330, 300], [360, 300]]});
    Z.S.cond = "cF"; Z.refresh(); return {k, f, p1: f + ":1", p2: f + ":2", p3: f + ":3"}; });
  await wait(300);

  console.log("custom columns — the dialog");
  ok(await page.isVisible("#bCols"), "an fx button for custom columns in the conditions panel header");
  await page.click("#bCols"); await wait(200);
  ok(/Custom columns/.test(await page.textContent("#dlgT")), "Custom columns dialog opens");
  const addCol = async (name, unit, f) => { await page.click("#colAdd"); await wait(80); const r = page.locator("#colB tr").last(); await r.locator('[data-k="name"]').fill(name); await r.locator('[data-k="unit"]').fill(unit); await r.locator('[data-k="formula"]').fill(f); };
  await addCol("Q", "Nos", "Q"); await page.click("#dlgOk"); await wait(100);
  ok(/not Q A P/.test(await page.textContent("#dlgErr")), "a column called Q (a variable) is refused");
  await page.locator('#colB [data-del="0"]').click(); await wait(80);
  await addCol("Tiles", "Nos", "Q / (2*2) * 1.05"); await addCol("Skirting", "ft", "P - 3*N"); await addCol("Boxes", "Nos", "ceil(Tiles / 10)"); await addCol("Spin", "", "Spun + 1"); await addCol("Spun", "", "Spin * 2");
  await page.click("#dlgOk"); await wait(100);
  ok(/comes back to itself/.test(await page.textContent("#dlgErr")), "two columns that use each other (a loop) are refused");
  ok((await page.textContent('#colB [data-pv="0"]')).trim().startsWith("52.5"), "the dialog previews Tiles for the condition now picked: 52.5");
  await page.locator('#colB [data-del="4"]').click(); await wait(60); await page.locator('#colB [data-del="3"]').click(); await wait(60);
  await addCol("Per door", "Sft", "Q / (N - 1)");   // N = 1 on the floor: division by zero → #ERR there
  await page.click("#dlgOk"); await wait(250);
  const cols = await T(() => zdTakeoff.P.proj.cols.map(x => x.name + "|" + x.unit + "|" + x.formula));
  ok(cols.join(";") === "Tiles|Nos|Q / (2*2) * 1.05;Skirting|ft|P - 3*N;Boxes|Nos|ceil(Tiles / 10);Per door|Sft|Q / (N - 1)", "saved: " + cols.join(" ; "));
  const V = id => T(id => zdTakeoff.colVals(zdTakeoff.P.proj.conds.find(c => c.id === id)).map(x => ({n: x.col.name, v: x.v, err: x.err || ""})), id);
  { const v = await V("cF"), g = n => v.find(x => x.n === n);
    ok(near(g("Tiles").v, 200 / 4 * 1.05, 1e-9), "Tiles = Q / (2*2) * 1.05 = 52.5 for 200 Sft");
    ok(near(g("Skirting").v, 60 - 3, 1e-9), "Skirting = P - 3*N = 57 ft (perimeter 60, one room)");
    ok(g("Boxes").v === 6, "Boxes = ceil(Tiles / 10) = 6 — a column used by another");
    ok(g("Per door").err && /not a number/.test(g("Per door").err), "Q / (N - 1) with N = 1: #ERR (" + g("Per door").err + ")"); }
  { const v = await V("cD"); ok(v.find(x => x.n === "Tiles").v === 3 / 4 * 1.05 && !v.find(x => x.n === "Per door").err, "the doors (count, Q = 3) get their own figures: Tiles " + v[0].v); }

  console.log("custom columns — where they show");
  { const tip = await T(() => document.querySelector('#condList [data-cond="cF"]').getAttribute("title"));
    ok(/Tiles = 52\.500 Nos/.test(tip) && /Skirting = 57\.000 ft/.test(tip) && /Per door = #ERR — /.test(tip), "conditions list tooltip: Tiles = 52.500 Nos, Skirting = 57.000 ft, Per door = #ERR — message"); }
  { const h = await T(() => { const tr = [...document.querySelectorAll("#sheet tr.ch")].find(t => /Floor tiles/.test(t.textContent)); return tr && {t: tr.textContent, err: (tr.querySelector(".ccol.err") || {}).title || ""}; });
    ok(h && /Tiles 52\.500/.test(h.t) && /Boxes 6/.test(h.t), "measurement sheet: the condition header shows Tiles 52.500 · Boxes 6");
    ok(h && /Per door #ERR/.test(h.t) && /not a number/.test(h.err), "measurement sheet: Per door #ERR, its message on hover"); }
  ok(await T(() => { const t = document.getElementById("props").textContent; return /Custom columns/.test(t) && /Skirting/.test(t) && /57\.000 ft/.test(t); }), "Properties of the condition: a Custom columns section");
  await T(() => { zdTakeoff.S.condView = "cards"; zdTakeoff.refresh(); }); await wait(100);
  ok(await T(() => /Tiles 52\.500/.test(document.querySelector('#condList .cond[data-cond="cF"]').textContent)), "Cards view: the figures under the condition");
  await T(() => { zdTakeoff.S.condView = "tree"; zdTakeoff.refresh(); });

  console.log("custom columns — a bad formula never breaks the page");
  await T(() => { const P = zdTakeoff.P.proj; P.cols.push({id: "xBad", name: "Junk", unit: "", formula: "Q +* ) alert(1)"}); zdTakeoff.refresh(); }); await wait(100);
  ok(await T(() => /Junk #ERR/.test(document.getElementById("sheet").textContent) && /Junk = #ERR/.test(document.querySelector('#condList [data-cond="cF"]').title)), "garbage in a formula: #ERR in the sheet and the tooltip, the rest still drawn");
  await T(() => { const P = zdTakeoff.P.proj; P.cols = P.cols.filter(x => x.id !== "xBad"); zdTakeoff.refresh(); });

  console.log("custom columns — switched on / off per condition");
  const tilesId = await T(() => zdTakeoff.P.proj.cols[0].id);
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cD")); }); await wait(200);
  ok(await page.locator("[data-ccol]").count() === 4, "Edit condition lists the 4 columns with tick boxes");
  await page.uncheck(`[data-ccol="${tilesId}"]`); await page.click("#dlgOk"); await wait(200);
  { const c = await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cD").cols); ok(Array.isArray(c) && c.length === 3 && !c.includes(tilesId), "Doors: Tiles switched off (c.cols keeps the other 3)"); }
  ok(!(await V("cD")).some(x => x.n === "Tiles") && (await V("cF")).some(x => x.n === "Tiles"), "Doors no longer show Tiles; the floor still does");
  await page.click("#bCols"); await wait(200);
  ok(!(await page.isChecked(`#colG [data-on="cD|${tilesId}"]`)) && await page.isChecked(`#colG [data-on="cF|${tilesId}"]`), "the dialog's Shown for grid shows the same");
  await page.check(`#colG [data-on="cD|${tilesId}"]`); await page.click("#dlgOk"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === "cD").cols === undefined), "ticked again in the grid: every column on — none listed, so new columns show too");
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.id === "cD")); }); await wait(150); await page.uncheck(`[data-ccol="${tilesId}"]`); await page.click("#dlgOk"); await wait(150);

  console.log("custom columns — undo, migrate");
  await page.click("#bCols"); await wait(150); await page.locator('#colB [data-del="2"]').click(); await page.click("#dlgOk"); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.cols.length === 3), "a column deleted");
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.cols.length === 4 && zdTakeoff.P.proj.cols[2].name === "Boxes"), "Ctrl+Z brings it back (one step)");
  { const r = await T(() => { const rep = [], p = {v: 2, files: [], items: [], conds: [{id: "c1", name: "A", type: "area", unit: "Sft", color: "#123456", cols: ["x1", "nope", 7]}, {id: "c2", name: "B", type: "area", unit: "Sft", color: "#123456", cols: "all"}],
      cols: [{id: "x1", name: "Tiles", unit: "Nos", formula: "Q/4"}, {id: "x2", name: "tiles", formula: "2"}, {id: "x3", name: "Q", formula: "1"}, "junk", {id: "x4", name: 42}, {id: "x1", name: "Grout", unit: {}, formula: {}}, {name: "Bags", formula: 3}]};
      zdTakeoff.migrate(p, rep); return {cols: p.cols, c1: p.conds[0].cols, c2: "cols" in p.conds[1], rep, empty: (() => { const q = {v: 2, cols: "garbage"}; zdTakeoff.migrate(q); return q.cols; })(), none: (() => { const q = {v: 2}; zdTakeoff.migrate(q); return q.cols; })()}; });
    ok(r.cols.length === 2 && r.cols[0].name === "Tiles" && r.cols[0].formula === "Q/4" && r.cols[1].name === "Bags" && r.cols[1].formula === "3" && r.cols[1].id && r.cols[1].unit === "", "migrate: a repeated name, a reserved name, a non-object, a number name and a bad formula left out; a numeric formula kept as text, a missing id given");
    ok(JSON.stringify(r.c1) === '["x1"]' && !r.c2, "migrate: a condition's unknown column ids dropped, a non-list c.cols removed");
    ok(r.rep.some(x => /Custom column/.test(x)) && Array.isArray(r.empty) && !r.empty.length && Array.isArray(r.none) && !r.none.length, "migrate: repairs reported; cols that are not a list (or missing) become []"); }

  console.log("custom columns — the Excel form of a formula");
  { const r = await T(() => { const F = ["Q - 3*N", "-2^2", "(-2)^2", "ceil(-2.5) + floor(2.5) * 10", "round(Q / 3, 2)", "round(Q / 3)", "min(1, Q, 3) + max(4, 5)", "sqrt(16) / abs(-2)", "Q / (2*2) * 1.05", "2^3^2", "+Q - -N", "1.5e2 + .5"], m = {Q: "B5", N: "7"};
      return F.map(f => ({f, x: zdTakeoff.colXl(f, K => m[K] != null ? m[K] : null), v: zdTakeoff.evalFormula(f, {Q: 200, N: 7})})); });
    const xl = (s, Q) => { const js = s.replace(/B5/g, String(Q)).replace(/\^/g, "**").replace(/\bINT\(/g, "Math.floor(").replace(/\bROUND\(/g, "RND(").replace(/\b(MIN|MAX|ABS|SQRT)\(/g, (a, b) => "Math." + b.toLowerCase() + "(");
      return Function("RND", "return " + js)((x, d) => { const p = 10 ** d, y = Math.abs(x) * p; return Math.sign(x) * Math.round(y) / p; }); };   // the test's own stand-in for Excel (not the app)
    const bad = r.filter(o => !o.x || !near(xl(o.x, 200), o.v, 1e-9));
    ok(!bad.length, "12 formulas: the Excel form gives the app's figure (" + r.length + " checked" + (bad.length ? "; wrong: " + bad.map(o => o.f + " → " + o.x).join(", ") : "") + ")");
    ok(await T(() => zdTakeoff.colXl("[Floor tiles].A * 2", () => null) === null && zdTakeoff.colXl("Q * Z", K => K === "Q" ? "B5" : null) === null), "another condition's figure, or a name with no cell: no live formula (the value is written)"); }

  console.log("custom columns — Excel export");
  { await page.click("#bExport"); await wait(); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), page.click("#exXls")]);
    const f = path.join(os.tmpdir(), "tkc_" + d.suggestedFilename()); await d.saveAs(f); const ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
    const sm = wb.getWorksheet("Summary"), bl = wb.getWorksheet("Bill"), hd = sm.getRow(1);
    ok(hd.getCell(5).value === "Tiles (Nos)" && hd.getCell(6).value === "Skirting (ft)" && hd.getCell(7).value === "Boxes (Nos)" && hd.getCell(8).value === "Per door (Sft)", "Summary sheet: one column per custom column, with its unit");
    let fr = null, dr = null; sm.eachRow((r, n) => { if (r.getCell(1).value === "Floor tiles") fr = r; if (r.getCell(1).value === "Doors") dr = r; });
    const n = fr.number, c5 = fr.getCell(5).value, c6 = fr.getCell(6).value, c7 = fr.getCell(7).value;
    ok(/^Measurement!H\d+$/.test(fr.getCell(2).value.formula), "the quantity is the live link to the Measurement sheet's total");
    ok(c5 && c5.formula && c5.formula.includes("B" + n) && near(c5.result, 52.5, 1e-9), `Tiles: live formula on the quantity cell — =${c5 && c5.formula} (${c5 && c5.result})`);
    ok(c6 && c6.formula && /60/.test(c6.formula) && near(c6.result, 57, 1e-9), `Skirting: the perimeter written as its figure — =${c6 && c6.formula}`);
    ok(c7 && c7.formula && c7.formula.includes("E" + n) && c7.result === 6, `Boxes: on the Tiles cell of the same row — =${c7 && c7.formula}`);
    ok(fr.getCell(8).value === "#ERR" && /not a number/.test(String(fr.getCell(8).note && (fr.getCell(8).note.texts ? fr.getCell(8).note.texts.map(t => t.text).join("") : fr.getCell(8).note))), "Per door: #ERR with the message as the cell's note");
    ok(dr && (dr.getCell(5).value == null || dr.getCell(5).value === "") && dr.getCell(6).value && dr.getCell(6).value.formula, "Doors: Tiles blank (switched off), Skirting worked out");
    let br = null; bl.eachRow(r => { if (/^Floor tiles$/.test(String(r.getCell(3).value))) br = r; });
    ok(bl.getRow(1).getCell(15).value === "Tiles (Nos)" && br && br.getCell(15).value.formula.includes("E" + br.number) && near(br.getCell(15).value.result, 52.5, 1e-9), "Bill sheet: the same columns on the condition's line, on its quantity (E)");
    const bq = await T(() => { const l = zdTakeoff.billLines().find(x => x.kind === "cond" && x.name === "Floor tiles"); return l ? l.qty : null; });
    ok(br && br.getCell(5).value === +bq.toFixed(9) && br.getCell(5).numFmt === "#,##0.000", "Bill sheet: Qty is the figure itself (" + br.getCell(5).value + "), shown to 3 dp — the columns work from what the cell holds"); }

  console.log("apply to pages — from a condition's right-click menu");
  const onP = (k, c) => T(([k, c]) => zdTakeoff.P.proj.items.filter(i => i.file + ":" + i.page === k && (!c || i.cond === c)), [k, c]);
  await page.click('#condList [data-cond="cF"]', {button: "right"}); await wait(150);
  ok(await T(() => /Apply to pages \/ typical floors… \(1 on this page\)/.test(document.getElementById("ctx").textContent)), "right-click a condition: Apply to pages / typical floors… (1 on this page)");
  await page.locator("#ctx .ci", {hasText: "Apply to pages"}).click(); await page.waitForSelector("#apPaper", {timeout: 10000}); await wait(100);
  await page.click("#apPaper"); await wait(50);
  ok(!(await page.isChecked('[data-cp="0"]')) && await page.isChecked('[data-cp="1"]'), "Same sheet size ticks p.3 (842 × 595) and not p.2 (A3)");
  await page.click("#dlgOk"); await wait(300);
  { const a = await onP(K.p3, "cF"), src = await onP(K.p1, "cF");
    ok(a.length === 1 && a[0].pts.every((p, j) => near(p[0], src[0].pts[j][0], 1e-6) && near(p[1], src[0].pts[j][1], 1e-6)) && a[0].copied && a[0].copied.how === "apply to pages" && a[0].qa === "", "p.3: the room at the same points, marked copied, not checked");
    ok(/Applied to 1 of 1 page: 1 copy/.test(await page.textContent("#toast")), "toast: " + (await page.textContent("#toast"))); }
  await T(() => { zdTakeoff.copyToPagesDialog("cF"); }); await page.waitForSelector("#apPaper"); await page.click("#apPaper"); await page.click("#dlgOk"); await wait(300);
  ok((await onP(K.p3, "cF")).length === 1 && /Nothing added — 1 already there/.test(await page.textContent("#toast")), "applied again: nothing doubled — " + (await page.textContent("#toast")));

  console.log("apply to pages — another scale, a selection, a count, Typical");
  await T(k => { zdTakeoff.P.proj.scales[k] = {ptPerFt: 4.32, how: "manual", text: "test", verified: true}; }, K.p2);
  const undo0 = await T(() => zdTakeoff.S.undo.length);
  await T(() => { zdTakeoff.setSel(["iF", "iD"]); }); await T(() => { zdTakeoff.copyToPagesDialog(); }); await page.waitForSelector("#apAll");
  ok(/other scale: drawn × 0\.480/.test(await page.textContent("#dlgB")), "the A3 page at another scale is said so in the list (× 0.480)");
  await page.click("#apAll"); await page.click("#dlgOk"); await wait(300);
  ok(await T(() => zdTakeoff.S.undo.length) === undo0 + 1, "one undo step for the whole apply");
  { const r = await T(k => { const Z = zdTakeoff, P = Z.P.proj, it = P.items.find(i => i.file + ":" + i.page === k && i.cond === "cF"), src = P.items.find(i => i.id === "iF"), all = src.pts.concat(P.items.find(i => i.id === "iD").pts), xs = all.map(p => p[0]), ys = all.map(p => p[1]), A = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], f = 4.32 / P.scales[Z.S.key].ptPerFt;
      return {q: Z.rowsOf(it, 4.32).reduce((a, x) => a + x.qty, 0), ok: it.pts.every((p, j) => Math.abs(p[0] - (A[0] + (src.pts[j][0] - A[0]) * f)) < 1e-6 && Math.abs(p[1] - (A[1] + (src.pts[j][1] - A[1]) * f)) < 1e-6)}; }, K.p2);
    ok(near(r.q, 200, 0.01) && r.ok, `p.2 at 4.32 pt/ft: the room keeps its real size (${r.q.toFixed(3)} Sft), the selection scaled about its own centre`); }
  ok((await onP(K.p2, "cD")).length === 1 && (await onP(K.p2, "cD"))[0].pts.length === 3 && (await onP(K.p3, "cD")).length === 1 && (await onP(K.p3, "cF")).length === 1, "the doors (count) copied to p.2 and p.3; p.3's room skipped (already there)");
  ok(/2 copies on p|Applied to 2 of 2 pages: 3 copies · 1 skipped/.test(await page.textContent("#toast")), "toast: " + (await page.textContent("#toast")));
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok((await onP(K.p2)).length === 0 && (await onP(K.p3, "cD")).length === 0 && (await onP(K.p3, "cF")).length === 1, "Ctrl+Z takes the whole apply back in one step");
  await T(k => { zdTakeoff.P.proj.sheets[k] = {no: "A-103", title: "Typical floor plan"}; zdTakeoff.setSel(["iD"]); }, K.p3);
  await T(() => { zdTakeoff.copyToPagesDialog(); }); await page.waitForSelector("#apTyp"); await page.click("#apTyp"); await wait(50);
  ok(!(await page.isChecked('[data-cp="0"]')) && await page.isChecked('[data-cp="1"]'), "Typical sheets: ticks the page whose Sheet info says Typical");
  await page.click("#dlgCancel"); await wait(100);

  console.log("typical floors (whole page) — not doubled when run twice");
  { const r = await T(([k3]) => { const Z = zdTakeoff, P = Z.P.proj, mine = P.items.filter(i => i.file + ":" + i.page === Z.S.key), o = Z.allPages().find(x => x.key === k3), n0 = P.items.length;
      Z.typCommit(mine, [{o, T: null}], false); const n1 = P.items.length; Z.typCommit(mine, [{o, T: null}], false); return {n0, n1, n2: P.items.length, mine: mine.length}; }, [K.p3]);
    ok(r.n1 - r.n0 === r.mine - 1 && r.n2 === r.n1, `Typical copy: ${r.n1 - r.n0} new (the room already there skipped), and run again nothing added`); }

  console.log("palette");
  ok(await T(() => { const L = zdTakeoff.paletteCmds().map(c => c.t); return L.some(t => /^Apply to pages \/ typical floors/.test(t)) && L.some(t => /^Custom columns/.test(t)); }), "palette: Apply to pages / typical floors… and Custom columns…");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

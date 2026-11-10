#!/usr/bin/env node
/* Browser test: the advanced legend — every column worked out by hand on a small takeoff, totals, groups, filters, formula columns,
   renamed headers, the PlanSwift look's columns, Ask (plain words) and Smart columns, the settings window, Copy table / CSV.
     python -m http.server 8765 --bind 127.0.0.1 ; TK_LIBS=/path/with/node_modules node tools/test_takeoff_legendpro.js  (TK_URL for another port)
   Scale 10 pt per ft. FLOOR (area, H 10, T 0.25): a 20 × 10 ft room with a 2 × 2 ft cut-out — A 196, P 60, gross 200, deducted 4, volume 49,
   girth × H 600. WALL (length in Sft, H 10, T 0.75, 2 faces): a 30 ft run — L 30, wall area 600, volume 225. DOORS (count): 3 points. */
const path = require("path"), pw = require("playwright");
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  const T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 250);
  await T(() => document.getElementById("bProjects").click()); await wait(400); await page.click("#bNewProj"); await page.fill("#dlgName", "Legend pro"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000});
  await T(() => { const p = zdTakeoff.P.proj, f = p.files[0].id; p.scales[f + ":1"] = {ptPerFt: 10, how: "calibrated", verified: true};
    p.conds.push({id: "CF", name: "FLOOR", type: "area", unit: "Sft", color: "#3366cc", group: "Finishes", faces: 1, h: 10, t: 0.25, boq: "A1"},
      {id: "CW", name: "WALL", type: "linear", unit: "Sft", color: "#cc3333", group: "Masonry", faces: 2, h: 10, t: 0.75, rate: 100},
      {id: "CD", name: "DOORS", type: "count", unit: "Nos", color: "#22aa44", group: "Finishes", faces: 1});
    p.items.push({id: "I1", cond: "CF", file: f, page: 1, kind: "shape", nos: 1, label: "", pts: [[100, 100], [300, 100], [300, 200], [100, 200]], qa: "checked"},
      {id: "I2", cond: "CF", file: f, page: 1, kind: "ded", nos: 1, label: "", pts: [[120, 120], [140, 120], [140, 140], [120, 140]]},
      {id: "I3", cond: "CW", file: f, page: 1, kind: "shape", nos: 1, label: "", pts: [[100, 300], [400, 300]]},
      {id: "I4", cond: "CD", file: f, page: 1, kind: "shape", nos: 1, label: "", pts: [[10, 10], [20, 20], [30, 30]]});
    p.marks.push({id: "LG", type: "legend", file: f, page: 1, pts: [[400, 30], [800, 230]], look: "table", title: "Takeoff Legend", columns: ["symbol", "description", "qty", "unit"], precision: 2, fontSize: 9, rowH: 18, refW: 400, sort: "list"}); });
  const V = (cols, extra) => T(([cols, extra]) => { const Z = zdTakeoff, m = Object.assign({}, Z.P.proj.marks.find(x => x.id === "LG"), extra || {}), rows = Z.legendRows(m);
    return rows.map(r => r.sec != null ? {sec: r.sec} : {nm: r.tot ? "TOTAL" : r.c.name, v: Object.fromEntries(cols.map(id => [id, Z.legVal({id}, r, m).s]))}); }, [cols, extra]);
  console.log("columns, by hand");
  const R = await V(["qty", "length", "area", "warea", "height", "thick", "volume", "gross", "ded", "pdoor", "n", "nos", "faces", "checked", "pages", "group", "boq", "amount"]), row = n => (R.find(x => x.nm === n) || {}).v || {};
  const F = row("FLOOR"), W = row("WALL"), D = row("DOORS");
  ok(F.qty === "196.00" && F.area === "196.00 Sft", "FLOOR: quantity and area 196 Sft (200 − the 4 Sft cut-out) — " + F.qty + " / " + F.area);
  ok(F.length === "60.00 ft" && F.warea === "600.00 Sft", "FLOOR: length = its perimeter 60 ft; wall area = girth × H = 600 Sft (" + F.length + ", " + F.warea + ")");
  ok(F.gross === "200.00 Sft" && F.ded === "4.00 Sft" && F.volume === "49.00 cft", "FLOOR: gross 200, deducted 4, volume A × T = 49 cft (" + [F.gross, F.ded, F.volume].join(", ") + ")");
  ok(F.height === "10.00 ft" && F.thick === "0.25 ft" && F.checked === "1/1" && F.n === "1" && F.group === "Finishes" && F.boq === "A1", "FLOOR: height, thickness, checked 1/1, 1 measurement, group, BOQ (" + [F.height, F.thick, F.checked, F.n].join(", ") + ")");
  ok(W.length === "30.00 ft" && W.warea === "600.00 Sft" && W.area === "600.00 Sft" && W.volume === "225.00 cft" && W.faces === "2", "WALL: 30 ft, wall area 30 × 10 × 2 = 600 Sft, volume 30 × 10 × 0.75 = 225 cft, 2 faces (" + [W.length, W.warea, W.volume, W.faces].join(", ") + ")");
  ok(W.amount === "60,000.00" && F.amount === "—", "WALL: amount = quantity × rate (600 × 100); FLOOR has no rate: — (" + W.qty + ", " + W.amount + ")");
  ok(D.nos === "3" && D.length === "—" && D.area === "—" && D.pages === "1", "DOORS: Nos 3, no length or area (" + [D.nos, D.length, D.pages].join(", ") + ")");
  console.log("rows: totals, groups, filters");
  const Tt = await V(["qty", "area", "nos"], {totals: true}), tot = Tt.find(x => x.nm === "TOTAL");
  ok(tot && tot.v.area === "796.00 Sft" && tot.v.qty === "" && tot.v.nos === "5", "totals row: area 196 + 600 = 796 Sft; quantity left blank (Sft and Nos); Nos 1 + 1 + 3 = 5 (" + JSON.stringify(tot && tot.v) + ")");
  const G = await V(["qty"], {group: "type"});
  ok(G.map(x => x.sec || x.nm).join(",") === "Areas,FLOOR,Lengths,WALL,Counts,DOORS", "grouped by type: " + G.map(x => x.sec || x.nm).join(","));
  const G2 = await V(["qty"], {group: "group"});
  ok(G2.map(x => x.sec || x.nm).join(",") === "Finishes,FLOOR,DOORS,Masonry,WALL", "grouped by condition group: " + G2.map(x => x.sec || x.nm).join(","));
  const Fl = await V(["qty"], {types: ["area", "count"]});
  ok(Fl.map(x => x.nm).join(",") === "FLOOR,DOORS", "only areas and counts: " + Fl.map(x => x.nm).join(","));
  console.log("formula columns, renamed headers");
  const Fo = await V(["f:t1", "f:t2"], {fcols: [{id: "t1", name: "Tiles", expr: "Q / 4 * 1.05", unit: "Nos"}, {id: "t2", name: "Bad", expr: "Q +", unit: ""}]}), fl = (Fo.find(x => x.nm === "FLOOR") || {v: {}}).v;
  ok(fl["f:t1"] === "51.45 Nos", "formula Tiles = Q / 4 * 1.05 → 51.45 Nos on FLOOR (" + fl["f:t1"] + ")");
  ok(fl["f:t2"] === "#ERR", "a broken formula shows #ERR, the legend still draws");
  const Hd = await T(() => zdTakeoff.legendCols(Object.assign({}, zdTakeoff.P.proj.marks.find(x => x.id === "LG"), {colLabels: {qty: "Qty (net)"}})).map(c => c.label).join("|"));
  ok(Hd === "Symbol|Description|Qty (net)|Unit", "a column renamed on the legend: " + Hd);
  console.log("drawing it");
  const svg = await T(() => { const Z = zdTakeoff, m = Object.assign({}, Z.P.proj.marks.find(x => x.id === "LG"), {columns: ["symbol", "description", "qty", "unit", "warea", "volume"], totals: true}); return Z.legendSvg(m, p => p); });
  ok(/600\.00 Sft/.test(svg) && /225\.00 cft/.test(svg) && />Total</.test(svg), "the table look draws the new columns and the totals row");
  const ps = await T(() => { const Z = zdTakeoff, m = Object.assign({}, Z.P.proj.marks.find(x => x.id === "LG"), {look: "ps", psCols: ["height", "thick"], totals: true}); return Z.legendSvg(m, p => p); });
  ok(/10\.00 ft/.test(ps) && /0\.75 ft/.test(ps) && />Total</.test(ps), "the PlanSwift look draws its chosen columns (height, thickness) and the totals row");
  console.log("Ask and Smart columns");
  const A = await T(() => { const st = {look: "table", tbl: ["symbol", "description", "qty", "unit", "rate"], ps: [], totals: false, group: "", sort: "drawing", types: [], hideZero: false, prec: 2, fs: 9, title: "L"};
    const said = zdTakeoff.legAsk("add wall area, height and thickness, remove rate, totals, group by type, sort by quantity, only areas and lengths, title Ground floor finishes", st, []); return {st, said}; });
  ok(A.st.tbl.join(",") === "symbol,description,qty,unit,warea,height,thick", "Ask: + wall area, height, thickness; − rate → " + A.st.tbl.join(","));
  ok(A.st.totals && A.st.group === "type" && A.st.sort === "qty" && (A.st.types || []).join() === "area,linear" && A.st.title === "Ground floor finishes", "Ask: totals, group by type, sort by quantity, only areas and lengths, the title (" + A.said.join(" · ") + ")");
  const A2 = await T(() => { const st = {look: "ps", tbl: [], ps: ["height"], prec: 2, fs: 9}; zdTakeoff.legAsk("only volume and nos; no totals; 1 decimals", st, []); return st; });
  ok(A2.ps.join(",") === "volume,nos" && A2.totals === false && A2.prec === 1, "Ask: only volume and Nos (PlanSwift look), no totals, 1 decimal (" + A2.ps.join(",") + ")");
  const Sm = await T(() => { const Z = zdTakeoff, m = Z.P.proj.marks.find(x => x.id === "LG"); return Z.legSmart(Z.legendRows(m), "table").join(","); });
  ok(/perim/.test(Sm) && /height/.test(Sm) && /warea/.test(Sm) && /volume/.test(Sm) && /nos/.test(Sm) && /amount/.test(Sm), "✨ Smart columns from what the legend holds: " + Sm);
  console.log("the settings window");
  await T(() => { zdTakeoff.editLegend(zdTakeoff.P.proj.marks.find(x => x.id === "LG")); }); await wait(300);
  const nc = await page.locator("#dlgB #lgCols .lgc").count();
  ok(nc > 20, "the column manager lists every column (" + nc + ")");
  await page.fill("#lgAsk", "add wall area and volume, totals, group by type"); await page.click("#lgAskGo"); await wait(200);
  const said = await page.textContent("#lgAskSay");
  ok(/Done:/.test(said), "Ask in the window says what it did: " + said.slice(0, 100));
  await page.click("#lgFAdd"); await wait(100); await page.fill('#lgF [data-ff="name"]', "Tiles"); await page.fill('#lgF [data-ff="expr"]', "ceil(Q / 4)"); await page.dispatchEvent('#lgF [data-ff="name"]', "change");
  await page.click("#dlgOk"); await wait(400);
  const m = await T(() => JSON.parse(JSON.stringify(zdTakeoff.P.proj.marks.find(x => x.id === "LG"))));
  ok(m.columns.includes("warea") && m.columns.includes("volume") && m.totals && m.group === "type" && m.fcols && m.fcols[0].name === "Tiles" && m.columns.includes("f:" + m.fcols[0].id), "Save keeps the columns, totals, group and the formula column (" + m.columns.join(",") + ")");
  const tb = await T(() => zdTakeoff.legTable(zdTakeoff.P.proj.marks.find(x => x.id === "LG")));
  ok(tb[0].includes("Wall area") && tb[0].includes("Tiles") && tb.some(r => r.includes("Total")) && tb.some(r => r.includes("49.00 cft")), "Copy table / CSV: headers, rows and totals (" + tb.length + " lines: " + tb[0].join("|") + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

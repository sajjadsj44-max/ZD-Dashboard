#!/usr/bin/env node
/* Browser tests for PDF Takeoff floors: one sheet holding several floor plans (an AutoCAD drawing with the ground floor, the typical floor
   and the roof side by side) split by floor, so each floor's conditions and quantities are listed on their own.
     - Floor box (Takeoff → Floors): two corners round a plan, the floor named (Ground floor, then 1st floor …); Esc leaves the tool
     - the By page tree: under the page, one row per floor with that floor's conditions and quantities — they add up to the page;
       a count's markers split by boundary; the boundaries drawn on the sheet with their names
     - right-click → Move to floor (a cut-out goes with its outline), New floor…, back to the boundary
     - a floor's menu (⋯): rename, delete (measurements kept); the Floors dialog (📂): rename, order, found plans added in one undo step
     - "Find floor plans" on a page with no wall lines says so; names from plan titles
     - each floor its own conditions ("Room Area — Ground floor"): on / off, colour, deductions and totals per floor; a new
       measurement goes to the copy of the floor it is in; a floor renamed renames its copies; "One condition for all floors" undoes it

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_floors.js
*/
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
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
  const scr = ([x, y]) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (p, o = {}) => { const q = await scr(p); await page.mouse.move(q[0], q[1]); await wait(40); await page.mouse.down({button: o.button || "left"}); await page.mouse.up({button: o.button || "left"}); await wait(80); };
  const ctxPick = (...path) => T(path => { let ok = true; path.forEach(t => { const it = [...document.querySelectorAll("#ctx .ci")].find(x => { const ct = x.querySelector(":scope > .ct"); return ct && ct.textContent.replace(/^✓ /, "") === t; }); if (!it) { ok = false; return; } it.click(); }); return ok; }, path);
  const ctxTexts = () => T(() => [...document.querySelectorAll("#ctx .ci > .ct")].map(x => x.textContent.replace(/^✓ /, "")));
  /* the By page tree as {floor name: {condition name: quantity}} for a page ("" = No floor), from what is on screen */
  const tree = () => T(() => { const out = {}; let cur = null;
    document.querySelectorAll("#condList .ctree > *").forEach(el => { if (el.matches(".ctr.fl")) { cur = out[el.dataset.fl] = {}; return; } if (el.matches(".ctr")) { cur = null; return; }
      if (cur && el.matches(".crow")) cur[el.querySelector(".cn").textContent] = parseFloat(el.querySelector(".cq").textContent.replace(/,/g, "")); });
    return out; });
  /* the measurements of a condition and of its floors' own copies */
  const fam = id => T(id => zdTakeoff.P.proj.items.filter(i => { const c = zdTakeoff.P.proj.conds.find(x => x.id === i.cond); return c && (c.id === id || c.src === id); }).map(i => i.id), id);

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Floors"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  await T(() => { const Z = zdTakeoff; Z.S.condView = "tree"; });

  // two "plans" side by side on page 1: left x 40–400, right x 440–800 (page points, y down). Room Area: 20 × 10 ft on the left with a
  // 4 × 5 ft cut-out, 10 × 10 ft on the right; Wall: 30 ft left, 15 ft right; Doors: 2 markers left, 1 right — one count measurement
  const G = await T(() => { const Z = zdTakeoff, P = Z.P.proj, k = P.scales[Z.S.key].ptPerFt, f = Z.S.fileId;
    const C = (id, name, type, unit) => P.conds.push({id, name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0});
    C("cA", "Room Area", "area", "Sft"); C("cW", "Wall", "linear", "ft"); C("cD", "Doors", "count", "Nos");
    const I = (id, cond, pts, kind) => P.items.push({id, cond, file: f, page: 1, kind: kind || "shape", nos: 1, pts});
    const R = (x, y, w, h) => [[x, y], [x + w * k, y], [x + w * k, y + h * k], [x, y + h * k]];
    I("a1", "cA", R(80, 150, 20, 10)); I("d1", "cA", R(90, 160, 4, 5), "ded"); I("a2", "cA", R(480, 150, 10, 10));
    I("w1", "cW", [[80, 380], [80 + 30 * k, 380]]); I("w2", "cW", [[480, 380], [480 + 15 * k, 380]]);
    I("n1", "cD", [[100, 330], [140, 330], [520, 330]]);
    Z.S.cond = "cA"; Z.refresh(); return {k, pk: Z.S.key}; });
  await wait(300);
  console.log("scale 1 ft = " + G.k.toFixed(3) + " pt");

  console.log("a page with no floors: as before");
  ok(await T(() => !document.querySelector("#condList .ctr.fl")) && await T(() => !!document.querySelector('#condList .ctr.pg [data-flfind]')), "no floor rows; the page row has the 📂 Split by floor button");
  ok(await T(() => document.querySelectorAll('#tools [data-rp="takeoff"] [data-fn="floors"], #tools [data-rp="takeoff"] [data-tool="floorbox"]').length === 2), "Takeoff tab: Floors and Floor box");

  console.log("Floor box: two corners round each plan, then the floor's name");
  await page.click('[data-rtab="takeoff"]'); await page.click('[data-rp="takeoff"] [data-tool="floorbox"]'); await wait();
  ok(await T(() => zdTakeoff.S.tool === "floorbox") && /Floor box/.test(await page.innerText("#stHint")), "the Floor box tool is on, with its hint");
  await click([40, 100]); await click([400, 420]); await wait(400);
  ok(await page.isVisible("#dlgBack.on") && (await page.inputValue("#flNm")) === "Ground floor", "first floor offered as “Ground floor”");
  await page.keyboard.press("Enter"); await wait(300);
  let F = await T(pk => (zdTakeoff.P.proj.floors[pk] || []).map(f => ({name: f.name, r: f.r})), G.pk);
  ok(F.length === 1 && F[0].name === "Ground floor" && near(F[0].r[0], 40, 0.5) && near(F[0].r[3], 420, 0.5), "Ground floor added with its boundary");
  ok(await T(() => zdTakeoff.S.tool === "floorbox"), "the tool stays on for the next plan");
  await click([440, 100]); await click([800, 420]); await wait(400);
  ok((await page.inputValue("#flNm")) === "1st floor", "the next one offered as “1st floor”");
  await page.keyboard.press("Enter"); await wait(300);
  await page.keyboard.press("Escape"); await wait();
  ok(await T(() => zdTakeoff.S.tool === "select"), "Esc leaves the Floor box tool");
  F = await T(pk => (zdTakeoff.P.proj.floors[pk] || []).map(f => f.name), G.pk);
  ok(F.join("|") === "Ground floor|1st floor", "two floors on the page: " + F.join(", "));

  console.log("the By page tree splits the page by floor");
  let t = await tree();
  ok(Object.keys(t).join("|") === "Ground floor|1st floor", "floor rows under the page: " + Object.keys(t).join(", "));
  ok(near(t["Ground floor"]["Room Area"], 180) && near(t["Ground floor"].Wall, 30) && t["Ground floor"].Doors === 2, `Ground floor: Room Area ${t["Ground floor"]["Room Area"]} (200 − 20 cut-out), Wall ${t["Ground floor"].Wall}, Doors ${t["Ground floor"].Doors}`);
  ok(near(t["1st floor"]["Room Area"], 100) && near(t["1st floor"].Wall, 15) && t["1st floor"].Doors === 1, `1st floor: Room Area ${t["1st floor"]["Room Area"]}, Wall ${t["1st floor"].Wall}, Doors ${t["1st floor"].Doors}`);
  { const D = await fam("cD"); ok(D.length === 2 && await T(D => D.reduce((a, id) => a + zdTakeoff.P.proj.items.find(i => i.id === id).pts.length, 0), D) === 3, "the count's markers were split by boundary (2 + 1), none lost"); }
  ok(await T(() => { const Z = zdTakeoff; return Math.abs(Z.P.proj.conds.filter(c => c.id === "cA" || c.src === "cA").reduce((a, c) => a + Z.condTotals(c).net, 0) - 280) < 0.01; }), "the condition's total over its floors is unchanged (280 Sft)");
  ok(await T(() => { const P = zdTakeoff.P.proj, n = i => P.conds.find(c => c.id === P.items.find(x => x.id === i).cond).name; return n("a1") === "Room Area — Ground floor" && n("d1") === "Room Area — Ground floor" && n("a2") === "Room Area — 1st floor" && n("w2") === "Wall — 1st floor"; }),
    "each floor has its own conditions: Room Area — Ground floor (with its cut-out), Room Area — 1st floor, Wall — 1st floor");
  ok(await T(() => document.querySelectorAll("#ov .flbox, svg .flbox").length >= 2), "both boundaries drawn on the sheet");
  ok(await T(() => [...document.querySelectorAll("svg text")].some(x => x.textContent === "Ground floor")), "with the floor's name");
  // fold a floor
  await page.click('#condList .ctr.fl[data-fl="Ground floor"] b'); await wait();
  t = await tree(); ok(Object.keys(t["Ground floor"]).length === 0 && Object.keys(t["1st floor"]).length === 3, "a click folds a floor");
  await page.click('#condList .ctr.fl[data-fl="Ground floor"] b'); await wait();

  console.log("right-click → Move to floor");
  await T(() => zdTakeoff.setTool("select")); await click([80 + 15 * G.k, 380], {button: "right"}); await wait(200);
  ok((await ctxTexts()).includes("Move to floor"), "the right-click menu of a measurement has Move to floor");
  ok(await ctxPick("Move to floor", "1st floor"), "Move to floor ▸ 1st floor"); await wait(250);
  ok(await T(() => zdTakeoff.P.proj.items.find(i => i.id === "w1").floor === "1st floor"), "the run is in 1st floor (its own floor now)");
  t = await tree(); ok(near(t["1st floor"].Wall, 45) && !t["Ground floor"].Wall, "tree: Wall 45 ft on 1st floor, none on Ground floor");
  await T(() => zdTakeoff.setSel(["a1"])); await T(() => { const Z = zdTakeoff; Z.floorMove(["a1"], "1st floor"); });
  ok(await T(() => { const P = zdTakeoff.P.proj; return P.items.find(i => i.id === "a1").floor === "1st floor" && P.items.find(i => i.id === "d1").floor === "1st floor"; }), "an area's cut-out goes with it");
  t = await tree(); ok(near(t["1st floor"]["Room Area"], 280) && !t["Ground floor"]["Room Area"], "tree: Room Area 280 on 1st floor");
  await page.keyboard.press("Control+z"); await wait(200);
  t = await tree(); ok(near(t["Ground floor"]["Room Area"], 180) && near(t["1st floor"]["Room Area"], 100), "Ctrl+Z puts the area and its cut-out back");
  await click([80 + 15 * G.k, 380], {button: "right"}); await wait(200);
  ok(await ctxPick("Move to floor", "Out of the floor set by hand (by its boundary again)"), "Move to floor ▸ out of the floor set by hand"); await wait(250);
  t = await tree(); ok(near(t["Ground floor"].Wall, 30) && near(t["1st floor"].Wall, 15), "the run is back in Ground floor by its boundary");
  await click([80 + 15 * G.k, 380], {button: "right"}); await wait(200);
  ok(await ctxPick("Move to floor", "New floor…"), "Move to floor ▸ New floor…"); await wait(250);
  ok((await page.inputValue("#flNm")) === "2nd floor", "a new floor offered as “2nd floor”");
  await page.fill("#flNm", "Roof"); await page.keyboard.press("Enter"); await wait(300);
  t = await tree(); ok(Object.keys(t).join("|") === "Ground floor|1st floor|Roof" && near(t.Roof.Wall, 30), "a floor “Roof” with no boundary holds the run: " + Object.keys(t).join(", "));

  console.log("a floor's menu (⋯)");
  await page.click('#condList .ctr.fl[data-fl="1st floor"] [data-flmenu]'); await wait(200);
  const mt = await ctxTexts();
  ok(["Zoom to it", "Rename…", "Redraw its boundary", "Remove its boundary (keep the floor)", "Move up", "Move down", "Floors on this page…", "Delete this floor (its measurements are kept)"].every(x => mt.includes(x)), "zoom, rename, boundary, order, delete");
  await ctxPick("Rename…"); await wait(200);
  await page.fill("#flNm", "First floor"); await page.keyboard.press("Enter"); await wait(300);
  t = await tree(); ok("First floor" in t && !("1st floor" in t) && near(t["First floor"]["Room Area"], 100), "renamed: First floor keeps its quantities");
  ok(await T(() => zdTakeoff.locOf(zdTakeoff.P.proj.items.find(i => i.id === "a2")).floor === "First floor"), "the bill / Excel see the new name (locOf)");
  await page.click('#condList .ctr.fl[data-fl="Roof"]', {button: "right"}); await wait(200);
  ok(await ctxPick("Delete this floor (its measurements are kept)"), "right-click a floor row → Delete this floor"); await wait(300);
  t = await tree(); ok(!("Roof" in t) && near(t["Ground floor"].Wall, 30) && await T(() => zdTakeoff.P.proj.items.some(i => i.id === "w1")), "Roof deleted; its run is kept, back in Ground floor");
  await page.dblclick('#condList .ctr.fl[data-fl="First floor"] b'); await wait(300);
  ok(await T(() => { const Z = zdTakeoff, S = Z.S, st = document.getElementById("stage"), x = (440 + 800) / 2 * S.view.s + S.view.tx; return Math.abs(x - st.clientWidth / 2) < 3; }), "double-click a floor zooms to its boundary");

  console.log("the Floors dialog (📂)");
  await page.click('#condList .ctr.pg [data-flfind]'); await wait(400);
  ok(await page.isVisible("#dlgBack.on") && (await page.innerText("#dlgT")) === "Floors" && (await page.locator("#dlgB [data-flname]").count()) === 2, "lists the page's two floors");
  await page.fill('#dlgB [data-flname="1"]', "Typical 1st to 8th floor"); await page.dispatchEvent('#dlgB [data-flname="1"]', "change"); await wait(250);
  ok(await T(pk => zdTakeoff.P.proj.floors[pk][1].name === "Typical 1st to 8th floor", G.pk), "renamed in the dialog");
  await page.click('#dlgB [data-fla="up"][data-i="1"]'); await wait(300);
  ok(await T(pk => zdTakeoff.P.proj.floors[pk].map(f => f.name).join("|") === "Typical 1st to 8th floor|Ground floor", G.pk), "▲ moves it up");
  t = await tree(); ok(Object.keys(t).join("|") === "Typical 1st to 8th floor|Ground floor", "the tree follows the order");
  await page.click("#dlgCancel"); await wait();
  ok(await T(() => zdTakeoff.floorNext(zdTakeoff.S.key)) === "9th floor", "the next floor after “Typical 1st to 8th floor” is offered as 9th floor");

  console.log("the legend, floor by floor");
  const lgOf = () => T(() => { const Z = zdTakeoff; return Z.P.proj.marks.filter(m => m.type === "legend").map(m => ({id: m.id, floor: m.floor || "", pts: m.pts, title: Z.legendTitle(m), rows: Z.legendRows(m).map(r => r.sec != null ? "§" + r.sec : (r.nm || r.c.name) + "=" + (+r.q).toFixed(2))})); });
  await page.click('#condList .ctr.pg [data-flfind]'); await wait(400);
  ok(await page.isVisible('#dlgB [data-fla="legs"]') && await page.isVisible('#dlgB [data-fla="leg1"]'), "the Floors dialog offers a legend for each floor, and one split by floor");
  await page.click('#dlgB [data-fla="legs"]'); await wait(400);
  let LG = await lgOf();
  ok(LG.length === 2 && LG.map(l => l.floor).sort().join("|") === "Ground floor|Typical 1st to 8th floor", "a legend for each floor: " + LG.map(l => l.floor).join(", "));
  { const g = LG.find(l => l.floor === "Ground floor"), t2 = LG.find(l => l.floor !== "Ground floor");
    ok(g && g.rows.join("|") === "Room Area=180.00|Wall=30.00|Doors=2.00", "Ground floor's legend lists its own quantities: " + (g && g.rows.join(", ")));
    ok(t2 && t2.rows.join("|") === "Room Area=100.00|Wall=15.00|Doors=1.00", "the typical floor's legend lists its own: " + (t2 && t2.rows.join(", ")));
    ok(g.title === "Takeoff Legend — Ground floor", "titled with the floor: " + g.title);
    const fy = Math.min(g.pts[0][1], g.pts[1][1]), r = await T(pk => zdTakeoff.P.proj.floors[pk].find(f => f.name === "Ground floor").r, G.pk);
    ok(Math.min(g.pts[0][0], g.pts[1][0]) >= r[0] - 0.5 && Math.max(g.pts[0][0], g.pts[1][0]) <= r[2] + 0.5 && fy >= r[1] - 400, "placed at its floor's boundary");
    ok(await T(() => [...document.querySelectorAll("svg text")].some(x => x.textContent === "Takeoff Legend — Ground floor")), "drawn on the sheet with its title"); }
  ok(await T(() => zdTakeoff.floorLegends(zdTakeoff.S.key)) === 0, "asked again: none added (each floor has its legend)");
  await page.keyboard.press("Control+z"); await wait(250);
  ok((await lgOf()).length === 0, "one Ctrl+Z takes both back");
  await T(() => zdTakeoff.floorLegendSplit(zdTakeoff.S.key)); await wait(300);
  LG = await lgOf();
  ok(LG.length === 1 && LG[0].floor === "*" && LG[0].rows.join("|") === "§Typical 1st to 8th floor|Room Area=100.00|Wall=15.00|Doors=1.00|§Ground floor|Room Area=180.00|Wall=30.00|Doors=2.00", "one legend split by floor: a section for each, in the floors' order");
  ok(await T(id => { const Z = zdTakeoff, m = Z.P.proj.marks.find(x => x.id === id), h = Math.abs(m.pts[1][1] - m.pts[0][1]), svg = Z.legendSvg0(m, p => p, 1); return h >= (m.look === "ps" ? Z.legendRows(m).length * m.rowH : 10 * 18) && /Typical 1st to 8th floor/.test(svg) && /Ground floor/.test(svg); }, LG[0].id), "its box is tall enough for the 8 rows, and draws both floor names");
  await page.selectOption('#props select[data-lgfloor]', "Ground floor"); await wait(250);
  LG = await lgOf(); ok(LG[0].floor === "Ground floor" && LG[0].rows.length === 3, "Properties → Floors: only Ground floor");
  await T(() => zdTakeoff.floorRename(zdTakeoff.S.key, "Ground floor", "Ground")); await wait(200);
  LG = await lgOf(); ok(LG[0].floor === "Ground" && LG[0].rows.length === 3, "a floor renamed: its legend follows");
  await T(() => zdTakeoff.floorRename(zdTakeoff.S.key, "Ground", "Ground floor")); await wait(200);
  await T(() => { const Z = zdTakeoff, P = Z.P.proj; P.marks = P.marks.filter(m => m.type !== "legend"); Z.refresh(); });

  console.log("each floor its own conditions");
  const cOf = id => T(id => { const P = zdTakeoff.P.proj, c = P.conds.find(x => x.id === P.items.find(i => i.id === id).cond); return c ? {id: c.id, name: c.name, src: c.src || "", fl: c.fl || "", hidden: !!c.hidden, color: c.color} : null; }, id);
  const gA = await cOf("a1"), tA = await cOf("a2");
  ok(gA.src === "cA" && gA.fl === "Ground floor" && tA.src === "cA" && tA.fl === "Typical 1st to 8th floor" && tA.name === "Room Area — Typical 1st to 8th floor", "the floor renamed: its own condition follows (" + tA.name + ")");
  await T(() => { const rows = [...document.querySelectorAll("#condList .ctree > *")]; let inG = false;
    for (const el of rows) { if (el.matches(".ctr")) { inG = el.matches(".ctr.fl") && el.dataset.fl === "Ground floor"; continue; } if (inG && el.matches(".crow") && el.querySelector(".cn").textContent === "Room Area") { el.querySelector("[data-eye]").click(); return; } } }); await wait(200);
  ok(await T(() => { const Z = zdTakeoff, P = Z.P.proj, h = id => Z.S && P.conds.find(c => c.id === P.items.find(i => i.id === id).cond).hidden; return h("a1") && h("d1") && !h("a2") && !P.conds.find(c => c.id === "cA").hidden; }), "the bulb of Room Area under Ground floor hides that floor's rooms and cut-out only");
  await T(id => { const c = zdTakeoff.P.proj.conds.find(x => x.id === id); c.hidden = false; c.color = "#ff0000"; zdTakeoff.save(); zdTakeoff.refresh(); }, gA.id); await wait(150);
  ok((await cOf("a2")).color !== "#ff0000" && (await cOf("a1")).color === "#ff0000", "a floor's colour is its own");
  ok(await T(() => { const Z = zdTakeoff, P = Z.P.proj, tot = id => Z.condTotals(P.conds.find(c => c.id === P.items.find(i => i.id === id).cond)); return Math.abs(tot("a1").net - 180) < 0.01 && Math.abs(tot("a1").ded - 20) < 0.01 && Math.abs(tot("a2").net - 100) < 0.01 && !tot("a2").ded; }),
    "deductions per floor: Ground floor 200 − 20 = 180, the typical floor 100 with none");
  // drawn with the condition itself (or another floor's copy): it goes to the copy of the floor it is in
  await T(k => { const Z = zdTakeoff, P = Z.P.proj, R = (x, y, w, h) => [[x, y], [x + w * k, y], [x + w * k, y + h * k], [x, y + h * k]];
    P.items.push({id: "a3", cond: "cA", file: Z.S.fileId, page: 1, kind: "shape", nos: 1, pts: R(600, 200, 5, 4)}, {id: "a4", cond: P.items.find(i => i.id === "a1").cond, file: Z.S.fileId, page: 1, kind: "shape", nos: 1, pts: R(650, 260, 2, 2)}); Z.save(); Z.refresh(); }, G.k); await wait(200);
  ok((await cOf("a3")).id === tA.id && (await cOf("a4")).id === tA.id, "an area drawn in the typical floor with Room Area (or Ground floor's copy) goes to the typical floor's own");
  t = await tree(); ok(near(t["Typical 1st to 8th floor"]["Room Area"], 124) && near(t["Ground floor"]["Room Area"], 180), "tree: typical floor Room Area 124 (100 + 20 + 4), Ground floor 180");
  await T(() => { const Z = zdTakeoff; Z.S.cond = "cD"; Z.setTool("count"); }); await click([600, 330]); await wait(200); await T(() => zdTakeoff.setTool("select"));
  { const D = await fam("cD"); ok(D.length === 2 && near((await tree())["Typical 1st to 8th floor"].Doors, 2), "a door counted in the typical floor joins that floor's Doors (2), still one count per floor");
    ok(await T(() => zdTakeoff.P.proj.conds.find(c => c.id === zdTakeoff.S.cond).fl === "Typical 1st to 8th floor"), "the condition drawn with follows to the floor's own"); }
  await page.click('#condList .ctr.fl[data-fl="Ground floor"] [data-flmenu]'); await wait(200);
  ok(await ctxPick("One condition for all floors of this page"), "a floor's menu → One condition for all floors of this page"); await wait(300);
  ok(await T(() => { const P = zdTakeoff.P.proj; return !P.conds.some(c => c.src) && P.items.every(i => ["cA", "cW", "cD"].includes(i.cond)); }), "the floors' copies go back into Room Area, Wall and Doors");
  t = await tree(); ok(near(t["Ground floor"]["Room Area"], 180) && near(t["Typical 1st to 8th floor"]["Room Area"], 124) && near(t["Typical 1st to 8th floor"].Doors, 2), "the tree still splits the quantities by floor");
  await page.keyboard.press("Control+z"); await wait(250);
  ok((await cOf("a1")).id === gA.id && (await cOf("a1")).color === "#ff0000" && (await cOf("a3")).id === tA.id, "Ctrl+Z: each floor has its own conditions again, with their colours");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj; P.items = P.items.filter(i => i.id !== "a3" && i.id !== "a4"); Z.save(); Z.refresh(); });
  ok(await T(() => zdTakeoff.condShort({name: "Kitchen — Ground floor", fl: "Ground floor"}) === "Kitchen" && zdTakeoff.condShort({name: "Kitchen GF", fl: "Ground floor"}) === "Kitchen GF"), "condShort: the floor's name off a copy's name");

  console.log("floors found on a sheet: added in one step");
  await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 2)); await wait(600);
  const pk2 = await T(() => zdTakeoff.S.key);
  await T(() => { zdTakeoff.floorsDialog(null, [{name: "Ground floor", r: [50, 50, 400, 400]}, {name: "Site plan", r: [450, 50, 800, 400]}, {name: "Typical 1st to 8th floor", r: [850, 50, 1150, 400]}]); }); await wait(400);
  ok((await page.locator("#dlgB [data-flck]").count()) === 3 && /3 floor plans found/.test(await page.innerText("#dlgB")), "the found plans are listed, each ticked");
  await page.uncheck('#dlgB [data-flck="1"]'); await page.fill('#dlgB [data-flnew="2"]', "Typical floor"); await page.click("#dlgOk"); await wait(400);
  ok(await T(pk => (zdTakeoff.P.proj.floors[pk] || []).map(f => f.name).join("|"), pk2) === "Ground floor|Typical floor", "the ticked ones are added, renamed as typed");
  await page.keyboard.press("Control+z"); await wait(250);
  ok(await T(pk => !(zdTakeoff.P.proj.floors[pk] || []).length, pk2), "one Ctrl+Z takes them all back");
  ok(await T(pk => [...document.querySelectorAll("#condList .ctr.pg [data-flfind]")].some(b => b.dataset.flfind === pk), pk2), "a page with no measurement is still listed while open");

  console.log("Find floor plans on a sheet with no wall lines");
  await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 3)); await wait(600);
  await page.click('[data-rtab="takeoff"]'); await page.click('[data-rp="takeoff"] [data-fn="floors"]'); await wait(1500);
  ok(await page.isVisible("#dlgBack.on") && /No floor plan was found/.test(await page.innerText("#dlgB")), "says none was found, and to draw a box round each plan");
  await page.click('#dlgB [data-fla="draw"]'); await wait(300);
  ok(await T(() => zdTakeoff.S.tool === "floorbox") && !(await page.isVisible("#dlgBack.on")), "+ Draw a floor boundary starts the Floor box tool");
  await page.keyboard.press("Escape"); await wait();

  console.log("names from plan titles");
  ok(await T(() => zdTakeoff.floorTitleName('TYPICAL "1ST TO 8TH FLOOR" PLAN (SCALE 1:100)')) === "Typical 1st to 8th floor", "TYPICAL \"1ST TO 8TH FLOOR\" PLAN (SCALE 1:100) → Typical 1st to 8th floor");
  ok(await T(() => zdTakeoff.floorTitleName("GROUND FLOOR PLAN")) === "Ground floor", "GROUND FLOOR PLAN → Ground floor");
  { const r = await T(() => { const t = {s: "TYPICAL FLOOR PLAN", cx: 1499, cy: 705, h: 2.9, w: 40}, all = [t, {s: "1ST TO 8TH FLOOR", cx: 1493, cy: 709, h: 2.3, w: 28}, {s: "8TH TO ROOF", cx: 1690, cy: 709, h: 2.3, w: 20}, {s: "STORE", cx: 1500, cy: 613, h: 0.8, w: 5}];
      return [zdTakeoff.floorTitleOf(t, all), zdTakeoff.floorTitleOf(Object.assign({}, t, {cx: 1699}), all), zdTakeoff.floorTitleOf({s: "GROUND FLOOR PLAN", cx: 1297, cy: 710, h: 2.9, w: 40}, all)]; });
    ok(r[0] === "Typical 1st to 8th floor" && r[1] === "Typical 8th to roof" && r[2] === "Ground floor", "TYPICAL FLOOR PLAN with 1ST TO 8TH FLOOR / 8TH TO ROOF written under it → " + r.join(", ")); }

  console.log("found plans with no floor title: unticked, folded; Show");
  await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 2)); await wait(500);
  await T(() => { zdTakeoff.floorsDialog(null, [{name: "Plan 1", r: [50, 50, 300, 300], titled: false}, {name: "Ground floor", r: [350, 50, 600, 300], titled: true}, {name: "Plan 2", r: [650, 50, 900, 300], titled: false}]); }); await wait(400);
  ok(/1 floor plan found/.test(await page.innerText("#dlgB")) && await T(() => { const d = document.querySelector("#dlgB details"); return !!d && !d.open && d.querySelectorAll("[data-flck]").length === 2 && [...d.querySelectorAll("[data-flck]")].every(x => !x.checked); }), "the two with no title are listed apart, folded and unticked");
  await page.click('#dlgB [data-flpz="1"]'); await wait(300);
  ok(await T(() => document.getElementById("dlgBack").classList.contains("peek") && zdTakeoff.S.flShow && zdTakeoff.S.flShow.name === "Ground floor"), "Show: the dialog steps aside and the plan is outlined on the sheet");
  await page.mouse.click(700, 500); await wait(300);
  ok(await page.isVisible("#dlgBack.on") && !(await T(() => zdTakeoff.S.flShow)), "a click brings the dialog back");
  await page.click("#dlgOk"); await wait(300);
  ok(await T(() => (zdTakeoff.P.proj.floors[zdTakeoff.S.key] || []).map(f => f.name).join("|")) === "Ground floor", "only the titled plan is added");
  await page.keyboard.press("Control+z"); await wait(200);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

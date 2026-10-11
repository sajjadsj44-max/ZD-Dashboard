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
const path = require("path");
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
  // 8" block wall: V = 100 × 10 × 0.667, block 16 × 8 × 8 solid, 1:6
  { const r = await mat("cB"), V = 100 * 10 * (8 / 12), bl = 16 / 12, bw = 8 / 12, bh = 8 / 12, j = 0.375 / 12, N = V / ((bl + j) * (bh + j) * (8 / 12)), wet = V - N * bl * bw * bh, dry = wet * 1.27;
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
  { const r = await mat("cB"), V = 100 * 10 * (8 / 12), bl = 16 / 12, bh = 8 / 12, j = 0.375 / 12, N = V / ((bl + j) * (bh + j) * (8 / 12));
    ok(r.rows.Blocks === Math.ceil(N * 1.05 - 1e-9), "5 % waste added to the blocks"); }
  await T(() => { const c = zdTakeoff.P.proj.conds.find(c => c.id === "cB"); c.h = ""; });
  ok(/Set Height H/.test((await mat("cB")).err), "no height on a length condition → asks for H, nothing guessed");

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
  if (process.env.TK_SHOTS) { await T(() => { zdTakeoff.S.cond = "cP"; zdTakeoff.S.sel = null; zdTakeoff.refresh(); }); await wait(300); await page.screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-materials.png")});
    await T(() => { const b = document.getElementById("propsBox"); b.style.maxHeight = "80%"; }); await wait(100); await page.locator("#propsBox").screenshot({path: path.join(process.env.TK_SHOTS, "takeoff-materials-props.png")}); }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

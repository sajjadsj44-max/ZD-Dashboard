#!/usr/bin/env node
/* Browser tests for the measurement appearance (Bluebeam-style properties) in the PDF Takeoff:

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_appearance.js [shots-dir]

   A condition's appearance — line colour, opacity, style, width (px / pt), start / end heads, fill and opacity, hatch, units
   (ft, ft-in, in, m, cm, mm) and decimals, label place, font, size, colour, B / I / U, background — set from Properties and
   from the condition dialog (with its preview); one measurement's own appearance; the totals; copy / paste, apply to all,
   set as default, reset; undo; and the marked-up export drawn the same as the screen. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", SHOTS = process.argv[2] || "";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1500, height: 940}}); await require("./zd_unlock")(ctx);
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
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, n + ".png")}); };
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const ov = () => T(() => document.getElementById("ov").innerHTML);
  const cnd = n => T(n => { const c = zdTakeoff.P.proj.conds.find(x => x.name === n); return c && JSON.parse(JSON.stringify(c)); }, n);
  const setAp = async (f, v) => { const el = page.locator(`#props .apbar [data-ap="${f}"]`).first(); if (await el.evaluate(e => e.tagName) === "SELECT") await el.selectOption(String(v)); else { await el.fill(String(v)); await el.dispatchEvent("change"); } await wait(150); };
  const newCond = async (preset, name) => { await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); await page.fill("#cName", name); await page.click("#dlgOk"); await wait(250); };
  const pickCond = async name => { await T(n => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === n); Z.S.cond = c.id; Z.setSel([]); Z.refresh(); }, name); await wait(150); };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Appearance test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  await page.keyboard.press("s"); await wait(80);   // snap off

  console.log("an area condition");
  await newCond("Floor area", "Floor tiles");
  await page.keyboard.press("r"); await click(300, 300); await click(390, 381); await page.keyboard.press("v"); await wait(150);   // 10' × 9'
  await pickCond("Floor tiles");
  ok(await page.isVisible("#props .apbar"), "Properties shows the appearance bar for the condition");
  const tot = await T(() => document.getElementById("props").textContent);
  ok(/Totals/.test(tot) && /Area/.test(tot) && /90\.000 Sft/.test(tot) && /Perimeter/.test(tot) && /38\.000 ft/.test(tot), "Totals: area 90.000 Sft, perimeter 38.000 ft");
  await setAp("hatch", "cross"); await setAp("fillOp", 40); await setAp("dash", "dash"); await setAp("lineOp", 70);
  let c = await cnd("Floor tiles");
  ok(c.ap && c.ap.hatch === "cross" && c.ap.fillOp === 40 && c.ap.dash === "dash" && c.ap.lineOp === 70, "hatch, fill opacity, line style and opacity kept on the condition → " + JSON.stringify(c.ap));
  let h = await ov();
  ok(/<pattern id="aph\d+"/.test(h) && /fill="url\(#aph\d+\)"/.test(h), "the hatch is drawn (an SVG pattern over the area)");
  ok(/fill-opacity="0\.40"/.test(h) && /stroke-dasharray="[\d.]+ [\d.]+"/.test(h) && /stroke-opacity="0\.7"/.test(h), "fill 40 %, a dashed outline at 70 %");
  await setAp("units", "ftin"); await wait(100);
  ok(/38'-0"/.test(await T(() => document.getElementById("props").textContent)), "units: feet-inches — the perimeter total reads 38'-0\"");
  await setAp("units", "m"); await wait(150);
  h = await ov(); ok(/8\.361 m²/.test(h), "units: metres — the label reads 8.361 m² (90 Sft); the quantity stays in Sft");
  ok(/90\.000 Sft/.test(await T(() => document.getElementById("props").textContent)), "the condition's quantity is still 90.000 Sft");
  await setAp("font", "Georgia"); await setAp("fsz", 15); await page.click('#props .apbar [data-ap="fb"]'); await wait(150); await setAp("fcol", "#c0392b");
  h = await ov(); ok(/font-family="Georgia,Arial,sans-serif" font-size="15\.0" font-weight="700"[^>]*fill="#c0392b"/.test(h), "label font Georgia 15, bold, red");
  await setAp("lpos", "above"); c = await cnd("Floor tiles"); ok(c.ap.lpos === "above", "label placed above");
  await shot("area");

  console.log("a length condition");
  await newCond("Skirting", "Skirting A");
  await page.keyboard.press("a"); await click(300, 200); await click(400, 200); await click(400, 250); await page.keyboard.press("Enter"); await wait(120); await page.keyboard.press("v");
  await pickCond("Skirting A");
  await setAp("h0", "tick"); await setAp("h1", "closed"); await setAp("sw", 2); await setAp("swU", "pt"); await setAp("dash", "center");
  c = await cnd("Skirting A");
  ok(c.ap.h0 === "tick" && c.ap.h1 === "closed" && c.ap.swU === "pt" && c.sw === 2 && c.ap.dash === "center", "start tick, end closed arrow, 2 pt on paper, centre line → " + JSON.stringify(c.ap));
  h = await ov(); ok(/Z" fill="#[0-9a-f]{6}" fill-opacity/.test(h), "the closed arrowhead is drawn");
  const w1 = await T(() => { const m = /<polyline [^>]*stroke-width="([\d.]+)"[^>]*stroke-dasharray/.exec(document.getElementById("ov").innerHTML); return m ? +m[1] : 0; });
  await T(() => { const Z = zdTakeoff; Z.S.view.s *= 2; Z.applyView(); Z.refresh(); }); await wait(250);
  const w2 = await T(() => { const m = /<polyline [^>]*stroke-width="([\d.]+)"[^>]*stroke-dasharray/.exec(document.getElementById("ov").innerHTML); return m ? +m[1] : 0; });
  ok(w1 > 0 && Math.abs(w2 / w1 - 2) < 0.05, "a width in pt on paper grows with the zoom (" + w1 + " → " + w2 + ")");
  await T(() => { const Z = zdTakeoff; Z.S.view.s /= 2; Z.applyView(); Z.refresh(); }); await wait(200);
  const tl = await T(() => document.getElementById("props").textContent);
  ok(/Length/.test(tl) && /16\.667 ft/.test(tl) && /Segments/.test(tl), "totals of a length condition: 16.667 ft, segments (" + (/Length[^A-Z]*/.exec(tl) || [""])[0].slice(0, 40) + ")");
  await shot("length");

  console.log("one measurement only");
  const id = await T(() => zdTakeoff.P.proj.items.find(i => zdTakeoff.P.proj.conds.find(c => c.id === i.cond).name === "Skirting A").id);
  await T(id => { zdTakeoff.setSel([id]); zdTakeoff.refresh(); }, id); await wait(200);
  await page.selectOption("#props [data-apown]", "item"); await wait(200);
  await setAp("col", "#00a000"); await setAp("dash", "solid");
  const own = await T(id => JSON.parse(JSON.stringify(zdTakeoff.P.proj.items.find(i => i.id === id).ap || null)), id); c = await cnd("Skirting A");
  ok(own && own.col === "#00a000" && own.dash === "solid" && c.ap.dash === "center" && c.color !== "#00a000", "this measurement green and solid — its condition unchanged");
  await page.keyboard.press("Control+z"); await wait(250);
  ok(await T(id => (zdTakeoff.P.proj.items.find(i => i.id === id).ap || {}).dash === "center", id), "Ctrl+Z takes the last appearance change back");

  console.log("counts");
  await newCond("Doors", "Doors A");
  await page.keyboard.press("c"); await click(500, 300); await click(540, 300); await page.keyboard.press("Escape"); await page.keyboard.press("v");
  await pickCond("Doors A");
  await setAp("sym", "star"); await setAp("csz", 16); await setAp("fillOp", 60);
  c = await cnd("Doors A"); h = await ov();
  ok(c.sym === "star" && c.ap.csz === 16 && /stroke-linejoin="round"/.test(h) && /fill-opacity="0\.60"/.test(h), "count: star symbol, 16 px, 60 % fill");
  ok(/Count/.test(await T(() => document.getElementById("props").textContent)) && /2 Nos/.test(await T(() => document.getElementById("props").textContent)), "count totals: 2 Nos");

  console.log("copy, paste, apply to all, default, reset");
  await pickCond("Floor tiles"); await page.click('#props [data-apact="copy"]'); await wait(100);
  await newCond("Floor area", "Ceiling"); await pickCond("Ceiling"); await page.click('#props [data-apact="paste"]'); await wait(150);
  c = await cnd("Ceiling"); ok(c.ap && c.ap.hatch === "cross" && c.ap.units === "m", "Paste: Ceiling takes Floor tiles' hatch, units and label font");
  await page.click('#props [data-apact="reset"]'); await wait(150); c = await cnd("Ceiling"); ok(!c.ap, "Reset: back to the standard look");
  await T(() => { const c = zdTakeoff.P.proj.conds.find(x => x.name === "Ceiling"); c.color = "#123456"; });
  await pickCond("Floor tiles"); await page.click('#props [data-apact="all"]'); await wait(150); c = await cnd("Ceiling"); const ft = await cnd("Floor tiles");
  ok(c.ap && c.ap.hatch === "cross" && c.color === "#123456" && ft.color !== "#123456", "Apply to all areas: Ceiling has it, its own colour kept");
  await page.click('#props [data-apact="default"]'); await wait(100);
  await page.click("#bNewCond"); await wait(150);
  ok(await page.isVisible("#cApD") && await T(() => !!document.querySelector("#cApPv svg")), "the condition dialog has the appearance section with a preview");
  await page.selectOption("#cPre", {label: "Floor area"}); await page.fill("#cName", "Screed"); await page.click("#cApD summary"); await wait(80);
  ok(await T(() => document.querySelector('#cAp [data-ap="hatch"]').value === "cross"), "a new area condition starts with the default appearance (Set as default)");
  await page.selectOption('#cAp [data-ap="hatch"]', "brick"); await wait(100);
  ok(/pattern/.test(await T(() => document.getElementById("cApPv").innerHTML)), "the preview shows the hatch as it is picked");
  await shot("dialog");
  await page.click("#dlgOk"); await wait(250);
  c = await cnd("Screed"); ok(c.ap && c.ap.hatch === "brick", "Save keeps the dialog's appearance (brick hatch)");

  console.log("exports draw it as the screen");
  const ex = await T(() => { const Z = zdTakeoff; return Z.pageOverlaySvg(Z.S.fileId, Z.S.pageNo, 2, 1684, 1190, {legend: "none"}); });
  ok(/<pattern id="aph\d+"/.test(ex) && /Georgia/.test(ex) && /8\.361 m²/.test(ex), "the marked-up export has the hatch, the label font and the units");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

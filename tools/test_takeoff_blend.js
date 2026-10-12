#!/usr/bin/env node
/* Markup blend mode (Bluebeam's Multiply): a markup set to Multiply darkens what is under it, so the drawing's lines show
   through a filled box or a highlight — on screen, in a picture export and in a vector PDF (the PDF's own Multiply blend).
   Highlights and the highlighter pen start as Multiply; other markups as Normal; the mode is kept by Set as default.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_blend.js                  (TK_URL / TK_LIBS as for test_takeoff.js)
*/
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see test_takeoff.js"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib"));
  const doc = await PL.PDFDocument.create(), pg = doc.addPage([400, 300]);
  pg.drawLine({start: {x: 40, y: 150}, end: {x: 360, y: 150}, thickness: 6, color: PL.rgb(0, 0, 0)});   // a wall line across the page
  const pdf = Buffer.from(await doc.save());
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1200, height: 800}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const scr = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);
  const pixel = async (x, y) => { const p = await scr(x, y), b = await page.screenshot({clip: {x: Math.round(p[0]), y: Math.round(p[1]), width: 1, height: 1}});
    return T(async u => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d"); g.drawImage(im, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }, "data:image/png;base64," + b.toString("base64")); };
  const dark = c => c[0] < 90 && c[1] < 90 && c[2] < 90, yellow = c => c[0] > 200 && c[1] > 180 && c[2] < 120;
  const prop = async (k, v) => { await T(([k, v]) => { const el = document.querySelector(`#props [data-mprop="${k}"]`); if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); }, [k, v]); await wait(200); };

  console.log("project");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Blend test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "line.pdf", mimeType: "application/pdf", buffer: pdf});
  await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 20000}); await wait(400);
  await page.uncheck("#snapOn");
  await T(() => { const Z = zdTakeoff, st = document.getElementById("stage"), s = Math.min(st.clientWidth / Z.S.base.width, st.clientHeight / Z.S.base.height) * 0.9; Z.S.view = {s, tx: 20, ty: 20}; Z.applyView(); }); await wait(500);
  ok(dark(await pixel(200, 150)), "the page's line is drawn (dark at its middle)");

  console.log("a filled rectangle over the line");
  await T(() => zdTakeoff.setTool("mk_box")); await wait(80);
  const a = await scr(120, 100), b = await scr(280, 200);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / 6, a[1] + (b[1] - a[1]) * i / 6); await page.mouse.up(); await wait(250);
  const id = await T(() => (zdTakeoff.P.proj.marks || []).slice(-1)[0].id);
  await T(id => { zdTakeoff.setTool("select"); zdTakeoff.S.selMark = id; zdTakeoff.refresh && zdTakeoff.refresh(); }, id); await wait(250);
  ok(await T(() => !!document.querySelector('#props [data-mprop="blend"]')), "Properties show a Blend mode");
  ok(await T(() => document.querySelector('#props [data-mprop="blend"]').value === "normal"), "a rectangle starts as Normal");
  await prop("nofill", false); await prop("fill", "#ffe14d"); await prop("fillOp", "1");
  await T(() => { zdTakeoff.S.selMark = null; zdTakeoff.refresh && zdTakeoff.refresh(); }); await wait(300);
  ok(yellow(await pixel(200, 150)), "Normal, solid fill: the line is hidden under the yellow");
  await T(id => { zdTakeoff.S.selMark = id; zdTakeoff.refresh && zdTakeoff.refresh(); }, id); await wait(250);
  await prop("blend", "multiply");
  ok(await T(id => zdTakeoff.P.proj.marks.find(m => m.id === id).blend === "multiply", id), "the choice is saved on the markup");
  await T(() => { zdTakeoff.S.selMark = null; zdTakeoff.refresh && zdTakeoff.refresh(); }); await wait(300);
  ok(dark(await pixel(200, 150)), "Multiply: the line shows through the same solid fill");
  ok(yellow(await pixel(200, 120)), "Multiply: away from the line the box is still yellow");

  console.log("exports");
  const exp = async () => T(async () => { const Z = zdTakeoff, S = Z.S, sc = 2, W = Math.ceil(S.base.width * sc), H = Math.ceil(S.base.height * sc), c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); await S.page.render({canvasContext: g, viewport: S.page.getViewport({scale: sc})}).promise;
    await Z.svgOnto(g, Z.pageOverlaySvg(S.fileId, S.pageNo, sc, W, H, {legend: "none", meas: false}));
    const px = (x, y) => [...g.getImageData(Math.round(x * sc), Math.round(y * sc), 1, 1).data]; return [px(200, 150), px(200, 120)]; });
  let [onLine, off] = await exp();
  ok(dark(onLine) && yellow(off), "picture export (PNG / print / flattened PDF): the line shows through, the box stays yellow");
  ok(await T(() => { const sp = zdTakeoff.svgBlendSplit(zdTakeoff.pageOverlaySvg(zdTakeoff.S.fileId, zdTakeoff.S.pageNo, 1, 400, 300, {legend: "none"})); return !!sp && !/data-blend/.test(sp[0].replace(/<g[^>]*display="none"[\s\S]*?<\/g>/g, "")) && /data-blend/.test(sp[1]); }), "the overlay splits into a Normal layer and a Multiply layer");
  await T(id => { zdTakeoff.P.proj.marks.find(m => m.id === id).blend = "normal"; }, id);
  [onLine] = await exp();
  ok(yellow(onLine), "set back to Normal, the export hides the line again");
  await T(id => { zdTakeoff.P.proj.marks.find(m => m.id === id).blend = "multiply"; }, id);
  const pdfBM = await T(async () => { const Lb = window.PDFLib; if (!Lb) return "no pdf-lib"; const d = await Lb.PDFDocument.create(), p = d.addPage([100, 100]), c = document.createElement("canvas"); c.width = c.height = 4;
    const im = await d.embedPng(await new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), "image/png"))); p.drawImage(im, {x: 0, y: 0, width: 10, height: 10, blendMode: Lb.BlendMode.Multiply});
    return new TextDecoder("latin1").decode(await d.save({useObjectStreams: false})).includes("/BM /Multiply"); });
  ok(pdfBM === true, "vector PDF: pdf-lib writes the Multiply blend for the markup layer (" + pdfBM + ")");
  const plotted = await T(async () => Array.from(await zdTakeoff.plotPdf({area: "extents", paper: "A4", orient: "auto", scale: "fit", style: "color", lw: true, tk: true, legend: false, stamp: false, center: true, np: true})));
  const pd = await PL.PDFDocument.load(Uint8Array.from(plotted)), gs = pd.getPage(0).node.Resources().lookup(PL.PDFName.of("ExtGState"));
  const modes = gs ? gs.keys().map(k => { const e = gs.lookup(k), bm = e && e.get(PL.PDFName.of("BM")); return bm ? String(bm) : ""; }).filter(Boolean) : [];
  const nImg = (() => { const x = pd.getPage(0).node.Resources().lookup(PL.PDFName.of("XObject")); return x ? x.keys().length : 0; })();
  ok(modes.includes("/Multiply") && nImg >= 3, "plot PDF with the takeoff: the Multiply markups go in their own layer with the PDF's Multiply blend (" + modes.join(",") + ", " + nImg + " XObjects)");

  console.log("defaults");
  ok(await T(() => zdTakeoff.mkBlend({type: "hilite"}) && zdTakeoff.mkBlend({type: "pen", hl: true}) && !zdTakeoff.mkBlend({type: "pen"}) && !zdTakeoff.mkBlend({type: "box"})), "highlight and highlighter pen start as Multiply; pen and box as Normal");
  ok(await T(() => !zdTakeoff.mkBlend({type: "hilite", blend: "normal"}) && zdTakeoff.mkBlend({type: "cloud", blend: "multiply"}) && !zdTakeoff.mkBlend({type: "redact", blend: "multiply"})), "the markup's own choice wins; redaction never blends");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

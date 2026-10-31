#!/usr/bin/env node
/* Browser tests for how fast a heavy page is drawn as it is zoomed and moved (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_zoomdraw.js

   A sheet of 25,000 small paths, with the cases a draw of only the view's paths could get wrong: a curve whose ends lie outside
   a view while its middle is inside it, a thick line just outside a view whose width reaches in, a clip set outside a view, turned
   content, a form drawn twice at other sizes, dashes and text. Each view drawn with only its own paths (pageDraw) must be the
   same picture as the page drawn whole (page.render), on the page as it is and turned a quarter. A heavy page seen whole is made
   from its whole-page picture without pdf.js drawing it again (a light page still is drawn); zoomed in past that picture, pdf.js
   draws only the view. A page's text lines are worked out once and every reader gets its own copy. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

const PW = 1684, PH = 1191;   // the sheet, pt (y up in the PDF; the app's page is y down: y_app = PH − y)
function heavyPdf(){
  const c = ["0.25 w 0 0 0 RG"];
  for (let i = 0; i < 140; i++) for (let j = 0; j < 90; j++) { const x = 20 + i * 11.5, y = 20 + j * 12.5; c.push(`${x} ${y} 8 9 re S ${x} ${y} m ${x + 8} ${y + 9} l S`); }
  c.push("1 0 0 RG 1.5 w 600 400 m 600 700 900 700 900 400 c S");   // an arch: its top (y 625) far from its two ends
  c.push("0 0 1 RG 14 w 300 900 m 700 900 l S");   // a thick line, 7 pt either side of y 900
  c.push("q 50 1000 100 100 re W n 0 1 0 rg 0 950 400 200 re f Q");   // a fill cut by a clip
  c.push("q 0.8660 0.5 -0.5 0.8660 1200 300 cm 0.6 0 0.6 RG 2 w 0 0 m 200 0 l S 0 0 150 80 re S Q");   // turned 30°
  c.push("[6 3] 0 d 0.3 0.3 0.3 RG 1 w 100 1150 m 1500 1150 l S [] 0 d 0.9 0.6 0.1 rg 0 0 0 RG 1300 1000 120 90 re B");
  c.push("q 1 0 0 1 1000 600 cm /Fm1 Do Q q 0.5 0 0 0.5 1300 750 cm /Fm1 Do Q");   // a form (its own matrix × 1.5) twice
  c.push("BT /F1 18 Tf 700 1100 Td (ZOOM DRAW TEST) Tj ET");
  const form = "0 0.5 0 RG 3 w 10 10 m 190 190 l S 10 190 m 190 10 l S 20 20 160 160 re S 100 100 m 100 160 160 160 160 100 c S";
  const content = c.join("\n"), objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents 6 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Fm1 5 0 R >> >> >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Matrix [1.5 0 0 1.5 0 0] /Length ${form.length} >>\nstream\n${form}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const sharp = () => page.waitForFunction(() => { const pn = zdTakeoff.ACT, r = pn.rendered, v = pn.view; return pn.page && r && !pn.hiWait && Math.abs(r.s - v.s) <= 1e-6 * v.s && Math.abs(r.tx - v.tx) < 0.5 && Math.abs(r.ty - v.ty) < 0.5 && !pn.renderTask; }, null, {timeout: 60000});

  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Zoom draw"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "heavy.pdf", mimeType: "application/pdf", buffer: heavyPdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.ACT.low, null, {timeout: 60000}); await sharp(); await wait(500);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");

  console.log("A view drawn with only its own paths is the same picture as the page drawn whole");
  /* views [zoom × fit, x, y] in the app's page units (y down), each placed on something a cut could get wrong */
  /* (cy "below:<y>": the view's top edge 3 pt below y — a line along y, 14 pt wide, shows in it only by its width; the clip's view
     starts right of the clip, on the fill the clip hides) */
  const views = [["the arch's top, its ends outside", 8, 750, PH - 625], ["a thick line's edge, its middle outside", 8, 500, "below:" + (PH - 900)], ["beside a clip, on the fill it hides", 6, 330, PH - 1050],
    ["the turned shapes", 6, 1290, PH - 360], ["the forms", 4, 1150, PH - 750], ["the grid's corner, close", 16, 30, PH - 30], ["the dashes and the text", 5, 800, PH - 1120]];
  const cmp = (vs, rot) => T(async ([vs, rot]) => {
    const A = zdTakeoff.ACT, pg = A.page, base = pg.getViewport({scale: 1, rotation: rot}), W = 1000, H = 700, out = [];
    for (const [name, z, cx, cy0] of vs) {
      const fitS = Math.min(W / base.width, H / base.height), s = fitS * z, half = (rot ? W : H) / 2 / s, cy = typeof cy0 === "string" ? +cy0.slice(6) + 3 + 8 / s + half : cy0;   // (8 / s: the view's own margin)
      const p = rot ? [base.width - cy, cx] : [cx, cy];   // (a quarter turn clockwise: x' = h − y, y' = x)
      const tx = W / 2 - p[0] * s, ty = H / 2 - p[1] * s, mg = 8 / s, r = [-tx / s - mg, -ty / s - mg, (W - tx) / s + mg, (H - ty) / s + mg];
      const draw = async cut => { const c = document.createElement("canvas"); c.width = W; c.height = H;   // (drawn at once, not kept for later: the browser otherwise softens a clip's edge a shade differently after fewer calls)
        const o = {canvasContext: c.getContext("2d", {willReadFrequently: true}), viewport: pg.getViewport({scale: s, rotation: rot}), transform: [1, 0, 0, 1, tx, ty]};
        const task = cut ? zdTakeoff.pageDraw(pg, o, base, r) : pg.render(o); await task.promise; return {d: c.getContext("2d").getImageData(0, 0, W, H).data, cut: !!task.cut}; };
      const a = await draw(false), b = await draw(true), k = zdTakeoff.viewOps(pg, {}, base, r);
      let n = 0, mx = 0, ink = 0; for (let i = 0; i < a.d.length; i += 4) { const d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2])); if (d) n++; if (d > mx) mx = d; if (a.d[i] + a.d[i + 1] + a.d[i + 2] < 600) ink++; }
      out.push({name, cut: b.cut, kept: k ? k[1].fnArray.length : -1, n, mx, ink});
    }
    const st = pg._intentStates.get(pg._transport.getRenderingIntent("display", 1).cacheKey);
    return {ops: st.operatorList.fnArray.length, out};
  }, [vs, rot]);
  for (const rot of [0, 90]) {
    const res = await cmp(views, rot);
    res.out.forEach(v => ok(v.cut && v.kept > 0 && v.kept < res.ops / 4 && v.ink > 200 && v.n === 0,
      `${rot ? "turned a quarter, " : ""}${v.name}: drawn from ${v.kept} of ${res.ops} operations, ${v.n} pixel${v.n === 1 ? "" : "s"} different (largest ${v.mx}), ${v.ink} inked`));
  }
  const whole = await T(() => { const A = zdTakeoff.ACT, b = A.base; return !zdTakeoff.viewOps(A.page, {}, b, [-10, -10, b.width + 10, b.height + 10]); });
  ok(whole, "the whole page in view: drawn as it is (nothing to leave out)");

  console.log("A heavy page seen whole is made from its whole-page picture; zoomed in, pdf.js draws only the view");
  /* how the view on screen was last drawn: pdf.js calls during renderHi, and whether it was cut */
  const hiRun = (heavy, z) => T(async ([heavy, z]) => {
    const Z = zdTakeoff, A = Z.ACT, pg = A.page, st = A.el.stage, orig = pg.render; let calls = 0, cut = false;
    A.full = {page: pg, ms: heavy ? 999 : 10};
    const s = Math.min((st.clientWidth - 24) / A.base.width, (st.clientHeight - 24) / A.base.height) * z;
    A.view = {s, tx: st.clientWidth / 2 - A.base.width * s * 0.42, ty: st.clientHeight / 2 - A.base.height * s * 0.55};
    pg.render = function(){ calls++; return orig.apply(this, arguments); };
    Z.applyView(A); Z.renderHi(true, A);
    await new Promise(r => { const f = () => (!A.hiWait && !A.renderTask ? r() : setTimeout(f, 10)); setTimeout(f, 10); });
    pg.render = orig; const r = A.rendered, v = A.view, c = A.el.hi, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) ink++;
    return {calls, sharp: !!r && Math.abs(r.s - v.s) <= 1e-6 * v.s && Math.abs(r.tx - v.tx) < 0.5, ink, lowS: A.low.s, px: v.s * r.dpr}; }, [heavy, z]);
  const h1 = await hiRun(true, 1), l1 = await hiRun(false, 1);
  ok(h1.sharp && h1.calls === 0, `heavy page seen whole: the view made from the whole-page picture, pdf.js not called (${h1.calls} draws)`);
  ok(l1.sharp && l1.calls === 1, `light page seen whole: drawn by pdf.js as before (${l1.calls} draw)`);
  ok(h1.ink > 0.6 * l1.ink && h1.ink < 1.6 * l1.ink, `the two look alike: ${h1.ink} inked pixels from the picture, ${l1.ink} from pdf.js`);
  const zin = await T(() => { const A = zdTakeoff.ACT; return 1.3 * A.low.s / (A.view.s * (A.rendered.dpr || 1)); });
  const h2 = await hiRun(true, zin);
  ok(h2.sharp && h2.calls === 1 && h2.px > h2.lowS, `heavy page zoomed in past its picture (${h2.px.toFixed(2)} px/pt, picture ${h2.lowS.toFixed(2)}): drawn by pdf.js`);
  const cutNow = await T(() => { const A = zdTakeoff.ACT, st = A.el.stage, v = A.view, r = [-v.tx / v.s, -v.ty / v.s, (st.clientWidth - v.tx) / v.s, (st.clientHeight - v.ty) / v.s]; const k = zdTakeoff.viewOps(A.page, {}, A.base, r); return k ? k[1].fnArray.length : -1; });
  ok(cutNow > 0, `…of only the view's operations (${cutNow})`);
  await T(() => { zdTakeoff.ACT.full = null; });

  console.log("Text lines worked out once, each reader its own copy");
  const tl = await T(() => { const Z = zdTakeoff, P = [{s: "BED", x: 100, y: 100, w: 20, h: 6, r: 0}, {s: "ROOM", x: 124, y: 100, w: 26, h: 6, r: 0}, {s: "UP", x: 152, y: 100, w: 12, h: 6, r: -Math.PI / 2}, {s: "D1", x: 300, y: 300, w: 10, h: 6, r: 0}];
    const a = Z.textLines(P), b = Z.textLines(P), same = JSON.stringify(a.map(l => [l.s, l.x, l.y, l.w, l.parts.length])) === JSON.stringify(b.map(l => [l.s, l.x, l.y, l.w, l.parts.length]));
    a[0].s = "CHANGED"; a[0].parts.push({}); const c = Z.textLines(P);
    return {lines: b.map(l => l.s), same, apart: a !== b && a[0] !== b[0], kept: c[0].s !== "CHANGED" && c[0].parts.length === b[0].parts.length}; });
  ok(tl.same && tl.apart && tl.kept, `the same lines each time (${tl.lines.join(" | ")}), a reader's changes not seen by the next`);
  ok(tl.lines.includes("BED ROOM") && tl.lines.includes("UP") && tl.lines.includes("D1"), "pieces written the same way joined; one written up the page and a tag kept apart");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

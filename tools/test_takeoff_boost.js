#!/usr/bin/env node
/* Browser tests for Faint lines (View → Faint lines: the picture's hairlines made legible when zoomed out) and the freeze
   when a big sheet is opened.

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_boost.js           # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist) as in tools/test_takeoff.js.

   Checks: the canvas-composited boostInk gives the same picture as the pixel-by-pixel algorithm it replaced (hairlines in
   black, grey, red and blue, dashes, a grey fill, text — far out and nearer); white paper stays white; it does nothing when
   off or zoomed in; opening a 150,000-line sheet freezes the page under 400 ms; no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const FX = require("./takeoff_qa_fixture.js"), {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see tools/test_takeoff.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a);
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.boostInk);

  console.log("Faint lines: the same picture as before, made by the canvas");
  for (const ptPx of [0.5, 1.0]) {
    const r = await T(ptPx => {
      const W = 420, H = 260, draw = c => { const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
        const line = (col, lw, y, dash) => { x.strokeStyle = col; x.lineWidth = lw; x.setLineDash(dash || []); x.beginPath(); x.moveTo(10, y); x.lineTo(W - 10, y + 30); x.stroke(); };
        line("#000", 0.25, 20); line("#000", 0.4, 40); line("#777", 0.3, 60); line("#d00000", 0.35, 80); line("#000", 0.3, 100, [4, 3]); line("#2a78d6", 0.5, 120);
        for (let i = 0; i < 12; i++) { x.strokeStyle = "#333"; x.lineWidth = 0.2; x.setLineDash([]); x.beginPath(); x.moveTo(20 + i * 7, 150); x.lineTo(20 + i * 7, 240); x.stroke(); }
        x.fillStyle = "#cfcfcf"; x.fillRect(150, 150, 80, 60); x.fillStyle = "#555"; x.font = "7px Arial"; x.fillText("BED ROOM 12 x 14", 250, 190); return x; };
      const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
      const a = mk(), b = mk(), xa = draw(a), xb = draw(b);
      /* the algorithm as it was: every pixel to half way to the darkest of itself and its four neighbours, then the gamma curve */
      const im = xa.getImageData(0, 0, W, H), d = im.data, src = new Uint8ClampedArray(d), row = W * 4, g = new Uint8ClampedArray(256), gam = ptPx < 0.8 ? 1.5 : 1.3;
      for (let v = 0; v < 256; v++) g[v] = v >= 250 ? v : Math.round(255 * Math.pow(v / 255, gam));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * row + x * 4;
        for (let c = 0; c < 3; c++) { let m = src[i + c];
          if (x > 0 && src[i - 4 + c] < m) m = src[i - 4 + c]; if (x < W - 1 && src[i + 4 + c] < m) m = src[i + 4 + c];
          if (y > 0 && src[i - row + c] < m) m = src[i - row + c]; if (y < H - 1 && src[i + row + c] < m) m = src[i + row + c];
          d[i + c] = g[(src[i + c] + m) >> 1]; } }
      const S = zdTakeoff.S, was = S.boost; S.boost = true; zdTakeoff.boostInk(xb, W, H, ptPx); S.boost = was;
      const n = xb.getImageData(0, 0, W, H).data; let max = 0, sum = 0, big = 0, ink = 0, inkNew = 0, whiteOk = true, darker = false;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) { const e = Math.abs(n[i + c] - d[i + c]); if (e > max) max = e; sum += e; if (e > 8) big++; }
        const lo = src[i] + src[i + 1] + src[i + 2], ln = n[i] + n[i + 1] + n[i + 2];
        if (lo === 765 && ln !== 765 && d[i] + d[i + 1] + d[i + 2] === 765) whiteOk = false;   // paper the old algorithm kept white stays white
        if (d[i] + d[i + 1] + d[i + 2] < 600) ink++; if (ln < 600) inkNew++; if (ln < lo) darker = true; }
      return {max, mean: sum / (d.length / 4 * 3), big, px: W * H, ink, inkNew, whiteOk, darker};
    }, ptPx);
    ok(r.max <= 10 && r.mean <= 1.5 && r.big / r.px < 0.01, `at ${ptPx} px per pt: within ${r.max} of 255 of the old picture (mean ${r.mean.toFixed(2)}, ${r.big} of ${r.px} pixels more than 8 off)`);
    ok(Math.abs(r.inkNew - r.ink) / r.ink < 0.05, `…the same lines come out dark (${r.inkNew} vs ${r.ink} inked pixels)`);
    ok(r.whiteOk && r.darker, "…white paper stays white, the faint lines get darker");
  }
  const noop = await T(() => { const c = document.createElement("canvas"); c.width = 50; c.height = 50; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 50, 50); x.strokeStyle = "#888"; x.lineWidth = 0.3; x.beginPath(); x.moveTo(0, 25); x.lineTo(50, 25); x.stroke();
    const before = x.getImageData(0, 0, 50, 50).data.join(), S = zdTakeoff.S, was = S.boost;
    S.boost = false; zdTakeoff.boostInk(x, 50, 50, 0.5); const off = x.getImageData(0, 0, 50, 50).data.join() === before;
    S.boost = true; zdTakeoff.boostInk(x, 50, 50, 2); const near = x.getImageData(0, 0, 50, 50).data.join() === before; S.boost = was; return off && near; });
  ok(noop, "off, or zoomed in (2 px per pt), it leaves the picture alone");

  console.log("opening a big sheet does not freeze the page");
  await page.click("#bNewProj"); await page.fill("#dlgName", "Boost"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "small.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000});
  await page.setInputFiles("#fileIn", {name: "heavy.pdf", mimeType: "application/pdf", buffer: FX.makeHeavyPdf(150000)});
  await page.waitForFunction(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "heavy.pdf"); return f && Z.S.fileId === f.id && Z.S.geo[Z.S.key]; }, null, {timeout: 60000});
  await page.waitForTimeout(1500);
  const runs = [];
  for (let r = 0; r < 3; r++) {
    await T(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "small.pdf"); Z.gotoPage(f.id, 1); });
    await page.waitForFunction(() => zdTakeoff.P.proj.files.find(x => x.name === "small.pdf").id === zdTakeoff.S.fileId, null, {timeout: 30000}); await page.waitForTimeout(1200);
    await T(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "heavy.pdf"); Object.keys(Z.S.geo).filter(k => k.startsWith(f.id)).forEach(k => { delete Z.S.geo[k]; delete Z.S.texts[k]; });
      window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({entryTypes: ["longtask"]}); } catch (e) {} Z.gotoPage(f.id, 1); });
    await page.waitForFunction(() => { const Z = zdTakeoff, f = Z.P.proj.files.find(x => x.name === "heavy.pdf"); return Z.S.fileId === f.id && Z.S.geo[Z.S.key]; }, null, {timeout: 60000}); await page.waitForTimeout(1500);
    runs.push(await T(() => Math.max(0, ...window.__lt)));
  }
  const med = runs.slice().sort((a, b) => a - b)[1];
  ok(med < 400, "opening a 150,000-line sheet (Faint lines on): longest freeze " + med + " ms, under 400 ms (runs: " + runs.join(", ") + ")");
  ok(await T(() => zdTakeoff.S.boost), "…with Faint lines on (the default)");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

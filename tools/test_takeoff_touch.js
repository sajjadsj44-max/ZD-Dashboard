#!/usr/bin/env node
/* Touch and cross-browser checks for the PDF Takeoff, on a tablet emulated in Chromium (touch, no hover, no mouse):
     - tap two corners → a rectangle area; tap-tap-tap + double-tap free from the mouse
     - two-finger pinch zooms the drawing
     - press and hold opens the right-click menu; a tap opens its submenus (no hover on touch)
     - the condition rows' tick box and edit pencil are shown when the device has no hover
     - Firefox: a mouse wheel in lines (deltaMode 1) zooms as fast as one in pixels
     - Safari: grey / black-and-white plot without the canvas filter (done on the pixels)
     - phone width: no sideways scroll of the page

   Real Firefox and Safari (WebKit) engines need Playwright's own builds (npx playwright install firefox webkit);
   when they are there, TK_ENGINES=firefox,webkit also runs the tap / pinch / menu checks in them.

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/> node tools/test_takeoff_touch.js
*/
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

async function run(engine){
  console.log(`\n== ${engine} — tablet, touch`);
  const browser = await pw[engine].launch();
  const ctx = await browser.newContext({viewport: {width: 1180, height: 820}, hasTouch: true, isMobile: engine !== "firefox", deviceScaleFactor: 1}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.tap("#bNewProj"); await page.fill("#dlgName", "Touch"); await page.tap("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 20000});
  const scr = ([x, y]) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);

  ok(await T(() => matchMedia("(hover: none)").matches && matchMedia("(pointer: coarse)").matches), "device reports touch: no hover, coarse pointer");
  await T(() => { const P = zdTakeoff.P.proj; P.conds.push({id: "cA", name: "Floor", type: "area", unit: "Sft", color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}); zdTakeoff.S.cond = "cA"; zdTakeoff.S.condView = "list"; zdTakeoff.refresh(); });
  await wait(200);
  ok(await T(() => { const r = document.querySelector('#condList .crow[data-cond="cA"]'), ck = r && r.querySelector("input[type=checkbox]"), pen = r && r.querySelector(".ed.pen"); return !!ck && getComputedStyle(ck).display !== "none" && getComputedStyle(pen).display !== "none" && r.getBoundingClientRect().height >= 28; }), "condition rows: tick box and pencil shown, rows tall enough to tap (no hover)");

  console.log("tap to measure");
  await T(() => zdTakeoff.setTool("rect")); await wait(100);
  const a = await scr([G.ax0, G.ay0]), b = await scr([G.ax1, G.ay1]);
  await page.touchscreen.tap(a[0] + 2, a[1] - 2); await wait(120); await page.touchscreen.tap(b[0] - 2, b[1] + 2); await wait(250);
  { const it = await T(() => { const Z = zdTakeoff, P = Z.P.proj, i = P.items[P.items.length - 1]; return i && Z.rowsOf(i, P.scales[Z.S.key].ptPerFt).map(r => r.qty); });
    ok(it && it.length === 1 && near(it[0], 168, 0.01), "two taps on the room corners → rectangle 12.000 × 14.000 = 168.000 Sft (snapped)"); }

  console.log("pinch zoom");
  { const s0 = await T(() => zdTakeoff.S.view.s), c = await T(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await T(() => zdTakeoff.setTool("pan"));
    const pt = (dx, id) => ({x: c[0] + dx, y: c[1], id});
    if (engine === "chromium") {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [pt(-40, 1), pt(40, 2)]});
      for (let k = 1; k <= 6; k++) { await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [pt(-40 - k * 15, 1), pt(40 + k * 15, 2)]}); await wait(30); }
      await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []}); await wait(200);
    } else {   // other engines: the pointer events a pinch makes
      await T(([c]) => { const st = document.getElementById("stage"), ev = (t, id, x) => st.dispatchEvent(new PointerEvent(t, {pointerId: id, pointerType: "touch", clientX: x, clientY: c[1], bubbles: true, isPrimary: id === 1}));
        ev("pointerdown", 1, c[0] - 40); ev("pointerdown", 2, c[0] + 40); for (let k = 1; k <= 6; k++) { ev("pointermove", 1, c[0] - 40 - k * 15); ev("pointermove", 2, c[0] + 40 + k * 15); } ev("pointerup", 1, c[0] - 130); ev("pointerup", 2, c[0] + 130); }, [c]); await wait(200);
    }
    const s1 = await T(() => zdTakeoff.S.view.s);
    ok(s1 > s0 * 1.8, `two fingers spread 80 → 260 px: zoom ×${(s1 / s0).toFixed(2)}`); }

  console.log("press and hold");
  await T(() => { zdTakeoff.setTool("select"); zdTakeoff.applyView(); }); await wait(100);
  { const c = await T(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });   // (zoomed in by the pinch: the middle of the drawing area)
    if (engine === "chromium") { const cdp = await ctx.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x: c[0], y: c[1], id: 5}]}); await wait(800); await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []}); }
    else await T(([x, y]) => { const st = document.getElementById("stage"); st.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 5, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: true})); }, c), await wait(800);
    await wait(150);
    ok(await T(() => { const m = document.getElementById("ctx"); return m && getComputedStyle(m).display !== "none" && m.querySelectorAll(".ci").length > 2; }), "press and hold 0.8 s → the right-click menu opens"); }
  { const has = await T(() => !!document.querySelector("#ctx .ci.sub:not(.dis)"));
    if (has) { await page.tap("#ctx .ci.sub:not(.dis) > .ct"); await wait(150);
      ok(await T(() => { const s = document.querySelector("#ctx .ci.sub.open > .cm"); return !!s && getComputedStyle(s).display === "block"; }), "a tap on a menu row with ▸ opens its submenu"); }
    else ok(true, "(menu here has no submenu)"); }

  ok(await T(() => Object.keys(zdTakeoff.S.touches || {}).length === 0 && !zdTakeoff.S.pinch), "every finger lifted is forgotten (no stuck pinch)");
  await T(() => { zdTakeoff.S.touches = {9: [100, 100]}; const st = document.getElementById("stage"), r = st.getBoundingClientRect(), x = r.left + 100, y = r.top + 100;
    zdTakeoff.S.lasso = {pts: [[100, 100]]}; st.dispatchEvent(new PointerEvent("pointerup", {pointerId: 9, pointerType: "touch", clientX: x, clientY: y, bubbles: true})); });
  ok(await T(() => !("9" in (zdTakeoff.S.touches || {}))), "a finger lifted at the end of a lasso is forgotten too");

  if (engine === "chromium") {
    console.log("Firefox wheel, Safari canvas");
    ok(await T(() => { const W = zdTakeoff.wheelPx; return W({deltaY: 3, deltaMode: 1}) === 99 && W({deltaY: 100, deltaMode: 0}) === 100 && W({deltaY: 1, deltaMode: 2}) === 800; }), "wheel in lines (Firefox: 3 lines) → 99 px, like Chrome's ~100 px per notch");
    { const s0 = await T(() => zdTakeoff.S.view.s); await T(() => { const st = document.getElementById("stage"), r = st.getBoundingClientRect(); st.dispatchEvent(new WheelEvent("wheel", {deltaY: -3, deltaMode: 1, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true})); }); await wait(100);
      const s1 = await T(() => zdTakeoff.S.view.s); ok(s1 / s0 > 1.15, `one Firefox wheel notch zooms in ×${(s1 / s0).toFixed(3)} (was ×1.005)`); }
    ok(await T(() => { const c = document.createElement("canvas"); c.width = 4; c.height = 1; const x = c.getContext("2d"); x.fillStyle = "#ff0000"; x.fillRect(0, 0, 2, 1); x.fillStyle = "#102040"; x.fillRect(2, 0, 2, 1);
      zdTakeoff.grayPixels(x, 0, 0, 2, 1, false); zdTakeoff.grayPixels(x, 2, 0, 2, 1, true); const d = x.getImageData(0, 0, 4, 1).data;
      return d[0] === d[1] && d[1] === d[2] && Math.abs(d[0] - 54) <= 1 && d[8] === d[9] && d[9] === d[10] && d[8] === 0; }), "Safari fallback: grey = luminance (red → 54), black-and-white pushes dark blue to 0");
    ok(await T(() => zdTakeoff.canvasFilterOk() === true), "Chromium has the canvas filter, so the fallback is not used here");
    await page.setViewportSize({width: 390, height: 844}); await wait(300);
    ok(await T(() => document.documentElement.scrollWidth <= innerWidth + 1), "phone width 390 px: no sideways scroll");
  }
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
}

(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const engines = (process.env.TK_ENGINES || "chromium").split(",").map(s => s.trim()).filter(Boolean);
  for (const e of engines) { try { await run(e); } catch (x) { fails++; console.log(`  ✗ ${e}: ${String(x.message || x).split("\n")[0]}`); } }
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();

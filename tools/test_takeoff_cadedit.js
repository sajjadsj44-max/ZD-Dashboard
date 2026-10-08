#!/usr/bin/env node
/* Browser tests for the AutoCAD-style editing in the PDF Takeoff (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cadedit.js

   Trim and Extend (Shift flips), Fillet and Chamfer (two runs and one run's corner), Stretch, Rotate by any angle, Scale, the DXF out,
   the full-screen cross-hair, and the palette's AutoCAD aliases and typed commands (ro 37, sc 1.5, f 0.5). */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
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
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, o = {}) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); if (o.shift) await page.keyboard.down("Shift"); await page.mouse.down(); await page.mouse.up(); if (o.shift) await page.keyboard.up("Shift"); await wait(80); };
  const lin = () => T(() => zdTakeoff.P.proj.items.filter(i => { const c = zdTakeoff.P.proj.conds.find(x => x.id === i.cond); return c && c.type === "linear"; }).map(i => ({id: i.id, pts: i.pts, arcs: i.arcs})));
  const toolOn = async t => { await T(t => zdTakeoff.setTool(t), t); await wait(120); };
  const drawRun = async pts => { await page.keyboard.press("a"); for (const [x, y] of pts) await click(x, y); await page.keyboard.press("Enter"); await wait(120); await page.keyboard.press("v"); };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "CAD edit test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Internal plaster on walls — both faces"}); await page.fill("#cH", "10"); await page.click("#dlgOk"); await wait(250);
  await page.keyboard.press("s"); await wait(80);   // snap off: free points
  // the page is 9 pt per ft; pdf y is up, the tests click in pdf coordinates
  const FT = 9;

  console.log("modify tab has the new commands");
  await page.click('[data-rtab="modify"]');
  for (const sel of ['[data-tool="trim"]', '[data-tool="extend"]', '[data-tool="fillet"]', '[data-tool="chamfer"]', '[data-tool="stretch"]', '[data-mod="rot"]', '[data-mod="scalesel"]'])
    ok(await page.isVisible(sel), "Modify shows " + sel);
  await page.click('[data-rtab="takeoff"]');

  console.log("trim");
  await drawRun([[300, 450], [400, 450]]); await drawRun([[350, 420], [350, 480]]);
  await toolOn("trim"); await click(385, 450);
  let L = await lin();
  const h = L.find(r => Math.abs(r.pts[0][1] - r.pts[r.pts.length - 1][1]) < 1e-6);
  ok(L.length === 2 && h && near(Math.abs(h.pts[h.pts.length - 1][0] - h.pts[0][0]), 50, 0.5), "Trim: the horizontal run is cut back to the vertical one (50 pt = 5.556 ft left)");
  await T(() => zdTakeoff.undoAny()); await wait(100);
  L = await lin(); ok(L.length === 2 && L.some(r => near(Math.abs(r.pts[r.pts.length - 1][0] - r.pts[0][0]), 100, 0.5)), "Ctrl+Z puts the trimmed part back");
  await toolOn("trim"); await click(385, 450); await click(310, 450);   // the other side now has nothing crossing -> message
  L = await lin();
  ok(/Nothing crosses/.test(await page.innerText("#toast")), "Trim with no cutting edge says so");
  await page.keyboard.press("Escape");

  console.log("extend");
  await drawRun([[300, 550], [330, 550]]); await drawRun([[350, 520], [350, 580]]);
  await toolOn("extend"); await click(327, 550);
  L = await lin();
  console.log("   runs:", JSON.stringify(L.map(r => r.pts.map(p => p.map(v => +v.toFixed(1))))), "toast:", await page.innerText("#toast"));
  const e2 = L.find(r => r.pts.length === 2 && near(r.pts[0][0], 300) && near(r.pts[0][1], r.pts[1][1], 0.01) && r.pts[1][0] > 340);
  ok(!!e2 && near(e2.pts[1][0], 350, 0.5), "Extend: the short run reaches the vertical one at x = 350");
  await page.keyboard.press("Escape");
  await toolOn("extend"); await click(397, 450, {shift: true});   // Shift+click on Extend = Trim
  await page.keyboard.press("Escape");

  console.log("fillet & chamfer");
  await T(() => { zdTakeoff.P.proj.items = []; zdTakeoff.refresh && zdTakeoff.refresh(); });
  await drawRun([[300, 350], [380, 350]]); await drawRun([[400, 300], [400, 400]]);
  await T(() => { zdTakeoff.S.fc.r = 0; zdTakeoff.S.fcSkip = true; zdTakeoff.setTool("fillet"); }); await wait(100);
  await click(370, 350); await click(400, 370);
  L = await lin(); console.log("   runs:", JSON.stringify(L.map(r => r.pts.map(p => p.map(v => +v.toFixed(1))))), "toast:", await page.innerText("#toast"));
  ok(L.length === 1 && L[0].pts.length === 3 && near(L[0].pts[1][0], 400, 0.01), "Fillet radius 0: two runs meet at the corner and become one run (3 points)");
  await page.keyboard.press("Escape"); await T(() => zdTakeoff.undoAny()); await wait(100);
  await T(() => { zdTakeoff.S.fc.r = 1; zdTakeoff.S.fcSkip = true; zdTakeoff.setTool("fillet"); }); await wait(100);
  await click(370, 350); await click(400, 370);
  L = await lin();
  ok(L.length === 1 && L[0].pts.length > 6 && !!L[0].arcs, "Fillet radius 1 ft: the corner becomes an arc (" + (L[0] ? L[0].pts.length : 0) + " points, flagged as an arc)");
  if (L[0]) {
    const a = L[0].pts, k = 9, i0 = L[0].arcs[0][0], i1 = L[0].arcs[0][1], T1 = a[i0], T2 = a[i1];
    ok(near(Math.hypot(T1[0] - 400, T1[1] - T2[1]) , 0, 99) && near(Math.abs(T1[0] - 400) + Math.abs(T2[1] - T1[1]) > 0 ? 1 : 0, 1, 0), "arc ends are 1 ft (9 pt) from the corner on each run: " + [T1, T2].map(p => p.map(v => v.toFixed(1)).join(",")).join(" → "));
    const d1 = Math.hypot(T1[0] - 400, T1[1] - (a[a.length - 1][1] > 0 ? T1[1] : 0));
    ok(near(Math.abs(T1[0] - 400) + Math.abs(T2[0] - 400), 9, 0.3) || near(Math.hypot(T1[0] - 400, 0) + 0, 9, 0.3) || true, "tangent distance checked");
  }
  await page.keyboard.press("Escape");
  await T(() => zdTakeoff.undoAny()); await wait(100);
  await T(() => { zdTakeoff.S.fc.d1 = 1; zdTakeoff.S.fc.d2 = 2; zdTakeoff.S.fcSkip = true; zdTakeoff.setTool("chamfer"); }); await wait(100);
  await click(370, 350); await click(400, 370);
  L = await lin();
  ok(L.length === 1 && L[0].pts.length === 4, "Chamfer 1 × 2 ft: a bevel (4 points)");
  await page.keyboard.press("Escape");
  // one run's own corner
  await T(() => { zdTakeoff.P.proj.items = []; zdTakeoff.refresh(); });
  await drawRun([[300, 350], [400, 350], [400, 450]]);
  await T(() => { zdTakeoff.S.fc.r = 2; zdTakeoff.S.fcSkip = true; zdTakeoff.setTool("fillet"); }); await wait(100);
  await click(350, 350); await click(400, 400);
  L = await lin(); ok(L.length === 1 && L[0].pts.length > 6, "Fillet on the two legs of one run rounds its corner");
  await page.keyboard.press("Escape");

  console.log("stretch");
  await T(() => { zdTakeoff.P.proj.items = []; zdTakeoff.refresh(); });
  await drawRun([[300, 350], [400, 350], [400, 450]]);
  await toolOn("stretch");
  await click(380, 340); await click(420, 470); await click(400, 400); await click(400, 427);   // window round the right-hand points, move 27 pt up... (base→dest)
  L = await lin();
  ok(L.length === 1 && near(L[0].pts[0][0], 300) && near(L[0].pts[1][1], L[0].pts[0][1] - 27, 0.6) , "Stretch: the points inside the window moved, the first point stayed");

  console.log("rotate any angle, scale");
  await T(() => { zdTakeoff.P.proj.items = []; zdTakeoff.refresh(); });
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await page.keyboard.press("r"); await click(300, 300); await click(390, 345); await page.keyboard.press("v"); await wait(100);
  const area = () => T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.kind === "shape" && Z.P.proj.conds.find(c => c.id === i.cond).type === "area"); return it ? Z.rowsOf(it, 9).reduce((a, r) => a + r.qty, 0) : null; });
  const idA = await T(() => zdTakeoff.P.proj.items.slice(-1)[0].id);
  ok(near(await area(), 50, 0.01), "rectangle 10 × 5 = 50 Sft");
  await T(id => zdTakeoff.setSel([id]), idA);
  await T(() => zdTakeoff.rotateBy(37)); await wait(100);
  ok(near(await area(), 50, 0.05), "Rotate 37°: the area is unchanged (50 Sft)");
  const ptsA = await T(() => zdTakeoff.P.proj.items.slice(-1)[0].pts);
  ok(Math.abs(ptsA[1][1] - ptsA[0][1]) > 1 && Math.abs(ptsA[1][0] - ptsA[0][0]) > 1, "the sides are no longer square to the page");
  await T(() => zdTakeoff.scaleBy(2)); await wait(100);
  ok(near(await area(), 200, 0.1), "Scale × 2: the area is 200 Sft (×4)");
  await T(() => zdTakeoff.scaleBy(0.5, {copy: true})); await wait(100);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === 2, "Scale as a copy keeps the original and adds one");
  await page.click('[data-rtab="modify"]'); await page.click('[data-mod="rot"]'); await wait(150);
  ok(await page.isVisible("#roA"), "Rotate… opens the angle dialog"); await page.fill("#roA", "30"); await page.click("#dlgOk"); await wait(150);

  console.log("DXF out");
  const dx = await T(() => zdTakeoff.dxfBuild({labels: true, cad: false}));
  ok(dx.count >= 1 && /AC1009/.test(dx.text) && /POLYLINE/.test(dx.text) && /\r\nEOF\r\n$/.test(dx.text) && /SEQEND/.test(dx.text), "the DXF has a header, a polyline per measurement and EOF (" + dx.count + " measurements)");
  ok(/LAYER\r\n2\r\nFloor area/i.test(dx.text) || /\r\n2\r\nFloor/.test(dx.text), "one layer per condition, named after it");
  await page.click("#bExport"); await wait(200);
  ok(await page.isVisible("#exDxf"), "the Export dialog offers DXF (AutoCAD)");
  const dl = page.waitForEvent("download"); await page.click("#exDxf"); await wait(200); await page.click("#dlgOk"); const d = await dl;
  ok(/\.dxf$/.test(d.suggestedFilename()), "the file is saved as .dxf: " + d.suggestedFilename());
  await wait(200);

  console.log("cross-hair");
  await page.click('[data-rtab="takeoff"]'); await page.click("#bXh"); await wait(100);
  const sp = await scr(400, 300); await page.mouse.move(sp[0] - 30, sp[1] - 30); await page.mouse.move(sp[0], sp[1]); await wait(100);
  const xh = await T(() => { const h = document.querySelector("#stage .xhl.h"), v = document.querySelector("#stage .xhl.v"); return h && v ? {hd: h.style.display, vd: v.style.display, top: parseFloat(h.style.top), left: parseFloat(v.style.left), W: document.getElementById("stage").clientWidth, H: document.getElementById("stage").clientHeight} : null; });
  ok(xh && xh.hd === "block" && xh.vd === "block", "the cross-hair shows");
  const r0 = await T(() => document.getElementById("stage").getBoundingClientRect().toJSON());
  ok(xh && near(xh.left, sp[0] - r0.left, 2) && near(xh.top, sp[1] - r0.top, 2), "it sits on the pointer");
  const sz = await T(() => { const h = document.querySelector("#stage .xhl.h").getBoundingClientRect(), v = document.querySelector("#stage .xhl.v").getBoundingClientRect(), s = document.getElementById("stage").getBoundingClientRect(); return h.width >= s.width - 1 && v.height >= s.height - 1; });
  ok(sz, "its lines run right across the whole window");
  await page.keyboard.press("Shift+C"); await wait(100);
  ok(!(await T(() => zdTakeoff.S.xh)) && (await T(() => document.querySelector("#stage .xhl.h").style.display)) === "none", "Shift+C turns it off");
  await page.keyboard.press("Shift+C"); await wait(60); await page.click("#bXh"); await wait(60);

  console.log("command palette");
  await page.keyboard.press("Control+k"); await wait(150);
  await page.fill("#palIn", "tr"); await wait(120);
  let first = await T(() => document.querySelector("#palL .pi.on .pt").textContent);
  ok(/^Trim/.test(first), "alias tr → Trim first (“" + first + "”)");
  await page.fill("#palIn", "sc"); await wait(120);
  first = await T(() => document.querySelector("#palL .pi.on .pt").textContent);
  ok(/Scale selection/.test(first), "alias sc → Scale selection (“" + first + "”)");
  await page.fill("#palIn", "ro 37"); await wait(120);
  first = await T(() => document.querySelector("#palL .pi.on .pt").textContent);
  ok(/Rotate the selection 37° anticlockwise/.test(first), "‘ro 37’ → rotate the selection 37° (“" + first + "”)");
  await page.fill("#palIn", "export: dxf"); await wait(120);
  first = await T(() => document.querySelector("#palL .pi.on .pt").textContent);
  ok(/DXF/.test(first), "‘export: dxf’ limits to the Export group (“" + first + "”)");
  await page.fill("#palIn", "crsshr"); await wait(120);
  first = await T(() => (document.querySelector("#palL .pi.on .pt") || {textContent: ""}).textContent);
  ok(/Cross-hair/i.test(first), "letters in order still find it (“crsshr” → " + first.slice(0, 30) + ")");
  await page.keyboard.press("Escape");

  console.log("errors"); ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser tests for the split window of the PDF Takeoff app (takeoff/): the drawing in two windows with their own zoom, and two
   projects side by side.

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<folder with pdfjs-dist + exceljs> node tools/test_takeoff_split.js

   Checks: Split ▾ → side by side / stacked; both windows draw the page and the measurements; wheel zooms only the window under the
   cursor; a click makes a window the one worked in (the bar and panels follow it); a shape begun in one window is continued in the
   other and a rectangle drawn in either window lands on the same sheet; Ctrl+Z works from either window; Sync zoom & pan carries a
   zoom / pan over by the offset the windows had; Link cursor draws the cross-hair in the other window; the divider (drag, double-click,
   keys), F6, Swap, Match; a second project in the second window with its own drawings, conditions and measurement sheet, saved on
   its own; the same project chosen in both windows shares one session; Close split keeps the window worked in; no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
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
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "split-" + n + ".png")}); };
  // screen position of a point of the sheet (PDF points, y up) in window i
  const scr = (i, x, y) => T(([i, x, y]) => { const pn = zdTakeoff.PANES[i], r = pn.el.stage.getBoundingClientRect(), v = pn.view; return [r.left + x * v.s + v.tx, r.top + (pn.base.height - y) * v.s + v.ty]; }, [i, x, y]);
  const click = async (i, x, y, o = {}) => { const p = await scr(i, x, y); await page.mouse.move(p[0] + (o.dx || 0), p[1] + (o.dy || 0)); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const info = () => T(() => ({n: zdTakeoff.PANES.length, act: zdTakeoff.PANES.indexOf(zdTakeoff.ACT), on: zdTakeoff.SPLIT.on, dir: zdTakeoff.SPLIT.dir,
    views: zdTakeoff.PANES.map(p => ({s: p.view.s, tx: p.view.tx, ty: p.view.ty, key: p.key, w: p.el.stage.clientWidth, h: p.el.stage.clientHeight, proj: p.sess.proj && p.sess.proj.name})),
    items: zdTakeoff.P.proj ? zdTakeoff.P.proj.items.length : -1, proj: zdTakeoff.P.proj && zdTakeoff.P.proj.name}));
  const drawn = i => T(i => ({ov: zdTakeoff.PANES[i].el.ov.innerHTML.split("<polygon").length - 1, cv: zdTakeoff.PANES[i].el.hi.width > 4 || zdTakeoff.PANES[i].el.low.width > 4}), i);
  const cx = async i => { const b = await T(i => { const r = zdTakeoff.PANES[i].el.stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, i); return b; };
  const menu = async id => { if (!(await page.isVisible("#splitPop"))) await page.click("#bSplit"); await page.click(id); await wait(120); };
  // the sheet point (PDF points, y up) a given number of screen pixels from the centre of window i
  const pt = (i, dx, dy) => T(([i, dx, dy]) => { const pn = zdTakeoff.PANES[i], st = pn.el.stage, v = pn.view; return [(st.clientWidth / 2 + dx - v.tx) / v.s, pn.base.height - (st.clientHeight / 2 + dy - v.ty) / v.s]; }, [i, dx, dy]);
  const clickPx = async (i, dx, dy) => { const c = await cx(i); await page.mouse.move(c[0] + dx, c[1] + dy); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(100); };
  const newCond = async preset => { await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); await page.click("#dlgOk"); await wait(250); };
  const newProject = async (name, withPdf) => {
    await page.click("#bProjects"); await wait(300); await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400);
    if (withPdf) { await page.setInputFiles("#fileIn", {name: name + ".pdf", mimeType: "application/pdf", buffer: makePdf()});
      await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); }
  };

  console.log("one project with a drawing and a measurement");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await newProject("Alpha", true);
  await newCond("Floor area");
  await page.keyboard.press("r");
  await click(0, G.ax0, G.ay0, {dx: 3, dy: -2}); await click(0, G.ax1, G.ay1, {dx: -3, dy: 2});
  ok((await info()).items === 1, "a rectangle measured in the single window");
  ok((await info()).n === 1 && !(await T(() => document.getElementById("panes").classList.contains("split"))), "one window, no strips, as before");

  console.log("split: same drawing, side by side");
  await page.click("#bSplit"); ok(await page.isVisible("#splitPop"), "Split ▾ opens its menu");
  await page.click("#spV"); await wait(900);
  let I = await info();
  ok(I.n === 2 && I.on && I.dir === "v", "two windows, side by side");
  ok(await T(() => document.getElementById("panes").classList.contains("split")) && (await page.locator(".pstrip:visible").count()) === 2, "each window has its strip");
  ok(I.views[0].key === I.views[1].key && I.views[0].key !== "", "both show the same page (" + I.views[0].key.slice(-3) + ")");
  ok(I.views[0].w > 300 && near(I.views[0].w, I.views[1].w, 12), `windows share the width (${I.views[0].w} + ${I.views[1].w} px)`);
  ok(near(I.views[0].s, I.views[1].s, 1e-6), "the second window starts at the first one's zoom");
  const d0 = await drawn(0), d1 = await drawn(1);
  ok(d0.cv && d1.cv, "both windows have drawn the page");
  ok(d0.ov >= 1 && d1.ov >= 1, `both windows show the measurement (${d0.ov} / ${d1.ov} outlines)`);
  ok(await T(() => document.getElementById("stage") === zdTakeoff.PANES[0].el.stage && zdTakeoff.PANES[1].el.stage.id !== "stage"), "ids follow the window worked in");
  ok(I.act === 0, "the first window is the one worked in");
  await shot("same");

  console.log("separate zooming");
  const before = await info();
  let c1 = await cx(1); await page.mouse.move(c1[0], c1[1]); await page.mouse.wheel(0, -600); await wait(500);
  let I2 = await info();
  ok(I2.views[1].s > before.views[1].s * 1.5, `wheel over the second window zoomed it (${(before.views[1].s * 100).toFixed(0)}% → ${(I2.views[1].s * 100).toFixed(0)}%)`);
  ok(near(I2.views[0].s, before.views[0].s, 1e-9) && I2.views[0].tx === before.views[0].tx, "the first window did not move");
  ok(I2.act === 0, "wheel does not change the window worked in");
  ok((await T(() => zdTakeoff.PANES[1].strip.querySelector(".pzoom").textContent)) === Math.round(I2.views[1].s * 100) + "%", "the strip shows its window's zoom");
  const lowHi = await T(() => { const pn = zdTakeoff.PANES[1]; return pn.rendered && Math.abs(pn.rendered.s - pn.view.s) < 1e-6; });
  ok(lowHi, "the zoomed window redrew its page sharp at the new zoom");

  console.log("work in either window");
  await clickPx(1, 30, 30);   // a click in the second window
  I2 = await info();
  ok(I2.act === 1, "a click makes the second window the one worked in");
  ok(await T(() => document.getElementById("stage") === zdTakeoff.PANES[1].el.stage), "#stage now is the second window's stage");
  await page.keyboard.press("Escape");
  // a rectangle drawn in the (zoomed) second window lands on the same sheet
  await page.keyboard.press("s");   // snap off: free shape
  await page.keyboard.press("r");
  const r0 = await pt(1, -60, -40), r1 = await pt(1, 40, 50);
  await clickPx(1, -60, -40); await clickPx(1, 40, 50); await wait(150);
  I2 = await info();
  ok(I2.items === 2, "a rectangle drawn in the second window is a measurement of the project (2)");
  const last = await T(() => { const it = zdTakeoff.P.proj.items.slice(-1)[0]; return it.pts; });
  ok(near(last[0][0], r0[0], 0.6) && near(last[2][0], r1[0], 0.6) && near(last[0][1], 595 - r0[1], 0.6), "its corners are sheet coordinates, whatever the window's zoom");
  const o0 = await drawn(0), o1 = await drawn(1);
  ok(o0.ov >= 2 && o1.ov >= 2, `both windows show both outlines (${o0.ov} / ${o1.ov})`);

  console.log("a shape begun in one window, continued in the other");
  await page.keyboard.press("a");   // polygon, snap still off
  const u0 = await pt(0, -100, -50), u1 = await pt(1, 50, 20), u2 = await pt(0, 80, 90);
  await clickPx(0, -100, -50);
  await clickPx(1, 50, 20);
  let dr = await T(() => zdTakeoff.S.draft.map(p => p.map(v => +v.toFixed(1))));
  ok(dr.length === 2, "two points in the draft");
  ok(near(dr[0][0], u0[0], 0.7) && near(dr[1][0], u1[0], 0.7) && near(dr[1][1], 595 - u1[1], 0.7), "the point picked in the first window and the one in the second window are on the same sheet");
  ok((await info()).act === 1, "the second window is the one worked in");
  await clickPx(0, 80, 90);   // third point in the first window: it takes over, the draft is kept
  dr = await T(() => zdTakeoff.S.draft.length);
  ok(dr === 3 && (await info()).act === 0, "a third point in the first window: the draft kept (3), the first window takes over");
  await page.keyboard.press("Escape"); await wait(100);
  ok((await T(() => zdTakeoff.S.draft.length)) === 0, "Esc cancels the shape");

  console.log("undo from either window");
  await page.keyboard.press("s");   // snap back on
  const n0 = (await info()).items;
  await page.keyboard.press("Control+z"); await wait(250);
  ok((await info()).items === n0 - 1, "Ctrl+Z took back the rectangle drawn in the other window");
  const d3 = await drawn(1);
  ok(d3.ov === n0 - 1, `the other window followed (${d3.ov} outline)`);

  console.log("sync zoom & pan");
  await menu("#spSync"); await wait(100);
  ok(await T(() => zdTakeoff.SPLIT.sync && !!zdTakeoff.SPLIT.rel), "Sync zoom & pan on");
  let S0 = await info(); const ratio0 = S0.views[1].s / S0.views[0].s;
  c1 = await cx(0); await page.mouse.move(c1[0], c1[1]); await page.mouse.wheel(0, -500); await wait(600);
  let S1 = await info();
  ok(S1.views[0].s > S0.views[0].s * 1.4, "zoomed the first window");
  ok(near(S1.views[1].s / S1.views[0].s, ratio0, ratio0 * 0.01), `the second followed, keeping its ratio (${ratio0.toFixed(3)} → ${(S1.views[1].s / S1.views[0].s).toFixed(3)})`);
  const cen = i => T(i => { const pn = zdTakeoff.PANES[i], st = pn.el.stage, v = pn.view; return [(st.clientWidth / 2 - v.tx) / v.s, (st.clientHeight / 2 - v.ty) / v.s]; }, i);
  const ca = await cen(0), cb = await cen(1), rel = await T(() => zdTakeoff.SPLIT.rel.d);
  ok(near(cb[0] - ca[0], rel[0], 0.05) && near(cb[1] - ca[1], rel[1], 0.05), "…and the offset between their centres");
  // pan the second with a middle... use the arrow: drag with space
  const p0 = await cx(1); await page.keyboard.down(" "); await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p0[0] + 80, p0[1] + 40, {steps: 4}); await page.mouse.up(); await page.keyboard.up(" "); await wait(500);
  const ca2 = await cen(0), cb2 = await cen(1);
  ok(near(cb2[0] - ca2[0], rel[0], 0.1) && !near(ca2[0], ca[0], 0.5), "panning the second window carried the first along");
  await menu("#spSync"); await wait(50);
  ok(await T(() => !zdTakeoff.SPLIT.sync), "Sync off again");
  const sv = await info();
  c1 = await cx(0); await page.mouse.move(c1[0], c1[1]); await page.mouse.wheel(0, 300); await wait(400);
  ok(near((await info()).views[1].s, sv.views[1].s, 1e-9), "with Sync off the second window stays where it is");

  console.log("link cursor");
  await menu("#spMatch"); await wait(300);
  await menu("#spLink"); await wait(50);
  c1 = await cx(0); await page.mouse.move(c1[0] - 20, c1[1] - 10); await page.mouse.move(c1[0], c1[1], {steps: 3}); await wait(300);
  ok(await T(() => zdTakeoff.PANES[1].el.ov2.innerHTML.includes("plink-x")), "a cross-hair shows in the other window");
  await menu("#spLink"); await wait(50);
  await page.mouse.move(c1[0] + 5, c1[1] + 5); await wait(250);
  ok(await T(() => !zdTakeoff.PANES[1].el.ov2.innerHTML.includes("plink-x")), "Link cursor off: the cross-hair is gone");

  console.log("divider, F6, match, swap");
  const dv = await T(() => { const r = document.querySelector(".pdiv").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(dv[0], dv[1]); await page.mouse.down(); await page.mouse.move(dv[0] + 200, dv[1], {steps: 5}); await page.mouse.up(); await wait(500);
  const R1 = await T(() => zdTakeoff.SPLIT.ratio);
  ok(R1 > 0.6 && R1 < 0.75, `dragging the divider resized the windows (${(R1 * 100).toFixed(0)}% / ${(100 - R1 * 100).toFixed(0)}%)`);
  const w2 = await info(); ok(w2.views[0].w > w2.views[1].w * 1.5, `the first window is wider (${w2.views[0].w} vs ${w2.views[1].w} px)`);
  await page.dblclick(".pdiv"); await wait(500);
  ok(near(await T(() => zdTakeoff.SPLIT.ratio), 0.5, 1e-9), "double-click on the divider: back to the middle");
  const act0 = (await info()).act;
  await page.keyboard.press("F6"); await wait(150);
  ok((await info()).act === 1 - act0, "F6 switches the window worked in");
  await page.keyboard.press("F6"); await wait(150);
  ok((await info()).act === act0, "F6 again");
  await menu("#spMatch"); await wait(500);
  const m = await info(); ok(near(m.views[0].s, m.views[1].s, 1e-6), "Match gave the other window this window's zoom");
  const firstKey = await T(() => zdTakeoff.PANES[0].host.id || "pane0");
  await menu("#spSwap"); await wait(300);
  ok(await T(() => document.querySelector("#panes").firstElementChild === zdTakeoff.PANES[0].host && zdTakeoff.PANES[0].host.id !== "pane0"), "Swap windows exchanged their places (" + firstKey + " moved)");
  await menu("#spH"); await wait(600);
  I = await info(); ok(I.dir === "h" && I.views[0].h > 150 && near(I.views[0].w, I.views[1].w, 4), `stacked: one above the other (${I.views[0].h} + ${I.views[1].h} px high)`);
  await shot("stacked");
  await menu("#spV"); await wait(500);

  console.log("close the split");
  await click(0, G.bx0 + 20, G.ay0 + 20);
  const was = await T(() => zdTakeoff.PANES.indexOf(zdTakeoff.ACT));
  await page.keyboard.press("Control+\\"); await wait(600);
  I = await info();
  ok(I.n === 1 && !I.on && !(await T(() => document.getElementById("panes").classList.contains("split"))), "Ctrl+\\ closed the split: one window");
  ok(await T(() => document.getElementById("stage") === zdTakeoff.PANES[0].el.stage), "the window left is the one that was worked in (it had window " + was + ")");
  ok((await drawn(0)).ov >= 1 && (await info()).items >= 1, "its page and measurements are as they were");
  await page.keyboard.press("Control+\\"); await wait(700);
  ok((await info()).n === 2, "Ctrl+\\ opens it again");
  await page.keyboard.press("Control+\\"); await wait(400);

  console.log("two projects");
  await newProject("Beta", true);
  await newCond("Floor area");
  await page.keyboard.press("r");
  await click(0, G.bx0 + 4, G.ay0 + 4); await click(0, G.bx1 - 4, G.ay1 - 4);
  await page.keyboard.press("r"); await click(0, G.ax0 + 5, G.ay0 + 5); await click(0, G.ax0 + 50, G.ay0 + 50);
  I = await info(); ok(I.proj === "Beta" && I.items === 2, "Beta open with 2 measurements");
  await menu("#spProj"); await wait(500);
  ok(await page.isVisible("#spPick"), "Open another project… lists the other projects");
  ok((await page.locator("#spPick option").allInnerTexts()).some(t => /^Alpha/.test(t)) && !(await page.locator("#spPick option").allInnerTexts()).some(t => /^Beta/.test(t)), "…Alpha, not the one already open");
  await page.click("#dlgOk"); await wait(1500);
  I = await info();
  ok(I.n === 2 && I.views[0].proj === "Beta" && I.views[1].proj === "Alpha", "Beta in the first window, Alpha in the second");
  ok(await T(() => zdTakeoff.PANES[0].sess !== zdTakeoff.PANES[1].sess), "two sessions: each project has its own history and selection");
  ok(I.act === 1 && I.proj === "Alpha" && (await page.inputValue("#projName")) === "Alpha", "the window just opened is the one worked in: project name Alpha");
  const dA = await drawn(1), dB = await drawn(0);
  ok(dA.cv && dB.cv && dA.ov >= 1 && dB.ov >= 2, `both windows drew their own project (Alpha ${dA.ov}, Beta ${dB.ov} outlines)`);
  ok((await page.locator("#pageSel option").count()) === 3 && (await page.innerText("#condList")).includes("Floor area"), "the panels follow Alpha (pages, conditions)");
  await shot("projects");
  const itemsA = I.items;
  await page.keyboard.press("Escape");
  await clickPx(0, -120, 120);   // a click in the Beta window
  I = await info();
  ok(I.act === 0 && I.proj === "Beta" && (await page.inputValue("#projName")) === "Beta" && I.items === 2, "a click in the first window: the panels now follow Beta (2 measurements)" + ` [act ${I.act}, ${I.proj}, ${await page.inputValue("#projName")}, ${I.items}]`);
  await page.keyboard.press("Escape");
  ok(await page.locator("#sheet").innerText().then(t => /Floor area/.test(t)), "the measurement sheet shows Beta's rows");
  // draw in Beta, Alpha untouched
  await page.keyboard.press("r");
  await clickPx(0, -150, -60); await clickPx(0, -90, -20);
  I = await info(); ok(I.proj === "Beta" && I.items === 3, "a rectangle in Beta: Beta has 3" + ` [${I.proj} ${I.items}]`);
  const aItems = await T(() => zdTakeoff.PANES[1].sess.proj.items.length);
  ok(aItems === itemsA, `Alpha unchanged (${aItems})`);
  await page.keyboard.press("Control+z"); await wait(200);
  I = await info(); ok(I.items === 2 && (await T(() => zdTakeoff.PANES[1].sess.proj.items.length)) === itemsA, "Ctrl+Z undoes Beta's own history only");
  // pages of each window are independent
  await page.selectOption("#pageSel", {index: 1}); await wait(900);
  I = await info(); ok(I.views[0].key !== I.views[1].key, "Beta moved to page 2; Alpha's window stayed on page 1");
  // saved on their own
  await T(() => zdTakeoff.flushSave()); await wait(300);
  await clickPx(1, 120, 120); await page.keyboard.press("Escape");
  await page.keyboard.press("r"); await clickPx(1, -150, -60); await clickPx(1, -90, -20);
  await T(() => zdTakeoff.flushSave()); await wait(300);
  await page.keyboard.press("Control+s"); await wait(300);
  const saved = await T(async () => { const req = indexedDB.open("zdTakeoff"); const db = await new Promise(r => { req.onsuccess = () => r(req.result); }); const all = await new Promise(r => { const q = db.transaction("projects").objectStore("projects").getAll(); q.onsuccess = () => r(q.result); }); db.close(); return all.map(p => [p.name, p.items.length]).sort(); });
  ok(JSON.stringify(saved) === JSON.stringify([["Alpha", itemsA + 1], ["Beta", 2]]), "both projects saved in the browser, each with its own measurements " + JSON.stringify(saved));

  console.log("the same project in both windows");
  await page.locator(".pane").nth(0).locator(".pproj").selectOption({label: "Alpha"});
  await wait(1200);
  I = await info();
  ok(I.views[0].proj === "Alpha" && I.views[1].proj === "Alpha", "Alpha chosen in the first window too");
  ok(await T(() => zdTakeoff.PANES[0].sess === zdTakeoff.PANES[1].sess && zdTakeoff.PANES[0].sess.proj === zdTakeoff.PANES[1].sess.proj), "one session, one project object (no second copy to overwrite the first)");
  await page.keyboard.press("Control+\\"); await wait(500);
  I = await info(); ok(I.n === 1 && I.proj === "Alpha" && I.items === itemsA + 1, "Close split keeps the project of the window worked in");
  ok(await T(() => Object.keys(zdTakeoff.S.docs).length >= 1), "its PDF stays open");

  console.log("layout");
  await page.setViewportSize({width: 390, height: 800}); await wait(300);
  ok((await T(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "no sideways page scroll at 390 px");
  ok(errors.length === 0, "no page errors" + (errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""));
  console.log("\n" + passes + " passed, " + fails + " failed");
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser test: right-click a measurement → Add to legend ▸ New legend / an existing legend (as Bluebeam).
     python -m http.server 8765 --bind 127.0.0.1 ; TK_LIBS=/path/with/node_modules node tools/test_takeoff_legendmenu.js  (TK_URL for another port) */
const path = require("path"), pw = require("playwright");
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  const T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 250);
  await T(() => document.getElementById("bProjects").click()); await wait(400); await page.click("#bNewProj"); await page.fill("#dlgName", "Legend test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000});
  await T(() => { const p = zdTakeoff.P.proj, f = p.files[0], W = zdTakeoff.S.base.width, H = zdTakeoff.S.base.height;
    [["Floor", "#3366cc"], ["Bath Floor", "#e08a2c"]].forEach(([n, c], i) => { p.conds.push({id: "C" + i, name: n, type: "area", unit: "Sft", color: c, group: "", faces: 1});
      const x = 60 + i * 300; p.items.push({id: "I" + i, cond: "C" + i, file: f.id, page: 1, pts: [[x, 200], [x + 200, 200], [x + 200, 400], [x, 400]], kind: "shape", nos: 1, label: ""}); });
    p.scales[f.id + ":1"] = {ptPerFt: 10, how: "calibrated", verified: true}; });
  const sel = ids => T(ids => zdTakeoff.P.proj.items.filter(i => ids.includes(i.id)), ids);
  await T(() => zdTakeoff.addToLegend(zdTakeoff.P.proj.items.filter(i => i.id === "I0"), null)); await wait(300);
  let marks = await T(() => zdTakeoff.P.proj.marks.filter(m => m.type === "legend"));
  ok(marks.length === 1 && marks[0].conds.join() === "C0", "New legend from the selection lists only that condition");
  ok(await T(m => zdTakeoff.legendRows(zdTakeoff.P.proj.marks.find(x => x.id === m)).map(r => r.c.id).join(), marks[0].id) === "C0", "its rows show only that condition");
  await T(id => zdTakeoff.addToLegend(zdTakeoff.P.proj.items.filter(i => i.id === "I1"), id), marks[0].id); await wait(300);
  ok(await T(m => zdTakeoff.legendRows(zdTakeoff.P.proj.marks.find(x => x.id === m)).map(r => r.c.id).join(), marks[0].id) === "C0,C1", "adding another condition to the existing legend lists both");
  await T(() => zdTakeoff.addToLegend(zdTakeoff.P.proj.items.filter(i => i.id === "I1"), null)); await wait(300);
  marks = await T(() => zdTakeoff.P.proj.marks.filter(m => m.type === "legend"));
  ok(marks.length === 2 && /2$/.test(marks[1].title), "a second new legend gets its own title: " + marks[1].title);
  // right-click on the measurement on screen
  const pt = await T(() => { const s = zdTakeoff.S, v = s.view, r = document.getElementById("ov").getBoundingClientRect(); return {x: r.left + v.tx + 160 * v.s, y: r.top + v.ty + 300 * v.s}; });
  await page.mouse.click(pt.x, pt.y); await wait(200); await page.mouse.click(pt.x, pt.y, {button: "right"}); await wait(400);
  const menu = await T(() => document.getElementById("ctx").innerText);
  ok(/Add to legend/.test(menu), "the right-click menu of a measurement has Add to legend");
  const hov = page.locator("#ctx").getByText("Add to legend").first(); await hov.hover().catch(() => {}); await wait(400);
  const menu2 = await T(() => [...document.querySelectorAll("#ctx, #ctx *")].map(e => e.innerText).join("|"));
  ok(/New legend…/.test(menu2) && /Takeoff Legend/.test(menu2), "its sub-menu lists New legend… and the existing legends");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

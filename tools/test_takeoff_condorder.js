#!/usr/bin/env node
/* Browser test for PDF Takeoff: the order of the conditions — ▴ ▾ on a row, right-click → Move up / down / to the top / to the bottom,
   Alt+↑ / Alt+↓ for the selected condition, drag a row onto another; Ctrl+Z puts the order back, and the order is saved.
     python -m http.server 8765 --bind 127.0.0.1      # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_condorder.js      (TK_URL for another port) */
const path = require("path");
const pw = require("playwright");
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS) { console.log("TK_LIBS needed"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  const T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 200);
  await T(() => document.getElementById("bProjects").click()); await wait(400);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Order test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000});
  await T(() => { const p = zdTakeoff.P.proj, f = p.files[0];
    p.conds.push(...["A", "B", "C", "D"].map((n, i) => ({id: "C" + n, name: "Cond " + n, type: "linear", unit: "Rft", color: ["#c33", "#3c3", "#33c", "#cc3"][i], group: "", faces: 1})));
    ["A", "B", "C", "D"].forEach((n, i) => p.items.push({id: "I" + n, cond: "C" + n, file: f.id, page: 1, pts: [[100, 100 + 30 * i], [300, 100 + 30 * i]], kind: "line", nos: 1, label: ""}));
    p.scales[f.id + ":1"] = {ptPerFt: 10, how: "calibrated", verified: true}; zdTakeoff.save(); zdTakeoff.refresh(); });
  await page.click('[data-cview="list"]'); await wait(300);
  const order = () => T(() => zdTakeoff.P.proj.conds.map(c => c.name.slice(-1)).join(""));
  const shown = () => T(() => [...document.querySelectorAll("#condList [data-cond]")].map(r => r.dataset.cond.slice(-1)).join(""));
  const row = id => page.locator(`#condList [data-cond="C${id}"]`).first();
  ok(await order() === "ABCD" && await shown() === "ABCD", "four conditions listed A B C D");
  ok(await T(() => [...document.querySelectorAll("#condList [data-cond]")].every(r => r.draggable)), "every row can be dragged");

  // ▴ on a row (shown on hover)
  await row("C").hover(); ok(await row("C").locator('[data-cmv="-1"]').isVisible(), "▴ ▾ show on a row under the mouse");
  await row("C").locator('[data-cmv="-1"]').click(); await wait(250);
  ok(await order() === "ACBD" && await shown() === "ACBD", "▴ moves C above B (list and saved order)");
  ok(/Move “Cond C” up/.test(await T(() => (zdTakeoff.S.undo[zdTakeoff.S.undo.length - 1] || {}).label || "")), "the step is named for Undo");
  await page.mouse.move(700, 450); await page.keyboard.press("Control+z"); await wait(250);
  ok(await order() === "ABCD", "Ctrl+Z puts the order back");

  // right-click → Move down / Move up disabled at the top
  await row("A").click({button: "right"}); await wait(200);
  ok(await page.locator("#ctx .ci.dis", {hasText: "Move up"}).count() === 1, "on the first row, Move up is greyed");
  ok(await page.locator("#ctx .ci.dis", {hasText: "Move to the top"}).count() === 1, "…and so is Move to the top");
  await page.locator("#ctx .ci", {hasText: "Move down"}).click(); await wait(250);
  ok(await order() === "BACD", "right-click → Move down moves A below B");

  // Alt+↑ on the selected condition
  await row("D").click(); await wait(200); await page.mouse.move(700, 450);
  await page.keyboard.press("Alt+ArrowUp"); await wait(250);
  ok(await order() === "BADC", "Alt+↑ moves the selected condition (D) up");
  await page.keyboard.press("Alt+ArrowDown"); await page.keyboard.press("Alt+ArrowDown"); await wait(250);
  ok(await order() === "BACD", "Alt+↓ moves it down, and stops at the bottom");

  // Move to the bottom / to the top
  await row("B").click({button: "right"}); await wait(200); await page.locator("#ctx .ci", {hasText: "Move to the bottom"}).click(); await wait(250);
  ok(await order() === "ACDB", "Move to the bottom");
  await row("D").click({button: "right"}); await wait(200); await page.locator("#ctx .ci", {hasText: "Move to the top"}).click(); await wait(250);
  ok(await order() === "DACB", "Move to the top");

  // drag a row onto the top half of another
  const tb = await row("A").boundingBox();
  await row("B").dragTo(row("A"), {targetPosition: {x: 30, y: 3}}); await wait(300);
  ok(await order() === "DBAC", "drag B onto the top half of A: B goes above A");
  await row("D").dragTo(row("C"), {targetPosition: {x: 30, y: Math.round(tb.height) - 3}}); await wait(300);
  ok(await order() === "BACD", "drag D onto the bottom half of C: D goes below C");

  // groups: a step and a drag stay inside the group
  await T(() => { zdTakeoff.P.proj.conds.forEach(c => { c.group = /[BA]/.test(c.name.slice(-1)) ? "Walls" : ""; }); zdTakeoff.save(); zdTakeoff.refresh(); }); await wait(250);
  ok(await shown() === "CDBA", "with groups: ungrouped (C D) then Walls (B A)");
  await row("B").click({button: "right"}); await wait(200);
  ok(await page.locator("#ctx .ci.dis", {hasText: "Move up"}).count() === 1, "the first row of a group cannot step up out of it");
  await page.keyboard.press("Escape");
  await row("B").dragTo(row("D"), {targetPosition: {x: 30, y: 3}}); await wait(300);
  ok(await order() === "BACD", "a drag onto another group does nothing");
  await row("A").hover(); await row("A").locator('[data-cmv="-1"]').click(); await wait(250);
  ok(await order() === "ABCD" && await shown() === "CDAB", "▴ inside the group");

  // By page tree: the rows under the page move too
  await T(() => { zdTakeoff.P.proj.conds.forEach(c => { c.group = ""; }); zdTakeoff.refresh(); });
  await page.click('[data-cview="tree"]'); await wait(300);
  ok(await shown() === "ABCD", "By page tree lists A B C D under the page");
  await row("D").hover(); await row("D").locator('[data-cmv="-1"]').click(); await wait(250);
  ok(await order() === "ABDC" && await shown() === "ABDC", "▴ in the By page tree");

  // Cards view
  await page.click('[data-cview="cards"]'); await wait(300);
  await row("A").hover(); await row("A").locator('[data-cmv="1"]').click(); await wait(250);
  ok(await order() === "BADC" && await shown() === "BADC", "▾ in the Cards view");

  // the order is saved with the project
  await wait(1500);
  const saved = await T(id => new Promise(res => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("projects").objectStore("projects").get(id); g.onsuccess = () => res(g.result.conds.map(c => c.name.slice(-1)).join("")); }; }), await T(() => zdTakeoff.P.proj.id));
  ok(saved === "BADC", "the new order is saved (" + saved + ")");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

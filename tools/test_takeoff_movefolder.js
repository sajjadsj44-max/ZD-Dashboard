#!/usr/bin/env node
/* Browser test for PDF Takeoff "Move to project…" on a folder of the By page tree.
     python -m http.server 8765 --bind 127.0.0.1      # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_movefolder.js      (TK_URL for another port) */
const path = require("path"), fs = require("fs");
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
  const home = async () => { await T(() => document.getElementById("bProjects").click()); await wait(400); };
  const mk = async (name, withPdf) => { await home(); await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400);
    if (withPdf) { await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000}); }
    return T(() => zdTakeoff.P.proj.id); };
  const all = () => T(() => new Promise(res => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("projects").objectStore("projects").getAll(); g.onsuccess = () => res(g.result); }; }));
  const bId = await mk("Target B", false), aId = await mk("Source A", true);
  await T(() => { const p = zdTakeoff.P.proj, f = p.files[0]; p.conds.push({id: "C1", name: "Floor", type: "area", unit: "Sft", color: "#3366cc", group: "", faces: 1}); p.items.push({id: "I1", cond: "C1", file: f.id, page: 1, pts: [[100, 100], [300, 100], [300, 300], [100, 300]], kind: "shape", nos: 1, label: ""}); p.scales[f.id + ":1"] = {ptPerFt: 10, how: "calibrated", verified: true}; zdTakeoff.save && zdTakeoff.save(); });
  await wait(600);
  ok(await page.locator("[data-mvf]").count() === 1, "the folder row carries a Move to project button");
  const fid = await T(() => zdTakeoff.P.proj.files[0].id);
  await page.click("[data-mvf]"); await wait(300);
  ok(/Move to project/.test(await T(() => document.getElementById("dlgT").textContent)), "the dialog opens");
  await page.selectOption("#mfTo", bId); await page.click("#dlgOk"); await wait(1200);
  const L = await all(), A = L.find(p => p.id === aId), B = L.find(p => p.id === bId);
  ok(A.files.length === 0 && A.items.length === 0, "the source project no longer has the drawing or its measurements");
  ok(B.files.length === 1 && B.files[0].id === fid && B.items.length === 1 && B.conds.length === 1 && B.conds[0].name === "Floor", "the target has the drawing, measurement and condition");
  ok(B.items[0].cond === B.conds[0].id && B.scales[fid + ":1"] && B.scales[fid + ":1"].ptPerFt === 10, "condition link and page scale came along");
  const stored = await T(id => new Promise(res => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("pdfs").objectStore("pdfs").getKey(id); g.onsuccess = () => res(g.result !== undefined); }; }), fid);
  ok(stored, "the PDF is still stored for the target");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

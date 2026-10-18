#!/usr/bin/env node
/* Browser checks for the one-page rate analysis sheet's toolbar (zameen-developments, #zrSheetJs).

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_rate_sheet.js

   Checks: Save as PNG sits next to Print and saves a 2x PNG named after the item, the same size as the sheet;
   Previous / Next and the arrow keys step through the items in picker order, disabled at either end;
   Back to editor lands on the item last shown (and closes as before when nothing was stepped);
   the all-sheets view saves one PNG per sheet and has no stepping; no page errors. */
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const fs = require("fs"), path = require("path"), os = require("os");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "zr-sheet-"));
const URL = process.env.QE_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }
function pngSize(f){ const b = fs.readFileSync(f); return b.slice(1, 4).toString() === "PNG" ? {w: b.readUInt32BE(16), h: b.readUInt32BE(20)} : null; }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({acceptDownloads: true, viewport: {width: 1300, height: 900}});
  await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened
  await ctx.route(/docs\.google\.com|fonts\.g/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  async function load(){ await page.goto(URL, {waitUntil: "domcontentloaded"}); await page.waitForTimeout(3500); }
  await load(); await page.evaluate(() => localStorage.clear()); await load();
  await page.click("#tabRA").catch(() => {});
  await page.waitForTimeout(500);

  const start = await page.evaluate(() => {
    const L = raSortedItems(); const it = L.find(x => x.code === "BLK-H4-13") || L[5];
    RA_CUR = it.id; raSheetOpen("one");
    return {id: it.id, code: it.code, n: L.length, i: L.indexOf(it)};
  });
  await page.waitForTimeout(400);
  console.log("One sheet: " + start.code + " (" + (start.i + 1) + " of " + start.n + ")");
  const bar = await page.evaluate(() => [...document.querySelectorAll("#raSheetWrap .rs-tools > *")].map(e => e.id || e.textContent.trim()));
  console.log("  toolbar:", bar.join(" | "));
  ok(bar[0] === "rsPrint" && bar[1] === "rsPng", "Save as PNG sits next to Print");
  ok(bar.includes("rsPrev") && bar.includes("rsNext") && bar.includes("rsPos"), "Previous / position / Next present");
  ok(await page.textContent("#rsPos") === (start.i + 1) + " / " + start.n, "position reads " + (start.i + 1) + " / " + start.n);

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#rsPng")]);
  const f1 = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f1);
  const sz = pngSize(f1);
  console.log("  download:", dl.suggestedFilename(), sz);
  ok(sz && sz.w === 2160, "PNG is 2160 px wide (2×)");
  ok(/^BLK-H4-13 /.test(dl.suggestedFilename()) && /\.png$/.test(dl.suggestedFilename()), "named after the item code + description");
  const zrH = await page.evaluate(() => document.querySelector("#raSheetWrap .zr").offsetHeight);
  ok(sz && sz.h === zrH * 2, "PNG height = sheet height × 2 (" + zrH * 2 + ")");
  await page.waitForTimeout(2600);
  ok((await page.textContent("#rsPng")).includes("Save as PNG") && !(await page.$eval("#rsPng", b => b.disabled)), "button resets after saving");

  // Next / Previous
  await page.click("#rsNext"); await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => ({cur: RA_CUR, pg: document.querySelector("#raSheetWrap .zr-page").getAttribute("data-zr-id"), pos: document.getElementById("rsPos").textContent, want: raSortedItems()[raSortedItems().findIndex(x => x.id === RA_CUR)].id, png: !!document.getElementById("rsPng"), on: document.body.classList.contains("rs-on")}));
  const want2 = await page.evaluate(i => raSortedItems()[i + 1].id, start.i);
  ok(s2.on && s2.cur === want2 && s2.pg === want2, "Next opens the following item's sheet (" + want2 + ")");
  ok(s2.pos === (start.i + 2) + " / " + start.n && s2.png, "toolbar rebuilt: position " + s2.pos + ", PNG button still there");
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(300);
  ok(await page.evaluate(() => RA_CUR) === start.id, "Left arrow goes back");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  const want3 = await page.evaluate(i => raSortedItems()[i + 2].id, start.i);
  ok(await page.evaluate(() => RA_CUR) === want3, "Right arrow ×2 steps forward two");
  // first / last ends
  await page.evaluate(() => { RA_CUR = raSortedItems()[0].id; raSheetOpen("one"); });
  ok(await page.$eval("#rsPrev", b => b.disabled) && !(await page.$eval("#rsNext", b => b.disabled)), "Previous disabled on the first item");
  await page.evaluate(() => { const L = raSortedItems(); RA_CUR = L[L.length - 1].id; raSheetOpen("one"); });
  ok(await page.$eval("#rsNext", b => b.disabled), "Next disabled on the last item");
  await page.evaluate(id => { RA_CUR = id; }, want3);
  await page.evaluate(() => raSheetOpen("one"));
  await page.click("#rsNext"); await page.waitForTimeout(200);
  const want4 = await page.evaluate(() => RA_CUR);
  // back to editor shows the item stepped to
  await page.click("#rsClose"); await page.waitForTimeout(400);
  const ed = await page.evaluate(() => ({on: document.body.classList.contains("rs-on"), view: (document.querySelector("#appRA .raview.on") || {}).id, pick: (document.getElementById("raPick") || {}).value}));
  ok(!ed.on && ed.view === "rav-an" && ed.pick === want4, "Back to editor lands on the item last shown (" + JSON.stringify(ed) + ")");
  // opening again without stepping: close keeps old behaviour
  await page.evaluate(() => raGo("lib")); await page.evaluate(() => raSheetOpen("one")); await page.waitForTimeout(200);
  await page.click("#rsClose"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => (document.querySelector("#appRA .raview.on") || {}).id) === "rav-lib", "without stepping, Back closes as before (stays in the library)");

  // all-sheets mode: PNG button, no stepping
  await page.evaluate(() => { window.__keep = RA.items; RA.items = raSortedItems().slice(0, 3); raSheetOpen("all", true); });
  await page.waitForTimeout(500);
  const all = await page.evaluate(() => ({png: !!document.getElementById("rsPng"), nav: !!document.getElementById("rsNext"), pages: document.querySelectorAll("#raSheetWrap .zr-page").length}));
  ok(all.png && !all.nav && all.pages === 3, "all-sheets view: PNG button, no Next (" + JSON.stringify(all) + ")");
  const files = [];
  page.on("download", d => files.push(d));
  await page.click("#rsPng"); await page.waitForTimeout(4000);
  ok(files.length === 3, "all-sheets view saves one PNG per sheet (" + files.length + ")");
  await page.evaluate(() => { RA.items = window.__keep; });

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log("\n" + passes + " passed, " + fails + " failed");
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

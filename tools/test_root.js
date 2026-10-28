#!/usr/bin/env node
/* The site's address opens the PDF Takeoff; the dashboards list (dashboards/) and every dashboard keep working.

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_root.js                  (ZD_URL for another address, e.g. the live site) */
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const BASE = process.env.ZD_URL || "http://127.0.0.1:8765/";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext();
  await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());   // the takeoff's libraries are not needed to see where a page lands
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  const land = async u => { await page.goto(u, {waitUntil: "domcontentloaded"}); await page.waitForURL(/takeoff\//, {timeout: 5000}).catch(() => {}); return page.url(); };
  console.log("site address");
  ok(/\/takeoff\/$/.test(await land(BASE)), "the site's address opens takeoff/ (" + page.url() + ")");
  ok(await page.title() === "Sajjad QS PDF TAKEOFF Software", "the PDF Takeoff page itself is shown");
  ok(/\/takeoff\/$/.test(await land(BASE + "index.html")), "index.html opens takeoff/ too");
  ok(/\/takeoff\/\?a=1#x$/.test(await land(BASE + "?a=1#x")), "a query and hash are carried over");
  await page.goto(BASE + "takeoff/", {waitUntil: "domcontentloaded"}); await page.waitForTimeout(300);
  ok(/\/takeoff\/$/.test(page.url()), "takeoff/ stays put (no redirect loop)");
  ok(await page.$('#start a[href="../dashboards/"]') !== null, "the takeoff's start screen links to all dashboards");
  console.log("dashboards keep their addresses");
  for (const p of ["dashboards/", "zameen-developments/", "drawing-tracker/", "takeoff/"]) {
    const r = await page.request.get(BASE + p); ok(r.status() === 200, p + " → " + r.status());
  }
  await page.goto(BASE + "dashboards/", {waitUntil: "domcontentloaded"});
  const links = await page.$$eval("a.card", a => a.map(x => x.href));
  ok(links.length >= 3, "the dashboards list shows " + links.length + " dashboards");
  for (const h of links) { const r = await page.request.get(h); ok(r.status() === 200, "its link " + h.replace(BASE, "") + " → " + r.status()); }
  await page.goto(BASE + "drawing-tracker/", {waitUntil: "domcontentloaded"});
  const back = await page.$eval("a.back", a => a.href).catch(() => "");
  ok(back === BASE + "dashboards/", "Drawing Tracker's “All dashboards” goes to dashboards/");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})();

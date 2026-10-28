#!/usr/bin/env node
/* Auto-update on every ZD page: a copy older than the published one loads the new one by itself (no Ctrl + F5) when the page is
   opened or its tab shown again, once per version; with "Load new versions by itself" off a bar offers Reload instead.
   tools/stamp_build.py (run by the deploy) is checked on a copy of the pages; in the browser the page's build and version.json
   are answered by the test, as the deploy would write them.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_autoupdate.js                     (ZD_URL for another address)
*/
const {chromium} = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), {execFileSync} = require("child_process");
const BASE = process.env.ZD_URL || "http://127.0.0.1:8765/", ROOT = path.join(__dirname, "..");
const PAGES = [["dashboards/", "dashboards/index.html"], ["drawing-tracker/", "drawing-tracker/index.html"], ["zameen-developments/?app=all", "zameen-developments/index.html"]];
const OLD = "aaaaaaaaaaaa", NEW = "bbbbbbbbbbbb", NEWER = "cccccccccccc";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(250); } return false; };   // a slow page (Zameen: 7 MB) given time

(async () => {
  console.log("tools/stamp_build.py");
  { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zd-stamp-")), want = {};
    for (const p of PAGES.map(x => x[1]).concat(["takeoff/index.html", "index.html"])) { fs.mkdirSync(path.dirname(path.join(tmp, p)), {recursive: true}); fs.copyFileSync(path.join(ROOT, p), path.join(tmp, p)); }
    for (const p of PAGES.map(x => x[1]).concat(["takeoff/index.html"])) want[p] = crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, p))).digest("hex").slice(0, 12);
    execFileSync(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), [path.join(ROOT, "tools/stamp_build.py"), tmp]);
    const v = JSON.parse(fs.readFileSync(path.join(tmp, "version.json"), "utf8"));
    ok(JSON.stringify(v) === JSON.stringify(Object.fromEntries(Object.keys(want).sort().map(k => [k, want[k]]))), "version.json lists each page with the hash of its own file: " + JSON.stringify(v));
    ok(Object.keys(want).every(p => { const t = fs.readFileSync(path.join(tmp, p), "utf8"); return t.includes('data-zd-build="' + want[p] + '"') && !t.includes("__ZD_BUILD__"); }), "each page carries its own hash in <html data-zd-build>");
    ok(!("index.html" in v), "a page without the mark (the site's redirect) is left as it is");
    fs.rmSync(tmp, {recursive: true, force: true}); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1280, height: 860}}); await require("./zd_unlock")(ctx);
  let pub = {};   // what version.json says is published
  await ctx.route(/\/version\.json\?/, r => r.fulfill({contentType: "application/json", body: JSON.stringify(pub)}));
  const stampAs = (re, build) => ctx.route(re, async r => { const res = await r.fetch(); r.fulfill({response: res, body: (await res.text()).replace('data-zd-build="__ZD_BUILD__"', 'data-zd-build="' + build + '"')}); });
  for (const [u, p] of PAGES) await stampAs(new RegExp(u.replace(/[?]/g, "\\?").replace(/\//g, "\\/") + "$"), OLD);   // the copy in the browser is the old one
  const loads = page => { const n = {v: 0}; page.on("request", q => { if (q.resourceType() === "document" && q.frame() === page.mainFrame()) n.v++; }); return n; };   // the page's own requests: a reload before the first load ended counts too
  const bar = page => page.evaluate(() => { const b = document.getElementById("zd-upd"); return b ? {v: b.getAttribute("data-v"), auto: b.querySelector("input").checked} : null; }).catch(() => null);   // mid-reload: not yet

  for (const [u, p] of PAGES) {
    console.log(u);
    pub = {[p]: OLD};
    { const page = await ctx.newPage(), n = loads(page); await page.goto(BASE + u, {waitUntil: "load"}); await wait(1500);
      ok(n.v === 1 && !(await bar(page)), "the copy is the published one: no reload, no bar");
      pub = {[p]: NEW}; await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await until(() => n.v === 2);
      ok(n.v === 2, "a new version out while the tab was away: coming back to it loads the new one (loads " + n.v + ")");
      await until(async () => (await bar(page) || {}).v === NEW); await wait(1000); ok(n.v === 2 && (await bar(page) || {}).v === NEW, "still old after that reload: the bar, not a loop");
      await page.close(); }
    pub = {[p]: NEWER};
    { const page = await ctx.newPage(), n = loads(page); await page.goto(BASE + u, {waitUntil: "load"}); await until(() => n.v === 2); await wait(1000);
      ok(n.v === 2, "opened with an old copy: the new version loads at once (loads " + n.v + ")");
      await page.evaluate(() => localStorage.setItem("zd-auto-update", "0")); await page.close(); }
    pub = {[p]: "dddddddddddd"};
    { const page = await ctx.newPage(), n = loads(page); await page.goto(BASE + u, {waitUntil: "load"}); await until(() => bar(page)); await wait(500);
      const b = await bar(page);
      ok(n.v === 1 && b && b.v === "dddddddddddd" && !b.auto, "Load new versions by itself off: no reload, the bar offers Reload");
      await page.check("#zd-upd input"); ok(await page.evaluate(() => localStorage.getItem("zd-auto-update")) === null, "ticking it in the bar turns it back on (for every ZD page)");
      await Promise.all([page.waitForEvent("load"), page.click('#zd-upd [data-a="go"]')]); ok(true, "Reload in the bar reloads the page");
      await page.close(); }
  }

  console.log("zameen-developments/ start screen and dashboards/ list: the setting");
  { const page = await ctx.newPage(); await page.goto(BASE + "dashboards/", {waitUntil: "load"}); await wait(500);
    ok(await page.isChecked("#zdAutoUpd"), "dashboards list: on by default");
    await page.uncheck("#zdAutoUpd"); ok(await page.evaluate(() => localStorage.getItem("zd-auto-update")) === "0", "dashboards list: unticked, it is off");
    await page.close(); }
  { const c2 = await browser.newContext(); const page = await c2.newPage(); await page.goto(BASE + "zameen-developments/", {waitUntil: "load"}); await wait(800);
    ok(await page.isChecked(".zd-start-upd input"), "Zameen Developments start screen: Load new versions by itself, on by default");
    await page.uncheck(".zd-start-upd input"); ok(await page.evaluate(() => localStorage.getItem("zd-auto-update")) === "0", "start screen: unticked, it is off");
    await page.check(".zd-start-upd input"); ok(await page.evaluate(() => localStorage.getItem("zd-auto-update")) === null, "start screen: ticked again, it is on");
    await c2.close(); }

  console.log("takeoff/");
  { const c3 = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(c3);
    let checkBuild = OLD;
    await c3.route(/\/takeoff\/$/, async r => { const res = await r.fetch(); r.fulfill({response: res, body: (await res.text()).replace('data-zd-build="__ZD_BUILD__"', 'data-zd-build="' + OLD + '"')}); });
    await c3.route(/\/takeoff\/index\.html\?check=/, async r => { const res = await r.fetch(); r.fulfill({response: res, body: (await res.text()).replace('data-zd-build="__ZD_BUILD__"', 'data-zd-build="' + checkBuild + '"')}); });
    const page = await c3.newPage(), n = loads(page); const T = f => page.evaluate(f);
    await page.goto(BASE + "takeoff/", {waitUntil: "load"}); await page.waitForFunction(() => window.zdTakeoff, null, {timeout: 20000}); await wait(2500);
    ok(n.v === 1 && !(await T(() => !!document.getElementById("verBar"))), "the page is the published one: no reload, no bar");
    ok(await T(() => zdTakeoff.autoUpd()), "Settings › General: Load a new version by itself, on by default");
    checkBuild = NEW;
    ok(await T(() => zdTakeoff.verCheck(true)) === NEW && await T(() => !!document.getElementById("verBar")), "the page changed (same takeoff.js) while you are on it: the bar, no reload");
    await Promise.all([page.waitForEvent("load"), T(() => zdTakeoff.verCheck(false, true))]);
    ok(n.v === 2, "coming back to the tab: saved and reloaded by itself");
    await page.waitForFunction(() => window.zdTakeoff, null, {timeout: 20000}); await wait(2500);
    ok(n.v === 2 && await T(() => !!document.getElementById("verBar")), "still old after that reload: the bar, not a loop");
    await T(() => localStorage.setItem("zd-auto-update", "0")); checkBuild = NEWER;
    ok(await T(() => zdTakeoff.verCheck(false, true)) === NEWER && n.v === 2, "off: a new version shows the bar only");
    await c3.close(); }

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

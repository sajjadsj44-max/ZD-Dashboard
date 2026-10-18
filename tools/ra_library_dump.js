#!/usr/bin/env node
/* Write the Rate Analysis library a fresh browser starts with: every rate line and item as published.

     python3 -m http.server 8765 &                                   # from the repo root
     node tools/ra_library_dump.js out.json                          # the page as it is
     node tools/ra_library_dump.js out.json --without raRefreshData  # as it was before that data block

   The page is opened with an empty library, so seed, MEP, civil, master and GRN-latest blocks are all applied
   exactly as a new user gets them. --without takes a data block out of the page first (repeatable): that gives
   the values a block's prevRates must hold, i.e. what a library saved before the block was published holds.
   Writes {rates: [...], items: [{id, code, cat, sub, desc, unit, rate, M/L/P refs}]}. */
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const fs = require("fs");
const URL = process.env.QE_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
const out = process.argv[2];
const drop = [];
process.argv.forEach((a, i) => { if (a === "--without") drop.push(process.argv[i + 1]); });
if (!out) { console.error("usage: node tools/ra_library_dump.js out.json [--without blockId ...]"); process.exit(2); }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext(); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g|cdnjs/, r => r.abort());
  if (drop.length) await ctx.route(/zameen-developments\/(index\.html)?(\?.*)?$/, async r => {
    const res = await r.fetch(); let body = await res.text();
    for (const id of drop) {
      const re = new RegExp('<script type="application/json" id="' + id + '">[\\s\\S]*?</script>');
      if (!re.test(body)) throw new Error("block " + id + " not in the page");
      body = body.replace(re, "");
    }
    await r.fulfill({response: res, body});
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "domcontentloaded"});
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => typeof RA !== "undefined" && RA && RA.rates && RA.rates.length > 0, null, {timeout: 60000});
  const d = await page.evaluate(() => ({
    rates: RA.rates,
    items: RA.items.map(it => ({id: it.id, code: it.code, cat: it.cat, sub: it.sub, desc: it.desc, unit: it.unit,
      rate: raCalc(it).rate, rows: [].concat((it.M || []).map(r => ["M", r.ref, r.qty]), (it.L || []).map(r => ["L", r.ref, r.qty]),
                                              (it.P || []).map(r => ["P", r.ref, r.qty]))}))
  }));
  fs.writeFileSync(out, JSON.stringify(d));
  console.log(`${d.rates.length} rate lines, ${d.items.length} items${drop.length ? " (without " + drop.join(", ") + ")" : ""}` +
              (errors.length ? "; page errors: " + errors.join(" | ") : ""));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

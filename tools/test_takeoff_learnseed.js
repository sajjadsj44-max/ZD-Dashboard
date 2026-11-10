#!/usr/bin/env node
/* Browser test: the learning agent starts from the reference method (takeoff/learn-seed.json, made by tools/learn_seed.py from the
   Zameen Phoenix finishing BOQ): its skills are there on a new browser, Learned skills lists it, and unticking it takes them away.
     python -m http.server 8765 --bind 127.0.0.1 ; TK_LIBS=/path/with/node_modules node tools/test_takeoff_learnseed.js  (TK_URL for another port) */
const path = require("path"), pw = require("playwright");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(800);
  const T = (f, a) => page.evaluate(f, a);
  await T(() => zdTakeoff.learnSeedLoad()); await page.waitForTimeout(300);
  const K = await T(() => { const K = zdTakeoff.learnSkills(); return {np: K.np, rooms: Object.fromEntries(Object.entries(K.rooms).map(([t, r]) => [t, {n: r.n, items: r.items.map(i => [i.name, i.how, i.h, i.some])}]))}; });
  const bath = K.rooms.BATH, bed = K.rooms["BED ROOM"], has = (r, n) => r && r.items.some(i => i[0] === n && !i[3]);
  ok(K.np === 1 && bath && bath.n === 223, "a new browser starts from one reference project: 223 baths (the BOQ's own count)");
  ok(has(bath, "Bath wall tiles") && has(bath, "Bath floor tile 24x24 (matte)") && has(bath, "WC with muslim shower"), "a bath gets wall tiles (H 8.5), floor tile and a WC counted in it");
  ok(bath && bath.items.find(i => i[0] === "Bath wall tiles")[2] === 8.5, "…the bath wall tile height is the reference's 8.5 ft");
  ok(has(bed, "Skirting 4in") && has(bed, "Wall paint (emulsion)") && has(bed, "POP false ceiling") && !has(bed, "Bath wall tiles"), "a bed room gets skirting, wall paint (H 10) and POP ceiling, no bath tiles");
  ok(await T(() => zdTakeoff.learnSkills().rooms.BALCONY && !zdTakeoff.learnSkills().rooms.BALCONY.items.some(i => /Wall paint/.test(i[0] || i.name))), "a balcony gets no wall paint");
  ok(await T(() => zdTakeoff.roomType("BATH/PWD 5'-0\"x8'-11\"") === "BATH" && zdTakeoff.roomType("PWD") === "BATH"), "PWD reads as a bath");
  const before = await T(() => zdTakeoff.learnStore().seed && zdTakeoff.learnStore().seed.at);
  ok(await T(() => zdTakeoff.learnSeedLoad()) === false && before, "the same version is not read twice");
  await T(() => { const st = zdTakeoff.learnStore(); st.off = ["seed"]; localStorage.setItem("zdTakeoffLearn", JSON.stringify(st)); });
  ok(await T(() => Object.keys(zdTakeoff.learnSkills().rooms).length === 0), "unticked, the reference gives nothing: only your own takeoffs count");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

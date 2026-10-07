#!/usr/bin/env node
/* The ZD Dashboard lock on every page: the password is asked every time a page is opened and never saved — no unlock remembered in
   the tab or the browser, and no browser password field (so no browser or password manager offers to save or fill it).

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_lock.js                           (ZD_URL for another address; TK_LIBS as for test_takeoff.js, else the CDN)

   PDF Takeoff's locked PDFs too: tools/pdf_fixtures/locked.pdf opens with the password open-me.
*/
const {chromium} = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const BASE = process.env.ZD_URL || "http://127.0.0.1:8765/", LIBS = process.env.TK_LIBS || "", PAGES = ["index.html", "takeoff/", "drawing-tracker/", "zameen-developments/"];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const LOCKISH = /lock|pass|pw|unlock|secret/i;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1280, height: 860}});
  for (const p of PAGES) {
    console.log(p);
    const page = await ctx.newPage(), errs = [];
    page.on("pageerror", e => errs.push(String(e)));
    await page.goto(BASE + p, {waitUntil: "load"});
    const f = await page.evaluate(() => {
      const i = document.getElementById("zd-lock-input"); if (!i) return null;
      return {type: i.type, ac: i.getAttribute("autocomplete"), inForm: !!i.closest("form"), pw: document.querySelectorAll("input[type=password]").length,
        focused: document.activeElement === i, dots: getComputedStyle(i).webkitTextSecurity || "", locked: document.body.classList.contains("zd-locked"),
        inert: [...document.body.children].filter(e => e.id !== "zd-lock" && e.tagName !== "SCRIPT" && e.tagName !== "STYLE").every(e => e.inert)};
    });
    ok(f && f.locked, "asks for the password when the page opens");
    ok(f && f.type === "text" && !f.inForm && f.pw === 0 && f.ac === "off", "no browser password field and no form — nothing for a browser to offer to save or fill");
    ok(f && f.dots === "disc", "what is typed is drawn as dots");
    ok(f && f.focused, "the password field has the focus");
    ok(f && f.inert, "the page behind can't be reached (mouse, keyboard, screen reader)");
    await page.fill("#zd-lock-input", "999"); await page.press("#zd-lock-input", "Enter");
    ok(await page.isVisible("#zd-lock") && await page.isVisible(".zd-lock-error"), "a wrong password is refused");
    ok(await page.inputValue("#zd-lock-input") === "", "the field is emptied after each try");
    await page.fill("#zd-lock-input", "123"); await page.click("#zd-lock button");
    ok(!(await page.$("#zd-lock")) && !(await page.evaluate(() => document.body.classList.contains("zd-locked") || [...document.body.children].some(e => e.inert))), "the right password unlocks the page");
    const kept = await page.evaluate(re => { const r = new RegExp(re, "i"); return [...Object.keys(sessionStorage), ...Object.keys(localStorage), document.cookie].filter(k => k && r.test(k)); }, LOCKISH.source);
    ok(kept.length === 0, "nothing remembered in session storage, local storage or cookies" + (kept.length ? ": " + kept.join(", ") : ""));
    if (p === "takeoff/") {
      const k = await page.evaluate(() => { const i = document.getElementById("aiKey"); return {type: i.type, dots: getComputedStyle(i).webkitTextSecurity, pw: document.querySelectorAll("input[type=password]").length}; });
      ok(k.type === "text" && k.dots === "disc" && k.pw === 0, "the API key box is not a browser password field either (drawn as dots)");
    }
    await page.reload({waitUntil: "load"});
    ok(!!(await page.$("#zd-lock")), "asked again after a reload");
    ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
    await page.close();
  }

  // a browser that cannot draw a field as dots: dots are typed, the characters kept aside — typing, deleting and fixing still unlock
  console.log("a browser without dotted text fields");
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { const s = CSS.supports.bind(CSS); CSS.supports = (a, b) => /text-security/.test(String(a)) ? false : s(a, b); });
  const page = await ctx2.newPage();
  await page.goto(BASE + "index.html", {waitUntil: "load"});
  await page.click("#zd-lock-input"); await page.keyboard.type("1245");
  ok(await page.inputValue("#zd-lock-input") === "••••", "the field shows dots, not the characters");
  await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.type("3");
  ok(await page.inputValue("#zd-lock-input") === "•••", "deleting and typing again keeps the right count");
  await page.keyboard.press("Home"); await page.keyboard.press("Delete"); await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  ok(!(await page.$("#zd-lock")), "the password typed behind the dots unlocks (123)");
  await page.reload({waitUntil: "load"});
  await page.click("#zd-lock-input"); await page.keyboard.type("12"); await page.keyboard.press("Enter");
  ok(await page.isVisible(".zd-lock-error"), "a wrong one is still refused");

  // PDF Takeoff: a PDF locked with an open password — asked when it is opened, never kept (in the browser or an exported project)
  console.log("a PDF locked with an open password (PDF Takeoff)");
  const ctx3 = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx3);
  if (LIBS) await ctx3.route(/cdn\.jsdelivr\.net/, r => {   // the PDF engines from TK_LIBS when given (else from the CDN)
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    return r.continue();
  });
  const tp = await ctx3.newPage(), terrs = [], dlgOn = () => tp.evaluate(() => document.getElementById("dlgBack").classList.contains("on"));
  tp.on("pageerror", e => terrs.push(String(e)));
  await tp.goto(BASE + "takeoff/", {waitUntil: "load"}); await tp.waitForTimeout(600);
  await tp.click("#bNewProj"); await tp.fill("#dlgName", "Locked PDF"); await tp.click("#dlgOk"); await tp.waitForTimeout(400);
  await tp.setInputFiles("#fileIn", path.join(__dirname, "pdf_fixtures", "locked.pdf"));   // open password: open-me
  await tp.waitForSelector("#dlgPw", {timeout: 20000});
  const q = await tp.evaluate(() => { const i = document.getElementById("dlgPw"); return {type: i.type, dots: getComputedStyle(i).webkitTextSecurity, ac: i.getAttribute("autocomplete"), pw: document.querySelectorAll("input[type=password]").length, note: document.getElementById("dlgB").textContent}; });
  ok(q.type === "text" && q.dots === "disc" && q.ac === "off" && q.pw === 0, "its password is asked in a field no browser offers to save");
  ok(/Not saved/.test(q.note), "the question says the password is not saved");
  await tp.fill("#dlgPw", "wrong"); await tp.click("#dlgOk");
  ok(await tp.waitForFunction(() => /not right/.test(document.getElementById("dlgB").textContent), null, {timeout: 10000}).then(() => true, () => false), "a wrong password is asked again");
  await tp.fill("#dlgPw", "open-me"); await tp.click("#dlgOk");
  ok(await tp.waitForFunction(() => { const Z = zdTakeoff; return Z.S.page && Z.P.proj.files.length === 1 && Z.S.fileId === Z.P.proj.files[0].id; }, null, {timeout: 20000}).then(() => true, () => false), "the right one opens the drawing");
  const keys = await tp.evaluate(() => new Promise(r => { const o = indexedDB.open("zdTakeoff"); o.onsuccess = () => { const t = o.result.transaction("pdfs").objectStore("pdfs").get(zdTakeoff.P.proj.files[0].id); t.onsuccess = () => r(Object.keys(t.result || {})); }; }));
  ok(keys.length && !keys.includes("pw"), "the password is not stored with the PDF (" + keys.join(", ") + ")");
  const [dl] = await Promise.all([tp.waitForEvent("download", {timeout: 30000}), tp.evaluate(() => document.getElementById("bExport").click()).then(async () => { await tp.waitForTimeout(300); await tp.click("#exBnd"); })]);
  const bf = path.join(os.tmpdir(), "zd_lock_" + dl.suggestedFilename()); await dl.saveAs(bf);
  const B = fs.readFileSync(bf), ML = "ZDTAKEOFF-BUNDLE-1\n".length, H = JSON.parse(B.slice(ML + 4, ML + 4 + B.readUInt32BE(ML)).toString("utf8"));
  ok(H.pdfs.length === 1 && !("pw" in H.pdfs[0]) && !B.includes("open-me"), "an exported project carries no password");
  const rec = (fn, arg) => tp.evaluate(([fn, arg]) => new Promise(r => { const o = indexedDB.open("zdTakeoff"); o.onsuccess = () => { const st = o.result.transaction("pdfs", "readwrite").objectStore("pdfs"), id = zdTakeoff.P.proj.files[0].id, g = st.get(id);
    g.onsuccess = () => { const v = g.result; if (fn === "plant") { v.pw = arg; st.put(v, id).onsuccess = () => r(true); } else r(Object.keys(v)); }; }; }), [fn, arg]);
  await rec("plant", "open-me");   // as an earlier version kept it
  await tp.reload({waitUntil: "load"});
  ok(await tp.waitForSelector("#dlgPw", {timeout: 20000}).then(() => true, () => false), "after a reload the PDF asks for its password again (a password an earlier version kept is not used)");
  ok(!(await rec("keys")).includes("pw"), "…and that kept password is deleted");
  await tp.click("#dlgCancel"); await tp.waitForTimeout(500);
  await tp.click("#tPages"); await tp.waitForTimeout(2000);
  const th = await tp.evaluate(() => (zdTakeoff.S.thumbs || {})[zdTakeoff.P.proj.files[0].id + ":1"]);
  ok(!(await dlgOn()) && th === "x", "turned down: the page thumbnails don't ask again (left blank)");
  await tp.evaluate(() => { zdTakeoff.gotoPage(zdTakeoff.P.proj.files[0].id, 1); });
  ok(await tp.waitForSelector("#dlgPw", {timeout: 10000}).then(() => true, () => false), "opening one of its pages asks again");
  await tp.fill("#dlgPw", "open-me"); await tp.click("#dlgOk");
  ok(await tp.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.fileId === zdTakeoff.P.proj.files[0].id, null, {timeout: 20000}).then(() => true, () => false), "…and opens it");
  ok(terrs.length === 0, "no page errors" + (terrs.length ? ": " + terrs[0] : ""));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

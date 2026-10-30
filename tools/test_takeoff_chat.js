#!/usr/bin/env node
/* PDF Takeoff's Feedback chat (friends, takeoff/?team) and Inbox (the owner), against the real server script
   tools/feedback/Code.gs run here in Node with stand-ins for Google's Sheet, cache, fetch and digest services.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_chat.js                   (TK_URL for another address)
*/
const {chromium} = require("playwright");
const crypto = require("crypto"), fs = require("fs"), path = require("path"), vm = require("vm");
const BASE = (process.env.TK_URL || "http://127.0.0.1:8765/takeoff/").replace(/[^/]*$/, "");
const CHAT = "https://chat.test/macros/s/x/exec", INBOX_PW = "test-inbox-pw";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const pb = (pw, salt) => crypto.pbkdf2Sync(pw, salt, 150000, 32, "sha256").toString("hex");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const entry = (u, pw) => { const s = crypto.randomBytes(16).toString("hex"); return {u, s, h: pb(pw, s), c: sha(pb(pw, s + ":chat")), iter: 150000, at: "2026-10-30"}; };
const LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9"), entry("zara", "zz99zz")]});

/* the Apps Script server, with a sheet kept in memory */
function server(){
  const cells = [];   // rows of the "Messages" tab
  const sheet = {appendRow: r => cells.push(r.slice()), setFrozenRows(){}, getLastRow: () => cells.length,
    getRange: (r, c, nr, nc) => ({getValues: () => cells.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)), setValue: v => { cells[r - 1][c - 1] = v; }})};
  let made = false;
  const cache = new Map(), ctx = {
    Utilities: {DigestAlgorithm: {SHA_256: 1}, Charset: {UTF_8: 1}, getUuid: () => crypto.randomUUID(),
      computeDigest: (a, s) => [...new Int8Array(crypto.createHash("sha256").update(String(s), "utf8").digest())]},
    CacheService: {getScriptCache: () => ({get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v)})},
    UrlFetchApp: {fetch: () => ({getContentText: () => LIST})},
    SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: () => made ? sheet : null, insertSheet: () => { made = true; return sheet; }})},
    ContentService: {MimeType: {JSON: 1}, createTextOutput: s => ({s, setMimeType(){ return this; }})},
    LockService: {getScriptLock: () => ({waitLock(){}, releaseLock(){}})}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "feedback", "Code.gs"), "utf8"), ctx);
  ctx.OWNER_HASH = sha(INBOX_PW);
  return {post: body => ctx.doPost({postData: {contents: body}}).s, cells};
}

(async () => {
  const S = server();
  const browser = await chromium.launch();
  let chatJson = JSON.stringify({url: CHAT});
  const mk = async () => {
    const ctx = await browser.newContext({viewport: {width: 1500, height: 900}});
    await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) {} });
    await ctx.route(/\/takeoff\/users\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: LIST}));
    await ctx.route(/\/takeoff\/chat\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: chatJson}));
    await ctx.route(CHAT, r => r.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: S.post(r.request().postData())}));
    return ctx;
  };
  const signIn = async (page, u, pw) => {
    await page.goto(BASE + "?team", {waitUntil: "load"});
    await page.fill("#zd-lock-user", u); await page.fill("#zd-lock-input", pw); await page.press("#zd-lock-input", "Enter");
    await page.waitForSelector("#zd-lock", {state: "detached", timeout: 15000});
    await page.evaluate(() => document.getElementById("start").classList.remove("on"));
  };

  console.log("a friend sends feedback");
  const fctx = await mk(), f = await fctx.newPage(), errs = [];
  f.on("pageerror", e => errs.push(String(e)));
  await signIn(f, "bilal", "takeoff9");
  await f.waitForFunction(() => /Feedback/.test((document.getElementById("bChat") || {}).textContent || ""), null, {timeout: 5000}).catch(() => {});
  ok(/Feedback/.test(await f.textContent("#bChat")), "the team view has a Feedback button");
  ok(await f.evaluate(() => !!window.zdChat && window.zdChat.u === "bilal" && !Object.keys(window).includes("zdChat") && !Object.keys(localStorage).some(k => /chat/i.test(k))), "the chat key is kept only in the page (not in the browser's storage)");
  await f.click("#bChat"); await f.waitForSelector("#chIn", {timeout: 8000});
  ok(/No messages yet/.test(await f.textContent("#chW")), "an empty conversation");
  await f.fill("#chIn", "The Trim tool is great.\nCould Offset remember its distance?"); await f.press("#chIn", "Enter");
  await f.waitForFunction(() => document.querySelectorAll("#chL .chm.me").length === 1, null, {timeout: 8000}).catch(() => {});
  ok(await f.evaluate(() => document.querySelectorAll("#chL .chm.me").length) === 1 && await f.inputValue("#chIn") === "", "Enter sends: the message shows on the right, the box is emptied");
  ok(S.cells.length === 2 && S.cells[0][0] === "id" && S.cells[1][2] === "bilal" && S.cells[1][3] === "bilal" && /Offset/.test(S.cells[1][4]), "the server keeps it in bilal's conversation");
  ok(JSON.parse(S.post(JSON.stringify({a: "send", u: "bilal", k: "forged", text: "x"}))).error === "auth" && JSON.parse(S.post(JSON.stringify({a: "get", u: "zara", k: await f.evaluate(() => zdChat.k)}))).error === "auth", "the server refuses a wrong key, and one user's key for another");
  ok(JSON.parse(S.post(JSON.stringify({a: "inbox", ok: "sa"}))).error === "auth", "…and the Inbox without its password");

  console.log("the owner's Inbox");
  const octx = await mk(), o = await octx.newPage(), e2 = [];
  o.on("pageerror", e => e2.push(String(e)));
  await o.goto(BASE, {waitUntil: "load"});
  await o.fill("#zd-lock-input", "sa"); await o.press("#zd-lock-input", "Enter"); await o.waitForSelector("#zd-lock", {state: "detached"});
  await o.evaluate(() => document.getElementById("start").classList.remove("on"));
  ok(/Inbox/.test(await o.textContent("#bChat")), "the owner's top bar has an Inbox button");
  await o.click("#bChat"); await o.waitForSelector("#chPw", {timeout: 8000});
  ok(await o.evaluate(() => getComputedStyle(document.getElementById("chPw")).webkitTextSecurity === "disc" && document.getElementById("chPw").type === "text"), "it asks the inbox password (dots, not a browser password field)");
  await o.fill("#chPw", "wrong"); await o.press("#chPw", "Enter");
  await o.waitForFunction(() => /Wrong inbox password/.test(document.getElementById("chW").textContent), null, {timeout: 8000}).catch(() => {});
  ok(/Wrong inbox password/.test(await o.textContent("#chW")), "a wrong password is refused");
  await o.fill("#chPw", INBOX_PW); await o.press("#chPw", "Enter");
  await o.waitForSelector('[data-chu="bilal"]', {timeout: 8000}).catch(() => {});
  ok(/bilal/.test(await o.textContent("#chTh").catch(() => "")) && (await o.textContent('[data-chu="bilal"] .n').catch(() => "")) === "1", "bilal's conversation is listed with 1 unread");
  await o.click('[data-chu="bilal"]'); await o.waitForSelector("#chL .chm", {timeout: 8000});
  ok(/Offset remember/.test(await o.textContent("#chL")), "the message opens");
  ok(S.cells[1][5] === true, "…and is marked as read");
  await o.fill("#chIn", "Thanks! Coming in the next update."); await o.click("#chSend");
  await o.waitForFunction(() => document.querySelectorAll("#chL .chm.me").length === 1, null, {timeout: 8000}).catch(() => {});
  ok(S.cells.length === 3 && S.cells[2][3] === "owner" && S.cells[2][2] === "bilal", "the reply goes to bilal's conversation");
  ok(await o.evaluate(() => !Object.keys(localStorage).some(k => /inbox|chat/i.test(k))), "the inbox password is not kept in the browser");
  ok(e2.length === 0, "no page errors (owner)" + (e2.length ? ": " + e2[0] : ""));

  console.log("the friend sees the reply");
  await f.click("#chX"); await f.evaluate(() => { const b = document.getElementById("bChat"); b.click(); });
  await f.waitForFunction(() => /Coming in the next update/.test(document.getElementById("chL") ? document.getElementById("chL").textContent : ""), null, {timeout: 8000}).catch(() => {});
  ok(/Coming in the next update/.test(await f.textContent("#chL")), "the reply shows on the left");
  ok(await f.evaluate(() => /seen/.test(document.querySelector("#chL .chm.me small").textContent)), "and the friend's own message shows as seen");
  ok(S.cells[2][5] === true, "the reply is marked as read once the friend has seen it");
  ok(errs.length === 0, "no page errors (friend)" + (errs.length ? ": " + errs[0] : ""));

  console.log("before the chat is set up");
  chatJson = JSON.stringify({url: ""});
  const g = await (await mk()).newPage();
  await signIn(g, "zara", "zz99zz");
  await g.click("#bChat"); await g.waitForSelector("#chW a[href^='https://wa.me/']", {timeout: 8000}).catch(() => {});
  ok(!!(await g.$("#chW a[href^='https://wa.me/']")), "Feedback offers WhatsApp instead");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

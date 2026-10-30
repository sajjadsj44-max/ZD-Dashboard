#!/usr/bin/env node
/* PDF Takeoff's Feedback chat (friends, takeoff/?team) and Inbox (the owner), against a stand-in for the relay (ntfy.sh: publish
   by POST, read by GET …/json?poll=1&since=all) and for the archive on the chat-archive branch, with a chat.json made here
   the same way as the real one (an RSA key, its private half locked with the Inbox password).

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_chat.js                   (TK_URL for another address)
*/
const {chromium} = require("playwright");
const crypto = require("crypto"), C = crypto.webcrypto;
const BASE = (process.env.TK_URL || "http://127.0.0.1:8765/takeoff/").replace(/[^/]*$/, "");
const RELAY = "https://relay.test", TOPIC = "zd-takeoff-test", ARCH = "https://raw.test/chat-archive/takeoff-chat.jsonl", INBOX_PW = "test-inbox-pw";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const pb = (pw, salt) => crypto.pbkdf2Sync(pw, salt, 150000, 32, "sha256").toString("hex");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const entry = (u, pw) => { const s = crypto.randomBytes(16).toString("hex"); return {u, s, h: pb(pw, s), c: sha(pb(pw, s + ":chat")), iter: 150000, at: "2026-10-30"}; };
const LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9"), entry("zara", "zz99zz")]});
const b64 = b => Buffer.from(b).toString("base64");
async function chatJsonFor(pw){
  const kp = await C.subtle.generateKey({name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["encrypt", "decrypt"]);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 1000;
  const base = await C.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  const w = await C.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt, iterations: iter}, base, {name: "AES-GCM", length: 256}, false, ["encrypt"]);
  const key = await C.subtle.encrypt({name: "AES-GCM", iv}, w, await C.subtle.exportKey("pkcs8", kp.privateKey));
  return JSON.stringify({relay: RELAY, topic: TOPIC, archive: ARCH, owner: {pub: b64(await C.subtle.exportKey("spki", kp.publicKey)), salt: b64(salt), iv: b64(iv), iter, key: b64(key)}});
}

/* the relay: events in memory; later they are moved to the archive, as the relay forgetting them after 12 hours and the
   workflow having copied them would */
const R = {ev: [], arch: [], n: 0, t: 1793300000};
const relayEv = () => R.ev.map(e => { try { return JSON.parse(e.message); } catch (x) { return {}; } });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  let chatJson = await chatJsonFor(INBOX_PW);
  const mk = async () => {
    const ctx = await browser.newContext({viewport: {width: 1500, height: 900}});
    await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) {} });
    await ctx.route(/\/takeoff\/users\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: LIST}));
    await ctx.route(/\/takeoff\/chat\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: chatJson}));
    await ctx.route(u => u.href.startsWith(RELAY + "/" + TOPIC), r => {
      const q = r.request(), cors = {"access-control-allow-origin": "*"};
      if (q.method() === "POST") {
        const e = {id: "e" + (++R.n), time: ++R.t, event: "message", topic: TOPIC, message: q.postData(), title: new URL(q.url()).searchParams.get("title") || undefined};
        R.ev.push(e); return r.fulfill({status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(e)});
      }
      return r.fulfill({status: 200, contentType: "application/x-ndjson", headers: cors, body: R.ev.map(e => JSON.stringify(e) + "\n").join("")});
    });
    await ctx.route(u => u.href.startsWith(ARCH), r => r.fulfill(R.arch.length ? {status: 200, contentType: "text/plain", headers: {"access-control-allow-origin": "*"}, body: R.arch.map(e => JSON.stringify(e) + "\n").join("")} : {status: 404, headers: {"access-control-allow-origin": "*"}, body: "404: Not Found"}));
    return ctx;
  };
  const signIn = async (page, u, pw) => {
    await page.goto(BASE + "?team", {waitUntil: "load"});
    await page.fill("#zd-lock-user", u); await page.fill("#zd-lock-input", pw); await page.press("#zd-lock-input", "Enter");
    await page.waitForSelector("#zd-lock", {state: "detached", timeout: 15000});
    await page.evaluate(() => document.getElementById("start").classList.remove("on"));
  };
  const openInbox = async page => {
    await page.goto(BASE, {waitUntil: "load"});
    await page.fill("#zd-lock-input", "sa"); await page.press("#zd-lock-input", "Enter"); await page.waitForSelector("#zd-lock", {state: "detached"});
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
  await f.waitForFunction(() => /No messages yet/.test(document.getElementById("chW").textContent), null, {timeout: 8000}).catch(() => {});
  ok(/No messages yet/.test(await f.textContent("#chW")), "an empty conversation");
  await f.fill("#chIn", "The Trim tool is great.\nCould Offset remember its distance?"); await f.press("#chIn", "Enter");
  await f.waitForFunction(() => document.querySelectorAll("#chL .chm.me").length === 1, null, {timeout: 8000}).catch(() => {});
  ok(await f.evaluate(() => document.querySelectorAll("#chL .chm.me").length) === 1 && await f.inputValue("#chIn") === "", "Enter sends: the message shows on the right, the box is emptied");
  const E1 = relayEv();
  ok(E1.length === 2 && E1[0].t === "hi" && E1[0].u === "bilal" && E1[1].t === "m" && E1[1].u === "bilal" && E1[1].f === "u", "the relay got bilal's key (sealed for the owner) and the message");
  const k = await f.evaluate(() => zdChat.k);
  ok(!R.ev.some(e => /Trim|Offset/.test(e.message) || e.message.includes(k)), "the relay never sees the text, nor bilal's chat key");
  ok(R.ev[1].title === "Feedback from bilal", "the message carries a title for a phone notification");

  console.log("a stranger on the topic");
  const pubKey = await C.subtle.importKey("spki", Buffer.from(JSON.parse(chatJson).owner.pub, "base64"), {name: "RSA-OAEP", hash: "SHA-256"}, false, ["encrypt"]);
  const forgedK = "f".repeat(64), tk = await C.subtle.importKey("raw", await C.subtle.digest("SHA-256", new TextEncoder().encode(forgedK + ":zd-chat-thread")), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.randomBytes(12), ct = await C.subtle.encrypt({name: "AES-GCM", iv}, tk, new TextEncoder().encode("I am zara, pay me"));
  for (const m of [{v: 1, t: "hi", u: "zara", ko: b64(await C.subtle.encrypt({name: "RSA-OAEP"}, pubKey, new TextEncoder().encode(forgedK)))}, {v: 1, t: "m", u: "zara", f: "u", iv: b64(iv), ct: b64(ct)}, {v: 1, t: "m", u: "bilal", f: "u", iv: b64(iv), ct: b64(ct)}])
    R.ev.push({id: "e" + (++R.n), time: ++R.t, event: "message", message: JSON.stringify(m)});
  R.ev.push({id: "e" + (++R.n), time: ++R.t, event: "message", message: "not json"});

  console.log("the owner's Inbox");
  const octx = await mk(), o = await octx.newPage(), e2 = [];
  o.on("pageerror", e => e2.push(String(e)));
  await openInbox(o);
  ok(/Inbox/.test(await o.textContent("#bChat")), "the owner's top bar has an Inbox button");
  await o.click("#bChat"); await o.waitForSelector("#chPw", {timeout: 8000});
  ok(await o.evaluate(() => getComputedStyle(document.getElementById("chPw")).webkitTextSecurity === "disc" && document.getElementById("chPw").type === "text"), "it asks the inbox password (dots, not a browser password field)");
  await o.fill("#chPw", "wrong"); await o.press("#chPw", "Enter");
  await o.waitForFunction(() => /Wrong inbox password/.test(document.getElementById("chW").textContent), null, {timeout: 8000}).catch(() => {});
  ok(/Wrong inbox password/.test(await o.textContent("#chW")), "a wrong password is refused");
  await o.fill("#chPw", INBOX_PW); await o.press("#chPw", "Enter");
  await o.waitForSelector('[data-chu="bilal"]', {timeout: 8000}).catch(() => {});
  ok(/bilal/.test(await o.textContent("#chTh").catch(() => "")) && (await o.textContent('[data-chu="bilal"] .n').catch(() => "")) === "1", "bilal's conversation is listed with 1 unread");
  ok(!(await o.$('[data-chu="zara"]')) && !/pay me/.test(await o.textContent("#chW")), "a stranger's forged key and messages are left out");
  await o.click('[data-chu="bilal"]'); await o.waitForSelector("#chL .chm", {timeout: 8000});
  ok(/Offset remember/.test(await o.textContent("#chL")) && await o.evaluate(() => document.querySelectorAll("#chL .chm").length) === 1, "the message opens (and only bilal's own)");
  await wait(500);
  ok(relayEv().some(e => e.t === "seen" && e.u === "bilal" && e.by === "o"), "…and is marked as seen");
  await o.fill("#chIn", "Thanks! Coming in the next update."); await o.click("#chSend");
  await o.waitForFunction(() => document.querySelectorAll("#chL .chm.me").length === 1, null, {timeout: 8000}).catch(() => {});
  ok(relayEv().some(e => e.t === "m" && e.u === "bilal" && e.f === "o") && !R.ev.some(e => /next update/.test(e.message)), "the reply goes to bilal's conversation, sealed");
  ok(await o.evaluate(() => !Object.keys(localStorage).some(k => /inbox|chat/i.test(k))), "the inbox password is not kept in the browser");
  ok(e2.length === 0, "no page errors (owner)" + (e2.length ? ": " + e2[0] : ""));

  console.log("the friend sees the reply");
  await f.click("#chX"); await f.evaluate(() => { const b = document.getElementById("bChat"); b.click(); });
  await f.waitForFunction(() => /Coming in the next update/.test(document.getElementById("chL") ? document.getElementById("chL").textContent : ""), null, {timeout: 8000}).catch(() => {});
  ok(/Coming in the next update/.test(await f.textContent("#chL")), "the reply shows on the left");
  ok(await f.evaluate(() => /seen/.test(document.querySelector("#chL .chm.me small").textContent)), "and the friend's own message shows as seen");
  await wait(500);
  ok(relayEv().some(e => e.t === "seen" && e.u === "bilal" && e.by === "u"), "the reply is marked as seen once the friend has seen it");
  ok(errs.length === 0, "no page errors (friend)" + (errs.length ? ": " + errs[0] : ""));

  console.log("after 12 hours: the relay has forgotten, the archive remembers");
  R.arch = R.ev.map(e => ({id: e.id, time: e.time, message: e.message})); R.ev = [];
  const o2 = await (await mk()).newPage();
  await openInbox(o2);
  await o2.click("#bChat"); await o2.waitForSelector("#chPw", {timeout: 8000});
  await o2.fill("#chPw", INBOX_PW); await o2.press("#chPw", "Enter");
  await o2.waitForSelector('[data-chu="bilal"]', {timeout: 8000}).catch(() => {});
  ok(!(await o2.$('[data-chu="bilal"] .n')), "bilal's conversation is read back from the archive, nothing unread");
  await o2.click('[data-chu="bilal"]').catch(() => {}); await o2.waitForSelector("#chL .chm", {timeout: 8000}).catch(() => {});
  ok(await o2.evaluate(() => document.querySelectorAll("#chL .chm").length) === 2, "…both messages");

  console.log("before the chat is set up");
  chatJson = JSON.stringify({relay: "", topic: ""});
  const g = await (await mk()).newPage();
  await signIn(g, "zara", "zz99zz");
  await g.click("#bChat"); await g.waitForSelector("#chW a[href^='https://wa.me/']", {timeout: 8000}).catch(() => {});
  ok(!!(await g.$("#chW a[href^='https://wa.me/']")), "Feedback offers WhatsApp instead");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

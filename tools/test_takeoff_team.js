#!/usr/bin/env node
/* PDF Takeoff's friends' link takeoff/?team: a username and password per friend (takeoff/users.json, made in the owner's
   Settings › Team logins), and a team view without the backups or the links to the other ZD pages. A friend stays signed in on
   their computer until Sign out (never the password itself), and one login works in one browser at a time — against a stand-in
   for the relay of takeoff/chat.json. With the login switched off (users.json "open": true) anyone gets in as a guest, and each
   visit is counted for the owner, its IP address and place sealed for the owner's key.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_team.js                   (TK_URL for another address)
*/
const {chromium} = require("playwright");
const crypto = require("crypto"), fs = require("fs");
const BASE = (process.env.TK_URL || "http://127.0.0.1:8765/takeoff/").replace(/[^/]*$/, "");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const pb = (pw, s) => crypto.pbkdf2Sync(pw, s, 150000, 32, "sha256").toString("hex");
const entry = (u, pw) => { const s = crypto.randomBytes(16).toString("hex"); return {u, s, h: pb(pw, s), c: crypto.createHash("sha256").update(pb(pw, s + ":chat")).digest("hex"), iter: 150000, at: "2026-10-29"}; };
/* the relay (ntfy.sh) for the sign-ins: events in memory, each stamped with the time its sender's clock gives (a browser below
   runs 3 hours ahead, as a computer used later) */
const RELAY = "https://relay.test", TOPIC = "zd-team-test", SESS = [], ARCH = "https://raw.test/chat-archive/takeoff-chat.jsonl";
let ACT = "";   // takeoff-activity.json on the chat-archive branch (tools/activity_archive.py)
const sessEv = () => SESS.map(e => JSON.parse(e.message));
const VIS = [];   // the guests' visits (topic "v-")
let OWNER = null;   // chat.json's owner key, for the guests' sealed IP and place
async function routes(ctx){
  await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) {} });
  await ctx.route(/\/takeoff\/users\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: LIST}));
  await ctx.route(/\/takeoff\/chat\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: JSON.stringify(Object.assign({relay: RELAY, topic: TOPIC, archive: ARCH}, OWNER ? {owner: OWNER} : {}))}));
  await ctx.route(u => u.href.startsWith("https://get.geojs.io/"), r => r.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"},
    body: JSON.stringify({ip: "203.0.113.7", city: "Lahore", region: "Punjab", country: "Pakistan", organization_name: "Test Telecom"})}));
  await ctx.route(u => u.href.startsWith(RELAY + "/v-" + TOPIC), r => {
    const q = r.request(), cors = {"access-control-allow-origin": "*"};
    if (q.method() === "POST") { let m = {}; try { m = JSON.parse(q.postData()); } catch (e) {}
      const e = {id: "v" + VIS.length, time: m.t || Math.floor(Date.now() / 1000), event: "message", topic: "v-" + TOPIC, message: q.postData()};
      VIS.push(e); return r.fulfill({status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(e)}); }
    return r.fulfill({status: 200, contentType: "application/x-ndjson", headers: cors, body: VIS.map(e => JSON.stringify(e) + "\n").join("")});
  });
  await ctx.route(u => u.href.startsWith("https://raw.test/"), r => /takeoff-activity\.json/.test(r.request().url()) && ACT ? r.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: ACT}) : r.fulfill({status: 404, body: ""}));
  await ctx.route(u => u.href.startsWith(RELAY + "/s-" + TOPIC), r => {
    const q = r.request(), cors = {"access-control-allow-origin": "*"};
    if (q.method() === "POST") { let m = {}; try { m = JSON.parse(q.postData()); } catch (e) {}
      const e = {id: "s" + SESS.length, time: m.t || Math.floor(Date.now() / 1000), event: "message", topic: "s-" + TOPIC, message: q.postData()};
      SESS.push(e); return r.fulfill({status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(e)}); }
    const since = +new URL(q.url()).searchParams.get("since") || 0;
    return r.fulfill({status: 200, contentType: "application/x-ndjson", headers: cors, body: SESS.filter(e => e.time >= since).map(e => JSON.stringify(e) + "\n").join("")});
  });
}
let LIST = "";

(async () => {
  const browser = await chromium.launch();
  LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9")]});
  const ctx = await browser.newContext({viewport: {width: 1400, height: 900}, acceptDownloads: true});
  await routes(ctx);

  console.log("the friends' link");
  const page = await ctx.newPage(), errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE + "?team", {waitUntil: "load"});
  ok(await page.isVisible("#zd-lock-user") && await page.isVisible("#zd-lock-input"), "asks for a username and a password");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "zd-lock-user"), "the username field has the focus");
  ok(await page.evaluate(() => !document.querySelector("input[type=password]") && !document.querySelector("#zd-lock form")), "no browser password field and no form");
  ok(await page.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute("href")) === "manifest-team.webmanifest", "its own installable app (opens on ?team)");
  await page.fill("#zd-lock-user", "bilal"); await page.fill("#zd-lock-input", "wrong"); await page.press("#zd-lock-input", "Enter");
  await page.waitForSelector(".zd-lock-error:not([hidden])");
  ok(await page.isVisible("#zd-lock"), "a wrong password is refused");
  await page.fill("#zd-lock-input", "sa"); await page.press("#zd-lock-input", "Enter"); await page.waitForTimeout(600);
  ok(await page.isVisible("#zd-lock"), "the owner's password sa does not open the team link");
  await page.fill("#zd-lock-user", "Bilal "); await page.fill("#zd-lock-input", "takeoff9"); await page.click("#zd-lock button");
  await page.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  ok(!(await page.$("#zd-lock")), "the right username (any case) and password open it");
  await page.waitForSelector("#teamWho", {timeout: 5000}).catch(() => {});
  ok(/bilal/.test(await page.textContent("#teamWho").catch(() => "")), "shows who is signed in, with Sign out");
  ok(await page.evaluate(() => [...document.querySelectorAll("a.back, #start h2 > a.btn")].every(a => !a.offsetParent)), "no links to the other ZD pages");
  await page.click("#bNewProj"); await page.waitForSelector("#dlgName");
  await page.fill("#dlgName", "Team test"); await page.click("#dlgOk"); await page.waitForTimeout(1000);
  await page.click("#bProjects"); await page.waitForSelector("[data-bak]", {state: "attached", timeout: 5000}).catch(() => {});
  ok(await page.$("[data-bak]") !== null, "(a project on the start screen)");
  ok(await page.evaluate(() => [...document.querySelectorAll("[data-bak], #bRecover")].every(b => !b.offsetParent)), "no Backups or Recover buttons on the start screen");
  await page.keyboard.press("Control+,"); await page.waitForSelector("#stgNav", {timeout: 5000}).catch(() => {});
  const pg = await page.evaluate(() => [...document.querySelectorAll("#stgNav [data-spg]")].map(b => b.dataset.spg));
  ok(pg.length > 3 && !pg.includes("file") && !pg.includes("team"), "Settings has no Backup & reset page and no Team logins");
  await page.fill("#stgQ", "backup"); await page.waitForTimeout(200);
  ok(!/Backups of this project|Recover a deleted/.test(await page.textContent("#stgBody")), "no backups in Settings");
  await page.keyboard.press("Escape");
  ok(await page.evaluate(() => !Object.values(localStorage).concat(Object.values(sessionStorage), document.cookie).some(v => String(v).includes("takeoff9"))), "the password itself is not kept in the browser");
  ok(await page.evaluate(() => { const o = JSON.parse(localStorage.getItem("zd-team-login") || "{}"); return o.u === "bilal" && /^[0-9a-f]{64}$/.test(o.k) && !!o.sid; }), "the login is kept on this computer (username, sign-in id, chat key)");

  LIST = JSON.stringify({iter: 150000, users: []});   // the owner removes bilal
  const nav = page.waitForNavigation({timeout: 8000}).catch(() => null);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await nav; await page.waitForSelector("#zd-lock", {timeout: 5000}).catch(() => {});
  ok(!!(await page.$("#zd-lock-user")), "a removed user is signed out");
  await page.fill("#zd-lock-user", "bilal"); await page.fill("#zd-lock-input", "takeoff9"); await page.press("#zd-lock-input", "Enter");
  await page.waitForSelector(".zd-lock-error:not([hidden])");
  ok(await page.isVisible("#zd-lock"), "and can't sign in again");
  ok(/No team logins are saved yet/.test(await page.textContent(".zd-lock-error")), "an empty list says no logins are saved yet (not 'incorrect')");
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await page.close();

  console.log("the owner's Settings › Team logins");
  const own = await ctx.newPage(), e2 = [];
  own.on("pageerror", e => e2.push(String(e)));
  await own.goto(BASE, {waitUntil: "load"});
  ok(!(await own.$("#zd-lock-user")), "the plain link asks only for the password");
  await own.fill("#zd-lock-input", "sa"); await own.press("#zd-lock-input", "Enter");
  await own.waitForSelector("#zd-lock", {state: "detached"});
  await own.waitForTimeout(800);
  await own.keyboard.press("Control+,"); await own.waitForSelector("#stgNav");
  ok(await own.evaluate(() => [...document.querySelectorAll("#stgNav [data-spg]")].some(b => b.dataset.spg === "team")), "the owner has a Team logins page");
  await own.click('#stgNav [data-spg="team"]'); await own.waitForSelector("#tmAdd", {timeout: 5000});
  ok(/\?team$/.test(await own.inputValue("#tmLink")), "it shows the friends' link");
  ok(/No team users yet/.test(await own.textContent("#stgBody")), "lists the users (none)");
  await own.fill("#tmU", "Ali"); await own.fill("#tmP", "abc12345"); await own.click("#tmAdd");
  await own.waitForSelector("[data-tmdel]", {timeout: 5000}).catch(() => {});
  await own.fill("#tmU", "zara"); await own.fill("#tmP", "zz99zz"); await own.press("#tmP", "Enter");
  await own.waitForFunction(() => document.querySelectorAll("[data-tmdel]").length === 2, null, {timeout: 5000}).catch(() => {});
  ok(await own.evaluate(() => document.querySelectorAll("[data-tmdel]").length) === 2, "adds users");
  ok(await own.evaluate(() => getComputedStyle(document.getElementById("tmP")).webkitTextSecurity) === "disc", "the new password is typed as dots");
  ok(/Not saved to the site yet/.test(await own.textContent("#stgBody")) && !(await own.isDisabled("#tmSave")), "unsaved changes are shown, Save is offered");
  await own.click('[data-tmdel="1"]'); await own.waitForTimeout(200);
  ok(await own.evaluate(() => document.querySelectorAll("[data-tmdel]").length) === 1, "removes a user");
  const [dl] = await Promise.all([own.waitForEvent("download"), own.click("#tmDl")]);
  const file = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  ok(file.users.length === 1 && file.users[0].u === "ali" && !JSON.stringify(file).includes("abc12345"), "users.json holds the user and only a hash of the password");
  ok(e2.length === 0, "no page errors" + (e2.length ? ": " + e2[0] : ""));
  await own.close();

  console.log("a friend signs in with the login made there");
  LIST = JSON.stringify(file);
  const fr = await ctx.newPage();
  await fr.goto(BASE + "?team", {waitUntil: "load"});
  await fr.fill("#zd-lock-user", "ali"); await fr.fill("#zd-lock-input", "abc12345"); await fr.press("#zd-lock-input", "Enter");
  await fr.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  ok(!(await fr.$("#zd-lock")), "ali signs in");
  await fr.click("#bSignOut"); await fr.waitForSelector("#zd-lock-user", {timeout: 8000}).catch(() => {});
  ok(!!(await fr.$("#zd-lock-user")), "Sign out asks again");
  await fr.close();

  console.log("kept signed in, one computer at a time");
  SESS.length = 0; LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9")]});
  const signIn = async (pg, u, pw) => { await pg.evaluate(() => { const e = document.querySelector("#zd-lock .zd-lock-error"); if (e) e.hidden = true; }); await pg.fill("#zd-lock-user", u); await pg.fill("#zd-lock-input", pw); await pg.press("#zd-lock-input", "Enter");
    await pg.waitForFunction(() => !document.getElementById("zd-lock") || !document.querySelector(".zd-lock-error").hidden, null, {timeout: 15000}).catch(() => {}); };
  const lockMsg = pg => pg.evaluate(() => { const e = document.querySelector("#zd-lock .zd-lock-error"); return e && !e.hidden ? e.textContent : ""; });
  const signedAs = pg => pg.waitForSelector("#teamWho", {timeout: 8000}).then(() => pg.textContent("#teamWho"), () => "");
  const A = await browser.newContext({viewport: {width: 1300, height: 850}}); await routes(A);
  const a = await A.newPage(), e3 = []; a.on("pageerror", e => e3.push(String(e)));
  await a.goto(BASE + "?team", {waitUntil: "load"});
  await signIn(a, "bilal", "takeoff9");
  ok(!(await a.$("#zd-lock")) && /bilal/.test(await signedAs(a)), "computer A: bilal signs in");
  await a.waitForTimeout(500);
  ok(sessEv().some(m => m.zs === 1 && m.u === "bilal" && m.k === "claim" && /^[0-9a-f]{64}$/.test(m.h)) && !SESS.some(e => e.message.includes("takeoff9")), "the sign-in is announced on the relay (signed, no password)");
  await a.reload({waitUntil: "load"}); await a.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  ok(!(await a.$("#zd-lock")) && /bilal/.test(await signedAs(a)), "kept signed in after a reload — not asked again");
  const a2 = await A.newPage(); await a2.goto(BASE + "?team", {waitUntil: "load"}); await a2.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  ok(!(await a2.$("#zd-lock")), "…and in a new tab of the same browser");
  await a2.close();

  const B = await browser.newContext({viewport: {width: 1300, height: 850}}); await routes(B);
  const b = await B.newPage(); await b.goto(BASE + "?team", {waitUntil: "load"});
  await signIn(b, "bilal", "takeoff9");
  ok(!!(await b.$("#zd-lock")) && /in use on another computer/.test(await lockMsg(b)), "computer B: the same login is refused while A uses it");
  ok(await b.evaluate(() => !localStorage.getItem("zd-team-login")), "…and B keeps nothing");
  await a.click("#bSignOut"); await a.waitForSelector("#zd-lock-user", {timeout: 8000}).catch(() => {});
  ok(!!(await a.$("#zd-lock-user")) && await a.evaluate(() => !localStorage.getItem("zd-team-login")), "A: Sign out asks again and forgets the login");
  ok(sessEv().some(m => m.k === "release" && m.u === "bilal"), "…and frees it on the relay");
  await signIn(b, "bilal", "takeoff9");
  ok(!(await b.$("#zd-lock")) && /bilal/.test(await signedAs(b)), "B: now bilal signs in");
  await signIn(a, "bilal", "takeoff9");
  ok(!!(await a.$("#zd-lock")) && /in use/.test(await lockMsg(a)), "A: refused now that B uses it");

  const C = await browser.newContext({viewport: {width: 1300, height: 850}}); await routes(C);
  await C.addInitScript(() => { const n = Date.now.bind(Date); Date.now = () => n() + 3 * 3600 * 1000; });   // a computer used 3 hours later
  const c = await C.newPage(); await c.goto(BASE + "?team", {waitUntil: "load"});
  await signIn(c, "bilal", "takeoff9");
  ok(!(await c.$("#zd-lock")), "computer C, 3 hours after B was last used: bilal signs in (B's sign-in has lapsed)");
  await c.waitForTimeout(500);
  const navB = b.waitForNavigation({timeout: 10000}).catch(() => null);
  await b.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await navB;
  await b.waitForSelector("#zd-lock .zd-lock-error:not([hidden])", {timeout: 8000}).catch(() => {});
  ok(/signed in on another computer/.test(await lockMsg(b)) && await b.evaluate(() => !localStorage.getItem("zd-team-login")), "B is then signed out: the login was taken over");

  LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "newpass7")]});   // the owner gives bilal a new password
  await c.reload({waitUntil: "load"}); await c.waitForSelector("#zd-lock-user", {timeout: 10000}).catch(() => {});
  ok(!!(await c.$("#zd-lock-user")) && await c.evaluate(() => !localStorage.getItem("zd-team-login")), "a new password: the kept login is forgotten and asked again");
  await signIn(c, "bilal", "newpass7");
  ok(!(await c.$("#zd-lock")), "…and the new password signs in at once (the old sign-ins can't hold it)");
  ok(e3.length === 0, "no page errors" + (e3.length ? ": " + e3[0] : ""));
  await A.close(); await B.close(); await C.close();

  console.log("the owner sees who used the app (Settings › Team logins)");
  SESS.length = 0; LIST = JSON.stringify({iter: 150000, users: [entry("ali", "abc12345"), entry("bilal", "takeoff9"), entry("zara", "zz99zz")]});
  const nowS = Math.floor(Date.now() / 1000), pk = t => new Date((t + 5 * 3600) * 1000).toISOString().slice(0, 10);
  const push = (u, sid, t) => SESS.push({id: "s" + SESS.length, time: t, event: "message", topic: "s-" + TOPIC, message: JSON.stringify({zs: 1, u, sid, k: "claim", t, h: "x"})});
  push("bilal", "aaaaaaaaaaaa", nowS - 1300); push("bilal", "aaaaaaaaaaaa", nowS - 900); push("bilal", "aaaaaaaaaaaa", nowS - 120);
  push("ali", "bbbbbbbbbbbb", nowS - 1600);   // already summed in the archive (its id is in "seen"): counted once
  push("nobody", "cccccccccccc", nowS - 100);   // not a user
  ACT = JSON.stringify({tz: 5, seen: {s3: nowS - 1600}, days: {[pk(nowS - 86400)]: {ali: {f: nowS - 88000, l: nowS - 86400, n: 2, s: ["bbbbbbbb"]}}, [pk(nowS - 1600)]: {ali: {f: nowS - 1600, l: nowS - 1600, n: 1, s: ["bbbbbbbb"]}}}});
  const O = await browser.newContext({viewport: {width: 1400, height: 900}}); await routes(O);
  const ow = await O.newPage(), e4 = []; ow.on("pageerror", e => e4.push(String(e)));
  await ow.goto(BASE, {waitUntil: "load"}); await ow.fill("#zd-lock-input", "sa"); await ow.press("#zd-lock-input", "Enter");
  await ow.waitForSelector("#zd-lock", {state: "detached"}); await ow.waitForTimeout(800);
  await ow.keyboard.press("Control+,"); await ow.waitForSelector("#stgNav"); await ow.click('#stgNav [data-spg="team"]');
  await ow.waitForSelector(".tmact", {timeout: 10000}).catch(() => {});
  const st = await ow.evaluate(() => { const a = document.querySelector(".tmact"); return a ? a.querySelector(".tmst").textContent.replace(/\s+/g, " ").trim() : ""; });
  ok(/2 of 3 today/.test(st) && /1 online now/.test(st) && /2 in the last 7 days/.test(st), "daily active users: 2 of 3 today, 1 online now, 2 this week (" + st + ")");
  const bars = await ow.evaluate(() => [...document.querySelectorAll("#tmBars .tmb")].map(b => ({now: b.classList.contains("now"), h: parseFloat(b.querySelector("i").style.height) || 0})));
  ok(bars.length === 14 && bars[13].now && bars[13].h === 100 && bars[12].h > 0 && bars[12].h < 100 && bars.slice(0, 12).every(b => b.h === 0), "a bar a day for 14 days: today 2 users (full), yesterday 1, the others none");
  await ow.hover("#tmBars .tmb:nth-child(13)");
  ok(/: 1 user — ali$/.test(await ow.textContent("#tmRead")), "pointing at a day names who used it");
  const rows = await ow.evaluate(() => [...document.querySelectorAll("table.tmlist tbody tr")].map(tr => [...tr.cells].slice(0, 4).map(td => td.textContent.replace(/\s+/g, " ").trim()).concat(!!tr.querySelector(".tmon"))));
  const R2 = Object.fromEntries(rows.map(r => [r[0], r]));
  ok(R2.bilal && R2.bilal[4] && /~1 h$/.test(R2.bilal[1]) && R2.bilal[2] === "online now" && R2.bilal[3] === "1", "bilal: online now, used about an hour today, 1 day (" + (R2.bilal || []).join(" | ") + ")");
  ok(R2.ali && !R2.ali[4] && /under 20 min$/.test(R2.ali[1]) && /^today \d\d:\d\d$/.test(R2.ali[2]) && R2.ali[3] === "2", "ali: today (counted once, not twice), 2 days (" + (R2.ali || []).join(" | ") + ")");
  ok(R2.zara && R2.zara[1] === "—" && R2.zara[2] === "not yet" && R2.zara[3] === "0", "zara: not used yet");
  ok(!rows.some(r => r[0] === "nobody"), "only users in the list are shown");
  ok(e4.length === 0, "no page errors" + (e4.length ? ": " + e4[0] : ""));
  await O.close();

  console.log("the login switched off: anyone gets in as a guest, each visit counted");
  const kp = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
  const oSalt = crypto.randomBytes(16), oIv = crypto.randomBytes(12), wc = crypto.createCipheriv("aes-256-gcm", crypto.pbkdf2Sync("sa", oSalt, 1000, 32, "sha256"), oIv);
  const wrapped = Buffer.concat([wc.update(kp.privateKey.export({type: "pkcs8", format: "der"})), wc.final(), wc.getAuthTag()]);
  OWNER = {pub: kp.publicKey.export({type: "spki", format: "der"}).toString("base64"), salt: oSalt.toString("base64"), iv: oIv.toString("base64"), iter: 1000, key: wrapped.toString("base64")};
  const unseal = x => {   // as the owner's page opens it
    const raw = crypto.privateDecrypt({key: kp.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256"}, Buffer.from(x.k, "base64"));
    const b = Buffer.from(x.ct, "base64"), dc = crypto.createDecipheriv("aes-256-gcm", raw, Buffer.from(x.iv, "base64")); dc.setAuthTag(b.subarray(b.length - 16));
    return JSON.parse(Buffer.concat([dc.update(b.subarray(0, b.length - 16)), dc.final()]).toString());
  };
  const visits = () => VIS.map(e => JSON.parse(e.message));
  const untilVis = async (pg, n) => { for (let i = 0; i < 60 && VIS.length < n; i++) await pg.waitForTimeout(200); };
  SESS.length = 0; VIS.length = 0; ACT = "";
  LIST = JSON.stringify({open: true, iter: 150000, users: [entry("bilal", "takeoff9")]});
  const Gc = await browser.newContext({viewport: {width: 1300, height: 850}}); await routes(Gc);
  const gp = await Gc.newPage(), e5 = []; gp.on("pageerror", e => e5.push(String(e)));
  await gp.goto(BASE + "?team", {waitUntil: "load"});
  await gp.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  ok(!(await gp.$("#zd-lock")), "the friends' link opens with no username or password");
  await gp.waitForSelector("#teamWho", {timeout: 5000}).catch(() => {});
  ok(/Guest/.test(await gp.textContent("#teamWho").catch(() => "")) && await gp.isVisible("#bSignIn"), "it shows Guest, with Sign in");
  ok(await gp.evaluate(() => [...document.querySelectorAll("[data-bak], #bRecover, a.back, #start h2 > a.btn")].every(b => !b.offsetParent)), "still the team view: no backups, no links to the other ZD pages");
  await untilVis(gp, 1);
  const v1 = visits()[0] || {};
  ok(VIS.length === 1 && v1.k === "visit" && /^[0-9a-f]{12}$/.test(v1.v) && v1.nw === 1 && / · /.test(v1.d || ""), "the visit is counted on the relay: this browser's id, new, its device (" + v1.d + ")");
  ok(!!v1.x && !JSON.stringify(v1).includes("203.0.113.7") && !JSON.stringify(v1).includes("Lahore"), "its IP address and place are not readable on the relay");
  let w1 = {}; try { w1 = unseal(v1.x); } catch (e) {}
  ok(w1.ip === "203.0.113.7" && w1.city === "Lahore" && w1.country === "Pakistan" && !!w1.ua, "…they are sealed for the owner's key (" + [w1.ip, w1.city, w1.country].join(", ") + ")");
  ok(await gp.evaluate(() => /^[0-9a-f]{12}$/.test(localStorage.getItem("zd-visitor") || "") && !localStorage.getItem("zd-team-login")), "the browser keeps only a random visitor id, no login");
  await gp.click("#bChat"); await gp.waitForSelector("#chW a[href*='wa.me']", {timeout: 5000}).catch(() => {});
  ok(/Feedback/.test(await gp.textContent("#bChat")) && await gp.isVisible("#chW a[href*='wa.me']") && await gp.isVisible("#chSignIn"), "Feedback (not the owner's Inbox) offers WhatsApp and Sign in");
  await gp.click("#chX");
  await gp.reload({waitUntil: "load"}); await untilVis(gp, 2);
  const v2 = visits()[1] || {};
  ok(v2.v === v1.v && !v2.nw && v2.s && v2.s !== v1.s, "opened again: the same visitor (not new), another page");
  await gp.waitForSelector("#bSignIn", {timeout: 5000}).catch(() => {});
  await gp.click("#bSignIn"); await gp.waitForSelector("#zd-lock-user", {timeout: 8000}).catch(() => {});
  ok(await gp.isVisible("#zd-lock-user") && await gp.isVisible(".zd-lock-guest"), "Sign in asks for the username and password, with Continue without signing in");
  await gp.fill("#zd-lock-user", "bilal"); await gp.fill("#zd-lock-input", "takeoff9"); await gp.press("#zd-lock-input", "Enter");
  await gp.waitForSelector("#zd-lock", {state: "detached", timeout: 10000}).catch(() => {});
  await gp.waitForSelector("#teamWho", {timeout: 5000}).catch(() => {});
  ok(/bilal/.test(await gp.textContent("#teamWho").catch(() => "")) && await gp.isVisible("#bSignOut"), "a friend still signs in with their own login");
  await gp.click("#bSignOut"); await gp.waitForTimeout(1500); await gp.waitForSelector("#teamWho", {timeout: 8000}).catch(() => {});
  ok(!(await gp.$("#zd-lock")) && /Guest/.test(await gp.textContent("#teamWho").catch(() => "")), "Sign out: back in as a guest");
  LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9")]});   // the owner switches the login on again
  const nav2 = gp.waitForNavigation({timeout: 8000}).catch(() => null);
  await gp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await nav2; await gp.waitForSelector("#zd-lock-user", {timeout: 8000}).catch(() => {});
  ok(await gp.isVisible("#zd-lock-user") && !(await gp.isVisible(".zd-lock-guest")), "the login switched on again: an open guest page asks for a login");
  ok(e5.length === 0, "no page errors" + (e5.length ? ": " + e5[0] : ""));
  await Gc.close();

  console.log("the owner sees the guests (Settings › Team logins)");
  LIST = JSON.stringify({open: true, iter: 150000, users: [entry("bilal", "takeoff9")]});
  const nV = new Set(visits().map(m => m.v)).size;
  const Oc = await browser.newContext({viewport: {width: 1400, height: 900}, acceptDownloads: true}); await routes(Oc);
  const og = await Oc.newPage(), e6 = []; og.on("pageerror", e => e6.push(String(e)));
  await og.goto(BASE, {waitUntil: "load"}); await og.fill("#zd-lock-input", "sa"); await og.press("#zd-lock-input", "Enter");
  await og.waitForSelector("#zd-lock", {state: "detached"}); await og.waitForTimeout(800);
  await og.keyboard.press("Control+,"); await og.waitForSelector("#stgNav"); await og.click('#stgNav [data-spg="team"]');
  await og.waitForSelector("#tmGst.tmact", {timeout: 10000}).catch(() => {});
  ok(!(await og.isChecked("#tmOpen")) && /Off for now/.test(await og.textContent("#stgBody")), "Ask for a login shows off");
  const gst = await og.evaluate(() => { const a = document.querySelector("#tmGst .tmst"); return a ? a.textContent.replace(/\s+/g, " ").trim() : ""; });
  ok(nV === 1 && /1 today/.test(gst) && /1 new today/.test(gst) && /1 online now/.test(gst) && /1 in the last 7 days/.test(gst), "guests: 1 today, 1 new, 1 online now, 1 this week (" + gst + ")");
  ok(await og.evaluate(() => document.querySelectorAll("#tmGBars .tmb").length) === 14, "a bar a day for 14 days");
  const gr = await og.evaluate(() => [...document.querySelectorAll("#tmGList tbody tr")].map(tr => [...tr.cells].map(td => td.textContent.replace(/\s+/g, " ").trim())));
  ok(gr.length === 1 && /^#[0-9a-f]{6} new$/.test(gr[0][0]) && / · /.test(gr[0][2]) && gr[0][3] === "sealed", "today's guest: id, new, time, device; place and IP sealed (" + (gr[0] || []).join(" | ") + ")");
  await og.click("#tmShowIp"); await og.waitForSelector("#tmIpPw");
  await og.fill("#tmIpPw", "wrong"); await og.click("#dlgOk"); await og.waitForSelector("#tmGList", {timeout: 8000}).catch(() => {});
  ok(/sealed/.test(await og.textContent("#tmGList").catch(() => "")), "a wrong Inbox password opens nothing");
  await og.click("#tmShowIp"); await og.waitForSelector("#tmIpPw");
  await og.fill("#tmIpPw", "sa"); await og.click("#dlgOk");
  await og.waitForFunction(() => /203\.0\.113\.7/.test((document.getElementById("tmGList") || {}).textContent || ""), null, {timeout: 8000}).catch(() => {});
  const place = await og.evaluate(() => { const r = document.querySelector("#tmGList tbody tr"); return r ? r.cells[3].textContent.trim() : ""; });
  ok(place === "Lahore, Pakistan · 203.0.113.7", "the Inbox password shows the place and IP (" + place + ")");
  ok(await og.evaluate(() => !Object.values(localStorage).concat(Object.values(sessionStorage)).some(v => String(v).includes("203.0.113.7"))), "…shown only, not kept in the browser");
  await og.click("#tmOpen"); await og.waitForTimeout(300);
  ok(await og.isChecked("#tmOpen") && /login switched on/.test(await og.textContent("#stgBody")), "switching the login on again waits to be saved to the site");
  const [dl2] = await Promise.all([og.waitForEvent("download"), og.click("#tmDl")]);
  const f2 = JSON.parse(fs.readFileSync(await dl2.path(), "utf8"));
  ok(f2.open === false && f2.users.length === 1, "users.json then says open: false");
  ok(e6.length === 0, "no page errors" + (e6.length ? ": " + e6[0] : ""));
  await Oc.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

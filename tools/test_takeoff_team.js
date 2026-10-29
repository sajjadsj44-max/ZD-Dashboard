#!/usr/bin/env node
/* PDF Takeoff's friends' link takeoff/?team: a username and password per friend (takeoff/users.json, made in the owner's
   Settings › Team logins), asked each time, and a team view without the backups or the links to the other ZD pages.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_team.js                   (TK_URL for another address)
*/
const {chromium} = require("playwright");
const crypto = require("crypto"), fs = require("fs");
const BASE = (process.env.TK_URL || "http://127.0.0.1:8765/takeoff/").replace(/[^/]*$/, "");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const entry = (u, pw) => { const s = crypto.randomBytes(16).toString("hex"); return {u, s, h: crypto.pbkdf2Sync(pw, s, 150000, 32, "sha256").toString("hex"), iter: 150000, at: "2026-10-29"}; };

(async () => {
  const browser = await chromium.launch();
  let LIST = JSON.stringify({iter: 150000, users: [entry("bilal", "takeoff9")]});
  const ctx = await browser.newContext({viewport: {width: 1400, height: 900}, acceptDownloads: true});
  await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) {} });
  await ctx.route(/\/takeoff\/users\.json/, r => r.fulfill({status: 200, contentType: "application/json", body: LIST}));

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
  ok(await page.evaluate(() => localStorage.length === 0 || !Object.keys(localStorage).some(k => /pass|pw|secret|user/i.test(k) && !/^zdTakeoff/.test(k))), "nothing about the sign-in kept in the browser");

  LIST = JSON.stringify({iter: 150000, users: []});   // the owner removes bilal
  const nav = page.waitForNavigation({timeout: 8000}).catch(() => null);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await nav; await page.waitForSelector("#zd-lock", {timeout: 5000}).catch(() => {});
  ok(!!(await page.$("#zd-lock-user")), "a removed user is signed out");
  await page.fill("#zd-lock-user", "bilal"); await page.fill("#zd-lock-input", "takeoff9"); await page.press("#zd-lock-input", "Enter");
  await page.waitForSelector(".zd-lock-error:not([hidden])");
  ok(await page.isVisible("#zd-lock"), "and can't sign in again");
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

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

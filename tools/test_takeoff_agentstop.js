#!/usr/bin/env node
/* Browser tests for stopping the takeoff agent part-way (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_agentstop.js

   On the apartment plan (tools/takeoff_apartment_fixture.js, 8 named rooms on each of 3 pages): the Rooms agent stopped from
   the busy note's Stop while it measures room 3 keeps the rooms done, lists the rest and adds nothing more; the Stop buttons
   show only while an agent runs; the next run carries on (the stop is not left set); a full takeoff over the PDF stopped with
   Esc on page 2 never reaches page 3 and says so; the AI's auto_area_page stopped part-way traces no more rooms. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const A = require("./takeoff_apartment_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  await ctx.route(/anthropic\.com|openai\.com|claude\.ai|127\.0\.0\.1:11434/, r => r.abort());
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const log = () => T(() => [...document.querySelectorAll("#aiLog .aimsg")].map(d => d.className.replace("aimsg ", "") + ": " + d.textContent));
  const stopsShown = () => T(() => [...document.querySelectorAll(".agStop")].filter(b => b.style.display !== "none").length);
  const aiRooms = () => T(() => { const S = zdTakeoff.S; return zdTakeoff.P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && i.ai && i.kind === "shape").length; });
  /* run fn in the page, answering the "whole page or an area?" question with the whole page, until it is done */
  const run = async fn => { const pr = T(fn);
    for (let i = 0; i < 240; i++) { const d = await page.$("#dlgBack.on"); if (d) { const all = await page.$('input[name=arW][value=all]'); if (all) await all.check(); await page.click("#dlgOk").catch(() => {}); }
      if (await Promise.race([pr.then(() => true), wait(500).then(() => false)])) break; }
    await pr; await wait(200); };
  /* when the busy note first matches rx: press its Stop (or Esc), noting what showed at that moment */
  const stopWhen = (rx, how) => T(([src, how]) => { const rx = new RegExp(src), b = document.getElementById("busy"); window.__stop = null;
    const mo = new MutationObserver(() => { if (window.__stop || !rx.test(b.textContent)) return;
      const btn = b.querySelector(".busyStop"); window.__stop = {busyBtn: !!btn, shown: [...document.querySelectorAll(".agStop")].filter(x => x.style.display !== "none").length, text: b.textContent};
      mo.disconnect();
      if (how === "esc") document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); else if (btn) btn.click(); });
    mo.observe(b, {childList: true, characterData: true, subtree: true}); }, [rx.source, how || "button"]);

  await page.goto(URL); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Agent stop"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "apartment.pdf", mimeType: "application/pdf", buffer: A.pdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await wait(400);
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await T(() => { try { localStorage.setItem("zdTakeoffAiEngine", "rules"); } catch (e) {} });

  console.log("the Rooms agent, stopped from the busy note on room 3");
  ok(await stopsShown() === 0, "no Stop button while no agent runs");
  await stopWhen(/Measuring 3 of/);
  let n0 = (await log()).length;
  await run(() => document.getElementById("agRooms").click());
  await page.waitForFunction(() => window.__stop && ![...document.querySelectorAll(".agStop")].some(b => b.style.display !== "none"), null, {timeout: 120000});
  const st = await T(() => window.__stop), got1 = await aiRooms(); let out = (await log()).slice(n0);
  ok(st && st.busyBtn, "the busy note carries a Stop while the agent measures (" + (st && st.text) + ")");
  ok(st && st.shown >= 1, "the panel / agent bar Stop shows while it runs (" + (st && st.shown) + " shown)");
  ok(got1 >= 2 && got1 < 8, "the rooms measured before the stop stay, and it measured no more: " + got1 + " of 8");
  ok(out.some(l => /Stopped by you — \d+ of \d+ rooms? not measured/.test(l)), "the panel says it stopped and lists the rooms not measured: " + (out.find(l => /Stopped/.test(l)) || "—").slice(0, 160));
  ok(await stopsShown() === 0, "the Stop buttons are gone once it has stopped");
  await wait(1500); ok(await aiRooms() === got1, "nothing more is added after the stop");

  console.log("the next run carries on");
  n0 = (await log()).length;
  await run(() => zdTakeoff.agentDo(() => zdTakeoff.agentCmd("measure all rooms")));
  const got2 = await aiRooms(); out = (await log()).slice(n0);
  ok(got2 > got1 && !out.some(l => /Stopped by you/.test(l)), "a new run is not stopped and measures the rest: " + got1 + " → " + got2 + " rooms");
  ok(out.some(l => /already measured/.test(l)), "the rooms done before the stop are left as they are, not measured twice");

  console.log("rooms on every page of the PDF, stopped with Esc on page 2");
  await stopWhen(/\(2 of 3\)/, "esc");
  n0 = (await log()).length;
  await run(() => zdTakeoff.aiSend("measure all rooms on every page"));
  out = (await log()).slice(n0);
  const st2 = await T(() => window.__stop), rep = out.find(l => /stopped by you/.test(l)) || out.join(" | ");
  ok(st2 && /2 of 3/.test(st2.text), "Esc was pressed while it was on page 2 (" + (st2 && st2.text) + ")");
  ok(/not reached — stopped by you/.test(rep), "the report lists the page not reached: " + rep.replace(/\s+/g, " ").slice(0, 220));
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 3 && i.ai).length) === 0, "nothing was measured on page 3");
  ok(await stopsShown() === 0, "the Stop buttons are gone once it has stopped");

  console.log("the full takeoff (rooms, walls, tags, finishes) over the PDF, stopped on page 2");
  await T(() => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => i.page === 1); });
  await stopWhen(/Full takeoff — .*\(2 of 3\)/);
  n0 = (await log()).length;
  const ft = await T(async () => { const r = await zdTakeoff.agentDo(() => zdTakeoff.fullTakeoff({scope: "pdf", rooms: true, walls: true, doors: true, fin: false}));
    return r.pages ? r.pages.map(R => ({page: R.page, skip: R.skip || "", stop: !!R.stop})) : r; });
  out = (await log()).slice(n0);
  ok(Array.isArray(ft) && ft.length === 3 && /not reached — stopped by you/.test(ft[2].skip) && !ft[0].skip, "page 1 done, page 3 not reached: " + JSON.stringify(ft));
  ok(out.some(l => /Full takeoff/.test(l) && /not reached — stopped by you/.test(l)), "the full takeoff's report shows it was stopped");
  ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 3 && i.ai).length) === 0, "nothing was taken off page 3");
  ok(await stopsShown() === 0, "the Stop buttons are gone once it has stopped");

  console.log("the AI's auto_area_page, stopped part-way");
  await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 3)); await page.waitForFunction(() => zdTakeoff.S.pageNo === 3 && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await wait(300);
  await T(() => { zdTakeoff.P.proj.items = zdTakeoff.P.proj.items.filter(i => i.page !== 3); });
  const aa = await T(async () => {   // (stopped 30 ms in: the first room is being traced)
    const r = await zdTakeoff.agentDo(async () => { const p = zdTakeoff.aiRunTool({name: "auto_area_page", input: {review: true}});
      await new Promise(q => setTimeout(q, 30)); zdTakeoff.agentStop(); return p; });
    const rooms = r.ok ? r.ok.rooms : []; return {stopped: rooms.filter(x => x.status === "stopped").length, traced: rooms.filter(x => x.net_sft != null).length, err: r.err || ""}; });
  ok(aa.stopped >= 1 && aa.traced < 8, "auto_area_page traces no more rooms after the stop: " + aa.traced + " traced, " + aa.stopped + " not (" + aa.err + ")");
  await T(() => zdTakeoff.aiRunTool({name: "discard_preview", input: {}}));

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

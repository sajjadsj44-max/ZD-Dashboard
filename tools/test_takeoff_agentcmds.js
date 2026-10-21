#!/usr/bin/env node
/* The takeoff agent's QS commands, run for real on the apartment plan (tools/takeoff_apartment_fixture.js), with the built-in
   rule agent (no key, nothing sent anywhere) and through the qs_command tool the language models call:

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_agentcmds.js      (pdfjs-dist)

   Each command must do what it says on the takeoff itself (measurements added, selected, removed or left alone, checked against
   the drawing's known quantities), say so — and say it was NOT done when it was not: an unknown command, a page with no scale,
   a reject of a person's own measurement, an undo with no agent run. A person's work (their measurements, their checked counts)
   is never changed by an agent. */
const path = require("path"), fs = require("fs");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const A = require("./takeoff_apartment_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0; const ok = (c, m) => { if (c) passes++; else fails++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
const near = (a, b, t) => a != null && Math.abs(a - b) <= (t == null ? 0.01 : t);
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  const cloud = [];
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  await ctx.route(/anthropic\.com|openai\.com|claude\.ai/, r => { cloud.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  // the app's own dialogs (ask): the name for a QA record, "delete your own measurement?" — answered here
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  await page.goto(URL); await wait(600);
  await T(() => localStorage.setItem("zdTakeoffUser", "Tester"));
  await page.click("#bNewProj"); await page.fill("#dlgName", "Agent commands"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "apartment.pdf", mimeType: "application/pdf", buffer: A.pdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await wait(400);
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await T(() => localStorage.setItem("zdTakeoffAiEngine", "rules"));
  const log = () => T(() => [...document.querySelectorAll("#aiLog .aimsg")].map(d => d.className.replace("aimsg ", "") + ": " + d.textContent));
  const say = async t => { const n = (await log()).length; await T(t => zdTakeoff.aiSend(t), t); await wait(250); return (await log()).slice(n).join("\n"); };
  const items = () => T(() => zdTakeoff.P.proj.items.map(i => ({id: i.id, label: i.label, cond: (zdTakeoff.P.proj.conds.find(c => c.id === i.cond) || {}).name, ai: !!i.ai, qa: i.qa || "", kind: i.kind, n: i.pts.length, q: zdTakeoff.qtyOf(i)})));
  const sel = () => T(() => [...zdTakeoff.selIds()]);
  const room = (L, nm) => L.find(i => (i.label || "").toUpperCase() === nm);

  console.log("1. Measure all rooms on the current floor");
  let out = await say("Measure all rooms on the current floor"), L = await items();
  const areas = L.filter(i => i.kind === "shape" && i.cond === "Floor area");
  ok(areas.length === A.ROOMS.length, `all ${A.ROOMS.length} rooms measured (${areas.length}): ${areas.map(i => i.label).join(", ")}`);
  ok(A.ROOMS.every(([nm]) => room(areas, nm) && near(room(areas, nm).q, A.REF.rooms[nm].area, 0.5)), "each room's quantity matches the drawing within 0.5 Sft: " + A.ROOMS.map(([nm]) => nm + " " + (room(areas, nm) || {}).q).join(", "));
  ok(/✓ Measure rooms/.test(out) && /8 measured/.test(out) && areas.every(i => i.ai), "the reply says 8 measured, each marked AI until checked");

  console.log("2. Measure every washroom separately (into their own condition)");
  await T(() => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => !/BATH/.test(i.label || "")); Z.refresh(); });
  out = await say("Measure every washroom separately"); L = await items();
  const baths = L.filter(i => /BATH/.test(i.label || "") && i.kind === "shape");
  ok(baths.length === 2 && near(room(baths, "BATH 1").q, 48, 0.25) && near(room(baths, "BATH 2").q, 40, 0.25), `the two baths, each its own measurement: ${baths.map(i => i.label + " " + i.q).join(", ")}`);
  ok(!L.some(i => /BED ROOM 1/.test(i.label || "") && i.id !== room(areas, "BED ROOM 1").id), "no other room measured again (washroom → BATH, TOILET, W.C…, not every room)");
  out = await say("Measure every washroom on every page into a separate washroom area"); L = await items();
  const all3 = L.filter(i => i.cond === "Washroom area"), pg = await T(() => zdTakeoff.S.pageNo);
  ok(all3.length === 6 && all3.every(i => near(i.q, /BATH 1/.test(i.label) ? 48 : 40, 0.25)) && /on 3 of 3 pages/.test(out), `every page of the PDF (1/4", 1:100, 1/8" turned 90°): 6 baths, each 48 / 40 Sft — ${all3.map(i => i.q).join(", ")}`);
  ok(pg === 1 && /✓ Measure rooms/.test(out), "…the pages are reported one by one and the view comes back to the page it started on");
  await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Washroom area"); Z.P.proj.items = Z.P.proj.items.filter(i => i.cond !== c.id); Z.S.cond = Z.P.proj.conds.find(x => x.name === "Floor area").id; Z.refresh(); });   // (back to one outline per bath for the steps below)

  console.log("3. Create a separate corridor area");
  out = await say("Create a separate corridor area"); L = await items();
  const corr = L.filter(i => i.cond === "Corridor area");
  ok(corr.length === 1 && near(corr[0].q, 205.375, 0.5), `a 'Corridor area' condition with the corridor in it: ${corr.map(i => i.label + " " + i.q).join(", ")} (205.375 Sft drawn)`);

  console.log("4. Give me the linear length of each washroom wall");
  out = await say("Give me the linear length of each washroom wall"); L = await items();
  ok(/BATH 1/.test(out) && /6\.000 \+ 8\.000 \+ 6\.000 \+ 8\.000 = 28\.000 ft/.test(out.replace(/,/g, "")) && /BATH 2/.test(out) && /26\.000 ft/.test(out), "each bath's four wall faces and perimeter: 6 + 8 + 6 + 8 = 28 ft, 26 ft");
  ok(/internal face/.test(out) && /shared by two rooms/.test(out), "…said to be the internal faces, with the shared-wall distinction explained");
  ok((await sel()).length === 2, "…and the two bath outlines are selected on the drawing");

  console.log("5. Measure only the internal face of these walls (the selection)");
  const n5 = (await items()).length; out = await say("Measure only the internal face of these walls"); L = await items();
  const faces = L.filter(i => i.cond === "Internal wall face");
  ok(faces.length === 2 && near(faces.reduce((a, i) => a + i.q, 0), 54, 0.05) && L.length === n5 + 2, `two internal-face runs, 28 + 26 = 54 ft (${faces.map(i => i.q).join(" + ")})`);
  await T(() => zdTakeoff.setSel([])); out = await say("Measure only the internal face of these walls");
  ok(/not done/.test(out) && /select the rooms/.test(out), "with nothing selected: not done, it asks for the rooms");

  console.log("6. Count doors and windows separately");
  out = await say("Count doors and windows separately"); L = await items();
  const cnt = nm => L.filter(i => i.cond === nm).reduce((a, i) => a + i.n, 0);
  ok(cnt("Doors") === 8 && cnt("Windows") === 5 && cnt("Ventilators") === 2, `Doors ${cnt("Doors")} (D1 5 + D2 2 + D3 1), Windows ${cnt("Windows")} (W1 4 + W2 1), Ventilators ${cnt("Ventilators")}`);
  // a person's checked count is never touched by a later agent count
  await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Doors"), it = Z.P.proj.items.find(i => i.cond === c.id); it.ai = false; it.qa = "checked"; it.qaBy = "Tester"; });
  out = await say("Count doors and windows separately"); L = await items();
  const doorsIt = L.filter(i => i.cond === "Doors");
  ok(doorsIt.length === 1 && doorsIt[0].qa === "checked" && !doorsIt[0].ai && cnt("Doors") === 8, "counting again leaves the person's checked door count as it is (still checked, not AI, no marks doubled)");

  console.log("7. Measure the slab area and deduct confirmed openings");
  out = await say("Measure the slab area and deduct confirmed openings"); L = await items();
  const slab = L.filter(i => i.cond === "RCC slab" && i.kind === "shape");
  ok(slab.length === 1 && near(slab[0].q, A.W * A.H, 0.5), `slab outline proposed at the outside face of the 9" walls: ${slab.map(i => i.q).join()} Sft (38.625 × 33.25 = ${(A.W * A.H).toFixed(3)})`);
  ok(/no thickness given/.test(out) && /never assumed/.test(out), "no thickness given: the volume is not worked out");
  out = await say("Measure the slab area and deduct confirmed openings"); ok(!(await items()).some((i, j, a) => a.filter(x => x.cond === "RCC slab" && x.kind === "shape").length > 1), "run again: the slab outline already measured is used, not a second one");

  console.log("8. Show rooms with incomplete boundaries");
  await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.label === "KITCHEN"); it.pts = it.pts.map((p, j) => j === 1 ? [p[0] + 50, p[1] - 40] : p); });   // a corner dragged out into free floor
  out = await say("Show rooms with incomplete boundaries");
  ok(/KITCHEN/.test(out) && /incomplete boundary|not a valid boundary/.test(out) && (await sel()).length >= 1, "the kitchen dragged off its walls is listed and selected");
  await T(() => zdTakeoff.undoAny());

  console.log("9. Find duplicate or overlapping wall measurements");
  await T(() => { const Z = zdTakeoff; Z.wallsAgent({t: 0.375, page: true}); const it = Z.P.proj.items.find(i => i.wallAuto); Z.P.proj.items.push(Object.assign(JSON.parse(JSON.stringify(it)), {id: "Idup1", label: "copy of " + it.label})); });
  const n9 = (await items()).length; out = await say("Find duplicate or overlapping wall measurements");
  ok(/Idup1|copy of/.test(out) && /share about/.test(out) && (await items()).length === n9, "the doubled wall run is found and shown — nothing deleted");

  console.log("10. Compare manually measured quantities with AI quantities");
  await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.label === "LIVING"); Z.P.proj.items.push(Object.assign(JSON.parse(JSON.stringify(it)), {id: "Iman", ai: false, label: "LIVING (by hand)", pts: it.pts.map(p => [p[0] + 2, p[1]])})); });
  out = await say("Compare manually measured quantities with AI quantities");
  ok(/Floor area/.test(out) && /agent/.test(out) && /by hand/.test(out) && /LIVING.*vs.*LIVING \(by hand\)/.test(out), "agent vs by-hand totals per condition, and the living measured both ways side by side");

  console.log("11. Show the exact walls included in this quantity");
  await T(() => { const Z = zdTakeoff; Z.setSel([Z.P.proj.items.find(i => i.wallAuto).id]); });
  out = await say("Show the exact walls included in this quantity");
  const wn = await T(() => zdTakeoff.P.proj.items.filter(i => i.wallAuto || i.id === "Idup1").length);
  ok(/Partition wall/.test(out) && (await sel()).length === wn && /legs|×/.test(out), `the condition's runs listed with their figures and all ${wn} selected on the drawing`);

  console.log("12. Recalculate the room after I correct its boundary");
  await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.label === "STORE"), k = Z.scaleAt(it.file, it.page, it.pts[0]); it.pts = it.pts.map(p => p[0] > it.pts.reduce((a, q) => Math.max(a, q[0]), 0) - 1 ? [p[0] - k, p[1]] : p); Z.setSel([it.id]); });   // the store's right side moved in 1 ft
  out = await say("Recalculate the room after I correct its boundary");
  ok(/STORE/.test(out) && /103\.250 Sft/.test(out) && /as detected 117\.250/.test(out), "the store's new area 7.375 × 14 = 103.250 Sft, against 117.250 as detected");

  console.log("13. Undo the last AI measurement");
  const before13 = await items(); out = await say("Undo the last AI measurement"); L = await items();
  ok(/✓ Undo the last AI measurement/.test(out) && L.length < before13.length && L.some(i => i.id === "Iman") && L.some(i => i.id === "Idup1"), "the last agent run is taken back; the measurement made by hand (and the hand-made copy) stay");
  for (let i = 0; i < 12; i++) await T(() => zdTakeoff.undoAgentRun());
  out = await say("Undo the last AI measurement"); ok(/not done/.test(out) && /no agent measurement/.test(out), "nothing left to take back: says so, not done");

  console.log("14. Run a quality check before I export the BOQ");
  out = await say("Run a quality check before I export the BOQ"); ok(/Takeoff check/.test(out) && /to fix/.test(out), "the takeoff check runs (with the export check's notes)");

  console.log("errors are reported, never success");
  out = await say("Sing me a song about the weather"); ok(/did not understand/.test(out) && !/✓/.test(out), "an unknown request: not understood, nothing done");
  let r = await T(() => zdTakeoff.qsExec("fly_to_mars", {}, "tool")); ok(!r.ok && /not a supported command/.test(r.error), "an unknown command: not supported, with the list");
  r = await T(() => zdTakeoff.qsExec("measure_rooms", {names: ["BATH 1"], colour: "red"}, "tool")); ok(!r.ok && /unknown input/.test(r.error), "an input the command does not take: rejected");
  r = await T(() => zdTakeoff.aiRunTool({name: "count_tags", input: {what: "doors", scope: "everywhere"}})); ok(r.err && /must be one of/.test(r.err), "a tool call outside its schema (the Claude route too): rejected");
  await T(() => { const Z = zdTakeoff; Z.P.proj.items.push({id: "Imine", cond: Z.P.proj.conds.find(c => c.type === "area").id, file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[400, 400], [500, 400], [500, 500], [400, 500]], nos: 1, label: "mine"}); });
  r = await T(() => zdTakeoff.qsExec("reject", {ids: ["Imine"]}, "tool")); ok(!r.ok && /made by you/.test(r.error) && await T(() => zdTakeoff.P.proj.items.some(i => i.id === "Imine")), "reject of a person's own measurement: refused, kept");
  r = await T(() => zdTakeoff.aiRunTool({name: "qs_command", input: {action: "measure_rooms", names: ["washroom"], condition: "Bath floor"}}));
  ok(r.ok && r.ok.changed.length === 2 && r.ok.inputs.condition === "Bath floor", "the language models' qs_command: the same command, the same check (2 baths into 'Bath floor')");
  r = await T(() => zdTakeoff.aiRunTool({name: "qs_command", input: {action: "reject", ids: [...zdTakeoff.selIds()]}}));
  const rej = await T(() => (zdTakeoff.P.proj.rejected || []).length); ok(r.ok && rej >= 1, "rejecting agent measurements: out of the takeoff, kept on record (" + rej + ")");
  await T(() => { const Z = zdTakeoff, k = Z.S.key; Z.P.proj.scales[k] = undefined; delete Z.P.proj.scales[k]; });
  r = await T(() => zdTakeoff.qsExec("measure_rooms", {}, "tool")); ok(!r.ok && /no scale/.test(r.error), "a page with no scale: nothing measured, it says why");
  ok(!cloud.length, "nothing sent to any cloud AI service (" + cloud.length + ")");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await b.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

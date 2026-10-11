#!/usr/bin/env node
/* Browser tests for the tools & commands search in the PDF Takeoff's top bar:

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cmdsearch.js [shots-dir]

   The box lists every button of the ribbon (every tab), the View / Export / Costing / AI buttons, the markup tools, the right-click
   commands for what is selected, conditions and pages; it finds them by name, by their tooltip, by a word people use (polyline, erase,
   hatch…) and by AutoCAD alias (tr, f, o…); / goes to it (Ctrl+K: the large window); "/trim" typed in the text search moves there. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", SHOTS = process.argv[2] || "";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1500, height: 940}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const search = async q => { await page.click("#cmdIn"); await page.fill("#cmdIn", q); await wait(120); return T(() => [...document.querySelectorAll("#cmdRes .ci[data-ci]")].map(d => ({t: d.querySelector(".ct").textContent, g: d.querySelector(".cg").textContent}))); };
  const top = async q => (await search(q))[0] || {t: "", g: ""};
  const tool = () => T(() => zdTakeoff.S.tool);

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Command search test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);

  console.log("the box");
  const fb = await page.locator("#findIn").boundingBox(), cb = await page.locator("#cmdIn").boundingBox();
  ok(cb && cb.width >= 120 && cb.x > fb.x + fb.width - 2 && Math.abs(cb.y - fb.y) < 4, "Search tools & commands sits in the top bar, next to the text search");
  const all = await T(() => zdTakeoff.paletteCmds().map(c => c.g + "|" + c.t));
  const has = re => all.some(x => re.test(x));
  ok(all.length >= 200, "it holds every command: " + all.length);
  for (const [re, n] of [[/\|Trim/, "Trim"], [/\|Extend/, "Extend"], [/\|Fillet/, "Fillet"], [/\|Offset/, "Offset"], [/\|Break/, "Break"], [/\|Join/, "Join"], [/\|Explode/, "Explode"], [/\|Match/, "Match"], [/\|Lasso/, "Lasso"],
    [/\|Auto area/, "Auto area"], [/\|Rect/, "Rectangle"], [/\|Count/, "Count"], [/\|Markup: /, "markup tools"], [/^View\|.*Dimmer/, "View tab: Dimmer (data-px)"], [/^View\|.*Minimap/, "View tab: Minimap"], [/PDF Mode/, "PDF Mode"], [/AutoCAD Mode/, "AutoCAD Mode"],
    [/^Export\|/, "Export tab"], [/^Costing\|/, "Costing tab"], [/^Review\|/, "Review tab"], [/^Condition\|Use condition: Floor area/, "conditions"], [/^Page\|Go to: /, "pages"]])
    ok(has(re), "lists " + n);

  console.log("finding");
  let r = await top("trim"); ok(/^Trim/.test(r.t), "“trim” → " + r.t + " (" + r.g + ")");
  await page.keyboard.press("Enter"); await wait(200); ok(await tool() === "trim", "Enter runs it: the Trim tool is on");
  await page.keyboard.press("Escape"); await wait(100);
  r = await top("match"); ok(/Match/.test(r.t), "“match” → " + r.t); await page.keyboard.press("Enter"); await wait(200); ok(await tool() === "match", "… Match is on");
  await page.keyboard.press("Escape"); await wait(100);
  let L = await search("area"); ok(L.some(x => /Rect/.test(x.t)) && L.some(x => /Auto area/.test(x.t)), "“area” finds Rectangle and Auto area (" + L.slice(0, 5).map(x => x.t).join(", ") + ")");
  L = await search("polyline"); ok(L.some(x => /Polyline/i.test(x.t)) && L.some(x => /^Length/.test(x.t)), "“polyline” finds the length tool and the polyline markup");
  L = await search("hatch"); ok(!L.some(x => /Next unchecked/.test(x.t)), "no far-fetched matches (“hatch” is not “Next unchecked”)");
  r = await top("tr"); ok(/^Trim/.test(r.t), "AutoCAD alias “tr” → Trim");
  r = await top("j"); ok(/^Join/.test(r.t), "alias “j” → Join");
  r = await top("x"); ok(/^Explode/.test(r.t), "alias “x” → Explode");
  L = await search("export: excel"); ok(L.length && L.every(x => x.g === "Export"), "“export: excel” only the Export group");
  L = await search("qqzzxxyy"); ok(!L.length && /No tool or command/.test(await T(() => document.getElementById("cmdRes").textContent)), "nothing found: it says so");
  await page.keyboard.press("Escape"); await wait(100);
  ok(!(await T(() => document.getElementById("cmdRes").classList.contains("on"))), "Esc closes the list");

  console.log("keys");
  await page.click("#stage", {position: {x: 30, y: 30}}).catch(() => {}); await page.keyboard.press("Escape"); await wait(100);
  await page.keyboard.press("/"); await wait(150); ok(await T(() => document.activeElement && document.activeElement.id === "cmdIn"), "/ goes to the box");
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+k"); await wait(150); ok(await T(() => document.getElementById("pal") && document.getElementById("pal").classList.contains("on") && document.activeElement.id === "palIn"), "Ctrl+K still opens the large command window");
  await page.keyboard.press("Escape"); await wait(100);
  await page.keyboard.press("Escape"); await page.click("#findIn"); await page.keyboard.type("/join"); await wait(200);
  ok(await T(() => document.activeElement.id === "cmdIn" && document.getElementById("cmdIn").value === "join" && document.getElementById("findIn").value === ""), "“/join” typed in the text search moves to the command search");
  await page.keyboard.press("Escape");

  console.log("what is selected");
  await page.keyboard.press("s"); await page.keyboard.press("r"); await click(300, 300); await click(390, 381); await page.keyboard.press("v"); await wait(150);
  await T(() => { const Z = zdTakeoff; Z.setSel([Z.P.proj.items[0].id]); Z.refresh(); }); await wait(150);
  L = await search("duplicate"); ok(L.some(x => x.g === "Selected"), "with an area selected its right-click commands are there too (" + L.filter(x => x.g === "Selected").map(x => x.t).slice(0, 3).join(", ") + ")");
  L = await search("erase"); ok(L.some(x => /^Delete/.test(x.t)), "“erase” finds Delete (now that something is selected)");
  L = await search("lock"); const lk = L.find(x => x.g === "Selected" && /^Lock/.test(x.t));
  if (lk) { const i = L.indexOf(lk); for (let n = 0; n < i; n++) await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await wait(200); }
  ok(lk && await T(() => !!zdTakeoff.P.proj.items[0].locked), "… and they run: Lock locks the selected area");
  await page.click("#cmdIn"); await page.fill("#cmdIn", ""); await wait(150);
  if (SHOTS) { await page.fill("#cmdIn", "area"); await wait(150); await page.screenshot({path: path.join(SHOTS, "cmdsearch.png")}); }

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

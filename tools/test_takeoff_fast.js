#!/usr/bin/env node
/* Browser tests for the fast-takeoff ribbon (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_fast.js

   The condition button beside the ribbon tabs (name, colour, total) and its list (recent ones, a filter, 1–9, Enter / Esc,
   J opens it, ` goes back to the condition before); Quick items (a preset makes its condition with the type, unit, T,
   faces and deduction threshold the New condition dialog gives it, H asked and never assumed, the same item taken again
   instead of a second copy, several ticked in one undo step, a card's tool button); the Fast takeoff group and the Auto
   takeoff menu; Nos ×N on every new area / run / cut-out (a count stays one a click), *N + Enter for one shape, Set Nos of a
   selection; Enter starts the last tool again; Properties shows the room an Auto area click just traced; the opening
   height kept from page to page; the colourful / classic look (kept over a reload); the command-line aliases rec, w, z, qi;
   one icon per action; My tools filled in one click; the Takeoff tab on one row at 1366 px. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|11436|ERR_FAILED|net::/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, o = {}) => { const p = await scr(x, y); await page.mouse.move(p[0] + (o.dx || 0), p[1] + (o.dy || 0)); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(60); };
  const items = () => T(() => { const Z = zdTakeoff, P = Z.P.proj; return P.items.map(it => ({id: it.id, cond: (P.conds.find(c => c.id === it.cond) || {}).name, kind: it.kind, nos: it.nos, n: (it.pts || []).length, q: Z.qtyOf(it)})); });
  const last = async () => (await items()).slice(-1)[0];
  const condBy = n => T(n => { const c = zdTakeoff.P.proj.conds.find(x => x.name === n); return c ? JSON.parse(JSON.stringify(c)) : null; }, n);
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const tab = () => T(() => (document.querySelector("#tools .rtab.on") || {dataset: {}}).dataset.rtab);
  const card = name => `#qkG [data-qk]:has(.qkt b:text-is(${JSON.stringify(name)}))`;
  const openQuick = async () => { await T(() => { zdTakeoff.quickItemsDialog(); }); await page.waitForSelector("#qkG"); await wait(100); };   // (not awaited: it settles when the dialog closes)

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  console.log("the look");
  ok(await T(() => document.documentElement.getAttribute("data-look")) === "colour", "the page opens in the colourful look (data-look=\"colour\" on <html>)");
  await page.click("#bNewProj"); await page.fill("#dlgName", "Fast takeoff test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await wait(300);

  console.log("ribbon: the Fast takeoff group, one icon per action");
  ok(await tab() === "mine", "the ribbon still opens on My tools");
  ok(await T(() => /Quick items/.test(document.getElementById("rbCondNm").textContent) && document.getElementById("rbCond").offsetParent !== null), "the condition button beside the tabs says to start with Quick items when there is no condition");
  await page.click('[data-rtab="takeoff"]'); await wait(150);
  ok(await T(() => { const g = document.querySelector('.rpanel[data-rp="takeoff"] .rg'); return g && g.dataset.g === "fast" && !!g.querySelector('[data-fn="quick"]') && !!g.querySelector("#rbAuto") && !!g.querySelector("#rbNos"); }), "the Takeoff tab starts with the Fast takeoff group: Quick items, Auto takeoff, Nos");
  ok(await T(() => !!document.querySelector('.rpanel[data-rp="takeoff"] [data-fn="autowin"]') && document.querySelector('[data-fn="autowin"]').closest(".rg").querySelector('[data-tool="auto"]') !== null), "Rooms in box sits beside Auto area");
  ok(await T(() => { const G = zdTakeoff.tbGroups().filter(g => g.panel === "takeoff").map(g => g.id); return G[0] === "takeoff/fast" && G[1] === "takeoff/0" && G.includes("takeoff/5"); }), "Customize keeps the old group keys (Measure is still takeoff/0) — the new group is takeoff/fast");
  ok(await T(() => { const s = new Set([...document.querySelectorAll("#tools svg defs symbol, svg defs symbol")].map(x => x.id)); return [...document.querySelectorAll("#tools use")].every(u => s.has(u.getAttribute("href").slice(1))); }), "every ribbon icon points to a symbol that exists");
  ok(await T(() => { const ic = sel => (document.querySelector(sel + " use") || {getAttribute: () => ""}).getAttribute("href"); const L = ['[data-px="bLegend"]', '[data-px="bProjects"]', '[data-px="vSheet"]', "#bMkList", '[data-px="bZw"]', '[data-rv="unmeasured"]', '[data-tool="vsearch"]', '[data-px="spV"]', '[data-px="spH"]', '[data-rv="typical"]', '[data-px="bSaveProj"]', '[data-rv="checkpage"]', '[data-px="bExport"]', '[data-rv="next"]', '[data-px="bFit"]', '[data-tool="rect"]']; return new Set(L.map(ic)).size === L.length; }), "actions that used to share an icon now each have their own (Legend, Projects, Sheet, Zoom box, Split, Save, Export, Fit page…)");
  ok(await T(() => !document.querySelector('.rpanel[data-rp="takeoff"] .tool') || ![...document.querySelectorAll("#tools .tool")].some(b => /[←-⯿\u{1F300}-\u{1FAFF}]/u.test(b.textContent))), "no Unicode symbols in the new tool labels");

  console.log("Quick items");
  await page.click('[data-fn="quick"]'); await page.waitForSelector("#qkG"); await wait(100);
  ok(await T(() => document.querySelectorAll("#qkG [data-qk]").length === zdTakeoff.PRESETS.length), "the gallery shows every preset");
  ok(await T(() => document.querySelectorAll("#dlgB .qkch").length >= 7), "trades to filter by (Floors, Ceilings, Wall finishes, Masonry, Concrete, Skirting…, Doors…)");
  await page.fill("#qkQ", "tile"); await wait(100);
  const vis = await T(() => [...document.querySelectorAll("#qkG [data-qk]")].filter(x => !x.hidden).map(x => x.querySelector(".qkt b").textContent));
  ok(vis.length >= 3 && vis.every(n => /tile/i.test(n)), "searching “tile” leaves the tile items (" + vis.join(", ") + ")");
  await page.click(card("Floor tile")); await wait(250);
  let c = await condBy("Floor tile");
  ok(!(await dlgOpen()) && c && c.type === "area" && c.unit === "Sft" && c.dedMin === 1 && c.faces === 1 && !c.h, "a click on Floor tile makes it: Area, Sft, openings over 1.00 deducted, no H");
  ok(await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Floor tile"); return Z.S.cond === c.id && Z.S.tool === "draw"; }), "…it is the active condition and its drawing tool is on");
  ok(await T(() => /Floor tile/.test(document.getElementById("rbCondNm").textContent) && !!document.getElementById("rbCondSw").style.background), "the condition button shows Floor tile with its colour");

  await openQuick(); await page.click(card("Wall plaster")); await wait(200);
  ok(await dlgOpen() && /usually 10\.25/.test(await page.getAttribute("#qkF0", "placeholder")), "Wall plaster asks for its height (hint: usually 10.25 ft) — nothing assumed");
  await page.click("#dlgOk"); await wait(100);
  ok(await dlgOpen() && /height H/.test(await page.innerText("#dlgErr")), "no height typed: not created, it asks again");
  await page.fill("#qkF0", "10'-6\""); await page.click("#dlgOk"); await wait(250);
  c = await condBy("Wall plaster");
  ok(c && c.type === "linear" && c.unit === "Sft" && c.h === 10.5 && c.faces === 1 && c.dedMin === 1, "Wall plaster made with H 10.500 ft as typed (10'-6\"): Length × H in Sft");
  const nC = await T(() => zdTakeoff.P.proj.conds.length);
  await openQuick(); await page.click(card("Wall plaster")); await wait(200);
  ok(!(await dlgOpen()) && await T(() => zdTakeoff.P.proj.conds.length) === nC && await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === "Wall plaster", "the same item again takes the one in the project — no second copy, nothing asked");
  await openQuick(); await page.click(card("Floor tile") + ' [data-qkt="rect"]'); await wait(200);
  ok(await T(() => zdTakeoff.S.tool) === "rect" && await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === "Floor tile", "a card's Rect button: Floor tile with the Rect tool");

  const u0 = await T(() => zdTakeoff.S.undo.length);
  await openQuick();
  for (const n of ["Doors", "Windows", 'Brick masonry 9" wall']) await page.check(card(n) + " [data-qkck]");
  ok(/Add ticked \(3\)/.test(await page.innerText("#qkAdd")), "three ticked: “Add ticked (3)”");
  await page.click("#qkAdd"); await wait(200);
  ok(await dlgOpen() && await T(() => document.querySelectorAll("#dlgB [data-qkh]").length === 1), "only the 9\" wall asks for a size (doors and windows need none)");
  await page.fill("#qkF0", "10"); await page.click("#dlgOk"); await wait(250);
  c = await condBy('Brick masonry 9" wall');
  ok(c && c.type === "linear" && c.unit === "cft" && c.t === 0.75 && c.h === 10 && c.dedMin === 1, "9\" wall: Length × H × T in cft, T 0.750 from the preset, H 10 as typed");
  ok((await condBy("Doors")).type === "count" && (await condBy("Windows")).unit === "Nos", "Doors and Windows: counts in Nos");
  ok(await T(() => zdTakeoff.S.undo.length) === u0 + 1 && await T(() => { const L = zdTakeoff.P.proj.conds.map(c => c.color); return new Set(L).size === L.length; }), "added in one undo step, each with its own colour");
  await T(() => zdTakeoff.undoAny()); await wait(150);
  ok(!(await condBy("Doors")) && !(await condBy("Windows")) && !(await condBy('Brick masonry 9" wall')), "one Ctrl+Z takes the three back");
  await T(() => zdTakeoff.redoAny()); await wait(150);
  ok(!!(await condBy("Doors")) && !!(await condBy('Brick masonry 9" wall')), "…and Ctrl+Y puts them back");

  console.log("the condition list beside the tabs");
  await T(() => zdTakeoff.setTool("select")); await page.mouse.click(700, 450); await wait(80);
  await page.keyboard.press("j"); await wait(150);
  ok(await T(() => document.getElementById("condPop").classList.contains("on") && document.activeElement.id === "cpQ"), "J opens the condition list with the cursor in its filter");
  ok(await T(() => [...document.querySelectorAll("#cpL .cpgh")].map(x => x.textContent.split(" ")[0]).join(",")) === "Recent,Area,Length,Count", "recent conditions first, then Area, Length, Count");
  ok(await T(() => { const r = [...document.querySelectorAll("#cpL [data-cpk]")].find(x => x.querySelector(".cpn").textContent === "Floor tile"); return r && /1/.test(r.querySelector("kbd").textContent) && / Sft$/.test(r.querySelector(".cpq").textContent); }), "each row: colour, name, total with its unit, and its 1–9 key");
  await page.keyboard.type("brick"); await wait(100);
  ok(await T(() => document.querySelectorAll("#cpL [data-cpk]").length) === 1, "typing “brick” leaves one row");
  await page.keyboard.press("Enter"); await wait(200);
  ok(await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === 'Brick masonry 9" wall' && await T(() => !document.getElementById("condPop").classList.contains("on")), "Enter picks it and closes the list");
  ok(await T(() => zdTakeoff.S.tool) === "draw", "picked from Select: its drawing tool starts (as the keys 1–9)");
  await page.keyboard.press("Escape"); await page.keyboard.press("`"); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === "Floor tile", "` goes back to the condition used before (Floor tile)");
  await page.keyboard.press("`"); await wait(150);
  ok(await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === 'Brick masonry 9" wall', "` again: back to the 9\" wall");
  await page.click("#rbCond"); await wait(120); await page.keyboard.press("Escape"); await wait(80);
  ok(await T(() => !document.getElementById("condPop").classList.contains("on")), "Esc closes the list");

  console.log("Properties after Auto area");
  await T(() => { const Z = zdTakeoff; Z.S.cond = Z.P.proj.conds.find(x => x.name === "Floor tile").id; Z.setTool("auto"); }); await wait(80);
  const before = await T(() => zdTakeoff.P.proj.items.length);
  await click((G.ax0 + G.ax1) / 2, (G.ay0 + G.ay1) / 2); await page.waitForFunction(() => !zdTakeoff.S.autoBusy, null, {timeout: 20000}); await wait(250);
  const after = await T(() => zdTakeoff.P.proj.items.length);
  ok(after > before && await T(() => { const Z = zdTakeoff, it = Z.P.proj.items[Z.P.proj.items.length - 1]; return Z.S.sel === it.id; }), "Auto area: the room traced is the selection");
  ok(await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.id === Z.S.sel), q = Z.fq(Z.qtyOf(it), "Sft"), big = document.querySelector("#props .pcard .big"); return !!big && big.textContent.replace(/,/g, "").includes(q.replace(/,/g, "")); }), "…and Properties shows that room (its own quantity), not the one before");

  console.log("Nos ×N, *N, Set Nos");
  await T(() => { const Z = zdTakeoff; Z.S.cond = Z.P.proj.conds.find(x => x.name === "Floor tile").id; Z.setTool("rect"); Z.nosSet(3); }); await wait(100);
  ok(await T(() => { const b = document.getElementById("rbNos"); return b.classList.contains("on") && b.querySelector(".tl").textContent === "Nos ×3"; }), "Nos ×3: the ribbon button lights up and reads “Nos ×3”");
  ok(/Nos ×3/.test(await page.innerText("#stHint")), "the status bar says each new measurement gets Nos 3");
  await click(G.ax0, G.ay0, {dx: 3, dy: -2}); await click(G.ax1, G.ay1, {dx: -3, dy: 2});
  let it = await last();
  ok(it.cond === "Floor tile" && it.nos === 3 && near(it.q, 3 * 168, 0.01), "a 12 × 14 room drawn with Nos ×3: Nos 3, 504.00 Sft");
  await T(() => { const Z = zdTakeoff; Z.S.cond = Z.P.proj.conds.find(x => x.name === "Doors").id; Z.setTool("count"); }); await wait(80);
  await click(G.bx0 + 30, G.ay0 + 30);
  it = await last();
  ok(it.cond === "Doors" && (it.nos || 1) === 1 && it.q === 1, "a count stays one a click with Nos ×3 on");
  await T(() => zdTakeoff.nosSet(1)); await wait(60);
  ok(await T(() => !document.getElementById("rbNos").classList.contains("on") && document.querySelector("#rbNos .tl").textContent === "Nos ×1"), "back to Nos ×1");
  await T(() => { const Z = zdTakeoff; Z.S.cond = Z.P.proj.conds.find(x => x.name === "Floor tile").id; Z.setTool("draw"); }); await wait(80);
  for (const [x, y] of [[G.bx0, G.ay0], [G.bx1, G.ay0], [G.bx1, G.ay1], [G.bx0, G.ay1]]) await click(x, y, {dx: 2, dy: -2});   // (snap pulls each click onto the corner)
  await page.keyboard.type("*2"); await wait(60);
  ok(/Nos × 2/.test(await T(() => document.getElementById("stMeas").textContent + " " + (document.getElementById("tip").textContent || ""))), "typing *2 while drawing shows “Nos × 2”");
  await page.keyboard.press("Enter"); await wait(150);
  it = await last();
  ok(it.cond === "Floor tile" && it.nos === 2 && it.n === 4 && near(it.q, 2 * 140, 0.01), "*2 + Enter: the 10 × 14 outline is closed with Nos 2 (" + (it.q || 0).toFixed(2) + " Sft)");
  const one = await T(() => { const Z = zdTakeoff; return Z.nosNew(); });
  ok(one === 1, "the *2 was for that shape only — the next one is Nos 1");
  await T(id => { const Z = zdTakeoff; Z.setTool("select"); Z.setSel([id]); }, it.id); await page.click('[data-rtab="takeoff"]'); await page.click("#rbNos"); await wait(120);
  await page.click('#ctx .ci:has(.ct:text-is("Set Nos of the selection…"))'); await wait(150);
  ok(await dlgOpen() && await page.inputValue("#nosSel") === "2", "Nos ▾ → Set Nos of the selection… opens with its Nos (2)");
  await page.fill("#nosSel", "5"); await page.click("#dlgOk"); await wait(150);
  ok((await last()).nos === 5 && near((await last()).q, 5 * 140, 0.01), "Set Nos 5: the measurement is now Nos 5 (700.00 Sft)");
  const sp = await scr((G.bx0 + G.bx1) / 2, (G.ay0 + G.ay1) / 2 + 1); await T(id => zdTakeoff.setSel([id]), it.id); await page.mouse.click(sp[0], sp[1], {button: "right"}); await wait(150);
  ok(await T(() => [...document.querySelectorAll("#ctx .ci .ct")].some(x => /^Set Nos… \(now 5\)/.test(x.textContent))), "right-click a measurement: “Set Nos… (now 5)”");
  await page.keyboard.press("Escape"); await wait(60);

  console.log("Enter starts the last tool again");
  await T(() => { zdTakeoff.setSel([]); zdTakeoff.setTool("rect"); }); await page.mouse.click(700, 450); await page.keyboard.press("Escape"); await wait(80);
  await T(() => { zdTakeoff.setTool("select"); zdTakeoff.setSel([]); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await page.keyboard.press("Enter"); await wait(120);
  ok(await T(() => zdTakeoff.S.tool) === "rect", "Enter with nothing drawn or selected: Rect again");

  console.log("Auto takeoff menu, opening height");
  await page.click('[data-rtab="takeoff"]'); await page.click("#rbAuto"); await wait(150);
  const menu = await T(() => document.getElementById("ctx").classList.contains("on") ? [...document.querySelectorAll("#ctx .ci .ct")].map(x => x.textContent) : []);
  ok(["Full takeoff", "Rooms in a window", "Trace the whole floor", "Walls", "Block masonry", "Doors / windows", "Finishes", "Check the takeoff"].every(w => menu.some(t => t.startsWith(w))), "Auto takeoff lists the free agents and fast tools (" + menu.length + " items)");
  await page.keyboard.press("Escape"); await wait(80);
  await T(() => { const Z = zdTakeoff; Z.P.proj.last.oh = 7; Z.gotoPage(Z.S.fileId, 2); }); await wait(500);
  ok(await T(() => zdTakeoff.P.proj.last.oh) === 7 && await T(() => zdTakeoff.P.proj.last.page) === 2, "the opening height typed (7 ft) is kept on the next page");
  await T(() => { const Z = zdTakeoff; Z.gotoPage(Z.S.fileId, 1); }); await wait(500);

  console.log("Tool Chest and the block agent take the conditions already there");
  const nTile = () => T(() => zdTakeoff.P.proj.conds.filter(c => c.name === "Floor tile").length);
  await T(() => zdTakeoff.applyChestProfile({kind: "condition", name: "Floor tile", condition: {type: "area", unit: "Sft", color: "#123456", faces: 1, dedMin: 0}})); await wait(100);
  ok(await nTile() === 1 && await T(() => zdTakeoff.P.proj.conds.find(x => x.id === zdTakeoff.S.cond).name) === "Floor tile", "a Tool Chest profile named like a condition in the project takes it — no second Floor tile splitting the totals");
  await T(() => { const Z = zdTakeoff; Z.mutate(() => Z.P.proj.conds.push({id: "Cblk8i", name: 'Block masonry 8"x8"x12" (internal)', type: "linear", unit: "cft", color: "#2a78d6", h: 11.375, t: 0.67, faces: 1, dedMin: 1})); });
  await T(() => zdTakeoff.blockMasonryAgent({floor: 12, slab: 7.5, beamD: 21, beam: {"4": 0, "8i": 0, "8e": 0}, tags: {}, page: true})); await wait(200);
  ok(await T(() => { const L = zdTakeoff.P.proj.conds; return !L.some(c => c.name === 'Block masonry 8"x8"x12"') && L.find(c => c.id === "Cblk8i").blockKey === "8i"; }), "Block masonry takes the preset's “8\"x8\"x12\" (internal)” condition instead of making a second 8\" one");

  console.log("contact");
  ok(await T(() => document.title) === "Sajjad QS PDF TAKEOFF Software" && !/5486522/.test(await page.innerText("header")), "the number is not in the title or on the top bar");
  await page.click("#bContact"); await wait(120);
  ok(await T(() => { const p = document.getElementById("ctPop"); return !!p && p.classList.contains("on") && /03016-5486522/.test(p.textContent) && p.querySelector('a[href="tel:030165486522"]') !== null; }), "the phone button shows the number, with Call and Copy");
  await page.keyboard.press("Escape"); await wait(80);
  ok(await T(() => !document.getElementById("ctPop").classList.contains("on")), "Esc closes it");

  console.log("command line and palette");
  ok(await T(() => /^Rect/.test(zdTakeoff.cmdFind("rec").t)), "rec → Rect (it matched nothing before)");
  ok(await T(() => zdTakeoff.cmdFind("w").t === "Auto area" && zdTakeoff.cmdFind("aa").t === "Auto area"), "w / aa → the Auto area tool (not “every room in a window…”)");
  ok(await T(() => /^Zoom window/.test(zdTakeoff.cmdFind("z").t)), "z → Zoom window (it had no command before)");
  ok(await T(() => /^Quick items/.test(zdTakeoff.cmdFind("qi").t)), "qi → Quick items");
  ok(await T(() => /^tr/i.test(zdTakeoff.cmdFind("tr").t) && /quick select/i.test(zdTakeoff.cmdFind("qs").t)), "the old aliases still work (tr, qs)");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /^Rooms in box/.test(c.t)) && zdTakeoff.paletteCmds().some(c => /^Floors/.test(c.t))), "the ribbon's other buttons are in Ctrl+K too (Rooms in box, Floors)");

  console.log("My tools in one click");
  await T(() => { const o = zdTakeoff.tbPref(); o.mine = []; localStorage.setItem("zdTakeoffTb", JSON.stringify(o)); zdTakeoff.mineSet([]); }); await page.click('[data-rtab="mine"]'); await wait(100);
  ok(await T(() => document.getElementById("mineHint").offsetParent !== null), "an empty My tools tab shows its first-use card");
  await page.click("#bMineStart"); await wait(150);
  ok(await T(() => document.querySelectorAll("#mineBox [data-mine]").length) === await T(() => zdTakeoff.MINE_START.length) && await tab() === "mine", "“add the usual takeoff tools”: My tools gets " + await T(() => zdTakeoff.MINE_START.length) + " tools");
  ok(await T(() => !location.hash), "the link does not navigate");

  console.log("the look");
  await T(() => zdTakeoff.setSave({look: "classic"})); await wait(80);
  ok(await T(() => document.documentElement.getAttribute("data-look")) === "classic", "Settings → Colourful look off: the classic look");
  await page.reload({waitUntil: "load"}); await wait(800);
  ok(await T(() => document.documentElement.getAttribute("data-look")) === "classic", "…kept over a reload (set before the page is drawn)");
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj, null, {timeout: 20000}).catch(() => {});
  await T(() => zdTakeoff.setSave({look: "colour"})); await wait(80);
  ok(await T(() => document.documentElement.getAttribute("data-look")) === "colour", "and back to colour");

  console.log("one row at 1366 px");
  await page.setViewportSize({width: 1366, height: 768}); await wait(300); await page.click('[data-rtab="takeoff"]'); await wait(200);
  const g = await T(() => { const L = [...document.querySelectorAll('.rpanel[data-rp="takeoff"] .tool')].filter(x => x.offsetParent); return {rows: new Set(L.map(x => Math.round(x.getBoundingClientRect().top))).size, h: Math.round(document.getElementById("tools").getBoundingClientRect().height)}; });
  ok(g.rows === 1 && g.h < 130, "the Takeoff tab stays on one row at 1366 × 768 (ribbon " + g.h + " px)");
  await page.setViewportSize({width: 390, height: 844}); await wait(300);
  ok(await T(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), "no sideways scroll at 390 px");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

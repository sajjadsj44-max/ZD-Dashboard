#!/usr/bin/env node
/* Browser tests for the PDF Takeoff's command line, Polygon tool and selection commands (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cmdline.js

   The status bar's command line (aliases, typed numbers, Enter repeats, history, unknown commands, no shortcut leaks), the
   regular Polygon (area and length, against hand-worked geometry), Invert selection (Ctrl+I), Quick select and Deselect. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

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
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const cmd = async q => { await page.click("#cmdLine"); await page.fill("#cmdLine", q); await page.press("#cmdLine", "Enter"); await wait(150); };
  const items = () => T(() => zdTakeoff.P.proj.items.map(i => ({id: i.id, cond: i.cond, pts: i.pts, type: (zdTakeoff.P.proj.conds.find(c => c.id === i.cond) || {}).type})));
  const sel = () => T(() => [...zdTakeoff.selIds()].sort());

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Command line test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  const k = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt);
  ok(near(k, 9), "fixture scale is 9 pt per ft (" + k + ")");
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await page.keyboard.press("s"); await wait(80);   // snap off: free points

  console.log("command line");
  ok(await page.isVisible("#cmdLine"), "the status bar has a command line");
  await cmd("pol 8");
  ok(await T(() => zdTakeoff.S.tool) === "polygon" && await T(() => zdTakeoff.polySides()) === 8, "‘pol 8’ starts Polygon with 8 sides");
  ok(/POL 8 → Polygon with 8 sides/.test(await page.innerText("#cmdSay")), "the command line echoes what ran (" + await page.innerText("#cmdSay") + ")");
  await page.keyboard.press("Escape"); await T(() => zdTakeoff.setTool("select")); await wait(80);
  await cmd("");
  ok(await T(() => zdTakeoff.S.tool) === "polygon", "Enter on an empty line repeats the last command");
  await T(() => zdTakeoff.setTool("select"));
  await cmd("zzqq");
  ok(/Unknown command: zzqq/.test(await page.innerText("#cmdSay")), "an unknown command is said so, nothing runs");
  await page.click("#cmdLine"); await page.keyboard.type("r"); await wait(60);
  ok(await T(() => zdTakeoff.S.tool) === "select" && await page.inputValue("#cmdLine") === "r", "letters typed in the command line never reach the tool shortcuts");
  await page.keyboard.press("ArrowUp"); ok(await page.inputValue("#cmdLine") === "zzqq", "↑ brings back the last line typed");
  await page.keyboard.press("ArrowUp"); ok(await page.inputValue("#cmdLine") === "pol 8", "↑ again: the one before");
  await page.keyboard.press("Escape"); ok(await page.inputValue("#cmdLine") === "" && await T(() => document.activeElement.id) !== "cmdLine", "Esc empties and leaves the command line");
  await page.mouse.move(700, 450); await page.keyboard.press(":"); await wait(60);
  ok(await T(() => document.activeElement.id) === "cmdLine", "‘:’ on the drawing puts the cursor in the command line");
  await page.keyboard.press("Escape");
  ok(await T(() => zdTakeoff.cmdFind("tr").t.toLowerCase().startsWith("trim")), "alias tr → Trim");
  ok(await T(() => /quick select/i.test(zdTakeoff.cmdFind("qs").t)), "alias qs → Quick select");
  ok(await T(() => /invert/i.test(zdTakeoff.cmdFind("inv").t)), "alias inv → Invert selection");

  console.log("polygon (area): hexagon, circumradius 10 ft");
  await cmd("pol 6");
  await click(300, 400); await click(300 + 90, 400); await wait(150);
  let I = await items(); const hex = I[I.length - 1];
  const A = await T(id => { const it = zdTakeoff.P.proj.items.find(i => i.id === id); return zdTakeoff.rowsOf(it, 9).reduce((a, r) => a + r.sign * [r.nos, r.A, r.L, r.W, r.H].filter(v => v != null).reduce((m, v) => m * v, 1), 0); }, hex.id);
  const Aexp = 3 * Math.sqrt(3) / 2 * 100;   // 259.808 Sft
  ok(hex.type === "area" && hex.pts.length === 6, "6 corners, kept as an ordinary area outline");
  const side = Math.hypot(hex.pts[1][0] - hex.pts[0][0], hex.pts[1][1] - hex.pts[0][1]) / 9;
  ok(near(side, 10, 0.001), "each side 10.000 ft (" + side.toFixed(3) + ")");
  const polyA = await T(id => { const P = zdTakeoff.P.proj.items.find(i => i.id === id).pts; let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2 / 81; }, hex.id);
  ok(near(polyA, Aexp, 0.01), "area 259.808 Sft = 3√3/2 × 10² (" + polyA.toFixed(3) + ")");
  ok(near(A, Aexp, 0.01), "the measurement sheet carries 259.808 Sft (" + A.toFixed(3) + ")");
  await T(() => zdTakeoff.undoAny()); await wait(100);
  ok((await items()).length === I.length - 1, "Ctrl+Z takes the polygon back");
  await T(() => zdTakeoff.redoAny()); await wait(100);
  ok((await items()).length === I.length, "Ctrl+Y puts it back");
  await page.keyboard.press("Escape");

  console.log("polygon (length): a square run closes on itself");
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Internal plaster on walls — both faces"}); await page.fill("#cH", "10"); await page.click("#dlgOk"); await wait(250);
  await cmd("pol 4"); await click(600, 400); await click(600 + 45, 400); await wait(150);
  I = await items(); const sq = I[I.length - 1];
  const len = await T(id => { const P = zdTakeoff.P.proj.items.find(i => i.id === id).pts; let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L / 9; }, sq.id);
  ok(sq.type === "linear" && sq.pts.length === 5, "5 points: the run ends where it starts");
  ok(near(len, 4 * 5 * Math.SQRT2, 0.001), "perimeter 28.284 ft = 4 × 5√2 (" + len.toFixed(3) + ")");
  await page.keyboard.press("Escape"); await T(() => zdTakeoff.setTool("select"));

  console.log("selection");
  const all = (await items()).map(i => i.id).sort();
  await T(id => { zdTakeoff.setSel([id]); zdTakeoff.refresh(); }, hex.id);
  await page.mouse.move(700, 450); await page.keyboard.press("Control+i"); await wait(100);
  let s = await sel();
  ok(s.length === all.length - 1 && !s.includes(hex.id), "Ctrl+I inverts the selection (" + s.length + " of " + all.length + ")");
  await T(() => zdTakeoff.invertSel()); s = await sel();
  ok(s.length === 1 && s[0] === hex.id, "inverting again gives the first selection back");
  // quick select through the dialog: kind = Areas
  const qp = T(() => zdTakeoff.quickSelect()); await wait(200);
  await page.selectOption("#tqK", ["area"]); await page.click("#dlgOk"); const hit = await qp;
  ok(hit && hit.length === all.filter(id => true).length - (await items()).filter(i => i.type !== "area").length && hit.includes(hex.id) && !hit.includes(sq.id), "Quick select → Areas picks the area outlines only");
  const qp2 = T(() => zdTakeoff.quickSelect()); await wait(200);
  const plasterId = sq.cond; await page.selectOption("#tqC", [plasterId]); await page.click('input[name=tqHow][value=add]'); await page.click("#dlgOk"); await qp2;
  s = await sel(); ok(s.includes(hex.id) && s.includes(sq.id), "Quick select → Add: the plaster runs join the areas already selected");
  ok(await T(() => !zdTakeoff.qsHit({type: "note"}, {C: new Set(["x"]), K: new Set(), M: new Set(), Q: "", ai: false})), "a condition filter leaves markups out");
  await cmd("deselect all"); ok((await sel()).length === 0, "Deselect all clears the selection");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})();

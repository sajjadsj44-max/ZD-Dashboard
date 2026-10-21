#!/usr/bin/env node
/* Browser tests for PDF Takeoff's Line pick (Shift+A) and the smooth view on a heavy takeoff (takeoff/):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_linepick.js

   A one-page vector PDF written here (SCALE 1/8" = 1'-0", 9 pt per ft): a 20' × 15' slab edge drawn as four separate lines, an
   L-shaped kerb 20' + 10' drawn in pieces with a branch of the same style at a junction, a pipe drawn as one path with another line
   crossing its corner, and a block that is only filled (no line). Line pick: the slab edge in one click as an area (300 Sft); the
   kerb stops at the junction, Shift+click goes on through it (30 ft, two legs: the pieces in line are one leg); the pipe keeps to its
   own path at the corner; a filled-only block is not a line; an open run is not an area; counts go on clicking; the preview before
   the click; Ctrl+Z; the ribbon button, Shift+A and Ctrl+K. Then 3,000 measurements on the page: a wheel zoom and a pan move the
   takeoff as drawn and draw it again when the view is still, a hover glow comes with the cursor, and nothing is lost on the way. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

function makePdf(){
  const L = ["0.6 w", "0 0 0 RG", "0 0 0 rg"], seg = (a, b, c, d) => L.push(`${a} ${b} m ${c} ${d} l S`);
  seg(100, 100, 280, 100); seg(280, 100, 280, 235); seg(280, 235, 100, 235); seg(100, 235, 100, 100);   // slab edge 20' × 15'
  seg(350, 100, 440, 100); seg(440, 100, 530, 100); seg(530, 100, 530, 190);                            // kerb: 10' + 10' in line, then 10' up
  seg(440, 100, 440, 60);                                                                                // a branch at the junction (440, 100)
  L.push("600 300 m 700 300 l 700 400 l 760 400 l S");                                                   // the pipe: one path, 100 + 100 + 60 pt
  seg(700, 300, 700, 250);                                                                               // another line from its corner
  L.push("600 100 50 30 re f");                                                                          // a filled block, no line
  L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/8\" = 1'-0\") Tj ET");
  const content = L.join("\n"), objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

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
  const shot = async n => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, "linepick-" + n + ".png")}); };
  const scr = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y, mods = []) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(60); for (const m of mods) await page.keyboard.down(m); await page.mouse.down(); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await wait(120); };
  const items = () => T(() => zdTakeoff.P.proj.items.map(it => ({id: it.id, cond: (zdTakeoff.P.proj.conds.find(c => c.id === it.cond) || {}).name, n: it.pts.length, qty: zdTakeoff.rowsOf(it, zdTakeoff.qScale(it)).reduce((a, r) => a + r.qty, 0), pts: it.pts})));
  const newCond = async (preset, name) => { await page.click("#bNewCond"); await page.selectOption("#cPre", {label: preset}); if (name) await page.fill("#cName", name); await page.click("#dlgOk"); await wait(250); };

  console.log("a project with the test drawing");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Line pick test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "linepick.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await wait(400);
  ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), 9, 1e-6), "scale read from the note: 9 pt per ft");

  console.log("the tool on the ribbon, Shift+A and Ctrl+K");
  ok(await T(() => !!document.querySelector('[data-rp="takeoff"] [data-tool="linepick"]')), "Line pick sits on the Takeoff tab, next to Length");
  await newCond("Floor area", "Slab edge");
  await page.click("#stage", {position: {x: 5, y: 5}}); await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+A"); await wait();
  ok(await T(() => zdTakeoff.S.tool) === "linepick", "Shift+A starts Line pick");
  ok(await T(() => document.querySelector('[data-tool="linepick"]').classList.contains("on")), "…and its button shows it on");
  await page.keyboard.press("Control+k"); await wait(200); await page.keyboard.type("line pick"); await wait(200);
  ok(await T(() => [...document.querySelectorAll("#pal .pi, #pal [data-i]")].some(e => /Line pick/i.test(e.textContent)) || /Line pick/i.test((document.getElementById("pal") || {}).textContent || "")), "Ctrl+K finds Line pick");
  await page.keyboard.press("Escape"); await wait();
  if (await T(() => zdTakeoff.S.tool) !== "linepick") await T(() => zdTakeoff.setTool("linepick"));

  console.log("a closed outline drawn as four separate lines: one click, one area");
  const p0 = await scr(190, 100); await page.mouse.move(p0[0], p0[1]); await wait(150);
  const pv = await T(() => zdTakeoff.S.lpk && {n: zdTakeoff.S.lpk.pts.length, closed: zdTakeoff.S.lpk.closed});
  ok(pv && pv.closed && pv.n === 4, "before the click the run is shown: closed, 4 corners (" + JSON.stringify(pv) + ")");
  ok(/Line pick: 300\.000 Sft · perimeter 70\.000 ft/.test(await T(() => document.getElementById("stMeas").textContent)), "…with its area and perimeter in the status bar: " + await T(() => document.getElementById("stMeas").textContent));
  await shot("preview");
  await click(190, 100);
  let I = await items();
  ok(I.length === 1 && I[0].cond === "Slab edge" && I[0].n === 4, "one area of 4 corners in Slab edge (" + I.length + " items)");
  ok(I[0] && near(I[0].qty, 300, 0.001), "20' × 15' = 300.000 Sft (" + (I[0] && I[0].qty) + ")");
  ok(await T(() => { const it = zdTakeoff.P.proj.items[0], k = zdTakeoff.qScale(it); return zdTakeoff.rowsOf(it, k)[0].how === "rect"; }), "…on the sheet as L × W (a plain rectangle)");
  await page.keyboard.press("Control+z"); await wait(200);
  ok((await items()).length === 0, "Ctrl+Z takes it back in one step");

  console.log("an open run is not an area");
  await click(395, 100);
  ok((await items()).length === 0, "the kerb (open) does not become an area");
  ok(/do not close round an area/.test(await T(() => document.getElementById("toast").textContent)), "…and says why: " + await T(() => document.getElementById("toast").textContent));

  console.log("a length: pieces in line are one leg, a junction stops it, Shift goes on through");
  await newCond("Custom length", "Kerb"); await T(() => zdTakeoff.setTool("linepick")); await wait();
  await click(395, 100);
  I = await items();
  ok(I.length === 1 && I[0].cond === "Kerb" && near(I[0].qty, 10, 0.001) && I[0].n === 2, "it stops at the junction: 10.000 ft, one leg (" + JSON.stringify(I.map(x => [x.qty, x.n])) + ")");
  await page.keyboard.press("Control+z"); await wait(200);
  await click(395, 100, ["Shift"]);
  I = await items();
  ok(I.length === 1 && near(I[0].qty, 30, 0.001), "Shift+click goes on through it the straightest way: 20' + 10' = 30.000 ft (" + (I[0] && I[0].qty) + ")");
  ok(I[0] && I[0].n === 3, "…two legs: the two pieces in line are one leg (" + (I[0] && I[0].n) + " points)");
  await click(650, 300);
  I = await items();
  const pipe = I[1];
  ok(pipe && near(pipe.qty, 260 / 9, 0.002) && pipe.n === 4, "the pipe keeps to its own drawn path at the corner: 28.889 ft, 3 legs (" + (pipe && [pipe.qty, pipe.n]) + ")");
  const n0 = I.length; await click(625, 115);
  ok((await items()).length === n0, "a block that is only filled is not a line: nothing taken");
  await click(190, 100);
  I = await items();
  ok(I.length === n0 + 1 && I[I.length - 1].n === 5 && near(I[I.length - 1].qty, 70, 0.001), "a closed outline in a length condition is a run round it: 70.000 ft, closed (" + JSON.stringify(I.slice(-1).map(x => [x.qty, x.n])) + ")");

  console.log("counts");
  await newCond("Custom count", "Points"); await T(() => zdTakeoff.setTool("linepick")); await wait();
  ok(await T(() => zdTakeoff.S.tool) === "draw", "Line pick with a count condition goes back to clicking items");

  console.log("3,000 measurements on the page: the view stays live");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, c = {id: "CHEAVY", name: "Heavy", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0}; P.conds.push(c);
    for (let i = 0; i < 3000; i++) { const x = 20 + (i % 75) * 10, y = 300 + Math.floor(i / 75) * 6; P.items.push({id: "H" + i, cond: "CHEAVY", file: Z.S.fileId, page: Z.S.pageNo, kind: "shape", pts: [[x, y], [x + 6, y], [x + 6, y + 4], [x, y + 4]], nos: 1, label: "H" + i}); }
    Z.setTool("select"); Z.refresh(); });
  await wait(800);
  const n1 = await T(() => document.querySelectorAll("#ov polygon").length);
  ok(n1 >= 3000, "all 3,000 drawn (" + n1 + " outlines)");
  const st = await page.locator("#stage").boundingBox();
  await page.mouse.move(st.x + 500, st.y + 400);
  await T(() => { window.__ovB = document.getElementById("ov").innerHTML.length; });
  await page.mouse.wheel(0, -240); await wait(40);
  const mid = await T(() => ({tf: document.getElementById("ov").style.transform, same: document.getElementById("ov").innerHTML.length === window.__ovB}));
  ok(/scale\(/.test(mid.tf) && mid.same, "a wheel zoom moves the takeoff as drawn, not drawn again at once (" + mid.tf + ")");
  await wait(500);
  const after = await T(() => ({tf: document.getElementById("ov").style.transform, vk: document.getElementById("ov").__vk, now: zdTakeoff.S.view.s + "," + zdTakeoff.S.view.tx + "," + zdTakeoff.S.view.ty}));
  ok(!after.tf && after.vk === after.now, "…and drawn again for the new view once it is still");
  ok(await T(() => document.querySelectorAll("#ov polygon").length) >= 3000, "nothing lost on the way");
  await T(() => zdTakeoff.setTool("pan")); await wait(300);
  await page.mouse.move(st.x + 600, st.y + 400); await page.mouse.down(); for (let i = 1; i <= 6; i++) await page.mouse.move(st.x + 600 - i * 15, st.y + 400 - i * 8);
  ok(/translate\(/.test(await T(() => document.getElementById("ov").style.transform)), "a pan moves it the same way");
  await page.mouse.up(); await wait(500);
  ok(!(await T(() => document.getElementById("ov").style.transform)), "…drawn again when the pan stops");
  await T(() => zdTakeoff.setTool("select")); await wait(300);
  await page.keyboard.press("f"); await wait(600);
  const hp = await T(() => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(), it = zdTakeoff.P.proj.items.find(i => i.id === "H1510"); return [r.left + (it.pts[0][0] + 3) * S.view.s + S.view.tx, r.top + (it.pts[0][1] + 2) * S.view.s + S.view.ty]; });
  await page.mouse.move(hp[0] - 1, hp[1]); await wait(100); await page.mouse.move(hp[0], hp[1]); await wait(250);
  const hv = await T(() => ({hover: zdTakeoff.S.hover, glow: [...document.querySelectorAll("#ov2 polygon")].some(p => p.getAttribute("stroke-width") === "9")}));
  ok(hv.hover && hv.glow, "a hover glow comes with the cursor layer (" + hv.hover + ")");
  ok(await T(() => getComputedStyle(document.getElementById("ov")).width) === "1440px", "the takeoff layer is the screen's size, not the window's, so a resize does not lay it out again");

  console.log("layout");
  const g0 = await T(() => ({st: document.getElementById("stage").clientHeight, ov: document.getElementById("ov").getBoundingClientRect().height}));
  await T(() => { document.getElementById("stMeas").innerHTML = "<b>" + "a very long measurement text ".repeat(20) + "</b>"; }); await wait(100);
  const g1 = await T(() => ({st: document.getElementById("stage").clientHeight, ov: document.getElementById("ov").getBoundingClientRect().height}));
  ok(g1.ov === g0.ov, "a status text that wraps the bar (window " + g0.st + " → " + g1.st + " px) leaves the takeoff layer's size as it was (" + g1.ov + " px)");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

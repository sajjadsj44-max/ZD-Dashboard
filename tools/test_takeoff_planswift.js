#!/usr/bin/env node
/* Browser tests for the PDF Takeoff tools learned from PlanSwift: trade starter packs in Quick items, Sheet links (Auto Bookmark),
   My symbols (Auto Count from a kept symbol, at each page's own scale), Areas by hatch pattern (ceilings by their pattern) and
   earthworks — spot levels and Cut / fill. On a 3-page vector PDF written here (no PDF library), every size known exactly.

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_planswift.js       # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) and TK_SHOTS as in tools/test_takeoff.js.

   p.1 A-101, 1/8" = 1'-0" (9 pt per ft): room A 12' × 14' with a 2' × 2' ceiling grid drawn in it, room B 10' × 14' plain,
       3 WC symbols (1.5' × 2'), "SEE A-102" and "3/A-102" (links), "A-103" (no such sheet).
   p.2 A-102, 1/4" = 1'-0" (18 pt per ft): 2 WC symbols — the same 1.5' × 2' on the ground, twice the size on paper; "KEY PLAN — A-101".
   p.3 C-101, 1/16" = 1'-0" (4.5 pt per ft): a 100' × 50' site with its levels written at the corners (NGL 100.00 / 101.00),
       and a plain "12.50" that is not a level. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

/* ------------------------------------------------------------------ the drawing (PDF points, y up) */
const W = 842, H = 595, K1 = 9, K2 = 18, K3 = 4.5;
const G = {ax0: 100, ay0: 300, bx0: 100 + 12.375 * K1};   // room A's inner corner; room B starts after a 4.5" partition
G.ax1 = G.ax0 + 12 * K1; G.ay1 = G.ay0 + 14 * K1; G.bx1 = G.bx0 + 10 * K1;
G.wc1 = [[450, 150], [530, 150], [610, 150]];   // WC symbols on p.1 (their bottom-left corner, pt)
G.wc2 = [[200, 150], [400, 150]];              // on p.2
G.sx0 = 150; G.sy0 = 150; G.sx1 = G.sx0 + 100 * K3; G.sy1 = G.sy0 + 50 * K3;   // the site on p.3
const f = v => v.toFixed(3);
function wc(o, x, y, k){   // a WC: cistern 1.5' × 0.5', bowl an octagon 1.2' × 1.5' below it, a cross in the bowl — size in ft at k pt per ft
  const P = (a, b) => [x + a * k, y + b * k], L = [];
  const seg = (a, b) => L.push(`${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l S`);
  const poly = Q => L.push(Q.map((q, i) => `${f(q[0])} ${f(q[1])} ${i ? "l" : "m"}`).join(" ") + " h S");
  poly([P(0, 1.5), P(1.5, 1.5), P(1.5, 2), P(0, 2)]);
  const cx = 0.75, cy = 0.75, rx = 0.6, ry = 0.75, oc = []; for (let i = 0; i < 8; i++) { const t = (i + 0.5) * Math.PI / 4; oc.push(P(cx + rx * Math.cos(t), cy + ry * Math.sin(t))); } poly(oc);
  seg(P(0.45, 0.75), P(1.05, 0.75)); seg(P(0.75, 0.3), P(0.75, 1.2));
  o.push(...L);
}
function page1(){
  const L = ["0.6 w"], seg = (a, b, c, d) => L.push(`${f(a)} ${f(b)} m ${f(c)} ${f(d)} l S`), rect = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
  rect(G.ax0, G.ay0, G.ax1, G.ay1); rect(G.bx0, G.ay0, G.bx1, G.ay1);                       // the two rooms' inner faces
  rect(G.ax0 - 6.75, G.ay0 - 6.75, G.bx1 + 6.75, G.ay1 + 6.75);                              // the outer wall face (9")
  for (let i = 1; i <= 5; i++) seg(G.ax0 + 2 * i * K1, G.ay0, G.ax0 + 2 * i * K1, G.ay1);   // room A's ceiling grid: 2' × 2'
  for (let j = 1; j <= 6; j++) seg(G.ax0, G.ay0 + 2 * j * K1, G.ax1, G.ay0 + 2 * j * K1);
  G.wc1.forEach(([x, y]) => wc(L, x, y, K1));
  L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/8\" = 1'-0\") Tj ET", "BT /F1 10 Tf 700 60 Td (SHEET NO. A-101) Tj ET", "BT /F1 8 Tf 140 360 Td (BED ROOM) Tj ET", "BT /F1 8 Tf 240 360 Td (STORE) Tj ET",
    "BT /F1 8 Tf 450 260 Td (SEE A-102) Tj ET", "BT /F1 8 Tf 450 240 Td (3/A-102) Tj ET", "BT /F1 8 Tf 450 220 Td (A-103) Tj ET");
  return L.join("\n");
}
function page2(){ const L = ["0.6 w"]; G.wc2.forEach(([x, y]) => wc(L, x, y, K2)); L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/4\" = 1'-0\") Tj ET", "BT /F1 10 Tf 700 60 Td (SHEET NO. A-102) Tj ET", "BT /F1 8 Tf 100 500 Td (KEY PLAN - A-101) Tj ET"); return L.join("\n"); }
function page3(){
  const L = ["0.6 w", `${f(G.sx0)} ${f(G.sy0)} m ${f(G.sx1)} ${f(G.sy0)} l ${f(G.sx1)} ${f(G.sy1)} l ${f(G.sx0)} ${f(G.sy1)} l h S`];
  L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/16\" = 1'-0\") Tj ET", "BT /F1 10 Tf 700 60 Td (SHEET NO. C-101) Tj ET",
    `BT /F1 7 Tf ${f(G.sx0 + 4)} ${f(G.sy0 + 4)} Td (NGL 100.00) Tj ET`, `BT /F1 7 Tf ${f(G.sx1 - 50)} ${f(G.sy0 + 4)} Td (NGL 101.00) Tj ET`,
    `BT /F1 7 Tf ${f(G.sx1 - 50)} ${f(G.sy1 - 10)} Td (NGL 101.00) Tj ET`, `BT /F1 7 Tf ${f(G.sx0 + 4)} ${f(G.sy1 - 10)} Td (NGL 100.00) Tj ET`, "BT /F1 7 Tf 300 450 Td (12.50) Tj ET");
  return L.join("\n");
}
function makePdf(){
  const pages = [page1(), page2(), page3()], objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], kids = [];
  pages.forEach(c => { const pid = objs.length + 1; objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${pid + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(c, "latin1")} >>\nstream\n${c}\nendstream`); kids.push(pid + " 0 R"); });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see tools/test_takeoff.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), Hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: Hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: Hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: Hd});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const scr = async (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0], p[1]); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const dlgWait = async () => { await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}); await wait(120); };
  const dlgGone = () => page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}).catch(() => {});
  const ok1 = async () => { await page.click("#dlgOk"); await wait(200); };
  const cond = name => T(n => { const c = zdTakeoff.P.proj.conds.find(x => x.name === n); return c ? {id: c.id, unit: c.unit, type: c.type, h: c.h, t: c.t, cf: !!c.cfCond, tot: zdTakeoff.condTotals(c).net} : null; }, name);
  const go = async n => { await T(n => { const Z = zdTakeoff; return Z.gotoPage(Z.P.proj.files[0].id, n); }, n); await page.waitForFunction(n => zdTakeoff.S.pageNo === n && zdTakeoff.S.geo[zdTakeoff.S.key], n, {timeout: 20000}); await wait(300); };
  const area = (name, x0, y0, x1, y1, label) => T(([name, x0, y0, x1, y1, label]) => { const Z = zdTakeoff, S = Z.S, H = S.base.height, c = Z.P.proj.conds.find(q => q.name === name);
    Z.mutate(() => { Z.P.proj.items.push({id: "I" + Math.random().toString(36).slice(2), cond: c.id, file: S.fileId, page: S.pageNo, kind: "shape", pts: [[x0, H - y1], [x1, H - y1], [x1, H - y0], [x0, H - y0]], nos: 1, label: label || ""}); }, "test outline"); }, [name, x0, y0, x1, y1, label]);
  const snapOff = async () => { await page.uncheck("#snapOn").catch(() => T(() => { const c = document.getElementById("snapOn"); if (c.checked) c.click(); })); await wait(40); };   // points exactly where clicked
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, "planswift-" + n + ".png")}); } };

  console.log("project and drawing");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "PlanSwift tools"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "planswift-tools.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), K1, 1e-9), "p.1 scale 9 pt per ft from its note");
  for (const [n, k] of [[2, K2], [3, K3]]) { await go(n); ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), k, 1e-9), "p." + n + " scale " + k + " pt per ft from its note"); }
  await go(1);

  console.log("ribbon");
  const rib = await T(() => [['takeoff', 'symbols'], ['review', 'sheetlinks']].map(([t, fn]) => !!document.querySelector('#tools .rpanel[data-rp="' + t + '"] .tool[data-fn="' + fn + '"]')));
  ok(rib.every(Boolean), "My symbols (Takeoff › Count) and Sheet links (Review) are on the ribbon");
  await T(() => document.querySelector('#tools .rtab[data-rtab="takeoff"]').click()); await page.click("#rbAuto"); await wait(150);
  const am = await page.innerText("#ctx"); await page.keyboard.press("Escape"); await wait(80);
  ok(/hatch pattern/.test(am) && /Count my symbols/.test(am) && /spot levels/.test(am) && /cut \/ fill/.test(am), "Auto takeoff lists Ceilings / floors by hatch pattern, Count my symbols and the earthworks");

  console.log("trade starter packs (Quick items)");
  await T(() => { zdTakeoff.quickItemsDialog(); }); await dlgWait();
  const chips = await T(() => [...document.querySelectorAll("#dlgB .qkch")].map(b => b.textContent));
  ok(["Plumbing & sanitary", "Electrical points", "Earthworks"].every(n => chips.includes(n)), "Plumbing & sanitary, Electrical points and Earthworks are trades to filter by");
  await page.click('#dlgB [data-qkall="plumb"]'); await wait(100);
  const nPl = await T(() => document.querySelectorAll('#dlgB [data-qcat="plumb"] [data-qkck]:checked').length);
  ok(nPl === 12, "Tick all on Plumbing ticks its 12 items (" + nPl + ")");
  ok(/Add ticked \(12\)/.test(await page.innerText("#qkAdd")), "…Add ticked (12)");
  await page.click("#qkAdd"); await dlgGone(); await wait(300);
  const pl = await T(() => zdTakeoff.P.proj.conds.filter(c => ["WC — commode", "Wash basin", "Floor trap", "Water supply pipe"].includes(c.name)).map(c => c.name + ":" + c.type + ":" + c.unit));
  ok(pl.length === 4 && pl.includes("WC — commode:count:Nos") && pl.includes("Water supply pipe:linear:ft"), "the plumbing pack made counts in Nos and pipe runs in ft, with no question asked");
  await T(() => { zdTakeoff.quickItemsDialog(); }); await dlgWait();
  await page.click('#dlgB [data-qkall="earth"]'); await wait(100); await page.click("#qkAdd"); await dlgWait();
  const labs = await T(() => [...document.querySelectorAll("#dlgB .qkhr label")].map(l => l.textContent.trim().split(/\s+/)[0] + (/width/i.test(l.textContent) ? " width" : "")));
  ok(labs.includes("Depth") && labs.includes("Trench width"), "earthworks ask Depth and Trench width — in those words");
  const rows = await T(() => [...document.querySelectorAll("#dlgB .qkhr")].map(r => r.querySelector("b").textContent));
  await T(rows => { [...document.querySelectorAll("#dlgB .qkhr")].forEach(r => { const nm = r.querySelector("b").textContent; r.querySelectorAll("input").forEach(i => { i.value = i.hasAttribute("data-qkh") ? "5'-0\"" : /trench/i.test(nm) ? "2'-6\"" : nm.startsWith("Excavation — bulk") ? "12" : "0'-9\""; }); }); }, rows);
  await ok1(); await dlgGone(); await wait(300);
  const tr = await cond("Excavation — foundation trench"), bulk = await cond("Excavation — bulk / basement");
  ok(tr && tr.type === "linear" && tr.unit === "cft" && near(+tr.h, 5) && near(+tr.t, 2.5), "trench: length in cft, depth H 5.000 and width T 2.500 as typed");
  ok(bulk && bulk.type === "area" && near(+bulk.t, 12), "bulk excavation: area × depth 12.000 ft (over the 3 ft a slab may be)");
  await T(() => zdTakeoff.condUse(zdTakeoff.P.proj.conds.find(c => c.name === "Excavation — foundation trench").id)); await wait(100);
  await snapOff();
  await click(100, 100); await click(100 + 10 * K1, 100); await page.keyboard.press("Enter"); await wait(300);
  ok(near((await cond("Excavation — foundation trench")).tot, 125, 1e-6), "a 10 ft trench run = 10 × 2.5 × 5 = 125.000 cft");

  console.log("sheet links (Auto Bookmark)");
  await T(() => { zdTakeoff.sheetLinksMake(); }); await dlgWait();
  ok(/No sheet numbers/.test(await page.innerText("#dlgB")), "no sheet nos. yet: it offers to read the title blocks first");
  await ok1(); await page.waitForFunction(() => /Sheet info from the title blocks/.test(document.getElementById("dlgT").textContent), null, {timeout: 20000}); await wait(200);
  const read = await T(() => [...document.querySelectorAll('#dlgB [data-asf="no"]')].map(i => i.value));
  ok(read.join(",") === "A-101,A-102,C-101", "the title blocks read: " + read.join(", "));
  await ok1(); await page.waitForFunction(() => (zdTakeoff.P.proj.marks || []).some(m => m.subject === "Sheet link"), null, {timeout: 20000}).catch(() => {}); await wait(300);
  const links = await T(() => zdTakeoff.P.proj.marks.filter(m => m.subject === "Sheet link").map(m => ({page: m.page, to: m.link.key.split(":")[1], text: m.text, box: m.pts})));
  ok(links.length === 3, "3 links: SEE A-102 and 3/A-102 on p.1, A-101 on p.2 (" + links.length + ")");
  ok(links.filter(l => l.page === 1).every(l => l.to === "2") && links.filter(l => l.page === 2).every(l => l.to === "1"), "…each to its sheet, none to a sheet's own title block, none for A-103");
  const l1 = links.find(l => l.page === 1);
  ok(l1 && l1.box[0][0] > 440 && l1.box[1][0] < 520 && l1.box[1][1] > l1.box[0][1], "…a box round the written sheet no.");
  await T(() => { zdTakeoff.sheetLinksMake(); }); await wait(1200);
  ok((await T(() => zdTakeoff.P.proj.marks.filter(m => m.subject === "Sheet link").length)) === 3, "run again: made afresh, not doubled");
  await T(() => { const Z = zdTakeoff; Z.followLink(Z.P.proj.marks.find(m => m.subject === "Sheet link" && m.page === 1)); }); await page.waitForFunction(() => zdTakeoff.S.pageNo === 2, null, {timeout: 10000}).catch(() => {});
  ok((await T(() => zdTakeoff.S.pageNo)) === 2, "following a link opens sheet A-102");
  await go(1);

  console.log("areas by hatch pattern");
  if (!(await cond("Floor area"))) { await T(() => { zdTakeoff.quickItemsDialog(); }); await dlgWait(); await page.fill("#qkQ", "floor area"); await wait(100); await page.keyboard.press("Enter"); await dlgGone(); await wait(200); }
  await area("Floor area", G.ax0, G.ay0, G.ax1, G.ay1, "BED ROOM"); await area("Floor area", G.bx0, G.ay0, G.bx1, G.ay1, "STORE"); await wait(200);
  const fa = await cond("Floor area"); ok(fa && near(fa.tot, 168 + 140, 1e-6), "rooms A and B measured: 168 + 140 Sft (" + (fa ? fa.tot : "no Floor area") + ")");
  const sig = await T(() => { const Z = zdTakeoff, S = Z.S, k = S.base && Z.P.proj.scales[S.key].ptPerFt, g = S.geo[S.key], ids = Z.hatchIds(g, k);
    return Z.P.proj.items.filter(i => i.page === S.pageNo && Z.P.proj.conds.find(c => c.id === i.cond).name === "Floor area").map(i => Z.hatchSig(Z.itemPoly(i), g, k, ids).name); });
  ok(sig.includes("Grid 2.00 × 2.00 ft") && sig.includes("No pattern (plain)"), "room A reads as a 2.00 × 2.00 ft grid, room B as plain: " + sig.join(" / "));
  await T(() => { zdTakeoff.hatchSplitDialog(); }); await dlgWait();
  const names = await T(() => [...document.querySelectorAll("#dlgB [data-hsn]")].map(i => i.value));
  ok(names.join("|") === "Ceiling — grid 2.00 × 2.00 ft|Ceiling — plain (no pattern)", "two groups, named for ceilings: " + names.join(" / "));
  await page.selectOption("#hsMode", "floor"); await wait(80);
  ok((await T(() => document.querySelector('#dlgB [data-hsn="0"]').value)) === "Floor finish — grid 2.00 × 2.00 ft", "…for floor finishes the names follow");
  await page.selectOption("#hsMode", "ceil"); await wait(80); await shot("hatch"); await ok1(); await dlgGone(); await wait(300);
  const cg = await cond("Ceiling — grid 2.00 × 2.00 ft"), cp = await cond("Ceiling — plain (no pattern)");
  ok(cg && cp && near(cg.tot, 168, 1e-6) && near(cp.tot, 140, 1e-6), "copied: the grid ceiling 168.000 Sft, the plain one 140.000 Sft (" + (cg && cg.tot) + ", " + (cp && cp.tot) + ")");
  ok(near((await cond("Floor area")).tot, fa ? fa.tot : 308, 1e-6), "…the rooms themselves stay");
  await T(() => { zdTakeoff.hatchSplitDialog(); }); await dlgWait(); await ok1(); await dlgGone(); await wait(300);
  ok(near((await cond("Ceiling — grid 2.00 × 2.00 ft")).tot, 168, 1e-6), "run again: its copies replaced, not doubled");

  console.log("My symbols (Auto Count from a kept symbol)");
  await T(() => zdTakeoff.condUse(zdTakeoff.P.proj.conds.find(c => c.name === "WC — commode").id)); await wait(100);
  await T(() => zdTakeoff.setTool("vsearch")); await wait(80);
  const [sx, sy] = G.wc1[0]; await click(sx - 0.3 * K1, sy - 0.3 * K1); await click(sx + 1.8 * K1, sy + 2.3 * K1); await dlgWait();
  ok(/Keep it in/i.test(await page.innerText("#dlgB")), "Find similar offers to keep the symbol in My symbols");
  await page.check("#vsKeep"); await page.selectOption("#vsWhere", "pdf"); await ok1();
  await page.waitForFunction(() => /Check the matches/.test(document.getElementById("dlgT").textContent) && document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 30000}).catch(() => {});
  const fs1 = await T(() => document.querySelectorAll("#dlgB [data-rvm]").length);
  ok(fs1 === 3, "Find similar (one scale) finds the 3 WCs on p.1 — the boxed one too — not the bigger ones on p.2 (" + fs1 + ")");
  await ok1(); await dlgGone(); await wait(300);
  const kept = await T(() => zdTakeoff.symList().map(s => ({name: s.name, fw: s.fw, fh: s.fh})));
  ok(kept.length === 1 && kept[0].name === "WC — commode", "kept in My symbols as “WC — commode”");
  ok(kept[0] && kept[0].fw > 1.4 && kept[0].fw < 2 && kept[0].fh > 1.8 && kept[0].fh < 2.4, "…at its real size, about 1.5 × 1.94 ft (" + (kept[0] ? kept[0].fw.toFixed(2) + " × " + kept[0].fh.toFixed(2) : "—") + ")");
  ok(near((await cond("WC — commode")).tot, 3, 0), "3 WCs counted on p.1");
  await page.click('#tools .tool[data-fn="symbols"]').catch(async () => { await T(() => { zdTakeoff.symCountDialog(); }); }); await dlgWait();
  if (!/count them all/.test(await page.innerText("#dlgT"))) { await page.keyboard.press("Escape"); await T(() => { zdTakeoff.symCountDialog(); }); await dlgWait(); }
  ok((await T(() => document.querySelectorAll("#dlgB [data-syck]").length)) === 1, "My symbols lists the kept symbol, with its picture");
  await page.selectOption("#syWhere", "pdf"); await ok1();
  await page.waitForFunction(() => /Check the matches/.test(document.getElementById("dlgT").textContent) && document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 40000}).catch(() => {});
  const fs2 = await T(() => [...document.querySelectorAll("#dlgB [data-rvg]")].map(x => x.parentElement.textContent.trim()));
  ok(fs2.length === 1 && /p\.2/.test(fs2[0]) && /\(2\)/.test(fs2[0]), "at each page's own scale it finds the 2 on p.2 — the 3 on p.1 are counted already: " + fs2.join(" / "));
  await ok1(); await dlgGone(); await wait(400);
  ok(near((await cond("WC — commode")).tot, 5, 0), "WC — commode: 5 Nos on the two sheets");
  await T(() => { zdTakeoff.symCountDialog(); }); await dlgWait();
  await page.click('#dlgB [data-syren="0"]'); await dlgWait(); await page.fill("#syNm", "WC (commode)"); await ok1();
  await page.waitForFunction(() => /count them all/.test(document.getElementById("dlgT").textContent), null, {timeout: 5000}).catch(() => {});
  ok((await T(() => zdTakeoff.symList()[0].name)) === "WC (commode)", "a kept symbol is renamed from the list (it then counts into that name)");
  await page.keyboard.press("Escape"); await dlgGone();

  console.log("earthworks: spot levels and cut / fill");
  await go(3);
  await T(() => { zdTakeoff.levelsRead(); }); await dlgWait();
  const lv = await T(() => [...document.querySelectorAll("#dlgB [data-lvck]")].map(c => ({on: c.checked, s: c.closest("label").textContent.trim()})));
  ok(lv.length === 5, "5 figures read as levels: the 4 NGLs and the plain 12.50 (" + lv.length + ")");
  ok(lv.filter(x => x.on).length === 4 && lv.filter(x => !x.on).every(x => /12\.50/.test(x.s)), "…the NGLs ticked, the plain decimal not (it may be a dimension)");
  await page.keyboard.press("Escape"); await dlgGone();
  // the levels clicked in exactly at the site's corners (the written ones sit a little inside them)
  const corners = [[G.sx0, G.sy0, "100.00"], [G.sx1, G.sy0, "101.00"], [G.sx1, G.sy1, "101.00"], [G.sx0, G.sy1, "100.00"]];
  await snapOff();
  await T(() => { zdTakeoff.levelsPlace(); }); await wait(200);
  for (const [x, y, z] of corners) { await click(x, y); await dlgWait(); await page.fill("#lvZ", z); await ok1(); await wait(200); }
  await page.keyboard.press("Escape"); await wait(300);
  const L4 = await T(() => zdTakeoff.lvHere().map(l => l.z));
  ok(L4.length === 4 && L4.join(",") === "100,101,101,100", "4 spot levels clicked in: " + L4.join(", "));
  ok((await T(() => document.querySelectorAll("#ov .splv, .splv").length)) >= 4, "…drawn on the page");
  // the site outline as an area (any area condition)
  await area("Floor area", G.sx0, G.sy0, G.sx1, G.sy1, "SITE"); await wait(200);
  await T(() => { zdTakeoff.cutFillDialog(); }); await wait(400);
  if (!(await dlgOn())) { console.log("    (no dialog — toast: " + (await page.innerText("#toast").catch(() => "")) + " · areas on p.3: " + (await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 3).map(i => i.kind + "/" + i.pts.length).join(" "))) + ")"); }
  await dlgWait();
  await page.fill("#cfF", "100.50"); await wait(200);
  const pv = await page.innerText("#cfR");
  ok(/Cut 625\.000 cft/.test(pv) && /Fill 625\.000 cft/.test(pv), "preview at formation +100.50: cut 625.000, fill 625.000 cft — " + pv.split("\n")[0]);
  await shot("cutfill"); await ok1(); await dlgGone(); await wait(300);
  const cut = await cond("Excavation — cut (spot levels)"), fill = await cond("Earth filling — fill (spot levels)");
  ok(cut && near(cut.tot, 625, 0.01) && cut.unit === "cft" && cut.cf, "Excavation — cut: 625.000 cft (outline 5,000 Sft × its average depth)");
  ok(fill && near(fill.tot, 625, 0.01), "Earth filling — fill: 625.000 cft");
  const rw = await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.cf && Z.P.proj.conds.find(c => c.id === i.cond).name.startsWith("Excavation")), r = Z.rowsOf(it, Z.P.proj.scales[Z.S.key].ptPerFt)[0]; return {L: r.L, W: r.W, H: r.H, A: r.A, qty: r.qty}; });
  ok(near(rw.L * rw.W || rw.A, 5000, 1e-6) && near(rw.H, 0.125, 1e-5), "on the sheet: 100.000 × 50.000 × 0.125 depth (the levels clicked in, so a hair off the corners) (" + [rw.L, rw.W, rw.A, rw.H, rw.qty].join(" / ") + ")");
  const errs = await T(() => zdTakeoff.validate().filter(e => /cut \(spot levels\)|fill \(spot levels\)/.test(e.msg) && e.lvl === "ERROR").map(e => e.msg));
  ok(!errs.length, "Check before export: no ‘thickness T missing’ for the cut / fill (each has its depth) " + errs.join(" "));
  await T(() => { zdTakeoff.cutFillDialog(); }); await dlgWait(); await page.fill("#cfF", "99.00"); await wait(150); await ok1(); await dlgGone(); await wait(300);
  ok(near((await cond("Excavation — cut (spot levels)")).tot, 7500, 0.01) && near((await cond("Earth filling — fill (spot levels)")).tot, 0, 1e-9), "run again at +99.00 on the same outline: replaced — cut 7,500.000, no fill");
  await page.keyboard.press("Control+z"); await wait(300);
  ok(near((await cond("Excavation — cut (spot levels)")).tot, 625, 0.01), "Ctrl+Z takes the run back to the 625.000 cft");

  console.log("saved and read back");
  const back = await T(async () => { const Z = zdTakeoff, js = JSON.parse(JSON.stringify(Z.P.proj)); js.levels.push({id: "bad", file: "x", page: 1, p: ["a", 1], z: 3}); const rep = []; Z.migrate(js, rep); return {n: js.levels.length, rep, dep: js.items.filter(i => +i.dep > 0).length}; }).catch(e => ({err: String(e)}));
  ok(back.n === 4 && back.dep >= 1 && back.rep.some(r => /spot level/.test(r)), "a project file's spot levels are checked: a broken one left out and reported, the depths kept");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

#!/usr/bin/env node
/* Coverage tests for the PDF Takeoff app (takeoff/): Auto area over a window (its second pass over the spaces narrower than
   the door gap, rooms in a viewport at another scale), "What's not measured yet" and room types by contents (roomKind).

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_coverage.js

   TK_LIBS  folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there)
   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/)

   Test PDF (written by hand, so every clear area is known exactly; ARCH D 2592 × 1728 pt, 1 ft = 9 pt on every page):
   p.1  9" double-line walls: rooms A and B 12 × 12 (doors onto a corridor), a 3'-6" corridor running out of the scan
        window, a 3'-6" × 4'-6" WC off it — the WC and corridor are narrower than the 4 ft door gap
   p.2  a viewport at 1/4" (18 pt per ft) holding an 8 × 8 room and a 3 × 3'-6" store; a 10 × 10 room outside it
   p.3  a 28'-6" × 21'-6" plan of six rooms and a store, an 8 × 4 façade recess, a 1'-6" × 2' duct and a door to the outside
   p.4  layers A-WALL, S-RCC, P-SANITARY, A-KITCHEN, A-STAIR, A-RAILING: a kitchen, a bath, a 12 × 12 room with WC lines, a
        stair, a lift in RCC walls, a balcony behind railings, a plain room and a 4 × 5 store
   p.5  empty (no lines) */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }
const near = (a, b, t) => Math.abs(a - b) <= t;
const PW = 2592, PH = 1728, K = 9;

/* a page drawn in ft from an origin: wall(x0, y0, x1, y1) is a wall's outline (its two faces and end caps), line() one line, each on a layer (or none) */
function sheet(ox, oy){
  const L = [], X = v => ox + v * K, Y = v => oy + v * K, pg = {lines: L};
  pg.line = (x0, y0, x1, y1, lay) => L.push([X(x0), Y(y0), X(x1), Y(y1), lay || null]);
  pg.wall = (x0, y0, x1, y1, lay) => { pg.line(x0, y0, x1, y0, lay); pg.line(x1, y0, x1, y1, lay); pg.line(x1, y1, x0, y1, lay); pg.line(x0, y1, x0, y0, lay); };
  pg.box = pg.wall; pg.X = X; pg.Y = Y; return pg;
}
function pdfOf(pages, layers){   // -> Buffer: one content stream per page, its lines grouped by layer (optional content groups)
  const objs = [], np = pages.length, lay = layers || [], ocg0 = 3 + 2 * np, ocg = lay.map((_, i) => ocg0 + i);
  objs.push(`<< /Type /Catalog /Pages 2 0 R${lay.length ? ` /OCProperties << /OCGs [${ocg.map(n => n + " 0 R").join(" ")}] /D << /Order [${ocg.map(n => n + " 0 R").join(" ")}] /ON [${ocg.map(n => n + " 0 R").join(" ")}] >> >>` : ""} >>`);
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => (3 + 2 * i) + " 0 R").join(" ")}] /Count ${np} >>`);
  pages.forEach((p, i) => {
    const groups = new Map(); p.lines.forEach(l => { const k = l[4] || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
    const body = ["0.6 w 1 J 1 j"]; groups.forEach((ls, k) => { const li = lay.indexOf(k); const s = ls.map(l => `${l[0].toFixed(3)} ${(PH - l[1]).toFixed(3)} m ${l[2].toFixed(3)} ${(PH - l[3]).toFixed(3)} l S`).join("\n");
      body.push(li >= 0 ? `/OC /L${li} BDC\n${s}\nEMC` : s); });
    const content = body.join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${4 + 2 * i} 0 R /Resources << ${lay.length ? `/Properties << ${lay.map((_, j) => "/L" + j + " " + ocg[j] + " 0 R").join(" ")} >>` : ""} >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`); });
  lay.forEach(n => objs.push(`<< /Type /OCG /Name (${n}) >>`));
  let out = "%PDF-1.5\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const LAYERS = ["A-WALL", "S-RCC", "P-SANITARY", "A-KITCHEN", "A-STAIR", "A-RAILING"];
// p.1: the window scan (origin 300, 300 pt); the scan window runs -5 .. 32 ft across, -5 .. 28 ft down — the corridor runs on to 40 ft, out of it
const P1 = sheet(300, 300);
P1.wall(0, 0, 26.25, 0.75); P1.wall(0, 0, 0.75, 23); P1.wall(12.75, 0, 13.5, 12.75); P1.wall(25.5, 0, 26.25, 12.75);
P1.wall(0, 12.75, 4, 13.5); P1.wall(7, 12.75, 17, 13.5); P1.wall(20, 12.75, 40.75, 13.5);   // the corridor's top wall: doors 3 ft into A and B
P1.wall(0, 17, 1.25, 17.75); P1.wall(3.75, 17, 40.75, 17.75); P1.wall(40, 12.75, 40.75, 17.75);   // its bottom wall: a 2'-6" door into the WC
P1.wall(4.25, 17.75, 5, 23); P1.wall(0, 22.25, 5, 23);
const WIN1 = [P1.X(-5), P1.Y(-5), P1.X(32), P1.Y(28)];
// p.2: a viewport 1400 .. 2400 × 300 .. 1200 pt at 18 pt per ft; inside it (1 ft = 2 page ft) an 8 × 8 room and a 3 × 3'-6" store; outside it a 10 × 10 room
const P2 = sheet(300, 300), VP = {r: [1400, 300, 2400, 1200], ptPerFt: 18, name: "Detail"};
P2.box(0, 0, 10, 10); P2.box(130, 20, 130 + 16, 20 + 16); P2.box(160, 20, 160 + 6, 20 + 7);
const WIN2 = [P2.X(-5), P2.Y(-5), 2390, 1190];
// p.3: what is not measured (origin 400, 400 pt)
const P3 = sheet(400, 400);
P3.wall(0, 0, 16, 0.75); P3.wall(19, 0, 28.5, 0.75); P3.wall(0, 0, 0.75, 21.5); P3.wall(27.75, 0, 28.5, 21.5);   // a 3 ft door to the outside in the top wall (into R2)
P3.wall(0, 20.75, 14, 21.5); P3.wall(22, 20.75, 28.5, 21.5); P3.wall(13.25, 16.75, 14, 21.5); P3.wall(22, 16.75, 22.75, 21.5); P3.wall(13.25, 16.75, 22.75, 17.5);   // the 8 × 4 recess
P3.wall(0, 10, 28.5, 10.75); P3.wall(13.25, 0, 14, 10.75); P3.wall(13.25, 10, 14, 17.5); P3.wall(22, 0, 22.75, 10.75); P3.wall(22, 10, 22.75, 17.5); P3.wall(22.75, 17.5, 27.75, 18.25);
P3.box(15, 1.5, 16.5, 3.5);   // a 1'-6" × 2' duct in R2 (3 Sft: too small to show)
const R3 = {R1: [0.75, 0.75, 13.25, 10], R2: [14, 0.75, 22, 10], R3: [22.75, 0.75, 27.75, 10], R4: [0.75, 10.75, 13.25, 20.75], R5: [14, 10.75, 22, 16.75], R6: [22.75, 10.75, 27.75, 17.5], ST: [22.75, 18.25, 27.75, 20.75]};
// p.4: rooms by contents (origin 300, 300 pt), each its own box
const P4 = sheet(300, 300), W4 = "A-WALL";
P4.box(0, 0, 10, 10, W4); [[1, 1, 9, 1], [9, 1, 9, 3], [1, 3, 9, 3], [1, 1, 1, 3]].forEach(l => P4.line(...l, "A-KITCHEN")); P4.line(4, 1.5, 5, 1.5, "P-SANITARY");   // kitchen: a counter, a sink line
P4.box(20, 0, 26, 8, W4); [[21, 1, 22.5, 1], [22.5, 1, 22.5, 3.5], [22.5, 3.5, 21, 3.5], [21, 3.5, 21, 1]].forEach(l => P4.line(...l, "P-SANITARY"));   // bath 6 × 8
P4.box(40, 0, 52, 12, W4); [[41, 1, 42.5, 1], [42.5, 1, 42.5, 3.5], [42.5, 3.5, 41, 3.5], [41, 3.5, 41, 1]].forEach(l => P4.line(...l, "P-SANITARY"));   // 12 × 12 with a WC: a room (≥ 120 Sft)
P4.box(0, 20, 8, 36, W4); P4.box(-0.5, 19.5, 8.5, 36.5, W4); for (let i = 1; i <= 10; i++) P4.line(0.5, 21 + i, 7.5, 21 + i, "A-STAIR");   // stair 8 × 16, ten treads
P4.box(20, 20, 26, 26, "S-RCC"); P4.box(19.25, 19.25, 26.75, 26.75, "S-RCC");   // lift: 6 × 6 inside 9" RCC walls
P4.line(40, 20, 50, 20, W4); P4.line(50, 20, 50, 25, "A-RAILING"); P4.line(50, 25, 40, 25, "A-RAILING"); P4.line(40, 25, 40, 20, "A-RAILING");   // balcony 10 × 5: a wall at the back, railings round
P4.box(0, 45, 10, 55, W4); P4.box(10, 45, 14, 50, W4);   // a plain room, beside it a 4 × 5 store
const WIN4 = [P4.X(-5), P4.Y(-5), P4.X(58), P4.Y(58)];
const P5 = sheet(0, 0);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch(), errors = [];
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", d => d.dismiss());
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const go = async p => { await T(p => zdTakeoff.gotoPage(zdTakeoff.P.proj.files[0].id, p), p); await page.waitForFunction(p => zdTakeoff.S.pageNo === p && zdTakeoff.S.geo[zdTakeoff.S.key], p, {timeout: 15000}); await wait(400);
    await T(() => { const S = zdTakeoff.S; zdTakeoff.P.proj.scales[S.key] = {ptPerFt: 9, how: "calibrated", text: "test", verified: true, at: new Date().toISOString()}; }); };
  const scan = w => T(async w => { const r = await zdTakeoff.autoAreaWindow(w); const Z = zdTakeoff, S = Z.S;
    const kOf = p => { const v = ((Z.P.proj.viewports || {})[S.key] || []).find(v => p[0] >= v.r[0] && p[0] <= v.r[2] && p[1] >= v.r[1] && p[1] <= v.r[3]); return v ? v.ptPerFt : Z.P.proj.scales[S.key].ptPerFt; };   // (a viewport's own scale, as the sheet takes it)
    r.items = Z.P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && i.kind === "shape").map(i => ({label: i.label, flag: i.det && i.det.flag || "", a0: i.det && i.det.a0,
      q: Z.rowsOf(i, kOf(i.pts[0])).reduce((a, x) => a + x.qty, 0), box: [Math.min(...i.pts.map(p => p[0])), Math.min(...i.pts.map(p => p[1])), Math.max(...i.pts.map(p => p[0])), Math.max(...i.pts.map(p => p[1]))]})); return r; }, w);
  const inBox = (it, pg, x, y) => it.box[0] <= pg.X(x) && it.box[2] >= pg.X(x) && it.box[1] <= pg.Y(y) && it.box[3] >= pg.Y(y);

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Coverage"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "coverage.pdf", mimeType: "application/pdf", buffer: pdfOf([P1, P2, P3, P4, P5], LAYERS)});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  if (await T(() => document.getElementById("dlgBack").classList.contains("on"))) { await page.keyboard.press("Escape"); await wait(150); }
  await T(() => { const P = zdTakeoff.P.proj; P.conds.push({id: "CF", name: "Floor area", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0}); zdTakeoff.S.cond = "CF"; });

  console.log("\nA. Auto area over a window: the spaces narrower than the door gap (p.1)");
  await go(1);
  let r = await scan(WIN1);
  const its1 = r.items || [], A = its1.find(i => inBox(i, P1, 6, 6)), B = its1.find(i => inBox(i, P1, 19, 6)), C = its1.find(i => inBox(i, P1, 20, 15)), WC = its1.find(i => inBox(i, P1, 2.5, 20));
  ok(!r.err, "the scan ran (" + (r.err || "added " + r.added + ", narrow " + r.narrow + ", open-ended " + r.open + ", skipped " + JSON.stringify(r.skipped) + " / " + JSON.stringify(r.skip2)) + ")");
  ok(A && near(A.q, 144, 1.5) && B && near(B.q, 144, 1.5), "rooms A and B found by the first pass, 144 Sft each (" + (A && A.q.toFixed(2)) + ", " + (B && B.q.toFixed(2)) + ")");
  ok(WC && near(WC.q, 15.75, 0.8), "the 3'-6\" × 4'-6\" WC (narrower than the door gap) found by the second pass: 15.75 Sft (" + (WC ? WC.q.toFixed(2) : "none") + ")");
  ok(C && near(C.q, 31.25 * 3.5, 3), "the corridor open at the window's edge traced up to it: ≈ " + (31.25 * 3.5).toFixed(2) + " Sft (" + (C ? C.q.toFixed(2) : "none") + ")");
  ok(C && /open-ended — check/.test(C.flag) && !(WC && /open-ended/.test(WC.flag)), "the corridor flagged open-ended — check, the WC not (" + (C && C.flag) + ")");
  ok(r.narrow === 2 && r.open === 1, "the result counts 2 narrow spaces, 1 open-ended (" + r.narrow + ", " + r.open + ")");
  ok(its1.length === 4, "nothing else added — not the outside (" + its1.length + " outlines)");

  console.log("\nB. rooms in a viewport at another scale (p.2)");
  await go(2);
  await T(vp => { zdTakeoff.P.proj.viewports = zdTakeoff.P.proj.viewports || {}; zdTakeoff.P.proj.viewports[zdTakeoff.S.key] = [vp]; }, VP);
  r = await scan(WIN2);
  const its2 = r.items || [], RP = its2.find(i => inBox(i, P2, 5, 5)), RV = its2.find(i => inBox(i, P2, 138, 28)), SV = its2.find(i => inBox(i, P2, 163, 23.5));
  ok(RP && near(RP.q, 100, 1), "the room at the page scale: 100 Sft (" + (RP && RP.q.toFixed(2)) + ")");
  ok(RV && near(RV.q, 64, 1) && near(RV.a0, 64, 1), "the 8 × 8 room in the viewport measured at its 1/4\" scale: 64 Sft, a0 " + (RV && RV.a0) + " (" + (RV && RV.q.toFixed(2)) + ")");
  ok(!SV && r.skipped && r.skipped.small >= 1, "the 3 × 3'-6\" store in the viewport (10.5 Sft at its own scale, 42 at the page's) left out as under 12 Sft (" + (SV ? "added " + SV.q.toFixed(2) : "not added") + ", small " + (r.skipped && r.skipped.small) + ")");

  console.log("\nC. What's not measured yet (p.3)");
  await go(3);
  await T(([R, ox, oy]) => { const Z = zdTakeoff, S = Z.S, X = v => ox + v * 9, Y = v => oy + v * 9;
    Z.P.proj.items.push(...["R1", "R3", "R4", "R5", "R6"].map(n => { const b = R[n]; return {id: "U" + n, cond: "CF", file: S.fileId, page: S.pageNo, kind: "shape", nos: 1, label: n, pts: [[X(b[0]), Y(b[1])], [X(b[2]), Y(b[1])], [X(b[2]), Y(b[3])], [X(b[0]), Y(b[3])]]}; })); Z.refresh(); }, [R3, 400, 400]);
  const n0 = await T(() => zdTakeoff.P.proj.items.length);
  r = await T(() => { const r = zdTakeoff.unmToggle(true); return r && !r.err ? {pieces: r.pieces.map(p => ({sft: p.sft, x: p.cx, y: p.cy})), sft: r.sft, other: r.other} : r; });
  const toast = (await page.innerText("#toast").catch(() => "")).replace(/\s+/g, " ");
  const pc = (r && r.pieces) || [], at = (pg, x, y) => pc.find(p => near(p.x, pg.X(x), 6 * K) && near(p.y, pg.Y(y), 6 * K));
  ok(pc.length === 2, "two pieces not measured: room R2 and the store (" + pc.map(p => p.sft.toFixed(1)).join(", ") + (r && r.err ? r.err : "") + ")");
  const p2 = pc.find(p => p.sft > 40), ps = pc.find(p => p.sft < 40);
  ok(p2 && near(p2.sft, 74 - 3, 0.08 * 71), "R2 (8 × 9'-3\" less a 3 Sft duct) ≈ 71 Sft, though it has a door to the outside (" + (p2 && p2.sft.toFixed(2)) + ")");
  ok(ps && near(ps.sft, 12.5, 0.15 * 12.5), "the 5 × 2'-6\" store ≈ 12.5 Sft (" + (ps && ps.sft.toFixed(2)) + ")");
  ok(!pc.some(p => p.sft < 4), "the duct (3 Sft) and the 8 × 4 façade recess are not shown");
  ok(/2 spaces/.test(toast) && /Sft/.test(toast), "the toast gives the count and the Sft total (" + toast.slice(0, 120) + ")");
  await wait(300); ok(await T(() => !!document.querySelector("#stage image.unm, svg image.unm")), "the shading is drawn on the page");
  ok(await T(n => zdTakeoff.P.proj.items.length === n, n0), "showing it changes nothing in the project");
  // a click on the shaded store runs Auto area there
  const st = await T(([x, y]) => { const S = zdTakeoff.S, el = document.getElementById("stage"), b = el.getBoundingClientRect(); zdTakeoff.setTool("select");
    S.view = {s: 1.2, tx: el.clientWidth / 2 - x * 1.2, ty: el.clientHeight / 2 - y * 1.2}; zdTakeoff.applyView(); return [b.left + x * S.view.s + S.view.tx, b.top + y * S.view.s + S.view.ty]; }, [P3.X(25.25), P3.Y(19.5)]);
  await wait(200); await page.mouse.move(st[0], st[1]); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(n => zdTakeoff.P.proj.items.length > n, n0, {timeout: 8000}).catch(() => {});
  await page.waitForFunction(() => !zdTakeoff.S.autoBusy, null, {timeout: 20000}).catch(() => {}); await wait(800);
  const added = await T(n => zdTakeoff.P.proj.items.slice(n).map(i => ({q: zdTakeoff.rowsOf(i, 9).reduce((a, x) => a + x.qty, 0), cond: i.cond})), n0);
  ok(added.length === 1 && near(added[0].q, 12.5, 0.6), "clicking the shaded store ran Auto area there: 12.5 Sft (" + added.map(a => a.q.toFixed(2)).join(", ") + ")");
  const left = await T(() => zdTakeoff.S.unm && zdTakeoff.S.unm.pieces ? zdTakeoff.S.unm.pieces.length : -1);
  ok(left === 1, "the shading follows: one piece left (" + left + ")");
  // Select: a click on something in a shaded space selects it; on a wall line, or a drag, it is no Auto area
  const scr = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, b = document.getElementById("stage").getBoundingClientRect(); return [b.left + x * S.view.s + S.view.tx, b.top + y * S.view.s + S.view.ty]; }, [x, y]);
  await T(([y0, x0, x1]) => { const Z = zdTakeoff, P = Z.P.proj, S = Z.S; P.conds.push({id: "CL", name: "Skirting", type: "linear", unit: "ft", color: "#aa5500", h: "", t: "", faces: 1, dedMin: 0});
    P.items.push({id: "LIN", cond: "CL", file: S.fileId, page: S.pageNo, kind: "shape", nos: 1, label: "run", pts: [[x0, y0], [x1, y0]]}); Z.setSel([]); Z.setTool("select"); Z.refresh(); }, [P3.Y(5), P3.X(16), P3.X(20)]);
  await wait(400);
  const n1 = await T(() => zdTakeoff.P.proj.items.length), clickAt = async q => { await page.mouse.move(q[0], q[1]); await page.mouse.down(); await page.mouse.up(); await wait(900); };
  ok(await T(([x, y]) => zdTakeoff.unmHit([x, y]) > 0, [P3.X(18), P3.Y(5)]), "R2 is shaded where the run lies");
  await clickAt(await scr(P3.X(18), P3.Y(5)));
  ok(await T(n => zdTakeoff.P.proj.items.length === n && zdTakeoff.S.sel === "LIN" && !zdTakeoff.S.autoBusy, n1), "Select: a click on a run inside a shaded space selects it — no Auto area");
  await page.keyboard.press("Escape"); await T(() => zdTakeoff.setSel([]));
  await clickAt(await scr(P3.X(14), P3.Y(5)));
  ok(await T(n => zdTakeoff.P.proj.items.length === n, n1), "a click on the wall line at the shaded room's edge: no Auto area");
  { const a = await scr(P3.X(17), P3.Y(8)); await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[0] + 60, a[1] + 40, {steps: 4}); await page.mouse.up(); await wait(900); }
  ok(await T(n => zdTakeoff.P.proj.items.length === n, n1), "a box dragged from a shaded space selects — no Auto area");
  // the drawing's part is worked out once: a change in the measurements only re-runs the coverage
  const cg = await T(([b, ox, oy]) => { const Z = zdTakeoff, S = Z.S, P = Z.P.proj, X = v => ox + v * 9, Y = v => oy + v * 9, g0 = S.unmGeo, t0 = performance.now(); Z.unmeasured(); const t1 = performance.now() - t0;
    P.items.push({id: "UR2", cond: "CF", file: S.fileId, page: S.pageNo, kind: "shape", nos: 1, label: "R2", pts: [[X(b[0]), Y(b[1])], [X(b[2]), Y(b[1])], [X(b[2]), Y(b[3])], [X(b[0]), Y(b[3])]]});
    const r = Z.unmeasured(), same = S.unmGeo === g0; P.items = P.items.filter(i => i.id !== "UR2" && i.id !== "LIN"); P.conds = P.conds.filter(c => c.id !== "CL"); Z.refresh();
    return {same, cached: !!(g0 && g0.r && !g0.r.err), n: r.pieces ? r.pieces.length : -1, ms: Math.round(t1)}; }, [R3.R2, 400, 400]);
  ok(cg.cached && cg.same && cg.n === 0, "the walls, the outside and the footprints are kept per page: an outline added re-runs only the coverage (R2 measured → nothing left; " + cg.ms + " ms) " + JSON.stringify(cg));
  // no area condition yet: one is made with the outline, never on its own (a trace that does not run leaves none)
  const stray = await T(async () => { const Z = zdTakeoff, P = Z.P.proj, S = Z.S, keep = P.conds, c0 = S.cond; P.conds = P.conds.filter(c => c.type !== "area"); S.cond = null; S.autoBusy = true;
    try { await Z.unmAuto([500, 500]); return P.conds.filter(c => c.type === "area").length; } finally { S.autoBusy = false; P.conds = keep; S.cond = c0; } });
  ok(stray === 0, "Auto area from the shading that does not run: no stray “Floor area” condition (" + stray + ")");
  await T(() => zdTakeoff.unmToggle(false)); await wait(300);
  ok(await T(() => !zdTakeoff.S.unm && !document.querySelector("image.unm")), "toggled off, the shading goes");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /what is not measured yet/i.test(c.t))), "the palette has “Show what is not measured yet”");
  ok(await T(() => !!document.querySelector('[data-rv="unmeasured"]')), "a Not measured button on the Check ribbon");
  await T(() => zdTakeoff.unmToggle(true)); await wait(200);
  await go(5); await wait(700);
  { const st5 = await T(() => ({on: !!zdTakeoff.S.unmOn, btn: !!document.querySelector('[data-rv="unmeasured"].on'), t: document.getElementById("toast").textContent}));
    ok(!st5.on && !st5.btn && /vector lines/.test(st5.t) && /off/.test(st5.t), "on, then to a page with no lines: it says so and turns itself off (" + st5.t.slice(0, 90) + ")"); }
  r = await T(() => { const r = zdTakeoff.unmToggle(true); zdTakeoff.unmToggle(false); return r; });
  ok(r && /vector lines/.test(r.err || ""), "a page with no lines: it says it needs vector lines (" + (r && r.err) + ")");

  console.log("\nD. room types by contents (p.4, layers)");
  await go(4);
  await page.waitForFunction(() => zdTakeoff.S.ocgs && zdTakeoff.S.ocgs[zdTakeoff.S.fileId], null, {timeout: 10000}).catch(() => {});
  await T(() => { const Z = zdTakeoff, S = Z.S; Z.P.proj.items.push({id: "UR3", cond: "CF", file: S.fileId, page: S.pageNo, kind: "shape", nos: 1, label: "Room 3", pts: [[2500, 1600], [2518, 1600], [2518, 1618], [2500, 1618]]}); });
  r = await scan(WIN4);
  ok(!r.err && r.added === 8, "the scan found the eight rooms (" + (r.err || "added " + r.added + ", narrow " + r.narrow + ", skipped " + JSON.stringify(r.skipped) + " / " + JSON.stringify(r.skip2)) + ")");
  const its4 = r.items || [], nm = (x, y) => (its4.find(i => inBox(i, P4, x, y)) || {}).label;
  const want = [["Kitchen 1", 5, 6], ["Bath 1", 24, 6], ["Stair 1", 4, 28], ["Lift/Shaft 1", 23, 23], ["Balcony 1", 45, 22.5], ["Store 1", 12, 47.5]];
  want.forEach(([n, x, y]) => ok(nm(x, y) === n, n.replace(/ 1$/, "") + " named " + n + " (" + nm(x, y) + ")"));
  const rooms = [nm(46, 6), nm(5, 50)];
  ok(rooms.every(n => /^Room [45]$/.test(n)) && rooms[0] !== rooms[1], "the 12 × 12 with WC lines (≥ 120 Sft) and the plain room are Rooms, numbered on from Room 3 (" + rooms.join(", ") + ")");
  const kinds = await T(() => { const Z = zdTakeoff, S = Z.S, it = Z.P.proj.items.find(i => i.page === 1 && i.kind === "shape"); return it ? Z.roomKind(it) : null; });
  ok(kinds === "Room", "a page without layers: Room (" + kinds + ")");
  // the palette command: labels cleared (or Room n) are named again in one step
  const nr = await T(() => { const Z = zdTakeoff, S = Z.S, its = Z.P.proj.items.filter(i => i.file === S.fileId && i.page === S.pageNo && i.kind === "shape" && i.id !== "UR3");
    its.forEach(i => { i.label = /Kitchen/.test(i.label) ? "" : /Bath/.test(i.label) ? "Room 12" : i.label; }); const u0 = S.undo.length; const r = Z.nameRooms();
    return {r, undo: S.undo.length - u0, labels: its.map(i => i.label).sort(), cmd: Z.paletteCmds().some(c => /name rooms by contents/i.test(c.t))}; });
  ok(nr.labels.includes("Kitchen 1") && nr.labels.includes("Bath 1") && nr.undo === 1, "Name rooms by contents: the cleared kitchen and the bath called Room 12 named again, one undo step (" + nr.labels.join(", ") + ")");
  ok(nr.labels.filter(l => /^Room [45]$/.test(l)).length === 2, "rooms already Room n keep their numbers");
  ok(nr.cmd, "the palette has “Name rooms by contents (this page)”");

  ok(errors.length === 0, "no console or page errors" + (errors.length ? " — " + errors.slice(0, 5).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + "/" + (passes + fails) + " passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

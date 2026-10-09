#!/usr/bin/env node
/* Browser tests for the "smart" PDF Takeoff features, on small vector PDFs written here (every dimension known exactly):
     - scale read from the dimension strings (a sheet with no scale note) and shown as not verified
     - sheet type suggested from the sheet (structural), the items it adds, nothing added until confirmed
     - tangent and arc / circle-centre snaps
     - the checker: a wall measured twice, an opening taken off twice, an opening on no run
     - revision diff: the measurement on changed drawing is flagged and joins the review queue; the unchanged one is not
     - PWA: manifest, icons, service worker registered and serving the app files

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<dir with pdfjs-dist/ and exceljs/> node tools/test_takeoff_smart.js
*/
const path = require("path"), fs = require("fs");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.005 : t);

/* a one-page PDF (842 × 595 pt, y up) from a content stream */
function pdf(content){
  const o = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>", `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`];
  let out = "%PDF-1.4\n"; const offs = [];
  o.forEach((x, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${x}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${o.length + 1}\n0000000000 65535 f \n` + offs.map(v => String(v).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${o.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const K = 18;   // 1/4" = 1'-0" → 18 pt per ft
/* a dimension line: line, a tick at each end, the written length over it */
const dim = (x0, x1, y, txt) => [`${x0} ${y} m ${x1} ${y} l S`, `${x0} ${y - 6} m ${x0} ${y + 6} l S`, `${x1} ${y - 6} m ${x1} ${y + 6} l S`, `BT /F1 8 Tf ${(x0 + x1) / 2 - 11} ${y + 3} Td (${txt}) Tj ET`];
const circle = (cx, cy, r) => { const c = 0.5523 * r; return [`${cx + r} ${cy} m`, `${cx + r} ${cy + c} ${cx + c} ${cy + r} ${cx} ${cy + r} c`, `${cx - c} ${cy + r} ${cx - r} ${cy + c} ${cx - r} ${cy} c`, `${cx - r} ${cy - c} ${cx - c} ${cy - r} ${cx} ${cy - r} c`, `${cx + c} ${cy - r} ${cx + r} ${cy - c} ${cx + r} ${cy} c S`]; };
const sheet = (o = {}) => ["0.6 w"].concat(
  dim(100, 100 + 10 * K, 400, "10'-0\""), dim(100, 100 + 12.5 * K, 450, "12'-6\""), dim(100, 100 + 8 * K, 500, "8'-0\""), dim(100, 100 + 15 * K, 350, "15'-0\""),
  circle(600, 300, 30),
  ["100 150 m 400 150 l S", `100 ${o.wall2 || 250} m 400 ${o.wall2 || 250} l S`],
  o.extra ? ["620 450 m 700 450 l 700 490 l 620 490 l 620 450 l S"] : [],
  ["BT /F1 14 Tf 60 540 Td (FOUNDATION PLAN) Tj ET", "BT /F1 8 Tf 560 480 Td (FOOTING F1  RCC  REINFORCEMENT  STIRRUPS) Tj ET", "BT /F1 8 Tf 560 500 Td (COLUMN C1 FOOTING F2) Tj ET"]).join("\n");

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx, null, {sw: false});
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);

  console.log("project with two revisions");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Smart takeoff"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", [{name: "rev-A.pdf", mimeType: "application/pdf", buffer: pdf(sheet())}, {name: "rev-B.pdf", mimeType: "application/pdf", buffer: pdf(sheet({wall2: 262, extra: true}))}]);
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.P.proj.scales[zdTakeoff.S.key], null, {timeout: 25000}).catch(() => {});
  await wait(500);

  console.log("scale from the dimension strings");
  const sc = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key]);
  ok(sc && sc.how === "dims" && near(sc.ptPerFt, 18, 1e-6) && !sc.verified, "no scale note: 4 dimension strings agree → 1/4\" = 1'-0\" (18 pt per ft), not verified (" + JSON.stringify(sc && {how: sc.how, k: sc.ptPerFt, text: sc.text, note: sc.note}) + ")");
  ok(/dimension strings/.test(await page.innerText("#scaleChip")) && /not verified/.test(await page.innerText("#scaleChip")), "scale chip says so");
  const est = await T(() => zdTakeoff.dimEstimates(zdTakeoff.S.texts[zdTakeoff.S.key], zdTakeoff.S.geo[zdTakeoff.S.key]).map(e => +e.ptPerFt.toFixed(3)));
  ok(est.length === 4 && est.every(v => near(v, 18, 0.01)), "4 dimension strings read, each 18.000 pt per ft (" + est.join(", ") + ")");
  const noLine = await T(() => zdTakeoff.dimEstimates([{s: "20'-0\"", x: 500, y: 200, w: 22, h: 8, r: 0}], zdTakeoff.S.geo[zdTakeoff.S.key]).length);
  ok(noLine === 0, "a length written with no dimension line under it is not used");

  console.log("sheet type");
  const hint = await T(() => zdTakeoff.S.typeHint && {d: zdTakeoff.S.typeHint.d, kind: zdTakeoff.S.typeHint.kind});
  ok(hint && hint.d === "Structural", "suggested from the sheet: " + JSON.stringify(hint));
  ok(/Looks like Structural/.test(await page.innerText("#stType")), "status bar offers it");
  ok((await T(() => zdTakeoff.P.proj.conds.length)) === 0, "nothing added before it is confirmed");
  const det = await T(() => { const D = zdTakeoff.detectDrawingType, tx = a => a.map(s => ({s})); return [
    D(tx(["BEDROOM", "KITCHEN", "TOILET", "LOUNGE"]), [], {title: "GROUND FLOOR PLAN", disc: "Architectural"}),
    D(tx(["LIGHTING LAYOUT", "SOCKET", "DB", "MCB", "CONDUIT"]), ["E-LIGHT", "E-POWER"], {title: "LIGHTING LAYOUT"}),
    D(tx(["SCALE 1:100"]), [], {}), D(tx(["BEDROOM", "FOOTING", "SOCKET"]), [], {})].map(r => r && r.d); });
  ok(det[0] === "Architectural" && det[1] === "Electrical" && det[2] === null && det[3] === null, "architectural, electrical; no guess from a bare sheet or from mixed words (" + JSON.stringify(det) + ")");
  await page.click("#stType"); await wait(300);
  ok(/Structural/.test(await page.innerText("#dlgB")) && (await page.locator("#dlgB [data-tc]").count()) >= 4, "dialog lists the structural items");
  await page.click("#dlgOk"); await wait(400);
  const cn = await T(() => zdTakeoff.P.proj.conds.map(c => c.name));
  ok(cn.includes("Columns") && cn.includes("Footings") && cn.includes("RCC slab — state thickness"), "structural items added: " + cn.join(", "));
  ok((await T(() => (zdTakeoff.P.proj.sheets[zdTakeoff.S.key] || {}).disc)) === "Structural" && (await page.innerText("#stType")) === "", "discipline saved; the offer is gone");

  console.log("tangent and centre snaps");
  const sn = await T(() => {
    const Z = zdTakeoff, S = Z.S, g = S.geo[S.key], H = S.base.height, cy = H - 300, cs = Z.curveCentres(g), c = cs.find(o => Math.abs(o.c[0] - 600) < 1 && Math.abs(o.c[1] - cy) < 1);
    // a line from (700, cy) to the circle (600, cy), r = 30: tangent at distance √(100² − 30²) = 95.39; the point of contact
    const p = [700, cy], d = 100, r = 30, ang = Math.acos(r / d), t1 = [600 + r * Math.cos(ang), cy - r * Math.sin(ang)], t2 = [600 + r * Math.cos(ang), cy + r * Math.sin(ang)];
    S.draft = [p]; S.view.s = 1;
    const a = Z.snapAt([t1[0] + 2, t1[1] + 2]), b = Z.snapAt([600 + 3, cy - 2]); S.draft = [];
    return {centres: cs.length, c: !!c, R: c && c.R, tan: a && {type: a.type, d: Math.hypot(a.p[0] - t1[0], a.p[1] - t1[1])}, cen: b && {type: b.type, p: b.p}};
  });
  ok(sn.c && near(sn.R, 30, 0.2), "circle's centre found from its curve pieces (" + sn.centres + " circular curve, R " + (sn.R || 0).toFixed(2) + " pt)");
  ok(sn.tan && sn.tan.type === "tangent" && sn.tan.d < 1.5, "snap near the contact point of a tangent from the last point: " + JSON.stringify(sn.tan));
  ok(sn.cen && sn.cen.type === "centre", "snap near the circle's centre: " + JSON.stringify(sn.cen));

  console.log("checker: walls and openings measured twice");
  const chk = await T(async () => {
    const Z = zdTakeoff, P = Z.P.proj, S = Z.S, H = S.base.height, k = 18, id = n => n + Math.random().toString(36).slice(2, 6);
    const cw = {id: "Cw", name: "Wall test", type: "linear", unit: "Sft", color: "#2a78d6", h: "10", t: "", faces: 1, dedMin: 0};
    P.conds.push(cw);
    const run = (y, x0, x1, label) => ({id: id("I"), cond: "Cw", file: S.fileId, page: S.pageNo, kind: "shape", pts: [[x0, H - y], [x1, H - y]], nos: 1, label});
    const open = (x, y, w, label) => ({id: id("I"), cond: "Cw", file: S.fileId, page: S.pageNo, kind: "open", pts: [[x - w / 2, H - y], [x + w / 2, H - y]], nos: 1, label, oh: 7});
    P.items.push(run(150, 100, 400, "wall 1"), run(150.5, 150, 350, "wall 1 again"), run(250, 100, 400, "wall 2"),
      open(200, 150, 27, "D1"), open(200.5, 150, 27, "D1 again"), open(600, 400, 27, "D9"));
    const r = await Z.agentCheck("page"); return r.findings.map(f => f.text);
  });
  ok(chk.some(t => /wall 1/.test(t) && /on top of each other for about 11\.111 ft/.test(t)), "wall 1 and wall 1 again: overlap of 200 pt = 11.111 ft found");
  ok(!chk.some(t => /wall 2/.test(t) && /on top of each other/.test(t)), "wall 2 (a different line) is not reported");
  ok(chk.some(t => /D1/.test(t) && /taken off twice at the same place/.test(t)), "opening D1 taken off twice is reported");
  ok(chk.some(t => /D9/.test(t) && /on no run of this condition/.test(t)), "opening D9 on no wall run is reported");

  console.log("revision diff");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, S = Z.S, H = S.base.height;
    P.items = P.items.filter(i => i.cond !== "Cw");
    const mk = (y, l) => ({id: "Id" + l, cond: "Cw", file: S.fileId, page: S.pageNo, kind: "shape", pts: [[100, H - y], [400, H - y]], nos: 1, label: l});
    const isB = /rev-B/.test((P.files.find(f => f.id === S.fileId) || {}).name || ""); P.items.push(mk(150, "same wall"), mk(isB ? 262 : 250, "moved wall")); Z.save(); });   // (wall 2 is at 250 pt on rev A, 262 pt on rev B)
  await T(() => document.getElementById("bCompare").click()); await wait(400);
  const hasSel = await page.locator("#cmpSel").count();
  ok(hasSel === 1, "compare dialog open");
  if (hasSel) {
    await page.selectOption("#cmpSel", {index: 0}); await page.click("#dlgOk"); await wait(2000);
    ok(await page.isVisible("#cmpDiff"), "compare legend shows Diff → quantities");
    await page.click("#cmpDiff");
    await page.waitForFunction(() => /Revision diff/.test(document.getElementById("dlgT").textContent), null, {timeout: 20000}).catch(() => {});
    const body = await page.innerText("#dlgB");
    ok(/moved wall/.test(body) && !/same wall/.test(body), "the moved wall is flagged, the unchanged one is not: " + body.replace(/\s+/g, " ").slice(0, 200));
    ok(/changed place/.test(body), "new unmeasured drawing in the other revision is listed");
    await page.click("#dlgOk"); await wait(500);
    const fl = await T(() => zdTakeoff.P.proj.items.filter(i => i.revFlag).map(i => i.label));
    ok(fl.length === 1 && fl[0] === "moved wall", "flagged for review: " + fl.join());
    ok(await T(() => zdTakeoff.P.proj.items.filter(i => i.revFlag && i.qa !== "checked").length === 1), "it is in the review queue until checked");
  }

  console.log("PWA");
  const ctx2 = await browser.newContext({viewport: {width: 1200, height: 800}}); await require("./zd_unlock")(ctx2, null, {sw: true});
  await ctx2.route(/cdn\.jsdelivr\.net|cdnjs|unpkg/, r => r.abort());   // the libraries are not the point here: the app's own files are
  const p2 = await ctx2.newPage(); await p2.goto(URL, {waitUntil: "load"});
  const T2 = fn => p2.evaluate(fn);
  const man = await T2(() => fetch("manifest.webmanifest").then(r => r.json()));
  ok(man.display === "standalone" && man.icons.length >= 2 && /index\.html/.test(man.start_url), "manifest: standalone, icons, start page");
  ok((await T2(() => Promise.all(["icon-192.png", "icon-512.png", "sw.js"].map(u => fetch(u).then(r => r.ok))))).every(Boolean), "icons and service worker are served");
  ok(await T2(() => navigator.serviceWorker.ready.then(r => !!r.active)), "service worker registered and active");
  await p2.reload({waitUntil: "load"}); await p2.waitForTimeout(1200);
  const cached = await T2(async () => { const ks = await caches.keys(), out = []; for (const k of ks) out.push(...(await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname.split("/").pop())); return out; });
  ok(["index.html", "takeoff.js", "manifest.webmanifest"].every(f => cached.includes(f)), "app files cached for offline use: " + [...new Set(cached)].join(", "));
  await ctx2.setOffline(true);
  const off = await p2.reload({waitUntil: "load"}).then(() => true, e => String(e));
  ok(off === true && (await T2(() => document.title)) === "ZD PDF Takeoff", "reload with no network: the app still opens from the cache");
  await ctx2.setOffline(false);

  console.log("no page errors");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})();

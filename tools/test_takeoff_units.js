#!/usr/bin/env node
/* Browser tests for the project's units — feet (ft, Sft, cft) or metres (m, m², m³), changed at any time — on a vector PDF written here.

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_units.js           # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) as in tools/test_takeoff.js.

   p.1 (1/8" = 1'-0", 9 pt per ft): a room 12' × 10' and a wall line 20'-0". Taken off: Floor area over the room (120 Sft), Slab over it
       at T 0.5 (60 cft), Wall plaster along the wall at H 10 (200 Sft), a door counted. Every figure is checked in feet, then in metres
       (each dimension to the mm: 3.658 × 3.048 = 11.150 m², × 0.152 = 1.695 m³, 6.096 × 3.048 = 18.581 m²), then in feet again — the
       measurements themselves never change.
   p.2 (no scale note): calibrated from the 20'-0" line typed as 6096 mm. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

const W = 842, H = 595, K = 9;
function pageOf(n){
  const L = ["0.6 w", "100 300 m 208 300 l 208 390 l 100 390 l h S", "BT /F1 7 Tf 120 345 Td (LOUNGE) Tj ET", "100 150 m 280 150 l S", "BT /F1 7 Tf 160 156 Td (20'-0\") Tj ET"];
  if (n === 1) L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/8\" = 1'-0\") Tj ET");
  return L.join("\n");
}
function makePdf(){
  const pages = [pageOf(1), pageOf(2)], objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], kids = [];
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
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
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
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgOpen = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const go = async n => { await T(n => { const Z = zdTakeoff; return Z.gotoPage(Z.P.proj.files[0].id, n); }, n); await page.waitForFunction(n => zdTakeoff.S.pageNo === n && zdTakeoff.S.geo[zdTakeoff.S.key], n, {timeout: 20000}); await wait(300); };
  const scr = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + (S.base.height - y) * S.view.s + S.view.ty]; }, [x, y]);
  const click = async (x, y) => { const p = await scr(x, y); await page.mouse.move(p[0] + 1, p[1] + 1); await wait(40); await page.mouse.down(); await page.mouse.up(); await wait(80); };
  const txt = sel => page.innerText(sel).catch(() => "");
  const dl = async sel => { await page.click("#bExport"); await wait(); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 20000}), page.click(sel)]); const f = path.join(os.tmpdir(), "tku_" + Date.now() + "_" + d.suggestedFilename()); await d.saveAs(f); await page.keyboard.press("Escape").catch(() => {}); await wait(200); return f; };

  console.log("project, drawing and takeoff (in feet)");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Units test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "units.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), K, 1e-9), "scale 9 pt per ft from the note");
  ok(!(await T(() => zdTakeoff.P.proj.units)) && !(await T(() => zdTakeoff.isM())), "a new project is in feet (the house standard)");
  await T(([H]) => { const Z = zdTakeoff, P = Z.P.proj, f = P.files[0].id, id = () => "I" + Math.random().toString(36).slice(2);
    const c = (name, type, unit, o) => { const x = Object.assign({id: "C" + Math.random().toString(36).slice(2), name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 1}, o || {}); P.conds.push(x); return x; };
    const room = [[100, H - 390], [208, H - 390], [208, H - 300], [100, H - 300]];
    Z.mutate(() => { const a = c("Floor area", "area", "Sft", {rate: 100, src: "Test quote", date: "2026-10-31"}), s = c("Slab", "area", "cft", {t: 0.5, dedMin: 0.5}), w = c("Wall plaster", "linear", "Sft", {h: 10}), d = c("Doors", "count", "Nos");
      P.items.push({id: id(), cond: a.id, file: f, page: 1, kind: "shape", nos: 1, label: "LOUNGE", pts: room.map(p => p.slice())});
      P.items.push({id: id(), cond: s.id, file: f, page: 1, kind: "shape", nos: 1, pts: room.map(p => p.slice())});
      P.items.push({id: id(), cond: w.id, file: f, page: 1, kind: "shape", nos: 1, pts: [[100, H - 150], [280, H - 150]]});
      P.items.push({id: id(), cond: d.id, file: f, page: 1, kind: "shape", nos: 1, pts: [[150, H - 345]]}); }, "Draw"); }, [H]);
  await wait(300);
  const net = n => T(n => zdTakeoff.condTotals(zdTakeoff.P.proj.conds.find(c => c.name === n)).net, n);
  ok(near(await net("Floor area"), 120) && near(await net("Slab"), 60) && near(await net("Wall plaster"), 200) && near(await net("Doors"), 1), "120.000 Sft · 60.000 cft · 200.000 Sft · 1 Nos");
  const conds = () => txt("#condList");
  let cl = await conds();
  ok(/120\.000/.test(cl) && /\bSft\b/.test(cl) && !/m²/.test(cl), "the conditions list in Sft");
  ok(/ft · Sft · cft/.test(await txt("#unitChip")) && await page.isVisible("#unitChip"), "the units chip by the scale reads ft · Sft · cft");
  const sh0 = await txt("#sheet");
  ok(/1 × 12\.000 × 10\.000/.test(sh0) && /120\.000 Sft/.test(sh0), "the sheet: 1 × 12.000 × 10.000 = 120.000 Sft");

  console.log("metres: every figure follows");
  await page.click("#unitChip"); await wait(400);
  ok((await T(() => zdTakeoff.P.proj.units)) === "m" && await T(() => zdTakeoff.isM()), "one click on the chip: the project is in metres");
  ok(/m · m² · m³/.test(await txt("#unitChip")), "the chip reads m · m² · m³");
  ok(await T(() => zdTakeoff.P.proj.items.every(i => i.pts.length)) && near(await T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Wall plaster").h), 10), "the measurements themselves are unchanged (kept in feet)");
  cl = await conds();
  ok(/11\.150/.test(cl) && /m²/.test(cl) && /1\.695/.test(cl) && /m³/.test(cl) && /18\.581/.test(cl) && !/120\.000/.test(cl), "the conditions list: 11.150 m², 1.695 m³, 18.581 m² (Sft and cft gone)");
  const sh1 = await txt("#sheet");
  ok(/1 × 3\.658 × 3\.048/.test(sh1) && /11\.150 m²/.test(sh1) && /\(m²\)/.test(sh1), "the sheet: 1 × 3.658 × 3.048 = 11.150 m² (each dimension to the mm), the condition headed (m²)");
  ok(/1 × 6\.096 × 3\.048/.test(sh1) && /18\.581 m²/.test(sh1) && /1 × 3\.658 × 3\.048 × 0\.152/.test(sh1) && /1\.695 m³/.test(sh1), "…the wall 1 × 6.096 × 3.048 = 18.581 m², the slab × 0.152 = 1.695 m³");
  await T(() => { const Z = zdTakeoff, it = Z.P.proj.items.find(i => i.label === "LOUNGE"); Z.setSel([it.id]); Z.renderProps(); }); await wait(300);
  const ov = await T(() => document.getElementById("ov").textContent);
  ok(/11\.150 m²/.test(ov) && !/120\.000 Sft/.test(ov), "the label on the drawing: 11.150 m²");
  const pr = await txt("#props");
  ok(/11\.150/.test(pr) && /m²/.test(pr) && /3\.658 m|13\.411 m/.test(pr) && !/ Sft/.test(pr), "Properties: 11.150 m², lengths in m");
  ok(/11\.150 m²/.test(await T(() => zdTakeoff.capLines(zdTakeoff.P.proj.items.find(i => i.label === "LOUNGE"), zdTakeoff.P.proj.conds[0], 9, null).join(" "))), "a label with no appearance of its own is in metres too");
  const lg = await T(() => { const Z = zdTakeoff; Z.createLegend(); const m = Z.P.proj.marks.find(x => x.type === "legend"), t = Z.legendSvg0(m, p => p, 1).replace(/<[^>]+>/g, " "); Z.undoAny(); return t; }); await wait(200);
  ok(/11\.150/.test(lg) && /m²/.test(lg) && /m³/.test(lg) && !/\bSft\b/.test(lg), "the legend placed on the drawing: 11.150 m², m³ — no Sft");
  const dimTxt = () => T(() => { const Z = zdTakeoff, m = {id: "Mdim", type: "dimension", file: Z.P.proj.files[0].id, page: 1, pts: [[100, 445], [280, 445]], color: "#2b7de9", width: 1, size: 13, arrow: 10, offset: 24}; return Z.markSvg(m, p => p, 1).replace(/<[^>]+>/g, " "); });
  ok(/6096 mm/.test(await dimTxt()), "a dimension line on the 20'-0\" wall reads 6096 mm (as metric drawings are dimensioned)");
  const cr = await T(() => document.getElementById("scaleChip").textContent + " | " + document.getElementById("scaleChip").title);
  ok(/1:96/.test(cr) && /1" = 8'/.test(cr), "the scale read both ways on the chip: ≈ 1:96 · 1\" = 8'");

  console.log("typed in metres");
  ok(await T(() => { const u = zdTakeoff.uParse; return Math.abs(u("3") - 3 / 0.3048) < 1e-9 && Math.abs(u("230 mm") - 230 / 304.8) < 1e-9 && Math.abs(u("10'-6\"") - 10.5) < 1e-9 && Math.abs(u("3.05m") - 3.05 / 0.3048) < 1e-9; }), "a bare number is metres; 230 mm, 3.05 m and 10'-6\" keep their own unit");
  const wallC = () => T(() => zdTakeoff.P.proj.conds.find(c => c.name === "Wall plaster"));
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.name === "Wall plaster")); }); await wait(400);
  ok(await page.inputValue("#cH") === "3.048" && /m²/.test(await T(() => document.getElementById("cUnit").selectedOptions[0].textContent)) && await T(() => document.getElementById("cUnit").value) === "Sft", "the condition: H 3.048 (m), the unit shown m² (kept as Sft)");
  await page.click("#dlgOk"); await wait(300);
  ok((await wallC()).h === 10, "saved as it was shown: H stays exactly 10 ft (no rounding through metres)");
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.name === "Wall plaster")); }); await wait(400);
  await page.fill("#cH", "3"); await page.click("#dlgOk"); await wait(300);
  ok(near((await wallC()).h, 3 / 0.3048, 1e-9) && near(await net("Wall plaster") * 0.09290304, 6.096 * 3, 1e-9), "H typed 3 → 3 m (9.843 ft); the wall 6.096 × 3.000 = 18.288 m² exactly");
  ok(/18\.288/.test(await conds()), "…and the list reads 18.288 m²");
  await T(() => { zdTakeoff.editCond(zdTakeoff.P.proj.conds.find(c => c.name === "Wall plaster")); }); await wait(400);
  await page.fill("#cH", "10'-0\""); await page.click("#dlgOk"); await wait(300);
  ok(near((await wallC()).h, 10), "H typed in ft-in (10'-0\") is still read as feet");

  console.log("calibrate in mm (p.2, no scale note)");
  await go(2);
  ok(!(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key])), "p.2 has no scale");
  await page.keyboard.press("k"); await click(100, 150); await click(280, 150); await wait(300);
  ok(await dlgOpen() && await page.inputValue("#dlgLenU") === "mm", "calibrate asks for the real length — in mm (the project is in metres)");
  await page.fill("#dlgLen", "6096"); await page.click("#dlgOk"); await wait(300);
  const sc2 = await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key]);
  ok(sc2 && near(sc2.ptPerFt, 9, 0.05) && /6096 mm over/.test(sc2.text), "6096 mm over the 20'-0\" line → 9 pt per ft (" + (sc2 && sc2.text) + ")");
  ok(/1 m = /.test(await txt("#scaleChip")), "the chip gives the scale per metre");
  await page.keyboard.press("k"); await click(100, 150); await click(280, 150); await wait(300);
  await T(() => { document.getElementById("dlgLenU").value = "ft"; }); await page.fill("#dlgLen", "20"); await page.click("#dlgOk"); await wait(300);
  ok(near((await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key])).ptPerFt, 9, 0.05), "…or in ft, chosen beside the box (20 ft)");
  await go(1);

  console.log("exports, report and bill in metres");
  const ExcelJS = require(path.join(LIBS, "exceljs"));
  const xf = await dl("#exXls"); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf);
  const ms = wb.getWorksheet("Measurement"), rowsX = [];
  ms.eachRow((r, n) => rowsX.push({n, v: r.values}));
  const cellv = v => v && typeof v === "object" && "result" in v ? v.result : v;
  ok(/metres/.test(String(ms.getCell("A2").value)) && /L \(m\)/.test(String(ms.getRow(4).getCell(5).value)), "Excel: the sheet says metres, L (m)");
  const lr = rowsX.find(r => /LOUNGE/.test(String(r.v[2] || "")));
  ok(lr && near(+lr.v[5], 3.658, 1e-9) && near(+lr.v[6], 3.048, 1e-9) && near(cellv(lr.v[8]), 3.658 * 3.048, 1e-9) && lr.v[9] === "m²" && /PRODUCT/.test(lr.v[8].formula), "…the room 3.658 × 3.048 m = 11.150 m², a live PRODUCT");
  const sm = wb.getWorksheet("Summary"), sr = []; sm.eachRow(r => sr.push(r.values));
  const fa = sr.find(r => r[1] === "Floor area");
  ok(fa && near(cellv(fa[2]), 3.658 * 3.048, 1e-9) && fa[3] === "m²", "…Summary: Floor area 11.150 m²");
  const bl = wb.getWorksheet("Bill"), br = []; bl.eachRow(r => br.push(r.values));
  const fb = br.find(r => r[3] === "Floor area");
  ok(fb && near(+fb[5], 3.658 * 3.048, 1e-6) && fb[6] === "m²" && near(+fb[7], 100 / 0.09290304, 1e-4) && near(cellv(fb[8]), 3.658 * 3.048 * 100 / 0.09290304, 1e-6), "…Bill: 11.150 m² at PKR 1,076.39 per m² = 12,001.31 (the rate per Sft read per m²)");
  const cf = fs.readFileSync(await dl("#exCsv"), "utf8");
  ok(/L \(m\) \/ Area \(m²\)/.test(cf) && /11\.150,m²/.test(cf) && /3\.658,3\.048/.test(cf), "CSV: L (m) / Area (m²), 3.658, 3.048 → 11.150 m²");
  const R = await T(() => { const R = zdTakeoff.reportBuild({grp: "cond", rows: "items", cols: ["cond", "qty", "unit", "rate", "amt"]}); const g = R.groups.find(g => /Floor area/.test(g.name)); return {name: g.name, unit: g.unit, qty: g.qty, amt: g.amt, rate: g.rows[0].rate}; });
  ok(/\(m²\)/.test(R.name) && R.unit === "m²" && near(R.qty, 3.658 * 3.048, 1e-9) && near(R.rate, 100 / 0.09290304, 1e-6) && near(R.amt, 3.658 * 3.048 * 100 / 0.09290304, 1e-6), "Report: Floor area (m²) 11.150 at 1,076.39 per m² = 12,001.31");
  await page.click("#vBill"); await wait(300);
  const bt = await txt("#bill");
  ok(/11\.150/.test(bt) && /m²/.test(bt) && /1,076\.39/.test(bt) && /12,001\.31/.test(bt), "the bill: 11.150 m² · rate 1,076.39 · amount 12,001.31");
  await page.click("#vSheet"); await wait(200);
  ok(/UNITS: this project is read in metres/.test(await T(() => zdTakeoff.rulesPrompt())), "the AI is told to answer in metres (its tools stay in feet)");

  console.log("back to feet — any time, nothing lost");
  await T(() => zdTakeoff.setUnits("ft")); await wait(300);
  cl = await conds();
  ok(!(await T(() => zdTakeoff.isM())) && /120\.000/.test(cl) && /Sft/.test(cl) && !/m²/.test(cl), "back in feet: 120.000 Sft again");
  ok(/20\.000/.test(await dimTxt()) && !/mm/.test(await dimTxt()), "…and 20.000 again in feet");
  ok(/1 × 12\.000 × 10\.000/.test(await txt("#sheet")) && (await wallC()).h === 10, "the sheet in feet again; H still exactly 10 ft");
  await T(() => zdTakeoff.setUnits("m")); await wait(200);
  await T(() => zdTakeoff.undoAny()); await wait(300);
  ok(!(await T(() => zdTakeoff.isM())), "Ctrl+Z takes a change of units back");
  ok((await T(() => zdTakeoff.paletteCmds().map(x => x.t).join("|"))).includes("Units: metres"), "the palette has Units: metres / feet");
  await T(() => zdTakeoff.setUnits("m")); await wait(200);
  await T(() => { document.getElementById("bNewProj").click(); }); await wait(400);
  if (await dlgOpen()) { await page.fill("#dlgName", "Second"); await page.click("#dlgOk"); await wait(600); }
  ok(await T(() => zdTakeoff.isM() && zdTakeoff.P.proj.name === "Second"), "a new project takes the units chosen last (metres)");
  await T(() => zdTakeoff.setUnits("ft")); await wait(200);

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Verification status, the wall-by-wall segment table, the written-size check and the scale offered by a merge import.
   A one-page drawing at 18 pt / ft; measurements pushed in as a traced takeoff would bring them.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_verify.js     (pdfjs-dist, exceljs) */
const path = require("path"), os = require("os"), fs = require("fs");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {pdfFrom} = require("./takeoff_qa_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const K = 18, OX = 100, H = 595, L = [], P = (x, y) => [(OX + x * K).toFixed(3), (H - (OX + y * K)).toFixed(3)];
const seg = (x0, y0, x1, y1) => L.push(`${P(x0, y0).join(" ")} m ${P(x1, y1).join(" ")} l S`);
const rect = (x0, y0, x1, y1) => { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); };
rect(0, 0, 9, 5); rect(12, 0, 20.25, 5); rect(0, 8, 11.333, 20.75);
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "exceljs"))) { console.log("TK_LIBS must hold pdfjs-dist and exceljs — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: hd});
    return r.abort(); });
  const page = await ctx.newPage(); page.on("pageerror", e => ok(false, "page error: " + e)); page.on("dialog", d => d.dismiss());
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "verify"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "verify.pdf", mimeType: "application/pdf", buffer: pdfFrom([{w: 842, h: 595, content: ["0.6 w"].concat(L).join("\n")}])});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const Z = zdTakeoff, pr = Z.P.proj, f = Z.S.fileId, k = 18, X = x => 100 + x * k, Y = y => 595 - (100 + y * k), pt = (x, y) => [X(x), Y(y)];
    pr.scales[Z.S.key] = {ptPerFt: 18, how: "calibrated", text: "test", verified: true};
    pr.conds.push({id: "CA", name: "Washroom floor", type: "area", unit: "Sft", color: "#2563eb"}, {id: "CL", name: "Washroom walls", type: "linear", unit: "ft", color: "#0891b2"});
    const at = new Date().toISOString(), it = (id, cond, pts, label, st, extra) => Object.assign({id, cond, file: f, page: 1, kind: "shape", pts, nos: 1, label, ver: st ? {st, note: "test", by: "", at} : undefined}, extra || {});
    pr.items.push(
      it("A1", "CA", [pt(0, 5), pt(9, 5), pt(9, 0), pt(0, 0)], "BATH 9'-0\"x5'-0\"", "dims", {det: {how: "trace", src: "PDF vector lines", gap: 8.6, note: "", at, pts0: [pt(0, 5), pt(9, 5), pt(9, 0), pt(0, 0)]}}),
      it("A2", "CA", [pt(12, 5), pt(20.25, 5), pt(20.25, 0), pt(12, 0)], "BATH 8'-0\"x5'-0\"", "auto"),
      it("A3", "CA", [pt(0, 20.75), pt(11.333, 20.75), pt(11.333, 12), pt(16.333, 12), pt(16.333, 8), pt(0, 8)], "BED ROOM 11'-4\"x12'-9\"", "walls"),
      it("A4", "CA", [pt(22, 5), pt(40, 5), pt(40, 0), pt(22, 0)], "LOUNGE DINING + KITCHEN 16'-6\"x11'-6\"", "walls"),
      it("A5", "CA", [pt(2, 3), pt(3, 3), pt(3, 2), pt(2, 2)], "column in the bath", "dims", {kind: "ded"}),
      it("R1", "CL", [pt(0, 5), pt(9, 5), pt(9, 0), pt(0, 0), pt(0, 5)], "BATH 9'-0\"x5'-0\" — wall face", "open"));
    pr.items.forEach(i => { if (!i.ver) delete i.ver; });
    Z.refresh();
    const S = Z.segRows(), V = Z.validation().L.map(x => x.lvl + ": " + x.msg);
    const before = Z.verOf(pr.items[0]); Z.qaMoved(pr.items[2]);
    Z.setSel(["A1"]); Z.refresh(); Z.renderProps();
    return {S: S.map(x => ({id: x.id, sn: x.sn, kind: x.kind, L: x.L, x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1, ver: x.ver, cond: x.c.name})), V, before, after: Z.verOf(pr.items[2]), afterNote: pr.items[2].ver.note,
            props: document.getElementById("props").innerHTML, sha: pr.files[0].sha, review: pr.items.filter(i => Z.verOk(i)).map(i => i.id)};
  });
  // segments: a closed run's four legs, every side of every area, ends in feet on the page
  const run = r.S.filter(x => x.cond === "Washroom walls");
  ok(run.length === 4 && run.map(x => x.L).join(",") === "9,5,9,5", `closed run around the 9'-0" x 5'-0" bath: 4 legs 9, 5, 9, 5 ft, got ${run.map(x => x.L).join(", ")}`);
  ok(Math.abs(run[0].x0 - 100 / 18) < 0.002 && Math.abs(run[0].y0 - (595 - 190) / 18) < 0.002, `leg 1 starts at the bath's corner in page feet (${run[0].x0}, ${run[0].y0})`);
  const bed = r.S.filter(x => x.sn === r.S.find(y => y.L === 11.333 && y.kind === "side").sn);
  ok(bed.length === 6 && Math.abs(bed.reduce((a, x) => a + x.L, 0) - 2 * (16.333 + 12.75)) < 0.01, `L-shaped bed room: 6 sides, perimeter ${bed.reduce((a, x) => a + x.L, 0).toFixed(3)} ft`);
  ok(r.S.some(x => x.kind === "side (deduction)" && x.L === 1), "a deduction's sides are listed as deduction sides");
  ok(r.S.filter(x => x.ver === "Verified against dimensions").length >= 4 && run.every(x => /Unresolved/.test(x.ver)), "each segment carries its measurement's verification");
  // written size against the sides
  ok(r.V.some(x => /BATH 8'-0"x5'-0"/.test(x) && /not between its sides \(nearest 3\.0" off\)/.test(x)), "a bath drawn 8'-3\" long but named 8'-0\" x 5'-0\": warned, 3.0\" off");
  ok(!r.V.some(x => /BATH 9'-0"x5'-0"/.test(x) && /written size/.test(x)), "the 9'-0\" x 5'-0\" bath that matches: no warning");
  ok(!r.V.some(x => /BED ROOM/.test(x) && /written size/.test(x)), "the L-shaped bed room whose main rectangle is 11'-4\" x 12'-9\": no warning");
  ok(!r.V.some(x => /LOUNGE DINING \+ KITCHEN/.test(x) && /written size/.test(x)), "an open-plan name (two rooms) is not checked against one size");
  ok(r.V.some(x => /1 measurement auto-detected — require review/.test(x)) && r.V.some(x => /1 measurement unresolved — kept out of the verified total/.test(x)), "validation lists the auto-detected and the unresolved measurements");
  ok(r.before === "dims" && r.after === "manual" && /was: Verified against visible wall geometry/.test(r.afterNote), "an outline edited by hand becomes Manually corrected, noting what it was");
  if (process.env.TK_DEBUG) console.log(r.props.slice(0, 3000));
  ok(/Vector trace/.test(r.props) && /data-prop="ver"/.test(r.props) && /Verified against dimensions/.test(r.props), "properties: traced outline named, the verification shown and settable");
  ok(r.review.length === 4 && !r.review.includes("A2") && !r.review.includes("R1"), "verified total leaves out the auto-detected and the unresolved");
  // the verification can be set from the properties panel
  await page.selectOption('#props select[data-prop="ver"]', "walls"); await page.waitForTimeout(200);
  ok(await page.evaluate(() => zdTakeoff.verOf(zdTakeoff.P.proj.items.find(i => i.id === "A1")) === "walls"), "properties: verification changed from the list (one undo step)");
  await page.evaluate(() => zdTakeoff.undoAny()); await page.waitForTimeout(200);
  ok(await page.evaluate(() => zdTakeoff.verOf(zdTakeoff.P.proj.items.find(i => i.id === "A1")) === "dims"), "…and undone");
  // exports
  const dl = async sel => { await page.click("#bExport"); await page.waitForTimeout(400); const [d] = await Promise.all([page.waitForEvent("download", {timeout: 20000}), page.click(sel)]); const fn = path.join(os.tmpdir(), "tkv_" + d.suggestedFilename()); await d.saveAs(fn); return fn; };
  const xf = await dl("#exXls");
  const ExcelJS = require(path.join(LIBS, "exceljs")), wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xf);
  const sg = wb.getWorksheet("Segments");
  ok(!!sg, "Excel: a Segments sheet");
  if (sg) {
    const hd = sg.getRow(1).values.slice(1);
    ok(hd[0] === "Segment" && hd[10] === "Length ft" && hd[13] === "Verification", "Segments sheet: Segment … Length ft … Verification columns");
    const rows = []; sg.eachRow((row, n) => { if (n > 1) rows.push(row.values.slice(1)); });
    const legs = rows.filter(x => /^\d+\.\d+$/.test(String(x[0])));
    ok(legs.length === r.S.length, `one row per segment (${legs.length} of ${r.S.length})`);
    const tot = rows.find(x => /^Total BATH 9'-0"x5'-0" — wall face/.test(String(x[3])));
    ok(tot && tot[10] && tot[10].formula && Math.abs(tot[10].result - 28) < 1e-6, "a total row per measurement: SUM of its legs = 28 ft for the bath's wall face");
  }
  const sm = wb.getWorksheet("Summary"), sh = sm.getRow(1).values.slice(1);
  ok(sh.includes("Verified qty") && sh.includes("Needs review qty"), "Summary: verified and needs-review quantities per condition");
  const wr = []; sm.eachRow((row, n) => { if (n > 1) wr.push(row.values.slice(1)); });
  const fl = wr.find(x => x[0] === "Washroom floor"), vi = sh.indexOf("Verified qty"), ni = sh.indexOf("Needs review qty");
  ok(fl && Math.abs(fl[vi] - (45 + 164.496 + 90 - 1)) < 0.05 && Math.abs(fl[ni] - 41.25) < 0.01, `Washroom floor: verified ${fl && fl[vi]} Sft, needs review ${fl && fl[ni]} Sft (the 8'-3" x 5'-0" auto-detected bath)`);
  const ms = wb.getWorksheet("Measurement"); let qa = ""; ms.eachRow(row => { if (/BATH 9'-0"x5'-0"$/.test(String(row.getCell(2).value))) qa = String(row.getCell(11).value); });
  ok(/Verified against dimensions/.test(qa), "Measurement sheet: the QA column carries the verification");
  const cf = await dl("#exSeg"), csv = fs.readFileSync(cf, "utf8").replace(/^﻿/, "").split(/\r\n/);
  ok(/_Segments\.csv$/.test(cf) && csv[0].startsWith("Segment,S.No,Condition,Measurement,Leg,of,From X ft") && csv.length - 1 === r.S.length, `Segments CSV: header and ${csv.length - 1} rows`);
  // merge import: the file's verified calibration offered (taken with scales: "use"), kept by default
  const m = await page.evaluate(async () => {
    const Z = zdTakeoff, pr = Z.P.proj, o = JSON.parse(JSON.stringify(Object.assign({format: "zd-takeoff"}, pr))), k = Object.keys(pr.scales)[0];
    o.scales[k] = {ptPerFt: 18.126, how: "calibrated", text: "133'-9\" over 2424.24 pt", verified: true};
    o.conds.push({id: "CX", name: "Imported", type: "area", unit: "Sft", color: "#16a34a"});
    o.items = [{id: "IX", cond: "CX", file: o.files[0].id, page: 1, kind: "shape", pts: [[400, 300], [418, 300], [418, 318], [400, 318]], nos: 1, label: "", ver: {st: "dims", note: "", by: "", at: ""}}];
    await Z.mergeProjectOpt(JSON.stringify(o)); const kept = pr.scales[k].ptPerFt, rows1 = (Z.S.lastImport.rows || []).filter(x => /Page scales/.test(x.what)).map(x => x.st + " " + x.note);
    o.items[0].pts = o.items[0].pts.map(p => [p[0] + 40, p[1]]);
    await Z.mergeProjectOpt(JSON.stringify(o), {scales: "use"}); const used = pr.scales[k].ptPerFt, rows2 = (Z.S.lastImport.rows || []).filter(x => /Page scales replaced/.test(x.what)).map(x => x.note);
    const it = pr.items.find(i => i.label === "" && i.ver && i.cond !== "CA" && i.cond !== "CL");
    return {kept, used, rows1, rows2, ver: it ? Z.verOf(it) : null, q: it ? Z.rowsOf(it, used).reduce((a, x) => a + x.qty, 0) : null};
  });
  ok(m.kept === 18 && m.rows1.some(x => /^WARNING .*another verified scale.*kept/.test(x)), "merge: a different verified calibration in the file is reported and this project's scale kept by default");
  ok(m.used === 18.126 && m.rows2.some(x => /18\.1260 pt per ft/.test(x)), "merge with scales: use — the file's calibration replaces the page's, reported");
  ok(m.ver === "dims" && Math.abs(m.q - (18 / 18.126) ** 2) < 1e-4, `merged measurement keeps its verification and is measured at the new scale (${m.q && m.q.toFixed(4)} Sft)`);
  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

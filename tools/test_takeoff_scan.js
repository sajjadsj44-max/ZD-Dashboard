#!/usr/bin/env node
/* PDF Takeoff on a scanned drawing: its lines read off the picture (takeoff/scanlines.js), then the Walls, Block masonry and Beams
   agents run on them as on a CAD drawing. The page is one picture and nothing else (as a scanner's PDF), 1:100 at 200 DPI
   (1 ft = 24 px = 8.64 pt), fed 0.4° askew on shaded paper:
     · a room 21.5 × 16.5 ft outside, 9" walls (two face lines), a 3 ft doorway in the bottom wall with its jambs, a 4½" partition
       from wall to wall: 9" centre line 73.000 ft (2 × (20.75 + 15.75), the doorway bridged), 4½" 15.000 ft (face to face)
     · a framing plan beside it: columns 18" × 18" filled solid on a 20 × 15 ft grid (2 bays × 1), 12" beams across drawn dashed
       (under the slab), 15" beams down drawn solid: 4 × 18.500 + 3 × 13.500 = 114.500 ft of centre line, face to face of the columns
       (the walls agent leaves the 15" beams alone: a 9" wall is two lines 9" apart)

     python -m http.server 8765 --bind 127.0.0.1          # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_scan.js     (pdfjs-dist) */
const path = require("path");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {sheet, text, scanPdf} = require("./takeoff_scan_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
const DPI = 200, FT = 24, PT = FT * 72 / DPI, W = 1300, H = 1150, mm = DPI / 25.4, fw = 0.25 * mm;
const D = sheet(W, H, 0.4, 5), X = x => 100 + FT * x, Y = y => 100 + FT * y, FX = x => 100 + FT * x, FY = y => 700 + FT * y;
const ln = (x0, y0, x1, y1) => D.line([X(x0), Y(y0)], [X(x1), Y(y1)], fw);
// the room: outer faces 0 … 21.5 × 0 … 16.5, inner 0.75 … 20.75 × 0.75 … 15.75; the doorway 5 … 8 ft in the bottom wall
ln(0, 0, 21.5, 0); ln(0.75, 0.75, 20.75, 0.75); ln(0, 0, 0, 16.5); ln(0.75, 0.75, 0.75, 15.75); ln(21.5, 0, 21.5, 16.5); ln(20.75, 0.75, 20.75, 15.75);
ln(0, 16.5, 5, 16.5); ln(8, 16.5, 21.5, 16.5); ln(0.75, 15.75, 5, 15.75); ln(8, 15.75, 20.75, 15.75); ln(5, 15.75, 5, 16.5); ln(8, 15.75, 8, 16.5);
ln(10, 0.75, 10, 15.75); ln(10.375, 0.75, 10.375, 15.75);   // the 4½" partition
text(D, "BED ROOM", X(2), Y(6), 2.5 * mm); text(D, "DROME", X(13), Y(6), 2.5 * mm);
// the framing plan: grid x 0, 20, 40 × y 0, 15; columns 18" × 18" filled; 12" beams across dashed, 15" beams down solid
const GX = [0, 20, 40], GY = [0, 15];
GX.forEach(gx => GY.forEach(gy => D.rect(FX(gx - 0.75), FY(gy - 0.75), FX(gx + 0.75), FY(gy + 0.75))));
const dashed = (x0, x1, y) => { const L0 = (x1 - x0) * FT, gp = 1.5 * mm, n = Math.round((L0 + gp) / (3 * mm + gp)), dl = (L0 - (n - 1) * gp) / n;   // (as CAD draws a dashed line: a dash at each end)
  for (let i = 0; i < n; i++) { const a = FX(x0) + i * (dl + gp); D.line([a, FY(y)], [a + dl, FY(y)], fw); } };
GY.forEach(gy => [[0, 20], [20, 40]].forEach(([a, b]) => { dashed(a + 0.75, b - 0.75, gy - 0.5); dashed(a + 0.75, b - 0.75, gy + 0.5); }));
GX.forEach(gx => { D.line([FX(gx - 0.625), FY(0.75)], [FX(gx - 0.625), FY(14.25)], fw); D.line([FX(gx + 0.625), FY(0.75)], [FX(gx + 0.625), FY(14.25)], fw); });
text(D, "B-1", FX(8), FY(-1.2), 2.5 * mm);
const PDF = scanPdf(D.done(), W, H, DPI), FRAME = [60 * 0.36, 640 * 0.36, 1140 * 0.36, 1110 * 0.36];   // the framing plan's box, page points (0.36 pt a px)

let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; return !!c; };
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;
(async () => {
  if (!LIBS) { console.log("TK_LIBS must hold pdfjs-dist — see the header"); process.exit(2); }
  const b = await pw.chromium.launch(), ctx = await b.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: hd});
    return r.abort(); });   // (Tesseract stays offline: the lines need no download)
  const page = await ctx.newPage(); page.on("pageerror", e => ok(false, "page error: " + e)); page.on("dialog", d => d.dismiss());
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "scan"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "scan.pdf", mimeType: "application/pdf", buffer: PDF});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await page.waitForTimeout(400);
  await page.evaluate(pt => { const Z = zdTakeoff; Z.P.proj.scales[Z.S.key] = {ptPerFt: pt, how: "calibrated", text: "test", verified: true}; Z.save(); }, PT);

  console.log("a scan, before its lines are read");
  const g0 = await page.evaluate(() => { const g = zdTakeoff.S.geo[zdTakeoff.S.key]; return {segs: g.segs.length, images: g.images, vec: g.vec}; });
  ok(g0.segs === 0 && g0.images >= 1 && !g0.vec, `the page is a picture with no lines (${g0.segs} lines, ${g0.images} picture)`);
  const e0 = await page.evaluate(() => zdTakeoff.wallsAgent({t: 0.75, page: true}));
  ok(e0.error && /read its lines first/.test(e0.error), "the walls agent says to read the lines first: " + (e0.error || "").slice(0, 90));
  await page.evaluate(() => { zdTakeoff.scanLinesFirst("walls agent"); });
  await page.waitForSelector("#dlgBack.on", {timeout: 5000});
  const t0 = await page.textContent("#dlgT"), wOn = await page.isChecked("#vlW");
  ok(/lines first/.test(t0), `an agent on a scan offers to read its lines: “${t0}”`);
  ok(wOn, "…with the words (OCR) ticked too, the page having no text");
  await page.uncheck("#vlW"); await page.click("#dlgOk");
  await page.waitForFunction(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key]; return Z.P.proj.vec && Z.P.proj.vec[Z.S.key] && g && g.vec > 0; }, null, {timeout: 60000});
  const v = await page.evaluate(() => { const Z = zdTakeoff, o = Z.P.proj.vec[Z.S.key], g = Z.S.geo[Z.S.key]; return {n: o.n, skew: o.skew, d: typeof o.d, dl: o.d.length, vec: g.vec, segs: g.segs.length, dashed: g.segs.filter(s => s[4] & 2).length, fill: g.segs.filter(s => s[4] & 4).length}; });
  console.log("the lines read");
  ok(v.n > 40 && v.vec === v.n && v.segs === v.n, `${v.n} lines read and added to the page (${v.vec} on it)`);
  ok(near(v.skew, 0.4, 0.06), `the scan's skew ${v.skew}° measured (fed at 0.4°)`);
  ok(v.dashed >= 8, `${v.dashed} dashed lines (the 12" beams' edges, drawn dashed)`);
  ok(v.fill >= 24, `${v.fill} edges of filled shapes (6 columns)`);
  ok(v.d === "string" && v.dl < v.n * 30, `kept with the project as one packed string (${v.dl} characters)`);
  const shown = await page.evaluate(() => !!document.querySelector('path[stroke="#e0218a"]'));
  ok(shown, "the lines just read are shown on the page (pink)");

  console.log("the walls agent on the scan");
  const w9 = await page.evaluate(() => zdTakeoff.wallsAgent({t: 0.75, page: true, bridge: 6}));
  ok(!w9.error && near(w9.total_length_ft, 73, 0.4), `9" walls: ${w9.error || w9.total_length_ft} ft of centre line (73.000: the doorway bridged)`);
  const w4 = await page.evaluate(() => zdTakeoff.wallsAgent({t: 0.375, page: true, bridge: 6}));
  ok(!w4.error && near(w4.total_length_ft, 15, 0.3), `4½" partition: ${w4.error || w4.total_length_ft} ft (15.000, face to face)`);

  console.log("block masonry on the scan");
  const bm = await page.evaluate(() => { const Z = zdTakeoff; Z.P.proj.items = Z.P.proj.items.filter(i => !i.wallAuto); return Z.blockMasonryAgent({page: true, floor: 10, slab: 5, tags: {}}); });
  const r8 = bm.rows ? bm.rows.filter(r => /masonry 8"/.test(r.type)).reduce((s, r) => s + r.run_ft, 0) : null, r4 = bm.rows ? bm.rows.filter(r => /masonry 4"/.test(r.type)).reduce((s, r) => s + r.run_ft, 0) : null;
  ok(!bm.error && near(r8, 73, 1), `8" block walls: ${bm.error || r8} ft (the 9" walls, 73)`);
  ok(!bm.error && near(r4, 15, 0.5), `4" block walls: ${bm.error || r4} ft (the partition, 15)`);
  ok(bm.rows && bm.rows.every(r => r.net_cft >= 0), "each block row has its volume (cft) — " + (bm.rows || []).map(r => r.type + " " + r.net_cft).join(", "));

  console.log("the beams agent on the scan (no beam layer: the lines read)");
  const bb = await page.evaluate(fr => zdTakeoff.beamsAgent({rect: fr, group: "width"}), FRAME);
  ok(!bb.error, "it runs on a scan with no layers" + (bb.error ? ": " + bb.error : ""));
  ok(bb.spans === 7, `7 spans (4 across, 3 down): ${bb.spans}`);
  ok(near(bb.total_length_ft, 114.5, 1.2), `${bb.total_length_ft} ft of centre line (114.500, face to face of the columns)`);
  ok(JSON.stringify(bb.widths_in) === "[15,12]", `widths read from the drawing: ${JSON.stringify(bb.widths_in)} in (15" solid, 12" dashed)`);
  const c12 = (bb.conditions || []).find(c => c.width_in === 12), c15 = (bb.conditions || []).find(c => c.width_in === 15);
  ok(c12 && near(c12.length_ft, 74, 0.8) && c12.spans === 4, `12" beams: ${c12 ? c12.spans + " spans, " + c12.length_ft : "?"} ft (4 × 18.500 — the dashed edges)`);
  ok(c15 && near(c15.length_ft, 40.5, 0.6) && c15.spans === 3, `15" beams: ${c15 ? c15.spans + " spans, " + c15.length_ft : "?"} ft (3 × 13.500)`);

  console.log("kept with the project");
  const id = await page.evaluate(async () => { await zdTakeoff.flushSave(); return zdTakeoff.P.proj.id; });
  await page.reload(); await page.waitForTimeout(800);
  await page.evaluate(id2 => { if (!zdTakeoff.P.proj || zdTakeoff.P.proj.id !== id2) return zdTakeoff.openProject(id2); }, id);
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 30000}); await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const g = zdTakeoff.S.geo[zdTakeoff.S.key]; return {vec: g.vec, w: zdTakeoff.wallsAgent({t: 0.75, page: true, bridge: 6}).total_length_ft}; });
  ok(after.vec === v.n, `opened again, the page has its ${after.vec} lines read`);
  ok(near(after.w, 73, 0.4), `…and the walls agent finds the same ${after.w} ft`);

  console.log("the page turned");
  await page.evaluate(() => zdTakeoff.rotatePage(zdTakeoff.S.key, 90));
  await page.waitForFunction(() => zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key].vec > 0, null, {timeout: 30000}); await page.waitForTimeout(300);
  const rot = await page.evaluate(() => { const Z = zdTakeoff, g = Z.S.geo[Z.S.key], vb = Z.S.base; const xs = g.segs.map(s => Math.max(s[0], s[2])), ys = g.segs.map(s => Math.max(s[1], s[3]));
    return {w: Z.wallsAgent({t: 0.75, page: true, bridge: 6}).total_length_ft, inside: Math.max(...xs) <= vb.width + 1 && Math.max(...ys) <= vb.height + 1, tall: vb.width < vb.height}; });
  ok(rot.tall && rot.inside, "turned 90°, the lines read turn with the page (all on it)");
  ok(near(rot.w, 73, 0.4), `…and the walls agent still finds ${rot.w} ft`);

  await b.close(); console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

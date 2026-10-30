#!/usr/bin/env node
/* Unit tests of the takeoff's measurement engine (takeoff/measure.js) — plain Node, no browser:

     node tools/test_takeoff_measure.js            # TK_REPORT=out.json writes every check (reference, result, error, tolerance)

   Synthetic shapes with hand-worked quantities: rectangles, an L, the apartment's T-shaped corridor, a trapezoid and a hexagon;
   polylines; square corners; open, crossing and doubled-back outlines; shared and duplicated wall runs; calibration (imperial
   and metric) and a scale checked against more dimensions; turned shapes; unit conversions; wall finish, masonry, slab,
   concrete and formwork with deductions and the house thresholds; counts. Tolerances are set here, before the run. */
const fs = require("fs"), path = require("path"), {pathToFileURL} = require("url");
const rows = []; let fails = 0, passes = 0;
function ok(c, msg, rec){ if (c) passes++; else fails++; console.log((c ? "  ✓ " : "  ✗ ") + msg); rows.push(Object.assign({check: msg, pass: !!c}, rec || {})); }
function cmp(msg, ref, got, tol, unit){   // tol: absolute, in the unit
  const abs = got == null || !isFinite(got) ? null : got - ref, pct = abs == null || !ref ? null : 100 * abs / ref, pass = abs != null && Math.abs(abs) <= tol;
  ok(pass, `${msg}: ref ${ref} ${unit}, got ${got == null ? "—" : +got.toFixed(6)} ${unit}` + (abs == null ? "" : ` (err ${abs >= 0 ? "+" : ""}${+abs.toExponential(2)}${pct == null ? "" : ", " + pct.toFixed(4) + " %"})`), {ref, got, abs_err: abs, pct_err: pct, tol: "±" + tol + " " + unit, unit});
}
(async () => {
  const file = path.join(__dirname, "..", "takeoff", "measure.js");
  let M; try { M = await import(pathToFileURL(file).href); } catch (e) { M = await import("data:text/javascript," + encodeURIComponent(fs.readFileSync(file, "utf8"))); }   // (a Node without ES-module detection)
  const k = 18, P = pts => pts.map(([x, y]) => [x * k, y * k]);   // feet -> page points at 1/4" = 1'-0"
  const rot = (pts, deg, c = [500, 400]) => { const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a); return pts.map(([x, y]) => [c[0] + (x - c[0]) * cs - (y - c[1]) * sn, c[1] + (x - c[0]) * sn + (y - c[1]) * cs]); };
  const E = 1e-9;

  console.log("areas and perimeters (pt at 18 pt / ft)");
  const bed = P([[0.75, 0.75], [12.75, 0.75], [12.75, 13.75], [0.75, 13.75]]);
  let r = M.roomArea(bed, k); cmp("rectangle 12 × 13 area", 156, r.value, E, "Sft"); cmp("…perimeter", 50, r.perimeter, E, "ft"); ok(r.valid.ok, "…a valid outline");
  r = M.roomArea(P([[0, 0], [12, 0], [12, 6], [6, 6], [6, 12], [0, 12]]), k); cmp("L-shape 12 × 12 less 6 × 6", 108, r.value, E, "Sft"); cmp("…perimeter", 48, r.perimeter, E, "ft");
  const corr = P([[0.75, 14.125], [13.125, 14.125], [13.125, 9.125], [24.5, 9.125], [24.5, 14.125], [37.875, 14.125], [37.875, 18.125], [0.75, 18.125]]);
  r = M.roomArea(corr, k); cmp("T-shaped corridor 37.125 × 4 + 11.375 × 5", 205.375, r.value, E, "Sft"); cmp("…perimeter", 92.25, r.perimeter, E, "ft");
  r = M.roomArea(P([[0, 0], [16, 0], [12, 10], [4, 10]]), k); cmp("trapezoid (16 + 8) / 2 × 10", 120, r.value, E, "Sft");
  const hex = Array.from({length: 6}, (_, i) => [10 + 5 * Math.cos(i * Math.PI / 3), 10 + 5 * Math.sin(i * Math.PI / 3)]);
  cmp("regular hexagon side 5: 3√3 / 2 × 25", 3 * Math.sqrt(3) / 2 * 25, M.roomArea(P(hex), k).value, 1e-9, "Sft");
  r = M.roomArea(P([[0, 0], [20, 0], [20, 20], [0, 20]]), k, [P([[5, 5], [9, 5], [9, 10], [5, 10]])]); cmp("room 20 × 20 less a 4 × 5 shaft", 380, r.value, E, "Sft"); cmp("…gross kept apart", 400, r.gross, E, "Sft");
  ok(M.roomArea(bed, 0).value === null && M.roomArea(bed, 0).missing.includes("page scale"), "no scale: no area, 'page scale' missing");

  console.log("lengths");
  cmp("polyline 3 + 4 + 5 legs", 12, M.wallLength([P([[0, 0], [3, 0], [3, 4], [0, 0]])], k).value, E, "ft");
  r = M.wallLength([P([[0.375, 32.875], [0.375, 0.375], [38.25, 0.375], [38.25, 32.875], [0.375, 32.875]])], k); cmp("9\" outer wall centre line ring 2 × (37.875 + 32.5)", 140.75, r.value, E, "ft"); ok(r.legs.length === 4, "…4 legs on the sheet");
  cmp("two runs summed (13.375 + 12)", 25.375, M.wallLength([P([[12.9375, 0.75], [12.9375, 14.125]]), P([[0.75, 13.9375], [12.75, 13.9375]])], k).value, E, "ft");

  console.log("corners");
  ok(Math.max(...M.cornerDeviation(corr)) < 1e-9, "the T corridor's 8 corners are all square");
  ok(Math.max(...M.cornerDeviation(rot(bed, 30))) < 1e-9, "a room turned 30° keeps square corners");
  cmp("a trapezoid's slanted corner: 90° − atan(10 / 4) off square", 90 - Math.atan2(10, 4) * 180 / Math.PI, M.cornerDeviation(P([[0, 0], [16, 0], [12, 10], [4, 10]]))[1], 1e-9, "°");

  console.log("outline validity");
  ok(!M.validatePolygon([[0, 0], [10, 0]]).ok && M.validatePolygon([[0, 0], [10, 0]]).issues[0].type === "open", "two points: open, not closed");
  let v = M.validatePolygon([[0, 0], [10, 10], [10, 0], [0, 10]]); ok(!v.ok && v.issues.some(i => i.type === "self-cross"), "a figure of eight: sides cross");
  v = M.validatePolygon([[0, 0], [10, 0], [10, 10], [10, 4], [10, 2], [0, 10]]); ok(!v.ok && v.issues.some(i => i.type === "self-touch"), "a side doubling back on itself: touches");
  v = M.validatePolygon([[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]]); ok(!v.ok && v.issues.some(i => i.type === "repeat"), "a repeated corner is reported");
  v = M.validatePolygon([[0, 0], [5, 0], [10, 0]]); ok(!v.ok && v.issues.some(i => i.type === "degenerate"), "corners on one line: no area");
  ok(M.validatePolygon(corr, 1e-6).ok, "the T corridor is valid");

  console.log("shared and duplicated walls");
  const w1 = P([[0, 0], [20, 0]]), w2 = P([[5, 0.01], [30, 0.01]]), w3 = P([[0, 0.375], [20, 0.375]]), w4 = P([[10, -5], [10, 5]]);
  cmp("a run measured again over 15 ft of it", 15, M.runOverlaps([w1, w2], 0.05 * k, 0.5 * k)[0].shared / k, 1e-9, "ft");
  ok(!M.runOverlaps([w1, w3], 0.05 * k, 0.5 * k).length, "the two faces of a 4.5\" wall (0.375 ft apart) are not a duplicate");
  ok(!M.runOverlaps([w1, w4], 0.05 * k, 0.5 * k).length, "a wall meeting another at a T is not a duplicate");
  ok(M.runOverlaps([w1, w1.slice().reverse()], 0.05 * k, 0.5 * k)[0].shared / k === 20, "the same run drawn the other way: 20 ft shared");

  console.log("scale");
  r = M.calibrate([100, 100], [316, 100], 12); cmp("two points 216 pt apart for 12'-0\" (1/4\" = 1'-0\")", 18, r.ptPerFt, E, "pt/ft"); ok(!r.warn.length, "…no warning on a long span");
  r = M.calibrate([0, 0], [72 / 25.4 * 100, 0], 5, "m"); cmp("1:50 — 100 mm on the paper for 5 m", 72 / 25.4 * 304.8 / 50, r.ptPerFt, 1e-9, "pt/ft");
  r = M.calibrate([0, 0], [30, 0], 2); ok(r.warn.length === 2, "a 30 pt span for 2 ft: warned (short span, short length)");
  ok(M.calibrate([0, 0], [0, 0], 10).err, "the same point twice: refused");
  let c = M.checkScale(18, [{pt: 18 * 13, ft: 13}, {pt: 18 * 37.125, ft: 37.125}]); ok(c.ok && c.worstPct < 1e-9, "two more dimensions agree with the scale");
  c = M.checkScale(18, [{pt: 18 * 13, ft: 13}, {pt: 18 * 12, ft: 12.5}]); ok(!c.ok && Math.abs(c.worstPct - 4) < 1e-9, "a dimension 4 % off is flagged, not accepted (worst " + c.worstPct.toFixed(2) + " %)");
  cmp("a room turned 90° (a /Rotate 90 page): same area", 156, M.roomArea(rot(bed, 90), k).value, 1e-9, "Sft");
  cmp("…and turned 37°", 156, M.roomArea(rot(bed, 37), k).value, 1e-9, "Sft");
  cmp("the same room at 1:100 (8.64 pt / ft)", 156, M.roomArea(bed.map(([x, y]) => [x / 18 * 8.64, y / 18 * 8.64]), 8.64).value, 1e-9, "Sft");

  console.log("units");
  cmp("1 m in ft", 1 / 0.3048, M.convert(1, "m", "ft"), 1e-12, "ft"); cmp("1 m² in Sft", 10.763910416709722, M.convert(1, "m2", "Sft"), 1e-12, "Sft");
  cmp("1 m³ in Cft", 35.31466672148859, M.convert(1, "m3", "Cft"), 1e-12, "Cft"); cmp("2.5 ton in kg", 2500, M.convert(2.5, "ton", "kg"), 0, "kg");
  cmp("304.8 mm in ft", 1, M.convert(304.8, "mm", "ft"), 1e-12, "ft"); cmp("156 Sft in m²", 14.49287424, M.convert(156, "Sft", "m2"), 1e-12, "m2");
  let threw = false; try { M.convert(1, "Sft", "ft"); } catch (e) { threw = true; } ok(threw, "Sft to ft is refused, not guessed");
  ok(M.fmt(1.23456) === "1.235" && M.fmt(4, 0) === "4" && M.fmt(null) === "—", "display rounding only: 3 dp, whole Nos, — for none");

  console.log("QS quantities and deductions");
  r = M.wallFinishArea({length: 50, height: 10, openings: [{name: "D1", w: 3, h: 7, nos: 2}, {name: "W1", w: 4, h: 5}, {name: "V1", w: 1, h: 1}]});
  cmp("plaster 50 × 10 less 2 doors 3 × 7 and a window 4 × 5", 438, r.value, E, "Sft"); ok(r.openings.find(o => o.name === "V1").below, "…a 1 × 1 vent (1.00 Sft) is listed, not deducted");
  r = M.wallFinishArea({length: 50, height: 10, faces: 2, openings: [{w: 3, h: 7}]}); cmp("both faces: 2 × 50 × 10 − 2 × 21", 958, r.value, E, "Sft");
  r = M.wallFinishArea({length: 50}); ok(r.value === null && /height/.test(r.missing.join()), "no wall height: not worked out, height missing");
  r = M.wallFinishArea({length: 50, height: 10, openings: [{name: "W9", w: 4}]}); ok(r.value === null && /opening size/.test(r.missing.join()), "an opening with no height: not worked out");
  r = M.masonryVolume({length: 140.75, height: 10, thickness: 0.75, openings: [{w: 3, h: 7}]}); cmp("9\" masonry 140.75 × 10 × 0.75 less a door", 1039.875, r.value, E, "Cft");
  ok(M.masonryVolume({length: 140.75, height: 10}).missing.some(m => /thickness/.test(m)), "no thickness: missing");
  r = M.slabArea({area: 1284.28, openings: [{name: "SHAFT", area: 20, confirmed: true}, {name: "STAIR", area: 80}]});
  cmp("slab less the confirmed shaft only", 1264.28, r.value, 1e-9, "Sft"); ok(r.unconfirmed[0] === "STAIR" && /thickness/.test(r.volumeMissing), "…the unconfirmed stair listed, the volume waits for a thickness");
  cmp("…with T 0.5 ft", 632.14, M.slabArea({area: 1284.28, thickness: 0.5, openings: [{area: 20, confirmed: true}]}).volume, 1e-9, "Cft");
  cmp("beam 0.75 × 1.5 × 20", 22.5, M.concreteVolume({b: 0.75, d: 1.5, length: 20}).value, E, "Cft"); ok(M.concreteVolume({b: 0.75, length: 20}).value === null, "a beam with no depth: missing");
  r = M.slabFormwork({area: 100, perimeter: 40, depth: 0.5, openings: [{area: 4}, {area: 10}]}); cmp("formwork 100 − 10 + 40 × 0.5 (a 4 Sft hole under 5.00 kept)", 110, r.value, E, "Sft");
  r = M.countObjects([[0, 0], [100, 0], [100.5, 0], [200, 0], [300, 0]], 2); ok(r.value === 4 && r.duplicates.length === 1, "5 marks, one on top of another: 4 counted, the duplicate reported");
  r = M.countObjects([], 2); ok(r.value === 0 && !r.verifiedZero && /not a verified zero/.test(r.status), "none found is not a verified zero");

  console.log("earthworks: cut and fill from spot levels (TIN)");
  ok(M.delaunay([[0, 0], [10, 0], [10, 10], [0, 10]]).length === 2, "a square of 4 levels is 2 triangles");
  ok(M.delaunay([[0, 0], [5, 0], [10, 0]]).length === 0, "levels all on one line make no triangle");
  ok(M.delaunay([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]).length === 4, "a square with its centre is 4 triangles");
  { const g = M.groundAt([2, 3], [[0, 0], [10, 0], [0, 10]], [100, 110, 103], [[0, 1, 2]]); cmp("level inside a triangle (its plane)", 100 + 10 * 0.2 + 3 * 0.3, g.z, 1e-9, "ft"); ok(!g.out, "…inside the levels"); }
  const site = P([[0, 0], [100, 0], [100, 50], [0, 50]]), lv = L => L.map(([x, y, z]) => ({p: [x * k, y * k], z}));
  // the ground rises 1 ft in 100 ft from 100.00: at formation 100.50 the east half is cut, the west half fill — 625 cft each
  r = M.cutFill({outline: site, k, formation: 100.5, levels: lv([[0, 0, 100], [100, 0, 101], [100, 50, 101], [0, 50, 100]])});
  cmp("sloping ground 100 × 50 ft, formation at mid-height: cut", 625, r.cut, 2, "Cft"); cmp("…fill", 625, r.fill, 2, "Cft"); cmp("…net", 0, r.value, 1e-6, "Cft");
  cmp("…area", 5000, r.area, E, "Sft"); ok(r.outside === 0, "…all within the spot levels");
  r = M.cutFill({outline: site, k, formation: 99, levels: lv([[0, 0, 100], [100, 0, 101], [100, 50, 101], [0, 50, 100]])});
  cmp("formation below all the ground: cut = 5000 × 1.5 ft average", 7500, r.cut, 1, "Cft"); cmp("…no fill", 0, r.fill, E, "Cft");
  r = M.cutFill({outline: site, k, formation: 102.25, levels: lv([[0, 0, 101], [100, 0, 101], [100, 50, 101], [0, 50, 101], [50, 25, 101]])});
  cmp("level ground 101.00, formation 102.25: fill 5000 × 1.25", 6250, r.fill, 1e-6, "Cft"); cmp("…no cut", 0, r.cut, E, "Cft"); cmp("…fill depth", 1.25, r.depthFill, 1e-9, "ft");
  r = M.cutFill({outline: P([[0, 0], [20, 0], [20, 20], [0, 20]]), k, formation: 100, levels: lv([[5, 5, 101], [15, 5, 101], [15, 15, 101], [5, 15, 101]])});
  ok(r.outside > 0.6 && r.outside < 0.8, "levels inside a bigger outline: the share outside them is reported (" + (r.outside * 100).toFixed(1) + " %)"); cmp("…the ground there from the nearest levels", 400, r.cut, 1e-6, "Cft");
  r = M.cutFill({outline: site, k, formation: 100, levels: lv([[0, 0, 100], [100, 0, 101]])}); ok(r.value === null && /3 spot levels/.test(r.missing.join()), "two levels are not enough — not worked out");
  r = M.cutFill({outline: site, k, formation: "", levels: lv([[0, 0, 100], [100, 0, 101], [0, 50, 100]])}); ok(r.value === null && /formation level/.test(r.missing.join()), "no formation level — never assumed");

  if (process.env.TK_REPORT) fs.writeFileSync(process.env.TK_REPORT, JSON.stringify({at: new Date().toISOString(), checks: rows}, null, 1));
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

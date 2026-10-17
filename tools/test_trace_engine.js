#!/usr/bin/env node
/* takeoff/trace.js on its own (no browser), on the small plan of takeoff_trace_fixture.js: wall outlines on a Wall layer,
   the walls' hatch on WH (not clipped at the faces, as a PDF reader hands it over), a duct box on DUCTS, room names with
   their written sizes. Every quantity below is worked out by hand from the drawing.

     node tools/test_trace_engine.js */
const path = require("path");
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const {K, segs, text, LAYERS, WALL} = require("./takeoff_trace_fixture");   // the plan, its layers and its text (worked out in the fixture's header)
(async () => {
  const E = await import("file:///" + path.resolve(__dirname, "../takeoff/trace.js").replace(/\\/g, "/"));
  const res = E.traceFloor({segs, layers: LAYERS, lines: text, k: K}, {});
  ok(!res.err, "traced" + (res.err ? ": " + res.err : " in " + res.ms + " ms"));
  if (res.err) process.exit(1);
  const by = n => res.spaces.find(s => s.names.join(" + ") === n), near = (a, b, t) => Math.abs(a - b) <= (t || 0.02);
  const bed = by("BED ROOM"), bath = by("BATH"), lounge = by("LOUNGE");
  ok(bed && near(bed.sft, 14.25 * 18.5), `BED ROOM ${bed && bed.sft.toFixed(3)} Sft = 14.25 × 18.5 = 263.625 (clear, wall face to wall face)`);
  ok(bed && bed.status === "dims", "…its written 14'-3\" x 18'-6\" found between its walls: verified against dimensions");
  ok(bath && near(bath.sft, 13.875 * 9.25 - 2 * 1.5), `BATH ${bath && bath.sft.toFixed(3)} Sft = 13.875 × 9.25 − the 2 × 1.5 duct box = 125.344`);
  ok(bath && bath.status === "dims", "…written 13'-10 1/2\" x 9'-3\" found (the duct box in its corner does not hide the facing walls)");
  ok(lounge && near(lounge.sft, 13.875 * 8.875), `LOUNGE ${lounge && lounge.sft.toFixed(3)} Sft = 13.875 × 8.875 = 123.141`);
  ok(res.spaces.every(s => s.outer.every(P => P.every((p, i) => { const q = P[(i + 1) % P.length]; return Math.abs(p[0] - q[0]) < 0.01 || Math.abs(p[1] - q[1]) < 0.01; }))), "every outline is square: corners on the wall lines, no slanted cut across a corner");
  const thr = res.thresholds.map(t => ({w: Math.max(t.bw, t.bh), d: Math.min(t.bw, t.bh), how: t.how, between: t.between.map(i => res.spaces[i] && res.spaces[i].names[0]).sort().join("|")}));
  const open = thr.find(t => t.between === "BED ROOM|LOUNGE"), shut = thr.find(t => t.between === "BATH|LOUNGE");
  ok(open && near(open.w, 3) && near(open.d, 0.375) && open.how === "traced", `the open door: a threshold 3 ft × 4½" between BED ROOM and LOUNGE (${open && open.w.toFixed(3)} × ${open && open.d.toFixed(3)})`);
  ok(shut && near(shut.w, 2.5) && near(shut.d, 0.375) && shut.how === "closed-door", `the door drawn closed: a threshold 2'-6" × 4½" between BATH and LOUNGE, where the hatch stops (${shut && shut.w.toFixed(3)} × ${shut && shut.d.toFixed(3)})`);
  ok(res.ducts.length === 1 && near(res.ducts[0].sft, 3), "the duct box found, 3 Sft, not part of the bath's floor");
  const E1 = bath && bath.edges || [], gross = E1.reduce((a, e) => a + e.L, 0), opn = E1.reduce((a, e) => a + e.open.reduce((b, [u, v]) => b + v - u, 0), 0);
  ok(near(gross, 2 * (13.875 + 9.25), 0.01), `BATH wall face round the room ${gross.toFixed(3)} ft = 2 × (13.875 + 9.25) = 46.25 (the duct's notch adds nothing)`);
  ok(near(opn, 2.5, 0.06), `…its door opening on the face ${opn.toFixed(3)} ft (2'-6"), kept apart, not deducted`);
  ok(res.overall && near(res.overall.sft, 30 * 20), `the floor's outline ${res.overall && res.overall.sft.toFixed(3)} Sft = 30 × 20 to the walls' outer face`);
  ok(bath && bath.notes.some(n => /leaves out what stands in it/.test(n)) && !bath.notes.some(n => /single line/.test(n)), "the bath's note says the duct is left out; the duct's side is not taken for a door");
  // nothing lost, nothing counted twice: external walls 600 − 28.5 × 18.5, the partitions 4½" × (18.5 − 3) and 4½" × (13.875 − 2.5), the duct 3
  const sum = res.spaces.reduce((a, s) => a + s.sft, 0) + res.thresholds.reduce((a, t) => a + t.sft, 0);
  const walls = 600 - 28.5 * 18.5 + 0.375 * (18.5 - 3) + 0.375 * (13.875 - 2.5) + 3;
  ok(near(600 - sum, walls, 0.05), `floor − rooms − thresholds = walls + duct: ${(600 - sum).toFixed(3)} = ${walls.toFixed(3)} Sft`);
  const big = E.traceFloor({segs: segs.filter(s => s[5] !== WALL), layers: LAYERS, lines: text, k: K}, {});
  ok(!!big.err || !big.spaces.length, "a page with no wall layer is not traced (" + (big.err || "no spaces") + ")");
  console.log("B. a plan plotted without its wall hatch (takeoff_trace_fixture.js plan B)");
  const PB = require("./takeoff_trace_fixture").planB, rb = E.traceFloor({segs: PB.segs, layers: PB.layers, lines: PB.lines, k: K}, {});
  ok(!rb.err, "traced" + (rb.err ? ": " + rb.err : " in " + rb.ms + " ms"));
  const nB = n => rb.spaces && rb.spaces.find(s => s.names.join(" + ") === n), bedB = nB("BED ROOM"), bathB = nB("BATH"), louB = nB("LOUNGE");
  ok(rb.spaces && rb.spaces.length === 3 && !rb.spaces.some(s => s.unlabelled), "three rooms and nothing else: the unhatched 9\" walls are walls, not strips of floor (" + (rb.spaces || []).map(s => s.names.join("+") + " " + s.sft.toFixed(2)).join(", ") + ")");
  ok(bedB && near(bedB.sft, 11.25 * 14.5) && bedB.status === "dims", `BED ROOM ${bedB && bedB.sft.toFixed(3)} Sft = 11'-3" × 14'-6", at its written size`);
  ok(bedB && bedB.names.length === 1, "…named BED ROOM only: the riser count 24 DN is no name");
  ok(bathB && near(bathB.sft, 26.75, 0.05) && bathB.status === "dims", `BATH ${bathB && bathB.sft.toFixed(3)} Sft = 5.25 × 5.75 − the corner 3.4375: its door across the corner closed where the leaf shuts, not leaking into the lounge`);
  ok((rb.log || []).some(l => /1 door set across a corner/.test(l)), "…the trace says so (" + (rb.log || []).join("; ") + ")");
  ok(louB && near(louB.sft, 121.1875, 0.05), `LOUNGE ${louB && louB.sft.toFixed(3)} Sft = 152.25 − 26.75 − the bath's walls 4.3125`);
  ok(louB && louB.names.length === 1 && louB.kind === "room", "…named LOUNGE only: the stair note in it (STAIR = 4'-6\" WIDE) does not name it");
  ok(rb.thresholds && rb.thresholds.length === 1 && near(rb.thresholds[0].sft, 2.25, 0.02), "the open door: one threshold, 3 × 9\" = 2.25 Sft (" + (rb.thresholds || []).map(t => t.sft.toFixed(3)).join(", ") + ")");
  ok(rb.overall && near(rb.overall.sft, 384), "the floor 24 × 16 = 384 Sft (" + (rb.overall && rb.overall.sft.toFixed(3)) + ")");
  console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
})();

#!/usr/bin/env node
/* The vector trace (takeoff/trace.js) on an AutoCAD drawing's model space — plain Node, no browser:

     node tools/test_trace_cad.js

   A sheet laid out at 1:960 (0.9 pt per ft, as cad.js lays a model space of a dozen plans), holding two copies of one flat plan
   side by side and an elevation drawn on the wall layer with no names. Each lesson from tracing a real apartment block by hand
   (PLOT 11, Askari-11, 21-Oct-2026) is drawn into the plan, with its quantity worked out by hand:
     · each plan found and traced on its own, at the trace's own scale; the elevation (no names) left out
     · a grid line on the Column layer runs right across the lounge and the store: no wall
     · a column filled solid (AutoCAD's SOLID hatch on a hatch layer) in the bed room's corner: wall, not a pocket of the room
     · windows on a layer named WIN close the bed room's external wall; railings on RALL bound the terrace
     · door swings drawn with their frame lines on the door layer are still found (the hinge, the radius)
     · a foyer with no name, open to the lobby, a door on into the lounge: the flat's foyer, not part of the lobby
     · the lounge open to its passage (no wall) and, across a dashed beam line, to its drawing room: split on wall lines, each to
       its written size
     · a stair with a rail between its two flights, open to the passage beside it: one stair (kept out of the floor), cut off on
       its last riser; the passage its own space
   and a fourth plan with what the second pass over that drawing found:
     · a pipe ledge beyond a terrace's railing (the slab's edge 1.4 ft out): not the terrace
     · a dress with its own written size, open to its bed room: a room of its own
     · a foyer whose mouth has a column 5/8" proud of the lobby's wall: still closed off from the lobby
     · a stair with no name (its treads, UP), open to the lift lobby behind a railing that stops short of the wall: kept out of the
       lobby, on the railing's line
   Units: feet on the drawing, page points (y down) in the trace. */
const fs = require("fs"), path = require("path"), {pathToFileURL} = require("url");
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log((c ? "  ✓ " : "  ✗ ") + m); return !!c; };
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;
(async () => {
  const file = path.join(__dirname, "..", "takeoff", "trace.js");
  let T; try { T = await import(pathToFileURL(file).href); } catch (e) { T = await import("data:text/javascript," + encodeURIComponent(fs.readFileSync(file, "utf8"))); }
  const K = 0.9;   // pt per ft: 1:960
  const LAY = [["walls", "wall"], ["Column", "column"], ["WIN", "opening"], ["RALL", "railing"], ["DOOR", "opening"], ["DASHED", "other"], ["stairs", "fixture"], ["253", "other"], ["TEXT", "text"]];
  const L = Object.fromEntries(LAY.map(([n], i) => [n, i])), layers = LAY.map(([name, role]) => ({name, role}));
  const openPlan = (ox, oy) => {   // a lounge 15 × 12.5 open along its whole bottom side to a passage 30 × 3.5, the bed room beside it walled
    const segs = [], lines = []; let sp = 5000;
    const P = (x, y) => [(ox + x) * K + 50, (oy + y) * K + 50];
    const seg = (a, b, lay, f) => { const p = P(...a), q = P(...b); segs.push([p[0], p[1], q[0], q[1], f || 0, L[lay], sp]); };
    const wall = (x0, y0, x1, y1) => { sp++; seg([x0, y0], [x1, y0], "walls"); seg([x1, y0], [x1, y1], "walls"); seg([x1, y1], [x0, y1], "walls"); seg([x0, y1], [x0, y0], "walls"); };
    const text = (s0, x, y) => { const c = P(x, y), h = 0.6 * K, w = s0.length * h * 0.6; lines.push({s: s0, x: c[0] - w / 2, y: c[1] + h / 2, w, h, r: 0, cx: c[0], cy: c[1]}); };
    wall(-0.75, -0.75, 30.75, 0); wall(-0.75, 16, 30.75, 16.75); wall(-0.75, 0, 0, 16); wall(30, 0, 30.75, 16);
    wall(15, 0, 15.5, 12.5); wall(15, 12, 20, 12.5); wall(23, 12, 30, 12.5);   // the bed room (x 15.5..30, y 0..12), its door x 20..23
    text('LOUNGE 15\'-0"X12\'-6"', 7.5, 6); text('BED ROOM 14\'-6"X12\'-0"', 22.5, 6); text('PASSAGE 3\'-6" WIDE', 24, 14.25);
    return {segs, lines}; };
  const plan2 = (ox, oy) => {   // the fourth plan (inside faces x 0..47, y 0..30)
    const segs = [], lines = []; let sp = 7000;
    const P = (x, y) => [(ox + x) * K + 50, (oy + y) * K + 50];
    const seg = (a, b, lay, f) => { const p = P(...a), q = P(...b); segs.push([p[0], p[1], q[0], q[1], f || 0, L[lay], sp]); };
    const rect = (x0, y0, x1, y1, lay, f) => { sp++; seg([x0, y0], [x1, y0], lay, f); seg([x1, y0], [x1, y1], lay, f); seg([x1, y1], [x0, y1], lay, f); seg([x0, y1], [x0, y0], lay, f); };
    const wall = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, "walls");
    const text = (s0, x, y) => { const c = P(x, y), h = 0.6 * K, w = s0.length * h * 0.6; lines.push({s: s0, x: c[0] - w / 2, y: c[1] + h / 2, w, h, r: 0, cx: c[0], cy: c[1]}); };
    const arc = (cx, cy, r, a0, a1) => { sp++; for (let i = 0; i < 16; i++) { const t0 = a0 + (a1 - a0) * i / 16, t1 = a0 + (a1 - a0) * (i + 1) / 16; seg([cx + r * Math.cos(t0), cy + r * Math.sin(t0)], [cx + r * Math.cos(t1), cy + r * Math.sin(t1)], "DOOR", 1); } };
    wall(-0.75, -0.75, 47.75, 0); wall(-0.75, 30, 47.75, 30.75); wall(-0.75, 0, 0, 30); wall(47, 0, 47.75, 30);
    // the terrace above the bed room (x 2..14, y -4.25..-0.75) inside its RALL railing; beyond the railing a 1.4 ft pipe ledge to the slab's edge
    wall(1.25, -5.9, 2, -0.75); wall(14, -5.9, 14.75, -0.75); wall(2, -5.9, 14, -5.65);
    sp++; seg([2, -4.25], [14, -4.25], "RALL");
    text("TERRACE", 8, -2.5);
    // bed room 12 × 14 (x 0..12, y 0..14); its dress 5 × 5 (x 12..17, y 0..5) open to it, no wall between
    wall(12, 5, 12.5, 14.5); wall(12.5, 5, 17.5, 5.5); wall(17, 0, 17.5, 5.5); wall(0, 14, 12.5, 14.5);
    text('BED ROOM 12\'-0"X14\'-0"', 6, 7); text('DRESS 5\'-0"X5\'-0"', 14.5, 2.5);
    text("LOUNGE", 8, 22);
    // a store (x 18.5..24.5, y 10..15) and the flat's foyer (x 25..30, y 10..15), a door between; the foyer open to the lobby, a column
    // 5/8" proud of the lobby's wall face (x 30) at its mouth's top
    wall(18, 9.5, 29.5, 10); wall(18, 15, 29.5, 15.5); wall(18, 9.5, 18.5, 15.5); wall(24.5, 10, 25, 11); wall(24.5, 14, 25, 15);
    arc(25, 11, 3, 0, Math.PI / 2); sp++; seg([25, 11], [28, 11], "DOOR");
    rect(29.3, 8.25, 30.052, 10, "Column"); rect(29.3, 8.25, 30.052, 10, "253", 4);
    text('STORE 6\'-0"X5\'-0"', 21.5, 12.5);
    // the lift lobby (x 30..40, y 0..30); the stair (x 40..47, y 6..18) open to it, a railing on the lobby's wall line from the top
    // to 3 ft short of the bottom (the way in); treads 0.9 ft apart, UP written on it — no name
    wall(29.5, 0, 30, 10); wall(29.5, 15, 30, 30); wall(40, 0, 40.5, 6); wall(40, 18, 40.5, 30);
    wall(40, 5.5, 47, 6); wall(40, 18, 47, 18.5);
    sp++; seg([40, 6], [40, 15], "RALL");
    for (let y = 7; y <= 17.01; y += 0.9) { sp++; seg([41, y], [46, y], "stairs"); }
    text("LIFT LOBBY", 35, 24); text("UP", 43.5, 17.4);
    return {segs, lines}; };
  const plan = (ox, oy) => {   // one flat, its top-left inside corner at (ox, oy) ft; -> {segs, lines}
    const segs = [], lines = []; let sp = 1;
    const P = (x, y) => [(ox + x) * K + 50, (oy + y) * K + 50];
    const seg = (a, b, lay, f) => { const p = P(...a), q = P(...b); segs.push([p[0], p[1], q[0], q[1], f || 0, L[lay], sp]); };
    const rect = (x0, y0, x1, y1, lay, f) => { sp++; seg([x0, y0], [x1, y0], lay, f); seg([x1, y0], [x1, y1], lay, f); seg([x1, y1], [x0, y1], lay, f); seg([x0, y1], [x0, y0], lay, f); };
    const wall = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, "walls");
    const text = (s, x, y) => { const c = P(x, y), h = 0.6 * K, w = s.length * h * 0.6; lines.push({s, x: c[0] - w / 2, y: c[1] + h / 2, w, h, r: 0, cx: c[0], cy: c[1]}); };
    const arc = (cx, cy, r, a0, a1) => { sp++; for (let i = 0; i < 8; i++) { const t0 = a0 + (a1 - a0) * i / 8, t1 = a0 + (a1 - a0) * (i + 1) / 8; seg([cx + r * Math.cos(t0), cy + r * Math.sin(t0)], [cx + r * Math.cos(t1), cy + r * Math.sin(t1)], "DOOR", 1); } };
    const door = (hx, hy, r, a0, a1, leaf) => { arc(hx, hy, r, a0, a1); sp++; seg([hx, hy], leaf, "DOOR");   // the swing, its leaf, and the frame's small lines
      for (const [dx, dy] of [[0.1, 0.1], [-0.1, 0.1], [0.1, -0.1], [-0.1, -0.1]]) { sp++; seg([hx, hy], [hx + dx, hy + dy], "DOOR"); } };
    // the external walls, 9": inside faces at x 0..40, y 0..30; the bed room's window (x 3..7) closed by WIN lines
    wall(-0.75, -0.75, 3, 0); wall(7, -0.75, 40.75, 0); [-0.75, -0.375, 0].forEach(y => { sp++; seg([3, y], [7, y], "WIN"); });
    wall(-0.75, 30, 40.75, 30.75); wall(-0.75, 0, 0, 30); wall(40, 0, 40.75, 30);
    // bed room 12 × 14 (x 0..12, y 0..14) with a 1 × 2 ft column filled solid in its top-right corner; its door (x 8..11) to the passage
    wall(12, 0, 12.5, 14.5); wall(0, 14, 8, 14.5); wall(11, 14, 12, 14.5);
    rect(11, 0, 12, 2, "Column"); rect(11, 0, 12, 2, "253", 4);
    door(8, 14, 3, -Math.PI / 2, 0, [8, 11]);
    text('BED ROOM 12\'-0"X14\'-0"', 5, 8);
    // drawing room 12 × 14 (x 12.5..24.5, y 0..14), open below to the lounge across a dashed beam line
    wall(24.5, 0, 25, 15.5); wall(24.5, 18.5, 25, 30);
    seg([12.5, 14], [24.5, 14], "DASHED", 2); seg([12.5, 13.5], [24.5, 13.5], "DASHED", 2);
    text('DRAWING 12\'-0"X14\'-0"', 18.5, 7);
    // lounge 12 × 16 (x 12.5..24.5, y 14..30), open on its left to the passage (x 0..12.5, y 14.5..18.5); the store below the passage
    wall(0, 18.5, 2, 19); wall(5, 18.5, 12.5, 19); wall(12, 19, 12.5, 30);
    text('LOUNGE 12\'-0"X16\'-0"', 18.5, 24); text('PASSAGE 4\'-0" WIDE', 6, 16.5); text('STORE 12\'-0"X11\'-0"', 6, 25);
    // a grid line on the Column layer, right across the lounge and the store
    sp++; seg([-12, 22], [52, 22], "Column");
    // kitchen 5 × 14 (x 25..30, y 0..14), open to the foyer (x 27.5..29.5); the foyer 5 × 5 (x 25..30, y 14.5..19.5): open to the lobby
    // (x 27..29), a door into the lounge
    wall(30, 0, 30.5, 20); wall(25, 14, 27.5, 14.5); wall(29.5, 14, 40, 14.5); wall(25, 19.5, 27, 20); wall(29, 19.5, 30.5, 20);
    door(25, 15.5, 3, 0, Math.PI / 2, [28, 15.5]);
    text('KITCHEN 5\'-0"X14\'-0"', 27.5, 7);
    // the lobby (x 25..40, y 20..30); the stair (x 30.5..37, y 0..14): treads 0.9 ft apart across both flights, a rail between them;
    // open on its right to the passage (x 37..40)
    text("LOBBY", 33, 25);
    for (let x = 31.5; x <= 37.01; x += 0.9) { sp++; seg([x, 1], [x, 13], "stairs"); }
    sp++; seg([31.5, 7], [36.9, 7], "RALL"); seg([31.5, 7.2], [36.9, 7.2], "RALL");
    text("STAIR", 34, 4); text("PASSAGE", 38.5, 7);
    // the terrace outside the bottom wall (x 0..12, y 30.75..34), its railing on RALL
    sp++; seg([0, 34], [12, 34], "RALL"); seg([0, 30.75], [0, 34], "RALL"); seg([12, 30.75], [12, 34], "RALL");
    text("TERRACE", 6, 32.4);
    return {segs, lines};
  };
  const A = plan(0, 0), B = plan(150, 0), C = openPlan(0, 80), D = plan2(150, 80), segs = A.segs.concat(B.segs, C.segs, D.segs), lines = A.lines.concat(B.lines, C.lines, D.lines);
  // an elevation drawn on the wall layer: lines, no names
  for (let i = 0; i < 6; i++) { const y0 = i * 9; [[300, y0, 360, y0], [300, y0, 300, y0 + 8], [360, y0, 360, y0 + 8], [300, y0 + 8, 360, y0 + 8]].forEach(([a, b, c, d]) => segs.push([a * K + 50, b * K + 50, c * K + 50, d * K + 50, 0, L.walls, 900 + i])); }
  const t0 = Date.now(), R = T.traceFloor({segs, layers, lines, k: K}, {});
  console.log(`traced in ${Date.now() - t0} ms: ${R.err ? "ERROR " + R.err + " " + (R.why || "") : (R.spaces || []).length + " spaces, " + R.plans + " plans"}`);
  if (R.err) process.exit(1);
  const top = s => (s.bounds[1] + s.bounds[3]) / 2 < 60 * K + 50, first = s => top(s) && (s.bounds[0] + s.bounds[2]) / 2 < 100 * K + 50;   // the first copy: top left of the sheet
  const ft2 = s => s.sft, find = (nm, x) => R.spaces.filter(s => s.names.some(n => n.startsWith(nm)) && (x == null || first(s)));
  const one = (nm) => { const L0 = find(nm, 100); return L0.length === 1 ? L0[0] : null; };   // in the first copy
  console.log("the sheet");
  ok(R.plans === 4, "four plans found and traced one by one; the elevation (no names) left out (" + R.plans + ")");
  ok(R.spaces.filter(s => s.names[0].startsWith("BED ROOM")).length === 4, "each plan has its bed room");
  ok(R.log.some(l => /grid line/.test(l)), "the grid line on the Column layer is left out: " + (R.log.find(l => /grid line/.test(l)) || "—"));
  console.log("the first plan");
  const bed = one("BED ROOM"), dr = one("DRAWING"), lo = one("LOUNGE"), pa = find("PASSAGE 4", 100)[0], st = one("STORE"), ki = one("KITCHEN"), lob = one("LOBBY"), ter = one("TERRACE");
  ok(bed && near(ft2(bed), 168 - 2, 1.2), "bed room 12 × 14 less the 1 × 2 column filled solid = 166 Sft — the column is wall, the window closed (" + (bed && ft2(bed).toFixed(2)) + ")");
  ok(dr && near(ft2(dr), 168, 2.5), "drawing room apart from the lounge it is open to (a dashed beam line between): 12 × 14 = 168 Sft (" + (dr && ft2(dr).toFixed(2)) + ")");
  ok(lo && near(ft2(lo), 192, 2.5), "lounge 12 × 16 = 192 Sft, not cut by the grid line, split from its passage and drawing room (" + (lo && ft2(lo).toFixed(2)) + ")");
  ok(pa && near(ft2(pa), 50, 2.5), "passage 12.5 × 4 = 50 Sft, its own space on the wall line from the bed room's corner (" + (pa && ft2(pa).toFixed(2)) + ")");
  ok(lo && dr && [lo, dr].every(s => s.how === "manual" && s.notes.some(n => /split from|no wall between/.test(n))), "…the lounge and drawing room noted as split where the drawing has no wall");
  ok(st && near(ft2(st), 132, 1.5), "store 12 × 11 = 132 Sft, not cut by the grid line (" + (st && ft2(st).toFixed(2)) + ")");
  ok(ki && near(ft2(ki), 70, 1.2), "kitchen 5 × 14 = 70 Sft (" + (ki && ft2(ki).toFixed(2)) + ")");
  const fy = find("FOYER", 100);
  ok(fy.length === 1 && near(ft2(fy[0]), 25, 1), "the unnamed 5 × 5 behind the lounge's door, open to the lobby: FOYER, 25 Sft (" + (fy[0] ? ft2(fy[0]).toFixed(2) : "none") + ")");
  ok(lob && lob.kind === "corridor" && near(ft2(lob), 150 + 9.5 * 5.5, 2), "the lobby 15 × 10 + its arm beside the foyer 9.5 × 5.5 = 202.25 Sft, without the foyer (" + (lob && ft2(lob).toFixed(2)) + ")");
  ok(R.log.some(l => /door swing/.test(l)), "door swings found though drawn with their frame lines: " + (R.log.find(l => /door swing/.test(l)) || "—"));
  const stair = R.spaces.filter(s => s.kind === "stair" && first(s)), sp2 = R.spaces.filter(s => s.names[0] === "PASSAGE" && !s.unlabelled && first(s));
  ok(R.log.some(l => /between two stair flights/.test(l)), "the rail between the stair's flights is no boundary");
  ok(stair.length === 1, "one stair space, its two flights together (" + stair.length + ")");
  ok(sp2.length === 1 && near(ft2(sp2[0]), 3.1 * 14, 3), "the passage beside it cut off on the last riser: about 3.1 × 14 = 43.4 Sft (" + (sp2[0] ? ft2(sp2[0]).toFixed(2) : "none") + ")");
  ok(ter && ter.kind === "balcony" && near(ft2(ter), 12 * 3.25, 1.5), "terrace inside its RALL railing: 12 × 3.25 = 39 Sft, a balcony (" + (ter && ft2(ter).toFixed(2) + " " + ter.kind) + ")");
  console.log("the second plan: the same");
  const b2 = R.spaces.find(s => s.names[0].startsWith("BED ROOM") && top(s) && s.bounds[0] > 100 * K + 50), l2 = R.spaces.find(s => s.names[0].startsWith("LOUNGE") && top(s) && s.bounds[0] > 100 * K + 50);
  ok(b2 && bed && near(ft2(b2), ft2(bed), 0.05) && l2 && lo && near(ft2(l2), ft2(lo), 0.05), "its bed room and lounge as in the first, in its own place on the page");
  console.log("a lounge open along its whole side to a passage");
  const inC = s => (s.bounds[1] + s.bounds[3]) / 2 > 60 * K + 50 && (s.bounds[0] + s.bounds[2]) / 2 < 100 * K + 50, loC = R.spaces.find(s => inC(s) && s.names[0].startsWith("LOUNGE")), paC = R.spaces.find(s => inC(s) && s.names[0].startsWith("PASSAGE"));
  ok(loC && near(loC.sft, 15 * 12.5, 2), "the lounge to the bed room's wall line, its written size: 15 × 12.5 = 187.5 Sft (" + (loC && loC.sft.toFixed(2)) + ")");
  ok(paC && near(paC.sft, 30 * 3.5 + 3 * 0.5, 2.5), "the passage the full length below: 30 × 3.5 = 105 Sft (and the bed room's door opening) (" + (paC && paC.sft.toFixed(2)) + ")");
  ok(R.splits.some(x => /LOUNGE/.test(x.what) && /PASSAGE/.test(x.what)), "the split line between them is recorded (for the L-09 corrections layer)");
  console.log("the fourth plan");
  const inD = s => (s.bounds[1] + s.bounds[3]) / 2 > 60 * K + 50 && (s.bounds[0] + s.bounds[2]) / 2 > 100 * K + 50, inDn = nm => R.spaces.filter(s => inD(s) && s.names.some(n => n.startsWith(nm)));
  const tD = inDn("TERRACE")[0], bD = inDn("BED ROOM")[0], dD = inDn("DRESS")[0], fD = inDn("FOYER")[0], lD = inDn("LIFT LOBBY")[0], sD = R.spaces.filter(s => inD(s) && s.kind === "stair");
  ok(tD && near(tD.sft, 12 * 3.5, 1.5), "terrace inside its railing 12 × 3.5 = 42 Sft, the pipe ledge beyond the railing left out (" + (tD && tD.sft.toFixed(2)) + ")");
  ok(R.log.some(l => /beyond the railing/.test(l)), "…the trace says so: " + (R.log.find(l => /beyond the railing/.test(l)) || "—"));
  ok(dD && near(dD.sft, 25, 1.5) && bD && near(bD.sft, 168, 2.5), "the dress with its own written size apart from the bed room it is open to: 25 and 168 Sft (" + (dD && dD.sft.toFixed(2)) + ", " + (bD && bD.sft.toFixed(2)) + ")");
  ok(fD && near(fD.sft, 25, 1.5), "the foyer 5 × 5 = 25 Sft closed off from the lobby though a column stands 5/8\" proud at its mouth (" + (fD ? fD.sft.toFixed(2) : "none") + ")");
  ok(sD.length === 1 && near(sD[0].sft, 7 * 12, 3), "the stair with no name found from its treads, kept out of the lobby: 7 × 12 = 84 Sft (" + (sD[0] ? sD[0].sft.toFixed(2) + " " + sD[0].names[0] : "none") + ")");
  ok(lD && lD.kind === "corridor" && near(lD.sft, 10 * 30, 3), "the lift lobby 10 × 30 = 300 Sft, to the railing's line (" + (lD && lD.sft.toFixed(2)) + ")");
  console.log("a plan at a PDF's scale (9 pt / ft) is traced as before, on its own");
  const S9 = 10, P9 = A.segs.map(s => [s[0] * S9, s[1] * S9, s[2] * S9, s[3] * S9, s[4], s[5], s[6]]), T9 = A.lines.map(t => Object.assign({}, t, {x: t.x * S9, y: t.y * S9, w: t.w * S9, h: t.h * S9, cx: t.cx * S9, cy: t.cy * S9}));
  const R9 = T.traceFloor({segs: P9, layers, lines: T9, k: K * S9}, {}), bed9 = R9.spaces && R9.spaces.find(s => s.names[0].startsWith("BED ROOM"));
  ok(!R9.err && R9.plans === undefined && bed9 && near(bed9.sft, ft2(bed), 0.3), "one plan, no plan finding: bed room " + (bed9 && bed9.sft.toFixed(2)) + " Sft");
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

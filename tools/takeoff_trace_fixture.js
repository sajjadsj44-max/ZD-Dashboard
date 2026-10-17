/* A small floor drawn the way an AutoCAD plot draws it, for the vector trace (takeoff/trace.js): wall outlines on a "Wall"
   layer, the walls' hatch on "WH" (running past the faces, not clipped — as a PDF reader hands it over), a duct box on
   "DUCTS", room names with their written sizes. 18 pt per ft; the plan's corner at (100, 100) pt, y down. Every quantity
   the tests check is worked out by hand from this drawing:

     30 × 20 ft outside, 9" external walls; a 4½" partition at x 15 with an open 3 ft door (y 12–15); a 4½" partition at
     y 10 from it to the external wall with a 2'-6" door drawn closed (x 20–22.5: the outline runs on, the hatch stops);
     a 2 × 1.5 ft duct box in the bath's corner.
       BED ROOM 14'-3" x 18'-6"        263.625 Sft
       BATH     13'-10 1/2" x 9'-3"    125.344 Sft (128.344 less the 3 Sft duct)
       LOUNGE   13'-10 1/2" x 8'-10 1/2" 123.141 Sft
     thresholds 3 × 0.375 (open) and 2.5 × 0.375 (closed); walls 82.828 Sft; the floor 600 Sft

     node tools/takeoff_trace_fixture.js out.pdf      (writes the PDF) */
const K = 18, O = 100, X = f => O + f * K, PW = 800, PH = 600;
const WALL = 0, WH = 1, DUCTS = 2, LAYERS = [{name: "Wall", role: "wall"}, {name: "WH", role: "fixture"}, {name: "DUCTS", role: "other"}, {name: "Text", role: "text"}];
const segs = [];
const L = (x0, y0, x1, y1, lay) => segs.push([X(x0), X(y0), X(x1), X(y1), 0, lay]);
const rect = (x0, y0, x1, y1, lay) => { L(x0, y0, x1, y0, lay); L(x1, y0, x1, y1, lay); L(x1, y1, x0, y1, lay); L(x0, y1, x0, y0, lay); };
const hatch = (x0, y0, x1, y1, over) => {   // 45° hatch every 3 pt over a wall band, running `over` pt past its faces
  const a = X(x0) - over, b = X(y0) - over, c = X(x1) + over, d = X(y1) + over;
  for (let t = a + b; t < c + d; t += 3) { const p = [], cl = (x, y) => { if (x >= a - 1e-9 && x <= c + 1e-9 && y >= b - 1e-9 && y <= d + 1e-9) p.push([x, y]); };
    cl(a, t - a); cl(c, t - c); cl(t - b, b); cl(t - d, d); if (p.length >= 2) segs.push([p[0][0], p[0][1], p[1][0], p[1][1], 0, WH]); } };
rect(0, 0, 30, 20, WALL); rect(0.75, 0.75, 29.25, 19.25, WALL);
hatch(0, 0, 30, 0.75, 1.5); hatch(0, 19.25, 30, 20, 1.5); hatch(0, 0.75, 0.75, 19.25, 1.5); hatch(29.25, 0.75, 30, 19.25, 1.5);
L(15, 0.75, 15, 12, WALL); L(15.375, 0.75, 15.375, 12, WALL); L(15, 12, 15.375, 12, WALL);
L(15, 15, 15, 19.25, WALL); L(15.375, 15, 15.375, 19.25, WALL); L(15, 15, 15.375, 15, WALL);
hatch(15, 0.75, 15.375, 12, 0); hatch(15, 15, 15.375, 19.25, 0);
L(15.375, 10, 29.25, 10, WALL); L(15.375, 10.375, 29.25, 10.375, WALL);
hatch(15.375, 10, 20, 10.375, 0); hatch(22.5, 10, 29.25, 10.375, 0);
rect(27.25, 0.75, 29.25, 2.25, DUCTS); L(27.25, 0.75, 29.25, 2.25, DUCTS); L(29.25, 0.75, 27.25, 2.25, DUCTS);
// names and written sizes: [text, centre x ft, baseline y ft]
const TEXT = [["BED ROOM", 7.5, 9], ["14'-3\"x18'-6\"", 7.5, 9.55], ["BATH", 21, 5], ["13'-10 1/2\"x9'-3\"", 21, 5.55],
  ["LOUNGE", 21, 14.5], ["13'-10 1/2\"x8'-10 1/2\"", 21, 15.05], ["101", 7.5, 12], ["30'-0\"", 15, -1]];
const FS = 7, tw = s => s.length * FS * 0.5;
const text = TEXT.map(([s, xf, yf]) => ({s, x: X(xf) - tw(s) / 2, y: X(yf) - FS, w: tw(s), h: FS, r: 0, cx: X(xf), cy: X(yf) - FS / 2}));
const at = {bed: [X(7.5), X(5)], bath: [X(21), X(7)], lounge: [X(21), X(17)], door: [X(15.19), X(13.5)], shut: [X(21.25), X(10.19)]};
function tracePdf(){   // a one-page PDF: the lines on their layers (optional content), the text on no layer
  const ocg = [5, 6, 7], names = ["Wall", "WH", "DUCTS"], by = [[], [], []];
  segs.forEach(s => by[s[5]].push(`${s[0].toFixed(3)} ${(PH - s[1]).toFixed(3)} m ${s[2].toFixed(3)} ${(PH - s[3]).toFixed(3)} l S`));
  const esc = s => s.replace(/([()\\])/g, "\\$1");
  const content = ["0.5 w 1 J 1 j"].concat(by.map((ls, i) => `/OC /L${i} BDC\n${ls.join("\n")}\nEMC`),
    TEXT.map(([s, xf, yf]) => `BT /F1 ${FS} Tf ${(X(xf) - tw(s) / 2).toFixed(3)} ${(PH - X(yf)).toFixed(3)} Td (${esc(s)}) Tj ET`)).join("\n");
  const objs = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${ocg.map(n => n + " 0 R").join(" ")}] /D << /Order [${ocg.map(n => n + " 0 R").join(" ")}] /ON [${ocg.map(n => n + " 0 R").join(" ")}] >> >> >>`);
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents 4 0 R /Resources << /Properties << ${ocg.map((n, i) => "/L" + i + " " + n + " 0 R").join(" ")} >> /Font << /F1 8 0 R >> >> >>`);
  objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  names.forEach(n => objs.push(`<< /Type /OCG /Name (${n}) >>`));
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  let out = "%PDF-1.5\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
/* plan B — a drawing plotted without its wall hatch (as the Phoenix 3rd floor was): 24 × 16 ft outside, 9" walls, no hatch at all,
   the wall outlines joined where walls meet (as AutoCAD draws them).
     a 9" wall at x 12 with an open 3 ft door (y 11–14): the BED ROOM (11'-3" x 14'-6", 163.125 Sft) left of it; right of it the
     LOUNGE, with a BATH in its top-left corner (x 12.75–18, y 0.75–6.5) whose door sits across the corner: the bath's right wall
     stops at y 4, its bottom wall at x 15.25, and only the door — its leaf hinged at (15.25, 6.5), open into the lounge, and its
     dashed swing back to (18, 4) — closes the opening.
       BATH 5.25 × 5.75 − the corner 2.75 × 2.5 / 2 = 26.75 Sft; LOUNGE 10.5 × 14.5 − the bath − its walls (3.25 × 0.75 + 2.5 × 0.75)
       = 121.1875 Sft; the door 3 × 0.75 = 2.25 Sft; the floor 384 Sft
     A stair note (STAIR = 4'-6" WIDE) in the lounge and a riser count (24 DN) in the bed room are no room names. */
const WALLB = 0, DOORB = 1, LAYERS_B = [{name: "Wall", role: "wall"}, {name: "Door", role: "opening"}, {name: "Text", role: "text"}];
const segsB = [], LB = (x0, y0, x1, y1, lay) => segsB.push([X(x0), X(y0), X(x1), X(y1), 0, lay == null ? WALLB : lay]);
[[0, 0, 24, 0], [24, 0, 24, 16], [24, 16, 0, 16], [0, 16, 0, 0],                                              // outer face
 [0.75, 0.75, 12, 0.75], [12.75, 0.75, 18, 0.75], [18.75, 0.75, 23.25, 0.75], [23.25, 0.75, 23.25, 15.25],    // inner face, broken where walls meet it
 [0.75, 15.25, 12, 15.25], [12.75, 15.25, 23.25, 15.25], [0.75, 0.75, 0.75, 15.25],
 [12, 0.75, 12, 11], [12.75, 0.75, 12.75, 6.5], [12.75, 7.25, 12.75, 11], [12, 11, 12.75, 11],                // the wall at x 12, its door y 11–14
 [12, 14, 12, 15.25], [12.75, 14, 12.75, 15.25], [12, 14, 12.75, 14],
 [18, 0.75, 18, 4], [18.75, 0.75, 18.75, 4], [18, 4, 18.75, 4],                                               // the bath's right wall, to y 4
 [12.75, 6.5, 15.25, 6.5], [12.75, 7.25, 15.25, 7.25], [15.25, 6.5, 15.25, 7.25]].forEach(l => LB(...l));    // its bottom wall, to x 15.25
{ const H = [15.25, 6.5], C = [18, 4], r = Math.hypot(C[0] - H[0], C[1] - H[1]), aC = Math.atan2(C[1] - H[1], C[0] - H[0]), aA = aC + Math.PI / 2;
  LB(H[0], H[1], H[0] + r * Math.cos(aA), H[1] + r * Math.sin(aA), DOORB);                                   // the leaf, open into the lounge
  const st = 3 / (r * K), gp = 2 / (r * K); for (let t = aA; t > aC + 1e-9; t -= st + gp) { const t2 = Math.max(aC, t - st);   // its swing, dashed
    LB(H[0] + r * Math.cos(t), H[1] + r * Math.sin(t), H[0] + r * Math.cos(t2), H[1] + r * Math.sin(t2), DOORB); } }
const TEXT_B = [["BED ROOM", 6, 7], ["11'-3\"x14'-6\"", 6, 7.55], ["24 DN", 6, 12], ["BATH", 15.4, 3], ["5'-3\"x5'-9\"", 15.4, 3.55], ["LOUNGE", 19, 11], ["STAIR = 4'-6\" WIDE", 19, 13]];
const textB = TEXT_B.map(([s, xf, yf]) => ({s, x: X(xf) - tw(s) / 2, y: X(yf) - FS, w: tw(s), h: FS, r: 0, cx: X(xf), cy: X(yf) - FS / 2}));
const planB = {segs: segsB, layers: LAYERS_B, lines: textB, at: {bed: [X(6), X(4)], bath: [X(14), X(2)], lounge: [X(20), X(9)]}};
module.exports = {K, O, X, segs, text, LAYERS, WALL, WH, DUCTS, at, tracePdf, PW, PH, planB};
if (require.main === module) { const out = process.argv[2] || "trace.pdf"; require("fs").writeFileSync(out, tracePdf()); console.log("wrote " + out); }

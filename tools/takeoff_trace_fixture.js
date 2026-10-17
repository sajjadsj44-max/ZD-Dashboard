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
module.exports = {K, O, X, segs, text, LAYERS, WALL, WH, DUCTS, at, tracePdf, PW, PH};
if (require.main === module) { const out = process.argv[2] || "trace.pdf"; require("fs").writeFileSync(out, tracePdf()); console.log("wrote " + out); }

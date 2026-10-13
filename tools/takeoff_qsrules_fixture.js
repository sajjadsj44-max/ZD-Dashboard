#!/usr/bin/env node
/* Drawings for the QS house rules learned from marked-up Bluebeam takeoffs (tools/test_takeoff_qsrules.js): a PDF written by
   hand, no library, so every quantity in it is known. Generated drawings only — no project drawing is used or published.

     node tools/takeoff_qsrules_fixture.js out.pdf

   p.1  1/8" = 1'-0" (9 pt per ft) — Auto area in wet rooms (BATHS):
        A  BATH 6'-0" × 8'-0" inside 4½" walls, a shower in one corner shut off by a 4" partition, a floor trap drawn in it:
           the shower and the partition are part of the bath (48 Sft, as measured by hand)
        B  the same with the corner space empty (a cupboard behind the partition): left out
        C  the same with a floor trap and DUCT written in it: left out (a duct)
   p.2  1/8" = 1'-0" — 🧱 Block masonry: a 40' × 30' plan, 8" external walls with a column in one, an 8" internal wall between
        two flats, a 4" partition with a 3'-6" door (tag D2), and a balcony with a 4" parapet (not block work).
        Centre lines: external 2 × (39.33 + 29.33) = 137.32 ft less the 1.5 ft column = 135.82 ft; internal 28.66 ft; 4" 19.00 ft.
   Coordinates in the tables are the app's (y down from the top of the page). */
const {pdfFrom} = require("./takeoff_qa_fixture.js");
const W = 2592, H = 1728, K = 9;

function canvas(){
  const L = [], T = [], C = [];
  const line = (x0, y0, x1, y1, w) => L.push([x0, y0, x1, y1, w || 0.6]);
  const rect = (x0, y0, x1, y1, w) => { line(x0, y0, x1, y0, w); line(x1, y0, x1, y1, w); line(x1, y1, x0, y1, w); line(x0, y1, x0, y0, w); };
  const text = (x, y, s, sz) => T.push([x, y, s, sz || 8]);
  const circle = (cx, cy, r) => C.push([cx, cy, r]);
  const content = () => ["1 J 1 j"].concat(L.map(l => `${l[4]} w ${l[0].toFixed(3)} ${(H - l[1]).toFixed(3)} m ${l[2].toFixed(3)} ${(H - l[3]).toFixed(3)} l S`),
    C.map(([cx, cy, r]) => { const y = H - cy, m = 0.5523 * r, n = v => v.toFixed(3);
      return `0.4 w ${n(cx + r)} ${n(y)} m ${n(cx + r)} ${n(y + m)} ${n(cx + m)} ${n(y + r)} ${n(cx)} ${n(y + r)} c ${n(cx - m)} ${n(y + r)} ${n(cx - r)} ${n(y + m)} ${n(cx - r)} ${n(y)} c ${n(cx - r)} ${n(y - m)} ${n(cx - m)} ${n(y - r)} ${n(cx)} ${n(y - r)} c ${n(cx + m)} ${n(y - r)} ${n(cx + r)} ${n(y - m)} ${n(cx + r)} ${n(y)} c S`; }),
    T.map(t => `BT /F1 ${t[3]} Tf ${t[0].toFixed(3)} ${(H - t[1]).toFixed(3)} Td (${t[2].replace(/([()\\])/g, "\\$1")}) Tj ET`),
    ["BT /F1 14 Tf 2200 60 Td (SCALE 1/8\" = 1'-0\") Tj ET"]).join("\n");
  return {line, rect, text, circle, content};
}

/* p.1: three baths, 6 × 8 ft inside 4½" walls; the corner space 2'-8" × 3'-0" behind an L of 4" partition */
const P1 = canvas(), BATHS = [];
[["A", "trap"], ["B", "empty"], ["C", "duct"]].forEach(([id, what], n) => {
  const ox = 300 + n * 700, oy = 400, X = v => ox + v * K, Y = v => oy + v * K, t = 0.375, p = 0.33;
  P1.rect(X(0), Y(0), X(6), Y(8)); P1.rect(X(-t), Y(-t), X(6 + t), Y(8 + t));
  // the partition: two lines each way, from the top wall down and across to the right wall, its end capped
  P1.line(X(3), Y(0), X(3), Y(3 + p)); P1.line(X(3 + p), Y(0), X(3 + p), Y(3));
  P1.line(X(3 + p), Y(3), X(6), Y(3)); P1.line(X(3), Y(3 + p), X(6), Y(3 + p));
  if (what !== "empty") { P1.circle(X(4.67), Y(1.5), 0.25 * K); P1.line(X(4.42), Y(1.5), X(4.92), Y(1.5), 0.3); P1.line(X(4.67), Y(1.25), X(4.67), Y(1.75), 0.3); }
  if (what === "duct") P1.text(X(3.7), Y(2.6), "DUCT", 6);
  P1.text(X(1), Y(5.2), "BATH " + id, 8); P1.text(X(1), Y(6.2), "6'-0\"x8'-0\"", 7);
  BATHS.push({name: "BATH " + id, what, click: [X(1.5), Y(7)], area: what === "trap" ? 48 : null, without: 48 - (3 + p) * (3 + p) + p * 0});
});

/* p.2: the block-work plan, outer corner at (ox, oy) */
const P2 = canvas(), ox = 600, oy = 500, X = v => ox + v * K, Y = v => oy + v * K, e = 0.67, q = 0.33;
P2.rect(X(0), Y(0), X(40), Y(30)); P2.rect(X(e), Y(e), X(40 - e), Y(30 - e));   // 8" external walls
P2.rect(X(19), Y(30 - e), X(20.5), Y(30));   // a column in the bottom wall, concrete hatch (specks) in it
for (let x = 19.08; x < 20.45; x += 0.15) for (let y = 30 - e + 0.08; y < 29.96; y += 0.15) P2.line(X(x), Y(y), X(x + 0.05), Y(y + 0.03), 0.3);
P2.line(X(20 - q), Y(e), X(20 - q), Y(30 - e)); P2.line(X(20 + q), Y(e), X(20 + q), Y(30 - e));   // the 8" internal wall (centre 20, 0.67 thick)
// the 4" partition in the left flat (centre y = 15), a 3'-6" door from x = 8 to 11.5 with jamb caps
const py0 = 15 - q / 2, py1 = 15 + q / 2;
[[e, 8], [11.5, 20 - q]].forEach(([a, b]) => { P2.line(X(a), Y(py0), X(b), Y(py0)); P2.line(X(a), Y(py1), X(b), Y(py1)); });
P2.line(X(8), Y(py0), X(8), Y(py1)); P2.line(X(11.5), Y(py0), X(11.5), Y(py1));
P2.text(X(9.2), Y(13.6), "D2", 7);
// the balcony outside the top wall of the left flat: a 4" parapet, 4 ft out
P2.rect(X(2), Y(-4), X(18), Y(-4 + q)); P2.line(X(2), Y(-4 + q), X(2), Y(0)); P2.line(X(2 + q), Y(-4 + q), X(2 + q), Y(0));
P2.line(X(18), Y(-4 + q), X(18), Y(0)); P2.line(X(18 - q), Y(-4 + q), X(18 - q), Y(0));
P2.text(X(8), Y(-1.8), "BALCONY", 8);
P2.text(X(8), Y(8), "BEDROOM", 8); P2.text(X(8), Y(22), "LOUNGE", 8); P2.text(X(28), Y(15), "BEDROOM", 8);
const BLOCK = {k: K, ext: 2 * (40 - e + 30 - e) - 1.5, int: 30 - 2 * e, part: 20 - q - e, tag: "D2", tagAt: [X(9.4), Y(13.4)], doorW: 3.5};

const makeQsRulesPdf = () => pdfFrom([{w: W, h: H, content: P1.content()}, {w: W, h: H, content: P2.content()}]);
module.exports = {makeQsRulesPdf, BATHS, BLOCK, K};
if (require.main === module) { require("fs").writeFileSync(process.argv[2] || "qsrules.pdf", makeQsRulesPdf()); console.log("written"); }

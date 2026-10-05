#!/usr/bin/env node
/* Auto area regression drawings for the PDF Takeoff app (tools/test_takeoff_autoarea.js): a PDF written by hand, no
   library, so every clear area in it is known exactly.

     node tools/takeoff_autoarea_fixture.js out.pdf

   p.1  ARCH D 2592 × 1728 pt, "SCALE 1/8" = 1'-0"" (9 pt per ft), eight rooms (CASES1):
        thin single-line 10 × 10 room                                                     100 Sft
        the same room with every line drawn twice, overlapping collinear pieces and a 0.05 pt sliver   100 Sft
        12" walls, the room name and size written inside                                  100 Sft
        9" walls with a 3'-0" door opening and jamb returns (no leaf)                       100 Sft
        45° hatched floor with text inside                                                 100 Sft
        10 × 10 room with an 8'-0" hole in one wall                                       refused (leaks)
        irregular pentagon: 12'-0" wide, 8'-0" walls, 4'-0" gable                          120 Sft
        two 10 × 10 rooms sharing a wall (the left one clicked)                            100 Sft
   p.2  ARCH D at 1/16" = 1'-0" (4.5 pt per ft) (CASES2): a 20 × 20 single-line room (400 Sft) and a 16 × 12 room with
        9" walls (192 Sft).
   Coordinates in the tables are the app's (y down from the top of the page). */
const {pdfFrom} = require("./takeoff_qa_fixture.js");
const W = 2592, H = 1728;

function pageOf(k, cells, note){
  const L = [], T = [], ft = v => v * k;
  const line = (x0, y0, x1, y1, w) => L.push([x0, y0, x1, y1, w || 0.6]);
  const poly = (P, w) => P.forEach((p, i) => { const q = P[(i + 1) % P.length]; line(p[0], p[1], q[0], q[1], w); });
  const rect = (x0, y0, x1, y1, w) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], w);
  const text = (x, y, s, sz) => T.push([x, y, s, sz || 8]);
  const cases = [];
  cells.forEach(c => {
    const [ox, oy] = c.at, X = v => ox + ft(v), Y = v => oy + ft(v);
    switch (c.kind) {
      case "thin": rect(X(0), Y(0), X(c.w), Y(c.h)); break;
      case "double": {   // every line twice, one side as overlapping collinear pieces, a 0.05 pt sliver beside another
        rect(X(0), Y(0), X(c.w), Y(c.h)); rect(X(0), Y(0), X(c.w), Y(c.h));
        line(X(0), Y(0), X(c.w * 0.6), Y(0)); line(X(c.w * 0.4), Y(0), X(c.w), Y(0));
        line(X(c.w) + 0.05, Y(0), X(c.w) + 0.05, Y(c.h)); break; }
      case "walls": {   // inside face c.w × c.h, walls c.t ft thick, text inside
        rect(X(0), Y(0), X(c.w), Y(c.h)); rect(X(-c.t), Y(-c.t), X(c.w + c.t), Y(c.h + c.t));
        if (c.name) { text(X(c.w / 2 - 1.5), Y(c.h / 2 - 0.3), c.name); text(X(c.w / 2 - 2), Y(c.h / 2 + 1), c.size || ""); } break; }
      case "door": {   // 9" walls, a door opening in the bottom wall from c.d0 to c.d1 ft with jamb returns, no leaf
        const t = c.t, d0 = c.d0, d1 = c.d1;
        line(X(0), Y(0), X(c.w), Y(0)); line(X(c.w), Y(0), X(c.w), Y(c.h)); line(X(0), Y(c.h), X(0), Y(0));
        line(X(-t), Y(-t), X(c.w + t), Y(-t)); line(X(c.w + t), Y(-t), X(c.w + t), Y(c.h + t)); line(X(-t), Y(c.h + t), X(-t), Y(-t));
        line(X(0), Y(c.h), X(d0), Y(c.h)); line(X(d1), Y(c.h), X(c.w), Y(c.h));
        line(X(-t), Y(c.h + t), X(d0), Y(c.h + t)); line(X(d1), Y(c.h + t), X(c.w + t), Y(c.h + t));
        line(X(d0), Y(c.h), X(d0), Y(c.h + t)); line(X(d1), Y(c.h), X(d1), Y(c.h + t)); break; }
      case "hatch": {   // 45° hatch every 1 ft (each stroke clipped to the room), the name written over it
        rect(X(0), Y(0), X(c.w), Y(c.h));
        for (let s = 1; s < c.w + c.h; s++) { const a = [Math.max(0, s - c.h), Math.min(s, c.h)], b = [Math.min(s, c.w), Math.max(0, s - c.w)];
          line(X(a[0]), Y(c.h - a[1]), X(b[0]), Y(c.h - b[1]), 0.25); }
        text(X(c.w / 2 - 1.5), Y(c.h / 2 + 0.3), "HATCHED"); break; }
      case "hole": {   // the top wall broken by an opening c.d0 .. c.d1 ft
        line(X(0), Y(0), X(c.d0), Y(0)); line(X(c.d1), Y(0), X(c.w), Y(0));
        line(X(c.w), Y(0), X(c.w), Y(c.h)); line(X(c.w), Y(c.h), X(0), Y(c.h)); line(X(0), Y(c.h), X(0), Y(0)); break; }
      case "gable": poly([[X(0), Y(c.r)], [X(c.w / 2), Y(0)], [X(c.w), Y(c.r)], [X(c.w), Y(c.r + c.h)], [X(0), Y(c.r + c.h)]]); break;
      case "pair": rect(X(0), Y(0), X(2 * c.w), Y(c.h)); line(X(c.w), Y(0), X(c.w), Y(c.h)); break;
    }
    cases.push({name: c.name || c.kind, kind: c.kind, click: [X(c.click[0]), Y(c.click[1])], area: c.area, view: c.view});
  });
  const content = ["1 J 1 j"].concat(L.map(l => `${l[4]} w ${l[0].toFixed(3)} ${(H - l[1]).toFixed(3)} m ${l[2].toFixed(3)} ${(H - l[3]).toFixed(3)} l S`),
    T.map(t => `BT /F1 ${t[3]} Tf ${t[0].toFixed(3)} ${(H - t[1]).toFixed(3)} Td (${t[2].replace(/([()\\])/g, "\\$1")}) Tj ET`),
    [`BT /F1 14 Tf 2200 60 Td (SCALE ${note}) Tj ET`]).join("\n");
  return {page: {w: W, h: H, content}, cases};
}
// p.1 at 1/8" = 1'-0": eight cells 560 pt apart (x) and 700 pt (y); click points in ft from each room's inside corner
const K1 = 9, K2 = 4.5;
const P1 = pageOf(K1, [
  {kind: "thin", name: "THIN 10x10", at: [200, 200], w: 10, h: 10, click: [5, 5], area: 100},
  {kind: "double", name: "DOUBLED LINES", at: [760, 200], w: 10, h: 10, click: [5, 5], area: 100},
  {kind: "walls", name: "ROOM 12IN", size: "10'-0\"x10'-0\"", at: [1320, 200], w: 10, h: 10, t: 1, click: [7.5, 2.5], area: 100},
  {kind: "door", name: "DOOR 9IN", at: [1880, 200], w: 10, h: 10, t: 0.75, d0: 3.5, d1: 6.5, click: [5, 4], area: 100},
  {kind: "hatch", name: "HATCHED", at: [200, 900], w: 10, h: 10, click: [7.5, 2], area: 100},
  {kind: "hole", name: "HOLE 8FT", at: [760, 900], w: 10, h: 10, d0: 1, d1: 9, click: [5, 6], area: null},
  {kind: "gable", name: "GABLE", at: [1320, 900], w: 12, h: 8, r: 4, click: [6, 7], area: 120},
  {kind: "pair", name: "PAIR LEFT", at: [1880, 900], w: 10, h: 10, click: [5, 5], area: 100}], "1/8\" = 1'-0\"");
const P2 = pageOf(K2, [
  {kind: "thin", name: "THIN 20x20", at: [300, 300], w: 20, h: 20, click: [10, 10], area: 400},
  {kind: "walls", name: "ROOM 16x12", at: [1200, 300], w: 16, h: 12, t: 0.75, click: [12, 3], area: 192}], "1/16\" = 1'-0\"");
P1.cases.forEach(c => c.page = 1); P2.cases.forEach(c => c.page = 2);
const CASES = [{page: 1, k: K1, cases: P1.cases}, {page: 2, k: K2, cases: P2.cases}];
const makeAutoAreaPdf = () => pdfFrom([P1.page, P2.page]);
module.exports = {makeAutoAreaPdf, CASES, W, H};
if (require.main === module) { const out = process.argv[2] || "autoarea.pdf"; require("fs").writeFileSync(out, makeAutoAreaPdf()); console.log("wrote " + out); }

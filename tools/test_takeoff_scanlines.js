#!/usr/bin/env node
/* Reading the lines of a scanned drawing (takeoff/scanlines.js) — plain Node, no browser:

     node tools/test_takeoff_scanlines.js

   A plan drawn into a picture as a scanner would give it: 1:100 at 200 DPI (1 ft = 24 px), the sheet fed 0.6° askew, the paper
   shaded (yellowed at one side), specks of dirt, lines anti-aliased. In it, each with its answer worked out by hand:
     · a 9" wall (two face lines 0.25 mm) broken by a 3 ft doorway with a jamb across each end — two pieces each face, NOT a dashed line
     · a corridor wall at 1:200 with five doorways at even spacing (regular gaps, as a dashed line has) — jambs: still not dashed
     · a 4½" wall down the sheet
     · a beam under the slab: two dashed edge lines 12" apart between two columns filled solid (9" × 18")
     · a hatch-filled 9" wall drawn solid black — its outline
     · room names, a beam mark and dimension figures (letters, the digit 1 standing alone): no lines left from them
     · a splayed wall face at 30° and a door swing (a quarter circle): a straight line and curve pieces
   Then the same plan with the room names given as text boxes (as OCR finds them): their ink wiped, a wall line through one kept. */
const fs = require("fs"), path = require("path"), {pathToFileURL} = require("url");
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log((c ? "  ✓ " : "  ✗ ") + m); return !!c; };
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;

const {sheet, text} = require("./takeoff_scan_fixture.js");

(async () => {
  const file = path.join(__dirname, "..", "takeoff", "scanlines.js");
  let M; try { M = await import(pathToFileURL(file).href); } catch (e) { M = await import("data:text/javascript," + encodeURIComponent(fs.readFileSync(file, "utf8"))); }
  const DPI = 200, ft = DPI / 25.4 * 304.8 / 100, inch = ft / 12, mm = DPI / 25.4, W = 1500, H = 1100, SK = 0.6, fw = 0.25 * mm;   // 1:100: 1 ft = 24.0 px
  const build = () => { const D = sheet(W, H, SK, 11);
    // 9" wall across (y 200 … 218), 40 ft long from x 150, a 3 ft doorway at 12 ft … 15 ft with a jamb across each end
    const y1 = 200, y2 = y1 + 9 * inch, x0 = 150, xd0 = x0 + 12 * ft, xd1 = x0 + 15 * ft, x9 = x0 + 40 * ft;
    D.line([x0, y1], [xd0, y1], fw); D.line([xd1, y1], [x9, y1], fw); D.line([x0, y2], [xd0, y2], fw); D.line([xd1, y2], [x9, y2], fw);
    D.line([xd0, y1], [xd0, y2], fw); D.line([xd1, y1], [xd1, y2], fw); D.line([x0, y1], [x0, y2], fw); D.line([x9, y1], [x9, y2], fw);
    // a corridor at 1:200 (1 ft = 12 px): a 9" wall (y 300) with doorways 3 ft every 12 ft, five in a row — regular gaps, jambs at each
    const cy1 = 300, cy2 = cy1 + 9 * inch / 2, cx0 = 150; for (let i = 0; i < 6; i++) { const a = cx0 + i * 12 * ft / 2, b = a + 9 * ft / 2; D.line([a, cy1], [b, cy1], fw); D.line([a, cy2], [b, cy2], fw); D.line([a, cy1], [a, cy2], fw); D.line([b, cy1], [b, cy2], fw); }
    // a 4½" wall down (x 1300 … 1309), y 350 … 950
    const vx1 = 1300, vx2 = vx1 + 4.5 * inch; D.line([vx1, 350], [vx1, 950], fw); D.line([vx2, 350], [vx2, 950], fw); D.line([vx1, 950], [vx2, 950], fw);
    // a beam under the slab: dashed edges 12" apart (dash 3 mm, gap 1.5 mm) between two columns 9" × 18" filled solid
    const by1 = 520, by2 = by1 + 12 * inch, cA = 200, cB = cA + 9 * inch + 25 * ft;
    D.rect(cA, by1 - 3 * inch, cA + 9 * inch, by1 + 15 * inch); D.rect(cB, by1 - 3 * inch, cB + 9 * inch, by1 + 15 * inch);
    { const L0 = cB - cA - 9 * inch, gp = 1.5 * mm, n = Math.round((L0 + gp) / (3 * mm + gp)), dl = (L0 - (n - 1) * gp) / n;   // (as CAD draws a dashed line: a dash at each end)
      for (let i = 0; i < n; i++) { const x = cA + 9 * inch + i * (dl + gp); D.line([x, by1], [x + dl, by1], fw); D.line([x, by2], [x + dl, by2], fw); } }
    // a 9" wall drawn solid (hatch-filled black), 20 ft long, y 700
    D.rect(200, 700, 200 + 20 * ft, 700 + 9 * inch);
    // labels: room names, the beam mark, figures — 2.5 mm letters
    text(D, "BED ROOM", 300, 460, 2.5 * mm); text(D, "B-1", 520, 505, 2.5 * mm); text(D, "11", 900, 460, 2.5 * mm); text(D, "11-11", 700, 640, 2 * mm);
    // a splayed wall face at 30° (10 ft) and a door swing: a quarter circle of 3 ft
    const sa = [700, 900], sb = [700 + 10 * ft * Math.cos(Math.PI / 6), 900 - 10 * ft * Math.sin(Math.PI / 6)]; D.line(sa, sb, fw);
    const oc = [xd0, y2], R = 3 * ft; for (let i = 0; i < 24; i++) { const a0 = i / 24 * Math.PI / 2, a1 = (i + 1) / 24 * Math.PI / 2; D.line([oc[0] + R * Math.cos(a0), oc[1] + R * Math.sin(a0)], [oc[0] + R * Math.cos(a1), oc[1] + R * Math.sin(a1)], fw); }
    return {D, g: D.done(), y1, y2, x0, xd0, xd1, x9, cy1, cy2, vx1, vx2, by1, by2, cA, cB, sa, sb, oc, R}; };
  const P = build(), D = P.D;
  const t0 = Date.now(), r = M.readLines(P.g, W, H, {dpi: DPI}), ms = Date.now() - t0;
  console.log(`read ${r.segs.length} lines in ${ms} ms — skew ${r.skew}°, stroke ${r.stroke} px, threshold ${r.threshold}, fills ${r.fills}, letters ${r.text}, n ${JSON.stringify(r.n)}`);
  // the answers are in the drawing's own frame: the lines read are put back square (the sheet was fed at SK°)
  const a = -SK * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), U = p => [cs * (p[0] - W / 2) - sn * (p[1] - H / 2) + W / 2, sn * (p[0] - W / 2) + cs * (p[1] - H / 2) + H / 2];
  const L = r.segs.map(s => { const p = U([s[0], s[1]]), q = U([s[2], s[3]]); return {p, q, f: s[4], w: s[5], hz: Math.abs(q[1] - p[1]) < 1.5 && Math.abs(q[0] - p[0]) > 2, vt: Math.abs(q[0] - p[0]) < 1.5 && Math.abs(q[1] - p[1]) > 2, len: Math.hypot(q[0] - p[0], q[1] - p[1])}; });
  const hz = (y, x0, x1, t) => L.filter(l => l.hz && !(l.f & 4) && near((l.p[1] + l.q[1]) / 2, y, t || 1) && Math.min(l.p[0], l.q[0]) < x1 && Math.max(l.p[0], l.q[0]) > x0);
  const vt = (x, y0, y1, t) => L.filter(l => l.vt && !(l.f & 4) && near((l.p[0] + l.q[0]) / 2, x, t || 1) && Math.min(l.p[1], l.q[1]) < y1 && Math.max(l.p[1], l.q[1]) > y0);
  const span = l => [Math.min(l.p[0], l.q[0]), Math.max(l.p[0], l.q[0])], vspan = l => [Math.min(l.p[1], l.q[1]), Math.max(l.p[1], l.q[1])];

  console.log("the scan");
  ok(near(r.skew, SK, 0.05), `the sheet's skew is measured: ${r.skew}° (fed at ${SK}°)`);
  ok(r.stroke >= 1 && r.stroke <= 4, `the usual line is ${r.stroke} px thick (0.25 mm at 200 DPI ≈ 2 px)`);

  console.log("a 9\" wall with a doorway");
  const f1 = hz(P.y1, P.x0, P.x9), f2 = hz(P.y2, P.x0, P.x9);
  ok(f1.length === 2 && f2.length === 2, `each face is two pieces either side of the doorway (top ${f1.length}, bottom ${f2.length})`);
  ok(f1.concat(f2).every(l => !(l.f & 2)), "neither face is read as a dashed line (a jamb closes each end at the doorway)");
  const sp = f1.map(span).sort((p, q) => p[0] - q[0]);
  ok(sp.length === 2 && near(sp[0][0], P.x0, 2.5) && near(sp[0][1], P.xd0, 2.5) && near(sp[1][0], P.xd1, 2.5) && near(sp[1][1], P.x9, 2.5), `the pieces run ${sp.map(s => s.map(v => v.toFixed(1)).join("…")).join(", ")} (drawn ${P.x0}…${P.xd0.toFixed(1)}, ${P.xd1.toFixed(1)}…${P.x9.toFixed(1)})`);
  const yt = f1.length ? f1.reduce((s, l) => s + (l.p[1] + l.q[1]) / 2, 0) / f1.length : null, yb = f2.length ? f2.reduce((s, l) => s + (l.p[1] + l.q[1]) / 2, 0) / f2.length : null;
  ok(yt != null && yb != null && near((yb - yt) / inch, 9, 0.25), `the faces are ${yt != null && yb != null ? ((yb - yt) / inch).toFixed(2) : "?"}" apart — 9" ± ¼"`);
  const off = (l, m) => { const dx = l.q[0] - l.p[0], dy = l.q[1] - l.p[1], L0 = Math.hypot(dx, dy); return Math.max(...[m.p, m.q].map(z => Math.abs((z[0] - l.p[0]) * dy - (z[1] - l.p[1]) * dx) / L0)); };   // (as read: square to the skew the scan was read at)
  const raw = s => r.segs.find(q => Math.abs(U([q[0], q[1]])[0] - s.p[0]) < 1e-6 && Math.abs(U([q[0], q[1]])[1] - s.p[1]) < 1e-6);
  ok(f1.length === 2 && off(...f1.map(l => { const q = raw(l); return {p: [q[0], q[1]], q: [q[2], q[3]]}; })) < 0.05, `both pieces of one face lie on one line (${f1.length === 2 ? off(...f1.map(l => { const q = raw(l); return {p: [q[0], q[1]], q: [q[2], q[3]]}; })).toFixed(3) : "?"} px off — the agents pair faces to a fraction of an inch)`);
  ok(vt(P.xd0, P.y1, P.y2).length >= 1 && vt(P.xd1, P.y1, P.y2).length >= 1, "the two jambs are read");

  console.log("a 9\" corridor wall with doorways at even spacing (1:200)");
  const k1 = hz(P.cy1, 140, 1000), k2 = hz(P.cy2, 140, 1000);
  ok(k1.length === 6 && k2.length === 6, `each face is six pieces (${k1.length}, ${k2.length})`);
  ok(k1.concat(k2).every(l => !(l.f & 2)), "not one is read as a dashed line, though the gaps are as even as dashes");

  console.log("a 4½\" wall down the sheet");
  const v1 = vt(P.vx1, 350, 950), v2 = vt(P.vx2, 350, 950);
  ok(v1.length === 1 && v2.length === 1, `one line each face (${v1.length}, ${v2.length})`);
  ok(v1.length && v2.length && near((v2[0].p[0] - v1[0].p[0]) / inch, 4.5, 0.25), `${v1.length && v2.length ? ((v2[0].p[0] - v1[0].p[0]) / inch).toFixed(2) : "?"}" apart`);
  ok(v1.length && near(vspan(v1[0])[0], 350, 2.5) && near(vspan(v1[0])[1], 950, 2.5), `it runs ${v1.length ? vspan(v1[0]).map(v => v.toFixed(1)).join("…") : "?"} (drawn 350…950)`);

  console.log("a beam under the slab: dashed edges between filled columns");
  const b1 = hz(P.by1, P.cA, P.cB), b2 = hz(P.by2, P.cA, P.cB);
  ok(b1.length === 1 && b2.length === 1, `each edge one line (${b1.length}, ${b2.length})`);
  ok(b1.length && b2.length && (b1[0].f & 2) && (b2[0].f & 2), "both read as dashed lines");
  ok(b1.length && b2.length && near((b2[0].p[1] - b1[0].p[1]) / inch, 12, 0.3), `${b1.length && b2.length ? ((b2[0].p[1] - b1[0].p[1]) / inch).toFixed(2) : "?"}" apart — 12"`);
  ok(b1.length && near(span(b1[0])[0], P.cA + 9 * inch, 3) && near(span(b1[0])[1], P.cB, 3), `from column to column: ${b1.length ? span(b1[0]).map(v => v.toFixed(1)).join("…") : "?"} (faces ${(P.cA + 9 * inch).toFixed(1)}…${P.cB.toFixed(1)})`);
  const fill = L.filter(l => l.f & 4);
  const colEdges = (x0, y0, x1, y1) => fill.filter(l => Math.min(l.p[0], l.q[0]) >= x0 - 3 && Math.max(l.p[0], l.q[0]) <= x1 + 3 && Math.min(l.p[1], l.q[1]) >= y0 - 3 && Math.max(l.p[1], l.q[1]) <= y1 + 3);
  const cE = colEdges(P.cA, P.by1 - 3 * inch, P.cA + 9 * inch, P.by1 + 15 * inch), cw = cE.filter(l => l.vt), ch = cE.filter(l => l.hz);
  const cwx = cw.map(l => l.p[0]).sort((p, q) => p - q), chy = ch.map(l => l.p[1]).sort((p, q) => p - q);
  ok(cE.length && cw.length >= 2 && ch.length >= 2, `the first column's outline is read as a filled shape (${cE.length} edges)`);
  ok(cwx.length >= 2 && near((cwx[cwx.length - 1] - cwx[0]) / inch, 9, 0.5) && chy.length >= 2 && near((chy[chy.length - 1] - chy[0]) / inch, 18, 0.5), `it measures ${cwx.length >= 2 ? ((cwx[cwx.length - 1] - cwx[0]) / inch).toFixed(2) : "?"}" × ${chy.length >= 2 ? ((chy[chy.length - 1] - chy[0]) / inch).toFixed(2) : "?"}" (9" × 18")`);

  console.log("a wall drawn solid");
  const sE = fill.filter(l => l.hz && l.len > 15 * ft && near(l.p[1], 700, 3) || l.hz && l.len > 15 * ft && near(l.p[1], 700 + 9 * inch, 3));
  ok(sE.length === 2, `its two long edges are read (${sE.length})`);
  ok(sE.length === 2 && near(Math.abs(sE[0].p[1] - sE[1].p[1]) / inch, 9, 0.5), `${sE.length === 2 ? (Math.abs(sE[0].p[1] - sE[1].p[1]) / inch).toFixed(2) : "?"}" thick`);

  console.log("letters and figures");
  const inBox = (x0, y0, x1, y1) => L.filter(l => !(l.f & 4) && Math.min(l.p[0], l.q[0]) >= x0 && Math.max(l.p[0], l.q[0]) <= x1 && Math.min(l.p[1], l.q[1]) >= y0 && Math.max(l.p[1], l.q[1]) <= y1);
  ok(!inBox(295, 455 - 2.5 * mm, 300 + 8 * 2.5 * mm * 0.81 + 5, 465).length, `no lines from the room name BED ROOM (${inBox(295, 455 - 2.5 * mm, 300 + 8 * 2.5 * mm * 0.81 + 5, 465).length})`);
  ok(!inBox(895, 455 - 2.5 * mm, 900 + 2 * 2.5 * mm * 0.81 + 5, 465).length, "no lines from a figure 11 standing alone (each 1 is a short straight stroke)");
  ok(!inBox(515, 500 - 2.5 * mm, 520 + 3 * 2.5 * mm * 0.81 + 5, 507).length, "no lines from the beam mark B-1");
  ok(r.text >= 6, `${r.text} marks (letters and figures, some touching) were left out`);

  console.log("other angles and curves");
  const sl = L.filter(l => !l.hz && !l.vt && !(l.f & 1) && l.len > 5 * ft);
  const ang = sl.map(l => Math.abs(Math.atan2(l.q[1] - l.p[1], l.q[0] - l.p[0]) * 180 / Math.PI) % 180);
  ok(sl.length >= 1 && ang.some(x => near(x, 30, 1) || near(x, 150, 1)), `the splayed face is read at 30° (${ang.map(x => x.toFixed(1)).join(", ") || "none"})`);
  ok(sl.length && sl.some(l => near(l.len / ft, 10, 0.4)), `${sl.length ? (Math.max(...sl.map(l => l.len)) / ft).toFixed(2) : "?"} ft long (10 ft)`);
  const arc = L.filter(l => (l.f & 1) && near(Math.hypot((l.p[0] + l.q[0]) / 2 - P.oc[0], (l.p[1] + l.q[1]) / 2 - P.oc[1]), P.R, 3));
  ok(arc.length >= 3, `the door swing is read as curve pieces on its radius (${arc.length})`);

  console.log("text boxes given (from OCR)");
  const P2 = build(), x1b = 300 + 8 * 2.5 * mm * 0.81;
  const words = [[295, 455 - 2.5 * mm - 2, x1b + 4, 464], [P2.x0 + 2 * ft, P2.y1 - 8, P2.x0 + 6 * ft, P2.y1 + 8]];   // the second box sits on the wall's top face: the face runs through it
  const sk = SK * Math.PI / 180, F = p => [Math.cos(sk) * (p[0] - W / 2) - Math.sin(sk) * (p[1] - H / 2) + W / 2, Math.sin(sk) * (p[0] - W / 2) + Math.cos(sk) * (p[1] - H / 2) + H / 2];
  const wb = words.map(b => { const q = [F([b[0], b[1]]), F([b[2], b[1]]), F([b[0], b[3]]), F([b[2], b[3]])]; return [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))]; });
  const r2 = M.readLines(P2.g, W, H, {dpi: DPI, words: wb});
  ok(r2.wiped > 100, `${r2.wiped} pixels of text wiped`);
  const L2 = r2.segs.map(s => { const p = U([s[0], s[1]]), q = U([s[2], s[3]]); return {p, q, f: s[4]}; });
  const top = L2.filter(l => Math.abs(l.q[1] - l.p[1]) < 1.5 && near((l.p[1] + l.q[1]) / 2, P2.y1, 1) && Math.min(l.p[0], l.q[0]) < P2.x0 + 3 && Math.max(l.p[0], l.q[0]) > P2.xd0 - 3);
  ok(top.length === 1, "the wall face running through a text box is kept whole");

  console.log("blank paper");
  const blank = new Uint8Array(400 * 300).fill(245), rb = M.readLines(blank, 400, 300, {dpi: 200});
  ok(rb.segs.length === 0 && !rb.err, "a blank page gives no lines");

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

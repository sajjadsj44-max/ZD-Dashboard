#!/usr/bin/env node
/* Test drawing for the PDF Takeoff app: a 3-page vector PDF written by hand (no PDF library), so every
   dimension in it is known exactly.

     node tools/takeoff_fixture.js out.pdf        # write it (tools/test_takeoff.js builds it in memory)

   p.1  842 × 595 pt, "SCALE 1/8" = 1'-0"" (9 pt per ft): bed room 12'×14' and store 10'×14' clear, 9" outer
        walls, 4.5" partition, a 3' door in the front wall (with a door-swing curve) and a 2'6" door in the
        partition; a "12'-0"" label over the bed room.
   p.2  A3 landscape (1190.55 × 841.89 pt) with "SCALE 1:100 @ A1": drawn for A1, so on this A3 page
        1 ft = 8.64 × 1190.55 / 2383.94 pt; one 20'-0" line.
   p.3  842 × 595 pt, no scale note: one 90 pt line labelled 10'-0" (for calibration).
   Coordinates are PDF points, y up (the app works y down: y_view = page height − y). */
const S1 = 9, A3W = 1190.55, A3H = 841.89, K2 = 8.64 * 1190.55 / 2383.94;
const X0 = 100, Y0 = 100, T9 = 0.75 * S1, T45 = 0.375 * S1;
const ax0 = X0 + T9, ay0 = Y0 + T9, ax1 = ax0 + 12 * S1, ay1 = ay0 + 14 * S1;
const bx0 = ax1 + T45, bx1 = bx0 + 10 * S1, ox1 = bx1 + T9, oy1 = ay1 + T9;
const d0 = 130, d1 = 130 + 3 * S1, p0 = 150, p1 = 150 + 2.5 * S1;
const GEOM = {S1, K2, ax0, ay0, ax1, ay1, bx0, bx1, ox1, oy1, X0, Y0, d0, d1, p0, p1, H1: 595, H2: A3H, H3: 595};

function page1(){
  const L = [], seg = (a, b, c, d) => L.push(`${a.toFixed(3)} ${b.toFixed(3)} m ${c.toFixed(3)} ${d.toFixed(3)} l S`);
  seg(X0, Y0, d0, Y0); seg(d1, Y0, ox1, Y0);
  seg(ax0, ay0, d0, ay0); seg(d1, ay0, ax1, ay0); seg(bx0, ay0, bx1, ay0);
  seg(d0, Y0, d0, ay0); seg(d1, Y0, d1, ay0);
  seg(X0, oy1, ox1, oy1); seg(ax0, ay1, ax1, ay1); seg(bx0, ay1, bx1, ay1);
  seg(X0, Y0, X0, oy1); seg(ax0, ay0, ax0, ay1);
  seg(ox1, Y0, ox1, oy1); seg(bx1, ay0, bx1, ay1);
  for (const x of [ax1, bx0]) { seg(x, ay0, x, p0); seg(x, p1, x, ay1); }
  seg(ax1, p0, bx0, p0); seg(ax1, p1, bx0, p1);
  // door leaf and swing (a quarter circle drawn as a Bezier curve) inside the bed room
  seg(d0, ay0, d0, ay0 + 27);
  L.push(`${d0.toFixed(3)} ${(ay0 + 27).toFixed(3)} m ${(d0 + 14.9).toFixed(3)} ${(ay0 + 27).toFixed(3)} ${(d1).toFixed(3)} ${(ay0 + 14.9).toFixed(3)} ${d1.toFixed(3)} ${ay0.toFixed(3)} c S`);
  return ["0.6 w"].concat(L, ["BT /F1 9 Tf 560 70 Td (SCALE 1/8\" = 1'-0\") Tj ET", "BT /F1 8 Tf 150 250 Td (12'-0\") Tj ET",
    "BT /F1 8 Tf 140 165 Td (BED ROOM) Tj ET", "BT /F1 8 Tf 245 165 Td (STORE) Tj ET"]).join("\n");
}
function page2(){
  return ["0.6 w", `100 400 m ${(100 + 20 * K2).toFixed(4)} 400 l S`, "BT /F1 9 Tf 900 60 Td (SCALE 1:100 @ A1) Tj ET", "BT /F1 8 Tf 120 410 Td (20'-0\") Tj ET"].join("\n");
}
function page3(){ return ["0.6 w", "100 300 m 190 300 l S", "BT /F1 8 Tf 130 308 Td (10'-0\") Tj ET"].join("\n"); }

function makePdf(){
  const pages = [[842, 595, page1()], [A3W, A3H, page2()], [842, 595, page3()]];
  const objs = [];   // index 0 = obj 1
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(null);   // pages, filled below
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");   // obj 3
  const kids = [];
  pages.forEach(([w, h, content]) => {
    const cid = objs.length + 2, pid = objs.length + 1;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${cid} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(pid + " 0 R");
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
module.exports = {makePdf, GEOM};
if (require.main === module) { require("fs").writeFileSync(process.argv[2] || "takeoff_test.pdf", makePdf()); console.log("written", process.argv[2] || "takeoff_test.pdf"); }

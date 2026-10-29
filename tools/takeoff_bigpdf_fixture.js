/* A very big PDF for tools/test_takeoff_bigpdf.js, written straight to disk a piece at a time (never held whole):

     require("./takeoff_bigpdf_fixture.js").write(file, {mb: 1024})

   Page 1 is a small vector plan (a 40 ft × 30 ft room drawn at 1/8" = 1'-0": 0.125 in → 1 ft, so 9 pt = 1 ft, with walls and a
   grid). Every other page is a scan: one 8192 × 8192 grey image (64 MB, stored raw so the file keeps its size) of noise with a dark
   frame — the way a scanned A0 sheet looks to a PDF reader. Pages are added until the file reaches mb. */
const fs = require("fs"), crypto = require("crypto");
const IMG = 8192;
function write(file, o){
  const mb = (o && o.mb) || 1024, target = mb * 1048576, fd = fs.openSync(file, "w"), offs = [];
  let at = 0; const put = b => { if (typeof b === "string") b = Buffer.from(b, "latin1"); fs.writeSync(fd, b); at += b.length; };
  const obj = (n, body) => { offs[n] = at; put(n + " 0 obj\n" + body + "\nendobj\n"); };
  put("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
  const nImg = Math.max(1, Math.ceil((target - 65536) / (IMG * IMG))), nPages = 1 + nImg;
  // 1 catalog, 2 pages, 3 page 1, 4 its content; then per scan page k: page, content, image
  const kids = [3]; for (let k = 0; k < nImg; k++) kids.push(5 + 3 * k);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Count " + nPages + " /Kids [" + kids.map(n => n + " 0 R").join(" ") + "] >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 468] /Contents 4 0 R /Resources << >> >>");
  const s = ["1 w 0 0 0 RG", "72 72 m 432 72 l 432 342 l 72 342 l h S"];   // the room: 40 ft × 30 ft at 9 pt / ft
  for (let x = 72; x <= 432; x += 45) s.push(x + " 60 m " + x + " 354 l S");   // grid every 5 ft
  s.push("4 w 72 72 m 432 72 l 432 342 l 72 342 l h S");
  const c1 = s.join("\n"); obj(4, "<< /Length " + c1.length + " >>\nstream\n" + c1 + "\nendstream");
  for (let k = 0; k < nImg; k++) {
    const pg = 5 + 3 * k, ct = pg + 1, im = pg + 2, c = "q 1700 0 0 1700 50 50 cm /Im0 Do Q";
    obj(pg, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1800 1800] /Contents " + ct + " 0 R /Resources << /XObject << /Im0 " + im + " 0 R >> >> >>");
    obj(ct, "<< /Length " + c.length + " >>\nstream\n" + c + "\nendstream");
    offs[im] = at; put(im + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + IMG + " /Height " + IMG + " /ColorSpace /DeviceGray /BitsPerComponent 8 /Length " + IMG * IMG + " >>\nstream\n");
    for (let y = 0; y < IMG; y += 256) {   // 256 rows at a time: light noise, a dark frame 200 px wide
      const band = crypto.randomBytes(IMG * 256);
      for (let r = 0; r < 256; r++) { const yy = y + r, o = r * IMG;
        for (let x = 0; x < IMG; x++) band[o + x] = yy < 200 || yy >= IMG - 200 || x < 200 || x >= IMG - 200 ? 20 : 200 + (band[o + x] & 55); }
      put(band);
    }
    put("\nendstream\nendobj\n");
  }
  const n = 5 + 3 * nImg, xref = at;
  let t = "xref\n0 " + n + "\n0000000000 65535 f \n"; for (let i = 1; i < n; i++) t += String(offs[i]).padStart(10, "0") + " 00000 n \n";
  put(t + "trailer\n<< /Size " + n + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
  fs.closeSync(fd);
  return {pages: nPages, bytes: at};
}
module.exports = {write, IMG};

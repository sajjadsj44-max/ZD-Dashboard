/* A scanned drawing made in Node, for the line-reading tests (test_takeoff_scanlines.js, test_takeoff_scan.js):
   sheet(W, H, skew°, seed) draws convex shapes with 4 × 4 coverage into a picture as a scanner gives it — fed askew, the paper shaded
   (yellowed at one side), specks, a little noise; text(D, s, x, y, h) letters as short strokes; scanPdf(gray, W, H, dpi) wraps the
   picture in a one-page PDF with nothing else on it (an image only, as a scanner's PDF). */
function sheet(W, H, skewDeg, seed){
  const g = new Float32Array(W * H), cx = W / 2, cy = H / 2, a = skewDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 0;   // ink coverage 0 … 1
  const T = p => [c * (p[0] - cx) - s * (p[1] - cy) + cx, s * (p[0] - cx) + c * (p[1] - cy) + cy];   // the drawing, fed askew
  const poly = (P, dark) => { const Q = P.map(T), xs = Q.map(q => q[0]), ys = Q.map(q => q[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    let sg = 0; for (let i = 0; i < Q.length; i++) { const A = Q[i], B = Q[(i + 1) % Q.length], C2 = Q[(i + 2) % Q.length]; sg += (B[0] - A[0]) * (C2[1] - B[1]) - (B[1] - A[1]) * (C2[0] - B[0]); }
    const inside = (px, py) => { for (let i = 0; i < Q.length; i++) { const A = Q[i], B = Q[(i + 1) % Q.length], cr = (B[0] - A[0]) * (py - A[1]) - (B[1] - A[1]) * (px - A[0]); if (sg > 0 ? cr < 0 : cr > 0) return false; } return true; };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { let n = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
      if (n) { const k = y * W + x; g[k] = Math.min(1, g[k] + n / 16 * (dark || 1)); } } };
  const line = (A, B, w, dark) => { const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), nx = -dy / L * w / 2, ny = dx / L * w / 2; poly([[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]], dark); };
  const rect = (x0, y0, x1, y1, dark) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dark);
  let r = seed || 7; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const done = () => { const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const paper = 226 + 26 * x / W, k = y * W + x; let v = paper * (1 - g[k]) + 18 * g[k]; out[k] = Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 10))); }
    for (let i = 0; i < W * H / 4000; i++) { const x = Math.floor(rnd() * (W - 2)), y = Math.floor(rnd() * (H - 2)); out[y * W + x] = 40; if (rnd() < 0.5) out[y * W + x + 1] = 60; }   // specks
    return out; };
  return {line, rect, poly, done, T};
}

// letters as strokes (a scanned label): each a few short thick lines, 2.5 mm tall at 200 DPI = 20 px
function text(D, s, x, y, h){ const w = 0.6 * h, t = Math.max(2, h / 9);
  for (const ch of s) { const L = (a, b, c2, d) => D.line([x + a * w, y - b * h], [x + c2 * w, y - d * h], t);
    if (ch === "1") L(0.5, 0, 0.5, 1); else if (ch === "B") { L(0, 0, 0, 1); L(0, 1, 0.8, 0.9); L(0.8, 0.9, 0.8, 0.6); L(0, 0.5, 0.8, 0.55); L(0.8, 0.55, 0.85, 0.1); L(0.85, 0.1, 0, 0); }
    else if (ch === "E") { L(0, 0, 0, 1); L(0, 1, 1, 1); L(0, 0.5, 0.8, 0.5); L(0, 0, 1, 0); } else if (ch === "D") { L(0, 0, 0, 1); L(0, 1, 0.7, 0.85); L(0.7, 0.85, 0.9, 0.5); L(0.9, 0.5, 0.7, 0.15); L(0.7, 0.15, 0, 0); }
    else if (ch === "-") L(0.1, 0.5, 0.8, 0.5); else if (ch === "R") { L(0, 0, 0, 1); L(0, 1, 0.8, 0.9); L(0.8, 0.9, 0.8, 0.6); L(0.8, 0.6, 0, 0.5); L(0.3, 0.5, 0.9, 0); }
    else if (ch === "O") { L(0, 0, 0, 1); L(0, 1, 0.9, 1); L(0.9, 1, 0.9, 0); L(0.9, 0, 0, 0); } else if (ch === "M") { L(0, 0, 0, 1); L(0, 1, 0.45, 0.4); L(0.45, 0.4, 0.9, 1); L(0.9, 1, 0.9, 0); }
    x += w * 1.35; }
  return x; }

function scanPdf(px, W, H, dpi){   // gray pixels -> a PDF whose one page is the picture at dpi (as makeScanPdf in takeoff_qa_fixture.js)
  const zlib = require("zlib"), sc = dpi / 72, img = zlib.deflateSync(Buffer.from(px), {level: 6}), pw = W / sc, ph = H / sc;
  const content = `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /Im1 Do Q`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  const head = `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`;
  const parts = []; let len = 0; const add = b => { parts.push(b); len += b.length; }, offs = [];
  add(Buffer.from("%PDF-1.4\n", "latin1"));
  objs.forEach((o, i) => { offs.push(len); add(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")); });
  offs.push(len); add(Buffer.from(`5 0 obj\n${head}`, "latin1")); add(img); add(Buffer.from("\nendstream\nendobj\n", "latin1"));
  const x = len; add(Buffer.from(`xref\n0 6\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}
module.exports = {sheet, text, scanPdf};

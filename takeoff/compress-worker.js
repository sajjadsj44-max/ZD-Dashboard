/* ZD PDF Takeoff — a PDF made smaller, in a worker (the page stays responsive, and the memory goes with the worker).
   In: {buf, level, pdfLib}; out: progress {step, n, of}, then {ok, bytes, stats} or {ok: false, error}. The same file also runs as
   its own helpers (In: a picture's job {job, kind, src, …}; out: {job, bytes, w, h, filter} or {job}), several at once.

   Only the pictures inside the PDF are touched: a drawing that is vector (lines, text, layers, markups) keeps every one of them as it
   was, so the view, the layers, the snap and the measurements behave exactly as before. A picture that is drawn on the sheet with more
   pixels than the level asks for (a 600 dpi hatch tile, a 300 dpi photo) is resampled to the level's resolution — worked out from how
   big the picture is on the page (the page's content is read for it: q / Q / cm / Do, form XObjects too) — and written again as a
   JPEG (a gray one, or a flat-colour one, as lossless Flate). A picture whose place is not known (a pattern, a markup), a mask, a
   colour key, a Decode array, CMYK / Indexed / Lab colour and anything that does not come out clearly smaller stay as they are. */
let PL = null;
const LEVELS = {light: {dpi: 200, q: 0.82}, balanced: {dpi: 150, q: 0.72}, strong: {dpi: 100, q: 0.6}};
const MIN_BYTES = 6000, MAX_PIXELS = 90e6, GAIN = 0.85;   // a picture under 6 kB is left; one over 90 Mpx would need too much memory; it must come out at 85 % or less

/* ---- where each picture is drawn: the content streams read for q / Q / cm / Do ---- */
const WS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const DL = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const nameText = s => s.replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

function makeScanner(PL, doc){
  const {PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFNumber, decodePDFRawStream} = PL, ctx = doc.context;
  const look = o => o instanceof PDFRef ? ctx.lookup(o) : o, N = s => PDFName.of(s);
  const bytesOf = s => { try { if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode(); return s.getUnencodedContents ? s.getUnencodedContents() : null; } catch (e) { return null; } };
  const num = o => { o = look(o); return o instanceof PDFNumber ? o.asNumber() : NaN; };
  const seen = new Map();   // image object number -> {w, h}: the biggest size it is drawn at, in points
  let budget = 800e6;       // bytes of content read at most (a form used very many times)
  const matrix = d => { const a = look(d && d.get(N("Matrix"))); if (!(a instanceof PDFArray) || a.size() !== 6) return [1, 0, 0, 1, 0, 0]; const v = [0, 1, 2, 3, 4, 5].map(i => num(a.get(i))); return v.every(Number.isFinite) ? v : [1, 0, 0, 1, 0, 0]; };
  function walk(b, res, m0, depth){
    if (!b || budget < 0) return; budget -= b.length;
    const n = b.length, st = []; let m = m0, i = 0, nums = [], nm = "";
    while (i < n) {
      const c = b[i];
      if (WS(c)) { i++; continue; }
      if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
      if (c === 40) { let d = 1; i++; while (i < n && d) { const x = b[i++]; if (x === 92) i++; else if (x === 40) d++; else if (x === 41) d--; } continue; }
      if (c === 60) { if (b[i + 1] === 60) i += 2; else { while (i < n && b[i] !== 62) i++; i++; } continue; }
      if (c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 41) { i++; continue; }
      let j = i + 1;
      if (c === 47) { while (j < n && !WS(b[j]) && !DL(b[j])) j++; nm = nameText(String.fromCharCode.apply(null, b.subarray(i + 1, j))); i = j; continue; }
      while (j < n && !WS(b[j]) && !DL(b[j])) j++;
      if (c === 43 || c === 45 || c === 46 || (c >= 48 && c <= 57)) {   // a number, read from its bytes (no string made: a sheet has millions)
        let k = i, sg = 1, v = 0, f = 0, dv = 1, ok = true; if (b[k] === 45) { sg = -1; k++; } else if (b[k] === 43) k++;
        for (; k < j; k++) { const x = b[k]; if (x === 46 && !f) f = 1; else if (x >= 48 && x <= 57) { if (f) { dv *= 10; v += (x - 48) / dv; } else v = v * 10 + (x - 48); } else { ok = false; break; } }
        i = j; if (ok) { nums.push(sg * v); if (nums.length > 8) nums.shift(); } continue; }
      const L = j - i, t = L === 1 ? (c === 113 ? "q" : c === 81 ? "Q" : "") : L === 2 ? (c === 99 && b[i + 1] === 109 ? "cm" : c === 68 && b[i + 1] === 111 ? "Do" : c === 66 && b[i + 1] === 73 ? "BI" : "") : ""; i = j;   // (only q Q cm Do BI matter)
      if (t === "q") st.push(m);
      else if (t === "Q") { if (st.length) m = st.pop(); }
      else if (t === "cm") { if (nums.length >= 6) m = mul(nums.slice(-6), m); }
      else if (t === "BI") {   // an inline image: skipped to its EI
        let k = i; while (k < n - 1 && !(b[k] === 73 && b[k + 1] === 68 && (k + 2 >= n || WS(b[k + 2])) && WS(b[k - 1]))) k++;
        k += 3; while (k < n - 2 && !(WS(b[k - 1]) && b[k] === 69 && b[k + 1] === 73 && (k + 2 >= n || WS(b[k + 2])))) k++; i = Math.min(n, k + 2); }
      else if (t === "Do" && nm && res) {
        const xo = look(res.get(N("XObject"))), ref = xo instanceof PDFDict ? xo.get(N(nm)) : null, ob = look(ref);
        if (ob && ob.dict) {
          const sub = look(ob.dict.get(N("Subtype"))), tag = sub && sub.asString ? sub.asString() : "";
          if (tag === "/Image" && ref instanceof PDFRef) {
            const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3]), o = seen.get(ref.objectNumber) || {w: 0, h: 0};
            if (Number.isFinite(w) && Number.isFinite(h)) { o.w = Math.max(o.w, w); o.h = Math.max(o.h, h); seen.set(ref.objectNumber, o); }
          } else if (tag === "/Form" && depth < 8) {
            const r2 = look(ob.dict.get(N("Resources"))); walk(bytesOf(ob), r2 instanceof PDFDict ? r2 : res, mul(matrix(ob.dict), m), depth + 1);
          }
        }
      }
      nums = []; nm = "";
    }
  }
  return {
    page(pg){
      const res = pg.node.Resources(), cs = pg.node.Contents(); if (!res || !cs) return;
      const parts = cs instanceof PDFArray ? cs.asArray().map(r => bytesOf(look(r))) : [bytesOf(cs)];
      if (parts.some(p => !p)) return;
      let tot = 0; parts.forEach(p => { tot += p.length + 1; }); const all = new Uint8Array(tot); let o = 0; parts.forEach(p => { all.set(p, o); o += p.length; all[o++] = 10; });
      walk(all, res, [1, 0, 0, 1, 0, 0], 0);
    },
    seen
  };
}

/* ---- one picture: what it is and how small it may go -> a job | null (left as it is) ---- */
function prep(PL, doc, obj, pl, L){
  const {PDFName, PDFArray, PDFNumber, PDFBool, PDFRef, decodePDFRawStream} = PL, ctx = doc.context, look = o => o instanceof PDFRef ? ctx.lookup(o) : o, N = s => PDFName.of(s), d = obj.dict;
  const num = k => { const v = look(d.get(N(k))); return v instanceof PDFNumber ? v.asNumber() : NaN; };
  const W = num("Width"), H = num("Height"), bpc = num("BitsPerComponent");
  if (!(W > 0 && H > 0) || W * H > MAX_PIXELS || obj.contents.length < MIN_BYTES) return null;
  const im = look(d.get(N("ImageMask"))); if (im instanceof PDFBool && im.asBoolean()) return null;
  if (d.has(N("Mask")) || d.has(N("Decode"))) return null;   // (a colour key or a Decode array depends on the exact pixel values)
  const fl = look(d.get(N("Filter"))), fs = fl instanceof PDFArray ? fl.asArray().map(look) : fl ? [fl] : [], fn = fs.length === 1 && fs[0] && fs[0].asString ? fs[0].asString() : "";
  const jpeg = fn === "/DCTDecode" || fn === "/DCT", flate = fn === "/FlateDecode" || fn === "/Fl";
  if (!jpeg && !flate) return null;
  const cs = look(d.get(N("ColorSpace"))); let comps = 0;
  if (cs && cs.asString) comps = cs.asString() === "/DeviceRGB" ? 3 : cs.asString() === "/DeviceGray" ? 1 : 0;
  else if (cs instanceof PDFArray && cs.size() >= 2 && look(cs.get(0)) && look(cs.get(0)).asString && look(cs.get(0)).asString() === "/ICCBased") { const p = look(cs.get(1)), nn = p && p.dict ? look(p.dict.get(N("N"))) : null; comps = nn instanceof PDFNumber && (nn.asNumber() === 3 || nn.asNumber() === 1) ? nn.asNumber() : 0; }
  if (!comps || (flate && bpc !== 8) || (jpeg && bpc && bpc !== 8)) return null;
  const k = L.dpi / 72, nw = Math.max(16, Math.min(W, Math.ceil(k * pl.w - 1e-6))), nh = Math.max(16, Math.min(H, Math.ceil(k * pl.h - 1e-6)));   // (- 1e-6: 625.0000001 px is 625)
  const same = nw * nh > 0.7 * W * H;   // not clearly over-sampled: left alone — but raw colour pixels that make a photograph are still written as a JPEG, at their own size
  if (same && !(flate && comps === 3)) return null;
  let src;
  if (jpeg) src = obj.contents.slice();
  else { try { src = decodePDFRawStream(obj).decode(); } catch (e) { return null; } if (src.length !== W * H * comps) return null; if (src.buffer.byteLength !== src.length) src = src.slice(); }   // (raw pixels, predictors undone)
  return {kind: jpeg ? "jpeg" : "raw", src, W, H, comps, nw: same ? W : nw, nh: same ? H : nh, photoOnly: same, q: L.q, max: Math.floor(GAIN * obj.contents.length)};
}
/* ---- a job done (here or in a helper): the picture resampled and written again -> {bytes, w, h, filter} | null ---- */
async function work(j){
  const {src, W, H, comps, nw, nh} = j;
  const opt = {resizeWidth: nw, resizeHeight: nh, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none"};
  let bmp;
  if (j.kind === "jpeg") bmp = await createImageBitmap(new Blob([src], {type: "image/jpeg"}), opt);
  else {
    const rgba = new Uint8ClampedArray(W * H * 4);
    if (comps === 3) for (let i = 0, o = 0; i < src.length; i += 3, o += 4) { rgba[o] = src[i]; rgba[o + 1] = src[i + 1]; rgba[o + 2] = src[i + 2]; rgba[o + 3] = 255; }
    else for (let i = 0, o = 0; i < src.length; i++, o += 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = src[i]; rgba[o + 3] = 255; }
    bmp = await createImageBitmap(new ImageData(rgba, W, H), opt);
  }
  if (bmp.width !== nw || bmp.height !== nh) { if (bmp.close) bmp.close(); return null; }
  const cv = new OffscreenCanvas(nw, nh), cx = cv.getContext("2d"); cx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  let bytes, filter, photo = comps === 3 && j.kind === "jpeg";   // a colour JPEG stays a JPEG
  const px = photo ? null : cx.getImageData(0, 0, nw, nh).data;
  if (comps === 3 && !photo) {   // raw colour pixels: a photograph (many colours) as JPEG; a flat-colour picture (a logo, a stamp) lossless
    const seenC = new Set(), step = Math.max(1, Math.floor(nw * nh / 4096)); for (let p = 0; p < nw * nh; p += step) { seenC.add(px[p * 4] << 16 | px[p * 4 + 1] << 8 | px[p * 4 + 2]); if (seenC.size > 1500) { photo = true; break; } }
  }
  if (j.photoOnly && !photo) return null;   // (a flat-colour picture at its own size: nothing to gain)
  if (photo) { const bl = await cv.convertToBlob({type: "image/jpeg", quality: j.q}); bytes = new Uint8Array(await bl.arrayBuffer()); filter = "DCTDecode"; }
  else {   // gray (a gray JPEG too: the canvas writes colour JPEGs only) or flat colour: lossless Flate
    const raw = new Uint8Array(nw * nh * comps);
    if (comps === 3) for (let p = 0, o = 0; p < px.length; p += 4) { raw[o++] = px[p]; raw[o++] = px[p + 1]; raw[o++] = px[p + 2]; } else for (let p = 0, o = 0; p < px.length; p += 4) raw[o++] = px[p];
    bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()); filter = "FlateDecode";
  }
  return bytes.length > j.max ? null : {bytes, w: nw, h: nh, filter};
}
/* ---- helpers: this same file started again as workers, a picture each at a time (a drawing set has thousands, and decoding a JPEG
   is the slow part) — if they cannot be started, or one fails, its pictures are done here ---- */
function helpers(n){
  const ws = [], wait = new Map(); let id = 0;
  try { for (let i = 0; i < n; i++) ws.push(new Worker(new URL(import.meta.url), {type: "module"})); } catch (e) { ws.forEach(w => w.terminate()); return null; }
  const alive = ws.map(() => true);
  ws.forEach((w, wi) => {
    w.onmessage = e => { const m = e.data || {}, p = wait.get(m.job); if (!p) return; wait.delete(m.job); p.ok(m.bytes ? {bytes: m.bytes, w: m.w, h: m.h, filter: m.filter} : null); };
    w.onerror = () => { alive[wi] = false; for (const [k, p] of wait) if (p.wi === wi) { wait.delete(k); p.ok("here"); } };
  });
  return {
    run(j, slot){ const wi = [0, 1, 2, 3, 4, 5, 6, 7].map(x => (slot + x) % ws.length).find(x => alive[x]);
      if (wi === undefined) return Promise.resolve("here");
      return new Promise(ok => { const k = ++id; wait.set(k, {ok, wi}); j.job = k; ws[wi].postMessage(j, [j.src.buffer]); }); },
    end(){ ws.forEach(w => w.terminate()); }
  };
}

self.onmessage = async e => {
  const m = e.data || {};
  if (m.job !== undefined) {   // a helper's picture
    let r = null; try { r = await work(m); } catch (er) { r = null; }
    if (r) self.postMessage({job: m.job, bytes: r.bytes, w: r.w, h: r.h, filter: r.filter}, [r.bytes.buffer]); else self.postMessage({job: m.job});
    return;
  }
  const {buf, level, pdfLib} = m, say = (step, n, of) => self.postMessage({step, n, of});
  try {
    if (!PL) { say("load"); PL = await import(pdfLib); }
    const r = await compress(PL, buf, LEVELS[level] || LEVELS.balanced, say);
    self.postMessage({ok: true, bytes: r.bytes, stats: r.stats}, [r.bytes.buffer]);
  } catch (er) { self.postMessage({ok: false, error: String(er && er.message || er), locked: !!(er && /encrypt/i.test(er.name + " " + er.message))}); }
};

async function compress(PL, buf, L, say){
  const {PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef} = PL;
  const before = buf.byteLength;
  say("open");
  const doc = await PDFDocument.load(buf, {updateMetadata: false, throwOnInvalidObject: false});   // (an encrypted PDF: throws — it is not changed)
  const ctx = doc.context, pages = doc.getPages();
  const sc = makeScanner(PL, doc);
  for (let i = 0; i < pages.length; i++) { say("scan", i + 1, pages.length); try { sc.page(pages[i]); } catch (e) {} if (i % 8 === 7) await new Promise(r => setTimeout(r)); }
  const todo = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || !(ref instanceof PDFRef)) continue;
    const st = obj.dict.get(PDFName.of("Subtype")), pl = sc.seen.get(ref.objectNumber);
    if (st && st.asString && st.asString() === "/Image" && pl && pl.w > 0 && pl.h > 0 && obj.contents.length >= MIN_BYTES) todo.push([ref, obj, pl]);
  }
  todo.sort((a, b) => b[1].contents.length - a[1].contents.length);   // the biggest first
  const stats = {before, pictures: todo.length, shrunk: 0, saved: 0, pages: pages.length}; let done = 0, at = 0;
  const nh = Math.max(1, Math.min(6, ((self.navigator && navigator.hardwareConcurrency) || 4) - 2)), H = todo.length > 8 ? helpers(nh) : null;
  let bigBusy = Promise.resolve();   // a raw picture over 32 MB is done one at a time (memory)
  const one = async slot => {
    for (;;) {
      const ix = at++, t = todo[ix]; if (!t) return;
      try {
        const j = prep(PL, doc, t[1], t[2], L);
        if (j) {
          let r;
          const go = async () => { r = H ? await H.run(Object.assign({}, j, {src: j.src.slice()}), slot) : "here"; if (r === "here") r = await work(j); };   // (a copy goes to the helper: if it fails, the picture is done here)
          if (j.src.length > 32 * 1048576) { const prev = bigBusy; let rel; bigBusy = new Promise(x => { rel = x; }); await prev; try { await go(); } finally { rel(); } } else await go();
          if (r) {
            const nd = t[1].dict.clone(ctx); nd.set(PDFName.of("Width"), PDFNumber.of(r.w)); nd.set(PDFName.of("Height"), PDFNumber.of(r.h)); nd.set(PDFName.of("Filter"), PDFName.of(r.filter)); nd.delete(PDFName.of("DecodeParms")); nd.set(PDFName.of("Length"), PDFNumber.of(r.bytes.length));
            stats.saved += t[1].contents.length - r.bytes.length; ctx.assign(t[0], PDFRawStream.of(nd, r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes))); stats.shrunk++;
          }
        }
      } catch (e) { /* this picture stays as it was */ }
      todo[ix] = null;   // (the old picture's bytes can go)
      if (++done % 8 === 0 || done === todo.length) say("pictures", done, todo.length);
    }
  };
  say("pictures", 0, todo.length);
  try { await Promise.all(Array.from({length: H ? nh * 2 : 3}, (x, i) => one(i))); } finally { if (H) H.end(); }
  say("save");
  const bytes = await doc.save({useObjectStreams: false, addDefaultPage: false});
  stats.after = bytes.length;
  return {bytes, stats};
}


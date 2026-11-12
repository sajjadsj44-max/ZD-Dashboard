#!/usr/bin/env node
/* Browser tests for compressing a big PDF in the PDF Takeoff app (takeoff/: compressPdf, compress-worker.js).

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=<folder with pdfjs-dist + exceljs + pdf-lib> node tools/test_takeoff_compress.js

   The fixture (made here with pdf-lib, its pictures drawn by the browser's canvas): two A1 sheets with vector lines on two PDF
   layers (A-WALL, S-HATCH), text, a sticky-note markup, a 2400 × 1600 hatch JPEG drawn 4 in wide (600 dpi) on both sheets and again
   inside a form XObject at half scale (so drawn 300 pt wide at most), and a 1200 × 800 photo stored as raw Flate pixels with an
   alpha mask. The Compress button's size limit is lowered to 1 MB for the test (localStorage zd-tk-cmp-min).
   Checks: a PDF being added is never asked about and is kept as the original (an old "always compress" setting is ignored);
   Pages → Compress asks the level (Balanced first) and keeps the smaller copy (meta.orig: the original's fingerprint and size);
   the hatch is resampled to the biggest size it is drawn at (625 × 417 at 150 dpi, form matrix followed), the photo becomes a JPEG,
   its mask is kept; every page's content stream, the layers, the markup and the page sizes are byte-for-byte / exactly as before;
   the app shows the same layers, vector lines (snap) and text as the uncompressed copy; the picture on screen looks the same.
   Strong shrinks it in place — the same file id, pages, measurements and project; Light writes a raw photo as a JPEG at its own
   size; adding the original again re-attaches it (same id) and keeps the original; a vector-only PDF is left as it is
   ("compact already"); no page errors. */
const path = require("path"), fs = require("fs"), os = require("os");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } return !!cond; }

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs")) || !fs.existsSync(path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"))) { console.log("TK_LIBS must hold pdfjs-dist, exceljs and pdf-lib — see the header"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib"));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e) + (process.env.TK_DEBUG ? " @ " + (e.stack || "").split(/\n/).slice(1, 6).join(" < ") : "")));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgOn = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const dlgTitle = () => T(() => document.getElementById("dlgT").textContent);
  const toastHas = re => page.waitForFunction(s => new RegExp(s).test(document.getElementById("toast").textContent), re.source, {timeout: 120000, polling: 100}).then(() => true, () => false);
  const newProject = async name => { if (!(await T(() => document.getElementById("start").classList.contains("on")))) { await page.click("#bProjects"); await page.waitForFunction(() => document.getElementById("start").classList.contains("on")); }
    await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400); };
  const shown = () => page.waitForFunction(() => { const Z = zdTakeoff, f = Z.P.proj && Z.P.proj.files[0]; return f && Z.S.fileId === f.id && Z.S.page && !document.getElementById("busy").textContent; }, null, {timeout: 120000, polling: 100});
  const indexed = () => page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.S.texts[zdTakeoff.S.key], null, {timeout: 30000});
  /* what the app sees of page 1: layers, vector lines (the snap's), text */
  const seen = () => T(() => { const S = zdTakeoff.S, g = S.geo[S.key], cfg = S.ocgs && S.ocgs[S.fileId];
    let sum = 0; g.segs.forEach(s => { sum += s[0] * 1.3 + s[1] * 1.7 + s[2] * 1.9 + s[3] * 2.3; });
    return {layers: cfg ? Object.values(cfg.getGroups()).map(x => x.name).sort() : [], segs: g.segs.length, sum: Math.round(sum * 100) / 100,
      text: (S.texts[S.key] || []).map(t => t.s).join(" "), W: S.base.width, H: S.base.height}; });
  /* the PDF kept in this browser, as bytes */
  const storedBytes = () => T(async () => { const f = zdTakeoff.P.proj.files[0], r = await zdTakeoff.cmpDb("pdfs", f.id); const b = new Uint8Array(r.data instanceof Blob ? await r.data.arrayBuffer() : r.data);
    let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return {b64: btoa(s), sha: r.sha, size: r.size}; });

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await T(() => { localStorage.setItem("zd-tk-cmp-min", String(1048576)); });

  /* ---- the fixture ---- */
  const pix = await T(() => {
    const hatch = (() => { const w = 2400, h = 1600, c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
      x.strokeStyle = "#000"; x.lineWidth = 4; for (let i = -h; i < w; i += 24) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); }
      const d = x.getImageData(0, 0, w, h); let s = 7; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = (s >> 16) % 50; d.data[i] -= n; d.data[i + 1] -= n; d.data[i + 2] -= n; }
      x.putImageData(d, 0, 0); return c.toDataURL("image/jpeg", 0.95).split(",")[1]; })();
    const photo = (() => { const w = 1200, h = 800, c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#3a7bd5"); g.addColorStop(1, "#d5a03a"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      const d = x.getImageData(0, 0, w, h); let s = 3; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; d.data[i] += (s >> 16) % 40; d.data[i + 1] += (s >> 18) % 40; }
      x.putImageData(d, 0, 0); x.clearRect(0, 0, 160, 120); return c.toDataURL("image/png").split(",")[1]; })();   // (a transparent corner: pdf-lib gives it a soft mask)
    return {hatch, photo}; });
  const {PDFDocument, PDFName, PDFString, PDFDict, StandardFonts, decodePDFRawStream, PDFRawStream} = PL;
  const d0 = await PDFDocument.create(), c0 = d0.context;
  const hatch = await d0.embedJpg(Buffer.from(pix.hatch, "base64")), photo = await d0.embedPng(Buffer.from(pix.photo, "base64")), font = await d0.embedFont(StandardFonts.Helvetica);
  const ocA = c0.register(c0.obj({Type: "OCG", Name: PDFString.of("A-WALL")})), ocH = c0.register(c0.obj({Type: "OCG", Name: PDFString.of("S-HATCH")}));
  d0.catalog.set(PDFName.of("OCProperties"), c0.obj({OCGs: [ocA, ocH], D: {Order: [ocA, ocH], ON: [ocA, ocH]}}));
  for (let p = 0; p < 2; p++) {
    const pg = d0.addPage([2384, 1684]);
    pg.drawImage(hatch, {x: 200, y: 900, width: 288, height: 192});
    if (p === 0) pg.drawImage(photo, {x: 1200, y: 900, width: 400, height: 266.67});
    pg.drawText(p ? "FIRST FLOOR PLAN" : "GROUND FLOOR PLAN", {x: 200, y: 200, size: 24, font});
    pg.node.Resources().set(PDFName.of("Properties"), c0.obj({ocA, ocH}));
    let s = "/OC /ocA BDC 0 0 0 RG 2 w "; for (let i = 0; i < 40; i++) s += (300 + i * 40) + " 300 m " + (300 + i * 40) + " 800 l S "; s += "100 100 2000 1400 re S EMC /OC /ocH BDC 0.5 w ";
    for (let i = 0; i < 60; i++) s += (1000 + i * 10) + " 300 m " + (1100 + i * 10) + " 500 l S "; s += "EMC";
    pg.node.addContentStream(c0.register(c0.flateStream(s)));
  }
  const form = c0.register(c0.flateStream("q 600 0 0 400 0 0 cm /Im9 Do Q", {Type: "XObject", Subtype: "Form", BBox: [0, 0, 600, 400], Matrix: [0.5, 0, 0, 0.5, 0, 0], Resources: {XObject: {Im9: hatch.ref}}}));
  { const p2 = d0.getPage(1); p2.node.Resources().lookup(PDFName.of("XObject"), PDFDict).set(PDFName.of("Fm9"), form); p2.node.addContentStream(c0.register(c0.flateStream("q 1 0 0 1 1500 300 cm /Fm9 Do Q"))); }
  { const an = c0.register(c0.obj({Type: "Annot", Subtype: "Text", Rect: [500, 500, 520, 520], Contents: PDFString.of("check the lintel"), F: 4})); d0.getPage(0).node.set(PDFName.of("Annots"), c0.obj([an])); }
  const origBytes = await d0.save({useObjectStreams: false});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zdcmp_")), file = path.join(dir, "Structure set.pdf"); fs.writeFileSync(file, origBytes);
  const vfile = path.join(dir, "Vector plan.pdf"); fs.writeFileSync(vfile, makePdf());
  console.log("fixture: " + (origBytes.length / 1048576).toFixed(1) + " MB, 2 pages");

  /* what a PDF holds, read with pdf-lib: per page its content (decoded), size, annotations; its layers; its pictures */
  const anatomy = async bytes => {
    const d = await PDFDocument.load(bytes), ctx = d.context, look = o => o && o.objectNumber !== undefined ? ctx.lookup(o) : o;
    const pages = d.getPages().map(pg => { const cs = pg.node.Contents(), arr = cs.asArray ? cs.asArray().map(look) : [cs];
      return {content: Buffer.concat(arr.map(s => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()))).toString("latin1"), w: pg.getWidth(), h: pg.getHeight(),
        annots: (pg.node.Annots() ? pg.node.Annots().asArray().map(a => String(look(a).get(PDFName.of("Contents")))) : [])}; });
    const ocp = d.catalog.lookup(PDFName.of("OCProperties"), PDFDict), layers = ocp ? ocp.lookup(PDFName.of("OCGs")).asArray().map(r => String(look(r).get(PDFName.of("Name")))).sort() : [];
    const imgs = []; for (const [ref, o] of ctx.enumerateIndirectObjects()) if (o instanceof PDFRawStream && String(o.dict.get(PDFName.of("Subtype"))) === "/Image")
      imgs.push({n: ref.objectNumber, w: o.dict.get(PDFName.of("Width")).asNumber(), h: o.dict.get(PDFName.of("Height")).asNumber(), f: String(o.dict.get(PDFName.of("Filter"))), smask: !!o.dict.get(PDFName.of("SMask")), bytes: o.contents.length});
    return {pages, layers, imgs};
  };
  const A0 = await anatomy(origBytes);

  console.log("adding a big PDF: no question, kept as the original; then Pages → Compress (Balanced)");
  await T(() => zdTakeoff.cmpSet({bigPdf: "always"}));   // (a setting left by the version that asked when adding: ignored now)
  await newProject("Compress A");
  await page.setInputFiles("#fileIn", file); await wait(600);
  ok(!(await dlgOn()), "adding it asks nothing (an old “always compress” setting in this browser is ignored)");
  await shown(); await indexed();
  { const f = await T(async () => { const f = zdTakeoff.P.proj.files[0], r = await zdTakeoff.cmpDb("pdfs", f.id); return {size: f.size, orig: f.orig || null, rs: r.size}; });
    ok(f.size === origBytes.length && f.rs === origBytes.length && !f.orig, "it is kept as the original (" + (f.size / 1048576).toFixed(2) + " MB)"); }
  await page.click("#tPages"); await wait(300);
  ok(await page.locator("#pageList [data-cmppdf]").count() === 1, "Pages: the drawing has a Compress button");
  await page.click("#pageList [data-cmppdf]"); await wait(200);
  ok(await dlgOn() && /^Compress /.test(await dlgTitle()), "…which asks for the level");
  ok((await T(() => document.getElementById("cmpLv").value)) === "balanced", "…Balanced (150 dpi) first");
  await page.click("#dlgOk");
  await page.waitForFunction(() => zdTakeoff.P.proj.files[0].orig, null, {timeout: 120000, polling: 100}); await shown(); await indexed();
  ok(await toastHas(/compressed: .* smaller/), "a toast says how much smaller it is: " + (await T(() => document.getElementById("toast").textContent)).slice(0, 120));
  const fa = await T(() => { const f = zdTakeoff.P.proj.files[0]; return {id: f.id, size: f.size, sha: f.sha, orig: f.orig, pages: f.pages}; }), pidA = await T(() => zdTakeoff.P.proj.id);
  ok(fa.orig && fa.orig.size === origBytes.length && /^[0-9a-f]{64}$/.test(fa.orig.sha || "") && fa.orig.level === "balanced", "the drawing keeps the original's fingerprint and size (meta.orig)");
  ok(fa.size < 0.35 * origBytes.length, "the copy kept is much smaller: " + (fa.size / 1048576).toFixed(2) + " MB of " + (origBytes.length / 1048576).toFixed(2) + " MB");
  ok(fa.pages === 2, "both pages are there");
  const stA = await storedBytes(), bytesA = Buffer.from(stA.b64, "base64");
  ok(stA.sha === fa.sha && stA.size === fa.size && bytesA.length === fa.size, "the browser keeps that smaller copy, under its own fingerprint");
  const A1 = await anatomy(bytesA);
  ok(A1.pages.length === 2 && A1.pages.every((p, i) => p.content === A0.pages[i].content), "every page's content stream (lines, text, layers' marks) is exactly as before");
  ok(A1.pages.every((p, i) => p.w === A0.pages[i].w && p.h === A0.pages[i].h), "the page sizes are the same (calibration stays right)");
  ok(JSON.stringify(A1.layers) === JSON.stringify(A0.layers) && A1.layers.length === 2, "the PDF's layers are kept: " + A1.layers.join(", "));
  ok(A1.pages[0].annots.join() === A0.pages[0].annots.join() && A1.pages[0].annots.length === 1, "the markup (a sticky note) is kept");
  { const h0 = A0.imgs.find(x => x.w === 2400), h1 = A1.imgs.find(x => x.n === h0.n), p0 = A0.imgs.find(x => x.w === 1200 && !/DCT/.test(x.f) && x.smask), p1 = p0 && A1.imgs.find(x => x.n === p0.n);
    ok(h1 && h1.w === 625 && h1.h === 417 && /DCT/.test(h1.f), "the hatch picture is resampled to 150 dpi of the biggest size it is drawn at (the form's): " + (h1 ? h1.w + " × " + h1.h : "?"));
    ok(p1 && p1.w === 834 && /DCT/.test(p1.f) && p1.smask, "the raw photo becomes a JPEG at 150 dpi, its transparency mask kept: " + (p1 ? p1.w + " × " + p1.h + " " + p1.f : "?"));
    const m0 = A0.imgs.find(x => x.w === 1200 && /Flate/.test(x.f) && !x.smask), m1 = m0 && A1.imgs.find(x => x.n === m0.n);
    ok(!m0 || (m1 && m1.w === m0.w && m1.bytes === m0.bytes), "a mask (drawn by no page itself) is left as it is"); }
  const seenA = await seen();
  ok(seenA.layers.join() === "A-WALL,S-HATCH", "the app lists both layers: " + seenA.layers.join(", "));
  ok(seenA.segs >= 100 && /GROUND FLOOR PLAN/.test(seenA.text), "the app reads the vector lines (" + seenA.segs + ") and the text");

  console.log("another project: added, then Pages → Compress (Strong)");
  await newProject("Compress B");
  await page.setInputFiles("#fileIn", file);
  await shown(); await indexed();
  const fb = await T(() => { const f = zdTakeoff.P.proj.files[0]; return {id: f.id, size: f.size, orig: f.orig || null}; });
  ok(fb.size === origBytes.length && !fb.orig, "kept as the original");
  const seenB = await seen();
  ok(JSON.stringify(seenB) === JSON.stringify(seenA), "the compressed drawing shows the same layers, vector lines (snap points " + seenA.segs + ", checksum " + seenA.sum + "), text and page size as the original");
  if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); }
  await page.click("#tCond"); await wait(200); await page.locator("#bNewCond").click({force: true}); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await wait(250);
  await T(() => { const P = zdTakeoff.P.proj, c = P.conds.find(x => x.name === "Floor area").id;
    P.items.push({id: "Ikeep", cond: c, file: P.files[0].id, page: 1, pts: [[300, 300], [700, 300], [700, 800], [300, 800]], nos: 1, label: "", kind: "shape"}); zdTakeoff.refresh && zdTakeoff.refresh(); });
  await wait(300);
  const projBefore = await T(() => { const o = JSON.parse(JSON.stringify(zdTakeoff.P.proj)); delete o.files; delete o.updated; delete o.last; return JSON.stringify(o); });
  await page.click("#tPages"); await wait(300);
  await page.click("#pageList [data-cmppdf]"); await wait(200);
  await page.selectOption("#cmpLv", "strong"); await page.click("#dlgOk");
  await page.waitForFunction(() => zdTakeoff.P.proj.files[0].orig, null, {timeout: 120000, polling: 100}); await shown(); await indexed();
  const fb2 = await T(() => { const f = zdTakeoff.P.proj.files[0]; return {id: f.id, size: f.size, orig: f.orig, pages: f.pages}; });
  ok(fb2.id === fb.id && fb2.pages === 2, "compressed in place: the same file id and pages");
  ok(fb2.size < fa.size && fb2.orig.size === origBytes.length && fb2.orig.level === "strong", "Strong is smaller still: " + (fb2.size / 1048576).toFixed(2) + " MB");
  ok(await T(() => /compressed/.test(document.getElementById("pageList").textContent)), "the Pages tab marks it compressed");
  const projAfter = await T(() => { const o = JSON.parse(JSON.stringify(zdTakeoff.P.proj)); delete o.files; delete o.updated; delete o.last; return JSON.stringify(o); });
  ok(projAfter === projBefore, "the measurements, scales and the rest of the project are untouched");
  ok(JSON.stringify(await seen()) === JSON.stringify(seenA), "after compressing in place: the same layers, vector lines and text");
  { const B1 = await anatomy(Buffer.from((await storedBytes()).b64, "base64")); ok(B1.pages.every((p, i) => p.content === A0.pages[i].content), "…and the same page content, byte for byte");
    const h0 = A0.imgs.find(x => x.w === 2400), h1 = B1.imgs.find(x => x.n === h0.n); ok(h1 && h1.w === 417, "Strong: the hatch at 100 dpi (" + (h1 && h1.w) + " px wide)"); }

  console.log("the picture on screen");
  { const diff = await T(async ([a, b]) => { const lib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"); lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
      const draw = async b64 => { const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), d = await lib.getDocument({data: u, isEvalSupported: false}).promise, pg = await d.getPage(1), v = pg.getViewport({scale: 0.5}), c = document.createElement("canvas"); c.width = v.width; c.height = v.height;
        await pg.render({canvasContext: c.getContext("2d"), viewport: v}).promise; const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; await d.destroy(); return px; };
      const p = await draw(a), q = await draw(b); let s = 0, n = 0; for (let i = 0; i < p.length; i += 4) { s += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); n += 3; } return s / n; },
      [Buffer.from(origBytes).toString("base64"), stA.b64]);
    ok(diff < 6, "page 1 compressed (Balanced) looks the same as the original — mean difference " + diff.toFixed(2) + " of 255"); }

  console.log("the original added again");
  await T(id => zdTakeoff.openProject(id), pidA); await wait(500); await shown();
  await page.setInputFiles("#fileIn", file); await wait(400);
  ok(!(await dlgOn()), "no question");
  ok(await toastHas(/same drawing — re-attached as the original/), "re-attached as the same drawing, as the original");
  { const r = await T(async () => { const P = zdTakeoff.P.proj, f = P.files[0], rec = await zdTakeoff.cmpDb("pdfs", f.id); return {n: P.files.length, id: f.id, size: f.size, rs: rec.size, sha: f.sha, rsha: rec.sha, orig: !!f.orig}; });
    ok(r.n === 1 && r.id === fa.id && r.size === origBytes.length && r.rs === origBytes.length && r.sha === r.rsha && !r.orig, "still one drawing (the same id): the original is kept now (" + (r.rs / 1048576).toFixed(2) + " MB)"); }

  console.log("Light; a vector-only PDF");
  await newProject("Compress E");
  await page.setInputFiles("#fileIn", file); await shown();
  { const f = await T(async () => { const f = zdTakeoff.P.proj.files[0]; await zdTakeoff.compressPdf(f.id, "light"); return {size: f.size, orig: f.orig}; });
    ok(f.orig && f.orig.level === "light" && f.size < 0.25 * origBytes.length && f.size > fa.size, "Light: " + (f.size / 1048576).toFixed(2) + " MB — the photo, not over-sampled at 200 dpi, still written as a JPEG at its own size"); }
  await newProject("Compress F");
  await page.setInputFiles("#fileIn", vfile); await shown(); await wait(300);
  if (await dlgOn()) { await page.keyboard.press("Escape"); await wait(150); }
  { const r = await T(async () => { const f = zdTakeoff.P.proj.files[0], size = f.size, sha = f.sha, out = await zdTakeoff.compressPdf(f.id, "strong"); return {out, same: f.size === size && f.sha === sha && !f.orig}; });
    ok(r.out && r.out.kept && r.same, "a vector-only PDF: nothing to gain — left exactly as it is");
    ok(await toastHas(/compact already/), "…and the toast says so"); }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  try { fs.rmSync(dir, {recursive: true, force: true}); } catch (e) {}
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

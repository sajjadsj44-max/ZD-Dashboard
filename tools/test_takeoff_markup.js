#!/usr/bin/env node
/* Browser tests for PDF Takeoff's markup tools (Bluebeam Revu Basics): text box, callout, line, polyline, polygon,
   rectangle, ellipse, pen, highlighter pen, stamps (with the name and date), image, hyperlink, file attachment, redaction —
   their properties (fill, hatch, arrow ends, status), handles, Set as default, Tool Chest, undo, reload; exports (a redacted
   page flattened, links and attachments inside the PDF); Project + PDFs carrying pictures and files; a project file's
   markups cleaned of anything unsafe.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_takeoff_markup.js                 (TK_URL / TK_LIBS as for test_takeoff.js)
*/
const path = require("path"), fs = require("fs"), os = require("os"), zlib = require("zlib");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.01 : t);

function png(w, h, px){   // a small RGBA PNG, px(x, y) -> [r, g, b, a]
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px(x, y), o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3]; }
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see test_takeoff.js"); process.exit(2); }
  const PL = require(path.join(LIBS, "pdf-lib"));
  const browser = await pw.chromium.launch();
  const route = async ctx => ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    return r.abort();
  });
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx); await route(ctx);
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const at = (x, y) => T(([x, y]) => { const S = zdTakeoff.S, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + x * S.view.s + S.view.tx, r.top + y * S.view.s + S.view.ty]; }, [x, y]);   // page point -> client px
  const clickAt = async (x, y) => { const p = await at(x, y); await page.mouse.move(p[0], p[1]); await wait(30); await page.mouse.down(); await page.mouse.up(); await wait(90); };
  const dragAt = async (x0, y0, x1, y1, steps) => { const a = await at(x0, y0), b = await at(x1, y1); await page.mouse.move(a[0], a[1]); await page.mouse.down(); const n = steps || 6;
    for (let i = 1; i <= n; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); await page.mouse.up(); await wait(140); };
  const marks = () => T(() => JSON.parse(JSON.stringify(zdTakeoff.P.proj.marks || [])));
  const last = async () => (await marks()).slice(-1)[0];
  const tool = async t => { await T(t => zdTakeoff.setTool(t), t); await wait(80); };
  const selectAt = async (x, y) => { await tool("select"); await clickAt(x, y); await wait(120); return T(() => zdTakeoff.S.selMark); };   // a click with the Select tool, as a person selects
  const ov = () => T(() => document.getElementById("ov").innerHTML);
  const dlg = () => T(() => document.getElementById("dlgBack").classList.contains("on"));
  const shot = async n => { if (process.env.TK_SHOTS) await page.screenshot({path: path.join(process.env.TK_SHOTS, "markup-" + n + ".png")}); };

  console.log("project");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Markup test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000}); await wait(300);
  await page.uncheck("#snapOn");
  await T(() => { const Z = zdTakeoff, st = document.getElementById("stage"), s = Math.min(st.clientWidth / Z.S.base.width, st.clientHeight / Z.S.base.height) * 0.95; Z.S.view = {s, tx: 10, ty: 10}; Z.applyView(); }); await wait(200);
  const view = await T(() => zdTakeoff.S.view.s);

  console.log("Markup menu");
  await page.click("#bMk"); await wait(150);
  const menu = await T(() => document.getElementById("ctx").innerText);
  ok(["Text box", "Callout", "Line", "Polyline", "Polygon", "Rectangle", "Ellipse", "Pen", "Highlighter pen", "Stamp", "Image", "Hyperlink", "File attachment", "Redaction", "Erase"].every(n => menu.includes(n)), "Markup ▾ lists every markup tool");
  await page.keyboard.press("Escape"); await wait(100);

  console.log("text box");
  await page.keyboard.press("t"); await wait(80);
  ok((await T(() => zdTakeoff.S.tool)) === "mk_text" && /Text box/.test(await page.innerText("#bMk")), "T picks the Text box tool (the Markup button says so)");
  await dragAt(100, 100, 300, 120);
  ok(await dlg(), "after the box is drawn, its text is asked for");
  await page.fill("#mkTx", "Check slab level\nwith structure"); await page.fill("#mkFs", "10"); await page.click("#dlgOk"); await wait(200);
  let m = await last();
  ok(m && m.type === "text" && m.text === "Check slab level\nwith structure" && m.subject === "Text box", "a text box with two lines (subject: Text box)");
  ok(m && near(m.pts[1][0] - m.pts[0][0], 200, 0.5) && near(m.pts[1][1] - m.pts[0][1], 2 * 10 * 1.22 + 2 * 3.5, 0.2), "its width is the box dragged (200 pt), its height fits its two lines");
  ok((await ov()).includes("Check slab level") && (await ov()).includes("with structure"), "both lines drawn on the sheet");

  console.log("callout");
  await page.keyboard.press("q"); await clickAt(420, 300); await clickAt(470, 240);
  ok(await dlg(), "callout: tip, then box — then its text");
  await page.fill("#mkTx", "Beam B12 — 9\" deep"); await page.click("#dlgOk"); await wait(200);
  m = await last();
  ok(m && m.type === "callout" && m.pts.length === 3 && near(m.pts[0][0], 420, 0.6) && near(m.pts[0][1], 300, 0.6) && near(m.pts[1][0], 470, 0.6), "a callout pointing at the tip, its box where it was clicked");
  ok(/Beam B12/.test(await ov()), "the callout's text is drawn");

  console.log("lines and shapes");
  await page.keyboard.press("Shift+L"); await dragAt(100, 400, 300, 400);
  m = await last(); ok(m && m.type === "line" && near(m.pts[0][0], 100, 0.6) && near(m.pts[1][0], 300, 0.6), "line (Shift+L), dragged");
  const lineId = m.id;
  await page.keyboard.press("y"); for (const [x, y] of [[100, 450], [200, 470], [300, 450]]) await clickAt(x, y); await page.keyboard.press("Enter"); await wait(150);
  m = await last(); ok(m && m.type === "polyline" && m.pts.length === 3, "polyline (Y): three points, Enter");
  await page.keyboard.press("g"); for (const [x, y] of [[350, 420], [450, 420], [450, 500], [350, 500]]) await clickAt(x, y); await clickAt(350, 420); await wait(150);
  m = await last(); ok(m && m.type === "polygon" && m.pts.length === 4 && m.fill, "polygon (G): four corners, closed on the first, filled");
  await page.keyboard.press("Shift+R"); await dragAt(520, 100, 620, 160);
  m = await last(); ok(m && m.type === "box" && near(m.pts[1][0] - m.pts[0][0], 100, 0.6) && near(m.pts[1][1] - m.pts[0][1], 60, 0.6), "rectangle (Shift+R) 100 × 60 pt");
  const boxId = m.id;
  await page.keyboard.press("Shift+E"); await dragAt(520, 200, 620, 260);
  m = await last(); ok(m && m.type === "ellipse", "ellipse (Shift+E)");
  await page.keyboard.press("p");
  { const pts = Array.from({length: 24}, (_, i) => [520 + i * 4, 300 + Math.sin(i / 3) * 12]), a = await at(...pts[0]); await page.mouse.move(a[0], a[1]); await page.mouse.down();
    for (const q of pts.slice(1)) { const b = await at(...q); await page.mouse.move(b[0], b[1]); } await page.mouse.up(); await wait(150); }
  m = await last(); ok(m && m.type === "pen" && !m.hl && m.pts.length >= 4 && m.pts.length < 24, "pen (P): a freehand stroke, simplified (" + (m && m.pts.length) + " points)");
  await page.keyboard.press("Shift+H"); await dragAt(520, 360, 640, 360);
  m = await last(); ok(m && m.type === "pen" && m.hl && m.op < 1, "highlighter pen (Shift+H): see-through");
  const vis = await ov(); ok(/<ellipse/.test(vis) && /stroke-dasharray|<path d="M/.test(vis), "rectangle, ellipse and pen strokes on the sheet");

  console.log("properties");
  ok((await selectAt(200, 400)) === lineId, "a click on the line selects it");
  ok(await page.isVisible('#props [data-mprop="a1"]'), "a selected line shows its ends, style, colour, status in Properties");
  await page.selectOption('#props [data-mprop="a1"]', "arrow"); await wait(120);
  await page.selectOption('#props [data-mprop="dash"]', "dash"); await wait(120);
  m = (await marks()).find(x => x.id === lineId); ok(m.a1 === "arrow" && m.dash === "dash", "end arrow and dashed line set from Properties");
  await page.selectOption('#props [data-mprop="status"]', "Accepted"); await wait(120);
  m = (await marks()).find(x => x.id === lineId); ok(m.status === "Accepted", "status: Accepted");
  ok((await selectAt(520, 130)) === boxId, "a click on the rectangle's edge selects it");
  await page.selectOption('#props [data-mprop="hatch.p"]', "cross"); await wait(150);
  m = (await marks()).find(x => x.id === boxId); ok(m.hatch && m.hatch.p === "cross" && m.hatch.sp > 0, "a cross-hatch on the rectangle");
  ok(/<pattern id="mkp\d+"/.test(await ov()), "the hatch pattern is drawn");
  await page.uncheck('#props [data-mprop="nofill"]'); await wait(120);
  m = (await marks()).find(x => x.id === boxId); ok(!!m.fill, "a fill colour switched on"); await shot("props");

  console.log("handles");
  { const r0 = m.pts.map(p => p.slice()), h = await at(r0[1][0], r0[1][1]), g = await at(r0[1][0] + 40, r0[1][1] + 20);
    await page.mouse.move(h[0], h[1]); await page.mouse.down(); for (let i = 1; i <= 5; i++) await page.mouse.move(h[0] + (g[0] - h[0]) * i / 5, h[1] + (g[1] - h[1]) * i / 5); await page.mouse.up(); await wait(150);
    m = (await marks()).find(x => x.id === boxId);
    ok(near(m.pts[1][0], r0[1][0] + 40, 1) && near(m.pts[1][1], r0[1][1] + 20, 1) && near(m.pts[0][0], r0[0][0], 0.01), "dragging the corner handle resizes the rectangle (the other corner stays)");
    await page.keyboard.press("Control+z"); await wait(150);
    m = (await marks()).find(x => x.id === boxId); ok(near(m.pts[1][0], r0[1][0], 0.01), "Ctrl+Z puts it back"); }

  console.log("set as default · Tool Chest");
  ok((await selectAt(560, 130)) === boxId, "a click inside the filled rectangle selects it");
  await page.click('#props [data-mact2="default"]'); await wait(150);
  await page.keyboard.press("Shift+R"); await dragAt(660, 100, 720, 140);
  m = await last(); ok(m.type === "box" && m.hatch && m.hatch.p === "cross" && !!m.fill, "Set as default: the next rectangle comes with the cross-hatch and fill");
  await T(() => zdTakeoff.setTool("select"));
  await tool("select");
  const tp = await at(150, 105); await page.mouse.click(tp[0], tp[1], {button: "right"}); await wait(150);
  ok(/Add to Tool Chest/.test(await T(() => document.getElementById("ctx").innerText)) && /Edit text/.test(await T(() => document.getElementById("ctx").innerText)), "right-click on a text box: Edit text…, Add to Tool Chest…");
  await page.click("#ctx >> text=Add to Tool Chest…"); await wait(200);
  await page.fill("#tcName", "Red note text"); await page.click('[data-tc="save"]'); await wait(150);
  const chest = await T(() => JSON.parse(localStorage.getItem("zdTakeoffToolChest") || "[]"));
  ok(chest.some(p => p.name === "Red note text" && p.kind === "markup" && p.type === "text" && p.props.fs === 10), "the text style saved in the Tool Chest");
  await T(() => document.getElementById("dlgCancel").click()); await wait(100);

  console.log("stamp");
  await T(() => localStorage.removeItem("zdTakeoffUser"));
  await page.keyboard.press("x"); await page.waitForSelector("#stGrid", {timeout: 3000});
  ok((await page.locator("#stGrid .stp").count()) >= 16, "the stamp picker shows Bluebeam's standard stamps"); await shot("stamps");
  await page.click('#stGrid [data-st="0"]'); await page.click("#dlgOk"); await wait(150);
  await clickAt(250, 600);
  await page.waitForSelector("#dlgUser", {timeout: 3000}); await page.fill("#dlgUser", "Test Checker"); await page.click("#dlgOk"); await wait(250);
  m = await last();
  const today = await T(() => { const d = new Date(), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return ("0" + d.getDate()).slice(-2) + "-" + M[d.getMonth()] + "-" + d.getFullYear(); });
  ok(m && m.type === "stamp" && m.stamp.label === "APPROVED" && m.stamp.sub.includes("Test Checker") && m.stamp.sub.includes(today), "APPROVED stamp placed by a click — second line: " + (m && m.stamp.sub));
  ok(/APPROVED/.test(await ov()), "the stamp is drawn");
  await page.keyboard.press("Escape"); await wait(80);

  console.log("image");
  await tool("mk_image");
  { const [fc] = await Promise.all([page.waitForEvent("filechooser"), clickAt(700, 300)]);
    await fc.setFiles({name: "logo.png", mimeType: "image/png", buffer: png(40, 20, (x, y) => x < 20 ? [220, 30, 30, 255] : [30, 60, 220, 255])}); }
  await page.waitForFunction(() => (zdTakeoff.P.proj.marks || []).some(m => m.type === "image"), null, {timeout: 5000}); await wait(200);
  m = (await marks()).find(x => x.type === "image");
  ok(m && m.img && m.img.aid && m.img.w === 40 && m.img.h === 20 && near((m.pts[1][0] - m.pts[0][0]) / (m.pts[1][1] - m.pts[0][1]), 2, 0.01), "a 40 × 20 picture placed at its shape (2 : 1)");
  ok(/<image href="data:image\/png/.test(await ov()), "the picture is drawn");
  ok(!JSON.stringify(await T(() => zdTakeoff.P.proj.marks)).includes("data:image"), "the picture is kept beside the project, not inside it (undo stays light)");
  const imgId = m.id, imgAid = m.img.aid;
  await T(() => zdTakeoff.setTool("select")); await wait(100); await shot("sheet");

  console.log("hyperlink · attachment · redaction");
  await tool("mk_link"); await dragAt(100, 650, 220, 690);
  await page.fill("#lkU", "example.com/spec"); await page.fill("#lkX", "Spec section 3"); await page.click("#dlgOk"); await wait(150);
  m = await last(); ok(m && m.type === "link" && m.link.url === "https://example.com/spec", "hyperlink to a web address (https:// added)");
  const linkId = m.id;
  await tool("mk_attach");
  { const [fc] = await Promise.all([page.waitForEvent("filechooser"), clickAt(300, 680)]); await fc.setFiles({name: "site-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Pour on Monday.\n")}); }
  await page.waitForFunction(() => (zdTakeoff.P.proj.marks || []).some(m => m.type === "attach"), null, {timeout: 5000}); await wait(150);
  m = (await marks()).find(x => x.type === "attach");
  ok(m && m.att.name === "site-notes.txt" && m.att.size === 16, "a file attached (site-notes.txt, 16 B)");
  const attAid = m.att.aid;
  ok(await T(aid => zdTakeoff.assetRec(aid).then(r => !!r && r.size === 16 && r.type === "text/plain"), attAid), "…stored in this browser beside the PDFs");
  const textAt = await T(() => { const t = (zdTakeoff.S.texts[zdTakeoff.S.key] || [])[0]; return t ? [t.x, t.y] : null; });
  ok(!!textAt, "the fixture page has text to redact");
  await tool("mk_redact"); await dragAt(textAt[0] - 5, textAt[1] - 15, textAt[0] + 60, textAt[1] + 6);
  m = await last(); ok(m && m.type === "redact" && !m.erase, "a redaction box over the text");
  await T(() => zdTakeoff.setTool("select")); await wait(80);

  console.log("export");
  const dl = async fn => { const [d] = await Promise.all([page.waitForEvent("download", {timeout: 30000}), T(fn)]); const f = path.join(os.tmpdir(), "zdmk_" + Date.now() + "_" + d.suggestedFilename()); await d.saveAs(f); return fs.readFileSync(f); };
  const pdf = await dl(() => zdTakeoff.exportPdf(false));
  const doc = await PL.PDFDocument.load(pdf), pg0 = doc.getPage(0), res = pg0.node.Resources();
  { const F = res.lookup(PL.PDFName.of("Font")), X = res.lookup(PL.PDFName.of("XObject"));
    ok((!F || F.keys().length === 0) && X && X.keys().length >= 1, "the redacted page is flattened to a picture: no fonts, so no text left under the redaction"); }
  const annots = (pg0.node.Annots() || {asArray: () => []}).asArray().map(r => doc.context.lookup(r));
  const uri = annots.map(a => a.lookup(PL.PDFName.of("A"))).filter(Boolean).map(a => a.lookup(PL.PDFName.of("URI"))).filter(Boolean).map(u => u.decodeText ? u.decodeText() : String(u));
  ok(uri.includes("https://example.com/spec"), "the hyperlink is a real link in the PDF");
  const names = doc.catalog.lookup(PL.PDFName.of("Names")), ef = names && names.lookup(PL.PDFName.of("EmbeddedFiles"));
  ok(!!ef, "the attached file is inside the PDF");
  { await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 2)); await page.waitForFunction(() => zdTakeoff.S.pageNo === 2 && zdTakeoff.S.page, null, {timeout: 10000}); await wait(300);
    const pdf2 = await dl(() => zdTakeoff.exportPdf(false)), d2 = await PL.PDFDocument.load(pdf2), F2 = d2.getPage(0).node.Resources().lookup(PL.PDFName.of("Font"));
    ok(F2 && F2.keys().length > 0, "a page without a redaction stays the original vector page (its fonts and text kept)");
    await T(() => zdTakeoff.gotoPage(zdTakeoff.S.fileId, 1)); await page.waitForFunction(() => zdTakeoff.S.pageNo === 1 && zdTakeoff.S.page, null, {timeout: 10000}); await wait(300); }
  const svg = await T(() => zdTakeoff.pageOverlaySvg(zdTakeoff.S.fileId, zdTakeoff.S.pageNo, 2, 1000, 1000, {legend: "none"}));
  ok(svg.includes("Check slab level") && svg.includes("APPROVED") && /<pattern/.test(svg) && svg.includes("data:image/png"), "the export overlay has the text box, stamp, hatch and picture");

  console.log("reload");
  await page.reload({waitUntil: "load"}); await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj && zdTakeoff.S.page, null, {timeout: 20000}); await wait(800);
  ok((await marks()).length >= 14, "after a reload every markup is there (" + (await marks()).length + ")");
  await page.waitForFunction(() => document.getElementById("ov").innerHTML.includes("data:image/png"), null, {timeout: 5000}).then(() => ok(true, "…and the picture is drawn again from this browser's store"), () => ok(false, "…and the picture is drawn again from this browser's store"));

  console.log("Project + PDFs");
  const bundle = await dl(() => zdTakeoff.exportBundle());
  { const ML = "ZDTAKEOFF-BUNDLE-1\n".length, hl = bundle.readUInt32BE(ML), H = JSON.parse(bundle.slice(ML + 4, ML + 4 + hl).toString("utf8"));
    ok(Array.isArray(H.assets) && H.assets.some(a => a.aid === imgAid) && H.assets.some(a => a.aid === attAid && a.size === 16), "Project + PDFs carries the picture and the attached file");
    const ctx2 = await browser.newContext({viewport: {width: 1280, height: 800}}); await require("./zd_unlock")(ctx2); await route(ctx2);
    const p2 = await ctx2.newPage(); await p2.goto(URL, {waitUntil: "load"}); await p2.waitForTimeout(600);
    await p2.evaluate(b64 => { const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; zdTakeoff.importBundle(b).catch(() => {}); }, bundle.toString("base64"));
    const got = await p2.waitForFunction(([a, b]) => Promise.all([zdTakeoff.assetRec(a), zdTakeoff.assetRec(b)]).then(r => r.every(Boolean)), [imgAid, attAid], {timeout: 10000}).then(() => true, () => false);
    ok(got, "…and another browser gets them from it");
    await ctx2.close(); }

  console.log("a project file's markups checked");
  const bad = await T(() => { const p = {conds: [], items: [], scales: {}, viewports: {}, openings: [], files: [], sheets: {}, marks: [
    {id: "m1", type: "link", file: "f", page: 1, pts: [[0, 0], [10, 10]], link: {url: "javascript:alert(1)"}},
    {id: "m2", type: "text", file: "f", page: 1, pts: [[0, 0], [10, 10]], text: "x", color: "red; fill:url(evil)", fill: "#zzz", fs: 1e9, hatch: {p: "bogus"}},
    {id: "m3", type: "image", file: "f", page: 1, pts: [[0, 0], [10, 10]], img: {aid: "<script>", w: "x"}},
    {id: "m4", type: "polygon", file: "f", page: 1, pts: [[0, 0], [10, 10]]}]};
    zdTakeoff.migrate(p, []); return p.marks; });
  ok(bad.length === 3 && !bad.some(m => m.id === "m4"), "a polygon with only two points is left out");
  ok(bad.find(m => m.id === "m1").link.url == null, "a javascript: link is dropped");
  const t2 = bad.find(m => m.id === "m2"); ok(t2.color === "#d03b3b" && t2.fill == null && t2.fs === 500 && t2.hatch == null, "a bad colour, fill, size and hatch are cleaned");

  console.log("undo");
  { const n0 = (await marks()).length; await page.keyboard.press("Shift+R"); await dragAt(700, 650, 760, 700); const n1 = (await marks()).length; await page.keyboard.press("Escape"); await page.keyboard.press("Control+z"); await wait(150);
    ok(n1 === n0 + 1 && (await marks()).length === n0, "Ctrl+Z takes a markup back"); }

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

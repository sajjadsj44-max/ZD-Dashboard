#!/usr/bin/env node
/* Browser tests for the PDF Takeoff app (takeoff/): Export projects — every project with its PDFs in one .zdtakeoff file, saved
   where the user chooses (the browser's Save as…, else a download), and Import project opening that file on another computer
   (a second browser context here): the new projects are added, one already there is replaced only when ticked (its copy kept
   under Backups), the same one is left alone; a one-project .zdtakeoff still imports as before.

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_exportall.js

   TK_LIBS  folder holding pdfjs-dist and pdf-lib (CDN requests are answered from there; pdf-lib writes the second test PDF)
   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/) */
const path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const MAGIC = "ZDTAKEOFF-BUNDLE-1\n";
function readAll(buf){   // the file as exportAll writes it: magic, 4-byte length, header JSON, then the PDFs and pictures
  if (buf.slice(0, MAGIC.length).toString() !== MAGIC) throw new Error("not a .zdtakeoff");
  const hl = buf.readUInt32BE(MAGIC.length), h = JSON.parse(buf.slice(MAGIC.length + 4, MAGIC.length + 4 + hl).toString("utf8")), base = MAGIC.length + 4 + hl;
  return {h, base, part: e => buf.slice(base + e.off, base + e.off + e.size)};
}
async function secondPdf(){   // one page with a box: a second, different drawing
  const L = require(path.join(LIBS, "pdf-lib"));
  const d = await L.PDFDocument.create(), pg = d.addPage([842, 595]); pg.drawRectangle({x: 100, y: 100, width: 600, height: 400, borderWidth: 1, borderColor: L.rgb(0, 0, 0)});
  pg.drawText("SECOND", {x: 120, y: 520, size: 18});
  return Buffer.from(await d.save());
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs")) || !fs.existsSync(path.join(LIBS, "pdf-lib"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see the header"); process.exit(2); }
  const plan = makePdf(), second = await secondPdf();
  const browser = await pw.chromium.launch();
  const route = async ctx => { await require("./zd_unlock")(ctx); await ctx.route(/cdn\.jsdelivr\.net/, r => {   // the dashboard password typed in on every page opened; the CDN libraries from TK_LIBS
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort(); }); };
  const errors = [];
  const open = async () => {   // a browser context of its own (its own storage): one computer
    const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await route(ctx);
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
    await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
    return {ctx, page};
  };
  const helpers = page => {
    const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
    const home = async () => { await T(() => document.getElementById("bProjects").click()); await wait(400); };
    const newProj = async (name, buf, fname) => {
      await home();
      await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400);
      if (buf) { await page.setInputFiles("#fileIn", {name: fname, mimeType: "application/pdf", buffer: buf}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000}); await wait(500); }
      return T(() => zdTakeoff.P.proj.id);
    };
    const openProj = async id => { await home(); await page.click(`[data-open="${id}"]`); await page.waitForFunction(id => zdTakeoff.S.page && zdTakeoff.P.proj && zdTakeoff.P.proj.id === id, id, {timeout: 20000}).catch(() => {}); await wait(300); };
    const projects = () => T(() => new Promise(ok => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("projects").objectStore("projects").getAll(); g.onsuccess = () => { rq.result.close(); ok(g.result.map(p => ({id: p.id, name: p.name, files: p.files.map(f => f.id), items: p.items.length, updated: p.updated})).sort((a, b) => a.name.localeCompare(b.name))); }; }; }));
    const stored = k => T(k => new Promise(ok => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("pdfs").objectStore("pdfs").getKey(k); g.onsuccess = () => { rq.result.close(); ok(g.result !== undefined); }; }; }), k);
    const importRows = () => T(() => [...document.querySelectorAll("#dlgB tbody tr")].map(tr => ({name: tr.children[1].textContent, on: tr.querySelector("[data-xi]").checked, st: tr.querySelector("[data-xst]").dataset.xst, txt: tr.querySelector("[data-xst]").textContent})));
    const imported = async () => { await page.waitForFunction(() => /Projects imported/.test(document.getElementById("dlgT").textContent), null, {timeout: 30000}); await wait(300); return T(() => ({title: document.getElementById("dlgT").textContent, body: document.getElementById("dlgB").textContent})); };
    const closeDlg = async () => { await T(() => document.getElementById("dlgCancel").click()); await wait(150); };
    return {T, wait, home, newProj, openProj, projects, stored, importRows, imported, closeDlg};
  };

  console.log("laptop 1: three projects, one a duplicate sharing its drawing");
  const A = await open(), a = helpers(A.page);
  const p1 = await a.newProj("Block A", plan, "plan.pdf");
  await a.T(async () => { const pr = zdTakeoff.P.proj, fid = pr.files[0].id;   // a measurement and a markup picture
    pr.conds.push({id: "Cxa1", name: "Floor", type: "area", unit: "Sft", color: "#123456"});
    pr.items.push({id: "Ixa1", cond: "Cxa1", file: fid, page: 1, kind: "shape", pts: [[10, 10], [100, 10], [100, 100], [10, 100]], nos: 1, label: "slab"});
    await new Promise((ok, bad) => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const t = rq.result.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({asset: true, name: "pic.png", type: "image/png", size: 3, data: new Uint8Array([7, 8, 9]).buffer, at: new Date().toISOString()}, "asset:Axa1"); t.oncomplete = () => { rq.result.close(); ok(); }; t.onerror = () => bad(t.error); }; });
    pr.marks.push({id: "Mxa1", type: "image", file: fid, page: 1, pts: [[100, 100], [200, 160]], text: "pic.png", img: {aid: "Axa1", w: 100, h: 60, name: "pic.png"}});
    zdTakeoff.save(); await zdTakeoff.flushSave(); });
  const p2 = await a.newProj("Block B", second, "second.pdf");
  await a.T(async () => { const pr = zdTakeoff.P.proj; pr.conds.push({id: "Cxb1", name: "Wall", type: "linear", unit: "Rft", color: "#654321"}); pr.items.push({id: "Ixb1", cond: "Cxb1", file: pr.files[0].id, page: 1, kind: "shape", pts: [[10, 10], [300, 10]], nos: 1, label: ""}); zdTakeoff.save(); await zdTakeoff.flushSave(); });
  await a.home();
  await A.page.click(`[data-dup="${p1}"]`); await a.wait(500);   // Block A (copy): the same drawing id
  const PA = await a.projects();
  ok(PA.length === 3 && PA.find(p => p.name === "Block A (copy)").files[0] === PA.find(p => p.name === "Block A").files[0], "three projects; the copy shares Block A's drawing");

  console.log("Export projects: the dialog on the start screen");
  ok(await a.T(() => { const b = document.getElementById("bExportAll"); return !!b && b.textContent === "Export projects" && getComputedStyle(b).display !== "none"; }), "the start screen has an Export projects button beside Import project");
  await A.page.click("#bExportAll"); await a.wait(400);
  const D1 = await a.T(() => ({title: document.getElementById("dlgT").textContent, rows: [...document.querySelectorAll("#dlgB [data-xa]")].map(x => ({id: x.dataset.xa, on: x.checked})), sum: document.getElementById("xaSum").textContent, ok: document.getElementById("dlgOk").textContent, sizes: [...document.querySelectorAll("#dlgB tbody tr td:last-child")].map(x => x.textContent)}));
  ok(/Export projects/.test(D1.title) && D1.rows.length === 3 && D1.rows.every(r => r.on), "it lists the 3 projects, all ticked → " + D1.title);
  ok(/^3 projects, 2 PDFs — about [\d.]+ (KB|MB) in one file$/.test(D1.sum), "the sum counts the shared drawing once → " + D1.sum);
  ok(D1.sizes.every(s => /\d (KB|MB)$/.test(s)) && D1.ok === "Save file…", "each row shows its size; the button says Save file… → " + D1.sizes.join(" / "));
  await a.T(() => document.getElementById("xaNone").click());
  ok(await a.T(() => { document.getElementById("dlgOk").click(); return document.getElementById("dlgErr").textContent; }) === "Tick at least one project", "None + Save: asks to tick one");
  await a.T(() => document.getElementById("xaAll").click());
  ok(/^3 projects/.test(await a.T(() => document.getElementById("xaSum").textContent)), "All ticks them again");

  console.log("saved where the user chooses (the browser's Save as…), else as a download");
  const PK = await a.T(async () => {   // a stand-in for the browser's Save as… question: records what was asked, takes the bytes
    const w = window; w.__pk = {asked: null, size: 0, closed: false};
    w.showSaveFilePicker = o => { w.__pk.asked = o; return Promise.resolve({name: "chosen.zdtakeoff", createWritable: async () => ({write: async b => { w.__pk.size = b.size; }, close: async () => { w.__pk.closed = true; }})}); };
    const p = new Promise(ok => { const t0 = Date.now(), iv = setInterval(() => { if (w.__pk.closed || Date.now() - t0 > 20000) { clearInterval(iv); ok(); } }, 50); });
    document.getElementById("dlgOk").click(); await p; await new Promise(r => setTimeout(r, 300));
    return {asked: w.__pk.asked, size: w.__pk.size, closed: w.__pk.closed, toast: document.getElementById("toast").textContent, dlg: document.getElementById("dlgBack").classList.contains("on")}; });
  ok(PK.asked && /^ZD_Takeoff_projects_\d{4}-\d\d-\d\d\.zdtakeoff$/.test(PK.asked.suggestedName) && PK.asked.types[0].accept["application/octet-stream"][0] === ".zdtakeoff", "Save file… asks the browser where to save, suggesting ZD_Takeoff_projects_<date>.zdtakeoff → " + JSON.stringify(PK.asked));
  ok(PK.closed && PK.size > 1000 && !PK.dlg, "the file is written where chosen (" + PK.size + " bytes) and the dialog closed");
  ok(/^3 projects with 2 PDFs and 1 markup picture saved in one file — chosen\.zdtakeoff — open it on the other computer with Import project$/.test(PK.toast), "the toast says what was saved and where → " + PK.toast);
  const BL = await a.T(async () => (await zdTakeoff.exportAll(null, {blob: true})).size);
  ok(BL === PK.size, "the same bytes as exportAll(null, {blob: true}) gives (" + BL + ")");
  await A.page.click("#bExportAll"); await a.wait(300);
  const CN = await a.T(async () => { window.showSaveFilePicker = () => Promise.reject(Object.assign(new Error("closed"), {name: "AbortError"})); document.getElementById("toast").textContent = ""; document.getElementById("dlgOk").click(); await new Promise(r => setTimeout(r, 500)); return {toast: document.getElementById("toast").textContent, busy: document.getElementById("busy").style.display}; });
  ok(!/saved/.test(CN.toast) && CN.busy !== "block", "closing the Save as… question saves nothing");
  await A.page.click("#bExportAll"); await a.wait(300);
  await a.T(() => { window.showSaveFilePicker = undefined; });
  const [dl] = await Promise.all([A.page.waitForEvent("download", {timeout: 20000}), A.page.click("#dlgOk")]);
  const dlPath = path.join(os.tmpdir(), "zd-exportall-" + process.pid + ".zdtakeoff"); await dl.saveAs(dlPath);
  const file = fs.readFileSync(dlPath);
  ok(/^ZD_Takeoff_projects_\d{4}-\d\d-\d\d\.zdtakeoff$/.test(dl.suggestedFilename()) && file.length === BL, "without Save as… (Firefox) it is a download of the same size → " + dl.suggestedFilename());

  console.log("the file");
  const F = readAll(file);
  ok(F.h.format === "zd-takeoff-all" && F.h.count === 3 && F.h.projects.length === 3 && F.h.projects.every(p => p.format === "zd-takeoff" && Array.isArray(p.items)), "header: format zd-takeoff-all, the 3 projects as takeoff files");
  ok(F.h.pdfs.length === 2 && F.h.assets.length === 1, "2 PDFs (the shared drawing once) and 1 markup picture");
  const fp = F.h.pdfs.find(p => p.name === "plan.pdf"), fs2 = F.h.pdfs.find(p => p.name === "second.pdf");
  ok(fp && sha(F.part(fp)) === fp.sha && fp.sha === sha(plan) && fs2 && sha(F.part(fs2)) === fs2.sha && fs2.sha === sha(second), "the PDFs' bytes are the drawings added, fingerprints right");
  ok(JSON.stringify([...F.part(F.h.assets[0])]) === "[7,8,9]" && F.h.assets[0].aid === "Axa1", "the picture's bytes too");
  const one = await a.T(async id => { const b = await zdTakeoff.exportAll([id], {blob: true}), u = new Uint8Array(await b.arrayBuffer()), hl = new DataView(u.buffer).getUint32(19); return JSON.parse(new TextDecoder().decode(u.slice(23, 23 + hl))); }, p2);
  ok(one.count === 1 && one.projects[0].name === "Block B" && one.pdfs.length === 1 && one.pdfs[0].name === "second.pdf", "exportAll([one id]) packs that project only");

  console.log("laptop 2: Import project opens the file — all projects there");
  const B = await open(), b = helpers(B.page);
  ok((await b.projects()).length === 0, "a fresh browser: no projects");
  ok(await b.T(() => zdTakeoff.paletteCmds().some(c => /^Export projects \(\.zdtakeoff\)/.test(c.t))), "the command palette offers Export projects while no project is open");
  await B.page.setInputFiles("#impIn", {name: "ZD_Takeoff_projects.zdtakeoff", mimeType: "application/octet-stream", buffer: file}); await b.wait(600);
  const I1 = await b.importRows(), I1t = await b.T(() => document.getElementById("dlgT").textContent + " | " + document.getElementById("dlgOk").textContent);
  ok(I1t === "Import 3 projects | Import" && I1.length === 3 && I1.every(r => r.on && r.st === "new" && /new — added/.test(r.txt)), "Import project lists the 3 projects, all new and ticked → " + I1t);
  await B.page.click("#dlgOk");
  const R1 = await b.imported();
  const L1 = await b.T(() => ({start: document.getElementById("start").classList.contains("on"), listed: [...document.querySelectorAll("#projList .plink")].map(x => x.textContent).sort()}));
  ok(R1.title === "Projects imported — PASS" && /3 added/.test(R1.body), "the result says 3 added, PASS → " + R1.title);
  ok(L1.start && JSON.stringify(L1.listed) === JSON.stringify(["Block A", "Block A (copy)", "Block B"]), "the start screen behind it lists all three → " + L1.listed.join(", "));
  const PB = await b.projects();
  ok(JSON.stringify(PB.map(p => [p.id, p.name, p.items, p.updated])) === JSON.stringify(PA.map(p => [p.id, p.name, p.items, p.updated])), "the projects keep their ids, names, measurements and last-changed times");
  ok(await b.stored(PA[0].files[0]) && await b.stored(PA.find(p => p.name === "Block B").files[0]) && await b.stored("asset:Axa1"), "their drawings and the picture are stored");
  await b.closeDlg();
  await b.openProj(p2);
  ok(await b.T(() => !!(zdTakeoff.S.page && zdTakeoff.P.proj.name === "Block B" && zdTakeoff.P.proj.items.length === 1 && zdTakeoff.S.docs[zdTakeoff.S.fileId])), "Block B opens on its drawing with its measurement — no + PDF needed");

  console.log("the same file again: nothing is doubled; a project here is replaced only when ticked");
  await b.home();
  await B.page.setInputFiles("#impIn", {name: "ZD_Takeoff_projects.zdtakeoff", mimeType: "application/octet-stream", buffer: file}); await b.wait(600);
  const I2 = await b.importRows();
  ok(I2.length === 3 && I2.every(r => !r.on && (r.st === "same" || r.st === "newer")) && I2.filter(r => r.st === "same").length >= 2, "every project is here already (the same, or newer where it was opened) — none ticked → " + I2.map(r => r.name + ": " + r.st).join(", "));
  ok(await b.T(() => { document.getElementById("dlgOk").click(); return document.getElementById("dlgErr").textContent; }) === "Tick at least one project", "Import with none ticked asks to tick one");
  const rowSame = I2.findIndex(r => r.st === "same");
  await b.T(i => { document.querySelectorAll("#dlgB [data-xi]")[i].checked = true; document.getElementById("dlgOk").click(); }, rowSame);
  const R2 = await b.imported();
  ok(/0 added, 1 replaced/.test(R2.body) && (await b.projects()).length === 3, "one ticked: replaced, not doubled → still 3 projects");
  ok((await b.T(id => zdTakeoff.backupsOf(id), PB.find(p => p.name === I2[rowSame].name).id)).some(x => x.why === "before Import project replaced it"), "…its copy here went under Backups first");
  await b.closeDlg();

  console.log("back to laptop 1: a project changed on laptop 2 replaces the older copy there, the older copy kept under Backups");
  await b.openProj(p1);
  await b.T(async () => { const pr = zdTakeoff.P.proj; pr.name = "Block A — revised"; pr.items.push({id: "Ixa2", cond: "Cxa1", file: pr.files[0].id, page: 1, kind: "shape", pts: [[200, 200], [300, 200], [300, 300]], nos: 1, label: "new"}); zdTakeoff.save(); await zdTakeoff.flushSave(); });
  const file2 = Buffer.from(await b.T(async () => [...new Uint8Array(await (await zdTakeoff.exportAll(null, {blob: true})).arrayBuffer())]));
  await a.home();
  await A.page.setInputFiles("#impIn", {name: "ZD_Takeoff_projects.zdtakeoff", mimeType: "application/octet-stream", buffer: file2}); await a.wait(600);
  const I3 = await a.importRows(), rv = I3.find(r => r.name === "Block A — revised"), cp = I3.find(r => r.name === "Block A (copy)");
  ok(rv && rv.on && rv.st === "older" && /older copy — replaced/.test(rv.txt) && cp && !cp.on && cp.st === "same", "the revised project is 'here, an older copy — replaced', ticked; the untouched copy the same, unticked → " + I3.map(r => r.name + ": " + r.st).join(", "));
  await A.page.click("#dlgOk");
  await a.imported();
  const PA2 = await a.projects(), bk = await a.T(id => zdTakeoff.backupsOf(id), p1);
  ok(PA2.length === 3 && PA2.find(p => p.id === p1).name === "Block A — revised" && PA2.find(p => p.id === p1).items === 2, "laptop 1 now has the revised project (2 measurements), still 3 projects");
  ok(bk.some(x => x.why === "before Import project replaced it" && x.name === "Block A"), "…and its earlier copy under Backups → " + bk.map(x => x.why).join(" | "));
  await a.closeDlg();

  console.log("where it is offered, and what a single-project file still does");
  await a.openProj(p2);
  ok(await a.T(() => zdTakeoff.paletteCmds().some(c => /^All projects \+ PDFs/.test(c.t))), "the command palette offers All projects + PDFs with a project open");
  await A.page.click("#bExport"); await a.wait(300);
  ok(await a.T(() => { const b = document.getElementById("exAll"); const t = b && b.textContent; document.getElementById("dlgCancel").click(); return t; }) === "All projects + PDFs", "Export has an All projects + PDFs button");
  const MG = await a.T(async b64 => { try { await zdTakeoff.mergeBuf(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer); return ""; } catch (e) { return e.message; } }, file.toString("base64"));
  ok(/holds 3 projects — open it with Import project/.test(MG), "Import measurements into this project refuses the file with a clear message → " + MG);
  const sg = await a.T(async () => { const pr = JSON.parse(JSON.stringify(zdTakeoff.P.proj)); pr.name = "Single";
    const head = new TextEncoder().encode(JSON.stringify({format: "zd-takeoff-bundle", exported: new Date().toISOString(), project: Object.assign({format: "zd-takeoff"}, pr), pdfs: [], assets: []})), len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
    const r = await zdTakeoff.importBundle(await new Blob(["ZDTAKEOFF-BUNDLE-1\n", len, head]).arrayBuffer()); const t = document.getElementById("dlgT").textContent; document.getElementById("dlgCancel").click(); return {lvl: r.lvl, title: t, name: zdTakeoff.P.proj.name, all: !!r.all}; });
  ok(sg.name === "Single" && !sg.all && /Project Import Validation/.test(sg.title), "a one-project .zdtakeoff still imports as before → " + JSON.stringify(sg));

  ok(!errors.length, "no page errors" + (errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close(); try { fs.unlinkSync(dlPath); } catch (e) {}
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Browser tests for the PDF Takeoff app (takeoff/): the platform around the takeoff — times shown in local time, a deleted
   project's drawings kept 30 days in a trash (Recover brings it back whole, start-up empties what is older), the new-version
   bar, Bluebeam markups of a big PDF read with pdf.js, and Import measurements into this project (merge).

     python3 -m http.server 8765 &                     # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_platform.js

   TK_LIBS  folder holding pdfjs-dist, exceljs and pdf-lib (CDN requests are answered from there; pdf-lib also writes the test PDFs)
   TK_URL   page to test (default http://127.0.0.1:8765/takeoff/)

   The browser runs in Asia/Karachi (UTC+5), so a time shown in UTC can never pass for local time. */
const path = require("path"), fs = require("fs"), crypto = require("crypto");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const sha = b => crypto.createHash("sha256").update(b).digest("hex");

async function makeMarkupPdf(measured){   // one page of Bluebeam-style markups: plain ones only, or with one area measurement too
  const L = require(path.join(LIBS, "pdf-lib"));
  const d = await L.PDFDocument.create(), ctx = d.context, S = t => L.PDFString.of(t);
  const pg = d.addPage([842, 595]); pg.drawRectangle({x: 60, y: 60, width: 720, height: 470, borderWidth: 0.8, borderColor: L.rgb(0, 0, 0)});
  const annot = o => { const a = {Type: "Annot", F: 4}; Object.entries(o).forEach(([k, v]) => { a[k] = ["Subj", "Contents", "NM", "T", "DS", "DA"].includes(k) ? S(v) : v; });
    const ref = ctx.register(ctx.obj(a)); let an = pg.node.lookup(L.PDFName.of("Annots")); if (!an) { an = ctx.obj([]); pg.node.set(L.PDFName.of("Annots"), an); } an.push(ref); };
  annot({Subtype: "FreeText", Subj: "Note", C: [1, 1, 0.5], DA: "/Helv 12 Tf 1 0 0 rg", Contents: "Check this wall", Rect: [500, 450, 700, 520], NM: "FT1", T: "QS"});
  annot({Subtype: "Square", Subj: "Rectangle", C: [0, 0.5, 0], BS: ctx.obj({W: 2, S: "S"}), Rect: [600, 100, 700, 180], NM: "SQ1"});
  annot({Subtype: "Ink", Subj: "Pen", C: [0, 0, 1], BS: ctx.obj({W: 1.5, S: "S"}), InkList: [[100, 100, 150, 130, 200, 110]], Rect: [95, 95, 205, 135], NM: "INK1"});
  annot({Subtype: "Polygon", Subj: "Cloud", C: [1, 0, 0], Vertices: [300, 300, 360, 300, 360, 340, 300, 340], Rect: [295, 295, 365, 345], NM: "PG1"});
  if (measured) {
    const meas = ctx.obj({Type: "Measure", Subtype: "RL", R: S("1/8 in = 1 ft"), X: [ctx.obj({Type: "NumberFormat", U: S("ft"), C: 1 / 9, D: 2})], A: [ctx.obj({Type: "NumberFormat", U: S("sf"), C: 1})]});
    annot({Subtype: "Polygon", IT: "PolygonDimension", Subj: "Floor tile", C: [0, 0, 1], IC: [1, 1, 0.5], Vertices: [100, 300, 190, 300, 190, 345, 100, 345], Measure: meas, Contents: "50.00 sf", NM: "AREA1", Rect: [95, 295, 195, 350]});
  }
  return Buffer.from(await d.save());
}
function bundleOf(project, pdfs){   // a .zdtakeoff as exportBundle writes it: magic, 4-byte length, header JSON, then the PDFs
  let off = 0; const E = pdfs.map(p => { const e = {id: p.id, name: p.name, size: p.buf.length, sha: sha(p.buf), off}; off += p.buf.length; return e; });
  const head = Buffer.from(JSON.stringify({format: "zd-takeoff-bundle", exported: new Date().toISOString(), project: Object.assign({format: "zd-takeoff"}, project), pdfs: E, assets: []}), "utf8");
  const len = Buffer.alloc(4); len.writeUInt32BE(head.length);
  return Buffer.concat([Buffer.from("ZDTAKEOFF-BUNDLE-1\n"), len, head, ...pdfs.map(p => p.buf)]);
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs")) || !fs.existsSync(path.join(LIBS, "pdf-lib"))) { console.log("TK_LIBS must hold pdfjs-dist and pdf-lib — see the header"); process.exit(2); }
  const plan = makePdf(), plainPdf = await makeMarkupPdf(false), measPdf = await makeMarkupPdf(true);
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, timezoneId: "Asia/Karachi"}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const toastTxt = () => T(() => document.getElementById("toast").textContent);
  const idb = (fn, a) => T(([src, a]) => new Promise((ok, bad) => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const db = rq.result; Promise.resolve(new Function("db", "a", src)(db, a)).then(v => { db.close(); ok(v); }, e => { db.close(); bad(e); }); }; rq.onerror = () => bad(rq.error); }), [fn, a]);
  const rec = k => idb(`return new Promise(ok => { const r = db.transaction("pdfs").objectStore("pdfs").get(a); r.onsuccess = () => { const v = r.result; ok(v ? {trashed: v.trashed || null, pid: v.pid || null, trash: !!v.trash, at: v.at || null, files: v.files || null, aids: v.aids || null} : null); }; });`, k);
  const newProj = async (name, buf, fname) => {
    await T(() => document.getElementById("bProjects").click()); await wait(300);
    await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400);
    if (buf) { await page.setInputFiles("#fileIn", {name: fname, mimeType: "application/pdf", buffer: buf}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000}); await wait(500); }
  };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);

  console.log("times in local time");
  await newProj("Local time", plan, "plan.pdf");
  await T(async () => { zdTakeoff.save(); await zdTakeoff.flushSave(); await zdTakeoff.backupNow("test"); });
  const bak = await T(async () => { const b = (await zdTakeoff.backupsOf(zdTakeoff.P.proj.id))[0]; await zdTakeoff.backupsDialog(); return {at: b.at, cell: document.querySelector("#dlgB tbody tr td").textContent}; });
  { const d = new Date(bak.at), z = n => String(n).padStart(2, "0"), hm = z((d.getUTCHours() + 5) % 24) + ":" + z(d.getUTCMinutes());
    ok(bak.cell.endsWith(" " + hm) && !bak.cell.endsWith(" " + bak.at.slice(11, 16)), "Backups: the time is local (" + bak.cell + "; UTC " + bak.at.slice(11, 16) + ")"); }
  await T(() => document.getElementById("dlgCancel").click()); await wait(150);

  console.log("delete → trash → recover whole");
  const P1 = await T(async () => {   // a markup picture in the store, and one whose picture is not in this browser
    const pr = zdTakeoff.P.proj, fid = pr.files[0].id;
    await new Promise((ok, bad) => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const t = rq.result.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({asset: true, name: "pic.png", type: "image/png", size: 3, data: new Uint8Array([1, 2, 3]).buffer, at: new Date().toISOString()}, "asset:Atrash1"); t.oncomplete = () => { rq.result.close(); ok(); }; t.onerror = () => bad(t.error); }; });
    pr.marks.push({id: "Mpic1", type: "image", file: fid, page: 1, pts: [[100, 100], [200, 160]], text: "pic.png", img: {aid: "Atrash1", w: 100, h: 60, name: "pic.png"}});
    pr.marks.push({id: "Mpic2", type: "image", file: fid, page: 1, pts: [[300, 100], [400, 160]], text: "gone.png", img: {aid: "Agone99", w: 100, h: 60, name: "gone.png"}});
    zdTakeoff.save(); await zdTakeoff.flushSave(); await zdTakeoff.backupNow("with pictures");
    return {pid: pr.id, fid, name: pr.name};
  });
  await T(() => document.getElementById("bProjects").click()); await wait(400);
  await page.click(`[data-del="${P1.pid}"]`); await wait(200);
  const delTxt = await T(() => document.getElementById("dlgB").textContent);
  ok(/kept for 30 days so Recover can bring it back whole/.test(delTxt), "the delete question says the drawings are kept 30 days");
  await page.click("#dlgOk"); await wait(600);
  { const r = await rec(P1.fid), a = await rec("asset:Atrash1"), t = await rec("trash:" + P1.pid), gone = !(await T(pid => zdTakeoff.orphanBackups().then(G => !G.some(g => g[0].pid === pid)), P1.pid));
    ok(gone, "the project is gone (its backups are left)");
    ok(r && r.trashed && r.pid === P1.pid, "its PDF is still stored, marked trashed for the project → " + JSON.stringify(r));
    ok(a && a.trashed && a.pid === P1.pid, "its markup picture too");
    ok(t && t.trash && t.files.includes(P1.fid) && t.aids.includes("Atrash1"), "one trash:<pid> record lists them"); }
  await T(() => zdTakeoff.recoverDialog()); await wait(300);
  const dbl = await T(() => { const b = document.querySelector("#dlgB [data-recov]"); b.click(); const dis = b.disabled && document.querySelector("#dlgB [data-drop]").disabled; b.click(); return dis; });
  ok(dbl, "Restore: both buttons held while it runs");
  await page.waitForFunction(pid => zdTakeoff.P.proj && zdTakeoff.P.proj.id === pid && zdTakeoff.S.page, P1.pid, {timeout: 15000}).catch(() => {});
  await wait(400);
  const rt = await toastTxt();
  ok((await idb(`return new Promise(ok => { const g = db.transaction("projects").objectStore("projects").getAll(); g.onsuccess = () => ok(g.result.filter(p => p.name === a).length); });`, P1.name)) === 1, "a double click restores one project, not two");
  ok(await T(() => !!(zdTakeoff.S.page && zdTakeoff.S.docs[zdTakeoff.S.fileId])), "the recovered project opens with its drawing — no + PDF needed");
  ok(/with its drawing/.test(rt) && /1 markup picture \/ file is missing/.test(rt), "the toast says the drawing came back and 1 markup picture is missing → " + rt);
  ok(!(await rec(P1.fid)).trashed && !(await rec("asset:Atrash1")).trashed, "the drawing and picture are out of the trash");

  console.log("the trash emptied after 30 days");
  await T(() => document.getElementById("bProjects").click()); await wait(400);
  await page.click(`[data-del="${P1.pid}"]`); await wait(200); await page.click("#dlgOk"); await wait(600);
  await idb(`return new Promise(ok => { const t = db.transaction(["pdfs", "projects"], "readwrite"), s = t.objectStore("pdfs"), g = s.get(a.k), old = new Date(Date.now() - 31 * 864e5).toISOString(); g.onsuccess = () => { const v = g.result; v.at = old; s.put(v, a.k); };
    [a.fid, "asset:Atrash1"].forEach(k => { const r = s.get(k); r.onsuccess = () => { const v = r.result; if (v && v.trashed) { v.trashed = old; s.put(v, k); } }; });   // (each record's own date counts)
    t.objectStore("projects").put({id: "Pholder", name: "Holder", created: a.now, updated: a.now, v: 2, files: [{id: a.fid, name: "plan.pdf", pages: 3}], scales: {}, conds: [], items: [], last: {}, viewports: {}, marks: [], sheets: {}, openings: []}); t.oncomplete = () => ok(); });`, {k: "trash:" + P1.pid, fid: P1.fid, now: new Date().toISOString()});
  const n1 = await T(() => zdTakeoff.trashPurge());
  { const t = await rec("trash:" + P1.pid);
    ok(n1 === 1 && !(await rec("asset:Atrash1")) && t && JSON.stringify(t.files) === JSON.stringify([P1.fid]) && !t.aids.length, "start-up purge: the 31-day-old picture is taken out (" + n1 + "); the trash record keeps only the PDF another project uses again → " + JSON.stringify(t)); }
  ok(!!(await rec(P1.fid)), "…but not the PDF another project uses again");
  await idb(`return new Promise(ok => { const t = db.transaction("projects", "readwrite"); t.objectStore("projects").delete("Pholder"); t.oncomplete = () => ok(); });`);
  await T(([pid, fid]) => zdTakeoff.trashProject({id: pid, name: "again", files: [{id: fid}], marks: []}), [P1.pid, P1.fid]);
  ok((await T(() => zdTakeoff.TRASH_DAYS)) === 30 && (await rec(P1.fid)).trashed && (await rec("trash:" + P1.pid)), "the PDF in the trash again (a fresh entry)");
  ok((await T(() => zdTakeoff.trashPurge())) === 0 && !!(await rec(P1.fid)), "…and a purge leaves it alone");
  ok((await T(pid => zdTakeoff.trashPurge([pid]), P1.pid)) === 1 && !(await rec(P1.fid)), "Delete backups empties that project's trash at once");

  console.log("a drawing trashed again under another project");
  const putRec = k => idb(`return new Promise(ok => { const t = db.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({name: a + ".pdf", size: 4, data: new Uint8Array([1, 2, 3, 4]).buffer}, a); t.oncomplete = () => ok(); });`, k);
  const old31 = (k, f) => idb(`return new Promise(ok => { const t = db.transaction("pdfs", "readwrite"), s = t.objectStore("pdfs"), g = s.get(a.k); g.onsuccess = () => { const v = g.result; v[a.f] = new Date(Date.now() - 31 * 864e5).toISOString(); s.put(v, a.k); }; t.oncomplete = () => ok(); });`, {k, f});
  await putRec("Fre");
  await T(() => zdTakeoff.trashProject({id: "Pold", name: "old", files: [{id: "Fre"}], marks: []}));
  await old31("trash:Pold", "at"); await old31("Fre", "trashed");
  await T(() => zdTakeoff.trashProject({id: "Pnew", name: "new", files: [{id: "Fre"}], marks: []}));
  { const r = await rec("Fre"), o = await rec("trash:Pold"), n = await rec("trash:Pnew");
    ok(r && r.pid === "Pnew" && Date.now() - Date.parse(r.trashed) < 60000 && !o && n && n.files.includes("Fre"), "trashed again: the record is the new project's (30 days from now) and off the old project's list"); }
  await idb(`return new Promise(ok => { const t = db.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({trash: true, pid: "Pold", name: "old", at: new Date(Date.now() - 40 * 864e5).toISOString(), files: ["Fre"], aids: []}, "trash:Pold"); t.oncomplete = () => ok(); });`);   // a stale old list still naming it
  ok((await T(() => zdTakeoff.trashPurge())) === 0 && !!(await rec("Fre")) && !(await rec("trash:Pold")), "start-up purge: the old project's 40-day-old list goes, the drawing now in the new project's trash stays");
  await idb(`return new Promise(ok => { const t = db.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({trash: true, pid: "Pold", name: "old", at: new Date().toISOString(), files: ["Fre"], aids: []}, "trash:Pold"); t.oncomplete = () => ok(); });`);
  ok((await T(() => zdTakeoff.trashPurge(["Pold"]))) === 0 && !!(await rec("Fre")), "Delete backups of the old project: the drawing in the other project's trash stays");
  await old31("Fre", "trashed");
  ok((await T(() => zdTakeoff.trashPurge())) === 1 && !(await rec("Fre")) && !(await rec("trash:Pnew")), "31 days in the new project's trash: taken out with its list");
  await putRec("Fbk"); await T(() => zdTakeoff.trashProject({id: "Pbk", name: "bk", files: [{id: "Fbk"}], marks: []}));
  await T(() => zdTakeoff.trashBack({id: "Pbk", files: [{id: "Fbk"}], marks: []}));
  ok(!(await rec("Fbk")).trashed && !(await rec("trash:Pbk")), "Recover: the drawing out of the trash and its trash list gone");
  await newProj("Remove a PDF in a trash", plan, "plan.pdf");
  { const fid = await T(() => zdTakeoff.P.proj.files[0].id);
    await idb(`return new Promise(ok => { const t = db.transaction("pdfs", "readwrite"); t.objectStore("pdfs").put({trash: true, pid: "Pgone", name: "gone", at: new Date().toISOString(), files: [a], aids: []}, "trash:Pgone"); t.oncomplete = () => ok(); });`, fid);
    const rm = T(f => zdTakeoff.removePdf(f), fid); await wait(300); await page.click("#dlgOk"); await rm; await wait(300);
    const r = await rec(fid);
    ok((await T(() => zdTakeoff.P.proj.files.length)) === 0 && r && r.trashed && r.pid === "Pgone", "Remove PDF: a drawing a deleted project in the trash still lists is put in that trash, not deleted → " + JSON.stringify(r)); }

  console.log("recover dialog: local time");
  { const c = await T(async () => { await zdTakeoff.recoverDialog(); const td = document.querySelectorAll("#dlgB tbody tr td")[1]; return td ? td.textContent : ""; });
    const at = await T(pid => zdTakeoff.orphanBackups().then(G => (G.find(g => g[0].pid === pid) || [{}])[0].at), P1.pid);
    const d = new Date(at), z = n => String(n).padStart(2, "0");
    ok(c.endsWith(" " + z((d.getUTCHours() + 5) % 24) + ":" + z(d.getUTCMinutes())), "Recover: the last backup's time is local (" + c + ")");
    await T(() => document.getElementById("dlgCancel").click()); await wait(150); }

  console.log("a new version");
  ok(/searchParams\.has\("check"\)/.test(fs.readFileSync(path.join(__dirname, "../takeoff/sw.js"), "utf8")), "sw.js lets the version check through to the network (never cached)");
  ok((await T(() => zdTakeoff.APP_V)) && (await T(() => zdTakeoff.verCheck(true))) === "", "the running takeoff.js is the one index.html names: no bar");
  await page.route(/index\.html\?check=/, r => r.fulfill({contentType: "text/html", body: '<!doctype html><html><body><script type="module" src="takeoff.js?v=2099-01-01z"></script></body></html>'}));
  ok((await T(() => zdTakeoff.verCheck(true))) === "2099-01-01z" && /A new version of PDF Takeoff is ready/.test(await T(() => (document.getElementById("verBar") || {}).textContent || "")), "a newer takeoff.js?v= in index.html: the bar says a new version is ready");
  await newProj("Version check", null); await T(() => { zdTakeoff.P.proj.name = "Saved before reload"; zdTakeoff.save(); });
  await T(() => { const p = IDBObjectStore.prototype.put; window.__put = p; IDBObjectStore.prototype.put = function(){ if (this.name === "projects") throw new DOMException("disk full (test)", "QuotaExceededError"); return p.apply(this, arguments); }; zdTakeoff.save(); });
  { let nav = false; const on = f => { if (f === page.mainFrame()) nav = true; }; page.on("framenavigated", on);
    await page.click("#verGo"); await wait(1500); page.off("framenavigated", on);
    ok(!nav && /Not saved — export a copy first/.test(await toastTxt()) && !(await T(() => document.getElementById("verGo").disabled)), "a save that fails: Reload does not reload, says so, and can be pressed again → " + (await toastTxt()).slice(0, 90)); }
  await T(() => { IDBObjectStore.prototype.put = window.__put; });
  await Promise.all([page.waitForNavigation({waitUntil: "load", timeout: 15000}), page.click("#verGo")]);
  await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.P.proj, null, {timeout: 20000}); await wait(400);
  ok((await T(() => zdTakeoff.P.proj.name)) === "Saved before reload", "Reload saves the open project first, then reloads");
  await page.unroute(/index\.html\?check=/);

  console.log("Bluebeam markups of a big PDF");
  await T(() => { zdTakeoff.S.bbBig = 1; });   // every PDF counts as big
  await newProj("BB big plain", plainPdf, "plain-markups.pdf");
  await page.waitForFunction(() => (zdTakeoff.P.proj.marks || []).length >= 4, null, {timeout: 15000}).catch(() => {});
  const big = await T(async () => { const f = zdTakeoff.P.proj.files[0].id, r = await zdTakeoff.bbRead(f); return {via: r.via, n: r.n, kinds: Object.values(r.pages).flat().map(a => a.kind).sort(), marks: zdTakeoff.P.proj.marks.map(m => m.type).sort(), rects: Object.values(r.pages).flat().map(a => a.rect), busy: getComputedStyle(document.getElementById("busy")).display}; });
  ok(big.via === "pdfjs" && big.n === 4, "plain markups only: read with pdf.js, no pdf-lib parse → " + big.via + ", " + big.n);
  ok(JSON.stringify(big.marks) === JSON.stringify(["box", "pen", "polygon", "text"]), "…and brought in as markups: " + big.marks.join(", "));
  ok(big.busy === "none", "the busy line is cleared afterwards");
  const small = await T(async () => { const Z = zdTakeoff, f = Z.P.proj.files[0].id; Z.S.bbBig = 0; delete Z.S.bbRd[f]; const r = await Z.bbRead(f); Z.S.bbBig = 1; return {via: r.via, n: r.n, kinds: Object.values(r.pages).flat().map(a => a.kind).sort(), rects: Object.values(r.pages).flat().map(a => a.rect)}; });
  ok(small.via === "pdflib" && small.n === big.n && JSON.stringify(small.kinds) === JSON.stringify(big.kinds), "the same PDF as a small file: pdf-lib, the same markups (" + small.kinds.join(", ") + ")");
  ok(big.rects.every((r, i) => r && small.rects[i] && r.every((v, k) => Math.abs(v - small.rects[i][k]) < 0.01)), "…in the same places");
  await newProj("BB big measured", measPdf, "measured.pdf");
  await page.waitForFunction(() => zdTakeoff.P.proj.items.length >= 1, null, {timeout: 15000}).catch(() => {});
  const bm = await T(async () => { const Z = zdTakeoff, f = Z.P.proj.files[0].id, r = await Z.bbRead(f), c = Z.P.proj.conds.find(x => x.name === "Floor tile"); return {via: r.via, n: r.n, net: c ? Z.condTotals(c).net : null}; });
  ok(bm.via === "pdflib" && bm.n === 5 && Math.abs(bm.net - 50) < 0.01, "with a measurement (/Measure only pdf-lib reads): pdf-lib, Floor tile 50 Sft → " + JSON.stringify(bm));
  await T(() => { zdTakeoff.S.bbBig = 0; document.getElementById("dlgCancel") && document.getElementById("dlgBack").classList.contains("on") && document.getElementById("dlgCancel").click(); });

  console.log("Import measurements into this project");
  await newProj("Merge target", plan, "plan.pdf");
  const A = await T(() => { const Z = zdTakeoff, pr = Z.P.proj, f = pr.files[0].id;
    pr.conds.push({id: "Cmine", name: "Floor tile", type: "area", unit: "Sft", color: "#3366cc", h: "", t: "", faces: 1, dedMin: 0});
    pr.items.push({id: "Imine", cond: "Cmine", file: f, page: 1, kind: "shape", pts: [[100, 100], [190, 100], [190, 145], [100, 145]], nos: 1, label: ""});
    pr.scales[f + ":1"] = {ptPerFt: 9, how: "calibrated", text: "mine", factor: 1, verified: true, at: new Date().toISOString()};
    pr.openings.push({id: "Omine", mark: "D1", w: 3, h: 7}); Z.save(); return {fid: f, sha: pr.files[0].sha}; });
  ok(A.sha === sha(plan), "the open project's drawing has its fingerprint");
  const other = {name: "Other", v: 2, files: [{id: "Fs1", name: "plan-copy.pdf", sha: sha(plan), pages: 3}, {id: "Fs2", name: "elsewhere.pdf", sha: "0".repeat(64), pages: 1}],
    conds: [{id: "Cs1", name: " floor TILE ", type: "area", unit: "Sft", color: "#ff0000"}, {id: "Cs2", name: "Skirting", type: "linear", unit: "ft", color: "#00aa00"}, {id: "Cs3", name: "Floor tile", type: "linear", unit: "ft", color: "#aa00aa"}],
    items: [{id: "Is1", cond: "Cs1", file: "Fs1", page: 1, kind: "shape", pts: [[100.004, 100], [190, 100.006], [190, 145], [100, 145]], nos: 1, label: ""},
      {id: "Is2", cond: "Cs1", file: "Fs1", page: 1, kind: "shape", pts: [[300, 300], [345, 300], [345, 345], [300, 345]], nos: 1, label: "new room"},
      {id: "Is3", cond: "Cs2", file: "Fs2", page: 1, kind: "shape", pts: [[10, 10], [100, 10]], nos: 1, label: ""},
      {id: "Is4", cond: "Cs3", file: "Fs1", page: 2, kind: "shape", pts: [[10, 10], [100, 10]], nos: 1, label: ""},
      {id: "Is5", cond: "Cnone", file: "Fs1", page: 1, kind: "shape", pts: [[1, 1], [2, 2], [1, 2]], nos: 1, label: ""}],
    scales: {"Fs1:1": {ptPerFt: 4.5, how: "note"}, "Fs1:2": {ptPerFt: 4.32, how: "note"}, "Fs2:1": {ptPerFt: 9, how: "note"}},
    viewports: {"Fs1:3": [{id: "V1", name: "Detail", r: [0, 0, 100, 100], ptPerFt: 18}]},
    marks: [{id: "Ms1", type: "note", file: "Fs1", page: 1, pts: [[400, 400]], text: "from the other takeoff", layer: "Ls1"}],
    mkLayers: [{id: "Ls1", name: "Review"}],
    sheets: {"Fs1:1": {no: "A-101", title: "Ground floor"}}, openings: [{id: "Os1", mark: "d1", w: 3, h: 7}, {id: "Os2", mark: "W9", w: 4, h: 4}]};
  const before = await T(() => ({items: zdTakeoff.P.proj.items.length, conds: zdTakeoff.P.proj.conds.length, files: zdTakeoff.P.proj.files.length}));
  const M = await T(t => zdTakeoff.mergeProject(t), JSON.stringify(Object.assign({format: "zd-takeoff"}, other)));
  const st = await T(() => { const Z = zdTakeoff, pr = Z.P.proj; return {items: pr.items.map(i => ({id: i.id, cond: i.cond, file: i.file, page: i.page, label: i.label})), conds: pr.conds.map(c => ({id: c.id, name: c.name, type: c.type})), files: pr.files.map(f => f.id), scales: pr.scales, viewports: pr.viewports, sheets: pr.sheets, openings: pr.openings.map(o => o.mark), marks: pr.marks.map(m => ({file: m.file, layer: m.layer, text: m.text})), layers: pr.mkLayers || [], title: document.getElementById("dlgT").textContent, body: document.getElementById("dlgB").innerText}; });
  ok(M.files.use === 1 && M.files.add === 1 && st.files.length === before.files + 1, "drawings: the same one (by fingerprint) used, the other added → " + JSON.stringify(M.files));
  ok(M.conds.use === 1 && M.conds.add === 2 && st.conds.filter(c => c.name.trim().toLowerCase() === "floor tile").length === 2, "conditions: Floor tile (area) used, Skirting and a linear Floor tile added → " + JSON.stringify(M.conds));
  ok(M.items.add === 3 && M.items.dup === 1 && M.items.orphan === 1, "measurements: 3 added, the duplicate (points within 0.01) skipped, the orphan reported → " + JSON.stringify(M.items));
  const added = st.items.filter(i => i.id !== "Imine");
  ok(added.length === 3 && added.every(i => !/^Is\d$/.test(i.id) && !/^Cs\d$/.test(i.cond) && st.conds.some(c => c.id === i.cond) && st.files.includes(i.file)), "every merged measurement has a new id and points at this project's conditions and drawings");
  ok(st.items.some(i => i.label === "new room" && i.cond === "Cmine" && i.file === A.fid), "a measurement on the shared drawing lands on this project's copy and condition");
  ok(st.scales[A.fid + ":1"].ptPerFt === 9 && st.scales[A.fid + ":2"] && st.scales[A.fid + ":2"].ptPerFt === 4.32, "scales: page 1 keeps its own, page 2 (none) takes the file's");
  ok((st.viewports[A.fid + ":3"] || []).length === 1 && st.viewports[A.fid + ":3"][0].id !== "V1" && st.sheets[A.fid + ":1"] && st.sheets[A.fid + ":1"].no === "A-101", "viewports and sheet info come in for pages with none (new ids)");
  ok(JSON.stringify(st.openings) === JSON.stringify(["D1", "W9"]), "openings by mark: D1 used, W9 added");
  ok(st.marks.length === 1 && st.marks[0].file === A.fid && st.layers.some(l => l.name === "Review" && l.id === st.marks[0].layer), "the markup is added on the shared drawing, its layer by name");
  ok(/Import into Merge target — FAIL/.test(st.title) && /already here/.test(st.body) && /elsewhere\.pdf with \+ PDF/.test(st.body), "the check dialog lists what was added, used and skipped → " + st.title);
  await T(() => document.getElementById("dlgCancel").click()); await wait(150);
  await T(() => zdTakeoff.undoAny()); await wait(200);
  const un = await T(() => ({items: zdTakeoff.P.proj.items.length, conds: zdTakeoff.P.proj.conds.length, files: zdTakeoff.P.proj.files.length, scales: Object.keys(zdTakeoff.P.proj.scales).length, openings: zdTakeoff.P.proj.openings.length}));
  ok(un.items === before.items && un.conds === before.conds && un.scales === 1 && un.openings === 1, "Ctrl+Z takes the whole merge back → " + JSON.stringify(un));
  ok(un.files === before.files + 1, "…the drawing it added stays listed, as after + PDF");
  const M2 = await T(t => zdTakeoff.mergeProject(t), JSON.stringify(Object.assign({format: "zd-takeoff"}, other)));
  ok(M2.items.add === 3 && M2.files.add === 0 && M2.files.use === 2, "merged again after the undo: the drawing added the first time is used now → " + JSON.stringify(M2.files));
  const M3 = await T(t => zdTakeoff.mergeProject(t), JSON.stringify(Object.assign({format: "zd-takeoff"}, other)));
  ok(M3.items.add === 0 && M3.items.dup === 4 && M3.conds.add === 0 && /Nothing new to add/.test(await T(() => document.getElementById("dlgB").innerText)), "merged a third time: nothing added twice");
  await T(() => document.getElementById("dlgCancel").click()); await wait(150);

  console.log("merge: pages turned, pages hidden, custom columns");
  const RT = await T(async () => { const Z = zdTakeoff, pr = Z.P.proj, f = pr.files[0].id, pg = await (await Z.S.docs[f]).getPage(1), v = pg.getViewport({scale: 1, rotation: pg.rotate || 0}), W = v.width, H = v.height;
    const mine = pr.items.find(i => i.id === "Imine").pts, fresh = [[400, 200], [460, 200], [460, 260], [400, 260]], T90 = L => L.map(q => Z.rotPt(q, 90, W, H));
    return {fid: f, rot0: Z.rotOf(pr, f + ":1"), fresh, dup: T90(mine), add: T90(fresh)}; });
  const turned = {name: "Turned", v: 2, files: [{id: "Ft1", name: "plan-turned.pdf", sha: sha(plan), pages: 3}, {id: "Ft3", name: "third.pdf", sha: "1".repeat(64), pages: 1}],
    conds: [{id: "Ct1", name: "Floor tile", type: "area", unit: "Sft", color: "#ff0000"}, {id: "Ct2", name: "Paving", type: "area", unit: "Sft", color: "#00aa00", cols: ["Xt1"]}],
    items: [{id: "It1", cond: "Ct1", file: "Ft1", page: 1, kind: "shape", pts: RT.dup, nos: 1, label: ""}, {id: "It2", cond: "Ct2", file: "Ft1", page: 1, kind: "shape", pts: RT.add, nos: 1, label: "turned in"}],
    scales: {}, viewports: {}, marks: [], sheets: {}, openings: [], rot: {"Ft1:1": 90, "Ft3:1": 270}, pageHide: ["Ft3:1"], cols: [{id: "Xt1", name: "Tiles", unit: "Nos", formula: "Q / 4"}]};
  const MT = await T(t => zdTakeoff.mergeProject(t), JSON.stringify(Object.assign({format: "zd-takeoff"}, turned)));
  const ts = await T(() => { const Z = zdTakeoff, pr = Z.P.proj, it = pr.items.find(i => i.label === "turned in"), f3 = pr.files.find(f => f.name === "third.pdf"), pv = pr.conds.find(c => c.name === "Paving"), tl = (pr.cols || []).find(c => c.name === "Tiles");
    return {pts: it && it.pts, f3: f3 && f3.id, rot3: f3 && pr.rot[f3.id + ":1"], hid: f3 && (pr.pageHide || []).includes(f3.id + ":1"), tiles: !!tl, pcols: pv && pv.cols, tid: tl && tl.id}; });
  ok(RT.rot0 === 0 && MT.items.dup === 1 && MT.items.add === 1, "a page turned 90° in the file (not here): its copy of a measurement here is turned back first and found a duplicate → " + JSON.stringify(MT.items));
  ok(ts.pts && ts.pts.every((q, i) => Math.abs(q[0] - RT.fresh[i][0]) < 1e-6 && Math.abs(q[1] - RT.fresh[i][1]) < 1e-6), "…and the new one lands where it is on this project's (unturned) page " + JSON.stringify(ts.pts));
  ok(MT.rot.turned === 1 && ts.rot3 === 270 && MT.rot.add === 1, "an added drawing keeps its page's turn (270°)");
  ok(ts.hid, "…and its page hidden in the file stays hidden");
  ok(ts.tiles && MT.cols === 1 && JSON.stringify(ts.pcols) === JSON.stringify([ts.tid]), "custom columns come in by name; an added condition's own list of them follows");
  await T(() => document.getElementById("dlgCancel").click()); await wait(150);

  console.log("merge a .zdtakeoff (project + PDFs)");
  const bproj = {name: "Bundle", v: 2, files: [{id: "Fb0", name: "plan.pdf", sha: sha(plan), pages: 3}, {id: "Fb1", name: "plain.pdf", sha: sha(plainPdf), pages: 1}],
    conds: [{id: "Cb1", name: "Ceiling", type: "area", unit: "Sft", color: "#123456"}],
    items: [{id: "Ib1", cond: "Cb1", file: "Fb1", page: 1, kind: "shape", pts: [[10, 10], [100, 10], [100, 100], [10, 100]], nos: 1, label: "from the bundle"}, {id: "Ib2", cond: "Cb1", file: "Fb0", page: 3, kind: "shape", pts: [[10, 10], [100, 10], [100, 100]], nos: 1, label: ""}],
    scales: {}, viewports: {}, marks: [], sheets: {}, openings: []};
  const bnd = bundleOf(bproj, [{id: "Fb0", name: "plan.pdf", buf: plan}, {id: "Fb1", name: "plain.pdf", buf: plainPdf}]);
  const MB = await T(b64 => { const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; return zdTakeoff.mergeBuf(b); }, bnd.toString("base64"));
  const bs = await T(async () => { const Z = zdTakeoff, pr = Z.P.proj, it = pr.items.find(i => i.label === "from the bundle"), f = it && pr.files.find(x => x.id === it.file);
    const has = k => new Promise(ok => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("pdfs").objectStore("pdfs").getKey(k); g.onsuccess = () => { rq.result.close(); ok(g.result !== undefined); }; }; });
    return {file: f && f.name, stored: f ? await has(f.id) : false, fb0: await has("Fb0"), title: document.getElementById("dlgT").textContent}; });
  ok(MB.files.add === 1 && MB.files.use === 1 && MB.files.miss === 0 && bs.stored, "the bundle's new drawing is stored and attached; the one already here is used → " + JSON.stringify(MB.files));
  ok(!bs.fb0, "…and the drawing the project has already is not stored a second time");
  ok(MB.items.add === 2 && /— PASS/.test(bs.title), "its measurements are merged, the check passes → " + bs.title);
  ok(await T(() => zdTakeoff.S.lastImport.merge === true), "S.lastImport says it was a merge");
  await T(() => document.getElementById("dlgCancel").click()); await wait(150);

  console.log("where it is offered");
  ok(await T(() => { zdTakeoff.importMenu(20, 20); const t = document.getElementById("ctx").textContent; document.getElementById("ctx").classList.remove("on"); return /Import measurements into this project/.test(t); }), "+ PDF ▾ offers Import measurements into this project…");
  ok(await T(() => zdTakeoff.paletteCmds().some(c => /^Import measurements into this project/.test(c.t))), "…and so does the command palette");

  ok(!errors.length, "no page errors" + (errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

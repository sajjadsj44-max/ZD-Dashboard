#!/usr/bin/env node
/* Browser tests for two AutoCAD tools of the PDF Takeoff: objects drawn twice counted once in CAD quantities (AutoCAD's OVERKILL),
   and DWG compare (AutoCAD's DWG Compare) — on tools/cad_fixtures/zd_rev1_2018.dwg and zd_rev2_2018.dwg, made by AutoCAD 2024
   itself from make_zd_revs.lsp (accoreconsole): revision 1 saved, edited in the same session (every object keeps its handle)
   and saved as revision 2, so every answer is known.

     python -m http.server 8765 --bind 127.0.0.1        # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_cadrev.js

   TK_LIBS as for tools/test_takeoff_cad.js (pdfjs-dist, pdf-lib, @mlightcad/libredwg-web, @mlightcad/dxf-json).

   Revision 1 (inches): WALL a 20' × 10' outline (60 ft) with its bottom line copied in place and its right line drawn again the
   other way round (+30 ft twice); FLOOR 10' × 12' twice on one spot and 8' × 8' (184 Sft, +120 twice); block D1 inserted at two
   places, the first twice (2, +1 twice); a text ROOM 1. Revision 2: the top wall taken out, a 10' wall and a door added, the
   8' × 8' floor moved 2' right, the text now ROOM 1A — 2 added, 1 taken out, 2 changed, 10 the same; WALL 60 → 50 ft, D1 2 → 3. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", FIX = path.join(__dirname, "cad_fixtures");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "@mlightcad/libredwg-web/wasm/libredwg-web.wasm"))) { console.log("TK_LIBS must hold pdfjs-dist, pdf-lib, @mlightcad/libredwg-web and @mlightcad/dxf-json — see tools/test_takeoff_cad.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem("zdTakeoffUser", "Tester"); } catch (e) {} });   // (flagging for re-check asks who checks: answered)
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
    if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: js, headers: H});
    if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
    let m = /@mlightcad\/libredwg-web@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/libredwg-web", m[1]), contentType: /\.wasm$/.test(m[1]) ? "application/wasm" : js, headers: H});
    m = /@mlightcad\/dxf-json@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/dxf-json", m[1]), contentType: js, headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text()) && !/^http:\/\/127\.0\.0\.1:11436\//.test((m.location() || {}).url || "")) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const add = async f => { await page.setInputFiles("#fileIn", path.join(FIX, f)); await page.waitForFunction(n => { const Z = zdTakeoff, F = Z.P.proj && Z.P.proj.files.find(x => x.name === n);
    const web = [...document.querySelectorAll("#dlgBack.on #dlgF button")].find(x => x.textContent === "Read in the browser"); if (web) web.click();   // no AutoCAD helper here: read in the browser
    return F && Z.S.fileId === F.id && Z.S.page && Z.S.cadSc && Z.S.cadSc[F.id]; }, f, {timeout: 60000}); await wait(500); };
  const fid = n => T(n => zdTakeoff.P.proj.files.find(x => x.name === n).id, n);
  const open = async n => { const id = await fid(n); await T(id => zdTakeoff.gotoPage(id, 1), id); await page.waitForFunction(id => zdTakeoff.S.fileId === id && zdTakeoff.S.page && zdTakeoff.S.cadSc[id], id, {timeout: 30000}); await wait(400); return id; };
  const dlgWait = async () => { await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}); await wait(150); };
  const dlgGone = () => page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}).catch(() => {});
  const cond = n => T(n => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === n); return c ? Z.condTotals(c).net : null; }, n);

  await page.goto(URL, {waitUntil: "load"}); await wait(500);
  await page.click("#bNewProj"); await page.fill("#dlgName", "DWG revisions"); await page.click("#dlgOk"); await wait(400);
  await add("zd_rev1_2018.dwg"); await add("zd_rev2_2018.dwg");
  ok((await T(() => zdTakeoff.P.proj.files.filter(f => f.cad).length)) === 2, "both revisions read as AutoCAD drawings");

  console.log("objects drawn twice — CAD quantities (revision 1)");
  await open("zd_rev1_2018.dwg");
  await T(() => { zdTakeoff.cadQtyDialog(); }); await dlgWait();
  const note = await page.innerText("#dlgB .cqdup").catch(() => "");
  ok(/^4 objects are drawn twice/.test(note.trim()), "the dialog says 4 objects are drawn twice (" + note.trim().slice(0, 40) + "…)");
  const row = name => T(n => { const tr = [...document.querySelectorAll("#dlgB table.cqt tbody tr")].find(r => r.cells[0] && r.cells[0].textContent.trim().endsWith(n)); return tr ? [...tr.cells].map(c => c.textContent.replace(/\s+/g, " ").trim()) : null; }, name);
  const rW = await row("WALL"), rF = await row("FLOOR"), rD = await row("D1");
  ok(rW && /4 · 60\.00 ft \+30\.00 ft twice/.test(rW[1]), "WALL: 4 runs · 60.00 ft, and +30.00 ft drawn twice (" + (rW && rW[1]) + ")");
  ok(rF && /2 · 184\.00 Sft \+120\.00 Sft twice/.test(rF[2]), "FLOOR: 2 outlines · 184.00 Sft, and +120.00 Sft twice (" + (rF && rF[2]) + ")");
  ok(rD && /^2 \+1 twice/.test(rD[1]), "block D1: 2, and +1 inserted twice on one spot (" + (rD && rD[1]) + ")");
  ok(await page.isChecked("#cqDup"), "“Leave them out of the takeoff” is ticked");
  await T(() => { const L = n => [...document.querySelectorAll("#dlgB table.cqt tbody tr")].find(r => r.cells[0].textContent.trim().endsWith(n)); L("WALL").querySelector("[data-ql]").click(); L("FLOOR").querySelector("[data-qa]").click(); L("D1").querySelector("[data-qb]").click(); });
  await page.click("#dlgOk"); await dlgGone(); await wait(400);
  ok(near(await cond("WALL"), 60, 1e-3) && near(await cond("FLOOR"), 184, 1e-3) && (await cond("D1")) === 2, "taken off: WALL 60.000 ft, FLOOR 184.000 Sft, D1 2 Nos — each duplicate once");
  await T(() => { zdTakeoff.cadQtyDialog(); }); await dlgWait(); await page.click("#cqDupShow"); await dlgGone(); await wait(300);
  const shown = await T(() => ({n: zdTakeoff.S.cadSel && zdTakeoff.S.cadSel.f === zdTakeoff.S.fileId ? zdTakeoff.S.cadSel.ids.size : -1, tool: zdTakeoff.S.tool, f: zdTakeoff.S.cadSel && zdTakeoff.S.cadSel.f}));
  ok(shown.n === 4 && shown.tool === "cadsel", "Show them selects the 4 on the drawing " + JSON.stringify(shown));

  console.log("objects drawn twice kept, when asked (revision 2)");
  await open("zd_rev2_2018.dwg");
  await T(() => { zdTakeoff.cadQtyDialog(); }); await dlgWait();
  await page.uncheck("#cqDup");
  await T(() => [...document.querySelectorAll("#dlgB table.cqt tbody tr")].find(r => r.cells[0].textContent.trim().endsWith("WALL")).querySelector("[data-ql]").click());
  await page.click("#dlgOk"); await dlgGone(); await wait(400);
  ok(near(await cond("WALL"), 60 + 80, 1e-3), "unticked: revision 2's walls go in with their copies, 80.000 ft (WALL now 60 + 80)");

  console.log("DWG compare (revision 2 against revision 1)");
  const id1 = await fid("zd_rev1_2018.dwg"), id2 = await fid("zd_rev2_2018.dwg");
  const r = await T(id1 => zdTakeoff.cadCompare(id1, true).then(r => ({n: r.n, rows: r.rows.map(x => [x.name, x.kind, +x.v[0].toFixed(3), +x.v[1].toFixed(3)]), clusters: r.clusters.length, e: r.clusters.flatMap(c => c.e).length})), id1);
  ok(r.n.add === 2 && r.n.del === 1 && r.n.chg === 2 && r.n.same === 10, "2 added, 1 taken out, 2 changed, 10 the same " + JSON.stringify(r.n));
  const qW = r.rows.find(x => x[0] === "WALL"), qD = r.rows.find(x => x[0] === "D1");
  ok(qW && qW[1] === "ft" && qW[2] === 60 && qW[3] === 50, "WALL length 60.000 → 50.000 ft (duplicates once) " + JSON.stringify(qW));
  ok(qD && qD[1] === "Nos" && qD[2] === 2 && qD[3] === 3, "block D1 2 → 3 " + JSON.stringify(qD));
  ok(!r.rows.some(x => x[0] === "FLOOR"), "FLOOR's area is the same — the 8' × 8' floor only moved");
  ok(r.clusters >= 1 && r.e === 4, r.clusters + " place(s) on the drawing; what was added or changed (4) on this one");
  await T(id1 => { zdTakeoff.cadCompare(id1, true).then(r => zdTakeoff.cadCompareReport(r)); }, id1); await dlgWait();
  const rep = await page.innerText("#dlgB");
  ok(/2 added · 1 taken out · 2 changed · 10 the same/.test(rep), "the report: 2 added · 1 taken out · 2 changed · 10 the same");
  ok(/WALL[\s\S]*60\.000[\s\S]*50\.000[\s\S]*−10\.000 ft/.test(rep) && /D1[\s\S]*\+1 Nos/.test(rep), "…and the quantities: WALL −10.000 ft, D1 +1");
  await page.click('[data-cmpa="clouds"]'); await dlgGone(); await wait(300);
  const cl = await T(id2 => (zdTakeoff.P.proj.marks || []).filter(m => m.subject === "DWG compare" && m.file === id2).map(m => ({type: m.type, color: m.color, text: m.text})), id2);
  ok(cl.length === r.clusters && cl.every(m => m.type === "cloud" && /since zd_rev1_2018/.test(m.text)), cl.length + " revision cloud(s) on revision 2, each saying what changed since zd_rev1_2018 (" + (cl[0] && cl[0].text) + ")");
  await T(id1 => { zdTakeoff.cadCompare(id1, true).then(r => { zdTakeoff.cadCompareClouds(r); }); }, id1); await wait(800);
  ok((await T(id2 => zdTakeoff.P.proj.marks.filter(m => m.subject === "DWG compare" && m.file === id2).length, id2)) === cl.length, "clouded again: the earlier clouds replaced, not doubled");
  await T(id1 => { zdTakeoff.cadCompare(id1, true).then(r => zdTakeoff.cadCompareReport(r)); }, id1); await dlgWait();
  await page.click('[data-cmpa="sel"]'); await dlgGone(); await wait(300);
  ok((await T(() => zdTakeoff.S.cadSel.ids.size)) === 4, "Select what was added or changed: 4 objects");
  await T(id1 => { zdTakeoff.cadCompare(id1, true).then(r => zdTakeoff.cadCompareReport(r)); }, id1); await dlgWait();
  await page.click('[data-cmpa="flag"]'); await wait(800); await dlgGone(); await wait(300);
  const fl = await T(id2 => zdTakeoff.P.proj.items.filter(i => i.file === id2 && i.qa === "recheck").length, id2);
  ok(fl >= 1, "the measurements on the changes flagged for re-check (" + fl + ")");
  const self = await T(id2 => zdTakeoff.cadCompare(id2, true).then(r => r.n), id2);
  ok(self.add === 0 && self.del === 0 && self.chg === 0 && self.same === 14, "a drawing against itself: nothing changed (" + self.same + " the same)");
  ok(!!(await T(() => document.querySelector('#tools .rpanel[data-rp="review"] .tool[data-fn="cadcmp"]'))), "DWG compare is on the Review tab");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

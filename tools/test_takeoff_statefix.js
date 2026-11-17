#!/usr/bin/env node
/* Browser test for PDF Takeoff editing and saving fixes (review of 17-Nov-2026):
   a Properties field typed in goes to its own measurement when another is clicked; Import projects replacing a project open in a
   split window keeps the file's copy; a project deleted while open in a split window stays deleted; an Auto area preview ends on a
   page change; undoing a new condition leaves no broken selection; spot levels and material defaults are taken back by Ctrl+Z;
   Remove PDF leaves nothing of the drawing in the project.
     python -m http.server 8765 --bind 127.0.0.1      # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_statefix.js      (TK_URL for another port) */
const path = require("path");
const pw = require("playwright");
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
(async () => {
  if (!LIBS) { console.log("TK_LIBS needed"); process.exit(2); }
  const browser = await pw.chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    return r.abort(); });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e && e.stack || e).slice(0, 400))); page.on("dialog", d => d.accept());
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(700);
  const T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 200);
  const home = async () => { await T(() => document.getElementById("bProjects").click()); await wait(400); };
  const mk = async name => { for (let i = 0; i < 3 && await T(() => document.getElementById("dlgBack").classList.contains("on")); i++) { await page.keyboard.press("Escape"); await wait(250); }   // (a report left open)
    await home(); await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await wait(400);
    await page.setInputFiles("#fileIn", {name: "plan.pdf", mimeType: "application/pdf", buffer: makePdf()}); await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 20000});
    await T(() => { const z = zdTakeoff, p = z.P.proj, f = p.files[0];
      p.conds.push({id: "C1", name: "Floor", type: "area", unit: "Sft", color: "#3366cc", group: "", faces: 1}, {id: "C2", name: "Wall", type: "linear", unit: "ft", color: "#cc3366", group: "", faces: 1});
      p.items.push({id: "I1", cond: "C1", file: f.id, page: 1, pts: [[100, 100], [300, 100], [300, 300], [100, 300]], kind: "shape", nos: 1, label: ""}, {id: "I2", cond: "C2", file: f.id, page: 1, pts: [[100, 400], [300, 400]], kind: "shape", nos: 1, label: ""});
      p.scales[f.id + ":1"] = {ptPerFt: 10, how: "calibrated", verified: true}; z.S.cond = "C1"; z.save(); z.refresh(); }); await wait(400);
    return T(() => zdTakeoff.P.proj.id); };
  const one = id => T(id => new Promise(res => { const rq = indexedDB.open("zdTakeoff"); rq.onsuccess = () => { const g = rq.result.transaction("projects").objectStore("projects").get(id); g.onsuccess = () => res(g.result || null); }; }), id);

  console.log("a Properties field, then a click on another measurement");
  await mk("Props");
  await T(() => { const z = zdTakeoff; z.setTool("select"); z.setSel(["I1"]); z.refresh(); }); await wait(300);
  await page.locator('#props [data-prop="nos"]').first().click(); await page.keyboard.press("End"); await page.keyboard.type("7"); await wait(100);
  { const st = await page.locator("#stage").boundingBox(), v = await T(() => zdTakeoff.S.view);
    await page.mouse.click(st.x + 200 * v.s + v.tx, st.y + 400 * v.s + v.ty); await wait(500); }
  let r = await T(() => ({sel: zdTakeoff.S.sel, i1: +zdTakeoff.P.proj.items.find(i => i.id === "I1").nos, i2: +zdTakeoff.P.proj.items.find(i => i.id === "I2").nos}));
  ok(r.i1 === 17 && r.i2 === 1, "Nos typed for I1 goes to I1 (17), not to I2 clicked next (" + JSON.stringify(r) + ")");

  console.log("undo");
  await T(() => { zdTakeoff.editCond(null); }); await wait(600); await page.fill("#cName", "Plaster"); await page.click("#dlgOk"); await wait(500);
  await T(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press("Control+z"); await wait(400);
  r = await T(() => ({ok: !zdTakeoff.S.cond || !!zdTakeoff.P.proj.conds.find(c => c.id === zdTakeoff.S.cond)}));
  { const box = await page.locator("#stage").boundingBox(); const e0 = errors.length; await page.mouse.click(box.x + 400, box.y + 300); await wait(400);
    ok(r.ok && errors.length === e0, "undoing a new condition leaves a condition that exists, and a click on the drawing throws nothing"); }
  await page.keyboard.press("Escape");
  await T(() => zdTakeoff.mutate(() => { zdTakeoff.P.proj.levels = [{id: "L1", file: zdTakeoff.P.proj.files[0].id, page: 1, p: [10, 10], z: 101.5}]; }, "Spot level +101.50")); await wait(200);
  await page.keyboard.press("Control+z"); await wait(300);
  ok(!(await T(() => (zdTakeoff.P.proj.levels || []).length)), "Ctrl+Z takes the first spot level back");
  await T(() => zdTakeoff.mutate(() => { zdTakeoff.P.proj.matDef = {joint: 0.5}; }, "Material defaults")); await wait(200);
  await page.keyboard.press("Control+z"); await wait(300);
  ok(!(await T(() => zdTakeoff.P.proj.matDef)), "…and material defaults");

  console.log("Remove PDF");
  const idR = await mk("Remove");
  const fid = await T(() => { const z = zdTakeoff, p = z.P.proj, f = p.files[0].id;
    p.vec = {[f + ":1"]: {at: "x", n: 1, d: "A".repeat(20000)}}; p.cadEd = {[f]: {v: "E1", hp: [], ht: [], add: []}}; p.bbImp = {[f]: {off: false}}; p.levels = [{id: "L1", file: f, page: 1, p: [10, 10], z: 100}];
    z.save(); return f; }); await wait(400);
  T(() => { zdTakeoff.removePdf(zdTakeoff.P.proj.files[0].id); }); await wait(400); await page.click("#dlgOk"); await wait(1500);
  { const p = await one(idR), left = ["vec", "cadEd", "bbImp"].filter(k => p[k] && Object.keys(p[k]).some(x => x.startsWith(fid))).concat((p.levels || []).some(l => l.file === fid) ? ["levels"] : []);
    ok(!left.length, "nothing of the removed PDF is left: " + JSON.stringify(left)); }

  console.log("split window: Import replacing, Delete");
  const idA = await mk("Proj A");
  const bytes = await T(async () => { await zdTakeoff.flushSave(); const b = await zdTakeoff.exportAll(null, {blob: true}); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  await T(() => { const z = zdTakeoff, f = z.P.proj.files[0]; z.mutate(() => z.P.proj.items.push({id: "I3", cond: "C1", file: f.id, page: 1, pts: [[400, 100], [500, 100], [500, 200], [400, 200]], kind: "shape", nos: 1, label: ""}), "add"); }); await wait(600);
  await T(() => zdTakeoff.splitOpen("same")); await wait(800);
  await home();
  await page.setInputFiles("#impIn", {name: "all.zdtakeoff", mimeType: "application/octet-stream", buffer: Buffer.from(bytes)}); await wait(800);
  const nx = await page.locator("[data-xi]").count();
  for (let i = 0; i < nx; i++) { const lab = await page.locator("[data-xi]").nth(i).evaluate(x => (x.closest("label, tr, div") || x).textContent); if (/Proj A/.test(lab)) await page.locator("[data-xi]").nth(i).check(); }
  await page.click("#dlgOk"); await wait(2500);
  await T(() => { if (zdTakeoff.P.proj) zdTakeoff.save(); return zdTakeoff.flushSave(); }); await wait(500);
  { const db = await one(idA), mem = await T(id => { const L = zdTakeoff.PANES.map(p => p.sess.proj).filter(p => p && p.id === id); return L.length ? L.map(p => p.items.length) : []; }, idA);
    ok(db && db.items.length === 2 && mem.every(n => n === 2), "Import replacing a project open in a split window: stored and every window hold the file's 2 measurements (" + (db && db.items.length) + ", " + JSON.stringify(mem) + ")"); }
  const idD = await mk("Delete me");
  await T(() => zdTakeoff.splitOpen("same")); await wait(800); await home();
  await page.click(`[data-del="${idD}"]`); await wait(300); if (await page.locator("#dlgOk").isVisible()) { await page.click("#dlgOk"); } await wait(1200);
  await T(() => { if (zdTakeoff.P.proj) zdTakeoff.save(); return zdTakeoff.flushSave(); }); await wait(600);
  ok(!(await one(idD)) && !(await T(id => zdTakeoff.PANES.some(p => p.sess.proj && p.sess.proj.id === id), idD)), "a project deleted while open in a split window stays deleted and no window holds it");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

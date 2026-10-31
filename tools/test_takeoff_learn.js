#!/usr/bin/env node
/* Browser tests for the takeoff agent that learns how the team works (Learned skills) — on a 3-page vector PDF written here.

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_learn.js           # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) as in tools/test_takeoff.js.

   p.1 (1/8" = 1'-0", 9 pt per ft): four baths 8' × 6' and two bed rooms 12' × 14', each a closed outline with its name. A person
       takes them off as this team does: every room in Floor area; each bath with Ceramic tile (WC) and POP ceiling over it, Wall tile
       H 7 along its walls and a WC counted in it; each bed room with Floor tile over it, Wall paint H 10.25 and Skirting along its walls.
   p.2: a bath and a bed room, measured as rooms only — the learned skills take off the rest.
   p.3: BED ROOM 4, PORCH 1 and PLANTER 2: the agent's porches are deleted every time (it stops measuring them) and planters are
       measured by hand after it (it learns PLANTER is a room) — then the rooms agent runs on the page. */
const path = require("path"), fs = require("fs"), zlib = require("zlib");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

const W = 842, H = 595, K = 9;
const ROOMS = {   // [x0, y0 (PDF, y up), w ft, h ft, name]
  1: [[60, 400, 8, 6, "BATH 1"], [150, 400, 8, 6, "BATH 2"], [240, 400, 8, 6, "BATH 3"], [330, 400, 8, 6, "BATH 4"], [60, 150, 12, 14, "BED ROOM 1"], [200, 150, 12, 14, "BED ROOM 2"]],
  2: [[60, 400, 8, 6, "BATH 5"], [60, 150, 12, 14, "BED ROOM 3"]],
  3: [[60, 150, 12, 14, "BED ROOM 4"], [250, 150, 8, 8, "PORCH 1"], [360, 150, 10, 8, "PLANTER 2"]]};
const f = v => v.toFixed(3);
function pageOf(n){
  const L = ["0.6 w"]; ROOMS[n].forEach(([x, y, w, h, nm]) => { const X = x + w * K, Y = y + h * K; L.push(`${f(x)} ${f(y)} m ${f(X)} ${f(y)} l ${f(X)} ${f(Y)} l ${f(x)} ${f(Y)} l h S`, `BT /F1 7 Tf ${f(x + 6)} ${f(y + h * K / 2)} Td (${nm}) Tj ET`); });
  L.push("BT /F1 9 Tf 560 40 Td (SCALE 1/8\" = 1'-0\") Tj ET"); return L.join("\n");
}
function makePdf(){
  const pages = [pageOf(1), pageOf(2), pageOf(3)], objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], kids = [];
  pages.forEach(c => { const pid = objs.length + 1; objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${pid + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(c, "latin1")} >>\nstream\n${c}\nendstream`); kids.push(pid + " 0 R"); });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see tools/test_takeoff.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), Hd = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: Hd});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: Hd});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: Hd});
    return r.abort();
  });
  /* the team's relay and its merged method, stood in for (a copy run here sends nothing unless told: this test tells it) */
  let team = null; const sent = [];
  await ctx.addInitScript(() => { try { localStorage.setItem("zdTakeoffLearnRelay", "on"); } catch (e) {} });
  await ctx.route(/ntfy\.sh\//, r => { if (r.request().method() === "POST") sent.push(r.request().postData() || ""); return r.fulfill({contentType: "application/json", body: "{}", headers: {"Access-Control-Allow-Origin": "*"}}); });
  await ctx.route(/raw\.githubusercontent\.com\/.*team-method\.json/, r => r.fulfill({contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"}, body: JSON.stringify(team || {v: 2, at: "", senders: {}, projects: {}})}));
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a), wait = ms => page.waitForTimeout(ms || 150);
  const dlgWait = async () => { await page.waitForFunction(() => document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}); await wait(150); };
  const dlgGone = () => page.waitForFunction(() => !document.getElementById("dlgBack").classList.contains("on"), null, {timeout: 20000}).catch(() => {});
  const go = async n => { await T(n => { const Z = zdTakeoff; return Z.gotoPage(Z.P.proj.files[0].id, n); }, n); await page.waitForFunction(n => zdTakeoff.S.pageNo === n && zdTakeoff.S.geo[zdTakeoff.S.key], n, {timeout: 20000}); await wait(300); };
  /* a person's takeoff, as the team does it (each change as a person makes it: no agent at work) */
  const takeoff = (pg, plan, label, ai) => T(([pg, plan, ROOMS, H, K, label, ai]) => { const Z = zdTakeoff, P = Z.P.proj, f = P.files[0].id;
    const cond = (name, type, unit, o) => { let c = P.conds.find(x => x.name === name); if (!c) { c = Object.assign({id: "C" + Math.random().toString(36).slice(2), name, type, unit, color: "#2a78d6", sw: 2, h: "", t: "", faces: 1, dedMin: 0}, o || {}); P.conds.push(c); } return c; };
    const box = ([x, y, w, h]) => { const X = x + w * K, Y = y + h * K; return [[x, H - Y], [X, H - Y], [X, H - y], [x, H - y]]; };
    Z.mutate(() => { ROOMS[pg].forEach(r => { const nm = r[4], P0 = box(r), want = plan[nm]; if (!want) return;
      want.forEach(([name, type, unit, how, o]) => { const c = cond(name, type, unit, o), base = {id: "I" + Math.random().toString(36).slice(2), cond: c.id, file: f, page: pg, kind: "shape", nos: 1, label: how === "count" ? "" : nm};
        if (ai) base.ai = true;
        if (how === "area") P.items.push(Object.assign(base, {pts: P0.map(p => p.slice())}));
        else if (how === "wall") P.items.push(Object.assign(base, {pts: P0.concat([P0[0]]).map(p => p.slice())}));
        else P.items.push(Object.assign(base, {pts: [[(P0[0][0] + P0[2][0]) / 2, (P0[0][1] + P0[2][1]) / 2]]})); }); }); }, label); }, [pg, plan, ROOMS, H, K, label || "Draw", !!ai]);
  const room = ["Floor area", "area", "Sft", "area"];
  const BATH = [room, ["Ceramic tile (WC)", "area", "Sft", "area", {dedMin: 1}], ["POP ceiling", "area", "Sft", "area"], ["Wall tile", "linear", "Sft", "wall", {h: 7, dedMin: 1}], ["WC — commode", "count", "Nos", "count"]];
  const BED = [room, ["Floor tile", "area", "Sft", "area", {dedMin: 1}], ["Wall paint", "linear", "Sft", "wall", {h: 10.25, dedMin: 1}], ["Skirting", "linear", "ft", "wall"]];
  const onPage = (pg, name) => T(([pg, name]) => { const Z = zdTakeoff, P = Z.P.proj, c = P.conds.find(x => x.name === name); if (!c) return null;
    return P.items.filter(i => i.cond === c.id && i.page === pg).reduce((a, it) => a + Z.rowsOf(it, P.scales[it.file + ":" + it.page].ptPerFt).reduce((b, r) => b + r.qty, 0), 0); }, [pg, name]);

  console.log("project and drawing");
  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Learning test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "learn.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  for (const n of [2, 3]) await go(n); await go(1);
  ok(near(await T(() => zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt), K, 1e-9), "scale 9 pt per ft from the note");
  ok((await T(() => Object.keys(zdTakeoff.learnSkills().rooms).length)) === 0, "a new browser has learned nothing yet");

  console.log("it learns from how the team takes off (p.1)");
  await takeoff(1, {"BATH 1": BATH, "BATH 2": BATH, "BATH 3": BATH, "BATH 4": BATH, "BED ROOM 1": BED, "BED ROOM 2": BED});
  const Ks = await T(() => { const K = zdTakeoff.learnProject(); return {rooms: Object.fromEntries(Object.entries(K.rooms).map(([t, r]) => [t, {n: r.n, items: r.items.map(i => [i.name, i.how, i.h, i.per, i.some])}])), take: K.take}; });
  const bath = Ks.rooms.BATH, bed = Ks.rooms["BED ROOM"], it = (r, n) => r && r.items.find(i => i[0] === n);
  ok(bath && bath.n === 4 && bed && bed.n === 2, "it saw 4 baths and 2 bed rooms");
  ok(it(bath, "Ceramic tile (WC)")[1] === "area" && it(bath, "POP ceiling")[1] === "area" && it(bath, "Wall tile")[1] === "wall" && it(bath, "Wall tile")[2] === 7, "a bath gets Ceramic tile (WC) and POP ceiling over it, Wall tile H 7.000 along its walls");
  ok(it(bath, "WC — commode") && it(bath, "WC — commode")[1] === "count" && it(bath, "WC — commode")[3] === 1, "…and one WC counted in it");
  ok(it(bed, "Floor tile")[1] === "area" && it(bed, "Wall paint")[2] === 10.25 && it(bed, "Skirting")[1] === "wall" && !it(bed, "Wall tile"), "a bed room gets Floor tile, Wall paint H 10.250, Skirting — no wall tile");
  const tk = Ks.take["ceramic tile (wc)|area|Sft"];
  ok(tk && tk.yes.join() === "BATH" && tk.no.includes("BED ROOM"), "Ceramic tile (WC) is taken in baths only (seen in 4, never in bed rooms)");
  ok(await T(() => { const Z = zdTakeoff, c = Z.P.proj.conds.find(x => x.name === "Ceramic tile (WC)"), r = Z.houseRule(c); return !!r && r.take("BATH 7") && !r.take("BED ROOM 1") && /learned/.test(r.why); }),
    "the item rule follows the team, not the rule written by hand (which would leave the baths out of a tile item)");
  ok(await T(() => document.getElementById("rbAuto").classList.contains("learned") && zdTakeoff.S.learnNew > 0), "it shows it learned something — a quiet 🧠 on Auto takeoff, not a pop-up over the work");
  const lg = await T(() => zdTakeoff.learnStore().log);
  ok(lg.length >= 3 && lg.every(l => /^\d{4}-\d{2}-\d{2}$/.test(l.d)), "…and keeps it in a dated log (" + lg.length + " lines)");
  ok(/HOW THIS TEAM TAKES OFF[\s\S]*BATH[\s\S]*Wall tile — a run along its walls, H 7\.000/.test(await T(() => zdTakeoff.rulesPrompt())), "the Claude agent is told the team's method");
  const again = await T(() => { const n0 = zdTakeoff.learnStore().log.length; zdTakeoff.learnProject(); return zdTakeoff.learnStore().log.length - n0; });
  ok(again === 0 && (await T(() => zdTakeoff.learnSkills().rooms.BATH.n)) === 4, "read again: the project's facts refreshed, not counted twice");

  console.log("the learned skills at work (p.2)");
  await go(2);
  await takeoff(2, {"BATH 5": [room], "BED ROOM 3": [room]});
  const n0 = await T(() => zdTakeoff.P.proj.items.length);
  await T(() => zdTakeoff.learnApply("page")); await wait(500);
  ok(near(await onPage(2, "Ceramic tile (WC)"), 48) && near(await onPage(2, "POP ceiling"), 48), "the bath: Ceramic tile (WC) 48.000 and POP ceiling 48.000 Sft over it");
  ok(near(await onPage(2, "Wall tile"), 28 * 7), "…Wall tile along its walls: 28 ft × 7 = 196.000 Sft");
  ok(near(await onPage(2, "Floor tile"), 168) && near(await onPage(2, "Wall paint"), 52 * 10.25) && near(await onPage(2, "Skirting"), 52), "the bed room: Floor tile 168.000, Wall paint 52 × 10.25 = 533.000 Sft, Skirting 52.000 ft");
  ok((await onPage(2, "WC — commode")) === 0, "the WC is not placed by habit — it is counted from the drawing");
  const fl = await T(n0 => zdTakeoff.P.proj.items.slice(n0).every(i => i.ai && i.learnAuto), n0);
  ok(fl, "what it took off is marked AI for a person to check");
  const n1 = await T(() => zdTakeoff.P.proj.items.length); await T(() => zdTakeoff.learnApply("page")); await wait(400);
  ok((await T(() => zdTakeoff.P.proj.items.length)) === n1, "applied again: nothing twice");
  ok((await T(() => zdTakeoff.P.proj.items.filter(i => i.page === 2 && zdTakeoff.isRoomArea(i)).length)) === 2, "its copies over the rooms are not rooms themselves (2 rooms on p.2)");

  console.log("it learns what the agent gets wrong and what it misses (p.3)");
  await go(3);
  await takeoff(3, {"PORCH 1": [room]}, "Rooms", true); await takeoff(3, {"PORCH 1": [room]}, "Rooms", true); await takeoff(3, {"PORCH 1": [room]}, "Rooms", true);
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, ids = new Set(P.items.filter(i => i.page === 3 && i.ai && /PORCH/.test(i.label)).map(i => i.id)); Z.mutate(() => { Z.P.proj.items = Z.P.proj.items.filter(i => !ids.has(i.id)); }, "Delete " + ids.size + " objects"); });
  const sk = await T(() => [...zdTakeoff.learnSkip()]);
  ok(sk.includes("PORCH"), "the agent's porches deleted every time (3 of 3): PORCH is not measured as a room any more");
  await takeoff(3, {"BED ROOM 4": [room]}, "Rooms", true);
  await takeoff(3, {"PLANTER 2": [room]}); await T(() => { const Z = zdTakeoff, P = Z.P.proj; Z.mutate(() => { P.items = P.items.filter(i => !(i.page === 3 && /PLANTER/.test(i.label))); }, "Clear"); });
  await takeoff(3, {"PLANTER 2": [room]});
  ok(await T(() => zdTakeoff.learnWord("PLANTER 2")), "a planter measured by hand twice after the agent: PLANTER is learned as a room name");
  ok((await T(() => zdTakeoff.learnSkills().missed.PLANTER)) === 2, "…and kept as what the agent missed (2)");
  await T(() => { const Z = zdTakeoff, P = Z.P.proj; Z.mutate(() => { P.items = P.items.filter(i => i.page !== 3); }, "Clear page 3"); });
  const ran = await T(() => zdTakeoff.agentMeasure("", null, {whole: true}).then(() => zdTakeoff.P.proj.items.filter(i => i.page === 3 && i.label).map(i => i.label.trim())));
  ok(ran.some(l => /BED ROOM 4/.test(l)) && ran.some(l => /PLANTER 2/.test(l)), "the rooms agent now measures PLANTER 2 with BED ROOM 4 (" + ran.join(", ") + ")");
  ok(!ran.some(l => /PORCH/.test(l)), "…and leaves PORCH 1 out, as the team does");

  console.log("never forgets, and is shared with the team");
  const nSent = await T(() => zdTakeoff.learnSend(true));
  const msgs = sent.map(b => JSON.parse(b)), unz = m => JSON.parse(zlib.inflateRawSync(Buffer.from(m.z, "base64")).toString("utf8"));
  const proj = msgs.find(m => m.p), cnts = msgs.find(m => m.c), me = await T(() => localStorage.getItem("zdTakeoffLearnId"));
  ok(nSent === msgs.length && nSent >= 2 && proj && cnts && msgs.every(m => m.k === "zdlearn" && m.s === me), "shared with the team by itself — to the free relay, " + nSent + " messages from this browser's anonymous id");
  ok(proj && unz(proj).rooms.BATH && unz(proj).conds["wall tile|linear|Sft"].h === 7 && unz(cnts).rejects.PORCH.del === 3, "…deflated: the rooms and items, the heights, the counts — the merge script reads them");
  ok(!sent.some(b => /Learning test/.test(b) || /Learning test/.test(JSON.stringify(msgs.map(m => m.z ? unz(m) : m)))), "…and no project name");
  const again2 = await T(() => zdTakeoff.learnSend()); ok(again2 === 0, "nothing new: nothing sent again");
  team = {v: 2, at: "2026-10-31T10:00:00Z", senders: {Lother000002: {at: "2026-10-31T10:00:00Z", rejects: {}, missed: {}, words: {}}},
    projects: {"Lother000002:aaaa11112222": {at: "2026-10-30T10:00:00Z", rooms: {KITCHEN: {n: 3, items: {"kitchen tile|area|Sft": {n: 3, how: "area", per: []}}}},
      conds: {"kitchen tile|area|Sft": {name: "Kitchen tile", type: "area", unit: "Sft", h: 0, t: 0, faces: 1, ded: 1}}},
      [me + ":" + proj.p]: Object.assign({sent: "x"}, unz(proj))}};
  const b0 = await T(() => zdTakeoff.learnSkills().rooms.BATH.n);   // this browser's own baths (4, or 5 once the project is read again with BATH 5 of p.2)
  ok(await T(() => zdTakeoff.learnTeamLoad()), "the team's method read from the site");
  const k2 = await T(() => Object.keys(zdTakeoff.learnSkills().rooms));
  ok(k2.includes("KITCHEN") && k2.includes("BATH") && k2.includes("BED ROOM"), "…added to what this browser learned: " + k2.join(", "));
  ok(b0 >= 4 && (await T(() => zdTakeoff.learnSkills().rooms.BATH.n)) === b0, "…what this browser sent itself is not counted twice (still " + b0 + " baths)");
  await page.click("#bNewTop").catch(() => {}); await dlgWait().catch(() => {}); if (await T(() => !!document.getElementById("dlgName"))) { await page.fill("#dlgName", "Second project"); await page.click("#dlgOk"); } await wait(600);
  await T(() => zdTakeoff.learnProject());
  ok((await T(() => (zdTakeoff.learnSkills().rooms.BATH || {}).n)) === b0, "a new, empty project: what it learned before stays");
  await T(() => { const Z = zdTakeoff, st = Z.learnStore(), id = Object.keys(st.projects)[0]; st.projects.X2 = JSON.parse(JSON.stringify(st.projects[id])); localStorage.setItem("zdTakeoffLearn", JSON.stringify(st)); });
  await T(() => { zdTakeoff.quickItemsDialog(); }); await dlgWait(); await page.fill("#qkQ", "wall tile"); await wait(120); await page.keyboard.press("Enter"); await dlgWait();
  const ph = await T(() => (document.querySelector('#dlgB [data-qkh="0"]') || {}).placeholder || "");
  ok(/usually 7\.000/.test(ph), "Quick items asks Wall tile's H with the height the team used in 2 projects (" + ph + ")");
  await page.keyboard.press("Escape"); await dlgGone();

  console.log("Learned skills");
  await T(() => { zdTakeoff.learnDialog(); }); await dlgWait();
  const body = await page.innerText("#dlgB");
  ok(/Bath[\s\S]*Ceramic tile \(WC\)[\s\S]*Wall tile — along its walls, H 7\.000/.test(body) && /Not measured as a room[\s\S]*Porch/i.test(body) && /Room names it learned[\s\S]*PLANTER/.test(body), "the window shows each skill with its evidence");
  ok(/What it learned, day by day/.test(body) && /shared with the team by itself/.test(body), "…the dated log, and that it is shared with the team by itself");
  await page.uncheck('#dlgB [data-lk="room:BATH"]'); await page.click("#dlgOk"); await dlgGone();
  ok(await T(() => zdTakeoff.learnStore().off.includes("room:BATH") && !/- BATH/.test(zdTakeoff.rulesPrompt())), "a skill unticked is not used (and not told to the agent)");

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

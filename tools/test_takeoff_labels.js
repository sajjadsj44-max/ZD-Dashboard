#!/usr/bin/env node
/* Browser tests for the takeoff's labels on screen: sized as the drawing's own text (they grow and shrink with the zoom),
   left out when too small to read, and never on top of one another — on the vector PDF of tools/takeoff_fixture.js
   (scale from its note: 1/8" = 1'-0" → 9 pt per ft).

     python3 -m http.server 8765 &              # from the repo root
     node tools/test_takeoff_labels.js          # needs playwright (npm i -g playwright)

   TK_URL, TK_LIBS (pdfjs-dist, exceljs) and TK_SHOTS as in tools/test_takeoff.js.

   Checks: by default PlanSwift's labels — an area's yellow tag (#dfbf2a, black border, square corners, plain Arial) reading
   "HALL / 1,200.00 SQ FT", fitted to its text and sized on the building (0.85 ft text at the drawing's scale), still drawn small
   at 30 %; a run shows its length only when clicked (and on every run with that option off); the export draws the same; Classic
   brings the white box back; labels set before are switched to PlanSwift's once. Then, in Classic: a label can be dragged (offset kept on the drawing, leader, undo, reset, locked), [ ] / ⚙ / dialog sizes; a label's text size follows the zoom at every zoom, as Bluebeam's (100 % = its set size); zoomed far out the labels are left
   out but the selected object's stays readable; small labels that would overlap keep only the bigger object's; View →
   Labels "grow and shrink with the zoom" off keeps one size, "leave out a label that would cover another" off shows them
   all; the hover tip still names a hidden label's object; no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf, GEOM: G} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/";
const LIBS = process.env.TK_LIBS || "";
const SHOTS = process.env.TK_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.05 : t);

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see tools/test_takeoff.js"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  await ctx.route(/cdn\.jsdelivr\.net/, r => {
    const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
    if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
    if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
    if (/exceljs/.test(u)) return r.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "text/javascript", headers: H});
    return r.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push("console: " + m.text()); });
  const T = (fn, a) => page.evaluate(fn, a);
  const wait = ms => page.waitForTimeout(ms || 150);
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, "labels-" + n + ".png")}); } };
  const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];   // page points (y down)
  /* labels drawn now: text and font size of each .aplbl group's first line */
  const labels = () => T(() => { return [...document.querySelectorAll("#ov g.aplbl")].map(g => { const t = g.querySelector("text"); return {s: t.textContent, fs: +t.getAttribute("font-size")}; }); });
  const zoomTo = async s => { await T(s => { const Z = zdTakeoff, v = Z.S.view; v.s = s; Z.applyView(); }, s); await wait(250); };
  const setLbl = async o => { await T(o => { const Z = zdTakeoff; Z.S.lbl = Object.assign({}, Z.S.lbl, o); Z.refresh(); }, o); await wait(150); };

  await page.goto(URL, {waitUntil: "load"}); await wait(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Label test"); await page.click("#dlgOk"); await wait(400);
  await page.setInputFiles("#fileIn", {name: "test-plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj.scales[zdTakeoff.S.key] && zdTakeoff.S.geo[zdTakeoff.S.key], null, {timeout: 20000});
  /* one floor area 40 × 30 ft (360 × 270 pt) named HALL, and three small cut-outs side by side, closer than their labels are wide */
  await T(([big, c1, c2, c3]) => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId;
    P.conds.push({id: "CF", name: "Floor area", type: "area", unit: "Sft", color: "#2a78d6", h: "", t: "", faces: 1, dedMin: 0});
    const it = (id, pts, kind, label) => P.items.push({id, cond: "CF", file: f, page: 1, kind, pts, nos: 1, label});
    it("IB", big, "shape", "HALL"); it("D1", c1, "ded", ""); it("D2", c2, "ded", ""); it("D3", c3, "ded", "");
    Z.S.cond = "CF"; Z.save(); Z.refresh(); },
    [sq(100, 100, 360, 270), sq(150, 330, 27, 27), sq(185, 330, 27, 27), sq(220, 330, 27, 27)]);

  console.log("PlanSwift's labels (the default)");
  ok(await T(() => { const o = zdTakeoff.S.lbl; return o.style === "ps" && o.show === "nameqty" && o.lenSel === true; }), "by default labels are PlanSwift's: a name + quantity tag, a run's only when it is clicked");
  ok(await T(() => { const o = zdTakeoff.S.lbl; return o.fit === "smart" && o.collide === "hide" && o.lenAlong === true && o.shortName === true && o.minPx === 9 && o.maxPx === 14; }), "…sized smart (9 – 14 px on screen), a covered label finds a free spot or hides, lengths along the run, short names");
  await setLbl({fit: "drawing", lenAlong: false});   // (the PlanSwift preset: sized on the building, a run's tag beside it — checked first)
  /* a wall run 40 ft long (360 pt) under the hall */
  await T(() => { const Z = zdTakeoff, P = Z.P.proj; P.conds.push({id: "CW", name: "Wall", type: "linear", unit: "ft", color: "#2222ff", h: "", t: "", faces: 1, dedMin: 0});
    P.items.push({id: "IW", cond: "CW", file: Z.S.fileId, page: 1, kind: "shape", pts: [[100, 430], [460, 430]], nos: 1}); Z.refresh(); });
  /* the tags drawn now: their lines, text size / weight / font, the box's fill, opacity, border, corners, and whether every line is inside the box */
  const tags = () => T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => { const r = g.querySelector("rect"), t = [...g.querySelectorAll("text")], rb = r && r.getBBox(), tb = t.map(x => x.getBBox());
    return {s: t.map(x => x.textContent), fs: +t[0].getAttribute("font-size"), fw: t[0].getAttribute("font-weight"), ff: t[0].getAttribute("font-family"), fill: r && r.getAttribute("fill"), op: r && r.getAttribute("fill-opacity"),
      stroke: r && r.getAttribute("stroke"), rx: r && r.getAttribute("rx"), fits: !!rb && tb.every(b => b.x >= rb.x - 0.5 && b.x + b.width <= rb.x + rb.width + 0.5 && b.y >= rb.y - 0.5 && b.y + b.height <= rb.y + rb.height + 0.5)}; }));
  const tagOf = async n => (await tags()).find(x => x.s[0] === n);
  await zoomTo(1); let P0 = await tags(), hallT = P0.find(x => x.s[0] === "HALL");
  ok(hallT && hallT.s.join(" / ") === "HALL / 1,200.00 SQ FT", "an area's tag: its name over its quantity, as PlanSwift writes it (" + (hallT && hallT.s.join(" / ")) + ")");
  ok(hallT && hallT.fill === "#dfbf2a" && hallT.op === "1.00" && hallT.stroke === "#000000" && !hallT.rx && hallT.fw === "400" && /^Arial/.test(hallT.ff),
    "…a solid yellow tag (#dfbf2a) with a black border and square corners, its text plain black Arial (" + JSON.stringify(hallT && [hallT.fill, hallT.op, hallT.stroke, hallT.rx, hallT.fw, hallT.ff]) + ")");
  ok(hallT && hallT.fits, "…every line inside the tag (the tag is measured to its text)");
  await setLbl({small: false}); const cutT = (await tags()).filter(x => x.s[0] !== "HALL" && x.s[0] !== "Wall"); await setLbl({small: true});
  ok(cutT.length && cutT.every(x => x.s.length === 1 && x.s[0] === "-9.00 SQ FT"), "a cut-out's tag shows its quantity (3 × 3 ft, with “hide labels on small shapes” off): " + JSON.stringify(cutT.map(x => x.s)));
  ok(!P0.some(x => x.s[0] === "Wall"), "a run (wall) shows no label until it is clicked (" + P0.map(x => x.s[0]).join(", ") + ")");
  ok(hallT && near(hallT.fs, 0.85 * 9, 0.06), "sized on the building: its text 0.85 ft high at the drawing's 1/8\" = 1'-0\" (9 pt per ft), 7.65 px at 100 % (" + (hallT && hallT.fs) + ")");
  await zoomTo(2); hallT = await tagOf("HALL");
  ok(hallT && near(hallT.fs, 0.85 * 9 * 2, 0.06), "…twice that at 200 %, in step with the drawing (" + (hallT && hallT.fs) + " px)");
  await zoomTo(0.3); hallT = await tagOf("HALL");
  ok(hallT && near(hallT.fs, 0.85 * 9 * 0.3, 0.06), "zoomed out to 30 % the tag stays, small, as in PlanSwift's whole-sheet view (" + (hallT && hallT.fs) + " px)");
  await zoomTo(0.2); ok(!(await tagOf("HALL")), "…and below a 2 px speck it is left out (20 %)");
  await zoomTo(1); await page.keyboard.press("v");
  const runAt = await T(() => { const Z = zdTakeoff, v = Z.S.view, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + 300 * v.s + v.tx, r.top + 430 * v.s + v.ty]; });
  await page.mouse.click(runAt[0], runAt[1]); await wait(250);
  let wallT = await tagOf("Wall");
  ok((await T(() => zdTakeoff.S.sel)) === "IW" && wallT && wallT.s.join(" / ") === "Wall / 40.00 FT", "a click on the run shows its length: " + (wallT && wallT.s.join(" / ")));
  await page.mouse.click(runAt[0] + 140, runAt[1] - 35); await wait(250);   // (beside the tag: a click on a label selects its object)
  ok(!(await T(() => zdTakeoff.S.sel)) && !(await tagOf("Wall")), "…a click elsewhere hides it again");
  const ex = await T(() => { const Z = zdTakeoff, b = Z.S.base; return Z.pageOverlaySvg(Z.S.fileId, Z.S.pageNo, 2, b.width * 2, b.height * 2, {legend: "none"}); });
  ok(/font-size="15\.3"[^>]*>HALL<\/text>/.test(ex) && />1,200\.00 SQ FT<\/text>/.test(ex) && /fill="#dfbf2a"/.test(ex) && !/>Wall<\/text>/.test(ex), "the marked-up export draws the same: the area's tag at the drawing's size, no run label");
  await setLbl({lenSel: false}); wallT = await tagOf("Wall");
  ok(wallT && wallT.s.join(" / ") === "Wall / 40.00 FT", "View → Labels “only on the run clicked” off: every run shows its length"); await setLbl({lenSel: true});
  await page.click('[data-rtab="view"]'); await wait(150); await page.click("#rbLblMenu"); await wait(150);
  const mi0 = await page.locator("#ctx .ci").allInnerTexts();
  ok(mi0.some(t => /✓\s*Style: PlanSwift/.test(t)) && mi0.some(t => /Style: Classic/.test(t)) && mi0.some(t => /✓\s*Lengths only on the run clicked/.test(t)), "⚙ by Labels: Style PlanSwift (ticked) or Classic, Lengths only on the run clicked (ticked)");
  await page.locator("#ctx .ci", {hasText: "Style: Classic"}).first().click(); await wait(200); hallT = await tagOf("HALL");
  ok(hallT && hallT.fill === "#ffffff" && near(hallT.fs, 11.5, 0.06) && hallT.s[1] === "1,200.000 Sft", "Style: Classic brings the white box back: 11.5 px at 100 %, 1,200.000 Sft (" + JSON.stringify(hallT && [hallT.fill, hallT.fs, hallT.s]) + ")");
  await page.click('[data-rtab="takeoff"]'); await wait(150);
  await T(() => { const Z = zdTakeoff, P = Z.P.proj; P.items = P.items.filter(i => i.id !== "IW"); P.conds = P.conds.filter(c => c.id !== "CW"); Z.S.sel = null; Z.refresh(); });

  console.log("Classic labels");
  await setLbl({on: true, small: false, zoom: true, declutter: true, name: true, qty: true, style: "box", show: "full", fit: "drawing"});

  console.log("labels follow the zoom");
  await zoomTo(1); let L = await labels(); const hall1 = L.find(x => x.s === "HALL");
  ok(hall1 && near(hall1.fs, 11.5, 0.06), "at 100 % a label is its set size (11.5 px): " + (hall1 && hall1.fs));
  await zoomTo(2); L = await labels(); const hall2 = L.find(x => x.s === "HALL");
  ok(hall2 && near(hall2.fs, 23, 0.06), "at 200 % it is twice the size, as the drawing's text (" + (hall2 && hall2.fs) + " px)");
  await zoomTo(6); L = await labels(); const hall6 = L.find(x => x.s === "HALL");
  ok(hall6 && near(hall6.fs, 11.5 * 6, 0.06), "zoomed far in (600 %) it keeps in step with the drawing, as Bluebeam's: 6 × (" + (hall6 && hall6.fs) + " px)");
  await zoomTo(0.7); L = await labels(); const hall07 = L.find(x => x.s === "HALL");
  ok(hall07 && near(hall07.fs, 11.5 * 0.7, 0.06), "at 70 % it is 0.7 × (" + (hall07 && hall07.fs) + " px) — smaller with the drawing, never larger");
  await shot("70pct");
  await zoomTo(0.3); L = await labels();
  ok(L.length === 0, "at 30 % (3.5 px text) no label is drawn — too small to read, so it does not clutter (" + L.length + ")");
  await T(() => { zdTakeoff.S.sel = "IB"; zdTakeoff.refresh(); }); await wait(200); L = await labels();
  ok(L.length === 1 && L[0].s === "HALL" && L[0].fs >= 9.7, "…but the selected object's label stays readable (" + (L[0] && L[0].fs) + " px)");
  await T(() => { zdTakeoff.S.sel = null; zdTakeoff.refresh(); }); await wait(150);

  console.log("labels do not cover one another");
  await zoomTo(1); L = await labels();
  const ded = L.filter(x => x.s !== "HALL");
  ok(L.some(x => x.s === "HALL") && ded.length >= 1 && ded.length < 3, "three cut-outs closer than their labels: " + ded.length + " of 3 labelled, HALL's label kept");
  const boxes = await T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => { const r = g.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]));
  ok(!overlap, "no two labels on screen overlap");
  await shot("declutter");
  await setLbl({declutter: false}); L = await labels();
  ok(L.filter(x => x.s !== "HALL").length === 3, "View → Labels “leave out a label that would cover another” off: all 3 cut-out labels shown");
  await setLbl({declutter: true});

  console.log("one size when asked");
  await setLbl({zoom: false});
  const sizes = [];
  for (const s of [0.3, 1, 3]) { await zoomTo(s); const x = (await labels()).find(y => y.s === "HALL"); sizes.push(x ? x.fs : 0); }
  ok(sizes.every(v => near(v, 11.5, 0.06)), "“grow and shrink with the zoom” off: 11.5 px at 30 %, 100 % and 300 % (" + sizes.join(", ") + ")");
  await setLbl({zoom: true});

  console.log("what the labels show (View ribbon → ⚙ by Labels, Cut-out labels)");
  await zoomTo(1); await setLbl({declutter: false});
  const groups = () => T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => [...g.querySelectorAll("text")].map(t => t.textContent)));
  const menu = async item => { await page.click("#rbLblMenu"); await wait(150); await page.locator("#ctx .ci", {hasText: item}).first().click(); await wait(200); };
  let G0 = await groups(), cut = G0.filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.length === 1 && /^-9\.000 Sft$/.test(g[0])), "a cut-out's label shows its quantity only by default (" + JSON.stringify(cut[0]) + ")");
  await page.click('[data-rtab="view"]'); await wait(200);
  ok(await page.isVisible("#rbLblMenu") && await page.isVisible("#rbLblDed") && (await page.innerText("#rbLblDed")).trim() === "Cut-outs", "the View ribbon has ⚙ label options and a Cut-outs (labels) button beside Labels");
  const oneRow = await T(() => { const g = [...document.querySelectorAll('[data-rp="view"] .rg')].filter(x => x.offsetParent); return new Set(g.map(x => Math.round(x.getBoundingClientRect().top))).size; });
  ok(oneRow === 1, "the View ribbon still fits on one row at 1440 px (" + oneRow + " row" + (oneRow > 1 ? "s" : "") + ")");
  ok(await T(() => document.getElementById("rbLblDed").classList.contains("on")), "Cut-out labels shows on");
  await page.click("#rbLblMenu"); await wait(150);
  const items = await page.locator("#ctx .ci").allInnerTexts();
  ok(["Labels: full", "Labels: name + qty", "Labels: qty only", "Labels: name only", "Cut-outs: full", "Cut-outs: name + qty", "Cut-outs: qty only", "Cut-outs: hidden", "Follow the zoom", "No overlap", "More label settings"].every(t => items.some(x => x.indexOf(t) >= 0)),
    "⚙ lists what labels and cut-out labels show, Follow the zoom, No overlap and More label settings");
  ok(items.some(x => /✓\s*Cut-outs: qty only/.test(x)) && items.some(x => /✓\s*Labels: full/.test(x)), "…with the current choices ticked (Labels: full, Cut-outs: qty only)");
  await page.keyboard.press("Escape"); await T(() => document.getElementById("ctx").classList.remove("on"));
  await menu("Cut-outs: name + qty"); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.length === 2 && g[0] === "Cut-out" && /^-9\.000 Sft$/.test(g[1])), "Cut-outs: name + qty → “Cut-out / -9.000 Sft”");
  await menu("Cut-outs: full"); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut.every(g => g.some(t => /^P 12\.000 ft$/.test(t))), "Cut-outs: full → with its perimeter, as the Labels ticks say");
  await page.click("#rbLblDed"); await wait(200); G0 = await groups();
  ok(G0.length === 1 && G0[0][0] === "HALL" && !(await T(() => document.getElementById("rbLblDed").classList.contains("on"))), "Cut-out labels button off — only HALL is labelled");
  ok((await T(() => zdTakeoff.condTotals(zdTakeoff.P.proj.conds.find(c => c.id === "CF")).net)) === 1173, "…the cut-outs still count: net 1,200 − 27 = 1,173 Sft");
  await page.click("#rbLblDed"); await wait(200); cut = (await groups()).filter(g => !g.includes("HALL"));
  ok(cut.length === 3 && cut[0].some(t => /^P 12\.000 ft$/.test(t)), "…on again: back to the detail chosen before (full)");
  await menu("Cut-outs: hidden"); G0 = await groups();
  ok(G0.length === 1 && !(await T(() => document.getElementById("rbLblDed").classList.contains("on"))), "Cut-outs: hidden in ⚙ does the same, and the button follows");
  await page.click("#rbLblDed"); await wait(200);
  await menu("Labels: qty only"); G0 = await groups();
  ok(G0.some(g => g.length === 1 && g[0] === "1,200.000 Sft"), "Labels: qty only → the hall reads just 1,200.000 Sft");
  await menu("Labels: name only"); G0 = await groups();
  ok(G0.some(g => g.length === 1 && g[0] === "HALL"), "Labels: name only → HALL");
  await menu("Labels: name + qty"); G0 = await groups();
  ok(G0.some(g => g.length === 2 && g[0] === "HALL" && g[1] === "1,200.000 Sft"), "Labels: name + qty → HALL / 1,200.000 Sft (no perimeter)");
  await menu("Labels: full"); await menu("Cut-outs: qty only");
  await menu("Follow the zoom");
  ok((await T(() => zdTakeoff.S.lbl.zoom)) === false, "⚙ Follow the zoom turns zoom-sized labels off");
  await menu("Follow the zoom"); await menu("No overlap");
  ok((await T(() => zdTakeoff.S.lbl.zoom && zdTakeoff.S.lbl.declutter)) === true, "…and on again; ⚙ No overlap turns the overlap rule on");
  const kept = await T(() => JSON.parse(localStorage.getItem("zdTakeoffLbl") || "{}"));
  ok(kept.show === "full" && kept.dedShow === "qty" && kept.zoom === true && kept.declutter === true, "the choices are kept for the next visit");
  await page.click('[data-rtab="takeoff"]'); await wait(150);

  console.log("the Labels dialog and the hover tip");
  await T(() => document.getElementById("bLblSet").click()); await wait(300);
  const dlg = await T(() => ({fit: (document.querySelector('[data-lbs="fit"]') || {}).value, col: (document.querySelector('[data-lbs="collide"]') || {}).value, pre: document.querySelectorAll("[data-lbp]").length,
    mn: !!document.querySelector('[data-lbr="minPx"]') && !!document.querySelector('[data-lbr="maxPx"]'), along: !!document.querySelector('[data-lb="lenAlong"]'), short: !!document.querySelector('[data-lb="shortName"]'),
    show: (document.querySelector('[data-lbs="show"]') || {}).value, ded: (document.querySelector('[data-lbs="dedShow"]') || {}).value}));
  ok(dlg.fit === "drawing" && dlg.col === "hide" && dlg.pre === 7 && dlg.mn && dlg.along && dlg.short, "View → Labels: size on screen (with the drawing, as set), when labels meet (hide), 7 presets, min – max px, along the run, short names " + JSON.stringify(dlg));
  ok(dlg.show === "full" && dlg.ded === "qty", "…and “every label shows” (full) and “cut-out / deduction labels show” (qty only)");
  await page.keyboard.press("Escape"); await wait(200);
  await zoomTo(0.3); await page.keyboard.press("v");
  const c = await T(() => { const Z = zdTakeoff, v = Z.S.view, r = document.getElementById("stage").getBoundingClientRect(); return [r.left + 400 * v.s + v.tx, r.top + 160 * v.s + v.ty]; });
  await page.mouse.move(c[0], c[1]); await page.mouse.move(c[0] + 2, c[1] + 1); await wait(300);
  const hv = await page.innerText("#tip").catch(() => "");
  ok(/HALL|Floor area/.test(hv) && (await labels()).length === 0, "zoomed out with no labels drawn, hovering still names the object (" + hv.trim().replace(/\s+/g, " ") + ")");

  console.log("moving a label (Bluebeam)");
  await zoomTo(1); await page.keyboard.press("v"); await setLbl({declutter: true}); await wait(150);
  const lblBox = name => T(n => { const g = [...document.querySelectorAll("#ov g.aplbl")].find(x => x.querySelector("text").textContent === n); if (!g) return null; const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, name);
  const itm = id => T(id => { const i = zdTakeoff.P.proj.items.find(x => x.id === id); return i ? {lo: i.lo || null, locked: !!i.locked} : null; }, id);
  let c0 = await lblBox("HALL");
  await page.mouse.move(c0[0], c0[1]); await page.mouse.move(c0[0] + 1, c0[1]); await wait(150);
  ok((await T(() => document.getElementById("stage").style.cursor)) === "move", "over a label the cursor shows move");
  await page.mouse.down(); for (let i = 1; i <= 6; i++) { await page.mouse.move(c0[0] + 1 + 25 * i, c0[1] - 10 * i); await wait(20); } await page.mouse.up(); await wait(250);
  let m1 = await itm("IB"), c1 = await lblBox("HALL");
  ok(m1.lo && Math.abs(m1.lo[0] - 150) < 3 && Math.abs(m1.lo[1] + 60) < 3, "dragging HALL's label 150 px right, 60 up keeps it there (offset " + JSON.stringify(m1.lo) + " pt at 100 %)");
  ok(c1 && Math.abs(c1[0] - c0[0] - 151) < 4 && Math.abs(c1[1] - c0[1] + 60) < 4, "…the label is drawn where it was dropped");
  ok((await T(() => zdTakeoff.S.sel)) === "IB", "…and its object is selected (a label is part of its object)");
  const leadOf = () => T(() => { const g = document.querySelector("#ov g.aplead"), t = [...document.querySelectorAll("#ov g.aplbl")].find(x => x.querySelector("text").textContent === "HALL"); if (!g || !t) return null; const c = g.querySelector("circle"), l = g.querySelector("line"), r = t.querySelector("rect").getBBox();
    const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"), x2 = +l.getAttribute("x2"), y2 = +l.getAttribute("y2");
    return {d: Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy), edge: Math.abs(x2 - r.x) < 1 || Math.abs(x2 - r.x - r.width) < 1 || Math.abs(y2 - r.y) < 1 || Math.abs(y2 - r.y - r.height) < 1}; });
  const L1 = await leadOf(), lead1 = L1 ? L1.d : 0;
  ok(lead1 > 150 && L1.edge, "moved away from its room it gets a dashed leader back to it, ending at the tag's edge (" + Math.round(lead1) + " px)"); await shot("moved");
  await zoomTo(2);
  const lead2 = ((await leadOf()) || {}).d || 0;
  ok(Math.abs(lead2 - 2 * lead1) < 4, "at 200 % it sits twice as far from its room — it stays put on the drawing (" + Math.round(lead2) + " px)");
  await zoomTo(1);
  await page.keyboard.press("Control+z"); await wait(250);
  ok(!(await itm("IB")).lo && !(await T(() => !!document.querySelector("#ov g.aplead"))), "Ctrl+Z puts the label back in its room");
  await page.keyboard.press("Control+y"); await wait(250);
  ok((await itm("IB")).lo, "Ctrl+Y moves it again");
  await T(() => { const Z = zdTakeoff, d = Z.P.proj.items.find(x => x.id === "D3"); d.lo = [0, 45]; Z.refresh(); }); await wait(200);
  const ids = await T(() => (zdTakeoff.S.lblBoxes || []).map(b => b.id));
  ok(ids.includes("D3") && ids.filter(x => /^D/.test(x)).length >= 2, "a cut-out label moved by hand is always shown, even with No overlap on (" + ids.join(", ") + ")");
  c1 = await lblBox("HALL"); await page.mouse.click(c1[0], c1[1], {button: "right"}); await wait(250);
  ok(/Reset label position/.test(await page.innerText("#ctx")), "right-click on the moved label offers Reset label position");
  await page.locator("#ctx .ci", {hasText: "Reset label position"}).first().click(); await wait(250);
  ok(!(await itm("IB")).lo, "…which puts it back in its room");
  await page.click('[data-rtab="view"]'); await wait(150); await page.click("#rbLblMenu"); await wait(150);
  await page.locator("#ctx .ci", {hasText: "Labels moved by hand back into their objects"}).first().click(); await wait(250);
  ok(!(await itm("D3")).lo, "⚙ → Labels moved by hand back into their objects resets the page's (the cut-out too)");
  await page.click('[data-rtab="takeoff"]'); await wait(150);
  await T(() => { const Z = zdTakeoff; Z.P.proj.items.find(x => x.id === "IB").locked = true; Z.S.sel = null; Z.refresh(); }); await wait(200);
  c0 = await lblBox("HALL"); await page.mouse.move(c0[0], c0[1]); await page.mouse.down(); await page.mouse.move(c0[0] + 80, c0[1] + 40, {steps: 5}); await page.mouse.up(); await wait(200);
  ok(!(await itm("IB")).lo, "a locked object's label does not move");
  await T(() => { const Z = zdTakeoff; Z.P.proj.items.find(x => x.id === "IB").locked = false; Z.refresh(); }); await wait(150);

  console.log("label sizes ( [ ] keys, ⚙, the Labels dialog)");
  await page.mouse.click(5, 300); await zoomTo(1);   // focus out of any field; a click in empty space selects nothing
  const fsOf = async () => { const L = await labels(); return {hall: (L.find(x => x.s === "HALL") || {}).fs, cut: (L.find(x => /^-9\.000/.test(x.s)) || {}).fs}; };
  let f = await fsOf(); ok(Math.abs(f.hall - 11.5) < 0.06 && Math.abs(f.cut - 11.5) < 0.06, "both at 100 % (" + f.hall + ", " + f.cut + " px)");
  await page.keyboard.press("BracketRight"); await wait(200); f = await fsOf();
  ok(Math.abs(f.hall - 11.5 * 1.15) < 0.06 && Math.abs(f.cut - 11.5 * 1.15) < 0.06, "] makes every label bigger: 115 % (" + f.hall + " px)");
  await page.keyboard.press("Shift+BracketRight"); await wait(200); f = await fsOf();
  ok(Math.abs(f.hall - 11.5 * 1.15) < 0.06 && Math.abs(f.cut - 11.5 * 1.15 * 1.15) < 0.06, "Shift+] makes only the cut-out labels bigger (" + f.cut + " px, HALL stays " + f.hall + ")");
  await page.keyboard.press("BracketLeft"); await page.keyboard.press("BracketLeft"); await wait(200); f = await fsOf();
  ok(Math.abs(f.hall - 11.5 * 0.9) < 0.06, "[ [ makes them smaller: 90 % (" + f.hall + " px)");
  await page.click('[data-rtab="view"]'); await wait(150); await page.click("#rbLblMenu"); await wait(150);
  const mi = await page.locator("#ctx .ci").allInnerTexts();
  ok(mi.some(t => /A\+ Labels bigger/.test(t) && /90 %/.test(t)) && mi.some(t => /A− Labels smaller/.test(t)) && mi.some(t => /A\+ Cut-out labels bigger/.test(t) && /115 %/.test(t)) && mi.some(t => /A− Cut-out labels smaller/.test(t)), "⚙ has A+ / A− for labels and for cut-out labels, with their sizes");
  await page.locator("#ctx .ci", {hasText: "Label sizes back to 100 %"}).first().click(); await wait(200); f = await fsOf();
  ok(Math.abs(f.hall - 11.5) < 0.06 && Math.abs(f.cut - 11.5) < 0.06, "“Label sizes back to 100 %”");
  await page.click("#rbLblMenu"); await wait(150); await page.locator("#ctx .ci", {hasText: "A+ Cut-out labels bigger"}).first().click(); await wait(200); f = await fsOf();
  ok(Math.abs(f.cut - 11.5 * 1.15) < 0.06 && Math.abs(f.hall - 11.5) < 0.06, "⚙ A+ Cut-out labels bigger (" + f.cut + " px)");
  await page.click('[data-rtab="takeoff"]'); await wait(150);
  await T(() => document.getElementById("bLblSet").click()); await wait(300);
  await page.fill('[data-lbn="scale"]', "150"); await page.fill('[data-lbn="dedScale"]', "80"); await page.click("#dlgOk"); await wait(300); f = await fsOf();
  ok(Math.abs(f.hall - 11.5 * 1.5) < 0.06 && Math.abs(f.cut - 11.5 * 1.5 * 0.8) < 0.06, "the Labels dialog sets them in %: labels 150 %, cut-outs 80 % of that (" + f.hall + ", " + f.cut + " px)");
  const kept2 = await T(() => JSON.parse(localStorage.getItem("zdTakeoffLbl") || "{}"));
  ok(kept2.scale === 1.5 && kept2.dedScale === 0.8, "the sizes are kept for the next visit");
  await setLbl({scale: 1, dedScale: 1});

  console.log("labels set before PlanSwift's");
  await T(() => localStorage.setItem("zdTakeoffLbl", JSON.stringify({on: true, show: "full", dedShow: "qty", zoom: true, declutter: true, v2: 1})));
  await page.reload({waitUntil: "load"}); await wait(900);
  ok(await T(() => { const o = zdTakeoff.S.lbl; return o.style === "ps" && o.show === "nameqty" && o.lenSel === true && o.v3 === 1 && o.dedShow === "qty"; }), "labels set before this are switched to PlanSwift's once (name + qty, a run's when clicked), the rest kept");

  ok(await T(() => { const o = zdTakeoff.S.lbl; return o.v4 === 1 && o.fit === "smart" && o.collide === "hide" && o.declutter === true && o.lenAlong === true && o.shortName === true; }), "…and to the professional labels once (smart size, no overlaps, lengths along the run, short names)");

  console.log("professional labels (the default since 17-Nov-2026)");
  await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.P.proj && zdTakeoff.P.proj.items.some(i => i.id === "IB"), null, {timeout: 20000});
  await page.click('[data-rtab="view"]'); await wait(150); await page.click("#rbLblMenu"); await wait(150);
  await page.locator("#ctx .ci", {hasText: "Preset"}).first().hover(); await wait(150);
  const pres = await page.locator("#ctx .ci .cm .ci").allInnerTexts();
  ok(["Professional", "PlanSwift", "Bluebeam", "AutoCAD", "Colour tags", "Minimal", "Every label shown"].every(t => pres.some(x => x.indexOf(t) >= 0)), "⚙ → Preset lists the 7 looks (" + pres.length + ")");
  await page.locator("#ctx .ci .cm .ci", {hasText: "Professional"}).first().click(); await wait(250);
  ok(await T(() => zdTakeoff.S.lbl.preset === "pro" && zdTakeoff.S.lbl.fit === "smart"), "Preset → Professional sets the whole look");
  const hallFs = async s => { await zoomTo(s); const x = (await labels()).find(y => y.s === "HALL"); return x ? x.fs : 0; };
  const fz = [await hallFs(0.3), await hallFs(1), await hallFs(6)];
  ok(near(fz[0], 9, 0.06) && near(fz[1], 9, 0.06) && near(fz[2], 14, 0.06), "smart size: 9 px zoomed out (30 %), 9 px at 100 % (7.65 on the building → kept readable), 14 px at 600 % — never a speck, never huge (" + fz.join(", ") + ")");
  await setLbl({minPx: 10, maxPx: 12}); const fz2 = [await hallFs(0.3), await hallFs(6)];
  ok(near(fz2[0], 10, 0.06) && near(fz2[1], 12, 0.06), "…the smallest / largest size are settings (10 – 12: " + fz2.join(", ") + ")"); await setLbl({minPx: 9, maxPx: 14});
  await zoomTo(1);
  /* three cut-outs closer than their labels, all selected: before, every selected label was drawn over the others */
  await T(() => { zdTakeoff.setSel(["D1", "D2", "D3", "IB"]); zdTakeoff.refresh(); }); await wait(200);
  const boxesNow = () => T(() => [...document.querySelectorAll("#ov g.aplbl")].map(g => { const r = g.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overl = B => B.some((a, i) => B.some((b, j) => j > i && a[0] < b[2] - 0.5 && a[2] > b[0] + 0.5 && a[1] < b[3] - 0.5 && a[3] > b[1] + 0.5));
  let B = await boxesNow(); ok(B.length >= 2 && !overl(B), "several objects selected: their labels are still placed without overlaps (" + B.length + " labels)");
  await T(() => { zdTakeoff.setSel([]); zdTakeoff.refresh(); }); await wait(150);
  await setLbl({collide: "move", small: false}); B = await boxesNow();
  const leads = await T(() => document.querySelectorAll("#ov g.aplead").length);
  ok(B.length === 4 && !overl(B) && leads >= 1, "When labels meet → move aside: all 4 labels shown, none on another, " + leads + " with a leader line");
  await setLbl({collide: "hide", small: true});
  await setLbl({minQty: 10, small: false}); let G1 = await groups();
  ok(G1.length === 1 && G1[0][0] === "HALL", "No label under 10: the 9 Sft cut-outs are left unlabelled, HALL kept (" + G1.length + ")"); await setLbl({minQty: 0, small: true});
  /* runs: written along the run, a vertical one reading bottom to top; a floor's own condition by its short name */
  await T(() => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, pk = f + ":1"; (P.floors = P.floors || {})[pk] = [{name: "Ground floor"}];
    P.conds.push({id: "CP", name: "Plaster — Ground floor", src: "CP0", fl: "Ground floor", flpk: pk, type: "linear", unit: "ft", color: "#5a3fb0", h: "", t: "", faces: 1, dedMin: 0});
    P.items.push({id: "IV", cond: "CP", file: f, page: 1, kind: "shape", pts: [[520, 100], [520, 460]], nos: 1, floor: "Ground floor"}, {id: "IH", cond: "CP", file: f, page: 1, kind: "shape", pts: [[100, 500], [460, 500]], nos: 1, floor: "Ground floor"});
    Z.S.lbl = Object.assign({}, Z.S.lbl, {lenSel: false}); Z.refresh(); }); await wait(250);
  const runs = await T(() => [...document.querySelectorAll("#ov g.aplbl")].filter(g => /Plaster/.test(g.textContent)).map(g => ({s: [...g.querySelectorAll("text")].map(t => t.textContent), rot: (g.parentElement.getAttribute("transform") || "").replace(/^rotate\(([-\d.]+).*$/, "$1")})));
  ok(runs.length === 2 && runs.every(r => r.s.length === 1 && r.s[0] === "Plaster · 40.00 FT"), "a run's label: one line along it, its condition's short name (" + JSON.stringify(runs.map(r => r.s)) + ")");
  ok(runs.some(r => r.rot === "-90.00") && runs.some(r => r.rot === ""), "…the vertical run's turned to read bottom to top (−90°), the level one level (" + runs.map(r => r.rot || "0").join(", ") + ")");
  await setLbl({shortName: false}); ok((await T(() => [...document.querySelectorAll("#ov g.aplbl")].some(g => /Plaster — Ground floor/.test(g.textContent)))), "Short names off: “Plaster — Ground floor”"); await setLbl({shortName: true});
  await setLbl({lenAlong: false}); const tagR = await T(() => [...document.querySelectorAll("#ov g.aplbl")].filter(g => /Plaster/.test(g.textContent)).map(g => g.querySelectorAll("text").length));
  ok(tagR.length === 2 && tagR.every(n => n === 2), "Along the run off: a two-line tag beside it, as PlanSwift (" + JSON.stringify(tagR) + ")"); await setLbl({lenAlong: true});
  /* the looks */
  await setLbl({style: "tag"}); let H = await tagOf("HALL");
  ok(H && H.fill !== "#dfbf2a" && H.fill !== "#ffffff" && H.stroke === "#2a78d6", "Style: Colour tag — a light tint of the condition's colour, its colour as the border (" + JSON.stringify(H && [H.fill, H.stroke]) + ")");
  await setLbl({style: "clean"}); const cl = await T(() => { const g = [...document.querySelectorAll("#ov g.aplbl")].find(x => x.querySelector("text").textContent === "HALL"); return g && {rect: !!g.querySelector("rect"), halo: g.querySelector("text").getAttribute("stroke"), fw: g.querySelector("text").getAttribute("font-weight")}; });
  ok(cl && !cl.rect && cl.halo === "#fff" && cl.fw === "700", "Style: CAD text — no box, bold text with a white halo " + JSON.stringify(cl));
  await setLbl({style: "ps"});
  /* the marked-up export places its labels the same way */
  const ex2 = await T(() => { const Z = zdTakeoff, b = Z.S.base; return Z.pageOverlaySvg(Z.S.fileId, Z.S.pageNo, 1, b.width, b.height, {legend: "none"}); });
  const nCut = (ex2.match(/>-9\.00 SQ FT</g) || []).length;
  ok(/>HALL</.test(ex2) && nCut >= 1 && nCut < 3, "the marked-up export leaves out a covered cut-out label too (" + nCut + " of 3), HALL kept");
  /* Settings › Labels */
  await T(() => { zdTakeoff.settingsDialog("labels"); }); await wait(400);   // (not awaited: it resolves when the window closes)
  const st = await T(() => document.getElementById("dlgB") ? document.getElementById("dlgB").innerText : "");
  ok(/Size on screen/.test(st) && /When labels meet/.test(st) && /Lengths written along the run/.test(st) && /Short names/.test(st) && /Preset/.test(st), "Settings › Labels has the same options");
  await page.keyboard.press("Escape"); await wait(200);

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

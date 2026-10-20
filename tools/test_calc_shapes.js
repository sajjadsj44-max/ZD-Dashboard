#!/usr/bin/env node
/* Browser tests for the QS / Engineering Calculator shape engine: Concrete (PCC / RCC) with 19 element shapes and
   Area & Volume — Any Shape (13 plane figures, 17 solids).

     python3 -m http.server 8765 --bind 127.0.0.1 &   # from the repo root
     node tools/test_calc_shapes.js                   # needs playwright (npm i -g playwright)

   CS_URL    page to test (default http://127.0.0.1:8765/zameen-developments/index.html)
   CS_SHOTS  folder for screenshots of every shape diagram (optional)

   Checks every shape against a hand calculation; additions, circular deductions, wastage, mix materials, water, steel
   (kg/m³ and %), self-weight, transit-mixer loads and amount; the error messages for impossible shapes; every BOQ item
   and every calculator still runs; in the page itself, the shape menu (grouped), the fields and the diagram of every
   shape, coordinate rows following a unit change, the phone-width layout, and that no page errors occur. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.CS_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
const SHOTS = process.env.CS_SHOTS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
function near(a, b, tol){ return a != null && Math.abs(a - b) <= (tol == null ? 1e-3 * Math.max(1, Math.abs(b)) : tol); }
const CFT = 0.028316846592, SFT = 0.09290304, FT = 0.3048, PI = Math.PI;

(async () => {
  const browser = await pw.chromium.launch({});
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
  const errors = [];
  await ctx.route(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|docs\.google\.com|fonts\.g/, route => {
    if (/chart\.js/.test(route.request().url())) return route.fulfill({body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript"});
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "domcontentloaded"});
  await page.evaluate(() => localStorage.clear());
  await page.reload({waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.zdCalc && window.zdCalc.calcs().indexOf("geo") >= 0, null, {timeout: 20000});

  /* run a calculator headless: {id, vals, units, rows} → {errs, warns, notes, res: {label: SI value}, steps, sh} */
  const run = cases => page.evaluate(cs => cs.map(c => {
    const R = zdCalc.run(c.id, st => { Object.assign(st.vals, c.vals || {}); Object.assign(st.units, c.units || {}); Object.keys(c.rows || {}).forEach(k => { st.rows[k] = c.rows[k]; }); });
    const res = {}; R.results.forEach(r => { res[r.l] = r.v; });
    return {errs: R.errs, warns: R.warns, notes: R.notes, res, steps: R.steps.map(s => s.t), sh: R.shape && R.shape.sh, el: R.shape && R.shape.p && R.shape.p.el};
  }), cases);
  const vol = r => r.res["Concrete volume (wet)"] / CFT;

  console.log("Concrete — every shape against a hand calculation (CFT)");
  const C = (el, vals, units) => ({id: "concrete", vals: Object.assign({el, mix: "none"}, vals), units});
  const shapes = [
    ["rect", {}, 100, "Rectangular 20 × 10 × 0.5"],
    ["circ", {n: 10, dia: 1.5, D: 10}, 10 * PI / 4 * 2.25 * 10, "10 circular columns Ø1.5 × 10"],
    ["ring", {dia: 12, di: 11, D: 8}, PI / 4 * (144 - 121) * 8, "Ring Do 12, Di 11, H 8"],
    ["hrect", {L: 10, W: 8, t: 0.75, D: 6}, (80 - 8.5 * 6.5) * 6, "Hollow rectangle 10 × 8, t 0.75, H 6"],
    ["poly", {ns: 8, s: 1, D: 10}, 8 / (4 * Math.tan(PI / 8)) * 10, "Octagon s 1, H 10"],
    ["ellipse", {L: 4, W: 2, D: 1}, PI * 2 * 1, "Ellipse 4 × 2 × 1"],
    ["sector", {ro: 10, ri: 9, ang: 90, D: 10}, 0.25 * PI * (100 - 81) * 10, "Annular sector R 10, r 9, 90°, H 10"],
    ["segment", {ch: 12, rise: 3, D: 0.5}, 28.125 * (2 * Math.atan2(6, 4.5) - 0.96) * 0.5, "Segment c 12, h 3 (R 7.5), t 0.5"],
    ["xy", {D: 0.5}, 296 * 0.5, "Irregular plan (default 5 points: 320 − 24 = 296 SFT) × 0.5"],
    ["area", {A: 250, D: 0.5}, 125, "Known area 250 SFT × 0.5"],
    ["trap", {L: 50, a: 1, b: 2, h: 10}, 750, "Trapezoid (1 + 2)/2 × 10 × 50"],
    ["tri", {L: 20, b: 1, h: 1}, 10, "Triangle ½ × 1 × 1 × 20"],
    ["tbeam", {L: 20, bf: 4, df: 0.5, bw: 1, h: 2}, 70, "T-beam 4 × 0.5 + 1 × 1.5 = 3.5 SFT × 20"],
    ["foot", {L: 6, W: 6, d1: 0.75, l2: 1.5, w2: 1.5, h: 1}, 27 + (36 + 4 * 14.0625 + 2.25) / 6, "Sloped footing 6 × 6, pad 0.75, top 1.5 × 1.5, h 1"],
    ["cone", {dia: 2, dt: 1, D: 3}, PI * 3 / 12 * 7, "Frustum of cone 2 / 1 × 3"],
    ["dome", {sp: 20, rise: 5, t: 0.5}, PI * 30.25 * 33.5 / 3 - PI * 25 * 32.5 / 3, "Dome span 20, rise 5, shell 0.5 (R 12.5)"],
    ["stair", {W: 4, nst: 10, tr: 10, rr: 6, t: 6}, 10 * Math.sqrt(100 + 36) / 12 * 4 * 0.5 + 10 * 0.5 * (10 / 12) * 0.5 * 4, "Stair 10 steps 10 × 6 in, W 4, waist 6 in", {t: "in"}],
    ["incl", {L: 30, W: 12, rise: 4, D: 0.5}, Math.sqrt(916) * 12 * 0.5, "Ramp 30 plan, rise 4, 12 wide, 0.5 thick"],
    ["retw", {L: 50, rb: 8, rd: 1.5, a: 1, b: 1.5, hs: 10}, (12 + 12.5) * 50, "Retaining wall base 8 × 1.5, stem 1 / 1.5 × 10, L 50"]
  ];
  const sr = await run(shapes.map(s => C(s[0], s[1], s[4])));
  shapes.forEach((s, i) => { const r = sr[i]; ok(!r.errs.length && near(vol(r), s[2]) && r.sh === "geo" && r.el === s[0], s[3] + " → " + (r.errs.length ? r.errs.join("; ") : vol(r).toFixed(4)) + " (expected " + s[2].toFixed(4) + ")"); });
  ok(sr.length === 19, "19 concrete shapes tested");

  const ex = await run([
    C("rect", {}), C("tbeam", {L: 20, bf: 4, df: 0.5, bw: 1, h: 2}), C("ring", {dia: 12, di: 11, D: 8}), C("hrect", {L: 10, W: 8, t: 0.75, D: 6}),
    C("foot", {L: 8, W: 4, l2: 2, w2: 2, h: 1, d1: 0}), C("stair", {W: 4, nst: 10, tr: 10, rr: 6, t: 6}, {t: "in"}), C("dome", {sp: 20, rise: 5, t: 0})]);
  ok(near(ex[0].res["Plan / top area"] / SFT, 200) && near(ex[0].res["Side area (perimeter × D) — formwork / edges"] / SFT, 30), "Rectangle: plan area 200 SFT, side (edge) area 2(20 + 10) × 0.5 = 30 SFT");
  ok(near(ex[1].res["Beam formwork — soffit + sides below the flange"] / SFT, 80), "T-beam formwork (1 + 2 × 1.5) × 20 = 80 SFT");
  ok(near(ex[2].res["Internal capacity (space inside the ring)"] / CFT, PI / 4 * 121 * 8), "Ring wall: internal capacity π/4 × 11² × 8 = " + (PI / 4 * 121 * 8).toFixed(2) + " CFT");
  ok(near(ex[3].res["Internal capacity (space inside the walls)"] / CFT, 8.5 * 6.5 * 6), "Box walls: internal capacity 8.5 × 6.5 × 6 = 331.5 CFT");
  ok(near(vol(ex[4]), 16) && ex[4].notes.some(n => /not similar/.test(n)), "Non-similar frustum 8 × 4 → 2 × 2: prismoidal 16 CFT, with a note that h/3(A1 + A2 + √A1A2) differs");
  ok(near(ex[5].res["Soffit (waist) — formwork"] / SFT, 10 * Math.sqrt(136) / 12 * 4) && near(ex[5].res["Riser faces — formwork"] / SFT, 20), "Stair: soffit Lw × W and riser faces 10 × 0.5 × 4 = 20 SFT");
  ok(near(vol(ex[6]), PI * 25 * 32.5 / 3), "Dome with thickness 0 = solid spherical cap π h² (3R − h) / 3");

  console.log("Concrete — deductions, additions, wastage, materials, steel, water, self-weight, mixer, amount");
  const BAG = 50 / 1440 / CFT;
  const mt = await run([
    {id: "concrete", vals: {mix: "none"}, rows: {add: [{n: "1", l: "10", w: "1", d: "1"}], dedc: [{n: "2", d: "1", h: "0.5"}], ded: [{n: "1", l: "2", w: "2", d: "0.5"}]}},
    {id: "concrete", vals: {kind: "rcc", mix: "1:2:4", wc: "0.5", stb: "pct", stp: "1", mixc: "6", rate: "500"}},
    {id: "concrete", vals: {kind: "pcc", mix: "none", wast: "5", steel: "100"}},
    {id: "concrete", vals: {kind: "rcc", mix: "none", steel: "100", rate: "20000", rbas: "m3"}}]);
  const m0 = mt[0], m1 = mt[1], m2 = mt[2], m3 = mt[3];
  ok(!m0.errs.length && near(vol(m0), 100 + 10 - 2 - 2 * PI / 4 * 0.5), "100 + member 10 − deduction 2 − 2 circular voids Ø1 × 0.5 = " + (108 - PI / 4).toFixed(4) + " CFT (got " + vol(m0).toFixed(4) + ")");
  ok(m0.steps.indexOf("Add member 1") >= 0 && m0.steps.indexOf("Less circular void 1") >= 0 && m0.steps.indexOf("Net volume") >= 0, "Working lists the added member, the circular void and the net volume");
  ok(near(m1.res["Cement"], 154 / 7 / BAG) && near(m1.res["Sand"] / CFT, 44) && near(m1.res["Coarse aggregate"] / CFT, 88), "1:2:4 on 100 CFT: dry 154 → cement " + (154 / 7 / BAG).toFixed(3) + " bags, sand 44, crush 88 CFT");
  ok(near(m1.res["Water (w/c 0.5)"] * 1000, 154 / 7 / BAG * 50 * 0.5), "Water = cement kg × 0.5 = " + (154 / 7 / BAG * 25).toFixed(1) + " litres");
  ok(near(m1.res["Reinforcement steel"], 100 * CFT * 0.01 * 7850), "Steel 1 % of volume × 7850 = " + (100 * CFT * 78.5).toFixed(2) + " kg");
  ok(near(m1.res["Self-weight (net volume × density)"], 100 * CFT * 2500), "RCC self-weight 2.8317 m³ × 2500 = " + (100 * CFT * 2500).toFixed(1) + " kg (EN 1991-1-1)");
  ok(m1.res["Transit-mixer loads"] === 1 && near(m1.res["Amount at your rate"], 50000), "Mixer loads at 6 m³ = 1; amount 100 CFT × 500 = 50,000 PKR");
  ok(near(vol(m2), 105) && near(m2.res["Net volume (before wastage)"] / CFT, 100) && near(m2.res["Self-weight (net volume × density)"], 100 * CFT * 2400) && m2.res["Reinforcement steel"] == null,
    "PCC + 5 % wastage → 105 CFT, net 100, self-weight on the net volume at 2400 kg/m³, no steel for PCC");
  ok(near(m3.res["Reinforcement steel"], 100 * CFT * 100) && near(m3.res["Amount at your rate"], 100 * CFT * 20000), "Steel 100 kg/m³ on the net volume; amount per m³");

  console.log("Concrete — impossible shapes are refused with a reason");
  const er = await run([
    C("ring", {dia: 10, di: 10, D: 5}), C("hrect", {L: 10, W: 2, t: 1, D: 5}), C("sector", {ro: 5, ri: 6, ang: 90, D: 1}), C("sector", {ro: 5, ri: 0, ang: 400, D: 1}),
    C("retw", {L: 10, rb: 1, rd: 1, a: 1, b: 2, hs: 5}), C("tbeam", {L: 10, bf: 2, df: 2, bw: 1, h: 2}), C("poly", {ns: 2, s: 1, D: 1}), C("stair", {W: 4, nst: 10, tr: 10, rr: 6, t: 0}),
    {id: "concrete", vals: {el: "xy", D: "0.5", mix: "none"}, rows: {pts: [{x: "0", y: "0"}, {x: "5", y: "0"}]}}, C("rect", {L: 0})]);
  [/Inner diameter must be less/, /2 × wall thickness/, /Inner radius must be less/, /Angle must be/, /Stem bottom width/, /Flange depth must be less/, /3 or more sides/, /Waist slab thickness/, /at least 3 corner points/, /greater than zero/]
    .forEach((re, i) => ok(er[i].errs.some(e => re.test(e)), "Refused: " + (er[i].errs[0] || "(no error!)")));
  const cross = await run([{id: "concrete", vals: {el: "xy", D: "1", mix: "none"}, rows: {pts: [{x: "0", y: "0"}, {x: "20", y: "0"}, {x: "0", y: "10"}, {x: "10", y: "10"}]}},
    {id: "concrete", vals: {el: "xy", D: "1", mix: "none"}, rows: {pts: [{x: "0", y: "0"}, {x: "10", y: "10"}, {x: "10", y: "0"}, {x: "0", y: "10"}]}}]);
  ok(cross[0].warns.some(w => /crosses itself/.test(w)), "A self-crossing outline is flagged");
  ok(cross[1].errs.some(e => /enclose no area/.test(e)), "A symmetric bow-tie (net area 0) is refused");

  console.log("Area & Volume — any shape");
  const G = (shp, vals) => ({id: "geo", vals: Object.assign({shp}, vals)});
  const gr = await run([G("a:tri3", {s1: 3, s2: 4, s3: 5}), G("a:circ", {dia: 10}), G("a:xy", {}), G("v:sph", {dia: 10}), G("v:circ", {}), G("v:hemi", {dia: 10}),
    G("v:foot", {L: 6, W: 6, l2: 0, w2: 0, h: 3}), G("v:ring", {dia: 10, di: 9, D: 10, rho: 2400}), G("a:rect", {n: 3, L: 20, W: 10}), G("a:segment", {ch: 12, rise: 3}),
    G("a:poly", {ns: 6, s: 2}), G("v:cone", {dia: 6, dt: 0, D: 9}), G("a:tri3", {s1: 1, s2: 2, s3: 5}), G("a:sector", {ro: 10, ri: 0, ang: 360}), G("v:dome", {sp: 10, rise: 5, t: 0})]);
  const A = (r, l) => r.res[l] / SFT, V = (r, l) => r.res[l] / CFT, Lr = (r, l) => r.res[l] / FT;
  ok(near(A(gr[0], "Area"), 6) && near(Lr(gr[0], "Perimeter"), 12), "Triangle 3-4-5 (Heron): 6 SFT, perimeter 12 ft");
  ok(near(A(gr[1], "Area"), 25 * PI) && near(Lr(gr[1], "Circumference"), 10 * PI), "Circle d 10: 78.54 SFT, circumference 31.42 ft");
  ok(near(A(gr[2], "Area"), 296) && near(Lr(gr[2], "Perimeter"), 20 + 10 + 10 + 12 + 16), "Coordinates (default 5 points): 296 SFT, perimeter 68 ft");
  ok(near(V(gr[3], "Volume"), PI / 6 * 1000) && near(A(gr[3], "Surface area"), 100 * PI), "Sphere d 10: 523.60 CFT, surface 314.16 SFT");
  ok(near(V(gr[4], "Volume"), 250 * PI) && near(gr[4].res["Capacity (liquid volume)"] * 1000, 250 * PI * CFT * 1000), "Cylinder 10 × 10 (defaults): 785.40 CFT = " + (250 * PI * CFT * 1000).toFixed(0) + " litres");
  ok(near(V(gr[5], "Volume"), PI / 12 * 1000) && near(A(gr[5], "Total surface area (all faces)"), 75 * PI), "Hemisphere d 10: 261.80 CFT, total surface 3π/4 d²");
  ok(near(V(gr[6], "Volume"), 36), "Pyramid 6 × 6 × 3 = 36 CFT (prismoid with a zero top)");
  ok(near(V(gr[7], "Volume"), PI / 4 * 19 * 10) && near(gr[7].res["Weight"], PI / 4 * 19 * 10 * CFT * 2400) && near(V(gr[7], "Internal capacity (space inside the ring)"), PI / 4 * 81 * 10), "Hollow cylinder: material volume, weight at 2400 kg/m³, internal capacity");
  ok(near(A(gr[8], "Total area"), 600) && near(A(gr[8], "Area of one"), 200) && near(Lr(gr[8], "Total perimeter"), 180), "3 Nos rectangles 20 × 10: 600 SFT total, 180 ft of perimeter");
  ok(near(A(gr[9], "Area"), 28.125 * (2 * Math.atan2(6, 4.5) - 0.96)), "Segment c 12, h 3: " + (28.125 * (2 * Math.atan2(6, 4.5) - 0.96)).toFixed(4) + " SFT");
  ok(near(A(gr[10], "Area"), 6 * Math.sqrt(3)), "Hexagon s 2: 3√3/2 × 4 = 10.392 SFT");
  ok(near(V(gr[11], "Volume"), PI * 9 / 12 * 36), "Cone d 6 × 9: π/12 × 36 × 9 = 84.82 CFT");
  ok(gr[12].errs.some(e => /cannot form a triangle/.test(e)), "Sides 1-2-5 refused: not a triangle");
  ok(near(A(gr[13], "Area"), 100 * PI), "Sector of 360° = full circle R 10");
  ok(near(V(gr[14], "Volume"), PI / 12 * 1000), "Spherical cap with rise = span/2 = hemisphere");

  console.log("Every BOQ item and every calculator still runs");
  const all = await page.evaluate(() => zdCalc.calcs().map(id => { let R; try { R = zdCalc.run(id); } catch (e) { return {id, ex: String(e)}; } return {id, errs: R.errs, n: R.results.length}; }));
  const crashed = all.filter(r => r.ex || (r.errs || []).some(e => /Calculation error/.test(e)));
  ok(!crashed.length, all.length + " calculators and items run without a calculation error" + (crashed.length ? " — " + JSON.stringify(crashed.slice(0, 5)) : ""));
  const items = all.filter(r => /^it-(slopefoot|ramp|tankwall|shaft|retwall|tbeam|dome|octcol|colc|slab|beam|col|foot|lintel|pcc148)$/.test(r.id));
  ok(items.length === 15 && items.every(r => !r.errs.length && r.n > 0), items.length + " concrete BOQ items (8 new shapes + 7 existing) give results" + items.filter(r => r.errs.length).map(r => " — " + r.id + ": " + r.errs[0]).join(""));
  const ids = await page.evaluate(() => zdCalc.calcs()), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok(!dup.length, "No two calculators or items share an id" + (dup.length ? " — " + dup.join(", ") : ""));

  console.log("In the page — shape menu, fields and diagram of every shape");
  await page.evaluate(() => zdCalc.open({v: "calc", id: "concrete", fresh: true}));
  await page.waitForSelector('#appCALC select[data-k="el"]');
  const menu = await page.evaluate(() => { const s = document.querySelector('#appCALC select[data-k="el"]'); return {groups: [...s.querySelectorAll("optgroup")].map(g => g.label + ":" + g.children.length), opts: [...s.options].map(o => o.value)}; });
  ok(menu.opts.length === 19 && menu.groups.length === 3, "Element / shape menu: 19 shapes in 3 groups (" + menu.groups.join(", ") + ")");
  const ui = [];
  for (const el of menu.opts) {
    await page.selectOption('#appCALC select[data-k="el"]', el);
    await page.waitForFunction(e => document.querySelector('#appCALC select[data-k="el"]').value === e, el);
    const st = await page.evaluate(() => ({
      err: !!document.querySelector("#zcRes .zc-err"), main: (document.querySelector("#zcRes .zc-main b") || {}).textContent || "",
      svg: (document.querySelector("#zcShape svg") || {}).outerHTML || "", hidden: document.getElementById("zcShape").hidden,
      fields: [...document.querySelectorAll("#appCALC .zc-form > .zc-fields > .zc-f:not([hidden])")].map(f => f.dataset.f)}));
    if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.locator("#zcShape").screenshot({path: path.join(SHOTS, "concrete-" + el + ".png")}); }
    ui.push(Object.assign({el}, st));
  }
  const badUi = ui.filter(u => u.err || !/CFT/.test(u.main) || u.hidden || u.svg.length < 300 || /NaN|undefined/.test(u.svg));
  ok(!badUi.length, "Every shape shows a result and a drawn diagram with no NaN / undefined" + (badUi.length ? " — " + badUi.map(u => u.el).join(", ") : ""));
  const fieldsOf = el => (ui.find(u => u.el === el) || {fields: []}).fields;
  ok(["L", "W", "D"].every(k => fieldsOf("rect").includes(k)) && !fieldsOf("rect").includes("dia"), "Rectangular shows L, W, D only");
  ok(["nst", "tr", "rr", "t", "W"].every(k => fieldsOf("stair").includes(k)) && !fieldsOf("stair").includes("D"), "Stair shows steps, tread, riser, waist and width — not D");
  ok(fieldsOf("xy").includes("pts") && fieldsOf("xy").includes("D"), "Irregular plan shows the corner-point table");

  console.log("In the page — coordinate rows follow a unit change; the extra sections");
  await page.selectOption('#appCALC select[data-k="el"]', "xy");
  const before = await page.evaluate(() => document.querySelector("#zcRes .zc-main b").textContent);
  await page.selectOption('#appCALC select[data-ku="pts"]', "m");
  const after = await page.evaluate(() => ({main: document.querySelector("#zcRes .zc-main b").textContent, x2: document.querySelector('[data-row="pts|1|x"]').value}));
  ok(after.x2 === "6.096" && after.main === before, "20 ft → 6.096 m in the X column, volume unchanged (" + after.main.replace(/\s+/g, " ") + ")");
  const det = await page.evaluate(() => [...document.querySelectorAll("#appCALC details.zc-more")].map(d => d.dataset.grp + ":" + d.open));
  ok(det.length === 2 && det[0] === "add:false" && det[1] === "mix:false", "Two collapsed sections: additional members & circular deductions, then material / mix (" + det.join(", ") + ")");
  await page.evaluate(() => { document.querySelector('#appCALC details[data-grp="add"]').open = true; });
  await page.selectOption('#appCALC select[data-k="el"]', "rect");
  ok(await page.evaluate(() => document.querySelector('#appCALC details[data-grp="add"]').open && !document.querySelector('#appCALC details[data-grp="mix"]').open), "An opened section stays open when the shape changes");

  console.log("In the page — Area & Volume");
  await page.evaluate(() => zdCalc.open({v: "calc", id: "geo", fresh: true}));
  await page.waitForSelector('#appCALC select[data-k="shp"]');
  const gm = await page.evaluate(() => { const s = document.querySelector('#appCALC select[data-k="shp"]'); return {groups: s.querySelectorAll("optgroup").length, opts: [...s.options].map(o => o.value)}; });
  ok(gm.opts.length === 30 && gm.groups === 2, "Shape menu: 30 shapes (13 plane, 17 solid) in 2 groups");
  const gbad = [];
  for (const id of gm.opts) {
    await page.selectOption('#appCALC select[data-k="shp"]', id);
    await page.waitForFunction(e => document.querySelector('#appCALC select[data-k="shp"]').value === e, id);
    const st = await page.evaluate(() => ({err: (document.querySelector("#zcRes .zc-err") || {}).textContent || "", main: (document.querySelector("#zcRes .zc-main b") || {}).textContent || "", svg: (document.querySelector("#zcShape svg") || {}).outerHTML || ""}));
    if (SHOTS) await page.locator("#zcShape").screenshot({path: path.join(SHOTS, "geo-" + id.replace(":", "-") + ".png")});
    if (st.err || !/SFT|CFT/.test(st.main) || st.svg.length < 300 || /NaN|undefined/.test(st.svg)) gbad.push(id + (st.err ? " (" + st.err + ")" : ""));
  }
  ok(!gbad.length, "Every plane figure and solid gives a result and a diagram with its default values" + (gbad.length ? " — " + gbad.join(", ") : ""));
  const srch = await page.evaluate(() => ({a: zdCalc.search("area volume", 8).map(r => r.label), b: zdCalc.search("dome", 8).map(r => r.label)}));
  ok(srch.a.some(l => /Area & Volume/.test(l)) && srch.b.some(l => /dome/i.test(l)), "Search finds “Area & Volume” and the dome items");

  console.log("Phone width");
  await page.setViewportSize({width: 375, height: 800});
  await page.evaluate(() => zdCalc.open({v: "calc", id: "concrete", fresh: true}));
  await page.selectOption('#appCALC select[data-k="el"]', "foot");
  const sw = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
  ok(sw.sw <= sw.cw + 1, "No sideways scroll at 375 px on the concrete calculator (" + sw.sw + " ≤ " + sw.cw + ")");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

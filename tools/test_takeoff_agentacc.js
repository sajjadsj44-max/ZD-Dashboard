#!/usr/bin/env node
/* Accuracy of the walls, block and finishes agents on drawing habits the apartment plan did not have (review of 17-Nov-2026):
   window glass drawn as one line in the middle of the wall, or two lines at 0.25 / 0.50 ft, must not make thin walls of their own
   (one line made 4.5" walls of every window, +47 %; two made a 6" wall); block runs take only walls, not the glass pairs (the 4"
   block run was 264 ft against 136.25); a bath is tiled — no plaster / paint and no skirting in it.
     python -m http.server 8765 --bind 127.0.0.1      # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_agentacc.js      (TK_URL for another port) */
const path = require("path");
const pw = require("playwright");
const A = require("./takeoff_apartment_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 0.01 : e);
(async () => {
  if (!LIBS) { console.log("TK_LIBS needed"); process.exit(2); }
  const browser = await pw.chromium.launch();
  const open = async (buf) => {
    const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
    await ctx.route(/cdn\.jsdelivr\.net/, r => { const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"};
      if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: "text/javascript", headers: H});
      if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: "text/javascript", headers: H});
      return r.abort(); });
    await ctx.route(/anthropic\.com|openai\.com|claude\.ai/, r => r.abort());
    const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.dismiss());
    await page.goto(URL); await page.waitForTimeout(600);
    await page.click("#bNewProj"); await page.fill("#dlgName", "Agent accuracy"); await page.click("#dlgOk"); await page.waitForTimeout(400);
    await page.setInputFiles("#fileIn", {name: "apartment.pdf", mimeType: "application/pdf", buffer: buf});
    await page.waitForFunction(() => zdTakeoff.S.page && zdTakeoff.S.geo[zdTakeoff.S.key] && zdTakeoff.scaleAt(zdTakeoff.S.fileId, zdTakeoff.S.pageNo), null, {timeout: 30000}); await page.waitForTimeout(400);
    return {ctx, page, errors, T: (f, a) => page.evaluate(f, a)};
  };
  const walls = T => T(() => { const Z = zdTakeoff, k = Z.scaleAt(Z.S.fileId, Z.S.pageNo), L = rs => +((rs || []).reduce((a, q) => a + Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), 0) / k).toFixed(3);
    const br = Z.blockRuns(null) || [], blk = {}; br.forEach(p => { blk[p.type] = +((blk[p.type] || 0) + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / k).toFixed(3); });
    return {th: Z.wallThicknesses(null).map(w => +(w.t * 12).toFixed(2)), w9: L(Z.findWalls(0.75, null, 6)), w4: L(Z.findWalls(0.375, null, 6)), w6: L(Z.findWalls(0.5, null, 6)), blk}; });

  console.log("window glass drawn as one line in the middle of the wall");
  { const o = await open(A.pdf({glass: [0.375]})), r = await walls(o.T);
    ok(near(r.w4, A.REF.wall4) && near(r.w9, A.REF.wall9), `4.5" walls ${r.w4} ft (ref ${A.REF.wall4}; the glass made 200.25), 9" ${r.w9} (ref ${A.REF.wall9})`);
    ok(near(r.blk["4"] || 0, A.REF.wall4), `4" block run ${r.blk["4"]} ft (ref ${A.REF.wall4}; was 200.25)`);
    ok(!o.errors.length, "no page errors" + (o.errors.length ? ": " + o.errors[0] : "")); await o.ctx.close(); }

  console.log("two glass lines at 0.25 / 0.50 ft");
  { const o = await open(A.pdf({glass: [0.25, 0.5]})), r = await walls(o.T);
    ok(!r.th.some(t => Math.abs(t - 6) < 0.3) && !(r.w6 > 0), `no 6" wall made of the glass (thicknesses ${r.th.join(", ")}"; 6" runs ${r.w6} ft — was 68.5)`);
    ok(near(r.w4, A.REF.wall4) && near(r.w9, A.REF.wall9), `4.5" ${r.w4} and 9" ${r.w9} ft as the reference`);
    await o.ctx.close(); }

  console.log("the plan as drawn (glass at 0.30 / 0.45 ft): block runs and finishes");
  { const o = await open(A.pdf()), r = await walls(o.T);
    ok(near(r.blk["4"] || 0, A.REF.wall4), `4" block run ${r.blk["4"]} ft (ref ${A.REF.wall4}; the 5.5" and 3.5" glass pairs made it 264.25)`);
    ok(!r.th.some(t => Math.abs(t - 5.5) < 0.3 || Math.abs(t - 3.5) < 0.3), `the glass pairs are not wall thicknesses (${r.th.join(", ")}")`);
    const fin = await o.T(([rooms, pg]) => { const Z = zdTakeoff, P = Z.P.proj, f = Z.S.fileId, g = pg, toV = (x, y) => Z.S.base.convertToViewportPoint(g.ox + x * g.k, g.h - g.oy - y * g.k);
      P.conds.push({id: "CR", name: "Rooms", type: "area", unit: "Sft", color: "#4a3aa7", h: "", t: "", faces: 1, dedMin: 0});
      rooms.forEach(([nm, pts], i) => P.items.push({id: "R" + i, cond: "CR", file: f, page: Z.S.pageNo, kind: "shape", nos: 1, label: nm, pts: pts.map(p => toV(p[0], p[1]))}));
      Z.refresh(); const r = Z.finishesRun({H: 10, DH: 7, cond: "CR"}); if (r.error) return {err: r.error};
      return r.rooms.map(x => ({name: x.name, skirt: x.skirt, wall: x.wallNet, bath: !!x.bath, notes: x.notes})); }, [A.ROOMS, A.PAGES[0]]);
    if (fin.err) ok(false, "finishes: " + fin.err);
    else { const baths = fin.filter(x => /^BATH/.test(x.name)), dry = fin.filter(x => !/^BATH/.test(x.name));
      ok(baths.length >= 2 && baths.every(x => x.bath && x.skirt === 0 && x.wall === 0 && x.notes.some(n => /tiled/.test(n))), "baths: no skirting and no plaster / paint, a note says they are tiled (" + baths.map(x => x.name).join(", ") + ")");
      ok(dry.every(x => x.skirt > 0 && x.wall > 0), "every other room keeps its skirting and wall finish"); }
    /* the walls agent with a height (H 10): every opening it bridged is deducted at its schedule size — the hand figure from the
       fixture's own geometry (9" walls 140.75 ft × 10 less the entrance 3 × 7 and the windows; 4.5" walls 136.25 × 10 less the
       inner doors × 7) */
    const H = 10, DH = 7, WH = {W1: 4, W2: 4, V1: 2};
    const dW = A.DOORS.map(d => ({w: d[2] - d[1], outer: d[0] === "v"})), winA = A.WINDOWS.reduce((a, w) => a + (w[2] - w[1]) * WH[w[3]], 0);
    const ref9 = (A.REF.wall9 * H - 3 * DH - winA) * 0.75, ref4 = A.REF.wall4 * H - dW.filter(d => !d.outer).reduce((a, d) => a + d.w, 0) * DH;
    const wr = await o.T(([H, WH]) => { const Z = zdTakeoff, u = () => "O" + Math.random().toString(36).slice(2, 9);
      Z.P.proj.openings = [{id: u(), mark: "D1", type: "door", w: 3, h: 7}, {id: u(), mark: "D2", type: "door", w: 2.5, h: 7}, {id: u(), mark: "D3", type: "door", w: 3, h: 7},
        {id: u(), mark: "W1", type: "window", w: 4, h: WH.W1}, {id: u(), mark: "W2", type: "window", w: 6, h: WH.W2}, {id: u(), mark: "V1", type: "window", w: 2, h: WH.V1}];
      const out = {}; for (const t of [0.75, 0.375]) { const w = Z.wallsAgent({t, page: true, bridge: 6, h: H}), c = Z.P.proj.conds.find(x => x.name === w.condition);
        out[t] = {unit: c.unit, net: Z.condTotals(c).net, n: w.openings, noH: w.openings_no_height}; }
      return out; }, [H, WH]);
    ok(wr[0.75].unit === "cft" && near(wr[0.75].net, ref9, ref9 * 0.01), `9" walls, H 10: ${wr[0.75].net.toFixed(3)} cft with ${wr[0.75].n} openings deducted (hand figure ${ref9.toFixed(3)}; was 1055.6, nothing deducted)`);
    ok(wr[0.375].unit === "Sft" && near(wr[0.375].net, ref4, ref4 * 0.01), `4.5" walls, H 10: ${wr[0.375].net.toFixed(3)} Sft with ${wr[0.375].n} openings deducted (hand figure ${ref4.toFixed(3)}; was 1362.5)`);
    ok(!o.errors.length, "no page errors" + (o.errors.length ? ": " + o.errors[0] : "")); await o.ctx.close(); }

  await browser.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})();

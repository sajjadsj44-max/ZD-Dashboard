#!/usr/bin/env node
/* Auto area across many kinds of drawing, against known reference outlines (tools/takeoff_drawings.js):

     python3 -m http.server 8765 &            # from the repo root
     TK_LIBS=/path/with/node_modules node tools/test_takeoff_drawings.js [--write]

   For every case the PDF page is opened in the app, its scale read (or calibrated, for a scan), and Auto area run from each
   seed with the app's default settings. Recorded: the area against the reference, IoU of the outline against the reference
   polygon (by sampling), whether the app flagged the result (error / leak / short trace), the time. A verdict per seed:
     pass        — within the case's area tolerance and IoU
     flagged     — off, but the app said so (error or warning): the user is asked to check / measure by hand
     silent-miss — off and NOT flagged: a wrong area that looks right (the failure that matters most)
     neg-pass / neg-fail — negative cases: no valid room, and the app did / did not refuse
     explore     — no verified reference; recorded only
   --write saves takeoff/kpi/drawing-tests.json, which the app's KPI dashboard reads. The test fails on any silent-miss, any
   neg-fail, or any case marked must that does not pass. */
const path = require("path"), fs = require("fs"), {execSync} = require("child_process");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makeDrawings, CASES} = require("./takeoff_drawings.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", WRITE = process.argv.includes("--write");
const MUST = new Set(["vector-clean", "thick-walls", "small-gap", "door-opening", "l-shape", "shared-walls", "colour", "angled", "tiny-room", "large-hall", "rotate-90", "rotate-270", "scale-quarter", "watermark", "scan-clean", "revision-a", "revision-b"]);
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }
const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
function iouH(A, Ah, B, hole, step){   // as iou, the detected region less its own holes
  const xs = A.concat(B).map(p => p[0]), ys = A.concat(B).map(p => p[1]); let i = 0, u = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
    const a = inPoly(x, y, A) && !(Ah || []).some(h => inPoly(x, y, h)), b = inPoly(x, y, B) && !(hole && inPoly(x, y, hole)); if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 0;
}
function iou(A, B, hole, step){   // sampled intersection over union of polygon A and polygon B (B less its hole)
  const xs = A.concat(B).map(p => p[0]), ys = A.concat(B).map(p => p[1]); let i = 0, u = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
    const a = inPoly(x, y, A), b = inPoly(x, y, B) && !(hole && inPoly(x, y, hole)); if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 0;
}

(async () => {
  if (!LIBS || !fs.existsSync(path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"))) { console.log("TK_LIBS must hold pdfjs-dist (and exceljs) — see the header"); process.exit(2); }
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
  const T = (fn, a) => page.evaluate(fn, a);
  await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(600);
  await page.click("#bNewProj"); await page.fill("#dlgName", "Drawing test suite"); await page.click("#dlgOk"); await page.waitForTimeout(400);
  await page.setInputFiles("#fileIn", {name: "takeoff-drawings.pdf", mimeType: "application/pdf", buffer: makeDrawings()});
  await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 30000});
  await page.click("#bNewCond"); await page.selectOption("#cPre", {label: "Floor area"}); await page.click("#dlgOk"); await page.waitForTimeout(250);
  const fileId = await T(() => zdTakeoff.S.fileId), out = [];

  for (const c of CASES.filter(c => !process.env.TK_CASE || process.env.TK_CASE.split(",").includes(c.id))) {
    await T(([f, n]) => zdTakeoff.gotoPage(f, n), [fileId, c.pageNo]);
    await page.waitForFunction(n => zdTakeoff.S.pageNo === n && zdTakeoff.S.geo[zdTakeoff.S.key], c.pageNo, {timeout: 30000}).catch(() => {});
    await page.waitForTimeout(250);
    if (c.calibrate) await T(k => { zdTakeoff.P.proj.scales[zdTakeoff.S.key] = {ptPerFt: k, how: "calibrated", text: "test calibration", verified: true, at: new Date().toISOString()}; }, c.k);
    const sc = await T(() => { const s = zdTakeoff.P.proj.scales[zdTakeoff.S.key]; return s ? {k: s.ptPerFt, how: s.how, doubt: !!s.doubt, state: zdTakeoff.scaleState(s).t} : null; });
    const rec = {id: c.id, cat: c.cat, desc: c.desc, page: c.pageNo, rotate: c.rotate || 0, kind: c.raster ? (c.page ? "mixed" : "raster") : "vector", scale: {expected: c.k, read: sc ? +sc.k.toFixed(4) : 0, how: sc ? sc.how : "none", state: sc ? sc.state : "not set"}, seeds: []};
    console.log(c.id + " — " + c.cat + (sc ? " · scale " + sc.k.toFixed(3) + " pt/ft (" + sc.how + ")" : " · no scale"));
    if (c.k && !c.calibrate) ok(sc && Math.abs(sc.k - c.k) / c.k < 0.002, "scale read from the drawing: " + (sc ? sc.k.toFixed(3) : "none") + " pt per ft (expected " + c.k + ")");
    if (c.scaleConflict) { rec.scale.conflictFlagged = sc && /doubt/i.test(sc.state); console.log("   scale state: " + (sc && sc.state) + " (exploratory)"); }
    for (const r of c.rooms || []) {
      const res = await T(async ([seed, ref, hole]) => {
        const vp = zdTakeoff.S.base, cv = p => vp.convertToViewportPoint(p[0], p[1]);
        const t0 = performance.now(); let o; try { o = await zdTakeoff.autoRoomGuarded(cv(seed)); } catch (e) { o = {err: String(e.message || e)}; }
        return {ms: performance.now() - t0, pts: o.pts || null, holes: (o.holes || []).map(h => h.pts), err: o.err || "", leak: o.leak || "", short: o.short || "", warn: o.warn || "", rect: !!o.rect, note: o.note || "", ref: ref ? ref.map(cv) : null, hole: hole ? hole.map(cv) : null, k: zdTakeoff.P.proj.scales[zdTakeoff.S.key] ? zdTakeoff.P.proj.scales[zdTakeoff.S.key].ptPerFt : 0};
      }, [r.seed, r.ref || null, r.hole || null]);
      const k = res.k || c.k, truth = r.ref ? (area(res.ref) - (res.hole ? area(res.hole) : 0)) / (k * k) : null, got = res.pts ? (area(res.pts) - res.holes.reduce((a, h) => a + area(h), 0)) / (k * k) : null;
      const flagged = !!(res.err || res.leak || res.short || res.warn), tol = r.tol == null ? 1 : r.tol, iouMin = r.iou == null ? 0.97 : r.iou;
      const errPct = truth && got != null ? (got - truth) / truth * 100 : null, I = res.pts && res.ref ? iouH(res.pts, res.holes, res.ref, res.hole, k * 0.1) : null;
      if (r.sft && truth && Math.abs(truth - r.sft) > 0.01) console.log("   ! reference area " + truth.toFixed(3) + " ≠ documented " + r.sft);
      const expect = r.expect || "area", good = errPct != null && Math.abs(errPct) <= tol && I != null && I >= iouMin;
      const verdict = expect === "explore" ? "explore" : expect === "none" ? (res.err || flagged ? "neg-pass" : "neg-fail") : good ? "pass" : flagged ? "flagged" : "silent-miss";
      const s = {truthSft: truth != null ? +truth.toFixed(3) : null, gotSft: got != null ? +got.toFixed(3) : null, errPct: errPct != null ? +errPct.toFixed(3) : null, iou: I != null ? +I.toFixed(4) : null,
        ms: Math.round(res.ms), flagged, err: res.err, leak: res.leak, short: res.short, warn: res.warn, holes: res.holes.length, note: res.note, tol, iouMin, expect, verdict, must: MUST.has(c.id) && expect === "area"};
      rec.seeds.push(s);
      const msg = `${verdict.padEnd(11)} got ${got != null ? got.toFixed(2) : "—"} Sft vs ${truth != null ? truth.toFixed(2) : "—"} (${errPct != null ? (errPct >= 0 ? "+" : "") + errPct.toFixed(2) + " %" : "—"}, IoU ${I != null ? I.toFixed(3) : "—"}) ${res.ms.toFixed(0)} ms${res.err ? " · error: " + res.err.slice(0, 70) : ""}${res.leak ? " · leak: " + res.leak : ""}${res.short ? " · short: " + res.short.slice(0, 60) : ""}${res.warn ? " · warn: " + res.warn.slice(0, 60) : ""}${res.holes.length ? " · " + res.holes.length + " void(s) deducted" : ""}`;
      if (verdict === "explore") console.log("   · " + msg);
      else ok(verdict !== "silent-miss" && verdict !== "neg-fail" && !(s.must && verdict !== "pass"), msg);
    }
    if (c.counts) {
      const got = await T(async () => { const r = await zdTakeoff.agentCount("d1, d2, w1", "page"); return r && r.counts ? r.counts : {}; });
      rec.counts = {expected: c.counts, got};
      for (const [t, n] of Object.entries(c.counts)) ok((got[t.toUpperCase()] || 0) === n, `count ${t.toUpperCase()}: ${got[t.toUpperCase()] || 0} (expected ${n}; the schedule's tags are not counted)`);
    }
    out.push(rec);
  }
  const S = out.flatMap(r => r.seeds), V = v => S.filter(s => s.verdict === v).length;
  const judged = S.filter(s => s.expect === "area"), errs = judged.filter(s => s.errPct != null).map(s => Math.abs(s.errPct)), ious = judged.filter(s => s.iou != null).map(s => s.iou);
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  console.log(`\nAuto area: ${S.length} seeds on ${out.length} pages, ${new Set(out.map(r => r.cat)).size} drawing conditions — pass ${V("pass")}, flagged ${V("flagged")}, silent-miss ${V("silent-miss")}, negative ${V("neg-pass")}/${V("neg-pass") + V("neg-fail")} refused, exploratory ${V("explore")}`);
  console.log(`median |area error| ${med(errs) != null ? med(errs).toFixed(2) + " %" : "—"} · median IoU ${med(ious) != null ? med(ious).toFixed(3) : "—"} · median time ${med(S.map(s => s.ms))} ms`);
  if (WRITE) {
    let commit = ""; try { commit = execSync("git rev-parse --short HEAD", {cwd: path.join(__dirname, "..")}).toString().trim(); } catch (e) {}
    fs.writeFileSync(path.join(__dirname, "..", "takeoff", "kpi", "drawing-tests.json"), JSON.stringify({suite: "tools/test_takeoff_drawings.js", at: new Date().toISOString(), commit, browser: "Chromium " + browser.version(), settings: "Auto area defaults", cases: out}, null, 1));
    console.log("written takeoff/kpi/drawing-tests.json");
  }
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });

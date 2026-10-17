#!/usr/bin/env node
/* The AutoCAD helper: tools/cad-bridge.js with a fake AutoCAD console (tools/fake_accore.js), then the takeoff page adding a DWG
   through it — the drawing read from the DXF "AutoCAD" saved, and said so. Also: only the allowed site, only this computer's
   host name, the browser's local-network preflight, a text DXF when a binary one does not come out, a file that is no DWG.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_cad_bridge.js                     (TK_URL / TK_LIBS as for test_takeoff_cad.js; uses port 11436)
*/
const path = require("path"), fs = require("fs"), http = require("http"), {spawn} = require("child_process");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", SITE = new globalThis.URL(URL).origin, PORT = 11436;
const FIX = path.join(__dirname, "cad_fixtures"), DWG = path.join(FIX, "zd_test_2018.dwg");
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }
const req = (method, p, body, headers) => new Promise(res => { const r = http.request({host: "127.0.0.1", port: PORT, path: p, method, headers: Object.assign({}, headers || {})}, s => {
  const c = []; s.on("data", d => c.push(d)); s.on("end", () => { const b = Buffer.concat(c); let j = null; try { j = JSON.parse(b.toString("utf8")); } catch (e) {} res({code: s.statusCode, h: s.headers, body: b, json: j}); }); });
  r.on("error", e => res({code: 0, err: e.message})); if (body) r.write(body); r.end(); });
function start(extra){
  const br = spawn(process.execPath, [path.join(__dirname, "cad-bridge.js")], {env: Object.assign({}, process.env, {ZD_ACCORE: path.join(__dirname, "fake_accore.js"), ZD_BRIDGE_ORIGINS: SITE, ZD_CAD_PORT: String(PORT)}, extra || {})});
  let out = ""; br.stdout.on("data", d => { out += d; }); br.stderr.on("data", d => { out += d; });
  return {br, ready: async () => { for (let i = 0; i < 50 && !/http:\/\//.test(out); i++) await new Promise(r => setTimeout(r, 100)); return out; }};
}

(async () => {
  console.log("helper: running");
  let h = start(); await h.ready();
  try {
    let r = await req("GET", "/"); ok(r.code === 200 && r.json && r.json.app === "zd-cad-bridge" && r.json.autocad[0] === "test console", "GET / names the AutoCAD it uses");
    r = await req("POST", "/convert?name=a.dwg", fs.readFileSync(DWG), {Origin: "https://evil.example"}); ok(r.code === 403, "another website is refused (403)");
    r = await req("POST", "/convert?name=a.dwg", fs.readFileSync(DWG)); ok(r.code === 403, "a POST with no Origin (not from a page) is refused");
    r = await req("GET", "/", null, {Host: "attacker.example:" + PORT}); ok(r.code === 403, "a request for another host name is refused (DNS rebinding)");
    r = await req("OPTIONS", "/convert", null, {Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"});
    ok(r.code === 204 && r.h["access-control-allow-origin"] === SITE && r.h["access-control-allow-private-network"] === "true", "the browser's preflight (local network) is answered for the site");
    r = await req("POST", "/convert?name=a.dwg", Buffer.from("not a drawing"), {Origin: SITE}); ok(r.code === 500 && /not a DWG/.test(r.json && r.json.error), "a file that is no DWG is refused with why");
    r = await req("POST", "/convert?name=" + encodeURIComponent("zd test.dwg"), fs.readFileSync(DWG), {Origin: SITE, "Content-Type": "application/octet-stream"});
    ok(r.code === 200 && r.body.equals(fs.readFileSync(path.join(FIX, "zd_test_2018.dxf"))) && r.h["x-acad"] === "test console" && r.h["access-control-allow-origin"] === SITE, "a DWG comes back as the DXF AutoCAD saved (" + r.body.length + " bytes)");
  } finally { h.br.kill(); }
  h = start({FAKE_ACCORE_NO_BINARY: "1"}); await h.ready();
  try { const r = await req("POST", "/convert?name=a.dwg", fs.readFileSync(DWG), {Origin: SITE}); ok(r.code === 200 && r.body.equals(fs.readFileSync(path.join(FIX, "zd_test_2018.dxf"))), "no binary DXF from AutoCAD: a text DXF instead"); }
  finally { h.br.kill(); }

  console.log("takeoff page: a DWG through the helper");
  h = start(); await h.ready();
  const browser = await pw.chromium.launch(), errs = [];
  const addDwg = async name => {   // a fresh browser session (the projects screen), a new project, the fixture DWG added -> its drawing's metadata
    const ctx = await browser.newContext({viewport: {width: 1500, height: 900}});
    await require("./zd_unlock")(ctx);
    if (LIBS) await ctx.route(/cdn\.jsdelivr\.net/, r => {   // (the CDN libraries from TK_LIBS, as test_takeoff_cad.js)
      const u = r.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
      if (/pdf\.worker\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
      if (/pdf\.min\.mjs/.test(u)) return r.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H});
      if (/pdf-lib.*esm/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.esm.min.js"), contentType: js, headers: H});
      if (/pdf-lib/.test(u)) return r.fulfill({path: path.join(LIBS, "pdf-lib/dist/pdf-lib.min.js"), contentType: js, headers: H});
      let m = /@mlightcad\/libredwg-web@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/libredwg-web", m[1]), contentType: /\.wasm$/.test(m[1]) ? "application/wasm" : js, headers: H});
      m = /@mlightcad\/dxf-json@[^/]+\/(.+)$/.exec(u); if (m) return r.fulfill({path: path.join(LIBS, "@mlightcad/dxf-json", m[1]), contentType: js, headers: H});
      return r.abort();
    });
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    await page.goto(URL, {waitUntil: "load"}); await page.waitForTimeout(800);
    await page.click("#bNewProj"); await page.fill("#dlgName", name); await page.click("#dlgOk"); await page.waitForTimeout(400);
    await page.setInputFiles("#fileIn", DWG);
    await page.waitForFunction(() => window.zdTakeoff && zdTakeoff.S.page && zdTakeoff.P.proj.files.length, null, {timeout: 120000});
    const f = await page.evaluate(() => zdTakeoff.P.proj.files[0]); await ctx.close(); return f;
  };
  try {
    const f = await addDwg("Helper"), m = f.cad;
    ok(m.via === "test console" && m.fmt === "DXF" && m.stats.ents > 0 && !m.stats.junk, "the page sends the DWG to the helper and reads what AutoCAD saved (" + m.stats.ents + " objects, via " + m.via + ")");
    ok(f.name === "zd_test_2018.dwg", "the drawing keeps its own name in the project");
    h.br.kill(); await new Promise(r => setTimeout(r, 300));
    const m2 = (await addDwg("No helper")).cad;
    ok(!m2.via && m2.fmt === "DWG" && m2.stats.ents > 0, "with no helper the browser reads the DWG itself, as before (" + m2.stats.ents + " objects)");
    ok(!errs.length, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  } finally { await browser.close(); try { h.br.kill(); } catch (e) {} }
  console.log("\n" + passes + " passed, " + fails + " failed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

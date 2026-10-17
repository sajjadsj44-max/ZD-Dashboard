#!/usr/bin/env node
/* AutoCAD helper for PDF Takeoff — opens a DWG with the AutoCAD installed on this computer, so the takeoff gets every drawing
   AutoCAD can open, whole. The browser's own DWG reader (LibreDWG) loses most of some big drawings that AutoCAD reads without
   fault, and cannot read some versions at all.

   The page posts the DWG's bytes; this helper writes them to a folder of its own under the temp folder, runs AutoCAD's console
   (accoreconsole.exe — AutoCAD without its window) on that copy: binds any external references it can find, saves the drawing
   as a binary DXF (2018), and answers with that file. The DXF is what the takeoff then reads. Nothing is kept: the folder is
   removed after each drawing. One drawing at a time.

   Only this site may call it (the Origin is checked, and the Host must be this computer), and it listens on 127.0.0.1 only.

     node tools/cad-bridge.js            (the takeoff finds it by itself when a DWG is added)
     node tools/cad-bridge.js --log <file>   (also keeps what it prints in that file)
   To have it start with Windows: a shortcut in the Startup folder to wscript.exe running a .vbs that starts node hidden.
   Env: ZD_CAD_PORT (11436), ZD_BRIDGE_ORIGINS (extra allowed origins, comma separated), ZD_ACCORE (accoreconsole.exe to use;
   a .js file is run with node — used by the tests). */
const http = require("http"), {spawn} = require("child_process"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.ZD_CAD_PORT || 11436, HOST = "127.0.0.1", VERSION = "1.0";
const ORIGINS = new Set(["https://sajjadsj44-max.github.io"].concat((process.env.ZD_BRIDGE_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)));
const MAX_BODY = 600 * 1024 * 1024, JOB_MS = 20 * 60 * 1000;
/* --log <file>: what it prints is kept in that file too (it runs hidden when Windows starts it) */
const LOG = (i => i >= 0 ? process.argv[i + 1] || "" : "")(process.argv.indexOf("--log"));
if (LOG) { const say = console.log; console.log = (...a) => { say(...a); try { fs.appendFileSync(LOG, new Date().toISOString().slice(0, 10) + " " + a.join(" ") + "\n"); } catch (e) {} }; }

/* the AutoCAD consoles on this computer, newest first (AutoCAD 2026, 2025, 2024 … under Program Files\Autodesk) */
function consoles(){
  if (process.env.ZD_ACCORE) return [process.env.ZD_ACCORE];
  const out = [];
  for (const base of [process.env.ProgramW6432, process.env.ProgramFiles, "C:\\Program Files"].filter(Boolean)) {
    const ad = path.join(base, "Autodesk"); let L = []; try { L = fs.readdirSync(ad); } catch (e) { continue; }
    L.filter(n => /^AutoCAD/i.test(n)).forEach(n => { const exe = path.join(ad, n, "accoreconsole.exe"); if (fs.existsSync(exe) && !out.includes(exe)) out.push(exe); });
  }
  return out.sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
}
const ACAD = consoles();
const acadName = exe => /\.js$/i.test(exe) ? "test console" : (path.basename(path.dirname(exe)) || "AutoCAD");

/* the console's script: bind the external references it can find (so they come along, as AutoCAD shows them), then save as a
   binary DXF. Each answer on its own line, as typed at AutoCAD's command line. ascii: a text DXF (a second try) */
const script = (out, ascii) => ["_.-XREF", "_B", "*", "_.SAVEAS", "_DXF", "_V", "2018", ascii ? "16" : "_B", out, "_.QUIT", "_Y", ""].join("\r\n");

function run(exe, dwg, scr, ms){   // -> {code, log}
  return new Promise(res => {
    const js = /\.js$/i.test(exe), args = ["/i", dwg, "/s", scr, "/l", "en-US"];
    const p = spawn(js ? process.execPath : exe, js ? [exe].concat(args) : args, {cwd: path.dirname(dwg), windowsHide: true});
    let log = ""; const keep = b => { log = (log + b.toString("utf16le").replace(/\0/g, "")).slice(-20000); };
    p.stdout.on("data", keep); p.stderr.on("data", keep);
    const t = setTimeout(() => { try { p.kill(); } catch (e) {} log += "\n[stopped after " + Math.round(ms / 60000) + " min]"; }, ms);
    p.on("error", e => { clearTimeout(t); res({code: -1, log: log + "\n" + e.message}); });
    p.on("close", code => { clearTimeout(t); res({code, log}); });
  });
}
const isDxf = f => { try { const fd = fs.openSync(f, "r"), b = Buffer.alloc(22); fs.readSync(fd, b, 0, 22, 0); fs.closeSync(fd); return /^AutoCAD Binary DXF|^\s*0\s*[\r\n]+\s*SECTION/.test(b.toString("latin1")); } catch (e) { return false; } };

async function convert(buf, name){   // DWG bytes -> {dxf: Buffer, acad, ms}
  if (!ACAD.length) throw new Error("AutoCAD was not found on this computer (no accoreconsole.exe under Program Files\\Autodesk)");
  if (!/^AC1\d{3}/.test(buf.subarray(0, 6).toString("latin1"))) throw new Error("this is not a DWG file");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zd-cad-")), dwg = path.join(dir, "drawing.dwg"), out = path.join(dir, "drawing.dxf"), scr = path.join(dir, "save.scr");
  const t0 = Date.now(); let last = "";
  try {
    fs.writeFileSync(dwg, buf);
    for (const exe of ACAD) for (const ascii of [false, true]) {   // a binary DXF; a text one if that did not come out; the next AutoCAD if this one cannot
      try { fs.unlinkSync(out); } catch (e) {}
      fs.writeFileSync(scr, script(out, ascii), "latin1");
      const r = await run(exe, dwg, scr, JOB_MS);
      if (isDxf(out) && fs.statSync(out).size > 0) return {dxf: fs.readFileSync(out), acad: acadName(exe), ms: Date.now() - t0};
      last = acadName(exe) + ": " + (r.log.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^(Command:|CoreHeartBeat)/.test(s)).slice(-4).join(" · ") || "exit " + r.code);
    }
    throw new Error("AutoCAD could not save it as DXF — " + last);
  } finally { fs.rm(dir, {recursive: true, force: true}, () => {}); }
}

let queue = Promise.resolve(), waiting = 0;
const stamp = () => new Date().toLocaleTimeString();
function send(res, code, body, origin, extra){
  const h = Object.assign({"Content-Type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json", "Cache-Control": "no-store"}, extra || {});
  if (origin && ORIGINS.has(origin)) Object.assign(h, {"Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Expose-Headers": "X-Acad, X-Ms"});
  res.writeHead(code, h); res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "", host = String(req.headers.host || "");
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return send(res, 403, {error: "bad host"});   // a page on another name pointed at this computer
  if (origin && !ORIGINS.has(origin)) return send(res, 403, {error: "this site is not allowed: " + origin});
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({"Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600"},
      req.headers["access-control-request-private-network"] ? {"Access-Control-Allow-Private-Network": "true"} : {}));
    return res.end();
  }
  const url = (req.url || "").split("?")[0];
  if (req.method === "GET" && url === "/") return send(res, 200, {app: "zd-cad-bridge", version: VERSION, autocad: ACAD.map(acadName), waiting}, origin);
  if (req.method !== "POST" || url !== "/convert") return send(res, 404, {error: "not found"}, origin);
  if (!origin) return send(res, 403, {error: "requests must come from the takeoff page"});
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, {error: "the drawing is over " + (MAX_BODY >> 20) + " MB"}, origin); chunks.push(c); }
  const buf = Buffer.concat(chunks), name = decodeURIComponent((/[?&]name=([^&]*)/.exec(req.url || "") || [])[1] || "drawing.dwg").slice(0, 200);
  waiting++;
  const job = queue.then(async () => {
    console.log(stamp() + "  " + name + " (" + (buf.length / 1048576).toFixed(1) + " MB, " + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10) + ") …");
    try { const r = await convert(buf, name); console.log(stamp() + "  " + name + " → DXF " + (r.dxf.length / 1048576).toFixed(1) + " MB by " + r.acad + " in " + (r.ms / 1000).toFixed(0) + " s");
      send(res, 200, r.dxf, origin, {"X-Acad": r.acad, "X-Ms": String(r.ms)}); }
    catch (e) { console.log(stamp() + "  " + name + "  error: " + e.message); send(res, 500, {error: e.message}, origin); }
    finally { waiting--; }
  });
  queue = job.catch(() => {});
});
server.on("error", e => { console.log(e.code === "EADDRINUSE" ? "The AutoCAD helper is already running (port " + PORT + ")." : "Error: " + e.message); process.exit(e.code === "EADDRINUSE" ? 0 : 1); });
server.listen(PORT, HOST, () => {
  console.log("AutoCAD helper for PDF Takeoff — http://" + HOST + ":" + PORT);
  console.log(ACAD.length ? "Uses: " + ACAD.map(acadName).join(", ") : "AutoCAD NOT FOUND — install AutoCAD, or set ZD_ACCORE to accoreconsole.exe");
  console.log("Allowed: " + [...ORIGINS].join(", ") + "\nLeave this running; the takeoff sends DWG files here by itself.");
});

#!/usr/bin/env node
/* Claude Code helper for PDF Takeoff — lets the takeoff agent use Claude through the Claude Code CLI on this computer
   (the user's own Claude plan; no API key). It answers the page the way Ollama does (/api/version, /api/tags, /api/show,
   /api/chat), so the page's local-AI loop runs the same: the page runs the takeoff tools, Claude decides which to call.

   Each chat turn runs `claude -p` once, in an empty temporary folder:
     --restricted          no tools that run commands or code, no web fetch, the user's settings files ignored, file
                           tools confined to that folder;
     --tools Read          the only tool: to look at the picture of the drawing the page sent (saved in that folder);
     --strict-mcp-config   no MCP servers;  --no-session-persistence  nothing kept.
   Only this site may call it (the Origin is checked, and the Host must be this computer), and it listens on 127.0.0.1 only.

     node tools/claude-bridge.js            (then in the takeoff: ⚙ Engine → Claude Code)
   Env: ZD_BRIDGE_PORT (11435), ZD_BRIDGE_ORIGINS (extra allowed origins, comma separated), CLAUDE_BIN (the claude command;
   a .js file is run with node — used by the tests). */
const http = require("http"), {spawn, execFileSync} = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const PORT = +process.env.ZD_BRIDGE_PORT || 11435, HOST = "127.0.0.1", VERSION = "1.0";
const ORIGINS = new Set(["https://sajjadsj44-max.github.io"].concat((process.env.ZD_BRIDGE_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)));
const MODELS = {"claude-code:sonnet": "sonnet", "claude-code:opus": "opus", "claude-code:haiku": "haiku"};
const TURN_MS = 9 * 60 * 1000, MAX_BODY = 40 * 1024 * 1024;

function claudeCmd(){   // [command, leading args]
  let bin = process.env.CLAUDE_BIN || "";
  if (!bin) { const local = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"); bin = fs.existsSync(local) ? local : "claude"; }
  return /\.js$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
}
let CLAUDE_VER = "";
try { const [c, a] = claudeCmd(); CLAUDE_VER = String(execFileSync(c, a.concat(["--version"]), {timeout: 30000, windowsHide: true})).trim(); } catch (e) { CLAUDE_VER = ""; }

const PROTOCOL = `

HOW TOOLS WORK HERE: you cannot run the takeoff tools yourself — the takeoff app on the user's screen runs them.
- To use tools, reply with ONLY one JSON object and nothing else (no prose, no code fence):
  {"tool_calls":[{"name":"<tool name>","arguments":{...}}]}   (one or more calls; arguments must follow the tool's schema)
- The app runs them and sends the results back as TOOL RESULT messages; then continue.
- When you are done, reply to the user in plain text (no JSON).
- Your only own tool is Read, and only to look at the picture files named in the conversation (the drawing as on screen).
TOOLS YOU CAN CALL:
`;

function promptOf(messages, dir){   // -> {sys, text}: the system prompt and the conversation as one message
  let sys = "", n = 0; const parts = [];
  for (const m of messages || []) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (m.role === "system") { sys += (sys ? "\n\n" : "") + c; continue; }
    if (m.role === "user") {
      let pics = "";
      for (const im of m.images || []) { const f = "view-" + (++n) + ".png"; fs.writeFileSync(path.join(dir, f), Buffer.from(String(im).replace(/^data:[^,]*,/, ""), "base64")); pics += `\n[Picture of the drawing as on screen: ${f} — look at it with Read]`; }
      parts.push("USER:\n" + c + pics);
    } else if (m.role === "assistant") {
      const calls = (m.tool_calls || []).map(t => { const f = t.function || t; return {name: f.name, arguments: f.arguments}; });
      parts.push("ASSISTANT:\n" + (calls.length ? JSON.stringify({tool_calls: calls}) : c));
    } else if (m.role === "tool") parts.push("TOOL RESULT" + (m.tool_name ? " (" + m.tool_name + ")" : "") + ":\n" + c);
  }
  parts.push("Reply now as ASSISTANT: either the JSON tool_calls object, or your answer to the user.");
  return {sys, text: parts.join("\n\n")};
}
function toolsText(tools){
  return (tools || []).map(t => { const f = t.function || t; return `- ${f.name}: ${f.description || ""}\n  arguments schema: ${JSON.stringify(f.parameters || f.input_schema || {})}`; }).join("\n");
}
function callsOf(text){   // the reply -> {content, tool_calls}
  const s = String(text || "").trim(), body = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (/^\{[\s\S]*\}$/.test(body)) {
    try { const j = JSON.parse(body), L = Array.isArray(j.tool_calls) ? j.tool_calls : j.name ? [j] : null;
      if (L && L.every(c => c && typeof c.name === "string")) return {content: "", tool_calls: L.map(c => ({function: {name: c.name, arguments: c.arguments && typeof c.arguments === "object" ? c.arguments : {}}}))};
    } catch (e) {}
  }
  return {content: s, tool_calls: undefined};
}
function runClaude(model, sys, text, dir){
  return new Promise((res, rej) => {
    const [cmd, lead] = claudeCmd(), sf = path.join(dir, "system.txt"); fs.writeFileSync(sf, sys);
    const args = lead.concat(["-p", "--restricted", "--strict-mcp-config", "--tools", "Read", "--system-prompt-file", sf, "--no-session-persistence", "--output-format", "json", "--model", model]);
    const p = spawn(cmd, args, {cwd: dir, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
    let out = "", err = ""; const t = setTimeout(() => { p.kill(); rej(new Error("Claude Code did not answer in " + TURN_MS / 60000 + " minutes")); }, TURN_MS);
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { err += d; });
    p.on("error", e => { clearTimeout(t); rej(new Error("Could not start Claude Code (" + e.message + ") — is it installed? Run: claude --version")); });
    p.on("close", code => { clearTimeout(t);
      let j = null; try { j = JSON.parse(out); } catch (e) {}
      if (!j) return rej(new Error("Claude Code: " + (err || out || "exit " + code).trim().slice(0, 400)));
      if (j.is_error) return rej(new Error("Claude Code: " + String(j.result || j.subtype || "error").slice(0, 400)));
      res(j); });
    p.stdin.end(text);
  });
}

function send(res, code, obj, origin){
  const h = {"Content-Type": typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store"};
  if (origin && ORIGINS.has(origin)) Object.assign(h, {"Access-Control-Allow-Origin": origin, "Vary": "Origin"});
  res.writeHead(code, h); res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "", host = String(req.headers.host || "");
  if (!new RegExp("^(127\\.0\\.0\\.1|localhost):" + PORT + "$").test(host)) return send(res, 403, {error: "wrong host"});   // DNS rebinding
  if (origin && !ORIGINS.has(origin)) return send(res, 403, {error: "this site is not allowed: " + origin});
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({"Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600"},
      req.headers["access-control-request-private-network"] ? {"Access-Control-Allow-Private-Network": "true"} : {}));
    return res.end();
  }
  const url = req.url.split("?")[0];
  if (req.method === "GET" && url === "/") return send(res, 200, "Claude Code helper for PDF Takeoff is running", origin);
  if (req.method === "GET" && url === "/api/version") return send(res, 200, {version: "helper " + VERSION + (CLAUDE_VER ? " · " + CLAUDE_VER : " · Claude Code NOT FOUND")}, origin);
  if (req.method === "GET" && url === "/api/tags") return send(res, 200, {models: CLAUDE_VER ? Object.keys(MODELS).map(n => ({name: n, model: n, size: 0, details: {family: "claude", parameter_size: MODELS[n]}})) : []}, origin);
  if (req.method !== "POST" || !origin) return send(res, req.method === "POST" ? 403 : 404, {error: req.method === "POST" ? "requests must come from the takeoff page" : "not found"}, origin);
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, {error: "request too large"}, origin); chunks.push(c); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return send(res, 400, {error: "bad JSON"}, origin); }
  const name = String(body.model || "").replace(/:latest$/, "");
  if (url === "/api/show") return MODELS[name] ? send(res, 200, {capabilities: ["completion", "tools", "vision"], details: {family: "claude"}}, origin) : send(res, 404, {error: "model not found"}, origin);
  if (url !== "/api/chat") return send(res, 404, {error: "not found"}, origin);
  if (!MODELS[name]) return send(res, 404, {error: "model " + name + " not found — choose claude-code:sonnet, :opus or :haiku"}, origin);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zd-claude-")), t0 = Date.now();
  try {
    const {sys, text} = promptOf(body.messages, dir), tools = body.tools || [];
    const j = await runClaude(MODELS[name], (sys || "You help a quantity surveyor with a drawing takeoff.") + (tools.length ? PROTOCOL + toolsText(tools) : ""), text, dir);
    const msg = callsOf(j.result), ms = Date.now() - t0, u = j.usage || {};
    console.log(new Date().toLocaleTimeString() + "  " + name + "  " + (ms / 1000).toFixed(1) + " s  " + (msg.tool_calls ? "tools: " + msg.tool_calls.map(c => c.function.name).join(", ") : "answer"));
    send(res, 200, {model: name, created_at: new Date().toISOString(), message: Object.assign({role: "assistant", content: msg.content}, msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), done: true,
      total_duration: ms * 1e6, eval_count: u.output_tokens || 0, eval_duration: (j.duration_api_ms || ms) * 1e6, prompt_eval_count: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)}, origin);
  } catch (e) { console.log(new Date().toLocaleTimeString() + "  error: " + e.message); send(res, 500, {error: e.message}, origin); }
  finally { try { fs.rmSync(dir, {recursive: true, force: true}); } catch (e) {} }
});
if (require.main === module) {
server.on("error", e => { console.error(e.code === "EADDRINUSE" ? "Port " + PORT + " is in use — the helper is probably already running." : e.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log("Claude Code helper for PDF Takeoff — http://" + HOST + ":" + PORT);
  console.log(CLAUDE_VER ? "Using " + CLAUDE_VER + " (your Claude plan). Allowed site: " + [...ORIGINS].join(", ") : "Claude Code was NOT found — install it, sign in (run: claude), then start this again.");
  console.log("In the takeoff: Engine -> Claude Code. Keep this window open while you use it; close it to stop.");
});
}
module.exports = {promptOf, callsOf, toolsText};

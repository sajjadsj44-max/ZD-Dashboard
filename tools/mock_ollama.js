#!/usr/bin/env node
/* A stand-in for Ollama's HTTP API (/api/version, /api/tags, /api/show, /api/chat) for the PDF Takeoff's local-AI tests.
   It answers like Ollama does — the same JSON shapes, tool calls in message.tool_calls, eval_count / eval_duration — but
   with scripted replies, so the tests check the app's side (tool registry, validation, tool execution, history, metrics,
   CORS refusal) without a model. It is not a model: real-model results come from the in-app benchmark on the user's PC.

     node tools/mock_ollama.js [port] [allowed-origin]      (default 11500, http://127.0.0.1:8765) */
const http = require("http");
const PORT = +(process.argv[2] || 11500), ORIGIN = process.argv[3] || "http://127.0.0.1:8765";
const MODELS = {"mock-tools:8b": ["completion", "tools"], "mock-vision:4b": ["completion", "tools", "vision"]};
const log = [];
const call = (name, args) => ({role: "assistant", content: "", tool_calls: [{function: {name, arguments: args}}]});
function reply(body){
  const M = body.messages || [], last = M[M.length - 1] || {}, user = [...M].reverse().find(m => m.role === "user") || {}, q = String(user.content || "").split("\n").pop().toLowerCase();
  if (last.role === "tool") {   // after a tool ran: say what it returned (from the result itself — no numbers of its own)
    let j = {}; try { j = JSON.parse(last.content); } catch (e) {}
    if (j.error) return {role: "assistant", content: "The tool failed: " + j.error};
    if (j.rooms) return {role: "assistant", content: "Rooms: " + j.rooms.map(r => r.name + " " + r.status + (r.net_sft != null ? " " + r.net_sft + " Sft" : "")).join("; ") + (j.previewed ? " — " + j.previewed + " shown for review, nothing added" : " — added " + j.added)};
    if (j.added && Array.isArray(j.added)) return {role: "assistant", content: "Added: " + j.added.map(a => a.name + " (" + a.id + ")").join(", ")};
    if (j.groups) return {role: "assistant", content: "Groups: " + j.groups.map(g => (g.room || g.floor || g.page) + " " + g.net + " " + g.unit).join("; ")};
    if (j.need_review) return {role: "assistant", content: "Review: " + j.need_review.length + " to check, " + j.duplicates.length + " duplicates"};
    if (j.results) return {role: "assistant", content: j.results.length ? "Found in " + j.results.map(r => r.ref).join("; ") : "Nothing found."};
    if (j.totals) return {role: "assistant", content: "Totals: " + j.totals.map(t => t.condition + " " + t.net + " " + t.unit).join("; ")};
    if (j.rows) return {role: "assistant", content: "Calculation: " + j.rows.map(r => r.dims + " = " + r.qty + " " + r.unit).join("; ")};
    if (j.undone) return {role: "assistant", content: "Undone: " + j.undone};
    if (j.project) return {role: "assistant", content: "Project " + j.project + " has " + j.conditions.length + " conditions."};
    return {role: "assistant", content: "Done."};
  }
  if (/accept/.test(q)) return call("accept_preview", {});
  if (/all (the )?rooms|every room/.test(q)) return call("auto_area_page", {exclude: /shaft/.test(q) ? ["SHAFT"] : [], review: !/now|without review/.test(q)});
  if (/group(ed)? by (room|floor|page)/.test(q)) return call("quantity_totals", {scope: "page", group_by: q.match(/by (room|floor|page)/)[1]});
  if (/check|validate/.test(q)) return call("validate_takeoff", {scope: "page"});
  if (/search|what does|spec/.test(q)) return call("search_knowledge", {query: q.replace(/^.*?(search( for)?|what does)\s*/, "")});
  if (/bad args/.test(q)) return call("count_tags", {});
  if (/json in text/.test(q)) return {role: "assistant", content: 'Sure. {"name": "get_project_context", "arguments": {}}'};
  if (/total/.test(q)) return call("quantity_totals", {scope: "page"});
  if (/calculation|explain/.test(q)) return call("explain_measurement", {});
  if (/undo/.test(q)) return call("undo_last", {});
  if (/project|conditions/.test(q)) return call("get_project_context", {});
  if (/bedroom|measure/.test(q)) return call("measure_rooms", {names: ["BED ROOM"]});
  if (/doors? .*d1|d1/.test(q)) return call("count_tags", {what: "D1", scope: "page"});
  return {role: "assistant", content: "I don't know that — I have no internet and it is not in this project."};
}
http.createServer((req, res) => {
  const o = req.headers.origin, H = {"Content-Type": "application/json"};
  if (o === ORIGIN) Object.assign(H, {"Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"});
  else if (o) { res.writeHead(403, {"Content-Type": "text/plain"}); return res.end(); }   // Ollama: an origin not in OLLAMA_ORIGINS gets 403
  if (req.method === "OPTIONS") { res.writeHead(204, H); return res.end(); }
  let raw = ""; req.on("data", d => raw += d); req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {}, u = req.url.split("?")[0], send = (j, st) => { res.writeHead(st || 200, H); res.end(JSON.stringify(j)); };
    if (u === "/__log") return send(log);
    if (u === "/api/version") return send({version: "0.0.0-mock"});
    if (u === "/api/tags") return send({models: Object.keys(MODELS).map(n => ({name: n, model: n, size: 5e9, details: {parameter_size: n.split(":")[1].toUpperCase(), quantization_level: "Q4_K_M", family: "mock"}}))});
    if (u === "/api/show") return MODELS[body.model] ? send({capabilities: MODELS[body.model]}) : send({error: "model '" + body.model + "' not found"}, 404);
    if (u === "/api/chat") {
      if (!MODELS[body.model]) return send({error: "model '" + body.model + "' not found"}, 404);
      log.push({model: body.model, n: (body.messages || []).length, sys: ((body.messages || [])[0] || {}).content || "", images: (body.messages || []).some(m => (m.images || []).length), tools: (body.tools || []).map(t => t.function.name), last: (body.messages || []).slice(-1)[0]});
      return send({model: body.model, created_at: new Date().toISOString(), message: reply(body), done: true, done_reason: "stop", total_duration: 1.2e9, eval_count: 40, eval_duration: 1e9, prompt_eval_count: 900});
    }
    send({error: "not found"}, 404);
  });
}).listen(PORT, "127.0.0.1", () => console.log("mock ollama on " + PORT));

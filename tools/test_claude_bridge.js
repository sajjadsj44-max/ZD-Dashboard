#!/usr/bin/env node
/* The Claude Code engine: tools/claude-bridge.js with a fake `claude` (tools/fake_claude.js — no network), then the takeoff
   page talking to it: ⚙ Engine shows the Claude Code choice; a chat message goes through the helper, the page runs the tool
   Claude asked for, and the answer comes back. Also: only the allowed site, only this computer's host name.

     python -m http.server 8765 --bind 127.0.0.1      (from the repo root)
     node tools/test_claude_bridge.js                  (TK_URL / TK_LIBS as for test_takeoff.js; uses port 11435)
*/
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http"), {spawn} = require("child_process");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const {makePdf} = require("./takeoff_fixture.js");
const URL = process.env.TK_URL || "http://127.0.0.1:8765/takeoff/", LIBS = process.env.TK_LIBS || "", SITE = new globalThis.URL(URL).origin, PORT = 11435;
let fails = 0, passes = 0;
function ok(c, m){ if (c) { passes++; console.log("  ✓ " + m); } else { fails++; console.log("  ✗ " + m); } }
const req = (method, p, body, headers) => new Promise(res => { const r = http.request({host: "127.0.0.1", port: PORT, path: p, method, headers: Object.assign({"Content-Type": "application/json"}, headers || {})}, s => { let d = ""; s.on("data", c => { d += c; }); s.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res({code: s.statusCode, text: d, json: j, h: s.headers}); }); }); r.on("error", e => res({code: 0, text: String(e)})); if (body) r.write(JSON.stringify(body)); r.end(); });

(async () => {
  const B = require("./claude-bridge.js");
  console.log("helper: parts");
  ok(B.callsOf('```json\n{"tool_calls":[{"name":"count_tags","arguments":{"what":"D1"}}]}\n```').tool_calls[0].function.arguments.what === "D1", "a JSON reply (even fenced) becomes a tool call");
  ok(B.callsOf("There are 4 doors.").content === "There are 4 doors." && !B.callsOf("There are 4 doors.").tool_calls, "plain text stays the answer");
  ok(B.callsOf('{"tool_calls":[{"arguments":{}}]}').tool_calls === undefined, "a call without a name is not taken as a tool call");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zdbt-")), pr = B.promptOf([{role: "system", content: "SYS"}, {role: "user", content: "hi", images: [Buffer.from("png").toString("base64")]}, {role: "assistant", content: "", tool_calls: [{function: {name: "x", arguments: {a: 1}}}]}, {role: "tool", tool_name: "x", content: "{\"n\":2}"}], dir);
  ok(pr.sys === "SYS" && /USER:\nhi/.test(pr.text) && /view-1\.png/.test(pr.text) && fs.existsSync(path.join(dir, "view-1.png")) && /"tool_calls":\[\{"name":"x"/.test(pr.text) && /TOOL RESULT \(x\):/.test(pr.text), "the conversation, the picture (as a file) and the tool traffic go into the prompt");
  fs.rmSync(dir, {recursive: true, force: true});

  console.log("helper: running");
  const log = path.join(os.tmpdir(), "zd-fake-claude-" + Date.now() + ".log");
  const br = spawn(process.execPath, [path.join(__dirname, "claude-bridge.js")], {env: Object.assign({}, process.env, {CLAUDE_BIN: path.join(__dirname, "fake_claude.js"), FAKE_LOG: log, ZD_BRIDGE_ORIGINS: SITE}), stdio: ["ignore", "pipe", "pipe"]});
  let brOut = ""; br.stdout.on("data", d => { brOut += d; }); br.stderr.on("data", d => { brOut += d; });
  for (let i = 0; i < 50 && !/running|http:\/\//.test(brOut); i++) await new Promise(r => setTimeout(r, 100));
  const browser = await pw.chromium.launch();
  try {
    let r = await req("GET", "/"); ok(r.code === 200 && /helper/.test(r.text), "GET / says the helper is running");
    r = await req("GET", "/api/version"); ok(/9\.9\.9/.test(r.json && r.json.version), "version names the Claude Code found (" + (r.json && r.json.version) + ")");
    r = await req("GET", "/api/tags"); ok(r.json && r.json.models.map(m => m.name).join() === "claude-code:sonnet,claude-code:opus,claude-code:haiku", "three models: sonnet, opus, haiku");
    r = await req("POST", "/api/chat", {model: "claude-code:sonnet", messages: [{role: "user", content: "hi"}]}, {Origin: "https://evil.example"}); ok(r.code === 403, "another website is refused (403)");
    r = await req("POST", "/api/chat", {model: "claude-code:sonnet", messages: [{role: "user", content: "hi"}]}); ok(r.code === 403, "a POST with no Origin (not from a page) is refused");
    r = await req("GET", "/api/tags", null, {Host: "attacker.example:" + PORT}); ok(r.code === 403, "a request for another host name is refused (DNS rebinding)");
    r = await req("OPTIONS", "/api/chat", null, {Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"}); ok(r.code === 204 && r.h["access-control-allow-origin"] === SITE && r.h["access-control-allow-private-network"] === "true", "the allowed site's preflight passes (with private-network access)");
    r = await req("POST", "/api/show", {model: "claude-code:opus"}, {Origin: SITE}); ok(r.json && r.json.capabilities.includes("tools") && r.json.capabilities.includes("vision"), "the models can use tools and see pictures");
    r = await req("POST", "/api/chat", {model: "gpt-4", messages: []}, {Origin: SITE}); ok(r.code === 404, "an unknown model is refused");

    console.log("the takeoff page with the Claude Code engine");
    const ctx = await browser.newContext({viewport: {width: 1440, height: 900}}); await require("./zd_unlock")(ctx);
    if (LIBS) await ctx.route(/cdn\.jsdelivr\.net/, rt => { const u = rt.request().url(), H = {"Access-Control-Allow-Origin": "*"}, js = "text/javascript";
      if (/pdf\.worker\.min\.mjs/.test(u)) return rt.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.worker.min.mjs"), contentType: js, headers: H});
      if (/pdf\.min\.mjs/.test(u)) return rt.fulfill({path: path.join(LIBS, "pdfjs-dist/build/pdf.min.mjs"), contentType: js, headers: H}); return rt.abort(); });
    const page = await ctx.newPage(), errors = [], T = (f, a) => page.evaluate(f, a), wait = ms => page.waitForTimeout(ms || 200);
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(URL, {waitUntil: "load"}); await wait(600);
    await page.click("#bNewProj"); await page.fill("#dlgName", "Claude Code engine"); await page.click("#dlgOk"); await wait(400);
    await page.setInputFiles("#fileIn", {name: "plans.pdf", mimeType: "application/pdf", buffer: makePdf()});
    await page.waitForFunction(() => zdTakeoff.S.page, null, {timeout: 20000}); await wait(300);
    const dlg = T(() => zdTakeoff.locSetup()); await wait(800);
    ok(await T(() => !!document.querySelector('input[name=leEng][value=cc]') && document.getElementById("leCcModel").options.length === 3), "⚙ Engine offers Claude Code and its three models");
    await page.check('input[name=leEng][value=cc]'); await page.selectOption("#leCcModel", "claude-code:haiku"); await page.click("#leTest"); await wait(1200);
    ok(/claude-code:haiku ready/.test(await page.innerText("#leSt")), "Test connection with Claude Code chosen: " + (await page.innerText("#leSt")).slice(0, 90));
    await page.click("#dlgOk"); await dlg; await wait(300);
    ok(await T(() => localStorage.getItem("zdTakeoffAiEngine") === "cc" && localStorage.getItem("zdTakeoffCcModel") === "claude-code:haiku" && zdTakeoff.LOC.st === "ready"), "saved: engine Claude Code, model haiku, status ready");
    await T(() => zdTakeoff.aiSend("what is in this project?")); await wait(800);
    const L = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(x => JSON.parse(x)) : [];
    ok(L.length >= 2, "two turns went to Claude: the tool call and the answer (" + L.length + ")");
    ok(L[0] && L[0].sysHasTools && L[0].pics.length === 1 && L[0].args.includes("haiku") && L[0].args.includes("--restricted") && L[0].args.join(" ").includes("--tools Read"), "turn 1: instructions + tool list as the system prompt, the view as a picture, haiku, restricted to Read");
    ok(L[1] && /TOOL RESULT \(get_project_context\)/.test(L[1].input), "turn 2 carries the result of get_project_context, which the page ran");
    const chat = await T(() => document.getElementById("aiLog") ? document.getElementById("aiLog").innerText : document.body.innerText);
    ok(/done \(fake Claude\)/.test(chat) && /Claude Code · haiku/.test(chat) && /your Claude plan/.test(chat), "the answer shows in the chat with “Claude Code · haiku · … your Claude plan”");
    br.kill(); await wait(500); await T(() => zdTakeoff.locHealth());
    ok(await T(() => zdTakeoff.LOC.st === "offline" && /Start Claude helper/.test(zdTakeoff.LOC.msg)), "helper stopped: the status says to start it");
    ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""));
  } finally { br.kill(); await browser.close(); try { fs.unlinkSync(log); } catch (e) {} }
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

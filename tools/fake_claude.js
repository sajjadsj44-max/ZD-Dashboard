#!/usr/bin/env node
/* a stand-in for the `claude` command in tests of tools/claude-bridge.js: no network, answers by rule.
   First turn: asks the page to run get_project_context; after a TOOL RESULT: a plain answer. Logs what it got to FAKE_LOG. */
const fs = require("fs"), path = require("path"), a = process.argv.slice(2);
if (a.includes("--version")) { console.log("9.9.9 (Claude Code)"); process.exit(0); }
let input = ""; process.stdin.on("data", d => { input += d; }); process.stdin.on("end", () => {
  const sf = a[a.indexOf("--system-prompt-file") + 1], sys = sf && fs.existsSync(sf) ? fs.readFileSync(sf, "utf8") : "";
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({args: a, cwd: process.cwd(), pics: fs.readdirSync(process.cwd()).filter(f => /\.png$/.test(f)), sysHasTools: /TOOLS YOU CAN CALL/.test(sys) && /get_project_context/.test(sys), input: input.slice(0, 4000)}) + "\n");
  const result = /TOOL RESULT/.test(input) ? "The project has its conditions listed — done (fake Claude)." : /get_project_context/.test(sys) ? '```json\n{"tool_calls":[{"name":"get_project_context","arguments":{}}]}\n```' : "Hello from fake Claude.";
  process.stdout.write(JSON.stringify({type: "result", is_error: false, result, duration_api_ms: 1200, usage: {input_tokens: 10, output_tokens: 20}}));
});

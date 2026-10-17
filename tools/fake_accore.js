#!/usr/bin/env node
/* A stand-in for AutoCAD's accoreconsole.exe in the tests of tools/cad-bridge.js: `fake_accore.js /i <dwg> /s <script> …`.
   It reads the script the helper wrote and "saves" the DXF it names — a copy of the fixture next to the DWG's name in
   cad_fixtures (zd_test_2018.dwg -> zd_test_2018.dxf, matched by the DWG's bytes). FAKE_ACCORE_NO_BINARY: a binary save
   writes nothing (as an AutoCAD that cannot), so the helper's text-DXF try is exercised. */
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2), dwg = a[a.indexOf("/i") + 1], scr = a[a.indexOf("/s") + 1];
const lines = fs.readFileSync(scr, "latin1").split(/\r?\n/), out = lines.find(l => /\.dxf$/i.test(l));
const binary = lines.includes("_B") && lines.indexOf("_B") > lines.indexOf("_.SAVEAS");
process.stdout.write(Buffer.from("Command: _.SAVEAS\r\n", "utf16le"));
if (!(binary && process.env.FAKE_ACCORE_NO_BINARY)) {
  const fx = path.join(__dirname, "cad_fixtures"), buf = fs.readFileSync(dwg);
  const twin = fs.readdirSync(fx).filter(n => /\.dwg$/i.test(n)).find(n => fs.readFileSync(path.join(fx, n)).equals(buf));
  const dxf = twin && path.join(fx, twin.replace(/\.dwg$/i, ".dxf"));
  if (dxf && fs.existsSync(dxf)) fs.copyFileSync(dxf, out);
}
process.exit(0);

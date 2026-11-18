#!/usr/bin/env node
/* The page an AutoCAD drawing is laid out on (takeoff/cad.js cadScene) when a group of objects lies far from the plans — plain
   Node, no browser:

     TK_LIBS=/path/with/node_modules node tools/test_cad_extents.js      # TK_LIBS holds @mlightcad/dxf-json

   IVORY (23 IVORY, Working Layout Plans) has some 10,500 of its 456,000 pieces — dimensions — about 30 miles from its plans: 2.3 %
   of the drawing, more than the 1 % the far-object rule left out, so the page was laid out at 1:48000, a shop a fraction of a
   point wide, and Auto area found no room. Generated DXFs (inches): a plan of 3,000 lines with a far group of 2 %, 3 %, 4 % —
   left off the page, laid out as the plan alone; 12 % — a real part of the drawing, kept; none — as before. And the lines
   indexed for snapping keep a wall's 4" end on a drawing laid out small. */
const fs = require("fs"), path = require("path"), os = require("os"), {pathToFileURL} = require("url");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
(async () => {
  const LIBS = process.env.TK_LIBS || "";
  const dj = path.join(LIBS, "@mlightcad/dxf-json/dist/esm/bundle.mjs");
  if (!LIBS || !fs.existsSync(dj)) { console.log("TK_LIBS must hold @mlightcad/dxf-json — see the header"); process.exit(2); }
  const tmp = path.join(os.tmpdir(), "zd-cad-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(__dirname, "..", "takeoff", "cad.js"), tmp);
  const C = await import(pathToFileURL(tmp).href); fs.unlinkSync(tmp);
  C.cadUse({dxf: await import(pathToFileURL(dj).href)});
  const dxf = lines => ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "1", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
    .concat(...lines.map(([x0, y0, x1, y1, L]) => ["0", "LINE", "8", L || "Wall", "10", String(x0), "20", String(y0), "30", "0", "11", String(x1), "21", String(y1), "31", "0"]))
    .concat(["0", "ENDSEC", "0", "EOF"]).join("\n");
  // the plan: 1,500 shop partitions 4" thick (two faces + two 4" ends each... here the faces) in a 2,000" x 1,200" block
  const plan = []; for (let i = 0; i < 1500; i++) { const x = (i % 50) * 40, y = Math.floor(i / 50) * 40; plan.push([x, y, x, y + 30], [x + 4, y, x + 4, y + 30]); }
  const far = n => { const o = []; for (let i = 0; i < n; i++) o.push([1950000 + (i % 20) * 50, 470000 + Math.floor(i / 20) * 50, 1950000 + (i % 20) * 50 + 40, 470000 + Math.floor(i / 20) * 50, "Dim line Inner"]); return o; };
  const scene = async lines => C.cadScene(await C.cadRead(new TextEncoder().encode(dxf(lines)).buffer, "t.dxf"));
  const base = await scene(plan), b = base.pages[0];
  console.log("the plan alone");
  ok(b.den <= 96 && base.stats.far === 0, "laid out at 1:" + b.den + ", nothing left off (" + base.stats.far + ")");
  for (const [pc, n] of [[2, 61], [3, 93], [4, 125]]) {
    const s = await scene(plan.concat(far(n))), p = s.pages[0];
    console.log("a group of " + n + " lines (" + pc + " %) some 30 miles off");
    ok(p.den === b.den, "laid out as the plan alone, 1:" + p.den + " (not 1:48000)");
    ok(s.stats.far === n, "the far group left off the page and said so (" + s.stats.far + " objects)");
  }
  { const s = await scene(plan.concat(far(400))), p = s.pages[0];
    console.log("a far group of 400 lines (12 %): a real part of the drawing");
    ok(s.stats.far === 0 && p.den > 9600, "kept on the page (1:" + p.den + ", " + s.stats.far + " left off)"); }
  { // a plan set 120,000" wide (ten floors side by side): laid out at 1:4800, 0.18 pt per ft — a 2" piece is 0.03 pt there, under the
    // 0.05 pt that was the cut-off for every drawing
    const big = []; for (let i = 0; i < 1500; i++) { const x = (i % 50) * 2400, y = Math.floor(i / 50) * 2400; big.push([x, y, x, y + 300], [x + 4, y, x + 4, y + 300]); }
    const s = await scene(big), p = s.pages[0], ix = C.cadIndex(p);
    const bits = []; for (let i = 0; i < 1500; i++) { const x = (i % 50) * 2400, y = Math.floor(i / 50) * 2400; bits.push([x + 100, y + 100, x + 102, y + 100]); }
    const s2 = await scene(big.concat(bits)), p2 = s2.pages[0], ix2 = C.cadIndex(p2);
    console.log("lines indexed for snapping / Auto area on a drawing laid out small");
    ok(p2.den === 4800, "the plan set laid out at 1:" + p2.den);
    ok(ix2.segs.length - ix.segs.length === 1500, "each 2\" piece is indexed (" + (ix2.segs.length - ix.segs.length) + " of 1500)"); }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("FATAL", e); process.exit(1); });

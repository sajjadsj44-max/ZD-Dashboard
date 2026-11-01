/* ZD PDF Takeoff — an AutoCAD drawing read in a worker (cad.js): the page stays responsive while a big DWG is read, and the
   reader's memory (the WebAssembly and the whole drawing as objects) goes away with the worker. In: {buf, name, map, pdfLib, reader};
   out: progress {step}, then {ok, scene, pdf} — the scene's typed arrays and the PDF moved across, not copied — or {ok: false, error}.
   A DWG LibreDWG cannot read whole is read by the second DWG reader, which runs in a frame of the page (Chrome cannot start it in a
   worker): out {need2}, in {dxf2, notes} (the drawing as a binary DXF) or {err2}. */
const V = new URL(import.meta.url).search;   // cad.js with this worker's own ?v= (the page passes takeoff.js's)
let C = null, PL = null, ask2 = null;
self.onmessage = async e => {
  if (e.data && (e.data.dxf2 || e.data.err2)) { const a = ask2; ask2 = null; if (a) { if (e.data.dxf2) a.ok({dxf: new Uint8Array(e.data.dxf2), notes: e.data.notes || 0}); else a.bad(new Error(e.data.err2)); } return; }
  const {buf, name, map, pdfLib, reader} = e.data || {}, say = step => self.postMessage({step});
  const net = () => new Promise((ok, bad) => { ask2 = {ok, bad}; self.postMessage({need2: true}); });   // (the page has the DWG still)
  try {
    if (!C) { say("load"); C = await import("./cad.js" + V); }
    say("read"); const md = await C.cadRead(buf, name, {say, net, reader});   // (say: "read2" when the second DWG reader takes over)
    say("scene"); const sc = C.cadScene(md, map ? {map} : undefined);
    say("pdf"); if (!PL) PL = await import(pdfLib); const pdf = await C.cadPdf(sc, PL, {title: name});
    const moved = new Set([pdf.buffer]);
    sc.pages.forEach(pg => Object.values(pg).forEach(v => { if (ArrayBuffer.isView(v) && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) moved.add(v.buffer); }));
    self.postMessage({ok: true, scene: sc, pdf}, [...moved]);
  } catch (er) { self.postMessage({ok: false, error: String(er && er.message || er)}); }
};

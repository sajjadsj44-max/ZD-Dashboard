/* ZD PDF Takeoff — an AutoCAD drawing read in a worker (cad.js): the page stays responsive while a big DWG is read, and the
   reader's memory (the WebAssembly and the whole drawing as objects) goes away with the worker. In: {buf, name, map, pdfLib};
   out: progress {step}, then {ok, scene, pdf} — the scene's typed arrays and the PDF moved across, not copied — or {ok: false, error}. */
const V = new URL(import.meta.url).search;   // cad.js with this worker's own ?v= (the page passes takeoff.js's)
let C = null, PL = null;
self.onmessage = async e => {
  const {buf, name, map, pdfLib} = e.data || {}, say = step => self.postMessage({step});
  try {
    if (!C) { say("load"); C = await import("./cad.js" + V); }
    say("read"); const md = await C.cadRead(buf, name);
    say("scene"); const sc = C.cadScene(md, map ? {map} : undefined);
    say("pdf"); if (!PL) PL = await import(pdfLib); const pdf = await C.cadPdf(sc, PL, {title: name});
    const moved = new Set([pdf.buffer]);
    sc.pages.forEach(pg => Object.values(pg).forEach(v => { if (ArrayBuffer.isView(v) && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) moved.add(v.buffer); }));
    self.postMessage({ok: true, scene: sc, pdf}, [...moved]);
  } catch (er) { self.postMessage({ok: false, error: String(er && er.message || er)}); }
};

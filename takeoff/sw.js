/* ZD PDF Takeoff — offline-first PWA service worker.
   The app's own files (index.html, takeoff.js?v=…, cad.js, …) are NETWORK-FIRST: online, every load fetches the current file
   (revalidated, never the browser's 10-minute copy), so a new release is never run under an old script — the ?v= rule holds.
   They are kept as a fallback for site work with no signal. The pinned CDN libraries (pdf.js, pdf-lib, ExcelJS, Tesseract,
   a version in every URL) are CACHE-FIRST: once fetched they never change. Projects and PDFs are in IndexedDB, not here.
   Only GET is handled: the password lock, Claude API calls and anything else is passed through untouched and never cached. */
const APP = "zd-takeoff-app-v1", LIBS = "zd-takeoff-libs-v1";
const CDN = /^https:\/\/(?:cdn\.jsdelivr\.net\/npm\/|cdnjs\.cloudflare\.com\/|unpkg\.com\/|tessdata\.projectnaptha\.com\/)/;
self.addEventListener("install", e => { e.waitUntil(caches.open(APP).then(c => c.addAll(["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"].map(u => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()).catch(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("zd-takeoff-") && k !== APP && k !== LIBS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function appFirstNet(req){
  const c = await caches.open(APP);
  try {
    const r = await fetch(req, {cache: "no-cache"});
    if (r && r.ok) {
      const u = new URL(req.url); const old = await c.keys();   // one copy per file: a new ?v= replaces the old one
      await Promise.all(old.filter(k => { const o = new URL(k.url); return o.pathname === u.pathname && o.search !== u.search; }).map(k => c.delete(k)));
      await c.put(req, r.clone());
    }
    return r;
  } catch (err) {
    const hit = await c.match(req) || await c.match(req, {ignoreSearch: true});
    if (hit) return hit;
    if (req.mode === "navigate") { const idx = await c.match("index.html") || await c.match("./"); if (idx) return idx; }
    throw err;
  }
}
async function libFirst(req){
  const c = await caches.open(LIBS), hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r;
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) { if (u.pathname.startsWith(new URL("./", self.location).pathname)) e.respondWith(appFirstNet(req)); }
  else if (CDN.test(req.url)) e.respondWith(libFirst(req));
});

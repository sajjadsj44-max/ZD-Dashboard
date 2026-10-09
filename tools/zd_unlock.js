/* The dashboards ask for their password every time a page is opened — nothing is remembered. A test browser types it in on every
   page it opens, as a person would: into the lock's own field, then its Unlock button (the page still checks it).

     await require("./zd_unlock")(ctx);   // once, right after browser.newContext()

   ZD_PASSWORD overrides the password (default: the dashboards' own). {sw: true} as the third argument leaves service workers on. */
module.exports = async function zdUnlock(ctx, pw, opts){
  /* no service worker in a test browser unless asked for ({sw: true}): a worker's own requests (the CDN libraries it caches) bypass
     the test's page.route() answers, which would leave the app without pdf.js in an offline run */
  if (!(opts && opts.sw)) await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) {} });
  await ctx.addInitScript(p => {
    const go = () => { const i = document.getElementById("zd-lock-input"), b = i && i.parentNode.querySelector("button"); if (!b) return false;
      i.value = p; i.dispatchEvent(new Event("input", {bubbles: true})); b.click(); return true; };
    const watch = () => { if (go()) return; const mo = new MutationObserver(() => { if (go()) mo.disconnect(); }); mo.observe(document.documentElement, {childList: true, subtree: true}); setTimeout(() => mo.disconnect(), 15000); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
    window.addEventListener("pageshow", e => { if (e.persisted) setTimeout(watch, 0); });
  }, pw || process.env.ZD_PASSWORD || "123");
};

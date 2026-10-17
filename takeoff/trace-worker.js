/* Vector trace off the page's thread: the whole floor is read in a few seconds while the page stays live.
   Loaded with takeoff.js's own ?v= (trace.js too), so a new release never runs an old trace. */
let T = null;
self.onmessage = async e => {
  const {id, inp, opt} = e.data || {};
  try {
    if (!T) T = await import("./trace.js" + self.location.search);
    self.postMessage({id, res: T.traceFloor(inp, opt)});
  } catch (err) { self.postMessage({id, res: {err: "the trace failed: " + (err && err.message || err)}}); }
};

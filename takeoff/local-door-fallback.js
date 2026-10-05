(() => {
  const wrapped = new WeakSet();

  function addMessage(doc, text, role = "bot") {
    const log = doc && doc.getElementById("aiLog");
    if (!log) return;
    const item = doc.createElement("div");
    item.className = "aimsg " + role;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  async function withDoorSwingReview(api, doc, openDialog) {
    const fileId = api.S.fileId;
    const pageNo = api.S.pageNo;
    if (!fileId || !pageNo || !api.P.proj || !api.S.page) return openDialog();

    const text = await api.pageTexts(fileId, pageNo);
    const planTags = api.tagsOf(text).plan;
    const hasDoorTags = Object.keys(planTags).some(mark => {
      const parsed = api.tagParse(mark);
      return parsed && parsed.fam === "Doors";
    });
    if (hasDoorTags) return openDialog();

    const scale = api.scaleState(api.P.proj.scales[api.S.key]);
    let candidates = [];
    if (scale && scale.k === "ok") candidates = api.doorSwings() || [];

    if (!candidates.length) {
      const why = scale && scale.k === "ok"
        ? "No searchable door tags or supported vector door-swing arcs were detected on this page. This is inconclusive—not proof that there are no doors. Check the scale and drawing, then use manual count or Find Similar if available."
        : "No searchable door tags were detected, and the page scale is not verified, so automatic door-swing detection is unavailable. Verify the scale first; this result is not a zero-door confirmation.";
      addMessage(doc, why);
      return openDialog();
    }

    const noun = candidates.length === 1 ? "candidate" : "candidates";
    addMessage(doc, `No searchable door tags were found, but the verified-scale vector drawing has ${candidates.length} possible door-swing ${noun}. These are unverified candidates, not a door count. I preselected the existing door-swing review option; scan and confirm only if the candidates look right.`);

    const pending = openDialog();
    let checkbox = doc && doc.getElementById("dwSw");
    for (let attempt = 0; !checkbox && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      checkbox = doc && doc.getElementById("dwSw");
    }
    if (!checkbox) {
      addMessage(doc, "Could not preselect the swing option. In the Doors / windows dialog, tick ‘Also door swing symbols on this page’ manually.", "err");
      return pending;
    }
    checkbox.checked = true;
    return pending;
  }

  window.installLocalDoorFallback = (api, doc) => {
    if (!api || typeof api.doorWinDialog !== "function" || wrapped.has(api)) return;
    const openDialog = api.doorWinDialog;
    api.doorWinDialog = function() {
      return withDoorSwingReview(api, doc, openDialog.bind(api));
    };
    wrapped.add(api);
  };
})();

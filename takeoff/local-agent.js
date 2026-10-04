const frame = document.getElementById("takeoffFrame");
const status = document.getElementById("agentStatus");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;

function addMessage(doc, role, text) {
  const item = doc.createElement("div");
  item.className = "aimsg " + role;
  item.textContent = text;
  const log = doc.getElementById("aiLog");
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function targetPages(api, question) {
  const project = api.P.proj;
  const currentFile = project.files.find(file => file.id === api.S.fileId);
  if (/\b(project|all\s+pdfs?|every\s+pdf|all\s+drawings)\b/i.test(question)) {
    return project.files.flatMap(file => Array.from({length: file.pages || 1}, (_, index) => ({file, page: index + 1})));
  }
  if (/\b(this\s+pdf|whole\s+pdf|every\s+page|all\s+pages)\b/i.test(question) && currentFile) {
    return Array.from({length: currentFile.pages || 1}, (_, index) => ({file: currentFile, page: index + 1}));
  }
  return currentFile ? [{file: currentFile, page: api.S.pageNo}] : [];
}

function pageLabel(api, file, page) {
  const sheet = (api.P.proj.sheets || {})[file.id + ":" + page] || {};
  return [file.name, sheet.no, sheet.title, "p." + page].filter(Boolean).join(" · ");
}

async function drawingCount(api, question) {
  const pages = targetPages(api, question);
  if (!pages.length) return "Open a drawing page first.";
  const limit = 300;
  const scan = pages.slice(0, limit);
  const scope = scan.length === 1 ? pageLabel(api, scan[0].file, scan[0].page) : scan.length + " selected drawing pages";
  const q = question.toLowerCase();

  if (/\b(apartments?|units?|flats?)\b/.test(q)) {
    const found = [];
    for (const {file, page} of scan) {
      const units = await api.unitsOf(file.id, page);
      units.forEach(unit => found.push({file, page, unit}));
    }
    if (!found.length) return `No confidently labelled apartment/unit numbers were detected on ${scope}. This is not a visual zero: the local agent reads searchable PDF text, not drawing pixels. Open the sheet and use the Apartment agent to inspect its labels.`;
    const unique = new Map(found.map(row => [row.file.id + ":" + row.unit.no, row]));
    const rows = [...unique.values()];
    return `${rows.length} likely apartment/unit labels on ${scope}: ${rows.map(row => `${row.unit.no}${row.unit.type ? " (" + row.unit.type + ")" : ""}`).join(", ")}. Read-only estimate from searchable text; check the plan labels.`;
  }

  if (/\b(door|doors|window|windows|ventilator|ventilators)\b/.test(q)) {
    const exact = /\b([A-Z]{1,5}\s*[-./]?\s*\d{1,3}[A-Z]?)\b/i.exec(question);
    const requested = exact && api.tagParse(exact[1]);
    const family = requested ? requested.fam : /\bwindow/.test(q) ? "Windows" : /\bventilator/.test(q) ? "Ventilators" : "Doors";
    const found = [];
    for (const {file, page} of scan) {
      const text = await api.pageTexts(file.id, page);
      const plan = api.tagsOf(text).plan;
      for (const [mark, points] of Object.entries(plan)) {
        const parsed = api.tagParse(mark);
        if (parsed && parsed.fam === family && (!requested || parsed.k === requested.k)) found.push({file, page, mark: parsed.k, count: points.length});
      }
    }
    const total = found.reduce((sum, row) => sum + row.count, 0);
    if (!total) return `No searchable ${requested ? requested.k : family.toLowerCase()} tags were found on ${scope}. This does not prove there are none: untagged symbols and scanned drawings need the Doors / Windows agent's symbol option or a visual check.`;
    const breakdown = found.map(row => `${row.mark}: ${row.count} (${pageLabel(api, row.file, row.page)})`).join("; ");
    return `${total} tagged ${family.toLowerCase()} on ${scope}: ${breakdown}. Read-only count from plan tags; schedule-table entries are excluded, but verify untagged symbols.`;
  }

  const roomType = /\b(bath(?:room)?s?|toilets?|w\.?c\.?|powder(?:\s+rooms?)?|wash\s?rooms?|bed(?:room)?s?|kitchens?|lounges?|living\s+rooms?)\b/i.exec(question);
  if (roomType || /\brooms?\b/i.test(q)) {
    const roomName = roomType && roomType[0].toLowerCase();
    const matches = [];
    for (const {file, page} of scan) {
      const facts = await api.drawingFacts(file.id, page);
      const rooms = roomName
        ? facts.rooms.filter(room => api.nameLike(room.name, roomName.replace(/s$/, "")) || new RegExp(roomName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/s\??$/, "s?"), "i").test(room.name))
        : facts.rooms;
      rooms.forEach(room => matches.push({file, page, room}));
    }
    if (!matches.length) return `No searchable ${roomName || "room"} labels were detected on ${scope}. This is not a visual zero; scanned drawings or unlabeled symbols need manual review.`;
    const names = matches.map(row => `${row.room.name} (${pageLabel(api, row.file, row.page)})`);
    return `${matches.length} likely ${roomName || "room"} labels on ${scope}: ${names.join(", ")}. Read-only count from PDF text; check repeated or split room labels.`;
  }
  return null;
}

function addClarification(doc, question) {
  const q = question.toLowerCase();
  const feet = /\b\d+(?:\.\d+)?\s*(?:ft|feet|foot|['’′])/.test(q);
  const inches = /\b\d+(?:\.\d+)?\s*(?:in(?:ch(?:es)?)?|["”″])/.test(q);
  if (!/\bwalls?\b/.test(q) || !feet || inches) return false;
  addMessage(doc, "bot", "Before I draw anything: does 4′ mean a 4 ft wall run, 4 in wall thickness, or a 4 ft wall height? The automatic wall agent detects wall thickness from paired vector lines; it does not guess run length or height. Reply with the intended dimension, for example: ‘4 inch thick walls’. ");
  return true;
}

async function submit(api, doc, input, button) {
  if (busy) return;
  const question = input.value.trim();
  if (!question) return;
  busy = true;
  button.disabled = true;
  input.disabled = true;
  input.value = "";
  addMessage(doc, "user", question);
  try {
    if (addClarification(doc, question)) return;

    if (/\b(draw|trace|make|create)\b/i.test(question) && /\b(room|polyline|polygon|outline)\b/i.test(question)) {
      const allRooms = /\b(all|every|each)\b/i.test(question);
      const cleaned = question.toLowerCase().replace(/\b(draw|trace|make|create|a|an|the|room|rooms|polyline|polygon|outline|please|of|for)\b/g, " ").replace(/\s+/g, " ").trim();
      if (!allRooms && !cleaned) {
        addMessage(doc, "bot", "Which room should I trace? Type its label (for example, ‘draw the bedroom polyline’) or say ‘draw all room polylines’. I will not guess the room.");
        return;
      }
      await api.agentCmd(allRooms ? "measure all rooms" : "measure " + cleaned, true);
      return;
    }

    if (/^\s*how\s+(many|much)\b/i.test(question)) {
      const answer = await drawingCount(api, question);
      if (answer) {
        addMessage(doc, "bot", answer);
        return;
      }
    }

    await api.agentCmd(question, true);
  } catch (error) {
    addMessage(doc, "err", "Local agent failed: " + (error && error.message ? error.message : String(error)));
  } finally {
    busy = false;
    button.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

async function start() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const api = window.zdTakeoff;
    const doc = frame.contentDocument;
    const openButton = doc && doc.getElementById("bClaude");
    const panel = doc && doc.getElementById("aiPanel");
    const input = doc && doc.getElementById("aiIn");
    const send = doc && doc.getElementById("aiSend");
    if (api && api.P && api.S && typeof api.agentCmd === "function" && openButton && panel && input && send) {
      const header = panel.querySelector(".aih b");
      if (header) header.textContent = "✦ Free drawing agent";
      const subhead = header && header.nextElementSibling;
      if (subhead) subhead.textContent = "Runs in this browser · no API key";
      openButton.textContent = "✦ Free AI";
      openButton.title = "Open the free local drawing agents";
      const keyButton = doc.getElementById("aiKeyBtn");
      if (keyButton) keyButton.hidden = true;
      const keyRow = doc.getElementById("aiKeyRow");
      if (keyRow) keyRow.hidden = true;
      const readButton = doc.getElementById("aiRead");
      if (readButton) readButton.hidden = true;
      const handoff = doc.getElementById("aiCopy");
      if (handoff && handoff.parentElement) handoff.parentElement.hidden = true;
      input.placeholder = "Try: measure all rooms · count doors · how many baths · walls 9\"";
      send.textContent = "Run local command";
      panel.classList.add("on");
      openButton.classList.add("on");
      const log = doc.getElementById("aiLog");
      log.replaceChildren();
      addMessage(doc, "bot", "Free drawing agents. Commands and takeoff counts run locally with no API key or model download. They use searchable PDF text and CAD/vector lines; scanned drawings and unclear geometry still need your review. Try ‘measure all rooms’, ‘count doors’, ‘how many baths’, or ‘walls 9 inch’. ‘How many’ questions are read-only; count/draw commands add editable AI-marked measurements that you can check or undo.");
      send.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void submit(api, doc, input, send);
      }, true);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void submit(api, doc, input, send);
        }
      }, true);
      status.hidden = true;
      input.focus();
      return;
    }
    await wait(100);
  }
  status.classList.add("error");
  status.textContent = "Takeoff did not finish starting. Reload this page, then open the Free AI button.";
}

start();

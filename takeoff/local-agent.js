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

function roomMatcher(question) {
  const q = question.toLowerCase();
  if (/\b(bath(?:room)?s?|toilets?|w\.?c\.?|powder(?:\s+rooms?)?|wash\s?rooms?)\b/.test(q)) {
    return {label: "bath / toilet", test: name => /\b(BATH(?:ROOM)?|TOILET|W\.?C\.?|POWDER|WASH\s*ROOM)\b/i.test(name)};
  }
  if (/\b(master\s+)?bed(?:room)?s?\b/.test(q)) {
    return {label: "bedroom", test: name => /\b(MASTER\s+)?BED\s*ROOM\b/i.test(name)};
  }
  if (/\bkitchens?\b/.test(q)) return {label: "kitchen", test: name => /\b(KITCHEN|KIT)\b/i.test(name)};
  if (/\blounges?|living\s+rooms?\b/.test(q)) return {label: "lounge / living room", test: name => /\b(LOUNGE|LIVING|FAMILY|DRAWING)\b/i.test(name)};
  if (/\brooms?\b/.test(q)) return {label: "room", test: () => true};
  return null;
}

async function drawingCount(api, question) {
  const pages = targetPages(api, question);
  if (!pages.length) return "Open a drawing page first.";
  const limit = 300;
  const scan = pages.slice(0, limit);
  const partial = scan.length < pages.length;
  const scope = scan.length === 1 ? pageLabel(api, scan[0].file, scan[0].page) : `${scan.length} drawing pages${partial ? ` (only the first ${scan.length} of ${pages.length} were searched)` : ""}`;
  const q = question.toLowerCase();
  const coverageNote = partial ? ` Partial result: ${pages.length - scan.length} pages were not searched, so this is not a complete project count.` : "";

  if (/\b(apartments?|units?|flats?)\b/.test(q)) {
    const found = [];
    for (const {file, page} of scan) {
      const units = await api.unitsOf(file.id, page);
      const onThisPage = new Map(units.map(unit => [unit.no, unit]));
      onThisPage.forEach(unit => found.push({file, page, unit}));
    }
    if (!found.length) return `No confidently labelled apartment/unit numbers were detected on ${scope}. This is not a visual zero: the local agent reads searchable PDF text, not drawing pixels. Open the sheet and use the Apartment agent to inspect its labels.${coverageNote}`;
    return `${found.length} likely apartment/unit labels on ${scope}: ${found.map(row => `${row.unit.no}${row.unit.type ? " (" + row.unit.type + ")" : ""} — ${pageLabel(api, row.file, row.page)}`).join("; ")}. Labels are counted once per page; repeated numbers on different floors remain separate. Read-only text estimate, not a verified visual unit count.${coverageNote}`;
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
    if (!total) return `No searchable ${requested ? requested.k : family.toLowerCase()} tags were found on ${scope}. This does not prove there are none: untagged symbols and scanned drawings need the Doors / Windows agent's symbol option or a visual check.${coverageNote}`;
    const breakdown = found.map(row => `${row.mark}: ${row.count} (${pageLabel(api, row.file, row.page)})`).join("; ");
    return `${total} tagged ${family.toLowerCase()} placements on ${scope}: ${breakdown}. Read-only count from plan tags; schedule-table entries are excluded, but untagged symbols are not included and still need review.${coverageNote}`;
  }

  const matcher = roomMatcher(question);
  if (matcher) {
    const matches = [];
    for (const {file, page} of scan) {
      const facts = await api.drawingFacts(file.id, page);
      facts.rooms.filter(room => matcher.test(room.name)).forEach(room => matches.push({file, page, room}));
    }
    if (!matches.length) return `No searchable ${matcher.label} room labels were detected on ${scope}. This is not a visual zero; scanned drawings, alternate abbreviations, or unlabeled rooms need manual review.${coverageNote}`;
    const names = matches.map(row => `${row.room.name} (${pageLabel(api, row.file, row.page)})`);
    return `${matches.length} likely ${matcher.label} room labels on ${scope}: ${names.join(", ")}. This counts matching PDF text labels, not visually verified rooms or fixture symbols; check the plan before using it as a takeoff quantity.${coverageNote}`;
  }
  return null;
}

function addClarification(doc, question) {
  const q = question.toLowerCase();
  const dimension = /\b\d+(?:\.\d+)?\s*(?:ft|feet|foot|['’′])/.exec(q);
  const inches = /\b\d+(?:\.\d+)?\s*(?:in(?:ch(?:es)?)?|["”″])/.test(q);
  if (!/\bwalls?\b/.test(q) || !dimension || inches) return false;
  addMessage(doc, "bot", `Before I draw anything: does ${dimension[0].trim()} mean a wall run length, wall thickness, or wall height? The automatic wall agent detects thickness from paired vector lines; it cannot infer which one you intended. Reply with the dimension and what it describes, for example: ‘4 inch thick walls’.`);
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

    if (/^\s*how\s+(many|much)\b/i.test(question) || /^\s*count\s+(?:all\s+)?(?:baths?|bathrooms?|toilets?|w\.?c\.?|powder\s+rooms?|wash\s?rooms?|bedrooms?|kitchens?|lounges?|living\s+rooms?|apartments?|units?|flats?)\b/i.test(question)) {
      const answer = await drawingCount(api, question);
      if (answer) {
        addMessage(doc, "bot", answer);
        return;
      }
    }

    if (/^\s*count\s+(?:all\s+)?(?:doors?|windows?|ventilators?)\b/i.test(question) && !/\bswing\b/i.test(question)) {
      await api.doorWinDialog();
      return;
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
      addMessage(doc, "bot", "Free drawing agents. They use searchable PDF text and CAD/vector lines; scanned drawings, untagged symbols, and uncertain geometry need review. Try ‘measure all rooms’, ‘count doors’, ‘how many baths’, or ‘walls 9 inch’. ‘How many’ questions only report text/tag evidence. ‘Count doors’ opens a review dialog before placing editable AI-marked count results. Check or undo measurements before using them in a bill.");
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

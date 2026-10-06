#!/usr/bin/env node
/* Browser tests for the RFQ / Quotation Tracker (QS Cost Control → RFQ Tracker).

     python3 -m http.server 8765 &            # from the repo root
     node tools/test_rfq_tracker.js           # needs playwright (npm i -g playwright)

   RFQ_URL  page to test (default http://127.0.0.1:8765/zameen-developments/index.html)
   QE_LIBS  folder holding exceljs/dist/exceljs.min.js — CDN requests are answered from there when the CDN is
            not reachable (offline / sandboxed runs); without it the Excel check is skipped

   Checks: the needs-a-quote list, creating an RFQ from ticked lines, adding a line, vendors (new, from the list,
   from GRN history), sent date → status, quote validation (future date, missing reference), comparative
   statement (lowest, award above lowest needs a reason), applying to the Rate Database (rate, quote date,
   Verified, source text in the CLAUDE.md form, change log), persistence across a reload, revert, enquiry
   letters / text / Excel, the sidebar entry, phone-width layout, and no page errors. */
const path = require("path"), fs = require("fs");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node22/lib/node_modules/playwright"); }
const URL = process.env.RFQ_URL || "http://127.0.0.1:8765/zameen-developments/index.html";
const LIBS = process.env.QE_LIBS || "";
let fails = 0, passes = 0;
function ok(cond, msg){ if (cond) { passes++; console.log("  ✓ " + msg); } else { fails++; console.log("  ✗ " + msg); } }

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true}); await require("./zd_unlock")(ctx);   // the dashboard password, typed in on every page opened (nothing is remembered)
  const errors = [];
  await ctx.route(/cdn\.jsdelivr\.net|docs\.google\.com|fonts\.g/, async route => {
    const u = route.request().url();
    if (LIBS && /exceljs/.test(u)) return route.fulfill({path: path.join(LIBS, "exceljs/dist/exceljs.min.js"), contentType: "application/javascript"});
    if (/chart\.js/.test(u)) return route.fulfill({body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript"});
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, {waitUntil: "load"});
  await page.waitForTimeout(2500);
  const $ = sel => page.locator("#rav-rfq " + sel);
  const okModal = async () => { await page.click("#raModalOK"); await page.waitForTimeout(150); };

  console.log("view");
  await page.click("#tabRA");
  await page.waitForTimeout(300);
  await page.click('.navitem2[data-rvgo="rfq"]');
  await page.waitForTimeout(400);
  ok(await page.isVisible("#rav-rfq"), "sidebar entry opens the RFQ Tracker");
  ok(await page.locator('#raSub button[data-rv="rfq"].on').count() === 1, "its sub-tab is active");
  const kp = await $(".rak").allInnerTexts();
  ok(kp.length === 5 && /LINES NEEDING A QUOTE/i.test(kp[0]), "five KPI tiles");
  const need = await page.evaluate(() => zdRfq.needList());
  ok(need.length > 50, `needs-a-quote list has lines (${need.length})`);
  ok(need.every(o => o.w.length > 0 && o.u && o.u.n > 0), "every listed line has a reason and is used in an analysis");
  ok(need.some(o => o.w.indexOf("assumed") >= 0) && need.some(o => o.w.indexOf("stale") >= 0), "assumptions and old sources both listed");

  console.log("create");
  const picks = need.slice(0, 2).map(o => o.x.code);
  for (const c of picks) await $(`[data-rfq-sel="${c}"]`).check();
  await page.waitForTimeout(150);
  ok(/2\s*ticked/.test(await $(".rfq-bulk").innerText()), "two lines ticked");
  await $('[data-rfq-act="create"]').click();
  await page.waitForTimeout(200);
  let R = await page.evaluate(() => RA.rfq.rfqs[0]);
  ok(R && /^RFQ-\d{4}-\d{3}$/.test(R.id) && R.lines.length === 2, `RFQ ${R && R.id} created with the two lines`);
  ok(await $(".rfq-title").count() === 1, "detail view opened");
  await $("#rfqAddCode").fill("CEM");
  await $('[data-rfq-act="addLine"]').click();
  await page.waitForTimeout(150);
  R = await page.evaluate(() => RA.rfq.rfqs[0]);
  ok(R.lines.length === 3 && R.lines[2].code === "CEM" && R.lines[2].unit === "Bag", "line added by code (CEM, per Bag)");
  await $("#rfqAddCode").fill("NO-SUCH-CODE");
  await $('[data-rfq-act="addLine"]').click();
  ok((await page.evaluate(() => RA.rfq.rfqs[0].lines.length)) === 3, "unknown code is not added");

  console.log("vendors");
  await $("#rfqNewV").fill("Test Vendor A");
  await $("#rfqNewVC").fill("Mr. A · 0300-0000000");
  await $('[data-rfq-act="inviteNew"]').click();
  await page.waitForTimeout(150);
  await $('[data-rfq-tab="vend"]').click();
  await $("#rfqVName").fill("Test Vendor B");
  await $('[data-rfq-act="addVendor"]').click();
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => RA.rfq.vendors.map(v => v.name))).join("|") === "Test Vendor A|Test Vendor B", "vendors added (inline and on the Vendors tab)");
  await $('[data-rfq-tab="list"]').click();
  ok(/Draft/.test(await $("table.ratbl").innerText()), "register lists the RFQ as Draft");
  await page.click(`#rav-rfq [data-rfq-open="${R.id}"]`);
  await page.waitForTimeout(150);
  await $("#rfqInvSel").selectOption({label: "Test Vendor B"});
  await $('[data-rfq-act="invite"]').click();
  await page.waitForTimeout(150);
  const chips = await $(".rfq-chip").count();
  ok(chips > 0, `GRN history suggests vendors (${chips})`);
  const sugName = await $(".rfq-chip button").first().getAttribute("data-name");
  await $(".rfq-chip button").first().click();
  await page.waitForTimeout(150);
  R = await page.evaluate(() => RA.rfq.rfqs[0]);
  ok(R.vendors.length === 3 && (await page.evaluate(n => RA.rfq.vendors.some(v => v.name === n), sugName)), "suggested vendor invited and added to the vendor list");
  const vA = await page.evaluate(() => RA.rfq.vendors[0].id);
  await $(`[data-rfq-sent="${vA}"]`).fill("2026-09-25");
  await $(`[data-rfq-sent="${vA}"]`).dispatchEvent("change");
  await page.waitForTimeout(150);
  ok(/Sent/.test(await $(".rfq-badge").first().innerText()), "status Sent once an enquiry date is entered");

  console.log("enquiry");
  await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await $('[data-rfq-act="print"]').click();
  await page.waitForTimeout(250);
  ok((await page.evaluate(() => window.__prints)) === 1 && (await $(".rfq-letter").count()) === 3, "print makes one enquiry letter per invited vendor");
  const letter = await $(".rfq-letter").first().innerText();
  ok(/REQUEST FOR QUOTATION/.test(letter) && letter.indexOf(R.id) >= 0 && /Bag/.test(letter), "letter names the RFQ and the units");
  if (LIBS) {
    const [dl] = await Promise.all([page.waitForEvent("download"), $('[data-rfq-act="enqXls"]').click()]);
    ok(/Enquiry\.xlsx$/.test(dl.suggestedFilename()), "enquiry Excel downloads");
  } else console.log("  - enquiry Excel skipped (no QE_LIBS)");

  console.log("quotes");
  const codes = R.lines.map(L => L.code);
  async function quote(vendorName, ref, date, prices){
    await $('[data-rfq-act="newQuote"]').click();
    await page.waitForTimeout(100);
    await $('[data-rfq-qf="vendor"]').selectOption({label: vendorName});
    await $('[data-rfq-qf="ref"]').fill(ref);
    await $('[data-rfq-qf="date"]').fill(date);
    for (const [c, v] of Object.entries(prices)) await $(`[data-rfq-qp="${c}"]`).fill(String(v));
    await $('[data-rfq-act="saveQuote"]').click();
    await page.waitForTimeout(150);
  }
  await quote("Test Vendor A", "QA-11", "2099-01-01", {[codes[0]]: 100});
  ok(/future/.test(await $("#rfqQErr").innerText()), "a future quotation date is refused");
  await $('[data-rfq-qf="date"]').fill("2026-09-28");
  await $('[data-rfq-qf="ref"]').fill("");
  await $('[data-rfq-act="saveQuote"]').click();
  ok(/reference/.test(await $("#rfqQErr").innerText()), "a quote without a reference is refused");
  await $('[data-rfq-qf="ref"]').fill("QA-11");
  await $(`[data-rfq-qp="${codes[1]}"]`).fill("250");
  await $('[data-rfq-qp="CEM"]').fill("1540");
  await $('[data-rfq-act="saveQuote"]').click();
  await page.waitForTimeout(150);
  await quote("Test Vendor B", "QB/77", "2026-09-29", {[codes[0]]: 95, [codes[1]]: 260, CEM: 1525});
  R = await page.evaluate(() => RA.rfq.rfqs[0]);
  ok(R.quotes.length === 2 && R.quotes[0].prices[codes[0]] === 100 && R.quotes[1].prices.CEM === 1525, "two quotes saved with their rates");
  ok(/Quotes in/.test(await $(".rfq-badge").first().innerText()), "status Quotes in");
  const low = await $("td.rfq-low").allInnerTexts();
  ok(low.length === 3 && low.map(s => s.trim()).join("|") === "95.00|250.00|1,525.00", "comparative statement marks the lowest per item");

  console.log("award and apply");
  const before = await page.evaluate(c => JSON.parse(JSON.stringify(RA.rates.find(r => r.code === c))), codes[1]);
  const qB = R.quotes[1].id;
  await $(`[data-rfq-aw="${codes[1]}"][value="${qB}"]`).check();
  await page.waitForTimeout(150);
  await $('[data-rfq-act="apply"]').click();
  await page.waitForTimeout(150);
  ok(/Reason needed/.test(await page.innerText("#raModalT")), "awarding above the lowest asks for a reason");
  await okModal();
  await $(`[data-rfq-awn="${codes[1]}"]`).fill("earlier delivery");
  await $(`[data-rfq-awn="${codes[1]}"]`).dispatchEvent("change");
  await $('[data-rfq-act="apply"]').click();
  await page.waitForTimeout(150);
  ok(/Apply awarded quotations/.test(await page.innerText("#raModalT")) && /Apply 3 rates/.test(await page.innerText("#raModalOK")), "confirmation lists the 3 lines");
  await okModal();
  await page.waitForTimeout(400);
  const L = await page.evaluate(cs => cs.map(c => RA.rates.find(r => r.code === c)), codes);
  ok(L[0].rate === 95 && L[0].date === "2026-09-29" && L[0].vs === "V", "lowest quote written: rate, quote date, Verified");
  ok(L[1].rate === 260 && /award note: earlier delivery/.test(L[1].src) && /chosen of 2 quotes/.test(L[1].src), "chosen quote above the lowest written with its reason");
  ok(L[2].rate === 1525 && /^Test Vendor B quotation QB\/77, 29-Sep-2026 — RFQ-\d{4}-\d{3}/.test(L[2].src), "source text in the `<vendor> quotation <ref>, DD-Mon-YYYY — …` form");
  ok(L.every(x => { const h = x.src.split(" — ")[0].match(/\d{2}-[A-Z][a-z]{2}-\d{4}/g) || []; return h.length === 1; }), "one date before the dash on every written line");
  const log = await page.evaluate(id => RA.qe.log.filter(l => (l.note || "").indexOf(id) === 0), R.id);
  ok(log.some(l => l.field === "rate" && l.code === codes[0] && l.to === 95), "rate change logged in the change log with the RFQ");
  ok(/Awarded/.test(await $(".rfq-badge").first().innerText()), "status Awarded");

  console.log("persistence and revert");
  await page.evaluate(() => raPersistNow());
  await page.reload({waitUntil: "load"});
  await page.waitForTimeout(2500);
  ok((await page.evaluate(() => RA.rfq && RA.rfq.rfqs.length === 1 && Object.keys(RA.rfq.rfqs[0].applied).length === 3)), "RFQ, quotes and applied lines survive a reload");
  await page.click("#tabRA");
  await page.waitForTimeout(300);
  await page.click('.navitem2[data-rvgo="rfq"]');
  await page.waitForTimeout(300);
  await page.click(`#rav-rfq [data-rfq-tab="list"]`);
  await page.click(`#rav-rfq [data-rfq-open="${R.id}"]`);
  await page.waitForTimeout(200);
  await $(`[data-rfq-act="revert"][data-code="${codes[1]}"]`).click();
  await okModal();
  await page.waitForTimeout(300);
  const back = await page.evaluate(c => RA.rates.find(r => r.code === c), codes[1]);
  ok(back.rate === before.rate && back.date === before.date && back.src === before.src && back.vs === before.vs, "revert puts the line back exactly");
  await page.evaluate(c => { RA.rates.find(r => r.code === c).rate = 1; }, "CEM");
  await $(`[data-rfq-act="revert"][data-code="CEM"]`).click();
  await page.waitForTimeout(150);
  ok(/changed since/.test(await page.innerText("#raModalT")), "a line edited after the RFQ is not reverted");
  await page.click("#raModalC");

  console.log("layout");
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, `no sideways scroll at 390 px (${over})`);
  await page.click(`#rav-rfq [data-rfq-tab="need"]`);
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, "needs-a-quote list fits at 390 px");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

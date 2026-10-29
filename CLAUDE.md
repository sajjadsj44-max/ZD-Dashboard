# Working preferences (Sajjad)

- Work autonomously: make the reasonable call yourself instead of stopping to ask for
  confirmation, and proceed straight through to commit + push.
- Only ask a clarifying question when genuinely blocked (e.g. a fact you cannot find
  anywhere and guessing wrong would break something — verify with the user first,
  don't invent it).
- After committing and pushing a change, always open a pull request into `main`
  (or merge to `main` directly if a PR isn't possible) — do this automatically,
  without asking or waiting to be told each time.

# Rate data rules

- Every rate filled into the Rate Analysis library must name its reference source
  and date in the Source / remarks column, in the form
  `<source>, DD-Mon-YYYY — <details>` (e.g. `Phoenix GRN RCP-312, 30-Aug-2026 — M/S Hamza Steel`).
  The Effective date column must carry the same date.
- No dated source → leave the rate at 0 or mark it `ASSUMPTION — no dated source`.
  Never invent a rate.
- Prefer a current (last ~30 days) dated Lahore market rate; if none can be
  found, use the latest Phoenix GRN rate and say so in the remarks.

# PDF Takeoff (`takeoff/`)

- Whenever `takeoff/takeoff.js` changes, bump the `?v=` on its `<script>` tag in
  `takeoff/index.html` (e.g. `?v=2026-10-03b`). GitHub Pages lets browsers cache
  files for 10 minutes, so without it a new page can run under the old script.
- `takeoff/cad.js` and `takeoff/cad-worker.js` are loaded with takeoff.js's own
  `?v=`, so bump that same `?v=` when either of them changes too. The same for
  `takeoff/trace.js` and `takeoff/trace-worker.js` (the vector trace of a PDF's wall layers).
  And for `takeoff/measure.js` (the measurement engine: geometry and QS formulas, unit-tested by
  `tools/test_takeoff_measure.js` in plain Node).
- When a `takeoff/cad.js` change alters how a DWG / DXF is read or drawn (text placement, geometry,
  layers), raise `CAD_VER` in cad.js too. Each browser keeps the drawing as it was first read and
  only reads it again from the DWG when `CAD_VER` changes, so without it drawings already added keep
  showing the old result (as the MTEXT box centring of #134 did).

# Dashboard password

- The dashboards' password is never saved in any browser and is asked every
  time a page is opened: no unlock flag in sessionStorage / localStorage /
  cookies, and no `type="password"` field or `<form>` for it (a text field drawn
  as dots), so no browser or password manager offers to save or fill it.
- The same for any password an app asks for (e.g. a locked PDF's open
  password): ask each time, never keep it — not in the browser, not in exports.
- Passwords: `123` for Payments on its own (`zameen-developments/?app=pay`), `sa` for everything else
  (the complete Dashboard `?app=all`, `?app=cm`, `?app=ra` (QS Cost Control), `?app=calc`, `?app=prod`, PDF Takeoff, Drawing Tracker, the dashboards list).
  `zameen-developments/` with no `?app=` opens the start screen that picks one of them.
- PDF Takeoff's friends' link `takeoff/?team` asks a **username + password** per friend instead of `sa`
  (checked against `takeoff/users.json`: salted PBKDF2-SHA256 hashes only, never a plain password). The owner
  adds / removes them in Settings › Team logins, which saves users.json to main with a GitHub token asked
  when saving (kept only while the page is open) or downloads it. The team view hides backups, Recover,
  Settings › Backup & reset and the links to the other ZD pages. `tools/test_takeoff_team.js` checks it.
- One exception, asked for by the owner: a **trusted computer** (the owner's laptop) is never asked, on any
  page. Its browser keeps a random key in localStorage `zd-trusted-computer`; every page with a lock
  (zameen-developments, takeoff, dashboards, drawing-tracker) lists only the key's SHA-256 in `TRUSTED` —
  keep that list the same on all four. The key is set by opening `zameen-developments/#trust=<key>` once
  (the key never goes in the repo) and removed with the start screen's "Ask on this computer too". The
  password itself is still never stored. To trust another computer, add its key's hash to all four lists.
- Browser tests type the password in with `tools/zd_unlock.js`;
  `tools/test_lock.js` checks the lock on every page.

# Auto-update (no Ctrl + F5)

- Every page carries `<html … data-zd-build="__ZD_BUILD__">`; the deploy (`tools/stamp_build.py` in
  `deploy-pages.yml`) writes a hash of each page's own file there and lists them all in `version.json`.
  A copy older than the published one loads the new one by itself when the page is opened or its tab is
  shown again (never while you are on it: then a bar offers Reload), once per version.
- The setting "Load new versions by itself" is one for every page (localStorage `zd-auto-update` = `0` when
  off): Takeoff Settings › General, the Zameen Developments start screen, the dashboards list, the bar.
- zameen-developments, dashboards and drawing-tracker share the same inline `ZD auto-update` script (keep
  them the same, only `PAGE` differs); PDF Takeoff's is `verCheck` in takeoff.js. A new page gets the
  attribute and that script too. `tools/test_autoupdate.js` checks them.

# Windows app (`app/`)

- `app/ZD-Takeoff.exe` (friends: opens `takeoff/?team`) and `app/ZD-Takeoff-Pro.exe` (owner: the full app) are
  built from `tools/takeoff-app/App.cs` by `tools/takeoff-app/build.ps1` (Windows' own csc, WebView2 inside the
  .exe). They load the live site, so a takeoff change needs no new .exe; rebuild only when App.cs changes.

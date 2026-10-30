/* ZD Takeoff feedback chat — the server behind the takeoff's Feedback button (friends) and Inbox (owner).

   Setup (once): make a Google Sheet › Extensions › Apps Script › replace the code with this file › Save ›
   Deploy › New deployment › type: Web app, Execute as: Me, Who has access: Anyone › Deploy › allow access ›
   copy the Web app URL (…/exec) into takeoff/chat.json. The messages are kept in the sheet's "Messages" tab.

   A friend is checked against takeoff/users.json on the site: the SHA-256 of the chat key their app made from their
   password at sign-in must match their entry's "c". The owner's Inbox sends its own password; its SHA-256 is OWNER_HASH. */
var USERS_URL = 'https://sajjadsj44-max.github.io/ZD-Dashboard/takeoff/users.json';
var OWNER_HASH = '55e1bbf3b4c660b2542f75e1416325e35e7e629c8e582149b611234e6e35e040';

function sha(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function users() {   // the site's users list, kept 2 minutes
  var c = CacheService.getScriptCache(), j = c.get('users');
  if (!j) { j = UrlFetchApp.fetch(USERS_URL + '?check=' + Date.now()).getContentText(); c.put('users', j, 120); }
  return JSON.parse(j).users || [];
}
function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('Messages');
  if (!sh) { sh = ss.insertSheet('Messages'); sh.appendRow(['id', 'at', 'user', 'from', 'text', 'read']); sh.setFrozenRows(1); }
  return sh;
}
function rows() {   // every message: {row, id, at, u (the friend's thread), from (the friend or "owner"), text, read}
  var sh = sheet(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 6).getValues().map(function (r, i) {
    return {row: i + 2, id: String(r[0]), at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]), u: String(r[2]), from: String(r[3]), text: String(r[4]), read: r[5] === true || r[5] === 'TRUE'};
  });
}
function pub(r) { return {id: r.id, at: r.at, from: r.from, text: r.text, read: r.read}; }
function markRead(list) { var sh = sheet(); list.forEach(function (r) { sh.getRange(r.row, 6).setValue(true); r.read = true; }); }
function add(u, from, text) {
  text = String(text || '').trim().slice(0, 4000);
  if (!text) throw new Error('empty');
  sheet().appendRow([Utilities.getUuid(), new Date(), u, from, text, false]);
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return out({ok: true, app: 'ZD Takeoff feedback'}); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var q = JSON.parse(e.postData.contents), a = q.a, R;
    if (a === 'send' || a === 'get') {   // a friend: their own thread only
      var u = String(q.u || '').toLowerCase(), me = users().filter(function (x) { return x.u === u; })[0];
      if (!me || !me.c || sha(String(q.k || '')) !== me.c) return out({error: 'auth'});
      if (a === 'send') add(u, u, q.text);
      R = rows().filter(function (r) { return r.u === u; });
      if (!q.peek) markRead(R.filter(function (r) { return r.from === 'owner' && !r.read; }));
      return out({msgs: R.map(pub)});
    }
    if (sha(String(q.ok || '')) !== OWNER_HASH) return out({error: 'auth'});
    if (a === 'inbox') {   // one line per friend: the last message and how many are unread
      var T = {};
      rows().forEach(function (r) {
        var t = T[r.u] || (T[r.u] = {u: r.u, last: null, unread: 0, n: 0});
        t.last = pub(r); t.n++;
        if (r.from !== 'owner' && !r.read) t.unread++;
      });
      return out({threads: Object.keys(T).map(function (k) { return T[k]; }).sort(function (x, y) { return y.last.at.localeCompare(x.last.at); })});
    }
    if (a === 'thread' || a === 'reply') {
      var w = String(q.u || '').toLowerCase();
      if (!w) return out({error: 'user'});
      if (a === 'reply') add(w, 'owner', q.text);
      R = rows().filter(function (r) { return r.u === w; });
      markRead(R.filter(function (r) { return r.from !== 'owner' && !r.read; }));
      return out({msgs: R.map(pub)});
    }
    return out({error: 'action'});
  } catch (err) {
    return out({error: String(err && err.message || err)});
  } finally {
    lock.releaseLock();
  }
}

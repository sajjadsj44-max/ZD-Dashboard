"""Daily activity of PDF Takeoff's team logins, for the owner's Settings > Team logins.

A friend's browser announces its sign-in on the relay of takeoff/chat.json (topic "s-" + the chat topic) each time the team
view is opened and again every 20 minutes while it stays open (one computer at a time per login, see takeoff/index.html).
The relay keeps those only 12 hours, so .github/workflows/chat-archive.yml runs this every half hour: it sums them per user
and day (Pakistan time) into takeoff-activity.json on the chat-archive branch, which the owner's page reads back:

    {"tz": 5, "seen": {relay id: time}, "days": {"2026-10-31": {"bilal": {"f": first, "l": last, "n": pings, "s": [sign-ins]}}}}

"seen" holds the relay ids already counted (the last 13 hours), so an event is counted once however often this runs, and the
page adds only the relay's events not in it. Only users in takeoff/users.json count.

While the login is switched off (users.json "open": true), guests are counted too: each guest's browser announces its visits
on the topic "v-" + the chat topic (a random id per browser, the kind of device, and once per page its IP address and place
sealed for the owner's key). They are summed per browser and day into "guests":

    "guests": {"first": {id: first day}, "days": {"2026-11-01": {id: {"f", "l", "n", "s": [page ids], "d": device, "x": [sealed]}}}}

    python tools/activity_archive.py takeoff/chat.json takeoff/users.json <archive>/takeoff-activity.json [relay-dump.jsonl [visits-dump.jsonl]]
"""
import json
import re
import sys
import time
import urllib.request

TZ = 5 * 3600        # Pakistan time (no daylight saving)
KEEP_DAYS = 400      # days kept in the file
SEEN_FOR = 13 * 3600  # the relay forgets after 12 hours
GUESTS_A_DAY = 2000   # at most this many guests kept for a day (anyone can write to the relay)
VID = re.compile(r"^[0-9a-f]{12}$")


def day(t):
    return time.strftime("%Y-%m-%d", time.gmtime(t + TZ))


def fetch(cfg, pre):
    url = cfg["relay"].rstrip("/") + "/" + pre + cfg["topic"] + "/json?poll=1&since=all"
    req = urllib.request.Request(url, headers={"User-Agent": "zd-activity-archive"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def sealed(x):
    """a visit's sealed IP and place, as the page made it, or None"""
    if not (isinstance(x, dict) and all(isinstance(x.get(k), str) for k in ("k", "iv", "ct"))):
        return None
    if len(x["k"]) > 700 or len(x["iv"]) > 32 or len(x["ct"]) > 2400:
        return None
    return {"k": x["k"], "iv": x["iv"], "ct": x["ct"]}


def events(text, seen):
    """(time, message) of each relay event not counted yet, its id added to seen"""
    for line in text.splitlines():
        try:
            e = json.loads(line)
            m = json.loads(e.get("message") or "null")
        except (ValueError, AttributeError):
            continue
        if not isinstance(e, dict) or e.get("event", "message") != "message" or not e.get("id") or e["id"] in seen:
            continue
        t = int(e.get("time") or 0)
        seen[e["id"]] = t
        if isinstance(m, dict) and m.get("zs") == 1 and t and abs(int(m.get("t") or 0) - t) < 600:   # as the page: the sender's time must match the relay's
            yield t, m


def main(cfg_path, users_path, out_path, dump=None, vdump=None):
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    users = {u.get("u") for u in json.load(open(users_path, encoding="utf-8")).get("users", []) if isinstance(u, dict)}
    try:
        act = json.load(open(out_path, encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        act = {}
    seen, days = dict(act.get("seen") or {}), dict(act.get("days") or {})
    guests = act.get("guests") or {}
    first, gdays = dict(guests.get("first") or {}), dict(guests.get("days") or {})
    if dump:
        text = open(dump, encoding="utf-8").read()
        vtext = open(vdump, encoding="utf-8").read() if vdump else ""
    else:
        if not (cfg.get("relay") and cfg.get("topic")):
            print("no relay in", cfg_path)
            return
        text = fetch(cfg, "s-")
        try:
            vtext = fetch(cfg, "v-")
        except OSError as e:
            print("the guests' visits were not read:", e)
            vtext = ""
    n = g = 0
    for t, m in events(text, seen):
        if m.get("k") != "claim" or m.get("u") not in users:
            continue
        d = days.setdefault(day(t), {}).setdefault(m["u"], {"f": t, "l": t, "n": 0, "s": []})
        d["f"], d["l"], d["n"] = min(d["f"], t), max(d["l"], t), d["n"] + 1
        sid = str(m.get("sid") or "")[:8]
        if sid and sid not in d["s"]:
            d["s"].append(sid)
        n += 1
    for t, m in events(vtext, seen):
        v = m.get("v")
        if m.get("k") != "visit" or not isinstance(v, str) or not VID.match(v):
            continue
        D = gdays.setdefault(day(t), {})
        if v not in D and len(D) >= GUESTS_A_DAY:
            continue
        d = D.setdefault(v, {"f": t, "l": t, "n": 0, "s": [], "x": []})
        d["f"], d["l"], d["n"] = min(d["f"], t), max(d["l"], t), d["n"] + 1
        if isinstance(m.get("d"), str):
            d["d"] = m["d"][:60]
        sid = str(m.get("s") or "")[:8]
        if sid and sid not in d["s"]:
            d["s"].append(sid)
        x = sealed(m.get("x"))
        if x and len(d["x"]) < 3 and all(y["ct"] != x["ct"] for y in d["x"]):
            d["x"].append(x)
        if first.get(v, "9999") > day(t):
            first[v] = day(t)
        g += 1
    now = int(time.time())
    cut = day(now - KEEP_DAYS * 86400)
    out = {"about": "PDF Takeoff team activity per user and day (Pakistan time), from the sign-in announcements on the relay. "
                    "Made by tools/activity_archive.py.",
           "tz": TZ // 3600,
           "seen": {k: v for k, v in seen.items() if v > now - SEEN_FOR},
           "days": {k: days[k] for k in sorted(days) if k >= cut}}
    if gdays or first:
        out["guests"] = {"first": {v: k for v, k in sorted(first.items()) if k >= cut},
                         "days": {k: gdays[k] for k in sorted(gdays) if k >= cut}}
    if out != act:
        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(out, f, separators=(",", ":"))
            f.write("\n")
    print(n, "new sign-in announcements,", g, "guest visits,", len(out["days"]), "days kept")


if __name__ == "__main__":
    main(*sys.argv[1:6])

"""tools/activity_archive.py: the team logins' sign-in announcements summed per user and day, each counted once.

    python tools/test_activity_archive.py
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
import activity_archive as A  # noqa: E402

fails = 0


def ok(c, m):
    global fails
    print(("  ok   " if c else "  FAIL ") + m)
    fails += 0 if c else 1


now = int(time.time())
d = tempfile.mkdtemp()
cfg, users, out, dump = (os.path.join(d, f) for f in ("chat.json", "users.json", "takeoff-activity.json", "relay.jsonl"))
json.dump({"relay": "https://relay.test", "topic": "t"}, open(cfg, "w"))
json.dump({"users": [{"u": "bilal"}, {"u": "ali"}]}, open(users, "w"))


def ev(i, t, m):
    return json.dumps({"id": "e%d" % i, "time": t, "event": "message", "message": json.dumps(m) if isinstance(m, dict) else m})


def claim(u, sid, t, k="claim", mt=None):
    return {"zs": 1, "u": u, "sid": sid, "k": k, "t": t if mt is None else mt, "h": "x"}


t0 = now - 3 * 3600
E = [ev(1, t0, claim("bilal", "aaaaaaaa11", t0)), ev(2, t0 + 1200, claim("bilal", "aaaaaaaa11", t0 + 1200)),
     ev(3, t0 + 2400, claim("bilal", "bbbbbbbb22", t0 + 2400)), ev(4, t0 + 2500, claim("bilal", "bbbbbbbb22", t0 + 2500, "release")),
     ev(5, t0 + 600, claim("zara", "cccccccc33", t0 + 600)), ev(6, t0 + 700, claim("ali", "dddddddd44", t0 + 700, mt=t0 - 5000)),
     ev(7, t0 + 800, '{"v":1,"u":"ali","t":"m"}'), ev(8, now - 600, claim("ali", "eeeeeeee55", now - 600))]
open(dump, "w").write("\n".join(E) + "\n")
A.main(cfg, users, out, dump)
j = json.load(open(out))
day = A.day
b = j["days"].get(day(t0), {}).get("bilal")
ok(b and b["n"] == 3 and b["f"] == t0 and b["l"] == t0 + 2400, "bilal: 3 announcements, first and last time")
ok(b and sorted(b["s"]) == ["aaaaaaaa", "bbbbbbbb"], "…from 2 sign-ins (kept as 8 characters)")
ok(all("zara" not in v for v in j["days"].values()), "a name not in users.json is not counted")
a = j["days"].get(day(now - 600), {}).get("ali")
ok(a and a["n"] == 1, "a sender's time far from the relay's, and a chat message, are not counted; ali's real one is")
ok(set(j["seen"]) == {"e%d" % i for i in range(1, 9)}, "every relay id read is remembered as seen")
ok(j["tz"] == 5 and day(0) == "1970-01-01" and day(19 * 3600) == "1970-01-02", "days are Pakistan time (UTC+5)")
A.main(cfg, users, out, dump)
ok(json.load(open(out)) == j, "run again on the same relay events: nothing counted twice")
E.append(ev(9, now - 60, claim("bilal", "ffffffff66", now - 60)))
open(dump, "w").write("\n".join(E) + "\n")
A.main(cfg, users, out, dump)
j2 = json.load(open(out))
nb = sum(v.get("bilal", {}).get("n", 0) for v in j2["days"].values())
ok(nb == 4, "a new announcement is added to what was summed")
print("\n%s" % ("all passed" if not fails else "%d failed" % fails))
sys.exit(1 if fails else 0)

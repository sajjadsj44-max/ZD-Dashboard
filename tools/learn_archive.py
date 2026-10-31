"""Merges what the PDF Takeoff agent learned in every browser of the team into one method file. Each browser of the published site
sends to the team's relay (takeoff/chat.json: relay + learn.topic), a minute after it learned something, each project's facts (the
project as an anonymous hash) and its counts (the agent's rooms people deleted, the rooms it missed, the room names it learned),
compressed. The relay keeps them 12 hours; .github/workflows/chat-archive.yml runs this every half hour and pushes the file to the
chat-archive branch (learn.file), which every browser adds to its own when the takeoff opens. What is kept: item names, heights,
room kinds and counts — no drawings, no project names. Every message is checked; anything else is left out.

    python tools/learn_archive.py takeoff/chat.json <archive>/team-method.json
    python tools/learn_archive.py --selftest
"""
import base64
import json
import re
import sys
import urllib.request
import zlib

MAX_PROJECTS, MAX_SENDERS, MAX_KINDS, MAX_ITEMS = 3000, 300, 80, 120
SID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
HOW = {"area", "wall", "count"}


def num(v, lo=0.0, hi=1e6):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0
    return x if lo <= x <= hi else 0


def text(v, n=80):
    return str(v)[:n] if isinstance(v, (str, int, float)) else ""


def decode(m):
    """a message's payload: {"z": base64 of deflated JSON} or {"j": the object}"""
    if isinstance(m.get("j"), dict):
        return m["j"]
    return json.loads(zlib.decompress(base64.b64decode(m["z"]), -15).decode("utf-8"))


def clean_facts(f):
    """{rooms: {KIND: {n, items: {key: {n, how, per}}}}, conds: {key: {name, type, unit, h, t, faces, ded}}} or None"""
    if not isinstance(f, dict) or not isinstance(f.get("rooms"), dict):
        return None
    rooms = {}
    for kind, r in list(f["rooms"].items())[:MAX_KINDS]:
        if not isinstance(r, dict) or not isinstance(r.get("items"), dict):
            continue
        items = {}
        for k, it in list(r["items"].items())[:MAX_ITEMS]:
            if not isinstance(it, dict) or it.get("how") not in HOW:
                continue
            per = [num(v, 0, 1000) for v in it.get("per", [])[:500]] if isinstance(it.get("per"), list) else []
            items[text(k, 160)] = {"n": int(num(it.get("n"), 0, 1e5)), "how": it["how"], "per": per}
        n = int(num(r.get("n"), 0, 1e5))
        if n and items:
            rooms[text(kind, 40)] = {"n": n, "items": items}
    conds = {}
    for k, c in list((f.get("conds") or {}).items())[:MAX_ITEMS * 4] if isinstance(f.get("conds"), dict) else []:
        if isinstance(c, dict) and c.get("type") in ("area", "linear", "count"):
            conds[text(k, 160)] = {"name": text(c.get("name"), 120), "type": c["type"], "unit": text(c.get("unit"), 8), "h": num(c.get("h"), 0, 500),
                                   "t": num(c.get("t"), 0, 500), "faces": num(c.get("faces"), 0, 4) or 1, "ded": num(c.get("ded"), 0, 1000)}
    return {"at": text(f.get("at"), 40), "rooms": rooms, "conds": conds} if rooms else None


def clean_counts(c):
    if not isinstance(c, dict):
        return None
    out = {"rejects": {}, "missed": {}, "words": {}}
    for kind, x in list((c.get("rejects") or {}).items())[:MAX_KINDS * 4] if isinstance(c.get("rejects"), dict) else []:
        if isinstance(x, dict):
            out["rejects"][text(kind, 40)] = {"del": int(num(x.get("del"), 0, 1e5)), "made": int(num(x.get("made"), 0, 1e5))}
    for k in ("missed", "words"):
        for kind, n in list((c.get(k) or {}).items())[:MAX_KINDS * 4] if isinstance(c.get(k), dict) else []:
            v = int(num(n, 0, 1e5))
            if v:
                out[k][text(kind, 40)] = v
    return out


def merge(state, messages):
    """the relay's messages into the method (the newest message of a browser's project, or of its counts, replaces the one before) -> changed"""
    changed = False
    P, S = state.setdefault("projects", {}), state.setdefault("senders", {})
    for m in messages:
        if not isinstance(m, dict) or m.get("k") != "zdlearn" or m.get("v") != 1 or not SID.match(str(m.get("s", ""))):
            continue
        s, at = m["s"], text(m.get("at"), 40)
        try:
            body = decode(m)
        except Exception:
            continue
        if m.get("c"):
            c = clean_counts(body)
            if c and (s not in S or S[s].get("at", "") <= at):
                if s not in S and len(S) >= MAX_SENDERS:
                    continue
                c["at"] = at
                if S.get(s) != c:
                    S[s] = c
                    changed = True
        elif SID.match(str(m.get("p", ""))):
            f, key = clean_facts(body), s + ":" + m["p"]
            if f and (key not in P or P[key].get("sent", "") <= at):
                if key not in P and len(P) >= MAX_PROJECTS:
                    continue
                f["sent"] = at
                if P.get(key) != f:
                    P[key] = f
                    changed = True
    if changed:
        state["at"] = max([p.get("sent", "") for p in P.values()] + [x.get("at", "") for x in S.values()] + [""])
    return changed


def write(path, state):
    state["about"] = ("PDF Takeoff: how this team takes off, learned by the takeoff agent in every browser of the team and merged by "
                      "tools/learn_archive.py. Item names, heights, room kinds and counts only.")
    state["v"] = 2
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({k: state[k] for k in ("about", "v", "at", "senders", "projects") if k in state}, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "zd-learn-archive"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def main(cfg_path, out_path):
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    learn = cfg.get("learn") or {}
    if not (cfg.get("relay") and learn.get("topic")):
        print("no learn topic in", cfg_path)
        return
    try:
        state = json.load(open(out_path, encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        state = {}
    msgs = []
    for line in fetch(cfg["relay"].rstrip("/") + "/" + learn["topic"] + "/json?poll=1&since=all").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e.get("event", "message") != "message":
            continue
        body = e.get("message", "")
        att = e.get("attachment") or {}
        if att.get("url") and len(body) < 20:   # a long message the relay kept as an attachment
            try:
                body = fetch(att["url"])
            except Exception:
                continue
        try:
            msgs.append(json.loads(body))
        except ValueError:
            continue
    if merge(state, msgs) or not state.get("v"):
        write(out_path, state)
    print(len(msgs), "messages,", len(state.get("projects", {})), "projects,", len(state.get("senders", {})), "browsers")


def selftest():
    z = lambda o: base64.b64encode(zlib.compress(json.dumps(o).encode(), 9)[2:-4]).decode()   # raw deflate, as the browser's deflate-raw
    facts = {"at": "2026-10-31T10:00:00Z", "rooms": {"BATH": {"n": 4, "items": {"wall tile|linear|Sft": {"n": 4, "how": "wall", "per": []}, "evil": {"n": 1, "how": "<script>"}}}},
             "conds": {"wall tile|linear|Sft": {"name": "Wall tile", "type": "linear", "unit": "Sft", "h": 7, "t": 0, "faces": 1, "ded": 1}}}
    assert zlib.decompress(base64.b64decode(z({"a": 1})), -15) == b'{"a": 1}'
    st = {}
    msgs = [{"k": "zdlearn", "v": 1, "s": "Lbrowser0001", "at": "2026-10-31T10:01:00Z", "p": "ab12cd34ef56", "z": z(facts)},
            {"k": "zdlearn", "v": 1, "s": "Lbrowser0001", "at": "2026-10-31T10:01:00Z", "c": 1, "z": z({"rejects": {"PORCH": {"del": 3, "made": 3}}, "missed": {"PLANTER": 2}, "words": {"PLANTER": 2}})},
            {"k": "zdlearn", "v": 1, "s": "Lother000002", "at": "2026-10-31T10:02:00Z", "p": "0000aaaa1111", "j": facts},
            {"k": "zdlearn", "v": 1, "s": "bad id!", "at": "x", "p": "ab12cd34ef56", "j": facts},
            {"k": "other", "v": 1, "s": "Lbrowser0001", "c": 1, "j": {}}, {"k": "zdlearn", "v": 1, "s": "Lbrowser0001", "p": "zz", "z": "not base64!"}, "nonsense"]
    assert merge(st, msgs)
    assert set(st["projects"]) == {"Lbrowser0001:ab12cd34ef56", "Lother000002:0000aaaa1111"}, st["projects"].keys()
    it = st["projects"]["Lbrowser0001:ab12cd34ef56"]["rooms"]["BATH"]["items"]
    assert "evil" not in it and it["wall tile|linear|Sft"]["how"] == "wall"
    assert st["senders"]["Lbrowser0001"]["rejects"]["PORCH"] == {"del": 3, "made": 3} and st["senders"]["Lbrowser0001"]["words"] == {"PLANTER": 2}
    old = {"k": "zdlearn", "v": 1, "s": "Lbrowser0001", "at": "2026-10-30T09:00:00Z", "p": "ab12cd34ef56", "j": dict(facts, rooms={"KITCHEN": {"n": 2, "items": {"k|area|Sft": {"n": 2, "how": "area"}}}})}
    assert not merge(st, [old]) and "BATH" in st["projects"]["Lbrowser0001:ab12cd34ef56"]["rooms"], "an older message never replaces a newer one"
    new = dict(old, at="2026-11-01T09:00:00Z")
    assert merge(st, [new]) and "KITCHEN" in st["projects"]["Lbrowser0001:ab12cd34ef56"]["rooms"], "a newer one does"
    assert not merge(st, [new]), "the same message twice changes nothing"
    assert st["at"] == "2026-11-01T09:00:00Z"
    print("selftest: ok")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--selftest"]:
        selftest()
    else:
        main(*sys.argv[1:3])

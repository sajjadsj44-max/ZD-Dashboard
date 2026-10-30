"""Copies PDF Takeoff's Feedback chat events from the relay (takeoff/chat.json: relay + topic) into the archive file,
once each by the relay's id, oldest first. The relay keeps events only 12 hours; .github/workflows/chat-archive.yml runs this
every half hour and pushes the file to the chat-archive branch, which the takeoff reads back. The events are sealed in the
browser, so the file holds no readable text.

    python tools/chat_archive.py takeoff/chat.json <archive>/takeoff-chat.jsonl
"""
import json
import sys
import urllib.request


def main(cfg_path, out_path):
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    if not (cfg.get("relay") and cfg.get("topic")):
        print("no relay in", cfg_path)
        return
    try:
        old = [json.loads(l) for l in open(out_path, encoding="utf-8") if l.strip()]
    except FileNotFoundError:
        old = []
    have = {e["id"] for e in old}
    url = cfg["relay"].rstrip("/") + "/" + cfg["topic"] + "/json?poll=1&since=all"
    req = urllib.request.Request(url, headers={"User-Agent": "zd-chat-archive"})
    new = []
    with urllib.request.urlopen(req, timeout=60) as r:
        for line in r.read().decode("utf-8").splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("event", "message") == "message" and e.get("id") and e["id"] not in have:
                new.append({"id": e["id"], "time": e.get("time", 0), "message": e.get("message", "")})
                have.add(e["id"])
    if new:
        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            for e in sorted(old + new, key=lambda e: e["time"]):
                f.write(json.dumps(e, separators=(",", ":")) + "\n")
    print(len(new), "new,", len(old) + len(new), "kept")


if __name__ == "__main__":
    main(*sys.argv[1:3])

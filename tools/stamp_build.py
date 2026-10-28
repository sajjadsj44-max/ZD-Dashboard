"""Stamp each page's build for the pages' auto-update (run by .github/workflows/deploy-pages.yml before packaging the site).

Every .html page whose <html> carries data-zd-build="__ZD_BUILD__" gets the first 12 hex digits of the SHA-256 of its own file
(as committed) in its place, and version.json at the site root lists them all: {"takeoff/index.html": "3f9c…", …}. A page
open in a browser compares its own build with version.json; a copy older than the published one loads the new one by itself.
A page's build changes only when its own file does (PDF Takeoff's scripts change its ?v=, so its index.html too).

    python3 tools/stamp_build.py [site root]      # default: the repo root; the files are changed in place
"""
import hashlib, json, os, sys

MARK = b'data-zd-build="__ZD_BUILD__"'
SKIP = {".git", "node_modules", ".github"}


def stamp(root):
    builds = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP)
        for f in sorted(files):
            if not f.endswith(".html"):
                continue
            p = os.path.join(d, f)
            with open(p, "rb") as fh:
                b = fh.read()
            if MARK not in b:
                continue
            h = hashlib.sha256(b).hexdigest()[:12]
            with open(p, "wb") as fh:
                fh.write(b.replace(MARK, b'data-zd-build="' + h.encode() + b'"', 1))
            builds[os.path.relpath(p, root).replace(os.sep, "/")] = h
    with open(os.path.join(root, "version.json"), "w", encoding="utf-8") as fh:
        json.dump(builds, fh, indent=1, sort_keys=True)
    return builds


if __name__ == "__main__":
    for k, v in stamp(sys.argv[1] if len(sys.argv) > 1 else ".").items():
        print(v, k)

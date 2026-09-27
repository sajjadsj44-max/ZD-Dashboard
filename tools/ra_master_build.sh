#!/bin/sh
# Rebuild the Master Rate Analysis workbook (Rev07) and the dashboard block from the Rev06 workbook.
#   tools/ra_master_build.sh RA_Master_Pakistan_FINAL_Rev06_2026-09-27.xlsx OUT_DIR
# Needs: python3 + openpyxl, LibreOffice Calc (soffice), node + playwright, and a local server:
#   python3 -m http.server 8765 &   (from the repo root)
set -e
SRC=$1; OUT=${2:-.}; TMP=$(mktemp -d)
calc() { soffice -env:UserInstallation=file://$TMP/lo --headless --calc --convert-to xlsx --outdir "$2" "$1" >/dev/null; }
python3 tools/ra_master_excel.py "$SRC" "$TMP/step1.xlsx" --log "$TMP/log.json"
calc "$TMP/step1.xlsx" "$TMP/c1"                                   # cached values for the data build
python3 tools/ra_master_data.py "$TMP/c1/step1.xlsx" --excel-json "$TMP/xside.json"
node tools/test_ra_master.js --dump "$TMP/dash.json" >/dev/null   # dashboard side, fresh library
python3 - "$TMP" <<'PY'
import json, sys; t = sys.argv[1]
d = json.load(open(f"{t}/dash.json")); x = json.load(open(f"{t}/xside.json"))
json.dump({**d, **x}, open(f"{t}/recon.json", "w"))
PY
python3 tools/ra_master_excel.py "$TMP/c1/step1.xlsx" "$TMP/step2.xlsx" --reconcile "$TMP/recon.json" --log "$TMP/log.json"
calc "$TMP/step2.xlsx" "$TMP/c2"
cp "$TMP/c2/step2.xlsx" "$OUT/RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx"
RA_XSIDE="$TMP/xside.json" node tools/test_ra_master.js
echo "written $OUT/RA_Master_Pakistan_FINAL_Rev07_2026-09-27.xlsx"

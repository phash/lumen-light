#!/usr/bin/env bash
# Laedt den kuratierten RAW-Test-Korpus aus tests-fixtures/manifest.json
# nach tests-fixtures/raw-samples/. Die Files sind NICHT im Repo (zu gross).
#
# Aufruf:
#   bash scripts/fetch-test-images.sh
#
# Idempotent: vorhandene Dateien werden uebersprungen, wenn die Groesse passt.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/tests-fixtures/manifest.json"
TARGET="$ROOT/tests-fixtures/raw-samples"

if [[ ! -f "$MANIFEST" ]]; then
    echo "FEHLER: Manifest nicht gefunden: $MANIFEST" >&2
    exit 1
fi
mkdir -p "$TARGET"

# Skript spricht Python (vorinstalliert), weil reines bash JSON nicht parst.
python3 -c "
import json, os, sys, urllib.request
manifest_path = '$MANIFEST'
target = '$TARGET'

with open(manifest_path) as f:
    manifest = json.load(f)

failed = []
for s in manifest['samples']:
    out = os.path.join(target, s['filename'])
    if os.path.exists(out):
        existing = os.path.getsize(out) // (1024*1024)
        if abs(existing - s['approxSizeMb']) <= 2:
            print(f'  OK  {s[\"filename\"]} ({existing} MB)')
            continue
        print(f'  re-download {s[\"filename\"]} (war {existing} MB, erwartet {s[\"approxSizeMb\"]} MB)')
    print(f'  ↓   {s[\"filename\"]} ({s[\"approxSizeMb\"]} MB)')
    try:
        urllib.request.urlretrieve(s['url'], out)
        print(f'  OK  {s[\"filename\"]} ({os.path.getsize(out)//1024//1024} MB)')
    except Exception as e:
        print(f'  FAIL {s[\"filename\"]}: {e}')
        failed.append(s['filename'])

if failed:
    print(f'\nFEHLGESCHLAGEN: {failed}', file=sys.stderr)
    sys.exit(2)
print('\nAlle Samples in', target)
"

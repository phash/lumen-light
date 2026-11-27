#!/usr/bin/env bash
# Laedt den kuratierten RAW-Test-Korpus aus tests-fixtures/manifest.json
# nach tests-fixtures/raw-samples/. Die Files sind NICHT im Repo (zu gross).
#
# Aufruf:
#   bash scripts/fetch-test-images.sh
#
# Idempotent: vorhandene Dateien werden uebersprungen, wenn der sha256 passt.
# Jeder Eintrag im Manifest MUSS einen sha256 haben (LibRaw parst diese
# Dateien in CI -> Integritaet vor Verwendung pruefen). Download landet erst
# in einer Temp-Datei und wird nur bei passendem Hash an Ort und Stelle bewegt.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/tests-fixtures/manifest.json"
TARGET="$ROOT/tests-fixtures/raw-samples"

if [[ ! -f "$MANIFEST" ]]; then
    echo "FEHLER: Manifest nicht gefunden: $MANIFEST" >&2
    exit 1
fi
mkdir -p "$TARGET"

# Pfade per argv, nicht in den Python-Quelltext interpoliert.
python3 -I - "$MANIFEST" "$TARGET" <<'PY'
import hashlib, json, os, re, sys, tempfile, urllib.request

manifest_path, target = sys.argv[1], sys.argv[2]

with open(manifest_path) as f:
    manifest = json.load(f)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


failed = []
for s in manifest['samples']:
    name = s['filename']
    want = str(s.get('sha256', '')).lower()
    if not re.fullmatch(r'[0-9a-f]{64}', want):
        print(f'  FAIL {name}: sha256 fehlt/ungueltig im Manifest')
        failed.append(name)
        continue
    if os.path.basename(name) != name:
        print(f'  FAIL {name}: ungueltiger Dateiname')
        failed.append(name)
        continue
    out = os.path.join(target, name)
    if os.path.exists(out):
        if sha256_of(out) == want:
            print(f'  OK  {name} (sha256 ok)')
            continue
        print(f'  re-download {name} (sha256 passt nicht)')
    print(f'  v   {name} ({s["approxSizeMb"]} MB)')
    fd, tmp = tempfile.mkstemp(dir=target, prefix='.dl-', suffix='.part')
    os.close(fd)
    try:
        with urllib.request.urlopen(s['url'], timeout=120) as r, open(tmp, 'wb') as fh:
            while True:
                chunk = r.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
        got = sha256_of(tmp)
        if got != want:
            raise ValueError(f'sha256 stimmt nicht (erwartet {want}, erhalten {got})')
        os.replace(tmp, out)
        print(f'  OK  {name} ({os.path.getsize(out)//1024//1024} MB, sha256 ok)')
    except Exception as e:
        print(f'  FAIL {name}: {e}')
        failed.append(name)
        if os.path.exists(tmp):
            os.unlink(tmp)

if failed:
    print(f'\nFEHLGESCHLAGEN: {failed}', file=sys.stderr)
    sys.exit(2)
print('\nAlle Samples in', target)
PY

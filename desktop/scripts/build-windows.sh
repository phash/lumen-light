#!/usr/bin/env bash
# Cross-Build fuer Windows (x86_64-pc-windows-msvc) per cargo-xwin und
# Zusammenstellen von desktop/.win-test/share/ fuer `tb-win run`.
#
# Voraussetzungen (testbox): cargo-xwin, clang-cl/lld-link/llvm-lib
# (Pakete clang-21 lld-21 llvm-21), `rustup target add x86_64-pc-windows-msvc`.
# cargo-xwin laedt beim ersten Lauf MSVC-CRT + Windows-SDK (Lizenz wird
# damit akzeptiert) nach ~/.cache/cargo-xwin.
#
# Aufruf (aus beliebigem Verzeichnis):  desktop/scripts/build-windows.sh
# Danach:  tb-win run lumen <repo>/desktop/.win-test --until install-result.txt --timeout 30
set -euo pipefail

TARGET=x86_64-pc-windows-msvc
DESKTOP="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$DESKTOP/.." && pwd)"
SHARE="$DESKTOP/.win-test/share"

# clang-cl & Co. liegen bei Ubuntu nur unter /usr/lib/llvm-<n>/bin.
for d in /usr/lib/llvm-21/bin /usr/lib/llvm-20/bin /usr/lib/llvm-19/bin; do
    if [ -x "$d/clang-cl" ]; then
        export PATH="$d:$PATH"
        break
    fi
done
command -v clang-cl >/dev/null || { echo "clang-cl fehlt" >&2; exit 1; }
command -v cargo-xwin >/dev/null || { echo "cargo-xwin fehlt" >&2; exit 1; }

cd "$DESKTOP"

# LUMEN_OPENMP=1: LibRaw mit OpenMP. Braucht LUMEN_LIBOMP_DIR = Ordner mit der
# LLVM-libomp.lib (z. B. conda-forge llvm-openmp: Library/lib); libomp.dll liegt
# daneben in ../bin und wird mit ausgeliefert.
FEATURES=()
if [ "${LUMEN_OPENMP:-0}" = 1 ]; then
    [ -f "${LUMEN_LIBOMP_DIR:-}/libomp.lib" ] || { echo "LUMEN_LIBOMP_DIR/libomp.lib fehlt" >&2; exit 1; }
    [ -f "$LUMEN_LIBOMP_DIR/../bin/libomp.dll" ] || { echo "libomp.dll neben LUMEN_LIBOMP_DIR fehlt" >&2; exit 1; }
    export LUMEN_LIBOMP_DIR
    FEATURES=(--features lumen-raw/openmp)
fi

echo "== lumen-bench (release)"
cargo xwin build --release --target "$TARGET" -p lumen-bench "${FEATURES[@]}"

echo "== Testbinaries lumen-raw + lumen-gpu"
# Erst in eine Datei, damit ein Build-Fehler das Skript abbricht (set -e).
JSON="$(mktemp)"
trap 'rm -f "$JSON"' EXIT
cargo xwin test --no-run --target "$TARGET" -p lumen-raw -p lumen-gpu "${FEATURES[@]}" \
    --message-format=json >"$JSON"
mapfile -t TEST_EXES < <(
    python3 -c '
import json, sys
for line in sys.stdin:
    try:
        m = json.loads(line)
    except ValueError:
        continue
    if m.get("reason") == "compiler-artifact" and m.get("profile", {}).get("test") and m.get("executable"):
        crate = m["manifest_path"].replace("\\", "/").split("/")[-2]
        print(crate + "_" + m["target"]["name"] + "\t" + m["executable"])
' <"$JSON"
)
[ "${#TEST_EXES[@]}" -gt 0 ] || { echo "keine Testbinaries gefunden" >&2; exit 1; }

echo "== share/ zusammenstellen"
# Nur generierte Inhalte loeschen, .gitignore bleibt.
rm -rf "$SHARE/bin" "$SHARE/repo" "$SHARE/install-result.txt" "$SHARE/results"
mkdir -p "$SHARE/bin" "$SHARE/repo/tests-fixtures/raw-samples" "$SHARE/repo/tests-fixtures/test-samples"

cp "target/$TARGET/release/lumen-bench.exe" "$SHARE/bin/"
if [ "${#FEATURES[@]}" -gt 0 ]; then
    cp "$LUMEN_LIBOMP_DIR/../bin/libomp.dll" "$SHARE/bin/"
fi
for line in "${TEST_EXES[@]}"; do
    # Eindeutiger Name je Crate + Testziel (errors.rs gibt es zweimal).
    name="${line%%$'\t'*}"
    exe="${line#*$'\t'}"
    cp "$exe" "$SHARE/bin/test_${name}.exe"
done

FIX="$REPO/tests-fixtures"
cp "$FIX/manifest.json" "$SHARE/repo/tests-fixtures/"
cp -r "$FIX/goldens" "$SHARE/repo/tests-fixtures/"
cp "$FIX/test-samples/gradient.jpg" "$SHARE/repo/tests-fixtures/test-samples/"
for f in Nikon_D7100.NEF Sony_A7M3.ARW Nikon_1_S2_portrait.NEF; do
    if [ -f "$FIX/raw-samples/$f" ]; then
        cp "$FIX/raw-samples/$f" "$SHARE/repo/tests-fixtures/raw-samples/"
    else
        echo "WARNUNG: Fixture $f fehlt (scripts/fetch-test-images.sh)" >&2
    fi
done

# Inkrementelle Build-Reste klein halten (testbox-Platte ist geteilt).
rm -rf "target/$TARGET"/*/incremental

ls -l "$SHARE/bin"
du -sh "$SHARE"

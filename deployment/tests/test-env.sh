#!/usr/bin/env bash
# Tests fuer deployment/lib/env.sh (load_dotenv, ensure_private_file).
#   bash deployment/tests/test-env.sh
# Vergleicht zusaetzlich mit dem Parser von docker compose (falls vorhanden),
# damit Shell und compose dieselben Werte sehen.
# Literale $-Strings in einfachen Quotes sind hier Absicht.
# shellcheck disable=SC2016
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/env.sh
. "$HERE/../lib/env.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAIL=0
eq() { if [ "$2" == "$3" ]; then echo "ok   $1"; else echo "FAIL $1: erwartet [$3], bekommen [$2]"; FAIL=1; fi; }

# --- gueltige Datei: Werte muessen 1:1 (ohne Expansion) ankommen ---
cat > "$T/ok.env" <<'EOF'
# Kommentar
   # eingerueckter Kommentar

PLAIN=abc123
HEX=0f1e2d3c4b5a69788796a5b4c3d2e1f0
EQ=a=b=c
URL=postgresql://u:p@host:5432/db?x=1
SPACED = value with spaces
INLINE=wert # kommentar
HASHNOSPACE=a#b
DQ="double quoted # kein kommentar"
SQ='single $HOME $(id) `id` literal'
SQC='x' # kommentar
EMPTY=
EMPTYQ=""
BT=`echo pwned`
CMD=(not a subshell)
export EXPORTED=yes
CRLF=line
EOF
printf 'CRLF2=dos\r\nNOEOL=last' >> "$T/ok.env"
(
  unset PLAIN SPACED
  load_dotenv "$T/ok.env"
  eq plain "$PLAIN" abc123
  eq hex "$HEX" 0f1e2d3c4b5a69788796a5b4c3d2e1f0
  eq "= im Wert" "$EQ" 'a=b=c'
  eq url "$URL" 'postgresql://u:p@host:5432/db?x=1'
  eq "Leerzeichen um =" "$SPACED" 'value with spaces'
  eq inline-kommentar "$INLINE" wert
  eq "# ohne Leerzeichen" "$HASHNOSPACE" 'a#b'
  eq doppelte-quotes "$DQ" 'double quoted # kein kommentar'
  eq "einfache quotes, \$ literal" "$SQ" 'single $HOME $(id) `id` literal'
  eq "quotes + kommentar" "$SQC" x
  eq leer "$EMPTY" ''
  eq "leer quoted" "$EMPTYQ" ''
  eq "backticks nicht ausgefuehrt" "$BT" '`echo pwned`'
  eq "klammern literal" "$CMD" '(not a subshell)'
  eq export-praefix "$EXPORTED" yes
  eq crlf "$CRLF2" dos
  eq "letzte Zeile ohne Newline" "$NOEOL" last
  # exportiert (fuer compose/Kindprozesse sichtbar)?
  eq exportiert "$(bash -c 'printf %s "$PLAIN"')" abc123
) || FAIL=1

# --- Abbrueche ---
expect_fail() {
  printf '%s\n' "$2" > "$T/bad.env"
  if (load_dotenv "$T/bad.env") 2>/dev/null; then echo "FAIL $1: haette abbrechen muessen"; FAIL=1
  else echo "ok   $1 (Abbruch)"; fi
}
expect_fail "\$ unquoted" 'PW=abc$def'
expect_fail "\${VAR} unquoted" 'ISS=${KC_HOSTNAME}/realms/lumen'
expect_fail "\$ in doppelten quotes" 'PW="a$b"'
expect_fail "offene quote" 'PW="abc'
expect_fail "kein KEY=WERT" 'das ist keine zuweisung'
expect_fail "ungueltiger key" '1KEY=x'
expect_fail "\$(...) unquoted" 'X=$(touch /tmp/pwned)'

# --- Vergleich mit docker compose (nur die gueltige Datei) ---
if docker compose version >/dev/null 2>&1; then
  cat > "$T/compose.yml" <<'EOF'
services:
  t:
    image: busybox
    environment:
      PLAIN: ${PLAIN}
      EQ: ${EQ}
      URL: ${URL}
      SPACED: ${SPACED}
      INLINE: ${INLINE}
      HASHNOSPACE: ${HASHNOSPACE}
      DQ: ${DQ}
      SQ: ${SQ}
      SQC: ${SQC}
      EMPTYQ: ${EMPTYQ}
      BT: ${BT}
      EXPORTED: ${EXPORTED}
      CRLF2: ${CRLF2}
      NOEOL: ${NOEOL}
EOF
  # compose allein (ohne Shell-Env) gegen load_dotenv vergleichen. config
  # rendert literales $ escaped als $$ -> zurueckwandeln.
  mine="$(env -i PATH="$PATH" bash -c ". '$HERE/../lib/env.sh'; load_dotenv '$T/ok.env'
    for k in PLAIN EQ URL SPACED INLINE HASHNOSPACE DQ SQ SQC EMPTYQ BT EXPORTED CRLF2 NOEOL; do
      printf '%s=%s\n' \"\$k\" \"\${!k}\"; done")"
  theirs="$(env -i PATH="$PATH" HOME="$HOME" docker compose -p envtest -f "$T/compose.yml" \
    --env-file "$T/ok.env" config --format json \
    | python3 -c 'import json,sys
e = json.load(sys.stdin)["services"]["t"]["environment"]
for k in "PLAIN EQ URL SPACED INLINE HASHNOSPACE DQ SQ SQC EMPTYQ BT EXPORTED CRLF2 NOEOL".split():
    print(k + "=" + (e[k] or "").replace("$$", "$"))')"
  if [ "$mine" == "$theirs" ]; then echo "ok   identisch mit docker compose"
  else echo "FAIL Abweichung zu docker compose:"; diff <(echo "$mine") <(echo "$theirs") || true; FAIL=1; fi
else
  echo "skip docker compose nicht vorhanden"
fi

# --- ensure_private_file ---
touch "$T/secret"; chmod 644 "$T/secret"
ensure_private_file "$T/secret"
eq "chmod 600 erzwungen" "$(stat -c %a "$T/secret")" 600
ensure_private_file "$T/fehlt-nicht-da" && echo "ok   fehlende Datei kein Fehler"
# chmod scheitert (fremder Owner simuliert per Wrapper) -> Abbruch
if ( chmod() { return 1; }; f="$T/shared"; touch "$f"; command chmod 640 "$f"
     ensure_private_file "$f" ) 2>/dev/null; then
  echo "FAIL gruppenlesbar ohne chmod haette abbrechen muessen"; FAIL=1
else echo "ok   gruppenlesbar + chmod scheitert -> Abbruch"; fi

[ "$FAIL" = 0 ] && echo "ALLE TESTS OK" || { echo "TESTS FEHLGESCHLAGEN"; exit 1; }

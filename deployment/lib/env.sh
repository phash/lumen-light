# shellcheck shell=bash
# Gemeinsame Helfer fuer deploy.sh + backup.sh (per `.` eingebunden).
#
# load_dotenv: liest deployment/.env OHNE sie als Shell-Code auszufuehren.
# Frueher `set -a; . deployment/.env` -> $(...)/Backticks in Werten liefen als
# Befehle, `$` wurde von der Shell anders expandiert als von docker compose.
#
# Format (Teilmenge dessen, was docker compose --env-file versteht):
#   KEY=wert            unquoted: umgebende Leerzeichen und " #kommentar" weg
#   KEY="wert"          doppelte Quotes werden entfernt (keine Escapes)
#   KEY='wert'          einfache Quotes werden entfernt
#   export KEY=wert     `export `-Praefix wird ignoriert
#   # kommentar / Leerzeile -> ignoriert
# Es wird NIE expandiert. `$` in unquoted oder "..."-Werten bricht ab, weil
# compose dort expandieren wuerde (Werte waeren sonst unterschiedlich) —
# literales `$` gehoert in '...'. Mehrzeilige Werte werden nicht unterstuetzt.
# Exportierte Werte schlagen in compose das --env-file (Shell-Env gewinnt bei
# der Interpolation) — Shell und Container sehen also dieselben Werte.
# SC2094: _dotenv_dollar gibt nur den Dateinamen aus, schreibt nicht hinein.
# shellcheck disable=SC2094
load_dotenv() {
  local file="$1" line key val n=0
  local re_kv='^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$'
  local re_dq='^"([^"]*)"[[:space:]]*(#.*)?$'
  local re_sq="^'([^']*)'[[:space:]]*(#.*)?\$"
  [ -r "$file" ] || { echo "FEHLER: $file nicht lesbar" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"          # fuehrende Leerzeichen
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" =~ ^export[[:space:]]+(.*)$ ]]; then line="${BASH_REMATCH[1]}"; fi
    if ! [[ "$line" =~ $re_kv ]]; then
      echo "FEHLER: $file Zeile $n: kein KEY=WERT" >&2; return 1
    fi
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ $re_sq ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ $re_dq ]]; then
      val="${BASH_REMATCH[1]}"
      [[ "$val" == *'$'* ]] && { _dotenv_dollar "$file" "$n" "$key"; return 1; }
    elif [[ "$val" == [\"\']* ]]; then
      echo "FEHLER: $file Zeile $n ($key): Quote nicht geschlossen (mehrzeilig nicht unterstuetzt)" >&2
      return 1
    else
      val="${val%%[[:space:]]#*}"                      # Inline-Kommentar " #..."
      val="${val%"${val##*[![:space:]]}"}"             # Leerzeichen am Ende
      [[ "$val" == *'$'* ]] && { _dotenv_dollar "$file" "$n" "$key"; return 1; }
    fi
    export "$key=$val"
  done < "$file"
}

_dotenv_dollar() {
  echo "FEHLER: $1 Zeile $2 ($3): '\$' im Wert — docker compose wuerde expandieren." >&2
  echo "        Literal gemeint? Wert in einfache Quotes setzen: $3='...'" >&2
}

# Datei mit Secrets auf 600 zwingen (nur Owner). Scheitert chmod (fremder
# Owner) und ist die Datei weiter fuer Gruppe/Andere lesbar -> Abbruch.
# Fehlende Datei ist kein Fehler (Existenz pruefen die Aufrufer selbst).
ensure_private_file() {
  local f="$1" mode
  [ -e "$f" ] || return 0
  chmod 600 "$f" 2>/dev/null || true
  mode="$(stat -L -c '%a' "$f")"
  if (( (8#$mode & 8#077) != 0 )); then
    echo "FEHLER: $f hat Modus $mode (Gruppe/Andere duerfen lesen) und chmod 600 schlug fehl." >&2
    echo "        Owner: $(stat -L -c '%U' "$f"), Script laeuft als: $(id -un). Fix: sudo chown $(id -un) '$f' && chmod 600 '$f'" >&2
    return 1
  fi
}

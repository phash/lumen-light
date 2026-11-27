#!/usr/bin/env bash
# Pruefschritte fuer tb-ci (ersetzt .github/workflows/ci.yml) plus Desktop-Workspace.
# Laeuft alle Gates durch und meldet am Ende, welche rot waren (Exit != 0, wenn eines rot ist).
# Aufruf auf testbox: tb-run 'lumen:ci (...)' -- bash -lc 'cd ~/work/lumen && ./ci.sh'
# Bewusst ohne -e: jedes Gate laeuft, Fehler werden in FAILED gesammelt.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
FAILED=()

gate() {
    local name="$1"
    shift
    echo "=== ${name}"
    if "$@"; then
        echo "=== ${name}: ok"
    else
        echo "=== ${name}: FEHLER"
        FAILED+=("${name}")
    fi
}

desktop_ci() {
    # LibRaw kommt als Submodule; ein frischer Clone (tb-ci) hat es noch nicht.
    if [ ! -f "$ROOT/desktop/crates/libraw-sys/vendor/LibRaw/libraw/libraw.h" ]; then
        git -C "$ROOT" submodule update --init || return 1
    fi
    make -C "$ROOT/desktop" ci
}

frontend_ci() {
    cd "$ROOT/frontend" || return 1
    pnpm install --frozen-lockfile &&
        pnpm lint &&
        pnpm exec tsc -b --noEmit &&
        pnpm run test:coverage &&
        VITE_KEYCLOAK_AUTHORITY=http://placeholder \
            VITE_KEYCLOAK_CLIENT_ID=placeholder \
            VITE_API_BASE=http://placeholder/api/v1 \
            pnpm build
}

backend_ci() {
    cd "$ROOT/backend" || return 1
    if [ ! -x .venv/bin/pytest ]; then
        python3 -m venv .venv || return 1
    fi
    .venv/bin/pip install -q --upgrade pip &&
        .venv/bin/pip install -q -r requirements.txt -r requirements-dev.txt &&
        TESTCONTAINERS_RYUK_DISABLED=true .venv/bin/pytest -q --cov=app --cov-report=term-missing
}

gate desktop desktop_ci
gate frontend frontend_ci
gate backend backend_ci

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo "CI rot: ${FAILED[*]}"
    exit 1
fi
echo "CI gruen"

# Spec · Frontend Auth via Keycloak

**Datum:** 2026-04-27
**Iteration:** 5
**Vorgänger:** Iteration 4 (Backend ist Resource Server für Realm `lumen`)

## Motivation

Iteration 4 hat das Backend auf Keycloak umgestellt. Das Frontend braucht jetzt einen OIDC-Login-Flow, sodass User authentifizierte API-Calls absetzen können. Das Skelett aus Iteration 2 hat fünf Routes als Platzhalter — diese Iteration füllt Login/Logout, schützt `/editor` + `/account` und stellt einen API-Client bereit, der das Token aus dem OIDC-Context zieht.

## Ziel

- `react-oidc-context` ist eingebunden, `<AuthProvider>` umschließt die App.
- Login leitet zum Keycloak-Login-Screen (Authorization Code + PKCE), Callback wird in der App verarbeitet.
- `<RequireAuth>`-Wrapper redirected unauthentifizierte Nutzer zu `/login`.
- Header zeigt Login-Button (wenn ausgeloggt) bzw. User-Email + Logout-Button (wenn eingeloggt).
- API-Client `src/api/client.ts` kapselt `fetch`-Calls mit `Authorization: Bearer ...`.
- Vitest-Tests decken: Login-Trigger, RequireAuth-Redirect, Header-State, API-Client-Header-Setzen.
- Tests nutzen einen Mock-`AuthProvider` (in-Test gestubbt), keine echte Keycloak-Instanz im Vitest — das wäre overkill für Frontend-Logik-Tests. End-to-End-Test gegen den echten Stack ist eine spätere Iteration.

## Nicht-Ziel

- Kein Editor-Code (Iteration 8+).
- Keine Image-Library (Iteration 6).
- Keine Run-Time-Konfiguration für Production (Iteration 7) — Iteration 5 nutzt `import.meta.env`, in Iteration 7 wird das auf `/config.json` umgestellt.
- Kein Silent-Renew über iframe — wir initiieren Token-Refresh on-demand bei 401-Antworten. Reicht fürs MVP.

## Konfiguration

Vite-Env-Variablen (siehe `frontend/.env.example`):

```
VITE_KEYCLOAK_AUTHORITY=http://localhost:18080/realms/lumen
VITE_KEYCLOAK_CLIENT_ID=lumen-frontend
VITE_API_BASE=http://localhost:8000/api/v1
```

Für Production werden diese in Iteration 7 zur Run-Time aufgelöst (z. B. `config.json` von nginx ausgeliefert), nicht zur Build-Time eingebrannt.

## Komponenten-Tree

```
<App>
  <AuthProvider config>          ← react-oidc-context
    <BrowserRouter>
      <Header />                  ← zeigt Login/Logout je nach auth.isAuthenticated
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />          ← Klick = signinRedirect()
        <Route path="/register" element={<Register />} />    ← Link zu Keycloak-Register
        <Route path="/callback" element={<Callback />} />    ← OIDC-Callback-Handler
        <Route path="/editor" element={<RequireAuth><Editor /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>
</App>
```

`<RequireAuth>` ist ein eigener Wrapper:

```tsx
function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <FullScreenLoader />;
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
```

`<Callback>`-Page hat eine Redirect-Logik nach erfolgreicher Code-Eintauschung — react-oidc-context macht das automatisch via `automaticSilentRenew` und `onSigninCallback`-Callback (im AuthProvider-Config gesetzt).

## API-Client

`src/api/client.ts`:

```ts
import type { User as OidcUser } from "oidc-client-ts";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function createApiClient(getUser: () => OidcUser | null | undefined) {
  const base = import.meta.env.VITE_API_BASE;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const user = getUser();
    if (user?.access_token) headers.set("Authorization", `Bearer ${user.access_token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, body.detail ?? res.statusText, body.code);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }
  return {
    me: () => request<{ id: string; email: string; created_at: string }>("/auth/me"),
    listPresets: () => request<unknown[]>("/presets"),
    // weitere Calls in Iteration 6+
  };
}
```

`createApiClient` nimmt eine Getter-Funktion für den OIDC-User entgegen — damit ist der Client von `react-oidc-context` entkoppelt und in Tests easy stubbable. Hooks-Wrapper:

```ts
// src/api/use-api.ts
import { useAuth } from "react-oidc-context";
import { useMemo } from "react";

export function useApi() {
  const auth = useAuth();
  return useMemo(() => createApiClient(() => auth.user), [auth.user]);
}
```

## Test-Strategie

Tests, die Auth-State brauchen, nutzen einen handgeschriebenen Mock-Provider (kein react-oidc-context-Auto-Wiring, kein msw), weil:

1. msw für OIDC-Endpoints simulieren ist umfangreich und entkoppelt sich nicht vom oidc-client-ts-Internals.
2. Wir testen *unsere* Komponenten-Logik („was tun wir je nach Auth-State"), nicht die Library.
3. Ein End-to-End-Test mit echtem Keycloak ist eine eigene Iteration (z. B. Playwright in It 7).

Mock-Provider:

```tsx
// tests/test-utils.tsx
import { AuthContext, AuthContextProps } from "react-oidc-context";

export function makeFakeAuth(overrides: Partial<AuthContextProps> = {}): AuthContextProps {
  return {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    activeNavigator: undefined,
    error: undefined,
    settings: {} as never,
    events: {} as never,
    clearStaleState: vi.fn(),
    removeUser: vi.fn(),
    signinPopup: vi.fn(),
    signinSilent: vi.fn(),
    signinRedirect: vi.fn(),
    signinResourceOwnerCredentials: vi.fn(),
    signoutPopup: vi.fn(),
    signoutRedirect: vi.fn(),
    signoutSilent: vi.fn(),
    querySessionStatus: vi.fn(),
    revokeTokens: vi.fn(),
    startSilentRenew: vi.fn(),
    stopSilentRenew: vi.fn(),
    ...overrides,
  };
}

export function renderWithAuth(ui: ReactElement, auth: AuthContextProps) {
  return render(<AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>);
}
```

## Tests (Soll-Zustand nach Iteration 5)

| Datei | Tests |
|---|---|
| `tests/App.test.tsx` (bestehend) | 6 (unverändert — kein Auth involved) |
| `tests/Header.test.tsx` (neu) | 3: zeigt Login wenn ausgeloggt, zeigt Email+Logout wenn eingeloggt, Klick auf Login triggert `signinRedirect` |
| `tests/RequireAuth.test.tsx` (neu) | 3: redirected auf `/login` wenn ausgeloggt, rendert Children wenn eingeloggt, zeigt Loader während `isLoading` |
| `tests/api-client.test.ts` (neu) | 4: setzt Authorization-Header wenn User vorhanden, kein Header wenn null, wirft ApiError bei 4xx, gibt undefined bei 204 |

**Summe:** 16 Tests. Ziel: alle grün.

## Akzeptanzkriterien

1. `npm run test` → 16 grün.
2. `npm run lint` → 0 errors.
3. `npm run build` → ohne TS-Fehler.
4. `npm run dev` lokal mit echtem Keycloak (`docker compose up keycloak` separat oder testcontainers) zeigt Login-Flow.
5. Konfiguration via `VITE_*`-Env-Vars dokumentiert in `frontend/.env.example` und `README.md`.
6. Realm-Export-`redirectUris` enthält `http://localhost:5173/callback` — vorhanden, evtl. konkretisieren.

## Risiken

- **react-oidc-context-API-Änderungen:** v4 hat sich gegenüber v3 in Details geändert. Wir pinnen exakt.
- **Realm-Export-Mapping:** wenn der Audience-Mapper im Realm-Export einen Tippfehler hat, scheitern Backend-Calls auf 401. Fix: bei 401 in den `aud`-Claim schauen.
- **Mock-Provider-Drift:** wenn `react-oidc-context` neue Felder zu `AuthContextProps` ergänzt, wird `makeFakeAuth` warnen. Fix: pin und beim Update mitziehen.

# Spec · Vite-Frontend-Skelett

**Datum:** 2026-04-27
**Status:** Entwurf, bereit für Plan
**Iteration:** 2 (von vielen)
**Vorgänger:** Iteration 1 (Backend test-tauglich) — abgeschlossen

## Motivation

Das Frontend liegt aktuell als zwei lose Dateien im Repo: `frontend/lightroom-light.jsx` (689-Zeilen-Prototyp, demoabhängig von `window.storage`) und `frontend/api-client.ts`. Es gibt kein `package.json`, keine Build-Pipeline, kein Test-Framework, kein Routing.

Bevor Editor-Logik, Auth-Flow oder Preset-Speicherung gegen das Backend gebaut werden, braucht es ein laufendes, getestetes Vite-Skelett. Iteration 2 ist bewusst klein: **nur das Tooling und 5 leere Routen.** Auth-Funktionalität (AuthStore, Login/Register-Forms, AuthGuard) ist Iteration 3.

## Ziel

- `cd frontend && npm ci && npm run build` läuft auf einem frischen Checkout grün durch.
- `npm run dev` startet einen Dev-Server unter http://localhost:5173 mit funktionierendem HMR.
- `npm run test` läuft Vitest mit mindestens einem grünen Test.
- `npm run lint` läuft ESLint mit 0 Errors.
- Browser-seitig sind 5 Routes navigierbar: `/`, `/login`, `/register`, `/editor`, `/account` — jede zeigt eine Platzhalter-Seite mit klar erkennbarem Inhalt.
- TypeScript läuft im strict-Mode, kein `any`-Cast im Code.

## Nicht-Ziel (verschoben auf Iteration 3+)

- Keine Auth-Logik. Kein AuthStore, keine API-Calls, keine Token-Speicherung.
- Kein AuthGuard. `/editor` und `/account` sind in Iteration 2 nicht geschützt — sie zeigen einfach die Platzhalter-Seite.
- Keine Editor-Logik. Kein WebGL2, keine Slider, kein Histogramm. Der Prototyp wird in Iteration 4 zerlegt.
- Kein Design-Polish. Die Platzhalter-Seiten sind funktional, nicht schön.
- Keine E2E-Tests (Playwright). Vitest + React Testing Library reichen für diese Iteration.

## Verzeichnis-Struktur

`frontend/` wird das Vite-Projekt-Root.

```
frontend/
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── eslint.config.js
├── vitest.config.ts            (oder per vite.config.ts)
├── index.html
├── public/
├── src/
│   ├── main.tsx                Bootstrap (createRoot)
│   ├── App.tsx                 Router mit den 5 Routes
│   ├── index.css               Tailwind-Imports
│   ├── pages/
│   │   ├── Landing.tsx
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Editor.tsx
│   │   └── Account.tsx
│   ├── components/
│   │   └── Header.tsx          Nav mit den 5 Routes als Links
│   └── test-setup.ts           jsdom + jest-dom
├── tests/
│   └── App.test.tsx            erster Test: Router rendert Landing
└── legacy/
    ├── lightroom-light.jsx     unverändert, Quelle für Iteration 4
    └── api-client.ts           unverändert, Quelle für Iteration 3
```

**Verschieben:** `frontend/lightroom-light.jsx` → `frontend/legacy/lightroom-light.jsx`. `frontend/api-client.ts` → `frontend/legacy/api-client.ts`. Diese Dateien werden in Iteration 3 (api-client) und Iteration 4 (Editor-Komponenten) zerlegt und aus `legacy/` herausgezogen.

**Begründung:** Vite erwartet `index.html` und `package.json` im Projekt-Root. Die alten Files sind keine echten ES-Module für Vite (JSX ohne Type-Setup). In `legacy/` markieren sie sich klar als Quelle, nicht als aktiver Code.

## Stack-Wahl

| Schicht | Technologie | Version (Stand 2026-04-27) | Begründung |
|---|---|---|---|
| Build | Vite | 8.0.x | aktueller Stable-Major, native ESM, Vitest-Integration |
| Framework | React | 19.x | aktueller Stable-Major; Konzept-Doc 05 wird auf 19 aktualisiert |
| Sprache | TypeScript | 6.0.x | strict-Mode, kein `any` |
| Styling | Tailwind CSS | 4.x | v4 ohne `tailwind.config.js`, alles via CSS — passt zu Vite-Plugin |
| Routing | react-router-dom | 7.x | aktueller Major, Data Router |
| Tests | Vitest | 4.x | Vite-nativ |
| DOM-Tests | @testing-library/react + @testing-library/jest-dom + jsdom | aktuell | Standard für React-Tests |
| Lint | eslint + typescript-eslint + eslint-plugin-react | aktuell, flat-config | flat-config ist Default in eslint v9 |

**Bewusste Abweichung vom Konzept-Doc 05:** dort steht React 18, das ist veraltet. Konzept-Doc wird in dieser Iteration mitaktualisiert.

**Bewusste Auslassung:** Zustand (State-Management) wird erst in Iteration 3 eingeführt, wenn der AuthStore gebraucht wird. Iteration-2-Pages haben keinen State außer dem von React-Router.

## Routing

```tsx
// src/App.tsx (vereinfacht)
import { BrowserRouter, Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main className="...">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

Routes sind in dieser Iteration **alle öffentlich.** Der `<Header />` zeigt Links zu allen fünf — primär zur manuellen Verifikation.

## Tests (Soll-Zustand nach Iteration 2)

`tests/App.test.tsx`:

1. `test_landing_renders_on_root` — Aufruf von `/`, erwartet sichtbaren Landing-Inhalt
2. `test_navigates_to_login_on_link_click` — Klick auf "Login" im Header navigiert zu `/login`
3. `test_navigates_to_editor_on_link_click` — analog für `/editor`
4. `test_unknown_route_renders_landing_or_404` — entscheide bei der Implementierung; aktuell: Landing als Fallback ist OK, weil noch kein 404 nötig

Pro Page minimal: `pages/Landing.test.tsx`, `pages/Login.test.tsx` etc. später, wenn die Pages Inhalt bekommen. Iteration 2 reicht ein zentraler App-Router-Test.

## Tooling-Konfiguration

### TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": false,
    "useDefineForClassFields": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`noUncheckedIndexedAccess: true` macht aus `array[i]` ein `T | undefined` — fängt klassische Off-by-One-Bugs zur Compile-Zeit.

### ESLint (flat-config)

```js
// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "legacy"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
    settings: { react: { version: "detect" } },
  },
);
```

`legacy/` ist explizit ausgenommen — der Prototyp soll Iterationen-2-Lint nicht blockieren.

### Tailwind v4

Tailwind 4 hat **keine** `tailwind.config.js` mehr; die Konfiguration läuft über `@theme`-Direktiven im CSS und das Vite-Plugin.

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* Lumen-Farbpalette aus dem Prototyp uebernommen, formal definieren spaeter. */
  --color-stone-950: #0a0908;
  --color-amber-200: #fde68a;
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

### Vitest

Konfig läuft im `vite.config.ts` (Vitest erbt vom Vite-Konfig). Keine separate `vitest.config.ts` nötig.

`src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

## Akzeptanzkriterien (Definition of Done)

1. **Install:** `cd frontend && npm ci` läuft fehlerfrei.
2. **Build:** `npm run build` produziert `dist/` ohne TS- oder Lint-Fehler.
3. **Dev-Server:** `npm run dev` startet, http://localhost:5173 zeigt die Landing-Page.
4. **Tests:** `npm run test` läuft mit ≥ 4 Tests grün.
5. **Lint:** `npm run lint` gibt 0 Errors aus.
6. **Routing:** alle 5 Routes per URL erreichbar, Header-Links navigieren.
7. **TypeScript:** `tsc --noEmit` ohne Fehler. Kein `any` im neuen Code.
8. **Tailwind:** mindestens eine Tailwind-Klasse hat sichtbaren Effekt (z. B. Hintergrundfarbe der Landing-Page).
9. **Konzept-Doc 05 aktualisiert:** Versions-Update auf React 19, Vite 8, RR 7, Vitest 4 sichtbar dokumentiert.
10. **MRD-Doku synchron:** Frontend-Konzept-Document in MRD aktualisiert.

## Offene Fragen / Risiken

- **Tailwind v4 + React 19 + Vitest 4:** alle drei sind frisch (2025). Wenn ein Plugin-Konflikt auftaucht (z. B. `@tailwindcss/vite` x `@vitejs/plugin-react`), wird das im Plan an der Stelle behandelt, an der es auftritt.
- **React Router 7:** der Default-Modus heißt jetzt "Framework Mode" (mit File-System-Routing). Wir wollen aber **explizit** den klassischen "Library Mode" mit `<BrowserRouter>` — siehe RR7-Migration-Guide. Der Plan geht das explizit an.
- **`legacy/`-Ausschluss:** der Prototyp `lightroom-light.jsx` läuft nicht durch TS-strict (keine Types, JSX statt TSX). Er muss aus `tsconfig.json` `include` und ESLint `ignores` ausgeschlossen sein.

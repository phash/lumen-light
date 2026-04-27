# Frontend-Skelett Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vite-Frontend-Skelett im `frontend/`-Verzeichnis: React 19 + TypeScript strict + Tailwind v4 + Vitest + React Router 7. Fünf leere Routes navigierbar, erster Test grün, Build durchläuft.

**Architecture:** `frontend/` wird das Vite-Projekt-Root. `lightroom-light.jsx` und `api-client.ts` ziehen nach `frontend/legacy/` und werden in späteren Iterationen zerlegt. ESLint `legacy/` ausgenommen, TypeScript `legacy/` ausgenommen.

**Tech Stack:** Vite 8 + React 19 + TypeScript 6 (strict + noUncheckedIndexedAccess) + Tailwind 4 (CSS-first) + react-router-dom 7 + Vitest 4 + @testing-library/react.

---

## Files

**Create:**
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- `frontend/eslint.config.js`
- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/test-setup.ts`
- `frontend/src/components/Header.tsx`
- `frontend/src/pages/Landing.tsx`
- `frontend/src/pages/Login.tsx`
- `frontend/src/pages/Register.tsx`
- `frontend/src/pages/Editor.tsx`
- `frontend/src/pages/Account.tsx`
- `frontend/tests/App.test.tsx`
- `frontend/.gitignore` (oder `frontend/`-Pfade in der globalen `.gitignore` reichen — die hat schon `node_modules/` und `dist/`)

**Move:**
- `frontend/lightroom-light.jsx` → `frontend/legacy/lightroom-light.jsx`
- `frontend/api-client.ts` → `frontend/legacy/api-client.ts`

**Modify:**
- `docs/05-frontend-konzept.md` — React 18→19, Versions-Updates an passender Stelle
- `README.md` — Frontend-Schnellstart aktualisieren

---

## Task 1: Legacy-Dateien beiseite ziehen

**Files:**
- Move: `frontend/lightroom-light.jsx`, `frontend/api-client.ts`

- [ ] **Step 1: legacy/-Verzeichnis anlegen und Dateien verschieben**

```bash
cd /home/manuel/claude/lumen
mkdir -p frontend/legacy
git mv frontend/lightroom-light.jsx frontend/legacy/lightroom-light.jsx
git mv frontend/api-client.ts frontend/legacy/api-client.ts
ls frontend/
```

Expected: `legacy/` als einziger Eintrag (leeres `frontend/` davor, jetzt nur das Unterverzeichnis).

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(frontend): move prototype + api-client to legacy/ for vite skeleton"
```

---

## Task 2: package.json mit Dependencies & Scripts

**Files:**
- Create: `frontend/package.json`

- [ ] **Step 1: package.json schreiben**

```json
{
  "name": "lumen-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.14.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@tailwindcss/vite": "^4.2.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react": "^7.37.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "globals": "^15.0.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.2.0",
    "typescript": "^6.0.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^8.0.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 2: npm install**

```bash
cd frontend && npm install 2>&1 | tail -10
```

Expected: `added N packages` ohne Resolver-Konflikte.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add package.json with vite/react/ts/tailwind/vitest stack"
```

---

## Task 3: TypeScript & Vite-Konfiguration

**Files:**
- Create: `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`

- [ ] **Step 1: tsconfig.json**

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
    "useDefineForClassFields": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests"],
  "exclude": ["legacy", "dist", "node_modules"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "eslint.config.js"]
}
```

- [ ] **Step 3: vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts
git commit -m "build(frontend): tsconfig strict + vite config with react/tailwind/vitest"
```

---

## Task 4: ESLint flat-config

**Files:**
- Create: `frontend/eslint.config.js`

- [ ] **Step 1: eslint.config.js schreiben**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "legacy"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
    },
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/eslint.config.js
git commit -m "build(frontend): eslint flat-config with typescript-eslint + react"
```

---

## Task 5: index.html + Tailwind-CSS + Bootstrap

**Files:**
- Create: `frontend/index.html`, `frontend/src/index.css`, `frontend/src/main.tsx`

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lumen · light</title>
  </head>
  <body class="bg-stone-950 text-stone-200 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: src/index.css**

```css
@import "tailwindcss";

@theme {
  /* Lumen-spezifische Farben aus dem Prototyp; werden in Iteration 4
     zusammen mit dem Editor formal aufgesetzt. */
  --color-lumen-bg: #0a0908;
  --color-lumen-accent: #fde68a;
}

html,
body,
#root {
  height: 100%;
}
```

- [ ] **Step 3: src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root nicht gefunden");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/index.css frontend/src/main.tsx
git commit -m "feat(frontend): index.html + tailwind setup + react bootstrap"
```

---

## Task 6: Pages & Header

**Files:**
- Create: `frontend/src/pages/Landing.tsx`, `Login.tsx`, `Register.tsx`, `Editor.tsx`, `Account.tsx`
- Create: `frontend/src/components/Header.tsx`

- [ ] **Step 1: 5 Platzhalter-Pages**

```tsx
// src/pages/Landing.tsx
export default function Landing() {
  return (
    <section data-testid="page-landing" className="p-8">
      <h1 className="text-3xl">Lumen · light</h1>
      <p className="mt-2 text-stone-400">
        Browser-basierter, self-hosted RAW-Entwickler. Skelett — Iteration 2.
      </p>
    </section>
  );
}
```

```tsx
// src/pages/Login.tsx
export default function Login() {
  return (
    <section data-testid="page-login" className="p-8">
      <h1 className="text-3xl">Anmelden</h1>
      <p className="mt-2 text-stone-400">Login-Form folgt in Iteration 3.</p>
    </section>
  );
}
```

```tsx
// src/pages/Register.tsx
export default function Register() {
  return (
    <section data-testid="page-register" className="p-8">
      <h1 className="text-3xl">Registrieren</h1>
      <p className="mt-2 text-stone-400">Register-Form folgt in Iteration 3.</p>
    </section>
  );
}
```

```tsx
// src/pages/Editor.tsx
export default function Editor() {
  return (
    <section data-testid="page-editor" className="p-8">
      <h1 className="text-3xl">Editor</h1>
      <p className="mt-2 text-stone-400">
        Editor-Skelett folgt in Iteration 4 (Slider, Histogramm, Pipeline).
      </p>
    </section>
  );
}
```

```tsx
// src/pages/Account.tsx
export default function Account() {
  return (
    <section data-testid="page-account" className="p-8">
      <h1 className="text-3xl">Account</h1>
      <p className="mt-2 text-stone-400">Account-Settings folgen in Iteration 3.</p>
    </section>
  );
}
```

- [ ] **Step 2: Header mit Nav-Links**

```tsx
// src/components/Header.tsx
import { NavLink } from "react-router-dom";

const links: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Start" },
  { to: "/login", label: "Login" },
  { to: "/register", label: "Registrieren" },
  { to: "/editor", label: "Editor" },
  { to: "/account", label: "Account" },
];

export default function Header() {
  return (
    <header className="border-b border-stone-800 px-6 py-3">
      <nav aria-label="Hauptnavigation" className="flex gap-4">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              isActive
                ? "text-amber-200"
                : "text-stone-400 hover:text-stone-200"
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages frontend/src/components
git commit -m "feat(frontend): 5 placeholder pages + header nav"
```

---

## Task 7: App-Router + erster Test

**Files:**
- Create: `frontend/src/App.tsx`, `frontend/src/test-setup.ts`, `frontend/tests/App.test.tsx`

- [ ] **Step 1: src/test-setup.ts**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: src/App.tsx**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Editor from "./pages/Editor";
import Account from "./pages/Account";

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main>
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

- [ ] **Step 3: tests/App.test.tsx — TDD-Style: Tests schreiben, dann grün laufen**

```tsx
import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "../src/components/Header";
import Landing from "../src/pages/Landing";
import Login from "../src/pages/Login";
import Editor from "../src/pages/Editor";

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Header />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("App routing skeleton", () => {
  it("renders Landing on root path", () => {
    renderWithRouter("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();
  });

  it("renders Login on /login", () => {
    renderWithRouter("/login");
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("renders Editor on /editor", () => {
    renderWithRouter("/editor");
    expect(screen.getByTestId("page-editor")).toBeInTheDocument();
  });

  it("navigates to login when header link is clicked", async () => {
    const user = userEvent.setup();
    renderWithRouter("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Login" }));
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Tests laufen lassen**

```bash
cd frontend && npm run test 2>&1 | tail -25
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/test-setup.ts frontend/tests/App.test.tsx
git commit -m "feat(frontend): App router with 5 routes + 4 routing tests"
```

---

## Task 8: Build, Lint, Dev-Server-Check

**Files:** keine — nur Verifikation

- [ ] **Step 1: TypeScript-Check ohne Emit**

```bash
cd frontend && npx tsc -b 2>&1 | tail -10
```

Expected: 0 Fehler.

- [ ] **Step 2: ESLint laufen lassen**

```bash
cd frontend && npm run lint 2>&1 | tail -20
```

Expected: 0 Errors. Warnings akzeptabel, aber dokumentiert.

- [ ] **Step 3: Vite-Build**

```bash
cd frontend && npm run build 2>&1 | tail -15
```

Expected: `dist/`-Output mit `index.html` und gehashten Assets, `built in N ms`.

- [ ] **Step 4: Dev-Server hochfahren (background) und kurz prüfen, dann beenden**

```bash
cd frontend && (npm run dev &) && sleep 3 && curl -sS http://localhost:5173/ | head -20 && pkill -f 'vite' || true
```

Expected: HTML mit `<div id="root">` und Vite-HMR-Script.

- [ ] **Step 5: Komplette Suite final**

```bash
cd frontend && npm run test 2>&1 | tail -10
```

Expected: 4 passed.

---

## Task 9: Konzept-Doc 05 + README aktualisieren

**Files:**
- Modify: `docs/05-frontend-konzept.md`
- Modify: `README.md`

- [ ] **Step 1: docs/05-frontend-konzept.md — React-18-Erwähnungen auf 19 heben**

In `docs/05-frontend-konzept.md` den Stack-Abschnitt anpassen:

```diff
-| UI-Framework | React 18 | Bekannt, breite Ökosystem, du arbeitest schon damit |
+| UI-Framework | React 19 | Aktueller Stable-Major (Nov 2024), Concurrent-Features default |
```

Falls weitere konkrete Versionsangaben drin sind, mit aktuellen abgleichen (Vite 8, RR 7, Vitest 4).

- [ ] **Step 2: README.md — Frontend-Schnellstart**

In `README.md` den Frontend-Schnellstart-Abschnitt ersetzen durch:

```markdown
# Frontend (Vite-Projekt im frontend/-Verzeichnis)
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run test     # Vitest
npm run lint     # ESLint
npm run build    # Production-Build nach dist/
```

- [ ] **Step 3: Commit**

```bash
git add docs/05-frontend-konzept.md README.md
git commit -m "docs: align frontend-konzept and README with iteration-2 stack (vite/react19/rr7/tailwind4)"
```

---

## Task 10: MRD-Doku aktualisieren

**Files:** keine — externer API-Call

- [ ] **Step 1: Frontend-Konzept-Document in MRD aktualisieren (Stack-Updates)**

```bash
DOC_ID=a165614c-afcd-4141-b436-bd8d9cd62c1f  # MRD Frontend-Konzept
# PUT /documents/:id mit angepasstem TipTap-Content; pragmatisch:
# wir lesen die aktualisierte docs/05-frontend-konzept.md durch denselben
# md_to_tiptap-Konverter wie in /tmp/lumen_docs.py und schicken sie als
# vollstaendige content-Ueberschreibung.
```

(Konkret: derselbe Helper wie bei Iteration 0 — `/tmp/md_to_tiptap.py` lebt in der vorherigen Session, wird hier neu erstellt falls weg.)

- [ ] **Step 2: Iteration-2-Changelog-Eintrag in der "Laufzeit"-Kategorie**

Dokument unter `parentId: ff8226f4-84a8-45f9-8d6a-8c8c7d4d5c89`, Titel "Iteration 2 abgeschlossen — Vite-Frontend-Skelett", Inhalt: kurzer Bullet-Point-Bericht, was steht (4 Tests grün, 5 Routes, Build durch).

---

## Self-Review

1. **Spec-Coverage:** alle Akzeptanzkriterien aus dem Spec werden durch Tasks abgedeckt:
   - Install/Build/Dev/Test/Lint → Tasks 2, 7, 8
   - 5 Routes navigierbar → Tasks 6, 7
   - TS strict ohne `any` → Task 3 (tsconfig)
   - Tailwind Effekt → Task 5 + Header in 6 (`bg-stone-950`)
   - Konzept-Doc + MRD-Sync → Tasks 9, 10

2. **Placeholder-Scan:** keine "TBD"/"später ergänzen". Jede Code-Datei ist vollständig. ESLint- und tsconfig-Konfigs sind komplett — auch wenn das verbose wirkt.

3. **Type-Konsistenz:** `data-testid="page-landing|login|register|editor|account"` einheitlich. Page-Komponenten als Default-Exports konsistent. `links`-Array in `Header.tsx` typed via `ReadonlyArray<{ to: string; label: string }>`.

4. **Risiken (Spec-Punkt):**
   - **Tailwind v4 + Vite 8:** beide neu, Plugin-Kompat soll passen. Falls nicht: Task 5 zeigt Fehler beim ersten `npm run dev`, dann Plan: Vite 7 + Tailwind 4 ist getestete Kombi (Tailwind-4-Docs).
   - **React Router 7 Library Mode:** `<BrowserRouter>` ist in v7 weiterhin verfügbar (Library Mode). Falls v7-Default sich geändert hat: explizit aus `react-router-dom` importiert, das stellt Library Mode sicher.
   - **`legacy/`-Ausschluss:** in `tsconfig.json:exclude` UND `eslint.config.js:ignores` verankert.

---

## Nach Abschluss dieser Iteration

Frontend hat eine tragfähige Build- und Test-Pipeline. Iteration 3 kann darauf den Auth-Flow aufsetzen (AuthStore, Login/Register-Forms, AuthGuard, API-Calls gegen Backend mit `legacy/api-client.ts` als Vorlage).

/**
 * SSR-Entry fuer das Prerendering der Public-Routes (Landing, Datenschutz,
 * Impressum). Wird von `scripts/prerender.mjs` nach `vite build --ssr`
 * benutzt, um statisches HTML in den `#root`-Container zu schreiben — damit
 * Crawler und KI-Engines (kein JS) echten Inhalt sehen.
 *
 * Bewusst KEIN AuthProvider: dessen UserManager greift auf window/localStorage
 * zu und wuerde in Node crashen. Stattdessen ein statischer, ausgeloggter
 * AuthContext (wie in den Component-Tests). Waehrend renderToString laufen
 * weder Effects noch Handler, daher reichen No-Op-Methoden.
 */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { AuthContext, type AuthContextProps } from "react-oidc-context";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Header from "./components/Header";
import { CONTENT } from "./i18n/content";
import { jsonLdScripts } from "./i18n/structuredData";
import Datenschutz from "./pages/Datenschutz";
import Impressum from "./pages/Impressum";
import Landing from "./pages/Landing";
import MarketplaceIntro from "./pages/MarketplaceIntro";

const noop = () => undefined;
const asyncNoop = () => Promise.resolve();

const ssrAuth = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  activeNavigator: undefined,
  error: undefined,
  settings: {},
  events: {},
  clearStaleState: asyncNoop,
  removeUser: asyncNoop,
  signinPopup: asyncNoop,
  signinSilent: asyncNoop,
  signinRedirect: asyncNoop,
  signinResourceOwnerCredentials: asyncNoop,
  signoutPopup: asyncNoop,
  signoutRedirect: asyncNoop,
  signoutSilent: asyncNoop,
  querySessionStatus: asyncNoop,
  revokeTokens: asyncNoop,
  startSilentRenew: noop,
  stopSilentRenew: noop,
} as unknown as AuthContextProps;

// Routen, die prerendert werden. Single Source fuer prerender.mjs + sitemap.
export const PRERENDER_ROUTES: readonly string[] = [
  "/",
  "/en",
  "/marketplace",
  "/datenschutz",
  "/impressum",
];

function Shell({ url }: { url: string }): ReactElement {
  return (
    <AuthContext.Provider value={ssrAuth}>
      <MemoryRouter initialEntries={[url]}>
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<Landing lang="de" />} />
            <Route path="/en" element={<Landing lang="en" />} />
            {/* Standalone-Prerender braucht eigenes px: MarketplaceIntro hat
                bewusst kein horizontales Padding (live liefert die Section es). */}
            <Route
              path="/marketplace"
              element={
                <div className="px-8 py-8 max-w-6xl mx-auto">
                  <MarketplaceIntro lang="de" />
                </div>
              }
            />
            <Route path="/datenschutz" element={<Datenschutz />} />
            <Route path="/impressum" element={<Impressum />} />
          </Routes>
        </main>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

export function render(url: string): string {
  return renderToString(<Shell url={url} />);
}

// Vom Node-Prerender (scripts/prerender.mjs) gelesen: locale-korrekte JSON-LD-
// Bloecke + hreflang-Alternates. Single Source dafuer ist structuredData.ts.
const BASE = "https://lumen.mr-development.de";
export const LANDING_JSONLD: Record<"de" | "en", string> = {
  de: jsonLdScripts("de"),
  en: jsonLdScripts("en"),
};
export const HREFLANG_HTML =
  `<link rel="alternate" hreflang="de" href="${BASE}/" />\n` +
  `    <link rel="alternate" hreflang="en" href="${BASE}/en" />\n` +
  `    <link rel="alternate" hreflang="x-default" href="${BASE}/en" />`;

// Head-Meta (title/description/ogTitle) aus der Single Source CONTENT — vom
// Node-Prerender konsumiert, damit diese Strings NICHT in prerender.mjs
// dupliziert werden. Rechtsseiten haben kein CONTENT-Pendant und bleiben dort
// als Literale. ogTitle faellt im Prerender auf title zurueck, wenn leer.
export interface RouteHead {
  readonly title: string;
  readonly description: string;
  readonly ogTitle?: string;
}
export const HEAD_META: Record<"/" | "/en" | "/marketplace", RouteHead> = {
  "/": {
    title: CONTENT.de.meta.title,
    description: CONTENT.de.meta.description,
    ogTitle: CONTENT.de.meta.ogTitle,
  },
  "/en": {
    title: CONTENT.en.meta.title,
    description: CONTENT.en.meta.description,
    ogTitle: CONTENT.en.meta.ogTitle,
  },
  "/marketplace": {
    title: CONTENT.de.marketplace.title,
    description: CONTENT.de.marketplace.description,
  },
};

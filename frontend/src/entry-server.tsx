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
import Datenschutz from "./pages/Datenschutz";
import Impressum from "./pages/Impressum";
import Landing from "./pages/Landing";

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
export const PRERENDER_ROUTES: readonly string[] = ["/", "/datenschutz", "/impressum"];

function Shell({ url }: { url: string }): ReactElement {
  return (
    <AuthContext.Provider value={ssrAuth}>
      <MemoryRouter initialEntries={[url]}>
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<Landing />} />
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

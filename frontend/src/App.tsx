import type { ReactNode } from "react";
import { AuthProvider } from "react-oidc-context";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import MatomoRouteTracker from "./analytics/MatomoRouteTracker";
import { oidcConfig } from "./auth/config";
import Callback from "./auth/Callback";
import RequireAdmin from "./auth/RequireAdmin";
import RequireAuth from "./auth/RequireAuth";
import Header from "./components/Header";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import Datenschutz from "./pages/Datenschutz";
import Editor from "./pages/Editor";
import Impressum from "./pages/Impressum";
import Landing from "./pages/Landing";
import Library from "./pages/Library";
import Login from "./pages/Login";
import Marketplace from "./pages/Marketplace";
import NotFound from "./pages/NotFound";
import Register from "./pages/Register";

/**
 * Inhalts-Wrapper: genau ein <main> pro Seite. Der Editor rendert sein
 * eigenes <main> (Canvas-Bereich), dort wird der Wrapper zum <div>.
 */
function ContentWrapper({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  if (pathname.startsWith("/editor")) return <div>{children}</div>;
  return <main>{children}</main>;
}

export default function App() {
  return (
    <AuthProvider {...oidcConfig}>
      <BrowserRouter>
        <MatomoRouteTracker />
        <Header />
        <ContentWrapper>
          <Routes>
            <Route path="/" element={<Landing lang="de" />} />
            <Route path="/en" element={<Landing lang="en" />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/callback" element={<Callback />} />
            <Route path="/datenschutz" element={<Datenschutz />} />
            <Route path="/impressum" element={<Impressum />} />
            <Route
              path="/editor"
              element={
                <RequireAuth>
                  <Editor />
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <Library />
                </RequireAuth>
              }
            />
            {/* Marketplace ist oeffentlich browsebar (SEO + ohne Konto
                stoebern). Aktionen wie Anwenden/Forken/Melden gaten selbst
                via Login-Redirect. */}
            <Route path="/marketplace" element={<Marketplace />} />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Account />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <Admin />
                </RequireAdmin>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ContentWrapper>
      </BrowserRouter>
    </AuthProvider>
  );
}

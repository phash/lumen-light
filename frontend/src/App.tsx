import { AuthProvider } from "react-oidc-context";
import { BrowserRouter, Route, Routes } from "react-router-dom";

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
import Register from "./pages/Register";

export default function App() {
  return (
    <AuthProvider {...oidcConfig}>
      <BrowserRouter>
        <MatomoRouteTracker />
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<Landing />} />
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
            <Route
              path="/marketplace"
              element={
                <RequireAuth>
                  <Marketplace />
                </RequireAuth>
              }
            />
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
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}

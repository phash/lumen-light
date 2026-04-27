/**
 * OIDC-Konfiguration fuer den AuthProvider.
 * Liest VITE_*-Env-Vars zur Build-Zeit. Production-Run-Time-Config
 * folgt in Iteration 7.
 */
import type { AuthProviderProps } from "react-oidc-context";
import { WebStorageStateStore } from "oidc-client-ts";

const authority = import.meta.env.VITE_KEYCLOAK_AUTHORITY;
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

if (!authority || !clientId) {
  throw new Error(
    "VITE_KEYCLOAK_AUTHORITY und VITE_KEYCLOAK_CLIENT_ID muessen gesetzt sein " +
      "(siehe frontend/.env.example).",
  );
}

export const oidcConfig: AuthProviderProps = {
  authority,
  client_id: clientId,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  scope: "openid profile email",
  // sessionStorage statt localStorage: Refresh-Token ist nur fuer den
  // aktuellen Tab gueltig — minimiert Token-Leak-Window beim Browser-Crash.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  // Nach erfolgreichem Code-Tausch History-State aufraeumen, kein /callback
  // im Browser-URL stehenlassen.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

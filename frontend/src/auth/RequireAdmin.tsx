import type { ReactNode } from "react";
import { useAuth } from "react-oidc-context";
import { Navigate, useLocation } from "react-router-dom";

import { useIsAdmin } from "./useIsAdmin";

interface Props {
  children: ReactNode;
}

/**
 * Schuetzt Admin-Routen. Nicht eingeloggt → /login. Eingeloggt aber
 * keine `admin`-Realm-Rolle → /editor (mit Hinweis im UI über die
 * fehlenden Rechte koennten wir spaeter erweitern; vorerst stille
 * Umleitung, weil ein 403-Banner den Editor-Workflow stoeren wuerde).
 */
export default function RequireAdmin({ children }: Props) {
  const auth = useAuth();
  const location = useLocation();
  const isAdmin = useIsAdmin();

  if (auth.isLoading) {
    return (
      <div data-testid="auth-loading" className="p-8 text-stone-400">
        Authentifizierung läuft …
      </div>
    );
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/editor" replace />;
  }
  return <>{children}</>;
}

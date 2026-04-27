import type { ReactNode } from "react";
import { useAuth } from "react-oidc-context";
import { Navigate, useLocation } from "react-router-dom";

interface Props {
  children: ReactNode;
}

export default function RequireAuth({ children }: Props) {
  const auth = useAuth();
  const location = useLocation();

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

  return <>{children}</>;
}

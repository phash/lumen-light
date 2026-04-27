import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import { useNavigate } from "react-router-dom";

/**
 * Landing-Page nach OIDC-Code-Eintausch. react-oidc-context verarbeitet
 * den ?code-Parameter automatisch beim Mount; wir warten und navigieren
 * dann zur Landing- bzw. Editor-Page.
 */
export default function Callback() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) {
      void navigate("/editor", { replace: true });
    } else if (!auth.isLoading && auth.error) {
      void navigate("/login", { replace: true });
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.error, navigate]);

  return (
    <div data-testid="page-callback" className="p-8 text-stone-400">
      Anmeldung wird abgeschlossen …
    </div>
  );
}

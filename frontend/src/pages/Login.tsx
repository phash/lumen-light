import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import { useLocation, useNavigate } from "react-router-dom";

interface LocationState {
  from?: { pathname: string };
}

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = location.state as LocationState | null;

  useEffect(() => {
    if (auth.isAuthenticated) {
      const target = fromState?.from?.pathname ?? "/editor";
      void navigate(target, { replace: true });
    }
  }, [auth.isAuthenticated, fromState, navigate]);

  const onLogin = () => {
    void auth.signinRedirect();
  };

  return (
    <section data-testid="page-login" className="p-8">
      <h1 className="text-3xl">Anmelden</h1>
      <p className="mt-2 text-stone-400">
        Lumen nutzt Keycloak (Realm <code className="text-amber-200">lumen</code>) für
        Single-Sign-On. Klick auf „Mit Keycloak anmelden&ldquo; leitet dich zum
        Keycloak-Login weiter und nach erfolgreicher Anmeldung zurück.
      </p>
      <button
        type="button"
        onClick={onLogin}
        className="mt-4 border border-stone-700 px-4 py-2 hover:border-amber-300/50 hover:text-amber-200"
      >
        Mit Keycloak anmelden
      </button>
    </section>
  );
}

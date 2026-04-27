import { useAuth } from "react-oidc-context";

export default function Register() {
  const auth = useAuth();

  const onRegister = () => {
    void auth.signinRedirect({
      // Keycloak-spezifisches Argument: erzwingt den Registration-Screen.
      extraQueryParams: { kc_action: "register" },
    });
  };

  return (
    <section data-testid="page-register" className="p-8">
      <h1 className="text-3xl">Registrieren</h1>
      <p className="mt-2 text-stone-400">
        Account-Anlage läuft über Keycloak. Klick auf „Account erstellen&ldquo; zeigt
        das Keycloak-Registrierungsformular.
      </p>
      <button
        type="button"
        onClick={onRegister}
        className="mt-4 border border-stone-700 px-4 py-2 hover:border-amber-300/50 hover:text-amber-200"
      >
        Account erstellen
      </button>
    </section>
  );
}

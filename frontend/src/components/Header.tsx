import { useAuth } from "react-oidc-context";
import { NavLink } from "react-router-dom";

const links: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Start" },
  { to: "/editor", label: "Editor" },
  { to: "/library", label: "Bibliothek" },
  { to: "/marketplace", label: "Marketplace" },
  { to: "/account", label: "Account" },
];

export default function Header() {
  const auth = useAuth();

  const onLogin = () => {
    void auth.signinRedirect();
  };

  const onLogout = () => {
    void auth.signoutRedirect();
  };

  return (
    <header className="border-b border-stone-800 px-6 py-3">
      <nav
        aria-label="Hauptnavigation"
        className="flex items-center justify-between gap-4"
      >
        <div className="flex gap-4">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                isActive
                  ? "text-amber-200"
                  : "text-stone-400 hover:text-stone-200"
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {auth.isAuthenticated ? (
            <>
              <span data-testid="auth-email" className="text-stone-300">
                {auth.user?.profile.email ?? auth.user?.profile.preferred_username}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="text-stone-400 hover:text-amber-200"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onLogin}
              data-testid="auth-login-button"
              className="text-stone-400 hover:text-amber-200"
            >
              Login
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}

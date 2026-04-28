import { useState } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const onLogin = () => {
    void auth.signinRedirect();
  };

  const onLogout = () => {
    void auth.signoutRedirect();
  };

  return (
    <header className="border-b border-stone-800 px-4 py-3 sm:px-6">
      <nav
        aria-label="Hauptnavigation"
        className="flex items-center justify-between gap-4"
      >
        {/* Desktop-Links */}
        <div className="hidden sm:flex gap-4">
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

        {/* Mobile-Burger */}
        <button
          type="button"
          aria-label="Menü öffnen"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((v) => !v)}
          data-testid="header-burger"
          className="sm:hidden text-stone-300 hover:text-amber-200"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {mobileOpen ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </>
            ) : (
              <>
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </>
            )}
          </svg>
        </button>

        <div className="flex items-center gap-3 text-sm">
          {auth.isAuthenticated ? (
            <>
              <span
                data-testid="auth-email"
                className="hidden sm:inline text-stone-300"
              >
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

      {/* Mobile-Drawer */}
      {mobileOpen && (
        <div
          id="mobile-nav"
          data-testid="header-mobile-nav"
          className="sm:hidden mt-3 flex flex-col gap-2 border-t border-stone-800 pt-3"
        >
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `py-1.5 ${
                  isActive
                    ? "text-amber-200"
                    : "text-stone-400 hover:text-stone-200"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  );
}

import { NavLink } from "react-router-dom";

const links: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Start" },
  { to: "/login", label: "Login" },
  { to: "/register", label: "Registrieren" },
  { to: "/editor", label: "Editor" },
  { to: "/account", label: "Account" },
];

export default function Header() {
  return (
    <header className="border-b border-stone-800 px-6 py-3">
      <nav aria-label="Hauptnavigation" className="flex gap-4">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              isActive ? "text-amber-200" : "text-stone-400 hover:text-stone-200"
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

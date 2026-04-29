/**
 * Liest die Realm-Rolle `admin` aus dem OIDC-Profile-Token.
 * Keycloak liefert Realm-Roles unter `realm_access.roles` und Client-
 * Roles unter `resource_access.<client>.roles`. Wir akzeptieren beide,
 * damit die Backend-Pruefung (current_admin) und der Frontend-Gating
 * dieselben Treffer haben.
 */
import { useAuth } from "react-oidc-context";

interface RealmAccess {
  roles?: string[];
}

interface ResourceAccessEntry {
  roles?: string[];
}

interface ProfileWithRoles {
  realm_access?: RealmAccess;
  resource_access?: Record<string, ResourceAccessEntry>;
}

export function useIsAdmin(): boolean {
  const auth = useAuth();
  if (!auth.isAuthenticated) return false;
  const profile = auth.user?.profile as ProfileWithRoles | undefined;
  if (!profile) return false;
  const realmRoles = profile.realm_access?.roles ?? [];
  if (realmRoles.includes("admin")) return true;
  const clientMap = profile.resource_access ?? {};
  for (const entry of Object.values(clientMap)) {
    if ((entry.roles ?? []).includes("admin")) return true;
  }
  return false;
}

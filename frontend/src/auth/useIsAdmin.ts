/**
 * Liest die Realm-Rolle `admin` aus dem OIDC-Token.
 * Keycloak liefert Realm-Roles unter `realm_access.roles` und Client-
 * Roles unter `resource_access.<client>.roles` — und zwar im
 * ACCESS-TOKEN, nicht im ID-Token. `auth.user.profile` ist das
 * ID-Token; wir muessen also den Access-Token zusaetzlich dekodieren.
 *
 * Wir akzeptieren beide Quellen (Profile-Fallback fuer den Fall, dass
 * KC die Roles ueber einen Mapper auch ins ID-Token schreibt).
 */
import { useMemo } from "react";
import { useAuth } from "react-oidc-context";

interface RealmAccess {
  roles?: string[];
}

interface ResourceAccessEntry {
  roles?: string[];
}

interface TokenClaims {
  realm_access?: RealmAccess;
  resource_access?: Record<string, ResourceAccessEntry>;
}

function decodeJwtPayload(token: string | undefined): TokenClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    // Base64url -> base64 -> UTF-8 string -> JSON. Browser liefert
    // `atob` fuer base64; padding ergaenzen wir, falls noetig.
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    return JSON.parse(json) as TokenClaims;
  } catch {
    return null;
  }
}

function hasAdminRole(claims: TokenClaims | null | undefined): boolean {
  if (!claims) return false;
  if ((claims.realm_access?.roles ?? []).includes("admin")) return true;
  for (const entry of Object.values(claims.resource_access ?? {})) {
    if ((entry.roles ?? []).includes("admin")) return true;
  }
  return false;
}

export function useIsAdmin(): boolean {
  const auth = useAuth();
  const accessToken = auth.user?.access_token;
  const profile = auth.user?.profile as TokenClaims | undefined;

  return useMemo(() => {
    if (!auth.isAuthenticated) return false;
    if (hasAdminRole(profile)) return true;
    return hasAdminRole(decodeJwtPayload(accessToken));
  }, [auth.isAuthenticated, accessToken, profile]);
}

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { AuthContext } from "react-oidc-context";

import { useIsAdmin } from "../src/auth/useIsAdmin";

import { makeFakeAuth, makeFakeUser } from "./test-utils";

function withAuth(profileExtras: Record<string, unknown>, isAuthenticated = true) {
  const auth = makeFakeAuth({
    isAuthenticated,
    user: isAuthenticated
      ? makeFakeUser({
          profile: { sub: "s", email: "x@y", ...profileExtras } as never,
        })
      : null,
  });
  function AuthWrapper({ children }: { children: React.ReactNode }) {
    return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
  }
  return AuthWrapper;
}

describe("useIsAdmin", () => {
  it("liefert false wenn nicht eingeloggt", () => {
    const { result } = renderHook(() => useIsAdmin(), {
      wrapper: withAuth({}, false),
    });
    expect(result.current).toBe(false);
  });

  it("liefert false ohne admin-Role", () => {
    const { result } = renderHook(() => useIsAdmin(), {
      wrapper: withAuth({ realm_access: { roles: ["user"] } }),
    });
    expect(result.current).toBe(false);
  });

  it("liefert true bei realm_access.roles=admin", () => {
    const { result } = renderHook(() => useIsAdmin(), {
      wrapper: withAuth({ realm_access: { roles: ["admin", "user"] } }),
    });
    expect(result.current).toBe(true);
  });

  it("liefert true bei resource_access.<client>.roles=admin", () => {
    const { result } = renderHook(() => useIsAdmin(), {
      wrapper: withAuth({
        resource_access: { "lumen-frontend": { roles: ["admin"] } },
      }),
    });
    expect(result.current).toBe(true);
  });
});

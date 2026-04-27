import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { AuthContext, type AuthContextProps } from "react-oidc-context";
import type { User } from "oidc-client-ts";

/**
 * Liefert einen kompletten AuthContextProps-Wert mit Defaults und allen
 * Methoden als vi.fn(). Override-Felder gewinnen.
 */
export function makeFakeAuth(
  overrides: Partial<AuthContextProps> = {},
): AuthContextProps {
  const defaults: AuthContextProps = {
    isAuthenticated: false,
    isLoading: false,
    user: null as User | null,
    activeNavigator: undefined,
    error: undefined,
    settings: {} as AuthContextProps["settings"],
    events: {} as AuthContextProps["events"],
    clearStaleState: vi.fn(),
    removeUser: vi.fn(),
    signinPopup: vi.fn(),
    signinSilent: vi.fn(),
    signinRedirect: vi.fn(),
    signinResourceOwnerCredentials: vi.fn(),
    signoutPopup: vi.fn(),
    signoutRedirect: vi.fn(),
    signoutSilent: vi.fn(),
    querySessionStatus: vi.fn(),
    revokeTokens: vi.fn(),
    startSilentRenew: vi.fn(),
    stopSilentRenew: vi.fn(),
  };
  return { ...defaults, ...overrides };
}

export function makeFakeUser(overrides: Partial<User> = {}): User {
  return {
    access_token: "test-access-token",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    profile: {
      sub: "test-sub",
      email: "test@example.com",
      preferred_username: "test@example.com",
    },
    state: undefined,
    refresh_token: undefined,
    token_type: "Bearer",
    scope: "openid profile email",
    session_state: null,
    expired: false,
    expires_in: 600,
    scopes: ["openid", "profile", "email"],
    toStorageString: () => "{}",
    ...overrides,
  } as User;
}

interface WrapOptions {
  auth?: AuthContextProps;
  wrapper?: (children: ReactNode) => ReactElement;
}

export function renderWithAuth(
  ui: ReactElement,
  { auth, wrapper }: WrapOptions = {},
) {
  const value = auth ?? makeFakeAuth();
  const inner = (
    <AuthContext.Provider value={value}>{ui}</AuthContext.Provider>
  );
  return render(wrapper ? wrapper(inner) : inner);
}

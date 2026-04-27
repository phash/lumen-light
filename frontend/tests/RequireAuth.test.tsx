import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { screen } from "@testing-library/react";

import RequireAuth from "../src/auth/RequireAuth";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

function ProtectedPage() {
  return <div data-testid="protected">Geschuetzt</div>;
}

function LoginPage() {
  return <div data-testid="login-page">Login</div>;
}

function withRoutes(initialPath: string) {
  const Wrapper = (children: React.ReactNode) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/protected"
          element={children as React.ReactElement}
        />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>
  );
  return Wrapper;
}

describe("RequireAuth", () => {
  it("redirected zur Login-Page wenn ausgeloggt", () => {
    renderWithAuth(
      <RequireAuth>
        <ProtectedPage />
      </RequireAuth>,
      {
        auth: makeFakeAuth({ isAuthenticated: false, isLoading: false }),
        wrapper: withRoutes("/protected"),
      },
    );
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("rendert Children wenn eingeloggt", () => {
    renderWithAuth(
      <RequireAuth>
        <ProtectedPage />
      </RequireAuth>,
      {
        auth: makeFakeAuth({
          isAuthenticated: true,
          isLoading: false,
          user: makeFakeUser(),
        }),
        wrapper: withRoutes("/protected"),
      },
    );
    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });

  it("zeigt Loader waehrend isLoading", () => {
    renderWithAuth(
      <RequireAuth>
        <ProtectedPage />
      </RequireAuth>,
      {
        auth: makeFakeAuth({ isLoading: true }),
        wrapper: withRoutes("/protected"),
      },
    );
    expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });
});

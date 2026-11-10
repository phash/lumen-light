import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import RequireAdmin from "../src/auth/RequireAdmin";
import * as useIsAdminModule from "../src/auth/useIsAdmin";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

function renderAt(auth: ReturnType<typeof makeFakeAuth>) {
  return renderWithAuth(
    <Routes>
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <div data-testid="admin-content">Admin</div>
          </RequireAdmin>
        }
      />
      <Route path="/editor" element={<div data-testid="editor-page" />} />
      <Route path="/login" element={<div data-testid="login-page" />} />
    </Routes>,
    {
      auth,
      wrapper: (c) => <MemoryRouter initialEntries={["/admin"]}>{c}</MemoryRouter>,
    },
  );
}

describe("RequireAdmin", () => {
  afterEach(() => vi.restoreAllMocks());

  it("zeigt Lade-Zustand waehrend Auth laedt", () => {
    vi.spyOn(useIsAdminModule, "useIsAdmin").mockReturnValue(false);
    renderAt(makeFakeAuth({ isLoading: true }));
    expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
  });

  it("leitet ausgeloggte Nutzer zum Login", () => {
    vi.spyOn(useIsAdminModule, "useIsAdmin").mockReturnValue(false);
    renderAt(makeFakeAuth({ isAuthenticated: false }));
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("leitet Nicht-Admins in den Editor um", () => {
    vi.spyOn(useIsAdminModule, "useIsAdmin").mockReturnValue(false);
    renderAt(makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }));
    expect(screen.getByTestId("editor-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
  });

  it("rendert den Inhalt fuer Admins", () => {
    vi.spyOn(useIsAdminModule, "useIsAdmin").mockReturnValue(true);
    renderAt(makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }));
    expect(screen.getByTestId("admin-content")).toBeInTheDocument();
  });
});

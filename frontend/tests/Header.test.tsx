import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "../src/components/Header";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

describe("Header", () => {
  it("zeigt einen Login-Button wenn nicht eingeloggt", () => {
    renderWithAuth(<Header />, {
      auth: makeFakeAuth({ isAuthenticated: false }),
      wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
    });
    expect(screen.getByTestId("auth-login-button")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-email")).not.toBeInTheDocument();
  });

  it("zeigt Email + Logout wenn eingeloggt", () => {
    renderWithAuth(<Header />, {
      auth: makeFakeAuth({
        isAuthenticated: true,
        user: makeFakeUser({ profile: { sub: "s", email: "alice@example.com" } as never }),
      }),
      wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
    });
    expect(screen.getByTestId("auth-email").textContent).toBe("alice@example.com");
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(screen.queryByTestId("auth-login-button")).not.toBeInTheDocument();
  });

  it("Klick auf Login triggert signinRedirect", async () => {
    const signin = vi.fn();
    const fakeAuth = makeFakeAuth({
      isAuthenticated: false,
      signinRedirect: signin,
    });
    renderWithAuth(<Header />, {
      auth: fakeAuth,
      wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
    });
    await userEvent.click(screen.getByTestId("auth-login-button"));
    expect(signin).toHaveBeenCalledTimes(1);
  });
});

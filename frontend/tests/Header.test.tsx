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

  it("Logout leert den Offline-Cache vor signoutRedirect", async () => {
    const order: string[] = [];
    vi.stubGlobal("caches", {
      keys: vi.fn(() => Promise.resolve(["lumen-v2-runtime"])),
      delete: vi.fn(() => {
        order.push("cache");
        return Promise.resolve(true);
      }),
    });
    const signout = vi.fn(() => {
      order.push("signout");
      return Promise.resolve();
    });
    renderWithAuth(<Header />, {
      auth: makeFakeAuth({
        isAuthenticated: true,
        user: makeFakeUser({ profile: { sub: "s", email: "a@example.com" } as never }),
        signoutRedirect: signout,
      }),
      wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
    });
    await userEvent.click(screen.getByRole("button", { name: "Logout" }));
    await vi.waitFor(() => expect(signout).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["cache", "signout"]);
    vi.unstubAllGlobals();
  });

  function renderAt(path: string, isAuthenticated = false) {
    return renderWithAuth(<Header />, {
      auth: makeFakeAuth({
        isAuthenticated,
        user: isAuthenticated
          ? makeFakeUser({ profile: { sub: "s", email: "a@example.com" } as never })
          : null,
      }),
      wrapper: (c) => <MemoryRouter initialEntries={[path]}>{c}</MemoryRouter>,
    });
  }

  function langLinks() {
    const group = screen.getByTestId("lang-switch");
    const [de, en] = Array.from(group.querySelectorAll("a"));
    if (!de || !en) throw new Error("Sprachlinks fehlen");
    return { de, en };
  }

  it("/en markiert EN als aktuelle Sprache", () => {
    renderAt("/en");
    const { de, en } = langLinks();
    expect(en).toHaveAttribute("aria-current", "true");
    expect(de).not.toHaveAttribute("aria-current");
  });

  it("/ markiert DE als aktuelle Sprache", () => {
    renderAt("/");
    const { de, en } = langLinks();
    expect(de).toHaveAttribute("aria-current", "true");
    expect(en).not.toHaveAttribute("aria-current");
  });

  it("/entwurf bleibt deutsch", () => {
    renderAt("/entwurf");
    expect(langLinks().de).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Bibliothek" })).toBeInTheDocument();
  });

  it("Sprachlinks: sichtbarer Text ist Teil des zugaenglichen Namens", () => {
    renderAt("/");
    const { de, en } = langLinks();
    expect(de).not.toHaveAttribute("aria-label");
    expect(de).toHaveAccessibleName(/^DE ?\(Deutsch\)$/);
    expect(en).toHaveAccessibleName(/^EN ?\(English\)$/);
  });

  it("Mobile-Menue oeffnet und schliesst, Links sind erreichbar", async () => {
    renderAt("/", true);
    const burger = screen.getByTestId("header-burger");
    expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("header-mobile-nav")).not.toBeInTheDocument();
    await userEvent.click(burger);
    expect(burger).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByTestId("header-mobile-nav");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/", "/editor", "/library", "/marketplace", "/account"]),
    );
    expect(screen.getByTestId("header-mobile-logout")).toBeInTheDocument();
    await userEvent.click(burger);
    expect(screen.queryByTestId("header-mobile-nav")).not.toBeInTheDocument();
  });

  it("Klick auf einen Link im Mobile-Menue schliesst es", async () => {
    renderAt("/");
    await userEvent.click(screen.getByTestId("header-burger"));
    const nav = screen.getByTestId("header-mobile-nav");
    const editorLink = Array.from(nav.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/editor",
    );
    if (!editorLink) throw new Error("Editor-Link fehlt");
    await userEvent.click(editorLink);
    expect(screen.queryByTestId("header-mobile-nav")).not.toBeInTheDocument();
  });
});

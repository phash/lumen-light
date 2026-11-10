import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthContextProps } from "react-oidc-context";

import App from "../src/App";
import Header from "../src/components/Header";
import Landing from "../src/pages/Landing";
import Login from "../src/pages/Login";
import Register from "../src/pages/Register";
import Editor from "../src/pages/Editor";
import Account from "../src/pages/Account";
import { makeFakeAuth, renderWithAuth } from "./test-utils";

// Echter AuthProvider wuerde Keycloak-Discovery anstossen — fuer den
// App-Test reicht ein ausgeloggter Fake-Context.
vi.mock("react-oidc-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-oidc-context")>();
  const fake = {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    signinRedirect: () => Promise.resolve(),
  } as unknown as AuthContextProps;
  return {
    ...actual,
    AuthProvider: ({ children }: { children?: ReactNode }) => (
      <actual.AuthContext.Provider value={fake}>{children}</actual.AuthContext.Provider>
    ),
  };
});

function renderRoutes(initialPath: string) {
  return renderWithAuth(
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </>,
    {
      auth: makeFakeAuth({ isAuthenticated: false }),
      wrapper: (children) => (
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      ),
    },
  );
}

describe("App routing skeleton", () => {
  it("renders Landing on root path", () => {
    renderRoutes("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();
  });

  it("renders Login on /login", () => {
    renderRoutes("/login");
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("renders Register on /register", () => {
    renderRoutes("/register");
    expect(screen.getByTestId("page-register")).toBeInTheDocument();
  });

  it("renders Editor on /editor", () => {
    renderRoutes("/editor");
    expect(screen.getByTestId("page-editor")).toBeInTheDocument();
  });

  it("renders Account on /account", () => {
    renderRoutes("/account");
    expect(screen.getByTestId("page-account")).toBeInTheDocument();
  });

  it("navigates to login when header link is clicked", async () => {
    renderRoutes("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Editor" }));
    expect(screen.getByTestId("page-editor")).toBeInTheDocument();
  });
});

describe("App (echt)", () => {
  it("unbekannte Route zeigt NotFound und setzt den Seitentitel", async () => {
    window.history.pushState({}, "", "/does-not-exist");
    render(<App />);
    expect(await screen.findByTestId("page-not-found")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toContain("Seite nicht gefunden"));
    expect(document.documentElement.lang).toBe("de");
    window.history.pushState({}, "", "/");
  });

  it("unbekannte Route unter /en/ ist englisch und verlinkt auf /en", async () => {
    window.history.pushState({}, "", "/en/nope");
    render(<App />);
    expect(await screen.findByTestId("page-not-found")).toHaveTextContent("Page not found");
    expect(screen.getByTestId("not-found-home")).toHaveAttribute("href", "/en");
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    window.history.pushState({}, "", "/");
  });
});

import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "../src/components/Header";
import Landing from "../src/pages/Landing";
import Login from "../src/pages/Login";
import Register from "../src/pages/Register";
import Editor from "../src/pages/Editor";
import Account from "../src/pages/Account";
import { makeFakeAuth, renderWithAuth } from "./test-utils";

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

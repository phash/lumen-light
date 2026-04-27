import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "../src/components/Header";
import Landing from "../src/pages/Landing";
import Login from "../src/pages/Login";
import Register from "../src/pages/Register";
import Editor from "../src/pages/Editor";
import Account from "../src/pages/Account";

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Header />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("App routing skeleton", () => {
  it("renders Landing on root path", () => {
    renderWithRouter("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();
  });

  it("renders Login on /login", () => {
    renderWithRouter("/login");
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("renders Register on /register", () => {
    renderWithRouter("/register");
    expect(screen.getByTestId("page-register")).toBeInTheDocument();
  });

  it("renders Editor on /editor", () => {
    renderWithRouter("/editor");
    expect(screen.getByTestId("page-editor")).toBeInTheDocument();
  });

  it("renders Account on /account", () => {
    renderWithRouter("/account");
    expect(screen.getByTestId("page-account")).toBeInTheDocument();
  });

  it("navigates to login when header link is clicked", async () => {
    const user = userEvent.setup();
    renderWithRouter("/");
    expect(screen.getByTestId("page-landing")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Login" }));
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });
});

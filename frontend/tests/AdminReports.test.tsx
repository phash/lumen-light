import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, type Mock } from "vitest";

import * as useApiModule from "../src/api/use-api";
import type { AdminReportedPreset, ApiClient } from "../src/api/client";
import Admin from "../src/pages/Admin";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

type FakeApi = Pick<
  ApiClient,
  "adminStats" | "adminListUsers" | "adminListReportedPresets" | "adminClearPresetReports" | "adminPatchUser"
> & {
  adminStats: Mock;
  adminListUsers: Mock;
  adminListReportedPresets: Mock;
  adminClearPresetReports: Mock;
  adminPatchUser: Mock;
};

const reported: AdminReportedPreset = {
  id: "p-1",
  name: "Spam-Look",
  description: "kauf jetzt",
  genre: null,
  visibility: "private",
  reportCount: 3,
  ownerId: "u-9",
  ownerEmail: "creator@example.com",
  ownerIsDisabled: false,
  updatedAt: "2026-10-26T10:00:00Z",
  reports: [{ reason: "Werbung", createdAt: "2026-10-26T09:00:00Z" }],
};

function makeFakeApi(): FakeApi {
  return {
    adminStats: vi.fn().mockResolvedValue({
      userCount: 1,
      userDisabledCount: 0,
      presetCount: 1,
      presetPublishedCount: 0,
      imageCount: 0,
      feedbackOpenCount: 0,
      reportOpenCount: 3,
    }),
    adminListUsers: vi.fn().mockResolvedValue([]),
    adminListReportedPresets: vi.fn().mockResolvedValue([reported]),
    adminClearPresetReports: vi.fn().mockResolvedValue({}),
    adminPatchUser: vi.fn().mockResolvedValue({ id: "u-9", isDisabled: true }),
  };
}

function render(api: FakeApi) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api as unknown as ApiClient);
  return renderWithAuth(<Admin />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Admin Meldungen-Tab", () => {
  it("zeigt gemeldete Presets mit Gruenden und Creator", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    const item = await screen.findByTestId("admin-report-item-p-1");
    expect(item).toHaveTextContent("Spam-Look");
    expect(item).toHaveTextContent("creator@example.com");
    expect(item).toHaveTextContent("Werbung");
    expect(screen.getByTestId("admin-report-count-p-1")).toHaveTextContent("3 Meldungen");
  });

  it("Meldungen verwerfen entfernt den Eintrag", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    await userEvent.click(await screen.findByTestId("admin-report-clear-p-1"));
    expect(api.adminClearPresetReports).toHaveBeenCalledWith("p-1");
    await waitFor(() =>
      expect(screen.queryByTestId("admin-report-item-p-1")).not.toBeInTheDocument(),
    );
  });

  it("Creator sperren ruft adminPatchUser und zeigt Entsperren", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    await userEvent.click(await screen.findByTestId("admin-report-owner-toggle-p-1"));
    // Zweistufig: erst die Rueckfrage bestaetigen.
    expect(api.adminPatchUser).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("admin-report-owner-confirm-p-1"));
    expect(api.adminPatchUser).toHaveBeenCalledWith("u-9", true);
    await waitFor(() =>
      expect(screen.getByTestId("admin-report-owner-toggle-p-1")).toHaveTextContent(
        "Creator entsperren",
      ),
    );
  });

  it("leere Liste zeigt Hinweis", async () => {
    const api = makeFakeApi();
    api.adminListReportedPresets.mockResolvedValue([]);
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    expect(await screen.findByTestId("admin-reports-empty")).toBeInTheDocument();
  });
});

describe("Admin Fokus und Bestaetigungen", () => {
  it("Verwerfen des letzten Eintrags fokussiert das Tab-Panel", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    await userEvent.click(await screen.findByTestId("admin-report-clear-p-1"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("admin-tabpanel")),
    );
  });

  it("Creator-Sperre: Frage als Text, Verb als Button, Fokus zurueck auf den Toggle", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(screen.getByTestId("admin-tab-reports"));
    await userEvent.click(await screen.findByTestId("admin-report-owner-toggle-p-1"));
    expect(screen.getByText("Creator sperren?")).toBeInTheDocument();
    const confirm = screen.getByTestId("admin-report-owner-confirm-p-1");
    expect(confirm).toHaveTextContent(/^Sperren$/);
    expect(confirm).toHaveAccessibleName("creator@example.com sperren");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("admin-report-owner-toggle-p-1"),
      ),
    );
  });

  it("Nutzer sperren: Tabelle hat Caption, Region und benannte Buttons", async () => {
    const api = makeFakeApi();
    api.adminListUsers.mockResolvedValue([USER]);
    api.adminPatchUser.mockResolvedValue({ ...USER, isDisabled: true });
    render(api);
    const toggle = await screen.findByTestId("admin-user-toggle-u-1");
    expect(toggle).toHaveAccessibleName("anna@example.com sperren");
    expect(screen.getByRole("region", { name: "Nutzertabelle" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("table")).toHaveAccessibleName(/Registrierte Nutzer/);
    await userEvent.click(toggle);
    const confirm = screen.getByTestId("admin-user-toggle-confirm-u-1");
    expect(confirm).toHaveTextContent(/^Sperren$/);
    await userEvent.click(confirm);
    expect(api.adminPatchUser).toHaveBeenCalledWith("u-1", true);
    await waitFor(() =>
      expect(screen.getByTestId("admin-user-toggle-u-1")).toHaveTextContent(
        "Gesperrt — Aktivieren",
      ),
    );
    expect(document.activeElement).toBe(screen.getByTestId("admin-user-toggle-u-1"));
  });
});

const USER = {
  id: "u-1",
  email: "anna@example.com",
  handle: null,
  isDisabled: false,
  presetCount: 0,
  publishedPresetCount: 0,
  imageCount: 0,
  feedbackCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
};

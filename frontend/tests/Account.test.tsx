import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, type Mock } from "vitest";

import * as useApiModule from "../src/api/use-api";
import {
  ApiError,
  type ApiClient,
  type Preset,
  type Profile,
} from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import Account from "../src/pages/Account";
import * as clearCachesModule from "../src/auth/clearCaches";
import {
  getSingleKeyShortcutsEnabled,
  setSingleKeyShortcutsEnabled,
} from "../src/editor/shortcutPrefs";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  me: Mock;
  getProfile: Mock;
  updateProfile: Mock;
  listPublishedPresets: Mock;
  updatePreset: Mock;
  deleteMe: Mock;
  exportMe: Mock;
}

function makeFakeApi(): FakeApi {
  return {
    me: vi.fn().mockResolvedValue({
      id: "u-1",
      email: "manuel@example.com",
      createdAt: "x",
    }),
    deleteMe: vi.fn(),
    exportMe: vi.fn(),
    listPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    listImages: vi.fn(),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn(),
    getImageEdit: vi.fn(),
    putImageEdit: vi.fn(),
    putImageThumbnail: vi.fn(),
    updateImage: vi.fn(),
    updateImages: vi.fn(),
    listMarketplacePresets: vi.fn(),
    getMarketplacePreset: vi.fn(),
    applyMarketplacePreset: vi.fn(),
    forkMarketplacePreset: vi.fn(),
    reportMarketplacePreset: vi.fn(),
    getProfile: vi.fn().mockResolvedValue({
      id: "u-1",
      handle: null,
      bio: null,
    } satisfies Profile),
    updateProfile: vi.fn(),
    listPublishedPresets: vi.fn().mockResolvedValue([]),
    submitFeedback: vi.fn(),
    adminListUsers: vi.fn(),
    adminPatchUser: vi.fn(),
    adminStats: vi.fn(),
    adminListFeedback: vi.fn(),
    adminPatchFeedback: vi.fn(),
    adminListReportedPresets: vi.fn(),
    adminClearPresetReports: vi.fn(),
    applyPresetBatch: vi.fn(),
  };
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "p-1",
    name: "Mein Public",
    adjustments: defaultAdjustments(),
    masks: [],
    geometry: null,
    visibility: "public",
    genre: "portrait",
    description: "x",
    previewImageId: "img-1",
    publishedAt: "2026-04-28T00:00:00Z",
    applyCount: 5,
    reportCount: 0,
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

function render(api: FakeApi) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(<Account />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Account", () => {
  it("Toggle schaltet Einzeltasten-Kuerzel ab und wieder an", async () => {
    setSingleKeyShortcutsEnabled(true);
    render(makeFakeApi());
    const toggle = screen.getByRole("checkbox", {
      name: "Einzeltasten-Kürzel aktivieren",
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(getSingleKeyShortcutsEnabled()).toBe(false);
    await userEvent.click(toggle);
    expect(getSingleKeyShortcutsEnabled()).toBe(true);
  });

  it("laedt me + Profil + published-presets beim Mount", async () => {
    const api = makeFakeApi();
    render(api);
    await waitFor(() => {
      expect(api.me).toHaveBeenCalled();
      expect(api.getProfile).toHaveBeenCalled();
      expect(api.listPublishedPresets).toHaveBeenCalled();
    });
    expect(screen.getByText("manuel@example.com")).toBeInTheDocument();
  });

  it("Profil-Felder werden mit Backend-Werten vorbefuellt", async () => {
    const api = makeFakeApi();
    api.getProfile.mockResolvedValue({
      id: "u-1",
      handle: "anna",
      bio: "Photographer",
    });
    render(api);
    const handle = await screen.findByTestId<HTMLInputElement>("account-handle");
    await waitFor(() => expect(handle.value).toBe("anna"));
    const bio = screen.getByTestId<HTMLTextAreaElement>("account-bio");
    expect(bio.value).toBe("Photographer");
  });

  it("Profil-Save sendet handle/bio (leer -> null)", async () => {
    const api = makeFakeApi();
    api.updateProfile.mockResolvedValue({
      id: "u-1",
      handle: "anna",
      bio: null,
    });
    render(api);
    const handle = await screen.findByTestId("account-handle");
    await userEvent.type(handle, "anna");
    await userEvent.click(screen.getByTestId("account-profile-save"));
    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({
        handle: "anna",
        bio: null,
      }),
    );
    expect(
      await screen.findByTestId("account-profile-feedback"),
    ).toHaveTextContent("Gespeichert.");
  });

  it("Profil-Save 409 zeigt 'bereits vergeben'-Hinweis", async () => {
    const api = makeFakeApi();
    api.updateProfile.mockRejectedValue(new ApiError(409, "duplicate"));
    render(api);
    await userEvent.type(await screen.findByTestId("account-handle"), "anna");
    await userEvent.click(screen.getByTestId("account-profile-save"));
    expect(
      await screen.findByTestId("account-profile-feedback"),
    ).toHaveTextContent(/bereits vergeben/);
  });

  it("Ungueltiger Handle wird clientseitig abgefangen (aria-describedby)", async () => {
    const api = makeFakeApi();
    render(api);
    const handle = await screen.findByTestId("account-handle");
    await userEvent.type(handle, "Anna_X");
    await userEvent.tab();
    const err = await screen.findByTestId("account-handle-error");
    expect(err).toHaveTextContent(/3.{1,2}40/);
    expect(handle).toHaveAttribute("aria-describedby", "account-handle-error");
    expect(handle).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(screen.getByTestId("account-profile-save"));
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("Profil-Save 422 zeigt Format-Hinweis", async () => {
    const api = makeFakeApi();
    api.updateProfile.mockRejectedValue(new ApiError(422, "invalid"));
    render(api);
    await userEvent.type(await screen.findByTestId("account-handle"), "anna");
    await userEvent.click(screen.getByTestId("account-profile-save"));
    expect(
      await screen.findByTestId("account-profile-feedback"),
    ).toHaveTextContent(/3.{1,2}40/);
  });

  it("Empty-State wenn keine Public-Presets", async () => {
    const api = makeFakeApi();
    render(api);
    expect(
      await screen.findByText(/keine Presets im Marketplace/),
    ).toBeInTheDocument();
  });

  it("Listet veroeffentlichte Presets mit applyCount", async () => {
    const api = makeFakeApi();
    api.listPublishedPresets.mockResolvedValue([
      makePreset({ id: "a", name: "Look A", applyCount: 12 }),
      makePreset({ id: "b", name: "Look B", applyCount: 0 }),
    ]);
    render(api);
    expect(await screen.findByText("Look A")).toBeInTheDocument();
    expect(screen.getByText("Look B")).toBeInTheDocument();
    expect(screen.getByText(/12 Anwendungen/)).toBeInTheDocument();
  });

  it("Zurueckziehen ruft updatePreset mit visibility=private", async () => {
    const api = makeFakeApi();
    const preset = makePreset({ id: "a", name: "Look A" });
    api.listPublishedPresets.mockResolvedValue([preset]);
    api.updatePreset.mockResolvedValue(preset);
    render(api);
    await userEvent.click(await screen.findByTestId("account-unpublish-a"));
    await waitFor(() =>
      expect(api.updatePreset).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({ visibility: "private", name: "Look A" }),
      ),
    );
    // Eintrag verschwindet aus der Liste.
    await waitFor(() =>
      expect(screen.queryByTestId("account-published-a")).not.toBeInTheDocument(),
    );
  });

  it("zeigt Genre-Label statt Slug bei veroeffentlichten Presets", async () => {
    const api = makeFakeApi();
    api.listPublishedPresets.mockResolvedValue([
      makePreset({ id: "a", genre: "landscape" }),
    ]);
    render(api);
    expect(await screen.findByText(/Landschaft/)).toBeInTheDocument();
  });

  it("Konto loeschen: Bestaetigung -> deleteMe -> signoutRedirect", async () => {
    const api = makeFakeApi();
    api.deleteMe.mockResolvedValue(undefined);
    vi.spyOn(clearCachesModule, "clearOfflineCaches").mockResolvedValue(undefined);
    const signoutRedirect = vi.fn().mockResolvedValue(undefined);
    const auth = makeFakeAuth({
      isAuthenticated: true,
      user: makeFakeUser(),
      signoutRedirect,
    });
    vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
    renderWithAuth(<Account />, {
      auth,
      wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
    });
    await userEvent.click(await screen.findByTestId("account-delete-trigger"));
    expect(api.deleteMe).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("account-delete-confirm");
    // Fokus springt auf die Bestaetigung.
    expect(confirm).toHaveFocus();
    await userEvent.click(confirm);
    await waitFor(() => expect(api.deleteMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signoutRedirect).toHaveBeenCalled());
  });

  it("Abbrechen der Loesch-Bestaetigung gibt den Fokus an den Ausloeser zurueck", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.click(await screen.findByTestId("account-delete-trigger"));
    await userEvent.click(screen.getByTestId("account-delete-cancel"));
    await waitFor(() =>
      expect(screen.getByTestId("account-delete-trigger")).toHaveFocus(),
    );
    expect(api.deleteMe).not.toHaveBeenCalled();
  });

  it("Export laedt JSON als Datei herunter", async () => {
    const api = makeFakeApi();
    api.exportMe.mockResolvedValue({ id: "u-1", presets: [], images: [] });
    const createUrl = vi.fn().mockReturnValue("blob:export");
    const revokeUrl = vi.fn();
    // Property-Deskriptoren sichern statt Methoden-Referenzen (unbound-method).
    const origCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const origRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { value: createUrl, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeUrl, configurable: true, writable: true });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(api);
    await userEvent.click(await screen.findByTestId("account-export"));
    await waitFor(() => expect(api.exportMe).toHaveBeenCalled());
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith("blob:export");
    clickSpy.mockRestore();
    if (origCreate) Object.defineProperty(URL, "createObjectURL", origCreate);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (origRevoke) Object.defineProperty(URL, "revokeObjectURL", origRevoke);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });
});

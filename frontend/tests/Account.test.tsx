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
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  me: Mock;
  getProfile: Mock;
  updateProfile: Mock;
  listPublishedPresets: Mock;
  updatePreset: Mock;
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
  };
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "p-1",
    name: "Mein Public",
    adjustments: defaultAdjustments(),
    masks: [],
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

  it("Profil-Save 422 zeigt Format-Hinweis", async () => {
    const api = makeFakeApi();
    api.updateProfile.mockRejectedValue(new ApiError(422, "invalid"));
    render(api);
    await userEvent.type(await screen.findByTestId("account-handle"), "Anna ");
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
});

import { describe, expect, it, vi, type Mock } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Library from "../src/pages/Library";
import * as useApiModule from "../src/api/use-api";
import type { ApiClient, Image } from "../src/api/client";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listImages: Mock;
  deleteImage: Mock;
}

function makeFakeApi(images: Image[] = []): FakeApi {
  return {
    me: vi.fn(),
    deleteMe: vi.fn(),
    exportMe: vi.fn(),
    listPresets: vi.fn(),
    createPreset: vi.fn(),
    updatePreset: vi.fn(),
    deletePreset: vi.fn(),
    listImages: vi.fn().mockResolvedValue(images),
    initUpload: vi.fn(),
    confirmUpload: vi.fn(),
    getImageUrl: vi.fn(),
    deleteImage: vi.fn().mockResolvedValue(undefined),
    getImageEdit: vi.fn(),
    putImageEdit: vi.fn(),
    listMarketplacePresets: vi.fn(),
    getMarketplacePreset: vi.fn(),
    applyMarketplacePreset: vi.fn(),
    forkMarketplacePreset: vi.fn(),
    reportMarketplacePreset: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    listPublishedPresets: vi.fn(),
    submitFeedback: vi.fn(),
    adminListUsers: vi.fn(),
    adminPatchUser: vi.fn(),
    adminStats: vi.fn(),
    adminListFeedback: vi.fn(),
    adminPatchFeedback: vi.fn(),
    applyPresetBatch: vi.fn(),
  };
}

function renderLibrary(api: FakeApi) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(<Library />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Library", () => {
  it("zeigt Empty-State wenn die Liste leer ist", async () => {
    renderLibrary(makeFakeApi([]));
    await waitFor(() => {
      expect(
        screen.getByText("Noch keine Bilder hochgeladen."),
      ).toBeInTheDocument();
    });
  });

  it("rendert eine Image-Liste", async () => {
    const api = makeFakeApi([
      {
        id: "i-1",
        originalFilename: "first.jpg",
        contentType: "image/jpeg",
        sizeBytes: 4096,
        uploadState: "ready",
        createdAt: "x",
        confirmedAt: "x",
      },
      {
        id: "i-2",
        originalFilename: "second.png",
        contentType: "image/png",
        sizeBytes: 1500000,
        uploadState: "ready",
        createdAt: "x",
        confirmedAt: "x",
      },
    ]);
    renderLibrary(api);
    await waitFor(() => {
      expect(screen.getByTestId("image-row-i-1")).toBeInTheDocument();
      expect(screen.getByTestId("image-row-i-2")).toBeInTheDocument();
    });
    expect(screen.getByText("first.jpg")).toBeInTheDocument();
    expect(screen.getByText("second.png")).toBeInTheDocument();
  });

  it("loescht ein Bild und ruft refresh", async () => {
    const api = makeFakeApi([
      {
        id: "i-99",
        originalFilename: "delete-me.jpg",
        contentType: "image/jpeg",
        sizeBytes: 100,
        uploadState: "ready",
        createdAt: "x",
        confirmedAt: "x",
      },
    ]);
    renderLibrary(api);
    await waitFor(() =>
      expect(screen.getByTestId("image-row-i-99")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(api.deleteImage).toHaveBeenCalledWith("i-99");
    // Mind. 2 listImages-Calls (initial + nach delete)
    expect(api.listImages).toHaveBeenCalledTimes(2);
  });

  it("zeigt Fehlermeldung wenn listImages wirft", async () => {
    const api = makeFakeApi();
    api.listImages.mockRejectedValue(new Error("backend kaputt"));
    renderLibrary(api);
    await waitFor(() =>
      expect(screen.getByTestId("library-error").textContent).toBe(
        "backend kaputt",
      ),
    );
  });
});

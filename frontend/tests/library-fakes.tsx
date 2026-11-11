/**
 * Geteilte Test-Helfer fuer die Bibliothek (H2d): Fake-ApiClient, der
 * Patches zurueckspiegelt, plus Render mit MemoryRouter und Location-Probe.
 */
import { vi, type Mock } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { screen } from "@testing-library/react";

import Library from "../src/pages/Library";
import * as useApiModule from "../src/api/use-api";
import type { ApiClient, Image } from "../src/api/client";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

export interface FakeLibraryApi extends ApiClient {
  listImages: Mock;
  getImageUrl: Mock;
  updateImage: Mock;
  updateImages: Mock;
}

export function makeFakeLibraryApi(images: Image[] = []): FakeLibraryApi {
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
    putImageThumbnail: vi.fn(),
    // Server spiegelt den Patch zurueck.
    updateImage: vi.fn((id: string, patch: object) => {
      const img = images.find((i) => i.id === id);
      return Promise.resolve({ ...img, ...patch });
    }),
    updateImages: vi.fn((ids: string[], patch: object) =>
      Promise.resolve(ids.map((id) => ({ ...images.find((i) => i.id === id), ...patch }))),
    ),
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
    adminListReportedPresets: vi.fn(),
    adminClearPresetReports: vi.fn(),
    applyPresetBatch: vi.fn(),
  };
}

/** Zeigt den aktuellen Query-String, damit Tests die URL pruefen koennen. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

export function renderLibraryAt(api: FakeLibraryApi, url = "/library") {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(<Library />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => (
      <MemoryRouter initialEntries={[url]}>
        {c}
        <LocationProbe />
      </MemoryRouter>
    ),
  });
}

export function locationSearch(): string {
  return screen.getByTestId("location-search").textContent ?? "";
}

export function announced(): string {
  return screen.getByTestId("library-announce").textContent ?? "";
}

export const IMG_A: Image = {
  id: "i-a",
  originalFilename: "a.jpg",
  contentType: "image/jpeg",
  sizeBytes: 100,
  uploadState: "ready",
  createdAt: "x",
  confirmedAt: "x",
  thumbUrl: "https://s3.test/a-400.jpg",
  previewUrl: "https://s3.test/a-1600.jpg",
  rating: 0,
  colorLabel: null,
  flag: "none",
};

export const IMG_RAW: Image = {
  ...IMG_A,
  id: "i-raw",
  originalFilename: "b.nef",
  contentType: "image/x-nikon-nef",
  thumbUrl: "https://s3.test/b-400.jpg",
  previewUrl: "https://s3.test/b-1600.jpg",
};

export const IMG_NOPREVIEW: Image = {
  ...IMG_A,
  id: "i-np",
  originalFilename: "c.png",
  contentType: "image/png",
  thumbUrl: null,
  previewUrl: null,
};

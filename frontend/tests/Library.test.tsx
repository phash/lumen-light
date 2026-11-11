import { describe, expect, it, vi, type Mock } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Library from "../src/pages/Library";
import * as useApiModule from "../src/api/use-api";
import * as uploadModule from "../src/api/upload";
import * as thumbnailModule from "../src/editor/thumbnail";
import type { ApiClient, Image } from "../src/api/client";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listImages: Mock;
  deleteImage: Mock;
  putImageThumbnail: Mock;
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
    putImageThumbnail: vi.fn(),
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
    // Zweistufig: erst „Löschen" (zeigt Confirm), dann bestaetigendes „Löschen".
    await userEvent.click(screen.getByTestId("image-delete-i-99"));
    expect(api.deleteImage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("image-delete-confirm-i-99"));
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

  it("Ladefehler bietet Erneut versuchen an", async () => {
    const api = makeFakeApi();
    api.listImages.mockRejectedValueOnce(new Error("backend kaputt"));
    renderLibrary(api);
    const retry = await screen.findByTestId("library-retry");
    expect(retry).toHaveTextContent("Erneut versuchen");
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByTestId("library-error")).not.toBeInTheDocument());
    expect(api.listImages).toHaveBeenCalledTimes(2);
  });

  it("Bestaetigung zeigt Frage als Text und Verb als Button", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-delete-i-a"));
    expect(screen.getByText("Endgültig löschen?")).toBeInTheDocument();
    expect(screen.getByTestId("image-delete-confirm-i-a")).toHaveTextContent(/^Löschen$/);
  });

  it("nach dem Loeschen landet der Fokus auf der naechsten Zeile", async () => {
    const api = makeFakeApi([IMG_A, IMG_B]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-delete-i-a"));
    api.listImages.mockResolvedValue([IMG_B]);
    await userEvent.click(screen.getByTestId("image-delete-confirm-i-a"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("image-delete-i-b")),
    );
  });

  it("zeigt Vorschaubild links vom Dateinamen, sonst Platzhalter mit Typ", async () => {
    const api = makeFakeApi([
      { ...IMG_A, thumbUrl: "https://s3.test/thumb-a.jpg" },
      { ...IMG_B, id: "i-raw", contentType: "image/x-nikon-nef", thumbUrl: null },
    ]);
    renderLibrary(api);
    const img = await screen.findByTestId("image-thumb-i-a");
    expect(img).toHaveAttribute("src", "https://s3.test/thumb-a.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("alt", "");
    const placeholder = screen.getByTestId("image-thumb-placeholder-i-raw");
    expect(placeholder).toHaveTextContent("RAW");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });

  it("abgelaufene Vorschau-URL faellt auf den Platzhalter zurueck", async () => {
    const api = makeFakeApi([{ ...IMG_A, thumbUrl: "https://s3.test/expired.jpg" }]);
    renderLibrary(api);
    const img = await screen.findByTestId("image-thumb-i-a");
    fireEvent.error(img);
    expect(await screen.findByTestId("image-thumb-placeholder-i-a")).toHaveTextContent("JPG");
  });

  it("nach dem Upload wird das Vorschaubild hochgeladen; Fehler blockieren nicht", async () => {
    const thumb = new Blob([new Uint8Array(3)], { type: "image/jpeg" });
    const thumbSpy = vi.spyOn(thumbnailModule, "thumbnailFromFile").mockResolvedValue(thumb);
    const uploadSpy = vi
      .spyOn(uploadModule, "uploadImage")
      .mockResolvedValue({ ...IMG_A, id: "new-1" });
    const api = makeFakeApi([]);
    api.putImageThumbnail.mockRejectedValue(new Error("429"));
    renderLibrary(api);
    await screen.findByText("Noch keine Bilder hochgeladen.");
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "neu.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByTestId("upload-input"), file);
    await waitFor(() => expect(api.putImageThumbnail).toHaveBeenCalledWith("new-1", thumb));
    await waitFor(() => expect(api.listImages).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("library-error")).not.toBeInTheDocument();
    thumbSpy.mockRestore();
    uploadSpy.mockRestore();
  });

  it("nach dem Loeschen des letzten Bildes landet der Fokus auf der Ueberschrift", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-delete-i-a"));
    api.listImages.mockResolvedValue([]);
    await userEvent.click(screen.getByTestId("image-delete-confirm-i-a"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("library-heading")),
    );
  });
});

const IMG_A = {
  id: "i-a",
  originalFilename: "a.jpg",
  contentType: "image/jpeg",
  sizeBytes: 100,
  uploadState: "ready" as const,
  createdAt: "x",
  confirmedAt: "x",
};
const IMG_B = { ...IMG_A, id: "i-b", originalFilename: "b.jpg" };

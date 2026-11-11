import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Library from "../src/pages/Library";
import * as useApiModule from "../src/api/use-api";
import type { ApiClient, Image } from "../src/api/client";
import { announcePatch, nextGridIndex, ratingText } from "../src/library/meta";
import { getLibraryView, setLibraryView } from "../src/library/viewPrefs";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listImages: Mock;
  deleteImage: Mock;
  updateImage: Mock;
  updateImages: Mock;
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

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => navigateMock };
});

function renderLibrary(api: FakeApi) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(<Library />, {
    auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

const IMG_A: Image = {
  id: "i-a",
  originalFilename: "a.jpg",
  contentType: "image/jpeg",
  sizeBytes: 100,
  uploadState: "ready",
  createdAt: "x",
  confirmedAt: "x",
  thumbUrl: "https://s3.test/a.jpg",
  rating: 0,
  colorLabel: null,
  flag: "none",
};
const IMG_B: Image = { ...IMG_A, id: "i-b", originalFilename: "b.nef", contentType: "image/x-nikon-nef", thumbUrl: null };
const IMG_C: Image = { ...IMG_A, id: "i-c", originalFilename: "c.jpg", rating: 4, colorLabel: "red", flag: "pick" };

function announced(): string {
  return screen.getByTestId("library-announce").textContent ?? "";
}

describe("H2b meta (reine Funktionen)", () => {
  it("Pfeiltasten bewegen im Raster und klemmen an den Raendern", () => {
    // 7 Kacheln, 3 Spalten
    expect(nextGridIndex(0, "ArrowRight", 7, 3)).toBe(1);
    expect(nextGridIndex(0, "ArrowLeft", 7, 3)).toBe(0);
    expect(nextGridIndex(6, "ArrowRight", 7, 3)).toBe(6);
    expect(nextGridIndex(1, "ArrowDown", 7, 3)).toBe(4);
    expect(nextGridIndex(4, "ArrowDown", 7, 3)).toBe(4);
    expect(nextGridIndex(5, "ArrowUp", 7, 3)).toBe(2);
    expect(nextGridIndex(2, "ArrowUp", 7, 3)).toBe(2);
    expect(nextGridIndex(3, "Home", 7, 3)).toBe(0);
    expect(nextGridIndex(3, "End", 7, 3)).toBe(6);
    expect(nextGridIndex(0, "ArrowDown", 0, 3)).toBe(-1);
  });

  it("Ansagen sind deutsch und mit Umlauten", () => {
    expect(ratingText(0)).toBe("Keine Sterne");
    expect(ratingText(1)).toBe("1 Stern");
    expect(announcePatch({ rating: 3 })).toBe("3 Sterne");
    expect(announcePatch({ colorLabel: "red" })).toBe("Label Rot");
    expect(announcePatch({ colorLabel: "green" })).toBe("Label Grün");
    expect(announcePatch({ colorLabel: null })).toBe("Label entfernt");
    expect(announcePatch({ flag: "pick" })).toBe("Als ausgewählt markiert");
    expect(announcePatch({ flag: "reject" })).toBe("Als abgelehnt markiert");
    expect(announcePatch({ flag: "none" })).toBe("Markierung entfernt");
    expect(announcePatch({ rating: 5 }, 2)).toBe("2 Bilder: 5 Sterne");
  });

  it("Ansicht wird im Modul-Cache gemerkt", () => {
    setLibraryView("list");
    expect(getLibraryView()).toBe("list");
    setLibraryView("grid");
    expect(getLibraryView()).toBe("grid");
  });
});

describe("Library Raster (H2b)", () => {
  beforeEach(() => {
    setLibraryView("grid");
    navigateMock.mockReset();
  });

  it("Raster ist Default und zeigt Vorschau, Platzhalter mit Typ und Metadaten", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    await screen.findByTestId("image-grid");
    expect(screen.queryByTestId("image-list")).not.toBeInTheDocument();
    const thumb = screen.getByTestId("image-thumb-i-a");
    expect(thumb).toHaveAttribute("loading", "lazy");
    expect(screen.getByTestId("image-thumb-placeholder-i-b")).toHaveTextContent("RAW");
    const tileC = screen.getByTestId("image-tile-i-c");
    expect(tileC).toHaveAccessibleName("c.jpg, 4 Sterne, Label Rot, Ausgewählt");
    expect(screen.getByTestId("tile-i-c-star-4")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tile-i-c-pick")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tile-i-c-label-bar")).toBeInTheDocument();
    expect(within(tileC).getByText("c.jpg")).toBeInTheDocument();
  });

  it("Umschalter auf Liste wird gemerkt", async () => {
    renderLibrary(makeFakeApi([IMG_A]));
    await userEvent.click(await screen.findByTestId("library-view-list"));
    expect(screen.getByTestId("image-row-i-a")).toBeInTheDocument();
    expect(screen.queryByTestId("image-grid")).not.toBeInTheDocument();
    expect(getLibraryView()).toBe("list");
    expect(screen.getByTestId("library-view-list")).toHaveAttribute("aria-pressed", "true");
  });

  it("Stern setzen aktualisiert optimistisch und sagt an", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("tile-i-a-star-3"));
    expect(api.updateImage).toHaveBeenCalledWith("i-a", { rating: 3 });
    expect(screen.getByTestId("tile-i-a-star-3")).toHaveAttribute("aria-pressed", "true");
    expect(announced()).toBe("3 Sterne");
  });

  it("erneuter Klick auf den aktuellen Stern setzt auf 0", async () => {
    const api = makeFakeApi([IMG_C]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("tile-i-c-star-4"));
    expect(api.updateImage).toHaveBeenCalledWith("i-c", { rating: 0 });
    expect(announced()).toBe("Keine Sterne");
  });

  it("Fehler beim Speichern rollt zurueck und zeigt Meldung", async () => {
    const api = makeFakeApi([IMG_A]);
    api.updateImage.mockRejectedValueOnce(new Error("Serverfehler"));
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("tile-i-a-star-5"));
    await waitFor(() =>
      expect(screen.getByTestId("library-error")).toHaveTextContent(
        "Änderung nicht gespeichert: Serverfehler",
      ),
    );
    expect(screen.getByTestId("tile-i-a-star-5")).toHaveAttribute("aria-pressed", "false");
    expect(announced()).toBe("Änderung nicht gespeichert");
  });

  it("Farblabel und Markierung per Kachel", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("tile-i-a-label"));
    await userEvent.click(screen.getByTestId("tile-i-a-label-red"));
    expect(api.updateImage).toHaveBeenCalledWith("i-a", { colorLabel: "red" });
    expect(announced()).toBe("Label Rot");
    expect(screen.queryByTestId("tile-i-a-label-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("tile-i-a-label")).toHaveAccessibleName("Farblabel: Rot");

    await userEvent.click(screen.getByTestId("tile-i-a-pick"));
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { flag: "pick" });
    expect(announced()).toBe("Als ausgewählt markiert");
    await userEvent.click(screen.getByTestId("tile-i-a-pick"));
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { flag: "none" });
    expect(announced()).toBe("Markierung entfernt");
  });

  it("Farblabel-Palette schliesst mit Escape und gibt den Fokus zurueck", async () => {
    renderLibrary(makeFakeApi([IMG_A]));
    const trigger = await screen.findByTestId("tile-i-a-label");
    await userEvent.click(trigger);
    expect(screen.getByTestId("tile-i-a-label-menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("tile-i-a-label-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("Batch-Aktion setzt Sterne fuer die Auswahl", async () => {
    const api = makeFakeApi([IMG_A, IMG_B, IMG_C]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-select-i-a"));
    await userEvent.click(screen.getByTestId("image-select-i-b"));
    await userEvent.click(screen.getByTestId("batch-star-5"));
    expect(api.updateImages).toHaveBeenCalledWith(["i-a", "i-b"], { rating: 5 });
    expect(announced()).toBe("2 Bilder: 5 Sterne");
    expect(screen.getByTestId("tile-i-a-star-5")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tile-i-c-star-4")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByTestId("batch-reject"));
    expect(api.updateImages).toHaveBeenLastCalledWith(["i-a", "i-b"], { flag: "reject" });
    await userEvent.click(screen.getByTestId("batch-label"));
    await userEvent.click(screen.getByTestId("batch-label-none"));
    expect(api.updateImages).toHaveBeenLastCalledWith(["i-a", "i-b"], { colorLabel: null });
  });

  it("Batch-Fehler rollt alle betroffenen Bilder zurueck", async () => {
    const api = makeFakeApi([IMG_A, IMG_C]);
    api.updateImages.mockRejectedValueOnce(new Error("Image nicht gefunden."));
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-select-i-a"));
    await userEvent.click(screen.getByTestId("image-select-i-c"));
    await userEvent.click(screen.getByTestId("batch-star-1"));
    await waitFor(() => expect(screen.getByTestId("library-error")).toBeInTheDocument());
    expect(screen.getByTestId("tile-i-c-star-4")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tile-i-a-star-1")).toHaveAttribute("aria-pressed", "false");
  });

  it("Filter laufen ueber den Server; leerer Treffer bietet Zuruecksetzen", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await screen.findByTestId("image-tile-i-a");
    api.listImages.mockResolvedValue([]);
    await userEvent.selectOptions(screen.getByTestId("filter-min-rating"), "3");
    await waitFor(() =>
      expect(api.listImages).toHaveBeenLastCalledWith(
        "ready",
        expect.objectContaining({ minRating: 3 }),
      ),
    );
    expect(await screen.findByTestId("library-filter-empty")).toHaveTextContent(
      "Keine Bilder passen zu diesem Filter.",
    );
    expect(screen.queryByText("Noch keine Bilder hochgeladen.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("filter-label-blue"));
    await waitFor(() =>
      expect(api.listImages).toHaveBeenLastCalledWith(
        "ready",
        expect.objectContaining({ minRating: 3, colorLabels: ["blue"] }),
      ),
    );
    await userEvent.selectOptions(screen.getByTestId("filter-flag"), "pick");
    await userEvent.selectOptions(screen.getByTestId("filter-sort"), "rating_desc");
    await waitFor(() =>
      expect(api.listImages).toHaveBeenLastCalledWith("ready", {
        minRating: 3,
        colorLabels: ["blue"],
        flag: "pick",
        sort: "rating_desc",
      }),
    );

    api.listImages.mockResolvedValue([IMG_A]);
    await userEvent.click(screen.getByTestId("library-filter-empty-reset"));
    await screen.findByTestId("image-tile-i-a");
    expect(api.listImages).toHaveBeenLastCalledWith("ready", {
      minRating: 0,
      colorLabels: [],
      flag: undefined,
      sort: "rating_desc",
    });
    expect(screen.queryByTestId("filter-reset")).not.toBeInTheDocument();
  });

  it("Roving-Tabindex: ein Tab-Stopp, Pfeiltasten bewegen den Fokus", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    const tileA = await screen.findByTestId("image-tile-i-a");
    const tileB = screen.getByTestId("image-tile-i-b");
    const tileC = screen.getByTestId("image-tile-i-c");
    expect(tileA).toHaveAttribute("tabindex", "0");
    expect(tileB).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("tile-i-b-star-1")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("tile-i-a-star-1")).toHaveAttribute("tabindex", "0");

    tileA.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tileB);
    expect(tileB).toHaveAttribute("tabindex", "0");
    expect(tileA).toHaveAttribute("tabindex", "-1");
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(tileC);
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(tileA);
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tileA);
  });

  it("Klick in eine Kachel macht sie zur aktiven", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B]));
    await userEvent.click(await screen.findByTestId("tile-i-b-star-2"));
    expect(screen.getByTestId("image-tile-i-b")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("image-tile-i-a")).toHaveAttribute("tabindex", "-1");
  });

  it("Leertaste auf der Kachel schaltet die Auswahl um", async () => {
    renderLibrary(makeFakeApi([IMG_A]));
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard(" ");
    expect(screen.getByTestId("image-select-i-a")).toBeChecked();
    expect(screen.getByTestId("batch-apply-open")).toHaveTextContent("Preset anwenden (1)");
  });

  it("Pfeiltasten in Buttons der Kachel bewegen den Fokus nicht", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B]));
    const star = await screen.findByTestId("tile-i-a-star-2");
    star.focus();
    fireEvent.keyDown(star, { key: "ArrowRight" });
    expect(document.activeElement).toBe(star);
  });

  it("Im Editor öffnen und Loeschen funktionieren im Raster", async () => {
    const api = makeFakeApi([IMG_A, IMG_B]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-edit-i-a"));
    expect(navigateMock).toHaveBeenCalledWith("/editor?image=i-a");
    expect(screen.getByTestId("image-edit-i-a")).toHaveAccessibleName("„a.jpg“ im Editor öffnen");

    await userEvent.click(screen.getByTestId("image-delete-i-a"));
    api.listImages.mockResolvedValue([IMG_B]);
    await userEvent.click(screen.getByTestId("image-delete-confirm-i-a"));
    expect(api.deleteImage).toHaveBeenCalledWith("i-a");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("image-delete-i-b")),
    );
  });

  it("abgelehnte Bilder werden abgedunkelt", async () => {
    renderLibrary(makeFakeApi([{ ...IMG_A, flag: "reject" }]));
    expect(await screen.findByTestId("image-thumb-i-a")).toHaveClass("grayscale");
  });

  it("Auswahl wird auf sichtbare Bilder beschnitten, wenn ein Filter sie ausblendet", async () => {
    const api = makeFakeApi([IMG_A, IMG_C]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-select-i-a"));
    await userEvent.click(screen.getByTestId("image-select-i-c"));
    api.listImages.mockResolvedValue([IMG_C]);
    await userEvent.selectOptions(screen.getByTestId("filter-min-rating"), "4");
    await waitFor(() =>
      expect(screen.getByTestId("batch-apply-open")).toHaveTextContent("Preset anwenden (1)"),
    );
  });
});

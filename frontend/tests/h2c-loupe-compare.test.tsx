import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Library from "../src/pages/Library";
import ShortcutCheatsheet from "../src/editor/ShortcutCheatsheet";
import * as useApiModule from "../src/api/use-api";
import type { ApiClient, Image } from "../src/api/client";
import { setSingleKeyShortcutsEnabled } from "../src/editor/shortcutPrefs";
import { isShortcutBlocked, isTypingTarget, libraryKeyAction } from "../src/library/libraryKeys";
import { getLoupeAutoAdvance, setLibraryView, setLoupeAutoAdvance } from "../src/library/viewPrefs";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  listImages: Mock;
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
  thumbUrl: "https://s3.test/a-400.jpg",
  previewUrl: "https://s3.test/a-1600.jpg",
  rating: 0,
  colorLabel: null,
  flag: "none",
};
const IMG_B: Image = {
  ...IMG_A,
  id: "i-b",
  originalFilename: "b.nef",
  contentType: "image/x-nikon-nef",
  thumbUrl: null,
  previewUrl: null,
};
const IMG_C: Image = {
  ...IMG_A,
  id: "i-c",
  originalFilename: "c.jpg",
  thumbUrl: "https://s3.test/c-400.jpg",
  previewUrl: null,
};

function announced(): string {
  return screen.getByTestId("library-announce").textContent ?? "";
}

async function openLoupeOn(id: string) {
  const tile = await screen.findByTestId(`image-tile-${id}`);
  tile.focus();
  await userEvent.keyboard("{Enter}");
  return screen.findByTestId("loupe-dialog");
}

beforeEach(() => {
  setLibraryView("grid");
  setSingleKeyShortcutsEnabled(true);
  setLoupeAutoAdvance(false);
  navigateMock.mockReset();
});

afterEach(() => {
  setSingleKeyShortcutsEnabled(true);
  setLoupeAutoAdvance(false);
});

describe("H2c Tasten (reine Funktionen)", () => {
  it("bildet die Lightroom-Tasten ab", () => {
    expect(libraryKeyAction({ key: "0" })).toEqual({ kind: "meta", patch: { rating: 0 } });
    expect(libraryKeyAction({ key: "5" })).toEqual({ kind: "meta", patch: { rating: 5 } });
    expect(libraryKeyAction({ key: "6" })).toEqual({ kind: "meta", patch: { colorLabel: "red" } });
    expect(libraryKeyAction({ key: "7" })).toEqual({ kind: "meta", patch: { colorLabel: "yellow" } });
    expect(libraryKeyAction({ key: "8" })).toEqual({ kind: "meta", patch: { colorLabel: "green" } });
    expect(libraryKeyAction({ key: "9" })).toEqual({ kind: "meta", patch: { colorLabel: "blue" } });
    expect(libraryKeyAction({ key: "p" })).toEqual({ kind: "meta", patch: { flag: "pick" } });
    expect(libraryKeyAction({ key: "X" })).toEqual({ kind: "meta", patch: { flag: "reject" } });
    expect(libraryKeyAction({ key: "u" })).toEqual({ kind: "meta", patch: { flag: "none" } });
    expect(libraryKeyAction({ key: "Enter" })).toEqual({ kind: "loupe" });
    expect(libraryKeyAction({ key: "e" })).toEqual({ kind: "editor" });
    expect(libraryKeyAction({ key: "c" })).toEqual({ kind: "compare" });
    expect(libraryKeyAction({ key: "?" })).toEqual({ kind: "help" });
  });

  it("ignoriert Modifier und unbekannte Tasten", () => {
    expect(libraryKeyAction({ key: "4", ctrlKey: true })).toBeNull();
    expect(libraryKeyAction({ key: "p", metaKey: true })).toBeNull();
    expect(libraryKeyAction({ key: "c", altKey: true })).toBeNull();
    expect(libraryKeyAction({ key: "q" })).toBeNull();
    expect(libraryKeyAction({ key: "Tab" })).toBeNull();
  });

  it("Eingabefelder und offene Menues sperren Kuerzel", () => {
    const text = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    const select = document.createElement("select");
    const button = document.createElement("button");
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(button)).toBe(false);

    const scope = document.createElement("div");
    scope.appendChild(button);
    expect(isShortcutBlocked(button, scope)).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("data-popup-open", "");
    scope.appendChild(menu);
    expect(isShortcutBlocked(button, scope)).toBe(true);
  });

  it("Auto-Weiter wird im Modul-Cache gemerkt", () => {
    setLoupeAutoAdvance(true);
    expect(getLoupeAutoAdvance()).toBe(true);
    setLoupeAutoAdvance(false);
    expect(getLoupeAutoAdvance()).toBe(false);
  });
});

describe("H2c Lupe", () => {
  it("Enter auf der Kachel oeffnet die Lupe mit der 1600-px-Vorschau", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    const dialog = await openLoupeOn("i-a");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("loupe-image")).toHaveAttribute("src", "https://s3.test/a-1600.jpg");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("1 / 3");
    expect(within(dialog).getByTestId("library-announce")).toBeInTheDocument();
  });

  it("blaettert mit Pfeiltasten und Buttons im aktuellen Ergebnis", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    await openLoupeOn("i-a");
    expect(screen.getByTestId("loupe-prev")).toHaveAttribute("aria-disabled", "true");

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 3");
    // Ohne Vorschau: Platzhalter-Text.
    expect(screen.getByTestId("loupe-placeholder")).toHaveTextContent(/Noch keine Vorschau/);
    expect(announced()).toBe("b.nef, Bild 2 von 3");

    await userEvent.click(screen.getByTestId("loupe-next"));
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("3 / 3");
    // Fallback auf das 400-px-Vorschaubild.
    expect(screen.getByTestId("loupe-image")).toHaveAttribute("src", "https://s3.test/c-400.jpg");
    expect(screen.getByTestId("loupe-next")).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByTestId("loupe-next"));
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("3 / 3");

    await userEvent.click(screen.getByTestId("loupe-prev"));
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 3");
  });

  it("Esc schliesst und gibt den Fokus an die Kachel des letzten Bildes", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    await openLoupeOn("i-a");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("image-tile-i-b")));
    expect(screen.getByTestId("image-tile-i-b")).toHaveAttribute("tabindex", "0");
    // Ansage-Region ist zurueck auf der Seite.
    expect(screen.getByTestId("library-announce")).toBeInTheDocument();
  });

  it("Ziffer bewertet in der Lupe, Auto-Weiter springt zum naechsten Bild", async () => {
    const api = makeFakeApi([IMG_A, IMG_B, IMG_C]);
    renderLibrary(api);
    await openLoupeOn("i-a");
    await userEvent.keyboard("4");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { rating: 4 });
    expect(screen.getByTestId("loupe-star-4")).toHaveAttribute("aria-pressed", "true");
    expect(announced()).toBe("4 Sterne");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("1 / 3");

    await userEvent.click(screen.getByTestId("loupe-auto-advance"));
    expect(getLoupeAutoAdvance()).toBe(true);
    await userEvent.keyboard("p");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { flag: "pick" });
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 3");
    expect(announced()).toBe("Als ausgewählt markiert – weiter: b.nef, Bild 2 von 3");

    // Auch der Button-Weg springt weiter.
    await userEvent.click(screen.getByTestId("loupe-star-2"));
    expect(api.updateImage).toHaveBeenLastCalledWith("i-b", { rating: 2 });
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("3 / 3");

    // Am Ende bleibt die Lupe stehen.
    await userEvent.keyboard("6");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-c", { colorLabel: "red" });
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("3 / 3");
  });

  it("E und der Button oeffnen den Editor", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B]));
    await openLoupeOn("i-b");
    await userEvent.keyboard("e");
    expect(navigateMock).toHaveBeenLastCalledWith("/editor?image=i-b");
    await userEvent.click(screen.getByTestId("loupe-edit"));
    expect(navigateMock).toHaveBeenCalledTimes(2);
  });

  it("offenes Farblabel-Menue: Esc schliesst nur das Menue, Ziffern ruhen", async () => {
    const api = makeFakeApi([IMG_A, IMG_B]);
    renderLibrary(api);
    await openLoupeOn("i-a");
    await userEvent.click(screen.getByTestId("loupe-label"));
    expect(screen.getByTestId("loupe-label-menu")).toBeInTheDocument();
    await userEvent.keyboard("3");
    expect(api.updateImage).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("loupe-label-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("loupe-dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
  });

  it("ohne Einzeltasten: Enter/Ziffern wirken nicht, Buttons und Pfeile schon", async () => {
    setSingleKeyShortcutsEnabled(false);
    const api = makeFakeApi([IMG_A, IMG_B]);
    renderLibrary(api);
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("4");
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
    expect(api.updateImage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("image-loupe-i-a"));
    expect(screen.getByTestId("loupe-dialog")).toBeInTheDocument();
    await userEvent.keyboard("4");
    expect(api.updateImage).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 2");
    await userEvent.click(screen.getByTestId("loupe-star-4"));
    expect(api.updateImage).toHaveBeenLastCalledWith("i-b", { rating: 4 });
  });

  it("Lupe ist auch in der Listenansicht erreichbar; Fokus zurueck auf den Button", async () => {
    setLibraryView("list");
    renderLibrary(makeFakeApi([IMG_A, IMG_B]));
    await userEvent.click(await screen.findByTestId("image-loupe-i-b"));
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 2");
    await userEvent.click(screen.getByTestId("loupe-close"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("image-loupe-i-b")),
    );
  });
});

describe("H2c Raster-Tasten", () => {
  it("Ziffern, P/X/U und Labels auf der Kachel", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("3");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { rating: 3 });
    expect(announced()).toBe("3 Sterne");
    await userEvent.keyboard("x");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { flag: "reject" });
    await userEvent.keyboard("u");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { flag: "none" });
    await userEvent.keyboard("9");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-a", { colorLabel: "blue" });
    expect(announced()).toBe("Label Blau");
    await userEvent.keyboard("e");
    expect(navigateMock).toHaveBeenLastCalledWith("/editor?image=i-a");
  });

  it("ohne Einzeltasten bleibt die Kachel unveraendert", async () => {
    setSingleKeyShortcutsEnabled(false);
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("3p9e");
    expect(api.updateImage).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("? oeffnet die Tastenkuerzel-Hilfe mit Abschnitt Bibliothek", async () => {
    renderLibrary(makeFakeApi([IMG_A]));
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("?");
    const sheet = screen.getByTestId("shortcut-cheatsheet");
    expect(within(sheet).getByRole("heading", { name: "Bibliothek" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("shortcut-cheatsheet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("library-shortcuts-open"));
    expect(screen.getByTestId("shortcut-cheatsheet")).toHaveClass("fixed");
  });
});

describe("H2c Vergleich", () => {
  it("Button nur bei genau zwei ausgewaehlten Bildern aktiv", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B, IMG_C]));
    const button = await screen.findByTestId("compare-open");
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByTestId("image-select-i-c"));
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByTestId("image-select-i-a"));
    expect(button).toBeEnabled();
    await userEvent.click(screen.getByTestId("image-select-i-b"));
    expect(button).toBeDisabled();
  });

  it("zeigt beide Bilder mit eigenen Bedienelementen; Esc schliesst", async () => {
    const api = makeFakeApi([IMG_A, IMG_B, IMG_C]);
    renderLibrary(api);
    await userEvent.click(await screen.findByTestId("image-select-i-c"));
    await userEvent.click(screen.getByTestId("image-select-i-a"));
    const button = screen.getByTestId("compare-open");
    await userEvent.click(button);
    const dialog = screen.getByTestId("compare-dialog");
    // Anzeige-Reihenfolge, nicht Klick-Reihenfolge.
    const panes = within(dialog).getAllByRole("region");
    expect(panes.map((p) => p.getAttribute("data-testid"))).toEqual(["compare-i-a", "compare-i-c"]);
    expect(screen.getByTestId("compare-i-a-image")).toHaveAttribute("src", "https://s3.test/a-1600.jpg");

    await userEvent.click(screen.getByTestId("compare-i-c-star-5"));
    expect(api.updateImage).toHaveBeenLastCalledWith("i-c", { rating: 5 });
    expect(screen.getByTestId("compare-i-c-star-5")).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByTestId("library-announce")).toHaveTextContent("5 Sterne");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("compare-dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("C auf der Kachel vergleicht oder sagt an, was fehlt", async () => {
    renderLibrary(makeFakeApi([IMG_A, IMG_B]));
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("c");
    expect(screen.queryByTestId("compare-dialog")).not.toBeInTheDocument();
    expect(announced()).toBe("Zum Vergleichen genau zwei Bilder auswählen");
    await userEvent.keyboard(" ");
    await userEvent.click(screen.getByTestId("image-select-i-b"));
    screen.getByTestId("image-tile-i-a").focus();
    await userEvent.keyboard("c");
    expect(screen.getByTestId("compare-dialog")).toBeInTheDocument();
  });
});

describe("H2c Cheatsheet", () => {
  it("Editor-Kontext behaelt die bisherige Reihenfolge und das absolute Overlay", () => {
    render(<ShortcutCheatsheet open onClose={vi.fn()} />);
    const sheet = screen.getByTestId("shortcut-cheatsheet");
    expect(sheet).toHaveClass("absolute");
    const headings = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Bild");
    expect(headings).toContain("Bibliothek");
  });

  it("Bibliothek-Kontext zeigt den Abschnitt zuerst", () => {
    render(<ShortcutCheatsheet open onClose={vi.fn()} context="library" />);
    const sheet = screen.getByTestId("shortcut-cheatsheet");
    const headings = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Bibliothek");
    expect(within(sheet).getByText("Label Rot / Gelb / Grün / Blau")).toBeInTheDocument();
  });
});

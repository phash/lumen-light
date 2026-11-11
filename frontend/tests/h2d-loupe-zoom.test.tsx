import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShortcutCheatsheet from "../src/editor/ShortcutCheatsheet";
import { setSingleKeyShortcutsEnabled } from "../src/editor/shortcutPrefs";
import { libraryKeyAction } from "../src/library/libraryKeys";
import { setLibraryView, setLoupeAutoAdvance } from "../src/library/viewPrefs";
import { anchorFromPoint, scrollForAnchor, zoomSourceKind } from "../src/library/zoom";
import {
  IMG_A,
  IMG_NOPREVIEW,
  IMG_RAW,
  announced,
  makeFakeLibraryApi,
  renderLibraryAt,
  type FakeLibraryApi,
} from "./library-fakes";

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => vi.fn() };
});

const ORIGINAL_URL = "https://s3.test/a-original.jpg";

function makeApi(): FakeLibraryApi {
  const api = makeFakeLibraryApi([IMG_A, IMG_RAW, IMG_NOPREVIEW]);
  api.getImageUrl.mockResolvedValue({ url: ORIGINAL_URL, expiresIn: 300 });
  return api;
}

async function openLoupe(id: string) {
  const tile = await screen.findByTestId(`image-tile-${id}`);
  tile.focus();
  await userEvent.keyboard("{Enter}");
  return screen.findByTestId("loupe-dialog");
}

beforeEach(() => {
  setLibraryView("grid");
  setSingleKeyShortcutsEnabled(true);
  setLoupeAutoAdvance(false);
});

afterEach(() => setSingleKeyShortcutsEnabled(true));

describe("H2d Zoom (reine Funktionen)", () => {
  it("Z ist eine Bibliothek-Taste", () => {
    expect(libraryKeyAction({ key: "z" })).toEqual({ kind: "zoom" });
    expect(libraryKeyAction({ key: "Z" })).toEqual({ kind: "zoom" });
    expect(libraryKeyAction({ key: "z", ctrlKey: true })).toBeNull();
  });

  it("nur JPEG/PNG-Originale zeigt der Browser direkt", () => {
    expect(zoomSourceKind(IMG_A)).toBe("original");
    expect(zoomSourceKind({ ...IMG_A, contentType: "image/png" })).toBe("original");
    expect(zoomSourceKind(IMG_RAW)).toBe("preview");
    expect(zoomSourceKind({ ...IMG_A, contentType: "image/tiff" })).toBe("preview");
  });

  it("Klickpunkt wird relativ und geklemmt", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(anchorFromPoint(rect, 150, 75)).toEqual({ x: 0.25, y: 0.25 });
    expect(anchorFromPoint(rect, 0, 500)).toEqual({ x: 0, y: 1 });
    expect(anchorFromPoint({ ...rect, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("Scroll-Position zentriert den Ankerpunkt und bleibt im Bereich", () => {
    const size = { scrollWidth: 4000, scrollHeight: 3000, clientWidth: 1000, clientHeight: 800 };
    expect(scrollForAnchor({ x: 0.5, y: 0.5 }, size)).toEqual({ left: 1500, top: 1100 });
    expect(scrollForAnchor({ x: 0, y: 0 }, size)).toEqual({ left: 0, top: 0 });
    expect(scrollForAnchor({ x: 1, y: 1 }, size)).toEqual({ left: 3000, top: 2200 });
  });
});

describe("H2d Lupe 1:1", () => {
  it("Z zoomt ein JPEG auf das Original, Ladezustand bis zum Laden", async () => {
    const api = makeApi();
    renderLibraryAt(api);
    await openLoupe("i-a");
    const toggle = screen.getByTestId("loupe-zoom-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Original erst beim Zoomen laden.
    expect(api.getImageUrl).not.toHaveBeenCalled();

    await userEvent.keyboard("z");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(api.getImageUrl).toHaveBeenCalledWith("i-a");
    expect(screen.getByTestId("loupe-zoom-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("loupe-zoom-loading")).toHaveTextContent("Original wird geladen …");
    // Bis das Original geladen ist, steht die Vorschau in 1:1.
    expect(screen.getByTestId("loupe-zoom-image")).toHaveAttribute("src", IMG_A.previewUrl);

    const loader = await screen.findByTestId("loupe-zoom-original-loader");
    expect(loader).toHaveAttribute("src", ORIGINAL_URL);
    fireEvent.load(loader);
    await waitFor(() =>
      expect(screen.getByTestId("loupe-zoom-image")).toHaveAttribute("src", ORIGINAL_URL),
    );
    expect(screen.queryByTestId("loupe-zoom-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("loupe-zoom-hint")).not.toBeInTheDocument();
    expect(announced()).toBe("Zoom 1:1");

    await userEvent.keyboard("z");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("loupe-zoom-viewport")).not.toBeInTheDocument();
    expect(screen.getByTestId("loupe-image")).toBeInTheDocument();
    expect(announced()).toBe("Eingepasst");

    // Zweites Zoomen nutzt die gemerkte URL.
    await userEvent.click(toggle);
    expect(api.getImageUrl).toHaveBeenCalledTimes(1);
  });

  it("RAW zoomt die 1600-px-Vorschau mit Hinweis, ohne Original zu laden", async () => {
    const api = makeApi();
    renderLibraryAt(api);
    await openLoupe("i-raw");
    await userEvent.click(screen.getByTestId("loupe-zoom-toggle"));
    expect(api.getImageUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId("loupe-zoom-image")).toHaveAttribute("src", IMG_RAW.previewUrl);
    expect(screen.getByTestId("loupe-zoom-hint")).toHaveTextContent(
      "1:1 der Vorschau (1600 px) – RAW-Original nur im Editor",
    );
    expect(screen.queryByTestId("loupe-zoom-loading")).not.toBeInTheDocument();
  });

  it("Fehler beim Laden des Originals faellt auf die Vorschau mit Hinweis zurueck", async () => {
    const api = makeApi();
    api.getImageUrl.mockRejectedValue(new Error("boom"));
    renderLibraryAt(api);
    await openLoupe("i-a");
    await userEvent.keyboard("z");
    expect(await screen.findByTestId("loupe-zoom-hint")).toHaveTextContent(
      "Original nicht verfügbar – 1:1 der Vorschau",
    );
    expect(screen.queryByTestId("loupe-zoom-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("loupe-zoom-image")).toHaveAttribute("src", IMG_A.previewUrl);
  });

  it("Klick aufs Bild zoomt, Klick ohne Ziehen zoomt zurueck", async () => {
    renderLibraryAt(makeApi());
    await openLoupe("i-raw");
    await userEvent.click(screen.getByTestId("loupe-image"));
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "true");

    const viewport = screen.getByTestId("loupe-zoom-viewport");
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  it("Ziehen verschiebt den Ausschnitt und bleibt im Zoom", async () => {
    renderLibraryAt(makeApi());
    await openLoupe("i-raw");
    await userEvent.keyboard("z");
    const viewport = screen.getByTestId("loupe-zoom-viewport");
    viewport.scrollLeft = 300;
    viewport.scrollTop = 200;
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 60, clientY: 70, pointerId: 1 });
    expect(viewport.scrollLeft).toBe(340);
    expect(viewport.scrollTop).toBe(230);
    fireEvent.pointerUp(viewport, { clientX: 60, clientY: 70, pointerId: 1 });
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  it("Esc verlaesst erst den Zoom, das zweite Esc schliesst die Lupe", async () => {
    renderLibraryAt(makeApi());
    await openLoupe("i-raw");
    await userEvent.keyboard("z");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("loupe-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "false");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
  });

  it("Pfeiltasten blaettern weiter und setzen den Zoom zurueck", async () => {
    renderLibraryAt(makeApi());
    await openLoupe("i-a");
    await userEvent.keyboard("{ArrowRight}z");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("2 / 3");
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("loupe-position")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("loupe-zoom-viewport")).not.toBeInTheDocument();
  });

  it("ohne Vorschau ist Zoom nicht moeglich", async () => {
    renderLibraryAt(makeApi());
    await openLoupe("i-np");
    expect(screen.getByTestId("loupe-zoom-toggle")).toBeDisabled();
    await userEvent.keyboard("z");
    expect(screen.queryByTestId("loupe-zoom-viewport")).not.toBeInTheDocument();
  });

  it("ohne Einzeltasten wirkt Z nicht, der Button schon", async () => {
    setSingleKeyShortcutsEnabled(false);
    renderLibraryAt(makeApi());
    (await screen.findByTestId("image-loupe-i-raw")).click();
    await screen.findByTestId("loupe-dialog");
    await userEvent.keyboard("z");
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByTestId("loupe-zoom-toggle"));
    expect(screen.getByTestId("loupe-zoom-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  it("Z auf der Kachel tut nichts", async () => {
    renderLibraryAt(makeApi());
    const tile = await screen.findByTestId("image-tile-i-a");
    tile.focus();
    await userEvent.keyboard("z");
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
  });
});

describe("H2d Cheatsheet", () => {
  it("Bibliothek nennt Z fuer den Zoom", () => {
    render(<ShortcutCheatsheet open onClose={vi.fn()} context="library" />);
    const sheet = screen.getByTestId("shortcut-cheatsheet");
    expect(within(sheet).getByText("Lupe: Zoom 1:1 ein/aus")).toBeInTheDocument();
  });
});

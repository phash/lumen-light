import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { setSingleKeyShortcutsEnabled } from "../src/editor/shortcutPrefs";
import { setLibraryView } from "../src/library/viewPrefs";
import {
  IMG_A,
  IMG_NOPREVIEW,
  IMG_RAW,
  announced,
  makeFakeLibraryApi,
  renderLibraryAt,
} from "./library-fakes";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => navigateMock };
});

beforeEach(() => {
  setLibraryView("list");
  setSingleKeyShortcutsEnabled(true);
  navigateMock.mockReset();
});

afterEach(() => setSingleKeyShortcutsEnabled(true));

describe("H2d Einzeltasten in der Listenansicht", () => {
  it("Zeile ist ein Tab-Stopp mit Namen und Roving-Tabindex", async () => {
    renderLibraryAt(makeFakeLibraryApi([IMG_A, IMG_RAW]));
    const rowA = await screen.findByTestId("image-row-i-a");
    const rowB = screen.getByTestId("image-row-i-raw");
    expect(rowA).toHaveAttribute("tabindex", "0");
    expect(rowB).toHaveAttribute("tabindex", "-1");
    expect(rowA).toHaveAccessibleName(/^a\.jpg, Keine Sterne/);
  });

  it("Pfeil hoch/runter, Pos1/Ende bewegen den Fokus zwischen Zeilen", async () => {
    renderLibraryAt(makeFakeLibraryApi([IMG_A, IMG_RAW, IMG_NOPREVIEW]));
    const rowA = await screen.findByTestId("image-row-i-a");
    rowA.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("image-row-i-raw"));
    expect(screen.getByTestId("image-row-i-raw")).toHaveAttribute("tabindex", "0");
    expect(rowA).toHaveAttribute("tabindex", "-1");
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByTestId("image-row-i-np"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("image-row-i-np"));
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByTestId("image-row-i-raw"));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(rowA);
  });

  it("Ziffern, Labels, P/X/U und E wirken auf die fokussierte Zeile", async () => {
    const api = makeFakeLibraryApi([IMG_A, IMG_RAW]);
    renderLibraryAt(api);
    (await screen.findByTestId("image-row-i-raw")).focus();
    await userEvent.keyboard("4");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-raw", { rating: 4 });
    expect(announced()).toBe("4 Sterne");
    await waitFor(() =>
      expect(screen.getByTestId("row-i-raw-star-4")).toHaveAttribute("aria-pressed", "true"),
    );
    await userEvent.keyboard("7");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-raw", { colorLabel: "yellow" });
    await userEvent.keyboard("p");
    expect(api.updateImage).toHaveBeenLastCalledWith("i-raw", { flag: "pick" });
    await userEvent.keyboard("e");
    expect(navigateMock).toHaveBeenLastCalledWith("/editor?image=i-raw");
  });

  it("Leertaste schaltet die Auswahl, C vergleicht zwei ausgewaehlte", async () => {
    renderLibraryAt(makeFakeLibraryApi([IMG_A, IMG_RAW]));
    const rowA = await screen.findByTestId("image-row-i-a");
    rowA.focus();
    await userEvent.keyboard(" ");
    expect(screen.getByTestId("image-select-i-a")).toBeChecked();
    await userEvent.keyboard("{ArrowDown} ");
    expect(screen.getByTestId("image-select-i-raw")).toBeChecked();
    await userEvent.keyboard("c");
    expect(screen.getByTestId("compare-dialog")).toBeInTheDocument();
  });

  it("Enter oeffnet die Lupe, Schliessen gibt den Fokus an die Zeile", async () => {
    renderLibraryAt(makeFakeLibraryApi([IMG_A, IMG_RAW]));
    (await screen.findByTestId("image-row-i-a")).focus();
    await userEvent.keyboard("{Enter}");
    const dialog = screen.getByTestId("loupe-dialog");
    expect(within(dialog).getByTestId("loupe-position")).toHaveTextContent("1 / 2");
    await userEvent.keyboard("{ArrowRight}{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("image-row-i-raw")),
    );
  });

  it("Tasten in Buttons der Zeile loesen keine Kuerzel aus", async () => {
    const api = makeFakeLibraryApi([IMG_A, IMG_RAW]);
    renderLibraryAt(api);
    const star = await screen.findByTestId("row-i-a-star-2");
    star.focus();
    await userEvent.keyboard("3{ArrowDown}");
    expect(api.updateImage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(star);
  });

  it("ohne Einzeltasten bleibt die Zeile unveraendert, Pfeile laufen weiter", async () => {
    setSingleKeyShortcutsEnabled(false);
    const api = makeFakeLibraryApi([IMG_A, IMG_RAW]);
    renderLibraryAt(api);
    (await screen.findByTestId("image-row-i-a")).focus();
    await userEvent.keyboard("3pe{Enter}");
    expect(api.updateImage).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("loupe-dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("image-row-i-raw"));
  });
});

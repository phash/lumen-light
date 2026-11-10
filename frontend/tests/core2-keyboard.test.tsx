import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setSingleKeyShortcutsEnabled } from "../src/editor/shortcutPrefs";
import { useKeyboardShortcuts } from "../src/editor/useKeyboardShortcuts";

type Shortcuts = Parameters<typeof useKeyboardShortcuts>[0];

function Harness(props: Shortcuts & { slider?: boolean; tour?: boolean }) {
  const { slider, tour, ...shortcuts } = props;
  useKeyboardShortcuts(shortcuts);
  return (
    <div>
      {slider && (
        <div role="slider" tabIndex={0} aria-valuenow={0} data-testid="slider">
          <span tabIndex={0} data-testid="slider-thumb" />
        </div>
      )}
      {tour && <div data-testid="onboarding-tour" role="dialog" aria-modal="true" />}
    </div>
  );
}

function allHandlers() {
  return {
    onResetAll: vi.fn(),
    onToggleCrop: vi.fn(),
    onTogglePresets: vi.fn(),
    onShowHelp: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    setBypass: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onExport: vi.fn(),
    onOpenFile: vi.fn(),
    onEscape: vi.fn(),
  };
}

const SINGLE_KEYS = ["0", "r", "p", "\\", "+", "-", "=", "?"];

describe("useKeyboardShortcuts WCAG 2.1.4", () => {
  afterEach(() => {
    setSingleKeyShortcutsEnabled(true);
  });

  it("Einzeltasten werden ignoriert, wenn abgeschaltet", () => {
    setSingleKeyShortcutsEnabled(false);
    const h = allHandlers();
    render(<Harness {...h} />);
    for (const key of SINGLE_KEYS) fireEvent.keyDown(window, { key });
    expect(h.onResetAll).not.toHaveBeenCalled();
    expect(h.onToggleCrop).not.toHaveBeenCalled();
    expect(h.onTogglePresets).not.toHaveBeenCalled();
    expect(h.onShowHelp).not.toHaveBeenCalled();
    expect(h.onZoomIn).not.toHaveBeenCalled();
    expect(h.onZoomOut).not.toHaveBeenCalled();
    expect(h.setBypass).not.toHaveBeenCalledWith(true);
  });

  it("Strg/Cmd-Kombinationen und Escape bleiben aktiv, wenn abgeschaltet", () => {
    setSingleKeyShortcutsEnabled(false);
    const h = allHandlers();
    render(<Harness {...h} />);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onUndo).toHaveBeenCalledTimes(1);
    expect(h.onRedo).toHaveBeenCalledTimes(1);
    expect(h.onExport).toHaveBeenCalledTimes(1);
    expect(h.onOpenFile).toHaveBeenCalledTimes(1);
    expect(h.onEscape).toHaveBeenCalledTimes(1);
  });

  it("Einzeltasten wirken wieder nach Einschalten", () => {
    setSingleKeyShortcutsEnabled(false);
    const h = allHandlers();
    render(<Harness {...h} />);
    setSingleKeyShortcutsEnabled(true);
    fireEvent.keyDown(window, { key: "r" });
    expect(h.onToggleCrop).toHaveBeenCalledTimes(1);
  });

  it("Einzeltasten werden ignoriert, solange ein role=slider fokussiert ist", () => {
    const h = allHandlers();
    const { getByTestId } = render(<Harness {...h} slider />);
    const slider = getByTestId("slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "0" });
    fireEvent.keyDown(slider, { key: "r" });
    const thumb = getByTestId("slider-thumb");
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "0" });
    expect(h.onResetAll).not.toHaveBeenCalled();
    expect(h.onToggleCrop).not.toHaveBeenCalled();
    // Kombination wirkt weiterhin.
    fireEvent.keyDown(thumb, { key: "z", ctrlKey: true });
    expect(h.onUndo).toHaveBeenCalledTimes(1);
  });

  it("Escape bei offener Onboarding-Tour verlaesst Crop/WB-Modus nicht", () => {
    const h = allHandlers();
    render(<Harness {...h} tour />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onEscape).not.toHaveBeenCalled();
    // Andere Shortcuts bleiben waehrend der Tour erlaubt.
    fireEvent.keyDown(window, { key: "r" });
    expect(h.onToggleCrop).toHaveBeenCalledTimes(1);
  });
});

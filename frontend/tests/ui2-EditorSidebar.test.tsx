import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import EditorSidebar, { lensValueText } from "../src/editor/EditorSidebar";
import { defaultLensCorrection } from "../src/editor/lens";

function renderSidebar(overrides: Partial<Parameters<typeof EditorSidebar>[0]> = {}) {
  const props = {
    canvasElement: null,
    tick: 0,
    aspect: "free" as const,
    onAspectChange: vi.fn(),
    straightenAngle: 0,
    onStraightenChange: vi.fn(),
    onAutoStraighten: vi.fn(),
    onResetGeometry: vi.fn(),
    masks: [],
    selectedMaskId: null,
    selected: null,
    onSelectMask: vi.fn(),
    onRemoveMask: vi.fn(),
    onLocalAdjust: vi.fn(),
    onMaskFeather: vi.fn(),
    onRemoveSelectedMask: vi.fn(),
    lensCorrection: defaultLensCorrection(),
    lensProfileId: null,
    manualLensOverride: false,
    onLensCorrectionChange: vi.fn(),
    adjustments: defaultAdjustments(),
    onAdjustment: vi.fn(),
    onHslChange: vi.fn(),
    onHslReset: vi.fn(),
    onToneCurveSetPoint: vi.fn(),
    onToneCurveAddPoint: vi.fn().mockReturnValue(null),
    onToneCurveRemovePoint: vi.fn(),
    onToneCurveReset: vi.fn(),
    onResetAll: vi.fn(),
    ...overrides,
  };
  const utils = render(<EditorSidebar {...props} />);
  return { props, ...utils };
}

beforeEach(() => {
  localStorage.clear();
});

describe("EditorSidebar Sektionen", () => {
  it("rendert alle Sektionen", () => {
    renderSidebar();
    for (const id of [
      "editor-section-licht",
      "editor-section-farbe",
      "editor-section-detail",
      "editor-section-hsl",
      "editor-section-tone-curve",
      "geometry-section",
      "lens-section",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("editor-reset-all")).toBeInTheDocument();
  });

  it("Klapp-Zustand wird in localStorage lumen.section.* gespeichert", async () => {
    renderSidebar();
    const toggle = screen.getByTestId("geometry-section-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("lumen.section.geometry")).toBe("true");
    await userEvent.click(toggle);
    expect(localStorage.getItem("lumen.section.geometry")).toBe("false");
  });

  it("gespeicherter Klapp-Zustand wird beim Mount gelesen", () => {
    localStorage.setItem("lumen.section.lens", "true");
    renderSidebar();
    expect(screen.getByTestId("lens-section-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("EditorSidebar Geometrie", () => {
  beforeEach(() => {
    localStorage.setItem("lumen.section.geometry", "true");
  });

  it("Begradigen-Slider ist per Label benannt und hat Grad-Wertetext", () => {
    renderSidebar({ straightenAngle: (2.5 * Math.PI) / 180 });
    const slider = screen.getByLabelText(/Begradigen/);
    expect(slider).toBe(screen.getByTestId("straighten-slider"));
    expect(slider).toHaveAttribute("aria-valuetext", "2.5°");
  });

  it("Klick auf das Begradigen-Label loest kein Auto-Begradigen aus", async () => {
    const { props } = renderSidebar();
    await userEvent.click(screen.getByText(/Begradigen \(/));
    expect(props.onAutoStraighten).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("auto-straighten"));
    expect(props.onAutoStraighten).toHaveBeenCalledTimes(1);
  });
});

describe("EditorSidebar Objektiv", () => {
  beforeEach(() => {
    localStorage.setItem("lumen.section.lens", "true");
  });

  it("Objektiv-Slider melden Aenderungen an den Store-Callback", () => {
    const { props } = renderSidebar();
    fireEvent.change(screen.getByTestId("lens-distortion-slider"), {
      target: { value: "0.3" },
    });
    expect(props.onLensCorrectionChange).toHaveBeenCalledWith({ distortion: 0.3 });
    fireEvent.change(screen.getByTestId("lens-vignette-slider"), {
      target: { value: "-0.2" },
    });
    expect(props.onLensCorrectionChange).toHaveBeenCalledWith({ vignette: -0.2 });
  });

  it("Objektiv-Slider haben Prozent-Wertetext mit Bedeutung", () => {
    renderSidebar({
      lensCorrection: { ...defaultLensCorrection(), vignette: 0.25 },
    });
    expect(screen.getByTestId("lens-vignette-slider")).toHaveAttribute(
      "aria-valuetext",
      "+25 % (Ränder aufhellen)",
    );
    expect(screen.getByTestId("lens-distortion-slider")).toHaveAttribute(
      "aria-valuetext",
      "0 % (keine Korrektur)",
    );
  });

  it("lensValueText formatiert negative Werte", () => {
    expect(lensValueText(-0.4, "links", "rechts")).toBe("-40 % (links)");
  });

  it("zeigt den Profilstatus", () => {
    renderSidebar({ lensProfileId: "Canon 24-70", manualLensOverride: true });
    expect(screen.getByTestId("lens-profile-status")).toHaveTextContent(
      "Canon 24-70 (manuell überschrieben)",
    );
  });
});

describe("EditorSidebar mobiles Sheet", () => {
  it("Escape schliesst das Sheet und fokussiert den Toggle", async () => {
    renderSidebar();
    const toggle = screen.getByTestId("editor-sidebar-toggle");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", outer);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
    // Editor-Shortcuts (window-Listener) sehen das Escape nicht.
    expect(outer).not.toHaveBeenCalled();
  });

  it("Sheet klappt zu, sobald ein modaler Dialog erscheint", async () => {
    renderSidebar();
    const toggle = screen.getByTestId("editor-sidebar-toggle");
    await userEvent.click(toggle);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    await act(async () => {
      document.body.appendChild(dialog);
      // MutationObserver-Callback ist ein Microtask.
      await Promise.resolve();
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    dialog.remove();
  });

  it("Sheet laesst unten Platz fuer die Toolbar", () => {
    renderSidebar();
    const cls = screen.getByTestId("editor-sidebar").className;
    expect(cls).not.toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(cls).toMatch(/max-h-\[calc\(100dvh/);
  });
});

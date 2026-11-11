import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import CompareSplitOverlay from "../src/editor/CompareSplitOverlay";
import CropOverlay from "../src/editor/CropOverlay";
import EditorToolbar from "../src/editor/EditorToolbar";
import LinearMaskOverlay from "../src/editor/LinearMaskOverlay";
import type { LinearMask, RadialMask } from "../src/editor/mask";
import { NUDGE_STEP, NUDGE_STEP_LARGE, nudgeDelta } from "../src/editor/overlayKeys";
import { isMacPlatform, modKeyLabel } from "../src/editor/platform";
import RadialMaskOverlay from "../src/editor/RadialMaskOverlay";
import Slider from "../src/editor/Slider";
import { CONTENT } from "../src/i18n/content";

// Identitaets-Transform (3x3, column-major) fuer die Mask-Overlays.
const IDENTITY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

describe("nudgeDelta", () => {
  it("liefert Schritte fuer Pfeiltasten, Shift vergroessert", () => {
    expect(nudgeDelta({ key: "ArrowLeft", shiftKey: false })).toEqual({ dx: -NUDGE_STEP, dy: 0 });
    expect(nudgeDelta({ key: "ArrowDown", shiftKey: true })).toEqual({ dx: 0, dy: NUDGE_STEP_LARGE });
    expect(nudgeDelta({ key: "a", shiftKey: false })).toBeNull();
  });
});

describe("CropOverlay Tastatur", () => {
  it("Handles sind fokussierbar und Pfeiltaste ruft onChange", () => {
    const onChange = vi.fn();
    render(
      <CropOverlay
        cropRect={{ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }}
        aspect="free"
        imageAspect={1}
        onChange={onChange}
      />,
    );
    const handle = screen.getByTestId("crop-handle-se");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle.getAttribute("aria-label")).toMatch(/Zuschnitt/);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Move-Flaeche verschiebt das Rechteck per Pfeiltaste", () => {
    const onChange = vi.fn();
    render(
      <CropOverlay
        cropRect={{ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 }}
        aspect="free"
        imageAspect={1}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("crop-move"), { key: "ArrowRight" });
    const next = onChange.mock.calls[0]?.[0] as { x0: number; x1: number };
    expect(next.x0).toBeCloseTo(0.1 + NUDGE_STEP);
    expect(next.x1).toBeCloseTo(0.5 + NUDGE_STEP);
  });
});

describe("Mask-Overlays Tastatur", () => {
  it("Linear-Handle verschiebt den Punkt per Pfeiltaste", () => {
    const onChangePoint = vi.fn();
    const mask: LinearMask = { type: "linear", p1: { u: 0.2, v: 0.2 }, p2: { u: 0.8, v: 0.8 }, feather: 0.5 };
    render(
      <LinearMaskOverlay
        mask={mask}
        onChangePoint={onChangePoint}
        forwardUvTransform={IDENTITY}
        inverseUvTransform={IDENTITY}
      />,
    );
    const h = screen.getByTestId("linear-mask-handle-p1");
    expect(h).toHaveAttribute("tabindex", "0");
    expect(h).toHaveAttribute("aria-roledescription", "Ziehpunkt");
    expect(h.style.transform).toContain("--overlay-inv-zoom");
    fireEvent.keyDown(h, { key: "ArrowRight", shiftKey: true });
    const [which, uv] = onChangePoint.mock.calls[0] as ["p1" | "p2", { u: number; v: number }];
    expect(which).toBe("p1");
    expect(uv.u).toBeCloseTo(0.2 + NUDGE_STEP_LARGE);
    expect(uv.v).toBeCloseTo(0.2);
  });

  it("Radial-Handles aendern Zentrum und Radius", () => {
    const onChangeCenter = vi.fn();
    const onChangeRadii = vi.fn();
    const mask: RadialMask = { type: "radial", center: { u: 0.5, v: 0.5 }, rx: 0.2, ry: 0.1, feather: 0.5 };
    render(
      <RadialMaskOverlay
        mask={mask}
        onChangeCenter={onChangeCenter}
        onChangeRadii={onChangeRadii}
        forwardUvTransform={IDENTITY}
        inverseUvTransform={IDENTITY}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("radial-mask-handle-center"), { key: "ArrowUp" });
    const c = onChangeCenter.mock.calls[0]?.[0] as { u: number; v: number };
    expect(c.v).toBeCloseTo(0.5 - NUDGE_STEP);
    fireEvent.keyDown(screen.getByTestId("radial-mask-handle-rx"), { key: "ArrowRight" });
    expect(onChangeRadii).toHaveBeenLastCalledWith(0.2 + NUDGE_STEP, 0.1);
  });
});

describe("CompareSplitOverlay Tastatur", () => {
  it("Trennlinie ist ein Slider und reagiert auf Pfeiltasten und Home", () => {
    const onSplitChange = vi.fn();
    render(<CompareSplitOverlay snapshotUrl="blob:x" splitX={0.5} onSplitChange={onSplitChange} />);
    const bar = screen.getByTestId("compare-bar");
    expect(bar).toHaveAttribute("role", "slider");
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(onSplitChange).toHaveBeenLastCalledWith(0.5 - NUDGE_STEP);
    fireEvent.keyDown(bar, { key: "Home" });
    expect(onSplitChange).toHaveBeenLastCalledWith(0);
  });
});

describe("Slider Tastatur", () => {
  function renderSlider(onChange = vi.fn(), value = 0) {
    render(
      <Slider
        adjustmentKey="contrast"
        label="Kontrast"
        value={value}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={onChange}
      />,
    );
    return { onChange, track: screen.getByRole("slider") };
  }

  it("hat aria-valuetext mit formatiertem Wert", () => {
    const { track } = renderSlider(vi.fn(), 0.4);
    expect(track).toHaveAttribute("aria-valuetext", "40");
  });

  it("Home/End/PageUp/ArrowUp bewegen den Wert", () => {
    const { onChange, track } = renderSlider();
    fireEvent.keyDown(track, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(track, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(track, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    fireEvent.keyDown(track, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(0.01);
  });
});

function renderToolbar(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const props: Parameters<typeof EditorToolbar>[0] = {
    bypass: false,
    onBypassDown: vi.fn(),
    onBypassUp: vi.fn(),
    cropMode: false,
    onToggleCrop: vi.fn(),
    onAutoTone: vi.fn(),
    onAutoWb: vi.fn(),
    compareActive: false,
    onToggleCompare: vi.fn(),
    wbPickerActive: false,
    onToggleWbPicker: vi.fn(),
    zoom: 1,
    canResetView: false,
    onResetView: vi.fn(),
    canUndo: true,
    onUndo: vi.fn(),
    canRedo: true,
    onRedo: vi.fn(),
    canAddLinear: true,
    onAddLinear: vi.fn(),
    canAddRadial: true,
    onAddRadial: vi.fn(),
    onShowHelp: vi.fn(),
    onShowPresets: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <EditorToolbar {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("EditorToolbar a11y", () => {
  it("Bypass reagiert auf gehaltene Leertaste", () => {
    const props = renderToolbar();
    const btn = screen.getByTestId("editor-bypass");
    fireEvent.keyDown(btn, { key: " " });
    expect(props.onBypassDown).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(btn, { key: " ", repeat: true });
    expect(props.onBypassDown).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(btn, { key: " " });
    expect(props.onBypassUp).toHaveBeenCalledTimes(1);
  });

  it("Toggle-Buttons tragen aria-pressed", () => {
    renderToolbar({ cropMode: true, compareActive: false, wbPickerActive: true });
    expect(screen.getByTestId("editor-crop-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("editor-compare-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("editor-wb-picker")).toHaveAttribute("aria-pressed", "true");
  });

  it("Undo-Titel nutzt die Plattform-Modifier-Taste", () => {
    renderToolbar();
    expect(screen.getByTestId("editor-undo").getAttribute("title")).toContain(
      `${modKeyLabel()}+Z`,
    );
  });
});

describe("platform", () => {
  it("erkennt Mac und Nicht-Mac", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: "" } as Navigator)).toBe(true);
    expect(isMacPlatform({ platform: "Win32", userAgent: "" } as Navigator)).toBe(false);
    expect(modKeyLabel({ platform: "Linux x86_64", userAgent: "" } as Navigator)).toBe("Strg");
  });
});

describe("i18n CONTENT Qualitaet", () => {
  function collectStrings(value: unknown, out: string[] = []): string[] {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
    else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((v) => collectStrings(v, out));
    }
    return out;
  }

  it("enthaelt keine leeren Strings in DE und EN", () => {
    for (const locale of ["de", "en"] as const) {
      const strings = collectStrings(CONTENT[locale]);
      expect(strings.length).toBeGreaterThan(0);
      expect(strings.filter((s) => s.trim() === "")).toEqual([]);
    }
  });

  it("EN-Inhalt enthaelt keine deutschen Umlaute", () => {
    // Sprachnamen sind bewusst in der jeweiligen Landessprache.
    const strings = collectStrings(CONTENT.en).filter((s) => s !== "Deutsch");
    expect(strings.filter((s) => /[äöüßÄÖÜ]/.test(s))).toEqual([]);
  });

  it("DE schreibt Weiß mit ß", () => {
    expect(collectStrings(CONTENT.de).join(" ")).not.toMatch(/\bWeiss\b/);
  });
});

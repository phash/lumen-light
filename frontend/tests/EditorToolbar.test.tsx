import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import EditorToolbar from "../src/editor/EditorToolbar";

function renderToolbar(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const props = {
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
    canUndo: false,
    onUndo: vi.fn(),
    canRedo: false,
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
  const utils = render(
    <MemoryRouter>
      <EditorToolbar {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe("EditorToolbar", () => {
  it("Bypass-Button feuert PointerDown/Up + Leave", () => {
    const { props } = renderToolbar();
    const btn = screen.getByTestId("editor-bypass");
    fireEvent.pointerDown(btn);
    expect(props.onBypassDown).toHaveBeenCalled();
    fireEvent.pointerUp(btn);
    expect(props.onBypassUp).toHaveBeenCalled();
    fireEvent.pointerLeave(btn);
    // PointerLeave triggert ebenfalls onBypassUp.
    expect(props.onBypassUp).toHaveBeenCalledTimes(2);
  });

  it("Crop-Toggle-Label wechselt mit cropMode", () => {
    const { rerender } = renderToolbar();
    expect(screen.getByTestId("editor-crop-toggle")).toHaveTextContent(
      "Beschneiden",
    );
    rerender(
      <MemoryRouter>
        <EditorToolbar
          {...{
            bypass: false,
            onBypassDown: () => {},
            onBypassUp: () => {},
            cropMode: true,
            onToggleCrop: () => {},
            onAutoTone: () => {},
            onAutoWb: () => {},
            compareActive: false,
            onToggleCompare: () => {},
            wbPickerActive: false,
            onToggleWbPicker: () => {},
            zoom: 1,
            canResetView: false,
            onResetView: () => {},
            canUndo: false,
            onUndo: () => {},
            canRedo: false,
            onRedo: () => {},
            canAddLinear: true,
            onAddLinear: () => {},
            canAddRadial: true,
            onAddRadial: () => {},
            onShowHelp: () => {},
            onShowPresets: () => {},
            onExport: () => {},
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("editor-crop-toggle")).toHaveTextContent(
      "Crop fertig",
    );
  });

  it("Reset-View-Button zeigt Zoom in Prozent + ist disabled bei canResetView=false", () => {
    renderToolbar({ zoom: 1.75, canResetView: true });
    const btn = screen.getByTestId("editor-reset-view");
    expect(btn).toHaveTextContent("175%");
    expect(btn).not.toBeDisabled();
  });

  it("Undo/Redo nur klickbar wenn canUndo/canRedo true", () => {
    renderToolbar();
    expect(screen.getByTestId("editor-undo")).toBeDisabled();
    expect(screen.getByTestId("editor-redo")).toBeDisabled();
  });

  it("Mask-Buttons disabled wenn Limit erreicht", () => {
    renderToolbar({ canAddLinear: false, canAddRadial: false });
    expect(screen.getByTestId("editor-linear-mask-toggle")).toBeDisabled();
    expect(screen.getByTestId("editor-radial-mask-toggle")).toBeDisabled();
  });

  it("Marketplace-Link zeigt korrekten href", () => {
    renderToolbar();
    const link = screen.getByTestId("editor-marketplace-link");
    expect(link).toHaveAttribute("href", "/marketplace");
  });

  it("Help-Button ruft onShowHelp", async () => {
    const { props } = renderToolbar();
    await userEvent.click(screen.getByTestId("editor-help"));
    expect(props.onShowHelp).toHaveBeenCalled();
  });

  it("Auto-Tone und Auto-WB rufen jeweilige Callbacks", async () => {
    const { props } = renderToolbar();
    await userEvent.click(screen.getByTestId("editor-auto-tone"));
    expect(props.onAutoTone).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("editor-auto-wb"));
    expect(props.onAutoWb).toHaveBeenCalled();
  });

  it("Export-Button ruft onExport", async () => {
    const { props } = renderToolbar();
    await userEvent.click(screen.getByTestId("editor-export"));
    expect(props.onExport).toHaveBeenCalled();
  });
});

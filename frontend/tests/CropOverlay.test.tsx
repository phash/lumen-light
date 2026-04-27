import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import CropOverlay from "../src/editor/CropOverlay";
import { defaultCropRect, type CropRect } from "../src/editor/transform";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function renderOverlay(initial: CropRect = defaultCropRect(), aspect: "free" | "1:1" = "free") {
  const onChange = vi.fn();
  const utils = render(
    <CropOverlay
      cropRect={initial}
      aspect={aspect}
      imageAspect={1}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

describe("CropOverlay", () => {
  it("rendert alle 8 Drag-Handles", () => {
    renderOverlay();
    for (const h of HANDLES) {
      expect(screen.getByTestId(`crop-handle-${h}`)).toBeInTheDocument();
    }
  });

  it("Drag eines Handles ruft onChange mit neuem Rect", () => {
    const { onChange } = renderOverlay({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const handle = screen.getByTestId("crop-handle-se");
    // Container und Handle haben in jsdom keine echte Groesse — Rect ist 0x0,
    // also sind alle Drag-Deltas in der relativen Berechnung divide-by-zero.
    // Wir verifizieren stattdessen, dass der pointer-down/move-Pfad wenigstens
    // einen onChange-Aufruf macht. Die genauen Werte testen wir in transform.test.ts.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
  });

  it("Pointer-Up beendet Drag, weitere Moves ohne Effekt", () => {
    const { onChange } = renderOverlay();
    const handle = screen.getByTestId("crop-handle-nw");
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

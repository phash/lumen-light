import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ToneCurve } from "../src/editor/adjustments";
import ToneCurvePanel, { largestGapMidpoint } from "../src/editor/ToneCurvePanel";

const CURVE: ToneCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ],
};

function renderPanel(curve: ToneCurve | null = CURVE) {
  const props = {
    onSetPoint: vi.fn(),
    onAddPoint: vi.fn().mockReturnValue(1),
    onRemovePoint: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ToneCurvePanel curve={curve} {...props} />);
  return props;
}

describe("ToneCurvePanel Tastatur", () => {
  it("Punkte sind fokussierbare Slider mit Wertetext", () => {
    renderPanel();
    const p = screen.getByTestId("tone-curve-point-1");
    expect(p).toHaveAttribute("role", "slider");
    expect(p).toHaveAttribute("tabindex", "0");
    expect(p.getAttribute("aria-valuetext")).toMatch(/Eingang 128, Ausgang 128/);
  });

  it("Pfeiltasten verschieben den Punkt, Shift vergroessert den Schritt", () => {
    const { onSetPoint } = renderPanel();
    const p = screen.getByTestId("tone-curve-point-1");
    fireEvent.keyDown(p, { key: "ArrowUp" });
    const [idx, x, y] = onSetPoint.mock.calls[0] as [number, number, number];
    expect(idx).toBe(1);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5 + 1 / 255);
    fireEvent.keyDown(p, { key: "ArrowRight", shiftKey: true });
    const [, x2] = onSetPoint.mock.calls[1] as [number, number, number];
    expect(x2).toBeCloseTo(0.5 + 10 / 255);
  });

  it("Endpunkte ignorieren horizontale Pfeiltasten", () => {
    const { onSetPoint } = renderPanel();
    fireEvent.keyDown(screen.getByTestId("tone-curve-point-0"), { key: "ArrowRight" });
    expect(onSetPoint).not.toHaveBeenCalled();
  });

  it("Entf entfernt innere Punkte, aber keine Endpunkte", () => {
    const { onRemovePoint } = renderPanel();
    fireEvent.keyDown(screen.getByTestId("tone-curve-point-0"), { key: "Delete" });
    expect(onRemovePoint).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("tone-curve-point-1"), { key: "Backspace" });
    expect(onRemovePoint).toHaveBeenCalledWith(1);
  });

  it("Button Punkt hinzufuegen setzt einen Punkt in die groesste Luecke", async () => {
    const { onAddPoint } = renderPanel({
      points: [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.2 },
        { x: 1, y: 1 },
      ],
    });
    await userEvent.click(screen.getByTestId("tone-curve-add-point"));
    const [x] = onAddPoint.mock.calls[0] as [number, number];
    expect(x).toBeCloseTo(0.6);
  });

  it("largestGapMidpoint liefert die Mitte der groessten Luecke", () => {
    expect(largestGapMidpoint(CURVE)).toBeCloseTo(0.25);
  });
});

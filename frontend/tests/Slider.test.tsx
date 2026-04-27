import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import Slider from "../src/editor/Slider";

interface RenderOpts {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  onChange?: (next: number) => void;
}

function renderSlider({
  value = 0,
  min = -1,
  max = 1,
  step = 0.01,
  defaultValue = 0,
  onChange = vi.fn(),
}: RenderOpts = {}) {
  const result = render(
    <Slider
      adjustmentKey="contrast"
      label="Kontrast"
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
    />,
  );
  return { ...result, onChange };
}

describe("Slider", () => {
  it("zeigt Label und formatierten Wert", () => {
    renderSlider({ value: 0.4 });
    expect(screen.getByText("Kontrast")).toBeInTheDocument();
    expect(screen.getByTestId("slider-contrast-value").textContent).toBe("40");
  });

  it("Doppelklick auf Track ruft onChange mit defaultValue", () => {
    const onChange = vi.fn();
    renderSlider({ value: 0.5, onChange });
    const track = screen.getByRole("slider");
    fireEvent.doubleClick(track);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("ArrowRight erhoeht um step, ArrowLeft reduziert", () => {
    const onChange = vi.fn();
    renderSlider({ value: 0.1, step: 0.01, onChange });
    const track = screen.getByRole("slider");

    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.11, 5));

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.09, 5));
  });

  it("Shift+Arrow erhoeht um step*10", () => {
    const onChange = vi.fn();
    renderSlider({ value: 0.1, step: 0.01, onChange });
    const track = screen.getByRole("slider");

    fireEvent.keyDown(track, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.2, 5));
  });

  it("Wert wird an min/max geclampt", () => {
    const onChange = vi.fn();
    renderSlider({ value: 0.99, max: 1, step: 0.05, onChange });
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("Wertanzeige ist amber wenn nicht-default", () => {
    renderSlider({ value: 0.5 });
    const v = screen.getByTestId("slider-contrast-value");
    expect(v.className).toContain("amber");
  });

  it("Wertanzeige ist grau (stone-500) am default", () => {
    renderSlider({ value: 0 });
    const v = screen.getByTestId("slider-contrast-value");
    expect(v.className).toContain("stone-500");
  });
});

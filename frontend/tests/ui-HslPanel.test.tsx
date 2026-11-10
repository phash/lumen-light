import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HslPanel from "../src/editor/HslPanel";

describe("HslPanel Tabs", () => {
  it("startet auf Hue und wechselt per Klick auf Saettigung", async () => {
    render(<HslPanel hsl={null} onChange={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByTestId("hsl-axis-hue")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("hsl-row-hue-red")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("hsl-axis-saturation"));
    expect(screen.getByTestId("hsl-axis-saturation")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("hsl-axis-hue")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("hsl-row-saturation-red")).toBeInTheDocument();
    expect(screen.queryByTestId("hsl-row-hue-red")).not.toBeInTheDocument();
  });

  it("Slider-Aenderung meldet die aktive Achse", async () => {
    const onChange = vi.fn();
    render(<HslPanel hsl={null} onChange={onChange} onReset={vi.fn()} />);
    await userEvent.click(screen.getByTestId("hsl-axis-luminance"));
    const slider = screen.getByTestId("hsl-slider-luminance-blue");
    // Range-Input: change-Event direkt ausloesen.
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(onChange).toHaveBeenCalledWith("luminance", "blue", 0.3);
  });
});

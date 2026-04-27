import { describe, expect, it } from "vitest";

import { computeHistogram } from "../src/editor/histogram";

function rgba(...values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe("computeHistogram", () => {
  it("liefert drei Channels mit binCount Bins", () => {
    const data = rgba(0, 0, 0, 255, 255, 255, 255, 255);
    const bins = computeHistogram(data, 8);
    expect(bins.r).toHaveLength(8);
    expect(bins.g).toHaveLength(8);
    expect(bins.b).toHaveLength(8);
  });

  it("klassifiziert 0 in den ersten Bin und 255 in den letzten", () => {
    const data = rgba(0, 0, 0, 255, 255, 255, 255, 255);
    const bins = computeHistogram(data, 4);
    // 0 -> Bin 0, 255 -> Bin 3 (letzter)
    expect(bins.r[0]).toBe(1);
    expect(bins.r[3]).toBe(1);
    expect(bins.g[0]).toBe(1);
    expect(bins.g[3]).toBe(1);
    expect(bins.b[0]).toBe(1);
    expect(bins.b[3]).toBe(1);
  });

  it("max ist das hoechste Bin-Count ueber alle Channels", () => {
    const data = new Uint8ClampedArray(40);  // 10 Pixel
    for (let i = 0; i < 10; i += 1) {
      data[i * 4] = 0;          // R immer 0
      data[i * 4 + 1] = 255;    // G immer 255
      data[i * 4 + 2] = 128;    // B immer 128
      data[i * 4 + 3] = 255;
    }
    const bins = computeHistogram(data, 4);
    // Alle 10 Pixel landen R[0]=10, G[3]=10, B[2]=10
    expect(bins.max).toBe(10);
  });

  it("max gibt mindestens 1 zurueck (kein Division-by-Zero)", () => {
    const bins = computeHistogram(new Uint8ClampedArray(0), 4);
    expect(bins.max).toBe(1);
  });

  it("wirft bei nicht-RGBA-Daten", () => {
    expect(() =>
      computeHistogram(new Uint8ClampedArray(7), 4),
    ).toThrow(/Vielfaches von 4/);
  });

  it("wirft bei ungueltigen binCount", () => {
    expect(() =>
      computeHistogram(new Uint8ClampedArray(0), 0),
    ).toThrow(/binCount/);
    expect(() =>
      computeHistogram(new Uint8ClampedArray(0), 257),
    ).toThrow(/binCount/);
  });
});

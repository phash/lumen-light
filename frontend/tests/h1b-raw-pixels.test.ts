/**
 * H1b · 16-bit-Pixelhelfer: Box-Verkleinerung, 8-bit-Ableitung,
 * Bit-Tiefen-Wahl. Reine Funktionen, synthetische Uint16-Puffer.
 */
import { describe, expect, it } from "vitest";

import {
  type Rgb16Image,
  boxDownscaleRgb16,
  chooseRawBitDepth,
  isRgb16Image,
  rgb16ToRgb8,
} from "../src/editor/rawPixels";

function image(width: number, height: number, fill: (x: number, y: number, c: number) => number): Rgb16Image {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = fill(x, y, c);
    }
  }
  return { kind: "rgb16", data, width, height };
}

function px(img: Rgb16Image, x: number, y: number): number[] {
  const i = (y * img.width + x) * 3;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

describe("boxDownscaleRgb16", () => {
  it("2x2 -> 1x1 mittelt pro Kanal", () => {
    const src = image(2, 2, (x, y, c) => (c === 0 ? (x + 2 * y) * 1000 : c === 1 ? 60000 : 0));
    const out = boxDownscaleRgb16(src, 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toEqual([1500, 60000, 0]);
  });

  it("gleiche Groesse liefert identische Werte", () => {
    const src = image(5, 3, (x, y, c) => x * 1000 + y * 100 + c);
    const out = boxDownscaleRgb16(src, 5, 3);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it("Bruchteil-Gewichte: 3 -> 2 Pixel teilt den mittleren Pixel", () => {
    // Quelle 3x1: 0, 3000, 6000. Ziel-Pixel 0 deckt [0, 1.5): (0 + 0.5*3000)/1.5 = 1000
    const src = image(3, 1, (x) => x * 3000);
    const out = boxDownscaleRgb16(src, 2, 1);
    expect(px(out, 0, 0)[0]).toBe(1000);
    expect(px(out, 1, 0)[0]).toBe(5000);
  });

  it("konstante Flaeche bleibt konstant (auch bei krummen Faktoren)", () => {
    const src = image(37, 23, () => 54321);
    const out = boxDownscaleRgb16(src, 11, 7);
    expect(out.data.length).toBe(11 * 7 * 3);
    expect(out.data.every((v) => v === 54321)).toBe(true);
  });

  it("Mittelwert des Bildes bleibt bei ganzzahligem Faktor erhalten", () => {
    const src = image(64, 32, (x, y, c) => (x * 997 + y * 389 + c * 50) % 65536);
    const out = boxDownscaleRgb16(src, 16, 8);
    const mean = (a: Uint16Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.abs(mean(out.data) - mean(src.data))).toBeLessThan(1);
  });

  it("Weiss bleibt Weiss (kein Ueberlauf)", () => {
    const src = image(9, 9, () => 65535);
    const out = boxDownscaleRgb16(src, 4, 4);
    expect(out.data.every((v) => v === 65535)).toBe(true);
  });

  it("lehnt Vergroesserung und leere Ziele ab", () => {
    const src = image(4, 4, () => 0);
    expect(() => boxDownscaleRgb16(src, 5, 4)).toThrow();
    expect(() => boxDownscaleRgb16(src, 0, 4)).toThrow();
  });
});

describe("rgb16ToRgb8", () => {
  it("nimmt das obere Byte (entspricht libraw 8-bit-Ausgabe)", () => {
    const out = rgb16ToRgb8(new Uint16Array([0, 255, 256, 65535, 0x7fff]));
    expect(Array.from(out)).toEqual([0, 0, 1, 255, 127]);
  });
});

describe("chooseRawBitDepth", () => {
  it("16 bit ohne deviceMemory-Angabe", () => {
    expect(chooseRawBitDepth({})).toBe(16);
    expect(chooseRawBitDepth(undefined)).toBe(16);
  });

  it("16 bit ab 4 GB", () => {
    expect(chooseRawBitDepth({ deviceMemory: 4 })).toBe(16);
    expect(chooseRawBitDepth({ deviceMemory: 8 })).toBe(16);
  });

  it("8 bit unter 4 GB", () => {
    expect(chooseRawBitDepth({ deviceMemory: 2 })).toBe(8);
    expect(chooseRawBitDepth({ deviceMemory: 0.5 })).toBe(8);
  });
});

describe("isRgb16Image", () => {
  it("erkennt nur Rgb16-Objekte", () => {
    expect(isRgb16Image(image(1, 1, () => 0))).toBe(true);
    expect(isRgb16Image(document.createElement("canvas"))).toBe(false);
  });
});

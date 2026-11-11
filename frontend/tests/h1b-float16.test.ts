/**
 * H1b · Half-Float-Konvertierung (unorm16 -> IEEE-754 binary16-Bits).
 * Spec: docs/superpowers/specs/2026-11-11-h1b-float-pipeline-design.md
 */
import { describe, expect, it } from "vitest";

import {
  floatToHalfBits,
  halfBitsToFloat,
  unorm16HalfLut,
  unorm16ToHalf,
} from "../src/editor/float16";

/** Orakel: Float16Array (Node >= 24), falls vorhanden. */
const Float16Ctor = (globalThis as { Float16Array?: new (n: number[]) => ArrayBufferView })
  .Float16Array;

function oracleBits(x: number): number {
  if (!Float16Ctor) throw new Error("kein Float16Array");
  const view = new Float16Ctor([x]);
  return new Uint16Array(view.buffer, view.byteOffset, 1)[0]!;
}

describe("floatToHalfBits", () => {
  it("Grenzwerte haben die bekannten Bitmuster", () => {
    expect(floatToHalfBits(0)).toBe(0x0000);
    expect(floatToHalfBits(-0)).toBe(0x8000);
    expect(floatToHalfBits(1)).toBe(0x3c00);
    expect(floatToHalfBits(0.5)).toBe(0x3800);
    expect(floatToHalfBits(-2)).toBe(0xc000);
    expect(floatToHalfBits(65504)).toBe(0x7bff);
    expect(floatToHalfBits(1e6)).toBe(0x7c00);
    expect(floatToHalfBits(Infinity)).toBe(0x7c00);
    expect(floatToHalfBits(2 ** -14)).toBe(0x0400);
    expect(floatToHalfBits(2 ** -24)).toBe(0x0001);
    expect(floatToHalfBits(2 ** -26)).toBe(0x0000);
    expect(floatToHalfBits(Number.NaN) & 0x7c00).toBe(0x7c00);
  });

  it("rundet auf die naechste gerade Mantisse", () => {
    // 1 + 2^-11 liegt genau zwischen 1 und 1 + 2^-10 -> gerade (1.0)
    expect(floatToHalfBits(1 + 2 ** -11)).toBe(0x3c00);
    // 1 + 3 * 2^-11 liegt zwischen 0x3c01 und 0x3c02 -> gerade (0x3c02)
    expect(floatToHalfBits(1 + 3 * 2 ** -11)).toBe(0x3c02);
    // knapp ueber der Mitte -> aufrunden
    expect(floatToHalfBits(1 + 2 ** -11 + 2 ** -20)).toBe(0x3c01);
  });

  it.skipIf(!Float16Ctor)("stimmt fuer alle unorm16-Werte mit Float16Array ueberein", () => {
    let mismatches = 0;
    for (let i = 0; i <= 65535; i++) {
      if (floatToHalfBits(i / 65535) !== oracleBits(i / 65535)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe("halfBitsToFloat", () => {
  it("dekodiert normale, subnormale und Sonderwerte", () => {
    expect(halfBitsToFloat(0x3c00)).toBe(1);
    expect(halfBitsToFloat(0xc000)).toBe(-2);
    expect(halfBitsToFloat(0x0001)).toBe(2 ** -24);
    expect(halfBitsToFloat(0x7bff)).toBe(65504);
    expect(halfBitsToFloat(0x7c00)).toBe(Infinity);
    expect(Number.isNaN(halfBitsToFloat(0x7e00))).toBe(true);
  });

  it("Roundtrip ist fuer alle endlichen Half-Werte exakt", () => {
    let wrong = 0;
    for (let h = 0; h < 0x7c00; h++) {
      if (floatToHalfBits(halfBitsToFloat(h)) !== h) wrong++;
    }
    expect(wrong).toBe(0);
  });
});

describe("unorm16 -> Half", () => {
  it("LUT bildet 0 auf 0 und 65535 auf 1.0 ab", () => {
    const lut = unorm16HalfLut();
    expect(lut.length).toBe(65536);
    expect(lut[0]).toBe(0);
    expect(lut[65535]).toBe(0x3c00);
  });

  it("Fehler liegt hoechstens bei einer halben Half-Stufe und ist monoton", () => {
    const lut = unorm16HalfLut();
    let prev = -1;
    let tooFar = 0;
    let notMonotonic = 0;
    for (let i = 0; i <= 65535; i++) {
      const x = i / 65535;
      const v = halfBitsToFloat(lut[i]!);
      // Stufe der Half-Zahl bei v: 2^(e-10), subnormal 2^-24
      const e = v > 0 ? Math.max(Math.floor(Math.log2(v)), -14) : -14;
      if (Math.abs(v - x) > 2 ** (e - 10) / 2 + 1e-12) tooFar++;
      if (v < prev) notMonotonic++;
      prev = v;
    }
    expect(tooFar).toBe(0);
    expect(notMonotonic).toBe(0);
  });

  it("in den Tiefen bleibt jede 16-bit-Stufe unterscheidbar", () => {
    const lut = unorm16HalfLut();
    // unterhalb 2^-6 ist Half feiner als 1/65535
    const limit = Math.floor(65535 * 2 ** -6);
    const distinct = new Set<number>();
    for (let i = 0; i < limit; i++) distinct.add(lut[i]!);
    expect(distinct.size).toBe(limit);
  });

  it("konvertiert in einen neuen Puffer oder an Ort und Stelle", () => {
    const src = new Uint16Array([0, 32768, 65535]);
    const out = unorm16ToHalf(src);
    expect(out).not.toBe(src);
    expect(Array.from(out)).toEqual([0, floatToHalfBits(32768 / 65535), 0x3c00]);
    const inPlace = unorm16ToHalf(src, src);
    expect(inPlace).toBe(src);
    expect(Array.from(src)).toEqual(Array.from(out));
  });

  it("wirft bei zu kleinem Zielpuffer", () => {
    expect(() => unorm16ToHalf(new Uint16Array(4), new Uint16Array(3))).toThrow();
  });
});

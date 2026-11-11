/**
 * H1b · Messung des Gewinns: Banding bei +3 EV in den Tiefen.
 * Synthetische Rampe 0..0.08 (sRGB) durch die Ton-Referenz (`toneStage`),
 * Quelle einmal 8-bit-quantisiert (heute), einmal unorm16 -> Half (H1b).
 * Ausgang wird wie im Canvas auf 8 bit quantisiert.
 */
import { describe, expect, it } from "vitest";

import type { ProcessVersion } from "../src/editor/adjustments";
import { halfBitsToFloat, unorm16HalfLut } from "../src/editor/float16";
import { NEUTRAL_TONE_PARAMS, toneStage } from "../src/editor/tonemap";

const SAMPLES = 4096;
const RAMP_MAX = 0.08;

interface Banding {
  /** Unterscheidbare 8-bit-Ausgangsstufen auf der Rampe. */
  readonly levels: number;
  /** Groesster Sprung zwischen benachbarten Rampenpunkten (8-bit-Stufen). */
  readonly maxJump: number;
}

function measure(quantize: (x: number) => number, pv: ProcessVersion, exposure: number): Banding {
  const params = { ...NEUTRAL_TONE_PARAMS, exposure };
  const seen = new Set<number>();
  let prev = -1;
  let maxJump = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = quantize((i / (SAMPLES - 1)) * RAMP_MAX);
    const y = toneStage([x, x, x], params, pv)[0];
    const out = Math.round(Math.min(1, Math.max(0, y)) * 255);
    seen.add(out);
    if (prev >= 0) maxJump = Math.max(maxJump, out - prev);
    prev = out;
  }
  return { levels: seen.size, maxJump };
}

const eightBit = (x: number) => Math.round(x * 255) / 255;
const lut = unorm16HalfLut();
const halfFloat = (x: number) => halfBitsToFloat(lut[Math.round(x * 65535)]!);

describe("H1b Banding bei +3 EV in den Tiefen", () => {
  for (const pv of [1, 2] as const) {
    it(`PV${pv}: Half-Quelle fuellt die Stufen, 8-bit-Quelle springt`, () => {
      const before = measure(eightBit, pv, 3);
      const after = measure(halfFloat, pv, 3);
      // Messwerte fuer Spec/Report
      console.info(`[H1b] PV${pv} +3 EV: 8 bit ${JSON.stringify(before)}, half ${JSON.stringify(after)}`);
      expect(before.levels).toBeLessThanOrEqual(22);
      expect(before.maxJump).toBeGreaterThanOrEqual(4);
      // maxJump 1 = jede 8-bit-Ausgangsstufe wird erreicht (Messung: 21 -> 69 Stufen)
      expect(after.levels).toBeGreaterThan(before.levels * 3);
      expect(after.maxJump).toBeLessThanOrEqual(1);
    });
  }

  it("ohne Push aendert die Half-Quelle nichts Sichtbares", () => {
    for (const pv of [1, 2] as const) {
      let maxDiff = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const x = i / (SAMPLES - 1);
        const a = toneStage([eightBit(x), eightBit(x), eightBit(x)], NEUTRAL_TONE_PARAMS, pv)[0];
        const b = toneStage([halfFloat(x), halfFloat(x), halfFloat(x)], NEUTRAL_TONE_PARAMS, pv)[0];
        maxDiff = Math.max(maxDiff, Math.abs(a - b));
      }
      // Quantisierungsrauschen der 8-bit-Quelle (halbe Stufe) plus Schulter
      expect(maxDiff).toBeLessThan(0.006);
    }
  });
});

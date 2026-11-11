/**
 * H1 · Abnahmekriterien der Prozessversion 2 gegen die TS-Referenz
 * (tonemap.ts). Spec: docs/superpowers/specs/2026-11-11-h1-scene-referred-tonemapping-design.md
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ProcessVersion } from "../src/editor/adjustments";
import { analyzePixels, computeAutoTone } from "../src/editor/autoAdjust";
import { defaultAdjustments } from "../src/editor/adjustments";
import {
  NEUTRAL_TONE_PARAMS,
  type Rgb,
  type ToneParams,
  TM_KNEE,
  linearToSrgb,
  shoulder,
  srgbToLinear,
  toneStage,
} from "../src/editor/tonemap";
import { decodePng } from "./pngFixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "..", "tests-fixtures", "test-samples");

function hsv(c: Rgb): { h: number; s: number; v: number } {
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === c[0]) h = ((c[1] - c[2]) / d + 6) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
  }
  return { h: h * 60, s: mx > 0 ? d / mx : 0, v: mx };
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function params(over: Partial<ToneParams>): ToneParams {
  return { ...NEUTRAL_TONE_PARAMS, ...over };
}

interface Deviation {
  mean: number;
  max: number;
}

function deviation(pixels: ReadonlyArray<Rgb>, p: ToneParams): Deviation {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (const px of pixels) {
    const a = toneStage(px, p, 1);
    const b = toneStage(px, p, 2);
    for (let i = 0; i < 3; i++) {
      const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
      sum += d;
      max = Math.max(max, d);
      n++;
    }
  }
  return { mean: sum / n, max };
}

function grayRamp(): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < 256; i++) out.push([i / 255, i / 255, i / 255]);
  return out;
}

function fixturePixels(name: string): Rgb[] {
  const img = decodePng(join(FIXTURE_DIR, name));
  const out: Rgb[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    out.push([
      (img.data[i] ?? 0) / 255,
      (img.data[i + 1] ?? 0) / 255,
      (img.data[i + 2] ?? 0) / 255,
    ]);
  }
  return out;
}

/** Varianten eines Fixtures (linear skaliert bzw. gestaucht), damit
 *  Auto-Ton echte Arbeit hat: unter-, ueberbelichtet, flau. */
function variants(base: ReadonlyArray<Rgb>): Record<string, Rgb[]> {
  const mapLin = (f: (v: number) => number): Rgb[] =>
    base.map((px) => px.map((v) => Math.min(1, linearToSrgb(f(srgbToLinear(v))))) as unknown as Rgb);
  return {
    original: [...base],
    dunkel: mapLin((v) => v * 0.25),
    hell: mapLin((v) => Math.min(1, v * 1.8)),
    flau: base.map((px) => px.map((v) => 0.3 + v * 0.4) as unknown as Rgb),
  };
}

const GRADIENT = fixturePixels("gradient.png");

describe("tonemap · Schulter f", () => {
  it("f(0) = 0 und monoton steigend", () => {
    expect(shoulder(0)).toBe(0);
    let prev = -1;
    for (let x = 0; x <= 64; x += 0.01) {
      const y = shoulder(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it("asymptotisch hoechstens 1", () => {
    for (const x of [1, 2, 8, 64, 1e3, 1e6]) expect(shoulder(x)).toBeLessThanOrEqual(1);
  });

  it("unterhalb des Knies Identitaet, im Knie stetig differenzierbar", () => {
    for (const x of [0.01, 0.18, 0.5, TM_KNEE]) expect(shoulder(x)).toBeCloseTo(x, 12);
    const h = 1e-6;
    const slope = (shoulder(TM_KNEE + h) - shoulder(TM_KNEE)) / h;
    expect(slope).toBeCloseTo(1, 3);
  });

  it("Sensor-Weiss 1.0 landet bei mindestens 0.97", () => {
    expect(shoulder(1)).toBeGreaterThanOrEqual(0.97);
  });

  it("+3 EV (8.0) bleibt unter 1 und unterscheidet sich von +2 EV (4.0)", () => {
    expect(shoulder(8)).toBeLessThan(1);
    expect(shoulder(8) - shoulder(4)).toBeGreaterThan(1e-3);
  });
});

describe("tonemap · Default-Regler: PV2 sieht aus wie PV1", () => {
  it("Graustufen-Rampe: mittlere Abweichung < 0.02, max < 0.06", () => {
    const d = deviation(grayRamp(), NEUTRAL_TONE_PARAMS);
    expect(d.mean).toBeLessThan(0.02);
    expect(d.max).toBeLessThan(0.06);
  });

  it("Fixture gradient.png: mittlere Abweichung < 0.02, max < 0.06", () => {
    expect(GRADIENT.length).toBe(200 * 100);
    const d = deviation(GRADIENT, NEUTRAL_TONE_PARAMS);
    expect(d.mean).toBeLessThan(0.02);
    expect(d.max).toBeLessThan(0.06);
  });

  it("gesaettigte Primaerfarben bleiben bei Default unveraendert", () => {
    for (const px of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.9, 0.1, 0.6]] as Rgb[]) {
      const a = toneStage(px, NEUTRAL_TONE_PARAMS, 1);
      const b = toneStage(px, NEUTRAL_TONE_PARAMS, 2);
      for (let i = 0; i < 3; i++) expect(Math.abs((a[i] ?? 0) - (b[i] ?? 0))).toBeLessThan(0.06);
    }
  });
});

describe("tonemap · Lichter und Farbton", () => {
  const RED: Rgb = [0.85, 0.2, 0.1];

  it("gesaettigtes Rot bei +3 EV: Farbton innerhalb +-3 Grad", () => {
    const out = toneStage(RED, params({ exposure: 3 }), 2);
    expect(hueDelta(hsv(out).h, hsv(RED).h)).toBeLessThanOrEqual(3);
  });

  it("gesaettigtes Rot bei +3 EV laeuft in der Saettigung Richtung Weiss", () => {
    const out = toneStage(RED, params({ exposure: 3 }), 2);
    expect(hsv(out).s).toBeLessThan(hsv(RED).s * 0.75);
    expect(hsv(out).v).toBeGreaterThan(0.97);
    expect(hsv(out).s).toBeGreaterThan(0); // nicht komplett grau
  });

  it("PV1 kippt dasselbe Rot sichtbar Richtung Gelb (Referenz fuer das Problem)", () => {
    const out = toneStage(RED, params({ exposure: 3 }), 1);
    expect(hueDelta(hsv(out).h, hsv(RED).h)).toBeGreaterThan(10);
  });

  it("Belichtung +2 und Lichter -1: Zeichnung in den Lichtern bleibt", () => {
    const p = params({ exposure: 2, highlights: -1 });
    const inputs = [0.6, 0.7, 0.8, 0.9, 1.0];
    const v2 = inputs.map((v) => toneStage([v, v, v], p, 2)[0]);
    const v1 = inputs.map((v) => toneStage([v, v, v], p, 1)[0]);
    // PV2: streng monoton (komprimiert, aber unterscheidbar) ...
    for (let i = 1; i < v2.length; i++) {
      expect(v2[i]! - v2[i - 1]!).toBeGreaterThan(1e-4);
    }
    // ... und 0.7 -> 0.8 sichtbar getrennt (> 1 Code-Wert in 8 bit).
    expect(v2[2]! - v2[1]!).toBeGreaterThan(1 / 255);
    // PV1 clippt hier ab 0.8 hart auf 1.
    expect(v1[2]).toBe(1);
    expect(v1[4]).toBe(1);
  });

  it("Tonbereich-Regler erhalten den Farbton", () => {
    const px: Rgb = [0.7, 0.4, 0.2];
    for (const over of [{ highlights: -1 }, { shadows: 1 }, { whites: 1 }, { blacks: -1 }, { contrast: 0.6 }]) {
      const out = toneStage(px, params(over), 2);
      expect(hueDelta(hsv(out).h, hsv(px).h)).toBeLessThanOrEqual(1);
    }
  });
});

describe("tonemap · Regler-Richtung unter PV2", () => {
  const ramp = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1.0];
  const run = (p: ToneParams) => ramp.map((v) => toneStage([v, v, v], p, 2)[0]);
  const base = run(NEUTRAL_TONE_PARAMS);

  it("Tiefen + hellt dunkle Toene auf, Lichter bleiben", () => {
    const out = run(params({ shadows: 1 }));
    expect(out[2]!).toBeGreaterThan(base[2]! + 0.05);
    expect(Math.abs(out[8]! - base[8]!)).toBeLessThan(0.01);
  });

  it("Lichter - dunkelt helle Toene ab, Tiefen bleiben", () => {
    const out = run(params({ highlights: -1 }));
    expect(out[7]!).toBeLessThan(base[7]! - 0.05);
    expect(Math.abs(out[1]! - base[1]!)).toBeLessThan(0.01);
  });

  it("Schwarz - vertieft nur die tiefsten Toene", () => {
    const out = run(params({ blacks: -1 }));
    expect(out[1]!).toBeLessThan(base[1]! - 0.01);
    expect(Math.abs(out[6]! - base[6]!)).toBeLessThan(0.01);
  });

  it("Weiss + hebt nur die hellsten Toene", () => {
    const out = run(params({ whites: 1 }));
    expect(out[7]!).toBeGreaterThan(base[7]! + 0.03);
    expect(Math.abs(out[3]! - base[3]!)).toBeLessThan(0.01);
  });

  it("Kontrast dreht um Mittelgrau 0.18 und schneidet nicht hart ab", () => {
    const mid = linearToSrgb(0.18);
    const p = params({ contrast: 0.5 });
    expect(toneStage([mid, mid, mid], p, 2)[0]).toBeCloseTo(mid, 5);
    const dark = toneStage([0.15, 0.15, 0.15], p, 2)[0];
    expect(dark).toBeLessThan(0.15);
    expect(dark).toBeGreaterThan(0); // PV1 schneidet 0.15 bei +0.5 auf 0
    expect(toneStage([0.15, 0.15, 0.15], p, 1)[0]).toBe(0);
  });
});

describe("tonemap · Auto-Ton unter PV2", () => {
  /** Simuliert den Editor-Fluss: rendern -> Statistik -> Auto-Ton ->
   *  erneut rendern. Gibt Median-Luminanz und Clip-Anteil zurueck. */
  function autoTone(pixels: ReadonlyArray<Rgb>, pv: ProcessVersion, clicks: number) {
    let adj = { ...defaultAdjustments(), processVersion: pv };
    const render = () => {
      const tp = params(adj);
      const rgba = new Uint8Array(pixels.length * 4);
      pixels.forEach((px, i) => {
        const o = toneStage(px, tp, pv);
        rgba[i * 4] = Math.round(o[0] * 255);
        rgba[i * 4 + 1] = Math.round(o[1] * 255);
        rgba[i * 4 + 2] = Math.round(o[2] * 255);
        rgba[i * 4 + 3] = 255;
      });
      return rgba;
    };
    for (let k = 0; k < clicks; k++) {
      const stats = analyzePixels(render());
      expect(stats).not.toBeNull();
      adj = { ...adj, ...computeAutoTone(stats!, adj) };
    }
    const out = render();
    const stats = analyzePixels(out)!;
    let clipped = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i]! >= 255 || out[i + 1]! >= 255 || out[i + 2]! >= 255) clipped++;
    }
    return { median: stats.p500, clip: clipped / (out.length / 4) };
  }

  for (const [name, pixels] of Object.entries(variants(GRADIENT))) {
    for (const clicks of [1, 2]) {
      it(`${name}, ${clicks}x Auto-Ton: kein zusaetzliches Clipping, Mitteltoene +-0.05`, () => {
        const v1 = autoTone(pixels, 1, clicks);
        const v2 = autoTone(pixels, 2, clicks);
        expect(Math.abs(v2.median - v1.median)).toBeLessThanOrEqual(0.05);
        expect(v2.clip).toBeLessThanOrEqual(v1.clip + 0.005);
      });
    }
  }
});

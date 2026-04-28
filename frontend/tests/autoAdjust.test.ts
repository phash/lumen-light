import { describe, expect, it } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { computeAutoTone, computeAutoWb } from "../src/editor/autoAdjust";

const ZERO = defaultAdjustments();

/** Bequemes Builder fuer HistogramStats — `means` werden auch als
 *  trimmedMeans uebernommen, weil die Tests die Quantile-Auswahl nicht
 *  nachstellen muessen. Tests, die explizit den Trimmed-vs-Untrimmed-
 *  Unterschied pruefen wollen, koennen die Felder einzeln setzen. */
function statsOf(o: {
  p005: number;
  p500: number;
  p995: number;
  meanR: number;
  meanG: number;
  meanB: number;
  trimmedMeanR?: number;
  trimmedMeanG?: number;
  trimmedMeanB?: number;
}) {
  return {
    p005: o.p005,
    p500: o.p500,
    p995: o.p995,
    meanR: o.meanR,
    meanG: o.meanG,
    meanB: o.meanB,
    trimmedMeanR: o.trimmedMeanR ?? o.meanR,
    trimmedMeanG: o.trimmedMeanG ?? o.meanG,
    trimmedMeanB: o.trimmedMeanB ?? o.meanB,
  };
}

describe("computeAutoTone", () => {
  it("dunkles Bild -> exposure positiv", () => {
    const stats = statsOf({ p005: 0, p500: 0.15, p995: 0.4, meanR: 0.15, meanG: 0.15, meanB: 0.15 });
    const result = computeAutoTone(stats, ZERO);
    expect(result.exposure).toBeGreaterThan(0.5);
  });

  it("helles Bild -> exposure negativ", () => {
    const stats = statsOf({ p005: 0.3, p500: 0.7, p995: 0.95, meanR: 0.7, meanG: 0.7, meanB: 0.7 });
    const result = computeAutoTone(stats, ZERO);
    expect(result.exposure).toBeLessThan(-0.3);
  });

  it("blasses Bild -> contrast erhoeht", () => {
    const stats = statsOf({ p005: 0.3, p500: 0.5, p995: 0.7, meanR: 0.5, meanG: 0.5, meanB: 0.5 });
    const result = computeAutoTone(stats, ZERO);
    // range = 0.4 < 0.5, also Kontrast-Boost
    expect(result.contrast ?? 0).toBeGreaterThan(0);
  });

  it("ausgereiztes Histogramm -> KEIN contrast-Boost", () => {
    const stats = statsOf({ p005: 0.05, p500: 0.5, p995: 0.95, meanR: 0.5, meanG: 0.5, meanB: 0.5 });
    const result = computeAutoTone(stats, ZERO);
    expect(result.contrast ?? 0).toBe(0);
  });

  it("Werte werden geklemmt + zur Basis addiert", () => {
    const stats = statsOf({ p005: 0, p500: 0.05, p995: 0.5, meanR: 0.05, meanG: 0.05, meanB: 0.05 });
    const result = computeAutoTone(stats, { ...ZERO, exposure: 4.5 });
    expect(result.exposure).toBe(5); // klemmt auf max
  });
});

describe("computeAutoWb", () => {
  it("warmer Bild-Mittelwert (mehr R, weniger B) -> negative Temperatur", () => {
    const stats = statsOf({
      p005: 0, p500: 0.5, p995: 1,
      meanR: 0.6, meanG: 0.5, meanB: 0.4,
    });
    const result = computeAutoWb(stats, ZERO);
    expect(result.temperature ?? 0).toBeLessThan(0);
  });

  it("kuehler Bild-Mittelwert -> positive Temperatur", () => {
    const stats = statsOf({
      p005: 0, p500: 0.5, p995: 1,
      meanR: 0.4, meanG: 0.5, meanB: 0.6,
    });
    const result = computeAutoWb(stats, ZERO);
    expect(result.temperature ?? 0).toBeGreaterThan(0);
  });

  it("balanciert grau (R=G=B) -> keine Korrektur", () => {
    const stats = statsOf({
      p005: 0, p500: 0.5, p995: 1,
      meanR: 0.5, meanG: 0.5, meanB: 0.5,
    });
    const result = computeAutoWb(stats, ZERO);
    expect(result.temperature ?? 0).toBeCloseTo(0, 2);
    expect(result.tint ?? 0).toBeCloseTo(0, 2);
  });

  it("Trimmed-Mean dominiert: R-Highlights werden ignoriert", () => {
    // meanR scheint warm (rote Highlights), aber trimmedMean ist neutral
    // — Auto-WB soll die ehrlichen Mid-Tones nehmen.
    const stats = statsOf({
      p005: 0, p500: 0.5, p995: 1,
      meanR: 0.7, meanG: 0.5, meanB: 0.5,
      trimmedMeanR: 0.5, trimmedMeanG: 0.5, trimmedMeanB: 0.5,
    });
    const result = computeAutoWb(stats, ZERO);
    expect(result.temperature ?? 0).toBeCloseTo(0, 2);
  });
});

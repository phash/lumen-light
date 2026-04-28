import { describe, expect, it } from "vitest";

import {
  ANALYSIS_SIZE,
  MAX_TILT_DEG,
  analyzeStraightenAngle,
} from "../src/editor/autoStraighten";

const N = ANALYSIS_SIZE;

function makeRgba(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < buf.length; i += 4) {
    // Hellgrauer Hintergrund — der Sobel-Filter hat dort keine Kante.
    buf[i] = 200;
    buf[i + 1] = 200;
    buf[i + 2] = 200;
    buf[i + 3] = 255;
  }
  return buf;
}

/** Zieht eine geneigte Linie als helle-zu-dunkle-Kante quer durchs
 *  Bild. Das ist eine echte Stufe (oben hell, unten dunkel) — der
 *  Sobel sieht eine klare Kante exakt entlang der Linie und nicht die
 *  stufigen Aliasing-Kanten einer 1-px-breiten Linie.
 *  tiltDeg positiv = im Uhrzeigersinn (rechts unten gekippt). */
function drawTiltedEdge(buf: Uint8ClampedArray, tiltDeg: number): void {
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const slope = Math.tan(tiltRad);
  for (let x = 0; x < N; x++) {
    const yEdge = N / 2 + slope * (x - N / 2);
    for (let y = 0; y < N; y++) {
      // Anti-Aliasing: 2-Pixel-Uebergang um yEdge.
      const d = y - yEdge;
      let alpha: number;
      if (d <= -1) alpha = 0;
      else if (d >= 1) alpha = 1;
      else alpha = (d + 1) / 2;
      // alpha = 0 -> hellgrau (Hintergrund), alpha = 1 -> schwarz.
      const v = Math.round(200 * (1 - alpha));
      const i = (y * N + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
}

describe("analyzeStraightenAngle", () => {
  it("uniformes Grau -> null (zu wenig Kanten)", () => {
    const buf = makeRgba();
    expect(analyzeStraightenAngle(buf)).toBeNull();
  });

  it("3-Grad-tilted horizon -> Korrektur ~ -3 Grad", () => {
    const buf = makeRgba();
    drawTiltedEdge(buf, 3);
    const r = analyzeStraightenAngle(buf);
    expect(r).not.toBeNull();
    const deg = (r!.angleRad * 180) / Math.PI;
    // Korrektur-Winkel ist negativ vom Tilt.
    expect(deg).toBeGreaterThan(-4);
    expect(deg).toBeLessThan(-2);
  });

  it("-5-Grad-tilted horizon -> Korrektur ~ +5 Grad", () => {
    const buf = makeRgba();
    drawTiltedEdge(buf, -5);
    const r = analyzeStraightenAngle(buf);
    expect(r).not.toBeNull();
    const deg = (r!.angleRad * 180) / Math.PI;
    expect(deg).toBeGreaterThan(4);
    expect(deg).toBeLessThan(6);
  });

  it("perfekte Horizontale -> Korrektur ~0", () => {
    const buf = makeRgba();
    drawTiltedEdge(buf, 0);
    const r = analyzeStraightenAngle(buf);
    expect(r).not.toBeNull();
    const deg = (r!.angleRad * 180) / Math.PI;
    expect(Math.abs(deg)).toBeLessThan(1);
  });

  it("Tilt ausserhalb +/-10 Grad -> Linie wird ignoriert -> null oder schwacher Confidence", () => {
    const buf = makeRgba();
    drawTiltedEdge(buf, 30);
    const r = analyzeStraightenAngle(buf);
    // Entweder kein Result (zu wenig in-Range-Kanten) oder sehr niedrige Confidence.
    if (r !== null) {
      expect(r.confidence).toBeLessThan(0.3);
    }
  });

  it("MAX_TILT_DEG ist 10 (Bin-Konfiguration)", () => {
    expect(MAX_TILT_DEG).toBe(10);
  });
});

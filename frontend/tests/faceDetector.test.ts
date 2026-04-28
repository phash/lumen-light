import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectFacesSafe,
  setFaceDetector,
  type FaceDetector,
} from "../src/editor/faceDetector";

function makeStubDetector(faces = 0): FaceDetector {
  return {
    detect: vi.fn().mockResolvedValue(
      Array.from({ length: faces }, (_, i) => ({
        box: { x: i * 50, y: 0, width: 40, height: 40 },
        score: 0.95,
      })),
    ),
    dispose: vi.fn(),
  };
}

afterEach(() => {
  setFaceDetector(null);
});

describe("faceDetector", () => {
  it("setFaceDetector erlaubt direkte Stub-Injection", async () => {
    const stub = makeStubDetector(2);
    setFaceDetector(stub);
    const fakeCanvas = {} as HTMLCanvasElement;
    const faces = await detectFacesSafe(fakeCanvas);
    expect(faces).toHaveLength(2);
    expect(faces[0]!.score).toBe(0.95);
  });

  it("detectFacesSafe liefert leere Liste bei Detector-Wurf", async () => {
    const failing: FaceDetector = {
      detect: vi.fn().mockRejectedValue(new Error("WebGL nicht verfuegbar")),
      dispose: vi.fn(),
    };
    setFaceDetector(failing);
    const faces = await detectFacesSafe({} as HTMLCanvasElement);
    expect(faces).toEqual([]);
  });

  it("ohne Stub und ohne Browser-WebGL: leere Liste (nicht-werfend)", async () => {
    setFaceDetector(null);
    // In jsdom failt das echte loading deterministisch — wir wollen
    // sicherstellen, dass detectFacesSafe das schluckt.
    const faces = await detectFacesSafe({} as HTMLCanvasElement);
    expect(Array.isArray(faces)).toBe(true);
    expect(faces).toHaveLength(0);
  });
});

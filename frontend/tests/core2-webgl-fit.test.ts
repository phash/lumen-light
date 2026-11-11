import { describe, expect, it } from "vitest";

import { fitWithin, texSourceSize } from "../src/editor/webgl";

describe("fitWithin", () => {
  it("8000x4000 bei max 4096 -> 4096x2048 skaliert", () => {
    expect(fitWithin(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048, scaled: true });
  });

  it("100x50 bleibt unskaliert", () => {
    expect(fitWithin(100, 50, 4096)).toEqual({ width: 100, height: 50, scaled: false });
  });

  it("1x10000 bei max 16 -> Breite mindestens 1", () => {
    const r = fitWithin(1, 10000, 16);
    expect(r.scaled).toBe(true);
    expect(r.height).toBe(16);
    expect(r.width).toBeGreaterThanOrEqual(1);
  });

  it("exakt am Limit bleibt unskaliert", () => {
    expect(fitWithin(4096, 100, 4096).scaled).toBe(false);
  });
});

describe("texSourceSize", () => {
  it("Image nutzt naturalWidth/naturalHeight", () => {
    const img = new Image();
    Object.defineProperty(img, "naturalWidth", { value: 640 });
    Object.defineProperty(img, "naturalHeight", { value: 480 });
    img.width = 10;
    img.height = 10;
    expect(texSourceSize(img)).toEqual({ width: 640, height: 480 });
  });

  it("Canvas nutzt width/height", () => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    expect(texSourceSize(c)).toEqual({ width: 300, height: 200 });
  });

  it("VideoFrame-artige Quelle nutzt displayWidth/displayHeight", () => {
    const frame = { displayWidth: 1920, displayHeight: 1080, width: 1, height: 1 };
    expect(texSourceSize(frame as unknown as VideoFrame)).toEqual({ width: 1920, height: 1080 });
  });
});

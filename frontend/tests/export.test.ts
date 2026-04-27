import { describe, expect, it, vi } from "vitest";

import { exportCanvas, suggestFilename } from "../src/editor/export";

interface FakeCanvasOptions {
  width: number;
  height: number;
  blobOnExport?: Blob;
  toBlobShouldFail?: boolean;
}

function makeFakeCanvas(opts: FakeCanvasOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  // toBlob ueberschreiben — jsdom hat keine echte Implementierung
  canvas.toBlob = (callback, mimeType, quality) => {
    if (opts.toBlobShouldFail) {
      callback(null);
      return;
    }
    const blob = opts.blobOnExport ?? new Blob(["fake"], { type: mimeType ?? "" });
    Object.defineProperty(blob, "type", { value: mimeType ?? "", writable: false });
    Object.defineProperty(blob, "_quality", { value: quality, writable: false });
    callback(blob);
  };
  return canvas;
}

describe("suggestFilename", () => {
  it("ersetzt Endung durch Format-Endung", () => {
    expect(suggestFilename("IMG_0001.jpg", "png")).toBe("IMG_0001.png");
    expect(suggestFilename("foto.tif", "jpeg")).toBe("foto.jpg");
    expect(suggestFilename("a.png", "webp")).toBe("a.webp");
  });

  it("haengt Endung an wenn keine vorhanden", () => {
    expect(suggestFilename("foto", "jpeg")).toBe("foto.jpg");
  });

  it("Fallback wenn leerer Stem", () => {
    expect(suggestFilename(".", "png")).toBe("lumen-export.png");
  });
});

describe("exportCanvas", () => {
  it("exportiert in nativer Aufloesung wenn keine width-Option", async () => {
    const canvas = makeFakeCanvas({ width: 1024, height: 768 });
    const blob = await exportCanvas(canvas, { format: "jpeg" });
    expect(blob.type).toBe("image/jpeg");
  });

  it("uebergibt quality an toBlob", async () => {
    const canvas = makeFakeCanvas({ width: 100, height: 100 });
    const blob = await exportCanvas(canvas, { format: "jpeg", quality: 0.5 });
    expect((blob as unknown as { _quality: number })._quality).toBe(0.5);
  });

  it("mappt Format auf MIME-Type", async () => {
    const canvas = makeFakeCanvas({ width: 100, height: 100 });
    expect((await exportCanvas(canvas, { format: "png" })).type).toBe("image/png");
    expect((await exportCanvas(canvas, { format: "webp" })).type).toBe("image/webp");
  });

  it("wirft wenn toBlob null liefert", async () => {
    const canvas = makeFakeCanvas({
      width: 100,
      height: 100,
      toBlobShouldFail: true,
    });
    await expect(exportCanvas(canvas, { format: "jpeg" })).rejects.toThrow(/toBlob/);
  });

  it("wirft bei width <= 0", async () => {
    const canvas = makeFakeCanvas({ width: 100, height: 100 });
    await expect(
      exportCanvas(canvas, { format: "jpeg", width: 0 }),
    ).rejects.toThrow(/Breite/);
  });

  it("skaliert auf Ziel-Breite (Off-Screen-Canvas)", async () => {
    const canvas = makeFakeCanvas({ width: 1600, height: 900 });
    // CanvasRenderingContext2D existiert in jsdom nicht echt; wir mocken
    // createElement('canvas') temporaer.
    const realCreate = document.createElement.bind(document);
    const offCanvas = makeFakeCanvas({ width: 800, height: 0 });
    let drawnSource: unknown = null;
    const mockCtx = {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      drawImage: (src: unknown) => {
        drawnSource = src;
      },
    };
    offCanvas.getContext = (() => mockCtx) as unknown as typeof offCanvas.getContext;

    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementationOnce((tag: string) => {
        if (tag === "canvas") return offCanvas;
        return realCreate(tag);
      });

    const blob = await exportCanvas(canvas, { format: "png", width: 800 });
    expect(blob.type).toBe("image/png");
    expect(offCanvas.width).toBe(800);
    expect(offCanvas.height).toBe(450);  // 900 * (800 / 1600)
    expect(drawnSource).toBe(canvas);
    spy.mockRestore();
  });
});

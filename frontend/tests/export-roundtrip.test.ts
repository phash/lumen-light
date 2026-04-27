/**
 * Roundtrip-Verifikation von exportCanvas: pro Format pruefen, dass die
 * Output-Bytes mit dem korrekten Magic-Byte-Header beginnen. jsdom hat
 * keinen echten Canvas-2D-Renderer — wir testen daher nur den nativen
 * Pfad (kein Resize), die Resize-Variante ist in export.test.ts via
 * Mock-Canvas abgedeckt.
 */
import { describe, expect, it } from "vitest";

import { exportCanvas, type ExportFormat } from "../src/editor/export";

const FORMAT_MAGIC: Record<ExportFormat, Uint8Array> = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  webp: new Uint8Array([0x52, 0x49, 0x46, 0x46]),  // RIFF
};

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.toBlob = (callback, mimeType) => {
    const fmt: ExportFormat =
      mimeType === "image/jpeg" ? "jpeg" :
      mimeType === "image/png" ? "png" :
      mimeType === "image/webp" ? "webp" : "jpeg";
    const magic = FORMAT_MAGIC[fmt];
    const payload = new Uint8Array(magic.length + 16);
    payload.set(magic);
    callback(new Blob([payload], { type: mimeType ?? "" }));
  };
  return canvas;
}

async function magicBytes(blob: Blob, n: number): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf.slice(0, n));
}

describe("Export-Roundtrip · Magic-Bytes pro Format", () => {
  const formats: ExportFormat[] = ["jpeg", "png", "webp"];

  for (const fmt of formats) {
    it(`${fmt} liefert korrekten Header`, async () => {
      const canvas = makeCanvas(2048, 1365);
      const blob = await exportCanvas(canvas, { format: fmt });
      const expectedMime =
        fmt === "jpeg" ? "image/jpeg" :
        fmt === "png" ? "image/png" : "image/webp";
      expect(blob.type).toBe(expectedMime);
      const head = await magicBytes(blob, FORMAT_MAGIC[fmt].length);
      expect(Array.from(head)).toEqual(Array.from(FORMAT_MAGIC[fmt]));
    });
  }

  it("JPEG bei verschiedenen Quality-Werten liefert weiterhin gueltigen JPEG-Header", async () => {
    const canvas = makeCanvas(800, 600);
    for (const q of [0.5, 0.75, 0.92, 1.0]) {
      const blob = await exportCanvas(canvas, { format: "jpeg", quality: q });
      const head = await magicBytes(blob, 3);
      expect(Array.from(head)).toEqual([0xff, 0xd8, 0xff]);
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disposeSpy = vi.fn();
let thumb: unknown = undefined;
let meta: unknown = { flip: 6 };
let failOpen = false;

vi.mock("libraw-wasm", () => ({
  default: class {
    open() {
      return failOpen ? Promise.reject(new Error("kaputt")) : Promise.resolve();
    }
    metadata() {
      return Promise.resolve(meta);
    }
    thumbnailData() {
      return Promise.resolve(thumb);
    }
    dispose() {
      disposeSpy();
    }
  },
}));

import { extractRawThumbnail } from "../src/editor/raw";
import { thumbnailFromFile } from "../src/editor/thumbnail";

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

const createImageBitmapMock = vi.fn<(src: unknown, opts?: ImageBitmapOptions) => Promise<FakeBitmap>>();

function rawFile(): File {
  return new File([new Uint8Array(16)], "x.nef");
}

function fakeCanvasPipeline() {
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
  });
  return ctx;
}

describe("extractRawThumbnail (libraw-wasm thumbnailData)", () => {
  beforeEach(() => {
    disposeSpy.mockClear();
    createImageBitmapMock.mockReset();
    createImageBitmapMock.mockImplementation(() =>
      Promise.resolve({ width: 160, height: 120, close: vi.fn() }),
    );
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    failOpen = false;
    meta = { flip: 6 };
    thumb = { data: new Uint8Array([0xff, 0xd8, 0xff]), width: 160, height: 120, format: "jpeg" };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("eingebettetes JPEG wird ohne EXIF-Drehung dekodiert, flip kommt aus LibRaw", async () => {
    const out = await extractRawThumbnail(rawFile());
    expect(out?.flip).toBe(6);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    const [src, opts] = createImageBitmapMock.mock.calls[0]!;
    expect(src).toBeInstanceOf(Blob);
    expect((src as Blob).type).toBe("image/jpeg");
    expect(opts).toEqual({ imageOrientation: "none" });
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("ohne eingebettete Vorschau liefert es null", async () => {
    thumb = undefined;
    expect(await extractRawThumbnail(rawFile())).toBeNull();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("unbekanntes Vorschau-Format liefert null", async () => {
    thumb = { data: new Uint8Array(3), width: 1, height: 1, format: "unknown" };
    expect(await extractRawThumbnail(rawFile())).toBeNull();
  });

  it("kaputte Datei liefert null und gibt den Worker frei", async () => {
    failOpen = true;
    expect(await extractRawThumbnail(rawFile())).toBeNull();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("thumbnailFromFile dreht RAW-Vorschau nach flip und schliesst die Bitmap", async () => {
    const close = vi.fn();
    createImageBitmapMock.mockResolvedValue({ width: 1600, height: 1200, close });
    const ctx = fakeCanvasPipeline();
    const blob = await thumbnailFromFile(rawFile());
    expect(blob?.type).toBe("image/jpeg");
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(close).toHaveBeenCalled();
  });

  it("thumbnailFromFile nutzt fuer JPEG die EXIF-Orientierung", async () => {
    const close = vi.fn();
    createImageBitmapMock.mockResolvedValue({ width: 3200, height: 2400, close });
    const ctx = fakeCanvasPipeline();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.jpg", {
      type: "image/jpeg",
    });
    const blob = await thumbnailFromFile(file);
    expect(blob).not.toBeNull();
    expect(createImageBitmapMock).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -800, -600, 1600, 1200);
    expect(close).toHaveBeenCalled();
  });

  it("thumbnailFromFile liefert fuer TIFF null (Platzhalter)", async () => {
    const file = new File([new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])], "a.tif", {
      type: "image/tiff",
    });
    expect(await thumbnailFromFile(file)).toBeNull();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });
});

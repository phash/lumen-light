/**
 * H1b · Upload der 16-bit-Quelle: Half-Float (RGB16F) mit Rueckfall auf
 * RGB8, wenn der Grafikspeicher nicht reicht. Fake-GL, jsdom hat kein WebGL.
 */
import { describe, expect, it } from "vitest";

import { floatToHalfBits } from "../src/editor/float16";
import type { Rgb16Image } from "../src/editor/rawPixels";
import { type Rgb16UploadGl, uploadRgb16Texture } from "../src/editor/webgl";

const C = {
  NO_ERROR: 0,
  OUT_OF_MEMORY: 0x0505,
  TEXTURE_2D: 0x0de1,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  CLAMP_TO_EDGE: 0x812f,
  LINEAR: 0x2601,
  UNPACK_ALIGNMENT: 0x0cf5,
  RGB: 0x1907,
  RGB8: 0x8051,
  RGB16F: 0x881b,
  HALF_FLOAT: 0x140b,
  UNSIGNED_BYTE: 0x1401,
} as const;

interface Upload {
  readonly y: number;
  readonly rows: number;
  readonly type: number;
  readonly data: number[];
}

class FakeGl {
  readonly NO_ERROR = C.NO_ERROR;
  readonly TEXTURE_2D = C.TEXTURE_2D;
  readonly TEXTURE_WRAP_S = C.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = C.TEXTURE_WRAP_T;
  readonly TEXTURE_MIN_FILTER = C.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = C.TEXTURE_MAG_FILTER;
  readonly CLAMP_TO_EDGE = C.CLAMP_TO_EDGE;
  readonly LINEAR = C.LINEAR;
  readonly UNPACK_ALIGNMENT = C.UNPACK_ALIGNMENT;
  readonly RGB = C.RGB;
  readonly RGB8 = C.RGB8;
  readonly RGB16F = C.RGB16F;
  readonly HALF_FLOAT = C.HALF_FLOAT;
  readonly UNSIGNED_BYTE = C.UNSIGNED_BYTE;

  failHalf = false;
  failAll = false;
  throwOnHalf = false;
  pendingErrors: number[] = [];
  readonly storage: Array<{ format: number; w: number; h: number }> = [];
  readonly uploads: Upload[] = [];
  readonly created: object[] = [];
  readonly deleted: object[] = [];
  readonly alignment: number[] = [];

  createTexture(): WebGLTexture {
    const t = {};
    this.created.push(t);
    return t;
  }
  deleteTexture(t: WebGLTexture | null): void {
    if (t) this.deleted.push(t);
  }
  bindTexture(): void {}
  texParameteri(): void {}
  pixelStorei(pname: number, value: number): void {
    if (pname === C.UNPACK_ALIGNMENT) this.alignment.push(value);
  }
  texStorage2D(_t: number, _l: number, format: number, w: number, h: number): void {
    if (format === C.RGB16F && this.throwOnHalf) throw new Error("boom");
    if (this.failAll || (format === C.RGB16F && this.failHalf)) {
      this.pendingErrors.push(C.OUT_OF_MEMORY);
      return;
    }
    this.storage.push({ format, w, h });
  }
  texSubImage2D(
    _t: number,
    _l: number,
    _x: number,
    y: number,
    _w: number,
    rows: number,
    _f: number,
    type: number,
    data: ArrayBufferView | null,
  ): void {
    const arr = data as Uint16Array | Uint8Array;
    this.uploads.push({ y, rows, type, data: Array.from(arr) });
  }
  getError(): number {
    return this.pendingErrors.shift() ?? C.NO_ERROR;
  }
}

function img(width: number, height: number): Rgb16Image {
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 4099) % 65536;
  return { kind: "rgb16", data, width, height };
}

function asGl(gl: FakeGl): Rgb16UploadGl {
  return gl as unknown as Rgb16UploadGl;
}

describe("uploadRgb16Texture", () => {
  it("laedt als RGB16F mit Half-Bits in Streifen", () => {
    const gl = new FakeGl();
    const src = img(3, 5);
    const res = uploadRgb16Texture(asGl(gl), src, { preferHalf: true, stripeRows: 2 });
    expect(res.precision).toBe("float16");
    expect(gl.storage).toEqual([{ format: C.RGB16F, w: 3, h: 5 }]);
    expect(gl.uploads.map((u) => [u.y, u.rows])).toEqual([[0, 2], [2, 2], [4, 1]]);
    expect(gl.uploads.every((u) => u.type === C.HALF_FLOAT)).toBe(true);
    const all = gl.uploads.flatMap((u) => u.data);
    expect(all).toEqual(Array.from(src.data, (v) => floatToHalfBits(v / 65535)));
    // Alignment fuer 6-Byte-Zeilen auf 1, danach wieder Standard 4
    expect(gl.alignment).toEqual([1, 4]);
  });

  it("OUT_OF_MEMORY beim Half-Upload -> RGB8 mit oberem Byte", () => {
    const gl = new FakeGl();
    gl.failHalf = true;
    const src = img(2, 2);
    const res = uploadRgb16Texture(asGl(gl), src, { preferHalf: true });
    expect(res.precision).toBe("8bit");
    expect(gl.storage).toEqual([{ format: C.RGB8, w: 2, h: 2 }]);
    expect(gl.uploads.flatMap((u) => u.data)).toEqual(Array.from(src.data, (v) => v >> 8));
    // die gescheiterte Half-Textur wurde freigegeben
    expect(gl.deleted).toEqual([gl.created[0]]);
    expect(res.texture).toBe(gl.created[1]);
  });

  it("Exception beim Half-Upload -> RGB8", () => {
    const gl = new FakeGl();
    gl.throwOnHalf = true;
    const res = uploadRgb16Texture(asGl(gl), img(2, 1), { preferHalf: true });
    expect(res.precision).toBe("8bit");
    expect(gl.alignment.at(-1)).toBe(4);
  });

  it("preferHalf=false laedt direkt RGB8", () => {
    const gl = new FakeGl();
    const res = uploadRgb16Texture(asGl(gl), img(2, 1), { preferHalf: false });
    expect(res.precision).toBe("8bit");
    expect(gl.storage.map((s) => s.format)).toEqual([C.RGB8]);
  });

  it("alte GL-Fehler blockieren den Upload nicht", () => {
    const gl = new FakeGl();
    gl.pendingErrors.push(0x0500);
    const res = uploadRgb16Texture(asGl(gl), img(1, 1), { preferHalf: true });
    expect(res.precision).toBe("float16");
  });

  it("wirft, wenn auch RGB8 scheitert, und gibt beide Texturen frei", () => {
    const gl = new FakeGl();
    gl.failAll = true;
    expect(() => uploadRgb16Texture(asGl(gl), img(1, 1), { preferHalf: true })).toThrow(
      /Grafikspeicher/,
    );
    expect(gl.deleted).toHaveLength(2);
  });
});

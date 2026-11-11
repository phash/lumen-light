/**
 * H1b: 16-bit-RGB-Quelle (libraw `outputBps: 16`) und reine Helfer dafuer.
 * Werte sind sRGB-kodiert wie die 8-bit-Ausgabe (8 bit = 16 bit >> 8),
 * Shader-Semantik bleibt v / 65535.
 */

/** Dekodiertes 16-bit-RGB-Bild, width × height × 3 Werte (kein Alpha). */
export interface Rgb16Image {
  readonly kind: "rgb16";
  readonly data: Uint16Array;
  readonly width: number;
  readonly height: number;
}

export function isRgb16Image(value: unknown): value is Rgb16Image {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "rgb16" &&
    (value as { data?: unknown }).data instanceof Uint16Array
  );
}

/** Unter dieser `navigator.deviceMemory`-Angabe (GB) dekodieren wir 8 bit. */
export const MIN_DEVICE_MEMORY_GB_FOR_16BIT = 4;

/**
 * Bit-Tiefe fuer die RAW-Dekodierung. `deviceMemory` gibt es nur in
 * Chromium (gerundet, max. 8); fehlt die Angabe, wird 16 bit versucht —
 * scheitert der GPU-Upload, faellt der Renderer selbst auf 8 bit zurueck.
 */
export function chooseRawBitDepth(nav: object | undefined): 8 | 16 {
  // deviceMemory fehlt in lib.dom -> generisch lesen.
  const mem = nav && "deviceMemory" in nav ? nav.deviceMemory : undefined;
  if (typeof mem === "number" && mem < MIN_DEVICE_MEMORY_GB_FOR_16BIT) return 8;
  return 16;
}

/** 8-bit-Ableitung (oberes Byte) — identisch zur libraw-8-bit-Ausgabe. */
export function rgb16ToRgb8(
  src: Uint16Array,
  dst: Uint8Array = new Uint8Array(src.length),
): Uint8Array {
  const n = src.length;
  for (let i = 0; i < n; i++) dst[i] = src[i]! >> 8;
  return dst;
}

/** Pro Zielindex: erster Quellindex, Anzahl, Gewichte (Summe = 1). */
interface AxisWeights {
  readonly start: Int32Array;
  readonly count: Int32Array;
  readonly offset: Int32Array;
  readonly weights: Float32Array;
}

/** Flaechen-Gewichte einer Achse: Zielpixel i deckt [i·s, (i+1)·s) ab. */
function axisWeights(srcLen: number, dstLen: number): AxisWeights {
  const scale = srcLen / dstLen;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const offset = new Int32Array(dstLen);
  const weights: number[] = [];
  for (let i = 0; i < dstLen; i++) {
    const a = i * scale;
    const b = Math.min((i + 1) * scale, srcLen);
    const i0 = Math.floor(a);
    const i1 = Math.min(Math.ceil(b), srcLen);
    start[i] = i0;
    count[i] = i1 - i0;
    offset[i] = weights.length;
    for (let j = i0; j < i1; j++) {
      const cover = Math.min(j + 1, b) - Math.max(j, a);
      weights.push(cover / scale);
    }
  }
  return { start, count, offset, weights: Float32Array.from(weights) };
}

/**
 * Flaechen-Box-Verkleinerung (exakte Bruchteil-Gewichte) fuer die
 * Live-Vorschau. Separabel: jede Quellzeile wird horizontal reduziert
 * (Randzeilen gecacht, da sie zu zwei Zielzeilen gehoeren) und gewichtet
 * in die Zielzeile akkumuliert.
 */
export function boxDownscaleRgb16(
  src: Rgb16Image,
  targetWidth: number,
  targetHeight: number,
): Rgb16Image {
  const { width: w, height: h, data } = src;
  if (
    targetWidth < 1 ||
    targetHeight < 1 ||
    targetWidth > w ||
    targetHeight > h ||
    !Number.isInteger(targetWidth) ||
    !Number.isInteger(targetHeight)
  ) {
    throw new RangeError(
      `Ungueltige Zielgroesse ${targetWidth}x${targetHeight} fuer ${w}x${h}`,
    );
  }
  const tw = targetWidth;
  const th = targetHeight;
  const xs = axisWeights(w, tw);
  const ys = axisWeights(h, th);
  const out = new Uint16Array(tw * th * 3);
  const acc = new Float32Array(tw * 3);
  let rowA = new Float32Array(tw * 3);
  let rowB = new Float32Array(tw * 3);
  let cachedRow = -1;

  // Lokale Referenzen: haelt die heisse Schleife frei von Property-Loads.
  const xStart = xs.start;
  const xCount = xs.count;
  const xOffset = xs.offset;
  const xWeights = xs.weights;
  const reduceRow = (sy: number, target: Float32Array): void => {
    const base = sy * w * 3;
    for (let ox = 0, o = 0; ox < tw; ox++, o += 3) {
      const wo = xOffset[ox]!;
      const end = wo + xCount[ox]!;
      let i = base + xStart[ox]! * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = wo; k < end; k++, i += 3) {
        const wt = xWeights[k]!;
        r += data[i]! * wt;
        g += data[i + 1]! * wt;
        b += data[i + 2]! * wt;
      }
      target[o] = r;
      target[o + 1] = g;
      target[o + 2] = b;
    }
  };

  for (let oy = 0; oy < th; oy++) {
    acc.fill(0);
    const y0 = ys.start[oy]!;
    const n = ys.count[oy]!;
    const wo = ys.offset[oy]!;
    for (let k = 0; k < n; k++) {
      const sy = y0 + k;
      let row: Float32Array;
      if (sy === cachedRow) {
        row = rowA;
      } else {
        reduceRow(sy, rowB);
        // Zuletzt reduzierte Zeile merken (Randzeile der naechsten Zielzeile).
        const t = rowA;
        rowA = rowB;
        rowB = t;
        cachedRow = sy;
        row = rowA;
      }
      const wt = ys.weights[wo + k]!;
      for (let i = 0; i < acc.length; i++) acc[i] = acc[i]! + row[i]! * wt;
    }
    const o = oy * tw * 3;
    for (let i = 0; i < acc.length; i++) {
      const v = Math.round(acc[i]!);
      out[o + i] = v < 0 ? 0 : v > 65535 ? 65535 : v;
    }
  }
  return { kind: "rgb16", data: out, width: tw, height: th };
}

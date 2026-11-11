/**
 * H1b: IEEE-754 binary16 (Half-Float) fuer die RGB16F-Quelltextur.
 *
 * WebGL2 nimmt Half-Float-Daten als Uint16Array mit den rohen Half-Bits
 * (type HALF_FLOAT). libraw liefert unorm16 (0..65535); die Abbildung
 * v / 65535 -> Half laeuft ueber eine 64k-LUT (einmal gebaut, 128 KB).
 */

/** Rundet auf die naechste ganze Zahl, bei exakt .5 auf die gerade. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * Double -> Half-Bits, korrekt gerundet (round-to-nearest-even) direkt aus
 * dem Double (kein Umweg ueber Float32, also keine Doppelrundung).
 */
export function floatToHalfBits(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const x = Math.abs(value);
  if (x === 0) return sign;
  if (x === Infinity) return sign | 0x7c00;
  if (x < 2 ** -14) {
    // Subnormal: Einheit 2^-24. Rundet ggf. auf 0x0400 (kleinste Normale).
    return sign | roundHalfEven(x * 2 ** 24);
  }
  let e = Math.floor(Math.log2(x));
  // log2 kann um eine Stelle daneben liegen -> korrigieren.
  let m = x / 2 ** e;
  if (m >= 2) {
    e += 1;
    m /= 2;
  } else if (m < 1) {
    e -= 1;
    m *= 2;
  }
  let frac = roundHalfEven((m - 1) * 1024);
  if (frac === 1024) {
    frac = 0;
    e += 1;
  }
  if (e > 15) return sign | 0x7c00;
  return sign | ((e + 15) << 10) | frac;
}

/** Half-Bits -> Zahl (fuer Tests und Analysen). */
export function halfBitsToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac ? Number.NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

let lutCache: Uint16Array | null = null;

/** LUT unorm16 -> Half-Bits von v / 65535. Wird beim ersten Aufruf gebaut. */
export function unorm16HalfLut(): Uint16Array {
  if (!lutCache) {
    const lut = new Uint16Array(65536);
    for (let i = 0; i < 65536; i++) lut[i] = floatToHalfBits(i / 65535);
    lutCache = lut;
  }
  return lutCache;
}

/**
 * Wandelt unorm16-Werte in Half-Bits. `dst` darf `src` sein (an Ort und
 * Stelle). Ohne `dst` wird ein neuer Puffer angelegt.
 */
export function unorm16ToHalf(
  src: Uint16Array,
  dst: Uint16Array = new Uint16Array(src.length),
): Uint16Array {
  if (dst.length < src.length) {
    throw new RangeError(`Zielpuffer zu klein (${dst.length} < ${src.length})`);
  }
  const lut = unorm16HalfLut();
  const n = src.length;
  for (let i = 0; i < n; i++) dst[i] = lut[src[i]!]!;
  return dst;
}

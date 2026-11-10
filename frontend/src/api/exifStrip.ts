/**
 * EXIF-Strip fuer JPEG-Dateien (DSGVO Art. 5 Datenminimierung).
 *
 * JPEG-Aufbau:
 *   FFD8  (SOI)
 *   FFXX [len-MSB] [len-LSB] [data...]   - APPx-Segmente mit EXIF/IPTC/etc.
 *   FFDB ...                             - Quantization-Tables
 *   FFC0/FFC2 ...                        - Frame-Header
 *   FFC4 ...                             - Huffman
 *   FFDA [len] [data]                    - Start of Scan, danach roher
 *                                          Bilddaten-Stream bis FFD9
 *   FFD9  (EOI)
 *
 * EXIF lebt im APP1-Segment (FFE1), GPS dort als IFD. Wir entfernen
 * APP1 bis APP13 und APP15 (EXIF, XMP/ICC, Herstellerdaten, IPTC mit
 * Autor/Ort) sowie Kommentare (COM, FFFE) komplett. APP0 (JFIF, FFE0)
 * und APP14 (Adobe, FFEE — Farbtransformation fuer CMYK/YCCK) bleiben —
 * keine PII, aber fuer korrektes Decoding noetig.
 *
 * Ausnahme Orientation: Handyfotos im Hochformat speichern die Pixel
 * quer und setzen nur das EXIF-Tag Orientation (0x0112). Ohne das Tag
 * stuende das Bild nach dem Strip auf der Seite. Hatte das Original eine
 * Orientation != 1, schreiben wir an Stelle des ersten Exif-APP1 ein neues,
 * minimales APP1 mit genau einem IFD0-Eintrag (Orientation) — Byte-Order
 * (II/MM) wie im Original, sonst nichts (kein GPS, kein Make, keine
 * Thumbnails).
 *
 * Das ist nur Client-seitige Datenminimierung: das Backend erzeugt fuer
 * oeffentliche Marketplace-Vorschauen ohnehin ein eigenes, neu
 * kodiertes JPEG ohne Metadaten.
 *
 * Andere Formate: PNG/RAW unveraendert zurueckgegeben. PNG kann EXIF
 * in eXIf-Chunks haben, ist aber selten. RAW-EXIF zu strippen ist
 * herstellerspezifisch — out of scope.
 */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === JPEG_MAGIC[0] &&
    bytes[1] === JPEG_MAGIC[1] &&
    bytes[2] === JPEG_MAGIC[2]
  );
}

/** APP1..APP13, APP15 und COM tragen potentiell personenbezogene Daten. */
function isMetadataMarker(marker: number): boolean {
  if (marker === 0xfe) return true;
  return marker >= 0xe1 && marker <= 0xef && marker !== 0xee;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const TAG_ORIENTATION = 0x0112;
const TYPE_SHORT = 3;

/**
 * Liest das Orientation-Tag aus IFD0 eines Exif-APP1-Payloads (ab "Exif").
 * Liefert Byte-Order + Wert (2..8) oder null (kein Exif, kaputt, 1, ungueltig).
 */
export function readExifOrientation(
  payload: Uint8Array,
): { littleEndian: boolean; orientation: number } | null {
  if (payload.length < EXIF_HEADER.length + 8) return null;
  for (let k = 0; k < EXIF_HEADER.length; k++) {
    if (payload[k] !== EXIF_HEADER[k]) return null;
  }
  const t = EXIF_HEADER.length;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const b0 = payload[t];
  const b1 = payload[t + 1];
  let le: boolean;
  if (b0 === 0x49 && b1 === 0x49) le = true;
  else if (b0 === 0x4d && b1 === 0x4d) le = false;
  else return null;
  if (dv.getUint16(t + 2, le) !== 42) return null;
  const ifd0 = t + dv.getUint32(t + 4, le);
  if (ifd0 + 2 > payload.length) return null;
  const count = dv.getUint16(ifd0, le);
  for (let k = 0; k < count; k++) {
    const off = ifd0 + 2 + k * 12;
    if (off + 12 > payload.length) return null;
    if (dv.getUint16(off, le) !== TAG_ORIENTATION) continue;
    if (dv.getUint16(off + 2, le) !== TYPE_SHORT || dv.getUint32(off + 4, le) < 1) {
      return null;
    }
    const value = dv.getUint16(off + 8, le);
    return value >= 2 && value <= 8 ? { littleEndian: le, orientation: value } : null;
  }
  return null;
}

/** Komplettes APP1-Segment (FFE1 + Laenge + Exif + TIFF mit einem
 *  IFD0-Eintrag Orientation). */
export function buildOrientationApp1(littleEndian: boolean, orientation: number): Uint8Array {
  // TIFF: Header(8) + Count(2) + 1 Eintrag(12) + Next-IFD(4) = 26 Byte.
  const tiffLen = 26;
  const payloadLen = EXIF_HEADER.length + tiffLen;
  const seg = new Uint8Array(4 + payloadLen);
  const dv = new DataView(seg.buffer);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  dv.setUint16(2, payloadLen + 2, false); // JPEG-Laengen sind immer Big-Endian
  seg.set(EXIF_HEADER, 4);
  const t = 4 + EXIF_HEADER.length;
  const le = littleEndian;
  seg[t] = le ? 0x49 : 0x4d;
  seg[t + 1] = le ? 0x49 : 0x4d;
  dv.setUint16(t + 2, 42, le);
  dv.setUint32(t + 4, 8, le); // IFD0 direkt nach dem Header
  dv.setUint16(t + 8, 1, le); // ein Eintrag
  dv.setUint16(t + 10, TAG_ORIENTATION, le);
  dv.setUint16(t + 12, TYPE_SHORT, le);
  dv.setUint32(t + 14, 1, le);
  dv.setUint16(t + 18, orientation, le); // Wert linksbuendig, 2 Byte Padding = 0
  dv.setUint32(t + 22, 0, le); // kein IFD1 (Thumbnail)
  return seg;
}

/**
 * Entfernt Metadaten-Segmente (siehe isMetadataMarker) aus einer
 * JPEG-Byte-Sequenz.
 * Liefert die gestripte Sequenz; bei Nicht-JPEG oder ungueltiger
 * Struktur unveraendert.
 */
export function stripJpegExifBytes(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) return input;

  const n = input.length;
  const out: number[] = [];
  let orientationWritten = false;
  let i = 0;
  while (i < n) {
    const b = input[i]!;
    if (b !== 0xff) {
      // Defensive: ausserhalb des Image-Streams sollte hier immer 0xFF stehen.
      out.push(b);
      i++;
      continue;
    }
    // Fill-Bytes: beliebig viele aufeinanderfolgende 0xFF vor einem Marker
    // sind laut JPEG-Spec legal. Marker ist das erste Nicht-0xFF danach.
    let j = i + 1;
    while (j < n && input[j] === 0xff) j++;
    if (j >= n) {
      // Trailing 0xFF ohne Marker — Rest unveraendert durchreichen.
      for (let k = i; k < n; k++) out.push(input[k]!);
      break;
    }
    const marker = input[j]!;

    // Marker ohne Length-Field: SOI(D8), EOI(D9), TEM(01), RSTn(D0..D7).
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      for (let k = i; k <= j; k++) out.push(input[k]!); // Fill + Marker
      i = j + 1;
      continue;
    }

    // Ab hier Length-Field-Marker: 2 Length-Bytes bei j+1,j+2 noetig.
    // Bei truncated/malformed Struktur lieber NICHTS strippen und das
    // Original unveraendert zurueckgeben, statt korrupte Bytes zu erzeugen.
    if (j + 2 >= n) return input;
    const length = (input[j + 1]! << 8) | input[j + 2]!;
    if (length < 2) return input;
    const segEnd = j + 1 + length; // exklusiv: Marker(j) + Length + Data
    if (segEnd > n) return input;

    if (marker === 0xda) {
      // SOS — Header durchreichen, danach roher Image-Stream bis EOI 1:1.
      for (let k = i; k < n; k++) out.push(input[k]!);
      break;
    }
    if (isMetadataMarker(marker)) {
      // Erstes Exif-APP1 mit Orientation != 1 -> durch minimales APP1 ersetzen.
      if (marker === 0xe1 && !orientationWritten) {
        const o = readExifOrientation(input.subarray(j + 3, segEnd));
        if (o) {
          for (const b of buildOrientationApp1(o.littleEndian, o.orientation)) out.push(b);
          orientationWritten = true;
        }
      }
      // Metadaten-Segment inkl. evtl. Fill davor ueberspringen.
      i = segEnd;
      continue;
    }
    // Anderes Segment: Fill + Marker + Length + Data durchreichen.
    for (let k = i; k < segEnd; k++) out.push(input[k]!);
    i = segEnd;
  }
  return new Uint8Array(out);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

export async function stripExifIfJpeg(file: File): Promise<File> {
  if (!file.type.includes("jpeg") && !file.name.toLowerCase().match(/\.jpe?g$/)) {
    return file;
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const stripped = stripJpegExifBytes(bytes);
  if (stripped === bytes || sameBytes(stripped, bytes)) {
    // No-op (z.B. Datei hatte gar keine EXIF) — gib das Original
    // zurueck, damit kein neues Blob-Objekt entsteht.
    return file;
  }
  return new File([new Uint8Array(stripped)], file.name, {
    type: file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}

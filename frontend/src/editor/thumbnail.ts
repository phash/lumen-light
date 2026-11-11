/**
 * H2a: Vorschaubilder pro Bild.
 *
 * Der Browser erzeugt das Vorschaubild (er kennt RAW und die Bearbeitung),
 * der Server kodiert es neu (400/1600 px, ohne Metadaten). Dieses Modul
 * enthaelt die reinen Rechen-/Zeichenfunktionen, die Erzeugung aus einer
 * Datei (Bibliotheks-Upload) und die Drosselung fuer den Editor.
 */
import { extractRawThumbnail, isRawFile } from "./raw";

/** Lange Kante des hochgeladenen Vorschaubildes (= groesste Server-Stufe). */
export const THUMBNAIL_MAX_EDGE = 1600;
export const THUMBNAIL_QUALITY = 0.85;
/** Server-Grenze fuer den Upload (THUMB_UPLOAD_MAX_BYTES im Backend). */
export const THUMBNAIL_MAX_BYTES = 1_000_000;
/** Editor: hoechstens ein Upload pro Bild in diesem Abstand. */
export const THUMBNAIL_UPLOAD_INTERVAL_MS = 10_000;

/** Qualitaetsstufen, falls ein JPEG die Server-Grenze reisst (sehr
 *  detailreiche/verrauschte Bilder). */
const QUALITY_STEPS = [THUMBNAIL_QUALITY, 0.7, 0.5] as const;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Verkleinert auf maxEdge lange Kante, Seitenverhaeltnis bleibt, kein
 *  Hochskalieren. Mindestens 1 px je Achse. */
export function fitLongEdge(width: number, height: number, maxEdge: number): Size {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type Rotation = 0 | 90 | 180 | 270;

/** LibRaw-`flip` (0 = keine, 3 = 180°, 5 = 90° gegen, 6 = 90° im
 *  Uhrzeigersinn) -> Drehung im Uhrzeigersinn. Unbekannte Werte: keine. */
export function flipToRotation(flip: number): Rotation {
  switch (flip) {
    case 3:
      return 180;
    case 5:
      return 270;
    case 6:
      return 90;
    default:
      return 0;
  }
}

/** Zielgroesse nach Drehung + Verkleinerung. */
export function thumbnailSize(
  width: number,
  height: number,
  rotation: Rotation = 0,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Size {
  const swap = rotation === 90 || rotation === 270;
  return fitLongEdge(swap ? height : width, swap ? width : height, maxEdge);
}

/** Zeichnet die Quelle gedreht und verkleinert in ein neues 2D-Canvas. */
export function drawThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
  rotation: Rotation = 0,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): HTMLCanvasElement {
  const target = thumbnailSize(width, height, rotation, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kein 2D-Kontext für das Vorschaubild");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const swap = rotation === 90 || rotation === 270;
  // Gezeichnete Groesse vor der Drehung (bei 90/270 vertauscht).
  const dw = swap ? target.height : target.width;
  const dh = swap ? target.width : target.height;
  ctx.translate(target.width / 2, target.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    // toBlob kodiert asynchron (blockiert den UI-Thread nicht).
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

/** Canvas -> JPEG unter THUMBNAIL_MAX_BYTES; null, wenn das nicht
 *  gelingt (oder der Browser nicht kodieren kann). */
export async function encodeThumbnail(canvas: HTMLCanvasElement): Promise<Blob | null> {
  for (const q of QUALITY_STEPS) {
    const blob = await canvasToJpeg(canvas, q);
    if (!blob) return null;
    if (blob.size <= THUMBNAIL_MAX_BYTES) return blob;
  }
  return null;
}

/**
 * Vorschaubild direkt nach dem Bibliotheks-Upload:
 * - JPEG/PNG: per createImageBitmap (EXIF-Orientierung angewendet).
 * - RAW: eingebettete Vorschau via libraw-wasm (`thumbnailData()`), gedreht
 *   nach LibRaw-`flip`. Ohne eingebettete Vorschau -> null.
 * - TIFF u.a.: null (Platzhalter; Backfill/Editor liefern spaeter eine).
 */
export async function thumbnailFromFile(file: File): Promise<Blob | null> {
  if (await isRawFile(file)) {
    const raw = await extractRawThumbnail(file);
    if (!raw) return null;
    try {
      return await encodeThumbnail(
        drawThumbnail(raw.bitmap, raw.bitmap.width, raw.bitmap.height, flipToRotation(raw.flip)),
      );
    } finally {
      raw.bitmap.close();
    }
  }
  if (file.type !== "image/jpeg" && file.type !== "image/png") return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return await encodeThumbnail(drawThumbnail(bitmap, bitmap.width, bitmap.height));
  } finally {
    bitmap.close();
  }
}

export interface ThumbnailScheduler {
  /** Ausfuehrende Funktion (Rendern + Upload) setzen/ersetzen. */
  setRunner(run: (id: string) => void): void;
  /** Autosave fuer dieses Bild war erfolgreich -> Upload (gedrosselt). */
  notifySaved(id: string): void;
  /** Bild braucht beim Verlassen ein Vorschaubild, ohne sofortigen Upload
   *  (z.B. frisch geoeffnet, evtl. noch ohne Vorschau). */
  markDirty(id: string): void;
  /** Verlassen/Bildwechsel: ausstehenden Upload sofort ausfuehren. */
  flush(id: string): void;
  /** Alle Timer stoppen (Unmount). */
  dispose(): void;
}

export interface SchedulerOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
}

interface SlotState {
  last: number;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Drosselung pro Bild: der erste Save loest sofort aus, weitere innerhalb
 * von intervalMs werden zu genau einem nachlaufenden Upload am Ende des
 * Intervalls zusammengefasst (der dann den neuesten Stand zeigt).
 */
export function createThumbnailScheduler(
  options: SchedulerOptions = {},
  initialRunner: (id: string) => void = () => undefined,
): ThumbnailScheduler {
  const intervalMs = options.intervalMs ?? THUMBNAIL_UPLOAD_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const slots = new Map<string, SlotState>();
  let run = initialRunner;

  const slot = (id: string): SlotState => {
    let s = slots.get(id);
    if (!s) {
      s = { last: Number.NEGATIVE_INFINITY, dirty: false, timer: null };
      slots.set(id, s);
    }
    return s;
  };

  const fire = (id: string, s: SlotState) => {
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
    s.dirty = false;
    s.last = now();
    run(id);
  };

  return {
    setRunner(runner) {
      run = runner;
    },
    notifySaved(id) {
      const s = slot(id);
      s.dirty = true;
      if (s.timer !== null) return;
      const wait = s.last + intervalMs - now();
      if (wait <= 0) {
        fire(id, s);
        return;
      }
      s.timer = setTimeout(() => {
        s.timer = null;
        if (s.dirty) fire(id, s);
      }, wait);
    },
    markDirty(id) {
      slot(id).dirty = true;
    },
    flush(id) {
      const s = slots.get(id);
      if (!s) return;
      if (s.timer !== null) clearTimeout(s.timer);
      s.timer = null;
      if (s.dirty) fire(id, s);
    },
    dispose() {
      for (const s of slots.values()) {
        if (s.timer !== null) clearTimeout(s.timer);
        s.timer = null;
      }
    },
  };
}

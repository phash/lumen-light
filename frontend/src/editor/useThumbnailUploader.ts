import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ApiClient } from "../api/client";
import {
  type SchedulerOptions,
  createThumbnailScheduler,
  encodeThumbnail,
} from "./thumbnail";

export interface ThumbnailUploader {
  /** Nach erfolgreichem Autosave: Upload gedrosselt (max. 1 pro 10 s). */
  readonly notifySaved: (id: string) => void;
  /** Bild beim Verlassen auf jeden Fall versorgen (z.B. frisch geoeffnet). */
  readonly markDirty: (id: string) => void;
  /** Bildwechsel: ausstehenden Upload fuer das aktuelle Bild sofort. */
  readonly flushCurrent: () => void;
}

/**
 * H2a: laedt aus dem Editor Vorschaubilder MIT Bearbeitung hoch.
 *
 * - `capture` rendert synchron (Canvas.renderThumbnail); das JPEG-Kodieren
 *   laeuft danach asynchron per toBlob, der UI-Thread bleibt frei.
 * - Hochgeladen wird nur fuer das Bild, das das Canvas gerade zeigt
 *   (`currentId`); ein verspaeteter Timer fuer ein altes Bild verfaellt.
 * - Beim Unmount (Editor verlassen) wird ein ausstehender Upload im
 *   Layout-Cleanup ausgeloest — dann ist das Canvas noch gemountet. Best
 *   effort, ohne keepalive (Body > 64 KB); bei pagehide geht nichts raus.
 * - Fehler sind still: die Vorschau ist Komfort, kein Datenverlust.
 */
export function useThumbnailUploader(
  api: Pick<ApiClient, "putImageThumbnail">,
  capture: () => HTMLCanvasElement | null,
  currentId: string | null,
  options?: SchedulerOptions,
): ThumbnailUploader {
  const currentIdRef = useRef(currentId);
  const [scheduler] = useState(() => createThumbnailScheduler(options));
  // Runner pro Render neu setzen: liest immer die aktuellen api/capture.
  useLayoutEffect(() => {
    currentIdRef.current = currentId;
    scheduler.setRunner((id) => {
      if (id !== currentIdRef.current) return;
      let canvas: HTMLCanvasElement | null;
      try {
        canvas = capture();
      } catch {
        return;
      }
      if (!canvas) return;
      void encodeThumbnail(canvas)
        .then((blob) => (blob ? api.putImageThumbnail(id, blob) : undefined))
        .catch(() => undefined);
    });
  });

  useLayoutEffect(
    () => () => {
      const id = currentIdRef.current;
      if (id) scheduler.flush(id);
      scheduler.dispose();
    },
    [scheduler],
  );

  const notifySaved = useCallback((id: string) => scheduler.notifySaved(id), [scheduler]);
  const markDirty = useCallback((id: string) => scheduler.markDirty(id), [scheduler]);
  const flushCurrent = useCallback(() => {
    const id = currentIdRef.current;
    if (id) scheduler.flush(id);
  }, [scheduler]);
  return { notifySaved, markDirty, flushCurrent };
}

import type { ApiClient, Image } from "./client";
import { stripExifIfJpeg } from "./exifStrip";

export interface UploadOptions {
  /** Fuer Tests injizierbar. */
  fetch?: typeof fetch;
  /** Wenn true (default), werden APP1/APP2 (EXIF/ICC/XMP) aus JPEGs
   *  vor dem Upload entfernt. Auf false setzen, wenn der User die
   *  Metadaten bewusst behalten will. */
  stripExif?: boolean;
}

/**
 * End-to-end Image-Upload-Flow:
 * 1. (optional) EXIF aus JPEG-Datei entfernen — DSGVO-Datenminimierung
 * 2. Backend POST /images (init) — bekommt Pre-Signed PUT-URL
 * 3. Browser PUT direkt zur URL (Pixel laufen NICHT durch FastAPI)
 * 4. Backend POST /images/:id/confirm — markiert ready, liefert Metadata
 *
 * Wirft bei jedem Schritt — Caller entscheidet, wie das im UI gezeigt wird.
 */
export async function uploadImage(
  api: ApiClient,
  file: File,
  options: UploadOptions = {},
): Promise<Image> {
  const fetchImpl = options.fetch ?? fetch;
  const stripExif = options.stripExif ?? true;

  const toUpload = stripExif ? await stripExifIfJpeg(file) : file;

  const init = await api.initUpload(
    toUpload.name,
    toUpload.type || "application/octet-stream",
    toUpload.size,
  );

  const putRes = await fetchImpl(init.upload_url, {
    method: "PUT",
    body: toUpload,
    headers: { "Content-Type": toUpload.type || "application/octet-stream" },
  });
  if (!putRes.ok) {
    throw new Error(
      `Upload nach S3 fehlgeschlagen (${putRes.status} ${putRes.statusText})`,
    );
  }

  return api.confirmUpload(init.id);
}

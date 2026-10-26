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
 * 2. Backend POST /images (init) — bekommt Pre-Signed POST (URL + Policy-Felder)
 * 3. Browser POST direkt an S3 (Pixel laufen NICHT durch FastAPI); die Policy
 *    begrenzt die Groesse auf die angekuendigte Dateigroesse
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

  // Policy-Felder zuerst, "file" muss das letzte Feld sein (S3-POST-Regel).
  // Kein Content-Type-Header setzen: der Browser erzeugt die Multipart-Boundary.
  const form = new FormData();
  for (const [name, value] of Object.entries(init.uploadFields)) {
    form.append(name, value);
  }
  form.append("file", toUpload);
  const postRes = await fetchImpl(init.uploadUrl, { method: "POST", body: form });
  if (!postRes.ok) {
    throw new Error(
      `Upload nach S3 fehlgeschlagen (${postRes.status} ${postRes.statusText})`,
    );
  }

  return api.confirmUpload(init.id);
}

import type { ApiClient, Image } from "./client";

export interface UploadOptions {
  fetch?: typeof fetch;
}

/**
 * End-to-end Image-Upload-Flow:
 * 1. Backend POST /images (init) — bekommt Pre-Signed PUT-URL
 * 2. Browser PUT direkt zur URL (Pixel laufen NICHT durch FastAPI)
 * 3. Backend POST /images/:id/confirm — markiert ready, liefert Metadata
 *
 * Wirft bei jedem Schritt — Caller entscheidet, wie das im UI gezeigt wird.
 */
export async function uploadImage(
  api: ApiClient,
  file: File,
  options: UploadOptions = {},
): Promise<Image> {
  const fetchImpl = options.fetch ?? fetch;

  const init = await api.initUpload(
    file.name,
    file.type || "application/octet-stream",
    file.size,
  );

  const putRes = await fetchImpl(init.upload_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!putRes.ok) {
    throw new Error(
      `Upload nach S3 fehlgeschlagen (${putRes.status} ${putRes.statusText})`,
    );
  }

  return api.confirmUpload(init.id);
}

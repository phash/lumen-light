/**
 * Backend-API-Helper fuer E2E-Tests. Vermeidet, dass jeder Test die volle
 * UI-Sequenz fuer Image-Upload + Preset-Publish durchspielen muss —
 * Tests koennen Daten direkt seeden und dann nur den Pfad rendern,
 * den sie verifizieren wollen.
 */
const API_BASE = process.env.LUMEN_API_BASE ?? "http://localhost:8000/api/v1";

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function api<T>(token: string, path: string, init: FetchInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${init.method ?? "GET"} ${path}: ${res.status} ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Minimales 1x1 PNG (stat. Daten) — gross genug, dass HEAD eine Size meldet. */
const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xfa, 0xcf, 0xc0, 0xc0,
  0xc0, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x95, 0x90, 0xf4, 0x97, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export async function uploadTinyImage(
  token: string,
  filename = "marketplace-preview.png",
): Promise<{ id: string }> {
  // Snake-Case-Body: dev backend kann beide Formen, alte Backends nur snake.
  const init = await api<{ id?: string; upload_url?: string; uploadUrl?: string }>(
    token,
    "/images",
    {
      method: "POST",
      body: JSON.stringify({
        filename,
        content_type: "image/png",
        size_bytes: TINY_PNG_BYTES.byteLength,
      }),
    },
  );
  const imageId = init.id;
  const uploadUrl = init.uploadUrl ?? init.upload_url;
  if (!imageId || !uploadUrl) {
    throw new Error(`Image-Init liefert kein id/uploadUrl: ${JSON.stringify(init)}`);
  }
  // PUT direkt gegen den Pre-Signed URL (MinIO/Garage).
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: TINY_PNG_BYTES,
  });
  if (!put.ok) {
    throw new Error(`Pre-Signed-PUT fehlgeschlagen: ${put.status}`);
  }
  await api<unknown>(token, `/images/${imageId}/confirm`, { method: "POST" });
  return { id: imageId };
}

const NEUTRAL_ADJUSTMENTS = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  sharpness: 0,
  noiseReduction: 0,
  highlightRecovery: 0,
  localContrast: 0,
  hsl: null as null,
  toneCurve: null as null,
};

export interface SeedPublishedOptions {
  name: string;
  description: string;
  genre: string;
  exposure?: number;
  contrast?: number;
}

export async function seedPublishedPreset(
  token: string,
  opts: SeedPublishedOptions,
): Promise<{ presetId: string; previewImageId: string }> {
  const image = await uploadTinyImage(token);
  const preset = await api<{ id: string }>(token, "/presets", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      adjustments: {
        ...NEUTRAL_ADJUSTMENTS,
        exposure: opts.exposure ?? 0.5,
        contrast: opts.contrast ?? 0.2,
      },
      masks: [],
      visibility: "public",
      genre: opts.genre,
      description: opts.description,
      previewImageId: image.id,
    }),
  });
  return { presetId: preset.id, previewImageId: image.id };
}

export async function setHandle(token: string, handle: string): Promise<void> {
  await api<unknown>(token, "/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify({ handle, bio: null }),
  });
}

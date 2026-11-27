import { decodeRaw } from "../src/editor/raw";
import { boxDownscaleRgb16, type Rgb16Image } from "../src/editor/rawPixels";
import { Renderer } from "../src/editor/webgl";

import type { GoldenSet } from "./sets";

/** Lange Kante der Golden-Quelle (Spike-Vorgabe). */
const LONG_EDGE = 512;

export interface GoldenSource {
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  make: string;
  model: string;
  rgb16Base64: string;
}

export interface GoldenResult {
  source: GoldenSource;
  /** Set-Id -> PNG als dataURL. */
  pngs: Record<string, string>;
}

declare global {
  interface Window {
    renderGoldens: (fixtureUrl: string, sets: GoldenSet[]) => Promise<GoldenResult>;
  }
}

/** Uint16Array (little-endian auf allen Zielplattformen) -> base64. */
function toBase64(data: Uint16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function targetSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= LONG_EDGE) return { width, height };
  const scale = LONG_EDGE / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

window.renderGoldens = async (fixtureUrl, sets) => {
  const response = await fetch(fixtureUrl);
  if (!response.ok) throw new Error(`Fixture nicht ladbar: ${fixtureUrl} (${response.status})`);
  const name = decodeURIComponent(fixtureUrl.split("/").pop() ?? "fixture.raw");
  const file = new File([await response.arrayBuffer()], name);

  const decoded = await decodeRaw(file, { bits: 16 });
  if (decoded.pixels.bits !== 16) throw new Error("decodeRaw lieferte kein 16-bit");
  const full: Rgb16Image = {
    kind: "rgb16",
    data: decoded.pixels.rgb,
    width: decoded.width,
    height: decoded.height,
  };
  const size = targetSize(full.width, full.height);
  const small =
    size.width === full.width && size.height === full.height
      ? full
      : boxDownscaleRgb16(full, size.width, size.height);

  const canvas = document.getElementById("golden-canvas") as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const pngs: Record<string, string> = {};
  try {
    renderer.loadImage(small, small.width, small.height);
    for (const set of sets) {
      renderer.render(set.adjustments, false, undefined, 0, 0, undefined, {
        width: small.width,
        height: small.height,
      });
      pngs[set.id] = canvas.toDataURL("image/png");
    }
  } finally {
    renderer.dispose();
  }

  return {
    source: {
      width: small.width,
      height: small.height,
      srcWidth: full.width,
      srcHeight: full.height,
      make: decoded.cameraMake ?? "",
      model: decoded.cameraModel ?? "",
      rgb16Base64: toBase64(small.data),
    },
    pngs,
  };
};

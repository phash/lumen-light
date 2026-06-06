/**
 * YAML-Serialisierung fuer Bearbeitungs-Profile. Rein client-seitig —
 * beim Import wird die geparste Struktur via POST /presets ans Backend
 * geschickt, das Pydantic (extra=forbid, Ranges, Mask-Caps) validiert.
 * Hier nur ein leichter Shape-Check fuer fruehe, freundliche Fehler.
 */
import { parse, stringify } from "yaml";

import type {
  Adjustments,
  PresetGeometryWire,
  PresetMask,
} from "../api/client";

const PROFILE_VERSION = 1;

export interface ProfileFile {
  name: string;
  adjustments: Adjustments;
  masks: PresetMask[];
  geometry?: PresetGeometryWire | null;
}

export function serializeProfileYaml(p: ProfileFile): string {
  return stringify({
    lumenProfile: PROFILE_VERSION,
    name: p.name,
    adjustments: p.adjustments,
    masks: p.masks,
    geometry: p.geometry ?? null,
  });
}

export function parseProfileYaml(text: string): ProfileFile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    throw new Error("Ungültige YAML-Datei.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Profil-Datei ist leer oder kein Objekt.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.lumenProfile !== PROFILE_VERSION) {
    throw new Error(
      `Nicht unterstützte Profil-Version (erwartet ${PROFILE_VERSION}).`,
    );
  }
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    throw new Error("Profil-Datei hat keinen gültigen Namen.");
  }
  if (typeof obj.adjustments !== "object" || obj.adjustments === null || Array.isArray(obj.adjustments)) {
    throw new Error("Profil-Datei hat keine Anpassungen.");
  }
  return {
    name: obj.name,
    adjustments: obj.adjustments as Adjustments,
    masks: Array.isArray(obj.masks) ? (obj.masks as PresetMask[]) : [],
    geometry: (obj.geometry ?? null) as PresetGeometryWire | null,
  };
}

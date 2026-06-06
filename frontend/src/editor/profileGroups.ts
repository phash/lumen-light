/**
 * Schritt-Gruppen fuer Bearbeitungs-Profile. Single Source ist
 * backend/schemas/edit-groups.json (das Backend liest dieselbe Datei zur
 * Laufzeit). Hier wird sie beim Build importiert — der Vite-Build-Context
 * ist das Repo-Root, daher ist der Cross-Pfad-Import zulaessig (gleiches
 * Muster wie lensProfile.ts mit infra/lensfun/profiles.json).
 */
import type { ImageEditState } from "../api/client";
import groupsData from "../../../backend/schemas/edit-groups.json";

export interface EditGroup {
  readonly key: string;
  readonly label: string;
  readonly fields: ReadonlyArray<string>;
  readonly defaultEnabled: boolean;
}

export const GROUPS = groupsData as ReadonlyArray<EditGroup>;

export function defaultEnabledGroups(): Set<string> {
  return new Set(GROUPS.filter((g) => g.defaultEnabled).map((g) => g.key));
}

const TOPLEVEL_GEOMETRY = new Set([
  "crop",
  "straightenAngle",
  "lensCorrection",
  "lensProfileId",
  "manualLensOverride",
]);

/**
 * Baut einen neuen Edit-State: startet vom `base` des Bildes und
 * ueberschreibt fuer jede angehakte Gruppe deren Felder aus `profile`.
 * Nicht-angehakte Gruppen bleiben unveraendert. Reine Funktion.
 */
export function mergeGroups(
  base: ImageEditState,
  profile: ImageEditState,
  enabled: ReadonlySet<string>,
): ImageEditState {
  const adjustments = { ...base.adjustments };
  const next: ImageEditState = {
    adjustments,
    masks: base.masks,
    crop: base.crop,
    straightenAngle: base.straightenAngle,
    lensCorrection: base.lensCorrection,
    lensProfileId: base.lensProfileId,
    manualLensOverride: base.manualLensOverride,
  };
  for (const group of GROUPS) {
    if (!enabled.has(group.key)) continue;
    for (const field of group.fields) {
      if (field === "masks") {
        next.masks = profile.masks;
      } else if (TOPLEVEL_GEOMETRY.has(field)) {
        // Top-Level-Geometrie-Feld
        (next as unknown as Record<string, unknown>)[field] =
          (profile as unknown as Record<string, unknown>)[field];
      } else {
        // Adjustment-Skalar, hsl oder toneCurve
        (adjustments as unknown as Record<string, unknown>)[field] =
          (profile.adjustments as unknown as Record<string, unknown>)[field];
      }
    }
  }
  return next;
}

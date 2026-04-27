/**
 * Heuristik fuer Smart-Preset-Suggestion: leitet aus Brennweite und
 * groben Histogramm-Statistiken einen Genre-Tipp ab. Der User entscheidet
 * weiterhin selbst — Vorschlag ist ein Banner, das man wegklicken kann.
 *
 * Mapping (bewusst grob, keine Wissenschaft):
 *
 * - Brennweite < 35mm + viel Mittel/Hochton + Sat balanciert -> "Landschaft"
 * - Brennweite > 200mm                                       -> "Sport" (Fokus auf Bewegung)
 * - Brennweite 50-135mm + Median im Hauttoebereich           -> "Portrait"
 * - sehr hoher Mean(G), niedriger Mean(B)                    -> "Natur" (gruendominiert)
 * - sehr blau/cyan-dominant + niedrige Saettigung            -> "Stadt" (Beton/Glas)
 * - sonst kein Vorschlag (null)
 *
 * Keine Garantie, dass das gut trifft — nur ein erster Anker. Smart-
 * Preset darf keinen Slider direkt setzen; der User klickt das Banner
 * an, dann wird das vorgeschlagene Preset geladen.
 */

export type Genre = "Portrait" | "Landschaft" | "Stadt" | "Natur" | "Tiere" | "Sport";

export interface SuggestionInput {
  readonly focalLen: number | null;
  readonly meanR: number;
  readonly meanG: number;
  readonly meanB: number;
  readonly p500: number;
}

export function suggestGenre(input: SuggestionInput): Genre | null {
  const { focalLen, meanR, meanG, meanB, p500 } = input;
  const sat = Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB);

  // Sehr lange Tele-Brennweite: Sport oder Tiere — Histogramm als Tiebreaker.
  if (focalLen !== null && focalLen >= 200) {
    // gruendominante Szene -> Tiere im Wald, sonst Sport.
    if (meanG > meanR && meanG > meanB && meanG - meanB > 0.05) {
      return "Tiere";
    }
    return "Sport";
  }

  // Weitwinkel: meist Landschaft oder Stadt.
  if (focalLen !== null && focalLen <= 30) {
    // Stark blau/cyan + gedaempfte Saettigung -> Stadt
    if (meanB > meanR && meanB - meanR > 0.05 && sat < 0.15) {
      return "Stadt";
    }
    return "Landschaft";
  }

  // Mid-Tele (50-135) + Hauttoebereich-Median -> Portrait. Hauttoene
  // liegen grob bei Luminanz 0.4-0.7.
  if (focalLen !== null && focalLen >= 50 && focalLen <= 135) {
    if (p500 > 0.35 && p500 < 0.7 && meanR > meanG && meanR - meanB > 0.03) {
      return "Portrait";
    }
  }

  // Stark gruendominant: Natur.
  if (meanG > meanR && meanG > meanB && meanG - Math.max(meanR, meanB) > 0.08) {
    return "Natur";
  }

  return null;
}

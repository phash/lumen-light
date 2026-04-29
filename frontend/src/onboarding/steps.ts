/**
 * Tour-Schritte als deklarative Liste. Jeder Schritt zeigt entweder ein
 * Modal („welcome" / „done") oder ein Spotlight ueber einem konkreten
 * DOM-Knoten (Selektor via `data-testid`). Microcopy bleibt deutsch und
 * hobby-fotografen-tauglich.
 *
 * Reihenfolge folgt dem UI/UX-Review (siehe
 * docs/superpowers/specs/2026-04-29-ui-ux-review.md): erlebbare
 * Aha-Momente statt Feature-Aufzaehlung.
 */

export type StepKind = "modal" | "spotlight";

export interface OnboardingStep {
  readonly id: string;
  readonly kind: StepKind;
  /** Test-ID des Ziel-Elements; nur fuer kind=spotlight. */
  readonly target?: string;
  readonly title: string;
  readonly body: string;
  /** Wo das Tooltip relativ zum Target sitzen soll (Default: bottom). */
  readonly placement?: "top" | "bottom" | "left" | "right";
  /**
   * Wenn gesetzt, blockiert die Tour den Weiter-Button bis das Element
   * existiert. Nuetzlich fuer Schritte, die auf User-Aktion warten
   * (z.B. „Bild laden" → Histogramm muss erscheinen).
   */
  readonly waitForTestId?: string;
}

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  {
    id: "welcome",
    kind: "modal",
    title: "Willkommen bei Lumen",
    body:
      "Lumen ist dein Browser-Foto-Editor. Wir zeigen dir in 60 Sekunden " +
      "die wichtigsten Werkzeuge — du kannst die Tour jederzeit ueberspringen.",
  },
  {
    id: "load-image",
    kind: "spotlight",
    target: "editor-load-sample",
    placement: "bottom",
    waitForTestId: "histogram",
    title: "1. Bild laden",
    body:
      "Klick auf 'Beispielbild laden' — wir starten mit einem Demobild, damit du " +
      "sofort loslegen kannst. Spaeter ziehst du eigene Bilder direkt rein, " +
      "auch RAW (CR2/NEF/ARW…).",
  },
  {
    id: "auto-tone",
    kind: "spotlight",
    target: "editor-auto-tone",
    placement: "top",
    title: "2. Auto-Ton",
    body:
      "Ein Klick — Lumen analysiert das Bild und setzt Belichtung, Kontrast, " +
      "Schwarz und Weiss automatisch. Guter Startpunkt, von dem aus du " +
      "feinjustierst.",
  },
  {
    id: "sidebar-sliders",
    kind: "spotlight",
    target: "editor-sidebar",
    placement: "left",
    title: "3. Slider feinjustieren",
    body:
      "Hier sind alle Korrekturen — Belichtung, Kontrast, Farben, Detail. " +
      "Hover auf den Namen zeigt eine Erklaerung. Doppelklick auf einen " +
      "Slider setzt ihn zurueck.",
  },
  {
    id: "bypass",
    kind: "spotlight",
    target: "editor-bypass",
    placement: "top",
    title: "4. Vorher / Nachher",
    body:
      "Bypass-Button gedrueckt halten zeigt das Original. Tastenkuerzel: " +
      "B. Daneben gibt's einen Compare-Split-Slider fuer den Side-by-Side-Blick.",
  },
  {
    id: "crop",
    kind: "spotlight",
    target: "editor-crop-toggle",
    placement: "top",
    title: "5. Beschneiden",
    body:
      "Beschneiden, drehen, Auto-Begradigung — alles hier (Tastenkuerzel: R). " +
      "Du editierst in voller Aufloesung weiter, der Crop wird nur fuer den " +
      "Export angewendet.",
  },
  {
    id: "presets",
    kind: "spotlight",
    target: "editor-presets",
    placement: "top",
    title: "6. Preset speichern",
    body:
      "20 Presets sind schon angelegt — Portrait, Landschaft, Macro, Astro, " +
      "Food und mehr. Hier speicherst du deinen eigenen Look oder teilst ihn " +
      "im Marketplace.",
  },
  {
    id: "export",
    kind: "spotlight",
    target: "editor-export",
    placement: "top",
    title: "7. Exportieren",
    body:
      "Tastenkuerzel: E. Format und Groesse waehlbar — JPEG fuer Web, PNG " +
      "fuer Druck. Der Crop wird hier angewendet, das Original bleibt " +
      "unveraendert in deiner Bibliothek.",
  },
  {
    id: "done",
    kind: "modal",
    title: "Fertig — viel Spass!",
    body:
      "Im Header findest du den Marketplace fuer geteilte Presets, und " +
      "den Feedback-Button oben rechts, falls etwas hakt. Die Tour kannst " +
      "du jederzeit aus dem Account-Bereich neu starten.",
  },
];

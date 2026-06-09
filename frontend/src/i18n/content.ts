// frontend/src/i18n/content.ts
// Single Source fuer alle sichtbaren Landing-/Header-Strings + Meta, getrennt
// nach Locale. Wird ausserdem von structuredData.ts gelesen, damit JSON-LD und
// sichtbare Seite per Konstruktion deckungsgleich sind.

export type Locale = "de" | "en";
export const LOCALES: readonly Locale[] = ["de", "en"];

export interface Feature {
  readonly title: string;
  readonly body: string;
}
export interface FaqEntry {
  readonly q: string;
  readonly a: string;
}
export interface LandingContent {
  readonly meta: { readonly title: string; readonly description: string; readonly ogTitle: string };
  readonly hero: {
    readonly h1: string;
    readonly tagline: string;
    readonly ctaStartAnon: string;
    readonly ctaStartAuth: string;
    readonly ctaDemoAnon: string;
    readonly ctaDemoAuth: string;
  };
  readonly featuresHeading: string;
  readonly features: readonly Feature[];
  readonly selfhost: { readonly heading: string; readonly body: string };
  readonly compare: {
    readonly heading: string;
    readonly intro: string;
    readonly colLightroom: string;
    readonly rows: readonly (readonly [string, string, string])[];
  };
  readonly faqHeading: string;
  readonly faq: readonly FaqEntry[];
  readonly footer: { readonly privacy: string; readonly imprint: string };
  readonly marketplace: { readonly title: string; readonly description: string; readonly heading: string; readonly body: string };
  readonly howto: { readonly name: string; readonly steps: readonly string[] };
  readonly langSwitch: { readonly de: string; readonly en: string };
}

const de: LandingContent = {
  meta: {
    title: "Kostenlose Lightroom-Alternative im Browser — Lumen · light",
    description:
      "Lumen · light ist eine kostenlose, leichtgewichtige, selbst-hostbare Lightroom-Alternative: RAW direkt im Browser entwickeln — lokale Masken, HSL, Tonkurve, Auto-Ton. Ohne Abo, ohne Cloud-Zwang.",
    ogTitle: "Lumen · light — kostenlose Lightroom-Alternative im Browser",
  },
  hero: {
    h1: "Die kostenlose Lightroom-Alternative im Browser",
    tagline:
      "RAW entwickeln direkt im Browser — leichtgewichtig, ohne Abo, ohne Cloud-Zwang. Deine Bilder bleiben auf deinem Gerät.",
    ctaStartAnon: "Anmelden & starten",
    ctaStartAuth: "Im Editor starten",
    ctaDemoAnon: "Anmelden & ausprobieren",
    ctaDemoAuth: "Beispielbild ausprobieren",
  },
  featuresHeading: "Was Lumen kann",
  features: [
    {
      title: "Alle wichtigen Regler",
      body: "Belichtung, Kontrast, Lichter, Tiefen, Weiss, Schwarz, Temperatur, Tönung, Dynamik, Sättigung — die zehn klassischen Lightroom-Regler, vollständig im Browser via WebGL2.",
    },
    {
      title: "Echte RAW-Dateien",
      body: "CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF — direkt in der App geöffnet, ohne Server-Roundtrip. Embedded-Vorschau in unter 5 Sekunden.",
    },
    {
      title: "Lokale Anpassungen",
      body: "Bis zu 4 lineare Verlaufsfilter und 4 Radialmasken pro Bild — Belichtung, Kontrast, Sättigung, Temperatur lokal pro Bereich.",
    },
    {
      title: "Auto-Ton & Auto-WB",
      body: "Ein Klick — Histogramm-Analyse setzt Belichtung, Whites/Blacks, Kontrast und Weißabgleich auf vernünftige Werte. Gut für flaue Out-of-Camera-RAWs.",
    },
    {
      title: "Genre-Presets",
      body: "Portrait, Landschaft, Stadt, Natur, Tiere, Sport — moderate Voreinstellungen, die den Bild-Charakter unterstreichen, ohne zu übertreiben.",
    },
    {
      title: "Deine Daten",
      body: "Selbst-hostbar: Postgres + S3-kompatibles Garage, Keycloak für Login. Daten bleiben in deiner Hand — DELETE-/me und JSON-Export integriert.",
    },
  ],
  selfhost: {
    heading: "Selbsthosten",
    body: "FastAPI · React 19 · WebGL2 · Postgres · Keycloak · Garage S3 · Docker Compose. Production-fertig auf einem 4-GB-VPS.",
  },
  compare: {
    heading: "Lumen oder Lightroom?",
    intro:
      "Lumen ersetzt nicht jeden Profi-Workflow — aber für RAW-Entwicklung ohne Abo und ohne Cloud-Zwang deckt es die wichtigsten Schritte ab.",
    colLightroom: "Adobe Lightroom",
    rows: [
      ["Preis", "Kostenlos, selbst-hostbar", "Abo ab ~12 €/Monat"],
      ["Plattform", "Browser (WebGL2)", "Desktop + Cloud-App"],
      ["Deine Daten", "Bleiben bei dir", "Adobe Creative Cloud"],
      ["RAW im Browser", "Ja", "Nein (Desktop)"],
      ["Lokale Masken", "Linear + Radial", "Umfangreich (inkl. KI)"],
      ["Open Source", "Ja (AGPL-3.0)", "Nein"],
      ["Ohne Abo / offline", "Ja", "Nein"],
    ],
  },
  faqHeading: "Häufige Fragen",
  faq: [
    {
      q: "Was ist Lumen · light?",
      a: "Lumen ist eine kostenlose, selbst-hostbare, browser-basierte RAW-Foto-Entwicklung — eine leichtgewichtige Lightroom-Alternative. RAW-Dateien werden direkt im Browser via WebGL2 entwickelt, ohne Cloud-Zwang.",
    },
    {
      q: "Welche RAW-Formate unterstützt Lumen?",
      a: "CR2, CR3, NEF, ARW, RAF, DNG, RW2 und ORF — geöffnet via libraw-wasm direkt im Browser.",
    },
    {
      q: "Ist Lumen eine Lightroom-Alternative?",
      a: "Ja. Lumen bietet die klassischen Regler (Belichtung, Kontrast, Lichter, Tiefen, HSL, Tonkurve), lokale Masken und Presets — als selbst-hostbare, abofreie Web-App.",
    },
    {
      q: "Kann ich Lumen selbst hosten?",
      a: "Ja, via Docker Compose (FastAPI, React, Postgres, Keycloak, S3). Läuft auf einem kleinen VPS.",
    },
    {
      q: "Kostet Lumen etwas?",
      a: "Nein. Lumen ist kostenlos und selbst-hostbar — kein Abo, keine Cloud-Pflicht.",
    },
    {
      q: "Bleiben meine Bilder privat?",
      a: "Ja. Die Bildverarbeitung läuft lokal im Browser; Bilder bleiben auf deinem Gerät, außer du sicherst sie bewusst im eigenen Storage.",
    },
    {
      q: "Ist Lumen Open Source?",
      a: "Ja. Lumen steht unter der AGPL-3.0 und ist auf GitHub einsehbar — du kannst es selbst hosten, anpassen und weitergeben.",
    },
    {
      q: "Muss ich etwas installieren?",
      a: "Nein. Lumen läuft komplett im Browser via WebGL2 — keine Desktop-Installation, kein Plugin.",
    },
    {
      q: "Welche Kameras werden unterstützt?",
      a: "RAW von Canon, Nikon, Sony, Fujifilm, Panasonic und Olympus — über die Formate CR2, CR3, NEF, ARW, RAF, DNG, RW2 und ORF.",
    },
  ],
  footer: { privacy: "Datenschutz", imprint: "Impressum" },
  marketplace: {
    title: "Kostenlose Presets — Lumen · light Marketplace",
    description:
      "Kostenlose Foto-Presets für Lumen · light, die browser-basierte Lightroom-Alternative. Ohne Konto stöbern, mit einem Klick anwenden.",
    heading: "Kostenlose Presets",
    body: "Stöbere ohne Konto durch von der Community geteilte Presets für Lumen · light — die kostenlose, browser-basierte Lightroom-Alternative. Anwenden und Forken brauchen nur einen kostenlosen Login.",
  },
  howto: {
    name: "RAW im Browser entwickeln",
    steps: [
      "RAW-Datei in Lumen öffnen — die Vorschau erscheint in unter 5 Sekunden.",
      "Auto-Ton und Auto-Weißabgleich mit einem Klick als Startpunkt setzen.",
      "Mit Reglern, HSL, Tonkurve und lokalen Masken feinabstimmen.",
      "Das Ergebnis in voller Auflösung exportieren.",
    ],
  },
  langSwitch: { de: "DE", en: "EN" },
};

const en: LandingContent = {
  meta: {
    title: "Free Lightroom Alternative in Your Browser — Lumen",
    description:
      "Lumen is a free, lightweight, self-hostable Lightroom alternative: develop RAW photos right in your browser — local masks, HSL, tone curve, auto-tone. No subscription, no forced cloud.",
    ogTitle: "Lumen — free Lightroom alternative in your browser",
  },
  hero: {
    h1: "The free, browser-based Lightroom alternative for RAW",
    tagline:
      "Develop RAW photos right in your browser — lightweight, no subscription, no forced cloud. Your images stay on your device.",
    ctaStartAnon: "Sign in & start",
    ctaStartAuth: "Open the editor",
    ctaDemoAnon: "Sign in & try it",
    ctaDemoAuth: "Try a sample image",
  },
  featuresHeading: "What Lumen does",
  features: [
    {
      title: "All the key sliders",
      body: "Exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation — the ten classic Lightroom sliders, fully in the browser via WebGL2.",
    },
    {
      title: "Real RAW files",
      body: "CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF — opened directly in the app, no server round-trip. Embedded preview in under 5 seconds.",
    },
    {
      title: "Local adjustments",
      body: "Up to 4 linear gradient filters and 4 radial masks per image — exposure, contrast, saturation and temperature locally per region.",
    },
    {
      title: "Auto-tone & auto-WB",
      body: "One click — histogram analysis sets exposure, whites/blacks, contrast and white balance to sensible values. Great for flat out-of-camera RAWs.",
    },
    {
      title: "Genre presets",
      body: "Portrait, landscape, city, nature, animals, sport — moderate presets that bring out an image's character without overdoing it.",
    },
    {
      title: "Your data",
      body: "Self-hostable: Postgres + S3-compatible Garage, Keycloak for login. Your data stays yours — DELETE /me and JSON export built in.",
    },
  ],
  selfhost: {
    heading: "Self-hosting",
    body: "FastAPI · React 19 · WebGL2 · Postgres · Keycloak · Garage S3 · Docker Compose. Production-ready on a 4 GB VPS.",
  },
  compare: {
    heading: "Lumen or Lightroom?",
    intro:
      "Lumen does not replace every pro workflow — but for RAW development without a subscription or forced cloud it covers the most important steps.",
    colLightroom: "Adobe Lightroom",
    rows: [
      ["Price", "Free, self-hostable", "Subscription from ~$10/month"],
      ["Platform", "Browser (WebGL2)", "Desktop + cloud app"],
      ["Your data", "Stays with you", "Adobe Creative Cloud"],
      ["RAW in the browser", "Yes", "No (desktop)"],
      ["Local masks", "Linear + radial", "Extensive (incl. AI)"],
      ["Open source", "Yes (AGPL-3.0)", "No"],
      ["No subscription / offline", "Yes", "No"],
    ],
  },
  faqHeading: "Frequently asked questions",
  faq: [
    {
      q: "What is Lumen?",
      a: "Lumen is a free, self-hostable, browser-based RAW photo developer — a lightweight Lightroom alternative. RAW files are developed directly in the browser via WebGL2, with no forced cloud.",
    },
    {
      q: "Which RAW formats does Lumen support?",
      a: "CR2, CR3, NEF, ARW, RAF, DNG, RW2 and ORF — opened via libraw-wasm directly in the browser.",
    },
    {
      q: "Is Lumen a Lightroom alternative?",
      a: "Yes. Lumen offers the classic sliders (exposure, contrast, highlights, shadows, HSL, tone curve), local masks and presets — as a self-hostable, subscription-free web app.",
    },
    {
      q: "Can I self-host Lumen?",
      a: "Yes, via Docker Compose (FastAPI, React, Postgres, Keycloak, S3). Runs on a small VPS.",
    },
    {
      q: "Does Lumen cost anything?",
      a: "No. Lumen is free and self-hostable — no subscription, no mandatory cloud.",
    },
    {
      q: "Do my images stay private?",
      a: "Yes. Image processing runs locally in the browser; images stay on your device unless you deliberately save them to your own storage.",
    },
    {
      q: "Is Lumen open source?",
      a: "Yes. Lumen is licensed under AGPL-3.0 and available on GitHub — you can self-host, modify and redistribute it.",
    },
    {
      q: "Do I need to install anything?",
      a: "No. Lumen runs entirely in the browser via WebGL2 — no desktop install, no plugin.",
    },
    {
      q: "Which cameras are supported?",
      a: "RAW from Canon, Nikon, Sony, Fujifilm, Panasonic and Olympus — via the formats CR2, CR3, NEF, ARW, RAF, DNG, RW2 and ORF.",
    },
  ],
  footer: { privacy: "Privacy", imprint: "Imprint" },
  marketplace: {
    title: "Free presets — Lumen Marketplace",
    description:
      "Free photo presets for Lumen, the browser-based Lightroom alternative. Browse without an account, apply in one click.",
    heading: "Free presets",
    body: "Browse community-shared presets for Lumen — the free, browser-based Lightroom alternative — without an account. Applying and forking just need a free login.",
  },
  howto: {
    name: "Develop RAW in your browser",
    steps: [
      "Open a RAW file in Lumen — the preview appears in under 5 seconds.",
      "Set a starting point with one-click auto-tone and auto white balance.",
      "Fine-tune with sliders, HSL, tone curve and local masks.",
      "Export the result at full resolution.",
    ],
  },
  langSwitch: { de: "DE", en: "EN" },
};

export const CONTENT: Record<Locale, LandingContent> = { de, en };

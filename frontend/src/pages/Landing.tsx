import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";

export default function Landing() {
  const auth = useAuth();
  const startHref = auth.isAuthenticated ? "/editor" : "/login";

  return (
    <section data-testid="page-landing" className="min-h-[calc(100vh-3rem)]">
      {/* Hero */}
      <div className="px-8 py-16 max-w-4xl mx-auto">
        <h1 className="text-5xl text-stone-100 leading-tight">
          RAW im Browser entwickeln.
        </h1>
        <p className="mt-6 text-xl text-stone-400 max-w-xl">
          Lumen ist ein selbsthostbarer Foto-Entwickler — keine Software,
          kein Abo, keine Cloud-Pflicht. Bilder bleiben auf deinem Gerät,
          ausser du willst sie ausdrücklich im persönlichen Storage sichern.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={startHref}
            data-testid="landing-cta-primary"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
          >
            {auth.isAuthenticated ? "Im Editor starten" : "Anmelden & starten"}
          </Link>
          <Link
            to={startHref}
            data-testid="landing-cta-demo"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
          >
            {auth.isAuthenticated ? "Beispielbild ausprobieren" : "Anmelden & ausprobieren"}
          </Link>
        </div>
      </div>

      {/* Feature-Grid */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          <h2 className="col-span-full text-2xl text-stone-200">Was Lumen kann</h2>
          <Feature
            title="Alle wichtigen Slider"
            body="Belichtung, Kontrast, Lichter, Tiefen, Weiss, Schwarz, Temperatur, Tönung, Dynamik, Sättigung — die zehn klassischen Lightroom-Regler, vollstaendig im Browser via WebGL2."
          />
          <Feature
            title="Echte RAW-Dateien"
            body="CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF — direkt in der App geöffnet, ohne Server-Roundtrip. Embedded-Vorschau in unter 5 Sekunden."
          />
          <Feature
            title="Lokale Anpassungen"
            body="Bis zu 4 lineare Verlaufsfilter und 4 Radialmasken pro Bild — Belichtung, Kontrast, Sättigung, Temperatur lokal pro Bereich."
          />
          <Feature
            title="Auto-Tone & Auto-WB"
            body="Ein Klick — Histogramm-Analyse setzt Belichtung, Whites/Blacks, Kontrast und Weißabgleich auf vernünftige Werte. Gut für flaue Out-of-Camera-RAWs."
          />
          <Feature
            title="Genre-Presets"
            body="Portrait, Landschaft, Stadt, Natur, Tiere, Sport — moderate Voreinstellungen, die den Bild-Charakter unterstreichen, ohne zu übertreiben."
          />
          <Feature
            title="Eigene Daten"
            body="Selbsthosted: Postgres + S3-kompatibles Garage. Keycloak für Login. Daten bleiben in deiner Hand — DELETE-/me und JSON-Export integriert."
          />
        </div>
      </div>

      {/* Tech / Repo */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-stone-300 italic">Selbsthosten</h2>
          <p className="mt-3 text-stone-400">
            FastAPI · React 19 · WebGL2 · Postgres · Keycloak · Garage S3 ·
            Docker Compose. Production-fertig auf einem 4-GB-VPS.
          </p>
        </div>
      </div>

      {/* Vergleich Lumen vs. Lightroom */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-compare">
          <h2 className="text-2xl text-stone-200">Lumen oder Lightroom?</h2>
          <p className="mt-3 text-stone-400 max-w-2xl">
            Lumen ersetzt nicht jeden Profi-Workflow — aber für RAW-Entwicklung
            ohne Abo und ohne Cloud-Zwang deckt es die wichtigsten Schritte ab.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-stone-300 border-b border-stone-700">
                  <th className="py-2 pr-4 font-normal" scope="col">
                    &nbsp;
                  </th>
                  <th className="py-2 pr-4 font-medium text-amber-200" scope="col">
                    Lumen · light
                  </th>
                  <th className="py-2 pr-4 font-normal" scope="col">
                    Adobe Lightroom
                  </th>
                </tr>
              </thead>
              <tbody className="text-stone-400">
                {COMPARE_ROWS.map(([label, lumen, lr]) => (
                  <tr key={label} className="border-b border-stone-800/60">
                    <th
                      scope="row"
                      className="py-2 pr-4 font-normal text-stone-300"
                    >
                      {label}
                    </th>
                    <td className="py-2 pr-4 text-stone-200">{lumen}</td>
                    <td className="py-2 pr-4">{lr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FAQ — Fragen + Antworten spiegeln das FAQPage-JSON-LD in index.html */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-faq">
          <h2 className="text-2xl text-stone-200">Häufige Fragen</h2>
          <div className="mt-6 divide-y divide-stone-800/60">
            {FAQ.map(({ q, a }) => (
              <Faq key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-6 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-4 text-xs text-stone-500">
          <Link to="/datenschutz" className="hover:text-stone-300">
            Datenschutz
          </Link>
          <Link to="/impressum" className="hover:text-stone-300">
            Impressum
          </Link>
          <a
            href="https://github.com/phash/lumen-light"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-github"
            className="hover:text-stone-300"
          >
            GitHub
          </a>
          <a
            href="https://buymeacoffee.com/phash"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-bmac"
            className="ml-auto text-amber-200/80 hover:text-amber-200"
          >
            ☕ Buy me a coffee
          </a>
        </div>
      </div>
    </section>
  );
}

interface FeatureProps {
  readonly title: string;
  readonly body: string;
}

function Feature({ title, body }: FeatureProps) {
  return (
    <div>
      <h3 className="text-stone-200 italic">{title}</h3>
      <p className="mt-2 text-sm text-stone-400">{body}</p>
    </div>
  );
}

// Zeilen: [Kriterium, Lumen, Lightroom]
const COMPARE_ROWS: readonly (readonly [string, string, string])[] = [
  ["Preis", "Kostenlos, selbst-hostbar", "Abo ab ~12 €/Monat"],
  ["Plattform", "Browser (WebGL2)", "Desktop + Cloud-App"],
  ["Deine Daten", "Bleiben bei dir", "Adobe Creative Cloud"],
  ["RAW im Browser", "Ja", "Nein (Desktop)"],
  ["Lokale Masken", "Linear + Radial", "Umfangreich (inkl. KI)"],
  ["Ohne Abo / offline", "Ja", "Nein"],
];

interface FaqEntry {
  readonly q: string;
  readonly a: string;
}

// Muss 1:1 mit dem FAQPage-JSON-LD in index.html uebereinstimmen.
const FAQ: readonly FaqEntry[] = [
  {
    q: "Was ist Lumen · light?",
    a: "Lumen ist ein selbst-gehosteter, browser-basierter RAW-Foto-Editor — eine schlanke Lightroom-Alternative. RAW-Dateien werden direkt im Browser via WebGL2 entwickelt, ohne Cloud-Zwang.",
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
];

function Faq({ q, a }: FaqEntry) {
  return (
    <details className="group py-3">
      <summary className="cursor-pointer text-stone-200 marker:text-amber-300/60 hover:text-amber-200">
        {q}
      </summary>
      <p className="mt-2 text-sm text-stone-400">{a}</p>
    </details>
  );
}

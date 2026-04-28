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
            to="/editor"
            data-testid="landing-cta-demo"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
          >
            Beispielbild ausprobieren
          </Link>
        </div>
      </div>

      {/* Feature-Grid */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
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
            body="Bis zu 4 lineare Verlaufsfilter und 4 Radialmasken pro Bild — Belichtung, Kontrast, Saettigung, Temperatur lokal pro Bereich."
          />
          <Feature
            title="Auto-Tone & Auto-WB"
            body="Ein Klick — Histogramm-Analyse setzt Belichtung, Whites/Blacks, Kontrast und Weissabgleich auf vernuenftige Werte. Gut fuer flaue Out-of-Camera-RAWs."
          />
          <Feature
            title="Genre-Presets"
            body="Portrait, Landschaft, Stadt, Natur, Tiere, Sport — moderate Voreinstellungen, die den Bild-Charakter unterstreichen, ohne zu uebertreiben."
          />
          <Feature
            title="Eigene Daten"
            body="Selbsthosted: Postgres + S3-kompatibles Garage. Keycloak fuer Login. Daten bleiben in deiner Hand — DELETE-/me und JSON-Export integriert."
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

      {/* Footer */}
      <div className="px-8 py-6 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-4 text-xs text-stone-500">
          <Link to="/datenschutz" className="hover:text-stone-300">
            Datenschutz
          </Link>
          <Link to="/impressum" className="hover:text-stone-300">
            Impressum
          </Link>
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

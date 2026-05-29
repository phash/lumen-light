/**
 * Impressum — TMG/DDG § 5, § 18 Abs. 2 MStV. Betreiberdaten konsistent zur
 * Hauptseite phash.de (Manuel Rödig). Lumen ist eine privat betriebene
 * Selfhost-Instanz.
 */
export default function Impressum() {
  return (
    <section data-testid="page-impressum" className="px-8 py-12 max-w-3xl mx-auto text-stone-300">
      <h1 className="text-3xl text-stone-100">Impressum</h1>
      <p className="mt-2 text-stone-500 text-sm">Stand: 2026-05-29</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Diensteanbieter</h2>
      <p className="mt-3">
        Manuel Rödig
        <br />
        Tannenweg 6
        <br />
        85405 Nandlstadt, Deutschland
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Kontakt</h2>
      <p className="mt-3">
        E-Mail:{" "}
        <a href="mailto:phash@phash.de" className="text-amber-200 hover:underline">
          phash@phash.de
        </a>
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">
        Verantwortlich i.S.d. § 18 Abs. 2 MStV
      </h2>
      <p className="mt-3">Manuel Rödig, Anschrift wie oben.</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Hosting</h2>
      <p className="mt-3">
        IONOS SE, Elgendorfer Straße 57, 56410 Montabaur, Deutschland.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">EU-Streitschlichtung</h2>
      <p className="mt-3 text-sm text-stone-400">
        Die Europäische Kommission stellt eine Plattform zur
        Online-Streitbeilegung (OS) bereit:{" "}
        <a
          href="https://ec.europa.eu/consumers/odr/"
          className="text-amber-200 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://ec.europa.eu/consumers/odr/
        </a>
        . Zur Teilnahme an einem Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht
        bereit.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Hinweis</h2>
      <p className="mt-3 text-stone-400 text-sm">
        Lumen · light ist eine privat betriebene Selfhost-Instanz — kein
        kommerzielles Angebot. Der Quellcode ist unter{" "}
        <a
          href="https://github.com/phash/lumen-light"
          className="text-amber-200 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/phash/lumen-light
        </a>{" "}
        unter der AGPL-3.0 verfügbar.
      </p>
    </section>
  );
}

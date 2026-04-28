/**
 * Impressum — TMG/DDG § 5. Bei Selfhost-Use unter Bekannten ist die
 * Pflichtschwelle umstritten („geschaeftsmaessig" vs. rein privat); der
 * Sicherheits-halber ist ein Impressum vorhanden, mit Platzhaltern
 * fuer den realen Betreiber.
 */
export default function Impressum() {
  return (
    <section data-testid="page-impressum" className="px-8 py-12 max-w-3xl mx-auto text-stone-300">
      <h1 className="text-3xl text-stone-100">Impressum</h1>
      <p className="mt-2 text-stone-500 text-sm">Stand: 2026-04-28</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Diensteanbieter</h2>
      <p className="mt-3">
        [Vor- und Nachname des Selfhost-Betreibers]
        <br />
        [Strasse Hausnummer]
        <br />
        [PLZ Ort], Deutschland
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Kontakt</h2>
      <p className="mt-3">
        E-Mail: [Email-Adresse]
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Verantwortlich nach § 18 Abs. 2 MStV</h2>
      <p className="mt-3">[Name + Anschrift wie oben]</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Hosting</h2>
      <p className="mt-3">
        IONOS SE, Elgendorfer Strasse 57, 56410 Montabaur, Deutschland.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">Hinweis</h2>
      <p className="mt-3 text-stone-400 text-sm">
        Dies ist eine privat betriebene Selfhost-Instanz von Lumen — kein
        kommerzielles Angebot, keine Registrierung fuer die Allgemeinheit.
        Der Quellcode ist unter{" "}
        <a
          href="https://github.com/lumen-light"
          className="text-amber-200 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/lumen-light
        </a>{" "}
        verfuegbar (Platzhalter — siehe Repository-URL des Projekts).
      </p>

      <p className="mt-12 text-xs text-stone-500">
        Bitte vor dem Veroeffentlichen die Platzhalter durch reale Daten
        ersetzen — Impressumsangaben muessen dem TMG/DDG entsprechen.
      </p>
    </section>
  );
}

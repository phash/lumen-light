/**
 * Datenschutzerklaerung — DSGVO Art. 13. Statisch und konservativ
 * formuliert; im Selfhost-Use-Case zwischen Bekannten genuegt das.
 *
 * Bei einem oeffentlichen Launch-Pfad muessten Verantwortlicher,
 * Datenschutzbeauftragter (falls noetig), Auftragsverarbeiter,
 * Rechtsgrundlagen und Beschwerderecht nochmal anwaltlich gegengelesen
 * werden — dieser Text ist ein Geruest, kein anwaltlich geprueftes
 * Endprodukt.
 */
export default function Datenschutz() {
  return (
    <section data-testid="page-datenschutz" className="px-8 py-12 max-w-3xl mx-auto text-stone-300">
      <h1 className="text-3xl text-stone-100">Datenschutz</h1>
      <p className="mt-2 text-stone-500 text-sm">Stand: 2026-04-28</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">1. Verantwortlicher</h2>
      <p className="mt-3">
        Verantwortlich fuer die Datenverarbeitung auf dieser Instanz ist der
        Selfhost-Betreiber (siehe Impressum). Diese Lumen-Instanz wird
        privat betrieben — kein kommerzielles Angebot.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">2. Welche Daten werden verarbeitet?</h2>
      <ul className="mt-3 list-disc pl-6 space-y-1">
        <li>
          <span className="text-stone-200">Account:</span> E-Mail-Adresse +
          Keycloak-Benutzer-ID (sub). Quelle: deine Anmeldung im
          Keycloak-Realm. Zweck: Zuordnung deiner Daten zu deinem Account.
        </li>
        <li>
          <span className="text-stone-200">Presets:</span> Bezeichnung +
          Slider-Werte + Maskendefinitionen. Inhaltlich keine PII.
        </li>
        <li>
          <span className="text-stone-200">Bilder:</span> die von dir
          hochgeladenen Originaldateien (RAW/JPEG) plus Dateiname,
          MIME-Type, Groesse, Upload-Zeitpunkt. Bilder verbleiben in
          deinem privaten Bucket-Bereich; sie werden nicht oeffentlich
          ausgeliefert. EXIF-Metadaten in JPEG werden auf Wunsch beim
          Upload entfernt (Toggle in der Bibliothek). RAW-Metadaten
          bleiben erhalten.
        </li>
        <li>
          <span className="text-stone-200">Server-Logs:</span>
          IP-Adresse, Zeitstempel, HTTP-Pfad pro Anfrage. Logs rotieren
          automatisch (10 MB pro Datei, max. 3 Generationen). Zweck:
          technischer Betrieb und Fehlerbehebung.
        </li>
      </ul>

      <h2 className="mt-8 text-xl text-stone-200 italic">3. Rechtsgrundlage</h2>
      <p className="mt-3">
        Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO
        (Vertragserfuellung — du nutzt den Dienst und stellst dafuer Daten
        bereit) bzw. lit. f (berechtigtes Interesse am stabilen Betrieb,
        z.B. Server-Logs).
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">4. Speicherort und Empfaenger</h2>
      <p className="mt-3">
        Postgres-Datenbank, Garage-S3-Bucket und Keycloak-Realm liegen auf
        einem deutschen IONOS-VPS. Es findet kein Drittlandtransfer statt.
        Auftragsverarbeiter: IONOS SE als Hoster. Keine Analytics-/
        Tracking-/CDN-Dienste.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">5. Speicherdauer</h2>
      <p className="mt-3">
        Account- und Bilddaten bleiben erhalten, bis du sie selbst
        loeschst. Du kannst alle Daten ueber{" "}
        <span className="text-amber-200">Account › Account-Daten loeschen</span>{" "}
        unwiderruflich entfernen lassen. Server-Logs werden durch die
        Rotation automatisch nach wenigen Wochen ueberschrieben.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">6. Deine Rechte</h2>
      <ul className="mt-3 list-disc pl-6 space-y-1">
        <li>Auskunft (Art. 15) — siehe „Daten exportieren“ auf Account-Seite.</li>
        <li>Berichtigung (Art. 16) — E-Mail im Keycloak-Account-UI aenderbar.</li>
        <li>Loeschung (Art. 17) — Button auf der Account-Seite.</li>
        <li>Datenuebertragbarkeit (Art. 20) — JSON-Export auf der Account-Seite.</li>
        <li>Beschwerderecht bei der zustaendigen Aufsichtsbehoerde.</li>
      </ul>

      <h2 className="mt-8 text-xl text-stone-200 italic">7. Cookies / lokale Speicher</h2>
      <p className="mt-3">
        Lumen selbst setzt keine Cookies. Keycloak setzt fuer den
        Login-Flow Session-Cookies — technisch erforderlich (Erwaegungs-
        grund 30). Im Browser-localStorage werden Einstellungen wie der
        Klapp-Status der Sidebar-Sektionen gespeichert; das ist rein
        clientseitig und nicht personenbezogen.
      </p>

      <p className="mt-12 text-xs text-stone-500">
        Dieser Text ist ein Vorlagentext. Vor einem oeffentlichen Launch
        sollte er anwaltlich geprueft werden.
      </p>
    </section>
  );
}

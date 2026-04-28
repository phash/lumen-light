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
      <p className="mt-2 text-stone-500 text-sm">Stand: 2026-04-28 (Marketplace ergaenzt)</p>

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
          <span className="text-stone-200">Profil (optional):</span>
          Handle und Bio. Werden ausschliesslich angezeigt, wenn du ein
          Preset im Marketplace veroeffentlichst — Email-Adresse bleibt
          immer privat. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1
          lit. a).
        </li>
        <li>
          <span className="text-stone-200">Presets:</span> Bezeichnung +
          Slider-Werte + Maskendefinitionen. Inhaltlich keine PII.
          Wenn du ein Preset oeffentlich machst, werden zusaetzlich
          Genre, Beschreibung und das von dir gewaehlte Vorschaubild
          fuer alle authentifizierten Marketplace-Nutzer sichtbar.
          Anwendungs- und Meldungs-Counter sind aggregiert; einzelne
          Apply-Events werden nicht protokolliert.
        </li>
        <li>
          <span className="text-stone-200">Marketplace-Meldungen:</span>
          Wenn du ein Preset meldest, speichern wir deine User-ID, das
          gemeldete Preset und den Grund (max. 500 Zeichen) zur
          Moderationsentscheidung. Loeschung mit dem gemeldeten Preset.
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
        einem deutschen IONOS-VPS. Auftragsverarbeiter: IONOS SE als Hoster.
        Bilder selbst werden ausschliesslich auf diesem VPS gespeichert.
      </p>
      <p className="mt-3">
        <span className="text-stone-200">Drittlandtransfer:</span> Wenn du
        die optionale Smart-Preset-Erkennung aktivierst (Account › Smart
        Suggestion, deaktiviert per default), laedt dein Browser einmalig
        ein Modell von Google&apos;s TensorFlow-CDN
        (<code className="text-stone-400">storage.googleapis.com</code>,
        USA). Dabei wird deine IP-Adresse + User-Agent an Google
        uebermittelt — Drittlandtransfer im Sinne von Art. 44 DSGVO.
        Rechtsgrundlage: Art. 6 Abs. 1 lit. a + Art. 49 Abs. 1 lit. a
        (ausdrueckliche Einwilligung). Die eigentliche Bilderkennung
        laeuft danach lokal in deinem Browser; deine Bilder verlassen
        deinen Rechner nicht. Zurueckziehen jederzeit ueber den Toggle.
      </p>
      <p className="mt-3">
        Keine sonstigen Analytics-/Tracking-/CDN-Dienste.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">4a. Marketplace-Sichtbarkeit</h2>
      <p className="mt-3">
        Wenn du ein Preset im Marketplace veroeffentlichst, sind das
        gewaehlte Vorschaubild, der Preset-Name, die Beschreibung,
        Genre und dein Handle (falls gesetzt) fuer alle anderen
        eingeloggten Lumen-Nutzer sichtbar. Email-Adresse bleibt immer
        privat. Veroeffentlichung ist Default deaktiviert und erfolgt
        nur durch dein aktives Setzen des Toggles. Du kannst jedes
        Preset jederzeit auf privat zuruecksetzen
        (<span className="text-amber-200">Account › Meine veroeffentlichten Presets › Zurueckziehen</span>).
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">5. Speicherdauer</h2>
      <p className="mt-3">
        Account- und Bilddaten bleiben erhalten, bis du sie selbst
        loeschst. Du kannst alle App-Daten ueber{" "}
        <span className="text-amber-200">Account › Account-Daten loeschen</span>{" "}
        unwiderruflich entfernen lassen — das umfasst Bilder, Presets
        (auch veroeffentlichte) und dein Profil. Marketplace-Meldungen,
        die du abgegeben hast, werden bei Account-Loeschung
        anonymisiert (reporter_user_id auf NULL gesetzt), damit die
        Moderationsspur fuer den gemeldeten Creator erhalten bleibt;
        deine Identitaet ist danach nicht mehr verknuepft. Server-Logs
        werden durch die Rotation automatisch nach wenigen Wochen
        ueberschrieben.
      </p>
      <p className="mt-3 text-sm text-stone-400">
        Hinweis: Der separate Keycloak-Account (Login-Daten) wird nicht
        automatisch mit-geloescht. Du kannst ihn ueber das Keycloak-
        Self-Service-UI deines Realms separat schliessen, oder den
        Selfhost-Betreiber bitten, ihn zu entfernen.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">6. Deine Rechte</h2>
      <ul className="mt-3 list-disc pl-6 space-y-1">
        <li>Auskunft (Art. 15) — siehe „Daten exportieren“ auf Account-Seite.</li>
        <li>Berichtigung (Art. 16) — E-Mail im Keycloak-Account-UI aenderbar; Handle und Bio auf der Account-Seite.</li>
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

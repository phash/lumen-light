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
      <p className="mt-2 text-stone-500 text-sm">Stand: 2026-06-13</p>

      <h2 className="mt-8 text-xl text-stone-200 italic">1. Verantwortlicher</h2>
      <p className="mt-3">
        Manuel Rödig, Tannenweg 6, 85405 Nandlstadt, Deutschland. E-Mail:{" "}
        <a href="mailto:phash@phash.de" className="text-amber-200 hover:underline">
          phash@phash.de
        </a>{" "}
        (siehe Impressum). Diese Lumen-Instanz wird privat betrieben — kein
        kommerzielles Angebot.
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
          Handle und Bio. Werden ausschließlich angezeigt, wenn du ein
          Preset im Marketplace veröffentlichst — Email-Adresse bleibt
          immer privat. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1
          lit. a).
        </li>
        <li>
          <span className="text-stone-200">Presets:</span> Bezeichnung +
          Slider-Werte + Maskendefinitionen. Inhaltlich keine PII.
          Wenn du ein Preset öffentlich machst, werden zusätzlich
          Genre, Beschreibung, das von dir gewählte Vorschaubild sowie
          dein Handle und deine Bio <span className="text-stone-200">öffentlich
          sichtbar — auch für nicht angemeldete Besucher und für
          Suchmaschinen/KI-Crawler</span>. Anwendungs- und Meldungs-Counter
          sind aggregiert; einzelne Apply-Events werden nicht protokolliert.
        </li>
        <li>
          <span className="text-stone-200">Marketplace-Meldungen:</span>
          Wenn du ein Preset meldest, speichern wir deine User-ID, das
          gemeldete Preset und den Grund (max. 500 Zeichen) zur
          Moderationsentscheidung. Löschung mit dem gemeldeten Preset.
        </li>
        <li>
          <span className="text-stone-200">Bilder:</span> die von dir
          hochgeladenen Originaldateien (RAW/JPEG) plus Dateiname,
          MIME-Type, Größe, Upload-Zeitpunkt. Bilder verbleiben in
          deinem privaten Bucket-Bereich; sie werden nicht öffentlich
          ausgeliefert. EXIF-Metadaten in JPEG werden auf Wunsch beim
          Upload entfernt (Toggle in der Bibliothek, standardmäßig an).
          <span className="text-stone-200"> Bei RAW-Dateien werden Metadaten
          (inkl. eventueller GPS-/Standortdaten) clientseitig nicht entfernt
          und bleiben in der Originaldatei erhalten</span> — sie liegen jedoch
          ausschließlich in deinem privaten Bereich und werden nie öffentlich
          ausgeliefert.
        </li>
        <li>
          <span className="text-stone-200">Bearbeitungsstand:</span> wenn du
          ein Bild im Editor bearbeitest, kann der Bearbeitungsstand
          (Slider-Werte, Masken, Crop) optional in deinem Account gespeichert
          werden, damit du auf einem zweiten Gerät weiterarbeiten kannst. Inhalt
          ist keine PII; Löschung mit dem Bild.
        </li>
        <li>
          <span className="text-stone-200">Feedback:</span> wenn du über den
          Feedback-Dialog eine Meldung schickst, speichern wir Art (Bug/Idee/
          Sonstiges), deinen Freitext, die aufgerufene Seite und deine User-ID
          zur Produktverbesserung. Rechtsgrundlage: Art. 6 Abs. 1 lit. f
          (berechtigtes Interesse an der Verbesserung des Dienstes).
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
        (Vertragserfüllung — du nutzt den Dienst und stellst dafür Daten
        bereit) bzw. lit. f (berechtigtes Interesse am stabilen Betrieb,
        z.B. Server-Logs).
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">4. Speicherort und Empfänger</h2>
      <p className="mt-3">
        Postgres-Datenbank, S3-Bucket (MinIO) und Keycloak-Realm liegen auf
        einem deutschen IONOS-VPS. Auftragsverarbeiter: IONOS SE als Hoster.
        Bilder selbst werden ausschließlich auf diesem VPS gespeichert.
      </p>
      <p className="mt-3">
        <span className="text-stone-200">Drittlandtransfer:</span> Wenn du
        die optionale Smart-Preset-Erkennung aktivierst (Account › Smart
        Suggestion, deaktiviert per default), lädt dein Browser einmalig
        ein Modell von Google&apos;s/Kaggle&apos;s TensorFlow-Hosting
        (<code className="text-stone-400">storage.googleapis.com</code>,{" "}
        <code className="text-stone-400">tfhub.dev</code>,{" "}
        <code className="text-stone-400">www.kaggle.com</code> — alle USA, je
        nach TF.js-Routing). Dabei wird deine IP-Adresse + User-Agent an
        Google/Kaggle übermittelt — Drittlandtransfer im Sinne von Art. 44 DSGVO.
        Rechtsgrundlage: Art. 6 Abs. 1 lit. a + Art. 49 Abs. 1 lit. a
        (ausdrückliche Einwilligung). Die eigentliche Bilderkennung
        läuft danach lokal in deinem Browser; deine Bilder verlassen
        deinen Rechner nicht. Zurückziehen jederzeit über den Toggle.
      </p>
      <p className="mt-3">
        Zur anonymen Reichweitenmessung nutzen wir Matomo (siehe 4b) —
        keine weiteren Tracking-, Werbe- oder Profiling-Dienste.
      </p>
      <p className="mt-3">
        <span className="text-stone-200">Externer Spenden-Link:</span> Im Footer
        verlinken wir freiwillig „Buy me a coffee“
        (<code className="text-stone-400">buymeacoffee.com</code>, USA). Erst
        wenn du diesen Link aktiv anklickst, verlässt du Lumen und gelangst zu
        einem US-Dienst, der eigene Datenschutzbestimmungen hat und dort eigene
        Daten erhebt. Auf der Lumen-Seite selbst ist davon nichts eingebettet.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">4a. Marketplace-Sichtbarkeit</h2>
      <p className="mt-3">
        Wenn du ein Preset im Marketplace veröffentlichst, sind das
        gewählte Vorschaubild, der Preset-Name, die Beschreibung,
        Genre, der Anwendungs-Zähler sowie dein Handle und deine Bio
        (falls gesetzt){" "}
        <span className="text-stone-200">
          öffentlich sichtbar — auch ohne Anmeldung. Der Marketplace darf
          von Suchmaschinen und KI-Crawlern erfasst und indexiert werden
        </span>
        . Email-Adresse bleibt immer privat. Veröffentlichung ist Default
        deaktiviert und erfolgt nur durch dein aktives Setzen des Toggles.
        Du kannst jedes Preset jederzeit auf privat zurücksetzen
        (<span className="text-amber-200">Account › Meine veröffentlichten Presets › Zurückziehen</span>).
        Nach dem Zurückziehen kann es einige Zeit dauern, bis externe
        Suchmaschinen-Caches den Eintrag entfernen; auf bereits erfolgte
        Drittkopien haben wir keinen Einfluss.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">4b. Reichweitenmessung (Matomo)</h2>
      <p className="mt-3">
        Wir betreiben eine selbst-gehostete Matomo-Instanz
        (<code className="text-stone-400">musikersuche.org/matomo</code>) zur
        anonymen Reichweitenmessung. Matomo läuft{" "}
        <span className="text-stone-200">cookieless</span> (es werden keine
        Cookies gesetzt) und ist so konfiguriert, dass es den{" "}
        <span className="text-stone-200">Do-Not-Track</span>-Header
        berücksichtigt, sofern dein Browser ihn noch sendet (viele moderne
        Browser haben DNT inzwischen entfernt — verlasse dich daher nicht
        allein darauf). Die IP-Adresse wird serverseitig anonymisiert (letzte
        Oktette entfernt). Erfasst werden nur aggregierte, nicht auf dich
        rückführbare Besuchsdaten (aufgerufene Seiten, ungefähre Region,
        Browser-/Geräte-Typ), gespeichert für maximal 24 Monate. Die Daten
        bleiben auf dem deutschen IONOS-VPS; keine Weitergabe an Dritte.
        Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an
        der bedarfsgerechten Verbesserung des Dienstes). Da cookieless,
        anonymisiert und DNT-respektierend, ist hierfür keine Einwilligung
        erforderlich.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">5. Speicherdauer</h2>
      <p className="mt-3">
        Account- und Bilddaten bleiben erhalten, bis du sie selbst
        löschst. Du kannst alle App-Daten über{" "}
        <span className="text-amber-200">Account › Account-Daten löschen</span>{" "}
        unwiderruflich entfernen lassen — das umfasst Bilder, Presets
        (auch veröffentlichte) und dein Profil. Marketplace-Meldungen,
        die du abgegeben hast, werden bei Account-Löschung
        anonymisiert (reporter_user_id auf NULL gesetzt), damit die
        Moderationsspur für den gemeldeten Creator erhalten bleibt;
        deine Identität ist danach nicht mehr verknüpft. Ebenso bleibt
        von dir abgegebenes Feedback nach der Löschung erhalten, jedoch
        anonymisiert (User-ID auf NULL gesetzt) — der Freitext selbst
        bleibt gespeichert, ist aber nicht mehr mit dir verknüpft.
        Server-Logs werden durch die Rotation automatisch nach wenigen
        Wochen überschrieben.
      </p>
      <p className="mt-3 text-sm text-stone-400">
        Hinweis: Der separate Keycloak-Account (Login-Daten) wird nicht
        automatisch mit-gelöscht. Du kannst ihn über das Keycloak-
        Self-Service-UI deines Realms separat schließen, oder den
        Selfhost-Betreiber bitten, ihn zu entfernen.
      </p>

      <h2 className="mt-8 text-xl text-stone-200 italic">6. Deine Rechte</h2>
      <ul className="mt-3 list-disc pl-6 space-y-1">
        <li>Auskunft (Art. 15) — siehe „Daten exportieren“ auf Account-Seite.</li>
        <li>Berichtigung (Art. 16) — E-Mail im Keycloak-Account-UI änderbar; Handle und Bio auf der Account-Seite.</li>
        <li>Löschung (Art. 17) — Button auf der Account-Seite.</li>
        <li>Datenübertragbarkeit (Art. 20) — JSON-Export auf der Account-Seite.</li>
        <li>Beschwerderecht bei der zuständigen Aufsichtsbehörde.</li>
      </ul>

      <h2 className="mt-8 text-xl text-stone-200 italic">7. Cookies / lokale Speicher</h2>
      <p className="mt-3">
        Lumen selbst setzt keine Cookies. Keycloak setzt für den
        Login-Flow Session-Cookies — technisch erforderlich (Erwägungs-
        grund 30). Im Browser-localStorage werden Einstellungen wie der
        Klapp-Status der Sidebar-Sektionen gespeichert; das ist rein
        clientseitig und nicht personenbezogen. Auch die Reichweitenmessung
        (Matomo, Abschnitt 4b) arbeitet cookieless.
      </p>

      <p className="mt-12 text-xs text-stone-500">
        Dieser Text ist ein Vorlagentext. Vor einem öffentlichen Launch
        sollte er anwaltlich geprüft werden.
      </p>
    </section>
  );
}

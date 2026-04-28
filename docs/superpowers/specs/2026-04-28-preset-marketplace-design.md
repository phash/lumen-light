# Preset-Marketplace · Design

**Datum:** 2026-04-28
**Phase:** F1 (Marketplace MVP) + F2 (Credits, deferred)
**Status:** Spec — noch keine Umsetzung

## Motivation

Presets sind heute pro Account isoliert. Ein User, der ein gutes
Portrait-Preset baut, kann es niemandem zeigen. Lightroom-Konkurrenz
ohne Sharing-Schicht fehlt ein zentraler Community-Loop.

Phase F1 oeffnet diese Schicht: User markieren Presets als oeffentlich,
andere durchsuchen, sehen Vorschau und wenden sie auf eigene Bilder an.
Phase F2 monetarisiert das System mit Credits — explizit nach F1.

## Phase F1 · Marketplace MVP

### Scope

Das MVP liefert genau diese Faehigkeiten — alles weitere ist Backlog:

- Preset publizieren (private → public Toggle, Genre, Beschreibung,
  Preview-Bild)
- Marketplace-Seite mit Genre-Filter und Textsuche
- Detail-Ansicht mit Vorschaubild, Beschreibung, Creator-Handle
- "Anwenden" — Adjustments + Masken werden in den Editor-State geladen
- "In meine Bibliothek kopieren" — Fork als eigenes Privat-Preset
- Reporting-Button (Spam, NSFW, Plagiat)
- Account-Seite zeigt veroeffentlichte Presets + Apply-Counter

Bewusst draussen: Rating/Sterne, Kommentare, Follower, Collections,
Featured-Slots, Suchindex (FTS), Caching, CDN, Anonymous-Browse.

### Datenmodell-Erweiterung

Migration `005_preset_marketplace`:

```sql
ALTER TABLE presets
  ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','public')),
  ADD COLUMN genre VARCHAR(40) NULL,
  ADD COLUMN description TEXT NULL,
  ADD COLUMN preview_image_id UUID NULL
    REFERENCES images(id) ON DELETE SET NULL,
  ADD COLUMN published_at TIMESTAMPTZ NULL,
  ADD COLUMN apply_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX ix_presets_marketplace
  ON presets (visibility, genre, published_at DESC)
  WHERE visibility = 'public';

ALTER TABLE users
  ADD COLUMN handle VARCHAR(40) NULL UNIQUE,
  ADD COLUMN bio TEXT NULL;

CREATE TABLE preset_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (preset_id, reporter_user_id)
);
```

`handle` ist optional. Faellt es leer, wird der Creator als
"Anonym-<UUID-Prefix>" angezeigt — keine E-Mail-Leakage im
Marketplace.

`preview_image_id` muss zum Owner gehoeren (DB-trigger oder app-level
check). Damit gilt: das Vorschaubild ist immer ein eigenes Bild des
Creators, nicht zufaellig fremdes Material.

`apply_count` und `report_count` sind Counter-Caches —
Race-Conditions tolerabel, Drift unkritisch.

### API-Endpunkte

#### Erweiterung an bestehenden Routen

`POST /api/v1/presets` und `PUT /api/v1/presets/{id}` akzeptieren
zusaetzliche Felder:

```python
class PresetWritePayload(BaseModel):
    name: str
    adjustments: Adjustments
    masks: list[Mask] = []
    visibility: Literal["private","public"] = "private"
    genre: str | None = None
    description: str | None = None
    preview_image_id: UUID | None = None
```

Server-Validierung beim Veroeffentlichen (`visibility=="public"`):
- `genre` muss aus Whitelist sein (8 Werte: portrait/landscape/city/
  nature/animals/sports/blackandwhite/other)
- `description` 10..500 Zeichen
- `preview_image_id` nicht null und gehoert dem User

Beim ersten public-set wird `published_at = NOW()` gesetzt.

#### Neue Routen

`GET /api/v1/marketplace/presets`
- Query: `genre` (optional), `q` (substring auf name/description),
  `sort` (`new` default | `popular` = apply_count desc),
  `cursor` (Pagination per `published_at` + `id`)
- Response: 24 Items pro Seite, `next_cursor` falls weiter
- Public, aber Auth required (kein Anonymous-Browse im MVP)

`GET /api/v1/marketplace/presets/{id}`
- Detail mit Creator-Handle, Genre, Beschreibung, Apply-Count,
  Preview-Bild als presigned-Download-URL (5 min TTL)

`POST /api/v1/marketplace/presets/{id}/apply`
- Authentifiziert. Inkrementiert `apply_count` (UPDATE ... SET
  apply_count = apply_count + 1).
- Antwort: `{ adjustments, masks }` — Client wendet im Editor an.
- Kein Server-Forking, keine Persistenz beim Applier.

`POST /api/v1/marketplace/presets/{id}/fork`
- Erzeugt ein neues Preset im Account des Aufrufers mit
  `name = "<orig> (Kopie)"`, `visibility=private`, ohne preview_image.
- Antwort: 201 + neue PresetOut.
- Idempotenz nicht noetig — User kann mehrfach forken.

`POST /api/v1/marketplace/presets/{id}/report`
- Body: `{ reason: string }` (max 500 Zeichen)
- Erzeugt `preset_reports`-Eintrag, inkrementiert `report_count`.
- 409 wenn der User dieses Preset schon gemeldet hat.

`GET /api/v1/users/me/published-presets`
- Liste aller eigenen public-Presets mit apply_count, report_count.

`PATCH /api/v1/users/me`
- Body: `{ handle?: string, bio?: string }`
- Validiert handle: 3..40 Zeichen, `[a-z0-9-]+`, Uniqueness.

### Rate-Limits

- `marketplace/{id}/apply`: 60/min pro User (Apply-Count-Spam)
- `marketplace/{id}/report`: 5/h pro User
- `presets` POST/PUT mit visibility=public: 20/h

Reporting hat strikte Limits, damit kein Sock-Puppet-Takedown moeglich
ist.

### Moderation (manuell im MVP)

Kein Admin-UI. Wenn `report_count >= 3`:
- Preset wird automatisch auf `visibility='private'` zurueckgesetzt
  (Auto-Hide), Creator bekommt Email-Notification (Backlog: SMTP)
- Manuelle Pruefung durch Betreiber via DB; permanenter Takedown =
  DELETE FROM presets WHERE id = ?

Whitelist-Genres + 500-Zeichen-Beschreibung halten den Spam-Vektor
klein. NSFW-Filter auf Preview-Bilder ist Backlog (CLIP/NSFW-Net).

### UI/UX

#### Neue Seite `/marketplace`

```
+------------------------------------------+
| Marketplace                  [Profil]    |
| Genres: [Alle] [Portrait] [Landschaft]…  |
| Suche: [_________________]               |
+------------------------------------------+
| [Preview] [Preview] [Preview] [Preview]  |
| Punchy-   Soft-     Cinematic Skin-      |
| Portrait  Landscape Look      Smooth     |
| @anna     @manuel   @anna     @leo       |
| Apply 142 Apply 89  Apply 12  Apply 4    |
+------------------------------------------+
```

Card-Click → Detail-Modal mit groesserer Preview, Beschreibung,
Apply-Counter, Buttons "Anwenden" + "In Bibliothek kopieren" +
Report-Icon.

#### Editor-Sidebar Erweiterung

In der Preset-Sektion:
- Bestehender "Preset speichern"-Dialog bekommt:
  - Toggle "Oeffentlich teilen"
  - Bei Toggle an: Genre-Dropdown (Pflicht), Beschreibung (Pflicht,
    10..500), Vorschaubild-Picker (Dropdown der eigenen Bilder)
- Neuer Button "Aus Marketplace anwenden" — oeffnet Marketplace im
  Modal, Apply schliesst Modal und laedt Adjustments

#### Account-Seite

Neuer Section-Block "Meine veroeffentlichten Presets":
- Liste mit name, genre, apply_count, published_at
- Button "Zuruecknehmen" → setzt visibility=private (+report_count=0)
- Button "Bearbeiten" → oeffnet Preset-Dialog

Neuer Block "Profil":
- Handle-Input (mit Uniqueness-Check beim Blur)
- Bio (max 280 Zeichen)
- Hinweis: Handle ist im Marketplace sichtbar, E-Mail nicht.

### Datenschutz / DSGVO

- Veroeffentlichung ist freiwillige Einwilligung (Art. 6 Abs. 1 lit. a).
  Toggle ist explizites Opt-In, default privat.
- Bei Account-Loeschung werden ALLE Presets geloescht — auch die
  oeffentlichen. Dadurch koennen verlinkte Presets verschwinden.
  Konsequenz dokumentieren in Datenschutz.tsx unter "Speicherdauer".
- `Datenschutz.tsx` Update: "Welche Daten werden verarbeitet?" um
  Marketplace ergaenzen — Handle, Bio, public-Presets, Vorschaubild
  werden anderen authentifizierten Usern angezeigt.
- Preview-Bild ist nicht oeffentlich (presigned-URL, 5 min TTL,
  authentifizierter Zugriff). Wer das Marketplace-API nicht erreicht,
  sieht es nicht.

### Akzeptanzkriterien Phase F1

- [ ] User kann ein Preset als public mit Genre/Description/Preview
      veroeffentlichen
- [ ] Marketplace-Liste zeigt alle public-Presets, filterbar nach Genre
- [ ] "Anwenden" laedt Adjustments + Masken in den Editor und
      inkrementiert apply_count
- [ ] "Fork" erzeugt eine private Kopie im eigenen Account
- [ ] Report bei >=3 Treffern setzt Preset automatisch auf privat
- [ ] DELETE /me loescht auch oeffentliche Presets
- [ ] Account-Seite zeigt Apply-Counter pro veroeffentlichtem Preset
- [ ] Datenschutz.tsx erwaehnt Marketplace-Datenverarbeitung
- [ ] Schema-Sync-Test deckt neue Felder ab
- [ ] E2E: Publish → Anwenden auf zweitem Account → Counter steigt

### Aufwand Phase F1

- Backend (Migration, Schemas, 7 Endpunkte, Reporting-Auto-Hide,
  Validierung): 2 Tage
- Frontend (Marketplace-Seite, Detail-Modal, Preset-Dialog-Erweiterung,
  Account-Profil-Block): 2 Tage
- E2E + Dokumentation + Datenschutz-Update: 0.5 Tag
- Gesamt: ~4.5 Tage

---

## Phase F2 · Credits (DEFERRED)

> Folgender Abschnitt ist Backlog und wird **nach** F1 in einer eigenen
> Spec ausgearbeitet. Keine Umsetzung in F1.

### Konzept

- Creator bekommt Credits pro Apply seines Presets.
- Applier zahlt mit Credits, Default-Apply ist gratis (Goodwill-Loop).
- Credits sind durch echtes Geld kaufbar (Stripe).
- Premium-Features (z.B. RAW-Export ueber 5 MP, Batch-Apply) kosten
  Credits.

### Offene Fragen vor F2-Spec

1. **Tokenomics:** Verhaeltnis Apply→Credits? Wechselkurs Credits→EUR?
   Wenn 1 Apply = 1 Credit und 100 Credits = 1 EUR, kostet ein
   "Lieblings-Preset-Apply" 1 Cent dem Creator-Pool. Das ist gerade
   so ueber dem Stripe-Mindestbetrag.
2. **Free-Tier:** Wieviele Free-Apply pro User pro Monat? 50? 200?
   Unbegrenzt mit hartem Rate-Limit?
3. **Anti-Cheat:** Sock-Puppet-Apply detect (gleicher User wendet sein
   Preset 1000x an). Apply-Counter pro Applier capped, gleiche-IP-Check,
   Behavioral-Score?
4. **Auszahlung:** Ab welchem Schwellenwert kann der Creator Credits
   in echtes Geld umwandeln? 10 EUR? 50? Steuer-Implikationen
   (Kleinunternehmer-Grenze, USt). Vermutlich braucht es eine
   "Verleihen"-Phase (Credits nur intern, nicht auszahlbar) als
   Zwischenschritt.
5. **Refund / Insolvenz-Risiko:** Wenn die Plattform zumacht, ist das
   Geld weg. Treuhand-Konto noetig?
6. **Steuerliche Rechtsform:** Selfhost privat ist ein Problem, sobald
   Geld fliesst — wahrscheinlich braucht es dafuer eine GmbH/UG. Das
   ist KEINE technische Frage, aber eine harte Voraussetzung.

### Datenmodell-Skizze (F2)

```sql
ALTER TABLE users ADD COLUMN credits BIGINT NOT NULL DEFAULT 0;

CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL,
  reason VARCHAR(40) NOT NULL,  -- 'apply_earned' | 'apply_spent' |
                                -- 'purchase' | 'edit_spent' | 'refund'
  related_preset_id UUID NULL REFERENCES presets(id) ON DELETE SET NULL,
  related_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  stripe_payment_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON credit_ledger (user_id, created_at DESC);
```

`users.credits` ist Counter-Cache, `credit_ledger` ist Source-of-Truth.
Reconciliation-Job (cron) prueft Konsistenz.

### Aufwand Phase F2 (Schaetzung)

- Backend Ledger + Stripe-Webhook + Reconciliation: 3 Tage
- Frontend Credits-UI (Balance, Kauf-Modal, Transaktions-Historie):
  2 Tage
- Anti-Cheat / Rate-Limit-Logik: 1-2 Tage
- Stripe-Setup + Test-Mode + Compliance-Doku: 1 Tag
- Rechtliche/steuerliche Klaerung: NICHT technisch, aber Blocker

Gesamt rein-technisch: ~7 Tage. Realistisch mit Recht/Stripe-Approval:
2-3 Wochen.

---

## Reihenfolge im Verhaeltnis zur bestehenden Roadmap

Die Phase-E-Roadmap hat HSL/Tonkurve/Sharpening etc. als naechste
Schritte. Marketplace (F1) ist orthogonal — kann parallel zu E1/E3
gefertigt werden, da Backend-Aenderungen sich nicht ueberlappen.

Empfehlung: **F1 nach E1+E3**, weil ein Marketplace ohne HSL und
Sharpen vermutlich Presets enthaelt, die nach den E-Updates anders
aussehen. Risiko: Schema-Drift in `adjustments`-JSONB nach E1
(`hsl: HslAdjustments`) — alle vor E1 publizierten Presets sehen nach
E1-Release noch genauso aus, weil JSONB-Default `hsl=null` neutral
ist. Also kein hartes Coupling.

Alternative: F1 sofort, vor E1. Pro: Community-Loop frueh, Beta-Feedback
formt die E-Reihenfolge. Contra: Doppelte UI-Arbeit am Preset-Dialog
nach jeder E-Iteration.

**Empfehlung im Zweifel:** F1 nach Abschluss von E1 (HSL) + E2
(Tonkurve), weil beide das Preset-JSONB erweitern und der Marketplace
mit weniger nachtraeglicher Migration auskommt.

## Was vor F1 fertig sein muss

- [ ] Wireformat-Normalisierung (D4) — JSONB-Felder konsistent
      camelCase/snake_case, sonst muessen die Marketplace-Apply-Pfade
      doppelt parsen
- [ ] Account-Datenschutz-Doku in `Datenschutz.tsx` final, weil F1
      neue Verarbeitungszwecke ergaenzt
- [ ] Selfhost-Beta mit 2-3 echten Usern, sonst ist Marketplace mit
      0 Presets sinnlos

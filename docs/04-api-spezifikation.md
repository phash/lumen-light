# 04 · API-Spezifikation

Basis-URL: `https://lumen.mr-development.de/api/v1`

Alle Bodies & Responses: `application/json`. Auth via `Authorization: Bearer <Keycloak-Access-JWT>` — siehe ADR-010.

OpenAPI-Spec wird automatisch unter `/docs` (Swagger UI) und `/redoc` von FastAPI bereitgestellt — diese Datei dient als kuratierte Übersicht.

## Auth (extern: Keycloak)

Lumen hat **keine eigenen Auth-Endpoints mehr.** Login/Logout/Refresh laufen über den Keycloak-Realm `lumen`:

| Funktion | Endpoint (Keycloak) |
|---|---|
| Login (OIDC Authorization Code + PKCE) | `https://auth.<domain>/realms/lumen/protocol/openid-connect/auth` |
| Token-Tausch | `https://auth.<domain>/realms/lumen/protocol/openid-connect/token` |
| Token-Verifikation (JWK-Set) | `https://auth.<domain>/realms/lumen/protocol/openid-connect/certs` |
| Logout | `https://auth.<domain>/realms/lumen/protocol/openid-connect/logout` |

Das Frontend nutzt eine OIDC-Library (z. B. `react-oidc-context`), die den ganzen Flow abstrahiert. Der Backend-Pfad sieht nur das fertige `Authorization: Bearer <JWT>`-Header.

### GET /me

Liefert das lokal gespiegelte User-Profil. Bei erstem Aufruf eines neuen Keycloak-Users wird die `users`-Row JIT angelegt.

**Response 200:**
```json
{
  "id": "0d9fa7cc-…",
  "email": "manuel@example.com",
  "created_at": "2026-04-27T10:00:00Z"
}
```

**Fehler:**
- `401` Token fehlt, ungültig oder abgelaufen
- `403` Token gültig, aber Realm-Mismatch oder fehlende Audience-Claim

## Presets

Alle Endpoints unter `/presets` benötigen Auth und arbeiten ausschließlich auf den Presets des eingeloggten Users.

### GET /presets

Listet alle Presets des eingeloggten Users.

**Query-Parameter (optional):**
- `q` Suche im Namen (case-insensitive substring)
- `sort` Eines von `name`, `-name`, `created_at`, `-created_at` (Default: `name`)

**Response 200:**
```json
[
  {
    "id": "11111111-…",
    "name": "Punchy",
    "adjustments": {
      "exposure": 0, "contrast": 0.3, "highlights": 0, "shadows": 0.15,
      "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
      "vibrance": 0.4, "saturation": 0
    },
    "created_at": "2026-04-27T10:00:00Z",
    "updated_at": "2026-04-27T10:00:00Z"
  }
]
```

---

### POST /presets

Legt ein neues Preset an.

**Request:**
```json
{
  "name": "Sonnenuntergang warm",
  "adjustments": {
    "exposure": -0.3,
    "contrast": 0.2,
    "highlights": -0.4,
    "shadows": 0.3,
    "whites": 0,
    "blacks": -0.1,
    "temperature": 0.25,
    "tint": -0.05,
    "vibrance": 0.3,
    "saturation": 0
  }
}
```

**Response 201:** Komplettes `PresetOut`-Objekt.

**Fehler:**
- `409` Preset-Name existiert bereits für diesen User
- `422` Adjustment-Werte außerhalb des erlaubten Bereichs

---

### PUT /presets/{id}

Aktualisiert ein Preset (Name und/oder Adjustments).

**Request:** Wie `POST /presets`.

**Response 200:** Aktualisiertes `PresetOut`.

**Fehler:**
- `403` Preset gehört einem anderen User (sollte nie auftreten, da der Service nach `user_id` filtert — landet defensiv als `404`)
- `404` Preset existiert nicht

---

### DELETE /presets/{id}

**Response 204** (kein Body)

## Images (Iteration 6+)

Direkter Pixel-Pfad ist Browser↔Garage. Backend issuiert nur Pre-Signed URLs nach Auth-Check und führt eine Metadaten-Tabelle.

### POST /images

Initiiert einen Upload. Liefert eine Pre-Signed PUT-URL zurück, die der Browser direkt nutzt, ohne die FastAPI mit Bytes zu belasten.

**Request:**
```json
{
  "filename": "IMG_0042.CR2",
  "content_type": "image/x-canon-cr2",
  "size_bytes": 24572838
}
```

**Response 201:**
```json
{
  "id": "11111111-…",
  "upload_url": "https://garage.<domain>/lumen-images/<user_id>/originals/<image_id>?X-Amz-Algorithm=…",
  "expires_in": 900
}
```

**Fehler:**
- `413` `size_bytes` über der harten 200-MB-Grenze
- `415` `content_type` nicht erlaubt (nur image/jpeg|png|tiff + RAW-Varianten)
- `422` Felder fehlen / ungültige Werte

---

### POST /images/{id}/confirm

Bestätigt, dass der Browser den Upload abgeschlossen hat. Backend prüft via S3 `HEAD`, dass das Objekt tatsächlich existiert und die Größe übereinstimmt; setzt `upload_state=ready`.

**Response 200:** vollständiges `ImageOut`-Objekt.

**Fehler:**
- `404` Image-ID gehört nicht zu diesem User oder existiert nicht
- `409` Objekt fehlt im Bucket (Upload nicht abgeschlossen) — `upload_state` bleibt `pending`, Frontend kann erneut PUT versuchen

---

### GET /images

Listet die Images des eingeloggten Users.

**Query-Parameter:**
- `state`: `ready` (default) | `pending` | `all`
- `sort`: `-created_at` (default) | `created_at` | `original_filename` | `-original_filename`

**Response 200:** Array von `ImageOut`.

---

### GET /images/{id}/url

Liefert eine Pre-Signed GET-URL für den direkten Download/Anzeige im Browser.

**Response 200:**
```json
{ "url": "https://garage.<domain>/…", "expires_in": 900 }
```

---

### DELETE /images/{id}

Löscht die DB-Zeile UND das Garage-Objekt (best effort: bei Garage-Fehler wird die DB-Zeile auf `failed`-Tombstone gesetzt und ein Re-Try-Job protokolliert — Details in Iteration 6).

**Response 204** (kein Body)

## Fehler-Format

Einheitliches Fehler-Format aller Endpoints:

```json
{
  "detail": "Menschenlesbare Beschreibung",
  "code": "PRESET_NAME_TAKEN"
}
```

`code` ist optional und für Frontend-Logik gedacht (lokalisierte Fehlermeldungen).

## Rate Limits

| Endpoint | Limit |
|---|---|
| Keycloak (`/realms/lumen/...`) | Brute-Force-Schutz von Keycloak konfiguriert (Failed-Login-Lockout) |
| `/api/v1/images` (POST init) | 30 / Minute / User |
| `/api/v1/presets/*` | 120 / Minute / User |
| Restliche `/api/v1/*` | 120 / Minute / User |

Implementiert in Caddy (`@rate_limit` Matcher) auf Cluster-Ebene.

## CORS

Backend whitelistet exakt eine Frontend-Origin via Env-Variable `CORS_ORIGIN`. Keine Wildcards in Production.

## Versionierung

URL-Präfix `/v1`. Bei Breaking Changes wird `/v2` parallel betrieben, `/v1` läuft mindestens 6 Monate weiter.

## OpenAPI-Beispiel-Generierung

FastAPI generiert die Spec automatisch. Frontend-TypeScript-Client kann via `openapi-typescript` aus `/openapi.json` generiert werden:

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/api-types.ts
```

Damit hat das Frontend exakte Typen für alle Endpoints — ohne manuelle Pflege.

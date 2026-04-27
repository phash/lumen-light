# 04 · API-Spezifikation

Basis-URL: `https://lumen.example.com/api/v1`

Alle Bodies & Responses: `application/json`. Auth via `Authorization: Bearer <jwt>`.

OpenAPI-Spec wird automatisch unter `/docs` (Swagger UI) und `/redoc` von FastAPI bereitgestellt — diese Datei dient als kuratierte Übersicht.

## Auth

### POST /auth/register

Registriert einen neuen User und legt Default-Presets an.

**Request:**
```json
{
  "email": "manuel@example.com",
  "password": "mindestens-12-zeichen-bitte"
}
```

**Response 201:**
```json
{
  "id": "0d9fa7cc-…",
  "email": "manuel@example.com",
  "created_at": "2026-04-27T10:00:00Z"
}
```

**Fehler:**
- `400` E-Mail bereits registriert
- `422` Passwort zu kurz (< 12 Zeichen)

---

### POST /auth/login

**Request:**
```json
{ "email": "manuel@example.com", "password": "…" }
```

**Response 200:**
```json
{
  "access_token": "eyJ…",
  "refresh_token": "eyJ…",
  "token_type": "bearer",
  "expires_in": 900
}
```

**Fehler:**
- `401` Ungültige Credentials (bewusst nicht zwischen "User existiert nicht" und "falsches PW" unterscheiden)

---

### POST /auth/refresh

**Request:**
```json
{ "refresh_token": "eyJ…" }
```

**Response 200:** Wie `/login`. Alter Refresh-Token wird invalidiert (Rotation).

---

### POST /auth/logout

Invalidiert den übergebenen Refresh-Token.

**Request:**
```json
{ "refresh_token": "eyJ…" }
```

**Response 204** (kein Body)

---

### GET /me

Liefert das aktuelle User-Profil.

**Response 200:**
```json
{
  "id": "0d9fa7cc-…",
  "email": "manuel@example.com",
  "created_at": "2026-04-27T10:00:00Z"
}
```

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
| `/auth/login`, `/auth/register` | 5 / Minute / IP |
| `/auth/refresh` | 30 / Minute / User |
| Restliche `/api/*` | 120 / Minute / User |

Implementiert in Nginx (`limit_req_zone`).

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

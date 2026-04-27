# 03 · Datenmodell

## Übersicht (Stand ADR-010 + ADR-011)

Mit Keycloak als IdP fällt die `refresh_tokens`-Tabelle weg, `users.password_hash` wird ersetzt durch `keycloak_sub` (UUID-String aus dem Token). Mit Garage S3 als Storage kommt `images` hinzu.

```
users                   presets                images
─────                   ───────                ──────
id (UUID, PK)           id (UUID, PK)          id (UUID, PK)
keycloak_sub (unique)   user_id (FK users)     user_id (FK users)
email (Spiegel,         name                   bucket_key (unique)
   nicht autoritativ)   adjustments (JSONB)    original_filename
created_at              created_at             content_type
                        updated_at             size_bytes
                                               upload_state
                                               created_at
                                               confirmed_at
```

`keycloak_sub` ist das **autoritative** User-Identitätsmerkmal. `email` wird beim Just-in-Time-Provisioning aus dem Token gespiegelt — bei späteren Token-Refreshs aktualisiert. Nicht für Lookups verwenden, sondern nur für die UI-Anzeige.

## SQL-DDL (Soll-Zustand)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_sub  TEXT UNIQUE NOT NULL,
    email         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_keycloak_sub ON users(keycloak_sub);

CREATE TABLE presets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    adjustments JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX idx_presets_user_id ON presets(user_id);
CREATE INDEX idx_presets_adjustments ON presets USING GIN (adjustments);

CREATE TABLE images (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bucket_key        TEXT UNIQUE NOT NULL,
    original_filename TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    size_bytes        BIGINT,
    upload_state      TEXT NOT NULL CHECK (upload_state IN ('pending','ready','failed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at      TIMESTAMPTZ
);

CREATE INDEX idx_images_user_id ON images(user_id);
CREATE INDEX idx_images_state   ON images(upload_state);
```

**Bucket-Key-Konvention:** `<user_id>/originals/<image_id>` (per-User-Prefix verhindert Cross-Tenant-Reads über S3-Listing). Backend prüft beim Issue von Pre-Signed URLs, dass der Prefix zum eingeloggten User passt — Defense in Depth zusätzlich zur Pre-Signing-Signature.

**Migrations-Plan (Iteration 4 + 6):**
- Migration `002_keycloak_schema.py`: `users.password_hash` → drop, `users.keycloak_sub` → add (NOT NULL, UNIQUE), `users.email` → drop CITEXT-Constraint (nicht mehr autoritativ). `refresh_tokens` → drop. Bestehende Daten: keine — Iteration 1 nutzt nur Test-DB.
- Migration `003_images.py`: `images`-Tabelle anlegen.

## Adjustment-Schema (JSONB)

Das `adjustments`-Feld speichert genau die Werte, die als Shader-Uniforms gesetzt werden. Single Source of Truth für Frontend & Backend ist das folgende JSON-Schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Adjustments",
  "type": "object",
  "properties": {
    "exposure":    { "type": "number", "minimum": -5, "maximum": 5 },
    "contrast":    { "type": "number", "minimum": -1, "maximum": 1 },
    "highlights":  { "type": "number", "minimum": -1, "maximum": 1 },
    "shadows":     { "type": "number", "minimum": -1, "maximum": 1 },
    "whites":      { "type": "number", "minimum": -1, "maximum": 1 },
    "blacks":      { "type": "number", "minimum": -1, "maximum": 1 },
    "temperature": { "type": "number", "minimum": -1, "maximum": 1 },
    "tint":        { "type": "number", "minimum": -1, "maximum": 1 },
    "vibrance":    { "type": "number", "minimum": -1, "maximum": 1 },
    "saturation":  { "type": "number", "minimum": -1, "maximum": 1 }
  },
  "required": [
    "exposure", "contrast", "highlights", "shadows",
    "whites", "blacks", "temperature", "tint",
    "vibrance", "saturation"
  ],
  "additionalProperties": false
}
```

**Wichtig:** Ablegen unter `backend/schemas/adjustments.schema.json` und in BEIDEN Welten konsumieren:
- Backend: Pydantic-Modell wird daraus generiert (siehe `backend/app/schemas.py`)
- Frontend: TypeScript-Typen werden daraus generiert (`json-schema-to-typescript`)

So bleiben Slider-Definitionen, Shader-Uniforms und DB-Validierung synchron.

## Schema-Evolution

Wenn neue Adjustments dazukommen (z.B. `clarity`, `dehaze`, `sharpening`), läuft der Workflow so:

1. Schema-Datei erweitern (`adjustments.schema.json`)
2. Pydantic + TS-Typen neu generieren
3. **Migration:** kein DDL nötig (JSONB ist schemafrei). Aber Daten-Migration:
   ```python
   # alembic/versions/00X_add_clarity.py
   op.execute("""
       UPDATE presets
       SET adjustments = adjustments || '{"clarity": 0}'::jsonb
       WHERE NOT (adjustments ? 'clarity')
   """)
   ```
4. Backend-Validator akzeptiert weiterhin alte Presets (die fehlende Felder mit Defaults ergänzen)

## Default-Werte für neue User

Beim Registrieren wird optional eine kleine Sammlung Standard-Presets angelegt:

```python
DEFAULT_PRESETS = [
    {"name": "Neutral",    "adjustments": {…alle 0}},
    {"name": "Punchy",     "adjustments": {"contrast": 0.3, "vibrance": 0.4, "shadows": 0.15}},
    {"name": "Soft Mood",  "adjustments": {"contrast": -0.15, "highlights": -0.3, "vibrance": -0.1}},
    {"name": "Schwarzweiß-Vorbereitung", "adjustments": {"saturation": -1, "contrast": 0.2}},
]
```

Damit hat jeder neue Account einen Startpunkt und sieht, wie Presets aussehen.

## Pydantic-Modelle (Auszug, Soll-Zustand)

```python
# backend/app/schemas.py (Soll)
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from datetime import datetime
from uuid import UUID
from typing import Literal

class Adjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exposure: float    = Field(ge=-5, le=5,  default=0)
    contrast: float    = Field(ge=-1, le=1,  default=0)
    highlights: float  = Field(ge=-1, le=1,  default=0)
    shadows: float     = Field(ge=-1, le=1,  default=0)
    whites: float      = Field(ge=-1, le=1,  default=0)
    blacks: float      = Field(ge=-1, le=1,  default=0)
    temperature: float = Field(ge=-1, le=1,  default=0)
    tint: float        = Field(ge=-1, le=1,  default=0)
    vibrance: float    = Field(ge=-1, le=1,  default=0)
    saturation: float  = Field(ge=-1, le=1,  default=0)


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    adjustments: Adjustments


class PresetOut(BaseModel):
    id: UUID
    name: str
    adjustments: Adjustments
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# --- Images (neu in Iteration 6) ---

class ImageInitIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^image/(jpeg|png|tiff|x-(canon-cr2|nikon-nef|sony-arw|fuji-raf|adobe-dng))$")
    size_bytes: int = Field(gt=0, le=200 * 1024 * 1024)  # 200 MB harte Obergrenze


class ImageInitOut(BaseModel):
    id: UUID
    upload_url: str
    expires_in: int  # Sekunden bis pre-signed URL ungueltig wird
    model_config = ConfigDict(from_attributes=True)


class ImageOut(BaseModel):
    id: UUID
    original_filename: str
    content_type: str
    size_bytes: int | None
    upload_state: Literal["pending", "ready", "failed"]
    created_at: datetime
    confirmed_at: datetime | None
    model_config = ConfigDict(from_attributes=True)
```

Was bleibt unverändert: `Adjustments` und damit `adjustments.schema.json`, `PresetIn`/`PresetOut`. Was wegfällt: `UserCreate`, `LoginRequest`, `TokenPair`, `RefreshRequest` — alles, was zur eigenen Auth gehörte.

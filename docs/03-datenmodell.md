# 03 · Datenmodell

## Übersicht

Drei Tabellen reichen für das MVP:

```
users              presets                  refresh_tokens
─────              ───────                  ──────────────
id (UUID, PK)      id (UUID, PK)            id (UUID, PK)
email (unique)     user_id (FK users)       user_id (FK users)
password_hash      name                     token_hash
created_at         adjustments (JSONB)      expires_at
                   created_at               revoked
                   updated_at
```

## SQL-DDL

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
```

`CITEXT` macht E-Mail-Vergleiche case-insensitive ohne extra `LOWER()`-Indizes.

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

## Pydantic-Modelle (Auszug)

```python
# backend/app/schemas.py
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from datetime import datetime
from uuid import UUID

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
```

Die vollständige Version liegt im Code-Skeleton in `backend/app/schemas.py`.

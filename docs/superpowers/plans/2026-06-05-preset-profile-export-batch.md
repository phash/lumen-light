# Preset-Profile: YAML-Export/Import, Schritt-Checkboxen, Batch-Anwendung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presets um YAML-Export/Import, granulare Schritt-Checkboxen beim Anwenden und nicht-destruktive Batch-Anwendung auf mehrere Bilder erweitern.

**Architecture:** Wir bauen auf dem bestehenden Preset-System auf (kein neues Entity). Eine neue nullable `geometry`-Spalte traegt Crop/Straighten/Lens. Das Gruppen->Feld-Mapping lebt als Single-Source-JSON in `backend/schemas/edit-groups.json` (Backend liest zur Laufzeit, Frontend importiert beim Build). Batch-Anwendung laeuft ueber einen neuen atomaren `POST /presets/{id}/apply`, der die angehakten Gruppen in den `image_edits`-Stand jedes Zielbilds merged. YAML ist rein client-seitig; Pydantic bleibt Validierungs-Autoritaet via `POST /presets`.

**Tech Stack:** FastAPI + async SQLAlchemy 2 + Alembic + Pydantic 2 (Backend); React 19 + Zustand 5 + TypeScript strict + `yaml` (npm) (Frontend); pytest + testcontainers, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-05-preset-profile-export-batch-design.md`

---

## File Structure

**Backend**
- Create `backend/schemas/edit-groups.json` — kanonisches Gruppen->Feld-Mapping (Single Source).
- Create `backend/app/profile_groups.py` — laedt die JSON, `GROUPS`, `KNOWN_GROUP_KEYS`, `merge_edit_state(...)`.
- Modify `backend/app/schemas.py` — `PresetGeometry`, `geometry` in `PresetIn`/`PresetOut`, `BatchApplyIn`/`BatchApplyOut`.
- Modify `backend/app/models.py` — `geometry` JSONB-Spalte auf `Preset`.
- Create `backend/alembic/versions/009_preset_geometry.py` — Migration.
- Modify `backend/app/routers/presets.py` — Geometry persistieren + `POST /presets/{id}/apply`.
- Tests: `backend/tests/test_preset_geometry.py`, `backend/tests/test_preset_batch_apply.py`, `backend/tests/test_profile_groups.py`.

**Frontend**
- Create `frontend/src/editor/profileGroups.ts` — importiert die JSON, `GROUPS`, `defaultEnabledGroups()`, `mergeGroups(...)`.
- Create `frontend/src/editor/profileYaml.ts` — `serializeProfileYaml` / `parseProfileYaml` (nutzt `yaml`).
- Create `frontend/src/editor/StepCheckboxes.tsx` — geteilte Checkbox-Gruppe (Editor + Library).
- Create `frontend/src/pages/BatchApplyModal.tsx` — Library-Batch-Modal.
- Modify `frontend/src/api/client.ts` — `PresetGeometryWire`, `geometry` in `Preset`/`PresetWritePayload`, `applyPresetBatch` + Typen.
- Modify `frontend/src/editor/store.ts` — `applyProfileGroups(...)`.
- Modify `frontend/src/editor/PresetDialog.tsx` — Schritt-Checkboxen beim Anwenden, YAML-Export/Import, Geometry beim Speichern.
- Modify `frontend/src/pages/Library.tsx` — Mehrfachauswahl + Batch-Trigger.
- Modify `frontend/package.json` — `yaml`-Dependency.
- Tests: `frontend/tests/profile-groups.test.ts`, `frontend/tests/profile-yaml.test.ts`, `frontend/e2e/preset-profile.spec.ts`.

---

## Task 1: Gruppen-Definition (Single-Source-JSON)

**Files:**
- Create: `backend/schemas/edit-groups.json`

- [ ] **Step 1: JSON anlegen**

```json
[
  { "key": "tone",   "label": "Belichtung & Ton",
    "fields": ["exposure","contrast","highlights","shadows","whites","blacks","highlightRecovery"],
    "defaultEnabled": true },
  { "key": "color",  "label": "Farbe & Weißabgleich",
    "fields": ["temperature","tint","vibrance","saturation"],
    "defaultEnabled": true },
  { "key": "hsl",    "label": "HSL-Mischer",
    "fields": ["hsl"],
    "defaultEnabled": true },
  { "key": "curve",  "label": "Tonkurve",
    "fields": ["toneCurve"],
    "defaultEnabled": true },
  { "key": "detail", "label": "Detail (Schärfe/Rauschen/Klarheit)",
    "fields": ["sharpness","noiseReduction","localContrast"],
    "defaultEnabled": true },
  { "key": "masks",  "label": "Masken",
    "fields": ["masks"],
    "defaultEnabled": true },
  { "key": "crop",   "label": "Crop & Geometrie",
    "fields": ["crop","straightenAngle"],
    "defaultEnabled": false },
  { "key": "lens",   "label": "Objektivkorrektur",
    "fields": ["lensCorrection","lensProfileId","manualLensOverride"],
    "defaultEnabled": false }
]
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas/edit-groups.json
git commit -m "feat(presets): Gruppen->Feld-Mapping als Single-Source-JSON"
```

---

## Task 2: Backend profile_groups-Modul + Merge

**Files:**
- Create: `backend/app/profile_groups.py`
- Test: `backend/tests/test_profile_groups.py`

- [ ] **Step 1: Failing test schreiben**

```python
"""Tests fuer das Gruppen-Mapping + merge_edit_state (reine Logik, keine DB)."""
from app.profile_groups import (
    GROUPS,
    KNOWN_GROUP_KEYS,
    merge_edit_state,
)
from app.schemas import Adjustments, ImageEditState


def _default_state() -> dict:
    return ImageEditState(adjustments=Adjustments()).model_dump()


def _preset_adjustments(**over) -> dict:
    return Adjustments(**over).model_dump()


def test_groups_cover_all_fields_exactly_once():
    # Jedes Adjustments-Feld + die Top-Level-Edit-Felder gehoeren zu
    # genau einer Gruppe (keine Luecke, keine Doppelung).
    expected = set(Adjustments.model_fields) | {
        "masks", "crop", "straightenAngle",
        "lensCorrection", "lensProfileId", "manualLensOverride",
    }
    seen: list[str] = []
    for g in GROUPS:
        seen.extend(g["fields"])
    assert sorted(seen) == sorted(set(seen)), "Feld doppelt vergeben"
    assert set(seen) == expected


def test_known_group_keys():
    assert KNOWN_GROUP_KEYS == {
        "tone", "color", "hsl", "curve", "detail", "masks", "crop", "lens",
    }


def test_merge_enabled_group_overwrites_only_its_fields():
    base = _default_state()
    base["adjustments"]["contrast"] = 0.9  # Bild hat schon Kontrast
    preset_adj = _preset_adjustments(exposure=0.5, contrast=-0.5)
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=preset_adj,
        preset_masks=[],
        preset_geometry=None,
        enabled=["tone"],  # exposure+contrast sind in 'tone'
    )
    # 'tone' angehakt -> exposure UND contrast aus dem Preset uebernommen
    assert merged["adjustments"]["exposure"] == 0.5
    assert merged["adjustments"]["contrast"] == -0.5


def test_merge_disabled_group_keeps_base():
    base = _default_state()
    base["adjustments"]["temperature"] = 0.7
    preset_adj = _preset_adjustments(temperature=-0.7)
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=preset_adj,
        preset_masks=[],
        preset_geometry=None,
        enabled=["tone"],  # 'color' (temperature) NICHT angehakt
    )
    assert merged["adjustments"]["temperature"] == 0.7  # Bild-Wert bleibt


def test_merge_geometry_group_pulls_from_preset_geometry():
    base = _default_state()
    geo = {
        "crop": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9},
        "straightenAngle": 0.05,
        "lensCorrection": None,
        "lensProfileId": None,
        "manualLensOverride": False,
    }
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=_preset_adjustments(),
        preset_masks=[],
        preset_geometry=geo,
        enabled=["crop"],
    )
    assert merged["crop"] == {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9}
    assert merged["straightenAngle"] == 0.05
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd backend && .venv/bin/pytest tests/test_profile_groups.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.profile_groups'`

- [ ] **Step 3: profile_groups.py implementieren**

```python
"""Gruppen->Feld-Mapping (Single Source: backend/schemas/edit-groups.json)
und der nicht-destruktive Merge fuer Batch-Apply.

Das Frontend importiert dieselbe JSON beim Build. Das Backend liest sie
zur Laufzeit (die Datei liegt unter backend/schemas/, wird also vom
Docker `COPY . .` ins Image uebernommen)."""
import json
from pathlib import Path
from typing import Any

_GROUPS_PATH = Path(__file__).resolve().parents[1] / "schemas" / "edit-groups.json"
with _GROUPS_PATH.open(encoding="utf-8") as _fh:
    GROUPS: list[dict[str, Any]] = json.load(_fh)

KNOWN_GROUP_KEYS: set[str] = {g["key"] for g in GROUPS}

# Felder, die unter state["adjustments"] liegen (vs. Top-Level-State-Felder).
_TOPLEVEL_GEOMETRY_FIELDS = (
    "crop", "straightenAngle", "lensCorrection",
    "lensProfileId", "manualLensOverride",
)
_DEFAULT_GEOMETRY: dict[str, Any] = {
    "crop": None,
    "straightenAngle": 0.0,
    "lensCorrection": None,
    "lensProfileId": None,
    "manualLensOverride": False,
}


def merge_edit_state(
    *,
    base_state: dict,
    preset_adjustments: dict,
    preset_masks: list,
    preset_geometry: dict | None,
    enabled: list[str],
) -> dict:
    """Baut einen neuen Edit-State (camelCase-Dict): startet vom
    `base_state` des Bildes und ueberschreibt fuer jede angehakte Gruppe
    deren Felder aus dem Preset. Nicht-angehakte Gruppen bleiben unberuehrt.

    Das Ergebnis ist ein roher Dict — der Aufrufer validiert ihn ueber
    `ImageEditState.model_validate(...)` (Ranges, Mask-Caps)."""
    enabled_set = set(enabled)
    state: dict[str, Any] = {
        "adjustments": dict(base_state.get("adjustments", {})),
        "masks": base_state.get("masks", []),
        "crop": base_state.get("crop"),
        "straightenAngle": base_state.get("straightenAngle", 0.0),
        "lensCorrection": base_state.get("lensCorrection"),
        "lensProfileId": base_state.get("lensProfileId"),
        "manualLensOverride": base_state.get("manualLensOverride", False),
    }
    geo = preset_geometry or _DEFAULT_GEOMETRY
    for group in GROUPS:
        if group["key"] not in enabled_set:
            continue
        for field in group["fields"]:
            if field == "masks":
                state["masks"] = preset_masks
            elif field in _TOPLEVEL_GEOMETRY_FIELDS:
                state[field] = geo.get(field, _DEFAULT_GEOMETRY[field])
            else:  # Adjustment-Skalar, hsl oder toneCurve
                state["adjustments"][field] = preset_adjustments.get(field)
    return state
```

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd backend && .venv/bin/pytest tests/test_profile_groups.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/profile_groups.py backend/tests/test_profile_groups.py
git commit -m "feat(presets): profile_groups-Modul + nicht-destruktiver Merge"
```

---

## Task 3: Schema-Erweiterung (Geometry + Batch-Apply-DTOs)

**Files:**
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_profile_groups.py` (ergaenzen)

- [ ] **Step 1: Failing test fuer das Schema-Verhalten**

Am Ende von `backend/tests/test_profile_groups.py` anfuegen:

```python
def test_batch_apply_in_rejects_unknown_group():
    import pytest
    from pydantic import ValidationError
    from app.schemas import BatchApplyIn
    from uuid import uuid4

    with pytest.raises(ValidationError):
        BatchApplyIn(imageIds=[uuid4()], groups=["tone", "voodoo"])


def test_preset_geometry_defaults():
    from app.schemas import PresetGeometry

    g = PresetGeometry()
    assert g.crop is None
    assert g.straighten_angle == 0
    assert g.manual_lens_override is False
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd backend && .venv/bin/pytest tests/test_profile_groups.py -q`
Expected: FAIL — `ImportError: cannot import name 'BatchApplyIn'`

- [ ] **Step 3: Schemas implementieren**

In `backend/app/schemas.py` nach der `Adjustments`-Klasse (vor `# ----- User -----`) die Geometry-Modelle ergaenzen:

```python
class PresetGeometry(BaseModel):
    """Geometrie-Teil eines Presets (Crop/Straighten/Lens). Form identisch
    zu den Geometrie-Feldern in ImageEditState; Crop/LensCorrection bleiben
    opake dicts (Pixel-Pfad lebt im Frontend)."""
    model_config = CAMEL_BASE_CONFIG
    crop: dict | None = None
    straighten_angle: float = Field(default=0, ge=-3.15, le=3.15)
    lens_correction: dict | None = None
    lens_profile_id: str | None = Field(default=None, max_length=80)
    manual_lens_override: bool = False
```

In `PresetIn` ein Feld nach `masks` ergaenzen:

```python
    geometry: PresetGeometry | None = None
```

In `PresetOut` nach `masks` ergaenzen:

```python
    geometry: PresetGeometry | None
```

Am Ende der Marketplace-/Preset-Sektion (nach `PresetReportIn`) die Batch-DTOs anfuegen. Der Import von `KNOWN_GROUP_KEYS` steht oben bei den anderen Imports:

```python
from app.profile_groups import KNOWN_GROUP_KEYS
```

```python
class BatchApplyIn(BaseModel):
    """Profil auf mehrere Bilder anwenden. `groups` = angehakte
    Schritt-Gruppen-Keys; unbekannte Keys -> 422."""
    model_config = CAMEL_BASE_CONFIG
    image_ids: list[UUID] = Field(min_length=1, max_length=200)
    groups: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_groups(self) -> Self:
        unknown = [g for g in self.groups if g not in KNOWN_GROUP_KEYS]
        if unknown:
            raise ValueError(f"Unbekannte Gruppen: {unknown}")
        return self


class BatchApplyOut(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    applied: int
    total: int
```

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd backend && .venv/bin/pytest tests/test_profile_groups.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/tests/test_profile_groups.py
git commit -m "feat(presets): PresetGeometry + BatchApply-DTOs im Schema"
```

---

## Task 4: Migration 009 + Model-Spalte

**Files:**
- Modify: `backend/app/models.py:62-69` (Preset-Klasse, nach `masks`)
- Create: `backend/alembic/versions/009_preset_geometry.py`

- [ ] **Step 1: Model-Spalte ergaenzen**

In `backend/app/models.py` in der `Preset`-Klasse direkt nach dem `masks`-Mapped-Column einfuegen:

```python
    geometry: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

- [ ] **Step 2: Migration schreiben**

`backend/alembic/versions/009_preset_geometry.py`:

```python
"""presets.geometry-Spalte (Crop/Straighten/Lens fuer Bearbeitungs-Profile)

Additiv, nullable -> keine Daten-Migration noetig. Bestehende Presets
haben geometry=NULL (= keine Geometrie).

Revision ID: 009_preset_geometry
Revises: 008_image_edits
Create Date: 2026-06-05 12:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "009_preset_geometry"
down_revision = "008_image_edits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "presets",
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("presets", "geometry")
```

- [ ] **Step 3: Migration anwenden (lokal)**

Run:
```bash
cd backend && DATABASE_URL="postgresql+asyncpg://lumen:lumen@localhost:5433/lumen" \
  .venv/bin/alembic upgrade head
```
Expected: `Running upgrade 008_image_edits -> 009_preset_geometry`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/009_preset_geometry.py
git commit -m "feat(presets): Migration 009 + geometry-Spalte"
```

---

## Task 5: Presets-Router — Geometry persistieren

**Files:**
- Modify: `backend/app/routers/presets.py:98-116` (create), `:137-139` (update)
- Test: `backend/tests/test_preset_geometry.py`

- [ ] **Step 1: Failing test**

`backend/tests/test_preset_geometry.py`:

```python
"""Geometry-Round-Trip im Preset-CRUD."""

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}

GEOMETRY = {
    "crop": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.8},
    "straightenAngle": 0.05,
    "lensCorrection": {"distortion": 0.2, "vignette": 0.0, "tcaR": 0.0, "tcaB": 0.0},
    "lensProfileId": "canon-rf-24-105",
    "manualLensOverride": True,
}


async def test_create_preset_with_geometry_roundtrips(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Mit Geometrie", "adjustments": ZERO_ADJ, "geometry": GEOMETRY},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["geometry"]["crop"] == GEOMETRY["crop"]
    assert body["geometry"]["lensProfileId"] == "canon-rf-24-105"
    assert body["geometry"]["manualLensOverride"] is True


async def test_create_preset_without_geometry_is_null(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Ohne Geometrie", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201
    assert r.json()["geometry"] is None
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd backend && .venv/bin/pytest tests/test_preset_geometry.py -q`
Expected: FAIL — `KeyError: 'geometry'` (Response enthaelt das Feld noch nicht)

- [ ] **Step 3: create_preset + update_preset anpassen**

In `create_preset` den `Preset(...)`-Aufruf um geometry erweitern (nach `masks=...`):

```python
        geometry=payload.geometry.model_dump() if payload.geometry else None,
```

In `update_preset` nach `p.masks = [m.model_dump() for m in payload.masks]` einfuegen:

```python
    p.geometry = payload.geometry.model_dump() if payload.geometry else None
```

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd backend && .venv/bin/pytest tests/test_preset_geometry.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/presets.py backend/tests/test_preset_geometry.py
git commit -m "feat(presets): geometry in Preset-CRUD persistieren"
```

---

## Task 6: Batch-Apply-Endpoint `POST /presets/{id}/apply`

**Files:**
- Modify: `backend/app/routers/presets.py` (Imports + neuer Endpoint am Dateiende)
- Test: `backend/tests/test_preset_batch_apply.py`

- [ ] **Step 1: Failing tests**

`backend/tests/test_preset_batch_apply.py`:

```python
"""Batch-Apply: Profil auf mehrere Bilder anwenden (POST /presets/{id}/apply)."""
import io
from PIL import Image as PILImage

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}


async def _make_ready_image(client, headers) -> str:
    """Legt ein Bild an, laedt JPEG-Bytes per Pre-Signed PUT hoch, confirmt."""
    buf = io.BytesIO()
    PILImage.new("RGB", (8, 8), (120, 120, 120)).save(buf, format="JPEG")
    data = buf.getvalue()
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={"filename": "x.jpg", "contentType": "image/jpeg", "sizeBytes": len(data)},
    )
    assert init.status_code == 201, init.text
    image_id = init.json()["id"]
    upload_url = init.json()["uploadUrl"]
    import httpx
    async with httpx.AsyncClient() as raw:
        put = await raw.put(upload_url, content=data, headers={"Content-Type": "image/jpeg"})
        assert put.status_code in (200, 204), put.text
    conf = await client.post(f"/api/v1/images/{image_id}/confirm", headers=headers)
    assert conf.status_code == 200, conf.text
    return image_id


async def _create_preset(client, headers, name, **over) -> str:
    body = {"name": name, "adjustments": {**ZERO_ADJ, **over.pop("adjustments", {})}}
    body.update(over)
    r = await client.post("/api/v1/presets", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_batch_apply_sets_enabled_group_on_targets(client, user_a):
    img1 = await _make_ready_image(client, user_a["headers"])
    img2 = await _make_ready_image(client, user_a["headers"])
    preset_id = await _create_preset(
        client, user_a["headers"], "Kontrast-Look",
        adjustments={"contrast": 0.6, "temperature": 0.5},
    )
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img1, img2], "groups": ["tone"]},  # contrast in tone
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"applied": 2, "total": 2}
    # tone angehakt -> contrast uebernommen; color NICHT -> temperature bleibt 0
    e1 = await client.get(f"/api/v1/images/{img1}/edit", headers=user_a["headers"])
    assert e1.status_code == 200
    assert e1.json()["adjustments"]["contrast"] == 0.6
    assert e1.json()["adjustments"]["temperature"] == 0.0


async def test_batch_apply_merges_keeps_untoggled_existing(client, user_a):
    img = await _make_ready_image(client, user_a["headers"])
    # Bild hat schon einen Edit-State mit temperature=0.7
    pre = await client.put(
        f"/api/v1/images/{img}/edit",
        headers=user_a["headers"],
        json={"adjustments": {**ZERO_ADJ, "temperature": 0.7}, "masks": []},
    )
    assert pre.status_code == 204
    preset_id = await _create_preset(
        client, user_a["headers"], "Nur-Ton", adjustments={"contrast": 0.4, "temperature": -0.4},
    )
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["tone"]},  # color NICHT angehakt
    )
    assert r.status_code == 200
    e = await client.get(f"/api/v1/images/{img}/edit", headers=user_a["headers"])
    assert e.json()["adjustments"]["contrast"] == 0.4    # tone uebernommen
    assert e.json()["adjustments"]["temperature"] == 0.7  # color-Wert bleibt


async def test_batch_apply_foreign_image_rejected_no_mutation(client, user_a, user_b):
    own = await _make_ready_image(client, user_a["headers"])
    foreign = await _make_ready_image(client, user_b["headers"])
    preset_id = await _create_preset(client, user_a["headers"], "X", adjustments={"contrast": 0.5})
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [own, foreign], "groups": ["tone"]},
    )
    assert r.status_code == 400
    # Keine Mutation am eigenen Bild (kein gespeicherter Stand entstanden)
    e = await client.get(f"/api/v1/images/{own}/edit", headers=user_a["headers"])
    assert e.status_code == 404


async def test_batch_apply_unknown_group_returns_422(client, user_a):
    img = await _make_ready_image(client, user_a["headers"])
    preset_id = await _create_preset(client, user_a["headers"], "Y")
    r = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [img], "groups": ["voodoo"]},
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Tests laufen, schlagen fehl**

Run: `cd backend && .venv/bin/pytest tests/test_preset_batch_apply.py -q`
Expected: FAIL — 404/405 (Endpoint existiert noch nicht)

- [ ] **Step 3: Endpoint implementieren**

In `backend/app/routers/presets.py` die Imports ergaenzen:

```python
from app.models import Image, ImageEdit, Preset, User
from app.profile_groups import merge_edit_state
from app.schemas import (
    Adjustments,
    BatchApplyIn,
    BatchApplyOut,
    ImageEditState,
    PresetIn,
    PresetOut,
)
```

Am Dateiende den Endpoint anfuegen:

```python
@router.post("/{preset_id}/apply", response_model=BatchApplyOut)
@limiter.limit("30/minute")
async def apply_preset_batch(
    request: Request,
    preset_id: UUID,
    payload: BatchApplyIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> BatchApplyOut:
    """Wendet die angehakten Schritt-Gruppen eines Presets nicht-destruktiv
    auf den gespeicherten Edit-State mehrerer eigener Bilder an. All-or-
    nothing: Ownership/Ready wird vorab geprueft, dann ein Commit."""
    preset = (
        await db.execute(
            select(Preset).where(
                Preset.id == preset_id, Preset.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")

    image_ids = list(dict.fromkeys(payload.image_ids))  # dedupe, Reihenfolge egal
    images = (
        await db.execute(
            select(Image).where(
                Image.id.in_(image_ids),
                Image.user_id == user.id,
                Image.upload_state == "ready",
            )
        )
    ).scalars().all()
    if len(images) != len(image_ids):
        raise HTTPException(
            status_code=400,
            detail="Mindestens ein Bild ist fremd, unbekannt oder nicht ready.",
        )

    existing_edits = {
        e.image_id: e
        for e in (
            await db.execute(
                select(ImageEdit).where(ImageEdit.image_id.in_(image_ids))
            )
        ).scalars().all()
    }
    default_state = ImageEditState(adjustments=Adjustments()).model_dump()

    for image_id in image_ids:
        edit = existing_edits.get(image_id)
        base_state = edit.state if edit is not None else default_state
        merged = merge_edit_state(
            base_state=base_state,
            preset_adjustments=preset.adjustments,
            preset_masks=preset.masks,
            preset_geometry=preset.geometry,
            enabled=payload.groups,
        )
        # Validierung (Ranges, Mask-Caps) + Normalisierung auf camelCase.
        validated = ImageEditState.model_validate(merged).model_dump()
        if edit is None:
            db.add(ImageEdit(image_id=image_id, state=validated))
        else:
            edit.state = validated

    await db.commit()
    return BatchApplyOut(applied=len(image_ids), total=len(image_ids))
```

- [ ] **Step 4: Tests laufen, sind gruen**

Run: `cd backend && .venv/bin/pytest tests/test_preset_batch_apply.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Volle Backend-Suite + Commit**

Run: `cd backend && .venv/bin/pytest -q`
Expected: PASS (alle bestehenden Tests bleiben gruen)

```bash
git add backend/app/routers/presets.py backend/tests/test_preset_batch_apply.py
git commit -m "feat(presets): atomarer Batch-Apply-Endpoint"
```

---

## Task 7: Frontend — yaml-Dependency + API-Client-Typen

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: yaml installieren**

Run: `cd frontend && pnpm add yaml`
Expected: `yaml` erscheint unter `dependencies` in `package.json`.

- [ ] **Step 2: Client-Typen erweitern**

In `frontend/src/api/client.ts` nach `LensCorrectionWire` (ca. Zeile 173) ergaenzen:

```typescript
export interface PresetGeometryWire {
  crop: CropRectWire | null;
  straightenAngle: number;
  lensCorrection: LensCorrectionWire | null;
  lensProfileId: string | null;
  manualLensOverride: boolean;
}
```

`Preset` (nach `masks`) und `PresetWritePayload` (nach `masks?`) je um geometry erweitern:

```typescript
  geometry: PresetGeometryWire | null;   // in Preset
```
```typescript
  geometry?: PresetGeometryWire | null;  // in PresetWritePayload
```

Nach `MarketplaceApply` die Batch-Typen ergaenzen:

```typescript
export interface BatchApplyResult {
  applied: number;
  total: number;
}
```

Im `ApiClient`-Interface nach `deletePreset`:

```typescript
  applyPresetBatch(
    id: string,
    payload: { imageIds: string[]; groups: string[] },
  ): Promise<BatchApplyResult>;
```

In der `createApiClient`-Implementierung nach `deletePreset`:

```typescript
    applyPresetBatch: (id, payload) =>
      request<BatchApplyResult>(`/presets/${id}/apply`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS (keine Fehler)

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/api/client.ts
git commit -m "feat(presets): yaml-dep + geometry/batch-apply API-Typen"
```

---

## Task 8: Frontend — profileGroups (Import JSON + mergeGroups)

**Files:**
- Create: `frontend/src/editor/profileGroups.ts`
- Test: `frontend/tests/profile-groups.test.ts`

- [ ] **Step 1: Failing test**

`frontend/tests/profile-groups.test.ts`:

```typescript
import { describe, expect, test } from "vitest";

import type { ImageEditState } from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import { GROUPS, defaultEnabledGroups, mergeGroups } from "../src/editor/profileGroups";

const TOPLEVEL = [
  "masks", "crop", "straightenAngle",
  "lensCorrection", "lensProfileId", "manualLensOverride",
] as const;

function baseEdit(): ImageEditState {
  return {
    adjustments: defaultAdjustments(),
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

describe("profileGroups", () => {
  test("jedes bekannte Feld gehoert zu genau einer Gruppe", () => {
    const adjKeys = Object.keys(defaultAdjustments()); // 14 Skalare + hsl + toneCurve
    const expected = [...adjKeys, ...TOPLEVEL].sort();
    const seen = GROUPS.flatMap((g) => g.fields);
    expect([...seen].sort()).toEqual([...new Set(seen)].sort()); // keine Doppelung
    expect([...new Set(seen)].sort()).toEqual(expected);
  });

  test("defaultEnabledGroups: alles ausser crop/lens", () => {
    const en = defaultEnabledGroups();
    expect(en.has("tone")).toBe(true);
    expect(en.has("crop")).toBe(false);
    expect(en.has("lens")).toBe(false);
  });

  test("mergeGroups: angehakte Gruppe ueberschreibt, andere bleiben", () => {
    const base = baseEdit();
    base.adjustments = { ...base.adjustments, temperature: 0.7 };
    const profile: ImageEditState = {
      ...baseEdit(),
      adjustments: { ...defaultAdjustments(), contrast: 0.5, temperature: -0.5 },
    };
    const merged = mergeGroups(base, profile, new Set(["tone"]));
    expect(merged.adjustments.contrast).toBe(0.5);   // tone uebernommen
    expect(merged.adjustments.temperature).toBe(0.7); // color blieb (Bild-Wert)
  });

  test("mergeGroups: crop-Gruppe zieht Geometrie aus Profil", () => {
    const base = baseEdit();
    const profile: ImageEditState = {
      ...baseEdit(),
      crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
      straightenAngle: 0.05,
    };
    const merged = mergeGroups(base, profile, new Set(["crop"]));
    expect(merged.crop).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(merged.straightenAngle).toBe(0.05);
  });
});
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd frontend && pnpm test -- profile-groups`
Expected: FAIL — Cannot find module `../src/editor/profileGroups`

- [ ] **Step 3: profileGroups.ts implementieren**

```typescript
/**
 * Schritt-Gruppen fuer Bearbeitungs-Profile. Single Source ist
 * backend/schemas/edit-groups.json (das Backend liest dieselbe Datei zur
 * Laufzeit). Hier wird sie beim Build importiert — der Vite-Build-Context
 * ist das Repo-Root, daher ist der Cross-Pfad-Import zulaessig (gleiches
 * Muster wie lensProfile.ts mit infra/lensfun/profiles.json).
 */
import type { ImageEditState } from "../api/client";
import groupsData from "../../../backend/schemas/edit-groups.json";

export interface EditGroup {
  readonly key: string;
  readonly label: string;
  readonly fields: ReadonlyArray<string>;
  readonly defaultEnabled: boolean;
}

export const GROUPS = groupsData as ReadonlyArray<EditGroup>;

export function defaultEnabledGroups(): Set<string> {
  return new Set(GROUPS.filter((g) => g.defaultEnabled).map((g) => g.key));
}

const TOPLEVEL_GEOMETRY = new Set([
  "crop",
  "straightenAngle",
  "lensCorrection",
  "lensProfileId",
  "manualLensOverride",
]);

/**
 * Baut einen neuen Edit-State: startet vom `base` des Bildes und
 * ueberschreibt fuer jede angehakte Gruppe deren Felder aus `profile`.
 * Nicht-angehakte Gruppen bleiben unveraendert. Reine Funktion.
 */
export function mergeGroups(
  base: ImageEditState,
  profile: ImageEditState,
  enabled: ReadonlySet<string>,
): ImageEditState {
  const adjustments = { ...base.adjustments };
  const next: ImageEditState = {
    adjustments,
    masks: base.masks,
    crop: base.crop,
    straightenAngle: base.straightenAngle,
    lensCorrection: base.lensCorrection,
    lensProfileId: base.lensProfileId,
    manualLensOverride: base.manualLensOverride,
  };
  for (const group of GROUPS) {
    if (!enabled.has(group.key)) continue;
    for (const field of group.fields) {
      if (field === "masks") {
        next.masks = profile.masks;
      } else if (TOPLEVEL_GEOMETRY.has(field)) {
        // Top-Level-Geometrie-Feld
        (next as unknown as Record<string, unknown>)[field] =
          (profile as unknown as Record<string, unknown>)[field];
      } else {
        // Adjustment-Skalar, hsl oder toneCurve
        (adjustments as unknown as Record<string, unknown>)[field] =
          (profile.adjustments as unknown as Record<string, unknown>)[field];
      }
    }
  }
  return next;
}
```

Falls `tsc` den JSON-Import nicht typt: in `frontend/tsconfig.json` sicherstellen, dass `resolveJsonModule: true` gesetzt ist (ist es bereits, da `lensProfile.ts` JSON importiert).

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd frontend && pnpm test -- profile-groups`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/profileGroups.ts frontend/tests/profile-groups.test.ts
git commit -m "feat(presets): profileGroups + mergeGroups (Single-Source-JSON)"
```

---

## Task 9: Frontend — YAML Serialize/Parse

**Files:**
- Create: `frontend/src/editor/profileYaml.ts`
- Test: `frontend/tests/profile-yaml.test.ts`

- [ ] **Step 1: Failing test**

`frontend/tests/profile-yaml.test.ts`:

```typescript
import { describe, expect, test } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { parseProfileYaml, serializeProfileYaml } from "../src/editor/profileYaml";

describe("profileYaml", () => {
  test("Round-Trip erhaelt name/adjustments/masks/geometry", () => {
    const profile = {
      name: "Mein Look",
      adjustments: { ...defaultAdjustments(), contrast: 0.3 },
      masks: [],
      geometry: {
        crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
    };
    const text = serializeProfileYaml(profile);
    const parsed = parseProfileYaml(text);
    expect(parsed.name).toBe("Mein Look");
    expect(parsed.adjustments.contrast).toBe(0.3);
    expect(parsed.geometry?.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  test("falsche Version wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 99\nname: x\nadjustments: {}\n")).toThrow();
  });

  test("fehlender Name wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 1\nadjustments: {}\n")).toThrow();
  });
});
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd frontend && pnpm test -- profile-yaml`
Expected: FAIL — Cannot find module `../src/editor/profileYaml`

- [ ] **Step 3: profileYaml.ts implementieren**

```typescript
/**
 * YAML-Serialisierung fuer Bearbeitungs-Profile. Rein client-seitig —
 * beim Import wird die geparste Struktur via POST /presets ans Backend
 * geschickt, das Pydantic (extra=forbid, Ranges, Mask-Caps) validiert.
 * Hier nur ein leichter Shape-Check fuer fruehe, freundliche Fehler.
 */
import { parse, stringify } from "yaml";

import type {
  Adjustments,
  PresetGeometryWire,
  PresetMask,
} from "../api/client";

const PROFILE_VERSION = 1;

export interface ProfileFile {
  name: string;
  adjustments: Adjustments;
  masks: PresetMask[];
  geometry?: PresetGeometryWire | null;
}

export function serializeProfileYaml(p: ProfileFile): string {
  return stringify({
    lumenProfile: PROFILE_VERSION,
    name: p.name,
    adjustments: p.adjustments,
    masks: p.masks,
    geometry: p.geometry ?? null,
  });
}

export function parseProfileYaml(text: string): ProfileFile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    throw new Error("Ungültige YAML-Datei.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Profil-Datei ist leer oder kein Objekt.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.lumenProfile !== PROFILE_VERSION) {
    throw new Error(
      `Nicht unterstützte Profil-Version (erwartet ${PROFILE_VERSION}).`,
    );
  }
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    throw new Error("Profil-Datei hat keinen gültigen Namen.");
  }
  if (typeof obj.adjustments !== "object" || obj.adjustments === null) {
    throw new Error("Profil-Datei hat keine Anpassungen.");
  }
  return {
    name: obj.name,
    adjustments: obj.adjustments as Adjustments,
    masks: Array.isArray(obj.masks) ? (obj.masks as PresetMask[]) : [],
    geometry: (obj.geometry ?? null) as PresetGeometryWire | null,
  };
}
```

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd frontend && pnpm test -- profile-yaml`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/editor/profileYaml.ts frontend/tests/profile-yaml.test.ts
git commit -m "feat(presets): YAML Serialize/Parse fuer Profile"
```

---

## Task 10: Store — applyProfileGroups

**Files:**
- Modify: `frontend/src/editor/store.ts` (Interface + Implementierung)
- Test: `frontend/tests/profile-groups.test.ts` (Store-Test ergaenzen)

- [ ] **Step 1: Failing test ergaenzen**

Am Ende von `frontend/tests/profile-groups.test.ts`:

```typescript
import { useEditorStore } from "../src/editor/store";

describe("store.applyProfileGroups", () => {
  test("merged Profil-Gruppen in den Store, eine Undo-Stufe", () => {
    const store = useEditorStore.getState();
    store.resetAll();
    store.setAdjustment("temperature", 0.7);
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().applyProfileGroups(
      {
        adjustments: { ...defaultAdjustments(), contrast: 0.5, temperature: -0.5 },
        masks: [],
        crop: null,
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
      new Set(["tone"]),
    );
    const s = useEditorStore.getState();
    expect(s.adjustments.contrast).toBe(0.5);     // tone uebernommen
    expect(s.adjustments.temperature).toBe(0.7);  // color blieb
    expect(s.past.length).toBe(before + 1);       // genau ein Snapshot
  });
});
```

- [ ] **Step 2: Test laeuft, schlaegt fehl**

Run: `cd frontend && pnpm test -- profile-groups`
Expected: FAIL — `applyProfileGroups is not a function`

- [ ] **Step 3: Store erweitern**

In `frontend/src/editor/store.ts` die Imports ergaenzen:

```typescript
import type { ImageEditState } from "../api/client";
import { mergeGroups } from "./profileGroups";
import { masksToWire, wireToMasks } from "./maskSerializer";
```

Im `EditorState`-Interface nach `applyEditState` die Signatur ergaenzen:

```typescript
  /** Merged die angehakten Profil-Gruppen nicht-destruktiv in den aktuellen
   *  Stand des offenen Bildes. Ein History-Snapshot (undobar). */
  applyProfileGroups: (
    profile: ImageEditState,
    enabled: ReadonlySet<string>,
  ) => void;
```

In der Store-Implementierung (nach `applyEditState`):

```typescript
  applyProfileGroups: (profile, enabled) => {
    _snapshotBefore(get());
    set((state) => {
      const base: ImageEditState = {
        adjustments: state.adjustments,
        masks: masksToWire(state.masks),
        crop: state.cropRect,
        straightenAngle: state.straightenAngle,
        lensCorrection: state.lensCorrection,
        lensProfileId: state.lensProfileId,
        manualLensOverride: state.manualLensOverride,
      };
      const merged = mergeGroups(base, profile, enabled);
      return {
        adjustments: merged.adjustments,
        masks: wireToMasks(merged.masks),
        selectedMaskId: null,
        cropRect: merged.crop ?? state.cropRect,
        straightenAngle: merged.straightenAngle,
        lensCorrection: merged.lensCorrection ?? state.lensCorrection,
        lensProfileId: merged.lensProfileId,
        manualLensOverride: merged.manualLensOverride,
      };
    });
  },
```

Hinweis: `base.crop` ist `state.cropRect` (gleiche Struktur `{x0,y0,x1,y1}`); `CropRectWire` und `CropRect` sind strukturell identisch, ebenso `LensCorrectionWire`/`LensCorrection`.

- [ ] **Step 4: Test laeuft, ist gruen**

Run: `cd frontend && pnpm test -- profile-groups`
Expected: PASS (5 passed)

- [ ] **Step 5: Typecheck + Commit**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS

```bash
git add frontend/src/editor/store.ts frontend/tests/profile-groups.test.ts
git commit -m "feat(presets): store.applyProfileGroups (gruppenweises Merge)"
```

---

## Task 11: StepCheckboxes-Komponente

**Files:**
- Create: `frontend/src/editor/StepCheckboxes.tsx`

- [ ] **Step 1: Komponente implementieren**

```tsx
import { GROUPS } from "./profileGroups";

interface Props {
  readonly enabled: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

/** Geteilte Schritt-Checkboxen (Editor + Library-Batch). crop/lens sind
 *  bildspezifisch — daher der Hinweis und default aus. */
export default function StepCheckboxes({ enabled, onToggle }: Props) {
  return (
    <div data-testid="step-checkboxes" className="space-y-1.5">
      {GROUPS.map((g) => {
        const isImageSpecific = g.key === "crop" || g.key === "lens";
        return (
          <label
            key={g.key}
            className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer"
          >
            <input
              type="checkbox"
              data-testid={`step-${g.key}`}
              checked={enabled.has(g.key)}
              onChange={() => onToggle(g.key)}
              className="accent-amber-300"
            />
            <span>{g.label}</span>
            {isImageSpecific && (
              <span className="text-[10px] text-stone-500">(bildspezifisch)</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/editor/StepCheckboxes.tsx
git commit -m "feat(presets): StepCheckboxes-Komponente"
```

---

## Task 12: PresetDialog — Anwenden mit Checkboxen, YAML-Export/Import, Geometry beim Speichern

**Files:**
- Modify: `frontend/src/editor/PresetDialog.tsx`

- [ ] **Step 1: State + Imports ergaenzen**

Imports oben ergaenzen:

```typescript
import { useEditorStore } from "./store";
import StepCheckboxes from "./StepCheckboxes";
import { defaultEnabledGroups } from "./profileGroups";
import { parseProfileYaml, serializeProfileYaml } from "./profileYaml";
import type { ImageEditState, PresetGeometryWire } from "../api/client";
```

Store-Selektoren ergaenzen (bei den vorhandenen `useEditorStore`-Zeilen):

```typescript
  const applyProfileGroups = useEditorStore((s) => s.applyProfileGroups);
  const cropRect = useEditorStore((s) => s.cropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const lensProfileId = useEditorStore((s) => s.lensProfileId);
  const manualLensOverride = useEditorStore((s) => s.manualLensOverride);
```

Neue lokale States (bei den anderen `useState`):

```typescript
  // Anwenden-Flow: ausgewaehltes Preset + angehakte Schritt-Gruppen.
  const [applyTarget, setApplyTarget] = useState<Preset | null>(null);
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(() =>
    defaultEnabledGroups(),
  );
```

- [ ] **Step 2: Geometrie-Helper + onApply/Export/Import**

`onLoad` ersetzen durch `onPickApply` (oeffnet die Step-Auswahl) und `onApplyConfirm`:

```typescript
  // Aktuelle Editor-Geometrie als Wire-Objekt (zum Speichern in ein Preset).
  const currentGeometry = (): PresetGeometryWire => ({
    crop: cropRect,
    straightenAngle,
    lensCorrection,
    lensProfileId,
    manualLensOverride,
  });

  const onPickApply = (p: Preset) => {
    setError(null);
    setEnabledGroups(defaultEnabledGroups());
    setApplyTarget(p);
  };

  const toggleGroup = (key: string) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onApplyConfirm = () => {
    if (!applyTarget) return;
    const profile: ImageEditState = {
      adjustments: applyTarget.adjustments,
      masks: applyTarget.masks,
      crop: applyTarget.geometry?.crop ?? null,
      straightenAngle: applyTarget.geometry?.straightenAngle ?? 0,
      lensCorrection: applyTarget.geometry?.lensCorrection ?? null,
      lensProfileId: applyTarget.geometry?.lensProfileId ?? null,
      manualLensOverride: applyTarget.geometry?.manualLensOverride ?? false,
    };
    applyProfileGroups(profile, enabledGroups);
    onLoadedPresetIdChange(applyTarget.id);
    setApplyTarget(null);
    onClose();
  };

  const onExportYaml = (p: Preset) => {
    const text = serializeProfileYaml({
      name: p.name,
      adjustments: p.adjustments,
      masks: p.masks,
      geometry: p.geometry,
    });
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.replace(/[^\w.-]+/g, "_")}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportYaml = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const parsed = parseProfileYaml(await file.text());
      const created = await api.createPreset({
        name: parsed.name,
        adjustments: parsed.adjustments,
        masks: parsed.masks,
        geometry: parsed.geometry ?? null,
      });
      if (!mountedRef.current) return;
      onLoadedPresetIdChange(created.id);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 409) {
        setError("Ein Preset mit diesem Namen existiert bereits.");
      } else {
        setError(err instanceof Error ? err.message : "Import fehlgeschlagen");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };
```

- [ ] **Step 3: onSave/onUpdate um geometry erweitern**

In `onSave` im `api.createPreset({...})`-Aufruf nach `masks: masksToWire(masks),` ergaenzen:

```typescript
        geometry: currentGeometry(),
```

In `onUpdate` im `api.updatePreset(...)`-Aufruf nach `masks: masksToWire(masks),` ergaenzen:

```typescript
        geometry: currentGeometry(),
```

- [ ] **Step 4: JSX — „Laden" zu „Anwenden", Step-Panel, Export/Import-Buttons**

Den Preset-Listeneintrag-Button „Laden" (`preset-load-${p.id}`) ersetzen durch zwei Buttons:

```tsx
                    <button
                      type="button"
                      data-testid={`preset-apply-${p.id}`}
                      onClick={() => onPickApply(p)}
                      disabled={busy}
                      className="text-amber-200 hover:text-amber-100 disabled:opacity-40"
                    >
                      Anwenden
                    </button>
                    <button
                      type="button"
                      data-testid={`preset-export-${p.id}`}
                      onClick={() => onExportYaml(p)}
                      disabled={busy}
                      className="text-stone-400 hover:text-stone-200 disabled:opacity-40"
                    >
                      YAML
                    </button>
```

Direkt unter der Dialog-Ueberschrift (im Header-`div`, neben dem Close-Button) einen Import-Button + verstecktes File-Input ergaenzen — ODER im Footer-`div` vor dem Save-Input:

```tsx
          <label className="block text-[10px] uppercase tracking-[0.2em] text-stone-400 hover:text-stone-200 cursor-pointer">
            YAML importieren
            <input
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml"
              data-testid="preset-import-input"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportYaml(f);
                e.target.value = "";
              }}
            />
          </label>
```

Das Step-Auswahl-Panel als Overlay innerhalb des Dialogs rendern, wenn `applyTarget` gesetzt ist (vor dem schliessenden Haupt-`div`):

```tsx
        {applyTarget && (
          <div
            data-testid="apply-step-panel"
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/70"
            onClick={() => setApplyTarget(null)}
          >
            <div
              className="w-[320px] bg-stone-900 border border-stone-700 p-4 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-stone-200 text-sm">
                {`„${applyTarget.name}“ anwenden`}
              </h3>
              <StepCheckboxes enabled={enabledGroups} onToggle={toggleGroup} />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  data-testid="apply-cancel"
                  onClick={() => setApplyTarget(null)}
                  className="text-xs text-stone-500 hover:text-stone-300"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  data-testid="apply-confirm"
                  onClick={onApplyConfirm}
                  className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30"
                >
                  Anwenden
                </button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 5: Lint + Typecheck + bestehende Component-Tests**

Run:
```bash
cd frontend && pnpm exec tsc -b --noEmit && pnpm lint
```
Expected: PASS

Run: `cd frontend && pnpm test -- PresetDialog`
Expected: bestehende Tests gruen (ggf. Test-IDs `preset-load-*` -> `preset-apply-*` in vorhandenen Tests anpassen, falls referenziert).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/editor/PresetDialog.tsx
git commit -m "feat(presets): Anwenden mit Schritt-Checkboxen + YAML-Export/Import"
```

---

## Task 13: Library — Mehrfachauswahl + BatchApplyModal

**Files:**
- Create: `frontend/src/pages/BatchApplyModal.tsx`
- Modify: `frontend/src/pages/Library.tsx`

- [ ] **Step 1: BatchApplyModal implementieren**

`frontend/src/pages/BatchApplyModal.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

import type { Preset } from "../api/client";
import { useApi } from "../api/use-api";
import StepCheckboxes from "../editor/StepCheckboxes";
import { defaultEnabledGroups } from "../editor/profileGroups";

interface Props {
  readonly imageIds: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onApplied: (applied: number, total: number) => void;
}

export default function BatchApplyModal({ imageIds, onClose, onApplied }: Props) {
  const api = useApi();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(() => defaultEnabledGroups());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await api.listPresets();
      if (mountedRef.current) setPresets(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Presets laden fehlgeschlagen");
      }
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggleGroup = (key: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onApply = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.applyPresetBatch(selectedId, {
        imageIds: [...imageIds],
        groups: [...enabled],
      });
      if (!mountedRef.current) return;
      onApplied(res.applied, res.total);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Anwenden fehlgeschlagen");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div
      data-testid="batch-apply-modal"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[380px] max-h-[80vh] flex flex-col bg-stone-900 border border-stone-700 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-800 text-stone-200">
          Profil auf {imageIds.length}{" "}
          {imageIds.length === 1 ? "Bild" : "Bilder"} anwenden
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {error && <p data-testid="batch-error" className="text-red-400 text-xs">{error}</p>}
          <select
            data-testid="batch-preset-select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
          >
            <option value="">Profil wählen…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selectedId && <StepCheckboxes enabled={enabled} onToggle={toggleGroup} />}
        </div>
        <div className="px-4 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-stone-500 hover:text-stone-300"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="batch-apply-confirm"
            onClick={() => void onApply()}
            disabled={busy || !selectedId}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-amber-200/20 border border-amber-300 text-amber-200 hover:bg-amber-200/30 disabled:opacity-40"
          >
            Anwenden
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Library — Mehrfachauswahl + Trigger**

In `frontend/src/pages/Library.tsx`:

Import ergaenzen:

```typescript
import BatchApplyModal from "./BatchApplyModal";
```

Neue States (bei den anderen `useState`):

```typescript
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
```

Toggle-Helper:

```typescript
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
```

Eine Action-Leiste oberhalb der `<ul data-testid="image-list">` einfuegen (nur wenn Bilder existieren):

```tsx
      {images.length > 0 && (
        <div className="mt-6 flex items-center gap-4 text-sm">
          <button
            type="button"
            data-testid="batch-apply-open"
            onClick={() => setBatchOpen(true)}
            disabled={selected.size === 0}
            className="text-amber-200 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Profil anwenden ({selected.size})
          </button>
          {toast && <span data-testid="batch-toast" className="text-stone-400">{toast}</span>}
        </div>
      )}
```

In jeder Bildzeile (`image-row-${img.id}`) als erstes Kind eine Checkbox ergaenzen:

```tsx
            <input
              type="checkbox"
              data-testid={`image-select-${img.id}`}
              checked={selected.has(img.id)}
              onChange={() => toggleSelected(img.id)}
              className="accent-amber-300 mr-3"
            />
```

Vor dem schliessenden `</section>` das Modal mounten:

```tsx
      {batchOpen && (
        <BatchApplyModal
          imageIds={[...selected]}
          onClose={() => setBatchOpen(false)}
          onApplied={(applied, total) => {
            setToast(`${applied} von ${total} angewendet`);
            setSelected(new Set());
          }}
        />
      )}
```

- [ ] **Step 3: Lint + Typecheck + Build**

Run:
```bash
cd frontend && pnpm exec tsc -b --noEmit && pnpm lint && pnpm build
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BatchApplyModal.tsx frontend/src/pages/Library.tsx
git commit -m "feat(presets): Library-Mehrfachauswahl + Batch-Apply-Modal"
```

---

## Task 14: E2E — Profil speichern, exportieren, batch-anwenden

**Files:**
- Create: `frontend/e2e/preset-profile.spec.ts`

- [ ] **Step 1: E2E-Test schreiben**

`frontend/e2e/preset-profile.spec.ts` (Muster aus bestehenden Specs in `frontend/e2e/`; `loginAsNewUser` + Upload-Helper wiederverwenden):

```typescript
import { expect, test } from "@playwright/test";

import { loginAsNewUser } from "./auth-helper";

test.describe("Bearbeitungs-Profile", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("Profil auf mehrere Bilder anwenden setzt Edit-State", async ({ page }) => {
    await loginAsNewUser(page);

    // 1. Zwei Bilder hochladen (Library-Upload-Input).
    await page.goto("/library");
    // (Upload-Helper analog bestehender Specs — zwei JPEGs hochladen,
    //  bis je eine image-row sichtbar ist.)

    // 2. Beide selektieren.
    const rows = page.locator('[data-testid^="image-row-"]');
    await expect(rows).toHaveCount(2);
    const ids = await rows.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid")!.replace("image-row-", "")),
    );
    for (const id of ids) {
      await page.getByTestId(`image-select-${id}`).check();
    }

    // 3. „Profil anwenden" -> Modal -> erstes Default-Preset waehlen ->
    //    crop/lens aus lassen -> anwenden.
    await page.getByTestId("batch-apply-open").click();
    await expect(page.getByTestId("batch-apply-modal")).toBeVisible();
    await page.getByTestId("batch-preset-select").selectOption({ index: 1 });
    await page.getByTestId("batch-apply-confirm").click();

    // 4. Toast „2 von 2 angewendet".
    await expect(page.getByTestId("batch-toast")).toContainText("2 von 2");
  });
});
```

- [ ] **Step 2: E2E lokal laufen lassen (Stack muss laufen)**

Run: `cd frontend && pnpm exec playwright test preset-profile`
Expected: PASS (oder dokumentierte Upload-Helper-Anpassung)

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/preset-profile.spec.ts
git commit -m "test(presets): E2E Batch-Anwendung von Profilen"
```

---

## Task 15: Doku + CLAUDE.md-Gotchas + Roadmap

**Files:**
- Modify: `CLAUDE.md` (Gotchas + Schluessel-Dateien)
- Modify: `docs/06-roadmap.md`

- [ ] **Step 1: CLAUDE.md ergaenzen**

In der „Schluessel-Dateien"-Tabelle Zeilen ergaenzen fuer `backend/schemas/edit-groups.json`, `backend/app/profile_groups.py`, `frontend/src/editor/profileGroups.ts`, `frontend/src/editor/profileYaml.ts`. In „Gotchas": Hinweis, dass `edit-groups.json` Single Source ist (Backend liest zur Laufzeit aus `backend/schemas/`, Frontend importiert ueber Repo-Root-Build-Context), und dass `infra/` NICHT im Backend-Image liegt (Build-Context `../backend`).

- [ ] **Step 2: Roadmap-Eintrag**

In `docs/06-roadmap.md` den Iterationsstand um die Profile-Erweiterung ergaenzen (YAML-Export/Import, Schritt-Checkboxen, Batch-Apply, Migration 009).

- [ ] **Step 3: Volle Verifikation vor Abschluss**

Run:
```bash
cd backend && .venv/bin/pytest -q
cd frontend && pnpm exec tsc -b --noEmit && pnpm lint && pnpm test && pnpm build
```
Expected: alles gruen.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/06-roadmap.md
git commit -m "docs(presets): Profile-Feature in CLAUDE.md + Roadmap"
```

---

## Self-Review-Ergebnis

**Spec-Abdeckung:** Alle Spec-Abschnitte haben eine Task — Datenmodell/Migration (T3/T4), Gruppen-JSON (T1/T2), Backend-Endpoints (T5/T6), Frontend profileGroups/YAML/Store (T8/T9/T10), UI Editor+Library (T11/T12/T13), Tests (in jeder Task + T14), Caveats/Doku (T15).

**Abweichung vom Spec (bewusst):** Die Single-Source-JSON liegt unter `backend/schemas/` statt `infra/profiles/`. Grund: das Backend-Image hat Build-Context `../backend` — `infra/` waere zur Laufzeit nicht da. `backend/schemas/` wird via `COPY . .` ins Image uebernommen (wie `adjustments.schema.json`), und das Frontend kann es ueber den Repo-Root-Build-Context importieren (gleiches Muster wie `lensProfile.ts`). Ergebnis ist trotzdem eine echte Single Source ohne Sync-Test.

**Platzhalter:** Keine — jede Code-Task hat vollstaendigen Code. Einzige Ausnahme mit Verweis: der Upload-Schritt im E2E (T14) verweist auf den vorhandenen Upload-Helper-Stil, da die konkrete Helper-API in `frontend/e2e/` liegt und beim Schreiben uebernommen wird.

**Typ-Konsistenz:** `mergeGroups(base, profile, enabled)` identische Signatur in TS (T8) und genutzt in Store (T10) + Tests. `applyPresetBatch(id, {imageIds, groups})` konsistent zwischen Client (T7), Modal (T13) und Endpoint (T6). `BatchApplyIn/Out` (imageIds/groups bzw. applied/total) konsistent Backend (T3/T6) ↔ Frontend (`BatchApplyResult`, T7).

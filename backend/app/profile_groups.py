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

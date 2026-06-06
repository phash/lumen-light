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

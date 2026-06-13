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


def _linear_mask(exposure: float = 0.2) -> dict:
    return {
        "type": "linear",
        "mask": {"p1": {"u": 0, "v": 0}, "p2": {"u": 1, "v": 1}, "feather": 0.5},
        "localAdj": {
            "exposure": exposure, "contrast": 0, "saturation": 0, "temperature": 0,
        },
    }


def test_merge_masks_group_pulls_preset_masks():
    # 'masks'-Gruppe angehakt -> die Preset-Masken ersetzen die Bild-Masken.
    base = _default_state()
    preset_masks = [_linear_mask(0.3)]
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=_preset_adjustments(),
        preset_masks=preset_masks,
        preset_geometry=None,
        enabled=["masks"],
    )
    assert merged["masks"] == preset_masks
    # Ergebnis muss durch die strikte Validierung gehen (Mask-Caps/Ranges).
    assert ImageEditState.model_validate(merged).masks[0].type == "linear"


def test_merge_masks_group_disabled_keeps_base_masks():
    base = _default_state()
    base["masks"] = [_linear_mask(0.9)]
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=_preset_adjustments(),
        preset_masks=[_linear_mask(0.1)],
        preset_geometry=None,
        enabled=["tone"],  # 'masks' NICHT angehakt
    )
    assert merged["masks"][0]["localAdj"]["exposure"] == 0.9


def test_merge_lens_group_pulls_preset_lens_fields():
    # 'lens'-Gruppe deckt lensCorrection/lensProfileId/manualLensOverride ab.
    base = _default_state()
    geo = {
        "crop": None,
        "straightenAngle": 0.0,
        "lensCorrection": {"distortion": 0.2, "vignette": -0.1, "tcaR": 0.0, "tcaB": 0.0},
        "lensProfileId": "canon-ef-35",
        "manualLensOverride": True,
    }
    merged = merge_edit_state(
        base_state=base,
        preset_adjustments=_preset_adjustments(),
        preset_masks=[],
        preset_geometry=geo,
        enabled=["lens"],
    )
    assert merged["lensProfileId"] == "canon-ef-35"
    assert merged["manualLensOverride"] is True
    assert merged["lensCorrection"]["distortion"] == 0.2
    # crop/straighten bleiben unberuehrt (gehoeren zur 'crop'-Gruppe).
    assert merged["crop"] is None


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

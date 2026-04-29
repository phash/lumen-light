"""Sicherstellen, dass adjustments.schema.json und app.schemas.Adjustments
identisch sind — Single Source of Truth fuer Frontend, Backend, Shader."""
import json
from pathlib import Path

from app.schemas import (
    HSL_CHANNEL_NAMES,
    Adjustments,
    HslAdjustments,
    HslAxis,
    ToneCurve,
    ToneCurvePoint,
)

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "adjustments.schema.json"

SCALAR_FIELDS = (
    "exposure", "contrast", "highlights", "shadows",
    "whites", "blacks", "temperature", "tint",
    "vibrance", "saturation",
    "sharpness", "noiseReduction",
    "highlightRecovery", "localContrast",
)


def _bounds_from_pydantic(field) -> dict[str, float | None]:
    constraints: dict[str, float | None] = {"min": None, "max": None}
    for m in field.metadata:
        for attr, key in (("ge", "min"), ("le", "max")):
            v = getattr(m, attr, None)
            if v is not None:
                constraints[key] = v
    return constraints


def test_adjustments_schema_matches_pydantic():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_props = schema["properties"]

    pydantic_fields = Adjustments.model_fields

    assert set(schema_props.keys()) == set(pydantic_fields.keys()), (
        f"Felder weichen ab. JSON-Schema: {set(schema_props)}, "
        f"Pydantic: {set(pydantic_fields)}"
    )

    for name in SCALAR_FIELDS:
        prop = schema_props[name]
        bounds = _bounds_from_pydantic(pydantic_fields[name])
        assert bounds["min"] == prop["minimum"], f"{name}: min mismatch"
        assert bounds["max"] == prop["maximum"], f"{name}: max mismatch"

    assert schema.get("additionalProperties") is False


def test_hsl_schema_matches_pydantic():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    hsl_prop = schema["properties"]["hsl"]
    assert "oneOf" in hsl_prop
    assert {"type": "null"} in hsl_prop["oneOf"]

    hsl_def = schema["$defs"]["HslAdjustments"]
    assert set(hsl_def["properties"].keys()) == set(HslAdjustments.model_fields.keys())
    assert hsl_def["additionalProperties"] is False

    axis_def = schema["$defs"]["HslAxis"]
    assert set(axis_def["properties"].keys()) == set(HslAxis.model_fields.keys())
    assert set(axis_def["properties"].keys()) == set(HSL_CHANNEL_NAMES)
    assert axis_def["additionalProperties"] is False

    for ch, prop in axis_def["properties"].items():
        bounds = _bounds_from_pydantic(HslAxis.model_fields[ch])
        assert bounds["min"] == prop["minimum"], f"hsl/{ch}: min mismatch"
        assert bounds["max"] == prop["maximum"], f"hsl/{ch}: max mismatch"


def test_tone_curve_schema_matches_pydantic():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    tc_prop = schema["properties"]["toneCurve"]
    assert "oneOf" in tc_prop
    assert {"type": "null"} in tc_prop["oneOf"]

    tc_def = schema["$defs"]["ToneCurve"]
    assert set(tc_def["properties"].keys()) == set(ToneCurve.model_fields.keys())
    assert tc_def["additionalProperties"] is False
    points_prop = tc_def["properties"]["points"]
    assert points_prop["minItems"] == 2
    assert points_prop["maxItems"] == 8

    point_def = schema["$defs"]["ToneCurvePoint"]
    assert set(point_def["properties"].keys()) == set(
        ToneCurvePoint.model_fields.keys()
    )
    assert point_def["additionalProperties"] is False
    for axis in ("x", "y"):
        bounds = _bounds_from_pydantic(ToneCurvePoint.model_fields[axis])
        assert bounds["min"] == point_def["properties"][axis]["minimum"]
        assert bounds["max"] == point_def["properties"][axis]["maximum"]

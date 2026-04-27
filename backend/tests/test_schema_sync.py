"""Sicherstellen, dass adjustments.schema.json und app.schemas.Adjustments
identisch sind — Single Source of Truth fuer Frontend, Backend, Shader."""
import json
from pathlib import Path

from app.schemas import Adjustments

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "adjustments.schema.json"


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

    for name, prop in schema_props.items():
        bounds = _bounds_from_pydantic(pydantic_fields[name])
        assert bounds["min"] == prop["minimum"], f"{name}: min mismatch"
        assert bounds["max"] == prop["maximum"], f"{name}: max mismatch"

    assert schema.get("additionalProperties") is False

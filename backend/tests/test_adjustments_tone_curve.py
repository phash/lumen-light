"""Tests fuer Tonkurve in Adjustments (E2)."""
import pytest
from pydantic import ValidationError

from app.schemas import Adjustments, ToneCurve, ToneCurvePoint


def test_adjustments_default_tone_curve_none():
    assert Adjustments().toneCurve is None


def test_tone_curve_minimum_two_points():
    with pytest.raises(ValidationError):
        ToneCurve(points=[ToneCurvePoint(x=0, y=0)])


def test_tone_curve_maximum_eight_points():
    pts = [ToneCurvePoint(x=i / 7, y=i / 7) for i in range(8)]
    ToneCurve(points=pts)
    pts9 = [ToneCurvePoint(x=i / 8, y=i / 8) for i in range(9)]
    with pytest.raises(ValidationError):
        ToneCurve(points=pts9)


def test_tone_curve_sorted_required():
    with pytest.raises(ValidationError):
        ToneCurve(
            points=[
                ToneCurvePoint(x=0, y=0),
                ToneCurvePoint(x=0.7, y=0.5),
                ToneCurvePoint(x=0.3, y=0.6),
                ToneCurvePoint(x=1, y=1),
            ]
        )


def test_tone_curve_point_bounds():
    with pytest.raises(ValidationError):
        ToneCurvePoint(x=-0.1, y=0)
    with pytest.raises(ValidationError):
        ToneCurvePoint(x=0, y=1.1)


def test_tone_curve_extra_forbid():
    with pytest.raises(ValidationError):
        ToneCurve(
            points=[ToneCurvePoint(x=0, y=0), ToneCurvePoint(x=1, y=1)],
            extra="x",
        )


def test_tone_curve_point_extra_forbid():
    with pytest.raises(ValidationError):
        ToneCurvePoint(x=0, y=0, z=1)


def test_adjustments_legacy_payload_still_valid():
    """Pre-E2-Presets ohne toneCurve-Feld sind weiterhin valide."""
    payload = {"exposure": 0.5}
    adj = Adjustments.model_validate(payload)
    assert adj.toneCurve is None


def test_adjustments_with_tone_curve_object():
    payload = {
        "toneCurve": {
            "points": [
                {"x": 0, "y": 0},
                {"x": 0.5, "y": 0.4},
                {"x": 1, "y": 1},
            ],
        },
    }
    adj = Adjustments.model_validate(payload)
    assert adj.toneCurve is not None
    assert len(adj.toneCurve.points) == 3
    assert adj.toneCurve.points[1].y == 0.4

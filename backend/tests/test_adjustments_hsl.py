"""Tests fuer HSL-Erweiterung in Adjustments (E1)."""
import pytest
from pydantic import ValidationError

from app.schemas import Adjustments, HslAdjustments, HslAxis


def test_adjustments_default_hsl_none():
    adj = Adjustments()
    assert adj.hsl is None


def test_adjustments_accepts_explicit_null_hsl():
    adj = Adjustments(hsl=None)
    assert adj.hsl is None


def test_adjustments_accepts_hsl_object():
    adj = Adjustments(hsl=HslAdjustments())
    assert adj.hsl is not None
    assert adj.hsl.hue.red == 0


def test_hsl_axis_default_zero():
    axis = HslAxis()
    for ch in (
        "red",
        "orange",
        "yellow",
        "green",
        "aqua",
        "blue",
        "violet",
        "magenta",
    ):
        assert getattr(axis, ch) == 0


def test_hsl_axis_bounds_min():
    with pytest.raises(ValidationError):
        HslAxis(red=-1.5)


def test_hsl_axis_bounds_max():
    with pytest.raises(ValidationError):
        HslAxis(green=1.5)


def test_hsl_axis_extra_forbid():
    with pytest.raises(ValidationError):
        HslAxis(unknown=0.1)


def test_hsl_adjustments_extra_forbid():
    with pytest.raises(ValidationError):
        HslAdjustments(extraAxis=HslAxis())


def test_hsl_full_payload_valid():
    payload = {
        "hue": {"red": 0.2, "orange": -0.3},
        "saturation": {"green": 0.5},
        "luminance": {"blue": -0.1},
    }
    hsl = HslAdjustments.model_validate(payload)
    assert hsl.hue.red == 0.2
    assert hsl.hue.orange == -0.3
    assert hsl.saturation.green == 0.5
    assert hsl.luminance.blue == -0.1


def test_adjustments_legacy_payload_without_hsl():
    """Praesets, die vor E1 angelegt wurden, sind weiterhin valide."""
    payload = {
        "exposure": 0.5,
        "contrast": 0.1,
        "highlights": 0,
        "shadows": 0,
        "whites": 0,
        "blacks": 0,
        "temperature": 0,
        "tint": 0,
        "vibrance": 0,
        "saturation": 0,
    }
    adj = Adjustments.model_validate(payload)
    assert adj.hsl is None

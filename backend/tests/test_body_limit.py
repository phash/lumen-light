"""Request-Body-Limit (Security-Review 2026-10): 413 statt unbegrenztem
Parsen grosser JSON-Bodies."""
from __future__ import annotations

from collections.abc import AsyncIterator

from app.schemas import MAX_TOTAL_MASKS

ZERO_ADJ = {"exposure": 0}


async def test_zu_grosser_content_length_gibt_413(client, user_a, monkeypatch):
    from app.config import settings

    big = b'{"name":"x","adjustments":{},"pad":"' + b"a" * (2 * 1024 * 1024) + b'"}'
    r = await client.post(
        "/api/v1/presets",
        headers={**user_a["headers"], "Content-Type": "application/json"},
        content=big,
    )
    assert r.status_code == 413, r.text
    assert settings.max_request_body_bytes < len(big)


async def test_zu_grosser_chunked_body_gibt_413(client, user_a):
    async def _chunks() -> AsyncIterator[bytes]:
        yield b'{"name":"x","adjustments":{},"pad":"'
        for _ in range(40):
            yield b"a" * 65536
        yield b'"}'

    r = await client.post(
        "/api/v1/presets",
        headers={**user_a["headers"], "Content-Type": "application/json"},
        content=_chunks(),
    )
    assert r.status_code == 413, r.text


async def test_normaler_body_bleibt_erlaubt(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "klein", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201, r.text


def _linear() -> dict:
    return {
        "type": "linear",
        "mask": {"p1": {"u": 0, "v": 0}, "p2": {"u": 1, "v": 1}, "feather": 0.5},
        "localAdj": {"exposure": 0.1},
    }


async def test_preset_masken_liste_hat_harte_obergrenze(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={
            "name": "viele-masken",
            "adjustments": ZERO_ADJ,
            "masks": [_linear() for _ in range(MAX_TOTAL_MASKS + 1)],
        },
    )
    assert r.status_code == 422


def test_edit_state_masken_liste_hat_harte_obergrenze():
    import pytest
    from pydantic import ValidationError

    from app.schemas import ImageEditState

    with pytest.raises(ValidationError) as exc:
        ImageEditState.model_validate(
            {"adjustments": {}, "masks": [_linear()] * 1000}
        )
    # Laengen-Check greift vor der Element-Validierung (too_long).
    assert any(e["type"] == "too_long" for e in exc.value.errors())

"""Review 2026-11 r2: JWKS-Backoff greift auf ALLEN Abrufpfaden (Kaltstart,
abgelaufen jenseits der Gnadenfrist, kid-Miss). Sonst blockiert waehrend
eines Keycloak-Ausfalls jeder Request bis zu 5 s unter dem Lock."""
from __future__ import annotations

import types

import pytest
from fastapi import HTTPException

from app import auth
from app.config import settings


class _Clock:
    def __init__(self, start: float = 10_000.0) -> None:
        self.now = start

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch) -> _Clock:
    c = _Clock()
    # Nur das time-Modul in app.auth ersetzen, nicht global.
    monkeypatch.setattr(auth, "time", types.SimpleNamespace(monotonic=c.monotonic))
    auth._jwk_cache.reset()
    return c


def _failing_fetch(monkeypatch) -> dict[str, int]:
    calls = {"n": 0}

    def _fail() -> None:
        calls["n"] += 1
        raise HTTPException(status_code=503, detail="down")

    monkeypatch.setattr(auth._jwk_cache, "_fetch", _fail)
    return calls


def test_kaltstart_ausfall_ruft_jwks_nur_einmal_ab(monkeypatch, clock):
    calls = _failing_fetch(monkeypatch)
    for _ in range(5):
        with pytest.raises(HTTPException) as exc:
            auth._jwk_cache.get("k")
        assert exc.value.status_code == 503
    assert calls["n"] == 1


def test_nach_backoff_wird_neu_geladen_und_neue_keys_ersetzen_alte(monkeypatch, clock):
    calls = _failing_fetch(monkeypatch)
    with pytest.raises(HTTPException):
        auth._jwk_cache.get("k")
    assert calls["n"] == 1

    def _ok() -> None:
        calls["n"] += 1
        auth._jwk_cache._keys_by_kid = {"neu": {"kid": "neu"}}  # noqa: SLF001
        auth._jwk_cache._fetched_at = clock.monotonic()  # noqa: SLF001

    monkeypatch.setattr(auth._jwk_cache, "_fetch", _ok)
    # Noch im Backoff: kein Abruf.
    clock.now += auth._JwkCache.FETCH_FAILURE_BACKOFF_SECONDS - 1
    with pytest.raises(HTTPException):
        auth._jwk_cache.get("neu")
    assert calls["n"] == 1
    # Backoff vorbei: Abruf, neuer Key nutzbar.
    clock.now += 2
    assert auth._jwk_cache.get("neu") == {"kid": "neu"}
    assert calls["n"] == 2


def test_neue_keys_ersetzen_abgelaufene(monkeypatch, clock):
    auth._jwk_cache._keys_by_kid = {"alt": {"kid": "alt"}}  # noqa: SLF001
    auth._jwk_cache._fetched_at = clock.now - settings.jwk_cache_seconds - 1  # noqa: SLF001

    def _ok() -> None:
        auth._jwk_cache._keys_by_kid = {"neu": {"kid": "neu"}}  # noqa: SLF001
        auth._jwk_cache._fetched_at = clock.monotonic()  # noqa: SLF001

    monkeypatch.setattr(auth._jwk_cache, "_fetch", _ok)
    assert auth._jwk_cache.get("neu") == {"kid": "neu"}
    with pytest.raises(HTTPException) as exc:
        auth._jwk_cache.get("alt")
    assert exc.value.status_code == 401


def test_jenseits_der_gnadenfrist_backoff_ohne_erneuten_abruf(monkeypatch, clock):
    calls = _failing_fetch(monkeypatch)
    auth._jwk_cache._keys_by_kid = {"k": {"kid": "k"}}  # noqa: SLF001
    auth._jwk_cache._fetched_at = (  # noqa: SLF001
        clock.now - settings.jwk_cache_seconds - auth._JwkCache.STALE_GRACE_SECONDS - 10
    )
    for _ in range(5):
        with pytest.raises(HTTPException) as exc:
            auth._jwk_cache.get("k")
        assert exc.value.status_code == 503
    assert calls["n"] == 1


def test_zufalls_kid_waehrend_ausfall_hoechstens_ein_abruf_pro_fenster(monkeypatch, clock):
    calls = _failing_fetch(monkeypatch)
    # Frischer Cache mit bekanntem Key, kid-Miss-Drossel bereits abgelaufen.
    auth._jwk_cache._keys_by_kid = {"known": {"kid": "known"}}  # noqa: SLF001
    auth._jwk_cache._fetched_at = clock.now - auth._JwkCache.KID_MISS_REFETCH_SECONDS - 1  # noqa: SLF001
    for i in range(10):
        with pytest.raises(HTTPException) as exc:
            auth._jwk_cache.get(f"forged-{i}")
        # Cache frisch, kid unbekannt -> 401 (nicht 503).
        assert exc.value.status_code == 401
    assert calls["n"] == 1
    # Bekannter Key funktioniert waehrend des Ausfalls weiter.
    assert auth._jwk_cache.get("known") == {"kid": "known"}
    # Naechstes Fenster: wieder genau ein Versuch.
    clock.now += auth._JwkCache.FETCH_FAILURE_BACKOFF_SECONDS + 1
    for i in range(10):
        with pytest.raises(HTTPException):
            auth._jwk_cache.get(f"forged-b-{i}")
    assert calls["n"] == 2

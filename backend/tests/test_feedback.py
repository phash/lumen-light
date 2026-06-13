"""User-facing Feedback-Endpoint: Submit + Honeypot + Validation."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Feedback


@pytest.mark.asyncio
async def test_submit_feedback_persists(client, user_a, db_session):
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={
            "kind": "idea",
            "message": "Wuerde mir wuenschen, dass Presets exportiert werden koennen.",
            "page": "/account",
        },
    )
    assert r.status_code == 201, r.text
    fb_id = r.json()["id"]
    assert fb_id is not None

    rows = (
        await db_session.execute(select(Feedback))
    ).scalars().all()
    assert len(rows) == 1
    fb = rows[0]
    assert fb.kind == "idea"
    assert fb.status == "new"
    assert fb.user_id is not None


@pytest.mark.asyncio
async def test_honeypot_silently_drops(client, user_a, db_session):
    """Honeypot-Field 'website' nicht leer -> 201, aber kein Schreiben."""
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={
            "kind": "bug",
            "message": "Spam-Bot-Eintrag der nicht gespeichert werden darf.",
            "page": "/editor",
            "website": "https://spammer.example.com",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["id"] is None

    rows = (
        await db_session.execute(select(Feedback))
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
@pytest.mark.parametrize("honey", ["", "   "])
async def test_empty_honeypot_still_persists(client, user_a, db_session, honey):
    """Die echte UI schickt das Honeypot-Feld 'website' leer mit. Leerer oder
    reiner Whitespace-Wert MUSS als legitime Submission durchgehen (sonst geht
    jedes echte Feedback still verloren)."""
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={
            "kind": "other",
            "message": "Legitime Meldung mit leerem Honeypot-Feld.",
            "website": honey,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["id"] is not None

    rows = (await db_session.execute(select(Feedback))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_message_too_short_rejected(client, user_a):
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={"kind": "bug", "message": "kurz"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_unknown_kind_rejected(client, user_a):
    r = await client.post(
        "/api/v1/feedback",
        headers=user_a["headers"],
        json={
            "kind": "spam",
            "message": "Unknown kind sollte 422 ausloesen, nicht durchschlagen.",
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_unauthenticated_rejected(client):
    r = await client.post(
        "/api/v1/feedback",
        json={
            "kind": "other",
            "message": "Anonym sollte hier nicht moeglich sein.",
        },
    )
    assert r.status_code == 401

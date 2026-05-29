"""Output-Schemas duerfen Legacy-Emails mit Special-Use-TLD nicht ablehnen.

`EmailStr` weist `.local`/`.test`/`.invalid` ab. Stehen solche Emails in
der DB (Legacy-Test-User), sprengt das die OUTPUT-Validation von
`GET /me` und `GET /me/export` (-> 500). Die Identitaet liegt bei
Keycloak; im Output ist die Email nur Display-Text und muss `str` sein
(wie bereits bei AdminUserOut/FeedbackOut).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4


def test_user_out_accepts_special_use_tld() -> None:
    from app.schemas import UserOut

    out = UserOut(
        id=uuid4(),
        email="legacy@test.local",
        created_at=datetime.now(timezone.utc),
    )
    assert out.email == "legacy@test.local"


def test_me_export_accepts_special_use_tld() -> None:
    from app.routers.auth import MeExport

    out = MeExport(
        id=uuid4(),
        email="legacy@example.invalid",
        handle=None,
        bio=None,
        created_at=datetime.now(timezone.utc),
        presets=[],
        images=[],
        submitted_reports=[],
    )
    assert out.email == "legacy@example.invalid"

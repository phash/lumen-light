"""Tests fuer JIT-User-Provisioning beim ersten Auftauchen eines Keycloak-Users."""
import secrets

from sqlalchemy import select


async def test_first_request_creates_local_user_row(client, make_keycloak_user, db_session):
    """Vor dem ersten /me gibt es keinen lokalen User; danach genau einen."""
    from app.models import User

    info = make_keycloak_user(f"jit-{secrets.token_hex(4)}@example.com")
    sub = info["keycloak_sub"]

    pre = await db_session.execute(select(User).where(User.keycloak_sub == sub))
    assert pre.scalar_one_or_none() is None

    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200

    # Direkt am Backend-DB-Layer pruefen — neue Session-Instance braucht expire,
    # da der API-Call seine eigene Subtransaktion benutzt hat.
    db_session.expire_all()
    post = await db_session.execute(select(User).where(User.keycloak_sub == sub))
    user = post.scalar_one()
    assert user.email == info["email"]


async def test_first_request_creates_default_presets(client, make_keycloak_user):
    info = make_keycloak_user(f"presets-{secrets.token_hex(4)}@example.com")
    me = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert me.status_code == 200

    presets = await client.get("/api/v1/presets", headers=info["headers"])
    assert presets.status_code == 200
    names = {p["name"] for p in presets.json()}
    assert {"Neutral", "Punchy", "Soft Mood", "Schwarzweiss-Vorbereitung"} <= names


async def test_email_change_in_token_is_reflected(client, make_keycloak_user, keycloak_admin, keycloak_oid):
    """Wenn sich die E-Mail im Keycloak-User aendert, spiegelt das Backend
    das beim naechsten Token-Refresh in seine users-Row."""
    info = make_keycloak_user(f"emailchange-{secrets.token_hex(4)}@example.com")
    user_id = info["keycloak_sub"]

    # Erste Anfrage legt User mit alter E-Mail an
    r = await client.get("/api/v1/auth/me", headers=info["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == info["email"]

    # E-Mail in Keycloak aendern
    new_email = f"renamed-{secrets.token_hex(4)}@example.com"
    keycloak_admin.update_user(user_id, {"email": new_email, "username": new_email})

    # Neuen Token holen — enthaelt jetzt die neue E-Mail
    new_token = keycloak_oid.token(username=new_email, password="supersicheresPasswort1")
    new_headers = {"Authorization": f"Bearer {new_token['access_token']}"}

    r2 = await client.get("/api/v1/auth/me", headers=new_headers)
    assert r2.status_code == 200
    assert r2.json()["email"] == new_email

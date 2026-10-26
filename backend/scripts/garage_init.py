"""Idempotente Garage-Einrichtung ueber die Admin-API (v1).

Das Garage-Image hat keine Shell, daher laeuft die Einrichtung als eigener
Init-Schritt gegen die Admin-API (Port 3903):

1. Single-Node-Layout zuweisen + anwenden (nur beim allerersten Start).
2. API-Key importieren (feste ID/Secret aus der .env, damit Pre-Signed-URLs
   und Settings ohne Ruecklesen funktionieren).
3. Bucket anlegen und dem Key Lese-/Schreibrechte geben (kein Owner-Recht:
   der Key darf keine Bucket-Einstellungen aendern; Ausnahme Dev-Stack via
   GARAGE_KEY_OWNER=1 fuer die CORS-Konfiguration).

Nur Standardbibliothek — laeuft im API-Image, in python:alpine (Dev) und
direkt aus der pytest-conftest.

Aufruf:

    GARAGE_ADMIN_URL=http://lumen-garage:3903 GARAGE_ADMIN_TOKEN=... \
    GARAGE_S3_BUCKET=lumen-images GARAGE_S3_ACCESS_KEY_ID=GK... \
    GARAGE_S3_SECRET_ACCESS_KEY=... python -m scripts.garage_init
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# Garage-Key-Format: "GK" + 24 Hex-Zeichen, Secret 64 Hex-Zeichen.
KEY_ID_LEN = 26
SECRET_LEN = 64
DEFAULT_CAPACITY = 10 * 1024**3  # 10 GiB — nur Gewichtung, kein Quota


class GarageAdmin:
    def __init__(self, base_url: str, token: str) -> None:
        self._base = base_url.rstrip("/")
        self._token = token

    def call(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        req = Request(f"{self._base}{path}", data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=10) as r:
                raw = r.read()
        except HTTPError as e:
            # Garage liefert die Ursache im Body — sonst nur "400 Bad Request".
            detail = e.read().decode(errors="replace")[:300]
            raise HTTPError(e.url, e.code, f"{method} {path}: {detail}", e.headers, None) from e
        return json.loads(raw) if raw else None

    def get_or_none(self, path: str) -> Any:
        try:
            return self.call("GET", path)
        except HTTPError as e:
            # Garage meldet "nicht gefunden" je nach Endpunkt als 400 oder 404.
            if e.code in (400, 404):
                return None
            raise

    def wait_ready(self, timeout: float = 60.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            try:
                return self.call("GET", "/v1/status")
            except (URLError, ConnectionError, OSError):
                if time.monotonic() > deadline:
                    raise
                time.sleep(1)


def ensure_layout(admin: GarageAdmin, capacity: int = DEFAULT_CAPACITY) -> None:
    status = admin.call("GET", "/v1/status")
    node = status["node"]
    if any(n["id"] == node and n.get("role") for n in status["nodes"]):
        return
    admin.call(
        "POST",
        "/v1/layout",
        [{"id": node, "zone": "dc1", "capacity": capacity, "tags": ["lumen"]}],
    )
    layout = admin.call("GET", "/v1/layout")
    admin.call("POST", "/v1/layout/apply", {"version": layout["version"] + 1})


def ensure_key(admin: GarageAdmin, key_id: str, secret: str, name: str) -> None:
    existing = admin.get_or_none(f"/v1/key?id={quote(key_id)}&showSecretKey=true")
    if existing is not None:
        if existing.get("secretAccessKey") == secret:
            return
        # Garage kann ein Secret nicht aendern und vergibt eine geloeschte
        # Key-ID nie wieder. Rotation = NEUE Key-ID + Secret in .env; der alte
        # Key bleibt bis zum manuellen Loeschen gueltig. Laut abbrechen statt
        # still weiterlaufen (die API bekaeme sonst nur Signaturfehler).
        raise ValueError(
            f"Key {key_id} existiert mit anderem Secret — fuer eine Rotation "
            "neue GARAGE_S3_ACCESS_KEY_ID ('GK' + openssl rand -hex 12) setzen"
        )
    admin.call(
        "POST",
        "/v1/key/import",
        {"accessKeyId": key_id, "secretAccessKey": secret, "name": name},
    )


def ensure_bucket(
    admin: GarageAdmin, bucket: str, key_id: str, owner: bool = False
) -> str:
    info = admin.get_or_none(f"/v1/bucket?globalAlias={quote(bucket)}")
    if info is None:
        info = admin.call("POST", "/v1/bucket", {"globalAlias": bucket})
    bucket_id: str = info["id"]
    admin.call(
        "POST",
        "/v1/bucket/allow",
        {
            "bucketId": bucket_id,
            "accessKeyId": key_id,
            "permissions": {"read": True, "write": True, "owner": owner},
        },
    )
    return bucket_id


def validate_key(key_id: str, secret: str) -> None:
    hexchars = set("0123456789abcdef")
    if not (
        len(key_id) == KEY_ID_LEN
        and key_id.startswith("GK")
        and set(key_id[2:]) <= hexchars
    ):
        raise ValueError("GARAGE_S3_ACCESS_KEY_ID muss 'GK' + 24 Hex-Zeichen sein")
    if not (len(secret) == SECRET_LEN and set(secret) <= hexchars):
        raise ValueError("GARAGE_S3_SECRET_ACCESS_KEY muss 64 Hex-Zeichen sein")


def init_garage(
    admin_url: str,
    admin_token: str,
    bucket: str,
    key_id: str,
    secret: str,
    key_name: str = "lumen-api",
    owner: bool = False,
) -> str:
    validate_key(key_id, secret)
    admin = GarageAdmin(admin_url, admin_token)
    admin.wait_ready()
    ensure_layout(admin)
    ensure_key(admin, key_id, secret, key_name)
    return ensure_bucket(admin, bucket, key_id, owner=owner)


def main() -> int:
    env = os.environ
    try:
        bucket_id = init_garage(
            admin_url=env.get("GARAGE_ADMIN_URL", "http://lumen-garage:3903"),
            admin_token=env["GARAGE_ADMIN_TOKEN"],
            bucket=env["GARAGE_S3_BUCKET"],
            key_id=env["GARAGE_S3_ACCESS_KEY_ID"],
            secret=env["GARAGE_S3_SECRET_ACCESS_KEY"],
            # Nur Dev: Owner-Recht, damit das Init die Bucket-CORS setzen darf
            # (Browser auf :5173 -> Garage auf :9000). Production: same-origin.
            owner=env.get("GARAGE_KEY_OWNER") == "1",
        )
    except (KeyError, ValueError) as e:
        print(f"garage-init: Konfigurationsfehler: {e}", file=sys.stderr)
        return 2
    print(f"garage-init: Bucket {env['GARAGE_S3_BUCKET']} ({bucket_id}) bereit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""S3-Storage-Service fuer Garage (Production) bzw. MinIO (Tests).

Wrapper um boto3 — bietet Pre-Signed-URL-Erzeugung, HEAD und DELETE.
Pixel-Daten laufen NICHT durch dieses Modul; der Browser uploadt direkt
gegen die ausgegebene Pre-Signed URL (siehe ADR-011).
"""
from __future__ import annotations

from uuid import UUID

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import Settings


class ObjectNotFound(Exception):
    """S3-Object existiert nicht (HEAD/DELETE auf Nicht-Existenz)."""


class StorageService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = self._make_client(settings.garage_s3_endpoint)
        # Pre-Signed-URLs muessen fuer den Host signiert werden, den der Browser
        # erreicht. Hinter einem Reverse-Proxy ist das der oeffentliche Endpoint;
        # head/delete laufen weiter intern (self._client). Signieren ist reine
        # Krypto (kein Netzwerk), daher kostet der zweite Client nichts zur Laufzeit.
        public = settings.garage_s3_public_endpoint or settings.garage_s3_endpoint
        self._presign_client = (
            self._client
            if public == settings.garage_s3_endpoint
            else self._make_client(public)
        )

    def _make_client(self, endpoint: str):
        return boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=self._settings.garage_s3_region,
            aws_access_key_id=self._settings.garage_s3_access_key_id,
            aws_secret_access_key=self._settings.garage_s3_secret_access_key,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    @property
    def bucket(self) -> str:
        return self._settings.garage_s3_bucket

    def make_key(self, user_id: UUID, image_id: UUID) -> str:
        """<user_id>/originals/<image_id> — per-User-Prefix fuer Tenant-Isolation."""
        return f"{user_id}/originals/{image_id}"

    def presign_put(self, key: str, content_type: str) -> tuple[str, int]:
        url = self._presign_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=self._settings.presigned_url_expires_in,
        )
        return url, self._settings.presigned_url_expires_in

    def presign_get(self, key: str) -> tuple[str, int]:
        url = self._presign_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=self._settings.presigned_url_expires_in,
        )
        return url, self._settings.presigned_url_expires_in

    def head(self, key: str) -> int:
        """Gibt size_bytes zurueck. Wirft ObjectNotFound wenn nicht da."""
        try:
            response = self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFound(key) from exc
            raise
        return int(response["ContentLength"])

    def head_bytes(self, key: str, n: int) -> bytes:
        """Liest die ersten n Bytes des Objects (Ranged GET) — fuer Magic-
        Byte-Validierung beim confirm. Wirft ObjectNotFound wenn nicht da."""
        try:
            response = self._client.get_object(
                Bucket=self.bucket, Key=key, Range=f"bytes=0-{n - 1}"
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFound(key) from exc
            raise
        return response["Body"].read()

    def delete(self, key: str) -> None:
        """Loescht das Object. Idempotent — kein Fehler wenn schon weg."""
        self._client.delete_object(Bucket=self.bucket, Key=key)

    def ensure_bucket(self) -> None:
        """Legt das Bucket an, falls nicht vorhanden — fuer Test-Setup und
        lokale Entwicklung. Production-Bucket wird via garage-init.sh
        angelegt (siehe Iteration 7)."""
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in {"404", "NoSuchBucket", "NotFound"}:
                self._client.create_bucket(Bucket=self.bucket)
            else:
                raise


_singleton: StorageService | None = None


def get_storage() -> StorageService:
    """Lazy singleton. FastAPI-Dependency — kann via dependency_overrides
    in Tests durch ein eigenes StorageService-Object ersetzt werden."""
    global _singleton
    if _singleton is None:
        from app.config import settings

        _singleton = StorageService(settings)
    return _singleton


def reset_storage_singleton() -> None:
    """Fuer Tests — neuer StorageService bei naechstem get_storage()."""
    global _singleton
    _singleton = None

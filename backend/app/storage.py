"""S3-Storage-Service fuer Garage (Production) (Production, Dev und Tests).

Wrapper um boto3 — bietet Pre-Signed-URL-Erzeugung, HEAD und DELETE.
Pixel-Daten laufen NICHT durch dieses Modul; der Browser uploadt direkt
gegen die ausgegebene Pre-Signed URL (siehe ADR-011).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import Settings


class ObjectNotFound(Exception):
    """S3-Object existiert nicht (HEAD/DELETE auf Nicht-Existenz)."""


class StorageError(Exception):
    """S3 hat einen Teil eines Batch-Deletes abgelehnt."""


@dataclass(frozen=True)
class StoredObject:
    key: str
    last_modified: datetime


# S3 DeleteObjects akzeptiert max. 1000 Keys pro Request.
_DELETE_BATCH = 1000


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
            # Flexible Checksums nur wenn noetig: botocore-Defaults (seit 1.36)
            # vergleichen CRCs, die Garage bei Multipart-Objekten anders bildet
            # -> FlexibleChecksumError beim Lesen. Empfehlung fuer Nicht-AWS-S3.
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    @property
    def bucket(self) -> str:
        return self._settings.garage_s3_bucket

    def make_key(self, user_id: UUID, image_id: UUID) -> str:
        """<user_id>/originals/<image_id> — per-User-Prefix fuer Tenant-Isolation."""
        return f"{user_id}/originals/{image_id}"

    def make_staging_key(self, user_id: UUID, image_id: UUID) -> str:
        """<user_id>/staging/<image_id> — Ziel des Pre-Signed PUT. Erst nach
        Size- und Magic-Byte-Pruefung kopiert confirm() serverseitig auf den
        finalen Key; der finale Key wird nie zum Schreiben herausgegeben.
        Gleicher User-Prefix wie make_key, damit Tenant-Isolation und
        Prefix-Purge (DELETE /me) beide Keys abdecken."""
        return f"{user_id}/staging/{image_id}"

    def staging_key_for(self, bucket_key: str) -> str:
        """Leitet den Staging-Key aus einem finalen Key <uid>/originals/<id> ab."""
        user_part, _, image_part = bucket_key.partition("/originals/")
        if not user_part or not image_part:
            raise ValueError(f"Unerwartetes bucket_key-Format: {bucket_key!r}")
        return f"{user_part}/staging/{image_part}"

    def presign_post(
        self, key: str, content_type: str, max_size: int
    ) -> tuple[str, dict[str, str], int]:
        """Pre-Signed POST (Browser-Form-Upload). Anders als ein Pre-Signed PUT
        traegt die signierte Policy ein content-length-range — S3 lehnt
        groessere Bodies ab, bevor sie im Bucket landen. Key und Content-Type
        sind ebenfalls an die Policy gebunden (kein Umschreiben im Formular)."""
        post = self._presign_client.generate_presigned_post(
            Bucket=self.bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[
                ["content-length-range", 1, max_size],
                {"Content-Type": content_type},
            ],
            ExpiresIn=self._settings.presigned_url_expires_in,
        )
        fields = {k: str(v) for k, v in post["fields"].items()}
        return post["url"], fields, self._settings.presigned_url_expires_in

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

    def copy(self, src_key: str, dst_key: str) -> None:
        """Serverseitige Kopie innerhalb des Buckets (keine Pixel durch die API).
        Wirft ObjectNotFound wenn die Quelle fehlt."""
        try:
            self._client.copy_object(
                Bucket=self.bucket,
                Key=dst_key,
                CopySource={"Bucket": self.bucket, "Key": src_key},
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFound(src_key) from exc
            raise

    def list_objects(self, prefix: str) -> list[StoredObject]:
        """Alle Objekte unter prefix (paginiert ueber list_objects_v2)."""
        paginator = self._client.get_paginator("list_objects_v2")
        out: list[StoredObject] = []
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                out.append(StoredObject(key=obj["Key"], last_modified=obj["LastModified"]))
        return out

    def delete_many(self, keys: list[str]) -> None:
        """Batch-Delete (max. 1000 pro Request). Wirft StorageError, wenn S3
        einzelne Keys ablehnt — der Caller entscheidet ueber Retry."""
        for i in range(0, len(keys), _DELETE_BATCH):
            chunk = keys[i : i + _DELETE_BATCH]
            response = self._client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
            )
            errors = response.get("Errors") or []
            if errors:
                raise StorageError(
                    f"{len(errors)} Objekte nicht geloescht, z.B. {errors[0].get('Key')}"
                )

    def delete_prefix(self, prefix: str) -> int:
        """Loescht ALLE Objekte unter prefix — auch solche, die keine DB-Row
        (mehr) haben (Staging-Reste, verwaiste Objekte). Gibt die Anzahl
        geloeschter Objekte zurueck. Leerer Prefix ist verboten (wuerde den
        ganzen Bucket leeren)."""
        if not prefix or not prefix.endswith("/"):
            raise ValueError("delete_prefix braucht einen nicht-leeren '/'-Prefix.")
        keys = [o.key for o in self.list_objects(prefix)]
        self.delete_many(keys)
        return len(keys)

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

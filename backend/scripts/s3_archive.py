"""Bucket <-> tar-Stream (Backup, Restore, Migration MinIO -> Garage).

    # Backup: alle Objekte als tar nach stdout
    docker exec lumen-api python -m scripts.s3_archive export > bucket.tar
    # Restore/Migration: tar von stdin in den (Ziel-)Bucket
    docker exec -i lumen-api python -m scripts.s3_archive import < bucket.tar
    # Abgleich: "key<TAB>size" je Objekt, sortiert (Migrations-Check)
    docker exec lumen-api python -m scripts.s3_archive manifest

Endpoint, Bucket und Credentials kommen aus denselben Settings wie die API
(GARAGE_S3_*). Fuer die Migration lassen sie sich per Env auf die alte
Quelle umbiegen (docker exec -e GARAGE_S3_ENDPOINT=... ...).

Objekt-Ebene statt Volume-Tar: unabhaengig vom S3-Backend und konsistent
ohne Garage-Metadaten-Snapshot. Tar-Pfade = Objekt-Keys, der Content-Type
reist als PAX-Header mit.
"""
from __future__ import annotations

import sys
import tarfile
import time
from typing import IO

from app.config import settings
from app.storage import StorageService

_PAX_CONTENT_TYPE = "LUMEN.content_type"


class _ReadOnly:
    """Nur read(): tar-Streams ("r|") sind nicht seekbar, boto3 fragt sonst
    seekable() ab und scheitert. Ohne seek liest upload_fileobj sequenziell."""

    def __init__(self, fh: IO[bytes]) -> None:
        self.read = fh.read


def export_bucket(storage: StorageService, out: IO[bytes]) -> int:
    client = storage._client
    count = 0
    with tarfile.open(fileobj=out, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for obj in storage.list_objects(""):
            body = client.get_object(Bucket=storage.bucket, Key=obj.key)
            info = tarfile.TarInfo(name=obj.key)
            info.size = int(body["ContentLength"])
            info.mtime = int(obj.last_modified.timestamp())
            info.pax_headers = {_PAX_CONTENT_TYPE: body.get("ContentType") or ""}
            # Stream statt read(): Objekte bis 200 MB, der API-Container
            # teilt sein Memory-Limit mit dem laufenden Server.
            tar.addfile(info, body["Body"])
            count += 1
    return count


def import_bucket(storage: StorageService, src: IO[bytes]) -> int:
    client = storage._client
    count = 0
    with tarfile.open(fileobj=src, mode="r|") as tar:
        for member in tar:
            if not member.isfile():
                continue
            # Keys stammen aus export_bucket (<uid>/originals/<id>); absolute
            # oder ../-Pfade waeren ein manipuliertes Archiv.
            if member.name.startswith("/") or ".." in member.name.split("/"):
                raise ValueError(f"Unzulaessiger Key im Archiv: {member.name!r}")
            fh = tar.extractfile(member)
            if fh is None:
                continue
            extra = {}
            content_type = member.pax_headers.get(_PAX_CONTENT_TYPE)
            if content_type:
                extra["ContentType"] = content_type
            # upload_fileobj streamt in Teilen (Multipart ab 8 MB) statt das
            # ganze Objekt in den Speicher zu lesen.
            client.upload_fileobj(
                _ReadOnly(fh), storage.bucket, member.name, ExtraArgs=extra or None
            )
            count += 1
    return count


def manifest(storage: StorageService) -> list[str]:
    """Sortierte "key<TAB>size"-Zeilen — Inhaltsabgleich zweier Buckets."""
    paginator = storage._client.get_paginator("list_objects_v2")
    lines = [
        f"{o['Key']}\t{o['Size']}"
        for page in paginator.paginate(Bucket=storage.bucket)
        for o in page.get("Contents", [])
    ]
    return sorted(lines)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in ("export", "import", "manifest"):
        print(
            "Aufruf: python -m scripts.s3_archive export|import|manifest",
            file=sys.stderr,
        )
        return 2
    storage = StorageService(settings)
    if argv[1] == "manifest":
        for line in manifest(storage):
            print(line)
        return 0
    started = time.monotonic()
    if argv[1] == "export":
        n = export_bucket(storage, sys.stdout.buffer)
    else:
        n = import_bucket(storage, sys.stdin.buffer)
    print(
        f"s3_archive {argv[1]}: {n} Objekte, Bucket {storage.bucket}, "
        f"{time.monotonic() - started:.1f}s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

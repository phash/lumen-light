"""scripts.s3_archive: Bucket -> tar -> Bucket (Backup/Migration)."""
import io
import tarfile
from uuid import uuid4

import pytest

from app.storage import get_storage
from scripts.s3_archive import export_bucket, import_bucket, manifest


def test_export_import_roundtrip_mit_content_type():
    storage = get_storage()
    prefix = f"{uuid4()}/"
    objs = {prefix + "originals/a": b"\xff\xd8\xffjpeg", prefix + "previews/b.jpg": b"png"}
    for key, data in objs.items():
        storage._client.put_object(
            Bucket=storage.bucket, Key=key, Body=data, ContentType="image/jpeg"
        )

    before = [l for l in manifest(storage) if l.startswith(prefix)]
    assert before == sorted(f"{k}\t{len(v)}" for k, v in objs.items())
    buf = io.BytesIO()
    assert export_bucket(storage, buf).exported >= len(objs)
    storage.delete_prefix(prefix)
    assert storage.list_objects(prefix) == []

    buf.seek(0)
    import_bucket(storage, buf)
    for key, data in objs.items():
        got = storage._client.get_object(Bucket=storage.bucket, Key=key)
        assert got["Body"].read() == data
        assert got["ContentType"] == "image/jpeg"
    assert [l for l in manifest(storage) if l.startswith(prefix)] == before
    storage.delete_prefix(prefix)


def test_export_ueberspringt_staging_objekte():
    storage = get_storage()
    prefix = f"{uuid4()}/"
    storage._client.put_object(Bucket=storage.bucket, Key=prefix + "staging/x", Body=b"s")
    storage._client.put_object(Bucket=storage.bucket, Key=prefix + "originals/y", Body=b"o")
    buf = io.BytesIO()
    result = export_bucket(storage, buf)
    buf.seek(0)
    with tarfile.open(fileobj=buf, mode="r") as tar:
        names = tar.getnames()
    assert prefix + "originals/y" in names
    assert prefix + "staging/x" not in names
    assert result.skipped_staging >= 1
    storage.delete_prefix(prefix)


def test_export_zaehlt_verschwundene_objekte_statt_abzubrechen(monkeypatch):
    """Ein Objekt verschwindet zwischen Listing und GET (Janitor/DELETE) ->
    uebersprungen und gezaehlt, der Export laeuft weiter."""
    storage = get_storage()
    prefix = f"{uuid4()}/"
    for k in ("originals/weg", "originals/da"):
        storage._client.put_object(Bucket=storage.bucket, Key=prefix + k, Body=b"x")
    real_list = storage.list_objects

    def _list(p: str):
        objs = real_list(p)
        storage.delete(prefix + "originals/weg")
        return objs

    monkeypatch.setattr(storage, "list_objects", _list)
    buf = io.BytesIO()
    result = export_bucket(storage, buf)
    assert result.vanished >= 1
    buf.seek(0)
    with tarfile.open(fileobj=buf, mode="r") as tar:
        names = tar.getnames()
    assert prefix + "originals/da" in names
    assert prefix + "originals/weg" not in names
    storage.delete_prefix(prefix)


def test_import_lehnt_pfad_traversal_ab():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        info = tarfile.TarInfo("../evil")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    buf.seek(0)
    with pytest.raises(ValueError):
        import_bucket(get_storage(), buf)


def test_roundtrip_grosses_objekt_multipart():
    """> 8 MB: Import laeuft ueber Multipart aus dem nicht-seekbaren tar-Stream."""
    storage = get_storage()
    key = f"{uuid4()}/originals/big"
    data = bytes(range(256)) * (9 * 1024 * 1024 // 256)
    storage._client.put_object(Bucket=storage.bucket, Key=key, Body=data)
    buf = io.BytesIO()
    export_bucket(storage, buf)
    storage.delete(key)
    buf.seek(0)
    import_bucket(storage, buf)
    got = storage._client.get_object(Bucket=storage.bucket, Key=key)["Body"].read()
    assert got == data
    storage.delete(key)


def test_garage_init_bricht_bei_geaendertem_secret_ab(s3_container):
    """Secret-Rotation mit gleicher Key-ID: Garage kann das nicht -> Fehler
    statt stillem Erfolg (API bekaeme sonst nur Signaturfehler)."""
    from tests.conftest import (
        GARAGE_DEV_ADMIN_TOKEN,
        S3_ACCESS_KEY,
        S3_SECRET_KEY,
        TEST_BUCKET,
    )
    from scripts.garage_init import init_garage

    url = f"http://{s3_container.get_container_host_ip()}:{s3_container.get_exposed_port(3903)}"
    init_garage(url, GARAGE_DEV_ADMIN_TOKEN, TEST_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)
    with pytest.raises(ValueError, match="Rotation"):
        init_garage(url, GARAGE_DEV_ADMIN_TOKEN, TEST_BUCKET, S3_ACCESS_KEY, "f" * 64)

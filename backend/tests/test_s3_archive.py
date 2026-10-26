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
    objs = {prefix + "originals/a": b"\xff\xd8\xffjpeg", prefix + "staging/b": b"png"}
    for key, data in objs.items():
        storage._client.put_object(
            Bucket=storage.bucket, Key=key, Body=data, ContentType="image/jpeg"
        )

    before = [l for l in manifest(storage) if l.startswith(prefix)]
    assert before == sorted(f"{k}\t{len(v)}" for k, v in objs.items())
    buf = io.BytesIO()
    assert export_bucket(storage, buf) >= len(objs)
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

"""Storage-Service-Tests gegen MinIO (S3-API-Kompat zu Garage)."""
import urllib.request
from uuid import uuid4

import pytest

from app.storage import ObjectNotFound, get_storage


def test_make_key_uses_user_prefix():
    storage = get_storage()
    user_id = uuid4()
    image_id = uuid4()
    key = storage.make_key(user_id, image_id)
    assert key == f"{user_id}/originals/{image_id}"


def test_presigned_put_url_can_actually_upload():
    storage = get_storage()
    user_id = uuid4()
    image_id = uuid4()
    key = storage.make_key(user_id, image_id)

    upload_url, expires_in = storage.presign_put(key, "image/jpeg")
    assert expires_in > 0
    assert upload_url.startswith("http")

    payload = b"fake-jpeg-bytes-" * 64
    req = urllib.request.Request(
        upload_url, data=payload, method="PUT",
        headers={"Content-Type": "image/jpeg"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert 200 <= resp.status < 300


def test_head_object_returns_size_after_upload():
    storage = get_storage()
    user_id = uuid4()
    image_id = uuid4()
    key = storage.make_key(user_id, image_id)
    payload = b"x" * 1024

    upload_url, _ = storage.presign_put(key, "image/png")
    req = urllib.request.Request(
        upload_url, data=payload, method="PUT",
        headers={"Content-Type": "image/png"},
    )
    with urllib.request.urlopen(req, timeout=5):
        pass

    size = storage.head(key)
    assert size == len(payload)


def test_head_object_raises_on_missing_object():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    with pytest.raises(ObjectNotFound):
        storage.head(key)


def test_delete_object_removes_it():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())

    upload_url, _ = storage.presign_put(key, "image/jpeg")
    req = urllib.request.Request(
        upload_url, data=b"data", method="PUT",
        headers={"Content-Type": "image/jpeg"},
    )
    with urllib.request.urlopen(req, timeout=5):
        pass

    assert storage.head(key) == 4
    storage.delete(key)

    with pytest.raises(ObjectNotFound):
        storage.head(key)


def test_presigned_get_url_returns_uploaded_bytes():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    payload = b"hello-world"

    put_url, _ = storage.presign_put(key, "text/plain")
    req = urllib.request.Request(
        put_url, data=payload, method="PUT",
        headers={"Content-Type": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=5):
        pass

    get_url, _ = storage.presign_get(key)
    with urllib.request.urlopen(get_url, timeout=5) as resp:
        body = resp.read()
    assert body == payload

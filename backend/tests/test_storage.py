"""Storage-Service-Tests gegen Garage-Testcontainer (S3-API-kompatibel)."""
import urllib.request
from uuid import uuid4

import pytest

from app.storage import ObjectNotFound, get_storage
from tests.s3_upload import post_presigned


def test_make_key_uses_user_prefix():
    storage = get_storage()
    user_id = uuid4()
    image_id = uuid4()
    key = storage.make_key(user_id, image_id)
    assert key == f"{user_id}/originals/{image_id}"


def _upload(storage, key: str, data: bytes, content_type: str) -> None:
    url, fields, _ = storage.presign_post(key, content_type, max_size=len(data))
    r = post_presigned(url, fields, data, content_type)
    assert 200 <= r.status_code < 300, r.text


def test_presigned_post_can_actually_upload():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    payload = b"fake-jpeg-bytes-" * 64
    url, fields, expires_in = storage.presign_post(key, "image/jpeg", max_size=len(payload))
    assert expires_in > 0
    assert url.startswith("http")
    assert fields["key"] == key
    r = post_presigned(url, fields, payload, "image/jpeg")
    assert 200 <= r.status_code < 300, r.text
    assert storage.head(key) == len(payload)


def test_presigned_post_lehnt_groesseren_body_ab():
    """content-length-range der Policy: S3 nimmt keinen groesseren Body an."""
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    url, fields, _ = storage.presign_post(key, "image/jpeg", max_size=100)
    r = post_presigned(url, fields, b"x" * 101, "image/jpeg")
    assert r.status_code == 400
    with pytest.raises(ObjectNotFound):
        storage.head(key)


def test_presigned_post_bindet_key_und_content_type():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    url, fields, _ = storage.presign_post(key, "image/jpeg", max_size=100)
    other = dict(fields, key=storage.make_key(uuid4(), uuid4()))
    assert post_presigned(url, other, b"x", "image/jpeg").status_code >= 400
    html = dict(fields, **{"Content-Type": "text/html"})
    assert post_presigned(url, html, b"x", "text/html").status_code >= 400


def test_head_object_returns_size_after_upload():
    storage = get_storage()
    user_id = uuid4()
    image_id = uuid4()
    key = storage.make_key(user_id, image_id)
    payload = b"x" * 1024

    _upload(storage, key, payload, "image/png")

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

    _upload(storage, key, b"data", "image/jpeg")

    assert storage.head(key) == 4
    storage.delete(key)

    with pytest.raises(ObjectNotFound):
        storage.head(key)


def test_presigned_get_url_returns_uploaded_bytes():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    payload = b"hello-world"

    _upload(storage, key, payload, "text/plain")

    get_url, _ = storage.presign_get(key)
    with urllib.request.urlopen(get_url, timeout=5) as resp:
        body = resp.read()
    assert body == payload

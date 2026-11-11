"""Schneller SigV4-GET-Presigner: Byte-Vergleich gegen boto3 bei fester Zeit
plus echte Abrufe gegen den Garage-Testcontainer."""
import urllib.error
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4

import boto3
import botocore.auth
import pytest
from botocore.client import Config

from app.s3_presign import S3GetPresigner
from app.storage import get_storage

ACCESS = "GKde7000000000000000000001"
SECRET = "de70000000000000000000000000000000000000000000000000000000000001"
FIXED = datetime(2026, 11, 11, 23, 59, 58, tzinfo=timezone.utc)

KEYS = [
    "0e3744df-7ac1-43db-9346-42fe69d167ab/thumbs/2d4da875-abcdefabcdef-400.jpg",
    "uid/originals/datei mit leerzeichen.CR3",
    "uid/originals/umlaut-äöüß.jpg",
    "uid/sonder/a+b=c&d?e#f%g~h*i'j(k)l!m,n;o:p@q$r.jpg",
    "uid//doppel/slash/",
]

ENDPOINTS = [
    "http://localhost:9000",
    "https://lumen.example.org",
    "https://lumen.example.org:443",
    "http://127.0.0.1:80",
    "https://lumen.example.org:8443/s3",
    "http://[::1]:3900",
]


def _boto_url(endpoint: str, bucket: str, key: str, expires: int, attachment: bool) -> str:
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name="garage",
        aws_access_key_id=ACCESS,
        aws_secret_access_key=SECRET,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    params = {"Bucket": bucket, "Key": key}
    if attachment:
        params["ResponseContentDisposition"] = "attachment"
    return client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)


@pytest.fixture
def frozen_botocore(monkeypatch):
    monkeypatch.setattr(
        botocore.auth,
        "get_current_datetime",
        lambda remove_tzinfo=True: FIXED.replace(tzinfo=None) if remove_tzinfo else FIXED,
    )


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("key", KEYS)
@pytest.mark.parametrize("attachment", [False, True])
def test_url_ist_byte_identisch_mit_boto3(frozen_botocore, endpoint, key, attachment):
    signer = S3GetPresigner(
        endpoint=endpoint,
        region="garage",
        bucket="lumen-images",
        access_key=ACCESS,
        secret_key=SECRET,
    )
    ours = signer.presign_get(
        key,
        900,
        response_content_disposition="attachment" if attachment else None,
        now=FIXED,
    )
    assert ours == _boto_url(endpoint, "lumen-images", key, 900, attachment)


def test_signing_key_wird_bei_datumswechsel_neu_abgeleitet(monkeypatch):
    signer = S3GetPresigner(
        endpoint="http://localhost:9000",
        region="garage",
        bucket="lumen-images",
        access_key=ACCESS,
        secret_key=SECRET,
    )
    next_day = datetime(2026, 11, 12, 0, 0, 1, tzinfo=timezone.utc)
    signer.presign_get("k", 900, now=FIXED)
    ours = signer.presign_get("k", 900, now=next_day)
    monkeypatch.setattr(
        botocore.auth,
        "get_current_datetime",
        lambda remove_tzinfo=True: next_day.replace(tzinfo=None),
    )
    assert ours == _boto_url("http://localhost:9000", "lumen-images", "k", 900, False)
    assert "20261112%2Fgarage" in ours


def test_ungueltiger_endpoint_wird_abgelehnt():
    with pytest.raises(ValueError):
        S3GetPresigner(
            endpoint="localhost:9000",
            region="garage",
            bucket="b",
            access_key=ACCESS,
            secret_key=SECRET,
        )


# ---------- Integration gegen Garage ----------


def _upload(key: str, data: bytes) -> None:
    # Direkt ueber boto3: Multipart-Formfelder vertragen keine Nicht-ASCII-Keys.
    get_storage().put_bytes(key, data, "image/jpeg")


def _status(url: str) -> tuple[int, bytes, dict[str, str]]:
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status, resp.read(), {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        return exc.code, b"", {}


def test_signierte_url_liefert_objekt_von_garage():
    storage = get_storage()
    key = f"{uuid4()}/thumbs/{uuid4()} mit ä-400.jpg"
    _upload(key, b"jpeg-bytes")
    url, _ = storage.presign_get(key)
    status, body, _ = _status(url)
    assert status == 200
    assert body == b"jpeg-bytes"


def test_attachment_url_setzt_content_disposition():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    _upload(key, b"raw")
    url, _ = storage.presign_get(key, attachment=True)
    status, _, headers = _status(url)
    assert status == 200
    assert headers.get("content-disposition") == "attachment"


def test_manipulierte_signatur_gibt_403():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    _upload(key, b"x")
    url, _ = storage.presign_get(key)
    last = url[-1]
    tampered = url[:-1] + ("0" if last != "0" else "1")
    assert _status(tampered)[0] == 403


def test_manipulierter_key_gibt_403():
    storage = get_storage()
    uid = uuid4()
    key = storage.make_key(uid, uuid4())
    other = storage.make_key(uid, uuid4())
    _upload(key, b"a")
    _upload(other, b"b")
    url, _ = storage.presign_get(key)
    assert _status(url.replace(key, other))[0] == 403


def test_manipuliertes_ablaufdatum_gibt_403():
    storage = get_storage()
    key = storage.make_key(uuid4(), uuid4())
    _upload(key, b"x")
    url, _ = storage.presign_get(key)
    assert "X-Amz-Expires=900" in url
    assert _status(url.replace("X-Amz-Expires=900", "X-Amz-Expires=604800"))[0] == 403

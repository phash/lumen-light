"""Test-Helper: echte Bilddaten (Pillow) + Upload ueber die Images-API."""
from __future__ import annotations

import io

from PIL import Image

from tests.s3_upload import upload_via_init


# Fake-ICC-Profil: Pillow schreibt die Bytes 1:1 als APP2-Segment.
FAKE_ICC = b"\x00\x00\x02\x0cfake-icc-profile-bytes" + b"\x00" * 64


def make_jpeg(
    width: int = 64,
    height: int = 48,
    *,
    with_metadata: bool = False,
    color: tuple[int, int, int] = (200, 120, 40),
) -> bytes:
    """Echtes JPEG. Mit with_metadata: EXIF (Make/Artist + GPS-IFD) und ICC."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    kwargs: dict[str, object] = {"quality": 90}
    if with_metadata:
        exif = Image.Exif()
        exif[0x010F] = "GeheimeKamera"  # Make
        exif[0x013B] = "Max Mustermann"  # Artist
        gps = exif.get_ifd(0x8825)
        gps[1] = "N"  # GPSLatitudeRef
        gps[2] = (52.0, 31.0, 12.0)  # GPSLatitude
        kwargs["exif"] = exif.tobytes()
        kwargs["icc_profile"] = FAKE_ICC
    img.save(buf, "JPEG", **kwargs)
    return buf.getvalue()


async def upload_image(
    client,
    headers,
    *,
    data: bytes | None = None,
    content_type: str = "image/jpeg",
    filename: str = "cover.jpg",
    confirm: bool = True,
) -> str:
    """Init + Pre-Signed-POST (+ optional confirm). Liefert die Image-ID."""
    payload = data if data is not None else make_jpeg()
    r = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": filename,
            "contentType": content_type,
            "sizeBytes": len(payload),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    upload_via_init(body, payload, content_type)
    if confirm:
        c = await client.post(f"/api/v1/images/{body['id']}/confirm", headers=headers)
        assert c.status_code == 200, c.text
    return body["id"]

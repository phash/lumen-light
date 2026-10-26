"""Test-Helper: Upload ueber die Pre-Signed-POST-Antwort von POST /images."""
from __future__ import annotations

from typing import Any

import httpx


def post_presigned(
    url: str, fields: dict[str, str], data: bytes, content_type: str
) -> httpx.Response:
    return httpx.post(
        url,
        data=fields,
        files={"file": ("upload", data, content_type)},
        timeout=10,
    )


def upload_via_init(init: dict[str, Any], data: bytes, content_type: str) -> None:
    """init = JSON-Body von POST /images (uploadUrl + uploadFields)."""
    r = post_presigned(init["uploadUrl"], init["uploadFields"], data, content_type)
    assert 200 <= r.status_code < 300, r.text

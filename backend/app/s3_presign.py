"""Schneller SigV4-Query-Presigner fuer S3-GET-Objekt-URLs.

boto3 ``generate_presigned_url`` kostet ~0.2 ms pro URL (Request-Objekt,
Event-Hooks, Serializer, Endpoint-Resolver). GET /images signiert bis zu
2 x 500 URLs pro Seite, deshalb hier ein schmaler Nachbau nur fuer den
einen Fall "GET auf ein Objekt, path-style, UNSIGNED-PAYLOAD, nur Host
signiert". Der Signing-Key (4 HMACs) wird pro Tag gecacht, pro URL bleiben
ein SHA-256 und ein HMAC.

Die Ausgabe ist Byte-fuer-Byte identisch mit botocore (S3SigV4QueryAuth)
bei gleichem Zeitstempel — siehe tests/test_s3_presign.py. Upload (POST)
und alle anderen Operationen laufen weiter ueber boto3.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

_ALGORITHM = "AWS4-HMAC-SHA256"
_SERVICE = "s3"
_UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"
# Wie botocore.utils.SAFE_CHARS (Query) bzw. Key-Serializer (Pfad).
_QUERY_SAFE = "-_.~"
_PATH_SAFE = "/~"
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _q(value: str) -> str:
    return quote(value, safe=_QUERY_SAFE)


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


class S3GetPresigner:
    """Signiert GET-URLs fuer Objekte eines Buckets (path-style).

    Thread-sicher: der Cache ist ein einzelnes Tupel, das atomar ersetzt
    wird; im schlimmsten Fall leiten zwei Threads denselben Key doppelt ab.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        region: str,
        bucket: str,
        access_key: str,
        secret_key: str,
    ) -> None:
        parts = urlsplit(endpoint)
        if parts.scheme not in _DEFAULT_PORTS or not parts.hostname:
            raise ValueError(f"Ungueltiger S3-Endpoint: {endpoint!r}")
        # Host-Header wie botocore (_host_from_url): Default-Port entfaellt.
        host = parts.hostname
        if ":" in host:  # IPv6-Literal
            host = f"[{host}]"
        if parts.port is not None and parts.port != _DEFAULT_PORTS[parts.scheme]:
            host = f"{host}:{parts.port}"
        self._host = host
        # botocore haengt Bucket und Key an einen eventuellen Endpoint-Pfad.
        base_path = parts.path.rstrip("/")
        self._origin = f"{parts.scheme}://{parts.netloc}"
        self._path_prefix = f"{base_path}/{quote(bucket, safe=_PATH_SAFE)}/"
        self._region = region
        self._access_key = access_key
        self._secret_key = secret_key
        self._key_cache: tuple[str, bytes] | None = None

    def _signing_key(self, datestamp: str) -> bytes:
        cached = self._key_cache
        if cached is not None and cached[0] == datestamp:
            return cached[1]
        k = _hmac(f"AWS4{self._secret_key}".encode("utf-8"), datestamp)
        k = _hmac(k, self._region)
        k = _hmac(k, _SERVICE)
        k = _hmac(k, "aws4_request")
        self._key_cache = (datestamp, k)
        return k

    def presign_get(
        self,
        key: str,
        expires_in: int,
        *,
        response_content_disposition: str | None = None,
        now: datetime | None = None,
    ) -> str:
        """Pre-Signed GET-URL fuer ``key``. ``now`` nur fuer Tests (UTC)."""
        ts = now if now is not None else datetime.now(timezone.utc)
        amz_date = ts.strftime("%Y%m%dT%H%M%SZ")
        datestamp = amz_date[:8]
        scope = f"{datestamp}/{self._region}/{_SERVICE}/aws4_request"
        path = self._path_prefix + quote(key, safe=_PATH_SAFE)

        # Reihenfolge der URL-Parameter wie botocore: Operations-Parameter
        # zuerst, dann Auth-Parameter, Signatur zuletzt.
        params: list[tuple[str, str]] = []
        if response_content_disposition is not None:
            params.append(
                ("response-content-disposition", _q(response_content_disposition))
            )
        params += [
            ("X-Amz-Algorithm", _ALGORITHM),
            ("X-Amz-Credential", _q(f"{self._access_key}/{scope}")),
            ("X-Amz-Date", amz_date),
            ("X-Amz-Expires", str(int(expires_in))),
            ("X-Amz-SignedHeaders", "host"),
        ]
        query = "&".join(f"{k}={v}" for k, v in params)
        canonical_query = "&".join(f"{k}={v}" for k, v in sorted(params))
        canonical_request = (
            f"GET\n{path}\n{canonical_query}\n"
            f"host:{self._host}\n\nhost\n{_UNSIGNED_PAYLOAD}"
        )
        string_to_sign = (
            f"{_ALGORITHM}\n{amz_date}\n{scope}\n"
            + hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
        )
        signature = hmac.new(
            self._signing_key(datestamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{self._origin}{path}?{query}&X-Amz-Signature={signature}"

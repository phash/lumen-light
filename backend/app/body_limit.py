"""ASGI-Middleware: Request-Body-Groesse begrenzen (413).

Zwei Pfade:
- Content-Length-Header ueber dem Limit -> sofort 413, ohne den Body zu
  lesen.
- Ohne (oder mit falschem) Content-Length, z.B. Transfer-Encoding: chunked:
  die gelesenen Bytes werden mitgezaehlt; beim Ueberschreiten wird das
  Lesen abgebrochen und 413 geantwortet (sofern die Response noch nicht
  begonnen hat).

Reine ASGI-Implementierung statt BaseHTTPMiddleware, damit der Body nicht
gepuffert und Streaming nicht gebrochen wird.
"""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from starlette.exceptions import HTTPException

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

_DETAIL = "Anfrage zu groß."


class _BodyTooLarge(HTTPException):
    """HTTPException-Subklasse: FastAPI wandelt beliebige Fehler beim
    Body-Lesen sonst in ein generisches 400 um; HTTPExceptions reicht es
    unveraendert an den Exception-Handler durch -> sauberes 413."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail=_DETAIL)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def _reject(self, send: Send) -> None:
        body = json.dumps({"detail": _DETAIL}, ensure_ascii=False).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = -1
                if declared > self.max_bytes:
                    await self._reject(send)
                    return
                break

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not response_started:
                await self._reject(send)

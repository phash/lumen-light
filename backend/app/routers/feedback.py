"""User-facing Feedback-Endpoint.

Auth required (Token muss valide sein), Honeypot-Field 'website' MUSS
leer bleiben — Bots fuellen das gerne automatisch. Rate-Limit
5/Stunde pro User-Token-Hash.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.database import get_db
from app.models import Feedback, User
from app.rate_limit import limiter
from app.schemas import FeedbackIn


router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def submit_feedback(
    request: Request,
    payload: FeedbackIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Honeypot: das Feld 'website' darf nicht gesetzt sein. Wir lesen es
    # aus model_extra (Pydantic 2 mit extra='allow'); echte UI sendet
    # entweder gar nichts oder einen leeren String.
    extras = payload.model_extra or {}
    honey = extras.get("website")
    if isinstance(honey, str) and honey.strip():
        # Kein 4xx-Detail-Leak — Bots sollen nicht lernen, was sie
        # falsch machen. Wir geben 201 zurueck und schreiben nichts.
        return {"id": None}

    fb = Feedback(
        user_id=user.id,
        kind=payload.kind,
        message=payload.message.strip(),
        page=payload.page.strip() if payload.page else None,
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)
    return {"id": str(fb.id)}

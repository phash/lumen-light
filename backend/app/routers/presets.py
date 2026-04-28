"""Presets-CRUD-Endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.database import get_db
from app.models import Preset, User
from app.rate_limit import limiter
from app.schemas import PresetIn, PresetOut


router = APIRouter()


SORT_FIELDS = {
    "name": Preset.name.asc(),
    "-name": Preset.name.desc(),
    "created_at": Preset.created_at.asc(),
    "-created_at": Preset.created_at.desc(),
}


@router.get("", response_model=list[PresetOut])
async def list_presets(
    q: str | None = Query(default=None, description="Substring-Suche im Namen"),
    sort: str = Query(default="name"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PresetOut]:
    if sort not in SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"sort muss einer von {list(SORT_FIELDS)} sein.")
    stmt = select(Preset).where(Preset.user_id == user.id)
    if q:
        stmt = stmt.where(Preset.name.ilike(f"%{q}%"))
    stmt = stmt.order_by(SORT_FIELDS[sort])
    result = await db.execute(stmt)
    return [PresetOut.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PresetOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
async def create_preset(
    request: Request,
    payload: PresetIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PresetOut:
    p = Preset(
        user_id=user.id,
        name=payload.name,
        adjustments=payload.adjustments.model_dump(),
        masks=[m.model_dump() for m in payload.masks],
    )
    db.add(p)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Preset-Name bereits vergeben.")
    await db.refresh(p)
    return PresetOut.model_validate(p)


@router.put("/{preset_id}", response_model=PresetOut)
@limiter.limit("60/minute")
async def update_preset(
    request: Request,
    preset_id: UUID,
    payload: PresetIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PresetOut:
    result = await db.execute(
        select(Preset).where(Preset.id == preset_id, Preset.user_id == user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    p.name = payload.name
    p.adjustments = payload.adjustments.model_dump()
    p.masks = [m.model_dump() for m in payload.masks]
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Preset-Name bereits vergeben.")
    await db.refresh(p)
    return PresetOut.model_validate(p)


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
async def delete_preset(
    request: Request,
    preset_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(Preset).where(Preset.id == preset_id, Preset.user_id == user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    await db.delete(p)
    await db.commit()

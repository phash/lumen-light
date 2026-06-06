"""Presets-CRUD-Endpoints."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.database import get_db
from app.models import Image, ImageEdit, Preset, User
from app.profile_groups import merge_edit_state
from app.rate_limit import limiter
from app.routers.marketplace import REPORT_AUTOHIDE_THRESHOLD
from app.schemas import (
    Adjustments,
    BatchApplyIn,
    BatchApplyOut,
    ImageEditState,
    PresetIn,
    PresetOut,
)


async def _validate_preview_image(
    db: AsyncSession,
    user: User,
    preview_image_id: UUID | None,
    *,
    public: bool,
) -> None:
    if preview_image_id is None:
        return
    img = (
        await db.execute(
            select(Image).where(
                Image.id == preview_image_id, Image.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if img is None:
        raise HTTPException(
            status_code=400,
            detail="preview_image_id muss zu einem eigenen Bild gehoeren.",
        )
    # Oeffentliche Vorschaubilder werden an alle eingeloggten User
    # ausgeliefert (marketplace previewUrl). Nur JPEG wird beim Upload
    # client-seitig von EXIF/GPS befreit (exifStrip.ts ueberspringt PNG/RAW)
    # und ist im <img> darstellbar -> Public-Preview muss JPEG sein. RAW-
    # Originale des Users bleiben privat und sind hiervon nicht betroffen.
    if public and img.content_type != "image/jpeg":
        raise HTTPException(
            status_code=400,
            detail=(
                "Vorschaubild fuer oeffentliche Presets muss ein JPEG sein "
                "(Metadaten werden beim Upload entfernt, browser-darstellbar)."
            ),
        )


router = APIRouter()


SORT_FIELDS = {
    "name": Preset.name.asc(),
    "-name": Preset.name.desc(),
    "created_at": Preset.created_at.asc(),
    "-created_at": Preset.created_at.desc(),
}


@router.get("", response_model=list[PresetOut])
async def list_presets(
    q: str | None = Query(
        default=None, max_length=80, description="Substring-Suche im Namen"
    ),
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
    await _validate_preview_image(
        db, user, payload.preview_image_id, public=payload.visibility == "public"
    )
    published_at: datetime | None = (
        datetime.now(timezone.utc) if payload.visibility == "public" else None
    )
    p = Preset(
        user_id=user.id,
        name=payload.name,
        adjustments=payload.adjustments.model_dump(),
        masks=[m.model_dump() for m in payload.masks],
        geometry=payload.geometry.model_dump() if payload.geometry else None,
        visibility=payload.visibility,
        genre=payload.genre,
        description=payload.description,
        preview_image_id=payload.preview_image_id,
        published_at=published_at,
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
    await _validate_preview_image(
        db, user, payload.preview_image_id, public=payload.visibility == "public"
    )
    p.name = payload.name
    p.adjustments = payload.adjustments.model_dump()
    p.masks = [m.model_dump() for m in payload.masks]
    p.geometry = payload.geometry.model_dump() if payload.geometry else None
    # published_at: null -> NOW beim erstmaligen Veroeffentlichen,
    # sonst beibehalten. Bei privat: zuruecksetzen, damit Public-Listen
    # konsistent bleiben.
    was_public = p.visibility == "public"
    # Auto-Hide-Block: ein Preset, das schon ueber dem Schwellenwert
    # gemeldet wurde, kann nicht einfach wieder live geschaltet werden,
    # ohne dass die Reports vorher inhaltlich abgearbeitet werden. 409
    # statt stilles Erlauben, damit der Creator weiss, was los ist.
    if (
        payload.visibility == "public"
        and not was_public
        and p.report_count >= REPORT_AUTOHIDE_THRESHOLD
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Preset wurde wegen Meldungen zurueckgezogen — bitte den"
                " Selfhost-Betreiber kontaktieren."
            ),
        )
    p.visibility = payload.visibility
    p.genre = payload.genre
    p.description = payload.description
    p.preview_image_id = payload.preview_image_id
    if payload.visibility == "public":
        if not was_public or p.published_at is None:
            p.published_at = datetime.now(timezone.utc)
    else:
        p.published_at = None
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


@router.post("/{preset_id}/apply", response_model=BatchApplyOut)
@limiter.limit("30/minute")
async def apply_preset_batch(
    request: Request,
    preset_id: UUID,
    payload: BatchApplyIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> BatchApplyOut:
    """Wendet die angehakten Schritt-Gruppen eines Presets nicht-destruktiv
    auf den gespeicherten Edit-State mehrerer eigener Bilder an. All-or-
    nothing: Ownership/Ready wird vorab geprueft, dann ein Commit."""
    preset = (
        await db.execute(
            select(Preset).where(
                Preset.id == preset_id, Preset.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")

    image_ids = list(dict.fromkeys(payload.image_ids))  # dedupe, Reihenfolge egal
    images = (
        await db.execute(
            select(Image).where(
                Image.id.in_(image_ids),
                Image.user_id == user.id,
                Image.upload_state == "ready",
            )
        )
    ).scalars().all()
    if len(images) != len(image_ids):
        raise HTTPException(
            status_code=400,
            detail="Mindestens ein Bild ist fremd, unbekannt oder nicht ready.",
        )

    existing_edits = {
        e.image_id: e
        for e in (
            await db.execute(
                select(ImageEdit).where(ImageEdit.image_id.in_(image_ids))
            )
        ).scalars().all()
    }
    default_state = ImageEditState(adjustments=Adjustments()).model_dump()

    for image_id in image_ids:
        edit = existing_edits.get(image_id)
        base_state = edit.state if edit is not None else default_state
        merged = merge_edit_state(
            base_state=base_state,
            preset_adjustments=preset.adjustments,
            preset_masks=preset.masks,
            preset_geometry=preset.geometry,
            enabled=payload.groups,
        )
        # Validierung (Ranges, Mask-Caps) + Normalisierung auf camelCase.
        validated = ImageEditState.model_validate(merged).model_dump()
        if edit is None:
            db.add(ImageEdit(image_id=image_id, state=validated))
        else:
            edit.state = validated

    await db.commit()
    return BatchApplyOut(applied=len(image_ids), total=len(image_ids))

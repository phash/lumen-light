"""Preset-Marketplace-Endpunkte (F1).

Sicherheitsmodell:
- Alle Routen brauchen einen authentifizierten User (current_user).
  Anonymous-Browse ist explizit out-of-scope im MVP.
- Apply, Fork und Report sind ratelimitiert.
- Auto-Hide bei report_count >= 3 setzt das Preset still auf private
  zurueck — Creator-Nachricht kommt erst mit SMTP (Backlog).
"""
import base64
import binascii
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.database import get_db
from app.models import Image, Preset, PresetReport, User
from app.rate_limit import limiter
from app.schemas import (
    Adjustments,
    MarketplaceApplyOut,
    MarketplaceDetailOut,
    MarketplaceListItem,
    MarketplaceListOut,
    MaskData,
    PresetGenre,
    PresetOut,
    PresetReportIn,
)
from app.storage import StorageService, get_storage


logger = logging.getLogger(__name__)
router = APIRouter()

REPORT_AUTOHIDE_THRESHOLD = 3
PAGE_LIMIT_DEFAULT = 24
PAGE_LIMIT_MAX = 60


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode()


def _decode_cursor(cursor: str) -> int:
    try:
        return int(base64.urlsafe_b64decode(cursor).decode())
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="Ungueltiger Cursor.")


def _preview_url(
    storage: StorageService,
    db_session: AsyncSession,  # noqa: ARG001 — Hook fuer spaetere Caches
    image: Image | None,
) -> str | None:
    if image is None:
        return None
    url, _ = storage.presign_get(image.bucket_key)
    return url


@router.get("/presets", response_model=MarketplaceListOut)
async def list_marketplace_presets(
    genre: PresetGenre | None = Query(default=None),
    q: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="new", pattern=r"^(new|popular)$"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=PAGE_LIMIT_DEFAULT, ge=1, le=PAGE_LIMIT_MAX),
    _user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> MarketplaceListOut:
    offset = _decode_cursor(cursor) if cursor else 0
    stmt = select(Preset, User).join(User, User.id == Preset.user_id).where(
        Preset.visibility == "public",
    )
    if genre is not None:
        stmt = stmt.where(Preset.genre == genre)
    if q:
        stmt = stmt.where(Preset.name.ilike(f"%{q}%"))
    if sort == "popular":
        stmt = stmt.order_by(desc(Preset.apply_count), desc(Preset.published_at), Preset.id)
    else:
        stmt = stmt.order_by(desc(Preset.published_at), Preset.id)
    stmt = stmt.offset(offset).limit(limit + 1)

    rows = (await db.execute(stmt)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    # Preview-Bilder bulk laden (eine Query).
    image_ids = [p.preview_image_id for p, _ in rows if p.preview_image_id]
    images_by_id: dict[UUID, Image] = {}
    if image_ids:
        img_rows = await db.execute(select(Image).where(Image.id.in_(image_ids)))
        images_by_id = {img.id: img for img in img_rows.scalars().all()}

    items: list[MarketplaceListItem] = []
    for preset, creator in rows:
        img = (
            images_by_id.get(preset.preview_image_id)
            if preset.preview_image_id
            else None
        )
        items.append(
            MarketplaceListItem(
                id=preset.id,
                name=preset.name,
                genre=preset.genre,
                description=preset.description,
                creator_handle=creator.handle,
                apply_count=preset.apply_count,
                published_at=preset.published_at,
                preview_url=_preview_url(storage, db, img),
            )
        )
    return MarketplaceListOut(
        items=items,
        next_cursor=_encode_cursor(offset + limit) if has_more else None,
    )


async def _load_public_preset(
    db: AsyncSession, preset_id: UUID
) -> tuple[Preset, User]:
    row = (
        await db.execute(
            select(Preset, User)
            .join(User, User.id == Preset.user_id)
            .where(Preset.id == preset_id, Preset.visibility == "public")
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Marketplace-Preset nicht gefunden.")
    return row[0], row[1]


@router.get("/presets/{preset_id}", response_model=MarketplaceDetailOut)
async def get_marketplace_preset(
    preset_id: UUID,
    _user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> MarketplaceDetailOut:
    preset, creator = await _load_public_preset(db, preset_id)
    img: Image | None = None
    if preset.preview_image_id:
        img = (
            await db.execute(select(Image).where(Image.id == preset.preview_image_id))
        ).scalar_one_or_none()
    return MarketplaceDetailOut(
        id=preset.id,
        name=preset.name,
        genre=preset.genre,
        description=preset.description,
        creator_handle=creator.handle,
        creator_bio=creator.bio,
        apply_count=preset.apply_count,
        published_at=preset.published_at,
        preview_url=_preview_url(storage, db, img),
    )


@router.post("/presets/{preset_id}/apply", response_model=MarketplaceApplyOut)
@limiter.limit("60/minute")
async def apply_marketplace_preset(
    request: Request,
    preset_id: UUID,
    _user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MarketplaceApplyOut:
    preset, _creator = await _load_public_preset(db, preset_id)
    # Apply-Count ist Counter-Cache; Drift unkritisch fuer den UI-Sort.
    preset.apply_count += 1
    await db.commit()
    return MarketplaceApplyOut(
        adjustments=Adjustments.model_validate(preset.adjustments),
        masks=[MaskData.model_validate(m) for m in preset.masks],
    )


@router.post(
    "/presets/{preset_id}/fork",
    response_model=PresetOut,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("60/minute")
async def fork_marketplace_preset(
    request: Request,
    preset_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PresetOut:
    src, _ = await _load_public_preset(db, preset_id)
    base_name = f"{src.name} (Kopie)"
    name = base_name
    suffix = 2
    # Bei Namens-Kollision suffix anhaengen.
    while True:
        existing = (
            await db.execute(
                select(Preset.id).where(
                    Preset.user_id == user.id, Preset.name == name
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            break
        name = f"{base_name} {suffix}"
        suffix += 1
        if suffix > 50:
            raise HTTPException(status_code=409, detail="Zu viele Forks dieses Presets.")
    fork = Preset(
        user_id=user.id,
        name=name,
        adjustments=dict(src.adjustments),
        masks=list(src.masks),
        visibility="private",
        # Genre/Description/Preview NICHT mitkopieren — der Fork ist privat.
    )
    db.add(fork)
    await db.commit()
    await db.refresh(fork)
    return PresetOut.model_validate(fork)


@router.post(
    "/presets/{preset_id}/report",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("5/hour")
async def report_marketplace_preset(
    request: Request,
    preset_id: UUID,
    payload: PresetReportIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    preset, _ = await _load_public_preset(db, preset_id)
    report = PresetReport(
        preset_id=preset.id,
        reporter_user_id=user.id,
        reason=payload.reason,
    )
    db.add(report)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Du hast dieses Preset bereits gemeldet.")

    # Auto-Hide-Trigger.
    count = (
        await db.execute(
            select(func.count())
            .select_from(PresetReport)
            .where(PresetReport.preset_id == preset.id)
        )
    ).scalar_one()
    preset.report_count = int(count)
    if count >= REPORT_AUTOHIDE_THRESHOLD and preset.visibility == "public":
        preset.visibility = "private"
        preset.published_at = None
        logger.warning(
            "preset %s auto-hidden after %d reports", preset.id, count
        )
    await db.commit()

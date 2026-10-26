"""Preset-Marketplace-Endpunkte (F1).

Sicherheitsmodell:
- Browsen (list + detail) ist OEFFENTLICH (kein current_user) — fuer SEO
  und damit Interessenten Presets ohne Account ansehen koennen. Die
  Responses enthalten keine user-spezifischen Felder.
- Apply, Fork und Report brauchen weiterhin einen authentifizierten User
  (current_user) und sind ratelimitiert.
- Auto-Hide bei report_count >= 3 setzt das Preset still auf private
  zurueck — Creator-Nachricht kommt erst mit SMTP (Backlog).
"""
import base64
import binascii
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
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
# Spaltenlaenge presets.name (String(80)) — Fork-Namen muessen hineinpassen.
PRESET_NAME_MAX = 80
FORK_SUFFIX = " (Kopie)"
MAX_FORK_SUFFIX = 50
# Deep-Pagination-Schutz: bei riesigem `cursor` wuerde Postgres linear
# scannen. Bei unrealistisch hohem Offset einfach 422.
MAX_CURSOR_OFFSET = 10_000


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode()


def _decode_cursor(cursor: str) -> int:
    try:
        offset = int(base64.urlsafe_b64decode(cursor).decode())
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="Ungueltiger Cursor.")
    if offset < 0 or offset > MAX_CURSOR_OFFSET:
        raise HTTPException(status_code=422, detail="Cursor-Offset ausserhalb des erlaubten Bereichs.")
    return offset


def _escape_like(term: str) -> str:
    """LIKE-Wildcards im Suchbegriff escapen (ESCAPE '\\'), damit `%`/`_`
    woertlich gesucht werden (kein "alles matchen" per q=%)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _fork_name(src_name: str, n: int) -> str:
    """'<Name> (Kopie)' bzw. '<Name> (Kopie) <n>' — Basisname so gekuerzt,
    dass das Ergebnis in presets.name (80 Zeichen) passt."""
    suffix = FORK_SUFFIX if n == 1 else f"{FORK_SUFFIX} {n}"
    return src_name[: PRESET_NAME_MAX - len(suffix)] + suffix


def _preview_url(
    storage: StorageService,
    db_session: AsyncSession,  # noqa: ARG001 — Hook fuer spaetere Caches
    image: Image | None,
) -> str | None:
    # Nur bestaetigte Uploads als Vorschau ausliefern. Ein pending/failed
    # Object koennte (vor confirm) beliebige, nicht magic-byte-gepruefte Bytes
    # enthalten — die werden im Marketplace same-origin im <img> gerendert.
    if image is None or image.upload_state != "ready":
        return None
    url, _ = storage.presign_get(image.bucket_key)
    return url


@router.get("/presets", response_model=MarketplaceListOut)
@limiter.limit("120/minute")
async def list_marketplace_presets(
    request: Request,
    genre: PresetGenre | None = Query(default=None),
    q: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="new", pattern=r"^(new|popular)$"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=PAGE_LIMIT_DEFAULT, ge=1, le=PAGE_LIMIT_MAX),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> MarketplaceListOut:
    offset = _decode_cursor(cursor) if cursor else 0
    stmt = select(Preset, User).join(User, User.id == Preset.user_id).where(
        Preset.visibility == "public",
        # Presets gesperrter Accounts verschwinden aus dem Marketplace.
        User.is_disabled.is_(False),
    )
    if genre is not None:
        stmt = stmt.where(Preset.genre == genre)
    if q:
        stmt = stmt.where(
            Preset.name.ilike(f"%{_escape_like(q)}%", escape="\\")
        )
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
            .where(
                Preset.id == preset_id,
                Preset.visibility == "public",
                User.is_disabled.is_(False),
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Marketplace-Preset nicht gefunden.")
    return row[0], row[1]


@router.get("/presets/{preset_id}", response_model=MarketplaceDetailOut)
@limiter.limit("120/minute")
async def get_marketplace_preset(
    request: Request,
    preset_id: UUID,
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
    # Atomic-Increment statt Read-Modify-Write — bei parallelem Apply
    # geht sonst ein Increment verloren. Counter ist Cache, aber lieber
    # genau als drift-faellig.
    await db.execute(
        update(Preset)
        .where(Preset.id == preset.id)
        .values(apply_count=Preset.apply_count + 1)
    )
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
    # INSERT ... ON CONFLICT DO NOTHING auf uq_presets_user_name statt
    # "SELECT pruefen, dann INSERT": parallele Forks desselben Presets
    # kollidieren sonst zwischen Check und Commit (IntegrityError -> 500).
    # Bei Konflikt einfach den naechsten Suffix probieren.
    fork_id: UUID | None = None
    for n in range(1, MAX_FORK_SUFFIX + 1):
        fork_id = (
            await db.execute(
                pg_insert(Preset)
                .values(
                    user_id=user.id,
                    name=_fork_name(src.name, n),
                    adjustments=dict(src.adjustments),
                    masks=list(src.masks),
                    # Geometrie (Crop/Straighten/Lens) ist Teil des Preset-
                    # Inhalts und muss mitkopiert werden.
                    geometry=dict(src.geometry) if src.geometry else None,
                    visibility="private",
                    # Genre/Description/Preview NICHT mitkopieren — privat.
                )
                .on_conflict_do_nothing(constraint="uq_presets_user_name")
                .returning(Preset.id)
            )
        ).scalar_one_or_none()
        if fork_id is not None:
            break
    if fork_id is None:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Zu viele Forks dieses Presets.")
    fork = (await db.execute(select(Preset).where(Preset.id == fork_id))).scalar_one()
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
    # Eigene Presets melden ist sinnlos (und wuerde den eigenen Report-Count
    # aufblaehen) -> still ignorieren.
    if preset.user_id == user.id:
        return None
    # Mindest-Account-Alter: sonst verstecken drei frisch angelegte Wegwerf-
    # Accounts jedes beliebige Preset (Auto-Hide ab 3 Meldungen).
    min_age = timedelta(hours=settings.report_min_account_age_hours)
    if datetime.now(timezone.utc) - user.created_at < min_age:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Dein Konto ist noch zu neu, um Presets zu melden — "
                "bitte versuche es später erneut."
            ),
        )
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

    # Auto-Hide-Trigger. Die Preset-Row sperren (FOR UPDATE), bevor wir den
    # denormalisierten report_count read-modify-write aktualisieren — sonst
    # ueberschreiben zwei parallele Reports verschiedener Reporter den Counter
    # mit einem veralteten Snapshot (Lost-Update), und die Auto-Hide-Schwelle
    # kann verpasst werden, obwohl genug echte Reports existieren.
    locked = (
        await db.execute(
            select(Preset).where(Preset.id == preset.id).with_for_update()
        )
    ).scalar_one()
    count = (
        await db.execute(
            select(func.count())
            .select_from(PresetReport)
            .where(PresetReport.preset_id == locked.id)
        )
    ).scalar_one()
    locked.report_count = int(count)
    if count >= REPORT_AUTOHIDE_THRESHOLD and locked.visibility == "public":
        locked.visibility = "private"
        locked.published_at = None
        logger.warning(
            "preset %s auto-hidden after %d reports", locked.id, count
        )
    await db.commit()

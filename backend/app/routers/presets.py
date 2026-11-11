"""Presets-CRUD-Endpoints."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.moderation import REPORT_AUTOHIDE_THRESHOLD, may_publish
from app.models import Image, ImageEdit, Preset, User
from app.previews import delete_preview_object, sync_preset_preview
from app.profile_groups import merge_edit_state
from app.rate_limit import limiter
from app.schemas import (
    Adjustments,
    BatchApplyIn,
    BatchApplyOut,
    ImageEditState,
    PresetIn,
    PresetOut,
)
from app.storage import StorageService, get_storage


# Pagination GET /presets: Default deckt das Preset-Kontingent ab, damit
# bestehende Clients ohne limit weiterhin alle Presets bekommen.
LIST_LIMIT_DEFAULT = 500
LIST_LIMIT_MAX = 500


_NAME_TAKEN_DETAIL = "Preset-Name bereits vergeben."


async def lock_user_row(db: AsyncSession, user: User) -> None:
    """SELECT ... FOR UPDATE auf die User-Row (L5): serialisiert parallele
    Requests desselben Users zwischen Kontingent-Zaehlung und INSERT —
    sonst zaehlen zwei gleichzeitige Requests denselben Stand und
    ueberschreiten das Kontingent gemeinsam. Sperre endet mit dem Commit."""
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())


async def _ensure_name_free(
    db: AsyncSession, user: User, name: str, *, exclude_id: UUID | None = None
) -> None:
    cond = [Preset.user_id == user.id, Preset.name == name]
    if exclude_id is not None:
        cond.append(Preset.id != exclude_id)
    taken = (
        await db.execute(select(Preset.id).where(*cond).limit(1))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=409, detail=_NAME_TAKEN_DETAIL)


async def ensure_preset_quota(db: AsyncSession, user: User) -> None:
    """Kontingent: max. settings.max_user_presets Presets pro User (409).
    Genutzt von POST /presets und dem Marketplace-Fork. Sperrt vorher die
    User-Row (lock_user_row), damit die Zaehlung race-frei ist."""
    await lock_user_row(db, user)
    count = (
        await db.execute(
            select(func.count()).select_from(Preset).where(Preset.user_id == user.id)
        )
    ).scalar_one()
    if count >= settings.max_user_presets:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Maximale Anzahl Presets ({settings.max_user_presets}) erreicht — "
                "bitte lösche nicht mehr benötigte Presets."
            ),
        )


async def _ensure_may_publish(db: AsyncSession, user: User) -> None:
    """Solange die Publish-Sperre des Users laeuft (gesetzt beim Auto-Hide
    eines eigenen Presets, Migration 012) oder ein eigenes Preset noch
    auto-versteckt ist, darf er nichts veroeffentlichen. Die Sperre haengt
    am User: Loeschen oder Umbenennen des versteckten Presets umgeht sie
    nicht (L3); ein abgelaufener Timer hebt offene Moderation nicht auf."""
    if not await may_publish(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Eines deiner Presets wurde wegen Meldungen zurückgezogen — "
                "bis zur Klärung kannst du keine Presets veröffentlichen."
            ),
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
            detail="Vorschaubild muss zu einem eigenen Bild gehören.",
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
                "Vorschaubild für öffentliche Presets muss ein JPEG sein."
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
    response: Response,
    q: str | None = Query(
        default=None, max_length=80, description="Substring-Suche im Namen"
    ),
    sort: str = Query(default="name"),
    limit: int = Query(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PresetOut]:
    """Eigene Presets. Additive Pagination: ?limit&offset, Gesamtzahl im
    Header X-Total-Count (Response bleibt eine Liste)."""
    if sort not in SORT_FIELDS:
        raise HTTPException(status_code=422, detail=f"sort muss einer von {list(SORT_FIELDS)} sein.")
    cond = [Preset.user_id == user.id]
    if q:
        cond.append(Preset.name.ilike(f"%{q}%"))
    total = (
        await db.execute(select(func.count()).select_from(Preset).where(*cond))
    ).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    # Preset.id als Tiebreaker: stabile Reihenfolge ueber Seiten hinweg.
    stmt = (
        select(Preset)
        .where(*cond)
        .order_by(SORT_FIELDS[sort], Preset.id)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [PresetOut.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PresetOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
async def create_preset(
    request: Request,
    payload: PresetIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> PresetOut:
    await ensure_preset_quota(db, user)
    await _validate_preview_image(
        db, user, payload.preview_image_id, public=payload.visibility == "public"
    )
    if payload.visibility == "public":
        await _ensure_may_publish(db, user)
    # L9: Namenskonflikt VOR dem (teuren) Vorschau-Build erkennen.
    await _ensure_name_free(db, user, payload.name)
    published_at: datetime | None = (
        datetime.now(timezone.utc) if payload.visibility == "public" else None
    )
    p = Preset(
        # ID vorab vergeben: der Vorschau-Key (<uid>/previews/<id>-<v>.jpg)
        # braucht sie schon vor dem INSERT.
        id=uuid4(),
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
    await sync_preset_preview(db, storage, p, force=True)
    new_key = p.preview_key
    db.add(p)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Race (paralleler Request mit gleichem Namen): Vorschau wurde schon
        # hochgeladen -> wieder wegraeumen.
        await delete_preview_object(storage, new_key)
        raise HTTPException(status_code=409, detail=_NAME_TAKEN_DETAIL)
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
    storage: StorageService = Depends(get_storage),
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
    # L9: Namenskonflikt VOR dem Vorschau-Build erkennen.
    if payload.name != p.name:
        await _ensure_name_free(db, user, payload.name, exclude_id=p.id)
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
                "Preset wurde wegen Meldungen zurückgezogen — bitte den"
                " Selfhost-Betreiber kontaktieren."
            ),
        )
    if payload.visibility == "public" and not was_public:
        await _ensure_may_publish(db, user)
    # Vorschau neu erzeugen, wenn erstmals veroeffentlicht oder das
    # Vorschaubild gewechselt wurde.
    regenerate = (not was_public) or p.preview_image_id != payload.preview_image_id
    p.visibility = payload.visibility
    p.genre = payload.genre
    p.description = payload.description
    p.preview_image_id = payload.preview_image_id
    if payload.visibility == "public":
        if not was_public or p.published_at is None:
            p.published_at = datetime.now(timezone.utc)
    else:
        p.published_at = None
    previous_key = p.preview_key
    stale_key = await sync_preset_preview(db, storage, p, force=regenerate)
    new_key = p.preview_key if p.preview_key != previous_key else None
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Neue (versionierte) Vorschau wieder weg; die alte ist unberuehrt
        # und bleibt referenziert.
        await delete_preview_object(storage, new_key)
        raise HTTPException(status_code=409, detail=_NAME_TAKEN_DETAIL)
    # Erst nach erfolgreichem Commit: abgeloeste Vorschau loeschen.
    await delete_preview_object(storage, stale_key)
    await db.refresh(p)
    return PresetOut.model_validate(p)


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
async def delete_preset(
    request: Request,
    preset_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> None:
    result = await db.execute(
        select(Preset).where(Preset.id == preset_id, Preset.user_id == user.id)
    )
    p = result.scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    preview_key = p.preview_key
    await db.delete(p)
    await db.commit()
    await delete_preview_object(storage, preview_key)


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
    # Bild ohne gespeicherten Stand = frisch -> aktuelle Prozessversion 2
    # (wie defaultAdjustments() im Editor). Der Pydantic-Default 1 gilt nur
    # fuer gespeicherte Daten ohne Feld.
    default_state = ImageEditState(
        adjustments=Adjustments(processVersion=2)
    ).model_dump()

    for image_id in image_ids:
        edit = existing_edits.get(image_id)
        base_state = edit.state if edit is not None else default_state
        merged = merge_edit_state(
            base_state=base_state,
            # Rohe JSONB durch das Adjustments-Modell normalisieren: aelteren
            # Presets (z.B. den Default-Presets vor Phase E/G) fehlen Felder
            # wie highlightRecovery/localContrast. Ohne Normalisierung setzt
            # merge_edit_state dort None ein -> ImageEditState-Validation 400.
            # PresetOut/Marketplace-Apply normalisieren genauso.
            preset_adjustments=Adjustments.model_validate(
                preset.adjustments
            ).model_dump(),
            preset_masks=preset.masks,
            preset_geometry=preset.geometry,
            enabled=payload.groups,
        )
        # Validierung (Ranges, Mask-Caps) + Normalisierung auf camelCase.
        try:
            validated = ImageEditState.model_validate(merged).model_dump()
        except PydanticValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Preset-Daten ungueltig fuer Bild {image_id}: {exc.error_count()} Fehler.",
            ) from exc
        if edit is None:
            db.add(ImageEdit(image_id=image_id, state=validated))
        else:
            edit.state = validated

    try:
        await db.commit()
    except IntegrityError as exc:
        # Race: ein Zielbild wurde zwischen Ownership-Check und Commit
        # geloescht (FK auf image_edits.image_id) -> sauberes 409 statt 500.
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ein Zielbild wurde waehrend des Anwendens geaendert oder geloescht.",
        ) from exc
    # applied == total by design (all-or-nothing). applied laesst Spielraum fuer kuenftigen partial-apply.
    return BatchApplyOut(applied=len(image_ids), total=len(image_ids))

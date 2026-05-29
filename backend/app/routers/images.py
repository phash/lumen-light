"""Images-CRUD — Pre-Signed URLs gegen Garage S3 (siehe ADR-011)."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.models import Image, ImageEdit, User
from app.rate_limit import limiter
from app.schemas import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    ImageEditState,
    ImageInitIn,
    ImageInitOut,
    ImageOut,
    ImageUrlOut,
)
from app.storage import ObjectNotFound, StorageService, get_storage


router = APIRouter()


# Magic-Byte-Signaturen fuer browser-interpretierbare Bildtypen. Der
# Pre-Signed PUT bindet nur den Content-Type-HEADER, nicht den Payload —
# ein Client kann also beliebige Bytes unter image/jpeg ablegen. Wir
# validieren die echten Anfangsbytes gegen die deklarierte Art, damit kein
# als Bild getarntes HTML/SVG/Script im Bucket landet, das spaeter same-
# origin ausgeliefert werden koennte.
#
# RAW-Vendor-Formate (cr2/cr3/nef/arw/raf/dng) sind NICHT browser-renderbar
# (werden nur heruntergeladen) und haben zu viele Vendor-Varianten fuer eine
# robuste Signaturliste -> bewusst kein Magic-Gate. Worst Case dort: der User
# legt Muell in seinen EIGENEN Bucket (durch Size-Check + Janitor begrenzt).
_IMAGE_MAGIC: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/tiff": (b"II*\x00", b"MM\x00*"),
}


SORT_FIELDS = {
    "created_at": Image.created_at.asc(),
    "-created_at": Image.created_at.desc(),
    "original_filename": Image.original_filename.asc(),
    "-original_filename": Image.original_filename.desc(),
}


def _ensure_owns_key(image: Image, user: User) -> None:
    """Defense in Depth: bucket_key MUSS mit der user_id beginnen."""
    expected_prefix = f"{user.id}/"
    if not image.bucket_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="bucket_key gehoert nicht zum eingeloggten User.",
        )


async def _discard_pending(
    db: AsyncSession, storage: StorageService, image: Image
) -> None:
    """Abgelehnten Upload aufraeumen: S3-Object (best-effort) + DB-Row weg,
    damit kein Zombie-Eintrag bleibt. Genutzt von den 413/415-Pfaden in
    confirm_upload."""
    try:
        await run_in_threadpool(storage.delete, image.bucket_key)
    except Exception:  # noqa: BLE001 — best-effort, Row geht trotzdem weg
        pass
    await db.delete(image)
    await db.commit()


@router.post("", response_model=ImageInitOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def init_upload(
    request: Request,
    payload: ImageInitIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageInitOut:
    if payload.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"content_type '{payload.content_type}' nicht erlaubt.",
        )
    if payload.size_bytes > settings.max_image_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"size_bytes ueber Maximum {settings.max_image_size_bytes}.",
        )

    image_id = uuid4()
    bucket_key = storage.make_key(user.id, image_id)

    image = Image(
        id=image_id,
        user_id=user.id,
        bucket_key=bucket_key,
        original_filename=payload.filename,
        content_type=payload.content_type,
        size_bytes=None,
        upload_state="pending",
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)

    upload_url, expires_in = storage.presign_put(bucket_key, payload.content_type)
    return ImageInitOut(id=image.id, upload_url=upload_url, expires_in=expires_in)


@router.post("/{image_id}/confirm", response_model=ImageOut)
@limiter.limit("30/minute")
async def confirm_upload(
    request: Request,
    image_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageOut:
    result = await db.execute(
        select(Image).where(Image.id == image_id, Image.user_id == user.id)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    _ensure_owns_key(image, user)

    try:
        # boto3 ist blockierend -> Threadpool, sonst steht der Event-Loop.
        size = await run_in_threadpool(storage.head, image.bucket_key)
    except ObjectNotFound as exc:
        raise HTTPException(
            status_code=409,
            detail="Object liegt nicht im Bucket — Upload wiederholen.",
        ) from exc

    # Server-side Size-Enforcement: die im init() angegebene size_bytes
    # ist Browser-behauptet, der echte Object-Size kommt erst hier ans
    # Licht. Pre-Signed-URLs haben keine Content-Length-Range-Constraint,
    # also kann ein Angreifer beliebig grosse Objekte pushen. Hard-Fail
    # mit Storage-Cleanup, damit der Bucket nicht voellt.
    if size > settings.max_image_size_bytes:
        await _discard_pending(db, storage, image)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Objekt-Groesse {size} ueber Maximum "
                f"{settings.max_image_size_bytes} Bytes — Upload abgelehnt."
            ),
        )

    # Content-Type-Enforcement: der Pre-Signed PUT bindet nur den Header,
    # nicht den Payload. Fuer browser-interpretierbare Typen pruefen wir die
    # echten Magic-Bytes gegen die deklarierte Art (siehe _IMAGE_MAGIC).
    magics = _IMAGE_MAGIC.get(image.content_type)
    if magics is not None:
        try:
            header = await run_in_threadpool(
                storage.head_bytes, image.bucket_key, 16
            )
        except ObjectNotFound as exc:
            raise HTTPException(
                status_code=409,
                detail="Object liegt nicht im Bucket — Upload wiederholen.",
            ) from exc
        if not any(header.startswith(sig) for sig in magics):
            await _discard_pending(db, storage, image)
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    "Objekt-Inhalt passt nicht zum deklarierten contentType "
                    f"'{image.content_type}' — Upload abgelehnt."
                ),
            )

    image.size_bytes = size
    image.upload_state = "ready"
    image.confirmed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(image)
    return ImageOut.model_validate(image)


@router.get("", response_model=list[ImageOut])
async def list_images(
    state: str = Query(default="ready", pattern="^(ready|pending|all)$"),
    sort: str = Query(default="-created_at"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ImageOut]:
    if sort not in SORT_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"sort muss einer von {list(SORT_FIELDS)} sein.",
        )
    stmt = select(Image).where(Image.user_id == user.id)
    if state != "all":
        stmt = stmt.where(Image.upload_state == state)
    stmt = stmt.order_by(SORT_FIELDS[sort])
    result = await db.execute(stmt)
    return [ImageOut.model_validate(i) for i in result.scalars().all()]


@router.get("/{image_id}/url", response_model=ImageUrlOut)
async def get_download_url(
    image_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageUrlOut:
    result = await db.execute(
        select(Image).where(Image.id == image_id, Image.user_id == user.id)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    _ensure_owns_key(image, user)

    url, expires_in = storage.presign_get(image.bucket_key)
    return ImageUrlOut(url=url, expires_in=expires_in)


async def _load_owned_image(db: AsyncSession, user: User, image_id: UUID) -> Image:
    """Bild laden + Ownership pruefen (404 wenn fremd/unbekannt)."""
    result = await db.execute(
        select(Image).where(Image.id == image_id, Image.user_id == user.id)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    _ensure_owns_key(image, user)
    return image


@router.get("/{image_id}/edit", response_model=ImageEditState)
async def get_image_edit(
    image_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ImageEditState:
    """Liefert den gespeicherten Bearbeitungsstand (C1, Multi-Device-Resume).
    404, wenn das Bild fremd/unbekannt ist ODER noch kein Stand gespeichert
    wurde — das Frontend startet dann mit den frischen Pixeln."""
    await _load_owned_image(db, user, image_id)
    edit = (
        await db.execute(
            select(ImageEdit).where(ImageEdit.image_id == image_id)
        )
    ).scalar_one_or_none()
    if edit is None:
        raise HTTPException(
            status_code=404, detail="Kein gespeicherter Bearbeitungsstand."
        )
    return ImageEditState.model_validate(edit.state)


@router.put("/{image_id}/edit", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("120/minute")
async def put_image_edit(
    request: Request,
    image_id: UUID,
    payload: ImageEditState,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Speichert/aktualisiert den Bearbeitungsstand (debounced Autosave aus
    dem Editor). Upsert auf image_id. 120/min deckt aktives Editieren ab."""
    await _load_owned_image(db, user, image_id)
    # model_dump() liefert dank serialize_by_alias=True camelCase — direkt
    # so im JSONB ablegen, sodass GET es 1:1 zurueckgeben kann.
    state = payload.model_dump()
    existing = (
        await db.execute(
            select(ImageEdit).where(ImageEdit.image_id == image_id)
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(ImageEdit(image_id=image_id, state=state))
    else:
        existing.state = state
    await db.commit()


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
async def delete_image(
    request: Request,
    image_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> None:
    result = await db.execute(
        select(Image).where(Image.id == image_id, Image.user_id == user.id)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    _ensure_owns_key(image, user)

    try:
        await run_in_threadpool(storage.delete, image.bucket_key)
    except Exception:
        # S3-Fehler: DB-Row als 'failed' markieren, kein Hard-Fail —
        # erneute DELETE-Calls funktionieren idempotent.
        image.upload_state = "failed"
        await db.commit()
        raise

    await db.delete(image)
    await db.commit()

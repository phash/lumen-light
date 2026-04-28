"""Images-CRUD — Pre-Signed URLs gegen Garage S3 (siehe ADR-011)."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.models import Image, User
from app.rate_limit import limiter
from app.schemas import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    ImageInitIn,
    ImageInitOut,
    ImageOut,
    ImageUrlOut,
)
from app.storage import ObjectNotFound, StorageService, get_storage


router = APIRouter()


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
        size = storage.head(image.bucket_key)
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
        try:
            storage.delete(image.bucket_key)
        except Exception:
            # Best effort — DB-Row gleich wegraeumen, sonst zombie-Eintrag.
            pass
        await db.delete(image)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Objekt-Groesse {size} ueber Maximum "
                f"{settings.max_image_size_bytes} Bytes — Upload abgelehnt."
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
        storage.delete(image.bucket_key)
    except Exception:
        # S3-Fehler: DB-Row als 'failed' markieren, kein Hard-Fail —
        # erneute DELETE-Calls funktionieren idempotent.
        image.upload_state = "failed"
        await db.commit()
        raise

    await db.delete(image)
    await db.commit()

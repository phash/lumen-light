"""Images-CRUD — Pre-Signed URLs gegen Garage S3 (siehe ADR-011)."""
import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
from app.database import get_db
from app.models import Image, ImageEdit, Preset, User
from app.previews import (
    BUSY_PREVIEW_DETAIL,
    THUMB_UPLOAD_MAX_BYTES,
    PreviewBusy,
    PreviewError,
    build_thumbnails,
    delete_preview_object,
)
from app.rate_limit import limiter
from app.schemas import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    ColorLabel,
    ImageEditState,
    ImageFlag,
    ImageInitIn,
    ImageInitOut,
    ImageMetaBatchPatch,
    ImageMetaPatch,
    ImageOut,
    ImageUrlOut,
)
from app.storage import ObjectNotFound, StorageService, get_storage


router = APIRouter()
logger = logging.getLogger(__name__)


# Magic-Byte-Signaturen je deklariertem Content-Type. Der Pre-Signed POST
# bindet nur den Content-Type-HEADER, nicht den Payload — ein Client kann
# also beliebige Bytes unter image/jpeg ablegen. Wir validieren die echten
# Anfangsbytes gegen die deklarierte Art, damit kein als Bild getarntes
# HTML/SVG/Script im Bucket landet.
#
# RAW-Formate (Review 2026-11): die meisten sind TIFF-basiert (CR2, NEF,
# ARW, DNG -> "II*\0" / "MM\0*"). CR3 ist ISO-BMFF mit Brand "crx ",
# RAF beginnt mit "FUJIFILMCCD-RAW". Fuer ORF ("IIRO"/"IIRS") und RW2
# ("IIU\0") gibt es (noch) keine erlaubten Content-Types.
_TIFF_MAGIC: tuple[bytes, ...] = (b"II*\x00", b"MM\x00*")
_IMAGE_MAGIC: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/tiff": _TIFF_MAGIC,
    "image/x-canon-cr2": _TIFF_MAGIC,
    "image/x-nikon-nef": _TIFF_MAGIC,
    "image/x-sony-arw": _TIFF_MAGIC,
    "image/x-adobe-dng": _TIFF_MAGIC,
    "image/x-fuji-raf": (b"FUJIFILMCCD-RAW",),
}
# Anzahl Header-Bytes fuer die Pruefung (CR3-Brand liegt bei Offset 4..12).
_MAGIC_HEADER_BYTES = 16


def magic_matches(content_type: str, header: bytes) -> bool:
    """True, wenn die Anfangsbytes zum deklarierten Content-Type passen.
    Unbekannte Typen gelten als nicht passend (fail closed)."""
    if content_type == "image/x-canon-cr3":
        return header[4:12] == b"ftypcrx "
    magics = _IMAGE_MAGIC.get(content_type)
    if magics is None:
        return False
    return any(header.startswith(sig) for sig in magics)


# Pagination GET /images: additive, Response bleibt eine Liste. Gesamtzahl
# steht in X-Total-Count — Clients mit mehr Bildern als limit muessen per
# offset nachladen.
LIST_LIMIT_DEFAULT = 200
LIST_LIMIT_MAX = 500


# Sortierungen fuer GET /images. Image.id haengt der Router immer als
# letzten Tiebreaker an (deterministische Pagination). H2b-Namen sind die
# dokumentierten; die alten Feldnamen bleiben fuer bestehende Clients.
SORT_FIELDS = {
    "created_desc": (Image.created_at.desc(),),
    "created_asc": (Image.created_at.asc(),),
    "rating_desc": (Image.rating.desc(), Image.created_at.desc()),
    "name_asc": (Image.original_filename.asc(),),
    # Legacy (vor H2b)
    "created_at": (Image.created_at.asc(),),
    "-created_at": (Image.created_at.desc(),),
    "original_filename": (Image.original_filename.asc(),),
    "-original_filename": (Image.original_filename.desc(),),
}


def _ensure_owns_key(image: Image, user: User) -> None:
    """Defense in Depth: bucket_key MUSS mit der user_id beginnen."""
    expected_prefix = f"{user.id}/"
    if not image.bucket_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="bucket_key gehoert nicht zum eingeloggten User.",
        )


# Ab so vielen Bildern signiert GET /images ausserhalb des Event-Loops.
_SIGN_OFFLOAD_THRESHOLD = 100


def image_out(image: Image, storage: StorageService) -> ImageOut:
    """ImageOut inkl. signierter Vorschau-URLs (H2a). Kein attachment:
    die Objekte sind serverseitig erzeugte JPEGs und werden per <img>
    eingebunden."""
    out = ImageOut.model_validate(image)
    if image.thumb_key:
        out.thumb_url = storage.presign_get(image.thumb_key)[0]
    if image.preview_key:
        out.preview_url = storage.presign_get(image.preview_key)[0]
    return out


async def _delete_thumb_objects(storage: StorageService, *keys: str | None) -> None:
    """Best-effort: Vorschau-Objekte loeschen (Reste verschwinden spaetestens
    mit dem Prefix-Purge aus DELETE /me)."""
    for key in keys:
        await delete_preview_object(storage, key)


async def _discard_pending(
    db: AsyncSession, storage: StorageService, image: Image
) -> None:
    """Abgelehnten Upload aufraeumen: Staging- + finales S3-Object (best-
    effort) + DB-Row weg, damit kein Zombie-Eintrag bleibt. Genutzt von den
    413/415-Pfaden in confirm_upload."""
    for key in (storage.staging_key_for(image.bucket_key), image.bucket_key):
        try:
            await run_in_threadpool(storage.delete, key)
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

    # User-Row sperren (L5): parallele init_upload-Requests desselben Users
    # wuerden sonst denselben Zaehlstand sehen und das Kontingent gemeinsam
    # ueberschreiten. Die Sperre endet mit dem Commit unten.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    # Soft-Quota gegen Zombie-Pending-Rows: ein Client koennte bis zum
    # Rate-Limit pending Uploads anlegen, die erst der Janitor (>15 min) wegraeumt.
    pending_count = (
        await db.execute(
            select(func.count())
            .select_from(Image)
            .where(Image.user_id == user.id, Image.upload_state == "pending")
        )
    ).scalar_one()
    if pending_count >= settings.max_pending_uploads_per_user:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Zu viele offene Uploads — bitte bestehende bestaetigen oder "
                "kurz warten."
            ),
        )

    # Harte Kontingente: Anzahl Bilder und belegter Speicher ueber alle
    # nicht-fehlgeschlagenen Bilder. Pending-Rows tragen die angekuendigte
    # Groesse (Obergrenze dank content-length-range der Upload-Policy).
    image_count, used_bytes = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Image.size_bytes), 0))
            .select_from(Image)
            .where(Image.user_id == user.id, Image.upload_state != "failed")
        )
    ).one()
    if image_count >= settings.max_user_images:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Maximale Anzahl Bilder ({settings.max_user_images}) erreicht — "
                "bitte lösche nicht mehr benötigte Bilder."
            ),
        )
    if int(used_bytes) + payload.size_bytes > settings.max_user_storage_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "Speicherkontingent erschöpft — bitte lösche nicht mehr "
                "benötigte Bilder."
            ),
        )

    image_id = uuid4()
    bucket_key = storage.make_key(user.id, image_id)

    image = Image(
        id=image_id,
        user_id=user.id,
        bucket_key=bucket_key,
        original_filename=payload.filename,
        content_type=payload.content_type,
        # Angekuendigte Groesse (Obergrenze) fuer die Kontingent-Summe;
        # confirm ueberschreibt sie mit der echten Objektgroesse.
        size_bytes=payload.size_bytes,
        upload_state="pending",
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)

    # Pre-Signed POST zeigt auf den STAGING-Key, nie auf den finalen Key:
    # die Policy bleibt bis zu presigned_url_expires_in gueltig, auch nach
    # confirm. Wuerde sie den finalen Key beschreiben, liesse sich nach der
    # Size-/Magic-Byte-Pruefung beliebiger Inhalt nachschieben (auch ueber
    # bestaetigte Marketplace-Vorschaubilder oder nach DELETE).
    # content-length-range = angekuendigte Groesse: S3 nimmt keinen
    # groesseren Body an (kein Bucket-Overflow ueber den Staging-Key).
    upload_url, upload_fields, expires_in = storage.presign_post(
        storage.make_staging_key(user.id, image_id),
        payload.content_type,
        max_size=payload.size_bytes,
    )
    return ImageInitOut(
        id=image.id,
        upload_url=upload_url,
        upload_fields=upload_fields,
        expires_in=expires_in,
    )


@router.post("/{image_id}/confirm", response_model=ImageOut)
@limiter.limit("30/minute")
async def confirm_upload(
    request: Request,
    image_id: UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageOut:
    # FOR UPDATE serialisiert parallele confirms desselben Bildes — sonst
    # koennte der zweite das schon weggeraeumte Staging-Objekt nicht finden.
    result = await db.execute(
        select(Image)
        .where(Image.id == image_id, Image.user_id == user.id)
        .with_for_update()
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    _ensure_owns_key(image, user)

    # Bereits bestaetigt -> idempotent zurueckgeben, ohne erneute S3-Roundtrips
    # (HEAD + Magic-Byte-Read) und ohne confirmed_at zu ueberschreiben.
    if image.upload_state == "ready":
        return image_out(image, storage)

    staging_key = storage.staging_key_for(image.bucket_key)
    not_found = HTTPException(
        status_code=409,
        detail="Object liegt nicht im Bucket — Upload wiederholen.",
    )

    def _too_large(size: int) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Objekt-Groesse {size} ueber Maximum "
                f"{settings.max_image_size_bytes} Bytes — Upload abgelehnt."
            ),
        )

    # Vorab-Size-Check am Staging-Objekt: die im init() angegebene size_bytes
    # ist Browser-behauptet, Pre-Signed-URLs haben keine Content-Length-Range-
    # Constraint. Ueberdimensionierte Objekte gar nicht erst kopieren.
    try:
        # boto3 ist blockierend -> Threadpool, sonst steht der Event-Loop.
        staged_size = await run_in_threadpool(storage.head, staging_key)
    except ObjectNotFound as exc:
        raise not_found from exc
    if staged_size > settings.max_image_size_bytes:
        await _discard_pending(db, storage, image)
        raise _too_large(staged_size)

    # Serverseitige Kopie Staging -> final. Die verbindlichen Pruefungen
    # laufen danach am FINALEN Objekt: der Client koennte das Staging-Objekt
    # zwischen Vorab-Check und Kopie noch ueberschreiben (TOCTOU); das finale
    # Objekt kann er dagegen nie beschreiben.
    try:
        await run_in_threadpool(storage.copy, staging_key, image.bucket_key)
        size = await run_in_threadpool(storage.head, image.bucket_key)
    except ObjectNotFound as exc:
        raise not_found from exc
    if size > settings.max_image_size_bytes:
        await _discard_pending(db, storage, image)
        raise _too_large(size)

    # Content-Type-Enforcement: die Upload-Policy bindet nur den Header,
    # nicht den Payload. Fuer ALLE erlaubten Typen (inkl. RAW) pruefen wir
    # die echten Magic-Bytes gegen die deklarierte Art (magic_matches).
    try:
        header = await run_in_threadpool(
            storage.head_bytes, image.bucket_key, _MAGIC_HEADER_BYTES
        )
    except ObjectNotFound as exc:
        raise not_found from exc
    if not magic_matches(image.content_type, header):
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

    # Staging-Objekt best-effort wegraeumen. Bleibt es (S3-Glitch oder
    # erneuter PUT mit der alten URL), raeumt der Janitor es nach Ablauf der
    # URL-Gueltigkeit ab (sweep_stale_staging) — gelesen wird es nie wieder.
    try:
        await run_in_threadpool(storage.delete, staging_key)
    except Exception:  # noqa: BLE001
        pass
    return image_out(image, storage)


@router.get("", response_model=list[ImageOut])
async def list_images(
    response: Response,
    state: str = Query(default="ready", pattern="^(ready|pending|all)$"),
    sort: str = Query(default="created_desc"),
    limit: int = Query(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    # H2b-Filter (camelCase wie das restliche Wireformat).
    min_rating: int | None = Query(default=None, ge=0, le=5, alias="minRating"),
    color_label: list[ColorLabel] | None = Query(default=None, alias="colorLabel"),
    flag: ImageFlag | None = Query(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> list[ImageOut]:
    if sort not in SORT_FIELDS:
        raise HTTPException(
            status_code=422,
            detail=f"sort muss einer von {list(SORT_FIELDS)} sein.",
        )
    cond = [Image.user_id == user.id]
    if state != "all":
        cond.append(Image.upload_state == state)
    if min_rating:
        cond.append(Image.rating >= min_rating)
    if color_label:
        cond.append(Image.color_label.in_(set(color_label)))
    if flag is not None:
        cond.append(Image.flag == flag)
    total = (
        await db.execute(select(func.count()).select_from(Image).where(*cond))
    ).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    # Image.id als Tiebreaker: stabile Reihenfolge ueber Seiten hinweg.
    stmt = (
        select(Image)
        .where(*cond)
        .order_by(*SORT_FIELDS[sort], Image.id)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    images = result.scalars().all()
    # Bis zu 2 x 500 Signaturen pro Seite: presign_get ist reine lokale
    # HMAC-Rechnung (app/s3_presign.py, ~15 us pro URL). Grosse Seiten
    # (Signieren + Pydantic, einige ms) laufen im Threadpool, damit der
    # Event-Loop frei bleibt; die ORM-Objekte sind fertig geladen (kein
    # Lazy-Load im Thread).
    if len(images) >= _SIGN_OFFLOAD_THRESHOLD:
        return await run_in_threadpool(lambda: [image_out(i, storage) for i in images])
    return [image_out(i, storage) for i in images]


@router.patch("", response_model=list[ImageOut])
@limiter.limit("30/minute")
async def patch_images(
    request: Request,
    payload: ImageMetaBatchPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> list[ImageOut]:
    """H2b: Bewertung/Label/Markierung fuer eine Mehrfachauswahl setzen.

    Alles oder nichts: ist auch nur eine ID fremd oder unbekannt, gibt es
    404 ohne Teil-Update (keine Auskunft, welche). Antwort in der
    Reihenfolge der angefragten IDs."""
    rows = (
        await db.execute(
            select(Image)
            .where(Image.id.in_(payload.ids), Image.user_id == user.id)
            .with_for_update()
        )
    ).scalars().all()
    if len(rows) != len(payload.ids):
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    changes = payload.changes()
    for image in rows:
        _ensure_owns_key(image, user)
        for name, value in changes.items():
            setattr(image, name, value)
    await db.commit()
    by_id = {image.id: image for image in rows}
    return [image_out(by_id[i], storage) for i in payload.ids]


@router.patch("/{image_id}", response_model=ImageOut)
@limiter.limit("120/minute")
async def patch_image(
    request: Request,
    image_id: UUID,
    payload: ImageMetaPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageOut:
    """H2b: Bewertung/Label/Markierung eines Bildes setzen. Nur explizit
    gesendete Felder aendern sich; `colorLabel: null` loescht das Label.
    120/min wie der Autosave — schnelles Durchklicken beim Sichten."""
    image = await _load_owned_image(db, user, image_id)
    for name, value in payload.changes().items():
        setattr(image, name, value)
    await db.commit()
    return image_out(image, storage)


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

    url, expires_in = storage.presign_get(image.bucket_key, attachment=True)
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
    # Atomarer Upsert: zwei parallele Autosaves (zwei Tabs/Geraete) liefen
    # beim frueheren SELECT-then-INSERT beide in den INSERT -> PK-Konflikt 500.
    await db.execute(
        pg_insert(ImageEdit)
        .values(image_id=image_id, state=state)
        .on_conflict_do_update(
            index_elements=[ImageEdit.image_id],
            set_={"state": state, "updated_at": func.now()},
        )
    )
    await db.commit()


_JPEG_MAGIC = b"\xff\xd8\xff"


@router.put("/{image_id}/thumbnail", response_model=ImageOut)
@limiter.limit("30/minute")
async def put_image_thumbnail(
    request: Request,
    image_id: UUID,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> ImageOut:
    """H2a: Vorschaubild aus dem Browser (mit Bearbeitung) entgegennehmen.

    Bewusste Ausnahme vom Grundsatz "Pixel nicht durch FastAPI": klein
    (max. THUMB_UPLOAD_MAX_BYTES) und der Server muss ohnehin neu kodieren —
    Pillow dekodiert unter denselben Grenzen wie die Marketplace-Vorschau
    (Pixel-Limit, geteilter Build-Semaphore) und schreibt zwei metadatenfreie
    JPEGs (400/1600 px) unter neuen, versionierten Keys. Der vorherige Satz
    wird erst nach dem Commit geloescht."""
    image = await _load_owned_image(db, user, image_id)
    if image.upload_state != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bild ist noch nicht bestätigt.",
        )

    data = await file.read(THUMB_UPLOAD_MAX_BYTES + 1)
    if len(data) > THUMB_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Vorschaubild zu groß (max. 1 MB).",
        )
    if not data.startswith(_JPEG_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Vorschaubild muss ein JPEG sein.",
        )

    try:
        small, large = await run_in_threadpool(build_thumbnails, data)
    except PreviewError as exc:
        logger.info("Vorschaubild fuer Bild %s abgelehnt: %s", image_id, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vorschaubild konnte nicht gelesen werden.",
        ) from exc
    except PreviewBusy as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BUSY_PREVIEW_DETAIL
        ) from exc
    del data

    thumb_key, preview_key = storage.make_thumb_keys(user.id, image.id)

    def _put_both() -> None:
        storage.put_bytes(thumb_key, small, "image/jpeg")
        storage.put_bytes(preview_key, large, "image/jpeg")

    try:
        await run_in_threadpool(_put_both)
    except Exception as exc:
        await _delete_thumb_objects(storage, thumb_key, preview_key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Speicher-Backend nicht erreichbar — bitte erneut versuchen.",
        ) from exc

    # Row erst jetzt sperren (Rendern/Upload liefen ohne Sperre): parallele
    # Uploads desselben Bildes sehen so jeweils den zuletzt committeten Satz
    # als "alt" und loeschen ihn — kein verwaister Satz.
    locked = (
        await db.execute(
            select(Image)
            .where(Image.id == image_id, Image.user_id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if locked is None:
        # Bild zwischenzeitlich geloescht.
        await _delete_thumb_objects(storage, thumb_key, preview_key)
        raise HTTPException(status_code=404, detail="Image nicht gefunden.")
    old_keys = (locked.thumb_key, locked.preview_key)
    locked.thumb_key = thumb_key
    locked.preview_key = preview_key
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await _delete_thumb_objects(storage, thumb_key, preview_key)
        raise
    await _delete_thumb_objects(storage, *old_keys)
    return image_out(locked, storage)


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

    # Vom Bild abgeleitete Marketplace-Vorschauen VOR dem S3-Delete des
    # Originals entkoppeln — der User erwartet, dass das Motiv nach dem
    # Loeschen nirgends mehr auftaucht, auch wenn das Original-Delete
    # scheitert (Row bleibt dann als 'failed' stehen, die Vorschau nicht).
    # (presets.preview_image_id wird per FK ON DELETE SET NULL geleert.)
    derived = (
        await db.execute(
            select(Preset).where(
                Preset.preview_image_id == image.id, Preset.user_id == user.id
            )
        )
    ).scalars().all()
    stale_preview_keys = [p.preview_key for p in derived if p.preview_key]
    for p in derived:
        p.preview_key = None
    # H2a: Vorschaubilder des Bildes verschwinden in beiden Pfaden (Erfolg
    # und 'failed') — nach dem Commit, best effort.
    thumb_keys = (image.thumb_key, image.preview_key)
    image.thumb_key = None
    image.preview_key = None

    try:
        await run_in_threadpool(storage.delete, image.bucket_key)
        # Staging-Rest (z.B. erneuter PUT mit der alten Upload-URL) mit weg.
        await run_in_threadpool(
            storage.delete, storage.staging_key_for(image.bucket_key)
        )
    except Exception as exc:
        # S3-Fehler: DB-Row als 'failed' markieren statt sie zu loeschen —
        # sonst entstuende ein verwaistes S3-Object ohne DB-Referenz, das nie
        # wieder aufgeraeumt wird. Der Janitor sammelt 'failed'-Rows aelter als
        # TTL nachtraeglich ein. Kontrolliertes 502 (statt nacktem 500), damit
        # der Client einen Retry-Hinweis bekommt; erneute DELETE-Calls
        # funktionieren idempotent.
        image.upload_state = "failed"
        await db.commit()
        for key in stale_preview_keys:
            await delete_preview_object(storage, key)
        await _delete_thumb_objects(storage, *thumb_keys)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Speicher-Backend nicht erreichbar — bitte erneut versuchen.",
        ) from exc

    await db.delete(image)
    await db.commit()
    for key in stale_preview_keys:
        await delete_preview_object(storage, key)
    await _delete_thumb_objects(storage, *thumb_keys)

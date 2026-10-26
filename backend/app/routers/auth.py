"""Auth-Router — GET /me, DELETE /me, GET /me/export (siehe ADR-010).

Login/Logout/Refresh/Register laufen ueber den externen Keycloak-Realm.
DELETE/Export sind DSGVO Art. 17 + 20.
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user, current_user_allow_disabled, hash_sub
from app.database import get_db
from app.keycloak_admin import delete_user as kc_delete_user
from app.models import (
    AccountTombstone,
    Feedback,
    Image,
    ImageEdit,
    Preset,
    PresetReport,
    StoragePurge,
    User,
)
from app.rate_limit import limiter
from app.schemas import (
    CAMEL_BASE_CONFIG,
    CAMEL_OUT_CONFIG,
    PresetOut,
    ProfileIn,
    ProfileOut,
    UserOut,
)
from app.storage import StorageService, get_storage


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/me/profile", response_model=ProfileOut)
async def get_profile(user: User = Depends(current_user)) -> ProfileOut:
    return ProfileOut.model_validate(user)


@router.patch("/me/profile", response_model=ProfileOut)
async def update_profile(
    payload: ProfileIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    # PATCH ist partiell: nur tatsaechlich gesendete Felder anfassen, sonst
    # loescht ein PATCH, der z.B. nur bio schickt, stillschweigend den handle
    # (= oeffentlicher Marketplace-Creator-Name). exclude_unset trennt
    # "nicht gesendet" sauber von "explizit auf null gesetzt".
    data = payload.model_dump(exclude_unset=True)
    if "handle" in data:
        user.handle = data["handle"]
    if "bio" in data:
        user.bio = data["bio"]
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Handle bereits vergeben.")
    await db.refresh(user)
    return ProfileOut.model_validate(user)


@router.get("/me/published-presets", response_model=list[PresetOut])
async def list_published_presets(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PresetOut]:
    rows = (
        await db.execute(
            select(Preset)
            .where(Preset.user_id == user.id, Preset.visibility == "public")
            .order_by(desc(Preset.published_at))
        )
    ).scalars().all()
    return [PresetOut.model_validate(p) for p in rows]


# ----- DSGVO Art. 17 (Loeschung) -----

@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    # Auch gesperrte Accounts duerfen ihre Daten loeschen (Art. 17).
    user: User = Depends(current_user_allow_disabled),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> None:
    """Loescht alle Daten des aktuellen Users:

    1. ALLE S3-Objekte unter dem User-Prefix <user_id>/ (list_objects_v2 +
       Batch-Delete) — nicht nur die in der DB bekannten Keys, damit auch
       Staging-Reste und verwaiste Objekte verschwinden. Schlaegt der Purge
       fehl, wird der Prefix in storage_purges vorgemerkt und der Janitor
       wiederholt ihn (retry_storage_purges), statt den Fehler zu schlucken.
    2. DB-Cascade entfernt presets+images; ein Grabstein (SHA-256(sub) +
       deleted_at) verhindert, dass ein noch gueltiger Access-Token den
       Account per JIT-Provisioning wiederbelebt.
    3. Keycloak-Account via Admin-API loeschen (Service-Account, falls
       konfiguriert). Best-effort: ein KC-Ausfall schluckt den /me-DELETE
       NICHT — App-Daten gehen trotzdem weg, KC-Account bleibt nur als
       Reststand stehen (Logger-WARNING). Wenn Service-Account nicht
       konfiguriert ist, wird der KC-Schritt uebersprungen.
    """
    prefix = f"{user.id}/"
    purge_error: str | None = None
    try:
        # boto3 ist synchron/blockierend -> Threadpool.
        await run_in_threadpool(storage.delete_prefix, prefix)
    except Exception as exc:  # noqa: BLE001 — wird unten persistiert
        purge_error = str(exc)[:500]
        logger.warning("delete_me: S3-Purge fuer %s fehlgeschlagen: %s", prefix, exc)

    keycloak_sub = user.keycloak_sub
    # Admin-Sperre ueberlebt die Loeschung (sonst Ban-Umgehung: gesperrter
    # User loescht sich und provisioniert per Re-Login frisch).
    banned = user.is_disabled
    await db.delete(user)
    # Grabstein in derselben Transaktion wie die Loeschung. merge statt add:
    # erneutes Loeschen nach Re-Provisionierung aktualisiert deleted_at.
    await db.merge(
        AccountTombstone(
            sub_hash=hash_sub(keycloak_sub),
            deleted_at=datetime.now(timezone.utc),
            banned=banned,
        )
    )
    if purge_error is not None:
        await db.merge(StoragePurge(prefix=prefix, attempts=1, last_error=purge_error))
    await db.commit()

    # Erst nach erfolgreichem App-Cleanup den KC-Account abraeumen.
    # kc_delete_user macht bis zu zwei blockierende httpx-Roundtrips (Token
    # + DELETE, zusammen bis 15 s) -> Threadpool.
    await run_in_threadpool(kc_delete_user, keycloak_sub)


# ----- DSGVO Art. 15 + 20 (Auskunft + Datenuebertragbarkeit) -----

class ImageExport(BaseModel):
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    original_filename: str
    content_type: str
    size_bytes: int | None
    upload_state: str
    created_at: datetime
    confirmed_at: datetime | None
    download_url: str
    download_url_expires_in: int
    # Persistierter Editor-Bearbeitungsstand (C1) — User-erzeugter Inhalt,
    # gehoert in einen vollstaendigen Art.-15/20-Export. None, wenn das Bild
    # nie im Editor bearbeitet/gespeichert wurde.
    edit_state: dict | None = None


class PresetExport(BaseModel):
    """Vollstaendiger Preset-Snapshot inkl. Marketplace-Metadaten —
    DSGVO Art. 20 Datenuebertragbarkeit."""
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    name: str
    adjustments: dict
    masks: list
    # Crop/Straighten/Lens-Geometrie ist User-erzeugter Inhalt (Migration
    # 009) und gehoert in den Export.
    geometry: dict | None
    visibility: str
    genre: str | None
    description: str | None
    preview_image_id: UUID | None
    published_at: datetime | None
    apply_count: int
    report_count: int
    created_at: datetime
    updated_at: datetime


class ReportExport(BaseModel):
    """Eine vom User abgegebene Marketplace-Meldung. Selbst abgegebene
    Reports sind Auskunfts-pflichtig (Art. 15) — der Reason-Text ist
    User-Inhalt."""
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    preset_id: UUID
    reason: str
    created_at: datetime


class FeedbackExport(BaseModel):
    """Vom User abgegebenes Feedback. Der Message-Text ist freier User-Inhalt
    und auskunfts-/uebertragbarkeitspflichtig (Art. 15 + 20) — und bleibt bei
    Loeschung nur anonymisiert erhalten, ist also gerade vorher exportwichtig."""
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    kind: str
    message: str
    page: str | None
    status: str
    created_at: datetime


class MeExport(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    id: UUID
    email: str  # str statt EmailStr — siehe UserOut/AdminUserOut
    handle: str | None
    bio: str | None
    created_at: datetime
    presets: list[PresetExport]
    images: list[ImageExport]
    submitted_reports: list[ReportExport]
    feedbacks: list[FeedbackExport]


@router.get("/me/export", response_model=MeExport)
@limiter.limit("10/minute")
async def export_me(
    request: Request,
    # Auch gesperrte Accounts behalten ihr Auskunftsrecht (Art. 15/20).
    user: User = Depends(current_user_allow_disabled),
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage),
) -> MeExport:
    """Komplett-Export aller User-Daten in einem JSON. Fuer jedes Bild
    wird ein frischer Pre-Signed-Download-URL beigelegt (gueltig laut
    settings.presigned_url_expires_in). Inklusive Marketplace-Metadaten
    auf Preset-Ebene und der vom User selbst abgegebenen Meldungen
    (DSGVO Art. 15 + 20)."""
    presets_result = await db.execute(
        select(Preset).where(Preset.user_id == user.id).order_by(Preset.name)
    )
    presets = [PresetExport.model_validate(p) for p in presets_result.scalars().all()]

    images_result = await db.execute(
        select(Image).where(Image.user_id == user.id).order_by(Image.created_at)
    )
    image_rows = images_result.scalars().all()

    # Edit-States der eigenen Bilder in einer Query (image_id -> state).
    edits_by_image: dict[UUID, dict] = {}
    if image_rows:
        edit_rows = await db.execute(
            select(ImageEdit).where(
                ImageEdit.image_id.in_([img.id for img in image_rows])
            )
        )
        edits_by_image = {e.image_id: e.state for e in edit_rows.scalars().all()}

    images: list[ImageExport] = []
    for img in image_rows:
        url, expires = storage.presign_get(img.bucket_key)
        images.append(ImageExport(
            id=img.id,
            original_filename=img.original_filename,
            content_type=img.content_type,
            size_bytes=img.size_bytes,
            upload_state=img.upload_state,
            created_at=img.created_at,
            confirmed_at=img.confirmed_at,
            download_url=url,
            download_url_expires_in=expires,
            edit_state=edits_by_image.get(img.id),
        ))

    reports_result = await db.execute(
        select(PresetReport)
        .where(PresetReport.reporter_user_id == user.id)
        .order_by(PresetReport.created_at)
    )
    reports = [ReportExport.model_validate(r) for r in reports_result.scalars().all()]

    feedback_result = await db.execute(
        select(Feedback)
        .where(Feedback.user_id == user.id)
        .order_by(Feedback.created_at)
    )
    feedbacks = [
        FeedbackExport.model_validate(f) for f in feedback_result.scalars().all()
    ]

    return MeExport(
        id=user.id,
        email=user.email,
        handle=user.handle,
        bio=user.bio,
        created_at=user.created_at,
        presets=presets,
        images=images,
        submitted_reports=reports,
        feedbacks=feedbacks,
    )

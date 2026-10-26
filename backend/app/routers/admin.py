"""Admin-Router (kleiner MVP).

Endpunkte:
- GET    /admin/users              — Liste mit Aggregaten
- PATCH  /admin/users/{id}         — is_disabled toggle
- GET    /admin/stats              — globale Counts
- GET    /admin/feedback           — Feedback-Inbox
- PATCH  /admin/feedback/{id}      — Status / Notiz aendern
- GET    /admin/presets/reported   — gemeldete/auto-versteckte Presets
- POST   /admin/presets/{id}/clear-reports — Meldungen verwerfen (Restore)

Auth: alle Endpoints brauchen die `admin`-Realm-Rolle (siehe
`app.auth.current_admin`). Self-Disable ist erlaubt, aber nicht
sinnvoll — wir blocken's nicht extra, der Admin merkt das beim
naechsten /me sofort.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_admin
from app.database import get_db
from app.models import Feedback, Image, Preset, PresetReport, User
from app.schemas import (
    AdminReportedPresetOut,
    AdminReportOut,
    AdminStatsOut,
    AdminUserOut,
    AdminUserPatchIn,
    FeedbackOut,
    FeedbackPatchIn,
    PresetOut,
)


router = APIRouter()


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserOut]:
    # Subqueries fuer User-Aggregate. Korrelierte SELECTs sind hier
    # einfacher zu lesen als ein big GROUP BY und bei <1000 Usern auch
    # performant genug.
    preset_count = (
        select(func.count(Preset.id))
        .where(Preset.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    published_count = (
        select(func.count(Preset.id))
        .where(
            Preset.user_id == User.id,
            Preset.visibility == "public",
        )
        .correlate(User)
        .scalar_subquery()
    )
    image_count = (
        select(func.count(Image.id))
        .where(Image.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    feedback_count = (
        select(func.count(Feedback.id))
        .where(Feedback.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )

    rows = (
        await db.execute(
            select(
                User,
                preset_count.label("preset_count"),
                published_count.label("published_count"),
                image_count.label("image_count"),
                feedback_count.label("feedback_count"),
            ).order_by(desc(User.created_at))
        )
    ).all()

    return [
        AdminUserOut(
            id=u.id,
            email=u.email,
            handle=u.handle,
            is_disabled=u.is_disabled,
            preset_count=int(p),
            published_preset_count=int(pub),
            image_count=int(i),
            feedback_count=int(f),
            created_at=u.created_at,
        )
        for u, p, pub, i, f in rows
    ]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def patch_user(
    user_id: UUID,
    payload: AdminUserPatchIn,
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User nicht gefunden.")

    user.is_disabled = payload.is_disabled
    await db.commit()
    await db.refresh(user)

    # Aggregate fuer den Response erneut holen — wir wollen die UI
    # konsistent halten.
    counts = {
        "preset": int(
            (
                await db.execute(
                    select(func.count(Preset.id)).where(Preset.user_id == user.id)
                )
            ).scalar_one()
        ),
        "published": int(
            (
                await db.execute(
                    select(func.count(Preset.id)).where(
                        Preset.user_id == user.id,
                        Preset.visibility == "public",
                    )
                )
            ).scalar_one()
        ),
        "image": int(
            (
                await db.execute(
                    select(func.count(Image.id)).where(Image.user_id == user.id)
                )
            ).scalar_one()
        ),
        "feedback": int(
            (
                await db.execute(
                    select(func.count(Feedback.id)).where(Feedback.user_id == user.id)
                )
            ).scalar_one()
        ),
    }
    return AdminUserOut(
        id=user.id,
        email=user.email,
        handle=user.handle,
        is_disabled=user.is_disabled,
        preset_count=counts["preset"],
        published_preset_count=counts["published"],
        image_count=counts["image"],
        feedback_count=counts["feedback"],
        created_at=user.created_at,
    )


@router.get("/stats", response_model=AdminStatsOut)
async def get_stats(
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStatsOut:
    user_total = (
        await db.execute(select(func.count(User.id)))
    ).scalar_one()
    user_disabled = (
        await db.execute(select(func.count(User.id)).where(User.is_disabled.is_(True)))
    ).scalar_one()
    preset_total = (
        await db.execute(select(func.count(Preset.id)))
    ).scalar_one()
    preset_published = (
        await db.execute(
            select(func.count(Preset.id)).where(Preset.visibility == "public")
        )
    ).scalar_one()
    image_total = (
        await db.execute(select(func.count(Image.id)))
    ).scalar_one()
    feedback_open = (
        await db.execute(
            select(func.count(Feedback.id)).where(Feedback.status != "closed")
        )
    ).scalar_one()
    report_open = (
        await db.execute(select(func.count(PresetReport.id)))
    ).scalar_one()

    return AdminStatsOut(
        user_count=int(user_total),
        user_disabled_count=int(user_disabled),
        preset_count=int(preset_total),
        preset_published_count=int(preset_published),
        image_count=int(image_total),
        feedback_open_count=int(feedback_open),
        report_open_count=int(report_open),
    )


# ----- Feedback-Inbox -----


def _feedback_to_out(fb: Feedback, email: str | None) -> FeedbackOut:
    return FeedbackOut(
        id=fb.id,
        user_id=fb.user_id,
        user_email=email,
        kind=fb.kind,  # type: ignore[arg-type]
        message=fb.message,
        page=fb.page,
        status=fb.status,  # type: ignore[arg-type]
        admin_notes=fb.admin_notes,
        created_at=fb.created_at,
        updated_at=fb.updated_at,
    )


@router.get("/feedback", response_model=list[FeedbackOut])
async def list_feedback(
    status_filter: str | None = None,
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[FeedbackOut]:
    stmt = select(Feedback, User.email).join(
        User, Feedback.user_id == User.id, isouter=True
    )
    if status_filter:
        if status_filter not in ("new", "triaged", "closed"):
            raise HTTPException(status_code=422, detail="Unbekannter Status.")
        stmt = stmt.where(Feedback.status == status_filter)
    stmt = stmt.order_by(desc(Feedback.created_at))
    rows = (await db.execute(stmt)).all()
    return [_feedback_to_out(fb, email) for fb, email in rows]


@router.patch("/feedback/{feedback_id}", response_model=FeedbackOut)
async def patch_feedback(
    feedback_id: UUID,
    payload: FeedbackPatchIn,
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> FeedbackOut:
    fb = (
        await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    ).scalar_one_or_none()
    if fb is None:
        raise HTTPException(status_code=404, detail="Feedback nicht gefunden.")
    if payload.status is not None:
        fb.status = payload.status
    if payload.admin_notes is not None:
        fb.admin_notes = payload.admin_notes or None
    fb.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(fb)

    email = None
    if fb.user_id is not None:
        email = (
            await db.execute(select(User.email).where(User.id == fb.user_id))
        ).scalar_one_or_none()
    return _feedback_to_out(fb, email)


# ----- Moderation (gemeldete Presets) -----


@router.get("/presets/reported", response_model=list[AdminReportedPresetOut])
async def list_reported_presets(
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminReportedPresetOut]:
    """Alle Presets mit mindestens einer Meldung — inkl. der per Auto-Hide
    auf privat zurueckgesetzten. Grundlage fuer die Restore-Entscheidung.
    Meldungen ohne Reporter-Identitaet (nur Grund + Zeitpunkt)."""
    rows = (
        await db.execute(
            select(Preset, User.email, User.is_disabled)
            .join(User, User.id == Preset.user_id)
            .where(Preset.report_count > 0)
            .order_by(desc(Preset.report_count), desc(Preset.updated_at))
            .limit(200)
        )
    ).all()
    ids = [p.id for p, _, _ in rows]
    reports: dict[UUID, list[AdminReportOut]] = {i: [] for i in ids}
    if ids:
        for r in (
            await db.execute(
                select(PresetReport)
                .where(PresetReport.preset_id.in_(ids))
                .order_by(PresetReport.created_at)
            )
        ).scalars():
            reports[r.preset_id].append(
                AdminReportOut(reason=r.reason, created_at=r.created_at)
            )
    return [
        AdminReportedPresetOut(
            id=p.id,
            name=p.name,
            description=p.description,
            genre=p.genre,
            visibility=p.visibility,
            report_count=p.report_count,
            owner_id=p.user_id,
            owner_email=email,
            owner_is_disabled=disabled,
            updated_at=p.updated_at,
            reports=reports[p.id],
        )
        for p, email, disabled in rows
    ]


@router.post("/presets/{preset_id}/clear-reports", response_model=PresetOut)
async def clear_preset_reports(
    preset_id: UUID,
    _admin: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
) -> PresetOut:
    """Meldungen eines (faelschlich) gemeldeten Presets verwerfen und
    report_count auf 0 setzen. Das Preset bleibt privat; der Creator kann
    es danach selbst wieder veroeffentlichen (die Republish-Sperre in
    PUT /presets greift nur ab REPORT_AUTOHIDE_THRESHOLD Meldungen)."""
    preset = (
        await db.execute(
            select(Preset).where(Preset.id == preset_id).with_for_update()
        )
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset nicht gefunden.")
    await db.execute(delete(PresetReport).where(PresetReport.preset_id == preset.id))
    preset.report_count = 0
    await db.commit()
    await db.refresh(preset)
    return PresetOut.model_validate(preset)

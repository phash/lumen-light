"""SQLAlchemy ORM-Modelle."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    keycloak_sub: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    handle: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_disabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    presets: Mapped[list["Preset"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    images: Mapped[list["Image"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Preset(Base):
    __tablename__ = "presets"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_presets_user_name"),
        CheckConstraint(
            "visibility IN ('private','public')",
            name="ck_presets_visibility",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    adjustments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    masks: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'private'"), default="private"
    )
    genre: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_image_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("images.id", ondelete="SET NULL"),
        nullable=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    apply_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    report_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="presets")


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        CheckConstraint(
            "upload_state IN ('pending','ready','failed')",
            name="ck_images_upload_state",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    bucket_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    upload_state: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[User] = relationship(back_populates="images")


class PresetReport(Base):
    """Eine Meldung pro reporter+preset. Auto-Hide bei >=3 Meldungen
    setzt das Preset auf visibility='private' zurueck."""
    __tablename__ = "preset_reports"
    __table_args__ = (
        UniqueConstraint(
            "preset_id", "reporter_user_id", name="uq_preset_reports_user_preset",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    preset_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("presets.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Nullable + ON DELETE SET NULL: laesst Reports nach User-Loeschung
    # bestehen, aber anonymisiert (DSGVO Art. 17 + Erhalt der
    # Moderationshistorie fuer den gemeldeten Creator).
    reporter_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Feedback(Base):
    """User-Feedback (bug/idea/other). user_id ist nullable, weil bei
    User-Loeschung (DSGVO Art. 17) die Meldungen anonymisiert bleiben
    sollen — der Inhalt darf bleiben, der Personenbezug nicht."""
    __tablename__ = "feedbacks"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('bug','idea','other')",
            name="ck_feedbacks_kind",
        ),
        CheckConstraint(
            "status IN ('new','triaged','closed')",
            name="ck_feedbacks_status",
        ),
        CheckConstraint(
            "char_length(message) BETWEEN 10 AND 2000",
            name="ck_feedbacks_message_length",
        ),
        Index("ix_feedbacks_status_created", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    page: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'new'"), default="new"
    )
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

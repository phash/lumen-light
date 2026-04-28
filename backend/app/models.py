"""SQLAlchemy ORM-Modelle."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
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
    reporter_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

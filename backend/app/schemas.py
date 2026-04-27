"""Pydantic-Schemas für Request/Response-Validierung."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ----- Adjustments -----

class Adjustments(BaseModel):
    """Single Source of Truth für die Slider-Werte. Pendant zum Frontend."""

    model_config = ConfigDict(extra="forbid")

    exposure: float = Field(default=0, ge=-5, le=5)
    contrast: float = Field(default=0, ge=-1, le=1)
    highlights: float = Field(default=0, ge=-1, le=1)
    shadows: float = Field(default=0, ge=-1, le=1)
    whites: float = Field(default=0, ge=-1, le=1)
    blacks: float = Field(default=0, ge=-1, le=1)
    temperature: float = Field(default=0, ge=-1, le=1)
    tint: float = Field(default=0, ge=-1, le=1)
    vibrance: float = Field(default=0, ge=-1, le=1)
    saturation: float = Field(default=0, ge=-1, le=1)


# ----- User -----

class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ----- Preset -----

class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    adjustments: Adjustments


class PresetOut(BaseModel):
    id: UUID
    name: str
    adjustments: Adjustments
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ----- Images -----

ALLOWED_IMAGE_CONTENT_TYPES = (
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/x-canon-cr2",
    "image/x-canon-cr3",
    "image/x-nikon-nef",
    "image/x-sony-arw",
    "image/x-fuji-raf",
    "image/x-adobe-dng",
)


class ImageInitIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0)


class ImageInitOut(BaseModel):
    id: UUID
    upload_url: str
    expires_in: int


class ImageOut(BaseModel):
    id: UUID
    original_filename: str
    content_type: str
    size_bytes: int | None
    upload_state: Literal["pending", "ready", "failed"]
    created_at: datetime
    confirmed_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ImageUrlOut(BaseModel):
    url: str
    expires_in: int


# ----- Fehler -----

class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None

"""Pydantic-Schemas für Request/Response-Validierung."""
from datetime import datetime
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


# ----- Fehler -----

class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None

"""Pydantic-Schemas für Request/Response-Validierung.

Wireformat (D4): JSON-Keys sind camelCase. Pydantic-Attribute bleiben
snake_case (Python-Konvention), `alias_generator=to_camel` mappt sie
beim Serialisieren. `populate_by_name=True` erlaubt sowohl
Snake- als auch CamelCase im Eingang — Backwards-Compat fuer alte
Clients und Test-Fixtures.

Aliases werden in der Response automatisch genutzt, weil
`serialize_by_alias=True` (Pydantic >= 2.11) im ConfigDict gesetzt
ist. FastAPI's `response_model`-Pipeline ruft `model_dump()` ohne
explizites `by_alias` auf — der Default ist dank des Configs jetzt
`True`. Kein zusaetzliches Per-Route-Flag noetig.
"""
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from pydantic.alias_generators import to_camel


CAMEL_BASE_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    serialize_by_alias=True,
    extra="forbid",
)
CAMEL_OUT_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    serialize_by_alias=True,
    from_attributes=True,
)


# ----- Adjustments -----

HslChannel = Literal[
    "red", "orange", "yellow", "green", "aqua", "blue", "violet", "magenta",
]

HSL_CHANNEL_NAMES: tuple[str, ...] = (
    "red", "orange", "yellow", "green", "aqua", "blue", "violet", "magenta",
)


class HslAxis(BaseModel):
    """Pro Achse (hue/saturation/luminance) ein Wert pro Farbtonbereich."""
    model_config = CAMEL_BASE_CONFIG
    red: float = Field(default=0, ge=-1, le=1)
    orange: float = Field(default=0, ge=-1, le=1)
    yellow: float = Field(default=0, ge=-1, le=1)
    green: float = Field(default=0, ge=-1, le=1)
    aqua: float = Field(default=0, ge=-1, le=1)
    blue: float = Field(default=0, ge=-1, le=1)
    violet: float = Field(default=0, ge=-1, le=1)
    magenta: float = Field(default=0, ge=-1, le=1)


class HslAdjustments(BaseModel):
    """8 Farbtonbereiche x 3 Achsen — Lightroom-aequivalenter HSL-Mischer."""
    model_config = CAMEL_BASE_CONFIG
    hue: HslAxis = Field(default_factory=HslAxis)
    saturation: HslAxis = Field(default_factory=HslAxis)
    luminance: HslAxis = Field(default_factory=HslAxis)


class ToneCurvePoint(BaseModel):
    """Stuetzpunkt einer Tonwertkurve."""
    model_config = CAMEL_BASE_CONFIG
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class ToneCurve(BaseModel):
    """Punktbasierte Tonwertkurve, 2..8 nach x sortierte Stuetzpunkte."""
    model_config = CAMEL_BASE_CONFIG
    points: list[ToneCurvePoint] = Field(min_length=2, max_length=8)

    @model_validator(mode="after")
    def _check_sorted(self) -> Self:
        xs = [p.x for p in self.points]
        if xs != sorted(xs):
            raise ValueError("Tonkurve-Punkte muessen nach x sortiert sein")
        return self


class Adjustments(BaseModel):
    """Single Source of Truth für die Slider-Werte. Pendant zum Frontend."""

    model_config = CAMEL_BASE_CONFIG

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
    # Detail-Gruppe (E3). 0..1 statt -1..+1 — kein „weicher als
    # Original" sinnvoll im Browser-Pfad; statt dessen ggf. spaeter
    # Gauss-Blur als eigene Achse.
    sharpness: float = Field(default=0, ge=0, le=1)
    noiseReduction: float = Field(default=0, ge=0, le=1)  # noqa: N815
    # Phase G1: rettet ausgebrannte Bereiche durch Pull-Down auf den
    # Mittelwert der noch nicht clipped Channels. 0 = aus, 1 = volles
    # Recovery. Inspiriert von RawTherapee's HLRecovery_blend.
    highlightRecovery: float = Field(default=0, ge=0, le=1)  # noqa: N815
    # Phase G2: Local Contrast / Clarity. Unsharp-Mask im Y-Kanal mit
    # 5x5-Gauss-Kernel. Negative Werte = Soften. Inspiriert von
    # RawTherapee's iplocalcontrast.cc.
    localContrast: float = Field(default=0, ge=-1, le=1)  # noqa: N815
    # null = HSL inaktiv. Spart 24 Felder im JSONB fuer alte Presets.
    hsl: HslAdjustments | None = None
    # null = Tonkurve inaktiv (Identitaet). Wireformat camelCase wie
    # die Mask-Body-Felder, daher # noqa: N815.
    toneCurve: ToneCurve | None = None  # noqa: N815


# ----- User -----

class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    created_at: datetime
    model_config = CAMEL_OUT_CONFIG


# ----- Masken -----

# Limits muessen mit MAX_LINEAR_MASKS / MAX_RADIAL_MASKS in
# frontend/src/editor/mask.ts und shaders.ts uebereinstimmen.
MAX_LINEAR_MASKS = 4
MAX_RADIAL_MASKS = 4


class PointUv(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    u: float = Field(ge=0, le=1)
    v: float = Field(ge=0, le=1)


class MaskLocalAdjustments(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    exposure: float = Field(default=0, ge=-3, le=3)
    contrast: float = Field(default=0, ge=-1, le=1)
    saturation: float = Field(default=0, ge=-1, le=1)
    temperature: float = Field(default=0, ge=-1, le=1)


class LinearMaskGeometry(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    p1: PointUv
    p2: PointUv
    feather: float = Field(ge=0, le=1)


class RadialMaskGeometry(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    center: PointUv
    rx: float = Field(ge=0.02, le=1)
    ry: float = Field(ge=0.02, le=1)
    feather: float = Field(ge=0, le=1)


class LinearMaskData(BaseModel):
    # camelCase-Felder bewusst — symmetrisch zum TS-Wireformat,
    # spart die Alias-Indirektion in FastAPI-Responses.
    model_config = CAMEL_BASE_CONFIG
    type: Literal["linear"]
    mask: LinearMaskGeometry
    localAdj: MaskLocalAdjustments  # noqa: N815


class RadialMaskData(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    type: Literal["radial"]
    mask: RadialMaskGeometry
    localAdj: MaskLocalAdjustments  # noqa: N815


MaskData = Annotated[
    LinearMaskData | RadialMaskData,
    Field(discriminator="type"),
]


# ----- Preset -----

PresetVisibility = Literal["private", "public"]
PresetGenre = Literal[
    "portrait",
    "landscape",
    "city",
    "nature",
    "animals",
    "sports",
    "blackandwhite",
    "other",
]


class PresetIn(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    name: str = Field(min_length=1, max_length=80)
    adjustments: Adjustments
    masks: list[MaskData] = Field(default_factory=list)
    visibility: PresetVisibility = "private"
    genre: PresetGenre | None = None
    description: str | None = Field(default=None, max_length=500)
    preview_image_id: UUID | None = None

    @model_validator(mode="after")
    def _check_mask_caps(self) -> Self:
        n_lin = sum(1 for m in self.masks if m.type == "linear")
        n_rad = sum(1 for m in self.masks if m.type == "radial")
        if n_lin > MAX_LINEAR_MASKS:
            raise ValueError(
                f"max {MAX_LINEAR_MASKS} lineare Masken pro Preset (got {n_lin})"
            )
        if n_rad > MAX_RADIAL_MASKS:
            raise ValueError(
                f"max {MAX_RADIAL_MASKS} radiale Masken pro Preset (got {n_rad})"
            )
        return self

    @model_validator(mode="after")
    def _check_public_required_fields(self) -> Self:
        if self.visibility == "public":
            missing = []
            if self.genre is None:
                missing.append("genre")
            if self.description is None or len(self.description.strip()) < 10:
                missing.append("description (>=10 Zeichen)")
            if self.preview_image_id is None:
                missing.append("previewImageId")
            if missing:
                raise ValueError(
                    "Public Preset benoetigt: " + ", ".join(missing)
                )
        return self


class PresetOut(BaseModel):
    id: UUID
    name: str
    adjustments: Adjustments
    masks: list[MaskData] = Field(default_factory=list)
    visibility: PresetVisibility
    genre: PresetGenre | None
    description: str | None
    preview_image_id: UUID | None
    published_at: datetime | None
    apply_count: int
    report_count: int
    created_at: datetime
    updated_at: datetime
    model_config = CAMEL_OUT_CONFIG


# ----- Marketplace -----

class MarketplaceListItem(BaseModel):
    id: UUID
    name: str
    genre: PresetGenre | None
    description: str | None
    creator_handle: str | None
    apply_count: int
    published_at: datetime
    preview_url: str | None
    model_config = CAMEL_BASE_CONFIG


class MarketplaceListOut(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    items: list[MarketplaceListItem]
    next_cursor: str | None = None


class MarketplaceDetailOut(MarketplaceListItem):
    model_config = CAMEL_BASE_CONFIG
    creator_bio: str | None
    # Adjustments und Masken werden NICHT im Detail mitgeschickt — kommen
    # erst ueber den Apply-Endpoint, damit der Apply-Counter sauber
    # inkrementiert (kein „lese-mit-und-wende-an"-Skip).


class MarketplaceApplyOut(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    adjustments: Adjustments
    masks: list[MaskData] = Field(default_factory=list)


class PresetReportIn(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    reason: str = Field(min_length=1, max_length=500)


class ProfileIn(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    handle: str | None = Field(default=None, min_length=3, max_length=40, pattern=r"^[a-z0-9-]+$")
    bio: str | None = Field(default=None, max_length=280)


class ProfileOut(BaseModel):
    id: UUID
    handle: str | None
    bio: str | None
    model_config = CAMEL_OUT_CONFIG


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
    model_config = CAMEL_BASE_CONFIG
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0)


class ImageInitOut(BaseModel):
    model_config = CAMEL_BASE_CONFIG
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
    model_config = CAMEL_OUT_CONFIG


class ImageUrlOut(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    url: str
    expires_in: int


# ----- Admin -----

class AdminUserOut(BaseModel):
    """User-Listen-Eintrag fuer Admin. Enthaelt Aggregate (Counts), aber
    keine Inhalte — Email + Handle als Identifikatoren reichen fuer die
    UI-Liste. `email: str` (nicht EmailStr), weil Legacy-Test-User mit
    `.local`-TLDs sonst die Output-Validation sprengen — Identitaet liegt
    bei Keycloak, hier ist es nur ein Display-Text."""
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    email: str
    handle: str | None
    is_disabled: bool
    preset_count: int
    image_count: int
    published_preset_count: int
    feedback_count: int
    created_at: datetime


class AdminUserPatchIn(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    is_disabled: bool


class AdminStatsOut(BaseModel):
    """Globale Counts fuer das Admin-Dashboard."""
    model_config = CAMEL_BASE_CONFIG
    user_count: int
    user_disabled_count: int
    preset_count: int
    preset_published_count: int
    image_count: int
    feedback_open_count: int
    report_open_count: int


# ----- Feedback -----

FeedbackKind = Literal["bug", "idea", "other"]
FeedbackStatus = Literal["new", "triaged", "closed"]


class FeedbackIn(BaseModel):
    """User-Submit. `website` ist Honeypot — Bots fuellen es typischerweise,
    der echte UI-Code laesst es leer. Pruefung im Router (nicht im Schema),
    weil `extra='forbid'` das Feld sonst ablehnt."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="allow",  # Honeypot 'website' wird im Router rausgefiltert
    )
    kind: FeedbackKind
    message: str = Field(min_length=10, max_length=2000)
    page: str | None = Field(default=None, max_length=200)


class FeedbackOut(BaseModel):
    model_config = CAMEL_OUT_CONFIG
    id: UUID
    user_id: UUID | None
    user_email: str | None  # str statt EmailStr — siehe AdminUserOut
    kind: FeedbackKind
    message: str
    page: str | None
    status: FeedbackStatus
    admin_notes: str | None
    created_at: datetime
    updated_at: datetime


class FeedbackPatchIn(BaseModel):
    """Nur Status + Admin-Notiz darf geaendert werden — Inhalt bleibt
    immutable, damit kein Admin nachtraeglich Reports umschreibt."""
    model_config = CAMEL_BASE_CONFIG
    status: FeedbackStatus | None = None
    admin_notes: str | None = Field(default=None, max_length=2000)


# ----- Fehler -----

class ErrorResponse(BaseModel):
    model_config = CAMEL_BASE_CONFIG
    detail: str
    code: str | None = None

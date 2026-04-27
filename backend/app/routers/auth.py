"""Auth-Endpoints: Register, Login, Refresh, Logout, /me."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    current_user,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.config import settings
from app.database import get_db
from app.models import Preset, RefreshToken, User
from app.schemas import LoginRequest, RefreshRequest, TokenPair, UserCreate, UserOut


router = APIRouter()


DEFAULT_PRESETS: list[dict] = [
    {
        "name": "Neutral",
        "adjustments": {k: 0 for k in [
            "exposure", "contrast", "highlights", "shadows", "whites",
            "blacks", "temperature", "tint", "vibrance", "saturation",
        ]},
    },
    {
        "name": "Punchy",
        "adjustments": {
            "exposure": 0, "contrast": 0.30, "highlights": 0, "shadows": 0.15,
            "whites": 0, "blacks": -0.10, "temperature": 0, "tint": 0,
            "vibrance": 0.40, "saturation": 0,
        },
    },
    {
        "name": "Soft Mood",
        "adjustments": {
            "exposure": 0, "contrast": -0.15, "highlights": -0.30, "shadows": 0.20,
            "whites": -0.10, "blacks": 0.10, "temperature": 0.05, "tint": 0,
            "vibrance": -0.10, "saturation": 0,
        },
    },
    {
        "name": "Schwarzweiss-Vorbereitung",
        "adjustments": {
            "exposure": 0, "contrast": 0.20, "highlights": 0, "shadows": 0,
            "whites": 0, "blacks": 0, "temperature": 0, "tint": 0,
            "vibrance": 0, "saturation": -1.0,
        },
    },
]


async def _issue_token_pair(user: User, db: AsyncSession) -> TokenPair:
    access, expires_in = create_access_token(user.id)
    refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    ))
    await db.commit()
    return TokenPair(access_token=access, refresh_token=refresh, expires_in=expires_in)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> UserOut:
    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="E-Mail bereits registriert.")
    # Default-Presets anlegen
    for p in DEFAULT_PRESETS:
        db.add(Preset(user_id=user.id, name=p["name"], adjustments=p["adjustments"]))
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten.")
    return await _issue_token_pair(user, db)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    token_hash = hash_refresh_token(payload.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if rt is None:
        raise HTTPException(status_code=401, detail="Refresh-Token ungültig.")
    # Rotation: alten Token invalidieren
    rt.revoked = True
    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one()
    return await _issue_token_pair(user, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> None:
    token_hash = hash_refresh_token(payload.refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    rt = result.scalar_one_or_none()
    if rt:
        rt.revoked = True
        await db.commit()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)

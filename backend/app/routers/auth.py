"""Auth-Router — reduziert auf GET /me (siehe ADR-010).

Login/Logout/Refresh/Register laufen ueber den externen Keycloak-Realm,
nicht ueber Lumen-Endpoints.
"""
from fastapi import APIRouter, Depends

from app.auth import current_user
from app.models import User
from app.schemas import UserOut


router = APIRouter()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)

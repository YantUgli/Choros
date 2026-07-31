from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from app.config import get_settings
from app.schemas import LoginIn
from app.security import COOKIE_NAME, auth_disabled, issue_cookie, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def auth_status() -> dict[str, bool | str]:
    return {
        "auth_required": not auth_disabled(),
        "username": get_settings().admin_username,
    }


@router.post("/login")
async def login(payload: LoginIn, response: Response) -> dict[str, bool]:
    settings = get_settings()
    if auth_disabled():
        return {"ok": True, "auth_required": False}
    if payload.username != settings.admin_username or not verify_password(
        payload.password, settings.admin_password_hash
    ):
        raise HTTPException(status_code=401, detail="username atau password salah")
    response.set_cookie(
        COOKIE_NAME,
        issue_cookie(payload.username),
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age,
    )
    return {"ok": True, "auth_required": True}


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}

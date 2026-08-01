from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from app.config import get_settings
from app.models import User
from app.schemas import LoginIn, PasswordChangeIn
from app.security import (
    COOKIE_NAME,
    CurrentUser,
    DbSession,
    auth_disabled,
    hash_password,
    issue_cookie,
    read_cookie,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def auth_status(
    request: Request, session: DbSession
) -> dict[str, Any]:
    is_disabled = await auth_disabled(session)
    username = None
    if is_disabled:
        username = get_settings().admin_username
    else:
        token = request.cookies.get(COOKIE_NAME)
        if token:
            username = read_cookie(token)

    is_admin = False
    if username:
        row = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        is_admin = bool(row and row.is_admin)

    return {
        "auth_required": not is_disabled,
        "username": username,
        "is_admin": is_admin,
    }


@router.post("/login")
async def login(
    payload: LoginIn, response: Response, session: DbSession
) -> dict[str, Any]:
    settings = get_settings()
    if await auth_disabled(session):
        return {"ok": True, "auth_required": False}

    user = (
        await session.execute(select(User).where(User.username == payload.username))
    ).scalar_one_or_none()

    if user is not None and user.password_hash:
        ok = verify_password(payload.password, user.password_hash)
    elif payload.username == settings.admin_username and settings.admin_password_hash:
        ok = verify_password(payload.password, settings.admin_password_hash)
    else:
        ok = False

    if not ok:
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


@router.post("/password")
async def change_password(
    payload: PasswordChangeIn,
    user: CurrentUser,
    session: DbSession,
) -> dict[str, bool]:
    settings = get_settings()
    ok = False
    if user.password_hash:
        ok = verify_password(payload.old_password, user.password_hash)
    elif user.username == settings.admin_username and settings.admin_password_hash:
        ok = verify_password(payload.old_password, settings.admin_password_hash)

    if not ok:
        raise HTTPException(status_code=400, detail="password lama salah")

    user.password_hash = hash_password(payload.new_password)
    await session.commit()
    return {"ok": True}

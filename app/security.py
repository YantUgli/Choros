"""Lapisan 1 — login ke app sendiri (PRD §4).

Lapisan 2 (kredensial provider) sengaja TIDAK ada di sini: choros tidak menyimpan
atau me-replay kredensial langganan. Provider login sekali lewat CLI resminya.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from itsdangerous import BadSignature, URLSafeTimedSerializer
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User

COOKIE_NAME = "choros_session"
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain, hashed)
    except ValueError:
        return False


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="choros-session")


def issue_cookie(username: str) -> str:
    return _serializer().dumps({"u": username})


def read_cookie(token: str) -> str | None:
    settings = get_settings()
    try:
        data = _serializer().loads(token, max_age=settings.session_max_age)
    except BadSignature:
        return None
    return data.get("u") if isinstance(data, dict) else None


def auth_disabled() -> bool:
    """Tanpa password hash, app jalan mode lokal terbuka (dengan peringatan)."""
    return not get_settings().admin_password_hash


async def get_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    settings = get_settings()
    username = settings.admin_username

    if not auth_disabled():
        token = request.cookies.get(COOKIE_NAME)
        resolved = read_cookie(token) if token else None
        if not resolved:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="belum login"
            )
        username = resolved

    user = (
        await session.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="user tidak ditemukan")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_session)]

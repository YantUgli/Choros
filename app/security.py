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


async def auth_disabled(session: AsyncSession) -> bool:
    """Tanpa password hash dan tanpa user berpassword di DB, app jalan mode lokal terbuka."""
    if get_settings().admin_password_hash:
        return False
    has_password_user = (
        await session.execute(
            select(User.id).where(User.password_hash.isnot(None)).limit(1)
        )
    ).first()
    return has_password_user is None


async def get_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    settings = get_settings()
    username = settings.admin_username

    if not await auth_disabled(session):
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


async def get_current_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="butuh hak admin"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin)]
DbSession = Annotated[AsyncSession, Depends(get_session)]

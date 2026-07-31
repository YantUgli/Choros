"""Pelacakan konsumsi + cooldown 429 per (agent, model). PRD §6, §10.

Catatan jujur (PRD §10): langganan tidak mengekspos "sisa X pesan". Yang dilacak
di sini adalah konsumsi yang kita amati sendiri + status mentok yang dideteksi
dari 429. Tidak ada endpoint yang ditembak untuk menebak sisa kuota.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import QuotaWindow

WINDOW_DURATIONS: dict[str, timedelta] = {
    "rolling_5h": timedelta(hours=5),
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "hourly": timedelta(hours=1),
    "minute": timedelta(minutes=1),
}


def now() -> datetime:
    return datetime.now(UTC)


async def _current_window(
    session: AsyncSession,
    *,
    user_id: int,
    agent_id: int,
    model: str | None,
) -> QuotaWindow | None:
    stmt = (
        select(QuotaWindow)
        .where(
            QuotaWindow.user_id == user_id,
            QuotaWindow.agent_id == agent_id,
            QuotaWindow.model.is_(None) if model is None else QuotaWindow.model == model,
        )
        .order_by(QuotaWindow.window_end.desc().nullslast(), QuotaWindow.id.desc())
        .limit(1)
    )
    window = (await session.execute(stmt)).scalar_one_or_none()
    if window is None:
        return None
    if window.window_end is not None and window.window_end <= now():
        return None  # window kadaluarsa → dianggap reset
    return window


async def is_exhausted(
    session: AsyncSession, *, user_id: int, agent_id: int, model: str | None
) -> tuple[bool, datetime | None]:
    """(mentok?, kapan reset). Window yang sudah lewat otomatis dianggap pulih."""
    window = await _current_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if window is None or not window.is_exhausted:
        return False, None
    return True, window.window_end


async def mark_exhausted(
    session: AsyncSession,
    *,
    user_id: int,
    agent_id: int,
    model: str | None,
    retry_after_seconds: float | None = None,
    default_cooldown_minutes: int = 60,
) -> QuotaWindow:
    """Tandai target mentok + pasang cooldown (PRD §10)."""
    cooldown = (
        timedelta(seconds=retry_after_seconds)
        if retry_after_seconds
        else timedelta(minutes=default_cooldown_minutes)
    )
    window = await _current_window(session, user_id=user_id, agent_id=agent_id, model=model)
    reset_at = now() + cooldown
    if window is None:
        window = QuotaWindow(
            user_id=user_id,
            agent_id=agent_id,
            model=model,
            window_type="cooldown",
            window_start=now(),
            window_end=reset_at,
            tokens_used=0,
            is_exhausted=True,
        )
        session.add(window)
    else:
        window.is_exhausted = True
        # cooldown tidak boleh memperpendek window yang sudah berjalan
        if window.window_end is None or window.window_end < reset_at:
            window.window_end = reset_at
    await session.flush()
    return window


async def record_usage(
    session: AsyncSession,
    *,
    user_id: int,
    agent_id: int,
    model: str | None,
    tokens: int,
    window_type: str = "daily",
) -> QuotaWindow:
    """Akumulasi token ke window aktif; buat window baru kalau sudah lewat."""
    window = await _current_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if window is None:
        start = now()
        window = QuotaWindow(
            user_id=user_id,
            agent_id=agent_id,
            model=model,
            window_type=window_type,
            window_start=start,
            window_end=start + WINDOW_DURATIONS.get(window_type, timedelta(days=1)),
            tokens_used=0,
            is_exhausted=False,
        )
        session.add(window)
    window.tokens_used = (window.tokens_used or 0) + max(0, tokens)
    await session.flush()
    return window


async def clear_exhausted(
    session: AsyncSession, *, user_id: int, agent_id: int, model: str | None
) -> None:
    """Reset manual dari dashboard ('saya yakin kuotanya sudah pulih')."""
    window = await _current_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if window is not None:
        window.is_exhausted = False
        window.window_end = now()
        await session.flush()


async def list_windows(session: AsyncSession, *, user_id: int) -> list[QuotaWindow]:
    stmt = (
        select(QuotaWindow)
        .where(QuotaWindow.user_id == user_id)
        .order_by(QuotaWindow.agent_id, QuotaWindow.model)
    )
    return list((await session.execute(stmt)).scalars())

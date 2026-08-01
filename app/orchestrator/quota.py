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


async def _get_cooldown_window(
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
            QuotaWindow.window_type == "cooldown",
        )
        .order_by(QuotaWindow.window_end.desc().nullslast(), QuotaWindow.id.desc())
        .limit(1)
    )
    window = (await session.execute(stmt)).scalar_one_or_none()
    if window is None or (window.window_end is not None and window.window_end <= now()):
        return None
    return window


async def _get_token_window(
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
            QuotaWindow.window_type != "cooldown",
        )
        .order_by(QuotaWindow.window_end.desc().nullslast(), QuotaWindow.id.desc())
        .limit(1)
    )
    window = (await session.execute(stmt)).scalar_one_or_none()
    if window is None or (window.window_end is not None and window.window_end <= now()):
        return None
    return window


async def is_exhausted(
    session: AsyncSession, *, user_id: int, agent_id: int, model: str | None
) -> tuple[bool, datetime | None]:
    """(mentok?, kapan reset). Cooldown 429 atau token limit yang aktif."""
    cooldown = await _get_cooldown_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if cooldown is not None:
        return True, cooldown.window_end

    token_win = await _get_token_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if token_win is not None and token_win.is_exhausted:
        return True, token_win.window_end

    return False, None


async def mark_exhausted(
    session: AsyncSession,
    *,
    user_id: int,
    agent_id: int,
    model: str | None,
    retry_after_seconds: float | None = None,
    default_cooldown_minutes: int = 60,
) -> QuotaWindow:
    """Tandai target mentok dengan membuat/memperbarui window 'cooldown' terpisah."""
    cooldown_sec = (
        timedelta(seconds=retry_after_seconds)
        if retry_after_seconds
        else timedelta(minutes=default_cooldown_minutes)
    )
    reset_at = now() + cooldown_sec

    cooldown = await _get_cooldown_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if cooldown is None:
        cooldown = QuotaWindow(
            user_id=user_id,
            agent_id=agent_id,
            model=model,
            window_type="cooldown",
            window_start=now(),
            window_end=reset_at,
            tokens_used=0,
            is_exhausted=True,
        )
        session.add(cooldown)
    else:
        cooldown.window_end = reset_at
        cooldown.is_exhausted = True

    await session.flush()
    return cooldown


async def record_usage(
    session: AsyncSession,
    *,
    user_id: int,
    agent_id: int,
    model: str | None,
    tokens: int,
    window_type: str = "daily",
) -> QuotaWindow:
    """Akumulasi token ke window konsumsi aktif (bukan cooldown); buat window baru jika lewat."""
    window = await _get_token_window(session, user_id=user_id, agent_id=agent_id, model=model)
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
    cooldown = await _get_cooldown_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if cooldown is not None:
        cooldown.is_exhausted = False
        cooldown.window_end = now()

    token_win = await _get_token_window(session, user_id=user_id, agent_id=agent_id, model=model)
    if token_win is not None:
        token_win.is_exhausted = False
    await session.flush()


async def list_windows(session: AsyncSession, *, user_id: int) -> list[QuotaWindow]:
    stmt = (
        select(QuotaWindow)
        .where(QuotaWindow.user_id == user_id)
        .order_by(QuotaWindow.agent_id, QuotaWindow.model)
    )
    return list((await session.execute(stmt)).scalars())

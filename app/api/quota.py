from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import Integer, case, cast, func, select

from app.models import Agent, QuotaWindow, TaskLog
from app.orchestrator import quota as quota_service
from app.orchestrator.quota import now
from app.schemas import QuotaOut, QuotaResetIn
from app.security import CurrentUser, DbSession

router = APIRouter(prefix="/api/quota", tags=["quota"])


@router.get("", response_model=list[QuotaOut])
async def list_quota(user: CurrentUser, session: DbSession) -> list[QuotaWindow]:
    return await quota_service.list_windows(session, user_id=user.id)


@router.post("/reset")
async def reset_quota(payload: QuotaResetIn, user: CurrentUser, session: DbSession) -> dict[str, bool]:
    """Reset manual — dipakai kalau kamu tahu kuotanya sudah pulih lebih cepat."""
    await quota_service.clear_exhausted(
        session, user_id=user.id, agent_id=payload.agent_id, model=payload.model
    )
    await session.commit()
    return {"ok": True}


@router.get("/summary")
async def usage_summary(user: CurrentUser, session: DbSession, days: int = 7) -> list[dict]:
    """Konsumsi per (agent, model) beberapa hari terakhir — bukan sisa kuota.

    PRD §10: langganan tidak mengekspos "sisa X pesan"; yang bisa dilaporkan jujur
    adalah apa yang sudah terpakai lewat choros + status mentok dari 429.
    """
    since = now() - timedelta(days=days)
    stmt = (
        select(
            TaskLog.agent_id,
            Agent.name,
            TaskLog.model,
            func.count(TaskLog.id).label("runs"),
            func.sum(
                func.coalesce(cast(TaskLog.usage["total_tokens"].astext, Integer), 0)
            ).label("tokens"),
            func.sum(case((TaskLog.status == "rate_limited", 1), else_=0)).label("rate_limited"),
        )
        .join(Agent, Agent.id == TaskLog.agent_id)
        .where(TaskLog.user_id == user.id, TaskLog.created_at >= since)
        .group_by(TaskLog.agent_id, Agent.name, TaskLog.model)
        .order_by(func.count(TaskLog.id).desc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "agent_id": row.agent_id,
            "agent": row.name,
            "model": row.model,
            "runs": row.runs,
            "tokens": int(row.tokens or 0),
            "rate_limited": int(row.rate_limited or 0),
        }
        for row in rows
    ]

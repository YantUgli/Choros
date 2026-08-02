"""Routing kategori → target berurut priority (PRD §5).

v1: klasifikasi manual (dropdown) + keyword. Pengurutan target sepenuhnya manual
lewat `routing_rules.priority` — choros tidak menebak-nebak urutan sendiri.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, RoutingRule, WorkflowStep

CATEGORIES = [
    "coding_complex",
    "data_analysis",
    "draft_bulk",
    "private",
    "text_planning",
]

CATEGORY_LABELS = {
    "coding_complex": "Coding kompleks / refactor",
    "data_analysis": "Analisis data / CSV / Excel",
    "draft_bulk": "Draft / bulk / ringan",
    "private": "Privat / sensitif",
    "text_planning": "Teks / planning",
}

_KEYWORDS: list[tuple[str, re.Pattern[str]]] = [
    ("data_analysis", re.compile(r"\b(csv|excel|xlsx|dataframe|pandas|analis\w*|dataset|grafik|chart)\b", re.IGNORECASE)),
    ("private", re.compile(r"\b(rahasia|sensitif|privat|confidential|jangan (di)?kirim|offline|lokal saja)\b", re.IGNORECASE)),
    ("coding_complex", re.compile(r"\b(refactor|arsitektur|migrasi|debug|bug|implementasi|refaktor|optimasi|test)\b", re.IGNORECASE)),
    ("draft_bulk", re.compile(r"\b(draft|ringkas|rename|boilerplate|generate banyak|bulk|terjemah\w*)\b", re.IGNORECASE)),
]


def classify(prompt: str, explicit: str | None = None) -> str:
    """v1: kategori eksplisit dari dropdown menang; keyword hanya cadangan."""
    if explicit and explicit in CATEGORIES:
        return explicit
    for category, pattern in _KEYWORDS:
        if pattern.search(prompt):
            return category
    return "coding_complex"


@dataclass(slots=True)
class Target:
    agent: Agent
    model: str | None
    priority: int

    @property
    def label(self) -> str:
        model = self.model or self.agent.default_model
        return f"{self.agent.name}/{model}" if model else self.agent.name


async def resolve_targets(
    session: AsyncSession, category: str, *, user_id: int
) -> list[Target]:
    """Daftar target berurut priority untuk sebuah kategori, milik satu user.

    `user_id` sengaja keyword-only tanpa default: pemanggil yang lupa harus gagal
    keras, bukan diam-diam merutekan tugas ke agent milik user lain (= pooling,
    non-tujuan eksplisit PRD §1). Kepemilikan disaring lewat `Agent.user_id` —
    `routing_rules` tidak punya kolom pemilik sendiri, dan memang tidak perlu.
    """
    stmt = (
        select(RoutingRule, Agent)
        .join(Agent, Agent.id == RoutingRule.agent_id)
        .where(
            RoutingRule.category == category,
            Agent.is_active.is_(True),
            Agent.user_id == user_id,
        )
        .order_by(RoutingRule.priority, RoutingRule.id)
    )
    rows = (await session.execute(stmt)).all()
    return [
        Target(agent=agent, model=rule.model or agent.default_model, priority=rule.priority)
        for rule, agent in rows
    ]


async def resolve_step_targets(
    session: AsyncSession, step: WorkflowStep, fallback_category: str, *, user_id: int
) -> list[Target]:
    """Resolve targets JSONB step; kalau kosong, jatuh ke routing rule kategori step."""
    step_targets = step.targets or []
    if not step_targets:
        category = step.category or fallback_category
        return await resolve_targets(session, category, user_id=user_id)

    # Urutan di JSONB adalah urutan cascade — priority diambil dari indeks
    result: list[Target] = []
    for idx, entry in enumerate(step_targets):
        agent_id = entry.get("agent_id")
        if agent_id is None:
            continue
        agent = await session.get(Agent, agent_id)
        # Kepemilikan divalidasi saat tulis (workflows.py:_validate_step_agent_ids),
        # tapi ditegakkan lagi di sini: JSONB bisa berubah lewat jalur lain.
        if agent is None or not agent.is_active or agent.user_id != user_id:
            continue
        model = entry.get("model") or agent.default_model
        result.append(Target(agent=agent, model=model, priority=idx))
    return result

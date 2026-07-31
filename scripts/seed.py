"""Seed agent + routing rules sesuai strategi default PRD §5.

    python -m scripts.seed

Idempoten: agent/rule yang sudah ada tidak diduplikasi.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, apply_migrations, engine
from app.models import Agent, RoutingRule, User

AGENTS = [
    {
        "name": "claude",
        "adapter_type": "claude_code",
        "default_model": "sonnet",
        "config": {"partial_messages": True, "window_type": "rolling_5h"},
    },
    {
        "name": "antigravity",
        "adapter_type": "antigravity",
        "default_model": None,
        "config": {"window_type": "daily"},
    },
    {
        "name": "opencode-groq",
        "adapter_type": "opencode",
        "default_model": "groq/llama-3.3-70b-versatile",
        "config": {"env_keys": ["GROQ_API_KEY"], "window_type": "daily"},
    },
    {
        "name": "opencode-ollama",
        "adapter_type": "opencode",
        "default_model": "ollama/llama3",
        "config": {"window_type": "daily"},
    },
    {
        "name": "groq-raw",
        "adapter_type": "openai_compatible",
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
        "config": {"api_key_env": "GROQ_API_KEY", "window_type": "daily"},
    },
]

# (kategori, nama agent, model override, priority) — PRD §5 tabel strategi default
ROUTES = [
    ("coding_complex", "claude", None, 10),
    ("coding_complex", "antigravity", None, 20),
    ("coding_complex", "opencode-groq", "groq/llama-3.3-70b-versatile", 30),
    ("coding_complex", "opencode-ollama", None, 60),
    ("data_analysis", "antigravity", None, 10),
    ("data_analysis", "claude", None, 20),
    ("draft_bulk", "opencode-groq", "groq/llama-3.3-70b-versatile", 10),
    ("draft_bulk", "opencode-groq", "groq/llama-3.1-8b-instant", 20),
    ("draft_bulk", "opencode-ollama", None, 30),
    ("private", "opencode-ollama", None, 10),
    ("text_planning", "groq-raw", None, 10),
    ("text_planning", "claude", None, 20),
]


async def main() -> None:
    settings = get_settings()
    await apply_migrations()

    async with SessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.username == settings.admin_username))
        ).scalar_one_or_none()
        if user is None:
            user = User(username=settings.admin_username)
            session.add(user)
            await session.flush()

        by_name: dict[str, Agent] = {}
        for spec in AGENTS:
            existing = (
                await session.execute(
                    select(Agent).where(Agent.user_id == user.id, Agent.name == spec["name"])
                )
            ).scalar_one_or_none()
            if existing is None:
                existing = Agent(user_id=user.id, **spec)
                session.add(existing)
                await session.flush()
                print(f"+ agent {spec['name']}")
            by_name[spec["name"]] = existing

        for category, agent_name, model, priority in ROUTES:
            agent = by_name[agent_name]
            existing = (
                await session.execute(
                    select(RoutingRule).where(
                        RoutingRule.category == category,
                        RoutingRule.agent_id == agent.id,
                        RoutingRule.model.is_(None) if model is None else RoutingRule.model == model,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    RoutingRule(
                        category=category, agent_id=agent.id, model=model, priority=priority
                    )
                )
                print(f"+ route {category} → {agent_name}/{model or 'default'} @{priority}")

        await session.commit()

    await engine.dispose()
    print("\nseed selesai.")


if __name__ == "__main__":
    asyncio.run(main())

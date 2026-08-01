"""Seed agent + routing rules sesuai strategi default PRD §5.

    python -m scripts.seed

Idempoten: agent/rule yang sudah ada tidak diduplikasi.
"""

from __future__ import annotations

import argparse
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
        # Gateway model opencode sendiri. Tier gratisnya luas (lihat ZEN_FREE di
        # bawah) dan kreditnya terpisah dari Groq/Ollama, jadi ini rung cascade
        # tambahan yang nyata — bukan sekadar duplikat opencode-groq.
        # Auth: `opencode auth login` → OpenCode Zen. OPENCODE_API_KEY hanya
        # diteruskan kalau memang ada di environment.
        "name": "opencode-zen",
        "adapter_type": "opencode",
        "default_model": "opencode/grok-code",
        "config": {"env_keys": ["OPENCODE_API_KEY"], "window_type": "daily"},
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
#
# Rung `opencode-zen` disisipkan di sela priority yang sudah ada, bukan menggeser
# yang lama: seed ini idempoten dan hanya menyisipkan rule yang belum ada — ia
# TIDAK memperbarui priority rule lama, jadi mengubah angka lama tak berefek pada
# database yang sudah ter-seed.
#
# `private` sengaja tetap ollama-saja: tier gratis Zen menyatakan datanya boleh
# dipakai untuk melatih model, jadi tidak boleh jadi tujuan tugas sensitif.
ROUTES = [
    ("coding_complex", "claude", None, 10),
    ("coding_complex", "antigravity", None, 20),
    ("coding_complex", "opencode-zen", "opencode/glm-5-free", 22),
    ("coding_complex", "opencode-zen", "opencode/minimax-m3-free", 24),
    ("coding_complex", "opencode-zen", "opencode/kimi-k2.5-free", 26),
    ("coding_complex", "opencode-zen", "opencode/grok-code", 28),
    ("coding_complex", "opencode-groq", "groq/llama-3.3-70b-versatile", 30),
    ("coding_complex", "opencode-ollama", None, 60),
    ("data_analysis", "antigravity", None, 10),
    ("data_analysis", "claude", None, 20),
    ("data_analysis", "opencode-zen", "opencode/qwen3.6-plus-free", 30),
    ("data_analysis", "opencode-zen", "opencode/glm-5-free", 40),
    ("draft_bulk", "opencode-groq", "groq/llama-3.3-70b-versatile", 10),
    ("draft_bulk", "opencode-zen", "opencode/ling-3.0-flash-free", 12),
    ("draft_bulk", "opencode-zen", "opencode/mimo-v2-flash-free", 14),
    ("draft_bulk", "opencode-zen", "opencode/big-pickle", 16),
    ("draft_bulk", "opencode-groq", "groq/llama-3.1-8b-instant", 20),
    ("draft_bulk", "opencode-ollama", None, 30),
    ("private", "opencode-ollama", None, 10),
    ("text_planning", "groq-raw", None, 10),
    # konteks 1M — muat repo besar untuk fase planning
    ("text_planning", "opencode-zen", "opencode/nemotron-3-ultra-free", 15),
    ("text_planning", "claude", None, 20),
    ("text_planning", "opencode-zen", "opencode/mimo-v2-pro-free", 25),
]


async def main(reconcile: bool = False) -> None:
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
            elif reconcile:
                existing.default_model = spec.get("default_model")
                existing.config = spec.get("config", {})
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
            elif reconcile and existing.priority != priority:
                existing.priority = priority
                print(f"~ route {category} → {agent_name}/{model or 'default'} @{priority} (reconciled)")

        await session.commit()

    await engine.dispose()
    print("\nseed selesai.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed agent dan routing rules")
    parser.add_argument(
        "--reconcile",
        action="store_true",
        help="Perbarui priority rule & config agent lama jika ada perubahan",
    )
    args = parser.parse_args()
    asyncio.run(main(reconcile=args.reconcile))

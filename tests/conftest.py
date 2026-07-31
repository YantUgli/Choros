from __future__ import annotations

import os

# Harus diset SEBELUM app.config / app.db diimpor: engine dibuat saat import.
os.environ.setdefault(
    "CHOROS_DATABASE_URL", "postgresql+asyncpg://choros:choros@localhost:5432/choros_test"
)
os.environ.setdefault("CHOROS_SECRET_KEY", "test-secret")
os.environ.setdefault("CHOROS_ADMIN_USERNAME", "tester")

import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import InterfaceError, OperationalError  # noqa: E402

from app.db import SessionLocal, apply_migrations, engine  # noqa: E402
from app.models import Agent, RoutingRule, User  # noqa: E402

TABLES = [
    "task_events",
    "task_logs",
    "quota_windows",
    "tasks",
    "routing_rules",
    "workflow_steps",
    "workflows",
    "agents",
    "users",
]


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
async def clean_db():
    # Engine dibuat saat import, sedangkan tiap test punya event loop sendiri.
    # Tanpa dispose, koneksi pool tertinggal di loop lama → "attached to a
    # different loop". Skip hanya untuk DB yang benar-benar tak terjangkau;
    # error lain harus gagal terang-terangan, bukan tersamar jadi skip.
    await engine.dispose()
    try:
        await apply_migrations()
    except (OperationalError, InterfaceError, OSError) as exc:  # pragma: no cover
        pytest.skip(f"database test tidak tersedia: {exc}")
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    yield
    await engine.dispose()


@pytest.fixture
async def user():
    async with SessionLocal() as session:
        row = User(username="tester")
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


@pytest.fixture
async def make_agent(user):
    async def _make(name: str, adapter_type: str = "claude_code", model: str | None = "sonnet", **config):
        async with SessionLocal() as session:
            agent = Agent(
                user_id=user.id,
                name=name,
                adapter_type=adapter_type,
                default_model=model,
                config=config,
                is_active=True,
            )
            session.add(agent)
            await session.commit()
            await session.refresh(agent)
            return agent

    return _make


@pytest.fixture
async def make_route():
    async def _make(category: str, agent, model: str | None = None, priority: int = 100):
        async with SessionLocal() as session:
            rule = RoutingRule(
                category=category, agent_id=agent.id, model=model or agent.default_model, priority=priority
            )
            session.add(rule)
            await session.commit()
            await session.refresh(rule)
            return rule

    return _make

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.api import ROUTERS
from app.config import get_settings
from app.db import SessionLocal, apply_migrations, engine
from app.models import User
from app.orchestrator.isolation import gc_old_worktrees
from app.orchestrator.runner import runner
from app.orchestrator.workflow import recover_interrupted_runs
from app.security import auth_disabled

log = logging.getLogger("choros")
STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await apply_migrations()

    recovered_count = await runner.recover_interrupted_tasks()
    if recovered_count > 0:
        log.info("%d tugas hanging ditandai 'interrupted'", recovered_count)

    recovered_runs = await recover_interrupted_runs()
    if recovered_runs > 0:
        log.info("%d workflow run mandek dipulihkan", recovered_runs)

    cleaned_worktrees = await gc_old_worktrees()
    if cleaned_worktrees:
        log.info("%d worktree lama dibersihkan oleh GC", len(cleaned_worktrees))

    async with SessionLocal() as session:
        admin_user = (
            await session.execute(select(User).where(User.username == settings.admin_username))
        ).scalar_one_or_none()
        if admin_user is None:
            admin_user = User(username=settings.admin_username, is_admin=True)
            session.add(admin_user)
            await session.commit()
            log.info("user '%s' dibuat", settings.admin_username)

        # Promosikan admin_username jika belum ada admin sama sekali
        has_admin = (
            await session.execute(select(User.id).where(User.is_admin.is_(True)).limit(1))
        ).first()
        if has_admin is None and admin_user:
            admin_user.is_admin = True
            await session.commit()
            log.info("user '%s' dipromosikan jadi admin", settings.admin_username)

        if await auth_disabled(session):
            log.warning(
                "CHOROS_ADMIN_PASSWORD_HASH kosong → dashboard berjalan tanpa login. "
                "Aman hanya kalau bind ke 127.0.0.1. Set hash lewat: "
                "python -m scripts.hash_password 'passwordmu'"
            )

    yield

    await runner.shutdown()
    await engine.dispose()


app = FastAPI(
    title="choros",
    version="0.2.0",
    description="Orchestrator langganan coding-agent — self-hosted, lewat channel resmi tiap layanan.",
    lifespan=lifespan,
)

for router in ROUTERS:
    app.include_router(router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

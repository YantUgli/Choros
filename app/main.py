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
from app.orchestrator.runner import runner
from app.security import auth_disabled

log = logging.getLogger("choros")
STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await apply_migrations()

    async with SessionLocal() as session:
        exists = (
            await session.execute(select(User).where(User.username == settings.admin_username))
        ).scalar_one_or_none()
        if exists is None:
            session.add(User(username=settings.admin_username))
            await session.commit()
            log.info("user '%s' dibuat", settings.admin_username)

    if auth_disabled():
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

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_settings = get_settings()

engine = create_async_engine(_settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Dependency FastAPI."""
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Untuk dipakai di background task (di luar request lifecycle)."""
    async with SessionLocal() as session:
        yield session


MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def _split_statements(sql: str) -> list[str]:
    """Pecah file migrasi jadi statement tunggal.

    asyncpg memakai prepared statement, yang hanya menerima satu perintah per
    eksekusi — jadi file .sql tidak bisa dikirim utuh. Split-nya harus sadar
    konteks: titik koma di dalam komentar `--` atau string literal bukan pemisah.
    """
    statements: list[str] = []
    buffer: list[str] = []
    in_comment = False
    in_string = False
    index = 0

    while index < len(sql):
        char = sql[index]
        if in_comment:
            if char == "\n":
                in_comment = False
                buffer.append(char)
            index += 1
            continue
        if in_string:
            buffer.append(char)
            if char == "'":
                if sql[index + 1 : index + 2] == "'":  # '' = kutip ter-escape
                    buffer.append("'")
                    index += 2
                    continue
                in_string = False
            index += 1
            continue
        if char == "-" and sql[index : index + 2] == "--":
            in_comment = True
            index += 2
            continue
        if char == "'":
            in_string = True
            buffer.append(char)
            index += 1
            continue
        if char == ";":
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            index += 1
            continue
        buffer.append(char)
        index += 1

    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)
    return statements


async def apply_migrations() -> None:
    """Jalankan semua migrasi (semuanya idempoten: CREATE ... IF NOT EXISTS)."""
    async with engine.begin() as conn:
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            for statement in _split_statements(path.read_text()):
                await conn.execute(text(statement))

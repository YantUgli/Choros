from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CHOROS_", env_file=".env", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://choros:choros@localhost:5432/choros"

    secret_key: str = "dev-only-insecure-key"
    admin_username: str = "admin"
    admin_password_hash: str = ""
    session_max_age: int = 60 * 60 * 24 * 7

    default_project_path: str = str(Path.home())
    isolation_root: str = str(Path.home() / ".choros" / "worktrees")
    credential_root: str = str(Path.home() / ".choros" / "homes")
    run_timeout: int = 1800

    # cooldown default saat kena 429 tanpa header reset (menit)
    default_cooldown_minutes: int = 60

    # batas konkurensi tugas berjalan bersamaan
    max_concurrent_tasks: int = 3

    # Pra-index worktree ke store codebase-memory-mcp sebelum agent mulai, supaya
    # panggilan MCP pertama si agent tidak balapan dengan autoindex cold di
    # worktree segar (penyebab "tool gagal" transien). Best-effort & non-fatal.
    memory_warmup_enabled: bool = True
    memory_warmup_binary: str = "codebase-memory-mcp"  # nama di PATH atau path absolut
    memory_warmup_mode: str = "fast"
    memory_warmup_timeout: int = 90

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""Pra-index worktree ke store codebase-memory-mcp sebelum agent mulai.

Server MCP meng-auto-index cwd saat startup (async, di latar). Karena tugas otonom
jalan di worktree SEGAR tiap kali, autoindex cold itu selalu terpicu dan balapan
dengan panggilan MCP pertama si agent — panggilan pertama kadang balik ERROR
("call_mcp_tool ✗ tool gagal"), lalu agent menyerah dengan output nyaris nol.

Warm-up ini meng-index worktree lebih dulu (mode `fast`) lewat CLI sinkron
`codebase-memory-mcp cli index_repository`. Setelah itu, saat agent men-spawn
server MCP-nya sendiri dengan cwd yang sama, server melihat `already_indexed` →
skip autoindex → tak ada tulis berat yang balapan dengan tool call pertama.

Sifatnya best-effort & non-fatal: kalau binary tak terpasang, gagal, atau lewat
timeout, tugas tetap lanjut seperti biasa — warm-up hanya optimasi keandalan.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)


async def warm_codebase_memory(repo_path: str) -> str | None:
    """Pra-index `repo_path` best-effort. Kembalikan catatan singkat bila dilewati.

    Return `None` bila warm-up sukses atau dilewati diam-diam (mis. binary tak ada);
    string catatan bila dilewati karena timeout/error, agar bisa ditampilkan sbagai
    status non-blocking di console.
    """
    settings = get_settings()
    if not settings.memory_warmup_enabled:
        return None

    binary = shutil.which(settings.memory_warmup_binary)
    if binary is None:
        candidate = Path(settings.memory_warmup_binary).expanduser()
        binary = str(candidate) if candidate.is_file() else None
    if binary is None:
        return None  # MCP tidak terpasang → lewati diam-diam

    try:
        proc = await asyncio.create_subprocess_exec(
            binary,
            "cli",
            "index_repository",
            "--repo-path",
            repo_path,
            "--mode",
            settings.memory_warmup_mode,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError as exc:
        logger.debug("warm-up memori gagal spawn: %r", exc)
        return None

    try:
        await asyncio.wait_for(proc.wait(), timeout=settings.memory_warmup_timeout)
    except asyncio.TimeoutError:
        proc.kill()
        with contextlib.suppress(ProcessLookupError):
            await proc.wait()
        return "warm-up memori dilewati (timeout) — agent tetap lanjut"

    if proc.returncode != 0:
        logger.debug("warm-up memori keluar rc=%s untuk %s", proc.returncode, repo_path)
    return None

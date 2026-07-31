"""Isolasi ruang kerja untuk mode otonom (PRD §8).

"skip-permission + auto-trust = agent bisa apa saja tanpa konfirmasi. Dikurung
lewat opt-in per-tugas + isolasi, bukan default global."

Jadi mode otonom TIDAK berjalan di direktori asli: kalau project berupa repo git,
choros membuat worktree terpisah; kalau bukan repo git, choros menolak — kecuali
user secara eksplisit memilih `allow_unisolated`.
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings


class IsolationError(RuntimeError):
    pass


@dataclass(slots=True)
class Workspace:
    path: str
    isolated: bool
    branch: str | None = None
    note: str = ""


async def _run(*args: str, cwd: str | None = None) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=cwd,
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode("utf-8", "replace").strip()


async def is_git_repo(path: str) -> bool:
    code, _ = await _run("git", "-C", path, "rev-parse", "--git-dir")
    return code == 0


async def prepare_workspace(
    project_path: str,
    *,
    task_id: int,
    mode: str,
    allow_unisolated: bool = False,
) -> Workspace:
    """Kembalikan ruang kerja untuk tugas ini."""
    project_path = str(Path(project_path).expanduser().resolve())
    if mode != "autonomous":
        return Workspace(path=project_path, isolated=False, note="mode interaktif: di tempat")

    settings = get_settings()
    root = Path(settings.isolation_root).expanduser()
    root.mkdir(parents=True, exist_ok=True)

    if await is_git_repo(project_path):
        branch = f"choros/task-{task_id}"
        target = root / f"task-{task_id}"
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        code, out = await _run(
            "git", "-C", project_path, "worktree", "add", "-b", branch, str(target), "HEAD"
        )
        if code != 0:
            raise IsolationError(f"gagal membuat worktree: {out}")
        return Workspace(
            path=str(target),
            isolated=True,
            branch=branch,
            note=f"worktree terisolasi di {target} (branch {branch})",
        )

    if allow_unisolated:
        return Workspace(
            path=project_path,
            isolated=False,
            note="PERINGATAN: mode otonom tanpa isolasi — dipilih eksplisit oleh user",
        )

    raise IsolationError(
        f"{project_path} bukan repo git, jadi mode otonom tidak bisa diisolasi lewat worktree. "
        "Jadikan repo git (`git init`) atau centang 'izinkan tanpa isolasi' kalau memang disengaja."
    )


async def cleanup_workspace(project_path: str, workspace: Workspace, *, remove: bool) -> str | None:
    """Lepas worktree setelah selesai. Default: dibiarkan agar hasil bisa direview."""
    if not workspace.isolated or not remove:
        return None
    code, out = await _run("git", "-C", project_path, "worktree", "remove", "--force", workspace.path)
    return None if code == 0 else out

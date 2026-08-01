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
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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


async def get_workspace_diff(
    project_path: str, task_id: int, workspace_path: str | None
) -> dict[str, Any]:
    """Dapatkan diff dan status perubahan di worktree otonom."""
    if not workspace_path or not Path(workspace_path).exists():
        return {
            "exists": False,
            "diff": "Worktree tidak ditemukan atau sudah dibuang",
            "branch": f"choros/task-{task_id}",
        }

    branch = f"choros/task-{task_id}"
    project_path = str(Path(project_path).expanduser().resolve())

    _, status_out = await _run("git", "-C", workspace_path, "status", "--short")
    _, diff_uncommitted = await _run("git", "-C", workspace_path, "diff")
    _, diff_committed = await _run("git", "-C", project_path, "diff", f"HEAD...{branch}")

    combined = ""
    if status_out:
        combined += f"=== Status File ===\n{status_out}\n\n"
    if diff_uncommitted:
        combined += f"=== Perubahan Belum Di-commit ===\n{diff_uncommitted}\n\n"
    if diff_committed:
        combined += f"=== Perubahan Sudah Di-commit ===\n{diff_committed}\n\n"

    if not combined:
        combined = "Tidak ada perubahan pada worktree."

    return {
        "exists": True,
        "branch": branch,
        "status": status_out,
        "diff": combined,
    }


async def merge_workspace_branch(
    project_path: str, task_id: int, workspace_path: str | None
) -> tuple[bool, str]:
    """Commit perubahan di worktree, merge branch ke repo utama, lalu bersihkan worktree."""
    branch = f"choros/task-{task_id}"
    project_path = str(Path(project_path).expanduser().resolve())

    if workspace_path and Path(workspace_path).exists():
        _, status = await _run("git", "-C", workspace_path, "status", "--porcelain")
        if status.strip():
            await _run("git", "-C", workspace_path, "add", "-A")
            await _run("git", "-C", workspace_path, "commit", "-m", f"choros task-{task_id} autonomous work")

    code, out = await _run("git", "-C", project_path, "merge", "--no-ff", branch, "-m", f"Merge choros task-{task_id}")
    if code != 0:
        await _run("git", "-C", project_path, "merge", "--abort")
        return False, f"Gagal merge (konflik git):\n{out}"

    if workspace_path and Path(workspace_path).exists():
        await _run("git", "-C", project_path, "worktree", "remove", "--force", workspace_path)
    await _run("git", "-C", project_path, "branch", "-d", branch)

    return True, f"Berhasil merge branch {branch} ke direktori utama."


async def discard_workspace_branch(
    project_path: str, task_id: int, workspace_path: str | None
) -> tuple[bool, str]:
    """Buang worktree dan hapus branch otonom tanpa merge."""
    branch = f"choros/task-{task_id}"
    project_path = str(Path(project_path).expanduser().resolve())

    if workspace_path and Path(workspace_path).exists():
        await _run("git", "-C", project_path, "worktree", "remove", "--force", workspace_path)
    elif workspace_path:
        shutil.rmtree(workspace_path, ignore_errors=True)

    await _run("git", "-C", project_path, "branch", "-D", branch)
    return True, f"Worktree dan branch {branch} berhasil dibuang."


async def gc_old_worktrees(max_age_days: int = 7) -> list[str]:
    """Pembersihan sampah worktree lama di isolation_root."""
    settings = get_settings()
    root = Path(settings.isolation_root).expanduser()
    if not root.exists():
        return []

    removed: list[str] = []
    cutoff = time.time() - (max_age_days * 86400)

    for item in root.iterdir():
        if item.is_dir():
            try:
                if item.stat().st_mtime < cutoff:
                    shutil.rmtree(item, ignore_errors=True)
                    removed.append(str(item))
            except Exception:
                pass
    return removed

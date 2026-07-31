"""Isolasi mode otonom (PRD §8): izin penuh harus terkurung di ruang kerja sendiri."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.adapters.antigravity import AntigravityAdapter
from app.adapters.claude_code import ClaudeCodeAdapter
from app.orchestrator.isolation import IsolationError, prepare_workspace

pytestmark = pytest.mark.anyio


async def _git(*args: str, cwd: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "git", *args, cwd=cwd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
    )
    await proc.wait()


@pytest.fixture
async def git_repo(tmp_path):
    repo = tmp_path / "proj"
    repo.mkdir()
    await _git("init", "-q", cwd=str(repo))
    await _git("config", "user.email", "t@t.t", cwd=str(repo))
    await _git("config", "user.name", "t", cwd=str(repo))
    (repo / "README.md").write_text("hai")
    await _git("add", ".", cwd=str(repo))
    await _git("commit", "-qm", "init", cwd=str(repo))
    return repo


async def test_interactive_mode_runs_in_place(tmp_path):
    workspace = await prepare_workspace(str(tmp_path), task_id=1, mode="interactive")
    assert workspace.path == str(tmp_path.resolve())
    assert workspace.isolated is False


async def test_autonomous_mode_gets_its_own_worktree(git_repo, monkeypatch, tmp_path):
    monkeypatch.setenv("CHOROS_ISOLATION_ROOT", str(tmp_path / "wt"))
    from app.config import get_settings

    get_settings.cache_clear()

    workspace = await prepare_workspace(str(git_repo), task_id=42, mode="autonomous")
    assert workspace.isolated is True
    assert workspace.path != str(git_repo)
    assert Path(workspace.path, "README.md").exists()
    assert workspace.branch == "choros/task-42"

    # perubahan di worktree tidak menyentuh direktori asli
    Path(workspace.path, "baru.txt").write_text("x")
    assert not (git_repo / "baru.txt").exists()

    get_settings.cache_clear()


async def test_autonomous_mode_refuses_non_git_directory(tmp_path):
    """Tanpa repo git tidak ada yang mengurung agent → menolak, bukan diam-diam jalan."""
    plain = tmp_path / "biasa"
    plain.mkdir()
    with pytest.raises(IsolationError, match="bukan repo git"):
        await prepare_workspace(str(plain), task_id=7, mode="autonomous")


async def test_autonomous_without_isolation_needs_explicit_opt_in(tmp_path):
    plain = tmp_path / "biasa"
    plain.mkdir()
    workspace = await prepare_workspace(
        str(plain), task_id=7, mode="autonomous", allow_unisolated=True
    )
    assert workspace.isolated is False
    assert "PERINGATAN" in workspace.note


async def test_claude_ensure_trusted_preseeds_config(tmp_path, monkeypatch):
    config = tmp_path / ".claude.json"
    config.write_text(json.dumps({"projects": {}, "numStartups": 3}))
    monkeypatch.setattr("app.adapters.claude_code.CLAUDE_CONFIG", config)

    project = tmp_path / "proj"
    project.mkdir()
    adapter = ClaudeCodeAdapter(name="claude")
    await adapter.ensure_trusted(str(project))

    saved = json.loads(config.read_text())
    assert saved["projects"][str(project.resolve())]["hasTrustDialogAccepted"] is True
    assert saved["numStartups"] == 3, "config lain tidak boleh hilang"


async def test_antigravity_ensure_trusted_skips_when_parent_already_trusted(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    parent = tmp_path / "workspace"
    child = parent / "nested" / "proj"
    child.mkdir(parents=True)
    settings.write_text(json.dumps({"trustedWorkspaces": [str(parent)], "model": "X"}))
    monkeypatch.setattr("app.adapters.antigravity.AGY_SETTINGS", settings)

    adapter = AntigravityAdapter(name="ag")
    await adapter.ensure_trusted(str(child))

    saved = json.loads(settings.read_text())
    assert saved["trustedWorkspaces"] == [str(parent)], "parent sudah mencakup, jangan tambah entri"
    assert saved["model"] == "X"


async def test_antigravity_ensure_trusted_appends_new_workspace(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"trustedWorkspaces": ["/tmp/lain"]}))
    monkeypatch.setattr("app.adapters.antigravity.AGY_SETTINGS", settings)

    project = tmp_path / "proj"
    project.mkdir()
    adapter = AntigravityAdapter(name="ag")
    await adapter.ensure_trusted(str(project))

    saved = json.loads(settings.read_text())
    assert str(project.resolve()) in saved["trustedWorkspaces"]

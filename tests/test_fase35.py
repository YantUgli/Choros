from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Task, TaskEvent
from app.orchestrator import quota
from app.orchestrator.isolation import (
    get_workspace_diff,
    is_git_repo,
    merge_workspace_branch,
    prepare_workspace,
)
from app.orchestrator.runner import runner


@pytest.mark.asyncio
async def test_recover_interrupted_tasks(user):
    async with SessionLocal() as session:
        t1 = Task(user_id=user.id, prompt="task queued", category="coding_complex", status="queued")
        t2 = Task(user_id=user.id, prompt="task running", category="coding_complex", status="running")
        t3 = Task(user_id=user.id, prompt="task ok", category="coding_complex", status="ok")
        session.add_all([t1, t2, t3])
        await session.commit()
        t1_id, t2_id, t3_id = t1.id, t2.id, t3.id

    recovered = await runner.recover_interrupted_tasks()
    assert recovered == 2

    async with SessionLocal() as session:
        task1 = await session.get(Task, t1_id)
        task2 = await session.get(Task, t2_id)
        task3 = await session.get(Task, t3_id)

        assert task1.status == "interrupted"
        assert task2.status == "interrupted"
        assert task3.status == "ok"

        events1 = (
            await session.execute(select(TaskEvent).where(TaskEvent.task_id == t1_id))
        ).scalars().all()
        assert len(events1) == 1
        assert "terinterupsi" in events1[0].data.get("message", "")


@pytest.mark.asyncio
async def test_quota_cooldown_separation(user, make_agent):
    agent = await make_agent("claude-test", adapter_type="claude_code")

    async with SessionLocal() as session:
        # Record token usage (rolling 5h window)
        await quota.record_usage(
            session, user_id=user.id, agent_id=agent.id, model="sonnet", tokens=1000, window_type="rolling_5h"
        )
        # Mark rate limit 429 for 2 seconds
        await quota.mark_exhausted(
            session, user_id=user.id, agent_id=agent.id, model="sonnet", retry_after_seconds=2
        )
        await session.commit()

    async with SessionLocal() as session:
        exhausted, reset_at = await quota.is_exhausted(
            session, user_id=user.id, agent_id=agent.id, model="sonnet"
        )
        assert exhausted is True

        # Verify token window exists separately from cooldown window
        windows = await quota.list_windows(session, user_id=user.id)
        types = [w.window_type for w in windows]
        assert "cooldown" in types
        assert "rolling_5h" in types


@pytest.mark.asyncio
async def test_worktree_lifecycle():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        repo_dir = tmp_path / "repo"
        repo_dir.mkdir()

        # Init git repo
        import subprocess

        subprocess.run(["git", "init"], cwd=repo_dir, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=repo_dir, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo_dir, check=True)

        (repo_dir / "file.txt").write_text("initial content\n")
        subprocess.run(["git", "add", "-A"], cwd=repo_dir, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=repo_dir, check=True)

        assert await is_git_repo(str(repo_dir)) is True

        # Prepare workspace for task 999
        ws = await prepare_workspace(str(repo_dir), task_id=999, mode="autonomous")
        assert ws.isolated is True
        assert Path(ws.path).exists()

        # Modify file in worktree
        (Path(ws.path) / "file.txt").write_text("initial content\nautonomous edit\n")

        # Get diff
        diff_res = await get_workspace_diff(str(repo_dir), 999, ws.path)
        assert diff_res["exists"] is True
        assert "autonomous edit" in diff_res["diff"]

        # Merge workspace
        ok, msg = await merge_workspace_branch(str(repo_dir), 999, ws.path)
        assert ok is True
        assert "Berhasil merge" in msg

        # Verify content merged to main repo
        assert "autonomous edit" in (repo_dir / "file.txt").read_text()
        assert not Path(ws.path).exists()

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import Project, Task, TaskGroup, TaskRun
from app.orchestrator import quota
from app.orchestrator import runner as runner_module


async def _make_run(user, category: str = "text_planning") -> int:
    async with SessionLocal() as session:
        project = Project(user_id=user.id, name="P", folder_path="/tmp/x")
        session.add(project)
        await session.flush()
        group = TaskGroup(
            project_id=project.id,
            user_id=user.id,
            name="T",
            categories=[category, "coding_complex"],
        )
        session.add(group)
        await session.flush()
        run = TaskRun(task_group_id=group.id, user_id=user.id, status="running")
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return run.id


@pytest.mark.asyncio
async def test_fanout_creates_two_branches_same_group(user, make_agent, monkeypatch):
    started: list[int] = []
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: started.append(tid))

    a1 = await make_agent("a1", adapter_type="claude_code")
    a2 = await make_agent("a2", adapter_type="claude_code")
    run_id = await _make_run(user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/text_planning/fanout",
            json={
                "prompt": "rancang pendekatan X",
                "agent_ids": [a1.id, a2.id],
                "allow_unisolated": True,
            },
        )

    assert res.status_code == 201, res.text
    body = res.json()
    assert len(body) == 2

    # kedua cabang berbagi satu fanout_group_id (bukan None), selalu autonomous
    gids = {t["fanout_group_id"] for t in body}
    assert len(gids) == 1 and None not in gids
    assert all(t["mode"] == "autonomous" for t in body)
    # keduanya dijalankan lewat runner
    assert started == [t["id"] for t in body]

    # tiap cabang di-pin ke agent yang berbeda
    async with SessionLocal() as session:
        rows = [await session.get(Task, t["id"]) for t in body]
        assert {r.pinned_agent_id for r in rows} == {a1.id, a2.id}


@pytest.mark.asyncio
async def test_fanout_rejects_wrong_agent_count(user, make_agent, monkeypatch):
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: None)
    a1 = await make_agent("a1", adapter_type="claude_code")
    run_id = await _make_run(user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # agent sama dua kali → 400
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/text_planning/fanout",
            json={"prompt": "x", "agent_ids": [a1.id, a1.id], "allow_unisolated": True},
        )
        assert res.status_code == 400
        # hanya satu agent → 400
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/text_planning/fanout",
            json={"prompt": "x", "agent_ids": [a1.id], "allow_unisolated": True},
        )
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_fanout_rejects_category_not_in_task(user, make_agent, monkeypatch):
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: None)
    a1 = await make_agent("a1", adapter_type="claude_code")
    a2 = await make_agent("a2", adapter_type="claude_code")
    run_id = await _make_run(user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/coding_simple/fanout",
            json={"prompt": "x", "agent_ids": [a1.id, a2.id], "allow_unisolated": True},
        )
        assert res.status_code == 400


async def _make_fanout(client, run_id, a1, a2, category="text_planning") -> list[dict]:
    res = await client.post(
        f"/api/task-runs/{run_id}/lanes/{category}/fanout",
        json={"prompt": "rancang X", "agent_ids": [a1.id, a2.id], "allow_unisolated": True},
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_select_winner_discards_losers_and_delegates(user, make_agent, monkeypatch):
    started: list[int] = []
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: started.append(tid))

    async def _cancel(tid):  # loser belum benar-benar jalan (start di-patch)
        return False

    monkeypatch.setattr(runner_module.runner, "cancel", _cancel)

    a1 = await make_agent("a1", adapter_type="claude_code")
    a2 = await make_agent("a2", adapter_type="claude_code")
    run_id = await _make_run(user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        branches = await _make_fanout(client, run_id, a1, a2)
        winner_id = branches[0]["id"]
        loser_id = branches[1]["id"]

        res = await client.post(
            f"/api/tasks/{winner_id}/select-winner",
            json={"to_category": "coding_complex", "artifact": "PLAN: langkah 1..3"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["id"] == winner_id

    async with SessionLocal() as session:
        loser = await session.get(Task, loser_id)
        winner = await session.get(Task, winner_id)
        assert loser.status == "discarded" and loser.finished_at is not None
        assert winner.status != "discarded"  # pemenang tak disentuh
        # task delegasi baru dibuat di lane berikut, jejak ke pemenang
        deleg = (
            await session.execute(
                select(Task).where(Task.delegated_from_task_id == winner_id)
            )
        ).scalars().all()
        assert len(deleg) == 1
        assert deleg[0].category == "coding_complex"
        # delegasi ikut dijalankan lewat runner
        assert deleg[0].id in started


@pytest.mark.asyncio
async def test_fanout_quota_preflight_blocks_then_force_overrides(user, make_agent, monkeypatch):
    started: list[int] = []
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: started.append(tid))

    a1 = await make_agent("a1", adapter_type="claude_code", model="sonnet")
    a2 = await make_agent("a2", adapter_type="claude_code", model="sonnet")
    run_id = await _make_run(user)

    # a1 kuotanya mentok
    async with SessionLocal() as session:
        await quota.mark_exhausted(
            session, user_id=user.id, agent_id=a1.id, model="sonnet", default_cooldown_minutes=60
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # tanpa force → 409
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/text_planning/fanout",
            json={"prompt": "x", "agent_ids": [a1.id, a2.id], "allow_unisolated": True},
        )
        assert res.status_code == 409, res.text
        assert "kuota mentok" in res.json()["detail"]
        assert started == []

        # dengan force → 201
        res = await client.post(
            f"/api/task-runs/{run_id}/lanes/text_planning/fanout",
            json={"prompt": "x", "agent_ids": [a1.id, a2.id], "allow_unisolated": True, "force": True},
        )
        assert res.status_code == 201, res.text
        assert len(started) == 2


@pytest.mark.asyncio
async def test_select_winner_rejects_non_fanout_task(user, monkeypatch):
    monkeypatch.setattr(runner_module.runner, "start", lambda tid: None)
    async with SessionLocal() as session:
        task = Task(user_id=user.id, prompt="biasa", category="coding_complex", status="ok")
        session.add(task)
        await session.commit()
        task_id = task.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/tasks/{task_id}/select-winner", json={})
        assert res.status_code == 400

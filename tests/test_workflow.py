from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import SessionLocal
from app.events import ERROR_RATE_LIMIT, Event
from app.main import app
from app.models import Task, Workflow, WorkflowRun, WorkflowStep
from app.orchestrator import runner as runner_module
from app.orchestrator.runner import runner
from app.security import get_current_user

pytestmark = pytest.mark.anyio


class FakeAdapter:
    calls: list[dict] = []

    def __init__(self, *, name, config=None, default_model=None, base_url=None, timeout=60):
        self.name = name
        self.config = config or {}
        self.default_model = default_model
        self.behaviour = (self.config or {}).get("behaviour", "ok")
        self.trusted: list[str] = []

    async def ensure_trusted(self, project_path: str) -> None:
        self.trusted.append(project_path)

    async def cancel(self) -> None:
        return None

    async def run(
        self, prompt, *, model=None, permission_mode="safe", project_path=None, resume_session_id=None
    ) -> AsyncIterator[Event]:
        FakeAdapter.calls.append(
            {
                "agent": self.name,
                "model": model,
                "prompt": prompt,
                "permission_mode": permission_mode,
                "project_path": project_path,
                "resume_session_id": resume_session_id,
            }
        )
        yield Event.status("session dimulai", session_id=f"sess-{self.name}")
        yield Event.usage({"input_tokens": 100, "output_tokens": 50, "total_tokens": 150})
        if self.behaviour == "rate_limit":
            yield Event("error", {"kind": ERROR_RATE_LIMIT, "message": "429 rate limit", "retry_after": 120})
            return
        if self.behaviour == "crash":
            yield Event.error("crash", "meledak")
            return
        yield Event("output", {"text": f"beres oleh {self.name}", "final": True})
        yield Event.status("selesai", final=True)


async def create_and_run_workflow(user, steps_config, goal="test goal", project_path=None):
    """Helper: create workflow + steps + run + first task, return (run, first_task)"""
    async with SessionLocal() as session:
        wf = Workflow(user_id=user.id, name="test-wf")
        session.add(wf)
        await session.flush()
        for idx, cfg in enumerate(steps_config):
            step = WorkflowStep(workflow_id=wf.id, step_order=idx, **cfg)
            session.add(step)
        await session.flush()
        run = WorkflowRun(
            workflow_id=wf.id,
            user_id=user.id,
            goal=goal,
            status="running",
            current_step=0,
            project_path=project_path or ".",
            mode="interactive",
        )
        session.add(run)
        await session.flush()
        first_step = steps_config[0]
        task = Task(
            user_id=user.id,
            prompt=goal,
            category=first_step.get("category", "coding_complex"),
            mode="interactive",
            project_path=project_path or ".",
            quality_floor=first_step.get("quality_floor"),
            workflow_run_id=run.id,
            step_order=0,
            owns_workspace=True,
            status="queued",
        )
        session.add(task)
        await session.commit()
        run_id = run.id
        task_id = task.id

    return run_id, task_id


@pytest.fixture(autouse=True)
def setup_fake_adapter(monkeypatch):
    FakeAdapter.calls.clear()

    def fake_build(agent, override_behavior=None, **kwargs):
        cfg = (agent.config or {}).copy()
        if override_behavior:
            cfg["behaviour"] = override_behavior
        return FakeAdapter(name=agent.name, config=cfg)

    monkeypatch.setattr(runner_module, "build_adapter", fake_build)
    monkeypatch.setattr(runner_module, "adapter_can_execute", lambda _: True)


async def test_two_step_run_handoff_artifact(user, make_agent, make_route):
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"role_prompt": "Step 1", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"role_prompt": "Step 2", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex"},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)

    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        task1 = await session.get(Task, task1_id)
        assert run.current_step == 1, f"run: {run.status}, task1: {task1.status}, out: {task1.final_output}"
        assert run.status == "running"

        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one()
        assert task2 is not None
        assert task2.plan_artifact is not None
        assert "beres oleh agent_1" in task2.plan_artifact


async def test_shared_workspace_across_steps(user, make_agent, make_route):
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"role_prompt": "Step 1", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"role_prompt": "Step 2", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex"},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps, project_path="/test/path")

    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one()
        assert task2.owns_workspace is False


async def test_step_failure_halts_run(user, make_agent, monkeypatch):
    agent_1 = await make_agent("agent_1", behaviour="crash")
    agent_2 = await make_agent("agent_2")

    steps = [
        {"role_prompt": "Step 1", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"role_prompt": "Step 2", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex"},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)

    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        assert run.status == "halted"

        # Step 2 task never created
        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one_or_none()
        assert task2 is None


async def test_requires_approval_pauses_run(user, make_agent, make_route):
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"role_prompt": "Step 1", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {
            "role_prompt": "Step 2",
            "targets": [{"agent_id": agent_2.id}],
            "category": "coding_complex",
            "requires_approval": True,
        },
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)

    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        assert run.status == "awaiting_approval"

        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one_or_none()
        assert task2 is None

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(f"/api/workflow-runs/{run_id}/approve")
            assert res.status_code == 200
    finally:
        app.dependency_overrides.clear()

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        assert run.status in ("running", "ok")

        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one_or_none()
        assert task2 is not None


async def test_workflow_run_detail_unstarted_steps_pending(user, make_agent, make_route):
    """T3: GET /api/workflow-runs/{id} mengembalikan step yang belum jalan berstatus 'pending'."""
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"name": "Step A", "role_prompt": "Prompt A", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"name": "Step B", "role_prompt": "Prompt B", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex"},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get(f"/api/workflow-runs/{run_id}")
            assert res.status_code == 200
            data = res.json()
            assert len(data["steps"]) == 2
            assert data["steps"][0]["name"] == "Step A"
            assert data["steps"][0]["status"] == "queued"
            assert data["steps"][0]["task_id"] == task1_id
            assert data["steps"][1]["name"] == "Step B"
            assert data["steps"][1]["status"] == "pending"
            assert data["steps"][1]["task_id"] is None
    finally:
        app.dependency_overrides.clear()


async def test_pending_approval_details(user, make_agent, make_route):
    """T4: pending_approval_step_id menunjuk step berikutnya, pending_approval_artifact == final_output step sebelumnya."""
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"name": "Planner", "role_prompt": "Plan", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"name": "Executor", "role_prompt": "Exec", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex", "requires_approval": True},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)
    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task
    await asyncio.sleep(0.3)

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get(f"/api/workflow-runs/{run_id}")
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "awaiting_approval"
            assert data["pending_approval_step_id"] is not None
            assert "beres oleh agent_1" in (data["pending_approval_artifact"] or "")
    finally:
        app.dependency_overrides.clear()


async def test_approve_with_edited_plan_artifact(user, make_agent, make_route):
    """T5: POST /approve dengan body plan_artifact menyuntikkan artefak yang disunting ke task step 2."""
    agent_1 = await make_agent("agent_1")
    agent_2 = await make_agent("agent_2")
    await make_route("coding_complex", agent_1, priority=10)

    steps = [
        {"role_prompt": "Step 1", "targets": [{"agent_id": agent_1.id}], "category": "coding_complex"},
        {"role_prompt": "Step 2", "targets": [{"agent_id": agent_2.id}], "category": "coding_complex", "requires_approval": True},
    ]

    run_id, task1_id = await create_and_run_workflow(user, steps)
    runner.start(task1_id)
    handle = runner._running[task1_id]
    await handle.task
    await asyncio.sleep(0.3)

    custom_plan = "--- DISUNTING USER --- 1. Fix bug A; 2. Add test B"
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(f"/api/workflow-runs/{run_id}/approve", json={"plan_artifact": custom_plan})
            assert res.status_code == 200
    finally:
        app.dependency_overrides.clear()

    await asyncio.sleep(0.3)

    async with SessionLocal() as session:
        res = await session.execute(
            select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
        )
        task2 = res.scalar_one()
        assert task2.plan_artifact == custom_plan


async def test_run_workflow_with_custom_goal(user, make_agent):
    """T8: POST /run dengan body goal menyimpan goal eksplisit user."""
    agent_1 = await make_agent("agent_1")
    async with SessionLocal() as session:
        wf = Workflow(user_id=user.id, name="Custom Goal WF")
        session.add(wf)
        await session.flush()
        s1 = WorkflowStep(workflow_id=wf.id, step_order=0, name="S1", category="coding_complex", targets=[{"agent_id": agent_1.id}])
        session.add(s1)
        await session.commit()
        wf_id = wf.id

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(f"/api/workflows/{wf_id}/run", json={"goal": "Refactor modul payment"})
            assert res.status_code == 201
            data = res.json()
            assert data["goal"] == "Refactor modul payment"
    finally:
        app.dependency_overrides.clear()


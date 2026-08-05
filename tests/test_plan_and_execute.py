"""Skenario integrasi untuk fitur plan → execute dan cascade di Choros.

Empat skenario utama:
  1. Plan → Execute handoff      — artefak step 1 masuk ke prompt step 2
  2. Quality floor blocker       — agent di bawah ambang mutu dilewati, run halted
  3. Cascade fallback            — agent utama crash, agent cadangan berhasil
  4. Approval + edited plan      — run berhenti menunggu, user edit plan, step 2 dapat plan yang diedit
"""
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

# ---------------------------------------------------------------------------
# Fake adapter — tidak memanggil API nyata
# ---------------------------------------------------------------------------


class FakeAdapter:
    """Adapter palsu yang bisa dikonfigurasi lewat `behaviour`."""

    all_calls: list[dict] = []

    def __init__(self, *, name: str, config=None, default_model=None, **_):
        self.name = name
        self.config = config or {}
        self.behaviour = self.config.get("behaviour", "ok")

    async def ensure_trusted(self, project_path: str) -> None:
        pass

    async def cancel(self) -> None:
        pass

    async def run(
        self,
        prompt: str,
        *,
        model=None,
        permission_mode="safe",
        project_path=None,
        resume_session_id=None,
    ) -> AsyncIterator[Event]:
        FakeAdapter.all_calls.append(
            {"agent": self.name, "model": model, "prompt": prompt}
        )
        yield Event.status("mulai", session_id=f"sess-{self.name}")
        yield Event.usage({"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})

        if self.behaviour == "rate_limit":
            yield Event("error", {"kind": ERROR_RATE_LIMIT, "message": "429", "retry_after": 60})
            return

        if self.behaviour == "crash":
            yield Event.error("crash", f"{self.name} meledak")
            return

        yield Event("output", {"text": f"output dari {self.name}", "final": True})
        yield Event.status("selesai", final=True)


@pytest.fixture(autouse=True)
def patch_adapter(monkeypatch):
    FakeAdapter.all_calls.clear()
    monkeypatch.setattr(runner_module, "build_adapter", lambda agent, **kw: FakeAdapter(name=agent.name, config=agent.config))
    monkeypatch.setattr(runner_module, "adapter_can_execute", lambda _: True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workflow_and_run(user, steps_cfg: list[dict], goal: str = "test goal") -> tuple[int, int]:
    """Buat workflow + step + run + task pertama. Return (run_id, task1_id)."""
    async with SessionLocal() as session:
        wf = Workflow(user_id=user.id, name="test-wf")
        session.add(wf)
        await session.flush()
        for idx, cfg in enumerate(steps_cfg):
            session.add(WorkflowStep(workflow_id=wf.id, step_order=idx, **cfg))
        await session.flush()
        run = WorkflowRun(
            workflow_id=wf.id,
            user_id=user.id,
            goal=goal,
            status="running",
            current_step=0,
            project_path=".",
            mode="interactive",
        )
        session.add(run)
        await session.flush()
        first = steps_cfg[0]
        task = Task(
            user_id=user.id,
            prompt=goal,
            category=first.get("category", "coding_complex"),
            mode="interactive",
            project_path=".",
            quality_floor=first.get("quality_floor"),
            workflow_run_id=run.id,
            step_order=0,
            owns_workspace=True,
            status="queued",
        )
        session.add(task)
        await session.commit()
        return run.id, task.id


async def _run_task_and_wait(task_id: int) -> None:
    runner.start(task_id)
    await runner._running[task_id].task
    await asyncio.sleep(0.3)  # beri waktu advance_run selesai


# ---------------------------------------------------------------------------
# Skenario 1: Plan → Execute handoff
# ---------------------------------------------------------------------------


async def test_plan_then_execute_artifact_handoff(user, make_agent, make_route):
    """
    Skenario: Workflow 2 step — step 1 (planner) menghasilkan plan,
    step 2 (executor) harus menerima plan itu sebagai plan_artifact.

    Yang diverifikasi:
    - task step 2 punya plan_artifact berisi output step 1
    - prompt step 2 berisi goal asli user
    - run.current_step bergerak ke 1
    """
    planner = await make_agent("planner", adapter_type="claude_code", model="sonnet")
    executor = await make_agent("executor", adapter_type="claude_code", model="sonnet")
    await make_route("text_planning", planner, priority=1)

    steps = [
        {
            "name": "Buat Plan",
            "role_prompt": "Kamu adalah planner. Buat plan detail.",
            "category": "text_planning",
            "targets": [{"agent_id": planner.id}],
        },
        {
            "name": "Eksekusi Kode",
            "role_prompt": "Kamu adalah executor. Jalankan plan.",
            "category": "coding_complex",
            "targets": [{"agent_id": executor.id}],
        },
    ]

    run_id, task1_id = await _make_workflow_and_run(user, steps, goal="Tambah fitur login OAuth")
    await _run_task_and_wait(task1_id)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        task1 = await session.get(Task, task1_id)

        # Step 1 selesai, run bergerak ke step 1 (= step ke-2 sedang berjalan)
        assert task1.status == "ok", f"task1 status: {task1.status}"
        assert run.current_step == 1, f"current_step: {run.current_step}"

        # Step 2 sudah dibuat dan menerima plan_artifact dari step 1
        task2 = (
            await session.execute(
                select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
            )
        ).scalar_one()

        assert task2 is not None, "task step 2 belum dibuat"
        assert task2.plan_artifact is not None, "plan_artifact kosong"
        assert "output dari planner" in task2.plan_artifact, (
            f"plan_artifact tidak mengandung output planner: {task2.plan_artifact!r}"
        )

        # Goal asli user harus ada di prompt step 2
        assert "Tambah fitur login OAuth" in task2.prompt, (
            f"goal tidak ada di prompt step 2: {task2.prompt[:200]!r}"
        )


# ---------------------------------------------------------------------------
# Skenario 2: Quality floor blocker
# ---------------------------------------------------------------------------


async def test_quality_floor_blocks_weak_agent_halts_run(user, make_agent, make_route):
    """
    Skenario: Satu-satunya agent untuk kategori coding_complex punya model
    'groq/llama-3.1-8b-instant' (TIER_LIGHT). Step minta floor 'strong'.

    Yang diverifikasi:
    - run.status == 'halted' (bukan 'ok')
    - tidak ada task step 2 yang dibuat
    """
    weak_agent = await make_agent(
        "agent-lemah",
        adapter_type="claude_code",
        model="groq/llama-3.1-8b-instant",  # tier LIGHT
    )
    await make_route("coding_complex", weak_agent, priority=1)

    steps = [
        {
            "name": "Kerjakan dengan model kuat",
            "category": "coding_complex",
            "quality_floor": "strong",  # hanya boleh STRONG ke atas
            "targets": [{"agent_id": weak_agent.id}],
        },
        {
            "name": "Step lanjutan",
            "category": "coding_complex",
            "targets": [{"agent_id": weak_agent.id}],
        },
    ]

    run_id, task1_id = await _make_workflow_and_run(user, steps)
    await _run_task_and_wait(task1_id)

    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        task1 = await session.get(Task, task1_id)

        assert task1.status == "halted", f"task1 seharusnya halted, dapat: {task1.status}"
        assert run.status == "halted", f"run seharusnya halted, dapat: {run.status}"

        # Step 2 tidak boleh dibuat karena step 1 gagal
        task2 = (
            await session.execute(
                select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
            )
        ).scalar_one_or_none()
        assert task2 is None, "step 2 tidak boleh dibuat kalau step 1 halted"


# ---------------------------------------------------------------------------
# Skenario 3: Cascade fallback
# ---------------------------------------------------------------------------


async def test_cascade_fallback_primary_crash_secondary_succeeds(user, make_agent, make_route):
    """
    Skenario: Step 1 punya 2 target — agent utama crash, agent cadangan berhasil.
    Workflow harus tetap berlanjut (bukan halted).

    Yang diverifikasi:
    - kedua agent dipanggil (cascade)
    - task1.status == 'ok' (berhasil lewat cadangan)
    - run maju ke step 2
    """
    primary = await make_agent("primary-agent", adapter_type="claude_code", model="sonnet", behaviour="crash")
    fallback = await make_agent("fallback-agent", adapter_type="claude_code", model="sonnet")
    await make_route("coding_complex", primary, priority=1)
    await make_route("coding_complex", fallback, priority=2)

    steps = [
        {
            "name": "Step utama (ada fallback)",
            "category": "coding_complex",
            # targets tidak di-set di step — pakai routing rule global
        },
        {
            "name": "Step lanjutan",
            "category": "coding_complex",
            "targets": [{"agent_id": fallback.id}],
        },
    ]

    run_id, task1_id = await _make_workflow_and_run(user, steps)
    await _run_task_and_wait(task1_id)

    async with SessionLocal() as session:
        task1 = await session.get(Task, task1_id)
        run = await session.get(WorkflowRun, run_id)

        assert task1.status == "ok", (
            f"task1 harus ok lewat fallback, dapat: {task1.status}"
        )

        # Kedua agent dipanggil
        called_agents = [c["agent"] for c in FakeAdapter.all_calls]
        assert "primary-agent" in called_agents, "primary-agent tidak dipanggil"
        assert "fallback-agent" in called_agents, "fallback-agent tidak dipanggil"

        # Fallback berhasil → run lanjut ke step 2
        assert run.current_step == 1, f"run harus maju ke step 2, dapat: {run.current_step}"


# ---------------------------------------------------------------------------
# Skenario 4: Approval checkpoint + edited plan
# ---------------------------------------------------------------------------


async def test_approval_checkpoint_with_edited_plan(user, make_agent, make_route):
    """
    Skenario: Step 2 memerlukan approval. Setelah step 1 selesai, run berhenti
    di 'awaiting_approval'. User mengedit plan lalu approve via API.
    Step 2 harus menerima plan yang sudah diedit user.

    Yang diverifikasi:
    - run.status == 'awaiting_approval' setelah step 1 selesai
    - setelah POST /approve dengan plan diedit, step 2 dibuat
    - task2.plan_artifact == plan yang diedit user
    """
    planner = await make_agent("planner-a", adapter_type="claude_code", model="sonnet")
    executor = await make_agent("executor-a", adapter_type="claude_code", model="sonnet")
    await make_route("coding_complex", planner, priority=1)

    steps = [
        {
            "name": "Planner",
            "category": "coding_complex",
            "targets": [{"agent_id": planner.id}],
        },
        {
            "name": "Executor",
            "category": "coding_complex",
            "targets": [{"agent_id": executor.id}],
            "requires_approval": True,  # <<< checkpoint
        },
    ]

    run_id, task1_id = await _make_workflow_and_run(user, steps, goal="Refactor modul pembayaran")
    await _run_task_and_wait(task1_id)

    # Pastikan run berhenti menunggu approval
    async with SessionLocal() as session:
        run = await session.get(WorkflowRun, run_id)
        assert run.status == "awaiting_approval", (
            f"run harus awaiting_approval, dapat: {run.status}"
        )

    # User melihat plan dari step 1, lalu mengeditnya sebelum approve
    edited_plan = (
        "# Plan yang Diedit User\n"
        "1. Perbaiki bug di payment_gateway.py baris 42\n"
        "2. Tambah unit test untuk edge case refund\n"
        "3. Update CHANGELOG"
    )

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/api/workflow-runs/{run_id}/approve",
                json={"plan_artifact": edited_plan},
            )
            assert resp.status_code == 200, f"approve gagal: {resp.text}"
    finally:
        app.dependency_overrides.clear()

    await asyncio.sleep(0.3)

    # Verifikasi task step 2 dibuat dengan plan yang diedit
    async with SessionLocal() as session:
        task2 = (
            await session.execute(
                select(Task).where(Task.workflow_run_id == run_id, Task.step_order == 1)
            )
        ).scalar_one_or_none()

        assert task2 is not None, "task step 2 belum dibuat setelah approve"
        assert task2.plan_artifact == edited_plan, (
            f"plan_artifact tidak sesuai plan yang diedit:\n"
            f"  dapat:    {task2.plan_artifact!r}\n"
            f"  diharapkan: {edited_plan!r}"
        )

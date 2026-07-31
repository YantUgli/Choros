"""Cascade fallback lintas provider — tiga keputusan PRD §6.

Adapter diganti fake supaya perilaku orchestrator bisa diuji tanpa membakar kuota
langganan sungguhan.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.events import ERROR_RATE_LIMIT, Event
from app.models import QuotaWindow, Task, TaskEvent, TaskLog
from app.orchestrator import runner as runner_module
from app.orchestrator.runner import runner

pytestmark = pytest.mark.anyio


class FakeAdapter:
    """Adapter palsu yang bisa disetel untuk sukses, kena limit, atau error."""

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


@pytest.fixture(autouse=True)
def fake_adapters(monkeypatch):
    FakeAdapter.calls = []
    monkeypatch.setattr(
        runner_module,
        "build_adapter",
        lambda agent, timeout=None: FakeAdapter(
            name=agent.name, config=agent.config, default_model=agent.default_model
        ),
    )
    # semua adapter fake dianggap punya tangan
    monkeypatch.setattr(runner_module, "adapter_can_execute", lambda _: True)
    yield


async def run_task(**kwargs) -> Task:
    async with SessionLocal() as session:
        task = Task(status="queued", **kwargs)
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = task.id

    runner.start(task_id)
    handle = runner._running[task_id]
    await handle.task

    async with SessionLocal() as session:
        return await session.get(Task, task_id)


async def logs_for(task_id: int) -> list[TaskLog]:
    async with SessionLocal() as session:
        stmt = select(TaskLog).where(TaskLog.task_id == task_id).order_by(TaskLog.id)
        return list((await session.execute(stmt)).scalars())


async def events_for(task_id: int) -> list[TaskEvent]:
    async with SessionLocal() as session:
        stmt = select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.seq)
        return list((await session.execute(stmt)).scalars())


# ---------------------------------------------------------------- skenario


async def test_falls_through_to_next_target_on_rate_limit(user, make_agent, make_route, tmp_path):
    primary = await make_agent("primary", behaviour="rate_limit")
    backup = await make_agent("backup", behaviour="ok")
    await make_route("coding_complex", primary, priority=10)
    await make_route("coding_complex", backup, priority=20)

    task = await run_task(
        user_id=user.id, prompt="kerjakan ini", category="coding_complex", project_path=str(tmp_path)
    )

    assert task.status == "ok"
    assert task.final_output == "beres oleh backup"
    assert [c["agent"] for c in FakeAdapter.calls] == ["primary", "backup"]

    entries = await logs_for(task.id)
    assert [e.status for e in entries] == ["rate_limited", "ok"]


async def test_rate_limit_sets_cooldown_window(user, make_agent, make_route, tmp_path):
    primary = await make_agent("primary", behaviour="rate_limit")
    backup = await make_agent("backup", behaviour="ok")
    await make_route("coding_complex", primary, priority=10)
    await make_route("coding_complex", backup, priority=20)

    await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )

    async with SessionLocal() as session:
        windows = list(
            (await session.execute(select(QuotaWindow).where(QuotaWindow.agent_id == primary.id))).scalars()
        )
    assert len(windows) == 1
    assert windows[0].is_exhausted is True
    # retry_after 120 detik dari adapter dipakai sebagai cooldown
    assert (windows[0].window_end - windows[0].window_start).total_seconds() == pytest.approx(120, abs=5)


async def test_exhausted_target_is_skipped_without_running(user, make_agent, make_route, tmp_path):
    primary = await make_agent("primary", behaviour="ok")
    backup = await make_agent("backup", behaviour="ok")
    await make_route("coding_complex", primary, priority=10)
    await make_route("coding_complex", backup, priority=20)

    from datetime import timedelta

    from app.orchestrator.quota import now

    async with SessionLocal() as session:
        session.add(
            QuotaWindow(
                user_id=user.id,
                agent_id=primary.id,
                model=primary.default_model,
                window_type="cooldown",
                window_start=now(),
                window_end=now() + timedelta(hours=1),
                is_exhausted=True,
            )
        )
        await session.commit()

    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )

    assert task.status == "ok"
    assert [c["agent"] for c in FakeAdapter.calls] == ["backup"], "target mentok tidak boleh dijalankan"


async def test_quality_floor_blocks_weak_target(user, make_agent, make_route, tmp_path):
    """PRD §6.2: lebih baik berhenti daripada memakai model di bawah ambang."""
    weak = await make_agent("weak", model="groq/llama-3.1-8b-instant", behaviour="ok")
    await make_route("coding_complex", weak, priority=10)

    task = await run_task(
        user_id=user.id,
        prompt="x",
        category="coding_complex",
        quality_floor="strong",
        project_path=str(tmp_path),
    )

    assert task.status == "halted"
    assert FakeAdapter.calls == []
    messages = [e.data.get("message", "") for e in await events_for(task.id) if e.type == "status"]
    assert any("di bawah batas mutu" in m for m in messages)


async def test_halts_cleanly_when_all_targets_exhausted(user, make_agent, make_route, tmp_path):
    """PRD §6.3: berhenti bersih dengan laporan, bukan loop."""
    a = await make_agent("a", behaviour="rate_limit")
    b = await make_agent("b", behaviour="rate_limit")
    await make_route("coding_complex", a, priority=10)
    await make_route("coding_complex", b, priority=20)

    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )

    assert task.status == "halted"
    assert len(FakeAdapter.calls) == 2, "tiap target dicoba tepat sekali — tidak ada loop"
    messages = [e.data.get("message", "") for e in await events_for(task.id) if e.type == "status"]
    assert any("eksekusi tertahan" in m for m in messages)


async def test_fallback_restarts_from_plan_artifact(user, make_agent, make_route, tmp_path):
    """PRD §6.1: titik-ulang berbasis plan, bukan state internal agent."""
    primary = await make_agent("primary", behaviour="rate_limit")
    backup = await make_agent("backup", behaviour="ok")
    await make_route("coding_complex", primary, priority=10)
    await make_route("coding_complex", backup, priority=20)

    plan = "1. ubah app/auth.py\n2. tambah test\nkriteria selesai: test hijau"
    await run_task(
        user_id=user.id,
        prompt="kerjakan auth",
        category="coding_complex",
        plan_artifact=plan,
        project_path=str(tmp_path),
    )

    first, second = FakeAdapter.calls
    assert first["prompt"] == "kerjakan auth", "target pertama pakai prompt asli"
    assert plan in second["prompt"], "fallback membawa artefak plan"
    assert "kerjakan auth" in second["prompt"]


async def test_no_routing_rule_halts_with_explanation(user, tmp_path):
    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )
    assert task.status == "halted"
    messages = [e.data.get("message", "") for e in await events_for(task.id) if e.type == "status"]
    assert any("tidak ada routing rule" in m for m in messages)


async def test_usage_recorded_even_when_attempt_fails(user, make_agent, make_route, tmp_path):
    """Token yang sudah terpakai tetap dicatat walau attempt-nya kena limit."""
    primary = await make_agent("primary", behaviour="rate_limit")
    await make_route("coding_complex", primary, priority=10)

    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )

    entries = await logs_for(task.id)
    assert entries[0].usage["total_tokens"] == 150
    async with SessionLocal() as session:
        window = (
            await session.execute(select(QuotaWindow).where(QuotaWindow.agent_id == primary.id))
        ).scalar_one()
    assert window.tokens_used == 150


async def test_interactive_mode_never_skips_permissions(user, make_agent, make_route, tmp_path):
    agent = await make_agent("primary", behaviour="ok")
    await make_route("coding_complex", agent, priority=10)

    await run_task(
        user_id=user.id,
        prompt="x",
        category="coding_complex",
        mode="interactive",
        project_path=str(tmp_path),
    )
    assert FakeAdapter.calls[0]["permission_mode"] == "safe"


async def test_partial_events_are_not_persisted(user, make_agent, make_route, tmp_path):
    agent = await make_agent("primary", behaviour="ok")
    await make_route("coding_complex", agent, priority=10)
    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )
    stored = await events_for(task.id)
    assert stored, "event non-partial harus tersimpan untuk replay"
    assert all(not e.data.get("partial") for e in stored)

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
from app.models import Agent, QuotaWindow, RoutingRule, Task, TaskEvent, TaskLog
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
        cooldown = (
            await session.execute(
                select(QuotaWindow).where(
                    QuotaWindow.agent_id == primary.id, QuotaWindow.window_type == "cooldown"
                )
            )
        ).scalar_one()
    assert cooldown.is_exhausted is True
    # retry_after 120 detik dari adapter dipakai sebagai cooldown
    assert (cooldown.window_end - cooldown.window_start).total_seconds() == pytest.approx(120, abs=5)


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
            await session.execute(
                select(QuotaWindow).where(
                    QuotaWindow.agent_id == primary.id, QuotaWindow.window_type != "cooldown"
                )
            )
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


async def test_run_cascade_returns_none_when_targets_exhausted(user, make_agent, make_route, tmp_path):
    """T10: _run_cascade mengembalikan attempt=None saat semua target habis, dan TIDAK menyentuh status task."""
    a = await make_agent("a", behaviour="rate_limit")
    await make_route("coding_complex", a, priority=10)

    async with SessionLocal() as session:
        task = Task(user_id=user.id, prompt="test prompt", category="coding_complex", status="queued", project_path=str(tmp_path))
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = task.id

    targets = [runner_module.Target(agent=a, model=a.default_model, priority=10)]
    from app.orchestrator.isolation import Workspace
    ws = Workspace(path=str(tmp_path), isolated=False)
    ctx = runner_module.RunContext(
        task_id=task_id,
        user_id=user.id,
        category="coding_complex",
        mode="interactive",
        permission_mode="safe",
        workspace=ws,
    )

    result = await runner._run_cascade(ctx, targets=targets, prompt="test prompt", quality_floor=None)
    assert result.attempt is None

    # Status task di DB harus TETAP queued (karena _run_cascade tidak memanggil _finish)
    async with SessionLocal() as session:
        db_task = await session.get(Task, task_id)
        assert db_task.status == "queued"


# ------------------------------------------------- boundary multi-user (Fase 5a)


async def _agent_for(owner, name: str, **config) -> Agent:
    async with SessionLocal() as session:
        agent = Agent(
            user_id=owner.id,
            name=name,
            adapter_type="claude_code",
            default_model="sonnet",
            config=config,
            is_active=True,
        )
        session.add(agent)
        await session.commit()
        return agent


async def _quota_rows() -> list[QuotaWindow]:
    async with SessionLocal() as session:
        return list((await session.execute(select(QuotaWindow))).scalars())


async def _attempt_as(user_obj, agent: Agent, tmp_path):
    """Jalankan satu attempt atas nama `user_obj` memakai `agent` apa pun."""
    from app.orchestrator.isolation import Workspace

    async with SessionLocal() as session:
        task = Task(
            user_id=user_obj.id,
            prompt="x",
            category="coding_complex",
            status="running",
            project_path=str(tmp_path),
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = task.id

    return await runner._run_attempt(
        task_id,
        user_id=user_obj.id,
        agent=agent,
        target=runner_module.Target(agent=agent, model="sonnet", priority=0),
        prompt="x",
        permission_mode="safe",
        workspace=Workspace(path=str(tmp_path), isolated=False),
    )


async def test_task_never_routes_to_other_users_agent(user, user_b, tmp_path):
    """F1 end-to-end: satu-satunya rule milik user lain → tugas berhenti bersih
    dan agent user lain tidak pernah dijalankan (= pooling tertutup)."""
    agent_b = await _agent_for(user_b, "agent_b", behaviour="ok")
    async with SessionLocal() as session:
        session.add(RoutingRule(category="coding_complex", agent_id=agent_b.id, priority=10))
        await session.commit()

    task = await run_task(
        user_id=user.id, prompt="x", category="coding_complex", project_path=str(tmp_path)
    )

    assert task.status == "halted"
    assert FakeAdapter.calls == [], "agent milik user lain tidak boleh dijalankan"


async def test_pinned_agent_from_other_user_is_ignored(
    user, user_b, make_agent, make_route, tmp_path
):
    """F1 turunan: pinned_agent_id milik user lain tidak disisipkan ke cascade."""
    own = await make_agent("own", behaviour="ok")
    await make_route("coding_complex", own, priority=10)
    foreign = await _agent_for(user_b, "foreign", behaviour="ok")

    task = await run_task(
        user_id=user.id,
        prompt="x",
        category="coding_complex",
        project_path=str(tmp_path),
        pinned_agent_id=foreign.id,
    )

    assert task.status == "ok"
    assert [c["agent"] for c in FakeAdapter.calls] == ["own"]


async def test_cooldown_recorded_for_task_owner_not_agent_owner(user, user_b, tmp_path):
    """F2: cooldown dicatat atas nama pemilik TUGAS.

    Dipanggil langsung ke `_run_attempt`: setelah F1 ditutup, kombinasi "agent
    milik orang lain" tidak lagi bisa dicapai lewat jalur normal — tapi
    `_run_attempt` tetap tidak boleh menyimpulkan identitas dari `agent.user_id`.
    """
    agent_b = await _agent_for(user_b, "agent_b", behaviour="rate_limit")

    attempt = await _attempt_as(user, agent_b, tmp_path)

    assert attempt.status == "rate_limited"
    rows = await _quota_rows()
    assert rows, "cooldown harus tercatat"
    assert {r.user_id for r in rows} == {user.id}


async def test_usage_recorded_for_task_owner_not_agent_owner(user, user_b, tmp_path):
    """F2: konsumsi token juga atas nama pemilik tugas."""
    agent_b = await _agent_for(user_b, "agent_b", behaviour="ok")

    attempt = await _attempt_as(user, agent_b, tmp_path)

    assert attempt.status == "ok"
    rows = await _quota_rows()
    assert {r.user_id for r in rows} == {user.id}
    assert sum(r.tokens_used for r in rows) == 150


"""Smart Orchestrator (PRD §5, §6).

Alur per tugas:
    Tugas → klasifikasi → target berurut priority → cek kuota → run adapter
          → tangkap usage → log + update kuota → (kalau mentok) target berikutnya

Tiga keputusan yang bikin cascade andal (PRD §6):
  1. Titik-ulang berbasis plan — fallback mengulang dari artefak plan yang bersih,
     bukan dari state internal agent (yang tak bisa dioper antar harness).
  2. Batas bawah kualitas per step — target di bawah ambang mutu dilewati.
  3. Perilaku berhenti bersih — di ujung rantai, lapor 'halted' + plan tersimpan.
     Tidak pernah loop.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.registry import adapter_can_execute, build_adapter
from app.config import get_settings
from app.db import session_scope
from app.events import ERROR_CRASH, ERROR_RATE_LIMIT, Event
from app.models import Agent, Task, TaskEvent, TaskLog, User
from app.orchestrator import quota
from app.orchestrator.bus import bus
from app.orchestrator.isolation import (
    IsolationError,
    Workspace,
    cleanup_workspace,
    prepare_workspace,
)
from app.orchestrator.quality import meets_floor
from app.orchestrator.router import Target, resolve_targets

# Kategori yang tidak butuh "tangan" (boleh dijalankan model mentah). PRD §3.
BRAIN_ONLY_CATEGORIES = {"text_planning"}


@dataclass(slots=True)
class Attempt:
    target: Target
    status: str = "error"
    usage: dict[str, Any] = field(default_factory=dict)
    output: str = ""
    session_id: str | None = None
    error: Event | None = None


@dataclass(slots=True)
class RunHandle:
    task_id: int
    task: asyncio.Task
    adapter: Any = None
    cancelled: bool = False


@dataclass(slots=True)
class RunContext:
    """Nilai yang tetap sepanjang satu tugas, apa pun step-nya."""
    task_id: int
    user_id: int
    category: str
    mode: str
    permission_mode: str
    workspace: Workspace
    plan_artifact: str | None = None
    resume_session_id: str | None = None
    credential_home: str | None = None


@dataclass(slots=True)
class CascadeResult:
    attempt: Attempt | None      # attempt yang sukses; None kalau rantai habis
    skipped: list[str] = field(default_factory=list)


class TaskRunner:
    """Menjalankan tugas di background dan menyiarkan event ke bus."""

    def __init__(self) -> None:
        self._running: dict[int, RunHandle] = {}
        self._seq: dict[int, int] = {}
        self._event_buffer: dict[int, list[TaskEvent]] = {}
        self._semaphore: asyncio.Semaphore | None = None

    # ---------- kontrol ----------

    def is_running(self, task_id: int) -> bool:
        handle = self._running.get(task_id)
        return handle is not None and not handle.task.done()

    def start(self, task_id: int) -> None:
        if self.is_running(task_id):
            raise RuntimeError(f"task {task_id} sudah berjalan")
        aio_task = asyncio.create_task(self._guarded(task_id), name=f"choros-task-{task_id}")
        self._running[task_id] = RunHandle(task_id=task_id, task=aio_task)

    async def cancel(self, task_id: int) -> bool:
        handle = self._running.get(task_id)
        if handle is None or handle.task.done():
            return False
        handle.cancelled = True
        if handle.adapter is not None:
            with contextlib.suppress(Exception):
                await handle.adapter.cancel()
        handle.task.cancel()
        return True

    async def shutdown(self) -> None:
        for task_id in list(self._running):
            await self.cancel(task_id)

    async def recover_interrupted_tasks(self) -> int:
        """Pindai tugas berstatus 'queued' atau 'running' saat startup, dan ubah status ke 'interrupted'."""
        count = 0
        async with session_scope() as session:
            stmt = select(Task).where(Task.status.in_(["queued", "running"]))
            tasks = (await session.execute(stmt)).scalars().all()
            for task in tasks:
                old_status = task.status
                task.status = "interrupted"
                task.finished_at = datetime.now(UTC)
                count += 1
                max_seq_stmt = select(func.coalesce(func.max(TaskEvent.seq), 0)).where(
                    TaskEvent.task_id == task.id
                )
                max_seq = (await session.execute(max_seq_stmt)).scalar() or 0
                session.add(
                    TaskEvent(
                        task_id=task.id,
                        seq=max_seq + 1,
                        type="status",
                        data={
                            "message": f"Tugas terinterupsi dari status '{old_status}' (restart server/orchestrator)"
                        },
                    )
                )
            await session.commit()
        return count

    # ---------- eksekusi ----------

    async def _guarded(self, task_id: int) -> None:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(get_settings().max_concurrent_tasks)

        try:
            if self._semaphore.locked():
                max_tasks = get_settings().max_concurrent_tasks
                queue_pos = max(1, len(self._running) - max_tasks)
                await self._emit(
                    task_id,
                    Event.status(
                        f"menunggu antrean konkurensi... (posisi #{queue_pos})",
                        transition="queued",
                        position=queue_pos,
                    ),
                )
            async with self._semaphore:
                await self._execute(task_id)
        except asyncio.CancelledError:
            await self._emit(task_id, Event.status("tugas dibatalkan", transition="cancelled"))
            await self._finish(task_id, status="cancelled")
            raise
        except Exception as exc:  # jangan pernah mati diam-diam
            await self._emit(task_id, Event.error("crash", f"orchestrator gagal: {exc!r}"))
            await self._finish(task_id, status="error")
        finally:
            await self._flush_events(task_id)
            bus.close(task_id)
            self._running.pop(task_id, None)
            self._seq.pop(task_id, None)

    async def _execute(self, task_id: int) -> None:
        settings = get_settings()

        async with session_scope() as session:
            task = await session.get(Task, task_id)
            if task is None:
                return
            task.status = "running"
            await session.commit()

            # user_id dibaca lebih dulu: routing wajib disaring pemilik tugas
            user_id = task.user_id
            owner = await session.get(User, user_id)
            credential_home = owner.credential_home if owner else None
            targets = await resolve_targets(session, task.category, user_id=user_id)
            category = task.category
            mode = task.mode
            prompt = task.prompt
            quality_floor = task.quality_floor
            plan_artifact = task.plan_artifact
            project_path = task.project_path or settings.default_project_path
            allow_unisolated = bool(task.allow_unisolated)
            resume_session_id = task.resume_session_id
            owns_workspace = task.owns_workspace if task.owns_workspace is not None else True
            workflow_run_id = task.workflow_run_id
            existing_workspace_path = task.workspace_path

            # Workflow step: resolve targets dari step JSONB kalau ada
            if workflow_run_id is not None and task.step_order is not None:
                from app.models import WorkflowRun, WorkflowStep
                from app.orchestrator.router import resolve_step_targets
                run = await session.get(WorkflowRun, workflow_run_id)
                if run is not None:
                    step = (
                        await session.execute(
                            select(WorkflowStep).where(
                                WorkflowStep.workflow_id == run.workflow_id,
                                WorkflowStep.step_order == task.step_order,
                            )
                        )
                    ).scalar_one_or_none()
                    if step is not None:
                        step_targets = await resolve_step_targets(
                            session, step, category, user_id=user_id
                        )
                        if step_targets:
                            targets = step_targets

            # Follow-up: sesi hanya bisa dilanjutkan di harness yang sama, jadi
            # agent itu dinaikkan ke urutan pertama. Kalau tetap gagal, cascade
            # normal jalan dari artefak plan (§6.1).
            if task.pinned_agent_id:
                targets.sort(key=lambda t: (t.agent.id != task.pinned_agent_id, t.priority))
                if not targets or targets[0].agent.id != task.pinned_agent_id:
                    pinned = await session.get(Agent, task.pinned_agent_id)
                    if pinned is not None and pinned.is_active and pinned.user_id == user_id:
                        targets.insert(
                            0, Target(agent=pinned, model=pinned.default_model, priority=0)
                        )

        await self._emit(
            task_id,
            Event.status(
                f"kategori '{category}' → {len(targets)} target terdaftar",
                targets=[t.label for t in targets],
            ),
        )

        if not targets:
            await self._emit(
                task_id,
                Event.status(
                    f"tidak ada routing rule untuk kategori '{category}'. "
                    "Tambahkan target di halaman Routing.",
                    transition="chain_exhausted",
                    reason="no_route",
                ),
            )
            await self._finish(task_id, status="halted")
            if workflow_run_id:
                await self._advance_workflow(workflow_run_id)
            return

        # --- ruang kerja (isolasi untuk mode otonom) ---
        # §3.4: kalau owns_workspace=False, pakai workspace dari run (jangan buat baru)
        if not owns_workspace and existing_workspace_path:
            workspace = Workspace(
                path=existing_workspace_path,
                isolated=True,
                branch=None,
                note="workspace bersama dari workflow run",
            )
        else:
            try:
                workspace = await prepare_workspace(
                    project_path,
                    task_id=task_id,
                    mode=mode,
                    allow_unisolated=allow_unisolated,
                )
            except IsolationError as exc:
                await self._emit(task_id, Event.error("crash", str(exc)))
                await self._finish(task_id, status="halted")
                if workflow_run_id:
                    await self._advance_workflow(workflow_run_id)
                return

        if workspace.note:
            await self._emit(task_id, Event.status(workspace.note, workspace=workspace.path))
        async with session_scope() as session:
            task = await session.get(Task, task_id)
            if task is not None:
                task.workspace_path = workspace.path
                await session.commit()

        permission_mode = "autonomous" if mode == "autonomous" else "safe"
        ctx = RunContext(
            task_id=task_id,
            user_id=user_id,
            category=category,
            mode=mode,
            permission_mode=permission_mode,
            workspace=workspace,
            plan_artifact=plan_artifact,
            resume_session_id=resume_session_id,
            credential_home=credential_home,
        )

        try:
            result = await self._run_cascade(
                ctx,
                targets=targets,
                prompt=prompt,
                quality_floor=quality_floor,
            )

            if result.attempt:
                await self._finish(
                    task_id,
                    status="ok",
                    output=result.attempt.output,
                    session_id=result.attempt.session_id,
                )
                await self._emit(
                    task_id,
                    Event.status(
                        f"tugas selesai lewat {result.attempt.target.label}",
                        transition="done",
                        target=result.attempt.target.label,
                    ),
                )
            else:
                await self._finish(task_id, status="halted")
        finally:
            # cleanup hanya kalau owns_workspace dan mode non-otonom
            if owns_workspace and mode != "autonomous":
                await cleanup_workspace(project_path, workspace, remove=True)

        # Setelah task selesai, majukan workflow run kalau ini step task
        if workflow_run_id:
            await self._advance_workflow(workflow_run_id)

    async def _advance_workflow(self, workflow_run_id: int) -> None:
        """Majukan workflow run setelah step task selesai."""
        try:
            from app.orchestrator.workflow import advance_run
            await advance_run(workflow_run_id)
        except Exception as exc:
            import logging
            logging.getLogger("choros").error(
                "gagal memajukan workflow run %d: %s", workflow_run_id, exc
            )

    async def _run_cascade(
        self,
        ctx: RunContext,
        *,
        targets: list[Target],
        prompt: str,
        quality_floor: str | None,
    ) -> CascadeResult:
        needs_hands = ctx.category not in BRAIN_ONLY_CATEGORIES
        skipped: list[str] = []
        # reset kuota terdekat yang ditemui — dipakai pesan halted supaya countdown
        # di Console sama dengan yang ditampilkan halaman Quota.
        earliest_reset: datetime | None = None

        for index, target in enumerate(targets):
            agent = target.agent

            # [2] batas bawah kualitas (PRD §6.2)
            tier_override = (agent.config or {}).get("tier")
            if not meets_floor(target.model, quality_floor, override=tier_override):
                reason = f"di bawah batas mutu '{quality_floor}'"
                skipped.append(f"{target.label} ({reason})")
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        f"lewati {target.label}: {reason}",
                        transition="target_skipped",
                        target=target.label,
                        attempt=index + 1,
                        reason="< quality_floor",
                    ),
                )
                continue

            # tangan vs otak (PRD §3)
            if needs_hands and not adapter_can_execute(agent.adapter_type):
                reason = "model mentah tanpa tangan, kategori ini butuh eksekusi"
                skipped.append(f"{target.label} ({reason})")
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        f"lewati {target.label}: {reason}",
                        transition="target_skipped",
                        target=target.label,
                        attempt=index + 1,
                        reason="tanpa tangan",
                    ),
                )
                continue

            # [3] cek kuota
            async with session_scope() as session:
                exhausted, until = await quota.is_exhausted(
                    session, user_id=ctx.user_id, agent_id=agent.id, model=target.model
                )
            if exhausted:
                reason = f"kuota mentok sampai {until:%H:%M %d/%m}" if until else "kuota mentok"
                skipped.append(f"{target.label} ({reason})")
                if until is not None and (earliest_reset is None or until < earliest_reset):
                    earliest_reset = until
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        f"lewati {target.label}: {reason}",
                        transition="target_skipped",
                        target=target.label,
                        attempt=index + 1,
                        reason="exhausted",
                        reset_at=until.isoformat() if until else None,
                    ),
                )
                continue

            # [1] titik-ulang berbasis plan
            attempt_prompt = prompt
            if index > 0:
                attempt_prompt = _rebuild_prompt(prompt, ctx.plan_artifact)
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        "fallback: mengulang dari artefak plan"
                        if ctx.plan_artifact
                        else "fallback: mengulang dari prompt awal (tidak ada artefak plan)"
                    ),
                )

            await self._emit(
                ctx.task_id,
                Event.status(
                    f"menjalankan {target.label} (prioritas {target.priority})",
                    agent=agent.name,
                    model=target.model,
                    transition="target_started",
                    target=target.label,
                    attempt=index + 1,
                    priority=target.priority,
                    plan_reused=index > 0,
                ),
            )

            # resume hanya sah pada attempt pertama di agent yang memegang sesinya
            attempt_resume = ctx.resume_session_id if index == 0 else None

            attempt = await self._run_attempt(
                ctx.task_id,
                user_id=ctx.user_id,
                agent=agent,
                target=target,
                prompt=attempt_prompt,
                permission_mode=ctx.permission_mode,
                workspace=ctx.workspace,
                resume_session_id=attempt_resume,
                credential_home=ctx.credential_home,
            )

            await self._log_attempt(
                ctx.task_id,
                user_id=ctx.user_id,
                agent_id=agent.id,
                model=target.model,
                category=ctx.category,
                mode=ctx.mode,
                attempt=attempt,
            )

            if attempt.status == "ok":
                return CascadeResult(attempt=attempt, skipped=skipped)

            if attempt.status == "rate_limited":
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        f"{target.label} mentok kuota → lanjut target berikutnya",
                        transition="target_failed",
                        target=target.label,
                        attempt=index + 1,
                        reason="429 / limit",
                    ),
                )
            else:
                detail = (attempt.error.data.get("message") if attempt.error else "") or ""
                await self._emit(
                    ctx.task_id,
                    Event.status(
                        f"{target.label} gagal ({attempt.status}) → lanjut target berikutnya",
                        detail=detail[:400],
                        transition="target_failed",
                        target=target.label,
                        attempt=index + 1,
                        reason=attempt.status,
                    ),
                )

        # ujung rantai — berhenti bersih, bukan loop (PRD §6.3)
        await self._emit(
            ctx.task_id,
            Event.status(
                "eksekusi tertahan: semua target habis. Plan & log tersimpan, "
                "jalankan ulang setelah kuota reset.",
                skipped=skipped,
                transition="chain_exhausted",
                reset_at=earliest_reset.isoformat() if earliest_reset else None,
            ),
        )
        return CascadeResult(attempt=None, skipped=skipped)

    async def _run_attempt(
        self,
        task_id: int,
        *,
        user_id: int,
        agent: Agent,
        target: Target,
        prompt: str,
        permission_mode: str,
        workspace: Workspace,
        resume_session_id: str | None = None,
        credential_home: str | None = None,
    ) -> Attempt:
        attempt = Attempt(target=target)
        adapter = build_adapter(agent, home=credential_home)

        handle = self._running.get(task_id)
        if handle is not None:
            handle.adapter = adapter

        try:
            await adapter.ensure_trusted(workspace.path)
        except Exception as exc:
            await self._emit(task_id, Event.status(f"pre-seed trust gagal (lanjut): {exc}"))

        outputs: list[str] = []
        final_output: str | None = None
        usage_total: dict[str, Any] = {}

        stream = adapter.run(
            prompt,
            model=target.model,
            permission_mode=permission_mode,
            project_path=workspace.path,
            resume_session_id=resume_session_id,
        )

        try:
            async for event in stream:
                await self._emit(task_id, event)

                if event.type == "usage":
                    usage_total = _merge_usage(usage_total, event.data)
                elif event.type == "output":
                    if event.data.get("final"):
                        final_output = event.data.get("text", "")
                    elif not event.data.get("partial"):
                        outputs.append(event.data.get("text", ""))
                elif event.type == "status" and event.data.get("session_id"):
                    attempt.session_id = event.data["session_id"]
                elif event.type == "error":
                    attempt.error = event
                    if event.is_cascade_trigger:
                        break
        except Exception as exc:
            # Adapter yang meledak di luar kontrak Event adalah satu target yang
            # mati, bukan tugas yang mati — cascade justru ada untuk ini.
            # (CancelledError turunan BaseException, jadi pembatalan tetap lewat.)
            crash = Event.error(
                ERROR_CRASH,
                f"adapter {agent.name} gagal: {exc!r}",
                agent=agent.name,
                model=target.model,
            )
            await self._emit(task_id, crash)
            attempt.error = crash

        attempt.usage = usage_total
        attempt.output = final_output if final_output is not None else "\n".join(outputs).strip()

        if attempt.error is not None and attempt.error.is_cascade_trigger:
            kind = attempt.error.data.get("kind")
            if kind == ERROR_RATE_LIMIT:
                attempt.status = "rate_limited"
                async with session_scope() as session:
                    await quota.mark_exhausted(
                        session,
                        user_id=user_id,
                        agent_id=agent.id,
                        model=target.model,
                        retry_after_seconds=attempt.error.data.get("retry_after"),
                        default_cooldown_minutes=get_settings().default_cooldown_minutes,
                    )
                    await session.commit()
            else:
                attempt.status = "error"
        elif attempt.error is not None:
            attempt.status = "error"
        else:
            attempt.status = "ok"

        # konsumsi tetap dicatat walau attempt gagal — token sudah terpakai
        tokens = int(usage_total.get("total_tokens") or 0)
        if tokens:
            async with session_scope() as session:
                await quota.record_usage(
                    session,
                    user_id=user_id,
                    agent_id=agent.id,
                    model=target.model,
                    tokens=tokens,
                    window_type=(agent.config or {}).get("window_type", "daily"),
                    token_limit=agent.token_limit,
                )
                await session.commit()

        return attempt

    # ---------- persistensi + siaran ----------

    async def _emit(self, task_id: int, event: Event) -> None:
        seq = self._seq.get(task_id, 0) + 1
        self._seq[task_id] = seq
        bus.publish(task_id, {"seq": seq, **event.as_dict()})
        if event.data.get("partial"):
            return
        buf = self._event_buffer.setdefault(task_id, [])
        buf.append(
            TaskEvent(
                task_id=task_id,
                seq=seq,
                type=event.type,
                agent=event.agent,
                model=event.model,
                data=event.data,
            )
        )
        if len(buf) >= 20:
            await self._flush_events(task_id)

    async def _flush_events(self, task_id: int) -> None:
        buf = self._event_buffer.pop(task_id, None)
        if not buf:
            return
        async with session_scope() as session:
            session.add_all(buf)
            await session.commit()

    async def _log_attempt(
        self,
        task_id: int,
        *,
        user_id: int,
        agent_id: int,
        model: str | None,
        category: str,
        mode: str,
        attempt: Attempt,
    ) -> None:
        async with session_scope() as session:
            session.add(
                TaskLog(
                    user_id=user_id,
                    task_id=task_id,
                    agent_id=agent_id,
                    model=model,
                    category=category,
                    mode=mode,
                    status=attempt.status,
                    usage=attempt.usage or {},
                )
            )
            await session.commit()

    async def _finish(
        self,
        task_id: int,
        *,
        status: str,
        output: str | None = None,
        session_id: str | None = None,
    ) -> None:
        async with session_scope() as session:
            task = await session.get(Task, task_id)
            if task is None:
                return
            task.status = status
            task.finished_at = datetime.now(UTC)
            if output:
                task.final_output = output
            if session_id:
                task.last_session_id = session_id
            await session.commit()


    def get_buffered_events(self, task_id: int) -> list[TaskEvent]:
        return list(self._event_buffer.get(task_id, []))


def _rebuild_prompt(prompt: str, plan_artifact: str | None) -> str:
    """Titik-ulang berbasis plan (PRD §6.1).

    State internal agent tidak bisa dioper antar harness, jadi target berikutnya
    memulai dari artefak plan yang self-contained — bukan dari transkrip.
    """
    if not plan_artifact:
        return prompt
    return (
        f"{prompt}\n\n"
        "---\n"
        "Catatan orchestrator: target sebelumnya berhenti sebelum selesai. "
        "Lanjutkan berdasarkan plan berikut, dan periksa dulu bagian mana yang "
        "sudah dikerjakan di working directory sebelum mengubah apa pun.\n\n"
        f"{plan_artifact}"
    )


def _merge_usage(acc: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Gabungkan usage.

    Counter token dari harness umumnya kumulatif per sesi (Claude: `result.usage`
    adalah total sesi), jadi mengambil nilai terbesar menghindari hitung ganda.
    Biaya diambil yang terbesar dengan alasan yang sama.
    """
    merged = dict(acc)
    for key, value in new.items():
        if isinstance(value, (int, float)):
            merged[key] = max(merged.get(key, 0) or 0, value)
        else:
            merged[key] = value
    return merged


async def load_task_events(session: AsyncSession, task_id: int) -> list[dict[str, Any]]:
    stmt = select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.seq)
    rows = (await session.execute(stmt)).scalars()
    events = [
        {
            "seq": row.seq,
            "type": row.type,
            "agent": row.agent,
            "model": row.model,
            "ts": row.created_at.timestamp() if row.created_at else None,
            "data": row.data,
        }
        for row in rows
    ]

    # Gabungkan event in-memory yang belum sempat ter-flush ke DB agar replay SSE 100% utuh
    buffered = runner.get_buffered_events(task_id)
    if buffered:
        existing_seqs = {e["seq"] for e in events}
        for te in buffered:
            if te.seq not in existing_seqs:
                events.append({
                    "seq": te.seq,
                    "type": te.type,
                    "agent": te.agent,
                    "model": te.model,
                    "ts": te.created_at.timestamp() if te.created_at else None,
                    "data": te.data,
                })
        events.sort(key=lambda x: x["seq"])

    return events


runner = TaskRunner()

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select

from app.models import Project, Task, TaskEvent, TaskGroup, TaskLog, TaskRun
from app.orchestrator.bus import END, bus
from app.orchestrator.isolation import (
    discard_workspace_branch,
    get_workspace_diff,
    merge_workspace_branch,
)
from app.orchestrator.router import CATEGORIES, CATEGORY_LABELS, classify
from app.orchestrator.runner import load_task_events, runner
from app.schemas import (
    ArtifactCandidatesOut, DelegateIn, FollowUpIn,
    MdFileOut, SelectWinnerIn, TaskIn, TaskLogOut, TaskOut
)
from app.security import CurrentUser, DbSession
import os
from typing import Literal

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/categories")
async def list_categories() -> list[dict[str, str]]:
    return [{"value": c, "label": CATEGORY_LABELS.get(c, c)} for c in CATEGORIES]


async def _run_folder(task_run_id: int | None, session: DbSession) -> str | None:
    if not task_run_id:
        return None
    task_run = await session.get(TaskRun, task_run_id)
    if not task_run:
        return None
    task_group = await session.get(TaskGroup, task_run.task_group_id)
    if not task_group:
        return None
    project = await session.get(Project, task_group.project_id)
    if not project:
        return None
    return project.folder_path


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(payload: TaskIn, user: CurrentUser, session: DbSession) -> Task:
    category = classify(payload.prompt, payload.category)
    
    project_path = payload.project_path
    if not project_path:
        project_path = await _run_folder(payload.task_run_id, session)
        
    task = Task(
        user_id=user.id,
        prompt=payload.prompt,
        category=category,
        mode=payload.mode,
        project_path=project_path,
        quality_floor=payload.quality_floor,
        plan_artifact=payload.plan_artifact,
        allow_unisolated=payload.allow_unisolated,
        status="queued",
        task_run_id=payload.task_run_id,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    runner.start(task.id)
    return task


@router.get("", response_model=list[TaskOut])
async def list_tasks(user: CurrentUser, session: DbSession, limit: int = 50) -> list[Task]:
    stmt = (
        select(Task)
        .where(Task.user_id == user.id)
        .order_by(desc(Task.created_at), desc(Task.id))
        .limit(min(limit, 200))
    )
    return list((await session.execute(stmt)).scalars())


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, user: CurrentUser, session: DbSession) -> Task:
    task = await _owned_task(task_id, user, session)
    return task


@router.get("/{task_id}/events")
async def get_task_events(task_id: int, user: CurrentUser, session: DbSession) -> list[dict[str, Any]]:
    await _owned_task(task_id, user, session)
    return await load_task_events(session, task_id)


@router.get("/{task_id}/logs", response_model=list[TaskLogOut])
async def get_task_logs(task_id: int, user: CurrentUser, session: DbSession) -> list[TaskLog]:
    await _owned_task(task_id, user, session)
    stmt = select(TaskLog).where(TaskLog.task_id == task_id).order_by(TaskLog.id)
    return list((await session.execute(stmt)).scalars())


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: int, user: CurrentUser, session: DbSession) -> dict[str, bool]:
    await _owned_task(task_id, user, session)
    return {"cancelled": await runner.cancel(task_id)}


@router.get("/{task_id}/diff")
async def get_task_diff(task_id: int, user: CurrentUser, session: DbSession) -> dict[str, Any]:
    task = await _owned_task(task_id, user, session)
    if task.mode != "autonomous" or not task.project_path:
        raise HTTPException(status_code=400, detail="tugas ini tidak memakai mode otonom terisolasi")
    return await get_workspace_diff(task.project_path, task.id, task.workspace_path)


@router.post("/{task_id}/merge")
async def merge_task_worktree(task_id: int, user: CurrentUser, session: DbSession) -> dict[str, Any]:
    task = await _owned_task(task_id, user, session)
    if task.mode != "autonomous" or not task.project_path:
        raise HTTPException(status_code=400, detail="tugas ini tidak memakai mode otonom terisolasi")
    ok, msg = await merge_workspace_branch(task.project_path, task.id, task.workspace_path)
    if not ok:
        raise HTTPException(status_code=409, detail=msg)
    return {"success": True, "message": msg}


@router.post("/{task_id}/discard")
async def discard_task_worktree(task_id: int, user: CurrentUser, session: DbSession) -> dict[str, Any]:
    task = await _owned_task(task_id, user, session)
    if task.mode != "autonomous" or not task.project_path:
        raise HTTPException(status_code=400, detail="tugas ini tidak memakai mode otonom terisolasi")
    ok, msg = await discard_workspace_branch(task.project_path, task.id, task.workspace_path)
    return {"success": ok, "message": msg}


@router.post("/{task_id}/reply", response_model=TaskOut, status_code=201)
async def reply_to_task(
    task_id: int, payload: FollowUpIn, user: CurrentUser, session: DbSession
) -> Task:
    """Jawaban user atas pertanyaan balik agent (PRD §8).

    Harness CLI dalam print-mode tidak menerima jawaban lewat stdin secara andal,
    jadi follow-up dijalankan sebagai tugas lanjutan yang me-resume sesi yang sama
    di agent yang sama — konteksnya utuh, tanpa mengulang dari nol.
    """
    parent = await _owned_task(task_id, user, session)
    if not parent.last_session_id:
        raise HTTPException(
            status_code=409,
            detail="tugas ini tidak punya sesi yang bisa dilanjutkan (belum ada attempt sukses)",
        )

    last_log = (
        await session.execute(
            select(TaskLog)
            .where(TaskLog.task_id == parent.id, TaskLog.status == "ok")
            .order_by(desc(TaskLog.id))
            .limit(1)
        )
    ).scalar_one_or_none()

    follow_up = Task(
        user_id=user.id,
        prompt=payload.answer,
        category=parent.category,
        mode=parent.mode,
        project_path=parent.workspace_path or parent.project_path,
        quality_floor=parent.quality_floor,
        plan_artifact=parent.plan_artifact,
        allow_unisolated=parent.allow_unisolated,
        parent_task_id=parent.id,
        resume_session_id=parent.last_session_id,
        pinned_agent_id=last_log.agent_id if last_log else None,
        status="queued",
    )
    session.add(follow_up)
    await session.commit()
    await session.refresh(follow_up)
    runner.start(follow_up.id)
    return follow_up


@router.get("/{task_id}/stream")
async def stream_task(task_id: int, request: Request, user: CurrentUser, session: DbSession):
    """SSE live console — replay event tersimpan lalu ikuti stream berjalan."""
    await _owned_task(task_id, user, session)
    history = await load_task_events(session, task_id)
    queue = bus.subscribe(task_id)
    still_running = runner.is_running(task_id)

    async def event_source():
        try:
            last_seq = 0
            for event in history:
                last_seq = max(last_seq, event.get("seq") or 0)
                yield _sse(event)
            if not still_running:
                yield _sse({"type": "eof", "data": {}})
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if item is END:
                    yield _sse({"type": "eof", "data": {}})
                    break
                if (item.get("seq") or 0) <= last_seq:
                    continue  # sudah terkirim lewat replay
                last_seq = item.get("seq") or last_seq
                yield _sse(item)
        finally:
            bus.unsubscribe(task_id, queue)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


async def _owned_task(task_id: int, user, session) -> Task:
    task = await session.get(Task, task_id)
    # boundary multi-user (PRD §4/§14): tugas user lain tidak pernah terlihat
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="task tidak ditemukan")
    return task


@router.get("/{task_id}/artifact-candidates", response_model=ArtifactCandidatesOut)
async def artifact_candidates(task_id: int, user: CurrentUser, session: DbSession):
    task = await _owned_task(task_id, user, session)
    final = task.final_output
    md_files = []
    
    if task.workspace_path:
        stmt = (
            select(TaskEvent)
            .where(TaskEvent.task_id == task.id)
            .where(TaskEvent.type == 'file_edit')
        )
        events = (await session.execute(stmt)).scalars().all()
        
        seen_paths = set()
        for e in events:
            path = e.data.get("path", "")
            if not path or not path.lower().endswith(".md"):
                continue
                
            if path in seen_paths:
                continue
            seen_paths.add(path)
            
            full_path = os.path.join(task.workspace_path, path)
            if os.path.exists(full_path):
                try:
                    with open(full_path, "r", encoding="utf-8") as f:
                        content = f.read(256 * 1024)  # limit 256KB
                    md_files.append(MdFileOut(path=path, content=content))
                except Exception:
                    pass
                    
    return ArtifactCandidatesOut(final_output=final, md_files=md_files)


def _delegate_prompt(artifact: str) -> str:
    return (
        "Kerjakan tugas berikut berdasarkan plan yang sudah disiapkan.\n\n"
        "--- PLAN ---\n" + artifact + "\n--- /PLAN ---\n\n"
        "Ikuti plan; bila ada langkah ambigu, ambil asumsi terbaik dan lanjut."
    )


@router.post("/{task_id}/delegate", response_model=TaskOut, status_code=201)
async def delegate_task(task_id: int, payload: DelegateIn, user: CurrentUser, session: DbSession):
    source = await _owned_task(task_id, user, session)
    prompt = _delegate_prompt(payload.artifact)
    task = Task(
        user_id=user.id,
        prompt=prompt,
        category=payload.to_category,
        mode=payload.mode,
        project_path=source.project_path,
        quality_floor=source.quality_floor,
        plan_artifact=payload.artifact,
        allow_unisolated=source.allow_unisolated,
        task_run_id=source.task_run_id,
        delegated_from_task_id=source.id,
        status="queued",
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    runner.start(task.id)
    return task


@router.post("/{task_id}/select-winner", response_model=TaskOut)
async def select_winner(
    task_id: int, payload: SelectWinnerIn, user: CurrentUser, session: DbSession
) -> Task:
    """Pilih cabang pemenang dari sebuah fan-out (Item C).

    Cabang lain dalam grup dibatalkan (kalau masih jalan) dan worktree-nya dibuang —
    tanpa ini, cabang yang kalah menumpuk sampai gc 7 hari. Bila `to_category` diisi,
    artifact pemenang langsung didelegasikan ke lane berikutnya (mekanik `delegate`).
    """
    winner = await _owned_task(task_id, user, session)
    if winner.fanout_group_id is None:
        raise HTTPException(status_code=400, detail="task ini bukan bagian dari fan-out")

    losers = (
        await session.execute(
            select(Task).where(
                Task.fanout_group_id == winner.fanout_group_id,
                Task.id != winner.id,
                Task.user_id == user.id,
            )
        )
    ).scalars().all()

    for loser in losers:
        await runner.cancel(loser.id)  # no-op kalau sudah selesai
        if loser.mode == "autonomous" and loser.project_path and loser.workspace_path:
            await discard_workspace_branch(loser.project_path, loser.id, loser.workspace_path)
        loser.status = "discarded"
        loser.finished_at = datetime.now(UTC)
    await session.commit()

    # Opsional: delegasikan artifact pemenang ke lane berikutnya.
    if payload.to_category:
        if not payload.artifact:
            raise HTTPException(status_code=400, detail="artifact wajib bila to_category diisi")
        delegated = Task(
            user_id=user.id,
            prompt=_delegate_prompt(payload.artifact),
            category=payload.to_category,
            mode=payload.mode,
            project_path=winner.project_path,
            quality_floor=winner.quality_floor,
            plan_artifact=payload.artifact,
            allow_unisolated=winner.allow_unisolated,
            task_run_id=winner.task_run_id,
            delegated_from_task_id=winner.id,
            status="queued",
        )
        session.add(delegated)
        await session.commit()
        await session.refresh(delegated)
        runner.start(delegated.id)

    await session.refresh(winner)
    return winner

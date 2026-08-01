from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Body, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Agent, Task, Workflow, WorkflowRun, WorkflowStep
from app.orchestrator.runner import runner
from app.schemas import (
    RunApprovalIn,
    WorkflowDetailOut,
    WorkflowIn,
    WorkflowOut,
    WorkflowRunDetailOut,
    WorkflowRunIn,
    WorkflowRunOut,
    WorkflowRunStepOut,
    WorkflowStepIn,
    WorkflowStepOut,
)
from app.security import CurrentUser, DbSession

router = APIRouter(prefix="/api", tags=["workflows"])


# ---------- helper kepemilikan ----------


async def _owned_workflow(workflow_id: int, user, session: AsyncSession) -> Workflow:
    wf = await session.get(Workflow, workflow_id)
    if wf is None or wf.user_id != user.id:
        raise HTTPException(status_code=404, detail="workflow tidak ditemukan")
    return wf


async def _owned_run(run_id: int, user, session: AsyncSession) -> WorkflowRun:
    run = await session.get(WorkflowRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="workflow run tidak ditemukan")
    return run


async def _validate_step_agent_ids(
    steps: list[WorkflowStepIn], user, session: AsyncSession
) -> None:
    """Validasi: setiap agent_id di targets JSONB harus milik user ini."""
    for step in steps:
        for entry in step.targets or []:
            agent_id = entry.get("agent_id")
            if agent_id is None:
                continue
            agent = await session.get(Agent, agent_id)
            if agent is None or agent.user_id != user.id:
                raise HTTPException(
                    status_code=403,
                    detail=f"agent_id {agent_id} tidak ditemukan atau bukan milik Anda",
                )


# ---------- CRUD workflow ----------


@router.get("/workflows", response_model=list[WorkflowOut])
async def list_workflows(user: CurrentUser, session: DbSession) -> list[Workflow]:
    stmt = select(Workflow).where(Workflow.user_id == user.id).order_by(Workflow.id)
    return list((await session.execute(stmt)).scalars())


@router.post("/workflows", response_model=WorkflowOut, status_code=201)
async def create_workflow(
    payload: WorkflowIn, user: CurrentUser, session: DbSession
) -> Workflow:
    await _validate_step_agent_ids(payload.steps, user, session)

    wf = Workflow(user_id=user.id, name=payload.name)
    session.add(wf)
    await session.flush()  # dapatkan wf.id

    for idx, step_in in enumerate(payload.steps):
        step = WorkflowStep(
            workflow_id=wf.id,
            step_order=idx,
            name=step_in.name,
            role_prompt=step_in.role_prompt,
            targets=step_in.targets or [],
            quality_floor=step_in.quality_floor,
            requires_approval=step_in.requires_approval,
            category=step_in.category,
        )
        session.add(step)

    await session.commit()
    await session.refresh(wf)
    return wf


@router.get("/workflows/{workflow_id}", response_model=WorkflowDetailOut)
async def get_workflow(
    workflow_id: int, user: CurrentUser, session: DbSession
) -> WorkflowDetailOut:
    wf = await _owned_workflow(workflow_id, user, session)
    steps = (
        await session.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == wf.id)
            .order_by(WorkflowStep.step_order)
        )
    ).scalars().all()
    return WorkflowDetailOut(
        id=wf.id,
        name=wf.name,
        created_at=wf.created_at,
        steps=[WorkflowStepOut.model_validate(s) for s in steps],
    )


@router.put("/workflows/{workflow_id}", response_model=WorkflowOut)
async def update_workflow(
    workflow_id: int, payload: WorkflowIn, user: CurrentUser, session: DbSession
) -> Workflow:
    wf = await _owned_workflow(workflow_id, user, session)
    await _validate_step_agent_ids(payload.steps, user, session)

    wf.name = payload.name

    # Hapus step lama
    old_steps = (
        await session.execute(
            select(WorkflowStep).where(WorkflowStep.workflow_id == wf.id)
        )
    ).scalars().all()
    for old in old_steps:
        await session.delete(old)

    # Tulis step baru
    for idx, step_in in enumerate(payload.steps):
        step = WorkflowStep(
            workflow_id=wf.id,
            step_order=idx,
            name=step_in.name,
            role_prompt=step_in.role_prompt,
            targets=step_in.targets or [],
            quality_floor=step_in.quality_floor,
            requires_approval=step_in.requires_approval,
            category=step_in.category,
        )
        session.add(step)

    await session.commit()
    await session.refresh(wf)
    return wf


@router.delete("/workflows/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: int, user: CurrentUser, session: DbSession
) -> None:
    wf = await _owned_workflow(workflow_id, user, session)

    # Tolak kalau ada run aktif
    active_runs = (
        await session.execute(
            select(WorkflowRun).where(
                WorkflowRun.workflow_id == wf.id,
                WorkflowRun.status.in_(["queued", "running", "awaiting_approval"]),
            )
        )
    ).scalars().all()
    if active_runs:
        raise HTTPException(
            status_code=409,
            detail=f"workflow masih punya {len(active_runs)} run aktif; "
            "selesaikan atau batalkan dulu",
        )

    # Hapus step dulu (FK)
    steps = (
        await session.execute(
            select(WorkflowStep).where(WorkflowStep.workflow_id == wf.id)
        )
    ).scalars().all()
    for s in steps:
        await session.delete(s)
    await session.delete(wf)
    await session.commit()


@router.get("/workflows/{workflow_id}/steps", response_model=list[WorkflowStepOut])
async def list_workflow_steps(
    workflow_id: int, user: CurrentUser, session: DbSession
) -> list[WorkflowStep]:
    await _owned_workflow(workflow_id, user, session)
    stmt = (
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow_id)
        .order_by(WorkflowStep.step_order)
    )
    return list((await session.execute(stmt)).scalars())


# ---------- run workflow ----------


@router.post("/workflows/{workflow_id}/run", response_model=WorkflowRunOut, status_code=201)
async def run_workflow(
    workflow_id: int,
    user: CurrentUser,
    session: DbSession,
    payload: WorkflowRunIn | None = Body(default=None),
) -> WorkflowRun:
    wf = await _owned_workflow(workflow_id, user, session)
    opts = payload or WorkflowRunIn()

    # Ambil step pertama
    steps = (
        await session.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == wf.id)
            .order_by(WorkflowStep.step_order)
        )
    ).scalars().all()
    if not steps:
        raise HTTPException(status_code=400, detail="workflow tidak punya step")

    settings = get_settings()
    goal_text = opts.goal or f"Menjalankan workflow '{wf.name}'"
    run = WorkflowRun(
        workflow_id=wf.id,
        user_id=user.id,
        goal=goal_text,
        status="running",
        current_step=0,
        project_path=opts.project_path or settings.default_project_path,
        mode=opts.mode,
        allow_unisolated=opts.allow_unisolated,
    )
    session.add(run)
    await session.flush()

    first_step = steps[0]
    task = Task(
        user_id=user.id,
        prompt=run.goal,
        category=first_step.category or "coding_complex",
        mode=opts.mode,
        project_path=opts.project_path or settings.default_project_path,
        quality_floor=first_step.quality_floor,
        plan_artifact=None,
        allow_unisolated=opts.allow_unisolated,
        workflow_run_id=run.id,
        step_order=0,
        owns_workspace=True,
        status="queued",
    )
    session.add(task)
    await session.commit()
    await session.refresh(run)
    await session.refresh(task)

    runner.start(task.id)
    return run


# ---------- run status ----------


@router.get("/workflow-runs/{run_id}", response_model=WorkflowRunDetailOut)
async def get_workflow_run(
    run_id: int, user: CurrentUser, session: DbSession
) -> WorkflowRunDetailOut:
    run = await _owned_run(run_id, user, session)

    steps = (
        await session.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == run.workflow_id)
            .order_by(WorkflowStep.step_order)
        )
    ).scalars().all()

    tasks = (
        await session.execute(
            select(Task).where(Task.workflow_run_id == run.id)
        )
    ).scalars().all()
    task_by_order = {t.step_order: t for t in tasks if t.step_order is not None}

    out_steps: list[WorkflowRunStepOut] = []
    for s in steps:
        t = task_by_order.get(s.step_order)
        out_steps.append(
            WorkflowRunStepOut(
                id=s.id,
                step_order=s.step_order,
                name=s.name,
                role_prompt=s.role_prompt,
                requires_approval=s.requires_approval,
                status=t.status if t else "pending",
                task_id=t.id if t else None,
            )
        )

    pending_id: int | None = None
    pending_artifact: str | None = None
    if run.status == "awaiting_approval":
        pending = next(
            (s for s in steps if s.step_order == run.current_step + 1), None
        )
        if pending is not None:
            pending_id = pending.id
            done = task_by_order.get(run.current_step)
            pending_artifact = done.final_output if done else None

    return WorkflowRunDetailOut(
        id=run.id,
        workflow_id=run.workflow_id,
        goal=run.goal,
        status=run.status,
        current_step=run.current_step,
        project_path=run.project_path,
        workspace_path=run.workspace_path,
        mode=run.mode,
        created_at=run.created_at,
        finished_at=run.finished_at,
        steps=out_steps,
        pending_approval_step_id=pending_id,
        pending_approval_artifact=pending_artifact,
    )


# ---------- approval / reject ----------


@router.post("/workflow-runs/{run_id}/approve")
async def approve_run(
    run_id: int,
    user: CurrentUser,
    session: DbSession,
    payload: RunApprovalIn | None = Body(default=None),
) -> dict:
    run = await _owned_run(run_id, user, session)
    if run.status != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"run berstatus '{run.status}', bukan 'awaiting_approval'",
        )

    # Import di sini untuk menghindari circular import
    from app.orchestrator.workflow import advance_run

    await advance_run(
        run.id, approved_artifact=payload.plan_artifact if payload else None
    )
    await session.refresh(run)
    return {"status": run.status, "message": "approval diterima"}


@router.post("/workflow-runs/{run_id}/reject")
async def reject_run(
    run_id: int, user: CurrentUser, session: DbSession
) -> dict:
    run = await _owned_run(run_id, user, session)
    if run.status != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"run berstatus '{run.status}', bukan 'awaiting_approval'",
        )
    run.status = "halted"
    run.finished_at = datetime.now(UTC)
    await session.commit()
    return {"status": "halted", "message": "run ditolak"}

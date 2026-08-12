from __future__ import annotations
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy import desc, func, select, Integer
from app.models import Agent, Project, TaskGroup, TaskRun, Task, TaskLog
from app.schemas import (
    ProjectIn, ProjectOut, TaskGroupIn, TaskGroupOut,
    TaskRunOut, TaskRunDetailOut, RunLaneOut, TaskOut, FanoutIn,
)
from app.orchestrator import quota
from app.orchestrator.isolation import is_git_repo
from app.orchestrator.runner import runner
from app.security import CurrentUser, DbSession

router = APIRouter(prefix="/api", tags=["projects"])

def _validate_folder(folder_path: str) -> str:
    # Reuse pola validasi fs.py: folder harus ada & berupa direktori.
    p = Path(folder_path).expanduser()
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="folder tidak ditemukan / bukan direktori")
    return str(p.resolve())

@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(payload: ProjectIn, user: CurrentUser, session: DbSession) -> Project:
    valid_folder = _validate_folder(payload.folder_path)
    project = Project(
        user_id=user.id,
        name=payload.name,
        folder_path=valid_folder,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project

@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(user: CurrentUser, session: DbSession) -> list[Project]:
    stmt = select(Project).where(Project.user_id == user.id).order_by(desc(Project.created_at))
    return list((await session.execute(stmt)).scalars())

@router.delete("/projects/{id}", status_code=204)
async def delete_project(id: int, user: CurrentUser, session: DbSession) -> None:
    project = await session.get(Project, id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if there are task groups
    stmt = select(func.count()).select_from(TaskGroup).where(TaskGroup.project_id == id)
    count = (await session.execute(stmt)).scalar()
    if count and count > 0:
        raise HTTPException(status_code=409, detail="Cannot delete project with existing task groups")
        
    await session.delete(project)
    await session.commit()

@router.post("/projects/{id}/tasks", response_model=TaskGroupOut, status_code=201)
async def create_task_group(id: int, payload: TaskGroupIn, user: CurrentUser, session: DbSession) -> TaskGroup:
    project = await session.get(Project, id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
        
    from app.orchestrator.router import CATEGORIES
    for cat in payload.categories:
        if cat not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Invalid category: {cat}")
            
    group = TaskGroup(
        project_id=id,
        user_id=user.id,
        name=payload.name,
        categories=payload.categories,
    )
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group

@router.get("/projects/{id}/tasks", response_model=list[TaskGroupOut])
async def list_task_groups(id: int, user: CurrentUser, session: DbSession) -> list[TaskGroup]:
    project = await session.get(Project, id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
        
    stmt = select(TaskGroup).where(TaskGroup.project_id == id).order_by(desc(TaskGroup.created_at))
    return list((await session.execute(stmt)).scalars())

@router.delete("/tasks-groups/{id}", status_code=204)
async def delete_task_group(id: int, user: CurrentUser, session: DbSession) -> None:
    group = await session.get(TaskGroup, id)
    if not group or group.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task group not found")
        
    await session.delete(group)
    await session.commit()

@router.post("/task-groups/{id}/runs", response_model=TaskRunOut, status_code=201)
async def create_run(id: int, user: CurrentUser, session: DbSession) -> TaskRun:
    group = await session.get(TaskGroup, id)
    if not group or group.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task group not found")
        
    run = TaskRun(
        task_group_id=id,
        user_id=user.id,
        status="running",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run

@router.get("/task-groups/{id}/runs", response_model=list[TaskRunOut])
async def list_runs(id: int, user: CurrentUser, session: DbSession) -> list[TaskRun]:
    group = await session.get(TaskGroup, id)
    if not group or group.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task group not found")
        
    stmt = select(TaskRun).where(TaskRun.task_group_id == id).order_by(desc(TaskRun.created_at))
    return list((await session.execute(stmt)).scalars())

@router.get("/task-runs/{id}", response_model=TaskRunDetailOut)
async def get_run(id: int, user: CurrentUser, session: DbSession) -> TaskRunDetailOut:
    run = await session.get(TaskRun, id)
    if not run or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task run not found")
        
    group = await session.get(TaskGroup, run.task_group_id)
    lanes = []

    async def _tokens_run(task_id: int) -> int:
        log = (await session.execute(
            select(TaskLog)
            .where(TaskLog.task_id == task_id)
            .order_by(desc(TaskLog.id))
            .limit(1)
        )).scalar_one_or_none()
        if log and log.usage and "total" in log.usage:
            return log.usage["total"]
        return 0

    for c in group.categories:
        # Semua task lane ini (terbaru dulu) — perlu dilihat utuh untuk deteksi fan-out.
        all_tasks = list((await session.execute(
            select(Task)
            .where(Task.task_run_id == id, Task.category == c)
            .order_by(desc(Task.id))
        )).scalars())

        primary = all_tasks[0] if all_tasks else None
        branches_out = None

        # Fan-out: task terbaru punya fanout_group_id. Kalau ≥2 cabang belum dibuang,
        # lane belum punya pemenang → paparkan cabang (tanpa primary tunggal). Kalau
        # sudah diputuskan (satu cabang tersisa), collapse ke pemenang itu.
        if primary is not None and primary.fanout_group_id is not None:
            gid = primary.fanout_group_id
            group_tasks = [t for t in all_tasks if t.fanout_group_id == gid]
            active = [t for t in group_tasks if t.status != "discarded"]
            if len(active) >= 2:
                primary = None
                branches_out = []
                for t in sorted(group_tasks, key=lambda x: x.id):
                    agent_name = None
                    if t.pinned_agent_id:
                        ag = await session.get(Agent, t.pinned_agent_id)
                        agent_name = ag.name if ag else None
                    branches_out.append({
                        "task_id": t.id,
                        "status": t.status,
                        "tokens_run": await _tokens_run(t.id),
                        "agent": agent_name,
                    })
            elif active:
                primary = active[0]

        task_id = primary.id if primary else None
        status = primary.status if primary else None
        tokens_run = await _tokens_run(primary.id) if primary else 0

        # akumulasi token seluruh task di lane (termasuk cabang yang dibuang — sudah terpakai)
        stmt_acc = (select(func.sum(TaskLog.usage["total"].astext.cast(Integer)))
            .join(Task, Task.id == TaskLog.task_id)
            .where(Task.task_run_id == id, Task.category == c)
        )
        tokens_accumulated = (await session.execute(stmt_acc)).scalar_one_or_none() or 0

        lanes.append({
            "category": c,
            "task_id": task_id,
            "status": status,
            "tokens_run": tokens_run,
            "tokens_accumulated": tokens_accumulated,
            "branches": branches_out,
        })

    # Convert run to TaskRunDetailOut
    return TaskRunDetailOut(
        id=run.id,
        task_group_id=run.task_group_id,
        status=run.status,
        created_at=run.created_at,
        finished_at=run.finished_at,
        lanes=lanes
    )


@router.get("/task-runs/{id}/lanes/{category}/tasks", response_model=list[TaskOut])
async def list_lane_tasks(id: int, category: str, user: CurrentUser, session: DbSession) -> list[Task]:
    """Semua eksekusi (termasuk follow-up & hasil delegasi) di satu lane —
    bahan picker riwayat hasil di ConsolePanel."""
    run = await session.get(TaskRun, id)
    if not run or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task run not found")

    stmt = (
        select(Task)
        .where(Task.task_run_id == id, Task.category == category)
        .order_by(desc(Task.id))
    )
    return list((await session.execute(stmt)).scalars())


@router.post(
    "/task-runs/{id}/lanes/{category}/fanout",
    response_model=list[TaskOut],
    status_code=201,
)
async def fanout_lane(
    id: int, category: str, payload: FanoutIn, user: CurrentUser, session: DbSession
) -> list[Task]:
    """Jalankan satu lane di 2 agent serentak → bandingkan → (nanti) pilih pemenang.

    Keputusan produk: tepat 2 cabang (muat di cap konkurensi global 3) & selalu
    autonomous, jadi tiap cabang dapat worktree terisolasi sendiri dan tak saling
    menimpa folder live. Kedua cabang berbagi `fanout_group_id` (= id task jangkar).
    """
    run = await session.get(TaskRun, id)
    if not run or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task run not found")

    group = await session.get(TaskGroup, run.task_group_id)
    if not group or category not in group.categories:
        raise HTTPException(status_code=400, detail=f"kategori '{category}' bukan bagian dari task ini")

    agent_ids = payload.agent_ids
    if len(agent_ids) != 2 or len(set(agent_ids)) != 2:
        raise HTTPException(status_code=400, detail="fan-out butuh tepat 2 agent berbeda")

    agents: list[Agent] = []
    for aid in agent_ids:
        agent = await session.get(Agent, aid)
        if not agent or agent.user_id != user.id or not agent.is_active:
            raise HTTPException(status_code=400, detail=f"agent {aid} tidak valid / bukan milik Anda")
        agents.append(agent)

    # Preflight kuota: fan-out membakar kuota 2×. Jujur menolak lebih dulu kalau agen
    # terpilih sedang mentok — kecuali user eksplisit memaksa (force).
    if not payload.force:
        blocked: list[str] = []
        for agent in agents:
            exhausted, until = await quota.is_exhausted(
                session, user_id=user.id, agent_id=agent.id, model=agent.default_model
            )
            if exhausted:
                blocked.append(f"{agent.name} (reset {until:%H:%M %d/%m})" if until else agent.name)
        if blocked:
            raise HTTPException(
                status_code=409,
                detail=f"kuota mentok untuk: {'; '.join(blocked)}. Fan-out membakar kuota 2× — "
                "set force=true untuk tetap lanjut.",
            )

    project = await session.get(Project, group.project_id)
    project_path = project.folder_path if project else None

    # Isolasi worktree butuh repo git. Cegah lebih dulu daripada men-spawn 2 task yang
    # pasti halted (kecuali user eksplisit izinkan tanpa isolasi).
    if project_path and not payload.allow_unisolated and not await is_git_repo(project_path):
        raise HTTPException(
            status_code=400,
            detail="fan-out butuh repo git untuk isolasi worktree; jadikan repo git (`git init`) "
            "atau set allow_unisolated bila memang disengaja",
        )

    tasks: list[Task] = []
    for agent in agents:
        task = Task(
            user_id=user.id,
            prompt=payload.prompt,
            category=category,
            mode="autonomous",  # fan-out = selalu worktree terisolasi
            project_path=project_path,
            quality_floor=payload.quality_floor,
            allow_unisolated=payload.allow_unisolated,
            task_run_id=id,
            pinned_agent_id=agent.id,  # cabang ini memimpin dengan agent ini
            status="queued",
        )
        session.add(task)
        tasks.append(task)

    await session.flush()  # dapatkan id sebelum menetapkan group
    group_id = tasks[0].id
    for task in tasks:
        task.fanout_group_id = group_id
    await session.commit()

    for task in tasks:
        await session.refresh(task)
        runner.start(task.id)

    return tasks

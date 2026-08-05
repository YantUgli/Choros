from __future__ import annotations
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy import desc, func, select, Integer
from app.models import Project, TaskGroup, TaskRun, Task, TaskLog
from app.schemas import (
    ProjectIn, ProjectOut, TaskGroupIn, TaskGroupOut,
    TaskRunOut, TaskRunDetailOut, RunLaneOut, TaskOut,
)
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
    
    for c in group.categories:
        # Get latest task in this category
        stmt_task = (select(Task)
            .where(Task.task_run_id == id, Task.category == c)
            .order_by(desc(Task.id))
            .limit(1)
        )
        task = (await session.execute(stmt_task)).scalar_one_or_none()
        
        task_id = None
        status = None
        tokens_run = 0
        if task:
            task_id = task.id
            status = task.status
            
            # get tokens_run from latest task_log
            stmt_log = (select(TaskLog)
                .where(TaskLog.task_id == task_id)
                .order_by(desc(TaskLog.id))
                .limit(1)
            )
            log = (await session.execute(stmt_log)).scalar_one_or_none()
            if log and log.usage and "total" in log.usage:
                tokens_run = log.usage["total"]
                
        # accumulate all tokens for tasks with (task_run_id=id, category=c)
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
            "tokens_accumulated": tokens_accumulated
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

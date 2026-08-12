from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    credential_home: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(64))
    adapter_type: Mapped[str] = mapped_column(String(32))
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RoutingRule(Base):
    __tablename__ = "routing_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(32))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id"))
    step_order: Mapped[int] = mapped_column(Integer)
    role_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    targets: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    quality_floor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    goal: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    project_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    workspace_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    mode: Mapped[str] = mapped_column(String(16), default="interactive")
    allow_unisolated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    prompt: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32))
    mode: Mapped[str] = mapped_column(String(16), default="interactive")
    project_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_floor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    plan_artifact: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    workspace_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    allow_unisolated: Mapped[bool] = mapped_column(Boolean, default=False)
    task_run_id: Mapped[int | None] = mapped_column(ForeignKey("task_runs.id"), nullable=True)
    delegated_from_task_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Cabang satu fan-out berbagi nilai ini (= id task jangkar). NULL = task biasa.
    fanout_group_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_task_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    resume_session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    pinned_agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agents.id"), nullable=True
    )
    workflow_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_runs.id"), nullable=True
    )
    step_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owns_workspace: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TaskLog(Base):
    __tablename__ = "task_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    usage: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TaskEvent(Base):
    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(24))
    agent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class QuotaWindow(Base):
    __tablename__ = "quota_windows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    window_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    window_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    is_exhausted: Mapped[bool] = mapped_column(Boolean, default=False)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    folder_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskGroup(Base):
    __tablename__ = "task_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    categories: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskRun(Base):
    __tablename__ = "task_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_group_id: Mapped[int] = mapped_column(ForeignKey("task_groups.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="running")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

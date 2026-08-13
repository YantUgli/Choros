from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LoginIn(BaseModel):
    username: str
    password: str


class PasswordChangeIn(BaseModel):
    old_password: str
    new_password: str


class UserIn(BaseModel):
    username: str = Field(max_length=64)
    password: str
    is_admin: bool = False
    seed_defaults: bool = True


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    is_admin: bool
    created_at: datetime | None


class AgentIn(BaseModel):
    name: str = Field(max_length=64)
    adapter_type: Literal["claude_code", "antigravity", "opencode", "openai_compatible"]
    base_url: str | None = None
    default_model: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    token_limit: int | None = None


class AgentOut(AgentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class RoutingRuleIn(BaseModel):
    category: str
    agent_id: int
    model: str | None = None
    priority: int = 100


class RoutingRuleOut(RoutingRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class TaskIn(BaseModel):
    prompt: str
    category: str | None = None
    mode: Literal["interactive", "autonomous"] = "interactive"
    project_path: str | None = None
    quality_floor: str | None = None
    plan_artifact: str | None = None
    allow_unisolated: bool = False
    task_run_id: int | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    prompt: str
    category: str
    mode: str
    status: str
    project_path: str | None
    workspace_path: str | None
    allow_unisolated: bool = False
    quality_floor: str | None
    final_output: str | None
    workflow_run_id: int | None = None
    step_order: int | None = None
    fanout_group_id: int | None = None
    created_at: datetime | None
    finished_at: datetime | None


class TaskLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int | None
    agent_id: int
    model: str | None
    category: str | None
    mode: str | None
    status: str | None
    usage: dict[str, Any]
    created_at: datetime | None


class QuotaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    agent_id: int
    model: str | None
    window_type: str | None
    window_start: datetime | None
    window_end: datetime | None
    tokens_used: int
    is_exhausted: bool


class QuotaResetIn(BaseModel):
    agent_id: int
    model: str | None = None


class FollowUpIn(BaseModel):
    """Jawaban user atas pertanyaan balik agent (PRD §8)."""

    answer: str


# ---------- workflow schemas ----------


class WorkflowStepIn(BaseModel):
    name: str | None = None
    role_prompt: str | None = None
    targets: list[dict[str, Any]] = Field(default_factory=list)
    quality_floor: str | None = None
    requires_approval: bool = False
    category: str | None = None


class WorkflowIn(BaseModel):
    name: str = Field(max_length=64)
    steps: list[WorkflowStepIn] = Field(default_factory=list)


class WorkflowStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workflow_id: int
    step_order: int
    name: str | None = None
    role_prompt: str | None
    targets: list[dict[str, Any]]
    quality_floor: str | None
    requires_approval: bool
    category: str | None


class WorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    created_at: datetime | None


class WorkflowDetailOut(WorkflowOut):
    steps: list[WorkflowStepOut] = Field(default_factory=list)


class WorkflowRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workflow_id: int
    goal: str
    status: str
    current_step: int
    project_path: str | None
    workspace_path: str | None
    mode: str
    created_at: datetime | None
    finished_at: datetime | None


class WorkflowRunStepOut(BaseModel):
    id: int
    step_order: int
    name: str | None = None
    role_prompt: str | None = None
    requires_approval: bool = False
    status: str
    task_id: int | None = None


class WorkflowRunDetailOut(WorkflowRunOut):
    steps: list[WorkflowRunStepOut] = Field(default_factory=list)
    pending_approval_step_id: int | None = None
    pending_approval_artifact: str | None = None


class RunApprovalIn(BaseModel):
    plan_artifact: str | None = None


class WorkflowRunIn(BaseModel):
    goal: str | None = None
    project_path: str | None = None
    mode: str = "interactive"
    allow_unisolated: bool = False


class ProjectIn(BaseModel):
    name: str
    folder_path: str

class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    folder_path: str
    created_at: datetime | None

class TaskGroupIn(BaseModel):
    name: str
    categories: list[str] = []

class TaskGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    name: str
    categories: list[str]
    created_at: datetime | None

class TaskRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_group_id: int
    status: str
    created_at: datetime | None
    finished_at: datetime | None

class RunLaneBranchOut(BaseModel):
    """Satu cabang dari fan-out yang belum diputuskan (Item C)."""
    task_id: int
    status: str | None
    tokens_run: int
    agent: str | None = None

class RunLaneOut(BaseModel):
    category: str
    task_id: int | None
    status: str | None
    tokens_run: int
    tokens_accumulated: int
    # Terisi hanya saat lane berupa fan-out yang belum dipilih pemenangnya.
    branches: list[RunLaneBranchOut] | None = None

class TaskRunDetailOut(TaskRunOut):
    lanes: list[RunLaneOut]

class DelegateIn(BaseModel):
    to_category: str
    artifact: str
    mode: Literal["interactive", "autonomous"] = "interactive"

class FanoutIn(BaseModel):
    """Jalankan satu lane di 2 agent serentak lalu bandingkan (Item C).

    Fan-out dibatasi 2 cabang & selalu autonomous (worktree terisolasi per cabang),
    jadi tak ada opsi mode di sini — sengaja.
    """

    prompt: str
    agent_ids: list[int]  # tepat 2 agent berbeda, satu per cabang
    quality_floor: str | None = None
    allow_unisolated: bool = False
    force: bool = False  # lewati preflight kuota (fan-out membakar kuota 2×)

class SelectWinnerIn(BaseModel):
    """Pilih cabang pemenang dari sebuah fan-out (Item C).

    Cabang lain dalam grup dibatalkan & worktree-nya dibuang. Bila `to_category`
    diisi, artifact pemenang langsung didelegasikan ke lane berikutnya.
    """

    to_category: str | None = None
    artifact: str | None = None
    mode: Literal["interactive", "autonomous"] = "interactive"

class MdFileOut(BaseModel):
    path: str
    content: str

class ArtifactCandidatesOut(BaseModel):
    final_output: str | None
    md_files: list[MdFileOut]


from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LoginIn(BaseModel):
    username: str
    password: str


class AgentIn(BaseModel):
    name: str = Field(max_length=64)
    adapter_type: Literal["claude_code", "antigravity", "opencode", "openai_compatible"]
    base_url: str | None = None
    default_model: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


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


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    prompt: str
    category: str
    mode: str
    status: str
    project_path: str | None
    workspace_path: str | None
    quality_floor: str | None
    final_output: str | None
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

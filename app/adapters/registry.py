from __future__ import annotations

from typing import Any

from app.adapters.antigravity import AntigravityAdapter
from app.adapters.base import AgentAdapter
from app.adapters.claude_code import ClaudeCodeAdapter
from app.adapters.openai_compat import OpenAICompatAdapter
from app.adapters.opencode import OpenCodeAdapter
from app.config import get_settings
from app.models import Agent

ADAPTERS: dict[str, type] = {
    ClaudeCodeAdapter.adapter_type: ClaudeCodeAdapter,
    AntigravityAdapter.adapter_type: AntigravityAdapter,
    OpenCodeAdapter.adapter_type: OpenCodeAdapter,
    OpenAICompatAdapter.adapter_type: OpenAICompatAdapter,
}

# Adapter yang punya "tangan" (bisa mengeksekusi kode di project). PRD §3.
ADAPTERS_WITH_HANDS = {
    ClaudeCodeAdapter.adapter_type,
    AntigravityAdapter.adapter_type,
    OpenCodeAdapter.adapter_type,
}

# Adapter yang terikat langganan → dilarang dipakai lewat harness generik.
SUBSCRIPTION_ADAPTERS = {ClaudeCodeAdapter.adapter_type, AntigravityAdapter.adapter_type}


class UnknownAdapterError(ValueError):
    pass


def build_adapter(agent: Agent, *, timeout: int | None = None) -> AgentAdapter:
    cls = ADAPTERS.get(agent.adapter_type)
    if cls is None:
        raise UnknownAdapterError(
            f"adapter_type '{agent.adapter_type}' tidak dikenal; pilihan: {sorted(ADAPTERS)}"
        )
    settings = get_settings()
    return cls(
        name=agent.name,
        config=dict(agent.config or {}),
        default_model=agent.default_model,
        base_url=agent.base_url,
        timeout=timeout or settings.run_timeout,
    )


def adapter_can_execute(adapter_type: str) -> bool:
    return adapter_type in ADAPTERS_WITH_HANDS


def describe_adapters() -> list[dict[str, Any]]:
    return [
        {
            "adapter_type": key,
            "has_hands": key in ADAPTERS_WITH_HANDS,
            "subscription_bound": key in SUBSCRIPTION_ADAPTERS,
        }
        for key in sorted(ADAPTERS)
    ]

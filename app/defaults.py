from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, RoutingRule, User

AGENTS = [
    {
        "name": "claude",
        "adapter_type": "claude_code",
        "default_model": "sonnet",
        "config": {"partial_messages": True, "window_type": "rolling_5h"},
    },
    {
        "name": "antigravity",
        "adapter_type": "antigravity",
        "default_model": None,
        "config": {"window_type": "daily"},
    },
    {
        "name": "opencode-groq",
        "adapter_type": "opencode",
        "default_model": "groq/llama-3.3-70b-versatile",
        "config": {"env_keys": ["GROQ_API_KEY"], "window_type": "daily"},
    },
    {
        "name": "opencode-ollama",
        "adapter_type": "opencode",
        "default_model": "ollama/llama3",
        "config": {"window_type": "daily"},
    },
    {
        "name": "opencode-zen",
        "adapter_type": "opencode",
        "default_model": "opencode/grok-code",
        "config": {"env_keys": ["OPENCODE_API_KEY"], "window_type": "daily"},
    },
    {
        "name": "groq-raw",
        "adapter_type": "openai_compatible",
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
        "config": {"api_key_env": "GROQ_API_KEY", "window_type": "daily"},
    },
]

ROUTES = [
    ("coding_complex", "claude", None, 10),
    ("coding_complex", "antigravity", None, 20),
    ("coding_complex", "opencode-zen", "opencode/glm-5-free", 22),
    ("coding_complex", "opencode-zen", "opencode/minimax-m3-free", 24),
    ("coding_complex", "opencode-zen", "opencode/kimi-k2.5-free", 26),
    ("coding_complex", "opencode-zen", "opencode/grok-code", 28),
    ("coding_complex", "opencode-groq", "groq/llama-3.3-70b-versatile", 30),
    ("coding_complex", "opencode-ollama", None, 60),
    ("data_analysis", "antigravity", None, 10),
    ("data_analysis", "claude", None, 20),
    ("data_analysis", "opencode-zen", "opencode/qwen3.6-plus-free", 30),
    ("data_analysis", "opencode-zen", "opencode/glm-5-free", 40),
    ("draft_bulk", "opencode-groq", "groq/llama-3.3-70b-versatile", 10),
    ("draft_bulk", "opencode-zen", "opencode/ling-3.0-flash-free", 12),
    ("draft_bulk", "opencode-zen", "opencode/mimo-v2-flash-free", 14),
    ("draft_bulk", "opencode-zen", "opencode/big-pickle", 16),
    ("draft_bulk", "opencode-groq", "groq/llama-3.1-8b-instant", 20),
    ("draft_bulk", "opencode-ollama", None, 30),
    ("private", "opencode-ollama", None, 10),
    ("text_planning", "groq-raw", None, 10),
    ("text_planning", "opencode-zen", "opencode/nemotron-3-ultra-free", 15),
    ("text_planning", "claude", None, 20),
    ("text_planning", "opencode-zen", "opencode/mimo-v2-pro-free", 25),
]


@dataclass(slots=True)
class SeedReport:
    agents_added: list[str] = field(default_factory=list)
    routes_added: list[str] = field(default_factory=list)
    routes_reconciled: list[str] = field(default_factory=list)


async def seed_defaults(
    session: AsyncSession, user: User, *, reconcile: bool = False
) -> SeedReport:
    """Semai agent + routing rule default untuk satu user. Idempoten."""
    report = SeedReport()
    by_name: dict[str, Agent] = {}
    for spec in AGENTS:
        existing = (
            await session.execute(
                select(Agent).where(Agent.user_id == user.id, Agent.name == spec["name"])
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = Agent(user_id=user.id, **spec)
            session.add(existing)
            await session.flush()
            report.agents_added.append(spec["name"])
        elif reconcile:
            existing.default_model = spec.get("default_model")
            existing.config = spec.get("config", {})
        by_name[spec["name"]] = existing

    for category, agent_name, model, priority in ROUTES:
        agent = by_name[agent_name]
        existing = (
            await session.execute(
                select(RoutingRule).where(
                    RoutingRule.category == category,
                    RoutingRule.agent_id == agent.id,
                    RoutingRule.model.is_(None) if model is None else RoutingRule.model == model,
                )
            )
        ).scalar_one_or_none()
        
        route_str = f"{category} \u2192 {agent_name}/{model or 'default'} @{priority}"
        if existing is None:
            session.add(
                RoutingRule(
                    category=category, agent_id=agent.id, model=model, priority=priority
                )
            )
            report.routes_added.append(route_str)
        elif reconcile and existing.priority != priority:
            existing.priority = priority
            report.routes_reconciled.append(route_str)
            
    return report

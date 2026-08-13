from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.adapters.model_catalog import get_models
from app.adapters.registry import ADAPTERS, describe_adapters
from app.models import Agent, RoutingRule
from app.orchestrator.router import CATEGORIES
from app.schemas import AgentIn, AgentOut, RoutingRuleIn, RoutingRuleOut
from app.security import CurrentUser, DbSession

router = APIRouter(prefix="/api", tags=["agents"])


@router.get("/adapters")
async def list_adapter_types() -> list[dict]:
    return describe_adapters()


@router.get("/adapters/{adapter_type}/models")
async def list_adapter_models(
    adapter_type: str, user: CurrentUser, refresh: bool = False
) -> dict:
    """Model yang tersedia untuk sebuah adapter, ditanyakan live ke CLI-nya.

    Lambat pada panggilan pertama (agy menembak jaringan); hasilnya di-cache.
    """
    if adapter_type not in ADAPTERS:
        raise HTTPException(status_code=404, detail=f"adapter_type tidak dikenal: {adapter_type}")
    return await get_models(adapter_type, refresh=refresh)


@router.get("/agents", response_model=list[AgentOut])
async def list_agents(user: CurrentUser, session: DbSession) -> list[Agent]:
    stmt = select(Agent).where(Agent.user_id == user.id).order_by(Agent.id)
    return list((await session.execute(stmt)).scalars())


@router.post("/agents", response_model=AgentOut, status_code=201)
async def create_agent(payload: AgentIn, user: CurrentUser, session: DbSession) -> Agent:
    if payload.adapter_type not in ADAPTERS:
        raise HTTPException(status_code=400, detail=f"adapter_type tidak dikenal: {payload.adapter_type}")
    agent = Agent(user_id=user.id, **payload.model_dump())
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.put("/agents/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: int, payload: AgentIn, user: CurrentUser, session: DbSession
) -> Agent:
    agent = await _owned_agent(agent_id, user, session)
    for field, value in payload.model_dump().items():
        setattr(agent, field, value)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(agent_id: int, user: CurrentUser, session: DbSession) -> None:
    agent = await _owned_agent(agent_id, user, session)
    rules = (
        await session.execute(select(RoutingRule).where(RoutingRule.agent_id == agent.id))
    ).scalars().all()
    if rules:
        raise HTTPException(
            status_code=409,
            detail=f"agent masih dipakai {len(rules)} routing rule; hapus rule-nya dulu",
        )
    await session.delete(agent)
    await session.commit()


@router.get("/routing", response_model=list[RoutingRuleOut])
async def list_routing(user: CurrentUser, session: DbSession) -> list[RoutingRule]:
    stmt = (
        select(RoutingRule)
        .join(Agent, Agent.id == RoutingRule.agent_id)
        .where(Agent.user_id == user.id)
        .order_by(RoutingRule.category, RoutingRule.priority)
    )
    return list((await session.execute(stmt)).scalars())


@router.post("/routing", response_model=RoutingRuleOut, status_code=201)
async def create_routing(
    payload: RoutingRuleIn, user: CurrentUser, session: DbSession
) -> RoutingRule:
    if payload.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"kategori tidak dikenal: {payload.category}")
    await _owned_agent(payload.agent_id, user, session)
    rule = RoutingRule(**payload.model_dump())
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


@router.put("/routing/{rule_id}", response_model=RoutingRuleOut)
async def update_routing(
    rule_id: int, payload: RoutingRuleIn, user: CurrentUser, session: DbSession
) -> RoutingRule:
    rule = await _owned_rule(rule_id, user, session)
    await _owned_agent(payload.agent_id, user, session)
    for field, value in payload.model_dump().items():
        setattr(rule, field, value)
    await session.commit()
    await session.refresh(rule)
    return rule


@router.delete("/routing/{rule_id}", status_code=204)
async def delete_routing(rule_id: int, user: CurrentUser, session: DbSession) -> None:
    rule = await _owned_rule(rule_id, user, session)
    await session.delete(rule)
    await session.commit()


async def _owned_agent(agent_id: int, user, session) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.user_id != user.id:
        raise HTTPException(status_code=404, detail="agent tidak ditemukan")
    return agent


async def _owned_rule(rule_id: int, user, session) -> RoutingRule:
    rule = await session.get(RoutingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="routing rule tidak ditemukan")
    await _owned_agent(rule.agent_id, user, session)
    return rule

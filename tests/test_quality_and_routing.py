from __future__ import annotations

from app.adapters.registry import adapter_can_execute
from app.db import SessionLocal
from app.models import Agent, RoutingRule, WorkflowStep
from app.orchestrator.quality import meets_floor, model_tier
from app.orchestrator.router import classify, resolve_step_targets, resolve_targets


async def _foreign_agent(user_b, name: str = "agent_b") -> Agent:
    """Agent aktif milik user lain — dipakai untuk menguji boundary Fase 5."""
    async with SessionLocal() as session:
        agent = Agent(
            user_id=user_b.id,
            name=name,
            adapter_type="claude_code",
            default_model="sonnet",
            config={},
            is_active=True,
        )
        session.add(agent)
        await session.commit()
        return agent


def test_tier_ordering_matches_intuition():
    assert model_tier("opus") > model_tier("sonnet")
    assert model_tier("sonnet") > model_tier("gemini-3.5-flash")
    assert model_tier("groq/llama-3.3-70b-versatile") > model_tier("groq/llama-3.1-8b-instant")


def test_opencode_zen_free_models_are_ranked():
    """Tanpa entri eksplisit semua model Zen jatuh ke TIER_UNKNOWN dan tersaring
    habis oleh floor 'strong'/'mid' — rute-nya jadi mati diam-diam."""
    for model in (
        "opencode/glm-5-free",
        "opencode/minimax-m3-free",
        "opencode/kimi-k2.5-free",
        "opencode/qwen3.6-plus-free",
        "opencode/nemotron-3-ultra-free",
        "opencode/grok-code",
    ):
        assert meets_floor(model, "strong"), model

    for model in (
        "opencode/big-pickle",
        "opencode/ling-3.0-flash-free",
        "opencode/mimo-v2-flash-free",
        "opencode/north-mini-code-free",
    ):
        assert meets_floor(model, "mid"), model
        assert not meets_floor(model, "strong"), model


def test_zen_names_containing_mini_are_not_demoted():
    """"minimax"/"north-mini-code" mengandung "mini"; pola generik TIER_LIGHT
    tidak boleh menangkapnya duluan."""
    assert model_tier("opencode/minimax-m3-free") > model_tier("opencode/big-pickle")
    assert model_tier("opencode/north-mini-code-free") > model_tier("groq/llama-3.1-8b-instant")


def test_quality_floor_blocks_weaker_model():
    # PRD §6.2: lebih baik berhenti daripada menghasilkan kode rusak
    assert meets_floor("sonnet", "strong")
    assert not meets_floor("groq/llama-3.1-8b-instant", "strong")
    assert meets_floor("apa-saja", None), "tanpa floor semua target boleh"


def test_quality_floor_accepts_model_name_as_floor():
    assert meets_floor("opus", "sonnet")
    assert not meets_floor("gpt-oss-20b", "sonnet")


def test_tier_override_from_agent_config():
    """Peringkat model berubah cepat — override harus menang atas tabel bawaan."""
    assert not meets_floor("model-baru-tak-dikenal", "frontier")
    assert meets_floor("model-baru-tak-dikenal", "frontier", override=40)


def test_classify_prefers_explicit_category():
    assert classify("bikin analisis csv", "coding_complex") == "coding_complex"


def test_classify_falls_back_to_keywords():
    assert classify("tolong analisis file csv ini") == "data_analysis"
    assert classify("ini rahasia, jangan dikirim ke cloud") == "private"
    assert classify("refactor modul auth") == "coding_complex"
    assert classify("sesuatu yang tidak jelas") == "coding_complex"


def test_raw_model_has_no_hands():
    # PRD §3: model mentah = otak tanpa tangan
    assert not adapter_can_execute("openai_compatible")
    assert adapter_can_execute("opencode")
    assert adapter_can_execute("claude_code")


# ------------------------------------------------- boundary multi-user (Fase 5a)


async def test_resolve_targets_only_returns_own_agents(user, user_b, make_agent, make_route):
    """F1: rule user lain tidak boleh muncul walau kategorinya sama.

    Rule milik user_b sengaja diberi priority lebih tinggi (1 < 10): tanpa filter
    pemilik, ia akan menempati urutan PERTAMA cascade user A.
    """
    agent_a = await make_agent("agent_a")
    await make_route("coding_complex", agent_a, priority=10)

    agent_b = await _foreign_agent(user_b)
    async with SessionLocal() as session:
        session.add(RoutingRule(category="coding_complex", agent_id=agent_b.id, priority=1))
        await session.commit()

    async with SessionLocal() as session:
        targets_a = await resolve_targets(session, "coding_complex", user_id=user.id)
        targets_b = await resolve_targets(session, "coding_complex", user_id=user_b.id)

    assert [t.agent.name for t in targets_a] == ["agent_a"]
    assert [t.agent.name for t in targets_b] == ["agent_b"]


async def test_resolve_step_targets_drops_foreign_agent(user, user_b, make_agent):
    """F1 turunan: entri targets JSONB milik agent user lain dibuang saat jalan."""
    agent_a = await make_agent("agent_a")
    agent_b = await _foreign_agent(user_b)

    # step transient — resolve_step_targets hanya membaca .targets dan .category
    step = WorkflowStep(
        step_order=0,
        category="coding_complex",
        targets=[{"agent_id": agent_b.id}, {"agent_id": agent_a.id}],
    )

    async with SessionLocal() as session:
        targets = await resolve_step_targets(
            session, step, "coding_complex", user_id=user.id
        )

    assert [t.agent.name for t in targets] == ["agent_a"]

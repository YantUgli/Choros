from __future__ import annotations

from app.adapters.registry import adapter_can_execute
from app.orchestrator.quality import meets_floor, model_tier
from app.orchestrator.router import classify


def test_tier_ordering_matches_intuition():
    assert model_tier("opus") > model_tier("sonnet")
    assert model_tier("sonnet") > model_tier("gemini-3.5-flash")
    assert model_tier("groq/llama-3.3-70b-versatile") > model_tier("groq/llama-3.1-8b-instant")


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

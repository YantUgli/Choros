"""Parser adapter: stream harness → Event ternormalisasi."""

from __future__ import annotations

import json

from app.adapters.base import classify_failure_text
from app.adapters.claude_code import ClaudeCodeAdapter
from app.adapters.generic import normalize_generic
from app.adapters.opencode import OpenCodeAdapter
from app.events import ERROR_AUTH, ERROR_RATE_LIMIT


def make_claude(**config):
    return ClaudeCodeAdapter(name="claude", config=config, default_model="sonnet")


def test_claude_init_captures_session_id():
    adapter = make_claude()
    line = json.dumps({"type": "system", "subtype": "init", "session_id": "abc-123", "tools": ["Read"]})
    events = adapter.parse_line(line)
    assert adapter.session_id == "abc-123"
    assert any(e.type == "status" and e.data.get("session_id") == "abc-123" for e in events)


def test_claude_tool_use_becomes_tool_call_and_file_edit():
    adapter = make_claude()
    line = json.dumps(
        {
            "type": "assistant",
            "session_id": "s1",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "Edit", "input": {"file_path": "/tmp/a.py"}}
                ]
            },
        }
    )
    events = adapter.parse_line(line)
    types = [e.type for e in events]
    assert "tool_call" in types
    assert "file_edit" in types
    edit = next(e for e in events if e.type == "file_edit")
    assert edit.data["path"] == "/tmp/a.py"


def test_claude_skips_full_text_when_partials_enabled():
    """Delta sudah dialirkan, jadi teks utuh tidak diulang di console."""
    adapter = make_claude(partial_messages=True)
    line = json.dumps(
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "halo"}]}}
    )
    assert [e for e in adapter.parse_line(line) if e.type == "output"] == []

    adapter_full = make_claude(partial_messages=False)
    events = adapter_full.parse_line(line)
    assert [e.data["text"] for e in events if e.type == "output"] == ["halo"]


def test_claude_partial_delta_marked_partial():
    adapter = make_claude()
    line = json.dumps(
        {
            "type": "stream_event",
            "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "ha"}},
        }
    )
    events = adapter.parse_line(line)
    assert events[0].type == "output"
    assert events[0].data["partial"] is True


def test_claude_result_is_final_output_with_usage():
    adapter = make_claude()
    line = json.dumps(
        {
            "type": "result",
            "subtype": "success",
            "result": "selesai",
            "total_cost_usd": 0.01,
            "usage": {"input_tokens": 100, "output_tokens": 20, "cache_read_input_tokens": 5},
        }
    )
    events = adapter.parse_line(line)
    usage = next(e for e in events if e.type == "usage")
    assert usage.data["total_tokens"] == 125
    assert usage.data["cost_usd"] == 0.01
    output = next(e for e in events if e.type == "output")
    assert output.data["final"] is True


def test_claude_result_error_classified_as_rate_limit():
    adapter = make_claude()
    line = json.dumps(
        {"type": "result", "is_error": True, "result": "API Error 429: rate limit exceeded"}
    )
    events = adapter.parse_line(line)
    error = next(e for e in events if e.type == "error")
    assert error.data["kind"] == ERROR_RATE_LIMIT
    assert error.is_cascade_trigger


def test_non_json_line_still_surfaces_as_output():
    """Provider drift tidak boleh membuat console kosong."""
    adapter = make_claude()
    events = adapter.parse_line("bukan json sama sekali")
    assert events[0].type == "output"
    assert events[0].data["text"] == "bukan json sama sekali"


def test_classify_failure_text():
    assert classify_failure_text("Error: 429 Too Many Requests") == ERROR_RATE_LIMIT
    assert classify_failure_text("usage limit reached") == ERROR_RATE_LIMIT
    assert classify_failure_text("401 unauthorized") == ERROR_AUTH
    assert classify_failure_text("segmentation fault") is None


def test_generic_normalizer_finds_nested_text():
    events = normalize_generic(
        {"type": "message.part.updated", "properties": {"part": {"type": "text", "text": "hai"}}}
    )
    assert any(e.type == "output" and e.data["text"] == "hai" for e in events)


def test_generic_normalizer_detects_rate_limit_error():
    events = normalize_generic({"error": "rate_limit_exceeded for model X"})
    assert events[0].type == "error"
    assert events[0].data["kind"] == ERROR_RATE_LIMIT


def test_opencode_command_shape():
    adapter = OpenCodeAdapter(name="oc", config={}, default_model="groq/llama-3.3-70b")
    cmd = adapter.build_command(
        "kerjakan",
        model="groq/llama-3.3-70b",
        permission_mode="autonomous",
        project_path="/tmp/proj",
        resume_session_id="ses_1",
    )
    assert cmd[:4] == ["opencode", "run", "--format", "json"]
    assert "--auto" in cmd
    assert cmd[cmd.index("--dir") + 1] == "/tmp/proj"
    assert cmd[cmd.index("--session") + 1] == "ses_1"
    assert cmd[-1] == "kerjakan"


def test_claude_permission_modes():
    adapter = make_claude()
    safe = adapter.build_command(
        "x", model="sonnet", permission_mode="safe", project_path=None, resume_session_id=None
    )
    assert "--permission-mode" in safe and "acceptEdits" in safe
    assert "--dangerously-skip-permissions" not in safe

    auto = adapter.build_command(
        "x", model="sonnet", permission_mode="autonomous", project_path=None, resume_session_id=None
    )
    assert "--dangerously-skip-permissions" in auto

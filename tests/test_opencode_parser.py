"""Parser opencode — bentuk event diambil dari output `opencode run --format json` sungguhan."""

from __future__ import annotations

import json

import pytest

from app.adapters.opencode import OpenCodeAdapter

SESSION = "ses_0485243f1ffe7VGb5ve5hTsimB"
MESSAGE = "msg_fb7adbded001FpAz674JHoA64d"


@pytest.fixture
def adapter():
    return OpenCodeAdapter(name="oc", config={}, default_model="ollama/qwen")


def text_event(part_id: str, text: str) -> str:
    return json.dumps(
        {
            "type": "text",
            "timestamp": 1785493064244,
            "sessionID": SESSION,
            "part": {"id": part_id, "messageID": MESSAGE, "sessionID": SESSION, "type": "text", "text": text},
        }
    )


def test_step_start_captures_session(adapter):
    line = json.dumps(
        {
            "type": "step_start",
            "sessionID": SESSION,
            "part": {"id": "prt_1", "type": "step-start", "sessionID": SESSION},
        }
    )
    events = adapter.parse_line(line)
    assert adapter.session_id == SESSION
    assert events[0].data["session_id"] == SESSION


def only_output(events):
    return next(e for e in events if e.type == "output")


def test_growing_part_emits_only_the_new_text(adapter):
    """opencode mengirim ulang part yang sama dengan teks makin panjang."""
    first = only_output(adapter.parse_line(text_event("prt_1", "hal")))
    second = only_output(adapter.parse_line(text_event("prt_1", "halo dun")))
    third = only_output(adapter.parse_line(text_event("prt_1", "halo dunia")))

    assert first.data["text"] == "hal"
    assert second.data["text"] == "o dun"
    assert third.data["text"] == "ia"
    assert all(e.data["partial"] for e in (first, second, third))


def test_finalize_assembles_full_answer(adapter):
    """Tanpa event 'result', jawaban utuh dirakit saat stream habis."""
    adapter.parse_line(text_event("prt_1", "halo"))
    adapter.parse_line(text_event("prt_1", "halo dunia"))
    events = adapter.finalize()
    final = next(e for e in events if e.type == "output")
    assert final.data == {"text": "halo dunia", "final": True}
    assert any(e.type == "status" and e.data.get("final") for e in events)


def test_finalize_joins_multiple_parts(adapter):
    adapter.parse_line(text_event("prt_1", "bagian satu"))
    adapter.parse_line(text_event("prt_2", "bagian dua"))
    final = next(e for e in adapter.finalize() if e.type == "output")
    assert final.data["text"] == "bagian satu\nbagian dua"


def test_step_finish_normalizes_tokens_and_cost(adapter):
    line = json.dumps(
        {
            "type": "step_finish",
            "sessionID": SESSION,
            "part": {
                "id": "prt_9",
                "type": "step-finish",
                "reason": "stop",
                "tokens": {"total": 4136, "input": 4091, "output": 45, "reasoning": 0,
                           "cache": {"write": 12, "read": 34}},
                "cost": 0.0021,
            },
        }
    )
    usage = next(e for e in adapter.parse_line(line) if e.type == "usage")
    assert usage.data["total_tokens"] == 4136
    assert usage.data["input_tokens"] == 4091
    assert usage.data["output_tokens"] == 45
    assert usage.data["cache_read_tokens"] == 34
    assert usage.data["cache_write_tokens"] == 12
    assert usage.data["cost_usd"] == pytest.approx(0.0021)


def test_tool_part_emits_tool_call_once_and_file_edit(adapter):
    def tool_line(status: str) -> str:
        return json.dumps(
            {
                "type": "tool",
                "sessionID": SESSION,
                "part": {
                    "id": "prt_tool",
                    "type": "tool",
                    "tool": "edit",
                    "state": {"status": status, "input": {"filePath": "/proj/app.py"}},
                },
            }
        )

    running = adapter.parse_line(tool_line("running"))
    assert any(e.type == "tool_call" and e.data["name"] == "edit" for e in running)
    assert next(e for e in running if e.type == "file_edit").data["path"] == "/proj/app.py"

    # status berikutnya untuk part yang sama tidak boleh menambah baris baru
    assert adapter.parse_line(tool_line("completed")) == []


def test_tool_error_surfaces(adapter):
    line = json.dumps(
        {
            "type": "tool",
            "sessionID": SESSION,
            "part": {"id": "prt_t2", "type": "tool", "tool": "bash",
                     "state": {"status": "error", "error": "exit 1"}},
        }
    )
    tool_event = next(e for e in adapter.parse_line(line) if e.type == "tool_call")
    assert tool_event.data["error"] == "exit 1"


def test_reasoning_part_becomes_thinking(adapter):
    line = json.dumps(
        {
            "type": "reasoning",
            "sessionID": SESSION,
            "part": {"id": "prt_r", "type": "reasoning", "text": "mikir dulu"},
        }
    )
    events = adapter.parse_line(line)
    assert any(e.type == "thinking" and e.data["text"] == "mikir dulu" for e in events)
    # reasoning tidak ikut jadi jawaban akhir
    assert not any(e.type == "output" for e in adapter.finalize())


def test_rate_limit_in_plain_stderr_line_is_classified(adapter):
    events = adapter.parse_line("Error: 429 rate limit exceeded for model")
    assert events[0].type == "error"
    assert events[0].is_cascade_trigger

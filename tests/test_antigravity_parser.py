"""Parser Antigravity — bentuk event diambil dari output `agy` sungguhan."""

from __future__ import annotations

import json

import pytest

from app.adapters.antigravity import AntigravityAdapter
from app.events import ERROR_PERMISSION


@pytest.fixture
def adapter():
    return AntigravityAdapter(name="ag", config={})


def test_init_captures_conversation_id(adapter):
    line = json.dumps(
        {
            "event": "init",
            "conversation_id": "conv-1",
            "init": {"cwd": "/proj", "tools": ["a", "b"], "permission_mode": "request-review"},
        }
    )
    events = adapter.parse_line(line)
    assert adapter.session_id == "conv-1"
    assert events[0].data["session_id"] == "conv-1"
    assert events[1].data["tools"] == 2


def test_agent_response_delta_is_partial(adapter):
    line = json.dumps(
        {
            "event": "step_update",
            "step_update": {"step_index": 2, "state": "ACTIVE", "step_type": "agent_response", "text_delta": "hal"},
        }
    )
    events = adapter.parse_line(line)
    output = next(e for e in events if e.type == "output")
    assert output.data == {"text": "hal", "partial": True}


def test_tool_step_emits_tool_call_and_file_edit(adapter):
    line = json.dumps(
        {
            "event": "step_update",
            "step_update": {
                "state": "ACTIVE",
                "step_type": "tool",
                "tool_name": "write_to_file",
                "tool_info": {"name": "write_to_file", "parameters": {"TargetFile": "/proj/halo.txt"}},
            },
        }
    )
    events = adapter.parse_line(line)
    assert any(e.type == "tool_call" and e.data["name"] == "write_to_file" for e in events)
    edit = next(e for e in events if e.type == "file_edit")
    assert edit.data["path"] == "/proj/halo.txt"


def test_tool_done_state_does_not_duplicate_tool_call(adapter):
    """ACTIVE dan DONE datang berpasangan untuk tool yang sama."""
    done = json.dumps(
        {
            "event": "step_update",
            "step_update": {
                "state": "DONE",
                "step_type": "tool",
                "tool_name": "list_dir",
                "tool_info": {"name": "list_dir", "output": "..."},
            },
        }
    )
    assert [e for e in adapter.parse_line(done) if e.type == "tool_call"] == []


def test_tool_error_state_surfaces_error_detail(adapter):
    line = json.dumps(
        {
            "event": "step_update",
            "step_update": {
                "state": "ERROR",
                "step_type": "tool",
                "tool_name": "read_file",
                "tool_info": {"name": "read_file", "output": "denied"},
            },
        }
    )
    events = adapter.parse_line(line)
    assert events[0].data["error"] == "denied"


def test_result_success_is_final_output_with_usage(adapter):
    line = json.dumps(
        {
            "event": "result",
            "result": {
                "conversation_id": "conv-1",
                "status": "SUCCESS",
                "response": "SIAP",
                "usage": {"input_tokens": 13616, "output_tokens": 67, "total_tokens": 13683},
            },
        }
    )
    events = adapter.parse_line(line)
    usage = next(e for e in events if e.type == "usage")
    assert usage.data["total_tokens"] == 13683
    output = next(e for e in events if e.type == "output")
    assert output.data == {"text": "SIAP", "final": True}


def test_result_failure_becomes_error(adapter):
    line = json.dumps({"event": "result", "result": {"status": "ERROR", "response": "gagal total"}})
    events = adapter.parse_line(line)
    assert any(e.type == "error" and e.data["message"] == "gagal total" for e in events)


def test_headless_permission_denial_is_actionable_and_cascades(adapter):
    """Pesan ini keluar sebagai teks biasa, bukan JSON — harus tetap terdeteksi."""
    raw = (
        'jetski: no output produced — a tool required the "read_file" permission that '
        "headless mode cannot prompt for, so it was auto-denied."
    )
    events = adapter.parse_line(raw)
    assert events[0].type == "error"
    assert events[0].data["kind"] == ERROR_PERMISSION
    assert events[0].is_cascade_trigger, "target yang tak bisa bekerja harus dilewati"
    assert "mode otonom" in events[0].data["message"]


def test_add_dir_points_agy_at_the_workspace(adapter):
    cmd = adapter.build_command(
        "x", model=None, permission_mode="safe", project_path="/proj", resume_session_id=None
    )
    assert cmd[cmd.index("--add-dir") + 1] == "/proj"
    assert "--mode" in cmd and "accept-edits" in cmd

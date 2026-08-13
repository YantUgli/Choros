"""Parser daftar model per adapter — sampel diambil dari output CLI sungguhan."""

from __future__ import annotations

import pytest

from app.adapters.antigravity import AntigravityAdapter
from app.adapters.claude_code import ClaudeCodeAdapter
from app.adapters.opencode import OpenCodeAdapter


def test_claude_parse_models_from_available_line():
    stdout = (
        "Current model: Sonnet 5 (default)\n"
        "Usage: /model <name>. Available: sonnet, opus, haiku, fable, best, "
        "sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.\n"
    )
    models = ClaudeCodeAdapter(name="c", config={}).parse_models(stdout)
    assert models == [
        "sonnet", "opus", "haiku", "fable", "best",
        "sonnet[1m]", "opus[1m]", "fable[1m]", "opusplan", "default",
    ]


def test_claude_parse_models_empty_when_no_marker():
    assert ClaudeCodeAdapter(name="c", config={}).parse_models("no models here\n") == []


def test_opencode_parse_models_one_per_line():
    stdout = "opencode/big-pickle\nopencode/hy3-free\n\n  opencode/ling-3.0-tiny-free  \n"
    models = OpenCodeAdapter(name="o", config={}).parse_models(stdout)
    assert models == ["opencode/big-pickle", "opencode/hy3-free", "opencode/ling-3.0-tiny-free"]


def test_antigravity_parse_models_tab_separated_skips_header():
    stdout = (
        "Fetching available models...\n"
        "gemini-3.6-flash-high\tGemini 3.6 Flash (High)\n"
        "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n"
        "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n"
    )
    models = AntigravityAdapter(name="a", config={}).parse_models(stdout)
    assert models == ["gemini-3.6-flash-high", "claude-sonnet-4-6", "gpt-oss-120b-medium"]


@pytest.mark.parametrize(
    "cls,binary,expected_tail",
    [
        (ClaudeCodeAdapter, "claude", ["--print", "/model"]),
        (OpenCodeAdapter, "opencode", ["models"]),
        (AntigravityAdapter, "agy", ["models"]),
    ],
)
def test_list_models_command_shape(cls, binary, expected_tail):
    cmd = cls(name="x", config={}).list_models_command()
    assert cmd[0] == binary
    assert cmd[1:] == expected_tail

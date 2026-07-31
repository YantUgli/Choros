"""Normalisasi toleran untuk stream JSON harness yang formatnya belum pasti.

PRD §14 (provider drift): format stream tiap harness bisa berubah antar versi.
Alih-alih parser rapuh yang mengasumsikan satu bentuk, normalizer ini mencari
sinyal yang umum (teks, thinking, tool, usage, error) di kedalaman berapa pun,
lalu jatuh ke Event 'output' mentah kalau tidak dikenali — supaya live console
tidak pernah kosong hanya karena format berubah.
"""

from __future__ import annotations

import json
from typing import Any

from app.adapters.base import FILE_TOOLS, classify_failure_text
from app.events import ERROR_CRASH, Event

_TEXT_KEYS = ("text", "content", "message", "response", "output", "delta", "chunk")
_THINKING_KEYS = ("thinking", "reasoning", "thought", "reasoning_content")
_TOOL_KEYS = ("tool", "tool_name", "toolName", "name")
_PATH_KEYS = ("file_path", "filePath", "path", "filename", "file")
_USAGE_KEYS = ("usage", "tokens", "token_usage", "tokenUsage")


def normalize_generic(payload: Any) -> list[Event]:
    if isinstance(payload, str):
        return [Event.output(payload)] if payload.strip() else []
    if not isinstance(payload, dict):
        return []

    events: list[Event] = []

    err = _find_error(payload)
    if err:
        kind = classify_failure_text(err) or ERROR_CRASH
        return [Event.error(kind, err[:2000])]

    usage = _find_first(payload, _USAGE_KEYS)
    if isinstance(usage, dict):
        events.append(Event.usage(_normalize_usage(usage)))

    thinking = _first_string(payload, _THINKING_KEYS)
    if thinking:
        events.append(Event.thinking(thinking))

    tool = _find_tool(payload)
    if tool:
        name, tool_input = tool
        events.append(Event.tool_call(name, _compact(tool_input)))
        path = _find_first(tool_input if isinstance(tool_input, dict) else {}, _PATH_KEYS)
        if path and name.lower() in FILE_TOOLS:
            events.append(Event.file_edit(str(path), action=name.lower()))

    if not events or not thinking:
        text = _first_string(payload, _TEXT_KEYS)
        if text and text.strip():
            events.append(Event.output(text))

    return events


def _find_error(payload: dict[str, Any]) -> str | None:
    for key in ("error", "err", "exception"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, dict):
            return _stringify(value.get("message") or value)
    if payload.get("is_error") or payload.get("isError"):
        return _stringify(payload.get("result") or payload.get("message") or "error")
    return None


def _find_tool(payload: dict[str, Any]) -> tuple[str, Any] | None:
    ptype = str(payload.get("type") or payload.get("event") or "")
    looks_like_tool = "tool" in ptype.lower() or payload.get("type") == "tool_use"
    name: str | None = None
    for key in _TOOL_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value:
            name = value
            break
        if isinstance(value, dict):
            inner = value.get("name")
            if isinstance(inner, str):
                name = inner
                break
    if not name:
        for container in ("part", "properties", "data", "payload"):
            inner = payload.get(container)
            if isinstance(inner, dict):
                found = _find_tool(inner)
                if found:
                    return found
        return None
    if not looks_like_tool and name.lower() not in FILE_TOOLS:
        return None
    tool_input = payload.get("input") or payload.get("args") or payload.get("arguments") or {}
    return name, tool_input


def _first_string(payload: dict[str, Any], keys: tuple[str, ...], depth: int = 0) -> str | None:
    if depth > 4:
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, dict):
            nested = _first_string(value, keys, depth + 1)
            if nested:
                return nested
        if isinstance(value, list):
            parts = [_stringify(item) for item in value]
            joined = "\n".join(p for p in parts if p)
            if joined.strip():
                return joined
    for container in ("part", "properties", "data", "payload", "event"):
        inner = payload.get(container)
        if isinstance(inner, dict):
            nested = _first_string(inner, keys, depth + 1)
            if nested:
                return nested
    return None


def _find_first(payload: dict[str, Any], keys: tuple[str, ...], depth: int = 0) -> Any:
    if depth > 4 or not isinstance(payload, dict):
        return None
    for key in keys:
        if key in payload and payload[key] not in (None, "", {}):
            return payload[key]
    for container in ("part", "properties", "data", "payload", "event", "message"):
        inner = payload.get(container)
        if isinstance(inner, dict):
            found = _find_first(inner, keys, depth + 1)
            if found is not None:
                return found
    return None


def _normalize_usage(usage: dict[str, Any]) -> dict[str, Any]:
    def pick(*names: str) -> int:
        for name in names:
            value = usage.get(name)
            if isinstance(value, (int, float)):
                return int(value)
        return 0

    inp = pick("input_tokens", "inputTokens", "prompt_tokens", "input", "prompt")
    out = pick("output_tokens", "outputTokens", "completion_tokens", "output", "completion")
    cache_r = pick("cache_read_input_tokens", "cache_read", "cacheRead", "cached_tokens")
    cache_w = pick("cache_creation_input_tokens", "cache_write", "cacheWrite")
    total = pick("total_tokens", "totalTokens", "total") or (inp + out + cache_r + cache_w)
    result = {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_tokens": cache_r,
        "cache_write_tokens": cache_w,
        "total_tokens": total,
    }
    cost = usage.get("cost") or usage.get("cost_usd") or usage.get("total_cost_usd")
    if isinstance(cost, (int, float)):
        result["cost_usd"] = float(cost)
    return result


def _compact(value: Any, limit: int = 400) -> Any:
    text = _stringify(value)
    return text if len(text) <= limit else text[:limit] + "…"


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (_stringify(item) for item in value)))
    if isinstance(value, dict):
        if "text" in value and isinstance(value["text"], str):
            return value["text"]
        try:
            return json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(value)
    return str(value)

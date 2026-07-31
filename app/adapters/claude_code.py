from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.adapters.base import FILE_TOOLS, BaseCliAdapter, loads_or_none
from app.events import ERROR_CRASH, Event

CLAUDE_CONFIG = Path.home() / ".claude.json"


class ClaudeCodeAdapter(BaseCliAdapter):
    """Claude Code — langganan Claude, HANYA lewat harness resminya (PRD §3)."""

    adapter_type = "claude_code"
    binary = "claude"

    # ---------- trust ----------

    async def ensure_trusted(self, project_path: str) -> None:
        """Pre-seed `projects[path].hasTrustDialogAccepted` di ~/.claude.json."""
        path = str(Path(project_path).resolve())
        try:
            raw = json.loads(CLAUDE_CONFIG.read_text()) if CLAUDE_CONFIG.exists() else {}
        except (json.JSONDecodeError, OSError):
            return  # jangan rusak config user; jaring pengaman ada di auto-answer
        projects = raw.setdefault("projects", {})
        entry = projects.setdefault(path, {})
        if entry.get("hasTrustDialogAccepted") is True:
            return
        entry["hasTrustDialogAccepted"] = True
        entry.setdefault("projectOnboardingSeenCount", 1)
        entry.setdefault("hasCompletedProjectOnboarding", True)
        _atomic_write_json(CLAUDE_CONFIG, raw)

    # ---------- command ----------

    def build_command(
        self,
        prompt: str,
        *,
        model: str | None,
        permission_mode: str,
        project_path: str | None,
        resume_session_id: str | None,
    ) -> list[str]:
        cmd = [
            self.binary,
            "-p",
            prompt,
            "--output-format",
            "stream-json",
            "--verbose",
        ]
        if self.config.get("partial_messages", True):
            cmd.append("--include-partial-messages")
        if model:
            cmd += ["--model", model]
        if resume_session_id:
            cmd += ["--resume", resume_session_id]

        if permission_mode == "autonomous":
            cmd.append("--dangerously-skip-permissions")
        elif permission_mode == "plan":
            cmd += ["--permission-mode", "plan"]
        else:  # 'safe' — edit diterima, tool berbahaya tetap dibatasi
            cmd += ["--permission-mode", "acceptEdits"]
            allowed = self.config.get("allowed_tools")
            if allowed:
                cmd += ["--allowedTools", *allowed]

        for extra in self.config.get("add_dirs", []) or []:
            cmd += ["--add-dir", extra]
        return cmd

    # ---------- parsing stream-json ----------

    def parse_line(self, line: str) -> list[Event]:
        payload = loads_or_none(line)
        if payload is None:
            return [Event.output(line)]
        return _parse_claude_payload(payload, self)


def _parse_claude_payload(payload: dict[str, Any], adapter: BaseCliAdapter) -> list[Event]:
    kind = payload.get("type")
    events: list[Event] = []

    sid = payload.get("session_id")
    if sid and sid != adapter.session_id:
        adapter.session_id = sid
        events.append(Event.status("session dimulai", session_id=sid))

    if kind == "system":
        if payload.get("subtype") == "init":
            events.append(
                Event.status(
                    "harness siap",
                    tools=len(payload.get("tools") or []),
                    model=payload.get("model"),
                )
            )
        return events

    if kind == "assistant":
        message = payload.get("message") or {}
        # Kalau partial delta sudah dialirkan, teks/thinking versi utuh dilewati
        # supaya console tidak menampilkan isi yang sama dua kali.
        streamed = bool(getattr(adapter, "config", {}).get("partial_messages", True))
        for block in message.get("content") or []:
            events.extend(_parse_block(block, skip_text=streamed))
        usage = message.get("usage")
        if usage:
            events.append(Event.usage(_normalize_usage(usage)))
        return events

    if kind == "user":
        # hasil tool — ringkas saja supaya console tidak banjir
        message = payload.get("message") or {}
        for block in message.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                if block.get("is_error"):
                    text = _stringify(block.get("content"))
                    events.append(Event("tool_call", {"name": "tool_result", "error": text[:500]}))
        return events

    if kind == "stream_event":
        return _parse_partial(payload.get("event") or {})

    if kind == "result":
        text = payload.get("result")
        if payload.get("is_error"):
            message = _stringify(text) or payload.get("subtype") or "result error"
            from app.adapters.base import classify_failure_text

            events.append(Event.error(classify_failure_text(message) or ERROR_CRASH, message))
            return events
        usage = payload.get("usage")
        if usage:
            usage = _normalize_usage(usage)
            if payload.get("total_cost_usd") is not None:
                usage["cost_usd"] = payload["total_cost_usd"]
            events.append(Event.usage(usage))
        if text:
            # 'final' menandai jawaban utuh — dipakai runner sebagai hasil tugas,
            # dan oleh UI ditaruh di panel hasil, bukan diulang di log.
            events.append(Event("output", {"text": _stringify(text), "final": True}))
        events.append(Event.status("selesai", final=True))
        return events

    return events


def _parse_block(block: Any, *, skip_text: bool = False) -> list[Event]:
    if not isinstance(block, dict):
        return []
    btype = block.get("type")
    if btype == "text":
        if skip_text:
            return []
        text = block.get("text") or ""
        return [Event.output(text)] if text.strip() else []
    if btype == "thinking":
        if skip_text:
            return []
        text = block.get("thinking") or ""
        return [Event.thinking(text)] if text.strip() else []
    if btype == "tool_use":
        name = block.get("name") or "tool"
        tool_input = block.get("input") or {}
        events: list[Event] = [Event.tool_call(name, _compact_input(tool_input))]
        if name.lower() in FILE_TOOLS:
            path = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("notebook_path")
            if path:
                events.append(Event.file_edit(str(path), action=name.lower()))
        return events
    return []


def _parse_partial(event: dict[str, Any]) -> list[Event]:
    if event.get("type") != "content_block_delta":
        return []
    delta = event.get("delta") or {}
    dtype = delta.get("type")
    if dtype == "text_delta" and delta.get("text"):
        return [Event("output", {"text": delta["text"], "partial": True})]
    if dtype == "thinking_delta" and delta.get("thinking"):
        return [Event("thinking", {"text": delta["thinking"], "partial": True})]
    return []


def _normalize_usage(usage: dict[str, Any]) -> dict[str, Any]:
    inp = usage.get("input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    cache_r = usage.get("cache_read_input_tokens", 0) or 0
    cache_w = usage.get("cache_creation_input_tokens", 0) or 0
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_tokens": cache_r,
        "cache_write_tokens": cache_w,
        "total_tokens": inp + out + cache_r + cache_w,
    }


def _compact_input(tool_input: Any, limit: int = 400) -> Any:
    text = _stringify(tool_input)
    return text if len(text) <= limit else text[:limit] + "…"


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
            else:
                parts.append(_stringify(item))
        return "\n".join(p for p in parts if p)
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _atomic_write_json(path: Path, data: Any) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


__all__ = ["ClaudeCodeAdapter"]

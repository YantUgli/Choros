from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.adapters.base import BaseCliAdapter, classify_failure_text, loads_or_none
from app.adapters.generic import _normalize_usage, normalize_generic
from app.events import ERROR_CRASH, Event

OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "opencode.json"

# Tool opencode yang menyentuh file.
OPENCODE_FILE_TOOLS = {"edit", "write", "patch", "multiedit", "apply_patch"}


class OpenCodeAdapter(BaseCliAdapter):
    """opencode — harness generik untuk API key gratis/berbayar (Groq, Ollama, dst).

    PRD §3: langganan Claude/Antigravity TIDAK BOLEH ditaruh di sini. Adapter ini
    hanya untuk provider berbasis API key milik sendiri.

    Format stream opencode: satu objek per baris,
    `{"type": <nama>, "sessionID": ..., "part": {...}}`. Bagian `part` dikirim
    ulang setiap kali diperbarui dengan teks yang makin panjang — jadi teks
    dilacak per `part.id` dan yang dialirkan hanya selisihnya.
    """

    adapter_type = "opencode"
    binary = "opencode"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._parts: dict[str, str] = {}
        self._order: list[str] = []
        self._seen_tools: set[str] = set()

    async def ensure_trusted(self, project_path: str) -> None:
        """opencode tidak punya dialog trust; padanannya adalah permission.

        Mode otonom memakai flag `--auto` per-run, bukan mengubah config global
        user — izin penuh tetap terikat ke satu tugas, bukan ke seluruh mesin.
        """
        OPENCODE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        if self.config.get("write_permission_config") and not OPENCODE_CONFIG.exists():
            _atomic_write_json(OPENCODE_CONFIG, {"$schema": "https://opencode.ai/config.json"})

    def build_command(
        self,
        prompt: str,
        *,
        model: str | None,
        permission_mode: str,
        project_path: str | None,
        resume_session_id: str | None,
    ) -> list[str]:
        cmd = [self.binary, "run", "--format", "json"]
        if model:
            cmd += ["-m", model]
        if project_path:
            cmd += ["--dir", project_path]
        if resume_session_id:
            cmd += ["--session", resume_session_id]
        if permission_mode == "autonomous":
            cmd.append("--auto")
        agent = self.config.get("agent")
        if agent:
            cmd += ["--agent", str(agent)]
        variant = self.config.get("variant")
        if variant:
            cmd += ["--variant", str(variant)]
        cmd.append(prompt)
        return cmd

    def env_overrides(self) -> dict[str, str]:
        env: dict[str, str] = {}
        for key in self.config.get("env_keys", []) or []:
            value = os.environ.get(key)
            if value:
                env[key] = value
        return env

    # ---------- parsing ----------

    def parse_line(self, line: str) -> list[Event]:
        payload = loads_or_none(line)
        if payload is None:
            kind = classify_failure_text(line)
            return [Event.error(kind, line.strip())] if kind else [Event.output(line)]
        if not isinstance(payload, dict):
            return normalize_generic(payload)

        events: list[Event] = []
        session_id = payload.get("sessionID") or payload.get("session_id")
        if isinstance(session_id, str) and session_id and session_id != self.session_id:
            self.session_id = session_id
            events.append(Event.status("session dimulai", session_id=session_id))

        event_type = payload.get("type") or ""
        part = payload.get("part") if isinstance(payload.get("part"), dict) else {}
        part_type = part.get("type") or event_type

        if "error" in event_type.lower() or payload.get("error"):
            message = _stringify(payload.get("error") or part.get("error") or payload)
            events.append(Event.error(classify_failure_text(message) or ERROR_CRASH, message[:2000]))
            return events

        if part_type in ("text", "reasoning"):
            kind = "thinking" if part_type == "reasoning" else "output"
            delta = self._delta(part, track=part_type == "text")
            if delta:
                events.append(Event(kind, {"text": delta, "partial": True}))
            return events

        if part_type.startswith("tool"):
            events.extend(self._parse_tool(part))
            return events

        if part_type in ("step-finish", "step_finish"):
            tokens = part.get("tokens")
            if isinstance(tokens, dict):
                usage = _normalize_usage(_flatten_tokens(tokens))
                cost = part.get("cost")
                if isinstance(cost, (int, float)) and cost:
                    usage["cost_usd"] = float(cost)
                events.append(Event.usage(usage))
            return events

        return events

    def _delta(self, part: dict[str, Any], *, track: bool) -> str:
        """Ambil hanya bagian teks yang baru dari sebuah part."""
        text = part.get("text") or part.get("content") or ""
        if not isinstance(text, str) or not text:
            return ""
        part_id = str(part.get("id") or id(part))
        previous = self._parts.get(part_id, "")
        delta = text.removeprefix(previous)
        if track:
            if part_id not in self._parts:
                self._order.append(part_id)
            self._parts[part_id] = text
        return delta

    def _parse_tool(self, part: dict[str, Any]) -> list[Event]:
        state = part.get("state") if isinstance(part.get("state"), dict) else {}
        name = part.get("tool") or part.get("name") or state.get("title") or "tool"
        status = str(state.get("status") or part.get("status") or "")
        key = f"{part.get('id')}:{name}"
        events: list[Event] = []

        if status in ("error", "failed"):
            detail = _stringify(state.get("error") or state.get("output") or "tool gagal")
            return [Event("tool_call", {"name": name, "error": detail[:500]})]

        if key in self._seen_tools:
            return []  # part yang sama dikirim ulang tiap perubahan status
        self._seen_tools.add(key)

        tool_input = state.get("input") or part.get("input") or {}
        events.append(Event.tool_call(str(name), _compact(tool_input)))
        if str(name).lower() in OPENCODE_FILE_TOOLS:
            path = _file_path(tool_input)
            if path:
                events.append(Event.file_edit(path, action=str(name).lower()))
        return events

    def finalize(self) -> list[Event]:
        """opencode tidak punya event 'result' — jawaban dirakit dari part teks."""
        full = "\n".join(self._parts[pid] for pid in self._order if self._parts.get(pid)).strip()
        events: list[Event] = []
        if full:
            events.append(Event("output", {"text": full, "final": True}))
        events.append(Event.status("selesai", final=True))
        return events


def _flatten_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
    flat = {k: v for k, v in tokens.items() if isinstance(v, (int, float))}
    cache = tokens.get("cache")
    if isinstance(cache, dict):
        flat["cache_read"] = cache.get("read", 0) or 0
        flat["cache_write"] = cache.get("write", 0) or 0
    return flat


def _file_path(tool_input: Any) -> str | None:
    if not isinstance(tool_input, dict):
        return None
    for key in ("filePath", "file_path", "path", "filename"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _compact(value: Any, limit: int = 400) -> str:
    text = _stringify(value)
    return text if len(text) <= limit else text[:limit] + "…"


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def _atomic_write_json(path: Path, data: Any) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise

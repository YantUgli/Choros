from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from app.adapters.base import BaseCliAdapter, classify_failure_text, loads_or_none
from app.adapters.generic import _normalize_usage, normalize_generic
from app.events import ERROR_CRASH, ERROR_PERMISSION, Event

AGY_SETTINGS = Path.home() / ".gemini" / "antigravity-cli" / "settings.json"

# Tool agy yang menyentuh file → dinormalkan jadi Event 'file_edit'.
AGY_FILE_TOOLS = {
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "notebook_edit",
    "sed_file",
}

# agy headless tidak bisa menampilkan dialog izin, jadi tool yang butuh izin
# ditolak otomatis dan pesannya keluar sebagai teks biasa, bukan JSON.
_AUTO_DENIED = re.compile(
    r"(auto-denied|headless mode cannot prompt|permissions\.allow)", re.IGNORECASE
)


class AntigravityAdapter(BaseCliAdapter):
    """Antigravity (`agy`) — langganan AG, hanya lewat harness resminya.

    Format stream agy: satu objek per baris, `{"event": <nama>, <nama>: {...}}`.
    """

    adapter_type = "antigravity"
    binary = "agy"

    # ---------- trust ----------

    async def ensure_trusted(self, project_path: str) -> None:
        """Pre-seed `trustedWorkspaces` di ~/.gemini/antigravity-cli/settings.json.

        Bukan sekadar menghilangkan dialog: tanpa workspace yang trusted, agy
        mengerjakan tugas di direktori scratch-nya sendiri, bukan di project.
        """
        path = str(Path(project_path).resolve())
        try:
            raw = json.loads(AGY_SETTINGS.read_text()) if AGY_SETTINGS.exists() else {}
        except (json.JSONDecodeError, OSError):
            return
        trusted = raw.get("trustedWorkspaces") or []
        for entry in trusted:
            try:
                Path(path).relative_to(Path(entry).resolve())
                return  # sudah tercakup oleh parent yang trusted
            except (ValueError, OSError):
                continue
        trusted.append(path)
        raw["trustedWorkspaces"] = trusted
        AGY_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(AGY_SETTINGS, raw)

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
        cmd = [self.binary, "-p", prompt, "--output-format", "stream-json"]
        if model:
            cmd += ["--model", model]
        if resume_session_id:
            cmd += ["--conversation", resume_session_id]
        if permission_mode == "autonomous":
            cmd.append("--dangerously-skip-permissions")
        elif permission_mode == "plan":
            cmd += ["--mode", "plan"]
        else:
            cmd += ["--mode", "accept-edits"]
        effort = self.config.get("effort")
        if effort:
            cmd += ["--effort", str(effort)]
        if self.config.get("sandbox"):
            cmd.append("--sandbox")
        if project_path:
            cmd += ["--add-dir", project_path]
        for extra in self.config.get("add_dirs", []) or []:
            cmd += ["--add-dir", extra]
        return cmd

    # ---------- parsing ----------

    def parse_line(self, line: str) -> list[Event]:
        payload = loads_or_none(line)
        if payload is None:
            # baris non-JSON: biasanya pesan diagnostik agy sendiri
            if _AUTO_DENIED.search(line):
                return [
                    Event.error(
                        ERROR_PERMISSION,
                        f"{line.strip()} — jalankan tugas ini dalam mode otonom, "
                        "atau tambahkan allow-rule di settings.json agy.",
                    )
                ]
            kind = classify_failure_text(line)
            return [Event.error(kind, line.strip())] if kind else [Event.output(line)]

        if not isinstance(payload, dict):
            return normalize_generic(payload)

        name = payload.get("event")
        body = payload.get(name) if isinstance(payload.get(name), dict) else {}
        events: list[Event] = []

        conversation_id = payload.get("conversation_id") or body.get("conversation_id")
        if conversation_id and conversation_id != self.session_id:
            self.session_id = conversation_id
            events.append(Event.status("session dimulai", session_id=conversation_id))

        if name == "init":
            events.append(
                Event.status(
                    "harness siap",
                    tools=len(body.get("tools") or []),
                    permission_mode=body.get("permission_mode"),
                    cwd=body.get("cwd"),
                )
            )
            return events

        if name == "step_update":
            events.extend(self._parse_step(body))
            return events

        if name == "result":
            status = (body.get("status") or "").upper()
            usage = body.get("usage")
            if isinstance(usage, dict):
                events.append(Event.usage(_normalize_usage(usage)))
            if status and status != "SUCCESS":
                message = body.get("response") or status
                events.append(
                    Event.error(classify_failure_text(message) or ERROR_CRASH, str(message)[:2000])
                )
                return events
            response = body.get("response")
            if response:
                events.append(Event("output", {"text": response, "final": True}))
            events.append(Event.status("selesai", final=True))
            return events

        return events + normalize_generic(payload)

    def _parse_step(self, step: dict[str, Any]) -> list[Event]:
        events: list[Event] = []
        state = (step.get("state") or "").upper()
        step_type = step.get("step_type")

        usage = step.get("usage")
        if isinstance(usage, dict):
            events.append(Event.usage(_normalize_usage(usage)))

        # text_delta benar-benar inkremental (potongan terakhir datang dengan
        # state DONE), jadi semuanya digabung sebagai partial di live console.
        delta = step.get("text_delta")
        if delta:
            kind = "thinking" if step_type in ("thinking", "reasoning") else "output"
            events.append(Event(kind, {"text": delta, "partial": True}))

        if step_type == "tool":
            tool_name = step.get("tool_name") or "tool"
            info = step.get("tool_info") or {}
            params = info.get("parameters") if isinstance(info, dict) else None
            if state == "ACTIVE":
                events.append(Event.tool_call(tool_name, _compact(params or info)))
                target = _target_file(params)
                if target and tool_name in AGY_FILE_TOOLS:
                    events.append(Event.file_edit(target, action=tool_name))
            elif state == "ERROR":
                detail = _compact(info.get("output") if isinstance(info, dict) else info)
                events.append(
                    Event("tool_call", {"name": tool_name, "error": detail or "tool gagal"})
                )

        return events


def _target_file(params: Any) -> str | None:
    if not isinstance(params, dict):
        return None
    for key in ("TargetFile", "target_file", "AbsolutePath", "path", "file_path"):
        value = params.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _compact(value: Any, limit: int = 400) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


def _atomic_write_json(path: Path, data: Any) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise

"""Kontrak Event seragam (PRD §3).

Tiap adapter menormalkan stream harness-nya ke format ini, sehingga live console
tampil konsisten apa pun provider yang jalan.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

EventType = Literal[
    "thinking",  # reasoning agent
    "tool_call",  # agent memanggil tool
    "file_edit",  # agent menyentuh file
    "output",  # teks hasil
    "question",  # agent bertanya balik / minta izin → butuh jawaban user
    "usage",  # token/cost
    "error",  # gagal (lihat data['kind'])
    "status",  # event level-orchestrator (routing, fallback, halt)
]

# kind untuk Event(type='error') — dipakai orchestrator untuk memutuskan cascade
ERROR_RATE_LIMIT = "rate_limit"
ERROR_AUTH = "auth"
ERROR_TIMEOUT = "timeout"
ERROR_CRASH = "crash"
ERROR_NOT_INSTALLED = "not_installed"
# harness menolak tool karena izin, dan headless tidak bisa menanyakannya ke user
ERROR_PERMISSION = "permission_denied"

# kind yang berarti "target ini sedang tidak bisa dipakai" → lanjut ke target berikutnya
CASCADE_TRIGGERS = {
    ERROR_RATE_LIMIT,
    ERROR_AUTH,
    ERROR_CRASH,
    ERROR_NOT_INSTALLED,
    ERROR_TIMEOUT,
    ERROR_PERMISSION,
}


@dataclass(slots=True)
class Event:
    type: EventType
    data: dict[str, Any] = field(default_factory=dict)
    agent: str | None = None
    model: str | None = None
    ts: float = field(default_factory=time.time)

    def as_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "agent": self.agent,
            "model": self.model,
            "ts": self.ts,
            "data": self.data,
        }

    # --- konstruktor ringkas ---
    @classmethod
    def thinking(cls, text: str, **kw: Any) -> Event:
        return cls("thinking", {"text": text}, **kw)

    @classmethod
    def output(cls, text: str, **kw: Any) -> Event:
        return cls("output", {"text": text}, **kw)

    @classmethod
    def tool_call(cls, name: str, input_: Any = None, **kw: Any) -> Event:
        return cls("tool_call", {"name": name, "input": input_}, **kw)

    @classmethod
    def file_edit(cls, path: str, action: str = "edit", **kw: Any) -> Event:
        return cls("file_edit", {"path": path, "action": action}, **kw)

    @classmethod
    def question(cls, text: str, **kw: Any) -> Event:
        return cls("question", {"text": text}, **kw)

    @classmethod
    def usage(cls, usage: dict[str, Any], **kw: Any) -> Event:
        return cls("usage", dict(usage), **kw)

    @classmethod
    def error(cls, kind: str, message: str, **kw: Any) -> Event:
        return cls("error", {"kind": kind, "message": message}, **kw)

    @classmethod
    def status(cls, message: str, **extra: Any) -> Event:
        agent = extra.pop("agent", None)
        model = extra.pop("model", None)
        return cls("status", {"message": message, **extra}, agent=agent, model=model)

    @property
    def is_cascade_trigger(self) -> bool:
        return self.type == "error" and self.data.get("kind") in CASCADE_TRIGGERS

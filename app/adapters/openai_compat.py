from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.adapters.generic import _normalize_usage
from app.events import (
    ERROR_AUTH,
    ERROR_CRASH,
    ERROR_RATE_LIMIT,
    ERROR_TIMEOUT,
    Event,
)


class OpenAICompatAdapter:
    """Provider OpenAI-compatible mentah — OTAK SAJA (PRD §3).

    Tidak punya "tangan": tidak bisa membaca/menulis file atau menjalankan perintah.
    Dipakai untuk tugas teks/planning. Untuk eksekusi kode dengan model yang sama,
    rutekan lewat harness (opencode).
    """

    adapter_type = "openai_compatible"
    has_hands = False

    def __init__(
        self,
        *,
        name: str,
        config: dict[str, Any] | None = None,
        default_model: str | None = None,
        base_url: str | None = None,
        timeout: int = 1800,
    ) -> None:
        self.name = name
        self.config = config or {}
        self.default_model = default_model
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.timeout = timeout
        self.session_id: str | None = None

    def is_installed(self) -> bool:
        return bool(self._api_key()) or bool(self.config.get("allow_keyless"))

    def _api_key(self) -> str | None:
        env_name = self.config.get("api_key_env")
        if env_name:
            return os.environ.get(env_name)
        return None

    async def ensure_trusted(self, project_path: str) -> None:
        return None

    async def cancel(self) -> None:
        return None

    async def run(
        self,
        prompt: str,
        *,
        model: str | None = None,
        permission_mode: str = "safe",
        project_path: str | None = None,
        resume_session_id: str | None = None,
    ) -> AsyncIterator[Event]:
        model = model or self.default_model or "gpt-4o-mini"
        api_key = self._api_key()
        if not api_key and not self.config.get("allow_keyless"):
            yield Event.error(
                ERROR_AUTH,
                f"env {self.config.get('api_key_env')!r} kosong",
                agent=self.name,
                model=model,
            )
            return

        yield Event.status(
            "model mentah: otak tanpa tangan (tidak menyentuh file)",
            agent=self.name,
            model=model,
        )

        messages: list[dict[str, str]] = []
        system_prompt = self.config.get("system_prompt")
        if system_prompt:
            messages.append({"role": "system", "content": str(system_prompt)})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if self.config.get("temperature") is not None:
            payload["temperature"] = self.config["temperature"]
        if self.config.get("max_tokens"):
            payload["max_tokens"] = self.config["max_tokens"]

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        collected: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                ) as response:
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", "replace")
                        yield self._http_error(response, body, model)
                        return
                    async for line in response.aiter_lines():
                        for event in self._parse_sse(line, model):
                            if event.type == "output":
                                collected.append(event.data.get("text", ""))
                            yield event
        except httpx.TimeoutException:
            yield Event.error(ERROR_TIMEOUT, "request timeout", agent=self.name, model=model)
            return
        except httpx.HTTPError as exc:
            yield Event.error(ERROR_CRASH, f"http error: {exc}", agent=self.name, model=model)
            return

        yield Event.status("selesai", final=True, agent=self.name, model=model)

    def _http_error(self, response: httpx.Response, body: str, model: str) -> Event:
        if response.status_code == 429:
            retry_after = response.headers.get("retry-after")
            return Event(
                "error",
                {
                    "kind": ERROR_RATE_LIMIT,
                    "message": body[:1000] or "429 rate limited",
                    "retry_after": _to_float(retry_after),
                },
                agent=self.name,
                model=model,
            )
        if response.status_code in (401, 403):
            return Event.error(ERROR_AUTH, body[:1000], agent=self.name, model=model)
        return Event.error(
            ERROR_CRASH,
            f"HTTP {response.status_code}: {body[:1000]}",
            agent=self.name,
            model=model,
        )

    def _parse_sse(self, line: str, model: str) -> list[Event]:
        line = line.strip()
        if not line or not line.startswith("data:"):
            return []
        data = line[5:].strip()
        if data == "[DONE]":
            return []
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return []

        events: list[Event] = []
        usage = payload.get("usage")
        if isinstance(usage, dict):
            events.append(Event.usage(_normalize_usage(usage), agent=self.name, model=model))
        for choice in payload.get("choices") or []:
            delta = choice.get("delta") or {}
            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
            if reasoning:
                events.append(
                    Event("thinking", {"text": reasoning, "partial": True}, agent=self.name, model=model)
                )
            content = delta.get("content")
            if content:
                events.append(
                    Event("output", {"text": content, "partial": True}, agent=self.name, model=model)
                )
        return events


def _to_float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None

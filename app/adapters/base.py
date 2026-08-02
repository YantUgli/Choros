from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
from collections.abc import AsyncIterator, Sequence
from typing import Any, Protocol, runtime_checkable

from app.events import (
    ERROR_AUTH,
    ERROR_CRASH,
    ERROR_NOT_INSTALLED,
    ERROR_RATE_LIMIT,
    ERROR_TIMEOUT,
    Event,
)
from app.runtime import subprocess_unsupported_message

# Pola yang menandakan "target ini sedang mentok kuota" pada teks harness.
_RATE_LIMIT_PATTERNS = re.compile(
    r"(429|rate[_ -]?limit|too many requests|quota (exceeded|exhausted)|"
    r"usage limit reached|out of (credits|tokens)|insufficient_quota|"
    r"resource[_ ]exhausted|overloaded_error)",
    re.IGNORECASE,
)
_AUTH_PATTERNS = re.compile(
    r"(401|403|unauthorized|authentication[_ ]error|invalid[_ ]api[_ ]key|"
    r"not logged in|please (run )?login|credentials? (not found|missing))",
    re.IGNORECASE,
)

# Tool yang berarti agent menyentuh file → dinormalkan jadi Event 'file_edit'.
FILE_TOOLS = {
    "edit",
    "write",
    "multiedit",
    "notebookedit",
    "str_replace_editor",
    "create_file",
    "apply_patch",
    "replace",
    "write_file",
}


def classify_failure_text(text: str) -> str | None:
    """Kembalikan kind error dari teks bebas, atau None kalau bukan kegagalan dikenal."""
    if _RATE_LIMIT_PATTERNS.search(text):
        return ERROR_RATE_LIMIT
    if _AUTH_PATTERNS.search(text):
        return ERROR_AUTH
    return None


@runtime_checkable
class AgentAdapter(Protocol):
    """Kontrak adapter (PRD §3), streaming-aware."""

    adapter_type: str

    async def ensure_trusted(self, project_path: str) -> None:
        """Pre-seed trust folder ke config harness SEBELUM agent jalan."""
        ...

    def run(
        self,
        prompt: str,
        *,
        model: str | None = None,
        permission_mode: str = "safe",
        project_path: str | None = None,
        resume_session_id: str | None = None,
    ) -> AsyncIterator[Event]:
        ...


class BaseCliAdapter:
    """Adapter berbasis CLI subprocess.

    Subclass menyediakan `build_command()` dan `parse_line()`; kelas ini mengurus
    spawn, baca stdout baris-per-baris, drain stderr, timeout, dan deteksi
    kegagalan (429/auth) dari stderr maupun exit code.
    """

    adapter_type: str = "base"
    binary: str = ""

    def __init__(
        self,
        *,
        name: str,
        config: dict[str, Any] | None = None,
        default_model: str | None = None,
        base_url: str | None = None,
        timeout: int = 1800,
        home: str | None = None,
    ) -> None:
        self.name = name
        self.config = config or {}
        self.default_model = default_model
        self.base_url = base_url
        self.timeout = timeout
        self.session_id: str | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self.home = home

    # ---------- hook subclass ----------

    def build_command(
        self,
        prompt: str,
        *,
        model: str | None,
        permission_mode: str,
        project_path: str | None,
        resume_session_id: str | None,
    ) -> list[str]:
        raise NotImplementedError

    def parse_line(self, line: str) -> list[Event]:
        """Normalkan satu baris stdout harness jadi 0..n Event."""
        raise NotImplementedError

    def finalize(self) -> list[Event]:
        """Event penutup setelah stream habis.

        Untuk harness yang tidak punya event 'result' (mis. opencode), di sinilah
        jawaban utuh dirakit dari potongan yang sudah lewat.
        """
        return []

    def env_overrides(self) -> dict[str, str]:
        return {}

    def build_env(self) -> dict[str, str]:
        """Environment untuk subprocess harness.

        `home` diisi hanya kalau user punya credential_home. HOME kosong berarti
        warisi environment server — perilaku single-user sejak Fase 1.
        """
        env = {**os.environ, **self.env_overrides()}
        if self.home:
            env["HOME"] = self.home
            env["USERPROFILE"] = self.home  # Windows membaca ini, bukan HOME
        return env

    def prompt_via_stdin(self) -> str | None:
        """Kalau harness menerima prompt lewat stdin, kembalikan payload-nya."""
        return None

    async def ensure_trusted(self, project_path: str) -> None:  # pragma: no cover - default no-op
        return None

    # ---------- util ----------

    def _tag(self, events: Sequence[Event], model: str | None) -> list[Event]:
        for ev in events:
            ev.agent = ev.agent or self.name
            ev.model = ev.model or model or self.default_model
        return list(events)

    def is_installed(self) -> bool:
        return bool(self.binary) and shutil.which(self.binary) is not None

    async def cancel(self) -> None:
        proc = self._proc
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except TimeoutError:
                proc.kill()

    # ---------- eksekusi ----------

    async def run(
        self,
        prompt: str,
        *,
        model: str | None = None,
        permission_mode: str = "safe",
        project_path: str | None = None,
        resume_session_id: str | None = None,
    ) -> AsyncIterator[Event]:
        model = model or self.default_model

        if not self.is_installed():
            yield Event.error(
                ERROR_NOT_INSTALLED,
                f"binary '{self.binary}' tidak ditemukan di PATH",
                agent=self.name,
                model=model,
            )
            return

        cmd = self.build_command(
            prompt,
            model=model,
            permission_mode=permission_mode,
            project_path=project_path,
            resume_session_id=resume_session_id,
        )
        env = self.build_env()
        stderr_chunks: list[str] = []

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=project_path or None,
                env=env,
                limit=4 * 1024 * 1024,
            )
        except NotImplementedError:
            # Bukan kegagalan harness: loop-nya yang tidak punya dukungan
            # subprocess. Tanpa pesan ini yang muncul cuma `NotImplementedError()`.
            yield Event.error(
                ERROR_CRASH,
                subprocess_unsupported_message(asyncio.get_running_loop()),
                agent=self.name,
                model=model,
            )
            return
        except OSError as exc:
            yield Event.error(ERROR_CRASH, f"gagal menjalankan {cmd[0]}: {exc}",
                              agent=self.name, model=model)
            return

        self._proc = proc

        async def drain_stderr() -> None:
            assert proc.stderr is not None
            async for raw in proc.stderr:
                stderr_chunks.append(raw.decode("utf-8", "replace"))

        stderr_task = asyncio.create_task(drain_stderr())

        stdin_payload = self.prompt_via_stdin()
        assert proc.stdin is not None
        if stdin_payload is not None:
            proc.stdin.write(stdin_payload.encode())
            await proc.stdin.drain()
        proc.stdin.close()

        try:
            async with asyncio.timeout(self.timeout):
                assert proc.stdout is not None
                async for raw in proc.stdout:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    try:
                        events = self.parse_line(line)
                    except Exception as exc:  # parser tak boleh menjatuhkan run
                        events = [Event.error(ERROR_CRASH, f"parse gagal: {exc} | {line[:200]}")]
                    for ev in self._tag(events, model):
                        yield ev
                await proc.wait()
        except TimeoutError:
            await self.cancel()
            yield Event.error(
                ERROR_TIMEOUT,
                f"attempt melewati batas {self.timeout}s",
                agent=self.name,
                model=model,
            )
            return
        except asyncio.CancelledError:
            await self.cancel()
            raise
        finally:
            stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stderr_task

        stderr_text = "".join(stderr_chunks).strip()
        if proc.returncode in (0, None):
            for ev in self._tag(self.finalize(), model):
                yield ev

        if proc.returncode not in (0, None):
            kind = classify_failure_text(stderr_text) or ERROR_CRASH
            yield Event.error(
                kind,
                stderr_text[-2000:] or f"{self.binary} keluar dengan kode {proc.returncode}",
                agent=self.name,
                model=model,
            )
        elif stderr_text:
            kind = classify_failure_text(stderr_text)
            if kind:
                yield Event.error(kind, stderr_text[-2000:], agent=self.name, model=model)


def loads_or_none(line: str) -> Any | None:
    try:
        return json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None

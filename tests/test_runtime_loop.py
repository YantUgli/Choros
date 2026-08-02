"""Guard event loop: Windows + SelectorEventLoop = nol harness CLI bisa jalan.

Dulu kombinasi ini muncul sebagai `crash orchestrator gagal: NotImplementedError()`
tanpa satu pun petunjuk, dan membunuh seluruh tugas alih-alih satu target.
Test di sini menjalankan loop Selector sungguhan, bukan mock.
"""

from __future__ import annotations

import asyncio
import sys

import pytest

from app.adapters.base import BaseCliAdapter
from app.events import Event
from app.runtime import loop_supports_subprocess, subprocess_unsupported_message

windows_only = pytest.mark.skipif(
    sys.platform != "win32", reason="hanya Windows yang punya loop tanpa subprocess"
)


class EchoAdapter(BaseCliAdapter):
    binary = sys.executable

    def build_command(self, prompt, *, model, permission_mode, project_path, resume_session_id):
        return [sys.executable, "-c", "print('halo')"]

    def parse_line(self, line: str) -> list[Event]:
        return [Event.output(line)]


async def _collect(adapter: BaseCliAdapter) -> list[Event]:
    return [ev async for ev in adapter.run("prompt")]


@windows_only
def test_e1_selector_ditolak_proactor_diterima():
    """E1: deteksi loop memisahkan Selector (tak bisa) dari Proactor (bisa)."""
    selector = asyncio.SelectorEventLoop()
    proactor = asyncio.ProactorEventLoop()
    try:
        assert loop_supports_subprocess(selector) is False
        assert loop_supports_subprocess(proactor) is True
    finally:
        selector.close()
        proactor.close()


@windows_only
def test_e2_adapter_di_loop_selector_beri_error_yang_menjelaskan():
    """E2: subprocess gagal spawn -> Event error berisi perbaikannya, bukan exception."""
    loop = asyncio.SelectorEventLoop()
    try:
        events = loop.run_until_complete(_collect(EchoAdapter(name="echo")))
    finally:
        loop.close()

    assert [ev.type for ev in events] == ["error"]
    pesan = events[0].data["message"]
    assert "tidak bisa menjalankan subprocess" in pesan
    assert "--loop asyncio:ProactorEventLoop" in pesan
    assert events[0].agent == "echo"


def test_e3_adapter_di_loop_proactor_tetap_jalan():
    """E3: guard tidak menghalangi loop yang memang sanggup (kontrol negatif)."""
    factory = asyncio.ProactorEventLoop if sys.platform == "win32" else asyncio.SelectorEventLoop
    loop = factory()
    try:
        events = loop.run_until_complete(_collect(EchoAdapter(name="echo")))
    finally:
        loop.close()

    assert [ev.type for ev in events] == ["output"]
    assert events[0].data["text"] == "halo"


@windows_only
def test_e4_lifespan_menolak_boot_di_loop_selector():
    """E4: guard dicek sebelum DB disentuh -> server menolak start, bukan mati saat tugas pertama."""
    from app.main import app, lifespan

    async def boot() -> None:
        async with lifespan(app):
            pass

    loop = asyncio.SelectorEventLoop()
    try:
        with pytest.raises(RuntimeError, match="ProactorEventLoop"):
            loop.run_until_complete(boot())
    finally:
        loop.close()


def test_e5_pesan_menyebut_nama_loop_yang_dipakai():
    """E5: pesan menyebut loop yang benar-benar berjalan, supaya diagnosisnya tidak menebak."""
    loop = asyncio.SelectorEventLoop()
    try:
        assert type(loop).__name__ in subprocess_unsupported_message(loop)
    finally:
        loop.close()

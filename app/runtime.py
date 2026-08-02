"""Kemampuan event loop yang dibutuhkan choros.

Seluruh harness langganan dijalankan sebagai subprocess (`BaseCliAdapter`). Di
Windows, SelectorEventLoop tidak mendukung subprocess sama sekali:
`asyncio.create_subprocess_exec` melempar `NotImplementedError` telanjang yang
tidak menjelaskan apa pun.

uvicorn memilih loop itu setiap kali `--reload` atau `--workers > 1` aktif
(`uvicorn/loops/asyncio.py`: `if win32 and not use_subprocess -> Proactor`,
selain itu Selector). Artinya dev-server default di Windows mematikan SEMUA
adapter CLI sekaligus — bukan satu target, melainkan seluruh rantai cascade.
"""

from __future__ import annotations

import asyncio
import sys

# Dipakai di dua tempat (guard startup + pesan error adapter). Ditulis sekali
# supaya tidak ada versi yang menyesatkan saat perintahnya berubah.
LOOP_FIX_HINT = (
    "jalankan uvicorn tanpa --reload, atau tambahkan flag "
    "--loop asyncio:ProactorEventLoop"
)


def loop_supports_subprocess(loop: asyncio.AbstractEventLoop) -> bool:
    """False hanya untuk loop yang benar-benar tidak bisa spawn subprocess."""
    if sys.platform != "win32":
        return True
    # Daftar-tolak, bukan daftar-izin: di Windows hanya SelectorEventLoop yang
    # tidak punya dukungan subprocess. Proactor dan loop pihak ketiga berbasis
    # IOCP tetap lolos tanpa perlu didaftarkan di sini.
    return not isinstance(loop, asyncio.SelectorEventLoop)


def subprocess_unsupported_message(loop: asyncio.AbstractEventLoop) -> str:
    return (
        f"event loop {type(loop).__name__} tidak bisa menjalankan subprocess, "
        f"jadi tidak ada satu pun harness CLI yang bisa dipakai — {LOOP_FIX_HINT}"
    )

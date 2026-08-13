"""Daftar model per adapter, ditanyakan live ke CLI dengan cache.

Perintah list-model CLI (terutama `agy models`) lambat karena menembak jaringan,
jadi hasilnya di-cache dengan TTL pendek dan panggilan serempak untuk adapter yang
sama dibagi lewat satu task in-flight. Kalau CLI gagal/tak terpasang, dipakai
daftar fallback statis supaya UI tetap bisa memilih model.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.adapters.registry import ADAPTERS, build_bare_adapter

# Fallback statis — cerminan sisi-server dari katalogModel.ts. Dipakai hanya kalau
# query CLI kosong/gagal.
FALLBACK_MODELS: dict[str, list[str]] = {
    "claude_code": ["sonnet", "opus", "haiku", "default"],
    "antigravity": ["default"],
    "opencode": [],
    "openai_compatible": ["gpt-4o", "gpt-4o-mini"],
}

_TTL_SECONDS = 300.0
# Negative-cache pendek untuk hasil fallback (CLI gagal/lambat) agar modal yang
# dibuka berkali-kali tidak men-spawn ulang proses lambat seperti `agy models`.
_NEG_TTL_SECONDS = 30.0

# adapter_type -> (kadaluarsa_monotonic, models, source)
_cache: dict[str, tuple[float, list[str], str]] = {}
_inflight: dict[str, asyncio.Task[tuple[list[str], str]]] = {}


def _fallback(adapter_type: str) -> list[str]:
    return list(FALLBACK_MODELS.get(adapter_type, []))


async def _query(adapter_type: str) -> tuple[list[str], str]:
    """Panggil CLI adapter; jatuh ke fallback statis kalau kosong."""
    adapter = build_bare_adapter(adapter_type)
    models: list[str] = []
    if hasattr(adapter, "list_models"):
        models = await adapter.list_models()
    if models:
        return models, "cli"
    return _fallback(adapter_type), "fallback"


async def get_models(adapter_type: str, *, refresh: bool = False) -> dict[str, Any]:
    """Kembalikan {adapter_type, models, source, cached}.

    source: "cli" (dari CLI), "fallback" (statis), atau "unknown" (adapter tak dikenal).
    """
    if adapter_type not in ADAPTERS:
        return {"adapter_type": adapter_type, "models": [], "source": "unknown", "cached": False}

    now = time.monotonic()
    if not refresh:
        hit = _cache.get(adapter_type)
        if hit and hit[0] > now:
            return {
                "adapter_type": adapter_type,
                "models": list(hit[1]),
                "source": hit[2],
                "cached": True,
            }

    # Bagikan satu query untuk pemanggil serempak dengan adapter yang sama.
    task = _inflight.get(adapter_type)
    if task is None:
        task = asyncio.ensure_future(_query(adapter_type))
        _inflight[adapter_type] = task
        try:
            models, source = await task
        finally:
            _inflight.pop(adapter_type, None)
        ttl = _TTL_SECONDS if source == "cli" else _NEG_TTL_SECONDS
        _cache[adapter_type] = (now + ttl, list(models), source)
    else:
        models, source = await task

    return {"adapter_type": adapter_type, "models": list(models), "source": source, "cached": False}

"""Batas bawah kualitas per step (PRD §6.2).

"Jangan fallback ke model di bawah ambang mutu step. Lebih baik berhenti daripada
menghasilkan kode rusak yang mahal diperbaiki."

Tier bersifat kasar dan by design bisa ditimpa: peringkat model berubah cepat, jadi
tabel ini hanya default yang boleh di-override lewat `agents.config['tier']` atau
`CHOROS_MODEL_TIERS`.
"""

from __future__ import annotations

import re

# tier: makin tinggi makin mampu. Dipakai hanya untuk perbandingan relatif.
TIER_FRONTIER = 40  # reasoning kelas atas
TIER_STRONG = 30  # kerja coding harian
TIER_MID = 20  # cukup untuk tugas mekanis terarah
TIER_LIGHT = 10  # draft/bulk
TIER_UNKNOWN = 15  # default konservatif untuk model tak dikenal

_PATTERNS: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"opus", re.IGNORECASE), TIER_FRONTIER),
    (re.compile(r"gpt-5|o[34](-|$)|gemini-3\.5-pro|gemini-3-pro", re.IGNORECASE), TIER_FRONTIER),
    (re.compile(r"sonnet", re.IGNORECASE), TIER_STRONG),
    (re.compile(r"gemini-.*-pro|gpt-4\.1|gpt-4o(?!-mini)", re.IGNORECASE), TIER_STRONG),
    (re.compile(r"llama-?3\.[13]-70b|llama-?3\.3|qwen.*(72b|coder-32b)|deepseek", re.IGNORECASE), TIER_STRONG),
    # OpenCode Zen — kelas atas dari daftar gratisnya.
    (
        re.compile(
            r"^(glm-\d|minimax-m\d|kimi-k\d|qwen3\.\d+-plus|ring-[\d.]+-1t"
            r"|mimo-v\d+-pro|nemotron-\d+-ultra|grok-code)",
            re.IGNORECASE,
        ),
        TIER_STRONG,
    ),
    (re.compile(r"gemini-.*flash|haiku|gpt-oss-120b|mixtral", re.IGNORECASE), TIER_MID),
    # OpenCode Zen — kelas menengah. Harus di atas pola TIER_LIGHT: nama seperti
    # "minimax-*" dan "north-mini-code-*" mengandung "mini" dan akan salah turun
    # ke TIER_LIGHT kalau pola generik di bawah yang menangkap duluan.
    (
        re.compile(
            r"^(big-pickle|ling-[\d.]+-flash|mimo-v[\d.]+|laguna-s|hy3"
            r"|north-mini-code|nemotron-\d+-super|trinity-large)",
            re.IGNORECASE,
        ),
        TIER_MID,
    ),
    (re.compile(r"gpt-oss-20b|llama-?3\.[12]-8b|8b|7b|mini|small|lite", re.IGNORECASE), TIER_LIGHT),
]


def model_tier(model: str | None, *, override: int | None = None) -> int:
    if override is not None:
        return int(override)
    if not model:
        return TIER_UNKNOWN
    name = model.split("/")[-1]
    for pattern, tier in _PATTERNS:
        if pattern.search(name):
            return tier
    return TIER_UNKNOWN


def meets_floor(model: str | None, floor: str | None, *, override: int | None = None) -> bool:
    """True kalau `model` layak dipakai untuk step dengan batas bawah `floor`.

    `floor` boleh berupa nama model ("sonnet") atau nama tier ("strong").
    """
    if not floor:
        return True
    return model_tier(model, override=override) >= _floor_tier(floor)


def _floor_tier(floor: str) -> int:
    named = {
        "frontier": TIER_FRONTIER,
        "strong": TIER_STRONG,
        "mid": TIER_MID,
        "light": TIER_LIGHT,
        "any": 0,
    }
    key = floor.strip().lower()
    if key in named:
        return named[key]
    return model_tier(floor)

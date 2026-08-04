from __future__ import annotations

import asyncio
import logging
import re
import time

from fastapi import APIRouter

from app.security import CurrentUser

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quota", tags=["quota"])

# Contoh baris yang di-parse:
#   Current session: 33% used · resets Aug 4, 3:40pm (WIB)
#   Current week (all models): 55% used · resets Aug 8, 9:00am (WIB)
_SESSION_RE = re.compile(
    r"Current session:\s*(\d+)%\s+used\s*[·•]\s*resets\s+(.+?)(?:\s*\(|$)",
    re.IGNORECASE,
)
_WEEK_RE = re.compile(
    r"Current week[^:]*:\s*(\d+)%\s+used\s*[·•]\s*resets\s+(.+?)(?:\s*\(|$)",
    re.IGNORECASE,
)


def _parse_claude_output(text: str) -> dict:
    result: dict = {}
    for line in text.splitlines():
        m = _SESSION_RE.search(line)
        if m:
            result["session"] = {"pct_used": int(m.group(1)), "resets_at": m.group(2).strip()}
            continue
        m = _WEEK_RE.search(line)
        if m:
            result["week"] = {"pct_used": int(m.group(1)), "resets_at": m.group(2).strip()}
    return result


@router.get("/claude-usage")
async def claude_usage(_user: CurrentUser) -> dict:
    t0 = time.perf_counter()
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "--print",
            "/usage",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        t1 = time.perf_counter()
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        t2 = time.perf_counter()
    except FileNotFoundError:
        return {"error": "claude_not_found"}
    except TimeoutError:
        return {"error": "timeout"}
    except Exception as exc:
        return {"error": "subprocess_error", "detail": str(exc)}

    raw = stdout.decode(errors="replace")
    parsed = _parse_claude_output(raw)
    log.warning(
        "[claude-usage] spawn=%.0fms | communicate=%.0fms | total=%.0fms",
        (t1 - t0) * 1000,
        (t2 - t1) * 1000,
        (t2 - t0) * 1000,
    )
    return {
        "session": parsed.get("session"),
        "week": parsed.get("week"),
        "raw": raw,
    }

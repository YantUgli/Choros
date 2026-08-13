from __future__ import annotations

import asyncio
import ctypes
import ctypes.util
import json
import logging
import re
import sys
import time
from datetime import datetime, timedelta, timezone
import os

import httpx
from fastapi import APIRouter

from app.security import CurrentUser

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quota", tags=["quota"])

QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Kredensial OAuth "Desktop app" milik antigravity CLI, tertanam di binary `agy`.
# Bukan rahasia sejati (siapa pun bisa mengekstraknya dari binary) — hanya bisa
# me-refresh token yang sudah diotorisasi user. Keyring agy cuma menyimpan `token`
# (access/refresh/expiry), bukan client_id/secret, padahal grant refresh_token
# Google WAJIB menyertakan keduanya. Tanpa ini refresh selalu 400 → "token_expired",
# sehingga token hanya bisa diperbarui dengan menjalankan agy manual.
AGY_CLIENT_ID = os.getenv("AGY_CLIENT_ID")
AGY_CLIENT_SECRET = os.getenv("AGY_CLIENT_SECRET")


def _platform_supported() -> bool:
    if sys.platform == "win32":
        return True  # CredReadW selalu tersedia di Windows, tidak perlu find_library
    return bool(ctypes.util.find_library("secret-1"))


# Dievaluasi sekali saat modul dimuat — hasilnya tidak berubah selama proses hidup
_LIB_AVAILABLE: bool = _platform_supported()

# HTTP client persisten — reuse TCP connection (keep-alive) antar request
_http_client: httpx.AsyncClient = httpx.AsyncClient(
    headers={"User-Agent": "antigravity/cli/1.0.0", "Content-Type": "application/json"},
    timeout=10,
)

# Cache token di memory — hanya baca keyring lagi kalau token expired (401)
_cached_token: str | None = None
# Refresh credentials — di-populate saat pertama baca keyring
_cached_refresh_creds: dict | None = None
# Waktu kedaluwarsa access token yang di-cache (tz-aware). None = tidak diketahui.
_cached_expiry: datetime | None = None
# Refresh sedikit sebelum benar-benar mati agar tak ada request yang kena 401.
_EXPIRY_SKEW = timedelta(seconds=60)


def _parse_expiry(raw: object) -> datetime | None:
    """Parse `expiry` keyring agy. Pecahan detiknya 9 digit (nanodetik), jadi
    dipangkas ke 6 digit dulu supaya diterima datetime.fromisoformat."""
    if not isinstance(raw, str) or not raw:
        return None
    trimmed = re.sub(r"(\.\d{6})\d+", r"\1", raw)
    try:
        return datetime.fromisoformat(trimmed)
    except ValueError:
        return None


def _token_expiring() -> bool:
    """True kalau token cache sudah/hampir kedaluwarsa (dalam skew)."""
    if _cached_expiry is None:
        return False  # expiry tak diketahui → jangan refresh proaktif, andalkan 401
    return datetime.now(timezone.utc) >= _cached_expiry - _EXPIRY_SKEW


def _read_keyring_token_linux() -> str | None:
    """Baca access token agy dari GNOME keyring via libsecret (ctypes, tanpa schema).
    Dipanggil dari thread pool — jangan panggil langsung dari async handler."""
    lib_s = ctypes.util.find_library("secret-1")
    lib_g = ctypes.util.find_library("glib-2.0")
    if not lib_s or not lib_g:
        return None
    try:
        ls = ctypes.cdll.LoadLibrary(lib_s)
        lg = ctypes.cdll.LoadLibrary(lib_g)
    except OSError:
        return None

    # SECRET_SERVICE_OPEN_SESSION=2 wajib agar bisa baca secret value
    ls.secret_service_get_sync.restype = ctypes.c_void_p
    ls.secret_service_get_sync.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p]
    svc = ls.secret_service_get_sync(2, None, None)
    if not svc:
        return None

    lg.g_hash_table_new.restype = ctypes.c_void_p
    lg.g_hash_table_new.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    lg.g_hash_table_insert.restype = ctypes.c_int
    lg.g_hash_table_insert.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    attrs = lg.g_hash_table_new(lg.g_str_hash, lg.g_str_equal)
    lg.g_hash_table_insert(attrs, ctypes.c_char_p(b"service"), ctypes.c_char_p(b"gemini"))
    lg.g_hash_table_insert(attrs, ctypes.c_char_p(b"username"), ctypes.c_char_p(b"antigravity"))

    # SECRET_SEARCH_UNLOCK=1 | SECRET_SEARCH_LOAD_SECRETS=4
    ls.secret_service_search_sync.restype = ctypes.c_void_p
    ls.secret_service_search_sync.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int,
        ctypes.c_void_p, ctypes.c_void_p,
    ]
    glist = ls.secret_service_search_sync(svc, None, attrs, 5, None, None)
    if not glist:
        return None

    class _GList(ctypes.Structure):
        _fields_ = [("data", ctypes.c_void_p), ("next", ctypes.c_void_p), ("prev", ctypes.c_void_p)]

    item_ptr = ctypes.cast(glist, ctypes.POINTER(_GList)).contents.data
    if not item_ptr:
        return None

    ls.secret_item_load_secret_sync.restype = ctypes.c_int
    ls.secret_item_load_secret_sync.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    ls.secret_item_load_secret_sync(item_ptr, None, None)

    ls.secret_item_get_secret.restype = ctypes.c_void_p
    ls.secret_item_get_secret.argtypes = [ctypes.c_void_p]
    sec_val = ls.secret_item_get_secret(item_ptr)
    if not sec_val:
        return None

    ls.secret_value_get_text.restype = ctypes.c_char_p
    ls.secret_value_get_text.argtypes = [ctypes.c_void_p]
    text = ls.secret_value_get_text(sec_val)
    if not text:
        return None

    try:
        data = json.loads(text.decode())
        return data.get("token") or None
    except (json.JSONDecodeError, AttributeError):
        return None


# TargetName dan format blob dikonfirmasi via `cmdkey /list` + CredReadW manual
# (lihat docs/rencana-quota-windows.md, langkah W1): Type=Generic,
# TargetName="gemini:antigravity", blob JSON UTF-8 polos — skema sama persis
# dengan Linux (`{"token": {"access_token": "..."}}`).
_CRED_TARGET_NAME = "gemini:antigravity"
_CRED_TYPE_GENERIC = 1


def _read_keyring_token_windows() -> str | None:
    """Baca access token agy dari Windows Credential Manager via advapi32 CredReadW.
    Dipanggil dari thread pool — jangan panggil langsung dari async handler."""
    from ctypes import wintypes

    class _CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_char)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    advapi32 = ctypes.windll.advapi32
    advapi32.CredReadW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(_CREDENTIAL)),
    ]
    advapi32.CredReadW.restype = wintypes.BOOL

    cred_ptr = ctypes.POINTER(_CREDENTIAL)()
    ok = advapi32.CredReadW(_CRED_TARGET_NAME, _CRED_TYPE_GENERIC, 0, ctypes.byref(cred_ptr))
    if not ok:
        return None
    try:
        c = cred_ptr.contents
        blob = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize)
        data = json.loads(blob.decode("utf-8"))
        return data.get("token") or None
    except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
        return None
    finally:
        advapi32.CredFree(cred_ptr)


def _read_keyring_token() -> dict | None:
    if sys.platform == "win32":
        return _read_keyring_token_windows()
    return _read_keyring_token_linux()


async def _get_token() -> str | None:
    """Kembalikan token dari cache, atau baca dari keyring di thread pool.

    Kalau token cache mendekati expiry, refresh dulu secara proaktif supaya
    request quota tidak pernah berangkat dengan token mati (menghindari 401).
    """
    global _cached_token, _cached_refresh_creds, _cached_expiry
    if _cached_token and not _token_expiring():
        return _cached_token
    if _cached_token and _token_expiring() and _cached_refresh_creds:
        new_token = await _try_refresh()
        if new_token:
            _cached_token = new_token
            return _cached_token
        # refresh gagal → jatuh ke baca keyring (agy mungkin sudah menulis token baru)
    loop = asyncio.get_event_loop()
    token_data = await loop.run_in_executor(None, _read_keyring_token)
    if not token_data:
        return _cached_token  # pertahankan token lama kalau keyring tak terbaca
    _cached_token = token_data.get("access_token")
    _cached_expiry = _parse_expiry(token_data.get("expiry"))
    if token_data.get("refresh_token"):
        # client_id/secret tidak ada di keyring → pakai kredensial agy (lihat atas).
        _cached_refresh_creds = {
            "refresh_token": token_data["refresh_token"],
            "client_id": token_data.get("client_id") or AGY_CLIENT_ID,
            "client_secret": token_data.get("client_secret") or AGY_CLIENT_SECRET,
        }
    return _cached_token


async def _try_refresh() -> str | None:
    """Tukar refresh_token jadi access_token baru. Return None kalau tidak bisa."""
    global _cached_expiry
    if not _cached_refresh_creds or not _cached_refresh_creds.get("refresh_token"):
        log.warning("[gemini-refresh] skip — refresh_token tidak ada di keyring")
        return None
    try:
        resp = await _http_client.post(
            GOOGLE_TOKEN_URL,
            data=_cached_refresh_creds | {"grant_type": "refresh_token"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.is_success:
            data = resp.json()
            expires_in = data.get("expires_in")
            _cached_expiry = (
                datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
                if expires_in
                else None
            )
            return data.get("access_token")
        # jangan log body saat sukses (berisi access_token); saat gagal aman.
        log.warning("[gemini-refresh] gagal status=%d error=%s", resp.status_code, resp.text[:200])
    except Exception as exc:
        log.warning("[gemini-refresh] exception: %s", exc)
    return None


def _transform(raw: dict) -> dict:
    groups = []
    for g in raw.get("groups", []):
        buckets = []
        for b in g.get("buckets", []):
            remaining = b.get("remainingFraction", 1.0)
            buckets.append({
                "bucket_id": b.get("bucketId", ""),
                "display_name": b.get("displayName", ""),
                "window": b.get("window", ""),
                "pct_used": round((1 - remaining) * 100, 1),
                "resets_at": b.get("resetTime", ""),
                "description": b.get("description", ""),
            })
        groups.append({
            "display_name": g.get("displayName", ""),
            "description": g.get("description", ""),
            "buckets": buckets,
        })
    return {"groups": groups}


@router.get("/gemini-usage")
async def gemini_usage(_user: CurrentUser) -> dict:
    global _cached_token

    t0 = time.perf_counter()

    if not _LIB_AVAILABLE:
        return {"error": "keyring_unavailable"}

    t1 = time.perf_counter()
    token = await _get_token()
    t2 = time.perf_counter()

    if not token:
        return {"error": "token_not_found"}

    try:
        resp = await _http_client.post(
            QUOTA_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
    except httpx.TimeoutException:
        return {"error": "api_error", "status": 0, "detail": "timeout"}
    except Exception as exc:
        return {"error": "api_error", "status": 0, "detail": str(exc)}

    t3 = time.perf_counter()
    log.warning(
        "[gemini-usage] token_cached=%s | get_token=%.0fms | http_post=%.0fms | total=%.0fms | status=%d",
        token == _cached_token,
        (t2 - t1) * 1000,
        (t3 - t2) * 1000,
        (t3 - t0) * 1000,
        resp.status_code,
    )

    if resp.status_code == 401:
        _cached_token = None
        new_token = await _try_refresh()
        if new_token:
            _cached_token = new_token
            log.warning("[gemini-usage] token refreshed via refresh_token, retrying")
            try:
                resp = await _http_client.post(
                    QUOTA_URL,
                    headers={"Authorization": f"Bearer {new_token}"},
                    json={},
                )
                if resp.is_success:
                    return _transform(resp.json())
            except Exception:
                pass
        return {"error": "token_expired"}
    if not resp.is_success:
        return {"error": "api_error", "status": resp.status_code}

    return _transform(resp.json())

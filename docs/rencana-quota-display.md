# Rencana: Quota Display — Claude Code Live + Gemini Live + OpenCode Alert

## Latar Belakang

Saat ini QuotaScreen hanya menampilkan token terpakai dari tracking internal Choros (tabel
`quota_windows`) tanpa progress bar, tanpa reset time, dan tanpa pembeda visual antar provider.

Target tampilan mengacu pada screenshot anti-gravity `/usage` dan Claude Code `/usage`:
- **Claude Code** → progress bar real dengan % used dan waktu reset, diambil live via
  `claude --print "/usage"`
- **Gemini (anti-gravity)** → progress bar real dari API resmi Google (`cloudcode-pa.googleapis.com`)
  menggunakan token OAuth yang tersimpan di GNOME keyring, tanpa perlu binary TUI
- **OpenCode** → token terpakai tetap tampil seperti biasa; kalau user set limit,
  muncul `MeterBar` + alert ketika mencapai batas

### Temuan Discovery

| Provider | Status | Detail |
|---|---|---|
| `claude --print "/usage"` | ✅ Bisa | Output teks parseable, return session % dan week % |
| Gemini API via keyring token | ✅ Bisa | `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` return 200 |
| Gemini via `agy` TUI | ❌ Tidak bisa | Bubble Tea TUI, hanya emit ANSI codes, tidak ada output parseable |
| OpenCode provider quota | ➖ N/A | User pakai local model (Kaggle, MI300X vLLM) — tidak ada provider quota |

### Temuan Kritis untuk Gemini

Selama sesi discovery terdahulu, endpoint `retrieveUserQuotaSummary` sempat terus return 403.
Root cause akhirnya diidentifikasi:

1. **Token OAuth** tersimpan di GNOME keyring (`service=gemini, username=antigravity`) —
   dapat dibaca via `ctypes` + `libsecret-1.so.0` (tidak perlu `python-secretstorage` atau `gi`)
2. **Header `User-Agent: antigravity/cli/1.0.0`** wajib ada — tanpa ini server menolak request
3. **Token refresh**: token di keyring diperbarui otomatis oleh `agy` setiap kali dipakai.
   Kita tidak bisa refresh sendiri (butuh `client_secret` yang embedded di binary).
   Jika token expired (401), tampilkan pesan "buka agy sekali untuk memperbarui token"

### Response Shape API Gemini

```json
{
  "groups": [
    {
      "displayName": "Gemini Models",
      "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        {
          "bucketId": "gemini-weekly",
          "displayName": "Weekly Limit",
          "window": "weekly",
          "resetTime": "2026-08-06T03:26:09Z",
          "description": "You have used some of your weekly limit, it will fully refresh in 1 day, 18 hours.",
          "remainingFraction": 0.6143396
        },
        {
          "bucketId": "gemini-5h",
          "displayName": "Five Hour Limit",
          "window": "5h",
          "resetTime": "2026-08-04T12:39:32Z",
          "description": "You have used some of your 5-hour limit, it will fully refresh in 4 hours.",
          "remainingFraction": 0.9699
        }
      ]
    },
    {
      "buckets": [
        {
          "bucketId": "3p-weekly",
          "displayName": "Weekly Limit",
          "window": "weekly",
          "resetTime": "2026-08-06T05:36:06Z",
          "remainingFraction": 0.6598487
        },
        {
          "bucketId": "3p-5h",
          "displayName": "Five Hour Limit",
          "window": "5h",
          "resetTime": "2026-08-04T13:39:29Z",
          "remainingFraction": 1.0
        }
      ]
    }
  ]
}
```

Konversi: `pct_used = (1 - remainingFraction) * 100`

---

## Scope Implementasi

### Yang dikerjakan

1. **Claude Code live usage** — endpoint baru di backend yang memanggil
   `claude --print "/usage"`, parsing output teks, return JSON terstruktur
2. **Gemini live usage** — endpoint baru yang membaca token dari GNOME keyring via ctypes,
   memanggil API Google, mem-parse `remainingFraction` per bucket per group
3. **Agent token limit** — field opsional `token_limit` di tabel `agents`; khusus untuk
   OpenCode (Gemini sudah pakai data real dari API)
4. **Alert threshold OpenCode** — ketika `tokens_used` Choros mencapai `>= token_limit`,
   tampilkan alert di QuotaScreen
5. **QuotaScreen redesign** — layout baru dengan tiga section terpisah per provider group

### Yang tidak dikerjakan

- Cross-device aggregation
- Token refresh otomatis untuk Gemini (butuh `client_secret` embedded di binary `agy`)
- Notifikasi push / webhook saat limit tercapai
- ~~Gemini di Windows (GNOME keyring adalah Linux-only; Windows punya credential store terpisah)~~
  — selesai, lihat `docs/rencana-quota-windows.md`

---

## Arsitektur

### Backend

#### 1. Migration — tambah `token_limit` ke tabel `agents`

```sql
ALTER TABLE agents ADD COLUMN token_limit INTEGER;
```

Field nullable. `NULL` = tidak ada limit dikonfigurasi. Hanya dipakai untuk OpenCode.

**File:** `migrations/` (Alembic auto-generate)
**Model:** `app/models.py` — tambah `token_limit: Mapped[int | None]`
**Schema:** `app/schemas.py` — tambah `token_limit: int | None = None` di `AgentIn`/`AgentOut`

#### 2. Endpoint baru — `/api/quota/claude-usage`

```
GET /api/quota/claude-usage
```

Memanggil `claude --print "/usage"` sebagai subprocess, mem-parse output, return:

```json
{
  "session": {
    "pct_used": 33,
    "resets_at": "2026-08-04T15:40:00+07:00"
  },
  "week": {
    "pct_used": 55,
    "resets_at": "2026-08-08T09:00:00+07:00"
  },
  "raw": "..."
}
```

Parsing rules (dari output `claude --print "/usage"`):
- `Current session: {N}% used · resets {date} {time} ({tz})`
- `Current week (all models): {N}% used · resets {date}, {time} ({tz})`

Jika binary `claude` tidak ditemukan atau subprocess error, return `{"error": "claude_not_found"}`.
Timeout subprocess: **10 detik**.

**File baru:** `app/api/claude_usage.py`
**Daftarkan di:** `app/main.py`

#### 3. Endpoint baru — `/api/quota/gemini-usage`

```
GET /api/quota/gemini-usage
```

Membaca token OAuth dari GNOME keyring via ctypes, memanggil API Google, return:

```json
{
  "groups": [
    {
      "display_name": "Gemini Models",
      "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        {
          "bucket_id": "gemini-weekly",
          "display_name": "Weekly Limit",
          "window": "weekly",
          "pct_used": 38.6,
          "resets_at": "2026-08-06T03:26:09Z",
          "description": "..."
        },
        {
          "bucket_id": "gemini-5h",
          "display_name": "Five Hour Limit",
          "window": "5h",
          "pct_used": 3.0,
          "resets_at": "2026-08-04T12:39:32Z",
          "description": "..."
        }
      ]
    }
  ]
}
```

Error cases:

| Kondisi | Response |
|---|---|
| Token tidak ada di keyring | `{"error": "token_not_found"}` |
| Token expired (API return 401) | `{"error": "token_expired"}` |
| libsecret tidak tersedia | `{"error": "keyring_unavailable"}` |
| API error lain | `{"error": "api_error", "status": <HTTP_status>}` |

**Implementasi keyring reading** (`ctypes` + `libsecret-1.so.0`):

```python
import ctypes, json, os

def _read_keyring_token() -> str | None:
    """
    Baca access token agy dari GNOME keyring via libsecret.
    Tidak butuh python-secretstorage atau gi.repository.
    """
    lib = ctypes.util.find_library("secret-1")
    if not lib:
        return None
    ls = ctypes.cdll.LoadLibrary(lib)
    # secret_password_lookup_sync(schema, cancellable, error, attr_name, attr_val, ..., NULL)
    ls.secret_password_lookup_sync.restype = ctypes.c_char_p
    raw = ls.secret_password_lookup_sync(
        None, None, None,
        b"service", b"gemini",
        b"username", b"antigravity",
        None,
    )
    if not raw:
        return None
    data = json.loads(raw.decode())
    return data.get("token", {}).get("access_token")
```

**HTTP call**:

```python
import httpx

QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"

async def fetch_gemini_quota(token: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            QUOTA_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "antigravity/cli/1.0.0",
                "Content-Type": "application/json",
            },
            json={},
        )
        if resp.status_code == 401:
            return {"error": "token_expired"}
        resp.raise_for_status()
        raw = resp.json()
        return _transform(raw)
```

**File baru:** `app/api/gemini_usage.py`
**Daftarkan di:** `app/main.py`

#### 4. Logika alert di quota tracking yang sudah ada (OpenCode only)

Di `app/orchestrator/quota.py` fungsi `record_usage()`, setelah update `tokens_used`:

```python
if agent.token_limit and window.tokens_used >= agent.token_limit:
    # tandai agent sebagai "limit tercapai" — simpan di QuotaWindow.is_exhausted
    # logika sudah ada untuk exhausted, cukup trigger dari sini
```

Tidak perlu field baru — `is_exhausted` sudah ada dan sudah ditampilkan sebagai
"cooldown aktif". Yang berubah hanya kondisi trigger-nya diperluas untuk OpenCode.

---

### Frontend

#### 1. Service baru — `claudeUsageApi.ts`

```ts
export interface ClaudeUsage {
  session: { pct_used: number; resets_at: string } | null;
  week:    { pct_used: number; resets_at: string } | null;
  error?: string;
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage>
```

#### 2. Service baru — `geminiUsageApi.ts`

```ts
export interface GeminiBucket {
  bucket_id: string;
  display_name: string;
  window: string;        // "weekly" | "5h"
  pct_used: number;      // 0–100
  resets_at: string;     // ISO datetime
  description: string;
}

export interface GeminiGroup {
  display_name: string;
  description: string;
  buckets: GeminiBucket[];
}

export interface GeminiUsage {
  groups: GeminiGroup[];
  error?: string;        // "token_not_found" | "token_expired" | "keyring_unavailable" | "api_error"
}

export async function fetchGeminiUsage(): Promise<GeminiUsage>
```

#### 3. QuotaScreen — layout tiga section

```
┌─────────────────────────────────────┐
│ CLAUDE CODE                         │
│  Current Session     ████░░░░ 33%  │  ← MeterBar
│  resets 4 Aug, 3:40pm              │
│                                     │
│  Current Week        █████░░░ 55%  │  ← MeterBar
│  resets 8 Aug, 9:00am              │
├─────────────────────────────────────┤
│ GEMINI (anti-gravity)               │
│  Gemini Models                      │
│    Weekly Limit      ████░░░░ 38%  │  ← MeterBar (remainingFraction)
│    resets 6 Aug, 10:26am           │
│    Five Hour Limit   █░░░░░░░  3%  │  ← MeterBar
│    resets 4 Aug, 7:39pm            │
│  3p Models                          │
│    Weekly Limit      ████░░░░ 34%  │  ← MeterBar
│    Five Hour Limit   ░░░░░░░░  0%  │  ← MeterBar
│                                     │
│  [⚠ token expired — buka agy]      │  ← jika 401/token_not_found
├─────────────────────────────────────┤
│ OPENCODE                            │
│  agent / model   2.4M tok  ░░░░░░  │  ← MeterBar (jika limit set)
│  window: 5h · berakhir 15:00       │
│  [!] 2.4M / 2M — limit tercapai   │  ← Alert (jika is_exhausted & limit set)
│                                     │
│  agent / model   800K tok          │  ← hanya teks jika limit tidak diset
├─────────────────────────────────────┤
│ Konsumsi 7 Hari  (tabel existing)  │
└─────────────────────────────────────┘
```

**Aturan display per row OpenCode:**

| Kondisi | Tampilan |
|---|---|
| `token_limit` tidak diset | Token terpakai saja (teks), tanpa bar |
| `token_limit` diset, belum mentok | MeterBar + teks reset time |
| `token_limit` diset, `is_exhausted` true | MeterBar merah + alert inline |

**Error states Gemini section:**

| Error | Tampilan |
|---|---|
| `token_not_found` | "token agy tidak ditemukan di keyring" |
| `token_expired` | "token expired — buka agy sekali untuk memperbarui" |
| `keyring_unavailable` | "GNOME keyring tidak tersedia (Linux only)" |
| `api_error` | "gagal menghubungi Gemini API" |

#### 4. Polling

- Claude usage: refetch tiap **60 detik** (subprocess mahal)
- Gemini usage: refetch tiap **60 detik** (HTTP call, tidak perlu lebih sering dari ini)
- Gemini/OpenCode quota Choros: tetap 1 detik (countdown cooldown tidak berubah)

---

## Urutan Pengerjaan

### Fase 1 — Backend (tidak ada UI yang berubah dulu)

- [ ] B1: Alembic migration — tambah `token_limit` ke `agents`
- [ ] B2: Update `AgentIn`/`AgentOut` schema + `Agent` model
- [ ] B3: Buat `app/api/claude_usage.py` dengan parsing dan subprocess timeout
- [ ] B4: Buat `app/api/gemini_usage.py` dengan ctypes keyring reader + httpx call + transform
- [ ] B5: Daftarkan kedua router di `app/main.py`
- [ ] B6: Test manual — `curl /api/quota/claude-usage` harus return data parsed
- [ ] B7: Test manual — `curl /api/quota/gemini-usage` harus return groups + pct_used

### Fase 2 — Frontend Claude Code section

- [ ] F1: Buat `claudeUsageApi.ts`
- [ ] F2: Tambah section "Claude Code" di `QuotaScreen.tsx` dengan dua `MeterBar`
- [ ] F3: Polling 60 detik untuk claude usage, terpisah dari polling 1 detik yang ada
- [ ] F4: Handle error state (`claude_not_found`, timeout)

### Fase 3 — Frontend Gemini section

- [ ] F5: Buat `geminiUsageApi.ts`
- [ ] F6: Tambah section "Gemini" di `QuotaScreen.tsx` dengan `MeterBar` per bucket per group
- [ ] F7: Polling 60 detik terpisah
- [ ] F8: Handle semua error states dengan pesan yang actionable

### Fase 4 — Frontend OpenCode alert

- [ ] F9: Baca `token_limit` dari data agent yang sudah di-fetch di `fetchQuota()`
- [ ] F10: Tampilkan `MeterBar` kondisional per row berdasarkan tabel aturan di atas
- [ ] F11: Alert inline untuk row yang `is_exhausted && token_limit !== null`

### Fase 5 — Settings agent (input limit, OpenCode only)

- [ ] S1: Tambah field "Token limit (opsional)" di form edit agent
- [ ] S2: Validasi: hanya muncul untuk adapter `opencode`
  (Gemini sudah pakai data real — `token_limit` tidak berlaku untuk antigravity)
- [ ] S3: `0` atau kosong = tidak ada limit (null di DB)

---

## Keputusan Desain

**Kenapa Gemini tidak pakai user-defined limit lagi?**
Setelah discovery berhasil membuktikan bahwa endpoint `retrieveUserQuotaSummary` bisa
diakses menggunakan token dari GNOME keyring + `User-Agent: antigravity/cli/1.0.0`,
kita punya data resmi dari Google langsung. `remainingFraction` per bucket lebih akurat
dari estimasi internal Choros. User-defined limit untuk Gemini dihapus dari scope.

**Kenapa tidak alert global / toast?**
Alert inline di row lebih jelas karena menunjukkan MANA agent yang kena limit, bukan
hanya "ada yang mentok". Toast menghilang dan mudah terlewat.

**Kenapa polling 60 detik untuk Claude dan Gemini?**
- Claude: `claude --print "/usage"` menjalankan subprocess yang baca disk + network
- Gemini: HTTP call ke Google API; reset window hitungan jam, tidak perlu refresh per detik
- Keduanya: reset window minimal 5 jam — polling 60 detik sudah lebih dari cukup

**Kenapa `token_limit` di tabel `agents` bukan tabel baru?**
Limit adalah konfigurasi per-agent. Menyimpan di tabel terpisah perlu join ekstra tanpa
manfaat nyata. Sekarang hanya dipakai untuk OpenCode.

**Kenapa tidak refresh token Gemini sendiri?**
Token refresh OAuth butuh `client_secret` yang di-embed di binary `agy`. Tidak ada cara
aman untuk mengekstraknya. Strategi terbaik: andalkan `agy` yang sudah berjalan untuk
menjaga token tetap segar, dan tampilkan error actionable jika expired.

**Kenapa `token_limit` tetap ada di schema meski Gemini tidak pakai?**
OpenCode masih butuh. Field nullable memastikan tidak ada breaking change ke agent yang
sudah ada.

---

## File yang Disentuh

| File | Perubahan |
|---|---|
| `app/models.py` | Tambah `token_limit` ke `Agent` |
| `app/schemas.py` | Tambah `token_limit` di `AgentIn`/`AgentOut` |
| `app/api/claude_usage.py` | **Baru** — subprocess + parser |
| `app/api/gemini_usage.py` | **Baru** — ctypes keyring reader + httpx call + transform |
| `app/main.py` | Daftarkan dua router baru |
| `app/orchestrator/quota.py` | Perluas trigger `is_exhausted` dari `token_limit` (OpenCode) |
| `migrations/` | Alembic migration baru |
| `app/static/src/services/claudeUsageApi.ts` | **Baru** — service layer Claude |
| `app/static/src/services/geminiUsageApi.ts` | **Baru** — service layer Gemini |
| `app/static/src/features/quota/QuotaScreen.tsx` | Refactor layout + 3 section |
| `app/static/src/services/quotaApi.ts` | Expose `token_limit` dari `WireAgent` |
| *(opsional)* `app/static/src/features/agents/AgentForm` | Input token_limit (OpenCode only) |

Total: **~10 file**, tidak ada perubahan breaking ke API yang sudah ada.

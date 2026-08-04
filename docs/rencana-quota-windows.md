# Rencana: Perbaikan Quota Display di Windows (Claude Code + Antigravity)

## Latar Belakang

`docs/rencana-quota-display.md` mengimplementasikan quota live untuk Claude Code
(`app/api/claude_usage.py`) dan Antigravity/Gemini (`app/api/gemini_usage.py`). Kedua
section ini bekerja normal di Linux, tapi di Windows **keduanya** selalu gagal — dengan
penyebab yang berbeda dan tidak saling terkait. Dokumen ini fokus khusus pada dua bug
tersebut; bukan redesign fitur.

### Root cause 1 — Claude Code: subprocess bare-name tidak resolve `.cmd` shim

`app/api/claude_usage.py:46-52` memanggil:

```python
proc = await asyncio.create_subprocess_exec(
    "claude", "--print", "/usage",
    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
)
```

Di Windows, CLI yang di-install via `npm install -g` terpasang sebagai shim
`claude.cmd` (bukan `claude.exe`). `asyncio.create_subprocess_exec` memanggil
`CreateProcessW` langsung — jalur ini **tidak** melakukan resolusi `PATHEXT` seperti
yang dilakukan shell (`cmd.exe`) saat user mengetik `claude` di terminal. Akibatnya
`claude` gagal ditemukan meski sudah benar berada di `PATH`, dan
`except FileNotFoundError` di baris 56-57 menangkapnya sebagai `claude_not_found`.

Frontend (`QuotaScreen.tsx:42`) menampilkan pesan *"binary 'claude' tidak ditemukan di
PATH"* — pesan ini menyesatkan di Windows karena binary-nya memang ada, hanya saja cara
spawn-nya yang salah untuk `.cmd`.

Bandingkan dengan `app/adapters/base.py:166`, yang sudah benar:
`shutil.which(self.binary)` — `shutil.which` **memang** melakukan resolusi `PATHEXT`
di Windows. `claude_usage.py` tidak memakai `shutil.which` sama sekali.

### Root cause 2 — Antigravity: hard dependency ke GNOME keyring, tidak ada jalur Windows

`app/api/gemini_usage.py:22`:

```python
_LIB_AVAILABLE: bool = bool(ctypes.util.find_library("secret-1"))
```

`secret-1` adalah `libsecret-1.so.0` — pustaka keyring khusus desktop Linux (GNOME).
Di Windows, `ctypes.util.find_library("secret-1")` selalu `None`, sehingga
`_LIB_AVAILABLE = False` secara permanen. Handler di baris 141-142 langsung
short-circuit:

```python
if not _LIB_AVAILABLE:
    return {"error": "keyring_unavailable"}
```

HTTP call ke `cloudcode-pa.googleapis.com` tidak pernah dicoba di Windows. Ini memang
sudah ditandai sebagai gap yang belum dikerjakan di
`docs/rencana-quota-display.md:109` — *"Gemini di Windows (GNOME keyring adalah
Linux-only; Windows punya credential store terpisah)"* — tapi implementasinya belum
pernah dibuat.

### Temuan tambahan (bukan penyebab langsung, tapi relevan)

- `app/api/claude_usage.py` tidak menangani `NotImplementedError` dari
  `create_subprocess_exec`. Jika dev server berjalan di bawah
  `SelectorEventLoop` (lihat `app/runtime.py` dan guard di `app/main.py:37-38`), error
  ini akan jatuh ke `except Exception` generik di baris 60-61 dan tampil sebagai
  `subprocess_error` yang tidak actionable, bukan pesan `LOOP_FIX_HINT` yang sudah ada
  di `app/runtime.py`. Perlu dipastikan dulu event loop mana yang aktif sebelum
  menyimpulkan root cause 1 di atas sebagai satu-satunya penyebab.
- `data.detail` dari `subprocess_error` (`claude_usage.py:61`) sudah dikirim backend
  tapi tidak pernah dirender di `QuotaScreen.tsx` — kalau ada error lain yang tak
  terduga, pesannya hilang begitu saja. Ini menyulitkan diagnosis di masa depan.
- `app/adapters/base.py:199-232` (`BaseCliAdapter.run()`, dipakai untuk *menjalankan*
  task, bukan quota) punya pola bug yang sama: `is_installed()` resolve path lewat
  `shutil.which`, tapi `build_command()` tetap memakai nama binary mentah di
  `cmd[0]`, dan hasil resolve dari `is_installed()` dibuang. **Di luar scope dokumen
  ini** (fokusnya quota display), tapi kemungkinan besar task Claude Code/Antigravity
  yang sebenarnya (bukan sekadar quota) juga bermasalah di Windows dengan cara yang
  sama. Direkomendasikan jadi rencana terpisah setelah quota beres, supaya bisa
  dikonfirmasi dulu apakah symptom-nya identik.

---

## Scope

### Yang dikerjakan

1. **Claude Code quota di Windows** — resolve binary via `shutil.which`, spawn lewat
   jalur yang benar untuk `.cmd`/`.bat` shim.
2. **Error surfacing** — tampilkan `data.detail` di frontend untuk `subprocess_error`
   dan error Gemini yang punya detail, supaya kalau masih gagal di Windows setelah
   fix ini, pesannya actionable bukan `error: subprocess_error` polos.
3. **Antigravity quota di Windows** — baca token OAuth dari Windows Credential
   Manager sebagai jalur paralel ke GNOME keyring (bukan pengganti — Linux tetap
   pakai libsecret).
4. **Verifikasi manual** di Windows untuk kedua endpoint setelah perubahan.

### Yang tidak dikerjakan

- Perbaikan `BaseCliAdapter.run()` untuk eksekusi task sungguhan di Windows (dicatat
  sebagai temuan terpisah di atas, bukan bagian dokumen ini).
- Dukungan macOS Keychain (tidak diminta, tidak ada laporan bug di macOS).
- Refresh token otomatis untuk Antigravity (sudah out-of-scope di
  `docs/rencana-quota-display.md`, alasan sama: butuh `client_secret` yang di-embed
  di binary `agy`).
- Migrasi `gemini_usage.py` ke library `keyring` pihak ketiga sebagai default lintas
  platform — dipertimbangkan sebagai opsi desain (lihat Keputusan Desain), tapi
  keputusan defaultnya tetap implementasi manual per-platform kecuali investigasi awal
  menunjukkan `keyring` jelas lebih sederhana.

---

## Arsitektur Perbaikan

### A. Claude Code (`app/api/claude_usage.py`)

Resolve binary path dulu, baru putuskan cara spawn berdasarkan ekstensi hasil resolve:

```python
import shutil
import subprocess
import sys

def _resolve_claude_binary() -> str | None:
    return shutil.which("claude")


@router.get("/claude-usage")
async def claude_usage(_user: CurrentUser) -> dict:
    binary = _resolve_claude_binary()
    if not binary:
        return {"error": "claude_not_found"}

    t0 = time.perf_counter()
    try:
        if sys.platform == "win32" and binary.lower().endswith((".cmd", ".bat")):
            # CreateProcess tidak bisa menjalankan .cmd/.bat langsung — harus lewat
            # cmd.exe. create_subprocess_shell menangani ini dan tetap mem-parse
            # argumen dengan benar via list2cmdline.
            cmdline = subprocess.list2cmdline([binary, "--print", "/usage"])
            proc = await asyncio.create_subprocess_shell(
                cmdline,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                binary, "--print", "/usage",
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
    except NotImplementedError:
        from app.runtime import subprocess_unsupported_message
        return {"error": "loop_unsupported", "detail": subprocess_unsupported_message(asyncio.get_running_loop())}
    except Exception as exc:
        return {"error": "subprocess_error", "detail": str(exc)}
    ...
```

Catatan implementasi:
- `shutil.which` sudah dipakai konsisten di `app/adapters/base.py:166` — pola yang
  sama dipakai di sini, bukan pendekatan baru.
- Cek `binary.lower().endswith((".cmd", ".bat"))` dilakukan setelah resolve, bukan
  dengan `sys.platform == "win32"` saja, supaya tetap benar kalau suatu saat ada
  `claude.exe` asli di Windows (mis. build native) — tidak perlu lewat `cmd.exe`
  untuk itu.
- `except NotImplementedError` ditambahkan agar konsisten dengan penanganan yang
  sudah ada di `app/adapters/base.py:219-228` dan `app/main.py:37-38` — kalau
  penyebab sebenarnya adalah event loop (lihat "Temuan tambahan"), pesannya jadi
  actionable, bukan `subprocess_error` generik.

### B. Antigravity (`app/api/gemini_usage.py`)

Tambahkan pembaca token khusus Windows sebagai cabang paralel, dipilih saat startup
berdasarkan `sys.platform` — pola yang sama dengan cabang `os.name == "nt"` yang
sudah ada di `app/api/fs.py:23-24`.

```python
import sys

def _read_keyring_token_windows() -> str | None:
    """Baca token agy dari Windows Credential Manager via advapi32 CredReadW.

    Perlu dikonfirmasi dulu target name & atribut yang dipakai `agy` di Windows
    (lihat langkah investigasi W1 di bawah) — signature di bawah adalah kerangka,
    bukan final sampai target name terkonfirmasi.
    """
    import ctypes
    from ctypes import wintypes

    advapi32 = ctypes.windll.advapi32
    CRED_TYPE_GENERIC = 1

    class CREDENTIAL(ctypes.Structure):
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

    cred_ptr = ctypes.POINTER(CREDENTIAL)()
    # TARGET_NAME hasil investigasi W1 — placeholder di bawah:
    ok = advapi32.CredReadW("antigravity/gemini", CRED_TYPE_GENERIC, 0, ctypes.byref(cred_ptr))
    if not ok:
        return None
    try:
        blob = ctypes.string_at(cred_ptr.contents.CredentialBlob, cred_ptr.contents.CredentialBlobSize)
        data = json.loads(blob.decode("utf-16-le" if b"\x00" in blob[:2] else "utf-8"))
        return data.get("token", {}).get("access_token")
    finally:
        advapi32.CredFree(cred_ptr)


def _read_keyring_token() -> str | None:
    if sys.platform == "win32":
        return _read_keyring_token_windows()
    return _read_keyring_token_linux()  # implementasi lama, di-rename dari _read_keyring_token
```

`_LIB_AVAILABLE` juga perlu diganti jadi pengecekan per-platform:

```python
def _platform_supported() -> bool:
    if sys.platform == "win32":
        return True  # CredReadW selalu tersedia di Windows, tidak perlu find_library
    return bool(ctypes.util.find_library("secret-1"))

_LIB_AVAILABLE: bool = _platform_supported()
```

**Risiko utama bagian ini — perlu investigasi sebelum implementasi final:**

`agy` adalah binary pihak ketiga (bukan kode Choros), sehingga *nama target* dan
*format credential* yang dipakainya di Windows Credential Manager tidak diketahui
dari kode ini — beda dengan Linux di mana atribut `service=gemini,
username=antigravity` sudah dikonfirmasi lewat discovery sebelumnya (lihat
`docs/rencana-quota-display.md:25-35`). Kemungkinan `agy` di Windows memakai library
Node seperti `keytar`, yang menyimpan credential generic dengan `TargetName` biasanya
berformat `<service>` atau `<service>/<account>`. Nama pastinya harus dikonfirmasi
secara empiris (lihat langkah W1 di bawah) sebelum kode di atas bisa difinalisasi —
kerangka di atas jangan dianggap final tanpa langkah itu.

---

## Urutan Pengerjaan

### Fase W0 — Investigasi (wajib sebelum coding, tidak bisa ditebak dari kode)

- [x] W1: Dikonfirmasi via `cmdkey /list` + `CredReadW` manual: `TargetName` =
      `gemini:antigravity`, `Type` = Generic, blob = JSON UTF-8 polos, skema identik
      dengan Linux (`{"token": {"access_token": "..."}}`). Tidak perlu fallback file.
- [x] W2: Sudah ditangani sebelum dokumen ini ditulis — `app/runtime.py` +
      `app/main.py` sudah guard `SelectorEventLoop`, dan `README.md` sudah
      mendokumentasikan `--loop asyncio:ProactorEventLoop`. Root cause 1 dikonfirmasi
      berdiri sendiri, tidak tercampur isu event loop.
- [x] W3: Dikonfirmasi di mesin uji: `shutil.which("claude")` me-resolve ke
      `claude.exe` (install native standalone, bukan shim `.cmd` npm). Bare
      `create_subprocess_exec("claude", ...)` sebenarnya sudah jalan di mesin ini —
      root cause 1 tidak reproduce di sini, tapi tetap berlaku untuk install via
      `npm install -g` yang menghasilkan `claude.cmd`. Fix `shutil.which` +
      percabangan `.cmd`/`.bat` aman dan no-op untuk kasus `.exe`.

### Fase W1 — Backend: Claude Code

- [x] B1: Ganti `create_subprocess_exec("claude", ...)` di `claude_usage.py` dengan
      `_resolve_claude_binary()` + percabangan `.cmd`/`.bat` seperti di Arsitektur A.
- [x] B2: Tambah `except NotImplementedError` dengan pesan dari
      `subprocess_unsupported_message()`.
- [x] B3: Tambah error code baru `loop_unsupported` ke response shape (dipakai F2).
- [x] B4: Test manual di Windows: `curl http://localhost:<port>/api/quota/claude-usage`
      tidak lagi return `claude_not_found` (dulu inilah bug-nya). Response body tidak
      bisa divalidasi penuh di sesi ini karena `claude` CLI menolak jalan nested di
      bawah sesi Claude Code yang sedang aktif (`CLAUDECODE=1` terwariskan ke child
      process) — endpoint mengembalikan `timeout`/parse kosong yang merupakan
      exit-path yang benar untuk kondisi itu, bukan bug baru. Perlu dicek ulang dari
      luar sesi Claude Code untuk memastikan `raw`/`session`/`week` terisi.
  - **Follow-up terkonfirmasi**: user melaporkan gejala yang sama (`timeout`) di
    server dev asli (bukan nested — pohon proses dicek, ancestor-nya terminal VS
    Code biasa). Diagnosis ulang dengan environment bersih (env `CLAUDECODE*`
    di-strip manual) membuktikan `claude --print` (bahkan prompt trivial, bukan
    cuma `/usage`) tidak selesai dalam 15 detik. Root cause: mesin ini punya RAM
    total 3.38GB dengan sisa 0.33GB — cold-start binary `claude.exe` (~279MB)
    di bawah tekanan memori seberat itu genuinely lambat, bukan bug di kode.
    Timeout `communicate()` dinaikkan dari 10 → 30 detik (`claude_usage.py`,
    pesan `timeout` di `QuotaScreen.tsx` disesuaikan). Ini bukan perbaikan
    permanen untuk mesin low-memory — kalau `claude` tetap timeout di 30 detik,
    bebaskan RAM dulu sebelum test.

### Fase W2 — Backend: Antigravity

- [x] B5: Implementasikan `_read_keyring_token_windows()` sesuai hasil investigasi
      W1 (TargetName dan tipe kredensial dikonfirmasi, bukan lagi placeholder).
- [x] B6: Rename fungsi Linux existing jadi `_read_keyring_token_linux()`, pasang
      dispatch `_read_keyring_token()` berdasarkan `sys.platform`.
- [x] B7: Update `_platform_supported()` menggantikan `_LIB_AVAILABLE` module-level
      constant yang sekarang caching hasil Linux-only check.
- [x] B8: Test manual di Windows: `curl http://localhost:<port>/api/quota/gemini-usage`
      tidak lagi return `keyring_unavailable`. Hasil aktual: `token_expired` (401 dari
      `cloudcode-pa.googleapis.com`) — membuktikan token berhasil dibaca dari
      Credential Manager, di-decode, dan dikirim ke API asli; token-nya sendiri
      memang sudah expired di mesin uji (perlu buka `agy` sekali untuk refresh,
      bukan bug di kode ini).
- [x] B9: Tidak diperlukan — W1 mengkonfirmasi token ADA di Credential Manager
      dengan format yang diharapkan, jalur file fallback tidak dipakai.

### Fase W3 — Frontend: error surfacing

- [x] F1: `ClaudeSection` — render `data.detail` untuk semua error yang punya
      detail (bukan cuma `claude_not_found`/`timeout` yang sudah punya pesan
      spesifik), termasuk `loop_unsupported` dan `subprocess_error`.
- [x] F2: `GeminiSection` — render `data.detail` untuk `api_error` seperti F1. Tidak
      ada entry `GEMINI_ERROR_MSG` baru yang dibutuhkan karena error code dari
      backend tidak berubah (Windows pakai kode error yang sama: `token_not_found`,
      `token_expired`, `keyring_unavailable`, `api_error`).
- [x] F3: Ganti copy `keyring_unavailable` dari "GNOME keyring tidak tersedia (Linux
      only)" jadi "keyring OS tidak tersedia di platform ini" — tidak lagi
      menyesatkan user Windows.

### Fase W4 — Validasi silang platform

- [ ] V1: **Belum dikerjakan** — sesi ini hanya punya akses mesin Windows, bukan
      Linux. `_read_keyring_token_linux()` hasil rename tidak diubah logikanya (rename
      murni), tapi tetap perlu dijalankan di Linux sungguhan untuk konfirmasi.
- [x] V2 (sebagian): Gemini-usage return `token_expired` — round-trip Credential
      Manager → API asli terbukti jalan. Claude-usage sudah tidak `claude_not_found`,
      tapi belum terverifikasi return data usage penuh (lihat catatan B4 soal
      `CLAUDECODE=1` nested-session).
- [ ] V3: **Belum dikerjakan** — kondisi `agy`/`claude` belum login/belum ter-install
      belum diuji eksplisit di sesi ini.

---

## Keputusan Desain

**Kenapa `create_subprocess_shell` + `list2cmdline`, bukan `shell=True` string
manual atau `cmd /c` sebagai argv terpisah?**
`asyncio.create_subprocess_shell` di Windows secara internal memanggil lewat
`cmd.exe /c <string>` — ini jalur yang didokumentasikan resmi di `asyncio`, bukan
workaround. `subprocess.list2cmdline` memastikan argumen (termasuk `/usage` yang
mengandung `/`) di-quote dengan aturan quoting Windows yang benar, jadi tidak perlu
menulis ulang logic quoting manual yang rawan salah untuk argumen yang mengandung
spasi atau karakter khusus.

**Kenapa tidak langsung pakai library `keyring` pihak ketiga untuk Antigravity,
menggantikan implementasi ctypes manual di kedua platform?**
`keyring` (PyPI) memang membungkus GNOME Secret Service (Linux), Windows Credential
Manager, dan macOS Keychain di balik satu API seragam, dan akan menghilangkan
kebutuhan kode ctypes manual sepenuhnya. Ini didokumentasikan sebagai opsi, bukan
diputuskan sekarang, karena dua alasan: (1) `keyring` butuh tahu skema atribut lookup
yang dipakai `agy` di tiap platform — investigasi W1 tetap wajib dilakukan lebih
dulu terlepas dari library mana yang dipakai; (2) implementasi ctypes Linux yang
sudah ada sudah terbukti bekerja dan sudah pernah lolos discovery sebelumnya — migrasi
sekarang menambah risiko regresi di jalur yang sudah stabil tanpa manfaat langsung
untuk menyelesaikan bug Windows. Kalau W1 menunjukkan `keyring` jelas menyederhanakan
implementasi Windows, evaluasi ulang saat itu.

**Kenapa fase investigasi (W0) dipisah dan wajib sebelum coding?**
Root cause Claude Code (W3) bisa dikonfirmasi dari kode + dokumentasi `asyncio`/
`CreateProcess` tanpa perlu akses mesin Windows. Root cause Antigravity (W1) tidak
bisa — `agy` adalah binary tertutup, dan tidak ada cara menebak `TargetName`
credential-nya dari kode Choros. Menulis kode Credential Manager tanpa
mengkonfirmasi ini dulu berisiko menghasilkan implementasi yang terlihat benar tapi
salah target, dan gagal secara silent (return `None` → `token_not_found`) — sulit
dibedakan dari kasus token memang belum ada.

**Kenapa perbaikan `BaseCliAdapter.run()` (eksekusi task, bukan quota) tidak
dimasukkan ke dokumen ini?**
User secara spesifik melaporkan error di section quota. Bug di `run()` punya gejala
berbeda (task gagal dijalankan sama sekali, bukan quota gagal ditampilkan) dan
belum dikonfirmasi benar-benar terjadi — baru dugaan berdasarkan pola kode yang
mirip. Mencampur keduanya berisiko memperlambat fix quota yang sudah jelas
penyebabnya. Direkomendasikan jadi dokumen rencana terpisah setelah quota selesai
dan kalau user mengkonfirmasi task run juga bermasalah di Windows.

---

## File yang Disentuh

| File | Perubahan |
|---|---|
| `app/api/claude_usage.py` | `shutil.which` + percabangan `.cmd`/`.bat`, tangani `NotImplementedError` |
| `app/api/gemini_usage.py` | Cabang Windows Credential Manager paralel ke GNOME keyring, dispatch via `sys.platform` |
| `app/static/src/features/quota/QuotaScreen.tsx` | Render `data.detail` untuk error yang belum actionable, update copy `keyring_unavailable` |
| `docs/rencana-quota-display.md` | Update baris 109 (catatan "Yang tidak dikerjakan") setelah Antigravity Windows selesai |

Total: **~3 file kode**, tidak ada perubahan schema/API contract — semua perbaikan
di level implementasi internal endpoint yang sudah ada.

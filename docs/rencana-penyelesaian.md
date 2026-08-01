# Rencana penyelesaian choros — dari 92% ke selesai

Dokumen eksekusi untuk agentic AI. Ditulis setelah audit menyeluruh seluruh
`PRD-choros-v0.2.md` terhadap kode yang benar-benar ada.
**Tidak perlu dieksekusi oleh penulis dokumen ini.**

Ini dokumen terakhir dalam rangkaian rencana. Setelah isinya tuntas, choros
memenuhi PRD v0.2 — bukan "kira-kira", melainkan menurut daftar periksa di §10.

---

## 0. Konteks lingkungan — baca ini dulu

### 0.1 Perkakas

| Hal | Nilai |
|---|---|
| OS | Windows 10, `win32` |
| Shell | PowerShell **dan** Git Bash; sintaksnya beda, jangan dicampur |
| Direktori kerja | `C:\project\Choros` |
| Python | **`python` TIDAK ada di PATH.** Selalu `./.venv/Scripts/python.exe` |
| Database | PostgreSQL 16 di Docker, container `choros-db-1`, port **5433** |
| DB test | `postgresql+asyncpg://choros:choros@localhost:5433/choros_test` |
| Branch | `main`, 14 commit, bersih. `origin/main` masih di `3e163ab` — 13 commit belum ter-push |

```bash
# Suite penuh — 97 test, ±6 menit. Jangan diulang tanpa perlu.
./.venv/Scripts/python.exe -m pytest -q

# Satu file (jauh lebih cepat, pakai ini saat iterasi)
./.venv/Scripts/python.exe -m pytest tests/test_cascade.py -q

# Lint. Basis saat ini: app/ = 0, tests/ = 13 (lihat §3)
./.venv/Scripts/python.exe -m ruff check app/ tests/

# Sanity import
./.venv/Scripts/python.exe -c "import app.main; print('ok')"
```

Fixture `clean_db` (`tests/conftest.py:37-46`) ber-`autouse` dan menjalankan
`apply_migrations()` + `TRUNCATE ... RESTART IDENTITY CASCADE` tiap test. Itu
sebabnya suite lambat (±3,7 detik/test) — bukan karena macet.

### 0.2 Jebakan shell yang sudah memakan korban

- **Jangan pakai here-string PowerShell (`@'...'@`) di dalam tool Bash.** Bash
  meneruskan `@` apa adanya dan menghasilkan pesan commit rusak. Pakai heredoc
  POSIX:
  ```bash
  git commit -F - <<'EOF'
  judul

  badan
  EOF
  ```
- **Jangan tambahkan trailer `Co-Authored-By`.** Sejarah repo sudah ditulis ulang
  untuk membuangnya; menambahkannya lagi membatalkan pekerjaan itu.
- `wsl` menulis peringatan systemd ke stderr. Normal, bukan kegagalan.

### 0.3 MCP `codebase-memory`

Terpasang di WSL Ubuntu. Kalau sesimu punya tool `mcp__codebase-memory__*`, pakai
langsung. Kalau tidak, ada mode CLI:

```bash
wsl -e bash -lc 'codebase-memory-mcp cli list_projects'
wsl -e bash -lc 'codebase-memory-mcp cli index_status "{\"project\":\"choros\"}"'
wsl -e bash -lc 'codebase-memory-mcp cli get_architecture "{\"project\":\"choros\"}"'
wsl -e bash -lc 'codebase-memory-mcp cli detect_changes "{\"project\":\"choros\"}"'
wsl -e bash -lc 'codebase-memory-mcp cli index_repository "{\"project\":\"choros\"}"'
```

Tool terverifikasi: `list_projects`, `index_status`, `index_repository`,
`detect_changes`, `get_architecture`. Project bernama **`choros`**, root
`/mnt/c/project/Choros`.

**Indeksnya basi.** `base_sha`-nya `3e163ab` — commit pertama repo. Grafnya tidak
mengenal `app/defaults.py`, `app/api/users.py`, `app/api/workflows.py`,
`app/orchestrator/workflow.py`. **Jalankan `index_repository` dulu**, dan tetap
verifikasi ke file sungguhan. Kesalahan termahal di project ini justru
menyimpulkan dari satu lapisan tanpa memeriksa lapisan yang benar-benar jalan
(`catatan-implementasi.md` §3).

### 0.4 Bacaan wajib sebelum mulai

| Dokumen | Kenapa |
|---|---|
| `PRD-choros-v0.2.md` §1, §2, §4, §8 | non-tujuan (pooling), lapisan auth, isolasi |
| `docs/rencana-fase5.md` §3, §6, §7 | keputusan abstraksi `Launcher`, desain 5c & 5d |
| `docs/catatan-implementasi.md` | penyimpangan dari PRD beserta alasannya |
| `docs/rencana-penutupan-fase5b.md` §5.3 | checklist verifikasi manual yang belum dijalankan |

### 0.5 Keadaan kode

- Fase 1–4 tuntas. Fase 5a (boundary routing & kuota) dan 5b (auth multi-user)
  tuntas dan sudah di-commit.
- Suite: **97 passed**, nol gagal, nol skip.
- ruff: `app/` **bersih**; `tests/` 13 temuan (§3).
- Yang tersisa menuju PRD: **Fase 5c** (§2), plus keputusan sadar atas dua butir
  PRD (§5) dan verifikasi manual (§6).

---

## 1. Kenapa 5c yang menentukan

Semua yang tersisa kecuali 5c bersifat kosmetik atau opsional. 5c tidak.

`PRD-choros-v0.2.md:14` menjanjikan *"tiap user memakai langganannya sendiri
lewat channel resmi, tanpa membungkus kredensial, tanpa pooling"*, dan
`PRD:34` mendaftarkan pooling sebagai non-tujuan eksplisit.

Hari ini `app/adapters/base.py:191`:

```python
env = {**os.environ, **self.env_overrides()}
```

Environment server diwariskan apa adanya, termasuk `HOME`. Ketiga harness
(`claude`, `agy`, `opencode`) membaca kredensial dari `HOME`. Jadi **tugas milik
user mana pun memakai langganan operator.**

Fase 5a menutup boundary di database (tugas user A tidak bisa dirutekan ke agent
user B). Fase 5b memberi identitas yang benar. Tapi keduanya berhenti tepat
sebelum kredensial. Akibatnya choros sekarang punya multi-user yang rapi di atas
satu credential store — persis keadaan yang PRD larang, hanya tersembunyi lebih
baik dari sebelumnya.

**Sampai §2 selesai, mode tim tidak boleh dipakai sungguhan.**

---

## 2. Fase 5c — credential home per-user

### 2.0 Yang sudah siap

Kolom `users.credential_home` **sudah ada** (migrasi `004_multiuser.sql`,
`models.py:31`). Tidak perlu migrasi baru. Ia sengaja dibuat di 5b supaya 5c
tidak menyentuh skema sama sekali.

### 2.1 Aturan kompatibilitas — wajib, jangan dinegosiasi

> **`credential_home IS NULL` → perilaku persis seperti hari ini** (warisi
> `os.environ` apa adanya). Hanya user dengan nilai eksplisit yang `HOME`-nya
> diganti.

Ini yang menjaga dua hal sekaligus: 97 test tetap hijau (fixture di
`conftest.py:49-66` membuat user tanpa `credential_home`), dan pemakaian lokal
satu orang tidak kehilangan akses ke login harness yang sudah ada di HOME-nya.

Kalau ada test lama yang merah setelah patch, patch-nya yang salah.

### 2.2 Patch 1 — `app/config.py`

```python
credential_root: str = str(Path.home() / ".choros" / "homes")
```

Sejajar dengan `isolation_root` (`config.py:22`) yang sudah memakai pola sama.

### 2.3 Patch 2 — `app/adapters/base.py`

Tambah `home` ke konstruktor (`base.py:90-105`):

```python
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
    ...
    self.home = home
```

Ekstrak pembentukan env jadi metode tersendiri — **ini penting supaya bisa dites
tanpa menjalankan proses sungguhan**:

```python
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
```

Lalu `base.py:191` jadi `env = self.build_env()`.

`USERPROFILE` **wajib** ikut. Pengembangan berjalan di Windows dan sebagian tool
mengabaikan `HOME` sepenuhnya di sana. Menyetel salah satunya saja menghasilkan
isolasi yang bekerja di CI Linux dan diam-diam gagal di mesin pengembang.

### 2.4 Patch 3 — `app/adapters/registry.py:35`

```python
def build_adapter(
    agent: Agent, *, timeout: int | None = None, home: str | None = None
) -> AgentAdapter:
    ...
    return cls(
        name=agent.name,
        config=dict(agent.config or {}),
        default_model=agent.default_model,
        base_url=agent.base_url,
        timeout=timeout or settings.run_timeout,
        home=home,
    )
```

`OpenAICompatAdapter` tidak memakai subprocess, jadi `home` tidak berpengaruh
padanya — tapi konstruktornya harus tetap menerimanya (lihat §2.7).

### 2.5 Patch 4 — `app/orchestrator/runner.py`

Empat sentuhan, satu alur:

1. `RunContext` — tambah `credential_home: str | None = None`.
2. `_execute`, di blok session yang sama tempat `user_id` dibaca (sekitar
   `runner.py:184`):
   ```python
   user_id = task.user_id
   owner = await session.get(User, user_id)
   credential_home = owner.credential_home if owner else None
   ```
   Impor `User` dari `app.models`.
3. Saat menyusun `ctx` (sekitar `runner.py:283`), teruskan
   `credential_home=credential_home`.
4. `_run_cascade` → `_run_attempt(..., credential_home=ctx.credential_home)`;
   `_run_attempt` (`runner.py:449`) menerima parameter itu dan meneruskannya:
   `adapter = build_adapter(agent, home=credential_home)` (`runner.py:462`).

Pola ini persis yang dipakai `user_id` di Fase 5a. Ikuti, jangan mengarang pola
baru — dan **jangan mengoper objek `ctx` ke `_run_attempt`**; ia sengaja tidak
tahu soal cascade.

### 2.6 Patch 5 — pembuatan home saat user dibuat

`app/api/users.py`, di `create_user` sebelum `session.flush()`:

```python
settings = get_settings()
home = Path(settings.credential_root) / payload.username
home.mkdir(parents=True, exist_ok=True)

user = User(
    username=payload.username,
    password_hash=hash_password(payload.password),
    is_admin=payload.is_admin,
    credential_home=str(home),
)
```

**Jangan menyetel `credential_home` untuk admin bootstrap** di `main.py:44-49`.
Biarkan NULL supaya instalasi yang sudah jalan tetap memakai HOME operator dan
tidak tiba-tiba kehilangan login harness-nya. Itu penerapan langsung §2.1.

Direktori dibuat saat user dibuat, bukan saat run — supaya kegagalan izin
tulis muncul di satu request yang jelas, bukan di tengah tugas otonom.

### 2.7 Batas jujur 5c yang HARUS ditulis, bukan disembunyikan

HOME per-user mengisolasi **CLI langganan**. Ia tidak mengisolasi kunci API model
mentah:

- `app/adapters/openai_compat.py:50-53` membaca `os.environ.get(api_key_env)`.
- `app/adapters/opencode.py:77-80` (`env_overrides`) meneruskan `env_keys` dari
  environment server.

Jadi setelah 5c, agent `groq-raw` dan `opencode-groq` milik semua user masih
memakai kunci API yang sama.

**Jalan keluar yang tidak butuh kode baru:** `api_key_env` adalah *nama* variabel
environment dan disimpan di `agents.config`, sedangkan agent sudah per-user sejak
Fase 1. Jadi user A bisa memakai `GROQ_API_KEY_ALICE` dan user B
`GROQ_API_KEY_BOB`, dengan operator menyetel keduanya di environment server.
Dokumentasikan itu di UI (§2.8); jangan menambah mekanisme penyimpanan kunci di
choros — itu melanggar `PRD:35` (tidak menyimpan kredensial).

Tulis batas ini di `catatan-implementasi.md` §3 juga. Klaim status yang tidak
menyebut batasnya adalah persis kesalahan yang sudah terjadi sekali di project
ini.

### 2.8 Patch 6 — UI panduan login harness

Panel di halaman Pengguna (atau bagian baru "Kredensial saya") yang menampilkan
`credential_home` milik user yang sedang login beserta perintah persisnya:

```
HOME=<path> claude login
HOME=<path> agy            # lalu ikuti alur login
HOME=<path> opencode auth login
```

Di Windows tampilkan padanannya:

```
$env:USERPROFILE="<path>"; claude login
```

Butuh field baru di `/api/auth/status` (`credential_home`) atau endpoint
`GET /api/users/me`. **Pilih salah satu dan pastikan `app.js` membaca field yang
benar-benar dikirim** — dua bug terparah project ini (A1-A6 dan H1) keduanya
lahir dari UI yang membaca field yang tidak pernah ada.

Wajib ada di panel itu, dengan kata-kata yang jelas:

> choros tidak pernah menjalankan login ini untukmu dan tidak pernah membaca isi
> direktori ini. Jangan arahkan dua akun ke direktori yang sama — itu pooling,
> dan itu di luar tujuan choros.

---

## 3. Utang kecil — 13 temuan ruff di `tests/`

Konfigurasi `[tool.ruff]` yang baru (`pyproject.toml:34-44`) memilih ruleset `S`
(bandit). `app/` bersih; 13 temuan seluruhnya di `tests/` dan seluruhnya salah
sasaran:

| Aturan | Jumlah | Lokasi | Kenapa salah sasaran |
|---|---|---|---|
| `S106` hardcoded password | 3 | `test_api.py:304,501,525` | `password_hash=` fixture test |
| `S108` insecure temp file | 5 | `test_events_and_parsers.py:34,44,137,142`, `test_isolation.py:114` | `/tmp/a.py` sebagai *string yang diparse*, bukan file yang dibuka |
| `S607` partial executable path | 5 | `test_fase35.py:88-94` | pemanggilan `git` di test |

**Perbaikan yang benar** — bandit ditujukan untuk kode produksi, bukan test:

```toml
[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S"]
```

Jangan menambah `# noqa` satu per satu, dan jangan menghapus `S` dari
`lint.select` — `app/` mendapat manfaat nyata darinya.

Setelah itu target lint jadi **nol temuan di seluruh repo**, dan `ruff check`
layak dijadikan gerbang sebelum commit.

Jangan jalankan `ruff format`: 34 dari 50 file akan berubah dan mengubur sejarah
git. Kalau diinginkan, jadikan satu commit berdiri sendiri tanpa perubahan
perilaku apa pun.

---

## 4. Fase 5d — container per user (opsional, kerjakan hanya jika diminta)

`rencana-fase5.md` §7 sudah memuat desainnya. Ringkasnya: `DockerLauncher`
membungkus `cmd` jadi `docker exec -i choros-user-<id> <cmd>`.

Kerjakan **hanya** kalau isolasi keras memang dibutuhkan (mis. user yang tidak
saling percaya di satu mesin). Untuk pemakaian normal, §2 sudah memenuhi maksud
PRD, dan `deploy/choros.service` tetap jalur utama.

Satu jebakan yang bukan detail: `cancel()` (`base.py:153-160`) harus membunuh
proses **di dalam** container. Membunuh `docker exec` di host meninggalkan proses
anak tetap hidup — tombol Batal akan berbohong.

---

## 5. Dua butir PRD yang ditutup sebagai keputusan sadar

Keduanya tercantum di PRD tapi **tidak akan dikerjakan**. Ini bukan kelalaian;
tulis alasannya di `catatan-implementasi.md` supaya audit berikutnya tidak
menghitungnya sebagai pekerjaan yang hilang.

### 5.1 Classifier LLM v2 (`PRD:118`)

PRD sendiri menandainya opsional ("v2 classifier LLM murah (opsional)"). Dropdown
+ keyword (`router.py:41-48`) sudah cukup untuk pemakaian nyata, dan menambah
panggilan LLM di jalur panas menambah latensi serta konsumsi kuota demi
keuntungan tipis. **Keputusan: tidak dikerjakan.**

### 5.2 Auto-answer trust lewat stdin (`PRD:103`)

PRD menyebutnya sendiri sebagai *"Cadangan"* dan *"Rapuh; hanya jaring
pengaman"*. Jalur utamanya — pre-seed `ensure_trusted()` — sudah jalan di tiga
adapter (`claude_code.py:23`, `antigravity.py:43`, `opencode.py:40`) dan belum
pernah gagal di lapangan. Menambah pembaca stdin yang menebak-nebak prompt trust
menambah permukaan rapuh tanpa masalah nyata yang dipecahkan.

**Keputusan: tidak dikerjakan sampai pre-seed benar-benar gagal di lapangan.**
Kalau suatu saat gagal, catat kasusnya dulu, baru bangun jaring pengamannya.

### 5.3 Catatan: `Event.question` (`PRD:190`)

Bukan pekerjaan yang tersisa — ini penyimpangan yang sudah diputuskan dan
didokumentasikan (`catatan-implementasi.md` §1.1). Ketiga harness jalan di
print-mode, jadi menyuntik jawaban ke proses yang sudah selesai tidak berguna.
Resume-by-session (`POST /api/tasks/{id}/reply`) memberi hasil yang sama.
Tipe `question` tetap ada di kontrak (`events.py:18`) dan tidak pernah di-emit.
Jangan "memperbaiki" ini.

---

## 6. Verifikasi manual UI — belum pernah dijalankan sama sekali

**Butuh manusia + browser. Tidak ada test yang bisa menggantikannya.**

Ini celah kepercayaan terbesar yang tersisa. Dua bug UI terparah project ini
(A1-A6 di Fase 4, H1 di Fase 5b) lolos seluruh suite dan hanya terlihat dari
browser.

Jalankan `./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`, lalu:

**Fase 4 — approval workflow**

1. Buat workflow 2 step lewat UI; step kedua centang "Butuh Persetujuan".
2. Klik **Ubah** → editor terisi, termasuk nama step.
3. Klik **Run**, isi goal.
4. Panel Status Run menampilkan dua baris step dengan status masing-masing.
5. Setelah step 1 selesai, panel approval muncul dengan plan step 1 di textarea.
6. Sunting satu baris plan → **Setujui** → step 2 memakai teks yang sudah
   disunting (cek lewat panel percobaan / `/logs` task step 2).

**Fase 5b — multi-user**

7. Login sebagai admin → tab **Pengguna** muncul.
8. Buat user baru dengan `seed_defaults` aktif → muncul di daftar.
9. Logout → masuk sebagai user baru → tab **Pengguna** **tidak** muncul.
10. Sebagai user baru, buka Routing → terisi 23 rule miliknya, **nol** milik
    admin.
11. Ganti password sendiri → logout → login dengan password baru.
12. Sebagai user baru, jalankan satu tugas ringan → jalan, tidak berhenti dengan
    "tidak ada routing rule".

**Fase 5c — kredensial** *(setelah §2 selesai)*

13. Panel kredensial menampilkan `credential_home` milik user yang login, dan
    path-nya benar-benar ada di disk.
14. Jalankan `HOME=<path> claude login` di terminal untuk user itu, lalu
    jalankan satu tugas dari UI → tugas memakai login tersebut, **bukan** login
    operator.
15. Sebagai user lain yang home-nya belum pernah di-login → tugas gagal dengan
    error auth yang jelas dan memicu cascade, **bukan** diam-diam memakai
    kredensial operator.

**Langkah 15 adalah bukti tunggal bahwa 5c benar-benar bekerja.** Kalau di
langkah itu tugas malah berhasil, isolasinya tidak jalan — berhenti dan laporkan,
jangan tambal di UI.

Langkah 6, 10, dan 12 adalah bukti manusia untuk Fase 4 dan boundary Fase 5a.

---

## 7. Test yang harus ditambahkan

Tidak ada test lama yang boleh diubah.

| # | Test | File | Menguji |
|---|---|---|---|
| D1 | `build_env()` dengan `home` diisi → `HOME` **dan** `USERPROFILE` = path itu | `tests/test_adapters_home.py` (baru) | §2.3 |
| D2 | `build_env()` tanpa `home` → `HOME` sama persis dengan `os.environ` | file sama | §2.1 regresi |
| D3 | `build_adapter(agent, home=X)` menghasilkan adapter ber-`home` X | file sama | §2.4 |
| D4 | Dua user ber-`credential_home` beda → dua nilai `HOME` beda pada subprocess sungguhan | file sama | §2 end-to-end |
| D5 | `POST /api/users` mengisi `credential_home` dan direktorinya benar-benar dibuat | `tests/test_api.py` | §2.6 |
| D6 | Admin bootstrap tetap ber-`credential_home` NULL | `tests/test_api.py` | §2.1 |
| D7 | Task milik user ber-`credential_home` → `build_adapter` menerima home itu | `tests/test_cascade.py` | §2.5 |

**D2 dan D6 yang paling penting.** Keduanya menjaga agar pemakaian single-user
yang sudah jalan tidak rusak — dan itu satu-satunya cara 5c bisa gagal secara
diam-diam.

Untuk D4, jalankan proses sungguhan yang mencetak env-nya, jangan mock:

```python
import sys
cmd = [sys.executable, "-c", "import os; print(os.environ.get('HOME'))"]
```

Untuk D7, `tests/test_cascade.py` sudah punya `FakeAdapter` dan monkeypatch
`build_adapter` (`test_cascade.py:67-79`) — perluas fake-nya untuk merekam
`home`, jangan bangun mesin baru.

---

## 8. Urutan kerja

| # | Kerjaan | File | Sesi |
|---|---|---|---|
| 0 | `index_repository` (§0.3), baca §0.4 | — | 0.1 |
| 1 | Tulis D1-D2 lebih dulu, pastikan **merah** | `tests/test_adapters_home.py` | 0.2 |
| 2 | Patch 1-3: config, `build_env`, registry | `config.py`, `adapters/base.py`, `adapters/registry.py` | 0.4 |
| 3 | Patch 4: alur `credential_home` di runner | `orchestrator/runner.py` | 0.4 |
| 4 | Patch 5: pembuatan home saat user dibuat + D5, D6, D7 | `api/users.py`, `tests/` | 0.4 |
| 5 | Suite penuh + ruff | — | 0.2 |
| 6 | Patch 6: UI panduan login harness | `static/*` | 0.4 |
| 7 | §3: `per-file-ignores` ruff — commit terpisah | `pyproject.toml` | 0.1 |
| 8 | Tulis §2.7 dan §5 ke `catatan-implementasi.md` | `docs/` | 0.2 |
| 9 | Verifikasi manual 15 langkah (§6) — **butuh manusia** | — | 0.7 |

Total ≈ 2,4 sesi di luar item 9.

Item 1 sebelum item 2 dengan sengaja. Dua bug terakhir di project ini lolos
karena test-nya ditulis setelah kodenya dan hanya memeriksa apa yang sudah ada.
Test yang tidak pernah dilihat merah tidak membuktikan apa pun.

**Commit** (jangan pakai trailer `Co-Authored-By`):

1. `feat(5c): HOME per-user untuk subprocess harness` — item 2-4
2. `feat(ui): panduan login harness per-user` — item 6
3. `chore(lint): kecualikan ruleset S dari tests` — item 7
4. `docs: catat batas isolasi kredensial dan dua butir PRD yang ditutup` — item 8

---

## 9. Jebakan

| Jebakan | Kenapa berbahaya |
|---|---|
| Menyetel `HOME` tanpa `USERPROFILE` | Isolasi jalan di Linux, gagal diam-diam di Windows tempat project ini dikembangkan. |
| Mengisi `credential_home` untuk admin bootstrap | Instalasi yang sudah jalan kehilangan login harness-nya setelah restart. |
| Menjadikan `credential_home` wajib (NOT NULL) | `conftest.py:49-66` membuat user tanpa itu; 97 test langsung merah. |
| Mengoper `ctx` ke `_run_attempt` | Ia sengaja tidak tahu soal cascade. Tambah parameter, ikuti pola `user_id` dari 5a. |
| Menganggap 5c mengisolasi kunci API | Tidak. Lihat §2.7 — tulis batasnya, jangan diam. |
| Menambah penyimpanan kredensial di choros | Melanggar `PRD:35` secara langsung. choros tidak pernah menyimpan atau me-replay kredensial. |
| UI membaca field yang tidak dikirim API | Sudah terjadi dua kali (A1-A6, H1). Cek response sungguhan, jangan asumsikan. |
| Membatalkan filter `user_id` Fase 5a | `resolve_targets` wajib keyword-only tanpa default. Kalau ada yang menambah default, pooling terbuka lagi tanpa satu test pun merah. |
| `ruff format` | 34 dari 50 file berubah; sejarah git terkubur. |
| Mengubah test lama supaya hijau | Kalau test lama merah setelah patch, patch-nya yang salah. |
| Mempercayai indeks codebase-memory apa adanya | `base_sha`-nya commit pertama. Indeks ulang, lalu tetap verifikasi ke file. |

---

## 10. Definisi selesai

choros memenuhi PRD v0.2 ketika **semua** berikut benar:

- [ ] `build_env()` menyetel `HOME` + `USERPROFILE` saat `credential_home` ada,
      dan tidak menyentuh env saat NULL (D1, D2).
- [ ] `credential_home` mengalir dari `users` → `RunContext` → `_run_attempt` →
      `build_adapter` (D7).
- [ ] `POST /api/users` membuat direktori home dan mengisi kolomnya (D5); admin
      bootstrap tetap NULL (D6).
- [ ] UI menampilkan `credential_home` milik user yang login beserta perintah
      login harness, dan field yang dibacanya benar-benar dikirim API.
- [ ] Batas isolasi kunci API (§2.7) tertulis di `catatan-implementasi.md` dan di
      UI.
- [ ] Dua butir PRD di §5 tercatat sebagai keputusan sadar beserta alasannya.
- [ ] `ruff check app/ tests/` → **nol** temuan.
- [ ] Suite hijau, nol skip, dengan test D1-D7 termasuk di dalamnya.
- [ ] **Ke-15 langkah verifikasi manual §6 dijalankan manusia dan lolos** —
      terutama langkah 15.

Setelah semua tercentang, Fase 5d (§4) tetap opsional dan boleh tidak pernah
dikerjakan. Itu bukan kekurangan: `rencana-fase5.md` §3 sudah memutuskan
`LocalLauncher` cukup untuk maksud PRD, dan container hanya untuk kebutuhan
isolasi keras yang nyata.

---

## 11. Verifikasi yang mendasari dokumen ini

- Seluruh 15 bagian `PRD-choros-v0.2.md` dibaca dan dipetakan ke kode; hasil
  pemetaannya ada di jawaban audit yang mendahului dokumen ini.
- `base.py:191` (`env = {**os.environ, ...}`) dibaca langsung dan disilangkan
  dengan `registry.py:35-48` (`build_adapter`) serta `runner.py:462` (satu-satunya
  pemanggil) untuk memastikan jalur `home` hanya punya satu titik masuk.
- Keberadaan kolom `credential_home` dipastikan di `models.py:31` dan
  `migrations/004_multiuser.sql` — karena itu 5c tidak butuh migrasi.
- Batas isolasi kunci API dikonfirmasi dari `openai_compat.py:50-53` dan
  `opencode.py:77-80`, keduanya membaca `os.environ` saat run.
- `ensure_trusted` dipastikan terimplementasi di tiga adapter
  (`claude_code.py:23`, `antigravity.py:43`, `opencode.py:40`), yang mendasari
  keputusan §5.2.
- Flag permission per harness dipastikan lengkap sesuai `PRD:181-183`:
  `claude_code.py:66-73` (termasuk `--allowedTools`), `antigravity.py:83`,
  `opencode.py:67`.
- 13 temuan ruff dilokalisasi satu per satu dengan `--output-format concise`;
  seluruhnya di `tests/`, `app/` nol.
- Jumlah test (97) dan status git (14 commit, bersih, 13 belum ter-push)
  diverifikasi langsung, bukan diasumsikan.

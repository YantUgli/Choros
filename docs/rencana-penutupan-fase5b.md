# Rencana penutupan Fase 5b

Dokumen eksekusi untuk agentic AI. Ditulis setelah audit hasil implementasi
`rencana-fase5b.md`. **Tidak perlu dieksekusi oleh penulis dokumen ini.**

Isinya tiga lapis: (0) konteks lingkungan supaya tidak ada waktu terbuang menebak
perkakas, (1) satu blocker + dua temuan Fase 5b, (2) seluruh utang yang masih
menggantung dari Fase 3.5 sampai 5b, supaya bisa ditutup sekaligus.

---

## 0. Konteks lingkungan — baca ini dulu

### 0.1 Perkakas

| Hal | Nilai |
|---|---|
| OS | Windows 10, `win32` |
| Shell | PowerShell **dan** Git Bash tersedia; sintaksnya beda, jangan dicampur |
| Direktori kerja | `C:\project\Choros` |
| Python | **`python` TIDAK ada di PATH.** Selalu `./.venv/Scripts/python.exe` |
| Database | PostgreSQL 16 di Docker, container `choros-db-1`, port **5433** |
| DB test | `postgresql+asyncpg://choros:choros@localhost:5433/choros_test` |
| Branch | `main`; repo ini single-developer, commit langsung ke `main` |

Perintah yang sering dipakai:

```bash
# Suite penuh — 91 test, ±6 menit. Jangan dijalankan berulang tanpa perlu.
./.venv/Scripts/python.exe -m pytest -q

# Satu file (jauh lebih cepat)
./.venv/Scripts/python.exe -m pytest tests/test_api.py -q

# Lint. Basis saat ini: 10 temuan di app/, semuanya disengaja (lihat §5.1)
./.venv/Scripts/python.exe -m ruff check app/

# Sanity import
./.venv/Scripts/python.exe -c "import app.main; print('ok')"
```

Fixture `clean_db` (`tests/conftest.py:37-46`) ber-`autouse`, dan tiap test
menjalankan `apply_migrations()` + `TRUNCATE ... RESTART IDENTITY CASCADE`.
Itulah sebabnya suite lambat (±3,8 detik per test) — bukan karena ada yang macet.

### 0.2 Jebakan shell yang sudah memakan korban

- **Jangan pakai here-string PowerShell (`@'...'@`) di dalam tool Bash.** Bash
  meneruskan karakter `@` apa adanya dan menghasilkan pesan commit rusak. Untuk
  pesan multi-baris di Bash pakai heredoc POSIX:
  ```bash
  git commit -F - <<'EOF'
  judul

  badan
  EOF
  ```
- `wsl` menulis peringatan systemd ke stderr. Itu normal, bukan kegagalan.

### 0.3 MCP `codebase-memory` — pakai sebagai bantuan, bukan sumber kebenaran

Server MCP `codebase-memory` terpasang di WSL Ubuntu. Kalau sesi kamu sudah punya
tool `mcp__codebase-memory__*`, pakai itu langsung. Kalau tidak, ada mode CLI:

```bash
# Daftar project terindeks
wsl -e bash -lc 'codebase-memory-mcp cli list_projects'

# Status indeks choros
wsl -e bash -lc 'codebase-memory-mcp cli index_status "{\"project\":\"choros\"}"'

# Ringkasan arsitektur (jumlah node per label, jenis edge)
wsl -e bash -lc 'codebase-memory-mcp cli get_architecture "{\"project\":\"choros\"}"'

# File yang berubah dibanding baseline indeks
wsl -e bash -lc 'codebase-memory-mcp cli detect_changes "{\"project\":\"choros\"}"'

# Indeks ulang
wsl -e bash -lc 'codebase-memory-mcp cli index_repository "{\"project\":\"choros\"}"'
```

Tool yang terverifikasi ada: `list_projects`, `index_status`, `index_repository`,
`detect_changes`, `get_architecture`. Project bernama **`choros`**, root
`/mnt/c/project/Choros` (path WSL untuk `C:\project\Choros`).

**PERINGATAN PENTING.** Indeks yang ada sekarang melaporkan `status: ready`, 595
node, 3145 edge — tapi `base_sha`-nya `3e163ab`, yaitu **commit pertama repo**.
Artinya graf-nya dibangun dari keadaan sebelum Fase 3.5 sampai 5b. Konsekuensinya:

- `detect_changes` melaporkan hampir seluruh file sebagai berubah — itu benar
  secara teknis dan tidak berguna secara praktis.
- Grafnya tidak mengenal `app/defaults.py`, `app/api/users.py`,
  `app/api/workflows.py`, `app/orchestrator/workflow.py`.

**Jalankan `index_repository` dulu sebelum mempercayai jawabannya.** Dan apa pun
jawabannya, verifikasi ke file sungguhan sebelum mengubah kode — pola
kesalahan paling mahal di project ini justru "menyimpulkan dari satu lapisan
tanpa memeriksa lapisan yang benar-benar jalan" (lihat `catatan-implementasi.md`
§3).

### 0.4 Dokumen yang wajib dibaca sebelum mulai

| Dokumen | Kenapa |
|---|---|
| `docs/rencana-fase5.md` | peta Fase 5 utuh: temuan F1-F5, keputusan `Launcher`, 5a-5d |
| `docs/rencana-fase5b.md` | rencana yang baru saja dieksekusi; §11 daftar jebakannya masih berlaku |
| `docs/catatan-implementasi.md` §3 | kenapa klaim status di project ini pernah salah, dan bagaimana salahnya |
| `PRD-choros-v0.2.md` §1, §4, §14 | non-tujuan (pooling), lapisan auth, urutan fase |

### 0.5 Keadaan kode saat dokumen ini ditulis

- HEAD `1dcb7a0`, **working tree kotor**: seluruh hasil Fase 5b belum di-commit.
  11 file termodifikasi, 4 file baru (`app/api/users.py`, `app/defaults.py`,
  `migrations/004_multiuser.sql`, `docs/rencana-fase5b.md`).
- Suite: **91 passed**, nol gagal, nol skip.
- ruff `app/`: 10 temuan, sama persis seperti sebelum Fase 5b — file baru bersih.
- Fase 5a (`c096cbb`) sudah menutup boundary routing & kuota. Jangan
  membatalkannya secara tidak sengaja.

---

## 1. Blocker — H1: panel "Pengguna" tidak akan pernah muncul

### Gejala

Seluruh pengelolaan user tidak bisa dijangkau dari browser, walau API-nya benar
dan sudah teruji (B5, B8, B9 hijau).

### Sebab

`app/static/app.js:977`:

```javascript
if (status.is_admin && tabUsers) {
  tabUsers.classList.remove("hidden");
}
```

`app/api/auth.py:37-40`:

```python
return {
    "auth_required": not is_disabled,
    "username": username,
}
```

`is_admin` tidak pernah dikirim. `undefined` itu falsy, jadi cabangnya tidak
pernah jalan, dan `#tab-users` yang lahir `class="tab hidden"`
(`app/static/index.html:24`) tetap tersembunyi selamanya.

Tidak ada error di console, tidak ada test yang merah. Ini kelas kesalahan yang
sama persis dengan A1-A6 di Fase 4: **UI membaca field yang tidak dikembalikan
API.** B7 lolos karena ia hanya memeriksa `username`.

### Perbaikan

`auth_status` sekarang tidak pernah memuat baris `User` — ia hanya membaca
username dari cookie. Untuk tahu `is_admin` ia harus benar-benar melakukan
lookup.

```python
@router.get("/status")
async def auth_status(
    request: Request, session: DbSession
) -> dict[str, Any]:
    is_disabled = await auth_disabled(session)
    username = None
    if is_disabled:
        username = get_settings().admin_username
    else:
        token = request.cookies.get(COOKIE_NAME)
        if token:
            username = read_cookie(token)

    is_admin = False
    if username:
        row = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        is_admin = bool(row and row.is_admin)

    return {
        "auth_required": not is_disabled,
        "username": username,
        "is_admin": is_admin,
    }
```

Tiga hal yang harus dijaga:

1. **Endpoint ini tetap tidak boleh butuh login.** `app.js:959` memanggilnya
   sebelum login; kalau jadi 401, dashboard tidak akan pernah boot.
2. **Cookie kedaluwarsa/rusak → `username` None → `is_admin` False.**
   `read_cookie` (`security.py:44-50`) sudah mengembalikan None untuk tanda
   tangan tidak sah, jadi cukup jangan menambah jalur lain.
3. **Jangan mengembalikan objek `User` mentah.** Isinya termasuk
   `password_hash`.

### Catatan mode terbuka

Pada mode 1 (`auth_disabled` true) `username` = `settings.admin_username`, dan
baris user itu ber-`is_admin=True` karena bootstrap `main.py:44-60`
membuatnya begitu. Jadi alur lokal satu orang mendapat tab Pengguna — benar.

**Tapi di test hal itu tidak otomatis:** `tests/conftest.py:49-56` membuat
`User(username="tester")` langsung, tanpa `is_admin`, dan default modelnya
`False` (`models.py:30`). Test apa pun yang mengharapkan `is_admin: true` harus
menyetelnya sendiri secara eksplisit. Ini penyebab kegagalan yang paling mungkin
kamu temui.

---

## 2. H2 — output `scripts/seed.py` hilang

Sebelum Fase 5b, seed mencetak apa yang dikerjakannya:

```
+ agent claude
+ route coding_complex → claude/default @10
~ route draft_bulk → opencode-groq/... @20 (reconciled)
```

Ketiga `print` itu ikut terbuang saat logika pindah ke `app/defaults.py`
(`seed_defaults`, tidak ada satu pun `print` di sana). Sekarang
`python -m scripts.seed` hanya mencetak `seed selesai.` — dan `--reconcile`,
yang seluruh gunanya adalah memperlihatkan apa yang berubah, jadi bisu.

### Jangan kembalikan `print`-nya

`seed_defaults` sekarang dipanggil dari `POST /api/users`
(`app/api/users.py:37-38`), yaitu **di dalam request HTTP**. `print` di sana akan
mengotori stdout server tiap kali admin membuat user. Modul di `app/` tidak boleh
mencetak.

### Kembalikan laporan, biarkan pemanggil yang mencetak

```python
# app/defaults.py
@dataclass(slots=True)
class SeedReport:
    agents_added: list[str] = field(default_factory=list)
    routes_added: list[str] = field(default_factory=list)
    routes_reconciled: list[str] = field(default_factory=list)


async def seed_defaults(
    session: AsyncSession, user: User, *, reconcile: bool = False
) -> SeedReport:
    ...
```

`scripts/seed.py` mencetak isinya dengan format lama persis. `app/api/users.py`
mengabaikan nilai baliknya — atau, kalau berguna, memasukkan hitungannya ke
response `UserOut`; itu opsional dan bukan syarat penutupan.

Nilai balik yang berubah dari `None` ke `SeedReport` aman: hanya ada dua
pemanggil, keduanya di repo ini.

---

## 3. H3 — kerapuhan yang sengaja TIDAK diubah

`app/security.py:89` mendefinisikan `get_current_admin(user: CurrentUser)`,
sementara `CurrentUser` baru ada di baris 97. Ini jalan karena
`from __future__ import annotations` menunda evaluasi anotasi sampai FastAPI
meresolusinya saat registrasi route, dan saat itu modulnya sudah termuat penuh.

**Jangan diubah.** Dicatat di sini hanya supaya orang berikutnya tidak
"memperbaikinya" dengan memindahkan definisi, dan supaya tahu risikonya kalau
pola ini disalin ke modul tanpa `from __future__ import annotations` — di sana ia
akan `NameError`.

---

## 4. Test yang harus ditambahkan

Tidak ada test lama yang boleh diubah. Semua di `tests/test_api.py`.

| # | Test | Menguji |
|---|---|---|
| C1 | `/api/auth/status` untuk user admin ber-cookie sah → `is_admin: true` | H1 |
| C2 | `/api/auth/status` untuk user non-admin ber-cookie sah → `is_admin: false` | H1 |
| C3 | `/api/auth/status` tanpa cookie (mode berpassword) → 200, `username: null`, `is_admin: false` | H1 + kontrak boot |
| C4 | Body `/api/auth/status` memuat **ketiga** kunci `auth_required`, `username`, `is_admin` | kontrak UI |
| C5 | `seed_defaults` mengembalikan `SeedReport` dengan 6 agent + 23 route saat user baru | H2 |
| C6 | `seed_defaults` dipanggil dua kali pada user yang sama → panggilan kedua melaporkan nol tambahan | H2 idempoten |

**C4 adalah yang paling bernilai jangka panjang.** Ia satu-satunya yang menahan
kelas kesalahan A1-A6/H1 supaya tidak terulang: kontrak antara `app.js` dan
`auth.py` jadi punya penjaga. Tulis sebagai daftar kunci yang eksplisit, bukan
`assert res.json()` apa adanya.

Untuk C1/C2, terbitkan cookie lewat `issue_cookie(username)`
(`security.py:40`) seperti yang sudah dilakukan `test_cookie_auth_flow`
(`test_api.py:286`), dan **jangan lupa `get_settings.cache_clear()` di `finally`**
kalau kamu menyentuh env — `get_settings` ber-`@lru_cache` (`config.py:36`) dan
kebocorannya membuat test lain gagal dengan cara yang membingungkan.

---

## 5. Utang lintas fase yang masih menggantung

Bagian ini bukan bagian Fase 5b, tapi dikumpulkan di sini supaya bisa ditutup
sekalian. Urutannya sudah dari yang paling berdampak.

### 5.1 `ruff` belum terkonfigurasi (utang sejak Fase 3.5b)

`ruff` terpasang di venv (0.16.1) tapi **tidak ada di `pyproject.toml` sama
sekali** — tidak di `[project.optional-dependencies].dev` (isinya hanya pytest,
pytest-asyncio, anyio) dan tidak ada blok `[tool.ruff]`. Artinya setiap orang
menjalankan ruleset default versi ruff yang kebetulan ia punya, dan hasilnya bisa
berbeda antar mesin.

Sepuluh temuan yang tersisa di `app/` semuanya disengaja:

| Aturan | Jumlah | Lokasi & alasan |
|---|---|---|
| `BLE001` blind-except | 6 | `isolation.py:199`, `workflow.py:252`, `runner.py:164/328/470`, `adapters/base.py:234` — jalur pembersihan best-effort dan parser yang tidak boleh menjatuhkan run |
| `S110` try-except-pass | 2 | idem |
| `SIM102` / `SIM117` | 2 | dua adapter |

**Kerjaan:**

1. Tambah `"ruff>=0.16"` ke `dev`.
2. Tambah `[tool.ruff]` yang memilih ruleset secara eksplisit, dan `ignore`
   untuk `BLE001`/`S110` **dengan komentar alasannya** — atau, kalau lebih suka
   presisi, `# noqa: BLE001` per baris beserta alasannya. Pilih satu, jangan
   campur.
3. Jangan jalankan `ruff format`. `ruff format --check` melaporkan 34 dari 50
   file akan berubah; diff sebesar itu mengubur sejarah git. Kalau memang
   diinginkan, jadikan **satu commit berdiri sendiri** yang tidak mengandung
   perubahan perilaku apa pun.

### 5.2 Fixture `authed_client` (utang sejak Fase 4, prioritas rendah)

`rencana-penutupan-fase4.md` §B1 meminta fixture `authed_client` di
`tests/conftest.py`. Sampai sekarang tidak ada.

**Prioritas rendah, dan alasannya penting:** substansi yang dikhawatirkan waktu
itu — "alur login berpassword nol test" — sudah tertutup oleh
`test_cookie_auth_flow` (`test_api.py:267`) dan sekarang diperkuat B3, B4, B7.
Yang belum ada hanya bentuk fixture yang bisa dipakai ulang. Kerjakan kalau
test C1-C3 di §4 terasa banyak mengulang; kalau tidak, biarkan.

### 5.3 Verifikasi manual UI — belum pernah dijalankan sama sekali

Tidak ada test yang menutupi ini dan tidak akan ada. Butuh browser sungguhan.

**Sisa dari Fase 4** (`rencana-penutupan-fase4.md` §6):

1. Buat workflow 2 step lewat UI, step kedua centang "Butuh Persetujuan".
2. Klik **Ubah** pada workflow itu → editor terisi, termasuk nama step.
3. Klik **Run**, isi goal.
4. Panel Status Run menampilkan dua baris step dengan status per step.
5. Setelah step 1 selesai, panel approval muncul dengan plan step 1 di textarea.
6. Sunting satu baris plan, klik **Setujui** → step 2 jalan memakai teks yang
   sudah disunting (cek lewat panel percobaan / `/logs` task step 2).

Langkah 6 satu-satunya bukti end-to-end untuk A4. Padanan otomatisnya ada
(`test_approve_with_edited_plan_artifact`), tapi jalur browsernya belum pernah
disentuh.

**Tambahan untuk Fase 5b** (setelah H1 diperbaiki):

7. Login sebagai admin → tab **Pengguna** muncul. *(Ini yang H1 halangi; sebelum
   diperbaiki, langkah ini pasti gagal.)*
8. Buat user baru lewat panel dengan `seed_defaults` aktif → user itu muncul di
   daftar.
9. Logout → masuk sebagai user baru → tab **Pengguna** **tidak** muncul.
10. Sebagai user baru, buka halaman Routing → terisi 23 rule hasil semai, dan
    **tidak satu pun** milik admin. Ini sekaligus verifikasi visual Fase 5a.
11. Ganti password sendiri lewat modal → logout → login dengan password baru.
12. Sebagai user baru, jalankan satu tugas ringan → tugas berjalan, tidak
    berhenti dengan "tidak ada routing rule".

Langkah 10 dan 12 adalah bukti manusia untuk boundary Fase 5a. Kalau salah
satunya gagal, berhenti dan laporkan — jangan tambal di UI.

### 5.4 Commit Fase 5b

Belum ada satu pun. `rencana-fase5b.md` §10 meminta tiga:

1. Identitas & sesi — `migrations/004`, `models.py`, `security.py`,
   `app/api/auth.py`, `app/main.py`
2. Pengelolaan user — `app/defaults.py`, `scripts/seed.py`,
   `app/api/users.py`, `app/schemas.py`, `app/api/__init__.py`
3. UI — `app/static/*`

Perbaikan H1 menyentuh `app/api/auth.py` **dan** `app/static/app.js`, jadi ia
paling jujur jadi **commit keempat** (`fix(auth): kembalikan is_admin ...`),
bukan diselipkan ke commit 1 atau 3. H2 masuk commit 2 kalau dikerjakan sebelum
commit dibuat; kalau sesudah, jadikan commit sendiri.

Akhiri tiap pesan commit dengan:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 6. Urutan kerja

| # | Kerjaan | File | Sesi |
|---|---|---|---|
| 0 | Indeks ulang codebase-memory (§0.3), baca §0.4 | — | 0.1 |
| 1 | Tulis C1-C4 lebih dulu, pastikan **merah** | `tests/test_api.py` | 0.2 |
| 2 | Perbaiki H1 | `app/api/auth.py` | 0.2 |
| 3 | H2: `SeedReport` + C5-C6 | `app/defaults.py`, `scripts/seed.py`, `tests/` | 0.4 |
| 4 | Suite penuh + ruff | — | 0.2 |
| 5 | Empat commit Fase 5b (§5.4) | — | 0.2 |
| 6 | `[tool.ruff]` + ruff ke dev deps (§5.1), commit terpisah | `pyproject.toml` | 0.3 |
| 7 | Verifikasi manual UI 12 langkah (§5.3) — **butuh manusia + browser** | — | 0.5 |

Total ≈ 1,6 sesi di luar item 7.

Item 1 sebelum item 2 dengan sengaja. H1 adalah bug yang lolos justru karena
test-nya ditulis setelah kodenya dan hanya memeriksa apa yang sudah ada. Test
yang tidak pernah dilihat merah tidak membuktikan apa pun.

---

## 7. Jebakan

| Jebakan | Kenapa berbahaya |
|---|---|
| Mengembalikan objek `User` dari `/api/auth/status` | Membocorkan `password_hash`. Susun dict-nya manual. |
| Membuat `/api/auth/status` butuh login | `app.js:959` memanggilnya sebelum login → dashboard tidak pernah boot. |
| `print` di dalam `app/defaults.py` | Dipanggil dari request HTTP (`users.py:38`); akan mengotori stdout server. |
| Mengharapkan `is_admin` true di test tanpa menyetelnya | `conftest.py:49-66` membuat user tanpa `is_admin`; defaultnya `False`. |
| `get_settings` ber-`@lru_cache` | Wajib `cache_clear()` sebelum **dan** sesudah menyentuh env. Sudah menggigit dua kali. |
| Menjalankan `ruff format` | 34 dari 50 file berubah; sejarah git terkubur. |
| Here-string PowerShell di tool Bash | Menghasilkan pesan commit rusak. Pakai heredoc POSIX. |
| Mempercayai indeks codebase-memory apa adanya | `base_sha`-nya commit pertama. Indeks ulang dulu, lalu tetap verifikasi ke file. |
| Membatalkan filter `user_id` Fase 5a | `resolve_targets` wajib keyword-only tanpa default. Kalau ada yang menambah default, pooling terbuka lagi tanpa satu test pun merah. |
| Mengubah test lama supaya hijau | Kalau test lama merah setelah patch, patch-nya yang salah. |

---

## 8. Yang sengaja TIDAK dikerjakan di penutupan ini

- **Fase 5c (isolasi credential per-user).** Sudah direncanakan di
  `rencana-fase5.md` §6. Sampai itu selesai, choros punya banyak user tapi
  **masih satu credential store** — `adapters/base.py:191` mewariskan
  `os.environ` apa adanya. Jangan pakai mode tim sungguhan dulu, dan tulis itu
  di UI kalau sempat.
- **Fase 5d (container).** `rencana-fase5.md` §7.
- **Kuota per-user sebagai kebijakan admin.** Fitur lain, bukan penutupan.
- **Reset password oleh admin.** Saat ini hanya user sendiri yang bisa ganti
  password (`auth.py:81`). Tambahkan hanya kalau ada kebutuhan nyata.
- **`ruff format`.** Lihat §5.1 poin 3.

---

## 9. Verifikasi yang mendasari dokumen ini

- Suite dijalankan penuh: **91 passed in 351.68s**, nol skip.
- H1 dikonfirmasi dua arah: `grep is_admin app/api/auth.py` → nol hasil, dan
  `app.js:977` terbaca langsung bercabang pada `status.is_admin`. Kondisi awal
  `#tab-users` diperiksa di `index.html:24` (`class="tab hidden"`).
- Seluruh pemanggilan API dari UI dicocokkan ke handler-nya:
  `app.js:857/876/897/933/948` terhadap `app/api/users.py` dan
  `app/api/auth.py` — semuanya cocok. `is_admin` satu-satunya yang tidak.
- H2 dikonfirmasi dengan `grep print app/defaults.py` (nol hasil) disilangkan
  dengan `git diff scripts/seed.py`, yang memperlihatkan tiga baris `print`
  terhapus.
- Basis ruff diukur ulang: `app/` = 10 temuan, identik dengan sebelum Fase 5b —
  jadi `app/defaults.py` dan `app/api/users.py` tidak menambah utang.
- B1 dipastikan sah, bukan lolos karena kebetulan: `.env` diperiksa dan tidak
  memuat `CHOROS_ADMIN_PASSWORD_HASH`, sehingga `auth_disabled()` benar-benar
  bergantung pada tabel.
- Status MCP diverifikasi dengan menjalankan `list_projects`, `index_status`,
  `get_architecture`, dan `detect_changes` sungguhan. `base_sha` = `3e163ab`
  dibaca dari keluaran `index_status`, bukan diasumsikan.
- Ketiadaan `ruff` di `pyproject.toml` dan ketiadaan `authed_client` di
  `tests/conftest.py` diperiksa langsung dengan grep.

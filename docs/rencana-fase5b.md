# Rencana Fase 5b — auth multi-user

Turunan `rencana-fase5.md` §5, diperinci setelah kode dibaca ulang.

**Prasyarat: 5a sudah selesai** (`c096cbb`). Itu penting bukan sekadar urutan —
5a mengubah `resolve_targets` jadi tersaring `Agent.user_id`, dan itulah yang
membuat §4 dokumen ini (user baru lahir tanpa apa-apa) jadi masalah nyata.

**Ruang lingkup:** identitas dan sesi saja. Isolasi credential (`HOME` per-user)
adalah 5c dan sengaja tidak disentuh di sini — 5b berhenti tepat sebelum
kredensial. Konsekuensinya jujur: **setelah 5b selesai, choros punya banyak user
tapi masih satu credential store.** Jangan pakai mode tim sungguhan sampai 5c
selesai.

---

## 1. Empat temuan yang membentuk dokumen ini

### G1 — 5b bisa menciptakan lubang yang sekarang tidak ada (paling serius)

`security.py:53-55`:

```python
def auth_disabled() -> bool:
    """Tanpa password hash, app jalan mode lokal terbuka (dengan peringatan)."""
    return not get_settings().admin_password_hash
```

Satu-satunya sumbernya adalah environment. Begitu password pindah ke tabel
`users`, muncul kombinasi yang hari ini mustahil:

> `CHOROS_ADMIN_PASSWORD_HASH` kosong, tapi tabel `users` berisi tiga user
> berpassword.

Operator yang memasang mode tim tanpa menyetel env hash akan mendapat
`auth_disabled() == True` → `get_current_user` (`security.py:65-72`) melewati
pengecekan cookie sepenuhnya → **setiap request anonim dilayani sebagai
`admin_username`**. Dashboard terbuka lebar, dan `app.js:857` hanya menampilkan
notifikasi kecil.

Ini bukan bug yang diwarisi. Ini bug yang **dibuat oleh 5b** kalau
`auth_disabled()` dibiarkan apa adanya. Menutupnya adalah syarat, bukan opsi.

### G2 — user baru lahir tanpa agent dan tanpa routing rule

Setelah 5a, `resolve_targets` menyaring `Agent.user_id`. `scripts/seed.py:106-112`
hanya menyemai untuk satu user: `settings.admin_username`.

Jadi begitu 5b bisa membuat user kedua, tugas pertama user itu akan menempuh
`runner.py:236-247` — `targets` kosong → status `halted` → pesan "tidak ada
routing rule untuk kategori ini".

5a benar dan seed benar; **kombinasinya** yang berlubang. Karena itu penyemaian
per-user harus masuk 5b, bukan ditunda — tanpa itu fitur "buat user" menghasilkan
akun yang tidak bisa mengerjakan apa pun.

### G3 — `/api/auth/status` melaporkan username yang salah

`auth.py:12-17` mengembalikan `get_settings().admin_username` — konstanta
environment, bukan siapa yang sedang login. Benar untuk single-user, salah begitu
ada dua user.

### G4 — logout tidak pernah dipanggil UI

`auth.py:39-42` menyediakan `POST /api/auth/logout`. Pencarian di
`app/static/` menemukan **nol** pemanggil. Single-user tidak masalah (tidak ada
yang perlu berganti); mode tim tanpa tombol keluar adalah cacat.

### G5 — bootstrap tidak menandai siapa admin

`main.py:42-49` membuat baris `User(username=settings.admin_username)` tanpa
penanda apa pun. Setelah ada kolom `is_admin`, instalasi lama akan punya nol
admin — dan endpoint pembuatan user jadi tidak bisa dipakai siapa pun.

---

## 2. Migrasi `004_multiuser.sql`

```sql
-- Fase 5b: auth multi-user.
-- Semua statement idempoten — apply_migrations() (db.py:94-99) menjalankan
-- SELURUH file .sql pada tiap startup DAN tiap test (conftest.py:42).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_home TEXT;

-- Dipakai auth_disabled(): EXISTS(user berpassword). Partial index supaya
-- pengecekan per-request tidak memindai tabel.
CREATE INDEX IF NOT EXISTS idx_users_with_password
  ON users (id) WHERE password_hash IS NOT NULL;
```

`password_hash` dan `credential_home` **wajib nullable**: `conftest.py:49-66`
membuat `User(username=...)` tanpa keduanya, dan 83 test bergantung pada itu.
`credential_home` belum dipakai di 5b — ia disiapkan di sini supaya 5c tidak
perlu migrasi lagi.

`is_admin` sengaja `NOT NULL DEFAULT FALSE`, bukan nullable: "tidak tahu apakah
admin" bukan keadaan yang boleh ada.

---

## 3. Keputusan inti — `auth_disabled()` jadi async (menutup G1)

Aturan barunya:

> Mode terbuka **hanya** kalau env hash kosong **dan** tidak ada satu pun user
> ber-`password_hash`.

Artinya fungsi ini butuh database. Dua jalan:

| Opsi | Bentuk | Masalah |
|---|---|---|
| **A** | Flag modul dihitung saat startup, diperbarui saat user dibuat | Basi kalau user ditambah lewat SQL langsung atau proses lain. Gagalnya diam-diam, dan arah gagalnya *terbuka*. |
| **B** | `async def auth_disabled(session)` — query tiap kali dipakai | Satu query tambahan per request |

**Pilih B.** Kalau salah satu arah kegagalan adalah "dashboard terbuka tanpa
login", cache tidak sepadan. Query-nya `EXISTS` di atas partial index, dan
`get_current_user` toh sudah menyentuh DB di baris yang sama.

```python
async def auth_disabled(session: AsyncSession) -> bool:
    if get_settings().admin_password_hash:
        return False
    has_password_user = (
        await session.execute(
            select(User.id).where(User.password_hash.is_not(None)).limit(1)
        )
    ).first()
    return has_password_user is None
```

Tiga pemanggil harus ikut berubah:

| Pemanggil | Perubahan |
|---|---|
| `security.py:65` (`get_current_user`) | sudah punya `session` — cukup `await` |
| `api/auth.py:15` (`auth_status`) | tambah `session: DbSession` |
| `api/auth.py:23` (`login`) | tambah `session: DbSession` |
| `main.py:51` (peringatan startup) | sudah di dalam blok `SessionLocal()` di `main.py:42` — pindahkan pemanggilannya ke dalam blok itu |

### Tiga mode, diputuskan berurutan

| # | Kondisi | Perilaku |
|---|---|---|
| 1 | env hash kosong **dan** tak ada user berpassword | mode lokal terbuka — **persis seperti sekarang** |
| 2 | env hash terisi, tak ada user berpassword | single admin dari env — **persis seperti sekarang** |
| 3 | ada user berpassword | mode tim; env admin tetap sah sebagai akun darurat |

Mode 1 dan 2 tidak boleh berubah sedikit pun. `test_auth_disabled_mode`
(`test_api.py:20`) dan `test_cookie_auth_flow` (`test_api.py:266`) adalah
penjaganya — kalau salah satunya merah, patch-nya yang salah, bukan test-nya.

---

## 4. Login

```python
@router.post("/login")
async def login(payload: LoginIn, response: Response, session: DbSession) -> dict:
    settings = get_settings()
    if await auth_disabled(session):
        return {"ok": True, "auth_required": False}

    user = (
        await session.execute(select(User).where(User.username == payload.username))
    ).scalar_one_or_none()

    if user is not None and user.password_hash:
        ok = verify_password(payload.password, user.password_hash)
    elif payload.username == settings.admin_username and settings.admin_password_hash:
        ok = verify_password(payload.password, settings.admin_password_hash)
    else:
        ok = False

    if not ok:
        raise HTTPException(status_code=401, detail="username atau password salah")
    ...
```

Urutan `if/elif` itu penting: user yang **ada di tabel tapi belum punya
password** tidak boleh jatuh ke cabang env, kecuali namanya memang
`admin_username`. Tanpa `elif`, seorang user bernama apa pun bisa masuk memakai
password admin.

`get_current_user` tidak perlu diubah selain `await` — `security.py:74-79` sudah
mencari user dari username hasil cookie, bukan hardcode. Lapisan sesi memang
sudah multi-user sejak Fase 1.

---

## 5. Hak admin

```python
async def get_current_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="butuh hak admin")
    return user

CurrentAdmin = Annotated[User, Depends(get_current_admin)]
```

**403, bukan 404.** Konvensi repo memakai 404 untuk boundary kepemilikan
(menyembunyikan keberadaan resource orang lain). Ini bukan itu — ini kapabilitas
pada endpoint yang keberadaannya memang publik. Menyamarkannya jadi 404 hanya
membingungkan.

### Bootstrap (menutup G5)

`main.py:42-49` diperluas:

1. User `admin_username` dibuat kalau belum ada — seperti sekarang.
2. Kalau **belum ada satu pun** `is_admin=TRUE` di tabel, user itu dipromosikan.

Langkah 2 menangani instalasi lama: baris user yang sudah ada sejak Fase 1
mendapat haknya tanpa intervensi manual. Syaratnya "belum ada admin sama sekali",
bukan "selalu promosikan" — supaya admin yang sengaja diturunkan tidak
dipromosikan lagi tiap restart.

Dalam mode 1 (terbuka), user default tetap `is_admin=TRUE`, jadi alur lokal satu
orang tidak kehilangan kemampuan apa pun.

---

## 6. Endpoint pengelolaan user

| Method | Path | Akses | Catatan |
|---|---|---|---|
| `POST` | `/api/users` | admin | buat user + semai default (§7) |
| `GET` | `/api/users` | admin | daftar; **jangan** kembalikan `password_hash` |
| `DELETE` | `/api/users/{id}` | admin | tolak kalau punya task/workflow, dan tolak menghapus admin terakhir |
| `POST` | `/api/auth/password` | siapa pun | ganti password sendiri; wajib password lama |

Bukan registrasi terbuka — choros self-hosted, bukan SaaS (`rencana-fase5.md`
§11).

Skema baru di `schemas.py`:

```python
class UserIn(BaseModel):
    username: str
    password: str
    is_admin: bool = False
    seed_defaults: bool = True

class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime
```

`UserOut` tidak mewarisi `UserIn` — pola `AgentOut(AgentIn)` (`schemas.py:23`)
tidak boleh ditiru di sini, karena akan membocorkan `password` ke response.

Perbaikan G3 di `/api/auth/status`: kembalikan username user yang sedang login.
Endpoint itu dipanggil `app.js:855` sebelum login, jadi ia harus tetap menjawab
tanpa cookie — kembalikan `username: null` saat belum login, bukan 401.

---

## 7. Semai default per-user (menutup G2)

`scripts/seed.py` memegang `AGENTS` (6 entri) dan `ROUTES` (23 entri) sebagai
konstanta modul, dan logika penyemaiannya terikat pada satu user
(`seed.py:101-153`).

**Pindahkan ke `app/defaults.py`:**

```python
AGENTS = [...]   # dipindah apa adanya dari scripts/seed.py
ROUTES = [...]

async def seed_defaults(session, user, *, reconcile: bool = False) -> None:
    """Semai agent + routing rule default untuk satu user. Idempoten."""
```

Lalu:

- `scripts/seed.py` jadi pembungkus CLI tipis yang memanggilnya untuk
  `admin_username` — `--reconcile` tetap jalan.
- `POST /api/users` memanggilnya untuk user baru saat `seed_defaults=True`.

Alasan `app/defaults.py` dan bukan impor dari `scripts/`: `app` tidak boleh
bergantung pada `scripts` — arah ketergantungannya terbalik, dan `scripts` bukan
paket yang ikut ter-install (`pyproject.toml:31` hanya menyertakan `app*`).

Agent yang disemai tidak membawa kredensial apa pun; ia hanya baris konfigurasi.
Kredensial sungguhan baru terpisah di 5c.

---

## 8. UI

| # | Kerjaan | File |
|---|---|---|
| 1 | Tampilkan user yang login + tombol Keluar (G4) → `POST /api/auth/logout` lalu `location.reload()` | `index.html`, `app.js` |
| 2 | Panel "Pengguna" khusus admin: daftar, tambah, hapus | `index.html`, `app.js` |
| 3 | Form ganti password sendiri | `index.html`, `app.js` |
| 4 | `boot()` (`app.js:854`) memakai `status.username` untuk mengisi label | `app.js` |

Panel 2 disembunyikan kalau `is_admin` false. Itu kenyamanan, **bukan
keamanan** — penegakannya tetap di `CurrentAdmin`.

Peringatan `app.js:857` perlu diperjelas: teksnya sekarang menyebut
`CHOROS_ADMIN_PASSWORD_HASH` sebagai satu-satunya sebab, padahal setelah §3 mode
terbuka punya dua syarat.

---

## 9. Test yang harus ditambahkan

Semua di `tests/test_api.py` kecuali disebut lain. Tidak ada test lama yang boleh
diubah.

| # | Test | Menguji |
|---|---|---|
| B1 | Ada user ber-`password_hash` tapi env hash kosong → `GET /api/tasks` tanpa cookie **401**, bukan 200 | **G1** |
| B2 | `test_auth_disabled_mode` dan `test_cookie_auth_flow` tetap hijau tanpa diubah | mode 1 & 2 regresi |
| B3 | Login user tabel: password benar 200 + cookie; password salah 401 | §4 |
| B4 | User ada di tabel tanpa `password_hash`, bukan `admin_username` → login memakai password admin **ditolak** | §4 urutan `if/elif` |
| B5 | Non-admin `POST /api/users` → 403; admin → 201 | §5 |
| B6 | User baru punya agent + routing rule sendiri; `resolve_targets` untuk user itu tidak kosong dan tidak beririsan dengan milik admin | **G2** + kunci 5a |
| B7 | `GET /api/auth/status` mengembalikan username yang login, bukan `admin_username` | G3 |
| B8 | `GET /api/users` tidak pernah memuat `password_hash` di body | §6 |
| B9 | Hapus admin terakhir ditolak | §6 |

**B1 adalah test terpenting di seluruh 5b.** Ia satu-satunya yang mengunci lubang
yang dokumen ini ciptakan sendiri. Tulis duluan, lihat merah, baru perbaiki.

B6 sekaligus bukti akhir 5a: dua user, dua himpunan target, nol irisan.

---

## 10. Urutan kerja

| # | Kerjaan | File | Sesi |
|---|---|---|---|
| 0 | Tulis B1 (harus merah) | `test_api.py` | 0.1 |
| 1 | Migrasi 004 + kolom di `models.py` | `migrations/`, `models.py` | 0.2 |
| 2 | `auth_disabled()` async + tiga pemanggil (§3) | `security.py`, `api/auth.py`, `main.py` | 0.4 |
| 3 | Login tabel + `CurrentAdmin` + bootstrap admin (§4, §5) | `api/auth.py`, `security.py`, `main.py` | 0.5 |
| 4 | `app/defaults.py` + `scripts/seed.py` jadi pembungkus (§7) | `app/defaults.py`, `scripts/seed.py` | 0.4 |
| 5 | Endpoint user + skema (§6) | `api/users.py`, `schemas.py`, `api/__init__.py` | 0.5 |
| 6 | B2-B9 | `test_api.py` | 0.5 |
| 7 | UI (§8) | `index.html`, `app.js`, `style.css` | 0.5 |

Total ≈ 3,1 sesi.

Item 0 lebih dulu dengan sengaja: G1 adalah satu-satunya temuan yang membuat
keadaan **lebih buruk** daripada sebelum 5b, dan test yang ditulis setelah
perbaikan tidak pernah membuktikan ia benar-benar menangkapnya.

Item 4 sebelum item 5 karena `POST /api/users` memanggil `seed_defaults`.

**Commit:** item 1-3 satu commit (identitas & sesi), item 4-5 satu commit
(pengelolaan user), item 7 satu commit (UI). Item 4 layak terpisah karena ia
memindahkan 29 konstanta — kalau seed berubah perilaku diam-diam, `git bisect`
harus bisa menunjuk ke sana tanpa tercampur perubahan auth.

---

## 11. Jebakan

| Jebakan | Kenapa berbahaya |
|---|---|
| `auth_disabled()` dibiarkan sinkron | G1. Arah gagalnya "dashboard terbuka", bukan "error". |
| `password_hash` NOT NULL | `conftest.py:49-66` membuat user tanpa password; 83 test langsung merah. |
| `UserOut(UserIn)` | Membocorkan `password` ke response. Turunkan skema terpisah. |
| Login tanpa `elif` | User sembarang bisa masuk memakai password admin env. |
| Promosi admin tanpa syarat | "Selalu promosikan `admin_username`" membuat admin yang sengaja diturunkan hidup lagi tiap restart. |
| Migrasi tidak idempoten | `apply_migrations` (`db.py:94-99`) jalan tiap startup **dan** tiap test lewat `conftest.py:42`. Semua wajib `IF NOT EXISTS`. |
| `get_settings` ber-`@lru_cache` (`config.py:36`) | Test yang mengutak-atik env hash wajib `cache_clear()` sebelum **dan** sesudah. Sudah menggigit di Fase 4. |
| `app` mengimpor dari `scripts` | `pyproject.toml:31` hanya memaketkan `app*`; impor itu jalan di dev, mati saat ter-install. |
| Menyembunyikan panel admin di UI dianggap keamanan | Penegakan ada di `CurrentAdmin`. UI hanya kenyamanan. |
| `/api/auth/status` dibuat butuh login | `app.js:855` memanggilnya **sebelum** login. Kalau jadi 401, dashboard tidak pernah bisa boot. |

---

## 12. Yang sengaja tidak dikerjakan di 5b

- **Isolasi credential (`HOME` per-user).** Itu 5c. Kolomnya sudah disiapkan di
  migrasi 004, isinya belum dipakai.
- **Registrasi mandiri, reset password lewat email, 2FA.** Self-hosted, admin
  yang membuat akun.
- **Peran selain admin/user.** Dua sudah cukup sampai ada kebutuhan nyata.
- **Kuota per-user sebagai kebijakan.** `quota_windows` sudah per-user sejak
  Fase 1 dan sudah benar sejak 5a; menambah *batas* yang ditetapkan admin adalah
  fitur lain.
- **Berbagi agent antar user.** Bertentangan dengan PRD §1. Jawabannya tetap
  tidak.

---

## 13. Verifikasi yang mendasari dokumen ini

- G1 disimpulkan dari `security.py:53-55` (satu-satunya sumber `auth_disabled`
  adalah env) dibaca bersama `security.py:65-72` (mode terbuka melewati cek
  cookie dan memakai `settings.admin_username`).
- G2 dikonfirmasi dua arah: `scripts/seed.py:106-112` menyemai hanya untuk
  `settings.admin_username`, dan `resolve_targets` pasca-5a menyaring
  `Agent.user_id` — jadi user kedua menempuh cabang `targets` kosong di
  `runner.py:236-247`.
- G3 dibaca dari `auth.py:16`.
- G4 dikonfirmasi dengan mencari `logout` di seluruh `app/static/`: hanya ada
  definisi endpoint di `auth.py:39`, nol pemanggil di sisi klien.
- G5 dibaca dari `main.py:42-49`.
- Keharusan idempoten migrasi diverifikasi dari `db.py:94-99` (glob seluruh
  `*.sql`, tanpa tabel pencatat versi) disilangkan dengan `conftest.py:42` yang
  memanggilnya pada tiap test.
- Kebutuhan nullable `password_hash` diverifikasi dari `conftest.py:49-66`.
- Arah ketergantungan `app` → `scripts` diperiksa di `pyproject.toml:30-31`.

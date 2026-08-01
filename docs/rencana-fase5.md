# Rencana Fase 5 — mode tim

**Status Fase 4:** tertutup. Tujuh commit di `main`, suite 77 passed, working tree
bersih. Sisa yang belum: verifikasi manual UI §6 `rencana-penutupan-fase4.md`,
fixture `authed_client`, dan 18 temuan gaya ruff. Ketiganya tidak memblokir
dokumen ini.

**Definisi Fase 5 menurut PRD (`PRD-choros-v0.2.md:318`):**

> Auth multi-user + isolasi credential per-user (container) + boundary task⇒agent
> milik user.

---

## 1. Yang berubah dari asumsi dokumen sebelumnya

`catatan-implementasi.md:125-127` menulis:

> semua query sudah tersaring `user_id` dan boundary kepemilikan ditegakkan di
> API, tapi isolasi credential store per-user (container per user) belum ada.

**Kalimat pertama tidak benar.** Boundary ditegakkan di lapisan API, tapi runner
memakai jalur query yang berbeda dan jalur itu tidak menyaring `user_id` sama
sekali. Jadi Fase 5 bukan "tinggal menambah container di atas fondasi yang sudah
benar" — fondasinya sendiri bocor di tiga tempat.

Ini kelas kesalahan paling berbahaya di choros: **UI menampilkan hal yang benar,
tapi eksekusi memakai hal yang salah, tanpa error apa pun.** Persis yang
`PRD-choros-v0.2.md:327` sebut sebagai risiko tertinggi ("Boundary multi-user
paling rawan (pooling). Jaga arsitektural.").

Konsekuensi urutan kerja: **container adalah item terakhir, bukan pertama.**
Memasang isolasi keras di atas routing yang bocor sama dengan memasang gembok di
pintu sementara dindingnya berlubang.

---

## 2. Temuan — lima lubang, dengan bukti

### F1 — routing tidak menyaring pemilik (paling serius)

`routing_rules` **tidak punya kolom `user_id`** (`models.py:50-57`,
`migrations/001_init.sql:25-32`). Kepemilikan rule hanya tersirat lewat
`agent_id`.

`resolve_targets` (`router.py:62-74`) menjoin `RoutingRule → Agent` tapi hanya
memfilter `Agent.is_active`:

```python
stmt = (
    select(RoutingRule, Agent)
    .join(Agent, Agent.id == RoutingRule.agent_id)
    .where(RoutingRule.category == category, Agent.is_active.is_(True))
    .order_by(RoutingRule.priority, RoutingRule.id)
)
```

`runner.py:183` memanggilnya tanpa identitas sama sekali:

```python
targets = await resolve_targets(session, task.category)
```

**Akibat:** dengan dua user aktif, tugas user A dirutekan ke agent user B — yaitu
memakai langganan orang lain. Itu bukan sekadar bug boundary, itu **pooling**,
yang `PRD-choros-v0.2.md:34` daftarkan sebagai non-tujuan eksplisit.

Yang menutupi bug ini selama ini: `GET /api/routing` (`agents.py:64-72`) **sudah**
menjoin dengan `Agent.user_id == user.id`. Jadi dashboard tidak pernah
memperlihatkan rule orang lain, dan tidak ada satu pun test yang menembus jalur
runner-nya.

Dua turunan di file yang sama:

- `resolve_step_targets` (`router.py:92`) memanggil `session.get(Agent, agent_id)`
  tanpa cek pemilik. Ada validasi saat tulis (`workflows.py:46-60`), tapi tidak
  saat jalan. Kalau agent berpindah pemilik atau `targets` JSONB ditulis lewat
  jalur lain, runtime menerimanya.
- `runner.py:222` menaikkan `pinned_agent_id` ke urutan pertama, juga lewat
  `session.get(Agent, ...)` tanpa cek pemilik. Sumbernya memang aman hari ini
  (`tasks.py:153`, diturunkan dari `TaskLog` milik user sendiri), tapi tidak ada
  yang menegakkannya di titik pakai.

### F2 — kuota dicatat atas nama pemilik agent, bukan pemilik tugas

Di dalam `_run_cascade`, cek kuota memakai identitas **pemilik tugas**:

| Baris | Pemakaian |
|---|---|
| `runner.py:363` | `quota.is_exhausted(..., user_id=ctx.user_id, ...)` |
| `runner.py:408` | `self._log_attempt(..., user_id=ctx.user_id, ...)` |

Tapi di dalam `_run_attempt`, pencatatan memakai identitas **pemilik agent**:

| Baris | Pemakaian |
|---|---|
| `runner.py:507` | `quota.mark_exhausted(..., user_id=agent.user_id, ...)` |
| `runner.py:527` | `quota.record_usage(..., user_id=agent.user_id, ...)` |

Single-user: dua nilai itu identik, jadi tidak pernah terlihat. Multi-user:
konsumsi ditulis ke baris `quota_windows` milik user lain, sementara cek kuota
membaca baris milik user sendiri yang selamanya kosong. **Cascade sadar-kuota —
pembeda utama choros (`PRD:16`) — jadi buta.**

Penyebab mekanisnya sederhana: `_run_attempt` (`runner.py:445-455`) tidak
menerima `ctx`, jadi `agent.user_id` dipakai sebagai satu-satunya `user_id` yang
ada di scope.

### F3 — semua subprocess berbagi satu credential store

`base.py:191`:

```python
env = {**os.environ, **self.env_overrides()}
```

Environment server diwariskan apa adanya, termasuk `HOME`. Semua adapter
(`claude`, `agy`, `opencode`) membaca kredensial dari `HOME`. Jadi tugas siapa
pun memakai `~/.claude` dan `~/.gemini` milik operator.

Ini inti "isolasi credential per-user". `docker-compose.yml` yang sekarang
malah memperkuatnya — ia me-mount `${HOME}/.claude` dan `${HOME}/.gemini` ke
`/root` di container tunggal, satu HOME untuk semua.

Catatan penting: ini **tidak** membuat choros menyimpan atau me-replay kredensial
(`security.py:1-5` masih benar). Yang bocor bukan penyimpanannya, melainkan
*pemakaiannya*.

### F4 — auth masih single-admin dari environment

- `config.py:17-18` — `admin_username` + `admin_password_hash`, satu pasang.
- `auth.py:25` — login membandingkan ke satu username itu saja.
- `models.py:24-31` — tabel `users` tidak punya kolom password.
- `security.py:53-55` — tanpa hash, seluruh app jadi mode terbuka.

Kabar baiknya: `get_current_user` (`security.py:74-79`) sudah mencari user
berdasarkan username dari cookie, bukan hardcode. Jadi lapisan sesi **sudah**
multi-user; yang belum ada hanya sumber identitasnya (registrasi + password
per-user).

### F5 — ruang kerja tidak dipisah per user

`isolation_root` (`config.py:22`) satu untuk semua, worktree dinamai
`task-{id}` (`isolation.py:69`). Karena `id` unik global, tidak ada tabrakan —
tapi juga tidak ada batas: semua worktree semua user duduk di satu direktori.
`default_project_path` (`config.py:21`) juga global.

Ini baru jadi masalah nyata saat F3 dijawab dengan container; sampai saat itu ia
konsekuensi dari F3, bukan lubang mandiri.

---

## 3. Keputusan arsitektur — abstraksi `Launcher`

PRD menulis "container per user". Kode yang sekarang menjalankan
`asyncio.create_subprocess_exec` langsung (`base.py:195-203`). Ada tiga cara:

| Opsi | Bentuk | Isolasi | Biaya |
|---|---|---|---|
| **A** | `HOME` per-user di host (`~/.choros/homes/<username>`) | logis, bukan keras — satu UID, bisa dibaca lintas user kalau punya shell | rendah, tanpa Docker |
| **B** | `docker exec` ke container milik user | keras | tinggi — harness harus terpasang di image, login per container |
| **C** | Abstraksi `Launcher`: `LocalLauncher` (= A) default, `DockerLauncher` (= B) opt-in | keduanya | sedang |

**Pilih C.** Alasannya:

1. `build_command()` per-adapter tidak perlu tahu apa-apa. Launcher hanya
   membungkus daftar argumen dan menentukan `env` + `cwd`. Satu titik perubahan
   di `base.py`, nol perubahan di lima adapter.
2. Opsi A sudah menutup F3 secara logis dan bisa dites tanpa Docker sama sekali —
   artinya ada jalur terverifikasi sebelum infra ikut campur.
3. Opsi B tetap terbuka untuk yang memang butuh isolasi keras, tanpa memaksa
   semua orang memasang harness di dalam image (`Dockerfile:22-25` sengaja tidak
   memasangnya, dan alasannya masih benar).

Bentuk kontraknya:

```python
class Launcher(Protocol):
    async def spawn(
        self, cmd: list[str], *, cwd: str | None, env: dict[str, str]
    ) -> asyncio.subprocess.Process: ...
```

`LocalLauncher` memanggil `create_subprocess_exec` seperti sekarang, dengan `env`
yang `HOME`-nya sudah diganti. `DockerLauncher` menyisipkan `docker exec -i
choros-user-<id>` di depan `cmd`.

---

## 4. Fase 5a — tutup boundary (F1, F2)

**Tidak butuh migrasi, tidak butuh infra, seluruhnya bisa dites.** Ini prasyarat
mutlak untuk 5b–5d.

### Patch 1 — `resolve_targets` wajib menerima `user_id`

`router.py:62`. Jadikan keyword-only **tanpa default** — supaya pemanggil yang
lupa gagal saat import/test, bukan diam-diam mengembalikan agent orang lain.

```python
async def resolve_targets(
    session: AsyncSession, category: str, *, user_id: int
) -> list[Target]:
    stmt = (
        select(RoutingRule, Agent)
        .join(Agent, Agent.id == RoutingRule.agent_id)
        .where(
            RoutingRule.category == category,
            Agent.is_active.is_(True),
            Agent.user_id == user_id,
        )
        .order_by(RoutingRule.priority, RoutingRule.id)
    )
```

Menyaring lewat `Agent.user_id` — **bukan** menambah kolom `user_id` ke
`routing_rules`. Dua alasan: nol migrasi, dan kepemilikan tetap punya satu sumber
kebenaran (agent-nya). Ini juga pola yang sudah dipakai `agents.py:64-72`, jadi
API dan runner akhirnya membaca aturan yang sama.

### Patch 2 — `resolve_step_targets` meneruskan dan menegakkan

`router.py:77-97`. Tambah `*, user_id: int`, teruskan ke `resolve_targets`, dan
di baris 92 ganti jadi penolakan eksplisit:

```python
agent = await session.get(Agent, agent_id)
if agent is None or not agent.is_active or agent.user_id != user_id:
    continue
```

### Patch 3 — runner meneruskan identitas tugas

`runner.py:183-184`. `user_id` dibaca **setelah** `resolve_targets` dipakai, jadi
urutannya harus dibalik dulu:

```python
user_id = task.user_id
targets = await resolve_targets(session, task.category, user_id=user_id)
```

`runner.py:212` → `resolve_step_targets(session, step, category, user_id=user_id)`.

`runner.py:222` → tolak pinned agent milik orang lain:

```python
pinned = await session.get(Agent, task.pinned_agent_id)
if pinned is not None and pinned.is_active and pinned.user_id == user_id:
```

### Patch 4 — kuota atas nama pemilik tugas

`_run_attempt` (`runner.py:445`) tambah parameter `user_id: int`. Lalu
`runner.py:507` dan `runner.py:527`: `agent.user_id` → `user_id`. Pemanggil di
`runner.py:396` mengirim `user_id=ctx.user_id`.

Jangan mengambil jalan pintas dengan `ctx` utuh sebagai parameter —
`_run_attempt` sengaja tidak tahu soal cascade, dan menjaga itu memudahkan test.

---

## 5. Fase 5b — auth multi-user (F4)

### Migrasi `004_multiuser.sql`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_home TEXT;
```

Semua nullable — user hasil seed yang sudah ada tetap sah. `credential_home`
dipakai 5c.

### Aturan kompatibilitas mundur (wajib)

Tiga mode, diputuskan **dalam urutan ini**:

1. `admin_password_hash` kosong → `auth_disabled()`, seperti sekarang. Mode lokal
   satu orang. Jangan diubah — ini yang dipakai seluruh test dan pemakaian
   sehari-hari.
2. `admin_password_hash` terisi **dan** tidak ada user ber-`password_hash` →
   perilaku hari ini persis (single admin dari env).
3. Ada user ber-`password_hash` → mode tim. Login mencocokkan ke tabel `users`;
   env admin tetap sah sebagai akun darurat.

Mode 3 tidak boleh mengubah apa pun bagi orang yang tidak memakainya. Kalau
`test_cookie_auth_flow` (`test_api.py:266`) jadi merah, patch-nya yang salah.

### Endpoint

- `POST /api/auth/login` — cocokkan ke `users.password_hash` dulu, jatuh ke env.
- `POST /api/users` — buat user (khusus admin). Bukan registrasi terbuka; choros
  self-hosted, bukan SaaS.
- `GET /api/auth/status` — tambahkan `username` user yang sedang login, bukan
  `settings.admin_username` (`auth.py:16` sekarang salah untuk mode tim).

---

## 6. Fase 5c — credential home per-user (F3, `LocalLauncher`)

1. `Launcher` protocol + `LocalLauncher` di `app/adapters/launcher.py`.
2. `base.py:164` — `run()` menerima `launcher: Launcher | None` dan `home: str |
   None`; `base.py:191` jadi `env = {**os.environ, **home_env, **self.env_overrides()}`
   dengan `home_env = {"HOME": home, "USERPROFILE": home}` kalau `home` diisi.
   `USERPROFILE` wajib ikut — pengembangan berjalan di Windows.
3. `users.credential_home` default `~/.choros/homes/<username>`; dibuat saat user
   dibuat, bukan saat run.
4. `build_adapter` (`runner.py`) meneruskan home milik pemilik tugas.
5. UI: halaman yang memberitahu user **cara** login harness ke home miliknya —
   `HOME=<path> claude login`. choros tidak menjalankan login itu untuk mereka,
   dan tidak menyentuh isinya. Batas ini yang menjaga `security.py:1-5` tetap
   jujur.

**Konsekuensi yang harus ditulis di UI:** tiap user memakai langganannya sendiri
dan login sendiri. Kalau dua user diarahkan ke home yang sama, itu pooling —
dan choros tidak melarangnya secara teknis, tapi dokumen dan UI harus menyebutnya
terlarang.

---

## 7. Fase 5d — container (opsional, `DockerLauncher`)

Hanya kalau isolasi keras memang dibutuhkan. `DockerLauncher` membungkus `cmd`
jadi `docker exec -i choros-user-<id> <cmd>`, plus:

- image yang memasang harness (kebalikan `Dockerfile:22-25` — sengaja, untuk
  jalur ini saja),
- satu container long-running per user, volume credential per user,
- `isolation_root` per user, mount ke container yang sama (F5),
- `cancel()` (`base.py:153-160`) harus membunuh proses **di dalam** container,
  bukan proses `docker exec` di host — `docker exec` yang mati meninggalkan
  proses anak hidup.

Item terakhir itu jebakan sungguhan, bukan detail. Tanpa itu, tombol Batal
berbohong.

---

## 8. Test yang harus ditambahkan

Tidak ada test lama yang boleh diubah.

| # | Test | File | Menguji |
|---|---|---|---|
| T1 | `resolve_targets` user A tidak mengembalikan agent user B walau kategori sama | `tests/test_quality_and_routing.py` | F1 |
| T2 | Task user A dengan rule user B saja → `targets` kosong → status `halted`, agent user B **tidak pernah dijalankan** | `tests/test_cascade.py` | F1 end-to-end |
| T3 | `resolve_step_targets` membuang entri `targets` JSONB milik agent user lain | `tests/test_quality_and_routing.py` | F1 turunan |
| T4 | `pinned_agent_id` milik user lain tidak dinaikkan ke urutan pertama | `tests/test_cascade.py` | F1 turunan |
| T5 | Setelah attempt rate-limited, baris `quota_windows` ber-`user_id` = pemilik **tugas** | `tests/test_cascade.py` | F2 |
| T6 | `record_usage` mencatat ke `user_id` pemilik tugas, bukan pemilik agent | `tests/test_cascade.py` | F2 |
| T7 | Mode 1 & 2 auth tidak berubah perilakunya setelah migrasi 004 | `tests/test_api.py` | F4 regresi |
| T8 | Login user tabel berhasil; user tanpa `password_hash` ditolak | `tests/test_api.py` | F4 |
| T9 | Dua user, dua `credential_home` → dua `env["HOME"]` berbeda di subprocess | `tests/test_adapters.py` (baru) | F3 |

T2 dan T5 yang paling penting: keduanya menguji kesalahan yang tidak melempar
exception. T2 khususnya — satu-satunya cara membuktikan pooling benar-benar
tertutup, bukan cuma tersembunyi dari UI.

---

## 9. Urutan kerja

| # | Kerjaan | File | Sesi |
|---|---|---|---|
| 1 | Patch 1-4 (§4) | `router.py`, `runner.py` | 0.5 |
| 2 | T1-T6 | `test_quality_and_routing.py`, `test_cascade.py` | 0.5 |
| 3 | Migrasi 004 + model + mode auth (§5) | `migrations/`, `models.py`, `security.py`, `api/auth.py` | 0.75 |
| 4 | T7-T8 | `test_api.py` | 0.25 |
| 5 | `Launcher` + `LocalLauncher` + `credential_home` (§6) | `adapters/launcher.py`, `base.py`, `runner.py` | 0.75 |
| 6 | T9 + UI panduan login harness | `tests/`, `app/static/` | 0.5 |
| 7 | `DockerLauncher` (§7) | opsional | 1+ |

Total ≈ 3,25 sesi tanpa item 7.

**Item 1 dan 2 harus satu commit terpisah dari sisanya.** Keduanya memperbaiki
bug yang ada di `main` hari ini, berlaku untuk pemakaian single-user juga, dan
kalau nanti ada regresi kuota, `git bisect` harus bisa menunjuk ke sana tanpa
tercampur perubahan auth.

---

## 10. Jebakan yang sudah diketahui

| Jebakan | Kenapa berbahaya |
|---|---|
| `resolve_targets` dengan `user_id` ber-default | Pemanggil yang lupa akan diam-diam mengembalikan agent siapa saja. Wajib keyword-only tanpa default. |
| `user_id` dibaca setelah dipakai (`runner.py:183-184`) | Urutan sekarang membuat patch naif jadi `NameError` — atau lebih buruk, seseorang menambah `task.user_id` inline dan melewatkan `resolve_step_targets`. |
| `_run_attempt` tidak punya `ctx` | Itu sengaja. Tambah parameter `user_id`, jangan oper `ctx`. |
| `auth_disabled()` harus tetap jalan | Seluruh 77 test bergantung padanya. Mode tim adalah lapisan ketiga, bukan pengganti. |
| `get_settings` ber-`@lru_cache` (`config.py:36`) | Test auth wajib `cache_clear()` sebelum dan sesudah. Sudah menggigit sekali di Fase 4. |
| `USERPROFILE` di Windows | Menyetel `HOME` saja tidak cukup; pengembangan berjalan di Windows dan sebagian tool membaca `USERPROFILE`. |
| `docker exec` + `cancel()` | Membunuh `docker exec` tidak membunuh proses di dalam container. |
| Dua user diarahkan ke satu `credential_home` | Itu pooling. Tidak bisa dicegah kode; harus dilarang di dokumen dan UI. |

---

## 11. Yang sengaja tidak dikerjakan

- **Registrasi terbuka.** choros self-hosted. User dibuat admin.
- **Role/permission berbutir halus.** Dua peran (admin, user) sudah cukup.
  Tambahkan hanya kalau ada kebutuhan nyata.
- **Berbagi agent antar user.** Bertentangan langsung dengan `PRD:34`. Kalau
  suatu saat diminta, jawabannya tetap tidak.
- **`DockerLauncher` sebagai default.** Sebagian besar pemakaian choros adalah
  satu orang di satu mesin; `deploy/choros.service` tetap jalur utama.
- **Migrasi `routing_rules.user_id`.** Kepemilikan sudah terwakili lewat
  `agent_id`; menduplikasinya membuka kemungkinan dua sumber kebenaran tidak
  sinkron.

---

## 12. Verifikasi yang mendasari dokumen ini

- F1 dikonfirmasi tiga arah: tidak ada `user_id` di `models.py:50-57`, tidak ada
  di `migrations/001_init.sql:25-32`, dan tidak ada filter pemilik di klausa
  `where` `router.py:67`. Pemanggilnya (`runner.py:183`) memang tidak mengirim
  identitas apa pun.
- Kontras F1 diperiksa terhadap `agents.py:64-72`, yang **sudah** menjoin
  `Agent.user_id` — membuktikan polanya sudah ada di repo, hanya tidak dipakai di
  runner.
- F2 dikonfirmasi dengan membandingkan empat titik pemanggilan kuota:
  `runner.py:363` dan `408` memakai `ctx.user_id`, `runner.py:507` dan `527`
  memakai `agent.user_id`. Tanda tangan `_run_attempt` (`runner.py:445-455`)
  diperiksa untuk memastikan `ctx` memang tidak ada di scope.
- F3 dibaca langsung dari `base.py:191` dan disilangkan dengan
  `docker-compose.yml` yang me-mount satu HOME untuk seluruh service.
- F4 dibaca dari `config.py:17-18`, `auth.py:25`, dan `models.py:24-31`;
  `security.py:74-79` diperiksa untuk memastikan lapisan sesi sudah siap
  multi-user.
- Cakupan test yang ada diperiksa dengan mencari `resolve_targets` di `tests/` —
  nol hasil. Tidak ada satu pun test yang menembus jalur routing runner, yang
  menjelaskan kenapa F1 bertahan lima fase.

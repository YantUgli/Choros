# Rencana penutupan Fase 3.5b

Ditulis 1 Agustus 2026, dari pembacaan working tree di atas commit `3e163ab`
setelah enam item Fase 3.5b dikerjakan, plus satu kali menjalankan suite penuh.

Dokumen ini melanjutkan [rencana-penutupan-fase35.md](rencana-penutupan-fase35.md):
yang itu menetapkan *enam kerjaan pemulihan Fase 3.5b*, yang ini mencatat *mana
yang benar-benar tuntas, mana yang berhenti di tengah, dan apa syarat minimum
sebelum Fase 3.5 boleh di-commit sebagai selesai*.

Kesimpulan singkatnya: blocker cascade sudah mati, suite sudah jujur, dan empat
dari enam item tuntas. Sisanya empat kerjaan kecil — tapi salah satunya adalah
test hijau yang tidak menguji apa pun, tepat di klaim yang jadi prasyarat Fase 5.

> **Lanjutan:** Fase 3.5c (§4) sudah dikerjakan dan Fase 3.5 boleh di-commit;
> Fase 3.6 baru item 6-7 yang tuntas. Rencana Fase 4 ada di
> [rencana-fase4.md](rencana-fase4.md).

---

## 1. Yang sudah beres — dan kenapa angka di dokumen ini bisa dipercaya

Berbeda dari dokumen sebelumnya, verifikasi kali ini tidak perlu argumen: suite
dijalankan tanpa env override apa pun dan hasilnya

```
62 passed in 181.28s (0:03:01)
```

Nol skip. Ini konsekuensi langsung dari item 2 — `tests/conftest.py:38` sekarang
hanya skip kalau `CHOROS_SKIP_DB_TESTS=1` diset eksplisit, dan `apply_migrations()`
dibiarkan meledak kalau DB tak terjangkau. Mode kegagalan yang paling mungkin
sehari-hari akhirnya berwarna merah.

| # | Kerjaan | Status | Catatan |
|---|---|---|---|
| 1 | Kembalikan payload dict di `_emit` | ✅ | `runner.py:433` kembali ke `bus.publish(task_id, {"seq": seq, **event.as_dict()})`. Sepuluh skenario cascade hidup lagi. |
| 2 | Port DB test 5433 + persempit skip | ✅ | `conftest.py:8`, `.env.example:3`. Lihat di atas. |
| 3 | Tutup lubang replay batching | ✅ | Lihat §1.1. |
| 4 | GC worktree + `cleanup_workspace` | ⚠️ | Separuh. Lihat §2.1. |
| 5 | `seed.py --reconcile` | ✅ | Memperbarui `priority` rule lama **dan** `default_model`/`config` agent lama. Sebelas rung Zen akhirnya aktif di instance yang sudah ter-seed. |
| 6 | Posisi antrean terlihat | ⚠️ | Ada, tapi angkanya salah. Lihat §2.2. |

### 1.1 Item 3 diselesaikan lewat jalur yang lebih rapat dari rencana

Rencana §4.1 menawarkan dua opsi: task latar yang flush tiap 500 ms, atau
`load_task_events()` menggabungkan buffer in-memory. Yang dipilih opsi kedua
(`runner.py:557-571`), dan itu pilihan yang lebih baik — bukan sekadar setara.

Opsi flush-berkala tetap menyisakan jendela hingga 500 ms di mana event ada di
memori tapi belum di DB. Penggabungan saat replay tidak menyisakan jendela sama
sekali: sumber kebenarannya adalah gabungan DB + buffer, apa pun waktunya.
`_flush_events` juga dipanggil di blok `finally` `_guarded` (`runner.py:144`),
jadi crash orchestrator tidak meninggalkan event menggantung di memori.

Tidak ada sisa kerjaan di item ini.

### 1.2 Item 4 (rencana lama) tetap bersih

Pemisahan cooldown/window konsumsi lewat `window_type='cooldown'` bertahan tanpa
migrasi `002_*.sql`, dan `tests/test_cascade.py` sudah disesuaikan untuk
memilih window secara eksplisit alih-alih mengasumsikan cuma ada satu baris.

---

## 2. Sisa kerjaan

### 2.1 `cleanup_workspace()` masih in-degree 0

`gc_old_worktrees()` sudah dipanggil dari `lifespan` (`app/main.py:33`) dan
fungsinya sudah dirapikan sesuai permintaan — `import time` naik ke atas file,
`now_ts` yang mati sudah hilang. Itu setengah item 4.

Setengah yang lain belum: `cleanup_workspace()` (`isolation.py:96`) masih hanya
punya definisi, nol pemanggil di seluruh repo. Ini **persis penyakit yang sama**
yang dikeluhkan rencana §2.1(b) dan diulang lagi di §4.2 — dua dokumen berturut-
turut mencatatnya, dan fungsinya masih menganggur.

Perlu diakui bahwa dampaknya lebih kecil dari kelihatannya: `gc_old_worktrees()`
sudah menutup keluhan utama ("worktree menumpuk tanpa batas") untuk direktori
yang lebih tua dari 7 hari. Yang belum tertutup adalah kasus yang lebih spesifik
dan lebih sering: tugas **non-otonom** yang tetap membuat `Workspace`
(`runner.py:203`) lalu selesai tanpa ada yang melepasnya. Worktree itu tidak
punya alasan untuk hidup — tidak ada yang perlu direview — tapi tetap menunggu
tujuh hari sebelum GC menyentuhnya.

Perbaikannya: panggil `cleanup_workspace(project_path, workspace, remove=True)`
di jalur non-otonom setelah `_execute` selesai. Perhatikan `remove=True` — default
`remove=False` memang disengaja supaya hasil mode otonom bisa direview, dan itu
harus tetap begitu. Yang berubah hanya jalur non-otonom.

Karena `workspace` adalah variabel lokal di `_execute` sementara `_finish` bisa
dipanggil dari beberapa titik, cara paling tidak berisiko adalah `try/finally` di
dalam `_execute` sendiri, bukan menambah parameter ke `_finish`.

**File:** `app/orchestrator/runner.py` (sekitar 201-220 dan akhir `_execute`).

### 2.2 Posisi antrean salah hitung satu

`runner.py:118`:

```python
queue_pos = max(1, len(self._running) - max_tasks + 1)
```

`start()` (`runner.py:78`) memasukkan tugas ke `self._running` **sebelum**
`_guarded` mulai jalan, jadi tugas yang sedang menghitung posisinya ikut
tercacah. Dengan `max_concurrent_tasks=3` dan tiga tugas sedang mengeksekusi,
tugas keempat — yang berada paling depan di antrean — melaporkan dirinya
**#2**.

Yang benar `len(self._running) - max_tasks`. `max(1, ...)` boleh tetap ada
sebagai jaring pengaman.

Ada kekurangan kedua yang lebih layak dibahas daripada langsung dikerjakan:
angka itu dipancarkan **sekali**, saat tugas masuk antrean, dan tidak pernah
diperbarui saat antrean menyusut. User melihat "posisi #3" sampai tugasnya benar-
benar jalan. Memperbaikinya berarti memancarkan ulang event `status` setiap kali
ada tugas selesai — biayanya tidak besar, tapi menambah lalu lintas event untuk
informasi yang cuma kosmetik.

**Rekomendasi:** perbaiki off-by-one-nya saja sekarang (satu baris), dan tunda
pembaruan dinamis. Kalau memang mau ditutup penuh, cara termurah adalah
memancarkan ulang posisi dari `finally` di `_guarded` untuk semua tugas yang
masih menunggu, bukan membangun mekanisme notifikasi terpisah.

**File:** `app/orchestrator/runner.py:118`.

### 2.3 `Any` dipakai tanpa diimpor di `isolation.py`

`isolation.py:106` menulis `-> dict[str, Any]`, tapi `Any` tidak pernah diimpor
di file itu (impornya berhenti di `asyncio`, `shutil`, `time`, `dataclass`,
`Path`, `get_settings`).

Ini tidak meledak saat ini **hanya** karena `from __future__ import annotations`
di baris 11 membuat semua anotasi jadi string yang tidak pernah dievaluasi. Yang
akan menemukannya: `ruff` (F821), dan `typing.get_type_hints()` kalau suatu saat
ada yang memanggilnya di fungsi itu — misalnya generator skema.

Satu baris: `from typing import Any`.

Catatan terpisah, di luar cakupan: `ruff` tidak terpasang di `.venv` sekarang
(`No module named ruff`), padahal kelas kesalahan seperti ini persis yang
ditangkapnya. Layak dipasang sebelum Fase 4 menambah permukaan kode.

**File:** `app/orchestrator/isolation.py`.

### 2.4 `seed.py`: `import argparse` di tengah file

`scripts/seed.py` meletakkan `import argparse` tepat sebelum `async def main`,
bukan di blok impor atas. Berfungsi, tapi ini jenis hal yang sama yang sudah
dirapikan di `gc_old_worktrees` (`import time` yang tadinya di badan fungsi).
Konsisten saja sekalian.

**File:** `scripts/seed.py`.

---

## 3. Fase 3.6 — satu dari tiga fokus teruji

`tests/test_api.py` sudah ada, tiga test, semuanya hijau. Tapi hijau di sini
bukan bukti.

| Fokus (rencana §3) | Status | Bukti |
|---|---|---|
| 1. Boundary kepemilikan | ❌ tidak teruji | Lihat §3.1 |
| 2. Login/cookie termasuk `auth_disabled` | ⚠️ separuh | Jalur `auth_disabled` tertutup (`test_api.py:15`). Jalur login berpassword nol. |
| 3. SSE replay + dedup `seq` | ⚠️ dangkal | Lihat §3.2 |

### 3.1 Test boundary kepemilikan tidak menguji boundary

`test_user_boundary_ownership` (`test_api.py:24-41`) membuat `user_b`
(baris 27-30), lalu **tidak pernah memakainya**. Satu-satunya assertion-nya
adalah bahwa user A bisa melihat task miliknya sendiri. Kasus yang jadi seluruh
alasan test ini ada — user B meminta task user A dan harus dapat 404, bukan 403 —
tidak pernah dijalankan.

Ini lebih buruk daripada tidak ada test sama sekali. Namanya menjanjikan sesuatu
yang tidak ia buktikan, dan `_owned_task` adalah klaim keamanan utama untuk Fase
5 — yang oleh dua dokumen sebelumnya sudah ditetapkan sebagai prasyarat.

**Kenapa ini tidak sepele, dan kenapa test-nya berhenti setengah jalan:** dalam
mode `auth_disabled` (yang aktif di test, karena `conftest.py` tidak menyetel
`CHOROS_ADMIN_PASSWORD_HASH`), `get_current_user` (`app/security.py:60-64`)
mengabaikan cookie sepenuhnya dan selalu me-resolve ke
`settings.admin_username` = `"tester"`. Jadi lewat HTTP polos, **tidak ada cara
menjadi user B.** Membuat baris `user_b` di DB tidak mengubah siapa yang dilihat
request.

Dua jalan keluar, dan keduanya sah:

- **`app.dependency_overrides[get_current_user]`** — paling langsung, mengisolasi
  yang sedang diuji (boundary), dan tidak menyentuh konfigurasi global. Ingat
  membersihkannya di `finally` agar tidak bocor ke test lain.
- **Setel `admin_password_hash` + terbitkan cookie asli lewat
  `issue_cookie("user_b")`** — lebih berat, tapi menutup fokus #1 dan #2 sekaligus
  karena ia melewati jalur autentikasi sungguhan.

**Rekomendasi:** pakai yang kedua, dan jadikan satu fixture. Ongkos tambahannya
kecil dibanding menulis dua test terpisah, dan fokus #2 memang harus ditutup
juga. Satu jebakan yang harus disebut: `get_settings` ber-`@lru_cache`
(`app/config.py:36`), jadi mengubah env di tengah test tidak berefek tanpa
`get_settings.cache_clear()`.

Cakupan yang dituju, sekali fixture-nya ada:

- `GET /api/tasks/{id}` milik user lain → 404.
- `POST /api/tasks/{id}/cancel`, `/merge`, `/discard`, `GET /diff`, `/logs` →
  404. Semuanya lewat `_owned_task`, tapi lima endpoint terakhir baru ditambahkan
  di Fase 3.5 dan belum pernah disentuh test mana pun.
- `GET /api/tasks` milik user lain tidak bocor lewat daftar.
- `_owned_agent` / `_owned_rule` di `app/api/agents.py` — pola yang sama.

### 3.2 Test SSE tidak menyentuh dedup `seq`

`test_sse_stream_replay` (`test_api.py:45-57`) memeriksa status 200,
`content-type`, dan keberadaan string `"data:"`. Tidak satu pun menyentuh logika
yang sebenarnya berliku.

Yang belum diuji ada di `app/api/tasks.py:193-195`:

```python
if (item.get("seq") or 0) <= last_seq:
    continue  # sudah terkirim lewat replay
last_seq = item.get("seq") or last_seq
```

Dokumen sebelumnya (§5) menaikkan ini ke prioritas pertama dengan alasan yang
masih berlaku: jalur inilah yang baru saja rusak total tanpa ada satu test pun
yang menyadarinya, dan `item.get(...)` adalah kontrak dict yang tidak dijamin
apa-apa selain kebiasaan.

Yang perlu diuji, tiga hal:

1. Replay mengirim event yang sudah ada di `task_events`.
2. Event live dengan `seq` yang sudah pernah terkirim lewat replay **tidak**
   dikirim ulang.
3. Event live dengan `seq` lebih besar tetap lolos.

Nomor 2 adalah intinya, dan cara paling murah mencapainya: simpan beberapa
`TaskEvent` ke DB, buka stream, lalu `bus.publish()` manual dengan campuran `seq`
lama dan baru.

Bonus yang nyaris gratis di test yang sama: buffer in-memory dari §1.1 ikut
tergabung di replay, jadi test yang sama bisa sekalian mengunci perilaku
`load_task_events` yang baru — yang sekarang juga belum diuji.

---

## 4. Urutan kerja

**Fase 3.5c — rapikan dan tutup. Perkiraan setengah sesi.**

| # | Kerjaan | File |
|---|---|---|
| 1 | `from typing import Any` | `app/orchestrator/isolation.py` |
| 2 | Perbaiki off-by-one posisi antrean | `app/orchestrator/runner.py:118` |
| 3 | Panggil `cleanup_workspace(..., remove=True)` di jalur non-otonom | `app/orchestrator/runner.py` |
| 4 | `import argparse` naik ke blok impor | `scripts/seed.py` |

Item 1, 2, 4 masing-masing satu baris. Item 3 perlu sedikit pertimbangan
penempatan (§2.1) tapi tetap kecil.

Setelah ini Fase 3.5 boleh di-commit sebagai selesai.

**Fase 3.6 — uji lapisan API. Perkiraan 1 sesi.**

| # | Kerjaan | File |
|---|---|---|
| 5 | Fixture user-kedua ber-cookie asli (menutup fokus #1 + #2) | `tests/conftest.py` |
| 6 | Test boundary 404 untuk `_owned_task` di enam endpoint | `tests/test_api.py` |
| 7 | Test boundary untuk `_owned_agent` / `_owned_rule` | `tests/test_api.py` |
| 8 | Test dedup `seq`: replay → publish seq lama → tidak terkirim ulang | `tests/test_api.py` |

Item 5 adalah prasyarat 6 dan 7 — kerjakan lebih dulu. Item 8 berdiri sendiri dan
boleh dikerjakan kapan saja.

Prasyarat Fase 5 tetap berlaku dan sekarang lebih tajam: **jangan sentuh mode tim
sebelum item 5-7 selesai.** Yang berubah sejak dokumen sebelumnya bukan tingkat
risikonya, melainkan bahwa sekarang ada test bernama `test_user_boundary_ownership`
yang bisa membuat orang mengira prasyarat itu sudah terpenuhi.

**Fase 4 — workflow plan→execute.** Tidak berubah. Refactor `_execute` menjadi
`_run_cascade(targets, prompt, floor) -> Attempt` tetap prasyaratnya. Catatan
tambahan: item 3 di atas menyentuh akhir `_execute`, jadi kerjakan sebelum
refactor itu dimulai supaya tidak bertabrakan.

---

## 5. Yang dikerjakan di luar rencana, dan layak dipertahankan

Working tree yang sama menambahkan dukungan **OpenCode Zen** — sudah dicatat di
dokumen sebelumnya §3, tapi ada satu hal baru yang pantas disebut: dua pola tier
di `app/orchestrator/quality.py` sekarang punya test yang mengunci **alasan**
urutannya, bukan cuma hasilnya.

`test_zen_names_containing_mini_are_not_demoted`
(`tests/test_quality_and_routing.py`) memastikan `minimax-*` dan
`north-mini-code-*` tidak tertangkap pola generik `mini` di `TIER_LIGHT`. Tanpa
itu, seluruh rung Zen akan tersaring habis oleh `quality_floor` `strong`/`mid` dan
rutenya mati diam-diam — kegagalan yang tidak memunculkan error apa pun, cuma
cascade yang melewati target tanpa sebab yang terlihat.

Ini pola yang benar dan layak ditiru di tempat lain: kalau urutan sebuah daftar
punya alasan, alasannya masuk ke test, bukan cuma ke komentar.

---

## 6. Verifikasi yang mendasari dokumen ini

- Suite dijalankan sekali, tanpa env override: `62 passed in 181.28s`, nol skip.
  Bandingkan dengan dokumen sebelumnya (`59 skipped`, lalu `10 failed, 49 passed`).
- In-degree `cleanup_workspace` dan `gc_old_worktrees` diperiksa lagi dengan
  pencarian seluruh repo: `gc_old_worktrees` kini punya satu pemanggil
  (`app/main.py:33`), `cleanup_workspace` tetap nol.
- Off-by-one §2.2 ditelusuri dari `start()` (`runner.py:74-78`) ke `_guarded`
  (`runner.py:112-120`), bukan disimpulkan dari membaca rumusnya saja.
- `Any` yang tidak terimpor dikonfirmasi dengan membaca blok impor
  `isolation.py:11-19` dan mencari `Any` di seluruh file — satu kecocokan, di
  anotasi baris 106.
- Klaim §3.1 bahwa `user_b` tidak terpakai diverifikasi dengan membaca seluruh
  badan test, dan sebabnya ditelusuri ke `get_current_user`
  (`app/security.py:60-64`) yang mengabaikan cookie dalam mode `auth_disabled`.
- `ruff` dipastikan tidak terpasang di `.venv` (`No module named ruff`).

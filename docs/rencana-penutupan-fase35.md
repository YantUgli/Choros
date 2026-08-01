# Rencana penutupan Fase 3.5

Ditulis 1 Agustus 2026, dari pembacaan working tree di atas commit `3e163ab`
(Fase 3.5 sudah dikerjakan tapi **belum di-commit**) plus satu kali menjalankan
suite dengan database yang benar.

Dokumen ini melanjutkan [rencana-pengembangan.md](rencana-pengembangan.md): yang
itu menetapkan *apa yang harus dikerjakan di Fase 3.5*, yang ini mencatat *apa
yang sudah jadi, apa yang rusak dalam prosesnya, dan apa yang tersisa sebelum
Fase 3.5 boleh dinyatakan selesai*.

Kesimpulan singkatnya: enam item Fase 3.5 sudah dikerjakan semua, tapi ada satu
regresi yang mematikan seluruh mesin cascade, dan test suite dalam kondisi tidak
bisa menangkapnya.

> **Lanjutan:** enam item Fase 3.5b di §6 sudah dikerjakan — blocker §1 mati dan
> suite sekarang `62 passed`, nol skip. Status per item dan sisa kerjaannya ada di
> [rencana-penutupan-fase35b.md](rencana-penutupan-fase35b.md).

---

## 1. Blocker — cascade engine mati total

`app/orchestrator/runner.py:431` memanggil:

```python
bus.publish(task_id, event, seq=seq)
```

`TaskBus.publish()` (`app/orchestrator/bus.py:30`) hanya menerima
`(task_id, payload)`. Tidak ada parameter `seq`, dan tidak pernah ada.

Karena `_emit()` dipanggil di hampir setiap langkah runner, **setiap tugas gagal
di event pertama**:

```
10 failed, 49 passed in 188.22s
FAILED tests/test_cascade.py  — kesepuluhnya, satu akar:
  TypeError: TaskBus.publish() got an unexpected keyword argument 'seq'
```

Yang gagal persis sepuluh skenario cascade — inti produk ini.

### Dampak kedua yang belum muncul di test

Perubahan itu juga mengganti **bentuk** payload: dulu dict
(`{"seq": seq, **event.as_dict()}`), sekarang objek `Event` mentah. Konsumer SSE
di `app/api/tasks.py:191` memanggil `item.get("seq")` untuk dedup replay.

Jadi memperbaiki signature `TaskBus.publish` saja **tidak cukup** — live console
akan pecah dengan `AttributeError` begitu ada event masuk. Perbaikan yang benar
ada di runner, mengembalikan kontrak dict yang sudah dipegang bus dan SSE:

```python
bus.publish(task_id, {"seq": seq, **event.as_dict()})
```

Satu baris. Kerjakan ini duluan; tidak ada item lain di dokumen ini yang bisa
diverifikasi sebelum ini beres.

---

## 2. Kenapa ini lolos — test suite skip diam-diam

`tests/conftest.py:7` default ke port **5432**. Container `choros-db-1`
memetakan Postgres ke **5433** (`.env` sudah 5433; `.env.example` masih 5432).

Akibatnya `pytest` polos melaporkan:

```
59 skipped in 245.82s
```

Nol test benar-benar jalan, dan laporannya tidak merah. Fixture `clean_db`
sengaja menangkap `OperationalError`/`InterfaceError`/`OSError` lalu `pytest.skip`
— komentarnya menyebut ini agar "error lain harus gagal terang-terangan". Niatnya
benar, tapi hasilnya: satu-satunya kegagalan yang paling mungkin terjadi
sehari-hari (DB tidak terjangkau di port yang diharapkan) justru jadi yang
tersamar.

Ini bukan sekadar salah konfigurasi. Selama suite bisa "hijau" tanpa menjalankan
apa pun, tidak ada satu pun angka di dokumen ini yang bisa dipercaya.

**Perbaikan:** samakan default `conftest.py` dan `.env.example` ke 5433, lalu
persempit skip — hanya skip kalau DB benar-benar tidak dikonfigurasi (mis. env
var kosong), dan gagal terang-terangan kalau URL ada tapi koneksinya ditolak.

---

## 3. Status enam item Fase 3.5

| # | Item | Status | Catatan |
|---|---|---|---|
| 1 | Recovery saat startup | ✅ sebagian | `recover_interrupted_tasks()` + hook `lifespan`. Tugas hanging ditandai `interrupted` dan dicatat sebagai `TaskEvent`. **Belum** menawarkan resume dari `last_session_id` seperti di rencana. |
| 2 | Siklus hidup worktree | ✅ | `GET /diff`, `POST /merge`, `POST /discard`, ketiganya lewat `_owned_task`. Panel review UI lengkap (lihat diff / merge / buang). |
| 3 | Semaphore konkurensi | ⚠️ | `max_concurrent_tasks: 3` jalan, tapi tugas menunggu hanya dapat pesan generik `"menunggu antrean konkurensi..."`. Posisi antrean tidak terlihat — padahal itu poin item ini. |
| 4 | Pisah cooldown dari window konsumsi | ✅ | Dipisah lewat `window_type='cooldown'` + `_get_cooldown_window()`/`_get_token_window()`. **Lebih baik dari rencana** — tidak perlu migrasi `002_*.sql` sama sekali, dan konflasi yang dikeluhkan di rencana §2.2 hilang seluruhnya. |
| 5 | Batch penulisan `task_events` | ⚠️ | Ada, tapi memperkenalkan lubang baru. Lihat §4.1. |
| 6 | Panel percobaan cascade di UI | ✅ | `loadTaskLogs()` + tabel agent/model/status/token. Endpoint `/logs` akhirnya terpakai. |

Di luar rencana, working tree yang sama juga menambahkan dukungan **OpenCode
Zen**: agent baru di `seed.py`, ~11 rung routing, dan dua pola tier di
`quality.py` (dengan urutan pola yang sudah benar — `minimax-*` dan
`north-mini-code-*` tidak salah turun ke `TIER_LIGHT`).

---

## 4. Sisa kerjaan sebelum Fase 3.5 ditutup

### 4.1 Batching event membolongi replay SSE

`_flush_events` dipanggil saat buffer mencapai 20 event atau saat tugas selesai.
Tidak ada flush berbasis waktu — rencana menyebut "~50 event / **500 ms**", dan
bagian waktunya hilang.

Konsekuensinya: kalau browser reconnect di tengah run, sampai 19 event ada di
memori tapi belum di DB. `load_task_events()` tidak melihatnya, dan stream live
hanya mengirim event **setelah** titik itu. Console bolong tanpa jejak.

Ini regresi terhadap tujuan asli `task_events` di
[catatan-implementasi §1.2](catatan-implementasi.md): "supaya console bisa
di-replay setelah browser ditutup atau server restart."

Dua perbaikan yang sama-sama sah — pilih satu:

- task latar yang mem-flush tiap 500 ms, atau
- `load_task_events()` menggabungkan buffer in-memory milik runner saat replay.

### 4.2 `gc_old_worktrees()` tidak pernah dipanggil

In-degree 0. Ini **persis penyakit yang dikeluhkan rencana §2.1(b)** tentang
`cleanup_workspace()` — dan `cleanup_workspace()` sendiri masih tidak dipanggil
dari mana pun. Jadi masalah "worktree menumpuk tanpa batas" belum benar-benar
selesai; yang selesai baru bagian review/merge/discard manualnya.

Panggil `gc_old_worktrees()` dari `lifespan`, dan `cleanup_workspace()` dari
jalur non-otonom.

Fungsinya juga perlu dirapikan: `now_ts = Path(root).stat().st_mtime` tidak
terpakai, dan `import time` ada di tengah badan fungsi.

### 4.3 `scripts/seed.py --reconcile` belum ada

Rencana §2.4 memintanya, dan komentar di `seed.py` sendiri mengakui belum ada:
seed idempoten hanya menyisipkan rule yang belum ada, tidak memperbarui
`priority` rule lama.

Artinya untuk database yang **sudah** ter-seed, sebelas rung OpenCode Zen yang
baru ditambahkan tidak akan menempati posisi priority yang dimaksudkan. Fitur
yang baru saja dibangun praktis tidak aktif di instance yang sudah jalan.

---

## 5. Fase 3.6 — belum tersentuh

`tests/test_fase35.py` berisi tiga test (recovery, pemisahan quota, siklus hidup
worktree). Ketiganya bagus dan menguji hal yang benar, tapi **tidak satu pun
menyentuh HTTP**.

Ketiga fokus yang ditetapkan rencana §3 masih nol:

1. Boundary kepemilikan (`_owned_task` / `_owned_agent` / `_owned_rule`).
2. Alur login/cookie termasuk jalur `auth_disabled`.
3. SSE replay + dedup `seq`.

Nomor 3 sekarang naik prioritas: §1 menunjukkan jalur itu baru saja rusak tanpa
ada yang menangkap, dan §4.1 menunjukkan ia masih punya lubang lain.

Prasyarat Fase 5 ini tetap berlaku — jangan sentuh mode tim sebelum §5 ini
selesai.

---

## 6. Urutan kerja

**Fase 3.5b — pulihkan dan tutup. Perkiraan 1 sesi.**

| # | Kerjaan | File |
|---|---|---|
| 1 | Kembalikan payload dict di `_emit` | `app/orchestrator/runner.py` |
| 2 | Samakan port DB test ke 5433; persempit kondisi skip | `tests/conftest.py`, `.env.example` |
| 3 | Tutup lubang replay batching (§4.1) | `app/orchestrator/runner.py` |
| 4 | Panggil `gc_old_worktrees` dari `lifespan` + `cleanup_workspace` di jalur non-otonom; rapikan fungsi GC | `app/main.py`, `app/orchestrator/isolation.py` |
| 5 | `seed.py --reconcile` | `scripts/seed.py` |
| 6 | Posisi antrean terlihat di event `status` | `app/orchestrator/runner.py` |

Item 1 dan 2 adalah satu paket dan harus lebih dulu: 1 memperbaiki kerusakan, 2
memastikan kerusakan berikutnya ketahuan. Jangan commit working tree ini sebelum
keduanya beres — commit sekarang berarti mengabadikan Fase 3.5 dalam keadaan
cascade tidak jalan.

**Fase 3.6 — uji lapisan API.** Tidak berubah dari rencana sebelumnya, dengan
SSE replay + dedup `seq` dinaikkan ke urutan pertama.

**Fase 4 — workflow plan→execute.** Tidak berubah. Refactor `_execute` menjadi
`_run_cascade(targets, prompt, floor) -> Attempt` tetap prasyaratnya.

---

## 7. Verifikasi yang mendasari dokumen ini

- Suite dijalankan dua kali: dengan default conftest (`59 skipped`) dan dengan
  `CHOROS_DATABASE_URL` menunjuk port 5433 (`10 failed, 49 passed`).
- Kegagalan ditelusuri ke satu akar lewat traceback, bukan disimpulkan dari
  pembacaan kode.
- `docker port choros-db-1` mengonfirmasi pemetaan `5432/tcp -> 127.0.0.1:5433`,
  dan `psql -l` mengonfirmasi database `choros_test` memang ada — jadi skip-nya
  murni salah port, bukan DB yang belum disiapkan.
- In-degree `gc_old_worktrees` dan `cleanup_workspace` diperiksa dengan pencarian
  seluruh repo.

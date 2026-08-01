# Rencana pengembangan — setelah Fase 1–3

Ditulis 1 Agustus 2026, dari pembacaan menyeluruh codebase pada commit `3e163ab`
(+ perubahan OpenCode Zen yang belum di-commit). Isinya tiga hal: penilaian
kondisi sekarang, temuan yang perlu ditutup, dan urutan kerja yang disarankan.

Dokumen ini melengkapi [catatan-implementasi.md](catatan-implementasi.md) — yang
itu mencatat *apa yang sudah dikerjakan dan kenapa berbeda dari PRD*, yang ini
mencatat *apa berikutnya dan kenapa urutannya begitu*.

> **Lanjutan:** Fase 3.5 di bawah sudah dikerjakan (belum di-commit). Status per
> item, regresi yang muncul dalam prosesnya, dan sisa kerjaannya ada di
> [rencana-penutupan-fase35.md](rencana-penutupan-fase35.md).

---

## 1. Kondisi sekarang

Fase 1–3 PRD jalan end-to-end. Yang layak dicatat sebagai kekuatan, karena ini
yang menentukan rencana di bawah tidak perlu membongkar apa pun:

- **Kontrak `Event` betul-betul jadi titik normalisasi tunggal** (`app/events.py`).
  Orchestrator tidak pernah tahu detail harness; console tampil sama apa pun
  provider yang jalan.
- **Tiga keputusan cascade PRD §6 ada di kode, bukan cuma di README** —
  titik-ulang berbasis plan, batas bawah kualitas, berhenti bersih
  (`app/orchestrator/runner.py`).
- **Parser tiap harness ditulis dari output CLI sungguhan**, dengan hook
  `finalize()` untuk harness tanpa event penutup.
- **Lapisan bersih.** `adapters` fan-in tinggi / fan-out nol (core sejati), API
  cuma lapisan tipis di atas orchestrator. Tidak ada kebocoran lapisan.

Skala: ~3.500 baris, 37 file Python, 56 test.

Karena itu rencana ini bukan soal memperbaiki desain, melainkan soal **menutup
jarak antara "fitur ada" dan "tahan dipakai tiap hari"**, lalu baru maju ke
Fase 4.

---

## 2. Temuan

### 2.1 Tiga lubang operasional yang akan menggigit duluan

**(a) Tugas tidak selamat dari restart.**
`runner.start()` dipanggil langsung di request handler (`app/api/tasks.py`), dan
`lifespan` (`app/main.py`) tidak pernah memindai tugas tertinggal. Setelah
restart atau crash, baris `tasks` berstatus `running` menggantung selamanya: UI
menampilkannya sebagai berjalan, SSE-nya langsung `eof`, tidak ada cara
melanjutkan. Untuk tool yang dijalankan lewat systemd dengan auto-restart, ini
pasti kejadian — bukan kemungkinan.

**(b) Worktree otonom tidak punya jalan pulang.**
`cleanup_workspace()` ada di `app/orchestrator/isolation.py` tapi **tidak pernah
dipanggil dari mana pun** (in-degree 0 di graf pemanggilan). Tidak ada endpoint
maupun UI untuk melihat diff, merge, atau membuang hasilnya.

Efeknya: mode otonom — pembeda "otomasi-berani vs otomasi-ceroboh" yang jadi inti
PRD §8 — menghasilkan kerja di `~/.choros/worktrees/task-N` yang harus diurus
manual lewat terminal, dan direktorinya menumpuk tanpa batas. Ini yang paling
menurunkan nilai fitur yang sudah susah payah dibangun.

**(c) Tidak ada batas konkurensi.**
`runner.start()` tanpa semaphore. Sepuluh tugas dikirim = sepuluh proses
`claude`/`agy` hidup bersamaan, masing-masing dengan timeout 1800 detik.

### 2.2 Cooldown 429 mengunci target jauh lebih lama dari seharusnya

`mark_exhausted` menempelkan `is_exhausted=True` ke window pemakaian yang sedang
berjalan, dan sengaja tidak memperpendek `window_end` (`app/orchestrator/quota.py`).
Untuk agent `claude` yang ber-`window_type: rolling_5h`, satu 429 dengan
`Retry-After` 60 detik akan menandai target mentok **sampai window 5 jam itu
habis**, bukan 60 detik.

Akarnya: cooldown (state sesaat per-target) dan window konsumsi (akumulasi token)
adalah dua konsep berbeda yang sekarang berbagi satu baris. Konsekuensi lain dari
konflasi yang sama: `record_usage` bisa menumpuk token ke baris ber-
`window_type='cooldown'`, yang lalu kadaluarsa dan ikut menghapus catatan
konsumsinya.

### 2.3 Lapisan API sama sekali tidak diuji

56 test menutup parser, quality floor, isolasi, dan 10 skenario cascade — bagian
yang paling sulit, dan itu pilihan prioritas yang tepat. Tapi nol test menyentuh
HTTP. Padahal:

- `_owned_task` / `_owned_agent` / `_owned_rule` adalah **klaim keamanan utama
  untuk Fase 5**, dan sekarang hanya dijamin lewat pembacaan kode.
- SSE replay + dedup `seq` (`app/api/tasks.py`) adalah logika berliku yang belum
  pernah diuji sama sekali.

### 2.4 Detail kecil

- `_emit()` membuka sesi DB + commit **per event**. Run panjang = ribuan
  transaksi kecil.
- Endpoint `GET /api/tasks/{id}/logs` ada tapi frontend tak pernah memanggilnya —
  riwayat percobaan cascade (target mana gagal, berapa token terpakai) tidak
  terlihat di UI, padahal itu justru cerita utama choros.
- `scripts/seed.py` menyisipkan rule baru tapi tidak memperbarui `priority` rule
  lama. Perlu flag `--reconcile` sebelum daftar model Zen berubah lagi.

---

## 3. Urutan kerja

### Fase 3.5 — bikin yang sudah ada tahan dipakai

**Prioritas tertinggi. Perkiraan 2–3 sesi.**

| # | Kerjaan | File utama |
|---|---|---|
| 1 | Recovery saat startup: pindai `tasks` berstatus `queued`/`running`, tandai `interrupted`, tawarkan resume dari `last_session_id` | `app/main.py`, `app/orchestrator/runner.py` |
| 2 | Siklus hidup worktree: `GET /tasks/{id}/diff`, `POST /tasks/{id}/merge`, `POST /tasks/{id}/discard` + panel review di UI; panggil `cleanup_workspace` + GC worktree lebih tua dari N hari | `app/orchestrator/isolation.py`, `app/api/tasks.py`, `app/static/app.js` |
| 3 | `asyncio.Semaphore` global + antrian; tugas berlebih tetap `queued` dengan posisi antrean terlihat | `app/orchestrator/runner.py`, `app/config.py` |
| 4 | Pisahkan cooldown dari window konsumsi (kolom `kind`, atau tabel `agent_cooldowns` terpisah) | `app/orchestrator/quota.py`, `migrations/002_*.sql` |
| 5 | Batch penulisan `task_events` (~50 event / 500 ms) | `app/orchestrator/runner.py` |
| 6 | Panel "percobaan" di UI yang memakai `/logs` — tampilkan rantai cascade per tugas | `app/static/app.js` |

Setelah ini choros aman ditinggal jalan berhari-hari, dan mode otonom jadi
benar-benar berguna.

### Fase 3.6 — uji lapisan API

**Perkiraan 1 sesi. Prasyarat sebelum Fase 5 boleh disentuh.**

`httpx.ASGITransport` + `TestClient`, fokus pada tiga hal saja:

1. Boundary kepemilikan — user B tidak pernah melihat resource user A (404, bukan
   403).
2. Alur login/cookie, termasuk jalur `auth_disabled`.
3. SSE replay + dedup `seq`.

### Fase 4 — workflow plan→execute

**Perkiraan 2–3 sesi. Pembeda terbesar yang tersisa.**

Fondasinya sudah ada: `_rebuild_prompt` sudah memperlakukan plan sebagai artefak
handoff, `quality_floor` sudah per-tugas, cascade sudah bisa dipakai ulang
per-step. Yang perlu dibangun:

- API CRUD `workflows` / `workflow_steps` (tabel sudah ada, kode nol).
- Runner multi-step yang memanggil ulang loop cascade yang sekarang, satu kali
  per step, dengan `targets` dan `quality_floor` milik step itu.
- Artefak handoff terstruktur (output step N → input step N+1) — bukan
  transkrip, sesuai PRD §7 dan §11.
- Checkpoint `requires_approval`: tugas berhenti di status `awaiting_approval`,
  plan tampil di UI, user setuju baru eksekusi jalan. Kolomnya sudah ada di
  skema.

**Refactor kecil yang memungkinkan ini:** pecah `_execute` jadi
`_run_cascade(targets, prompt, floor) -> Attempt` supaya bisa dipanggil per-step.
Sekarang ia satu metode ±180 baris yang mencampur setup tugas dengan loop
cascade.

### Fase 5 — mode tim (opsional)

Isolasi credential store per-user lewat container. Jangan dikerjakan sebelum
Fase 3.6 selesai — catatan di `catatan-implementasi.md` §3 sudah benar: boundary
kepemilikan ditegakkan di API, tapi belum ada satu pun test yang membuktikannya.

---

## 4. Yang sengaja TIDAK dikerjakan sekarang

- **Klasifikasi LLM (PRD §5 v2).** Dropdown + keyword sudah cukup untuk
  single-user, dan ini menambah panggilan LLM di jalur panas untuk keuntungan
  tipis.
- **`Event.question` lewat stdin.** Keputusan memakai resume sesi sudah benar dan
  sudah terbukti di lapangan (catatan-implementasi §1.1). Jangan diutak-atik.

---

## 5. Langkah pertama yang disarankan

**Item 3.5 (2) — siklus hidup worktree.** Alasannya: paling terasa langsung
(mode otonom saat ini menghasilkan kerja yang tidak bisa direview atau di-merge
dari dashboard), dan tidak bertabrakan dengan perubahan OpenCode Zen yang masih
di working tree.

Alternatif kalau ingin konsistensi data lebih dulu: item 3.5 (1) — recovery
restart.

# Console Rework — Project → Task → Run → Console

**Dibuat:** 5 Agustus 2026
**Status:** rencana pengembangan (belum dieksekusi)
**Audiens:** agent AI eksekutor. Dokumen ini ditulis agar dapat dijalankan langkah demi langkah dengan akurasi 100%. Jangan berimprovisasi di luar spesifikasi; bila ada ambiguitas, ikuti bagian "Aturan main" di bawah.

---

## 1. Tujuan

UX console Choros sekarang **single-run**: satu instance `useConsole` ([app/static/src/state/useConsole.ts:19](../../app/static/src/state/useConsole.ts#L19)), riwayat read-only tanpa relasi, dan tombol "Eksekusi plan ini →" **palsu** (hanya mem-prefill textarea — [ConsoleScreen.tsx:74-79](../../app/static/src/features/console/ConsoleScreen.tsx#L74-L79), [ResultStrips.tsx:56-60](../../app/static/src/features/console/ResultStrips.tsx#L56-L60)). Tidak ada konsep Project dan tidak ada handoff plan→coding nyata.

Rework ini membangun hierarki **Project → Task → Run → Console**:

- **Project** — wadah bernama + folder kerja (divalidasi). Operasi berjalan di **folder live** (in-place), bukan worktree terisolasi.
- **Task** — unit **persisten & dapat di-run ulang** (mis. "Quality Control"). Menyimpan **daftar kategori ad-hoc** (mis. `text_planning` + `coding_complex`) yang dipilih saat pembuatan.
- **Run** — satu eksekusi sebuah Task. Sumber "daftar run per Task" (riwayat, dapat di-replay).
- **Console** — satu **lane kategori** dalam sebuah Run. Interaktif (submit + follow-up + reply).

Perilaku kunci:
- **Console interaktif + delegasi EKSPLISIT** (bukan auto-pipeline `advance_run`). Delegasi = aksi user: ambil hasil console A → buat console B dengan konteks plan.
- **Sekuensial**: console hilir (mis. coding) **placeholder** sampai console hulu (planning) didelegasikan.
- **Result-primary**: tiap console menampilkan **hasil terakhir ter-render (markdown)** sebagai tampilan utama; raw stream jadi mode sekunder. Ada **picker riwayat hasil** untuk mengganti materi yang ditampilkan.
- **Minimize/maximize**: console bisa diciutkan (proses tetap jalan di server); saat minimize tampil **status + token (run ini + akumulasi lane) + hasil ringkas**.
- **Capture plan md-aware**: bila agent menulis file `.md`, isinya dapat dipilih sebagai artifact delegasi; bila tidak, pakai `final_output` (teks).

---

## 2. Keputusan arsitektur (FINAL, dari diskusi dengan pemilik produk)

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Wujud "Task" persisten | **Tabel baru khusus** (`projects`, `task_groups`, `task_runs`) | Semantik bersih; bukan reuse `Workflow`. |
| Mekanisme delegasi | **Endpoint `/delegate` eksplisit baru** | Lugas, tak terikat `advance_run`. |
| Workspace | **Folder live (in-place)** | Interaktif sudah in-place ([isolation.py:60-61](../../app/orchestrator/isolation.py#L60-L61)). |
| Shell frontend | **Pakai yang ada** (arah 1c) | Reuse DS + `useConsole` per-instance. |
| Result-view | **Hasil terakhir + picker riwayat** | Bukan dua renderer; keterbacaan hasil = prioritas. |

---

## 3. Peta entitas ↔ tabel (WAJIB dipatuhi — hindari tabrakan nama)

Tabel `tasks` **yang sudah ada** = **satu eksekusi console** (follow-up via `parent_task_id`). Dipakai ulang apa adanya untuk runner & streaming. **Jangan** dijadikan "Task" user-facing.

| Istilah UI | Tabel | Keterangan |
|---|---|---|
| Project | `projects` (baru) | nama + folder |
| Task | `task_groups` (baru) | nama + kategori tersimpan; mis. "Quality Control" |
| Run | `task_runs` (baru) | satu eksekusi Task; riwayat |
| Console (lane) | row di `tasks` (existing) | diidentifikasi (task_run_id, category) |
| Eksekusi/follow-up | row di `tasks` (existing) | rantai `parent_task_id` |

Relasi: `projects` 1─* `task_groups` 1─* `task_runs` 1─* `tasks`.

---

## 4. Aturan main untuk eksekutor

1. **Reuse dulu.** Jangan bikin komponen/primitive/endpoint baru bila sudah ada. DS primitive dilarang dibuat di luar [components/ds/index.ts](../../app/static/src/components/ds/index.ts) (lihat baris 1 file itu).
2. **Migrasi = file `.sql` idempoten bernomor** di [migrations/](../../migrations/), dijalankan `apply_migrations()` ([db.py:94](../../app/db.py#L94)). Semua statement pakai `IF NOT EXISTS`.
3. **Router baru** didaftarkan di [app/api/__init__.py](../../app/api/__init__.py) `ROUTERS`, **bukan** langsung di `main.py`.
4. **Auth/DB deps**: `from app.security import CurrentUser, DbSession`. Ownership guard: tiru pola `_owned_task` ([tasks.py:209](../../app/api/tasks.py#L209)).
5. **Kerjakan per fase berurut** (lihat [04-execution-phases.md](04-execution-phases.md)). Tiap fase punya kriteria terima; **jangan lanjut** sebelum kriteria fase sekarang hijau.
6. Bila menemui fakta yang berbeda dari dokumen (mis. nama kolom event), **verifikasi ke kode**, sesuaikan, dan catat di bagian "Catatan penyimpangan" di [04-execution-phases.md](04-execution-phases.md).

---

## 5. Indeks dokumen

- **[01-backend.md](01-backend.md)** — migrasi SQL, model SQLAlchemy, schema Pydantic, endpoint (projects, task-groups, runs, delegate, artifact-candidates), registrasi router.
- **[02-frontend.md](02-frontend.md)** — client `projectApi.ts`, penambahan `attach()` ke daemon, navigasi, layar Projects/Task, `RunWorkspace`, `ConsolePanel` (result-primary, picker riwayat, minimize).
- **[03-execution-phases.md](03-execution-phases.md)** — 7 fase berurut + kriteria terima + verifikasi end-to-end + catatan penyimpangan.

---

## 6. Ruang lingkup & non-tujuan

**Termasuk:** hierarki Project/Task/Run/Console, multi-console interaktif, delegasi eksplisit md-aware, result-primary + picker riwayat + minimize/maximize, navigasi Projects.

**TIDAK termasuk (v1):**
- Isolasi worktree per-lane (folder live saja). Risiko tabrakan bila banyak lane menulis folder sama — sarankan escape-hatch toggle isolasi di v2.
- Refine plan lewat percakapan yang auto-tertangkap jadi artifact (v1: edit artifact di modal delegasi + follow-up manual).
- Menghapus tab Console lama & sistem `Workflow` lama (biarkan koeksis; pembersihan minimal di Fase 7).

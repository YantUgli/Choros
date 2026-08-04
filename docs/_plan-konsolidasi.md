# Plan: Konsolidasi /docs

> Dokumen ini adalah instruksi eksekusi sekali pakai.
> **Hapus file ini setelah semua langkah selesai.**

---

## Tujuan

Dari 17 dokumen di `/docs`, sebagian besar adalah rencana fase dan koreksi yang
kodenya sudah selesai — tidak lagi berguna sebagai referensi harian, hanya
menambah noise. Target akhir: **3 dokumen aktif** yang mudah dibaca, sisanya dihapus.

---

## Target akhir

| File | Peran |
|---|---|
| `catatan-implementasi.md` | Diperbarui — satu-satunya living document proyek |
| `status-sekarang.md` | Baru — ringkasan kondisi saat ini + daftar yang belum selesai |
| `rencana-quota-display.md` | Tidak disentuh — fitur aktif yang belum dikerjakan |

---

## Langkah 1 — Perbarui `catatan-implementasi.md`

Tambahkan **§5 Keputusan UI dan Cockpit** di bawah §4. Tulis dari tangan
(jangan copy-paste blok besar) — isi yang perlu masuk:

**Dari `rencana-console-ux.md`:**
- Keputusan: Layout Toggle Console → dua mode (stream-besar vs split), bukan
  drag handle. Implementasi: tombol toggle di header LiveConsole. **Selesai
  (commit `d038eee`).**
- Keputusan: Plan→Execute Bridge → tombol "Gunakan sebagai Task" di ResultStrip
  yang meng-copy summary planning run ke ComposePanel. **Selesai (commit yang sama).**

**Dari `rencana-perbaikan-browse-path.md`:**
- Keputusan: modal BrowseModal in-app (bukan dialog OS native). Alasan: dialog
  native terbuka di layar mesin server, bukan browser — cacat arsitektural, bukan
  bug. Implementasi: endpoint `GET /api/fs/list` + `BrowseModal.tsx` dengan deteksi
  separator dari `cwd`. **Selesai (commit `8eabc5c`).**

**Dari `rencana-paritas-cockpit.md` + `koreksi-paritas-cockpit.md`:**
- Follow-up dan AttemptsPanel hilang waktu migrasi ke React cockpit. Penyebab:
  pintu masuknya di UI saja yang hilang, endpoint-nya sudah ada. **Selesai.**

**Dari `rencana-data-nyata-cockpit.md` + `koreksi-data-nyata-cockpit.md`:**
- Lima tab cockpit awalnya memakai `fixtures.ts` (405 baris data hardcoded).
  Kabel frontend ke backend disambung satu per satu. **Selesai.**

**Dari `rencana-pengembangan.md` §2.3 dan §2.4 (yang belum ada di catatan):**
- Pelajaran: batch penulisan `task_events` (~50 event/500ms) dikerjakan di
  Fase 3.5 item 5 untuk menekan ribuan transaksi kecil per run.
- Endpoint `GET /api/tasks/{id}/logs` (riwayat cascade) sekarang dipakai panel
  Percobaan di UI — celah visibilitas dari §2.4 sudah tertutup.

---

## Langkah 2 — Buat `status-sekarang.md`

File baru yang menggantikan `rencana-penyelesaian.md`. Jauh lebih pendek —
hanya berisi kondisi terkini dan pekerjaan yang benar-benar tersisa. Isi:

```markdown
# Status proyek Choros — per 4 Agustus 2026

## Kondisi kode

- Suite: 97+ passed, nol skip (terakhir diverifikasi sebelum branch cockpit)
- ruff: `app/` bersih; `tests/` exempt ruleset S (`per-file-ignores` di pyproject.toml)
- Fase 1–5c: **kode selesai**
- Fase 5d (container per user): sengaja tidak dikerjakan — LocalLauncher cukup

## Yang BELUM selesai

### A. Verifikasi manual UI — belum pernah dilakukan manusia

Butuh browser + manusia. Test suite tidak bisa menggantikannya.

Jalankan server, lalu verifikasi 15 langkah ini:

**Fase 4 — approval workflow**
1. Buat workflow 2-step lewat UI; step kedua centang "Butuh Persetujuan".
2. Klik Ubah → editor terisi, termasuk nama step.
3. Klik Run, isi goal.
4. Panel Status Run menampilkan dua baris step dengan status masing-masing.
5. Setelah step 1 selesai, panel approval muncul dengan plan step 1 di textarea.
6. Sunting satu baris plan → Setujui → step 2 memakai teks yang sudah disunting.

**Fase 5b — multi-user**
7. Login admin → tab Pengguna muncul.
8. Buat user baru → muncul di daftar.
9. Logout → masuk sebagai user baru → tab Pengguna tidak muncul.
10. Buka Routing sebagai user baru → terisi rule miliknya, nol milik admin.
11. Ganti password sendiri → logout → login dengan password baru.
12. Jalankan satu tugas ringan sebagai user baru → jalan.

**Fase 5c — kredensial**
13. Panel kredensial menampilkan `credential_home` milik user yang login, path ada di disk.
14. Jalankan `HOME=<path> claude login` untuk user itu → tugas memakai login itu.
15. ⚠️ User lain yang home-nya belum login → tugas gagal auth, BUKAN diam-diam
    memakai kredensial operator. Ini bukti tunggal isolasi 5c benar-benar bekerja.

### B. Fitur baru: Quota Display

Lihat `rencana-quota-display.md` — belum mulai dikerjakan.

## Batas yang diketahui (keputusan sadar)

- Kunci API model mentah (`GROQ_API_KEY`, dll.) tidak terisolasi per-user.
  Solusi tanpa kode baru: user berbeda arahkan ke variabel berbeda lewat `api_key_env` di `agents.config`.
- Classifier LLM (PRD §5 v2): tidak dikerjakan. Dropdown + keyword cukup.
- Auto-answer trust lewat stdin (PRD §4 "Cadangan"): tidak dikerjakan.
  Pre-seed `ensure_trusted()` belum pernah gagal di lapangan.
- `Event.type='question'`: ada di kontrak, tidak pernah di-emit. Desain sengaja.
```

---

## Langkah 3 — Hapus 14 dokumen lama

Semua ini sudah terwakili di `catatan-implementasi.md` yang diperbarui dan
`status-sekarang.md` yang baru:

```bash
rm docs/rencana-pengembangan.md
rm docs/rencana-fase4.md
rm docs/rencana-fase5.md
rm docs/rencana-fase5b.md
rm docs/rencana-penutupan-fase35.md
rm docs/rencana-penutupan-fase35b.md
rm docs/rencana-penutupan-fase4.md
rm docs/rencana-penutupan-fase5b.md
rm docs/rencana-console-ux.md
rm docs/rencana-paritas-cockpit.md
rm docs/koreksi-paritas-cockpit.md
rm docs/rencana-data-nyata-cockpit.md
rm docs/koreksi-data-nyata-cockpit.md
rm docs/rencana-perbaikan-browse-path.md
rm docs/rencana-penyelesaian.md
```

---

## Langkah 4 — Hapus plan ini

```bash
rm docs/_plan-konsolidasi.md
```

---

## Hasil verifikasi

Setelah langkah 3–4 selesai, `ls docs/` harus menampilkan persis:

```
catatan-implementasi.md
rencana-quota-display.md
status-sekarang.md
```

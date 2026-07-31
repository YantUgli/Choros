# Catatan implementasi — beda dari PRD & temuan lapangan

Ditulis saat mengerjakan Fase 1–3. Isinya dua hal: keputusan yang berbeda dari
PRD v0.2 beserta alasannya, dan hal-hal yang baru ketahuan setelah harness-nya
benar-benar dijalankan.

---

## 1. Penyimpangan dari PRD

### 1.1 Tanya-jawab: resume sesi, bukan stdin

**PRD §8:** "Pertanyaan balik agent (`Event.type=question`) → tampil di dashboard
→ jawaban dialirkan ke stdin."

**Yang dikerjakan:** follow-up dijalankan sebagai tugas lanjutan yang me-resume
sesi yang sama (`claude --resume`, `agy --conversation`, `opencode --session`).

**Alasan:** ketiga harness dijalankan dalam print-mode (`-p`), yang memproses satu
prompt lalu keluar. Menyuntik jawaban ke stdin proses yang sudah selesai tidak ada
gunanya; memakai `--input-format stream-json` agar proses tetap hidup berarti
proses menunggu input tanpa batas dan attempt baru berakhir saat timeout. Resume
by session id memberi hasil yang sama (konteks utuh) dengan mekanisme yang memang
disediakan tiap harness. Terbukti di uji coba: sesi `543dc93c…` dilanjutkan dan
cache read 25k token menunjukkan konteksnya benar-benar dipakai ulang.

Konsekuensi: `Event.type='question'` ada di kontrak tapi belum pernah di-emit oleh
adapter mana pun — dalam print-mode, pertanyaan agent keluar sebagai teks biasa di
`output`. Dashboard menyediakan kotak follow-up untuk semua tugas, jadi alurnya
tetap jalan.

### 1.2 Dua tabel tambahan di luar §9

- **`tasks`** — PRD hanya punya `task_logs` (catatan per-percobaan). Live console
  dan cascade butuh entitas tugas yang bertahan lintas beberapa percobaan.
- **`task_events`** — stream ternormalisasi, supaya console bisa di-replay setelah
  browser ditutup atau server restart.

Kolom tambahan di `tasks`: `allow_unisolated`, `last_session_id`, `parent_task_id`,
`resume_session_id`, `pinned_agent_id` (mendukung §1.1 dan isolasi §8).

`task_logs` tetap seperti di PRD, hanya ditambah FK `task_id`.

### 1.3 Delta parsial tidak disimpan ke DB

Live console menggabungkan delta token supaya terasa seperti terminal. Menyimpan
tiap delta berarti ribuan baris per tugas tanpa menambah informasi — versi utuhnya
sudah tersimpan. Jadi delta hanya dialirkan ke bus, tidak dipersistensi.

### 1.4 `ERROR_PERMISSION` ditambahkan ke pemicu cascade

PRD memikirkan cascade terutama untuk kuota. Ternyata ada kegagalan lain yang
membuat target benar-benar tidak bisa bekerja (lihat §2.2), dan membiarkan tugas
mati di situ bertentangan dengan tugas choros: mencari jatah sah berikutnya.

---

## 2. Temuan dari harness sungguhan

### 2.1 Tiap harness punya format stream sendiri

| Harness | Bentuk |
|---|---|
| Claude Code | `{"type":"assistant","message":{"content":[…]}}`, ditutup `{"type":"result",…}` |
| Antigravity | `{"event":"step_update","step_update":{…}}`, ditutup `{"event":"result",…}` |
| opencode | `{"type":"text","sessionID":…,"part":{…}}`, **tanpa** event penutup |

Tiga konsekuensi desain:

- Parser ditulis presisi per harness dari output sungguhan, bukan menebak.
- Ada hook `finalize()` di base adapter, karena opencode tidak punya event
  "result" — jawaban utuhnya harus dirakit sendiri saat stream habis.
- Baris yang tidak dikenali tetap muncul sebagai `output` mentah, jadi perubahan
  format di versi berikutnya tidak pernah membuat console kosong.

### 2.2 agy headless menolak tool yang butuh izin

Dalam mode non-otonom, `agy` menolak otomatis tool yang butuh konfirmasi, dan
pesannya keluar **sebagai teks biasa, bukan JSON**:

```
jetski: no output produced — a tool required the "read_file" permission that
headless mode cannot prompt for, so it was auto-denied.
```

Adapter mendeteksi pesan ini dan mengubahnya jadi error `permission_denied` yang
memicu cascade, dengan saran tindakan (jalankan otonom, atau tambah allow-rule di
settings.json agy). Tanpa ini, tugas hanya "selesai" dengan hasil kosong.

### 2.3 Trust bukan cuma soal menghilangkan dialog

Saat `agy` dijalankan di direktori yang tidak ada di `trustedWorkspaces`, dia
tidak bertanya — dia mengerjakan tugas di direktori scratch-nya sendiri
(`~/.gemini/antigravity-cli/brain/<id>/`). File yang diminta memang dibuat, tapi
bukan di project. Jadi `ensure_trusted()` menentukan benar/tidaknya hasil, bukan
sekadar kenyamanan. Adapter juga selalu mengirim `--add-dir <workspace>`.

### 2.4 Penghitungan token berbeda antar harness

- Claude: `result.usage` kumulatif untuk seluruh sesi.
- agy: `usage` per-step, dan `result.usage` totalnya.
- opencode: `step-finish.tokens` dengan cache bersarang.

Karena itu usage digabung dengan **max per field**, bukan dijumlah — kumulatif
tetap benar, per-step tetap terambil totalnya. Ini pendekatan yang cukup, bukan
akuntansi presisi; sesuai catatan jujur PRD §10.

### 2.5 opencode mengirim ulang part yang sama

Part teks dikirim berkali-kali dengan isi yang makin panjang. Kalau semuanya
digabung, jawaban akan tertulis berlipat. Adapter melacak teks per `part.id` dan
hanya mengalirkan selisihnya.

Masalah serupa di Claude Code: dengan `--include-partial-messages`, teks datang
tiga kali (delta → blok pesan utuh → `result`). Adapter melewati blok utuh saat
delta aktif, dan menandai `result` sebagai `final` supaya UI menaruhnya di panel
hasil, bukan mengulanginya di log.

---

## 3. Yang belum dikerjakan

- **Fase 4 (workflow lintas-provider)** — tabel `workflows`/`workflow_steps` ada,
  API dan runner multi-step belum. PRD menandainya opsional dan bukan default.
- **Fase 5 (mode tim)** — semua query sudah tersaring `user_id` dan boundary
  kepemilikan ditegakkan di API, tapi isolasi credential store per-user (container
  per user) belum ada. Jangan pakai multi-user sebelum itu.
- **Klasifikasi LLM (PRD §5 v2)** — masih dropdown + keyword.
- **`ensure_trusted` untuk opencode** — opencode tidak punya konsep trust folder;
  izin ditangani per-run lewat `--auto`, sengaja tidak menulis permission wildcard
  ke config global user.

## 4. Verifikasi yang sudah dilakukan

Dijalankan sungguhan, bukan hanya unit test:

- ClaudeAdapter, AntigravityAdapter, OpenCodeAdapter — masing-masing satu run
  nyata; session id, delta, usage, dan output akhir terbaca benar.
- Cascade lintas provider: `groq-raw` (tanpa API key → error auth) → jatuh ke
  Claude → tugas selesai, dua baris `task_logs` tercatat dengan status berbeda.
- Follow-up: sesi Claude yang sama dilanjutkan, konteks terbukti dipakai ulang.
- Mode otonom: tugas menulis file di worktree `choros/task-3`, repo asli tetap
  bersih.
- Kuota: window `rolling_5h` terisi 25.093 token dari run nyata.

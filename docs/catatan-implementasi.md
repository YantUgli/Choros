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

## 3. Status

*Diperbarui 2 Agustus 2026, setelah Fase 5c dikerjakan.*

- **Fase 4 (workflow lintas-provider)** — **kode selesai.** API CRUD, runner
  multi-step, artefak handoff, dan checkpoint approval sudah jalan (`3f74978`
  beserta rangkaian penutupannya). Verifikasi manual lewat browser
  (`rencana-penutupan-fase4.md` §6) belum pernah dijalankan.
- **Fase 5 (mode tim)** — **kode selesai, belum terverifikasi.** 5a menutup
  boundary routing & kuota, 5b memberi auth multi-user, 5c memberi
  `credential_home` per-user (`~/.choros/homes/<username>`) yang dipasang sebagai
  `HOME` dan `USERPROFILE` untuk subprocess langganan. 5d (container per user)
  opsional dan sengaja tidak dikerjakan — `rencana-fase5.md` §3 memutuskan
  `LocalLauncher` sudah cukup untuk maksud PRD.

  **Jangan tulis "selesai" tanpa kualifikasi.** Tidak ada satu pun dari 15 langkah
  verifikasi manual (`rencana-penyelesaian.md` §6) yang pernah dijalankan.
  Khususnya langkah 15 — user yang home-nya belum pernah di-login harus gagal
  dengan error auth, **bukan** diam-diam memakai kredensial operator — adalah
  bukti tunggal bahwa isolasi 5c benar-benar bekerja. Sampai itu lolos, mode tim
  belum boleh dipakai sungguhan.

  **Batas isolasi yang diketahui:** kunci API model mentah yang disetel lewat
  environment server (`GROQ_API_KEY`, `OPENAI_API_KEY`, dan `env_keys` opencode)
  **tidak** ikut terisolasi — `openai_compat.py` dan `opencode.py` membacanya dari
  `os.environ` saat run. Isolasi hanya berlaku pada CLI langganan yang membaca
  kredensial dari `HOME`/`USERPROFILE`. Jalan keluarnya tanpa kode baru:
  `api_key_env` adalah *nama* variabel dan disimpan di `agents.config` yang sudah
  per-user, jadi user berbeda bisa menunjuk variabel berbeda.

### Ditutup sebagai keputusan sadar, bukan pekerjaan yang hilang

- **Klasifikasi LLM (PRD §5 v2)** — tetap dropdown + keyword. PRD sendiri
  menandainya opsional. Menambah panggilan LLM di jalur panas menambah latensi
  dan konsumsi kuota demi keuntungan tipis.
- **Auto-answer trust lewat stdin (PRD §4 "Cadangan")** — tidak dikerjakan. PRD
  menyebutnya sendiri "rapuh; hanya jaring pengaman", dan jalur utamanya
  (`ensure_trusted()` pre-seed) belum pernah gagal di lapangan. Kalau suatu saat
  gagal, catat kasusnya dulu, baru bangun jaringnya.
- **`ensure_trusted` untuk opencode** — opencode tidak punya konsep trust folder;
  izin ditangani per-run lewat `--auto`, sengaja tidak menulis permission wildcard
  ke config global user.

### 3.1 Pelajaran: kontrak UI↔API tidak punya penjaga

Tiga kali berturut-turut UI membaca field yang tidak pernah dikirim API, dan
ketiganya lolos seluruh suite tanpa satu pun error:

| Kapan | Gejala |
|---|---|
| Fase 4 (A1-A6) | enam pemanggilan `api()` di `app.js` tidak cocok dengan route/skema |
| Fase 5b (H1) | `status.is_admin` tidak pernah dikirim → tab Pengguna tak pernah muncul |
| Fase 5c | `status.credential_home` tidak pernah dikirim → panel panduan login mati |

Pola gagalnya selalu sama: `undefined` itu falsy, jadi fiturnya hilang diam-diam,
bukan meledak. Penjaganya sekarang ada — `test_c4_auth_status_contract`
memeriksa **semua** kunci yang dibaca `app.js` beserta nomor barisnya. Kalau UI
mulai membaca field baru dari sebuah endpoint, tambahkan ke test kontraknya di
saat yang sama.

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

Otomatis: 105 test hijau, nol skip; `ruff check app/ tests/` nol temuan.

### Yang BELUM pernah diverifikasi

**Nol langkah verifikasi lewat browser, sejak Fase 4 sampai 5c.** Seluruh UI
Fase 4 (panel approval plan), Fase 5b (panel pengguna, logout, ganti password),
dan Fase 5c (panel panduan login harness) hanya pernah dibaca sebagai kode,
tidak pernah dijalankan manusia.

Ini celah kepercayaan terbesar yang tersisa, dan bukan celah teoretis: ketiga bug
di §3.1 hidup di lapisan itu dan tidak satu pun tertangkap oleh 105 test.
Checklist 15 langkahnya ada di `rencana-penyelesaian.md` §6.

## 5. Keputusan UI dan Cockpit

- Keputusan: Layout Toggle Console → dua mode (stream-besar vs split), bukan
  drag handle. Implementasi: tombol toggle di header LiveConsole. **Selesai
  (commit `d038eee`).**
- Keputusan: Plan→Execute Bridge → tombol "Gunakan sebagai Task" di ResultStrip
  yang meng-copy summary planning run ke ComposePanel. **Selesai (commit yang sama).**
- Keputusan: modal BrowseModal in-app (bukan dialog OS native). Alasan: dialog
  native terbuka di layar mesin server, bukan browser — cacat arsitektural, bukan
  bug. Implementasi: endpoint `GET /api/fs/list` + `BrowseModal.tsx` dengan deteksi
  separator dari `cwd`. **Selesai (commit `8eabc5c`).**
- Follow-up dan AttemptsPanel hilang waktu migrasi ke React cockpit. Penyebab:
  pintu masuknya di UI saja yang hilang, endpoint-nya sudah ada. **Selesai.**
- Lima tab cockpit awalnya memakai `fixtures.ts` (405 baris data hardcoded).
  Kabel frontend ke backend disambung satu per satu. **Selesai.**
- Pelajaran: batch penulisan `task_events` (~50 event/500ms) dikerjakan di
  Fase 3.5 item 5 untuk menekan ribuan transaksi kecil per run.
- Endpoint `GET /api/tasks/{id}/logs` (riwayat cascade) sekarang dipakai panel
  Percobaan di UI — celah visibilitas dari §2.4 sudah tertutup.
- Quota display (Claude Code live, Gemini/Antigravity live, alert token limit
  OpenCode) — **kode selesai** (commit `7d37900`). Di Windows dua bug spesifik
  ditemukan lalu diperbaiki (commit `bc1115d`): (1) `claude_usage.py` memanggil
  `create_subprocess_exec("claude", …)` langsung, yang tidak melakukan resolusi
  `PATHEXT` seperti shell — gagal menemukan shim `claude.cmd` hasil
  `npm install -g`. Diperbaiki dengan `shutil.which` (pola yang sama dengan
  `app/adapters/base.py:166`) lalu percabangan spawn: `.cmd`/`.bat` lewat
  `create_subprocess_shell` + `subprocess.list2cmdline`, binary lain tetap lewat
  `create_subprocess_exec`. (2) `gemini_usage.py` hard-dependency ke GNOME
  keyring (`ctypes.util.find_library("secret-1")`), selalu `None` di Windows.
  Ditambah cabang paralel `_read_keyring_token_windows()` via
  `advapi32.CredReadW` (Windows Credential Manager), `TargetName` dikonfirmasi
  empiris = `gemini:antigravity`, skema blob JSON sama dengan Linux. Dispatch
  berdasarkan `sys.platform`, Linux tidak berubah logikanya (hanya di-rename
  `_read_keyring_token_linux`). Verifikasi manual di Windows: Claude usage
  tidak lagi `claude_not_found`; Gemini usage berhasil round-trip ke
  `cloudcode-pa.googleapis.com` (return `token_expired` — token memang expired
  di mesin uji, membuktikan baca keyring + panggilan API jalan).
  **Belum diverifikasi:** `_read_keyring_token_linux()` (hasil rename murni,
  belum dijalankan ulang di Linux sungguhan setelah rename), dan kondisi
  `agy`/`claude` belum ter-install/belum login belum diuji eksplisit.

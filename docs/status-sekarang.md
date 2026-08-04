# Status proyek Choros — per 4 Agustus 2026

## Kondisi kode

- Suite: 97+ passed, nol skip (terakhir diverifikasi sebelum branch cockpit)
- ruff: `app/` bersih; `tests/` exempt ruleset S (`per-file-ignores` di pyproject.toml)
- Fase 1–5c: **kode selesai**
- Fase 5d (container per user): sengaja tidak dikerjakan — LocalLauncher cukup
- Quota display: **kode selesai** (commit `7d37900`), termasuk perbaikan
  Windows (commit `bc1115d`). Tiga section di `QuotaScreen.tsx`:
  - **Claude Code** — live via `claude --print "/usage"`, progress bar session
    + week, polling 60 detik.
  - **Gemini/Antigravity** — live via API resmi `cloudcode-pa.googleapis.com`
    memakai token OAuth dari keyring (GNOME di Linux, Credential Manager di
    Windows), polling 60 detik. Tidak pakai limit buatan user — data
    `remainingFraction` dari Google dianggap lebih akurat.
  - **OpenCode** — tetap tracking internal Choros; `token_limit` opsional
    per-agent (nullable, hanya berlaku untuk adapter `opencode`) memicu
    `MeterBar` + alert saat `is_exhausted`.
  - Tidak dikerjakan (keputusan sadar): agregasi lintas perangkat, refresh
    token otomatis Gemini (butuh `client_secret` yang embedded di binary
    `agy`), notifikasi push/webhook saat limit tercapai.

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

### B. Quota display Windows — dua item verifikasi tersisa

Fitur sudah kode-selesai dan sudah diverifikasi manual di Windows (lihat §5
`catatan-implementasi.md`), tapi dua langkah belum dijalankan:

16. `_read_keyring_token_linux()` (hasil rename murni dari refactor Windows)
    belum dijalankan ulang di Linux sungguhan untuk konfirmasi tidak ada regresi.
17. Kondisi `agy`/`claude` belum ter-install atau belum login belum diuji
    eksplisit — perilaku error di jalur itu baru dugaan, belum dikonfirmasi.

## Batas yang diketahui (keputusan sadar)

- Kunci API model mentah (`GROQ_API_KEY`, dll.) tidak terisolasi per-user.
  Solusi tanpa kode baru: user berbeda arahkan ke variabel berbeda lewat `api_key_env` di `agents.config`.
- Classifier LLM (PRD §5 v2): tidak dikerjakan. Dropdown + keyword cukup.
- Auto-answer trust lewat stdin (PRD §4 "Cadangan"): tidak dikerjakan.
  Pre-seed `ensure_trusted()` belum pernah gagal di lapangan.
- `Event.type='question'`: ada di kontrak, tidak pernah di-emit. Desain sengaja.

# choros

Meja kendali lokal yang mengorkestrasi beberapa coding agent dan model — memilih
yang paling cocok per tugas, mengelola fallback saat limit, melacak pemakaian.
Semua lewat pintu resmi tiap layanan.

> **Angle-nya:** tiap user memakai langganannya sendiri lewat channel resmi.
> Tidak membungkus kredensial, tidak pooling, tidak ada mekanisme evasi limit.

Implementasi dari [PRD-choros-v0.2.md](PRD-choros-v0.2.md) — Fase 1–3 (thin slice,
multi-agent + routing, fallback + otonom). Fase 4 (workflow) dan Fase 5 (mode tim)
ditandai opsional di PRD dan belum dikerjakan; tabel `workflows`/`workflow_steps`
sudah ada di skema.

---

## Jalankan

```bash
# 1. dependensi
uv venv --python 3.12 && uv pip install -e ".[dev]"

# 2. database
createdb choros                       # atau: docker compose up -d db
cp .env.example .env                  # isi CHOROS_SECRET_KEY dan DATABASE_URL

# 3. password dashboard (kalau dikosongkan, app jalan tanpa login — hanya aman di localhost)
.venv/bin/python -m scripts.hash_password 'passwordmu'   # → CHOROS_ADMIN_PASSWORD_HASH

# 4. agent + routing default (strategi PRD §5)
.venv/bin/python -m scripts.seed

# 5. jalan
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Buka `http://127.0.0.1:8000`. Untuk auto-restart: `deploy/choros.service`.

---

## Cara kerja satu tugas

```
Tugas → klasifikasi kategori → target berurut priority
      → cek kuota → run adapter (stream) → tangkap usage → log + update kuota
      → kalau mentok: target berikutnya (cascade)
```

Semua event dinormalkan ke bentuk seragam sebelum masuk live console:

```python
Event(type='thinking'|'tool_call'|'file_edit'|'output'|'question'|'usage'|'error'|'status', ...)
```

Jadi tampilan konsol sama saja siapa pun provider yang jalan.

## Adapter & garis ToS

| Adapter | Untuk | Tangan? | Trust di-pre-seed di |
|---|---|---|---|
| `claude_code` | langganan Claude, harness resminya | ya | `~/.claude.json` → `projects[path].hasTrustDialogAccepted` |
| `antigravity` | langganan Antigravity (`agy`) | ya | `~/.gemini/antigravity-cli/settings.json` → `trustedWorkspaces[]` |
| `opencode` | API key sendiri (Zen/Groq/Ollama/dst) | ya | permission per-run lewat `--auto`, bukan config global |
| `openai_compatible` | provider mentah | **tidak** | — |

Aturan yang ditegakkan di kode, bukan sekadar dokumentasi:

- **Langganan hanya lewat harness resminya.** Tidak ada jalur untuk menaruh
  langganan Claude ke opencode.
- **Model mentah = otak tanpa tangan.** `openai_compatible` otomatis dilewati
  untuk kategori yang butuh eksekusi kode; hanya dipakai untuk tugas teks/planning.
- **Kuota tidak ditebak-tebak.** Yang dilacak hanya konsumsi yang benar-benar
  lewat choros + status mentok dari 429. Tidak ada endpoint yang ditembak untuk
  menerka sisa kuota.

### Model gratis lewat opencode

Selain Groq dan Ollama, opencode punya gateway sendiri (**OpenCode Zen**) dengan
tier gratis yang cukup luas — kreditnya terpisah, jadi ini rung cascade yang nyata
dan bukan duplikat opencode-groq. Agent `opencode-zen` di-seed memakainya:

| Kategori | Model gratis Zen yang dipakai |
|---|---|
| `coding_complex` | `glm-5-free`, `minimax-m3-free`, `kimi-k2.5-free`, `grok-code` |
| `data_analysis` | `qwen3.6-plus-free`, `glm-5-free` |
| `draft_bulk` | `ling-3.0-flash-free`, `mimo-v2-flash-free`, `big-pickle` |
| `text_planning` | `nemotron-3-ultra-free`, `mimo-v2-pro-free` (konteks 1M) |

Setup: `opencode auth login` → pilih OpenCode Zen. Kredensialnya disimpan opencode
sendiri, choros tidak menyentuhnya.

> **`private` sengaja tidak memakai Zen.** Dokumentasi Zen menyatakan data pada
> model gratis boleh dipakai untuk melatih model. Kategori privat tetap
> ollama-saja (lokal).

Daftar model gratis Zen berubah cepat. Cek ulang lewat `/models` di dalam opencode
atau [models.dev](https://models.dev), lalu sesuaikan `ROUTES` di `scripts/seed.py`
dan tabel tier di `app/orchestrator/quality.py`.

## Fallback (cascade)

Fallback berjalan per-target, berurut `routing_rules.priority`, dan mengikuti
tiga keputusan dari PRD §6:

1. **Titik-ulang berbasis plan** — target berikutnya memulai dari artefak plan
   yang self-contained, bukan dari state internal agent (yang tak bisa dioper
   antar harness). Isi kolom "Artefak plan" saat mengirim tugas.
2. **Batas bawah kualitas** — target di bawah ambang mutu dilewati. Lebih baik
   berhenti daripada menghasilkan kode rusak yang mahal diperbaiki.
3. **Berhenti bersih** — di ujung rantai choros melapor `halted` ("semua target
   habis, plan tersimpan, jalankan ulang setelah reset"), tidak pernah loop.

Target yang kena 429 ditandai mentok + cooldown (`Retry-After` dipakai kalau ada),
per `(agent, model)` — karena limit Groq berlaku per-model.

## Mode eksekusi

| | Interaktif (default) | Otonom |
|---|---|---|
| Permission | `acceptEdits` / `--mode accept-edits` | `--dangerously-skip-permissions` / `--auto` |
| Ruang kerja | project apa adanya | **worktree git terpisah** |
| Opt-in | — | wajib eksplisit per-tugas |

Mode otonom menolak jalan di direktori yang bukan repo git, karena tidak ada yang
mengurung agent di sana — kecuali kamu mencentang "izinkan tanpa isolasi".

## Tanya-jawab dengan agent

Harness CLI dalam print-mode tidak menerima jawaban lewat stdin secara andal, jadi
follow-up dijalankan sebagai tugas lanjutan yang **me-resume sesi yang sama** di
agent yang sama (`claude --resume`, `agy --conversation`, `opencode --session`).
Konteksnya utuh, dan agent yang memegang sesi otomatis dinaikkan ke urutan pertama.
Kalau agent itu ternyata mentok, cascade normal jalan dari artefak plan.

## Test

```bash
createdb choros_test
.venv/bin/python -m pytest
```

56 test: parser tiap harness (bentuknya diambil dari output CLI sungguhan),
quality floor, routing, isolasi/trust, dan 10 skenario cascade end-to-end dengan
adapter palsu — supaya perilaku fallback teruji tanpa membakar kuota.

## Struktur

```
app/
  adapters/     kontrak Event + satu adapter per harness
  orchestrator/ routing, kuota, quality floor, isolasi, runner (cascade)
  api/          tasks (+SSE), agents, routing, quota, auth
  static/       dashboard + live console
migrations/     skema PostgreSQL
deploy/         systemd unit + nginx (SSE-safe)
docs/           catatan penyimpangan dari PRD & temuan lapangan
```

Lihat [docs/catatan-implementasi.md](docs/catatan-implementasi.md) untuk hal yang
berbeda dari PRD dan alasannya.

# PRD — choros

**Versi:** 0.2
**Nama:** choros (Yunani: paduan/ansambel yang bergerak serempak)
**Sifat:** Internal tool, self-hosted, lokal, bring-your-own-subscription
**Skala awal:** Single-user (langganan sendiri), didesain multi-tenant-ready

---

## 1. Ringkasan & Positioning

choros adalah "meja kendali" lokal yang mengorkestrasi beberapa coding agent dan model — memilih yang paling cocok per tugas, mengelola fallback saat limit, melacak pemakaian, dan (opsional) merangkai eksekusi lintas provider. Semua lewat pintu resmi tiap layanan.

**Satu kalimat positioning:** *orchestrator langganan coding-agent yang legit dan self-hosted — tiap user memakai langganannya sendiri lewat channel resmi, tanpa membungkus kredensial, tanpa pooling.*

Pembeda ini penting karena landscape ramai (9router, Helmor, Lanes, hoangsonww/AI-Agents-Orchestrator, dll.). choros tidak menang dari kebaruan kategori, melainkan dari: (a) angle legit/official-channel, (b) routing berbasis spesialisasi + fallback sadar-kuota, (c) eksekusi yang right-sized dan rapi.

**Prinsip identitas:** choros **mengarahkan** agent, bukan **menciptakan** agent. Kemampuan spawn subagent sudah dimiliki Claude Code & Antigravity; choros memanfaatkannya, tidak membangun ulang.

---

## 2. Tujuan & Non-Tujuan

**Tujuan**
- Satu antarmuka untuk mengirim tugas, melihat proses live, dan menerima hasil dari beberapa agent.
- Routing tugas → agent/model berdasarkan kategori, dengan urutan yang bisa diatur manual.
- Fallback berantai lintas-provider dan antar-model saat limit tersentuh.
- Pelacakan konsumsi per (agent, model), dengan cooldown berbasis 429.
- Tampilan interaktif setara CLI: live log reasoning + aksi agent, penerusan pertanyaan balik.
- (Opsional) workflow lintas-provider (plan→execute, role-step).
- Mudah menambah provider OpenAI-compatible baru tanpa mengubah inti orchestrator.

**Non-Tujuan (eksplisit di luar scope)**
- Pooling/sharing satu langganan ke banyak user, atau multi-akun untuk melipatgandakan kuota gratis.
- Wrapper/replay kredensial atau session langganan Pro (cookie, reverse proxy, headless UI).
- Mekanisme evasi limit apa pun (mis. tunnel + rotasi untuk mengabaikan kuota).
- Menjadi framework multi-agent penuh (CrewAI clone): mesin definisi-agent, negosiasi antar-agent, shared memory. choros mengoper artefak antar langkah — bukan membangun protokol komunikasi antar-agent.

---

## 3. Arsitektur

```
                    ┌──────────────────────────────┐
                    │   Dashboard (browser)        │
                    │  kirim tugas · LIVE CONSOLE  │
                    │  tanya-jawab · status kuota  │
                    └───────────────┬──────────────┘
                          SSE/WebSocket (stream event)
                    ┌───────────────▼──────────────┐
                    │   FastAPI backend            │
                    │  ┌────────────────────────┐  │
                    │  │ Smart Orchestrator     │  │
                    │  │ kategori → target →    │  │
                    │  │ cek kuota → run →      │  │
                    │  │ cascade fallback       │  │
                    │  └───────────┬────────────┘  │
                    └──────────────┼───────────────┘
        ┌──────────────┬───────────┼───────────────┬──────────────┐
        ▼              ▼           ▼               ▼              ▼
 ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐
 │ClaudeAdapter│ │AntigravityAd│ │OpenCodeAdapter│ │OpenAICompatAdapter   │
 │Claude Code  │ │ agy/AG SDK  │ │opencode+model │ │(raw, OTAK saja:      │
 │(otak+tangan)│ │(otak+tangan)│ │(tangan utk    │ │ tugas teks/planning) │
 │             │ │             │ │ model gratis) │ │                      │
 └────────────┘ └────────────┘ └──────┬───────┘ └──────────────────────┘
                                       ▼
                              ┌──────────────┐
                              │ Groq / Together / Ollama │
                              └──────────────┘
                    ┌──────────────────────────────┐
                    │  PostgreSQL (JSONB)          │
                    └──────────────────────────────┘
```

### Kontrak adapter (seragam, streaming-aware)

```python
class AgentAdapter(Protocol):
    async def ensure_trusted(self, project_path: str) -> None: ...   # pre-seed trust folder
    async def run(self, prompt, *, model=None, permission_mode="safe",
                  project_path=None) -> AsyncIterator[Event]: ...
    # Event = {type: 'thinking'|'tool_call'|'file_edit'|'output'|'question'|'usage'|'error', ...}
```

Setiap adapter menormalkan stream harness-nya ke format `Event` seragam, sehingga live console tampil konsisten apa pun provider yang jalan.

### Aturan adapter (garis ToS)
- **Langganan (Claude, Antigravity) → HANYA harness resminya sendiri.** Jangan pernah menaruh langganan Claude ke opencode (dilarang Anthropic).
- **API key gratis/berbayar (Groq, Together) → harness generik (opencode) untuk coding, atau OpenAICompatAdapter mentah untuk tugas teks.**
- Model mentah (Groq) = otak tanpa tangan; untuk eksekusi kode WAJIB lewat harness (opencode).

---

## 4. Model Autentikasi & Trust

**Lapisan 1 — dashboard:** login ke app sendiri (single-user: satu akun; JWT/session).

**Lapisan 2 — provider:** ditangani sekali lewat login resmi tiap CLI (`claude login`, login `agy`, API key di `agents.config`). choros tidak menyimpan/replay kredensial langganan.

**Trust folder ("are you sure you trust this folder?"):**
- **Utama — pre-seed:** `ensure_trusted(project_path)` per-adapter menuliskan trust ke config harness SEBELUM agent jalan, sehingga prompt tidak muncul. Tiap harness simpan trust di tempat berbeda → butuh logika per-adapter.
- **Cadangan — auto-answer via stream:** deteksi prompt trust yang lolos → kirim "yes" ke stdin. Rapuh; hanya jaring pengaman.

**Multi-user (fase lanjut):** isolasi credential store per-user (container per user), plus boundary arsitektural: tugas user A mustahil dirutekan ke agent user B.

---

## 5. Smart Orchestrator & Routing

Alur per tugas:
```
Tugas → [1] klasifikasi kategori → [2] ambil target berurut priority
      → [3] cek quota_windows(target) → habis? lanjut target berikut
      → [4] run adapter (stream) → [5] tangkap usage → [6] log + update kuota
```

**Klasifikasi:** v1 manual/keyword (dropdown). v2 classifier LLM murah (opsional).

**Pengurutan manual:** `routing_rules.priority` = kamu tentukan sendiri urutan pemakaian target. Target spesifik sampai level `(provider, model)`, bukan cuma provider.

**Contoh strategi default:**

| Kategori | Utama | Fallback |
|---|---|---|
| Coding kompleks / refactor | Claude Code | Antigravity |
| Analisis data / CSV / Excel | Antigravity | Claude Code |
| Draft / bulk / ringan | Groq (via opencode) | Ollama lokal |
| Privat / sensitif | Ollama lokal | — |

---

## 6. Cross-Provider Fallback (cascade)

Fallback berlaku per-step, sebagai daftar `(provider, model)` berurut priority. Contoh step eksekusi:

```
step "execute_code"
  10 → antigravity, gemini-3.5-flash
  20 → claude_code,  sonnet                 (setelah AG limit)
  30 → opencode,     groq/llama-3.3-70b   ┐
  40 → opencode,     groq/llama-3.1-8b    ├ turun mutakhir→rendah dalam Groq
  50 → opencode,     groq/qwen-...        ┘
  60 → opencode,     ollama/llama3          (lokal, benteng terakhir)
```

**Fallback ≠ pooling:** satu akun per service; tiap model/service dipakai dalam batasnya; choros berpindah ke jatah sah berikutnya. Pooling hanya jika ada "akun kedua service yang sama" untuk menggandakan kuota.

**Tiga keputusan yang bikin cascade andal (bukan sekadar tabel):**
1. **Titik-ulang berbasis plan.** Limit di tengah eksekusi → langkah diulang dari artefak *plan* yang bersih, bukan dari state internal agent (yang tak bisa dioper antar harness). Karena itu plan harus self-contained (lihat §7).
2. **Batas bawah kualitas per step.** Jangan fallback ke model di bawah ambang mutu step. Lebih baik berhenti daripada menghasilkan kode rusak yang mahal diperbaiki.
3. **Perilaku berhenti bersih.** Di ujung rantai (tanpa Ollama), choros lapor "eksekusi tertahan, semua target habis, plan tersimpan, resume saat reset" — bukan loop.

**quota_windows dilacak per (agent, model)** karena limit Groq per-model.

---

## 7. Workflow Lintas-Provider (Arah B — OPSIONAL, bukan default)

Coding biasa = **single agent, single step** (overhead ~0, setara pure coding agent). Workflow multi-step hanya dinyalakan eksplisit untuk goal besar.

**Pola inti — plan→execute:** planner matang (Claude membaca struktur codebase) → eksekusi di provider lebih murah (Antigravity / Groq via opencode). Efisien: reasoning mahal sekali di depan, eksekusi mekanis diturunkan.

**Handoff artifact = penentu sukses.** Plan harus *self-contained & terstruktur* (file mana, perubahan per file, dependency, urutan, kriteria selesai). Semakin murah/lemah eksekutor, semakin detail plan-nya. Ini tulang punggung fallback juga (§6.1).

**Role-step:** "entitas" (business / developer / devops) = role-framing (system prompt) yang ditempel ke sebuah step. choros mengoper artefak antar step (output→input), TIDAK membangun komunikasi antar-agent.

**Checkpoint (rekomendasi):** untuk eksekutor murah, sisipkan approval plan sebelum eksekusi — menangkap plan salah sebelum token eksekusi terbuang.

Skema: tabel `workflows` + `workflow_steps` (§9).

---

## 8. Mode Eksekusi, Permission & Interaktivitas

**Dua mode per-tugas:**
- **Interaktif** (default aman): kamu di depan, agent boleh bertanya/minta izin, fallback manual.
- **Otonom**: skip-permission + auto-trust + auto-fallback, jalan tanpa henti. WAJIB opt-in eksplisit + isolasi.

**Permission per harness (diteruskan choros sebagai setting per-tugas):**
- Claude Code: `--dangerously-skip-permissions`, atau `--permission-mode acceptEdits` + `--allowedTools`.
- Antigravity: `agy --dangerously-skip-permissions`.
- opencode: wildcard `{ "permission": { "*": "allow" } }`.

**Isolasi untuk mode otonom:** jalankan di worktree/container terpisah, agar "izin penuh + trust penuh" terkurung pada satu ruang kerja. Ini pembeda otomasi-berani vs otomasi-ceroboh.

**Interaktivitas setara CLI (live console):**
- Adapter streaming (`claude --output-format stream-json`, jalur serupa opencode/AG) → normalisasi ke `Event` → alirkan ke dashboard via SSE/WebSocket.
- Dashboard menampilkan live log: `thinking`, `tool_call`, `file_edit`, `output` — cermin dari terminal.
- Pertanyaan balik agent (`Event.type=question`) → tampil di dashboard → jawaban dialirkan ke stdin.
- Catatan: granularitas "thinking" beda antar harness; normalisasi event menjaga tampilan konsisten.

**Tegangan yang harus dijaga:** mode interaktif (agent bertanya) vs auto-fallback bisa saling injak → dipisah lewat mode per-tugas di atas.

---

## 9. Skema PostgreSQL

```sql
CREATE TABLE users (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agents (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  adapter_type VARCHAR(32) NOT NULL,   -- 'claude_code','antigravity','opencode','openai_compatible'
  base_url TEXT,
  default_model VARCHAR(64),
  config JSONB DEFAULT '{}',           -- api_key ref, permission defaults, trust config, dll.
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE routing_rules (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category VARCHAR(32) NOT NULL,
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),                   -- target spesifik sampai model
  priority INT DEFAULT 100
);

CREATE TABLE workflows (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workflow_steps (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id INT NOT NULL REFERENCES workflows(id),
  step_order INT NOT NULL,
  role_prompt TEXT,                    -- 'planner','business','developer','devops'
  targets JSONB DEFAULT '[]',          -- daftar (agent,model) berurut utk cascade step ini
  quality_floor VARCHAR(64),           -- batas bawah model (§6.2)
  requires_approval BOOLEAN DEFAULT FALSE
);

CREATE TABLE task_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),
  category VARCHAR(32),
  mode VARCHAR(16),                    -- 'interactive','autonomous'
  status VARCHAR(16),                  -- 'ok','rate_limited','error','halted'
  usage JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tasklogs_agent_time ON task_logs (agent_id, created_at);

CREATE TABLE quota_windows (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),                   -- per-model (limit Groq per-model)
  window_type VARCHAR(16),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  tokens_used INT DEFAULT 0,
  is_exhausted BOOLEAN DEFAULT FALSE
);
```

---

## 10. Usage Monitoring

- Sumber: field `usage` dari tiap adapter (stream event `usage` / `--output-format json`).
- Akumulasi ke `quota_windows` per (agent, model, window).
- 429/limit → `is_exhausted=true` + set cooldown.
- **Catatan jujur:** langganan tidak mengekspos "sisa X pesan" presisi. Yang dicapai: consumption tracking + deteksi mentok. Jangan menembak endpoint untuk menebak sisa (itu abuse).

---

## 11. Token & Cost Model (kesadaran trade-off)

- **Single-agent (default):** overhead token ~0 vs pure coding agent (routing/kuota/log = logika lokal).
- **Workflow N-step (opsional):** bisa 2–4× token karena banyak panggilan + konteks berulang.
- **Nuansa penting:** total token naik ≠ kuota mahal terkuras. Routing yang benar menaruh langkah boros-ringan di free-tier, menyimpan Claude/AG untuk yang butuh kualitas → token di kuota mahal bisa justru turun.
- **Mitigasi:** multi-step bukan default; oper ringkasan/artefak antar step (bukan transkrip); prompt caching; retry-dari-awal hanya untuk tugas pendek; penempatan kategori.

---

## 12. Tech Stack

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Backend | FastAPI (Python 3.12) | Async-native; subprocess/SDK + streaming; ringan. |
| Streaming ke UI | SSE / WebSocket | Live console real-time. |
| Subprocess/SDK | asyncio.subprocess / Agent SDK / AG SDK | Menjalankan CLI/SDK, baca stream. |
| DB | PostgreSQL + JSONB | Metadata usage semi-terstruktur. |
| DB access | SQLAlchemy async + asyncpg | Matang. |
| Frontend | Vanilla JS / light SPA + live console | Internal tool; console + kuota + log. |
| Runtime | docker-compose (FastAPI+PG+Nginx) | Konsisten lintas distro; sekali `up`. |
| Proses | systemd + Nginx reverse proxy | Untuk app sendiri (legit); auto-restart. |

**Stack tooling minimal:** Claude Code + Antigravity (`agy`) + satu harness generik (opencode) + API key gratis (Groq) yang dicolok ke opencode + (opsional) Ollama.

---

## 13. Roadmap Bertahap

Asumsi ~2–3 jam/sesi malam; tiap fase jalan end-to-end.

**Fase 1 — thin slice (≈2–3 malam).** FastAPI + PG + ClaudeAdapter streaming + live console dasar. Satu tugas → tampil proses live → hasil → log. Semua tabel ber-`user_id` (satu user).

**Fase 2 — multi-agent + routing (≈1 akhir pekan).** AntigravityAdapter + OpenCodeAdapter (Groq) + OpenAICompatAdapter. Routing rule-based + pengurutan manual + dashboard kuota. `ensure_trusted()` per-adapter + permission per-tugas.

**Fase 3 — fallback + otonom (≈1 akhir pekan).** Cross-provider cascade + penurunan model + cooldown 429 + mode interaktif/otonom + isolasi worktree. Tiga keputusan §6.

**Fase 4 — workflow (opsional).** Plan→execute + role-step + checkpoint approval. Tabel workflows/steps.

**Fase 5 — mode tim (opsional).** Auth multi-user + isolasi credential per-user (container) + boundary task⇒agent milik user.

---

## 14. Risiko & Catatan Jujur

- **Landscape ramai.** Kelayakan sebagai produk orisinal rendah; sebagai portfolio/belajar tinggi — asalkan pegang pembeda (legit angle) + eksekusi rapi. Kalau tujuan cuma fungsinya, pakai 9router/LiteLLM + parallel runner lebih hemat.
- **Handoff artifact = make-or-break** untuk plan→execute dan fallback. Plan lemah → eksekusi/fallback kacau.
- **Kuota bukan meteran presisi.**
- **Boundary multi-user** paling rawan (pooling). Jaga arsitektural.
- **skip-permission + auto-trust** = agent bisa apa saja tanpa konfirmasi. Dikurung lewat opt-in per-tugas + isolasi, bukan default global.
- **Provider drift.** Format stream/flag harness berubah antar versi → normalisasi event + logika trust per-adapter mengisolasi dampak.

---

## 15. Learning Path (yang memblokir dulu)

1. **FastAPI async + streaming (SSE/WebSocket)** — fondasi live console. ~1 hari usable. *(wajib sebelum mulai)*
2. **Claude Agent SDK / `claude -p --output-format stream-json`** — baca event stream + usage. ~½ hari. *(wajib sebelum mulai)*
3. **PostgreSQL + JSONB + SQLAlchemy async** — ~½ hari.
4. **opencode config (Groq, permission, model switch)** — ~2 jam, sambil jalan.
5. **Antigravity `agy` (flags, trust, stream)** — ~2 jam, sambil jalan.

Wajib dipahami sebelum mulai: #1 dan #2. Sisanya dipelajari sambil membangun.

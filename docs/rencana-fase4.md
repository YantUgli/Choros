# Rencana Fase 4 — workflow plan→execute

Ditulis 1 Agustus 2026, dari pembacaan graf kode `codebase-memory` yang di-index
ulang di atas working tree Fase 3.5c (595 node / 3145 edge, bukan dari commit
`3e163ab` yang sudah basi).

Dokumen ini melanjutkan [rencana-penutupan-fase35b.md](rencana-penutupan-fase35b.md)
dan menurunkan [rencana-pengembangan.md §Fase 4](rencana-pengembangan.md) menjadi
kerjaan yang bisa langsung dieksekusi.

> **Lanjutan:** seluruh item Fase 4a–4d di §10 sudah dikerjakan; backend lengkap
> dan teruji (`69 passed`), tapi UI Fase 4d tidak terhubung ke API. Status per
> item dan sisa kerjaannya ada di
> [rencana-penutupan-fase4.md](rencana-penutupan-fase4.md).

Kesimpulan singkatnya: fondasinya memang sudah ada seperti klaim rencana induk,
tapi ada **empat lubang di skema dan kontrak** yang tidak terlihat kalau cuma
membaca daftar fiturnya — dan salah satunya (`status VARCHAR(16)`) akan meledak
di runtime pada hari pertama checkpoint approval dinyalakan.

---

## 1. Posisi dan prasyarat

| Hal | Status |
|---|---|
| Fase 3.5 | ✅ boleh di-commit |
| Fase 3.6 item 5 & 8 | ❌ belum — **tidak memblokir Fase 4** (itu prasyarat Fase 5) |
| Suite | 63 passed, nol skip |
| `ruff` | belum terpasang |

Satu penyesuaian terhadap rencana induk: **kerjakan Fase 3.6 item 5 (fixture
user-kedua) sebelum Fase 4b**, bukan sesudahnya. Fase 4b menambahkan permukaan
kepemilikan baru (`_owned_workflow`), dan menulis boundary test-nya dengan
fixture yang sudah ada jauh lebih murah daripada menambalnya belakangan. Ongkos
tambahannya nyaris nol karena test-nya harus ditulis juga.

---

## 2. Fondasi yang benar-benar sudah ada

Diverifikasi lewat graf, bukan dari ingatan:

| Fondasi | Bukti |
|---|---|
| Plan sebagai artefak handoff | `_rebuild_prompt` (`runner.py:518-533`), dipanggil dari `_execute` saat `index > 0` |
| `quality_floor` per-tugas | `Task.quality_floor`, dipakai `meets_floor` di loop cascade |
| Cascade bisa dipakai ulang | loop `for index, target in enumerate(targets)` — murni fungsi dari `targets`/`prompt`/`floor` |
| Tabel workflow | `Workflow` (`models.py:60-68`), `WorkflowStep` (`models.py:71-80`), DDL di `migrations/001_init.sql:34-49` |
| Pola CRUD + boundary | `app/api/agents.py` (122 baris): `_owned_agent:109`, `_owned_rule:116`, 10 handler |
| Migrasi idempoten | `apply_migrations()` (`db.py:94-99`) glob `*.sql` terurut — tinggal jatuhkan `002_*.sql` |

Kode workflow itu sendiri: **nol**. Tidak ada satu pun `CALLS` masuk ke
`Workflow` / `WorkflowStep` di seluruh graf.

---

## 3. Empat lubang yang harus diputuskan sebelum menulis kode

### 3.1 `status VARCHAR(16)` tidak muat `awaiting_approval`

`migrations/001_init.sql:62` dan `models.py` sama-sama `VARCHAR(16)` / `String(16)`.
`"awaiting_approval"` panjangnya **17 karakter**. Postgres akan melempar
`StringDataRightTruncation` — bukan warning, bukan pemotongan diam-diam.

Ini kegagalan yang muncul di jalur paling ramai fitur ini, dan mudah lolos dari
review karena batasnya hanya terlihat di DDL.

**Keputusan:** lebarkan ke `VARCHAR(32)` di `002_*.sql` (`ALTER TABLE tasks ALTER
COLUMN status TYPE VARCHAR(32)`) dan samakan modelnya. Jangan akali dengan nama
status yang lebih pendek — status run nanti (`awaiting_approval`, `step_failed`)
akan menabrak batas yang sama lagi.

### 3.2 `workflow_steps` tidak punya kolom `category`

Gerbang tangan-vs-otak di `_execute:227` bertumpu pada `category`:

```python
needs_hands = category not in BRAIN_ONLY_CATEGORIES   # {"text_planning"}
```

`WorkflowStep` tidak punya `category`. Tanpa itu, step planner (yang justru harus
boleh dijalankan model mentah tanpa tangan — inti penghematan plan→execute) akan
mewarisi kategori tugas induk dan tersaring habis oleh `adapter_can_execute`.

Skema PRD §9 memang tidak mencantumkannya; ini kekurangan PRD, bukan kesalahan
implementasi.

**Keputusan:** tambahkan `category VARCHAR(32)` ke `workflow_steps` di `002_*.sql`,
nullable, default ke kategori tugas induk kalau kosong.

### 3.3 Satu Task per step, bukan satu Task multi-step

Dua pilihan:

- **(a) Satu Task, runner-nya me-loop step di dalam.** Lebih sedikit baris.
- **(b) Satu Task per step, digabung oleh `workflow_runs`.** Lebih banyak baris,
  tapi seluruh mesin yang sudah ada ikut gratis.

**Rekomendasi: (b)**, dan alasannya bukan estetika:

1. **Semaphore.** `_guarded` (`runner.py:130-152`) memegang slot konkurensi
   selama `_execute` jalan. Dengan (a), tugas yang menunggu approval user akan
   **menahan satu dari tiga slot** selama berjam-jam. Dengan (b), step task
   selesai, slot lepas, approval ditunggu di DB.
2. **Console, log, cancel, review.** SSE (`/stream`), `/logs`, `/cancel`,
   `/diff`+`/merge`+`/discard` semuanya ber-key `task_id`. Dengan (b) semuanya
   jalan per-step tanpa satu baris pun perubahan.
3. **Boundary.** `_owned_task` sudah menjaga enam endpoint. Step task ikut
   terjaga otomatis.

Harga yang dibayar: UI butuh tampilan run yang mengelompokkan step task
(§7), dan ada satu tabel baru.

### 3.4 Workspace harus dibagi antar step

Ini konsekuensi (b) yang paling mudah terlewat. `prepare_workspace`
(`isolation.py:51`) membuat worktree bernama `task-{task_id}` untuk **setiap**
tugas otonom. Kalau step 2 adalah Task terpisah, ia akan mendapat worktree
kosongnya sendiri — dan mengeksekusi plan step 1 di direktori yang tidak memuat
kerja step 1 sama sekali. Workflow-nya akan "jalan" dan menghasilkan sampah.

Presedennya sudah ada dan benar: `reply_to_task` (`tasks.py:117-160`) mengoper
`project_path=parent.workspace_path`. Tapi itu belum cukup di mode otonom, karena
`prepare_workspace` tetap membuat worktree baru dari path itu.

**Keputusan:** run yang memiliki worktree, bukan step.

- Kolom baru `tasks.owns_workspace BOOLEAN DEFAULT TRUE`.
- Step pertama membuat worktree seperti biasa (`owns_workspace = TRUE`).
- Step berikutnya: `workspace_path` diisi dari run, `owns_workspace = FALSE`.
- Di `_execute`: kalau `owns_workspace` false dan `workspace_path` terisi,
  lewati `prepare_workspace` dan bangun `Workspace(path=..., isolated=True,
  branch=f"choros/task-{step1_id}")` langsung.
- `cleanup_workspace` di blok `finally` hanya boleh jalan kalau `owns_workspace`.

Catatan yang berkaitan: panggilan `cleanup_workspace` yang ditambahkan di Fase
3.5c (`runner.py:341-343`) saat ini **no-op** — jalur non-otonom selalu
menghasilkan `isolated=False`. Jangan dihapus, tapi jangan pula dianggap sebagai
perlindungan yang sudah bekerja; kondisi `owns_workspace` di atas yang akan
membuatnya benar-benar berarti.

---

## 4. Fase 4a — refactor `_run_cascade`

**Perkiraan setengah sesi. Tidak boleh mengubah perilaku sama sekali.**

`_execute` sekarang `runner.py:154-343` — 190 baris, **complexity 21, cognitive
46, 20 callee**. Ia mencampur lima hal:

| Baris | Urusan | Nasib |
|---|---|---|
| 154-185 | muat task, ekstrak field, angkat `pinned_agent_id` | tetap di `_execute` |
| 187-204 | umumkan target, guard target kosong | tetap di `_execute` |
| 206-225 | siapkan workspace, simpan `workspace_path` | tetap di `_execute` |
| 231-339 | **loop cascade** | pindah ke `_run_cascade` |
| 331-343 | halted + `finally` cleanup | tetap di `_execute` |

### Tanda tangan

Sketsa rencana induk (`_run_cascade(targets, prompt, floor) -> Attempt`) perlu
dua koreksi setelah melihat isinya:

1. Loop juga butuh `user_id`, `category`, `mode`, `permission_mode`, `workspace`,
   `plan_artifact`, `resume_session_id` — tujuh nilai yang **tidak berubah antar
   step**. Kalau dijadikan kwarg semua, tanda tangannya sepuluh parameter.
2. Loop sekarang memanggil `_finish` sendiri di dua tempat (sukses dan ujung
   rantai). Untuk bisa dipakai per-step, ia **tidak boleh** memutuskan nasib
   tugas — pemanggil yang tahu apakah ini step terakhir.

Jadi:

```python
@dataclass(slots=True)
class RunContext:
    """Nilai yang tetap sepanjang satu tugas, apa pun step-nya."""
    task_id: int
    user_id: int
    category: str
    mode: str
    permission_mode: str
    workspace: Workspace
    plan_artifact: str | None = None
    resume_session_id: str | None = None


@dataclass(slots=True)
class CascadeResult:
    attempt: Attempt | None      # attempt yang sukses; None kalau rantai habis
    skipped: list[str]


async def _run_cascade(
    self,
    ctx: RunContext,
    *,
    targets: list[Target],
    prompt: str,
    quality_floor: str | None,
) -> CascadeResult:
```

Yang berubah antar step tetap eksplisit di tanda tangan (`targets`, `prompt`,
`quality_floor`) — persis maksud rencana induk — tanpa sepuluh kwarg.

### Aturan refactor

- `_run_cascade` **tidak memanggil** `_finish`. Ia mengembalikan `CascadeResult`.
- `_run_cascade` **tetap memanggil** `_emit` dan `_log_attempt`: keduanya
  per-attempt dan tidak tahu-menahu soal nasib tugas.
- `_execute` sesudahnya: kalau `result.attempt` ada → `_finish(status="ok", ...)`;
  kalau tidak → emit pesan "eksekusi tertahan" + `_finish(status="halted")`.
- `_rebuild_prompt` tetap dipanggil dari dalam `_run_cascade` untuk `index > 0`.
  Ini fallback **di dalam** step, beda urusan dengan handoff antar step (§6).

### Bukti bahwa refactornya benar

`tests/test_cascade.py` (sepuluh skenario) **tidak boleh disentuh satu baris pun**
dan harus tetap hijau. Kalau ada test yang perlu diubah, refactornya bocor jadi
perubahan perilaku — batalkan, jangan tambal test-nya.

Kerjakan ini **sebelum** apa pun di Fase 4b–4d, dan commit terpisah.

---

## 5. Fase 4b — skema + CRUD

**Perkiraan 1 sesi.**

### `migrations/002_workflow.sql`

```sql
ALTER TABLE tasks ALTER COLUMN status TYPE VARCHAR(32);          -- §3.1
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS category VARCHAR(32);  -- §3.2

CREATE TABLE IF NOT EXISTS workflow_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id INT NOT NULL REFERENCES workflows(id),
  user_id INT NOT NULL REFERENCES users(id),
  goal TEXT NOT NULL,                    -- prompt awal user
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  current_step INT NOT NULL DEFAULT 0,
  project_path TEXT,
  workspace_path TEXT,                   -- worktree milik run (§3.4)
  mode VARCHAR(16) NOT NULL DEFAULT 'interactive',
  allow_unisolated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_run_id BIGINT REFERENCES workflow_runs(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS step_order INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owns_workspace BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks (workflow_run_id, step_order);
```

Semua idempoten, sesuai kontrak `apply_migrations()`. Ingat menambahkan
`workflow_runs` ke `TABLES` di `tests/conftest.py:18` — **sebelum** `workflows`,
karena TRUNCATE-nya berurut.

### API `app/api/workflows.py`

Tiru `agents.py` baris-per-baris; itu pola yang sudah terbukti.

| Method | Path | Catatan |
|---|---|---|
| GET | `/api/workflows` | milik user saja |
| POST | `/api/workflows` | nama + daftar step sekaligus |
| PUT | `/api/workflows/{id}` | ganti seluruh daftar step |
| DELETE | `/api/workflows/{id}` | tolak kalau ada run aktif |
| POST | `/api/workflows/{id}/run` | buat `workflow_run`, mulai step 1 |
| GET | `/api/workflow-runs/{id}` | status + daftar step task |
| POST | `/api/workflow-runs/{id}/approve` | §7 |
| POST | `/api/workflow-runs/{id}/reject` | §7 |

Daftarkan routernya di `app/main.py:67`, sebaris dengan yang lain.

### Satu jebakan keamanan yang khas fitur ini

`workflow_steps.targets` adalah JSONB berisi **`agent_id` mentah**. Berbeda dari
`routing_rules` yang punya foreign key, JSONB tidak divalidasi siapa pun.

Kalau CRUD menerimanya apa adanya, user A bisa menulis `agent_id` milik user B ke
dalam step-nya dan orchestrator akan menjalankan agent itu — melewati
`_owned_agent` sepenuhnya, karena jalur eksekusi tidak pernah lewat endpoint
agent.

**Validasi wajib di `POST`/`PUT`:** setiap `agent_id` di `targets` harus
di-resolve lewat `_owned_agent` sebelum disimpan. Ini bukan kehati-hatian
berlebih — ini satu-satunya tempat pemeriksaannya bisa terjadi.

### Resolver target per-step

Fungsi baru di `app/orchestrator/router.py`, bersebelahan dengan
`resolve_targets` (`router.py:62-74`):

```python
async def resolve_step_targets(session, step: WorkflowStep, fallback_category: str) -> list[Target]:
    """targets JSONB step; kalau kosong, jatuh ke routing rule kategori step."""
```

Urutan di JSONB **adalah** urutan cascade — `priority` diambil dari indeks.

---

## 6. Fase 4c — runner multi-step + handoff

**Perkiraan 1 sesi.**

### Siapa yang memajukan run

Modul baru `app/orchestrator/workflow.py` dengan satu titik keputusan:

```python
async def advance_run(run_id: int) -> None:
    """Tentukan apa yang terjadi setelah sebuah step task mencapai status terminal."""
```

Dipanggil dari tiga tempat, dan hanya tiga:

1. `_execute`, setelah `_finish` untuk task yang punya `workflow_run_id`.
2. Endpoint `/approve` (§7).
3. `lifespan` saat startup — untuk run yang step task terakhirnya sudah terminal
   tapi run-nya masih `running` (server mati di antara dua step).
   `recover_interrupted_tasks()` (`main.py:29`) sudah menangani task hanging;
   run yang mandek adalah mode kegagalan baru yang harus ikut ditutup, bukan
   diasumsikan tidak terjadi.

Logika `advance_run`:

- step gagal (`halted`/`error`) → run `halted`, berhenti. **Tidak ada retry
  otomatis lintas step** — cascade sudah retry di dalam step; mengulang step
  penuh berarti membakar token dua kali untuk kegagalan yang sama (PRD §11).
- step sukses & masih ada step berikutnya:
  - kalau step berikutnya `requires_approval` → run `awaiting_approval`, berhenti.
  - kalau tidak → buat step task berikutnya dan `runner.start()`.
- tidak ada step berikutnya → run `ok`, `finished_at` diisi.

### Artefak handoff

Ini yang PRD §7 sebut *make-or-break*, dan tempat paling mudah untuk salah.

Yang **tidak** boleh dioper: transkrip, event log, output mentah panjang.
Yang dioper: `attempt.output` step N, disimpan ke **`plan_artifact` step task
N+1**.

Pilihan itu punya efek samping yang bagus dan gratis: `_rebuild_prompt` sudah
membaca `plan_artifact` untuk fallback **di dalam** step. Jadi kalau target
pertama step 2 mati di tengah jalan, target kedua otomatis mengulang dari plan
step 1 — tanpa kode tambahan.

Prompt step N+1 dirakit oleh fungsi baru di `runner.py`, tetangga
`_rebuild_prompt`:

```python
def _handoff_prompt(role_prompt: str | None, goal: str, artifact: str) -> str:
```

Urutannya: role-framing → goal asli user → artefak step sebelumnya. Role-framing
di depan karena ia mengubah cara seluruh sisanya dibaca.

Untuk step planner, tempelkan template keluaran yang tetap (file mana, perubahan
per file, dependency, urutan, kriteria selesai — PRD §7). Semakin murah
eksekutornya, semakin plan itu harus lengkap. Simpan template ini sebagai
konstanta modul, bukan string inline: ia akan sering disetel ulang.

---

## 7. Fase 4d — checkpoint approval + UI

**Perkiraan 1 sesi.**

### Alur

1. Step dengan `requires_approval = TRUE` → setelah step sebelumnya sukses, run
   berhenti di `awaiting_approval` (§3.1: butuh `VARCHAR(32)`).
2. UI menampilkan artefak step sebelumnya (plan) + tombol Setujui / Tolak.
3. `POST /approve` → `advance_run` membuat step task berikutnya.
   `POST /reject` → run `halted`.

Tidak ada slot konkurensi yang tertahan selama menunggu (§3.3) — inilah bayaran
dari keputusan "satu Task per step".

`/approve` boleh menerima artefak yang **sudah disunting** user sebagai body
opsional. Ini murah (satu field) dan menutup kasus paling umum: plan-nya 90%
benar, user cuma ingin membetulkan satu urutan sebelum token eksekusi terbakar.

### UI

`app/static/app.js` 541 baris, pola yang ada: `loadTasks:206`, `selectTask:223`,
`openStream:160`, `loadRouting:368`, `loadAgents:286`, `boot:526`.

Yang ditambahkan:

- `loadWorkflows()` + editor step — cerminan `loadRouting()`.
- `loadRun(runId)`: daftar step, status per step, step aktif.
- Klik step → `selectTask(stepTaskId)` → konsol SSE yang sudah ada langsung
  jalan. Tidak ada SSE baru yang perlu ditulis.
- Panel approval: artefak (textarea, bisa disunting) + dua tombol.

Tambahkan tab di `app/static/index.html` (183 baris) mengikuti tab yang sudah ada.

---

## 8. Test

| # | Test | File |
|---|---|---|
| 1 | Sepuluh skenario cascade lama tetap hijau **tanpa diubah** | `tests/test_cascade.py` |
| 2 | `_run_cascade` mengembalikan `attempt=None` saat semua target habis, dan tidak menyentuh status task | `tests/test_cascade.py` (baru) |
| 3 | Boundary `_owned_workflow`: user B → 404 di GET/PUT/DELETE/run | `tests/test_api.py` |
| 4 | `targets` JSONB berisi `agent_id` milik user lain → ditolak saat POST | `tests/test_api.py` |
| 5 | Run 2 step: output step 1 mendarat di `plan_artifact` step 2 | `tests/test_workflow.py` (baru) |
| 6 | `requires_approval`: run berhenti `awaiting_approval`, **task step 2 belum dibuat**; setelah `/approve` baru dibuat | `tests/test_workflow.py` |
| 7 | Step 2 jalan di `workspace_path` yang sama dengan step 1, dan tidak membuat worktree kedua | `tests/test_workflow.py` |
| 8 | Step gagal → run `halted`, step berikutnya tidak pernah dibuat | `tests/test_workflow.py` |

Nomor 1 adalah jaring pengaman Fase 4a. Nomor 6 dan 7 menguji dua keputusan §3.3
dan §3.4 — keduanya jenis kesalahan yang tidak melempar exception, cuma
menghasilkan pekerjaan yang salah diam-diam.

---

## 9. Risiko

| Risiko | Mitigasi |
|---|---|
| Token 2–4× (PRD §11) | Workflow bukan default. Oper artefak, bukan transkrip. Tidak ada retry lintas step (§6). |
| Plan lemah → eksekusi kacau | Template keluaran planner yang tetap (§6). Checkpoint approval untuk eksekutor murah. |
| Run mandek kalau server mati antar step | `advance_run` dipanggil dari `lifespan` (§6) |
| Refactor 4a diam-diam mengubah perilaku | `test_cascade.py` tidak boleh disentuh; commit terpisah |
| `targets` JSONB melewati boundary | Validasi `_owned_agent` di CRUD (§5) |

---

## 10. Urutan kerja

| # | Kerjaan | File | Sesi |
|---|---|---|---|
| 0 | Commit Fase 3.5 apa adanya | — | — |
| 1 | Fase 3.6 item 5 — fixture user-kedua | `tests/conftest.py` | 0.25 |
| 2 | **4a** — `RunContext`, `CascadeResult`, `_run_cascade` | `app/orchestrator/runner.py` | 0.5 |
| 3 | **4b** — `002_workflow.sql` + model + `TABLES` conftest | `migrations/`, `app/models.py`, `tests/conftest.py` | 0.25 |
| 4 | **4b** — `resolve_step_targets` | `app/orchestrator/router.py` | 0.25 |
| 5 | **4b** — CRUD + `_owned_workflow` + validasi `targets` | `app/api/workflows.py`, `app/main.py`, `app/schemas.py` | 0.5 |
| 6 | **4b** — test 3 & 4 | `tests/test_api.py` | 0.25 |
| 7 | **4c** — `advance_run` + step task chaining | `app/orchestrator/workflow.py`, `runner.py` | 0.5 |
| 8 | **4c** — `_handoff_prompt` + template planner | `app/orchestrator/runner.py` | 0.25 |
| 9 | **4c** — workspace bersama (`owns_workspace`) | `runner.py`, `isolation.py` | 0.25 |
| 10 | **4c** — test 5, 7, 8 | `tests/test_workflow.py` | 0.5 |
| 11 | **4d** — approval endpoint + status run | `app/api/workflows.py` | 0.25 |
| 12 | **4d** — test 6 | `tests/test_workflow.py` | 0.25 |
| 13 | **4d** — UI workflow + run + panel approval | `app/static/app.js`, `index.html`, `style.css` | 0.75 |

Total ≈ 4,75 sesi — di atas perkiraan rencana induk (2–3), dan selisihnya nyaris
seluruhnya jatuh di §3: `workflow_runs`, `owns_workspace`, kolom `category`, dan
validasi JSONB tidak ada di rencana induk karena baru terlihat setelah skema dan
`_execute` dibaca berdampingan.

Kalau perlu dipotong, yang paling aman ditunda adalah **item 13 (UI)** — API-nya
bisa dipakai lewat `curl` dulu. Yang **tidak boleh** ditunda adalah item 2 dan 9:
item 2 karena semua sisanya bertumpu padanya, item 9 karena tanpa itu workflow
otonom menghasilkan pekerjaan yang salah tanpa error apa pun.

---

## 11. Yang sengaja tidak dikerjakan di Fase 4

- **Step paralel.** PRD §7 tidak memintanya, dan `advance_run` yang linear jauh
  lebih mudah dibuktikan benar.
- **Komunikasi antar-agent.** PRD §7 eksplisit: choros mengoper artefak, bukan
  membangun percakapan antar agent.
- **Retry lintas step.** Lihat §6.
- **Workflow bawaan hasil seed.** Tunggu sampai ada satu workflow yang benar-benar
  terpakai sehari-hari, baru jadikan template.

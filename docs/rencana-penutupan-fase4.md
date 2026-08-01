# Rencana penutupan Fase 4

Ditulis 1 Agustus 2026, dari pembacaan working tree di atas commit `3e163ab`
setelah seluruh item Fase 4a–4d dikerjakan, plus satu kali menjalankan suite
penuh (`69 passed in 235.59s`, nol skip).

Dokumen ini melanjutkan [rencana-fase4.md](rencana-fase4.md): yang itu menetapkan
*apa yang harus dibangun di Fase 4*, yang ini mencatat *apa yang sudah jadi, apa
yang tertulis tapi tidak berfungsi, dan apa syarat minimum sebelum Fase 4 boleh
dinyatakan selesai*.

Kesimpulan singkatnya: **backend Fase 4 lengkap dan teruji; UI-nya tertulis penuh
tapi tidak satu pun terhubung ke API.** Enam kontrak antara `app.js` dan
`app/api/workflows.py` tidak cocok. Semuanya lolos karena tidak ada satu pun test
yang menyentuh UI, dan tiga dari enam gagal dengan cara yang tidak menghasilkan
error di server — hanya panel kosong di browser.

---

## 1. Yang sudah tuntas — jangan disentuh

Diverifikasi dari kode, bukan dari daftar rencana.

| Fase | Item | Bukti |
|---|---|---|
| 3.5 (1-6) | recovery, worktree lifecycle, semaphore, pisah cooldown, batching, panel percobaan | ✅ semua |
| 3.5b (1-6) | payload dict `_emit`, port 5433, lubang replay, GC worktree, `seed --reconcile`, posisi antrean | ✅ semua |
| 3.5c (1-4) | `from typing import Any` (`isolation.py:18`), off-by-one (`runner.py:156`), `cleanup_workspace(..., remove=True)` (`runner.py:314`), `import argparse` naik | ✅ semua |
| 3.6 (6,7,8) | boundary `_owned_task` 404, `_owned_agent`/`_owned_rule`, dedup `seq` | ✅ `tests/test_api.py` |
| 4a | `RunContext`, `CascadeResult`, `_run_cascade` (`runner.py:65,78,331`) | ✅ 10 skenario `test_cascade.py` hijau tanpa diubah |
| 4b | `002_workflow.sql`, `resolve_step_targets` (`router.py:77`), CRUD + `_owned_workflow` + validasi `agent_id` JSONB | ✅ |
| 4c | `advance_run` (`workflow.py:60`), `_handoff_prompt`, `PLANNER_OUTPUT_TEMPLATE`, `owns_workspace`, `recover_interrupted_runs` | ✅ 4 test di `tests/test_workflow.py` |
| 4d | endpoint `/approve` + `/reject` | ✅ backend saja |

**Aturan mutlak untuk seluruh pekerjaan di dokumen ini:** `tests/test_cascade.py`
dan `tests/test_workflow.py` tidak boleh diubah satu baris pun. Kalau ada yang
merah setelah patch, patch-nya yang salah.

---

## 2. Blocker — UI Fase 4d tidak terhubung ke API

Enam mismatch. A1–A4 membuat fitur mati total; A5 dan A6 membuatnya menampilkan
data salah. Semua patch di bawah ditulis lengkap supaya bisa langsung ditempel.

### A1 — `GET /api/workflows/{id}` tidak ada

**Bukti:** `app.js:744` (`editWorkflow`) memanggil `api('/api/workflows/${id}')`
lalu membaca `wf.steps`. Route yang terdaftar di `app/api/workflows.py` hanya:
`GET /workflows`, `POST /workflows`, `PUT /workflows/{id}`,
`DELETE /workflows/{id}`, `GET /workflows/{id}/steps`, `POST /workflows/{id}/run`.
Tidak ada GET tunggal → **404**, dan `WorkflowOut` (`schemas.py:131`) hanya punya
`id`/`name`/`created_at` — tidak ada `steps`.

Akibat: tombol **Ubah** pada setiap kartu workflow selalu gagal.

**Keputusan:** tambah endpoint GET tunggal yang mengembalikan workflow **beserta
step-nya**. Jangan ubah `WorkflowOut` (dipakai `list`/`POST`/`PUT`), tapi turunkan
skema baru.

**Patch 1 — `app/schemas.py`**, tepat setelah `class WorkflowOut` (baris 131-135):

```python
class WorkflowDetailOut(WorkflowOut):
    steps: list[WorkflowStepOut] = Field(default_factory=list)
```

**Patch 2 — `app/api/workflows.py`**, sisipkan sebelum
`@router.get("/workflows/{workflow_id}/steps")` (baris 164):

```python
@router.get("/workflows/{workflow_id}", response_model=WorkflowDetailOut)
async def get_workflow(
    workflow_id: int, user: CurrentUser, session: DbSession
) -> WorkflowDetailOut:
    wf = await _owned_workflow(workflow_id, user, session)
    steps = (
        await session.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == wf.id)
            .order_by(WorkflowStep.step_order)
        )
    ).scalars().all()
    return WorkflowDetailOut(
        id=wf.id,
        name=wf.name,
        created_at=wf.created_at,
        steps=[WorkflowStepOut.model_validate(s) for s in steps],
    )
```

Tambahkan `WorkflowDetailOut` ke blok impor `from app.schemas import (...)`
(baris 12-18).

### A2 — `WorkflowRunOut` tidak punya `steps`, panel run mati sebelum sempat render

**Bukti:** `app.js:790` menjalankan `run.steps.forEach(...)`. `WorkflowRunOut`
(`schemas.py:138-149`) tidak punya `steps`. `loadRun` melempar
`TypeError: run.steps is undefined`, ditangkap `catch` di `app.js:822` dan cuma
memunculkan toast. **Seluruh panel Status Run tidak pernah terisi**, termasuk
untuk run yang berjalan normal.

`app.js:810` juga membaca `run.pending_approval_step_id` yang tidak pernah ada.

**Keputusan:** endpoint `GET /workflow-runs/{id}` mengembalikan skema turunan
berisi daftar step + task-nya. Jangan ubah `WorkflowRunOut` — ia dipakai sebagai
`response_model` `POST /workflows/{id}/run` yang mengembalikan objek ORM langsung.

Perhatikan cara menghitung step yang menunggu approval. `advance_run`
(`workflow.py:134-137`) menyetel `run.current_step = current_order`, yaitu
step_order step yang **baru selesai** — bukan yang menunggu. Jadi:

- step yang menunggu approval = `step_order == run.current_step + 1`
- artefak yang harus direview = `final_output` task ber-`step_order == run.current_step`

**Patch 3 — `app/schemas.py`**, setelah `class WorkflowRunOut`:

```python
class WorkflowRunStepOut(BaseModel):
    id: int                       # workflow_steps.id
    step_order: int
    name: str | None = None
    role_prompt: str | None = None
    requires_approval: bool = False
    status: str                   # status step task, atau "pending" kalau belum dibuat
    task_id: int | None = None


class WorkflowRunDetailOut(WorkflowRunOut):
    steps: list[WorkflowRunStepOut] = Field(default_factory=list)
    pending_approval_step_id: int | None = None
    pending_approval_artifact: str | None = None
```

**Patch 4 — `app/api/workflows.py`**, ganti seluruh handler
`get_workflow_run` (baris 242-247):

```python
@router.get("/workflow-runs/{run_id}", response_model=WorkflowRunDetailOut)
async def get_workflow_run(
    run_id: int, user: CurrentUser, session: DbSession
) -> WorkflowRunDetailOut:
    run = await _owned_run(run_id, user, session)

    steps = (
        await session.execute(
            select(WorkflowStep)
            .where(WorkflowStep.workflow_id == run.workflow_id)
            .order_by(WorkflowStep.step_order)
        )
    ).scalars().all()

    tasks = (
        await session.execute(
            select(Task).where(Task.workflow_run_id == run.id)
        )
    ).scalars().all()
    task_by_order = {t.step_order: t for t in tasks if t.step_order is not None}

    out_steps = [
        WorkflowRunStepOut(
            id=s.id,
            step_order=s.step_order,
            name=s.name,
            role_prompt=s.role_prompt,
            requires_approval=s.requires_approval,
            status=(t.status if (t := task_by_order.get(s.step_order)) else "pending"),
            task_id=t.id if t else None,
        )
        for s in steps
    ]

    pending_id: int | None = None
    pending_artifact: str | None = None
    if run.status == "awaiting_approval":
        pending = next(
            (s for s in steps if s.step_order == run.current_step + 1), None
        )
        if pending is not None:
            pending_id = pending.id
            done = task_by_order.get(run.current_step)
            pending_artifact = done.final_output if done else None

    return WorkflowRunDetailOut(
        id=run.id,
        workflow_id=run.workflow_id,
        goal=run.goal,
        status=run.status,
        current_step=run.current_step,
        project_path=run.project_path,
        workspace_path=run.workspace_path,
        mode=run.mode,
        created_at=run.created_at,
        finished_at=run.finished_at,
        steps=out_steps,
        pending_approval_step_id=pending_id,
        pending_approval_artifact=pending_artifact,
    )
```

Jebakan walrus: `(t := task_by_order.get(s.step_order))` dievaluasi di field
`status` yang ditulis **sebelum** `task_id` — urutan itu wajib dipertahankan.
Kalau ragu, pecah jadi loop `for` biasa.

Tambahkan `WorkflowRunDetailOut` dan `WorkflowRunStepOut` ke blok impor.

### A3 — UI menunggu status `"paused"`, backend memakai `"awaiting_approval"`

**Bukti:** `app.js:807` — `run.status === "paused"`. Nilai `"paused"` tidak
pernah ditulis di mana pun; `workflow.py:135` menulis `"awaiting_approval"`, dan
`workflows.py:258,277` juga memeriksa string itu.

Akibat: **panel approval tidak akan pernah muncul**, jadi run ber-`requires_approval`
berhenti selamanya tanpa cara melanjutkan dari UI.

### A5 — artefak approval diambil dari task yang belum ada

**Bukti:** `app.js:810-814` mencari `run.steps.find(s => s.id === run.pending_approval_step_id)`
lalu memanggil `GET /api/tasks/${pendingStep.task_id}` dan membaca
`task.plan_artifact`. Dua kesalahan sekaligus:

1. Step yang menunggu approval **belum punya task** — `advance_run` sengaja
   berhenti sebelum membuatnya (`workflow.py:134-138`), dan itu memang inti
   keputusan §3.3 rencana Fase 4. `task_id`-nya `null`.
2. `TaskOut` (`schemas.py:50-64`) tidak punya `plan_artifact`, jadi seandainya
   task-nya ada pun, textarea tetap kosong.

**Keputusan:** hapus fetch kedua itu. `pending_approval_artifact` dari Patch 4
sudah menyediakan isinya dalam satu request. Tidak perlu menambah `plan_artifact`
ke `TaskOut`.

**Patch 5 — `app/static/app.js`**, ganti baris 807-818 (menutup A3 + A5
sekaligus):

```js
    const needsApproval = run.status === "awaiting_approval" && run.pending_approval_step_id;
    if (needsApproval) {
      $("approval-panel").classList.remove("hidden");
      $("approval-artifact").value = run.pending_approval_artifact || "";
    } else {
      $("approval-panel").classList.add("hidden");
    }
```

Blok `if (run.status === "running")` di baris 819-821 sudah benar dan
mem-polling ulang tiap 3 detik — biarkan. Tambahkan `"awaiting_approval"` **tidak
perlu**: run yang menunggu approval memang harus berhenti polling.

**Patch 6 — `app/static/app.js`**, ganti `api(...)` di `loadRun` baris 781:

```js
    const run = await api(`/api/workflow-runs/${runId}`);
```

tidak berubah — endpoint-nya sama, hanya isinya yang sekarang lengkap. Yang perlu
dipastikan: `s.name` di baris 792 sekarang terisi (lihat A6), dan `s.status`
untuk step yang belum jalan bernilai `"pending"` sehingga class CSS
`step-item pending` perlu ada di `style.css` — kalau belum, tambahkan mengikuti
pola `.pill` yang sudah ada.

### A4 — tombol Setujui mengirim body, endpoint membaca query param

**Bukti:** `app.js:831-834` mengirim `body: JSON.stringify({ plan_artifact: artifact })`.
`approve_run` (`workflows.py:253-256`) mendeklarasikan `edited_artifact: str | None = None`
sebagai parameter fungsi biasa — FastAPI memperlakukannya sebagai **query
parameter**. Body-nya diabaikan tanpa error.

Akibat: approve tetap berhasil, tapi **suntingan user pada plan dibuang diam-diam**
dan `advance_run` jatuh ke `last_task.final_output`. Ini persis kasus yang
rencana Fase 4 §7 sebut sebagai alasan fitur edit itu ada.

**Keputusan:** ubah ke body model, dan **wajib opsional** — `test_workflow.py:238`
memanggil `POST /approve` tanpa body sama sekali, dan test itu tidak boleh
disentuh.

**Patch 7 — `app/schemas.py`**, di blok workflow:

```python
class RunApprovalIn(BaseModel):
    plan_artifact: str | None = None
```

**Patch 8 — `app/api/workflows.py`**, ganti tanda tangan `approve_run`
(baris 252-256):

```python
@router.post("/workflow-runs/{run_id}/approve")
async def approve_run(
    run_id: int,
    user: CurrentUser,
    session: DbSession,
    payload: RunApprovalIn | None = Body(default=None),
) -> dict:
```

dan panggilannya (baris ±266):

```python
    await advance_run(run.id, approved_artifact=payload.plan_artifact if payload else None)
```

Impor `Body` dari `fastapi` di baris 5. Verifikasi ketat: `POST /approve` tanpa
body harus tetap **200**, bukan 422.

### A6 — `name` per step ditulis UI, tidak ada di skema maupun tabel

**Bukti:** `app.js:720` mengirim `name` di setiap step; `WorkflowStepIn`
(`schemas.py:106-111`) tidak punya field itu, jadi Pydantic membuangnya. Model
`WorkflowStep` (`models.py:71-81`) juga tidak punya kolom `name`. `app.js:792`
lalu merender `s.name` → `undefined` di daftar step.

Dua jalan keluar. **Pilih menambahkan kolomnya**, bukan membuang field dari UI:
editor step sudah mengumpulkannya, dan daftar step tanpa nama praktis tidak
terbaca (`role_prompt` bisa panjang dan multi-baris).

**Patch 9 — file baru `migrations/003_workflow_step_name.sql`:**

```sql
-- Fase 4 penutupan: nama step supaya daftar step di UI terbaca.
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS name VARCHAR(64);
```

Idempoten, sesuai kontrak `apply_migrations()` (`db.py:94-99`) yang mem-glob
`*.sql` terurut. Tidak perlu menyentuh `tests/conftest.py` — `workflow_steps`
sudah ada di `TABLES`.

**Patch 10 — `app/models.py`**, di `class WorkflowStep` setelah baris 81:

```python
    name: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

**Patch 11 — `app/schemas.py`:** tambahkan `name: str | None = None` ke
`WorkflowStepIn` (baris 106) **dan** `name: str | None` ke `WorkflowStepOut`
(baris 119).

**Patch 12 — `app/api/workflows.py`:** tambahkan `name=step_in.name,` ke **dua**
tempat konstruksi `WorkflowStep` — di `create_workflow` (baris ±77) dan
`update_workflow` (baris ±112). Mudah lupa yang kedua.

### A7 — run selalu memakai goal generik (bukan mismatch, tapi menggagalkan gunanya)

**Bukti:** `app.js:767` memanggil `POST /api/workflows/${id}/run` tanpa apa pun.
`run_workflow` (`workflows.py:181-187`) mendeklarasikan `goal`, `project_path`,
`mode`, `allow_unisolated` sebagai query param, jadi semuanya default dan
`run.goal` selalu jatuh ke `f"Menjalankan workflow '{wf.name}'"` (baris 205).

Goal itu dioper ke `_handoff_prompt` sebagai maksud asli user (`workflow.py:145`).
Dengan nilai generik, **setiap step menerima instruksi yang tidak menyebutkan apa
yang sebenarnya diminta**. Workflow-nya jalan dan menghasilkan sampah — kelas
kegagalan yang sama dengan §3.4 rencana Fase 4, tanpa error apa pun.

**Keputusan:** pindahkan ke body model opsional, dan minta goal di UI.

**Patch 13 — `app/schemas.py`:**

```python
class WorkflowRunIn(BaseModel):
    goal: str | None = None
    project_path: str | None = None
    mode: str = "interactive"
    allow_unisolated: bool = False
```

**Patch 14 — `app/api/workflows.py`**, ganti tanda tangan `run_workflow`
(baris 181-187) menjadi:

```python
@router.post("/workflows/{workflow_id}/run", response_model=WorkflowRunOut, status_code=201)
async def run_workflow(
    workflow_id: int,
    user: CurrentUser,
    session: DbSession,
    payload: WorkflowRunIn | None = Body(default=None),
) -> WorkflowRun:
    opts = payload or WorkflowRunIn()
```

lalu ganti pemakaian `goal` → `opts.goal`, `project_path` → `opts.project_path`,
`mode` → `opts.mode`, `allow_unisolated` → `opts.allow_unisolated` di seluruh
badan fungsi (baris 200-232, termasuk `Task(...)` di bawahnya).

Sudah diperiksa: tidak ada test yang memanggil `POST /run` lewat HTTP —
`create_and_run_workflow` (`tests/test_workflow.py`) menulis `Workflow`,
`WorkflowRun`, dan `Task` langsung lewat ORM. Jadi perubahan query param → body
tidak bisa memecahkan test mana pun. Body tetap dibuat opsional supaya pemakaian
`curl` tanpa payload tetap 201.

**Patch 15 — `app/static/app.js`**, `runWorkflow` (baris 765-772):

```js
async function runWorkflow(id) {
  const goal = prompt("Apa yang ingin dikerjakan workflow ini?");
  if (goal === null) return;
  try {
    const run = await api(`/api/workflows/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ goal: goal.trim() || null }),
    });
    loadRun(run.id);
  } catch (err) {
    notify(err.message);
  }
}
```

`window.prompt` sudah dipakai gaya yang sama lewat `confirm` di baris 638, jadi
ini konsisten dengan UI yang ada. Kalau ingin lebih rapi, tambahkan input goal ke
`#workflow-run-panel` di `index.html` — tapi itu bukan syarat penutupan.

---

## 3. Sisa Fase 3.6 — prasyarat Fase 5, bukan Fase 4

### B1 — fixture user-kedua ber-cookie asli belum ada

`tests/conftest.py:60` menyediakan fixture `user_b`, tapi `test_api.py:47`
menembus boundary lewat `app.dependency_overrides[get_current_user]`. Itu **opsi
pertama** dari dua yang ditawarkan `rencana-penutupan-fase35b.md:191-198`; yang
direkomendasikan adalah opsi kedua, karena ia sekaligus menutup fokus #2
(alur login berpassword) yang sampai sekarang **nol test**.

Yang belum teruji: `get_current_user` saat `auth_disabled()` **false** —
yaitu 401 tanpa cookie, 401 dengan cookie rusak, dan 200 dengan cookie sah.
Itu justru jalur yang aktif di produksi.

**Kerjaan:** fixture `authed_client` di `conftest.py` yang menyetel
`CHOROS_ADMIN_PASSWORD_HASH`, memanggil `get_settings.cache_clear()`, menerbitkan
cookie lewat `issue_cookie(username)` (`security.py:39`), dan mengembalikan
`AsyncClient` dengan cookie terpasang. Bersihkan env + `cache_clear()` lagi di
`finally` — `get_settings` ber-`@lru_cache` (`config.py:36`), dan kebocorannya
akan membuat test lain gagal dengan cara yang membingungkan.

Lalu satu test baru: login tanpa cookie → 401; cookie asal-asalan → 401; cookie
dari `issue_cookie("tester")` → 200.

### B2 — test `_run_cascade` tanpa efek samping belum ada

`rencana-fase4.md:407` (test #2) meminta: `_run_cascade` mengembalikan
`attempt=None` saat semua target habis, **dan tidak menyentuh status task**.
`tests/test_cascade.py` masih 10 test — yang lama semua. Ini satu-satunya test
yang mengunci *aturan* refactor 4a (`_run_cascade` tidak boleh memanggil
`_finish`), bukan cuma hasilnya.

Tambahkan sebagai test ke-11 di `tests/test_cascade.py`. Ini penambahan, bukan
perubahan — sepuluh yang lama tetap tidak boleh disentuh.

---

## 4. Kebersihan

### C1 — `ruff` masih belum terpasang

`python -m ruff` → `No module named ruff`. Sudah dicatat dua dokumen berturut-turut
(`fase35b` §2.3: "layak dipasang sebelum Fase 4 menambah permukaan kode"). Fase 4
sudah menambah ~700 baris sejak itu.

Pasang, jalankan sekali di seluruh repo, perbaiki yang muncul. Kelas kesalahan
seperti `Any` tak terimpor di `isolation.py` — yang butuh satu dokumen penuh untuk
ditemukan manual — adalah F821 satu detik bagi ruff.

### C2 — belum ada commit sama sekali sejak `3e163ab`

Rencana Fase 4 item 0 ("commit Fase 3.5 apa adanya") tidak pernah dijalankan.
Seluruh Fase 3.5 → 3.5b → 3.5c → 3.6 → 4a → 4d menumpuk di satu working tree.

Pecah jadi commit terpisah **sebelum** patch dokumen ini ditambahkan, minimal:

1. Fase 3.5 + 3.5b + 3.5c (ketahanan operasional)
2. Fase 3.6 (test lapisan API)
3. Fase 4a (refactor `_run_cascade` — rencana Fase 4 §4 eksplisit meminta commit
   terpisah, supaya kalau perilaku berubah diam-diam, `git bisect` bisa
   menunjukkannya)
4. Fase 4b–4d (workflow)

Kalau memecahnya terlalu mahal sekarang, satu commit "Fase 3.5–4" masih jauh
lebih baik daripada working tree menganggur — tapi jangan campur dengan patch
§2 dokumen ini.

---

## 5. Test yang harus ditambahkan

Semua di file yang sudah ada kecuali disebut lain. Tidak ada yang boleh mengubah
test lama.

| # | Test | File | Menguji |
|---|---|---|---|
| T1 | `GET /api/workflows/{id}` mengembalikan `steps` terurut `step_order` | `tests/test_api.py` | A1 |
| T2 | `GET /api/workflows/{id}` milik user lain → 404 | `tests/test_api.py` | A1 + boundary |
| T3 | `GET /api/workflow-runs/{id}` mengembalikan satu entri per step; step yang belum punya task berstatus `"pending"` dengan `task_id: null` | `tests/test_workflow.py` | A2 |
| T4 | Run ber-`requires_approval`: `pending_approval_step_id` menunjuk step **berikutnya** (bukan yang selesai), dan `pending_approval_artifact` == `final_output` step sebelumnya | `tests/test_workflow.py` | A2 + A5 |
| T5 | `POST /approve` dengan body `{"plan_artifact": "X"}` → task step berikutnya punya `plan_artifact == "X"`, bukan `final_output` step 1 | `tests/test_workflow.py` | A4 |
| T6 | `POST /approve` **tanpa body** tetap 200 | `tests/test_workflow.py` | A4 regresi |
| T7 | `POST /workflows`+`GET` round-trip mempertahankan `name` tiap step | `tests/test_api.py` | A6 |
| T8 | `POST /run` dengan body `{"goal": "..."}` → `run.goal` sama persis | `tests/test_workflow.py` | A7 |
| T9 | Tanpa cookie → 401; cookie rusak → 401; `issue_cookie` sah → 200 | `tests/test_api.py` | B1 |
| T10 | `_run_cascade` habis target → `attempt is None`, status task **tidak berubah** | `tests/test_cascade.py` | B2 |

T4 dan T5 adalah yang paling penting: keduanya menguji kesalahan yang tidak
melempar exception, hanya menghasilkan approval yang mereview artefak salah atau
membuang suntingan user.

---

## 6. Urutan kerja

| # | Kerjaan | File | Patch | Sesi |
|---|---|---|---|---|
| 0 | Commit working tree yang ada (§C2) | — | — | 0.25 |
| 1 | Migrasi + model + skema `name` step | `migrations/003_*.sql`, `models.py`, `schemas.py`, `api/workflows.py` | 9-12 | 0.25 |
| 2 | `GET /workflows/{id}` + `WorkflowDetailOut` | `schemas.py`, `api/workflows.py` | 1-2 | 0.25 |
| 3 | `WorkflowRunDetailOut` + handler run | `schemas.py`, `api/workflows.py` | 3-4 | 0.5 |
| 4 | Body model approve + run | `schemas.py`, `api/workflows.py` | 7-8, 13-14 | 0.25 |
| 5 | UI: status approval, artefak, goal | `app/static/app.js`, `style.css` | 5-6, 15 | 0.25 |
| 6 | Test T1-T8 | `tests/test_api.py`, `tests/test_workflow.py` | — | 0.5 |
| 7 | Fixture cookie asli + T9 (§B1) | `tests/conftest.py`, `tests/test_api.py` | — | 0.25 |
| 8 | T10 (§B2) | `tests/test_cascade.py` | — | 0.25 |
| 9 | Pasang `ruff`, jalankan, perbaiki (§C1) | seluruh repo | — | 0.25 |

Total ≈ 2,75 sesi.

Item 1 lebih dulu karena Patch 3 dan 4 membaca `s.name` — mengerjakan §A2 sebelum
§A6 berarti menulis kode yang tidak bisa dijalankan. Item 5 (UI) terakhir di
antara patch kode karena ia satu-satunya yang tidak bisa diverifikasi oleh test;
biarkan API-nya benar dulu.

**Verifikasi manual yang wajib setelah item 5** — tidak ada test yang menutupinya:

1. Buat workflow 2 step lewat UI, step kedua centang "Butuh Persetujuan".
2. Klik **Ubah** pada workflow itu → editor harus terisi, termasuk nama step.
3. Klik **Run**, isi goal.
4. Panel Status Run harus menampilkan dua baris step dengan status per step.
5. Setelah step 1 selesai, panel approval harus muncul dengan plan step 1 di
   textarea.
6. Sunting satu baris plan, klik **Setujui** → step 2 harus jalan memakai teks
   yang sudah disunting (cek lewat panel percobaan / `/logs` task step 2).

Langkah 6 adalah satu-satunya cara membuktikan A4 end-to-end.

---

## 7. Jebakan yang sudah diketahui

| Jebakan | Kenapa berbahaya |
|---|---|
| `POST /approve` tanpa body harus tetap 200 | `test_workflow.py:238` memanggilnya begitu, dan test itu tidak boleh diubah. Body wajib → 422 → merah. |
| `run.current_step` = step yang **selesai**, bukan yang menunggu | Salah baca satu di sini membuat panel approval menampilkan artefak step yang salah — tanpa error. |
| Step yang menunggu approval belum punya Task | Konsekuensi sengaja dari keputusan §3.3 rencana Fase 4 (slot konkurensi tidak boleh ditahan). Jangan "perbaiki" dengan membuat task lebih awal. |
| `WorkflowStep` dikonstruksi di **dua** tempat | `create_workflow` dan `update_workflow`. Patch 12 harus kena keduanya. |
| `get_settings` ber-`@lru_cache` (`config.py:36`) | Fixture §B1 wajib `cache_clear()` sebelum **dan** sesudah. |
| Jangan ubah `WorkflowOut` / `WorkflowRunOut` | Keduanya dipakai sebagai `response_model` yang mengembalikan objek ORM langsung. Turunkan skema baru, jangan tambal yang lama. |
| `tests/test_cascade.py` & `tests/test_workflow.py` | Boleh ditambah, tidak boleh diubah. Kalau merah setelah patch, patch-nya yang salah. |

---

## 8. Yang sengaja tidak dikerjakan

- **Editor `targets` per step di UI.** Step yang dibuat lewat UI selalu
  ber-`targets` kosong, dan `resolve_step_targets` (`router.py:77`) memang jatuh
  ke routing rule kategori step — perilaku yang benar. Efek sampingnya: jalur
  validasi `_owned_agent` di `_validate_step_agent_ids` tidak pernah tersentuh
  dari UI, tapi tetap terjaga untuk pemakaian API langsung (sudah ada test-nya di
  `test_api.py:189`). Tambahkan editor targets hanya kalau ada kebutuhan nyata
  memilih agent per step.
- **Polling run saat `awaiting_approval`.** Run berhenti — tidak ada yang perlu
  di-poll sampai user menekan tombol.
- **Fase 5 (mode tim).** Tetap diblokir sampai §B1 selesai. Alasannya tidak
  berubah sejak tiga dokumen lalu.

---

## 9. Verifikasi yang mendasari dokumen ini

- Suite dijalankan sekali tanpa env override: `69 passed in 235.59s`, nol skip.
- Enam mismatch A1-A6 dikonfirmasi dengan membandingkan setiap pemanggilan
  `api(...)` di `app/static/app.js` baris 613-850 terhadap daftar route hasil
  `grep "router.(get|post|put|delete)" app/api/workflows.py` dan terhadap field
  yang benar-benar ada di `app/schemas.py:106-149`.
- A5 ditelusuri ke `advance_run` (`workflow.py:134-138`) untuk memastikan step
  yang menunggu approval memang belum punya Task — bukan disimpulkan dari
  membaca UI saja.
- A6 dikonfirmasi dua arah: `name` tidak ada di `WorkflowStepIn`
  (`schemas.py:106-111`) **dan** tidak ada kolomnya di `models.py:71-81` maupun
  `migrations/001_init.sql` / `002_workflow.sql`.
- A4 dikonfirmasi dari tanda tangan `approve_run` (`workflows.py:253-256`): tanpa
  `Body(...)`, `str | None` adalah query param di FastAPI.
- `ruff` dipastikan masih tidak terpasang (`No module named ruff`).
- In-degree `_finish` di dalam `_run_cascade` diperiksa untuk memastikan aturan
  refactor 4a masih dipegang — `_run_cascade` (`runner.py:331-443`) mengembalikan
  `CascadeResult` di dua titik dan tidak memanggil `_finish` sama sekali.

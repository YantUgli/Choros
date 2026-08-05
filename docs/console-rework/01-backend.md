# 01 — Backend

Semua path relatif ke root repo `Choros/`. Skeleton kode di bawah **preskriptif**: ikuti struktur, nama, dan tipe persis; sesuaikan hanya bila kode nyata berbeda (lalu catat penyimpangan).

---

## 1.1 Migrasi — `migrations/006_projects.sql`

Buat file baru. Semua statement idempoten (pola sama [002_workflow.sql](../../migrations/002_workflow.sql)). Dijalankan otomatis oleh `apply_migrations()` ([db.py:94](../../app/db.py#L94)) saat startup.

```sql
-- Fase console-rework: Project → Task → Run → Console
-- Semua statement idempoten (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL,
  folder_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id),
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,   -- list slug kategori terurut
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_group_id BIGINT NOT NULL REFERENCES task_groups(id),
  user_id INT NOT NULL REFERENCES users(id),
  status VARCHAR(32) NOT NULL DEFAULT 'running',   -- running | done | halted
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Kolom baru di tasks: hubungkan eksekusi console ke run + jejak delegasi
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_run_id BIGINT REFERENCES task_runs(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegated_from_task_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tasks_run_cat ON tasks (task_run_id, category);
CREATE INDEX IF NOT EXISTS idx_task_groups_project ON task_groups (project_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_group ON task_runs (task_group_id);
```

---

## 1.2 Model SQLAlchemy — `app/models.py`

Tambah tiga kelas baru (pola sama kelas existing; `Base = DeclarativeBase` sudah ada di file). Tambah dua kolom di kelas `Task`.

```python
class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    folder_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskGroup(Base):
    __tablename__ = "task_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    categories: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskRun(Base):
    __tablename__ = "task_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task_group_id: Mapped[int] = mapped_column(ForeignKey("task_groups.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="running")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Di kelas `Task` ([models.py:110](../../app/models.py#L110)) tambahkan:

```python
    task_run_id: Mapped[int | None] = mapped_column(ForeignKey("task_runs.id"), nullable=True)
    delegated_from_task_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
```

---

## 1.3 Schema Pydantic — `app/schemas.py`

Tambah (pola sama, `ConfigDict(from_attributes=True)` untuk Out). Import `datetime`, `Any` sudah ada.

```python
class ProjectIn(BaseModel):
    name: str
    folder_path: str

class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    folder_path: str
    created_at: datetime | None

class TaskGroupIn(BaseModel):
    name: str
    categories: list[str] = []     # slug kategori terurut, mis. ["text_planning","coding_complex"]

class TaskGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    name: str
    categories: list[str]
    created_at: datetime | None

class TaskRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_group_id: int
    status: str
    created_at: datetime | None
    finished_at: datetime | None

class RunLaneOut(BaseModel):
    category: str
    task_id: int | None            # eksekusi terakhir di lane ini (None = belum jalan)
    status: str | None
    tokens_run: int                # token task terakhir
    tokens_accumulated: int        # SUM token semua task lane ini di run ini

class TaskRunDetailOut(TaskRunOut):
    lanes: list[RunLaneOut]

class DelegateIn(BaseModel):
    to_category: str
    artifact: str                  # isi plan terpilih/ter-edit
    mode: Literal["interactive", "autonomous"] = "interactive"

class MdFileOut(BaseModel):
    path: str
    content: str

class ArtifactCandidatesOut(BaseModel):
    final_output: str | None
    md_files: list[MdFileOut]
```

Ubah `TaskIn` ([schemas.py:61](../../app/schemas.py#L61)) — tambah satu field:

```python
    task_run_id: int | None = None
```

---

## 1.4 Router baru — `app/api/projects.py`

Prefix `/api`. Daftarkan di `__init__.py` (§1.6). Gunakan `CurrentUser`, `DbSession`, `runner`.

```python
from __future__ import annotations
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy import desc, func, select
from app.models import Project, TaskGroup, TaskRun, Task, TaskLog
from app.schemas import (
    ProjectIn, ProjectOut, TaskGroupIn, TaskGroupOut,
    TaskRunOut, TaskRunDetailOut, RunLaneOut,
)
from app.security import CurrentUser, DbSession

router = APIRouter(prefix="/api", tags=["projects"])

def _validate_folder(folder_path: str) -> str:
    # Reuse pola validasi fs.py: folder harus ada & berupa direktori.
    p = Path(folder_path).expanduser()
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="folder tidak ditemukan / bukan direktori")
    return str(p.resolve())
```

Endpoint (semua dengan ownership guard `where(...user_id == user.id)`; 404 bila bukan milik user):

| Method | Path | Fungsi | Catatan |
|---|---|---|---|
| POST | `/api/projects` | create_project | validasi `folder_path` via `_validate_folder`; simpan hasil resolve. 201 → `ProjectOut` |
| GET | `/api/projects` | list_projects | urut `desc(created_at)` → `list[ProjectOut]` |
| DELETE | `/api/projects/{id}` | delete_project | 204. (Cascade manual: tolak 409 bila masih ada task_group, ATAU hapus berjenjang — pilih tolak-409 untuk aman) |
| POST | `/api/projects/{id}/tasks` | create_task_group | body `TaskGroupIn`; validasi tiap slug ∈ `CATEGORIES` ([router.py:17](../../app/orchestrator/router.py#L17)); 201 → `TaskGroupOut` |
| GET | `/api/projects/{id}/tasks` | list_task_groups | `list[TaskGroupOut]` |
| DELETE | `/api/tasks-groups/{id}` | delete_task_group | 204 |
| POST | `/api/task-groups/{id}/runs` | create_run | buat `TaskRun(status="running")`; 201 → `TaskRunOut` |
| GET | `/api/task-groups/{id}/runs` | list_runs | riwayat, urut `desc(created_at)` → `list[TaskRunOut]` |
| GET | `/api/task-runs/{id}` | get_run | `TaskRunDetailOut` — bangun `lanes` dari `task_group.categories`; per kategori cari `tasks` terakhir di run ini + token |

**Perhitungan `lanes` di `get_run`:**
1. Ambil `task_group.categories` (urutan lane = urutan kategori).
2. Untuk tiap kategori `c`:
   - `task_id`/`status` = `tasks` terbaru dengan `task_run_id == run.id AND category == c` (urut `desc(id)`), atau `None`.
   - `tokens_run` = token task terakhir itu (dari `task_logs.usage`, ambil `total`).
   - `tokens_accumulated` = `SUM` token semua `task_logs` untuk semua `tasks` dengan `(task_run_id==run.id, category==c)`.

> **Token:** `task_logs.usage` JSONB berisi mis. `{"total": N, ...}` ([models.py:155](../../app/models.py#L155)). Verifikasi kunci `total` di data nyata; bila beda, sesuaikan. Query akumulasi: join `tasks`↔`task_logs` lalu `func.sum(TaskLog.usage["total"].astext.cast(Integer))` (Postgres JSONB).

---

## 1.5 Eksekusi console, delegasi & artifact — `app/api/tasks.py`

### 1.5.1 `create_task` menerima `task_run_id`

Di `create_task` ([tasks.py:31](../../app/api/tasks.py#L31)) tambahkan penyaluran `task_run_id` dan **default `project_path` dari folder Project**:

```python
task = Task(
    ...,  # field existing
    task_run_id=payload.task_run_id,
    project_path=payload.project_path or await _run_folder(payload.task_run_id, session),
    ...
)
```

`_run_folder(task_run_id, session)` helper: `task_run → task_group → project.folder_path`. Bila `task_run_id` None → biarkan `settings.default_project_path` (perilaku lama). Mode interaktif otomatis in-place di folder ini ([isolation.py:60](../../app/orchestrator/isolation.py#L60)) — **inilah "folder live"**.

### 1.5.2 Artifact candidates (md-aware) — `GET /api/tasks/{task_id}/artifact-candidates`

```python
@router.get("/{task_id}/artifact-candidates", response_model=ArtifactCandidatesOut)
async def artifact_candidates(task_id, user: CurrentUser, session: DbSession):
    task = await _owned_task(task_id, user, session)
    # 1. final_output teks
    final = task.final_output
    # 2. file .md yang disentuh run ini — dari task_events type='file_edit', data.path ~ '*.md'
    #    Event.file_edit menyimpan data {"path","action"} (events.py:75).
    #    Query TaskEvent where task_id==task_id AND type=='file_edit' AND data->>'path' ILIKE '%.md'.
    #    Baca isi tiap file dari (task.workspace_path / path) bila ada.
    md_files = [...]  # list[MdFileOut]
    return ArtifactCandidatesOut(final_output=final, md_files=md_files)
```

Detail: `data->>'path'` (Postgres JSONB text accessor). Path bisa relatif → gabung dengan `task.workspace_path`. Skip file yang tak terbaca. Batasi ukuran baca (mis. ≤ 256 KB/file) demi aman.

### 1.5.3 Delegasi — `POST /api/tasks/{task_id}/delegate`

```python
@router.post("/{task_id}/delegate", response_model=TaskOut, status_code=201)
async def delegate_task(task_id, payload: DelegateIn, user: CurrentUser, session: DbSession):
    source = await _owned_task(task_id, user, session)
    prompt = _delegate_prompt(payload.artifact)      # rakit prompt eksekutor dari artifact
    task = Task(
        user_id=user.id,
        prompt=prompt,
        category=payload.to_category,
        mode=payload.mode,
        project_path=source.project_path,            # folder live yang sama
        quality_floor=source.quality_floor,
        plan_artifact=payload.artifact,
        allow_unisolated=source.allow_unisolated,
        task_run_id=source.task_run_id,              # lane baru di run yang sama
        delegated_from_task_id=source.id,
        status="queued",
    )
    session.add(task); await session.commit(); await session.refresh(task)
    runner.start(task.id)
    return task
```

`_delegate_prompt(artifact)` — tiru pola [_handoff_prompt](../../app/orchestrator/workflow.py#L37) (role-framing opsional → artifact sebagai panduan), tapi dipanggil **langsung tanpa `advance_run`**. Contoh minimal:

```python
def _delegate_prompt(artifact: str) -> str:
    return (
        "Kerjakan tugas berikut berdasarkan plan yang sudah disiapkan.\n\n"
        "--- PLAN ---\n" + artifact + "\n--- /PLAN ---\n\n"
        "Ikuti plan; bila ada langkah ambigu, ambil asumsi terbaik dan lanjut."
    )
```

> **Penting:** delegasi **tidak** menyentuh `workflow_runs`/`advance_run`. Lane baru cukup `tasks` row dengan `task_run_id` sama. Streaming & follow-up pakai endpoint `tasks` yang sudah ada.

---

## 1.6 Registrasi router — `app/api/__init__.py`

```python
from app.api.projects import router as projects_router
# ...
ROUTERS = [
    auth_router, agents_router, tasks_router, quota_router,
    claude_usage_router, gemini_usage_router, workflows_router,
    users_router, fs_router,
    projects_router,   # <-- tambah
]
```

---

## 1.7 Ringkasan endpoint baru

```
POST   /api/projects
GET    /api/projects
DELETE /api/projects/{id}
POST   /api/projects/{id}/tasks
GET    /api/projects/{id}/tasks
DELETE /api/tasks-groups/{id}
POST   /api/task-groups/{id}/runs
GET    /api/task-groups/{id}/runs
GET    /api/task-runs/{id}
GET    /api/tasks/{id}/artifact-candidates
POST   /api/tasks/{id}/delegate
```

Reuse tanpa perubahan: `POST /api/tasks` (+field `task_run_id`), `POST /api/tasks/{id}/reply`, `GET /api/tasks/{id}/stream`, `GET /api/tasks/{id}/events|logs`, `POST /api/tasks/{id}/cancel`, `GET /api/tasks/categories`, `GET /api/fs/list`.

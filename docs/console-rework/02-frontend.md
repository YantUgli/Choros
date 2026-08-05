# 02 — Frontend

Path relatif ke `app/static/src/`. **Dilarang membuat DS primitive baru** di luar [components/ds/index.ts](../../app/static/src/components/ds/index.ts) (lihat baris 1). Reuse: `Button, IconButton, Badge, StatusDot, Panel, Card, Tabs, Input, Select, Toggle, MeterBar, KeyValue, LogLine` + `Label/Meta/Field` ([components/Label.tsx](../../app/static/src/components/Label.tsx)) + `useModals()` ([state/modals.tsx:27](../../app/static/src/state/modals.tsx#L27)).

---

## 2.1 API client — `services/projectApi.ts` (baru)

Pola sama [historyApi.ts](../../app/static/src/services/historyApi.ts): pakai `apiGet`/`apiSend` dari [services/api.ts](../../app/static/src/services/api.ts).

```ts
import { apiGet, apiSend } from "./api";

export interface Project { id: number; name: string; folderPath: string; createdAt: string | null; }
export interface TaskGroup { id: number; projectId: number; name: string; categories: string[]; createdAt: string | null; }
export interface TaskRun { id: number; taskGroupId: number; status: string; createdAt: string | null; finishedAt: string | null; }
export interface RunLane { category: string; taskId: number | null; status: string | null; tokensRun: number; tokensAccumulated: number; }
export interface TaskRunDetail extends TaskRun { lanes: RunLane[]; }
export interface MdFile { path: string; content: string; }
export interface ArtifactCandidates { finalOutput: string | null; mdFiles: MdFile[]; }

export const fetchProjects = () => apiGet<Project[]>("/api/projects");
export const createProject = (name: string, folderPath: string) =>
  apiSend<Project>("POST", "/api/projects", { name, folder_path: folderPath });
export const deleteProject = (id: number) => apiSend<void>("DELETE", `/api/projects/${id}`);

export const fetchTaskGroups = (projectId: number) => apiGet<TaskGroup[]>(`/api/projects/${projectId}/tasks`);
export const createTaskGroup = (projectId: number, name: string, categories: string[]) =>
  apiSend<TaskGroup>("POST", `/api/projects/${projectId}/tasks`, { name, categories });
export const deleteTaskGroup = (id: number) => apiSend<void>("DELETE", `/api/tasks-groups/${id}`);

export const createRun = (taskGroupId: number) => apiSend<TaskRun>("POST", `/api/task-groups/${taskGroupId}/runs`, {});
export const fetchRuns = (taskGroupId: number) => apiGet<TaskRun[]>(`/api/task-groups/${taskGroupId}/runs`);
export const fetchRunDetail = (runId: number) => apiGet<TaskRunDetail>(`/api/task-runs/${runId}`);

export const fetchArtifactCandidates = (taskId: number) =>
  apiGet<ArtifactCandidates>(`/api/tasks/${taskId}/artifact-candidates`);
export const delegate = (taskId: number, toCategory: string, artifact: string) =>
  apiSend<{ id: number }>("POST", `/api/tasks/${taskId}/delegate`, { to_category: toCategory, artifact });
```

> Cek signature `apiSend` di [api.ts](../../app/static/src/services/api.ts) (verifikasi urutan arg method/path/body); sesuaikan bila beda. Backend snake_case → mapping ke camelCase di client bila perlu (lihat pola `toHistoryItems`).

---

## 2.2 Daemon: tambah `attach(taskId)`

Lane hasil delegasi dibuat **di server** (bukan lewat `submit`), jadi panel-nya harus menyambung stream task yang sudah ada. Daemon per-instance ([sseDaemon.ts:287](../../app/static/src/services/sseDaemon.ts#L287)) — cukup expose `openStream`.

**`services/daemon.ts`** — tambah ke interface `DaemonClient` ([daemon.ts:15](../../app/static/src/services/daemon.ts#L15)):
```ts
  attach(taskId: number): void;
```

**`services/sseDaemon.ts`** — di objek return ([~baris 426](../../app/static/src/services/sseDaemon.ts#L426)) tambah:
```ts
  attach(taskId: number) { openStream(taskId); },
```
`openStream` sudah memanggil `opts.onTaskId?.(id)` ([sseDaemon.ts:372](../../app/static/src/services/sseDaemon.ts#L372)) → `RUN_ID` ter-dispatch. Untuk task yang **sudah selesai**, stream `/api/tasks/{id}/stream` me-replay history lalu `eof` → `reconcile` mengeluarkan `FINAL`. Aman.

**`services/mockDaemon.ts`** — tambah `attach() {}` (no-op) supaya tipe cocok.

---

## 2.3 Navigasi — `App.tsx`

`View` union ([App.tsx:14](../../app/static/src/App.tsx#L14)) → tambah `"projects"`. `NAV_TABS` ([App.tsx:16](../../app/static/src/App.tsx#L16)) → tambah `{ value: "projects", label: "Projects" }` **di paling depan** (entry utama). Render di blok kondisional ([App.tsx:108-122](../../app/static/src/App.tsx#L108-L122)):

```tsx
{view === "projects" && <ProjectsRoot />}
```

`ProjectsRoot` (baru, `features/projects/ProjectsRoot.tsx`) memegang **nav stack in-screen** (bukan router):
```ts
type Nav =
  | { screen: "projects" }
  | { screen: "tasks"; project: Project }
  | { screen: "run"; project: Project; taskGroup: TaskGroup; runId: number };
```
Render breadcrumb (`Meta` + `Button variant="ghost"`) + layar sesuai `screen`. Console `useConsole` lama tetap di App untuk tab "console"; **jangan** dihapus di fase awal.

---

## 2.4 Layar Projects — `features/projects/ProjectsScreen.tsx`

Props: `onOpen(project)`. Isi:
- `useApiResource(fetchProjects)` (pola [HistoryList.tsx:26](../../app/static/src/features/console/HistoryList.tsx#L26)).
- List `Card interactive` per project (nama + folder + createdAt) → `onOpen`.
- Tombol "+ Project baru" → form (`Input` nama + `Input` folder + tombol "Browse…" → `useModals().openBrowse` untuk pilih folder) → `createProject` → reload.
- Tombol hapus per project → `useModals().openConfirm` → `deleteProject`.

Folder picker: `openBrowse` sudah dipakai di [ComposePanel.tsx:161](../../app/static/src/features/console/ComposePanel.tsx#L161) (backing `GET /api/fs/list`). Reuse.

---

## 2.5 Layar Task (dalam Project) — `features/projects/TaskListScreen.tsx`

Props: `project`, `onOpenRun(taskGroup, runId)`. Isi:
- `fetchTaskGroups(project.id)` → list `Card` per Task (nama + chip kategori via `Badge`).
- "+ Task baru": `Input` nama + **multi-select kategori** (checkbox/`Toggle` per kategori dari `fetchCategories()` [routingApi.ts:94](../../app/static/src/services/routingApi.ts#L94); simpan urutan pilih) → `createTaskGroup`.
- Per Task: tombol **"Run"** → `createRun(taskGroup.id)` → `onOpenRun(taskGroup, run.id)`. Tab/panel **"Riwayat run"** → `fetchRuns(taskGroup.id)`, klik run → `onOpenRun` (mode replay).
- Tombol hapus Task → confirm → `deleteTaskGroup`.

---

## 2.6 Run Workspace — `features/projects/RunWorkspace.tsx`

Props: `project`, `taskGroup`, `runId`. Isi:
- `fetchRunDetail(runId)` → `lanes` (urut = `taskGroup.categories`).
- Render **satu `ConsolePanel` per lane**, berdampingan (flex row, tiap panel `min-width` + horizontal scroll bila sempit — pola scroll `overflow-x:auto`).
- **Sekuensial**: lane pertama aktif; lane berikut **placeholder** (`Card` redup "menunggu delegasi") sampai `lane.taskId != null`.
- Poll ulang `fetchRunDetail` saat sebuah panel mencapai terminal / setelah delegasi, agar lane baru muncul.

---

## 2.7 ConsolePanel — `features/projects/ConsolePanel.tsx` (inti)

Satu **instance `useConsole` per panel** (self-contained; daemon + reducer sendiri — [useConsole.ts:18](../../app/static/src/state/useConsole.ts#L18)). Reuse potongan dari [ConsoleScreen.tsx](../../app/static/src/features/console/ConsoleScreen.tsx): `StreamView`, `ResultStrip`, `FollowUpStrip`, `AttemptsPanel`.

Props: `runId`, `category`, `laneTaskId: number | null`, `folderPath`, `onDelegated()`.

### Siklus attach vs submit
- **Lane 0 / lane yang belum jalan** (`laneTaskId == null`) → tampilkan compose kecil (prompt + Run). `submit` mengirim `RunRequest` **plus `task_run_id`** & `category` lane. (Extend `RunRequest` [state/types.ts:58](../../app/static/src/state/types.ts#L58) dgn `taskRunId?: number`, dan `sseDaemon.submit` menyertakan `task_run_id` di body POST `/api/tasks`.)
- **Lane hasil delegasi** (`laneTaskId != null`) → `useEffect` panggil `actions` daemon `attach(laneTaskId)` sekali saat mount → stream tersambung, reducer terisi.

> Tambah `attach` ke actions di `useConsole` ([useConsole.ts:60](../../app/static/src/state/useConsole.ts#L60)): `attach: (id) => daemonRef.current?.attach(id)`.

### Result-primary (tampilan utama)
- Default: render **`state.result.summary` / `final_output` sebagai markdown** (hasil terakhir). Cek dulu apakah ada util markdown di repo; bila tidak, tambah util ringan (mis. render heading/list/code sederhana) — **jangan** tambah dependency berat tanpa perlu.
- Toggle "stream" (`Button variant="ghost"`) → tampilkan `StreamView` (mode sekunder).

### Picker riwayat hasil
- Daftar hasil = semua `tasks` di lane ini: query via `fetchHistory`-style difilter `(task_run_id==runId, category)` **atau** endpoint kecil bila perlu; tiap item punya `final_output`.
- `Select`/list → pilih → tampilkan hasil task itu (reuse [fetchTranscript](../../app/static/src/services/historyApi.ts#L32) untuk detail). Default = terbaru.

### Delegasi (aksi eksplisit)
- Tampilkan tombol **"Delegasikan →"** saat panel `done` **dan** ada lane kategori berikutnya yang masih placeholder.
- Klik → modal (base [components/Modal.tsx](../../app/static/src/components/Modal.tsx) atau `openConfirm` diperluas): panggil `fetchArtifactCandidates(taskId)`; user pilih `finalOutput` atau salah satu `mdFiles` (radio) → tampil di `textarea` **editable** ("tambah/edit konteks") → tombol "Delegasikan" / "Execute tanpa edit".
- Submit → `delegate(taskId, nextCategory, artifactText)` → `onDelegated()` (RunWorkspace refetch detail → lane berikut `attach`).

### Minimize / maximize
- State lokal `minimized: boolean`. Tombol di header panel (`IconButton`).
- Saat minimized → render **chip**: `StatusDot` (dari `state.status`) + token `state.usage.total` (run ini) + `lane.tokensAccumulated` (akumulasi) + 1 baris ringkas `state.result?.summary`. Proses tetap jalan (daemon tidak di-dispose).
- Maximize → render penuh lagi.

---

## 2.8 Pembersihan (Fase 7)

- Hapus `onExecutePlan` palsu ([ConsoleScreen.tsx:74-79](../../app/static/src/features/console/ConsoleScreen.tsx#L74-L79)) & tombol "Eksekusi plan ini →" ([ResultStrips.tsx:56-60](../../app/static/src/features/console/ResultStrips.tsx#L56-L60)).
- Hapus `PLAN_STEPS` hardcoded & panel plan palsu di [ComposePanel.tsx:11-16](../../app/static/src/features/console/ComposePanel.tsx#L11-L16), 239-256.
- Ganti stub [WorkflowsScreen.tsx](../../app/static/src/features/config/WorkflowsScreen.tsx) → arahkan/gabung ke alur Projects (atau sembunyikan tab lama).

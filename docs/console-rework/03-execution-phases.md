# 03 — Fase Eksekusi

Kerjakan **berurut**. Tiap fase punya **kriteria terima**; jangan lanjut sebelum semua hijau. Perintah dijalankan dari root `Choros/`. Frontend build dari `app/static/`.

Rujukan detail: [01-backend.md](01-backend.md), [02-frontend.md](02-frontend.md).

---

## Fase 1 — Schema + API Project/Task/Run

**Kerjakan:**
1. `migrations/006_projects.sql` (§1.1).
2. `app/models.py`: `Project`, `TaskGroup`, `TaskRun` + 2 kolom di `Task` (§1.2).
3. `app/schemas.py`: schema baru + `TaskIn.task_run_id` (§1.3).
4. `app/api/projects.py`: endpoint projects/task-groups/runs + `get_run` (lanes/token) (§1.4).
5. Daftarkan `projects_router` di `app/api/__init__.py` (§1.6).

**Kriteria terima:**
- [ ] Server start tanpa error; log `apply_migrations` sukses.
- [ ] `psql`: tabel `projects`, `task_groups`, `task_runs` ada; `tasks` punya kolom `task_run_id`, `delegated_from_task_id`.
- [ ] curl end-to-end:
  ```bash
  curl -sX POST localhost:8000/api/projects -H 'content-type: application/json' \
    -d '{"name":"Demo","folder_path":"<folder valid>"}'          # → 201, id
  curl -s localhost:8000/api/projects                              # → list berisi Demo
  curl -sX POST localhost:8000/api/projects/<pid>/tasks -H 'content-type: application/json' \
    -d '{"name":"QC","categories":["text_planning","coding_complex"]}'   # → 201
  curl -sX POST localhost:8000/api/task-groups/<tid>/runs -d '{}'  # → 201, run id
  curl -s localhost:8000/api/task-runs/<rid>                       # → detail, lanes = 2, taskId null
  ```
- [ ] `folder_path` tak valid → `POST /api/projects` balas 400.
- [ ] `pytest` existing tetap hijau (`pytest -q`).

---

## Fase 2 — Eksekusi ke run + attach + delegate (backend)

**Kerjakan:**
1. `create_task` menyalurkan `task_run_id` + default `project_path` dari folder Project (§1.5.1).
2. `GET /api/tasks/{id}/artifact-candidates` (md-aware) (§1.5.2).
3. `POST /api/tasks/{id}/delegate` + `_delegate_prompt` (§1.5.3).

**Kriteria terima:**
- [ ] `POST /api/tasks` dengan `task_run_id` → task jalan; `GET /api/task-runs/<rid>` lane pertama kini punya `taskId` + `status`.
- [ ] Task menulis file di **folder live** project (bukan worktree) — cek `git status` di folder itu berubah saat mode interaktif.
- [ ] `artifact-candidates` mengembalikan `final_output`; bila task menulis `*.md`, file itu muncul di `md_files` dengan `content`.
- [ ] `POST /api/tasks/<tid>/delegate` `{to_category:"coding_complex", artifact:"..."}` → 201; task baru punya `task_run_id` sama, `delegated_from_task_id` terisi, `plan_artifact` terisi, `project_path` = folder live yang sama.
- [ ] `get_run` kini menampilkan lane kedua terisi.

---

## Fase 3 — Client + layar Projects & Task (frontend)

**Kerjakan:**
1. `services/projectApi.ts` (§2.1).
2. `App.tsx`: view `"projects"` + `ProjectsRoot` nav stack (§2.3).
3. `features/projects/ProjectsScreen.tsx` (§2.4) & `TaskListScreen.tsx` (§2.5).

**Kriteria terima:**
- [ ] `npm run build` (di `app/static/`) sukses, tanpa error TS.
- [ ] Tab "Projects" muncul & jadi entry; bisa buat/hapus Project (folder via Browse), buat/hapus Task dengan multi kategori.
- [ ] Klik "Run" pada Task membuka layar Run (kosong dulu) & memanggil `POST /runs`.
- [ ] Tab "Riwayat run" menampilkan run-run lama sebuah Task.

---

## Fase 4 — RunWorkspace + ConsolePanel interaktif

**Kerjakan:**
1. `attach` di `DaemonClient`/`sseDaemon`/`mockDaemon` + `useConsole.actions.attach` (§2.2, §2.7).
2. `RunRequest.taskRunId` + `sseDaemon.submit` menyertakan `task_run_id` (§2.7).
3. `features/projects/RunWorkspace.tsx` (§2.6) + `ConsolePanel.tsx` (submit lane 0, follow-up, StreamView) (§2.7).

**Kriteria terima:**
- [ ] `npm run build` sukses.
- [ ] Buka Run: lane pertama menampilkan compose; submit prompt → stream jalan; hasil muncul.
- [ ] Follow-up di lane pertama berfungsi (reply/lanjutan di sesi sama).
- [ ] Lane kedua tampil sebagai **placeholder** (belum ada task).
- [ ] Dua ConsolePanel = dua stream independen (tak saling ganggu) — buktikan dengan dua lane aktif setelah delegasi (Fase 5).

---

## Fase 5 — UI Delegasi (md-aware, editable)

**Kerjakan:**
1. Tombol "Delegasikan →" + modal artifact-candidates (pilih final_output / md, editable) → `delegate()` (§2.7).
2. RunWorkspace refetch detail → lane tujuan `attach` otomatis.

**Kriteria terima:**
- [ ] Setelah lane planning `done`, tombol "Delegasikan →" muncul.
- [ ] Modal menampilkan pilihan `final_output` + file `.md` (bila ada), teks bisa diedit.
- [ ] Klik delegasikan → lane coding hidup & streaming (via attach), memakai konteks plan.
- [ ] "Execute tanpa edit" mengirim artifact apa adanya.
- [ ] File hasil coding muncul di **folder live** project.

---

## Fase 6 — Result-primary + picker riwayat + minimize/maximize

**Kerjakan:**
1. ConsolePanel: hasil ter-render markdown sebagai tampilan utama; toggle stream (§2.7).
2. Picker riwayat hasil per lane (default terbaru; bisa ganti).
3. Minimize→chip (status + token run + token akumulasi + ringkas hasil); maximize.

**Kriteria terima:**
- [ ] Default tiap console = hasil terakhir ter-render rapi; tombol beralih ke raw stream.
- [ ] Picker menampilkan hasil-hasil sebelumnya (lintas follow-up/run) & bisa mengganti materi tampilan.
- [ ] Minimize menyembunyikan isi tapi chip menampilkan status + token (run & akumulasi) + ringkas; **proses tetap jalan** (stream lanjut saat di-maximize lagi).
- [ ] Token akumulasi cocok dengan `SUM` di `task_logs` (spot-check via `get_run`).

---

## Fase 7 — Pembersihan

**Kerjakan:** hapus jalur palsu `onExecutePlan`, `PLAN_STEPS`, tombol "Eksekusi plan ini →"; rapikan stub `WorkflowsScreen` (§2.8). Jadikan Projects entry utama.

**Kriteria terima:**
- [ ] `grep -rn "onExecutePlan\|PLAN_STEPS\|Eksekusi plan ini" app/static/src` → kosong.
- [ ] `npm run build` + `pytest -q` hijau.

---

## Verifikasi end-to-end (manual, butuh browser + folder git nyata)

Jalankan server + frontend. Skenario penuh:
1. Buat **Project** dengan folder repo git valid.
2. Buat **Task** "Quality Control" kategori `[text_planning, coding_complex]`.
3. **Run** → console planning: ketik prompt yang meminta plan (atau plan berupa `.md`).
4. Hasil planning ter-render markdown; bila `.md` dibuat, muncul di kandidat.
5. **Delegasikan** (edit konteks sedikit) → console coding_complex hidup, mengerjakan di folder live.
6. Cek file di folder project benar-benar berubah (`git status`).
7. **Minimize** planning saat coding jalan — proses tak berhenti.
8. Buka **Riwayat run** Task → replay run sebelumnya.
9. Regresi: tab **Console lama** + follow-up/reply masih normal.

---

## Catatan penyimpangan (diisi eksekutor)

> Bila realita kode berbeda dari dokumen (nama kolom `usage`, signature `apiSend`, key `data.path` event, dsb.), catat di sini: apa yang berbeda, keputusan yang diambil, file yang terpengaruh.

- (kosong)

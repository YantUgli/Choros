# Rencana adopsi ide Orca ke Choros

Referensi: [stablyai/orca](https://github.com/stablyai/orca) — ADE untuk mengorkestrasi
armada coding agent paralel. Choros mengambil **ide UX**-nya, bukan menirunya jadi IDE.
Yang **tidak** diadopsi: Design Mode, embedded Chromium, editor VS Code — itu mengaburkan
angle Choros sebagai "meja kendali orkestrasi", bukan lingkungan ngoding.

> **Revisi (selaras `feat/console-rework`).** Rencana ini disesuaikan dengan arsitektur
> baru **Project → Task → Run → Console(lane)** di branch `feat/console-rework`. Versi
> sebelumnya mengacu ke UI single-run lama (satu `useConsole`, tab Console) — sudah usang.

---

## Temuan arsitektural (baca dulu)

Branch `feat/console-rework` sudah mengubah fondasi yang dulu jadi penghalang:

- **Multi-console sudah nyata.** Tiap lane = satu instance `useConsole` sendiri
  (daemon + reducer per-panel) — [`ConsolePanel.tsx:40`](../app/static/src/features/projects/ConsolePanel.tsx).
  [`RunWorkspace.tsx`](../app/static/src/features/projects/RunWorkspace.tsx) merender
  **beberapa `ConsolePanel` berdampingan** (kolom, scroll horizontal) + rail **Pipeline**.
- **Tapi pipeline-nya SEKUENSIAL, bukan paralel.** Lane hilir (`coding_complex`) berupa
  placeholder "menunggu delegasi" sampai lane hulu (`text_planning`) **didelegasikan
  secara eksplisit** oleh user. Delegasi = aksi manual, bukan auto-pipeline
  (lihat [`docs/console-rework/README.md`](console-rework/README.md) §1).
- **Result-primary.** Tiap lane menampilkan hasil markdown terakhir + picker riwayat;
  stream jadi mode sekunder. Ada **minimize→chip** (status + token run + akumulasi lane)
  dan **rail Pipeline** (dot + kategori + token akumulatif per lane).
- Reducer sudah punya `ATTACH` + `taskRunId` ([`consoleMachine.ts`](../app/static/src/state/consoleMachine.ts),
  [`types.ts`](../app/static/src/state/types.ts)), **belum** punya `startedAt` (waktu mulai).

Konsekuensi untuk adopsi Orca:

- Layout "armada berdampingan" ala Orca **sudah ada** (RunWorkspace lanes + Pipeline rail).
  Yang kurang cuma **kekayaan info per-lane** (model, elapsed, meter token).
- Paradigma paralel Orca ("fan one prompt → N agent → merge pemenang") **tidak** cocok
  dengan pipeline sekuensial. Ia hanya masuk sebagai opsi **fan-out per-lane** (Item C,
  future) — dan justru sekarang lebih murah karena multi-instance `useConsole` sudah jalan.

Design system cukup — tanpa primitive baru (aturan [`components/ds/index.ts`](../app/static/src/components/ds/index.ts)):
`Card`, `StatusDot`, `MeterBar`, `Badge`, `Select`, `IconButton`, `Modal` semua sudah dipakai
di RunWorkspace/ConsolePanel.

---

## Urutan eksekusi & ketergantungan

```
A. Command palette (⌘K)            [independen, quick win]     ~0.5–1 hari
        │
B0. startedAt di ConsoleState      [enabler "elapsed"]         ~0.5 jam
        │
B. Header lane kaya + chip + Pipeline [butuh B0]               ~1–1.5 hari
        ┆
C. Fan-out per-lane (paralel + pemenang) [epik, spike backend] besar
```

Rekomendasi: A → B0 → B berurutan (semua frontend, nol backend). C dijadwalkan setelah B,
diawali spike backend.

---

## Item A — Command palette (⌘K)

**Tujuan:** navigasi cepat lintas Project/Task/Run/lane + aksi, tanpa mouse. Pure frontend.

**File:**
- Baru: `app/static/src/components/CommandPalette.tsx`.
- Ubah: [`App.tsx`](../app/static/src/App.tsx) — listener global + render; atau lebih baik
  di [`ProjectsRoot.tsx`](../app/static/src/features/projects/ProjectsRoot.tsx) yang
  memegang **nav stack** (`{screen:"projects"|"tasks"|"run"}`), supaya palette bisa
  memindah layar langsung.
- Reuse: [`Modal.tsx`](../app/static/src/components/Modal.tsx) + `Input` sebagai overlay.

**Registry perintah (grup):**
- **Navigasi** — buka Projects; buka Task/Run tertentu (dari `fetchProjects`/`fetchTaskGroups`/`fetchRuns`).
- **Lane · run ini** — `Delegasikan {cat} → {next}` (panggil `openDelegate` yang sudah ada
  di ConsolePanel), Ciutkan/Buka semua lane, toggle Stream/Hasil.
- **Task** — Run baru (`createRun`), buka Riwayat run.

**Langkah:** listener `(⌘|Ctrl)+K` (pola keydown sudah dipakai di ConsoleScreen lama);
filter substring; ↑/↓/Enter/Esc; `preventDefault` (⌘K/⌘J bentrok shortcut browser).

**Selesai:** ⌘K buka di layar mana pun; Enter mengeksekusi (pindah layar / delegasi);
nol dependensi npm.

---

## Item B0 — `startedAt` di ConsoleState (enabler)

**Tujuan:** waktu mulai run agar "elapsed" bisa dihitung **jujur** (bukan progress % palsu).

**File:** [`types.ts`](../app/static/src/state/types.ts),
[`consoleMachine.ts`](../app/static/src/state/consoleMachine.ts).

**Langkah:**
1. Tambah `startedAt: string | null` ke `ConsoleState`.
2. Set `startedAt = event.ts` pada case `SUBMIT` **dan** `ATTACH`; `null` saat `RESET`.
3. Elapsed dihitung di komponen: `now - Date.parse(startedAt)`, format `m s` / `h m`.

**Selesai:** test [`consoleMachine.test.ts`](../app/static/src/state/consoleMachine.test.ts)
menegaskan `startedAt` terisi saat submit/attach.

> **Jangan tiru "progress 58%" Orca** — CLI agent tak punya progress deterministik.
> Choros lebih jujur: **elapsed + token + fase** (`thinking`/`tool_call`/`file_edit`).

---

## Item B — Header lane kaya + chip minimize + rail Pipeline

**Tujuan:** menaikkan kepadatan info per-lane ke level kartu-agent Orca, pakai data yang
Choros sungguh punya. Semua di dalam komponen yang sudah ada.

### B1 — Sub-header enriched di `ConsolePanel`
**File:** [`ConsolePanel.tsx`](../app/static/src/features/projects/ConsolePanel.tsx) —
header saat ini (baris ~108) cuma `StatusDot + Badge(kategori) + "status · → route" + toggle + minimize`.

Tambah **baris kedua** di header: `chip model` · `⏱ elapsed` (dari B0) ·
`MeterBar token` (`state.usage.total` vs `token_limit` agent). Data:
- model → `state.route` / model teresolusi target aktif.
- token berjalan → `state.usage.total` (sudah ada).
- batas → `token_limit` agent via `fetchQuota`/`fetchAgents` (join per target aktif).

### B2 — Chip minimize enriched
Chip minimize (ConsolePanel baris ~89) sudah tampil `token run · Σ akumulasi`.
Tambah **MeterBar mini** + `StatusDot pulse` agar status kebaca sekilas (semangat
"glanceable" Orca / monitoring mobile).

### B3 — Rail Pipeline enriched
**File:** [`RunWorkspace.tsx`](../app/static/src/features/projects/RunWorkspace.tsx) rail kanan
(baris ~117). Sekarang: dot + kategori + token akumulatif teks. Tambah **MeterBar mini** +
`⏱ elapsed` per lane; konektor `│` tetap. Ini bikin rail jadi "peta armada" ringkas.

**Data (nol backend baru):** `state.usage.total`, `state.route`, `state.status`,
`startedAt` (B0), `lane.tokensAccumulated` (sudah dari `fetchRunDetail`),
`token_limit` (`agentApi`), sisa quota (`quotaApi`).

**Selesai:** header tiap lane menampilkan model + elapsed berjalan + meter token; chip &
rail Pipeline ikut kaya; nol warna hardcode (aturan `styles/tokens/colors.css`); nol primitive baru.

**Risiko:** rendah. Titik hati-hati: join `(agent, model)` toleran `model = null`/`"—"`.

---

## Item C — Fan-out per-lane (paralel + pilih pemenang) — epik

**Tujuan:** menerjemahkan paradigma **paralel** Orca ke pipeline sekuensial: jalankan
**satu lane** (mis. `coding_complex`) di **N agent serentak**, bandingkan hasil, **pilih
pemenang** untuk didelegasikan ke lane berikutnya. Bukan tweak — fitur baru.

**Kenapa sekarang lebih murah:** multi-instance `useConsole` sudah terbukti jalan
(satu per panel). Fan-out = merender **N `ConsolePanel` untuk kategori yang sama** dalam
satu lane, bukan refactor state inti.

**Spike backend dulu:**
- Endpoint fan-out: satu prompt → N `tasks` konkuren dalam `(task_run_id, category)` yang sama,
  masing-masing agent berbeda. Runner sekarang cascade sekuensial — lihat `app/orchestrator/`,
  `app/api/tasks.py`.
- **Folder live = bahaya tabrakan.** README console-rework §6 sudah menandai: banyak lane
  menulis folder sama berisiko. Fan-out **wajib worktree terisolasi per cabang** (escape-hatch
  isolasi yang disebut sebagai v2) — ini prasyarat, bukan opsional.
- Kuota: N run paralel membakar kuota N× — perlu guard.

**Frontend (setelah spike hijau):**
- Lane bisa berisi **grup N panel** (tab/grid mini) alih-alih satu.
- Aksi **"pilih pemenang"** → `delegate(winnerTaskId, nextCategory, artifact)` (mekanisme
  `delegate` sudah ada di [`projectApi.ts`](../app/static/src/services/projectApi.ts)),
  cabang lain di-discard.

**Selesai (target epik):** dari satu lane, fan-out ≥2 agent; keduanya live berdampingan;
user pilih satu → jadi artefak delegasi ke lane berikut, sisanya dibuang.

**Risiko:** tinggi (backend + isolasi worktree + biaya kuota). Keputusan produk, bukan sekadar teknis.

---

## Ringkasan tabel

| Item | Nilai | Usaha | Backend? | Prasyarat |
|---|---|---|---|---|
| A. Command palette ⌘K | Menengah | ~0.5–1 hari | Tidak | — |
| B0. startedAt | (enabler) | ~0.5 jam | Tidak | — |
| B. Header lane + chip + Pipeline kaya | Tinggi | ~1–1.5 hari | Tidak | B0 |
| C. Fan-out per-lane (paralel + pemenang) | Sangat tinggi | Besar (epik) | Ya | spike + isolasi + B |

Estimasi kasar, satu pengembang. A/B0/B memakai data & komponen yang sudah ada di
`feat/console-rework` → risiko rendah, bisa dikapalkan bertahap. Hanya C yang butuh
backend + keputusan isolasi worktree.

---

## Branch kerja

Item A/B0/B menyentuh komponen yang **hanya ada di `feat/console-rework`**
(`features/projects/*`) — tak ada di `main`. Jadi implementasi dilakukan **di atas
`feat/console-rework`**, bukan `main`. Alur yang disarankan: branch baru dari console-rework
(mis. `feat/orca-enrichments`) → PR balik ke `feat/console-rework`, supaya rework tetap
utuh dan enrichment bisa direview terpisah.

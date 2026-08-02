# Rencana data nyata cockpit — mencabut `fixtures.ts` dari layar produksi

> **Status:** rencana, belum dikerjakan.
> **Basis:** `79049e6` (branch `feat/cockpit-frontend`).
> **Prasyarat:** `docs/rencana-paritas-cockpit.md` dan `docs/koreksi-paritas-cockpit.md` sudah selesai
> dan terverifikasi (55 tes frontend, 111 tes backend hijau di `79049e6`).
>
> **Masalah pokok:** dari enam tab di cockpit, hanya **Console** yang bicara ke backend. Lima
> tab lain merender `app/static/src/data/fixtures.ts` — 405 baris angka dan teks yang ditulis
> tangan dari file desain hi-fi. Backend-nya sendiri **sudah jadi dan lengkap**; yang putus
> murni kabel di sisi frontend.

---

## 0. Konteks lingkungan — baca ini dulu

Sama seperti dua dokumen sebelumnya; diulang karena dokumen ini akan dieksekusi terpisah.

- **Shell:** PowerShell 5.1. Tidak ada `&&`, tidak ada `??`, tidak ada ternary.
  `Out-File -Encoding utf8` **menyisipkan BOM** — jangan dipakai untuk menulis berkas sumber.
  Untuk menulis TS/TSX dari shell pakai `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.
- **Git:** `rebase -i` dan `add -p` tidak tersedia di lingkungan ini. Partisi commit dilakukan
  dengan `reset --soft` + staging selektif.
- **Tidak ada gerbang lint TS.** `package.json` hanya punya `dev`/`build`/`preview`/`test`/`test:watch`/`typecheck`.
  Spasi ekor dan komentar berbahasa Inggris **tidak akan ketahuan otomatis** — periksa manual.
- **`vitest` berjalan di `environment: "node"`.** Tidak ada DOM, `fetch`, atau `EventSource`.
  Konsekuensi yang mengikat seluruh rencana ini: **semua logika pemetaan wire→UI harus jadi
  fungsi murni yang diekspor**, terpisah dari komponen dan dari `fetch`. Itu satu-satunya
  bagian yang bisa diuji. Pola yang sudah ada dan harus diikuti: `toAttemptRows()` di
  `src/services/taskApi.ts` (murni, teruji) vs `fetchAttempts()` (I/O, diuji lewat `vi.stubGlobal`).

Perintah verifikasi:

```powershell
# backend — suite penuh (~5m20s)
python -m pytest -q

# frontend
cd app/static
npx tsc -b
npx vitest run
npm run build
```

> **Ingat:** FastAPI menyajikan `app/static/dist` (`app/main.py:26`), **bukan** `src/`.
> Mengedit `src/` tanpa `npm run build` tidak mengubah apa pun di `localhost:8000`,
> dan tidak ada peringatan apa pun soal itu.

---

## 1. Peta kabel — apa yang nyata, apa yang karangan

Dipetakan dari knowledge graph (`mcp__codebase-memory`, indeks `choros` @ `79049e6`,
1363 node / 5862 edge — SHA indeks identik dengan HEAD, jadi peta ini bukan basi).

### 1.1 Yang sudah nyata

| Pemakai | Endpoint | Berkas |
|---|---|---|
| `createSseDaemon` | `POST /api/tasks` | `services/sseDaemon.ts:431` |
| `createSseDaemon` | `GET /api/tasks/{id}/stream` (SSE) | `:373` |
| `createSseDaemon` | `POST /api/tasks/{id}/reply` | `:416` |
| `createSseDaemon` | `POST /api/tasks/{id}/cancel` | `:467` |
| `createSseDaemon` | `GET /api/tasks/{id}` (rekonsiliasi) | `:312` |
| `createSseDaemon` | `GET /api/tasks/{id}/diff` (hanya hitung `+/−`) | `:325` |
| `fetchAttempts` | `GET /api/tasks/{id}/logs` + `GET /api/agents` | `services/taskApi.ts:49,54` |

Total: **8 endpoint dipakai** dari 41 endpoint API yang terdaftar (di luar `/healthz` dan `/`).

### 1.2 Yang masih karangan

| Layar | Konstanta fixture | Endpoint yang sudah ada tapi tak dipanggil |
|---|---|---|
| Console → Riwayat | `SESSIONS` (`fixtures.ts:85`) | `GET /api/tasks`, `GET /api/tasks/{id}/events` |
| Quota | `QUOTA_WINDOWS` (`:323`), `CONSUMPTION_7D` (`:359`) | `GET /api/quota`, `GET /api/quota/summary`, `POST /api/quota/reset` |
| Agents | `AGENTS` (`:374`) | `GET/POST/PUT/DELETE /api/agents`, `GET /api/agents/adapters` |
| Routing | `ROUTE_CHAINS` (`:189`) | `GET/POST/PUT/DELETE /api/routing`, `GET /api/tasks/categories` |
| Compose | `CATEGORIES` (`:52`), `PLAN_STEPS` (`:382`) | `GET /api/tasks/categories` |
| Modal Diff | `DIFF_FILE`/`DIFF_LINES` (`:396`) | `GET /api/tasks/{id}/diff` (isi lengkap), `POST .../merge`, `POST .../discard` |
| Modal Browse | `FS` (`:28`) | — tidak ada endpoint filesystem |
| Modal Agent | `ADAPTERS` (`:12`) | `GET /api/agents/adapters` (sebagian, lihat §2.3) |
| Users | — layar placeholder | `GET/POST/DELETE /api/users` |
| Workflows | — layar placeholder | 9 endpoint workflow lengkap |
| Header "daemon ok" | hardcode `status="ok"` (`App.tsx:65`) | `GET /healthz` |

**Koreksi terhadap laporan lisan sebelumnya:** saya sempat menyebut backend "punya GET/POST"
untuk agents dan routing. Query graf menunjukkan yang sebenarnya **CRUD penuh** —
`PUT /api/agents/{agent_id}`, `DELETE /api/agents/{agent_id}`, `PUT /api/routing/{rule_id}`,
`DELETE /api/routing/{rule_id}` semuanya ada (`app/api/agents.py`, fungsi `update_agent`,
`delete_agent`, `update_routing`, `delete_routing`). Grep saya waktu itu hanya memfilter
`@router.get|@router.post`. Artinya layar Agents dan Routing bisa dibuat benar-benar
bisa-tulis, bukan sekadar baca.

---

## 2. Tiga jurang data — keputusan yang harus diambil sebelum menulis kode

Ini bagian terpenting dokumen ini. Tiga field di UI **tidak punya sumber di backend sama
sekali**. Tidak bisa diselesaikan dengan "panggil endpoint yang benar". Masing-masing butuh
keputusan sadar, dan dua di antaranya menyentuh keputusan produk yang sudah tertulis di PRD.

### 2.1 Quota tidak punya `max` — dan itu memang disengaja

`QuotaScreen.tsx:41` merender `<MeterBar value={q.used} max={q.max} />`. Fixture memberi
`max: 200000`.

Model `QuotaWindow` (`app/models.py:175-190`) punya kolom: `id`, `user_id`, `agent_id`,
`model`, `window_type`, `window_start`, `window_end`, `tokens_used`, `is_exhausted`.
**Tidak ada kolom batas.** `QuotaOut` juga tidak. Pencarian `token_limit|max_tokens|limit`
di seluruh `app/models.py` dan `app/orchestrator/quota.py` hanya menemukan `.limit(1)` SQL.

Ini bukan kelalaian. `app/orchestrator/quota.py:3-5` menyatakannya:

> *"Catatan jujur (PRD §10): langganan tidak mengekspos 'sisa X pesan'. Yang dilacak di sini
> adalah konsumsi yang kita amati sendiri + status mentok yang dideteksi dari 429. Tidak ada
> endpoint yang ditembak untuk menebak sisa kuota."*

Meter bar rasio `used/max` **secara desain tidak bisa dijujurkan.** Angka 200.000 itu
karangan yang menyamar sebagai pengukuran.

**Keputusan: buang `MeterBar` dari QuotaScreen.** Ganti dengan token terpakai + rentang
window (`window_start`–`window_end`) + status. Yang hilang cuma sugesti visual "kamu di 34%
kuota" yang memang tidak pernah kita ketahui.

Alternatif yang **ditolak**: menambah kolom `token_limit` yang diisi user manual. Itu
memindahkan karangan dari fixture ke database — angkanya tetap tidak berasal dari provider,
tapi sekarang terlihat resmi karena keluar dari API. Lebih buruk, bukan lebih baik.

### 2.2 Routing tidak punya `floor` per target

`RouteTarget` (`fixtures.ts:177-187`) punya `floor: number | null`, dirender sebagai
"floor —" di RoutingScreen.

`RoutingRule` (`app/models.py:53-60`) punya: `id`, `category`, `agent_id`, `model`, `priority`.
**Tidak ada `quality_floor`.** `RoutingRuleIn`/`Out` juga tidak.

Quality floor di choros hidup di dua tempat lain: `Task.quality_floor` (per tugas, dikirim
lewat `TaskIn.quality_floor` dari ComposePanel) dan `WorkflowStep.quality_floor` (per langkah
workflow). Konsepnya memang per-eksekusi, bukan per-target-rute.

**Keputusan: buang kolom `floor` dari RoutingScreen.** UI-nya menjanjikan konfigurasi yang
tidak ada tempat penyimpanannya; menampilkannya sebagai "—" permanen lebih menyesatkan
daripada tidak ada.

Kalau kelak floor per-target memang diinginkan, itu perubahan skema + migrasi + logika
`router.py`, dan pantas jadi rencana sendiri — bukan disisipkan ke pekerjaan penyambungan kabel.

### 2.3 Daftar model per adapter tidak ada di backend

`ADAPTERS` (`fixtures.ts:12-23`) memetakan adapter → daftar model
(`claude_code: ["sonnet", "opus-4", "haiku"]`, dst). Komentarnya berbunyi *"model default
WAJIB dipilih dari daftar ini, bukan diketik"* — jadi ini kontrak UI, bukan sekadar contoh.

`GET /api/agents/adapters` memanggil `describe_adapters()` (`app/adapters/registry.py:58-66`),
yang mengembalikan `{adapter_type, has_hands, subscription_bound}`. **Tidak ada daftar model.**

**Keputusan: pertahankan `ADAPTERS` sebagai satu-satunya sisa fixture yang boleh hidup**,
tapi pindahkan ke berkas sendiri dengan nama yang jujur — `src/data/katalogModel.ts` — dan
beri komentar kepala yang menyatakan ini katalog statis yang dirawat tangan, bukan data
runtime. Daftar model yang tersedia untuk sebuah langganan memang tidak bisa ditanyakan ke
CLI mana pun secara andal; mengarang endpoint untuk itu cuma memindahkan katalog tangan ke
sisi server.

Yang **tetap** diambil dari `GET /api/agents/adapters`: daftar `adapter_type` yang sah
(sekarang berasal dari `Object.keys(ADAPTERS)`) dan flag `has_hands`/`subscription_bound`
yang saat ini tidak ditampilkan sama sekali padahal berguna di modal editor.

---

## 3. Ruang lingkup

**Dikerjakan** (§4.1–§4.7):

1. Fondasi `services/api.ts`
2. Quota → nyata
3. Agents → nyata, CRUD penuh
4. Routing → nyata, CRUD penuh
5. Riwayat Console → nyata
6. Modal Diff → nyata, termasuk merge/discard yang selama ini tidak berbuat apa-apa
7. Pembersihan `fixtures.ts` + indikator kesehatan header

**Tidak dikerjakan di rencana ini** (dicatat di §9, bukan disembunyikan):

- Layar **Users** dan **Workflows**. Keduanya placeholder kosong, backend-nya lengkap, tapi
  keduanya butuh desain layar dari nol — itu pekerjaan membangun fitur, bukan menyambung kabel.
- Modal **Browse** (`FS`). Tidak ada endpoint filesystem dan menambahnya berarti membuka
  pembacaan direktori sembarang lewat HTTP — keputusan keamanan yang butuh pertimbangan sendiri.
- `PLAN_STEPS` di ComposePanel. Artefak rencana datang dari alur workflow yang belum ada layarnya.

---

## 4. Kerjaan rinci

### 4.1 — Fondasi: `src/services/api.ts`

Sebelum lima layar mulai ber-`fetch`, satu pintu bersama. Saat ini `taskApi.ts` dan
`sseDaemon.ts` masing-masing punya `base` dan penanganan error sendiri.

**Alasan yang mengikat:** autentikasi. `app/security.py:65-86` — `get_current_user` memakai
cookie, **kecuali** `auth_disabled()` bernilai true (tidak ada `admin_password_hash` di
settings **dan** tidak ada user ber-password di DB). Di setup lokal terbuka, auth mati dan
`fetch` polos berhasil — itulah sebabnya Console jalan tanpa login. **Begitu user memasang
password, kelima layar baru ini serentak kena 401 tanpa pesan apa pun.** Pintu bersama
membuat itu jadi satu perbaikan, bukan lima.

Berkas baru:

```ts
/**
 * Satu pintu untuk semua panggilan HTTP cockpit.
 *
 * Auth: backend mematikan pemeriksaan cookie selama belum ada user ber-password
 * (app/security.py:auth_disabled). Begitu password dipasang, semua panggilan di
 * sini balas 401 — ditandai lewat ApiError.status supaya layar bisa membedakan
 * "belum login" dari "backend mati".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const API_BASE = "";

export async function apiGet<T>(path: string, base = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  base = API_BASE,
): Promise<T | null> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} → ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}
```

Dan satu hook bersama untuk pola muat-ulang yang akan dipakai empat layar:

```ts
// src/state/useApiResource.ts
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../services/api";

export type Resource<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "error"; status: number | null; message: string };

export function useApiResource<T>(load: () => Promise<T>): [Resource<T>, () => void] {
  const [res, setRes] = useState<Resource<T>>({ phase: "loading" });
  // Penanda muat-ulang; `load` sengaja tidak masuk dependency karena pemanggil
  // hampir selalu memberi lambda baru tiap render.
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let batal = false;
    setRes({ phase: "loading" });
    load()
      .then((data) => {
        if (!batal) setRes({ phase: "ready", data });
      })
      .catch((e: unknown) => {
        if (batal) return;
        const status = e instanceof ApiError ? e.status : null;
        setRes({ phase: "error", status, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return [res, reload];
}
```

> **Peringatan yang sudah pernah menggigit di dokumen sebelumnya:** `load` sengaja **tidak**
> masuk dependency array. Kalau dimasukkan, setiap render induk membuat lambda baru → fetch
> baru → render → fetch. Ini persis cacat 4 di `koreksi-paritas-cockpit.md` (`onEmpty` yang
> tidak stabil), dan di sini bentuknya lebih berbahaya karena benar-benar tidak terbatas.
> Kalau nanti mau memasukkannya, pemanggil **wajib** membungkus `load` dengan `useCallback`.

**Ubah `taskApi.ts` memakai `apiGet`** — jangan biarkan dua pola hidup berdampingan.

### 4.2 — Quota nyata

Berkas baru: `src/services/quotaApi.ts`.

Bagian tersulit bukan `fetch`-nya, melainkan **`GET /api/quota` tidak mengembalikan bentuk
yang dipakai UI.** `list_windows()` (`app/orchestrator/quota.py:175-181`) mengembalikan
**semua baris `quota_windows` apa adanya** — termasuk:

- window `cooldown` **dan** window token sebagai **baris terpisah** untuk (agent, model) yang sama;
- window yang **sudah kedaluwarsa** (`window_end <= now`), karena `list_windows` tidak
  memfilter apa pun — berbeda dengan `is_exhausted()` (`:78-90`) yang memfilter.

Kalau frontend merender hasilnya mentah-mentah, layar Quota akan menampilkan cooldown yang
sudah lewat sebagai "masih mentok", selamanya. Itu lebih buruk dari fixture.

Maka pemetaannya **harus mencerminkan `is_exhausted()`**, dan itu perlu dinyatakan sebagai
alasan di komentar, karena teks kaki QuotaScreen (`:105-108`) menjanjikan *"satu sumber
kebenaran"* dengan pesan halted di Console. Hari ini janji itu bohong; setelah ini benar,
tapi hanya selama logikanya tetap kembar.

```ts
import { apiGet, apiSend } from "./api";
import type { WireAgent } from "./taskApi";

export interface WireQuotaWindow {
  id: number;
  agent_id: number;
  model: string | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
  tokens_used: number;
  is_exhausted: boolean;
}

export interface WireUsageRow {
  agent_id: number;
  agent: string;
  model: string | null;
  runs: number;
  tokens: number;
  rate_limited: number;
}

export interface QuotaRow {
  key: string;
  agentId: number;
  agent: string;
  model: string | null;
  used: number;
  windowType: string | null;
  windowEnd: string | null;
  /** detik tersisa sampai cooldown lepas; null = tidak sedang cooldown */
  cooldownLeft: number | null;
  exhausted: boolean;
}

/** Window dianggap hidup persis seperti app/orchestrator/quota.py:_get_*_window. */
function aktif(w: WireQuotaWindow, nowMs: number): boolean {
  return w.window_end === null || Date.parse(w.window_end) > nowMs;
}

/**
 * Gabungkan baris cooldown + baris token per (agent, model).
 *
 * Cerminan `is_exhausted()` di backend: cooldown aktif menang duluan, baru
 * window token yang `is_exhausted`. Kalau dua logika ini berpisah, klaim
 * "satu sumber kebenaran" di kaki layar Quota jadi bohong lagi.
 */
export function toQuotaRows(
  windows: WireQuotaWindow[],
  agents: WireAgent[],
  nowMs: number,
): QuotaRow[] {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const grouped = new Map<string, { cooldown?: WireQuotaWindow; token?: WireQuotaWindow }>();

  for (const w of windows) {
    if (!aktif(w, nowMs)) continue;
    const key = `${w.agent_id}::${w.model ?? ""}`;
    const slot = grouped.get(key) ?? {};
    if (w.window_type === "cooldown") slot.cooldown = w;
    else slot.token = w;
    grouped.set(key, slot);
  }

  return [...grouped.entries()]
    .map(([key, { cooldown, token }]) => {
      const agentId = cooldown?.agent_id ?? token?.agent_id ?? 0;
      const agent = agentMap.get(agentId);
      const model = cooldown?.model ?? token?.model ?? null;
      const cooldownLeft =
        cooldown && cooldown.window_end
          ? Math.max(0, Math.round((Date.parse(cooldown.window_end) - nowMs) / 1000))
          : null;
      return {
        key,
        agentId,
        agent: agent?.name || `agent #${agentId}`,
        model: model ?? agent?.default_model ?? null,
        used: token?.tokens_used ?? 0,
        windowType: token?.window_type ?? null,
        windowEnd: token?.window_end ?? null,
        cooldownLeft,
        exhausted: cooldownLeft !== null || (token?.is_exhausted ?? false),
      };
    })
    .sort((a, b) => a.agent.localeCompare(b.agent) || (a.model ?? "").localeCompare(b.model ?? ""));
}

export interface ConsumptionRow {
  target: string;
  runs: number;
  tokens: number;
  limits: number;
}

export function toConsumptionRows(rows: WireUsageRow[]): ConsumptionRow[] {
  return rows.map((r) => ({
    target: `${r.agent} / ${r.model ?? "—"}`,
    runs: r.runs,
    tokens: r.tokens,
    limits: r.rate_limited,
  }));
}

export function formatCooldown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export async function fetchQuota(): Promise<{ rows: QuotaRow[]; consumption: ConsumptionRow[] }> {
  const [windows, agents, summary] = await Promise.all([
    apiGet<WireQuotaWindow[]>("/api/quota"),
    apiGet<WireAgent[]>("/api/agents"),
    apiGet<WireUsageRow[]>("/api/quota/summary?days=7"),
  ]);
  return {
    rows: toQuotaRows(windows, agents, Date.now()),
    consumption: toConsumptionRows(summary),
  };
}

export async function resetQuota(agentId: number, model: string | null): Promise<void> {
  await apiSend("POST", "/api/quota/reset", { agent_id: agentId, model });
}
```

**Catatan bagus:** `GET /api/quota/summary` (`app/api/quota.py:32-66`) memetakan **persis**
ke `CONSUMPTION_7D` — `agent`, `model`, `runs`, `tokens`, `rate_limited` ↔ `target`, `runs`,
`tokens`, `limits`. Tabel "Konsumsi 7 hari" bisa dijujurkan tanpa kompromi apa pun.

**Perubahan `QuotaScreen.tsx`:**

1. `const [res, reload] = useApiResource(fetchQuota)` — tiga fase: memuat / siap / gagal.
   Fase gagal **harus menyebut penyebab**, bukan tabel kosong: 401 → "belum login",
   lainnya → "daemon tidak menjawab" + tombol coba lagi.
2. **Buang `MeterBar`** (§2.1). Grid `260px 1fr 170px 190px` jadi `260px 1fr 190px`;
   kolom tengah diisi rentang window (`daily · berakhir 14:20`) alih-alih bar.
3. Kolom token: `{fmt(used)} tok` — tanpa `/ max`.
4. **Countdown harus hidup.** Fixture menyimpan `"02:14:33"` sebagai string mati. Sekarang
   `cooldownLeft` adalah detik, jadi:

   ```tsx
   // Cooldown dihitung dari selisih waktu, jadi harus berdetak sendiri — kalau tidak,
   // angkanya beku sampai user pindah tab dan kembali.
   const [, tick] = useState(0);
   useEffect(() => {
     const id = setInterval(() => tick((n) => n + 1), 1000);
     return () => clearInterval(id);
   }, []);
   ```

   Turunkan `cooldownLeft` terhadap waktu berjalan, dan **panggil `reload()` saat mencapai 0**
   — supaya baris pindah dari "cooldown" ke "tersedia" tanpa refresh manual.
5. Tombol **reset** per baris cooldown → `resetQuota()` lalu `reload()`. Endpoint
   `POST /api/quota/reset` sudah ada dan sudah teruji di backend, tapi belum punya tombol
   di mana pun. Label harus jujur soal artinya: *"saya yakin kuotanya sudah pulih"*
   (kalimat itu diambil dari docstring `clear_exhausted`).
6. Ubah teks kaki: sekarang klaim "satu sumber kebenaran" **boleh** berdiri, tapi tambahkan
   kalimat yang menjelaskan tidak adanya batas — misalnya *"tidak ada angka 'sisa kuota':
   langganan tidak mengekspornya, jadi yang ditampilkan hanya yang benar-benar tercatat choros."*

### 4.3 — Agents nyata (CRUD penuh)

Berkas baru: `src/services/agentApi.ts`.

```ts
export interface WireAgentFull {
  id: number;
  name: string;
  adapter_type: string;
  base_url: string | null;
  default_model: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
}

export interface WireAdapterInfo {
  adapter_type: string;
  has_hands: boolean;
  subscription_bound: boolean;
}

export interface AgentRow {
  id: number;
  name: string;
  adapter: string;
  model: string;
  active: boolean;
}

export function toAgentRows(agents: WireAgentFull[]): AgentRow[] {
  return [...agents]
    .sort((a, b) => a.id - b.id)
    .map((a) => ({
      id: a.id,
      name: a.name,
      adapter: a.adapter_type,
      model: a.default_model || "—",
      active: a.is_active,
    }));
}
```

Plus `fetchAgents()`, `createAgent(body)`, `updateAgent(id, body)`, `deleteAgent(id)` —
`AgentIn` (`app/schemas.py:34-41`) menuntut `name`, `adapter_type` (Literal empat nilai),
`base_url?`, `default_model?`, `config`, `is_active`.

**Perubahan `AgentsScreen.tsx`:**

- `useState<AgentRow[]>(AGENTS)` → `useApiResource(fetchAgents)`.
- `upsert()` yang hari ini hanya mengubah state → `createAgent`/`updateAgent` lalu `reload()`.
- Tombol hapus yang hari ini `prev.filter(...)` → `deleteAgent(id)` lalu `reload()`.
  **Hapus adalah aksi yang sulit dibatalkan** — beri konfirmasi, dan sadari
  `delete_agent` di backend bisa gagal karena foreign key dari `routing_rules`/`task_logs`;
  tampilkan pesan servernya, jangan telan.
- `AgentRow` sekarang butuh `id` (fixture tidak punya). Semua pemanggil `upsert(row, index)`
  yang mengandalkan **indeks array** harus pindah ke **id** — indeks tidak stabil setelah
  data datang dari server dengan urutan sendiri.
- **`AgentEditorModal`**: daftar adapter dari `GET /api/agents/adapters`, bukan
  `Object.keys(ADAPTERS)`. Daftar model tetap dari katalog statis (§2.3). Tambahkan
  penanda `subscription_bound` — informasi yang sudah tersedia gratis dari backend dan
  langsung menjelaskan kenapa sebuah agent tidak punya `base_url`.

### 4.4 — Routing nyata (CRUD penuh)

Berkas baru: `src/services/routingApi.ts`.

Pemetaan yang perlu diperhatikan: UI bekerja dengan **rantai berurutan per kategori**,
backend menyimpan **baris datar dengan `priority`**. Urutan = `priority` menaik.

```ts
export interface WireRoutingRule {
  id: number;
  category: string;
  agent_id: number;
  model: string | null;
  priority: number;
}

export interface RouteTarget {
  id: number;
  agentId: number;
  agent: string;
  adapter: string;
  model: string | null;
  /** label gabungan, mencerminkan Target.label di app/orchestrator/router.py */
  label: string;
  quotaExhausted: boolean;
  quotaLabel: string;
}

export function toRouteChains(
  rules: WireRoutingRule[],
  agents: WireAgentFull[],
  quota: QuotaRow[],
): Record<string, RouteTarget[]> { /* … */ }
```

Tiga hal yang harus benar di sini:

1. **`label` wajib memakai aturan yang sama dengan `Target.label`** di
   `app/orchestrator/router.py:57-59` — `agent.name/model` kalau ada model, kalau tidak
   `agent.name` saja. Itu perbaikan yang baru saja masuk di commit `6d97ec0` (berhenti
   mengarang model `"default"`); jangan hidupkan lagi karangannya di sisi frontend.
2. **`quotaLabel` sekarang bisa nyata** dengan menggabungkan `QuotaRow` dari §4.2 —
   inilah yang membuat rantai routing benar-benar informatif: "target #2 sedang cooldown"
   adalah fakta, bukan dekorasi.
3. **Buang `floor`** (§2.2).

**Perubahan `RoutingScreen.tsx`:**

- Kategori dari `GET /api/tasks/categories` (`{value,label}`), bukan konstanta `CATEGORIES`.
- Drag-drop urutan → hitung ulang `priority` untuk baris yang berpindah, kirim
  `PUT /api/routing/{id}` per baris yang berubah, lalu `reload()`.
  **Optimistic update wajib**: tanpa itu, kartu akan melompat balik ke posisi lama selama
  request berjalan dan drag-drop-nya terasa rusak.
- `addTarget` → `POST /api/routing`; hapus target → `DELETE /api/routing/{id}`.
- `addCategory` hari ini menambah kunci ke objek lokal. Backend tidak punya konsep
  "kategori kosong" — kategori hanya ada kalau ada `routing_rules` yang menyebutnya, dan
  daftar sahnya dari `/api/tasks/categories`. **Buang tombolnya**, ganti dengan pemilih
  kategori yang sudah tersedia.

### 4.5 — Riwayat Console nyata

Ini bagian dengan pemakaian ulang paling besar, dan itu ditemukan dari graf, bukan dari
membaca berkas satu per satu.

**`GET /api/tasks/{id}/events` mengembalikan bentuk yang identik dengan yang dikirim SSE.**
`load_task_events()` (`app/orchestrator/runner.py:742-755`) menghasilkan
`{seq, type, agent, model, ts, data}` — persis `interface WireEvent` di `sseDaemon.ts:23-40`.

Artinya `toConsoleEvents()` (`sseDaemon.ts:173-258`, sudah diekspor, kompleksitas kognitif 36,
sudah dipakai 3 pemanggil) **bisa dipakai ulang apa adanya** untuk merender transkrip
historis. Tidak perlu penerjemah kedua, dan yang lebih penting: transkrip riwayat akan
menampilkan run persis seperti saat ditonton live. Dua penerjemah berbeda pasti akan
menyimpang cepat atau lambat.

Berkas baru: `src/services/historyApi.ts`.

```ts
export interface HistoryItem {
  id: number;
  prompt: string;
  category: string;
  mode: string;
  status: string;
  createdAt: string | null;
}

export function toHistoryItems(tasks: WireTaskOut[]): HistoryItem[];

/** Transkrip satu run historis: event → ConsoleEvent (mapper yang sama dengan SSE). */
export async function fetchTranscript(taskId: number): Promise<{
  events: ConsoleEvent[];
  attempts: AttemptRow[];
}>;
```

`fetchTranscript` memanggil `GET /{id}/events` + `GET /{id}/logs` bersamaan, lalu:
- event → `toConsoleEvents(w, null)` per event, di-flatten;
- log → **`toAttemptRows()` yang sudah ada** dari `taskApi.ts` — rantai eksekusi riwayat
  memakai pemeta yang sama dengan panel jejak run aktif.

> **Catat:** `toConsoleEvents` menerima `partialId` untuk menggabungkan potongan `output.partial`.
> Untuk transkrip historis, potongan partial **sudah** tersimpan sebagai baris terpisah di DB.
> Melewatkan `null` menghasilkan satu `LOG_DELTA` dengan `streamId` baru per potongan, yang
> akan tampil terpecah-pecah. **Ini perlu diuji lebih dulu terhadap satu run nyata**, dan
> kalau memang terpecah, jawabannya adalah menyimpan satu `partialId` per (agent, model)
> selama iterasi — bukan menulis mapper kedua.

**Perubahan `HistoryList.tsx` + `ConsoleScreen.tsx`:**

- `SESSIONS.map(...)` → daftar dari `GET /api/tasks?limit=50`.
- Card "run aktif" tetap paling atas dan tetap dari state daemon.
- **Run aktif tidak boleh dobel.** Setelah run selesai ia akan muncul juga di `GET /api/tasks`.
  Saring `item.id === state.runId` dari daftar riwayat.
- Klik item → `fetchTranscript(id)` → `TranscriptView`. `TranscriptView` hari ini menerima
  `Session` (fixture) dengan `messages: TranscriptMessage[]`; ubah agar menerima
  `ConsoleEvent[]` + `AttemptRow[]` sehingga bisa memakai `StreamView` yang sudah ada.
  Ini penyederhanaan, bukan penambahan: satu komponen penampil, bukan dua.
- Riwayat perlu **muat ulang saat run selesai** — panggil `reload()` ketika `state.status`
  masuk terminal, kalau tidak run yang baru kelar tidak akan muncul sampai refresh halaman.

### 4.6 — Modal Diff nyata + merge/discard yang benar-benar bekerja

Dua cacat terpisah di sini, dan yang kedua lebih serius.

**(a) Isi diff palsu.** `DiffModal.tsx:3` merender `DIFF_FILE`/`DIFF_LINES`. Sementara itu
`sseDaemon.ts:322-330` **sudah** mengambil `GET /api/tasks/{id}/diff` yang berisi diff
sungguhan, tapi hanya menghitung jumlah `+`/`−`/berkas dan **membuang teksnya**. Jadi
angka ringkasan di ResultStrip nyata, sementara baris diff di modal fiksi — kombinasi
yang paling mudah menipu mata, karena angkanya cocok-cocok saja dengan yang di atas.

Perbaikan: `DiffModal` mengambil sendiri `GET /api/tasks/{id}/diff` dan mem-parse teks
unified diff jadi `DiffLine[]`:

```ts
/** Parser unified-diff seadanya: cukup untuk pewarnaan, bukan untuk menerapkan patch. */
export function toDiffLines(diff: string): DiffLine[] {
  return diff.split("\n").map((text) => {
    if (text.startsWith("+++") || text.startsWith("---")) return { tone: "muted", text };
    if (text.startsWith("+")) return { tone: "add", text };
    if (text.startsWith("-")) return { tone: "del", text };
    return { tone: "muted", text };
  });
}
```

Fungsi murni, jadi bisa diuji. Perhatikan urutan: `+++`/`---` **harus** diperiksa sebelum
`+`/`-`, kalau tidak kepala berkas ikut terwarnai sebagai penambahan.

**(b) Tombol merge dan discard tidak melakukan apa-apa.** `ConsoleScreen.tsx:249-251`:

```tsx
onDiff={() => modals.openDiff(state.runId, actions.reset)}
onMerge={actions.reset}
onDiscard={actions.reset}
```

Ketiganya berujung `actions.reset` — yaitu **hanya membersihkan layar**. Endpoint
`POST /api/tasks/{id}/merge` dan `POST /api/tasks/{id}/discard` ada, teruji di backend, dan
tidak pernah dipanggil. Artinya user yang menekan "merge" hari ini percaya worktree-nya
sudah digabung padahal tidak — dan discard meninggalkan worktree menggantung di disk.

Ini cacat paling merugikan di seluruh daftar, karena satu-satunya gejalanya adalah pekerjaan
yang diam-diam hilang. Perbaikan: panggil endpointnya, tunggu hasilnya, baru `reset()`.
Kalau gagal, **jangan reset** — tampilkan errornya dan biarkan hasilnya tetap di layar.

### 4.7 — Pembersihan

1. `fixtures.ts` menyusut jadi hanya `FS` (modal Browse, di luar lingkup) dan `PLAN_STEPS`.
   `ADAPTERS` pindah ke `src/data/katalogModel.ts` (§2.3). Sisanya — `SESSIONS`,
   `QUOTA_WINDOWS`, `CONSUMPTION_7D`, `AGENTS`, `ROUTE_CHAINS`, `DIFF_FILE`, `DIFF_LINES`,
   `CATEGORIES` — **dihapus**. Komentar kepala berkas diperbarui: ia sekarang mengaku
   "kelak datang dari daemon", dan itu tidak lagi benar untuk yang tersisa.
2. **Indikator "daemon ok" di header** (`App.tsx:65`) hardcode `status="ok"` — lampu hijau
   yang tidak pernah merah. Sambungkan ke `GET /healthz` dengan polling ~15 detik.
   Kecil, tapi ini indikator yang paling sering dipercaya orang begitu saja.
3. Cek ulang tidak ada `import ... from "../../data/fixtures"` tersisa di luar dua konsumen
   yang disengaja.

---

## 5. Tes yang harus ditulis

Ingat batas `environment: "node"`: komponen React dan `EventSource` **tidak bisa** diuji.
Yang diuji adalah fungsi murni dan pemetaan.

### `src/services/quotaApi.test.ts` — berkas baru

| # | Kasus | Kenapa penting |
|---|---|---|
| 1 | `toQuotaRows` menggabungkan baris cooldown + token untuk (agent, model) yang sama jadi **satu** baris | ini kesalahan yang paling mungkin terjadi saat render mentah |
| 2 | Window dengan `window_end` di masa lalu **dibuang** | `list_windows` tidak memfilter; tanpa ini cooldown basi abadi |
| 3 | `window_end === null` dianggap **aktif** | cermin `_get_token_window` |
| 4 | Cooldown aktif → `exhausted === true` walau `token.is_exhausted === false` | cermin urutan prioritas `is_exhausted()` |
| 5 | `token.is_exhausted === true` tanpa cooldown → `exhausted === true`, `cooldownLeft === null` | membedakan dua sebab mentok |
| 6 | `agent_id` tak dikenal → `"agent #N"`, tidak melempar | pola sama dengan `toAttemptRows` |
| 7 | `model === null` → jatuh ke `default_model` agent | cermin `Target.label` |
| 8 | `toConsumptionRows` memetakan `rate_limited` → `limits` | satu-satunya field yang berubah nama |
| 9 | `formatCooldown(8073) === "02:14:33"` | angka ini persis yang ada di fixture lama — bukti tandingan yang enak dibaca |

### `src/services/routingApi.test.ts` — berkas baru

| # | Kasus |
|---|---|
| 1 | Rantai terurut menaik menurut `priority` |
| 2 | `label` = `nama/model`; tanpa model → `nama` saja (cermin `router.py:57-59`) |
| 3 | Target yang cocok dengan `QuotaRow` exhausted → `quotaExhausted === true` |
| 4 | Rule dengan `agent_id` yatim tidak menghilangkan rule lain di kategori itu |

### `src/services/agentApi.test.ts` — berkas baru

`toAgentRows`: urutan stabil menurut `id`, `default_model === null` → `"—"`,
`is_active` diteruskan apa adanya.

### `src/services/diffApi.test.ts` — berkas baru

`toDiffLines`: `+++`/`---` jadi `muted` (bukan `add`/`del`), baris `+`/`-` biasa terwarnai,
string kosong → array kosong atau satu baris kosong (tetapkan mana, lalu kunci dengan tes).

### `src/services/historyApi.test.ts` — berkas baru

`toHistoryItems`: urutan dipertahankan (backend sudah `ORDER BY created_at DESC`), field
`finished_at === null` tidak bikin crash.

### Tes I/O — pola `vi.stubGlobal`

Ikuti `taskApi.test.ts` yang sudah ada. **Perbaiki kelemahannya sekalian:** di berkas itu
`vi.unstubAllGlobals()` duduk di badan tes, bukan di `afterEach` — satu assertion gagal
akan meninggalkan `fetch` ter-stub dan meracuni tes berikutnya. Untuk berkas baru,
`afterEach(() => { vi.unstubAllGlobals(); })` sejak awal.

Minimal satu tes I/O: `fetchQuota` menggabungkan tiga respons paralel dengan benar, dan
`ApiError.status` terisi saat respons 401.

### Backend

**Tidak ada perubahan backend di rencana ini.** Semua endpoint sudah ada dan sudah teruji
(111 tes hijau). Jalankan `pytest -q` sekali di akhir sebagai bukti tidak ada yang tersenggol.

---

## 6. Urutan eksekusi & commit

Tujuh commit. **Setiap commit wajib hijau sendiri** (`npx tsc -b` + `npx vitest run`) —
inilah yang gagal di eksekusi sebelumnya dan perlu perbaikan sejarah; jangan diulang.

| # | Commit | Isi |
|---|---|---|
| 1 | `feat(web): fondasi klien API bersama` | `services/api.ts`, `state/useApiResource.ts`, `taskApi.ts` beralih ke `apiGet` |
| 2 | `feat(web): layar Quota dari data nyata` | `quotaApi.ts` + tes, `QuotaScreen.tsx`, buang `MeterBar`, countdown hidup, tombol reset |
| 3 | `feat(web): CRUD agent lewat API` | `agentApi.ts` + tes, `AgentsScreen.tsx`, `AgentEditorModal.tsx` |
| 4 | `feat(web): rantai routing dari routing_rules` | `routingApi.ts` + tes, `RoutingScreen.tsx` |
| 5 | `feat(web): riwayat run dari task_events` | `historyApi.ts` + tes, `HistoryList.tsx`, `TranscriptView.tsx`, `ConsoleScreen.tsx` |
| 6 | `fix(web): merge/discard benar-benar memanggil daemon` | `DiffModal.tsx`, `toDiffLines` + tes, `ConsoleScreen.tsx` |
| 7 | `chore(web): cabut fixture dari layar produksi` | susutkan `fixtures.ts`, `katalogModel.ts`, `/healthz` di header |

**Kenapa urutan ini.** Commit 2 mendahului 4 karena `RoutingScreen` memakai `QuotaRow` dari
`quotaApi.ts` untuk status kuota per target — kalau dibalik, commit 4 tidak akan
ter-typecheck sendirian. Commit 3 mendahului 4 karena `routingApi` memakai `WireAgentFull`.
Commit 6 berdiri sendiri dan bisa didahulukan kalau ingin memperbaiki kehilangan-diam
merge/discard lebih cepat — dan ada argumen kuat untuk itu (§4.6b).

Commit 7 terakhir supaya tiap commit sebelumnya masih bisa dibuild walau fixture belum dicabut.

---

## 7. Verifikasi manual

Semua ini butuh browser dan backend hidup. **Sebelas langkah verifikasi dari dua dokumen
sebelumnya belum pernah dijalankan siapa pun** — jangan tumpuk utang ketiga di atasnya.

Persiapan: `python -m uvicorn app.main:app --reload`, lalu `cd app/static; npm run build`.
Buka `localhost:8000`.

1. **Quota — kosong.** DB baru, belum ada run. Layar Quota harus menampilkan keadaan kosong
   yang menjelaskan ("belum ada konsumsi tercatat"), bukan tabel kosong tanpa keterangan.
2. **Quota — setelah satu run.** Jalankan satu tugas sampai selesai. Baris (agent, model)
   muncul dengan token yang **cocok** dengan yang tampil di panel Jejak eksekusi Console.
   Kalau berbeda, salah satu pemeta salah.
3. **Quota — konsumsi 7 hari.** Baris `runs` bertambah 1 setelah run kedua.
4. **Quota — cooldown.** Picu 429 (atau sisipkan baris `quota_windows` bertipe `cooldown`
   dengan `window_end` 2 menit ke depan). Badge berubah, countdown **berdetak tiap detik**,
   dan saat mencapai 00:00:00 baris berpindah sendiri ke "tersedia" tanpa refresh.
5. **Quota — reset.** Tombol reset pada baris cooldown → baris langsung lepas dari cooldown.
   Konfirmasi di DB: `is_exhausted` jadi `false`.
6. **Agents — baca.** Daftar cocok dengan `SELECT id,name,adapter_type,default_model,is_active FROM agents`.
7. **Agents — tulis.** Tambah agent, **refresh halaman**, agent masih ada. (Ini yang hari ini
   gagal: fixture hilang saat refresh.) Ubah model, refresh, perubahan bertahan.
8. **Agents — hapus yang dipakai routing.** Harus memunculkan pesan error dari server,
   bukan menghilang dari layar lalu muncul lagi saat refresh.
9. **Routing — urutan.** Seret target ke posisi lain, refresh, urutan bertahan.
   Cek `priority` di DB benar-benar berubah.
10. **Routing — status kuota.** Dengan satu target dalam cooldown (langkah 4), target itu
    ditandai di rantai routing.
11. **Riwayat — daftar.** Setelah tiga run, sidebar menampilkan tiga item, terbaru di atas,
    dan run aktif **tidak dobel**.
12. **Riwayat — transkrip.** Klik run lama: transkripnya **sama** dengan yang tampil saat
    ditonton live. Perhatikan khusus baris `output.partial` — inilah risiko yang ditandai di §4.5.
13. **Riwayat — rantai.** Run yang mengalami cascade menampilkan seluruh percobaannya,
    bukan cuma yang terakhir.
14. **Diff — isi.** Jalankan tugas mode otonom. Buka diff: isinya **berkas yang benar-benar
    berubah**, bukan `src/auth/token.ts`. (Kalau masih muncul `src/auth/token.ts`, fixture
    masih terpasang.)
15. **Merge.** Tekan merge, lalu `git log` di project path: commit-nya benar-benar ada.
16. **Discard.** Tekan discard, lalu cek direktori worktree benar-benar hilang dari disk.
17. **Header.** Matikan backend. Titik "daemon ok" harus berubah merah dalam ~15 detik.
18. **Auth aktif.** Pasang password (`POST /api/auth/password`), refresh cockpit. Kelima layar
    harus menampilkan "belum login", bukan tabel kosong atau layar putih.

---

## 8. Daftar periksa selesai

- [ ] `npx tsc -b` bersih
- [ ] `npx vitest run` hijau; jumlah tes bertambah dari 55 ke ~85
- [ ] `npm run build` sukses dan `dist/` diperbarui
- [ ] `python -m pytest -q` tetap 111 hijau
- [ ] Tiap commit dari 7 commit hijau **sendiri-sendiri** (checkout terpisah, bukan dinilai dari daftar berkas)
- [ ] Tidak ada `import` dari `data/fixtures` di luar `FS` dan `PLAN_STEPS`
- [ ] Tidak ada spasi ekor pada berkas baru (tidak ada gerbang lint — periksa manual)
- [ ] Seluruh komentar berbahasa Indonesia, konsisten dengan berkas sekitarnya
- [ ] `vi.unstubAllGlobals()` di `afterEach`, bukan di badan tes
- [ ] 18 langkah verifikasi manual §7 dijalankan dan dicatat hasilnya
- [ ] `docs/catatan-implementasi.md` diperbarui: jurang data §2.1–§2.3 dicatat sebagai
      keputusan, lengkap dengan alasannya
- [ ] Indeks knowledge graph di-refresh setelah selesai (`index_repository` mode `moderate`)
      supaya peta ini tidak basi untuk pekerjaan berikutnya

---

## 9. Sengaja tidak dikerjakan — utang yang dicatat, bukan disembunyikan

1. **Layar Users.** Backend lengkap (`GET/POST/DELETE /api/users`, `POST /api/auth/password`).
   Layarnya placeholder. Butuh desain dari nol termasuk alur ganti password — pekerjaan fitur,
   bukan penyambungan kabel.
2. **Layar Workflows.** Sembilan endpoint siap pakai, termasuk alur persetujuan
   (`approve_run`/`reject_run`) yang justru bagian paling menarik. Ini rencana tersendiri
   dan kemungkinan yang paling besar dari semuanya.
3. **Modal Browse (`FS`).** Tidak ada endpoint filesystem. Menambahnya berarti mengekspos
   pembacaan direktori lewat HTTP — keputusan keamanan yang tidak boleh diselundupkan ke
   dalam pekerjaan kosmetik. Sementara ini biarkan, atau ganti jadi input teks bebas dengan
   validasi di sisi server saat tugas dibuat.
4. **`PLAN_STEPS`.** Artefak rencana milik alur workflow; ikut dengan butir 2.
5. **`max` kuota, `floor` routing, katalog model.** Lihat §2 — ketiganya keputusan sadar
   untuk **tidak** mengarang sumber data, bukan pekerjaan yang tertunda.
6. **Paginasi riwayat.** `GET /api/tasks?limit=50` dibatasi 200 di server. Di atas itu perlu
   paginasi; belum relevan untuk instans satu orang.
7. **Nit dari `koreksi-paritas-cockpit.md` §5** yang belum dikerjakan: spasi ekor dan komentar
   berbahasa Inggris di `mockDaemon.test.ts`, assert kembar di `mockDaemon.test.ts:66-67`,
   `cachedAgents` yang tidak dibersihkan setelah tes. Kecil, tapi masih terbuka.

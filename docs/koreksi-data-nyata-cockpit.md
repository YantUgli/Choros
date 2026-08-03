# Rencana eksekusi: perbaikan cockpit Routing / Quota / Transcript

> Dokumen ini ditulis untuk dieksekusi oleh agent lain yang tidak punya
> konteks percakapan sebelumnya. Semua klaim di bawah diverifikasi langsung
> terhadap isi berkas di disk — bukan diasumsikan dari commit message atau
> dokumen rencana sebelumnya. Kalau ada perbedaan antara apa yang tertulis di
> sini dan isi berkas saat kamu membacanya, **percaya isi berkas**, dan
> perbarui pemahamanmu — jangan terapkan patch secara buta tanpa memverifikasi
> `old_string`-nya masih cocok persis.

---

## 0. Konteks lingkungan (baca ini dulu)

- **Repo**: `C:\project\Choros`, git repository, branch `feat/cockpit-frontend`.
- **Stack**: backend FastAPI + SQLAlchemy async di `app/` (Python); frontend
  React 18 + TypeScript 5 + Vite 5 + vitest 2.1.9 di `app/static/`.
- **FastAPI menyajikan `app/static/dist`**, bukan `app/static/src` (`main.py:26`).
  Mengedit `src/` tanpa `npm run build` tidak mengubah apa pun di `localhost:8000`.
- **Semua perintah frontend** (`npx tsc -b`, `npx vitest run`, `npm run build`)
  dijalankan dari `app/static/`, bukan dari root repo.
- **Windows/PowerShell**: `python` tidak ada di PATH. Interpreter ada di
  `C:\project\Choros\.venv\Scripts\python.exe`. `pytest` harus dijalankan dari
  **root repo**, bukan dari `app/static` (dari sana ia mengumpulkan 0 tes).
- **Jangan pernah membuka, mengutip, atau mengirim isi `.env` di root repo** —
  berisi `GROQ_API_KEY` dan `CHOROS_SECRET_KEY` yang hidup.
- **Tidak ada eslint di repo ini** — tidak ada `.eslintrc*`/`eslint.config.*`,
  tidak ada skrip `lint` di `package.json`. Ini relevan: kelas cacat utama di
  dokumen ini (pelanggaran Rules of Hooks) tidak tertangkap `tsc` maupun
  vitest, dan tidak ada linter yang menangkapnya juga. Lihat §7.

---

## 1. TEMUAN PENTING: pohon kerja tidak bersih, dan ada regresi di dalamnya

Sebelum menulis rencana ini, `git status --short` menunjukkan 13 berkas
termodifikasi + 1 berkas baru **yang belum ter-commit**, di atas commit
terakhir `e376888`:

```
 M app/static/src/App.tsx
 M app/static/src/components/modals/BrowseModal.tsx
 M app/static/src/features/agents/AgentsScreen.tsx
 M app/static/src/features/console/AttemptsPanel.tsx
 M app/static/src/features/console/ComposePanel.tsx
 M app/static/src/features/console/ConsoleScreen.tsx
 M app/static/src/features/console/TranscriptView.tsx
 M app/static/src/features/quota/QuotaScreen.tsx
 M app/static/src/features/routing/RoutingScreen.tsx
 M app/static/src/services/quotaApi.test.ts
 M app/static/src/services/routingApi.test.ts
 M app/static/src/services/routingApi.ts
 M app/static/src/state/modals.tsx
?? app/static/src/components/modals/ConfirmModal.tsx
```

**Sebelum menyentuh apa pun**, jalankan `git status --short` dan `git diff`
lagi untuk memastikan keadaan ini belum berubah sejak dokumen ini ditulis.
Kalau berbeda, jangan terapkan patch §3 secara buta — verifikasi dulu bahwa
`old_string` di tiap patch masih cocok persis dengan isi berkas saat ini.

### 1.1 Yang sudah diperbaiki oleh WIP ini (bagus, jangan dikerjakan ulang)

| Berkas | Perbaikan |
|---|---|
| `RoutingScreen.tsx`, `QuotaScreen.tsx`, `AgentsScreen.tsx` | badge/label Indonesia (`tersedia`/`limit` menggantikan `active`/`exhausted`) |
| `AgentsScreen.tsx`, `ConsoleScreen.tsx` | `window.confirm()`/`alert()` diganti `modals.openConfirm()` lewat `ConfirmModal.tsx` yang baru |
| `App.tsx`, `ConsoleScreen.tsx` | `await import(...)` dinamis diganti impor statis biasa (menghilangkan peringatan Rollup) |
| `BrowseModal.tsx`, `ComposePanel.tsx` | komentar `// data contoh` ditambahkan di atas `FS`/`PLAN_STEPS` |
| `ComposePanel.tsx` | dropdown kategori kini menampilkan status loading/error, bukan diam kosong saat `/api/tasks/categories` gagal |
| `quotaApi.test.ts` | menambahkan tes 401 untuk `fetchQuota` |
| `AttemptsPanel.tsx`, `TranscriptView.tsx` | `AttemptsPanel` menerima `initialRows` opsional dan `TranscriptView` mengirim data yang sudah diambil — mencegah `GET /logs` ganda |
| `routingApi.ts` | field `originalModel` ditambahkan ke `RouteTarget`; `reorder` di `RoutingScreen.tsx` memakainya (tidak lagi memaku model warisan saat digeser) |

### 1.2 Regresi yang disuntikkan WIP ini — HARUS diperbaiki

**`routingApi.ts` — kunci kuota dibalik ke model mentah.**

Commit `e376888` (sebelumnya, benar):
```tsx
const qKey = `${agent.id}::${model ?? ""}`;   // model = rule.model ?? agent.default_model
```

Kondisi saat ini di disk (WIP, salah):
```tsx
const qKey = `${agent.id}::${rule.model ?? ""}`;   // mentah
```

Bukti kenapa yang mentah salah — window kuota di backend **selalu** tersimpan
dengan model teresolusi:
- `app/orchestrator/router.py:85` — `Target(agent=agent, model=rule.model or agent.default_model, …)`
- `app/orchestrator/runner.py:408` — `quota.is_exhausted(…, model=target.model)`
- `app/orchestrator/runner.py:599` — `quota.mark_exhausted(…, model=target.model)`
- `app/orchestrator/runner.py:617` — `quota.record_usage(…, model=target.model)`

Rule dengan `model: null` (mewarisi `default_model` agent) mencari kunci
`"3::"`, sementara window tersimpan sebagai `"3::sonnet"` → tidak ketemu →
`quotaLabel` jatuh ke `"—"`, target yang sedang cooldown tampil seolah sehat.

**`routingApi.test.ts` — fixture diubah untuk mencocokkan bug, bukan perilaku benar.**

```tsx
// e376888 (benar):
{ key: "1::def", agentId: 1, agent: "Agent 1", model: "def", … },
// WIP saat ini (salah, dibuat cocok dengan qKey mentah di atas):
{ key: "1::", agentId: 1, agent: "Agent 1", model: "def", … },
```

Tes tetap hijau karena fixture-nya ikut dibengkokkan. Ini kenapa gerbang vitest
tidak cukup — lihat §0 soal tidak adanya eslint, dan §4 soal tes yang perlu
mengunci regresi ini secara eksplisit.

### 1.3 Yang masih belum dikerjakan WIP ini (cacat lama, tetap perlu diperbaiki)

- `RoutingScreen.tsx` menambahkan `const [errorMsg, setErrorMsg] = useState(...)`
  tepat **setelah** satu `return` awal — pelanggaran Rules of Hooks yang baru,
  lihat C1 di §2.
- Urutan pemeriksaan `phase === "loading"` sebelum `phase === "error"` tidak
  diubah — cabang error tetap kode mati (C2).
- `editTarget` masih mengisi modal dengan `t.model` (teresolusi), bukan
  `t.originalModel` yang baru ditambahkan — jadi menyunting target memaku
  model warisan (C4). Hanya `reorder` yang sudah diperbaiki, bukan `editTarget`.
- `fetchAgents()` di `editTarget` dan `addTarget` masih di luar `try` (C6).
- `TranscriptView.tsx` masih merender `AttemptsPanel` dan `CascadePanel`
  berdampingan, keduanya menampilkan data percobaan yang sama (C7).
- `onEmpty={() => {}}` masih dikirim ke `AttemptsPanel` dari `TranscriptView`
  (C8) — lambda baru tiap render di dependency array.
- `QuotaScreen.tsx` masih memanggil `setTimeout(reload, 0)` di badan render (C5).

---

## 2. Delapan cacat yang tersisa — rincian

### C1 — `RoutingScreen` memanggil hook setelah early return → layar crash

`app/static/src/features/routing/RoutingScreen.tsx` (baris ~45-48 saat ini):

```tsx
  if (res.phase === "loading" || !optimisticChains) {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;   // <- keluar
  }
  const [errorMsg, setErrorMsg] = useState<string | null>(null);          // <- hook ke-8
```

Jejak render:
1. Render 1 — `phase === "loading"` → keluar sebelum baris `useState` di atas. **7 hook terpanggil.**
2. Render 2 — data tiba, `phase === "ready"`, tapi `optimisticChains` masih
   `null` (efek pengisiannya baru jalan setelah commit) → keluar lagi. **7 hook.**
3. Render 3 — `optimisticChains` sudah terisi → jatuh terus melewati baris
   `useState` itu. **8 hook.**

React melempar `Rendered more hooks than during the previous render.` pada
render ke-3. **Tab Routing crash setiap kali dibuka dengan daemon hidup** —
bukan sesekali, tapi setiap kali.

### C2 — cabang error `RoutingScreen` adalah kode mati

Saat `res.phase === "error"`, efek yang mengisi `optimisticChains` tidak
pernah jalan, jadi `optimisticChains` selamanya `null` → syarat
`"loading" || !optimisticChains` menang duluan → **"Memuat..." selamanya.**
Blok pesan error (401 / daemon mati) di bawahnya tidak pernah terjangkau.

### C3 — lihat §1.2 di atas (regresi, sudah dijelaskan lengkap)

### C4 — menyunting target memaku model warisan ke database

`RoutingScreen.tsx` mengisi modal `editTarget` dengan `model: t.model`
(**teresolusi**, field lama), padahal `RouteTarget.originalModel` (field baru
dari WIP ini) sudah tersedia justru untuk kasus ini. Pengguna membuka "ubah"
hanya untuk mengganti agent, tidak menyentuh kolom model — tapi kolom itu
sudah terlanjur terisi model warisan, dan tersimpan sebagai nilai konkret saat
disimpan. Rule yang tadinya `model: null` ("ikut default agent") berubah
menjadi terpaku; mengubah `default_model` agent setelah itu tidak berpengaruh
lagi pada rule tersebut.

### C5 — `setTimeout(reload, 0)` di badan render `QuotaScreen`

`app/static/src/features/quota/QuotaScreen.tsx`:

```tsx
  const needsReload = cooldowns.some((q) => q.left <= 0);
  if (needsReload) {
    // Timeout untuk mencegah react warning update during render
    setTimeout(reload, 0);
  }
```

Efek samping saat render. Countdown-nya sendiri sudah hidup (dihitung ulang
tiap detik lewat `cooldownEnd`), jadi jalur ini benar-benar aktif setiap kali
cooldown kedaluwarsa. Di React 18 StrictMode badan render dijalankan dua kali
→ dua `reload()` untuk satu cooldown yang kedaluwarsa. Tidak menyebabkan loop
tak berujung (window kedaluwarsa disaring saat fetch berikutnya), tapi ini
pola yang salah menempel pada satu-satunya jalur muat-ulang otomatis di layar
itu.

### C6 — `fetchAgents()` di luar `try` pada `editTarget` / `addTarget`

```tsx
  const editTarget = async (t: RouteTarget, index: number) => {
    const agents = await fetchAgents();      // <- di luar try
    modals.openAgent(…)
```

Kalau panggilan ini gagal (401, daemon mati), promise ditolak tanpa
penangkap: modal tidak pernah terbuka, `errorMsg` tetap kosong, layar diam
total. Pengguna mengklik baris dan tidak terjadi apa-apa. Sama persis di
`addTarget`.

### C7 — `TranscriptView` menampilkan daftar percobaan dua kali

`TranscriptView.tsx` merender `AttemptsPanel` **dan** `CascadePanel`
berdampingan. Keduanya menampilkan `res.attempts` yang sama dalam bentuk
berbeda. Bandingkan dengan `ConsoleScreen.tsx` yang sengaja tidak begitu:

```tsx
{showAttempts && <AttemptsPanel taskId={state.runId} onEmpty={onAttemptsEmpty} />}
{showCascade && !showAttempts && (<CascadePanel … />)}
```

Riwayat harusnya tampil sama dengan live — itu klaim inti dari
`rencana-data-nyata-cockpit.md`. Di sini ia tampil berbeda, dan lebih berisik.

### C8 — `onEmpty={() => {}}` menempel di dependency effect yang rapuh

`TranscriptView.tsx` mengirim lambda baru tiap render ke prop `onEmpty` yang
duduk di dependency array `useEffect` milik `AttemptsPanel`. Saat ini **tidak
berbahaya** karena `initialRows` selalu diberikan sehingga effect keluar lebih
dulu — tapi kontraknya rapuh: begitu `initialRows` dihapus, cacat lama
"`GET /logs` sekali per render induk" hidup lagi. `ConsoleScreen` menjaga ini
dengan `useCallback` eksplisit; `TranscriptView` menumpang keberuntungan, dan
lebih baik `onEmpty` dijadikan opsional supaya prop ini tidak perlu dikirim
sama sekali di jalur yang tidak membutuhkannya.

---

## 3. Patch — literal, siap diterapkan dengan Edit tool

Semua blok "current" di bawah diverifikasi cocok persis dengan isi berkas di
disk pada saat dokumen ini ditulis. **Verifikasi ulang sebelum menerapkan.**

### Patch 1 — `RoutingScreen.tsx`: urutan hook + urutan cabang (C1 + C2)

File: `app/static/src/features/routing/RoutingScreen.tsx`

Current:
```tsx
export function RoutingScreen() {
  const modals = useModals();
  const [res, reloadData] = useApiResource(fetchRoutingData);
  const [catsRes] = useApiResource(fetchCategories);
  
  const [optimisticChains, setOptimisticChains] = useState<Record<string, RouteTarget[]> | null>(null);
  
  const [cat, setCat] = useState<string>("coding_complex");
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Optimistic update
  useEffect(() => {
    if (res.phase === "ready") {
      setOptimisticChains(res.data);
    }
  }, [res]);

  if (res.phase === "loading" || !optimisticChains) {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reloadData} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const categories = catsRes.phase === "ready" ? catsRes.data : [];
```

New:
```tsx
export function RoutingScreen() {
  const modals = useModals();
  const [res, reloadData] = useApiResource(fetchRoutingData);
  const [catsRes] = useApiResource(fetchCategories);
  const [optimisticChains, setOptimisticChains] = useState<Record<string, RouteTarget[]> | null>(null);
  const [cat, setCat] = useState<string>("coding_complex");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Optimistic update
  useEffect(() => {
    if (res.phase === "ready") {
      setOptimisticChains(res.data);
    }
  }, [res]);

  // Urutan penting: saat res.phase === "error", efek di atas tidak pernah
  // mengisi optimisticChains, jadi syarat "loading" di bawah akan menelan
  // status error kalau diperiksa lebih dulu.
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reloadData} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }
  if (res.phase === "loading" || !optimisticChains) {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }

  const categories = catsRes.phase === "ready" ? catsRes.data : [];
```

### Patch 2 — `RoutingScreen.tsx`: import tipe agent

Current (baris impor terakhir di berkas):
```tsx
import { fetchAgents } from "../../services/agentApi";
```

New:
```tsx
import { fetchAgents, type WireAgentFull } from "../../services/agentApi";
```

### Patch 3 — `RoutingScreen.tsx`: `editTarget` — model warisan + bungkus fetchAgents (C4 + C6)

Current:
```tsx
  const editTarget = async (t: RouteTarget, index: number) => {
    const agents = await fetchAgents();
    modals.openAgent(
      {
        title: `Ubah target ${index + 1}`,
        name: t.agent,
        adapter: t.adapter,
        model: t.model,
        active: true,
      },
      async (draft) => {
        setErrorMsg(null);
        try {
          let agentId = t.agentId;
          const matchingAgent = agents.find(a => a.name === draft.name);
          if (matchingAgent) {
            agentId = matchingAgent.id;
          }

          await updateRoutingRule(t.id, {
            category: cat,
            agent_id: agentId,
            model: draft.model || null,
            priority: index + 1,
          });
          reloadData();
        } catch (e: any) {
          setErrorMsg(e.message || String(e));
        }
      },
    );
  };
```

New:
```tsx
  const editTarget = async (t: RouteTarget, index: number) => {
    let agents: WireAgentFull[];
    try {
      agents = await fetchAgents();
    } catch (e: any) {
      setErrorMsg(e.message || String(e));
      return;
    }
    modals.openAgent(
      {
        title: `Ubah target ${index + 1}`,
        name: t.agent,
        adapter: t.adapter,
        // Kosong berarti "ikut default agent". Mengisi t.model (teresolusi)
        // di sini akan memaku model warisan ke DB begitu draft disimpan.
        model: t.originalModel,
        active: true,
      },
      async (draft) => {
        setErrorMsg(null);
        try {
          let agentId = t.agentId;
          const matchingAgent = agents.find(a => a.name === draft.name);
          if (matchingAgent) {
            agentId = matchingAgent.id;
          }

          await updateRoutingRule(t.id, {
            category: cat,
            agent_id: agentId,
            model: draft.model || null,
            priority: index + 1,
          });
          reloadData();
        } catch (e: any) {
          setErrorMsg(e.message || String(e));
        }
      },
    );
  };
```

### Patch 4 — `RoutingScreen.tsx`: `addTarget` — bungkus fetchAgents (C6)

Current:
```tsx
  const addTarget = async () => {
    const agents = await fetchAgents();
    modals.openAgent({ title: `Tambah target — ${cat}` }, async (draft) => {
      setErrorMsg(null);
      try {
        let agentId = 0;
        const matchingAgent = agents.find(a => a.name === draft.name);
        if (matchingAgent) {
          agentId = matchingAgent.id;
        } else {
          throw new Error("Agent tidak ditemukan");
        }
        
        await createRoutingRule({
          category: cat,
          agent_id: agentId,
          model: draft.model || null,
          priority: targets.length + 1,
        });
        reloadData();
      } catch (e: any) {
        setErrorMsg(e.message || String(e));
      }
    });
  };
```

New:
```tsx
  const addTarget = async () => {
    let agents: WireAgentFull[];
    try {
      agents = await fetchAgents();
    } catch (e: any) {
      setErrorMsg(e.message || String(e));
      return;
    }
    modals.openAgent({ title: `Tambah target — ${cat}` }, async (draft) => {
      setErrorMsg(null);
      try {
        let agentId = 0;
        const matchingAgent = agents.find(a => a.name === draft.name);
        if (matchingAgent) {
          agentId = matchingAgent.id;
        } else {
          throw new Error("Agent tidak ditemukan");
        }
        
        await createRoutingRule({
          category: cat,
          agent_id: agentId,
          model: draft.model || null,
          priority: targets.length + 1,
        });
        reloadData();
      } catch (e: any) {
        setErrorMsg(e.message || String(e));
      }
    });
  };
```

### Patch 5 — `routingApi.ts`: kembalikan kunci kuota ke model teresolusi (C3, membalik regresi §1.2)

File: `app/static/src/services/routingApi.ts`

Current:
```tsx
    const model = rule.model ?? agent.default_model;
    const label = model ? `${agent.name}/${model}` : agent.name;
    const qKey = `${agent.id}::${rule.model ?? ""}`;
    const q = quotaMap.get(qKey);
```

New:
```tsx
    const model = rule.model ?? agent.default_model;
    const label = model ? `${agent.name}/${model}` : agent.name;
    // Window kuota selalu tersimpan dengan model TERESOLUSI:
    // router.py:85 -> Target.model = rule.model or agent.default_model, lalu
    // runner.py:408/599/617 meneruskan target.model ke seluruh fungsi quota.*.
    // Memakai rule.model mentah di sini membuat rule yang mewarisi model
    // (model: null) tidak pernah menemukan window kuotanya sendiri.
    const qKey = `${agent.id}::${model ?? ""}`;
    const q = quotaMap.get(qKey);
```

### Patch 6 — `routingApi.test.ts`: perbaiki fixture yang dibengkokkan mengikuti bug (C3)

File: `app/static/src/services/routingApi.test.ts`

Current:
```tsx
    const quota: QuotaRow[] = [
      { key: "1::", agentId: 1, agent: "Agent 1", model: "def", used: 10, windowType: "daily", windowEnd: null, cooldownEnd: null, exhausted: true },
    ];
```

New:
```tsx
    const quota: QuotaRow[] = [
      { key: "1::def", agentId: 1, agent: "Agent 1", model: "def", used: 10, windowType: "daily", windowEnd: null, cooldownEnd: null, exhausted: true },
    ];
```

Tambahkan satu tes baru di dalam `describe("toRouteChains", …)` (setelah tes
`"quotaExhausted memetakan ke QuotaRow"` yang sudah ada) yang **mengunci**
regresi ini secara eksplisit — tanpa tes ini, siapa pun bisa membalikkan
Patch 5 lagi dan seluruh suite tetap hijau:

```tsx
    it("rule dengan model: null (warisan) tetap menemukan window kuota agent default — kunci regresi qKey", () => {
      const rules: WireRoutingRule[] = [
        { id: 1, category: "c1", agent_id: 1, model: null, priority: 1 },
      ];
      const chains = toRouteChains(rules, agents, quota);
      // agent 1 default_model "def" -> window kuota tersimpan sebagai "1::def"
      // (lihat fixture `quota` di atas). Kalau qKey memakai rule.model mentah
      // ("1::"), assertion ini gagal dengan quotaLabel "—".
      expect(chains["c1"]![0]!.quotaLabel).toBe("limit");
      expect(chains["c1"]![0]!.quotaExhausted).toBe(true);
    });
```

### Patch 7 — `QuotaScreen.tsx`: hilangkan efek samping saat render (C5)

File: `app/static/src/features/quota/QuotaScreen.tsx`

Current:
```tsx
export function QuotaScreen() {
  const [res, reload] = useApiResource(fetchQuota);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (res.phase === "loading") {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reload} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const { rows, consumption } = res.data;
  const nowMs = Date.now();

  const cooldowns = rows
    .filter((q) => q.cooldownEnd !== null)
    .map((q) => {
      const left = Math.max(0, Math.round((Date.parse(q.cooldownEnd!) - nowMs) / 1000));
      return { ...q, left };
    });

  // Auto-reload kalau ada cooldown yang baru saja selesai
  const needsReload = cooldowns.some((q) => q.left <= 0);
  if (needsReload) {
    // Timeout untuk mencegah react warning update during render
    setTimeout(reload, 0);
  }

  return (
```

New:
```tsx
export function QuotaScreen() {
  const [res, reload] = useApiResource(fetchQuota);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
      // Satu cooldown baru saja habis -> minta data segar. Memutuskan ini di
      // badan render (versi lama) adalah efek samping saat render, dan
      // terpanggil dua kali di React StrictMode.
      if (
        res.phase === "ready" &&
        res.data.rows.some(
          (q) => q.cooldownEnd !== null && Date.parse(q.cooldownEnd) <= Date.now(),
        )
      ) {
        reload();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [res, reload]);

  if (res.phase === "loading") {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reload} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const { rows, consumption } = res.data;
  const nowMs = Date.now();

  const cooldowns = rows
    .filter((q) => q.cooldownEnd !== null)
    .map((q) => {
      const left = Math.max(0, Math.round((Date.parse(q.cooldownEnd!) - nowMs) / 1000));
      return { ...q, left };
    });

  return (
```

### Patch 8 — `AttemptsPanel.tsx`: jadikan `onEmpty` opsional (mendukung C8)

File: `app/static/src/features/console/AttemptsPanel.tsx`

Current:
```tsx
export function AttemptsPanel({
  taskId,
  initialRows,
  onEmpty,
}: {
  taskId: number;
  initialRows?: AttemptRow[];
  onEmpty: () => void;
}) {
  const [rows, setRows] = useState<AttemptRow[]>(initialRows || []);

  useEffect(() => {
    if (initialRows) return;
    fetchAttempts(taskId)
      .then((r) => {
        setRows(r);
        if (r.length === 0) onEmpty();
      })
      .catch(onEmpty);
  }, [taskId, initialRows, onEmpty]);
```

New:
```tsx
export function AttemptsPanel({
  taskId,
  initialRows,
  onEmpty,
}: {
  taskId: number;
  initialRows?: AttemptRow[];
  onEmpty?: () => void;
}) {
  const [rows, setRows] = useState<AttemptRow[]>(initialRows || []);

  useEffect(() => {
    if (initialRows) return;
    fetchAttempts(taskId)
      .then((r) => {
        setRows(r);
        if (r.length === 0) onEmpty?.();
      })
      .catch(() => onEmpty?.());
  }, [taskId, initialRows, onEmpty]);
```

`ConsoleScreen.tsx` yang mengirim `onEmpty={onAttemptsEmpty}` tidak perlu
diubah — prop opsional tetap menerima nilai yang diberikan.

### Patch 9 — `TranscriptView.tsx`: satu panel percobaan, bukan dua (C7 + C8)

File: `app/static/src/features/console/TranscriptView.tsx`

Current (bagian akhir fungsi komponen):
```tsx
  const showCascade = data.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");

  return (
    <>
      <StreamView
        state={mockState}
        onReply={() => {}}
        onDefer={() => {}}
        onScrollAway={() => {}}
        onJumpLatest={() => {}}
      />
      
      <AttemptsPanel taskId={taskId} initialRows={data.attemptsData} onEmpty={() => {}} />
      {showCascade && (
        <CascadePanel runId={taskId} attempts={data.attempts} status="done" />
      )}
    </>
  );
}
```

New:
```tsx
  const showAttempts = data.attemptsData.length > 0;
  const showCascade = data.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");

  return (
    <>
      <StreamView
        state={mockState}
        onReply={() => {}}
        onDefer={() => {}}
        onScrollAway={() => {}}
        onJumpLatest={() => {}}
      />
      
      {showAttempts && <AttemptsPanel taskId={taskId} initialRows={data.attemptsData} />}
      {showCascade && !showAttempts && (
        <CascadePanel runId={taskId} attempts={data.attempts} status="done" />
      )}
    </>
  );
}
```

---

## 4. Ringkasan tes yang harus lulus setelah semua patch

`app/static/src/services/routingApi.test.ts` sudah ada (dibuat WIP ini) dan
punya 4 tes. Setelah Patch 6, jumlahnya jadi 5:

| # | Kasus | Harapan |
|---|---|---|
| 1 | mengurutkan menaik menurut priority | urutan id sesuai priority menaik |
| 2 | label gabungan (cermin `router.py:57-59`) | `"Agent 1/def"` dan `"Agent 2"` |
| 3 | quotaExhausted memetakan ke QuotaRow | `true` untuk agent exhausted, `false` untuk yang tidak ada di quota |
| 4 | mengabaikan agent yatim tanpa menghilangkan rule lain | rule dengan `agent_id` tak dikenal dilewati |
| 5 **(baru, Patch 6)** | rule `model: null` tetap menemukan window kuota agent default | `quotaLabel === "limit"`, `quotaExhausted === true` — **mengunci regresi C3** |

C1, C2, C5, C6, C7 tidak bisa diuji lewat vitest (`environment: "node"`, tanpa
DOM) — verifikasi lewat langkah manual di §6.

---

## 5. Urutan eksekusi

1. **Verifikasi keadaan**: `git status --short` dan `git diff --stat` — cocokkan dengan §1. Kalau berbeda jauh, hentikan dan re-derive patch dari isi berkas aktual, jangan terapkan §3 secara buta.
2. Terapkan **Patch 5 dan 6** dulu (`routingApi.ts` + `routingApi.test.ts`) — ini membalik regresi yang paling berbahaya secara diam-diam (tes hijau menyembunyikan bug).
3. Terapkan **Patch 1 dan 2** (`RoutingScreen.tsx` urutan hook + import tipe) — tanpa ini layar Routing tidak bisa dibuka untuk memverifikasi apa pun.
4. Terapkan **Patch 3 dan 4** (`RoutingScreen.tsx` editTarget/addTarget).
5. Terapkan **Patch 7** (`QuotaScreen.tsx`).
6. Terapkan **Patch 8 lalu 9** (`AttemptsPanel.tsx` sebelum `TranscriptView.tsx` — urutan ini penting karena Patch 9 memakai prop opsional yang baru dibuat Patch 8; menerapkan Patch 9 dulu akan membuat `tsc` tetap lulus karena prop lama masih wajib diisi, tapi lebih rapi mengikuti urutan ini).
7. Jalankan gerbang: dari `app/static/`, `npx tsc -b` lalu `npx vitest run`. Keduanya harus 0 error / semua tes lulus (76 tes: 75 yang ada sekarang + 1 dari Patch 6).
8. Jalankan `npm run build` dari `app/static/` — FastAPI menyajikan `dist/`, bukan `src/`.
9. Lakukan verifikasi manual di §6.
10. **Commit.** Karena pohon kerja sudah kotor sejak sebelum patch-patch ini (WIP yang mencampur perbaikan bagus dengan satu regresi), cara paling jujur adalah **satu commit** yang mencakup seluruh diff sejak `e376888` (WIP yang sudah ada + sembilan patch di atas), dengan pesan yang menjelaskan keseluruhan perubahan — bukan berpura-pura ini kerja bersih bertahap yang tidak pernah terjadi. Contoh pesan:

   ```
   fix(web): perbaiki urutan hook Routing dan kunci kuota berbasis model teresolusi

   Melanjutkan WIP yang belum ter-commit: label Indonesia, ConfirmModal, dan
   dedup fetch attempts sudah benar. Memperbaiki regresi qKey kuota (kembali
   ke model teresolusi seperti sebelumnya), pelanggaran Rules of Hooks di
   RoutingScreen yang baru disuntik WIP ini, dan menyelesaikan penanganan
   error serta model warisan yang WIP tinggalkan setengah jalan.
   ```

   Kalau eksekutor lebih memilih commit granular, itu berarti mem-`git add -p`
   memisahkan hunk WIP lama dari patch baru per berkas — mungkin tapi cukup
   rumit karena kedua lapisan mengubah baris yang berdekatan di berkas yang
   sama. Tidak wajib; satu commit yang jujur lebih baik daripada sejarah palsu.

Tidak ada berkas Python yang perlu tersentuh oleh rencana ini.

---

## 6. Verifikasi manual

Jalankan `npm run build`, muat ulang `localhost:8000`, buka DevTools console.

| # | Langkah | Harapan | Mengunci |
|---|---|---|---|
| 1 | Buka tab Routing dengan daemon hidup | Rantai tampil. **Tidak ada** `Rendered more hooks than during the previous render` di console | C1 |
| 2 | Matikan daemon, muat ulang, buka Routing | "daemon tidak menjawab: …" + tombol "Coba lagi" — bukan "Memuat..." selamanya | C2 |
| 3 | Buat/pastikan ada agent dengan `default_model` terisi (mis. "sonnet"), buat rule untuk agent itu **tanpa mengisi model** | Baris routing berlabel `nama/sonnet` dengan status `tersedia`, bukan `—` | C3 |
| 4 | Paksa cooldown pada (agent, sonnet) lewat run yang kena 429, lalu buka Routing | Status baris jadi `cooldown` | C3 |
| 5 | Klik baris rule dari langkah 3 | Kolom model di modal **kosong**, bukan terisi "sonnet" | C4 |
| 6 | Simpan modal itu tanpa mengubah apa pun, lalu `GET /api/routing` | `model` rule masih `null` | C4 |
| 7 | Ubah `default_model` agent ke model lain, buka Routing | Label rule ikut berubah otomatis | C4 |
| 8 | Buka Routing, matikan daemon, klik satu baris | Pesan error muncul di panel; modal tidak menggantung tanpa respons | C6 |
| 9 | Buka Quota saat ada cooldown < 60 detik | Angka countdown turun tiap detik; saat mencapai 00:00:00 baris hilang sendiri dalam ≤ 2 detik; Network tab menunjukkan **satu** putaran `/api/quota`, bukan dua | C5 |
| 10 | Buka satu run lama dari Riwayat yang punya ≥ 2 percobaan | Jejak eksekusi tampil **sekali**, bukan dua panel berisi data yang sama | C7 |
| 11 | Buka run lama yang berhasil di target pertama | Tidak ada panel cascade sama sekali, hanya panel jejak eksekusi | C7 |

Langkah 3-7 perlu data nyata di database. Kalau belum ada agent ber-`default_model`, buat lewat tab Agents dulu.

---

## 7. Keputusan terbuka: pasang eslint?

C1 adalah kelas cacat yang **tidak bisa** ditangkap `tsc`, vitest node, maupun
vite build — dan seperti ditunjukkan §1.2, cacat ini bisa disuntikkan ulang
oleh proses lain (manusia atau agent) tanpa satu pun gerbang otomatis
berteriak. Satu-satunya alat yang menangkap pelanggaran Rules of Hooks adalah
`eslint-plugin-react-hooks`.

Biaya: empat devDependency (`eslint`, `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks`), satu `eslint.config.js`, satu skrip `lint`.
**Di luar lingkup rencana ini** — pemasangan linter pertama kali di repo yang
belum punya biasanya memunculkan banyak peringatan lama yang harus diputuskan
satu per satu. Dicatat di sini supaya keputusannya sadar, bukan terlewat.

---

## 8. Sengaja tidak dikerjakan / sudah teratasi lewat WIP

- Mengganti `alert()`/`window.confirm()` — **sudah dikerjakan** WIP ini lewat `ConfirmModal`.
- Peringatan Rollup soal impor ganda `taskApi.ts` — **sudah dikerjakan** WIP ini (impor statis).
- Disclaimer "data contoh" untuk `FS`/`PLAN_STEPS` — **sudah dikerjakan** WIP ini (komentar kode; kalau mau, keterangan yang user-visible di UI adalah peningkatan lanjutan, bukan cacat).
- Tes I/O `fetchQuota`/401 — **sudah dikerjakan** WIP ini.
- `taskApi.test.ts` masih memanggil `vi.unstubAllGlobals()` di badan tes, bukan `afterEach` — nit lama, tidak memengaruhi hasil, tidak disentuh rencana ini.
- **pytest** — nol berkas Python berubah oleh rencana ini. Jalankan dari root repo: `.venv\Scripts\python.exe -m pytest -q` (dari `app/static` akan mengumpulkan 0 tes).

---

## 9. Definisi selesai

- [ ] `git status --short` sebelum mulai dicatat/dibandingkan dengan §1.
- [ ] Patch 1–9 diterapkan sesuai urutan §5.
- [ ] `npx tsc -b` dari `app/static/` — 0 error.
- [ ] `npx vitest run` dari `app/static/` — semua tes lulus, termasuk tes baru Patch 6.
- [ ] `npm run build` dari `app/static/` — sukses.
- [ ] Sebelas langkah verifikasi manual §6 dijalankan dan lulus.
- [ ] Satu commit dibuat mencakup WIP + patch, dengan pesan yang jujur (§5 langkah 10).
- [ ] Tidak ada berkas `.env` yang dibuka/dikutip/dikirim selama proses ini.

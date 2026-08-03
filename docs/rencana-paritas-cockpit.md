# Rencana paritas cockpit — memulihkan follow-up & jejak eksekusi

Dokumen eksekusi untuk agentic AI. **Tidak perlu dieksekusi oleh penulis dokumen
ini.**

Ditulis 2 Agustus 2026 di atas commit `121e645` (`feat/cockpit-frontend`), dari
graf `codebase-memory` yang di-index ulang: **1363 node / 5862 edge**. Angka itu
bukan sekadar lebih besar dari 595/3145 yang dipakai `rencana-fase4.md` — isinya
beda. Index lama tidak mengenal TypeScript sama sekali dan masih memuat
`app/static/app.js` + `style.css` yang sudah dihapus commit `eb1d859`. Setiap
klaim di dokumen ini diverifikasi ulang terhadap kode dan terhadap daemon yang
sedang berjalan, bukan terhadap graf basi itu.

Dokumen ini melanjutkan [IMPLEMENTATION.md](../IMPLEMENTATION.md): yang itu
mencatat *bagaimana cockpit dibangun*, yang ini mencatat *dua kemampuan yang
hilang dalam perpindahan dari dashboard vanilla, dan cara mengembalikannya tanpa
melanggar keputusan arsitektur yang sudah diambil di Fase 1–3*.

Kesimpulan singkatnya: **kedua regresi ini frontend, bukan backend.** Endpoint
yang dibutuhkan sudah ada, sudah teruji, dan sedang melayani permintaan. Yang
hilang adalah pintu masuknya di UI. Satu-satunya perubahan backend yang
disarankan berukuran dua baris, dan sifatnya kejujuran label — bukan fitur baru.

---

## 0. Konteks lingkungan — baca ini dulu

Supaya tidak ada waktu terbuang menebak perkakas.

| Hal | Nilai |
|---|---|
| OS / shell | Windows 10, PowerShell 5.1 (`&&` dan `??` **tidak** tersedia — pakai `;` + `if ($?)`) |
| Python | `C:\project\Choros\.venv\Scripts\python.exe` (3.12) |
| Postgres | container `choros-db-1`, `127.0.0.1:5433` → 5432, healthy |
| DB tes | `choros_test` (sudah dibuat, owner `choros`) |
| Server dev | `uvicorn app.main:app`, `127.0.0.1:8000` — biasanya sudah jalan; cek dulu sebelum menyalakan yang kedua |
| Frontend | `app/static` (Vite + React 18 + TS) |

Perintah yang dipakai:

```powershell
# backend — suite penuh
$env:CHOROS_DATABASE_URL='postgresql+asyncpg://choros:choros@localhost:5433/choros_test'
& C:\project\Choros\.venv\Scripts\python.exe -m pytest -q

# frontend
cd C:\project\Choros\app\static
npm run typecheck    # tsc -b
npm test             # vitest run
npm run build        # tsc -b && vite build → dist/, yang di-mount FastAPI di /static
npm run dev          # 5173, proxy /api + /healthz ke 127.0.0.1:8000
```

Tiga jebakan lingkungan yang wajib diketahui sebelum menulis tes:

1. **`vitest` berjalan di `environment: "node"`** (`vite.config.ts`). Tidak ada
   `EventSource`, tidak ada `fetch` DOM, tidak ada `document`. Karena itu
   `createSseDaemon` sendiri **tidak pernah diuji** — yang diuji hanya fungsi
   murni yang diekspornya (`toConsoleEvents`, `countdownTo`) plus reducer. Setiap
   logika baru yang ingin diuji **harus** diekstrak jadi fungsi murni. Ini bukan
   preferensi gaya; ini syarat agar tesnya bisa jalan sama sekali.
2. **`app/static/dist/` di-gitignore.** Perubahan frontend tidak terlihat di
   `http://127.0.0.1:8000/` sampai `npm run build` dijalankan. Selama menggarap,
   pakai `npm run dev` (5173) yang sudah nge-proxy API.
3. **Backend tidak memanggil `load_dotenv()`.** `pydantic-settings` membaca
   `.env` sendiri (`app/config.py:11`), tapi hanya variabel ber-prefix
   `CHOROS_`. Variabel lain di `.env` tidak sampai ke `os.environ`.

---

## 1. Dua regresi, dengan buktinya

### 1.1 Tidak ada cara mengirim lanjutan

Dashboard vanilla punya input follow-up permanen di panel Hasil:

```html
<!-- app/static/index.html:99-102 @ eb1d859~1 -->
<div class="followup">
  <input id="followup" placeholder="Tanya balik / lanjutkan di sesi yang sama…" />
  <button id="send-followup" class="primary">Kirim</button>
</div>
```

dan mengirimnya **tanpa syarat status apa pun** (`app.js:361-366 @ eb1d859~1`)
ke `POST /api/tasks/{id}/reply`.

Cockpit menggantungkan satu-satunya kotak balas pada `QuestionCard`, yang
dirender hanya bila (`features/console/StreamView.tsx:208`):

```tsx
{state.status === "waiting_for_input" && state.question && (
  <QuestionCard question={state.question} onReply={onReply} onDefer={onDefer} />
)}
```

`waiting_for_input` hanya bisa dicapai lewat event `QUESTION`
(`state/consoleMachine.ts:92`), yang dipancarkan `sseDaemon` hanya untuk event
kawat bertipe `question`.

**Event itu tidak pernah ada.** `Event.question()` didefinisikan di
`app/events.py:79` dan **tidak punya satu pun pemanggil** di seluruh `app/`
maupun `tests/`. Diverifikasi terhadap daemon yang sedang jalan — 11 event
tersimpan untuk task #15, nol bertipe `question`.

Akibatnya kotak balas cockpit **secara struktural mustahil muncul**, dan
mengetik lagi setelah run selesai memanggil `actions.submit` → tugas **baru**
tanpa konteks, bukan lanjutan sesi.

### 1.2 Model yang mengeksekusi tidak terbaca

Dashboard lama merender tabel per-percobaan (`app.js:213-223 @ eb1d859~1`):

```
# | agent | model | status | tokens in/out
```

dari `GET /api/tasks/{id}/logs`, dengan `agent_id` dipetakan ke nama lewat
`/api/agents` yang sudah di-cache di `state.agents`.

Cockpit **tidak pernah memanggil `/logs`**. Penggantinya, `CascadePanel`, hanya
muncul kalau ada fallback (`features/console/ConsoleScreen.tsx:73`):

```tsx
const showCascade = state.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");
```

Run yang sukses di percobaan pertama tidak pernah menampilkannya.

Tersisa dua permukaan, dan keduanya kosong untuk agent yang benar-benar dipakai.
Event asli task #15:

```
type=status agent=antigravity model=  transition=target_started target=antigravity/default
type=output agent=antigravity model=
type=usage  agent=antigravity model=
```

Rantai sebabnya sudah dilacak sampai habis — dan **bukan** bug plumbing:

1. `app/adapters/base.py:162` sudah menstempel model ke setiap event:
   `ev.model = ev.model or model or self.default_model`. Mekanismenya benar.
2. Nilainya kosong karena rule routing `coding_complex` teratas menunjuk agent
   id 2 dengan `model: null`, dan agent `antigravity` punya `default_model = ""`
   di DB. Jadi `None or ""` → `""`.
3. `sseDaemon.ts:67-70` hanya menulis `agent/model` bila keduanya terisi → jatuh
   ke `"antigravity"`.
4. `Target.label` (`app/orchestrator/router.py:58-59`) =
   `f"{agent.name}/{model or default_model or 'default'}"` → header menampilkan
   harfiah **`antigravity/default`**, kata "default", bukan nama model.

Tambahan: `RunResult.target` ada di tipe (`state/types.ts:91`), diisi hardcode
`"—"` di `sseDaemon.ts:339`, dan **tidak dibaca komponen mana pun**.

---

## 2. Keputusan: jangan bangun emisi `question` di adapter

Ini keputusan terpenting dokumen ini, dan alasannya sudah tertulis sejak Fase
1–3 di [catatan-implementasi.md §1.1](catatan-implementasi.md):

> **PRD §8:** "Pertanyaan balik agent (`Event.type=question`) → tampil di
> dashboard → jawaban dialirkan ke stdin."
>
> **Yang dikerjakan:** follow-up dijalankan sebagai tugas lanjutan yang me-resume
> sesi yang sama (`claude --resume`, `agy --conversation`, `opencode --session`).
>
> **Alasan:** ketiga harness dijalankan dalam print-mode (`-p`), yang memproses
> satu prompt lalu keluar. Menyuntik jawaban ke stdin proses yang sudah selesai
> tidak ada gunanya […]
>
> Konsekuensi: `Event.type='question'` ada di kontrak tapi belum pernah di-emit
> oleh adapter mana pun — dalam print-mode, pertanyaan agent keluar sebagai teks
> biasa di `output`. **Dashboard menyediakan kotak follow-up untuk semua tugas,
> jadi alurnya tetap jalan.**

Kalimat terakhir itu adalah kontrak UX yang dilanggar cockpit. Dashboard lama
memenuhinya; cockpit menggantinya dengan pintu yang terkunci dari sisi backend.

**Maka: jangan menambahkan deteksi pertanyaan di adapter.** Dalam print-mode,
"apakah kalimat ini pertanyaan" hanya bisa ditebak dari prosa — persis jenis
tebakan yang sudah ditolak `sseDaemon.ts` untuk transisi orkestrator (transisi
dibaca dari field `data.transition` yang eksplisit, tidak pernah dari
`data.message`). Menebaknya di sini akan menaruh run di `waiting_for_input`
padahal harness-nya sudah keluar, dan cancel/timeout jadi satu-satunya jalan
keluar. Biayanya tinggi, hasilnya rapuh, dan tidak ada yang menuntutnya.

**Yang dilakukan sebaliknya:** kembalikan kotak follow-up untuk semua tugas yang
selesai, lewat endpoint resume yang sudah ada dan sudah bekerja.

**Yang tidak dihapus:** seluruh mesin `waiting_for_input` — `QUESTION`, `REPLY`,
`DEFER`, `QuestionCard`, dan 20 tes yang menutupinya. Mock daemon memakainya
(skenario `tanya`, `cascade_tanya`), dan kalau suatu hari sebuah harness punya
mode interaktif sungguhan, jalurnya sudah siap. Ia menjadi jalur cadangan, bukan
jalur utama.

---

## 3. Ruang lingkup

**Dikerjakan:**

| # | Kerjaan | Lapis |
|---|---|---|
| 6a.1 | Event `FOLLOW_UP` di state machine | frontend |
| 6a.2 | `followUp()` di kontrak `DaemonClient` + sseDaemon + mockDaemon | frontend |
| 6a.3 | `FollowUpStrip` — kotak lanjutan di bawah strip Hasil | frontend |
| 6a.4 | `AttemptsPanel` — jejak eksekusi dari `/logs` + `/agents` | frontend |
| 6a.5 | `Target.label` berhenti mengarang kata "default" | backend (2 baris) |
| 6a.6 | Buang `RunResult.target` yang bohong dan tak terpakai | frontend |
| 6a.7 | Koreksi `IMPLEMENTATION.md` | dokumen |

**Sengaja tidak dikerjakan** (dicatat di §9): menyambungkan lima layar fixture,
deteksi `question` di adapter, dan pengisian `default_model` antigravity.

---

## 4. Kerjaan rinci

### 6a.1 — Event `FOLLOW_UP` di state machine

File: `app/static/src/state/consoleMachine.ts`

Tambahkan varian event, tepat setelah `REPLY` supaya kedekatannya terbaca:

```ts
/** user mengirim lanjutan setelah run selesai — tugas baru yang me-resume sesi yang sama */
| { type: "FOLLOW_UP"; text: string; ts: string }
```

Tambahkan transisi. **Hanya dari `done`** — dan ini bukan kehati-hatian berlebih:
`POST /api/tasks/{id}/reply` menolak dengan **409** bila `parent.last_session_id`
kosong (`app/api/tasks.py:127-131`), dan kolom itu hanya terisi setelah ada
attempt sukses. Diverifikasi di DB: task 14/15 (`ok`) punya session; task
11/12/13 (`halted`/`cancelled`/`interrupted`) tidak. Menawarkan kotak lanjutan
di `halted` atau `error` berarti menawarkan tombol yang pasti gagal.

```ts
done: {
  SUBMIT: "queued",
  FOLLOW_UP: "queued",
  RESET: "idle",
},
```

Reducer — perhatikan komentarnya, itu inti perilakunya:

```ts
case "FOLLOW_UP":
  return {
    ...state,
    status: next,
    // Strip Hasil run sebelumnya tidak boleh menggantung di atas run yang baru.
    result: null,
    question: null,
    // Rantai target dihitung ulang dari nol untuk tugas lanjutan.
    attempts: [],
    route: "—",
    usage: EMPTY_USAGE,
    planReused: false,
    autoScroll: true,
    // stream SENGAJA dipertahankan: inti follow-up adalah percakapan yang
    // menyambung. Mengosongkannya akan menghapus jawaban yang sedang dibalas.
    stream: append(state, line(event.ts, "output", "you", `› ${event.text}`)),
  };
```

`attempts: []` penting: `SLOT_FREE` hanya menyeed attempt pertama saat
`state.attempts.length === 0` (`consoleMachine.ts:203-206`). Tanpa reset,
percobaan tugas lanjutan akan menempel pada rantai tugas lama.

`RUN_ID` tidak perlu diurus di sini — ia event tampilan (`VIEW_EVENTS`), sah di
status mana pun, dan dikirim `sseDaemon` saat id tugas baru diketahui.

### 6a.2 — `followUp()` di kontrak daemon

File: `app/static/src/services/daemon.ts`

```ts
export interface DaemonClient {
  submit(request: RunRequest, runId: number): void;
  /** Jawab event `question` yang sedang menahan run. */
  reply(text: string): void;
  /** Lanjutan setelah run selesai — resume sesi yang sama, tugas baru. */
  followUp(text: string): void;
  defer(): void;
  cancel(): void;
  dispose(): void;
}
```

File: `app/static/src/services/sseDaemon.ts`

`reply`, `defer`, dan `followUp` sekarang memanggil endpoint yang sama dengan
tiga badan yang hampir identik. Satukan dulu, baru tambah:

```ts
/** POST /reply → tugas lanjutan yang me-resume sesi yang sama; stream pindah ke id baru. */
const resume = (answer: string, gagal: string) => {
  if (taskId === null) return;
  questionPending = false;
  partialId = null;
  void json<TaskOut>(
    fetch(`${base}/api/tasks/${taskId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer }),
    }),
  )
    .then((task) => openStream(task.id))
    .catch((err: unknown) => fail(`${gagal} — ${String(err)}`));
};
```

lalu:

```ts
reply(text)  { sink({ type: "REPLY", text, ts: nowTs() }); resume(text, "follow-up gagal"); },
defer()      { sink({ type: "DEFER", ts: nowTs() });       resume(DEFER_ANSWER, "follow-up gagal"); },
followUp(text) { sink({ type: "FOLLOW_UP", text, ts: nowTs() }); resume(text, "lanjutan gagal"); },
```

(`DEFER_ANSWER` = konstanta modul berisi kalimat yang sekarang inline di
`sseDaemon.ts:456`.)

Penanganan 409 tidak butuh kode khusus: `json()` sudah membuka field `detail`
dari badan error (`sseDaemon.ts:265-279`), jadi `fail()` akan menuliskan
`✗ lanjutan gagal — Error: 409 tugas ini tidak punya sesi yang bisa dilanjutkan
(belum ada attempt sukses)`. `FATAL` sah dari `queued`
(`consoleMachine.ts:89`), jadi state tetap konsisten. **Verifikasi kalimat itu
benar-benar muncul saat uji manual §7 langkah 4.**

File: `app/static/src/services/mockDaemon.ts` — wajib mengimplementasikan
`followUp` supaya `npm run typecheck` lewat. Cukup: pancarkan `FOLLOW_UP` lalu
putar ulang skrip skenario aktif dengan mekanisme yang sama dengan `submit`.
Detail internalnya bebas; yang wajib hanya event `FOLLOW_UP` terpancar dan
skripnya berjalan.

File: `app/static/src/state/useConsole.ts` — tambahkan ke `actions`:

```ts
followUp: (text: string) => daemonRef.current?.followUp(text),
```

### 6a.3 — `FollowUpStrip`

File baru: `app/static/src/features/console/FollowUpStrip.tsx`

Kotak lanjutan permanen untuk setiap run yang selesai — padanan langsung
`#followup` dashboard lama, dengan placeholder yang sama persis supaya
kelanjutannya terbaca oleh yang pernah memakai versi lama.

```tsx
export function FollowUpStrip({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  // Enter mengirim; Shift+Enter tidak dipakai — ini satu baris, bukan editor.
  …
}
```

Wajib:
- `<Input>` dari DS, `placeholder="Tanya balik / lanjutkan di sesi yang sama…"`
- tombol `<Button variant="primary" size="sm">Kirim</Button>`, disabled saat
  `text.trim()` kosong
- `aria-label` pada input (tidak ada `<label>` terlihat di strip sesempit ini)
- gaya `strip` yang sama dengan `ResultStrips.tsx:5-10` — jangan bikin varian
  border/padding baru

File: `app/static/src/features/console/ConsoleScreen.tsx:228-235`

```tsx
{state.status === "done" && state.result && (
  <>
    <ResultStrip … />
    <FollowUpStrip onSend={actions.followUp} />
  </>
)}
```

`ResultStrip` tetap presenter murni — jangan menyuntik input ke dalamnya.

Setelah `FOLLOW_UP`, `result` jadi `null` dan status jadi `queued`, sehingga
kedua strip hilang sendiri dan `ComposePanel` terkunci (`busy` mencakup
`queued`, `state/types.ts:25-30`). Itu perilaku yang benar: satu run pada satu
waktu.

### 6a.4 — `AttemptsPanel` — jejak eksekusi

**Bagian murni.** File baru: `app/static/src/services/taskApi.ts`

```ts
export interface WireTaskLog {
  id: number;
  agent_id: number;
  model: string | null;
  status: string | null;
  usage: Record<string, number> | null;
}

export interface WireAgent {
  id: number;
  name: string;
  default_model: string | null;
}

export interface AttemptRow {
  index: number;
  agent: string;
  model: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
}

/** Murni — inti 6a.4 yang bisa diuji di environment node. */
export function toAttemptRows(logs: WireTaskLog[], agents: WireAgent[]): AttemptRow[];
```

Aturan pemetaan, semuanya wajib:

- urut naik berdasarkan `log.id`; `index` = posisi 1-based setelah diurutkan
- `agent` = nama dari peta `id → name`; fallback `` `agent #${agent_id}` ``
  (dashboard lama melakukan persis ini)
- `model` = `log.model || agent.default_model || "—"`. **Jangan** menulis
  `"default"`. Kalau memang tidak ada model yang tercatat, katakan tidak ada.
- `tokensIn` = `usage?.input_tokens ?? 0`, `tokensOut` = `usage?.output_tokens ?? 0`
- `status` = `log.status ?? "—"`

**Bagian jaringan**, di file yang sama:

```ts
export async function fetchAttempts(taskId: number, base = ""): Promise<AttemptRow[]>;
```

`GET /api/tasks/{id}/logs` + `GET /api/agents`, lalu `toAttemptRows`. Daftar
agent di-cache satu kali per modul — ia berubah jauh lebih jarang daripada log.

**Panel.** File baru: `app/static/src/features/console/AttemptsPanel.tsx` —
tabel dengan kolom persis dashboard lama: `# · agent · model · status · tok in/out`.
Pakai `Panel` + gaya grid mono yang sama dengan `CascadePanel`.

Dirender di `ConsoleScreen` untuk status terminal:

```tsx
const terminal = state.status === "done" || state.status === "halted" || state.status === "error";
…
{terminal && state.runId > 0 && !isMock && <AttemptsPanel taskId={state.runId} />}
{showCascade && !terminal && <CascadePanel … />}
```

Dua aturan tampil yang wajib dipatuhi:

1. **`AttemptsPanel` menggantikan `CascadePanel` di status terminal**, tidak
   menumpuknya. `CascadePanel` adalah narasi hidup selama cascade berlangsung;
   `AttemptsPanel` adalah buku besar setelah run berhenti, dengan data nyata
   (token per percobaan) yang tidak dipunyai stream. Dua panel yang menceritakan
   hal sama pada saat bersamaan adalah kebisingan.
2. **Dilewati di mode mock** (`isMock`) — tidak ada `/logs` untuk dipanggil di
   sana, dan memanggilnya akan menghasilkan panel kosong yang membingungkan.

**Deviasi yang diakui:** komponen ini mengambil datanya sendiri lewat
`useEffect`, sedangkan `daemon.ts:2-8` menyatakan "UI tidak pernah tahu event
datang dari mana". Deviasinya sadar dan batasnya jelas: `/logs` adalah **query
snapshot**, bukan stream — ia tidak punya tempat di `DaemonClient`, yang
kontraknya adalah perintah + aliran event. Syaratnya: seluruh `fetch` hidup di
`services/taskApi.ts`, komponen hanya memanggil `fetchAttempts`. Layar
Routing/Quota/Agents nantinya akan butuh pola yang sama, jadi tetapkan bentuknya
benar sekarang.

### 6a.5 — `Target.label` berhenti mengarang "default"

File: `app/orchestrator/router.py:57-59`

```python
    @property
    def label(self) -> str:
        model = self.model or self.agent.default_model
        return f"{self.agent.name}/{model}" if model else self.agent.name
```

Kata `"default"` bukan nama model apa pun. Untuk `antigravity` yang memang tidak
punya model tercatat, `antigravity` lebih jujur daripada `antigravity/default` —
dan itu langsung memperbaiki header Live console, `data.target` di seluruh event
status, dan pesan cascade sekaligus, karena semuanya membaca properti yang sama
(`runner.py` memakainya di 11 tempat).

Aman diubah: **tidak ada tes yang meng-assert `.label`** (diperiksa di seluruh
`tests/`). Tetap jalankan suite penuh sesudahnya.

### 6a.6 — Buang `RunResult.target`

Field `target` di `state/types.ts:91` diisi hardcode `"—"`
(`sseDaemon.ts:339`) dan tidak dibaca komponen mana pun. Hapus dari interface
dan dari objek `FINAL`. Informasi target sudah ada di dua tempat yang benar
setelah 6a.4: header (`state.route`) dan `AttemptsPanel`.

Sekalian periksa `tokens: 0` di baris yang sama — itu benar apa adanya dan
**jangan** disentuh: reducer sudah menambalnya dari usage yang menetes
(`consoleMachine.ts:315-316`), dan komentarnya menjelaskan kenapa.

### 6a.7 — Koreksi `IMPLEMENTATION.md`

Paragraf terakhir §Verifikasi/Terhadap daemon nyata sekarang berbunyi:

> **Yang belum terverifikasi terhadap daemon nyata:** jalur `question` → balas /
> serahkan. Adapter yang terpasang tidak memancarkan event `question` selama sesi
> pengujian […]

Itu terlalu optimis — menyiratkan adapter *mungkin* memancarkannya di lain
kesempatan. Ganti dengan pernyataan yang benar: `Event.question` tidak punya
pemanggil di seluruh backend, dan itu **keputusan sadar** yang sudah tercatat di
`catatan-implementasi.md §1.1`, bukan kebetulan sesi pengujian. Sebutkan bahwa
jalur balas utama adalah `FollowUpStrip`, dan `waiting_for_input` adalah jalur
cadangan yang tinggal menunggu harness dengan mode interaktif sungguhan.

Tambahkan juga dua deviasi baru di §5 (nomor 17 dan 18): kotak follow-up
permanen (mengembalikan perilaku dashboard lama, alasannya §2 dokumen ini), dan
`AttemptsPanel` yang mengambil datanya sendiri (alasannya di akhir §6a.4).

---

## 5. Tes yang harus ditulis

Semua di `environment: "node"` — hanya fungsi murni dan reducer. Jangan mencoba
menguji `createSseDaemon` atau komponen React; tidak ada DOM di sini.

**`src/state/consoleMachine.test.ts`** (sekarang 20 tes):

| Tes | Harapan |
|---|---|
| `FOLLOW_UP` dari `done` | `status === "queued"` |
| `FOLLOW_UP` mempertahankan stream | panjang stream bertambah 1, baris lama utuh |
| `FOLLOW_UP` mengosongkan hasil & rantai | `result === null`, `attempts.length === 0`, `usage.total === 0` |
| `FOLLOW_UP` dari `running` / `idle` / `halted` / `error` | state tidak berubah sama sekali (`transition()` → null) |
| `SLOT_FREE` setelah `FOLLOW_UP` | menyeed attempt #1 lagi, `route` terisi target baru |

**`src/services/taskApi.test.ts`** (baru):

| Tes | Harapan |
|---|---|
| pemetaan dasar | `# `, nama agent, status, token in/out benar |
| `model: null` + `default_model` terisi | jatuh ke `default_model` |
| `model: null` + `default_model` kosong | `"—"`, **bukan** `"default"` |
| `agent_id` tak dikenal | `"agent #7"` |
| `usage: null` / kosong | `0`, bukan `NaN` |
| urutan | diurut naik berdasarkan `id`, `index` 1-based |

**`src/services/sseDaemon.test.ts`**: tidak ada tes baru yang bisa jujur ditulis
di sini — `resume()` menyentuh `fetch` dan `EventSource`. Cukup pastikan 17 tes
yang ada tetap hijau setelah refaktor.

**Backend**: `pytest -q` penuh setelah 6a.5. Tidak ada tes baru — perubahannya
mengubah teks label, dan tidak ada yang meng-assert teks itu. Kalau suite
menemukan sesuatu, itu justru informasi yang berharga; jangan tambal tesnya
tanpa membaca kenapa.

---

## 6. Urutan eksekusi & commit

Empat commit, masing-masing hijau berdiri sendiri. Jangan gabungkan — 6a.5
menyentuh backend dan harus bisa di-revert terpisah.

1. **`fix(web): pulihkan kotak follow-up untuk run yang selesai`**
   → 6a.1 + 6a.2 + 6a.3 + tes `consoleMachine`
   Gerbang: `npm run typecheck`, `npm test`

2. **`feat(web): panel jejak eksekusi dari task_logs`**
   → 6a.4 + tes `taskApi`
   Gerbang: `npm run typecheck`, `npm test`

3. **`fix(routing): label target tidak lagi mengarang model "default"`**
   → 6a.5 + 6a.6
   Gerbang: `pytest -q` penuh, `npm run typecheck`, `npm test`

4. **`docs: koreksi status jalur question di catatan cockpit`**
   → 6a.7

Sebelum commit pertama, jalankan `npm test` dan `pytest -q` di kondisi bersih
supaya tahu garis dasarnya. Per 2 Agustus 2026: frontend **37 passed** (20
`consoleMachine` + 17 `sseDaemon`), `typecheck` bersih.

---

## 7. Verifikasi manual

Butuh backend + Postgres + minimal satu harness terpasang. `npm run build` dulu
kalau menguji lewat `:8000`; kalau lewat `:5173`, tidak perlu.

1. **Follow-up jalan.** Kirim tugas pendek → tunggu `✓ done` → kotak lanjutan
   muncul di bawah strip Hasil → ketik "ringkas jawabanmu jadi satu kalimat" →
   Enter. Harapan: baris `› …` masuk ke stream, pill kembali ke `queued` lalu
   `running`, **stream lama tidak hilang**, dan jawabannya nyambung dengan yang
   sebelumnya (bukti konteks ter-resume).
2. **Sesi benar-benar dipakai ulang.** Setelah langkah 1, cek DB:
   ```powershell
   docker exec choros-db-1 psql -U choros -d choros -c "SELECT id, parent_task_id, resume_session_id IS NOT NULL AS resumed, pinned_agent_id FROM tasks ORDER BY id DESC LIMIT 3;"
   ```
   Tugas terbaru harus punya `parent_task_id` terisi dan `resumed = t`.
3. **Jejak eksekusi terbaca.** Panel percobaan tampil untuk kedua run, dengan
   nama agent dan token in/out yang tidak nol. Kolom `model` boleh `—` untuk
   antigravity — itu benar, bukan bug (lihat §9).
4. **Kegagalan 409 terbaca manusia.** Jalankan tugas dengan `quality_floor:
   frontier` supaya semua target dilewati → `halted`. Pastikan kotak lanjutan
   **tidak** muncul di situ. (Kalau ingin memicu 409-nya secara sengaja untuk
   melihat kalimatnya, panggil `POST /api/tasks/11/reply` langsung dengan
   `Invoke-WebRequest` dan cocokkan detailnya dengan §6a.2.)
5. **Cascade tidak dobel.** Picu cascade sampai `done`. Selama berjalan:
   `CascadePanel`. Setelah `done`: `AttemptsPanel` saja, `CascadePanel` hilang.
6. **Label jujur.** Header Live console menampilkan `antigravity`, bukan
   `antigravity/default`. Untuk agent `claude` tetap `claude/sonnet`.
7. **Mode mock tetap utuh.** `VITE_CHOROS_DAEMON=mock npm run dev` → skenario
   `tanya` dan `cascade_tanya` masih masuk `waiting_for_input` dan `QuestionCard`
   masih berfungsi. `AttemptsPanel` tidak muncul.
8. **Build produksi.** `npm run build`, lalu `http://127.0.0.1:8000/` — tanpa
   error console, aset ter-serve di bawah `/static/`.

---

## 8. Daftar periksa selesai

- [ ] `FOLLOW_UP` ada di `ConsoleEvent`, `TRANSITIONS.done`, dan reducer
- [ ] Stream **tidak** dikosongkan oleh `FOLLOW_UP`; `result`/`attempts`/`usage` dikosongkan
- [ ] `DaemonClient.followUp` ada; sseDaemon dan mockDaemon dua-duanya mengimplementasikan
- [ ] `reply`/`defer`/`followUp` memakai satu helper `resume()`, tidak tiga salinan
- [ ] `FollowUpStrip` muncul di `done`, hilang begitu run lanjutan mulai
- [ ] `toAttemptRows` murni dan teruji; tidak ada `fetch` di komponen
- [ ] `AttemptsPanel` menggantikan `CascadePanel` di status terminal, dilewati di mock
- [ ] `model` kosong dirender `—`, tidak pernah `default`
- [ ] `Target.label` tidak lagi memancarkan `/default`
- [ ] `RunResult.target` hilang dari tipe dan dari `FINAL`
- [ ] `npm run typecheck` bersih
- [ ] `npm test` hijau, jumlah tes bertambah dari 37
- [ ] `pytest -q` hijau (tidak ada regresi dari 6a.5)
- [ ] Delapan langkah §7 dijalankan dan hasilnya dicatat
- [ ] `IMPLEMENTATION.md` §Verifikasi dan §5 diperbarui
- [ ] `npm run build` dan `/` tersaji benar

---

## 9. Sengaja tidak dikerjakan — utang yang dicatat, bukan disembunyikan

1. **Lima layar masih fixture.** Routing, Quota, Agents, Workflows, dan Users
   membaca `data/fixtures.ts`; endpoint-nya sudah ada dan sudah 200. Ini kerjaan
   terbesar berikutnya dan lingkupnya sendiri. `IMPLEMENTATION.md` deviasi 9
   sudah mencatatnya sebagai keputusan sadar ("state lokal cukup"), jadi ini
   utang yang diakui, bukan yang terlupa. `services/taskApi.ts` dari 6a.4
   menetapkan polanya.

2. **`default_model` antigravity kosong di DB.** Itulah sebab akar kolom model
   kosong, dan perbaikannya bukan kode — operator tinggal mengisinya. Tapi layar
   Agents belum tersambung (butir 1), jadi satu-satunya cara sekarang adalah
   `PUT /api/agents/2` manual. Setelah butir 1 selesai, ini hilang sendiri.

3. **Apakah harness antigravity melaporkan nama modelnya?** `parse_line`
   menangkap `tools`, `permission_mode`, dan `cwd` dari event `init`
   (`app/adapters/antigravity.py:128-137`), tapi tidak ada field model di sana.
   Mungkin `agy` memang tidak mengirimnya. **Jangan menebak nama field.** Kalau
   mau ditutup: rekam satu run mentah (`agy … --output-format json` ke file),
   baca payload `init` yang sebenarnya, baru tambahkan penangkapannya + tes
   parser di `tests/test_antigravity_parser.py`.

4. **Deteksi `question` di adapter.** Ditolak, dengan alasan lengkap di §2.
   Kalau suatu hari sebuah harness punya mode interaktif sungguhan (bukan
   print-mode), jalur `waiting_for_input` sudah utuh dan tinggal disambungkan.

5. **`createSseDaemon` tidak punya tes integrasi.** `environment: "node"` tidak
   punya `EventSource`. Menaikkannya ke `jsdom` + memalsukan `EventSource` adalah
   kerjaan tersendiri yang menyentuh konfigurasi seluruh suite; jangan
   menyelipkannya ke dalam rencana ini.

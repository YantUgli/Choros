# Koreksi paritas cockpit — empat cacat setelah 6a.1–6a.7

Dokumen eksekusi untuk agentic AI. **Tidak perlu dieksekusi oleh penulis dokumen
ini.**

Ditulis 2 Agustus 2026, hasil pengecekan implementasi
[rencana-paritas-cockpit.md](rencana-paritas-cockpit.md) di working tree di atas
commit `121e645`. Semua butir 6a.1–6a.7 sudah dikerjakan dan gerbangnya hijau:

| Gerbang | Hasil saat diperiksa |
|---|---|
| `npm run typecheck` | bersih |
| `npm test` | 48 passed (37 → +5 `consoleMachine`, +6 `taskApi`) |
| `pytest -q` | 111 passed (5m26s) |
| `npm run build` | 77 modul, sukses |

Dokumen ini **bukan** revisi rencana itu — arahnya benar dan sebagian besar
detailnya diikuti dengan tepat. Ini daftar empat cacat yang lolos gerbang, plus
nit. Cacat 1 ditemukan lewat probe yang dijalankan, bukan lewat pembacaan;
buktinya dilampirkan supaya tidak perlu diperdebatkan ulang.

Perubahan yang direview masih **belum di-commit** (14 berkas di working tree).
Urutan commit di §5 menggabungkan koreksi ini ke rencana commit asli
(`rencana-paritas-cockpit.md §6`), jadi baca §5 dulu sebelum menyentuh git.

---

## 0. Konteks lingkungan

Sama persis dengan `rencana-paritas-cockpit.md §0` — Windows 10 / PowerShell 5.1
(`&&` dan `??` tidak tersedia), `.venv\Scripts\python.exe`, Postgres di
`127.0.0.1:5433`, frontend di `app/static`. Tiga jebakan yang sama masih berlaku,
terutama yang pertama: **`vitest` berjalan di `environment: "node"`**, jadi
logika yang ingin diuji harus bisa dijalankan tanpa DOM.

Satu hal baru yang penting untuk 6b.1: `mockDaemon` **bisa** diuji di environment
node. Ia hanya memakai `setTimeout`, tidak menyentuh `fetch`, `EventSource`,
maupun `document`. Itulah kenapa cacat 1 bisa — dan harus — ditutup dengan tes
permanen, bukan sekadar diperbaiki.

---

## 1. Cacat 1 — `mockDaemon.followUp` tidak melakukan apa pun

**Tingkat: paling parah.** Ini satu-satunya temuan yang membuat fitur baru gagal
total di salah satu dari dua mode daemon.

### Bukti

Dijalankan sebagai probe sementara terhadap kode yang ada (probe sudah dihapus
lagi; §4 memintanya dijadikan tes permanen):

```
skenario "lancar"
  run pertama  → 11 event, terakhir FINAL
  followUp()   → 1 event: FOLLOW_UP. Tidak ada lagi.
```

### Sebab

`app/static/src/services/mockDaemon.ts`:

```ts
// :299-305
const pump = () => {
  if (!live || !ctx) return;
  const step = steps[cursor];
  if (!step) {
    live = false;        // ← skrip habis → mesin dimatikan
    return;
  }
  …

// :319-322
const resume = () => {
  if (!live) return;     // ← dan resume() menolak menyalakannya lagi
  pump();
};

// :341-346
followUp(text) {
  sink({ type: "FOLLOW_UP", text, ts: nowTs() });
  steps = script(opts.getScenario());
  cursor = 0;
  resume();              // ← no-op
},
```

Bandingkan dengan `submit` (`:325-332`) yang menyetel `live = true` secara
eksplisit. `followUp` mewarisi `resume()` dari `reply`/`defer`, padahal keduanya
dipanggil di keadaan yang berbeda: `reply`/`defer` dipanggil saat skrip sedang
**berhenti di langkah penahan** (`step.emit === null`, `:307-310`) — di situ
`live` masih `true`. `followUp` dipanggil setelah skrip **habis** — di situ
`live` sudah `false`.

Akibatnya: user mengetik lanjutan → reducer pindah ke `queued` → `ComposePanel`
terkunci (`busy` mencakup `queued`) → konsol menggantung selamanya. Hanya
`cancel`/`reset` yang bisa keluar.

### Kenapa lolos semua gerbang

Dua alasan, dan keduanya perlu dicatat supaya tidak terulang:

1. **Tidak ada satu pun tes untuk `mockDaemon`.** Suite frontend menutup
   `consoleMachine` (25), `sseDaemon` fungsi murni (17), dan `taskApi` (6).
   `createMockDaemon` tidak pernah disentuh tes mana pun.
2. **Skenario default menyembunyikannya.** `cascade_tanya` (default) dan `tanya`
   berakhir di langkah penahan, sehingga `live` tetap `true` dan follow-up
   *seolah* jalan. Yang patah justru tiga skenario yang benar-benar selesai:
   `lancar`, `habis`, `crash`. Siapa pun yang menguji cepat dengan skenario
   default akan menyimpulkan fiturnya baik-baik saja.

### Perbaikan

```ts
followUp(text) {
  sink({ type: "FOLLOW_UP", text, ts: nowTs() });
  clear();
  // Tugas lanjutan = run baru: mesin dinyalakan lagi dan akumulator usage
  // dinolkan, sama seperti submit(). resume() saja tidak cukup — `live`
  // sudah false begitu skrip run sebelumnya habis.
  if (ctx) ctx.usage = { in: 0, out: 0, cache: 0, total: 0 };
  steps = script(opts.getScenario());
  cursor = 0;
  live = true;
  pump();
},
```

Dua hal yang wajib, jangan dipangkas:

- **`live = true`** — inti perbaikannya.
- **Reset `ctx.usage`** — `ctx` adalah akumulator yang terus bertambah lintas
  event `USAGE`. Reducer sudah mengosongkan `usage` ke `EMPTY_USAGE` saat
  `FOLLOW_UP`, jadi kalau `ctx` tidak ikut dinolkan, event `USAGE` pertama run
  lanjutan akan melompat balik ke total run sebelumnya. Angkanya akan terlihat
  "hampir benar", yang justru lebih buruk daripada salah terang-terangan.

`ctx.request` sengaja **dipertahankan** — prompt aslinya memang konteks yang
sama, dan itu justru mencerminkan semantik resume-sesi di daemon nyata.

`clear()` dipanggil untuk berjaga kalau masih ada timer menggantung; di jalur
normal tidak ada, tapi `submit` pun melakukannya.

---

## 2. Cacat 2 — cache agent teracuni oleh kegagalan

File: `app/static/src/services/taskApi.ts:49-57`

```ts
if (!cachedAgents) {
  const res = await fetch(`${base}/api/agents`);
  if (res.ok) {
    cachedAgents = (await res.json()) as WireAgent[];
  } else {
    cachedAgents = [];       // ← kegagalan ikut ter-cache, permanen
  }
}
```

Satu kali `/api/agents` gagal — sesi kedaluwarsa, backend baru restart, jaringan
tersendat — dan `cachedAgents` terkunci `[]` sepanjang umur modul. Setiap
`AttemptsPanel` sesudahnya menampilkan `agent #2` dan model `—` untuk **semua**
run, tanpa ada yang memberi tahu bahwa itu data rusak. Persis dua kolom yang jadi
alasan panel ini dibangun.

Rencana §6a.4 menulis "daftar agent di-cache satu kali per modul" — maksudnya
men-cache daftarnya, bukan men-cache kegagalannya.

### Perbaikan

```ts
if (!cachedAgents) {
  const res = await fetch(`${base}/api/agents`);
  // Kegagalan tidak di-cache: panggilan berikutnya harus mencoba lagi, kalau
  // tidak satu kegagalan sesaat mengunci semua nama agent jadi "agent #N".
  if (res.ok) cachedAgents = (await res.json()) as WireAgent[];
}
const rows = toAttemptRows(logs, cachedAgents ?? []);
```

`toAttemptRows` sudah menangani daftar agent kosong dengan benar (fallback
`agent #${id}`, ada tesnya), jadi tidak ada penanganan tambahan yang dibutuhkan
di sisi pemetaan — yang berubah hanya: jangan menyimpan kegagalan.

---

## 3. Cacat 3 — tabel jejak eksekusi tanpa kepala kolom

File: `app/static/src/features/console/AttemptsPanel.tsx`

Rencana §6a.4 menuntut "tabel dengan kolom persis dashboard lama:
`# · agent · model · status · tok in/out`". Dashboard lama memang membuat baris
kepala secara eksplisit (`app/static/app.js:211-216 @ eb1d859~1`):

```js
const head = table.insertRow();
["#", "agent", "model", "status", "tokens in/out"].forEach((h) => { … });
```

Implementasi sekarang merender baris data saja. Hasilnya tiga kolom telanjang
selebar 140/140/100px; untuk antigravity isinya `antigravity`, `—`, `ok`. Tidak
ada yang menjelaskan bahwa `—` itu kolom model — dan justru pada kasus yang
paling butuh penjelasan, labelnya hilang. Kolom token selamat karena isinya
sudah berlabel sendiri (`in: … · out: …`).

### Perbaikan

Ekstrak lebar kolom jadi konstanta bersama supaya kepala dan baris tidak bisa
melenceng satu sama lain, lalu render satu baris kepala di atas `rows.map`:

```tsx
const COLS = { idx: 12, agent: 140, model: 140, status: 100 };
```

Kepala memakai warna `var(--muted)` dan `var(--fs-12)` — sama dengan gaya
`Label` di panel lain; jangan bikin varian tipografi baru. Teks kolom mengikuti
dashboard lama persis: `#`, `agent`, `model`, `status`, `tokens in/out`.

---

## 4. Cacat 4 — kegagalan diam menelan `CascadePanel`

File: `app/static/src/features/console/ConsoleScreen.tsx:227-230`

```tsx
{terminal && state.runId > 0 && !isMock && <AttemptsPanel taskId={state.runId} />}
{showCascade && !terminal && (
  <CascadePanel runId={state.runId} attempts={state.attempts} status={state.status} />
)}
```

digabung dengan `AttemptsPanel.tsx:11-14`:

```tsx
fetchAttempts(taskId).then(setRows).catch(() => {});
…
if (rows.length === 0) return null;
```

Aturan "menggantikan, bukan menumpuk" dari rencana §6a.4 benar dan harus
dipertahankan. Yang kurang adalah jaring pengaman: kalau `/logs` gagal atau
mengembalikan daftar kosong, `AttemptsPanel` merender `null` **dan**
`CascadePanel` sudah ditekan oleh `!terminal`. Run yang baru saja ber-cascade
berakhir tanpa panel apa pun — narasi cascade dicabut, penggantinya tidak
muncul, dan tidak ada pesan error. Pengguna kehilangan informasi yang sebelum
6a.4 justru terlihat.

### Perbaikan

Naikkan hasil pengambilan ke `ConsoleScreen` sebagai status tiga-nilai, sehingga
keputusan "panel mana yang tampil" diambil di satu tempat, bukan tersebar antara
sebuah `return null` dan sebuah ekspresi JSX di berkas lain.

`AttemptsPanel` menerima callback:

```tsx
export function AttemptsPanel({
  taskId,
  onEmpty,
}: {
  taskId: number;
  onEmpty: () => void;
}) {
```

dipanggil pada `.catch` **dan** pada hasil kosong. `ConsoleScreen` menyimpan
`const [attemptsFailed, setAttemptsFailed] = useState(false)`, direset setiap
`state.runId` berubah, lalu:

```tsx
const showAttempts = terminal && state.runId > 0 && !isMock && !attemptsFailed;
…
{showAttempts && <AttemptsPanel taskId={state.runId} onEmpty={() => setAttemptsFailed(true)} />}
{showCascade && !showAttempts && (
  <CascadePanel runId={state.runId} attempts={state.attempts} status={state.status} />
)}
```

Efeknya: jalur normal tidak berubah sama sekali (tetap saling meniadakan), tapi
saat jejak eksekusi tidak bisa diambil, `CascadePanel` kembali muncul sebagai
cadangan. Satu panel selalu ada selama ada sesuatu untuk diceritakan.

**Jangan** menambah spinner atau strip error untuk ini. Panel jejak adalah
informasi pelengkap; kegagalan mengambilnya tidak layak mengganggu layar. Jatuh
diam-diam ke panel cascade adalah degradasi yang benar.

---

## 5. Nit — kerjakan, tapi jangan jadi commit sendiri

1. **`ConsoleScreen.tsx:73-76`** — `const terminal` disisipkan di antara komentar
   "Panel cascade hanya muncul kalau cascade benar-benar terjadi…" dan baris
   `showCascade` yang dijelaskan komentar itu. Pindahkan `terminal` ke atas
   komentar.
2. **`taskApi.ts`** — spasi ekor di baris 26, 35, 58, 62. Tidak ada gerbang lint
   TS di repo ini (`package.json` hanya punya `dev`/`build`/`test`/`typecheck`),
   jadi ini tidak akan tertangkap otomatis.
3. **`IMPLEMENTATION.md`** — deviasi 17, deviasi 18, dan paragraf pengganti di
   §Verifikasi ditulis sebagai satu baris panjang; sisa berkas dilipat ~80 kolom.
   Lipat ulang. Sekalian, deviasi 17 sekarang berbunyi "alasannya karena adapter
   backend tidak memancarkan event `question`" — tambahkan rujukan ke
   `docs/rencana-paritas-cockpit.md §2`, karena di situlah alasan lengkapnya
   (print-mode, penolakan menebak pertanyaan dari prosa) tercatat.

---

## 6. Tes yang harus ditulis

### `src/services/mockDaemon.test.ts` — berkas baru

Ini penutup lubang struktural dari §1: `createMockDaemon` sama sekali belum
tertutup tes, padahal ia sepenuhnya bisa diuji di environment node. Pakai
`vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(120_000)` untuk
menghabiskan skrip tanpa menunggu waktu nyata.

| Tes | Harapan |
|---|---|
| `submit` skenario `lancar` memutar skrip sampai habis | event terakhir bertipe `FINAL` |
| `followUp` setelah `FINAL` menghidupkan skrip lagi | **> 1** event terpancar; ada `SLOT_FREE` sesudah `FOLLOW_UP` |
| `followUp` menolkan akumulator usage | `USAGE` pertama run kedua ≤ `USAGE` pertama run pertama, bukan melanjutkan total lama |
| `followUp` pada skenario `tanya` (berhenti di langkah penahan) | tetap jalan — perbaikan tidak boleh merusak jalur yang tadinya benar |
| `reply` pada skenario `tanya` masih melanjutkan skrip | regresi guard untuk `resume()` |
| `cancel` menghentikan pemancaran | tidak ada event baru setelah `CANCEL` |

Tes kedua adalah regression test langsung untuk cacat 1 — tulis assert-nya
sedemikian rupa sehingga ia **gagal** pada kode sebelum perbaikan. Verifikasi itu
dengan menjalankannya sekali sebelum mengubah `mockDaemon.ts`.

### `src/services/taskApi.test.ts` — tambahan

Enam tes `toAttemptRows` yang ada sudah benar, jangan diubah. `fetchAttempts`
menyentuh `fetch`, jadi butuh `vi.stubGlobal("fetch", …)`. Kalau itu terasa
melebar, cukupkan satu tes yang penting:

| Tes | Harapan |
|---|---|
| `/api/agents` gagal lalu berhasil di panggilan kedua | panggilan kedua mengembalikan nama agent asli, bukan `agent #N` |

Kalau memilih tidak menulisnya, **catat alasannya di commit message** — jangan
diam-diam dilewati.

### Tidak ada tes baru untuk cacat 3 dan 4

Keduanya murni render React, dan environment `node` tidak punya DOM. Menaikkan
suite ke `jsdom` adalah kerjaan tersendiri (sudah dicatat sebagai utang di
`rencana-paritas-cockpit.md §9.5`) dan **jangan** diselipkan ke sini. Keduanya
ditutup verifikasi manual §8.

### Backend

Tidak ada perubahan backend di dokumen ini. `pytest -q` tetap dijalankan sekali
di akhir untuk memastikan tidak ada yang tergeser — 111 passed adalah garis
dasarnya.

---

## 7. Urutan eksekusi & commit

Perubahan 6a.1–6a.7 **belum di-commit**. Jangan menumpuk koreksi ini sebagai
commit terpisah di atasnya — gabungkan ke rencana commit asli
(`rencana-paritas-cockpit.md §6`) supaya sejarahnya tetap terbaca sebagai empat
langkah yang masing-masing benar, bukan empat langkah cacat plus satu tambalan.

1. **`fix(web): pulihkan kotak follow-up untuk run yang selesai`**
   → 6a.1 + 6a.2 + 6a.3 + tes `consoleMachine` + **§1 (mockDaemon)** + **§6 tes
   `mockDaemon`**
   Gerbang: `npm run typecheck`, `npm test`

2. **`feat(web): panel jejak eksekusi dari task_logs`**
   → 6a.4 + tes `taskApi` + **§2** + **§3** + **§4** + nit 2
   Gerbang: `npm run typecheck`, `npm test`

3. **`fix(routing): label target tidak lagi mengarang model "default"`**
   → 6a.5 + 6a.6 + nit 1
   Gerbang: `pytest -q` penuh, `npm run typecheck`, `npm test`

4. **`docs: koreksi status jalur question di catatan cockpit`**
   → 6a.7 + nit 3

Commit 3 menyentuh backend dan harus tetap bisa di-revert sendiri — jangan
menyeret perubahan frontend ke dalamnya.

---

## 8. Verifikasi manual

Delapan langkah di `rencana-paritas-cockpit.md §7` **belum pernah dijalankan**.
Itu satu-satunya cara membuktikan follow-up benar-benar me-resume sesi; tidak ada
tes unit yang bisa menjawabnya. Jalankan semuanya, dan catat hasilnya.

Tiga langkah tambahan khusus untuk koreksi ini:

9. **Mock follow-up jalan di skenario yang selesai.**
   `VITE_CHOROS_DAEMON=mock npm run dev` → skenario **`lancar`** → tunggu `done`
   → kotak lanjutan muncul → kirim. Harapan: skrip berputar lagi dari `queued` →
   `running` → `done`, dan panel usage mulai dari nol, bukan melanjutkan total
   run sebelumnya. Ulangi untuk `habis` dan `crash`. Ini uji langsung cacat 1 —
   jangan mengujinya dengan skenario default, itu yang menyembunyikannya.
10. **Kepala kolom terbaca.** Panel jejak menampilkan `# agent model status
    tokens in/out`, dan lebar kepala sejajar dengan lebar barisnya.
11. **Cadangan cascade bekerja.** Picu cascade sampai `done`, lalu matikan
    backend dan muat ulang riwayat run itu (atau blokir `/logs` lewat DevTools →
    Network → block request URL). Harapan: `CascadePanel` muncul kembali, layar
    tidak kosong, tidak ada error di console browser.

---

## 9. Daftar periksa selesai

- [ ] `mockDaemon.followUp` menyetel `live = true` dan menolkan `ctx.usage`
- [ ] `src/services/mockDaemon.test.ts` ada; tes follow-up terbukti gagal pada kode lama sebelum diperbaiki
- [ ] `fetchAttempts` tidak lagi men-cache kegagalan `/api/agents`
- [ ] `AttemptsPanel` punya baris kepala `# agent model status tokens in/out`, lebar kolom dari satu konstanta
- [ ] `CascadePanel` muncul kembali saat jejak eksekusi gagal diambil atau kosong
- [ ] Nit 1–3 diberesi
- [ ] `npm run typecheck` bersih
- [ ] `npm test` hijau, jumlah tes bertambah dari 48
- [ ] `pytest -q` hijau (111, tidak berubah)
- [ ] `npm run build` sukses
- [ ] Sebelas langkah verifikasi manual (§7 rencana asli + §8 dokumen ini) dijalankan dan hasilnya dicatat
- [ ] Empat commit §7 dibuat dengan isi yang benar, backend terpisah

---

## 10. Yang sudah benar — jangan diutak-atik

Dicatat supaya eksekutor tidak "memperbaiki" hal yang sudah tepat:

- **`FOLLOW_UP` hanya sah dari `done`.** Lima tes menutupinya, termasuk enam
  status lain yang harus mengembalikan `null`. Alasannya 409 dari
  `app/api/tasks.py:127-131`; jangan diperluas ke `halted`/`error`.
- **Stream sengaja dipertahankan** saat `FOLLOW_UP`, sementara
  `result`/`attempts`/`usage`/`route` dikosongkan. Itu inti perilakunya.
- **`resume()` di `sseDaemon.ts:409-421`** benar-benar menyatukan tiga salinan
  (`-50/+24` baris). Jangan dipecah lagi.
- **`RunResult.target` hilang bersih** dari tipe, `FINAL` sseDaemon, `finishSteps`
  mock, dan dua fixture tes. `tokens: 0` di baris yang sama **tidak** disentuh —
  itu memang benar, reducer menambalnya (`consoleMachine.ts:315-316`).
- **`Target.label`** (`app/orchestrator/router.py:57-59`) tidak lagi mengarang
  `default`; 111 tes backend membenarkan asumsi rencana bahwa tidak ada yang
  meng-assert teks itu.
- **`toAttemptRows`** murni dan enam tesnya menutup persis enam baris tabel di
  `rencana-paritas-cockpit.md §5`.

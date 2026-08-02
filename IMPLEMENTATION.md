# choros cockpit — catatan implementasi frontend

Implementasi dari `Choros Cockpit Hi-fi.dc.html` + design system
`choros-design-system-8c23b874-eab6-4296-b0b0-18561f590232`, dibaca lewat MCP
`claude_design` dari project **IA & Flow Console Choros**
(`040cd2bc-ae1e-40c8-a8d8-510409ccf3cd`). Dokumen `Choros IA + State Flow.dc.html`
di project yang sama dipakai sebagai sumber tabel state machine (pemicu masuk,
perilaku UI, afordans, keluar-ke).

Stack: **React 18 + TypeScript (strict) + Vite 5**, tanpa dependency runtime lain.

---

## 1. Pilihan CSS: **vanilla CSS custom properties**, bukan Tailwind

**Yang dipakai:** satu set `:root` custom properties (salinan verbatim file token
DS) + inline style pada komponen yang seluruh nilainya `var(--…)`.

**Kenapa, untuk kasus ini:**

1. **Design system-nya sudah berbentuk CSS custom properties.** `_ds/…/tokens/*.css`
   adalah sumber kebenaran yang ditulis manusia, dan setiap primitive di
   `_ds_bundle.js` ditulis melawan `var(--brand)`, `var(--space-3)`,
   `var(--fs-13)`. Memakai Tailwind berarti menulis ulang token itu ke
   `theme.extend`, lalu menulis ulang tiap komponen dari nilai token ke nama
   utility. Dua terjemahan, dua tempat untuk salah. Porting 1:1 tidak punya
   terjemahan sama sekali — nilai yang saya tulis adalah nilai yang ditulis DS.
2. **Nilainya semantik, bukan skala.** Token di sini bernama `--limit`,
   `--thinking`, `--brand-fill`, `--line-strong` — arah artinya "429", "agent
   sedang menalar", "baris aktif". Tailwind kuat saat token berupa skala
   (`gray-700`, `p-4`); di sini kelas seperti `bg-limit-fill` hanya membungkus
   nama yang sudah ada tanpa menambah apa pun, sementara aturan disiplinnya
   ("teal HANYA untuk aktif/brand") tetap harus dijaga manusia.
3. **Dark-first, satu tema.** Tidak ada mode terang, tidak ada tema per-tenant.
   Nilai `dark:` Tailwind, `color-scheme` switching, dan setengah dari
   configurable-nya jadi bobot mati.
4. **Densitas datang dari geometri eksak, bukan dari skala spacing.** Kolom
   `LogLine` adalah `68px 3px auto 1fr`; tinggi kontrol 26/28/32/38; header panel
   40px; chrome bar 48px. Angka-angka ini on-grid tapi bukan kelipatan skala
   Tailwind bawaan — semuanya akan berakhir sebagai `h-[26px]`, `grid-cols-[68px_3px_auto_1fr]`,
   yang artinya menulis CSS di dalam kelas Tailwind.
5. **Ukuran & rantai build.** Tidak ada PostCSS/Tailwind di dependency; CSS
   ter-build 3.7 kB (1.6 kB gzip).

**Yang dikorbankan, jujur:** tidak ada purge otomatis untuk CSS mati, tidak ada
kelas utility untuk prototipe cepat, dan style varian ditulis sebagai objek JS
(pola persis DS) sehingga tidak bisa dipakai dari luar React. Untuk instrumen
internal 6 layar dengan DS yang sudah presisi, itu pertukaran yang menguntungkan.

---

## 2. Pemetaan token — satu sumber kebenaran

Sumber tunggal: `app/static/src/styles/tokens/`, salinan verbatim dari
`_ds/choros-design-system-…/tokens/`.

| File | Isi |
|---|---|
| `tokens/colors.css` | graphite ramp, brand teal, status, wash fill, alias semantik |
| `tokens/typography.css` | `--font-sans` / `--font-mono`, skala 12/13/15/18/24, tracking |
| `tokens/spacing.css` | grid 4px, radius, border, shadow, tinggi kontrol, motion |
| `tokens/fonts.css` | `@import` Google Fonts (Inter + JetBrains Mono) |
| `tokens/base.css` | default elemen |
| `styles/global.css` | mengimpor kelima di atas + lapisan app |

**Tidak ada satu pun literal hex di `src/components/` atau `src/features/`.**
Empat token turunan ditambahkan karena bundle DS memakai nilainya secara literal
sementara file token tidak menamainya — semua ditandai di `colors.css`:

- `--brand-hover: #5FE3D3` — hover Button primary & warna `a:hover` di `base.css`
- `--on-brand: #04201C` — teks di atas fill teal (Button primary, knob Toggle)
- `--tracking-wordmark: -0.02em` — letter-spacing wordmark
- `--control-sm/-md/-lg`, `--chrome-bar`, `--panel-header` — tinggi kontrol on-grid

Satu-satunya nilai literal yang tersisa: `#1F232A` (background hover Button
secondary) dan `#5B6472` (warna placeholder dari `<style>` file design). Keduanya
berada di file yang memang mendefinisikan token/global, bukan di komponen.

`global.css` juga memegang `@keyframes choros-pulse` — satu definisi untuk seluruh
app (bundle DS menyuntikkannya per-instance lewat `<style>`), plus focus ring teal
`:focus-visible`, scrollbar `.ov`, dan `prefers-reduced-motion`.

---

## 3. Peta komponen DS → React

Semua di `app/static/src/components/ds/`. **Nama dan prop dipertahankan persis**;
nilai style disalin dari `_ds_bundle.js`, bukan ditebak.

| DS (`_ds_bundle.js`) | React | Catatan |
|---|---|---|
| `components/core/Button.jsx` | `Button.tsx` | 4 varian × 3 ukuran (26/32/38), `hoverFor()` per varian |
| `components/core/IconButton.jsx` | `IconButton.tsx` | ghost/secondary, `active` → brand-fill + brand-dim |
| `components/status/StatusDot.jsx` | `StatusDot.tsx` | pulse otomatis untuk `running`/`thinking` |
| `components/status/Badge.jsx` | `Badge.tsx` | 7 tone, mono, tinggi 20, radius sm |
| `components/forms/Input.jsx` | `Input.tsx` | mono default, border teal saat fokus, `prefix` |
| `components/forms/Select.jsx` | `Select.tsx` | native select + chevron SVG |
| `components/forms/Toggle.jsx` | `Toggle.tsx` | 34×20, teal saat on, knob `--radius-full` |
| `components/layout/Panel.jsx` | `Panel.tsx` | header 40px: status · title · subtitle mono · actions |
| `components/layout/Card.jsx` | `Card.tsx` | `interactive` hover border-lift, `active` teal wash |
| `components/navigation/Tabs.jsx` | `Tabs.tsx` | underline 2px, count mono, generic atas `value` |
| `components/data/LogLine.jsx` | `LogLine.tsx` | grid `68px 3px auto 1fr`, gutter per level |
| `components/data/MeterBar.jsx` | `MeterBar.tsx` | tone otomatis: ≥100% limit, ≥85% warn, sisanya brand |
| `components/data/KeyValue.jsx` | `KeyValue.tsx` | label sans-muted 12px, value mono 13px |
| `components/brand/ChorosMark.jsx` | `ChorosMark.tsx` | path SVG identik dengan `assets/choros-mark-chi-ondark.svg` |
| `components/brand/ChorosWordmark.jsx` | `ChorosWordmark.tsx` | Inter 600, tracking −0.02em, lockup dengan mark |

Aset asli disalin apa adanya ke `app/static/public/assets/`
(`choros-mark-chi-ondark.svg`, `favicon.svg`). Mark tidak digambar ulang.

Komponen non-DS (komposisi, bukan primitive baru): `Modal`, `Label`/`Meta`/`Field`,
`Icons` (folder, grip, caret), dan isi tiap modal.

---

## 4. State machine Console + titik integrasi stream nyata

### Bentuknya

`src/state/consoleMachine.ts` — reducer murni bergaya XState, tanpa dependency.

```
idle → queued → running → waiting_for_input → cascading → (done | halted | error)
```

`TRANSITIONS` adalah tabel eksplisit `status × event → status`. Event yang tidak
terdaftar untuk sebuah status **tidak sah**: `transition()` mengembalikan `null`
dan reducer mengembalikan state lama tanpa perubahan. Efeknya penting untuk
instrumen: event daemon yang datang terlambat tidak bisa membangunkan run yang
sudah `done`/`halted`/`error`.

| Status | Masuk lewat | Perilaku UI |
|---|---|---|
| `queued` | `SUBMIT` | pill `queued`, compose terkunci, baris status di stream |
| `running` | `SLOT_FREE`, `REPLY`/`DEFER`, `TARGET_SELECTED` | stream mengalir + auto-scroll, pill teal, usage menetes |
| `waiting_for_input` | `QUESTION` | **auto-scroll berhenti**, kartu question di-pin, input balas ter-fokus otomatis, jump-to-latest muncul |
| `cascading` | `TARGET_FAILED` | panel Percobaan Cascade tumbuh sebagai cerita berurut, pill oranye (`--limit`) — sengaja dibedakan tegas dari teal `running` |
| `done` | `FINAL` | strip Hasil + worktree review (diff / merge / discard) |
| `halted` | `CHAIN_EXHAUSTED`, `CANCEL` | pesan tenang, StatusDot `idle`, countdown reset + link Quota — **bukan** error merah |
| `error` | `FATAL` | baris error mono apa adanya, stack ter-collapse, stream beku di titik gagal, "coba lagi (plan di-reuse)" |

`CANCEL` sah dari `queued`/`running`/`waiting_for_input`/`cascading` → `halted`
(alasan `cancelled`). Ketiga state akhir hanya keluar lewat aksi user:
`RESET` → `idle`, `RESUME` → `queued` (halted), `RETRY` → `queued` (error),
atau `SUBMIT` langsung.

`TOGGLE_PAUSE`, `CLEAR_STREAM`, `SCROLL_AWAY`, `JUMP_LATEST`, `LOG`, `USAGE`
adalah event tampilan: sah di status mana pun, tidak pernah menggeser status.
`pause` menjeda **tampilan** saja — event tetap masuk `state.stream`, dan tombol
jump-to-latest menampilkan berapa event baru direkam selama jeda.

### Tes

`src/state/consoleMachine.test.ts` — 19 tes (`npm test`), menutup: jalur bahagia,
loop cascade, mana saja yang cancellable (dicek terhadap **seluruh** 8 status),
penolakan event telat di state akhir, penolakan `SUBMIT` selama daemon memegang
run, event tampilan yang tidak boleh menggeser status, plus perilaku reducer
(pin question, auto-scroll, penumpukan attempt, pembekuan stream setelah `FATAL`).

### Titik integrasi stream nyata

`src/services/daemon.ts` mendefinisikan `DaemonClient` (`submit`/`reply`/`defer`/
`cancel`/`dispose`) dan `DaemonSink` (`(event: ConsoleEvent) => void`). UI tidak
tahu event datang dari mana.

- **Sekarang:** `src/services/mockDaemon.ts` — memutar skrip event realistis
  dengan jeda waktu nyata. Enam skenario (`cascade + tanya`, `lancar`, `tanya`,
  `cascade`, `rantai habis`, `crash`) bisa dipilih dari Select `mock` di header
  Live console, sehingga tiap cabang state machine bisa dilihat langsung.
- **Nanti:** `src/services/sseDaemon.ts` — sudah ditulis melawan kontrak yang
  **sudah ada** di backend ini: `GET /api/tasks/{id}/stream` (SSE, payload
  `app/events.py::Event.as_dict()`), `POST /api/tasks/{id}/reply`,
  `POST /api/tasks/{id}/cancel`. `toConsoleEvents()` memetakan
  `thinking/tool_call/file_edit/output/question/usage/error/status` ke event
  machine, dan memakai `CASCADE_TRIGGERS` yang sama dengan orchestrator
  (`rate_limit`, `auth`, `crash`, `not_installed`, `timeout`, `permission_denied`)
  untuk membedakan cascade dari kegagalan fatal.

**Penukarannya satu baris** di `src/state/useConsole.ts`:
`createMockDaemon(dispatch, …)` → `createSseDaemon(dispatch, { createTask })`.

**Status jujur `sseDaemon.ts`: ditulis mengikuti kontrak backend, belum pernah
diuji terhadap daemon yang berjalan.** Satu hal yang perlu ditambahkan backend
sebelum dipakai penuh: transisi orkestrator (`started`, `target_selected`,
`chain_exhausted`) saat ini hanya bisa dibaca dari kalimat `status.message`.
`interpretStatus()` sengaja **tidak** menebak dari teks — selama event `status`
belum membawa field eksplisit (`data.transition`, `data.target`, `data.attempt`,
`data.reset_in`), baris status masuk sebagai log biasa. Lebih baik kehilangan
animasi panel cascade daripada salah menyimpulkan state dari string.

---

## 5. Deviasi dari design (dan alasannya)

1. **`Button` menerima `type`** (default tetap `"button"` seperti DS). Dibutuhkan
   agar form di modal editor agent bisa di-submit dengan Enter.
2. **Keyframes `choros-pulse` dipindah ke `global.css`.** Bundle DS menyuntikkan
   `<style>` di dalam setiap `StatusDot` ber-label; satu definisi global
   menghilangkan puluhan node `<style>` duplikat tanpa mengubah tampilan.
3. **Timestamp memakai jam nyata**, bukan `14:02:11` statis dari file design.
   Instrumen live yang menampilkan jam beku akan berbohong.
4. **Kolom `source` LogLine memuat tag + sumber** (`edit⍽antigravity`), dipad
   dengan NBSP supaya rata antar-baris. Design hi-fi hanya menampilkan sumber;
   dokumen lo-fi menampilkan tag `[status] [think] [tool] [edit] [usage]`. Saya
   ambil keduanya sesuai brief ("tag mono + timestamp + gutter warna semantik"),
   dengan tag tetap muted supaya warna hanya masuk lewat gutter.
5. **Select `mock` di header Live console.** File design memakai prop-editor
   `consoleState` milik tooling design untuk berpindah state. Padanannya di app
   nyata adalah memilih skrip yang diputar mock daemon — diberi label `mock`
   supaya jelas ini knob daemon palsu, bukan fitur produk. Hilang sendiri saat
   `sseDaemon` dipasang.
6. **`pause` benar-benar membekukan potongan stream yang dirender** dan
   menghitung event yang masuk selama jeda. Design hanya menampilkan teks "stream
   dijeda (tampilan) — event tetap direkam"; ini membuat kalimat itu benar.
7. **Tombol `↓ jump` selalu ada di header** selain tombol mengambang yang muncul
   saat auto-scroll berhenti — agar afordans `g l` di dokumen IA punya padanan
   yang terlihat.
8. **Routing: drag-to-reorder juga bisa lewat keyboard** (Alt+↑/↓ saat handle ⠿
   fokus). Design hanya menyebut drag; drag saja tidak bisa dipakai tanpa mouse.
9. **Halaman Routing/Quota/Agents/Workflows/Users memakai data lokal** yang
   angkanya identik dengan file design. Belum tersambung ke API — sesuai brief
   ("state lokal cukup").
10. **`+ kategori baru` di Routing membuka modal tapi belum menambah kategori.**
    Kategori adalah konsep milik daemon (`app/orchestrator/router.py::CATEGORIES`);
    menambah kategori palsu di frontend hanya akan berbohong. Modalnya berfungsi,
    aksinya menunggu endpoint.
11. **Nav tetap 6 tab** sesuai hi-fi. Dokumen IA lo-fi mengusulkan konsolidasi ke
    4 destinasi dengan dropdown "Config"; brief meminta 6 tab di topbar, dan hi-fi
    adalah design yang lebih baru.
12. **`Card` interaktif mendapat `role="button"` + `tabIndex` + Enter/Space.** DS
    aslinya `div` biasa; Card dipakai sebagai tombol di riwayat, kategori routing,
    dan baris target, jadi tanpa ini seluruh navigasi itu mati dari keyboard.
13. **Pertanyaan yang sedang di-pin tidak dirender dua kali** — barisnya keluar
    dari daftar stream selama `waiting_for_input` dan kembali sebagai riwayat
    setelah dijawab. Di file design keduanya kebetulan tidak pernah tampil
    bersamaan; di app nyata keduanya hidup dari daftar event yang sama.

## Verifikasi

Selain `npm test` dan `npm run typecheck`, setiap layar dan setiap state dijalankan
di Chromium (Playwright) dan diperiksa hasil render-nya: `idle`, `running`,
`waiting_for_input` (dengan cascade), `running` setelah balasan, `done` + strip
hasil, `halted`, `error` + stack terbuka, transkrip riwayat, `pause` (tampilan
beku + penghitung event baru), ketiga modal, keenam layar, dan viewport sempit
1100px. Tidak ada error console di satu pun alur, dan build produksi dicek
tersaji benar di bawah base `/static/`.

Dua cacat ditemukan lewat pemeriksaan itu dan sudah diperbaiki: baris separator
di modal Browse ter-reset jadi border tebal default karena urutan properti CSS,
dan pertanyaan `waiting_for_input` sempat tampil dua kali (deviasi 13).

---

## 6. Cara jalankan

```bash
cd app/static
npm install
npm run dev          # http://localhost:5173
```

Perintah lain:

```bash
npm test             # 19 tes state machine (vitest)
npm run typecheck    # tsc strict, noUnusedLocals, noUncheckedIndexedAccess
npm run build        # → app/static/dist/
```

### Bersama backend

Frontend ini **menggantikan** `app/static/index.html` + `app.js` + `style.css`
yang lama (masih ada di riwayat git). `app/main.py` sekarang menyajikan
`app/static/dist`:

```python
STATIC_DIR = Path(__file__).parent / "static" / "dist"
```

Jadi urutannya: `npm run build`, lalu jalankan uvicorn seperti biasa dan buka
`http://127.0.0.1:8000`. Selama `npm run dev`, Vite mem-proxy `/api` dan
`/healthz` ke `127.0.0.1:8000` sehingga daemon asli bisa dipakai berdampingan.

`node_modules/` dan `dist/` di-ignore lewat `app/static/.gitignore`.

### Struktur

```
app/static/
  src/
    components/ds/      15 primitive DS (port 1:1)
    components/         Modal, Label, Icons, modals/{AgentEditor,Browse,Diff}
    features/console/   ComposePanel · HistoryList · StreamView · CascadePanel ·
                        ResultStrips · TranscriptView · ConsoleScreen
    features/routing/   RoutingScreen (rantai prioritas, drag-to-reorder)
    features/quota/     QuotaScreen
    features/agents/    AgentsScreen (model default bergantung adapter)
    features/config/    WorkflowsScreen · UsersScreen
    state/              consoleMachine · types · useConsole · modals
    services/           daemon (kontrak) · mockDaemon · sseDaemon
    styles/tokens/      token DS — satu sumber kebenaran
    data/fixtures.ts    data contoh, angkanya sama dengan file design
```

### Aksesibilitas & keyboard

- `⌘↵` / `Ctrl↵` di textarea prompt → Jalankan
- `↵` di input balasan → kirim · `Esc` → lepas fokus
- `Esc` menutup modal; fokus dikunci di dalam modal; klik scrim menutup
- Handle ⠿ Routing: `Alt+↑/↓` untuk mengurut
- Focus ring teal `:focus-visible` di semua kontrol; `prefers-reduced-motion`
  mematikan pulse dan transisi
- `role="switch"`/`aria-checked` (Toggle), `role="tablist"`/`aria-selected` (Tabs),
  `role="dialog"`/`aria-modal` (Modal), `aria-expanded` (baris collapsible)

### Responsif

Kolom compose 340px dan rail kategori 240px `flex:none`; kolom stream
`min-width:0` sehingga baris mono panjang menggulir di dalam kontainernya, bukan
mendorong layout. Panel cascade dan strip hasil `flex-wrap` di layar sempit.
Densitas tidak berubah — tidak ada breakpoint yang membesarkan spacing.

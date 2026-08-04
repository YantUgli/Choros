# Rencana: Console UX — Layout Toggle & Plan→Execute Bridge

## Latar Belakang

Dua masalah UX yang ditemukan dari diskusi:

1. **Layout kaku** — StreamView (live log) mengambil semua ruang tersisa. AttemptsPanel (jejak eksekusi) dan ResultStrip (hasil) terdorong ke bawah dan sering tidak terlihat tanpa scroll.

2. **Gap alur planning → execution** — Setelah planning run selesai, user harus manual copy-paste summary ke ComposePanel untuk memulai coding_complex run. Tidak ada jembatan UI antar keduanya.

---

## Fitur 1: Layout Toggle (2 Mode)

### Scope
- Satu tombol toggle di header Live Console (area kanan, sebelah tombol `pause` / `bersihkan`)
- Dua preset mode, tidak perlu drag handle (dipertimbangkan iterasi berikutnya)

### Mode

**Default (saat ini)** — stream besar, jejak+hasil kecil di bawah:
```
┌─ header ──────────────────────────────[⊞ split]─┐
│ STREAM (flex: 1, scroll)                         │
│ ...log baris...                                   │
├───────────────────────────────────────────────────┤
│ JEJAK EKSEKUSI (flex: none)                       │
│ HASIL / FOLLOW-UP (flex: none)                    │
└───────────────────────────────────────────────────┘
```

**Split** — stream dan area bawah berbagi ruang:
```
┌─ header ──────────────────────────────[⊟ default]┐
│ STREAM (flex: 1, overflow auto)                   │
├───────────────────────────────────────────────────┤
│ JEJAK EKSEKUSI + HASIL (flex: 1, overflow auto)   │
│ (dibungkus container scrollable sendiri)          │
└───────────────────────────────────────────────────┘
```

### File yang Diubah
- `ConsoleScreen.tsx` — state `layoutMode` (`"default" | "split"`), tombol toggle di header, wrapper flex yang menyesuaikan proporsi
- Tidak ada perubahan di file lain

### Catatan
- State `layoutMode` cukup di local state, tidak perlu persist
- AttemptsPanel dan ResultStrip tetap dalam satu container di bawah, tidak dipisah

---

## Fitur 2: Plan → Execute Bridge

### Alur yang Didukung

```
Planning run selesai (done)
        ↓
ResultStrip menampilkan result.summary
+ tombol [Eksekusi plan ini →] (hanya muncul kalau category === "planning")
        ↓
Klik → ComposePanel terisi:
  - kategori: coding_complex
  - textarea: "[Referensi plan dari run #N]\n{result.summary}\n\n---\n"
  - field lain (mode, path, floor) tidak diubah
        ↓
User bisa edit prompt → Jalankan
```

### Flow Revisi Plan (sudah ter-cover)

```
Planning done → baca → tidak sesuai
        ↓
FollowUpStrip: kirim usulan revisi
        ↓
Run baru (masih konteks planning) → result.summary diperbarui
        ↓
Tombol "Eksekusi plan ini" muncul lagi dengan plan terbaru ✅
```

### Execute Lebih dari 1x (sudah ter-cover)

ComposePanel tidak mereset textarea setelah submit. Setelah execution run selesai, konten textarea masih ada — user tinggal klik "Jalankan" lagi tanpa perlu re-trigger tombol. ✅

### Yang Tidak Di-cover (Deferred)

- Re-execute plan dari historical run (history masih read-only). Cukup jarang, dijadikan iterasi berikutnya.

### File yang Diubah

**`ResultStrips.tsx`**
- `ResultStrip` menerima prop tambahan: `category?: string` dan `onExecutePlan?: () => void`
- Tombol "Eksekusi plan ini →" muncul kalau `category === "planning"` dan `onExecutePlan` ada

**`ConsoleScreen.tsx`**
- Teruskan `category` dan callback `onExecutePlan` ke `ResultStrip`
- Callback: set state di ComposePanel (lihat bawah)

**`ComposePanel.tsx`**
- Expose method / terima prop `prefill?: { prompt: string; category: TaskCategory }` untuk diisi dari luar
- Atau: lift state `prompt` dan `category` ke `ConsoleScreen` dan pass turun ke `ComposePanel`

### Pilihan Arsitektur: Lift State vs Ref

Dua opsi untuk mengisi ComposePanel dari luar:

**Opsi A — Lift state ke ConsoleScreen (lebih React-idiomatic):**
- `prompt` dan `category` di `ConsoleScreen` sebagai state
- Di-pass ke `ComposePanel` sebagai controlled props
- Callback `onExecutePlan` di `ConsoleScreen` tinggal `setPrompt(...)` dan `setCategory("coding_complex")`

**Opsi B — `useImperativeHandle` / ref:**
- ComposePanel expose method `prefill(prompt, category)` via ref
- Lebih lokal tapi kurang idiomatis

**Rekomendasi: Opsi A (lift state)** — ComposePanel saat ini sudah cukup kecil, lift state tidak menambah kompleksitas signifikan.

---

## Urutan Pengerjaan

1. Fitur 1: Layout Toggle — perubahan terisolasi di `ConsoleScreen.tsx`, tidak ada risk regresi
2. Fitur 2a: Prop tambahan di `ResultStrip` + lift state `prompt`/`category` ke `ConsoleScreen`
3. Fitur 2b: Callback `onExecutePlan` di `ConsoleScreen` → pre-fill ComposePanel

---

## Out of Scope

- Drag handle / resize bebas (iterasi berikutnya)
- Re-execute plan dari history (iterasi berikutnya)
- Continue session / shared context antar run (tidak dibutuhkan)
- Perubahan backend

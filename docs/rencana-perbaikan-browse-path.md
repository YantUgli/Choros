# Rencana perbaikan: fitur "Browse…" (project path)

Status: **arah diputuskan — modal UI in-app dengan data direktori asli, BUKAN dialog OS native.**
Dokumen ini ditulis agar bisa dieksekusi oleh agent lain tanpa konteks percakapan sebelumnya.

## §0 Konteks lingkungan (wajib dibaca sebelum eksekusi)

- Repo: `C:\project\Choros`, branch `feat/cockpit-frontend`.
- Stack: FastAPI (`app/`) + PostgreSQL, frontend React 18 + TypeScript 5 + Vite 5 di `app/static/`.
- FastAPI menyajikan **`app/static/dist`** (`app/main.py:26`), bukan `src/` — perubahan frontend baru terlihat di `localhost:8000` setelah `npm run build`.
- Interpreter Python venv: `C:\project\Choros\.venv\Scripts\python.exe` (Python 3.12.10; `python` polos tidak ada di PATH). `pytest` harus dijalankan dari root repo, bukan dari `app/static`.
- **`.env` di root repo berisi `GROQ_API_KEY` dan `CHOROS_SECRET_KEY` yang hidup — jangan pernah dibuka, di-echo, dikutip, atau dikirim isinya.**
- Tidak ada eslint di repo ini. Gate otomatis yang ada hanya `tsc -b`, `vitest run` (environment `"node"`, tanpa DOM), dan `vite build`.
- Python 3.12 di Windows menyediakan `os.listdrives()` — dikonfirmasi lewat `.venv\Scripts\python.exe` di mesin ini mengembalikan `['C:\\', 'D:\\', 'E:\\']` (data asli, bukan fixture).

## §1 Keputusan: kenapa bukan native OS picker

Draf sebelumnya (lihat riwayat: WIP yang sempat ada di `app/api/fs.py`/`app/static/src/services/fsApi.ts`, sebelum ditinggalkan) mencoba memicu dialog folder-picker `tkinter` dari backend lewat subprocess. Itu **ditolak**, bukan cuma karena baru ada bug (subprocess blocking sinkron membekukan seluruh event loop asyncio tunggal choros — lihat `app/runtime.py`), tapi karena keterbatasan arsitekturalnya tidak bisa benar-benar "diperbaiki": dialog native terbuka di layar mesin tempat **server** (`uvicorn`) berjalan, bukan di layar tempat **browser** diakses. Untuk tool self-hosted yang bisa diakses dari perangkat lain di LAN, itu cacat bawaan, bukan bug yang bisa ditambal.

**Keputusan**: kembali ke modal UI in-app (folder browser yang dirender React, dikendalikan lewat API biasa) — konsisten di mesin manapun browser diakses, tidak butuh subprocess/GUI native sama sekali, dan menghapus seluruh kelas masalah event-loop-blocking di atas dengan sendirinya (bukan cuma dipatch).

Modal semacam ini **sudah pernah ada**: `app/static/src/components/modals/BrowseModal.tsx` (dihapus dalam WIP yang sama saat draf native ditulis). Masalahnya, implementasi lamanya memakai **data fixture palsu** — persis pelanggaran yang sama yang sudah dibersihkan dari layar lain di commit `edc9e7a` ("chore(web): cabut fixture dari layar produksi") dan `540c248`/`e376888`:

```ts
// data contoh
const FS: Record<string, string[]> = {
  "C:\\": ["project", "Users", "Windows", "temp"],
  "C:\\project": ["src", "Assets", "api", "infra", "web"],
  ...
};
```

Modal ini menampilkan struktur folder yang **sama sekali tidak ada hubungannya** dengan filesystem mesin yang sebenarnya menjalankan choros. Rencana ini menghidupkan kembali UI shell-nya (breadcrumb, tombol naik, daftar folder, "Pilih folder ini" — sudah teruji secara UX) tapi menggantikan `FS` fixture dengan pemanggilan API nyata ke backend yang membaca filesystem betulan lewat `os.scandir`/`pathlib`.

## §2 Desain

### Backend — `GET /api/fs/list`

Endpoint baru menggantikan `pick-native` (yang tidak pernah berfungsi dan sekarang dibuang seluruhnya, termasuk import `subprocess`/`sys` dan seluruh pendekatan tkinter-subprocess):

- `path` kosong/tidak diisi → tampilkan **drive** yang tersedia (`os.listdrives()`, Windows-only tapi tersedia karena `requires-python = ">=3.12"`) sebagai titik masuk virtual. `parent: null`.
- `path` diisi → validasi itu direktori yang benar-benar ada (`Path(path).is_dir()`, 404 kalau tidak), lalu `os.scandir` untuk mendaftar **hanya subfolder** (bukan file), diurutkan case-insensitive. Entry yang gagal di-`stat` (symlink rusak, dsb.) dilewati per-entry, bukan menggagalkan seluruh request. `PermissionError` pada direktori itu sendiri → 403 dengan pesan jelas (bukan 500 generik).
- `parent` dihitung dari `Path(path).resolve().parent`; kalau root drive (`parent == path` setelah resolve, karena parent dari root adalah dirinya sendiri di Windows), `parent` dikembalikan `null` — ini yang membuat tombol "naik" dari `C:\` kembali ke daftar drive virtual, bukan error atau diam di tempat.
- Tidak ada pembatasan direktori (tidak di-sandbox ke folder project tertentu) — ini **disengaja**: seluruh titik dari fitur ini adalah menunjuk ke path project mana pun di host yang dikelola choros, dan endpoint sudah di belakang auth (`CurrentUser`), konsisten dengan model trust yang sudah dipakai endpoint lain di `app/api/`.

Tidak ada subprocess, tidak ada thread offloading yang dibutuhkan — `os.scandir`/`pathlib` adalah operasi filesystem lokal yang cepat, tidak memblokir event loop secara berarti untuk direktori berukuran wajar (beda kelas dengan menunggu interaksi manusia di dialog GUI selama puluhan detik-menit).

### Frontend — `BrowseModal.tsx` dipulihkan, di-backend data asli

- `fsApi.ts`: `fetchFsPickNative` (untuk `pick-native`) diganti total dengan `fetchFsList(path)` yang memanggil `/api/fs/list`.
- `BrowseModal.tsx`: state `cwd`/`parent`/`entries` diisi dari `fetchFsList`, bukan lookup ke `FS` konstan. **Wajib** ada state `loading`/`error` per navigasi (masuk folder atau naik folder memicu fetch baru) — pola yang sama yang sudah dipakai untuk memperbaiki `ComposePanel` category dropdown sebelumnya (jangan biarkan kegagalan fetch tampil sebagai daftar kosong yang diam-diam salah, harus ada pesan error yang jelas dan bisa dicoba lagi).
- `modals.tsx`: kembalikan wiring `openBrowse`/`ModalRequest["browse"]`/render branch yang sempat dihapus (lihat diff yang sudah diamati sebelumnya — reversal-nya literal, karena signature `BrowseModal` props `{ initial, onPick, onClose }` tidak berubah).
- `ComposePanel.tsx`: kembalikan `handleBrowse` menjadi `modals.openBrowse(projectPath || "C:\\project", setProjectPath)` seperti semula; hapus `fetchFsPickNative`/state `picking` (loading kini murni tanggung jawab modal, bukan tombol pemicu).
- `test_tk.py` di root repo (sisa debug pendekatan native yang ditinggalkan) — dihapus.

## §3 Patch

### Patch 1 — `app/api/fs.py`: ganti total isi file

Dari (versi native yang ditinggalkan):

```python
from fastapi import APIRouter, HTTPException
import subprocess
import sys
from pydantic import BaseModel

from app.security import CurrentUser

router = APIRouter(prefix="/api/fs", tags=["fs"])

class PickResult(BaseModel):
    path: str | None

@router.get("/pick-native", response_model=PickResult)
async def pick_native(user: CurrentUser, initial: str = "C:\\"):
    ...
```

menjadi:

```python
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.security import CurrentUser

router = APIRouter(prefix="/api/fs", tags=["fs"])


class FsListResult(BaseModel):
    path: str
    parent: str | None
    entries: list[str]


@router.get("/list", response_model=FsListResult)
async def list_dir(user: CurrentUser, path: str = "") -> FsListResult:
    if not path:
        # Titik masuk virtual: daftar drive asli mesin ini (Windows).
        drives = list(os.listdrives()) if hasattr(os, "listdrives") else []
        return FsListResult(path="", parent=None, entries=drives)

    p = Path(path)
    if not p.is_dir():
        raise HTTPException(status_code=404, detail="folder tidak ditemukan")

    resolved = p.resolve()
    entries: list[str] = []
    try:
        with os.scandir(resolved) as it:
            for entry in it:
                try:
                    if entry.is_dir():
                        entries.append(entry.name)
                except OSError:
                    continue  # symlink rusak/entry tak bisa di-stat, lewati
    except PermissionError:
        raise HTTPException(status_code=403, detail="tidak punya izin membaca folder ini")

    entries.sort(key=str.lower)

    parent_path = resolved.parent
    parent = str(parent_path) if parent_path != resolved else None

    return FsListResult(path=str(resolved), parent=parent, entries=entries)
```

Catatan implementasi: perilaku persis `Path(...).resolve()` untuk root drive Windows (format string `C:\\` vs `C:/`) perlu dikonfirmasi langsung saat eksekusi (jalankan `python -c "from pathlib import Path; print(Path('C:\\\\').resolve())"` di venv) — sesuaikan perbandingan `parent_path != resolved` kalau ternyata representasinya tidak seperti yang diasumsikan di sini. Ini murni detail formatting path, bukan keputusan desain.

### Patch 2 — `app/static/src/services/fsApi.ts`: ganti total isi file

Dari:

```ts
import { apiGet } from "./api";

export async function fetchFsPickNative(initial: string): Promise<string | null> {
  const url = new URL("/api/fs/pick-native", window.location.origin || "http://localhost");
  if (initial) {
    url.searchParams.set("initial", initial);
  }
  const res = await apiGet<{ path: string | null }>(url.pathname + url.search);
  return res.path;
}
```

menjadi:

```ts
import { apiGet } from "./api";

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: string[];
}

export async function fetchFsList(path: string): Promise<FsListResult> {
  const url = new URL("/api/fs/list", window.location.origin || "http://localhost");
  if (path) {
    url.searchParams.set("path", path);
  }
  return apiGet<FsListResult>(url.pathname + url.search);
}
```

### Patch 3 — `app/static/src/components/modals/BrowseModal.tsx`: buat ulang (data asli, bukan fixture)

File ini dihapus dalam WIP sebelumnya (`git status` menunjukkan `D  app/static/src/components/modals/BrowseModal.tsx`). Buat ulang dengan isi:

```tsx
import { useEffect, useState } from "react";
import { Button } from "../ds";
import { FolderIcon } from "../Icons";
import { Label } from "../Label";
import { Modal } from "../Modal";
import { fetchFsList } from "../../services/fsApi";

/** Folder picker: naik/turun folder lewat /api/fs/list, breadcrumb mono, "Pilih folder ini". */
export function BrowseModal({
  initial,
  onPick,
  onClose,
}: {
  initial: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState(initial || "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchFsList(cwd)
      .then((res) => {
        if (!active) return;
        setCwd(res.path);
        setParent(res.parent);
        setEntries(res.entries);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const up = () => {
    if (parent !== null) setCwd(parent);
  };

  const enter = (name: string) => {
    if (!cwd) {
      setCwd(name);
      return;
    }
    const sep = cwd.endsWith("\\") ? "" : "\\";
    setCwd(cwd + sep + name);
  };

  return (
    <Modal title="Pilih project path" width={560} onClose={onClose}>
      <div
        style={{
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Button variant="ghost" size="sm" onClick={up} disabled={parent === null} aria-label="naik satu folder">
            ↑
          </Button>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-13)",
              color: "var(--muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
          >
            {cwd || "( pilih drive )"}
          </div>
        </div>

        <div
          className="ov"
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg)",
            maxHeight: 280,
            minHeight: 120,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading && (
            <div style={{ padding: "var(--space-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--muted)" }}>
              memuat...
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--limit)" }}>{error}</span>
              <Button size="sm" onClick={() => setCwd((c) => c)}>Coba lagi</Button>
            </div>
          )}
          {!loading && !error && entries.map((name) => (
            <button
              key={name}
              type="button"
              className="choros-hover-row"
              onClick={() => enter(name)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 12px",
                border: "none",
                borderBottom: "1px solid var(--line)",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-13)",
                color: "var(--text)",
                textAlign: "left",
                transition: "background var(--dur) var(--ease)",
              }}
            >
              <FolderIcon />
              <span>{name}</span>
            </button>
          ))}
          {!loading && !error && entries.length === 0 && (
            <div
              style={{
                padding: "var(--space-3)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--muted)",
              }}
            >
              tidak ada subfolder
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Label style={{ flex: "none" }}>Terpilih</Label>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-13)",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
          >
            {cwd || "—"}
          </span>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="md" disabled={!cwd} onClick={() => onPick(cwd)}>
            Pilih folder ini
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

Catatan: tombol "Coba lagi" di atas memakai `setCwd((c) => c)` sekadar memicu re-render — ini **tidak** akan memicu ulang `useEffect` karena nilai `cwd` tidak berubah (dependency array React membandingkan nilai, bukan identitas call). Perbaikan yang benar: tambahkan counter `retryTick` terpisah di dependency array effect, atau ekstrak fetch ke fungsi bernama dan panggil langsung dari tombol "Coba lagi" alih-alih lewat `setCwd`. Pilih salah satu saat implementasi — jangan biarkan tombol "Coba lagi" ini tidak benar-benar memicu fetch ulang.

### Patch 4 — `app/static/src/state/modals.tsx`: kembalikan wiring `openBrowse`

Kembalikan bagian yang terhapus di WIP sebelumnya (lihat `git diff` yang sudah diamati — reversal ini literal karena `BrowseModal` (Patch 3) punya signature props yang identik dengan versi lama):

```ts
import { BrowseModal } from "../components/modals/BrowseModal";
```

tambahkan kembali di union `ModalRequest`:

```ts
  | { type: "browse"; initial: string; onPick: (path: string) => void }
```

tambahkan kembali di `ModalApi`:

```ts
  openBrowse: (initial: string, onPick: (path: string) => void) => void;
```

tambahkan kembali di objek implementasi:

```ts
      openBrowse: (initial, onPick) => setModal({ type: "browse", initial, onPick }),
```

tambahkan kembali render branch:

```tsx
      {modal?.type === "browse" && (
        <BrowseModal
          initial={modal.initial}
          onPick={(p) => {
            modal.onPick(p);
            close();
          }}
          onClose={close}
        />
      )}
```

### Patch 5 — `app/static/src/features/console/ComposePanel.tsx`: kembalikan ke `modals.openBrowse`

Dari (versi native yang ditinggalkan):

```tsx
import { useState, type KeyboardEvent } from "react";
import { Button, Input, Select, Toggle } from "../../components/ds";
import { Caret } from "../../components/Icons";
import { Field, Label } from "../../components/Label";
import { useApiResource } from "../../state/useApiResource";
import { fetchCategories } from "../../services/routingApi";
import { fetchFsPickNative } from "../../services/fsApi";
import type { RunRequest, TaskCategory, TaskMode } from "../../state/types";
```
```tsx
  const [picking, setPicking] = useState(false);

  const handleBrowse = async () => {
    setPicking(true);
    try {
      const path = await fetchFsPickNative(projectPath || "C:\\");
      if (path) {
        setProjectPath(path);
      }
    } catch (e: any) {
      alert("Gagal membuka file explorer: " + (e.message || String(e)));
    } finally {
      setPicking(false);
    }
  };
```
```tsx
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBrowse}
            disabled={picking}
          >
            {picking ? "Memilih..." : "Browse…"}
          </Button>
```

menjadi:

```tsx
import { useState, type KeyboardEvent } from "react";
import { Button, Input, Select, Toggle } from "../../components/ds";
import { Caret } from "../../components/Icons";
import { Field, Label } from "../../components/Label";
import { useModals } from "../../state/modals";
import { useApiResource } from "../../state/useApiResource";
import { fetchCategories } from "../../services/routingApi";
import type { RunRequest, TaskCategory, TaskMode } from "../../state/types";
```
```tsx
  const modals = useModals();
```
(hapus seluruh `handleBrowse`/`picking` — tidak dibutuhkan lagi, loading kini ditangani di dalam `BrowseModal`)
```tsx
          <Button
            variant="secondary"
            size="sm"
            onClick={() => modals.openBrowse(projectPath || "C:\\project", setProjectPath)}
          >
            Browse…
          </Button>
```

### Patch 6 — bersihkan sisa pendekatan native

```
rm test_tk.py
```

`test_tk.py` di root repo adalah skrip debug manual untuk pendekatan `tkinter` yang sudah ditinggalkan sepenuhnya — tidak relevan lagi dengan arah modal UI.

## §4 Test plan

- **Backend** (`tests/test_fs.py`, baru): pakai `tmp_path` pytest fixture untuk membuat struktur folder nyata (bukan mock filesystem) — mis. `tmp_path / "a" / "b"` — lalu assert `GET /api/fs/list?path=<tmp_path>` mengembalikan `entries` yang cocok persis dengan subfolder yang benar-benar dibuat, dan `parent` mengarah ke induk yang benar. Tambahkan kasus: path tidak ada → 404; path menunjuk ke sebuah **file** (bukan folder) → 404 (`is_dir()` bernilai False); folder tanpa izin baca (kalau bisa disimulasikan lewat `os.chmod` di lingkungan test, opsional/best-effort di Windows karena model permission-nya berbeda dari POSIX). Kasus `path=""` → assert `entries` adalah list (boleh kosong kalau `os.listdrives` tidak tersedia di platform test), `parent is None`.
- **Frontend** (`BrowseModal.test.tsx`, baru, kalau proyek mulai menambah test dengan `environment: "jsdom"` — cek dulu `vitest.config.ts` apakah sudah mendukung DOM testing; kalau belum, ini opsional dan tidak memblokir, cukup andalkan verifikasi manual §6): mock `fetchFsList` untuk mengembalikan hasil deterministik, assert klik folder memicu fetch baru dengan `path` yang benar, klik "↑" saat `parent === null` tidak memicu fetch (tombol disabled).
- Tidak perlu test untuk `fsApi.ts` di luar yang sudah ada di atas — fungsinya cuma memanggil `apiGet` dengan URL yang benar, pola yang sama seperti `routingApi.ts`/`quotaApi.ts` lain yang sudah punya cakupan test serupa.

## §5 Urutan eksekusi

1. Verifikasi ulang `git status` — pastikan daftar file WIP masih sama seperti yang teramati (`app/api/fs.py`, `app/static/src/services/fsApi.ts` untracked; `BrowseModal.tsx` terhapus; `app/api/__init__.py`, `ComposePanel.tsx`, `modals.tsx` termodifikasi; `test_tk.py` untracked) sebelum mengasumsikan patch berlaku pada file yang tepat.
2. Konfirmasi format `Path(...).resolve()` untuk root drive Windows (lihat catatan di Patch 1) — sesuaikan perbandingan `parent` kalau perlu.
3. Terapkan Patch 1 (`app/api/fs.py`).
4. Terapkan Patch 2 (`fsApi.ts`).
5. Terapkan Patch 3 (`BrowseModal.tsx`, buat ulang) — putuskan cara memperbaiki tombol "Coba lagi" (lihat catatan di Patch 3) sebelum menganggap file ini selesai.
6. Terapkan Patch 4 (`modals.tsx`).
7. Terapkan Patch 5 (`ComposePanel.tsx`).
8. Terapkan Patch 6 (hapus `test_tk.py`).
9. (Disarankan) Tambahkan test backend dari §4.
10. Jalankan gate:
    - `.venv\Scripts\python.exe -m pytest -q` dari root repo.
    - `cd app/static && npx tsc -b && npx vitest run`.
    - `npm run build` di `app/static`.
11. Verifikasi manual (§6).
12. Commit satu kali (WIP native belum pernah di-commit, jadi tidak ada riwayat bermakna untuk dipisah) dengan pesan yang menyebutkan modal UI + data asli menggantikan pendekatan native yang ditinggalkan.

## §6 Verifikasi manual (wajib)

1. `npm run build` di `app/static`, jalankan server, buka `localhost:8000`.
2. Di Compose panel, klik "Browse…" → modal terbuka, menampilkan drive **asli** mesin ini (`C:\`, `D:\`, dst — bukan daftar `["project", "Users", "Windows", "temp"]` dari fixture lama).
3. Masuk ke drive `C:\` → daftar folder yang tampil harus **cocok dengan isi sebenarnya** folder `C:\` di mesin ini (verifikasi manual lewat Explorer sungguhan sebagai pembanding) — bukan `["project", "Users", "Windows", "temp"]` yang di-hardcode.
4. Navigasi masuk beberapa level folder nyata, lalu klik "↑" berulang kali sampai kembali ke daftar drive — pastikan tombol "↑" nonaktif tepat saat di daftar drive (tidak ada "naik" lebih jauh dari situ).
5. Coba masuk ke folder yang tidak punya izin baca (kalau ada) → pastikan muncul pesan error yang jelas, bukan daftar kosong yang menyesatkan atau crash.
6. Klik "Pilih folder ini" → modal tertutup, `Project path` di Compose panel terisi path yang benar-benar dipilih.
7. Klik "Batal" → modal tertutup, `Project path` tidak berubah.
8. Selama modal terbuka dan memuat folder, pastikan tab lain (Console/Quota) tetap responsif — seharusnya tidak ada alasan untuk hang sama sekali sekarang karena tidak ada subprocess/dialog GUI yang terlibat, tapi tetap diperiksa untuk memastikan tidak ada regresi tak terduga.

## §7 Definition of done

- [ ] `git status` diverifikasi ulang sebelum patch diterapkan.
- [ ] Format `Path.resolve()` untuk root drive Windows dikonfirmasi (Patch 1).
- [ ] Patch 1-6 diterapkan.
- [ ] Tombol "Coba lagi" di `BrowseModal` benar-benar memicu fetch ulang (bukan no-op `setCwd` yang nilainya tidak berubah).
- [ ] `pytest -q` lulus dari root repo, termasuk test baru `tests/test_fs.py` yang memverifikasi terhadap folder `tmp_path` **nyata**.
- [ ] `tsc -b`, `vitest run`, `npm run build` semua bersih.
- [ ] Verifikasi manual §6 dilakukan — folder yang tampil di modal cocok dengan isi filesystem sebenarnya, bukan data hardcoded.
- [ ] Tidak ada sisa referensi ke `pick-native`/`fetchFsPickNative`/`tkinter`/`subprocess` untuk fitur ini di seluruh repo (`grep -rn "pick-native\|pick_native\|fetchFsPickNative" app/`).

#!/usr/bin/env python3
"""
Script manual test Choros — 4 skenario plan & execute.

Jalankan SETELAH server Choros hidup:
    python scripts/manual_test.py

Atau dengan URL & kredensial custom:
    python scripts/manual_test.py --url http://localhost:8000 --user admin --pass secret
"""
from __future__ import annotations

import argparse
import json
import sys
import textwrap
import time
from dataclasses import dataclass

import httpx

# ─── Warna terminal ───────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"
CYAN   = "\033[36m"
BLUE   = "\033[34m"
MAGENTA= "\033[35m"


def ok(msg: str)    -> None: print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg: str)  -> None: print(f"  {RED}✗{RESET} {msg}")
def info(msg: str)  -> None: print(f"  {CYAN}→{RESET} {msg}")
def warn(msg: str)  -> None: print(f"  {YELLOW}!{RESET} {msg}")
def step(n: int, title: str) -> None:
    print(f"\n{BOLD}{BLUE}[{n}] {title}{RESET}")
    print(f"  {DIM}{'─' * 55}{RESET}")

def header(title: str) -> None:
    bar = "═" * 60
    print(f"\n{BOLD}{MAGENTA}{bar}")
    print(f"  {title}")
    print(f"{bar}{RESET}")

def section(title: str) -> None:
    print(f"\n{BOLD}{CYAN}━━━ {title} ━━━{RESET}")

def pause(msg: str = "Tekan Enter untuk lanjut...") -> None:
    input(f"\n  {YELLOW}⏸  {msg}{RESET}")

def ask(prompt: str, default: str = "") -> str:
    hint = f" [{default}]" if default else ""
    val = input(f"  {CYAN}?{RESET} {prompt}{hint}: ").strip()
    return val if val else default

def pprint(obj) -> None:
    print(textwrap.indent(json.dumps(obj, indent=2, ensure_ascii=False), "    "))


# ─── HTTP Client ──────────────────────────────────────────────────────────────

@dataclass
class Choros:
    base: str
    client: httpx.Client

    def get(self, path: str, **kw) -> httpx.Response:
        return self.client.get(f"{self.base}{path}", **kw)

    def post(self, path: str, **kw) -> httpx.Response:
        return self.client.post(f"{self.base}{path}", **kw)

    def require_ok(self, r: httpx.Response, label: str) -> dict:
        if r.status_code >= 400:
            fail(f"{label} → HTTP {r.status_code}: {r.text[:300]}")
            sys.exit(1)
        data = r.json()
        return data


# ─── Helpers ──────────────────────────────────────────────────────────────────

def wait_task(api: Choros, task_id: int, label: str = "", timeout: int = 120) -> dict:
    """Poll task sampai status terminal; tampilkan spinner."""
    TERMINAL = {"ok", "halted", "error", "cancelled", "interrupted"}
    deadline = time.time() + timeout
    frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    i = 0
    while time.time() < deadline:
        r = api.get(f"/api/tasks/{task_id}")
        task = r.json()
        status = task.get("status", "?")
        tag = f" ({label})" if label else ""
        print(f"\r  {CYAN}{frames[i % len(frames)]}{RESET} task #{task_id}{tag} — {status}   ", end="", flush=True)
        if status in TERMINAL:
            print()  # newline setelah spinner
            return task
        i += 1
        time.sleep(1.5)
    print()
    fail(f"timeout {timeout}s — task #{task_id} masih {status}")
    return task


def wait_run(api: Choros, run_id: int, wait_status: set[str] | None = None, timeout: int = 120) -> dict:
    """Poll workflow run sampai status yang diinginkan."""
    TERMINAL = {"ok", "halted", "error", "awaiting_approval"}
    want = wait_status or TERMINAL
    deadline = time.time() + timeout
    frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    i = 0
    while time.time() < deadline:
        r = api.get(f"/api/workflow-runs/{run_id}")
        run = r.json()
        status = run.get("status", "?")
        print(f"\r  {CYAN}{frames[i % len(frames)]}{RESET} run #{run_id} — {status}   ", end="", flush=True)
        if status in want:
            print()
            return run
        i += 1
        time.sleep(1.5)
    print()
    warn(f"timeout {timeout}s — run #{run_id} masih {status}")
    return run


def show_task_events(api: Choros, task_id: int) -> None:
    """Tampilkan event penting dari task (status + output)."""
    events = api.get(f"/api/tasks/{task_id}/events").json()
    for e in events:
        t = e.get("type")
        d = e.get("data", {})
        if t == "status":
            msg = d.get("message") or d.get("transition") or ""
            if msg:
                info(f"[event] {msg}")
        elif t == "output" and d.get("final"):
            txt = (d.get("text") or "")[:300]
            print(f"  {GREEN}OUTPUT:{RESET} {txt}")
        elif t == "error":
            fail(f"[error] {d.get('message', '')}")


def pick_agent(api: Choros, label: str) -> dict:
    """Tampilkan daftar agent, minta user pilih."""
    agents = api.get("/api/agents").json()
    if not agents:
        fail("Tidak ada agent terdaftar. Buat agent dulu di UI Choros.")
        sys.exit(1)
    print(f"\n  Agent tersedia untuk {BOLD}{label}{RESET}:")
    for i, a in enumerate(agents):
        adapter = a.get("adapter_type", "?")
        model = a.get("default_model") or "-"
        print(f"    {CYAN}[{i}]{RESET} {a['name']}  adapter={adapter}  model={model}")
    while True:
        raw = ask(f"Pilih nomor agent untuk {label}", "0")
        try:
            idx = int(raw)
            if 0 <= idx < len(agents):
                chosen = agents[idx]
                ok(f"Dipilih: {chosen['name']}")
                return chosen
        except ValueError:
            pass
        warn("Pilihan tidak valid, coba lagi.")


def create_workflow(api: Choros, name: str, steps: list[dict]) -> dict:
    payload = {"name": name, "steps": steps}
    r = api.post("/api/workflows", json=payload)
    return api.require_ok(r, f"create workflow '{name}'")


def run_workflow(api: Choros, wf_id: int, goal: str, allow_unisolated: bool = True) -> dict:
    payload = {"goal": goal, "allow_unisolated": allow_unisolated}
    r = api.post(f"/api/workflows/{wf_id}/run", json=payload)
    return api.require_ok(r, "run workflow")


# ─── Skenario ─────────────────────────────────────────────────────────────────

def scenario_1_single_planning_task(api: Choros) -> None:
    """Single task text_planning — verifikasi basic routing & execution."""
    header("SKENARIO 1: Single Task — Text Planning")
    print("""
  Tujuan  : Kirim satu tugas kategori 'text_planning' dan pastikan
            orchestrator berhasil menyelesaikannya.
  Catatan : Kategori ini tidak butuh 'tangan' (tidak menjalankan kode),
            jadi cocok untuk tes cepat tanpa worktree.
    """.rstrip())

    step(1, "Kirim task text_planning")
    payload = {
        "prompt": "Buatkan outline singkat (3 poin) untuk refactor modul autentikasi.",
        "category": "text_planning",
        "allow_unisolated": True,
    }
    info(f"prompt: {payload['prompt']}")
    r = api.post("/api/tasks", json=payload)
    task = api.require_ok(r, "create task")
    task_id = task["id"]
    ok(f"Task dibuat → id={task_id}")

    step(2, "Tunggu task selesai")
    task = wait_task(api, task_id, label="text_planning")

    step(3, "Cek hasil")
    status = task["status"]
    if status == "ok":
        ok(f"Task selesai dengan status 'ok'")
        show_task_events(api, task_id)
    elif status == "halted":
        warn("Task halted — kemungkinan tidak ada routing rule untuk 'text_planning' atau semua agent di-skip.")
        info("Cek: apakah ada agent dengan routing rule untuk kategori 'text_planning'?")
        show_task_events(api, task_id)
    else:
        fail(f"Status tidak diharapkan: {status}")

    info(f"Detail: GET /api/tasks/{task_id}/events")


def scenario_2_plan_then_execute(api: Choros) -> None:
    """Workflow 2-step: planner → executor, verifikasi handoff artefak."""
    header("SKENARIO 2: Workflow Plan → Execute")
    print("""
  Tujuan  : Workflow 2 step — step 1 (planner) menghasilkan plan,
            step 2 (executor) menerima plan itu sebagai konteks.
  Yang diuji: apakah output step 1 benar-benar masuk ke prompt step 2?
    """.rstrip())

    step(1, "Pilih agent untuk Planner dan Executor")
    planner = pick_agent(api, "Planner (step 1 — text_planning)")
    executor = pick_agent(api, "Executor (step 2 — coding_complex)")

    goal = ask(
        "Goal/tugas yang akan direncanakan",
        "Tambahkan rate limiting ke endpoint /api/tasks"
    )

    step(2, "Buat workflow 2-step")
    wf = create_workflow(api, "Manual Test — Plan+Execute", steps=[
        {
            "name": "Planner",
            "role_prompt": (
                "Kamu adalah software planner. "
                "Buat plan terstruktur: file yang perlu diubah, langkah-langkah, "
                "dan kriteria selesai. Jangan tulis kode — hanya plan."
            ),
            "category": "text_planning",
            "targets": [{"agent_id": planner["id"]}],
            "requires_approval": False,
        },
        {
            "name": "Executor",
            "role_prompt": (
                "Kamu adalah software engineer. "
                "Ikuti plan dari step sebelumnya dan implementasikan perubahan."
            ),
            "category": "coding_complex",
            "targets": [{"agent_id": executor["id"]}],
            "requires_approval": False,
        },
    ])
    ok(f"Workflow dibuat → id={wf['id']}")

    step(3, "Jalankan workflow")
    run = run_workflow(api, wf["id"], goal=goal)
    run_id = run["id"]
    ok(f"Run dimulai → id={run_id}")

    step(4, "Tunggu step 1 (Planner) selesai")
    info("Menunggu run bergerak ke step 2...")
    run = wait_run(api, run_id, wait_status={"ok", "halted", "error", "awaiting_approval"})

    step(5, "Verifikasi handoff artefak")
    detail = api.get(f"/api/workflow-runs/{run_id}").json()
    steps_out = detail.get("steps", [])

    step1_task_id = next((s["task_id"] for s in steps_out if s["step_order"] == 0), None)
    step2_task_id = next((s["task_id"] for s in steps_out if s["step_order"] == 1), None)

    if step1_task_id:
        t1 = api.get(f"/api/tasks/{step1_task_id}").json()
        info(f"Step 1 (Planner) status: {t1['status']}")
    else:
        warn("Step 1 task tidak ditemukan")

    if step2_task_id:
        t2 = api.get(f"/api/tasks/{step2_task_id}").json()
        plan = t2.get("plan_artifact") or ""
        info(f"Step 2 (Executor) status: {t2['status']}")
        if plan:
            ok("plan_artifact berhasil diteruskan ke step 2!")
            print(f"\n  {DIM}── Isi plan_artifact (200 karakter pertama) ──{RESET}")
            print(textwrap.indent(plan[:200] + ("…" if len(plan) > 200 else ""), "    "))
        else:
            warn("plan_artifact kosong di step 2 — step 1 mungkin belum selesai atau output kosong")
    else:
        if run["status"] == "ok":
            ok("Workflow selesai (run.status = ok)")
        else:
            warn(f"Step 2 belum dibuat. Run status: {run['status']}")

    info(f"Detail run: GET /api/workflow-runs/{run_id}")


def scenario_3_quality_floor(api: Choros) -> None:
    """Verifikasi quality floor — agent di bawah ambang dilewati."""
    header("SKENARIO 3: Quality Floor Enforcement")
    print("""
  Tujuan  : Pastikan orchestrator melewati agent yang model-nya
            di bawah ambang kualitas (quality_floor).
  Caranya : Buat workflow dengan quality_floor='strong', lalu
            pilih agent yang model-nya ringan (haiku/flash/8b).
  Hasil   : Run harus halted karena semua target di-skip.
    """.rstrip())

    step(1, "Pilih agent LEMAH (yang ingin diblokir)")
    print(f"\n  {YELLOW}Pilih agent dengan model ringan: haiku, flash, llama-8b, dsb.{RESET}")
    agent = pick_agent(api, "agent lemah")
    model = agent.get("default_model") or "?"
    info(f"Model terpilih: {model}")

    step(2, "Buat workflow dengan quality_floor='strong'")
    wf = create_workflow(api, "Manual Test — Quality Floor", steps=[
        {
            "name": "Perlu Model Kuat",
            "role_prompt": "Lakukan refactor besar.",
            "category": "coding_complex",
            "quality_floor": "strong",
            "targets": [{"agent_id": agent["id"]}],
        },
    ])
    ok(f"Workflow dibuat → id={wf['id']}")

    step(3, "Jalankan workflow")
    run = run_workflow(api, wf["id"], goal="Refactor modul auth — butuh model kuat")
    run_id = run["id"]

    run_detail = api.get(f"/api/workflow-runs/{run_id}").json()
    task_id = run_detail["steps"][0].get("task_id")

    if task_id:
        step(4, "Tunggu task selesai")
        task = wait_task(api, task_id, label="quality_floor test")
        status = task["status"]

        step(5, "Verifikasi hasil")
        if status == "halted":
            ok(f"Task halted — quality floor bekerja dengan benar!")
            info(f"Model '{model}' diblokir oleh floor 'strong'")
            show_task_events(api, task_id)
        elif status == "ok":
            warn(f"Task berhasil — model '{model}' ternyata memenuhi floor 'strong'.")
            info("Coba pilih model yang lebih ringan (haiku, flash, llama-3.1-8b).")
        else:
            info(f"Status: {status}")
    else:
        warn("Task belum dibuat — cek status run")

    info(f"Run detail: GET /api/workflow-runs/{run_id}")


def scenario_4_approval_checkpoint(api: Choros) -> None:
    """Workflow dengan approval checkpoint — user review & edit plan sebelum eksekusi."""
    header("SKENARIO 4: Approval Checkpoint — User Review Plan")
    print("""
  Tujuan  : Workflow berhenti setelah step 1 dan menunggu Anda
            mereview (dan boleh mengedit) plan sebelum step 2 jalan.

  Alur    :
    Step 1 (Planner) → run.status = 'awaiting_approval'
           ↓ Anda review plan di terminal ini
    Anda approve (atau edit plan) → POST /approve
           ↓
    Step 2 (Executor) berjalan dengan plan yang sudah Anda setujui
    """.rstrip())

    step(1, "Pilih agent untuk Planner dan Executor")
    planner = pick_agent(api, "Planner (step 1)")
    executor = pick_agent(api, "Executor (step 2)")

    goal = ask(
        "Goal/tugas",
        "Implementasi fitur export CSV untuk laporan transaksi"
    )

    step(2, "Buat workflow dengan requires_approval=True di step 2")
    wf = create_workflow(api, "Manual Test — Approval", steps=[
        {
            "name": "Buat Plan",
            "role_prompt": (
                "Kamu adalah planner. Buat plan teknis yang jelas: "
                "file yang perlu diubah, fungsi baru yang perlu dibuat, "
                "dan urutan pengerjaan. Jangan tulis kode."
            ),
            "category": "text_planning",
            "targets": [{"agent_id": planner["id"]}],
        },
        {
            "name": "Eksekusi (butuh approval)",
            "role_prompt": "Kamu adalah engineer. Implementasikan sesuai plan.",
            "category": "coding_complex",
            "targets": [{"agent_id": executor["id"]}],
            "requires_approval": True,  # ← checkpoint
        },
    ])
    ok(f"Workflow dibuat → id={wf['id']}")

    step(3, "Jalankan workflow")
    run = run_workflow(api, wf["id"], goal=goal)
    run_id = run["id"]
    ok(f"Run dimulai → id={run_id}")

    step(4, "Tunggu step 1 selesai dan run berhenti menunggu approval")
    run = wait_run(api, run_id, wait_status={"awaiting_approval", "ok", "halted", "error"})

    step(5, "Cek status run")
    if run["status"] != "awaiting_approval":
        warn(f"Run berstatus '{run['status']}' (bukan 'awaiting_approval').")
        info("Kemungkinan step 1 gagal, atau workflow hanya punya 1 step efektif.")
        return

    ok("Run berstatus 'awaiting_approval' — step 1 selesai, menunggu review Anda!")

    # Ambil plan artifact dari step 1
    detail = api.get(f"/api/workflow-runs/{run_id}").json()
    raw_plan = detail.get("pending_approval_artifact") or ""
    pending_step_id = detail.get("pending_approval_step_id")

    print(f"\n  {BOLD}── Plan yang dihasilkan Planner ──{RESET}")
    if raw_plan:
        print(textwrap.indent(raw_plan[:1000] + ("…" if len(raw_plan) > 1000 else ""), "    "))
    else:
        warn("Plan kosong — agent mungkin tidak menghasilkan output teks.")
    info(f"Pending approval untuk step id={pending_step_id}")

    step(6, "Review & (opsional) edit plan, lalu approve")
    print(f"""
  Pilihan Anda:
    {CYAN}[1]{RESET} Approve plan apa adanya
    {CYAN}[2]{RESET} Edit plan dulu, baru approve
    {RED}[3]{RESET} Tolak (reject) — run akan halted
    """.rstrip())

    choice = ask("Pilihan", "1")

    edited_plan = raw_plan
    if choice == "2":
        print(f"\n  {YELLOW}Ketik plan baru Anda di bawah ini.")
        print(f"  Baris kosong + Enter + CTRL+D (atau ketik '###END###') untuk selesai:{RESET}\n")
        lines = []
        while True:
            try:
                line = input("  ")
                if line.strip() == "###END###":
                    break
                lines.append(line)
            except EOFError:
                break
        edited_plan = "\n".join(lines) or raw_plan
        ok(f"Plan diedit ({len(edited_plan)} karakter)")

    elif choice == "3":
        info("Menolak run...")
        r = api.post(f"/api/workflow-runs/{run_id}/reject")
        if r.status_code == 200:
            ok("Run berhasil ditolak → status: halted")
        else:
            fail(f"Reject gagal: {r.status_code} {r.text[:200]}")
        return

    step(7, "Kirim approval")
    r = api.post(
        f"/api/workflow-runs/{run_id}/approve",
        json={"plan_artifact": edited_plan if edited_plan != raw_plan else None},
    )
    if r.status_code == 200:
        ok("Approval dikirim!")
    else:
        fail(f"Approve gagal: {r.status_code} {r.text[:200]}")
        return

    step(8, "Tunggu step 2 (Executor) selesai")
    run = wait_run(api, run_id, wait_status={"ok", "halted", "error"}, timeout=300)

    step(9, "Hasil akhir")
    if run["status"] == "ok":
        ok("Workflow selesai penuh! Semua step berhasil.")
    elif run["status"] == "halted":
        warn("Run halted di step 2.")
        detail2 = api.get(f"/api/workflow-runs/{run_id}").json()
        task2_id = next((s["task_id"] for s in detail2["steps"] if s["step_order"] == 1), None)
        if task2_id:
            show_task_events(api, task2_id)
    else:
        info(f"Status akhir: {run['status']}")

    info(f"Run detail: GET /api/workflow-runs/{run_id}")


# ─── Entry point ──────────────────────────────────────────────────────────────

SCENARIOS = {
    "1": ("Single task — text_planning dasar", scenario_1_single_planning_task),
    "2": ("Workflow plan → execute (handoff artefak)", scenario_2_plan_then_execute),
    "3": ("Quality floor — blokir agent lemah", scenario_3_quality_floor),
    "4": ("Approval checkpoint — review & edit plan", scenario_4_approval_checkpoint),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Manual test Choros")
    parser.add_argument("--url",  default="http://localhost:8000", help="Base URL server Choros")
    parser.add_argument("--user", default="admin", help="Username login")
    parser.add_argument("--pass", dest="password", default="", help="Password login")
    parser.add_argument("--scenario", choices=list(SCENARIOS.keys()), help="Jalankan skenario tertentu langsung")
    args = parser.parse_args()

    print(f"\n{BOLD}{CYAN}Choros Manual Test Runner{RESET}")
    print(f"  Server: {args.url}")

    client = httpx.Client(timeout=30.0)
    api = Choros(base=args.url, client=client)

    # Cek server aktif
    try:
        r = client.get(f"{args.url}/api/auth/status", timeout=5)
        r.raise_for_status()
    except Exception as e:
        fail(f"Tidak bisa menjangkau server di {args.url}: {e}")
        print(f"\n  {YELLOW}Pastikan Choros berjalan:{RESET}")
        print(f"    uvicorn app.main:app --reload  (development)")
        print(f"    docker compose up              (production)\n")
        sys.exit(1)

    auth_info = r.json()
    ok(f"Server aktif — auth_required={auth_info.get('auth_required')}")

    # Login kalau perlu
    if auth_info.get("auth_required"):
        password = args.password or ask(f"Password untuk '{args.user}'")
        lr = api.post("/api/auth/login", json={"username": args.user, "password": password})
        if lr.status_code != 200:
            fail(f"Login gagal: {lr.status_code} {lr.text}")
            sys.exit(1)
        ok(f"Login berhasil sebagai '{args.user}'")
    else:
        ok("Auth dinonaktifkan — langsung masuk")

    # Menu pilih skenario
    if args.scenario:
        chosen = [args.scenario]
    else:
        print(f"\n{BOLD}Skenario yang tersedia:{RESET}")
        for key, (title, _) in SCENARIOS.items():
            print(f"  {CYAN}[{key}]{RESET} {title}")
        print(f"  {CYAN}[a]{RESET} Jalankan semua")
        choice = ask("Pilih skenario", "1")
        chosen = list(SCENARIOS.keys()) if choice.lower() == "a" else [choice]

    for key in chosen:
        if key not in SCENARIOS:
            warn(f"Skenario '{key}' tidak dikenal, dilewati.")
            continue
        title, fn = SCENARIOS[key]
        try:
            fn(api)
        except KeyboardInterrupt:
            print(f"\n  {YELLOW}Skenario dihentikan (Ctrl+C){RESET}")
            break
        except Exception as e:
            fail(f"Error tidak terduga: {e}")
            import traceback; traceback.print_exc()

        if len(chosen) > 1 and key != chosen[-1]:
            pause("Lanjut ke skenario berikutnya?")

    print(f"\n{BOLD}{GREEN}Selesai.{RESET}\n")
    client.close()


if __name__ == "__main__":
    main()

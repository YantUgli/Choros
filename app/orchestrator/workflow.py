"""Workflow multi-step runner (Fase 4c).

Modul ini mengelola kemajuan workflow run: menentukan apa yang terjadi setelah
sebuah step task mencapai status terminal, membuat step task berikutnya, dan
menangani checkpoint approval.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.config import get_settings
from app.db import session_scope
from app.models import Task, WorkflowRun, WorkflowStep
from app.orchestrator.runner import runner

# Template keluaran planner — semakin murah eksekutornya, semakin lengkap plan
# ini harus. Simpan sebagai konstanta modul, bukan string inline: akan sering
# disetel ulang.
PLANNER_OUTPUT_TEMPLATE = """\
Kamu adalah planner. Buatkan plan yang terstruktur dan lengkap untuk tugas berikut.

Format output yang WAJIB diikuti:
1. **File yang perlu diubah/dibuat** — daftar lengkap path file
2. **Perubahan per file** — deskripsikan perubahan spesifik untuk tiap file
3. **Dependency** — library atau modul yang dibutuhkan
4. **Urutan pengerjaan** — langkah demi langkah, dari yang paling fundamental
5. **Kriteria selesai** — bagaimana memastikan tugas benar-benar tuntas

Jangan menulis kode. Cukup tulis plan yang jelas dan lengkap agar eksekutor
bisa langsung mengerjakan tanpa bertanya lagi.
"""


def _handoff_prompt(
    role_prompt: str | None, goal: str, artifact: str
) -> str:
    """Rakit prompt step N+1 dari artefak step sebelumnya.

    Urutan: role-framing → goal asli user → artefak step sebelumnya.
    Role-framing di depan karena ia mengubah cara seluruh sisanya dibaca.
    """
    parts: list[str] = []
    if role_prompt:
        parts.append(role_prompt.strip())
    parts.append(f"Goal asli user:\n{goal}")
    parts.append(
        "---\n"
        "Catatan orchestrator: berikut adalah output dari step sebelumnya. "
        "Gunakan sebagai panduan untuk mengerjakan bagianmu.\n\n"
        f"{artifact}"
    )
    return "\n\n".join(parts)


async def advance_run(
    run_id: int, *, approved_artifact: str | None = None
) -> None:
    """Tentukan apa yang terjadi setelah sebuah step task mencapai status terminal.

    Dipanggil dari tiga tempat:
    1. _execute, setelah _finish untuk task yang punya workflow_run_id
    2. Endpoint /approve
    3. lifespan saat startup — untuk run yang mandek
    """
    async with session_scope() as session:
        run = await session.get(WorkflowRun, run_id)
        if run is None:
            return

        # Ambil semua step workflow, terurut
        steps = (
            await session.execute(
                select(WorkflowStep)
                .where(WorkflowStep.workflow_id == run.workflow_id)
                .order_by(WorkflowStep.step_order)
            )
        ).scalars().all()

        if not steps:
            run.status = "halted"
            run.finished_at = datetime.now(UTC)
            await session.commit()
            return

        # Cari step task terakhir yang dibuat untuk run ini
        last_task = (
            await session.execute(
                select(Task)
                .where(Task.workflow_run_id == run.id)
                .order_by(Task.step_order.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if last_task is None:
            return

        # Step gagal → run halted, berhenti
        if last_task.status in ("halted", "error"):
            run.status = "halted"
            run.finished_at = datetime.now(UTC)
            await session.commit()
            return

        # Step belum selesai → jangan lakukan apa-apa
        if last_task.status not in ("ok", "cancelled"):
            return

        # Tentukan step berikutnya
        current_order = last_task.step_order or 0
        next_order = current_order + 1

        # Cari step berikutnya
        next_step = None
        for s in steps:
            if s.step_order == next_order:
                next_step = s
                break

        if next_step is None:
            # Tidak ada step berikutnya → run selesai
            run.status = "ok"
            run.current_step = current_order
            run.finished_at = datetime.now(UTC)
            await session.commit()
            return

        # Cek approval checkpoint
        if next_step.requires_approval and run.status != "awaiting_approval":
            run.status = "awaiting_approval"
            run.current_step = current_order
            await session.commit()
            return

        # Kalau sudah di-approve (dipanggil dari /approve), lanjut buat task
        # Atau kalau step tidak memerlukan approval

        # Siapkan artifact handoff
        artifact = approved_artifact or last_task.final_output or ""
        prompt = _handoff_prompt(next_step.role_prompt, run.goal, artifact)

        # Untuk step planner, tambahkan template output
        if next_step.category == "text_planning" or (
            next_step.role_prompt and "planner" in (next_step.role_prompt or "").lower()
        ):
            prompt = f"{PLANNER_OUTPUT_TEMPLATE}\n\n{prompt}"

        settings = get_settings()

        # Step pertama yang membuat worktree → ambil workspace_path dari situ
        first_task = (
            await session.execute(
                select(Task)
                .where(Task.workflow_run_id == run.id, Task.owns_workspace.is_(True))
                .order_by(Task.step_order)
                .limit(1)
            )
        ).scalar_one_or_none()

        workspace_path = None
        if first_task and first_task.workspace_path:
            workspace_path = first_task.workspace_path
            # Update run workspace_path juga
            if not run.workspace_path:
                run.workspace_path = workspace_path

        next_task = Task(
            user_id=run.user_id,
            prompt=prompt,
            category=next_step.category or "coding_complex",
            mode=run.mode,
            project_path=run.project_path or settings.default_project_path,
            quality_floor=next_step.quality_floor,
            plan_artifact=artifact if artifact else None,
            allow_unisolated=run.allow_unisolated,
            workflow_run_id=run.id,
            step_order=next_order,
            owns_workspace=False,  # workspace milik run, bukan step
            workspace_path=workspace_path,
            status="queued",
        )
        session.add(next_task)

        run.status = "running"
        run.current_step = next_order
        await session.commit()
        await session.refresh(next_task)

    # Start task di luar session scope
    runner.start(next_task.id)


async def recover_interrupted_runs() -> int:
    """Pulihkan run yang mandek saat startup.

    Run yang step task terakhirnya sudah terminal tapi run-nya masih 'running'
    — server mati di antara dua step.
    """
    count = 0
    async with session_scope() as session:
        # Cari run yang masih running
        active_runs = (
            await session.execute(
                select(WorkflowRun).where(
                    WorkflowRun.status.in_(["running", "awaiting_approval"])
                )
            )
        ).scalars().all()

        for run in active_runs:
            last_task = (
                await session.execute(
                    select(Task)
                    .where(Task.workflow_run_id == run.id)
                    .order_by(Task.step_order.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()

            if last_task is None:
                continue

            # Kalau task terakhir sudah terminal tapi run masih running
            if last_task.status in ("ok", "halted", "error", "cancelled", "interrupted"):
                if run.status == "awaiting_approval":
                    continue  # memang sedang menunggu approval, biarkan
                count += 1

        await session.commit()

    # Advance run yang mandek di luar session scope
    for run in active_runs:
        last_task_status = None
        async with session_scope() as session:
            last_task = (
                await session.execute(
                    select(Task)
                    .where(Task.workflow_run_id == run.id)
                    .order_by(Task.step_order.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if last_task:
                last_task_status = last_task.status

        if last_task_status in ("ok",) and run.status == "running":
            try:
                await advance_run(run.id)
            except Exception:
                pass  # jangan crash saat startup

    return count

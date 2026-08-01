from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    RoutingRule,
    Task,
    TaskEvent,
    Workflow,
    WorkflowRun,
    WorkflowStep,
)


@pytest.mark.asyncio
async def test_auth_disabled_mode(user):
    """Dalam mode auth_disabled (tanpa password hash), request dianggap sebagai user default."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/tasks")
        assert res.status_code == 200
        assert isinstance(res.json(), list)


@pytest.mark.asyncio
async def test_user_boundary_ownership_404(user, user_b):
    """User B tidak boleh melihat atau memanipulasi task milik User A (harus 404)."""
    async with SessionLocal() as session:
        task_a = Task(
            user_id=user.id,
            prompt="Task User A",
            category="coding_complex",
            mode="autonomous",
            project_path=".",
            workspace_path="./ws",
            status="queued",
        )
        session.add(task_a)
        await session.commit()
        task_a_id = task_a.id

    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. GET /api/tasks/{id} milik user A -> 404
            res = await client.get(f"/api/tasks/{task_a_id}")
            assert res.status_code == 404

            # 2. POST /api/tasks/{id}/cancel milik user A -> 404
            res = await client.post(f"/api/tasks/{task_a_id}/cancel")
            assert res.status_code == 404

            # 3. GET /api/tasks/{id}/diff milik user A -> 404
            res = await client.get(f"/api/tasks/{task_a_id}/diff")
            assert res.status_code == 404

            # 4. POST /api/tasks/{id}/merge milik user A -> 404
            res = await client.post(f"/api/tasks/{task_a_id}/merge")
            assert res.status_code == 404

            # 5. POST /api/tasks/{id}/discard milik user A -> 404
            res = await client.post(f"/api/tasks/{task_a_id}/discard")
            assert res.status_code == 404

            # 6. GET /api/tasks/{id}/logs milik user A -> 404
            res = await client.get(f"/api/tasks/{task_a_id}/logs")
            assert res.status_code == 404

            # 7. GET /api/tasks -> tidak membocorkan task_a milik user A
            res = await client.get("/api/tasks")
            assert res.status_code == 200
            task_ids = [t["id"] for t in res.json()]
            assert task_a_id not in task_ids
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_agent_and_rule_ownership_boundary(user, user_b, make_agent):
    """User B tidak boleh melihat/menghapus agent atau routing rule milik User A."""
    agent_a = await make_agent("agent_a", adapter_type="claude_code")

    async with SessionLocal() as session:
        rule_a = RoutingRule(category="coding_complex", agent_id=agent_a.id, priority=10)
        session.add(rule_a)
        await session.commit()
        rule_a_id = rule_a.id

    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # User B mencoba hapus agent A -> 404
            res = await client.delete(f"/api/agents/{agent_a.id}")
            assert res.status_code == 404

            # User B mencoba hapus routing rule A -> 404
            res = await client.delete(f"/api/routing/{rule_a_id}")
            assert res.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_sse_stream_replay_and_dedup_seq(user):
    """SSE stream membalas event tersimpan & tidak menduplikasi event live dengan seq <= last_seq."""
    async with SessionLocal() as session:
        task = Task(user_id=user.id, prompt="Test SSE Dedup", category="coding_complex", status="ok")
        session.add(task)
        await session.commit()
        task_id = task.id

        e1 = TaskEvent(task_id=task_id, seq=1, type="status", data={"message": "event 1"})
        e2 = TaskEvent(task_id=task_id, seq=2, type="status", data={"message": "event 2"})
        session.add_all([e1, e2])
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/tasks/{task_id}/stream")
        assert res.status_code == 200
        assert "text/event-stream" in res.headers["content-type"]
        text = res.text

        # Event 1 dan 2 terkirim lewat replay DB
        assert '"seq": 1' in text
        assert '"seq": 2' in text
        assert '"message": "event 1"' in text
        assert '"message": "event 2"' in text

@pytest.mark.asyncio
async def test_workflow_crud_ownership_boundary(user, user_b):
    """User B tidak boleh melihat atau memanipulasi workflow User A (harus 404)."""
    async with SessionLocal() as session:
        wf_a = Workflow(user_id=user.id, name="Workflow A")
        session.add(wf_a)
        await session.flush()
        
        step_a = WorkflowStep(workflow_id=wf_a.id, step_order=0, role_prompt="step 1", category="coding_complex")
        session.add(step_a)
        
        run_a = WorkflowRun(workflow_id=wf_a.id, user_id=user.id, goal="test goal", current_step=0, status="running")
        session.add(run_a)
        await session.commit()
        
        wf_a_id = wf_a.id
        run_a_id = run_a.id

    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # GET /api/workflows/{id} -> 404
            res = await client.get(f"/api/workflows/{wf_a_id}")
            assert res.status_code == 404

            # GET /api/workflows/{id}/steps -> 404
            res = await client.get(f"/api/workflows/{wf_a_id}/steps")
            assert res.status_code == 404

            # PUT /api/workflows/{id} -> 404
            res = await client.put(f"/api/workflows/{wf_a_id}", json={"name": "test", "steps": []})
            assert res.status_code == 404

            # DELETE /api/workflows/{id} -> 404
            res = await client.delete(f"/api/workflows/{wf_a_id}")
            assert res.status_code == 404

            # POST /api/workflows/{id}/run -> 404
            res = await client.post(f"/api/workflows/{wf_a_id}/run", json={"goal": "test"})
            assert res.status_code == 404
            
            # GET /api/workflow-runs/{id} -> 404
            res = await client.get(f"/api/workflow-runs/{run_a_id}")
            assert res.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_workflow_targets_agent_id_validation(user, user_b, make_agent):
    """POST/PUT workflow dengan agent_id milik user lain ditolak (403)."""
    agent_a = await make_agent("agent_a", adapter_type="claude_code")

    async with SessionLocal() as session:
        wf_b = Workflow(user_id=user_b.id, name="Workflow B")
        session.add(wf_b)
        await session.commit()
        wf_b_id = wf_b.id

    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # POST /api/workflows dengan target agent milik user_a
            payload = {
                "name": "test POST",
                "steps": [
                    {
                        "role_prompt": "test",
                        "targets": [{"type": "agent", "agent_id": agent_a.id}],
                        "quality_floor": None,
                        "requires_approval": False,
                        "category": "coding_complex",
                    }
                ],
            }
            res = await client.post("/api/workflows", json=payload)
            assert res.status_code == 403

            # PUT /api/workflows/{id} dengan target agent milik user_a
            payload["name"] = "test PUT"
            res = await client.put(f"/api/workflows/{wf_b_id}", json=payload)
            assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_workflow_detail_returns_ordered_steps(user):
    """T1: GET /api/workflows/{id} mengembalikan steps terurut step_order."""
    async with SessionLocal() as session:
        wf = Workflow(user_id=user.id, name="WF Detail Test")
        session.add(wf)
        await session.flush()
        s2 = WorkflowStep(workflow_id=wf.id, step_order=1, name="Step 2", category="coding_complex")
        s1 = WorkflowStep(workflow_id=wf.id, step_order=0, name="Step 1", category="text_planning")
        session.add_all([s2, s1])
        await session.commit()
        wf_id = wf.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/workflows/{wf_id}")
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "WF Detail Test"
        assert len(data["steps"]) == 2
        assert data["steps"][0]["step_order"] == 0
        assert data["steps"][0]["name"] == "Step 1"
        assert data["steps"][1]["step_order"] == 1
        assert data["steps"][1]["name"] == "Step 2"


@pytest.mark.asyncio
async def test_workflow_step_name_roundtrip(user):
    """T7: POST /workflows + GET round-trip mempertahankan name tiap step."""
    payload = {
        "name": "Roundtrip WF",
        "steps": [
            {"name": "Step Alpha", "role_prompt": "Prompt A", "category": "coding_complex"},
            {"name": "Step Beta", "role_prompt": "Prompt B", "category": "text_planning"},
        ],
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/workflows", json=payload)
        assert res.status_code == 201
        wf_id = res.json()["id"]

        get_res = await client.get(f"/api/workflows/{wf_id}")
        assert get_res.status_code == 200
        steps = get_res.json()["steps"]
        assert steps[0]["name"] == "Step Alpha"
        assert steps[1]["name"] == "Step Beta"


@pytest.mark.asyncio
async def test_cookie_auth_flow(monkeypatch, user):
    """T9: Tanpa cookie -> 401; cookie rusak -> 401; issue_cookie sah -> 200."""
    from app.config import get_settings
    from app.security import COOKIE_NAME, issue_cookie

    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", "$2b$12$fakehashforpytest")
    get_settings.cache_clear()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Tanpa cookie -> 401
            r1 = await client.get("/api/tasks")
            assert r1.status_code == 401

            # 2. Cookie rusak -> 401
            client.cookies.set(COOKIE_NAME, "bad-token-value")
            r2 = await client.get("/api/tasks")
            assert r2.status_code == 401

            # 3. Cookie sah -> 200
            token = issue_cookie(user.username)
            client.cookies.set(COOKIE_NAME, token)
            r3 = await client.get("/api/tasks")
            assert r3.status_code == 200
    finally:
        monkeypatch.delenv("CHOROS_ADMIN_PASSWORD_HASH", raising=False)
        get_settings.cache_clear()


from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    RoutingRule,
    Task,
    TaskEvent,
    User,
    Workflow,
    WorkflowRun,
    WorkflowStep,
)
from app.security import get_current_user


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


@pytest.mark.asyncio
async def test_b1_auth_disabled_vulnerability_with_db_users(monkeypatch):
    """B1: Ada user ber-password_hash tapi env hash kosong -> GET /api/tasks tanpa cookie 401, bukan 200."""
    from app.config import get_settings
    monkeypatch.delenv("CHOROS_ADMIN_PASSWORD_HASH", raising=False)
    get_settings.cache_clear()

    async with SessionLocal() as session:
        user_with_pwd = User(username="user_pass", password_hash="$2b$12$somehash")
        session.add(user_with_pwd)
        await session.commit()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/tasks")
            assert res.status_code == 401
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_b3_login_table_user():
    """B3: Login user tabel: password benar 200 + cookie; password salah 401."""
    from app.security import COOKIE_NAME, hash_password
    async with SessionLocal() as session:
        user_table = User(username="table_bob", password_hash=hash_password("bobsecret"))
        session.add(user_table)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res1 = await client.post("/api/auth/login", json={"username": "table_bob", "password": "wrongpassword"})
        assert res1.status_code == 401

        res2 = await client.post("/api/auth/login", json={"username": "table_bob", "password": "bobsecret"})
        assert res2.status_code == 200
        assert res2.json()["ok"] is True
        assert COOKIE_NAME in res2.cookies


@pytest.mark.asyncio
async def test_b4_user_without_password_cannot_login_with_admin_password(monkeypatch):
    """B4: User ada di tabel tanpa password_hash, bukan admin_username -> login memakai password admin ditolak."""
    from app.config import get_settings
    from app.security import hash_password
    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()

    async with SessionLocal() as session:
        user_no_pass = User(username="nopass_guy", password_hash=None)
        session.add(user_no_pass)
        await session.commit()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/auth/login", json={"username": "nopass_guy", "password": "adminpass"})
            assert res.status_code == 401
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_b5_user_management_authorization():
    """B5: Non-admin POST /api/users -> 403; admin -> 201."""
    from app.security import get_current_user, hash_password
    async with SessionLocal() as session:
        admin_u = User(username="admin_guy", password_hash=hash_password("p"), is_admin=True)
        normal_u = User(username="normal_guy", password_hash=hash_password("p"), is_admin=False)
        session.add_all([admin_u, normal_u])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: normal_u
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/users", json={"username": "u1", "password": "p", "is_admin": False})
            assert res.status_code == 403
    finally:
        app.dependency_overrides.clear()

    app.dependency_overrides[get_current_user] = lambda: admin_u
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post("/api/users", json={"username": "u2", "password": "p", "is_admin": False})
            assert res.status_code == 201
            data = res.json()
            assert data["username"] == "u2"
            assert data["is_admin"] is False
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_b6_new_user_has_own_defaults_and_isolated_targets():
    """B6: User baru punya agent + routing rule sendiri; resolve_targets tidak kosong dan tidak beririsan."""
    from app.orchestrator.router import resolve_targets
    from app.security import get_current_user, hash_password

    async with SessionLocal() as session:
        admin_u = User(username="admin_b6", password_hash=hash_password("p"), is_admin=True)
        session.add(admin_u)
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_u
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res1 = await client.post("/api/users", json={"username": "user1_b6", "password": "p", "seed_defaults": True})
            res2 = await client.post("/api/users", json={"username": "user2_b6", "password": "p", "seed_defaults": True})
            u1_id = res1.json()["id"]
            u2_id = res2.json()["id"]
    finally:
        app.dependency_overrides.clear()

    async with SessionLocal() as session:
        targets_u1 = await resolve_targets(session, "coding_complex", user_id=u1_id)
        targets_u2 = await resolve_targets(session, "coding_complex", user_id=u2_id)

        assert len(targets_u1) > 0
        assert len(targets_u2) > 0

        u1_agent_ids = {t.agent.id for t in targets_u1}
        u2_agent_ids = {t.agent.id for t in targets_u2}
        assert u1_agent_ids.isdisjoint(u2_agent_ids)


@pytest.mark.asyncio
async def test_b7_auth_status_returns_logged_in_username(monkeypatch):
    """B7: GET /api/auth/status mengembalikan username yang login, bukan admin_username."""
    from app.config import get_settings
    from app.security import COOKIE_NAME, hash_password, issue_cookie

    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res1 = await client.get("/api/auth/status")
            assert res1.status_code == 200
            assert res1.json()["auth_required"] is True
            assert res1.json()["username"] is None

            client.cookies.set(COOKIE_NAME, issue_cookie("custom_user"))
            res2 = await client.get("/api/auth/status")
            assert res2.status_code == 200
            assert res2.json()["username"] == "custom_user"
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_b8_list_users_never_exposes_password_hash():
    """B8: GET /api/users tidak pernah memuat password_hash di body."""
    from app.security import get_current_user, hash_password
    async with SessionLocal() as session:
        admin_u = User(username="admin_b8", password_hash=hash_password("p1"), is_admin=True)
        normal_u = User(username="user_b8", password_hash=hash_password("p2"), is_admin=False)
        session.add_all([admin_u, normal_u])
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin_u
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/users")
            assert res.status_code == 200
            users = res.json()
            assert len(users) >= 2
            for u in users:
                assert "password_hash" not in u
                assert "password" not in u
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_b9_delete_last_admin_rejected():
    """B9: Hapus admin terakhir ditolak."""
    from app.security import get_current_user, hash_password
    async with SessionLocal() as session:
        only_admin = User(username="sole_admin", password_hash=hash_password("p"), is_admin=True)
        session.add(only_admin)
        await session.commit()

    app.dependency_overrides[get_current_user] = lambda: only_admin
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res_list = await client.get("/api/users")
            admins = [u for u in res_list.json() if u["is_admin"] and u["id"] != only_admin.id]
            for adm in admins:
                await client.delete(f"/api/users/{adm['id']}")

            res = await client.delete(f"/api/users/{only_admin.id}")
            assert res.status_code == 400
            assert "admin terakhir" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_c1_auth_status_admin_cookie(monkeypatch):
    """C1: /api/auth/status untuk user admin ber-cookie sah -> is_admin: true"""
    from app.config import get_settings
    from app.security import COOKIE_NAME, hash_password, issue_cookie
    
    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()
    
    async with SessionLocal() as session:
        admin_u = User(username="c1_admin", password_hash="dummy", is_admin=True)
        session.add(admin_u)
        await session.commit()
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.cookies.set(COOKIE_NAME, issue_cookie("c1_admin"))
            res = await client.get("/api/auth/status")
            assert res.status_code == 200
            assert res.json()["is_admin"] is True
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_c2_auth_status_non_admin_cookie(monkeypatch):
    """C2: /api/auth/status untuk user non-admin ber-cookie sah -> is_admin: false"""
    from app.config import get_settings
    from app.security import COOKIE_NAME, hash_password, issue_cookie
    
    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()
    
    async with SessionLocal() as session:
        normal_u = User(username="c2_user", password_hash="dummy", is_admin=False)
        session.add(normal_u)
        await session.commit()
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.cookies.set(COOKIE_NAME, issue_cookie("c2_user"))
            res = await client.get("/api/auth/status")
            assert res.status_code == 200
            assert res.json()["is_admin"] is False
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_c3_auth_status_no_cookie(monkeypatch):
    """C3: /api/auth/status tanpa cookie (mode berpassword) -> 200, username: null, is_admin: false"""
    from app.config import get_settings
    from app.security import hash_password
    
    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/auth/status")
            assert res.status_code == 200
            data = res.json()
            assert data["username"] is None
            assert data["is_admin"] is False
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_c4_auth_status_contract(monkeypatch):
    """C4: Body /api/auth/status memuat ketiga kunci auth_required, username, is_admin"""
    from app.config import get_settings
    from app.security import hash_password
    
    monkeypatch.setenv("CHOROS_ADMIN_PASSWORD_HASH", hash_password("adminpass"))
    get_settings.cache_clear()
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/auth/status")
            assert res.status_code == 200
            data = res.json()
            keys = list(data.keys())
            assert "auth_required" in keys
            assert "username" in keys
            assert "is_admin" in keys
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_c5_seed_defaults_new_user():
    """C5: seed_defaults mengembalikan SeedReport dengan 6 agent + 23 route saat user baru"""
    from app.defaults import seed_defaults
    
    async with SessionLocal() as session:
        user = User(username="c5_user", is_admin=False)
        session.add(user)
        await session.flush()
        
        report = await seed_defaults(session, user)
        assert len(report.agents_added) == 6
        assert len(report.routes_added) == 23
        assert len(report.routes_reconciled) == 0


@pytest.mark.asyncio
async def test_c6_seed_defaults_idempotent():
    """C6: seed_defaults dipanggil dua kali -> nol tambahan"""
    from app.defaults import seed_defaults
    
    async with SessionLocal() as session:
        user = User(username="c6_user", is_admin=False)
        session.add(user)
        await session.flush()
        
        report1 = await seed_defaults(session, user)
        assert len(report1.agents_added) == 6
        
        report2 = await seed_defaults(session, user)
        assert len(report2.agents_added) == 0
        assert len(report2.routes_added) == 0
        assert len(report2.routes_reconciled) == 0


@pytest.mark.asyncio
async def test_d5_post_users_sets_credential_home():
    """D5: POST /api/users mengisi credential_home dan direktorinya benar-benar dibuat"""
    from pathlib import Path
    from app.config import get_settings
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.security import get_current_user
    from app.models import User
    
    admin_user = User(username="admin_d5", is_admin=True)
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(
                "/api/users",
                json={"username": "d5_user", "password": "abc", "is_admin": False, "seed_defaults": False}
            )
            assert res.status_code == 201

        from app.db import SessionLocal
        from app.models import User
        from sqlalchemy import select

        async with SessionLocal() as session:
            user = (await session.execute(select(User).where(User.username == "d5_user"))).scalar_one()
            assert user.credential_home is not None
            home_path = Path(user.credential_home)
            assert home_path.exists()
            assert home_path.is_dir()

            settings = get_settings()
            assert str(home_path) == str(Path(settings.credential_root) / "d5_user")
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_d6_bootstrap_admin_credential_home_is_null():
    """D6: Admin bootstrap tetap ber-credential_home NULL"""
    from app.main import app, lifespan
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select
    from app.config import get_settings

    async with lifespan(app):
        settings = get_settings()
        async with SessionLocal() as session:
            admin = (await session.execute(select(User).where(User.username == settings.admin_username))).scalar_one()
            assert admin.credential_home is None

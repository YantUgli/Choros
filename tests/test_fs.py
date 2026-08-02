from __future__ import annotations

import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

@pytest.mark.asyncio
async def test_fs_list_valid_dir(user, tmp_path: Path):
    """Test valid directory listing with subdirectories and files."""
    d1 = tmp_path / "folder_a"
    d1.mkdir()
    d2 = tmp_path / "folder_b"
    d2.mkdir()
    f1 = tmp_path / "file.txt"
    f1.touch()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/fs/list", params={"path": str(tmp_path)})
        assert res.status_code == 200
        data = res.json()
        assert data["path"] == str(tmp_path.resolve())
        # Only subdirectories should be listed, not files
        assert sorted(data["entries"]) == ["folder_a", "folder_b"]
        assert data["parent"] == str(tmp_path.resolve().parent)

@pytest.mark.asyncio
async def test_fs_list_not_found(user, tmp_path: Path):
    """Test not found path."""
    non_existent = tmp_path / "does_not_exist"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/fs/list", params={"path": str(non_existent)})
        assert res.status_code == 404

@pytest.mark.asyncio
async def test_fs_list_is_file(user, tmp_path: Path):
    """Test path points to file, should return 404 since it's not a dir."""
    f = tmp_path / "file.txt"
    f.touch()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/fs/list", params={"path": str(f)})
        assert res.status_code == 404

@pytest.mark.asyncio
async def test_fs_list_empty_path(user):
    """Test empty path, should return list of drives."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/fs/list", params={"path": ""})
        assert res.status_code == 200
        data = res.json()
        assert data["path"] == ""
        assert data["parent"] is None
        assert isinstance(data["entries"], list)

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

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.defaults import seed_defaults
from app.models import Task, User, Workflow
from app.schemas import UserIn, UserOut
from app.security import CurrentAdmin, DbSession, hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserIn,
    admin: CurrentAdmin,
    session: DbSession,
) -> UserOut:
    existing = (
        await session.execute(select(User).where(User.username == payload.username))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username sudah digunakan",
        )

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    session.add(user)
    await session.flush()

    if payload.seed_defaults:
        await seed_defaults(session, user)

    await session.commit()
    await session.refresh(user)
    return UserOut.model_validate(user)


@router.get("", response_model=list[UserOut])
async def list_users(
    admin: CurrentAdmin,
    session: DbSession,
) -> list[UserOut]:
    result = await session.execute(select(User).order_by(User.id))
    users = result.scalars().all()
    return [UserOut.model_validate(u) for u in users]


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    admin: CurrentAdmin,
    session: DbSession,
) -> dict[str, bool]:
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user tidak ditemukan"
        )

    if user.is_admin:
        admin_count = (
            await session.execute(
                select(func.count(User.id)).where(User.is_admin.is_(True))
            )
        ).scalar_one()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tidak bisa menghapus admin terakhir",
            )

    has_tasks = (
        await session.execute(select(Task.id).where(Task.user_id == user_id).limit(1))
    ).first()
    has_workflows = (
        await session.execute(
            select(Workflow.id).where(Workflow.user_id == user_id).limit(1)
        )
    ).first()
    if has_tasks or has_workflows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tidak bisa menghapus user yang memiliki task atau workflow",
        )

    await session.delete(user)
    await session.commit()
    return {"ok": True}

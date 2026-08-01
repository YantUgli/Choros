"""Seed agent + routing rules sesuai strategi default PRD §5.

    python -m scripts.seed

Idempoten: agent/rule yang sudah ada tidak diduplikasi.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, apply_migrations, engine
from app.defaults import seed_defaults
from app.models import User


async def main(reconcile: bool = False) -> None:
    settings = get_settings()
    await apply_migrations()

    async with SessionLocal() as session:
        user = (
            await session.execute(select(User).where(User.username == settings.admin_username))
        ).scalar_one_or_none()
        if user is None:
            user = User(username=settings.admin_username, is_admin=True)
            session.add(user)
            await session.flush()

        report = await seed_defaults(session, user, reconcile=reconcile)
        await session.commit()

    await engine.dispose()
    
    for a in report.agents_added:
        print(f"+ agent {a}")
    for r in report.routes_added:
        print(f"+ route {r}")
    for r in report.routes_reconciled:
        print(f"~ route {r} (reconciled)")
        
    print("\nseed selesai.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed agent dan routing rules")
    parser.add_argument(
        "--reconcile",
        action="store_true",
        help="Perbarui priority rule & config agent lama jika ada perubahan",
    )
    args = parser.parse_args()
    asyncio.run(main(reconcile=args.reconcile))

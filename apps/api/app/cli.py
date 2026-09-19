import argparse
import asyncio
import getpass

from sqlalchemy import func, select

from .db import SessionFactory
from .models import AuditEvent, User
from .security import hash_password, normalize_email


async def bootstrap_admin(email: str, password: str, display_name: str) -> None:
    normalized = normalize_email(email)
    async with SessionFactory() as db:
        user_count = int((await db.execute(select(func.count()).select_from(User))).scalar_one())
        existing = (await db.execute(select(User).where(User.email == normalized))).scalar_one_or_none()

        if existing is not None:
            if existing.is_admin:
                print(f"Admin already exists: {normalized}")
                return
            if user_count != 1:
                raise RuntimeError("Refusing to promote an existing user after bootstrap. Use an audited admin migration instead.")
            existing.is_admin = True
            existing.status = "active"
            existing.password_hash = hash_password(password)
            db.add(AuditEvent(actor_user_id=existing.id, event_type="admin.bootstrap", target_type="user", target_id=existing.id))
            await db.commit()
            print(f"Promoted bootstrap admin: {normalized}")
            return

        if user_count != 0:
            raise RuntimeError("Bootstrap is allowed only when the users table is empty.")

        user = User(
            email=normalized,
            display_name=display_name.strip(),
            password_hash=hash_password(password),
            status="active",
            is_admin=True,
        )
        db.add(user)
        await db.flush()
        db.add(AuditEvent(actor_user_id=user.id, event_type="admin.bootstrap", target_type="user", target_id=user.id))
        await db.commit()
        print(f"Created bootstrap admin: {normalized}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    bootstrap = sub.add_parser("bootstrap-admin", help="Create the first invite administrator")
    bootstrap.add_argument("--email", required=True)
    bootstrap.add_argument("--display-name", required=True)
    args = parser.parse_args()

    if args.command == "bootstrap-admin":
        password = getpass.getpass("Bootstrap admin password (min 12 chars): ")
        asyncio.run(bootstrap_admin(args.email, password, args.display_name))


if __name__ == "__main__":
    main()

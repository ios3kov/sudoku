import asyncio

from sqlalchemy import select

from app.db import SessionFactory
from app.models import User
from app.security import hash_password


USERS = (
    ("browser-owner@example.com", "Browser Owner"),
    ("browser-peer@example.com", "Browser Peer"),
)
PASSWORD = "browser acceptance password"


async def main() -> None:
    async with SessionFactory() as db:
        for email, display_name in USERS:
            user = (
                await db.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if user is None:
                user = User(
                    email=email,
                    display_name=display_name,
                    password_hash=hash_password(PASSWORD),
                    status="active",
                    is_admin=False,
                )
                db.add(user)
            else:
                user.display_name = display_name
                user.password_hash = hash_password(PASSWORD)
                user.status = "active"
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())

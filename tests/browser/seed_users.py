import asyncio

from app.db import SessionFactory
from app.models import User, UserContact
from app.security import hash_password
from sqlalchemy import select

USERS = (
    ("browser-owner@example.com", "Browser Owner"),
    ("browser-peer@example.com", "Browser Peer"),
    ("browser-pin-member@example.com", "PIN Member"),
    ("browser-pin-admin@example.com", "PIN Admin"),
    ("browser-pin-skip@example.com", "PIN Skip"),
)
PASSWORD = "browser acceptance password"


async def main() -> None:
    async with SessionFactory() as db:
        by_email = {}
        for index, (email, display_name) in enumerate(USERS, start=1):
            phone = "+" + str(70000000000 + index)
            user = (
                await db.execute(select(User).where(User.email == email))
            ).scalar_one_or_none()
            if user is None:
                user = User(
                    email=email,
                    phone_e164=phone,
                    display_name=display_name,
                    password_hash=hash_password(PASSWORD),
                    status="active",
                    is_admin=email == "browser-pin-admin@example.com",
                )
                db.add(user)
            else:
                user.phone_e164 = phone
                user.display_name = display_name
                user.password_hash = hash_password(PASSWORD)
                user.status = "active"
                user.is_admin = email == "browser-pin-admin@example.com"
            await db.flush()
            by_email[email] = user

        owner = by_email["browser-owner@example.com"]
        peer = by_email["browser-peer@example.com"]
        for source, target in ((owner, peer), (peer, owner)):
            existing = await db.get(UserContact, (source.id, target.id))
            if existing is None:
                db.add(UserContact(owner_user_id=source.id, contact_user_id=target.id))
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())
